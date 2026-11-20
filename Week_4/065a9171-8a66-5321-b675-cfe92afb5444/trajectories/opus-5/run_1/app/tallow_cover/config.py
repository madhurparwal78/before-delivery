"""Runtime configuration, read from the environment at start."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


@dataclass(frozen=True)
class Config:
    database_url: str
    smtp_host: str
    smtp_port: int
    mail_from: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key_id: str
    s3_secret_access_key: str
    port: int
    escalation_after_seconds: int
    session_ttl_seconds: int
    idempotency_ttl_seconds: int

    @property
    def db_params(self) -> dict:
        parsed = urlparse(self.database_url)
        return {
            "user": parsed.username,
            "password": parsed.password,
            "host": parsed.hostname or "localhost",
            "port": parsed.port or 5432,
            "database": (parsed.path or "/").lstrip("/"),
        }


def load_config() -> Config:
    return Config(
        database_url=os.environ.get("DATABASE_URL", ""),
        smtp_host=os.environ.get("SMTP_HOST", ""),
        smtp_port=_int("SMTP_PORT", 1025),
        mail_from=os.environ.get("MAIL_FROM", "Tallow Cover <cover@tallow.example>"),
        s3_endpoint=os.environ.get("S3_ENDPOINT", ""),
        s3_region=os.environ.get("S3_REGION", "us-east-1"),
        s3_bucket=os.environ.get("S3_BUCKET", ""),
        s3_force_path_style=os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() == "true",
        s3_access_key_id=os.environ.get("S3_ACCESS_KEY_ID", ""),
        s3_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY", ""),
        port=_int("APP_PUBLIC_PORT", 4173),
        escalation_after_seconds=_int("ESCALATION_AFTER_SECONDS", 172800),
        session_ttl_seconds=_int("SESSION_TTL_SECONDS", 43200),
        idempotency_ttl_seconds=_int("IDEMPOTENCY_TTL_SECONDS", 86400),
    )


CONFIG = load_config()
