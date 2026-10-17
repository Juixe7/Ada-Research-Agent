"""Builds report outlines, writes evidence-assigned sections, and assembles the final dossier.

"""

import re
import html
from typing import List, Dict, Any, Optional
from engine.agents.llm_resilient import call_gateway
from engine.graph.state import SectionSpec

def extract_quantitative_metrics(evidence_manifest: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Uses only explicitly structured quantitative values with their provenance.
    """
    metrics = []
    seen = set()

    for ev in evidence_manifest:
        sid = ev.get("source_id", "S1")
        # Never turn arbitrary dates, IDs, versions, ports, or counts found in a
        # source into a metric. Only use values extracted with provenance by an
        # explicit structured-evidence step.
        if "values" in ev and isinstance(ev["values"], list):
            for v in ev["values"]:
                if not isinstance(v, dict):
                    continue
                if not all(v.get(key) is not None for key in ("metric", "value", "context")):
                    continue
                if str(v.get("value", "")).strip() not in str(v.get("context", "")):
                    continue
                key = (v.get("metric"), v.get("value"), sid)
                if key not in seen:
                    seen.add(key)
                    metrics.append({
                        "metric": v.get("metric", "Metric"),
                        "value": str(v.get("value", "")),
                        "context": str(v["context"]),
                        "source_id": sid
                    })

    return metrics

def build_deterministic_tables(evidence_manifest: List[Dict[str, Any]]) -> str:
    """
    Constructs deterministic Markdown tables directly from verified evidence units.
    Guarantees that tables are generated from structured data, never free-form model recall (FR-5.4).
    """
    metrics = extract_quantitative_metrics(evidence_manifest)
    if not metrics:
        return ""

    table_lines = [
        "| Metric / Parameter | Value / Measurement | Evidentiary Context | Source |",
        "|:---|:---|:---|:---:|"
    ]

    for m in metrics[:8]:
        metric = m["metric"].replace("|", "\\|")
        val = f"**{m['value']}**".replace("|", "\\|")
        ctx = m["context"].replace("|", "\\|").replace("\n", " ")
        sid = m["source_id"]
        table_lines.append(f"| {metric} | {val} | {ctx} | [{sid}] |")

    return "\n".join(table_lines)

def generate_outline(
    query: str,
    plan: List[Dict[str, Any]],
    evidence_manifest: List[Dict[str, Any]],
    critic_audit: Dict[str, Any]
) -> List[SectionSpec]:
    """
    Decomposes the research brief into discrete, targeted SectionSpecs matching Blueprint Section 7.5.
    Assigns specific evidence IDs to each section to bound the LLM's context window.
    """
    outline: List[SectionSpec] = []
    all_sids = [e.get("source_id", "S1") for e in evidence_manifest]

    # 1. Methodology & Scope
    outline.append({
        "id": "methodology",
        "title": "Methodology, Analytical Scope & Provenance",
        "goal": "Formalize the core research inquiry, scope boundaries, source distribution, and dual-retrieval verification methodology.",
        "assigned_source_ids": all_sids[:min(4, len(all_sids))],
        "deterministic_tables": None
    })

    # 2. Quantitative Benchmarks & SOTA Metrics
    tables_md = build_deterministic_tables(evidence_manifest)
    outline.append({
        "id": "benchmarks",
        "title": "Quantitative Benchmarks & Empirical Findings",
        "goal": "Analyze empirical performance metrics, cost/latency figures, and system benchmarks using the deterministic structured table.",
        "assigned_source_ids": all_sids,
        "deterministic_tables": tables_md if tables_md else None
    })

    # 3. Thematic Deep-Dives (1 per track in plan)
    for i, track in enumerate(plan):
        tid = track.get("id", i + 1)
        sub_q = track.get("sub_question", f"Track {tid}")
        cat = track.get("category", "Analysis").replace("_", " ").title()
        # Keep track sections grounded in their own evidence. Randomly allocating
        # other tracks' sources creates plausible but irrelevant findings.
        assigned = [
            e.get("source_id")
            for e in evidence_manifest
            if str(tid) in {str(x) for x in (e.get("track_ids") or ([e.get("track_id")] if e.get("track_id") else []))}
        ]

        outline.append({
            "id": f"deepdive_{tid}",
            "title": f"Thematic Deep-Dive: {cat} — {sub_q[:65]}",
            "goal": f"Conduct an exhaustive technical exploration of: '{sub_q}'. Provide granular architectural breakdown with explicit source tags.",
            "assigned_source_ids": assigned,
            "deterministic_tables": None
        })

    # 4. Contested Claims & Contradiction Arbitration
    contradictions = critic_audit.get("contradictions", [])
    if contradictions:
        outline.append({
            "id": "contradictions",
            "title": "Contested Claims & Contradiction Breakdown",
            "goal": "Arbitrate and reconcile conflicting claims, divergent benchmarks, or methodological discrepancies uncovered by the Adversarial Critic.",
            "assigned_source_ids": all_sids,
            "deterministic_tables": None
        })

    # 5. Strategic Risks, Limitations & Open Questions
    outline.append({
        "id": "risks",
        "title": "Strategic Bottlenecks, Systemic Risks & Limitations",
        "goal": "Identify critical vulnerabilities, implementation hurdles, missing empirical data, and high-impact open research questions.",
        "assigned_source_ids": all_sids[-min(4, len(all_sids)):],
        "deterministic_tables": None
    })

    return outline

def format_evidence_xml_subset(source_ids: List[str], evidence_by_id: Dict[str, Dict[str, Any]]) -> str:
    """Formats only the assigned subset of evidence into strict XML tags."""
    xml_parts = ['<evidence_subset>']
    for sid in source_ids:
        ev = evidence_by_id.get(sid)
        if not ev:
            continue
        stype = ev.get("source_type", "web")
        title = html.escape(ev.get("title", "Untitled Source"))
        auth = ev.get("authority_score", 0.7)
        if stype == "user_doc":
            dname = html.escape(ev.get("doc_name", "User Doc"))
            pnum = ev.get("page_number", 1)
            xml_parts.append(f'  <source id="{sid}" type="user_doc" doc="{dname}" page="{pnum}" authority="{auth}" title="{title}">')
        else:
            url = html.escape(ev.get("url", ""))
            xml_parts.append(f'  <source id="{sid}" type="web" url="{url}" authority="{auth}" title="{title}">')
        text = html.escape(ev.get("text", "")[:3500])
        xml_parts.append(f'    <content>{text}</content>')
        xml_parts.append('  </source>')
    xml_parts.append('</evidence_subset>')
    return "\n".join(xml_parts)

SECTION_WRITER_PROMPT = """You are a Principal Research Analyst drafting a specific section of a publication-grade intelligence dossier.
Write ONLY the content for the requested section.

STRICT GROUNDING RULES:
1. Every single factual statement, benchmark, and empirical claim MUST cite an assigned source using exact bracketed notation (e.g. [S1], [D1]).
2. NEVER invent sources or cite tags not provided in the <evidence_subset>.
3. If evidence is thin or absent on a sub-point, explicitly state that data is unavailable; do not extrapolate or hallucinate.
4. Write in a rigorous, publication-grade analytical tone. Do NOT use conversational meta-language.
"""

def synthesize_section(
    section: SectionSpec,
    query: str,
    evidence_by_id: Dict[str, Dict[str, Any]],
    run_id: Optional[str] = None,
) -> str:
    """
    Synthesizes an individual report section using LiteLLM Gateway 'write' group.
    Integrates deterministic tables without model interference.
    """
    assigned_ids = section.get("assigned_source_ids", [])
    subset_xml = format_evidence_xml_subset(assigned_ids, evidence_by_id)

    prompt = f"""CORE RESEARCH TOPIC:
"{query}"

SECTION TO DRAFT:
Title: {section['title']}
Goal: {section['goal']}

ASSIGNED EVIDENCE CORPUS (You may ONLY cite these tags: {', '.join(f'[{sid}]' for sid in assigned_ids)}):
{subset_xml}

Draft the complete markdown text for this section under the heading '## {section['title']}'.
"""
    messages = [
        {"role": "system", "content": SECTION_WRITER_PROMPT},
        {"role": "user", "content": prompt}
    ]

    res = call_gateway(
        group="write",
        messages=messages,
        temperature=0.15,
        max_tokens=2500,
        json_mode=False,
        timeout=45.0,
        run_id=run_id,
        agent_name=f"section_writer:{section['id']}",
    )

    if res.content and res.content.strip():
        draft = res.content.strip()
    elif assigned_ids:
        draft = f"## {section['title']}\n\nThe section could not be synthesized because the language model provider was unavailable. The assigned evidence is still available in the source inspector; no conclusions were generated."
    else:
        draft = f"## {section['title']}\n\nNo relevant evidence was retrieved for this research track, so this section has no supported findings."

    # If deterministic tables exist for this section, append them directly
    if section.get("deterministic_tables"):
        table_block = f"\n\n### Verified Empirical Data Table\n{section['deterministic_tables']}\n"
        # Insert table right after heading or at the start of section
        if f"## {section['title']}" in draft:
            draft = draft.replace(f"## {section['title']}", f"## {section['title']}\n{table_block}", 1)
        else:
            draft = f"{table_block}\n{draft}"

    return draft

EXECUTIVE_SUMMARY_PROMPT = """You are the Lead Intelligence Officer.
Based on the completed research sections below, author the decisive Executive Intelligence Briefing (TL;DR).

Format strictly as:
# [Authoritative, Definitive Executive Title]

## Executive Intelligence Briefing (TL;DR)
### Direct Answer
[1 to 2 dense, definitive paragraphs directly resolving the primary question with zero fluff. Every fact must carry [Sx] or [Dx] citations.]

### Key Evidentiary Findings
- **Finding 1**: [Specific insight with [Sx]/[Dx] citation]
- **Finding 2**: [Specific insight with [Sx]/[Dx] citation]
- **Finding 3**: [Specific insight with [Sx]/[Dx] citation]
- **Finding 4**: [Strategic takeaway with [Sx]/[Dx] citation]

---
"""

def assemble_final_dossier(
    query: str,
    section_drafts: Dict[str, str],
    outline: List[SectionSpec],
    evidence_manifest: List[Dict[str, Any]],
    run_id: Optional[str] = None,
) -> str:
    """
    Stitches drafted sections together and drafts the Executive Intelligence Briefing last,
    guaranteeing that the executive summary reflects verified section facts.
    Appends a deterministic Bibliography of all sources.
    """
    combined_body = "\n\n".join(section_drafts.get(sec["id"], "") for sec in outline)

    # Synthesize Executive Summary
    exec_prompt = f"""PRIMARY RESEARCH TOPIC:
"{query}"

DRAFTED RESEARCH SECTIONS:
{combined_body[:10000]}

Draft the definitive Executive Title and Executive Intelligence Briefing (TL;DR) based strictly on the findings above.
"""
    messages = [
        {"role": "system", "content": EXECUTIVE_SUMMARY_PROMPT},
        {"role": "user", "content": exec_prompt}
    ]

    res = call_gateway(
        group="write",
        messages=messages,
        temperature=0.15,
        max_tokens=1500,
        json_mode=False,
        timeout=45.0,
        run_id=run_id,
        agent_name="executive_briefing",
    )

    exec_briefing = res.content.strip() if res.content else f"# Research dossier: {query}\n\n## Executive Intelligence Briefing\n\nA direct answer could not be generated because the language model provider was unavailable. The evidence collected for this run remains listed below; no synthesized conclusion is presented."

    # Build Bibliography deterministically
    bib_lines = ["\n\n## Evidence Sources & Citations", ""]
    for ev in evidence_manifest:
        sid = ev.get("source_id", "S?")
        stype = ev.get("source_type", "web")
        title = ev.get("title", "Untitled Source")
        if stype == "user_doc":
            dname = ev.get("doc_name", "Document")
            pnum = ev.get("page_number", 1)
            bib_lines.append(f"- **[{sid}]** *{title}* — Internal Document: `{dname}` (Page {pnum})")
        else:
            url = ev.get("url", "#")
            domain = ev.get("domain", "web")
            bib_lines.append(f"- **[{sid}]** [{title}]({url}) — *{domain}* (Authority: {ev.get('authority_score', 0.7):.2f})")

    final_report = f"{exec_briefing}\n\n{combined_body}\n{''.join(bib_lines)}"
    return final_report
