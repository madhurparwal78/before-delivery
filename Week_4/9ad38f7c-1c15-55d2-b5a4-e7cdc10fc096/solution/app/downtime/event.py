"""The event window, scenario listings and the RFC 5545 calendar file."""

from datetime import UTC, datetime

from starlette.responses import JSONResponse, Response

from . import scoring, teams
from .accounts import User
from .db import DB
from .errors import NO_STORE, ApiError
from .inputs import path_slug

NAME = "Strange & Unusual Activity"
START = datetime(2026, 10, 22, 16, 0, tzinfo=UTC)
END = datetime(2026, 10, 26, 23, 59, tzinfo=UTC)
CALENDAR_TITLE = "Strange & Unusual Activity, a NightWard Downtime CTF"
CALENDAR_DESCRIPTION = ("Five days, eight scenarios, one haunted network. "
                        "Join any day between Thursday 22 and Monday 26 October.")
CALENDAR_UID = "strange-and-unusual-activity-2026@downtime.nightward"
SCENARIO_FIELDS = "slug, number, title, kind, points, description"


def _scenario(row) -> dict[str, object]:
    return {"slug": row["slug"], "number": row["number"], "title": row["title"], "kind": row["kind"],
            "points": row["points"], "description": row["description"]}


async def event() -> Response:
    async with DB.connection() as conn:
        now = await conn.fetchval("SELECT clock_timestamp()")
    window = {"start": scoring.iso(START), "end": scoring.iso(END)}
    return JSONResponse({"name": NAME, **window, "live_windows": [window], "calendar_title": CALENDAR_TITLE,
                         "calendar_description": CALENDAR_DESCRIPTION, "certificate_enabled": True,
                         "server_time": scoring.iso(now)}, headers=NO_STORE)


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> bytes:
    """Fold a content line into chunks of at most 75 octets, never splitting a UTF-8 sequence."""
    raw, out, limit = line.encode("utf-8"), [], 75
    while len(raw) > limit:
        cut = limit
        while raw[cut] & 0xC0 == 0x80:
            cut -= 1
        out.append(raw[:cut])
        raw, limit = raw[cut:], 74
    out.append(raw)
    return b"\r\n ".join(out) + b"\r\n"


async def calendar() -> Response:
    async with DB.connection() as conn:
        now = await conn.fetchval("SELECT clock_timestamp()")
    stamp = "%Y%m%dT%H%M%SZ"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NightWard//Downtime//EN", "CALSCALE:GREGORIAN",
             "BEGIN:VEVENT", f"UID:{CALENDAR_UID}", f"DTSTAMP:{now.astimezone(UTC).strftime(stamp)}",
             f"DTSTART:{START.strftime(stamp)}", f"DTEND:{END.strftime(stamp)}",
             f"SUMMARY:{_escape(CALENDAR_TITLE)}", f"DESCRIPTION:{_escape(CALENDAR_DESCRIPTION)}",
             "END:VEVENT", "END:VCALENDAR"]
    return Response(b"".join(_fold(line) for line in lines), media_type="text/calendar; charset=utf-8",
                    headers={**NO_STORE, "Content-Disposition": 'attachment; filename="downtime.ics"'})


async def scenarios() -> Response:
    async with DB.connection() as conn:
        rows = await conn.fetch(f"SELECT {SCENARIO_FIELDS} FROM scenarios ORDER BY number")
    return JSONResponse({"scenarios": [_scenario(r) for r in rows]}, headers=NO_STORE)


async def scenario(user: User | None, raw_slug: str) -> Response:
    slug = path_slug(raw_slug)
    async with DB.connection() as conn:
        row = slug and await conn.fetchrow(f"SELECT {SCENARIO_FIELDS} FROM scenarios WHERE slug = $1", slug)
        if not row:
            raise ApiError(404, "unknown_scenario")
        states = {"team_solved": False, "solved_by_me": False, "attempted_by_me": False}
        if user is not None:
            team = await teams.membership(conn, user.id)
            (state,) = await scoring.scenario_states(conn, user.id, team and team["id"], slug)
            states = {key: state[key] for key in states}
    return JSONResponse({"scenario": _scenario(row), **states}, headers=NO_STORE)
