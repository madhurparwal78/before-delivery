"""Bearer tokens and password hashing. Tokens are stored only as their SHA-256 digest."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
from typing import Any

from flask import g, request

from . import db
from .errors import ApiError

_BEARER = re.compile(r"Bearer ([A-Za-z0-9_-]+)")
_SCRYPT = dict(n=2**14, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str) -> bool:
    _, salt, digest = stored.split("$")
    candidate = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt), **_SCRYPT)
    return hmac.compare_digest(candidate, base64.b64decode(digest))


def new_token(cur: db.Cursor, member_id: int) -> str:
    token = secrets.token_urlsafe(32)
    cur.execute("INSERT INTO tokens (member_id, token_hash) VALUES (%s, %s)", (member_id, sha256_hex(token)))
    return token


def revoke_tokens(cur: db.Cursor, member_id: int, except_token_id: int | None = None) -> None:
    cur.execute(
        "UPDATE tokens SET revoked_at = clock_timestamp() "
        "WHERE member_id = %s AND revoked_at IS NULL AND id IS DISTINCT FROM %s",
        (member_id, except_token_id),
    )


def bearer_token() -> str | None:
    found = _BEARER.fullmatch(request.headers.get("Authorization", ""))
    return found.group(1) if found else None


def resolve(token: str | None) -> dict[str, Any] | None:
    """The member row (plus ``token_id``) for a live token, or None."""
    if token is None:
        return None
    return db.one_row(
        "SELECT m.*, t.id AS token_id FROM tokens t JOIN members m ON m.id = t.member_id "
        "WHERE t.token_hash = %s AND t.revoked_at IS NULL",
        (sha256_hex(token),),
    )


def authenticate(mode: str) -> None:
    """Fill ``g.member`` and ``g.token_id``; ``required`` refuses with 401, ``optional`` treats a bad token as none."""
    g.member = None
    g.token_id = None
    if mode == "none":
        return
    member = resolve(bearer_token())
    if member is None:
        if mode == "required":
            raise ApiError("unauthorized")
        return
    g.member = member
    g.token_id = member["token_id"]
