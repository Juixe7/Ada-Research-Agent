import sys
from pathlib import Path
import pytest

# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.ingest.doc_processor import process_raw_text_document
from engine.storage.vector_store import get_vector_store
from engine.tasks import run_research_pipeline_sync

@pytest.mark.integration
def test_phase3_full_deep_research():
    print("=== 1. PRE-SEEDING PRIVATE USER DOCUMENT (QDRANT) ===")
    private_doc = """
    Internal Memorandum: Humanoid Robotics Deployment Benchmark 2026
    Confidential Internal Strategy Review.
    Pilot production of Model-H humanoid units began in Q1 with unit bill-of-materials (BOM) cost at $38,500.
    In automotive assembly testing, cycle time for dexterous wiring harness installation was 42 seconds compared to 28 seconds for human operators.
    Key engineering bottleneck: actuator thermal throttling after 45 minutes of continuous high-payload manipulation.
    Target commercial rollout: 500 units deployed across Tier-1 logistics hubs by Q4 2026.
    """
    test_user_id = "test-phase3-user"
    chunks = process_raw_text_document(private_doc, doc_name="Model_H_Internal_Pilot.pdf")
    for chunk in chunks:
        chunk["user_id"] = test_user_id
    vs = get_vector_store()
    vs.index_document_chunks(chunks)
    print(f"Pre-seeded {len(chunks)} private document chunks into Qdrant.")

    test_query = "Commercial deployment roadmap and manufacturing bottlenecks of humanoid robots in logistics by 2026"

    print("\n=== 2. RUNNING FULL END-TO-END DEEP RESEARCH PIPELINE ===")
    result = run_research_pipeline_sync(
        query=test_query,
        depth="quick",
        include_user_docs=True,
        user_id=test_user_id,
    )

    print("\n" + "="*60)
    print("=== 3. VERIFYING PHASE 3 OUTPUTS & CITATION GUARD ===")
    print("="*60)

    report_id = result.get("report_id")
    markdown = result.get("report_markdown", "")
    guard = result.get("guard_results", {})
    export_paths = result.get("export_paths", {})

    print(f"Report ID: {report_id}")
    print(f"Report Length: {len(markdown)} characters (~{len(markdown.split())} words)")
    print(f"Faithfulness Score: {round(guard.get('faithfulness_score', 0)*100, 1)}%")
    print(f"Unique Valid Sources Cited: {guard.get('unique_valid_sources_cited')}")
    print(f"Hallucinated Sources: {guard.get('hallucinated_sources_count')}")

    print("\nExported Artifact Paths:")
    for k, p in export_paths.items():
        print(f"  - {k}: {p}")
        if k.endswith("_path"):
            assert Path(p).exists(), f"Export file missing: {p}"

    # Sample preview of the generated report
    print("\n--- REPORT PREVIEW (First 600 characters) ---")
    print(markdown[:600] + "\n...")

    # Assertions
    assert len(markdown) > 500, "Synthesizer produced empty or trivial report"
    assert guard.get("faithfulness_score") >= 0.85, "Faithfulness score below 85%"
    assert guard.get("unique_valid_sources_cited") > 0, "No valid citations were grounded"

    print("\n" + "="*60)
    print("✅ PHASE 3 CHIEF SYNTHESIZER & CITATION GUARD VERIFIED 100%!")
    print("="*60)

if __name__ == "__main__":
    test_phase3_full_deep_research()
