"""Configuration from environment / .env file.

Keeps the ShadowgameBot environment (BOT_TOKEN, OWNER_ID, LOG_GROUP_ID, ...)
and adds optional WordSeek variables (TIME_ZONE, DAILY_WORDLE_SECRET, ...).
"""

import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import List

from dotenv import load_dotenv

_PKG_DIR = Path(__file__).parent
_ROOT_DIR = _PKG_DIR.parent

# ShadowgameBot loaded .env from the package dir; also accept the project root.
load_dotenv(_PKG_DIR / ".env")
load_dotenv(_ROOT_DIR / ".env")


def _parse_int(value: str, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _split_keys(value: str) -> List[str]:
    """Gemini keys: accept space- or comma-separated lists."""
    parts = [p for chunk in value.split(",") for p in chunk.split()]
    return [p for p in parts if p]


@dataclass(frozen=True)
class Config:
    # ── ShadowgameBot env (kept exactly) ───────
    bot_token: str = ""
    database_name: str = "shadow_game"
    inactivity_timeout: int = 300
    log_level: str = "INFO"
    owner_id: int = 0
    log_group_id: int = -1003884436085

    # ── Deployment ─────────────────────────────
    #: Directory for the SQLite db. Set DATABASE_DIR to a mounted
    #: volume on Railway so game/wordseek state survives redeploys.
    database_dir: str = ""
    #: Directory for the bundled word-list JSONs (data/).
    data_dir: str = ""

    # ── WordSeek env (optional) ────────────────
    time_zone: str = "Asia/Calcutta"
    daily_wordle_secret: str = "shadow-wordseek-default-secret"
    daily_wordle_start_date: date = field(default_factory=lambda: date(2025, 1, 1))
    gemini_api_keys: List[str] = field(default_factory=list)
    logs_channel: int = 0  # 0 = fall back to log_group_id
    admin_users: List[int] = field(default_factory=list)

    @classmethod
    def from_env(cls) -> "Config":
        start_raw = os.getenv("DAILY_WORDLE_START_DATE", "2025-01-01").strip()
        try:
            start_date = date.fromisoformat(start_raw)
        except ValueError:
            start_date = date(2025, 1, 1)

        admins = []
        for part in os.getenv("ADMIN_USERS", "").replace(",", " ").split():
            uid = _parse_int(part, 0)
            if uid:
                admins.append(uid)

        owner = _parse_int(os.getenv("OWNER_ID", "0"), 0)
        if owner and owner not in admins:
            admins.append(owner)

        logs_channel = _parse_int(os.getenv("LOGS_CHANNEL", "0"), 0)

        return cls(
            bot_token=os.getenv("BOT_TOKEN", ""),
            database_name=os.getenv("DATABASE_NAME", "shadow_game"),
            inactivity_timeout=_parse_int(os.getenv("INACTIVITY_TIMEOUT", "300"), 300),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            owner_id=owner,
            log_group_id=_parse_int(os.getenv("LOG_GROUP_ID", "-1003884436085"), -1003884436085),
            database_dir=os.getenv("DATABASE_DIR", "").strip(),
            data_dir=os.getenv("DATA_DIR", "").strip(),
            time_zone=os.getenv("TIME_ZONE", "Asia/Calcutta").strip() or "Asia/Calcutta",
            daily_wordle_secret=os.getenv("DAILY_WORDLE_SECRET", "shadow-wordseek-default-secret").strip()
            or "shadow-wordseek-default-secret",
            daily_wordle_start_date=start_date,
            gemini_api_keys=_split_keys(os.getenv("GEMINI_API_KEYS", "")),
            logs_channel=logs_channel,
            admin_users=admins,
        )

    # ── Helpers ────────────────────────────────

    @property
    def db_path(self) -> Path:
        """Absolute path to the SQLite database file.

        Honours DATABASE_DIR (e.g. a Railway volume mount) so state
        survives redeploys; otherwise falls back to the project root.
        """
        directory = Path(self.database_dir) if self.database_dir else _ROOT_DIR
        return directory / f"{self.database_name}.db"

    @property
    def data_path(self) -> Path:
        """Directory holding the bundled word-list JSONs (data/)."""
        return Path(self.data_dir) if self.data_dir else _ROOT_DIR / "data"

    @property
    def alert_targets(self) -> List[int]:
        """Where anti-cheat / event alerts should go."""
        if self.logs_channel:
            return [self.logs_channel]
        if self.admin_users:
            return list(self.admin_users)
        if self.log_group_id:
            return [self.log_group_id]
        return []

    def is_admin(self, user_id: int) -> bool:
        """Owner or any explicitly configured admin."""
        return user_id == self.owner_id or user_id in self.admin_users

    def is_owner(self, user_id: int) -> bool:
        return user_id == self.owner_id

    def validate(self) -> None:
        if not self.bot_token:
            raise ValueError("BOT_TOKEN is required.")


config = Config.from_env()
