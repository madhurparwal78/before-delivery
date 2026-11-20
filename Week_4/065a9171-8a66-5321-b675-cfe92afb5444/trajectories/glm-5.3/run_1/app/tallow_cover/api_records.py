"""Sickness, fit notes, cover claims, accrual, pay periods, exports and the audit log."""
import datetime as dt
import io
import json
import re

from . import decode as dc
from . import domain, helpers, repo, storage
from .errors import ApiError, invalid_transition, validation
from .store import new_id
from .web import Response, _parse_multipart

CW = ["care_worker"]
BC = ["bank_carer"]
MGR = ["unit_manager", "hr_admin"]

MAX_FIT_NOTE_BYTES = 5000000
CSV_HEADER = ("home,unit,staff_number,display_name,role,shift_date,shift,"
              "rostered_start,rostered_end,clock_in,clock_out,worked_hours,late,"
              "correction_note")


def register(app):
    store = app.store

    # ---- sickness ----------------------------------------------------------

    def sickness_row(conn, sid):
        rows = conn.execute(
            "select id, person_id, home_id, start_date, last_sick_date, status, reason,"
            " fit_note_uploaded_at, fit_note_file_name, fit_note_content_type,"
            " fit_note_storage_key, fit_note_storage"
            " from sickness where id = $1", [sid])
        if not rows:
            return None
        r = rows[0]
        return {"id": dc.s(r[0]), "person_id": dc.s(r[1]), "home_id": dc.s(r[2]),
                "start_date": dc.d(r[3]), "last_sick_date": dc.d(r[4]),
                "status": dc.s(r[5]), "reason": dc.s(r[6]),
                "fit_note_uploaded_at": dc.t(r[7]),
                "fit_note_file_name": dc.s(r[8]),
                "fit_note_content_type": dc.s(r[9]),
                "fit_note_storage_key": dc.s(r[10]),
                "fit_note_storage": dc.s(r[11])}

    sweep_sickness_status = repo.refresh_sickness_status
    sickness_days = repo.sickness_days

    def sickness_body(conn, rec, with_reason):
        person = repo.get_person(conn, rec["person_id"])
        body = {"id": rec["id"],
                "person": {"id": person["id"], "display_name": person["display_name"]},
                "start_date": rec["start_date"].isoformat(),
                "last_sick_date": rec["last_sick_date"].isoformat()
                if rec["last_sick_date"] else None,
                "status": rec["status"],
                "days": sickness_days(rec)}
        if with_reason:
            body["reason"] = rec["reason"]
            fit_note = None
            if rec["fit_note_file_name"]:
                fit_note = {"uploaded_at": domain.iso_instant(rec["fit_note_uploaded_at"]),
                            "file_name": rec["fit_note_file_name"],
                            "storage": rec["fit_note_storage"]}
            body["fit_note"] = fit_note
        return body

    def fetch_sickness(conn, person, sid):
        rec = sickness_row(conn, sid)
        if rec is None:
            raise ApiError("not_found")
        viewer = person
        if viewer["id"] == rec["person_id"]:
            return rec
        if viewer["role"] == "hr_admin":
            return rec
        if viewer["role"] == "unit_manager" and viewer["home_id"] == rec["home_id"]:
            return rec
        raise ApiError("not_found")

    @app.route("GET", r"^/api/me/sickness$", roles=CW)
    def my_sickness(request):
        conn = store.connect()
        try:
            rows = conn.execute(
                "select id from sickness where person_id = $1"
                " order by start_date desc, id", [request.person["id"]])
            items = []
            for r in rows:
                rec = sweep_sickness_status(conn, sickness_row(conn, dc.s(r[0])))
                items.append(sickness_body(conn, rec, True))
            return Response(200, {"items": items})
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/sickness$", roles=CW)
    def report_sickness(request):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                errors = helpers.check_unknown_keys(data, {"start_date", "reason"})
                start = domain.parse_date(data.get("start_date"))
                today = domain.today()
                if start is None or start < today - dt.timedelta(days=28) or start > today:
                    errors.setdefault("start_date",
                                     "Sickness can start up to 28 days ago and not in the future.")
                reason = data.get("reason")
                if not isinstance(reason, str) or not (1 <= len(reason.strip()) <= 500):
                    errors.setdefault("reason", "Give a reason of 1 to 500 characters.")
                if errors:
                    raise validation(errors)
                sid = new_id()
                conn.execute(
                    "insert into sickness (id, person_id, home_id, start_date, status,"
                    " reason) values ($1,$2,$3,$4,'reported',$5)",
                    [sid, request.person["id"], request.person["home_id"],
                     start.isoformat(), reason])
                rec = sweep_sickness_status(conn, sickness_row(conn, sid))
                return rec
            rec = store.tx(conn, run)
            return Response(201, sickness_body(conn, rec, True))
        finally:
            store.release(conn)

    @app.route("GET", r"^/api/sickness/(?P<sid>[^/]+)$", roles=CW + MGR)
    def get_sickness(request, sid):
        conn = store.connect()
        try:
            rec = fetch_sickness(conn, request.person, sid)
            sweep_sickness_status(conn, rec)
            with_reason = request.person["id"] == rec["person_id"] or \
                request.person["role"] == "hr_admin"
            return Response(200, sickness_body(conn, rec, with_reason))
        finally:
            store.release(conn)

    # ---- fit notes ---------------------------------------------------------

    def detect_file_type(payload):
        """The one content rule: bytes decide the type, never the name."""
        if payload.startswith(b"%PDF-") and b"%%EOF" in payload:
            return "application/pdf", "pdf"
        if payload.startswith(b"\xff\xd8\xff") and payload.endswith(b"\xff\xd9"):
            return "image/jpeg", "jpg"
        if payload.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in payload:
            return "image/png", "png"
        return None, None

    def clean_file_name(raw):
        """The last path segment, control characters removed, cut to 100 characters."""
        name = re.split(r"[/\\]", raw or "")[-1]
        name = "".join(ch for ch in name if ord(ch) >= 32)
        return name[:100]

    @app.route("POST", r"^/api/sickness/(?P<sid>[^/]+)/fit-note$", roles=CW)
    def upload_fit_note(request, sid):
        conn = store.connect()
        try:
            def run(conn):
                rec = fetch_sickness(conn, request.person, sid)
                if request.content_type != "multipart/form-data":
                    raise ApiError("unsupported_file", errors={
                        "file": "Upload a PDF, JPEG or PNG of your fit note."})
                boundary = None
                ctype = request.headers.get("Content-Type", "")
                match = re.search(r'boundary="?([^";]+)"?', ctype)
                if match:
                    boundary = match.group(1).encode()
                fields = _parse_multipart(request.body, boundary or b"")
                if "file" not in fields:
                    raise ApiError("unsupported_file", errors={
                        "file": "Upload a PDF, JPEG or PNG of your fit note."})
                raw_name, payload = fields["file"]
                if len(payload) > MAX_FIT_NOTE_BYTES:
                    raise ApiError("too_large")
                content_type, ext = detect_file_type(payload)
                if content_type is None:
                    raise ApiError("unsupported_file", errors={
                        "file": "Upload a PDF, JPEG or PNG of your fit note."})
                sweep_sickness_status(conn, rec)
                if rec["status"] not in ("reported", "fit_note_required"):
                    raise invalid_transition(rec["status"], "edited")
                file_name = clean_file_name(raw_name)
                upload_id = new_id()
                object_key = (f"fit-notes/{rec['home_id']}/{sid}/{upload_id}.{ext}")
                stored = app.storage.put(object_key, content_type, payload)
                if not stored:
                    conn.execute(
                        "insert into uploads (id, kind, object_key, content_type, bytes)"
                        " values ($1,'fit_note',$2,$3,$4)",
                        [upload_id, object_key, content_type, payload])
                conn.execute(
                    "update sickness set status = 'evidenced',"
                    " fit_note_uploaded_at = now(), fit_note_file_name = $1,"
                    " fit_note_content_type = $2, fit_note_storage_key = $3,"
                    " fit_note_storage = $4 where id = $5",
                    [file_name, content_type, object_key,
                     "stored" if stored else "pending", sid])
                return sickness_row(conn, sid)
            rec = store.tx(conn, run)
            return Response(201, sickness_body(conn, rec, True))
        finally:
            store.release(conn)

    @app.route("GET", r"^/api/sickness/(?P<sid>[^/]+)/fit-note$", roles=CW + ["hr_admin"])
    def open_fit_note(request, sid):
        conn = store.connect()
        try:
            rec = fetch_sickness(conn, request.person, sid)
            if rec["fit_note_file_name"] is None:
                raise ApiError("not_found")
            if rec["fit_note_storage"] == "pending":
                raise ApiError("storage_pending")
            url = app.storage.presigned_get(
                rec["fit_note_storage_key"], rec["fit_note_content_type"],
                storage.disposition_file_name(rec["fit_note_file_name"]))
            return Response(200, {"url": url, "expires_in_seconds": 60})
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/sickness/(?P<sid>[^/]+)/return$", roles=CW)
    def record_return(request, sid):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                rec = fetch_sickness(conn, request.person, sid)
                sweep_sickness_status(conn, rec)
                if rec["status"] == "closed":
                    raise invalid_transition("closed", "edited")
                errors = helpers.check_unknown_keys(data, {"last_sick_date"})
                last = domain.parse_date(data.get("last_sick_date"))
                today = domain.today()
                if last is None or last < rec["start_date"] or last > today:
                    errors.setdefault(
                        "last_sick_date",
                        "The last day off sick must be between the first day and today.")
                if errors:
                    raise validation(errors)
                if rec["status"] in ("reported", "fit_note_required"):
                    span = (last - rec["start_date"]).days + 1
                    if span > 7:
                        raise ApiError("fit_note_missing")
                conn.execute(
                    "update sickness set last_sick_date = $1, status = 'closed'"
                    " where id = $2", [last.isoformat(), sid])
                return sickness_row(conn, sid)
            rec = store.tx(conn, run)
            return Response(200, sickness_body(conn, rec, True))
        finally:
            store.release(conn)

    # ---- cover shifts ------------------------------------------------------

    def cover_visible(conn, person, cover):
        """A bank carer sees only covers they are eligible for."""
        if person["role"] == "bank_carer":
            homes = repo.credentialed_home_ids(conn, person["id"])
            if cover["home_id"] not in homes:
                raise ApiError("not_found")
            if cover["skill"] == "senior" and person["skill"] != "senior":
                raise ApiError("skill_required")
        return cover

    @app.route("GET", r"^/api/cover-shifts$", roles=BC)
    def open_covers(request):
        conn = store.connect()
        try:
            homes = repo.credentialed_home_ids(conn, request.person["id"])
            if not homes:
                return Response(200, {"items": []})
            placeholders = ",".join(f"${i + 1}" for i in range(len(homes)))
            skill_param = f"${len(homes) + 1}"
            rows = conn.execute(
                "select c.id, c.leave_request_id, c.unit_id, c.date, c.shift, c.skill,"
                " c.status, c.claimed_by, u.home_id, c.starts_at, c.ends_at"
                " from covers c join units u on u.id = c.unit_id"
                f" where c.status = 'open' and u.home_id in ({placeholders})"
                f" and (c.skill = 'carer' or {skill_param} = 'senior')"
                " order by c.starts_at asc, c.id",
                homes + [request.person["skill"]])
            items = [helpers.cover_body(conn, helpers_cover_row(r), False) for r in rows]
            return Response(200, {"items": items})
        finally:
            store.release(conn)

    def helpers_cover_row(r):
        return {"id": dc.s(r[0]), "leave_request_id": dc.s(r[1]), "unit_id": dc.s(r[2]),
                "date": dc.d(r[3]), "shift": dc.s(r[4]), "skill": dc.s(r[5]),
                "status": dc.s(r[6]), "claimed_by": dc.s(r[7]),
                "home_id": dc.s(r[8]), "starts_at": dc.t(r[9]), "ends_at": dc.t(r[10])}

    @app.route("POST", r"^/api/cover-shifts/(?P<cid>[^/]+)/claim$", roles=BC)
    def claim(request, cid):
        data = helpers.body_json(request)
        key = request.headers.get("Idempotency-Key", "")

        def action(conn):
            errors = helpers.check_unknown_keys(data, {})
            if errors:
                raise validation(errors)
            person = request.person
            cover = helpers.cover_row(conn, cid)
            if cover is None:
                raise ApiError("not_found")
            cover_visible(conn, person, cover)
            conn.execute("select id from covers where id = $1 for update", [cid])
            cover = helpers.cover_row(conn, cid)
            if cover["status"] == "claimed":
                raise ApiError("already_taken")
            if cover["status"] != "open":
                raise ApiError("cover_closed")
            clash = conn.execute(
                "select 1 from assignments where person_id = $1"
                " and starts_at < $2 and ends_at > $3",
                [person["id"], cover["ends_at"].isoformat(),
                 cover["starts_at"].isoformat()])
            if clash:
                raise ApiError("overlapping_shift")
            assignment_id = new_id()
            conn.execute(
                "insert into assignments (id, person_id, unit_id, date, shift,"
                " starts_at, ends_at, cover_id) values ($1,$2,$3,$4,$5,$6,$7,$8)",
                [assignment_id, person["id"], cover["unit_id"],
                 cover["date"].isoformat(), cover["shift"],
                 cover["starts_at"].isoformat(), cover["ends_at"].isoformat(), cid])
            conn.execute("update covers set status = 'claimed', claimed_by = $1,"
                         " assignment_id = $2 where id = $3",
                         [person["id"], assignment_id, cid])
            entry = {"assignment_id": assignment_id,
                     "person": {"id": person["id"],
                                "display_name": person["display_name"]},
                     "date": cover["date"].isoformat(), "shift": cover["shift"],
                     "starts_at": domain.iso_instant(cover["starts_at"]),
                     "ends_at": domain.iso_instant(cover["ends_at"]),
                     "hours": domain.hours_str(
                         domain.shift_hours(cover["date"], cover["shift"])),
                     "status": "on", "is_you": True}
            cover_after = helpers.cover_row(conn, cid)
            return 200, {"cover": helpers.cover_body(conn, cover_after, False),
                         "assignment": entry}

        conn = store.connect()
        try:
            status, body, replayed = store.tx(conn, lambda conn:
                app.keyed.run(conn, request.person["id"], key, request.method,
                              request.path, data, action))
            headers = {"Idempotent-Replayed": "true"} if replayed else {}
            return Response(status, body, headers=headers)
        finally:
            store.release(conn)

    # ---- accrual -----------------------------------------------------------

    def month_period(date):
        return f"{date.year}-{date.month:02d}"

    def worked_seconds_for(conn, person_id, period):
        rows = conn.execute(
            "select coalesce(sum(worked_seconds), 0) from attendance"
            " where person_id = $1 and to_char(date, 'YYYY-MM') = $2"
            " and worked_seconds is not null",
            [person_id, period])
        return dc.i(rows[0][0])

    @app.route("GET", r"^/api/me/accrual$", roles=BC)
    def my_accrual(request):
        conn = store.connect()
        try:
            today = domain.today()
            period = month_period(today)
            entries = conn.execute(
                "select id, period, kind, worked_hours, accrued_hours, created_at"
                " from ledger where person_id = $1 order by created_at asc, id",
                [request.person["id"]])
            total = 0.0
            items = []
            for r in entries:
                accrued = float(dc.dec(r[4]))
                total += accrued
                items.append({"id": dc.s(r[0]), "period": dc.s(r[1]),
                              "kind": dc.s(r[2]),
                              "worked_hours": domain.accrual_str(float(dc.dec(r[3]))),
                              "accrued_hours": domain.accrual_str(accrued),
                              "created_at": domain.iso_instant(dc.t(r[5]))})
            worked = worked_seconds_for(conn, request.person["id"], period)
            pending = domain.accrue_hours(worked)
            return Response(200, {"entries": items,
                                  "ledger_total_hours": domain.accrual_str(total),
                                  "open_period": {
                                      "period": period,
                                      "worked_hours": domain.hours_str(worked / 3600),
                                      "pending_accrual_hours": domain.accrual_str(pending)}})
        finally:
            store.release(conn)

    # ---- pay periods -------------------------------------------------------

    @app.route("GET", r"^/api/pay-periods$", roles=["hr_admin"])
    def pay_periods(request):
        conn = store.connect()
        try:
            rows = conn.execute("select period, closed_at from pay_periods"
                                " order by period desc")
            closed = {dc.s(r[0]): dc.t(r[1]) for r in rows}
            today = domain.today()
            items = []
            month = dt.date(today.year, today.month, 1)
            for _ in range(12):
                period = month_period(month)
                items.append({"period": period,
                              "closed_at": domain.iso_instant(closed[period])
                              if period in closed else None})
                month = (month - dt.timedelta(days=1)).replace(day=1)
            return Response(200, {"items": items})
        finally:
            store.release(conn)

    @app.route("POST", r"^/api/pay-periods/(?P<period>[^/]+)/close$", roles=["hr_admin"])
    def close_period(request, period):
        data = helpers.body_json(request)
        if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", period or ""):
            raise validation({"period": "Use a month like 2026-09."})
        conn = store.connect()
        try:
            def run(conn):
                errors = helpers.check_unknown_keys(data, {})
                if errors:
                    raise validation(errors)
                today = domain.today()
                if period >= month_period(today):
                    raise ApiError("period_not_ended")
                already = conn.execute("select 1 from pay_periods where period = $1",
                                      [period])
                if already:
                    raise ApiError("period_closed")
                conn.execute("select pg_advisory_xact_lock(hashtext($1))", [period])
                already = conn.execute("select 1 from pay_periods where period = $1",
                                       [period])
                if already:
                    raise ApiError("period_closed")
                carers = conn.execute(
                    "select id from people where role = 'bank_carer' order by id")
                entries = []
                closed_at = domain.now()
                for r in carers:
                    person_id = dc.s(r[0])
                    seconds = worked_seconds_for(conn, person_id, period)
                    hours = domain.round_half_up_4(seconds / 3600)
                    accrued = domain.accrue_hours(seconds)
                    entry_id = new_id()
                    conn.execute(
                        "insert into ledger (id, person_id, period, kind, worked_hours,"
                        " accrued_hours) values ($1,$2,$3,'period',$4,$5)",
                        [entry_id, person_id, period, domain.accrual_str(hours),
                         domain.accrual_str(accrued)])
                    entries.append({"id": entry_id, "period": period, "kind": "period",
                                    "worked_hours": domain.accrual_str(hours),
                                    "accrued_hours": domain.accrual_str(accrued),
                                    "created_at": domain.iso_instant(closed_at)})
                    for adj in ledger_adjustments(conn, person_id):
                        adj_id = new_id()
                        conn.execute(
                            "insert into ledger (id, person_id, period, kind,"
                            " worked_hours, accrued_hours)"
                            " values ($1,$2,$3,'adjustment',$4,$5)",
                            [adj_id, person_id, adj["period"],
                             domain.accrual_str(adj["worked_hours"]),
                             domain.accrual_str(adj["accrued_hours"])])
                        entries.append({"id": adj_id, "period": adj["period"],
                                        "kind": "adjustment",
                                        "worked_hours": domain.accrual_str(
                                            adj["worked_hours"]),
                                        "accrued_hours": domain.accrual_str(
                                            adj["accrued_hours"]),
                                        "created_at": domain.iso_instant(closed_at)})
                conn.execute("insert into pay_periods (period, closed_at)"
                             " values ($1, now())", [period])
                return {"period": period,
                        "closed_at": domain.iso_instant(closed_at),
                        "entries": entries}
            result = store.tx(conn, run)
            return Response(201, result)
        finally:
            store.release(conn)

    def ledger_adjustments(conn, person_id):
        """One adjustment per earlier closed month whose worked seconds changed."""
        closed = conn.execute("select period from pay_periods order by period")
        adjustments = []
        for r in closed:
            period = dc.s(r[0])
            seconds = worked_seconds_for(conn, person_id, period)
            current_hours = domain.round_half_up_4(seconds / 3600)
            current_accrued = domain.accrue_hours(seconds)
            rows = conn.execute(
                "select worked_hours, accrued_hours from ledger"
                " where person_id = $1 and period = $2", [person_id, period])
            recorded_hours = 0.0
            recorded_accrued = 0.0
            for row in rows:
                recorded_hours += float(dc.dec(row[0]))
                recorded_accrued += float(dc.dec(row[1]))
            delta_hours = current_hours - recorded_hours
            delta_accrued = current_accrued - recorded_accrued
            if abs(delta_hours) > 1e-9 or abs(delta_accrued) > 1e-9:
                adjustments.append({"period": period, "worked_hours": delta_hours,
                                    "accrued_hours": delta_accrued})
        return adjustments

    # ---- exports -----------------------------------------------------------

    def csv_cell(value):
        """RFC 4180 quoting with formula neutralising in one place."""
        text = "" if value is None else str(value)
        if text[:1] in ("=", "+", "-", "@"):
            text = "'" + text
        if any(ch in text for ch in (",", '"', "\n", "\r")):
            return '"' + text.replace('"', '""') + '"'
        return text

    def build_timesheet(conn, period, home_ids):
        placeholders = ",".join(f"${i + 2}" for i in range(len(home_ids)))
        rows = conn.execute(
            "select h.name, un.name, p.id, p.display_name, p.role, a.date, a.shift,"
            " a.rostered_start, a.rostered_end, a.clock_in_at, a.clock_out_at,"
            " a.worked_seconds, a.late, a.correction_note"
            " from attendance a"
            " join units un on un.id = a.unit_id"
            " join homes h on h.id = a.home_id"
            " join people p on p.id = a.person_id"
            f" where to_char(a.date, 'YYYY-MM') = $1 and a.home_id in ({placeholders})"
            " order by h.name asc, un.name asc, a.date asc,"
            " case a.shift when 'early' then 1 when 'late' then 2 else 3 end,"
            " p.id",
            [period] + home_ids)
        out = io.StringIO()
        out.write(CSV_HEADER + "\r\n")
        count = 0
        for r in rows:
            date = dc.d(r[5])
            shift = dc.s(r[6])
            worked = None if dc.i(r[11]) is None else dc.i(r[11]) / 3600
            out.write(",".join([
                csv_cell(dc.s(r[0])), csv_cell(dc.s(r[1])), csv_cell(dc.s(r[2])),
                csv_cell(dc.s(r[3])), csv_cell(dc.s(r[4])),
                csv_cell(date.isoformat()),
                csv_cell(domain.SHIFT_CSV[shift]),
                csv_cell(domain.iso_instant(dc.t(r[7]))),
                csv_cell(domain.iso_instant(dc.t(r[8]))),
                csv_cell(domain.iso_instant(dc.t(r[9])) if r[9] is not None else None),
                csv_cell(domain.iso_instant(dc.t(r[10])) if r[10] is not None else None),
                csv_cell(domain.hours_str(worked)) if worked is not None else "",
                csv_cell("yes" if r[12] == b"t" else "no"),
                csv_cell(dc.s(r[13])),
            ]) + "\r\n")
            count += 1
        return out.getvalue().encode("utf-8"), count

    def export_body(row):
        return {"id": dc.s(row[0]), "period": dc.s(row[1]),
                "home_ids": json.loads(dc.s(row[2])),
                "row_count": dc.i(row[3]), "storage": dc.s(row[4]),
                "created_at": domain.iso_instant(dc.t(row[5]))}

    @app.route("POST", r"^/api/exports/timesheets$", roles=["hr_admin"])
    def create_export(request):
        data = helpers.body_json(request)
        conn = store.connect()
        try:
            def run(conn):
                errors = helpers.check_unknown_keys(data, {"period", "home_ids"})
                period = data.get("period")
                if not isinstance(period, str) or \
                        not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", period):
                    errors.setdefault("period", "Use a month like 2026-09.")
                home_ids = data.get("home_ids")
                if not isinstance(home_ids, list) or not home_ids:
                    errors.setdefault("home_ids", "Choose at least one home.")
                else:
                    known = {dc.s(r[0]) for r in conn.execute("select id from homes")}
                    if not all(isinstance(h, str) for h in home_ids) or \
                            any(h not in known for h in home_ids):
                        errors.setdefault("home_ids", "Unknown home.")
                if errors:
                    raise validation(errors)
                payload, row_count = build_timesheet(conn, period, home_ids)
                export_id = new_id()
                object_key = f"exports/timesheets/{period}/{export_id}.csv"
                stored = app.storage.put(object_key, "text/csv", payload)
                if not stored:
                    conn.execute(
                        "insert into uploads (id, kind, object_key, content_type, bytes)"
                        " values ($1,'export',$2,'text/csv',$3)",
                        [export_id, object_key, payload])
                conn.execute(
                    "insert into exports (id, period, home_ids, row_count, storage,"
                    " object_key) values ($1,$2,$3,$4,$5,$6)",
                    [export_id, period, json.dumps(home_ids), row_count,
                     "stored" if stored else "pending", object_key])
                row = conn.execute(
                    "select id, period, home_ids, row_count, storage, created_at"
                    " from exports where id = $1", [export_id])[0]
                return export_body(row)
            body = store.tx(conn, run)
            return Response(201, body)
        finally:
            store.release(conn)

    @app.route("GET", r"^/api/exports$", roles=["hr_admin"])
    def list_exports(request):
        conn = store.connect()
        try:
            rows = conn.execute("select id, period, home_ids, row_count, storage,"
                                 " created_at from exports order by created_at desc, id")
            return Response(200, {"items": [export_body(r) for r in rows]})
        finally:
            store.release(conn)

    @app.route("GET", r"^/api/exports/(?P<eid>[^/]+)/download$", roles=["hr_admin"])
    def download_export(request, eid):
        conn = store.connect()
        try:
            rows = conn.execute("select id, period, home_ids, row_count, storage,"
                                " object_key, created_at from exports where id = $1",
                                [eid])
            if not rows:
                raise ApiError("not_found")
            r = rows[0]
            if dc.s(r[4]) == "pending":
                raise ApiError("storage_pending")
            name = f"timesheets-{dc.s(r[1])}.csv"
            url = app.storage.presigned_get(dc.s(r[5]), "text/csv",
                                            storage.disposition_file_name(name))
            return Response(200, {"url": url, "expires_in_seconds": 60})
        finally:
            store.release(conn)

    # ---- audit -------------------------------------------------------------

    def audit_body(r):
        before = dc.j(r[6])
        after = dc.j(r[7])
        return {"id": dc.s(r[0]), "at": domain.iso_instant(dc.t(r[1])),
                "actor": {"id": dc.s(r[2]), "display_name": dc.s(r[3]),
                          "role": dc.s(r[4])},
                "action": dc.s(r[5]),
                "home_id": dc.s(r[8]),
                "target": {"type": dc.s(r[9]), "id": dc.s(r[10])},
                "before": before, "after": after, "reason": dc.s(r[11])}

    @app.route("GET", r"^/api/audit$", roles=MGR)
    def audit_log(request):
        conn = store.connect()
        try:
            home = request.query.get("home")
            if request.person["role"] == "unit_manager":
                if home and home != request.person["home_id"]:
                    raise ApiError("not_found")
                home = request.person["home_id"]
            if home:
                homes = conn.execute("select id from homes where id = $1", [home])
                if not homes:
                    raise ApiError("not_found")
            rows = conn.execute(
                "select id, at, actor_id, actor_name, actor_role, action, before,"
                " after, home_id, target_type, target_id, reason from audit"
                + (" where home_id = $1" if home else "")
                + " order by at desc, id", [home] if home else [])
            return Response(200, {"items": [audit_body(r) for r in rows]})
        finally:
            store.release(conn)

    @app.route("PUT", r"^/api/audit$")
    @app.route("PATCH", r"^/api/audit$")
    @app.route("DELETE", r"^/api/audit$")
    @app.route("PUT", r"^/api/audit/(?P<aid>[^/]+)$")
    @app.route("PATCH", r"^/api/audit/(?P<aid>[^/]+)$")
    @app.route("DELETE", r"^/api/audit/(?P<aid>[^/]+)$")
    def audit_locked(request, aid=None):
        raise ApiError("method_not_allowed")
