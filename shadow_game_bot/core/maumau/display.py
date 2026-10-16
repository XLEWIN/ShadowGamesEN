"""Display helpers for UNO cards and players (no Telegram imports).

Card rendering: the original bot used sticker file_ids that only work for
that specific bot.  Here every card is a text string plus a colour emoji
so it works inline (``InlineQueryResultArticle``) and in group messages.
"""

from __future__ import annotations

from shadow_game_bot.core.maumau import card as c

_VALUE_LABELS = {
    c.ZERO: "0", c.ONE: "1", c.TWO: "2", c.THREE: "3", c.FOUR: "4",
    c.FIVE: "5", c.SIX: "6", c.SEVEN: "7", c.EIGHT: "8", c.NINE: "9",
    c.DRAW_TWO: "+2",
    c.REVERSE: "Reverse",
    c.SKIP: "Skip",
    c.CHOOSE: "Colour",
    c.DRAW_FOUR: "+4",
}

_COLOR_NAMES = {
    c.RED: "Red",
    c.BLUE: "Blue",
    c.GREEN: "Green",
    c.YELLOW: "Yellow",
    c.BLACK: "Wild",
}


def display_name(user) -> str:
    """``First (@username)`` — same shape as the original util."""
    name = getattr(user, "first_name", None) or getattr(user, "full_name", None) or "Player"
    username = getattr(user, "username", None)
    if username:
        name += f" (@{username})"
    return name


def display_color(color: str) -> str:
    """Human colour label with its emoji, e.g. ``❤️ Red``."""
    icon = c.COLOR_ICONS.get(color, "")
    name = _COLOR_NAMES.get(color, color)
    return f"{icon} {name}"


def card_emoji(card: c.Card) -> str:
    """Colour icon for a card (wild cards show the black square)."""
    if card.special:
        return c.COLOR_ICONS[c.BLACK]
    return c.COLOR_ICONS.get(card.color, c.COLOR_ICONS[c.BLACK])


def card_display(card: c.Card) -> str:
    """Text label for a card, e.g. ``❤️ 5``, ``⬛ +4``, ``⬛ Reverse``."""
    label = _VALUE_LABELS.get(card.value if not card.special else card.special, str(card))
    return f"{card_emoji(card)} {label}"
