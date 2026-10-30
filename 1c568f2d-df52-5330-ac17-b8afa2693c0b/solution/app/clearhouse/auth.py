"""Sign-in, lockout and the app's own opaque sessions (stored hashed in postgres)."""

import hashlib
import re
import secrets
from datetime import timedelta
from urllib.parse import unquote, urlsplit

from . import identity
from .config import settings
from .db import Row, Tx, transaction
from .errors import Refusal, invalid
from .timefmt import now

COOKIE = "clearhouse_session"
LOCKOUT_LIMIT = 5
UNRECOGNISED = "Email or passphrase is not recognised"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def account_for_token(tx: Tx, token: str | None) -> Row | None:
    if not token:
        return None
    return tx.one("SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = :h",
                  h=_hash(token))


def sign_in(body: dict) -> str:
    """Exchange the credentials with the provider and issue a session token, in the brief's order."""
    email, password = body.get("email"), body.get("password")
    if not isinstance(email, str) or not email.strip():
        raise invalid("email", "Enter your work email")
    if not isinstance(password, str) or not password:
        raise invalid("password", "Enter your passphrase")
    normalised = email.strip().lower()
    with transaction() as tx:
        failures = tx.value("SELECT count(*) FROM login_failures WHERE email = :e AND failed_at > :since",
                            e=normalised, since=now() - timedelta(seconds=settings.lockout_seconds))
    if failures >= LOCKOUT_LIMIT:
        raise Refusal(429, "Too many attempts, wait 15 minutes")
    try:
        vouched = identity.exchange(normalised, password)
    except identity.Unreachable:
        raise Refusal(503, "Sign-in is unavailable right now. Try again shortly") from None
    with transaction() as tx:
        account = tx.one("SELECT * FROM accounts WHERE lower(email) = :e", e=vouched) if vouched == normalised else None
        if account is None:
            tx.run("INSERT INTO login_failures (email) VALUES (:e)", e=normalised)
        else:
            tx.run("DELETE FROM login_failures WHERE email = :e", e=normalised)
            token = secrets.token_urlsafe(32)
            tx.run("INSERT INTO sessions (token_hash, account_id) VALUES (:h, :a)", h=_hash(token), a=account["id"])
    if account is None:
        raise Refusal(401, UNRECOGNISED)
    return token


def sign_out(token: str) -> None:
    with transaction() as tx:
        tx.run("DELETE FROM sessions WHERE token_hash = :h", h=_hash(token))


CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def safe_next(target: str | None) -> str:
    """A same-origin path beginning with a single "/" (after up to three percent-decodings), else "/"."""
    if not isinstance(target, str) or len(target) > 2048:
        return "/"
    text = target
    for _ in range(3):
        if CONTROL.search(text) or "\\" in text or not text.startswith("/") or text.startswith("//"):
            return "/"
        decoded = unquote(text)
        if decoded == text:
            parts = urlsplit(target)
            return target if not parts.scheme and not parts.netloc else "/"
        text = decoded
    return "/"
