"""Environment configuration (DP-02). Variables containing _OBSERVER_ are ignored."""
import os
from dataclasses import dataclass
from urllib.parse import urlsplit


def _clean(environ):
    return {k: v for k, v in environ.items() if "_OBSERVER_" not in k.upper()}


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
    app_public_port: int
    app_public_url: str
    notice_hold_seconds: int
    clock_start: str | None

    @property
    def app_origin(self) -> str:
        parts = urlsplit(self.app_public_url)
        if parts.port and parts.port not in (80, 443):
            return f"{parts.scheme}://{parts.hostname}:{parts.port}"
        return f"{parts.scheme}://{parts.hostname}"


def load_config(environ=None) -> Config:
    env = _clean(environ or os.environ)

    def need(name: str) -> str:
        value = env.get(name)
        if value is None or value == "":
            raise RuntimeError(f"missing required environment variable {name}")
        return value

    try:
        hold = int(env.get("NOTICE_HOLD_SECONDS") or "30")
    except ValueError:
        hold = 30
    if hold < 0 or hold > 600:
        hold = 30

    port = env.get("APP_PUBLIC_PORT") or "4173"

    return Config(
        database_url=need("DATABASE_URL"),
        s3_endpoint=need("S3_ENDPOINT"),
        s3_region=need("S3_REGION"),
        s3_bucket=need("S3_BUCKET"),
        s3_force_path_style=(env.get("S3_FORCE_PATH_STYLE") or "").lower() == "true",
        s3_access_key_id=need("S3_ACCESS_KEY_ID"),
        s3_secret_access_key=need("S3_SECRET_ACCESS_KEY"),
        smtp_host=need("SMTP_HOST"),
        smtp_port=int(need("SMTP_PORT")),
        mail_from=need("MAIL_FROM"),
        app_public_port=int(port),
        app_public_url=need("APP_PUBLIC_URL"),
        notice_hold_seconds=hold,
        clock_start=env.get("TAILBOARD_CLOCK_START") or None,
    )
