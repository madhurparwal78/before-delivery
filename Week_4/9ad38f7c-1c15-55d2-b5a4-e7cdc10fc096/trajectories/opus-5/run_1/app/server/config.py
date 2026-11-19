"""Runtime configuration, read from the environment at start."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

DEFAULT_PORT = 4173
DEFAULT_SIGN_IN_LOCK_SECONDS = 900

MAX_BODY_BYTES = 16384
WRONG_FLAG_LIMIT = 5
WRONG_FLAG_LOCK_SECONDS = 60
SIGN_IN_FAILURE_LIMIT = 10
TEAM_MEMBER_CAP = 20
SCENARIO_COUNT = 8
WEBINAR_TICKETS = 2
LEADERBOARD_DEFAULT_LIMIT = 5
LEADERBOARD_MAX_LIMIT = 50
FEED_LENGTH = 10

DB_REQUEST_BUDGET_SECONDS = 4.0
DB_CONNECT_TIMEOUT_SECONDS = 3.0
DB_STATEMENT_TIMEOUT_MS = 2500
STREAM_POLL_SECONDS = 0.4
STREAM_COMMENT_SECONDS = 10.0


@dataclass(frozen=True)
class DatabaseSettings:
    user: str
    password: str | None
    host: str
    port: int
    database: str


def _parse_database_url(url: str) -> DatabaseSettings:
    parsed = urlparse(url)
    return DatabaseSettings(
        user=unquote(parsed.username or "postgres"),
        password=unquote(parsed.password) if parsed.password else None,
        host=parsed.hostname or "localhost",
        port=parsed.port or 5432,
        database=unquote(parsed.path.lstrip("/")) or "postgres",
    )


@dataclass(frozen=True)
class Settings:
    database: DatabaseSettings
    port: int
    sign_in_lock_seconds: int


def load_settings() -> Settings:
    url = os.environ.get("DATABASE_URL", "")
    port = int(os.environ.get("APP_PUBLIC_PORT") or DEFAULT_PORT)
    lock_seconds = int(
        os.environ.get("SIGN_IN_LOCK_SECONDS") or DEFAULT_SIGN_IN_LOCK_SECONDS
    )
    return Settings(
        database=_parse_database_url(url),
        port=port,
        sign_in_lock_seconds=lock_seconds,
    )


SETTINGS = load_settings()
