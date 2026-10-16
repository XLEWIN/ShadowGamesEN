"""Handler for callback queries (inline button presses)."""

import logging
import asyncio

from aiogram.types import CallbackQuery
from aiogram.exceptions import TelegramNetworkError, TelegramForbiddenError

from shadow_game_bot.context import app
from shadow_game_bot.db.games import GamesCollection
from shadow_game_bot.db.players import PlayersCollection
from shadow_game_bot.db.users import UserCollection
from shadow_game_bot.core.engine import GameEngine
from shadow_game_bot.core.state import DMActionType, PendingDMAction
from shadow_game_bot.emojis import E, plain
from shadow_game_bot.keyboards.game import build_leader_controls, build_leader_selection, CB_PREFIX
from shadow_game_bot.utils.escaping import escape_html
from shadow_game_bot.utils.mentions import mention_user_html, get_display_name

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAY = 2


async def _respond(query, text: str):
    """Toast alert — always strip markup (answerCallbackQuery has no parse_mode)."""
    try:
        await query.answer(text=plain(text), show_alert=True)
    except Exception:
        pass


async def _safe_send_with_markup(chat_id, text, parse_mode="HTML", reply_markup=None):
    for attempt in range(MAX_RETRIES):
        try:
            return await app.bot.send_message(chat_id=chat_id, text=text, parse_mode=parse_mode, reply_markup=reply_markup)
        except (TelegramNetworkError,) as e:
            logger.warning("Send failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(RETRY_DELAY * (attempt + 1))
    return None


async def callback_handler(query: CallbackQuery) -> None:
    data = query.data
    if not data or not query.message:
        return

    if not data.startswith(f"{CB_PREFIX}:"):
        return

    action = data.split(":", 1)[1]
    user = query.from_user
    chat = query.message.chat

    if not user or not chat:
        return

    db = app.db

    # Gban check
    if await UserCollection(db).is_gbanned(user.id):
        return await _respond(query, "You are globally banned from using this bot.")

    # Works anywhere (private /mystats sends this button)
    if action == "global_ranking":
        return await _handle_global_ranking(query)

    if chat.type not in ("group", "supergroup"):
        return

    chat_id = chat.id

    engine: GameEngine = app.engine
    games_col = GamesCollection(db)

    game = await games_col.get_active_game(chat_id)

    # Handle mode selection (no game required)
    if action.startswith("mode:"):
        if game:
            return await _respond(query, "A game is already running. Use /stop first.")
        return await _handle_mode_select(query, user, chat_id, action)

    if not game:
        if action == "start_new":
            return await _handle_start_new(query, user, chat_id)
        return await _respond(query, "No active game in this chat.")

    leader_msg_id = game.get("leader_message_id")
    leader_sel_msg_id = game.get("leader_selection_message_id")

    # Verify callback is for current game's message
    if action == "volunteer":
        if leader_sel_msg_id and query.message.message_id != leader_sel_msg_id:
            return await _respond(query, "This game control is no longer active.")
    elif action != "start_new":
        if leader_msg_id and query.message.message_id != leader_msg_id:
            return await _respond(query, "This game control is no longer active.")

    category = game.get("category", "normal")

    handlers = {
        "see": lambda: _handle_see(query, user, game, games_col),
        "write": lambda: _handle_write(query, user, game, chat_id, db),
        "change": lambda: _handle_change(query, user, game, chat_id, games_col, engine),
        "drop": lambda: _handle_drop(query, user, game, chat_id, games_col, engine),
        "volunteer": lambda: _handle_volunteer(query, user, game, chat_id, db),
        "start_new": lambda: _handle_start_new(query, user, chat_id),
    }

    handler = handlers.get(action)
    if handler:
        await handler()
    else:
        await _respond(query, "Unknown action.")


async def _handle_global_ranking(query):
    """Render the global top-25 as an edited message (works in private too)."""
    db = app.db
    top_players = await PlayersCollection(db).get_global_top_players(limit=25)
    if not top_players:
        return await _respond(query, "No scores yet globally.")

    text = f"{E.GLOBE} <b>Top 25 Players (Global)</b>\n{E.BULLET}\n\n"
    medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3]
    for i, player in enumerate(top_players):
        medal = medals[i] if i < len(medals) else f"  {i+1}."
        text += (f"{medal} <b>{escape_html(player.get('display_name') or 'Unknown')}</b>\n"
                 f"   💰 {player.get('total_score', 0)} Xeons\n\n")
    try:
        await query.message.edit_text(text, parse_mode="HTML")
    except Exception:
        pass
    try:
        await query.answer()
    except Exception:
        pass


async def _handle_mode_select(query, user, chat_id, action):
    """Handle Normal/Fiction mode selection — creates the game."""
    category = action.split(":", 1)[1]  # 'normal' or 'fiction'
    if category not in ("normal", "fiction"):
        return await _respond(query, "Invalid mode.")

    engine: GameEngine = app.engine
    display_name = get_display_name(user)
    chat_name = query.message.chat.title if query.message and query.message.chat else None

    result = await engine.start_new_game(chat_id, user.id, display_name, user.username, chat_name, category=category)

    try:
        await query.message.delete()
    except Exception:
        pass

    mode_label = "Normal" if category == "normal" else "Fiction"
    mention = mention_user_html(user.id, display_name)
    sent = await _safe_send_with_markup(
        chat_id,
        f"{E.GAME} {mention} started a <b>{mode_label}</b> mode game!\n\n"
        f"{E.ARROW} {mention} is explaining the word!",
        reply_markup=build_leader_controls(category),
    )
    if sent:
        db = app.db
        await GamesCollection(db).set_leader_message_id(chat_id, sent.message_id)


async def _handle_see(query, user, game, games_col):
    if user.id != game.get("current_leader_id"):
        return await _respond(query, "You are not the current leader.")
    round_id = game.get("current_round_id")
    if not round_id:
        return await _respond(query, "No active round.")
    word = await games_col.get_round_word(round_id)
    if not word:
        return await _respond(query, "No word set for this round.")
    try:
        await query.answer(text=f"Your word: {word.upper()}\n\nExplain it without saying it!", show_alert=True)
    except Exception:
        pass


async def _handle_write(query, user, game, chat_id, db):
    if user.id != game.get("current_leader_id"):
        return await _respond(query, "You are not the current leader.")

    app.dm_actions[user.id] = PendingDMAction(
        user_id=user.id, game_chat_id=chat_id, action=DMActionType.WRITE_WORD, game_id=game["id"]
    )
    # Persist so the pending action survives a restart
    try:
        await db.execute("DELETE FROM dm_actions WHERE user_id = ?", (user.id,))
        await db.execute(
            "INSERT INTO dm_actions (user_id, game_chat_id, action, game_id) VALUES (?, ?, ?, ?)",
            (user.id, chat_id, DMActionType.WRITE_WORD.value, game["id"]),
        )
        await db.commit()
    except Exception:
        logger.warning("Could not persist dm_action for %s", user.id, exc_info=True)
    try:
        sent = await app.bot.send_message(
            chat_id=user.id,
            text=(f"{E.PIN} Send the word you want the players to guess.\n\n"
                  f"The word will become the current game word."),
            parse_mode="HTML",
        )
        if sent:
            await query.answer(text=plain(f"{E.CHECK} Check your DM!"))
        else:
            await _respond(query, f"{E.ERROR} Could not send DM. Start a conversation with the bot first.")
    except TelegramForbiddenError:
        await _respond(query, "You need to start a chat with the bot first. Open the bot in DM and send /start, then try again.")
    except Exception as e:
        logger.warning("Could not send DM to %s: %s", user.id, e)
        await _respond(query, "Could not send DM. Start a conversation with the bot first.")


async def _handle_change(query, user, game, chat_id, games_col, engine):
    if user.id != game.get("current_leader_id"):
        return await _respond(query, "You are not the current leader.")

    new_word = await engine.change_word(chat_id)
    if not new_word:
        return await _respond(query, "Could not change word.")

    try:
        await query.answer(text=f"New word: {new_word.upper()}\n\nExplain it to the players!", show_alert=True)
    except Exception:
        pass

    category = game.get("category", "normal")
    mention = mention_user_html(user.id, get_display_name(user))
    try:
        await query.message.edit_text(
            text=(f"{E.FRESH} {mention} changed the word!\n\n"
                  f"The new word is ready. Keep guessing."),
            parse_mode="HTML",
            reply_markup=build_leader_controls(category),
        )
    except Exception:
        pass
    await games_col.update_activity(chat_id)


async def _handle_drop(query, user, game, chat_id, games_col, engine):
    if user.id != game.get("current_leader_id"):
        return await _respond(query, "You are not the current leader.")

    if not await engine.drop_lead(chat_id):
        return

    mention = mention_user_html(user.id, get_display_name(user))
    sent = await _safe_send_with_markup(
        chat_id,
        f"{E.GOODBYE} {mention} has stepped down.\n\n"
        f"{E.INFO} Who wants to become the new leader?",
        reply_markup=build_leader_selection(),
    )
    if sent:
        await games_col.set_leader_selection_message_id(chat_id, sent.message_id)
        await games_col.set_leader_message_id(chat_id, None)


async def _handle_volunteer(query, user, game, chat_id, db):
    if game.get("current_leader_id") is not None:
        return await _respond(query, "A new leader has already been selected.")

    engine: GameEngine = app.engine
    display_name = get_display_name(user)
    result = await engine.volunteer_leader(chat_id, user.id, display_name, user.username)
    if result is None:
        return await _respond(query, "A new leader has already been selected.")

    games_col = GamesCollection(db)
    leader_sel_msg_id = game.get("leader_selection_message_id")
    if leader_sel_msg_id:
        try:
            await app.bot.delete_message(chat_id, leader_sel_msg_id)
        except Exception:
            pass

    category = game.get("category", "normal")
    mode_label = "Normal" if category == "normal" else "Fiction"
    mention = mention_user_html(user.id, display_name)
    sent = await _safe_send_with_markup(
        chat_id,
        f"{E.CROWN} <b>New Leader!</b> ({mode_label} Mode)\n\n"
        f"{mention} is explaining the word!\n\n"
        f"{E.INFO} Use the buttons below for leader controls.",
        reply_markup=build_leader_controls(category),
    )
    if sent:
        await games_col.set_leader_message_id(chat_id, sent.message_id)
    await games_col.set_leader_selection_message_id(chat_id, None)


async def _handle_start_new(query, user, chat_id):
    """Show mode selection for new game after game over."""
    from shadow_game_bot.keyboards.game import build_mode_selection

    try:
        await query.message.delete()
    except Exception:
        pass

    mention = mention_user_html(user.id, get_display_name(user))
    sent = await _safe_send_with_markup(
        chat_id,
        f"{E.PLUS} {mention} wants to start a new game!\n\n"
        f"{E.SPARKLE} Choose the word mode:",
        reply_markup=build_mode_selection(),
    )
    if sent:
        db = app.db
        await GamesCollection(db).set_leader_message_id(chat_id, sent.message_id)
