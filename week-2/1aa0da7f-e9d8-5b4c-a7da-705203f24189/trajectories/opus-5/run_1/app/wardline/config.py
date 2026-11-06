"""Environment-read configuration. No credential is ever hard-coded here."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    database_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key_id: str
    s3_secret_access_key: str
    smtp_host: str
    smtp_port: int
    mail_from: str
    public_port: int
    public_url: str
    lockout_seconds: int
    step_up_ttl_seconds: int
    session_ttl_seconds: int
    session_idle_seconds: int
    break_glass_seconds: int


def load_config() -> Config:
    return Config(
        database_url=os.environ.get("DATABASE_URL", ""),
        s3_endpoint=os.environ.get("S3_ENDPOINT", ""),
        s3_region=os.environ.get("S3_REGION", "us-east-1"),
        s3_bucket=os.environ.get("S3_BUCKET", ""),
        s3_force_path_style=os.environ.get("S3_FORCE_PATH_STYLE", "true").lower()
        in ("1", "true", "yes"),
        s3_access_key_id=os.environ.get("S3_ACCESS_KEY_ID", ""),
        s3_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY", ""),
        smtp_host=os.environ.get("SMTP_HOST", ""),
        smtp_port=_int("SMTP_PORT", 1025),
        mail_from=os.environ.get("MAIL_FROM")
        or "Wardline Custody <custody@ashgrove.example>",
        public_port=_int("APP_PUBLIC_PORT", 4173),
        public_url=os.environ.get("APP_PUBLIC_URL", ""),
        lockout_seconds=_int("LOCKOUT_SECONDS", 300),
        step_up_ttl_seconds=_int("STEP_UP_TTL_SECONDS", 300),
        session_ttl_seconds=_int("SESSION_TTL_SECONDS", 43200),
        session_idle_seconds=_int("SESSION_IDLE_SECONDS", 3600),
        break_glass_seconds=_int("BREAK_GLASS_SECONDS", 3600),
    )


CONFIG = load_config()
