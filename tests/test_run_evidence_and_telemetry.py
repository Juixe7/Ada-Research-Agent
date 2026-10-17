from unittest.mock import patch

from engine.graph.nodes import normalize_and_deduplicate_evidence
from engine.agents.llm_resilient import call_gateway
from packages.llm_gateway.models import LLMResult, TokenUsage


def test_vault_chunks_from_same_page_are_not_deduplicated():
    passages = [
        {
            "source_type": "user_doc",
            "doc_name": "resume.pdf",
            "page_number": 1,
            "chunk_id": "chunk-projects",
            "text": "Projects: Ada research engine",
        },
        {
            "source_type": "user_doc",
            "doc_name": "resume.pdf",
            "page_number": 1,
            "chunk_id": "chunk-experience",
            "text": "Experience: Backend engineering",
        },
        {
            "source_type": "user_doc",
            "doc_name": "resume.pdf",
            "page_number": 1,
            "chunk_id": "chunk-projects",
            "text": "Projects: Ada research engine",
        },
    ]

    result = normalize_and_deduplicate_evidence(passages)

    assert len(result) == 2
    assert [item["source_id"] for item in result] == ["D1", "D2"]


def test_gateway_records_run_scoped_call_telemetry():
    fake_result = LLMResult(
        content="ok",
        model="test/model",
        group="small",
        usage=TokenUsage(input_tokens=12, output_tokens=5, total_tokens=17),
        latency_ms=42.5,
        cost_estimate=0.01,
    )

    class FakeGateway:
        def complete(self, **kwargs):
            return fake_result

    with patch("engine.agents.llm_resilient.get_default_gateway", return_value=FakeGateway()), patch(
        "engine.storage.relational_store.RelationalStore.record_llm_call"
    ) as record_call:
        result = call_gateway(
            group="small",
            messages=[{"role": "user", "content": "test"}],
            run_id="run-123",
            agent_name="planner",
        )

    assert result is fake_result
    record_call.assert_called_once()
    assert record_call.call_args.kwargs["run_id"] == "run-123"
    assert record_call.call_args.kwargs["agent"] == "planner"
    assert record_call.call_args.kwargs["tokens_in"] == 12
    assert record_call.call_args.kwargs["tokens_out"] == 5
