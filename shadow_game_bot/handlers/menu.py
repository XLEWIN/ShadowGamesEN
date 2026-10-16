"""Pi-style interactive help menu — ONE message edited in place.

Structure follows Pi Bot's /help command pattern:

* ONE message at a time: a plain **text** message carrying the menu and
  inline buttons (no photo/media attached).
* Every callback edits that same message in place — never sending
  follow-ups.
* ``_build_*`` message/keyboard builders + a single ``help_callback``
  router that splits ``help:<action>:<args>`` callback data.
* ``_safe_edit`` mirrors Pi's: brand first, plain (emoji-stripped)
  fallback, "message is not modified" ignored.

Renderers
---------
TWO renderers for the same content:

* **Rich** (default, ``HELP_RICH``) — Bot API 10.1+ Rich Messages via
  ``shadow_game_bot.rich``: H1/H2/H3 headings, a real ``RichBlockTable``
  for the command grid (no NBSP column padding), dividers, footers and
  the module grid as in-message ``RichBlockButtons``.
* **HTML** — kept as the automatic fallback.

Both share ONE paginator (``_module_chunks``), so ``sub`` in the
callback data indexes the same page on either path.

In groups /help replies with the same single text message carrying a
DM-redirect button.

Callback data::

    help:main:<page>                    main menu page
    help:open:<key>:<menu_page>:<sub>   module page (menu_page = caller's
                                        grid page for BACK, sub = sub-page)
    help:close                          delete the menu message
    help:start                          edit the menu message → /start screen
    start:help                          handled in start.py → opens this menu
"""

from __future__ import annotations

import logging
import re
from html import escape, unescape
from typing import List, Optional, Tuple

from aiogram.types import CallbackQuery, Message

from shadow_game_bot import rich as R
from shadow_game_bot.config import config
from shadow_game_bot.context import app
from shadow_game_bot.emojis import E, EID
from shadow_game_bot.keyboards.colored import (
    btn_danger,
    btn_default,
    btn_primary,
    btn_url,
    build_keyboard,
)
from shadow_game_bot.reply import reply_text
from shadow_game_bot.texts import (
    BOT_DESCRIPTION,
    START_HINT_LINE,
    START_TEXT,
    START_TITLE_LINE,
    URL_DISCUSSION,
    URL_UPDATES,
)

logger = logging.getLogger(__name__)

#: Render the menu with Bot API 10.1+ Rich Messages.  Set to False to
#: force the legacy HTML renderer — every page still works either way
#: because a rich failure falls back to HTML automatically.
HELP_RICH = True

_TG_EMOJI_RE = re.compile(r'<tg-emoji emoji-id="\d+">.*?</tg-emoji>')
_EMOJI_ID_RE = re.compile(r'emoji-id="(\d+)"')
_TAG_RE = re.compile(r"<[^>]+>")

#: Page-packing cap — visible characters per page (Telegram allows
#: 4096; pages stay short so each fits one comfortable screen).
CAPTION_LIMIT = 1024
#: Slack kept below the cap to absorb footer/page-indicator variance.
_CAPTION_SLACK = 16

#: 3 rows × 3 module buttons per page — matches the menu design.
PAGE_SIZE = 9
COLS = 3

#: Grid layout: every command line renders as
#: ``<code>command padded</code>Description`` so descriptions start at
#: one x position.  Padding uses non-breaking spaces in the code cell.
_NBSP = "\u00A0"
#: Command column cap — longer commands keep a single gap instead.
GRID_COL_CAP = 30

#: Callback data prefix.
_CB = "help"

# Fallback deep link; at runtime app.bot_username wins.
_FALLBACK_USERNAME = "ShadowGameBot"


# ── Small helpers ────────────────────────────────────────────────

def _strip_custom_emoji(text: str) -> str:
    """Replace <tg-emoji> tags with their inner fallback emoji."""
    return _TG_EMOJI_RE.sub(
        lambda m: m.group(0).split(">", 1)[1].rsplit("</", 1)[0], text
    )


def _visible_len(text: str) -> int:
    """Length Telegram counts against the caption limit."""
    return len(unescape(_TAG_RE.sub("", text)))


def _icon_id(icon_html: str) -> Optional[str]:
    """Custom-emoji id from an E.* tag — for icon_custom_emoji_id buttons."""
    m = _EMOJI_ID_RE.search(icon_html)
    return m.group(1) if m else None


def _int_at(parts: List[str], index: int) -> int:
    return int(parts[index]) if len(parts) > index and parts[index].isdigit() else 0


def _bot_username() -> str:
    return app.bot_username or _FALLBACK_USERNAME


def _is_permitted(user_id: Optional[int], chat_type: Optional[str]) -> bool:
    """Admin module visible only to the bot owner/admins in private."""
    if not user_id or not config.is_admin(user_id):
        return False
    return chat_type == "private"


# ── Help menu data (merged Shadow + WordSeek) ────────────────────
#
# Each entry:
#   key      unique slug (callback data: help:open:<key>:<page>)
#   icon     E.* custom-emoji HTML for the header + button label
#   title    display title (HTML-escaped at render time)
#   sections list of (header | None, [command lines "cmd — Desc"])
#   notes    extra HTML lines shown after the command list
# Grid order defines the button order; PAGE_SIZE = 9 (3 rows × 3).

HELP_MENU: List[dict] = [
    {
        "key": "wordguess",
        "icon": E.GAME,
        "title": "Word Guess",
        "sections": [
            (None, [
                "/game — Start a new game",
                "/stop — Stop the current game",
                "/rules — Know the game rules",
                "/mystats — My game stats (Xeons, words, games)",
                "/ranking — Top 25 players (current chat)",
                "/globalranking — Top 25 global players",
                "/chatranking — Top 10 chats",
                "/score — Scoreboard during a game",
            ]),
        ],
        "notes": [
            "<b>How it works:</b> the leader picks a secret word and describes "
            "it without saying it — everyone else guesses in the chat. The "
            "first correct guess wins <b>1 Xeon</b> (in-game currency only).",
        ],
    },
    {
        "key": "wordseek",
        "icon": E.PLAY,
        "title": "WordSeek",
        "sections": [
            ("Game commands", [
                "/new — Start a new game (default 5 letters)",
                "/new4 — Start a 4-letter game",
                "/new5 — Start a 5-letter game",
                "/new6 — Start a 6-letter game",
                "/new 4 — Start with a specific length (4, 5 or 6)",
                "/end — End current game (voting or admin only)",
                "/help — Show this help menu",
            ]),
            ("Daily mode (private chat)", [
                "/daily — Play Daily WordSeek (6 guesses)",
                "/pausedaily — Pause Daily mode, back to normal games",
            ]),
        ],
        "notes": [
            "<b>How to play:</b> guess the hidden word — after each try you "
            "get color hints: 🟩 correct letter, right spot · 🟨 correct "
            "letter, wrong spot · 🟥 not in the word. First to guess wins; "
            "maximum 30 tries per game.",
            "<b>Daily:</b> one fixed word per day (like NYT Wordle), a new "
            "puzzle every day at 06:00 {tz}, and a streak for solving it "
            "without failing. If a normal game is running, end it before "
            "/daily; use /pausedaily to go back.",
        ],
    },
    {
        "key": "uno",
        "icon": E.GAME,
        "title": "UNO",
        "sections": [
            ("Game flow", [
                "/newuno — Create a new UNO game",
                "/join — Join the running game",
                "/startuno — Deal the first hands",
                "/leave — Leave the game",
                "/skip — Skip the current player (fast mode)",
                "/modes — Explain the game modes",
                "/unostats — Your UNO stats",
                "/unostats reset — Reset your UNO stats",
            ]),
            ("Creator / admin", [
                "/kill — Terminate the game",
                "/kick — Kick a player (reply to them)",
                "/close — Close the lobby",
                "/open — Open the lobby",
                "/notifyme — PM when a new game starts here",
            ]),
        ],
        "notes": [
            "<b>How to play:</b> after /startuno, type the bot username and "
            "a space in the chat (or use the Make your choice button) to see "
            "your cards. Tap a card to play it — greyed cards can't be played "
            "right now. Draw, pass, call a +4 bluff, and pick a colour when "
            "playing a wild.",
            "<b>Modes:</b> Classic (no auto-skip) · Fast (auto-skip slow "
            "players) · Wild (more special cards). The creator picks the "
            "mode before /startuno via the inline results.",
            "Players can join any time before /close. In fast mode a player "
            "who takes too long is skipped and eventually removed.",
        ],
    },
    {
        "key": "scores",
        "icon": E.TROPHY,
        "title": "Scores & Leaderboard",
        "sections": [
            ("Leaderboard", [
                "/leaderboard — Group, today (default 5-letter)",
                "/leaderboard 4 — 4-letter leaderboard (group, today)",
                "/leaderboard global week 6 — Global this week (6-letter)",
                "/leaderboard month — This group's monthly leaderboard",
            ]),
            ("Score", [
                "/score — Your score (group, today, 5-letter)",
                "/score 6 — Your 6-letter stats",
                "/score @username global all 4 — A user's full history",
                "/score 123456789 month — Monthly stats by user id",
            ]),
        ],
        "notes": [
            "<b>Syntax:</b> <code>/leaderboard [scope] [period] [length]</code>"
            " · <code>/score [target] [scope] [period] [length]</code> — all "
            "optional, any order.",
            "<b>Scope:</b> <code>group</code> (default) · <code>global</code>"
            " &nbsp;|&nbsp; <b>Period:</b> <code>today</code> (default) · "
            "<code>week</code> · <code>month</code> · <code>year</code> · "
            "<code>all</code> &nbsp;|&nbsp; <b>Length:</b> <code>4</code> · "
            "<code>5</code> (default) · <code>6</code>",
            "<b>Target:</b> empty = you, <code>@username</code>, or a user id. "
            "When a Word Guess game is active, <code>/score</code> with no "
            "arguments shows that chat's scoreboard instead.",
        ],
    },
    {
        "key": "group",
        "icon": E.SETTINGS,
        "title": "Group Settings",
        "sections": [
            ("Authorized users", [
                "/seekauth @user — Allow ending games without voting",
                "/seekauth remove @user — Remove authorization",
                "/seekauth list — List authorized users",
            ]),
            ("Game topic (forum groups)", [
                "/setgametopic — Restrict games to this topic (run inside it)",
                "/unsetgametopic — Remove topic restriction",
                "/allowonlylen 4 5 — Restrict allowed word lengths here",
                "/recreatetopic on — Auto-recreate the topic when it expires",
            ]),
        ],
        "notes": [
            "You can also use a user ID or reply to a message instead of "
            "@username. <code>/allowonlylen</code> accepts one or more of 4, "
            "5, 6 — the first becomes the default length for /new in that "
            "topic. Without a restriction all lengths are allowed.",
        ],
    },
    {
        "key": "other",
        "icon": E.BOOKMARK,
        "title": "Other Commands",
        "sections": [
            (None, [
                "/rules — Game rules",
                "/mystats — Your Word Guess profile",
                "/ranking — Top 25 players in this chat",
                "/globalranking — Top 25 players globally",
                "/chatranking — Top 10 chats by activity",
                "/id — Message / user info (reply to a message)",
                "/start — Open the main menu",
                "/help — Show this help menu",
            ]),
        ],
        "notes": [
            "<b>/id</b> shows message id/date, user info, chat info, forward "
            "info and file IDs for media.",
        ],
    },
    {
        "key": "admin",
        "icon": E.CROWN,
        "title": "Admin Commands",
        "sections": [
            ("Word Guess (owner)", [
                "/gban [user_id] — Ban a user from the bot (alias /ban)",
                "/ungban [user_id] — Unban a user (alias /unban)",
                "/resetdata — Reset all Word Guess rankings and stats",
            ]),
            ("WordSeek (owner)", [
                "/ban [user_id] — Ban a user from the bot (alias /ungban)",
                "/stats — Users, groups, memory, CPU and VPS load",
                "/transfer <from> <to> — Transfer scores between users",
                "/broadcast — Reply-broadcast to all broadcastable chats",
                "/broadcast_status — Check an ongoing broadcast",
                "/broadcast_cancel — Cancel an ongoing broadcast",
                "/track <chat_id> — Track a chat (cheater detection)",
                "/untrack <chat_id> — Stop tracking a chat",
                "/tracklist — Show all tracked chats",
                "/captcha <chatId> <userId> — Send a verification captcha",
            ]),
        ],
        "notes": [],
    },
]

#: Legacy tabbed-help keys (ws:help_*) → module keys.
_LEGACY_SECTION_MAP = {
    "game": "wordguess",
    "howto": "wordseek",
    "scores": "scores",
    "group": "group",
    "other": "other",
    "admin": "admin",
}


def _timezone_label() -> str:
    tz = config.time_zone or "UTC"
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo(tz))
        offset = now.strftime("%z")
        offset_str = f"GMT{offset[:3]}:{offset[3:]}" if offset else ""
        city = tz.split("/")[-1].replace("_", " ") if "/" in tz else tz
        if city and offset_str:
            return f"{city} time ({offset_str})"
        if city:
            return f"{city} time"
        return tz
    except Exception:
        return tz


def _visible_menu(permitted: bool) -> List[dict]:
    return [m for m in HELP_MENU if permitted or m["key"] != "admin"]


# ── Grid rows (command | description columns) ────────────────────

def _split_row(line: str) -> Tuple[str, str]:
    """``/cmd args — Description`` → ``("/cmd args", "Description")``."""
    left, sep, right = line.partition(" — ")
    if not sep:
        return line, ""
    return left, right


def _cell(text: str, width: int) -> str:
    """Pad *text* with NBSPs so every cell ends at *width* + 1."""
    return text + _NBSP * max(width - _visible_len(text) + 1, 1)


def _grid_row(left: str, right: str, width: int) -> str:
    """One table row: padded command cell + description."""
    row = f"<code>{_cell(left, width)}</code>"
    return row + right if right else row


def _module_width(mod: dict) -> int:
    """Column width for a module — widest command cell, capped."""
    lefts = [
        _split_row(line)[0]
        for _, cmds in mod["sections"]
        for line in cmds
    ]
    return min(max((_visible_len(left) for left in lefts), default=0),
               GRID_COL_CAP)


def _col_header(width: int) -> str:
    """Bold column header row — the table's "Command | Description" line."""
    return f"<code>{_cell('Command', width)}</code><b>Description</b>"


# ── Message builders ─────────────────────────────────────────────

def _page_count(permitted: bool) -> int:
    menu = _visible_menu(permitted)
    return (len(menu) + PAGE_SIZE - 1) // PAGE_SIZE or 1


def _clamp_page(page: int, permitted: bool) -> int:
    return max(0, min(page, _page_count(permitted) - 1))


def _module(key: str) -> Optional[dict]:
    for mod in HELP_MENU:
        if mod["key"] == key:
            return mod
    return None


def _build_main_message(page: int, permitted: bool) -> str:
    """Main menu header text (HTML caption)."""
    menu = _visible_menu(permitted)
    return "\n".join(
        [
            f"{E.INFO} <b>Help Menu</b>",
            f"├ {E.FOLDER} Modules: {len(menu)} · Page {page + 1}/{_page_count(permitted)}",
            f"├ {E.SPARKLE} Three games: Word Guess, WordSeek &amp; UNO",
            f"└ {E.ARROW} Pick a module to browse its commands",
        ]
    )


def _module_header(mod: dict, sub: int, total: int) -> List[str]:
    """Module page header lines (title, count, footer)."""
    first_cmd = (mod["sections"][0][1][0] or "/help").split()[0].lstrip("/")
    count = sum(len(cmds) for _, cmds in mod["sections"])
    footer = (
        f"└ {E.ARROW} Page {sub}/{total} · tap BACK for the menu"
        if total > 1
        else f"└ {E.ARROW} Tap BACK to return to the menu"
    )
    return [
        f"{mod['icon']} <b>{escape(mod['title'])}</b>",
        f"├ {E.FOLDER} Commands: {count}",
        f"├ {E.SPARKLE} e.g. <code>/{first_cmd}</code>",
        footer,
    ]


def _module_chunks(mod: dict) -> List[List[Tuple[Optional[str], List[str], List[str], str]]]:
    """Greedily pack sections (+ notes) so each page fits one caption.

    Each entry is ``(header, rendered_rows, raw_lines, kind)`` where
    ``kind`` is ``"section"`` or ``"notes"``.  The rendered rows drive
    the HTML message, the raw lines drive the Rich Message table — both
    come out of ONE packer so ``sub`` in the callback data means the
    same page on either path.
    """
    width = _module_width(mod)
    worst_header = "\n".join(_module_header(mod, 99, 99))
    if any(cmds for _, cmds in mod["sections"]):
        worst_header += "\n" + _col_header(width)
    budget = CAPTION_LIMIT - _visible_len(worst_header) - _CAPTION_SLACK

    pages: List[List[Tuple[Optional[str], List[str], List[str], str]]] = [[]]
    used = 0

    def push(header: Optional[str], raw: List[str], kind: str) -> None:
        nonlocal used
        body = (
            list(raw)
            if kind == "notes"
            else [_grid_row(*_split_row(line), width) for line in raw]
        )
        size = _visible_len("\n".join(([header] if header else []) + body)) + 1
        if pages[-1] and used + size > budget:
            pages.append([])
            used = 0
        pages[-1].append((header, body, raw, kind))
        used += size

    for header, cmds in mod["sections"]:
        push(header, list(cmds), "section")
    if mod["notes"]:
        push(None, list(mod["notes"]), "notes")
    return pages


def _module_page_count(mod: dict) -> int:
    return len(_module_chunks(mod))


def _build_module_message(mod: dict, sub: int) -> str:
    """Module page caption — grid rows, one content sub-page at a time."""
    pages = _module_chunks(mod)
    total = len(pages)
    sub = max(0, min(sub, total - 1))
    width = _module_width(mod)
    lines = _module_header(mod, sub + 1, total)
    wrote_col_header = False
    for header, body, _raw, _kind in pages[sub]:
        lines.append("")
        if header:
            lines.append(f"<b>{escape(header)}</b>")
        if body and body[0].startswith("<code>") and not wrote_col_header:
            lines.append(_col_header(width))
            wrote_col_header = True
        lines.extend(body)
    return "\n".join(lines)


def _build_start_message(username: str) -> str:
    """The /start screen rendered as this message's new caption."""
    return START_TEXT.format(
        fire=E.FIRE,
        username=f"@{username}",
        description=BOT_DESCRIPTION,
        arrow=E.ARROW,
    )


def _build_group_message() -> str:
    """Group /help stub text."""
    return (
        f"{E.INFO} <b>Help Menu</b>\n"
        f"├ {E.USER} Detail: Browse every command in the bot's DM\n"
        f"└ {E.ARROW} Tap the button below to continue"
    )


# ── Rich Message builders (Bot API 10.1+) ────────────────────────
#
# Rich Messages are NOT HTML: no parse_mode, no <b>/<code>.  Every line
# from HELP_MENU (authored as HTML) goes through R.html_to_rich, which
# unwraps tags, unescapes entities and converts <tg-emoji> into a real
# custom-emoji node.  The command grid becomes a RichBlockTable with a
# real header row — no NBSP padding, the table aligns the columns.

def _rich_title(icon_html: str, title: str, size: int) -> dict:
    """Heading block carrying the module's custom-emoji icon + title."""
    return R.heading(R.html_to_rich(f"{icon_html} {escape(title)}"), size)


def _rich_grid(raw: List[str]) -> dict:
    """``/cmd args — Description`` lines → one RichBlockTable."""
    rows: List[List[dict]] = [
        [R.cell("Command", header=True), R.cell("Description", header=True)]
    ]
    for line in raw:
        left, right = _split_row(line)
        rows.append([
            R.cell(R.code(R.strip_html(left))),
            R.cell(R.html_to_rich(right) if right else " "),
        ])
    return R.table(rows)


def _rich_main_blocks(page: int, permitted: bool) -> List[dict]:
    """Main menu: H1 title, metadata paragraphs, 3-wide module grid, footer."""
    menu = _visible_menu(permitted)
    page = _clamp_page(page, permitted)
    mods = menu[page * PAGE_SIZE : (page + 1) * PAGE_SIZE]
    footer_text = (
        f"Page {page + 1}/{_page_count(permitted)} · tap CLOSE to dismiss"
        if _page_count(permitted) > 1
        else "tap CLOSE to dismiss"
    )
    blocks: List[dict] = [
        _rich_title(E.INFO, "Help Menu", 1),
        R.paragraph(R.html_to_rich(
            f"{E.FOLDER} Modules: {len(menu)} · "
            f"Page {page + 1}/{_page_count(permitted)}"
        )),
        R.paragraph(R.html_to_rich(
            f"{E.SPARKLE} Three games: Word Guess, WordSeek & UNO"
        )),
        R.divider(),
        R.paragraph(R.html_to_rich(f"{E.ARROW} Pick a module to browse its commands")),
        R.heading(R.html_to_rich(f"{E.FOLDER} Modules"), 2),
    ]
    for i in range(0, len(mods), COLS):
        blocks.append(
            R.buttons_block(
                [
                    R.button(
                        mod["title"],
                        callback_data=f"{_CB}:open:{mod['key']}:{page}:0",
                        style="primary",
                        # Same custom-emoji icon the keyboard variant carries
                        # (RichMessageButton has no icon_custom_emoji_id —
                        # the premium emoji rides in the label).
                        icon=mod["icon"],
                    )
                    for mod in mods[i : i + COLS]
                ],
                align="left",
            )
        )
    blocks.append(R.divider())
    blocks.append(R.footer(R.html_to_rich(footer_text)))
    return blocks


def _rich_module_blocks(mod: dict, sub: int) -> List[dict]:
    """Module page: H1 title, metadata, H3 section headings + table grid."""
    pages = _module_chunks(mod)
    total = len(pages)
    sub = max(0, min(sub, total - 1))
    count = sum(len(cmds) for _, cmds in mod["sections"])

    blocks: List[dict] = [
        _rich_title(mod["icon"], mod["title"], 1),
        R.paragraph(R.html_to_rich(f"{E.FOLDER} Commands: {count}")),
        R.divider(),
    ]
    for header, _body, raw, kind in pages[sub]:
        if kind == "notes":
            for note in raw:
                blocks.append(R.paragraph(R.html_to_rich(note)))
            continue
        if header:
            blocks.append(R.heading(R.html_to_rich(escape(header)), 3))
        if raw:
            blocks.append(_rich_grid(raw))

    footer_text = (
        f"Page {sub + 1}/{total} · tap BACK for the menu"
        if total > 1
        else "tap BACK to return to the menu"
    )
    blocks.append(R.divider())
    blocks.append(R.footer(R.html_to_rich(footer_text)))
    return blocks


def _rich_group_blocks(username: str) -> List[dict]:
    """The group stub: one heading, two lines, one deep-link button."""
    return [
        _rich_title(E.INFO, "Help Menu", 1),
        R.paragraph(R.html_to_rich(
            f"{E.USER} Detail: Browse every command in the bot's DM"
        )),
        R.paragraph(R.html_to_rich(f"{E.ARROW} Tap the button below to continue")),
        R.divider(),
        R.buttons_block(
            [R.button("Open in DM", url=f"https://t.me/{username}?start=help",
                      icon=E.USER)],
            align="center",
        ),
    ]


def build_start_blocks(username: str) -> List[dict]:
    """Rich twin of :data:`shadow_game_bot.texts.START_TEXT`.

    The menu itself lives IN the body, exactly like the help module
    grid: the same five entries as :func:`build_start_keyboard`, the
    same row order, the same colours and the owner's custom-emoji icons
    inline in each label.  The rich path therefore attaches NO keyboard
    — the HTML fallback still does.
    """
    from shadow_game_bot.texts import URL_ADD_TO_GROUP, URL_OWNER

    return [
        R.heading(R.html_to_rich(
            START_TITLE_LINE.format(fire=E.FIRE, username=f"@{username}")
        ), 2),
        R.paragraph(R.html_to_rich(BOT_DESCRIPTION)),
        R.paragraph(R.html_to_rich(START_HINT_LINE.format(arrow=E.ARROW))),
        R.divider(),
        R.buttons_block(
            [
                R.button("Add me to a group",
                         url=URL_ADD_TO_GROUP.format(username=username),
                         icon=E.ADD),
                R.button("Help Menu", callback_data="start:help",
                         style="primary", icon=E.INFO),
            ],
            align="center",
        ),
        R.buttons_block(
            [R.button("Owner", url=URL_OWNER, icon=E.CROWN)],
            align="center",
        ),
        R.buttons_block(
            [
                R.button("Official Channel", url=URL_UPDATES, icon=E.ANNOUNCE),
                R.button("Support Chat", url=URL_DISCUSSION, icon=E.INFO),
            ],
            align="center",
        ),
    ]


def build_start_keyboard(icons: bool = True):
    """Start menu keyboard (2-1-2) with colored buttons; icons=False = plain retry."""
    from shadow_game_bot.texts import URL_ADD_TO_GROUP, URL_OWNER

    return build_keyboard(
        [
            [
                btn_url(
                    "Add me to a group",
                    URL_ADD_TO_GROUP.format(username=_bot_username()),
                    icon_emoji_id=EID.ADD if icons else None,
                    style="success",
                ),
                btn_primary("Help Menu", "start:help",
                            icon_emoji_id=EID.INFO if icons else None),
            ],
            [
                btn_url("Owner", URL_OWNER,
                        icon_emoji_id=EID.CROWN if icons else None,
                        style="primary"),
            ],
            [
                btn_url("Official Channel", URL_UPDATES,
                        icon_emoji_id=EID.ANNOUNCE if icons else None),
                btn_url("Support Chat", URL_DISCUSSION,
                        icon_emoji_id=EID.INFO if icons else None),
            ],
        ]
    )


# ── Keyboards (colored, Bot API 9.4+ styling) ────────────────────

def main_menu_keyboard(page: int, permitted: bool, *, icons: bool = True):
    """Module grid (3 per row) + nav row + CLOSE row."""
    menu = _visible_menu(permitted)
    page = _clamp_page(page, permitted)
    chunk = menu[page * PAGE_SIZE : (page + 1) * PAGE_SIZE]
    rows: List[List] = []
    for i in range(0, len(chunk), COLS):
        rows.append(
            [
                btn_primary(
                    mod["title"],
                    f"{_CB}:open:{mod['key']}:{page}:0",
                    icon_emoji_id=_icon_id(mod["icon"]) if icons else None,
                )
                for mod in chunk[i : i + COLS]
            ]
        )

    nav = []
    if page > 0:
        nav.append(btn_default("<", f"{_CB}:main:{page - 1}"))
    if page < _page_count(permitted) - 1:
        nav.append(btn_default(">", f"{_CB}:main:{page + 1}"))
    if nav:
        rows.append(nav)

    rows.append(
        [
            btn_danger("CLOSE", f"{_CB}:close",
                       icon_emoji_id=EID.CROSS if icons else None)
        ]
    )
    return build_keyboard(rows)


def main_menu_nav_keyboard(page: int, permitted: bool, *, icons: bool = True):
    """Nav + CLOSE only — used when the module grid lives in the rich body."""
    page = _clamp_page(page, permitted)
    rows: List[List] = []
    nav = []
    if page > 0:
        nav.append(btn_default("<", f"{_CB}:main:{page - 1}"))
    if page < _page_count(permitted) - 1:
        nav.append(btn_default(">", f"{_CB}:main:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append(
        [
            btn_danger("CLOSE", f"{_CB}:close",
                       icon_emoji_id=EID.CROSS if icons else None)
        ]
    )
    return build_keyboard(rows)


def module_keyboard(key: str, menu_page: int, sub: int, *, icons: bool = True):
    """Content nav (< / >, when the module spans pages) + CLOSE + BACK."""
    mod = _module(key)
    total = _module_page_count(mod) if mod else 1

    rows: List[List] = []
    if total > 1:
        nav = []
        if sub > 0:
            nav.append(btn_default("<", f"{_CB}:open:{key}:{menu_page}:{sub - 1}"))
        if sub < total - 1:
            nav.append(btn_default(">", f"{_CB}:open:{key}:{menu_page}:{sub + 1}"))
        if nav:
            rows.append(nav)

    rows.append(
        [
            btn_danger("CLOSE", f"{_CB}:close",
                       icon_emoji_id=EID.CROSS if icons else None)
        ]
    )
    rows.append([btn_primary("BACK", f"{_CB}:main:{menu_page}")])
    return build_keyboard(rows)


def _dm_keyboard(username: str, *, icons: bool = True):
    """Single deep-link row for the group redirect — opens /help in the DM."""
    return build_keyboard(
        [
            [
                btn_url(
                    "Open in DM",
                    f"https://t.me/{username}?start=help",
                    icon_emoji_id=EID.USER if icons else None,
                )
            ]
        ]
    )


# ── Send / edit helpers (Pi-style, brand first) ──────────────────

def _network_error(e: Exception) -> bool:
    """A transport failure — retrying inside the same handler only doubles
    the wait, so callers bail instead of falling back."""
    return type(e).__name__ in {"TimedOut", "NetworkError"}


def _blocks(fn, *args):
    """Build + validate rich blocks.  ``None`` means "skip the rich attempt"."""
    if not HELP_RICH:
        return None
    try:
        built = fn(*args)
        R.validate(built)
        return built
    except Exception as e:
        logger.debug(
            "help: rich blocks unavailable (%s): %s",
            getattr(fn, "__name__", fn), e)
        return None


async def _send_text(target, text: str, markup, plain_markup) -> bool:
    """Send ONE plain text message with the menu buttons attached.

    Brand first, plain (emoji-stripped) fallback; network issues are
    never retried (a retry would double the user-visible wait).
    """
    last: Optional[Exception] = None
    for body, kb in ((text, markup), (_strip_custom_emoji(text), plain_markup)):
        try:
            await reply_text(
                target, body, parse_mode="HTML", reply_markup=kb,
                link_preview_options=None,
            )
            return True
        except Exception as e:
            if _network_error(e):
                logger.warning("Help reply network issue: %s", e)
                return False
            logger.debug("Help text attempt failed: %s", e)
            last = e
    logger.warning("Failed to send help: %s", last)
    return False


async def _send_rich(bot, target, blocks, rich_markup,
                     html_text, html_markup, html_plain_markup) -> bool:
    """Open the menu as a Rich Message, falling back to the HTML one.

    The two paths carry DIFFERENT keyboards on purpose: on the rich path
    the module grid lives in the message body as ``RichBlockButtons``,
    so the attached keyboard only pages and closes.  Handing the HTML
    fallback that same keyboard would leave it with no way to reach a
    module, hence the separate markup arguments.
    """
    if blocks is not None and bot is not None:
        attempts = [blocks]
        if R.has_styled_buttons(blocks):
            attempts.append(R.unstyle(blocks))
        for i, blk in enumerate(attempts):
            try:
                await R.send_rich(bot, target.chat.id, blk, reply_markup=rich_markup)
                return True
            except Exception as e:
                if _network_error(e):
                    logger.warning("Help rich send network issue: %s", e)
                    return False
                logger.debug(
                    "Help rich send attempt %s/%s failed, %s: %s",
                    i + 1, len(attempts),
                    "using HTML" if i == len(attempts) - 1 else "retrying", e,
                )
    return await _send_text(target, html_text, html_markup, html_plain_markup)


async def _safe_edit(query, text: str, markup, plain_markup) -> None:
    """Edit the menu message in place — text, or caption for legacy photos.

    Brand first, plain (emoji-stripped) fallback; "message is not
    modified" is a no-op.
    """
    msg = query.message
    if msg is None:
        return
    is_photo = bool(getattr(msg, "photo", None))
    last: Optional[Exception] = None
    for body, kb in ((text, markup), (_strip_custom_emoji(text), plain_markup)):
        try:
            if is_photo:
                await msg.edit_caption(
                    caption=body, parse_mode="HTML", reply_markup=kb,
                )
            else:
                await msg.edit_text(
                    body, parse_mode="HTML", reply_markup=kb,
                    disable_web_page_preview=True,
                )
            return
        except Exception as e:
            if _network_error(e):
                logger.warning("Help edit network issue: %s", e)
                return
            if "message is not modified" in str(e):
                return
            last = e
    logger.warning("Help edit failed: %s", last)


async def _safe_edit_rich(bot, query, blocks, rich_markup,
                          html_text, html_markup, html_plain_markup) -> None:
    """Rewrite the menu message in place — rich first, HTML fallback."""
    msg = query.message
    if blocks is not None and bot is not None and msg is not None and not bool(
        getattr(msg, "photo", None)
    ):
        attempts = [blocks]
        if R.has_styled_buttons(blocks):
            attempts.append(R.unstyle(blocks))
        for i, blk in enumerate(attempts):
            try:
                await R.edit_rich(
                    bot, msg.chat.id, msg.message_id, blk, reply_markup=rich_markup
                )
                return
            except Exception as e:
                if "message is not modified" in str(e):
                    return
                if _network_error(e):
                    logger.warning("Help rich edit network issue: %s", e)
                    return
                logger.debug(
                    "Help rich edit attempt %s/%s failed, %s: %s",
                    i + 1, len(attempts),
                    "using HTML" if i == len(attempts) - 1 else "retrying", e,
                )
    await _safe_edit(query, html_text, html_markup, html_plain_markup)


async def _answer(query, text: Optional[str] = None, *, alert: bool = False) -> None:
    try:
        if text:
            from shadow_game_bot.emojis import plain
            await query.answer(plain(text), show_alert=alert)
        else:
            await query.answer()
    except Exception:
        pass


async def _close(query) -> None:
    """Delete the menu message; fall back to stripping its buttons."""
    try:
        await query.message.delete()
    except Exception:
        try:
            await query.message.edit_reply_markup(reply_markup=None)
        except Exception:
            pass


# ── Handlers ─────────────────────────────────────────────────────

async def _send_menu(target, bot=None) -> bool:
    """Open the main menu as the single menu message."""
    permitted = _is_permitted(
        target.from_user.id if target.from_user else None,
        target.chat.type if target.chat else None,
    )
    return await _send_rich(
        bot,
        target,
        _blocks(_rich_main_blocks, 0, permitted),
        main_menu_nav_keyboard(0, permitted),
        _build_main_message(0, permitted),
        main_menu_keyboard(0, permitted),
        main_menu_keyboard(0, permitted, icons=False),
    )


async def help_command(message: Message, bot=None) -> None:
    """/help — DM: menu text message; groups: DM-redirect text message."""
    if message is None:
        return
    bot = bot or app.bot
    chat = message.chat

    if chat is not None and chat.type != "private":
        username = _bot_username()
        await _send_rich(
            bot,
            message,
            _blocks(_rich_group_blocks, username),
            None,  # rich body carries the deep-link button itself
            _build_group_message(),
            _dm_keyboard(username),
            _dm_keyboard(username, icons=False),
        )
        return

    await _send_menu(message, bot)


async def show_main_menu(query: CallbackQuery) -> None:
    """Open the menu (start:help) — swaps out the clicked message."""
    await _answer(query)
    target = query.message
    if target is None:
        return
    if await _send_menu(target, app.bot):
        try:
            await target.delete()
        except Exception:
            pass


async def _edit_to_module(query, key: str, menu_page: int = 0,
                          sub: int = 0) -> None:
    """Edit the current message to a module page (shared by both routers)."""
    mod = _module(key)
    if mod is None:
        await _answer(query, "Unknown option", alert=True)
        return
    user = query.from_user
    chat = query.message.chat if query.message else None
    if key == "admin" and not _is_permitted(
        user.id if user else None, chat.type if chat else None
    ):
        await _answer(query, "You don't have permission to view this.",
                      alert=True)
        return
    permitted = _is_permitted(user.id if user else None,
                              chat.type if chat else None)
    menu_page = _clamp_page(menu_page, permitted)
    total = _module_page_count(mod)
    sub = max(0, min(sub, total - 1))
    await _answer(query)
    await _safe_edit_rich(
        app.bot,
        query,
        _blocks(_rich_module_blocks, mod, sub),
        module_keyboard(key, menu_page, sub),
        _build_module_message(mod, sub),
        module_keyboard(key, menu_page, sub),
        module_keyboard(key, menu_page, sub, icons=False),
    )


async def legacy_edit(query, section: str) -> None:
    """``ws:help_<section>`` → the equivalent module page, edited in place."""
    key = _LEGACY_SECTION_MAP.get(section)
    if key is None:
        await _answer(query)
        return
    await _edit_to_module(query, key, 0, 0)


async def help_callback(query: CallbackQuery) -> None:
    """Route help:* callbacks — pagination, drill-down, close, back."""
    if query is None:
        return
    data = query.data or ""
    if not data.startswith(f"{_CB}:"):
        return
    parts = data.split(":")
    action = parts[1] if len(parts) > 1 else ""
    user = query.from_user
    chat = query.message.chat if query.message else None
    permitted = _is_permitted(user.id if user else None,
                              chat.type if chat else None)

    if action == "close":
        await _answer(query)
        await _close(query)
        return

    if action == "main":
        await _answer(query)
        page = _clamp_page(_int_at(parts, 2), permitted)
        await _safe_edit_rich(
            app.bot,
            query,
            _blocks(_rich_main_blocks, page, permitted),
            main_menu_nav_keyboard(page, permitted),
            _build_main_message(page, permitted),
            main_menu_keyboard(page, permitted),
            main_menu_keyboard(page, permitted, icons=False),
        )
        return

    if action == "open":
        key = parts[2] if len(parts) > 2 else ""
        menu_page = _clamp_page(_int_at(parts, 3), permitted)
        sub = _int_at(parts, 4)
        await _edit_to_module(query, key, menu_page, sub)
        return

    if action == "start":
        # This module owns both builders — swap the menu message for the
        # /start screen.
        username = _bot_username()
        await _answer(query)
        await _safe_edit_rich(
            app.bot,
            query,
            _blocks(build_start_blocks, username),
            None,  # rich body carries the whole menu (no inline keyboard)
            _build_start_message(username),
            build_start_keyboard(),
            build_start_keyboard(icons=False),
        )
        return

    await _answer(query, "Unknown option", alert=True)
