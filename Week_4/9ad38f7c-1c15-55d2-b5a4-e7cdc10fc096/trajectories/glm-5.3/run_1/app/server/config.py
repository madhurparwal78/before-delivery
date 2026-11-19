"""Configuration read once at start."""

import os
import re
from urllib.parse import unquote

DATABASE_URL = os.environ.get("DATABASE_URL", "")
PORT = int(os.environ.get("APP_PUBLIC_PORT") or 4173)
SIGN_IN_LOCK_SECONDS = int(os.environ.get("SIGN_IN_LOCK_SECONDS") or 900)

_URL_RE = re.compile(r"^(?:postgres(?:ql)?://)?([^:/@]+)(?::([^@]*))?@([^:/@]+):(\d+)/(.+)$")

def database_parts():
    """Parse DATABASE_URL into pg8000 keyword arguments."""
    m = _URL_RE.match(DATABASE_URL)
    if not m:
        return None
    user, password, host, port, name = m.groups()
    return {"user": unquote(user), "password": unquote(password), "host": host,
            "port": int(port), "database": name}
