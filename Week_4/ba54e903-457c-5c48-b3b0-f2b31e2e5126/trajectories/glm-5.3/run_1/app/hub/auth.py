"""Bearer token authentication and the caller's current memberships."""
from __future__ import annotations

import secrets
from typing import Optional

from .db import Database
from .errors import ApiError, unauthorized
from .requesthelp import check_query_value
from .rules import self_user
from .secrets import sha256_hex


def issue_token(db: Database, member_id: int) -> str:
    token = secrets.token_hex(16) + "-" + secrets.token_hex(16)
    db.execute(
        "INSERT INTO tokens (token_hash, member_id) VALUES (%s, %s)",
        (sha256_hex(token), member_id),
    )
    return token


def revoke_token(db: Database, token: str) -> None:
    db.execute("UPDATE tokens SET revoked_at = now() WHERE token_hash = %s",
               (sha256_hex(token),))


def revoke_all_other_tokens(db: Database, member_id: int, keep_token: str) -> None:
    db.execute(
        "UPDATE tokens SET revoked_at = now() WHERE member_id = %s AND token_hash != %s AND revoked_at IS NULL",
        (member_id, sha256_hex(keep_token)),
    )
    # signal live connections to close (ended sessions)
    from .live import note_revocation
    note_revocation(db, member_id, keep_token)


def resolve_bearer(request) -> Optional[dict]:
    """Return the member row for a valid bearer token, else None."""
    header = request.headers.get("authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    if not token:
        return None
    row = _db_lookup(request, token)
    if row is None:
        return None
    return row


def _db_lookup(request, token: str) -> Optional[dict]:
    db: Database = request.app.state.hub.db
    return db.one(
        """SELECT m.*, t.token_hash FROM tokens t JOIN members m ON m.id = t.member_id
           WHERE t.token_hash = %s AND t.revoked_at IS NULL""",
        (sha256_hex(token),),
    )


def require_member(request) -> dict:
    member = resolve_bearer(request)
    if member is None:
        raise unauthorized()
    return member


def get_member_by_email(db: Database, email: str) -> Optional[dict]:
    return db.one("SELECT * FROM members WHERE email = %s", (email,))
