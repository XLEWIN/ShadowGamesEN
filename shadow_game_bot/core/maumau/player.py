"""UNO player ring-list node (ported from mau_mau_bot player.py)."""

import logging
from datetime import datetime

from shadow_game_bot.core.maumau import card as c
from shadow_game_bot.core.maumau.config import WAITING_TIME
from shadow_game_bot.core.maumau.errors import DeckEmptyError


class Player(object):
    """A player in an UNO game.

    Doubly-linked ring list with optional reversal; on init the player
    connects itself to the game behind the current player.
    """

    def __init__(self, game, user):
        self.cards = list()
        self.game = game
        self.user = user
        self.logger = logging.getLogger(__name__)

        # First player in this game?
        if game.current_player:
            self.next = game.current_player
            self.prev = game.current_player.prev
            game.current_player.prev.next = self
            game.current_player.prev = self
        else:
            self._next = self
            self._prev = self
            game.current_player = self

        self.bluffing = False
        self.drew = False
        self.anti_cheat = 0
        self.turn_started = datetime.now()
        self.waiting_time = WAITING_TIME

    def draw_first_hand(self):
        try:
            for _ in range(7):
                self.cards.append(self.game.deck.draw())
        except DeckEmptyError:
            for card in self.cards:
                self.game.deck.dismiss(card)
            raise

    def leave(self):
        """Removes the player from the ring and returns cards to the deck."""
        if self.next == self:
            return

        self.next.prev = self.prev
        self.prev.next = self.next
        self.next = None
        self.prev = None

        for card in self.cards:
            self.game.deck.dismiss(card)

        self.cards = list()

    def __repr__(self):
        return repr(self.user)

    def __str__(self):
        return str(self.user)

    @property
    def next(self):
        return self._next if not self.game.reversed else self._prev

    @next.setter
    def next(self, player):
        if not self.game.reversed:
            self._next = player
        else:
            self._prev = player

    @property
    def prev(self):
        return self._prev if not self.game.reversed else self._next

    @prev.setter
    def prev(self, player):
        if not self.game.reversed:
            self._prev = player
        else:
            self._next = player

    def draw(self):
        """Draws 1+ cards (draw_counter or 1) from the deck."""
        amount = self.game.draw_counter or 1
        try:
            for _ in range(amount):
                self.cards.append(self.game.deck.draw())
        finally:
            self.game.draw_counter = 0
            self.drew = True

    def play(self, card):
        """Plays a card and removes it from hand."""
        self.cards.remove(card)
        self.game.play_card(card)

    def playable_cards(self):
        """Cards this player may play right now.

        Also updates self.bluffing — True when a playable card shares the
        last card's colour (so a +4 is NOT a bluff).
        """
        playable = list()
        last = self.game.last_card

        cards = self.cards
        if self.drew:
            cards = self.cards[-1:]

        self.bluffing = False
        for card in cards:
            if self._card_playable(card):
                playable.append(card)
                self.bluffing = self.bluffing or card.color == last.color

        # You may not play a chooser or +4 as your last card
        if len(self.cards) == 1 and self.cards[0].special:
            return list()

        return playable

    def _card_playable(self, card):
        """Check a single card against the last card."""
        is_playable = True
        last = self.game.last_card

        if (card.color != last.color and card.value != last.value
                and not card.special):
            is_playable = False
        elif (last.value == c.DRAW_TWO and card.value != c.DRAW_TWO
                and self.game.draw_counter):
            is_playable = False
        elif last.special == c.DRAW_FOUR and self.game.draw_counter:
            is_playable = False
        elif (last.special in (c.CHOOSE, c.DRAW_FOUR)
                and card.special in (c.CHOOSE, c.DRAW_FOUR)):
            is_playable = False
        elif not last.color:
            is_playable = False

        return is_playable
