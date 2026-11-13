"""Keycloak: every sign-in, the trusted contact's account and the ending of sessions."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import secrets
import string
import time
import urllib.parse
from dataclasses import dataclass

import httpx

from .config import IDENTITY_PROBE_SECONDS, Settings

log = logging.getLogger("strongroom.identity")

REQUEST_TIMEOUT = 3.0
TEMPORARY_PASSWORD_LENGTH = 16
PASSWORD_ALPHABET = string.ascii_letters + string.digits


class IdentityUnavailable(Exception):
    """The realm could not be reached or answered unexpectedly."""


class WrongPassword(Exception):
    """The realm rejected the credentials."""


@dataclass(frozen=True, slots=True)
class RealmUser:
    id: str
    email: str
    first_name: str


@dataclass(frozen=True, slots=True)
class SignedInPerson:
    realm_user_id: str
    email: str
    name: str


def new_temporary_password() -> str:
    return "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(TEMPORARY_PASSWORD_LENGTH))


def split_name(name: str) -> tuple[str, str]:
    parts = name.split()
    if len(parts) < 2:
        return name, name
    return parts[0], parts[-1]


class Identity:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
        self._reachable = True
        self._admin_token = ""
        self._admin_token_expires = 0.0
        self._probe_task: asyncio.Task[None] | None = None

    @property
    def reachable(self) -> bool:
        return self._reachable

    def start(self) -> None:
        self._probe_task = asyncio.create_task(self._probe_forever())

    async def stop(self) -> None:
        if self._probe_task is not None:
            self._probe_task.cancel()
        await self._client.aclose()

    async def _probe_forever(self) -> None:
        while True:
            try:
                response = await self._client.get(self._settings.openid_configuration)
                self._reachable = response.status_code == 200
            except asyncio.CancelledError:
                raise
            except Exception:
                self._reachable = False
            await asyncio.sleep(IDENTITY_PROBE_SECONDS)

    def _mark_down(self) -> IdentityUnavailable:
        self._reachable = False
        self._admin_token = ""
        return IdentityUnavailable()

    # -- sign-in -------------------------------------------------------------

    def authorization_url(
        self, state: str, nonce: str, challenge: str, redirect_uri: str
    ) -> str:
        query = urllib.parse.urlencode(
            {
                "client_id": self._settings.client_id,
                "response_type": "code",
                "scope": "openid email profile",
                "redirect_uri": redirect_uri,
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        return f"{self._settings.authorization_endpoint}?{query}"

    async def exchange_code(
        self, code: str, verifier: str, redirect_uri: str, nonce: str
    ) -> SignedInPerson | None:
        """Swap the code for tokens and read the identity out of the ID token."""
        try:
            response = await self._client.post(
                self._settings.token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": self._settings.client_id,
                    "client_secret": self._settings.client_secret,
                    "code_verifier": verifier,
                },
            )
        except Exception as exc:
            raise self._mark_down() from exc
        self._reachable = True
        if response.status_code != 200:
            return None
        claims = _id_token_claims(response.json().get("id_token", ""))
        if claims is None:
            return None
        if claims.get("iss") != self._settings.issuer_url:
            return None
        if claims.get("nonce") != nonce:
            return None
        audience = claims.get("aud")
        audiences = audience if isinstance(audience, list) else [audience]
        if self._settings.client_id not in audiences:
            return None
        email = str(claims.get("email") or "").strip().lower()
        if not email:
            return None
        name = str(
            claims.get("name")
            or " ".join(
                part
                for part in (claims.get("given_name"), claims.get("family_name"))
                if part
            )
            or email
        )
        return SignedInPerson(str(claims["sub"]), email, name)

    async def verify_password(self, email: str, password: str) -> None:
        """Check a password against the realm, as its own sign-in would."""
        try:
            response = await self._client.post(
                self._settings.token_endpoint,
                data={
                    "grant_type": "password",
                    "client_id": self._settings.client_id,
                    "client_secret": self._settings.client_secret,
                    "username": email,
                    "password": password,
                    "scope": "openid",
                },
            )
        except Exception as exc:
            raise self._mark_down() from exc
        self._reachable = True
        if response.status_code == 200:
            return
        if response.status_code in (400, 401):
            raise WrongPassword()
        raise self._mark_down()

    # -- realm administration ------------------------------------------------

    async def _token(self) -> str:
        if self._admin_token and time.monotonic() < self._admin_token_expires:
            return self._admin_token
        try:
            response = await self._client.post(
                self._settings.token_endpoint,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._settings.client_id,
                    "client_secret": self._settings.client_secret,
                },
            )
        except Exception as exc:
            raise self._mark_down() from exc
        if response.status_code != 200:
            raise self._mark_down()
        self._reachable = True
        payload = response.json()
        self._admin_token = payload["access_token"]
        self._admin_token_expires = time.monotonic() + max(payload.get("expires_in", 60) - 10, 5)
        return self._admin_token

    async def _admin(
        self, method: str, path: str, body: object | None = None, params: dict[str, str] | None = None
    ) -> httpx.Response:
        token = await self._token()
        try:
            response = await self._client.request(
                method,
                f"{self._settings.admin_base}{path}",
                json=body,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
        except Exception as exc:
            raise self._mark_down() from exc
        self._reachable = True
        if response.status_code >= 500:
            raise self._mark_down()
        return response

    async def find_user(self, email: str) -> RealmUser | None:
        response = await self._admin(
            "GET", "/users", params={"email": email, "exact": "true"}
        )
        if response.status_code != 200:
            raise self._mark_down()
        for found in response.json():
            if str(found.get("email", "")).lower() == email:
                return RealmUser(found["id"], email, found.get("firstName") or "")
        return None

    async def ensure_person(
        self, email: str, name: str, password: str, temporary: bool
    ) -> str:
        """Create the account when it is missing, then set the given password."""
        existing = await self.find_user(email)
        first, last = split_name(name)
        if existing is None:
            response = await self._admin(
                "POST",
                "/users",
                {
                    "username": email,
                    "email": email,
                    "emailVerified": True,
                    "enabled": True,
                    "firstName": first,
                    "lastName": last,
                    "credentials": [
                        {"type": "password", "value": password, "temporary": temporary}
                    ],
                },
            )
            if response.status_code == 201:
                return response.headers["Location"].rsplit("/", 1)[-1]
            if response.status_code != 409:
                raise self._mark_down()
            existing = await self.find_user(email)
            if existing is None:
                raise self._mark_down()
        await self._admin(
            "PUT",
            f"/users/{existing.id}",
            {
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": first,
                "lastName": last,
            },
        )
        await self.set_password(existing.id, password, temporary)
        return existing.id

    async def ensure_seeded_person(self, email: str, name: str, password: str) -> None:
        """Create a missing seeded account, and leave an existing one untouched."""
        if await self.find_user(email) is not None:
            return
        first, last = split_name(name)
        response = await self._admin(
            "POST",
            "/users",
            {
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": first,
                "lastName": last,
                "credentials": [{"type": "password", "value": password, "temporary": False}],
            },
        )
        if response.status_code not in (201, 409):
            raise self._mark_down()

    async def set_password(self, realm_user_id: str, password: str, temporary: bool) -> None:
        response = await self._admin(
            "PUT",
            f"/users/{realm_user_id}/reset-password",
            {"type": "password", "value": password, "temporary": temporary},
        )
        if response.status_code not in (200, 204):
            raise self._mark_down()

    async def end_sessions(self, realm_user_id: str) -> None:
        response = await self._admin("POST", f"/users/{realm_user_id}/logout")
        if response.status_code not in (200, 204):
            raise self._mark_down()


def _id_token_claims(id_token: str) -> dict[str, object] | None:
    parts = id_token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(claims, dict) or "sub" not in claims:
        return None
    expiry = claims.get("exp")
    if not isinstance(expiry, int) or expiry < time.time():
        return None
    return claims
