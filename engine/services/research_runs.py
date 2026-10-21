"""Application orchestration for creating and dispatching research runs."""

from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from engine.models import ResearchSession, ResearchTurn, Run, User, VaultDocument
from engine.services.errors import ResearchRunServiceError
from engine.services.reports import ReportService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResearchRunCommand:
    """Validated input needed to create and dispatch a single research run."""

    query: str
    depth: str
    include_user_docs: bool
    selected_docs: Optional[list[str]]
    clarification_choice: Optional[str]
    custom_angles: Optional[list[str]]
    session_id: Optional[str]
    blocked_domains: Optional[list[str]]


class ResearchRunService:
    """Own session/turn creation, process-local job state, and worker dispatch.

    Queue and worker functions are injected so service behavior can be tested without
    starting Redis, Celery, or FastAPI background tasks.
    """

    def __init__(
        self,
        dossier_dir: Path,
        active_jobs: dict[str, dict[str, Any]],
        budgets: dict[str, int | float],
        *,
        max_active_jobs: int = 30,
        use_celery: bool = False,
        redis_available: Callable[[], Any] = lambda: None,
        set_distributed_job_state: Callable[[str, dict[str, Any]], None] = lambda *_: None,
        celery_dispatch: Optional[Callable[..., Any]] = None,
        background_dispatch: Optional[Callable[[dict[str, Any]], None]] = None,
        condense_turns: Callable[[list[dict[str, Any]]], Any] = lambda turns: turns,
        format_delta_context: Callable[[Any], str] = lambda value: str(value),
        id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
        get_distributed_job_state: Callable[[str], Optional[dict[str, Any]]] = lambda _run_id: None,
        update_run_status: Optional[Callable[..., Any]] = None,
        publish_event: Optional[Callable[..., Any]] = None,
        report_service: Optional[ReportService] = None,
    ) -> None:
        self.dossier_dir = dossier_dir
        self.active_jobs = active_jobs
        self.budgets = dict(budgets)
        self.max_active_jobs = max_active_jobs
        self.use_celery = use_celery
        self.redis_available = redis_available
        self.set_distributed_job_state = set_distributed_job_state
        self.celery_dispatch = celery_dispatch
        self.background_dispatch = background_dispatch
        self.condense_turns = condense_turns
        self.format_delta_context = format_delta_context
        self.id_factory = id_factory
        self.get_distributed_job_state = get_distributed_job_state
        self.update_run_status = update_run_status
        self.publish_event = publish_event
        self.report_service = report_service

    def start(
        self,
        command: ResearchRunCommand,
        user: User,
        db: Session,
        *,
        enqueue_background: Optional[Callable[[dict[str, Any]], None]] = None,
    ) -> dict[str, Any]:
        """Persist the run's session and turn, register status, then dispatch its worker.

        Raises:
            ResearchRunServiceError: Invalid run configuration, unavailable selected documents,
                or a session the user does not own.
        """
        query = command.query.strip()
        if not query:
            raise ResearchRunServiceError(400, "Query cannot be empty.")
        if len(query) > 2000:
            raise ResearchRunServiceError(422, "Query must be 2,000 characters or fewer.")
        if command.depth not in {"quick", "standard", "deep"}:
            raise ResearchRunServiceError(422, "Depth must be quick, standard, or deep.")
        if command.selected_docs and len(command.selected_docs) > 100:
            raise ResearchRunServiceError(422, "Select no more than 100 vault documents.")
        blocked_domains = self._normalize_blocked_domains(command.blocked_domains or [])
        selected_docs = list(command.selected_docs or [])
        if selected_docs:
            owned_docs = {
                document.doc_name
                for document in db.query(VaultDocument).filter(
                    VaultDocument.user_id == user.id,
                    VaultDocument.doc_name.in_(selected_docs),
                ).all()
            }
            if owned_docs != set(selected_docs):
                raise ResearchRunServiceError(404, "One or more selected vault documents were not found.")

        report_id = self.id_factory()
        session_id, delta_context = self._create_turn(command, query, report_id, user, db)
        self._evict_completed_jobs()
        initial_state = {
            "report_id": report_id,
            "session_id": session_id,
            "query": query,
            "depth": command.depth,
            "selected_docs": selected_docs,
            "status": "planning",
            "stage": "Decomposing research query...",
            "progress": 10,
            "result": None,
            "error": None,
            "budgets": dict(self.budgets),
        }
        self.active_jobs[report_id] = initial_state
        self.set_distributed_job_state(report_id, initial_state)
        custom_angles = list(command.custom_angles or [])
        if delta_context:
            custom_angles.append(f"[Delta Context]: {delta_context[:500]}")
        task_kwargs = {
            "report_id": report_id,
            "session_id": session_id,
            "query": query,
            "depth": command.depth,
            "include_user_docs": command.include_user_docs,
            "selected_docs": selected_docs or None,
            "custom_angles": custom_angles or None,
            "clarification_choice": command.clarification_choice,
            "user_id": user.id,
            "blocked_domains": blocked_domains,
        }
        try:
            self._dispatch(task_kwargs, enqueue_background)
        except Exception as exc:
            logger.exception("Unable to dispatch research run %s", report_id)
            initial_state.update({"status": "failed", "stage": "Worker dispatch failed", "error": "Research worker unavailable."})
            self.active_jobs[report_id] = initial_state
            self.set_distributed_job_state(report_id, initial_state)
            db_turn = db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first()
            if db_turn:
                db_turn.status = "failed"
                db_turn.stage = "Worker dispatch failed"
                db.commit()
            raise ResearchRunServiceError(503, "Research worker could not be started. Please retry.") from exc
        return {"report_id": report_id, "session_id": session_id, "query": query, "status": "planning"}

    def cancel(self, report_id: str, user: User, db: Session) -> dict[str, Any]:
        """Cancel a nonterminal run and return its latest known state.

        Access is checked through ``ReportService`` before any state is changed.
        Already completed, failed, or cancelled jobs remain terminal.
        """
        if self.report_service is None:
            raise RuntimeError("ReportService is required for run cancellation.")
        turn = db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first()
        if turn:
            session = db.query(ResearchSession).filter(ResearchSession.id == turn.session_id).first()
            if not session or session.user_id != user.id:
                raise ResearchRunServiceError(404, "Research report not found.")
            turn_or_run: ResearchTurn | Run = turn
        else:
            run = db.query(Run).filter(Run.id == report_id).first()
            if not run or run.user_id != user.id:
                raise ResearchRunServiceError(404, "Research report not found.")
            turn_or_run = run
        cancelled_now = False
        if turn and turn.status not in {"completed", "failed", "cancelled"}:
            turn.status = "cancelled"
            turn.stage = "Investigation cancelled by user."
            db.commit()
            cancelled_now = True

        job = self.get_distributed_job_state(report_id) or self.active_jobs.get(report_id)
        if job and job.get("status") not in {"completed", "failed", "cancelled"}:
            job = {**job, "status": "cancelled", "stage": "Investigation cancelled by user."}
            self.active_jobs[report_id] = job
            self.set_distributed_job_state(report_id, job)
            cancelled_now = True

        if cancelled_now:
            progress = getattr(turn, "progress", 0) if turn else 0
            if self.update_run_status:
                try:
                    self.update_run_status(
                        run_id=report_id, status="cancelled",
                        stage="Investigation cancelled by user.", progress=progress,
                    )
                except Exception as exc:
                    logger.warning("Durable cancellation update failed for %s: %s", report_id, exc)
            if self.publish_event:
                try:
                    self.publish_event(report_id, "run_cancelled", {"report_id": report_id, "reason": "Cancelled by user"})
                except Exception as exc:
                    logger.warning("Cancellation event publish failed for %s: %s", report_id, exc)

        if job:
            return {
                "status": job.get("status"),
                "report_id": report_id,
                "session_id": job.get("session_id"),
                "query": job.get("query"),
                "depth": job.get("depth", "deep"),
                "selected_docs": job.get("selected_docs", []),
            }
        if turn:
            return {
                "status": turn.status, "report_id": report_id,
                "session_id": turn.session_id, "query": turn.query,
            }
        if isinstance(turn_or_run, Run):
            return {"status": turn_or_run.status, "report_id": report_id, "query": turn_or_run.query}
        raise ResearchRunServiceError(404, "Active research job not found.")

    def get_status(self, report_id: str, user: Optional[User], db: Session) -> dict[str, Any]:
        """Resolve status from live state, report artifacts, durable run state, then turn state."""
        if self.report_service is None:
            raise RuntimeError("ReportService is required for run status lookup.")
        turn_or_run = self.report_service.require_access(report_id, user, db)
        artifact_path = getattr(turn_or_run, "report_json_path", None)
        job = self.get_distributed_job_state(report_id) or self.active_jobs.get(report_id)
        if job:
            if job.get("status") == "completed" and not job.get("result") and not self.report_service.has_artifact(report_id, artifact_path):
                job = {
                    **job,
                    "status": "failed",
                    "stage": "Report unavailable",
                    "error": "This investigation is marked complete, but its report artifact is missing.",
                }
            if job.get("result"):
                job = {**job, "result": self.report_service.enrich_inquiries(job["result"])}
            return job

        json_path = self.dossier_dir / f"dossier_{report_id}.json"
        if json_path.exists():
            try:
                with json_path.open("r", encoding="utf-8") as report_file:
                    data = self.report_service.enrich_inquiries(json.load(report_file))
                return {
                    "report_id": report_id, "query": data.get("query"),
                    "status": "completed", "stage": "Completed", "progress": 100, "result": data,
                }
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Unable to read report status artifact %s: %s", report_id, exc)

        try:
            from engine.storage.relational_store import RelationalStore
            run_info = RelationalStore.get_run(report_id)
            if run_info:
                status = run_info.get("status") or getattr(turn_or_run, "status", "unknown")
                stage = run_info.get("stage") or getattr(turn_or_run, "stage", "")
                if status == "completed" and not self.report_service.has_artifact(report_id, artifact_path):
                    status, stage = "failed", "Report unavailable"
                return {
                    "report_id": report_id,
                    "session_id": getattr(turn_or_run, "session_id", None),
                    "query": getattr(turn_or_run, "query", None),
                    "status": status,
                    "stage": stage,
                    "progress": run_info.get("progress", getattr(turn_or_run, "progress", 0)),
                }
        except Exception as exc:
            logger.warning("Durable run status lookup failed for %s: %s", report_id, exc)

        status = getattr(turn_or_run, "status", "unknown")
        stage = getattr(turn_or_run, "stage", "")
        if status == "completed" and not self.report_service.has_artifact(report_id, artifact_path):
            status, stage = "failed", "Report unavailable"
        return {
            "report_id": report_id,
            "session_id": getattr(turn_or_run, "session_id", None),
            "query": getattr(turn_or_run, "query", None),
            "status": status,
            "stage": stage,
            "progress": getattr(turn_or_run, "progress", 0),
        }

    @staticmethod
    def _normalize_blocked_domains(domains: list[str]) -> list[str]:
        """Validate and normalize user-provided blocked domain names."""
        if len(domains) > 50:
            raise ResearchRunServiceError(422, "Invalid blocked domain list.")
        normalized: list[str] = []
        for raw_domain in domains:
            domain = (
                raw_domain.strip().lower().removeprefix("https://").removeprefix("http://")
                .removeprefix("*.").removeprefix("www.").split("/", 1)[0]
            )
            if len(domain) > 253 or not re.fullmatch(
                r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain
            ):
                raise ResearchRunServiceError(422, f"Invalid domain: {raw_domain[:100]}")
            normalized.append(domain)
        return list(dict.fromkeys(normalized))

    def _create_turn(
        self, command: ResearchRunCommand, query: str, report_id: str, user: User, db: Session
    ) -> tuple[Optional[str], str]:
        """Create an owned session if needed, then persist this run as a session turn."""
        session_id = command.session_id
        if session_id:
            session = db.query(ResearchSession).filter(
                ResearchSession.id == session_id, ResearchSession.user_id == user.id
            ).first()
            if not session:
                raise ResearchRunServiceError(404, "Session not found.")
        else:
            session = ResearchSession(user_id=user.id, title=query[:60].strip())
            db.add(session)
            db.commit()
            db.refresh(session)
            session_id = session.id

        prior_turns = (
            db.query(ResearchTurn)
            .filter(ResearchTurn.session_id == session_id)
            .order_by(ResearchTurn.turn_index.asc())
            .all()
        )
        delta_context = ""
        if prior_turns:
            turns_data: list[dict[str, Any]] = []
            for prior in prior_turns:
                item: dict[str, Any] = {"query": prior.query, "executive_title": prior.executive_title, "summary": ""}
                if prior.report_json_path and Path(prior.report_json_path).exists():
                    try:
                        with Path(prior.report_json_path).open("r", encoding="utf-8") as report_file:
                            dossier = json.load(report_file)
                        item["summary"] = dossier.get("summary", "") or dossier.get("executive_title", "")
                        item["sources"] = dossier.get("evidence_manifest", [])
                    except (OSError, json.JSONDecodeError) as exc:
                        logger.debug("Unable to read prior report context %s: %s", prior.id, exc)
                turns_data.append(item)
            delta_context = self.format_delta_context(self.condense_turns(turns_data))

        turn = ResearchTurn(
            id=report_id,
            session_id=session_id,
            turn_index=len(prior_turns) + 1,
            query=query,
            status="planning",
            progress=10,
            stage="Decomposing research query...",
        )
        db.add(turn)
        session.updated_at = datetime.now(timezone.utc)
        db.commit()
        return session_id, delta_context

    def _evict_completed_jobs(self) -> None:
        """Drop oldest process-local terminal entries when the registry reaches its cap."""
        if len(self.active_jobs) < self.max_active_jobs:
            return
        completed = [
            key for key, value in self.active_jobs.items()
            if value.get("status") in {"completed", "failed", "cancelled"}
        ]
        for key in completed[: len(self.active_jobs) - self.max_active_jobs + 1]:
            self.active_jobs.pop(key, None)

    def _dispatch(
        self,
        task_kwargs: dict[str, Any],
        enqueue_background: Optional[Callable[[dict[str, Any]], None]],
    ) -> None:
        """Dispatch through Celery when reachable, otherwise use local background work."""
        if self.use_celery and self.redis_available() is not None and self.celery_dispatch:
            self.celery_dispatch(**task_kwargs)
            return
        background_dispatch = enqueue_background or self.background_dispatch
        if background_dispatch:
            background_dispatch(task_kwargs)
            return
        raise RuntimeError("No research worker dispatch mechanism is configured.")
