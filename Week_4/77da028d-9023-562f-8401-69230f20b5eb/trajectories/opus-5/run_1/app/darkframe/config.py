"""Configuration, read from the environment only."""

from __future__ import annotations

import os
from dataclasses import dataclass

VERSION = "1.0.0"

GATEWAY = "gateway"
SKY_ENGINE = "sky-engine"
LEDGER = "ledger"
PUSH_DISPATCHER = "push-dispatcher"

SERVICE_LABELS = {
    SKY_ENGINE: "The sky engine",
    LEDGER: "The ledger",
    PUSH_DISPATCHER: "The push dispatcher",
}

PORT_OFFSETS = {GATEWAY: 0, SKY_ENGINE: 100, LEDGER: 200, PUSH_DISPATCHER: 300}

SCHEMAS = {
    GATEWAY: "gateway",
    SKY_ENGINE: "sky_engine",
    LEDGER: "ledger",
    PUSH_DISPATCHER: "push_dispatcher",
}


@dataclass(frozen=True)
class Config:
    public_port: int
    database_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key_id: str
    s3_secret_access_key: str
    ntfy_url: str
    ntfy_username: str
    ntfy_password: str
    conditions_stale_seconds: int
    draft_lock_seconds: int
    push_retry_seconds: int

    def port_of(self, service: str) -> int:
        return self.public_port + PORT_OFFSETS[service]

    def base_url(self, service: str) -> str:
        return f"http://127.0.0.1:{self.port_of(service)}"


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


def load_config() -> Config:
    return Config(
        public_port=_int_env("APP_PUBLIC_PORT", 4173),
        database_url=os.environ.get("DATABASE_URL", ""),
        s3_endpoint=os.environ.get("S3_ENDPOINT", ""),
        s3_region=os.environ.get("S3_REGION", "us-east-1"),
        s3_bucket=os.environ.get("S3_BUCKET", ""),
        s3_force_path_style=os.environ.get("S3_FORCE_PATH_STYLE", "true").lower()
        in ("1", "true", "yes"),
        s3_access_key_id=os.environ.get("S3_ACCESS_KEY_ID", ""),
        s3_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY", ""),
        ntfy_url=os.environ.get("NTFY_URL", ""),
        ntfy_username=os.environ.get("NTFY_USERNAME", ""),
        ntfy_password=os.environ.get("NTFY_PASSWORD", ""),
        conditions_stale_seconds=_int_env("CONDITIONS_STALE_SECONDS", 10800),
        draft_lock_seconds=_int_env("DRAFT_LOCK_SECONDS", 900),
        push_retry_seconds=_int_env("PUSH_RETRY_SECONDS", 10),
    )


CONFIG = load_config()
