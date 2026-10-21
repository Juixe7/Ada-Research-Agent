"""Optional Langfuse observations for model calls made by the gateway."""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any, Iterator, Optional

logger = logging.getLogger(__name__)


def _enabled() -> bool:
    """Return whether Langfuse tracing is explicitly enabled for this process."""
    return os.getenv("LANGFUSE_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


@contextmanager
def llm_generation(
    *,
    run_id: Optional[str],
    agent_name: Optional[str],
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> Iterator[Any]:
    """Record one provider attempt as a Langfuse generation under the run span.

    Args:
        run_id: Research run identifier. A missing ID skips instrumentation.
        agent_name: Ada agent responsible for the provider call.
        model: Fully qualified LiteLLM model name.
        messages: Exact chat messages sent to the provider.
        temperature: Sampling temperature passed to the provider.
        max_tokens: Provider output-token limit.

    Yields:
        The Langfuse generation observation, or ``None`` when tracing is off.

    Failure behavior:
        Missing optional SDK/configuration is logged and does not block the
        model request. Provider exceptions are re-raised after marking the
        generation as failed, so existing gateway failover remains in control.
    """
    if not _enabled() or not run_id:
        yield None
        return

    required = ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
    if any(not os.getenv(name, "").strip() for name in required):
        yield None
        return

    try:
        from langfuse import get_client
    except ImportError:
        logger.warning("Langfuse tracing is enabled, but its optional SDK is unavailable")
        yield None
        return

    try:
        client = get_client()
        manager = client.start_as_current_observation(
            as_type="generation",
            name=f"ada.{agent_name or 'research'}",
            model=model,
            model_parameters={"temperature": temperature, "max_tokens": max_tokens},
            input=messages,
            metadata={"run_id": str(run_id), "service": "ada"},
        )
        observation = manager.__enter__()
    except Exception:
        logger.exception("Unable to create a Langfuse model observation")
        yield None
        return

    try:
        yield observation
    except Exception as error:
        try:
            observation.update(level="ERROR", status_message="Provider request failed")
        except Exception:
            logger.debug("Unable to mark the Langfuse generation as failed", exc_info=True)
        try:
            manager.__exit__(type(error), error, error.__traceback__)
        except Exception:
            logger.debug("Unable to close the failed Langfuse generation", exc_info=True)
        raise
    else:
        try:
            manager.__exit__(None, None, None)
        except Exception:
            logger.exception("Unable to close the Langfuse model observation")
