"""Public content: the publication moment, list order, cursors and media files."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

from .config import CONFIG

DEFAULT_LIMIT = 10
MAX_LIMIT = 50

INTEGRATION_CATEGORIES = (
    "Collaboration",
    "CRM",
    "Calendar",
    "Desktop App",
    "Mobile",
    "Browser Extensions",
    "Storage",
    "Analytics",
    "Dialers",
    "Video Conferencing",
)

BLOG_CATEGORIES = (
    "Product Updates",
    "Sales",
    "Education",
    "Media",
    "Hiring",
    "Company",
)

PRESS_CATEGORIES = ("News", "Press Releases")

BLOG_LIST = "blog"
PRESS_LIST = "press"

_ARTICLE_PUBLIC = "published AND published_at <= now()"
_PRESS_PUBLIC = "published AND date <= (now() AT TIME ZONE 'UTC')::date"


class InvalidCursor(Exception):
    """The cursor is malformed, altered, or bound to another list or category."""


@dataclass(frozen=True)
class Cursor:
    list_name: str
    category: str | None
    position: str
    item_id: int


def encode_cursor(cursor: Cursor) -> str:
    payload = json.dumps(
        {
            "l": cursor.list_name,
            "c": cursor.category,
            "p": cursor.position,
            "i": cursor.item_id,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    body = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return f"{body}.{_signature(body)}"


def decode_cursor(raw: str, list_name: str, category: str | None) -> Cursor:
    body, _, signature = raw.partition(".")
    if not body or not signature or not hmac.compare_digest(signature, _signature(body)):
        raise InvalidCursor("cursor signature does not match")
    padded = body + "=" * (-len(body) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (binascii.Error, ValueError, UnicodeDecodeError) as exc:
        raise InvalidCursor("cursor does not decode") from exc
    if not isinstance(payload, dict):
        raise InvalidCursor("cursor is not an object")
    cursor = Cursor(
        list_name=str(payload.get("l")),
        category=payload.get("c"),
        position=str(payload.get("p")),
        item_id=int(payload.get("i", -1)),
    )
    if cursor.list_name != list_name or cursor.category != category:
        raise InvalidCursor("cursor belongs to another list or category")
    return cursor


def _signature(body: str) -> str:
    digest = hmac.new(
        CONFIG.auth_client_secret.encode("utf-8"),
        body.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest[:12]).decode("ascii").rstrip("=")


def parse_limit(raw: str | None) -> int:
    if raw is None:
        return DEFAULT_LIMIT
    if not raw.isdigit():
        raise ValueError("limit is not a positive integer")
    value = int(raw)
    if value < 1:
        raise ValueError("limit is not a positive integer")
    return min(value, MAX_LIMIT)


def integration_payload(row: Any) -> dict[str, Any]:
    return {
        "slug": row["slug"],
        "name": row["name"],
        "description": row["description"],
        "category": row["category"],
        "icon_ref": row["icon_ref"],
    }


def article_payload(row: Any) -> dict[str, Any]:
    return {
        "slug": row["slug"],
        "title": row["title"],
        "category": row["category"],
        "summary": row["summary"],
        "author": row["author"],
        "read_time": row["read_time"],
        "cover_ref": row["cover_ref"],
        "published_at": _iso(row["published_at"]),
    }


def press_payload(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "date": row["date"].isoformat(),
        "category": row["category"],
        "headline": row["headline"],
        "link": row["link"],
    }


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


async def list_integrations(connection: Any, category: str | None) -> list[dict[str, Any]]:
    rows = await connection.fetch(
        """
        SELECT slug, name, description, category, icon_ref
        FROM integrations
        WHERE published AND ($1::text IS NULL OR category = $1)
        ORDER BY name COLLATE "C", slug COLLATE "C"
        """,
        category,
    )
    return [integration_payload(row) for row in rows]


async def read_integration(connection: Any, slug: str) -> dict[str, Any] | None:
    row = await connection.fetchrow(
        """
        SELECT slug, name, description, category, icon_ref
        FROM integrations
        WHERE published AND slug = $1
        """,
        slug,
    )
    return integration_payload(row) if row is not None else None


async def list_articles(
    connection: Any,
    category: str | None,
    limit: int,
    cursor: Cursor | None,
) -> tuple[list[dict[str, Any]], str | None]:
    rows = await connection.fetch(
        f"""
        SELECT id, slug, title, category, summary, author, read_time, cover_ref,
               published_at
        FROM articles
        WHERE {_ARTICLE_PUBLIC}
          AND ($1::text IS NULL OR category = $1)
          AND ($2::timestamptz IS NULL
               OR published_at < $2
               OR (published_at = $2 AND id < $3))
        ORDER BY published_at DESC, id DESC
        LIMIT $4
        """,
        category,
        datetime.fromisoformat(cursor.position) if cursor is not None else None,
        cursor.item_id if cursor is not None else 0,
        limit + 1,
    )
    page = rows[:limit]
    items = [article_payload(row) for row in page]
    next_cursor = None
    if len(rows) > limit and page:
        last = page[-1]
        next_cursor = encode_cursor(
            Cursor(
                list_name=BLOG_LIST,
                category=category,
                position=last["published_at"].astimezone(timezone.utc).isoformat(),
                item_id=last["id"],
            )
        )
    return items, next_cursor


async def read_article(connection: Any, slug: str) -> dict[str, Any] | None:
    row = await connection.fetchrow(
        f"""
        SELECT slug, title, category, summary, author, read_time, cover_ref, body,
               published_at
        FROM articles
        WHERE {_ARTICLE_PUBLIC} AND slug = $1
        """,
        slug,
    )
    if row is None:
        return None
    payload = article_payload(row)
    payload["body"] = row["body"]
    return payload


async def list_press(
    connection: Any,
    category: str | None,
    limit: int,
    cursor: Cursor | None,
) -> tuple[list[dict[str, Any]], str | None]:
    rows = await connection.fetch(
        f"""
        SELECT id, date, category, headline, link
        FROM press_items
        WHERE {_PRESS_PUBLIC}
          AND ($1::text IS NULL OR category = $1)
          AND ($2::date IS NULL OR date < $2 OR (date = $2 AND id < $3))
        ORDER BY date DESC, id DESC
        LIMIT $4
        """,
        category,
        date.fromisoformat(cursor.position) if cursor is not None else None,
        cursor.item_id if cursor is not None else 0,
        limit + 1,
    )
    page = rows[:limit]
    items = [press_payload(row) for row in page]
    next_cursor = None
    if len(rows) > limit and page:
        last = page[-1]
        next_cursor = encode_cursor(
            Cursor(
                list_name=PRESS_LIST,
                category=category,
                position=last["date"].isoformat(),
                item_id=last["id"],
            )
        )
    return items, next_cursor


async def press_page(
    connection: Any,
    category: str | None,
    page: int,
    per_page: int = DEFAULT_LIMIT,
) -> tuple[list[dict[str, Any]], list[str | None], bool]:
    """One press page with the cursors that reach every page up to it."""
    wanted = page * per_page + 1
    rows = await connection.fetch(
        f"""
        SELECT id, date, category, headline, link
        FROM press_items
        WHERE {_PRESS_PUBLIC} AND ($1::text IS NULL OR category = $1)
        ORDER BY date DESC, id DESC
        LIMIT $2
        """,
        category,
        wanted,
    )
    cursors: list[str | None] = [None]
    for boundary in range(per_page - 1, min(len(rows), wanted - 1), per_page):
        cursors.append(
            encode_cursor(
                Cursor(
                    list_name=PRESS_LIST,
                    category=category,
                    position=rows[boundary]["date"].isoformat(),
                    item_id=rows[boundary]["id"],
                )
            )
        )
    start = (page - 1) * per_page
    items = [press_payload(row) for row in rows[start : start + per_page]]
    has_next = len(rows) > page * per_page
    return items, cursors, has_next


async def count_press(connection: Any, category: str | None) -> int:
    return int(
        await connection.fetchval(
            f"""
            SELECT count(*) FROM press_items
            WHERE {_PRESS_PUBLIC} AND ($1::text IS NULL OR category = $1)
            """,
            category,
        )
    )


async def read_integration_icon(connection: Any, slug: str) -> dict[str, Any] | None:
    """The published integration whose icon lives at this media path."""
    row = await connection.fetchrow(
        "SELECT slug, name FROM integrations WHERE published AND slug = $1",
        slug,
    )
    return {"slug": row["slug"], "name": row["name"]} if row is not None else None


async def read_article_cover(connection: Any, slug: str) -> dict[str, Any] | None:
    """The public article whose cover lives at this media path."""
    row = await connection.fetchrow(
        f"SELECT slug, title FROM articles WHERE {_ARTICLE_PUBLIC} AND slug = $1",
        slug,
    )
    return {"slug": row["slug"], "title": row["title"]} if row is not None else None


async def list_open_jobs(connection: Any) -> list[dict[str, Any]]:
    rows = await connection.fetch(
        "SELECT title, location FROM jobs WHERE is_open ORDER BY id",
    )
    return [{"title": row["title"], "location": row["location"]} for row in rows]


async def list_resource_cards(connection: Any) -> list[dict[str, Any]]:
    rows = await connection.fetch(
        """
        SELECT block, category, title, date, summary, target_link
        FROM resource_cards
        WHERE published
        ORDER BY id
        """,
    )
    return [
        {
            "block": row["block"],
            "category": row["category"],
            "title": row["title"],
            "date": row["date"].isoformat(),
            "summary": row["summary"],
            "target_link": row["target_link"],
        }
        for row in rows
    ]


def strong_etag(body: bytes) -> str:
    return '"' + hashlib.sha256(body).hexdigest()[:32] + '"'


def if_none_match_matches(header: str | None, etag: str) -> bool:
    """The If-None-Match rule: `*`, or a weak comparison against a listed tag."""
    if header is None:
        return False
    value = header.strip()
    if value == "*":
        return True
    for candidate in value.split(","):
        tag = candidate.strip()
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag == etag:
            return True
    return False
