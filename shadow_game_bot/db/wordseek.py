"""WordSeek database operations (ported from the Postgres WordSeek bot to SQLite)."""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiosqlite

logger = logging.getLogger(__name__)

DEFAULT_LENGTHS = [5, 4, 6]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class WordSeekCollection:
    def __init__(self, db: aiosqlite.Connection):
        self.db = db

    # ── Users ──────────────────────────────────

    async def upsert_user(self, user_id: str, name: str, username: Optional[str] = None) -> None:
        now = _now()
        await self.db.execute(
            """INSERT INTO ws_users (id, name, username, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = excluded.username, updated_at = excluded.updated_at""",
            (user_id, name, username, now, now),
        )
        await self.db.commit()

    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM ws_users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def find_users_by_username(self, username: str) -> List[Dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT id, name, username FROM ws_users WHERE lower(username) = lower(?)",
            (username,),
        )
        return [dict(r) for r in await cursor.fetchall()]

    # ── Broadcast chats ────────────────────────

    async def upsert_broadcast_chat(self, chat_id: str, name: Optional[str], username: Optional[str] = None) -> None:
        now = _now()
        await self.db.execute(
            """INSERT INTO ws_broadcast_chats (id, name, username, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = excluded.username, updated_at = excluded.updated_at""",
            (chat_id, name, username, now, now),
        )
        await self.db.commit()

    async def delete_broadcast_chat(self, chat_id: str) -> None:
        await self.db.execute("DELETE FROM ws_broadcast_chats WHERE id = ?", (chat_id,))
        await self.db.commit()

    async def list_broadcast_chats(self) -> List[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM ws_broadcast_chats ORDER BY created_at ASC")
        return [dict(r) for r in await cursor.fetchall()]

    async def count_broadcast_groups(self) -> int:
        cursor = await self.db.execute("SELECT COUNT(*) AS c FROM ws_broadcast_chats WHERE id LIKE '-1%'")
        row = await cursor.fetchone()
        return int(row["c"]) if row else 0

    # ── Regular WordSeek games ─────────────────

    async def create_game(self, word: str, chat_id: str, topic_id: str, started_by: str) -> bool:
        """Insert a new game. Returns False when one already exists for chat+topic."""
        existing = await self.get_game(chat_id, topic_id)
        if existing:
            return False
        now = _now()
        await self.db.execute(
            "INSERT INTO ws_games (word, active_chat, topic_id, started_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (word, chat_id, topic_id, started_by, now, now),
        )
        await self.db.commit()
        return True

    async def get_game(self, chat_id: str, topic_id: str = "general") -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM ws_games WHERE active_chat = ? AND topic_id = ?",
            (chat_id, topic_id),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_any_game(self, chat_id: str) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM ws_games WHERE active_chat = ? LIMIT 1", (chat_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_game_by_id(self, game_id: int) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM ws_games WHERE id = ?", (game_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def delete_game(self, game_id: int) -> None:
        await self.db.execute("DELETE FROM ws_games WHERE id = ?", (game_id,))
        await self.db.commit()

    async def delete_game_by_chat(self, chat_id: str) -> Optional[str]:
        """Delete game(s) for a chat; returns the word of the first deleted game."""
        cursor = await self.db.execute(
            "SELECT word FROM ws_games WHERE active_chat = ? LIMIT 1", (chat_id,)
        )
        row = await cursor.fetchone()
        word = row["word"] if row else None
        await self.db.execute("DELETE FROM ws_games WHERE active_chat = ?", (chat_id,))
        await self.db.commit()
        return word

    # ── Guesses ────────────────────────────────

    async def add_guess(self, game_id: int, guess: str, chat_id: str) -> None:
        now = _now()
        await self.db.execute(
            "INSERT INTO ws_guesses (guess, game_id, chat_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (guess, game_id, chat_id, now, now),
        )
        await self.db.commit()

    async def get_guesses(self, game_id: int) -> List[Dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM ws_guesses WHERE game_id = ? ORDER BY created_at ASC, id ASC",
            (game_id,),
        )
        return [dict(r) for r in await cursor.fetchall()]

    async def guess_exists(self, game_id: int, guess: str) -> bool:
        cursor = await self.db.execute(
            "SELECT 1 FROM ws_guesses WHERE game_id = ? AND guess = ? LIMIT 1",
            (game_id, guess),
        )
        return await cursor.fetchone() is not None

    # ── Leaderboard ────────────────────────────

    async def add_score(self, user_id: str, chat_id: str, score: int, word_length: str) -> None:
        now = _now()
        await self.db.execute(
            "INSERT INTO ws_leaderboard (user_id, chat_id, score, word_length, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, chat_id, score, word_length, now, now),
        )
        await self.db.commit()

    async def get_leaderboard_scores(
        self,
        chat_id: str,
        search_key: str,
        time_key: str,
        word_length: int = 5,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        where = ["l.word_length = ?"]
        params: List[Any] = [str(word_length)]
        if search_key == "group":
            where.append("l.chat_id = ?")
            params.append(chat_id)
        cutoff = _period_cutoff(time_key)
        if cutoff:
            where.append("l.created_at >= ?")
            params.append(cutoff)
        params.append(limit)
        query = f"""
            SELECT u.id AS user_id, u.name, u.username, CAST(SUM(l.score) AS INTEGER) AS total_score
            FROM ws_leaderboard l
            JOIN ws_users u ON u.id = l.user_id
            WHERE {' AND '.join(where)}
              AND NOT EXISTS (SELECT 1 FROM gbanned_users b WHERE b.user_id = l.user_id)
            GROUP BY u.id
            ORDER BY SUM(l.score) DESC
            LIMIT ?
        """
        cursor = await self.db.execute(query, params)
        return [dict(r) for r in await cursor.fetchall()]

    async def get_user_score(
        self,
        user_id: str,
        chat_id: str,
        search_key: str,
        time_key: str,
        word_length: int = 5,
    ) -> Optional[Dict[str, Any]]:
        where = ["l.word_length = ?"]
        params: List[Any] = [str(word_length)]
        if search_key == "group":
            where.append("l.chat_id = ?")
            params.append(chat_id)
        cutoff = _period_cutoff(time_key)
        if cutoff:
            where.append("l.created_at >= ?")
            params.append(cutoff)
        query = f"""
            SELECT u.id, u.name, u.username,
                   CAST(SUM(l.score) AS INTEGER) AS total_score,
                   s.current_streak, s.highest_streak
            FROM ws_leaderboard l
            JOIN ws_users u ON u.id = l.user_id
            LEFT JOIN ws_user_stats s ON s.user_id = u.id
            WHERE {' AND '.join(where)} AND l.user_id = ?
              AND NOT EXISTS (SELECT 1 FROM gbanned_users b WHERE b.user_id = l.user_id)
            GROUP BY u.id
        """
        cursor = await self.db.execute(query, [*params, user_id])
        row = await cursor.fetchone()
        if not row:
            return None
        result = dict(row)
        # Rank via window function over the same filter
        rank_query = f"""
            SELECT user_id, RANK() OVER (ORDER BY SUM(score) DESC) AS rank
            FROM ws_leaderboard l
            WHERE {' AND '.join(where)}
              AND NOT EXISTS (SELECT 1 FROM gbanned_users b WHERE b.user_id = l.user_id)
            GROUP BY user_id
        """
        cursor = await self.db.execute(rank_query, params)
        for r in await cursor.fetchall():
            if r["user_id"] == user_id:
                result["rank"] = int(r["rank"])
                break
        else:
            result["rank"] = 0
        return result

    async def has_any_scores(self, user_id: str, chat_id: Optional[str] = None, word_length: Optional[int] = None) -> bool:
        where = ["user_id = ?"]
        params: List[Any] = [user_id]
        if chat_id is not None:
            where.append("chat_id = ?")
            params.append(chat_id)
        if word_length is not None:
            where.append("word_length = ?")
            params.append(str(word_length))
        cursor = await self.db.execute(
            f"SELECT 1 FROM ws_leaderboard WHERE {' AND '.join(where)} LIMIT 1", params
        )
        return await cursor.fetchone() is not None

    async def user_exists_for_length(self, user_id: str, word_length: int, chat_id: Optional[str] = None) -> bool:
        where = ["user_id = ?", "word_length = ?"]
        params: List[Any] = [user_id, str(word_length)]
        if chat_id is not None:
            where.append("chat_id = ?")
            params.append(chat_id)
        cursor = await self.db.execute(
            f"SELECT 1 FROM ws_leaderboard WHERE {' AND '.join(where)} LIMIT 1", params
        )
        return await cursor.fetchone() is not None

    async def latest_score_date(self, user_id: str, word_length: int, chat_id: Optional[str] = None) -> Optional[str]:
        where = ["user_id = ?", "word_length = ?"]
        params: List[Any] = [user_id, str(word_length)]
        if chat_id is not None:
            where.append("chat_id = ?")
            params.append(chat_id)
        cursor = await self.db.execute(
            f"SELECT created_at FROM ws_leaderboard WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT 1",
            params,
        )
        row = await cursor.fetchone()
        return row["created_at"] if row else None

    async def transfer_leaderboard(self, from_user: str, to_user: str) -> int:
        cursor = await self.db.execute(
            "UPDATE ws_leaderboard SET user_id = ?, updated_at = ? WHERE user_id = ?",
            (to_user, _now(), from_user),
        )
        await self.db.execute(
            "UPDATE ws_user_stats SET user_id = ? WHERE user_id = ?",
            (to_user, from_user),
        )
        await self.db.commit()
        return cursor.rowcount

    async def leaderboard_entries(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM ws_leaderboard WHERE user_id = ?", (user_id,))
        return [dict(r) for r in await cursor.fetchall()]

    # ── Daily WordSeek ─────────────────────────

    async def ensure_user_stats(self, user_id: str) -> None:
        now = _now()
        await self.db.execute(
            """INSERT INTO ws_user_stats (user_id, created_at, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO NOTHING""",
            (user_id, now, now),
        )
        await self.db.commit()

    async def get_user_stats(self, user_id: str) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM ws_user_stats WHERE user_id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_daily_word_by_date(self, date_str: str) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM ws_daily_words WHERE date = ?", (date_str,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def insert_daily_word(
        self,
        day_number: int,
        word: str,
        date_str: str,
        meaning: Optional[str] = None,
        phonetic: Optional[str] = None,
        sentence: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = _now()
        cursor = await self.db.execute(
            """INSERT INTO ws_daily_words (day_number, word, date, meaning, phonetic, sentence, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(date) DO NOTHING""",
            (day_number, word, date_str, meaning, phonetic, sentence, now, now),
        )
        await self.db.commit()
        existing = await self.get_daily_word_by_date(date_str)
        return existing or {"id": cursor.lastrowid, "day_number": day_number, "word": word, "date": date_str,
                            "meaning": meaning, "phonetic": phonetic, "sentence": sentence}

    async def get_daily_guesses(self, user_id: str, daily_word_id: int) -> List[Dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM ws_daily_guesses WHERE user_id = ? AND daily_word_id = ? ORDER BY attempt_number ASC",
            (user_id, daily_word_id),
        )
        return [dict(r) for r in await cursor.fetchall()]

    async def add_daily_guess(self, user_id: str, daily_word_id: int, guess: str, attempt_number: int) -> None:
        now = _now()
        await self.db.execute(
            "INSERT INTO ws_daily_guesses (user_id, daily_word_id, guess, attempt_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, daily_word_id, guess, attempt_number, now, now),
        )
        await self.db.commit()

    async def update_streaks(self, user_id: str, current_streak: int, highest_streak: int) -> None:
        now = _now()
        await self.db.execute(
            """UPDATE ws_user_stats SET current_streak = ?, highest_streak = ?, last_guessed = ?, updated_at = ?
               WHERE user_id = ?""",
            (current_streak, highest_streak, now, now, user_id),
        )
        await self.db.commit()

    async def reset_streak(self, user_id: str) -> None:
        now = _now()
        await self.db.execute(
            "UPDATE ws_user_stats SET current_streak = 0, last_guessed = ?, updated_at = ? WHERE user_id = ?",
            (now, now, user_id),
        )
        await self.db.commit()

    async def reset_inactive_streaks(self, before_iso: str) -> int:
        cursor = await self.db.execute(
            """UPDATE ws_user_stats SET current_streak = 0, updated_at = ?
               WHERE current_streak > 0 AND (last_guessed IS NULL OR last_guessed < ?)""",
            (_now(), before_iso),
        )
        await self.db.commit()
        return cursor.rowcount

    # ── Authorized users (seekauth) ────────────

    async def is_authorized(self, user_id: str, chat_id: str) -> bool:
        cursor = await self.db.execute(
            "SELECT 1 FROM ws_authorized_users WHERE chat_id = ? AND user_id = ? LIMIT 1",
            (chat_id, user_id),
        )
        return await cursor.fetchone() is not None

    async def authorize_user(self, chat_id: str, user_id: str, authorized_by: str) -> bool:
        if await self.is_authorized(user_id, chat_id):
            return False
        await self.db.execute(
            "INSERT INTO ws_authorized_users (chat_id, user_id, authorized_by, created_at) VALUES (?, ?, ?, ?)",
            (chat_id, user_id, authorized_by, _now()),
        )
        await self.db.commit()
        return True

    async def deauthorize_user(self, chat_id: str, user_id: str) -> bool:
        cursor = await self.db.execute(
            "DELETE FROM ws_authorized_users WHERE chat_id = ? AND user_id = ?",
            (chat_id, user_id),
        )
        await self.db.commit()
        return cursor.rowcount > 0

    async def list_authorized(self, chat_id: str) -> List[Dict[str, Any]]:
        cursor = await self.db.execute(
            """SELECT u.id, u.name, u.username FROM ws_authorized_users a
               JOIN ws_users u ON u.id = a.user_id WHERE a.chat_id = ?""",
            (chat_id,),
        )
        return [dict(r) for r in await cursor.fetchall()]

    # ── Game topics ────────────────────────────

    async def set_game_topic(self, chat_id: str, topic_id: str) -> bool:
        cursor = await self.db.execute(
            "SELECT 1 FROM ws_chat_game_topics WHERE chat_id = ? AND topic_id = ?",
            (chat_id, topic_id),
        )
        if await cursor.fetchone():
            return False
        now = _now()
        await self.db.execute(
            "INSERT INTO ws_chat_game_topics (chat_id, topic_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (chat_id, topic_id, now, now),
        )
        await self.db.commit()
        return True

    async def unset_game_topic(self, chat_id: str, topic_id: str) -> None:
        await self.db.execute(
            "DELETE FROM ws_chat_game_topics WHERE chat_id = ? AND topic_id = ?",
            (chat_id, topic_id),
        )
        await self.db.commit()

    async def get_chat_topics(self, chat_id: str) -> List[Dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM ws_chat_game_topics WHERE chat_id = ?", (chat_id,)
        )
        return [dict(r) for r in await cursor.fetchall()]

    async def get_topic(self, chat_id: str, topic_id: str) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM ws_chat_game_topics WHERE chat_id = ? AND topic_id = ?",
            (chat_id, topic_id),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def update_topic_lengths(self, chat_id: str, topic_id: str, lengths: List[int]) -> None:
        await self.db.execute(
            "UPDATE ws_chat_game_topics SET allowed_lengths = ?, updated_at = ? WHERE chat_id = ? AND topic_id = ?",
            (",".join(str(x) for x in lengths), _now(), chat_id, topic_id),
        )
        await self.db.commit()

    async def update_topic_meta(
        self,
        chat_id: str,
        topic_id: str,
        name: Optional[str] = None,
        icon_custom_emoji_id: Optional[str] = None,
        should_recreate: Optional[bool] = None,
        allowed_lengths: Optional[str] = None,
    ) -> None:
        sets, params = [], []
        if name is not None:
            sets.append("name = ?")
            params.append(name)
        if icon_custom_emoji_id is not None:
            sets.append("icon_custom_emoji_id = ?")
            params.append(icon_custom_emoji_id)
        if should_recreate is not None:
            sets.append("should_recreate_on_expire = ?")
            params.append(1 if should_recreate else 0)
        if allowed_lengths is not None:
            sets.append("allowed_lengths = ?")
            params.append(allowed_lengths)
        if not sets:
            return
        sets.append("updated_at = ?")
        params.append(_now())
        params.extend([chat_id, topic_id])
        await self.db.execute(
            f"UPDATE ws_chat_game_topics SET {', '.join(sets)} WHERE chat_id = ? AND topic_id = ?",
            params,
        )
        await self.db.commit()

    async def replace_topic_id(self, chat_id: str, old_topic_id: str, new_topic_id: str,
                               name: Optional[str], icon: Optional[str], allowed_lengths: str) -> None:
        await self.db.execute(
            """INSERT INTO ws_chat_game_topics (chat_id, topic_id, name, icon_custom_emoji_id, should_recreate_on_expire, allowed_lengths, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, ?, ?, ?)""",
            (chat_id, new_topic_id, name, icon, allowed_lengths, _now(), _now()),
        )
        await self.db.execute(
            "DELETE FROM ws_chat_game_topics WHERE chat_id = ? AND topic_id = ?",
            (chat_id, old_topic_id),
        )
        await self.db.commit()

    # ── Tracking ───────────────────────────────

    async def set_tracking(self, chat_id: str, admin_chat_id: str) -> bool:
        if await self.get_tracking(chat_id):
            return False
        await self.db.execute(
            "INSERT INTO ws_tracking (chat_id, admin_chat_id, created_at) VALUES (?, ?, ?)",
            (chat_id, admin_chat_id, _now()),
        )
        await self.db.commit()
        return True

    async def get_tracking(self, chat_id: str) -> Optional[str]:
        cursor = await self.db.execute(
            "SELECT admin_chat_id FROM ws_tracking WHERE chat_id = ?", (chat_id,)
        )
        row = await cursor.fetchone()
        return row["admin_chat_id"] if row else None

    async def remove_tracking(self, chat_id: str) -> bool:
        cursor = await self.db.execute("DELETE FROM ws_tracking WHERE chat_id = ?", (chat_id,))
        await self.db.commit()
        return cursor.rowcount > 0

    async def list_tracking(self) -> List[str]:
        cursor = await self.db.execute("SELECT chat_id FROM ws_tracking")
        return [r["chat_id"] for r in await cursor.fetchall()]

    # ── Broadcast state ────────────────────────

    async def save_broadcast_state(self, state: Dict[str, Any]) -> None:
        await self.db.execute(
            "INSERT INTO ws_broadcast_state (id, state, updated_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
            (json.dumps(state), _now()),
        )
        await self.db.commit()

    async def load_broadcast_state(self) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT state FROM ws_broadcast_state WHERE id = 1")
        row = await cursor.fetchone()
        if not row:
            return None
        try:
            return json.loads(row["state"])
        except (ValueError, TypeError):
            return None

    async def clear_broadcast_state(self) -> None:
        await self.db.execute("DELETE FROM ws_broadcast_state WHERE id = 1")
        await self.db.commit()

    # ── Word history (repeat avoidance) ────────

    async def get_word_history(self, chat_id: str, word_length: int) -> List[str]:
        cutoff = datetime.now(timezone.utc).timestamp() - 7 * 24 * 3600
        cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
        cursor = await self.db.execute(
            "SELECT word FROM ws_word_history WHERE chat_id = ? AND word_length = ? AND used_at >= ?",
            (chat_id, word_length, cutoff_iso),
        )
        return [r["word"] for r in await cursor.fetchall()]

    async def add_word_history(self, chat_id: str, word_length: int, word: str, keep_last: int = 50) -> None:
        now = _now()
        await self.db.execute(
            "INSERT OR IGNORE INTO ws_word_history (chat_id, word_length, word, used_at) VALUES (?, ?, ?, ?)",
            (chat_id, word_length, word, now),
        )
        # Trim to the newest `keep_last` entries per (chat, length)
        await self.db.execute(
            """DELETE FROM ws_word_history
               WHERE chat_id = ? AND word_length = ?
                 AND id NOT IN (
                    SELECT id FROM ws_word_history WHERE chat_id = ? AND word_length = ?
                    ORDER BY used_at DESC, id DESC LIMIT ?
                 )""",
            (chat_id, word_length, chat_id, word_length, keep_last),
        )
        await self.db.commit()

    async def trim_word_history_keep(self, chat_id: str, word_length: int, keep: List[str]) -> None:
        """Reset history down to a small keep-set (when the pool is nearly exhausted)."""
        await self.db.execute(
            "DELETE FROM ws_word_history WHERE chat_id = ? AND word_length = ?",
            (chat_id, word_length),
        )
        now = _now()
        for word in keep:
            await self.db.execute(
                "INSERT OR IGNORE INTO ws_word_history (chat_id, word_length, word, used_at) VALUES (?, ?, ?, ?)",
                (chat_id, word_length, word, now),
            )
        await self.db.commit()

    # ── Stats helpers ──────────────────────────

    async def count_users(self) -> int:
        cursor = await self.db.execute("SELECT COUNT(*) AS c FROM ws_users")
        row = await cursor.fetchone()
        return int(row["c"]) if row else 0

    async def count_leaderboard_groups(self) -> int:
        cursor = await self.db.execute(
            "SELECT COUNT(DISTINCT chat_id) AS c FROM ws_leaderboard WHERE chat_id LIKE '-1%'"
        )
        row = await cursor.fetchone()
        return int(row["c"]) if row else 0

    async def count_leaderboard_players(self) -> int:
        cursor = await self.db.execute(
            "SELECT COUNT(DISTINCT chat_id) AS c FROM ws_leaderboard WHERE chat_id NOT LIKE '-1%'"
        )
        row = await cursor.fetchone()
        return int(row["c"]) if row else 0


def _period_cutoff(time_key: str) -> Optional[str]:
    """ISO cutoff for period filters (matches WordSeek's date_trunc semantics)."""
    now = datetime.now(timezone.utc)
    if time_key == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start.isoformat()
    if time_key == "week":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start = start.fromtimestamp(start.timestamp() - now.weekday() * 86400, tz=timezone.utc)
        return start.isoformat()
    if time_key == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return start.isoformat()
    if time_key == "year":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        return start.isoformat()
    return None
