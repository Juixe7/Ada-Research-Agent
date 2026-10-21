"""Checks run creation, session ownership, queue fallback, and failure reporting."""

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from engine.database import Base
from engine.models import ResearchSession, ResearchTurn, User
from engine.services.errors import ResearchRunServiceError
from engine.services.reports import ReportService
from engine.services.research_runs import ResearchRunCommand, ResearchRunService


@pytest.fixture
def run_context(tmp_path: Path):
    """Create an isolated owner and database for research-run orchestration tests."""
    db_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(db_engine)
    db = sessionmaker(bind=db_engine, expire_on_commit=False)()
    user = User(id="run-owner", email="run@example.test", username="run-owner", password_hash="unused")
    db.add(user)
    db.commit()
    state: dict[str, dict] = {}
    scheduled: list[dict] = []
    events: list[tuple] = []
    dossier_dir = tmp_path / "dossiers"
    dossier_dir.mkdir()
    reports = ReportService(dossier_dir, state, {})
    service = ResearchRunService(
        dossier_dir=dossier_dir,
        active_jobs=state,
        budgets={"token_limit": 100, "cost_limit_usd": 1.0},
        set_distributed_job_state=lambda run_id, job: state.__setitem__(f"distributed:{run_id}", job),
        get_distributed_job_state=lambda run_id: state.get(f"distributed:{run_id}"),
        update_run_status=lambda **kwargs: state.setdefault("durable_status", kwargs),
        publish_event=lambda *args: events.append(args),
        report_service=reports,
        background_dispatch=scheduled.append,
        id_factory=lambda: "new-run-id",
    )
    try:
        yield service, db, user, scheduled, state, events
    finally:
        db.close()
        db_engine.dispose()


def command(**overrides) -> ResearchRunCommand:
    """Create a valid run command with optional test-specific overrides."""
    values = {
        "query": "  Explain the system design  ", "depth": "standard",
        "include_user_docs": True, "selected_docs": None, "clarification_choice": None,
        "custom_angles": None, "session_id": None, "blocked_domains": ["https://www.example.com/news"],
    }
    values.update(overrides)
    return ResearchRunCommand(**values)


def test_start_creates_session_registers_job_and_dispatches_normalized_args(run_context):
    service, db, user, scheduled, state, _ = run_context

    result = service.start(command(), user, db)

    assert result["report_id"] == "new-run-id"
    assert result["query"] == "Explain the system design"
    turn = db.query(ResearchTurn).filter_by(id="new-run-id").one()
    session = db.query(ResearchSession).filter_by(id=turn.session_id).one()
    assert session.user_id == user.id
    assert turn.status == "planning"
    assert state["new-run-id"]["status"] == "planning"
    assert scheduled[0]["blocked_domains"] == ["example.com"]
    assert scheduled[0]["session_id"] == session.id


def test_start_rejects_session_owned_by_another_user(run_context):
    service, db, user, scheduled, _, _ = run_context
    foreign_user = User(id="other-run-owner", email="other-run@example.test", username="other-run-owner", password_hash="unused")
    db.add(foreign_user)
    db.flush()
    foreign_session = ResearchSession(user_id=foreign_user.id, title="Private")
    db.add(foreign_session)
    db.commit()

    with pytest.raises(ResearchRunServiceError) as error:
        service.start(command(session_id=foreign_session.id), user, db)

    assert error.value.status_code == 404
    assert scheduled == []


def test_dispatch_failure_marks_durable_turn_failed(run_context):
    service, db, user, _, state, _ = run_context
    service.background_dispatch = lambda _kwargs: (_ for _ in ()).throw(RuntimeError("queue unavailable"))

    with pytest.raises(ResearchRunServiceError) as error:
        service.start(command(), user, db)

    assert error.value.status_code == 503
    assert state["new-run-id"]["status"] == "failed"
    turn = db.query(ResearchTurn).filter_by(id="new-run-id").one()
    assert turn.status == "failed"


def test_cancel_updates_durable_and_live_state_and_emits_event(run_context):
    service, db, user, _, state, events = run_context
    service.start(command(), user, db)

    result = service.cancel("new-run-id", user, db)

    assert result["status"] == "cancelled"
    assert state["new-run-id"]["status"] == "cancelled"
    assert state["durable_status"]["status"] == "cancelled"
    assert events[0][1] == "run_cancelled"
    assert db.query(ResearchTurn).filter_by(id="new-run-id").one().status == "cancelled"


def test_cancel_does_not_allow_another_user_to_cancel_a_public_report(run_context):
    service, db, owner, _, _, _ = run_context
    service.start(command(), owner, db)
    turn = db.query(ResearchTurn).filter_by(id="new-run-id").one()
    turn.is_public = True
    other_user = User(id="public-viewer", email="viewer@example.test", username="public-viewer", password_hash="unused")
    db.add(other_user)
    db.commit()

    with pytest.raises(ResearchRunServiceError) as error:
        service.cancel("new-run-id", other_user, db)

    assert error.value.status_code == 404
    assert turn.status == "planning"


def test_status_prefers_live_state_and_keeps_owner_scope(run_context):
    service, db, user, _, state, _ = run_context
    service.start(command(), user, db)
    state["new-run-id"].update({"status": "running", "progress": 42})

    result = service.get_status("new-run-id", user, db)

    assert result["status"] == "running"
    assert result["progress"] == 42


def test_status_uses_persisted_artifact_after_live_state_expires(run_context):
    import json

    service, db, user, _, state, _ = run_context
    service.start(command(), user, db)
    (service.dossier_dir / "dossier_new-run-id.json").write_text(
        json.dumps({"query": "Persisted query", "report_id": "new-run-id"}), encoding="utf-8"
    )
    state.clear()

    result = service.get_status("new-run-id", user, db)

    assert result["status"] == "completed"
    assert result["result"]["query"] == "Persisted query"
