"""Configuration read from the environment at start."""
import os
from urllib.parse import unquote, urlsplit

BIND_HOST = "0.0.0.0"
BIND_PORT = 4173

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES_DIR = os.path.join(APP_ROOT, "fixtures")

MAX_BODY_BYTES = 2_097_152
SEED_PASSWORD = "deku-demo-pw-2026"


def _require(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError("environment variable %s is not set" % name)
    return value


DATABASE_URL = _require("DATABASE_URL")
APP_PUBLIC_URL = _require("APP_PUBLIC_URL").rstrip("/")
APP_PUBLIC_PORT = _require("APP_PUBLIC_PORT")
SMTP_HOST = _require("SMTP_HOST")
SMTP_PORT = int(_require("SMTP_PORT"))
MAIL_FROM = _require("MAIL_FROM")


def database_params():
    parts = urlsplit(DATABASE_URL)
    return {
        "host": parts.hostname or "localhost",
        "port": parts.port or 5432,
        "user": unquote(parts.username or ""),
        "password": unquote(parts.password or ""),
        "database": (parts.path or "/").lstrip("/"),
    }
