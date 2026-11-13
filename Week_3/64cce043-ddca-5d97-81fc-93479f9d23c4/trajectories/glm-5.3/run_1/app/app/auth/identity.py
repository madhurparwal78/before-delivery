"""Keycloak client: sign-in flow, admin operations, and status checks."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import secrets
import time
from typing import Any, Optional
from urllib.parse import quote, urlencode

import aiohttp

from ..config import Config

log = logging.getLogger("strongroom.identity")


class IdentityError(Exception):
    """The realm could not be reached or answered badly."""


class Identity:
    """Every interaction with the realm goes through this client."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self._admin_token: Optional[str] = None
        self._admin_token_at: float = 0.0
        self._session: Optional[aiohttp.ClientSession] = None
        self._status_ok: Optional[bool] = None
        self._status_checked_at: float = 0.0
        self._status_lock = asyncio.Lock()

    async def start(self) -> None:
        self._session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10, connect=5)
        )

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    @property
    def session(self) -> aiohttp.ClientSession:
        if self._session is None:
            raise RuntimeError("identity session not started")
        return self._session

    # --- Status ------------------------------------------------------------

    async def reachable(self, max_age: float = 10.0) -> bool:
        """The app checks the realm at most once every 10 seconds."""
        now = time.monotonic()
        if self._status_ok is not None and now - self._status_checked_at <= max_age:
            return self._status_ok
        async with self._status_lock:
            now = time.monotonic()
            if self._status_ok is not None and now - self._status_checked_at <= max_age:
                return self._status_ok
            ok = False
            try:
                url = f"{self.cfg.auth_issuer_url}/.well-known/openid-configuration"
                async with self.session.get(url) as resp:
                    ok = resp.status == 200
            except Exception:
                ok = False
            self._status_ok = ok
            self._status_checked_at = time.monotonic()
            return ok

    def invalidate_status(self) -> None:
        self._status_ok = None
        self._status_checked_at = 0.0

    # --- Admin token ---------------------------------------------------------

    async def _admin(self) -> str:
        """A client-credentials token for the confidential client's service account."""
        if self._admin_token is not None and time.monotonic() - self._admin_token_at < 45:
            return self._admin_token
        data = {
            "grant_type": "client_credentials",
            "client_id": self.cfg.auth_client_id,
            "client_secret": self.cfg.auth_client_secret,
        }
        try:
            async with self.session.post(
                self.token_endpoint,
                data=data,
                headers={"Accept": "application/json"},
            ) as resp:
                if resp.status != 200:
                    raise IdentityError(f"admin token failed: {resp.status}")
                payload = await resp.json()
        except IdentityError:
            self.invalidate_status()
            raise
        except Exception as exc:
            self.invalidate_status()
            raise IdentityError(str(exc))
        token = payload.get("access_token")
        if not token:
            raise IdentityError("admin token missing access_token")
        self._admin_token = token
        self._admin_token_at = time.monotonic()
        return token

    @property
    def realm_admin_url(self) -> str:
        return f"{self.cfg.keycloak_url}/admin/realms/{self.cfg.keycloak_realm}"

    @property
    def token_endpoint(self) -> str:
        return f"{self.cfg.auth_issuer_url}/protocol/openid-connect/token"

    @property
    def authorization_endpoint(self) -> str:
        return f"{self.cfg.auth_issuer_url}/protocol/openid-connect/auth"

    # --- Authorization code flow with PKCE ---------------------------------

    @staticmethod
    def make_pkce() -> tuple[str, str]:
        """Return (verifier, challenge) for PKCE S256."""
        verifier = base64.urlsafe_b64encode(os.urandom(48)).decode().rstrip("=")
        digest = hashlib.sha256(verifier.encode()).digest()
        challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
        return verifier, challenge

    def authorization_url(
        self,
        state: str,
        nonce: str,
        challenge: str,
        redirect_uri: str,
        scope: str = "openid",
    ) -> str:
        params = {
            "client_id": self.cfg.auth_client_id,
            "response_type": "code",
            "scope": scope,
            "state": state,
            "nonce": nonce,
            "redirect_uri": redirect_uri,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "kc_idp_hint": "",
        }
        params = {k: v for k, v in params.items() if v != ""}
        return f"{self.authorization_endpoint}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str, verifier: str) -> dict[str, Any]:
        """Exchange the authorization code for tokens."""
        data = {
            "grant_type": "authorization_code",
            "client_id": self.cfg.auth_client_id,
            "client_secret": self.cfg.auth_client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        }
        try:
            async with self.session.post(
                self.token_endpoint,
                data=data,
                headers={"Accept": "application/json"},
            ) as resp:
                payload = await resp.json(content_type=None)
                if resp.status != 200:
                    raise IdentityError(f"code exchange failed: {resp.status}")
        except IdentityError:
            self.invalidate_status()
            raise
        except Exception as exc:
            self.invalidate_status()
            raise IdentityError(str(exc))
        if "id_token" not in payload or "access_token" not in payload:
            raise IdentityError("token response missing tokens")
        return payload

    async def sign_out_url(self, id_token_hint: str) -> str:
        url = f"{self.cfg.auth_issuer_url}/protocol/openid-connect/logout"
        return f"{url}?id_token_hint={quote(id_token_hint)}"

    # --- Admin operations ----------------------------------------------------

    async def get_user_by_email(self, email: str) -> Optional[dict[str, Any]]:
        token = await self._admin()
        url = f"{self.realm_admin_url}/users"
        async with self.session.get(
            url,
            params={"username": email, "email": email, "exact": "true", "max": 5},
            headers={"Authorization": f"Bearer {token}"},
        ) as resp:
            if resp.status != 200:
                raise IdentityError(f"user lookup failed: {resp.status}")
            users = await resp.json()
        for user in users:
            if user.get("email", "").casefold() == email.casefold() or user.get("username", "").casefold() == email.casefold():
                return user
        return None

    async def ensure_user(
        self,
        email: str,
        password: str,
        first_name: str,
        temporary: bool,
        last_name: str = "",
    ) -> dict[str, Any]:
        """Create the user if missing; leave existing ones untouched."""
        existing = await self.get_user_by_email(email)
        if existing is not None:
            return existing
        token = await self._admin()
        payload = {
            "username": email,
            "email": email,
            "emailVerified": True,
            "enabled": True,
            "firstName": first_name,
            "lastName": last_name,
        }
        async with self.session.post(
            f"{self.realm_admin_url}/users",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        ) as resp:
            if resp.status not in (201, 204):
                raise IdentityError(f"user create failed: {resp.status}")
        user = await self.get_user_by_email(email)
        if user is None:
            raise IdentityError("created user not found")
        await self.set_password(user["id"], password, temporary)
        return user

    async def set_password(self, user_id: str, password: str, temporary: bool) -> None:
        token = await self._admin()
        payload = {"type": "password", "value": password, "temporary": temporary}
        async with self.session.put(
            f"{self.realm_admin_url}/users/{user_id}/reset-password",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        ) as resp:
            if resp.status not in (204, 201):
                raise IdentityError(f"set password failed: {resp.status}")

    async def upsert_contact_user(self, email: str, name: str, password: str) -> dict[str, Any]:
        """Create or update the contact's realm account with a temporary password.

        The realm's Verify Profile gate requires both name parts, so the contact
        name fills the first name and, when it holds several words, the last.
        """
        token = await self._admin()
        parts = name.strip().split(None, 1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else parts[0]
        existing = await self.get_user_by_email(email)
        if existing is None:
            payload = {
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": first_name,
                "lastName": last_name,
                "requiredActions": ["UPDATE_PASSWORD"],
            }
            async with self.session.post(
                f"{self.realm_admin_url}/users",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            ) as resp:
                if resp.status not in (201, 204):
                    raise IdentityError(f"contact create failed: {resp.status}")
            user = await self.get_user_by_email(email)
            if user is None:
                raise IdentityError("contact user not found after create")
        else:
            user = existing
            payload = {
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": first_name,
                "lastName": last_name,
                "requiredActions": ["UPDATE_PASSWORD"],
            }
            async with self.session.put(
                f"{self.realm_admin_url}/users/{user['id']}",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            ) as resp:
                if resp.status not in (204, 201):
                    raise IdentityError(f"contact update failed: {resp.status}")
        await self.set_password(user["id"], password, True)
        return user

    async def user_email_taken_by_other(self, email: str, allowed_user_ids: set[str]) -> bool:
        """Whether the email already belongs to a realm account outside the allowed set."""
        user = await self.get_user_by_email(email)
        if user is None:
            return False
        return user["id"] not in allowed_user_ids

    async def known_user_ids(self, emails: list[str]) -> set[str]:
        ids: set[str] = set()
        for email in emails:
            user = await self.get_user_by_email(email)
            if user is not None:
                ids.add(user["id"])
        return ids

    async def end_all_sessions(self, user_ids: list[str]) -> None:
        """End every realm session of the accounts, at once."""
        token = await self._admin()
        for user_id in user_ids:
            try:
                async with self.session.post(
                    f"{self.realm_admin_url}/users/{user_id}/logout",
                    headers={"Authorization": f"Bearer {token}"},
                ) as resp:
                    if resp.status not in (204, 201):
                        raise IdentityError(f"logout failed: {resp.status}")
            except Exception as exc:
                raise IdentityError(str(exc))

    async def verify_user_password(self, email: str, password: str) -> bool:
        """Check a password with the realm through the direct grant."""
        data = {
            "grant_type": "password",
            "client_id": self.cfg.auth_client_id,
            "client_secret": self.cfg.auth_client_secret,
            "username": email,
            "password": password,
        }
        try:
            async with self.session.post(
                self.token_endpoint,
                data=data,
                headers={"Accept": "application/json"},
            ) as resp:
                return resp.status == 200
        except Exception:
            raise IdentityError("realm unreachable")

    async def user_sessions_count(self, user_id: str) -> int:
        token = await self._admin()
        async with self.session.get(
            f"{self.realm_admin_url}/users/{user_id}/sessions",
            headers={"Authorization": f"Bearer {token}"},
        ) as resp:
            if resp.status != 200:
                raise IdentityError(f"sessions lookup failed: {resp.status}")
            data = await resp.json()
            return len(data)


def random_temporary_password() -> str:
    """A random temporary password of 16 letters and digits."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(16))
