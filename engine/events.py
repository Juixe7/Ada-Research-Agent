"""Publishes research lifecycle events and exposes active-run events as server-sent events.

"""

import json
import logging
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Optional, AsyncGenerator, List
from collections import defaultdict, deque
from sse_starlette.sse import ServerSentEvent

from engine.celery_app import get_redis_client
from engine.storage.relational_store import RelationalStore

logger = logging.getLogger(__name__)

# Bounded in-memory fallback queues for local dev and testing when Redis is unavailable
_LOCAL_EVENT_SUBSCRIBERS: Dict[str, List[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = defaultdict(list)
_LOCAL_EVENT_HISTORY: Dict[str, deque] = defaultdict(lambda: deque(maxlen=200))


def _enqueue_local_event(queue: asyncio.Queue, payload: Dict[str, Any]) -> None:
    """Queue a local event without blocking; a full subscriber queue drops it."""
    try:
        queue.put_nowait(payload)
    except asyncio.QueueFull:
        pass


def publish_event(run_id: str, event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Publishes a structured, typed research event (Blueprint Section 12).
    1. Persists event to Postgres durable sequence for reconnection replay.
    2. Broadcasts live event to Redis pub/sub channel `ada:events:{run_id}`.
    3. Broadcasts to active in-memory subscriber queues.
    """
    if not run_id:
        return {}

    # 1. Durable Relational Persistence
    event_record = None
    try:
        event_record = RelationalStore.record_event(run_id, event_type, data)
    except Exception:
        logger.warning("Could not persist event %s for run %s", event_type, run_id)

    event_id = str(event_record.id) if event_record else str(uuid.uuid4())
    seq = event_record.seq if event_record else 1

    payload = {
        "id": event_id,
        "seq": seq,
        "event": event_type,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    # 2. Redis Pub/Sub Broadcast
    r = get_redis_client()
    if r is not None:
        try:
            r.publish(f"ada:events:{run_id}", json.dumps(payload))
        except Exception:
            logger.warning("Could not publish event %s for run %s to Redis", event_type, run_id)

    # 3. In-memory Local Queue Distribution
    _LOCAL_EVENT_HISTORY[run_id].append(payload)
    for loop, q in list(_LOCAL_EVENT_SUBSCRIBERS.get(run_id, [])):
        try:
            loop.call_soon_threadsafe(_enqueue_local_event, q, payload)
        except Exception:
            pass

    return payload


async def run_event_generator(
    run_id: str,
    last_event_id: Optional[str] = None,
    client_request: Any = None
) -> AsyncGenerator[ServerSentEvent, None]:
    """
    Server-Sent Events (SSE) generator supporting transparent reconnection:
    - Replays prior stored events starting after `last_event_id`
    - Subscribes to live Redis pub/sub channel (or local asyncio queue)
    - Automatically terminates when run completes or client disconnects
    """
    # ── Step 1: Replay Historical Events (DB first, fallback to memory) ──
    replayed_ids = set()
    try:
        past_events = RelationalStore.get_events(run_id, after_id=last_event_id)
        for ev in past_events:
            replayed_ids.add(str(ev["id"]))
            yield ServerSentEvent(
                data=json.dumps(ev["data"]),
                event=ev["event"],
                id=str(ev["id"])
            )
            if ev.get("event") in ("run_completed", "run_failed", "run_cancelled"):
                return
    except Exception:
        logger.warning("Could not load event history for run %s; trying local fallback", run_id)

    # Fallback to local memory if DB returned nothing but memory has prior events
    if not replayed_ids and run_id in _LOCAL_EVENT_HISTORY:
        for ev in list(_LOCAL_EVENT_HISTORY[run_id]):
            replayed_ids.add(str(ev["id"]))
            yield ServerSentEvent(
                data=json.dumps(ev["data"]),
                event=ev["event"],
                id=str(ev["id"])
            )
            if ev.get("event") in ("run_completed", "run_failed", "run_cancelled"):
                return

    # ── Step 2: Check if run is already completed ──
    try:
        run_info = RelationalStore.get_run(run_id)
        if run_info and run_info.get("status") in ("completed", "failed", "cancelled"):
            return
    except Exception:
        logger.warning("Could not read durable status for run %s; keeping event stream open", run_id)

    # ── Step 3: Stream Live Events ──
    local_queue: asyncio.Queue = asyncio.Queue()
    local_subscriber = (asyncio.get_running_loop(), local_queue)
    _LOCAL_EVENT_SUBSCRIBERS[run_id].append(local_subscriber)

    redis_client = get_redis_client()
    pubsub = None

    if redis_client is not None:
        try:
            pubsub = redis_client.pubsub()
            pubsub.subscribe(f"ada:events:{run_id}")
        except Exception:
            pubsub = None

    try:
        # Close the replay/subscribe race: events published while the initial
        # history was being yielded are now replayed before waiting for live data.
        try:
            pending_events = RelationalStore.get_events(run_id, after_id=last_event_id)
            for ev in pending_events:
                event_id = str(ev["id"])
                if event_id in replayed_ids:
                    continue
                replayed_ids.add(event_id)
                yield ServerSentEvent(data=json.dumps(ev["data"]), event=ev["event"], id=event_id)
                if ev.get("event") in ("run_completed", "run_failed", "run_cancelled"):
                    return
        except Exception:
            logger.warning("Could not replay new events for run %s", run_id)
        for ev in list(_LOCAL_EVENT_HISTORY.get(run_id, [])):
            event_id = str(ev["id"])
            if event_id in replayed_ids:
                continue
            replayed_ids.add(event_id)
            yield ServerSentEvent(data=json.dumps(ev["data"]), event=ev["event"], id=event_id)
            if ev.get("event") in ("run_completed", "run_failed", "run_cancelled"):
                return

        while True:
            # Check client disconnection
            if client_request is not None and hasattr(client_request, "is_disconnected"):
                if await client_request.is_disconnected():
                    break

            msg_payload = None

            # Check Redis pubsub
            if pubsub is not None:
                try:
                    msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)
                    if msg and msg.get("data"):
                        msg_payload = json.loads(msg["data"])
                except Exception:
                    pass

            # Fallback to in-memory queue
            if msg_payload is None:
                try:
                    msg_payload = await asyncio.wait_for(local_queue.get(), timeout=0.25)
                except asyncio.TimeoutError:
                    msg_payload = None

            if msg_payload:
                eid = str(msg_payload.get("id"))
                if eid in replayed_ids:
                    continue
                replayed_ids.add(eid)

                event_type = msg_payload.get("event", "message")
                data_obj = msg_payload.get("data", {})

                yield ServerSentEvent(
                    data=json.dumps(data_obj),
                    event=event_type,
                    id=eid
                )

                if event_type in ("run_completed", "run_failed", "run_cancelled"):
                    break

            # Periodically verify run status in case terminal event was missed
            try:
                run_info = RelationalStore.get_run(run_id)
                if run_info and run_info.get("status") in ("completed", "failed", "cancelled"):
                    break
            except Exception:
                pass

    finally:
        # Cleanup subscribers
        if pubsub is not None:
            try:
                pubsub.unsubscribe()
                pubsub.close()
            except Exception:
                pass
        if local_subscriber in _LOCAL_EVENT_SUBSCRIBERS.get(run_id, []):
            _LOCAL_EVENT_SUBSCRIBERS[run_id].remove(local_subscriber)
