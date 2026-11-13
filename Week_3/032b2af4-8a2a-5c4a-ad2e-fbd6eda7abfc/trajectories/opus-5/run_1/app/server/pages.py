"""Server-rendered pages. Public pages carry their words without waiting for scripts."""
from pathlib import Path

from datetime import timedelta

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import auth, db
from .content import CONTEXT
from .domain.calendar import month_window
from .errors import not_found

router = APIRouter()
TEMPLATES = Path(__file__).resolve().parent / "web" / "templates"
environment = Environment(
    loader=FileSystemLoader(TEMPLATES), autoescape=select_autoescape(["html"]), trim_blocks=True, lstrip_blocks=True
)


DARK_HEADER_PAGES = {"features", "subscribe", "about"}


def render(request: Request, template: str, status: int = 200, **context) -> HTMLResponse:
    name = template.removesuffix(".html")
    page = environment.get_template(template)
    body = page.render(
        request=request,
        page=name,
        me=auth.athlete_for_request(request),
        dark_header=name in DARK_HEADER_PAGES,
        **CONTEXT,
        **context,
    )
    return HTMLResponse(body, status_code=status)


def not_found_page(request: Request) -> HTMLResponse:
    return render(request, "not_found.html", status=404, title="Page not found")


def _record_exists(table: str, record_id: str) -> bool:
    try:
        number = int(record_id)
    except ValueError:
        return False
    with db.cursor() as cursor:
        cursor.execute(f"SELECT 1 FROM {table} WHERE id = %s", (number,))
        return cursor.fetchone() is not None


PUBLIC_PAGES = {
    "/": ("home.html", "Pacely — Community-Powered Motivation"),
    "/features": ("features.html", "Features — Pacely"),
    "/subscribe": ("subscribe.html", "Subscription — Pacely"),
    "/family": ("family.html", "Family Plan — Pacely"),
    "/student": ("student.html", "Student Discount — Pacely"),
    "/bulk-subscriptions": ("bulk.html", "Bulk Subscriptions — Pacely"),
    "/about": ("about.html", "About Us — Pacely"),
    "/whats-new": ("whats_new.html", "What's New — Pacely"),
    "/login": ("login.html", "Log In — Pacely"),
    "/signup": ("signup.html", "Sign Up — Pacely"),
    "/gift": ("login.html", "Send a Gift — Pacely"),
}

PRODUCT_PAGES = {
    "/dashboard": ("dashboard.html", "Dashboard — Pacely"),
    "/upload": ("upload.html", "Upload — Pacely"),
    "/recap": ("recap.html", "Your Year — Pacely"),
    "/settings/privacy": ("privacy.html", "Privacy settings — Pacely"),
}


def _add(path: str, template: str, title: str, gift: bool = False) -> None:
    async def page(request: Request):
        return render(request, template, title=title, gift=gift)

    router.add_api_route(path, page, methods=["GET"], response_class=HTMLResponse)


for path, (template, title) in PUBLIC_PAGES.items():
    _add(path, template, title, gift=path == "/gift")
for path, (template, title) in PRODUCT_PAGES.items():
    _add(path, template, title)


GOAL_LINES = {
    "distance": lambda goal: f"Cover {goal / 1000:g} km this month",
    "single_distance": lambda goal: f"Complete a single activity of {goal / 1000:g} km",
    "elevation": lambda goal: f"Climb {goal:,} m this month",
    "moving_time": lambda goal: f"Move for {goal // 3600} hours this month",
}


@router.get("/challenges", response_class=HTMLResponse)
def challenges_page(request: Request):
    starts_at, ends_at = month_window("UTC")
    with db.cursor() as cursor:
        cursor.execute("SELECT id, name, sport_types, dimension, goal FROM challenges ORDER BY id")
        challenges = [
            dict(row, goal_line=GOAL_LINES[row["dimension"]](row["goal"])) for row in cursor.fetchall()
        ]
    promoted = next((c for c in challenges if c["name"] == "Monthly 5K Challenge"), None)
    return render(
        request,
        "challenges.html",
        title="Challenges — Pacely",
        challenges=challenges,
        promoted=promoted,
        month_range=f"{starts_at:%d %B %Y} to {ends_at - timedelta(days=1):%d %B %Y}",
        run_challenges=[c for c in challenges if "run" in c["sport_types"]],
        ride_challenges=[c for c in challenges if "ride" in c["sport_types"]],
    )


@router.get("/maps", response_class=HTMLResponse)
def maps_page(request: Request):
    with db.cursor() as cursor:
        cursor.execute(
            "SELECT id, name, start_lat, start_lon, end_lat, end_lon, distance_m, elevation_diff_m"
            " FROM segments ORDER BY name"
        )
        segments = cursor.fetchall()
    return render(request, "maps.html", title="Maps — Pacely", segments=segments)


@router.get("/activities/{activity_id}", response_class=HTMLResponse)
def activity_page(activity_id: str, request: Request):
    if not _record_exists("activities", activity_id):
        raise not_found()
    return render(request, "activity.html", title="Activity — Pacely", activity_id=activity_id)


@router.get("/segments/{segment_id}", response_class=HTMLResponse)
def segment_page(segment_id: str, request: Request):
    if not _record_exists("segments", segment_id):
        raise not_found()
    return render(request, "segment.html", title="Segment — Pacely", segment_id=segment_id)


@router.get("/athletes/{athlete_id}", response_class=HTMLResponse)
def athlete_page(athlete_id: str, request: Request):
    if not _record_exists("athletes", athlete_id):
        raise not_found()
    return render(request, "athlete.html", title="Athlete — Pacely", athlete_id=athlete_id)
