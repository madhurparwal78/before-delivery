"""Sign-in, the lockout rule and session lifetime, all on the database clock."""

import math
import secrets

from . import config
from .passwords import password_matches

LOCKOUT_THRESHOLD = 5
TOKEN_BYTES = 32


def normalise_email(email):
    return email.strip().lower()


def record_attempt(cursor, email, succeeded):
    cursor.execute(
        "INSERT INTO sign_in_attempts (email, succeeded) VALUES (%s, %s)",
        (email, succeeded),
    )


def lock_state(cursor, email):
    """The one lockout rule: refusals inside the window since the last success."""
    window = config.sign_in_lockout_window_seconds()
    cursor.execute(
        """
        SELECT attempted_at, now() AS checked_at
          FROM sign_in_attempts
         WHERE email = %(email)s
           AND NOT succeeded
           AND attempted_at >= now() - make_interval(secs => %(window)s)
           AND attempted_at > coalesce(
                   (SELECT max(attempted_at) FROM sign_in_attempts
                     WHERE email = %(email)s AND succeeded),
                   '-infinity'::timestamptz)
         ORDER BY attempted_at DESC
         LIMIT %(threshold)s
        """,
        {"email": email, "window": window, "threshold": LOCKOUT_THRESHOLD},
    )
    rows = cursor.fetchall()
    if len(rows) < LOCKOUT_THRESHOLD:
        return False, 0
    oldest_counted, checked_at = rows[-1]["attempted_at"], rows[-1]["checked_at"]
    remaining = (oldest_counted - checked_at).total_seconds() + window
    return True, max(1, min(window, math.ceil(remaining)))


def find_account(cursor, email):
    cursor.execute(
        "SELECT id, email, password_hash, role FROM accounts WHERE email = %s",
        (email,),
    )
    row = cursor.fetchone()
    return dict(row) if row else None


def verify(account, password):
    return account is not None and password_matches(password, account["password_hash"])


def open_session(cursor, account_id):
    token = secrets.token_urlsafe(TOKEN_BYTES)
    cursor.execute(
        """
        INSERT INTO sessions (account_id, token, created_at, expires_at)
        VALUES (%s, %s, now(), now() + make_interval(secs => %s))
        """,
        (account_id, token, config.session_lifetime_seconds()),
    )
    return token


def live_session(cursor, token):
    """A token opens nothing once revoked or once the clock reaches expires_at."""
    cursor.execute(
        """
        SELECT sessions.id, sessions.account_id, accounts.role
          FROM sessions
          JOIN accounts ON accounts.id = sessions.account_id
         WHERE sessions.token = %s
           AND sessions.revoked_at IS NULL
           AND sessions.expires_at > now()
        """,
        (token,),
    )
    row = cursor.fetchone()
    return dict(row) if row else None


def revoke_session(cursor, token):
    cursor.execute(
        "UPDATE sessions SET revoked_at = now() "
        "WHERE token = %s AND revoked_at IS NULL",
        (token,),
    )
