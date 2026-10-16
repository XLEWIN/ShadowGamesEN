"""Daily WordSeek: deterministic word-of-the-day + Gemini meanings.

Port of WordSeek's services/daily-wordle-cron.ts:

* seedFromSecret  — HMAC-SHA256(secret, "wotd-permutation-seed") → uint32 BE
* mulberry32      — bit-exact JS port (Math.imul / >>> emulated)
* deterministicShuffle — Fisher–Yates over daily-word-lists.json
* word of the day — shuffled[dayNumber % len], dayNumber from start date
* cron            — daily at 06:00 TIME_ZONE (asyncio task, replaces CronJob)
* meanings        — Gemini generateContent REST via httpx (optional)
"""

import hashlib
import json
import logging
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx

from shadow_game_bot.config import config
from shadow_game_bot.db.wordseek import WordSeekCollection
from shadow_game_bot.utils.gemini_keys import is_api_key_error, key_manager

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

FREE_MODELS = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-preview-09-2025",
    "gemini-2.0-flash",
]

ALLOWED_TAGS = {"b", "i", "u"}

SYSTEM_PROMPT = """
You are an expert English word master. Your task is to provide detailed information about a specific English word.

For the given word, generate the following:

1. **Meaning** — Provide a clear, thorough explanation of the word.
   - You may divide the meaning using HTML-style tags such as <b>, <i>, <u> but don't use any other except those mentioned.
   - You may include multiple senses or nuances of the word.
   - The meaning should be descriptive and helpful for learners.
   - The meaning length must not exceed 900 characters.

2. **Phonetic** — Provide the standard IPA pronunciation.

3. **Sentence** — Provide one example sentence that correctly uses the provided word.

Your output must be in **strict JSON format** as follows:
{
  "word": "the provided word",
  "phonetic": "IPA pronunciation",
  "meaning": "descriptive meaning, with optional <b> <i> <u> tags",
  "sentence": "an example sentence correctly using the provided word"
}

**Important Rules:**
1. The meaning must never include unrelated commentary or instructions.
2. Output strictly as JSON **without backticks, code blocks, comments, or extra formatting**.
3. Do not add explanations outside of the JSON.
""".strip()


# ────────────────────────────────────────────────
# Bit-exact JS emulation helpers
# ────────────────────────────────────────────────

def _to_u32(x: int) -> int:
    return x & 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """Math.imul bit pattern kept as unsigned 32 (safe for >>> usage)."""
    return (a * b) & 0xFFFFFFFF


def mulberry32(seed: int):
    """Exact port of the JS mulberry32 used by WordSeek."""
    t = _to_u32(seed)

    def rand() -> float:
        nonlocal t
        t = _to_u32(t + 0x6D2B79F5)
        r = _imul(t ^ (t >> 15), 1 | t)
        r = _to_u32(_to_u32(r + _imul(r ^ (r >> 7), 61 | r)) ^ r)
        r = _to_u32(r ^ (r >> 14))
        return r / 4294967296.0

    return rand


def seed_from_secret(secret: str) -> int:
    import hmac
    digest = hmac.new(secret.encode("utf-8"), b"wotd-permutation-seed",
                      hashlib.sha256).digest()
    return int.from_bytes(digest[:4], "big")


def _load_daily_words() -> List[str]:
    path = _DATA_DIR / "daily-word-lists.json"
    return json.loads(path.read_text(encoding="utf-8"))


def deterministic_shuffle(seed: int) -> List[str]:
    arr = list(_load_daily_words())
    rnd = mulberry32(seed)
    for i in range(len(arr) - 1, 0, -1):
        j = int(rnd() * (i + 1))
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def day_number(now_ms: Optional[float] = None, start: Optional[date] = None) -> int:
    if now_ms is None:
        now_ms = time.time() * 1000
    start = start or config.daily_wordle_start_date
    start_ms = datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp() * 1000
    return int((now_ms - start_ms) // 86_400_000)


def get_word_of_the_day(now_ms: Optional[float] = None) -> str:
    seed = seed_from_secret(config.daily_wordle_secret)
    shuffled = deterministic_shuffle(seed)
    n = day_number(now_ms, config.daily_wordle_start_date)
    index = ((n % len(shuffled)) + len(shuffled)) % len(shuffled)
    return shuffled[index]


# ────────────────────────────────────────────────
# Game-date string (6 AM rollover in TIME_ZONE)
# ────────────────────────────────────────────────

def get_current_game_date_string(now: Optional[datetime] = None) -> str:
    try:
        tz = ZoneInfo(config.time_zone)
    except Exception:
        tz = timezone.utc
    local = (now or datetime.now(timezone.utc)).astimezone(tz)
    if local.hour < 6:
        local = local - timedelta(days=1)
    return local.strftime("%Y-%m-%d")


# ────────────────────────────────────────────────
# Gemini word details (optional)
# ────────────────────────────────────────────────

def sanitize_meaning(text: str) -> str:
    def repl(match: "re.Match[str]") -> str:
        tag = match.group(1) or ""
        if tag.lower() in ALLOWED_TAGS:
            return re.sub(r' .*?>', ">", match.group(0), count=1)
        return ""

    return re.sub(r"</?([a-zA-Z0-9]+)([^>]*)>", repl, text)


async def _call_gemini(prompt: str, key: str, model: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(
            url,
            params={"key": key},
            json={"contents": [{"parts": [{"text": prompt}]}]},
        )
    if resp.status_code in (401, 403, 429, 400):
        raise RuntimeError(f"api key error {resp.status_code}: {resp.text[:200]}")
    resp.raise_for_status()
    data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return text.replace("```json", "").replace("```", "").strip()


async def get_word_details(word: str) -> Optional[Dict[str, str]]:
    """Fetch meaning/phonetic/sentence; returns None when Gemini unavailable."""
    if not key_manager.enabled:
        return None
    max_retries = max(len(key_manager.keys) * len(FREE_MODELS) * 2, 1)
    for attempt in range(1, max_retries + 1):
        key = key_manager.get_working_key()
        if not key:
            return None
        model = FREE_MODELS[(attempt - 1) % len(FREE_MODELS)]
        try:
            raw = await _call_gemini(f"{SYSTEM_PROMPT}\n **THE WORD TO CREATE HINTS FOR:** {word}", key, model)
            parsed = json.loads(raw)
            if not all(isinstance(parsed.get(f), str) for f in ("word", "phonetic", "meaning", "sentence")):
                raise ValueError("invalid schema")
            return {
                "word": parsed["word"],
                "phonetic": parsed["phonetic"],
                "meaning": sanitize_meaning(parsed["meaning"]),
                "sentence": parsed["sentence"],
            }
        except Exception as exc:  # noqa: BLE001 — mirror original retry loop
            if is_api_key_error(str(exc)):
                key_manager.mark_key_as_failed(key)
            else:
                await _async_sleep(1.0)
            if attempt == max_retries or key_manager.available_keys_count() == 0:
                break
    return None


async def _async_sleep(seconds: float) -> None:
    import asyncio
    await asyncio.sleep(seconds)


# ────────────────────────────────────────────────
# Daily word generation / ensure
# ────────────────────────────────────────────────

async def ensure_daily_word(ws_db: WordSeekCollection, game_date: Optional[str] = None) -> Optional[Dict]:
    try:
        date_str = game_date or get_current_game_date_string()
        existing = await ws_db.get_daily_word_by_date(date_str)
        if existing:
            return existing

        word = get_word_of_the_day()
        details = await get_word_details(word)
        day_no = day_number(start=config.daily_wordle_start_date)

        inserted = await ws_db.insert_daily_word(
            day_number=day_no,
            word=word,
            date_str=date_str,
            meaning=details.get("meaning") if details else None,
            phonetic=details.get("phonetic") if details else None,
            sentence=details.get("sentence") if details else None,
        )

        yesterday = (date.fromisoformat(date_str) - timedelta(days=1)).isoformat()
        reset = await ws_db.reset_inactive_streaks(f"{yesterday}T00:00:00")
        if reset:
            logger.info("Reset streaks for %s inactive players", reset)

        logger.info("Generated daily word %r for %s", word, date_str)
        return inserted
    except Exception:
        logger.exception("ensure_daily_word failed")
        return None


# ────────────────────────────────────────────────
# Cron (asyncio task, replaces node-cron "0 6 * * *")
# ────────────────────────────────────────────────

async def daily_wordle_cron_task(ws_db: WordSeekCollection) -> None:
    """Sleep until the next 06:00 in TIME_ZONE, generate, repeat."""
    import asyncio
    while True:
        try:
            try:
                tz = ZoneInfo(config.time_zone)
            except Exception:
                tz = timezone.utc
            now = datetime.now(timezone.utc).astimezone(tz)
            target = now.replace(hour=6, minute=0, second=0, microsecond=0)
            if now >= target:
                target = target + timedelta(days=1)
            await asyncio.sleep(max((target - now).total_seconds(), 1))
            await ensure_daily_word(ws_db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("daily_wordle_cron_task error")
            await asyncio.sleep(60)
