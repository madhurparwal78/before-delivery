"""Request plumbing: the two refusal shapes, body reading and the request store.

Every refusal in the product is produced here, so no framework default error body
ever reaches a client.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
from contextlib import contextmanager

from flask import Response, request

from .config import MAX_BODY_BYTES
from .db import DatabaseUnavailable, take_write_lock, transaction
from .domain.clock import helsinki_date, service_now
from .domain.references import ensure_run

NOT_FOUND = {"message": "Not found"}
METHOD_NOT_ALLOWED = {"message": "Method not allowed"}
BODY_NOT_OBJECT = {"errors": {"body": "Send a JSON object"}}
TOO_LARGE = {"message": "Request body too large"}
NEEDS_SESSION = {"message": "Sign in to use the desk"}
FORBIDDEN = {"message": "Your account cannot do this"}
OUTAGE = {"message": "The reference desk is unavailable right now"}
STALE = {"message": "This reference has changed since you opened it"}
MAX_DEPTH = 64

PREVIEW_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
}


class Refusal(Exception):
    """A refusal in one of the two published JSON shapes."""

    def __init__(self, status: int, payload: dict, headers: dict | None = None) -> None:
        super().__init__(status)
        self.status = status
        self.payload = payload
        self.headers = headers or {}


def json_response(payload, status: int = 200, headers: dict | None = None) -> Response:
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    return Response(body, status=status, mimetype="application/json", headers=headers or {})


def not_found() -> Refusal:
    return Refusal(404, NOT_FOUND)


def _max_depth(raw: bytes) -> int:
    depth = highest = 0
    in_string = escaped = False
    for byte in raw:
        if in_string:
            if escaped:
                escaped = False
            elif byte == 0x5C:
                escaped = True
            elif byte == 0x22:
                in_string = False
        elif byte == 0x22:
            in_string = True
        elif byte in (0x7B, 0x5B):
            depth += 1
            highest = max(highest, depth)
            if highest > MAX_DEPTH:
                return highest
        elif byte in (0x7D, 0x5D):
            depth -= 1
    return highest


def _reject_constant(_name):
    raise ValueError("not a finite number")


def raw_body() -> bytes:
    """The request body, refused as too large before anything else is read."""
    declared = request.content_length
    if declared is not None and declared > MAX_BODY_BYTES:
        raise Refusal(413, TOO_LARGE)
    raw = request.get_data(cache=True)
    if len(raw) > MAX_BODY_BYTES:
        raise Refusal(413, TOO_LARGE)
    return raw


def read_object(raw: bytes) -> dict:
    """The body as a JSON object. An empty or absent body reads as {}."""
    if not raw.strip():
        return {}
    if _max_depth(raw) > MAX_DEPTH:
        raise Refusal(422, BODY_NOT_OBJECT)
    try:
        text = raw.decode("utf-8")
        parsed = json.loads(text, parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise Refusal(422, BODY_NOT_OBJECT) from None
    if not isinstance(parsed, dict):
        raise Refusal(422, BODY_NOT_OBJECT)
    return parsed


@dataclasses.dataclass
class Store:
    """One open transaction with the reading of now it was answered against."""

    conn: object
    now: dt.datetime
    today: dt.date


@contextmanager
def store(*, write: bool = False):
    with transaction() as conn:
        if write:
            take_write_lock(conn)
        now = service_now(conn)
        today = helsinki_date(now)
        ensure_run(conn, today)
        yield Store(conn, now, today)


def raw_query() -> str:
    """The query string as it arrived, for the language links."""
    return request.query_string.decode("utf-8", "replace").replace("\x00", "")


def raw_query_for_header() -> str:
    return request.query_string.decode("latin-1")


def first_arg(name: str) -> str | None:
    """The first value of a repeated query parameter, exactly as it arrived."""
    values = request.args.getlist(name)
    return values[0] if values else None


__all__ = [
    "BODY_NOT_OBJECT",
    "DatabaseUnavailable",
    "FORBIDDEN",
    "METHOD_NOT_ALLOWED",
    "NEEDS_SESSION",
    "NOT_FOUND",
    "OUTAGE",
    "PREVIEW_HEADERS",
    "Refusal",
    "STALE",
    "Store",
    "first_arg",
    "json_response",
    "not_found",
    "raw_body",
    "raw_query",
    "raw_query_for_header",
    "read_object",
    "store",
]
