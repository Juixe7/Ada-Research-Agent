import json
from typing import Dict, Any, Optional
from celery import Celery
import redis
from engine.config import REDIS_URL

# Initialize Celery application backed by Redis broker and result backend
celery_app = Celery(
    "ada_deep_research",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["engine.tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,      # Prevent a single thread from hoarding long research tasks
    task_acks_late=True,               # Acknowledge task only after completion for crash resilience
    result_expires=86400,              # Expire task metadata after 24 hours
    broker_connection_retry_on_startup=True,
)

# ── Shared Redis + In-Memory Ephemeral Job State Store ──
_redis_client: Optional[redis.Redis] = None
_redis_checked: bool = False
_LOCAL_JOBS_CACHE: Dict[str, Dict[str, Any]] = {}
MAX_LOCAL_JOBS = 30
JOB_TTL_SECONDS = 86400  # 24 hours


def get_redis_client() -> Optional[redis.Redis]:
    """Returns a connected Redis client if reachable, or None for local dev fallback."""
    global _redis_client, _redis_checked
    if _redis_client is not None:
        return _redis_client
    if _redis_checked:
        return None
    _redis_checked = True
    try:
        client = redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=1.5, socket_timeout=1.5)
        client.ping()
        _redis_client = client
        print(f"[redis] Connected to Redis job state store at {REDIS_URL}")
        return _redis_client
    except Exception:
        return None


def _prune_local_jobs() -> None:
    if len(_LOCAL_JOBS_CACHE) <= MAX_LOCAL_JOBS:
        return
    finished = [
        jid for jid, j in _LOCAL_JOBS_CACHE.items()
        if j.get("status") in ("completed", "failed")
    ]
    for jid in finished[: len(_LOCAL_JOBS_CACHE) - MAX_LOCAL_JOBS]:
        _LOCAL_JOBS_CACHE.pop(jid, None)


def set_job_state(report_id: str, state: Dict[str, Any]) -> None:
    """
    Writes job status/result to Redis (shared across FastAPI and Celery containers)
    and mirrors to bounded local memory fallback.
    """
    _LOCAL_JOBS_CACHE[report_id] = state
    _prune_local_jobs()

    r = get_redis_client()
    if r is not None:
        try:
            r.setex(f"ada:job:{report_id}", JOB_TTL_SECONDS, json.dumps(state))
        except Exception as e:
            print(f"[redis] Warning: failed to write job state for {report_id}: {e}")


def get_job_state(report_id: str) -> Optional[Dict[str, Any]]:
    """
    Reads live job status/result from Redis first (so FastAPI sees Celery worker updates),
    falling back to local memory if Redis is offline.
    """
    r = get_redis_client()
    if r is not None:
        try:
            raw = r.get(f"ada:job:{report_id}")
            if raw:
                return json.loads(raw)
        except Exception as e:
            print(f"[redis] Warning: failed to read job state for {report_id}: {e}")

    return _LOCAL_JOBS_CACHE.get(report_id)
