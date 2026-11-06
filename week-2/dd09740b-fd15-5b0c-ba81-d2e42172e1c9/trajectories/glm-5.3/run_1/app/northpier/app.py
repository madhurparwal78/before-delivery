"""The Northpier inquiry desk application."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import re
import threading
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import psycopg
import werkzeug.exceptions
from flask import (Flask, Response, jsonify, make_response, redirect,
                   render_template, request)

from . import auth, db, emails, errors, labels, mailer, rules
from .config import CONFIG
from .inquiries import (FieldRefusal, public_history, public_inquiry,
                        studio_history, studio_inquiry)
from .seed_data import seed
from .transitions import TransitionRefusal, apply_transition

log = logging.getLogger("northpier")

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = None
app.url_map.strict_slashes = False

MAX_BODY_BYTES = 65536
IDEKEY_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

BOOT_READY = threading.Event()


@app.template_filter()
def initials(client: str) -> str:
    parts = [p for p in client.replace("-", " ").split() if p]
    return "".join(p[0] for p in parts[:3]).upper() or "N"


@app.template_filter()
def servicelist(services) -> str:
    return ", ".join(labels.SERVICES.get(s, s) for s in services)


@app.template_filter()
def budgetlabel(value: str) -> str:
    return labels.BUDGETS.get(value, value)


@app.template_filter()
def timelinelabel(value: str) -> str:
    return labels.TIMELINES.get(value, value)


@app.template_filter()
def statuslabel(value: str) -> str:
    return labels.STATUS_LABELS.get(value, value)


@app.template_filter()
def shortdate(iso_text: str) -> str:
    try:
        moment = dt.datetime.fromisoformat(iso_text.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return iso_text
    local = moment.astimezone(labels.Stockholm)
    return "{day} {month} {year}".format(
        day=local.day, month=labels.MONTHS[local.month - 1], year=local.year
    )


@app.route("/static/app.css")
def static_css() -> Response:
    css = (Path(__file__).with_name("static") / "app.css").read_text(encoding="utf-8")
    return Response(css, mimetype="text/css")


@app.route("/static/app.js")
def static_js() -> Response:
    js = (Path(__file__).with_name("static") / "app.js").read_text(encoding="utf-8")
    return Response(js, mimetype="application/javascript")


@app.route("/static/studio.js")
def static_studio_js() -> Response:
    js = (Path(__file__).with_name("static") / "studio.js").read_text(encoding="utf-8")
    return Response(js, mimetype="application/javascript")


def _set_caching(response: Response) -> Response:
    response.headers.setdefault("Cache-Control", "no-store")
    return response


app.after_request(_set_caching)


# ---------------------------------------------------------------- helpers


def json_response(payload, status: int = 200, headers: dict | None = None) -> Response:
    body = json.dumps(payload, ensure_ascii=False)
    response = Response(body, status=status, mimetype="application/json")
    response.headers["Content-Type"] = "application/json; charset=utf-8"
    for name, value in (headers or {}).items():
        response.headers[name] = value
    return response


def read_body() -> tuple[dict | None, Response | None]:
    """Read a JSON object body, enforcing size and shape rules."""
    raw = request.get_data(cache=False)
    if len(raw) > MAX_BODY_BYTES:
        return None, errors.refusal(*labels.TOO_LARGE)
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None, errors.refusal(*labels.INVALID_BODY)
    if not isinstance(data, dict):
        return None, errors.refusal(*labels.INVALID_BODY)
    return data, None


def current_user() -> dict | None:
    """Resolve the studio account from the bearer token or session cookie."""
    header = request.headers.get("Authorization", "")
    token = ""
    if header.startswith("Bearer "):
        token = header[7:].strip()
    if not token:
        token = request.cookies.get("np_studio", "")
    if not token:
        return None
    try:
        return db.db_call(auth.session_user, token)
    except psycopg.Error:
        db.mark_unavailable()
        return None


def require_studio() -> tuple[dict | None, Response | None]:
    user = current_user()
    if user is None:
        return None, errors.refusal(*labels.SIGN_IN_REQUIRED)
    return user, None


def api_error_response(status: int, field, message: str, headers: dict | None = None) -> Response:
    return errors.refusal(status, field, message)[0] if False else json_response(
        {"error": {"field": field, "message": message}}, status, headers
    )


def outage() -> Response:
    return api_error_response(503, None, labels.UNAVAILABLE[2])


def refuse_with_headers(spec: tuple, headers: dict | None = None) -> Response:
    status, field, message = spec
    return api_error_response(status, field, message, headers)


def valid_origin() -> bool:
    """A cookie-authenticated POST must come from this origin."""
    if request.headers.get("Authorization", "").startswith("Bearer "):
        return True
    origin = request.headers.get("Origin")
    if not origin:
        return True
    return origin.rstrip("/") == CONFIG.public_url.rstrip("/")


def idempotency_key() -> tuple[str | None, Response | None]:
    raw = request.headers.get("Idempotency-Key")
    if raw is None:
        return None, None
    if not IDEKEY_RE.match(raw):
        return None, errors.refusal(*labels.BAD_IDEMPOTENCY_KEY)
    return raw, None


def canonical_body(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


# ---------------------------------------------------------------- health


@app.route("/api/health", methods=["GET"])
def api_health() -> Response:
    try:
        db.db_call(lambda conn: conn.execute("SELECT 1"))
    except psycopg.Error:
        db.mark_unavailable()
        return json_response({"status": "unavailable"}, 503)
    db.mark_available()
    if not BOOT_READY.is_set():
        return json_response({"status": "unavailable"}, 503)
    return json_response({"status": "ok"})


# ---------------------------------------------------------------- cases


def case_from_row(row: dict) -> dict:
    return {
        "slug": row["slug"],
        "client": row["client"],
        "industry": row["industry"],
        "theme": row["theme"],
        "position": row["position"],
        "headline": row["headline"],
        "body": json.loads(row["body"]),
        "awards": json.loads(row["awards"]) if row["awards"] is not None else [],
        "testimonial": {
            "quote": row["testimonial_quote"],
            "name": row["testimonial_name"],
            "role": row["testimonial_role"],
        },
        "cover_seed": row["cover_seed"],
    }


@app.route("/api/cases", methods=["GET"])
def api_cases() -> Response | tuple[Response, int]:
    try:
        rows = db.db_call(
            lambda conn: conn.execute(
                "SELECT * FROM cases ORDER BY position"
            ).fetchall()
        )
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()
    return json_response([case_from_row(row) for row in rows])


@app.route("/api/cases/<slug>", methods=["GET"])
def api_case(slug: str) -> Response | tuple[Response, int]:
    try:
        rows = db.db_call(
            lambda conn: conn.execute(
                "SELECT * FROM cases ORDER BY position"
            ).fetchall()
        )
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()
    index = next((i for i, r in enumerate(rows) if r["slug"] == slug), None)
    if index is None:
        return refuse_with_headers(labels.NOT_FOUND)
    more = [case_from_row(rows[(index + k) % len(rows)]) for k in (1, 2)]
    payload = case_from_row(rows[index])
    payload["more"] = more
    return json_response(payload)


# ---------------------------------------------------------------- auth


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "np_studio", token, httponly=True, samesite="Lax", path="/",
        max_age=60 * 60 * 24 * 14,
    )


@app.route("/api/auth/login", methods=["POST"])
def api_login() -> Response | tuple[Response, int]:
    data, refusal = read_body()
    if refusal is not None:
        return refusal
    email = data.get("email")
    password = data.get("password")

    def handler(conn) -> Response | tuple[Response, int]:
        if not isinstance(email, str) or not isinstance(password, str):
            return refuse_with_headers(labels.WRONG_CREDENTIALS)
        key = email.strip().lower()
        failures, oldest = auth.counted_failures(conn, key)
        if failures >= 5:
            retry = auth.signin_retry_after(oldest)
            return refuse_with_headers(
                labels.SIGNIN_LIMIT, {"Retry-After": str(retry)}
            )
        user = conn.execute(
            "SELECT * FROM studio_users WHERE lower(email) = %(e)s", {"e": key}
        ).fetchone()
        if user is None or not auth.verify_password(password, user["password_hash"]):
            auth.record_attempt(conn, key, False)
            return refuse_with_headers(labels.WRONG_CREDENTIALS)
        auth.record_attempt(conn, key, True)
        token = auth.create_session(conn, user["id"])
        payload = {"token": token, "user": auth.user_json(user)}
        response = json_response(payload)
        set_session_cookie(response, token)
        return response

    try:
        return db.db_transaction(handler)
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()


@app.route("/api/auth/logout", methods=["POST"])
def api_logout() -> Response | tuple[Response, int]:
    user, refusal = require_studio()
    if refusal is not None:
        return refusal
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.startswith("Bearer ") else request.cookies.get("np_studio", "")
    try:
        db.db_transaction(auth.end_session, token)
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()
    response = Response(status=204)
    response.delete_cookie("np_studio")
    return response


@app.route("/api/me", methods=["GET"])
def api_me() -> Response | tuple[Response, int]:
    user, refusal = require_studio()
    if refusal is not None:
        return refusal
    return json_response(auth.user_json(user))


# ---------------------------------------------------------------- inquiries


@app.route("/api/inquiries", methods=["POST"])
def api_create_inquiry() -> Response | tuple[Response, int]:
    raw = request.get_data(cache=False)
    if len(raw) > MAX_BODY_BYTES:
        return refuse_with_headers(labels.TOO_LARGE)
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return refuse_with_headers(labels.INVALID_BODY)
    if not isinstance(data, dict):
        return refuse_with_headers(labels.INVALID_BODY)

    key, key_refusal = idempotency_key()
    if key_refusal is not None:
        return key_refusal
    form_key = data.get("idempotency_key")
    if key is None and isinstance(form_key, str) and IDEKEY_RE.match(form_key):
        key = form_key

    body_hash = hashlib.sha256(canonical_body(data).encode("utf-8")).hexdigest()

    def inquiry_payload(inquiry_row: dict) -> dict:
        return {
            "reference": inquiry_row["reference"],
            "status": inquiry_row["status"],
            "status_token": inquiry_row["status_token"],
            "status_url": emails.status_url(inquiry_row["status_token"]),
        }

    def handler(conn):
        now = inquiries_now()
        if key is not None:
            # Claim the key first: the unique insert blocks any simultaneous
            # request on the same key until this transaction resolves.
            stale = conn.execute(
                "DELETE FROM idempotency_keys WHERE key = %(k)s AND created_at < now() - (%(ttl)s || ' seconds')::interval",
                {"k": key, "ttl": CONFIG.idempotency_ttl_seconds},
            )
            claimed = conn.execute(
                """
                INSERT INTO idempotency_keys (key, request_body, response_body, inquiry_id, created_at)
                VALUES (%(k)s, %(b)s, NULL, NULL, %(now)s)
                ON CONFLICT (key) DO NOTHING
                RETURNING key
                """,
                {"k": key, "b": body_hash, "now": now},
            ).fetchone()
            if claimed is None:
                stored = conn.execute(
                    "SELECT * FROM idempotency_keys WHERE key = %(k)s", {"k": key}
                ).fetchone()
                if stored is not None and stored["response_body"] is not None:
                    if stored["request_body"] == body_hash:
                        return json_response(json.loads(stored["response_body"]), 200)
                    return refuse_with_headers(labels.INQUIRY_KEY_CONFLICT)
                # The claim was rolled back or expired; claim it again.
                conn.execute(
                    """
                    INSERT INTO idempotency_keys (key, request_body, response_body, inquiry_id, created_at)
                    VALUES (%(k)s, %(b)s, NULL, NULL, %(now)s)
                    ON CONFLICT (key) DO NOTHING
                    """,
                    {"k": key, "b": body_hash, "now": now},
                )
        checked = validate_inquiry(data)
        email = checked["email"]
        count, oldest = hourly_count(conn, email)
        if count >= 5:
            if key is not None:
                conn.execute("DELETE FROM idempotency_keys WHERE key = %(k)s AND response_body IS NULL", {"k": key})
            retry = retry_after_seconds(oldest)
            return refuse_with_headers(labels.FLOOD_LIMIT, {"Retry-After": str(retry)})
        inquiry = store_inquiry(conn, checked)
        payload = inquiry_payload(inquiry)
        if key is not None:
            conn.execute(
                """
                UPDATE idempotency_keys
                   SET response_body = %(r)s, inquiry_id = %(i)s
                 WHERE key = %(k)s AND response_body IS NULL
                """,
                {"r": json.dumps(payload, ensure_ascii=False), "i": inquiry["id"], "k": key},
            )
        return json_response(payload, 201)

    try:
        result = db.db_transaction(handler)
    except FieldRefusal as exc:
        return api_error_response(exc.status, exc.field, exc.message)
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()
    mailer.try_send_now()
    return result


def inquiries_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


from .inquiries import (FieldRefusal, hourly_count, public_inquiry,  # noqa: E402
                        retry_after_seconds, store_inquiry, utc_now,
                        validate_inquiry)


def validate_inquiry_form(data: dict) -> dict:
    return validate_inquiry(data)


def iso(moment) -> str:
    return moment.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def age_of(moment) -> float:
    return (inquiries_now() - moment.astimezone(dt.timezone.utc)).total_seconds()


# ---------------------------------------------------------------- status


def status_read(token: str) -> Response | tuple[Response, int]:
    try:
        rows = db.db_call(
            lambda conn: conn.execute(
                """
                SELECT i.*, e.to_status, e.created_at AS event_at
                FROM inquiries i
                JOIN status_events e ON e.inquiry_id = i.id
                WHERE i.status_token = %(t)s
                ORDER BY e.id
                """,
                {"t": token},
            ).fetchall()
        )
    except psycopg.Error as exc:
        log_db_error(exc)
        db.mark_unavailable()
        return outage()
    if not rows:
        return refuse_with_headers(labels.NOT_FOUND)
    inquiry = rows[0]
    history = [{"status": r["to_status"], "created_at": iso(r["event_at"])} for r in rows]
    return json_response(public_inquiry(inquiry, history))


@app.route("/api/inquiries/status/<token>", methods=["GET", "HEAD"])
def api_status(token: str) -> Response | tuple[Response, int]:
    return status_read(token)


# ---------------------------------------------------------------- 405 guards


def method_not_allowed() -> Response:
    response = api_error_response(405, None, labels.METHOD_NOT_ALLOWED[2])
    response.headers["Allow"] = "GET, HEAD"
    return response


@app.route("/api/inquiries/status/<token>", methods=["POST", "PUT", "PATCH", "DELETE"])
def api_status_write(token: str) -> Response:
    return method_not_allowed()


@app.route("/inquiry/<token>", methods=["POST", "PUT", "PATCH", "DELETE"])
def page_status_write(token: str) -> Response:
    return method_not_allowed()


# ---------------------------------------------------------------- pages

RESERVED_PATHS = {
    "run.json", "requirements.txt", "USER_README.md", "THIRD_PARTY_NOTICES.md",
    ".env", "pyproject.toml", "setup.py", "setup.cfg", "Dockerfile",
}
RESERVED_PREFIXES = ("northpier/", "static/", "templates/", ".git/")


def render_page(template: str, status: int = 200, **context) -> Response:
    response = make_response(render_template(template, **context), status)
    return response


def db_outage_page(template: str, **context) -> Response:
    return render_page(template, status=503, outage=True, **context)


def all_cases() -> list[dict] | None:
    try:
        rows = db.db_call(
            lambda conn: conn.execute("SELECT * FROM cases ORDER BY position").fetchall()
        )
    except psycopg.Error:
        db.mark_unavailable()
        return None
    return [case_from_row(row) for row in rows]


def case_by_slug(slug: str) -> tuple[dict | None, list[dict] | None]:
    rows = all_cases()
    if rows is None:
        return None, None
    index = next((i for i, r in enumerate(rows) if r["slug"] == slug), None)
    if index is None:
        return False, []
    return rows[index], [rows[(index + k) % len(rows)] for k in (1, 2)]


def visitor_context(active: str) -> dict:
    return {
        "active": active,
        "year": dt.datetime.now(labels.Stockholm).year,
        "outage": False,
    }


@app.route("/")
def page_landing() -> Response | tuple[Response, int]:
    cases = all_cases()
    context = visitor_context("home")
    if cases is None:
        return db_outage_page("outage.html", **context)
    context["cases"] = cases
    return render_page("landing.html", **context)


@app.route("/work/<slug>")
def page_case(slug: str) -> Response | tuple[Response, int]:
    if "/" in slug or "\\" in slug or slug in RESERVED_PATHS or slug.startswith("."):
        return render_page("not_found.html", status=404, **visitor_context("work"))
    case, more = case_by_slug(slug)
    context = visitor_context("work")
    if case is None and more is None:
        return db_outage_page("outage.html", **context)
    if case is False:
        return render_page("not_found.html", status=404, **context)
    context["case"] = case
    context["more"] = more
    return render_page("case.html", **context)


@app.route("/services")
def page_services() -> Response | tuple[Response, int]:
    cases = all_cases()
    context = visitor_context("services")
    if cases is None:
        return db_outage_page("outage.html", **context)
    context["cases"] = cases[:3]
    return render_page("services.html", **context)


@app.route("/contact")
def page_contact() -> Response | tuple[Response, int]:
    now_utc = dt.datetime.now(dt.timezone.utc)
    stockholm = now_utc.astimezone(labels.Stockholm)
    reykjavik = now_utc.astimezone(ZoneInfo("Atlantic/Reykjavik"))

    def two(n): return f"{n:02d}"

    sh, sm = stockholm.hour, stockholm.minute
    s_time = f"{two(sh)}:{two(sm)}"
    if sh < 12:
        stockholm_greeting = f"God morgon, klockan är {s_time}"
    elif sh < 18:
        stockholm_greeting = f"God eftermiddag, klockan är {s_time}"
    else:
        stockholm_greeting = f"God kväll, klockan är {s_time}"

    rh, rm = reykjavik.hour, reykjavik.minute
    ampm = "AM" if rh < 12 else "PM"
    h12 = rh % 12 or 12
    r_time = f"{h12}:{two(rm)} {ampm}"
    if rh < 12:
        reykjavik_greeting = f"Góðan daginn, klukkan er {r_time}"
    elif rh < 18:
        reykjavik_greeting = f"Góðan dag, klukkan er {r_time}"
    else:
        reykjavik_greeting = f"Gott kvöld, klukkan er {r_time}"

    return render_page(
        "contact.html", **visitor_context("contact"),
        stockholm_greeting=stockholm_greeting, stockholm_time=s_time,
        reykjavik_greeting=reykjavik_greeting, reykjavik_time=r_time,
    )


@app.route("/privacy-policy")
def page_privacy() -> Response | tuple[Response, int]:
    return render_page("privacy.html", **visitor_context("privacy"))


class _FormError(Exception):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


@app.route("/start", methods=["POST"])
def page_start_submit() -> Response | tuple[Response, int]:
    """The no-script composer posts here; JS users never reach it."""
    form = request.form
    data = {
        "name": form.get("name", ""),
        "email": form.get("email", ""),
        "company": form.get("company") or None,
        "services": form.getlist("services"),
        "budget": form.get("budget", ""),
        "timeline": form.get("timeline", ""),
        "message": form.get("message", ""),
    }
    key = form.get("idempotency_key") or None
    if key is not None and not IDEKEY_RE.match(key):
        key = None
    body_hash = hashlib.sha256(canonical_body(data).encode("utf-8")).hexdigest()

    def handler(conn):
        if key is not None:
            stored = conn.execute(
                "SELECT * FROM idempotency_keys WHERE key = %(k)s", {"k": key}
            ).fetchone()
            if stored is not None:
                if age_of(stored["created_at"]) <= CONFIG.idempotency_ttl_seconds:
                    if stored["request_body"] == body_hash:
                        return json.loads(stored["response_body"])
                    return None
                conn.execute("DELETE FROM idempotency_keys WHERE key = %(k)s", {"k": key})
        try:
            checked = validate_inquiry(data)
        except FieldRefusal as exc:
            raise _FormError(exc.field, exc.message) from exc
        email = checked["email"]
        count, oldest = hourly_count(conn, email)
        if count >= 5:
            raise _FormError("email", "Too many inquiries from this email. Try again in an hour.")
        inquiry = store_inquiry(conn, checked)
        payload = {
            "reference": inquiry["reference"],
            "status": inquiry["status"],
            "status_token": inquiry["status_token"],
            "status_url": emails.status_url(inquiry["status_token"]),
        }
        if key is not None:
            conn.execute(
                """
                INSERT INTO idempotency_keys (key, request_body, response_body, inquiry_id, created_at)
                VALUES (%(k)s, %(b)s, %(r)s, %(i)s, now())
                ON CONFLICT (key) DO NOTHING
                """,
                {"k": key, "b": body_hash,
                 "r": json.dumps(payload, ensure_ascii=False), "i": inquiry["id"]},
            )
        return payload

    try:
        payload = db.db_transaction(handler)
    except _FormError as exc:
        return render_page("start.html", status=422, **visitor_context("start"),
                           confirmed=None, refused=False,
                           field_errors={exc.field: exc.message}, values=data)
    except psycopg.Error:
        db.mark_unavailable()
        return db_outage_page("outage.html", **visitor_context("start"))
    if payload is None:
        return render_page("start.html", status=409, **visitor_context("start"),
                           confirmed=None, refused=True, field_errors={}, values=data)
    mailer.try_send_now()
    return redirect(f"/start?ref={payload['reference']}")


class _FormError(Exception):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


@app.route("/start")
def page_start() -> Response | tuple[Response, int]:
    context = visitor_context("start")
    confirmed = None
    ref = request.args.get("ref", "").strip()
    if ref.startswith("NP-") and len(ref) == 9:
        try:
            inquiry_row = db.db_call(
                lambda conn: conn.execute(
                    "SELECT reference, name, status, status_token FROM inquiries WHERE reference = %(r)s",
                    {"r": ref},
                ).fetchone()
            )
        except psycopg.Error:
            db.mark_unavailable()
            inquiry_row = None
        if inquiry_row is not None:
            confirmed = {
                "reference": inquiry_row["reference"],
                "status_token": inquiry_row["status_token"],
                "status_url": emails.status_url(inquiry_row["status_token"]),
                "first_name": inquiry_row["name"].strip().split(" ", 1)[0],
            }
    context["confirmed"] = confirmed
    context["field_errors"] = {}
    context["values"] = {}
    context["refused"] = False
    return render_page("start.html", **context)


@app.route("/inquiry/<token>")
def page_status(token: str) -> Response | tuple[Response, int]:
    try:
        rows = db.db_call(
            lambda conn: conn.execute(
                """
                SELECT i.*, e.to_status, e.created_at AS event_at
                FROM inquiries i
                JOIN status_events e ON e.inquiry_id = i.id
                WHERE i.status_token = %(t)s
                ORDER BY e.id
                """,
                {"t": token},
            ).fetchall()
        )
    except psycopg.Error:
        db.mark_unavailable()
        return db_outage_page("outage.html", **visitor_context("status"))
    if not rows:
        return render_page("not_found.html", status=404, **visitor_context("status"))
    inquiry = rows[0]
    history = [{"status": r["to_status"], "created_at": iso(r["event_at"])} for r in rows]
    context = visitor_context("status")
    context["inquiry"] = public_inquiry(inquiry, history)
    context["status_label"] = labels.STATUS_LABELS[inquiry["status"]]
    context["status_line"] = labels.status_line(
        inquiry["status"], inquiry["call_at"], inquiry["decline_reason"]
    )
    context["status_token"] = token
    return render_page("status.html", **context)


def safe_next(target: str | None) -> str:
    if not target:
        return "/studio"
    if target.startswith("//") or "://" in target:
        return "/studio"
    if target == "/studio" or target.startswith("/studio/") or target.startswith("/studio?"):
        return target
    return "/studio"


@app.route("/studio/signin")
def page_signin() -> Response | tuple[Response, int]:
    nxt = request.args.get("next")
    return render_page(
        "signin.html", next_param=nxt or "", safe_next=safe_next(nxt),
        signed_out=request.args.get("signed_out") == "1",
    )


@app.route("/studio")
def page_studio() -> Response | tuple[Response, int]:
    user = current_user()
    if user is None:
        target = "/studio"
        if request.query_string:
            target += "?" + request.query_string.decode("latin-1")
        return redirect("/studio/signin?" + urlencode({"next": target}))
    return render_page("studio.html", user=user, tab_status="new", tab_q="")


@app.route("/studio/inquiries/<inquiry_id>")
def page_studio_inquiry(inquiry_id: str) -> Response | tuple[Response, int]:
    user = current_user()
    if user is None:
        target = f"/studio/inquiries/{inquiry_id}"
        if request.query_string:
            target += "?" + request.query_string.decode("latin-1")
        return redirect("/studio/signin?" + urlencode({"next": target}))
    return render_page("inquiry.html", user=user, inquiry_id=inquiry_id,
                      tab_status=request.args.get("status", "new"),
                      tab_q=request.args.get("q", ""))


@app.errorhandler(404)
def page_not_found(error) -> Response:
    path = request.path.lstrip("/")
    if path.startswith("api/"):
        return api_error_response(404, None, labels.NOT_FOUND[2])
    for reserved in RESERVED_PATHS:
        if path == reserved or path.endswith("/" + reserved):
            return render_page("not_found.html", status=404, **visitor_context(""))
    for prefix in RESERVED_PREFIXES:
        if path.startswith(prefix):
            return render_page("not_found.html", status=404, **visitor_context(""))
    return render_page("not_found.html", status=404, **visitor_context(""))


@app.errorhandler(405)
def page_method_not_allowed(error) -> Response:
    if request.path.startswith("/api/inquiries/status/") or request.path.startswith("/inquiry/"):
        return method_not_allowed()
    return api_error_response(405, None, labels.METHOD_NOT_ALLOWED[2])


@app.errorhandler(Exception)
def page_unhandled(error) -> Response:
    if isinstance(error, werkzeug.exceptions.HTTPException):
        if error.code == 404:
            return page_not_found(error)
        if error.code == 405:
            return page_method_not_allowed(error)
        if request.path.startswith("/api/"):
            return api_error_response(error.code or 500, None, labels.NOT_FOUND[2])
    log.exception("unhandled error")
    if request.path.startswith("/api/"):
        return api_error_response(503, None, labels.UNAVAILABLE[2])
    return render_page("outage.html", status=503, **visitor_context(""))


# ---------------------------------------------------------------- boot


def bootstrap() -> None:
    """Apply the schema, seed once, then mark the app ready.

    The work runs on a dedicated connection, so the pool stays empty until
    the workers fork and no socket is ever shared between processes.
    """
    def attempt() -> bool:
        try:
            db.ensure_schema_and_seed(seed)
            db.mark_available()
            BOOT_READY.set()
            return True
        except psycopg.Error:
            db.mark_unavailable()
            return False

    if attempt():
        return

    def retry_loop() -> None:
        while not BOOT_READY.wait(2.0):
            if attempt():
                return

    threading.Thread(target=retry_loop, name="np-boot-retry", daemon=True).start()


def log_db_error(exc: Exception) -> None:
    log.warning("database error: %s: %s", type(exc).__name__, str(exc).split("\n")[0])
