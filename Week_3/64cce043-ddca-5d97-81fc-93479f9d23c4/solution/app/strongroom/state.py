"""The process-wide services every route reaches through `request.app.state.strongroom`."""
from __future__ import annotations

from dataclasses import dataclass, field

import asyncpg

from .config import Config
from .realm import Realm


@dataclass(slots=True)
class State:
    config: Config
    realm: Realm
    pool: asyncpg.Pool | None = field(default=None)
