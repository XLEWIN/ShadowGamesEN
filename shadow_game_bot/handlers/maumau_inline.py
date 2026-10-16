"""UNO inline-query gameplay — port of mau_mau_bot results.py + bot.py
reply_to_query / process_result for aiogram 3.

Playable cards are ``InlineQueryResultCachedSticker`` from the
``classic_colorblind`` pack (see core/maumau/stickers.py).  Protocol
preserved: result_id = ``<action>`` or ``<card>`` with ``:{anti_cheat}``
suffix; non-playable / info results use a uuid so Telegram allows
duplicates.
"""

from __future__ import annotations

import logging
from uuid import uuid4

from aiogram.types import (
    ChosenInlineResult, InlineQuery, InlineQueryResultArticle,
    InlineQueryResultCachedSticker, InlineQueryResultsButton,
    InputTextMessageContent,
)

from shadow_game_bot.context import app
from shadow_game_bot.core.maumau import card as c
from shadow_game_bot.core.maumau.display import (
    card_display, display_color, display_name,
)
from shadow_game_bot.core.maumau.stickers import (
    STICKERS, STICKERS_GREY, STICKERS_OPTIONS,
)
from shadow_game_bot.core.maumau.game_manager import GameManager
from shadow_game_bot.emojis import E
from shadow_game_bot.handlers.maumau_actions import (
    do_call_bluff, do_draw, do_play_card, game_is_running,
    reset_waiting_time, start_player_countdown,
)
from shadow_game_bot.utils.escaping import escape_html

logger = logging.getLogger(__name__)


def _gm() -> GameManager | None:
    return app.uno_gm


# ── Result builders ───────────────────────────

def _card_article(title: str, description: str, content_text: str,
                  result_id: str) -> InlineQueryResultArticle:
    return InlineQueryResultArticle(
        id=result_id,
        title=title,
        description=description,
        input_message_content=InputTextMessageContent(
            message_text=content_text,
            parse_mode="HTML",
        ),
    )


def add_no_game(results: list) -> None:
    results.append(_card_article(
        title="You are not playing",
        description="Start with /newuno or join with /join",
        content_text=(
            "Not playing right now. Use /newuno to start a game "
            "or /join to join the current game in this group."
        ),
        result_id="nogame",
    ))


def add_not_started(results: list) -> None:
    results.append(_card_article(
        title="The game wasn't started yet",
        description="Start with /startuno",
        content_text="Start the game with /startuno.",
        result_id="notstarted",
    ))


def add_mode(results: list, mode: str, title: str, description: str) -> None:
    results.append(_card_article(
        title=title,
        description=description,
        content_text=f"Gamemode changed to {mode}.",
        result_id=f"mode_{mode}",
    ))


def add_choose_color(results: list) -> None:
    for color in c.COLORS:
        label = display_color(color)
        results.append(_card_article(
            title="Choose Colour",
            description=label,
            content_text=label,
            result_id=color,
        ))


def add_other_cards(player, results: list) -> None:
    """Hand summary while choosing a colour (tap → game state)."""
    cards_desc = ", ".join(card_display(card) for card in player.cards)
    results.append(_card_article(
        title="Cards (tap for game state)",
        description=cards_desc[:80],
        content_text=_game_info_text(player.game),
        result_id="hand",
    ))


def add_draw(player, results: list) -> None:
    n = player.game.draw_counter or 1
    label = "Drawing 1 card" if n == 1 else f"Drawing {n} cards"
    file_id = STICKERS_OPTIONS.get("option_draw")
    if file_id:
        results.append(InlineQueryResultCachedSticker(
            id="draw",
            sticker_file_id=file_id,
            input_message_content=InputTextMessageContent(
                message_text=label,
            ),
        ))
    else:
        results.append(_card_article(
            title="🎴 Draw",
            description=label,
            content_text=label,
            result_id="draw",
        ))


def add_pass(results: list) -> None:
    file_id = STICKERS_OPTIONS.get("option_pass")
    if file_id:
        results.append(InlineQueryResultCachedSticker(
            id="pass",
            sticker_file_id=file_id,
            input_message_content=InputTextMessageContent(
                message_text="Pass.",
            ),
        ))
    else:
        results.append(_card_article(
            title="Pass",
            description="Skip your turn without drawing",
            content_text="Pass.",
            result_id="pass",
        ))


def add_call_bluff(results: list) -> None:
    file_id = STICKERS_OPTIONS.get("option_bluff")
    if file_id:
        results.append(InlineQueryResultCachedSticker(
            id="call_bluff",
            sticker_file_id=file_id,
            input_message_content=InputTextMessageContent(
                message_text="I'm calling your bluff!",
            ),
        ))
    else:
        results.append(_card_article(
            title="Call Bluff!",
            description="Challenge the +4",
            content_text="I'm calling your bluff!",
            result_id="call_bluff",
        ))


def add_card(game, card, results: list, can_play: bool) -> None:
    """One card option.  Playable → colored sticker; not playable → grey
    sticker + game info (original ``results.py`` behaviour)."""
    label = card_display(card)
    if can_play:
        file_id = STICKERS.get(str(card))
        if file_id:
            # Sticker is the message content (original non-text mode)
            results.append(InlineQueryResultCachedSticker(
                id=str(card),
                sticker_file_id=file_id,
            ))
        else:
            results.append(_card_article(
                title=f"Play {label}",
                description=label,
                content_text=f"Card played: {label}",
                result_id=str(card),
            ))
    else:
        grey_id = STICKERS_GREY.get(str(card))
        if grey_id:
            results.append(InlineQueryResultCachedSticker(
                id=str(uuid4()),   # uuid → Telegram allows duplicates
                sticker_file_id=grey_id,
                input_message_content=InputTextMessageContent(
                    message_text=_game_info_text(game),
                    parse_mode="HTML",
                ),
            ))
        else:
            results.append(_card_article(
                title=label,
                description="Can't play this now",
                content_text=_game_info_text(game),
                result_id=str(uuid4()),
            ))


def _game_info_text(game) -> str:
    players = game.players
    player_rows = " → ".join(
        f"{escape_html(display_name(p.user))} ({len(p.cards)})"
        for p in players
    )
    lines = [
        f"{E.USER} Current player: "
        f"<b>{escape_html(display_name(game.current_player.user))}</b>",
        f"{E.WATCH} Last card: {card_display(game.last_card)}",
        f"👥 Players: {player_rows}",
    ]
    return "\n".join(lines)


# ── Inline query handler ──────────────────────

async def reply_to_query(inline_query: InlineQuery) -> None:
    """Build and answer an inline query (gameplay surface)."""
    results: list = []
    switch_text: str | None = None

    user = inline_query.from_user
    user_id = user.id
    gm = _gm()
    player = None

    try:
        players = gm.userid_players[user_id]
        player = gm.userid_current[user_id]
        game = player.game
    except (KeyError, TypeError, AttributeError):
        add_no_game(results)
    else:
        if not game.started:
            # Creator may change the mode; others see "not started"
            if user_id in game.owner:
                add_mode(results, "classic", "🎻 Classic mode",
                         "Conventional deck, no auto-skip")
                add_mode(results, "fast", "🚀 Fast mode",
                         "Auto-skip players who take too long")
                add_mode(results, "wild", "🐉 Wild mode",
                         "More special cards, no auto-skip")
            else:
                add_not_started(results)

        elif user_id == game.current_player.user.id:
            if game.choosing_color:
                add_choose_color(results)
                add_other_cards(player, results)
            else:
                if not player.drew:
                    add_draw(player, results)
                else:
                    add_pass(results)

                if (game.last_card.special == c.DRAW_FOUR
                        and game.draw_counter):
                    add_call_bluff(results)

                playable = player.playable_cards()
                added_ids: list[str] = []

                for card in sorted(player.cards):
                    can_play = (card in playable
                                and str(card) not in added_ids)
                    add_card(game, card, results, can_play)
                    added_ids.append(str(card))

                add_other_cards(player, results)  # game-info tap target

        else:
            # Not your turn — greyed-out cards only
            for card in sorted(player.cards):
                add_card(game, card, results, can_play=False)

        # Anti-cheat nonce on every result id
        for result in results:
            result.id = f"{result.id}:{player.anti_cheat}"

        if players and len(players) > 1:
            switch_text = f"Current game: {game.chat.title}"

    button = None
    if switch_text:
        button = InlineQueryResultsButton(
            text=switch_text,
            start_parameter="select",
        )

    logger.info(
        "Inline query from %s → %d results (nonce=%s)",
        display_name(user), len(results),
        player.anti_cheat if player is not None else "-",
    )

    await inline_query.answer(
        results=results,
        is_personal=True,
        cache_time=0,
        button=button,
    )


# ── Chosen-inline-result handler ──────────────

async def process_result(chosen: ChosenInlineResult) -> None:
    """Act on the card/option the player picked in the inline bar."""
    try:
        user = chosen.from_user
        gm = _gm()
        player = gm.userid_current[user.id]
        game = player.game
        result_id = chosen.result_id
        chat = game.chat
    except (KeyError, AttributeError, TypeError):
        # Not in a current game (or stale bookkeeping) — say so instead
        # of failing silently, so "bot didn't react" is never invisible.
        uid = getattr(chosen.from_user, "id", "?")
        logger.info(
            "Chosen result ignored: user %s not in a current UNO game "
            "(result_id=%r)", uid, getattr(chosen, "result_id", None),
        )
        return

    logger.info(
        "Selected result %r by %s", result_id, display_name(user))

    try:
        result_id, anti_cheat = result_id.rsplit(":", 1)
        anti_cheat = int(anti_cheat)
    except ValueError:
        logger.warning("Malformed result_id %r — ignoring", result_id)
        return

    last_anti_cheat = player.anti_cheat

    # View-only taps must NOT burn the anti-cheat nonce: in the original
    # protocol every selection incremented it, so tapping a grey card /
    # game-info and then playing a real card from the same open results
    # list made the bot reject the play as a "cheat" — while Telegram
    # still posted the card sticker, looking like the bot ignored the
    # turn.  Only real gameplay actions rotate the nonce.
    if result_id in ("hand", "gameinfo", "nogame", "notstarted"):
        logger.debug("Info result %r — no action", result_id)
        return

    if result_id.startswith("mode_"):
        mode = result_id[5:]
        game.set_mode(mode)
        logger.info("Gamemode changed to %s", mode)
        try:
            await app.bot.send_message(
                chat.id,
                f"{E.SETTINGS} Gamemode changed to <b>{escape_html(mode)}</b>.",
                parse_mode="HTML",
            )
        except Exception:
            logger.exception("Mode-change announcement failed chat=%s", chat.id)
        return

    # UUID for a non-playable / info result — nothing to do
    if len(result_id) == 36:
        logger.debug("Grey/info card tap (uuid) — no action")
        return

    # Real gameplay action — consume the nonce
    player.anti_cheat += 1

    if anti_cheat != last_anti_cheat:
        logger.warning(
            "Cheat attempt by %s: result nonce %s != current %s "
            "(result_id=%r — stale inline results?)",
            display_name(user), anti_cheat, last_anti_cheat, result_id,
        )
        try:
            await app.bot.send_message(
                chat.id,
                f"{E.CROSS} Cheat attempt by "
                f"<b>{escape_html(display_name(player.user))}</b>!",
                parse_mode="HTML",
            )
        except Exception:
            logger.exception("Cheat warning failed chat=%s", chat.id)
        return

    # ── Perform the action — any failure here means the turn did NOT
    # complete, so log it loudly and skip the next-player announcement.
    try:
        if result_id == "call_bluff":
            await reset_waiting_time(player)
            await do_call_bluff(player)
        elif result_id == "draw":
            await reset_waiting_time(player)
            await do_draw(player)
        elif result_id == "pass":
            game.turn()
        elif result_id in c.COLORS:
            game.choose_color(result_id)
        else:
            await reset_waiting_time(player)
            await do_play_card(player, result_id)
    except Exception:
        logger.exception(
            "UNO action failed result_id=%r user=%s chat=%s",
            result_id, user.id, chat.id,
        )
        return

    # ── Announce the next player (original bot parity) — kept separate
    # so a failed announcement still leaves the countdown running.
    if not game_is_running(game):
        return

    next_name = escape_html(display_name(game.current_player.user))
    from shadow_game_bot.handlers.maumau_actions import _choice_keyboard
    try:
        await app.bot.send_message(
            chat.id,
            f"{E.ARROW} Next player: <b>{next_name}</b>",
            parse_mode="HTML",
            reply_markup=_choice_keyboard(),
        )
    except Exception:
        logger.exception("Next-player announcement failed chat=%s", chat.id)

    try:
        start_player_countdown(game)
    except Exception:
        logger.exception("Countdown start failed chat=%s", chat.id)
