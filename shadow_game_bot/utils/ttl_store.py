"""In-memory TTL store — replaces Redis for short-lived bot state.

Used for: game-end votes (300s), captcha sessions (80s), daily-word
guess flash state. Anything that must survive a restart lives in SQLite
instead (see db/wordseek.py).
"""

import time
from typing import Any, Dict, Optional


class TTLStore:
    def __init__(self) -> None:
        self._data: Dict[str, Any] = {}
        self._expiry: Dict[str, float] = {}

    def set(self, key: str, value: Any, ttl_seconds: Optional[float] = None) -> None:
        self._data[key] = value
        if ttl_seconds is None:
            self._expiry.pop(key, None)
        else:
            self._expiry[key] = time.monotonic() + ttl_seconds

    def get(self, key: str, default: Any = None) -> Any:
        self._check(key)
        return self._data.get(key, default)

    def pop(self, key: str, default: Any = None) -> Any:
        self._check(key)
        self._expiry.pop(key, None)
        return self._data.pop(key, default)

    def delete(self, key: str) -> None:
        self._data.pop(key, None)
        self._expiry.pop(key, None)

    def has(self, key: str) -> bool:
        self._check(key)
        return key in self._data

    def ttl(self, key: str) -> Optional[float]:
        self._check(key)
        return self._expiry.get(key)

    def keys(self) -> list:
        now = time.monotonic()
        return [k for k, exp in list(self._expiry.items()) if exp > now] or list(
            k for k in self._data if k not in self._expiry
        )

    def clear(self) -> None:
        self._data.clear()
        self._expiry.clear()

    def _check(self, key: str) -> None:
        exp = self._expiry.get(key)
        if exp is not None and time.monotonic() >= exp:
            self._data.pop(key, None)
            self._expiry.pop(key, None)


# Shared instance used across the bot
store = TTLStore()
