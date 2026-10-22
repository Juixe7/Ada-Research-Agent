"""Condenses prior session turns into bounded context for incremental research.

"""

import json
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

CONDENSATION_SYSTEM_PROMPT = """You are the Evidence-Delta Memory Agent of Ada Deep Research.
Your role is to maintain continuous, high-efficiency research state across multi-turn investigations without blowing prompt token limits.

Given the history of previous research turns in this session:
1. Extract the core verified conclusions (maximum 4 bullet points, ~150 words).
2. Identify remaining unresolved tensions, contradictions, or data gaps (~80 words).
3. Compile a deduplicated list of canonical domain/source URLs already examined.

Output ONLY a JSON object with this exact structure:
{
  "condensed_summary": "Prior investigation established cell-level energy density for solid-state batteries reaches 400 Wh/kg vs 180 Wh/kg for LFP. However, manufacturing yield bottlenecks remain at roll-to-roll electrolyte separator sintering...",
  "established_facts": [
    "Solid-state reaches 400 Wh/kg in laboratory pouch cells",
    "LFP commercial cost benchmark is $55/kWh at pack level"
  ],
  "unresolved_gaps": [
    "Commercial roll-to-roll separator yields at gigafactory scale",
    "Cold-temperature conductivity under -20°C"
  ],
  "cached_urls": [
    "https://nature.com/articles/s41560-023-01234",
    "https://energy.gov/eere/vehicles/articles"
  ]
}
"""

def condense_session_turns(turns_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Condenses previous research turns into a dense 300-word working memory
    and URL deduplication cache.
    """
    if not turns_data:
        return {
            "condensed_summary": "",
            "established_facts": [],
            "unresolved_gaps": [],
            "cached_urls": []
        }

    # Aggregate turns into a compact text digest
    digest_lines = []
    cached_urls = []
    for idx, turn in enumerate(turns_data, 1):
        q = turn.get("query", "")
        title = turn.get("executive_title", "")
        summary = turn.get("summary", "")[:600]
        sources = turn.get("sources", [])
        for s in sources:
            url = s.get("url")
            if url and url not in cached_urls:
                cached_urls.append(url)

        digest_lines.append(f"Turn {idx} Query: {q}\nTitle: {title}\nSummary: {summary}\n")

    combined_digest = "\n---\n".join(digest_lines)

    from engine.agents.llm_resilient import call_resilient_llm
    raw = call_resilient_llm(
        system_prompt=CONDENSATION_SYSTEM_PROMPT,
        user_prompt=f"Condense this research history:\n\n{combined_digest}",
        temperature=0.2,
        max_tokens=1000,
        json_mode=True
    )
    if raw:
        try:
            parsed = json.loads(raw)
            all_urls = list(set(parsed.get("cached_urls", []) + cached_urls))
            parsed["cached_urls"] = all_urls[:30]
            return parsed
        except Exception:
            logger.warning("Prior-turn summary could not be parsed; using deterministic fallback")

    # Robust algorithmic fallback if LLM is unavailable
    facts = []
    for t in turns_data:
        if t.get("executive_title"):
            facts.append(f"Analyzed: {t.get('executive_title')}")

    return {
        "condensed_summary": f"Prior research covered {len(turns_data)} previous inquiry turns focusing on " + ", ".join([t.get('query', '')[:50] for t in turns_data]),
        "established_facts": facts[:4],
        "unresolved_gaps": ["Detailed quantitative trade-offs for follow-up inquiry"],
        "cached_urls": cached_urls[:30]
    }

def format_delta_planning_context(working_memory: Dict[str, Any]) -> str:
    """
    Formats the delta constraints to inject into the Lead Planner agent.
    """
    if not working_memory or not working_memory.get("condensed_summary"):
        return ""

    summary = working_memory.get("condensed_summary", "")
    facts = "\n".join(f"- {f}" for f in working_memory.get("established_facts", []))
    gaps = "\n".join(f"- {g}" for g in working_memory.get("unresolved_gaps", []))
    cached_count = len(working_memory.get("cached_urls", []))

    return f"""
EVIDENCE-DELTA WORKING MEMORY (Prior Session Context):
-------------------------------------------------------
Prior Findings Summary:
{summary}

Established Conclusions (DO NOT DUPLICATE):
{facts}

Target Unresolved Gaps:
{gaps}

Cached Citation Count: {cached_count} URLs already analyzed.

INSTRUCTION FOR THIS TURN:
Perform Delta Retrieval. Formulate sub-questions targeting ONLY novel, unverified aspects of the new hypothesis.
Avoid re-asking questions already answered above.
-------------------------------------------------------
"""
