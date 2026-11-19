"""The one place the environment is read."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("APP_PUBLIC_PORT", "4173"))
PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", f"http://127.0.0.1:{PORT}").rstrip("/")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
POOL_SIZE = int(os.environ.get("KEYSTONE_POOL_SIZE", "24"))

SESSION_COOKIE = "keystone_session"
SESSION_HOURS = 12
DEPARTMENTS = ("claims", "underwriting", "actuarial")
ROLES = ("viewer", "analyst", "editor", "steward")
COLUMN_TYPES = ("text", "integer", "decimal", "date", "choice", "flag")
TEXT_CEILING = 500
MESSAGE_CEILING = 1000
PAGE_DEFAULT = 100
PAGE_CAP = 500
LOG_PAGE = 20
QUEUE_PAGE = 20
THROTTLE_ATTEMPTS = 5
THROTTLE_WINDOW_SECONDS = 15 * 60
IDEMPOTENCY_HOURS = 24
BUSINESS_UTC_OFFSET_MINUTES = 330  # Asia/Kolkata, a fixed +05:30
BULK_PHRASE = "Revoke these grants permanently"
