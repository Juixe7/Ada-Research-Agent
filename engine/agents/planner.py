"""Creates research tracks and search questions from the user research brief.

"""

import json
import re
from typing import List, Dict, Any, Optional
from groq import Groq
from engine.config import GROQ_API_KEY, GROQ_PLANNER_MODEL

PLANNER_SYSTEM_PROMPT = """You are the Lead Planning Agent of an autonomous deep research engine.
Your task is to take a macro research query and decompose it into an optimal research plan consisting of 3 to 5 orthogonal sub-questions.

Guidelines:
1. Cover foundational technical/scientific reality, economic/commercial viability, bottlenecks/counter-arguments, and recent real-world breakthroughs.
2. For each sub-question, formulate 1 to 2 targeted, high-precision search queries suitable for web search engines.
3. Categorize each track (e.g., 'technical', 'economic', 'counter_thesis', 'regulatory', 'case_study').
4. Avoid redundant or overlapping questions.

Return ONLY a valid JSON array of objects with EXACTLY these keys:
[
  {
    "id": 1,
    "category": "technical",
    "sub_question": "What are the latest scientific milestones in plasma confinement?",
    "search_queries": ["nuclear fusion plasma confinement breakthrough 2025 2026", "NIF ITER Q value net energy"]
  }
]
"""

def generate_research_plan(
    query: str,
    depth: str = "deep",
    custom_angles: Optional[List[str]] = None,
    clarification_context: Optional[str] = None,
    run_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Decomposes a research topic into an orthogonal DAG of sub-questions and search vectors.
    Respects user-approved research angles and clarification choices from the Pre-Flight Blueprint.
    """
    num_questions = len(custom_angles) if custom_angles and len(custom_angles) > 0 else {
        "quick": 3, "standard": 4, "deep": 5
    }.get(depth, 4)
    
    prompt_lines = [
        f'Research Topic: "{query}"'
    ]
    if clarification_context:
        prompt_lines.append(f'Scope Clarification: "{clarification_context}"')
    if custom_angles and len(custom_angles) > 0:
        angles_str = "\n".join(f"- {a}" for a in custom_angles)
        prompt_lines.append(f"Generate targeted sub-questions directly covering these approved angles:\n{angles_str}")
    else:
        prompt_lines.append(f"Decompose this research topic into {num_questions} orthogonal investigation tracks.")

    user_prompt = "\n\n".join(prompt_lines)

    from engine.agents.llm_resilient import call_resilient_llm
    content = call_resilient_llm(
        system_prompt=PLANNER_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        temperature=0.1,
        max_tokens=1200,
        json_mode=False,
        run_id=run_id,
        agent_name="planner",
    )
    if content:
        try:
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                raw_json = json_match.group(0)
                clean_json = re.sub(r',\s*([\]\}])', r'\1', raw_json)
                plan = json.loads(clean_json)
                if isinstance(plan, list) and len(plan) > 0:
                    return plan[:6]
        except Exception as e:
            print(f"[planner] Lead Planner parse error ({e}).")

    # Resilient heuristic plan fallback
    return [
        {
            "id": 1,
            "category": "technical_core",
            "sub_question": f"What is the current technical state and mechanism of {query}?",
            "search_queries": [f"{query} overview technical breakdown", f"{query} latest developments 2025 2026"]
        },
        {
            "id": 2,
            "category": "counter_thesis",
            "sub_question": f"What are the primary criticisms, limitations, and bottlenecks of {query}?",
            "search_queries": [f"{query} limitations criticism challenges", f"{query} bottlenecks failure risks"]
        },
        {
            "id": 3,
            "category": "market_impact",
            "sub_question": f"What is the commercial, economic, or real-world timeline for {query}?",
            "search_queries": [f"{query} market adoption timeline economic feasibility", f"{query} industry impact analysts"]
        }
    ]
