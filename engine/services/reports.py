"""Report access, retrieval, and sharing operations.

This service owns report-specific persistence and authorization rules. FastAPI
routes validate path parameters and translate :class:`ReportServiceError` into
HTTP responses.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, MutableMapping, NotRequired, Optional, TypedDict

from sqlalchemy.orm import Session

from engine.models import ResearchSession, ResearchTurn, Run, User
from engine.report_artifacts import has_persisted_report_artifact
from engine.services.errors import ServiceError

logger = logging.getLogger(__name__)


class ReportServiceError(ServiceError):
    """Expected report failure with an HTTP-compatible status and safe detail."""


class ReportListItem(TypedDict):
    """A report history row; public rows intentionally omit private run fields."""

    report_id: str
    session_id: NotRequired[str]
    query: NotRequired[str]
    executive_title: NotRequired[str]
    status: NotRequired[str]
    depth: NotRequired[str]
    progress: NotRequired[int]
    stage: NotRequired[str]
    faithfulness_score: NotRequired[Optional[float]]
    coverage_score: NotRequired[Optional[float]]
    total_sources_cited: NotRequired[int]
    is_public: NotRequired[bool]
    created_at: NotRequired[str]


class ReportListResult(TypedDict):
    """History response shape consumed by dashboard and history screens."""

    reports: list[ReportListItem]


class ReportService:
    """Own report authorization, persistence fallbacks, and share-state changes.

    Args:
        dossier_dir: Directory holding legacy JSON report artifacts.
        active_jobs: Process-local status/result cache, shared with the worker API.
        budget_limits: Public run-budget settings included in inspector responses.
    """

    def __init__(
        self,
        dossier_dir: Path,
        active_jobs: MutableMapping[str, dict[str, Any]],
        budget_limits: dict[str, int | float],
    ) -> None:
        self.dossier_dir = dossier_dir
        self.active_jobs = active_jobs
        self.budget_limits = budget_limits

    def require_access(self, report_id: str, user: Optional[User], db: Session) -> ResearchTurn | Run:
        """Resolve a turn or normalized run while enforcing private-by-default access.

        Raises:
            ReportServiceError: 404 for missing or inaccessible reports so IDs are not disclosed.
        """
        turn = db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first()
        if turn:
            session = db.query(ResearchSession).filter(ResearchSession.id == turn.session_id).first()
            if session and user and session.user_id == user.id:
                return turn
            if turn.is_public:
                return turn

        # Blueprint runs can exist without a corresponding legacy turn.
        run = db.query(Run).filter(Run.id == report_id).first()
        if run and user and run.user_id and run.user_id == user.id:
            return run
        raise ReportServiceError(404, "Research report not found.")

    def has_artifact(self, report_id: str, report_json_path: Optional[str] = None) -> bool:
        """Return whether an in-memory result or persisted report is available."""
        active_job = self.active_jobs.get(report_id)
        if active_job and active_job.get("result"):
            return True
        return has_persisted_report_artifact(report_id, report_json_path)

    @staticmethod
    def enrich_inquiries(data: dict[str, Any]) -> dict[str, Any]:
        """Add only suggestions present in the critic output or identified gaps."""
        if not isinstance(data, dict):
            return data
        if not data.get("suggested_inquiries"):
            critic = data.get("critic_audit") or {}
            suggestions = critic.get("suggested_next_inquiries", []) if isinstance(critic, dict) else []
            gaps = critic.get("identified_gaps", []) if isinstance(critic, dict) else []
            data["suggested_inquiries"] = [
                item for item in suggestions if isinstance(item, str) and item.strip()
            ][:4]
            if not data["suggested_inquiries"]:
                data["suggested_inquiries"] = [
                    f"Can you investigate this identified gap: {gap.strip()}?"
                    for gap in gaps[:3]
                    if isinstance(gap, str) and gap.strip()
                ]
        return data

    def get_completed_report(self, report_id: str, user: Optional[User], db: Session) -> dict[str, Any]:
        """Load normalized report data and overlay the latest dossier artifact.

        The JSON artifact carries report-only additions (for example, follow-up
        evidence) that are not all represented by the normalized run tables.
        Its overlapping report fields must therefore win over an older database
        snapshot, while normalized telemetry and metadata remain available.
        """
        turn = self.require_access(report_id, user, db)
        is_public = bool(getattr(turn, "is_public", False))
        json_path = self.dossier_dir / f"dossier_{report_id}.json"
        try:
            from engine.storage.relational_store import RelationalStore

            relational_dossier = RelationalStore.get_full_run_dossier(report_id)
            if relational_dossier and relational_dossier.get("report_markdown"):
                if json_path.exists():
                    with json_path.open("r", encoding="utf-8") as report_file:
                        file_data = json.load(report_file)
                    if isinstance(file_data, dict):
                        merged = {**relational_dossier, **file_data}
                    else:
                        merged = relational_dossier
                    merged["is_public"] = is_public
                    return self.enrich_inquiries(merged)
                relational_dossier["is_public"] = is_public
                return self.enrich_inquiries(relational_dossier)
        except Exception as exc:
            logger.warning("Relational report read fallback for %s: %s", report_id, exc)

        if not json_path.exists():
            active_job = self.active_jobs.get(report_id)
            if active_job and active_job.get("result"):
                return self.enrich_inquiries(active_job["result"])
            raise ReportServiceError(404, "Dossier not found.")
        with json_path.open("r", encoding="utf-8") as report_file:
            data = json.load(report_file)
        data["is_public"] = is_public
        return self.enrich_inquiries(data)

    def get_run_details(self, run_id: str, user: Optional[User], db: Session) -> dict[str, Any]:
        """Return normalized run details and configured budget limits."""
        self.require_access(run_id, user, db)
        from engine.storage.relational_store import RelationalStore

        dossier = RelationalStore.get_full_run_dossier(run_id)
        if not dossier:
            raise ReportServiceError(404, "Run not found.")
        dossier["budgets"] = dict(self.budget_limits)
        return dossier

    def list_reports(self, user: Optional[User], db: Session) -> ReportListResult:
        """List the current user's history, or only completed public reports."""
        reports: list[ReportListItem] = []
        if user:
            user_turns = (
                db.query(ResearchTurn)
                .join(ResearchSession)
                .filter(ResearchSession.user_id == user.id)
                .order_by(ResearchTurn.created_at.desc())
                .all()
            )
            for turn in user_turns:
                preview_data: dict[str, Any] = {}
                if turn.report_json_path and Path(turn.report_json_path).exists():
                    try:
                        with Path(turn.report_json_path).open("r", encoding="utf-8") as report_file:
                            preview_data = json.load(report_file)
                    except Exception as exc:
                        logger.debug("Unable to read report preview %s: %s", turn.id, exc)
                status = turn.status or "unknown"
                stage = turn.stage or "Status unavailable"
                if status == "completed" and not self.has_artifact(turn.id, turn.report_json_path):
                    status = "failed"
                    stage = "Report unavailable"
                reports.append({
                    "report_id": turn.id,
                    "session_id": turn.session_id,
                    "query": turn.query,
                    "executive_title": turn.executive_title or preview_data.get("executive_title") or turn.query,
                    "status": status,
                    "depth": preview_data.get("depth", "standard"),
                    "progress": turn.progress if turn.progress is not None else 0,
                    "stage": stage,
                    "faithfulness_score": preview_data.get("faithfulness_score"),
                    "coverage_score": preview_data.get("coverage_score"),
                    "total_sources_cited": preview_data.get("total_sources_cited", 0),
                    "is_public": bool(turn.is_public),
                    "created_at": turn.created_at.isoformat() if turn.created_at else datetime.now(timezone.utc).isoformat(),
                })
            return {"reports": reports}

        for report_path in sorted(self.dossier_dir.glob("dossier_*.json"), key=os.path.getmtime, reverse=True):
            try:
                with report_path.open("r", encoding="utf-8") as report_file:
                    report_data = json.load(report_file)
                report_id = report_data.get("report_id")
                public_turn = db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first() if report_id else None
                if not public_turn or not public_turn.is_public or public_turn.status != "completed":
                    continue
                reports.append({
                    "report_id": report_id,
                    "query": report_data.get("query"),
                    "executive_title": report_data.get("executive_title") or report_data.get("query"),
                    "faithfulness_score": report_data.get("faithfulness_score"),
                    "coverage_score": report_data.get("coverage_score"),
                    "total_sources_cited": report_data.get("total_sources_cited", 0),
                    "is_public": True,
                    "created_at": datetime.fromtimestamp(os.path.getmtime(report_path), tz=timezone.utc).isoformat(),
                })
            except Exception as exc:
                logger.debug("Skipping unreadable public report %s: %s", report_path.name, exc)
        return {"reports": reports}

    def toggle_public(self, report_id: str, user: User, db: Session) -> dict[str, Any]:
        """Toggle public read-only access for a turn owned by the authenticated user."""
        turn = db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first()
        if not turn:
            raise ReportServiceError(404, "Turn not found.")
        session = db.query(ResearchSession).filter(ResearchSession.id == turn.session_id).first()
        if not session or session.user_id != user.id:
            raise ReportServiceError(403, "Permission denied.")
        turn.is_public = not turn.is_public
        db.commit()
        return {"report_id": report_id, "is_public": turn.is_public}
