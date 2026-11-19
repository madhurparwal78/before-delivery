"""Configuration read from the environment at start."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone

DEFAULT_SETTLEMENT_CLOCK_START = "2026-11-09T12:00:00Z"
DEFAULT_REVIEW_SECONDS = 864000


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing environment variable {name}")
    return value


@dataclass(frozen=True)
class Config:
    database_url: str
    wiremock_url: str
    gotenberg_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key_id: str
    s3_secret_access_key: str
    settlement_clock_start: datetime
    review_seconds: int
    port: int

    @staticmethod
    def from_environment() -> "Config":
        start = os.environ.get("SETTLEMENT_CLOCK_START") or DEFAULT_SETTLEMENT_CLOCK_START
        review_seconds = os.environ.get("REVIEW_SECONDS")
        return Config(
            database_url=_required("DATABASE_URL"),
            wiremock_url=_required("WIREMOCK_URL").rstrip("/"),
            gotenberg_url=_required("GOTENBERG_URL").rstrip("/"),
            s3_endpoint=_required("S3_ENDPOINT").rstrip("/"),
            s3_region=os.environ.get("S3_REGION") or "us-east-1",
            s3_bucket=_required("S3_BUCKET"),
            s3_force_path_style=(os.environ.get("S3_FORCE_PATH_STYLE") or "").lower()
            in ("1", "true", "yes"),
            s3_access_key_id=_required("S3_ACCESS_KEY_ID"),
            s3_secret_access_key=_required("S3_SECRET_ACCESS_KEY"),
            settlement_clock_start=datetime.strptime(start, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=timezone.utc
            ),
            review_seconds=int(review_seconds) if review_seconds else DEFAULT_REVIEW_SECONDS,
            port=int(os.environ.get("APP_PUBLIC_PORT") or 4173),
        )


CONFIG = Config.from_environment()
