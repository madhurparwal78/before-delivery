"""Environment configuration, read once at start, never sent to the browser."""
from __future__ import annotations

import os
from dataclasses import dataclass

SESSION_TTL_DEFAULT = 2_592_000
PORT_DEFAULT = 4173
JSON_BODY_LIMIT = 65_536
UPLOAD_BODY_LIMIT = 60_000_000


@dataclass
class Config:
    database_url: str
    s3_endpoint: str
    s3_region: str | None
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key: str
    s3_secret_key: str
    session_ttl: int
    port: int
    public_url: str | None

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            database_url=os.environ["DATABASE_URL"],
            s3_endpoint=os.environ["S3_ENDPOINT"],
            s3_region=os.environ.get("S3_REGION") or None,
            s3_bucket=os.environ["S3_BUCKET"],
            s3_force_path_style=os.environ.get("S3_FORCE_PATH_STYLE", "false").lower()
            in ("1", "true", "yes"),
            s3_access_key=os.environ["S3_ACCESS_KEY_ID"],
            s3_secret_key=os.environ["S3_SECRET_ACCESS_KEY"],
            session_ttl=int(os.environ.get("SESSION_TTL_SECONDS")
                             or SESSION_TTL_DEFAULT),
            port=int(os.environ.get("APP_PUBLIC_PORT") or PORT_DEFAULT),
            public_url=os.environ.get("APP_PUBLIC_URL") or None,
        )
