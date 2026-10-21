import asyncio
import os
import sys
import uuid
import httpx
from engine.server import app
from engine.storage.relational_store import RelationalStore

def test_end_to_end_flow():
    asyncio.run(_test_end_to_end_flow())


async def _test_end_to_end_flow():
    print("=== Testing End-to-End Pipeline & Report API ===")

    test_run_id = f"test_e2e_{uuid.uuid4().hex[:6]}"

    from engine.auth import create_access_token
    from engine.database import SessionLocal
    from engine.models import User
    test_user_id = str(uuid.uuid4())
    test_email = f"{test_user_id}@example.test"
    test_username = f"e2e_{test_user_id[:12]}"
    db = SessionLocal()
    try:
        db.add(User(
            id=test_user_id,
            email=test_email,
            username=test_username,
            password_hash="test-only",
        ))
        db.commit()
    finally:
        db.close()
    token = create_access_token(test_user_id, test_email, test_username)

    # 1. Simulate saving full run dossier into PostgreSQL
    print(f"1. Seeding test run in PostgreSQL: {test_run_id}")
    run = RelationalStore.create_run(
        run_id=test_run_id,
        question="What are the commercial silicon recycling yields and economics in 2025?",
        settings={"depth": "standard", "include_vault": True},
        user_id=test_user_id,
    )
    assert run is not None
    assert run.id == test_run_id
    print("   [OK] Run created in DB")

    # 2. Add Sources & Evidence
    sources_data = [
        {
            "tag": "S1",
            "url": "https://nature.com/articles/silicon-yields-2025",
            "title": "Commercial Silicon Recovery Yields in Photovoltaics",
            "domain": "nature.com",
            "authority_tier": 5,
            "kind": "web",
            "evidence": [
                {
                    "quote": "Chemical recycling facilities demonstrated 95.4% recovery purity for silicon wafers.",
                    "claim": "Silicon recovery yields reach 95% commercially",
                    "relevance": 0.94,
                    "final_score": 0.92
                }
            ]
        },
        {
            "tag": "D1",
            "title": "Internal_PV_Benchmarking.pdf",
            "domain": "vault",
            "authority_tier": 4,
            "kind": "doc",
            "evidence": [
                {
                    "quote": "Pilot line capex amortizes at $0.08 per watt over 7 years.",
                    "claim": "Capex amortizes at $0.08 per watt",
                    "relevance": 0.88,
                    "final_score": 0.86
                }
            ]
        }
    ]
    saved_sources = RelationalStore.save_sources_and_evidence(test_run_id, sources_data)
    assert len(saved_sources) == 2
    print(f"   [OK] {len(saved_sources)} Sources and evidence persisted")

    # 3. Add Critic Findings
    findings_data = {
        "contradictions": [
            {
                "topic": "Capex Amortization",
                "claim_a": "European plants amortize at $0.08/W",
                "claim_b": "Asian plants amortize at $0.05/W",
                "source_a": "S1",
                "source_b": "D1",
                "resolution": "Variance driven by electricity tariffs and automated disassembly lines."
            }
        ],
        "identified_gaps": ["End-of-life collection mandates in LATAM"]
    }
    saved_findings = RelationalStore.save_critic_findings(test_run_id, findings_data)
    assert len(saved_findings) == 2
    print(f"   [OK] {len(saved_findings)} Critic findings persisted")

    # 4. Save Report & Claims
    report_markdown = """# Commercial Silicon Recycling Economics

## Executive Summary
Silicon recovery has achieved commercial viabilities with yields surpassing 95% in automated plants [S1]. Pilot line capex amortizes at $0.08 per watt [D1].

## Unit Economics & Capex
| Metric | North America | China | Units | Citation |
| :--- | :--- | :--- | :--- | :--- |
| Silicon Purity | 95.4% | 94.8% | % | [S1] |
| Amortized Capex | 0.08 | 0.05 | $/Watt | [D1] |

## Conclusion
Dual retrieval validates high recovery margins across commercial installations.
"""
    saved_report = RelationalStore.save_report_and_claims(
        run_id=test_run_id,
        markdown=report_markdown,
        guard_results={"rejected_claims": []}
    )
    assert saved_report is not None
    print("   [OK] Report and verified claims persisted")

    # 5. Save Scores
    saved_scores = RelationalStore.save_scores(
        run_id=test_run_id,
        faithfulness=0.96,
        relevancy=0.92,
        authority=0.88,
        coverage=0.90
    )
    assert saved_scores is not None
    print("   [OK] Verification scores persisted")

    # 6. Test HTTP Endpoint via ASGI Transport
    print("6. Testing FastAPI /api/v1/runs/{id}/report and /api/v1/runs/{id}")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # Get run details
        auth_headers = {"Authorization": f"Bearer {token}"}
        res_run = await client.get(f"/api/v1/runs/{test_run_id}", headers=auth_headers)
        assert res_run.status_code == 200, f"Expected 200, got {res_run.status_code}"
        run_data = res_run.json()
        assert run_data["run_id"] == test_run_id
        assert len(run_data["sources"]) == 2
        assert len(run_data["findings"]) == 2
        print("   [OK] GET /api/v1/runs/{id} returned full dossier")

        # Get report
        res_rep = await client.get(f"/api/v1/runs/{test_run_id}/report", headers=auth_headers)
        assert res_rep.status_code == 200
        rep_data = res_rep.json()
        assert "Commercial Silicon Recycling" in (rep_data.get("report_markdown") or "")
        assert rep_data["scores"]["faithfulness"] == 0.96
        print("   [OK] GET /api/v1/runs/{id}/report returned verified report & scores")

    print("\nALL PHASE 6 END-TO-END TESTS PASSED!")

if __name__ == "__main__":
    test_end_to_end_flow()
