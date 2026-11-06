"""Configuration read from the environment at start (DP-98)."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    database_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key: str
    s3_secret_key: str
    smtp_host: str
    smtp_port: int
    mail_from: str
    app_public_port: int
    app_public_url: str
    lockout_seconds: int
    step_up_ttl: int
    session_ttl: int
    session_idle: int
    break_glass_seconds: int

    @classmethod
    def from_env(cls) -> "Config":
        _int = lambda key, default: int(os.environ.get(key) or default)  # noqa: E731
        return cls(
            database_url=os.environ["DATABASE_URL"],
            s3_endpoint=os.environ["S3_ENDPOINT"],
            s3_region=os.environ.get("S3_REGION", "us-east-1"),
            s3_bucket=os.environ["S3_BUCKET"],
            s3_force_path_style=os.environ.get("S3_FORCE_PATH_STYLE", "").lower() == "true",
            s3_access_key=os.environ["S3_ACCESS_KEY_ID"],
            s3_secret_key=os.environ["S3_SECRET_ACCESS_KEY"],
            smtp_host=os.environ.get("SMTP_HOST", "localhost"),
            smtp_port=_int("SMTP_PORT", 1025),
            mail_from=os.environ.get("MAIL_FROM") or "Wardline Custody <custody@ashgrove.example>",
            app_public_port=_int("APP_PUBLIC_PORT", 4173),
            app_public_url=os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173"),
            lockout_seconds=_int("LOCKOUT_SECONDS", 300),
            step_up_ttl=_int("STEP_UP_TTL_SECONDS", 300),
            session_ttl=_int("SESSION_TTL_SECONDS", 43200),
            session_idle=_int("SESSION_IDLE_SECONDS", 3600),
            break_glass_seconds=_int("BREAK_GLASS_SECONDS", 3600),
        )


def syslog(message: str) -> None:
    print(message, file=sys.stderr, flush=True)
