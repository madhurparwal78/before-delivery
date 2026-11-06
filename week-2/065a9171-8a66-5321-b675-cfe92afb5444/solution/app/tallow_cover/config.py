"""The only reader of the environment: each named variable is read on its own, nothing is bulk-loaded."""

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    smtp_host: str
    smtp_port: int
    mail_from: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_force_path_style: bool
    s3_access_key_id: str
    s3_secret_access_key: str
    port: int
    escalation_after_seconds: int
    session_ttl_seconds: int
    idempotency_ttl_seconds: int


def load() -> Settings:
    return Settings(
        database_url=os.environ["DATABASE_URL"],
        smtp_host=os.environ["SMTP_HOST"],
        smtp_port=int(os.environ["SMTP_PORT"]),
        mail_from=os.environ.get("MAIL_FROM", "Tallow Cover <cover@tallow.example>"),
        s3_endpoint=os.environ["S3_ENDPOINT"].rstrip("/"),
        s3_region=os.environ["S3_REGION"],
        s3_bucket=os.environ["S3_BUCKET"],
        s3_force_path_style=os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() == "true",
        s3_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        s3_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        port=int(os.environ.get("APP_PUBLIC_PORT", "4173")),
        escalation_after_seconds=int(os.environ.get("ESCALATION_AFTER_SECONDS", "172800")),
        session_ttl_seconds=int(os.environ.get("SESSION_TTL_SECONDS", "43200")),
        idempotency_ttl_seconds=int(os.environ.get("IDEMPOTENCY_TTL_SECONDS", "86400")),
    )


settings = load()
