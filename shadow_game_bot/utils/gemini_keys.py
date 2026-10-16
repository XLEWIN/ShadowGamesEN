"""Gemini API key manager — rotation + 30-minute cooldown for failed keys.

Port of WordSeek's util/key-manager.ts. State kept in memory (plus the
TTL store for restarts within the process); failed keys retry after
RETRY_AFTER_MINUTES.
"""

import time
from typing import List, Optional, Tuple

from shadow_game_bot.config import config

RETRY_AFTER_MINUTES = 30


class APIKeyManager:
    def __init__(self) -> None:
        self.keys: List[str] = list(config.gemini_api_keys)
        self.current_index = 0
        self.failed_keys: dict = {}  # key -> monotonic timestamp

    @property
    def enabled(self) -> bool:
        return bool(self.keys)

    def _available(self) -> List[str]:
        now = time.monotonic()
        return [k for k in self.keys
                if k not in self.failed_keys
                or now - self.failed_keys[k] >= RETRY_AFTER_MINUTES * 60]

    def get_working_key(self) -> Optional[str]:
        available = self._available()
        if not available:
            self.reset_failed_keys()
            available = self._available()
        if not available:
            return None
        self.current_index %= len(available)
        key = available[self.current_index]
        self.current_index += 1
        return key

    def mark_key_as_failed(self, key: str) -> None:
        self.failed_keys[key] = time.monotonic()

    def reset_failed_keys(self) -> None:
        self.failed_keys.clear()

    def available_keys_count(self) -> int:
        return len(self._available())


# Shared instance
key_manager = APIKeyManager()


def is_api_key_error(message: str) -> bool:
    text = (message or "").lower()
    patterns = [
        "api key", "unauthorized", "invalid key", "quota exceeded",
        "rate limit", "forbidden", "401", "403", "429",
    ]
    return any(p in text for p in patterns)
