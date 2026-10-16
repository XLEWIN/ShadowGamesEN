"""Colored inline keyboards (Bot API 9.4+ button style), ported from Pi.

Uses Telegram's native button styling via direct model fields (aiogram's
TelegramObject passes unknown fields through to the API):

* ``style="primary"``  → blue
* ``style="success"``  → green
* ``style="danger"``   → red

Also supports ``icon_custom_emoji_id`` for the owner's premium emoji
icons on buttons.
"""

from __future__ import annotations

from typing import List, Optional

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

__all__ = [
    "btn_primary", "btn_success", "btn_danger", "btn_default", "btn_url",
    "build_keyboard",
]


def btn_primary(text: str, data: str,
                icon_emoji_id: Optional[str] = None) -> InlineKeyboardButton:
    """Blue/primary colored button."""
    kwargs = {"style": "primary"}
    if icon_emoji_id:
        kwargs["icon_custom_emoji_id"] = icon_emoji_id
    return InlineKeyboardButton(text=text, callback_data=data, **kwargs)


def btn_success(text: str, data: str,
                icon_emoji_id: Optional[str] = None) -> InlineKeyboardButton:
    """Green/success colored button."""
    kwargs = {"style": "success"}
    if icon_emoji_id:
        kwargs["icon_custom_emoji_id"] = icon_emoji_id
    return InlineKeyboardButton(text=text, callback_data=data, **kwargs)


def btn_danger(text: str, data: str,
               icon_emoji_id: Optional[str] = None) -> InlineKeyboardButton:
    """Red/danger colored button."""
    kwargs = {"style": "danger"}
    if icon_emoji_id:
        kwargs["icon_custom_emoji_id"] = icon_emoji_id
    return InlineKeyboardButton(text=text, callback_data=data, **kwargs)


def btn_default(text: str, data: str,
                icon_emoji_id: Optional[str] = None) -> InlineKeyboardButton:
    """Default/white colored button."""
    kwargs = {}
    if icon_emoji_id:
        kwargs["icon_custom_emoji_id"] = icon_emoji_id
    return InlineKeyboardButton(text=text, callback_data=data, **kwargs)


def btn_url(text: str, url: str, icon_emoji_id: Optional[str] = None,
            style: Optional[str] = None) -> InlineKeyboardButton:
    """URL button — optionally styled ("primary"/"success"/"danger")."""
    kwargs = {}
    if style:
        kwargs["style"] = style
    if icon_emoji_id:
        kwargs["icon_custom_emoji_id"] = icon_emoji_id
    return InlineKeyboardButton(text=text, url=url, **kwargs)


def build_keyboard(rows: List[List[InlineKeyboardButton]]) -> InlineKeyboardMarkup:
    """Build an InlineKeyboardMarkup from rows of buttons."""
    return InlineKeyboardMarkup(inline_keyboard=rows)
