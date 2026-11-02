"""Keycloak: staff sign-in, token introspection, role checks and the two
seeded accounts (one place for every auth decision)."""
from __future__ import annotations

import hashlib

import httpx

from . import config

REVIEWER_EMAIL = config.SEED_REVIEWER_EMAIL
ANALYST_EMAIL = config.SEED_ANALYST_EMAIL
REALM_ROLE = config.REVIEWER_ROLE

_TIMEOUT = 10.0


class AuthUnavailable(Exception):
    """The auth service cannot be reached or refuses the request."""


class CredentialsInvalid(Exception):
    """The auth service rejected the credentials."""


def _base() -> str:
    return f"{config.KEYCLOAK_URL}/realms/{config.KEYCLOAK_REALM}"


def _admin_url(path: str) -> str:
    return f"{config.KEYCLOAK_URL}/admin/realms/{config.KEYCLOAK_REALM}{path}"


def _client() -> httpx.Client:
    return httpx.Client(timeout=_TIMEOUT)


def _service_account_token(client: httpx.Client) -> str:
    response = client.post(
        f"{_base()}/protocol/openid-connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": config.AUTH_CLIENT_ID,
            "client_secret": config.AUTH_CLIENT_SECRET,
        },
    )
    if response.status_code != 200:
        raise AuthUnavailable("service account token refused")
    return response.json()["access_token"]


def sign_in(email: str, password: str) -> dict:
    """Exchange credentials for the auth service's own access token."""
    with _client() as client:
        try:
            response = client.post(
                f"{_base()}/protocol/openid-connect/token",
                data={
                    "grant_type": "password",
                    "client_id": config.AUTH_CLIENT_ID,
                    "client_secret": config.AUTH_CLIENT_SECRET,
                    "username": email,
                    "password": password,
                },
            )
        except httpx.HTTPError as exc:
            raise AuthUnavailable("sign-in unreachable") from exc
    if response.status_code == 200:
        return response.json()
    if response.status_code in (400, 401, 403):
        raise CredentialsInvalid("invalid credentials")
    raise AuthUnavailable("sign-in refused")


def introspect(token: str) -> dict:
    """Token introspection, as the auth service reports it now."""
    with _client() as client:
        try:
            response = client.post(
                f"{_base()}/protocol/openid-connect/token/introspect",
                data={
                    "token": token,
                    "client_id": config.AUTH_CLIENT_ID,
                    "client_secret": config.AUTH_CLIENT_SECRET,
                },
            )
        except httpx.HTTPError as exc:
            raise AuthUnavailable("introspection unreachable") from exc
    if response.status_code != 200:
        raise AuthUnavailable("introspection refused")
    return response.json()


def _admin_request(client: httpx.Client, method: str, path: str,
                   **kwargs) -> httpx.Response:
    token = _service_account_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.request(
        method, _admin_url(path), headers=headers, **kwargs
    )
    if response.status_code == 401:
        token = _service_account_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        response = client.request(
            method, _admin_url(path), headers=headers, **kwargs
        )
    return response


def realm_role_mappings(user_id: str) -> list[str]:
    """The user's current realm role mappings (never decided from the token)."""
    with _client() as client:
        try:
            response = _admin_request(
                client, "GET", f"/users/{user_id}/role-mappings/realm"
            )
        except httpx.HTTPError as exc:
            raise AuthUnavailable("role lookup unreachable") from exc
    if response.status_code != 200:
        raise AuthUnavailable("role lookup refused")
    return [entry["name"] for entry in response.json()]


def end_session(session_id: str) -> None:
    """Sign out one session: the only admin write while serving."""
    with _client() as client:
        try:
            response = _admin_request(
                client, "DELETE", f"/sessions/{session_id}"
            )
        except httpx.HTTPError as exc:
            raise AuthUnavailable("sign-out unreachable") from exc
    if response.status_code not in (200, 204, 404):
        raise AuthUnavailable("sign-out refused")


def staff_email(token: str) -> dict | None:
    """The caller's email, user id and session id for an active token.

    A token the auth service has reported inactive stays refused: an account
    re-enabled in Keycloak never revives it (Business rules rule 12).
    """
    from . import db

    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM refused_tokens WHERE token_hash = %s", (digest,)
            )
            if cur.fetchone() is not None:
                return None
    data = introspect(token)
    if not data.get("active"):
        _record_refused_token(digest)
        return None
    if data.get("iss") != config.AUTH_ISSUER_URL:
        return None
    return {
        "email": data.get("email", ""),
        "user_id": data.get("sub", ""),
        "session_id": data.get("sid", ""),
    }


def _record_refused_token(digest: str) -> None:
    from . import db

    try:
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO refused_tokens (token_hash, refused_at)"
                    " VALUES (%s, now()) ON CONFLICT (token_hash) DO NOTHING",
                    (digest,),
                )
    except db.DatabaseUnavailable:
        pass


def seed() -> None:
    """Idempotently ensure the realm role and the two seeded accounts."""
    with _client() as client:
        role = _ensure_role(client)
        accounts = {
            REVIEWER_EMAIL: ("Partner", "Reviewer", True),
            ANALYST_EMAIL: ("Marketing", "Analyst", False),
        }
        for email, (first, last, assign) in accounts.items():
            user = _find_user(client, email)
            user_id = user["id"] if user else _create_user(
                client, email, first, last
            )
            _set_password(client, user_id)
            _assign_role(client, user_id, role["id"], assign)


def _ensure_role(client: httpx.Client) -> dict:
    response = _admin_request(client, "GET", "/roles")
    if response.status_code != 200:
        raise RuntimeError("role lookup refused")
    for entry in response.json():
        if entry["name"] == REALM_ROLE:
            return entry
    response = _admin_request(
        client, "POST", "/roles", json={"name": REALM_ROLE}
    )
    if response.status_code not in (201, 204, 409):
        raise RuntimeError("cannot create realm role")
    response = _admin_request(client, "GET", "/roles")
    for entry in response.json():
        if entry["name"] == REALM_ROLE:
            return entry
    raise RuntimeError("realm role missing after creation")


def _find_user(client: httpx.Client, email: str) -> dict | None:
    response = _admin_request(
        client, "GET", "/users", params={"email": email, "exact": True}
    )
    if response.status_code != 200:
        raise RuntimeError("user lookup refused")
    users = response.json()
    return users[0] if users else None


def _create_user(client: httpx.Client, email: str, first: str,
                 last: str) -> str:
    response = _admin_request(
        client,
        "POST",
        "/users",
        json={
            "username": email,
            "email": email,
            "firstName": first,
            "lastName": last,
            "enabled": True,
            "emailVerified": True,
            "requiredActions": [],
        },
    )
    if response.status_code not in (201, 204):
        raise RuntimeError("cannot create user")
    user = _find_user(client, email)
    if user is None:
        raise RuntimeError("user missing after creation")
    return user["id"]


def _set_password(client: httpx.Client, user_id: str) -> None:
    response = _admin_request(
        client,
        "PUT",
        f"/users/{user_id}/reset-password",
        json={
            "type": "password",
            "value": config.SEED_PASSWORD,
            "temporary": False,
        },
    )
    if response.status_code not in (201, 204):
        raise RuntimeError("cannot set password")


def _assign_role(client: httpx.Client, user_id: str, role_id: str,
                 assign: bool) -> None:
    mappings = _admin_request(
        client, "GET", f"/users/{user_id}/role-mappings/realm"
    )
    names = (
        {entry["name"] for entry in mappings.json()}
        if mappings.status_code == 200
        else set()
    )
    if assign and REALM_ROLE not in names:
        response = _admin_request(
            client,
            "POST",
            f"/users/{user_id}/role-mappings/realm",
            json=[{"id": role_id, "name": REALM_ROLE}],
        )
        if response.status_code not in (201, 204):
            raise RuntimeError("cannot assign role")
    if not assign and REALM_ROLE in names:
        response = _admin_request(
            client,
            "DELETE",
            f"/users/{user_id}/role-mappings/realm",
            json=[{"id": role_id, "name": REALM_ROLE}],
        )
        if response.status_code not in (204, 200):
            raise RuntimeError("cannot remove role")
