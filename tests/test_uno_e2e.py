"""End-to-end UNO game test — reproduces the screenshot scenario.

Scenario from user report:
  * 2 players, game started, last card = green 4
  * Current player's hand: b9 b+2 g3 g5 r+2 y4 y7
  * Expected playable: g3, g5 (same colour), y4 (same value)
  * Bug: ALL cards showed "Can't play this now"
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shadow_game_bot.core.maumau import card as c
from shadow_game_bot.core.maumau.card import Card
from shadow_game_bot.core.maumau.game import Game
from shadow_game_bot.core.maumau.player import Player
from shadow_game_bot.core.maumau.game_manager import GameManager


class FakeUser:
    def __init__(self, uid, name):
        self.id = uid
        self.first_name = name
        self.username = name.lower()

    def __repr__(self):
        return f"FakeUser({self.id},{self.first_name})"


class FakeChat:
    def __init__(self, cid, title):
        self.id = cid
        self.title = title
        self.type = "supergroup"


def test_engine_playable():
    """Engine-level: same scenario as the screenshots."""
    chat = FakeChat(-100, "Test")
    game = Game(chat)
    game.owner = [1]

    u1, u2 = FakeUser(1, "Silver"), FakeUser(2, "Xeczt")
    p1 = Player(game, u1)   # first joiner
    p2 = Player(game, u2)   # second joiner

    # Start game (fills deck, plays first card, advances turn)
    game.start()
    for p in (p1, p2):
        p.draw_first_hand()

    # The first card may be a Skip/Reverse which calls turn() twice,
    # so with 2 players the current player wraps back to p1. We don't
    # assume — just take whoever is current and put the screenshot
    # state on them.
    cur = game.current_player
    other = p2 if cur is p1 else p1
    print(f"  current after start: {cur.user!r}, other: {other.user!r}")

    # Force the exact screenshot state: last card green 4, current hand as shown
    game.last_card = Card(c.GREEN, c.FOUR)
    cur.cards = [
        Card(c.BLUE, c.NINE),
        Card(c.BLUE, c.DRAW_TWO),
        Card(c.GREEN, c.THREE),
        Card(c.GREEN, c.FIVE),
        Card(c.RED, c.DRAW_TWO),
        Card(c.YELLOW, c.FOUR),
        Card(c.YELLOW, c.SEVEN),
    ]
    cur.drew = False

    playable = cur.playable_cards()
    labels = sorted(str(x) for x in playable)
    print(f"  Engine playable: {labels}")

    assert "g_3" in labels, f"g_3 (green 3) should be playable vs green 4, got {labels}"
    assert "g_5" in labels, f"g_5 (green 5) should be playable vs green 4, got {labels}"
    assert "y_4" in labels, f"y_4 (yellow 4) should be playable vs green 4, got {labels}"
    assert "b_9" not in labels, f"b_9 should NOT be playable, got {labels}"
    assert "b_draw" not in labels, f"b+2 should NOT be playable, got {labels}"
    assert "r_draw" not in labels, f"r+2 should NOT be playable, got {labels}"
    assert "y_7" not in labels, f"y_7 should NOT be playable, got {labels}"
    print("  PASS: engine playable_cards correct")


def test_card_playable_single():
    """Direct _card_playable checks for the screenshot cards."""
    chat = FakeChat(-100, "Test")
    game = Game(chat)
    game.last_card = Card(c.GREEN, c.FOUR)
    u1 = FakeUser(1, "P")
    p = Player(game, u1)

    cases = [
        (Card(c.GREEN, c.THREE), True,  "g3 vs g4 same colour"),
        (Card(c.GREEN, c.FIVE), True,   "g5 vs g4 same colour"),
        (Card(c.YELLOW, c.FOUR), True,  "y4 vs g4 same value"),
        (Card(c.BLUE, c.NINE), False,   "b9 vs g4 no match"),
        (Card(c.BLUE, c.DRAW_TWO), False, "b+2 vs g4 no match"),
        (Card(c.RED, c.DRAW_TWO), False,  "r+2 vs g4 no match"),
        (Card(c.YELLOW, c.SEVEN), False,  "y7 vs g4 no match"),
        (Card(c.GREEN, c.FOUR), True,   "g4 vs g4 colour+value"),
        (Card(None, None, special=c.CHOOSE), True, "wild chooser always playable"),
        (Card(None, None, special=c.DRAW_FOUR), True, "+4 always playable"),
    ]
    for card, expected, desc in cases:
        got = p._card_playable(card)
        status = "OK" if got == expected else "FAIL"
        print(f"  [{status}] {desc}: expected={expected} got={got}")
        assert got == expected, f"{desc}: expected {expected}, got {got}"
    print("  PASS: _card_playable single checks")


def test_drew_restricts_to_last():
    """After drawing, only the last card is playable."""
    chat = FakeChat(-100, "Test")
    game = Game(chat)
    game.last_card = Card(c.GREEN, c.FOUR)
    u1 = FakeUser(1, "P")
    p = Player(game, u1)
    p.cards = [
        Card(c.GREEN, c.THREE),   # would be playable if drew=False
        Card(c.BLUE, c.NINE),
        Card(c.YELLOW, c.SEVEN),  # last card = not playable
    ]
    p.drew = True

    playable = p.playable_cards()
    assert playable == [], f"after draw with unplayable last card, expected [], got {playable}"

    # But if last card IS playable, only that one shows
    p.cards = [
        Card(c.GREEN, c.THREE),
        Card(c.BLUE, c.NINE),
        Card(c.GREEN, c.FIVE),    # last card = playable
    ]
    playable = p.playable_cards()
    labels = [str(x) for x in playable]
    assert labels == ["g_5"], f"after draw, expected only last playable card, got {labels}"
    print("  PASS: drew flag restricts to last card")


def test_manager_bookkeeping():
    """GameManager keeps userid_current aligned with the game's current player."""
    gm = GameManager()
    chat = FakeChat(-100, "Test")
    game = gm.new_game(chat)
    game.owner = [1]

    u1, u2 = FakeUser(1, "Silver"), FakeUser(2, "Xeczt")
    gm.join_game(u1, chat)
    gm.join_game(u2, chat)

    game.start()
    for p in game.players:
        p.draw_first_hand()

    # Both users have a current player entry
    assert 1 in gm.userid_current, "user 1 missing from userid_current"
    assert 2 in gm.userid_current, "user 2 missing from userid_current"

    p1 = gm.userid_current[1]
    p2 = gm.userid_current[2]
    assert p1.game is game, "p1.game should be the game"
    assert p2.game is game, "p2.game should be the game"

    # The current player of the game must match one of them
    cur = game.current_player
    print(f"  current_player user id = {cur.user.id}")
    print(f"  p1 user id = {u1.id}, p2 user id = {u2.id}")

    # First card may be Skip/Reverse (double turn) so either player can be current
    assert cur in (p1, p2), f"current_player should be p1 or p2, got {cur}"

    # Now the critical check: for the current player, the inline branch condition
    # user_id == game.current_player.user.id must hold
    user_id = cur.user.id
    assert user_id == game.current_player.user.id, \
        "inline current-player branch condition should be True for the current player"
    print("  PASS: manager bookkeeping aligned")


def test_reply_branch_simulation():
    """Simulate the reply_to_query branch logic for the current player."""
    gm = GameManager()
    chat = FakeChat(-100, "Test")
    game = gm.new_game(chat)
    game.owner = [1]

    u1, u2 = FakeUser(1, "Silver"), FakeUser(2, "Xeczt")
    gm.join_game(u1, chat)
    gm.join_game(u2, chat)

    game.start()
    for p in game.players:
        p.draw_first_hand()

    # Force screenshot state on the current player
    game.last_card = Card(c.GREEN, c.FOUR)
    p2 = game.current_player
    p2.cards = [
        Card(c.BLUE, c.NINE),
        Card(c.BLUE, c.DRAW_TWO),
        Card(c.GREEN, c.THREE),
        Card(c.GREEN, c.FIVE),
        Card(c.RED, c.DRAW_TWO),
        Card(c.YELLOW, c.FOUR),
        Card(c.YELLOW, c.SEVEN),
    ]
    p2.drew = False

    # Inline query from p2's user
    user_id = p2.user.id
    lookup_player = gm.userid_current[user_id]
    lookup_game = lookup_player.game

    assert user_id == lookup_game.current_player.user.id, \
        "branch condition failed: user is not recognised as current player"

    playable = lookup_player.playable_cards()
    added_ids = []
    results = []
    for card in sorted(lookup_player.cards):
        can_play = (card in playable and str(card) not in added_ids)
        results.append((str(card), can_play))
        added_ids.append(str(card))

    print(f"  Inline results: {results}")
    playable_labels = [lbl for lbl, cp in results if cp]
    assert "g_3" in playable_labels, f"g_3 should be playable, got {playable_labels}"
    assert "g_5" in playable_labels, f"g_5 should be playable, got {playable_labels}"
    assert "y_4" in playable_labels, f"y_4 should be playable, got {playable_labels}"
    assert len(playable_labels) == 3, f"expected exactly 3 playable, got {playable_labels}"
    print("  PASS: inline branch simulation correct")


def test_full_game_flow():
    """Play a complete mini-game: draw, play, win."""
    gm = GameManager()
    chat = FakeChat(-100, "Test")
    game = gm.new_game(chat)
    game.owner = [1]

    u1, u2 = FakeUser(1, "Alice"), FakeUser(2, "Bob")
    gm.join_game(u1, chat)
    gm.join_game(u2, chat)

    game.start()
    for p in game.players:
        p.draw_first_hand()

    assert game.started
    assert game.last_card is not None
    assert len(game.current_player.cards) == 7

    # Seed a clean, deterministic state.  The random first card can be a
    # draw-stacking special, which leaves game.draw_counter != 0 and made
    # this test flaky (draw() would add draw_counter cards, not 1).
    game.last_card = Card(c.GREEN, c.FOUR)
    game.draw_counter = 0
    game.reversed = False

    # Current player draws
    cur = game.current_player
    n_before = len(cur.cards)
    cur.draw()
    assert len(cur.cards) == n_before + 1, "draw should add one card"
    assert cur.drew is True

    # After draw, turn passes (via pass action simulation)
    game.turn()
    assert game.current_player is not cur, "turn should advance"
    assert game.current_player.drew is False, "new current player drew flag reset"

    # Force a win: give current player one non-special card, play it
    cur2 = game.current_player
    game.last_card = Card(c.GREEN, c.FOUR)
    winning = Card(c.GREEN, c.NINE)
    cur2.cards = [winning]
    cur2.drew = False

    playable = cur2.playable_cards()
    assert winning in playable, "winning card should be playable"

    cur2.play(winning)
    assert len(cur2.cards) == 0, "hand should be empty after winning play"
    assert game.last_card is winning

    print("  PASS: full game flow")


if __name__ == "__main__":
    print("== test_engine_playable ==")
    test_engine_playable()
    print("== test_card_playable_single ==")
    test_card_playable_single()
    print("== test_drew_restricts_to_last ==")
    test_drew_restricts_to_last()
    print("== test_manager_bookkeeping ==")
    test_manager_bookkeeping()
    print("== test_reply_branch_simulation ==")
    test_reply_branch_simulation()
    print("== test_full_game_flow ==")
    test_full_game_flow()
    print("\nALL E2E TESTS PASSED")
