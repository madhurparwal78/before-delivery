"""Every environment variable the server reads, read once at start."""

import os
from dataclasses import dataclass

DEFAULT_SESSION_TTL_SECONDS = 2_592_000
DEFAULT_PORT = 4173


@dataclass(frozen=True, slots=True)
class Settings:
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


def load_settings(environ: dict[str, str] | None = None) -> Settings:
    env = os.environ if environ is None else environ
    return Settings(
        database_url=env["DATABASE_URL"],
        s3_endpoint=env["S3_ENDPOINT"].rstrip("/"),
        s3_region=env["S3_REGION"],
        s3_bucket=env["S3_BUCKET"],
        s3_force_path_style=env["S3_FORCE_PATH_STYLE"].strip().lower() == "true",
        s3_access_key_id=env["S3_ACCESS_KEY_ID"],
        s3_secret_access_key=env["S3_SECRET_ACCESS_KEY"],
        session_ttl_seconds=int(env.get("SESSION_TTL_SECONDS") or DEFAULT_SESSION_TTL_SECONDS),
        port=int(env.get("APP_PUBLIC_PORT") or DEFAULT_PORT),
        public_url=(env.get("APP_PUBLIC_URL") or "").rstrip("/") or None,
    )
