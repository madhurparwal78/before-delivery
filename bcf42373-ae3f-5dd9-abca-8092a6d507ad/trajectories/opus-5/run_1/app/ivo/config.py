"""Runtime configuration, read from the environment at start."""

import os

MAX_BODY_BYTES = 32_768
BUSINESS_TIME_ZONE = "Pacific/Auckland"
DEFAULT_SIGN_IN_LOCKOUT_WINDOW_SECONDS = 900
DEFAULT_SESSION_LIFETIME_SECONDS = 43_200


def _positive_int(name, default):
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


def database_url():
    return os.environ["DATABASE_URL"]


def sign_in_lockout_window_seconds():
    return _positive_int(
        "SIGN_IN_LOCKOUT_WINDOW_SECONDS", DEFAULT_SIGN_IN_LOCKOUT_WINDOW_SECONDS
    )


def session_lifetime_seconds():
    return _positive_int("SESSION_LIFETIME_SECONDS", DEFAULT_SESSION_LIFETIME_SECONDS)
