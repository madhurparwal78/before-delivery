"""Environment-derived settings, read once. Every service location comes from the environment."""

from __future__ import annotations

import os
from urllib.parse import urlsplit


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


PORT = _int("PORT", _int("APP_PUBLIC_PORT", 4173))
DATABASE_URL = os.environ.get("DATABASE_URL", "")
SMTP_HOST = os.environ.get("SMTP_HOST", "127.0.0.1")
SMTP_PORT = _int("SMTP_PORT", 1025)
MAIL_FROM = os.environ.get("MAIL_FROM", "Community Hub <no-reply@example.com>")
APP_PUBLIC_URL = (os.environ.get("APP_PUBLIC_URL") or f"http://localhost:{_int('APP_PUBLIC_PORT', 4173)}").rstrip("/")
PUBLIC_ORIGIN = "{0.scheme}://{0.netloc}".format(urlsplit(APP_PUBLIC_URL))

LOGIN_LOCKOUT_SECONDS = _int("LOGIN_LOCKOUT_SECONDS", 900)
EMAIL_TOKEN_TTL_SECONDS = _int("EMAIL_TOKEN_TTL_SECONDS", 86400)
MESSAGE_NONCE_TTL_SECONDS = _int("MESSAGE_NONCE_TTL_SECONDS", 600)
IDEMPOTENCY_KEY_TTL_SECONDS = _int("IDEMPOTENCY_KEY_TTL_SECONDS", 86400)
SUPPORT_WINDOW_SECONDS = _int("SUPPORT_WINDOW_SECONDS", 3600)

DB_POOL_MAX = 9  # two gunicorn workers per instance: 2 x 9 stays under the 20-session cap
SEED_PASSWORD = "deku-demo-pw-2026"
