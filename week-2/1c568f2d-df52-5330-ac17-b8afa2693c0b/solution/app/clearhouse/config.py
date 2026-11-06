"""Every setting the app reads, taken from the environment once at start."""

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    issuer_url: str
    client_id: str
    client_secret: str
    public_port: int
    public_url: str
    lockout_seconds: int


def load() -> Settings:
    env = os.environ
    return Settings(
        database_url=env["DATABASE_URL"],
        issuer_url=(env.get("AUTH_ISSUER_URL")
                    or f"{env.get('KEYCLOAK_URL', '').rstrip('/')}/realms/{env.get('KEYCLOAK_REALM', '')}").rstrip("/"),
        client_id=env.get("AUTH_CLIENT_ID", ""),
        client_secret=env.get("AUTH_CLIENT_SECRET", ""),
        public_port=int(env.get("APP_PUBLIC_PORT", "4173")),
        public_url=env.get("APP_PUBLIC_URL", f"http://localhost:{env.get('APP_PUBLIC_PORT', '4173')}").rstrip("/"),
        lockout_seconds=int(env.get("LOGIN_LOCKOUT_SECONDS", "900")),
    )


settings = load()
