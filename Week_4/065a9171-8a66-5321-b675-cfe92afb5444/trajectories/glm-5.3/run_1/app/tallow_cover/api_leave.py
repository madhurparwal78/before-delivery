"""Leave requests: creation, editing, the transitions, the queue, preview and covers."""
import datetime as dt
import json

from . import decode as dc
from . import domain, helpers, mailer, repo, staffing
from .domain import SHIFTS
from .errors import ApiError, invalid_transition, validation
from .store import new_id
from .web import Response

TYPE_LABELS = helpers.TYPE_LABELS
DECIDERS = ["unit_manager", "hr_admin"]
CW_UM = ["care_worker", "unit_manager"]
ROLES = ["care_worker", "bank_carer", "unit_manager", "hr_admin"]


def register(app):
    store = app.store

    # ---- visibility --------------------------------------------------------

    def fetch_visible(conn, person, request_id):
        row = repo.fetch_leave_request(conn, request_id)
        if row is None:
            raise ApiError("not_found")
        if person["role"] == "hr_admin":
            return row
        if person["role"] == "unit_manager" and person["home_id"] == row["home_id"]:
            return row
        if person["id"] == row["requester_id"]:
            return row
        raise ApiError("not_found")

    def fetch_decidable(conn, person, request_id):
        row = repo.fetch_leave_request(conn, request_id)
        if row is None:
            raise ApiError("not_found")
        if person["role"] in ("care_worker", "bank_carer"):
            if person["id"] == row["requester_id"]:
                raise ApiError("forbidden")
            raise ApiError("not_found")
        if person["id"] == row["requester_id"]:
            raise ApiError("own_request")
        if person["role"] == "hr_admin":
            return row
        if person["home_id"] == row["home_id"]:
            return row
        raise ApiError("not_found")

    def leave_hours(conn, person_id, start_date, end_date):
        rows = conn.execute(
            "select date, shift from assignments where person_id = $1"
            " and date between $2 and $3",
            [person_id, start_date.isoformat(), end_date.isoformat()])
        return sum(domain.shift_hours(dc.d(r[0]), dc.s(r[1])) for r in rows)

    def effective_notice_multiplier(conn, home_id, date):
        rows = conn.execute(
            "select notice_multiplier from policy_versions where home_id = $1"
            " and effective_from <= $2 order by effective_from desc limit 1",
            [home_id, date.isoformat()])
        return dc.i(rows[0][0]) if rows else 2

    def validate_fields(conn, person, data, existing=None):
        """Field validation for create and edit; dates, note and shape."""
        errors = {}
        values = {}
        merged = dict(existing or {})
        for key in ("type", "start_date", "end_date", "note"):
            if key in data:
                merged[key] = data[key]
        type_ = merged.get("type")
        if type_ not in TYPE_LABELS:
            errors["type"] = "Choose annual, unpaid or compassionate leave."
        else:
            values["type"] = type_
        start = domain.parse_date(merged.get("start_date"))
        end = domain.parse_date(merged.get("end_date"))
        if start is None:
            errors["start_date"] = "Leave can't start in the past."
        else:
            values["start_date"] = start
        if end is None:
            errors["end_date"] = "The last day can't be before the first day."
        else:
            values["end_date"] = end
        note = merged.get("note")
        if note is not None and (not isinstance(note, str) or len(note) > 500):
            errors["note"] = "Keep the note to 500 characters or fewer."
        else:
            values["note"] = note
        if "start_date" in values and "end_date" in values:
            s, e = values["start_date"], values["end_date"]
            if e < s:
                errors["end_date"] = "The last day can't be before the first day."
            elif (e - s).days + 1 > 28:
                errors["end_date"] = "Leave can be at most 28 days."
            elif repo.leave_year_start(s) != repo.leave_year_start(e):
                errors["end_date"] = "Leave can't cross 31 March. Split it into two requests."
        return errors, values

    def balance_check(conn, person, values, request_id=None):
        """The submit-time balance check for annual leave."""
        if values["type"] != "annual":
            return
        hours = leave_hours(conn, person["id"], values["start_date"], values["end_date"])
        balance = repo.holiday_balance(conn, person["id"])
        remaining = float(balance["remaining_hours"])
        if hours > remaining:
            raise validation({"end_date":
                f"This needs {domain.hours_str(hours)} hours but you have "
                f"{balance['remaining_hours']} hours left."})

    def overlap_check(conn, person, values, request_id=None):
        rows = conn.execute(
            "select 1 from leave_requests where requester_id = $1"
            " and status in ('submitted','escalated','cover_pending','approved')"
            " and start_date <= $2 and end_date >= $3 and id <> coalesce($4, '')",
            [person["id"], values["end_date"].isoformat(),
             values["start_date"].isoformat(), request_id])
        if rows:
            raise ApiError("overlaps_existing_leave")

    def past_check(values):
        if values["start_date"] < domain.today():
            raise validation({"start_date": "Leave can't start in the past."})

    def submit(conn, request_id, person, values):
        hours = leave_hours(conn, person["id"], values["start_date"], values["end_date"])
        today = domain.today()
        multiplier = effective_notice_multiplier(conn, person["home_id"], today)
        length_days = (values["end_date"] - values["start_date"]).days + 1
        lead_days = (values["start_date"] - today).days
        short_notice = lead_days < multiplier * length_days
        conn.execute(
            "update leave_requests set status = 'submitted', hours = $1,"
            " short_notice = $2, submitted_at = now(), type = $3, start_date = $4,"
            " end_date = $5, note = $6 where id = $7",
            [str(hours), short_notice, values["type"],
             values["start_date"].isoformat(), values["end_date"].isoformat(),
             values["note"], request_id])
        return repo.fetch_leave_request(conn, request_id)

    def transition_allowed(row, action):
        """The leave request lifecycle: only these transitions are legal."""
        status = row["status"]
        if action == "edit":
            return status == "draft"
        if action == "submit":
            return status == "draft"
        if action == "withdraw":
            return status in ("draft", "submitted", "escalated", "cover_pending") or \
                status == "approved"
        if action == "approve":
            return status in ("submitted", "escalated", "cover_pending")
        if action == "decline":
            return status in ("submitted", "escalated", "cover_pending")
        if action == "cancel":
            return status == "approved"
        if action == "cover":
            return status in ("submitted", "escalated", "cover_pending")
        return False

    def require_transition(row, action):
        if not transition_allowed(row, action):
            raise invalid_transition(row["status"], action)

    # ---- create and edit ---------------------------------------------------

    @app.route("GET", r"^/api/me/leave-requests$", roles=CW_UM)
    def my_requests(request):
        conn = store.connect()
        try:
            rows = conn.execute(
                f"select {repo.LEAVE_COLS} from leave_requests where requester_id = $1"
                " order by created_at desc, id", [request.person["id"]])
            items = [repo.leave_request_body(conn, repo.leave_request_row(r))
                     for r in rows]
            return Response(200, {"items": items})
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/leave-requests$", roles=CW_UM)
    def create_request(request):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                """Conflicts first, validation last, by the one precedence order."""
                start = domain.parse_date(data.get("start_date"))
                end = domain.parse_date(data.get("end_date"))
                if start and end and end >= start:
                    overlap_check(conn, request.person,
                                  {"start_date": start, "end_date": end})
                errors, values = validate_fields(conn, request.person, data)
                unknown = helpers.check_unknown_keys(
                    data, {"type", "start_date", "end_date", "note", "submit"})
                errors.update(unknown)
                if errors:
                    raise validation(errors)
                submit_now = data.get("submit") is True
                if submit_now:
                    past_check(values)
                    balance_check(conn, request.person, values)
                request_id = new_id()
                hours = leave_hours(conn, request.person["id"],
                                    values["start_date"], values["end_date"])
                conn.execute(
                    "insert into leave_requests (id, requester_id, home_id, unit_id,"
                    " type, start_date, end_date, hours, status, short_notice, note)"
                    " values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',false,$9)",
                    [request_id, request.person["id"], request.person["home_id"],
                     request.person["unit_id"], values["type"],
                     values["start_date"].isoformat(), values["end_date"].isoformat(),
                     str(hours), values["note"]])
                if submit_now:
                    row = submit(conn, request_id, request.person, values)
                else:
                    row = repo.fetch_leave_request(conn, request_id)
                return row
            row = store.tx(conn, run)
            return Response(201, repo.leave_request_body(conn, row))
        finally:
            store.release(conn)

    @app.route("PATCH", r"^/api/leave-requests/(?P<rid>[^/]+)$", roles=CW_UM)
    def edit_request(request, rid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                row = fetch_visible(conn, request.person, rid)
                if request.person["id"] != row["requester_id"]:
                    raise ApiError("forbidden")
                require_transition(row, "edit")
                unknown = helpers.check_unknown_keys(
                    data, {"type", "start_date", "end_date", "note"})
                errors, values = validate_fields(conn, request.person, data,
                                                 existing={
                                                     "type": row["type"],
                                                     "start_date": row["start_date"].isoformat(),
                                                     "end_date": row["end_date"].isoformat(),
                                                     "note": row["note"]})
                errors.update(unknown)
                if errors:
                    raise validation(errors)
                hours = leave_hours(conn, request.person["id"],
                                    values["start_date"], values["end_date"])
                conn.execute(
                    "update leave_requests set type = $1, start_date = $2,"
                    " end_date = $3, note = $4, hours = $5 where id = $6",
                    [values["type"], values["start_date"].isoformat(),
                     values["end_date"].isoformat(), values["note"], str(hours), rid])
                return repo.fetch_leave_request(conn, rid)
            row = store.tx(conn, run)
            return Response(200, repo.leave_request_body(conn, row))
        finally:
            store.release(conn)

    @app.route("GET", r"^/api/leave-requests/(?P<rid>[^/]+)$",
               roles=CW_UM + DECIDERS)
    def get_request(request, rid):
        conn = store.connect()
        try:
            row = fetch_visible(conn, request.person, rid)
            return Response(200, repo.leave_request_body(conn, row))
        finally:
            store.release(conn)

    # ---- transitions -------------------------------------------------------

    @app.route("POST", r"^/api/leave-requests/(?P<rid>[^/]+)/submit$", roles=CW_UM)
    def submit_request(request, rid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                row = fetch_visible(conn, request.person, rid)
                if request.person["id"] != row["requester_id"]:
                    raise ApiError("forbidden")
                require_transition(row, "submit")
                unknown = helpers.check_unknown_keys(data, {})
                if unknown:
                    raise validation(unknown)
                overlap_check(conn, request.person,
                              {"start_date": row["start_date"],
                               "end_date": row["end_date"]}, request_id=rid)
                values = {"type": row["type"],
                          "start_date": row["start_date"].isoformat(),
                          "end_date": row["end_date"].isoformat(),
                          "note": row["note"]}
                errors, values = validate_fields(conn, request.person, values)
                if errors:
                    raise validation(errors)
                past_check(values)
                balance_check(conn, request.person, values, request_id=rid)
                return submit(conn, rid, request.person, values)
            row = store.tx(conn, run)
            return Response(200, repo.leave_request_body(conn, row))
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/leave-requests/(?P<rid>[^/]+)/withdraw$", roles=CW_UM)
    def withdraw_request(request, rid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                row = fetch_visible(conn, request.person, rid)
                if request.person["id"] != row["requester_id"]:
                    raise ApiError("forbidden")
                require_transition(row, "withdraw")
                unknown = helpers.check_unknown_keys(data, {})
                if unknown:
                    raise validation(unknown)
                if row["status"] == "approved":
                    if not withdrawal_still_allowed(conn, row):
                        raise ApiError("already_started")
                conn.execute("update leave_requests set status = 'withdrawn',"
                             " decided_at = now() where id = $1", [rid])
                cancel_open_covers(conn, rid)
                return repo.fetch_leave_request(conn, rid)
            row = store.tx(conn, run)
            return Response(200, repo.leave_request_body(conn, row))
        finally:
            store.release(conn)

    def withdrawal_still_allowed(conn, row):
        """Before the first affected shift starts, or before 00:00 on the start date."""
        now = domain.now()
        rows = conn.execute(
            "select starts_at from assignments where person_id = $1"
            " and date between $2 and $3 order by starts_at asc",
            [row["requester_id"], row["start_date"].isoformat(),
             row["end_date"].isoformat()])
        if rows:
            return domain.before(now, dc.t(rows[0][0]))
        start_local = dt.datetime.combine(row["start_date"], dt.time(0, 0),
                                          tzinfo=domain.LONDON)
        return domain.before(now, start_local)

    def cancel_open_covers(conn, request_id):
        conn.execute("update covers set status = 'cancelled'"
                     " where leave_request_id = $1 and status = 'open'", [request_id])

    @app.route("POST", r"^/api/leave-requests/(?P<rid>[^/]+)/approve$", roles=ROLES)
    def approve_request(request, rid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                row = fetch_decidable(conn, request.person, rid)
                require_transition(row, "approve")
                errors = helpers.check_unknown_keys(data, {"override_reason"})
                if errors:
                    raise validation(errors)
                override = data.get("override_reason")
                if override is not None and (not isinstance(override, str)
                                             or not (1 <= len(override.strip()) <= 500)):
                    raise validation({"override_reason":
                                     "Give a reason of 1 to 500 characters."})
                requester = repo.get_person(conn, row["requester_id"])
                breaches = staffing.check_approval_floor(conn, row, requester)
                if breaches and not override:
                    staffing.raise_floor_breach(breaches)
                before_body = repo.leave_request_body(conn, row, requester)
                conn.execute(
                    "update leave_requests set status = 'approved', decided_at = now(),"
                    " decided_by = $1, decision_reason = $2 where id = $3",
                    [request.person["id"], override, rid])
                if override and breaches:
                    after_row = repo.fetch_leave_request(conn, rid)
                    after_body = repo.leave_request_body(conn, after_row, requester)
                    after_body["breach_labels"] = [b["label"] for b in breaches]
                    write_audit(conn, request.person, "floor_override", row["home_id"],
                                "leave_request", rid, before_body, after_body, override)
                queue_decision_email(conn, row, requester, "approved", None,
                                     approver=request.person)
                return repo.fetch_leave_request(conn, rid)
            row = store.tx(conn, run)
            return Response(200, repo.leave_request_body(conn, row))
        finally:
            store.release(conn)

    def write_audit(conn, actor, action, home_id, target_type, target_id,
                    before, after, reason):
        """One append-only audit entry, with names copied at write time."""
        conn.execute(
            "insert into audit (id, actor_id, actor_name, actor_role, action, home_id,"
            " target_type, target_id, before, after, reason)"
            " values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [new_id(), actor["id"], actor["display_name"], actor["role"], action,
             home_id, target_type, target_id,
             json.dumps(before) if before is not None else None,
             json.dumps(after), reason])

    def queue_decision_email(conn, row, requester, outcome, reason, approver=None):
        """The one decision-email rule, composed into the outbox in-transaction."""
        if outcome == "approved":
            subject = (f"Leave approved: {domain.date_label(row['start_date'])}"
                       f" to {domain.date_label(row['end_date'])}")
            body = (f"Your {TYPE_LABELS[row['type']].lower()} from "
                    f"{domain.date_label(row['start_date'])} to "
                    f"{domain.date_label(row['end_date'])} has been approved by "
                    f"{approver['display_name']}."
                    f" It costs {domain.hours_str(row['hours'])} hours.")
        elif outcome == "declined":
            subject = (f"Leave declined: {domain.date_label(row['start_date'])}"
                       f" to {domain.date_label(row['end_date'])}")
            body = (f"Your {TYPE_LABELS[row['type']].lower()} from "
                    f"{domain.date_label(row['start_date'])} to "
                    f"{domain.date_label(row['end_date'])} was declined."
                    f" Reason: {reason}")
        else:
            subject = (f"Approved leave cancelled: {domain.date_label(row['start_date'])}"
                       f" to {domain.date_label(row['end_date'])}")
            body = (f"Your approved {TYPE_LABELS[row['type']].lower()} from "
                    f"{domain.date_label(row['start_date'])} to "
                    f"{domain.date_label(row['end_date'])} has been cancelled."
                    f" Reason: {reason}")
        mailer.queue_email(conn, requester["email"],
                           mailer.build_subject(subject), body)

    @app.route("POST", r"^/api/leave-requests/(?P<rid>[^/]+)/decline$", roles=ROLES)
    def decline_request(request, rid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                row = fetch_decidable(conn, request.person, rid)
                require_transition(row, "decline")
                errors = helpers.check_unknown_keys(data, {"reason"})
                reason = data.get("reason")
                if not isinstance(reason, str) or not (1 <= len(reason.strip()) <= 500):
                    errors.setdefault("reason", "Give a reason of 1 to 500 characters.")
                if errors:
                    raise validation(errors)
                conn.execute(
                    "update leave_requests set status = 'declined', decided_at = now(),"
                    " decided_by = $1, decision_reason = $2 where id = $3",
                    [request.person["id"], reason, rid])
                cancel_open_covers(conn, rid)
                requester = repo.get_person(conn, row["requester_id"])
                queue_decision_email(conn, row, requester, "declined", reason)
                return repo.fetch_leave_request(conn, rid)
            row = store.tx(conn, run)
            return Response(200, repo.leave_request_body(conn, row))
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/leave-requests/(?P<rid>[^/]+)/cancel$", roles=["hr_admin"])
    def cancel_request(request, rid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                row = fetch_decidable(conn, request.person, rid)
                require_transition(row, "cancel")
                errors = helpers.check_unknown_keys(data, {"reason"})
                reason = data.get("reason")
                if not isinstance(reason, str) or not (1 <= len(reason.strip()) <= 500):
                    errors.setdefault("reason", "Give a reason of 1 to 500 characters.")
                if errors:
                    raise validation(errors)
                conn.execute(
                    "update leave_requests set status = 'cancelled', decided_at = now(),"
                    " decided_by = $1, decision_reason = $2 where id = $3",
                    [request.person["id"], reason, rid])
                cancel_open_covers(conn, rid)
                requester = repo.get_person(conn, row["requester_id"])
                before_body = repo.leave_request_body(conn, row, requester)
                queue_decision_email(conn, row, requester, "cancelled", reason)
                write_audit(conn, request.person, "leave_cancelled", row["home_id"],
                            "leave_request", rid, before_body,
                            repo.leave_request_body(conn, repo.fetch_leave_request(conn, rid),
                                                    requester), reason)
                return repo.fetch_leave_request(conn, rid)
            row = store.tx(conn, run)
            return Response(200, repo.leave_request_body(conn, row))
        finally:
            store.release(conn)

    # ---- preview and covers ------------------------------------------------

    @app.route("GET", r"^/api/leave-requests/(?P<rid>[^/]+)/preview$", roles=DECIDERS)
    def preview(request, rid):
        conn = store.connect()
        try:
            row = fetch_decidable(conn, request.person, rid)
            from_raw = request.query.get("from")
            from_date = domain.parse_date(from_raw) if from_raw else row["start_date"]
            if from_date is None or not (row["start_date"] <= from_date
                                         <= row["end_date"]):
                raise validation({"from": "Choose a date inside this request."})
            requester = repo.get_person(conn, row["requester_id"])
            return Response(200, staffing.preview_body(conn, row, from_date, requester))
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/leave-requests/(?P<rid>[^/]+)/covers$", roles=ROLES)
    def post_cover(request, rid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                row = fetch_decidable(conn, request.person, rid)
                require_transition(row, "cover")
                errors = helpers.check_unknown_keys(data, {"date", "shift", "skill"})
                date = domain.parse_date(data.get("date"))
                shift = data.get("shift")
                skill = data.get("skill")
                if date is None:
                    errors.setdefault("date", "Choose a date inside this request.")
                if shift not in SHIFTS:
                    errors.setdefault("shift", "Choose Early, Late or Night.")
                if skill not in ("senior", "carer"):
                    errors.setdefault("skill", "Choose Senior or Carer.")
                if errors:
                    raise validation(errors)
                if row["unit_id"] is None:
                    raise ApiError("no_open_gap")
                if not (row["start_date"] <= date <= row["end_date"]):
                    raise ApiError("no_open_gap")
                requester = repo.get_person(conn, row["requester_id"])
                preview = staffing.preview_body(conn, row, row["start_date"], requester)
                shift_entry = None
                for entry in preview["shifts"]:
                    if entry["date"] == date.isoformat() and entry["shift"] == shift:
                        shift_entry = entry
                        break
                if shift_entry is None:
                    raise ApiError("no_open_gap")
                if skill == "senior" and not any(
                        g["skill"] == "senior" and g["cover"] is None
                        for g in shift_entry["gaps"]):
                    raise ApiError("no_open_gap")
                if skill == "carer" and not any(
                        g["skill"] == "carer" and g["cover"] is None
                        for g in shift_entry["gaps"]):
                    raise ApiError("no_open_gap")
                start, end = domain.shift_bounds(date, shift)
                cover_id = new_id()
                conn.execute(
                    "insert into covers (id, leave_request_id, unit_id, date, shift,"
                    " skill, status, starts_at, ends_at)"
                    " values ($1,$2,$3,$4,$5,$6,'open',$7,$8)",
                    [cover_id, rid, row["unit_id"], date.isoformat(), shift, skill,
                     start.isoformat(), end.isoformat()])
                if row["status"] in ("submitted", "escalated"):
                    conn.execute("update leave_requests set status = 'cover_pending'"
                                 " where id = $1", [rid])
                queue_cover_emails(conn, row, cover_id, date, shift, skill, start, end)
                return helpers.cover_row(conn, cover_id)
            cover = store.tx(conn, run)
            return Response(201, helpers.cover_body(conn, cover, True))
        finally:
            store.release(conn)

    def queue_cover_emails(conn, row, cover_id, date, shift, skill, start, end):
        """One email to each eligible bank carer, naming no one absent."""
        carers = conn.execute(
            "select p.id, p.email from people p join credentials c on c.person_id = p.id"
            " where p.role = 'bank_carer' and c.home_id = $1"
            " and (p.skill = 'senior' or $2 = 'carer')",
            [row["home_id"], skill])
        home = conn.execute("select name from homes where id = $1", [row["home_id"]])
        unit = conn.execute("select name from units where id = $1", [row["unit_id"]])
        home_name = dc.s(home[0][0])
        unit_name = dc.s(unit[0][0])
        label = domain.shift_label(date, shift)
        skill_name = "Senior" if skill == "senior" else "Carer"
        subject = f"Cover shift at {home_name}: {label}"
        body = (f"Cover is available at {home_name}, {unit_name}, {label} "
                f"({domain.hm(start)}\u2013{domain.hm(end)}), skill {skill_name}. "
                f"Open Tallow Cover and go to /cover to claim it.")
        for r in carers:
            mailer.queue_email(conn, dc.s(r[1]), mailer.build_subject(subject), body)

    # ---- queue -------------------------------------------------------------

    @app.route("GET", r"^/api/queue$", roles=DECIDERS)
    def queue(request):
        conn = store.connect()
        try:
            person = request.person
            home_filter = request.query.get("home")
            if person["role"] == "unit_manager":
                if home_filter and home_filter != person["home_id"]:
                    raise ApiError("not_found")
                home_filter = person["home_id"]
            elif home_filter:
                homes = conn.execute("select id from homes where id = $1", [home_filter])
                if not homes:
                    raise ApiError("not_found")
            status_filter = request.query.get("status", "open")
            if status_filter not in ("open", "submitted", "escalated", "cover_pending",
                                     "approved", "declined", "withdrawn", "cancelled"):
                raise validation({"status": "Choose a queue status."})
            week = request.query.get("week", "")
            week_monday = None
            if week:
                week_monday = domain.parse_iso_week(week)
                if week_monday is None:
                    raise validation({"week": "Choose an ISO week."})

            base_where = ["status <> 'draft'"]
            base_params = []
            if home_filter:
                base_where.append("home_id = $1")
                base_params.append(home_filter)
            if week_monday:
                base_where.append(f"start_date <= ${len(base_params) + 1}"
                                  f" and end_date >= ${len(base_params) + 2}")
                base_params += [(week_monday + dt.timedelta(days=6)).isoformat(),
                                week_monday.isoformat()]
            statuses = {"open": ("submitted", "escalated", "cover_pending")}.get(
                status_filter, (status_filter,))
            where = base_where + ["status in (" +
                                  ",".join(f"'{s}'" for s in statuses) + ")"]
            rows = conn.execute(
                f"select {repo.LEAVE_COLS} from leave_requests where "
                + " and ".join(where) + " order by created_at desc, id", base_params)
            items = [repo.leave_request_body(conn, repo.leave_request_row(r))
                     for r in rows]

            counts = {"submitted": 0, "escalated": 0, "cover_pending": 0,
                      "approved": 0, "declined": 0}
            count_rows = conn.execute(
                "select status, count(*) from leave_requests where "
                + " and ".join(base_where) + " group by status", base_params)
            for r in count_rows:
                key = dc.s(r[0])
                if key in counts:
                    counts[key] = dc.i(r[1])
            return Response(200, {"home_id": home_filter, "counts": counts,
                                  "items": items})
        finally:
            store.release(conn)
