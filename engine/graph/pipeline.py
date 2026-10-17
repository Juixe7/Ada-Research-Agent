"""Constructs and executes the LangGraph research pipeline.

"""

import os
from typing import Dict, Any, Optional
from langgraph.graph import StateGraph, START, END
from engine.graph.state import RunState
from engine.graph.nodes import (
    scope_node,
    plan_node,
    research_node,
    critic_node,
    arbiter_node,
    outline_node,
    synthesize_sections_node,
    assemble_node,
    verify_node,
    score_node,
    finalize_node
)
from engine.graph.edges import route_after_research, route_critic

def build_research_graph():
    """
    Construct and compile the reusable LangGraph research workflow.

    Args:
        None. Node behavior and conditional routing are bound at module level.

    Returns:
        A compiled graph accepting `RunState` inputs and returning its final state.

    Failure behavior:
        Graph construction errors from LangGraph or invalid node/edge definitions
        propagate during import; they are not converted into an empty graph.
    """
    builder = StateGraph(RunState)

    # 1. Register all pipeline nodes
    builder.add_node("scope", scope_node)
    builder.add_node("plan", plan_node)
    builder.add_node("research", research_node)
    builder.add_node("critic", critic_node)
    builder.add_node("arbiter", arbiter_node)
    builder.add_node("outline", outline_node)
    builder.add_node("synthesize_sections", synthesize_sections_node)
    builder.add_node("assemble", assemble_node)
    builder.add_node("verify", verify_node)
    builder.add_node("score", score_node)
    builder.add_node("finalize", finalize_node)

    # 2. Add sequential and conditional edges
    builder.add_edge(START, "scope")
    builder.add_edge("scope", "plan")
    builder.add_edge("plan", "research")
    builder.add_conditional_edges(
        "research",
        route_after_research,
        {"critic": "critic", "outline": "outline", "cancelled": END},
    )

    # Conditional branching following Adversarial Critic
    builder.add_conditional_edges(
        "critic",
        route_critic,
        {
            "arbiter": "arbiter",
            "outline": "outline",
            "cancelled": END,
        }
    )

    # Dynamic Arbiter loops back to Critic for verification
    builder.add_edge("arbiter", "critic")

    # Synthesis, verification, and scoring pipeline
    builder.add_edge("outline", "synthesize_sections")
    builder.add_edge("synthesize_sections", "assemble")
    builder.add_edge("assemble", "verify")
    builder.add_edge("verify", "score")
    builder.add_edge("score", "finalize")
    builder.add_edge("finalize", END)

    return builder.compile()

# Compile single reusable instance
compiled_research_graph = build_research_graph()

def execute_graph_pipeline(
    query: str,
    depth: str = "deep",
    include_user_docs: bool = True,
    report_id: Optional[str] = None,
    selected_docs: Optional[list] = None,
    custom_angles: Optional[list] = None,
    clarification_choice: Optional[str] = None,
    user_id: Optional[str] = None,
    blocked_domains: Optional[list] = None,
) -> Dict[str, Any]:
    """
    Execute the compiled graph for one research question.

    Args:
        query: User's research question.
        depth: Research depth; `deep` allows up to two research rounds.
        include_user_docs: Whether private vault evidence is eligible.
        report_id: Stable external run/report identifier, generated if omitted.
        selected_docs: Optional document names eligible for retrieval.
        custom_angles: User-supplied research angles to include in planning.
        clarification_choice: Optional selected answer to a preflight question.
        user_id: Owner identity used to scope private document retrieval.
        blocked_domains: Domains excluded from web search.

    Returns:
        The final `RunState` as a dictionary, including report, evidence,
        warnings, scores and artifact metadata populated by completed nodes.

    Failure behavior:
        Unhandled node, provider, and persistence exceptions propagate to the
        task boundary, which records run failure where possible.
    """
    initial_state: RunState = {
        "run_id": report_id or f"run_{os.urandom(4).hex()}",
        "query": query,
        "settings": {
            "depth": depth,
            "include_user_docs": include_user_docs,
            "selected_docs": selected_docs,
            "custom_angles": custom_angles,
            "clarification_choice": clarification_choice,
            "user_id": user_id,
            "blocked_domains": blocked_domains or [],
        },
        "brief": None,
        "plan": [],
        "track_status": {},
        "evidence_manifest": [],
        "critic_findings": {},
        "round": 0,
        "max_rounds": 2 if depth == "deep" else 1,
        "arbiter_queries": [],
        "outline": [],
        "sections": {},
        "report_markdown": None,
        "guard_results": None,
        "scores": None,
        "export_paths": None,
        "warnings": []
    }

    final_state = compiled_research_graph.invoke(initial_state)
    return final_state
