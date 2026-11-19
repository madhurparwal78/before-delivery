"""The weekly trending chart and game pages. Community counts are read live; an unpublished community
is shown only to its own members."""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from flask import g

from . import counts, db
from .errors import ApiError, invalid
from .router import route
from .trending_data import CATEGORIES, GAMES, RANKINGS, WEEKS

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _week_streak(slug: str, week: str) -> int:
    streak, day = 0, date.fromisoformat(week)
    while any(entry[0] == slug for entry in RANKINGS.get(day.isoformat(), ())):
        streak += 1
        day -= timedelta(days=7)
    return streak


def _communities(cur: db.Cursor, slugs: list[str]) -> dict[str, dict[str, Any]]:
    """Communities the caller may see, by slug: published ones, and any the caller belongs to."""
    member = getattr(g, "member", None)
    viewer = member["id"] if member else None
    cur.execute(
        f"SELECT k.slug, k.name, {counts.MEMBER_COUNT} AS member_count FROM communities k "
        "WHERE k.slug = ANY(%s) AND (k.published OR EXISTS (SELECT 1 FROM memberships ms "
        "WHERE ms.community_id = k.id AND ms.member_id = %s))", (slugs, viewer))
    return {row["slug"]: {"slug": row["slug"], "name": row["name"], "member_count": row["member_count"]}
            for row in cur.fetchall()}


def _game(slug: str, week: str, rank: int, plays: int, streams: int, visible: dict[str, dict]) -> dict[str, Any]:
    game = GAMES[slug]
    return {"rank": rank, "slug": slug, "name": game["name"], "description": game["description"],
            "cover_url": f"/static/art/cover/{slug}.svg", "categories": game["categories"],
            "plays_change_pct": plays, "streams_change_pct": streams, "week_streak": _week_streak(slug, week),
            "community": visible.get(game["community_slug"])}


def _week_games(cur: db.Cursor, week: str, category: str) -> list[dict[str, Any]]:
    visible = _communities(cur, sorted({g_["community_slug"] for g_ in GAMES.values()}))
    return [_game(slug, week, rank, plays, streams, visible)
            for rank, (slug, plays, streams) in enumerate(RANKINGS[week], start=1)
            if category == "all" or category in GAMES[slug]["categories"]]


@route("GET", "/api/trending-games", session="optional")
def trending() -> dict[str, Any]:
    week = g.query.string("week", WEEKS[0])
    if not _DATE.fullmatch(week):
        raise invalid("week")
    try:
        date.fromisoformat(week)
    except ValueError:
        raise invalid("week") from None
    category = g.query.choice("category", CATEGORIES, "all")
    if week not in RANKINGS:
        raise ApiError("not_found")
    return chart(week, category)


def chart(week: str, category: str) -> dict[str, Any]:
    """The chart answer for a week that exists in the rankings."""
    position = WEEKS.index(week)
    with db.tx() as cur:
        games = _week_games(cur, week, category)
    return {"week_date": week, "prev_week_date": WEEKS[position + 1] if position + 1 < len(WEEKS) else None,
            "next_week_date": WEEKS[position - 1] if position else None, "games": games}


def initial_chart(week: str | None, category: str | None) -> dict[str, Any] | None:
    """The answer the page script would ask for, for the address the visitor opened (read the way the script reads
    it), so the first paint already holds the chart; None when the API would refuse it."""
    week = week if week and _DATE.fullmatch(week) else WEEKS[0]
    if week not in RANKINGS:
        return None
    return chart(week, category if category in CATEGORIES else "all")


@route("GET", "/api/games/{slug}", session="optional")
def game_detail(slug: str) -> dict[str, Any]:
    if slug not in GAMES:
        raise ApiError("not_found")
    with db.tx() as cur:
        visible = _communities(cur, [GAMES[slug]["community_slug"]])
    history = [{"week_date": week, "rank": rank, "plays_change_pct": plays, "streams_change_pct": streams}
               for week in WEEKS
               for rank, (entry, plays, streams) in enumerate(RANKINGS[week], start=1) if entry == slug]
    latest = history[0]
    return {**_game(slug, latest["week_date"], latest["rank"], latest["plays_change_pct"],
                    latest["streams_change_pct"], visible), "history": history}
