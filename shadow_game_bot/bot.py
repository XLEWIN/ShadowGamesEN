"""Merged Shadow + WordSeek Bot — aiogram main entry point.

Dispatch model (mirrors the old PTB handler groups):
  • SideEffects middlewares on message / edited_message / callback_query observers
    run BEFORE any filter or handler (old groups 1+2): ws_ table sync,
    anti-cheat alerts, tracked-chat forwards.
  • 10 commands    — all slash commands (both games), registered first
  • 11 callbacks   — sgb:* (Word Guess) and ws:* (WordSeek) buttons
  • 12 private text — Daily WordSeek first, then shadow DM word workflow
  • 13 group text   — WordSeek guess first, then Word Guess guess
  • 14 event log   — bot added/removed notifications, topic renames
  • chat_member / my_chat_member — tracked-chat status forwards
  • errors          — leave on missing send rights, expired-topic recreation
"""

import asyncio
import logging
import sys
from datetime import datetime, timezone, timedelta

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import (
    TelegramBadRequest, TelegramNetworkError, TelegramForbiddenError,
    TelegramRetryAfter,
)
from aiogram.filters import BaseFilter, Command
from aiogram.types import (
    BotCommand, CallbackQuery, ErrorEvent, Message,
)

from shadow_game_bot.config import config
from shadow_game_bot.context import app
from shadow_game_bot.db import (
    get_database, close_database, GamesCollection, WordsCollection,
    PlayersCollection, WordSeekCollection, UnoStatsCollection,
)
from shadow_game_bot.core.engine import GameEngine
from shadow_game_bot.core.state import DMActionType, PendingDMAction
from shadow_game_bot.core.maumau import GameManager
from shadow_game_bot.services.daily_word import daily_wordle_cron_task, ensure_daily_word
from shadow_game_bot.handlers.start import start_handler, start_callback
from shadow_game_bot.handlers.menu import help_callback
from shadow_game_bot.handlers.callbacks import callback_handler
from shadow_game_bot.handlers.messages import message_handler
from shadow_game_bot.handlers.private import private_message_handler  # noqa: F401 (used via ws_messages)
from shadow_game_bot.handlers.event_log import log_bot_added
from shadow_game_bot.handlers.commands import (
    help_handler, rules_handler, mystats_handler, ranking_handler,
    globalranking_handler, chatranking_handler, game_start_handler,
    stop_handler, score_handler, resetdata_handler, stats_handler,
    gban_handler, ungban_handler,
)
from shadow_game_bot.handlers.ws_commands import (
    new_game_handler, new4_handler, new5_handler, new6_handler,
    end_game_handler, daily_handler, pausedaily_handler,
    leaderboard_handler, myscore_handler, id_handler,
)
from shadow_game_bot.handlers.ws_admin import (
    setgametopic_handler, unsetgametopic_handler, allowonlylen_handler,
    recreatetopic_handler, seekauth_handler, ban_handler, unban_handler,
    transfer_handler, track_handler, untrack_handler, tracklist_handler,
    broadcast_handler, broadcast_status_handler, broadcast_cancel_handler,
    captcha_handler, resume_broadcast,
)
from shadow_game_bot.handlers.ws_callbacks import ws_callback_handler
from shadow_game_bot.handlers.ws_messages import handle_private_message, topic_edited_handler
from shadow_game_bot.handlers.anti_cheat import (
    SideEffectsMiddleware, tracking_chat_member_handler, tracking_bot_member_handler,
)
from shadow_game_bot.handlers.maumau_commands import (
    newuno_handler, join_handler, leave_handler, startuno_handler,
    kill_handler, kick_handler, open_handler, close_handler,
    skip_handler, notifyme_handler, modes_handler, unostats_handler,
    mm_callback_handler, left_member_handler,
)
from shadow_game_bot.handlers.maumau_inline import (
    reply_to_query, process_result,
)

logger = logging.getLogger(__name__)

# Background tasks started in on_startup
_BACKGROUND_TASKS: list = []


# ── Setup ─────────────────────────────────────

def _setup_logging() -> None:
    level = getattr(logging, config.log_level.upper(), logging.INFO)
    fmt = logging.Formatter("%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
                             datefmt="%Y-%m-%d %H:%M:%S")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(level)
    root.addHandler(handler)
    for noisy in ("httpx", "httpcore", "aiogram", "aiohttp", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


# ── Filters ───────────────────────────────────

class TextCommand(Command):
    """Command that only matches real text messages (PTB CommandHandler
    ignored commands sent as captions)."""

    async def __call__(self, message: Message, bot: Bot):  # type: ignore[override]
        if not isinstance(message, Message) or not message.text:
            return False
        return await super().__call__(message, bot)


class NonCommand(BaseFilter):
    """True when a text message does NOT begin with a /command
    (entity-based, same rule as PTB's ~filters.COMMAND)."""

    async def __call__(self, message: Message) -> bool:
        if not message.text:
            return False
        entities = message.entities or ()
        if entities:
            first = entities[0]
            if first.type == "bot_command" and first.offset == 0:
                return False
        return True


# ── Error handler ─────────────────────────────

async def _recreate_expired_topic(chat_id: int, topic_id: int) -> None:
    """Port of error-handler.ts — recreate a forum topic whose expiry caused
    'message thread not found', when /recreatetopic was enabled for it."""
    ws_db = app.ws_db
    if ws_db is None:
        return
    topic = await ws_db.get_topic(str(chat_id), str(topic_id))
    if not topic or not topic.get("should_recreate_on_expire"):
        return

    logger.info("Recreating expired topic %s in chat %s", topic_id, chat_id)
    placeholder = await app.bot.send_message(chat_id, "Recreating topic...")
    try:
        created = await app.bot.create_forum_topic(
            chat_id,
            topic.get("name") or "WordSeek",
            icon_custom_emoji_id=topic.get("icon_custom_emoji_id") or None,
        )
        new_thread_id = created.message_thread_id
        created_icon = created.icon_custom_emoji_id

        await app.bot.delete_forum_topic(chat_id=chat_id, message_thread_id=topic_id)
        await app.bot.delete_message(chat_id=chat_id, message_id=placeholder.message_id)

        await ws_db.replace_topic_id(
            str(chat_id), str(topic_id), str(new_thread_id),
            topic.get("name"), created_icon or topic.get("icon_custom_emoji_id"),
            topic.get("allowed_lengths") or "")

        from shadow_game_bot.utils.ttl_store import store
        store.delete(f"vote:{chat_id}")

        await app.bot.send_message(
            chat_id,
            "Topic recreated successfully. You can now continue start playing in this topic.",
            message_thread_id=new_thread_id,
        )
    except Exception:
        logger.exception("Topic recreation failed for chat=%s", chat_id)
        try:
            await app.bot.edit_message_text(
                chat_id=chat_id, message_id=placeholder.message_id,
                text="I don't have enough rights to create and delete topics. "
                     "Please update my permissions.")
        except Exception:
            pass


async def error_handler(event: ErrorEvent) -> None:
    err = event.exception
    desc = str(err) if err is not None else ""

    # Special cases ported from WordSeek's error-handler.ts
    if isinstance(err, TelegramBadRequest):
        update = event.update
        message = None
        if update is not None:
            message = update.message or update.edited_message
        chat = message.chat if message else None

        if ("not enough rights to send text messages to the chat" in desc
                and chat and chat.type != "private"):
            try:
                await app.bot.leave_chat(chat.id)
                logger.warning("Left chat %s due to missing send rights", chat.id)
            except Exception:
                logger.warning("Failed to leave chat %s", chat.id)
            return

        if ("message thread not found" in desc
                and chat and message and message.message_thread_id):
            try:
                await _recreate_expired_topic(chat.id, message.message_thread_id)
            except Exception:
                logger.exception("Topic recreation handler failed")
            return

    # Known transient network errors — log a short warning, no traceback
    if isinstance(err, (TelegramNetworkError, TelegramForbiddenError,
                        TelegramBadRequest, TelegramRetryAfter)):
        logger.warning("Transient error (%s): %s", type(err).__name__, err)
        return
    logger.error("Unhandled exception: %s", err, exc_info=err)


# ── Bot command menu ──────────────────────────

BOT_COMMANDS = [
    ("start", "Open the bot"),
    ("help", "All commands & how to play"),
    ("new", "Start a new WordSeek game"),
    ("new4", "WordSeek game (4 letters)"),
    ("new5", "WordSeek game (5 letters)"),
    ("new6", "WordSeek game (6 letters)"),
    ("newword", "Start a new WordSeek game"),
    ("newuno", "Start a new UNO game"),
    ("startuno", "Deal the first UNO hands"),
    ("join", "Join the UNO game"),
    ("leave", "Leave the UNO game"),
    ("kill", "Terminate the UNO game"),
    ("kick", "Kick a UNO player (reply)"),
    ("open", "Open the UNO lobby"),
    ("close", "Close the UNO lobby"),
    ("skip", "Skip the current UNO player"),
    ("notifyme", "Notify me when a UNO game starts"),
    ("modes", "UNO game modes"),
    ("unostats", "Your UNO stats"),
    ("game", "Start a Word Guess game"),
    ("daily", "Daily WordSeek (private only)"),
    ("end", "End the WordSeek game"),
    ("stop", "Stop the Word Guess game"),
    ("score", "Your score / stats"),
    ("leaderboard", "Leaderboard"),
    ("ranking", "Top players in this chat"),
    ("mystats", "Your Word Guess profile"),
    ("rules", "Game rules"),
    ("id", "Message / user info"),
]


# ── Lifecycle ─────────────────────────────────

async def on_startup(bot: Bot) -> None:
    app.bot = bot
    me = await bot.me()
    app.bot_username = me.username

    db = await get_database()
    app.db = db
    ws_db = WordSeekCollection(db)
    app.ws_db = ws_db

    games_col = GamesCollection(db)
    words_col = WordsCollection(db)
    players_col = PlayersCollection(db)

    app.engine = GameEngine(games_col, players_col, words_col)

    # UNO (mau mau) — shared GameManager + stats collection
    app.uno_gm = GameManager()
    app.uno_db = UnoStatsCollection(db)

    # Restore pending DM actions (survive restarts)
    dm_actions = {}
    try:
        cursor = await db.execute(
            "SELECT user_id, game_chat_id, action, game_id FROM dm_actions")
        for row in await cursor.fetchall():
            try:
                action = (DMActionType(row[2])
                          if row[2] in DMActionType._value2member_map_
                          else DMActionType.WRITE_WORD)
                dm_actions[row[0]] = PendingDMAction(
                    user_id=row[0], game_chat_id=row[1], action=action, game_id=row[3])
            except Exception:
                continue
    except Exception:
        logger.exception("Could not restore dm_actions")
    app.dm_actions = dm_actions

    # Seed shadow words
    added = await words_col.seed_default_words()
    await words_col.categorize_existing_words()
    total_normal = await words_col.word_count(category="normal")
    total_fiction = await words_col.word_count(category="fiction")
    total = total_normal + total_fiction
    if added:
        logger.info("Added %d new words. Total: %d (Normal: %d, Fiction: %d)",
                    added, total, total_normal, total_fiction)
    else:
        logger.info("Word database ready. Total: %d (Normal: %d, Fiction: %d)",
                    total, total_normal, total_fiction)

    # Make sure today's daily word exists (also resets inactive streaks)
    await ensure_daily_word(ws_db)

    # Command menu (BotFather-style list)
    try:
        await bot.set_my_commands([BotCommand(command=c, description=d) for c, d in BOT_COMMANDS])
    except Exception:
        logger.warning("set_my_commands failed", exc_info=True)

    # Background tasks
    _BACKGROUND_TASKS.append(asyncio.create_task(daily_wordle_cron_task(ws_db)))
    _BACKGROUND_TASKS.append(asyncio.create_task(inactivity_checker()))

    # Resume an interrupted broadcast, if any
    try:
        await resume_broadcast()
    except Exception:
        logger.exception("broadcast resume failed")

    logger.info("Merged Shadow + WordSeek Bot initialized.")


async def on_shutdown() -> None:
    for task in _BACKGROUND_TASKS:
        task.cancel()
    for task in _BACKGROUND_TASKS:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    _BACKGROUND_TASKS.clear()

    # Cancel any pending UNO fast-mode countdown tasks
    gm = getattr(app, "uno_gm", None)
    if gm is not None:
        for games in gm.chatid_games.values():
            for game in games:
                job = getattr(game, "job", None)
                if job is not None and not job.done():
                    job.cancel()

    await close_database()
    logger.info("Bot shut down.")


# ── Inactivity checker (shadow games) ─────────

async def inactivity_checker() -> None:
    while True:
        try:
            db = app.db
            if db:
                games_col = GamesCollection(db)
                cutoff = (datetime.now(timezone.utc)
                          - timedelta(seconds=config.inactivity_timeout)).isoformat()
                for game in await games_col.get_inactive_games(cutoff):
                    chat_id = game["chat_id"]
                    logger.info("Game in chat %s inactive, ending.", chat_id)
                    await games_col.end_game(chat_id)
                    try:
                        await app.bot.send_message(
                            chat_id,
                            "Game ended due to inactivity (5 minutes).\n"
                            "Use /game to begin a new game.")
                    except Exception:
                        pass
                    for key in ("leader_message_id", "leader_selection_message_id"):
                        msg_id = game.get(key)
                        if msg_id:
                            try:
                                await app.bot.delete_message(chat_id, msg_id)
                            except Exception:
                                pass
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Inactivity checker error: %s", e)
        await asyncio.sleep(30)


# ── Dispatcher wiring ─────────────────────────

def build_dispatcher() -> Dispatcher:
    dp = Dispatcher()

    # Side effects for every update kind (old PTB groups 1 + 2) — outer
    # middlewares run before filters/handlers on these observers.
    dp.message.outer_middleware(SideEffectsMiddleware("message"))
    dp.edited_message.outer_middleware(SideEffectsMiddleware("edited"))
    dp.callback_query.outer_middleware(SideEffectsMiddleware("callback"))

    # Tracked-chat member/bot status changes (old ChatMemberHandler, now BOTH)
    dp.chat_member.register(tracking_chat_member_handler)
    dp.my_chat_member.register(tracking_bot_member_handler)

    # Errors (leave on missing rights, expired-topic recreation)
    dp.errors.register(error_handler)

    # ── Group 10 — commands (registered first) ─────────────────────
    commands = Router(name="commands")

    # Merged / start / help / score / stats
    for name, handler in [
        ("start", start_handler),
        ("help", help_handler),
        ("score", score_handler),          # smart: ws args / shadow board / ws
        ("stats", stats_handler),          # merged shadow + WordSeek stats
        ("rules", rules_handler),
        ("mystats", mystats_handler),
        ("id", id_handler),
    ]:
        commands.message.register(handler, TextCommand(name))

    # Word Guess (shadow) commands
    for name, handler in [
        ("game", game_start_handler),
        ("stop", stop_handler),
        ("endgame", stop_handler),
        ("ranking", ranking_handler),
        ("globalranking", globalranking_handler),
        ("chatranking", chatranking_handler),
    ]:
        commands.message.register(handler, TextCommand(name))

    # WordSeek commands
    for name, handler in [
        ("new", new_game_handler),
        ("new4", new4_handler),
        ("new5", new5_handler),
        ("new6", new6_handler),
        ("end", end_game_handler),
        ("daily", daily_handler),
        ("pausedaily", pausedaily_handler),
        ("leaderboard", leaderboard_handler),
        ("myscore", myscore_handler),
    ]:
        commands.message.register(handler, TextCommand(name))

    # UNO (mau mau) commands — clashes resolved with new[game] names
    commands.message.register(newuno_handler, TextCommand("newuno"))
    # /newword = alias for the WordSeek /new handler
    commands.message.register(new_game_handler, TextCommand("newword"))
    for name, handler in [
        ("startuno", startuno_handler),
        ("join", join_handler),
        ("leave", leave_handler),
        ("kill", kill_handler),
        ("kick", kick_handler),
        ("open", open_handler),
        ("close", close_handler),
        ("skip", skip_handler),
        ("notifyme", notifyme_handler),
        ("notify_me", notifyme_handler),
        ("modes", modes_handler),
    ]:
        commands.message.register(handler, TextCommand(name))
    commands.message.register(unostats_handler, TextCommand("unostats"))

    # Group admin (WordSeek)
    for name, handler in [
        ("setgametopic", setgametopic_handler),
        ("unsetgametopic", unsetgametopic_handler),
        ("allowonlylen", allowonlylen_handler),
        ("recreatetopic", recreatetopic_handler),
        ("seekauth", seekauth_handler),
    ]:
        commands.message.register(handler, TextCommand(name))

    # Owner commands (aliases + WordSeek owner tools)
    for name, handler in [
        ("resetdata", resetdata_handler),
        ("gban", gban_handler),
        ("ungban", ungban_handler),
        ("ban", ban_handler),
        ("unban", unban_handler),
        ("transfer", transfer_handler),
        ("track", track_handler),
        ("untrack", untrack_handler),
        ("tracklist", tracklist_handler),
        ("broadcast", broadcast_handler),
        ("broadcast_status", broadcast_status_handler),
        ("broadcast_cancel", broadcast_cancel_handler),
        ("captcha", captcha_handler),
    ]:
        commands.message.register(handler, TextCommand(name))

    dp.include_router(commands)

    # ── Group 11 — callbacks (prefix-filtered so all can coexist) ───
    callbacks = Router(name="callbacks")
    callbacks.callback_query.register(help_callback, F.data.startswith("help:"))
    callbacks.callback_query.register(start_callback, F.data.startswith("start:"))
    callbacks.callback_query.register(ws_callback_handler, F.data.startswith("ws:"))
    callbacks.callback_query.register(callback_handler, F.data.startswith("sgb:"))
    callbacks.callback_query.register(mm_callback_handler, F.data.startswith("mm:"))
    dp.include_router(callbacks)

    # ── Group 11b — UNO inline gameplay (inline queries) ────────────
    inline = Router(name="uno_inline")
    inline.inline_query.register(reply_to_query)
    inline.chosen_inline_result.register(process_result)
    dp.include_router(inline)

    # ── Group 12 — private text: Daily WordSeek, then shadow DM workflow ──
    private_text = Router(name="private_text")
    private_text.message.register(
        handle_private_message,
        F.chat.type == "private", F.text, NonCommand())
    dp.include_router(private_text)

    # ── Group 13 — group text: WordSeek guess first, then Word Guess ──
    group_text = Router(name="group_text")
    group_text.message.register(
        message_handler,
        F.chat.type.in_({"group", "supergroup"}), F.text, NonCommand())
    dp.include_router(group_text)

    # ── Group 14 — logging: bot added/removed, topic renames ────────
    service = Router(name="service")
    service.message.register(
        topic_edited_handler,
        F.forum_topic_edited, F.chat.type.in_({"group", "supergroup"}))
    service.message.register(
        log_bot_added,
        F.new_chat_members, F.chat.type.in_({"group", "supergroup"}))
    # Combined left_chat_member handler: bot-removed log OR UNO leave.
    # (aiogram runs only the FIRST matching handler per observer.)
    service.message.register(
        left_member_handler,
        F.left_chat_member, F.chat.type.in_({"group", "supergroup"}))
    dp.include_router(service)

    return dp


# ── Main ──────────────────────────────────────

def resolve_allowed_updates(dp: Dispatcher) -> list:
    """Update types to subscribe to: auto-resolved from registered handlers
    PLUS edited_message — it only has side-effect middlewares (anti-cheat +
    tracking on edits, old PTB groups 1+2), so auto-resolution skips it."""
    return sorted(set(dp.resolve_used_update_types()) | {"edited_message"})


async def run() -> None:
    # Slightly generous timeout to survive Telegram API lag
    # (PTB: read/write 45s, connect 15s — aiohttp has a single total timeout)
    session = AiohttpSession(timeout=45)
    bot = Bot(token=config.bot_token, session=session)
    dp = build_dispatcher()

    try:
        await on_startup(bot)
        # Drop any webhook + pending updates (PTB drop_pending_updates=True)
        await bot.delete_webhook(drop_pending_updates=True)
        await dp.start_polling(bot, polling_timeout=10,
                               allowed_updates=resolve_allowed_updates(dp))
    finally:
        await on_shutdown()


def main() -> None:
    _setup_logging()
    logger.info("Starting merged Shadow + WordSeek Bot...")
    config.validate()
    asyncio.run(run())


if __name__ == "__main__":
    main()
