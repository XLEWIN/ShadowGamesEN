"""UNO game commands and callbacks — aiogram 3 port of mau_mau_bot.

Command map (clashing names use the new[game] convention):
    /newuno  create a game        /newword  → WordSeek /new (alias)
    /startuno deal cards          /join /leave
    /kill /kick /open /close      /skip
    /notifyme (alias /notify_me)  /modes
    /unostats  show/enable/disable/reset

Callbacks: ``mm:join``, ``mm:start``, ``mm:sel:<chat_id>``
Service:   combined left_chat_member handler (bot-removed log OR
           UNO player-leave cleanup).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime

from aiogram.filters import CommandObject
from aiogram.types import (
    CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message,
)

from shadow_game_bot.config import config
from shadow_game_bot.context import app
from shadow_game_bot.core.maumau import (
    AlreadyJoinedError, DeckEmptyError, LobbyClosedError,
    MIN_PLAYERS, NoGameInChatError, NotEnoughPlayersError, GameManager,
)
from shadow_game_bot.core.maumau.display import display_name
from shadow_game_bot.db.uno import UnoStatsCollection
from shadow_game_bot.emojis import E
from shadow_game_bot.handlers.event_log import log_bot_removed
from shadow_game_bot.handlers.maumau_actions import (
    do_skip, start_player_countdown,
)
from shadow_game_bot.keyboards.colored import btn_primary, btn_success
from shadow_game_bot.reply import reply_text
from shadow_game_bot.utils.escaping import escape_html

logger = logging.getLogger(__name__)

#: Premium emoji ids for lobby buttons (EID.PLAY / EID.FIRE equivalents).
EID_JOIN = "5042334757040423886"   # ⚡
EID_START = "5039644681583985437"  # 🔥


# ── Shared state accessors ────────────────────

def _gm() -> GameManager | None:
    return app.uno_gm


def _uno_db() -> UnoStatsCollection | None:
    return app.uno_db


# ── Admin helpers (1 h cache) ─────────────────

_ADMIN_CACHE: dict[int, tuple[float, set[int]]] = {}
_ADMIN_CACHE_TTL = 3600.0


async def _is_chat_admin(chat_id: int, user_id: int) -> bool:
    """True when the user is an admin/creator of the chat (1 h cache)."""
    if config.is_admin(user_id):
        return True

    now = time.monotonic()
    cached = _ADMIN_CACHE.get(chat_id)
    if cached and now - cached[0] < _ADMIN_CACHE_TTL:
        return user_id in cached[1]

    try:
        members = await app.bot.get_chat_administrators(chat_id)
        ids = {m.user.id for m in members}
    except Exception:
        logger.warning("get_chat_administrators failed chat=%s", chat_id,
                       exc_info=True)
        return False

    _ADMIN_CACHE[chat_id] = (now, ids)
    return user_id in ids


async def _can_manage(user, game, chat_id: int) -> bool:
    """Creator OR chat admin OR bot owner."""
    if user.id in game.owner:
        return True
    return await _is_chat_admin(chat_id, user.id)


# ── Shared send helper ────────────────────────

async def _send(message: Message, text: str, reply_markup=None,
                reply_to: bool = True) -> None:
    kwargs = {"parse_mode": "HTML", "reply_markup": reply_markup,
              "disable_web_page_preview": True}
    if reply_to and message.chat and message.chat.type != "private":
        await message.reply(text, **kwargs)
    else:
        await message.answer(text, **kwargs)


# ── /newuno ───────────────────────────────────

async def newuno_handler(message: Message, command: CommandObject) -> None:
    """Create a new UNO game in this chat."""
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    if chat.type == "private":
        await reply_text(message,
                         f"{E.INFO} Add me to a group, then use /newuno there.")
        return

    gm = _gm()

    # Notify /notifyme subscribers
    notify_set = gm.remind_dict.pop(chat.id, None)
    if notify_set:
        for uid in notify_set:
            try:
                await app.bot.send_message(
                    uid,
                    f"{E.ANNOUNCE} A new UNO game has been started in "
                    f"<b>{escape_html(chat.title or '')}</b>!",
                    parse_mode="HTML",
                )
            except Exception:
                pass

    game = gm.new_game(chat)
    game.starter = user
    game.owner = [user.id]

    rows = [[btn_success("Join the game", "mm:join",
                         icon_emoji_id=EID_JOIN)]]
    await _send(
        message,
        f"{E.GAME} Created a new UNO game!\n"
        f"{E.ADD} Join with /join or the button below.\n"
        f"{E.PLAY} Start with /startuno once {MIN_PLAYERS}+ players joined.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
    )


# ── /join ─────────────────────────────────────

async def join_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    if chat.type == "private":
        await reply_text(message,
                         f"{E.INFO} Use /join inside the group's UNO game.")
        return

    gm = _gm()
    try:
        gm.join_game(user, chat)
    except LobbyClosedError:
        await _send(message, f"{E.LOCK} The lobby is closed.")
    except NoGameInChatError:
        await _send(message,
                    f"{E.WARNING} No game is running. Create one with /newuno.")
    except AlreadyJoinedError:
        await _send(message,
                    f"{E.INFO} You already joined. Start with /startuno.")
    except DeckEmptyError:
        await _send(message,
                    f"{E.WARNING} Not enough cards left for new players.")
    else:
        # Start button appears once enough players are in
        gm2 = _gm()
        try:
            game = gm2.chatid_games[chat.id][-1]
            n = len(game.players)
        except (KeyError, IndexError):
            n = 0
        rows = []
        if n >= MIN_PLAYERS:
            rows.append([btn_primary("Start the game", "mm:start",
                                     icon_emoji_id=EID_START)])
        await _send(
            message,
            f"{E.CHECK} Joined the game! ({n} player{'s' if n != 1 else ''})",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=rows) if rows else None,
        )


# ── /leave ────────────────────────────────────

async def leave_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    gm = _gm()
    player = gm.player_for_user_in_chat(user, chat)
    if player is None:
        await _send(message,
                    f"{E.WARNING} You are not playing in this group.")
        return

    game = player.game
    try:
        gm.leave_game(user, chat)
    except NoGameInChatError:
        await _send(message,
                    f"{E.WARNING} You are not playing in this group.")
        return
    except NotEnoughPlayersError:
        gm.end_game(chat, user)
        await _send(message, f"{E.GAME} Game ended!")
        return

    if game.started and game.current_player:
        await _send(
            message,
            f"{E.ARROW} Okay. Next player: "
            f"<b>{escape_html(display_name(game.current_player.user))}</b>",
        )
    else:
        await _send(
            message,
            f"{E.USER} <b>{escape_html(display_name(user))}</b> left the "
            f"game before it started.",
        )


# ── /startuno ─────────────────────────────────

async def startuno_handler(message: Message) -> None:
    """Deal the first hands (group only — PM is the game picker)."""
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    if chat.type == "private":
        await _send(message,
                    f"{E.INFO} Use /startuno inside the group.",
                    reply_to=False)
        return

    gm = _gm()
    try:
        game = gm.chatid_games[chat.id][-1]
    except (KeyError, IndexError):
        await _send(message,
                    f"{E.WARNING} No game running. Create one with /newuno.")
        return

    if game.started:
        await _send(message, f"{E.INFO} The game has already started.")
        return

    if len(game.players) < MIN_PLAYERS:
        await _send(
            message,
            f"{E.WARNING} At least <b>{MIN_PLAYERS}</b> players must /join "
            f"before you can start.",
        )
        return

    # Creator or admin may start
    if not await _can_manage(user, game, chat.id):
        # Original allowed anyone to /start — keep that
        pass

    # Deal hands
    game.start()
    for player in game.players:
        try:
            player.draw_first_hand()
        except DeckEmptyError:
            await _send(message,
                        f"{E.ERROR} Deck empty while dealing — game aborted.")
            try:
                gm.end_game(chat, user)
            except Exception:
                pass
            return

    first_name = escape_html(display_name(game.current_player.user))
    from shadow_game_bot.handlers.maumau_actions import _choice_keyboard
    from shadow_game_bot.core.maumau.stickers import STICKERS

    # Original bot sends the first card as a sticker, then the turn message
    sticker_id = STICKERS.get(str(game.last_card))
    if sticker_id:
        try:
            await message.answer_sticker(sticker_id)
        except Exception:
            logger.warning("sendSticker for first card failed", exc_info=True)

    await _send(
        message,
        f"{E.GAME} <b>First player: {first_name}</b>\n"
        f"{E.LOCK} Use /close to stop people from joining.",
        reply_markup=_choice_keyboard(),
    )
    start_player_countdown(game)


# ── /kill ─────────────────────────────────────

async def kill_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    if chat.type == "private":
        await reply_text(message, f"{E.INFO} /kill works in the game group.")
        return

    gm = _gm()
    games = gm.chatid_games.get(chat.id)
    if not games:
        await _send(message, f"{E.WARNING} No running game in this chat.")
        return

    game = games[-1]
    if not await _can_manage(user, game, chat.id):
        await _send(
            message,
            f"{E.LOCK} Only the game creator "
            f"({escape_html(display_name(game.starter))}) and admins can do that.",
        )
        return

    try:
        gm.end_game(chat, user)
    except NoGameInChatError:
        # User not seated — end the latest game directly
        for g in list(games):
            try:
                # End by force: clear all players
                for p in g.players:
                    p.leave()
                games.remove(g)
            except Exception:
                pass
        if not gm.chatid_games.get(chat.id):
            gm.chatid_games.pop(chat.id, None)
    await _send(message, f"{E.GAME} Game ended!")


# ── /kick ─────────────────────────────────────

async def kick_handler(message: Message) -> None:
    """Kick the replied-to player (creator/admin only)."""
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    if chat.type == "private":
        await reply_text(message, f"{E.INFO} /kick works in the game group.")
        return

    gm = _gm()
    try:
        game = gm.chatid_games[chat.id][-1]
    except (KeyError, IndexError):
        await _send(message, f"{E.WARNING} No game is running.")
        return

    if not game.started:
        await _send(message, f"{E.INFO} The game has not started yet.")
        return

    if not await _can_manage(user, game, chat.id):
        await _send(
            message,
            f"{E.LOCK} Only the game creator "
            f"({escape_html(display_name(game.starter))}) and admins can do that.",
        )
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await _send(
            message,
            f"{E.INFO} Reply to the person you want to kick, then /kick.",
        )
        return

    kicked = message.reply_to_message.from_user
    try:
        gm.leave_game(kicked, chat)
    except NoGameInChatError:
        await _send(
            message,
            f"{E.WARNING} {escape_html(display_name(kicked))} is not in the game.",
        )
        return
    except NotEnoughPlayersError:
        gm.end_game(chat, user)
        await _send(
            message,
            f"{E.KICK} {escape_html(display_name(kicked))} was kicked by "
            f"{escape_html(display_name(user))}.\n{E.GAME} Game ended!",
        )
        return

    await _send(
        message,
        f"{E.KICK} {escape_html(display_name(kicked))} was kicked by "
        f"{escape_html(display_name(user))}.",
    )
    if game.started and game.current_player:
        await _send(
            message,
            f"{E.ARROW} Next player: "
            f"<b>{escape_html(display_name(game.current_player.user))}</b>",
        )


# ── /open /close ──────────────────────────────

async def _set_lobby(message: Message, open_: bool) -> None:
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    gm = _gm()
    games = gm.chatid_games.get(chat.id)
    if not games:
        await _send(message, f"{E.WARNING} No running game in this chat.")
        return

    game = games[-1]
    if user.id not in game.owner and not config.is_admin(user.id):
        await _send(
            message,
            f"{E.LOCK} Only the game creator "
            f"({escape_html(display_name(game.starter))}) can do that.",
        )
        return

    game.open = open_
    if open_:
        await _send(message, f"{E.CHECK} Lobby opened. New players may /join.")
    else:
        await _send(message, f"{E.LOCK} Lobby closed. No more players can join.")


async def open_handler(message: Message) -> None:
    await _set_lobby(message, True)


async def close_handler(message: Message) -> None:
    await _set_lobby(message, False)


# ── /skip ─────────────────────────────────────

async def skip_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    gm = _gm()
    player = gm.player_for_user_in_chat(user, chat)
    if not player:
        await _send(message, f"{E.WARNING} You are not playing here.")
        return

    game = player.game
    skipped_player = game.current_player
    delta = (datetime.now() - skipped_player.turn_started).seconds

    # Can't skip someone who still has time (you can always skip yourself)
    if delta < skipped_player.waiting_time and player != skipped_player:
        n = skipped_player.waiting_time - delta
        await _send(message, f"{E.TIME} Please wait {n} more seconds.")
        return

    await do_skip(player)


# ── /notifyme ─────────────────────────────────

async def notifyme_handler(message: Message) -> None:
    """PM when a new game starts in this group."""
    if not message.chat or not message.from_user:
        return
    chat = message.chat
    user = message.from_user

    if chat.type == "private":
        await _send(
            message,
            f"{E.INFO} Send /notifyme in a group to get a private message "
            f"when a new UNO game starts there.",
            reply_to=False,
        )
        return

    gm = _gm()
    gm.remind_dict.setdefault(chat.id, set()).add(user.id)
    await _send(
        message,
        f"{E.CHECK} You will get a private message when a new game starts here.",
    )


# ── /modes ────────────────────────────────────

async def modes_handler(message: Message) -> None:
    text = (
        f"{E.SETTINGS} <b>UNO game modes</b>\n\n"
        f"🎻 <b>Classic</b> — conventional deck, no auto-skip.\n"
        f"🚀 <b>Fast</b> — conventional deck, auto-skip slow players.\n"
        f"🐉 <b>Wild</b> — more special cards, no auto-skip.\n\n"
        f"The game creator changes the mode before /startuno by typing "
        f"@{app.bot_username} in the chat and picking a mode from the "
        f"inline results."
    )
    await _send(message, text)


# ── /unostats ─────────────────────────────────

async def unostats_handler(message: Message, command: CommandObject) -> None:
    """Show UNO stats; subcommands: enable/disable/reset."""
    if not message.from_user:
        return
    user = message.from_user
    sub = (command.args or "").strip().lower() if command else ""

    db = _uno_db()
    if db is None:
        await _send(message, f"{E.WARNING} Stats are unavailable right now.")
        return

    if sub == "reset":
        await db.reset(user.id)
        await _send(message, f"{E.CHECK} Your UNO stats have been reset.")
        return

    if sub in ("enable", "disable"):
        # Tracking is always on; kept for command-compat with the original.
        await _send(
            message,
            f"{E.INFO} Stats are always tracked. Use /unostats to view them.",
        )
        return

    row = await db.get(user.id)
    if not row or (row["games_played"] == 0 and row["cards_played"] == 0):
        await _send(
            message,
            f"{E.INFO} You have no UNO stats yet. Play a game first!",
        )
        return

    gp = row["games_played"]
    fp = row["first_places"]
    cp = row["cards_played"]
    pct = round((fp / gp) * 100) if gp else 0
    text = (
        f"{E.CHART} <b>Your UNO stats</b>\n\n"
        f"{E.GAME} Games played: <b>{gp}</b>\n"
        f"{E.TROPHY} First places: <b>{fp}</b> ({pct}%)\n"
        f"{E.WATCH} Cards played: <b>{cp}</b>"
    )
    await _send(message, text)


# ── /newword alias ────────────────────────────
# Implemented in bot.py by registering new_game_handler under "newword".


# ── Callbacks: mm: prefix ─────────────────────

async def mm_callback_handler(query: CallbackQuery) -> None:
    """Handle ``mm:join`` / ``mm:start`` / ``mm:sel:<chat_id>``."""
    data = query.data or ""
    if not data.startswith("mm:"):
        return
    action = data.split(":", 2)
    # action = ["mm", "<cmd>", maybe rest]

    user = query.from_user
    if not user:
        return

    if len(action) >= 2 and action[1] == "join":
        # Join from the button — the message is in the group
        if not query.message or not query.message.chat:
            await query.answer("Use /join in the game group.")
            return
        chat = query.message.chat
        gm = _gm()
        try:
            gm.join_game(user, chat)
        except AlreadyJoinedError:
            await query.answer("You already joined!")
            return
        except NoGameInChatError:
            await query.answer("No game running — /newuno first!")
            return
        except LobbyClosedError:
            await query.answer("The lobby is closed.")
            return
        await query.answer("Joined!")
        # Refresh the message with updated count
        try:
            game = gm.chatid_games[chat.id][-1]
            n = len(game.players)
            rows = []
            if n >= MIN_PLAYERS:
                rows.append([btn_primary("Start the game", "mm:start",
                                         icon_emoji_id=EID_START)])
            await query.message.edit_text(
                f"{E.GAME} UNO lobby — <b>{n}</b> player"
                f"{'s' if n != 1 else ''} joined.\n"
                f"{E.PLAY} /startuno or the button to begin.",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=rows)
                if rows else None,
            )
        except Exception:
            pass
        return

    if len(action) >= 2 and action[1] == "start":
        # Start from the button
        if not query.message or not query.message.chat:
            await query.answer("Use /startuno in the game group.")
            return
        chat = query.message.chat
        gm = _gm()
        try:
            game = gm.chatid_games[chat.id][-1]
        except (KeyError, IndexError):
            await query.answer("No game running.")
            return
        if game.started:
            await query.answer("Already started!")
            return
        if len(game.players) < MIN_PLAYERS:
            await query.answer(f"Need at least {MIN_PLAYERS} players.")
            return

        from shadow_game_bot.handlers.maumau_actions import _choice_keyboard
        from shadow_game_bot.core.maumau.stickers import STICKERS
        game.start()
        for p in game.players:
            p.draw_first_hand()

        sticker_id = STICKERS.get(str(game.last_card))
        if sticker_id:
            try:
                await query.message.answer_sticker(sticker_id)
            except Exception:
                logger.warning("sendSticker for first card failed", exc_info=True)

        first = escape_html(display_name(game.current_player.user))
        await query.message.edit_text(
            f"{E.GAME} <b>First player: {first}</b>",
            parse_mode="HTML",
            reply_markup=_choice_keyboard(),
        )
        await query.answer("Game started!")
        start_player_countdown(game)
        return

    if len(action) >= 3 and action[1] == "sel":
        # Select the active game group (from /start select)
        try:
            chat_id = int(action[2])
        except ValueError:
            await query.answer("Game not found.")
            return
        gm = _gm()
        players = gm.userid_players.get(user.id, [])
        for player in players:
            if player.game.chat.id == chat_id:
                gm.userid_current[user.id] = player
                break
        else:
            await query.answer("Game not found.")
            return

        current = gm.userid_current.get(user.id)
        title = current.game.chat.title if current else "?"
        try:
            await query.answer("Switch to the group you selected!")
            back = InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="Back to last group",
                                     switch_inline_query="")
            ]])
            await query.message.edit_text(
                f"{E.TRAVEL} Selected group: <b>{escape_html(title)}</b>\n"
                f"<b>Make sure you switch to the correct group!</b>",
                parse_mode="HTML",
                reply_markup=back,
            )
        except Exception:
            pass
        return

    await query.answer()


# ── /start select deep-link ───────────────────

async def send_select_game_picker(message: Message) -> None:
    """``/start select`` in PM — pick which group's UNO game to act in.

    Called from handlers/start.py when the deep-link arg is ``select``.
    """
    if not message.from_user:
        return
    user = message.from_user
    gm = _gm()
    if gm is None:
        return
    players = gm.userid_players.get(user.id, [])

    if not players:
        await message.answer(
            f"{E.INFO} You are not playing in any UNO game right now.\n"
            f"{E.ADD} Create one with /newuno in a group."
        )
        return

    rows = []
    for player in players:
        title = player.game.chat.title or str(player.game.chat.id)
        if gm.userid_current.get(user.id) is player:
            title = f"- {title} -"
        rows.append([InlineKeyboardButton(
            text=title, callback_data=f"mm:sel:{player.game.chat.id}")])

    await message.answer(
        f"{E.TRAVEL} Please select the group you want to play in:",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
    )


# ── Combined left_chat_member handler ─────────

async def left_member_handler(message: Message) -> None:
    """Bot removed → event log; human left → UNO cleanup.

    Replaces the old ``log_bot_removed``-only registration so a single
    handler sees every ``left_chat_member`` (aiogram runs only the first
    matching handler per observer).
    """
    if not message.left_chat_member or not message.chat:
        return

    leaver = message.left_chat_member

    # Bot itself kicked → event log (same as before)
    if leaver.is_bot and app.bot_username and \
            leaver.username == app.bot_username:
        await log_bot_removed(message)
        return

    # Human left a group → remove from UNO game if seated
    if message.chat.type not in ("group", "supergroup"):
        return

    gm = _gm()
    if gm is None:
        return

    user = leaver
    chat = message.chat

    try:
        player = gm.player_for_user_in_chat(user, chat)
        if player is None:
            return
        game = player.game
        gm.leave_game(user, chat)
    except NoGameInChatError:
        return
    except NotEnoughPlayersError:
        try:
            gm.end_game(chat, user)
        except Exception:
            pass
        await message.answer(f"{E.GAME} Game ended!")
        return
    except Exception:
        logger.warning("UNO leave-on-part failed", exc_info=True)
        return

    await message.answer(
        f"{E.USER} Removing "
        f"<b>{escape_html(display_name(user))}</b> from the game.",
        parse_mode="HTML",
    )
