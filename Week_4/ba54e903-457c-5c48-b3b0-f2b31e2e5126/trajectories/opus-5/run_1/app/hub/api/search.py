"""Message search: terms, phrases and filters over the channels the caller may view."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from starlette.responses import Response

from ..app import Ctx
from ..db import DB
from ..errors import forbidden, invalid
from ..permissions import load_member_state, permissions_by_channel
from ..serialize import messages_in_order
from .common import community_row, is_member, json_response

FILTER_KEYS = ("from", "mentions", "in", "has", "before", "after", "during")
HAS_VALUES = ("link", "attachment", "image", "video")
ONCE_ONLY = ("before", "after", "during")


@dataclass
class SearchQuery:
    text_terms: list[str] = field(default_factory=list)
    authors: list[str] = field(default_factory=list)
    mentions: list[str] = field(default_factory=list)
    channels: list[str] = field(default_factory=list)
    has: list[str] = field(default_factory=list)
    before: date | None = None
    after: date | None = None
    during: date | None = None


def _split_terms(query: str) -> list[tuple[str, bool]]:
    """(term, is_phrase) pairs, splitting at whitespace outside double quotes."""
    terms: list[tuple[str, bool]] = []
    current: list[str] = []
    quoted = False
    was_quoted = False
    for character in query:
        if character == '"':
            if quoted:
                terms.append(("".join(current), True))
                current = []
                quoted = False
                was_quoted = True
            else:
                if current:
                    terms.append(("".join(current), False))
                    current = []
                quoted = True
            continue
        if character.isspace() and not quoted:
            if current:
                terms.append(("".join(current), False))
                current = []
            was_quoted = False
            continue
        current.append(character)
    if current:
        terms.append(("".join(current), quoted or was_quoted))
    return [(term, phrase) for term, phrase in terms if term]


def _read_date(value: str) -> date:
    if len(value) != 10:
        raise invalid("q")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise invalid("q") from None


def parse_query(raw: str) -> SearchQuery:
    parsed = SearchQuery()
    seen_once: set[str] = set()
    for term, is_phrase in _split_terms(raw):
        key, separator, value = term.partition(":")
        if is_phrase or not separator or key.lower() not in FILTER_KEYS or not value:
            parsed.text_terms.append(term)
            continue
        key = key.lower()
        if key in ONCE_ONLY:
            if key in seen_once:
                raise invalid("q")
            seen_once.add(key)
            setattr(parsed, key, _read_date(value))
        elif key == "from":
            parsed.authors.append(value.lower())
        elif key == "mentions":
            parsed.mentions.append(value.lower())
        elif key == "in":
            parsed.channels.append(value.lower())
        elif key == "has":
            if value.lower() not in HAS_VALUES:
                raise invalid("q")
            parsed.has.append(value.lower())
    if not any(
        [
            parsed.text_terms,
            parsed.authors,
            parsed.mentions,
            parsed.channels,
            parsed.has,
            parsed.before,
            parsed.after,
            parsed.during,
        ]
    ):
        raise invalid("q")
    return parsed


def whole_word_pattern(term: str) -> str:
    escaped = "".join(
        ch if ch.isalnum() else "\\" + ch for ch in term
    )
    return f"(^|[^[:alnum:]]){escaped}($|[^[:alnum:]])"


async def search_messages(ctx: Ctx) -> Response:
    assert ctx.caller is not None
    raw = ctx.query.get("q")
    if raw is None or not 1 <= len(raw) <= 200:
        raise invalid("q")
    parsed = parse_query(raw)
    limit = ctx.query.whole_number("limit", 25, 1, 25)
    offset = ctx.query.whole_number("offset", 0, 0, 2147483647)

    async with DB.connection() as conn:
        community = await community_row(conn, ctx.params["slug"], ctx.caller)
        if not await is_member(conn, community["id"], ctx.caller.id):
            raise forbidden()
        state = await load_member_state(conn, community["id"], ctx.caller.id)
        channels = await conn.fetch(
            "SELECT id, name FROM channels WHERE community_id = $1 AND type = 'text'",
            community["id"],
        )
        ids = [row["id"] for row in channels]
        permissions = await permissions_by_channel(conn, ids, state) if ids else {}
        viewable = {
            row["id"]: row["name"]
            for row in channels
            if "view_channel" in permissions[row["id"]]
        }
        if parsed.channels:
            viewable = {
                channel_id: name
                for channel_id, name in viewable.items()
                if name.lower() in parsed.channels
            }
        if not viewable:
            return json_response({"total_results": 0, "data": []})

        conditions = ["m.channel_id = ANY($1::int[])"]
        args: list[Any] = [list(viewable)]

        for term in parsed.text_terms:
            args.append(whole_word_pattern(term))
            conditions.append(f"m.body ~* ${len(args)}")
        if parsed.authors:
            args.append(parsed.authors)
            conditions.append(f"lower(a.username) = ANY(${len(args)}::text[])")
        if parsed.mentions:
            args.append(parsed.mentions)
            conditions.append(
                f"""m.mentions && (SELECT COALESCE(array_agg(id), '{{}}') FROM members
                    WHERE lower(username) = ANY(${len(args)}::text[]))"""
            )
        for value in parsed.has:
            if value == "link":
                conditions.append(
                    "(position('http://' in m.body) > 0 OR position('https://' in m.body) > 0)"
                )
            elif value == "attachment":
                conditions.append("EXISTS (SELECT 1 FROM attachments x WHERE x.message_id = m.id)")
            else:
                args.append(f"{value}/%")
                conditions.append(
                    f"""EXISTS (SELECT 1 FROM attachments x WHERE x.message_id = m.id
                        AND x.content_type LIKE ${len(args)})"""
                )
        if parsed.before is not None:
            args.append(parsed.before)
            conditions.append(f"m.created_at < (${len(args)}::date)::timestamptz")
        if parsed.after is not None:
            args.append(parsed.after)
            conditions.append(f"m.created_at >= ((${len(args)}::date) + 1)::timestamptz")
        if parsed.during is not None:
            args.append(parsed.during)
            conditions.append(
                f"""m.created_at >= (${len(args)}::date)::timestamptz
                    AND m.created_at < ((${len(args)}::date) + 1)::timestamptz"""
            )

        where = " AND ".join(conditions)
        total = await conn.fetchval(
            f"""
            SELECT count(*) FROM messages m JOIN members a ON a.id = m.author_id WHERE {where}
            """,
            *args,
        )
        rows = await conn.fetch(
            f"""
            SELECT m.id FROM messages m JOIN members a ON a.id = m.author_id
            WHERE {where} ORDER BY m.id DESC LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
            """,
            *args,
            limit,
            offset,
        )
        data = await messages_in_order(conn, [row["id"] for row in rows], ctx.caller.id)
    return json_response({"total_results": int(total), "data": data})
