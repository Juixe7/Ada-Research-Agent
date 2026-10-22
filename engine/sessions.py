"""HTTP routes for research sessions and their turns."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from engine.auth import get_current_user, get_optional_user
from engine.database import get_db
from engine.models import User
from engine.http_errors import run_service_operation as _run_service_operation
from engine.services.sessions import ResearchSessionService

sessions_router = APIRouter(prefix="/api/sessions", tags=["sessions"])
session_service = ResearchSessionService()


class CreateSessionRequest(BaseModel):
    """Validated title for a new research session."""

    title: str = Field(..., min_length=1, max_length=255)


class UpdateSessionRequest(BaseModel):
    """Validated replacement title for a research session."""

    title: str = Field(..., min_length=1, max_length=255)


@sessions_router.get("")
def list_user_sessions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """List sessions belonging to the authenticated user."""
    return _run_service_operation(session_service.list_sessions, user, db)


@sessions_router.post("")
def create_session(
    req: CreateSessionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create an empty session with a validated title."""
    return _run_service_operation(session_service.create_session, req.title, user, db)


@sessions_router.get("/{session_id}")
def get_session_details(
    session_id: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return session metadata and turns visible to the caller."""
    return _run_service_operation(session_service.get_session_details, session_id, user, db)


@sessions_router.patch("/{session_id}")
def update_session(
    session_id: str,
    req: UpdateSessionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Update the title of an owned session."""
    return _run_service_operation(session_service.update_session, session_id, req.title, user, db)


@sessions_router.delete("/{session_id}")
def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Delete an owned session, its turns, and local report artifacts."""
    return _run_service_operation(session_service.delete_session, session_id, user, db)


@sessions_router.delete("/{session_id}/turns/{turn_id}")
def delete_session_turn(
    session_id: str,
    turn_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Delete one turn from an owned session."""
    return _run_service_operation(
        session_service.delete_session_turn, session_id, turn_id, user, db
    )


@sessions_router.get("/{session_id}/export")
def export_compiled_session(
    session_id: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Compile visible session turns into Markdown."""
    return _run_service_operation(session_service.export_session, session_id, user, db)
