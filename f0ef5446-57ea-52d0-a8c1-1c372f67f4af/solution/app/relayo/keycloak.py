"""Keycloak: staff sign-in, the staff token and role checks, sign-out, and the seeded identities."""

from __future__ import annotations

import base64
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from werkzeug.wrappers import Request

from . import db
from .config import settings
from .http import ApiError

REVIEWER_ROLE = "partner-reviewer"


class AuthUnavailable(Exception):
    """Keycloak cannot be reached or answered with a server error."""


def _call(method: str, url: str, *, form: dict[str, str] | None = None, data: Any = None,
          token: str | None = None) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    payload = None
    if form is not None:
        payload = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        payload = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        with error:
            status, raw = error.code, error.read()
    except (urllib.error.URLError, OSError) as error:
        raise AuthUnavailable(str(error)) from error
    if status >= 500:
        raise AuthUnavailable(f"auth service answered {status}")
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, None


def _oidc(path: str) -> str:
    return f"{settings.auth_issuer_url}/protocol/openid-connect/{path}"


def _admin(path: str) -> str:
    return f"{settings.keycloak_url}/admin/realms/{urllib.parse.quote(settings.keycloak_realm)}{path}"


def _client() -> dict[str, str]:
    return {"client_id": settings.auth_client_id, "client_secret": settings.auth_client_secret}


class _ServiceAccount:
    """The `app` client's service-account token, reused until shortly before it expires."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token = ""
        self._expires = 0.0

    def forget(self) -> None:
        with self._lock:
            self._expires = 0.0

    def token(self) -> str:
        with self._lock:
            if time.monotonic() < self._expires:
                return self._token
            status, data = _call("POST", _oidc("token"), form={"grant_type": "client_credentials", **_client()})
            if status != 200 or not isinstance(data, dict):
                raise AuthUnavailable(f"service account token refused ({status})")
            self._token = data["access_token"]
            self._expires = time.monotonic() + max(5, int(data.get("expires_in", 60)) - 15)
            return self._token


service_account = _ServiceAccount()


def _admin_call(method: str, path: str, data: Any = None) -> tuple[int, Any]:
    result = _call(method, _admin(path), data=data, token=service_account.token())
    if result[0] != 401:
        return result
    service_account.forget()
    return _call(method, _admin(path), data=data, token=service_account.token())


# Sign-in -------------------------------------------------------------------------------------------

def password_grant(email: str, password: str) -> dict[str, Any] | None:
    """Exchange credentials through the confidential client; None when they are not accepted."""
    status, data = _call("POST", _oidc("token"),
                         form={"grant_type": "password", "username": email, "password": password, **_client()})
    if status == 200 and isinstance(data, dict):
        return data
    return None


# Staff token and role checks ----------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Staff:
    subject: str
    session: str
    email: str


def _unverified_claims(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    try:
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except ValueError:
        return {}
    return claims if isinstance(claims, dict) else {}


def unauthorized() -> ApiError:
    return ApiError(401, "unauthorized", {"WWW-Authenticate": "Bearer"})


def bearer_token(request: Request) -> str:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise unauthorized()
    return token.strip()


def _session_ended(session: str) -> bool:
    with db.connection() as conn:
        return db.one(conn, "SELECT 1 AS ended FROM ended_sessions WHERE sid = :sid", sid=session) is not None


def _end_session_of_disabled_account(claims: dict[str, Any]) -> None:
    """Keycloak revives a disabled account's tokens once it is enabled again; the brief says it never
    does. A token found inactive while its account is disabled has its session recorded as ended."""
    subject, session = claims.get("sub"), claims.get("sid")
    if not isinstance(subject, str) or not isinstance(session, str):
        return
    status, user = _admin_call("GET", f"/users/{urllib.parse.quote(subject, safe='')}")
    if status == 200 and isinstance(user, dict) and user.get("enabled") is False:
        with db.connection() as conn:
            conn.run("INSERT INTO ended_sessions (sid) VALUES (:sid) ON CONFLICT (sid) DO NOTHING", sid=session)


def authenticate(request: Request) -> Staff:
    """Step 2: the token must be one the auth service reports active right now."""
    token = bearer_token(request)
    claims = _unverified_claims(token)
    if isinstance(claims.get("sid"), str) and _session_ended(claims["sid"]):
        raise unauthorized()
    status, data = _call("POST", _oidc("token/introspect"), form={"token": token, **_client()})
    if status != 200 or not isinstance(data, dict):
        raise AuthUnavailable(f"introspection answered {status}")
    if data.get("active") is not True:
        _end_session_of_disabled_account(claims)
        raise unauthorized()
    return Staff(subject=str(data.get("sub", "")), session=str(data.get("sid", "")),
                 email=str(data.get("email") or data.get("username") or ""))


def authorize_reviewer(staff: Staff) -> None:
    """Step 3: the realm role is read from the auth service's current role mappings, every request."""
    status, roles = _admin_call("GET", f"/users/{urllib.parse.quote(staff.subject, safe='')}/role-mappings/realm/composite")
    if status != 200 or not isinstance(roles, list) or REVIEWER_ROLE not in {r.get("name") for r in roles}:
        raise ApiError(403, "forbidden")


def sign_out(staff: Staff) -> None:
    """End exactly the Keycloak session the presented token belongs to."""
    status, _ = _admin_call("DELETE", f"/sessions/{urllib.parse.quote(staff.session, safe='')}")
    if status not in (200, 204):
        raise unauthorized()


# Start-up seeding -----------------------------------------------------------------------------------

SEED_PASSWORD = "deku-demo-pw-2026"
SEED_ACCOUNTS = (
    ("reviewer@example.com", "Rena", "Vogel", True),
    ("analyst@example.com", "Arlo", "Brandt", False),
)


def _expect(result: tuple[int, Any], *accepted: int) -> Any:
    status, data = result
    if status not in accepted:
        raise AuthUnavailable(f"auth service answered {status} during seeding")
    return data


def _find_user(email: str) -> dict[str, Any] | None:
    found = _expect(_admin_call("GET", f"/users?{urllib.parse.urlencode({'email': email, 'exact': 'true'})}"), 200)
    return next((user for user in found if user.get("email") == email), None)


def seed_identities() -> None:
    """Ensure the role, both accounts with the seeded password, and the one role mapping."""
    _expect(_admin_call("POST", "/roles", {"name": REVIEWER_ROLE}), 201, 409)
    role = _expect(_admin_call("GET", f"/roles/{REVIEWER_ROLE}"), 200)
    for email, first_name, last_name, holds_role in SEED_ACCOUNTS:
        user = _find_user(email)
        if user is None:
            _expect(_admin_call("POST", "/users", {
                "username": email, "email": email, "firstName": first_name, "lastName": last_name,
                "enabled": True, "emailVerified": True, "requiredActions": [],
                "credentials": [{"type": "password", "value": SEED_PASSWORD, "temporary": False}],
            }), 201, 409)
            user = _find_user(email)
        base = f"/users/{user['id']}"
        credentials = _expect(_admin_call("GET", f"{base}/credentials"), 200)
        if not any(credential.get("type") == "password" for credential in credentials):
            _expect(_admin_call("PUT", f"{base}/reset-password",
                                {"type": "password", "value": SEED_PASSWORD, "temporary": False}), 204)
        mapped = {r.get("name") for r in _expect(_admin_call("GET", f"{base}/role-mappings/realm"), 200)}
        if holds_role and REVIEWER_ROLE not in mapped:
            _expect(_admin_call("POST", f"{base}/role-mappings/realm", [role]), 204)
        if not holds_role and REVIEWER_ROLE in mapped:
            _expect(_admin_call("DELETE", f"{base}/role-mappings/realm", [role]), 204)
