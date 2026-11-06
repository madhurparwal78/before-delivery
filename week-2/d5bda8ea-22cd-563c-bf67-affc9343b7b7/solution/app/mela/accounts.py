"""Members, password hashes, sessions and the safe `next` decision."""
import hashlib
import hmac
import re
import secrets
import unicodedata
from urllib.parse import unquote, urlsplit

from flask import g, request

from . import config, db

ITERATIONS = 200_000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def password_matches(password, stored):
    _, iterations, salt, digest = stored.split("$")
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(candidate.hex(), digest)


def valid_email(email):
    return len(email) <= 254 and EMAIL_RE.match(email) is not None


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(member_id):
    token = secrets.token_urlsafe(32)
    db.conn().execute("INSERT INTO sessions (token_hash, member_id) VALUES (%s, %s)", (_token_hash(token), member_id))
    return token


def end_session(token):
    db.conn().execute("DELETE FROM sessions WHERE token_hash = %s", (_token_hash(token),))


def request_token():
    header = request.headers.get("Authorization", "")
    if header[:7].lower() == "bearer ":
        return header[7:].strip()
    return request.cookies.get(config.SESSION_COOKIE)


def load_member():
    """Set g.member and g.token from the cookie or bearer token of this request."""
    g.member, g.token = None, None
    token = request_token()
    if not token:
        return
    member = db.conn().execute(
        "SELECT m.id, m.name, m.email FROM sessions s JOIN members m ON m.id = s.member_id"
        " WHERE s.token_hash = %s", (_token_hash(token),)).fetchone()
    if member:
        g.member, g.token = member, token


def set_session_cookie(response, token):
    response.set_cookie(config.SESSION_COOKIE, token, max_age=config.SESSION_DAYS * 86400, httponly=True,
                        samesite="Lax", path="/")


def clear_session_cookie(response):
    response.delete_cookie(config.SESSION_COOKIE, path="/", httponly=True, samesite="Lax")


def safe_next(value):
    """The in-app path to land on after signing in: `value` when it is a plain local path, else /home."""
    decoded = unquote(value or "")
    if (decoded.startswith("/") and not decoded.startswith("//") and "\\" not in decoded
            and not any(unicodedata.category(ch) == "Cc" for ch in decoded)
            and not urlsplit(decoded).scheme and not urlsplit(decoded).netloc):
        return value
    return "/home"
