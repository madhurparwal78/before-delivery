"""The page routes, rendered on the server and then followed live by the browser."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any, Callable, Awaitable

from jinja2 import Environment, FileSystemLoader, select_autoescape
from starlette.responses import Response

from .api.common import community_json
from .api.communities import (
    DIRECTORY_CATEGORIES,
    category_counts,
    clean_query_text,
    directory_results,
)
from .api.content import GAME_CATEGORIES, game_payload, trending_payload
from .app import Ctx
from .config import CONFIG
from .db import DB
from .errors import ApiError
from .users import ENTITLEMENTS

MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

CHIP_LABELS = {
    "all": "All",
    "gaming": "Gaming",
    "entertainment": "Entertainment",
    "education": "Education",
    "music": "Music",
    "science-and-tech": "Science and Tech",
}

GAME_CHIP_LABELS = {
    "all": "All",
    "adventure": "Adventure",
    "indie": "Indie",
    "simulation": "Simulation",
    "rpg": "RPG",
    "shooter": "Shooter",
    "fantasy": "Fantasy",
}

TRACKS = (
    {
        "title": "Night Shift Lo-fi",
        "src": "/static/media/tracks/night-shift-lofi.ogg",
        "length": "0:34",
        "note": "A slow loop for the hours when the lobby has gone quiet.",
    },
    {
        "title": "Aurora Drift",
        "src": "/static/media/tracks/aurora-drift.ogg",
        "length": "0:28",
        "note": "Bright keys for the run up to a raid night.",
    },
    {
        "title": "Ronin Rain",
        "src": "/static/media/tracks/ronin-rain.ogg",
        "length": "0:41",
        "note": "Low strings and rain for long strategy sessions.",
    },
)

SAFETY_PAGES: dict[str, dict[str, Any]] = {
    "safety-family-center": {
        "title": "Family Center",
        "heading": "FAMILY CENTER",
        "summary": "Set up a young player's first communities together, and agree what good looks like.",
        "sections": [
            {
                "title": "Start in the channel list",
                "body": "Read the channel list together before joining. A community that keeps "
                        "announcements separate from chatter is usually a community with owners "
                        "who are paying attention.",
            },
            {
                "title": "Mute, do not leave",
                "body": "Muting a community keeps mentions and replies arriving while the "
                        "ordinary chatter stays out of the inbox.",
            },
        ],
    },
    "safety-news": {
        "title": "Safety News",
        "heading": "SAFETY NEWS",
        "summary": "What changed recently in moderation tools, permissions and reporting.",
        "sections": [
            {
                "title": "Ranked roles",
                "body": "Moderators can now only act on members ranked below their own highest "
                        "role, and the server checks that rank at the moment of every action.",
            },
            {
                "title": "Server-timed time-outs",
                "body": "A time-out ends when the server's clock says so, whatever the clock on "
                        "the member's own device reads.",
            },
        ],
    },
    "safety-teen-charter": {
        "title": "Teen Charter",
        "heading": "TEEN CHARTER",
        "summary": "Four promises we make to younger members, and what each one means in practice.",
        "sections": [
            {
                "title": "Written for teens",
                "body": "Turn a card to read what the promise means when something goes wrong.",
            }
        ],
        "charter": [
            {
                "front": "Your address stays yours",
                "back": "Other members only ever see a public name and picture, never your email.",
            },
            {
                "front": "Reporting is private",
                "back": "A report goes to the owners of that community, and nobody else is told.",
            },
            {
                "front": "Blocking sticks",
                "back": "A member you block cannot reach you in any community you share.",
            },
            {
                "front": "You can leave at any time",
                "back": "Leaving a community removes you from its channels at once.",
            },
        ],
    },
    "safety-players-guide": {
        "title": "Players Guide",
        "heading": "PLAYERS GUIDE",
        "summary": "How to find a crew worth staying in, and how to leave one that is not.",
        "sections": [
            {
                "title": "Read before you post",
                "body": "Every community has its own rules channel. Read it first: the fastest "
                        "way to a time-out is posting in a channel meant for reading.",
            },
            {
                "title": "Keep invites short",
                "body": "Share invites that expire. An invite with an age stops working exactly "
                        "when it runs out.",
            },
        ],
    },
    "safety-parents": {
        "title": "Parents",
        "heading": "FOR PARENTS",
        "summary": "A plain explanation of what a community is, who can see it, and what you can set.",
        "sections": [
            {
                "title": "Who can see a channel",
                "body": "Channel permissions decide it. A channel a member cannot view never "
                        "appears in their channel list and can never mention them.",
            },
            {
                "title": "What we store",
                "body": "An address, a display name, a date of birth and the messages posted. "
                        "Nothing about a member is shown to others beyond a public name and "
                        "picture.",
            },
        ],
    },
}

PERKS = (
    ("Custom emoji anywhere", "custom_emoji"),
    ("Larger uploads", "larger_uploads"),
    ("Custom app icons", "custom_app_icons"),
    ("Longer messages", "longer_messages"),
)

ENV = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(["html"]),
)


def _thousands(value: Any) -> str:
    return f"{int(value):,}"


def _signed(value: Any) -> str:
    number = int(value)
    return f"+{number}%" if number >= 0 else f"{number}%"


def _week_label(value: str | date | None) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else value.isoformat()
    year, month, day = text.split("-")
    return f"{MONTHS[int(month) - 1]} {int(day)}, {year}"


ENV.filters["thousands"] = _thousands
ENV.filters["signed"] = _signed
ENV.filters["week_label"] = _week_label


def render(
    ctx: Ctx | None,
    template: str,
    *,
    title: str,
    page_id: str,
    field: str = "dark",
    status: int = 200,
    description: str = "Community Hub is a real-time community workspace for friend groups, "
    "gaming crews and fan communities.",
    headers: dict[str, str] | None = None,
    **context: Any,
) -> Response:
    locale = "en-US"
    if ctx is not None:
        locale = ctx.request.cookies.get("hub_locale", "en-US")
        if locale not in ("en-US", "en-GB", "de-DE", "nl-NL"):
            locale = "en-US"
    html = ENV.get_template(template).render(
        title=title,
        page_id=page_id,
        field=field,
        locale=locale,
        description=description,
        **context,
    )
    return Response(
        html.encode("utf-8"),
        status_code=status,
        media_type="text/html; charset=utf-8",
        headers=headers or {},
    )


def not_found_page() -> Response:
    return render(
        None,
        "not_found.html",
        title="Page not found",
        page_id="not-found",
        status=404,
        description="This page could not be found.",
    )


# --- page handlers --------------------------------------------------------


async def home(ctx: Ctx) -> Response:
    return render(ctx, "home.html", title="Group chat for every crew", page_id="home")


async def download(ctx: Ctx) -> Response:
    return render(ctx, "download.html", title="Download", page_id="download")


async def membership(ctx: Ctx) -> Response:
    perks = [
        {
            "name": name,
            "cells": [
                key in ENTITLEMENTS["free"],
                key in ENTITLEMENTS["basic"],
                key in ENTITLEMENTS["max"],
            ],
        }
        for name, key in PERKS
    ]
    return render(ctx, "membership.html", title="Membership", page_id="membership", perks=perks)


async def servers(ctx: Ctx) -> Response:
    query = ctx.query.get("q") or ""
    try:
        query = clean_query_text(query)
    except ApiError:
        query = ""
    category = ctx.query.get("category") or "all"
    if category not in DIRECTORY_CATEGORIES:
        category = "all"
    raw_page = ctx.query.get("page") or "1"
    page = int(raw_page) if raw_page.isdigit() and 1 <= int(raw_page) <= 1000 else 1

    async with DB.connection() as conn:
        results = await directory_results(conn, query, category, page, 12)
        counts = await category_counts(conn)
    total = results["total"]
    chips = [
        {"value": value, "label": CHIP_LABELS[value], "count": counts[value]}
        for value in DIRECTORY_CATEGORIES
    ]
    return render(
        ctx,
        "servers.html",
        title="Discover communities",
        page_id="servers",
        field="light",
        query=query,
        category=category,
        chips=chips,
        results=results,
        result_line=(
            "No communities match your search."
            if total == 0
            else "1 community" if total == 1 else f"{total} communities"
        ),
        has_previous=page > 1,
        has_next=page * 12 < total,
        previous_href=directory_href(query, category, page - 1),
        next_href=directory_href(query, category, page + 1),
    )


def directory_href(query: str, category: str, page: int) -> str:
    from urllib.parse import quote

    parts = []
    if query:
        parts.append("q=" + quote(query, safe=""))
    if category != "all":
        parts.append("category=" + category)
    if page > 1:
        parts.append(f"page={page}")
    return "/servers" + ("?" + "&".join(parts) if parts else "")


async def server_detail(ctx: Ctx) -> Response:
    async with DB.connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT c.*, c.member_baseline + (SELECT count(*) FROM memberships ms
                                             WHERE ms.community_id = c.id) AS member_count,
                   c.presence_baseline + (SELECT count(*) FROM memberships ms
                                          JOIN members mm ON mm.id = ms.member_id
                                          WHERE ms.community_id = c.id
                                            AND mm.status IN ('online','idle','dnd'))
                       AS presence_count
            FROM communities c WHERE c.slug = $1 AND c.published
            """,
            ctx.params["slug"],
        )
        if row is None:
            return not_found_page()
        channels = await conn.fetch(
            """
            SELECT name FROM channels WHERE community_id = $1 ORDER BY position, id
            """,
            row["id"],
        )
    community = community_json(row)
    return render(
        ctx,
        "server_detail.html",
        title=community["name"],
        page_id="server-detail",
        field="light",
        description=community["description"],
        community=community,
        channels=[{"name": channel["name"]} for channel in channels],
        join_requested=ctx.query.get("join") == "1",
    )


async def trending(ctx: Ctx) -> Response:
    category = ctx.query.get("category") or "all"
    week = ctx.query.get("week")
    async with DB.connection() as conn:
        try:
            payload = await trending_payload(conn, week, category, None)
        except ApiError:
            category = "all"
            payload = await trending_payload(conn, None, "all", None)
    chips = [
        {"value": value, "label": GAME_CHIP_LABELS[value]} for value in GAME_CATEGORIES
    ]
    return render(
        ctx,
        "trending.html",
        title="Trending games",
        page_id="trending",
        payload=payload,
        chips=chips,
        category=category,
    )


async def game(ctx: Ctx) -> Response:
    async with DB.connection() as conn:
        try:
            payload = await game_payload(conn, ctx.params["slug"], None)
        except ApiError:
            return not_found_page()
    return render(
        ctx,
        "game.html",
        title=payload["name"],
        page_id="game",
        description=payload["description"],
        game=payload,
    )


async def listening_room(ctx: Ctx) -> Response:
    return render(
        ctx, "listening.html", title="Listening room", page_id="listening", tracks=TRACKS
    )


async def support(ctx: Ctx) -> Response:
    return render(ctx, "support.html", title="Help Center", page_id="support")


async def support_new(ctx: Ctx) -> Response:
    return render(ctx, "support_new.html", title="Submit a request", page_id="support-new")


async def safety(ctx: Ctx) -> Response:
    entries = [
        {
            "href": f"/{slug}",
            "title": page["title"],
            "summary": page["summary"],
        }
        for slug, page in SAFETY_PAGES.items()
    ]
    entries.insert(
        1,
        {
            "href": "/safety-library",
            "title": "Safety Library",
            "summary": "Short articles about moderation, privacy and wellbeing.",
        },
    )
    return render(ctx, "safety.html", title="Safety Center", page_id="safety", entries=entries)


def safety_sub_page(slug: str) -> Callable[[Ctx], Awaitable[Response]]:
    async def handler(ctx: Ctx) -> Response:
        page = SAFETY_PAGES[slug]
        return render(
            ctx,
            "safety_sub.html",
            title=page["title"],
            page_id=slug,
            heading=page["heading"],
            summary=page["summary"],
            sections=page["sections"],
            charter=page.get("charter"),
        )

    return handler


async def safety_library(ctx: Ctx) -> Response:
    async with DB.connection() as conn:
        articles = await conn.fetch(
            "SELECT slug, title, category, topic, summary FROM safety_articles ORDER BY title"
        )
        categories = [
            row["category"]
            for row in await conn.fetch(
                "SELECT DISTINCT category FROM safety_articles ORDER BY category"
            )
        ]
        topics = [
            row["topic"]
            for row in await conn.fetch(
                "SELECT DISTINCT topic FROM safety_articles ORDER BY topic"
            )
        ]
    return render(
        ctx,
        "safety_library.html",
        title="Safety Library",
        page_id="safety-library",
        articles=[dict(row) for row in articles],
        categories=categories,
        topics=topics,
    )


async def safety_article(ctx: Ctx) -> Response:
    async with DB.connection() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM safety_articles WHERE slug = $1", ctx.params["slug"]
        )
    if row is None:
        return not_found_page()
    return render(
        ctx,
        "safety_article.html",
        title=row["title"],
        page_id="safety-article",
        description=row["summary"],
        article=dict(row),
    )


async def login(ctx: Ctx) -> Response:
    return render(ctx, "login.html", title="Log in", page_id="login")


async def register(ctx: Ctx) -> Response:
    return render(ctx, "register.html", title="Create an account", page_id="register")


async def verify_email(ctx: Ctx) -> Response:
    return render(
        ctx,
        "verify_email.html",
        title="Confirm your email",
        page_id="verify-email",
        headers={"Referrer-Policy": "no-referrer"},
    )


async def settings(ctx: Ctx) -> Response:
    return render(ctx, "settings.html", title="Settings", page_id="settings")


async def workspace(ctx: Ctx) -> Response:
    return render(
        ctx,
        "workspace.html",
        title="Workspace",
        page_id="workspace",
        community_id=ctx.params["community_id"],
        channel_id=ctx.params["channel_id"],
    )


# --- sitemap, robots and the favicon --------------------------------------


def _origin(ctx: Ctx) -> str:
    host = ctx.request.headers.get("host")
    if not host:
        return CONFIG.public_url
    scheme = CONFIG.public_origin.split("://")[0]
    return f"{scheme}://{host}"


async def sitemap(ctx: Ctx) -> Response:
    origin = _origin(ctx)
    paths = [
        "/", "/download", "/membership", "/servers", "/trending-games",
        "/listening-room", "/support", "/support/new", "/safety",
        "/safety-family-center", "/safety-library", "/safety-news",
        "/safety-teen-charter", "/safety-players-guide", "/safety-parents",
    ]
    async with DB.connection() as conn:
        paths += [
            f"/servers/{row['slug']}"
            for row in await conn.fetch(
                "SELECT slug FROM communities WHERE published ORDER BY slug"
            )
        ]
        paths += [
            f"/game/{row['slug']}"
            for row in await conn.fetch("SELECT slug FROM games ORDER BY slug")
        ]
        paths += [
            f"/safety-library/{row['slug']}"
            for row in await conn.fetch("SELECT slug FROM safety_articles ORDER BY slug")
        ]
    entries = "".join(f"<url><loc>{origin}{path}</loc></url>" for path in paths)
    body = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return Response(body.encode("utf-8"), media_type="application/xml")


async def robots(ctx: Ctx) -> Response:
    body = (
        "User-agent: *\n"
        "Disallow: /channels/\n"
        "Disallow: /settings\n"
        f"Sitemap: {_origin(ctx)}/sitemap.xml\n"
    )
    return Response(body.encode("utf-8"), media_type="text/plain; charset=utf-8")


async def favicon(ctx: Ctx) -> Response:
    data = (Path(__file__).parent / "static" / "media" / "favicon.ico").read_bytes()
    return Response(
        data,
        media_type="image/x-icon",
        headers={"Cache-Control": "public, max-age=86400"},
    )


PAGE_ROUTES: tuple[tuple[str, Callable[[Ctx], Awaitable[Response]]], ...] = (
    ("/", home),
    ("/download", download),
    ("/membership", membership),
    ("/servers", servers),
    ("/servers/{slug}", server_detail),
    ("/trending-games", trending),
    ("/game/{slug}", game),
    ("/listening-room", listening_room),
    ("/support", support),
    ("/support/new", support_new),
    ("/safety", safety),
    ("/safety-family-center", safety_sub_page("safety-family-center")),
    ("/safety-library", safety_library),
    ("/safety-library/{slug}", safety_article),
    ("/safety-news", safety_sub_page("safety-news")),
    ("/safety-teen-charter", safety_sub_page("safety-teen-charter")),
    ("/safety-players-guide", safety_sub_page("safety-players-guide")),
    ("/safety-parents", safety_sub_page("safety-parents")),
    ("/login", login),
    ("/register", register),
    ("/verify-email", verify_email),
    ("/channels/{community_id}/{channel_id}", workspace),
    ("/settings", settings),
)
