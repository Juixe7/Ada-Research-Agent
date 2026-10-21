"""Typed state schema shared by nodes in the research graph.

"""

from typing import TypedDict, List, Dict, Any, Optional

class SectionSpec(TypedDict):
    """Typed specification of one report section and its assigned sources."""
    id: str
    title: str
    goal: str
    assigned_source_ids: List[str]
    deterministic_tables: Optional[str]

class RunState(TypedDict):
    """Shared state contract passed between research graph nodes."""
    run_id: str
    query: str
    settings: Dict[str, Any]
    brief: Optional[Dict[str, Any]]
    plan: List[Dict[str, Any]]
    track_status: Dict[str, str]
    evidence_manifest: List[Dict[str, Any]]
    critic_findings: Dict[str, Any]
    round: int
    max_rounds: int
    arbiter_queries: List[str]
    outline: List[SectionSpec]
    sections: Dict[str, str]
    report_markdown: Optional[str]
    guard_results: Optional[Dict[str, Any]]
    scores: Optional[Dict[str, Any]]
    export_paths: Optional[Dict[str, Any]]
    warnings: List[str]
    resource_budget: Optional[Any]
