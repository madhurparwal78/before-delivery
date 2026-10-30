"""Configuration read from the environment at import time."""
import hashlib
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "")
KEYCLOAK_URL = os.environ.get("KEYCLOAK_URL", "")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "")
AUTH_ISSUER_URL = os.environ.get("AUTH_ISSUER_URL", "")
AUTH_CLIENT_ID = os.environ.get("AUTH_CLIENT_ID", "")
AUTH_CLIENT_SECRET = os.environ.get("AUTH_CLIENT_SECRET", "")
APP_PUBLIC_PORT = int(os.environ.get("APP_PUBLIC_PORT") or 4173)
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "")
LOGIN_LOCKOUT_SECONDS = int(os.environ.get("LOGIN_LOCKOUT_SECONDS") or 900)

SEED_PASSPHRASE = "deku-demo-pw-2026"
SESSION_COOKIE = "clearhouse_session"
VISIT_COOKIE = "clearhouse_plaques"

CURSOR_KEY = hashlib.sha256(
    ("clearhouse-cursor:" + AUTH_CLIENT_SECRET).encode("utf-8")
).digest()
