import json
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from engine.database import get_db
from engine.auth import get_current_user, get_optional_user
from engine.models import User, ResearchSession, ResearchTurn
from engine.agents.evidence_delta import condense_session_turns
from engine.report_artifacts import has_persisted_report_artifact

sessions_router = APIRouter(prefix="/api/sessions", tags=["sessions"])
DOSSIER_DIR = Path("dossiers")

class CreateSessionRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)

class UpdateSessionRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)

@sessions_router.get("")
def list_user_sessions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns all research sessions for the authenticated user."""
    sessions = (
        db.query(ResearchSession)
        .filter(ResearchSession.user_id == user.id)
        .order_by(ResearchSession.updated_at.desc())
        .all()
    )

    result = []
    for s in sessions:
        turns = (
            db.query(ResearchTurn)
            .filter(ResearchTurn.session_id == s.id)
            .order_by(ResearchTurn.turn_index.asc())
            .all()
        )
        latest_turn = turns[-1] if turns else None
        latest_status = latest_turn.status if latest_turn else "empty"
        if latest_turn and latest_status == "completed" and not has_persisted_report_artifact(latest_turn.id, latest_turn.report_json_path):
            latest_status = "failed"
        result.append({
            "id": s.id,
            "title": s.title,
            "turn_count": len(turns),
            "latest_query": latest_turn.query if latest_turn else "",
            "latest_status": latest_status,
            "created_at": s.created_at,
            "updated_at": s.updated_at
        })

    return {"sessions": result}

@sessions_router.post("")
def create_session(
    req: CreateSessionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Creates a new named research session thread."""
    session = ResearchSession(
        user_id=user.id,
        title=req.title.strip()
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {
        "id": session.id,
        "title": session.title,
        "created_at": session.created_at
    }

@sessions_router.get("/{session_id}")
def get_session_details(
    session_id: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Retrieves session details and all associated research turns."""
    session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Research session not found.")

    is_owner = bool(user and session.user_id == user.id)
    if not is_owner and not db.query(ResearchTurn.id).filter(
        ResearchTurn.session_id == session_id,
        ResearchTurn.is_public.is_(True),
    ).first():
        raise HTTPException(status_code=404, detail="Research session not found.")

    turns_query = (
        db.query(ResearchTurn)
        .filter(ResearchTurn.session_id == session_id)
        .order_by(ResearchTurn.turn_index.asc())
    )
    if not is_owner:
        turns_query = turns_query.filter(ResearchTurn.is_public.is_(True))
    turns = turns_query.all()

    turns_data = []
    for t in turns:
        # Load turn summary or result preview if completed
        preview_data = None
        if t.report_json_path and Path(t.report_json_path).exists():
            try:
                with open(t.report_json_path, "r", encoding="utf-8") as f:
                    preview_data = json.load(f)
            except Exception:
                pass

        turn_status = t.status
        turn_stage = t.stage
        if turn_status == "completed" and not has_persisted_report_artifact(t.id, t.report_json_path):
            turn_status = "failed"
            turn_stage = "Report unavailable"

        turns_data.append({
            "id": t.id,
            "turn_index": t.turn_index,
            "query": t.query,
            "executive_title": t.executive_title or (preview_data.get("executive_title") if preview_data else None),
            "status": turn_status,
            "progress": t.progress,
            "stage": turn_stage,
            "is_public": t.is_public,
            "created_at": t.created_at,
            "report_id": t.id,
            "total_sources": preview_data.get("total_sources_cited", 0) if preview_data else 0
        })

    return {
        "id": session.id,
        "title": session.title if is_owner else "Shared research session",
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "turns": turns_data
    }

@sessions_router.patch("/{session_id}")
def update_session(
    session_id: str,
    req: UpdateSessionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates the title of a research session."""
    session = db.query(ResearchSession).filter(
        ResearchSession.id == session_id,
        ResearchSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or access denied.")

    session.title = req.title.strip()
    session.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "ok", "id": session.id, "title": session.title}

@sessions_router.delete("/{session_id}")
def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes an entire research session and all of its turns."""
    session = db.query(ResearchSession).filter(
        ResearchSession.id == session_id,
        ResearchSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or access denied.")

    # Remove disk files for turns
    turns = db.query(ResearchTurn).filter(ResearchTurn.session_id == session_id).all()
    for t in turns:
        if t.report_json_path:
            p = Path(t.report_json_path)
            if p.exists():
                p.unlink(missing_ok=True)
            md_p = p.with_suffix(".md")
            if md_p.exists():
                md_p.unlink(missing_ok=True)

    db.delete(session)
    db.commit()
    return {"status": "ok", "message": "Session deleted successfully."}

@sessions_router.delete("/{session_id}/turns/{turn_id}")
def delete_session_turn(
    session_id: str,
    turn_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes a specific turn from a research session."""
    session = db.query(ResearchSession).filter(
        ResearchSession.id == session_id,
        ResearchSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or access denied.")

    turn = db.query(ResearchTurn).filter(
        ResearchTurn.id == turn_id,
        ResearchTurn.session_id == session_id
    ).first()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found.")

    if turn.report_json_path:
        p = Path(turn.report_json_path)
        if p.exists():
            p.unlink(missing_ok=True)
        md_p = p.with_suffix(".md")
        if md_p.exists():
            md_p.unlink(missing_ok=True)

    db.delete(turn)
    db.commit()
    return {"status": "ok", "message": "Turn removed from session."}

@sessions_router.get("/{session_id}/export")
def export_compiled_session(
    session_id: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Compiles all completed turns in a session into a single executive research monograph."""
    session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    is_owner = bool(user and session.user_id == user.id)
    if not is_owner and not db.query(ResearchTurn.id).filter(
        ResearchTurn.session_id == session_id,
        ResearchTurn.is_public.is_(True),
    ).first():
        raise HTTPException(status_code=404, detail="Session not found.")

    turns_query = (
        db.query(ResearchTurn)
        .filter(ResearchTurn.session_id == session_id)
        .order_by(ResearchTurn.turn_index.asc())
    )
    if not is_owner:
        turns_query = turns_query.filter(ResearchTurn.is_public.is_(True))
    turns = turns_query.all()

    compiled_md = [
        f"# {session.title}",
        f"**Compiled Autonomous Research Dossier**",
        f"*Total Investigation Turns: {len(turns)}*",
        "\n---\n"
    ]

    for t in turns:
        compiled_md.append(f"\n## Turn {t.turn_index}: {t.executive_title or t.query}\n")
        compiled_md.append(f"**Inquiry Hypothesis:** *{t.query}*\n")
        if t.report_json_path and Path(t.report_json_path).exists():
            try:
                with open(t.report_json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                compiled_md.append(data.get("report_markdown") or data.get("monograph", ""))
            except Exception:
                compiled_md.append("*(Report contents unavailable)*")
        compiled_md.append("\n---\n")

    return {
        "session_id": session.id,
        "title": session.title if is_owner else "Shared research session",
        "markdown": "\n".join(compiled_md)
    }
