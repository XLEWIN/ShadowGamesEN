"""Unit tests for merged-bot pure logic.

Run:  python -m tests.test_logic     (from the MergedBot/ directory)
No pytest required — plain asserts.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("BOT_TOKEN", "123456:TEST-TOKEN")
os.environ.setdefault("OWNER_ID", "1")


# ────────────────────────────────────────────────
# Independent JS-semantics reference for mulberry32
# ────────────────────────────────────────────────

def _i32(x: int) -> int:
    """JS ToInt32."""
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x >= 0x80000000 else x


def _u32(x: int) -> int:
    """JS ToUint32."""
    return x & 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """JS Math.imul (signed 32-bit product)."""
    return _i32(_i32(a) * _i32(b))


def js_mulberry32_seq(seed: int, count: int):
    """Reference: literal translation of the original TS mulberry32."""
    t = _u32(seed)
    out = []
    for _ in range(count):
        t = t + 0x6D2B79F5  # JS number += (no wrap until coerced)
        r = _imul(_i32(t) ^ _i32(_u32(t) >> 15), _i32(1 | _i32(t)))
        r = _i32((r + _imul(_i32(r) ^ _i32(_u32(r) >> 7), _i32(61 | _i32(r)))) ^ r)
        out.append(_u32(_i32(r) ^ _i32(_u32(r) >> 14)) / 4294967296.0)
    return out


# ── 1. normalize_word ──────────────────────────

def test_normalize_word():
    from shadow_game_bot.core.normalization import normalize_word, is_correct_guess
    assert normalize_word("  Hello   World  ") == "hello world"
    assert normalize_word("CAFÉ") == normalize_word("café")   # NFKD then casefold
    assert normalize_word("ＡＢ") == "ab"              # fullwidth → NFKD
    assert is_correct_guess(" WORD ", "word")
    assert not is_correct_guess("wordy", "word")
    print("PASS normalize_word")


# ── 2. mulberry32 vs JS reference ──────────────

def test_mulberry32_matches_js_reference():
    from shadow_game_bot.services.daily_word import mulberry32
    for seed in (0, 1, 42, 0xDEADBEEF, 0xFFFFFFFF, 123456789):
        gen = mulberry32(seed)
        py = [gen() for _ in range(100)]
        js = js_mulberry32_seq(seed, 100)
        assert py == js, f"mulberry32 diverged from JS reference for seed={seed}"
        assert all(0.0 <= v < 1.0 for v in py)
    # determinism: two generators with same seed agree
    a = mulberry32(7)
    b = mulberry32(7)
    assert [a() for _ in range(10)] == [b() for _ in range(10)]
    print("PASS mulberry32 (matches JS reference, 6 seeds x 100 draws)")


# ── 3. seed_from_secret is real HMAC ───────────

def test_seed_from_secret_hmac():
    import hashlib
    import hmac
    from shadow_game_bot.services.daily_word import seed_from_secret
    for secret in ("test", "shadow-wordseek-default-secret", "ünïcode"):
        expected = int.from_bytes(
            hmac.new(secret.encode("utf-8"), b"wotd-permutation-seed",
                     hashlib.sha256).digest()[:4], "big")
        assert seed_from_secret(secret) == expected, f"seed mismatch for {secret!r}"
    # different secrets → different seeds
    assert seed_from_secret("a") != seed_from_secret("b")
    print("PASS seed_from_secret (HMAC-SHA256 wiring)")


# ── 4. deterministic_shuffle ───────────────────

def test_deterministic_shuffle():
    from shadow_game_bot.services.daily_word import deterministic_shuffle, _load_daily_words
    original = _load_daily_words()
    s1 = deterministic_shuffle(123)
    s2 = deterministic_shuffle(123)
    s3 = deterministic_shuffle(456)
    assert s1 == s2, "shuffle not deterministic"
    assert s1 != s3, "different seeds produced identical shuffle (suspicious)"
    assert sorted(s1) == sorted(original), "shuffle is not a permutation"
    assert len(s1) == len(original)
    print(f"PASS deterministic_shuffle ({len(s1)} words)")


# ── 5. day_number / word-of-the-day ────────────

def test_day_number_and_wotd():
    from datetime import date, datetime, timezone
    from shadow_game_bot.services.daily_word import day_number, get_word_of_the_day
    from shadow_game_bot.services.daily_word import config

    start = date(2025, 1, 1)
    start_ms = datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    assert day_number(start_ms, start) == 0
    assert day_number(start_ms + 86_400_000, start) == 1
    assert day_number(start_ms + 86_400_000 * 100, start) == 100
    # negative (before start) must not crash; Python floor div handles it
    assert day_number(start_ms - 86_400_000, start) == -1

    word = get_word_of_the_day()
    from shadow_game_bot.services.daily_word import _load_daily_words
    assert word in _load_daily_words(), "word of the day not in list"
    # stable for a fixed timestamp
    fixed_ms = datetime(2026, 6, 15, tzinfo=timezone.utc).timestamp() * 1000
    assert get_word_of_the_day(fixed_ms) == get_word_of_the_day(fixed_ms)
    assert isinstance(config.daily_wordle_secret, str) and config.daily_wordle_secret
    print(f"PASS day_number / word-of-the-day (today: {word})")


# ── 6. game date 6 AM rollover ─────────────────

def test_game_date_rollover():
    from datetime import datetime, timezone
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Asia/Calcutta")
    except Exception:
        print("SKIP game_date_rollover (ZoneInfo unavailable — tzdata missing)")
        return
    from shadow_game_bot.services.daily_word import get_current_game_date_string

    # 05:59 IST on Jan 10 → still Jan 9
    before = datetime(2026, 1, 10, 5, 59, tzinfo=tz)
    assert get_current_game_date_string(before) == "2026-01-09"
    # 06:00 IST on Jan 10 → Jan 10
    after = datetime(2026, 1, 10, 6, 0, tzinfo=tz)
    assert get_current_game_date_string(after) == "2026-01-10"
    # 23:59 IST → same day
    late = datetime(2026, 1, 10, 23, 59, tzinfo=tz)
    assert get_current_game_date_string(late) == "2026-01-10"
    print("PASS game_date_rollover (6 AM IST)")


# ── 7. Wordle feedback (tile states) ───────────

def test_tile_states_and_feedback():
    from shadow_game_bot.handlers.ws_messages import _tile_states, get_feedback, MAX_REGULAR_GUESSES

    def tiles(guess, sol):
        return "".join(
            {"correct": "🟩", "present": "🟨", "absent": "🟥"}[s]
            for s in _tile_states(guess, sol))

    assert tiles("book", "book") == "🟩🟩🟩🟩"
    assert tiles("xxxx", "book") == "🟥🟥🟥🟥"
    # O at pos0 wrong slot (present), K at pos1 wrong slot (present), O exact at pos2
    assert tiles("okon", "book") == "🟨🟨🟩🟥"
    # duplicate handling: BOOKS / KOALA → K present (wrong slot), O exact at pos1
    assert tiles("koala", "books") == "🟨🟩🟥🟥🟥"
    # exact match at pos0 wins; A at pos1 present (wrong slot)
    assert tiles("late", "llama") == "🟩🟨🟥🟥"
    # BEACH vs ABBEY: B present, E present, A present, C/H absent
    assert tiles("beach", "abbey") == "🟨🟨🟨🟥🟥"

    assert MAX_REGULAR_GUESSES == 30
    # score formula: 30 - guesses
    rows = [{"guess": "aaaaa"} for _ in range(7)]
    assert MAX_REGULAR_GUESSES - len(rows) == 23
    out = get_feedback(rows, "bbbbb")
    assert out.splitlines()[0].startswith("🟥")
    print("PASS tile_states / feedback / scoring (30 - N)")


# ── 8. captcha decode_slot ─────────────────────

def test_decode_slot():
    from shadow_game_bot.handlers.ws_admin import decode_slot
    from shadow_game_bot.keyboards.ws import SLOT_SYMBOLS
    assert decode_slot(1) == ["➖", "➖", "➖"]
    assert decode_slot(4) == ["7️⃣", "➖", "➖"]
    # Telegram dice 🎰 values 1..64 → 6 bits → exactly 3 base-4 digits
    for value in range(1, 65):
        slots = decode_slot(value)
        assert len(slots) == 3
        assert all(s in SLOT_SYMBOLS for s in slots)
    # roundtrip uniqueness: all 64 values decode distinctly
    seen = {tuple(decode_slot(v)) for v in range(1, 65)}
    assert len(seen) == 64, "decode_slot is not injective over dice range"
    print("PASS decode_slot (1..64 unique, 3 slots each)")


# ── 9. TTL store ───────────────────────────────

def test_ttl_store():
    import time
    from shadow_game_bot.utils.ttl_store import TTLStore
    s = TTLStore()
    s.set("a", 1, 60)
    assert s.get("a") == 1
    assert s.ttl("a") is not None
    s.set("tmp", "x", 0.05)
    assert s.get("tmp") == "x"
    time.sleep(0.08)
    assert s.get("tmp") is None, "expired key not evicted"
    s.set("permanent", 5)
    time.sleep(0.05)
    assert s.get("permanent") == 5, "key without TTL must not expire"
    s.delete("a")
    assert s.get("a") is None
    assert not s.has("a")
    print("PASS TTLStore (expiry, no-TTL, delete)")


# ── 10. leaderboard input parsing ──────────────

def test_parse_leaderboard_input():
    from shadow_game_bot.utils.parsing import (
        parse_leaderboard_input, parse_leaderboard_filters)

    # returns (search_key, time_key, word_length, target)
    s, t, l, target = parse_leaderboard_input("global week 6", default_time_key=None)
    assert (s, t, l, target) == ("global", "week", 6, None)

    s, t, l, target = parse_leaderboard_input("@user123 month 4", default_time_key=None)
    assert (s, t, l, target) == (None, "month", 4, "@user123")

    s, t, l, target = parse_leaderboard_input("12345", default_time_key=None)
    assert target == "12345" and l == 5

    s, t, l, target = parse_leaderboard_input("", default_time_key=None)
    assert s is None and t is None and l == 5 and target is None

    # filters: (search, time, length) with defaults
    assert parse_leaderboard_filters("") == ("group", "month", 5)
    assert parse_leaderboard_filters("global year 4") == ("global", "year", 4)
    assert parse_leaderboard_filters("nonsense") == ("group", "month", 5)
    print("PASS parse_leaderboard_input / parse_leaderboard_filters")


# ── 11. fancy text ─────────────────────────────

def test_fancy_text():
    from shadow_game_bot.utils.fancy_text import to_fancy_text
    out = to_fancy_text("WORD 123")
    assert len(out) == len("WORD 123")
    assert out != "WORD 123"                      # transformed
    assert to_fancy_text("🟩🟨") == "🟩🟨"         # non-mapped chars untouched
    assert to_fancy_text("abc") == to_fancy_text("abc")  # stable
    print("PASS to_fancy_text")


# ── 12. sanitize_meaning ───────────────────────

def test_sanitize_meaning():
    from shadow_game_bot.services.daily_word import sanitize_meaning
    assert sanitize_meaning("<b>hi</b>") == "<b>hi</b>"
    assert sanitize_meaning("<i>x</i> and <u>y</u>") == "<i>x</i> and <u>y</u>"
    out = sanitize_meaning('<script>alert(1)</script>word')
    assert "<script" not in out and "alert(1)" in out   # tag stripped, text kept
    out2 = sanitize_meaning('<a href="http://evil">link</a>')
    assert "<a" not in out2 and "href" not in out2
    assert "link" in out2
    print("PASS sanitize_meaning (only b/i/u allowed)")


# ── 13. get_topic_id / daily session key ───────

def test_session_helpers():
    from shadow_game_bot.handlers.ws_messages import daily_session_key, get_topic_id
    assert daily_session_key(42) == "daily:42"

    class _Msg:
        message_thread_id = 777
    assert get_topic_id(_Msg()) == "777"

    class _Msg2:
        message_thread_id = None
    assert get_topic_id(_Msg2()) == "general"
    print("PASS session helpers")


ALL = [
    test_normalize_word,
    test_mulberry32_matches_js_reference,
    test_seed_from_secret_hmac,
    test_deterministic_shuffle,
    test_day_number_and_wotd,
    test_game_date_rollover,
    test_tile_states_and_feedback,
    test_decode_slot,
    test_ttl_store,
    test_parse_leaderboard_input,
    test_fancy_text,
    test_sanitize_meaning,
    test_session_helpers,
]


def main() -> int:
    failures = 0
    for fn in ALL:
        try:
            fn()
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {fn.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            import traceback
            print(f"ERROR {fn.__name__}: {exc}")
            traceback.print_exc()
    print(f"\n{len(ALL) - failures}/{len(ALL)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
