"""Every setting the app reads, taken from the environment once at start (brief: Configuration and secrets)."""

import os
from dataclasses import dataclass
from email.headerregistry import Address
from email.utils import parseaddr


def _hold_seconds(raw: str | None) -> int:
    if raw is None or not raw.strip().isdigit():
        return 30
    return min(600, int(raw))


def _from_address(raw: str) -> Address:
    name, addr = parseaddr(raw)
    user, _, domain = addr.partition("@")
    return Address(display_name=name, username=user, domain=domain)


@dataclass(frozen=True)
class Config:
    database_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_path_style: bool
    s3_access_key: str
    s3_secret_key: str
    smtp_host: str
    smtp_port: int
    mail_from: Address
    port: int
    public_url: str
    notice_hold_seconds: int
    clock_start: str | None


def load() -> Config:
    env = os.environ
    port = int(env.get("APP_PUBLIC_PORT") or 4173)
    return Config(
        database_url=env["DATABASE_URL"],
        s3_endpoint=env["S3_ENDPOINT"].rstrip("/"),
        s3_region=env["S3_REGION"],
        s3_bucket=env["S3_BUCKET"],
        s3_path_style=env.get("S3_FORCE_PATH_STYLE", "true").lower() in ("1", "true", "yes"),
        s3_access_key=env["S3_ACCESS_KEY_ID"],
        s3_secret_key=env["S3_SECRET_ACCESS_KEY"],
        smtp_host=env["SMTP_HOST"],
        smtp_port=int(env["SMTP_PORT"]),
        mail_from=_from_address(env["MAIL_FROM"]),
        port=port,
        public_url=env["APP_PUBLIC_URL"].rstrip("/"),
        notice_hold_seconds=_hold_seconds(env.get("NOTICE_HOLD_SECONDS")),
        clock_start=env.get("TAILBOARD_CLOCK_START") or None,
    )


settings = load()
