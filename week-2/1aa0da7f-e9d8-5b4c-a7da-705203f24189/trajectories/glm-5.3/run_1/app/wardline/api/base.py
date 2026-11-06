"""API request pipeline: contexts, body reading, denials, serializers."""
from __future__ import annotations

import datetime
import json
from typing import Any

import psycopg
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .. import ledger, security
from ..errors import BODY_UNREADABLE, ApiError

JSON_BODY_LIMIT = 1_000_000
MULTIPART_LIMIT = 20_500_000
FILE_LIMIT = 20_000_000


async def read_json(request: Request) -> Any:
    """Read and parse a JSON object body, enforcing the limits."""
    length = int(request.headers.get("content-length") or 0)
    if length > JSON_BODY_LIMIT:
        raise ApiError(413, {"error": "body_too_large"})
    raw = await request.body()
    if len(raw) > JSON_BODY_LIMIT:
        raise ApiError(413, {"error": "body_too_large"})
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        raise ApiError(422, {"errors": {"body": BODY_UNREADABLE}})
    if not isinstance(parsed, dict):
        raise ApiError(422, {"errors": {"body": BODY_UNREADABLE}})
    return parsed


def db_ts(value: Any) -> str | None:
    if value is None:
        return None
    return value.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def lapse_text(value: Any) -> str:
    if value is None:
        return "Does not lapse"
    v = value.astimezone(datetime.timezone.utc)
    return f"Lapses {v.strftime('%Y-%m-%d %H:%M')} UTC"


def hhmm(value: Any) -> str:
    v = value.astimezone(datetime.timezone.utc)
    return v.strftime("%H:%M") + " UTC"
