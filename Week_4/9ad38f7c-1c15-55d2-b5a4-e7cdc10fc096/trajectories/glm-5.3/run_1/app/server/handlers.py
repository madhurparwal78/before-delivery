"""The published /api routes. Response bodies are built from explicit lists
of published fields, never by serialising whole stored rows."""

import os

from . import db, domain, errors, validation
from .api import (created_data, no_content, public_data, route)
from .app import APP

EVENT_NAME = "Strange & Unusual Activity"
EVENT_START = "2026-10-22T16:00:00Z"
EVENT_END = "2026-10-26T23:59:00Z"
CALENDAR_TITLE = "Strange & Unusual Activity, a NightWard Downtime CTF"
CALENDAR_DESCRIPTION = ("Five days, eight scenarios, one haunted network. "
                         "Join any day between Thursday 22 and Monday 26 October.")
CALENDAR_UID = "downtime-strange-unusual-activity@nightward.example"
SIGN_IN_LOCK = int(os.environ.get("SIGN_IN_LOCK_SECONDS") or 900)


# --- health ------------------------------------------------------------------

@route("GET", "/api/health", extra_allowed=("HEAD",))
def health(conn, environ, body):
    status, ok = APP.health_check()
    if ok:
        return public_data({"status": "ok"})
    if status == "starting":
        return 503, errors.error_bytes(errors.starting()), []
    return 503, errors.error_bytes(errors.unavailable()), []


# --- auth --------------------------------------------------------------------

@route("POST", "/api/auth/signup")
def signup(conn, environ, body):
    raw_email = validation.require_text(body, "email", "Enter a valid email")
    raw_name = validation.require_text(body, "display_name",
                                       "Display name must be 1 to 40 characters")
    raw_password = validation.require_text(body, "password",
                                           "Password must be 8 to 128 characters")
    email = validation.normalise_email(raw_email)
    display_name = validation.normalise_display_name(raw_name)
    password = validation.normalise_password(raw_password)
    if domain.find_user_by_email(conn, email) is not None:
        raise errors.email_taken()
    row = domain.create_account(conn, email, display_name, password)
    token = domain.start_session(conn, row[0])
    return created_data({"token": token, "user": domain.user_public(row)})


@route("POST", "/api/auth/login")
def login(conn, environ, body):
    raw_email = validation.require_text(body, "email", "Enter a valid email")
    raw_password = validation.require_text(body, "password",
                                           "Enter your password")
    email = raw_email.strip().lower()
    now = db.statement_now(conn)
    lock_until = domain.sign_in_throttle_state(conn, email, now)
    if lock_until is not None:
        raise errors.too_many_attempts(
            domain.retry_after(now, lock_until, SIGN_IN_LOCK))
    user = domain.find_user_by_email(conn, email)
    if user is not None and db.check_password(user, raw_password):
        domain.record_sign_in(conn, email, True)
        token = domain.start_session(conn, user[0])
        return public_data({"token": token, "user": domain.user_public(user)})
    # A failed sign-in stores its attempt row even though the request is
    # refused: the throttle counts it, so it commits before the refusal.
    domain.record_sign_in(conn, email, False)
    conn.commit()
    raise errors.invalid_credentials()


@route("POST", "/api/auth/logout")
def logout(conn, environ, body):
    token = bearer(environ)
    domain.caller(conn, token)
    domain.end_session(conn, token)
    return no_content()


def bearer(environ):
    from .api import bearer_token
    return bearer_token(environ)


@route("GET", "/api/me")
def me(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    team = domain.team_for_caller(conn, user)
    payload = {
        "user": domain.user_public(user),
        "team": ({"id": team[0], "name": team[1], "invite_code": team[2],
                  "is_captain": team[3] == user[0]} if team else None),
        "tickets": domain.ticket_count(conn, user[0]),
        "completions": domain.completions_slugs(conn, user[0]),
        "webinar_claimed": db.query_one(
            conn, "SELECT 1 FROM webinar_claims WHERE user_id = %s", (user[0],)) is not None}
    return public_data(payload)


# --- event and calendar ------------------------------------------------------

@route("GET", "/api/event")
def event_info(conn, environ, body):
    return public_data({
        "name": EVENT_NAME, "start": EVENT_START, "end": EVENT_END,
        "live_windows": [{"start": EVENT_START, "end": EVENT_END}],
        "calendar_title": CALENDAR_TITLE,
        "calendar_description": CALENDAR_DESCRIPTION,
        "certificate_enabled": True,
        "server_time": db.time_text(db.statement_now(conn))})


def _fold_ics_line(line):
    """Fold a content line longer than 75 octets, with CRLF and one space."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return [line]
    parts = []
    first = True
    while encoded:
        limit = 75 if first else 74
        cut = min(limit, len(encoded))
        while cut > 0 and cut < len(encoded) and (encoded[cut] & 0xC0) == 0x80:
            cut -= 1
        parts.append(encoded[:cut].decode("utf-8"))
        encoded = encoded[cut:]
        first = False
    return parts


def _ics_escape(text):
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")


def _utc_basic(now):
    return now.strftime("%Y%m%dT%H%M%SZ")


@route("GET", "/api/event/calendar.ics")
def calendar(conn, environ, body):
    now = db.statement_now(conn)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//NightWard//Downtime//EN",
        "BEGIN:VEVENT",
        "UID:" + CALENDAR_UID,
        "DTSTAMP:" + _utc_basic(now),
        "DTSTART:20261022T160000Z",
        "DTEND:20261026T235900Z",
        "SUMMARY:" + _ics_escape(CALENDAR_TITLE),
        "DESCRIPTION:" + _ics_escape(CALENDAR_DESCRIPTION),
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    folded = []
    for line in lines:
        folded.extend(_fold_ics_line(line))
    text = "\r\n".join(folded) + "\r\n"
    return 200, text.encode("utf-8"), [
        ("Content-Type", "text/calendar; charset=utf-8"),
        ("Content-Disposition", 'attachment; filename="downtime.ics"')]


# --- scenarios ---------------------------------------------------------------

def scenario_public(row):
    return {"slug": row[0], "number": row[1], "title": row[2], "kind": row[3],
            "points": row[4], "description": row[5]}


@route("GET", "/api/scenarios")
def scenarios_list(conn, environ, body):
    rows = db.query(conn, "SELECT slug, number, title, kind, points, description "
                          "FROM scenarios ORDER BY number")
    return public_data({"scenarios": [scenario_public(row) for row in rows]})


def check_slug(conn, slug):
    """A slug holding U+0000, any non-ASCII character, or more than 64
    characters answers 404 unknown_scenario, as does any unseeded slug."""
    if not slug or "\x00" in slug or len(slug) > 64 or not slug.isascii():
        raise errors.unknown_scenario()
    row = domain.scenario_for_slug(conn, slug)
    if row is None:
        raise errors.unknown_scenario()
    return row


@route("GET", "/api/scenarios/{slug}")
def scenario_detail(conn, environ, body):
    token = bearer(environ)
    row = check_slug(conn, environ["downtime.slug"])
    team_solved = solved_by_me = attempted_by_me = False
    if token:
        user = domain.caller(conn, token)
        team = domain.team_for_caller(conn, user)
        states = domain.scenario_states(conn, team[0] if team else 0, user[0])
        state = next(s for s in states if s["slug"] == row[0])
        team_solved, solved_by_me, attempted_by_me = (
            state["team_solved"], state["solved_by_me"], state["attempted_by_me"])
    return public_data({"scenario": scenario_public(row),
                       "team_solved": team_solved,
                       "solved_by_me": solved_by_me,
                       "attempted_by_me": attempted_by_me})


@route("POST", "/api/scenarios/{slug}/flag")
def submit_flag(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    flag = validation.require_text(body, "flag", "Enter a flag")
    scenario = check_slug(conn, environ["downtime.slug"])
    return public_data(domain.submit_flag(conn, user, scenario, flag.strip()))


@route("POST", "/api/webinar/flag")
def webinar_flag(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    flag = validation.require_text(body, "flag", "Enter a flag")
    return public_data({"claimed": True, "tickets": domain.webinar_claim(conn, user, flag.strip())})


# --- teams -------------------------------------------------------------------

@route("POST", "/api/teams")
def team_create(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    name = validation.require_text(body, "name",
                                   "Team names are 3 to 24 letters, digits, spaces, "
                                   "hyphens or underscores")
    return created_data({"team": domain.team_public(
        domain.create_team(conn, user, validation.normalise_team_name(name)))})


@route("POST", "/api/teams/join")
def team_join(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    raw = validation.require_text(body, "invite_code", "Enter an invite code")
    return public_data({"team": domain.team_public(
        domain.join_team(conn, user, validation.normalise_invite_code(raw)))})


@route("POST", "/api/teams/leave")
def team_leave(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    domain.leave_team(conn, user)
    return no_content()


@route("GET", "/api/teams/mine")
def team_mine(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    return public_data(domain.team_room(conn, user))


@route("POST", "/api/teams/mine/members/{user_id}/remove")
def team_remove_member(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    target = validation.path_user_id(environ["downtime.user_id"])
    domain.remove_member(conn, user, target)
    return no_content()


@route("POST", "/api/teams/mine/invite-code")
def team_invite_code(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    team = domain.team_for_caller(conn, user)
    if team is None:
        raise errors.not_in_team()
    domain.lock_my_membership(conn, user[0])
    domain.lock_team(conn, team[0])
    if domain.team_for_caller(conn, user) is None:
        raise errors.not_in_team()
    if team[3] != user[0]:
        raise errors.not_captain()
    code = domain.rotate_invite_code(conn, team)
    domain.publish_team_event(conn, team[0])
    return public_data({"invite_code": code})


# --- leaderboard and stream --------------------------------------------------

@route("GET", "/api/leaderboard")
def leaderboard(conn, environ, body):
    query = environ["QUERY_STRING"]
    params = parse_query(query)
    page = validation.query_positive(params.get("page", "1"), "page")
    limit = min(50, validation.query_positive(params.get("limit", "5"), "limit"))
    include_feed = validation.query_flag(params.get("include_feed", "0"),
                                        "include_feed")
    rows, total, pages = domain.ranking_page(conn, page, limit)
    entries = []
    for rank, row in enumerate(rows, start=(page - 1) * limit + 1):
        entries.append({
            "rank": rank, "team_id": row[0], "team_name": row[1],
            "soc_sim": _status_word(conn, row[0], "soc-sim"),
            "th_sim": _status_word(conn, row[0], "th-sim"),
            "tabletop": _status_word(conn, row[0], "tabletop"),
            "challenges_solved": _challenges(conn, row[0]),
            "challenges_total": 5,
            "points": row[5]})
    payload = {"entries": entries, "total": total, "page": page,
               "limit": limit, "pages": pages,
               "server_time": db.time_text(db.statement_now(conn)),
               "feed": ([{"team_name": r[0], "scenario_title": r[1], "points": r[2],
                          "created_at": db.time_text(r[3])}
                         for r in domain.feed_rows(conn)] if include_feed else None)}
    return public_data(payload)


def parse_query(raw):
    from urllib.parse import parse_qs
    parsed = parse_qs(raw, keep_blank_values=True)
    return {key: values[-1] for key, values in parsed.items()}


def _status_word(conn, team_id, kind):
    solved = db.query_one(
        conn, "SELECT 1 FROM team_solves ts JOIN scenarios s ON s.slug = ts.scenario_slug "
              "WHERE ts.team_id = %s AND s.kind = %s", (team_id, kind))
    if kind == "tabletop":
        return "Completed" if solved else "Not completed"
    return "Passed" if solved else "Not passed"


def _challenges(conn, team_id):
    return db.query_one(
        conn, "SELECT count(*) FROM team_solves ts JOIN scenarios s "
              "ON s.slug = ts.scenario_slug WHERE ts.team_id = %s AND s.kind = 'challenge'",
        (team_id,))[0]


@route("GET", "/api/stream")
def stream(conn, environ, body):
    raise errors.not_found()


# --- certificate -------------------------------------------------------------

@route("GET", "/api/me/certificate")
def certificate(conn, environ, body):
    user = domain.caller(conn, bearer(environ))
    return public_data(domain.certificate_for(conn, user))


@route("GET", "/api/me/certificate/image")
def certificate_image(conn, environ, body):
    from .pages import certificate_svg
    user = domain.caller(conn, bearer(environ))
    record = domain.certificate_for(conn, user)
    return 200, certificate_svg(record).encode("utf-8"), [
        ("Content-Type", "image/svg+xml")]


SIGN_IN_LOCK = int(__import__("os").environ.get("SIGN_IN_LOCK_SECONDS") or 900)
