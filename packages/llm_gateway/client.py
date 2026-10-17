import time
import json
import re
import os
import threading
from typing import Optional, Dict, Any, List, Type
from pydantic import BaseModel, ValidationError

import litellm
from packages.llm_gateway.models import LLMResult, TokenUsage, ModelGroup
from packages.llm_gateway.limiter import TokenBucketLimiter
from packages.llm_gateway.cache import ResponseCache
from packages.llm_gateway.tracing import trace_id_for_run

# Silence litellm telemetry and ensure unsupported params are safely ignored per provider
litellm.drop_params = True
litellm.telemetry = False

_langfuse_setup_lock = threading.Lock()
_langfuse_configured = False


def _configure_langfuse() -> None:
    """Enable LiteLLM's Langfuse callback only when explicitly configured."""
    global _langfuse_configured
    if os.getenv("LANGFUSE_ENABLED", "false").strip().lower() not in {"1", "true", "yes", "on"}:
        return
    with _langfuse_setup_lock:
        if _langfuse_configured:
            return
        required = ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
        missing = [name for name in required if not os.getenv(name, "").strip()]
        if missing:
            print("[langfuse] Enabled but credentials are missing; tracing is disabled.")
            return
        callbacks = list(getattr(litellm, "callbacks", None) or [])
        if "langfuse_otel" not in callbacks:
            callbacks.append("langfuse_otel")
        litellm.callbacks = callbacks
        _langfuse_configured = True
        print("[langfuse] LiteLLM tracing enabled.")

# Default Model Groups (Verified Groq & Gemini endpoints)
DEFAULT_MODEL_GROUPS = {
    "small": {
        "primary": "groq/qwen/qwen3.8-27b",
        "fallback": "gemini/gemini-flash-latest",
    },
    "large": {
        "primary": "groq/openai/gpt-oss-120b",
        "fallback": "gemini/gemini-flash-latest",
    },
    "write": {
        "primary": "gemini/gemini-flash-latest",
        "fallback": "groq/openai/gpt-oss-120b",
    },
    "judge": {
        "primary": "groq/qwen/qwen3.8-27b",
        "fallback": "gemini/gemini-flash-latest",
    }
}


class LLMClient:
    """
    Unified LLM Gateway client with model groups, automated failover,
    token-bucket rate limiting, 24h deterministic response caching,
    and structured Pydantic validation with 1-shot auto-repair.
    """
    def __init__(
        self,
        model_groups: Optional[Dict[str, Dict[str, str]]] = None,
        limiter: Optional[TokenBucketLimiter] = None,
        cache: Optional[ResponseCache] = None,
    ):
        self.groups = model_groups or DEFAULT_MODEL_GROUPS
        self.limiter = limiter or TokenBucketLimiter()
        self.cache = cache or ResponseCache()
        _configure_langfuse()

    def complete(
        self,
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
        group_config = self.groups.get(group) or self.groups.get("small") or next(iter(self.groups.values()))
        primary_model = group_config["primary"]
        fallback_model = group_config.get("fallback")

        # 1. Deterministic Response Cache Check (temperature <= 0.05)
        cached_content = self.cache.get(
            model=primary_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=json_mode
        )
        if cached_content:
            parsed = self._try_parse(cached_content, schema)
            return LLMResult(
                content=cached_content,
                parsed=parsed,
                model=primary_model,
                group=group,
                cache_hit=True,
                usage=TokenUsage()
            )

        # 2. Attempt Execution on Primary Model
        t0 = time.time()
        primary_res = self._execute_model_call(
            model=primary_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=json_mode or (schema is not None),
            timeout=timeout,
            run_id=run_id,
            agent_name=agent_name,
            group=group,
        )

        if primary_res["success"]:
            latency = (time.time() - t0) * 1000.0
            content = primary_res["content"]
            parsed = self._validate_and_repair(
                content=content,
                schema=schema,
                model=primary_model,
                temperature=temperature,
                timeout=timeout,
                run_id=run_id,
                agent_name=agent_name,
                group=group,
            )
            self.cache.set(
                model=primary_model,
                messages=messages,
                temperature=temperature,
                response=content,
                max_tokens=max_tokens,
                json_mode=json_mode
            )
            return LLMResult(
                content=content,
                parsed=parsed,
                model=primary_model,
                group=group,
                usage=primary_res["usage"],
                latency_ms=round(latency, 2),
                cost_estimate=primary_res["cost"],
                degraded=False
            )

        # 3. Primary Failed -> Engage Fallback Model
        err_msg = primary_res["error"]
        print(f"[llm_gateway] Primary model '{primary_model}' for group '{group}' failed: {err_msg[:120]}. Engaging fallback...")

        if not fallback_model:
            return LLMResult(
                content="",
                model=primary_model,
                group=group,
                degraded=True,
                error=err_msg
            )

        fallback_res = self._execute_model_call(
            model=fallback_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=json_mode or (schema is not None),
            timeout=timeout,
            run_id=run_id,
            agent_name=agent_name,
            group=group,
        )

        latency = (time.time() - t0) * 1000.0
        if fallback_res["success"]:
            content = fallback_res["content"]
            parsed = self._validate_and_repair(
                content=content,
                schema=schema,
                model=fallback_model,
                temperature=temperature,
                timeout=timeout,
                run_id=run_id,
                agent_name=agent_name,
                group=group,
            )
            return LLMResult(
                content=content,
                parsed=parsed,
                model=fallback_model,
                group=group,
                usage=fallback_res["usage"],
                latency_ms=round(latency, 2),
                cost_estimate=fallback_res["cost"],
                degraded=True
            )

        # Both Failed
        return LLMResult(
            content="",
            model=fallback_model,
            group=group,
            degraded=True,
            error=f"Primary ({err_msg}) | Fallback ({fallback_res['error']})"
        )

    def _execute_model_call(
        self,
        model: str,
        messages: List[Dict[str, str]],
        temperature: float,
        max_tokens: int,
        json_mode: bool,
        timeout: float,
        run_id: Optional[str] = None,
        agent_name: Optional[str] = None,
        group: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Executes a single provider completion with rate-limiting and backoff."""
        # Check rate limiter
        self.limiter.acquire(model, estimated_tokens=max_tokens)

        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "timeout": timeout,
        }
        if run_id and os.getenv("LANGFUSE_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}:
            agent = agent_name or str(group or "research")
            kwargs["metadata"] = {
                "trace_id": trace_id_for_run(str(run_id)),
                "session_id": str(run_id),
                "generation_name": f"ada.{agent}",
                "tags": ["ada", f"agent:{agent}", f"group:{group or 'unknown'}"],
            }
        if json_mode:
            has_json = any("json" in m.get("content", "").lower() for m in messages)
            if not has_json and "groq" in model.lower():
                # Groq strictly requires the word 'json' in prompt when json_object is set
                messages = list(messages)
                last_m = messages[-1]
                messages[-1] = {
                    "role": last_m["role"],
                    "content": last_m["content"] + "\nReturn response in valid JSON format."
                }
                kwargs["messages"] = messages
            kwargs["response_format"] = {"type": "json_object"}

        for attempt in range(2):
            try:
                resp = litellm.completion(**kwargs)
                content = resp.choices[0].message.content or ""
                usage_raw = getattr(resp, "usage", None)
                in_tok = usage_raw.prompt_tokens if usage_raw else 0
                out_tok = usage_raw.completion_tokens if usage_raw else 0

                # Estimate cost via LiteLLM if available
                cost = 0.0
                try:
                    cost = litellm.completion_cost(completion_response=resp)
                except Exception:
                    pass

                return {
                    "success": True,
                    "content": content.strip(),
                    "usage": TokenUsage(input_tokens=in_tok, output_tokens=out_tok, total_tokens=in_tok + out_tok),
                    "cost": round(cost, 6),
                    "error": None
                }
            except Exception as e:
                err_str = str(e)
                if ("429" in err_str or "rate" in err_str.lower() or "quota" in err_str.lower()) and attempt == 0:
                    self.limiter.record_429(model, retry_after=3.0)
                    time.sleep(2.0)
                    continue
                return {
                    "success": False,
                    "content": "",
                    "usage": TokenUsage(),
                    "cost": 0.0,
                    "error": err_str
                }

        return {"success": False, "content": "", "usage": TokenUsage(), "cost": 0.0, "error": "Max retries exceeded"}

    def _try_parse(self, content: str, schema: Optional[Type[BaseModel]]) -> Optional[Any]:
        """Attempts to extract JSON and validate against schema."""
        if not schema or not content:
            return None
        try:
            json_match = re.search(r'(\{.*\}|\[.*\])', content, re.DOTALL)
            raw = json_match.group(0) if json_match else content
            data = json.loads(raw)
            if hasattr(schema, "model_validate"):
                return schema.model_validate(data)
            return data
        except Exception:
            return None

    def _validate_and_repair(
        self,
        content: str,
        schema: Optional[Type[BaseModel]],
        model: str,
        temperature: float,
        timeout: float,
        run_id: Optional[str] = None,
        agent_name: Optional[str] = None,
        group: Optional[str] = None,
    ) -> Optional[Any]:
        """Validates structured output with 1-shot repair if validation fails."""
        if not schema or not content:
            return None

        # 1. First attempt: direct parsing
        parsed = self._try_parse(content, schema)
        if parsed is not None:
            return parsed

        # 2. Automated repair attempt
        schema_json = ""
        try:
            schema_json = json.dumps(schema.model_json_schema(), indent=2)
        except Exception:
            pass

        repair_messages = [
            {"role": "system", "content": "You are a JSON repair specialist. Output ONLY the corrected, valid JSON object matching the requested schema. No markdown, no prose."},
            {"role": "user", "content": f"The following response failed JSON schema validation:\n\n{content}\n\nRequired Schema:\n{schema_json}\n\nProvide the corrected JSON:"}
        ]

        repair_call = self._execute_model_call(
            model=model,
            messages=repair_messages,
            temperature=temperature,
            max_tokens=2048,
            json_mode=True,
            timeout=timeout,
            run_id=run_id,
            agent_name=agent_name,
            group=group,
        )
        if repair_call["success"]:
            repaired_parsed = self._try_parse(repair_call["content"], schema)
            if repaired_parsed is not None:
                return repaired_parsed

        return None
