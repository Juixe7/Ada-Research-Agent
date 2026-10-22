"""Research-session and turn lifecycle operations.

This service owns session access rules, database mutations, and report-artifact
handling. The FastAPI router is responsible only for request validation and
translating expected service failures into HTTP responses.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from engine.models import ResearchSession, ResearchTurn, User
from engine.report_artifacts import has_persisted_report_artifact
from engine.services.errors import ServiceError

logger = logging.getLogger(__name__)


class ResearchSessionError(ServiceError):
    """Expected session failure with an HTTP-compatible status and detail."""


class ResearchSessionService:
    """Own session access, turn summaries, and compiled report exports.

    Args:
        artifact_checker: Function that confirms a completed turn has a report.
    """

    def __init__(
        self,
        artifact_checker: Callable[[str, Optional[str]], bool] = has_persisted_report_artifact,
    ) -> None:
        self.artifact_checker = artifact_checker

    def list_sessions(self, user: User, db: Session) -> dict[str, Any]:
        """List an owner's sessions with latest-turn status and timestamps."""
        sessions = (
            db.query(ResearchSession)
            .filter(ResearchSession.user_id == user.id)
            .order_by(ResearchSession.updated_at.desc())
            .all()
        )
        result = []
        for session in sessions:
            turns = (
                db.query(ResearchTurn)
                .filter(ResearchTurn.session_id == session.id)
                .order_by(ResearchTurn.turn_index.asc())
                .all()
            )
            latest_turn = turns[-1] if turns else None
            latest_status = latest_turn.status if latest_turn else "empty"
            if latest_turn and latest_status == "completed" and not self.artifact_checker(
                latest_turn.id, latest_turn.report_json_path
            ):
                latest_status = "failed"
            result.append({
                "id": session.id,
                "title": session.title,
                "turn_count": len(turns),
                "latest_query": latest_turn.query if latest_turn else "",
                "latest_status": latest_status,
                "created_at": session.created_at,
                "updated_at": session.updated_at,
            })
        return {"sessions": result}

    @staticmethod
    def create_session(title: str, user: User, db: Session) -> dict[str, Any]:
        """Create an empty, titled research session for its owner."""
        session = ResearchSession(user_id=user.id, title=title.strip())
        db.add(session)
        db.commit()
        db.refresh(session)
        return {"id": session.id, "title": session.title, "created_at": session.created_at}

    def get_session_details(
        self, session_id: str, user: Optional[User], db: Session
    ) -> dict[str, Any]:
        """Return a session and visible turn summaries for its owner or public viewers."""
        session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
        if session is None:
            raise ResearchSessionError(404, "Research session not found.")

        is_owner = bool(user and session.user_id == user.id)
        self._require_public_access(session_id, is_owner, db)
        turns_query = (
            db.query(ResearchTurn)
            .filter(ResearchTurn.session_id == session_id)
            .order_by(ResearchTurn.turn_index.asc())
        )
        if not is_owner:
            turns_query = turns_query.filter(ResearchTurn.is_public.is_(True))

        turns_data = []
        for turn in turns_query.all():
            preview = self._read_report_preview(turn.report_json_path)
            status = turn.status
            stage = turn.stage
            if status == "completed" and not self.artifact_checker(turn.id, turn.report_json_path):
                status = "failed"
                stage = "Report unavailable"
            turns_data.append({
                "id": turn.id,
                "turn_index": turn.turn_index,
                "query": turn.query,
                "executive_title": turn.executive_title or (preview or {}).get("executive_title"),
                "status": status,
                "progress": turn.progress,
                "stage": stage,
                "is_public": turn.is_public,
                "created_at": turn.created_at,
                "report_id": turn.id,
                "total_sources": (preview or {}).get("total_sources_cited", 0),
            })

        return {
            "id": session.id,
            "title": session.title if is_owner else "Shared research session",
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "turns": turns_data,
        }

    @staticmethod
    def update_session(session_id: str, title: str, user: User, db: Session) -> dict[str, str]:
        """Replace the title of an owned session."""
        session = db.query(ResearchSession).filter(
            ResearchSession.id == session_id,
            ResearchSession.user_id == user.id,
        ).first()
        if session is None:
            raise ResearchSessionError(404, "Session not found or access denied.")

        session.title = title.strip()
        session.updated_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "ok", "id": session.id, "title": session.title}

    def delete_session(self, session_id: str, user: User, db: Session) -> dict[str, str]:
        """Delete an owned session, its turns, and their local report files."""
        session = self._owned_session(session_id, user, db)
        turns = db.query(ResearchTurn).filter(ResearchTurn.session_id == session_id).all()
        for turn in turns:
            self._remove_report_files(turn.report_json_path)
        db.delete(session)
        db.commit()
        return {"status": "ok", "message": "Session deleted successfully."}

    def delete_session_turn(
        self, session_id: str, turn_id: str, user: User, db: Session
    ) -> dict[str, str]:
        """Delete one turn and its local report files from an owned session."""
        self._owned_session(session_id, user, db)
        turn = db.query(ResearchTurn).filter(
            ResearchTurn.id == turn_id,
            ResearchTurn.session_id == session_id,
        ).first()
        if turn is None:
            raise ResearchSessionError(404, "Turn not found.")
        self._remove_report_files(turn.report_json_path)
        db.delete(turn)
        db.commit()
        return {"status": "ok", "message": "Turn removed from session."}

    def export_session(self, session_id: str, user: Optional[User], db: Session) -> dict[str, Any]:
        """Compile the visible turns into Markdown without exposing private metadata."""
        session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
        if session is None:
            raise ResearchSessionError(404, "Session not found.")
        is_owner = bool(user and session.user_id == user.id)
        self._require_public_access(session_id, is_owner, db)

        turns_query = (
            db.query(ResearchTurn)
            .filter(ResearchTurn.session_id == session_id)
            .order_by(ResearchTurn.turn_index.asc())
        )
        if not is_owner:
            turns_query = turns_query.filter(ResearchTurn.is_public.is_(True))
        turns = turns_query.all()
        visible_title = session.title if is_owner else "Shared research session"
        compiled_markdown = [
            f"# {visible_title}",
            "**Compiled Autonomous Research Dossier**",
            f"*Total Investigation Turns: {len(turns)}*",
            "\n---\n",
        ]

        for turn in turns:
            compiled_markdown.append(
                f"\n## Turn {turn.turn_index}: {turn.executive_title or turn.query}\n"
            )
            compiled_markdown.append(f"**Inquiry Hypothesis:** *{turn.query}*\n")
            report_data = self._read_report_preview(turn.report_json_path)
            if report_data is None:
                if turn.report_json_path:
                    compiled_markdown.append("*(Report contents unavailable)*")
            else:
                compiled_markdown.append(
                    report_data.get("report_markdown") or report_data.get("monograph", "")
                )
            compiled_markdown.append("\n---\n")

        return {
            "session_id": session.id,
            "title": visible_title,
            "markdown": "\n".join(compiled_markdown),
        }

    @staticmethod
    def _require_public_access(session_id: str, is_owner: bool, db: Session) -> None:
        """Require ownership or at least one public turn, using a non-disclosing 404."""
        if is_owner:
            return
        has_public_turn = db.query(ResearchTurn.id).filter(
            ResearchTurn.session_id == session_id,
            ResearchTurn.is_public.is_(True),
        ).first()
        if not has_public_turn:
            raise ResearchSessionError(404, "Session not found.")

    @staticmethod
    def _owned_session(session_id: str, user: User, db: Session) -> ResearchSession:
        """Load a session owned by the caller or raise a non-disclosing 404."""
        session = db.query(ResearchSession).filter(
            ResearchSession.id == session_id,
            ResearchSession.user_id == user.id,
        ).first()
        if session is None:
            raise ResearchSessionError(404, "Session not found or access denied.")
        return session

    @staticmethod
    def _read_report_preview(report_path: Optional[str]) -> Optional[dict[str, Any]]:
        """Read a report JSON artifact, logging expected file/format failures."""
        if not report_path:
            return None
        try:
            with Path(report_path).open("r", encoding="utf-8") as report_file:
                data = json.load(report_file)
        except (OSError, json.JSONDecodeError) as exc:
            logger.debug("Could not read session report artifact %s: %s", report_path, exc)
            return None
        return data if isinstance(data, dict) else None

    @staticmethod
    def _remove_report_files(report_path: Optional[str]) -> None:
        """Remove a report's JSON and Markdown artifacts when present."""
        if not report_path:
            return
        path = Path(report_path)
        path.unlink(missing_ok=True)
        path.with_suffix(".md").unlink(missing_ok=True)
