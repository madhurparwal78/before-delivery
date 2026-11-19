"""Configuration read from the environment at start."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    return int(raw)


@dataclass(frozen=True)
class Config:
    public_url: str
    public_origin: str
    public_port: int
    port: int
    database_url: str
    smtp_host: str
    smtp_port: int
    mail_from: str
    login_lockout_seconds: int
    email_token_ttl_seconds: int
    message_nonce_ttl_seconds: int
    idempotency_key_ttl_seconds: int
    support_window_seconds: int


def load_config() -> Config:
    public_url = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173").rstrip("/")
    parts = urlsplit(public_url)
    public_origin = f"{parts.scheme}://{parts.netloc}"
    return Config(
        public_url=public_url,
        public_origin=public_origin,
        public_port=_int_env("APP_PUBLIC_PORT", 4173),
        port=_int_env("PORT", 4173),
        database_url=os.environ["DATABASE_URL"],
        smtp_host=os.environ.get("SMTP_HOST", "localhost"),
        smtp_port=_int_env("SMTP_PORT", 1025),
        mail_from=os.environ.get("MAIL_FROM", "Community Hub <no-reply@example.com>"),
        login_lockout_seconds=_int_env("LOGIN_LOCKOUT_SECONDS", 900),
        email_token_ttl_seconds=_int_env("EMAIL_TOKEN_TTL_SECONDS", 86400),
        message_nonce_ttl_seconds=_int_env("MESSAGE_NONCE_TTL_SECONDS", 600),
        idempotency_key_ttl_seconds=_int_env("IDEMPOTENCY_KEY_TTL_SECONDS", 86400),
        support_window_seconds=_int_env("SUPPORT_WINDOW_SECONDS", 3600),
    )


CONFIG = load_config()
