"""Shared application context (replaces PTB's context.bot_data).

Initialized once in bot startup; imported as `app` by handlers, helpers
and background tasks. Equivalent of the old app.bot_data dictionary:
    app.db, app.ws_db, app.engine, app.dm_actions, app.bot, app.bot_username
"""

from typing import Any, Dict, List, Optional


class AppContext:
    def __init__(self) -> None:
        self.bot: Any = None
        self.bot_username: Optional[str] = None
        self.db: Any = None
        self.ws_db: Any = None
        self.engine: Any = None
        self.dm_actions: Dict[int, Any] = {}
        self.uno_gm: Any = None       # core.maumau.GameManager
        self.uno_db: Any = None       # db.uno.UnoStatsCollection


app = AppContext()
