"""Focused behavior checks for the vault service boundary."""

from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from engine.database import Base
from engine.models import User, VaultDocument
from engine.schemas.vault import (
    VaultDeleteResponse,
    VaultListResponse,
    VaultPasteResponse,
    VaultPreviewResponse,
    VaultReindexResponse,
    VaultUploadResponse,
)
from engine.services.vault import VaultService, VaultServiceError


class MemoryVectorStore:
    """Small in-memory adapter for exercising vault lifecycle behavior."""

    def __init__(self) -> None:
        self.documents: dict[tuple[str, str], list[dict]] = {}

    def replace_document_chunks(self, chunks: list[dict], doc_name: str, user_id: str) -> int:
        self.documents[(user_id, doc_name)] = [dict(chunk) for chunk in chunks]
        return len(chunks)

    def get_document_chunks_count(self, doc_name: str, user_id: str | None = None) -> int:
        return len(self.documents.get((user_id or "", doc_name), []))

    def get_document_chunks(self, doc_name: str, limit: int = 100, user_id: str | None = None) -> list[dict]:
        return self.documents.get((user_id or "", doc_name), [])[:limit]

    def delete_document(self, doc_name: str, user_id: str | None = None) -> bool:
        return self.documents.pop((user_id or "", doc_name), None) is not None


@pytest.fixture
def vault_context(tmp_path: Path):
    """Provide an isolated SQL database, vector adapter, and vault directory."""
    database_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(database_engine)
    session_factory = sessionmaker(bind=database_engine, expire_on_commit=False)
    db = session_factory()
    user = User(id="vault-owner", email="owner@example.test", username="vault-owner", password_hash="unused")
    db.add(user)
    db.commit()
    vector_store = MemoryVectorStore()
    service = VaultService(
        upload_dir=tmp_path / "uploads",
        vector_store_factory=lambda: vector_store,
    )
    try:
        yield service, vector_store, db, user, tmp_path
    finally:
        db.close()
        database_engine.dispose()


def test_paste_preview_reindex_and_delete_preserve_vault_contract(vault_context):
    service, vector_store, db, user, tmp_path = vault_context

    result = service.paste("Research Note", "A useful note with evidence about battery testing.", user, db)
    doc_name = result["doc_name"]

    VaultPasteResponse.model_validate(result)
    assert result["status"] == "success"
    listing = service.list_documents(user, db)
    VaultListResponse.model_validate(listing)
    assert listing["documents"][0]["index_status"] == "searchable"
    preview = service.preview(doc_name, user, db)
    VaultPreviewResponse.model_validate(preview)
    assert "battery testing" in preview["text"]
    reindex_result = service.reindex(doc_name, user, db)
    VaultReindexResponse.model_validate(reindex_result)
    assert reindex_result["chunks_indexed"] == result["chunks_indexed"]
    delete_result = service.delete(doc_name, user, db)
    VaultDeleteResponse.model_validate(delete_result)
    assert delete_result == {"status": "success", "doc_name": doc_name}
    assert service.list_documents(user, db)["documents"] == []
    assert not list((tmp_path / "uploads" / user.id).glob("*"))
    assert (user.id, doc_name) not in vector_store.documents


def test_vault_service_does_not_disclose_another_owners_document(vault_context):
    service, _, db, owner, _ = vault_context
    service.paste("Private Note", "The owner-only source body.", owner, db)

    other_user = SimpleNamespace(id="different-owner")
    with pytest.raises(VaultServiceError) as error:
        service.preview("Private_Note.txt", other_user, db)

    assert error.value.status_code == 404
    assert error.value.detail == "Document not found."


def test_file_upload_returns_the_documented_response_shape(vault_context):
    service, _, db, user, _ = vault_context

    result = service.upload(
        "Uploaded Evidence.txt",
        b"A source file with searchable evidence about thermal performance.",
        user,
        db,
    )

    VaultUploadResponse.model_validate(result)
    assert result["filename"] == "Uploaded Evidence.txt"
    assert result["chunks_indexed"] > 0


def test_upload_hides_index_adapter_errors_from_api_response(vault_context, caplog):
    service, _, db, user, tmp_path = vault_context

    class BrokenVectorStore(MemoryVectorStore):
        def replace_document_chunks(self, chunks: list[dict], doc_name: str, user_id: str) -> int:
            raise RuntimeError("private adapter detail")

    service.vector_store_factory = BrokenVectorStore

    with pytest.raises(VaultServiceError) as error:
        service.upload("Sensitive.txt", b"A valid document passage.", user, db)

    assert error.value.status_code == 500
    assert error.value.detail == "Document could not be processed. Please retry."
    assert "private adapter detail" not in error.value.detail
    assert "private adapter detail" in caplog.text
    assert not list((tmp_path / "uploads" / user.id).glob("*"))


def test_upload_compensates_vector_index_when_metadata_commit_fails(vault_context):
    service, vector_store, db, user, _ = vault_context
    commit = db.commit

    def fail_once() -> None:
        db.commit = commit
        raise RuntimeError("simulated database outage")

    db.commit = fail_once

    with pytest.raises(VaultServiceError) as error:
        service.upload("Uncommitted.txt", b"This passage must not remain indexed.", user, db)

    assert error.value.status_code == 500
    assert vector_store.get_document_chunks_count("Uncommitted.txt", user_id=user.id) == 0
    assert db.query(VaultDocument).filter(
        VaultDocument.user_id == user.id,
        VaultDocument.doc_name == "Uncommitted.txt",
    ).first() is None


def test_failed_replacement_restores_the_previous_indexed_passages(vault_context):
    service, vector_store, db, user, _ = vault_context
    service.upload("Versioned.txt", b"The original passage should remain available.", user, db)
    original_chunks = vector_store.get_document_chunks("Versioned.txt", user_id=user.id)
    commit = db.commit

    def fail_once() -> None:
        db.commit = commit
        raise RuntimeError("simulated database outage")

    db.commit = fail_once

    with pytest.raises(VaultServiceError):
        service.upload("Versioned.txt", b"The replacement must be rolled back.", user, db)

    restored_chunks = vector_store.get_document_chunks("Versioned.txt", user_id=user.id)
    assert [chunk["text"] for chunk in restored_chunks] == [chunk["text"] for chunk in original_chunks]
    assert db.query(VaultDocument).filter(
        VaultDocument.user_id == user.id,
        VaultDocument.doc_name == "Versioned.txt",
    ).one().chunk_count == len(original_chunks)


def test_failed_delete_restores_index_and_keeps_document_metadata(vault_context):
    service, vector_store, db, user, tmp_path = vault_context
    result = service.paste("Keep Me", "These passages must survive a failed deletion.", user, db)
    doc_name = result["doc_name"]
    previous_chunks = vector_store.get_document_chunks(doc_name, user_id=user.id)
    commit = db.commit

    def fail_once() -> None:
        db.commit = commit
        raise RuntimeError("simulated database outage")

    db.commit = fail_once

    with pytest.raises(VaultServiceError):
        service.delete(doc_name, user, db)

    assert vector_store.get_document_chunks(doc_name, user_id=user.id) == previous_chunks
    assert db.query(VaultDocument).filter(
        VaultDocument.user_id == user.id,
        VaultDocument.doc_name == doc_name,
    ).one()
    assert list((tmp_path / "uploads" / user.id).glob(f"*_{doc_name}"))


def test_failed_reindex_restores_previous_passages(vault_context):
    service, vector_store, db, user, _ = vault_context
    service.paste("Stable Note", "The old indexed passage is retained.", user, db)
    doc_name = "Stable_Note.txt"
    previous_chunks = vector_store.get_document_chunks(doc_name, user_id=user.id)
    file_path = service.locate_file(doc_name, user)
    assert file_path is not None
    file_path.write_text("A changed passage that should not replace the old index.", encoding="utf-8")
    commit = db.commit

    def fail_once() -> None:
        db.commit = commit
        raise RuntimeError("simulated database outage")

    db.commit = fail_once

    with pytest.raises(VaultServiceError):
        service.reindex(doc_name, user, db)

    assert vector_store.get_document_chunks(doc_name, user_id=user.id) == previous_chunks
    assert db.query(VaultDocument).filter(
        VaultDocument.user_id == user.id,
        VaultDocument.doc_name == doc_name,
    ).one().chunk_count == len(previous_chunks)
