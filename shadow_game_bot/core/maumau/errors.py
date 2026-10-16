"""UNO game exceptions (ported from mau_mau_bot errors.py)."""


class NoGameInChatError(Exception):
    """No running game exists in this chat."""


class AlreadyJoinedError(Exception):
    """User is already seated in the current game."""


class LobbyClosedError(Exception):
    """The game lobby is closed (/close)."""


class NotEnoughPlayersError(Exception):
    """Fewer than MIN_PLAYERS remain — game must end."""


class DeckEmptyError(Exception):
    """The draw pile and graveyard are both empty."""
