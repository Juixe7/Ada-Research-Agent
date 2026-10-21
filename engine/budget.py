"""Thread-safe per-run limits for web searches and page fetches."""

from __future__ import annotations

import threading
import time
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class ResearchBudget:
    """Atomically reserve bounded search/fetch work across parallel tracks."""

    max_searches: int
    max_fetches: int
    timeout_seconds: int
    started_at: float = field(default_factory=time.monotonic)
    searches: int = 0
    fetches: int = 0
    on_change: Optional[Callable[[Dict[str, Any]], None]] = field(default=None, repr=False, compare=False)
    _exhausted: set[str] = field(default_factory=set, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def expired(self) -> bool:
        """Return whether the run-level research deadline has elapsed."""
        return time.monotonic() - self.started_at >= self.timeout_seconds

    def reserve(self, resource: str) -> bool:
        """Atomically reserve a search/fetch and publish the resulting usage snapshot.

        Returns False if the time budget or the selected resource cap is exhausted.
        Unsupported resource names raise ValueError. Progress callback errors are
        logged and ignored so optional telemetry cannot break a research run.
        """
        reserved = False
        changed = False
        with self._lock:
            if self.expired():
                changed = "time" not in self._exhausted
                self._exhausted.add("time")
            elif resource == "searches":
                if self.searches >= self.max_searches:
                    changed = resource not in self._exhausted
                    self._exhausted.add(resource)
                else:
                    self.searches += 1
                    reserved = changed = True
            elif resource == "fetches":
                if self.fetches >= self.max_fetches:
                    changed = resource not in self._exhausted
                    self._exhausted.add(resource)
                else:
                    self.fetches += 1
                    reserved = changed = True
            else:
                raise ValueError(f"Unsupported research budget resource: {resource}")

        if changed and self.on_change:
            try:
                self.on_change(self.snapshot())
            except Exception:
                logger.exception("Research budget progress callback failed")
        return reserved

    def snapshot(self) -> Dict[str, Any]:
        """Return a consistent usage/cap snapshot for run telemetry."""
        with self._lock:
            if self.expired():
                self._exhausted.add("time")
            return {
                "searches_used": self.searches,
                "searches_limit": self.max_searches,
                "fetches_used": self.fetches,
                "fetches_limit": self.max_fetches,
                "seconds_used": int(time.monotonic() - self.started_at),
                "seconds_limit": self.timeout_seconds,
                "limits_reached": sorted(self._exhausted),
            }
