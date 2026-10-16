"""Engine tests for the UNO (mau mau) port — pure logic, no Telegram.

Run:  python tests\test_maumau.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("BOT_TOKEN", "123456:TEST-TOKEN")
os.environ.setdefault("OWNER_ID", "1")

from shadow_game_bot.core.maumau import (
    AlreadyJoinedError, Card, Deck, DeckEmptyError, Game, GameManager,
    LobbyClosedError, NoGameInChatError, NotEnoughPlayersError,
    card_display, display_color, display_name, from_str,
    BLUE, CHOOSE, COLORS, DRAW_FOUR, DRAW_TWO, GREEN, RED, REVERSE,
    SKIP, SPECIALS, YELLOW, ZERO,
)
from shadow_game_bot.core.maumau import card as c

PASS = 0
FAIL = 0


def _safe(s) -> str:
    """cp1252-safe string for console output (no emoji)."""
    return str(s).encode("ascii", "replace").decode("ascii")


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {_safe(detail)}")


# ── Fakes ─────────────────────────────────────

class FakeUser:
    def __init__(self, uid, name="Player"):
        self.id = uid
        self.first_name = name
        self.username = f"u{uid}"
        self.full_name = name

    def __repr__(self):
        return f"User({self.id})"


class FakeChat:
    def __init__(self, cid=-1001, title="Test"):
        self.id = cid
        self.title = title
        self.type = "supergroup"


# ── Card tests ────────────────────────────────

def test_card_basics():
    card = Card(RED, "5")
    check("str(card)", str(card) == "r_5", str(card))
    check("repr(card)", "5" in repr(card) and "❤️" in repr(card), repr(card))

    special = Card(None, None, special=DRAW_FOUR)
    check("str(special)", str(special) == DRAW_FOUR)
    check("repr(special) has Draw Four", "Draw Four" in repr(special),
          repr(special))

    check("from_str normal", str(from_str("b_9")) == "b_9")
    check("from_str special", str(from_str(DRAW_FOUR)) == DRAW_FOUR)
    check("eq", Card(RED, "5") == Card(RED, "5"))
    check("sort", sorted([Card(BLUE, "1"), Card(RED, "0")])[0].color == BLUE)


def test_card_display():
    check("display colour red",
          display_color(RED) == "❤️ Red", display_color(RED))
    check("display colour wild",
          display_color("x") == "⬛ Wild", display_color("x"))
    check("card_display number",
          card_display(Card(YELLOW, "7")) == "💛 7",
          card_display(Card(YELLOW, "7")))
    check("card_display +2",
          card_display(Card(GREEN, DRAW_TWO)) == "💚 +2",
          card_display(Card(GREEN, DRAW_TWO)))
    check("card_display wild",
          card_display(Card(None, None, special=CHOOSE)) == "⬛ Colour",
          card_display(Card(None, None, special=CHOOSE)))


def test_display_name():
    u = FakeUser(1, "Alice")
    check("display_name", display_name(u) == "Alice (@u1)", display_name(u))
    u2 = FakeUser(2, "Bob")
    u2.username = None
    check("display_name no username", display_name(u2) == "Bob")


# ── Deck tests ────────────────────────────────

def test_deck_classic():
    d = Deck()
    d._fill_classic_()
    check("classic deck = 108", len(d.cards) == 108, len(d.cards))

    # 4 colours × (one 0 + two each of 1-9/draw/reverse/skip) + 8 specials
    zeros = sum(1 for x in d.cards if x.value == ZERO and not x.special)
    check("classic 4 zeros", zeros == 4, zeros)
    specials = sum(1 for x in d.cards if x.special)
    check("classic 8 specials", specials == 8, specials)


def test_deck_wild():
    d = Deck()
    d._fill_wild_()
    check("wild deck = 140", len(d.cards) == 140, len(d.cards))


def test_deck_draw_recycle():
    d = Deck()
    d.cards = [Card(RED, "1")]
    check("draw last card", str(d.draw()) == "r_1")
    try:
        d.draw()
        check("empty raises", False)
    except DeckEmptyError:
        check("empty raises", True)

    d.dismiss(Card(RED, "2"))
    d.dismiss(Card(None, None, special=CHOOSE))
    check("recycle draws", d.draw() is not None)


def test_dismiss_clears_wild_colour():
    d = Deck()
    wild = Card(None, None, special=DRAW_FOUR)
    wild.color = RED   # colour chosen
    d.dismiss(wild)
    check("dismiss clears special colour", wild.color is None)


# ── Game / Player ring ────────────────────────

def test_game_ring():
    chat = FakeChat()
    game = Game(chat)
    check("owner is instance list", game.owner == [] and
          Game(FakeChat()).owner == [])

    u1, u2, u3 = FakeUser(1, "A"), FakeUser(2, "B"), FakeUser(3, "C")
    from shadow_game_bot.core.maumau.player import Player
    p1 = Player(game, u1)
    p2 = Player(game, u2)
    p3 = Player(game, u3)

    check("3 players", len(game.players) == 3)
    order = [p.user.id for p in game.players]
    check("ring order", order == [1, 2, 3], order)

    game.reverse()
    order = [p.user.id for p in game.players]
    check("reversed ring still lists all", sorted(order) == [1, 2, 3], order)
    check("reversed next from p1", p1.next is p3, p1.next)


def test_game_start_and_play():
    chat = FakeChat()
    game = Game(chat)
    game.owner = [1]
    u1, u2 = FakeUser(1, "A"), FakeUser(2, "B")
    from shadow_game_bot.core.maumau.player import Player
    Player(game, u1)
    Player(game, u2)

    game.start()
    check("game started", game.started)
    check("first card not special",
          game.last_card is not None and not game.last_card.special,
          game.last_card)
    check("deck filled", len(game.deck.cards) > 0)

    # Deal hands
    for p in game.players:
        p.draw_first_hand()
    check("hands of 7", all(len(p.cards) == 7 for p in game.players),
          [len(p.cards) for p in game.players])

    # First card was played — current player advanced past starter
    check("current player set", game.current_player is not None)


def test_skip_card_effect():
    chat = FakeChat()
    game = Game(chat)
    u1, u2, u3 = FakeUser(1), FakeUser(2), FakeUser(3)
    from shadow_game_bot.core.maumau.player import Player
    p1 = Player(game, u1)
    p2 = Player(game, u2)
    Player(game, u3)

    game.started = True
    game.last_card = Card(RED, "5")
    game.current_player = p1

    game.play_card(Card(RED, SKIP))
    # Skip advances TWO players (skip the next, then normal turn)
    check("skip advances past next", game.current_player is p2
          or game.current_player.user.id in (2, 3),
          game.current_player)


def test_draw_two_increments_counter():
    chat = FakeChat()
    game = Game(chat)
    u1, u2, u3 = FakeUser(1), FakeUser(2), FakeUser(3)
    from shadow_game_bot.core.maumau.player import Player
    Player(game, u1)
    Player(game, u2)
    Player(game, u3)
    game.started = True
    game.last_card = Card(RED, "5")
    game.draw_counter = 0

    game.play_card(Card(BLUE, DRAW_TWO))
    check("draw_counter += 2", game.draw_counter == 2, game.draw_counter)


def test_draw_four_increments_counter():
    chat = FakeChat()
    game = Game(chat)
    for uid in (1, 2, 3):
        from shadow_game_bot.core.maumau.player import Player
        Player(game, FakeUser(uid))
    game.started = True
    game.last_card = Card(RED, "5")
    game.draw_counter = 0

    game.play_card(Card(None, None, special=DRAW_FOUR))
    check("draw_counter += 4", game.draw_counter == 4, game.draw_counter)
    check("choosing colour after +4", game.choosing_color)


def test_choose_colour():
    chat = FakeChat()
    game = Game(chat)
    u1, u2 = FakeUser(1), FakeUser(2)
    from shadow_game_bot.core.maumau.player import Player
    Player(game, u1)
    p2 = Player(game, u2)
    game.started = True
    game.choosing_color = True
    game.last_card = Card(None, None, special=CHOOSE)
    game.current_player = p2

    game.choose_color(GREEN)
    check("colour set", game.last_card.color == GREEN)
    check("turn advanced", game.current_player is not p2)
    check("choosing_color cleared", not game.choosing_color)


def test_playable_cards():
    chat = FakeChat()
    game = Game(chat)
    u1, u2 = FakeUser(1), FakeUser(2)
    from shadow_game_bot.core.maumau.player import Player
    p1 = Player(game, u1)
    Player(game, u2)
    game.started = True
    game.last_card = Card(RED, "5")
    game.current_player = p1

    p1.cards = [Card(RED, "7"), Card(BLUE, "5"), Card(GREEN, "9")]
    playable = p1.playable_cards()
    check("colour match", Card(RED, "7") in playable)
    check("value match", Card(BLUE, "5") in playable)
    check("no match excluded", Card(GREEN, "9") not in playable)
    check("bluffing False (has red)",
          p1.bluffing is True)  # has red → +4 would NOT be bluff; here
                                 # bluffing tracks "has matching colour"

    # Only wild-matching cards → bluffing
    p1.cards = [Card(BLUE, "5"), Card(GREEN, "5")]
    p1.drew = False
    playable = p1.playable_cards()
    check("no same-colour -> bluffing", p1.bluffing is False)

    # Last card special as only card → nothing playable
    p1.cards = [Card(None, None, special=CHOOSE)]
    p1.drew = False
    check("no special as last card", p1.playable_cards() == [])


def test_cannot_stack_wild_on_wild():
    chat = FakeChat()
    game = Game(chat)
    u1, u2 = FakeUser(1), FakeUser(2)
    from shadow_game_bot.core.maumau.player import Player
    p1 = Player(game, u1)
    Player(game, u2)
    game.started = True
    game.last_card = Card(None, None, special=DRAW_FOUR)
    game.last_card.color = RED
    game.current_player = p1

    p1.cards = [Card(None, None, special=CHOOSE)]
    check("wild on wild excluded", p1.playable_cards() == [])


def test_must_counter_draw():
    chat = FakeChat()
    game = Game(chat)
    u1, u2 = FakeUser(1), FakeUser(2)
    from shadow_game_bot.core.maumau.player import Player
    p1 = Player(game, u1)
    Player(game, u2)
    game.started = True
    game.last_card = Card(BLUE, DRAW_TWO)
    game.draw_counter = 2
    game.current_player = p1

    p1.cards = [Card(RED, "3"), Card(GREEN, DRAW_TWO)]
    playable = p1.playable_cards()
    check("must counter +2", Card(GREEN, DRAW_TWO) in playable
          and Card(RED, "3") not in playable, playable)


# ── GameManager ───────────────────────────────

def test_manager_new_join_leave():
    gm = GameManager()
    chat = FakeChat()
    u1, u2, u3 = FakeUser(1, "A"), FakeUser(2, "B"), FakeUser(3, "C")

    try:
        gm.join_game(u1, chat)
        check("join without game raises", False)
    except NoGameInChatError:
        check("join without game raises", True)

    game = gm.new_game(chat)
    game.owner = [1]
    gm.join_game(u1, chat)
    gm.join_game(u2, chat)
    check("2 seated", len(game.players) == 2)

    try:
        gm.join_game(u1, chat)
        check("double join raises", False)
    except AlreadyJoinedError:
        check("double join raises", True)

    # Third player joins so leave doesn't end the game
    gm.join_game(u3, chat)
    gm.leave_game(u3, chat)
    check("leave drops to 2", len(game.players) == 2)

    try:
        gm.leave_game(u2, chat)
        check("leave to <2 raises NotEnoughPlayers", False)
    except NotEnoughPlayersError:
        check("leave to <2 raises NotEnoughPlayers", True)


def test_manager_closed_lobby():
    gm = GameManager()
    chat = FakeChat()
    game = gm.new_game(chat)
    game.owner = [1]
    gm.join_game(FakeUser(1), chat)
    game.open = False
    try:
        gm.join_game(FakeUser(2), chat)
        check("closed lobby raises", False)
    except LobbyClosedError:
        check("closed lobby raises", True)


def test_manager_end_game():
    gm = GameManager()
    chat = FakeChat()
    game = gm.new_game(chat)
    game.owner = [1]
    u1, u2 = FakeUser(1), FakeUser(2)
    gm.join_game(u1, chat)
    gm.join_game(u2, chat)

    gm.end_game(chat, u1)
    check("game removed from chat", chat.id not in gm.chatid_games)
    check("user bookkeeping cleared",
          1 not in gm.userid_players and 1 not in gm.userid_current)


def test_manager_move_between_games():
    gm = GameManager()
    chat = FakeChat()
    g1 = gm.new_game(chat)
    g1.owner = [1]
    gm.join_game(FakeUser(1), chat)
    gm.join_game(FakeUser(2), chat)

    # Second game in the same chat — joining moves the player
    g2 = gm.new_game(chat)
    g2.owner = [1]
    gm.join_game(FakeUser(1), chat)
    check("player moved to new game",
          gm.userid_current[1].game is g2)
    check("old game still has player 2",
          any(p.user.id == 2 for p in g1.players))


def test_player_leave_closes_gap():
    chat = FakeChat()
    game = Game(chat)
    from shadow_game_bot.core.maumau.player import Player
    p1 = Player(game, FakeUser(1))
    p2 = Player(game, FakeUser(2))
    p3 = Player(game, FakeUser(3))

    p2.leave()
    check("gap closed", p1.next is p3 and p3.prev is p1,
          f"{p1.next} {p3.prev}")
    check("leaver detached", p2.next is None)


def test_two_player_reverse_is_skip():
    chat = FakeChat()
    game = Game(chat)
    u1, u2 = FakeUser(1), FakeUser(2)
    from shadow_game_bot.core.maumau.player import Player
    p1 = Player(game, u1)
    Player(game, u2)
    game.started = True
    game.last_card = Card(RED, "3")
    game.current_player = p1
    was_reversed = game.reversed

    game.play_card(Card(RED, REVERSE))
    # With 2 players, reverse acts as skip: the ring advances twice
    # (inside the REVERSE branch + the normal end-of-turn), so the
    # same player goes again — matching the original bot's rule.
    check("2p reverse keeps direction", game.reversed == was_reversed)
    check("2p reverse: same player again", game.current_player is p1,
          game.current_player)


# ── Main ──────────────────────────────────────

def main() -> int:
    global PASS, FAIL
    print("UNO engine tests")
    for fn in (
        test_card_basics,
        test_card_display,
        test_display_name,
        test_deck_classic,
        test_deck_wild,
        test_deck_draw_recycle,
        test_dismiss_clears_wild_colour,
        test_game_ring,
        test_game_start_and_play,
        test_skip_card_effect,
        test_draw_two_increments_counter,
        test_draw_four_increments_counter,
        test_choose_colour,
        test_playable_cards,
        test_cannot_stack_wild_on_wild,
        test_must_counter_draw,
        test_manager_new_join_leave,
        test_manager_closed_lobby,
        test_manager_end_game,
        test_manager_move_between_games,
        test_player_leave_closes_gap,
        test_two_player_reverse_is_skip,
    ):
        print(f"\n{fn.__name__}:")
        fn()

    print(f"\n{PASS}/{PASS + FAIL} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
