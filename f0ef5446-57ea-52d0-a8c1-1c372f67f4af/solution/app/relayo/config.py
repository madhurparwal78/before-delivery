"""Every setting the app reads, taken from the environment once at start."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _positive(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw.isdigit() and int(raw) > 0 else default


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    keycloak_url: str
    keycloak_realm: str
    auth_issuer_url: str
    auth_client_id: str
    auth_client_secret: str
    smtp_host: str
    smtp_port: int
    mail_from: str
    app_public_port: int
    idempotency_key_ttl_seconds: int
    login_failure_window_seconds: int


def load() -> Settings:
    env = os.environ
    return Settings(
        database_url=env.get("DATABASE_URL", ""),
        keycloak_url=env.get("KEYCLOAK_URL", "").rstrip("/"),
        keycloak_realm=env.get("KEYCLOAK_REALM", ""),
        auth_issuer_url=env.get("AUTH_ISSUER_URL", "").rstrip("/"),
        auth_client_id=env.get("AUTH_CLIENT_ID", ""),
        auth_client_secret=env.get("AUTH_CLIENT_SECRET", ""),
        smtp_host=env.get("SMTP_HOST", ""),
        smtp_port=int(env.get("SMTP_PORT", "0") or 0),
        mail_from=env.get("MAIL_FROM", ""),
        app_public_port=_positive("APP_PUBLIC_PORT", 4173),
        idempotency_key_ttl_seconds=_positive("IDEMPOTENCY_KEY_TTL_SECONDS", 86400),
        login_failure_window_seconds=_positive("LOGIN_FAILURE_WINDOW_SECONDS", 300),
    )


settings = load()
