"""Checks question scope and prepares clarifying guidance before research dispatch.

"""

import json
import re
import time
from typing import List, Dict, Any, Optional
from groq import Groq
from engine.config import GROQ_API_KEY, GROQ_PLANNER_MODEL

PREFLIGHT_SYSTEM_PROMPT = """You are the Pre-Flight Scoping Agent of Ada Deep Research.
Your goal is to align with the user before heavy web scrapers and crawlers run, ensuring the final research report directly fulfills their intended purpose.

You must:
1. Detect ENTITY AMBIGUITY / POLYSEMY:
   - Check if the query matches an internal project/document in the user's private vault (context provided below if found) AND a different real-world public company, platform, or historical subject on the public web.
   - Example: "Ada" matches both an internal multi-agent engine in a user's resume AND the commercial platform "ada.cx" (customer service AI).
   - If ambiguity exists:
     * Explain clearly WHY it exists and WHERE each meaning comes from (Vault source snippet vs Public Web entity/domain).
     * Provide 2 to 3 discrete clarification options (e.g., "Internal Project from Vault", "Commercial Platform (ada.cx)", "Compare Both").
   - If no ambiguity exists, set "ambiguity_detected": false.

2. Generate HUMAN-READABLE RESEARCH ANGLES / TOPICS (3 to 4 angles):
   - STRICT RULE: NEVER display developer plumbing or internal pipeline jargon (NO "Celery DAG", "Adversarial Critic", "FastEmbed ONNX", "3-tier scraper", "vector chunking").
   - Display substantive research topics the user actually cares about (e.g., "System Architecture & Dataflow", "Dual Retrieval & Evidence Grounding", "Comparison with Industry SOTA", "Production Bottlenecks & Operational Costs").
   - Each angle must have: id, title, description (1 sentence), source_scope ("Private Vault", "Public Web", or "Combined"), and enabled (true).

3. If the user provided a "user_modification" instruction (e.g., "Focus only on internal project", "Add hosting costs", "Remove topic 3"), strictly adjust the plan and angles to satisfy their instruction.

Return ONLY a valid JSON object with EXACTLY this structure:
{
  "ambiguity_detected": true,
  "ambiguity_explanation": "Your query 'Ada' matches an internal research engine in your vault as well as the commercial AI customer support platform ada.cx on the public web.",
  "ambiguity_sources": {
    "vault": {
      "doc_name": "Proprietary_Architecture_Spec.pdf",
      "snippet": "Autonomous multi-agent research engine built with Celery, Redis, Qdrant, Docker, FastEmbed"
    },
    "web": {
      "entity": "Ada Support Inc. (ada.cx)",
      "origin": "Toronto, Canada",
      "snippet": "Enterprise customer service AI automation platform backed by Accel and Bessemer"
    }
  },
  "clarification_options": [
    { "id": "vault_focus", "title": "Internal Project from Vault", "description": "Investigate the multi-agent engine described in Proprietary_Architecture_Spec.pdf" },
    { "id": "web_focus", "title": "Commercial Platform (ada.cx)", "description": "Investigate the commercial customer service AI automation company" },
    { "id": "compare_both", "title": "Compare & Contrast Both", "description": "Analyze both entities and highlight differences in system design" }
  ],
  "research_angles": [
    {
      "id": 1,
      "title": "System Architecture & Execution Flow",
      "description": "How the system coordinates parallel tasks, agent responsibilities, and intermediate state.",
      "source_scope": "Combined",
      "enabled": true
    },
    {
      "id": 2,
      "title": "Dual Retrieval & Evidence Grounding",
      "description": "Mechanisms for cross-referencing private documents with real-time public web search.",
      "source_scope": "Combined",
      "enabled": true
    },
    {
      "id": 3,
      "title": "Comparison with Industry Frameworks",
      "description": "Architectural trade-offs compared to alternatives like LangGraph, AutoGen, and STORM.",
      "source_scope": "Public Web",
      "enabled": true
    }
  ],
  "estimated_duration_seconds": 35,
  "suggested_perspective": "Technical Architecture & System Design"
}
"""

def evaluate_preflight_scope(
    query: str,
    vault_doc_names: Optional[List[str]] = None,
    user_modification: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Evaluates research intent, detects entity ambiguity between private vault documents
    and the public web, and generates human-readable research angles.
    """
    # ── Step 1: Fast Private Vault Cross-Reference ──
    vault_match_context = ""
    vault_doc_snippet = None
    vault_doc_name = None

    if vault_doc_names and len(vault_doc_names) > 0:
        try:
            from engine.storage.vector_store import get_vector_store
            vs = get_vector_store()
            matches = vs.search_user_docs(
                query,
                top_k=3,
                score_threshold=0.35,
                selected_docs=vault_doc_names,
                user_id=user_id,
            )
            if matches:
                top_m = matches[0]
                vault_doc_name = top_m.get("doc_name")
                vault_doc_snippet = top_m.get("text", "")[:350].replace("\n", " ").strip()
                vault_match_context = f"""
POTENTIAL PRIVATE VAULT MATCH FOUND:
- Document: "{vault_doc_name}" (Page {top_m.get('page_number', 1)})
- Relevance Score: {top_m.get('score')}
- Excerpt: "{vault_doc_snippet}"
"""
        except Exception as e:
            print(f"[preflight] Vault peek warning: {e}")

    # ── Step 2: Formulate Prompt for Pre-Flight Scoping LLM ──
    user_prompt_lines = [
        f'USER QUERY: "{query}"',
        vault_match_context if vault_match_context else "NO OVERLAPPING PRIVATE VAULT MATCHES DETECTED.",
    ]
    if user_modification:
        user_prompt_lines.append(f'USER PLAN MODIFICATION / PREFERENCES: "{user_modification}"')

    user_prompt = "\n\n".join(user_prompt_lines)

    from engine.agents.llm_resilient import call_resilient_llm
    content = call_resilient_llm(
        system_prompt=PREFLIGHT_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        temperature=0.1,
        max_tokens=1500,
        json_mode=True
    )
    if content:
        try:
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                raw_json = json_match.group(0)
                clean_json = re.sub(r',\s*([\]\}])', r'\1', raw_json)
                data = json.loads(clean_json)

                # Ensure vault origin details are grounded if we detected them
                if vault_doc_snippet and data.get("ambiguity_detected"):
                    sources = data.setdefault("ambiguity_sources", {})
                    if "vault" not in sources or not sources["vault"].get("snippet"):
                        sources["vault"] = {
                            "doc_name": vault_doc_name,
                            "snippet": vault_doc_snippet
                        }

                return data
        except Exception as e:
            print(f"[preflight] Preflight parse error: {e}")

    # ── Resilient Fallback ──
    has_vault = bool(vault_doc_snippet)
    return {
        "ambiguity_detected": has_vault,
        "ambiguity_explanation": f"Your inquiry may reference the internal project in '{vault_doc_name}' or related external technologies on the web." if has_vault else "Research plan synthesized for broad investigation.",
        "ambiguity_sources": {
            "vault": {
                "doc_name": vault_doc_name or "Private Document",
                "snippet": vault_doc_snippet or "Internal project reference"
            } if has_vault else None,
            "web": {
                "entity": "Public Technology & Industry Landscape",
                "origin": "Public Web",
                "snippet": f"Public ecosystem analysis for {query}"
            }
        },
        "clarification_options": [
            { "id": "vault_focus", "title": "Internal Project from Vault", "description": f"Focus on findings in {vault_doc_name}" },
            { "id": "web_focus", "title": "Comprehensive Public Web", "description": "Focus on publicly available industry data and web sources" },
            { "id": "compare_both", "title": "Combined Synthesis", "description": "Cross-reference both private vault evidence and public web consensus" }
        ] if has_vault else [],
        "research_angles": [
            {
                "id": 1,
                "title": "System Architecture & Foundations",
                "description": f"Core design, primary mechanics, and implementation of {query}.",
                "source_scope": "Combined" if has_vault else "Public Web",
                "enabled": True
            },
            {
                "id": 2,
                "title": "Capabilities, Benchmarks & Metrics",
                "description": f"Empirical performance, verification standards, and real-world benchmarks.",
                "source_scope": "Combined" if has_vault else "Public Web",
                "enabled": True
            },
            {
                "id": 3,
                "title": "Comparative Analysis & Trade-offs",
                "description": f"How {query} compares to prevailing alternatives and potential bottlenecks.",
                "source_scope": "Public Web",
                "enabled": True
            }
        ],
        "estimated_duration_seconds": 35,
        "suggested_perspective": "Technical Architecture & System Design"
    }
