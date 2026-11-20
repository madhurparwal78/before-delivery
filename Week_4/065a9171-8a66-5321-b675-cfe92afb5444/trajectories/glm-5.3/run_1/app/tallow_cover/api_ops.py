"""Rota, the people picker, Today, attendance corrections, floors and policy."""
import datetime as dt
import json

from . import decode as dc
from . import domain, helpers, repo
from .domain import SHIFTS
from .errors import ApiError, validation
from .store import new_id
from .web import Response

MGR = ["unit_manager", "hr_admin"]
CW_BC = ["care_worker", "bank_carer"]


def register(app):
    store = app.store

    def home_visible(conn, person, home_id):
        """Any id outside what the caller may see answers not_found."""
        if home_id is None:
            raise ApiError("not_found")
        rows = conn.execute("select id from homes where id = $1", [home_id])
        if not rows:
            raise ApiError("not_found")
        if person["role"] == "unit_manager" and person["home_id"] != home_id:
            raise ApiError("not_found")
        return home_id

    # ---- rota and assignments ----------------------------------------------

    @app.route("GET", r"^/api/units/(?P<unit_id>[^/]+)/rota$",
               roles=CW_BC + MGR)
    def unit_rota(request, unit_id):
        conn = store.connect()
        try:
            rows = conn.execute("select home_id from units where id = $1", [unit_id])
            if not rows:
                raise ApiError("not_found")
            home_id = dc.s(rows[0][0])
            person = request.person
            if person["role"] in CW_BC:
                if person["home_id"] != home_id:
                    raise ApiError("not_found")
            elif person["role"] == "unit_manager" and person["home_id"] != home_id:
                raise ApiError("not_found")
            from_raw = request.query.get("from")
            from_date = domain.parse_date(from_raw) if from_raw else None
            if from_raw and from_date is None:
                raise ApiError("not_found")
            if from_date is None:
                from_date = domain.week_monday(domain.today())
            to_date = from_date + dt.timedelta(days=6)
            with_kind = person["role"] in MGR
            entries = helpers.rota_entries(conn, unit_id, from_date, to_date,
                                           person["id"], with_kind)
            return Response(200, {"unit_id": unit_id,
                                  "from": from_date.isoformat(),
                                  "to": to_date.isoformat(),
                                  "entries": entries})
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/rota/assignments$", roles=MGR)
    def add_assignment(request):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                errors = helpers.check_unknown_keys(
                    data, {"person_id", "unit_id", "date", "shift"})
                target = repo.get_person(conn, data.get("person_id"))
                if target is None or target["role"] not in ("care_worker", "bank_carer"):
                    errors.setdefault("person_id",
                                      "Only care workers and bank carers can be rostered.")
                unit_rows = conn.execute("select home_id from units where id = $1",
                                         [data.get("unit_id")])
                if not unit_rows:
                    raise ApiError("not_found")
                unit_home = dc.s(unit_rows[0][0])
                if request.person["role"] == "unit_manager" and \
                        request.person["home_id"] != unit_home:
                    raise ApiError("not_found")
                date = domain.parse_date(data.get("date"))
                if date is None:
                    errors.setdefault("date", "Choose a date.")
                shift = data.get("shift")
                if shift not in SHIFTS:
                    errors.setdefault("shift", "Choose Early, Late or Night.")
                if errors:
                    raise validation(errors)
                start, end = domain.shift_bounds(date, shift)
                clash = conn.execute(
                    "select 1 from assignments where person_id = $1"
                    " and starts_at < $2 and ends_at > $3",
                    [target["id"], end.isoformat(), start.isoformat()])
                if clash:
                    raise ApiError("overlapping_shift")
                assignment_id = new_id()
                conn.execute(
                    "insert into assignments (id, person_id, unit_id, date, shift,"
                    " starts_at, ends_at) values ($1,$2,$3,$4,$5,$6,$7)",
                    [assignment_id, target["id"], data["unit_id"], date.isoformat(),
                     shift, start.isoformat(), end.isoformat()])
                row = conn.execute(
                    "select a.person_id, p.display_name, p.skill, a.date, a.shift,"
                    " a.starts_at, a.ends_at, a.id, true from assignments a"
                    " join people p on p.id = a.person_id where a.id = $1",
                    [assignment_id])[0]
                date2 = dc.d(row[3])
                entry = {"assignment_id": dc.s(row[7]),
                         "person": {"id": dc.s(row[0]), "display_name": dc.s(row[1])},
                         "date": date2.isoformat(), "shift": dc.s(row[4]),
                         "starts_at": domain.iso_instant(dc.t(row[5])),
                         "ends_at": domain.iso_instant(dc.t(row[6])),
                         "hours": domain.hours_str(domain.shift_hours(date2, dc.s(row[4]))),
                         "status": "on", "is_you": False}
                if request.person["role"] in MGR:
                    entry["absence_kind"] = None
                return entry
            entry = store.tx(conn, run)
            return Response(201, entry)
        finally:
            store.release(conn)

    @app.route("DELETE", r"^/api/rota/assignments/(?P<aid>[^/]+)$", roles=MGR)
    def remove_assignment(request, aid):
        conn = store.connect()
        try:
            def run(conn):
                rows = conn.execute(
                    "select a.person_id, a.unit_id, u.home_id from assignments a"
                    " join units u on u.id = a.unit_id where a.id = $1", [aid])
                if not rows:
                    raise ApiError("not_found")
                home_id = dc.s(rows[0][2])
                if request.person["role"] == "unit_manager" and \
                        request.person["home_id"] != home_id:
                    raise ApiError("not_found")
                taken = conn.execute(
                    "select 1 from attendance where assignment_id = $1", [aid])
                if taken:
                    raise ApiError("has_attendance")
                conn.execute("update covers set status = 'cancelled', assignment_id = null"
                             " where assignment_id = $1 and status = 'claimed'", [aid])
                conn.execute("delete from assignments where id = $1", [aid])
            store.tx(conn, run)
            return Response(204, None)
        finally:
            store.release(conn)

    # ---- people picker ------------------------------------------------------

    @app.route("GET", r"^/api/homes/(?P<home_id>[^/]+)/people$", roles=MGR)
    def people(request, home_id):
        conn = store.connect()
        try:
            home_visible(conn, request.person, home_id)
            q = request.query.get("q", "").strip().lower()
            rows = conn.execute(
                "select p.id, p.display_name, p.role, p.skill from people p"
                " where (p.home_id = $1 and p.role = 'care_worker')"
                " or (p.role = 'bank_carer' and exists"
                " (select 1 from credentials c where c.person_id = p.id and c.home_id = $1))"
                " order by p.display_name asc", [home_id])
            items = []
            for r in rows:
                display_name = dc.s(r[1])
                if q and q not in display_name.lower() and q not in dc.s(r[0]).lower():
                    continue
                items.append({"id": dc.s(r[0]), "display_name": display_name,
                              "role": dc.s(r[2]), "skill": dc.s(r[3])})
                if len(items) == 20:
                    break
            return Response(200, {"items": items})
        finally:
            store.release(conn)

    # ---- today -------------------------------------------------------------

    @app.route("GET", r"^/api/homes/(?P<home_id>[^/]+)/today$", roles=MGR)
    def today(request, home_id):
        conn = store.connect()
        try:
            home_visible(conn, request.person, home_id)
            date = domain.today()
            units = conn.execute(
                "select id, name from units where home_id = $1 order by name", [home_id])
            unit_blocks = []
            total_on = 0
            total_seniors = 0
            below_floor = 0
            for u in units:
                unit_id, unit_name = dc.s(u[0]), dc.s(u[1])
                counts = repo.on_duty_counts(conn, unit_id, date, date)
                shifts = []
                for shift in SHIFTS:
                    on_duty, seniors = counts.get((date, shift), (0, 0))
                    floor = repo.effective_floor(conn, unit_id, shift, date) or \
                        {"min_staff": 0, "min_seniors": 0, "effective_from": None}
                    shortfall, senior_shortfall = repo.shortfalls(on_duty, seniors, floor)
                    if shortfall > 0 or senior_shortfall > 0:
                        below_floor += 1
                    total_on += on_duty
                    total_seniors += seniors
                    shifts.append({
                        "shift": shift, "on_duty": on_duty,
                        "seniors_on_duty": seniors,
                        "floor": {"min_staff": floor["min_staff"],
                                  "min_seniors": floor["min_seniors"]},
                        "shortfall": shortfall,
                        "senior_shortfall": senior_shortfall})
                unit_blocks.append({"unit_id": unit_id, "name": unit_name,
                                    "shifts": shifts})
            week_start = date - dt.timedelta(days=6)
            late_rows = conn.execute(
                f"select {repo.ATTENDANCE_COLS} from attendance"
                " where home_id = $1 and date = $2 and late and not late_acknowledged"
                " order by clock_in_at asc", [home_id, date.isoformat()])
            missed_rows = conn.execute(
                f"select {repo.ATTENDANCE_COLS} from attendance"
                " where home_id = $1 and date between $2 and $3 and clock_out_at is null"
                " and rostered_end + interval '4 hours' <= now()"
                " order by rostered_start asc",
                [home_id, week_start.isoformat(), date.isoformat()])
            return Response(200, {
                "date": date.isoformat(),
                "units": unit_blocks,
                "totals": {"on_duty": total_on, "seniors_on_duty": total_seniors,
                           "below_floor": below_floor},
                "late_clock_ins": [helpers.attendance_body_with_person(
                    conn, repo.attendance_row(r)) for r in late_rows],
                "missed_clock_outs": [helpers.attendance_body_with_person(
                    conn, repo.attendance_row(r)) for r in missed_rows]})
        finally:
            store.release(conn)

    # ---- attendance ---------------------------------------------------------

    @app.route("GET", r"^/api/homes/(?P<home_id>[^/]+)/attendance$", roles=MGR)
    def home_attendance(request, home_id):
        conn = store.connect()
        try:
            home_visible(conn, request.person, home_id)
            date = domain.parse_date(request.query.get("date"))
            if date is None:
                raise ApiError("not_found")
            rows = conn.execute(
                f"select {repo.ATTENDANCE_COLS} from attendance"
                " where home_id = $1 and date = $2 order by rostered_start asc,"
                " person_id", [home_id, date.isoformat()])
            return Response(200, {"items": [
                helpers.attendance_body_with_person(conn, repo.attendance_row(r))
                for r in rows]})
        finally:
            store.release(conn)

    def parse_correction_instants(data, att):
        """Clock-in within 4 hours of the rostered start; clock-out after clock-in."""
        errors = {}
        clock_in = domain.parse_instant(data.get("clock_in_at"))
        clock_out = None if data.get("clock_out_at") in (None, "") else \
            domain.parse_instant(data.get("clock_out_at"))
        if clock_in is None:
            errors["clock_in_at"] = "Use a full date and time with a UTC offset."
        elif abs(domain.elapsed_seconds(att["rostered_start"], clock_in)) > 4 * 3600:
            errors["clock_in_at"] = "Clock in must be within 4 hours of the rostered start."
        if data.get("clock_out_at") not in (None, ""):
            if clock_out is None:
                errors["clock_out_at"] = "Use a full date and time with a UTC offset."
            elif clock_in and clock_out <= clock_in:
                errors["clock_out_at"] = "Clock out must be after clock in."
        return errors, clock_in, clock_out

    def write_attendance_audit(conn, actor, action, home_id, target_id,
                               before, after, reason):
        conn.execute(
            "insert into audit (id, actor_id, actor_name, actor_role, action, home_id,"
            " target_type, target_id, before, after, reason)"
            " values ($1,$2,$3,$4,$5,$6,'attendance',$7,$8,$9,$10)",
            [new_id(), actor["id"], actor["display_name"], actor["role"], action,
             home_id, target_id,
             json.dumps(before) if before else None,
             json.dumps(after), reason])

    @app.route("POST", r"^/api/attendance$", roles=MGR)
    def add_attendance(request):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                errors = helpers.check_unknown_keys(
                    data, {"assignment_id", "clock_in_at", "clock_out_at", "reason"})
                reason = data.get("reason")
                if not isinstance(reason, str) or not (1 <= len(reason.strip()) <= 500):
                    errors.setdefault("reason", "Give a reason of 1 to 500 characters.")
                rows = conn.execute(
                    "select a.id, a.person_id, a.unit_id, a.date, a.shift, a.starts_at,"
                    " a.ends_at, u.home_id from assignments a"
                    " join units u on u.id = a.unit_id where a.id = $1",
                    [data.get("assignment_id")])
                if not rows:
                    raise ApiError("not_found")
                home_id = dc.s(rows[0][7])
                if request.person["role"] == "unit_manager" and \
                        request.person["home_id"] != home_id:
                    raise ApiError("not_found")
                taken = conn.execute(
                    "select 1 from attendance where assignment_id = $1",
                    [data["assignment_id"]])
                if taken:
                    raise ApiError("attendance_exists")
                att_stub = {"rostered_start": dc.t(rows[0][5])}
                inst_errors, clock_in, clock_out = parse_correction_instants(
                    data, att_stub)
                errors.update(inst_errors)
                if errors:
                    raise validation(errors)
                attendance_id = new_id()
                late = domain.elapsed_seconds(dc.t(rows[0][5]), clock_in) > 600
                worked = int(domain.elapsed_seconds(clock_in, clock_out)) if clock_out else None
                conn.execute(
                    "insert into attendance (id, person_id, home_id, unit_id,"
                    " assignment_id, date, shift, rostered_start, rostered_end,"
                    " clock_in_at, clock_out_at, worked_seconds, late, correction_note,"
                    " version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1)",
                    [attendance_id, dc.s(rows[0][1]), home_id, dc.s(rows[0][2]),
                     data["assignment_id"], dc.d(rows[0][3]).isoformat(),
                     dc.s(rows[0][4]), rows[0][5].decode(), rows[0][6].decode(),
                     clock_in.isoformat(),
                     clock_out.isoformat() if clock_out else None,
                     worked, late, reason])
                att = repo.fetch_attendance(conn, attendance_id)
                write_attendance_audit(conn, request.person, "attendance_added",
                                       home_id, attendance_id, None,
                                       helpers.attendance_body_with_person(conn, att),
                                       reason)
                return att
            att = store.tx(conn, run)
            return Response(201, helpers.attendance_body_with_person(conn, att))
        finally:
            store.release(conn)

    @app.route("PATCH", r"^/api/attendance/(?P<aid>[^/]+)$", roles=MGR)
    def correct_attendance(request, aid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                conn.execute("select id from attendance where id = $1 for update", [aid])
                att = repo.fetch_attendance(conn, aid)
                if att is None:
                    raise ApiError("not_found")
                if request.person["role"] == "unit_manager" and \
                        request.person["home_id"] != att["home_id"]:
                    raise ApiError("not_found")
                if_match = request.headers.get("If-Match", "")
                version_text = if_match.strip('"')
                if not if_match:
                    raise ApiError("version_required")
                try:
                    version = int(version_text)
                except ValueError:
                    raise ApiError("stale_version", current=helpers.attendance_body_with_person(conn, att))
                if version != att["version"]:
                    raise ApiError("stale_version",
                                   current=helpers.attendance_body_with_person(conn, att))
                errors = helpers.check_unknown_keys(
                    data, {"clock_in_at", "clock_out_at", "reason"})
                reason = data.get("reason")
                if not isinstance(reason, str) or not (1 <= len(reason.strip()) <= 500):
                    errors.setdefault("reason", "Give a reason of 1 to 500 characters.")
                inst_errors, clock_in, clock_out = parse_correction_instants(data, att)
                errors.update(inst_errors)
                if errors:
                    raise validation(errors)
                before_body = helpers.attendance_body_with_person(conn, att)
                late = domain.elapsed_seconds(att["rostered_start"], clock_in) > 600
                worked = int(domain.elapsed_seconds(clock_in, clock_out)) if clock_out else None
                conn.execute(
                    "update attendance set clock_in_at = $1, clock_out_at = $2,"
                    " worked_seconds = $3, late = $4, late_acknowledged = false,"
                    " correction_note = $5, version = version + 1 where id = $6",
                    [clock_in.isoformat(),
                     clock_out.isoformat() if clock_out else None,
                     worked, late, reason, aid])
                after = repo.fetch_attendance(conn, aid)
                write_attendance_audit(conn, request.person, "attendance_corrected",
                                       att["home_id"], aid, before_body,
                                       helpers.attendance_body_with_person(conn, after),
                                       reason)
                return after
            att = store.tx(conn, run)
            return Response(200, helpers.attendance_body_with_person(conn, att))
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/attendance/(?P<aid>[^/]+)/acknowledge$", roles=MGR)
    def acknowledge(request, aid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                conn.execute("select id from attendance where id = $1 for update", [aid])
                att = repo.fetch_attendance(conn, aid)
                if att is None:
                    raise ApiError("not_found")
                if request.person["role"] == "unit_manager" and \
                        request.person["home_id"] != att["home_id"]:
                    raise ApiError("not_found")
                unknown = helpers.check_unknown_keys(data, {})
                if unknown:
                    raise validation(unknown)
                if not att["late"]:
                    raise ApiError("not_late")
                conn.execute("update attendance set late_acknowledged = true,"
                             " version = version + 1 where id = $1", [aid])
                return repo.fetch_attendance(conn, aid)
            att = store.tx(conn, run)
            return Response(200, helpers.attendance_body_with_person(conn, att))
        finally:
            store.release(conn)

    # ---- floors and policy -------------------------------------------------

    def floor_version_body(conn, r):
        creator = repo.get_person(conn, dc.s(r[6]))
        return {"id": dc.s(r[0]), "unit_id": dc.s(r[1]), "shift": dc.s(r[2]),
                "min_staff": dc.i(r[3]), "min_seniors": dc.i(r[4]),
                "effective_from": dc.d(r[5]).isoformat(),
                "created_by": {"id": creator["id"],
                               "display_name": creator["display_name"]},
                "created_at": domain.iso_instant(dc.t(r[7]))}

    FLOOR_COLS = ("id, unit_id, shift, min_staff, min_seniors, effective_from,"
                  " created_by, created_at")

    @app.route("GET", r"^/api/homes/(?P<home_id>[^/]+)/floors$", roles=MGR)
    def floors(request, home_id):
        conn = store.connect()
        try:
            home_visible(conn, request.person, home_id)
            rows = conn.execute(
                f"select {FLOOR_COLS} from floor_versions"
                " where unit_id in (select id from units where home_id = $1)"
                " order by effective_from desc, unit_id, shift", [home_id])
            return Response(200, {"versions": [floor_version_body(conn, r)
                                               for r in rows]})
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/homes/(?P<home_id>[^/]+)/floors$", roles=["hr_admin"])
    def add_floor(request, home_id):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                home_visible(conn, request.person, home_id)
                errors = helpers.check_unknown_keys(
                    data, {"unit_id", "shift", "min_staff", "min_seniors",
                            "effective_from"})
                unit_rows = conn.execute(
                    "select id from units where id = $1 and home_id = $2",
                    [data.get("unit_id"), home_id])
                if not unit_rows:
                    errors.setdefault("unit_id", "Choose a unit of this home.")
                shift = data.get("shift")
                if shift not in SHIFTS:
                    errors.setdefault("shift", "Choose Early, Late or Night.")
                min_staff = _whole(data.get("min_staff"))
                if min_staff is None or not (0 <= min_staff <= 30):
                    errors.setdefault("min_staff", "Use a whole number from 0 to 30.")
                min_seniors = _whole(data.get("min_seniors"))
                if min_seniors is None or (min_staff is not None and
                                           (min_seniors < 0 or min_seniors > min_staff)):
                    errors.setdefault(
                        "min_seniors",
                        "Use a whole number no larger than the minimum staff.")
                effective = domain.parse_date(data.get("effective_from"))
                if effective is None or effective <= domain.today():
                    errors.setdefault("effective_from", "Choose a date after today.")
                if errors:
                    raise validation(errors)
                clash = conn.execute(
                    "select 1 from floor_versions where unit_id = $1 and shift = $2"
                    " and effective_from = $3",
                    [data["unit_id"], shift, effective.isoformat()])
                if clash:
                    raise ApiError("version_exists")
                version_id = new_id()
                conn.execute(
                    "insert into floor_versions (id, unit_id, shift, min_staff,"
                    " min_seniors, effective_from, created_by)"
                    " values ($1,$2,$3,$4,$5,$6,$7)",
                    [version_id, data["unit_id"], shift, min_staff, min_seniors,
                     effective.isoformat(), request.person["id"]])
                row = conn.execute(
                    f"select {FLOOR_COLS} from floor_versions where id = $1",
                    [version_id])[0]
                after = floor_version_body(conn, row)
                write_version_audit(conn, request.person, "floor_version_added",
                                    home_id, "floor_version", version_id, after)
                return after
            after = store.tx(conn, run)
            return Response(201, after)
        finally:
            store.release(conn)

    def _whole(value):
        if isinstance(value, bool) or not isinstance(value, int):
            return None
        return value

    def write_version_audit(conn, actor, action, home_id, target_type, target_id,
                            after):
        conn.execute(
            "insert into audit (id, actor_id, actor_name, actor_role, action, home_id,"
            " target_type, target_id, before, after, reason)"
            " values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9,null)",
            [new_id(), actor["id"], actor["display_name"], actor["role"], action,
             home_id, target_type, target_id, json.dumps(after)])

    def policy_version_body(conn, r):
        creator = repo.get_person(conn, dc.s(r[3]))
        return {"id": dc.s(r[0]), "notice_multiplier": dc.i(r[1]),
                "effective_from": dc.d(r[2]).isoformat(),
                "created_by": {"id": creator["id"],
                               "display_name": creator["display_name"]},
                "created_at": domain.iso_instant(dc.t(r[4]))}

    POLICY_COLS = "id, notice_multiplier, effective_from, created_by, created_at"

    @app.route("GET", r"^/api/homes/(?P<home_id>[^/]+)/leave-policy$", roles=MGR)
    def policy(request, home_id):
        conn = store.connect()
        try:
            home_visible(conn, request.person, home_id)
            rows = conn.execute(
                f"select {POLICY_COLS} from policy_versions where home_id = $1"
                " order by effective_from desc", [home_id])
            return Response(200, {"versions": [policy_version_body(conn, r)
                                               for r in rows]})
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/homes/(?P<home_id>[^/]+)/leave-policy$",
               roles=["hr_admin"])
    def add_policy(request, home_id):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                home_visible(conn, request.person, home_id)
                errors = helpers.check_unknown_keys(
                    data, {"notice_multiplier", "effective_from"})
                multiplier = _whole(data.get("notice_multiplier"))
                if multiplier is None or not (0 <= multiplier <= 6):
                    errors.setdefault("notice_multiplier",
                                      "Use a whole number from 0 to 6.")
                effective = domain.parse_date(data.get("effective_from"))
                if effective is None or effective <= domain.today():
                    errors.setdefault("effective_from", "Choose a date after today.")
                if errors:
                    raise validation(errors)
                clash = conn.execute(
                    "select 1 from policy_versions where home_id = $1"
                    " and effective_from = $2", [home_id, effective.isoformat()])
                if clash:
                    raise ApiError("version_exists")
                version_id = new_id()
                conn.execute(
                    "insert into policy_versions (id, home_id, notice_multiplier,"
                    " effective_from, created_by) values ($1,$2,$3,$4,$5)",
                    [version_id, home_id, multiplier, effective.isoformat(),
                     request.person["id"]])
                row = conn.execute(
                    f"select {POLICY_COLS} from policy_versions where id = $1",
                    [version_id])[0]
                after = policy_version_body(conn, row)
                write_version_audit(conn, request.person, "policy_version_added",
                                    home_id, "policy_version", version_id, after)
                return after
            after = store.tx(conn, run)
            return Response(201, after)
        finally:
            store.release(conn)
