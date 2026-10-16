"""UNO game manager (ported from mau_mau_bot game_manager.py).

Removed: ``send_promotion_async`` (promotions module dropped — only
channel + support links allowed).  ``Game.owner`` is now a per-instance
list; the original class-level ADMIN_LIST was a shared-mutable bug.
"""

import logging

from shadow_game_bot.core.maumau.errors import (
    AlreadyJoinedError, LobbyClosedError, NoGameInChatError,
    NotEnoughPlayersError,
)
from shadow_game_bot.core.maumau.game import Game
from shadow_game_bot.core.maumau.player import Player


class GameManager(object):
    """Manages all running games by using a confusing amount of dicts."""

    def __init__(self):
        self.chatid_games = dict()      # chat_id -> [Game]
        self.userid_players = dict()    # user_id -> [Player]
        self.userid_current = dict()    # user_id -> selected Player
        self.remind_dict = dict()       # chat_id -> {user_ids for /notifyme}

        self.logger = logging.getLogger(__name__)

    def new_game(self, chat):
        """Create a new game in this chat."""
        chat_id = chat.id

        self.logger.debug("Creating new game in chat %s", chat_id)
        game = Game(chat)

        if chat_id not in self.chatid_games:
            self.chatid_games[chat_id] = list()

        # Remove dead games with no players
        for g in list(self.chatid_games[chat_id]):
            if not g.players:
                self.chatid_games[chat_id].remove(g)

        self.chatid_games[chat_id].append(game)
        return game

    def join_game(self, user, chat):
        """Create a Player from the Telegram user and seat them."""
        self.logger.info("Joining game in chat %s", chat.id)

        try:
            game = self.chatid_games[chat.id][-1]
        except (KeyError, IndexError):
            raise NoGameInChatError()

        if not game.open:
            raise LobbyClosedError()

        if user.id not in self.userid_players:
            self.userid_players[user.id] = list()

        players = self.userid_players[user.id]

        # Don't re-add; also move the player out of any older game in
        # this chat first.
        for player in players:
            if player in game.players:
                raise AlreadyJoinedError()

        try:
            self.leave_game(user, chat)
        except NoGameInChatError:
            pass
        except NotEnoughPlayersError:
            self.end_game(chat, user)

            if user.id not in self.userid_players:
                self.userid_players[user.id] = list()

            players = self.userid_players[user.id]

        player = Player(game, user)
        if game.started:
            player.draw_first_hand()

        players.append(player)
        self.userid_current[user.id] = player

    def leave_game(self, user, chat):
        """Remove a player from their current game in this chat."""
        player = self.player_for_user_in_chat(user, chat)
        players = self.userid_players.get(user.id, list())

        if not player:
            # Not the selected game — scan every game in this chat
            # (covers the userid_current bookkeeping edge case).
            games = self.chatid_games.get(chat.id)
            if games:
                for g in games:
                    for p in g.players:
                        if p.user.id == user.id:
                            if p == g.current_player:
                                g.turn()
                            p.leave()
                            return
            raise NoGameInChatError

        game = player.game

        if len(game.players) < 3:
            raise NotEnoughPlayersError()

        if player is game.current_player:
            game.turn()

        player.leave()
        players.remove(player)

        # If this was the user's selected game, switch to another
        if self.userid_current.get(user.id) is player:
            if players:
                self.userid_current[user.id] = players[0]
            else:
                self.userid_current.pop(user.id, None)
                self.userid_players.pop(user.id, None)

    def end_game(self, chat, user):
        """End a game (the user must be seated in it)."""
        self.logger.info("Game in chat %s ended", chat.id)

        player = self.player_for_user_in_chat(user, chat)
        if not player:
            raise NoGameInChatError

        game = player.game

        # Clear bookkeeping for every seated player
        for player_in_game in game.players:
            this_users_players = self.userid_players.get(
                player_in_game.user.id, list())

            try:
                this_users_players.remove(player_in_game)
            except ValueError:
                pass

            if this_users_players:
                self.userid_current.setdefault(
                    player_in_game.user.id, this_users_players[0])
            else:
                self.userid_players.pop(player_in_game.user.id, None)
                self.userid_current.pop(player_in_game.user.id, None)

        self.chatid_games[chat.id].remove(game)
        if not self.chatid_games[chat.id]:
            del self.chatid_games[chat.id]

    def player_for_user_in_chat(self, user, chat):
        """The player object for this user in this chat, or None."""
        players = self.userid_players.get(user.id, list())
        for player in players:
            if player.game.chat.id == chat.id:
                return player
        return None
