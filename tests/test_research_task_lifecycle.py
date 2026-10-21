"""Check worker status invariants across incomplete results and DB commit errors."""

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from engine.database import Base
from engine.models import ResearchSession, ResearchTurn, User
from engine.tasks import run_research_pipeline_task


@pytest.fixture
def task_context(monkeypatch, tmp_path: Path):
    """Provide an isolated turn, worker state store, and patchable task adapters."""
    db_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(db_engine)
    session_factory = sessionmaker(bind=db_engine, expire_on_commit=False)
    db = session_factory()
    user = User(id="worker-owner", email="worker@example.test", username="worker-owner", password_hash="unused")
    session = ResearchSession(user_id=user.id, title="Worker lifecycle")
    db.add_all([user, session])
    db.flush()
    turn = ResearchTurn(
        id="worker-run", session_id=session.id, turn_index=1,
        query="Explain the research worker lifecycle", status="planning",
    )
    db.add(turn)
    db.commit()

    job_state = {turn.id: {"report_id": turn.id, "status": "planning"}}
    run_statuses = []
    events = []
    monkeypatch.setattr("engine.database.SessionLocal", session_factory)
    monkeypatch.setattr("engine.tasks.get_job_state", lambda run_id: job_state.get(run_id))
    monkeypatch.setattr("engine.tasks.set_job_state", lambda run_id, value: job_state.__setitem__(run_id, dict(value)))
    monkeypatch.setattr(
        "engine.storage.relational_store.RelationalStore.update_run_status",
        staticmethod(lambda **kwargs: run_statuses.append(kwargs)),
    )
    monkeypatch.setattr(
        "engine.events.publish_event",
        lambda run_id, event_type, _data=None: events.append((event_type, job_state[run_id]["status"])),
    )

    yield db, turn.id, session.id, job_state, session_factory, run_statuses, events

    db.close()
    db_engine.dispose()


def _run_task(report_id: str, session_id: str):
    return run_research_pipeline_task.run(
        report_id=report_id,
        session_id=session_id,
        query="Explain the research worker lifecycle",
        depth="standard",
        include_user_docs=False,
    )


def test_incomplete_pipeline_result_is_not_marked_completed(task_context, monkeypatch):
    db, report_id, session_id, job_state, _, run_statuses, events = task_context
    monkeypatch.setattr(
        "engine.tasks.run_research_pipeline_sync",
        lambda **_kwargs: {"report_markdown": "", "export_paths": {}},
    )

    result = _run_task(report_id, session_id)

    db.expire_all()
    turn = db.query(ResearchTurn).filter_by(id=report_id).one()
    assert result["status"] == "failed"
    assert "Research pipeline returned no report content" not in result["error"]
    assert job_state[report_id]["status"] == "failed"
    assert turn.status == "failed"
    assert not any(status["status"] == "completed" for status in run_statuses)
    assert ("run_completed", "completed") not in events
    assert ("run_failed", "failed") in events


def test_valid_report_is_persisted_before_completion_state(task_context, monkeypatch):
    db, report_id, session_id, job_state, _, run_statuses, events = task_context
    monkeypatch.setattr(
        "engine.tasks.run_research_pipeline_sync",
        lambda **_kwargs: {
            "report_markdown": "## Evidence-backed report",
            "executive_title": "Research worker lifecycle",
            "export_paths": {"json_path": str(Path("dossiers") / f"dossier_{report_id}.json")},
        },
    )

    result = _run_task(report_id, session_id)

    db.expire_all()
    turn = db.query(ResearchTurn).filter_by(id=report_id).one()
    assert result["status"] == "completed"
    assert turn.status == "completed"
    assert turn.progress == 100
    assert job_state[report_id]["status"] == "completed"
    assert run_statuses[-1]["status"] == "completed"
    assert ("run_completed", "completed") in events


def test_completion_commit_failure_rolls_back_then_persists_failure(task_context, monkeypatch):
    db, report_id, session_id, job_state, session_factory, run_statuses, events = task_context
    monkeypatch.setattr(
        "engine.tasks.run_research_pipeline_sync",
        lambda **_kwargs: {
            "report_markdown": "## Evidence-backed report",
            "executive_title": "Research worker lifecycle",
            "export_paths": {"json_path": str(Path("dossiers") / f"dossier_{report_id}.json")},
        },
    )

    class FailFirstCommit:
        """Simulate a transient commit failure, then allow recovery persistence."""

        def __init__(self, wrapped):
            self.wrapped = wrapped
            self.commit_count = 0

        def commit(self):
            self.commit_count += 1
            if self.commit_count == 1:
                raise RuntimeError("synthetic database commit detail")
            self.wrapped.commit()

        def __getattr__(self, name):
            return getattr(self.wrapped, name)

    task_session = FailFirstCommit(session_factory())
    monkeypatch.setattr("engine.database.SessionLocal", lambda: task_session)

    result = _run_task(report_id, session_id)

    db.expire_all()
    turn = db.query(ResearchTurn).filter_by(id=report_id).one()
    assert result["status"] == "failed"
    assert "synthetic database commit detail" not in result["error"]
    assert job_state[report_id]["status"] == "failed"
    assert turn.status == "failed"
    assert task_session.commit_count == 2
    assert not any(status["status"] == "completed" for status in run_statuses)
    assert ("run_completed", "completed") not in events
    assert ("run_failed", "failed") in events
