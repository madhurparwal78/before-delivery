"""Session, me, my shifts, punches and my attendance."""
import datetime as dt
import secrets

from . import decode as dc
from . import domain, helpers, repo
from .errors import ApiError, validation
from .store import check_password, new_id
from .web import Response

ROLES = ["care_worker", "bank_carer", "unit_manager", "hr_admin"]


def register(app):
    store = app.store

    def cookie_header(token, max_age):
        return (f"tallow_session={token}; Path=/; HttpOnly; SameSite=Lax; "
                f"Max-Age={max_age}")

    # ---- session -----------------------------------------------------------

    @app.route("POST", r"^/api/session$")
    def create_session(request):
        data = helpers.body_json(request)
        errors = helpers.check_unknown_keys(data, {"email", "password"})
        email = data.get("email")
        password = data.get("password")
        if not isinstance(email, str) or not email.strip():
            errors.setdefault("email", "Enter your email.")
        if not isinstance(password, str) or not password:
            errors.setdefault("password", "Enter your password.")
        if errors:
            raise validation(errors)
        conn = store.connect()
        try:
            person = repo.get_person_by_email(conn, email)
            if person is None or not check_password(password, person["password_hash"]):
                raise ApiError("invalid_credentials")
            token = secrets.token_urlsafe(32)
            conn.execute("insert into sessions (token, person_id, expires_at)"
                         " values ($1,$2, now() + make_interval(secs => $3))",
                         [token, person["id"], app.config.session_ttl_seconds])
            return Response(200, {"user": repo.me_body(conn, person)},
                            headers={"Set-Cookie": cookie_header(
                                token, app.config.session_ttl_seconds)})
        finally:
            store.release(conn)

    @app.route("DELETE", r"^/api/session$", roles=ROLES)
    def delete_session(request):
        conn = store.connect()
        try:
            cookie = request.headers.get("Cookie", "")
            for part in cookie.split(";"):
                name, _, value = part.strip().partition("=")
                if name == "tallow_session" and value:
                    conn.execute("delete from sessions where token = $1", [value])
            return Response(204, None,
                            headers={"Set-Cookie": cookie_header("", 0)})
        finally:
            store.release(conn)

    @app.route("GET", r"^/api/health$")
    def health(request):
        return Response(200, {"status": "ok",
                              "mail": "up" if app.mailer.up else "down",
                              "storage": "up" if app.storage.up else "down"})

    @app.route("GET", r"^/api/me$", roles=ROLES)
    def get_me(request):
        conn = store.connect()
        try:
            return Response(200, repo.me_body(conn, request.person))
        finally:
            store.release(conn)

    @app.route("PATCH", r"^/api/me$", roles=ROLES)
    def patch_me(request):
        data = helpers.body_json(request)
        errors = helpers.check_unknown_keys(data, {"display_name"})
        name = data.get("display_name")
        if not isinstance(name, str) or not (1 <= len(name) <= 60):
            errors.setdefault("display_name", "Use 1 to 60 characters.")
        if errors:
            raise validation(errors)
        conn = store.connect()
        try:
            conn.execute("update people set display_name = $1 where id = $2",
                         [name, request.person["id"]])
            person = repo.get_person(conn, request.person["id"])
            return Response(200, repo.me_body(conn, person))
        finally:
            store.release(conn)

    # ---- my shifts and attendance ------------------------------------------

    @app.route("GET", r"^/api/me/shifts$", roles=["care_worker", "bank_carer",
                                                   "unit_manager"])
    def my_shifts(request):
        conn = store.connect()
        try:
            person = request.person
            today = domain.today()
            rows = conn.execute(
                "select a.person_id, p.display_name, p.skill, a.date, a.shift,"
                " a.starts_at, a.ends_at, a.id,"
                f" ({repo.AWAY_SQL})"
                " from assignments a join people p on p.id = a.person_id"
                " where a.person_id = $1 and (a.date between $2 and $3"
                " or (a.starts_at <= now() and a.ends_at > now()))"
                " order by a.starts_at asc",
                [person["id"], today.isoformat(),
                 (today + dt.timedelta(days=13)).isoformat()])
            entries = []
            for r in rows:
                date = dc.d(r[3])
                away = r[8] != b"t"
                entries.append({
                    "assignment_id": dc.s(r[7]),
                    "person": {"id": dc.s(r[0]), "display_name": dc.s(r[1])},
                    "date": date.isoformat(), "shift": dc.s(r[4]),
                    "starts_at": domain.iso_instant(dc.t(r[5])),
                    "ends_at": domain.iso_instant(dc.t(r[6])),
                    "hours": domain.hours_str(domain.shift_hours(date, dc.s(r[4]))),
                    "status": "away" if away else "on",
                    "is_you": True})
            open_att = repo.open_attendance_for(conn, person["id"])
            holiday = None
            if person["role"] in ("care_worker", "unit_manager"):
                holiday = repo.holiday_balance(conn, person["id"])
            return Response(200, {"assignments": entries,
                                  "open_attendance": (
                                      helpers.attendance_body_with_person(conn, open_att)
                                      if open_att else None),
                                  "holiday": holiday})
        finally:
            store.release(conn)

    @app.route("GET", r"^/api/me/attendance$", roles=["care_worker", "bank_carer"])
    def my_attendance(request):
        conn = store.connect()
        try:
            rows = conn.execute(
                f"select {repo.ATTENDANCE_COLS} from attendance"
                " where person_id = $1 order by date desc, shift asc",
                [request.person["id"]])
            return Response(200, {"items": [
                helpers.attendance_body_with_person(conn, repo.attendance_row(r))
                for r in rows]})
        finally:
            store.release(conn)

    # ---- punches ------------------------------------------------------------

    @app.route("POST", r"^/api/punches$", roles=["care_worker", "bank_carer"])
    def punch(request):
        data = helpers.body_json(request)
        key = request.headers.get("Idempotency-Key", "")

        def action(conn):
            errors = helpers.check_unknown_keys(data, {"kind"})
            if data.get("kind") not in ("in", "out"):
                errors.setdefault("kind", "Choose in or out.")
            if errors:
                raise validation(errors)
            person = request.person
            conn.execute("select id from people where id = $1 for update",
                         [person["id"]])
            now = domain.now()
            if data["kind"] == "in":
                att = clock_in(conn, person, now)
            else:
                att = clock_out(conn, person, now)
            punch_id = new_id()
            conn.execute("insert into punches (id, person_id, kind, at, attendance_id)"
                         " values ($1,$2,$3,$4,$5)",
                         [punch_id, person["id"], data["kind"], now.isoformat(),
                          att["id"]])
            return 201, {"punch": {"id": punch_id, "kind": data["kind"],
                                   "at": domain.iso_instant(now)},
                         "attendance": helpers.attendance_body_with_person(conn, att)}

        conn = store.connect()
        try:
            status, body, replayed = store.tx(conn, lambda conn:
                app.keyed.run(conn, request.person["id"], key, request.method,
                              request.path, data, action))
            headers = {"Idempotent-Replayed": "true"} if replayed else {}
            return Response(status, body, headers=headers)
        finally:
            store.release(conn)

    def clock_in(conn, person, now):
        """The clock-in window rule and the one-attendance rule, under the person lock."""
        if repo.open_attendance_for(conn, person["id"]) is not None:
            raise ApiError("already_clocked_in")
        matching = conn.execute(
            "select a.id, a.unit_id, a.date, a.shift, a.starts_at, a.ends_at"
            " from assignments a"
            " where a.person_id = $1 and a.starts_at - interval '30 minutes' <= $2"
            " and a.ends_at > $2"
            " and not exists (select 1 from attendance at where at.assignment_id = a.id)"
            " order by a.starts_at asc",
            [person["id"], now.isoformat()])
        for r in matching:
            assignment_id, unit_id = dc.s(r[0]), dc.s(r[1])
            date, shift = dc.d(r[2]), dc.s(r[3])
            rostered_start, rostered_end = dc.t(r[4]), dc.t(r[5])
            home_row = conn.execute("select home_id from units where id = $1",
                                    [unit_id])
            late = domain.elapsed_seconds(rostered_start, now) > 600
            attendance_id = new_id()
            conn.execute(
                "insert into attendance (id, person_id, home_id, unit_id, assignment_id,"
                " date, shift, rostered_start, rostered_end, clock_in_at, late, version)"
                " values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)",
                [attendance_id, person["id"], dc.s(home_row[0][0]), unit_id,
                 assignment_id, date.isoformat(), shift, rostered_start.isoformat(),
                 rostered_end.isoformat(), now.isoformat(), late])
            return repo.fetch_attendance(conn, attendance_id)
        raise ApiError("no_rostered_shift")

    def clock_out(conn, person, now):
        rows = conn.execute(
            f"select {repo.ATTENDANCE_COLS} from attendance"
            " where person_id = $1 and clock_out_at is null"
            " order by rostered_start desc", [person["id"]])
        open_att = None
        missed = None
        for r in rows:
            att = repo.attendance_row(r)
            if repo.is_open(att, now):
                open_att = att
                break
            missed = missed or att
        if open_att is None:
            if missed is not None:
                raise ApiError("clock_out_window_closed")
            raise ApiError("no_open_clock_in")
        worked = domain.elapsed_seconds(open_att["clock_in_at"], now)
        conn.execute(
            "update attendance set clock_out_at = $1, worked_seconds = $2,"
            " version = version + 1 where id = $3",
            [now.isoformat(), int(worked), open_att["id"]])
        return repo.fetch_attendance(conn, open_att["id"])
