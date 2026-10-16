"""Handler-level test: call the real reply_to_query with mocked Telegram objects.

Reproduces the screenshot scenario end-to-end through the actual handler
to verify playable cards appear correctly in the inline results.
"""

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shadow_game_bot.core.maumau import card as c
from shadow_game_bot.core.maumau.card import Card
from shadow_game_bot.core.maumau.game_manager import GameManager


def _safe(s: str) -> str:
    """Replace emoji so cp1252 consoles don't crash."""
    return s.encode("cp1252", "replace").decode("cp1252")


def _make_user(uid, name):
    u = MagicMock()
    u.id = uid
    u.first_name = name
    u.username = name.lower()
    return u


def _make_chat(cid=-100, title="Test"):
    ch = MagicMock()
    ch.id = cid
    ch.title = title
    ch.type = "supergroup"
    return ch


async def _run():
    # Wire the app context so maumau_inline._gm() finds our manager
    from shadow_game_bot.context import app
    gm = GameManager()
    app.uno_gm = gm

    chat = _make_chat()
    game = gm.new_game(chat)
    game.owner = [1]

    u1 = _make_user(1, "Silver")
    u2 = _make_user(2, "Xeczt")
    gm.join_game(u1, chat)
    gm.join_game(u2, chat)

    game.start()
    for p in game.players:
        p.draw_first_hand()

    # Force the exact screenshot state on the CURRENT player
    cur = game.current_player
    print(f"  current player: id={cur.user.id} name={cur.user.first_name}")

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

    # Build a mocked InlineQuery from the current player
    iq = MagicMock()
    iq.from_user = cur.user
    iq.answer = AsyncMock()

    from shadow_game_bot.handlers.maumau_inline import reply_to_query
    await reply_to_query(iq)

    # Inspect what was answered
    assert iq.answer.called, "inline_query.answer was not called"
    kwargs = iq.answer.call_args.kwargs
    results = kwargs.get("results", [])
    print(f"  answered with {len(results)} results")

    # Playable cards are InlineQueryResultCachedSticker with card ids
    # (e.g. "g_3"); options (draw/pass/bluff) are stickers with known
    # result_ids; non-playable cards are GREY stickers with uuid ids and
    # game-info input_message_content (original @unobot parity).
    from shadow_game_bot.core.maumau.stickers import STICKERS, STICKERS_GREY

    playable = []
    grey = []
    has_draw = False
    sticker_count = 0
    option_ids = set()
    grey_has_info = False
    for r in results:
        title = getattr(r, "title", "") or ""
        desc = getattr(r, "description", "") or ""
        rid = getattr(r, "id", "")
        base_id = rid.split(":")[0]
        is_sticker = bool(getattr(r, "sticker_file_id", None))
        if is_sticker:
            sticker_count += 1
            if base_id in ("draw", "pass", "call_bluff"):
                option_ids.add(base_id)
                if base_id == "draw":
                    has_draw = True
            elif len(base_id) == 36:  # uuid → grey (non-playable) sticker
                grey.append(r)
                imc = getattr(r, "input_message_content", None)
                if imc is not None and "Current player" in (imc.message_text or ""):
                    grey_has_info = True
            elif base_id in STICKERS:
                playable.append(base_id)
                # colored pack file_id, never the grey one
                assert r.sticker_file_id == STICKERS[base_id], (
                    f"playable {base_id} not using colored sticker")
            continue
        if "Draw" in title or "draw" in title.lower():
            has_draw = True
        if desc == "Can't play this now":
            # article fallback (only if a grey file_id were missing)
            assert base_id not in STICKERS_GREY, (
                f"{base_id} has a grey sticker but fell back to article")
        elif title.startswith("Play "):
            playable.append(title)

    print(f"  Draw option present: {has_draw}")
    print(f"  Option ids: {option_ids}")
    print(f"  Sticker results: {sticker_count} (playable {len(playable)}, "
          f"grey {len(grey)})")
    print(f"  Playable cards: {_safe(str(playable))}")

    assert has_draw, "Draw option should be present for current player who hasn't drew"
    assert "draw" in option_ids, f"draw option sticker missing, got {option_ids}"
    assert len(playable) == 3, f"expected 3 playable cards, got {len(playable)}: {playable}"
    assert "g_3" in playable, f"green 3 should be playable, got {playable}"
    assert "g_5" in playable, f"green 5 should be playable, got {playable}"
    assert "y_4" in playable, f"yellow 4 should be playable, got {playable}"
    # 7 cards total → 4 non-playable must appear as grey stickers
    assert len(grey) == 4, f"expected 4 grey stickers, got {len(grey)}"
    for r in grey:
        assert r.sticker_file_id in STICKERS_GREY.values(), (
            "grey result does not use a grey pack file_id")
    assert grey_has_info, "grey stickers must carry game-info message content"
    # grey ids must never collide with the colored pack
    grey_ids = {r.sticker_file_id for r in grey}
    colored_ids = set(STICKERS.values())
    assert not (grey_ids & colored_ids), "grey/colored file_id overlap!"
    print("  PASS: reply_to_query shows playable + grey cards correctly")

    # Also verify the NOT-current-player path greys everything
    other = None
    for p in game.players:
        if p is not cur:
            other = p
            break
    assert other is not None, "should find a non-current player"

    iq2 = MagicMock()
    iq2.from_user = other.user
    iq2.answer = AsyncMock()
    await reply_to_query(iq2)
    kwargs2 = iq2.answer.call_args.kwargs
    results2 = kwargs2.get("results", [])
    playable2 = [r for r in results2
                 if getattr(r, "sticker_file_id", None)
                 and getattr(r, "id", "").split(":")[0] in STICKERS]
    grey2 = [r for r in results2 if len(getattr(r, "id", "").split(":")[0]) == 36]
    print(f"  Other player: {len(playable2)} playable, {len(grey2)} grey")
    assert len(playable2) == 0, "non-current player should have no playable cards"
    assert len(grey2) == len(other.cards), (
        f"non-current player should see {len(other.cards)} grey stickers, "
        f"got {len(grey2)}")
    print("  PASS: non-current player sees all cards greyed")


def test_handler():
    asyncio.run(_run())


if __name__ == "__main__":
    print("== test_handler_reply_to_query ==")
    test_handler()
    print("\nHANDLER TEST PASSED")
