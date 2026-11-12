"""Event logger — sends bot event logs to the designated log group."""

import logging
import asyncio

from aiogram.types import Message
from aiogram.exceptions import TelegramNetworkError, TelegramRetryAfter

from shadow_game_bot.config import config
from shadow_game_bot.context import app

logger = logging.getLogger(__name__)
LOG_GROUP_ID = config.log_group_id

MAX_RETRIES = 3
RETRY_DELAY = 3


async def _safe_log(text: str) -> None:
    """Send a log message with retries and longer timeout."""
    bot = app.bot
    if bot is None:
        logger.warning("Log skipped (bot not ready): %s", text.splitlines()[0])
        return
    for attempt in range(MAX_RETRIES):
        try:
            await bot.send_message(
                LOG_GROUP_ID, text,
                request_timeout=30,
            )
            return
        except (TelegramNetworkError, TelegramRetryAfter) as e:
            logger.warning("Log send failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(RETRY_DELAY * (attempt + 1))
        except Exception as e:
            logger.warning("Log send failed: %s", e)
            return


async def log_new_user(message: Message) -> None:
    user = message.from_user
    if not user:
        return
    username = f"@{user.username}" if user.username else "None"
    text = (
        f"New User Started Bot\n━━━━━━━━━━━━━━━━━\n\n"
        f"Name: {user.full_name}\n"
        f"User ID: {user.id}\n"
        f"Username: {username}"
    )
    await _safe_log(text)


def _our_bot_in_new_members(message: Message) -> bool:
    """True when THIS bot itself is among the new chat members.

    Telegram fires ``new_chat_members`` for *every* member join, not just
    when the bot is added — the log must only report actual bot joins.
    """
    members = message.new_chat_members or []
    if app.bot_id is not None:
        return any(m.id == app.bot_id for m in members)
    if app.bot_username:
        return any((m.username or "").lower() == app.bot_username.lower()
                   for m in members)
    return False


async def log_bot_added(message: Message) -> None:
    chat = message.chat
    if not chat:
        return
    if not _our_bot_in_new_members(message):
        return
    added_by = message.from_user
    text = (
        f"Bot Added to Group\n━━━━━━━━━━━━━━━━━\n\n"
        f"Group: {chat.title}\n"
        f"Chat ID: {chat.id}\n"
        f"Type: {chat.type}"
    )
    if added_by:
        text += f"\nAdded by: {added_by.full_name} ({added_by.id})"
    await _safe_log(text)


async def log_bot_removed(message: Message) -> None:
    chat = message.chat
    if not chat:
        return
    removed_by = message.from_user
    text = (
        f"Bot Removed from Group\n━━━━━━━━━━━━━━━━━\n\n"
        f"Group: {chat.title}\n"
        f"Chat ID: {chat.id}\n"
        f"Type: {chat.type}"
    )
    if removed_by:
        text += f"\nRemoved by: {removed_by.full_name} ({removed_by.id})"
    await _safe_log(text)
