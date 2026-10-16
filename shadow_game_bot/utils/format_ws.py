"""HTML entity escaping + message formatting helpers (WordSeek).

Sisters of shadow's utils/escaping.py (which escapes fewer entities).
"""

from typing import Dict, List, Optional


def escape_html_entities(text: str) -> str:
    entity_map = {
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&#39;",
        "/": "&#x2F;",
    }
    return "".join(entity_map.get(ch, ch) for ch in text)


def capitalize_first_letter(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


# ── Word details (daily/regular reveal) ────────

def render_word_details(word: str, meaning: Optional[str], phonetic: Optional[str],
                        sentence: Optional[str], escape: bool = True) -> str:
    parts: List[str] = []
    parts.append(f"<strong>Correct Word: {escape_html_entities(word)}</strong>")
    if phonetic:
        parts.append(
            f"<strong>{escape_html_entities(capitalize_first_letter(word))}</strong> "
            f"<code>{escape_html_entities(phonetic)}</code>"
        )
    if meaning:
        esc = escape_html_entities if escape else (lambda x: x)
        parts.append(f"<strong>Meaning</strong>: {esc(meaning)}")
    if sentence:
        parts.append(f"<strong>Example</strong>: {escape_html_entities(sentence)}")
    return "<blockquote>" + "\n".join(parts) + "</blockquote>"


def format_daily_word_details(word: str, meaning: Optional[str],
                              phonetic: Optional[str], sentence: Optional[str]) -> str:
    return render_word_details(word, meaning, phonetic, sentence, escape=False)


# ── Leaderboard ────────────────────────────────

def format_leaderboard_message(data: List[Dict], search_key: str) -> str:
    blocks: List[List[str]] = []
    for index, entry in enumerate(data):
        rank = ["🥇", "🥈", "🥉"][index] if index < 3 else "🔅"
        name = escape_html_entities(entry.get("name") or "Unknown")
        username = entry.get("username")
        username_link = (
            f'<a href="t.me/{username}">{name}</a>' if username else name
        )
        line = f"{rank}{username_link} - {int(entry.get('total_score') or 0):,} pts"
        if index == 0 or index == 3 or (index > 3 and (index - 3) % 10 == 0):
            blocks.append([])
        blocks[-1].append(line)

    formatted = "\n".join(
        "<blockquote>" + "\n".join(block) + "</blockquote>" for block in blocks
    )
    scope = "Global" if search_key == "global" else "Group"
    return f"<blockquote>🏆 {scope} Leaderboard 🏆</blockquote>\n\n{formatted}"


# ── User score ─────────────────────────────────

def format_user_score_message(data: Dict, search_key: str) -> str:
    name = escape_html_entities(data.get("name") or "Unknown")
    username = data.get("username")
    mention = f'<a href="https://t.me/{username}">{name}</a>' if username else name
    scope = "globally" if search_key == "global" else "in this chat"
    total = f"{int(data.get('total_score') or 0):,}"
    rank = f"{int(data.get('rank') or 0):,}"
    current = str(data.get("current_streak") or 0)
    highest = str(data.get("highest_streak") or 0)
    return (
        "<blockquote><strong>🏆 Regular WordSeek Scores</strong></blockquote>\n"
        f"<b>{mention}</b> has a total score of <b>{total}</b> {scope}.\n"
        f"Their rank is <b>#{rank}</b>.\n\n"
        "<blockquote><strong>🔥 Daily WordSeek Stats</strong></blockquote>\n"
        f"<b>Current Streak:</b> {current} days\n"
        f"<b>Highest Streak:</b> {highest} days"
    )


# ── No scores ──────────────────────────────────

def format_no_scores_message(
    is_own_score: bool,
    user_name: Optional[str],
    search_key: str,
    time_key: str,
    was_time_key_explicit: bool,
    has_any_scores: bool,
) -> str:
    subject = "You" if is_own_score else (user_name or "This user")
    verb_have = "haven't" if is_own_score else "hasn't"
    verb = "have" if is_own_score else "has"
    scope = "globally" if search_key == "global" else "in this chat"

    time_text = {
        "today": "today",
        "week": "this week",
        "month": "this month",
        "year": "this year",
        "all": "yet",
    }

    if not has_any_scores:
        if search_key == "group":
            return (
                f'{subject} {verb} no scores recorded in this chat. Try switching to "Global" '
                f'to see {"your" if is_own_score else "their"} overall scores.'
            )
        tail = " Start playing to earn some points! 🎮" if is_own_score else ""
        return f"{subject} {verb} no scores recorded yet.{tail}"

    if was_time_key_explicit:
        if time_key == "all":
            return f"{subject} {verb} no scores recorded {scope}."
        return (
            f"{subject} {verb_have} played {time_text.get(time_key, time_key)} {scope}. "
            f'Try selecting a different time period to see {"your" if is_own_score else "their"} scores.'
        )

    return (
        f'{subject} {verb} no scores recorded {scope}. Try switching to "Global" '
        "or selecting a different time period."
    )


# ── Duration ───────────────────────────────────

def format_duration(duration_ms: float) -> str:
    seconds = int((duration_ms / 1000) % 60)
    minutes = int((duration_ms / (1000 * 60)) % 60)
    hours = int((duration_ms / (1000 * 60 * 60)) % 24)
    days = int(duration_ms / (1000 * 60 * 60 * 24))
    if days > 0:
        return f"{days} day{'s' if days > 1 else ''}"
    if hours > 0:
        return f"{hours} hour{'s' if hours > 1 else ''}"
    if minutes > 0:
        return f"{minutes} minute{'s' if minutes > 1 else ''}"
    return f"{seconds} second{'s' if seconds > 1 else ''}"
