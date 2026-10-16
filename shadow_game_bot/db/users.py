"""User tracking: DM starts and gban checks."""

import logging
from datetime import datetime, timezone

import aiosqlite

logger = logging.getLogger(__name__)


class UserCollection:
    def __init__(self, db: aiosqlite.Connection):
        self.db = db

    async def record_dm_start(self, user_id: int) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            "INSERT INTO user_started_bot (user_id, started_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET started_at = excluded.started_at",
            (user_id, now),
        )
        await self.db.commit()

    async def has_started_bot(self, user_id: int) -> bool:
        cursor = await self.db.execute("SELECT 1 FROM user_started_bot WHERE user_id = ?", (user_id,))
        return await cursor.fetchone() is not None

    async def is_gbanned(self, user_id: int) -> bool:
        cursor = await self.db.execute("SELECT 1 FROM gbanned_users WHERE user_id = ?", (user_id,))
        return await cursor.fetchone() is not None
