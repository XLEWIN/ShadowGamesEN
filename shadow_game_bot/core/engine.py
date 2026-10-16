"""Game engine — coordinates all game state transitions."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from shadow_game_bot.db.games import GamesCollection
from shadow_game_bot.db.players import PlayersCollection
from shadow_game_bot.db.words import WordsCollection
from shadow_game_bot.core.normalization import normalize_word

logger = logging.getLogger(__name__)


class GameEngine:
    def __init__(self, games: GamesCollection, players: PlayersCollection, words: WordsCollection):
        self.games = games
        self.players = players
        self.words = words

    async def start_new_game(self, chat_id: int, user_id: int, display_name: str, username: str = None, chat_name: str = None, category: str = "normal") -> Dict[str, Any]:
        game = await self.games.create_game(chat_id, user_id, chat_name, category=category)
        await self.players.add_or_update_player(game["id"], user_id, display_name, username)
        word = await self.words.get_random_word_for_game(game["id"], category=category)
        await self.words.mark_word_used(game["id"], word)
        round_doc = await self.games.create_round(game["id"], word, user_id)
        await self.games.set_leader(chat_id, user_id)
        await self.games.set_round(chat_id, round_doc["id"])
        return {"game": game, "round": round_doc, "word": word}

    async def get_game_info(self, chat_id: int) -> Optional[Dict[str, Any]]:
        game = await self.games.get_active_game(chat_id)
        if not game:
            return None
        round_doc = None
        if game.get("current_round_id"):
            cursor = await self.games.db.execute("SELECT * FROM rounds WHERE id = ?", (game["current_round_id"],))
            row = await cursor.fetchone()
            round_doc = dict(row) if row else None
        return {"game": game, "round": round_doc}

    async def handle_guess(self, chat_id: int, user_id: int, display_name: str, username: str = None, text: str = "") -> Optional[Dict[str, Any]]:
        game = await self.games.get_active_game(chat_id)
        if not game or not game.get("current_leader_id") or not game.get("current_round_id"):
            return None

        current_round_id = game["current_round_id"]
        current_leader_id = game["current_leader_id"]
        game_id = game["id"]

        word = await self.games.get_round_word(current_round_id)
        if not word:
            return None

        # Leader guessing own word
        if user_id == current_leader_id:
            if normalize_word(text) == normalize_word(word):
                ended = await self.games.end_round_atomic(current_round_id, None)
                if ended:
                    await self.games.reset_leader_selection(chat_id)
                    return {"winner_id": None, "winner_name": display_name, "was_leader": True, "new_word": None, "new_round": None, "points": 0}
            return None

        if normalize_word(text) != normalize_word(word):
            return None

        ended = await self.games.end_round_atomic(current_round_id, user_id)
        if not ended:
            return None

        new_score = await self.players.increment_score(game_id, user_id)
        await self.players.increment_words_guessed(game_id, user_id)
        await self.games.set_leader(chat_id, user_id)

        category = game.get("category", "normal")
        new_word = await self.words.get_random_word_for_game(game_id, category=category, exclude_normalized=normalize_word(word))
        await self.words.mark_word_used(game_id, new_word)
        new_round = await self.games.create_round(game_id, new_word, user_id)
        await self.games.set_round(chat_id, new_round["id"])
        await self.players.add_or_update_player(game_id, user_id, display_name, username)

        return {"winner_id": user_id, "winner_name": display_name, "was_leader": False, "new_word": new_word, "new_round": new_round, "points": new_score, "game": game}

    async def change_word(self, chat_id: int) -> Optional[str]:
        game = await self.games.get_active_game(chat_id)
        if not game or not game.get("current_round_id"):
            return None
        round_doc = await self.games.get_active_round(game["id"])
        if not round_doc or round_doc["status"] != "ACTIVE":
            return None

        category = game.get("category", "normal")
        new_word = await self.words.get_random_word_for_game(game["id"], category=category, exclude_normalized=normalize_word(round_doc["word"]))
        await self.words.mark_word_used(game["id"], new_word)

        now = datetime.now(timezone.utc).isoformat()
        await self.games.db.execute("UPDATE rounds SET word = ? WHERE id = ?", (new_word, game["current_round_id"]))
        await self.games.db.commit()
        return new_word

    async def set_custom_word(self, chat_id: int, new_word: str) -> bool:
        game = await self.games.get_active_game(chat_id)
        if not game or not game.get("current_round_id"):
            return False
        round_doc = await self.games.get_active_round(game["id"])
        if not round_doc or round_doc["status"] != "ACTIVE":
            return False
        await self.games.db.execute("UPDATE rounds SET word = ? WHERE id = ?", (new_word, game["current_round_id"]))
        await self.games.db.commit()
        return True

    async def drop_lead(self, chat_id: int) -> bool:
        game = await self.games.get_active_game(chat_id)
        if not game:
            return False
        if game.get("current_round_id"):
            await self.games.end_round_atomic(game["current_round_id"], None)
        await self.games.reset_leader_selection(chat_id)
        return True

    async def volunteer_leader(self, chat_id: int, user_id: int, display_name: str, username: str = None) -> Optional[Dict[str, Any]]:
        game = await self.games.get_active_game(chat_id)
        if not game or game.get("current_leader_id") is not None:
            return None

        now = datetime.now(timezone.utc).isoformat()
        cursor = await self.games.db.execute(
            "UPDATE games SET current_leader_id = ?, updated_at = ? WHERE id = ? AND current_leader_id IS NULL",
            (user_id, now, game["id"]),
        )
        await self.games.db.commit()
        if cursor.rowcount == 0:
            return None

        category = game.get("category", "normal")
        word = await self.words.get_random_word_for_game(game["id"], category=category)
        await self.words.mark_word_used(game["id"], word)
        round_doc = await self.games.create_round(game["id"], word, user_id)
        await self.games.set_round(chat_id, round_doc["id"])
        await self.players.add_or_update_player(game["id"], user_id, display_name, username)
        return {"game": game, "round": round_doc, "word": word}

    async def get_scoreboard(self, chat_id: int) -> list:
        game = await self.games.get_active_game(chat_id)
        if not game:
            return []
        return await self.players.get_leaderboard(game["id"])
