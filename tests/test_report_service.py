"""Focused checks for report authorization and response fallbacks."""

import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from engine.database import Base
from engine.models import ResearchSession, ResearchTurn, User
from engine.schemas.reports import ReportListResponse
from engine.services.reports import ReportService, ReportServiceError
from engine.storage.relational_store import RelationalStore


@pytest.fixture
def report_context(tmp_path: Path):
    """Create a private report and all persistence adapters in isolation."""
    database_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(database_engine)
    session_factory = sessionmaker(bind=database_engine, expire_on_commit=False)
    db = session_factory()
    user = User(id="report-owner", email="report@example.test", username="report-owner", password_hash="unused")
    db.add(user)
    db.flush()
    research_session = ResearchSession(user_id=user.id, title="Report service checks")
    db.add(research_session)
    db.flush()
    turn = ResearchTurn(
        id="report-service-check",
        session_id=research_session.id,
        turn_index=1,
        query="A test question",
        status="completed",
    )
    db.add(turn)
    db.commit()
    service = ReportService(
        dossier_dir=tmp_path / "dossiers",
        active_jobs={},
        budget_limits={"token_limit": 10, "cost_limit_usd": 0.5},
    )
    service.dossier_dir.mkdir(parents=True)
    try:
        yield service, db, user, turn
    finally:
        db.close()
        database_engine.dispose()


def test_report_access_is_owner_scoped_and_public_reports_remain_readable(report_context):
    service, db, owner, turn = report_context
    other_user = User(id="another-user", email="other@example.test", username="another-user", password_hash="unused")

    assert service.require_access(turn.id, owner, db).id == turn.id
    assert service.list_reports(owner, db)["reports"][0]["report_id"] == turn.id
    with pytest.raises(ReportServiceError) as error:
        service.require_access(turn.id, other_user, db)
    assert error.value.status_code == 404

    turn.is_public = True
    db.commit()
    assert service.require_access(turn.id, None, db).id == turn.id


def test_completed_report_uses_file_fallback_and_enriches_only_supported_gaps(report_context, monkeypatch):
    service, db, owner, turn = report_context
    monkeypatch.setattr(RelationalStore, "get_full_run_dossier", staticmethod(lambda _run_id: None))
    report_path = service.dossier_dir / f"dossier_{turn.id}.json"
    report_path.write_text(json.dumps({
        "report_id": turn.id,
        "query": turn.query,
        "critic_audit": {"identified_gaps": ["one evidence gap"]},
    }), encoding="utf-8")

    report = service.get_completed_report(turn.id, owner, db)

    assert report["is_public"] is False
    assert report["suggested_inquiries"] == ["Can you investigate this identified gap: one evidence gap?"]


def test_completed_report_overlays_newer_addendum_artifact_over_relational_snapshot(report_context, monkeypatch):
    service, db, owner, turn = report_context
    monkeypatch.setattr(RelationalStore, "get_full_run_dossier", staticmethod(lambda _run_id: {
        "report_id": turn.id,
        "query": turn.query,
        "report_markdown": "Original report",
        "sources": [{"source_id": "S1", "title": "Original source"}],
    }))
    report_path = service.dossier_dir / f"dossier_{turn.id}.json"
    report_path.write_text(json.dumps({
        "report_id": turn.id,
        "query": turn.query,
        "report_markdown": "Original report\n\n## Addendum: New evidence",
        "monograph": "Original report\n\n## Addendum: New evidence",
        "evidence_manifest": [{"source_id": "D1", "title": "New vault evidence"}],
    }), encoding="utf-8")

    report = service.get_completed_report(turn.id, owner, db)

    assert report["report_markdown"].endswith("## Addendum: New evidence")
    assert report["monograph"].endswith("## Addendum: New evidence")
    assert report["evidence_manifest"][0]["source_id"] == "D1"
    assert report["sources"][0]["source_id"] == "S1"


def test_public_toggle_returns_current_share_state(report_context):
    service, db, owner, turn = report_context
    (service.dossier_dir / f"dossier_{turn.id}.json").write_text(
        json.dumps({"report_id": turn.id, "query": turn.query}),
        encoding="utf-8",
    )

    result = service.toggle_public(turn.id, owner, db)

    assert result == {"report_id": turn.id, "is_public": True}
    public_reports = service.list_reports(None, db)["reports"]
    assert [report["report_id"] for report in public_reports] == [turn.id]
    public_response = ReportListResponse.model_validate({"reports": public_reports})
    assert public_response.model_dump(exclude_unset=True) == {"reports": public_reports}
