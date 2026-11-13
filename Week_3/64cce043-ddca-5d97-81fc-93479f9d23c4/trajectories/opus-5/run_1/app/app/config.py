"""Settings read from the environment at start."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Final

EVENT_CHANNEL: Final = "strongroom_events"
APPLICATION_NAME: Final = "strongroom"
SESSION_COOKIE: Final = "strongroom_session"
SIGNIN_COOKIE: Final = "strongroom_signin"
MAX_BODY_BYTES: Final = 65_536
RULE_LIMIT: Final = 50
KEEPALIVE_SECONDS: Final = 15
IDENTITY_PROBE_SECONDS: Final = 10
SEED_ACCOUNT_SECONDS: Final = 30
REALM_LOGOUT_RETRY_SECONDS: Final = 30
POOL_SIZE: Final = 10


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    keycloak_url: str
    keycloak_realm: str
    issuer_url: str
    client_id: str
    client_secret: str
    public_port: int
    public_url: str | None
    grant_hour_seconds: int
    session_idle_seconds: int
    signin_pending_seconds: int

    @property
    def realm_base(self) -> str:
        return f"{self.keycloak_url.rstrip('/')}/realms/{self.keycloak_realm}"

    @property
    def admin_base(self) -> str:
        return f"{self.keycloak_url.rstrip('/')}/admin/realms/{self.keycloak_realm}"

    @property
    def authorization_endpoint(self) -> str:
        return f"{self.realm_base}/protocol/openid-connect/auth"

    @property
    def token_endpoint(self) -> str:
        return f"{self.realm_base}/protocol/openid-connect/token"

    @property
    def openid_configuration(self) -> str:
        return f"{self.realm_base}/.well-known/openid-configuration"


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


def load_settings() -> Settings:
    return Settings(
        database_url=os.environ["DATABASE_URL"],
        keycloak_url=os.environ["KEYCLOAK_URL"],
        keycloak_realm=os.environ["KEYCLOAK_REALM"],
        issuer_url=os.environ["AUTH_ISSUER_URL"],
        client_id=os.environ["AUTH_CLIENT_ID"],
        client_secret=os.environ["AUTH_CLIENT_SECRET"],
        public_port=_int_env("APP_PUBLIC_PORT", 4173),
        public_url=os.environ.get("APP_PUBLIC_URL") or None,
        grant_hour_seconds=_int_env("GRANT_HOUR_SECONDS", 3600),
        session_idle_seconds=_int_env("SESSION_IDLE_SECONDS", 1800),
        signin_pending_seconds=_int_env("SIGNIN_PENDING_SECONDS", 600),
    )
