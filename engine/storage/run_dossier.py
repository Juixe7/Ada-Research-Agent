"""Build the report-facing view of a persisted research run.

Database access stays in :mod:`engine.storage.relational_store`; this module
maps the loaded records into the stable dictionary consumed by report and
inspection services.
"""

from __future__ import annotations

from typing import Any, Optional

from engine.models import Claim, Event, Finding, LLMCall, Report, Run, Score, Source, Track


def assemble_run_dossier(
    run: Run,
    report: Optional[Report],
    score: Optional[Score],
    sources: list[Source],
    findings: list[Finding],
    tracks: list[Track],
    llm_calls: list[LLMCall],
    events: list[Event],
    claims: list[Claim],
) -> dict[str, Any]:
    """Map normalized run records into the report API's dossier shape.

    The caller must load all inputs while their SQLAlchemy session is open,
    because source evidence can be lazily loaded during mapping.
    """
    sources_data = [
        {
            "source_id": source.tag,
            "kind": "doc" if source.kind in {"doc", "user_doc"} else "web",
            "title": source.title,
            "url": source.url,
            "canonical_url": source.canonical_url,
            "domain": source.domain,
            "authority_tier": source.authority_tier,
            "published_at": source.published_at,
            "snippet": next(
                (
                    evidence.quote
                    for evidence in sorted(
                        source.evidence,
                        key=lambda item: item.final_score or 0,
                        reverse=True,
                    )
                    if evidence.quote
                ),
                None,
            ),
            "location": next(
                (evidence.location for evidence in source.evidence if evidence.location),
                None,
            ),
        }
        for source in sources
    ]
    findings_data = [
        {
            "id": finding.id,
            "type": finding.type,
            "description": finding.description,
            "status": finding.status,
            "resolution_note": finding.resolution_note,
        }
        for finding in findings
    ]
    claims_data = [
        {
            "sentence": claim.sentence,
            "tags": claim.tags,
            "verdict": claim.verdict,
            "reason": claim.reason,
        }
        for claim in claims
    ]
    tracks_data = [_serialize_track(track, run.status) for track in tracks]
    llm_calls_data = [
        {
            "id": call.id,
            "agent": call.agent,
            "model": call.model,
            "tokens_in": call.tokens_in,
            "tokens_out": call.tokens_out,
            "latency_ms": call.latency_ms,
            "cost": call.cost,
            "cache_hit": call.cache_hit,
            "trace_id": call.trace_id,
            "created_at": call.created_at.isoformat() if call.created_at else None,
        }
        for call in llm_calls
    ]
    events_data = [
        {
            "id": event.id,
            "seq": event.seq,
            "type": event.type,
            "payload": event.payload,
            "created_at": event.created_at.isoformat() if event.created_at else None,
        }
        for event in events
    ]
    score_details = score.details or {} if score else {}

    return {
        "run_id": run.id,
        "question": run.question,
        "query": run.question,
        "depth": (run.settings or {}).get("depth", "standard"),
        "status": run.status,
        "stage": run.stage,
        "progress": run.progress,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "report_markdown": report.markdown if report else None,
        "report_id": report.id if report else None,
        "scores": {
            "faithfulness": score.faithfulness,
            "relevancy": score.relevancy,
            "authority": score.authority,
            "coverage": score.coverage,
            "citation_validity": score_details.get("citation_validity"),
        } if score else None,
        "budget_usage": score_details.get("research_budget"),
        "citation_validity_score": score_details.get("citation_validity"),
        "sources_count": len(sources),
        "sources": sources_data,
        "findings": findings_data,
        "claims": claims_data,
        "tracks_count": len(tracks),
        "tracks": tracks_data,
        "llm_calls": llm_calls_data,
        "events": events_data,
        "provider_warnings": [
            event["payload"] for event in events_data if event["type"] == "provider_degraded"
        ],
        "research_warnings": [
            event["payload"] for event in events_data if event["type"] == "research_warning"
        ],
    }


def _serialize_track(track: Track, run_status: Optional[str]) -> dict[str, Any]:
    """Map one stored research track to its report-facing status and counts."""
    is_active = track.status in {"pending", "researching"} and run_status not in {
        "completed",
        "failed",
        "cancelled",
    }
    status = "running" if is_active else track.status
    if track.status == "completed" or run_status == "completed":
        status = "completed"

    return {
        "id": track.id,
        "title": track.title,
        "status": status,
        "sources_count": (track.stats or {}).get("sources_found", 0),
        "queries_count": len(track.subquestions or []),
        "progress_pct": 100 if status == "completed" else 50 if track.status == "researching" else 0,
    }
