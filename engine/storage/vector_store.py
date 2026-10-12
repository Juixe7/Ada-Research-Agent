import os
import uuid
import threading
from typing import List, Dict, Any, Optional
from pathlib import Path
from qdrant_client import QdrantClient
from qdrant_client.http import models
from fastembed import TextEmbedding
from engine.config import QDRANT_COLLECTION, QDRANT_STORAGE_PATH, QDRANT_URL, QDRANT_API_KEY, EMBEDDING_MODEL_NAME

class AdaVectorStore:
    """
    Qdrant-backed Vector Database using FastEmbed ONNX embeddings for Ada.
    Supports remote Qdrant microservice or Qdrant Cloud (QDRANT_URL + QDRANT_API_KEY)
    and embedded local storage in standalone dev.
    """
    def __init__(self, collection_name: str = QDRANT_COLLECTION):
        self.collection_name = collection_name
        self.vector_size = 384  # bge-small-en-v1.5 dimension
        
        # Initialize FastEmbed Embedding Model
        print(f"[vector_store] Loading FastEmbed model ({EMBEDDING_MODEL_NAME})...")
        self.embed_model = TextEmbedding(model_name=EMBEDDING_MODEL_NAME)

        # Initialize Qdrant Client (Remote HTTP/Cloud -> Local disk -> In-memory fallback)
        self.client = None
        if QDRANT_URL:
            try:
                print(f"[vector_store] Connecting to Qdrant service at {QDRANT_URL}...")
                candidate = QdrantClient(
                    url=QDRANT_URL,
                    api_key=QDRANT_API_KEY or None,
                    timeout=10,
                )
                candidate.get_collections()
                self.client = candidate
            except Exception as e:
                print(f"[vector_store] Qdrant service unreachable ({e}); falling back to local path...")

        if self.client is None:
            Path(QDRANT_STORAGE_PATH).mkdir(parents=True, exist_ok=True)
            try:
                self.client = QdrantClient(path=QDRANT_STORAGE_PATH)
            except Exception as e:
                print(f"[vector_store] Local path locked ({e}); falling back to in-memory client...")
                self.client = QdrantClient(location=":memory:")

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
                print(f"[vector_store] Created collection: {self.collection_name}")
        except Exception as e:
            print(f"[vector_store] Collection check error: {e}")

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
        print(f"[vector_store] Indexed {len(points)} private document chunks into Qdrant.")
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
        If selected_docs or user_id is provided, filters accordingly.
        """
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
                "doc_name": hit.payload.get("doc_name"),
                "page_number": hit.payload.get("page_number"),
                "text": hit.payload.get("text"),
                "source_type": "user_doc"
            })
        return matches

    def get_document_chunks(
        self,
        doc_name: str,
        limit: int = 100,
        user_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Retrieves stored text chunks for a given document."""
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
            # Fallback if legacy chunks were indexed without user_id
            if not scroll_res[0] and user_id:
                scroll_res = self.client.scroll(
                    collection_name=self.collection_name,
                    scroll_filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="doc_name",
                                match=models.MatchValue(value=doc_name)
                            )
                        ]
                    ),
                    limit=limit
                )
            chunks = []
            for pt in scroll_res[0]:
                chunks.append({
                    "chunk_id": pt.payload.get("chunk_id"),
                    "page_number": pt.payload.get("page_number", 1),
                    "text": pt.payload.get("text", ""),
                    "char_count": pt.payload.get("char_count", len(pt.payload.get("text", "")))
                })
            return sorted(chunks, key=lambda x: x.get("page_number", 1))
        except Exception as e:
            print(f"[vector_store] Error fetching chunks for '{doc_name}': {e}")
            return []

    def get_document_chunks_count(self, doc_name: str, user_id: Optional[str] = None) -> int:
        """Counts how many chunks are indexed in Qdrant for this document."""
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
            if count_res.count == 0 and user_id:
                count_res = self.client.count(
                    collection_name=self.collection_name,
                    count_filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="doc_name",
                                match=models.MatchValue(value=doc_name)
                            )
                        ]
                    )
                )
            return count_res.count
        except Exception:
            return 0

    def delete_document(self, doc_name: str, user_id: Optional[str] = None) -> bool:
        """Deletes all indexed chunks for a given document name from Qdrant."""
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
            print(f"[vector_store] Deleted document '{doc_name}' from Qdrant.")
            return True
        except Exception as e:
            print(f"[vector_store] Error deleting document '{doc_name}': {e}")
            return False

# Thread-safe singleton accessor
_store_instance = None
_store_lock = threading.Lock()

def get_vector_store() -> AdaVectorStore:
    global _store_instance
    if _store_instance is None:
        with _store_lock:
            if _store_instance is None:
                _store_instance = AdaVectorStore()
    return _store_instance
