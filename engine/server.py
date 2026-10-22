"""FastAPI application, API routes, and transport-level resource checks."""

import re
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks, Depends, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse
from engine.events import run_event_generator
from sqlalchemy.orm import Session

from engine.config import (
    USE_CELERY,
    RUN_TOKEN_BUDGET,
    RUN_COST_BUDGET_USD,
    MAX_SEARCHES_PER_RUN,
    MAX_FETCHES_PER_RUN,
    RUN_TIME_BUDGET_SECONDS,
)
from engine.tasks import run_research_pipeline_task
from engine.celery_app import get_job_state, set_job_state, get_redis_client
from engine.database import init_db, get_db
from engine.auth import auth_router, get_current_user, get_optional_user
from engine.models import User
from engine.sessions import sessions_router
from engine.agents.evidence_delta import condense_session_turns, format_delta_planning_context
from engine.services.reports import ReportService
from engine.services.report_followups import ReportFollowupService
from engine.services.errors import ServiceError
from engine.services.research_runs import ResearchRunCommand, ResearchRunService
from engine.services.preflight import PreflightCommand, PreflightService
from engine.services.vault import VaultService
from engine.schemas.vault import (
    VaultDeleteResponse,
    VaultListResponse,
    VaultPasteResponse,
    VaultPreviewResponse,
    VaultReindexResponse,
    VaultUploadResponse,
)
from engine.schemas.reports import ReportListResponse
from engine.schemas.requests import (
    AddendumRequest,
    PasteDocRequest,
    PreflightRequest,
    QuerySourceRequest,
    ReportFollowupRequest,
    ResearchRequest,
)

# Initialize database schema
init_db()

app = FastAPI(title="Ada Deep Research API", version="1.0.0")

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers
app.include_router(auth_router)
app.include_router(sessions_router)

DOSSIER_DIR = Path("dossiers")
DOSSIER_DIR.mkdir(parents=True, exist_ok=True)

MAX_ACTIVE_JOBS = 30
vault_service = VaultService()
preflight_service = PreflightService()


def _run_service_operation(operation: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Translate expected application-service failures into HTTP responses."""
    try:
        return operation(*args, **kwargs)
    except ServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


# In-memory status registry for active research jobs
ACTIVE_JOBS: Dict[str, Dict[str, Any]] = {}
report_service = ReportService(
    dossier_dir=DOSSIER_DIR,
    active_jobs=ACTIVE_JOBS,
    budget_limits={
        "token_limit": RUN_TOKEN_BUDGET,
        "cost_limit_usd": RUN_COST_BUDGET_USD,
        "search_limit": MAX_SEARCHES_PER_RUN,
        "fetch_limit": MAX_FETCHES_PER_RUN,
        "time_limit_seconds": RUN_TIME_BUDGET_SECONDS,
    },
)
report_followup_service = ReportFollowupService(DOSSIER_DIR, report_service)


def _update_durable_run_status(**kwargs: Any) -> Any:
    """Load the persistence adapter only when a run status needs updating."""
    from engine.storage.relational_store import RelationalStore

    return RelationalStore.update_run_status(**kwargs)


def _publish_run_event(*args: Any, **kwargs: Any) -> Any:
    """Load the event publisher only when a run event needs publishing."""
    from engine.events import publish_event

    return publish_event(*args, **kwargs)


research_run_service = ResearchRunService(
    dossier_dir=DOSSIER_DIR,
    active_jobs=ACTIVE_JOBS,
    budgets=report_service.budget_limits,
    max_active_jobs=MAX_ACTIVE_JOBS,
    use_celery=USE_CELERY,
    redis_available=get_redis_client,
    set_distributed_job_state=set_job_state,
    get_distributed_job_state=get_job_state,
    celery_dispatch=run_research_pipeline_task.delay,
    condense_turns=condense_session_turns,
    format_delta_context=format_delta_planning_context,
    update_run_status=_update_durable_run_status,
    publish_event=_publish_run_event,
    report_service=report_service,
)


def sanitize_report_id(report_id: str) -> str:
    """Validates report_id to prevent path traversal into dossiers directory (CWE-22)."""
    clean_id = report_id.strip()
    if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", clean_id):
        raise HTTPException(status_code=400, detail="Invalid report identifier.")
    return clean_id


def require_report_access(report_id: str, user: Optional[User], db: Session) -> Any:
    """Enforce report ownership before serving a private artifact or event stream."""
    return _run_service_operation(report_service.require_access, report_id, user, db)


@app.get("/health")
def health():
    """Return a lightweight process liveness response; does not probe dependencies."""
    return {"status": "ok", "service": "ada-deep-research", "engine": "modular-multi-agent"}


@app.post("/api/research/preflight")
def preflight_scope_check(
    req: PreflightRequest,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Prepare ambiguity and research-angle guidance for a query."""
    command = PreflightCommand(
        query=req.query,
        include_user_docs=req.include_user_docs,
        selected_docs=req.selected_docs,
        user_modification=req.user_modification,
    )
    return _run_service_operation(preflight_service.evaluate, command, user, db)


@app.post("/api/research")
async def start_research(
    req: ResearchRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Validate and dispatch an asynchronous research run."""
    command = ResearchRunCommand(
        query=req.query,
        depth=req.depth,
        include_user_docs=req.include_user_docs,
        selected_docs=req.selected_docs,
        clarification_choice=req.clarification_choice,
        custom_angles=req.custom_angles,
        session_id=req.session_id,
        blocked_domains=req.blocked_domains,
    )
    return _run_service_operation(
        research_run_service.start,
        command,
        user,
        db,
        enqueue_background=lambda task_kwargs: background_tasks.add_task(
            run_research_pipeline_task, **task_kwargs
        ),
    )


@app.post("/api/research/{report_id}/cancel")
def cancel_research_job(
    report_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel an active research job and return its final known state."""
    clean_id = sanitize_report_id(report_id)
    return _run_service_operation(research_run_service.cancel, clean_id, user, db)


@app.get("/api/report/status/{report_id}")
def get_job_status(
    report_id: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Return live or durable status for an authorized research run."""
    clean_id = sanitize_report_id(report_id)
    return _run_service_operation(research_run_service.get_status, clean_id, user, db)


@app.get("/api/v1/runs/{report_id}/report")
def get_completed_report(
    report_id: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Return a report using normalized storage with legacy file/cache fallbacks."""
    clean_id = sanitize_report_id(report_id)
    return _run_service_operation(report_service.get_completed_report, clean_id, user, db)


@app.get("/api/v1/runs/{run_id}")
def get_run_details(run_id: str, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Return structured run state and budget limits for the inspector."""
    clean_id = sanitize_report_id(run_id)
    return _run_service_operation(report_service.get_run_details, clean_id, user, db)

@app.get("/api/v1/runs/{run_id}/events")
async def stream_run_events(
    run_id: str,
    request: Request,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
    last_event_id: Optional[str] = Query(None, alias="last_event_id")
):
    """
    Server-Sent Events (SSE) streaming endpoint (Blueprint Section 12).
    Streams real-time execution events for an active research run.
    Supports reconnection replay via `Last-Event-Id` header or `?last_event_id=` query param.
    """
    clean_id = sanitize_report_id(run_id)
    require_report_access(clean_id, user, db)
    header_last_id = request.headers.get("last-event-id")
    effective_last_id = header_last_id or last_event_id

    return EventSourceResponse(
        run_event_generator(
            run_id=clean_id,
            last_event_id=effective_last_id,
            client_request=request
        ),
        ping=15
    )


@app.post("/api/report/{report_id}/query-evidence")
def query_report_evidence(
    report_id: str,
    req: ReportFollowupRequest,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Answer a follow-up from saved report evidence without launching new research."""
    clean_id = sanitize_report_id(report_id)
    return _run_service_operation(
        report_followup_service.answer_from_evidence,
        clean_id,
        req.question,
        req.selected_text or "",
        user,
        db,
    )


@app.post("/api/report/{report_id}/addendum")
def dispatch_addendum(
    report_id: str,
    req: AddendumRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Run a focused investigation and append its grounded findings to the report."""
    clean_id = sanitize_report_id(report_id)
    return _run_service_operation(
        report_followup_service.investigate_addendum,
        clean_id,
        req.inquiry,
        req.selected_text or "",
        req.context or "",
        user,
        db,
    )


@app.post("/api/report/{report_id}/query-source")
def query_source(
    report_id: str,
    req: QuerySourceRequest,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Answer a direct question about a source saved in the report evidence drawer."""
    clean_id = sanitize_report_id(report_id)
    return _run_service_operation(
        report_followup_service.answer_source_question,
        clean_id,
        req.source_id,
        req.question,
        user,
        db,
    )


@app.get("/api/reports", response_model=ReportListResponse, response_model_exclude_unset=True)
def list_reports(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """List this user's research history or completed public reports."""
    return _run_service_operation(report_service.list_reports, user, db)


@app.post("/api/report/{report_id}/toggle-public")
def toggle_report_public(
    report_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle read-only public sharing for an owned research report."""
    clean_id = sanitize_report_id(report_id)
    return _run_service_operation(report_service.toggle_public, clean_id, user, db)

@app.post("/api/upload", response_model=VaultUploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept an upload and delegate extraction/indexing to the vault service."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")
    content = await file.read(vault_service.max_upload_bytes + 1)
    return _run_service_operation(vault_service.upload, file.filename, content, user, db)


@app.post("/api/paste-document", response_model=VaultPasteResponse)
def paste_document(
    req: PasteDocRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Validate the request DTO and store pasted text through the vault service."""
    return _run_service_operation(vault_service.paste, req.title, req.text, user, db)


@app.get("/api/vault", response_model=VaultListResponse)
def get_vault_documents(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return this user's source-library metadata and searchability status."""
    return _run_service_operation(vault_service.list_documents, user, db)


@app.delete("/api/vault/{doc_name}", response_model=VaultDeleteResponse)
def delete_vault_document(
    doc_name: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an owned vault document through the vault service."""
    return _run_service_operation(vault_service.delete, doc_name, user, db)


@app.post("/api/vault/{doc_name}/reindex", response_model=VaultReindexResponse)
def reindex_vault_document(
    doc_name: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rebuild the searchable passages for an owned vault document."""
    return _run_service_operation(vault_service.reindex, doc_name, user, db)


@app.get("/api/vault/{doc_name}/preview", response_model=VaultPreviewResponse)
def preview_vault_document(
    doc_name: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return extracted text and passage diagnostics for an owned document."""
    return _run_service_operation(vault_service.preview, doc_name, user, db)

@app.get("/api/report/{report_id}/download/{fmt}")
def download_export(
    report_id: str,
    fmt: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Serves file downloads for md, txt, html, or json."""
    clean_id = sanitize_report_id(report_id)
    require_report_access(clean_id, user, db)
    if fmt in ("markdown", "md"):
        fpath = DOSSIER_DIR / f"dossier_{clean_id}.md"
        media = "text/markdown"
    elif fmt in ("txt", "text"):
        fpath = DOSSIER_DIR / f"dossier_{clean_id}.md"
        media = "text/plain"
        if not fpath.exists():
            raise HTTPException(status_code=404, detail=f"Export file not found: {fpath.name}")
        return FileResponse(fpath, media_type=media, filename=f"dossier_{clean_id}.txt")
    elif fmt == "html":
        fpath = DOSSIER_DIR / f"dossier_{clean_id}.html"
        media = "text/html"
    elif fmt == "json":
        fpath = DOSSIER_DIR / f"dossier_{clean_id}.json"
        media = "application/json"
    else:
        raise HTTPException(status_code=400, detail="Invalid format. Supported: md, txt, html, json")

    if not fpath.exists():
        raise HTTPException(status_code=404, detail=f"Export file not found: {fpath.name}")

    return FileResponse(fpath, media_type=media, filename=fpath.name)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("engine.server:app", host="0.0.0.0", port=8000, reload=True)
