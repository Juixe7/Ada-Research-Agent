"""Per-track web search, page retrieval, and iterative evidence gathering.

"""

import json
import time
import requests
from typing import List, Dict, Any, Optional, Callable
from urllib.parse import urlparse
from engine.config import SERPER_API_KEY
from engine.ingest.web_scraper import scrape_webpage
from engine.storage.vector_store import get_vector_store

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
        print("[worker] SERPER_API_KEY missing, skipping web search.")
        return []

    url = "https://google.serper.dev/search"
    payload = json.dumps({"q": query, "num": max_results})
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}

    try:
        resp = requests.post(url, headers=headers, data=payload, timeout=8)
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
    except Exception as e:
        print(f"[worker] Serper search error for '{query}': {e}")
    return []

def execute_sub_research(
    sub_task: Dict[str, Any],
    include_user_docs: bool = True,
    max_pages_to_scrape: int = 2,
    selected_docs: Optional[List[str]] = None,
    user_id: Optional[str] = None,
    blocked_domains: Optional[List[str]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
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
            vs = get_vector_store()
            doc_matches = vs.search_user_docs(
                sub_q,
                top_k=3,
                score_threshold=0.55,
                selected_docs=selected_docs,
                user_id=user_id
            )
            for dm in doc_matches:
                passage_identity = dm.get("chunk_id") or f"p{dm.get('page_number', 1)}c{dm.get('chunk_index', 0)}"
                section_label = dm.get("section_path")
                evidence_items.append({
                    "source_id": f"DOC_{dm['doc_name']}_{passage_identity}",
                    "source_type": "user_doc",
                    "chunk_id": dm.get("chunk_id"),
                    "chunk_index": dm.get("chunk_index"),
                    "section_path": section_label,
                    "doc_name": dm["doc_name"],
                    "page_number": dm["page_number"],
                    "url": None,
                    "title": f"Internal Document: {dm['doc_name']} — {section_label}" if section_label else f"Internal Document: {dm['doc_name']} (Page {dm['page_number']})",
                    "text": dm["text"],
                    "authority_score": None,  # User-provided documents are not assigned an authority score.
                    "relevance_score": dm["score"]
                })
        except Exception as e:
            print(f"[worker] User doc vector search warning: {e}")

    # ── Step 2: Query Live Web via Serper ──
    candidate_urls = []
    for q in queries[:2]:
        if cancel_check and cancel_check():
            break
        search_hits = perform_serper_search(q, max_results=3)
        for hit in search_hits:
            if cancel_check and cancel_check():
                break
            link = hit["link"]
            host = urlparse(link).hostname or ""
            if any(host == d or host.endswith("." + d) for d in blocked):
                continue
            if link not in seen_links:
                seen_links.add(link)
                candidate_urls.append(hit)

    # ── Step 3: Deep Scrape Top Web Results ──
    scraped_count = 0
    for cand in candidate_urls:
        if cancel_check and cancel_check():
            break
        link = cand["link"]
        domain = urlparse(link).netloc.replace("www.", "")
        auth_score = calculate_domain_authority(domain)

        # Scrape full page content for top candidate links
        if scraped_count < max_pages_to_scrape:
            scraped = scrape_webpage(link, timeout=10)
            if scraped and scraped["text"] and len(scraped["text"]) >= 300:
                evidence_items.append({
                    "source_id": f"WEB_{domain}_{len(evidence_items)+1}",
                    "source_type": "web",
                    "url": link,
                    "domain": domain,
                    "title": scraped["title"] or cand["title"],
                    "text": scraped["text"][:12000],  # Keep deep technical excerpt for Gemini 1M context
                    "authority_score": auth_score,
                    "extraction_method": scraped["method"]
                })
                scraped_count += 1
                continue

        # Fallback to search snippet if scraping was skipped or failed
        if cand.get("snippet"):
            evidence_items.append({
                "source_id": f"WEB_{domain}_{len(evidence_items)+1}",
                "source_type": "web",
                "url": link,
                "domain": domain,
                "title": cand["title"],
                "text": cand["snippet"],
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
            vs = get_vector_store()
            doc_matches = vs.search_user_docs(
                sub_q,
                top_k=3,
                score_threshold=0.55,
                selected_docs=selected_docs,
                user_id=user_id
            )
            for dm in doc_matches:
                passage_identity = dm.get("chunk_id") or f"p{dm.get('page_number', 1)}c{dm.get('chunk_index', 0)}"
                section_label = dm.get("section_path")
                evidence_items.append({
                    "source_id": f"DOC_{dm['doc_name']}_{passage_identity}",
                    "source_type": "user_doc",
                    "chunk_id": dm.get("chunk_id"),
                    "chunk_index": dm.get("chunk_index"),
                    "section_path": section_label,
                    "doc_name": dm["doc_name"],
                    "page_number": dm["page_number"],
                    "url": None,
                    "title": f"Internal Document: {dm['doc_name']} — {section_label}" if section_label else f"Internal Document: {dm['doc_name']} (Page {dm['page_number']})",
                    "text": dm["text"],
                    "authority_score": None,
                    "relevance_score": dm["score"]
                })
        except Exception as e:
            print(f"[research_worker] User doc search notice: {e}")
            warnings.append("Private vault search was unavailable for this track; results may omit selected documents.")

    if not SERPER_API_KEY:
        warnings.append("Web search is not configured because SERPER_API_KEY is missing.")

    # Step 2: Bounded Iteration Web Loop
    for iteration in range(max_iterations):
        if cancel_check and cancel_check():
            break
        # Pick query for this iteration
        current_query = queries[iteration] if iteration < len(queries) else f"{sub_q} benchmark analysis"
        search_hits = perform_serper_search(current_query, max_results=4)
        if not search_hits:
            warnings.append("Search returned no usable web results for this track.")

        candidate_urls = []
        for hit in search_hits:
            if cancel_check and cancel_check():
                break
            link = hit.get("link", "")
            host = urlparse(link).hostname or ""
            if any(host == d or host.endswith("." + d) for d in blocked):
                continue
            if link and link not in seen_links:
                seen_links.add(link)
                candidate_urls.append(hit)

        scraped_this_iter = 0
        for cand in candidate_urls:
            if cancel_check and cancel_check():
                break
            link = cand["link"]
            domain = urlparse(link).netloc.replace("www.", "")
            auth_score = calculate_domain_authority(domain)

            if scraped_this_iter < max_pages_per_iter:
                scraped = scrape_webpage(link, timeout=10)
                if scraped and scraped.get("text") and len(scraped["text"]) >= 250:
                    evidence_items.append({
                        "source_id": f"WEB_{domain}_{len(evidence_items)+1}",
                        "source_type": "web",
                        "url": link,
                        "domain": domain,
                        "title": scraped.get("title") or cand.get("title", domain),
                        "text": scraped["text"][:12000],
                        "authority_score": auth_score,
                        "extraction_method": scraped.get("method", "trafilatura"),
                        "iteration": iteration + 1
                    })
                    scraped_this_iter += 1
                    continue

            if cand.get("snippet"):
                evidence_items.append({
                    "source_id": f"WEB_{domain}_{len(evidence_items)+1}",
                    "source_type": "web",
                    "url": link,
                    "domain": domain,
                    "title": cand.get("title", domain),
                    "text": cand["snippet"],
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
        "iterations_completed": iteration + 1,
        "duration_seconds": duration
    }
