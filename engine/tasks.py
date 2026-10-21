"""Synchronous research orchestration and Celery task entry points.

"""

import os
import concurrent.futures
import hashlib
import logging
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from engine.agents.planner import generate_research_plan
from engine.workers.research_worker import execute_sub_research
from engine.celery_app import celery_app, get_job_state, set_job_state

ROOT_DIR = Path(__file__).resolve().parent.parent
DOSSIER_DIR = ROOT_DIR / "dossiers"
logger = logging.getLogger(__name__)


def normalize_and_deduplicate_evidence(raw_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicates sources across all parallel workers and assigns standardized IDs (D1, D2.. for docs; S1, S2.. for web)."""
    seen_keys = set()
    clean_list = []
    doc_idx = 1
    web_idx = 1

    for item in raw_list:
        stype = item.get("source_type", "web")
        if stype == "user_doc":
            passage_id = item.get("chunk_id")
            if not passage_id:
                normalized_text = re.sub(r"\s+", " ", item.get("text", "")).strip().casefold()
                passage_id = hashlib.sha256(normalized_text.encode("utf-8")).hexdigest()
            key = f"doc::{item.get('doc_name')}::{passage_id}"
            if key not in seen_keys:
                seen_keys.add(key)
                item["source_id"] = f"D{doc_idx}"
                doc_idx += 1
                clean_list.append(item)
        else:
            url = item.get("url", "").split("?")[0].rstrip("/")
            key = f"web::{url}" if url else f"title::{item.get('title', '')[:40]}"
            if key not in seen_keys:
                seen_keys.add(key)
                item["source_id"] = f"S{web_idx}"
                web_idx += 1
                clean_list.append(item)

    return clean_list


def _update_stage(report_id: Optional[str], status: str, stage: str, progress: int) -> bool:
    """Updates shared Redis/in-memory job progress and returns False if the job was cancelled."""
    if not report_id:
        return True
    current = get_job_state(report_id) or {"report_id": report_id}
    if current.get("status") == "cancelled":
        return False
    current["status"] = status
    current["stage"] = stage
    current["progress"] = progress
    set_job_state(report_id, current)
    return True


def _persist_failed_turn(task_db: Session, report_id: str) -> None:
    """Best-effort persist a failed turn, recovering the session after DB errors."""
    try:
        # A preceding failed commit leaves the SQLAlchemy session in a failed
        # transaction until rollback; rollback is harmless when no txn is active.
        task_db.rollback()
        from engine.models import ResearchTurn

        db_turn = task_db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first()
        if db_turn:
            db_turn.status = "failed"
            db_turn.stage = "Research run failed."
            task_db.commit()
    except Exception:
        task_db.rollback()
        logger.exception("Could not persist failed status for research run %s", report_id)

    try:
        from engine.storage.relational_store import RelationalStore

        RelationalStore.update_run_status(
            run_id=report_id,
            status="failed",
            stage="Research run failed.",
            error="Research failed. Check server logs and run telemetry for details.",
        )
    except Exception:
        logger.exception("Could not persist normalized failure status for run %s", report_id)


def run_research_pipeline_sync(
    query: str,
    depth: str = "deep",
    include_user_docs: bool = True,
    max_workers: int = 4,
    report_id: Optional[str] = None,
    selected_docs: Optional[List[str]] = None,
    custom_angles: Optional[List[str]] = None,
    clarification_choice: Optional[str] = None,
    user_id: Optional[str] = None,
    blocked_domains: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Executes the autonomous deep research pipeline using the compiled LangGraph StateGraph:
    1. Scope & Brief formulation
    2. Orthogonal DAG planning
    3. Bounded iterative researcher loops across web & vault
    4. Adversarial Critic gap & contradiction audit
    5. Dynamic Arbiter resolution loop
    6. Section-by-section synthesis with deterministic structured tables
    7. Whole-report assembly & Executive Intelligence Briefing
    8. Deterministic citation grounding & verification
    9. Multi-format artifact export & Relational persistence
    """
    from engine.graph.pipeline import execute_graph_pipeline
    from engine.storage.relational_store import RelationalStore

    print(f"\n[pipeline] Starting LangGraph Research Pipeline for: '{query}' (depth={depth})")

    # Initialize run record in relational database
    if report_id:
        try:
            RelationalStore.create_run(
                question=query,
                settings={"depth": depth, "include_user_docs": include_user_docs, "selected_docs": selected_docs, "custom_angles": custom_angles, "blocked_domains": blocked_domains or []},
                user_id=user_id,
                run_id=report_id,
                plan=[]
            )
        except Exception as e:
            print(f"[pipeline] Relational run init notice: {e}")

    # Execute compiled LangGraph StateGraph
    final_state = execute_graph_pipeline(
        query=query,
        depth=depth,
        include_user_docs=include_user_docs,
        report_id=report_id,
        selected_docs=selected_docs,
        custom_angles=custom_angles,
        clarification_choice=clarification_choice,
        user_id=user_id,
        blocked_domains=blocked_domains,
    )

    export_paths = final_state.get("export_paths") or {}
    guard_results = final_state.get("guard_results") or {}
    scores = final_state.get("scores") or {}
    plan = final_state.get("plan") or []
    all_evidence = final_state.get("evidence_manifest") or []
    critic_findings = final_state.get("critic_findings") or {}

    return {
        "report_id": export_paths.get("report_id", report_id),
        "query": query,
        "executive_title": export_paths.get("executive_title", query),
        "plan": plan,
        "sub_tasks_count": len(plan),
        "total_evidence_units": len(all_evidence),
        "sub_task_results": final_state.get("track_status", {}),
        "critic_audit": critic_findings,
        "arbiter_executed": final_state.get("round", 0) > 1,
        "evidence_manifest": all_evidence,
        "guard_results": guard_results,
        "citation_index": guard_results.get("citation_index", {}),
        "faithfulness_score": scores.get("faithfulness"),
        "coverage_score": int(scores["coverage"] * 100) if scores.get("coverage") is not None else None,
        "relevancy_score": scores.get("relevancy"),
        "authority_score": scores.get("authority"),
        "citation_validity_score": scores.get("citation_validity"),
        "research_warnings": final_state.get("warnings", []),
        "total_sources_cited": guard_results.get("unique_valid_sources_cited", 0),
        "report_markdown": final_state.get("report_markdown", ""),
        "export_paths": export_paths,
        "sections": final_state.get("sections", {}),
        "outline": final_state.get("outline", [])
    }


@celery_app.task(name="ada.run_research_pipeline", queue="orchestrate")
def run_research_pipeline_task(
    report_id: str,
    session_id: Optional[str],
    query: str,
    depth: str = "deep",
    include_user_docs: bool = True,
    selected_docs: Optional[List[str]] = None,
    custom_angles: Optional[List[str]] = None,
    clarification_choice: Optional[str] = None,
    user_id: Optional[str] = None,
    blocked_domains: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Celery distributed worker task entrypoint (also callable directly via FastAPI BackgroundTasks in local dev).
    Synchronizes job progress via Redis (`ada:job:<report_id>`) and persists final Turn metadata in PostgreSQL/SQLite.
    """
    from engine.database import SessionLocal
    from engine.models import ResearchTurn

    task_db = SessionLocal()
    try:
        current = get_job_state(report_id)
        if current and current.get("status") == "cancelled":
            return {"status": "cancelled", "report_id": report_id}

        _update_stage(report_id, "scraping", "Executing distributed multi-source web & document retrieval...", 30)

        result = run_research_pipeline_sync(
            query=query,
            depth=depth,
            include_user_docs=include_user_docs,
            max_workers=4,
            report_id=report_id,
            selected_docs=selected_docs,
            custom_angles=custom_angles,
            clarification_choice=clarification_choice,
            user_id=user_id,
            blocked_domains=blocked_domains,
        )

        if not (result.get("report_markdown") or "").strip():
            raise RuntimeError("Research pipeline returned no report content.")

        after = get_job_state(report_id)
        if after and after.get("status") == "cancelled":
            return {"status": "cancelled", "report_id": report_id}

        result["session_id"] = session_id
        completed_state = {
            "report_id": report_id,
            "session_id": session_id,
            "query": query,
            "depth": depth,
            "selected_docs": selected_docs or [],
            "status": "completed",
            "stage": "Investigation synthesized and verified.",
            "progress": 100,
            "result": result,
            "error": None
        }
        db_turn = task_db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first()
        if not db_turn:
            raise RuntimeError("Research run record disappeared before completion.")
        db_turn.status = "completed"
        db_turn.progress = 100
        db_turn.stage = "Completed"
        db_turn.executive_title = result.get("executive_title") or query[:120]
        export_paths = result.get("export_paths", {})
        json_path = export_paths.get("json_path") or export_paths.get("json") or str(DOSSIER_DIR / f"dossier_{report_id}.json")
        db_turn.report_json_path = json_path
        task_db.commit()
        from engine.storage.relational_store import RelationalStore

        RelationalStore.update_run_status(
            run_id=report_id,
            status="completed",
            stage="Investigation synthesized and verified.",
            progress=100,
        )
        # Publish completion only after the durable turn status is committed.
        set_job_state(report_id, completed_state)
        try:
            from engine.events import publish_event

            publish_event(report_id, "run_completed", {
                "report_id": report_id,
                "executive_title": result.get("executive_title") or query,
                "stage": completed_state["stage"],
            })
        except Exception:
            logger.exception("Could not publish completed event for run %s", report_id)

        return {"status": "completed", "report_id": report_id}

    except Exception:
        current = get_job_state(report_id)
        if current and current.get("status") == "cancelled":
            return {"status": "cancelled", "report_id": report_id}

        logger.exception("Research worker failed for run %s", report_id)
        safe_error = "Research could not be completed. Check server logs and run telemetry for details."
        failed_state = {
            "report_id": report_id,
            "session_id": session_id,
            "query": query,
            "depth": depth,
            "selected_docs": selected_docs or [],
            "status": "failed",
            "stage": "Research run failed.",
            "progress": 0,
            "result": None,
            "error": safe_error,
        }
        set_job_state(report_id, failed_state)
        _persist_failed_turn(task_db, report_id)
        try:
            from engine.events import publish_event

            publish_event(report_id, "run_failed", {"error": safe_error})
        except Exception:
            logger.exception("Could not publish failed event for run %s", report_id)
        return {"status": "failed", "report_id": report_id, "error": safe_error}
    finally:
        task_db.close()
