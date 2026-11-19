"""The one place environment variables are read."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class Settings:
    port: int
    database_url: str
    wiremock_url: str
    gotenberg_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key_id: str
    s3_secret_access_key: str
    clock_start: datetime
    review_seconds: int


def parse_instant(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def load_settings() -> Settings:
    env = os.environ
    return Settings(
        port=int(env.get("APP_PUBLIC_PORT", "4173")),
        database_url=env.get("DATABASE_URL", ""),
        wiremock_url=env.get("WIREMOCK_URL", "").rstrip("/"),
        gotenberg_url=env.get("GOTENBERG_URL", "").rstrip("/"),
        s3_endpoint=env.get("S3_ENDPOINT", "").rstrip("/"),
        s3_region=env.get("S3_REGION", ""),
        s3_bucket=env.get("S3_BUCKET", ""),
        s3_force_path_style=env.get("S3_FORCE_PATH_STYLE", "true").strip().lower() not in ("false", "0", "no"),
        s3_access_key_id=env.get("S3_ACCESS_KEY_ID", ""),
        s3_secret_access_key=env.get("S3_SECRET_ACCESS_KEY", ""),
        clock_start=parse_instant(env.get("SETTLEMENT_CLOCK_START", "2026-11-09T12:00:00Z")),
        review_seconds=int(env.get("REVIEW_SECONDS", "864000")),
    )
