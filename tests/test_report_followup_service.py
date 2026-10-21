"""Checks that report follow-up answers stay scoped to persisted evidence."""

import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from engine.database import Base
from engine.models import ResearchSession, ResearchTurn, User
from engine.services.report_followups import ReportFollowupService
from engine.services.errors import ReportFollowupServiceError
from engine.services.reports import ReportService


@pytest.fixture
def followup_context(tmp_path: Path):
    """Build a private report with saved evidence in isolated storage."""
    db_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(db_engine)
    db = sessionmaker(bind=db_engine, expire_on_commit=False)()
    user = User(id="followup-owner", email="followup@example.test", username="followup-owner", password_hash="unused")
    db.add(user)
    db.flush()
    session = ResearchSession(user_id=user.id, title="Follow-up service checks")
    db.add(session)
    db.flush()
    turn = ResearchTurn(id="followup-report", session_id=session.id, turn_index=1, query="How does the system work?", status="completed")
    db.add(turn)
    db.commit()
    dossier_dir = tmp_path / "dossiers"
    dossier_dir.mkdir()
    (dossier_dir / f"dossier_{turn.id}.json").write_text(json.dumps({
        "report_id": turn.id,
        "query": turn.query,
        "evidence_manifest": [{
            "source_id": "S1", "source_type": "web", "title": "Official design",
            "text": "The system stores each order in a durable ledger before confirming payment.",
        }],
        "citation_index": {"S1": {"snippet": "The system stores each order in a durable ledger."}},
    }), encoding="utf-8")
    reports = ReportService(dossier_dir, {}, {})
    try:
        yield dossier_dir, reports, db, user, turn
    finally:
        db.close()
        db_engine.dispose()


def test_evidence_followup_returns_verified_citations(followup_context):
    dossier_dir, reports, db, user, turn = followup_context
    service = ReportFollowupService(
        dossier_dir,
        reports,
        llm=lambda **_: "Orders are stored in a durable ledger before payment is confirmed. [S1]",
        claim_verifier=lambda claims, _evidence, **_: {claim["claim_id"]: {"verdict": "supported", "reason": "Directly stated."} for claim in claims},
    )

    result = service.answer_from_evidence(turn.id, "When is payment confirmed?", "", user, db)

    assert result["status"] == "success"
    assert result["citations"] == ["S1"]
    assert result["verification_status"] == "verified"


def test_evidence_followup_never_calls_llm_when_no_passage_matches(followup_context):
    dossier_dir, reports, db, user, turn = followup_context
    service = ReportFollowupService(dossier_dir, reports, llm=lambda **_: pytest.fail("LLM must not run without a matching passage"))

    result = service.answer_from_evidence(turn.id, "What is the weather on Mars?", "", user, db)

    assert result["status"] == "insufficient_evidence"
    assert result["verification_status"] == "not_run"
    assert result["citations"] == []


def test_source_question_uses_saved_passage_and_falls_back_to_excerpt(followup_context):
    dossier_dir, reports, db, user, turn = followup_context
    service = ReportFollowupService(dossier_dir, reports, llm=lambda **_: None)

    result = service.answer_source_question(turn.id, "S1", "What happens before confirmation?", user, db)

    assert result["status"] == "success"
    assert result["answer"].startswith("Source [S1] excerpt:")


def test_source_question_rejects_missing_source(followup_context):
    dossier_dir, reports, db, user, turn = followup_context
    service = ReportFollowupService(dossier_dir, reports)

    with pytest.raises(ReportFollowupServiceError) as error:
        service.answer_source_question(turn.id, "S99", "Explain it", user, db)

    assert error.value.status_code == 404


def test_addendum_persists_new_evidence_and_report_atomically(followup_context, monkeypatch):
    dossier_dir, reports, db, user, turn = followup_context
    persisted_markdown = []
    monkeypatch.setattr(
        "engine.storage.relational_store.RelationalStore.update_report_markdown",
        staticmethod(lambda report_id, markdown: persisted_markdown.append((report_id, markdown)) or True),
    )
    service = ReportFollowupService(
        dossier_dir,
        reports,
        llm=lambda **_: "The service retries failed writes. [S2]",
        citation_grounder=lambda content, _evidence: {
            "cleaned_markdown": content,
            "faithfulness_score": 1.0,
            "total_citations_count": 1,
            "hallucinated_ids": [],
        },
        sub_research=lambda *_args, **_kwargs: {"evidence": [{
            "source_type": "web",
            "title": "Reliability guide",
            "url": "https://example.test/reliability",
            "domain": "example.test",
            "text": "The service retries failed writes before returning an error.",
            "quote": "The service retries failed writes before returning an error.",
        }]},
    )

    result = service.investigate_addendum(turn.id, "How are failed writes handled?", "", "", user, db)

    saved = json.loads((dossier_dir / f"dossier_{turn.id}.json").read_text(encoding="utf-8"))
    assert result["new_sources_count"] == 1
    assert saved["evidence_manifest"][-1]["source_id"] == "S2"
    assert "The service retries failed writes. [S2]" in saved["report_markdown"]
    assert persisted_markdown == [(turn.id, saved["report_markdown"])]
    assert not list(dossier_dir.glob("*.tmp"))
