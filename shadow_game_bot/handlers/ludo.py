"""/ludo — open the Shadow Games Ludo mini app."""

import logging

from aiogram.types import (
    InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo,
)

from shadow_game_bot.config import config
from shadow_game_bot.emojis import E
from shadow_game_bot.reply import reply_text

logger = logging.getLogger(__name__)


async def ludo_handler(message: Message) -> None:
    url = getattr(config, "ludo_url", "") or "https://xlewin.github.io/ShadowGamesEN/webapp/ludo/"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🎲 Play Ludo", web_app=WebAppInfo(url=url)),
    ]])
    await reply_text(
        message,
        f"{E.GAME} <b>Shadow Games · Ludo</b>\n\n"
        "Roll the dice, race your four tokens home, and beat your friends!\n"
        "• Play vs Shadow Bots\n"
        "• Pass &amp; play on one device\n"
        "• Online rooms — share a 5-letter code",
        parse_mode="HTML",
        reply_markup=keyboard,
    )
