"""Exports research reports into downloadable document formats.

"""

import re
import json
import html
import uuid
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

DOSSIER_DIR = Path("dossiers")

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - Ada Research Dossier</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.65;
            color: #1a1a1a;
            background-color: #fcfcfc;
            max-width: 900px;
            margin: 40px auto;
            padding: 0 20px;
        }}
        h1 {{ font-size: 2.2rem; color: #111; margin-bottom: 8px; font-weight: 800; }}
        h2 {{ font-size: 1.4rem; color: #222; border-bottom: 2px solid #eee; padding-bottom: 6px; margin-top: 32px; }}
        h3 {{ font-size: 1.15rem; color: #333; margin-top: 24px; }}
        .badge-bar {{ display: flex; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }}
        .badge {{ background: #f4f4f5; color: #18181b; padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; font-weight: 600; border: 1px solid #e4e4e7; }}
        .citation {{ color: #18181b; font-weight: bold; text-decoration: none; }}
        .source-box {{ background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 12px; }}
        .source-title {{ font-weight: 600; color: #111827; }}
        .source-meta {{ font-size: 0.8rem; color: #6b7280; margin-top: 4px; }}
        pre {{ background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; }}
        blockquote {{ border-left: 4px solid #71717a; margin-left: 0; padding-left: 16px; color: #4b5563; font-style: italic; }}
    </style>
</head>
<body>
    <div class="badge-bar">
        <span class="badge">Ada Deep Research</span>
        <span class="badge">Claims supported: {faithfulness}</span>
        <span class="badge">Citation IDs resolved: {citation_validity}</span>
        <span class="badge">Sources Cited: {sources_count}</span>
        <span class="badge">Coverage: {coverage_score}</span>
    </div>
    
    <div class="content">
        {body_html}
    </div>

    <h2>Retrieved Evidence</h2>
    <div class="sources-list">
        {sources_html}
    </div>
</body>
</html>
"""

def extract_executive_title(md_text: str, fallback_query: str) -> str:
    """Extracts the primary # H1 title from the synthesized markdown."""
    for line in md_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            candidate = stripped[2:].strip().strip("*#")
            if candidate:
                return candidate[:250]
    return fallback_query[:250]

def simple_markdown_to_html(md_text: str) -> str:
    """Lightweight markdown to HTML converter with strict HTML entity escaping."""
    lines = md_text.split("\n")
    html_lines = []
    in_list = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# "):
            html_lines.append(f"<h1>{html.escape(stripped[2:])}</h1>")
        elif stripped.startswith("## "):
            html_lines.append(f"<h2>{html.escape(stripped[3:])}</h2>")
        elif stripped.startswith("### "):
            html_lines.append(f"<h3>{html.escape(stripped[4:])}</h3>")
        elif stripped.startswith("- ") or stripped.startswith("* "):
            if not in_list:
                html_lines.append("<ul>")
                in_list = True
            html_lines.append(f"<li>{html.escape(stripped[2:])}</li>")
        else:
            if in_list:
                html_lines.append("</ul>")
                in_list = False
            if stripped:
                html_lines.append(f"<p>{html.escape(stripped)}</p>")

    if in_list:
        html_lines.append("</ul>")

    return "\n".join(html_lines)

def export_research_dossier(
    query: str,
    final_report_markdown: str,
    guard_results: Dict[str, Any],
    critic_audit: Dict[str, Any],
    evidence_manifest: List[Dict[str, Any]],
    report_id: Optional[str] = None,
    scores: Optional[Dict[str, Any]] = None,
    research_warnings: Optional[List[str]] = None,
    budget_usage: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    """
    Exports the dossier in Markdown, JSON, and standalone HTML formats.
    Sanitizes all HTML interpolations against XSS (CWE-79).
    """
    DOSSIER_DIR.mkdir(parents=True, exist_ok=True)
    raw_id = report_id or str(uuid.uuid4())[:8]
    rid = re.sub(r"[^a-zA-Z0-9_-]", "", raw_id)[:64] or str(uuid.uuid4())[:8]
    exec_title = extract_executive_title(final_report_markdown, query)

    # 1. Export Clean Markdown
    md_filename = DOSSIER_DIR / f"dossier_{rid}.md"
    with open(md_filename, "w", encoding="utf-8") as f:
        f.write(f"# Research Dossier: {query}\n\n")
        citation_score = guard_results.get("citation_validity_score")
        score_label = f"{round(citation_score * 100, 1)}% citation IDs resolved" if citation_score is not None else "citation validity not measured"
        f.write(f"> **Generated by Ada Deep Research** | {score_label} | Sources: {len(evidence_manifest)}\n\n---\n\n")
        f.write(final_report_markdown)

    # 2. Export Structured JSON
    json_filename = DOSSIER_DIR / f"dossier_{rid}.json"
    coverage_score = (scores or {}).get("coverage")
    full_payload = {
        "report_id": rid,
        "query": query,
        "executive_title": exec_title,
        "faithfulness_score": guard_results.get("faithfulness_score"),
        "citation_validity_score": guard_results.get("citation_validity_score"),
        "coverage_score": round(float(coverage_score) * 100) if coverage_score is not None else None,
        "scores": scores or {},
        "guard_results": guard_results,
        "claims": guard_results.get("claims", []),
        "total_sources_cited": guard_results.get("unique_valid_sources_cited"),
        "report_markdown": final_report_markdown,
        "monograph": final_report_markdown,
        "critic_audit": critic_audit,
        "citation_index": guard_results.get("citation_index", {}),
        "evidence_manifest": evidence_manifest,
        "suggested_inquiries": critic_audit.get("suggested_next_inquiries", []),
        "research_warnings": research_warnings or [],
        "budget_usage": budget_usage,
    }
    with open(json_filename, "w", encoding="utf-8") as f:
        json.dump(full_payload, f, indent=2)

    # 3. Export Standalone HTML (with strict XSS escaping)
    html_filename = DOSSIER_DIR / f"dossier_{rid}.html"
    sources_html_items = []
    for sid, sinfo in guard_results.get("citation_index", {}).items():
        safe_sid = html.escape(str(sid), quote=True)
        safe_title = html.escape(str(sinfo.get("title", "Untitled")), quote=True)
        raw_url = str(sinfo.get("url") or "")
        safe_snippet = html.escape(str(sinfo.get("snippet", "")), quote=True)
        auth = sinfo.get("authority_score")
        safe_auth = html.escape(f"Heuristic authority estimate: {float(auth):.2f}" if auth is not None else "Authority not measured", quote=True)

        if raw_url.startswith(("http://", "https://")):
            safe_url = html.escape(raw_url, quote=True)
            url_link = f"<a href='{safe_url}' target='_blank' rel='noopener noreferrer'>{safe_url}</a>"
        else:
            safe_doc = html.escape(str(sinfo.get("doc_name", "Vault Document")), quote=True)
            safe_page = html.escape(str(sinfo.get("page_number", 1)), quote=True)
            url_link = f"Document: {safe_doc} (Page {safe_page})"

        sources_html_items.append(
            f"<div class='source-box'>"
            f"<div class='source-title'>[{safe_sid}] {safe_title}</div>"
            f"<div class='source-meta'>{url_link} | {safe_auth}</div>"
            f"<p style='font-size:0.85rem; color:#4b5563; margin-top:6px;'>{safe_snippet}...</p>"
            f"</div>"
        )

    sources_html_str = "\n".join(sources_html_items)
    body_html_str = simple_markdown_to_html(final_report_markdown)

    rendered_html = HTML_TEMPLATE.format(
        title=html.escape(query, quote=True),
        faithfulness=f"{round(guard_results['faithfulness_score'] * 100, 1)}%" if guard_results.get("faithfulness_score") is not None else "Not measured",
        citation_validity=f"{round(guard_results['citation_validity_score'] * 100, 1)}%" if guard_results.get("citation_validity_score") is not None else "Not measured",
        sources_count=guard_results.get("unique_valid_sources_cited", len(evidence_manifest)),
        coverage_score=f"{critic_audit['coverage_score']}/100" if critic_audit.get("coverage_score") is not None else "Not measured",
        body_html=body_html_str,
        sources_html=sources_html_str
    )
    with open(html_filename, "w", encoding="utf-8") as f:
        f.write(rendered_html)

    logger.info("Exported report artifacts for run %s", rid)
    return {
        "report_id": rid,
        "executive_title": exec_title,
        "markdown_path": str(md_filename),
        "json_path": str(json_filename),
        "json": str(json_filename),
        "html_path": str(html_filename)
    }
