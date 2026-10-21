import uuid
from engine.database import init_db, SessionLocal
from engine.models import Run, Track, Source, Evidence, Finding, Report, Claim, Score, Event, LLMCall
from engine.storage.relational_store import RelationalStore


def test_schema_initialization():
    print("\n--- Test 1: Initialize Database Tables ---")
    init_db()
    db = SessionLocal()
    try:
        # Verify query against all tables doesn't fail
        assert db.query(Run).count() >= 0
        assert db.query(Track).count() >= 0
        assert db.query(Source).count() >= 0
        assert db.query(Evidence).count() >= 0
        assert db.query(Finding).count() >= 0
        assert db.query(Report).count() >= 0
        assert db.query(Claim).count() >= 0
        assert db.query(Score).count() >= 0
        assert db.query(LLMCall).count() >= 0
        assert db.query(Event).count() >= 0
        print("✓ All 10 Blueprint Section 10 tables initialized successfully!")
    finally:
        db.close()


def test_full_run_relational_lifecycle():
    print("\n--- Test 2: Complete Relational Run Lifecycle Persistence ---")
    test_run_id = f"test_run_{uuid.uuid4().hex[:8]}"
    question = "What are the commercial trade-offs of solid-state vs LFP battery cells?"

    # 1. Create Run
    run = RelationalStore.create_run(
        question=question,
        settings={"depth": "deep", "include_user_docs": True},
        run_id=test_run_id,
        brief={"objective": "Comparative benchmark of solid-state and LFP"}
    )
    assert run.id == test_run_id
    print(f"Created Run: {run.id}")

    # 2. Save Tracks
    tracks_data = [
        {"sub_question": "Cell-level energy density benchmarks", "search_queries": ["solid-state Wh/kg", "LFP Wh/kg"]},
        {"sub_question": "Manufacturing yield bottlenecks", "search_queries": ["roll to roll separator yield"]}
    ]
    tracks = RelationalStore.save_tracks(test_run_id, tracks_data)
    assert len(tracks) == 2
    print(f"Saved {len(tracks)} research tracks.")

    # 3. Save Sources & Evidence
    evidence_manifest = [
        {
            "source_id": "S1",
            "source_type": "web",
            "title": "Battery Technology Benchmark 2026",
            "url": "https://nature.com/articles/battery-sota",
            "domain": "nature.com",
            "authority_score": 0.95,
            "text": "Solid-state pouch cells achieved 400 Wh/kg in laboratory testing compared to 180 Wh/kg for LFP."
        },
        {
            "source_id": "D1",
            "source_type": "user_doc",
            "doc_name": "internal_cell_specs.pdf",
            "page_number": 4,
            "authority_score": 1.0,
            "text": "Internal tests recorded LFP commercial pack cost benchmark at $55 per kWh."
        }
    ]
    tag_map = RelationalStore.save_sources_and_evidence(test_run_id, evidence_manifest)
    assert "S1" in tag_map and "D1" in tag_map
    print(f"Saved sources and mapped tags: {tag_map}")

    # 4. Save Critic Findings
    critic_audit = {
        "contradictions": [
            {
                "topic": "Energy Density Scaling",
                "claim_a": "Lab cells reach 400 Wh/kg [S1]",
                "claim_b": "Pack-level efficiency drops to 280 Wh/kg [D1]",
                "analysis": "Difference between laboratory pouch cells and automotive pack packaging.",
                "source_a": "S1",
                "source_b": "D1"
            }
        ],
        "identified_gaps": ["Separator yield rates at gigafactory volume."],
        "arbiter_queries": ["gigafactory separator roll-to-roll yield percentage"]
    }
    findings = RelationalStore.save_critic_findings(test_run_id, critic_audit)
    assert len(findings) == 2
    print(f"Saved {len(findings)} critic findings.")

    # 5. Save Report & Claim Verifications
    report_markdown = """# Battery Architecture Dossier

Solid-state cells achieve 400 Wh/kg in experimental configurations [S1].
Meanwhile, commercial LFP packs maintain an undisputed cost advantage of $55/kWh [D1].
Some unverified reports claim $10/kWh cost [S99].
"""
    guard_results = {
        "rejected_claims": ["Some unverified reports claim $10/kWh cost [S99]."],
        "citation_index": {"S1": {}, "D1": {}}
    }
    report = RelationalStore.save_report_and_claims(test_run_id, report_markdown, guard_results=guard_results)
    assert report.id
    print(f"Saved Report: {report.id}")

    # 6. Save Scores
    score = RelationalStore.save_scores(test_run_id, faithfulness=0.92, relevancy=0.88, authority=0.95)
    assert score.faithfulness == 0.92
    print(f"Saved Evaluation Scores: Faithfulness={score.faithfulness}")

    # 7. Record LLM Call Audit
    call = RelationalStore.record_llm_call(
        run_id=test_run_id,
        agent="synthesizer",
        model="gemini/gemini-flash-latest",
        tokens_in=2400,
        tokens_out=650,
        latency_ms=1840.5,
        cost=0.00035,
        cache_hit=False
    )
    assert call and call.tokens_in == 2400
    print(f"Recorded LLM call: {call.tokens_in} in, {call.tokens_out} out")

    # 8. Record Stream Events
    ev1 = RelationalStore.record_event(test_run_id, "run.status", {"status": "researching"})
    ev2 = RelationalStore.record_event(test_run_id, "track.completed", {"track": 1, "sources": 2})
    assert ev2.seq == 2
    print(f"Recorded 2 stream events with sequential sequence IDs: {ev1.seq}, {ev2.seq}")

    # 9. Query Complete Dossier Entity
    dossier = RelationalStore.get_full_run_dossier(test_run_id)
    assert dossier is not None
    assert dossier["run_id"] == test_run_id
    assert dossier["sources_count"] == 2
    assert len(dossier["findings"]) == 2
    assert len(dossier["claims"]) == 3
    # Check claim verdicts
    unverified_claims = [c for c in dossier["claims"] if c["verdict"] == "unverified"]
    flagged_claims = [c for c in dossier["claims"] if c["verdict"] == "flagged"]
    assert len(unverified_claims) == 2
    assert len(flagged_claims) == 1
    print(f"Verified full dossier query: {dossier['sources_count']} sources, {len(unverified_claims)} unverified claims, {len(flagged_claims)} guard-rejected claims.")
    print("✓ Test 2 Passed!")


if __name__ == "__main__":
    print("=== Running Phase 2 Relational Database Test Suite ===")
    test_schema_initialization()
    test_full_run_relational_lifecycle()
    print("\n🎉 ALL PHASE 2 DATABASE TESTS PASSED SUCCESSFULLY!")
