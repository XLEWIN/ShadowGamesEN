"""UNO (mau mau) game engine — pure logic, no Telegram imports.

Port of jh0ker/mau_mau_bot (AGPL-3.0) engine classes adapted for the
merged aiogram bot: game, deck, card, player, game_manager.
Telegram concerns (inline queries, commands, countdown tasks) live in
``shadow_game_bot.handlers.maumau_*``.
"""

from shadow_game_bot.core.maumau.card import (
    Card, COLORS, COLOR_ICONS, SPECIALS, from_str,
    RED, BLUE, GREEN, YELLOW, BLACK,
    ZERO, ONE, TWO, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE,
    DRAW_TWO, REVERSE, SKIP, CHOOSE, DRAW_FOUR,
)
from shadow_game_bot.core.maumau.deck import Deck
from shadow_game_bot.core.maumau.player import Player
from shadow_game_bot.core.maumau.game import Game
from shadow_game_bot.core.maumau.game_manager import GameManager
from shadow_game_bot.core.maumau.errors import (
    AlreadyJoinedError, DeckEmptyError, LobbyClosedError,
    NoGameInChatError, NotEnoughPlayersError,
)
from shadow_game_bot.core.maumau.config import (
    DEFAULT_GAMEMODE, MIN_PLAYERS, MIN_FAST_TURN_TIME, OPEN_LOBBY,
    TIME_REMOVAL_AFTER_SKIP, WAITING_TIME, GAME_MODES,
)
from shadow_game_bot.core.maumau.display import (
    display_name, display_color, card_display, card_emoji,
)

__all__ = [
    "Card", "COLORS", "COLOR_ICONS", "SPECIALS", "from_str",
    "RED", "BLUE", "GREEN", "YELLOW", "BLACK",
    "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN",
    "EIGHT", "NINE", "DRAW_TWO", "REVERSE", "SKIP", "CHOOSE", "DRAW_FOUR",
    "Deck", "Player", "Game", "GameManager",
    "AlreadyJoinedError", "DeckEmptyError", "LobbyClosedError",
    "NoGameInChatError", "NotEnoughPlayersError",
    "DEFAULT_GAMEMODE", "MIN_PLAYERS", "MIN_FAST_TURN_TIME", "OPEN_LOBBY",
    "TIME_REMOVAL_AFTER_SKIP", "WAITING_TIME", "GAME_MODES",
    "display_name", "display_color", "card_display", "card_emoji",
]
