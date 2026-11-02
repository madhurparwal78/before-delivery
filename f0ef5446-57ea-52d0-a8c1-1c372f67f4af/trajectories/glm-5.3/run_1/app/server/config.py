"""Runtime configuration: every service URL and credential comes from the
environment (DP-59)."""
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "")
KEYCLOAK_URL = os.environ.get("KEYCLOAK_URL", "").rstrip("/")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "")
AUTH_ISSUER_URL = os.environ.get("AUTH_ISSUER_URL", "").rstrip("/")
AUTH_CLIENT_ID = os.environ.get("AUTH_CLIENT_ID", "")
AUTH_CLIENT_SECRET = os.environ.get("AUTH_CLIENT_SECRET", "")
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "25"))
MAIL_FROM = os.environ.get("MAIL_FROM", "")
APP_PUBLIC_PORT = int(os.environ.get("APP_PUBLIC_PORT", "4173"))


def _positive_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


IDEMPOTENCY_KEY_TTL_SECONDS = _positive_env("IDEMPOTENCY_KEY_TTL_SECONDS", 86400)
LOGIN_FAILURE_WINDOW_SECONDS = _positive_env("LOGIN_FAILURE_WINDOW_SECONDS", 300)

SEED_PASSWORD = "deku-demo-pw-2026"
SEED_REVIEWER_EMAIL = "reviewer@example.com"
SEED_ANALYST_EMAIL = "analyst@example.com"
REVIEWER_ROLE = "partner-reviewer"
