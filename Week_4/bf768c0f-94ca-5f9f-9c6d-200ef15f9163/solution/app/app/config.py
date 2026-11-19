import os


def _int_env(name: str) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        raise RuntimeError(f"required environment variable {name} is not set")
    return int(raw)


DATABASE_URL = os.environ.get("DATABASE_URL")
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "")
APP_PUBLIC_PORT = int(os.environ.get("APP_PUBLIC_PORT", "4173"))

LOGIN_MAX_FAILS = _int_env("LOGIN_MAX_FAILS")
LOCKOUT_SEC = _int_env("LOCKOUT_SEC")
CHAT_RATE_LIMIT = _int_env("CHAT_RATE_LIMIT")
FIRST_MOVE_ABORT_SEC = _int_env("FIRST_MOVE_ABORT_SEC")
MOVE_DEADLINE_SEC = _int_env("MOVE_DEADLINE_SEC")

CLUB_NAME = "Gambit Hall Club"
CHAT_RATE_WINDOW_SEC = 10
MAX_AVATAR_BYTES = 2 * 1024 * 1024
AVATAR_PX = 256
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
