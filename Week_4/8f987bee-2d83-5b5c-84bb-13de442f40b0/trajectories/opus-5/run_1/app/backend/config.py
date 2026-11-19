"""Environment configuration, read once at start."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    database_url: str
    public_port: int
    public_url: str
    lockout_seconds: int
    invite_ttl_seconds: int
    idempotency_ttl_seconds: int


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def load_settings() -> Settings:
    return Settings(
        database_url=os.environ.get("DATABASE_URL", os.environ.get("DB_URL", "")),
        public_port=_int_env("APP_PUBLIC_PORT", 4173),
        public_url=os.environ.get("APP_PUBLIC_URL", ""),
        lockout_seconds=_int_env("WAYLINE_LOCKOUT_SECONDS", 900),
        invite_ttl_seconds=_int_env("WAYLINE_INVITE_TTL_SECONDS", 604800),
        idempotency_ttl_seconds=_int_env("WAYLINE_IDEMPOTENCY_TTL_SECONDS", 86400),
    )


settings = load_settings()

DIST_DIR = APP_ROOT / "dist"
ASSETS_DIR = APP_ROOT / "assets"
FILM_FILE = ASSETS_DIR / "data-sonification-black-hole-at-the-center-of-the-perse-c38f6693.webm"
