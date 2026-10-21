"""HTTP response schemas for source-library operations."""

from typing import Any, Literal

from pydantic import BaseModel


class VaultDocumentSummaryResponse(BaseModel):
    """Searchability and metadata shown for one private library document."""

    doc_name: str
    filename: str
    size_kb: float
    uploaded_at: float
    chunk_count: int
    index_status: Literal["searchable", "not_indexed"]


class VaultListResponse(BaseModel):
    """List of documents owned by the current user."""

    documents: list[VaultDocumentSummaryResponse]


class VaultUploadResponse(BaseModel):
    """Result of an uploaded document being indexed."""

    status: Literal["success"]
    filename: str
    chunks_indexed: int
    message: str


class VaultPasteResponse(BaseModel):
    """Result of pasted text being stored as a private source."""

    status: Literal["success"]
    title: str
    doc_name: str
    chunks_indexed: int


class VaultDeleteResponse(BaseModel):
    """Confirmation that an owned source was deleted."""

    status: Literal["success"]
    doc_name: str


class VaultReindexResponse(BaseModel):
    """Result of rebuilding a document's searchable passages."""

    status: Literal["success"]
    doc_name: str
    chunks_indexed: int
    message: str


class VaultPreviewResponse(BaseModel):
    """Extracted document content and the passages currently in the index."""

    doc_name: str
    filename: str
    size_kb: float
    page_count: int
    char_count: int
    chunks_indexed: int
    text: str
    chunks: list[dict[str, Any]]
