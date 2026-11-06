"""Every setting the app reads from the environment, read once at start."""
import os
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit


@dataclass(frozen=True)
class Database:
    user: str
    password: str
    host: str
    port: int
    database: str


@dataclass(frozen=True)
class Settings:
    database: Database
    smtp_host: str
    smtp_port: int
    public_url: str
    port: int
    flood_window: int
    idempotency_ttl: int
    reopen_window: int
    signin_window: int


def _database(url: str) -> Database:
    parts = urlsplit(url)
    return Database(user=unquote(parts.username or ""), password=unquote(parts.password or ""),
                    host=parts.hostname or "", port=parts.port or 5432,
                    database=unquote(parts.path.lstrip("/")))


def _seconds(name: str, default: int) -> int:
    return int(os.environ.get(name) or default)


SETTINGS = Settings(
    database=_database(os.environ.get("DATABASE_URL", "")),
    smtp_host=os.environ.get("SMTP_HOST") or "mailpit",
    smtp_port=int(os.environ.get("SMTP_PORT") or 1025),
    public_url=(os.environ.get("APP_PUBLIC_URL") or "").rstrip("/"),
    port=int(os.environ.get("APP_PUBLIC_PORT") or 4173),
    flood_window=_seconds("NP_FLOOD_WINDOW_SECONDS", 3600),
    idempotency_ttl=_seconds("NP_IDEMPOTENCY_TTL_SECONDS", 86400),
    reopen_window=_seconds("NP_REOPEN_WINDOW_SECONDS", 2592000),
    signin_window=_seconds("NP_SIGNIN_WINDOW_SECONDS", 900),
)
