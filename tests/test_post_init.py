"""Integration test: run on_startup/on_shutdown against a disposable copy.

Creates a temp copy of MergedBot (so the real workspace DB is untouched),
then boots the aiogram application lifecycle and asserts:

  - app context wiring (db, ws_db, engine, dm_actions, bot, bot_username)
  - dispatcher builds and resolves the expected update types
  - shadow word pool seeded
  - today's daily word generated
  - command menu handed to Telegram (via mocked Bot)
  - background tasks cancelled + DB closed on shutdown

Run:  python tests\test_post_init.py
"""

import asyncio
import os
import shutil
import sys
import tempfile
from unittest.mock import AsyncMock, patch


def main() -> int:
    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tmp = tempfile.mkdtemp(prefix="mergedbot_test_")
    try:
        shutil.copytree(
            src, tmp,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "tests"),
            dirs_exist_ok=True,
        )
        sys.path.insert(0, tmp)
        os.environ.setdefault("BOT_TOKEN", "123456:TEST-TOKEN")
        os.environ.setdefault("OWNER_ID", "1")
        os.environ.pop("GEMINI_API_KEYS", None)  # ensure offline path

        from aiogram import Bot
        from aiogram.client.session.aiohttp import AiohttpSession
        from aiogram.types import User
        from shadow_game_bot.bot import (
            on_startup, on_shutdown, build_dispatcher, BOT_COMMANDS,
        )
        from shadow_game_bot.context import app
        from shadow_game_bot.db import WordsCollection, close_database
        from shadow_game_bot.services.daily_word import get_current_game_date_string

        async def run() -> None:
            # ── Dispatcher construction (no network) ────────────────
            dp = build_dispatcher()
            used = set(dp.resolve_used_update_types())
            assert {"message", "callback_query", "chat_member", "my_chat_member"} <= used, \
                f"dispatcher missing update types: {used}"

            # ── Startup (network calls mocked: me + set_my_commands) ─
            bot = Bot(token=os.environ["BOT_TOKEN"], session=AiohttpSession(timeout=10))
            fake_me = User(id=123456, is_bot=True, first_name="TestBot",
                           username="testbot_merged")
            mock_me = AsyncMock(return_value=fake_me)
            mock_cmds = AsyncMock(return_value=True)
            with patch.object(Bot, "me", mock_me), \
                    patch.object(Bot, "set_my_commands", mock_cmds):
                await on_startup(bot)

            for key in ("db", "ws_db", "engine", "dm_actions"):
                assert getattr(app, key) is not None, f"app.{key} missing"
            assert app.bot is bot, "app.bot not wired"
            assert app.bot_username == "testbot_merged", "bot username not cached"

            # command menu pushed once, with every declared command
            assert mock_cmds.await_count == 1, "set_my_commands not called"
            pushed = mock_cmds.await_args.args[0]
            assert len(pushed) == len(BOT_COMMANDS), \
                f"expected {len(BOT_COMMANDS)} commands, got {len(pushed)}"

            words = WordsCollection(app.db)
            count = await words.word_count()
            assert count > 0, "shadow word pool not seeded"

            ws_db = app.ws_db
            today = get_current_game_date_string()
            daily = await ws_db.get_daily_word_by_date(today)
            assert daily, f"daily word missing for {today}"
            assert daily.get("word"), "daily word row has no word"

            # ws stats counters respond
            assert isinstance(await ws_db.count_users(), int)
            assert isinstance(await ws_db.count_leaderboard_groups(), int)

            # broadcast state must be empty (no resume attempted)
            assert await ws_db.load_broadcast_state() is None

            print(f"  update types : {sorted(used)}")
            print(f"  words seeded : {count}")
            print(f"  daily word   : {daily['word']!r} ({today})")
            print(f"  dm pending   : {len(app.dm_actions)}")
            print(f"  bot commands : {len(BOT_COMMANDS)}")

            await on_shutdown()

            # tasks cancelled
            from shadow_game_bot.bot import _BACKGROUND_TASKS
            assert not _BACKGROUND_TASKS, "background tasks not cleared"

        asyncio.run(run())

        # DB file created in the temp copy, not the workspace
        assert os.path.isdir(tmp)
        print("PASS on_startup/on_shutdown integration (temp copy)")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
