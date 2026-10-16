"""Reproduce: play a card via process_result → next-player message must send."""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shadow_game_bot.core.maumau import card as c
from shadow_game_bot.core.maumau.card import Card
from shadow_game_bot.core.maumau.game_manager import GameManager


def _safe(s):
    return s.encode("cp1252", "replace").decode("cp1252")


def _user(uid, name):
    u = MagicMock()
    u.id = uid
    u.first_name = name
    u.username = name.lower()
    return u


def _chat(cid=-100, title="Test"):
    ch = MagicMock()
    ch.id = cid
    ch.title = title
    ch.type = "supergroup"
    return ch


async def _run():
    from shadow_game_bot.context import app

    gm = GameManager()
    app.uno_gm = gm

    # Mock the stats DB (async methods)
    db = MagicMock()
    db.add_cards_played = AsyncMock()
    db.add_game = AsyncMock()
    app.uno_db = db

    # Mock bot sends
    app.bot = MagicMock()
    app.bot.send_message = AsyncMock()

    chat = _chat()
    game = gm.new_game(chat)
    game.owner = [1]

    u1 = _user(1, "Silver")
    u2 = _user(2, "Xeczt")
    gm.join_game(u1, chat)
    gm.join_game(u2, chat)

    game.start()
    for p in game.players:
        p.draw_first_hand()

    cur = game.current_player
    nxt = cur.next

    # Force a known hand: green 3 playable on green 4
    game.last_card = Card(c.GREEN, c.FOUR)
    cur.cards = [Card(c.GREEN, c.THREE), Card(c.RED, c.NINE)]
    cur.drew = False
    cur.anti_cheat = 0

    print("current before:", cur.user.first_name, "next:", nxt.user.first_name)

    chosen = MagicMock()
    chosen.from_user = cur.user
    chosen.result_id = "g_3:0"   # playable + matching anti-cheat

    from shadow_game_bot.handlers.maumau_inline import process_result
    try:
        await process_result(chosen)
    except Exception as e:
        print("process_result RAISED:", type(e).__name__, e)
        raise

    # Asserts
    print("current after:", game.current_player.user.first_name)
    assert game.current_player is nxt, (
        f"turn did not advance: {game.current_player.user.first_name}")
    assert app.bot.send_message.called, "no messages sent at all!"

    calls = app.bot.send_message.call_args_list
    texts = [c.kwargs.get("message_text") or c.args[1] if len(c.args) > 1
             else c.kwargs.get("text", "") for c in calls]
    joined = " | ".join(_safe(str(t)) for t in texts)
    print(f"messages sent ({len(calls)}): {joined}")

    next_msgs = [t for t in texts if "Next player" in str(t)]
    assert next_msgs, f"NEXT PLAYER MESSAGE MISSING. got: {joined}"
    print("PASS: turn advanced and Next player announced")


async def _nonce_survives_view_taps():
    """View-only taps (grey card / game-info) must NOT burn the nonce.

    Repro of the reported bug: player taps a grey card or the game-info
    result, then plays a real card from the same open results list.  The
    real play must still be accepted (nonce unchanged by the view taps).
    """
    from shadow_game_bot.context import app

    gm = GameManager()
    app.uno_gm = gm
    db = MagicMock()
    db.add_cards_played = AsyncMock()
    db.add_game = AsyncMock()
    app.uno_db = db
    app.bot = MagicMock()
    app.bot.send_message = AsyncMock()

    chat = _chat()
    game = gm.new_game(chat)
    game.owner = [1]
    gm.join_game(_user(1, "Silver"), chat)
    gm.join_game(_user(2, "Xeczt"), chat)
    game.start()
    for p in game.players:
        p.draw_first_hand()

    cur = game.current_player
    nxt = cur.next
    game.last_card = Card(c.GREEN, c.FOUR)
    cur.cards = [Card(c.GREEN, c.THREE), Card(c.RED, c.NINE)]
    cur.drew = False
    cur.anti_cheat = 0

    from shadow_game_bot.handlers.maumau_inline import process_result

    # 1) View tap: game-info article result (nonce should stay 0)
    chosen = MagicMock()
    chosen.from_user = cur.user
    chosen.result_id = "hand:0"
    await process_result(chosen)
    assert cur.anti_cheat == 0, (
        f"view tap burned the nonce: {cur.anti_cheat}")

    # 2) View tap: grey-card uuid result (nonce should stay 0)
    chosen.result_id = "01234567-89ab-cdef-0123-456789abcdef:0"
    await process_result(chosen)
    assert cur.anti_cheat == 0, (
        f"grey-card tap burned the nonce: {cur.anti_cheat}")

    # 3) Real play with the ORIGINAL nonce — must be accepted
    chosen.result_id = "g_3:0"
    await process_result(chosen)

    assert game.current_player is nxt, (
        f"real play after view taps was rejected — turn did not advance "
        f"(nonce={cur.anti_cheat})")
    next_msgs = [c for c in app.bot.send_message.call_args_list
                 if "Next player" in str(c)]
    assert next_msgs, "no Next-player message after real play"
    print("PASS: view taps do not burn the anti-cheat nonce")


def test_nonce_survives_view_taps():
    asyncio.run(_nonce_survives_view_taps())


def test_flow():
    asyncio.run(_run())


if __name__ == "__main__":
    print("== test_process_result_turn ==")
    test_flow()
    test_nonce_survives_view_taps()
    print("\nALL PASSED")
