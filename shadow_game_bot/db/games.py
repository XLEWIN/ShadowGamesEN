"""Games and rounds database operations."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiosqlite

logger = logging.getLogger(__name__)


class GamesCollection:
    def __init__(self, db: aiosqlite.Connection):
        self.db = db

    # ── Game CRUD ──────────────────────────────

    async def create_game(self, chat_id: int, creator_id: int, chat_name: str = None, category: str = "normal") -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await self.db.execute(
            "INSERT INTO games (chat_id, chat_name, category, game_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
            (chat_id, chat_name, category, now, now),
        )
        await self.db.commit()
        return {"id": cursor.lastrowid, "chat_id": chat_id, "chat_name": chat_name, "category": category, "game_active": 1}

    async def get_active_game(self, chat_id: int) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM games WHERE chat_id = ? AND game_active = 1", (chat_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def end_game(self, chat_id: int) -> bool:
        # FIX (merged): capture the active game BEFORE deactivating it,
        # otherwise get_active_game() always returns None and the rounds
        # cleanup below never runs (original bug).
        game = await self.get_active_game(chat_id)
        if not game:
            return False
        now = datetime.now(timezone.utc).isoformat()
        cursor = await self.db.execute(
            "UPDATE games SET game_active = 0, updated_at = ? WHERE id = ? AND game_active = 1",
            (now, game["id"]),
        )
        await self.db.execute(
            "UPDATE rounds SET status = 'ENDED', ended_at = ? WHERE game_id = ? AND status = 'ACTIVE'",
            (now, game["id"]),
        )
        await self.db.commit()
        return cursor.rowcount > 0

    # ── Game State Updates ─────────────────────

    async def set_leader(self, chat_id: int, user_id: Optional[int]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            "UPDATE games SET current_leader_id = ?, updated_at = ? WHERE chat_id = ? AND game_active = 1",
            (user_id, now, chat_id),
        )
        await self.db.commit()

    async def set_round(self, chat_id: int, round_id: Optional[int]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            "UPDATE games SET current_round_id = ?, updated_at = ? WHERE chat_id = ? AND game_active = 1",
            (round_id, now, chat_id),
        )
        await self.db.commit()

    async def set_leader_message_id(self, chat_id: int, message_id: Optional[int]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            "UPDATE games SET leader_message_id = ?, updated_at = ? WHERE chat_id = ? AND game_active = 1",
            (message_id, now, chat_id),
        )
        await self.db.commit()

    async def set_leader_selection_message_id(self, chat_id: int, message_id: Optional[int]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            "UPDATE games SET leader_selection_message_id = ?, updated_at = ? WHERE chat_id = ? AND game_active = 1",
            (message_id, now, chat_id),
        )
        await self.db.commit()

    async def update_activity(self, chat_id: int) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            "UPDATE games SET updated_at = ? WHERE chat_id = ? AND game_active = 1",
            (now, chat_id),
        )
        await self.db.commit()

    async def update_chat_name(self, chat_id: int, chat_name: str) -> None:
        await self.db.execute(
            "UPDATE games SET chat_name = ? WHERE chat_id = ? AND chat_name IS NULL",
            (chat_name, chat_id),
        )
        await self.db.commit()

    # ── Round CRUD ─────────────────────────────

    async def create_round(self, game_id: int, word: str, leader_id: int) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await self.db.execute(
            "INSERT INTO rounds (game_id, word, leader_id, status, started_at) VALUES (?, ?, ?, 'ACTIVE', ?)",
            (game_id, word, leader_id, now),
        )
        await self.db.commit()
        return {"id": cursor.lastrowid, "game_id": game_id, "word": word, "leader_id": leader_id, "status": "ACTIVE"}

    async def get_active_round(self, game_id: int) -> Optional[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM rounds WHERE game_id = ? AND status = 'ACTIVE'", (game_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def end_round_atomic(self, round_id: int, winner_id: Optional[int]) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await self.db.execute(
            "UPDATE rounds SET status = 'ENDED', winner_id = ?, ended_at = ? WHERE id = ? AND status = 'ACTIVE'",
            (winner_id, now, round_id),
        )
        await self.db.commit()
        return cursor.rowcount > 0

    async def get_round_word(self, round_id: int) -> Optional[str]:
        cursor = await self.db.execute("SELECT word FROM rounds WHERE id = ?", (round_id,))
        row = await cursor.fetchone()
        return row["word"] if row else None

    async def reset_leader_selection(self, chat_id: int) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            "UPDATE games SET current_leader_id = NULL, current_round_id = NULL, updated_at = ? WHERE chat_id = ? AND game_active = 1",
            (now, chat_id),
        )
        await self.db.commit()

    # ── Queries ────────────────────────────────

    async def get_inactive_games(self, cutoff_iso: str) -> List[Dict[str, Any]]:
        cursor = await self.db.execute("SELECT * FROM games WHERE game_active = 1 AND updated_at < ?", (cutoff_iso,))
        return [dict(r) for r in await cursor.fetchall()]

    async def get_top_chats(self, limit: int = 10) -> List[Dict[str, Any]]:
        cursor = await self.db.execute(
            """SELECT g.chat_id, g.chat_name, COUNT(DISTINCT gp.user_id) as player_count
               FROM games g
               LEFT JOIN game_players gp ON gp.game_id = g.id
               GROUP BY g.chat_id
               HAVING player_count > 0
               ORDER BY player_count DESC
               LIMIT ?""",
            (limit,),
        )
        return [dict(r) for r in await cursor.fetchall()]
