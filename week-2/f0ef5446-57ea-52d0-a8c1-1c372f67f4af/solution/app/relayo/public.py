"""Public reads: the publication moment, list order, cursors, and the list tag."""

from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from werkzeug.datastructures import MultiDict
from werkzeug.wrappers import Request, Response

from . import db
from .http import JSON_TYPE, ApiError, json_text

INTEGRATION_CATEGORIES = (
    "Collaboration", "CRM", "Calendar", "Desktop App", "Mobile", "Browser Extensions", "Storage", "Analytics",
    "Dialers", "Video Conferencing",
)
BLOG_CATEGORIES = ("Product Updates", "Sales", "Education", "Media", "Hiring", "Company")
PRESS_CATEGORIES = ("News", "Press Releases")
DEFAULT_LIMIT = 10
LIMIT_CAP = 50
PRESS_PAGE_SIZE = 10

# The publication moment, decided here for lists, cursor walks, counts, tags, detail pages and media.
PUBLIC = {
    "integrations": "published",
    "articles": "published AND published_at <= now()",
    "press_items": "published AND date <= (now() AT TIME ZONE 'UTC')::date",
}


def utc_text(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def single(args: MultiDict[str, str], name: str, code: str) -> str | None:
    """A documented query parameter given more than once is refused with its own code."""
    values = args.getlist(name)
    if len(values) > 1:
        raise ApiError(400, code)
    return values[0] if values else None


def parse_limit(raw: str | None) -> int:
    if raw is None:
        return DEFAULT_LIMIT
    if not re.fullmatch(r"[0-9]+", raw) or int(raw) < 1:
        raise ApiError(400, "invalid_limit")
    return min(int(raw), LIMIT_CAP)


# Cursors -------------------------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Position:
    sort_value: str
    id: int


def _checksum(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()[:16]


def encode_cursor(list_name: str, category: str | None, position: Position) -> str:
    payload = json.dumps([list_name, category, position.sort_value, position.id], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=") + "." + _checksum(payload)


def decode_cursor(raw: str | None, list_name: str, category: str | None) -> Position | None:
    """A cursor is bound to its list and to the category it was issued under (none is a binding too)."""
    if raw is None:
        return None
    encoded, _, checksum = raw.partition(".")
    try:
        payload = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        decoded = json.loads(payload)
    except ValueError:
        raise ApiError(400, "invalid_cursor") from None
    if (_checksum(payload) != checksum or not isinstance(decoded, list) or len(decoded) != 4
            or decoded[:2] != [list_name, category] or not isinstance(decoded[2], str)
            or not isinstance(decoded[3], int) or isinstance(decoded[3], bool)):
        raise ApiError(400, "invalid_cursor")
    return Position(decoded[2], decoded[3])


# Lists ---------------------------------------------------------------------------------------------

def integration_item(row: dict[str, Any]) -> dict[str, Any]:
    return {key: row[key] for key in ("slug", "name", "description", "category", "icon_ref")}


def article_item(row: dict[str, Any]) -> dict[str, Any]:
    item = {key: row[key] for key in ("slug", "title", "category", "summary", "author", "read_time", "cover_ref")}
    item["published_at"] = utc_text(row["published_at"])
    return item


def press_item(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "date": row["date"].isoformat(), "category": row["category"],
            "headline": row["headline"], "link": row["link"]}


def integrations(conn: db.Connection, category: str | None) -> list[dict[str, Any]]:
    found = db.rows(conn, f"SELECT * FROM integrations WHERE {PUBLIC['integrations']} "
                          "AND (CAST(:category AS text) IS NULL OR category = :category) "
                          'ORDER BY name COLLATE "C", slug COLLATE "C"', category=category)
    return [integration_item(row) for row in found]


@dataclass(frozen=True, slots=True)
class Page:
    items: list[dict[str, Any]]
    next_cursor: str | None


LIST_SQL = {
    "blog": ("articles", "published_at", "CAST(:at AS timestamptz)"),
    "press": ("press_items", "date", "CAST(:at AS date)"),
}


def page_of(conn: db.Connection, list_name: str, binding: str | None, category: str | None, limit: int,
            after: Position | None) -> Page:
    """Keyset page in the list order (newest first, then id descending), strictly after the cursor."""
    table, column, cast = LIST_SQL[list_name]
    found = db.rows(
        conn,
        f"SELECT * FROM {table} WHERE {PUBLIC[table]} "
        "AND (CAST(:category AS text) IS NULL OR category = :category) "
        f"AND (CAST(:id AS integer) IS NULL OR ({column}, id) < ({cast}, :id)) "
        f"ORDER BY {column} DESC, id DESC LIMIT :fetch",
        category=category, at=after.sort_value if after else None, id=after.id if after else None, fetch=limit + 1,
    )
    shown = found[:limit]
    convert = article_item if list_name == "blog" else press_item
    next_cursor = None
    if len(found) > limit:
        last = shown[-1]
        next_cursor = encode_cursor(list_name, binding, Position(last[column].isoformat(), last["id"]))
    return Page([convert(row) for row in shown], next_cursor)


def press_filter(category: str | None) -> str | None:
    return None if category == "All" else category


def press_pages(conn: db.Connection, category: str | None, page: int) -> tuple[list[dict[str, Any]], list[str | None]]:
    """Items of press page `page` and the cursor that opens each page up to the next one."""
    cursors: list[str | None] = [None]
    items: list[dict[str, Any]] = []
    for _ in range(page):
        if len(cursors) > 1 and cursors[-1] is None:
            return [], cursors
        after = decode_cursor(cursors[-1], "press", category)
        found = page_of(conn, "press", category, press_filter(category), PRESS_PAGE_SIZE, after)
        items = found.items
        cursors.append(found.next_cursor)
    return items, cursors


def whole_blog(conn: db.Connection, category: str | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    after: Position | None = None
    while True:
        found = page_of(conn, "blog", category, category, LIMIT_CAP, after)
        items.extend(found.items)
        if found.next_cursor is None:
            return items
        after = decode_cursor(found.next_cursor, "blog", category)


def public_integration(conn: db.Connection, slug: str) -> dict[str, Any] | None:
    return db.one(conn, f"SELECT * FROM integrations WHERE slug = :slug AND {PUBLIC['integrations']}", slug=slug)


def public_article(conn: db.Connection, slug: str) -> dict[str, Any] | None:
    return db.one(conn, f"SELECT * FROM articles WHERE slug = :slug AND {PUBLIC['articles']}", slug=slug)


def open_jobs(conn: db.Connection) -> list[dict[str, Any]]:
    return db.rows(conn, "SELECT title, location FROM jobs WHERE is_open ORDER BY id")


def resource_cards(conn: db.Connection) -> list[dict[str, Any]]:
    return db.rows(conn, "SELECT block, category, title, date, summary, target_link FROM resource_cards "
                         "WHERE published ORDER BY id")


# The list tag -------------------------------------------------------------------------------------

_ENTITY_TAG = re.compile(r'\s*(?:W/)?"([^"]*)"\s*')


def list_tag(body: str) -> str:
    return '"' + hashlib.sha256(body.encode("utf-8")).hexdigest()[:32] + '"'


def tag_matches(header: str | None, tag: str) -> bool:
    """If-None-Match with weak comparison; a header that cannot be read is treated as absent."""
    if header is None:
        return False
    if header.strip() == "*":
        return True
    opaque = []
    for part in header.split(","):
        found = _ENTITY_TAG.fullmatch(part)
        if not found:
            return False
        opaque.append(found.group(1))
    return tag.strip('"') in opaque


def list_response(request: Request, payload: dict[str, Any]) -> Response:
    body = json_text(payload)
    tag = list_tag(body)
    headers = {"ETag": tag, "Cache-Control": "no-cache"}
    if tag_matches(request.headers.get("If-None-Match"), tag):
        return Response(status=304, headers=headers)
    return Response(body, status=200, headers=headers, content_type=JSON_TYPE)
