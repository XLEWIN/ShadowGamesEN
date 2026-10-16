"""UNO statistics collection (aiosqlite, replaces mau_mau_bot Pony ORM).

Table ``uno_stats`` (see db/connection.py SCHEMA):
    user_id INTEGER PRIMARY KEY
    games_played INTEGER
    first_places INTEGER
    cards_played INTEGER

Stats are always tracked; /unostats displays them.  The original bot
required an opt-in flag in UserSetting — simplified here.
"""

from __future__ import annotations

import logging
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)


class UnoStatsCollection:
    """CRUD for the uno_stats table."""

    def __init__(self, db: aiosqlite.Connection):
        self.db = db

    async def get(self, user_id: int) -> Optional[dict]:
        """Return the stats row for a user, or None."""
        cursor = await self.db.execute(
            "SELECT user_id, games_played, first_places, cards_played "
            "FROM uno_stats WHERE user_id = ?",
            (user_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "user_id": row["user_id"],
            "games_played": row["games_played"],
            "first_places": row["first_places"],
            "cards_played": row["cards_played"],
        }

    async def _ensure_row(self, user_id: int) -> None:
        await self.db.execute(
            "INSERT OR IGNORE INTO uno_stats "
            "(user_id, games_played, first_places, cards_played) "
            "VALUES (?, 0, 0, 0)",
            (user_id,),
        )

    async def add_cards_played(self, user_id: int, n: int = 1) -> None:
        """Increment cards_played (called on every successful card play)."""
        await self._ensure_row(user_id)
        await self.db.execute(
            "UPDATE uno_stats SET cards_played = cards_played + ? "
            "WHERE user_id = ?",
            (n, user_id),
        )
        await self.db.commit()

    async def add_game(self, user_id: int, first_place: bool = False) -> None:
        """Increment games_played (and first_places when the user won)."""
        await self._ensure_row(user_id)
        if first_place:
            await self.db.execute(
                "UPDATE uno_stats SET games_played = games_played + 1, "
                "first_places = first_places + 1 WHERE user_id = ?",
                (user_id,),
            )
        else:
            await self.db.execute(
                "UPDATE uno_stats SET games_played = games_played + 1 "
                "WHERE user_id = ?",
                (user_id,),
            )
        await self.db.commit()

    async def reset(self, user_id: int) -> None:
        """Zero out a user's stats (or insert a fresh zero row)."""
        await self.db.execute(
            "INSERT INTO uno_stats "
            "(user_id, games_played, first_places, cards_played) "
            "VALUES (?, 0, 0, 0) "
            "ON CONFLICT(user_id) DO UPDATE SET "
            "games_played = 0, first_places = 0, cards_played = 0",
            (user_id,),
        )
        await self.db.commit()
