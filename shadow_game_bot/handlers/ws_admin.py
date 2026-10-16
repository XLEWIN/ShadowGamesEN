"""WordSeek admin & owner commands.

Group admin: /setgametopic /unsetgametopic /allowonlylen /recreatetopic /seekauth
Owner:       /ban /unban /transfer /track /untrack /tracklist
             /broadcast /broadcast_status /broadcast_cancel /captcha
"""

import asyncio
import logging
from typing import Dict, List, Optional

from aiogram.types import Message
from aiogram.filters import CommandObject

from shadow_game_bot.config import config
from shadow_game_bot.context import app
from shadow_game_bot.db.wordseek import WordSeekCollection
from shadow_game_bot.emojis import E
from shadow_game_bot.handlers.ws_commands import _require_admin, get_target_user
from shadow_game_bot.keyboards.ws import (
    SLOT_SYMBOLS, build_captcha_keyboard,
)
from shadow_game_bot.reply import reply_text
from shadow_game_bot.utils.format_ws import escape_html_entities, format_duration
from shadow_game_bot.utils.ttl_store import store

logger = logging.getLogger(__name__)

VALID_LENGTHS = (4, 5, 6)


# ══════════════════════════════════════════════
# Topic commands (group admin only)
# ══════════════════════════════════════════════

def _topic_id(message: Message) -> str:
    return str(message.message_thread_id) if message and message.message_thread_id else "general"


async def setgametopic_handler(message: Message) -> None:
    chat = message.chat
    if not chat:
        return
    if not chat.is_forum:
        return await reply_text(
            message, f"{E.WARNING} This command can only be used in forum groups.")
    if not await _require_admin(message):
        return
    ws_db: WordSeekCollection = app.ws_db
    created = await ws_db.set_game_topic(str(chat.id), _topic_id(message))
    if not created:
        return await reply_text(
            message,
            f"{E.WARNING} Game has already been set for this topic.\n"
            "Use /unsetgametopic to unset it first.")
    await reply_text(
        message,
        f"{E.SUCCESS} @{app.bot_username} will now use this topic for the game.")


async def unsetgametopic_handler(message: Message) -> None:
    chat = message.chat
    if not chat:
        return
    if not chat.is_forum:
        return await reply_text(
            message, f"{E.WARNING} This command can only be used in forum groups.")
    if not await _require_admin(message):
        return
    ws_db: WordSeekCollection = app.ws_db
    await ws_db.unset_game_topic(str(chat.id), _topic_id(message))
    await reply_text(
        message,
        f"{E.SUCCESS} @{app.bot_username} won't use this topic for the game.")


async def allowonlylen_handler(message: Message, command: CommandObject) -> None:
    chat = message.chat
    if not chat:
        return
    if not chat.is_forum:
        return await reply_text(
            message, f"{E.WARNING} This command can only be used in forum groups.")
    if not await _require_admin(message):
        return

    args = command.args.split() if command and command.args else []
    if not args:
        return await reply_text(
            message, f"{E.INFO} Usage: /allowonlylen 5 4 6")
    try:
        lengths = [int(x) for x in args if int(x) in VALID_LENGTHS]
    except ValueError:
        lengths = []
    if not lengths:
        return await reply_text(
            message, f"{E.WARNING} Allowed lengths are only: 4, 5, 6")

    ws_db: WordSeekCollection = app.ws_db
    topic = await ws_db.get_topic(str(chat.id), _topic_id(message))
    if not topic:
        return await reply_text(
            message,
            f"{E.WARNING} This topic is not set for the game.\nUse /setgametopic first.")
    await ws_db.update_topic_lengths(str(chat.id), _topic_id(message), lengths)
    await reply_text(
        message,
        f"{E.SUCCESS} Allowed word lengths updated.\n"
        f"Default length: {lengths[0]}\n"
        f"Allowed: {', '.join(map(str, lengths))}")


async def recreatetopic_handler(message: Message, command: CommandObject) -> None:
    chat = message.chat
    if not chat:
        return
    if not chat.is_forum:
        return await reply_text(
            message, f"{E.WARNING} This command can only be used in forum groups.")
    if not await _require_admin(message):
        return
    topic_id = message.message_thread_id
    if not topic_id:
        return await reply_text(
            message,
            f"{E.INFO} General topics can't expire. So, you don't need to use this.")

    args = command.args.split() if command and command.args else []
    action = args[0].lower() if args else ""
    if action not in ("on", "off"):
        return await reply_text(
            message,
            f"{E.INFO} Please specify 'on' or 'off'.\n"
            "Usage: /recreatetopic on or /recreatetopic off")

    ws_db: WordSeekCollection = app.ws_db
    topic = await ws_db.get_topic(str(chat.id), str(topic_id))
    if not topic:
        return await reply_text(
            message,
            f"{E.WARNING} No game topic set for this topic.\nUse /setgametopic first.")
    await ws_db.update_topic_meta(str(chat.id), str(topic_id), should_recreate=(action == "on"))
    await reply_text(
        message,
        f"{E.SUCCESS} Topic recreation on expire has been turned {action.upper()}.")


# ══════════════════════════════════════════════
# /seekauth
# ══════════════════════════════════════════════

async def seekauth_handler(message: Message, command: CommandObject) -> None:
    chat, user = message.chat, message.from_user
    if not chat or not user:
        return
    if not await _require_admin(message):
        return

    ws_db: WordSeekCollection = app.ws_db
    chat_id = str(chat.id)
    raw = command.args if command and command.args else ""
    parts = raw.split()
    action = parts[0].lower() if parts else ""
    reply_cfg = {"parse_mode": "HTML"}

    if action == "list":
        users = await ws_db.list_authorized(chat_id)
        if not users:
            return await message.reply(
                f"{E.INFO} No authorized users in this chat.", **reply_cfg)
        user_list = "\n".join(
            f'• <a href="tg://user?id={u["id"]}">{escape_html_entities(u.get("name") or "Unknown")}</a>'
            + (f' (@{u["username"]})' if u.get("username") else "")
            for u in users)
        return await message.reply(
            f"<b>{E.LOCK} Authorized Users for Seek Game</b>\n\n{user_list}",
            **reply_cfg)

    if action == "remove":
        target = await get_target_user(message, parts[1] if len(parts) > 1 else None)
        if not target:
            return await message.reply(f"{E.ERROR} User not found.", **reply_cfg)
        removed = await ws_db.deauthorize_user(chat_id, target["id"])
        if not removed:
            return await message.reply(
                f"{E.ERROR} This user is not authorized.", **reply_cfg)
        name = f'@{target["username"]} ({target["name"]})' if target.get("username") else target["name"]
        return await message.reply(
            f"{E.SUCCESS} <b>{escape_html_entities(name)}</b> is no longer "
            "authorized to end the game.", **reply_cfg)

    target = await get_target_user(message, action)
    if not target:
        return await message.reply(
            f"{E.ERROR} Could not identify the user. Please mention with "
            "@username, provide user ID, or reply to their message.",
            **reply_cfg)
    added = await ws_db.authorize_user(chat_id, target["id"], str(user.id))
    if not added:
        return await message.reply(
            f"{E.WARNING} <b>{escape_html_entities(target['name'])}</b> is already "
            "authorized to end the game in this chat.",
            **reply_cfg)
    name = f'@{target["username"]} ({target["name"]})' if target.get("username") else target["name"]
    await message.reply(
        f"{E.SUCCESS} <b>{escape_html_entities(name)}</b> is now authorized to "
        "end the game without voting!",
        **reply_cfg)


# ══════════════════════════════════════════════
# /ban /unban (aliases of shadow /gban /ungban)
# ══════════════════════════════════════════════

async def ban_handler(message: Message, command: CommandObject) -> None:
    from shadow_game_bot.handlers.commands import gban_handler
    await gban_handler(message, command)


async def unban_handler(message: Message, command: CommandObject) -> None:
    from shadow_game_bot.handlers.commands import ungban_handler
    await ungban_handler(message, command)


# ══════════════════════════════════════════════
# /transfer (owner, private)
# ══════════════════════════════════════════════

async def _owner_private(message: Message) -> bool:
    user, chat = message.from_user, message.chat
    if not user or not chat:
        return False
    if chat.type != "private":
        await reply_text(
            message,
            f"{E.WARNING} Use this command in a private chat with the bot.")
        return False
    if not config.is_owner(user.id):
        await reply_text(message, f"{E.LOCK} This command is owner only.")
        return False
    return True


async def transfer_handler(message: Message, command: CommandObject) -> None:
    if not await _owner_private(message):
        return
    args = command.args.split() if command and command.args else []
    if len(args) != 2:
        return await reply_text(
            message,
            f"{E.INFO} Usage: /transfer &lt;from_user&gt; &lt;to_user&gt;\n"
            "Example: /transfer @username1 @username2\n"
            "Or: /transfer user_id_1 user_id_2",
            parse_mode="HTML")

    ws_db: WordSeekCollection = app.ws_db

    async def get_user(identifier: str):
        if identifier.startswith("@"):
            users = await ws_db.find_users_by_username(identifier[1:])
            return users[0] if users else None
        return await ws_db.get_user(identifier)

    from_user = await get_user(args[0])
    to_user = await get_user(args[1])
    if not from_user:
        return await reply_text(
            message, f"{E.ERROR} Source user not found: {escape_html_entities(args[0])}",
            parse_mode="HTML")
    if not to_user:
        return await reply_text(
            message, f"{E.ERROR} Destination user not found: {escape_html_entities(args[1])}",
            parse_mode="HTML")
    if from_user["id"] == to_user["id"]:
        return await reply_text(
            message, f"{E.ERROR} Cannot transfer to the same user.")

    entries = await ws_db.leaderboard_entries(from_user["id"])
    if not entries:
        return await reply_text(
            message,
            f"{E.INFO} {escape_html_entities(from_user['name'])} has no "
            "leaderboard entries to transfer",
            parse_mode="HTML")
    total_score = sum(int(e.get("score") or 0) for e in entries)
    transferred = await ws_db.transfer_leaderboard(from_user["id"], to_user["id"])
    await reply_text(
        message,
        f"{E.SUCCESS} <b>Successfully transferred leaderboard data!</b>\n\n"
        f"From: {escape_html_entities(from_user['name'])} ({from_user['id']})\n"
        f"To: {escape_html_entities(to_user['name'])} ({to_user['id']})\n\n"
        f"Entries transferred: {transferred}\n"
        f"Total score transferred: {total_score}",
        parse_mode="HTML")


# ══════════════════════════════════════════════
# /track /untrack /tracklist (owner, private)
# ══════════════════════════════════════════════

async def track_handler(message: Message, command: CommandObject) -> None:
    if not await _owner_private(message):
        return
    chat_id = (command.args.split()[0] if command and command.args else "").strip()
    if not chat_id:
        return await reply_text(message, f"{E.INFO} Usage: /track &lt;chat_id&gt;",
                                parse_mode="HTML")
    ws_db: WordSeekCollection = app.ws_db
    existing = await ws_db.get_tracking(chat_id)
    if existing:
        return await reply_text(
            message, f"{E.WARNING} Chat {chat_id} is already being tracked.")
    await ws_db.set_tracking(chat_id, str(message.chat.id))
    await reply_text(
        message,
        f"{E.SUCCESS} Now tracking chat: {chat_id}\nAll messages will be forwarded here.")


async def untrack_handler(message: Message, command: CommandObject) -> None:
    if not await _owner_private(message):
        return
    chat_id = (command.args.split()[0] if command and command.args else "").strip()
    if not chat_id:
        return await reply_text(message, f"{E.INFO} Usage: /untrack &lt;chat_id&gt;",
                                parse_mode="HTML")
    ws_db: WordSeekCollection = app.ws_db
    if not await ws_db.remove_tracking(chat_id):
        return await reply_text(
            message, f"{E.WARNING} Chat {chat_id} is not being tracked.")
    await reply_text(
        message, f"{E.SUCCESS} Stopped tracking chat: {chat_id}")


async def tracklist_handler(message: Message) -> None:
    if not await _owner_private(message):
        return
    ws_db: WordSeekCollection = app.ws_db
    tracked = await ws_db.list_tracking()
    if not tracked:
        return await reply_text(
            message, f"{E.INFO} No chats are currently being tracked.")
    await reply_text(
        message,
        f"{E.INFO} <b>Currently tracking:</b>\n" + "\n".join(tracked),
        parse_mode="HTML")


# ══════════════════════════════════════════════
# /broadcast (owner, private)
# ══════════════════════════════════════════════

async def broadcast_handler(message: Message) -> None:
    if not await _owner_private(message):
        return
    if not message.reply_to_message:
        return await message.reply(
            f"<blockquote>{E.ANNOUNCE} No message to broadcast!</blockquote>\n\n"
            "Please mention the message that you want to broadcast.",
            parse_mode="HTML")

    ws_db: WordSeekCollection = app.ws_db
    existing_state = await ws_db.load_broadcast_state()
    if existing_state:
        return await message.reply(
            f"<blockquote>{E.WARNING} A broadcast is already in progress!</blockquote>\n\n"
            f"Progress: {existing_state.get('currentIndex')}/{existing_state.get('totalChats')}\n"
            "Use /broadcast_status to check status or /broadcast_cancel to cancel.",
            parse_mode="HTML")

    chats = await ws_db.list_broadcast_chats()
    if not chats:
        return await message.reply(
            f"{E.INFO} Not enough users are recorded yet!\n\n"
            "<blockquote>Please try again later</blockquote>",
            parse_mode="HTML")

    status = await message.reply(
        f"<blockquote>{E.ANNOUNCE} Broadcasting your message to {len(chats)} members</blockquote>",
        parse_mode="HTML")

    import time as _time
    state = {
        "messageId": message.reply_to_message.message_id,
        "chatId": message.chat.id,
        "totalChats": len(chats),
        "currentIndex": 0,
        "successCount": 0,
        "blockedCount": 0,
        "deletedCount": 0,
        "unknownErrorCount": 0,
        "startTime": int(_time.time() * 1000),
        "statusMessageId": status.message_id,
        "statusChatId": status.chat.id,
    }
    await ws_db.save_broadcast_state(state)
    asyncio.create_task(perform_broadcast(state))


async def broadcast_status_handler(message: Message) -> None:
    if not await _owner_private(message):
        return
    ws_db: WordSeekCollection = app.ws_db
    state = await ws_db.load_broadcast_state()
    if not state:
        return await message.reply(
            f"<blockquote>{E.INFO} No broadcast in progress</blockquote>",
            parse_mode="HTML")
    elapsed = int(__import__("time").time() * 1000) - state.get("startTime", 0)
    current = max(state.get("currentIndex", 0), 1)
    remaining = max((elapsed / current) * state["totalChats"] - elapsed, 0)
    await message.reply(
        f"<blockquote>{E.ANNOUNCE} Broadcast in progress!</blockquote>\n\n"
        f"Progress: <code>{state['currentIndex']}/{state['totalChats']}</code>\n"
        f"Estimated time: <code>{format_duration(remaining)}</code>\n"
        f"Success: <code>{state['successCount']}</code>\n"
        f"Blocked: <code>{state['blockedCount']}</code>\n"
        f"Deleted: <code>{state['deletedCount']}</code>",
        parse_mode="HTML")


async def broadcast_cancel_handler(message: Message) -> None:
    if not await _owner_private(message):
        return
    ws_db: WordSeekCollection = app.ws_db
    state = await ws_db.load_broadcast_state()
    if not state:
        return await message.reply(
            f"<blockquote>{E.INFO} No broadcast in progress</blockquote>",
            parse_mode="HTML")
    await ws_db.clear_broadcast_state()
    await message.reply(
        f"<blockquote>{E.SUCCESS} Broadcast cancelled!</blockquote>\n\n"
        f"Completed: <code>{state['currentIndex']}/{state['totalChats']}</code>",
        parse_mode="HTML")


async def perform_broadcast(state: Dict) -> None:
    """Copy the message to every recorded chat; persists state for resume."""
    import time as _time
    ws_db: WordSeekCollection = app.ws_db
    bot = app.bot
    chats = await ws_db.list_broadcast_chats()

    try:
        while state["currentIndex"] < len(chats):
            # Respect cancellation from another handler
            current = await ws_db.load_broadcast_state()
            if not current:
                return
            state = current

            chat = chats[state["currentIndex"]]
            try:
                await bot.copy_message(
                    chat_id=int(chat["id"]),
                    from_chat_id=state["chatId"],
                    message_id=state["messageId"],
                )
                state["successCount"] += 1
            except Exception as exc:  # noqa: BLE001
                err = str(exc).lower()
                if "blocked" in err or "kicked" in err:
                    state["blockedCount"] += 1
                else:
                    state["unknownErrorCount"] += 1
                try:
                    await ws_db.delete_broadcast_chat(chat["id"])
                    state["deletedCount"] += 1
                except Exception:
                    pass

            state["currentIndex"] += 1
            await ws_db.save_broadcast_state(state)

            if state["currentIndex"] % 50 == 0:
                elapsed = int(_time.time() * 1000) - state["startTime"]
                idx = max(state["currentIndex"], 1)
                remaining = max((elapsed / idx) * state["totalChats"] - elapsed, 0)
                try:
                    await bot.edit_message_text(
                        chat_id=state["statusChatId"],
                        message_id=state["statusMessageId"],
                        text=(
                            "<blockquote>Broadcast in progress!</blockquote>\n\n"
                            f"Estimated time: <code>{format_duration(remaining)}</code>\n"
                            f"Total Users: <code>{state['totalChats']}</code>\n"
                            f"Success: <code>{state['successCount']}</code>\n"
                            f"Blocked: <code>{state['blockedCount']}</code>\n"
                            f"Deleted: <code>{state['deletedCount']}</code>"
                        ),
                        parse_mode="HTML",
                    )
                except Exception:
                    pass
                await asyncio.sleep(10)

        total_time = int(_time.time() * 1000) - state["startTime"]
        total_failed = state["blockedCount"] + state["unknownErrorCount"]
        try:
            await bot.edit_message_text(
                chat_id=state["statusChatId"],
                message_id=state["statusMessageId"],
                text=(
                    "<blockquote>Broadcast completed!</blockquote>\n\n"
                    f"Completed in: <code>{format_duration(total_time)}</code>\n"
                    f"Total Users: <code>{state['totalChats']}</code>\n"
                    f"Success: <code>{state['successCount']}</code>\n"
                    f"Blocked: <code>{state['blockedCount']}</code>\n"
                    f"Deleted: <code>{state['deletedCount']}</code>\n"
                    f"Total Failed: <code>{total_failed}</code>"
                ),
                parse_mode="HTML",
            )
        except Exception:
            pass
        await ws_db.clear_broadcast_state()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("perform_broadcast failed")


async def resume_broadcast() -> None:
    """Resume an interrupted broadcast after restart (called from startup)."""
    ws_db: WordSeekCollection = app.ws_db
    state = await ws_db.load_broadcast_state()
    if not state:
        return
    logger.info("Resuming broadcast from index %s/%s",
                state.get("currentIndex"), state.get("totalChats"))
    try:
        await app.bot.edit_message_text(
            chat_id=state["statusChatId"],
            message_id=state["statusMessageId"],
            text=(
                "<blockquote>Broadcast resumed after restart!</blockquote>\n\n"
                f"Resuming from: <code>{state['currentIndex']}/{state['totalChats']}</code>\n"
                f"Total Users: <code>{state['totalChats']}</code>\n"
                f"Success so far: <code>{state['successCount']}</code>"
            ),
            parse_mode="HTML",
        )
    except Exception as exc:
        logger.warning("Failed to update broadcast status message: %s", exc)
    asyncio.create_task(perform_broadcast(state))


# ══════════════════════════════════════════════
# /captcha (owner, private)
# ══════════════════════════════════════════════

CAPTCHA_SESSION_TTL = 80
CAPTCHA_EXPIRE_SECONDS = 60


def decode_slot(value: int) -> List[str]:
    n = value - 1
    return [
        SLOT_SYMBOLS[n & 3],
        SLOT_SYMBOLS[(n >> 2) & 3],
        SLOT_SYMBOLS[(n >> 4) & 3],
    ]


def format_user_mention(user_id: str, name: Optional[str], username: Optional[str]) -> str:
    if username:
        return f"@{username}"
    return f'<a href="tg://user?id={user_id}">{escape_html_entities(name or "User")}</a>'


def build_captcha_message(mention: Optional[str], progress: List[str],
                          attempts: int, max_attempts: int,
                          status: Optional[str] = None) -> str:
    filled = list(progress)
    while len(filled) < 3:
        filled.append("⬜")
    msg = f"<blockquote>{E.WATCH} <strong>Verification Required</strong></blockquote>\n<blockquote>"
    msg += f"{mention}, please prove that you are not a robot.\n" if mention else \
        "Please prove that you are not a robot.\n"
    msg += f"├ Result: {' '.join(filled)}\n"
    msg += f"├ Attempts: {attempts}/{max_attempts}\n"
    msg += f"├ Status: {status or 'Waiting for input'}\n"
    msg += "└ Instruction: Select the symbols in the exact order shown above."
    msg += "</blockquote>"
    return msg


async def captcha_handler(message: Message, command: CommandObject) -> None:
    if not message.from_user or not message.chat:
        return
    if message.chat.type != "private" or not config.is_admin(message.from_user.id):
        return
    args = command.args.split() if command and command.args else []
    if len(args) < 2:
        return await reply_text(
            message, f"{E.INFO} Usage: /captcha &lt;chatId&gt; &lt;userId&gt;",
            parse_mode="HTML")
    chat_id, user_id = args[0], args[1]

    key = f"captcha:{chat_id}:{user_id}"
    existing = store.get(key)
    if existing:
        return await reply_text(
            message,
            f"{E.WARNING} A captcha is already active for this user.\n\n"
            f"Attempts: {existing.get('attempts', 0)}/3\nStatus: Not yet completed")

    ws_db: WordSeekCollection = app.ws_db
    user = await ws_db.get_user(user_id)
    mention = format_user_mention(user_id, user.get("name") if user else None,
                                  user.get("username") if user else None)

    try:
        dice_msg = await app.bot.send_dice(int(chat_id), emoji="🎰")
        value = dice_msg.dice.value
    except Exception as exc:
        return await reply_text(
            message, f"{E.ERROR} Could not start captcha: {exc}")

    answer = decode_slot(value)
    sent = await app.bot.send_message(
        int(chat_id),
        build_captcha_message(mention, [], 0, 3),
        parse_mode="HTML",
        reply_markup=build_captcha_keyboard([]),
        reply_to_message_id=dice_msg.message_id,
    )

    store.set(key, {
        "chatId": chat_id, "userId": user_id,
        "adminId": str(message.from_user.id),
        "messageId": sent.message_id,
        "answer": answer, "progress": [], "attempts": 0,
        "createdAt": int(__import__("time").time() * 1000),
        "name": user.get("name") if user else None,
        "username": user.get("username") if user else None,
    }, CAPTCHA_SESSION_TTL)

    # 60s expiry task (replaces bullmq delayed job)
    asyncio.create_task(_captcha_expire(chat_id, user_id, sent.message_id))

    mention_text = mention
    await message.reply(
        f"{E.SUCCESS} Captcha sent for {mention_text}.", parse_mode="HTML")


async def _captcha_expire(chat_id: str, user_id: str, message_id: int) -> None:
    await asyncio.sleep(CAPTCHA_EXPIRE_SECONDS)
    key = f"captcha:{chat_id}:{user_id}"
    session = store.get(key)
    if not session:
        return
    store.delete(key)
    try:
        await app.bot.edit_message_text(
            chat_id=int(chat_id),
            message_id=message_id,
            text=f"<blockquote>{E.TIME} Verification expired.</blockquote>\n"
                 "Ask the admin to send a new captcha.",
            parse_mode="HTML",
        )
    except Exception:
        pass
