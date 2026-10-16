"""UNO deck (ported from mau_mau_bot deck.py)."""

import logging
from random import shuffle

from shadow_game_bot.core.maumau import card as c
from shadow_game_bot.core.maumau.card import Card
from shadow_game_bot.core.maumau.errors import DeckEmptyError


class Deck(object):
    """This class represents a deck of cards."""

    def __init__(self):
        self.cards = list()
        self.graveyard = list()
        self.logger = logging.getLogger(__name__)

    def shuffle(self):
        """Shuffles the deck."""
        self.logger.debug("Shuffling deck")
        shuffle(self.cards)

    def draw(self):
        """Draws a card from this deck (recycles the graveyard when empty)."""
        try:
            card = self.cards.pop()
            self.logger.debug("Drawing card %s", card)
            return card
        except IndexError:
            if len(self.graveyard):
                while len(self.graveyard):
                    self.cards.append(self.graveyard.pop())
                self.shuffle()
                return self.draw()
            raise DeckEmptyError()

    def dismiss(self, card):
        """Returns a card to the graveyard (clears wild colour)."""
        if card.special:
            card.color = None
        self.graveyard.append(card)

    def _fill_classic_(self):
        """Fill deck with the classic UNO card set (108 cards)."""
        self.cards.clear()
        for color in c.COLORS:
            for value in c.VALUES:
                self.cards.append(Card(color, value))
                if value != c.ZERO:
                    self.cards.append(Card(color, value))
        for special in c.SPECIALS:
            for _ in range(4):
                self.cards.append(Card(None, None, special=special))
        self.shuffle()

    def _fill_wild_(self):
        """Fill deck with the wild card set (140 cards)."""
        self.cards.clear()
        for color in c.COLORS:
            for value in c.WILD_VALUES:
                for _ in range(4):
                    self.cards.append(Card(color, value))
        for special in c.SPECIALS:
            for _ in range(6):
                self.cards.append(Card(None, None, special=special))
        self.shuffle()
