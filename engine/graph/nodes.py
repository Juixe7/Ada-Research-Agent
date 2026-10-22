"""State-transforming LangGraph nodes for research, review, synthesis, validation, and finalization.

"""

import concurrent.futures
import hashlib
import logging
import re
from typing import Dict, Any, List, Optional
from urllib.parse import urlsplit, urlunsplit
from engine.graph.state import RunState
from engine.celery_app import get_job_state, set_job_state
from engine.agents.planner import generate_research_plan
from engine.workers.research_worker import execute_iterative_sub_research, execute_sub_research
from engine.agents.critic import audit_research_evidence
from engine.agents.sectional_synthesizer import generate_outline, synthesize_section, assemble_final_dossier
from engine.guards.citation_guard import verify_and_ground_citations, extract_cited_claims
from engine.agents.claim_verifier import verify_claims
from engine.export.exporter import export_research_dossier
from engine.storage.relational_store import RelationalStore
from engine.events import publish_event
from engine.config import RESEARCH_CONCURRENCY

logger = logging.getLogger(__name__)

_NASA_PUBLISHER_SUFFIX_RE = re.compile(
    r"\s*(?:\||[-–—])\s*nasa\s+(?:science|jet propulsion laboratory(?:\s*\(jpl\))?|jpl)\s*$",
    re.IGNORECASE,
)


def _web_title_fingerprint(title: str) -> str:
    """Normalize NASA-branded titles to identify syndicated announcement copies."""
    normalized = _NASA_PUBLISHER_SUFFIX_RE.sub("", title or "").casefold()
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()

def _notify_stage(run_id: Optional[str], status: str, stage: str, progress: int, extra: Optional[Dict[str, Any]] = None):
    """Pushes job progress to Redis/memory state, updates relational store, and broadcasts SSE stage_changed event."""
    if not run_id:
        return
    current = get_job_state(run_id) or {"report_id": run_id}
    if current.get("status") == "cancelled":
        return
    current["status"] = status
    current["stage"] = stage
    current["progress"] = progress
    set_job_state(run_id, current)
    try:
        RelationalStore.update_run_status(run_id=run_id, status=status, stage=stage, progress=progress)
    except Exception:
        logger.exception("Could not persist stage for run %s", run_id)
    try:
        event_payload = {"status": status, "stage": stage, "progress": progress}
        if extra:
            event_payload.update(extra)
        publish_event(run_id, "stage_changed", event_payload)
    except Exception:
        logger.exception("Could not publish stage event for run %s", run_id)


def _is_cancelled(run_id: Optional[str]) -> bool:
    """Return whether the latest job state marks this run as cancelled."""
    if not run_id:
        return False
    current = get_job_state(run_id)
    return bool(current and current.get("status") == "cancelled")

def normalize_and_deduplicate_evidence(raw_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate repeated passages and obvious syndicated NASA copies.

    Exact content/URL duplicates are merged as before. Long identical headlines
    with common NASA publisher suffixes are also collapsed to one citation; the
    retained record aggregates originating track IDs and alternate URLs.
    """
    seen_keys: Dict[str, Dict[str, Any]] = {}
    seen_web_titles: Dict[str, Dict[str, Any]] = {}
    clean_list = []
    doc_idx = 1
    web_idx = 1

    # Let the strongest available web source win when a headline is syndicated.
    ordered_items = sorted(
        raw_list,
        key=lambda item: float(item.get("authority_score") or 0) if item.get("source_type", "web") != "user_doc" else -1,
        reverse=True,
    )

    for item in ordered_items:
        stype = item.get("source_type", "web")
        if stype == "user_doc":
            passage_id = item.get("chunk_id")
            if not passage_id:
                normalized_text = re.sub(r"\s+", " ", item.get("text", "")).strip().casefold()
                passage_id = hashlib.sha256(normalized_text.encode("utf-8")).hexdigest()
            key = f"doc::{item.get('doc_name')}::{passage_id}"
            if key not in seen_keys:
                item["source_id"] = f"D{doc_idx}"
                item["track_ids"] = list(dict.fromkeys([str(item.get("track_id", ""))] if item.get("track_id") else []))
                doc_idx += 1
                seen_keys[key] = item
                clean_list.append(item)
            else:
                existing = seen_keys[key]
                if existing and item.get("track_id"):
                    existing["track_ids"] = list(dict.fromkeys([*(existing.get("track_ids") or []), str(item["track_id"])]))
        else:
            raw_url = item.get("canonical_url") or item.get("url") or ""
            parts = urlsplit(raw_url)
            host = (parts.hostname or "").lower().removeprefix("www.")
            path = parts.path.rstrip("/")
            canonical_url = urlunsplit((parts.scheme.lower(), host, path, "", "")) if host else ""
            item["canonical_url"] = canonical_url or None
            content_hash = item.get("content_hash")
            key = f"content::{content_hash}" if content_hash else f"web::{canonical_url}" if canonical_url else f"title::{item.get('title', '')[:40]}"
            title_fingerprint = _web_title_fingerprint(item.get("title", ""))
            title_key = title_fingerprint if len(title_fingerprint.split()) >= 6 else ""
            web_existing = seen_keys.get(key) or (seen_web_titles.get(title_key) if title_key else None)
            if not web_existing:
                item["source_id"] = f"S{web_idx}"
                item["track_ids"] = list(dict.fromkeys([str(item.get("track_id", ""))] if item.get("track_id") else []))
                web_idx += 1
                seen_keys[key] = item
                if title_key:
                    seen_web_titles[title_key] = item
                clean_list.append(item)
            else:
                if web_existing and item.get("track_id"):
                    web_existing["track_ids"] = list(dict.fromkeys([*(web_existing.get("track_ids") or []), str(item["track_id"])]))
                if web_existing and item.get("url") and item.get("url") != web_existing.get("url"):
                    web_existing.setdefault("alternate_source_urls", [])
                    if item["url"] not in web_existing["alternate_source_urls"]:
                        web_existing["alternate_source_urls"].append(item["url"])

    return clean_list


def scope_node(state: RunState) -> Dict[str, Any]:
    """Node 1: Formulates the research brief, parameters, and initializes run state."""
    run_id = state.get("run_id")
    query = state.get("query", "")
    settings = state.get("settings", {})
    if _is_cancelled(run_id):
        return {}

    _notify_stage(run_id, "scoping", "Scoping research brief and parameter boundaries...", 10)

    brief = {
        "query": query,
        "depth": settings.get("depth", "standard"),
        "include_user_docs": settings.get("include_user_docs", True),
        "custom_angles": settings.get("custom_angles", []),
        "selected_docs": settings.get("selected_docs", [])
    }
    return {
        "brief": brief,
        "track_status": {},
        "round": 0,
        "max_rounds": 2 if settings.get("depth") == "deep" else 1,
        "warnings": list(state.get("warnings", [])),
    }


def plan_node(state: RunState) -> Dict[str, Any]:
    """Node 2: Decomposes the brief into 3-6 orthogonal research tracks."""
    run_id = state.get("run_id")
    query = state.get("query", "")
    settings = state.get("settings", {})
    if _is_cancelled(run_id):
        return {}

    _notify_stage(run_id, "planning", "Decomposing research query into orthogonal investigation tracks...", 20)

    plan = generate_research_plan(
        query=query,
        depth=settings.get("depth", "standard"),
        custom_angles=settings.get("custom_angles"),
        clarification_context=settings.get("clarification_choice"),
        run_id=run_id,
    )

    if run_id:
        try:
            RelationalStore.save_tracks(run_id, plan)
            for track in plan:
                publish_event(run_id, "query_issued", {
                    "track_id": track.get("id"),
                    "category": track.get("category"),
                    "sub_question": track.get("sub_question"),
                    "queries": track.get("search_queries", [])
                })
        except Exception:
            logger.exception("Could not persist planned tracks for run %s", run_id)

    return {
        "plan": plan,
        "track_status": {str(t.get("id", i)): "planned" for i, t in enumerate(plan)}
    }


def research_node(state: RunState) -> Dict[str, Any]:
    """Node 3: Executes bounded iterative research loops across parallel tracks."""
    run_id = state.get("run_id")
    plan = state.get("plan", [])
    settings = state.get("settings", {})
    depth = settings.get("depth", "standard")
    include_user_docs = settings.get("include_user_docs", True)
    selected_docs = settings.get("selected_docs")
    user_id = settings.get("user_id")
    blocked_domains = settings.get("blocked_domains") or []
    budget = state.get("resource_budget")
    if _is_cancelled(run_id):
        return {}
    cancel_check = lambda: _is_cancelled(run_id)

    # Determine max iterations per track based on depth
    max_iter = 1 if depth == "quick" else (3 if depth == "deep" else 2)

    _notify_stage(run_id, "scraping", f"Executing iterative research loops across {len(plan)} tracks...", 35)

    raw_results = []
    research_warnings = list(state.get("warnings", []))
    track_status = dict(state.get("track_status", {}))

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(RESEARCH_CONCURRENCY, len(plan) or 1)) as executor:
        futures = {
            executor.submit(
                execute_iterative_sub_research,
                track,
                max_iter,
                include_user_docs,
                2,
                selected_docs,
                user_id,
                blocked_domains,
                cancel_check,
                budget,
            ): track
            for track in plan
        }
        for future in concurrent.futures.as_completed(futures):
            track = futures[future]
            tid = str(track.get("id", "track"))
            try:
                res = future.result()
                raw_results.append(res)
                track_status[tid] = "completed"
                for message in res.get("warnings", []):
                    warning = f"Track {tid}: {message}"
                    if warning not in research_warnings:
                        research_warnings.append(warning)
                        if run_id:
                            publish_event(run_id, "research_warning", {"track_id": tid, "message": warning})
            except Exception:
                logger.exception("Research track %s failed in run %s", tid, run_id)
                track_status[tid] = "failed"
                warning = f"Track {tid}: research failed before evidence could be retrieved."
                research_warnings.append(warning)
                if run_id:
                    publish_event(run_id, "research_warning", {"track_id": tid, "message": warning})

    # Attach the originating research track before cross-track deduplication.
    all_raw_evidence = []
    for r in raw_results:
        for item in r.get("evidence", []):
            item["track_id"] = str(r.get("sub_task_id", ""))
            all_raw_evidence.append(item)

    all_evidence = normalize_and_deduplicate_evidence(all_raw_evidence)
    if budget:
        usage = budget.snapshot()
        if usage["limits_reached"]:
            budget_warning = "Research stopped at a configured run limit; report coverage may be incomplete."
            if budget_warning not in research_warnings:
                research_warnings.append(budget_warning)
            if run_id:
                publish_event(run_id, "research_warning", {"stage": "research", "message": budget_warning, "budget": usage})

    if run_id:
        try:
            RelationalStore.save_sources_and_evidence(run_id, all_evidence)
            plan_by_id = {str(t.get("id", "")): t for t in plan}
            for result in raw_results:
                track = plan_by_id.get(str(result.get("sub_task_id", "")), {})
                title = track.get("sub_question") or result.get("sub_question") or "Research Track"
                RelationalStore.update_track_stats(
                    run_id=run_id,
                    title=title,
                    status="completed",
                    stats={
                        "sources_found": result.get("evidence_count", 0),
                        "iterations": result.get("iterations_completed", 1),
                        "duration_sec": result.get("duration_seconds", 0),
                    },
                )
            for track in plan:
                if track_status.get(str(track.get("id", ""))) == "failed":
                    RelationalStore.update_track_stats(run_id, track.get("sub_question", "Research Track"), "failed", {})
            for s in all_evidence:
                publish_event(run_id, "source_discovered", {
                    "source_id": s.get("source_id"),
                    "source_type": s.get("source_type"),
                    "title": s.get("title"),
                    "url": s.get("url"),
                    "domain": s.get("domain"),
                    "authority_score": s.get("authority_score"),
                    "track_id": s.get("track_id"),
                })
            publish_event(run_id, "evidence_extracted", {
                "total_evidence_units": len(all_evidence),
                "tracks_completed": len([t for t in track_status.values() if t == "completed"])
            })
        except Exception:
            logger.exception("Could not persist evidence for run %s", run_id)

    return {
        "evidence_manifest": all_evidence,
        "track_status": track_status,
        "warnings": research_warnings
    }


def critic_node(state: RunState) -> Dict[str, Any]:
    """Node 4: Adversarial Critic audits evidence for knowledge gaps and conflicting claims."""
    run_id = state.get("run_id")
    query = state.get("query", "")
    plan = state.get("plan", [])
    evidence = state.get("evidence_manifest", [])
    current_round = state.get("round", 0) + 1
    if _is_cancelled(run_id):
        return {}

    _notify_stage(run_id, "critic", f"Adversarial Critic auditing {len(evidence)} sources (Round {current_round})...", 55)

    critic_audit = audit_research_evidence(query, plan, evidence, run_id=run_id)
    warnings = list(state.get("warnings", []))
    if critic_audit.get("status") == "unavailable":
        warning = critic_audit.get("warning", "Evidence critique was unavailable.")
        if warning not in warnings:
            warnings.append(warning)
        if run_id:
            publish_event(run_id, "research_warning", {"stage": "critic", "message": warning})

    if run_id:
        try:
            RelationalStore.save_critic_findings(run_id, critic_audit)
            for g in critic_audit.get("identified_gaps", []):
                publish_event(run_id, "finding_raised", {
                    "type": "gap",
                    "description": g,
                    "round": current_round
                })
            for c in critic_audit.get("contradictions", []):
                publish_event(run_id, "finding_raised", {
                    "type": "contradiction",
                    "topic": c.get("topic"),
                    "claim_a": c.get("claim_a"),
                    "claim_b": c.get("claim_b"),
                    "round": current_round
                })
        except Exception:
            logger.exception("Could not persist critic findings for run %s", run_id)

    return {
        "critic_findings": critic_audit,
        "round": current_round,
        "arbiter_queries": critic_audit.get("arbiter_queries", []),
        "warnings": warnings,
    }


def arbiter_node(state: RunState) -> Dict[str, Any]:
    """Node 5: Dynamic Arbiter performs targeted followup retrieval to reconcile gaps."""
    run_id = state.get("run_id")
    arbiter_queries = state.get("arbiter_queries", [])
    settings = state.get("settings", {})
    evidence = list(state.get("evidence_manifest", []))
    if _is_cancelled(run_id):
        return {}

    _notify_stage(run_id, "arbiter", f"Arbiter resolving {len(arbiter_queries)} identified contradictions...", 70)

    if run_id:
        publish_event(run_id, "query_issued", {
            "track_id": "ARBITER",
            "category": "contradiction_arbitration",
            "queries": arbiter_queries
        })

    arbiter_sub_task = {
        "id": "ARBITER",
        "category": "contradiction_arbitration",
        "sub_question": "Arbitrate identified contradictions and knowledge gaps",
        "search_queries": arbiter_queries
    }

    arbiter_result = execute_sub_research(
        arbiter_sub_task,
        include_user_docs=settings.get("include_user_docs", True),
        max_pages_to_scrape=2,
        selected_docs=settings.get("selected_docs"),
        user_id=settings.get("user_id"),
        blocked_domains=settings.get("blocked_domains") or [],
        cancel_check=lambda: _is_cancelled(run_id),
        budget=state.get("resource_budget"),
    )

    new_raw = evidence + arbiter_result.get("evidence", [])
    clean_evidence = normalize_and_deduplicate_evidence(new_raw)

    if run_id:
        try:
            RelationalStore.save_sources_and_evidence(run_id, clean_evidence)
        except Exception:
            logger.exception("Could not persist arbiter evidence for run %s", run_id)

    return {
        "evidence_manifest": clean_evidence,
        "arbiter_queries": []
    }


def outline_node(state: RunState) -> Dict[str, Any]:
    """Node 6: Decomposes dossier into structured SectionSpecs with deterministic metric tables."""
    run_id = state.get("run_id")
    query = state.get("query", "")
    plan = state.get("plan", [])
    evidence = state.get("evidence_manifest", [])
    critic = state.get("critic_findings", {})
    if _is_cancelled(run_id):
        return {}

    _notify_stage(run_id, "outlining", "Constructing sectional outline and verified metric tables...", 75)

    outline = generate_outline(query, plan, evidence, critic)
    return {"outline": outline}


def synthesize_sections_node(state: RunState) -> Dict[str, Any]:
    """Node 7: Synthesizes report section by section from assigned evidence subsets."""
    run_id = state.get("run_id")
    query = state.get("query", "")
    outline = state.get("outline", [])
    evidence = state.get("evidence_manifest", [])
    if _is_cancelled(run_id):
        return {}

    evidence_by_id = {e.get("source_id", ""): e for e in evidence if e.get("source_id")}
    section_drafts = {}

    for i, sec in enumerate(outline):
        progress = 80 + int((i / max(1, len(outline))) * 10)
        _notify_stage(run_id, "synthesizing", f"Drafting section: {sec['title'][:40]}...", progress)
        draft = synthesize_section(sec, query, evidence_by_id, run_id=run_id)
        section_drafts[sec["id"]] = draft

        if run_id:
            publish_event(run_id, "section_drafted", {
                "section_id": sec["id"],
                "title": sec["title"],
                "progress": progress,
                "preview": draft[:300] if draft else ""
            })

    return {"sections": section_drafts}


def assemble_node(state: RunState) -> Dict[str, Any]:
    """Node 8: Stitches sections, authors Executive Intelligence Briefing last, and attaches Bibliography."""
    run_id = state.get("run_id")
    query = state.get("query", "")
    sections = state.get("sections", {})
    if _is_cancelled(run_id):
        return {}
    outline = state.get("outline", [])
    evidence = state.get("evidence_manifest", [])

    _notify_stage(run_id, "assembling", "Assembling full monograph and writing Executive Intelligence Briefing...", 90)

    assembled_md = assemble_final_dossier(query, sections, outline, evidence, run_id=run_id)
    return {"report_markdown": assembled_md}


def verify_node(state: RunState) -> Dict[str, Any]:
    """Node 9: Deterministic citation and claim grounding verification."""
    run_id = state.get("run_id")
    report_md = state.get("report_markdown") or ""
    evidence = state.get("evidence_manifest", [])
    if _is_cancelled(run_id):
        return {}

    _notify_stage(run_id, "verifying", "Running deterministic citation grounding & verification...", 94)

    reference_check = verify_and_ground_citations(report_md, evidence)
    reference_clean_report = reference_check.get("cleaned_markdown") or report_md
    cited_claims = extract_cited_claims(reference_clean_report, evidence)
    sources_by_id = {
        str(source_id): source
        for source in evidence
        if (source_id := source.get("source_id"))
    }
    verdicts = verify_claims(cited_claims, sources_by_id, run_id=run_id)
    guard_results = verify_and_ground_citations(reference_clean_report, evidence, verdicts)
    if cited_claims and not verdicts:
        guard_results["verification_warning"] = "Claim entailment could not be measured because the judge provider did not return a valid audit."
    guard_results["citation_validity_score"] = reference_check.get("citation_validity_score")

    if run_id:
        publish_event(run_id, "verification_completed", {
            "faithfulness_score": guard_results.get("faithfulness_score"),
            "citation_validity_score": guard_results.get("citation_validity_score"),
            "claims_audited": guard_results.get("claims_audited", 0),
            "unique_valid_sources": guard_results.get("unique_valid_sources_cited", 0),
            "unmatched_citation_ids": guard_results.get("hallucinated_sources_count", 0)
        })

    return {
        "report_markdown": guard_results.get("cleaned_markdown", report_md),
        "guard_results": guard_results
    }


def score_node(state: RunState) -> Dict[str, Any]:
    """Node 10: Calculates faithfulness, relevancy, authority, and coverage scores."""
    run_id = state.get("run_id")
    guard = state.get("guard_results") or {}
    evidence = state.get("evidence_manifest", [])
    if _is_cancelled(run_id):
        return {}

    _notify_stage(run_id, "scoring", "Computing research quality, faithfulness, and coverage scores...", 97)

    from engine.agents.claim_verifier import evaluate_track_relevance
    plan = state.get("plan", [])
    relevance_result = evaluate_track_relevance(plan, evidence, run_id=run_id)
    from engine.metrics import calculate_research_metrics
    metric_result = calculate_research_metrics(plan, evidence, relevance_result, guard.get("faithfulness_score"))
    scores = metric_result["scores"]

    budget = state.get("resource_budget")
    budget_snapshot = budget.snapshot() if budget is not None else None
    if run_id:
        try:
            RelationalStore.save_scores(
                run_id=run_id,
                faithfulness=scores["faithfulness"],
                relevancy=scores["relevancy"],
                authority=scores["authority"],
                coverage=scores["coverage"],
                details={
                    "citation_validity": guard.get("citation_validity_score"),
                    "claims_audited": guard.get("claims_audited", 0),
                    "claims_supported": guard.get("claims_supported", 0),
                    **metric_result["details"],
                    "research_budget": budget_snapshot,
                }
            )
        except Exception:
            logger.exception("Could not persist evaluation scores for run %s", run_id)

    return {"scores": scores}


def finalize_node(state: RunState) -> Dict[str, Any]:
    """Node 11: Exports multi-format artifacts and finalizes run state in database."""
    run_id = state.get("run_id")
    query = state.get("query", "")
    report_md = state.get("report_markdown") or ""
    if _is_cancelled(run_id):
        return {}
    if not report_md.strip():
        raise ValueError("Cannot finalize a research run without report markdown.")
    guard = state.get("guard_results") or {}
    critic = state.get("critic_findings") or {}
    evidence = state.get("evidence_manifest", [])

    _notify_stage(run_id, "exporting", "Exporting dossier artifacts (Markdown, JSON, HTML)...", 99)
    budget = state.get("resource_budget")
    budget_usage = budget.snapshot() if budget else None
    warnings = list(state.get("warnings", []))
    if budget_usage and budget_usage.get("limits_reached"):
        warning = "One or more configured run limits were reached; the report may have incomplete coverage."
        if warning not in warnings:
            warnings.append(warning)
        if run_id:
            publish_event(run_id, "research_warning", {
                "stage": "finalization",
                "message": warning,
                "budget": budget_usage,
            })

    export_paths = export_research_dossier(
        query=query,
        final_report_markdown=report_md,
        guard_results=guard,
        critic_audit=critic,
        evidence_manifest=evidence,
        report_id=run_id,
        scores=state.get("scores", {}),
        research_warnings=warnings,
        budget_usage=budget_usage,
    )

    if run_id:
        try:
            if budget_usage:
                RelationalStore.update_research_budget(run_id, budget_usage)
            RelationalStore.save_report_and_claims(
                run_id=run_id,
                markdown=report_md,
                guard_results=guard
            )
            # The worker owns the terminal transition after it has validated
            # the artifact and committed the durable session turn.
            _notify_stage(run_id, "exporting", "Final report saved; confirming run status...", 99)
        except Exception:
            logger.exception("Could not finalize relational records for run %s", run_id)

    return {"export_paths": export_paths, "warnings": warnings}
