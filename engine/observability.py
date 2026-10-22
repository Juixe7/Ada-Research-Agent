"""Optional Langfuse instrumentation for complete Ada research runs."""

from __future__ import annotations

import logging
import os
from contextlib import ExitStack, contextmanager
from typing import Any, Iterator, Optional

logger = logging.getLogger(__name__)


@contextmanager
def research_run_trace(run_id: Optional[str], query: str) -> Iterator[Any]:
    """Create one optional Langfuse root span around a research graph invocation.

    The LLM gateway records provider attempts as nested generation
    observations under this root span.
    Tracing is opt-in and best-effort; missing SDK/configuration never blocks
    research. With tracing enabled, the query and model calls may contain
    sensitive research or private-document content.
    """
    enabled = os.getenv("LANGFUSE_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    if not enabled or not run_id:
        yield None
        return

    try:
        # Langfuse SDK v4 uses LANGFUSE_BASE_URL. Accept the earlier OTEL host
        # name as a local compatibility fallback for existing .env files.
        base_url = (os.getenv("LANGFUSE_BASE_URL") or os.getenv("LANGFUSE_OTEL_HOST") or "").strip()
        if base_url:
            os.environ.setdefault("LANGFUSE_BASE_URL", base_url)
        from langfuse import get_client, propagate_attributes
        from packages.llm_gateway.tracing import trace_id_for_run

        client = get_client()
    except Exception:
        logger.exception("Langfuse tracing was enabled but could not initialize")
        yield None
        return

    stack = ExitStack()
    try:
        stack.enter_context(propagate_attributes(session_id=str(run_id), tags=["ada", "research-run"]))
        span = stack.enter_context(
            client.start_as_current_observation(
                as_type="span",
                name="ada.research.run",
                trace_context={"trace_id": trace_id_for_run(str(run_id))},
                input={"query": query},
                metadata={"run_id": str(run_id), "service": "ada"},
            )
        )
    except Exception:
        logger.exception("Langfuse run observation could not be started; continuing without tracing")
        try:
            stack.close()
        except Exception:
            logger.debug("Unable to close a partially initialized Langfuse context", exc_info=True)
        try:
            yield None
        finally:
            try:
                client.flush()
            except Exception:
                logger.exception("Unable to flush the partially initialized Langfuse trace")
        return

    try:
        yield span
    except BaseException as error:
        try:
            stack.__exit__(type(error), error, error.__traceback__)
        except Exception:
            logger.debug("Unable to close the failed Langfuse run observation", exc_info=True)
        raise
    else:
        try:
            stack.close()
        except Exception:
            logger.exception("Unable to close the Langfuse run observation")
    finally:
        try:
            client.flush()
        except Exception:
            logger.exception("Unable to flush the Langfuse research trace")
