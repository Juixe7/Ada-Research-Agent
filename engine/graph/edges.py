from engine.graph.state import RunState
from engine.celery_app import get_job_state

def route_after_research(state: RunState) -> str:
    """Quick runs skip the adversarial critic; other depths audit evidence."""
    current = get_job_state(state.get("run_id"))
    if current and current.get("status") == "cancelled":
        return "cancelled"
    return "outline" if state.get("settings", {}).get("depth") == "quick" else "critic"

def route_critic(state: RunState) -> str:
    """
    Conditional routing edge following Adversarial Critic audit.
    If knowledge gaps or conflicting claims were detected and the iteration budget allows,
    route to 'arbiter' for another targeted search round; otherwise proceed to 'outline'.
    Quick mode always proceeds directly to 'outline'.
    """
    depth = state.get("settings", {}).get("depth", "standard")
    current = get_job_state(state.get("run_id"))
    if current and current.get("status") == "cancelled":
        return "cancelled"
    if depth == "quick":
        return "outline"

    round_num = state.get("round", 1)
    max_rounds = state.get("max_rounds", 2)
    arbiter_queries = state.get("arbiter_queries", [])

    if arbiter_queries and round_num <= max_rounds:
        return "arbiter"

    return "outline"
