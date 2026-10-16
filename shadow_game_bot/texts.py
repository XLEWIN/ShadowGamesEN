"""Start-screen and brand text constants (Pi START_TEXT structure).

The three pieces of the start screen are named separately so the rich
renderer builds the same three blocks instead of re-writing each
sentence twice.  ``START_TEXT`` is derived from them — the two renderers
can never drift.
"""

from __future__ import annotations

# ── Links (mirrors shadow_game_bot.keyboards.ws) ──────────────────
URL_ADD_TO_GROUP = "https://t.me/{username}?startgroup=true"
URL_OWNER = "https://t.me/Xeczt"
URL_UPDATES = "https://t.me/ShadowBotsHQ"
URL_DISCUSSION = "https://t.me/keczt"

# ── Description (HTML) ────────────────────────────────────────────
BOT_DESCRIPTION = (
    "Three exciting games for your group chats:\n\n"
    "<b>Word Guess</b> — one player explains the secret word, "
    "the others guess it.\n"
    "<b>WordSeek</b> — guess the hidden word in 30 tries with color "
    "hints (like Wordle). Play the <b>Daily WordSeek</b> in private "
    "for streaks!\n"
    "<b>UNO</b> — the classic card game, right in your chat with "
    "inline cards and fast mode.\n\n"
    "Add me to your group and start playing with your friends."
)

# ── The three pieces of the start screen ──────────────────────────
START_TITLE_LINE = "{fire} {username}"
START_HINT_LINE = "{arrow} /help for the full command list."
START_TEXT = (
    START_TITLE_LINE + "\n"
    "{description}\n\n"
    + START_HINT_LINE
)

#: Plain-glyph twin of :data:`START_TEXT` (no <tg-emoji> tags) for
#: fallback sends into chats that reject custom emoji markup.
START_TEXT_PLAIN = (
    "\U0001f525 {username}\n"
    "{description_plain}\n\n"
    "✈️ /help for the full command list."
)

BOT_DESCRIPTION_PLAIN = (
    "Three exciting games for your group chats:\n\n"
    "Word Guess — one player explains the secret word, "
    "the others guess it.\n"
    "WordSeek — guess the hidden word in 30 tries with color "
    "hints (like Wordle). Play the Daily WordSeek in private "
    "for streaks!\n"
    "UNO — the classic card game, right in your chat with "
    "inline cards and fast mode.\n\n"
    "Add me to your group and start playing with your friends."
)
