"""Make one small uncached model call and verify Ada's local trace wiring."""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")


def main() -> int:
    """Emit one run-correlated model generation for Langfuse UI inspection."""
    missing = [
        name for name in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
        if not os.getenv(name, "").strip()
    ]
    if missing:
        print(
            "Langfuse smoke check needs project keys in the ignored root .env: "
            + ", ".join(missing),
            file=sys.stderr,
        )
        return 2

    # This explicit local demo command opts in for this process only.
    os.environ["LANGFUSE_ENABLED"] = "true"

    from engine.observability import research_run_trace
    from packages.llm_gateway.client import LLMClient
    from packages.llm_gateway.tracing import trace_id_for_run

    run_id = f"ada-demo-smoke-{uuid.uuid4()}"
    try:
        with research_run_trace(run_id, "Ada Langfuse tracing smoke check") as trace:
            if trace is None:
                print("Langfuse could not initialize; inspect the server log.", file=sys.stderr)
                return 1

            result = LLMClient().complete(
                group="small",
                messages=[{"role": "user", "content": "Reply with exactly TRACE_OK."}],
                temperature=0.2,
                max_tokens=16,
                timeout=20,
                run_id=run_id,
                agent_name="demo_smoke",
            )
            success = bool(result.content)
            trace.update(output={"status": "completed" if success else "failed"})

        print(json.dumps({
            "status": "completed" if success else "failed",
            "run_id": run_id,
            "langfuse_trace_id": trace_id_for_run(run_id),
            "session_id": run_id,
            "model": result.model,
            "cache_hit": result.cache_hit,
            "note": "Filter Langfuse by session_id; this smoke check makes one short, billable model call.",
        }, indent=2))
        return 0 if success else 1
    except Exception:
        print("Langfuse smoke check failed; inspect the local backend log for details.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
