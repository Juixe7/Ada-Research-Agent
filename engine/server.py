import os
import re
import json
import uuid
from pathlib import Path
from typing import Dict, Any, Optional, List
from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from engine.config import USE_CELERY
from engine.tasks import run_research_pipeline_sync, run_research_pipeline_task
from engine.celery_app import get_job_state, set_job_state, get_redis_client
from engine.ingest.doc_processor import process_pdf_document, process_raw_text_document
from engine.storage.vector_store import get_vector_store
from engine.database import init_db, get_db
from engine.auth import auth_router, get_current_user, get_optional_user
from engine.models import User, ResearchSession, ResearchTurn, VaultDocument
from engine.sessions import sessions_router
from engine.agents.evidence_delta import condense_session_turns, format_delta_planning_context
from engine.agents.llm_resilient import call_resilient_llm, get_last_llm_error

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

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DOSSIER_DIR = Path("dossiers")
DOSSIER_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB upload limit
MAX_ACTIVE_JOBS = 30

# In-memory status registry for active research jobs
ACTIVE_JOBS: Dict[str, Dict[str, Any]] = {}


def sanitize_filename(name: str) -> str:
    """Strips directory traversal components and unsafe characters from filenames (CWE-22)."""
    base = Path(name).name.strip()
    cleaned = re.sub(r"[^a-zA-Z0-9._\-\s()]", "_", base)
    if not cleaned or cleaned in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid document filename.")
    return cleaned


def sanitize_report_id(report_id: str) -> str:
    """Validates report_id to prevent path traversal into dossiers directory (CWE-22)."""
    clean_id = report_id.strip()
    if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", clean_id):
        raise HTTPException(status_code=400, detail="Invalid report identifier.")
    return clean_id


def locate_vault_file(doc_name: str, user: Optional[User] = None) -> Optional[Path]:
    """
    Locates a vault document on disk across user-scoped and root upload directories.
    Fixes BUG-01 where authenticated uploads in uploads/<user.id>/ returned 404 on preview/reindex.
    """
    safe_doc = sanitize_filename(doc_name)
    search_dirs: List[Path] = []
    if user:
        user_dir = UPLOAD_DIR / user.id
        if user_dir.exists():
            search_dirs.append(user_dir)
    search_dirs.append(UPLOAD_DIR)

    # 1. Search explicit directories (user dir first, then root UPLOAD_DIR)
    for d in search_dirs:
        for f in d.glob(f"*_{safe_doc}"):
            if f.is_file():
                return f
        direct = d / safe_doc
        if direct.is_file():
            return direct

    # 2. Fallback: search any user subdirectory if previewing without auth header
    for f in UPLOAD_DIR.rglob(f"*_{safe_doc}"):
        if f.is_file():
            return f
    for f in UPLOAD_DIR.rglob(safe_doc):
        if f.is_file():
            return f

    return None


class PreflightRequest(BaseModel):
    query: str
    depth: str = "deep"
    include_user_docs: bool = True
    selected_docs: Optional[List[str]] = None
    user_modification: Optional[str] = None


class ResearchRequest(BaseModel):
    query: str
    depth: str = "deep"  # "quick" | "deep"
    include_user_docs: bool = True
    selected_docs: Optional[List[str]] = None
    clarification_choice: Optional[str] = None
    custom_angles: Optional[List[str]] = None
    session_id: Optional[str] = None


class PasteDocRequest(BaseModel):
    title: str
    text: str


class QuerySelectionRequest(BaseModel):
    selected_text: str
    question: str


class AddendumRequest(BaseModel):
    inquiry: str
    selected_text: Optional[str] = ""
    context: Optional[str] = ""


SubInvestigationRequest = AddendumRequest


class QuerySourceRequest(BaseModel):
    source_id: str
    question: str


@app.get("/health")
def health():
    return {"status": "ok", "service": "ada-deep-research", "engine": "modular-multi-agent"}


@app.post("/api/research/preflight")
def preflight_scope_check(
    req: PreflightRequest,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """
    Pre-flight Scoping check (~1.5s):
    Evaluates query ambiguity between private vault documents and public web,
    and generates human-readable research angles for the user to review/edit.
    """
    from engine.agents.preflight import evaluate_preflight_scope
    docs_to_check = req.selected_docs if (req.include_user_docs and req.selected_docs) else None
    if req.include_user_docs and not docs_to_check:
        if user:
            v_docs = db.query(VaultDocument).filter(VaultDocument.user_id == user.id).all()
            docs_to_check = [d.doc_name for d in v_docs]
        if not docs_to_check:
            docs_to_check = [
                f.name.split("_", 1)[1] if "_" in f.name else f.name
                for f in UPLOAD_DIR.rglob("*")
                if f.is_file()
            ]

    blueprint = evaluate_preflight_scope(
        query=req.query,
        vault_doc_names=docs_to_check,
        user_modification=req.user_modification
    )
    return blueprint


@app.post("/api/research")
async def start_research(
    req: ResearchRequest,
    background_tasks: BackgroundTasks,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """
    Starts an autonomous deep research task.
    Supports multi-turn sessions and evidence-delta context condensation.
    Returns immediately with report_id and session_id.
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    report_id = str(uuid.uuid4())[:8]
    user_id = user.id if user else None

    # Multi-turn session & turn setup
    session_id = req.session_id
    delta_planning_text = ""

    if user:
        if session_id:
            session = db.query(ResearchSession).filter(
                ResearchSession.id == session_id,
                ResearchSession.user_id == user.id
            ).first()
            if not session:
                raise HTTPException(status_code=404, detail="Session not found.")
        else:
            session = ResearchSession(
                user_id=user.id,
                title=req.query[:60].strip()
            )
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
        turn_index = len(prior_turns) + 1

        # Condense prior turns for delta retrieval
        if prior_turns:
            turns_data = []
            for pt in prior_turns:
                t_dict = {"query": pt.query, "executive_title": pt.executive_title, "summary": ""}
                if pt.report_json_path and Path(pt.report_json_path).exists():
                    try:
                        with open(pt.report_json_path, "r", encoding="utf-8") as f:
                            d = json.load(f)
                            t_dict["summary"] = d.get("summary", "") or d.get("executive_title", "")
                            t_dict["sources"] = d.get("evidence_manifest", [])
                    except Exception:
                        pass
                turns_data.append(t_dict)

            working_mem = condense_session_turns(turns_data)
            delta_planning_text = format_delta_planning_context(working_mem)

        # Create Turn record in DB
        turn = ResearchTurn(
            id=report_id,
            session_id=session_id,
            turn_index=turn_index,
            query=req.query,
            status="planning",
            progress=10,
            stage="Decomposing research query..."
        )
        db.add(turn)
        db.commit()

    # Evict oldest completed jobs if registry exceeds MAX_ACTIVE_JOBS (Fixes BUG-07 RAM leak)
    if len(ACTIVE_JOBS) >= MAX_ACTIVE_JOBS:
        completed_keys = [k for k, v in ACTIVE_JOBS.items() if v.get("status") in ("completed", "failed", "cancelled")]
        for k in completed_keys[:len(ACTIVE_JOBS) - MAX_ACTIVE_JOBS + 1]:
            ACTIVE_JOBS.pop(k, None)

    initial_state = {
        "report_id": report_id,
        "session_id": session_id,
        "query": req.query,
        "depth": req.depth,
        "selected_docs": req.selected_docs,
        "status": "planning",
        "stage": "Decomposing research query...",
        "progress": 10,
        "result": None,
        "error": None
    }
    ACTIVE_JOBS[report_id] = initial_state
    set_job_state(report_id, initial_state)

    angles = list(req.custom_angles or [])
    if delta_planning_text:
        angles.append(f"[Delta Context]: {delta_planning_text[:500]}")

    # Dispatch to Celery + Redis distributed worker queue if enabled & reachable, else local BackgroundTasks
    if USE_CELERY and get_redis_client() is not None:
        print(f"[server] Dispatching research job {report_id} to Celery + Redis worker queue...")
        run_research_pipeline_task.delay(
            report_id=report_id,
            session_id=session_id,
            query=req.query,
            depth=req.depth,
            include_user_docs=req.include_user_docs,
            selected_docs=req.selected_docs,
            custom_angles=angles if angles else None,
            clarification_choice=req.clarification_choice,
            user_id=user_id
        )
    else:
        background_tasks.add_task(
            run_research_pipeline_task,
            report_id=report_id,
            session_id=session_id,
            query=req.query,
            depth=req.depth,
            include_user_docs=req.include_user_docs,
            selected_docs=req.selected_docs,
            custom_angles=angles if angles else None,
            clarification_choice=req.clarification_choice,
            user_id=user_id
        )

    return {
        "report_id": report_id,
        "session_id": session_id,
        "query": req.query,
        "status": "planning"
    }


@app.post("/api/research/{report_id}/cancel")
def cancel_research_job(report_id: str, db: Session = Depends(get_db)):
    """Cancels an active research investigation mid-flight across Redis and local state."""
    clean_id = sanitize_report_id(report_id)
    db_turn = db.query(ResearchTurn).filter(ResearchTurn.id == clean_id).first()
    if db_turn and db_turn.status not in ["completed", "failed"]:
        db_turn.status = "cancelled"
        db_turn.stage = "Investigation cancelled by user."
        db.commit()

    job = get_job_state(clean_id) or ACTIVE_JOBS.get(clean_id)
    if job:
        if job.get("status") not in ["completed", "failed"]:
            job["status"] = "cancelled"
            job["stage"] = "Investigation cancelled by user."
            ACTIVE_JOBS[clean_id] = job
            set_job_state(clean_id, job)
        return {
            "status": job.get("status"),
            "report_id": clean_id,
            "session_id": job.get("session_id"),
            "query": job.get("query"),
            "depth": job.get("depth", "deep"),
            "selected_docs": job.get("selected_docs", [])
        }

    if db_turn:
        return {
            "status": db_turn.status,
            "report_id": clean_id,
            "session_id": db_turn.session_id,
            "query": db_turn.query
        }

    raise HTTPException(status_code=404, detail="Active research job not found.")


def enrich_dossier_inquiries(data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(data, dict):
        return data
    if not data.get("suggested_inquiries"):
        q = data.get("query") or "this subject"
        critic = data.get("critic_audit") or {}
        gaps = critic.get("identified_gaps") if isinstance(critic, dict) else []
        if gaps:
            inquiries = [f"How can we address the gap in {g[:65]}?" for g in gaps[:2]]
            inquiries.append(f"What are the major operational bottlenecks and failure risks of {q}?")
            data["suggested_inquiries"] = inquiries
        else:
            data["suggested_inquiries"] = [
                f"What are the major operational bottlenecks and failure risks of {q}?",
                f"How does {q} benchmark against competing industry alternatives?",
                f"What is the projected economic deployment and hosting cost of {q}?"
            ]
    return data


@app.get("/api/report/status/{report_id}")
def get_job_status(report_id: str):
    """Polls real-time execution status of an ongoing research investigation from Redis or local cache."""
    clean_id = sanitize_report_id(report_id)
    job = get_job_state(clean_id) or ACTIVE_JOBS.get(clean_id)
    if job:
        if job.get("result"):
            job["result"] = enrich_dossier_inquiries(job["result"])
        return job

    json_path = DOSSIER_DIR / f"dossier_{clean_id}.json"
    if json_path.exists():
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data = enrich_dossier_inquiries(data)
        return {
            "report_id": clean_id,
            "query": data.get("query"),
            "status": "completed",
            "stage": "Completed",
            "progress": 100,
            "result": data
        }

    raise HTTPException(status_code=404, detail="Research report not found.")


@app.get("/api/report/{report_id}")
def get_completed_report(report_id: str):
    """Retrieves full research dossier payload with verified citations and bibliography."""
    clean_id = sanitize_report_id(report_id)
    json_path = DOSSIER_DIR / f"dossier_{clean_id}.json"
    if not json_path.exists():
        if clean_id in ACTIVE_JOBS and ACTIVE_JOBS[clean_id].get("result"):
            return enrich_dossier_inquiries(ACTIVE_JOBS[clean_id]["result"])
        raise HTTPException(status_code=404, detail="Dossier not found.")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return enrich_dossier_inquiries(data)


@app.post("/api/report/{report_id}/query-selection")
def query_selection(report_id: str, req: QuerySelectionRequest):
    """
    Answers a targeted inline question about selected text in the monograph.
    Uses resilient multi-tier LLM fallback (Fixes BUG-06).
    """
    clean_id = sanitize_report_id(report_id)
    json_path = DOSSIER_DIR / f"dossier_{clean_id}.json"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail="Report dossier not found.")

    with open(json_path, "r", encoding="utf-8") as f:
        dossier = json.load(f)

    system_prompt = (
        "You are Ada's Inline Intelligence Assistant. A user highlighted a specific passage "
        "from a deep research dossier and asked a question about it. "
        "Provide a direct, factual, 2-3 sentence answer directly answering their inquiry. "
        "Cite relevant [Sx] or [Dx] sources if mentioned in the context."
    )
    user_prompt = (
        f"RESEARCH TOPIC: {dossier.get('query', '')}\n\n"
        f"HIGHLIGHTED PASSAGE:\n\"{req.selected_text}\"\n\n"
        f"USER QUESTION:\n\"{req.question}\""
    )

    answer = call_resilient_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.2,
        max_tokens=400,
        json_mode=False
    )
    if not answer:
        answer = f"This passage discusses '{req.selected_text[:90]}...' in the context of {dossier.get('query', 'the investigation')}."

    return {
        "status": "success",
        "question": req.question,
        "answer": answer
    }


@app.post("/api/report/{report_id}/addendum")
@app.post("/api/report/{report_id}/sub-investigation")
def dispatch_sub_investigation(report_id: str, req: AddendumRequest):
    """
    Fans out a focused sub-agent task on highlighted text or follow-up inquiry,
    runs web retrieval, synthesizes a new Addendum via resilient multi-tier LLM,
    and appends it to the dossier.
    """
    clean_id = sanitize_report_id(report_id)
    json_path = DOSSIER_DIR / f"dossier_{clean_id}.json"
    md_path = DOSSIER_DIR / f"dossier_{clean_id}.md"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail="Report dossier not found.")

    with open(json_path, "r", encoding="utf-8") as f:
        dossier = json.load(f)

    from engine.workers.research_worker import execute_sub_research

    sub_task = {
        "id": "ADDENDUM",
        "sub_question": req.inquiry,
        "search_queries": [req.inquiry, f"{req.inquiry} in-depth breakdown"],
        "category": "follow_up_deep_dive"
    }

    try:
        sub_res = execute_sub_research(sub_task, include_user_docs=True, max_pages_to_scrape=2)
        new_evidence = sub_res.get("evidence", [])
    except Exception as scrape_err:
        print(f"[addendum] Sub-research retrieval warning: {scrape_err}")
        new_evidence = []

    evidence_text = "\n\n".join(
        [f"[{ev.get('source_id')}] {ev.get('title')}: {ev.get('text', '')[:400]}" for ev in new_evidence[:5]]
    )
    system_prompt = (
        "You are Ada's Sub-Investigation Agent. You were dispatched to investigate a specific follow-up topic "
        "highlighted from an earlier research report. Synthesize a concise 2-3 paragraph Addendum section "
        "with technical detail and inline citations [Sx] / [Dx] based on the newly gathered evidence."
    )
    context_text = (req.selected_text or req.context or dossier.get("query", "")).strip()
    user_prompt = (
        f"CONTEXT FROM PREVIOUS REPORT:\n\"{context_text[:1000]}\"\n\n"
        f"FOLLOW-UP INQUIRY:\n\"{req.inquiry}\"\n\n"
        f"NEW EVIDENCE GATHERED:\n{evidence_text}\n\n"
        f"Synthesize an authoritative 'Addendum Section'."
    )

    addendum_content = call_resilient_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.15,
        max_tokens=800,
        json_mode=False
    )
    if not addendum_content:
        last_err = get_last_llm_error() or ""
        if "429" in last_err or "rate" in last_err.lower() or "quota" in last_err.lower():
            raise HTTPException(
                status_code=429,
                detail="AI provider rate limit reached (Groq/Gemini). Please wait 30 seconds before retrying."
            )
        if new_evidence:
            addendum_content = f"Follow-up investigation collected {len(new_evidence)} additional sources addressing: {req.inquiry}."
        else:
            raise HTTPException(
                status_code=502,
                detail="Unable to synthesize Addendum due to upstream AI service interruption. Please retry."
            )

    highlight_note = (
        f'> *Sub-Investigation triggered from highlighted text: "{req.selected_text[:120]}..."*\n\n'
        if req.selected_text
        else f'> *Follow-up investigation on: "{req.inquiry}"*\n\n'
    )

    formatted_addendum = (
        f"\n\n---\n\n## Addendum: {req.inquiry}\n\n"
        f"{highlight_note}"
        f"{addendum_content}"
    )

    dossier["report_markdown"] = dossier.get("report_markdown", "") + formatted_addendum
    dossier["monograph"] = dossier["report_markdown"]
    existing_manifest = dossier.setdefault("evidence_manifest", [])
    existing_manifest.extend(new_evidence)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(dossier, f, indent=2)

    if md_path.exists():
        with open(md_path, "a", encoding="utf-8") as f:
            f.write(formatted_addendum)

    return {
        "status": "success",
        "inquiry": req.inquiry,
        "addendum_markdown": formatted_addendum,
        "new_sources_count": len(new_evidence),
        "updated_report_markdown": dossier["report_markdown"],
        "monograph": dossier["monograph"]
    }


@app.post("/api/report/{report_id}/query-source")
def query_source(report_id: str, req: QuerySourceRequest):
    """Answers a direct question about a specific cited source in the evidence drawer (Fixes BUG-06)."""
    clean_id = sanitize_report_id(report_id)
    json_path = DOSSIER_DIR / f"dossier_{clean_id}.json"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail="Report dossier not found.")

    with open(json_path, "r", encoding="utf-8") as f:
        dossier = json.load(f)

    citation_index = dossier.get("citation_index", {})
    source_meta = citation_index.get(req.source_id)

    source_text = ""
    for ev in dossier.get("evidence_manifest", []):
        if ev.get("source_id") == req.source_id:
            source_text = ev.get("text", "")
            break

    if not source_text and source_meta:
        source_text = source_meta.get("snippet", "")

    if not source_text:
        raise HTTPException(status_code=404, detail=f"Source [{req.source_id}] text not found in manifest.")

    system_prompt = (
        "You are Ada's Source Auditor. Based strictly and exclusively on the provided source passage, "
        "answer the user's question directly in 1-2 sentences. "
        "If the source passage does not contain the answer, explicitly state: 'This source does not mention that information.'"
    )
    user_prompt = (
        f"SOURCE PASSAGE ([{req.source_id}]):\n{source_text[:4000]}\n\n"
        f"USER QUESTION:\n{req.question}"
    )

    answer = call_resilient_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.1,
        max_tokens=300,
        json_mode=False
    )
    if not answer:
        answer = f"Source [{req.source_id}] excerpt: {source_text[:240]}..."

    return {
        "status": "success",
        "source_id": req.source_id,
        "question": req.question,
        "answer": answer
    }


@app.get("/api/reports")
def list_reports(
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """
    Lists historical research dossiers.
    If authenticated, strictly returns only that user's sessions (Fixes VULN-02).
    """
    reports = []
    if user:
        user_turns = (
            db.query(ResearchTurn)
            .join(ResearchSession)
            .filter(ResearchSession.user_id == user.id, ResearchTurn.status == "completed")
            .order_by(ResearchTurn.created_at.desc())
            .all()
        )
        for t in user_turns:
            preview_data = {}
            if t.report_json_path and Path(t.report_json_path).exists():
                try:
                    with open(t.report_json_path, "r", encoding="utf-8") as f:
                        preview_data = json.load(f)
                except Exception:
                    pass

            reports.append({
                "report_id": t.id,
                "session_id": t.session_id,
                "query": t.query,
                "executive_title": t.executive_title or preview_data.get("executive_title") or t.query,
                "faithfulness_score": preview_data.get("faithfulness_score", 0.95),
                "coverage_score": preview_data.get("coverage_score", 85),
                "total_sources_cited": preview_data.get("total_sources_cited", 0),
                "is_public": t.is_public,
                "created_at": t.created_at.timestamp() if t.created_at else 0
            })
        return {"reports": reports}

    # Unauthenticated visitors see only public dossiers
    for file in sorted(DOSSIER_DIR.glob("dossier_*.json"), key=os.path.getmtime, reverse=True):
        try:
            with open(file, "r", encoding="utf-8") as f:
                d = json.load(f)
            r_id = d.get("report_id")
            turn_rec = db.query(ResearchTurn).filter(ResearchTurn.id == r_id).first() if r_id else None
            if turn_rec and not turn_rec.is_public:
                continue
            reports.append({
                "report_id": r_id,
                "query": d.get("query"),
                "executive_title": d.get("executive_title") or d.get("query"),
                "faithfulness_score": d.get("faithfulness_score", 0.95),
                "coverage_score": d.get("coverage_score", 85),
                "total_sources_cited": d.get("total_sources_cited", 0),
                "is_public": True,
                "created_at": os.path.getmtime(file)
            })
        except Exception:
            continue
    return {"reports": reports}


@app.post("/api/report/{report_id}/toggle-public")
def toggle_report_public(
    report_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Toggles read-only public sharing link for a research turn."""
    clean_id = sanitize_report_id(report_id)
    turn = db.query(ResearchTurn).filter(ResearchTurn.id == clean_id).first()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found.")
    session = db.query(ResearchSession).filter(ResearchSession.id == turn.session_id).first()
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=403, detail="Permission denied.")
    turn.is_public = not turn.is_public
    db.commit()
    return {"report_id": clean_id, "is_public": turn.is_public}


@app.post("/api/upload")
async def upload_document(
    file: UploadFile = File(...),
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """
    Ingests user documents (PDF, TXT, MD) and indexes into Ada's local Qdrant vector store.
    Sanitizes filenames (VULN-01) and enforces 25MB limit (VULN-06).
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")
    safe_filename = sanitize_filename(file.filename)
    if not safe_filename.lower().endswith((".pdf", ".txt", ".md")):
        raise HTTPException(status_code=400, detail="Only PDF, TXT, or MD files are supported.")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds maximum allowed size of 25 MB.")

    target_dir = UPLOAD_DIR / user.id if user else UPLOAD_DIR
    target_dir.mkdir(parents=True, exist_ok=True)
    file_path = target_dir / f"{str(uuid.uuid4())[:8]}_{safe_filename}"
    with open(file_path, "wb") as f:
        f.write(content)

    try:
        if safe_filename.lower().endswith(".pdf"):
            chunks = process_pdf_document(str(file_path), doc_name=safe_filename)
        else:
            raw_txt = content.decode("utf-8", errors="ignore")
            chunks = process_raw_text_document(raw_txt, doc_name=safe_filename)

        if user:
            for c in chunks:
                c["user_id"] = user.id

        vs = get_vector_store()
        indexed_count = vs.index_document_chunks(chunks)

        if user:
            existing_doc = db.query(VaultDocument).filter(
                VaultDocument.user_id == user.id,
                VaultDocument.doc_name == safe_filename
            ).first()
            if existing_doc:
                existing_doc.file_size = len(content)
                existing_doc.chunk_count = indexed_count
            else:
                db_doc = VaultDocument(
                    user_id=user.id,
                    doc_name=safe_filename,
                    file_size=len(content),
                    chunk_count=indexed_count
                )
                db.add(db_doc)
            db.commit()

        return {
            "status": "success",
            "filename": safe_filename,
            "chunks_indexed": indexed_count,
            "message": f"Successfully indexed {indexed_count} knowledge passages into Ada's private corpus."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process document: {str(e)}")


@app.post("/api/paste-document")
def paste_document(
    req: PasteDocRequest,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Ingests raw text (e.g. user-pasted paywalled articles or confidential notes)."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Document text cannot be empty.")

    raw_title = (req.title or "Pasted_Note").strip().replace(" ", "_")
    clean_title = sanitize_filename(raw_title)
    doc_name = f"{clean_title}.txt" if not clean_title.lower().endswith((".txt", ".md")) else clean_title

    target_dir = UPLOAD_DIR / user.id if user else UPLOAD_DIR
    target_dir.mkdir(parents=True, exist_ok=True)
    file_path = target_dir / f"{str(uuid.uuid4())[:8]}_{doc_name}"
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(req.text)

    chunks = process_raw_text_document(req.text, doc_name=doc_name)
    if user:
        for c in chunks:
            c["user_id"] = user.id

    vs = get_vector_store()
    indexed_count = vs.index_document_chunks(chunks)

    if user:
        existing_doc = db.query(VaultDocument).filter(
            VaultDocument.user_id == user.id,
            VaultDocument.doc_name == doc_name
        ).first()
        if existing_doc:
            existing_doc.file_size = len(req.text.encode("utf-8"))
            existing_doc.chunk_count = indexed_count
        else:
            db_doc = VaultDocument(
                user_id=user.id,
                doc_name=doc_name,
                file_size=len(req.text.encode("utf-8")),
                chunk_count=indexed_count
            )
            db.add(db_doc)
        db.commit()

    return {
        "status": "success",
        "title": req.title,
        "doc_name": doc_name,
        "chunks_indexed": indexed_count
    }


@app.get("/api/vault")
def get_vault_documents(
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Returns list of all uploaded and indexed private documents."""
    if user:
        v_docs = (
            db.query(VaultDocument)
            .filter(VaultDocument.user_id == user.id)
            .order_by(VaultDocument.uploaded_at.desc())
            .all()
        )
        return {
            "documents": [
                {
                    "doc_name": d.doc_name,
                    "filename": d.doc_name,
                    "size_kb": round(d.file_size / 1024, 1),
                    "uploaded_at": d.uploaded_at.timestamp() if d.uploaded_at else 0,
                    "chunk_count": d.chunk_count
                }
                for d in v_docs
            ]
        }

    docs = []
    seen = set()
    vs = get_vector_store()
    for f in sorted(UPLOAD_DIR.glob("*"), key=os.path.getmtime, reverse=True):
        if f.is_file():
            parts = f.name.split("_", 1)
            display_name = parts[1] if len(parts) > 1 else f.name
            if display_name not in seen:
                seen.add(display_name)
                docs.append({
                    "doc_name": display_name,
                    "filename": f.name,
                    "size_kb": round(f.stat().st_size / 1024, 1),
                    "uploaded_at": f.stat().st_mtime,
                    "chunk_count": vs.get_document_chunks_count(display_name)
                })
    return {"documents": docs}


@app.delete("/api/vault/{doc_name}")
def delete_vault_document(
    doc_name: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """
    Deletes an indexed document from SQL database, disk (both user dir and root dir), and Qdrant.
    Fixes BUG-02 where deleted documents reappeared on page refresh.
    """
    safe_doc = sanitize_filename(doc_name)
    user_id = user.id if user else None

    # 1. Remove from Qdrant vector store
    vs = get_vector_store()
    vs.delete_document(safe_doc, user_id=user_id)

    # 2. Remove from SQL database (VaultDocument table)
    if user:
        db.query(VaultDocument).filter(
            VaultDocument.user_id == user.id,
            VaultDocument.doc_name == safe_doc
        ).delete()
        db.commit()
    else:
        db.query(VaultDocument).filter(VaultDocument.doc_name == safe_doc).delete()
        db.commit()

    # 3. Remove physical files from user directory and root UPLOAD_DIR
    search_dirs = [UPLOAD_DIR / user.id, UPLOAD_DIR] if user else [UPLOAD_DIR]
    for d in search_dirs:
        if d.exists():
            for f in d.glob(f"*_{safe_doc}"):
                f.unlink(missing_ok=True)
            direct = d / safe_doc
            if direct.is_file():
                direct.unlink(missing_ok=True)

    return {
        "status": "success",
        "doc_name": safe_doc
    }


@app.post("/api/vault/{doc_name}/reindex")
def reindex_vault_document(
    doc_name: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Re-chunks and re-indexes an existing document with the latest chunking heuristics."""
    safe_doc = sanitize_filename(doc_name)
    target_file = locate_vault_file(safe_doc, user=user)
    if not target_file or not target_file.exists():
        raise HTTPException(status_code=404, detail=f"Document '{safe_doc}' not found on disk.")

    user_id = user.id if user else None
    vs = get_vector_store()
    vs.delete_document(safe_doc, user_id=user_id)

    if target_file.suffix.lower() == ".pdf":
        chunks = process_pdf_document(str(target_file), doc_name=safe_doc)
    else:
        with open(target_file, "r", encoding="utf-8", errors="ignore") as f:
            raw_txt = f.read()
        chunks = process_raw_text_document(raw_txt, doc_name=safe_doc)

    if user:
        for c in chunks:
            c["user_id"] = user.id

    indexed_count = vs.index_document_chunks(chunks)
    if user:
        v_doc = db.query(VaultDocument).filter(
            VaultDocument.user_id == user.id,
            VaultDocument.doc_name == safe_doc
        ).first()
        if v_doc:
            v_doc.chunk_count = indexed_count
            db.commit()

    return {
        "status": "success",
        "doc_name": safe_doc,
        "chunks_indexed": indexed_count,
        "message": f"Successfully re-indexed {indexed_count} chunks for {safe_doc}."
    }


@app.get("/api/vault/{doc_name}/preview")
def preview_vault_document(
    doc_name: str,
    user: Optional[User] = Depends(get_optional_user)
):
    """
    Returns full extracted text, page count, and chunk diagnostics for an uploaded document.
    Searches both user-scoped directory and root UPLOAD_DIR (Fixes BUG-01).
    """
    safe_doc = sanitize_filename(doc_name)
    target_file = locate_vault_file(safe_doc, user=user)
    if not target_file or not target_file.exists():
        raise HTTPException(status_code=404, detail=f"Document '{safe_doc}' not found on disk.")

    user_id = user.id if user else None
    vs = get_vector_store()
    chunks_count = vs.get_document_chunks_count(safe_doc, user_id=user_id)
    chunks = vs.get_document_chunks(safe_doc, user_id=user_id)

    page_count = 1
    extracted_text = ""

    if target_file.suffix.lower() == ".pdf":
        try:
            import pymupdf
            doc = pymupdf.open(str(target_file))
            page_count = len(doc)
            pages = []
            for p in doc:
                pages.append(p.get_text("text").strip())
            extracted_text = "\n\n--- Page Break ---\n\n".join(pages)
            doc.close()
        except Exception as e:
            extracted_text = f"Error reading PDF content: {str(e)}"
    else:
        try:
            with open(target_file, "r", encoding="utf-8", errors="ignore") as f:
                extracted_text = f.read()
        except Exception as e:
            extracted_text = f"Error reading document: {str(e)}"

    return {
        "doc_name": safe_doc,
        "filename": target_file.name,
        "size_kb": round(target_file.stat().st_size / 1024, 1),
        "page_count": page_count,
        "char_count": len(extracted_text),
        "chunks_indexed": chunks_count or len(chunks),
        "text": extracted_text,
        "chunks": chunks
    }


@app.get("/api/report/{report_id}/download/{fmt}")
def download_export(report_id: str, fmt: str):
    """Serves file downloads for md, txt, html, or json."""
    clean_id = sanitize_report_id(report_id)
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
