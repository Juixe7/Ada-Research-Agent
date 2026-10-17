"""Lazy exports for graph pipeline construction and invocation.

"""

from engine.graph.state import RunState, SectionSpec

__all__ = [
    "RunState",
    "SectionSpec",
    "compiled_research_graph",
    "execute_graph_pipeline",
    "build_research_graph"
]


def __getattr__(name):
    """Load the graph runtime only when a caller requests a runtime export.

    Keeping the state package lightweight avoids a cycle when graph nodes import
    agents that themselves use the graph state types.
    """
    if name in {"compiled_research_graph", "execute_graph_pipeline", "build_research_graph"}:
        from engine.graph import pipeline
        return getattr(pipeline, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
