"""Evidence coverage and contradiction review for a research run.

"""

import json
import re
from typing import List, Dict, Any, Optional
CRITIC_SYSTEM_PROMPT = """You are the Lead Adversarial Critic and Auditor of an autonomous deep research engine.
Your mission is to rigorously evaluate the gathered evidence for a research investigation.

You must identify:
1. Knowledge Gaps: Key blind spots, missing regional angles, or unaddressed technical bottlenecks.
2. Contradictions & Nuances: Opposing numbers, conflicting deployment timelines, or disputed definitions across different sources.
3. Arbiter Queries: If there is a critical gap or direct factual contradiction, formulate 1 to 2 surgical search queries to resolve the discrepancy. If coverage is already thorough, return an empty list of arbiter queries.

Return ONLY a valid JSON object with EXACTLY these keys:
{
  "coverage_quality": "comprehensive" | "moderate" | "sparse",
  "coverage_score": 85,
  "identified_gaps": ["description of gap 1"],
  "contradictions": [
    {
      "topic": "Topic of conflict",
      "claim_a": "Claim from one perspective",
      "claim_b": "Opposing claim or caveat",
      "analysis": "Brief evaluation of why the discrepancy exists"
    }
  ],
  "arbiter_queries": ["targeted query 1", "targeted query 2"],
  "suggested_next_inquiries": [
    "High-impact follow-up question 1 targeting blind spots",
    "High-impact follow-up question 2 on technical trade-offs",
    "High-impact follow-up question 3 on future scalability"
  ]
}
"""

def audit_research_evidence(
    query: str,
    sub_tasks: List[Dict[str, Any]],
    evidence_manifest: List[Dict[str, Any]],
    run_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Audits the collective evidence manifest for knowledge gaps and factual contradictions.
    Formulates targeted arbiter queries if crucial information is missing.
    """
    # Create a dense summary manifest for the Critic LLM
    evidence_summary = []
    for idx, ev in enumerate(evidence_manifest[:18], 1):
        source_label = ev.get("source_id", f"S{idx}")
        title = ev.get("title", "Untitled")
        auth = ev.get("authority_score")
        # Compact excerpt
        excerpt = ev.get("text", "")[:350].replace("\n", " ")
        evidence_summary.append(f"[{source_label}] (Authority {auth}) {title}\n  Summary: {excerpt}...")

    evidence_text = "\n\n".join(evidence_summary)

    user_prompt = f"""Investigative Topic: "{query}"

Sub-tasks Investigated:
{json.dumps([st.get('sub_question') for st in sub_tasks], indent=2)}

Gathered Evidence Summary ({len(evidence_manifest)} total sources):
{evidence_text}

Conduct an adversarial audit. Identify gaps, check for conflicting metrics or timelines, and propose arbiter queries if needed.
"""

    from engine.agents.llm_resilient import call_resilient_llm
    content = call_resilient_llm(
        system_prompt=CRITIC_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        temperature=0.1,
        max_tokens=900,
        json_mode=True,
        group="large",
        run_id=run_id,
        agent_name="critic",
    )
    if content:
        try:
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                raw_json = json_match.group(0)
                clean_json = re.sub(r',\s*([\]\}])', r'\1', raw_json)
                audit = json.loads(clean_json)
                return audit
        except Exception as e:
            print(f"[critic] Critic LLM parse error ({e}). Returning baseline audit.")

    # Do not invent gaps or arbiter queries when the audit model is unavailable.
    return {
        "status": "unavailable",
        "coverage_quality": "unavailable",
        "coverage_score": None,
        "identified_gaps": [],
        "contradictions": [],
        "arbiter_queries": [],
        "suggested_next_inquiries": [],
        "warning": "Evidence critique was unavailable; no gap or contradiction findings were inferred.",
    }
