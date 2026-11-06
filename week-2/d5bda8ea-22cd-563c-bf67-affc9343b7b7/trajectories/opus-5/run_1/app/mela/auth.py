"""Members, salted password hashes and sessions."""

import secrets

from flask import g, request
from werkzeug.security import check_password_hash, generate_password_hash

from . import config, db
from .errors import unauthenticated

HASH_METHOD = "pbkdf2:sha256:120000"
SESSION_MAX_AGE = 60 * 60 * 24 * 30


def hash_password(raw: str) -> str:
    return generate_password_hash(raw, method=HASH_METHOD, salt_length=16)


def password_matches(stored: str, raw: str) -> bool:
    return check_password_hash(stored, raw)


def new_session(conn, member_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO sessions (token, member_id) VALUES (%s, %s)", (token, member_id)
    )
    return token


def end_session(conn, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token = %s", (token,))


def request_token() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:].strip() or None
    return request.cookies.get(config.SESSION_COOKIE)


def member_for_token(conn, token: str | None) -> dict | None:
    if not token:
        return None
    return conn.execute(
        """
        SELECT m.id, m.name, m.email FROM sessions s
          JOIN members m ON m.id = s.member_id
         WHERE s.token = %s
        """,
        (token,),
    ).fetchone()


def current_member(conn=None) -> dict | None:
    """The signed-in member for this request, resolved once."""
    if "mela_member" not in g:
        if conn is not None:
            g.mela_member = member_for_token(conn, request_token())
        else:
            with db.transaction() as own:
                g.mela_member = member_for_token(own, request_token())
    return g.mela_member


def require_member(conn=None) -> dict:
    member = current_member(conn)
    if member is None:
        raise unauthenticated()
    return member


def set_session_cookie(response, token: str) -> None:
    response.set_cookie(
        config.SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="Lax",
        path="/",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(config.SESSION_COOKIE, path="/", samesite="Lax")


def avatar_initials(name: str) -> str:
    parts = [part for part in name.split() if part]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][0].upper()
    return (parts[0][0] + parts[-1][0]).upper()
