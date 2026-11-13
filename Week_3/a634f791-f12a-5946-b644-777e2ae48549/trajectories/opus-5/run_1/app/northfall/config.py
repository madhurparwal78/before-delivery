"""The three settings the app reads at start, and nothing else."""

import os
from urllib.parse import urlsplit

SERVED_PROGRAMME = "northfall"
REPLY_TO = "hello@example.com"
HELSINKI = "Europe/Helsinki"
SESSION_SECONDS = 28800
PREVIEW_DEFAULT_SECONDS = 604800
PREVIEW_MAX_SECONDS = 2592000
MAX_BODY_BYTES = 65536
MAX_FIGURES = 6


class Settings:
    def __init__(self) -> None:
        self.database_url = os.environ["DATABASE_URL"]
        self.port = int(os.environ.get("APP_PUBLIC_PORT") or 4173)
        self.public_url = (os.environ.get("APP_PUBLIC_URL") or "").rstrip("/")

    @property
    def public_origin(self) -> str:
        parts = urlsplit(self.public_url)
        return f"{parts.scheme}://{parts.netloc}" if parts.scheme else ""


settings = Settings()
