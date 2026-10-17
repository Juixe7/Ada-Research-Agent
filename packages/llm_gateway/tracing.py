"""Stable identifiers used to correlate Ada runs with external LLM traces."""

import uuid


def trace_id_for_run(run_id: str) -> str:
    """Return a deterministic, valid 32-character Langfuse trace ID per run."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"ada-research-run:{run_id}").hex
