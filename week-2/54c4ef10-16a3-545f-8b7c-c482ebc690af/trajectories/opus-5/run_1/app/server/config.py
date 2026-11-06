"""Configuration read from the environment at start."""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_SESSION_TTL_SECONDS = 2_592_000
DEFAULT_PORT = 4173

JSON_BODY_LIMIT = 65_536
UPLOAD_BODY_LIMIT = 60_000_000


@dataclass(frozen=True)
class Config:
    database_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key_id: str
    s3_secret_access_key: str
    session_ttl_seconds: int
    port: int
    public_url: str | None


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"environment variable {name} is required")
    return value


def load_config() -> Config:
    return Config(
        database_url=_required("DATABASE_URL"),
        s3_endpoint=_required("S3_ENDPOINT").rstrip("/"),
        s3_region=os.environ.get("S3_REGION", "us-east-1"),
        s3_bucket=_required("S3_BUCKET"),
        s3_force_path_style=os.environ.get("S3_FORCE_PATH_STYLE", "true").lower()
        in ("1", "true", "yes"),
        s3_access_key_id=_required("S3_ACCESS_KEY_ID"),
        s3_secret_access_key=_required("S3_SECRET_ACCESS_KEY"),
        session_ttl_seconds=int(
            os.environ.get("SESSION_TTL_SECONDS") or DEFAULT_SESSION_TTL_SECONDS
        ),
        port=int(os.environ.get("APP_PUBLIC_PORT") or DEFAULT_PORT),
        public_url=os.environ.get("APP_PUBLIC_URL") or None,
    )


CONFIG = load_config()
