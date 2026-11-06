"""Keycloak: staff sign-in, token checks, role decisions, sign-out and seeding."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import CONFIG

REVIEWER_ROLE = "partner-reviewer"
SEEDED_PASSWORD = "deku-demo-pw-2026"

SEEDED_STAFF = (
    {
        "email": "reviewer@example.com",
        "first_name": "Rhona",
        "last_name": "Vale",
        "reviewer": True,
    },
    {
        "email": "analyst@example.com",
        "first_name": "Aurel",
        "last_name": "Nystrom",
        "reviewer": False,
    },
)


class AuthUnavailable(Exception):
    """Keycloak could not be reached, or answered in a way we cannot use."""


class InvalidCredentials(Exception):
    """Keycloak refused the presented email and password."""


@dataclass(frozen=True)
class StaffPrincipal:
    """A staff member the auth service reports as active right now."""

    user_id: str
    session_id: str
    email: str


@dataclass(frozen=True)
class SignInResult:
    access_token: str
    expires_in: int


class AuthService:
    """The one place that talks to Keycloak."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
        self._service_token: str | None = None
        self._service_token_expiry = 0.0
        self._token_lock = asyncio.Lock()

    async def close(self) -> None:
        await self._client.aclose()

    @property
    def _token_endpoint(self) -> str:
        return f"{CONFIG.auth_issuer_url}/protocol/openid-connect/token"

    @property
    def _introspect_endpoint(self) -> str:
        return f"{self._token_endpoint}/introspect"

    @property
    def _admin_base(self) -> str:
        return f"{CONFIG.keycloak_url}/admin/realms/{CONFIG.keycloak_realm}"

    async def sign_in(self, email: str, password: str) -> SignInResult:
        data = {
            "grant_type": "password",
            "client_id": CONFIG.auth_client_id,
            "client_secret": CONFIG.auth_client_secret,
            "username": email,
            "password": password,
            "scope": "openid profile email",
        }
        try:
            response = await self._client.post(self._token_endpoint, data=data)
        except httpx.HTTPError as exc:
            raise AuthUnavailable(str(exc)) from exc
        if response.status_code in (400, 401, 403):
            raise InvalidCredentials(email)
        if response.status_code != 200:
            raise AuthUnavailable(f"token endpoint answered {response.status_code}")
        payload = self._read_json(response)
        token = payload.get("access_token")
        expires_in = payload.get("expires_in")
        if not isinstance(token, str) or not isinstance(expires_in, int):
            raise AuthUnavailable("token endpoint answered without an access token")
        return SignInResult(access_token=token, expires_in=expires_in)

    async def holds_reviewer_role(self, user_id: str) -> bool:
        """Asked of Keycloak on every reviewer request, never cached."""
        mappings = await self._admin_request("GET", f"/users/{user_id}/role-mappings/realm")
        if not isinstance(mappings, list):
            raise AuthUnavailable("unreadable role mappings")
        return any(
            isinstance(mapping, dict) and mapping.get("name") == REVIEWER_ROLE
            for mapping in mappings
        )

    async def read_user(self, user_id: str) -> dict[str, Any] | None:
        user = await self._admin_request("GET", f"/users/{user_id}", allow_missing=True)
        return user if isinstance(user, dict) else None

    async def end_session(self, session_id: str) -> None:
        await self._admin_request("DELETE", f"/sessions/{session_id}", allow_missing=True)

    async def introspect(self, token: str) -> dict[str, Any] | None:
        """The token's claims while the auth service reports it active."""
        try:
            response = await self._client.post(
                self._introspect_endpoint,
                data={"token": token, "token_type_hint": "access_token"},
                auth=(CONFIG.auth_client_id, CONFIG.auth_client_secret),
            )
        except httpx.HTTPError as exc:
            raise AuthUnavailable(str(exc)) from exc
        if response.status_code != 200:
            raise AuthUnavailable(f"introspection answered {response.status_code}")
        claims = self._read_json(response)
        if claims.get("active") is not True:
            return None
        if claims.get("iss") != CONFIG.auth_issuer_url:
            return None
        return claims

    async def _service_access_token(self) -> str:
        async with self._token_lock:
            if self._service_token is not None and time.monotonic() < self._service_token_expiry:
                return self._service_token
            data = {
                "grant_type": "client_credentials",
                "client_id": CONFIG.auth_client_id,
                "client_secret": CONFIG.auth_client_secret,
            }
            try:
                response = await self._client.post(self._token_endpoint, data=data)
            except httpx.HTTPError as exc:
                raise AuthUnavailable(str(exc)) from exc
            if response.status_code != 200:
                raise AuthUnavailable(f"service account sign-in answered {response.status_code}")
            payload = self._read_json(response)
            token = payload.get("access_token")
            expires_in = payload.get("expires_in")
            if not isinstance(token, str) or not isinstance(expires_in, int):
                raise AuthUnavailable("service account sign-in answered without a token")
            self._service_token = token
            self._service_token_expiry = time.monotonic() + max(expires_in - 30, 5)
            return token

    async def _admin_request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: dict[str, str] | None = None,
        allow_missing: bool = False,
    ) -> Any:
        token = await self._service_access_token()
        url = f"{self._admin_base}{path}"
        try:
            response = await self._client.request(
                method,
                url,
                json=json_body,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
            if response.status_code == 401:
                self._service_token = None
                token = await self._service_access_token()
                response = await self._client.request(
                    method,
                    url,
                    json=json_body,
                    params=params,
                    headers={"Authorization": f"Bearer {token}"},
                )
        except httpx.HTTPError as exc:
            raise AuthUnavailable(str(exc)) from exc
        if response.status_code == 404 and allow_missing:
            return None
        if response.status_code == 409:
            return None
        if response.status_code >= 400:
            raise AuthUnavailable(f"admin {method} {path} answered {response.status_code}")
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise AuthUnavailable("admin call answered with unreadable JSON") from exc

    @staticmethod
    def _read_json(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise AuthUnavailable("auth service answered with unreadable JSON") from exc
        if not isinstance(payload, dict):
            raise AuthUnavailable("auth service answered with unexpected JSON")
        return payload

    async def ensure_seed_identities(self) -> None:
        """Idempotently ensure the realm role and the two seeded staff accounts."""
        await self._ensure_reviewer_role()
        role = await self._admin_request("GET", f"/roles/{REVIEWER_ROLE}")
        for staff in SEEDED_STAFF:
            user_id = await self._ensure_staff_account(staff)
            await self._admin_request(
                "PUT",
                f"/users/{user_id}/reset-password",
                json_body={"type": "password", "value": SEEDED_PASSWORD, "temporary": False},
            )
            await self._ensure_role_mapping(user_id, role, wanted=bool(staff["reviewer"]))

    async def _ensure_reviewer_role(self) -> None:
        existing = await self._admin_request("GET", f"/roles/{REVIEWER_ROLE}", allow_missing=True)
        if existing is None:
            await self._admin_request(
                "POST",
                "/roles",
                json_body={"name": REVIEWER_ROLE, "description": "Partner application reviewer"},
            )

    async def _ensure_staff_account(self, staff: dict[str, Any]) -> str:
        email = str(staff["email"])
        found = await self._find_user_id(email)
        if found is not None:
            return found
        await self._admin_request(
            "POST",
            "/users",
            json_body={
                "username": email,
                "email": email,
                "firstName": staff["first_name"],
                "lastName": staff["last_name"],
                "enabled": True,
                "emailVerified": True,
                "requiredActions": [],
            },
        )
        created = await self._find_user_id(email)
        if created is None:
            raise AuthUnavailable(f"could not seed the account {email}")
        return created

    async def _find_user_id(self, email: str) -> str | None:
        users = await self._admin_request(
            "GET",
            "/users",
            params={"username": email, "exact": "true"},
        )
        if not isinstance(users, list):
            return None
        for user in users:
            if isinstance(user, dict) and isinstance(user.get("id"), str):
                return str(user["id"])
        return None

    async def _ensure_role_mapping(self, user_id: str, role: Any, *, wanted: bool) -> None:
        holds = await self.holds_reviewer_role(user_id)
        if wanted and not holds:
            await self._admin_request(
                "POST",
                f"/users/{user_id}/role-mappings/realm",
                json_body=[{"id": role["id"], "name": REVIEWER_ROLE}],
            )
        elif not wanted and holds:
            await self._admin_request(
                "DELETE",
                f"/users/{user_id}/role-mappings/realm",
                json_body=[{"id": role["id"], "name": REVIEWER_ROLE}],
            )


AUTH = AuthService()
