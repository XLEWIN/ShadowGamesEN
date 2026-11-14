"""Shadow Games hub command + inline game-invite articles.

/games replies with a button that opens the Games Hub (all mini apps).
Inline mode: ``@ShadowGameEnBot ludo ABCDE`` / ``chess ABCDE`` / ``games``
shares an invite card — tapping the URL button opens the webapp at
``?room=CODE`` and auto-joins the room (works in groups and PMs; ``url``
buttons are allowed everywhere).
"""

import logging
import re

from aiogram.types import (
    InlineKeyboardButton, InlineKeyboardMarkup, InlineQuery,
    InlineQueryResultArticle, InputTextMessageContent, Message, WebAppInfo,
)

from shadow_game_bot.context import app  # noqa: F401  (kept for parity with other handlers)
from shadow_game_bot.emojis import E
from shadow_game_bot.reply import reply_text

logger = logging.getLogger(__name__)

_HUB_URL = "https://xlewin.github.io/ShadowGamesEN/webapp/"
_LUDO_URL = "https://xlewin.github.io/ShadowGamesEN/webapp/ludo/"
_CHESS_URL = "https://xlewin.github.io/ShadowGamesEN/webapp/chess/"

_GAME_RE = re.compile(r"^\s*(ludo|chess|games?)\b", re.I)
_CODE_TOKEN_RE = re.compile(r"^[A-Z0-9]{5}$")
_GAME_WORDS = {"LUDO", "CHESS", "GAMES", "GAME"}


def _extract_code(raw: str):
    """First standalone 5-char alnum token that isn't the game keyword itself."""
    for i, token in enumerate(raw.upper().split()):
        if i == 0 and token in _GAME_WORDS:
            continue
        if _CODE_TOKEN_RE.fullmatch(token):
            return token
    return None


def _hub_url() -> str:
    try:
        from shadow_game_bot.config import config
        return getattr(config, "games_url", "") or _HUB_URL
    except Exception:
        return _HUB_URL


# ── /games command ─────────────────────────────

async def games_handler(message: Message) -> None:
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🎮 Open Games Hub", web_app=WebAppInfo(url=_hub_url())),
    ]])
    await reply_text(
        message,
        f"{E.GAME} <b>Shadow Games</b>\n\n"
        "All games in one place:\n"
        "• ♟️ Ludo · Chess — mini apps (1v1, vs AI, online rooms)\n"
        "• 🎴 UNO · 🟩 WordSeek · 🔤 Shadow Word — right here in chat\n\n"
        "Tap the button to open the Games Hub.",
        parse_mode="HTML",
        reply_markup=keyboard,
    )


# ── Inline invite articles ─────────────────────

def _invite_article(game: str, code: str) -> InlineQueryResultArticle:
    is_ludo = game == "ludo"
    title = f"Join {'Ludo' if is_ludo else 'Chess'} room {code}"
    base = _LUDO_URL if is_ludo else _CHESS_URL
    text = (f"🎲 <b>Shadow Games</b> — join my {'Ludo' if is_ludo else 'Chess'} room <b>{code}</b>!\n\n"
            "Tap the button to open the game and jump into the room.")
    markup = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=f"🎮 Join Room {code}", url=f"{base}?room={code}"),
    ]])
    return InlineQueryResultArticle(
        id=f"invite-{game}-{code}",
        title=title,
        description="Opens Shadow Games and joins the room automatically.",
        input_message_content=InputTextMessageContent(message_text=text, parse_mode="HTML"),
        thumbnail_url=f"{base}assets/icon.webp",
        reply_markup=markup,
    )


# ── Shared articles for the inline menu ───────

def game_hub_articles() -> list:
    """Hub/game open articles shown in the bare inline menu."""
    return [
        _article(
            "hub", "🎮 Shadow Games",
            "Ludo · Chess · UNO · WordSeek · Shadow Word — all in one hub",
            "🎮 <b>Shadow Games</b> — Ludo, Chess and all the chat games!",
            "🎮 Open Games Hub", _HUB_URL,
            f"{_HUB_URL.rstrip('/')}/ludo/assets/icon.webp"),
        _article(
            "open-ludo", "🎲 Shadow Games · Ludo",
            "Play vs AI, 1v1 with a friend, or online rooms",
            "🎲 <b>Shadow Games · Ludo</b> — race your pawns home!",
            "🎮 Open Ludo", _LUDO_URL, f"{_LUDO_URL}assets/icon.webp"),
        _article(
            "open-chess", "♟️ Shadow Games · Chess",
            "Real rules — vs AI, 1v1, or online rooms with clocks",
            "♟️ <b>Shadow Games · Chess</b> — outwit. outplay. outlast.",
            "🎮 Open Chess", _CHESS_URL, f"{_CHESS_URL}assets/icon.webp"),
    ]


def _article(result_id: str, title: str, description: str, text: str,
             button_text: str, url: str, thumbnail: str | None = None) -> InlineQueryResultArticle:
    markup = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=button_text, url=url),
    ]])
    return InlineQueryResultArticle(
        id=result_id,
        title=title,
        description=description,
        input_message_content=InputTextMessageContent(message_text=text, parse_mode="HTML"),
        thumbnail_url=thumbnail,
        reply_markup=markup,
    )


async def games_inline_query(query: InlineQuery) -> None:
    raw = (query.query or "").strip()
    text = raw.lower()
    m = _GAME_RE.match(text)
    game = m.group(1).lower() if m else ""
    code = _extract_code(raw)

    articles = []
    if code and game in ("ludo", "chess"):
        articles.append(_invite_article(game, code))
    elif game == "ludo":
        articles.append(_article(
            "open-ludo", "🎲 Shadow Games · Ludo",
            "Play vs AI, 1v1 with a friend, or online rooms",
            "🎲 <b>Shadow Games · Ludo</b> — race your pawns home!",
            "🎮 Open Ludo", _LUDO_URL, f"{_LUDO_URL}assets/icon.webp"))
    elif game == "chess":
        articles.append(_article(
            "open-chess", "♟️ Shadow Games · Chess",
            "Real rules — vs AI, 1v1, or online rooms with clocks",
            "♟️ <b>Shadow Games · Chess</b> — outwit. outplay. outlast.",
            "🎮 Open Chess", _CHESS_URL, f"{_CHESS_URL}assets/icon.webp"))
    else:  # "games" / "game" / anything else matching the filter
        articles = game_hub_articles()

    await query.answer(articles, cache_time=120, is_personal=False)


from aiogram.filters import BaseFilter  # noqa: E402


class GamesInlineFilter(BaseFilter):
    """True for inline queries starting with ludo | chess | game(s)."""

    async def __call__(self, query: InlineQuery) -> bool:  # type: ignore[override]
        return bool(_GAME_RE.match(query.query or ""))
