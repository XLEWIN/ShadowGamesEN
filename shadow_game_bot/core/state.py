"""Game state models for DM workflows."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


class RoundStatus(str, Enum):
    WAITING_FOR_LEADER = "WAITING_FOR_LEADER"
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"


class GameMode(str, Enum):
    NORMAL = "normal"
    FICTION = "fiction"


class DMActionType(str, Enum):
    WRITE_WORD = "write_word"


@dataclass
class PendingDMAction:
    user_id: int
    game_chat_id: int
    action: DMActionType
    game_id: Optional[int] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
