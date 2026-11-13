"""Server-rendered pages: the public marketing pages, and the shells of the signed-in pages."""

import math
from datetime import timedelta
from pathlib import Path
from zoneinfo import available_timezones

from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route
from starlette.templating import Jinja2Templates

from . import db
from .calendar import month_window
from .content import CAPTAINS, PAGE_SIZE, STORIES

templates = Jinja2Templates(directory=Path(__file__).with_name("templates"))
CHIPS = [("run", "Run", "run"), ("ride", "Ride", "ride"), ("swim", "Swim", "swim"), ("walk", "Walk", "walk"),
         ("hike", "Hike", "hike"), ("workout", "Workout", "workout"), ("distance", "Distance", None),
         ("elevation-gain", "Elevation Gain", None), ("moving-time", "Moving Time", None)]
HERO_CAPTIONS = "WEBVTT\n\n00:00:00.000 --> 00:00:06.000\nRiders set off together from the start line.\n"


def render(request: Request, name: str, status: int = 200, **context) -> Response:
    return templates.TemplateResponse(request, name, context, status_code=status)


def not_found_page(request: Request) -> Response:
    return render(request, "not_found.html", 404)


def static_page(template: str, **context):
    async def page(request: Request) -> Response:
        return render(request, template, **context)
    return page


async def challenges_page(request: Request) -> Response:
    rows = await db.pool.fetch("SELECT id, name, sport_types, dimension, goal FROM challenges ORDER BY id")
    first, following = month_window("UTC")
    last_day = following - timedelta(days=1)
    return render(request, "challenges.html", challenges=[dict(r) for r in rows], chips=CHIPS,
                  range_text=f"{first:%b} {first.day} to {last_day:%b} {last_day.day}, {last_day.year}")


async def whats_new_page(request: Request) -> Response:
    query = request.query_params.get("q", "").strip()
    matching = [(title, excerpt, i) for i, (title, excerpt) in enumerate(STORIES) if query.lower() in title.lower()]
    pages = max(1, math.ceil(len(matching) / PAGE_SIZE))
    raw = request.query_params.get("page", "1")
    page = min(max(int(raw), 1), pages) if raw.isdecimal() else 1
    return render(request, "whats_new.html", stories=matching[(page - 1) * PAGE_SIZE:page * PAGE_SIZE], q=query,
                  page=page, pages=pages)


def zone_choices() -> list[str]:
    names = sorted(z for z in available_timezones() if "/" in z and not z.startswith(("Etc/", "SystemV/", "posix", "right")))
    return ["UTC", *names]


async def privacy_page(request: Request) -> Response:
    return render(request, "privacy.html", zones=zone_choices())




async def hero_captions(request: Request) -> Response:
    return Response(HERO_CAPTIONS, media_type="text/vtt")


routes = [
    Route("/", static_page("home.html")),
    Route("/features", static_page("features.html")),
    Route("/maps", static_page("maps.html")),
    Route("/challenges", challenges_page),
    Route("/subscribe", static_page("subscribe.html")),
    Route("/family", static_page("family.html")),
    Route("/student", static_page("student.html")),
    Route("/bulk-subscriptions", static_page("bulk.html")),
    Route("/about", static_page("about.html", captains=CAPTAINS)),
    Route("/whats-new", whats_new_page),
    Route("/login", static_page("auth.html", mode="login", gift=False)),
    Route("/signup", static_page("auth.html", mode="signup", gift=False)),
    Route("/gift", static_page("auth.html", mode="login", gift=True)),
    Route("/dashboard", static_page("dashboard.html")),
    Route("/upload", static_page("upload.html")),
    Route("/activities/{activity_id}", static_page("activity.html")),
    Route("/segments/{segment_id}", static_page("segment.html")),
    Route("/athletes/{athlete_id}", static_page("athlete.html")),
    Route("/recap", static_page("recap.html")),
    Route("/settings/privacy", privacy_page),
    Route("/media/hero.vtt", hero_captions),
]
