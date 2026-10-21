import os
import sys
import json
import uuid
import asyncio
import pytest
from pathlib import Path

# Add project root and packages to PYTHONPATH
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))
sys.path.insert(0, str(ROOT_DIR / "packages" / "llm_gateway"))

from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

def _seed_event_run():
    from engine.events import publish_event
    from engine.storage.relational_store import RelationalStore

    test_run_id = f"test_evt_{uuid.uuid4().hex[:8]}"

    # Initialize a test run record in DB
    RelationalStore.create_run(
        question="Testing SSE Event System",
        run_id=test_run_id,
        settings={"depth": "quick"}
    )

    # Publish 3 distinct events
    e1 = publish_event(test_run_id, "stage_changed", {"stage": "planning", "progress": 20})
    e2 = publish_event(test_run_id, "query_issued", {"track_id": 1, "queries": ["FlashAttention Hopper"]})
    e3 = publish_event(test_run_id, "source_discovered", {"source_id": "S1", "url": "https://arxiv.org/abs/2407.08608", "authority": 0.95})

    assert e1["seq"] == 1
    assert e2["seq"] == 2
    assert e3["seq"] == 3

    # Fetch stored events
    stored_events = RelationalStore.get_events(test_run_id)
    assert len(stored_events) == 3, f"Expected 3 stored events, got {len(stored_events)}"
    assert stored_events[0]["event"] == "stage_changed"
    assert stored_events[1]["event"] == "query_issued"
    assert stored_events[2]["event"] == "source_discovered"

    return test_run_id, e1["id"], e2["id"], e3["id"]


@pytest.fixture
def event_context():
    return _seed_event_run()


def test_1_event_publishing_and_persistence():
    """Verify event publishing persists typed events with monotonic sequence numbers."""
    print("\n--- Test 1: Event Publishing & Durable Persistence ---")
    test_run_id, _, _, _ = _seed_event_run()
    from engine.storage.relational_store import RelationalStore
    stored_events = RelationalStore.get_events(test_run_id)
    assert [event["seq"] for event in stored_events] == [1, 2, 3]
    assert [event["event"] for event in stored_events] == ["stage_changed", "query_issued", "source_discovered"]


def test_2_sse_reconnection_replay(event_context):
    """Verify that reconnecting with Last-Event-Id replays only missed subsequent events."""
    print("\n--- Test 2: SSE Reconnection Replay (Last-Event-Id) ---")
    from engine.storage.relational_store import RelationalStore
    test_run_id, e1_id, _, _ = event_context

    # Client reconnects having seen e1_id
    replayed = RelationalStore.get_events(test_run_id, after_id=e1_id)
    assert len(replayed) == 2, f"Expected 2 replayed events after e1, got {len(replayed)}"
    assert replayed[0]["event"] == "query_issued"
    assert replayed[1]["event"] == "source_discovered"

    print(f"✓ Replay successfully skipped e1 and returned {len(replayed)} subsequent events:")
    for ev in replayed:
        print(f"  [Replayed seq={ev['seq']}] event='{ev['event']}' id={ev['id']}")


def test_3_async_sse_generator(event_context):
    """Verify the async SSE generator yields ServerSentEvent instances with replay and live broadcast."""
    print("\n--- Test 3: Async SSE Generator Stream ---")
    from engine.events import run_event_generator, publish_event
    test_run_id, _, _, _ = event_context

    async def consume_generator():
        # Publish final completion event to conclude the stream
        publish_event(test_run_id, "run_completed", {
            "report_id": test_run_id,
            "executive_title": "Test Completed Dossier"
        })

        events_received = []
        gen = run_event_generator(test_run_id)
        async for sse_item in gen:
            events_received.append({
                "id": sse_item.id,
                "event": sse_item.event,
                "data": json.loads(sse_item.data)
            })
            if sse_item.event == "run_completed":
                break

        return events_received

    events = asyncio.run(consume_generator())
    assert len(events) >= 4, f"Expected at least 4 events in stream, got {len(events)}"
    event_names = [e["event"] for e in events]
    assert "stage_changed" in event_names
    assert "run_completed" in event_names

    print(f"✓ Async generator successfully streamed {len(events)} SSE items:")
    for ev in events:
        print(f"  - SSE event='{ev['event']}' id={ev['id']}")


def test_4_fastapi_sse_endpoint():
    """Verify GET /api/v1/runs/{run_id}/events over HTTP."""
    print("\n--- Test 4: FastAPI SSE Endpoint Verification ---")
    import httpx
    from engine.server import app
    from engine.events import publish_event
    from engine.storage.relational_store import RelationalStore

    endpoint_run_id = f"test_http_{uuid.uuid4().hex[:8]}"

    from engine.auth import create_access_token
    from engine.database import SessionLocal
    from engine.models import User
    test_user_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.add(User(
            id=test_user_id,
            email=f"{test_user_id}@example.test",
            username=f"evt_{test_user_id[:12]}",
            password_hash="test-only",
        ))
        db.commit()
    finally:
        db.close()
    token = create_access_token(test_user_id, f"{test_user_id}@example.test", f"evt_{test_user_id[:12]}")

    # Create run and pre-populate events
    RelationalStore.create_run(
        question="Testing HTTP SSE stream",
        run_id=endpoint_run_id,
        settings={"depth": "quick"},
        user_id=test_user_id,
    )
    publish_event(endpoint_run_id, "stage_changed", {"stage": "planning", "progress": 15})
    publish_event(endpoint_run_id, "run_completed", {"report_id": endpoint_run_id})
    RelationalStore.update_run_status(endpoint_run_id, status="completed", stage="Completed", progress=100)

    async def run_client():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            async with ac.stream(
                "GET",
                f"/api/v1/runs/{endpoint_run_id}/events",
                headers={"Authorization": f"Bearer {token}"},
            ) as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers.get("content-type", "")

                lines = []
                async for line in response.aiter_lines():
                    if line:
                        lines.append(line)
                    if "run_completed" in line:
                        break

                body = "\n".join(lines)
                assert "stage_changed" in body
                assert "run_completed" in body

                print("✓ SSE HTTP Endpoint successfully connected and streamed text/event-stream:")
                print(f"  Status: {response.status_code} OK")
                print(f"  Content-Type: {response.headers.get('content-type')}")
                print(f"  Sample SSE wire payload:\n{body[:350].strip()}")

    asyncio.run(run_client())


def test_5_celery_queue_isolation():
    """Verify Celery queue isolation configuration (Blueprint Section 13)."""
    print("\n--- Test 5: Celery Queue Isolation Configuration ---")
    from engine.celery_app import celery_app

    queues = celery_app.conf.get("task_queues", {})
    routes = celery_app.conf.get("task_routes", {})
    default_queue = celery_app.conf.get("task_default_queue")

    required_queues = {"orchestrate", "research", "ingest"}
    configured_queue_names = set(queues.keys()) if isinstance(queues, dict) else set()

    assert required_queues.issubset(configured_queue_names), f"Missing queues: {required_queues - configured_queue_names}"
    assert default_queue == "orchestrate", f"Expected default queue 'orchestrate', got '{default_queue}'"

    assert "ada.run_research_pipeline" in routes
    assert routes["ada.run_research_pipeline"]["queue"] == "orchestrate"
    assert routes["ada.execute_sub_research"]["queue"] == "research"
    assert routes["ada.ingest_document"]["queue"] == "ingest"

    print("✓ All 3 isolated Celery queues configured:")
    for q in sorted(required_queues):
        print(f"  - Queue: '{q}'")
    print("✓ Task routing mappings confirmed:")
    for task_name, route in routes.items():
        print(f"  - {task_name} -> queue: '{route['queue']}'")


if __name__ == "__main__":
    run_id, e1, e2, e3 = test_1_event_publishing_and_persistence()
    test_2_sse_reconnection_replay(run_id, e1)
    test_3_async_sse_generator(run_id)
    test_4_fastapi_sse_endpoint()
    test_5_celery_queue_isolation()
    print("\n==========================================")
    print("ALL PHASE 4 SSE & QUEUE ISOLATION TESTS PASSED!")
    print("==========================================")
