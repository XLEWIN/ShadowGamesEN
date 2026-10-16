"""Word selection with per-chat repeat avoidance.

Port of WordSeek's util/word-selector.ts — Redis set history replaced by
the ws_word_history SQLite table (7-day TTL, keep newest 50, reset when
fewer than 10 words remain in the pool).
"""

import json
import logging
import random
from pathlib import Path
from typing import Dict, List

from shadow_game_bot.db.wordseek import WordSeekCollection

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

_WORD_LISTS: Dict[int, List[str]] = {}

#: Files are named by word, not digit (common-four.json), matching the
#: original WordSeek data directory.
_LIST_FILES = {4: "common-four.json", 5: "common-five.json", 6: "common-six.json"}


def _load_list(length: int) -> List[str]:
    if length in _WORD_LISTS:
        return _WORD_LISTS[length]
    path = _DATA_DIR / _LIST_FILES.get(length, f"common-{length}.json")
    try:
        words = json.loads(path.read_text(encoding="utf-8"))
        _WORD_LISTS[length] = [w.lower() for w in words]
    except Exception as exc:
        logger.error("Failed to load word list %s: %s", path, exc)
        _WORD_LISTS[length] = []
    return _WORD_LISTS[length]


class WordSelector:
    def __init__(self, ws_db: WordSeekCollection,
                 history_size: int = 50, reset_threshold: int = 10):
        self.ws_db = ws_db
        self.history_size = history_size
        self.reset_threshold = reset_threshold

    async def get_random_word(self, chat_id: str, word_length: int = 5) -> str:
        word_list = _load_list(word_length)
        if not word_list:
            raise RuntimeError(f"No word list for length {word_length}")

        used = {w.lower() for w in await self.ws_db.get_word_history(chat_id, word_length)}
        available = [w for w in word_list if w not in used]

        if len(available) < self.reset_threshold:
            # Keep the most recent few, then retry
            recent = sorted(used)[-max(self.reset_threshold // 2, 1):]
            await self.ws_db.trim_word_history_keep(chat_id, word_length, recent)
            return await self.get_random_word(chat_id, word_length)

        word = random.choice(available).lower()
        await self.ws_db.add_word_history(chat_id, word_length, word,
                                          keep_last=self.history_size)
        return word

    async def reset_chat(self, chat_id: str, word_length: int = 5) -> None:
        await self.ws_db.trim_word_history_keep(chat_id, word_length, [])

    async def get_chat_stats(self, chat_id: str, word_length: int = 5) -> Dict[str, int]:
        total = len(_load_list(word_length))
        used_count = len(await self.ws_db.get_word_history(chat_id, word_length))
        return {"usedCount": used_count, "availableCount": total - used_count, "totalCount": total}
