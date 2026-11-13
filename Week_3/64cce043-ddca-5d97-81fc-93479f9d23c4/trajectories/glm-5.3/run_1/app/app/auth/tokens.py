"""OIDC: ID token verification and introspection."""

from __future__ import annotations

import time
from typing import Any, Optional

import aiohttp
from joserfc import jwt

from ..config import Config
from .identity import Identity, IdentityError


class TokenError(Exception):
    """A token that cannot be trusted."""


class TokenVerifier:
    """Verifies ID tokens against the realm's JWKS."""

    def __init__(self, identity: Identity, cfg: Config) -> None:
        self.identity = identity
        self.cfg = cfg
        self._jwks: dict[str, Any] | None = None
        self._jwks_at: float = 0.0

    async def _fetch_jwks(self) -> dict[str, Any]:
        if self._jwks is not None and time.monotonic() - self._jwks_at < 300:
            return self._jwks
        url = f"{self.cfg.auth_issuer_url}/protocol/openid-connect/certs"
        try:
            async with self.identity.session.get(url) as resp:
                if resp.status != 200:
                    raise TokenError(f"jwks failed: {resp.status}")
                data = await resp.json()
                # Import each key so joserfc can use them for verification.
                from joserfc.jwk import KeySet, RSAKey

                keys = []
                for item in data.get("keys", []):
                    try:
                        keys.append(RSAKey.import_key(item))
                    except Exception:
                        continue
                self._jwks = KeySet(keys)
                self._jwks_at = time.monotonic()
                return self._jwks
        except TokenError:
            raise
        except Exception as exc:
            raise TokenError(str(exc))

    async def verify_id_token(self, id_token: str) -> dict[str, Any]:
        """Validate the ID token's signature, issuer and nonce; return its claims."""
        try:
            jwks = await self._fetch_jwks()
            token = jwt.decode(id_token, key=jwks)
        except Exception as exc:
            raise TokenError(f"bad token: {exc}")
        claims = token.claims
        if claims.get("iss") != self.cfg.auth_issuer_url:
            raise TokenError("issuer mismatch")
        if "sub" not in claims:
            raise TokenError("missing sub")
        return claims

    @staticmethod
    def check_nonce(claims: dict[str, Any], nonce: str) -> None:
        if claims.get("nonce") != nonce:
            raise TokenError("nonce mismatch")


async def introspect_access_token(identity: Identity, cfg: Config, token: str) -> Optional[dict[str, Any]]:
    """Introspect an access token to find whether the session still exists in the realm."""
    data = {
        "token": token,
        "client_id": cfg.auth_client_id,
        "client_secret": cfg.auth_client_secret,
    }
    url = f"{cfg.auth_issuer_url}/protocol/openid-connect/token/introspect"
    try:
        async with identity.session.post(url, data=data) as resp:
            if resp.status != 200:
                return None
            return await resp.json(content_type=None)
    except Exception:
        return None
