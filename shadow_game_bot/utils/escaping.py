"""HTML escaping for Telegram messages."""


def escape_html(text: str) -> str:
    """Escape text for safe use in Telegram HTML messages."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )
