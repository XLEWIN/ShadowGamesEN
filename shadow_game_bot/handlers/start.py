"""Handler for /start command (Pi structure).

Private /start: rich → HTML → plain ladder, the whole menu in the body
on the rich path, 2-1-2 colored keyboard on the HTML path, command
message deleted, DB + log after the reply is on its way.

``/start help`` (the group menu's ``?start=help`` deep link) opens the
interactive help menu instead of the start screen.

Group /start: unchanged Word Guess flow (mode selection / active game)
with branded, icon-decorated replies.
"""

import logging

from aiogram.filters import CommandObject
from aiogram.types import Message

from shadow_game_bot import richsend as rs
from shadow_game_bot.context import app
from shadow_game_bot.db.games import GamesCollection
from shadow_game_bot.db.players import PlayersCollection
from shadow_game_bot.db.users import UserCollection
from shadow_game_bot.emojis import E
from shadow_game_bot.handlers.event_log import log_new_user
from shadow_game_bot.handlers.menu import (
    build_start_blocks,
    build_start_keyboard,
)
from shadow_game_bot.keyboards.game import build_mode_selection
from shadow_game_bot.reply import reply_text
from shadow_game_bot.texts import (
    BOT_DESCRIPTION,
    BOT_DESCRIPTION_PLAIN,
    START_TEXT,
    START_TEXT_PLAIN,
)
from shadow_game_bot.utils.escaping import escape_html
from shadow_game_bot.utils.mentions import get_display_name, mention_user_html

logger = logging.getLogger(__name__)


# ── Rich + HTML ladders (Pi start screen) ────────────────────────

def _start_html_text(username: str) -> str:
    return START_TEXT.format(
        fire=E.FIRE,
        username=f"@{username}",
        description=BOT_DESCRIPTION,
        arrow=E.ARROW,
    )


def _start_plain_text(username: str) -> str:
    return START_TEXT_PLAIN.format(
        username=f"@{username}",
        description_plain=BOT_DESCRIPTION_PLAIN,
    )


async def _safe_delete(message: Message) -> None:
    try:
        await message.delete()
    except Exception:
        pass


async def _finish_start(message: Message) -> None:
    """DB + log after the reply is on its way (Pi order)."""
    user = message.from_user
    if user:
        await UserCollection(app.db).record_dm_start(user.id)
    await log_new_user(message)


async def _send_private_start(message: Message) -> None:
    """Rich first (no keyboard), then HTML, then plain — never raises."""
    bot = app.bot
    username = app.bot_username or "bot"
    chat_id = message.chat.id

    blocks = rs.build_blocks(build_start_blocks, username)

    async def html_fallback():
        try:
            return await reply_text(
                message, _start_html_text(username),
                parse_mode="HTML", reply_markup=build_start_keyboard(),
            )
        except Exception:
            logger.warning("Start brand reply failed; sending plain fallback",
                           exc_info=True)
            return await reply_text(
                message, _start_plain_text(username),
                parse_mode="HTML", reply_markup=build_start_keyboard(icons=False),
            )

    try:
        await rs.send_with_fallback(
            bot, chat_id, blocks, rich_markup=None, fallback=html_fallback,
        )
    except Exception:
        logger.error("Start reply failed", exc_info=True)
        return

    # Reply is on screen — only now delete the command + do DB/log.
    await _safe_delete(message)
    await _finish_start(message)


# ── Command router ───────────────────────────────────────────────

async def start_handler(message: Message, command: CommandObject) -> None:
    if not message.chat or not message.from_user:
        return

    # /start help — the ?start=help deep link opens the interactive menu.
    if command.args and str(command.args).strip().lower() == "help":
        from shadow_game_bot.handlers.menu import help_command
        if message.chat.type == "private":
            await help_command(message, app.bot)
            await _safe_delete(message)
            return

    # /start select — UNO multi-group game picker (inline switch button).
    if (command.args and str(command.args).strip().lower() == "select"
            and message.chat.type == "private"):
        from shadow_game_bot.handlers.maumau_commands import (
            send_select_game_picker,
        )
        await send_select_game_picker(message)
        return

    if message.chat.type == "private":
        await _handle_private(message)
    else:
        await _handle_group(message)


async def _handle_private(message: Message) -> None:
    await _send_private_start(message)


async def _handle_group(message: Message) -> None:
    chat_id = message.chat.id
    user = message.from_user
    display_name = get_display_name(user)

    games_col = GamesCollection(app.db)

    existing = await games_col.get_active_game(chat_id)
    if existing:
        return await _show_existing_game(message, existing)

    # Show mode selection — leader picks Normal or Fiction
    mention = mention_user_html(user.id, display_name)
    sent = await reply_text(
        message,
        f"{E.GAME} {mention} <b>started a new game!</b>\n\n"
        f"{E.SPARKLE} Choose the word mode for this game:",
        parse_mode="HTML",
        reply_markup=build_mode_selection(),
    )
    await games_col.set_leader_message_id(chat_id, sent.message_id)
    logger.info("Mode selection shown in chat %s by %s", chat_id, display_name)


async def _show_existing_game(message: Message, game):
    players_col = PlayersCollection(app.db)
    leaderboard = await players_col.get_leaderboard(game["id"])

    category = game.get("category", "normal")
    mode_label = "Normal" if category == "normal" else "Fiction"

    text = (f"{E.GAME} <b>SHADOW GAME — Active Game</b> "
            f"({mode_label} Mode)\n\n")
    leader_id = game.get("current_leader_id")
    if leader_id:
        leader_player = await players_col.get_player(game["id"], leader_id)
        if leader_player:
            mention = mention_user_html(
                leader_id, leader_player.get("display_name", "Unknown"))
            text += (f"├ {E.USER} Leader: {mention}\n"
                     f"└ {mention} is currently explaining the word!\n\n")

    if leaderboard:
        text += f"<b>{E.TROPHY} Scoreboard:</b>\n"
        medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3]
        for i, player in enumerate(leaderboard[:10]):
            medal = medals[i] if i < len(medals) else f"{i + 1}."
            text += (f"{medal} {escape_html(player.get('display_name') or 'Unknown')}"
                     f" — <b>{player.get('score', 0)}</b>\n")
        text += "\n"
    text += f"{E.ARROW} An active game is already running. Join in to guess!"
    await reply_text(message, text, parse_mode="HTML")


# ── start:* callbacks ────────────────────────────────────────────

async def start_callback(query) -> None:
    """Handle the start callback buttons (start:help → interactive menu)."""
    data = query.data or ""
    if data == "start:help":
        from shadow_game_bot.handlers.menu import show_main_menu
        await show_main_menu(query)
        return
    try:
        await query.answer("Coming soon!", show_alert=False)
    except Exception:
        pass
