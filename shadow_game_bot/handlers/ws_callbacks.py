"""WordSeek callback queries (`ws:` prefix).

Port of WordSeek's handlers/callback-query.ts:
leaderboard filters, score filters, multi-user selection, end-game votes,
tabbed help, captcha slots.
"""

import logging

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, CallbackQuery
from aiogram.exceptions import TelegramBadRequest

from shadow_game_bot.context import app
from shadow_game_bot.db.users import UserCollection
from shadow_game_bot.db.wordseek import WordSeekCollection
from shadow_game_bot.emojis import E, EID, plain
from shadow_game_bot.handlers.ws_admin import build_captcha_message, format_user_mention
from shadow_game_bot.handlers.ws_commands import _user_permission
from shadow_game_bot.keyboards.ws import (
    build_captcha_keyboard,
    generate_leaderboard_keyboard,
    generate_user_selection_keyboard,
)
from shadow_game_bot.utils.format_ws import (
    format_leaderboard_message,
    format_no_scores_message,
    format_user_score_message,
)
from shadow_game_bot.utils.parsing import get_smart_defaults
from shadow_game_bot.utils.ttl_store import store

logger = logging.getLogger(__name__)

ALLOWED_SEARCH_KEYS = ("global", "group")
ALLOWED_TIME_KEYS = ("today", "week", "month", "year", "all")
ALLOWED_WORD_LENGTHS = (4, 5, 6)


async def ws_callback_handler(query: CallbackQuery) -> None:
    data = query.data
    if not data:
        return
    if not data.startswith("ws:"):
        return

    await query.answer()
    payload = data[3:]
    user = query.from_user
    chat = query.message.chat if query.message else None
    if not user or not chat:
        return

    db = app.db
    ws_db: WordSeekCollection = app.ws_db

    if await UserCollection(db).is_gbanned(user.id):
        try:
            await query.answer(
                plain(f"{E.BAN} You are globally banned from using this bot."),
                show_alert=True)
        except Exception:
            pass
        return

    try:
        if payload.startswith("leaderboard"):
            await _handle_leaderboard(query, ws_db, payload)
        elif payload.startswith("score_select"):
            await _handle_score_select(query, ws_db, payload)
        elif payload.startswith("score_list"):
            await _handle_score_list(query, ws_db, payload)
        elif payload.startswith("score"):
            await _handle_score(query, ws_db, payload)
        elif payload.startswith("vote_end"):
            await _handle_vote_end(query, ws_db, payload)
        elif payload.startswith("help_"):
            await _handle_help(query, payload)
        elif payload.startswith("captcha_"):
            await _handle_captcha(query, payload)
    except TelegramBadRequest as exc:
        if "message is not modified" not in str(exc):
            logger.warning("ws callback BadRequest: %s", exc)
    except Exception:
        logger.exception("ws callback failed: %s", payload)


# ── Leaderboard ────────────────────────────────

async def _handle_leaderboard(query, ws_db: WordSeekCollection, payload: str) -> None:
    parts = payload.split()
    # parts: ['leaderboard', search, time, length]
    if len(parts) < 4:
        return
    _, search_key, time_key, length_str = parts[0], parts[1], parts[2], parts[3]
    if search_key not in ALLOWED_SEARCH_KEYS or time_key not in ALLOWED_TIME_KEYS:
        return
    try:
        word_length = int(length_str)
    except ValueError:
        return
    if word_length not in ALLOWED_WORD_LENGTHS:
        return
    chat = query.message.chat
    scores = await ws_db.get_leaderboard_scores(str(chat.id), search_key, time_key, word_length)
    keyboard = generate_leaderboard_keyboard(search_key, time_key, word_length)
    try:
        await query.message.edit_text(
            format_leaderboard_message(scores, search_key),
            parse_mode="HTML", reply_markup=keyboard,
            disable_web_page_preview=True,
        )
    except TelegramBadRequest:
        pass


# ── Score: multi-user list ─────────────────────

async def _handle_score_list(query, ws_db: WordSeekCollection, payload: str) -> None:
    parts = payload.split()
    username = parts[1] if len(parts) > 1 else None
    if not username:
        return
    users = await ws_db.find_users_by_username(username)
    if not users:
        try:
            await query.answer("No users found with this username.", show_alert=True)
        except Exception:
            pass
        return
    keyboard = generate_user_selection_keyboard(users, username)
    try:
        await query.message.edit_text(
            f"{E.WARNING} <strong>Multiple Users Found</strong>\n\n"
            f"There are {len(users)} users with username @{username}. "
            "This can happen when a user deletes their account and someone else creates a new "
            "account with the same username.\n\n"
            "Please select the user you want to view:",
            parse_mode="HTML", reply_markup=keyboard,
        )
    except TelegramBadRequest:
        pass


# ── Score: smart defaults on selection ─────────

async def _handle_score_select(query, ws_db: WordSeekCollection, payload: str) -> None:
    parts = payload.split()
    if len(parts) < 3:
        return
    user_id, username = parts[1], parts[2]
    chat = query.message.chat

    user_info = await ws_db.get_user(user_id)
    if not user_info:
        try:
            await query.answer("User not found.", show_alert=True)
        except Exception:
            pass
        return

    defaults = await get_smart_defaults(ws_db, user_id, str(chat.id), None, None, None, chat.type)
    search_key, time_key, word_length = (
        defaults["searchKey"], defaults["timeKey"], defaults["wordLength"])

    user_score = await ws_db.get_user_score(user_id, str(chat.id), search_key, time_key, word_length)

    back = {"text": "⬅️ Back to user list", "callback": f"ws:score_list {username}"}
    if not user_score:
        message = format_no_scores_message(
            False, user_info.get("name"), search_key, time_key, False, defaults["hasAnyScores"])
        keyboard = (
            generate_leaderboard_keyboard(search_key, time_key, word_length,
                                          f"score {user_id}", back)
            if defaults["hasAnyScores"]
            else InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=back["text"], callback_data=back["callback"])]])
        )
        try:
            await query.message.edit_text(message, parse_mode="HTML", reply_markup=keyboard)
        except TelegramBadRequest:
            pass
        return

    keyboard = generate_leaderboard_keyboard(search_key, time_key, word_length,
                                             f"score {user_id}", back)
    try:
        await query.message.edit_text(
            format_user_score_message(user_score, search_key),
            parse_mode="HTML", reply_markup=keyboard, disable_web_page_preview=True)
    except TelegramBadRequest:
        pass


# ── Score: explicit filter row ─────────────────

async def _handle_score(query, ws_db: WordSeekCollection, payload: str) -> None:
    parts = payload.split()
    # parts: ['score', userId, search, time, length]
    if len(parts) < 5:
        return
    user_id, search_key, time_key, length_str = parts[1], parts[2], parts[3], parts[4]
    if search_key not in ALLOWED_SEARCH_KEYS or time_key not in ALLOWED_TIME_KEYS:
        return
    try:
        word_length = int(length_str)
    except ValueError:
        return
    if word_length not in ALLOWED_WORD_LENGTHS:
        return
    chat = query.message.chat

    user_info = await ws_db.get_user(user_id)
    if not user_info:
        try:
            await query.answer("User not found.", show_alert=True)
        except Exception:
            pass
        return

    has_any = await ws_db.has_any_scores(
        user_id,
        chat_id=str(chat.id) if search_key == "group" else None,
        word_length=None,  # scope-wide, like original (no length filter for hasAnyScores here)
    )
    user_score = await ws_db.get_user_score(user_id, str(chat.id), search_key, time_key, word_length)
    keyboard = generate_leaderboard_keyboard(search_key, time_key, word_length, f"score {user_id}")

    if not user_score:
        is_own = query.from_user and str(query.from_user.id) == user_id
        message = format_no_scores_message(
            is_own, user_info.get("name"), search_key, time_key, True, has_any)
        try:
            await query.message.edit_text(message, parse_mode="HTML", reply_markup=keyboard)
        except TelegramBadRequest:
            pass
        return

    try:
        await query.message.edit_text(
            format_user_score_message(user_score, search_key),
            parse_mode="HTML", reply_markup=keyboard, disable_web_page_preview=True)
    except TelegramBadRequest:
        pass


# ── Vote to end ────────────────────────────────

async def _handle_vote_end(query, ws_db: WordSeekCollection, payload: str) -> None:
    parts = payload.split()
    if len(parts) < 2:
        return
    try:
        vote_chat_id = int(parts[1])
    except ValueError:
        return

    chat = query.message.chat
    if chat.id != vote_chat_id:
        try:
            await query.answer("This vote is not for this chat.", show_alert=True)
        except Exception:
            pass
        return

    existing_game = await ws_db.get_any_game(str(chat.id))
    if not existing_game:
        try:
            await query.answer("No active game found.", show_alert=True)
        except Exception:
            pass
        return

    user = query.from_user
    user_id = str(user.id)
    vote_key = f"vote:{chat.id}"
    vote_data = store.get(vote_key)
    if not vote_data:
        try:
            await query.answer("The voting session has expired.", show_alert=True)
        except Exception:
            pass
        return

    if user_id in vote_data.get("voters", []):
        try:
            await query.answer("You have already voted.")
        except Exception:
            pass
        return

    permitted, reason = await _user_permission(query.message, existing_game)
    if permitted:
        try:
            await query.message.delete()
        except Exception:
            pass
        await _ws_end_game_for_vote(chat, existing_game["word"], reason)
        try:
            await query.answer("Game ended by admin/game starter! 🎯", show_alert=True)
        except Exception:
            pass
        return

    vote_data["voters"].append(user_id)

    if len(vote_data["voters"]) >= 3:
        store.delete(vote_key)
        try:
            await query.message.delete()
        except Exception:
            pass
        await _ws_end_game_for_vote(chat, existing_game["word"],
                                    "<b>Game ended - 3 players voted to end the game</b>")
        try:
            await query.answer("Game ended! Voting threshold reached. 🎯", show_alert=True)
        except Exception:
            pass
        return

    store.set(vote_key, vote_data, 300)
    votes_needed = 3 - len(vote_data["voters"])
    try:
        await query.message.edit_text(
            f"<b>{E.INFO} Vote to End Game</b>\n\n"
            "Players are voting to end the game.\n\n"
            "<b>Votes needed: 3 total</b>\n"
            f"<b>Current votes: {len(vote_data['voters'])}/3</b>\n\n"
            "React with the button below to vote for ending the game.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(
                    text=f"Vote to End ({len(vote_data['voters'])}/3)",
                    callback_data=f"ws:vote_end {chat.id}",
                    style="danger",
                    icon_custom_emoji_id=EID.CROSS),
            ]]),
        )
    except TelegramBadRequest:
        pass
    try:
        await query.answer(f"Vote recorded! {votes_needed} more votes needed.")
    except Exception:
        pass


async def _ws_end_game_for_vote(chat, word: str, reason: str) -> None:
    ws_db: WordSeekCollection = app.ws_db
    await ws_db.delete_game_by_chat(str(chat.id))
    word_length = len(word) if word else 5
    await app.bot.send_message(
        chat.id,
        f"<blockquote>🎮 <b>Game Ended</b>\nCorrect Word: <b>{word}</b></blockquote>\n"
        f"<blockquote>{reason + chr(10) if reason else ''}Start a new game with /new{word_length}</blockquote>",
        parse_mode="HTML",
    )


# ── Tabbed help (legacy ws:help_* → Pi menu) ──

async def _handle_help(query, payload: str) -> None:
    """Map legacy ``ws:help_<section>`` buttons onto the Pi menu pages."""
    from shadow_game_bot.handlers.menu import legacy_edit

    section = payload[5:]  # strip 'help_'
    await legacy_edit(query, section)


# ── Captcha ────────────────────────────────────

async def _handle_captcha(query, payload: str) -> None:
    user = query.from_user
    chat = query.message.chat
    if not user:
        return
    chat_id = str(chat.id)
    user_id = str(user.id)
    key = f"captcha:{chat_id}:{user_id}"

    session = store.get(key)
    if not session:
        try:
            await query.answer("Captcha expired or, this captcha isn't for you.", show_alert=True)
        except Exception:
            pass
        return

    mention = format_user_mention(user_id, session.get("name"), session.get("username"))

    if payload == "captcha_clear":
        session["progress"] = []
    elif payload == "captcha_back":
        session["progress"].pop() if session["progress"] else None
    elif payload.startswith("captcha_pick"):
        pick_parts = payload.split()
        emoji = pick_parts[1] if len(pick_parts) > 1 else None
        if emoji and len(session["progress"]) < 3:
            session["progress"].append(emoji)

    keyboard = build_captcha_keyboard(session["progress"])

    if len(session["progress"]) == 3:
        success = session["progress"] == session["answer"]
        if success:
            store.delete(key)
            try:
                await app.bot.send_message(
                    int(session["adminId"]),
                    f"✅ {mention} passed the captcha.", parse_mode="HTML")
            except Exception:
                pass
            try:
                await query.message.edit_text(
                    build_captcha_message(mention, session["progress"], session["attempts"], 3,
                                          "Verification successful ✅"),
                    parse_mode="HTML")
            except TelegramBadRequest:
                pass
            return

        session["attempts"] += 1
        if session["attempts"] >= 3:
            store.delete(key)
            try:
                await app.bot.send_message(
                    int(session["adminId"]),
                    f"❌ {mention} failed the captcha.\n"
                    f"Expected: {' '.join(session['answer'])}\n"
                    f"Got: {' '.join(session['progress'])}", parse_mode="HTML")
            except Exception:
                pass
            try:
                await query.message.edit_text(
                    build_captcha_message(mention, session["answer"], session["attempts"], 3,
                                          "Verification failed ❌"),
                    parse_mode="HTML")
            except TelegramBadRequest:
                pass
            return

        session["progress"] = []
        store.set(key, session, 60)
        try:
            await query.message.edit_text(
                build_captcha_message(mention, [], session["attempts"], 3,
                                      "Incorrect selection. Try again."),
                parse_mode="HTML", reply_markup=keyboard)
        except TelegramBadRequest:
            pass
        return

    store.set(key, session, 60)
    try:
        await query.message.edit_text(
            build_captcha_message(mention, session["progress"], session["attempts"], 3),
            parse_mode="HTML", reply_markup=keyboard)
    except TelegramBadRequest:
        pass
