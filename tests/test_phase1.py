import sys
from pathlib import Path
import pytest

# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.agents.planner import generate_research_plan
from engine.workers.research_worker import execute_sub_research
from engine.tasks import run_research_pipeline_sync

@pytest.mark.integration
def test_phase1_parallel_pipeline():
    test_query = "Commercial viability of sodium ion batteries in electric vehicles by 2026"

    print("=== 1. TESTING LEAD PLANNER ===")
    plan = generate_research_plan(test_query, depth="quick")
    print(f"Plan generated with {len(plan)} tracks:")
    for track in plan:
        print(f"  [Track {track.get('id')}] ({track.get('category')}): {track.get('sub_question')}")
        print(f"    Queries: {track.get('search_queries')}")
    assert len(plan) >= 2, "Planner failed to generate sufficient sub-tracks"

    print("\n=== 2. TESTING SINGLE RESEARCH WORKER ===")
    single_track = plan[0]
    worker_res = execute_sub_research(single_track, include_user_docs=True, max_pages_to_scrape=1)
    print(f"Worker finished track {worker_res['sub_task_id']} in {worker_res['duration_seconds']}s")
    print(f"Collected {worker_res['evidence_count']} evidence items.")
    for ev in worker_res["evidence"][:2]:
        print(f"  - Source: {ev.get('title')} ({ev.get('source_type')}) [Authority: {ev.get('authority_score')}]")
    assert worker_res["evidence_count"] > 0, "Research worker returned 0 evidence items"

    print("\n=== 3. TESTING FULL CONCURRENT RESEARCH FAN-OUT ===")
    pipeline_res = run_research_pipeline_sync(test_query, depth="quick")
    print("\nPipeline completed:")
    print(f"  Sub-tasks completed: {pipeline_res['sub_tasks_count']}")
    print(f"  Total distinct evidence units: {pipeline_res['total_evidence_units']}")
    assert pipeline_res["total_evidence_units"] >= 3, "Pipeline gathered insufficient evidence"

    print("\n" + "="*50)
    print("✅ PHASE 1 DISTRIBUTED SEARCH PIPELINE VERIFIED 100%!")
    print("="*50)

if __name__ == "__main__":
    test_phase1_parallel_pipeline()
