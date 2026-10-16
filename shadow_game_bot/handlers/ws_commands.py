"""WordSeek game commands: /new, /end, /daily, /leaderboard, /score, /id.

Port of WordSeek's commands/{new-game,end-game,daily,leaderboard,score,my-score,id}.ts
Merged routing decisions:
  * /new*  → WordSeek    * /game → Shadow Word Guess (start.py)
  * /end   → WordSeek    * /stop /endgame → Shadow
  * /score → smart (args → WordSeek; active shadow game → shadow board; else WordSeek)
  * /ranking → Shadow scoreboard (unchanged)
"""

import logging
from datetime import datetime, timezone

from aiogram.types import InlineKeyboardMarkup, Message
from aiogram.filters import CommandObject

from shadow_game_bot.config import config
from shadow_game_bot.context import app
from shadow_game_bot.db.games import GamesCollection
from shadow_game_bot.db.users import UserCollection
from shadow_game_bot.db.wordseek import WordSeekCollection
from shadow_game_bot.emojis import E, EID
from shadow_game_bot.handlers.ws_messages import (
    MAX_DAILY_ATTEMPTS, get_topic_id, require_allowed_topic,
    set_daily_session, get_daily_session, clear_daily_session,
)
from shadow_game_bot.keyboards.colored import btn_danger
from shadow_game_bot.keyboards.ws import (
    generate_leaderboard_keyboard,
)
from shadow_game_bot.reply import reply_text
from shadow_game_bot.services.daily_word import ensure_daily_word, get_current_game_date_string
from shadow_game_bot.utils.format_ws import (
    escape_html_entities,
    format_leaderboard_message,
    format_no_scores_message,
    format_user_score_message,
)
from shadow_game_bot.utils.parsing import (
    parse_leaderboard_filters, parse_leaderboard_input, get_smart_defaults,
)
from shadow_game_bot.utils.ttl_store import store
from shadow_game_bot.utils.word_selector import WordSelector

logger = logging.getLogger(__name__)

GLOBAL_VALID_LENGTHS = [5, 4, 6]


# ── Helpers ───────────────────────────────────

async def _gban_check(message: Message) -> bool:
    """True when the user is gbanned (and the reply was sent)."""
    if not message.from_user:
        return False
    db = app.db
    if await UserCollection(db).is_gbanned(message.from_user.id):
        await reply_text(message, f"{E.BAN} You are globally banned from using this bot.")
        return True
    return False


async def _run_topic_guard(message: Message) -> bool:
    """Returns True when the update should stop (error already sent)."""
    ws_db: WordSeekCollection = app.ws_db
    err = await require_allowed_topic(message, ws_db)
    if err:
        await reply_text(message, f"{E.WARNING} {err}")
        return True
    return False


async def _require_admin(message: Message) -> bool:
    """True when the user is a group admin (or bot admin in private); replies on failure."""
    chat = message.chat
    user = message.from_user
    if not chat or not user:
        return False
    if chat.type == "private":
        return True
    if config.is_admin(user.id):
        return True
    try:
        member = await app.bot.get_chat_member(chat.id, user.id)
        if member.status in ("administrator", "creator"):
            return True
    except Exception:
        pass
    await reply_text(message, f"{E.LOCK} Only admins can use this command.")
    return False


# ── /new /new4 /new5 /new6 ────────────────────

async def _start_new_game(message: Message, forced_length=None,
                          command: CommandObject | None = None) -> None:
    if not message.chat or not message.from_user:
        return
    if await _gban_check(message):
        return
    if await _run_topic_guard(message):
        return
    # requireNoActiveDailyGame (original regularGameGuards)
    if get_daily_session(message.from_user.id):
        await reply_text(
            message,
            f"{E.WARNING} You have an active WordSeek of the Day game in your private chat. "
            "Please pause it with /pausedaily before playing regular WordSeek.")
        return

    chat = message.chat
    chat_id = str(chat.id)
    topic_id = get_topic_id(message)
    ws_db: WordSeekCollection = app.ws_db

    topic_settings = await ws_db.get_topic(chat_id, topic_id)
    allowed_raw = (topic_settings or {}).get("allowed_lengths") or "5,4,6"
    allowed_lengths = [int(x) for x in allowed_raw.split(",") if x.strip().isdigit()]
    if not allowed_lengths:
        allowed_lengths = list(GLOBAL_VALID_LENGTHS)

    if forced_length is not None:
        if forced_length not in allowed_lengths:
            await reply_text(
                message,
                f"{E.WARNING} Only these lengths are allowed in this topic: "
                f"{', '.join(map(str, allowed_lengths))}.")
            return
        word_length = forced_length
    else:
        length_arg = (command.args.split()[0] if command and command.args else "").strip()
        if length_arg:
            try:
                parsed = int(length_arg)
            except ValueError:
                parsed = -1
            if parsed not in allowed_lengths:
                await reply_text(
                    message,
                    f"{E.WARNING} Only these lengths are allowed in this topic: "
                    f"{', '.join(map(str, allowed_lengths))}.")
                return
            word_length = parsed
        else:
            word_length = allowed_lengths[0]

    selector = WordSelector(ws_db)
    try:
        random_word = await selector.get_random_word(chat_id, word_length)
    except RuntimeError as exc:
        logger.error("Word select failed: %s", exc)
        await reply_text(
            message, f"{E.ERROR} Something went wrong. Please try again.")
        return

    created = await ws_db.create_game(random_word, chat_id, topic_id,
                                      str(message.from_user.id))
    if not created:
        await reply_text(
            message,
            f"{E.WARNING} There is already a game in progress in this chat. "
            "Use /end to end the current game.")
        return
    await reply_text(
        message,
        f"{E.GAME} <b>Game started!</b> Guess the {word_length}-letter word!",
        parse_mode="HTML")


async def new_game_handler(message: Message, command: CommandObject) -> None:
    await _start_new_game(message, None, command)


async def new4_handler(message: Message) -> None:
    await _start_new_game(message, 4)


async def new5_handler(message: Message) -> None:
    await _start_new_game(message, 5)


async def new6_handler(message: Message) -> None:
    await _start_new_game(message, 6)


# ── /end ──────────────────────────────────────

async def _ws_end_game(message: Message, word: str, reason: str) -> None:
    ws_db: WordSeekCollection = app.ws_db
    chat_id = str(message.chat.id)
    await ws_db.delete_game_by_chat(chat_id)
    word_length = len(word) if word else 5
    await message.reply(
        f"<blockquote>{E.GAME} <b>Game Ended</b>\nCorrect Word: <b>{escape_html_entities(word)}</b></blockquote>\n"
        f"<blockquote>{reason + chr(10) if reason else ''}Start a new game with /new{word_length}</blockquote>",
        parse_mode="HTML",
    )


async def is_user_authorized(user_id: str, chat_id: str) -> bool:
    ws_db: WordSeekCollection = app.ws_db
    return await ws_db.is_authorized(user_id, chat_id)


async def _user_permission(message: Message, game) -> tuple:
    """Returns (permitted, reason_html). Mirrors end-game.ts checks."""
    chat = message.chat
    user = message.from_user
    chat_id = str(chat.id)
    user_id = str(user.id)
    is_private = chat.type == "private"
    is_system_admin = config.is_admin(user.id)
    is_game_starter = game.get("started_by") == user_id
    is_authorized = await is_user_authorized(user_id, chat_id)
    is_admin = False
    if not is_private:
        try:
            member = await app.bot.get_chat_member(chat.id, user.id)
            is_admin = member.status in ("administrator", "creator")
        except Exception:
            is_admin = False

    permitted = is_admin or is_system_admin or is_game_starter or is_authorized or is_private
    name = user.full_name
    link = f'<a href="tg://user?id={user.id}">{escape_html_entities(name)}</a>'
    if is_private:
        reason = ""
    elif is_game_starter:
        reason = f"<b>Ended by game starter: </b>{link}"
    elif is_system_admin:
        reason = f"<b>Ended by system administrator: </b>{link}"
    elif is_admin:
        reason = f"<b>Ended by group administrator: </b>{link}"
    elif is_authorized:
        reason = f"<b>Ended by authorized user: </b>{link}"
    else:
        reason = f"<b>Ended by: </b>{link}"
    return permitted, reason


async def end_game_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    if await _gban_check(message):
        return
    if await _run_topic_guard(message):
        return

    chat_id = str(message.chat.id)
    ws_db: WordSeekCollection = app.ws_db
    current_game = await ws_db.get_game(chat_id, get_topic_id(message))
    if not current_game:
        current_game = await ws_db.get_any_game(chat_id)
    if not current_game:
        return await reply_text(message, f"{E.INFO} There is no game in progress.")

    permitted, reason = await _user_permission(message, current_game)
    if permitted:
        return await _ws_end_game(message, current_game["word"], reason)

    # Voting flow
    user = message.from_user
    vote_key = f"vote:{message.chat.id}"
    existing_votes = store.get(vote_key)
    if existing_votes:
        return await reply_text(
            message,
            f"{E.TIME} A vote to end the game is already in progress. "
            "Please wait for it to complete.")

    store.set(vote_key, {"voters": [str(user.id)], "initiatedAt": datetime.now(timezone.utc).timestamp()}, 300)
    name = user.full_name
    link = f'<a href="tg://user?id={user.id}">{escape_html_entities(name)}</a>'
    await message.reply(
        f"<b>{E.INFO} Vote to End Game</b>\n\n"
        f"{link} wants to end the game.\n\n"
        "<b>Votes needed: 3 out of remaining players</b>\n"
        "<b>Current votes: 1/3</b>\n\n"
        "React with the button below to vote for ending the game.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            btn_danger("Vote to End (1/3)",
                       f"ws:vote_end {message.chat.id}",
                       icon_emoji_id=EID.CROSS),
        ]]),
    )


# ── /daily & /pausedaily ──────────────────────

async def daily_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    try:
        if message.chat.type != "private":
            return await reply_text(
                message,
                f"{E.WARNING} WordSeek of the Day can only be played in private chat "
                "with the bot. Send me a message directly!")
        if await _gban_check(message):
            return

        user_id = str(message.from_user.id)
        db = app.db
        ws_db: WordSeekCollection = app.ws_db

        # Guard: regular WordSeek game running in this private chat
        # (original: games.activeChat == userId — private chat id == user id)
        if await ws_db.get_any_game(user_id):
            return await reply_text(
                message,
                f"{E.WARNING} You have an active regular WordSeek game. "
                "Please complete or end that game with /end before starting "
                "WordSeek of the Day.")

        game_date = get_current_game_date_string()
        daily_word = await ensure_daily_word(ws_db, game_date)
        if not daily_word:
            return await reply_text(
                message,
                f"{E.ERROR} Today's WordSeek is not ready yet due to a server issue. "
                "Please try again in a few moments!")

        await ws_db.ensure_user_stats(user_id)
        existing = await ws_db.get_daily_guesses(user_id, daily_word["id"])

        if existing:
            last = existing[-1]
            if last["guess"] == daily_word["word"]:
                return await reply_text(
                    message,
                    f"{E.SUCCESS} You've already completed today's WordSeek! "
                    f"You got it in {len(existing)} "
                    f"{'try' if len(existing) == 1 else 'tries'}. "
                    "Come back after 6:00 AM tomorrow for a new challenge!")
            if len(existing) >= MAX_DAILY_ATTEMPTS:
                return await reply_text(
                    message,
                    f"{E.ERROR} You've already used all {MAX_DAILY_ATTEMPTS} attempts "
                    f"for today's WordSeek.\nThe word was: "
                    f"<b>{daily_word['word'].upper()}</b>\n\n"
                    "Come back after 6:00 AM tomorrow for a new challenge!",
                    parse_mode="HTML")

        set_daily_session(message.from_user.id, daily_word["id"], game_date)

        attempts_used = len(existing)
        if attempts_used > 0:
            from shadow_game_bot.handlers.ws_messages import get_feedback, to_fancy_text
            attempts_left = MAX_DAILY_ATTEMPTS - attempts_used
            grid = get_feedback(existing, daily_word["word"])
            return await message.reply(
                f"<i>{E.CLOCK} Daily WordSeek · {attempts_used}/{MAX_DAILY_ATTEMPTS}</i>\n\n"
                f"{to_fancy_text(grid)}\n\n"
                f"Welcome back! You have {attempts_left} "
                f"{'attempt' if attempts_left == 1 else 'attempts'} left for today's WordSeek. Keep guessing!",
                parse_mode="HTML",
            )

        await reply_text(
            message,
            f"{E.GAME} <b>WordSeek of the Day started!</b> Guess the 5-letter word. "
            f"You have {MAX_DAILY_ATTEMPTS} attempts. Good luck!",
            parse_mode="HTML")
    except Exception:
        logger.exception("daily command failed")
        await reply_text(message, f"{E.ERROR} Something went wrong. Please try again.")


async def pausedaily_handler(message: Message) -> None:
    if not message.from_user:
        return
    if not get_daily_session(message.from_user.id):
        return await reply_text(
            message,
            f"{E.INFO} You don't have an active WordSeek of the Day game to pause.")
    clear_daily_session(message.from_user.id)
    await reply_text(
        message,
        f"{E.SUCCESS} Your WordSeek of the Day game has been paused. "
        "You can now play regular WordSeek.\n\n"
        "To play today's WordSeek again, use /daily "
        "(your previous attempts will still count).")


# ── /leaderboard ──────────────────────────────

async def leaderboard_handler(message: Message, command: CommandObject) -> None:
    if not message.chat:
        return
    if await _gban_check(message):
        return
    if await _run_topic_guard(message):
        return

    chat_id = str(message.chat.id)
    chat_type = message.chat.type
    ws_db: WordSeekCollection = app.ws_db

    raw = command.args if command and command.args else ""
    default_search = "global" if chat_type == "private" else None
    search_key, time_key, word_length = parse_leaderboard_filters(raw, default_search or "group")

    keyboard = generate_leaderboard_keyboard(search_key, time_key, word_length)
    scores = await ws_db.get_leaderboard_scores(chat_id, search_key, time_key, word_length)
    await message.reply(
        format_leaderboard_message(scores, search_key),
        parse_mode="HTML", reply_markup=keyboard, disable_notification=True,
    )


# ── /score (WordSeek scoring) ─────────────────

async def get_target_user(message: Message, identifier, fallback=True):
    """Port of seekauth.getTargetUser."""
    user = message.from_user

    if fallback and not identifier and user and str(message.chat.id) == str(user.id):
        return {"id": str(user.id), "name": user.full_name, "username": user.username}

    reply = message.reply_to_message if message else None
    if reply and reply.from_user and not reply.from_user.is_bot and not reply.is_topic_message:
        u = reply.from_user
        return {"id": str(u.id), "name": u.full_name, "username": u.username}

    if fallback and not identifier and user:
        return {"id": str(user.id), "name": user.full_name, "username": user.username}

    ws_db: WordSeekCollection = app.ws_db

    # text_mention entities
    for entity in (message.entities if message and message.entities else []):
        if entity.type == "text_mention" and entity.user:
            u = entity.user
            if str(message.chat.id) == str(u.id) and not identifier and not reply:
                pass
            await ws_db.upsert_user(str(u.id), u.full_name, u.username)
            return {"id": str(u.id), "name": u.full_name, "username": u.username}

    if identifier:
        if identifier.startswith("@"):
            users = await ws_db.find_users_by_username(identifier[1:])
            return users[0] if users else None
        if identifier.isdigit():
            try:
                member = await app.bot.get_chat_member(message.chat.id, int(identifier))
                u = member.user
                return {"id": str(u.id), "name": u.full_name, "username": u.username}
            except Exception:
                pass
            return await ws_db.get_user(identifier)
    return None


async def score_handler(message: Message, command: CommandObject) -> None:
    if not message.chat or not message.from_user:
        return
    if await _gban_check(message):
        return
    if await _run_topic_guard(message):
        return

    raw = command.args if command and command.args else ""

    # ── Merge decision: no args + active Shadow game → Shadow scoreboard
    if not raw:
        chat_id = message.chat.id
        db = app.db
        game = await GamesCollection(db).get_active_game(chat_id)
        if game:
            from shadow_game_bot.handlers.commands import ranking_handler
            return await ranking_handler(message)

    chat_id = str(message.chat.id)
    chat_type = message.chat.type
    ws_db: WordSeekCollection = app.ws_db

    # parse_leaderboard_input returns (search_key, time_key, word_length, target)
    requested_search, requested_time, requested_length, target = parse_leaderboard_input(
        raw, default_time_key=None)
    is_own_score = not target

    target_user = await get_target_user(message, target, fallback=True)
    if not target_user:
        return await reply_text(message, f"{E.INFO} User not found.")

    defaults = await get_smart_defaults(
        ws_db, target_user["id"], chat_id,
        requested_search, requested_time, requested_length, chat_type)
    search_key = defaults["searchKey"]
    time_key = defaults["timeKey"]
    word_length = defaults["wordLength"]
    has_any = defaults["hasAnyScores"]

    keyboard = generate_leaderboard_keyboard(search_key, time_key, word_length,
                                             f"score {target_user['id']}")
    user_score = await ws_db.get_user_score(target_user["id"], chat_id, search_key,
                                            time_key, word_length)

    if not user_score:
        message_text = format_no_scores_message(
            is_own_score, target_user.get("username") or target_user.get("name"),
            search_key, time_key, requested_time is not None, has_any)
        return await message.reply(message_text, parse_mode="HTML", reply_markup=keyboard)

    await message.reply(
        format_user_score_message(user_score, search_key),
        parse_mode="HTML", reply_markup=keyboard, disable_notification=True,
    )


async def myscore_handler(message: Message) -> None:
    await reply_text(
        message,
        f"{E.INFO} Please switch to the /score command. "
        "It's a replacement for /myscore.")


# ── /id ───────────────────────────────────────

async def id_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    if chat.type != "private":
        try:
            member = await app.bot.get_chat_member(chat.id, message.from_user.id)
            if member.status not in ("administrator", "creator") and not config.is_admin(message.from_user.id):
                return
        except Exception:
            return

    replied = message.reply_to_message
    if not replied:
        return await reply_text(
            message,
            f"{E.INFO} Please reply to a message to get its information.")

    info = f"<b>{E.INFO} ▸ Message Information</b>\n<blockquote>"
    info += f"<b>Message ID:</b> <code>{replied.message_id}</code>\n"
    info += f"<b>Date:</b> {replied.date.astimezone().strftime('%Y-%m-%d %H:%M:%S')}"
    info += "</blockquote>\n\n"

    if replied.from_user:
        u = replied.from_user
        info += "<b>▸ User Information</b>\n<blockquote>"
        info += f"<b>User ID:</b> <code>{u.id}</code>\n"
        info += f"<b>First Name:</b> {escape_html_entities(u.first_name)}\n"
        if u.last_name:
            info += f"<b>Last Name:</b> {escape_html_entities(u.last_name)}\n"
        if u.username:
            info += f"<b>Username:</b> @{u.username}\n"
        info += f"<b>Is Bot:</b> {'Yes' if u.is_bot else 'No'}"
        info += "</blockquote>\n\n"

    info += "<b>▸ Chat Information</b>\n<blockquote>"
    info += f"<b>Chat ID:</b> <code>{chat.id}</code>\n"
    info += f"<b>Chat Type:</b> {chat.type}"
    if chat.title:
        info += f"\n<b>Chat Title:</b> {escape_html_entities(chat.title)}"
    if chat.username:
        info += f"\n<b>Chat Username:</b> @{chat.username}"
    info += "</blockquote>"

    if replied.text:
        info += f"\n\n<b>▸ Text Content</b>\n<blockquote><b>Length:</b> {len(replied.text)} characters</blockquote>"
    if replied.caption:
        info += f"\n\n<b>▸ Caption</b>\n<blockquote><b>Length:</b> {len(replied.caption)} characters</blockquote>"

    await message.reply(info, parse_mode="HTML")
