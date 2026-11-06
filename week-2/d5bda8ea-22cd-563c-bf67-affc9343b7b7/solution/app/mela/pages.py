"""Server-rendered pages: every page reads correctly before any script runs."""
from datetime import datetime, timedelta, timezone
from functools import wraps
from urllib.parse import quote
from zoneinfo import ZoneInfo

from flask import Blueprint, abort, g, redirect, render_template, request

from . import accounts, communities, db, discovery, events, registrations
from .domain import CITIES, REGION, REPORT_REASONS, THEMES, TIME_ZONES

pages = Blueprint("pages", __name__)

STATUS_FILTERS = [("all", "All"), ("pending", "Pending"), ("approved", "Going"), ("waitlisted", "Waitlist"),
                  ("declined", "Declined")]


def member_page(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.member is None:
            target = request.path + (f"?{request.query_string.decode()}" if request.query_string else "")
            return redirect(f"/signin?next={quote(target, safe='')}")
        return view(*args, **kwargs)
    return wrapped


def card_state(event):
    """The one Registration card state for this viewer: the first rule that applies wins."""
    if event["is_host"]:
        return "host"
    if event["ended"]:
        return "past"
    if event["viewer_status"] in ("pending", "approved", "declined", "waitlisted"):
        return event["viewer_status"]
    if event["registration_status"] == "closed":
        return "closed"
    if event["registration_status"] == "code_only":
        return "code"
    if registrations.is_full(event):
        return "full"
    return "open"


@pages.get("/")
def landing():
    conn = db.conn()
    listing = discovery.upcoming(conn)
    places, categories = discovery.counts(listing)
    return render_template(
        "landing.html", places=places, categories=categories,
        floating=[listing[i % len(listing)] for i in range(12)] if listing else [],
        coming_up={slug: [e for e in listing if discovery.matches(e, place=slug)][:6] for slug, _ in CITIES},
        highlights=discovery.upcoming(conn, multi_day=True)[:4],
        calendars=communities.calendars(conn, g.member))


@pages.get("/discover")
def discover():
    place, category = request.args.get("place") or None, request.args.get("category") or None
    if not discovery.known_filters(place, category):
        abort(404)
    conn = db.conn()
    listing = discovery.upcoming(conn)
    places, categories = discovery.counts(listing)
    return render_template(
        "discover.html", place=place, category=category, label=discovery.filter_label(place, category),
        matching=[e for e in listing if discovery.matches(e, place, category)], places=places,
        categories=categories, calendars=communities.calendars(conn, g.member), region=REGION)


@pages.get("/c/<slug>")
def community(slug):
    conn = db.conn()
    calendar = communities.calendar(conn, slug, g.member) or abort(404)
    return render_template("community.html", calendar=calendar,
                           upcoming=discovery.upcoming(conn, calendar_id=calendar["id"]))


@pages.get("/signin")
def signin():
    target = accounts.safe_next(request.args.get("next"))
    if g.member is not None:
        return redirect(target)
    return render_template("signin.html", target=target)


@pages.get("/home")
@member_page
def home():
    conn = db.conn()
    return render_template("home.html", tab="past" if request.args.get("tab") == "past" else "upcoming",
                           upcoming=events.member_events(conn, g.member, "upcoming"),
                           past=events.member_events(conn, g.member, "past"))


def _followed(conn):
    return [c for c in communities.calendars(conn, g.member) if c["following"]]


@pages.get("/create")
@member_page
def create():
    start = datetime.now(ZoneInfo("Asia/Kolkata")).replace(hour=18, minute=0, second=0, microsecond=0) + timedelta(days=7)
    draft = {"name": "", "description": "", "start_at": start, "end_at": start + timedelta(hours=3),
             "timezone": "Asia/Kolkata", "location_type": "offline", "venue_name": "", "street_address": "",
             "city": "", "virtual_link": "", "visibility": "public", "require_approval": False, "capacity": None,
             "waitlist": False, "theme": "amber", "calendar_slug": None, "slug": "draft"}
    return render_template("create.html", event=draft, calendars=_followed(db.conn()), themes=THEMES,
                           zones=TIME_ZONES)


@pages.get("/manage/<slug>")
@member_page
def manage(slug):
    conn = db.conn()
    event = events.load(conn, slug, g.member)
    if event is None or not event["is_host"]:
        abort(404)
    guests = [r for r in registrations.guests(conn, event) if r["status"] != "cancelled"]
    tally = conn.execute(
        "SELECT count(*) FILTER (WHERE status = 'pending') AS pending, count(*) FILTER (WHERE status = 'declined') AS declined"
        " FROM registrations WHERE event_id = %s", (event["id"],)).fetchone()
    tally.update(approved=event["going_count"], waitlisted=event["waitlist_count"])
    return render_template("manage.html", event=event, guests=guests, tally=tally, filters=STATUS_FILTERS,
                           calendars=_followed(conn), themes=THEMES, zones=TIME_ZONES,
                           reopen=events.status_edges(event)[0])


@pages.get("/<slug>")
def event_page(slug):
    conn = db.conn()
    event = events.load(conn, slug, g.member) or abort(404)
    attending = conn.execute(
        "SELECT m.name FROM registrations r JOIN members m ON m.id = r.member_id"
        " WHERE r.status = 'approved' AND r.event_id = %s ORDER BY r.requested_at, r.id LIMIT 6",
        (event["id"],)).fetchall() if event["show_guest_list"] else []
    calendar = communities.calendar(conn, event["calendar_slug"], g.member) if event["calendar_slug"] else None
    return render_template("event.html", event=event, state=card_state(event), attending=[a["name"] for a in attending],
                           celebrate=registrations.claim_celebration(conn, event), calendar=calendar,
                           reasons=REPORT_REASONS, now=datetime.now(timezone.utc))
