"""UNO card model (ported from mau_mau_bot card.py).

Sticker file_ids for the ``classic_colorblind`` pack live in
:mod:`shadow_game_bot.core.maumau.stickers`.  Cards still expose
text/emoji labels via :mod:`shadow_game_bot.core.maumau.display`
for fallbacks and game-info messages.
"""

# Colors
RED = 'r'
BLUE = 'b'
GREEN = 'g'
YELLOW = 'y'
BLACK = 'x'

COLORS = (RED, BLUE, GREEN, YELLOW)

COLOR_ICONS = {
    RED: '❤️',
    BLUE: '💙',
    GREEN: '💚',
    YELLOW: '💛',
    BLACK: '⬛',
}

# Values
ZERO = '0'
ONE = '1'
TWO = '2'
THREE = '3'
FOUR = '4'
FIVE = '5'
SIX = '6'
SEVEN = '7'
EIGHT = '8'
NINE = '9'
DRAW_TWO = 'draw'
REVERSE = 'reverse'
SKIP = 'skip'

VALUES = (ZERO, ONE, TWO, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE,
          DRAW_TWO, REVERSE, SKIP)
# Wild mode drops the 0s and uses only one of each number/special per colour.
WILD_VALUES = (ONE, TWO, THREE, FOUR, FIVE, DRAW_TWO, REVERSE, SKIP)

# Special cards
CHOOSE = 'colorchooser'
DRAW_FOUR = 'draw_four'

SPECIALS = (CHOOSE, DRAW_FOUR)


class Card(object):
    """This class represents an UNO card."""

    def __init__(self, color, value, special=None):
        self.color = color
        self.value = value
        self.special = special

    def __str__(self):
        if self.special:
            return self.special
        return '%s_%s' % (self.color, self.value)

    def __repr__(self):
        if self.special:
            return '%s%s%s' % (
                COLOR_ICONS.get(self.color, ''),
                COLOR_ICONS[BLACK],
                ' '.join(s.capitalize() for s in self.special.split('_')),
            )
        return '%s%s' % (COLOR_ICONS[self.color], self.value.capitalize())

    def __eq__(self, other):
        """Needed for sorting the cards."""
        return str(self) == str(other)

    def __lt__(self, other):
        """Needed for sorting the cards."""
        return str(self) < str(other)

    def __hash__(self):
        return hash(str(self))


def from_str(string):
    """Decodes a Card object from a string (result_id protocol)."""
    if string not in SPECIALS:
        color, value = string.split('_')
        return Card(color, value)
    return Card(None, None, string)
