"""Keycloak: the sign-in code exchange and the admin calls on users, credentials and sessions."""
from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Config

STATUS_TTL_S = 10
SEED_CHECK_S = 30


class RealmUnavailable(Exception):
    """The realm could not be reached or answered with a server error."""


@dataclass(frozen=True, slots=True)
class Identity:
    sub: str
    email: str
    name: str


class Realm:
    def __init__(self, config: Config) -> None:
        self._config = config
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(10, connect=3))
        self._token: tuple[str, float] | None = None
        self._status: tuple[bool, float] | None = None
        self._seed_checked = 0.0

    @property
    def _realm_base(self) -> str:
        return f"{self._config.keycloak_url}/realms/{self._config.keycloak_realm}"

    @property
    def _admin_base(self) -> str:
        return f"{self._config.keycloak_url}/admin/realms/{self._config.keycloak_realm}"

    def authorization_url(self) -> str:
        return f"{self._config.issuer_url}/protocol/openid-connect/auth"

    async def close(self) -> None:
        await self._http.aclose()

    async def _send(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self._http.request(method, url, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as error:
            self._status = (False, time.monotonic())  # nothing answered: the realm is unreachable
            raise RealmUnavailable(str(error)) from error
        except httpx.HTTPError as error:
            self._status = (True, time.monotonic())  # it accepted the connection: reachable, only this call failed
            raise RealmUnavailable(str(error)) from error
        if response.status_code >= 500:
            self._status = (False, time.monotonic())
            raise RealmUnavailable(f"{method} {url} answered {response.status_code}")
        self._status = (True, time.monotonic())
        return response

    # ------------------------------------------------------------------ status

    async def is_up(self) -> bool:
        """Checks the realm at most once every 10 seconds."""
        if self._status is not None and time.monotonic() - self._status[1] < STATUS_TTL_S:
            return self._status[0]
        try:
            await self._send("GET", f"{self._realm_base}/.well-known/openid-configuration")
        except RealmUnavailable:
            return bool(self._status and self._status[0])
        return True

    # ------------------------------------------------------------------ sign-in

    async def exchange_code(self, code: str, verifier: str, redirect_uri: str, nonce: str) -> Identity | None:
        """The identity in the ID token, or None when the code or nonce is refused."""
        response = await self._send("POST", f"{self._realm_base}/protocol/openid-connect/token", data={
            "grant_type": "authorization_code", "code": code, "code_verifier": verifier, "redirect_uri": redirect_uri,
            "client_id": self._config.client_id, "client_secret": self._config.client_secret})
        if response.status_code != 200:
            return None
        claims = _jwt_claims(response.json().get("id_token", ""))
        if claims.get("nonce") != nonce or claims.get("aud") not in (self._config.client_id, [self._config.client_id]):
            return None
        email = str(claims.get("email") or claims.get("preferred_username") or "").lower()
        name = str(claims.get("name") or claims.get("given_name") or email)
        return Identity(str(claims["sub"]), email, name)

    async def password_is(self, username: str, password: str) -> bool:
        response = await self._send("POST", f"{self._realm_base}/protocol/openid-connect/token", data={
            "grant_type": "password", "username": username, "password": password, "scope": "openid",
            "client_id": self._config.client_id, "client_secret": self._config.client_secret})
        return response.status_code == 200

    # ------------------------------------------------------------------ admin

    async def _admin(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if self._token is None or self._token[1] < time.monotonic():
            response = await self._send("POST", f"{self._realm_base}/protocol/openid-connect/token", data={
                "grant_type": "client_credentials", "client_id": self._config.client_id,
                "client_secret": self._config.client_secret})
            if response.status_code != 200:
                raise RealmUnavailable(f"service account token refused: {response.status_code}")
            body = response.json()
            self._token = (body["access_token"], time.monotonic() + float(body.get("expires_in", 60)) - 15)
        response = await self._send(method, f"{self._admin_base}{path}",
                                    headers={"Authorization": f"Bearer {self._token[0]}"}, **kwargs)
        if response.status_code >= 400 and response.status_code != 404 and response.status_code != 409:
            raise RealmUnavailable(f"{method} {path} answered {response.status_code}")
        return response

    async def find_user(self, email: str) -> dict[str, Any] | None:
        users = (await self._admin("GET", "/users", params={"email": email, "exact": "true"})).json()
        return next((u for u in users if (u.get("email") or "").lower() == email), None)

    async def put_contact(self, email: str, name: str, temporary_password: str, user_id: str | None) -> str:
        """Creates the contact's account, or resets the vault's previous contact account; returns its id."""
        profile = {"username": email, "email": email, "emailVerified": True, "enabled": True,
                   # The realm's user profile needs a last name to finish sign-in without an extra profile page.
                   "firstName": name, "lastName": name, "requiredActions": ["UPDATE_PASSWORD"]}
        credential = {"type": "password", "value": temporary_password, "temporary": True}
        if user_id is None:
            response = await self._admin("POST", "/users", json={**profile, "credentials": [credential]})
            if response.status_code != 201:
                raise RealmUnavailable(f"user create answered {response.status_code}")
            return response.headers["location"].rsplit("/", 1)[1]
        await self._admin("PUT", f"/users/{user_id}", json=profile)
        await self._admin("PUT", f"/users/{user_id}/reset-password", json=credential)
        return user_id

    async def set_password(self, user_id: str, password: str) -> None:
        await self._admin("PUT", f"/users/{user_id}/reset-password",
                          json={"type": "password", "value": password, "temporary": False})

    async def end_sessions(self, user_id: str) -> None:
        await self._admin("POST", f"/users/{user_id}/logout")

    async def ensure_seeded(self, accounts: tuple[tuple[str, str, str, str], ...]) -> dict[str, str]:
        """Creates any missing seeded account; returns every seeded email's user id. At most every 30 s."""
        if time.monotonic() - self._seed_checked < SEED_CHECK_S:
            return {}
        ids: dict[str, str] = {}
        for email, password, first, last in accounts:
            user = await self.find_user(email)
            if user is None:
                await self._admin("POST", "/users", json={
                    "username": email, "email": email, "emailVerified": True, "enabled": True,
                    "firstName": first, "lastName": last,
                    "credentials": [{"type": "password", "value": password, "temporary": False}]})
                user = await self.find_user(email)
            if user is not None:
                ids[email] = user["id"]
        self._seed_checked = time.monotonic()
        return ids


def _jwt_claims(token: str) -> dict[str, Any]:
    """The ID token arrives straight from the token endpoint over the client's own back channel."""
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return {}
