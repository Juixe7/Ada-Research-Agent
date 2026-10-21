"""Focused contracts for Ada's optional Langfuse run trace."""

from __future__ import annotations

import sys
import os
from contextlib import contextmanager
from types import ModuleType, SimpleNamespace
from typing import Any

from engine.observability import research_run_trace
from packages.llm_gateway.observability import llm_generation
from packages.llm_gateway.tracing import trace_id_for_run
from packages.llm_gateway import client as llm_client_module


def test_trace_id_is_stable_and_valid_for_langfuse() -> None:
    run_id = "run-123"

    first = trace_id_for_run(run_id)
    second = trace_id_for_run(run_id)

    assert first == second
    assert len(first) == 32
    assert all(character in "0123456789abcdef" for character in first)
    assert first != trace_id_for_run("another-run")


def test_disabled_tracing_does_not_load_or_call_langfuse(monkeypatch) -> None:
    monkeypatch.setenv("LANGFUSE_ENABLED", "false")

    with research_run_trace("run-123", "A safe test question") as span:
        assert span is None


def test_enabled_tracing_creates_run_parent_and_flushes(monkeypatch) -> None:
    run_id = "run-456"
    observations: list[dict[str, Any]] = []
    propagated: list[dict[str, Any]] = []
    flushes = 0

    class FakeSpan:
        def update(self, **kwargs: Any) -> None:
            observations[-1]["updates"] = kwargs

    class FakeClient:
        @contextmanager
        def start_as_current_observation(self, **kwargs: Any):
            observations.append(kwargs)
            yield FakeSpan()

        def flush(self) -> None:
            nonlocal flushes
            flushes += 1

    fake_langfuse = ModuleType("langfuse")
    fake_langfuse.get_client = lambda: FakeClient()  # type: ignore[attr-defined]

    @contextmanager
    def fake_propagate_attributes(**kwargs: Any):
        propagated.append(kwargs)
        yield

    fake_langfuse.propagate_attributes = fake_propagate_attributes  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langfuse", fake_langfuse)
    monkeypatch.setenv("LANGFUSE_ENABLED", "true")
    monkeypatch.delenv("LANGFUSE_BASE_URL", raising=False)
    monkeypatch.setenv("LANGFUSE_OTEL_HOST", "http://langfuse.test")

    with research_run_trace(run_id, "A safe test question") as span:
        assert span is not None
        span.update(output={"status": "completed"})

    assert propagated == [{"session_id": run_id, "tags": ["ada", "research-run"]}]
    assert observations == [{
        "as_type": "span",
        "name": "ada.research.run",
        "trace_context": {"trace_id": trace_id_for_run(run_id)},
        "input": {"query": "A safe test question"},
        "metadata": {"run_id": run_id, "service": "ada"},
        "updates": {"output": {"status": "completed"}},
    }]
    assert flushes == 1
    assert os.environ["LANGFUSE_BASE_URL"] == "http://langfuse.test"


def test_langfuse_initialization_failure_does_not_block_research(monkeypatch) -> None:
    class FailingClient:
        def start_as_current_observation(self, **kwargs: Any):
            raise RuntimeError("simulated Langfuse initialization failure")

        def flush(self) -> None:
            return None

    fake_langfuse = ModuleType("langfuse")
    fake_langfuse.get_client = lambda: FailingClient()  # type: ignore[attr-defined]

    @contextmanager
    def fake_propagate_attributes(**kwargs: Any):
        yield

    fake_langfuse.propagate_attributes = fake_propagate_attributes  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langfuse", fake_langfuse)
    monkeypatch.setenv("LANGFUSE_ENABLED", "true")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    with research_run_trace("run-failure", "A safe test question") as span:
        assert span is None


def test_llm_generation_records_model_usage(monkeypatch) -> None:
    recorded: list[dict[str, Any]] = []

    class FakeObservation:
        def update(self, **kwargs: Any) -> None:
            recorded[-1]["updates"] = kwargs

    class FakeClient:
        @contextmanager
        def start_as_current_observation(self, **kwargs: Any):
            recorded.append(kwargs)
            yield FakeObservation()

    fake_langfuse = ModuleType("langfuse")
    fake_langfuse.get_client = lambda: FakeClient()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langfuse", fake_langfuse)
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")
    monkeypatch.setenv("LANGFUSE_ENABLED", "true")

    with llm_generation(
        run_id="run-789",
        agent_name="planner",
        model="provider/model",
        messages=[{"role": "user", "content": "safe input"}],
        temperature=0.1,
        max_tokens=100,
    ) as observation:
        observation.update(output="safe output", usage_details={"input": 4, "output": 2, "total": 6})

    assert recorded == [{
        "as_type": "generation",
        "name": "ada.planner",
        "model": "provider/model",
        "model_parameters": {"temperature": 0.1, "max_tokens": 100},
        "input": [{"role": "user", "content": "safe input"}],
        "metadata": {"run_id": "run-789", "service": "ada"},
        "updates": {"output": "safe output", "usage_details": {"input": 4, "output": 2, "total": 6}},
    }]


def test_langfuse_update_error_does_not_fail_successful_provider_call(monkeypatch) -> None:
    @contextmanager
    def failing_observation(**kwargs: Any):
        class FailingSpan:
            def update(self, **attributes: Any) -> None:
                raise RuntimeError("simulated exporter error")

        yield FailingSpan()

    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="valid answer"))],
        usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2),
    )
    monkeypatch.setattr(llm_client_module, "llm_generation", failing_observation)
    monkeypatch.setattr(llm_client_module.litellm, "completion", lambda **kwargs: response)
    monkeypatch.setattr(llm_client_module.litellm, "completion_cost", lambda **kwargs: 0.0)

    client = llm_client_module.LLMClient()
    result = client._execute_model_call(
        model="provider/model",
        messages=[{"role": "user", "content": "safe input"}],
        temperature=0.1,
        max_tokens=10,
        json_mode=False,
        timeout=1,
        run_id="run-789",
        agent_name="planner",
        group="small",
    )

    assert result["success"] is True
    assert result["content"] == "valid answer"
