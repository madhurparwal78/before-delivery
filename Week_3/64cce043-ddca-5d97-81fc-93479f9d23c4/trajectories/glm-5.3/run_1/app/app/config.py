"""Configuration read from the environment at start."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

_DSN_RE = re.compile(
    r"^postgres(?:ql)?://(?P<user>[^:]+)(?::(?P<password>[^@]*))?@"
    r"(?P<host>[^:/]+)(?::(?P<port>\d+)?)/(?P<database>.+)$"
)


@dataclass(frozen=True)
class Config:
    database_url: str
    keycloak_url: str
    keycloak_realm: str
    auth_issuer_url: str
    auth_client_id: str
    auth_client_secret: str
    public_port: int
    public_url: str
    grant_hour_seconds: int
    session_idle_seconds: int
    signin_pending_seconds: int


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def load_config() -> Config:
    database_url = os.environ["DATABASE_URL"].strip()
    return Config(
        database_url=database_url,
        keycloak_url=os.environ["KEYCLOAK_URL"].strip().rstrip("/"),
        keycloak_realm=os.environ["KEYCLOAK_REALM"].strip(),
        auth_issuer_url=os.environ["AUTH_ISSUER_URL"].strip().rstrip("/"),
        auth_client_id=os.environ["AUTH_CLIENT_ID"].strip(),
        auth_client_secret=os.environ["AUTH_CLIENT_SECRET"].strip(),
        public_port=_int_env("APP_PUBLIC_PORT", 4173),
        public_url=os.environ.get("APP_PUBLIC_URL", "").strip(),
        grant_hour_seconds=_int_env("GRANT_HOUR_SECONDS", 3600),
        session_idle_seconds=_int_env("SESSION_IDLE_SECONDS", 1800),
        signin_pending_seconds=_int_env("SIGNIN_PENDING_SECONDS", 600),
    )


def dsn_parts(database_url: str) -> tuple[str, int, str, str, str]:
    """Split a postgres DSN into (host, port, user, password, database)."""
    m = _DSN_RE.match(database_url)
    if m is None:
        raise ValueError("DATABASE_URL is not a postgres DSN")
    return (
        m.group("host"),
        int(m.group("port") or 5432),
        m.group("user"),
        m.group("password") or "",
        m.group("database"),
    )
