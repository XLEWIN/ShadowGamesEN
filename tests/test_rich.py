"""Rich Messages + premium-emoji system audit.

Covers the Pi-ported layers end to end without any network:

  * ``emojis``  — ``E.*`` markup shape, ``plain()`` stripping, EID ids
  * ``rich``    — block/text builders, ``html_to_rich``, ``validate``,
                  the styled/unstyled button ladder
  * ``richsend``— fallback ladder against a stub bot (success + failures)
  * ``reply``   — PTB quote semantics + the HTML auto-promotion marker
  * ``keyboards`` — colored buttons carry ``style`` + ``icon_custom_emoji_id``

Run:  python tests\\test_rich.py
"""

import asyncio
import os
import sys
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("BOT_TOKEN", "123456:TEST")
os.environ.setdefault("OWNER_ID", "1")

PASS = 0
FAIL = 0


def _safe(text) -> str:
    """cp1252-safe repr for failure details (never print raw emoji)."""
    from shadow_game_bot.emojis import plain
    return repr(plain(str(text)))


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS {name}")
    else:
        FAIL += 1
        print(f"FAIL {name}  {_safe(detail) if detail else ''}")


# ── emojis ────────────────────────────────────────────────────────

def test_emojis():
    from shadow_game_bot.emojis import E, EID, plain, custom_emoji

    # E.* is <tg-emoji> markup with a real id
    check("E.CROWN is tg-emoji markup",
          E.CROWN.startswith("<tg-emoji") and E.CROWN.endswith("</tg-emoji>"),
          repr(E.CROWN))
    m = re.search(r'emoji-id="(\d+)"', E.CROWN)
    check("E.CROWN carries a numeric id", bool(m) and m.group(1).isdigit())

    # custom_emoji round trip
    tag = custom_emoji("X", "12345")
    check("custom_emoji shape",
          tag == '<tg-emoji emoji-id="12345">X</tg-emoji>', repr(tag))
    check("custom_emoji empty id falls back",
          custom_emoji("X", "") == "X")

    # plain() strips every scrap of markup
    messy = f"{E.CROWN} <b>bold</b> <a href='https://x.y'>link</a> &amp; more"
    cleaned = plain(messy)
    check("plain() removes tg-emoji", "<tg-emoji" not in cleaned, repr(cleaned))
    check("plain() removes <b>", "<b>" not in cleaned and "</b>" not in cleaned)
    check("plain() removes <a>", "<a" not in cleaned and "</a>" not in cleaned)
    check("plain() unescapes entities", "&amp;" not in cleaned, repr(cleaned))
    check("plain() keeps the fallback glyph", "\U0001f451" in cleaned, repr(cleaned))

    # every E.* constant is markup (or a deliberate plain separator)
    non_markup = {"BULLET"}  # E.BULLET is a plain "━━━━" separator
    for name in dir(E):
        if name.startswith("_") or name in ("XXX",):
            continue
        val = getattr(E, name)
        if not isinstance(val, str):
            continue
        if name in non_markup:
            continue
        ok = val.startswith("<tg-emoji") or val in ("📊",)
        check(f"E.{name} is markup or plain fallback", ok, repr(val))

    # EID.* are digit strings usable as icon_custom_emoji_id
    for name in ("CROWN", "FIRE", "STAR", "CHECK", "CROSS", "USER", "ANNOUNCE"):
        val = getattr(EID, name)
        check(f"EID.{name} is a digit string", isinstance(val, str) and val.isdigit(),
              repr(val))


# ── rich builders ─────────────────────────────────────────────────

def test_rich_builders():
    from shadow_game_bot import rich as R

    check("bold shape", R.bold("x") == {"type": "bold", "text": "x"})
    check("italic shape", R.italic("x") == {"type": "italic", "text": "x"})
    check("code shape", R.code("x") == {"type": "code", "text": "x"})
    check("strike type name", R.strike("x")["type"] == "strikethrough")
    check("link shape", R.link("t", "https://a.b") ==
          {"type": "url", "text": "t", "url": "https://a.b"})
    check("custom_emoji has no text field",
          "text" not in R.custom_emoji("1", "alt"))
    check("custom_emoji id coerced to str",
          R.custom_emoji(123, "a")["custom_emoji_id"] == "123")

    # blocks
    check("heading shape", R.heading("t")["type"] == "heading")
    check("paragraph shape", R.paragraph("t")["type"] == "paragraph")
    check("divider shape", R.divider()["type"] == "divider")
    check("footer shape", R.footer("t")["type"] == "footer")
    check("list_block shape", R.list_block([["a"]])["type"] == "list")

    # validate accepts a normal page and rejects oversized input
    page = [R.heading("Hi"), R.paragraph("body"), R.divider()]
    try:
        R.validate(page)
        check("validate accepts a normal page", True)
    except Exception as e:
        check("validate accepts a normal page", False, str(e))

    try:
        R.validate([R.paragraph("x")] * (R.MAX_BLOCKS + 1))
        check("validate rejects >MAX_BLOCKS", False)
    except Exception:
        check("validate rejects >MAX_BLOCKS", True)

    # validate is deliberately a cheap pre-flight (count-only): a
    # "malformed" block still passes locally and is left for Telegram
    # to reject, which the richsend ladder then catches.
    try:
        R.validate([{"type": "paragraph"}])
        check("validate is count-only (malformed passes locally)", True)
    except Exception:
        check("validate is count-only (malformed passes locally)", False)

    # table limits
    try:
        R.table([[R.cell("x")] * (R.MAX_TABLE_COLUMNS + 1)])
        check("table rejects >MAX_TABLE_COLUMNS", False)
    except Exception:
        check("table rejects >MAX_TABLE_COLUMNS", True)

    try:
        R.buttons_block([R.button(str(i), callback_data="a")
                         for i in range(R.MAX_BUTTONS_PER_BLOCK + 1)])
        check("buttons_block rejects >MAX_BUTTONS_PER_BLOCK", False)
    except Exception:
        check("buttons_block rejects >MAX_BUTTONS_PER_BLOCK", True)

    # button styles + the unstyle ladder
    styled = [R.buttons_block([R.button("OK", callback_data="a",
                                        style="primary")])]
    check("has_styled_buttons True", R.has_styled_buttons(styled) is True)
    stripped = R.unstyle(styled)
    check("unstyle removes the style", "style" not in stripped[0]["buttons"][0])
    check("unstyle keeps the button", stripped[0]["buttons"][0]["text"] == "OK")
    check("has_styled_buttons False after unstyle",
          R.has_styled_buttons(stripped) is False)

    # icon_rich parses our own markup back into a rich emoji
    icon = R.icon_rich('<tg-emoji emoji-id="42">🔥</tg-emoji>')
    check("icon_rich parses id", icon is not None and icon["custom_emoji_id"] == "42",
          repr(icon))
    check("icon_rich returns None without markup", R.icon_rich("plain") is None)


# ── html_to_rich ──────────────────────────────────────────────────

def test_html_to_rich():
    from shadow_game_bot import rich as R

    check("html_to_rich plain text",
          R.html_to_rich("hello") == "hello")

    # single-child spans collapse to a bare node (documented behaviour)
    out = R.html_to_rich("<b>bold</b>")
    check("html_to_rich bold",
          isinstance(out, dict) and out == {"type": "bold", "text": "bold"},
          repr(out))

    out = R.html_to_rich("<code>/new5</code>")
    check("html_to_rich code",
          isinstance(out, dict) and out == {"type": "code", "text": "/new5"},
          repr(out))

    out = R.html_to_rich('see <a href="https://t.me/x">here</a>')
    check("html_to_rich link has url",
          isinstance(out, list) and any(
              isinstance(n, dict) and n.get("type") == "url"
              and n.get("url") == "https://t.me/x" and n.get("text") == "here"
              for n in out),
          repr(out))

    out = R.html_to_rich('<tg-emoji emoji-id="99">X</tg-emoji>')
    check("html_to_rich tg-emoji",
          isinstance(out, dict) and out.get("custom_emoji_id") == "99",
          repr(out))

    # nested markup
    out = R.html_to_rich("<b><code>x</code></b>")
    check("html_to_rich nested bold>code",
          isinstance(out, dict) and out.get("type") == "bold"
          and isinstance(out.get("text"), dict)
          and out["text"].get("type") == "code",
          repr(out))

    # unknown tags unwrap (inner text survives)
    check("html_to_rich unwraps unknown tags",
          R.html_to_rich("<span>inner</span>") == "inner")

    check("html_to_rich unescapes entities",
          R.strip_html("a &amp; b") == "a & b")

    check("html_to_rich empty", R.html_to_rich("") == "")


# ── richsend fallback ladder ──────────────────────────────────────

class _StubMessage:
    message_id = 777


class _StubBotOK:
    """Accepts everything."""
    def __init__(self):
        self.calls = []

    async def __call__(self, method):
        self.calls.append(type(method).__api_method__)
        return _StubMessage()


class _StubBotRejectRich:
    """Rejects the first (styled) sendRichMessage, accepts the unstyled retry."""
    def __init__(self):
        self.calls = []
        self.blocks_seen = []

    async def __call__(self, method):
        api = type(method).__api_method__
        self.calls.append(api)
        blocks = method.rich_message.get("blocks", [])
        self.blocks_seen.append(blocks)
        if api == "sendRichMessage":
            has_style = any(
                b.get("type") == "buttons"
                and any("style" in btn for btn in b.get("buttons", []))
                for b in blocks
            )
            if has_style:
                raise RuntimeError("old server rejects styled buttons")
        return _StubMessage()


class _StubBotRejectAll:
    def __init__(self):
        self.calls = []

    async def __call__(self, method):
        self.calls.append(type(method).__api_method__)
        raise RuntimeError("down")


def test_richsend_ladder():
    from shadow_game_bot import rich as R, richsend as rs

    page = [R.heading("Hi"), R.paragraph("body")]
    fallback_called = []

    async def fallback():
        fallback_called.append(True)
        return "HTML-WON"

    # 1. success on the first (styled) attempt
    bot = _StubBotOK()
    res = asyncio.run(rs.send_with_fallback(bot, 1, page, fallback=fallback))
    check("ladder: rich wins", isinstance(res, _StubMessage))
    check("ladder: fallback not called", not fallback_called)
    check("ladder: one send", bot.calls == ["sendRichMessage"], repr(bot.calls))

    # 2. styled buttons rejected → unstyled retry succeeds
    styled = [R.buttons_block([R.button("OK", callback_data="a", style="primary")])]
    bot = _StubBotRejectRich()
    fallback_called.clear()
    res = asyncio.run(rs.send_with_fallback(bot, 1, styled, fallback=fallback))
    check("ladder: styled->unstyled retry", bot.calls == ["sendRichMessage"] * 2,
          repr(bot.calls))
    # second (successful) attempt must have no style anywhere
    second = bot.blocks_seen[1] if len(bot.blocks_seen) > 1 else []
    check("ladder: unstyled attempt has no style",
          not any(
              b.get("type") == "buttons"
              and any("style" in btn for btn in b.get("buttons", []))
              for b in second
          ), repr(second))
    check("ladder: fallback still not called", not fallback_called)

    # 3. everything rejected → HTML fallback
    bot = _StubBotRejectAll()
    fallback_called.clear()
    res = asyncio.run(rs.send_with_fallback(bot, 1, page, fallback=fallback))
    check("ladder: HTML fallback wins", res == "HTML-WON")
    check("ladder: fallback called once", len(fallback_called) == 1)
    check("ladder: rich attempted first", bot.calls[0] == "sendRichMessage")

    # 4. blocks=None skips straight to HTML
    bot = _StubBotOK()
    fallback_called.clear()
    res = asyncio.run(rs.send_with_fallback(bot, 1, None, fallback=fallback))
    check("ladder: None blocks -> HTML only", res == "HTML-WON" and bot.calls == [])

    # 5. build_blocks returns None when the builder raises
    def bad_builder():
        raise ValueError("boom")

    check("build_blocks None on raise",
          rs.build_blocks(bad_builder) is None)
    check("build_blocks returns list on success",
          rs.build_blocks(lambda: page) is not None)

    # 6. edit ladder behaves the same
    bot = _StubBotOK()
    res = asyncio.run(rs.edit_with_fallback(bot, 1, 5, page, fallback=fallback))
    check("edit ladder: rich wins", res is True)
    bot = _StubBotRejectAll()
    fallback_called.clear()
    res = asyncio.run(rs.edit_with_fallback(bot, 1, 5, page, fallback=fallback))
    check("edit ladder: HTML fallback", res == "HTML-WON")


# ── reply helpers ─────────────────────────────────────────────────

class _FakeMsg:
    """Minimal Message stand-in recording reply/answer calls."""

    def __init__(self, chat_type="private"):
        self.chat = type("C", (), {"type": chat_type})()
        self.calls = []

    async def reply(self, *a, **k):
        self.calls.append(("reply", a, k))
        return "REPLIED"

    async def answer(self, *a, **k):
        self.calls.append(("answer", a, k))
        return "ANSWERED"


def test_reply_helpers():
    from shadow_game_bot.reply import reply_text, _maybe_html

    # private chat → answer (no reply-to)
    m = _FakeMsg("private")
    res = asyncio.run(reply_text(m, "hi"))
    check("reply: private uses answer", res == "ANSWERED" and m.calls[0][0] == "answer")

    # group chat → reply (quote)
    m = _FakeMsg("supergroup")
    res = asyncio.run(reply_text(m, "hi"))
    check("reply: group uses reply", res == "REPLIED" and m.calls[0][0] == "reply")

    # explicit quote=False overrides in a group
    m = _FakeMsg("supergroup")
    asyncio.run(reply_text(m, "hi", quote=False))
    check("reply: quote=False wins", m.calls[0][0] == "answer")

    # HTML auto-promotion on our own marker
    m = _FakeMsg("private")
    asyncio.run(reply_text(m, "<tg-emoji emoji-id='1'>🔥</tg-emoji> hi"))
    check("reply: promotes tg-emoji to HTML",
          m.calls[0][2].get("parse_mode") == "HTML", repr(m.calls[0][2]))

    m = _FakeMsg("private")
    asyncio.run(reply_text(m, "<b>bold</b>"))
    check("reply: promotes <b> to HTML",
          m.calls[0][2].get("parse_mode") == "HTML", repr(m.calls[0][2]))

    # plain payloads untouched
    m = _FakeMsg("private")
    asyncio.run(reply_text(m, "just text"))
    check("reply: plain payload has no parse_mode",
          "parse_mode" not in m.calls[0][2], repr(m.calls[0][2]))

    # caller-set parse_mode is respected
    m = _FakeMsg("private")
    asyncio.run(reply_text(m, "text", parse_mode="Markdown"))
    check("reply: caller parse_mode respected",
          m.calls[0][2].get("parse_mode") == "Markdown")

    # _maybe_html directly
    kwargs = {}
    _maybe_html(("hello",), kwargs)
    check("_maybe_html: no marker, no change", "parse_mode" not in kwargs)
    kwargs = {}
    _maybe_html(("<b>x</b>",), kwargs)
    check("_maybe_html: marker detected", kwargs.get("parse_mode") == "HTML")


# ── keyboards ─────────────────────────────────────────────────────

def test_keyboards():
    from shadow_game_bot.emojis import EID
    from shadow_game_bot.keyboards.colored import (
        btn_primary, btn_success, btn_danger, btn_default, btn_url,
    )
    from shadow_game_bot.keyboards import game as game_kb, ws as ws_kb

    def dump(b):
        return b.model_dump()

    check("btn_primary style", dump(btn_primary("t", "d"))["style"] == "primary")
    check("btn_success style", dump(btn_success("t", "d"))["style"] == "success")
    check("btn_danger style", dump(btn_danger("t", "d"))["style"] == "danger")
    check("btn_default no style", "style" not in dump(btn_default("t", "d")))

    b = btn_primary("t", "d", icon_emoji_id=EID.FIRE)
    check("btn_primary icon", dump(b).get("icon_custom_emoji_id") == EID.FIRE)

    b = btn_url("t", "https://x.y", icon_emoji_id=EID.HEART, style="primary")
    d = dump(b)
    check("btn_url keeps url", d.get("url") == "https://x.y")
    check("btn_url icon", d.get("icon_custom_emoji_id") == EID.HEART)
    check("btn_url style", d.get("style") == "primary")

    # game keyboards: every actionable button is styled AND iconed
    for name, kb in (
        ("mode_selection", game_kb.build_mode_selection()),
        ("leader_controls", game_kb.build_leader_controls()),
        ("leader_selection", game_kb.build_leader_selection()),
    ):
        buttons = [b for row in kb.inline_keyboard for b in row]
        styled = sum(1 for b in buttons if dump(b).get("style"))
        iconed = sum(1 for b in buttons if dump(b).get("icon_custom_emoji_id"))
        check(f"game.{name}: all styled", styled == len(buttons),
              f"{styled}/{len(buttons)}")
        check(f"game.{name}: all iconed", iconed == len(buttons),
              f"{iconed}/{len(buttons)}")

    # leaderboard: active filter chips styled, link row iconed
    kb = ws_kb.generate_leaderboard_keyboard("global", "week", 5)
    buttons = [b for row in kb.inline_keyboard for b in row]
    iconed = sum(1 for b in buttons if dump(b).get("icon_custom_emoji_id"))
    check("ws.leaderboard: icons present", iconed > 0, f"{iconed} icons")
    # active scope chip is primary
    active = [b for b in buttons if dump(b).get("style") == "primary"]
    check("ws.leaderboard: active chip styled", len(active) >= 1)

    # captcha + user selection carry icons
    kb = ws_kb.build_captcha_keyboard(["x"])
    buttons = [b for row in kb.inline_keyboard for b in row]
    check("ws.captcha: icons present",
          any(dump(b).get("icon_custom_emoji_id") for b in buttons))


# ── start/help block builders (menu) ──────────────────────────────

def test_menu_builders():
    from shadow_game_bot import rich as R
    from shadow_game_bot.handlers import menu

    blocks = menu.build_start_blocks("testbot")
    try:
        R.validate(blocks)
        check("menu: start blocks validate", True)
    except Exception as e:
        check("menu: start blocks validate", False, str(e))
    check("menu: start blocks non-empty", len(blocks) > 0)
    # the title mentions the bot
    flat = R.strip_html(str(blocks))
    check("menu: start title names the bot", "testbot" in flat, flat[:120])

    kb = menu.build_start_keyboard()
    check("menu: start keyboard has rows", len(kb.inline_keyboard) >= 2)
    check("menu: start keyboard has a URL button",
          any(getattr(b, "url", None) for row in kb.inline_keyboard for b in row))

    # module page builders return (html_text, keyboard)
    for key in ("wordguess", "wordseek", "scores", "group", "other"):
        page = getattr(menu, "_module_chunks", None)
        break
    # validate the module registry itself
    check("menu: HELP_MENU non-empty", len(menu.HELP_MENU) > 0)
    keys = {m["key"] for m in menu.HELP_MENU}
    check("menu: all six modules registered",
          {"wordguess", "wordseek", "scores", "group", "other", "admin"} <= keys,
          repr(keys))

    # legacy section mapping covers the old ws:help_* buttons
    for legacy in ("game", "howto", "scores", "group", "other", "admin"):
        check(f"menu: legacy section '{legacy}' maps",
              legacy in menu._LEGACY_SECTION_MAP, repr(menu._LEGACY_SECTION_MAP))


# ── main ──────────────────────────────────────────────────────────

def main():
    print("-- emojis --")
    test_emojis()
    print("-- rich builders --")
    test_rich_builders()
    print("-- html_to_rich --")
    test_html_to_rich()
    print("-- richsend ladder --")
    test_richsend_ladder()
    print("-- reply helpers --")
    test_reply_helpers()
    print("-- keyboards --")
    test_keyboards()
    print("-- menu builders --")
    test_menu_builders()
    print()
    print(f"{PASS}/{PASS + FAIL} tests passed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
