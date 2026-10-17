"""Small, deterministic helpers for retrieving evidence from a completed report."""

import re
from typing import Any, Dict, List, Tuple


_TOKEN_RE = re.compile(r"[a-z0-9]{3,}", re.IGNORECASE)
_STOPWORDS = {
    "about", "after", "against", "also", "and", "are", "because", "been", "before",
    "being", "between", "can", "could", "does", "from", "have", "into", "more",
    "most", "other", "our", "report", "should", "some", "than", "that", "their",
    "them", "then", "there", "these", "they", "this", "those", "through", "under",
    "what", "when", "where", "which", "while", "will", "with", "would", "your",
}


def rank_report_evidence(
    question: str,
    evidence_manifest: List[Dict[str, Any]],
    selected_text: str = "",
    limit: int = 6,
) -> List[Dict[str, Any]]:
    """Return the best available passages using explainable lexical overlap."""
    query_terms = {
        token.lower() for token in _TOKEN_RE.findall(f"{question} {selected_text}")
        if token.lower() not in _STOPWORDS
    }
    ranked: List[Tuple[float, int, Dict[str, Any]]] = []
    for position, item in enumerate(evidence_manifest):
        text = str(item.get("text") or item.get("quote") or item.get("snippet") or "").strip()
        if not item.get("source_id") or not text:
            continue
        title = str(item.get("title") or item.get("doc_name") or "")
        haystack = f"{title} {text}".lower()
        passage_terms = {token.lower() for token in _TOKEN_RE.findall(haystack)}
        overlap = len(query_terms & passage_terms)
        # Do not invent relevance when no meaningful query term matches.
        score = overlap / max(1, len(query_terms))
        if selected_text and selected_text[:80].lower() in haystack:
            score += 0.25
        if score > 0:
            ranked.append((score, -position, {**item, "text": text}))
    ranked.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return [item for _, _, item in ranked[:limit]]
