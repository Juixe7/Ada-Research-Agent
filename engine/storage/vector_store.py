"""Qdrant and FastEmbed operations for owner-scoped document indexing and retrieval.

"""

import uuid
import logging
import threading
from typing import List, Dict, Any, Optional
from pathlib import Path
from qdrant_client import QdrantClient
from qdrant_client.http import models
from fastembed import TextEmbedding
from engine.config import QDRANT_COLLECTION, QDRANT_STORAGE_PATH, QDRANT_URL, QDRANT_API_KEY, EMBEDDING_MODEL_NAME

logger = logging.getLogger(__name__)

class AdaVectorStore:
    """
    Qdrant-backed Vector Database using FastEmbed ONNX embeddings for Ada.
    Supports remote Qdrant microservice or Qdrant Cloud (QDRANT_URL + QDRANT_API_KEY)
    and embedded local storage in standalone dev.
    """
    def __init__(self, collection_name: str = QDRANT_COLLECTION) -> None:
        """Initialize embeddings and connect to remote or durable local Qdrant.

        Args:
            collection_name: Collection to create or open.

        Raises:
            RuntimeError: When persistent Qdrant storage/collection cannot be
                initialized. The store deliberately does not fall back to an
                empty in-memory database.
        """
        self.collection_name = collection_name
        self.vector_size = 384  # bge-small-en-v1.5 dimension
        
        # Initialize FastEmbed Embedding Model
        logger.info("Loading document embedding model %s", EMBEDDING_MODEL_NAME)
        self.embed_model = TextEmbedding(model_name=EMBEDDING_MODEL_NAME)

        # Initialize Qdrant Client (Remote HTTP/Cloud -> Local disk -> In-memory fallback)
        self.client = None
        if QDRANT_URL:
            try:
                logger.info("Connecting to configured Qdrant service")
                candidate = QdrantClient(
                    url=QDRANT_URL,
                    api_key=QDRANT_API_KEY or None,
                    timeout=10,
                )
                candidate.get_collections()
                self.client = candidate
            except Exception:
                logger.warning("Qdrant service is unavailable; trying local persistent storage")

        if self.client is None:
            Path(QDRANT_STORAGE_PATH).mkdir(parents=True, exist_ok=True)
            try:
                self.client = QdrantClient(path=QDRANT_STORAGE_PATH)
            except Exception as e:
                raise RuntimeError(
                    f"Persistent Qdrant storage at '{QDRANT_STORAGE_PATH}' is unavailable or locked. "
                    "Start the configured Qdrant service or stop the other local instance; "
                    "Ada will not silently use an empty in-memory index."
                ) from e

        self._ensure_collection()

    def _ensure_collection(self):
        """Creates the collection if it doesn't already exist."""
        try:
            collections = [c.name for c in self.client.get_collections().collections]
            if self.collection_name not in collections:
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=models.VectorParams(
                        size=self.vector_size,
                        distance=models.Distance.COSINE
                    )
                )
                logger.info("Created Qdrant collection %s", self.collection_name)
        except Exception as e:
            raise RuntimeError(f"Could not initialize Qdrant collection '{self.collection_name}'.") from e

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Generates 384-dimensional dense vectors."""
        return [v.tolist() for v in self.embed_model.embed(texts)]

    def index_document_chunks(self, chunks: List[Dict[str, Any]]) -> int:
        """
        Indexes chunks from uploaded user documents into Qdrant.
        Preserves user_id for multi-tenant isolation.
        """
        if not chunks:
            return 0
        if any(not chunk.get("user_id") for chunk in chunks):
            raise ValueError("Every private vault chunk must include its owner user_id.")

        texts = [c["text"] for c in chunks]
        embeddings = self.embed_texts(texts)

        points = []
        for idx, chunk in enumerate(chunks):
            point_id = str(uuid.uuid4())
            payload = {
                "chunk_id": chunk.get("chunk_id", point_id),
                "doc_name": chunk.get("doc_name", "Unknown Document"),
                "page_number": chunk.get("page_number", 1),
                "text": chunk.get("text", ""),
                "source_type": "user_doc",
                "char_count": chunk.get("char_count", len(chunk.get("text", ""))),
                "user_id": chunk.get("user_id")
            }
            if chunk.get("section_path"):
                payload["section_path"] = chunk["section_path"]
            if chunk.get("chunk_index") is not None:
                payload["chunk_index"] = chunk["chunk_index"]
            points.append(
                models.PointStruct(
                    id=point_id,
                    vector=embeddings[idx],
                    payload=payload
                )
            )

        self.client.upsert(
            collection_name=self.collection_name,
            points=points
        )
        logger.info("Indexed %s private document chunks", len(points))
        return len(points)

    def search_user_docs(
        self,
        query: str,
        top_k: int = 5,
        score_threshold: float = 0.5,
        selected_docs: Optional[List[str]] = None,
        user_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Retrieves most relevant chunks from private user documents.
        Private document retrieval always requires an explicit tenant identity.
        """
        if not user_id:
            return []
        query_vector = self.embed_texts([query])[0]
        
        must_conditions = [
            models.FieldCondition(
                key="source_type",
                match=models.MatchValue(value="user_doc")
            )
        ]

        if selected_docs and len(selected_docs) > 0:
            must_conditions.append(
                models.FieldCondition(
                    key="doc_name",
                    match=models.MatchAny(any=selected_docs)
                )
            )

        if user_id:
            must_conditions.append(
                models.FieldCondition(
                    key="user_id",
                    match=models.MatchValue(value=user_id)
                )
            )

        filter_condition = models.Filter(must=must_conditions)

        response = self.client.query_points(
            collection_name=self.collection_name,
            query=query_vector,
            query_filter=filter_condition,
            limit=top_k,
            score_threshold=score_threshold
        )

        matches = []
        for hit in response.points:
            matches.append({
                "score": round(hit.score, 4),
                "chunk_id": hit.payload.get("chunk_id"),
                "chunk_index": hit.payload.get("chunk_index"),
                "section_path": hit.payload.get("section_path"),
                "doc_name": hit.payload.get("doc_name"),
                "page_number": hit.payload.get("page_number"),
                "text": hit.payload.get("text"),
                "source_type": "user_doc"
            })
        return matches

    def replace_document_chunks(self, chunks: List[Dict[str, Any]], doc_name: str, user_id: str) -> int:
        """Index a new document version first, then remove only this owner's old points."""
        if not user_id or any(chunk.get("user_id") != user_id for chunk in chunks):
            raise ValueError("Replacement chunks must include the document owner's user_id.")

        doc_filter = models.Filter(must=[
            models.FieldCondition(key="doc_name", match=models.MatchValue(value=doc_name)),
            models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id)),
            models.FieldCondition(key="source_type", match=models.MatchValue(value="user_doc")),
        ])
        old_point_ids = []
        offset = None
        while True:
            page, offset = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=doc_filter,
                limit=256,
                offset=offset,
                with_payload=False,
                with_vectors=False,
            )
            old_point_ids.extend(point.id for point in page)
            if offset is None:
                break

        indexed_count = self.index_document_chunks(chunks)
        if indexed_count != len(chunks):
            raise RuntimeError("The replacement document was not fully indexed.")
        if old_point_ids:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=models.PointIdsList(points=old_point_ids),
            )
        return indexed_count

    def get_document_chunks(
        self,
        doc_name: str,
        limit: int = 100,
        user_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Retrieves stored text chunks for a given document."""
        if not user_id:
            return []
        try:
            must_conds = [
                models.FieldCondition(
                    key="doc_name",
                    match=models.MatchValue(value=doc_name)
                )
            ]
            if user_id:
                must_conds.append(
                    models.FieldCondition(
                        key="user_id",
                        match=models.MatchValue(value=user_id)
                    )
                )
            scroll_res = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=models.Filter(must=must_conds),
                limit=limit
            )
            chunks = []
            for pt in scroll_res[0]:
                chunks.append({
                    "chunk_id": pt.payload.get("chunk_id"),
                    "page_number": pt.payload.get("page_number", 1),
                    "section_path": pt.payload.get("section_path"),
                    "chunk_index": pt.payload.get("chunk_index"),
                    "text": pt.payload.get("text", ""),
                    "char_count": pt.payload.get("char_count", len(pt.payload.get("text", "")))
                })
            return sorted(chunks, key=lambda x: (x.get("page_number", 1), x.get("chunk_index") or 0))
        except Exception:
            logger.warning("Could not fetch indexed chunks for a vault document")
            return []

    def get_document_chunks_count(self, doc_name: str, user_id: Optional[str] = None) -> int:
        """Counts how many chunks are indexed in Qdrant for this document."""
        if not user_id:
            return 0
        try:
            must_conds = [
                models.FieldCondition(
                    key="doc_name",
                    match=models.MatchValue(value=doc_name)
                )
            ]
            if user_id:
                must_conds.append(
                    models.FieldCondition(
                        key="user_id",
                        match=models.MatchValue(value=user_id)
                    )
                )
            count_res = self.client.count(
                collection_name=self.collection_name,
                count_filter=models.Filter(must=must_conds)
            )
            return count_res.count
        except Exception:
            return 0

    def delete_document(self, doc_name: str, user_id: Optional[str] = None) -> bool:
        """Deletes all indexed chunks for a given document name from Qdrant."""
        if not user_id:
            return False
        try:
            must_conds = [
                models.FieldCondition(
                    key="doc_name",
                    match=models.MatchValue(value=doc_name)
                )
            ]
            if user_id:
                must_conds.append(
                    models.FieldCondition(
                        key="user_id",
                        match=models.MatchValue(value=user_id)
                    )
                )
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=models.FilterSelector(
                    filter=models.Filter(must=must_conds)
                )
            )
            logger.info("Deleted indexed chunks for a vault document")
            return True
        except Exception:
            logger.warning("Could not delete indexed chunks for a vault document")
            return False

# Thread-safe singleton accessor
_store_instance = None
_store_lock = threading.Lock()

def get_vector_store() -> AdaVectorStore:
    """Return the process-wide vector-store instance, creating it on first use.

    Returns:
        Initialized `AdaVectorStore` singleton.

    Raises:
        RuntimeError: If Qdrant or the embedding model cannot initialize.
    """
    global _store_instance
    if _store_instance is None:
        with _store_lock:
            if _store_instance is None:
                _store_instance = AdaVectorStore()
    return _store_instance
