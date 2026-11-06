"""The server-rendered pages. Every screen reads correctly before any script runs."""

from urllib.parse import quote

from flask import Blueprint, Response, abort, redirect, render_template, request

from . import auth, db, domain, store
from .catalog import (
    CATEGORY_NAME,
    CITIES,
    CITY_NAME,
    REGION_NAME,
    REPORT_REASON_LABELS,
    THEMES,
    TIMEZONES,
)

bp = Blueprint("pages", __name__)

DEFAULT_LANDING_CITY = "New Delhi"
LIST_PREVIEW = 6

COVER_LAYOUT = (
    (5, 12, 124, -8),
    (17, 52, 100, 6),
    (2, 78, 112, -4),
    (31, 4, 104, 5),
    (13, 33, 92, 9),
    (25, 86, 118, -7),
    (71, 8, 112, 7),
    (86, 30, 132, -6),
    (67, 58, 100, 4),
    (90, 76, 96, -9),
    (55, 90, 108, 8),
    (78, 47, 92, 5),
)

FAVICON = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    '<path d="M12 2c.8 5.2 4.8 9.2 10 10-5.2.8-9.2 4.8-10 10-.8-5.2-4.8-9.2-10-10'
    ' 5.2-.8 9.2-4.8 10-10Z" fill="#d81b8c"/></svg>'
)


def _viewer_id(member):
    return member["id"] if member else None


def _chrome(conn) -> dict:
    member = auth.current_member(conn)
    return {"viewer": member}


def _signin_redirect() -> Response:
    target = request.path
    if request.query_string:
        target += "?" + request.query_string.decode()
    return redirect("/signin?next=" + quote(target, safe=""))


def _zoned(row: dict) -> tuple:
    zone = row["timezone"]
    return domain.in_zone(row["start_at"], zone), domain.in_zone(row["end_at"], zone)


def _spans_days(row: dict) -> bool:
    start, end = _zoned(row)
    return start.date() != end.date()


@bp.get("/favicon.svg")
def favicon():
    return Response(FAVICON, mimetype="image/svg+xml")


@bp.get("/")
def landing():
    with db.transaction() as conn:
        context = _chrome(conn)
        upcoming = store.upcoming_events(conn)
        context["calendars"] = store.calendars(conn, _viewer_id(context["viewer"]))
        context["categories"] = store.category_counts(conn)

    covers = []
    for row, (left, top, size, tilt) in zip(upcoming, COVER_LAYOUT):
        reach = size / 3
        covers.append(
            {
                "name": row["name"],
                "theme": row["theme"],
                "left": left,
                "top": top,
                "size": size,
                "tilt": tilt,
                "dx": round((left - 50) / 50 * reach, 1),
                "dy": round((top - 50) / 50 * reach, 1),
            }
        )

    by_city = {}
    for _slug, name in CITIES:
        by_city[name] = [
            {
                "slug": row["slug"],
                "name": row["name"],
                "theme": row["theme"],
                "when": f"{_zoned(row)[0].strftime('%A')}, "
                f"{domain.clock(_zoned(row)[0])}",
            }
            for row in upcoming
            if row["city"] == name
        ][:LIST_PREVIEW]

    multi_day = []
    for row in upcoming:
        if _spans_days(row) and len(multi_day) < 4:
            start, end = _zoned(row)
            multi_day.append(
                {
                    "slug": row["slug"],
                    "name": row["name"],
                    "theme": row["theme"],
                    "city": row["city"],
                    "range": domain.date_range(start, end),
                }
            )

    return render_template(
        "landing.html",
        landing=True,
        cities=CITIES,
        default_city=DEFAULT_LANDING_CITY,
        covers=covers,
        by_city=by_city,
        multi_day=multi_day,
        **context,
    )


@bp.get("/discover")
def discover():
    place = request.args.get("place") or None
    category = request.args.get("category") or None
    if place is not None and place not in CITY_NAME:
        abort(404)
    if category is not None and category not in CATEGORY_NAME:
        abort(404)
    with db.transaction() as conn:
        context = _chrome(conn)
        rows = store.upcoming_events(conn)
        context["calendars"] = store.calendars(conn, _viewer_id(context["viewer"]))
        context["categories"] = store.category_counts(conn)
        context["places"] = store.city_counts(conn)

    city = CITY_NAME[place] if place else None
    listed = []
    for row in rows:
        start, _end = _zoned(row)
        listed.append(
            {
                "slug": row["slug"],
                "name": row["name"],
                "theme": row["theme"],
                "city": row["city"],
                "venue_name": row["venue_name"],
                "categories": list(row["categories"]),
                "when": domain.list_moment(start),
            }
        )
    matching = [
        index
        for index, item in enumerate(listed)
        if (city is None or item["city"] == city)
        and (category is None or category in item["categories"])
    ]
    return render_template(
        "discover.html",
        rows=listed,
        shown=set(matching[:LIST_PREVIEW]),
        match_count=len(matching),
        place=place,
        category=category,
        filter_label=_filter_label(place, category),
        region_name=REGION_NAME,
        **context,
    )


def _filter_label(place: str | None, category: str | None) -> str:
    if place and category:
        return f"{CATEGORY_NAME[category]} in {CITY_NAME[place]}"
    if place:
        return CITY_NAME[place]
    if category:
        return CATEGORY_NAME[category]
    return "All cities"


@bp.get("/c/<slug>")
def community(slug):
    with db.transaction() as conn:
        context = _chrome(conn)
        calendar = store.load_calendar(conn, slug, _viewer_id(context["viewer"]))
        if calendar is None:
            abort(404)
        rows = store.calendar_events(conn, calendar["id"])
    events = []
    for row in rows:
        start, _end = _zoned(row)
        events.append({**row, "when": domain.list_moment(start)})
    return render_template(
        "community.html", calendar=calendar, events=events, **context
    )


@bp.get("/signin")
def signin():
    with db.transaction() as conn:
        context = _chrome(conn)
    return render_template(
        "signin.html", next_target=domain.safe_next(request.args.get("next")), **context
    )


@bp.get("/home")
def home():
    tab = "past" if request.args.get("tab") == "past" else "upcoming"
    with db.transaction() as conn:
        member = auth.current_member(conn)
        if member is None:
            return _signin_redirect()
        tabs = {
            name: _my_event_rows(store.my_events(conn, member["id"], name))
            for name in ("upcoming", "past")
        }
    return render_template("home.html", viewer=member, tab=tab, tabs=tabs)


def _my_event_rows(rows: list[dict]) -> list[dict]:
    listed = []
    for row in rows:
        start, end = _zoned(row)
        listed.append(
            {
                **row,
                "day": domain.long_date(start),
                "clock": domain.time_range(start, end),
            }
        )
    return listed


BLANK_FORM = {
    "slug": None,
    "name": "",
    "description": "",
    "theme": "amber",
    "start_date": "",
    "start_time": "",
    "end_date": "",
    "end_time": "",
    "timezone": "Asia/Kolkata",
    "location_type": "offline",
    "venue_name": "",
    "street_address": "",
    "city": "",
    "virtual_link": "",
    "visibility": "public",
    "require_approval": False,
    "capacity": "",
    "waitlist": False,
    "calendar": None,
    "registration_status": "open",
    "has_access_code": False,
}


def _event_form(event: dict, start, end) -> dict:
    return {
        "slug": event["slug"],
        "name": event["name"],
        "description": event["description"],
        "theme": event["theme"],
        "start_date": start.strftime("%Y-%m-%d"),
        "start_time": start.strftime("%H:%M"),
        "end_date": end.strftime("%Y-%m-%d"),
        "end_time": end.strftime("%H:%M"),
        "timezone": event["timezone"],
        "location_type": event["location_type"],
        "venue_name": event["venue_name"],
        "street_address": event["street_address"],
        "city": event["city"],
        "virtual_link": event["virtual_link"],
        "visibility": event["visibility"],
        "require_approval": event["require_approval"],
        "capacity": "" if event["capacity"] is None else event["capacity"],
        "waitlist": event["waitlist"],
        "calendar": event["calendar_slug"],
        "registration_status": event["registration_status"],
        "has_access_code": event["has_access_code"],
    }


@bp.get("/create")
def create():
    with db.transaction() as conn:
        member = auth.current_member(conn)
        if member is None:
            return _signin_redirect()
        calendars = store.followed_calendars(conn, member["id"])
    return render_template(
        "create.html",
        viewer=member,
        calendars=calendars,
        themes=THEMES,
        timezones=TIMEZONES,
        form=BLANK_FORM,
    )


@bp.get("/manage/<slug>")
def manage(slug):
    status = request.args.get("status")
    if status not in ("pending", "approved", "waitlisted", "declined"):
        status = None
    with db.transaction() as conn:
        member = auth.current_member(conn)
        if member is None:
            return _signin_redirect()
        event = store.load_event(conn, slug, member["id"])
        if event is None or not event["is_host"]:
            abort(404)
        guests = store.guest_list(conn, event["id"], status)
        counts = store.guest_counts(conn, event["id"])
        calendars = store.followed_calendars(conn, member["id"])
    start, end = _zoned(event)
    rows = [
        {
            **guest,
            "requested": domain.list_moment(
                domain.in_zone(guest["requested_at"], event["timezone"])
            ),
            "ordinal": domain.ordinal(guest["waitlist_position"])
            if guest["waitlist_position"]
            else None,
        }
        for guest in guests
    ]
    return render_template(
        "manage.html",
        viewer=member,
        event=event,
        guests=rows,
        counts=counts,
        status=status,
        calendars=calendars,
        themes=THEMES,
        timezones=TIMEZONES,
        form=_event_form(event, start, end),
    )


@bp.get("/<slug>")
def event_page(slug):
    with db.transaction() as conn:
        context = _chrome(conn)
        viewer_id = _viewer_id(context["viewer"])
        event = store.load_event(conn, slug, viewer_id)
        if event is None:
            abort(404)
        faces = (
            [row["name"] for row in store.guest_faces(conn, event["id"])]
            if event["show_guest_list"]
            else []
        )
        calendar = (
            store.load_calendar(conn, event["calendar_slug"], viewer_id)
            if event["calendar_slug"]
            else None
        )
    start, end = _zoned(event)
    state = domain.card_state(event)
    show_address = domain.can_see_address(event)
    return render_template(
        "event.html",
        theme=event["theme"],
        event=event,
        event_payload=store.event_json(event),
        calendar=calendar,
        state=state,
        start=start,
        start_iso=domain.iso_utc(event["start_at"]),
        end_iso=domain.iso_utc(event["end_at"]),
        long_date=domain.long_date(start),
        time_range=domain.time_range(start, end),
        maps_link=_maps_link(event) if show_address else None,
        faces=faces,
        guest_line=_guest_line(faces, event["going_count"]),
        show_address=show_address,
        show_meter=domain.shows_meter(event, state),
        countdown=domain.countdown_text(event),
        past_body=domain.past_body(event),
        places_left_text=domain.places_left_text(event),
        meter_line=domain.meter_line(event),
        position=domain.ordinal(event["viewer_waitlist_position"])
        if event["viewer_waitlist_position"]
        else None,
        report_reasons=REPORT_REASON_LABELS,
        **context,
    )


def _maps_link(event: dict) -> str:
    query = ", ".join(part for part in (event["street_address"], event["city"]) if part)
    return "geo:0,0?q=" + quote(query)


def _guest_line(faces: list[str], going: int) -> str:
    if not faces:
        return ""
    if going <= 2:
        return domain.join_names(faces[:going])
    others = going - 2
    rest = "1 other" if others == 1 else f"{others} others"
    return f"{', '.join(faces[:2])} and {rest}"
