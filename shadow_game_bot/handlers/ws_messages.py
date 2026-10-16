"""WordSeek message handlers — group guessing + Daily WordSeek (DM).

Port of WordSeek's handlers/on-message.tsx + commands/daily.ts logic.
Daily grids use text emoji (🟩🟨🟥 / share 🟩🟨⬛) instead of PNG images.
"""

import logging
import random
import re
from typing import Dict, List, Optional

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, ReactionTypeEmoji

from shadow_game_bot.context import app
from shadow_game_bot.db.wordseek import WordSeekCollection
from shadow_game_bot.emojis import E, EID
from shadow_game_bot.reply import reply_text
from shadow_game_bot.services.daily_word import get_current_game_date_string
from shadow_game_bot.utils.fancy_text import to_fancy_text
from shadow_game_bot.utils.format_ws import format_daily_word_details
from shadow_game_bot.utils.ttl_store import store

logger = logging.getLogger(__name__)

VALID_WORD_RE = re.compile(r"^[a-z]{4,6}$")

MODE_LABEL = {4: "4-letter mode", 5: "5-letter mode", 6: "6-letter mode"}
MAX_REGULAR_GUESSES = 30
MAX_DAILY_ATTEMPTS = 6

DAILY_SESSION_TTL = 86400  # seconds — matches original redis setex

ALL_WORD_LISTS: Dict[int, List[str]] = {}

#: Files are named by word, not digit (all-four.json), matching the
#: original WordSeek data directory.
_ALL_LIST_FILES = {4: "all-four.json", 5: "all-five.json", 6: "all-six.json"}


def _load_all_words(length: int) -> List[str]:
    if length not in ALL_WORD_LISTS:
        import json
        from pathlib import Path
        name = _ALL_LIST_FILES.get(length, f"all-{length}.json")
        path = Path(__file__).resolve().parent.parent.parent / "data" / name
        try:
            ALL_WORD_LISTS[length] = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.error("Failed to load %s: %s", name, exc)
            ALL_WORD_LISTS[length] = []
    return ALL_WORD_LISTS[length]


# ────────────────────────────────────────────────
# Feedback grids
# ────────────────────────────────────────────────

def _tile_states(guess: str, solution: str) -> List[str]:
    """Return per-letter states: 'correct' | 'present' | 'absent'."""
    guess = guess.upper()
    sol = solution.upper()
    counts: Dict[str, int] = {}
    for ch in sol:
        counts[ch] = counts.get(ch, 0) + 1
    result = ["absent"] * len(guess)
    for i, ch in enumerate(guess):
        if ch == sol[i]:
            result[i] = "correct"
            counts[ch] -= 1
    for i, ch in enumerate(guess):
        if result[i] == "absent" and counts.get(ch, 0) > 0:
            result[i] = "present"
            counts[ch] -= 1
    return result


def get_feedback(rows: List[Dict], solution: str) -> str:
    """Regular game feedback — spaced colored tiles + word (to_fancy_text'd)."""
    lines = []
    for entry in rows:
        guess = entry["guess"].upper()
        states = _tile_states(guess, solution)
        tiles = {"correct": "🟩", "present": "🟨", "absent": "🟥"}
        feedback = " ".join(tiles[s] for s in states)
        lines.append(f"{feedback} {guess}")
    return "\n".join(lines)


def generate_wordle_share_text(day_number: int, guesses: List[Dict], solution: str) -> str:
    """Daily share grid — compact squares (🟩🟨⬛) for switch_inline_query."""
    lines = []
    for entry in guesses:
        states = _tile_states(entry["guess"], solution)
        tiles = {"correct": "🟩", "present": "🟨", "absent": "⬛"}
        lines.append("".join(tiles[s] for s in states))
    attempt_line = f"{day_number} {len(guesses)}/{MAX_DAILY_ATTEMPTS}"
    return (f"WordSeek {attempt_line}\n\n" + "\n".join(lines) +
            "\nTry yourself by using /daily command.")


async def react_with_random(message: Message) -> None:
    for emoji in random.sample(["🎉", "🏆", "🤩", "⚡", "🫡", "💯", "❤‍🔥", "🦄"], k=8):
        try:
            await message.react([ReactionTypeEmoji(emoji=emoji)])
            return
        except Exception:
            continue


# ────────────────────────────────────────────────
# Group text → WordSeek guess
# ────────────────────────────────────────────────

def get_topic_id(message: Message) -> str:
    return str(message.message_thread_id) if message.message_thread_id else "general"


async def require_allowed_topic(message: Message, ws_db: WordSeekCollection) -> Optional[str]:
    """Port of guards.requireAllowedTopic. Returns an error message or None."""
    chat = message.chat
    if not chat or not chat.is_forum:
        return None
    topics = await ws_db.get_chat_topics(str(chat.id))
    if not topics:
        return None
    topic_ids = [t["topic_id"] for t in topics]
    if get_topic_id(message) not in topic_ids:
        return "This topic is not set for the game. Please play the game in the designated topic."
    return None


async def handle_ws_group_guess(message: Message,
                                ws_db: WordSeekCollection) -> bool:
    """Try to process the message as a WordSeek group guess.

    Returns True when the message was consumed (or should be consumed).
    """
    chat = message.chat
    user = message.from_user
    if not chat or not user:
        return False

    text = (message.text or "").strip().lower()
    if not text or text.startswith("/") or not VALID_WORD_RE.match(text):
        return False

    chat_id = str(chat.id)
    topic_id = get_topic_id(message)

    game = await ws_db.get_game(chat_id, topic_id)
    if not game:
        return False

    # Topic restriction
    topic_error = await require_allowed_topic(message, ws_db)
    if topic_error:
        await reply_text(message, f"{E.WARNING} {topic_error}")
        return True

    word_length = len(game["word"])
    if len(text) != word_length:
        return True  # silently ignore wrong-length words (original behavior)

    valid_words = _load_all_words(word_length)
    if valid_words and text not in valid_words:
        await reply_text(
            message, f"{E.ERROR} {text} is not a valid {word_length}-letter word.")
        return True

    if await ws_db.guess_exists(game["id"], text):
        await reply_text(
            message,
            f"{E.WARNING} Someone has already guessed your word. "
            "Please try another one!")
        return True

    if text == game["word"]:
        if not user.is_bot:
            all_guesses = await ws_db.get_guesses(game["id"])
            score = MAX_REGULAR_GUESSES - len(all_guesses)
            await ws_db.upsert_user(str(user.id), user.full_name, user.username)
            await ws_db.add_score(str(user.id), chat_id, score, str(word_length))
            extra = f"Added {score} to the leaderboard."
            response = (
                f"<blockquote>{E.SUCCESS} Congrats! You guessed it correctly.\n"
                f"Correct Word: <b>{text}</b>\n{extra}</blockquote>\n"
                f"Start with /new{word_length}"
            )
        else:
            response = (
                f"<blockquote>{E.SUCCESS} Congrats! You guessed it correctly.\n"
                f"Correct Word: <b>{text}</b>\n</blockquote>"
                "Anonymous admins or channels don't get points.\n"
                f"Start with /new{word_length}"
            )
        await message.reply(response, parse_mode="HTML")
        await react_with_random(message)
        await ws_db.delete_game(game["id"])
        return True

    await ws_db.add_guess(game["id"], text, chat_id)
    all_guesses = await ws_db.get_guesses(game["id"])

    if len(all_guesses) >= MAX_REGULAR_GUESSES:
        await ws_db.delete_game(game["id"])
        await reply_text(
            message,
            f"{E.GAME} Game Over! The word was <b>{game['word'].upper()}</b>\n"
            f"You can start a new game with /new{word_length}",
            parse_mode="HTML")
        return True

    response = (
        f"<i>{MODE_LABEL.get(word_length, f'{word_length}-letter mode')} · "
        f"{len(all_guesses)}/{MAX_REGULAR_GUESSES}</i>\n\n" +
        to_fancy_text(get_feedback(all_guesses, game["word"]))
    )
    await message.reply(response, parse_mode="HTML")
    return True


# ────────────────────────────────────────────────
# Daily WordSeek (private chat)
# ────────────────────────────────────────────────

def daily_session_key(user_id: int) -> str:
    return f"daily:{user_id}"


def get_daily_session(user_id: int) -> Optional[Dict]:
    data = store.get(daily_session_key(user_id))
    if isinstance(data, dict) and "dailyWordId" in data and "date" in data:
        return data
    return None


def set_daily_session(user_id: int, daily_word_id: int, date_str: str) -> None:
    store.set(daily_session_key(user_id),
              {"dailyWordId": daily_word_id, "date": date_str}, DAILY_SESSION_TTL)


def clear_daily_session(user_id: int) -> None:
    store.delete(daily_session_key(user_id))


async def handle_private_message(message: Message) -> None:
    """Private text: Daily WordSeek first, then Shadow's DM word workflow."""
    from shadow_game_bot.handlers.private import private_message_handler

    user = message.from_user
    if not user:
        return

    text = (message.text or "").strip()
    if not text or text.startswith("/"):
        return

    # Daily session active?
    session = get_daily_session(user.id)
    if session:
        today = get_current_game_date_string()
        if session["date"] != today:
            clear_daily_session(user.id)
            await reply_text(
                message,
                f"{E.INFO} Your previous game has expired. "
                "Please start today's WordSeek with /daily")
            return
        await _handle_daily_guess(message, text.lower())
        return

    # Otherwise: Shadow Game word submission (existing workflow)
    await private_message_handler(message)


async def _handle_daily_guess(message: Message, guess: str) -> None:
    user = message.from_user
    if not user:
        return

    ws_db: WordSeekCollection = app.ws_db
    user_id = str(user.id)

    if not VALID_WORD_RE.match(guess) or len(guess) != 5:
        await reply_text(
            message, f"{E.ERROR} {guess.upper()} is not a valid word.")
        return

    if guess not in _load_all_words(5):
        await reply_text(
            message, f"{E.ERROR} {guess.upper()} is not a valid word.")
        return

    today = get_current_game_date_string()
    daily_word = await ws_db.get_daily_word_by_date(today)
    if not daily_word:
        await reply_text(
            message,
            f"{E.ERROR} Today's WordSeek is not available. Please try again later.")
        return

    existing = await ws_db.get_daily_guesses(user_id, daily_word["id"])
    if any(g["guess"] == guess for g in existing):
        await reply_text(
            message,
            f"{E.WARNING} You've already guessed this word. Try a different one!")
        return

    attempt_number = len(existing) + 1
    await ws_db.add_daily_guess(user_id, daily_word["id"], guess, attempt_number)
    all_guesses = await ws_db.get_daily_guesses(user_id, daily_word["id"])

    if guess == daily_word["word"]:
        await _handle_daily_win(message, daily_word, all_guesses)
        return

    if len(all_guesses) >= MAX_DAILY_ATTEMPTS:
        await _handle_daily_loss(message, daily_word, all_guesses)
        return

    attempts_left = MAX_DAILY_ATTEMPTS - len(all_guesses)
    grid = get_feedback(all_guesses, daily_word["word"])
    await message.reply(
        f"<i>Daily WordSeek · {len(all_guesses)}/{MAX_DAILY_ATTEMPTS}</i>\n\n"
        f"{to_fancy_text(grid)}\n\n"
        f"{attempts_left} {'attempt' if attempts_left == 1 else 'attempts'} remaining",
        parse_mode="HTML",
    )


async def _streak_after_win(user_id: str, ws_db: WordSeekCollection) -> tuple:
    from datetime import date as date_cls, datetime, timezone
    from shadow_game_bot.services.daily_word import get_current_game_date_string
    stats = await ws_db.get_user_stats(user_id)
    new_streak = 1
    current, highest = 0, 0
    if stats:
        current = stats.get("current_streak") or 0
        highest = stats.get("highest_streak") or 0
        last = stats.get("last_guessed")
        if last:
            try:
                last_dt = datetime.fromisoformat(last)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                # Compare game dates (6 AM TIME_ZONE rollover), like the original
                last_game_date = date_cls.fromisoformat(get_current_game_date_string(last_dt))
                today_game_date = date_cls.fromisoformat(get_current_game_date_string())
                diff = (today_game_date - last_game_date).days
                if diff == 1:
                    new_streak = current + 1
                elif diff == 0:
                    new_streak = current
            except ValueError:
                pass
    new_highest = max(new_streak, highest)
    await ws_db.update_streaks(user_id, new_streak, new_highest)
    return new_streak, new_highest


async def _handle_daily_win(message: Message, daily_word, all_guesses) -> None:
    user = message.from_user
    ws_db: WordSeekCollection = app.ws_db
    clear_daily_session(user.id)

    new_streak, new_highest = await _streak_after_win(str(user.id), ws_db)

    share_text = generate_wordle_share_text(daily_word.get("day_number") or 0,
                                            all_guesses, daily_word["word"])
    grid = get_feedback(all_guesses, daily_word["word"])
    details = format_daily_word_details(
        daily_word["word"], daily_word.get("meaning"),
        daily_word.get("phonetic"), daily_word.get("sentence"))

    caption = (
        f"<i>{E.CLOCK} Daily WordSeek · {len(all_guesses)}/{MAX_DAILY_ATTEMPTS}</i>\n\n"
        f"{to_fancy_text(grid)}\n\n"
        f"{E.SUCCESS} Congratulations! You guessed it in {len(all_guesses)} "
        f"{'try' if len(all_guesses) == 1 else 'tries'}!\n\n"
        f"{E.FIRE} Current Streak: {new_streak}\n"
        f"{E.STAR} Highest Streak: {new_highest}\n\n"
        f"{details}"
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Share", switch_inline_query=share_text,
                             icon_custom_emoji_id=EID.ANNOUNCE),
    ]])
    await message.reply(caption, parse_mode="HTML", reply_markup=keyboard)
    await react_with_random(message)


async def _handle_daily_loss(message: Message, daily_word, all_guesses) -> None:
    user = message.from_user
    ws_db: WordSeekCollection = app.ws_db
    clear_daily_session(user.id)
    await ws_db.ensure_user_stats(str(user.id))
    await ws_db.reset_streak(str(user.id))

    share_text = generate_wordle_share_text(daily_word.get("day_number") or 0,
                                            all_guesses, daily_word["word"])
    grid = get_feedback(all_guesses, daily_word["word"])
    details = format_daily_word_details(
        daily_word["word"], daily_word.get("meaning"),
        daily_word.get("phonetic"), daily_word.get("sentence"))

    caption = (
        f"<i>{E.CLOCK} Daily WordSeek · {len(all_guesses)}/{MAX_DAILY_ATTEMPTS}</i>\n\n"
        f"{to_fancy_text(grid)}\n\n"
        f"{E.GAME} Game Over! The word was: {daily_word['word'].upper()}\n\n"
        f"{E.CROSS} Streak reset to 0\n\n{details}\n\n"
        "Come back tomorrow for a new challenge!"
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Share", switch_inline_query=share_text,
                             icon_custom_emoji_id=EID.ANNOUNCE),
    ]])
    await message.reply(caption, parse_mode="HTML", reply_markup=keyboard)


async def topic_edited_handler(message: Message) -> None:
    """Port of topic-edited-handler.ts — keep stored topic name/icon in sync
    so /recreatetopic on expiry recreates the renamed/re-emojied topic."""
    chat = message.chat
    if not chat or not message.message_thread_id or not message.forum_topic_edited:
        return

    details = message.forum_topic_edited
    name = details.name
    icon = details.icon_custom_emoji_id
    if not name and not icon:
        return

    ws_db: WordSeekCollection = app.ws_db
    try:
        await ws_db.update_topic_meta(
            str(chat.id), str(message.message_thread_id),
            name=name, icon_custom_emoji_id=icon)
    except Exception:
        logger.exception(
            "Failed updating ws_chat_game_topics for chat=%s topic=%s",
            chat.id, message.message_thread_id)
