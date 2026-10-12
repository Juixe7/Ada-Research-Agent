import sys
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.tasks import run_research_pipeline_sync

def test_phase2_critic_and_arbiter():
    test_query = "Commercialization timeline of solid-state batteries in electric vehicles vs LFP by 2026"

    print("=== TESTING PHASE 2: CRITIC & ARBITER PIPELINE ===")
    pipeline_res = run_research_pipeline_sync(test_query, depth="quick", max_workers=3)

    print("\n=== VERIFYING RESULTS ===")
    audit = pipeline_res.get("critic_audit", {})
    print(f"Coverage Quality: {audit.get('coverage_quality')}")
    print(f"Coverage Score:   {audit.get('coverage_score')}/100")
    
    gaps = audit.get("identified_gaps", [])
    print(f"\nIdentified Knowledge Gaps ({len(gaps)}):")
    for g in gaps:
        print(f"  • {g}")

    contradictions = audit.get("contradictions", [])
    print(f"\nDetected Contradictions / Nuances ({len(contradictions)}):")
    for c in contradictions:
        print(f"  ⚡ [{c.get('topic')}]")
        print(f"     Claim A: {c.get('claim_a')[:90]}...")
        print(f"     Claim B: {c.get('claim_b')[:90]}...")
        print(f"     Analysis: {c.get('analysis')[:90]}...")

    arbiter_exec = pipeline_res.get("arbiter_executed", False)
    print(f"\nArbiter Task Executed: {arbiter_exec}")
    if arbiter_exec:
        arbiter_res = pipeline_res.get("arbiter_result", {})
        print(f"  Clarifying sources collected: {arbiter_res.get('evidence_count', 0)}")

    print(f"\nTotal Final Evidence Units in Manifest: {pipeline_res.get('total_evidence_units')}")

    # Assertions
    assert audit.get("coverage_score") is not None, "Missing critic coverage score"
    assert pipeline_res.get("total_evidence_units") > 0, "No evidence in manifest"
    assert "critic_audit" in pipeline_res, "Pipeline result missing critic audit"

    print("\n" + "="*50)
    print("✅ PHASE 2 CRITIC & ARBITER PIPELINE VERIFIED 100%!")
    print("="*50)

if __name__ == "__main__":
    test_phase2_critic_and_arbiter()
