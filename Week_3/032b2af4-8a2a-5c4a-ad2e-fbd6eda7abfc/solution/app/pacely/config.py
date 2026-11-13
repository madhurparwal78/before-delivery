"""The only reader of environment variables."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    port: int


def load_settings() -> Settings:
    return Settings(database_url=os.environ["DATABASE_URL"], port=int(os.environ.get("APP_PUBLIC_PORT", "4173")))
