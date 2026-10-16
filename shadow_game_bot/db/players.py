"""Player database operations."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiosqlite

logger = logging.getLogger(__name__)


class PlayersCollection:
    def __init__(self, db: aiosqlite.Connection):
        self.db = db

    async def add_or_update_player(self, game_id: int, user_id: int, display_name: str, username: str = None) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            """INSERT INTO game_players (game_id, user_id, display_name, username, score, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0, ?, ?)
               ON CONFLICT(game_id, user_id)
               DO UPDATE SET display_name = excluded.display_name, username = excluded.username, updated_at = excluded.updated_at""",
            (game_id, user_id, display_name, username, now, now),
        )
        await self.db.commit()
        cursor = await self.db.execute("SELECT * FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
        row = await cursor.fetchone()
        return dict(row) if row else {}

    async def increment_score(self, game_id: int, user_id: int) -> int:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute("UPDATE game_players SET score = score + 1, updated_at = ? WHERE game_id = ? AND user_id = ?", (now, game_id, user_id))
        await self.db.commit()
        cursor = await self.db.execute("SELECT score FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
        row = await cursor.fetchone()
        return row["score"] if row else 0

    async def increment_words_guessed(self, game_id: int, user_id: int) -> int:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute("UPDATE game_players SET words_guessed = words_guessed + 1, updated_at = ? WHERE game_id = ? AND user_id = ?", (now, game_id, user_id))
        await self.db.commit()
        cursor = await self.db.execute("SELECT words_guessed FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
        row = await cursor.fetchone()
        return row["words_guessed"] if row else 0

    async def get_player(self, game_id: int, user_id: int) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_leaderboard(self, game_id: int, limit: int = 10) -> List[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM game_players WHERE game_id = ? ORDER BY score DESC LIMIT ?", (game_id, limit))
        return [dict(r) for r in await cursor.fetchall()]

    async def get_global_top_players(self, limit: int = 25) -> List[Dict[str, Any]]:
        cursor = await self.db.execute(
            """SELECT user_id, display_name, username, SUM(score) as total_score, SUM(words_guessed) as total_words_guessed
               FROM game_players GROUP BY user_id ORDER BY total_score DESC LIMIT ?""",
            (limit,),
        )
        return [dict(r) for r in await cursor.fetchall()]

    async def get_user_global_stats(self, user_id: int) -> Dict[str, Any]:
        cursor = await self.db.execute(
            """SELECT user_id, display_name, username, SUM(score) as total_xeons,
                      SUM(words_guessed) as total_words_guessed, COUNT(DISTINCT game_id) as games_played
               FROM game_players WHERE user_id = ?""",
            (user_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else {}

    async def get_user_top_chat(self, user_id: int) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute(
            """SELECT g.chat_id, g.chat_name, SUM(gp.words_guessed) as words_guessed, SUM(gp.score) as xeons
               FROM game_players gp JOIN games g ON gp.game_id = g.id
               WHERE gp.user_id = ? GROUP BY g.chat_id ORDER BY words_guessed DESC LIMIT 1""",
            (user_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
