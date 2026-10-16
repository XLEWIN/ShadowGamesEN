"""SQLite connection, schema, and migrations.

Contains the original ShadowgameBot tables plus the WordSeek tables
(ws_ prefix) ported from the Postgres/Redis WordSeek bot.
"""

import logging
from pathlib import Path
from typing import Optional

import aiosqlite

from shadow_game_bot.config import config

logger = logging.getLogger(__name__)

_db: Optional[aiosqlite.Connection] = None

# Resolve DB path next to run.py (project root), not the process CWD.
_ROOT_DIR = Path(__file__).resolve().parent.parent

SCHEMA = """
-- ═══ ShadowgameBot tables (original) ═══

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    chat_name TEXT DEFAULT NULL,
    category TEXT DEFAULT 'normal',
    game_active INTEGER NOT NULL DEFAULT 1,
    current_leader_id INTEGER,
    current_round_id INTEGER,
    leader_message_id INTEGER,
    leader_selection_message_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    word TEXT NOT NULL,
    leader_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    winner_id INTEGER,
    FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    display_name TEXT NOT NULL DEFAULT 'Unknown',
    username TEXT,
    score INTEGER NOT NULL DEFAULT 0,
    words_guessed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(game_id, user_id),
    FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    normalized TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    category TEXT,
    difficulty TEXT,
    language TEXT DEFAULT 'en',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS used_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    word_normalized TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(game_id, word_normalized),
    FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS dm_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_chat_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    game_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_started_bot (
    user_id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gbanned_users (
    user_id INTEGER PRIMARY KEY,
    banned_at TEXT NOT NULL DEFAULT (datetime('now')),
    reason TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_chat_active ON games(chat_id, game_active);
CREATE INDEX IF NOT EXISTS idx_rounds_game_status ON rounds(game_id, status);
CREATE INDEX IF NOT EXISTS idx_players_game ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_players_game_score ON game_players(game_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_players_user ON game_players(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_actions_user ON dm_actions(user_id);

-- ═══ WordSeek tables (ported) ═══

CREATE TABLE IF NOT EXISTS ws_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ws_leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    word_length TEXT NOT NULL DEFAULT '5',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES ws_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ws_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    active_chat TEXT NOT NULL,
    topic_id TEXT NOT NULL DEFAULT 'general',
    started_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_games_chat_topic ON ws_games(active_chat, topic_id);

CREATE TABLE IF NOT EXISTS ws_guesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guess TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    chat_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (game_id) REFERENCES ws_games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ws_guesses_game ON ws_guesses(game_id);

CREATE TABLE IF NOT EXISTS ws_authorized_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    user_id TEXT,
    authorized_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS ws_chat_game_topics (
    chat_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    name TEXT,
    icon_custom_emoji_id TEXT,
    should_recreate_on_expire INTEGER NOT NULL DEFAULT 0,
    allowed_lengths TEXT NOT NULL DEFAULT '5,4,6',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chat_id, topic_id)
);

CREATE TABLE IF NOT EXISTS ws_broadcast_chats (
    id TEXT PRIMARY KEY,
    name TEXT,
    username TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ws_user_stats (
    user_id TEXT PRIMARY KEY,
    highest_streak INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0,
    last_guessed TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES ws_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ws_daily_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number INTEGER NOT NULL UNIQUE,
    word TEXT NOT NULL,
    date TEXT NOT NULL UNIQUE,
    meaning TEXT,
    phonetic TEXT,
    sentence TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ws_daily_guesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    daily_word_id INTEGER NOT NULL,
    guess TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES ws_users(id) ON DELETE CASCADE,
    FOREIGN KEY (daily_word_id) REFERENCES ws_daily_words(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ws_daily_guesses_user ON ws_daily_guesses(user_id, daily_word_id);

-- Word-repeat avoidance history (was Redis set h:{chat}:{len})
CREATE TABLE IF NOT EXISTS ws_word_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    word_length INTEGER NOT NULL,
    word TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(chat_id, word_length, word)
);

CREATE INDEX IF NOT EXISTS idx_ws_word_history_chat ON ws_word_history(chat_id, word_length);

-- Durable broadcast state (was Redis broadcast:state)
CREATE TABLE IF NOT EXISTS ws_broadcast_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Persistent chat tracking (was Redis tracking:{chatId})
CREATE TABLE IF NOT EXISTS ws_tracking (
    chat_id TEXT PRIMARY KEY,
    admin_chat_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for score filters
CREATE INDEX IF NOT EXISTS idx_ws_leaderboard_user ON ws_leaderboard(user_id);
CREATE INDEX IF NOT EXISTS idx_ws_leaderboard_chat ON ws_leaderboard(chat_id);
CREATE INDEX IF NOT EXISTS idx_ws_leaderboard_len ON ws_leaderboard(word_length);

-- ═══ UNO (mau mau) statistics — replaces Pony ORM user_setting ═══

CREATE TABLE IF NOT EXISTS uno_stats (
    user_id INTEGER PRIMARY KEY,
    games_played INTEGER NOT NULL DEFAULT 0,
    first_places INTEGER NOT NULL DEFAULT 0,
    cards_played INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


async def get_database() -> aiosqlite.Connection:
    """Get or create the SQLite database connection."""
    global _db
    if _db is not None:
        return _db

    # config.db_path honours DATABASE_DIR (Railway volume) so the db
    # survives redeploys; otherwise it falls back to the project root.
    db_path = str(config.db_path)
    config.db_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Connecting to SQLite at %s ...", db_path)

    _db = await aiosqlite.connect(db_path)
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA journal_mode=WAL")
    await _db.execute("PRAGMA foreign_keys=ON")
    await _db.executescript(SCHEMA)
    await _db.commit()
    await _migrate(_db)

    logger.info("SQLite database ready.")
    return _db


async def _migrate(db: aiosqlite.Connection) -> None:
    """Add missing columns for backward compatibility."""
    for table, column, definition in [
        ("games", "chat_name", "TEXT DEFAULT NULL"),
        ("games", "category", "TEXT DEFAULT 'normal'"),
        ("game_players", "words_guessed", "INTEGER NOT NULL DEFAULT 0"),
    ]:
        try:
            await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            await db.commit()
            logger.info("Migration: added %s.%s", table, column)
        except Exception:
            pass


async def close_database() -> None:
    """Close the SQLite connection."""
    global _db
    if _db:
        await _db.close()
        logger.info("SQLite connection closed.")
    _db = None
