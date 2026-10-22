import time
from typing import List
from pydantic import BaseModel, Field

from packages.llm_gateway import LLMClient
from engine.agents.llm_resilient import call_resilient_llm, get_default_gateway

# Sample test Pydantic schema
class ResearchTopicSchema(BaseModel):
    title: str
    relevance_score: float
    key_entities: List[str] = Field(default_factory=list)


def test_gateway_small_group():
    print("\n--- Test 1: Small Model Group (Llama 3.1 8B via Groq) ---")
    gateway = get_default_gateway()
    res = gateway.complete(
        group="small",
        messages=[
            {"role": "system", "content": "You are a concise AI research assistant. Respond in 1 brief sentence."},
            {"role": "user", "content": "What is solid-state battery technology?"}
        ],
        temperature=0.1,
        max_tokens=60
    )
    print(f"Model used: {res.model}")
    print(f"Content: {res.content}")
    print(f"Tokens in/out: {res.usage.input_tokens}/{res.usage.output_tokens} (Total: {res.usage.total_tokens})")
    print(f"Latency: {res.latency_ms} ms")
    assert res.content and len(res.content) > 10, "Failed to get content from small group"
    assert res.usage.total_tokens > 0, "Token count was zero"
    print("✓ Test 1 Passed!")


def test_gateway_structured_pydantic():
    print("\n--- Test 2: Structured Pydantic Output Validation ---")
    gateway = get_default_gateway()
    res = gateway.complete(
        group="small",
        messages=[
            {"role": "system", "content": "You are a JSON research extractor. Extract key entities and relevance score (0.0 to 1.0). Return ONLY JSON matching schema."},
            {"role": "user", "content": "Analyze quantum computing for cryptography."}
        ],
        schema=ResearchTopicSchema,
        temperature=0.1,
        max_tokens=150
    )
    print(f"Raw Content: {res.content}")
    print(f"Parsed Object: {res.parsed}")
    assert res.parsed is not None, "Failed to parse into Pydantic schema"
    assert isinstance(res.parsed, ResearchTopicSchema), f"Expected ResearchTopicSchema, got {type(res.parsed)}"
    assert res.parsed.title, "Title field is empty"
    print("✓ Test 2 Passed!")


def test_gateway_deterministic_cache():
    print("\n--- Test 3: Deterministic Response Caching (temperature=0.0) ---")
    gateway = get_default_gateway()
    messages = [
        {"role": "system", "content": "You are a calculator. Return ONLY the number."},
        {"role": "user", "content": "What is 432 * 19?"}
    ]
    # First call -> cache miss
    t0 = time.time()
    res1 = gateway.complete(group="small", messages=messages, temperature=0.0, max_tokens=10)
    dur1 = (time.time() - t0) * 1000.0
    print(f"Call 1 (Cache hit: {res1.cache_hit}): '{res1.content}' in {round(dur1, 1)}ms")

    # Second call -> cache hit
    t1 = time.time()
    res2 = gateway.complete(group="small", messages=messages, temperature=0.0, max_tokens=10)
    dur2 = (time.time() - t1) * 1000.0
    print(f"Call 2 (Cache hit: {res2.cache_hit}): '{res2.content}' in {round(dur2, 1)}ms")

    assert res2.cache_hit is True, "Second call should be a cache hit"
    assert res1.content == res2.content, "Cached content differs from original"
    print("✓ Test 3 Passed!")


def test_gateway_failover_resilience():
    print("\n--- Test 4: Automatic Primary -> Fallback Failover ---")
    # Custom client with an intentionally non-existent primary model
    test_groups = {
        "broken_group": {
            "primary": "groq/this-model-does-not-exist-xyz123",
            "fallback": "groq/qwen/qwen3.8-27b"
        }
    }
    client = LLMClient(model_groups=test_groups)
    res = client.complete(
        group="broken_group",
        messages=[{"role": "user", "content": "Say 'hello from fallback' in 3 words."}],
        temperature=0.1,
        max_tokens=20
    )
    print(f"Model selected: {res.model}")
    print(f"Degraded flag: {res.degraded}")
    print(f"Response: {res.content}")
    assert res.degraded is True, "Result should be marked degraded when fallback is engaged"
    assert "groq/qwen/qwen3.8-27b" in res.model, "Should have used the fallback model"
    assert res.content, "Should have returned content from fallback model"
    print("✓ Test 4 Passed!")


def test_backward_compatibility_facade():
    print("\n--- Test 5: Legacy call_resilient_llm() Facade ---")
    # 5a. Text mode
    output_text = call_resilient_llm(
        system_prompt="You are a concise ping-pong agent.",
        user_prompt="Say 'pong'",
        temperature=0.1,
        max_tokens=10,
        json_mode=False
    )
    print(f"Facade text output: '{output_text}'")
    assert output_text and "pong" in output_text.lower(), "Facade failed to return text response"

    # 5b. JSON mode
    output_json = call_resilient_llm(
        system_prompt="You are a JSON assistant. Output valid JSON.",
        user_prompt='Return a JSON object: {"status": "ok", "ping": "pong"}',
        temperature=0.1,
        max_tokens=30,
        json_mode=True
    )
    print(f"Facade JSON output: '{output_json}'")
    assert output_json and "pong" in output_json.lower(), "Facade failed to return JSON response"
    print("✓ Test 5 Passed!")


if __name__ == "__main__":
    print("=== Running Phase 1 LiteLLM Gateway Test Suite ===")
    test_gateway_small_group()
    test_gateway_structured_pydantic()
    test_gateway_deterministic_cache()
    test_gateway_failover_resilience()
    test_backward_compatibility_facade()
    print("\n🎉 ALL 5 PHASE 1 TESTS PASSED SUCCESSFULLY!")
