"""Every service address, credential and timer, read from the environment at start."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name) or default)


@dataclass(frozen=True, slots=True)
class Config:
    port: int
    public_url: str
    database_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_path_style: bool
    s3_access_key: str
    s3_secret_key: str
    smtp_host: str
    smtp_port: int
    mail_from: str
    lockout_seconds: int
    step_up_ttl_seconds: int
    session_ttl_seconds: int
    session_idle_seconds: int
    break_glass_seconds: int


def load() -> Config:
    env = os.environ.get
    return Config(
        port=_int("APP_PUBLIC_PORT", 4173),
        public_url=env("APP_PUBLIC_URL", "").rstrip("/"),
        database_url=env("DATABASE_URL", ""),
        s3_endpoint=env("S3_ENDPOINT", "").rstrip("/"),
        s3_region=env("S3_REGION") or "us-east-1",
        s3_bucket=env("S3_BUCKET", ""),
        s3_path_style=env("S3_FORCE_PATH_STYLE", "true").lower() != "false",
        s3_access_key=env("S3_ACCESS_KEY_ID", ""),
        s3_secret_key=env("S3_SECRET_ACCESS_KEY", ""),
        smtp_host=env("SMTP_HOST", ""),
        smtp_port=_int("SMTP_PORT", 25),
        mail_from=env("MAIL_FROM") or "Wardline Custody <custody@ashgrove.example>",
        lockout_seconds=_int("LOCKOUT_SECONDS", 300),
        step_up_ttl_seconds=_int("STEP_UP_TTL_SECONDS", 300),
        session_ttl_seconds=_int("SESSION_TTL_SECONDS", 43_200),
        session_idle_seconds=_int("SESSION_IDLE_SECONDS", 3_600),
        break_glass_seconds=_int("BREAK_GLASS_SECONDS", 3_600),
    )


CONFIG = load()
