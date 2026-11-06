"""The public lists: integrations, blog and press, with their ordering,
cursor paging, publication moment and conditional reads.

An item is public only from its publication moment on the database clock
(Business rules rule 13). A cursor is bound to the category it was issued
under, and a walk never repeats or skips an item that stays public.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json

from . import db

DEFAULT_LIMIT = 10
MAX_LIMIT = 50
_INVALID_ORDER = ("status", "sort", "category", "limit", "cursor")
_CODES = {
    "status": "invalid_status",
    "sort": "invalid_sort",
    "category": "invalid_category",
    "limit": "invalid_limit",
    "cursor": "invalid_cursor",
}


def handle(route: str, query: dict[str, list[str]], headers: dict[str, str]):
    from .api import ApiResponse, error_response

    documented = {"category"}
    if route in ("/api/blog", "/api/press"):
        documented |= {"limit", "cursor"}
    for name in _INVALID_ORDER:
        if name in documented and len(query.get(name, [])) > 1:
            return error_response(400, _CODES[name])
    category = _single(query.get("category"))
    if route == "/api/integrations":
        return _integrations(category, headers)
    limit = _limit(query.get("limit"))
    if isinstance(limit, str):
        return error_response(400, limit)
    cursor = _single(query.get("cursor"))
    if route == "/api/blog":
        return _blog(category, limit, cursor, headers)
    return _press(category, limit, cursor, headers)


def _single(values: list[str] | None) -> str | None:
    return values[0] if values else None


def _limit(values: list[str] | None) -> int | str:
    raw = _single(values)
    if raw is None:
        return DEFAULT_LIMIT
    if not raw.isdigit() or int(raw) < 1:
        return "invalid_limit"
    return min(int(raw), MAX_LIMIT)


def _integrations(category: str | None, headers: dict[str, str]):
    from .api import ApiResponse

    items = _integration_items(category)
    return _conditional(ApiResponse.json({"items": items}), headers)


def _integration_items(category: str | None) -> list[dict[str, str]]:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT slug, name, description, category, icon_ref"
                " FROM integrations WHERE published = TRUE"
            )
            rows = cur.fetchall()
    items = [
        {"slug": slug, "name": name, "description": description,
         "category": item_category, "icon_ref": icon_ref}
        for slug, name, description, item_category, icon_ref in rows
        if category is None or item_category == category
    ]
    items.sort(key=lambda item: (item["name"], item["slug"]))
    return items


def _public_rows(sql: str, params: tuple) -> list[tuple]:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def _blog(category: str | None, limit: int, cursor: str | None,
          headers: dict[str, str]):
    from .api import ApiResponse, error_response

    rows = _public_rows(
        "SELECT slug, title, category, summary, author, read_time, cover_ref,"
        " published_at, id FROM articles WHERE published = TRUE"
        " AND published_at <= now()"
        + (" AND category = %s" if category else "")
        + " ORDER BY published_at DESC, id DESC",
        (category,) if category else (),
    )
    positions = [(_iso(row[7]), row[8]) for row in rows]
    start = _start_position(cursor, "blog", category, positions)
    if start is None and cursor is not None:
        return error_response(400, "invalid_cursor")
    window = positions[start:]
    items = []
    for index in window[:limit]:
        row = rows[positions.index(index)]
        items.append({
            "slug": row[0], "title": row[1], "category": row[2],
            "summary": row[3], "author": row[4], "read_time": row[5],
            "cover_ref": row[6], "published_at": _iso(row[7]),
        })
    next_cursor = None
    if len(window) > limit:
        last = window[limit - 1]
        next_cursor = _encode_cursor("blog", category, last)
    return _conditional(
        ApiResponse.json({"items": items, "next_cursor": next_cursor}),
        headers,
    )


def _press(category: str | None, limit: int, cursor: str | None,
           headers: dict[str, str]):
    from .api import ApiResponse, error_response

    if category == "All":
        category = None
    rows = _public_rows(
        "SELECT id, date, category, headline, link FROM press_items"
        " WHERE published = TRUE AND date <= current_date"
        + (" AND category = %s" if category else "")
        + " ORDER BY date DESC, id DESC",
        (category,) if category else (),
    )
    positions = [(row[1].isoformat(), row[0]) for row in rows]
    start = _start_position(cursor, "press", category, positions)
    if start is None and cursor is not None:
        return error_response(400, "invalid_cursor")
    window = positions[start:]
    items = []
    for position in window[:limit]:
        index = positions.index(position)
        row = rows[index]
        items.append({
            "id": row[0], "date": row[1].isoformat(), "category": row[2],
            "headline": row[3], "link": row[4],
        })
    next_cursor = None
    if len(window) > limit:
        last = window[limit - 1]
        next_cursor = _encode_cursor("press", category, last)
    return _conditional(
        ApiResponse.json({"items": items, "next_cursor": next_cursor}),
        headers,
    )


def _start_position(cursor: str | None, kind: str, binding: str | None,
                   positions: list[tuple]) -> int:
    """The index of the first position strictly after the cursor's."""
    if cursor is None:
        return 0
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        if len(payload) != 4 or payload[0] != kind or payload[1] != binding:
            return None
        target = (payload[2], payload[3])
    except (ValueError, TypeError):
        return None
    for index, position in enumerate(positions):
        if position < target:
            return index
    return len(positions)


def _encode_cursor(kind: str, binding: str | None, last: tuple) -> str:
    payload = json.dumps([kind, binding, last[0], last[1]]).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _iso(moment: dt.datetime) -> str:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.timezone.utc)
    return moment.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _conditional(response, headers: dict[str, str]):
    """A strong ETag, no-cache, and a 304 with no body on a matching
    If-None-Match. The tag changes exactly when the body changes."""
    tag = hashlib.sha256(response.body).hexdigest()[:32]
    etag = f'"{tag}"'
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    if _matches(headers.get("if-none-match", ""), etag):
        return type(response)(
            304, b"", {"ETag": etag, "Cache-Control": "no-cache"}
        )
    return response


def _matches(header: str, etag: str) -> bool:
    header = header.strip()
    if not header:
        return False
    if header == "*":
        return True
    for entry in header.split(","):
        candidate = entry.strip()
        if candidate.startswith("W/"):
            candidate = candidate[2:].strip()
        if candidate == etag:
            return True
    return False
