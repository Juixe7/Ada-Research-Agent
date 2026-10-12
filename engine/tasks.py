import os
import concurrent.futures
from pathlib import Path
from typing import List, Dict, Any, Optional
from engine.agents.planner import generate_research_plan
from engine.workers.research_worker import execute_sub_research
from engine.celery_app import celery_app, get_job_state, set_job_state

ROOT_DIR = Path(__file__).resolve().parent.parent
DOSSIER_DIR = ROOT_DIR / "dossiers"


def normalize_and_deduplicate_evidence(raw_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicates sources across all parallel workers and assigns standardized IDs (D1, D2.. for docs; S1, S2.. for web)."""
    seen_keys = set()
    clean_list = []
    doc_idx = 1
    web_idx = 1

    for item in raw_list:
        stype = item.get("source_type", "web")
        if stype == "user_doc":
            key = f"doc::{item.get('doc_name')}::p{item.get('page_number')}"
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


def run_research_pipeline_sync(
    query: str,
    depth: str = "deep",
    include_user_docs: bool = True,
    max_workers: int = 4,
    report_id: Optional[str] = None,
    selected_docs: Optional[List[str]] = None,
    custom_angles: Optional[List[str]] = None,
    clarification_choice: Optional[str] = None,
    user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Multi-Threaded autonomous deep research pipeline:
    1. Orthogonal DAG planning
    2. Concurrent web & private vault retrieval
    3. Adversarial Critic gap & contradiction audit
    4. Dynamic Arbiter resolution
    5. Long-context monograph synthesis
    6. Deterministic citation & claim grounding verification
    7. Multi-format artifact export
    """
    print(f"\n[pipeline] 1. Planning research for: '{query}'")
    plan = generate_research_plan(
        query=query,
        depth=depth,
        custom_angles=custom_angles,
        clarification_context=clarification_choice
    )
    print(f"[pipeline] Generated {len(plan)} sub-question tracks.")

    _update_stage(report_id, "scraping", f"Executing {len(plan)} parallel web & vector retrieval tracks...", 35)
    print(f"[pipeline] 2. Fanning out to {len(plan)} research workers concurrently...")
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(execute_sub_research, sub_task, include_user_docs, 2, selected_docs, user_id): sub_task
            for sub_task in plan
        }
        for future in concurrent.futures.as_completed(futures):
            sub_task = futures[future]
            try:
                data = future.result()
                results.append(data)
                print(f"  ✓ Finished track {data['sub_task_id']} ({data['category']}): {data['evidence_count']} sources in {data['duration_seconds']}s")
            except Exception as e:
                print(f"  ✗ Track failed for '{sub_task.get('sub_question')}': {e}")

    # Aggregate and deduplicate evidence across all workers
    raw_evidence = []
    for res in results:
        raw_evidence.extend(res.get("evidence", []))
    all_evidence = normalize_and_deduplicate_evidence(raw_evidence)

    # ── Step 3: Run Adversarial Critic & Auditor ──
    _update_stage(report_id, "critic", f"Auditing {len(all_evidence)} sources for contradictions and coverage gaps...", 60)
    print(f"\n[pipeline] 3. Running Adversarial Critic & Gap Auditor over {len(all_evidence)} sources...")
    from engine.agents.critic import audit_research_evidence
    critic_audit = audit_research_evidence(query, plan, all_evidence)
    print(f"[pipeline] Critic Coverage Score: {critic_audit.get('coverage_score', 80)}/100 ({critic_audit.get('coverage_quality', 'moderate')})")
    print(f"[pipeline] Gaps Identified: {len(critic_audit.get('identified_gaps', []))} | Contradictions: {len(critic_audit.get('contradictions', []))}")

    # ── Step 4: Execute Dynamic Arbiter Queries (if gaps/contradictions detected) ──
    arbiter_queries = critic_audit.get("arbiter_queries", [])
    arbiter_result = None
    if arbiter_queries:
        _update_stage(report_id, "arbiter", "Dispatching Arbiter queries to reconcile conflicting claims...", 72)
        print(f"[pipeline] 4. Dispatching Arbiter Task to resolve gaps: {arbiter_queries}")
        arbiter_sub_task = {
            "id": "ARBITER",
            "category": "contradiction_arbitration",
            "sub_question": "Arbitrate identified contradictions and knowledge gaps",
            "search_queries": arbiter_queries
        }
        arbiter_result = execute_sub_research(
            arbiter_sub_task,
            include_user_docs=include_user_docs,
            max_pages_to_scrape=2,
            selected_docs=selected_docs,
            user_id=user_id
        )
        print(f"  ✓ Arbiter gathered {arbiter_result['evidence_count']} clarifying sources in {arbiter_result['duration_seconds']}s")
        raw_evidence.extend(arbiter_result.get("evidence", []))
        all_evidence = normalize_and_deduplicate_evidence(raw_evidence)

    # ── Step 5: Synthesize Long-Form Research Dossier (Gemini 1M Context) ──
    _update_stage(report_id, "synthesizing", f"Synthesizing long-form monograph over {len(all_evidence)} verified sources...", 85)
    print(f"\n[pipeline] 5. Synthesizing full research dossier with Gemini 1M context over {len(all_evidence)} sources...")
    from engine.agents.synthesizer import synthesize_research_dossier
    raw_dossier_markdown = synthesize_research_dossier(query, all_evidence, critic_audit)

    # ── Step 6: Deterministic Citation Grounding & Verification ──
    print(f"[pipeline] 6. Verifying citation grounding and eliminating hallucinations...")
    from engine.guards.citation_guard import verify_and_ground_citations
    guard_results = verify_and_ground_citations(raw_dossier_markdown, all_evidence)
    print(f"[pipeline] Faithfulness Score: {round(guard_results['faithfulness_score']*100, 1)}% | Cited Sources: {guard_results['unique_valid_sources_cited']}")
    if guard_results['hallucinated_sources_count'] > 0:
        print(f"[pipeline] Cleaned {guard_results['hallucinated_sources_count']} unverified citation tags ({guard_results.get('rejected_claims_count', 0)} unrecorded claims rejected).")

    # ── Step 7: Export Dossier Artifacts (Markdown, JSON, HTML) ──
    print(f"[pipeline] 7. Exporting multi-format research dossier...")
    from engine.export.exporter import export_research_dossier
    export_paths = export_research_dossier(
        query=query,
        final_report_markdown=guard_results["cleaned_markdown"],
        guard_results=guard_results,
        critic_audit=critic_audit,
        evidence_manifest=all_evidence,
        report_id=report_id
    )

    return {
        "report_id": export_paths["report_id"],
        "query": query,
        "executive_title": export_paths.get("executive_title", query),
        "plan": plan,
        "sub_tasks_count": len(results),
        "total_evidence_units": len(all_evidence),
        "sub_task_results": results,
        "critic_audit": critic_audit,
        "arbiter_executed": bool(arbiter_queries),
        "arbiter_result": arbiter_result,
        "evidence_manifest": all_evidence,
        "guard_results": guard_results,
        "citation_index": guard_results.get("citation_index", {}),
        "faithfulness_score": guard_results.get("faithfulness_score", 1.0),
        "coverage_score": critic_audit.get("coverage_score", 85),
        "total_sources_cited": guard_results.get("unique_valid_sources_cited", 0),
        "report_markdown": guard_results["cleaned_markdown"],
        "export_paths": export_paths
    }


@celery_app.task(name="ada.run_research_pipeline")
def run_research_pipeline_task(
    report_id: str,
    session_id: Optional[str],
    query: str,
    depth: str = "deep",
    include_user_docs: bool = True,
    selected_docs: Optional[List[str]] = None,
    custom_angles: Optional[List[str]] = None,
    clarification_choice: Optional[str] = None,
    user_id: Optional[str] = None
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
            user_id=user_id
        )

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
        set_job_state(report_id, completed_state)

        db_turn = task_db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first()
        if db_turn:
            db_turn.status = "completed"
            db_turn.progress = 100
            db_turn.stage = "Completed"
            db_turn.executive_title = result.get("executive_title") or query[:120]
            export_paths = result.get("export_paths", {})
            json_path = export_paths.get("json_path") or export_paths.get("json") or str(DOSSIER_DIR / f"dossier_{report_id}.json")
            db_turn.report_json_path = json_path
            task_db.commit()

        return {"status": "completed", "report_id": report_id}

    except Exception as e:
        current = get_job_state(report_id)
        if current and current.get("status") == "cancelled":
            return {"status": "cancelled", "report_id": report_id}

        print(f"[worker] Error in research job {report_id}: {e}")
        failed_state = {
            "report_id": report_id,
            "session_id": session_id,
            "query": query,
            "depth": depth,
            "selected_docs": selected_docs or [],
            "status": "failed",
            "stage": f"Failed: {str(e)}",
            "progress": 0,
            "result": None,
            "error": str(e)
        }
        set_job_state(report_id, failed_state)

        db_turn = task_db.query(ResearchTurn).filter(ResearchTurn.id == report_id).first()
        if db_turn:
            db_turn.status = "failed"
            db_turn.stage = f"Failed: {str(e)}"
            task_db.commit()
        return {"status": "failed", "report_id": report_id, "error": str(e)}
    finally:
        task_db.close()
