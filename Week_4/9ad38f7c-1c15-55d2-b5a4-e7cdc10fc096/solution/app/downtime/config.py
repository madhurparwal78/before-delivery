"""Settings read once at start from the environment the brief names."""

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    port: int
    sign_in_lock_seconds: int


def load() -> Settings:
    return Settings(
        database_url=os.environ["DATABASE_URL"],
        port=int(os.environ.get("APP_PUBLIC_PORT", "4173")),
        sign_in_lock_seconds=int(os.environ.get("SIGN_IN_LOCK_SECONDS", "900")),
    )


SETTINGS = load()
