"""Pure, explainable quality metrics for evidence-grounded research runs."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit


def calculate_research_metrics(
    plan: List[Dict[str, Any]],
    evidence: List[Dict[str, Any]],
    relevance_result: Dict[str, Dict[str, Any]],
    faithfulness: Optional[float],
) -> Dict[str, Any]:
    """Calculate scores and supporting details from supplied run evidence.

    Relevancy is the mean per-track judge score. Coverage requires a track to
    meet the relevance threshold and have at least two distinct source domains
    or documents. Both metrics are unknown unless every planned track has a
    valid judge score, preventing missing output from inflating or deflating them.
    """
    track_ids = [str(track.get("id", "")) for track in plan]
    track_scores: Dict[str, float] = {}
    for track_id in track_ids:
        try:
            value = float(relevance_result.get(track_id, {}).get("score"))
        except (TypeError, ValueError):
            continue
        if 0.0 <= value <= 1.0:
            track_scores[track_id] = value

    relevance_complete = bool(track_ids) and len(track_scores) == len(track_ids)
    relevancy = round(sum(track_scores.values()) / len(track_ids), 4) if relevance_complete else None
    sources_by_track: Dict[str, set[str]] = {track_id: set() for track_id in track_ids}
    for item in evidence:
        if item.get("source_type") == "user_doc":
            source = f"document:{str(item.get('doc_name') or '').casefold()}"
        else:
            host = (urlsplit(str(item.get("url") or "")).hostname or "").casefold().removeprefix("www.")
            source = host or str(item.get("domain") or "").casefold().removeprefix("www.")
        if not source:
            continue
        item_track_ids = item.get("track_ids") or ([str(item["track_id"])] if item.get("track_id") else [])
        for track_id in item_track_ids:
            normalized_id = str(track_id)
            if normalized_id in sources_by_track:
                sources_by_track[normalized_id].add(source)

    threshold = 0.65
    covered_tracks = [
        track_id for track_id in track_ids
        if relevance_complete and track_scores[track_id] >= threshold and len(sources_by_track[track_id]) >= 2
    ]
    coverage = round(len(covered_tracks) / len(track_ids), 4) if relevance_complete else None
    authority_values = [float(item["authority_score"]) for item in evidence if item.get("authority_score") is not None]
    authority_mean = round(sum(authority_values) / len(authority_values), 4) if authority_values else None
    web_domains = {
        ((urlsplit(str(item.get("url") or "")).hostname or str(item.get("domain") or ""))
         .casefold().removeprefix("www."))
        for item in evidence
        if item.get("source_type") != "user_doc" and (item.get("url") or item.get("domain"))
    }
    domain_diversity = round(min(1.0, len(web_domains) / max(1, len(evidence))), 4) if evidence else None
    authority = (
        round(0.8 * authority_mean + 0.2 * domain_diversity, 4)
        if authority_mean is not None and domain_diversity is not None
        else authority_mean
    )
    return {
        "scores": {"faithfulness": faithfulness, "relevancy": relevancy, "authority": authority, "coverage": coverage},
        "details": {
            "track_relevancy": relevance_result,
            "relevance_complete": relevance_complete,
            "relevance_threshold": threshold,
            "track_sources": {key: sorted(value) for key, value in sources_by_track.items()},
            "covered_tracks": covered_tracks,
            "authority_mean": authority_mean,
            "domain_diversity": domain_diversity,
        },
    }
