"""Anti-cheat, tracking and sync middleware (WordSeek ports).

aiogram replacement for PTB handler groups 1 & 2:
  SideEffectsMiddleware  — upsert every user/chat into ws_ tables, run
                           suspicious-pattern alerts + greeting-combo checks,
                           forward tracked-chat activity to the owner chat.

Ports of WordSeek `user-and-chat-sync-handler.ts` and `track-messages-handler.ts`
(the original ran these as an awaiting middleware before the game handlers —
this implementation does the same).
"""

import logging
import re
from datetime import datetime, timezone

from aiogram.types import Message, CallbackQuery, ChatMemberUpdated
from aiogram.dispatcher.middlewares.base import BaseMiddleware

from shadow_game_bot.config import config
from shadow_game_bot.context import app
from shadow_game_bot.db.wordseek import WordSeekCollection
from shadow_game_bot.utils.ttl_store import store

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════
# User & chat sync
# ══════════════════════════════════════════════

async def sync_from_message(message: Message) -> None:
    """Upsert the acting user and the current chat into ws_ tables."""
    ws_db: WordSeekCollection = app.ws_db
    if ws_db is None:
        return

    user = message.from_user
    chat = message.chat

    try:
        if user and not user.is_bot:
            name = (user.first_name or "") + (f" {user.last_name}" if user.last_name else "")
            await ws_db.upsert_user(str(user.id), name.strip(), user.username)

        if chat and chat.type != "channel":
            if chat.type == "private":
                chat_name = (
                    ((user.first_name or "") + (f" {user.last_name}" if user.last_name else "")).strip()
                    if user else None
                )
            else:
                chat_name = chat.title
            await ws_db.upsert_broadcast_chat(str(chat.id), chat_name, chat.username)
    except Exception:
        logger.exception("sync_from_message failed")


# ══════════════════════════════════════════════
# Suspicious patterns
# ══════════════════════════════════════════════

SUSPICIOUS_PATTERNS = {
    "autoPlayer": re.compile(r"auto-player", re.I),
    "swsCommand": re.compile(r"/sws", re.I),
    "ewsCommand": re.compile(r"/ews", re.I),
    "dotCommand": re.compile(r"^\.xx\b", re.I),
    "wordhckCommand": re.compile(r"/wordhck", re.I),
    "autoWordplayCommand": re.compile(r"^\.autowordplay\b", re.I),
    "stophckCommand": re.compile(r"/stophck", re.I),
    "wordonCommand": re.compile(r"/wordon", re.I),
    "wordoffCommand": re.compile(r"/wordoff", re.I),
    "benableCommand": re.compile(r"^\.benable\b", re.I),
    "wordSeekCommand": re.compile(r"^\.word_seek\b", re.I),
    "stopSeekCommand": re.compile(r"^\.stop_seek\b", re.I),
    "helpWordseek": re.compile(r"^\.help\s+wordseek\b", re.I),
    "autoSkCommand": re.compile(r"^\s*\.?auto[456]\s+sk\b", re.I),
    "spCommand": re.compile(r"^\s*\.sp(?:\s|$)", re.I),
    "speedSkCommand": re.compile(r"^\s*\.?speed\s+sk\b", re.I),
    "apexUserbot": re.compile(r"apex", re.I),
    "userbotWord": re.compile(r"userbot", re.I),
    "newWordseekCommand": re.compile(r"/new[456]?@wordseekbot"),
    "endWordseekCommand": re.compile(r"/end@wordseekbot"),
}

# Ordered (pattern, reason) — mirrors the original if/else chain.
_REASON_CHAIN = (
    ("swsCommand", "Contains /sws command"),
    ("ewsCommand", "Contains /ews command"),
    ("dotCommand", "Dot command detected (e.g., .xx)"),
    ("autoWordplayCommand", "Contains .autowordplay command"),
    ("autoPlayer", "Auto-player keyword detected"),
    ("wordhckCommand", "Contains /wordhck command"),
    ("stophckCommand", "Contains /stophck command"),
    ("wordonCommand", "Contains /wordon command"),
    ("wordoffCommand", "Contains /wordoff command"),
    ("benableCommand", "Contains .benable command"),
    ("wordSeekCommand", "Contains .word_seek command"),
    ("stopSeekCommand", "Contains .stop_seek command"),
    ("helpWordseek", "Used .help wordseek command"),
    ("autoSkCommand", "Contains auto4/5/6 sk command (auto-play start)"),
    ("spCommand", "Contains .sp command (auto-play stop)"),
    ("speedSkCommand", "Contains speed sk command (auto-play speed)"),
    ("newWordseekCommand", "Contains /new@wordseekbot (or /new4, /new5, /new6) command"),
    ("endWordseekCommand", "Contains /end@wordseekbot command"),
)


def _classify(text: str) -> str:
    """Return a suspicion reason or empty string."""
    if not text:
        return ""
    for key, reason in _REASON_CHAIN:
        if SUSPICIOUS_PATTERNS[key].search(text):
            return reason
    if (SUSPICIOUS_PATTERNS["apexUserbot"].search(text)
            and SUSPICIOUS_PATTERNS["userbotWord"].search(text)):
        return 'Message contains both "apex" and "userbot"'
    return ""


async def _send_suspicious_alert(message: Message, reason: str, message_text: str,
                                 forward: bool = True) -> None:
    user = message.from_user
    chat = message.chat
    if not user or not chat:
        return

    user_name = (user.first_name or "") + (f" {user.last_name}" if user.last_name else "")
    username = f"@{user.username}" if user.username else "No username"
    chat_title = chat.title or chat.first_name or "Unknown"

    alert = (
        "🚨 SUSPICIOUS ACTIVITY DETECTED\n\n"
        f"Reason: {reason}\n\n"
        "👤 User Info:\n"
        f"├ Name: {user_name}\n"
        f"├ Username: {username}\n"
        f"└ User ID: {user.id}\n\n"
        "💬 Chat Info:\n"
        f"├ Title: {chat_title}\n"
        f"└ Chat ID: {chat.id}\n"
    )
    if message_text:
        truncated = message_text[:500] + ("..." if len(message_text) > 500 else "")
        alert += f"\n📝 Message:\n{truncated}"

    bot = app.bot
    if bot is None:
        return
    for target in config.alert_targets:
        try:
            await bot.send_message(target, alert)
            if forward:
                try:
                    await bot.forward_message(target, chat.id, message.message_id)
                except Exception:
                    pass
        except Exception as exc:
            logger.warning("Failed to send suspicious alert to %s: %s", target, exc)


# ── Greeting combo ("hello baby" + "byee") ─────

HELLO_BABY_PATTERN = re.compile(r"hello\s+baby", re.I)
BYEE_PATTERN = re.compile(r"byee", re.I)


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _inc_counter(key: str, ttl: float) -> int:
    """Redis INCR + EXPIRE replacement using the TTL store."""
    current = store.get(key, 0)
    if not isinstance(current, int):
        current = 0
    current += 1
    store.set(key, current, ttl)
    return current


async def _check_greeting_combo(message: Message, text: str) -> None:
    user = message.from_user
    if not user:
        return
    has_hello = HELLO_BABY_PATTERN.search(text) is not None
    has_byee = BYEE_PATTERN.search(text) is not None
    if not has_hello and not has_byee:
        return

    day = _today_utc()
    base = f"greetingTrack:{user.id}"
    if has_hello:
        _inc_counter(f"{base}:helloBaby:{day}", 172800)
    if has_byee:
        _inc_counter(f"{base}:byee:{day}", 172800)

    hello_count = store.get(f"{base}:helloBaby:{day}", 0)
    byee_count = store.get(f"{base}:byee:{day}", 0)
    if not hello_count or not byee_count:
        return

    user_name = (user.first_name or "") + (f" {user.last_name}" if user.last_name else "")
    username = f"@{user.username}" if user.username else "No username"
    chat = message.chat
    chat_title = (chat.title or chat.first_name or "Unknown") if chat else "Unknown"

    alert = (
        "👋 GREETING COMBO DETECTED\n\n"
        'User has used both "Hello Baby" and "Byee" today.\n\n'
        "👤 User Info:\n"
        f"├ Name: {user_name}\n"
        f"├ Username: {username}\n"
        f"└ User ID: {user.id}\n\n"
        "💬 Chat Info:\n"
        f"├ Title: {chat_title}\n"
        f"└ Chat ID: {chat.id if chat else 'Unknown'}\n\n"
        "📊 Today's counts:\n"
        f'├ "Hello Baby": {hello_count}x\n'
        f'└ "Byee": {byee_count}x'
    )
    bot = app.bot
    if bot is None:
        return
    for target in config.alert_targets:
        try:
            await bot.send_message(target, alert)
        except Exception as exc:
            logger.error("Failed to send greeting combo alert to %s: %s", target, exc)


async def anti_cheat_check(message: Message, is_edited: bool) -> None:
    """Suspicious-pattern alerts + greeting combo."""
    text = message.text or message.caption or ""
    if not text:
        return
    user = message.from_user
    if user and user.is_bot:
        return

    if is_edited:
        # Edited messages: only the tighter checks (matches original behaviour)
        reason = ""
        if SUSPICIOUS_PATTERNS["autoPlayer"].search(text):
            reason = "Edited message contains auto-player keyword"
        elif (SUSPICIOUS_PATTERNS["apexUserbot"].search(text)
                and SUSPICIOUS_PATTERNS["userbotWord"].search(text)):
            reason = 'Edited message contains both "apex" and "userbot"'
        elif _classify(text):
            reason = "Edited message contains suspicious pattern"
        if reason:
            try:
                await _send_suspicious_alert(message, reason, text, forward=False)
            except Exception:
                logger.exception("suspicious alert failed")
    else:
        reason = _classify(text)
        if reason:
            try:
                await _send_suspicious_alert(message, reason, text)
            except Exception:
                logger.exception("suspicious alert failed")

    try:
        await _check_greeting_combo(message, text)
    except Exception:
        logger.exception("greeting combo check failed")


# ══════════════════════════════════════════════
# Tracking forwards (owner-initiated via /track)
# ══════════════════════════════════════════════

_TRACKED_CONTENT = (
    "text", "photo", "video", "document", "audio", "voice", "sticker",
    "animation", "video_note", "poll", "location", "venue", "contact",
)

_CONTENT_LABELS = {
    "photo": "📷 Photo", "video": "🎥 Video", "document": "📄 Document",
    "audio": "🎵 Audio", "voice": "🎤 Voice", "sticker": "🎭 Sticker",
    "animation": "🎬 GIF", "video_note": "📹 Video Note", "poll": "📊 Poll",
    "location": "📍 Location", "venue": "🏢 Venue", "contact": "👤 Contact",
}


async def tracking_message(message: Message) -> None:
    """Forward messages from tracked chats to the owner chat."""
    chat = message.chat
    if not chat:
        return
    ws_db: WordSeekCollection = app.ws_db
    if ws_db is None:
        return
    admin_chat_id = await ws_db.get_tracking(str(chat.id))
    if not admin_chat_id:
        return
    target = int(admin_chat_id)
    bot = app.bot
    if bot is None:
        return

    content_type = next((t for t in _TRACKED_CONTENT if getattr(message, t, None) is not None), None)
    if content_type is None:
        return

    try:
        await bot.forward_message(target, chat.id, message.message_id)
    except Exception:
        sender = "Unknown"
        if message.from_user:
            sender = (message.from_user.first_name or "") + (
                f" (@{message.from_user.username})" if message.from_user.username else "")
        label = _CONTENT_LABELS.get(content_type, "message")
        body = f"\n\n{message.text}" if message.text else ""
        try:
            await bot.send_message(
                target,
                f"🔔 New {label} in chat {chat.id}\nFrom: {sender}\n\n"
                f"Message ID: {message.message_id}{body}",
            )
        except Exception:
            logger.warning("tracking forward failed for chat %s", chat.id)


async def tracking_edited(message: Message) -> None:
    """Report edited messages in tracked chats."""
    chat = message.chat
    if not chat:
        return
    ws_db: WordSeekCollection = app.ws_db
    if ws_db is None:
        return
    admin_chat_id = await ws_db.get_tracking(str(chat.id))
    if not admin_chat_id:
        return

    sender = "Unknown"
    if message.from_user:
        sender = (message.from_user.first_name or "") + (
            f" (@{message.from_user.username})" if message.from_user.username else "")
    text = message.text or message.caption or "[Media message]"
    truncated = text[:200] + ("..." if len(text) > 200 else "")
    bot = app.bot
    if bot is None:
        return
    try:
        await bot.send_message(
            int(admin_chat_id),
            f"✏️ Message edited in chat {chat.id}\nFrom: {sender}\nNew text: {truncated}",
        )
    except Exception:
        logger.warning("tracking edit notice failed for chat %s", chat.id)


async def tracking_callback(query: CallbackQuery) -> None:
    """Report button clicks in tracked chats (original callbackQuery branch)."""
    msg = query.message
    if msg is None or msg.chat is None:
        return
    chat = msg.chat
    ws_db: WordSeekCollection = app.ws_db
    if ws_db is None:
        return
    admin_chat_id = await ws_db.get_tracking(str(chat.id))
    if not admin_chat_id:
        return
    bot = app.bot
    if bot is None:
        return
    user = query.from_user
    data = query.data or "No data"
    try:
        await bot.send_message(
            int(admin_chat_id),
            f"🔘 Button clicked in chat {chat.id}\n"
            f"From: {user.first_name}{f' (@{user.username})' if user.username else ''}\n"
            f"Data: {data}",
        )
    except Exception:
        logger.warning("tracking callback notice failed for chat %s", chat.id)


async def _tracking_member(event: ChatMemberUpdated, bot_side: bool) -> None:
    """Report member/bot status changes in tracked chats."""
    chat = event.chat
    if chat is None:
        return
    ws_db: WordSeekCollection = app.ws_db
    if ws_db is None:
        return
    admin_chat_id = await ws_db.get_tracking(str(chat.id))
    if not admin_chat_id:
        return
    bot = app.bot
    if bot is None:
        return

    old_status = event.old_chat_member.status.value
    new_status = event.new_chat_member.status.value
    user = event.new_chat_member.user

    if bot_side:
        text = f"🤖 Bot status change in chat {chat.id}\n{old_status} → {new_status}"
    else:
        uname = user.username or ""
        text = (
            f"👥 Member status change in chat {chat.id}\n"
            f"User: {user.first_name}{f' (@{uname})' if uname else ''}\n"
            f"{old_status} → {new_status}"
        )
    try:
        await bot.send_message(int(admin_chat_id), text)
    except Exception:
        logger.warning("tracking member notice failed for chat %s", chat.id)


async def tracking_chat_member_handler(event: ChatMemberUpdated) -> None:
    """Track other members' status changes (chat_member updates)."""
    await _tracking_member(event, bot_side=False)


async def tracking_bot_member_handler(event: ChatMemberUpdated) -> None:
    """Track the bot's own status changes (my_chat_member updates)."""
    await _tracking_member(event, bot_side=True)


# ══════════════════════════════════════════════
# Combined middleware (PTB groups 1 + 2 equivalent)
# ══════════════════════════════════════════════

class SideEffectsMiddleware(BaseMiddleware):
    """Awaiting middleware run before any handler matches — sync first,
    then anti-cheat + tracking (same order as the original grammY bot).

    kind: "message" | "edited" | "callback"
    """

    def __init__(self, kind: str = "message") -> None:
        self.kind = kind

    async def __call__(self, handler, event, data):  # noqa: ANN001
        try:
            if self.kind in ("message", "edited"):
                await sync_from_message(event)
            if self.kind == "message":
                await anti_cheat_check(event, is_edited=False)
                await tracking_message(event)
            elif self.kind == "edited":
                await anti_cheat_check(event, is_edited=True)
                await tracking_edited(event)
            elif self.kind == "callback":
                await tracking_callback(event)
        except Exception:
            logger.exception("side effects failed (kind=%s)", self.kind)
        return await handler(event, data)
