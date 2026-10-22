"""Private document lifecycle operations for Ada's source library.

The service owns document validation, extraction, indexing, and persistence.
HTTP routes should translate :class:`VaultServiceError` into API responses and
leave request parsing and authentication at the transport boundary.
"""

from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal, Optional, Protocol, TypedDict
import re

from sqlalchemy.orm import Session

from engine.ingest.doc_processor import (
    process_csv_document,
    process_docx_document,
    process_pdf_document,
    process_raw_text_document,
)
from engine.models import User, VaultDocument
from engine.services.errors import ServiceError
from engine.storage.vector_store import get_vector_store

logger = logging.getLogger(__name__)


class VaultServiceError(ServiceError):
    """Expected vault failure with an HTTP-compatible status and safe message."""

class VaultDocumentSummary(TypedDict):
    """Public summary shape consumed by the vault page."""

    doc_name: str
    filename: str
    size_kb: float
    uploaded_at: float
    chunk_count: int
    index_status: Literal["searchable", "not_indexed"]


class VaultListResult(TypedDict):
    """Stable result shape for listing the current user's source library."""

    documents: list[VaultDocumentSummary]


class VaultUploadResult(TypedDict):
    """Stable result shape for a file upload."""

    status: Literal["success"]
    filename: str
    chunks_indexed: int
    message: str


class VaultPasteResult(TypedDict):
    """Stable result shape for a pasted source."""

    status: Literal["success"]
    title: str
    doc_name: str
    chunks_indexed: int


class VaultDeleteResult(TypedDict):
    """Stable result shape for deleting a source."""

    status: Literal["success"]
    doc_name: str


class VaultReindexResult(TypedDict):
    """Stable result shape for rebuilding an index."""

    status: Literal["success"]
    doc_name: str
    chunks_indexed: int
    message: str


class VaultPreviewResult(TypedDict):
    """Stable result shape for extracted source preview and passage diagnostics."""

    doc_name: str
    filename: str
    size_kb: float
    page_count: int
    char_count: int
    chunks_indexed: int
    text: str
    chunks: list[dict[str, Any]]


class VaultVectorStore(Protocol):
    """Vector-store operations used by the vault service."""

    def replace_document_chunks(self, chunks: list[dict[str, Any]], doc_name: str, user_id: str) -> int:
        """Atomically replace one owner's passages; raise if indexing cannot complete."""
        ...

    def get_document_chunks_count(self, doc_name: str, user_id: Optional[str] = None) -> int:
        """Return the indexed passage count, optionally restricted to one owner."""
        ...

    def get_document_chunks(self, doc_name: str, limit: int = 100, user_id: Optional[str] = None) -> list[dict[str, Any]]:
        """Return up to `limit` indexed passages, optionally restricted to one owner."""
        ...

    def delete_document(self, doc_name: str, user_id: Optional[str] = None) -> bool:
        """Delete an owner's indexed passages and report whether the document existed."""
        ...


class VaultService:
    """Coordinate private document storage, extraction, indexing, and retrieval.

    Args:
        upload_dir: Root directory containing per-user document files.
        vector_store_factory: Lazy adapter factory, injectable for isolated tests.
        max_upload_bytes: Maximum accepted size for one document.
        max_documents_per_user: Maximum number of document metadata rows per owner.
    """

    SUPPORTED_SUFFIXES = frozenset({".pdf", ".docx", ".txt", ".md", ".csv"})

    def __init__(
        self,
        upload_dir: Path = Path("uploads"),
        vector_store_factory: Callable[[], VaultVectorStore] = get_vector_store,
        max_upload_bytes: int = 20 * 1024 * 1024,
        max_documents_per_user: int = 20,
    ) -> None:
        self.upload_dir = upload_dir
        self.vector_store_factory = vector_store_factory
        self.max_upload_bytes = max_upload_bytes
        self.max_documents_per_user = max_documents_per_user
        self.upload_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def sanitize_filename(name: str) -> str:
        """Strip path components and unsafe characters from a user filename.

        Raises:
            VaultServiceError: If no usable filename remains.
        """
        base = Path(name).name.strip()
        cleaned = re.sub(r"[^a-zA-Z0-9._\-\s()]", "_", base)
        if not cleaned or cleaned in (".", ".."):
            raise VaultServiceError(400, "Invalid document filename.")
        return cleaned

    def locate_file(self, doc_name: str, user: Optional[User]) -> Optional[Path]:
        """Find a document only within its owner's private directory."""
        if user is None:
            return None
        safe_doc = self.sanitize_filename(doc_name)
        targets = {safe_doc.lower(), doc_name.lower()}
        user_dir = self.upload_dir / user.id
        if not user_dir.exists():
            return None
        for path in user_dir.iterdir():
            if not path.is_file():
                continue
            name = path.name.lower()
            if name in targets or ("_" in path.name and path.name.split("_", 1)[1].lower() in targets):
                return path
        return None

    @staticmethod
    def require_document(doc_name: str, user: User, db: Session) -> VaultDocument:
        """Return an owned document row or a non-disclosing 404 service error."""
        safe_doc = VaultService.sanitize_filename(doc_name)
        document = db.query(VaultDocument).filter(
            VaultDocument.user_id == user.id,
            VaultDocument.doc_name == safe_doc,
        ).first()
        if document is None:
            raise VaultServiceError(404, "Document not found.")
        return document

    def _document_chunks(self, content: bytes, suffix: str, path: Path, doc_name: str) -> list[dict[str, Any]]:
        """Extract searchable chunks from supported document formats."""
        if suffix == ".pdf":
            return process_pdf_document(str(path), doc_name=doc_name)
        if suffix == ".docx":
            return process_docx_document(content, doc_name=doc_name)
        if suffix == ".csv":
            return process_csv_document(content, doc_name=doc_name)
        return process_raw_text_document(content.decode("utf-8", errors="ignore"), doc_name=doc_name)

    def _check_capacity(self, db: Session, user: User, doc_name: str) -> Optional[VaultDocument]:
        """Reject new documents beyond the per-user limit and return any existing row."""
        existing = db.query(VaultDocument).filter(
            VaultDocument.user_id == user.id,
            VaultDocument.doc_name == doc_name,
        ).first()
        count = db.query(VaultDocument).filter(VaultDocument.user_id == user.id).count()
        if existing is None and count >= self.max_documents_per_user:
            raise VaultServiceError(409, f"A workspace can contain at most {self.max_documents_per_user} documents.")
        return existing

    @staticmethod
    def _snapshot_index(vector_store: VaultVectorStore, doc_name: str, user_id: str) -> list[dict[str, Any]]:
        """Read all current passages so a later vector mutation can be compensated."""
        count = vector_store.get_document_chunks_count(doc_name, user_id=user_id)
        chunks = vector_store.get_document_chunks(doc_name, limit=max(count, 1), user_id=user_id)
        if len(chunks) != count:
            raise RuntimeError("Could not snapshot the current private document index safely.")
        return chunks

    @staticmethod
    def _restore_index(
        vector_store: VaultVectorStore,
        doc_name: str,
        user_id: str,
        previous_chunks: list[dict[str, Any]],
    ) -> None:
        """Restore the prior passage set after a database transaction fails."""
        if previous_chunks:
            for chunk in previous_chunks:
                chunk["doc_name"] = doc_name
                chunk["user_id"] = user_id
            restored_count = vector_store.replace_document_chunks(previous_chunks, doc_name, user_id)
            if restored_count != len(previous_chunks):
                raise RuntimeError("The previous private document index was not fully restored.")
        else:
            vector_store.delete_document(doc_name, user_id=user_id)

    def _persist_indexed_document(
        self, db: Session, user: User, doc_name: str, file_size: int, chunks: list[dict[str, Any]], existing: Optional[VaultDocument]
    ) -> int:
        """Replace indexed passages and commit matching metadata as one recoverable operation.

        SQL and the vector store cannot share a database transaction. Keep a
        snapshot of the existing passages and compensate the vector write if
        metadata persistence fails, so a failed upload does not silently leave
        the index describing a different document version than the database.
        """
        vector_store = self.vector_store_factory()
        previous_chunks = self._snapshot_index(vector_store, doc_name, user.id)

        for chunk in chunks:
            chunk["user_id"] = user.id
        try:
            indexed_count = vector_store.replace_document_chunks(chunks, doc_name, user.id)
            if indexed_count != len(chunks):
                raise RuntimeError("The replacement document was not fully indexed.")
            if existing:
                existing.file_size = file_size
                existing.chunk_count = indexed_count
                existing.uploaded_at = datetime.now(timezone.utc)
            else:
                db.add(VaultDocument(
                    user_id=user.id,
                    doc_name=doc_name,
                    file_size=file_size,
                    chunk_count=indexed_count,
                ))
            db.commit()
        except Exception:
            db.rollback()
            try:
                self._restore_index(vector_store, doc_name, user.id, previous_chunks)
            except Exception:
                logger.exception(
                    "Could not roll back vector-index replacement for document %s; reindex may be required",
                    doc_name,
                )
            raise
        return indexed_count

    def upload(self, filename: str, content: bytes, user: User, db: Session) -> VaultUploadResult:
        """Save, extract, index, and persist an uploaded document.

        Raises:
            VaultServiceError: Unsupported file, size/capacity violation, or indexing failure.
        """
        safe_filename = self.sanitize_filename(filename)
        suffix = Path(safe_filename).suffix.lower()
        if suffix not in self.SUPPORTED_SUFFIXES:
            raise VaultServiceError(400, "Supported formats are PDF, DOCX, TXT, MD, and CSV.")
        if len(content) > self.max_upload_bytes:
            raise VaultServiceError(413, "File exceeds maximum allowed size of 20 MB.")
        existing = self._check_capacity(db, user, safe_filename)
        target_dir = self.upload_dir / user.id
        target_dir.mkdir(parents=True, exist_ok=True)
        file_path = target_dir / f"{str(uuid.uuid4())[:8]}_{safe_filename}"
        file_path.write_bytes(content)
        try:
            chunks = self._document_chunks(content, suffix, file_path, safe_filename)
            if not chunks:
                raise VaultServiceError(422, "No searchable text could be extracted from this document.")
            indexed_count = self._persist_indexed_document(db, user, safe_filename, len(content), chunks, existing)
        except Exception as exc:
            db.rollback()
            file_path.unlink(missing_ok=True)
            if isinstance(exc, VaultServiceError):
                raise
            logger.exception("Failed to process uploaded document %s for user %s", safe_filename, user.id)
            raise VaultServiceError(500, "Document could not be processed. Please retry.") from exc
        for old_file in target_dir.glob(f"*_{safe_filename}"):
            if old_file != file_path and old_file.is_file():
                old_file.unlink(missing_ok=True)
        return {
            "status": "success",
            "filename": safe_filename,
            "chunks_indexed": indexed_count,
            "message": f"Successfully indexed {indexed_count} knowledge passages into Ada's private corpus.",
        }

    def paste(self, title: str, text: str, user: User, db: Session) -> VaultPasteResult:
        """Store and index user-pasted text as a private plain-text document."""
        if not text.strip():
            raise VaultServiceError(400, "Document text cannot be empty.")
        content = text.encode("utf-8")
        if len(content) > self.max_upload_bytes:
            raise VaultServiceError(413, "Document exceeds maximum allowed size of 20 MB.")
        raw_title = (title or "Pasted_Note").strip().replace(" ", "_")
        clean_title = self.sanitize_filename(raw_title)
        doc_name = clean_title if clean_title.lower().endswith((".txt", ".md")) else f"{clean_title}.txt"
        target_dir = self.upload_dir / user.id
        target_dir.mkdir(parents=True, exist_ok=True)
        file_path = target_dir / f"{str(uuid.uuid4())[:8]}_{doc_name}"
        file_path.write_bytes(content)
        try:
            chunks = process_raw_text_document(text, doc_name=doc_name)
            if not chunks:
                raise VaultServiceError(422, "No searchable text could be extracted from this document.")
            existing = db.query(VaultDocument).filter(
                VaultDocument.user_id == user.id,
                VaultDocument.doc_name == doc_name,
            ).first()
            indexed_count = self._persist_indexed_document(db, user, doc_name, len(content), chunks, existing)
        except Exception as exc:
            db.rollback()
            file_path.unlink(missing_ok=True)
            if isinstance(exc, VaultServiceError):
                raise
            logger.exception("Failed to process pasted document %s for user %s", doc_name, user.id)
            raise VaultServiceError(500, "Document could not be processed. Please retry.") from exc
        for old_file in target_dir.glob(f"*_{doc_name}"):
            if old_file != file_path and old_file.is_file():
                old_file.unlink(missing_ok=True)
        return {"status": "success", "title": title, "doc_name": doc_name, "chunks_indexed": indexed_count}

    def list_documents(self, user: User, db: Session) -> VaultListResult:
        """Return user-owned document metadata with current index availability."""
        documents = db.query(VaultDocument).filter(
            VaultDocument.user_id == user.id
        ).order_by(VaultDocument.uploaded_at.desc()).all()
        try:
            vector_store = self.vector_store_factory()
        except Exception as exc:
            logger.exception("Private source index is unavailable while listing documents for user %s", user.id)
            raise VaultServiceError(503, "Private source index is unavailable. Please retry shortly.") from exc
        try:
            summaries: list[VaultDocumentSummary] = []
            for document in documents:
                chunk_count = vector_store.get_document_chunks_count(document.doc_name, user_id=user.id)
                summaries.append({
                    "doc_name": document.doc_name,
                    "filename": document.doc_name,
                    "size_kb": round((document.file_size or 0) / 1024, 1),
                    "uploaded_at": document.uploaded_at.timestamp() if document.uploaded_at else 0,
                    "chunk_count": chunk_count,
                    "index_status": "searchable" if chunk_count > 0 else "not_indexed",
                })
        except Exception as exc:
            logger.exception("Private source index could not be read while listing documents for user %s", user.id)
            raise VaultServiceError(503, "Private source index could not be read. Please retry shortly.") from exc
        return {"documents": summaries}

    def delete(self, doc_name: str, user: User, db: Session) -> VaultDeleteResult:
        """Delete one owned source from its private index, metadata, and disk."""
        safe_doc = self.sanitize_filename(doc_name)
        self.require_document(safe_doc, user, db)
        try:
            vector_store = self.vector_store_factory()
            previous_chunks = self._snapshot_index(vector_store, safe_doc, user.id)
        except Exception as exc:
            logger.exception("Could not prepare private source deletion for %s", safe_doc)
            raise VaultServiceError(503, "Could not access this source's private index. Please retry shortly.") from exc
        try:
            vector_store.delete_document(safe_doc, user_id=user.id)
            if vector_store.get_document_chunks_count(safe_doc, user_id=user.id):
                raise RuntimeError("Some private passages remain after document deletion.")
            db.query(VaultDocument).filter(
                VaultDocument.user_id == user.id,
                VaultDocument.doc_name == safe_doc,
            ).delete()
            db.commit()
        except Exception as exc:
            db.rollback()
            try:
                self._restore_index(vector_store, safe_doc, user.id, previous_chunks)
            except Exception:
                logger.exception("Could not restore private index after failed deletion of %s", safe_doc)
            logger.exception("Could not delete private document %s for user %s", safe_doc, user.id)
            raise VaultServiceError(503, "Could not delete this source. Please retry shortly.") from exc
        user_dir = self.upload_dir / user.id
        if user_dir.exists():
            try:
                for path in user_dir.glob(f"*_{safe_doc}"):
                    path.unlink(missing_ok=True)
                direct_path = user_dir / safe_doc
                if direct_path.is_file():
                    direct_path.unlink(missing_ok=True)
            except OSError:
                # The database and searchable index are already deleted. File
                # cleanup is best effort and must not report a false API failure.
                logger.exception("Could not remove private source file for %s", safe_doc)
        return {"status": "success", "doc_name": safe_doc}

    def reindex(self, doc_name: str, user: User, db: Session) -> VaultReindexResult:
        """Re-extract a stored source with current chunking rules and replace its index."""
        safe_doc = self.sanitize_filename(doc_name)
        self.require_document(safe_doc, user, db)
        target_file = self.locate_file(safe_doc, user)
        if target_file is None or not target_file.exists():
            raise VaultServiceError(404, f"Document '{safe_doc}' not found on disk.")
        try:
            suffix = target_file.suffix.lower()
            chunks = self._document_chunks(
                target_file.read_bytes(), suffix, target_file, safe_doc
            )
        except Exception as exc:
            logger.exception("Failed to extract document %s for reindexing", safe_doc)
            raise VaultServiceError(422, "Could not extract searchable passages from this document.") from exc
        if not chunks:
            raise VaultServiceError(422, f"No searchable text could be extracted from {safe_doc}.")
        vector_store = self.vector_store_factory()
        try:
            previous_chunks = self._snapshot_index(vector_store, safe_doc, user.id)
        except Exception as exc:
            logger.exception("Could not snapshot private index before reindexing %s", safe_doc)
            raise VaultServiceError(503, "Could not access this source's private index. Please retry shortly.") from exc
        try:
            for chunk in chunks:
                chunk["user_id"] = user.id
            indexed_count = vector_store.replace_document_chunks(chunks, safe_doc, user.id)
            if indexed_count != len(chunks):
                raise RuntimeError("The replacement document was not fully indexed.")
            document = db.query(VaultDocument).filter(
                VaultDocument.user_id == user.id,
                VaultDocument.doc_name == safe_doc,
            ).first()
            if document:
                document.chunk_count = indexed_count
            db.commit()
        except Exception as exc:
            db.rollback()
            try:
                self._restore_index(vector_store, safe_doc, user.id, previous_chunks)
            except Exception:
                logger.exception("Could not restore private index after failed reindex of %s", safe_doc)
            logger.exception("Could not update private source index for document %s", safe_doc)
            raise VaultServiceError(503, "Could not update the private source index. Please retry shortly.") from exc
        return {
            "status": "success",
            "doc_name": safe_doc,
            "chunks_indexed": indexed_count,
            "message": f"Successfully re-indexed {indexed_count} chunks for {safe_doc}.",
        }



    def preview(self, doc_name: str, user: User, db: Session) -> VaultPreviewResult:
        """Return extracted text and indexed passage diagnostics for an owned source."""
        safe_doc = self.sanitize_filename(doc_name)
        self.require_document(safe_doc, user, db)
        target_file = self.locate_file(safe_doc, user)
        try:
            vector_store = self.vector_store_factory()
            chunks_count = vector_store.get_document_chunks_count(safe_doc, user_id=user.id)
            chunks = vector_store.get_document_chunks(safe_doc, user_id=user.id)
        except Exception as exc:
            logger.exception("Could not load indexed passages for document %s", safe_doc)
            raise VaultServiceError(503, "Could not load this document's indexed passages. Please retry shortly.") from exc
        if target_file is None or not target_file.exists():
            if chunks:
                reconstructed_text = "\n\n--- Passage Divider ---\n\n".join(c.get("text", "") for c in chunks)
                return {
                    "doc_name": safe_doc,
                    "filename": safe_doc,
                    "size_kb": round(len(reconstructed_text.encode("utf-8")) / 1024, 1),
                    "page_count": max((c.get("page_number", 1) for c in chunks), default=1),
                    "char_count": len(reconstructed_text),
                    "chunks_indexed": len(chunks),
                    "text": reconstructed_text,
                    "chunks": chunks,
                }
            raise VaultServiceError(404, f"Document '{safe_doc}' not found on disk or vector index.")
        page_count = 1
        if target_file.suffix.lower() == ".pdf":
            try:
                import pymupdf
                document = pymupdf.open(str(target_file))
                try:
                    page_count = len(document)
                    page_texts = [document[index].get_text("text").strip() for index in range(page_count)]
                    extracted_text = "\n\n--- Page Break ---\n\n".join(page_texts)
                finally:
                    document.close()
            except Exception as exc:
                logger.exception("Could not read PDF preview for document %s", safe_doc)
                raise VaultServiceError(422, "Could not read this PDF preview.") from exc
        else:
            try:
                extracted_text = target_file.read_text(encoding="utf-8", errors="ignore")
            except Exception as exc:
                logger.exception("Could not read document preview for %s", safe_doc)
                raise VaultServiceError(422, "Could not read this document preview.") from exc
        return {
            "doc_name": safe_doc,
            "filename": target_file.name,
            "size_kb": round(target_file.stat().st_size / 1024, 1),
            "page_count": page_count,
            "char_count": len(extracted_text),
            "chunks_indexed": chunks_count or len(chunks),
            "text": extracted_text,
            "chunks": chunks,
        }
