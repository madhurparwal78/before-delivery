"""Message search across the text channels of a community the caller may view."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from flask import g

from . import communities, db, messages
from .errors import invalid
from .router import route

QUERY_MAX = 200
FILTER_KEYS = ("from", "mentions", "in", "has", "before", "after", "during")
HAS_VALUES = ("link", "attachment", "image", "video")
_TERM = re.compile(r'"([^"]*)"|(\S+)')
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


@dataclass
class Parsed:
    texts: list[str] = field(default_factory=list)
    senders: list[str] = field(default_factory=list)
    mentioned: list[str] = field(default_factory=list)
    channels: list[str] = field(default_factory=list)
    has: list[str] = field(default_factory=list)
    dates: dict[str, date] = field(default_factory=dict)


def parse(query: str) -> Parsed:
    """Split a query into text terms and filters; any malformed filter refuses the whole query naming q."""
    parsed = Parsed()
    for found in _TERM.finditer(query):
        phrase, word = found.groups()
        if phrase is not None:
            if phrase:
                parsed.texts.append(phrase)
            continue
        key, colon, value = word.partition(":")
        key = key.lower()
        if not colon or key not in FILTER_KEYS:
            parsed.texts.append(word)
        elif key == "from":
            parsed.senders.append(value.lower())
        elif key == "mentions":
            parsed.mentioned.append(value.lower())
        elif key == "in":
            parsed.channels.append(value.lower())
        elif key == "has":
            if value.lower() not in HAS_VALUES:
                raise invalid("q")
            parsed.has.append(value.lower())
        else:
            if key in parsed.dates or not _DATE.fullmatch(value):
                raise invalid("q")
            try:
                parsed.dates[key] = date.fromisoformat(value)
            except ValueError:
                raise invalid("q") from None
    if not (parsed.texts or parsed.senders or parsed.mentioned or parsed.channels or parsed.has or parsed.dates):
        raise invalid("q")
    return parsed


def _midnight(day: date, offset: int = 0) -> datetime | str:
    try:
        return datetime.combine(day + timedelta(days=offset), datetime.min.time(), tzinfo=timezone.utc)
    except OverflowError:
        return "infinity"


def _word_pattern(term: str) -> str:
    return "(?<![[:alnum:]])" + re.sub(r"([\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f])", r"\\\1", term) + "(?![[:alnum:]])"


def conditions(parsed: Parsed) -> tuple[list[str], list]:
    where: list[str] = []
    args: list = []
    for term in parsed.texts:
        where.append("m.body ~* %s")
        args.append(_word_pattern(term))
    if parsed.senders:
        where.append("lower(a.username) = ANY(%s)")
        args.append(parsed.senders)
    if parsed.mentioned:
        where.append("EXISTS (SELECT 1 FROM members u WHERE u.id = ANY(m.mentions) AND lower(u.username) = ANY(%s))")
        args.append(parsed.mentioned)
    if parsed.channels:
        where.append("lower(c.name) = ANY(%s)")
        args.append(parsed.channels)
    if parsed.has:
        tests = {"link": "(m.body LIKE '%%http://%%' OR m.body LIKE '%%https://%%')",
                 "attachment": "EXISTS (SELECT 1 FROM attachments t WHERE t.message_id = m.id)",
                 "image": "EXISTS (SELECT 1 FROM attachments t WHERE t.message_id = m.id AND t.content_type LIKE 'image/%%')",
                 "video": "EXISTS (SELECT 1 FROM attachments t WHERE t.message_id = m.id AND t.content_type LIKE 'video/%%')"}
        where.append("(" + " OR ".join(tests[h] for h in dict.fromkeys(parsed.has)) + ")")
    if "before" in parsed.dates:
        where.append("m.created_at < %s")
        args.append(_midnight(parsed.dates["before"]))
    if "after" in parsed.dates:
        where.append("m.created_at >= %s")
        args.append(_midnight(parsed.dates["after"], 1))
    if "during" in parsed.dates:
        where.append("m.created_at >= %s AND m.created_at < %s")
        args.extend([_midnight(parsed.dates["during"]), _midnight(parsed.dates["during"], 1)])
    return where, args


@route("GET", "/api/servers/{slug}/messages/search", session="required")
def search(slug: str):
    me = g.member["id"]
    with db.tx() as cur:
        community, access = messages.member_community(cur, slug, me)
        text = g.query.string("q", "")
        if not 1 <= len(text) <= QUERY_MAX:
            raise invalid("q")
        limit = g.query.integer("limit", 25, 1, 25)
        offset = g.query.integer("offset", 0, 0, 1000000)
        parsed = parse(text)
        channel_ids = [c["id"] for c in communities.viewable_channels(cur, access) if c["type"] == "text"]
        where, args = conditions(parsed)
        clause = " AND ".join(["m.channel_id = ANY(%s)", *where])
        base = "FROM messages m JOIN members a ON a.id = m.author_id JOIN channels c ON c.id = m.channel_id WHERE "
        cur.execute("SELECT count(*) AS n " + base + clause, [channel_ids, *args])
        total = cur.fetchone()["n"]
        cur.execute("SELECT m.id " + base + clause + " ORDER BY m.id DESC LIMIT %s OFFSET %s",
                    [channel_ids, *args, limit, offset])
        ids = [row["id"] for row in cur.fetchall()]
        shaped = messages.load_messages(cur, ids, me)
        return {"total_results": total, "data": [shaped[i] for i in ids]}
