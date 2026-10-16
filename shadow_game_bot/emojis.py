"""Premium custom-emoji system (ported from Pi Bot — owner's emoji set).

Uses Telegram's custom emoji display inside HTML messages:

    <tg-emoji emoji-id="CUSTOM_EMOJI_ID">fallback</tg-emoji>

Two surfaces:

* ``E.*``  — HTML markup for message bodies (parse_mode="HTML").
* ``EID.*`` — raw ids for ``InlineKeyboardButton(icon_custom_emoji_id=...)``
  and Rich Message button icons.

``plain()`` strips every scrap of markup for payloads that have NO
parse_mode (callback toasts, log lines, console output).

The emoji ids belong to the bot owner — same set Pi Bot ships.
"""

from __future__ import annotations

import html as _html
import random
import re
from typing import Dict, List, Tuple

__all__ = [
    "custom_emoji", "plain", "get_emoji", "get_emoji_text",
    "get_emoji_from_category", "EMOJI_MAP", "CUSTOM_EMOJI_IDS", "E", "EID",
]


# ── Owner's custom emoji ids ──────────────────────────────────────

CUSTOM_EMOJI_IDS: List[str] = [
    "5217890643321300022",  # ✈️
    "5310224206732996002",  # ⭐
    "5258039825805624495",  # ⭐
    "5904248647972820334",  # 💭
    "5904630315946611415",  # 👤
    "5890925363067886150",  # ✨
    "5794164805065514131",  # 1⃣
    "5805506958995758422",  # 📁
    "5805553606635559688",  # 👑
    "6055188418822937956",  # 👍
    "6325687241536440125",  # ✅
    "5042334757040423886",  # ⚡️
    "5039623284056917259",  # 👀
    "5039844895779455925",  # ✔️
    "5040042498634810056",  # ❌
    "5039891861246838069",  # ➕
    "5039644681583985437",  # 🔥
    "5042186567783809934",  # 🌐
    "5040034664614462519",  # ❗
    "5039826874096681939",  # 🔖
    "6097973409851906183",  # 📣
    "6098245027878672529",  # 🔈
    "5084572732444640127",  # ⭕️
    "5084772285215147326",  # ‼️
    "5123163417326126159",  # ✅
    "5121063440311386962",  # 👎
    "4902715076873553054",  # 🩵
    "4904882772637648609",  # ⏰
    "4918438965029110683",  # 🆕
    "5104989658350093220",  # 📍
    "5001534655082529641",  # 🎸
    "5422529445380532104",  # 👋
    "5420405566872788904",  # 💼
]

#: Category → list of (fallback emoji, custom emoji id).  Themed for the
#: merged bot: game/ranking categories plus Pi's authority/status set.
EMOJI_MAP: Dict[str, List[Tuple[str, str]]] = {
    # ── Owner / Authority ───────────────────────────────────
    "crown": [("👑", "5805553606635559688")],
    "admin": [
        ("⚡", "5042334757040423886"),
        ("👑", "5805553606635559688"),
        ("💼", "5420405566872788904"),
    ],

    # ── Success / Confirm ───────────────────────────────────
    "success": [
        ("✅", "6325687241536440125"),
        ("✔️", "5039844895779455925"),
        ("👍", "6055188418822937956"),
    ],
    "check": [
        ("✅", "6325687241536440125"),
        ("✔️", "5039844895779455925"),
    ],

    # ── Error / Deny ────────────────────────────────────────
    "error": [("❌", "5040042498634810056")],
    "cross": [("❌", "5040042498634810056")],
    "disapprove": [("👎", "5121063440311386962")],

    # ── Warning / Alert ─────────────────────────────────────
    "warning": [
        ("❗", "5040034664614462519"),
        ("‼️", "5084772285215147326"),
    ],
    "alert": [
        ("❗", "5040034664614462519"),
        ("‼️", "5084772285215147326"),
        ("📣", "6097973409851906183"),
    ],

    # ── Moderation ──────────────────────────────────────────
    "mute": [("🔈", "6098245027878672529")],
    "ban": [
        ("❌", "5040042498634810056"),
        ("‼️", "5084772285215147326"),
    ],
    "unban": [
        ("✅", "6325687241536440125"),
        ("✔️", "5039844895779455925"),
    ],
    "kick": [("⚡", "5042334757040423886")],
    "warn": [
        ("‼️", "5084772285215147326"),
        ("❗", "5040034664614462519"),
    ],

    # ── Watch / Monitor ─────────────────────────────────────
    "watch": [("👀", "5039623284056917259")],
    "eyes": [("👀", "5039623284056917259")],

    # ── Info / Settings ─────────────────────────────────────
    "info": [
        ("💭", "5904248647972820334"),
        ("🌐", "5042186567783809934"),
    ],
    "settings": [
        ("📁", "5805506958995758422"),
        ("💼", "5420405566872788904"),
    ],
    "folder": [("📁", "5805506958995758422")],

    # ── Time ────────────────────────────────────────────────
    "time": [("⏰", "4904882772637648609")],
    "clock": [("⏰", "4904882772637648609")],

    # ── New / Fresh ─────────────────────────────────────────
    "new": [("🆕", "4918438965029110683")],
    "fresh": [
        ("🆕", "4918438965029110683"),
        ("✨", "5890925363067886150"),
    ],

    # ── Level / Rank / Medals ───────────────────────────────
    "level": [
        ("🔥", "5039644681583985437"),
        ("⭐", "5310224206732996002"),
        ("⭐", "5258039825805624495"),
    ],
    "star": [
        ("⭐", "5310224206732996002"),
        ("⭐", "5258039825805624495"),
    ],
    "fire": [("🔥", "5039644681583985437")],
    "medal_1": [("⭐", "5310224206732996002")],
    "medal_2": [("⭐", "5258039825805624495")],
    "medal_3": [("✨", "5890925363067886150")],

    # ── Games / Play ────────────────────────────────────────
    "game": [
        ("🔥", "5039644681583985437"),
        ("⚡", "5042334757040423886"),
    ],
    "play": [
        ("⚡", "5042334757040423886"),
        ("✨", "5890925363067886150"),
    ],
    "trophy": [
        ("⭐", "5310224206732996002"),
        ("👑", "5805553606635559688"),
    ],

    # ── User / Person ───────────────────────────────────────
    "user": [("👤", "5904630315946611415")],
    "person": [("👤", "5904630315946611415")],

    # ── Welcome / Goodbye ───────────────────────────────────
    "welcome": [
        ("👋", "5422529445380532104"),
        ("✨", "5890925363067886150"),
    ],
    "wave": [("👋", "5422529445380532104")],
    "goodbye": [
        ("✈️", "5217890643321300022"),
        ("👋", "5422529445380532104"),
    ],

    # ── Travel / Forward ────────────────────────────────────
    "travel": [("✈️", "5217890643321300022")],
    "forward": [("✈️", "5217890643321300022")],

    # ── Web / Network ───────────────────────────────────────
    "web": [("🌐", "5042186567783809934")],
    "globe": [("🌐", "5042186567783809934")],

    # ── Bookmark / Save ─────────────────────────────────────
    "bookmark": [("🔖", "5039826874096681939")],
    "save": [("🔖", "5039826874096681939")],

    # ── Location / Pin ──────────────────────────────────────
    "location": [("📍", "5104989658350093220")],
    "pin": [("📍", "5104989658350093220")],

    # ── Music / Fun ─────────────────────────────────────────
    "guitar": [("🎸", "5001534655082529641")],
    "music": [("🎸", "5001534655082529641")],

    # ── Add / Plus ──────────────────────────────────────────
    "add": [("➕", "5039891861246838069")],
    "plus": [("➕", "5039891861246838069")],

    # ── Circle / Priority ───────────────────────────────────
    "circle": [("⭕", "5084572732444640127")],
    "priority": [("⭕", "5084572732444640127")],

    # ── Heart ───────────────────────────────────────────────
    "heart": [("🩵", "4902715076873553054")],

    # ── Number ──────────────────────────────────────────────
    "number_1": [("1⃣", "5794164805065514131")],

    # ── Sparkle ─────────────────────────────────────────────
    "sparkle": [("✨", "5890925363067886150")],

    # ── Announcement ────────────────────────────────────────
    "announce": [("📣", "6097973409851906183")],
    "speaker": [("🔈", "6098245027878672529")],
}


def custom_emoji(emoji_char: str, custom_emoji_id: str) -> str:
    """``<tg-emoji emoji-id="…">fallback</tg-emoji>`` HTML markup."""
    if not custom_emoji_id:
        return emoji_char
    return f'<tg-emoji emoji-id="{custom_emoji_id}">{emoji_char}</tg-emoji>'


# Markup Telegram renders only in an HTML-parsed message.  Everywhere
# else — most importantly answerCallbackQuery, which accepts NO
# parse_mode at all — it would show character for character, so
# ``plain()`` strips it back to the fallback glyph.
_TG_EMOJI_RE = re.compile(r"<tg-emoji[^>]*>(.*?)</tg-emoji>",
                          re.IGNORECASE | re.DOTALL)
_A_LINK_RE = re.compile(r"<a[^>]*>(.*?)</a>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(
    r"</?(?:b|i|u|s|code|pre|strong|em|mark|span|tg-spoiler|blockquote)>",
    re.IGNORECASE,
)


def plain(value: str) -> str:
    """The same text with every scrap of HTML markup removed.

    Use it anywhere the payload has no ``parse_mode``: callback toasts
    (``query.answer``), log lines, file names, console output.  The
    custom emoji degrades to its stock fallback character — the best a
    toast can do; the alternative is leaking the raw tag.
    """
    text = _TG_EMOJI_RE.sub(r"\1", str(value))
    text = _A_LINK_RE.sub(r"\1", text)
    text = _TAG_RE.sub("", text)
    return _html.unescape(text)


def get_emoji_from_category(category: str) -> Tuple[str, str]:
    """Random ``(fallback, custom_id)`` tuple from a category."""
    if category in EMOJI_MAP and EMOJI_MAP[category]:
        return random.choice(EMOJI_MAP[category])
    return ("✨", "5890925363067886150")


def get_emoji(category: str | None = None) -> str:
    """Formatted ``<tg-emoji>`` HTML for a category (random if None)."""
    if category:
        fallback, custom_id = get_emoji_from_category(category)
    else:
        cat = random.choice(list(EMOJI_MAP.keys()))
        fallback, custom_id = get_emoji_from_category(cat)
    return custom_emoji(fallback, custom_id)


def get_emoji_text(category: str | None = None) -> str:
    """Just the fallback emoji character (no markup)."""
    if category:
        fallback, _ = get_emoji_from_category(category)
    else:
        cat = random.choice(list(EMOJI_MAP.keys()))
        fallback, _ = get_emoji_from_category(cat)
    return fallback


# ── Quick access functions ────────────────────────────────────────

def crown() -> str:
    return get_emoji("crown")

def admin() -> str:
    return get_emoji("admin")

def success() -> str:
    return get_emoji("success")

def check() -> str:
    return get_emoji("check")

def error() -> str:
    return get_emoji("error")

def cross() -> str:
    return get_emoji("cross")

def warning() -> str:
    return get_emoji("warning")

def alert() -> str:
    return get_emoji("alert")

def mute() -> str:
    return get_emoji("mute")

def ban() -> str:
    return get_emoji("ban")

def unban() -> str:
    return get_emoji("unban")

def kick() -> str:
    return get_emoji("kick")

def warn() -> str:
    return get_emoji("warn")

def watch() -> str:
    return get_emoji("watch")

def info() -> str:
    return get_emoji("info")

def settings() -> str:
    return get_emoji("settings")

def time_() -> str:
    return get_emoji("time")

def clock() -> str:
    return get_emoji("clock")

def new() -> str:
    return get_emoji("new")

def level() -> str:
    return get_emoji("level")

def star() -> str:
    return get_emoji("star")

def fire() -> str:
    return get_emoji("fire")

def medal_1() -> str:
    return get_emoji("medal_1")

def medal_2() -> str:
    return get_emoji("medal_2")

def medal_3() -> str:
    return get_emoji("medal_3")

def user() -> str:
    return get_emoji("user")

def welcome() -> str:
    return get_emoji("welcome")

def wave() -> str:
    return get_emoji("wave")

def goodbye() -> str:
    return get_emoji("goodbye")

def travel() -> str:
    return get_emoji("travel")

def web() -> str:
    return get_emoji("web")

def bookmark() -> str:
    return get_emoji("bookmark")

def location() -> str:
    return get_emoji("location")

def add() -> str:
    return get_emoji("add")

def circle() -> str:
    return get_emoji("circle")

def heart() -> str:
    return get_emoji("heart")

def sparkle() -> str:
    return get_emoji("sparkle")

def announce() -> str:
    return get_emoji("announce")

def disapprove() -> str:
    return get_emoji("disapprove")

def game() -> str:
    return get_emoji("game")

def trophy() -> str:
    return get_emoji("trophy")


# ── E: HTML markup constants (E.XXX access) ──────────────────────

class E:
    """Emoji constants for message bodies (HTML parse mode).

    Usage::

        f"{E.CROWN} Hello!"
        f"{E.FIRE} Level up!"
    """
    # Core
    CROWN       = crown()
    FIRE        = fire()
    STAR        = star()
    SPARKLE     = sparkle()
    HEART       = heart()
    CHECK       = check()
    CROSS       = cross()
    DISAPPROVE  = disapprove()
    LOCK        = custom_emoji("\U0001f512", "5296369303661067030")

    # Authority
    ADMIN       = admin()
    USER        = user()

    # Status
    SUCCESS     = success()
    WARNING     = warning()
    ALERT       = alert()
    INFO        = info()
    ERROR       = error()

    # Moderation
    MUTE        = mute()
    BAN         = ban()
    UNBAN       = unban()
    KICK        = kick()
    WARN        = warn()

    # Watch
    WATCH       = watch()
    EYES        = watch()

    # Time
    TIME        = time_()
    CLOCK       = clock()

    # New
    NEW         = new()
    FRESH       = new()

    # Level / Rank / Medals
    LEVEL       = level()
    CHART       = "📊"
    MEDAL_1     = medal_1()
    MEDAL_2     = medal_2()
    MEDAL_3     = medal_3()

    # Games
    GAME        = game()
    TROPHY      = trophy()
    PLAY        = get_emoji("play")

    # Welcome / Goodbye
    WELCOME     = welcome()
    WAVE        = wave()
    GOODBYE     = goodbye()

    # Travel
    TRAVEL      = travel()
    FORWARD     = travel()

    # Web
    WEB         = web()
    GLOBE       = web()

    # Bookmark
    BOOKMARK    = bookmark()
    SAVE        = bookmark()

    # Location
    LOCATION    = location()
    PIN         = location()

    # Settings
    SETTINGS    = settings()
    FOLDER      = settings()

    # Action
    ADD         = add()
    PLUS        = add()
    CIRCLE      = circle()

    # Announce
    ANNOUNCE    = announce()
    SPEAKER     = announce()

    # Number
    NUMBER_1    = custom_emoji("1⃣", "5794164805065514131")

    # Music
    GUITAR      = custom_emoji("🎸", "5001534655082529641")

    # Separators
    BULLET      = "━━━━━━━━━━━━━━"
    ARROW       = custom_emoji("✈️", "5217890643321300022")


# ── EID: raw ids for icon_custom_emoji_id / rich buttons ─────────
class EID:
    """Raw custom emoji ids for ``InlineKeyboardButton(icon_custom_emoji_id=)``
    and Rich Message button icons.

    Requirements: bot owner has Telegram Premium, OR the bot bought
    additional usernames on Fragment.
    """
    # Core
    CROWN       = "5805553606635559688"
    FIRE        = "5039644681583985437"
    STAR        = "5310224206732996002"
    SPARKLE     = "5890925363067886150"
    HEART       = "4902715076873553054"
    CHECK       = "6325687241536440125"
    CROSS       = "5040042498634810056"
    DISAPPROVE  = "5121063440311386962"
    LOCK        = "5296369303661067030"

    # Authority
    ADMIN       = "5042334757040423886"
    USER        = "5904630315946611415"

    # Status
    SUCCESS     = "6325687241536440125"
    WARNING     = "5040034664614462519"
    ALERT       = "6097973409851906183"
    INFO        = "5904248647972820334"
    ERROR       = "5040042498634810056"

    # Moderation
    MUTE        = "6098245027878672529"
    BAN         = "5040042498634810056"
    UNBAN       = "6325687241536440125"
    KICK        = "5042334757040423886"
    WARN        = "5084772285215147326"

    # Watch
    WATCH       = "5039623284056917259"
    EYES        = "5039623284056917259"

    # Time
    TIME        = "4904882772637648609"
    CLOCK       = "4904882772637648609"

    # New
    NEW         = "4918438965029110683"
    FRESH       = "4918438965029110683"

    # Level / Rank
    LEVEL       = "5039644681583985437"
    MEDAL_1     = "5310224206732996002"
    MEDAL_2     = "5258039825805624495"
    MEDAL_3     = "5890925363067886150"

    # Games
    GAME        = "5039644681583985437"
    TROPHY      = "5310224206732996002"
    PLAY        = "5042334757040423886"

    # Welcome / Goodbye
    WELCOME     = "5422529445380532104"
    WAVE        = "5422529445380532104"
    GOODBYE     = "5217890643321300022"

    # Travel
    TRAVEL      = "5217890643321300022"
    FORWARD     = "5217890643321300022"

    # Web
    WEB         = "5042186567783809934"
    GLOBE       = "5042186567783809934"

    # Bookmark
    BOOKMARK    = "5039826874096681939"
    SAVE        = "5039826874096681939"

    # Location
    LOCATION    = "5104989658350093220"
    PIN         = "5104989658350093220"

    # Settings
    SETTINGS    = "5805506958995758422"
    FOLDER      = "5805506958995758422"

    # Action
    ADD         = "5039891861246838069"
    PLUS        = "5039891861246838069"
    CIRCLE      = "5084572732444640127"

    # Announce
    ANNOUNCE    = "6097973409851906183"
    SPEAKER     = "6097973409851906183"

    # Number
    NUMBER_1    = "5794164805065514131"

    # Music
    GUITAR      = "5001534655082529641"
