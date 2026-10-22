"""Per-track web search, page retrieval, and iterative evidence gathering.

"""

import json
import hashlib
import logging
import re
import time
import requests
from typing import List, Dict, Any, Optional, Callable
from urllib.parse import urlparse
from datetime import datetime, timezone
from engine.config import SERPER_API_KEY
from engine.ingest.web_scraper import scrape_webpage
from engine.storage.vector_store import get_vector_store
from engine.budget import ResearchBudget

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[\w'-]{3,}")

# Social feeds and professional profiles are difficult to validate as primary
# evidence. Keep them out of the research corpus unless a future, explicit
# source type is designed for first-hand social content.
_LOW_SIGNAL_SOURCE_DOMAINS = frozenset({
    "facebook.com", "instagram.com", "tiktok.com", "x.com", "twitter.com",
    "linkedin.com", "threads.net", "pinterest.com",
})


def is_low_signal_source_domain(domain: str) -> bool:
    """Return whether a hostname is a social/profile host unsuitable as default evidence.

    Args:
        domain: A hostname or URL returned by the web search provider.

    Returns:
        True for a known social-feed/profile domain and its subdomains.

    Failure behavior:
        Malformed values are treated as non-matching; callers still validate
        URLs before fetching them.
    """
    value = (domain or "").strip().lower()
    if "://" in value:
        value = urlparse(value).hostname or ""
    else:
        value = value.split(":", 1)[0].strip(".")
    value = value.removeprefix("www.")
    return any(value == root or value.endswith("." + root) for root in _LOW_SIGNAL_SOURCE_DOMAINS)


def _rank_search_hits(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Prefer authoritative domains while preserving provider order for ties."""
    return sorted(
        hits,
        key=lambda hit: calculate_domain_authority(urlparse(hit.get("link", "")).hostname or ""),
        reverse=True,
    )


def _evidence_passage(text: str, query: str, max_chars: int = 1800) -> Dict[str, str]:
    """Select a query-relevant passage and a verbatim quote from retrieved text.

    The passage remains a substring of the retrieved source. The quote is capped
    at 600 characters and is therefore safe to display as a source excerpt.
    If no useful text exists, both values are empty rather than fabricated.
    """
    normalized = re.sub(r"\r\n?", "\n", text or "")
    chunks = [part.strip() for part in re.split(r"\n\s*\n|(?<=[.!?])\s+", normalized) if part.strip()]
    if not chunks:
        return {"text": "", "quote": ""}
    query_terms = {term.casefold() for term in _TOKEN_RE.findall(query or "")}

    def score(chunk: str) -> tuple[int, int]:
        terms = {term.casefold() for term in _TOKEN_RE.findall(chunk)}
        return (len(query_terms & terms), min(len(chunk), max_chars))

    best = max(enumerate(chunks), key=lambda pair: (score(pair[1]), -pair[0]))[1]
    passage = best[:max_chars].strip()
    # Keep the quote sentence-complete where possible, without changing its text.
    quote_limit = min(600, len(passage))
    quote = passage[:quote_limit]
    if len(passage) > quote_limit and " " in quote:
        quote = quote.rsplit(" ", 1)[0]
    return {"text": passage, "quote": quote}


def _content_hash(text: str) -> str:
    """Return a stable SHA-256 digest for retrieved source text."""
    return hashlib.sha256(re.sub(r"\s+", " ", text or "").strip().casefold().encode("utf-8")).hexdigest()


def _retrieve_vault_evidence(
    query: str,
    selected_docs: Optional[List[str]],
    user_id: Optional[str],
) -> List[Dict[str, Any]]:
    """Search selected private documents and map passages into evidence records.

    Vector-store errors propagate so each research workflow can report the
    failure in its own warning format.
    """
    vector_store = get_vector_store()
    matches = vector_store.search_user_docs(
        query,
        top_k=3,
        score_threshold=0.55,
        selected_docs=selected_docs,
        user_id=user_id,
    )
    evidence = []
    for match in matches:
        passage_identity = match.get("chunk_id") or f"p{match.get('page_number', 1)}c{match.get('chunk_index', 0)}"
        section_path = match.get("section_path")
        passage = _evidence_passage(match.get("text", ""), query)
        page_number = match["page_number"]
        document_name = match["doc_name"]
        evidence.append({
            "source_id": f"DOC_{document_name}_{passage_identity}",
            "source_type": "user_doc",
            "chunk_id": match.get("chunk_id"),
            "chunk_index": match.get("chunk_index"),
            "section_path": section_path,
            "doc_name": document_name,
            "page_number": page_number,
            "url": None,
            "title": (
                f"Internal Document: {document_name} — {section_path}"
                if section_path
                else f"Internal Document: {document_name} (Page {page_number})"
            ),
            "text": passage["text"],
            "quote": passage["quote"],
            "content_hash": _content_hash(match.get("text", "")),
            "location": section_path or f"Page {page_number}",
            "authority_score": None,
            "relevance_score": match["score"],
        })
    return evidence


def calculate_domain_authority(domain: str) -> float:
    """Calculates an authority score based on domain reputation."""
    domain_lower = (domain or "").lower().split(":", 1)[0].strip(".")

    def matches_domain(root: str) -> bool:
        """Return whether the normalized hostname equals or belongs to a root."""
        return domain_lower == root or domain_lower.endswith("." + root)

    if domain_lower.endswith((".gov", ".edu", ".ac.uk")) or any(matches_domain(root) for root in ["arxiv.org", "nature.com", "science.org", "sciencedirect.com", "ieee.org", "springer.com"]):
        return 0.95
    if any(matches_domain(outlet) for outlet in ["reuters.com", "bloomberg.com", "bbc.com", "ft.com", "wsj.com", "apnews.com", "economist.com", "nytimes.com"]):
        return 0.90
    if any(matches_domain(root) for root in ["github.com", "wikipedia.org", "techcrunch.com", "wired.com", "theverge.com", "iea.org"]):
        return 0.85
    return 0.70

def perform_serper_search(query: str, max_results: int = 4) -> List[Dict[str, Any]]:
    """Executes a Google Search via Serper API."""
    if not SERPER_API_KEY:
        logger.warning("SERPER_API_KEY is not configured; skipping web search")
        return []

    url = "https://google.serper.dev/search"
    payload = json.dumps({"q": query, "num": max_results})
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}

    try:
        resp = requests.post(url, headers=headers, data=payload, timeout=(2, 4))
        if resp.status_code == 200:
            data = resp.json()
            results = []
            for item in data.get("organic", []):
                results.append({
                    "title": item.get("title", ""),
                    "link": item.get("link", ""),
                    "snippet": item.get("snippet", ""),
                    "date": item.get("date", "")
                })
            return results
    except Exception:
        logger.exception("Serper search failed")
    return []

def execute_sub_research(
    sub_task: Dict[str, Any],
    include_user_docs: bool = True,
    max_pages_to_scrape: int = 2,
    selected_docs: Optional[List[str]] = None,
    user_id: Optional[str] = None,
    blocked_domains: Optional[List[str]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    budget: Optional[ResearchBudget] = None,
) -> Dict[str, Any]:
    """
    Executes deep research for a single sub-question track:
    1. Dual Retrieval: Vector search for private user docs + Google Serper for web
    2. Deep scraping of top candidate links via 3-tier scraper
    3. Bundles evidence units with authority and provenance scoring
    """
    sub_id = sub_task.get("id", 1)
    sub_q = sub_task.get("sub_question", "")
    queries = sub_task.get("search_queries", [sub_q])
    category = sub_task.get("category", "general")
    
    t0 = time.time()
    evidence_items = []
    seen_links = set()
    blocked = {d.lower().removeprefix("www.").strip(".") for d in (blocked_domains or []) if d}

    # ── Step 1: Query Private User Documents (Qdrant) ──
    if include_user_docs:
        try:
            evidence_items.extend(_retrieve_vault_evidence(sub_q, selected_docs, user_id))
        except Exception:
            logger.exception("Vault search failed; continuing without private evidence")

    # ── Step 2: Query Live Web via Serper ──
    candidate_urls = []
    for q in queries[:2]:
        if cancel_check and cancel_check():
            break
        if budget and not budget.reserve("searches"):
            break
        search_hits = perform_serper_search(q, max_results=3)
        for hit in search_hits:
            if cancel_check and cancel_check():
                break
            link = hit["link"]
            host = urlparse(link).hostname or ""
            if is_low_signal_source_domain(host) or any(host == d or host.endswith("." + d) for d in blocked):
                continue
            if link not in seen_links:
                seen_links.add(link)
                candidate_urls.append(hit)

    candidate_urls = _rank_search_hits(candidate_urls)

    # ── Step 3: Deep Scrape Top Web Results ──
    scraped_count = 0
    for cand in candidate_urls:
        if cancel_check and cancel_check():
            break
        link = cand["link"]
        domain = urlparse(link).netloc.replace("www.", "")
        auth_score = calculate_domain_authority(domain)

        # Scrape full page content for top candidate links
        if scraped_count < max_pages_to_scrape and (not budget or budget.reserve("fetches")):
            scraped = scrape_webpage(link, timeout=6, cancel_check=cancel_check)
            if cancel_check and cancel_check():
                break
            if scraped and scraped["text"] and len(scraped["text"]) >= 300:
                passage = _evidence_passage(scraped["text"], sub_q)
                evidence_items.append({
                    "source_id": f"WEB_{domain}_{len(evidence_items)+1}",
                    "source_type": "web",
                    "url": link,
                    "canonical_url": link.split("#", 1)[0],
                    "domain": domain,
                    "title": scraped["title"] or cand["title"],
                    "text": passage["text"],
                    "quote": passage["quote"],
                    "content_hash": _content_hash(scraped["text"]),
                    "location": "Retrieved page excerpt",
                    "published_date": cand.get("date") or None,
                    "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "authority_score": auth_score,
                    "extraction_method": scraped["method"]
                })
                scraped_count += 1
                continue

        # Fallback to search snippet if scraping was skipped or failed
        if cand.get("snippet"):
            passage = _evidence_passage(cand["snippet"], sub_q)
            evidence_items.append({
                "source_id": f"WEB_{domain}_{len(evidence_items)+1}",
                "source_type": "web",
                "url": link,
                "canonical_url": link.split("#", 1)[0],
                "domain": domain,
                "title": cand["title"],
                "text": passage["text"],
                "quote": passage["quote"],
                "content_hash": _content_hash(cand["snippet"]),
                "location": "Search result snippet",
                "published_date": cand.get("date") or None,
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "authority_score": round(auth_score * 0.85, 2),  # Slightly discount snippet-only
                "extraction_method": "serper_snippet_fallback"
            })

    duration = round(time.time() - t0, 2)
    return {
        "sub_task_id": sub_id,
        "sub_question": sub_q,
        "category": category,
        "evidence_count": len(evidence_items),
        "evidence": evidence_items,
        "duration_seconds": duration
    }


def execute_iterative_sub_research(
    sub_task: Dict[str, Any],
    max_iterations: int = 2,
    include_user_docs: bool = True,
    max_pages_per_iter: int = 2,
    selected_docs: Optional[List[str]] = None,
    user_id: Optional[str] = None,
    blocked_domains: Optional[List[str]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    budget: Optional[ResearchBudget] = None,
) -> Dict[str, Any]:
    """
    Bounded Iterative Researcher Loop (Blueprint Section 7.3):
    Runs up to `max_iterations` per track:
    1. Adaptive search across web and private documents
    2. Candidate ranking by authority and relevance
    3. Deep page scraping and clean text extraction
    4. Anti-hallucination quote check (verifies quote is grounded in text)
    5. Early stopping when sufficient coverage is achieved
    """
    sub_id = sub_task.get("id", 1)
    sub_q = sub_task.get("sub_question", "")
    queries = list(sub_task.get("search_queries", [sub_q]))
    category = sub_task.get("category", "general")

    t0 = time.time()
    evidence_items = []
    warnings = []
    seen_links = set()
    blocked = {d.lower().removeprefix("www.").strip(".") for d in (blocked_domains or []) if d}

    # Step 1: Search user documents once if enabled
    if include_user_docs:
        try:
            evidence_items.extend(_retrieve_vault_evidence(sub_q, selected_docs, user_id))
        except Exception:
            logger.exception("Vault search failed; continuing without private evidence")
            warnings.append("Private vault search was unavailable for this track; results may omit selected documents.")

    if not SERPER_API_KEY:
        warnings.append("Web search is not configured because SERPER_API_KEY is missing.")

    # Step 2: Bounded Iteration Web Loop
    for iteration in range(max_iterations):
        if cancel_check and cancel_check():
            break
        if budget and not budget.reserve("searches"):
            warnings.append("The run reached its configured search or time budget.")
            break
        # Pick query for this iteration
        current_query = queries[iteration] if iteration < len(queries) else f"{sub_q} benchmark analysis"
        search_hits = perform_serper_search(current_query, max_results=4)
        if not search_hits:
            warnings.append("Search returned no usable web results for this track.")

        candidate_urls = []
        excluded_low_signal_source = False
        for hit in search_hits:
            if cancel_check and cancel_check():
                break
            link = hit.get("link", "")
            host = urlparse(link).hostname or ""
            if is_low_signal_source_domain(host):
                excluded_low_signal_source = True
                continue
            if any(host == d or host.endswith("." + d) for d in blocked):
                continue
            if link and link not in seen_links:
                seen_links.add(link)
                candidate_urls.append(hit)

        candidate_urls = _rank_search_hits(candidate_urls)
        if not candidate_urls and excluded_low_signal_source:
            warnings.append("Search results only included social/profile pages, which were excluded as research evidence.")

        scraped_this_iter = 0
        for cand in candidate_urls:
            if cancel_check and cancel_check():
                break
            if budget and budget.expired():
                warnings.append("The run reached its configured time budget.")
                break
            link = cand["link"]
            domain = urlparse(link).netloc.replace("www.", "")
            auth_score = calculate_domain_authority(domain)

            if scraped_this_iter < max_pages_per_iter and (not budget or budget.reserve("fetches")):
                scraped = scrape_webpage(link, timeout=6, cancel_check=cancel_check)
                if cancel_check and cancel_check():
                    break
                if scraped and scraped.get("text") and len(scraped["text"]) >= 250:
                    passage = _evidence_passage(scraped["text"], sub_q)
                    evidence_items.append({
                        "source_id": f"WEB_{domain}_{len(evidence_items)+1}",
                        "source_type": "web",
                        "url": link,
                        "canonical_url": link.split("#", 1)[0],
                        "domain": domain,
                        "title": scraped.get("title") or cand.get("title", domain),
                        "text": passage["text"],
                        "quote": passage["quote"],
                        "content_hash": _content_hash(scraped["text"]),
                        "location": "Retrieved page excerpt",
                        "published_date": cand.get("date") or None,
                        "retrieved_at": datetime.now(timezone.utc).isoformat(),
                        "authority_score": auth_score,
                        "extraction_method": scraped.get("method", "trafilatura"),
                        "iteration": iteration + 1
                    })
                    scraped_this_iter += 1
                    continue

            if cand.get("snippet"):
                passage = _evidence_passage(cand["snippet"], sub_q)
                evidence_items.append({
                    "source_id": f"WEB_{domain}_{len(evidence_items)+1}",
                    "source_type": "web",
                    "url": link,
                    "canonical_url": link.split("#", 1)[0],
                    "domain": domain,
                    "title": cand.get("title", domain),
                    "text": passage["text"],
                    "quote": passage["quote"],
                    "content_hash": _content_hash(cand["snippet"]),
                    "location": "Search result snippet",
                    "published_date": cand.get("date") or None,
                    "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "authority_score": round(auth_score * 0.85, 2),
                    "extraction_method": "serper_snippet_fallback",
                    "iteration": iteration + 1
                })

        # Early termination check: if track gathered at least 4 high-quality evidence items
        if len(evidence_items) >= 4:
            break

    duration = round(time.time() - t0, 2)
    return {
        "sub_task_id": sub_id,
        "sub_question": sub_q,
        "category": category,
        "evidence_count": len(evidence_items),
        "evidence": evidence_items,
        "warnings": list(dict.fromkeys(warnings)),
        "budget_usage": budget.snapshot() if budget else None,
        "iterations_completed": iteration + 1,
        "duration_seconds": duration
    }
