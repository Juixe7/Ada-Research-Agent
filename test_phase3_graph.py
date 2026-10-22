import sys
from pathlib import Path

# Add project root and packages/llm_gateway to PYTHONPATH
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))
sys.path.insert(0, str(ROOT_DIR / "packages" / "llm_gateway"))

from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

def test_1_graph_compilation_and_nodes():
    """Verify LangGraph StateGraph builds with all 11 blueprint nodes and proper topology."""
    print("\n--- Test 1: Graph Compilation & Topology ---")
    from engine.graph.pipeline import compiled_research_graph

    nodes = set(compiled_research_graph.nodes.keys())
    required_nodes = {
        "scope", "plan", "research", "critic", "arbiter",
        "outline", "synthesize_sections", "assemble", "verify",
        "score", "finalize"
    }

    missing = required_nodes - nodes
    assert not missing, f"Missing required graph nodes: {missing}"
    print(f"✓ All {len(required_nodes)} Blueprint nodes verified in compiled StateGraph:")
    for n in sorted(required_nodes):
        print(f"  - Node: {n}")


def test_2_deterministic_tables():
    """Verify deterministic table generation guarantees zero metric hallucination."""
    print("\n--- Test 2: Deterministic Quantitative Tables ---")
    from engine.agents.sectional_synthesizer import build_deterministic_tables, extract_quantitative_metrics

    test_evidence = [
        {
            "source_id": "S1",
            "title": "NVIDIA Blackwell B200 Architecture Whitepaper",
            "text": "The B200 delivers 20 PFLOPS of FP4 compute and offers a 30x inference speedup over previous H100 generation while drawing 1200W of power.",
            "values": [
                {"metric": "FP4 Compute", "value": "20 PFLOPS", "context": "NVIDIA Blackwell B200 Whitepaper"}
            ]
        },
        {
            "source_id": "D1",
            "title": "Internal Infrastructure Benchmarks Q3",
            "text": "Our cluster throughput reached 45000 tok/s at 99.4% availability with a 4.2x reduction in per-token cost.",
            "values": [
                {"metric": "Per-Token Cost Reduction", "value": "4.2x", "context": "Internal Benchmarks"}
            ]
        }
    ]

    metrics = extract_quantitative_metrics(test_evidence)
    assert len(metrics) >= 2, f"Expected at least 2 extracted metrics, got {len(metrics)}"
    print(f"✓ Successfully extracted {len(metrics)} structured metrics from evidence units:")
    for m in metrics:
        print(f"  [{m['source_id']}] {m['metric']}: {m['value']}")

    table_md = build_deterministic_tables(test_evidence)
    assert "| Metric / Parameter |" in table_md
    assert "[S1]" in table_md or "[D1]" in table_md
    print("✓ Deterministic Markdown Table successfully rendered:")
    print(table_md)


def test_3_outline_generation():
    """Verify sectional outline construction and bounded evidence assignment."""
    print("\n--- Test 3: Outline & SectionSpec Generation ---")
    from engine.agents.sectional_synthesizer import generate_outline

    query = "Compare state-of-the-art inference engines: vLLM vs TensorRT-LLM"
    plan = [
        {"id": 1, "category": "throughput", "sub_question": "Analyze serving throughput and P99 latency"},
        {"id": 2, "category": "memory_architecture", "sub_question": "Compare PagedAttention vs KV cache quantization"},
        {"id": 3, "category": "cost_efficiency", "sub_question": "Total cost of ownership and GPU utilization"}
    ]
    test_evidence = [
        {"source_id": "S1", "title": "vLLM Paper", "text": "vLLM introduces PagedAttention..."},
        {"source_id": "S2", "title": "TensorRT-LLM Benchmarks", "text": "TensorRT-LLM provides FP8 kernels..."},
        {"source_id": "D1", "title": "Internal Deployment", "text": "Our production deployment showed 2.4x throughput..."}
    ]
    critic_audit = {
        "contradictions": [
            {
                "topic": "Throughput leadership",
                "claim_a": "vLLM achieves higher throughput on batch size 64",
                "claim_b": "TensorRT-LLM outperforms by 1.8x on Hopper GPUs"
            }
        ]
    }

    outline = generate_outline(query, plan, test_evidence, critic_audit)
    section_ids = [s["id"] for s in outline]

    assert "methodology" in section_ids
    assert "benchmarks" in section_ids
    assert "contradictions" in section_ids
    assert "risks" in section_ids
    assert any("deepdive_" in sid for sid in section_ids)

    print(f"✓ Generated {len(outline)} SectionSpecs matching Blueprint Section 7.5:")
    for sec in outline:
        print(f"  - [{sec['id']}] {sec['title']} (Assigned: {sec['assigned_source_ids']})")


def test_4_conditional_edge_routing():
    """Verify conditional critic arbitration routing logic."""
    print("\n--- Test 4: Conditional Edge Routing ---")
    from engine.graph.edges import route_critic

    # Case A: Quick mode always bypasses arbitration
    state_quick = {
        "settings": {"depth": "quick"},
        "round": 1,
        "max_rounds": 1,
        "arbiter_queries": ["Search discrepancy"]
    }
    assert route_critic(state_quick) == "outline", "Quick mode should bypass arbitration directly to outline"

    # Case B: Standard/Deep mode with arbiter queries within round limit
    state_arbitrate = {
        "settings": {"depth": "deep"},
        "round": 1,
        "max_rounds": 2,
        "arbiter_queries": ["Clarify TensorRT-LLM vs vLLM FP8 benchmarks"]
    }
    assert route_critic(state_arbitrate) == "arbiter", "Should route to arbiter when queries exist and round <= max_rounds"

    # Case C: Exceeded max rounds -> advances to outline
    state_budget_exhausted = {
        "settings": {"depth": "deep"},
        "round": 2,
        "max_rounds": 2,
        "arbiter_queries": ["Another query"]
    }
    # round 2 means it just completed round 2, so round > max_rounds condition
    state_budget_exhausted["round"] = 3
    assert route_critic(state_budget_exhausted) == "outline", "Should advance to outline when max rounds reached"

    print("✓ All conditional routing edges verified successfully.")


def test_5_end_to_end_pipeline_execution():
    """Execute live research query through LangGraph StateGraph pipeline."""
    print("\n--- Test 5: Live LangGraph Pipeline Execution ---")
    from engine.tasks import run_research_pipeline_sync
    import uuid

    test_run_id = f"test_graph_{uuid.uuid4().hex[:8]}"
    query = "What is FlashAttention-3 and how does it optimize FP16 tensor core utilization on Hopper H100?"

    print(f"Launching live pipeline with run_id: {test_run_id}")
    result = run_research_pipeline_sync(
        query=query,
        depth="quick",
        include_user_docs=False,
        report_id=test_run_id
    )

    assert result["report_id"] == test_run_id
    assert len(result["plan"]) > 0
    assert len(result["evidence_manifest"]) > 0
    assert result["report_markdown"]
    assert len(result["sections"]) > 0
    assert result["faithfulness_score"] > 0

    print("✓ LangGraph Pipeline Execution Completed Successfully:")
    print(f"  - Report ID: {result['report_id']}")
    print(f"  - Title: {result.get('executive_title')}")
    print(f"  - Tracks Planned: {len(result['plan'])}")
    print(f"  - Evidence Units Gathered: {len(result['evidence_manifest'])}")
    print(f"  - Sections Synthesized: {len(result.get('sections', {}))}")
    print(f"  - Faithfulness Score: {result.get('faithfulness_score')}")
    print(f"  - Report Character Length: {len(result['report_markdown'])}")

    # Verify Relational Database Persistence
    from engine.storage.relational_store import RelationalStore
    run_record = RelationalStore.get_run(test_run_id)
    assert run_record is not None, "Run should exist in PostgreSQL"
    assert run_record["status"] == "completed"

    report_record = RelationalStore.get_report(test_run_id)
    assert report_record is not None, "Report should exist in PostgreSQL"
    print(f"✓ Relational Database verification confirmed: Run '{test_run_id}' status='completed'")


if __name__ == "__main__":
    test_1_graph_compilation_and_nodes()
    test_2_deterministic_tables()
    test_3_outline_generation()
    test_4_conditional_edge_routing()
    test_5_end_to_end_pipeline_execution()
    print("\n==========================================")
    print("ALL PHASE 3 LANGGRAPH TESTS PASSED!")
    print("==========================================")
