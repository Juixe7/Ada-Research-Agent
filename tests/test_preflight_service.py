"""Checks preflight vault scoping and tenant isolation."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from engine.database import Base
from engine.models import User, VaultDocument
from engine.services.preflight import PreflightCommand, PreflightService, PreflightServiceError


@pytest.fixture
def preflight_context():
    """Create two users with separate private source libraries."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    owner = User(id="preflight-owner", email="preflight@example.test", username="preflight-owner", password_hash="unused")
    other = User(id="preflight-other", email="other-preflight@example.test", username="preflight-other", password_hash="unused")
    db.add_all([owner, other])
    db.flush()
    db.add_all([
        VaultDocument(user_id=owner.id, doc_name="resume.pdf"),
        VaultDocument(user_id=owner.id, doc_name="notes.txt"),
        VaultDocument(user_id=other.id, doc_name="private.pdf"),
    ])
    db.commit()
    try:
        yield db, owner, other
    finally:
        db.close()
        engine.dispose()


def command(**overrides) -> PreflightCommand:
    """Return a valid preflight request with selected docs by default."""
    values = {
        "query": "Research my projects", "include_user_docs": True,
        "selected_docs": ["resume.pdf"], "user_modification": None,
    }
    values.update(overrides)
    return PreflightCommand(**values)


def test_preflight_passes_only_explicit_owned_documents(preflight_context):
    db, owner, _ = preflight_context
    calls = []
    service = PreflightService(evaluator=lambda **kwargs: calls.append(kwargs) or {"status": "ready"})

    result = service.evaluate(command(), owner, db)

    assert result == {"status": "ready"}
    assert calls[0]["vault_doc_names"] == ["resume.pdf"]
    assert calls[0]["user_id"] == owner.id


def test_preflight_rejects_another_users_selected_document(preflight_context):
    db, owner, _ = preflight_context
    service = PreflightService(evaluator=lambda **_: pytest.fail("invalid source scope must not invoke evaluator"))

    with pytest.raises(PreflightServiceError) as error:
        service.evaluate(command(selected_docs=["private.pdf"]), owner, db)

    assert error.value.status_code == 404


def test_preflight_uses_all_owned_documents_when_none_are_selected(preflight_context):
    db, owner, _ = preflight_context
    calls = []
    service = PreflightService(evaluator=lambda **kwargs: calls.append(kwargs) or {})

    service.evaluate(command(selected_docs=None), owner, db)

    assert set(calls[0]["vault_doc_names"]) == {"resume.pdf", "notes.txt"}


def test_preflight_does_not_resolve_private_docs_for_anonymous_user(preflight_context):
    db, _, _ = preflight_context
    calls = []
    service = PreflightService(evaluator=lambda **kwargs: calls.append(kwargs) or {})

    service.evaluate(command(), None, db)

    assert calls[0]["vault_doc_names"] is None
    assert calls[0]["user_id"] is None
