"""WordSeek inline keyboards (callbacks use the `ws:` prefix).

Colors come from Bot API 9.4 button ``style``; icons from the owner's
premium custom emoji (``icon_custom_emoji_id``).  Both ride through
aiogram's pass-through fields, exactly like Pi.
"""

from __future__ import annotations

from typing import List, Optional

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from shadow_game_bot.emojis import EID
from shadow_game_bot.keyboards.colored import (
    btn_default,
    btn_primary,
    btn_url,
)

UPDATES_CHANNEL = "https://t.me/ShadowBotsHQ"
DISCUSSION_GROUP = "https://t.me/keczt"

ALLOWED_SEARCH_KEYS = ["global", "group"]
ALLOWED_TIME_KEYS = ["today", "week", "month", "year", "all"]
ALLOWED_WORD_LENGTHS = [4, 5, 6]


def format_active_button(label: str, active: bool) -> str:
    return f"« {label} »" if active else label


def _filter_btn(text: str, callback_data: str, active: bool = False,
                icon: Optional[str] = None) -> InlineKeyboardButton:
    """Filter chip: blue+icon when selected, plain otherwise."""
    if active:
        return btn_primary(text, callback_data, icon_emoji_id=icon)
    return btn_default(text, callback_data, icon_emoji_id=icon)


def generate_leaderboard_keyboard(
    search_key: str,
    time_key: str,
    word_length: int = 5,
    callback_key: str = "leaderboard",
    back_button=None,
) -> InlineKeyboardMarkup:
    """callback_key examples: "leaderboard" or "score 12345"."""
    rows: List[List[InlineKeyboardButton]] = []

    # Scope row (with refresh in the middle)
    row: List[InlineKeyboardButton] = []
    mid = len(ALLOWED_SEARCH_KEYS) // 2
    for index, key in enumerate(ALLOWED_SEARCH_KEYS):
        if index == mid:
            row.append(btn_default(
                "🔄",
                f"ws:{callback_key} {search_key} {time_key} {word_length}",
            ))
        label = format_active_button(
            "This chat" if key == "group" else "Global", search_key == key
        )
        row.append(_filter_btn(
            label,
            f"ws:{callback_key} {key} {time_key} {word_length}",
            active=search_key == key,
            icon=EID.GLOBE if key == "global" else EID.PIN,
        ))
    rows.append(row)

    # Period row(s) — 3 per row
    time_labels = {
        "all": "All time", "today": "Today",
        "week": "This week", "month": "This month", "year": "This year",
    }
    time_icons = {
        "all": EID.TROPHY, "today": EID.FIRE, "week": EID.CLOCK,
        "month": EID.BOOKMARK, "year": EID.STAR,
    }
    row = []
    for index, key in enumerate(ALLOWED_TIME_KEYS):
        label = format_active_button(time_labels[key], time_key == key)
        row.append(_filter_btn(
            label,
            f"ws:{callback_key} {search_key} {key} {word_length}",
            active=time_key == key,
            icon=time_icons.get(key),
        ))
        if (index + 1) % 3 == 0:
            rows.append(row)
            row = []
    if row:
        rows.append(row)

    # Length row
    rows.append([
        _filter_btn(
            format_active_button(f"{length} letters", word_length == length),
            f"ws:{callback_key} {search_key} {time_key} {length}",
            active=word_length == length,
            icon=EID.NUMBER_1,
        )
        for length in ALLOWED_WORD_LENGTHS
    ])

    # Links
    rows.append([
        btn_url("📢 Official Channel", UPDATES_CHANNEL, icon_emoji_id=EID.ANNOUNCE),
        btn_url("💬 Support Chat", DISCUSSION_GROUP, icon_emoji_id=EID.INFO),
    ])

    if back_button:
        rows.append([btn_default(
            back_button["text"], back_button["callback"],
            icon_emoji_id=EID.FORWARD,
        )])

    return InlineKeyboardMarkup(inline_keyboard=rows)


# ── Captcha ─────────────────────────────────────

SLOT_SYMBOLS = ["➖", "🍒", "🍋", "7️⃣"]


def build_captcha_keyboard(progress: list) -> InlineKeyboardMarkup:
    rows = [[btn_default(symbol, f"ws:captcha_pick {symbol}")
             for symbol in SLOT_SYMBOLS]]
    if progress:
        rows.append([
            btn_default("⬅️", "ws:captcha_back", icon_emoji_id=EID.FORWARD),
            btn_default("❌ Clear", "ws:captcha_clear", icon_emoji_id=EID.CROSS),
        ])
    return InlineKeyboardMarkup(inline_keyboard=rows)


# ── User selection (ambiguous /score username) ──

def generate_user_selection_keyboard(users: list, username: str) -> InlineKeyboardMarkup:
    rows = []
    for user in users:
        rows.append([btn_default(
            f"{user.get('name') or 'Unknown'} (@{username})",
            f"ws:score_select {user['id']} {username}",
            icon_emoji_id=EID.USER,
        )])
    return InlineKeyboardMarkup(inline_keyboard=rows)


# ── Misc ────────────────────────────────────────

def get_general_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        btn_url("Official Channel", UPDATES_CHANNEL, icon_emoji_id=EID.ANNOUNCE),
        btn_url("Support Chat", DISCUSSION_GROUP, icon_emoji_id=EID.INFO),
    ]])
