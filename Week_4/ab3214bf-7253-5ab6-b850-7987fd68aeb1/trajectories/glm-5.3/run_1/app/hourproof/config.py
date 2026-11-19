"""Configuration read once at start from the environment."""
import os
from datetime import datetime, timezone

DATABASE_URL = os.environ["DATABASE_URL"]
WIREMOCK_URL = os.environ["WIREMOCK_URL"].rstrip("/")
GOTENBERG_URL = os.environ["GOTENBERG_URL"].rstrip("/")
S3_ENDPOINT = os.environ["S3_ENDPOINT"].rstrip("/")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
S3_BUCKET = os.environ["S3_BUCKET"]
S3_FORCE_PATH_STYLE = os.environ.get("S3_FORCE_PATH_STYLE", "true") == "true"
S3_ACCESS_KEY_ID = os.environ["S3_ACCESS_KEY_ID"]
S3_SECRET_ACCESS_KEY = os.environ["S3_SECRET_ACCESS_KEY"]

SETTLEMENT_CLOCK_START = os.environ.get(
    "SETTLEMENT_CLOCK_START", "2026-11-09T12:00:00Z"
)
REVIEW_SECONDS = int(os.environ.get("REVIEW_SECONDS", "864000"))

APP_PUBLIC_PORT = int(os.environ.get("APP_PUBLIC_PORT", "4173"))
MAX_BODY_BYTES = 1_000_000
PROVIDER_TIMEOUT = 5.0


def _parse_instant(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


CLOCK_START = _parse_instant(SETTLEMENT_CLOCK_START)
