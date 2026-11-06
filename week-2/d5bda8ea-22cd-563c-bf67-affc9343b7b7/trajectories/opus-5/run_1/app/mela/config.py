"""Runtime configuration, read from the environment at start."""

import os
from datetime import datetime, timezone

DATABASE_URL = os.environ.get("DATABASE_URL", "")

ACCESS_CODE_WINDOW_SECONDS = int(
    os.environ.get("MELA_ACCESS_CODE_WINDOW_SECONDS") or 900
)
IDEMPOTENCY_RETENTION_SECONDS = int(
    os.environ.get("MELA_IDEMPOTENCY_RETENTION_SECONDS") or 86400
)

ACCESS_CODE_FAILURE_LIMIT = 5
MAX_BODY_BYTES = 65536
SESSION_COOKIE = "mela_session"

STARTED_AT = datetime.now(timezone.utc).replace(microsecond=0)
STARTED_AT_ISO = STARTED_AT.strftime("%Y-%m-%dT%H:%M:%SZ")
