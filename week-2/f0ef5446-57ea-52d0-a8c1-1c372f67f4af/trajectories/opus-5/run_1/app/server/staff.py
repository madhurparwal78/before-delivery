"""The staff token check: who the auth service reports behind a bearer token."""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass

from .auth import AUTH, StaffPrincipal
from .db import DATABASE


@dataclass(frozen=True)
class _TokenClaims:
    """Claims read from the presented token without trusting them."""

    identifier: str
    subject: str


def _unverified_claims(token: str) -> _TokenClaims | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    padded = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    identifier = payload.get("jti")
    subject = payload.get("sub")
    if not isinstance(identifier, str) or not isinstance(subject, str):
        return None
    return _TokenClaims(identifier=identifier, subject=subject)


async def principal_for_token(token: str) -> StaffPrincipal | None:
    """The staff member behind a token, or None when the token is not usable."""
    claims = _unverified_claims(token)
    if claims is None:
        return None
    if await _is_dead(claims.identifier):
        return None

    active = await AUTH.introspect(token)
    if active is None:
        await _remember_if_disabled(claims)
        return None

    email = active.get("email")
    session_id = active.get("sid")
    user_id = active.get("sub")
    if not isinstance(email, str) or not isinstance(session_id, str) or not isinstance(user_id, str):
        return None
    return StaffPrincipal(user_id=user_id, session_id=session_id, email=email)


async def _is_dead(identifier: str) -> bool:
    return bool(
        await DATABASE.fetchval(
            "SELECT true FROM dead_tokens WHERE token_id = $1",
            identifier,
        )
    )


async def _remember_if_disabled(claims: _TokenClaims) -> None:
    """A token refused while its account is disabled is never revived."""
    user = await AUTH.read_user(claims.subject)
    if user is None or user.get("enabled") is not False:
        return
    await DATABASE.execute(
        """
        INSERT INTO dead_tokens (token_id, noticed_at) VALUES ($1, now())
        ON CONFLICT (token_id) DO NOTHING
        """,
        claims.identifier,
    )
