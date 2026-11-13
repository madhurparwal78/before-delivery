"""The one place environment variables are read."""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


@dataclass(frozen=True, slots=True)
class Config:
    database_url: str
    keycloak_url: str
    keycloak_realm: str
    issuer_url: str
    client_id: str
    client_secret: str
    port: int
    public_url: str | None
    grant_hour_seconds: int
    session_idle_seconds: int
    signin_pending_seconds: int

    @property
    def public_origin(self) -> str | None:
        if not self.public_url:
            return None
        parts = urlsplit(self.public_url)
        return f"{parts.scheme}://{parts.netloc}"


def load() -> Config:
    return Config(
        database_url=os.environ["DATABASE_URL"],
        keycloak_url=os.environ["KEYCLOAK_URL"].rstrip("/"),
        keycloak_realm=os.environ["KEYCLOAK_REALM"],
        issuer_url=os.environ["AUTH_ISSUER_URL"].rstrip("/"),
        client_id=os.environ["AUTH_CLIENT_ID"],
        client_secret=os.environ["AUTH_CLIENT_SECRET"],
        port=_int("APP_PUBLIC_PORT", 4173),
        public_url=os.environ.get("APP_PUBLIC_URL", "").strip().rstrip("/") or None,
        grant_hour_seconds=_int("GRANT_HOUR_SECONDS", 3600),
        session_idle_seconds=_int("SESSION_IDLE_SECONDS", 1800),
        signin_pending_seconds=_int("SIGNIN_PENDING_SECONDS", 600),
    )
