"""Shared API helpers: body parsing, the published-keys rule and projections."""
import json

from . import decode as dc
from . import domain, repo
from .errors import ApiError, validation

TYPE_LABELS = {"annual": "Annual leave", "unpaid": "Unpaid leave",
               "compassionate": "Compassionate leave"}
STATUS_LABELS = {"draft": "Draft", "submitted": "Submitted", "escalated": "Escalated",
                 "cover_pending": "Cover pending", "approved": "Approved",
                 "declined": "Declined", "withdrawn": "Withdrawn",
                 "cancelled": "Cancelled"}


def body_json(request):
    if request.content_type != "application/json":
        raise ApiError("unsupported_media_type")
    if not request.body:
        raise validation({})
    try:
        data = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise validation({})
    if not isinstance(data, dict):
        raise validation({})
    return data


def check_unknown_keys(data, published):
    """The one published-body-keys rule: any other key is refused."""
    return {key: "This field can't be set." for key in data if key not in published}


def attendance_body(att, display_name):
    if att is None:
        return None
    return {"id": att["id"],
            "person": {"id": att["person_id"], "display_name": display_name},
            "home_id": att["home_id"], "unit_id": att["unit_id"],
            "assignment_id": att["assignment_id"], "date": att["date"].isoformat(),
            "shift": att["shift"],
            "rostered_start": domain.iso_instant(att["rostered_start"]),
            "rostered_end": domain.iso_instant(att["rostered_end"]),
            "clock_in_at": domain.iso_instant(att["clock_in_at"])
            if att["clock_in_at"] else None,
            "clock_out_at": domain.iso_instant(att["clock_out_at"])
            if att["clock_out_at"] else None,
            "worked_hours": domain.hours_str(att["worked_seconds"] / 3600)
            if att["worked_seconds"] is not None else None,
            "missed_clock_out": repo.attendance_is_missed(att),
            "late": att["late"], "late_acknowledged": att["late_acknowledged"],
            "correction_note": att["correction_note"], "version": att["version"]}


def attendance_body_with_person(conn, att):
    person = repo.get_person(conn, att["person_id"])
    return attendance_body(att, person["display_name"])


def rota_entries(conn, unit_id, date_from, date_to, viewer_id, with_absence_kind):
    """Rota entries for a unit's week, with status and absence_kind from the one
    away rule (repo.AWAY_SQL)."""
    rows = conn.execute(
        f"""
        select a.person_id, p.display_name, p.skill, a.date, a.shift, a.starts_at,
               a.ends_at, a.id, ({repo.AWAY_SQL})
        from assignments a join people p on p.id = a.person_id
        where a.unit_id = $1 and a.date between $2 and $3
        order by a.starts_at asc, p.display_name asc
        """, [unit_id, date_from.isoformat(), date_to.isoformat()])
    entries = []
    for r in rows:
        date = dc.d(r[3])
        away = r[8] != b"t"
        entry = {"assignment_id": dc.s(r[7]),
                 "person": {"id": dc.s(r[0]), "display_name": dc.s(r[1])},
                 "date": date.isoformat(), "shift": dc.s(r[4]),
                 "starts_at": domain.iso_instant(dc.t(r[5])),
                 "ends_at": domain.iso_instant(dc.t(r[6])),
                 "hours": domain.hours_str(domain.shift_hours(date, dc.s(r[4]))),
                 "status": "away" if away else "on",
                 "is_you": dc.s(r[0]) == viewer_id}
        if with_absence_kind:
            entry["absence_kind"] = (repo.absence_kind_for(conn, dc.s(r[0]), date)
                                     if away else None)
        entries.append(entry)
    return entries


def cover_body(conn, cover, with_claim_detail):
    """<cover> projection; managers and HR also see leave_request_id and claimed_by."""
    unit = conn.execute("select name from units where id = $1", [cover["unit_id"]])
    home = conn.execute("select name from homes where id = $1", [cover["home_id"]])
    body = {"id": cover["id"],
            "home": {"id": cover["home_id"], "name": dc.s(home[0][0])},
            "unit": {"id": cover["unit_id"], "name": dc.s(unit[0][0])},
            "date": cover["date"].isoformat(), "shift": cover["shift"],
            "starts_at": domain.iso_instant(cover["starts_at"]),
            "ends_at": domain.iso_instant(cover["ends_at"]),
            "hours": domain.hours_str(domain.shift_hours(cover["date"], cover["shift"])),
            "skill": cover["skill"], "status": cover["status"]}
    if with_claim_detail:
        body["leave_request_id"] = cover["leave_request_id"]
        claimant = None
        if cover["claimed_by"]:
            person = repo.get_person(conn, cover["claimed_by"])
            claimant = {"id": person["id"], "display_name": person["display_name"]}
        body["claimed_by"] = claimant
    return body


def cover_row(conn, cover_id):
    rows = conn.execute(
        "select c.id, c.leave_request_id, c.unit_id, c.date, c.shift, c.skill, c.status,"
        " c.claimed_by, u.home_id, c.starts_at, c.ends_at from covers c"
        " join units u on u.id = c.unit_id where c.id = $1", [cover_id])
    if not rows:
        return None
    r = rows[0]
    return {"id": dc.s(r[0]), "leave_request_id": dc.s(r[1]), "unit_id": dc.s(r[2]),
            "date": dc.d(r[3]), "shift": dc.s(r[4]), "skill": dc.s(r[5]),
            "status": dc.s(r[6]), "claimed_by": dc.s(r[7]),
            "home_id": dc.s(r[8]), "starts_at": dc.t(r[9]), "ends_at": dc.t(r[10])}
