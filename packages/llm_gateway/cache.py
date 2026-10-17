import json
import hashlib
import time
from typing import Optional, Dict, Any, List

class ResponseCache:
    """
    Response cache for deterministic LLM calls (temperature <= 0.05).
    Keyed on SHA256(model, messages, parameters).
    Uses Redis if available with 24h TTL, and an in-memory dictionary fallback.
    """
    def __init__(self, redis_client=None, default_ttl: int = 86400):
        self.redis = redis_client
        self.default_ttl = default_ttl
        self._local_cache: Dict[str, Dict[str, Any]] = {}

    def _compute_key(self, model: str, messages: List[Dict[str, str]], **params) -> str:
        serialized = json.dumps({
            "model": model,
            "messages": messages,
            "params": {k: v for k, v in sorted(params.items()) if k not in ("run_id", "agent_name")}
        }, sort_keys=True)
        h = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        return f"cache:llm:{h}"

    def get(self, model: str, messages: List[Dict[str, str]], temperature: float, **params) -> Optional[str]:
        # Only cache deterministic calls
        if temperature > 0.05:
            return None

        key = self._compute_key(model, messages, temperature=temperature, **params)

        if self.redis:
            try:
                cached = self.redis.get(key)
                if cached:
                    return cached
            except Exception:
                pass

        # In-memory fallback
        item = self._local_cache.get(key)
        if item:
            if time.time() < item["expires_at"]:
                return item["response"]
            else:
                del self._local_cache[key]

        return None

    def set(self, model: str, messages: List[Dict[str, str]], temperature: float, response: str, ttl: Optional[int] = None, **params) -> None:
        if temperature > 0.05 or not response:
            return

        key = self._compute_key(model, messages, temperature=temperature, **params)
        expires = ttl or self.default_ttl

        if self.redis:
            try:
                self.redis.set(key, response, ex=expires)
                return
            except Exception:
                pass

        # In-memory fallback
        self._local_cache[key] = {
            "response": response,
            "expires_at": time.time() + expires
        }
        # Evict oldest if exceeding 500 items
        if len(self._local_cache) > 500:
            oldest_key = min(self._local_cache.keys(), key=lambda k: self._local_cache[k]["expires_at"])
            del self._local_cache[oldest_key]
