"""Request helpers shared by every route: the signed-in account, JSON bodies and response shapes."""

import datetime
import json
import uuid
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

from .errors import ApiError, not_found, unauthenticated, validation_failed
from .sessions import SESSION_COOKIE, Account, session_account

JSON_LIMIT = 65_536


async def require_account(request: Request) -> Account:
    """The account behind the request's session cookie; an unknown or expired session is 401."""
    token = request.cookies.get(SESSION_COOKIE)
    account = await session_account(request.app.state.db, token) if token else None
    if account is None:
        raise unauthenticated()
    return account


async def read_json(request: Request) -> dict[str, Any]:
    """The JSON object body: 413 above the limit, 415 for another content type, an empty body is `{}`."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > JSON_LIMIT:
        raise ApiError(413, "too_large")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > JSON_LIMIT:
            raise ApiError(413, "too_large")
    if not body:
        return {}
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise ApiError(415, "unsupported_media_type")
    try:
        parsed = json.loads(body)
    except ValueError as error:
        raise validation_failed({}) from error
    if not isinstance(parsed, dict):
        raise validation_failed({})
    return parsed


def parse_id(text: str) -> uuid.UUID:
    """A path or body id; anything that is not a UUID is an unknown id."""
    try:
        return uuid.UUID(text)
    except (ValueError, AttributeError, TypeError) as error:
        raise not_found() from error


def respond(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(data, status_code=status)


def iso(moment: datetime.datetime) -> str:
    return moment.astimezone(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

