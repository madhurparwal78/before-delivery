"""Request helpers shared by every route."""

import functools
import json
import re
from datetime import datetime, timezone

from starlette.requests import Request

from .errors import invalid_body, not_found, payload_too_large
from .security import current_athlete

BODY_LIMIT_BYTES = 5_000_000
ID = re.compile(r"[0-9]{1,18}")


def parse_id(raw: str) -> int:
    """A record id from a route; anything that cannot name a record answers 404 before any query."""
    if not ID.fullmatch(raw):
        raise not_found()
    return int(raw)


def authenticated(handler):
    @functools.wraps(handler)
    async def wrapper(request: Request):
        return await handler(request, await current_athlete(request))
    return wrapper


async def read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdecimal() and int(declared) > BODY_LIMIT_BYTES:
        raise payload_too_large()
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > BODY_LIMIT_BYTES:
            raise payload_too_large()
        chunks.append(chunk)
    return b"".join(chunks)


async def read_json(request: Request, optional: bool = False) -> dict:
    """The JSON object in the request body; with `optional`, a missing body reads as an empty object."""
    raw = await read_body(request)
    if optional and not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except ValueError:
        raise invalid_body() from None
    if not isinstance(value, dict):
        raise invalid_body()
    return value


def iso(moment: datetime) -> str:
    """The instant as ISO 8601 text, always UTC and ending in Z."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def text_field(body: dict, name: str, low: int, high: int, fields: dict) -> str | None:
    """A string field of `low` to `high` characters; a failure is recorded in `fields`."""
    value = body.get(name)
    if not isinstance(value, str):
        fields[name] = f"{name} must be text of {low} to {high} characters"
        return None
    value = value.strip()
    if not low <= len(value) <= high:
        fields[name] = f"{name} must be {low} to {high} characters"
        return None
    return value
