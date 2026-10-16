"""Shadow Guess game keyboards — colored + premium-emoji icons (Pi style)."""

from aiogram.types import InlineKeyboardMarkup

from shadow_game_bot.emojis import EID
from shadow_game_bot.keyboards.colored import (
    build_keyboard,
    btn_danger,
    btn_primary,
    btn_success,
)

CB_PREFIX = "sgb"


def cb(action: str) -> str:
    return f"{CB_PREFIX}:{action}"


def build_mode_selection() -> InlineKeyboardMarkup:
    """Normal / Fiction mode selection buttons."""
    return build_keyboard([[
        btn_success("Normal", cb("mode:normal"), icon_emoji_id=EID.FIRE),
        btn_primary("Fiction", cb("mode:fiction"), icon_emoji_id=EID.SPARKLE),
    ]])


def build_leader_controls(category: str = "normal") -> InlineKeyboardMarkup:
    """2x2 leader controls: See/Write (blue), Change (green), Drop (red)."""
    return build_keyboard([
        [
            btn_primary("See Word", cb("see"), icon_emoji_id=EID.EYES),
            btn_primary("Write Word", cb("write"), icon_emoji_id=EID.SPARKLE),
        ],
        [
            btn_success("Change Word", cb("change"), icon_emoji_id=EID.FRESH),
            btn_danger("Drop Lead", cb("drop"), icon_emoji_id=EID.CROSS),
        ],
    ])


def build_leader_selection() -> InlineKeyboardMarkup:
    """Red 'I Want to be Leader' button."""
    return build_keyboard([[
        btn_danger("I Want to be Leader", cb("volunteer"),
                   icon_emoji_id=EID.CROWN),
    ]])
