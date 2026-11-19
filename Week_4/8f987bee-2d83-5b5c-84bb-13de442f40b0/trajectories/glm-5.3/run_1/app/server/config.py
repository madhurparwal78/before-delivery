import os


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("DB_URL") or ""
APP_PUBLIC_PORT = _int_env("APP_PUBLIC_PORT", 4173)
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL") or ""
WAYLINE_LOCKOUT_SECONDS = _int_env("WAYLINE_LOCKOUT_SECONDS", 900)
WAYLINE_INVITE_TTL_SECONDS = _int_env("WAYLINE_INVITE_TTL_SECONDS", 604800)
WAYLINE_IDEMPOTENCY_TTL_SECONDS = _int_env("WAYLINE_IDEMPOTENCY_TTL_SECONDS", 86400)

MAX_BODY_BYTES = 1_000_000
PLANS = {"starter": 60, "team": 15, "scale": 5, "private": 5}
SEED_PASSWORD = "deku-demo-pw-2026"
SANDBOX_API_KEY = "sandbox-key-2026"
