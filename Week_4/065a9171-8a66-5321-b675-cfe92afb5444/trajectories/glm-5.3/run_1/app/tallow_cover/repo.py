"""Queries and the domain rules they decide: on-duty counts, effective floors,
breach labels, leave cost, and attendance states."""
import datetime as dt

from . import decode as dc
from . import domain
from .domain import SHIFTS
from .store import new_id

ENTITLEMENT_HOURS = 168.0
DECISION_STATUS = ("submitted", "escalated", "cover_pending", "approved")
AWAY_STATUSES = ("submitted", "escalated", "cover_pending", "approved")


def person_embedded(row):
    return {"id": dc.s(row[0]), "display_name": dc.s(row[1])}


def get_person(conn, person_id):
    rows = conn.execute(
        "select id, email, password_hash, display_name, role, home_id, unit_id, skill,"
        " is_home_manager from people where id = $1", [person_id])
    if not rows:
        return None
    r = rows[0]
    return {"id": dc.s(r[0]), "email": dc.s(r[1]), "password_hash": dc.s(r[2]),
            "display_name": dc.s(r[3]), "role": dc.s(r[4]), "home_id": dc.s(r[5]),
            "unit_id": dc.s(r[6]), "skill": dc.s(r[7]),
            "is_home_manager": r[8] == b"t"}


def get_person_by_email(conn, email):
    rows = conn.execute(
        "select id, email, password_hash, display_name, role, home_id, unit_id, skill,"
        " is_home_manager from people where lower(email) = lower($1)", [email])
    if not rows:
        return None
    r = rows[0]
    return {"id": dc.s(r[0]), "email": dc.s(r[1]), "password_hash": dc.s(r[2]),
            "display_name": dc.s(r[3]), "role": dc.s(r[4]), "home_id": dc.s(r[5]),
            "unit_id": dc.s(r[6]), "skill": dc.s(r[7]),
            "is_home_manager": r[8] == b"t"}


def credentialed_home_ids(conn, person_id):
    rows = conn.execute("select home_id from credentials where person_id = $1", [person_id])
    return [dc.s(r[0]) for r in rows]


def me_body(conn, person):
    holiday = None
    if person["role"] in ("care_worker", "unit_manager"):
        holiday = holiday_balance(conn, person["id"])
    return {"id": person["id"], "email": person["email"],
            "display_name": person["display_name"], "role": person["role"],
            "home_id": person["home_id"], "unit_id": person["unit_id"],
            "skill": person["skill"],
            "credentialed_home_ids": (credentialed_home_ids(conn, person["id"])
                                       if person["role"] == "bank_carer" else []),
            "holiday": holiday}


def leave_year_start(today=None):
    today = today or domain.today()
    return dt.date(today.year, 4, 1) if today.month >= 4 else dt.date(today.year - 1, 4, 1)


def holiday_balance(conn, person_id):
    """entitlement, booked and remaining hours for this leave year."""
    start = leave_year_start()
    rows = conn.execute(
        "select id, hours from leave_requests"
        " where requester_id = $1 and type = 'annual'"
        " and status in ('submitted','escalated','cover_pending','approved')"
        " and start_date >= $2 and start_date <= $3",
        [person_id, start.isoformat(), _leave_year_end(start).isoformat()])
    booked = 0.0
    for r in rows:
        request = fetch_leave_request(conn, dc.s(r[0]))
        booked += request["hours"] - sickness_hours_for_request(conn, request)
    return {"leave_year_start": start.isoformat(),
            "entitlement_hours": domain.hours_str(ENTITLEMENT_HOURS),
            "booked_hours": domain.hours_str(booked),
            "remaining_hours": domain.hours_str(ENTITLEMENT_HOURS - booked)}


def _leave_year_end(start):
    return dt.date(start.year + 1, 3, 31)


# --- on duty -----------------------------------------------------------------

AWAY_SQL = """
  not exists (select 1 from leave_requests lr
              where lr.requester_id = a.person_id and lr.status = 'approved'
                and lr.start_date <= a.date and lr.end_date >= a.date)
  and not exists (select 1 from sickness s
                  where s.person_id = a.person_id and s.start_date <= a.date
                    and ((s.last_sick_date is null and s.status != 'closed')
                         or (s.last_sick_date is not null and s.last_sick_date >= a.date)))
"""


def on_duty_counts(conn, unit_id, date_from, date_to):
    """{(date, shift): (on_duty, seniors_on_duty)} from the one On-duty rule."""
    rows = conn.execute(
        f"""
        select a.date, a.shift, count(*) as on_duty,
               count(*) filter (where p.skill = 'senior') as seniors
        from assignments a join people p on p.id = a.person_id
        where a.unit_id = $1 and a.date between $2 and $3 and {AWAY_SQL}
        group by a.date, a.shift
        """, [unit_id, date_from.isoformat(), date_to.isoformat()])
    return {(dc.d(r[0]), dc.s(r[1])): (int(r[2].decode()), int(r[3].decode()))
            for r in rows}


def away_sets(conn, unit_id, date_from, date_to):
    """{date: set(person_id)} for people with assignments in the window who are away."""
    rows = conn.execute(
        f"""
        select distinct a.date, a.person_id from assignments a
        where a.unit_id = $1 and a.date between $2 and $3 and not ({AWAY_SQL})
        """, [unit_id, date_from.isoformat(), date_to.isoformat()])
    out = {}
    for r in rows:
        out.setdefault(dc.d(r[0]), set()).add(dc.s(r[1]))
    return out


def absence_kind_for(conn, person_id, date):
    """Sickness takes precedence over approved leave for managers' rota view."""
    rows = conn.execute(
        "select start_date, last_sick_date, status from sickness where person_id = $1"
        " and start_date <= $2"
        " and ((last_sick_date is null and status != 'closed')"
        " or (last_sick_date is not null and last_sick_date >= $2))",
        [person_id, date.isoformat()])
    if rows:
        return "sickness"
    rows = conn.execute(
        "select type from leave_requests where requester_id = $1 and status = 'approved'"
        " and start_date <= $2 and end_date >= $2",
        [person_id, date.isoformat()])
    if rows:
        return dc.s(rows[0][0])
    return None


def effective_floor(conn, unit_id, shift, date):
    """The floor version with the latest effective_from on or before the date."""
    rows = conn.execute(
        "select min_staff, min_seniors, effective_from from floor_versions"
        " where unit_id = $1 and shift = $2 and effective_from <= $3"
        " order by effective_from desc limit 1",
        [unit_id, shift, date.isoformat()])
    if not rows:
        return None
    r = rows[0]
    return {"min_staff": dc.i(r[0]), "min_seniors": dc.i(r[1]),
            "effective_from": dc.d(r[2]).isoformat()}


def shortfalls(on_duty, seniors, floor):
    shortfall = max(0, floor["min_staff"] - on_duty)
    senior_shortfall = max(0, floor["min_seniors"] - seniors)
    return shortfall, senior_shortfall


def breach_labels(shortfall, senior_shortfall):
    """The one breach-label rule."""
    labels = []
    if shortfall > 0:
        labels.append(f"-{shortfall} below floor")
    if senior_shortfall > 0:
        labels.append("no senior on shift")
    return labels


def today_status(shortfall, senior_shortfall):
    labels = breach_labels(shortfall, senior_shortfall)
    if not labels:
        return "At floor"
    return ", ".join(labels)


# --- attendance ---------------------------------------------------------------


def attendance_row(r):
    return {"id": dc.s(r[0]), "person_id": dc.s(r[1]), "home_id": dc.s(r[2]),
            "unit_id": dc.s(r[3]), "assignment_id": dc.s(r[4]), "date": dc.d(r[5]),
            "shift": dc.s(r[6]), "rostered_start": dc.t(r[7]), "rostered_end": dc.t(r[8]),
            "clock_in_at": dc.t(r[9]), "clock_out_at": dc.t(r[10]),
            "worked_seconds": dc.i(r[11]), "late": r[12] == b"t",
            "late_acknowledged": r[13] == b"t", "correction_note": dc.s(r[14]),
            "version": dc.i(r[15])}


ATTENDANCE_COLS = ("id, person_id, home_id, unit_id, assignment_id, date, shift,"
                   " rostered_start, rostered_end, clock_in_at, clock_out_at,"
                   " worked_seconds, late, late_acknowledged, correction_note, version")


def fetch_attendance(conn, attendance_id):
    rows = conn.execute(f"select {ATTENDANCE_COLS} from attendance where id = $1",
                        [attendance_id])
    return attendance_row(rows[0]) if rows else None


def is_open(attendance, at=None):
    """Whether an attendance without a clock-out is still open, by the server clock."""
    if attendance["clock_out_at"] is not None:
        return False
    at_epoch = domain.epoch(at) if at is not None else domain.current_epoch()
    return at_epoch < domain.epoch(attendance["rostered_end"]) + 4 * 3600


def open_attendance_for(conn, person_id):
    rows = conn.execute(
        f"select {ATTENDANCE_COLS} from attendance"
        " where person_id = $1 and clock_out_at is null order by rostered_start desc",
        [person_id])
    for r in rows:
        att = attendance_row(r)
        if is_open(att):
            return att
    return None


def attendance_is_missed(att):
    return att["clock_out_at"] is None and not is_open(att)


# --- sickness -----------------------------------------------------------------


def sickness_days(rec, today=None):
    """Days from the start to the last sick day, or today while open."""
    today = today or domain.today()
    end = rec["last_sick_date"] or today
    return (end - rec["start_date"]).days + 1


def refresh_sickness_status(conn, rec, today=None):
    """The one fit-note-required rule: more than seven days moves the record on."""
    today = today or domain.today()
    if rec["status"] == "reported" and rec["last_sick_date"] is None and \
            sickness_days(rec, today) > 7:
        conn.execute("update sickness set status = 'fit_note_required' where id = $1",
                     [rec["id"]])
        rec["status"] = "fit_note_required"
    return rec


def sweep_all_sickness(conn):
    """Apply the same rule to every open record, for the background sweep."""
    today = domain.today()
    rows = conn.execute(
        "select id, start_date, last_sick_date, status from sickness"
        " where status = 'reported' and last_sick_date is null")
    for r in rows:
        rec = {"id": dc.s(r[0]), "start_date": dc.d(r[1]), "last_sick_date": dc.d(r[2]),
               "status": dc.s(r[3])}
        refresh_sickness_status(conn, rec, today)


# --- leave requests -----------------------------------------------------------


def leave_request_row(r):
    return {"id": dc.s(r[0]), "requester_id": dc.s(r[1]), "home_id": dc.s(r[2]),
            "unit_id": dc.s(r[3]), "type": dc.s(r[4]), "start_date": dc.d(r[5]),
            "end_date": dc.d(r[6]), "hours": dc.hours(r[7]), "status": dc.s(r[8]),
            "short_notice": r[9] == b"t", "note": dc.s(r[10]),
            "submitted_at": dc.t(r[11]), "decided_at": dc.t(r[12]),
            "decided_by": dc.s(r[13]), "decision_reason": dc.s(r[14])}


LEAVE_COLS = ("id, requester_id, home_id, unit_id, type, start_date, end_date, hours,"
              " status, short_notice, note, submitted_at, decided_at, decided_by,"
              " decision_reason")


def fetch_leave_request(conn, request_id):
    rows = conn.execute(f"select {LEAVE_COLS} from leave_requests where id = $1",
                        [request_id])
    return leave_request_row(rows[0]) if rows else None


def sickness_covers_dates(rec, date):
    """The one date rule for sickness coverage."""
    if rec["start_date"] > date:
        return False
    if rec["last_sick_date"] is not None:
        return rec["last_sick_date"] >= date
    return rec["status"] != "closed"


def sickness_hours_for_request(conn, request, now=None):
    """Hours of the requester's rostered shifts inside the request that are sick-covered."""
    rows = conn.execute(
        "select a.date, a.shift, a.starts_at, a.ends_at from assignments a"
        " where a.person_id = $1 and a.date between $2 and $3",
        [request["requester_id"], request["start_date"].isoformat(),
         request["end_date"].isoformat()])
    sick = conn.execute(
        "select start_date, last_sick_date, status from sickness where person_id = $1",
        [request["requester_id"]])
    records = [{"start_date": dc.d(r[0]), "last_sick_date": dc.d(r[1]),
                "status": dc.s(r[2])} for r in sick]
    total = 0.0
    for r in rows:
        date = dc.d(r[0])
        shift = dc.s(r[1])
        if any(sickness_covers_dates(rec, date) for rec in records):
            total += domain.shift_hours(date, shift)
    return min(total, request["hours"])


def leave_request_body(conn, request, requester=None):
    requester = requester or get_person(conn, request["requester_id"])
    decided_by = None
    if request["decided_by"]:
        decider = get_person(conn, request["decided_by"])
        decided_by = {"id": decider["id"], "display_name": decider["display_name"]}
    return {"id": request["id"],
            "requester": {"id": requester["id"], "display_name": requester["display_name"]},
            "home_id": request["home_id"], "unit_id": request["unit_id"],
            "type": request["type"], "start_date": request["start_date"].isoformat(),
            "end_date": request["end_date"].isoformat(),
            "length_days": (request["end_date"] - request["start_date"]).days + 1,
            "hours": domain.hours_str(request["hours"]),
            "sickness_hours": domain.hours_str(
                sickness_hours_for_request(conn, request)),
            "note": request["note"], "status": request["status"],
            "short_notice": request["short_notice"],
            "submitted_at": domain.iso_instant(request["submitted_at"]) if request["submitted_at"] else None,
            "decided_at": domain.iso_instant(request["decided_at"]) if request["decided_at"] else None,
            "decided_by": decided_by, "decision_reason": request["decision_reason"]}
