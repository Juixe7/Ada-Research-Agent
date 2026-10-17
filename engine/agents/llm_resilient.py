"""Shared resilient LLM gateway access and provider error reporting for agents.

"""

import time
import json
import threading
from typing import Optional, Dict, Any, List, Type
from pydantic import BaseModel

from engine.config import (
    GROQ_API_KEY,
    GEMINI_API_KEY,
    REDIS_URL,
    LLM_GROUPS,
    LLM_DEFAULT_RPM,
    LLM_DEFAULT_TPM,
    RUN_COST_BUDGET_USD,
    RUN_TOKEN_BUDGET,
)
from packages.llm_gateway import (
    LLMClient,
    LLMResult,
    ModelGroup,
    TokenBucketLimiter,
    ResponseCache
)

def _get_redis_safe() -> Optional[Any]:
    """Connect to Redis for shared limits/cache, or return `None` on failure.

    Failure behavior:
        Connection/import errors are intentionally swallowed so the gateway can
        continue with process-local limiter/cache behavior.
    """
    try:
        import redis
        client = redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=1.0, socket_timeout=1.0)
        client.ping()
        return client
    except Exception:
        return None

# Shared Gateway Singleton
_gateway_instance: Optional[LLMClient] = None
_gateway_lock = threading.Lock()
LAST_LLM_ERROR: Optional[str] = None


def get_default_gateway() -> LLMClient:
    """Returns thread-safe singleton of the LiteLLM Gateway."""
    global _gateway_instance
    if _gateway_instance is None:
        with _gateway_lock:
            if _gateway_instance is None:
                redis_c = _get_redis_safe()
                limiter = TokenBucketLimiter(
                    redis_client=redis_c,
                    default_rpm=LLM_DEFAULT_RPM,
                    default_tpm=LLM_DEFAULT_TPM
                )
                cache = ResponseCache(redis_client=redis_c, default_ttl=86400)
                _gateway_instance = LLMClient(
                    model_groups=LLM_GROUPS,
                    limiter=limiter,
                    cache=cache
                )
    return _gateway_instance


def get_last_llm_error() -> Optional[str]:
    """Returns the most recent LLM provider error message for actionable diagnosis."""
    global LAST_LLM_ERROR
    return LAST_LLM_ERROR


def call_gateway(
    group: ModelGroup,
    messages: List[Dict[str, str]],
    schema: Optional[Type[BaseModel]] = None,
    temperature: float = 0.15,
    max_tokens: int = 1500,
    json_mode: bool = False,
    timeout: float = 40.0,
    run_id: Optional[str] = None,
    agent_name: Optional[str] = None
) -> LLMResult:
    """Invoke the configured gateway, enforce run budgets, and record telemetry.

    Args:
        group: Model group used to select primary/fallback providers.
        messages: LiteLLM-compatible messages.
        schema: Optional structured response schema.
        temperature: Sampling temperature.
        max_tokens: Maximum completion tokens.
        json_mode: Request JSON-formatted output.
        timeout: Provider call timeout in seconds.
        run_id: Optional run used for budget checks, persistence and events.
        agent_name: Optional trace/audit label.

    Returns:
        Full gateway result, including usage, error, degradation and cache data.

    Failure behavior:
        Budget-query and telemetry-persistence exceptions are logged and do not
        block the model call/result. Gateway/limiter exceptions may propagate.
    """
    global LAST_LLM_ERROR
    gateway = get_default_gateway()
    result = None
    if run_id:
        try:
            from engine.storage.relational_store import RelationalStore
            usage = RelationalStore.get_run_usage(run_id)
            if usage["tokens_in"] + usage["tokens_out"] >= RUN_TOKEN_BUDGET:
                result = LLMResult(content="", group=group, degraded=True, error=f"Run token budget of {RUN_TOKEN_BUDGET:,} tokens reached.")
            elif RelationalStore.get_run_cost(run_id) >= RUN_COST_BUDGET_USD:
                result = LLMResult(content="", group=group, degraded=True, error=f"Run cost budget of ${RUN_COST_BUDGET_USD:.2f} reached.")
        except Exception as budget_error:
            print(f"[llm] Budget check notice: {budget_error}")
    if result is None:
        result = gateway.complete(
            group=group,
            messages=messages,
            schema=schema,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=json_mode,
            timeout=timeout,
            run_id=run_id,
            agent_name=agent_name
        )
    LAST_LLM_ERROR = result.error
    if run_id:
        try:
            from engine.storage.relational_store import RelationalStore
            from packages.llm_gateway.tracing import trace_id_for_run

            RelationalStore.record_llm_call(
                run_id=run_id,
                agent=agent_name or group,
                model=result.model or group,
                tokens_in=result.usage.input_tokens,
                tokens_out=result.usage.output_tokens,
                latency_ms=result.latency_ms,
                cost=result.cost_estimate,
                cache_hit=result.cache_hit,
                trace_id=trace_id_for_run(str(run_id)),
            )
            from engine.events import publish_event
            if result.degraded or result.error:
                publish_event(run_id, "provider_degraded", {
                    "agent": agent_name or group,
                    "model": result.model,
                    "fallback_used": bool(result.degraded and result.content),
                    "message": result.error or "Fallback model was used.",
                })
            publish_event(run_id, "llm_call_completed", {
                "agent": agent_name or group,
                "model": result.model,
                "tokens_in": result.usage.input_tokens,
                "tokens_out": result.usage.output_tokens,
                "latency_ms": result.latency_ms,
                "cost": result.cost_estimate,
                "cache_hit": result.cache_hit,
                "degraded": result.degraded,
                "error": result.error,
            })
        except Exception as telemetry_error:
            print(f"[llm] Telemetry persistence notice: {telemetry_error}")
    return result


def call_resilient_llm(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.15,
    max_tokens: int = 1500,
    json_mode: bool = True,
    group: ModelGroup = "small",
    schema: Optional[Type[BaseModel]] = None,
    run_id: Optional[str] = None,
    agent_name: Optional[str] = None,
) -> Optional[str]:
    """
    Backward-compatible text-only facade over the shared LLM gateway.

    Args:
        system_prompt: Instruction message for the model.
        user_prompt: User/task content supplied to the model.
        temperature: Sampling temperature.
        max_tokens: Completion token limit.
        json_mode: Request JSON output when true.
        group: Model group to route through.
        schema: Optional structured response schema.
        run_id: Optional research run for budgets and telemetry.
        agent_name: Optional agent label for traces/events.

    Returns:
        Stripped model content, or `None` if all provider attempts fail.
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    res = call_gateway(
        group=group,
        messages=messages,
        schema=schema,
        temperature=temperature,
        max_tokens=max_tokens,
        json_mode=json_mode,
        run_id=run_id,
        agent_name=agent_name,
    )
    if res.content:
        return res.content.strip()
    return None
