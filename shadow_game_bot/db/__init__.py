"""Database layer — exports all collections."""
from shadow_game_bot.db.connection import get_database, close_database
from shadow_game_bot.db.games import GamesCollection
from shadow_game_bot.db.players import PlayersCollection
from shadow_game_bot.db.words import WordsCollection
from shadow_game_bot.db.users import UserCollection
from shadow_game_bot.db.wordseek import WordSeekCollection
from shadow_game_bot.db.uno import UnoStatsCollection

__all__ = [
    "get_database", "close_database",
    "GamesCollection", "PlayersCollection", "WordsCollection", "UserCollection",
    "WordSeekCollection", "UnoStatsCollection",
]
