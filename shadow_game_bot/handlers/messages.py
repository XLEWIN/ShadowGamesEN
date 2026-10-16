"""Handler for group text messages — word guessing."""

import logging
import asyncio

from aiogram.types import Message
from aiogram.exceptions import TelegramNetworkError

from shadow_game_bot.context import app
from shadow_game_bot.db.games import GamesCollection
from shadow_game_bot.db.users import UserCollection
from shadow_game_bot.core.engine import GameEngine
from shadow_game_bot.emojis import E
from shadow_game_bot.keyboards.game import build_leader_controls, build_leader_selection
from shadow_game_bot.utils.mentions import mention_user_html, get_display_name

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAY = 2


async def _safe_reply(message, text, parse_mode="HTML", reply_markup=None):
    for attempt in range(MAX_RETRIES):
        try:
            return await message.reply(text=text, parse_mode=parse_mode, reply_markup=reply_markup)
        except (TelegramNetworkError,) as e:
            logger.warning("Reply failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(RETRY_DELAY * (attempt + 1))
    return None


async def message_handler(message: Message) -> None:
    chat = message.chat
    user = message.from_user
    if not chat or not user:
        return
    if chat.type not in ("group", "supergroup") or user.is_bot:
        return

    db = app.db
    if await UserCollection(db).is_gbanned(user.id):
        return

    text = message.text.strip() if message.text else ""
    if not text or text.startswith("/") or len(text) > 100:
        return

    # WordSeek first: if a ws game runs in this chat+topic, it owns the message.
    ws_db = app.ws_db
    if ws_db is not None:
        from shadow_game_bot.handlers.ws_messages import handle_ws_group_guess
        if await handle_ws_group_guess(message, ws_db):
            return

    chat_id = chat.id
    display_name = get_display_name(user)
    engine: GameEngine = app.engine
    games_col = GamesCollection(db)

    game = await games_col.get_active_game(chat_id)
    if not game or not game.get("current_leader_id") or not game.get("current_round_id"):
        return

    result = await engine.handle_guess(chat_id=chat_id, user_id=user.id, display_name=display_name, username=user.username, text=text)
    if result is None:
        return

    if result.get("was_leader"):
        await _handle_leader_self_guess(message, result, game, games_col)
    else:
        await _handle_winner(message, result, games_col)


async def _handle_winner(message, result, games_col):
    mention = mention_user_html(result["winner_id"], result["winner_name"])
    game = result.get("game", {})
    category = game.get("category", "normal")
    text = (
        f"{E.SUCCESS} {mention} guessed the word and wins +1 Xeons!\n\n"
        f"{E.CROWN} New Leader: {mention}\n\n"
        f"{E.ARROW} {mention} is explaining the word!"
    )
    sent = await _safe_reply(message, text, reply_markup=build_leader_controls(category))
    if sent:
        await games_col.set_leader_message_id(message.chat.id, sent.message_id)
    await games_col.update_activity(message.chat.id)


async def _handle_leader_self_guess(message, result, game, games_col):
    mention = mention_user_html(game["current_leader_id"], result["winner_name"])
    text = (
        f"{E.DISAPPROVE} {mention} guessed the word!\n\n"
        f"No winner this round.\nNo points were awarded.\n\n"
        f"{E.INFO} A new leader must be selected."
    )
    sent = await _safe_reply(message, text, reply_markup=build_leader_selection())
    if sent:
        await games_col.set_leader_selection_message_id(message.chat.id, sent.message_id)
        await games_col.set_leader_message_id(message.chat.id, None)
    await games_col.update_activity(message.chat.id)
