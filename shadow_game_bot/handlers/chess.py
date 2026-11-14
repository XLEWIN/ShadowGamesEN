"""/chess — open the Shadow Games Chess mini app."""

import logging

from aiogram.types import (
    InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo,
)

from shadow_game_bot.config import config
from shadow_game_bot.emojis import E
from shadow_game_bot.reply import reply_text

logger = logging.getLogger(__name__)


async def chess_handler(message: Message) -> None:
    url = getattr(config, "chess_url", "") or "https://xlewin.github.io/ShadowGamesEN/webapp/chess/"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="♟️ Play Chess", web_app=WebAppInfo(url=url)),
    ]])
    await reply_text(
        message,
        f"{E.GAME} <b>Shadow Games · Chess</b>\n\n"
        "The royal game — foony board, real rules.\n"
        "• Play vs the Shadow AI (Casual / Tactician / Master)\n"
        "• Pass &amp; play on one device\n"
        "• Online rooms — share a 5-letter code",
        parse_mode="HTML",
        reply_markup=keyboard,
    )
