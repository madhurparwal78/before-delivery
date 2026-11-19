"""The one place environment settings are read. Credentials and endpoints have no fallback."""
import os
from dataclasses import dataclass

DEFAULT_PUBLIC_PORT = 4173
DEFAULT_CONDITIONS_STALE_SECONDS = 10800
DEFAULT_DRAFT_LOCK_SECONDS = 900
DEFAULT_PUSH_RETRY_SECONDS = 10

INTERNAL_HOST = "127.0.0.1"
SERVICE_PORT_OFFSETS = {"gateway": 0, "sky-engine": 100, "ledger": 200, "push-dispatcher": 300}
SERVICE_LABELS = {"sky-engine": "The sky engine", "ledger": "The ledger", "push-dispatcher": "The push dispatcher"}


@dataclass(frozen=True)
class Settings:
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

    def service_port(self, service: str) -> int:
        return self.public_port + SERVICE_PORT_OFFSETS[service]

    def service_url(self, service: str) -> str:
        return f"http://{INTERNAL_HOST}:{self.service_port(service)}"


def load_settings() -> Settings:
    env = os.environ
    return Settings(
        public_port=int(env.get("APP_PUBLIC_PORT", DEFAULT_PUBLIC_PORT)),
        database_url=env["DATABASE_URL"],
        s3_endpoint=env["S3_ENDPOINT"].rstrip("/"),
        s3_region=env["S3_REGION"],
        s3_bucket=env["S3_BUCKET"],
        s3_force_path_style=env["S3_FORCE_PATH_STYLE"].strip().lower() == "true",
        s3_access_key_id=env["S3_ACCESS_KEY_ID"],
        s3_secret_access_key=env["S3_SECRET_ACCESS_KEY"],
        ntfy_url=env["NTFY_URL"].rstrip("/"),
        ntfy_username=env["NTFY_USERNAME"],
        ntfy_password=env["NTFY_PASSWORD"],
        conditions_stale_seconds=int(env.get("CONDITIONS_STALE_SECONDS", DEFAULT_CONDITIONS_STALE_SECONDS)),
        draft_lock_seconds=int(env.get("DRAFT_LOCK_SECONDS", DEFAULT_DRAFT_LOCK_SECONDS)),
        push_retry_seconds=int(env.get("PUSH_RETRY_SECONDS", DEFAULT_PUSH_RETRY_SECONDS)),
    )
