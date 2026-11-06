"""Staff sign-in with the sign-in failure limit, counted per email key inside PostgreSQL."""

from __future__ import annotations

from typing import Any

from werkzeug.wrappers import Response

from . import db, keycloak
from .config import settings
from .http import ApiError, json_response
from .validation import SUMMARY_MESSAGE, check_credentials, email_key, has_unsupported

FAILURE_LIMIT = 5

RECENT_FAILURES = """
SELECT count(*) AS failures,
       ceil(extract(epoch FROM min(failed_at) + make_interval(secs => :window) - clock_timestamp())) AS wait
FROM sign_in_failures
WHERE email_key = :key AND failed_at > clock_timestamp() - make_interval(secs => :window)
"""


def sign_in(body: dict[str, Any]) -> Response:
    errors = check_credentials(body)
    if errors:
        raise ApiError(422, "validation_failed", message=SUMMARY_MESSAGE, errors=errors)
    email, password = body["email"], body["password"]
    key = email_key(email)
    window = float(settings.login_failure_window_seconds)
    with db.transaction() as conn:
        # One sign-in per email key at a time, so the count and the new failure are decided together.
        conn.run("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))", key=key)
        recent = db.one(conn, RECENT_FAILURES, key=key, window=window)
        locked = recent["failures"] >= FAILURE_LIMIT
        granted = None
        if not locked:
            if not has_unsupported(email) and not has_unsupported(password):
                granted = keycloak.password_grant(key, password)
            if granted is None:
                conn.run("INSERT INTO sign_in_failures (email_key, failed_at) VALUES (:key, clock_timestamp())",
                         key=key)
            else:
                conn.run("DELETE FROM sign_in_failures WHERE email_key = :key", key=key)
    if locked:
        raise ApiError(429, "too_many_attempts", {"Retry-After": str(max(1, int(recent["wait"])))})
    if granted is None:
        raise ApiError(401, "invalid_credentials")
    return json_response(200, {"access_token": granted["access_token"], "token_type": "Bearer",
                               "expires_in": int(granted.get("expires_in", 0))})
