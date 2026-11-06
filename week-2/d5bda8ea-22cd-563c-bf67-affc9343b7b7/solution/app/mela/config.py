"""Every value Mela reads from the environment, read once at start."""
import os
from datetime import datetime, timezone

DATABASE_URL = os.environ.get("DATABASE_URL", "")
ACCESS_CODE_WINDOW_SECONDS = int(os.environ.get("MELA_ACCESS_CODE_WINDOW_SECONDS", "900"))
IDEMPOTENCY_RETENTION_SECONDS = int(os.environ.get("MELA_IDEMPOTENCY_RETENTION_SECONDS", "86400"))

# Imported once in the gunicorn master (preload_app), so every worker of one serve reports the same instant.
STARTED_AT = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

SESSION_COOKIE = "mela_session"
SESSION_DAYS = 30
BODY_LIMIT = 65536
