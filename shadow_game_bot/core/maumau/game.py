"""UNO game state machine (ported from mau_mau_bot game.py).

Key merge fixes:
  * ``owner`` is a per-instance list (the original used a class-level
    shared ADMIN_LIST — a cross-game bug).
  * ``translate`` / promotions removed.
  * ``job`` holds an asyncio.Task for the fast-mode countdown instead of
    a PTB JobQueue handle.
"""

import logging
from datetime import datetime

from shadow_game_bot.core.maumau import card as c
from shadow_game_bot.core.maumau.config import (
    DEFAULT_GAMEMODE, OPEN_LOBBY,
)
from shadow_game_bot.core.maumau.deck import Deck


class Game(object):
    """This class represents a game of UNO."""

    def __init__(self, chat):
        # ── Per-instance mutable state (never class attributes!) ──
        self.chat = chat
        self.current_player = None
        self.reversed = False
        self.choosing_color = False
        self.started = False
        self.draw_counter = 0
        self.players_won = 0
        self.starter = None
        self.mode = DEFAULT_GAMEMODE
        self.job = None          # asyncio.Task | None (fast countdown)
        self.owner = []          # user ids allowed to manage the game
        self.open = OPEN_LOBBY

        self.last_card = None
        self.deck = Deck()

        self.logger = logging.getLogger(__name__)

    @property
    def players(self):
        """List of all players seated in this game (ring walk)."""
        players = list()
        if not self.current_player:
            return players

        current_player = self.current_player
        itplayer = current_player.next
        players.append(current_player)
        while itplayer and itplayer != current_player:
            players.append(itplayer)
            itplayer = itplayer.next
        return players

    def start(self):
        """Fill the deck for the chosen mode and play the first card."""
        if self.mode != "wild":
            self.deck._fill_classic_()
        else:
            self.deck._fill_wild_()

        self._first_card_()
        self.started = True

    def set_mode(self, mode):
        self.mode = mode

    def reverse(self):
        """Reverses the direction of play."""
        self.reversed = not self.reversed

    def turn(self):
        """Marks the turn as over and advances to the next player."""
        self.logger.debug("Next player")
        self.current_player = self.current_player.next
        self.current_player.drew = False
        self.current_player.turn_started = datetime.now()
        self.choosing_color = False

    def _first_card_(self):
        # In case the creator never selected a mode via inline query
        if not self.deck.cards:
            self.set_mode(DEFAULT_GAMEMODE)

        # First card must not be special
        while not self.last_card or self.last_card.special:
            self.last_card = self.deck.draw()
            if self.last_card.special:
                self.deck.dismiss(self.last_card)

        self.play_card(self.last_card)

    def play_card(self, card):
        """Play a card and trigger its effects.

        Call only from Player.play or on game start for the first card.
        """
        self.deck.dismiss(self.last_card)
        self.last_card = card

        self.logger.info("Playing card %r", card)
        if card.value == c.SKIP:
            self.turn()
        elif card.special == c.DRAW_FOUR:
            self.draw_counter += 4
            self.logger.debug("Draw counter increased by 4")
        elif card.value == c.DRAW_TWO:
            self.draw_counter += 2
            self.logger.debug("Draw counter increased by 2")
        elif card.value == c.REVERSE:
            # Special rule for two players: reverse acts like a skip
            if self.current_player == self.current_player.next.next:
                self.turn()
            else:
                self.reverse()

        # Don't turn if the current player has to choose a colour
        if card.special not in (c.CHOOSE, c.DRAW_FOUR):
            self.turn()
        else:
            self.logger.debug("Choosing colour...")
            self.choosing_color = True

    def choose_color(self, color):
        """Carries out the colour choice and turns the game."""
        self.last_card.color = color
        self.turn()
