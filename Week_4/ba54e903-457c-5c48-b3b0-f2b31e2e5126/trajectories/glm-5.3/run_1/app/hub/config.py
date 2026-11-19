"""Configuration read from the environment at start."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    app_public_url: str
    app_public_port: int
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

    @property
    def public_origin(self) -> str:
        return self.app_public_url.rstrip("/")


def _normalize_public_url(raw: str, port: int) -> str:
    raw = (raw or "").strip().rstrip("/")
    if not raw:
        raw = f"http://127.0.0.1:{port}"
    return raw


def load_config() -> Config:
    port = _int_env("PORT", 4173)
    public_port = _int_env("APP_PUBLIC_PORT", 4173)
    return Config(
        app_public_url=_normalize_public_url(os.environ.get("APP_PUBLIC_URL"), public_port),
        app_public_port=public_port,
        port=port,
        database_url=os.environ.get("DATABASE_URL", "postgresql://localhost:5432/hub"),
        smtp_host=os.environ.get("SMTP_HOST", "localhost"),
        smtp_port=_int_env("SMTP_PORT", 1025),
        mail_from=os.environ.get("MAIL_FROM", "Community Hub <no-reply@example.com>"),
        login_lockout_seconds=_int_env("LOGIN_LOCKOUT_SECONDS", 900),
        email_token_ttl_seconds=_int_env("EMAIL_TOKEN_TTL_SECONDS", 86400),
        message_nonce_ttl_seconds=_int_env("MESSAGE_NONCE_TTL_SECONDS", 600),
        idempotency_key_ttl_seconds=_int_env("IDEMPOTENCY_KEY_TTL_SECONDS", 86400),
        support_window_seconds=_int_env("SUPPORT_WINDOW_SECONDS", 3600),
    )
