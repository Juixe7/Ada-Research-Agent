"""Token-bucket request and token throttling for LLM providers.

"""

import time
import threading
import random
from typing import Dict

class TokenBucketLimiter:
    """
    Per-model token-bucket rate limiter.
    Uses Redis when connected, with automatic in-memory fallback for standalone dev.
    Tracks both Requests Per Minute (RPM) and Tokens Per Minute (TPM).
    """
    def __init__(self, redis_client=None, default_rpm: int = 60, default_tpm: int = 100_000):
        self.redis = redis_client
        self.default_rpm = default_rpm
        self.default_tpm = default_tpm

        # Local in-memory state fallback
        self._lock = threading.Lock()
        self._local_buckets: Dict[str, Dict[str, float]] = {}
        self._throttled_until: Dict[str, float] = {}

    def is_throttled(self, model: str) -> bool:
        """Checks if a model is currently under a 429 backoff cooldown."""
        now = time.time()
        # Check Redis if available
        if self.redis:
            try:
                val = self.redis.get(f"ratelimit:cooldown:{model}")
                if val and float(val) > now:
                    return True
            except Exception:
                pass

        # Check local
        with self._lock:
            cooldown = self._throttled_until.get(model, 0.0)
            return cooldown > now

    def record_429(self, model: str, retry_after: float = 3.0) -> None:
        """Records a 429 rate limit hit with jittered backoff."""
        jitter = random.uniform(0.5, 2.0)
        cooldown_duration = max(retry_after, 2.0) + jitter
        cooldown_until = time.time() + cooldown_duration

        if self.redis:
            try:
                self.redis.set(f"ratelimit:cooldown:{model}", str(cooldown_until), ex=int(cooldown_duration) + 1)
            except Exception:
                pass

        with self._lock:
            self._throttled_until[model] = cooldown_until

    def acquire(self, model: str, estimated_tokens: int = 1500, max_wait: float = 5.0) -> bool:
        """
        Attempts to acquire token and request capacity before firing an LLM call.
        Returns True if acquired, or False if wait exceeded max_wait.
        """
        start = time.time()
        while time.time() - start < max_wait:
            if self.is_throttled(model):
                time.sleep(0.5)
                continue

            # In Redis implementation
            if self.redis:
                try:
                    now = int(time.time())
                    minute_key_rpm = f"ratelimit:rpm:{model}:{now // 60}"
                    minute_key_tpm = f"ratelimit:tpm:{model}:{now // 60}"

                    p = self.redis.pipeline()
                    p.incr(minute_key_rpm)
                    p.expire(minute_key_rpm, 120)
                    p.incrby(minute_key_tpm, estimated_tokens)
                    p.expire(minute_key_tpm, 120)
                    rpm_val, _, tpm_val, _ = p.execute()

                    if rpm_val <= self.default_rpm and tpm_val <= self.default_tpm:
                        return True
                    else:
                        time.sleep(1.0)
                        continue
                except Exception:
                    pass  # Fall through to local limiter if Redis fails

            # Local in-memory token bucket implementation
            with self._lock:
                now = time.time()
                bucket = self._local_buckets.setdefault(model, {
                    "rpm_tokens": float(self.default_rpm),
                    "tpm_tokens": float(self.default_tpm),
                    "last_updated": now
                })

                elapsed = now - bucket["last_updated"]
                bucket["last_updated"] = now

                # Replenish rates (per second)
                bucket["rpm_tokens"] = min(float(self.default_rpm), bucket["rpm_tokens"] + elapsed * (self.default_rpm / 60.0))
                bucket["tpm_tokens"] = min(float(self.default_tpm), bucket["tpm_tokens"] + elapsed * (self.default_tpm / 60.0))

                if bucket["rpm_tokens"] >= 1.0 and bucket["tpm_tokens"] >= estimated_tokens:
                    bucket["rpm_tokens"] -= 1.0
                    bucket["tpm_tokens"] -= estimated_tokens
                    return True

            time.sleep(0.2)

        return False
