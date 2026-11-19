"""Environment-driven configuration for Darkframe."""
import os


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        return int(raw) if raw not in (None, "") else default
    except ValueError:
        return default


class Config:
    def __init__(self) -> None:
        self.public_port = _int("APP_PUBLIC_PORT", 4173)
        self.database_url = os.environ["DATABASE_URL"]
        self.s3_endpoint = os.environ.get("S3_ENDPOINT", "http://127.0.0.1:9000")
        self.s3_region = os.environ.get("S3_REGION", "us-east-1")
        self.s3_bucket = os.environ.get("S3_BUCKET", "darkframe")
        self.s3_force_path_style = os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() != "false"
        self.s3_access_key = os.environ.get("S3_ACCESS_KEY_ID", "")
        self.s3_secret_key = os.environ.get("S3_SECRET_ACCESS_KEY", "")
        self.ntfy_url = os.environ.get("NTFY_URL", "")
        self.ntfy_username = os.environ.get("NTFY_USERNAME", "")
        self.ntfy_password = os.environ.get("NTFY_PASSWORD", "")
        self.conditions_stale_seconds = _int("CONDITIONS_STALE_SECONDS", 10800)
        self.draft_lock_seconds = _int("DRAFT_LOCK_SECONDS", 900)
        self.push_retry_seconds = _int("PUSH_RETRY_SECONDS", 10)

    @property
    def sky_engine_port(self) -> int:
        return self.public_port + 100

    @property
    def ledger_port(self) -> int:
        return self.public_port + 200

    @property
    def push_dispatcher_port(self) -> int:
        return self.public_port + 300


def load_config() -> Config:
    return Config()
