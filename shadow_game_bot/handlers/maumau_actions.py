"""UNO game actions — port of mau_mau_bot actions.py for aiogram 3.

PTB's JobQueue countdown is replaced with an asyncio.Task stored on
``game.job``.  All sends go through ``app.bot`` (HTML + premium emoji).
"""

from __future__ import annotations

import asyncio
import logging

from shadow_game_bot.context import app
from shadow_game_bot.core.maumau import card as c
from shadow_game_bot.core.maumau.config import (
    MIN_FAST_TURN_TIME, TIME_REMOVAL_AFTER_SKIP, WAITING_TIME,
)
from shadow_game_bot.core.maumau.errors import (
    DeckEmptyError, NotEnoughPlayersError,
)
from shadow_game_bot.core.maumau.display import display_name
from shadow_game_bot.emojis import E
from shadow_game_bot.utils.escaping import escape_html

logger = logging.getLogger(__name__)


def _gm():
    """The shared GameManager on the app context."""
    return app.uno_gm


async def _db_stat(method: str, *args, **kwargs) -> None:
    """Best-effort UNO stats write — never let telemetry break gameplay."""
    db = app.uno_db
    if db is None:
        logger.warning("UNO stats skipped (%s): uno_db not ready", method)
        return
    try:
        await getattr(db, method)(*args, **kwargs)
    except Exception:
        logger.exception("UNO stats write failed: %s", method)


def game_is_running(game) -> bool:
    gm = _gm()
    if gm is None:
        return False
    return game in gm.chatid_games.get(game.chat.id, [])


def _choice_keyboard():
    """The 'Make your choice!' switch-inline button under turn messages."""
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="Make your choice!",
            switch_inline_query_current_chat="",
        )
    ]])


async def _send(chat_id: int, text: str, reply_markup=None) -> None:
    try:
        await app.bot.send_message(
            chat_id, text, parse_mode="HTML",
            reply_markup=reply_markup, disable_web_page_preview=True,
        )
    except Exception:
        logger.warning("UNO send failed chat=%s", chat_id, exc_info=True)


async def reset_waiting_time(player) -> None:
    """Reset a player's waiting time and notify the group."""
    game = player.game
    chat = game.chat

    if player.waiting_time < WAITING_TIME:
        player.waiting_time = WAITING_TIME
        await _send(
            chat.id,
            f"{E.TIME} Waiting time for "
            f"<b>{escape_html(display_name(player.user))}</b> "
            f"has been reset to {WAITING_TIME} seconds.",
        )


async def do_skip(player) -> None:
    """Skip the current player (reduce their timer or remove them)."""
    gm = _gm()
    game = player.game
    chat = game.chat
    skipped_player = game.current_player
    next_player = game.current_player.next

    if skipped_player.waiting_time > 0:
        skipped_player.anti_cheat += 1
        skipped_player.waiting_time -= TIME_REMOVAL_AFTER_SKIP
        if skipped_player.waiting_time < 0:
            skipped_player.waiting_time = 0

        try:
            skipped_player.draw()
        except DeckEmptyError:
            pass

        n = skipped_player.waiting_time
        await _send(
            chat.id,
            f"{E.TIME} Waiting time for "
            f"<b>{escape_html(display_name(skipped_player.user))}</b> "
            f"has been reduced to {n} seconds.\n"
            f"Next player: <b>{escape_html(display_name(next_player.user))}</b>",
        )
        logger.info("%s was skipped", display_name(skipped_player.user))
        game.turn()
        start_player_countdown(game)

    else:
        try:
            gm.leave_game(skipped_player.user, chat)
            await _send(
                chat.id,
                f"{E.ERROR} <b>{escape_html(display_name(skipped_player.user))}</b> "
                f"ran out of time and has been removed from the game!\n"
                f"Next player: "
                f"<b>{escape_html(display_name(next_player.user))}</b>",
            )
            logger.info("%s was skipped", display_name(skipped_player.user))
            start_player_countdown(game)

        except NotEnoughPlayersError:
            await _send(
                chat.id,
                f"{E.ERROR} <b>{escape_html(display_name(skipped_player.user))}</b> "
                f"ran out of time and has been removed from the game!\n"
                f"The game ended.",
            )
            gm.end_game(chat, skipped_player.user)


async def do_play_card(player, result_id: str) -> None:
    """Play the selected card and send updates to the group."""
    card = c.from_str(result_id)
    player.play(card)
    game = player.game
    chat = game.chat
    user = player.user

    # Stats: always count the card (best-effort, never blocks the game)
    await _db_stat("add_cards_played", user.id)

    if game.choosing_color:
        await _send(chat.id, f"{E.INFO} Please choose a colour.")

    if len(player.cards) == 1:
        await _send(chat.id, "<b>UNO!</b>")

    if len(player.cards) == 0:
        await _send(
            chat.id,
            f"{E.TROPHY} <b>{escape_html(user.first_name or display_name(user))}</b> "
            f"won!",
        )

        await _db_stat("add_game", user.id,
                       first_place=(game.players_won == 0))
        game.players_won += 1

        try:
            gm = _gm()
            gm.leave_game(user, chat)
        except NotEnoughPlayersError:
            await _send(chat.id, f"{E.GAME} Game ended!")

            # Remaining player also gets a completed game (no first place)
            remaining = game.current_player
            if remaining and remaining.user.id != user.id:
                await _db_stat("add_game", remaining.user.id)

            gm.end_game(chat, user)


async def do_draw(player) -> None:
    """Draw 1 (or draw_counter) cards."""
    game = player.game
    draw_counter_before = game.draw_counter

    try:
        player.draw()
    except DeckEmptyError:
        await _send(
            game.chat.id,
            f"{E.WARNING} There are no more cards in the deck.",
        )

    if ((game.last_card.value == c.DRAW_TWO
         or game.last_card.special == c.DRAW_FOUR)
            and draw_counter_before > 0):
        game.turn()


async def do_call_bluff(player) -> None:
    """Handle a +4 bluff call."""
    game = player.game
    chat = game.chat

    if player.prev.bluffing:
        await _send(
            chat.id,
            f"{E.ALERT} Bluff called! Giving 4 cards to "
            f"<b>{escape_html(player.prev.user.first_name or '')}</b>",
        )
        try:
            player.prev.draw()
        except DeckEmptyError:
            await _send(
                chat.id,
                f"{E.WARNING} There are no more cards in the deck.",
            )
    else:
        game.draw_counter += 2
        await _send(
            chat.id,
            f"{E.CROSS} <b>{escape_html(player.prev.user.first_name or '')}</b> "
            f"didn't bluff! Giving 6 cards to "
            f"<b>{escape_html(player.user.first_name or '')}</b>",
        )
        try:
            player.draw()
        except DeckEmptyError:
            await _send(
                chat.id,
                f"{E.WARNING} There are no more cards in the deck.",
            )

    game.turn()


def start_player_countdown(game) -> None:
    """Start (or restart) the fast-mode auto-skip countdown for the current player.

    No-op in classic/wild modes.  Stores the asyncio.Task on ``game.job``.
    """
    if game.mode != "fast":
        return

    player = game.current_player
    if player is None:
        return

    time_left = player.waiting_time
    if time_left < MIN_FAST_TURN_TIME:
        time_left = MIN_FAST_TURN_TIME

    # Cancel any existing countdown
    if game.job is not None and not game.job.done():
        game.job.cancel()

    game.job = asyncio.create_task(_countdown_task(game, player, time_left))
    logger.info(
        "Started countdown for player %s (%ss)",
        display_name(player.user), time_left,
    )


async def _countdown_task(game, player, time_left: int) -> None:
    """Sleep then auto-skip, if the game and player are still current."""
    try:
        await asyncio.sleep(time_left)
    except asyncio.CancelledError:
        return

    if not game_is_running(game):
        return
    if game.current_player is not player:
        return

    try:
        await do_skip(player)
    except Exception:
        logger.exception("Auto-skip failed")
