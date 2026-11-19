"""Trending games, the safety library, support requests and page views."""

from __future__ import annotations

import math
from datetime import date
from typing import Any

import asyncpg
from starlette.responses import Response

from ..app import Ctx
from ..config import CONFIG
from ..db import DB
from ..errors import invalid, not_found, rate_limited
from ..mail import queue_email
from ..times import calendar
from ..validation import bounded_text, clean_email
from .common import is_member, json_response, no_content

GAME_CATEGORIES = ("all", "adventure", "indie", "simulation", "rpg", "shooter", "fantasy")
TICKET_CATEGORIES = ("account", "billing", "safety", "other")


def _read_week(raw: str | None) -> date | None:
    if raw is None or raw == "":
        return None
    if len(raw) != 10:
        raise invalid("week")
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise invalid("week") from None


async def _community_for(
    conn: asyncpg.Connection, row: asyncpg.Record, viewer_id: int | None
) -> dict[str, Any] | None:
    """A community a non-member may not see while it is unpublished is not reported."""
    if row["community_id"] is None:
        return None
    community = await conn.fetchrow(
        """
        SELECT c.slug, c.name, c.published, c.id,
               c.member_baseline + (SELECT count(*) FROM memberships ms
                                    WHERE ms.community_id = c.id) AS member_count
        FROM communities c WHERE c.id = $1
        """,
        row["community_id"],
    )
    if community is None:
        return None
    if not community["published"] and not await is_member(conn, community["id"], viewer_id):
        return None
    return {
        "slug": community["slug"],
        "name": community["name"],
        "member_count": int(community["member_count"]),
    }


async def _weeks(conn: asyncpg.Connection) -> list[date]:
    rows = await conn.fetch("SELECT DISTINCT week_date FROM game_weeks ORDER BY week_date")
    return [row["week_date"] for row in rows]


async def _streak(
    conn: asyncpg.Connection, game_id: int, week: date, weeks: list[date]
) -> int:
    ranked = {
        row["week_date"]
        for row in await conn.fetch(
            "SELECT week_date FROM game_weeks WHERE game_id = $1", game_id
        )
    }
    index = weeks.index(week)
    streak = 0
    while index >= 0 and weeks[index] in ranked:
        streak += 1
        index -= 1
    return streak


async def _game_json(
    conn: asyncpg.Connection,
    row: asyncpg.Record,
    week: date,
    weeks: list[date],
    viewer_id: int | None,
) -> dict[str, Any]:
    return {
        "rank": row["rank"],
        "slug": row["slug"],
        "name": row["name"],
        "description": row["description"],
        "cover_url": f"/static/media/{row['cover_ref']}",
        "categories": list(row["categories"]),
        "plays_change_pct": row["plays_change_pct"],
        "streams_change_pct": row["streams_change_pct"],
        "week_streak": await _streak(conn, row["game_id"], week, weeks),
        "community": await _community_for(conn, row, viewer_id),
    }


async def trending_payload(
    conn: asyncpg.Connection, raw_week: str | None, category: str, viewer_id: int | None
) -> dict[str, Any]:
    """One trending week, shared by the API and the trending page."""
    week = _read_week(raw_week)
    if category not in GAME_CATEGORIES:
        raise invalid("category")
    weeks = await _weeks(conn)
    if not weeks:
        raise not_found()
    if week is None:
        week = weeks[-1]
    if week not in weeks:
        raise not_found()
    rows = await conn.fetch(
        """
        SELECT g.id AS game_id, g.slug, g.name, g.description, g.cover_ref, g.categories,
               g.community_id, w.rank, w.plays_change_pct, w.streams_change_pct
        FROM game_weeks w JOIN games g ON g.id = w.game_id
        WHERE w.week_date = $1 ORDER BY w.rank
        """,
        week,
    )
    games = [
        await _game_json(conn, row, week, weeks, viewer_id)
        for row in rows
        if category == "all" or category in row["categories"]
    ]
    index = weeks.index(week)
    return {
        "week_date": calendar(week),
        "prev_week_date": calendar(weeks[index - 1]) if index > 0 else None,
        "next_week_date": calendar(weeks[index + 1]) if index + 1 < len(weeks) else None,
        "games": games,
    }


async def trending_games(ctx: Ctx) -> Response:
    async with DB.connection() as conn:
        return json_response(
            await trending_payload(
                conn,
                ctx.query.get("week"),
                ctx.query.get("category", "all") or "all",
                ctx.caller.id if ctx.caller else None,
            )
        )


async def game_payload(
    conn: asyncpg.Connection, slug: str, viewer_id: int | None
) -> dict[str, Any]:
    """One game with its weekly history, shared by the API and the game page."""
    weeks = await _weeks(conn)
    if not weeks:
        raise not_found()
    latest = weeks[-1]
    row = await conn.fetchrow(
        """
        SELECT g.id AS game_id, g.slug, g.name, g.description, g.cover_ref, g.categories,
               g.community_id, w.rank, w.plays_change_pct, w.streams_change_pct
        FROM games g JOIN game_weeks w ON w.game_id = g.id AND w.week_date = $2
        WHERE g.slug = $1
        """,
        slug,
        latest,
    )
    if row is None:
        raise not_found()
    history = await conn.fetch(
        """
        SELECT week_date, rank, plays_change_pct, streams_change_pct
        FROM game_weeks WHERE game_id = $1 ORDER BY week_date DESC
        """,
        row["game_id"],
    )
    payload = await _game_json(conn, row, latest, weeks, viewer_id)
    return {
        **payload,
        "history": [
            {
                "week_date": calendar(entry["week_date"]),
                "rank": entry["rank"],
                "plays_change_pct": entry["plays_change_pct"],
                "streams_change_pct": entry["streams_change_pct"],
            }
            for entry in history
        ],
    }


async def read_game(ctx: Ctx) -> Response:
    async with DB.connection() as conn:
        return json_response(
            await game_payload(
                conn, ctx.params["slug"], ctx.caller.id if ctx.caller else None
            )
        )


async def safety_articles(ctx: Ctx) -> Response:
    query = ctx.query.get("q", "") or ""
    if len(query) > 256:
        raise invalid("q")
    category = ctx.query.get("category", "") or ""
    topic = ctx.query.get("topic", "") or ""
    async with DB.connection() as conn:
        rows = await conn.fetch(
            """
            SELECT slug, title, category, topic, summary FROM safety_articles
            WHERE ($1 = '' OR position(lower($1) in lower(title)) > 0
                   OR position(lower($1) in lower(summary)) > 0)
              AND ($2 = '' OR lower(category) = lower($2))
              AND ($3 = '' OR lower(topic) = lower($3))
            ORDER BY title
            """,
            query.strip(),
            category,
            topic,
        )
    return json_response(
        {
            "data": [
                {
                    "slug": row["slug"],
                    "title": row["title"],
                    "category": row["category"],
                    "topic": row["topic"],
                    "summary": row["summary"],
                }
                for row in rows
            ]
        }
    )


async def create_ticket(ctx: Ctx) -> Response:
    body = ctx.body()
    email = clean_email(body.raw("email"))
    refusal = None
    async with DB.transaction() as conn:
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext($1))", f"support:{email.lower()}"
        )
        row = await conn.fetchrow(
            """
            SELECT count(*) AS recent,
                   EXTRACT(EPOCH FROM (min(created_at) + make_interval(secs => $2)
                                       - clock_timestamp())) AS seconds_left
            FROM support_tickets
            WHERE lower(email) = lower($1)
              AND created_at > clock_timestamp() - make_interval(secs => $2)
            """,
            email,
            CONFIG.support_window_seconds,
        )
        if row["recent"] >= 3:
            seconds_left = int(math.ceil(float(row["seconds_left"] or 0)))
            refusal = rate_limited(
                max(1, min(CONFIG.support_window_seconds, seconds_left))
            )
        else:
            category = body.text("category")
            if category not in TICKET_CATEGORIES:
                raise invalid("category")
            subject = bounded_text(body, "subject", 3, 120)
            text = bounded_text(body, "body", 10, 5000)
            ticket_id = await conn.fetchval(
                """
                INSERT INTO support_tickets (reference, email, category, subject, body)
                VALUES ('', $1, $2, $3, $4) RETURNING id
                """,
                email,
                category,
                subject,
                text,
            )
            reference = f"HUB-{ticket_id:06d}"
            await conn.execute(
                "UPDATE support_tickets SET reference = $2 WHERE id = $1", ticket_id, reference
            )
            await queue_email(
                conn,
                recipient=email,
                subject=f"We received your request {reference}",
                body=(
                    f"Thank you for writing to Community Hub.\n"
                    f"Your reference is {reference}.\n"
                    f"Subject: {subject}\n"
                    "The support team answers in the order requests arrive.\n"
                ),
            )
    if refusal is not None:
        raise refusal
    return json_response({"id": ticket_id, "reference": reference, "status": "open"}, 201)


async def page_view(ctx: Ctx) -> Response:
    body = ctx.body()
    path = body.text("path")
    visitor_id = body.text("visitor_id")
    if not path or not visitor_id:
        raise invalid("path" if not path else "visitor_id")
    async with DB.transaction() as conn:
        await conn.execute(
            "INSERT INTO page_views (path, visitor_id) VALUES ($1, $2)", path[:500],
            visitor_id[:100],
        )
    return no_content()
