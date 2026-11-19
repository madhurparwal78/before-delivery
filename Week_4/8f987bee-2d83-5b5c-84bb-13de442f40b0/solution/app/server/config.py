"""Every setting the server reads from its environment, read once at start."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    public_port: int
    public_url: str
    lockout_seconds: int
    invite_ttl_seconds: int
    idempotency_ttl_seconds: int


def _seconds(name: str, default: int) -> int:
    return int(os.environ.get(name, str(default)))


settings = Settings(
    database_url=os.environ.get("DATABASE_URL", ""),
    public_port=int(os.environ.get("APP_PUBLIC_PORT", "4173")),
    public_url=os.environ.get("APP_PUBLIC_URL", ""),
    lockout_seconds=_seconds("WAYLINE_LOCKOUT_SECONDS", 900),
    invite_ttl_seconds=_seconds("WAYLINE_INVITE_TTL_SECONDS", 604800),
    idempotency_ttl_seconds=_seconds("WAYLINE_IDEMPOTENCY_TTL_SECONDS", 86400),
)
