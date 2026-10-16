"""Leaderboard input parsing + smart defaults (ported from WordSeek)."""

from typing import Dict, List, Optional, Tuple

from shadow_game_bot.db.wordseek import WordSeekCollection

ALLOWED_SEARCH_KEYS = ["global", "group"]
ALLOWED_TIME_KEYS = ["today", "week", "month", "year", "all"]
ALLOWED_WORD_LENGTHS = [4, 5, 6]


def parse_leaderboard_input(
    raw: str,
    default_search_key: Optional[str] = None,
    default_time_key: Optional[str] = None,
    default_word_length: int = 5,
) -> Tuple[Optional[str], Optional[str], int, Optional[str]]:
    """Returns (search_key, time_key, word_length, target)."""
    parts = [p for p in raw.lower().strip().split() if p]

    target: Optional[str] = None
    found_search: Optional[str] = None
    found_time: Optional[str] = None
    found_length: Optional[int] = None

    for index, part in enumerate(parts):
        if part in ALLOWED_SEARCH_KEYS:
            found_search = part
            continue
        if part in ALLOWED_TIME_KEYS:
            found_time = part
            continue
        try:
            num = int(part)
        except ValueError:
            num = -1
        if num in ALLOWED_WORD_LENGTHS:
            found_length = num
            continue
        if part.startswith("@") or part.isdigit():
            target = part
            continue
        if target is None and index == 0:
            target = part

    search_key = found_search or default_search_key
    time_key = found_time or default_time_key
    word_length = found_length if found_length is not None else default_word_length
    return search_key, time_key, word_length, target


def parse_leaderboard_filters(
    raw: str,
    default_search_key: str = "group",
    default_time_key: str = "month",
) -> Tuple[str, str, int]:
    parts = [p for p in raw.lower().strip().split() if p]
    search_key = next((p for p in parts if p in ALLOWED_SEARCH_KEYS), default_search_key)
    time_key = next((p for p in parts if p in ALLOWED_TIME_KEYS), default_time_key)
    length_part = next((p for p in parts if p.isdigit() and int(p) in ALLOWED_WORD_LENGTHS), None)
    word_length = int(length_part) if length_part else 5
    return search_key, time_key, word_length


async def get_smart_defaults(
    ws_db: WordSeekCollection,
    user_id: str,
    chat_id: str,
    requested_search_key: Optional[str],
    requested_time_key: Optional[str],
    requested_word_length: Optional[int],
    chat_type: str,
) -> Dict:
    search_key = requested_search_key or ("global" if chat_type == "private" else "group")

    if search_key == "group" and chat_type != "private":
        if not await ws_db.has_any_scores(user_id, chat_id=chat_id):
            search_key = "global"

    if requested_word_length:
        word_length = requested_word_length
    else:
        word_length = await _smart_default_length(ws_db, user_id, chat_id, search_key)

    if requested_time_key:
        time_key = requested_time_key
    else:
        time_key = await _smart_default_time(ws_db, user_id, chat_id, search_key, word_length)

    has_any = await ws_db.has_any_scores(
        user_id,
        chat_id=chat_id if search_key == "group" else None,
        word_length=word_length,
    )
    return {"searchKey": search_key, "timeKey": time_key,
            "wordLength": word_length, "hasAnyScores": has_any}


async def _smart_default_length(ws_db, user_id, chat_id, search_key) -> int:
    for length in (5, 4, 6):
        if await ws_db.has_any_scores(
            user_id,
            chat_id=chat_id if search_key == "group" else None,
            word_length=length,
        ):
            return length
    return 5


async def _smart_default_time(ws_db, user_id, chat_id, search_key, word_length) -> str:
    created_at = await ws_db.latest_score_date(
        user_id, word_length, chat_id=chat_id if search_key == "group" else None
    )
    if not created_at:
        return "all"
    from datetime import datetime, timezone
    try:
        latest = datetime.fromisoformat(created_at)
        if latest.tzinfo is None:
            latest = latest.replace(tzinfo=timezone.utc)
    except ValueError:
        return "all"
    now = datetime.now(timezone.utc)
    local = latest.astimezone()
    now_local = now.astimezone()
    if (local.year, local.month, local.day) == (now_local.year, now_local.month, now_local.day):
        return "today"
    start_of_week = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week = start_of_week.fromtimestamp(
        start_of_week.timestamp() - now_local.weekday() * 86400, tz=start_of_week.tzinfo
    )
    if local >= start_of_week:
        return "week"
    if local >= now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0):
        return "month"
    if local >= now_local.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0):
        return "year"
    return "all"
