"""Telegram user mention helpers."""

from shadow_game_bot.utils.escaping import escape_html


def mention_user_html(user_id: int, display_name: str) -> str:
    """Create an HTML mention using tg://user?id= (works for all users)."""
    return f'<a href="tg://user?id={user_id}">{escape_html(display_name)}</a>'


def get_display_name(user) -> str:
    """Get display name from a Telegram User object."""
    parts = [user.first_name, user.last_name]
    name = " ".join(p for p in parts if p)
    if name:
        return name
    if user.username:
        return f"@{user.username}"
    return f"Player {user.id}"
