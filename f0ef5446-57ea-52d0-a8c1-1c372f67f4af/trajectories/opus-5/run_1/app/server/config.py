"""Configuration read from the environment at start."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    value = int(raw)
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive whole number of seconds")
    return value


@dataclass(frozen=True)
class Config:
    database_url: str
    keycloak_url: str
    keycloak_realm: str
    auth_issuer_url: str
    auth_client_id: str
    auth_client_secret: str
    smtp_host: str
    smtp_port: int
    mail_from: str
    public_port: int
    idempotency_key_ttl_seconds: int
    login_failure_window_seconds: int


def load_config() -> Config:
    return Config(
        database_url=_require("DATABASE_URL"),
        keycloak_url=_require("KEYCLOAK_URL").rstrip("/"),
        keycloak_realm=_require("KEYCLOAK_REALM"),
        auth_issuer_url=_require("AUTH_ISSUER_URL").rstrip("/"),
        auth_client_id=_require("AUTH_CLIENT_ID"),
        auth_client_secret=_require("AUTH_CLIENT_SECRET"),
        smtp_host=_require("SMTP_HOST"),
        smtp_port=int(_require("SMTP_PORT")),
        mail_from=_require("MAIL_FROM"),
        public_port=_positive_int("APP_PUBLIC_PORT", 4173),
        idempotency_key_ttl_seconds=_positive_int("IDEMPOTENCY_KEY_TTL_SECONDS", 86_400),
        login_failure_window_seconds=_positive_int("LOGIN_FAILURE_WINDOW_SECONDS", 300),
    )


CONFIG: Config = load_config()
