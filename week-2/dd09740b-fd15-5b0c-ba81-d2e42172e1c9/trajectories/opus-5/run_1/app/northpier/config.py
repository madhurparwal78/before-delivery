"""Runtime configuration, read from the environment at start."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class Config:
    database_url: str
    smtp_host: str
    smtp_port: int
    public_url: str
    public_port: int
    flood_window_seconds: int
    idempotency_ttl_seconds: int
    reopen_window_seconds: int
    signin_window_seconds: int

    @property
    def public_origin(self) -> str:
        return self.public_url.rstrip("/")

    def status_url(self, token: str) -> str:
        return f"{self.public_origin}/inquiry/{token}"


def load_config() -> Config:
    return Config(
        database_url=os.environ.get("DATABASE_URL", "").strip(),
        smtp_host=os.environ.get("SMTP_HOST", "").strip() or "mailpit",
        smtp_port=_int_env("SMTP_PORT", 1025),
        public_url=os.environ.get("APP_PUBLIC_URL", "").strip() or "http://127.0.0.1:4173",
        public_port=_int_env("APP_PUBLIC_PORT", 4173),
        flood_window_seconds=_int_env("NP_FLOOD_WINDOW_SECONDS", 3600),
        idempotency_ttl_seconds=_int_env("NP_IDEMPOTENCY_TTL_SECONDS", 86400),
        reopen_window_seconds=_int_env("NP_REOPEN_WINDOW_SECONDS", 2592000),
        signin_window_seconds=_int_env("NP_SIGNIN_WINDOW_SECONDS", 900),
    )


CONFIG = load_config()
