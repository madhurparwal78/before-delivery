"""The Ivo Kastrel site and studio: routes, API and authorization."""
import datetime as dt

def json_default(value):
    """ISO 8601 with an offset for timestamps."""
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    raise TypeError("not serialisable")
import functools
import json
import secrets

import psycopg
from flask import Flask, Response, g, redirect, render_template, request, url_for
from psycopg import sql
from werkzeug.exceptions import HTTPException

import db
import rules
import visuals

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = rules.MAX_BODY_BYTES
app.jinja_env.trim_blocks = True
app.jinja_env.lstrip_blocks = True


@app.template_filter("journal_date")
def journal_date(value):
    """A stored calendar date, never shifted by a time zone."""
    return value.strftime("%B %-d, %Y")


@app.template_filter("discipline_label")
def discipline_label(value):
    return rules.DISCIPLINE_LABELS.get(value, value)

def raw_path():
    """The undecoded request path, so percent-encoded forms answer not found."""
    uri = request.environ.get("RAW_URI") or request.environ.get("REQUEST_URI") or ""
    return uri.split("?", 1)[0] if uri else request.path

OUTAGE_BODY = "The service is briefly unavailable. Try again in a minute."
OUTAGE_PAGE_COPY = "The studio is briefly offline. Try again in a minute."


# --------------------------------------------------------------- refusals


def refusal(reason, status, headers=None, errors=None):
    """The one refusal shape for every API answer, framework errors included."""
    body = {"error": reason}
    if errors is not None:
        body["errors"] = errors
    resp = Response(json.dumps(body), status=status, mimetype="application/json")
    for key, value in (headers or {}).items():
        resp.headers[key] = value
    return resp


def api_path():
    return request.path.startswith("/api/")


def outage_answer():
    if api_path():
        return refusal(OUTAGE_BODY, 503)
    return render_template("outage.html"), 503


def method_not_allowed(allowed):
    return refusal("Method not allowed.", 405, headers={"Allow": ", ".join(allowed)})


@app.errorhandler(Exception)
def on_exception(exc):
    if isinstance(exc, HTTPException):
        code = exc.code
        if api_path():
            if code == 404:
                return refusal("Not found.", 404)
            if code == 405:
                allowed = request.url_rule.methods - {"HEAD", "OPTIONS"} if request.url_rule else set()
                return method_not_allowed(sorted(allowed))
            if code == 413:
                return refusal("The request body is larger than 32,768 bytes.", 413)
            if code == 415:
                return refusal("Send the request body as application/json.", 415)
            return refusal("Something went wrong.", 500)
        if code == 404:
            return render_template("404.html"), 404
        return exc
    app.logger.exception("unexpected failure")
    if api_path():
        return refusal("Something went wrong.", 500)
    return render_template("outage.html"), 503


# --------------------------------------------------------------- request body


def read_json_body():
    """Steps 2, 4 and 5 of the error precedence, in order."""
    if request.content_length is not None and request.content_length > rules.MAX_BODY_BYTES:
        return None, refusal("The request body is larger than 32,768 bytes.", 413)
    if request.mimetype != "application/json":
        return None, refusal("Send the request body as application/json.", 415)
    raw = request.get_data(cache=False)
    if len(raw) > rules.MAX_BODY_BYTES:
        return None, refusal("The request body is larger than 32,768 bytes.", 413)
    if not raw:
        return None, refusal("The request body is not a JSON object.", 400)
    try:
        parsed = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None, refusal("The request body is not a JSON object.", 400)
    if not isinstance(parsed, dict):
        return None, refusal("The request body is not a JSON object.", 400)
    return parsed, None


# --------------------------------------------------------------- database access


def bootstrap_once():
    """Create the schema and load the seed, tolerating a database that is not yet up."""
    if getattr(g, "bootstrapped", False):
        return
    with db.connection() as conn:
        db.bootstrap(conn)
    g.bootstrapped = True


@app.before_request
def before_request():
    g.conn = None
    g.bootstrapped = False
    if api_path() and request.content_length is not None \
            and request.content_length > rules.MAX_BODY_BYTES:
        return refusal("The request body is larger than 32,768 bytes.", 413)
    if "%" in raw_path():
        if api_path():
            return refusal("Not found.", 404)
        return render_template("404.html"), 404
    try:
        bootstrap_once()
    except db.DatabaseUnavailable:
        return outage_answer()


def conn():
    """The request's connection, opened once per request."""
    if g.conn is None:
        g.conn = db.connection()
        g._conn_cm = g.conn
        g.conn = g._conn_cm.__enter__()
    return g.conn


@app.teardown_request
def close_conn(_exc):
    cm = g.pop("_conn_cm", None)
    g.pop("conn", None)
    if cm is not None:
        try:
            cm.__exit__(None, None, None)
        except Exception:
            pass


# --------------------------------------------------------------- authorization


def authorization_token():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    return token or None


def session_account(c):
    """A live session, judged by the database clock: revoked or expired means refused."""
    token = authorization_token()
    if token is None:
        return None
    row = c.execute(
        "SELECT s.id AS session_id, s.expires_at, s.revoked_at, a.id AS account_id, a.email, a.role"
        " FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = %s",
        (token,),
    ).fetchone()
    if row is None:
        return None
    if row["revoked_at"] is not None:
        return None
    if db.db_now(c) >= row["expires_at"]:
        return None
    return row


def require_owner(view):
    """Server-side studio authorization: the token is checked before any record is read."""
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        c = conn()
        account = session_account(c)
        if account is None:
            return refusal("Sign in to continue.", 401)
        g.account = account
        return view(*args, **kwargs)
    return wrapper


# --------------------------------------------------------------- public pages


def render_page(title, template, **context):
    context.setdefault("title", title)
    return render_template(template, **context)


@app.route("/")
def home():
    c = conn()
    order = published_order(c)
    featured = []
    for index, record in enumerate(order):
        if not record["featured"]:
            continue
        card = dict(record)
        card["ordinal"] = rules.ordinal_string(index + 1)
        card["discipline_label"] = rules.DISCIPLINE_LABELS[record["discipline"]]
        card["cover"] = visuals.case_cover(card)
        featured.append(card)
    entries = [
        dict(r) for r in public_journal_entries(c)[:3]
    ]
    for e in entries:
        e["cover"] = visuals.journal_cover(e)
    figures = [dict(r) for r in c.execute(
        "SELECT value, label, caption FROM figures ORDER BY position ASC").fetchall()]
    recognitions = [dict(r) for r in c.execute(
        "SELECT award, issuer, awarded_on FROM recognitions ORDER BY position ASC").fetchall()]
    for r in recognitions:
        r["cover"] = visuals.recognition_visual(r)
    return render_page(
        "Ivo Kastrel - Front-End Developer, UI/UX Designer and 3D Web Developer",
        "home.html",
        featured=featured, journal_entries=entries, figures=figures,
        recognitions=recognitions,
    )


@app.route("/work")
def work_index():
    c = conn()
    discipline = request.args.get("discipline")
    if discipline is not None:
        if discipline not in rules.DISCIPLINES or len(request.args.getlist("discipline")) > 1:
            return redirect(url_for("work_index"), 302)
    order = published_order(c)
    if discipline is not None:
        cases = [r for r in order if r["discipline"] == discipline]
    else:
        cases = order
    ordinal_map = {r["slug"]: i + 1 for i, r in enumerate(order)}
    cards = []
    for r in cases:
        card = dict(r)
        card["ordinal"] = rules.ordinal_string(ordinal_map[card["slug"]])
        card["cover"] = visuals.case_cover(card)
        cards.append(card)
    return render_page(
        "Ivo Kastrel - Work", "work.html",
        cases=cards, current_discipline=discipline,
    )


@app.route("/work/<slug>")
def work_case(slug):
    case = public_case(slug)
    if case is None:
        return render_template("404.html"), 404
    return render_page(f"{case['title']} - Ivo Kastrel", "case.html", case=case)


@app.route("/journal")
def journal_index():
    c = conn()
    entries = [dict(r) for r in public_journal_entries(c)]
    for e in entries:
        e["cover"] = visuals.journal_cover(e)
    return render_page("Ivo Kastrel - Journal", "journal.html", journal_entries=entries)


@app.route("/journal/<slug>")
def journal_entry_page(slug):
    entry = public_journal_entry(slug)
    if entry is None:
        return render_template("404.html"), 404
    return render_page(f"{entry['title']} - Ivo Kastrel", "journal_entry.html", entry=entry)


@app.route("/contact")
def contact():
    return render_page("Ivo Kastrel - Contact", "contact.html")


@app.route("/studio")
def studio():
    """The gate: the same HTML for every request, carrying no record data."""
    return render_page("Ivo Kastrel - Studio", "studio.html")


@app.route("/studio/login")
def studio_login():
    return render_page("Ivo Kastrel - Studio", "login.html")


# --------------------------------------------------------------- catalogue order


def published_order(c):
    """The catalogue order: published case studies by position, then slug.

    Ordinals, totals and neighbours all derive from this one order at read time.
    """
    return [dict(r) for r in c.execute(
        "SELECT * FROM case_studies WHERE published ORDER BY position ASC, slug ASC"
    ).fetchall()]


def case_place(order, slug):
    index = next(i for i, r in enumerate(order) if r["slug"] == slug)
    total = len(order)
    previous = order[index - 1]
    nxt = order[(index + 1) % total]
    return {
        "ordinal": rules.ordinal_string(index + 1),
        "total": rules.ordinal_string(total),
        "previous": {"slug": previous["slug"], "title": previous["title"]},
        "next": {"slug": nxt["slug"], "title": nxt["title"]},
    }


def public_case(slug):
    with db.connection() as c:
        row = c.execute(
            "SELECT * FROM case_studies WHERE slug = %s AND published", (slug,)
        ).fetchone()
        if row is None:
            return None
        record = dict(row)
        record.update(case_place(published_order(c), slug))
        record["cover"] = visuals.case_stage(record)
        record["small_top"] = visuals.small_visual(record, 1)
        record["small_bottom"] = visuals.small_visual(record, 2)
        return record


# --------------------------------------------------------------- journal


def is_journal_public(c, row):
    """The journal's business-day rule: published, and on or before today in the studio's zone."""
    return row["published"] and row["published_on"] <= db.auckland_today(c)


def public_journal_entries(c):
    today = db.auckland_today(c)
    return c.execute(
        "SELECT * FROM journal_entries WHERE published AND published_on <= %s"
        " ORDER BY published_on DESC, slug ASC", (today,)
    ).fetchall()


def public_journal_entry(slug):
    with db.connection() as c:
        row = c.execute("SELECT * FROM journal_entries WHERE slug = %s", (slug,)).fetchone()
        if row is None or not is_journal_public(c, row):
            return None
        return dict(row)


# --------------------------------------------------------------- API: health and auth


@app.get("/api/health")
def api_health():
    try:
        with db.connection() as c:
            c.execute("SELECT 1")
    except db.DatabaseUnavailable:
        return refusal("unavailable", 503)
    return Response(json.dumps({"status": "ok"}), 200, mimetype="application/json")


def refused_refusals(c, email, now):
    """The sign-in lockout rule, decided once and counted from PostgreSQL.

    An email is locked while five or more refused attempts fall inside the
    trailing window and after its latest successful sign-in. Locked attempts
    count as refused.
    """
    window_start = now - dt.timedelta(seconds=rules.SIGN_IN_LOCKOUT_WINDOW_SECONDS)
    latest_success = c.execute(
        "SELECT attempted_at FROM sign_in_attempts WHERE email = %s AND succeeded"
        " ORDER BY attempted_at DESC LIMIT 1", (email,)
    ).fetchone()
    since = latest_success["attempted_at"] if latest_success else None
    counted = c.execute(
        "SELECT attempted_at FROM sign_in_attempts"
        " WHERE email = %s AND NOT succeeded AND attempted_at >= %s"
        " AND attempted_at > COALESCE(%s, '-infinity'::timestamptz)"
        " ORDER BY attempted_at DESC",
        (email, window_start, since),
    ).fetchall()
    return counted


def lockout_retry_after(counted, now):
    """Seconds until the lock lifts if no further attempt arrives, capped to the window."""
    if not counted:
        return rules.SIGN_IN_LOCKOUT_WINDOW_SECONDS
    newest = max(r["attempted_at"] for r in counted)
    oldest = min(r["attempted_at"] for r in counted)
    wait = (newest - oldest).total_seconds() + rules.SIGN_IN_LOCKOUT_WINDOW_SECONDS
    return int(min(max(rules.SIGN_IN_LOCKOUT_WINDOW_SECONDS - (now - oldest).total_seconds(), 1),
                   rules.SIGN_IN_LOCKOUT_WINDOW_SECONDS))


@app.post("/api/auth/login")
def api_login():
    body, err = read_json_body()
    if err is not None:
        return err
    c = conn()
    email_raw = body.get("email")
    password = body.get("password")
    email = email_raw.strip().lower() if isinstance(email_raw, str) else None
    now = db.db_now(c)
    # Precedence: a locked email answers 429 before any field problem is named.
    if email:
        counted = refused_refusals(c, email, now)
        if len(counted) >= rules.SIGN_IN_LOCKOUT_REFUSALS:
            c.execute(
                "INSERT INTO sign_in_attempts (email, succeeded, attempted_at)"
                " VALUES (%s, FALSE, %s)", (email, now),
            )
            retry = lockout_retry_after(counted, now)
            return refusal("Too many sign-in attempts. Try again later.", 429,
                           headers={"Retry-After": str(retry)})
    if not isinstance(email_raw, str) or not isinstance(password, str):
        errors = {}
        if not isinstance(email_raw, str):
            errors["email"] = "Use text."
        if not isinstance(password, str):
            errors["password"] = "Use text."
        return refusal("Some fields need attention.", 422, errors=errors)
    if not email or not password:
        errors = {}
        if not email:
            errors["email"] = "This field is required."
        if not password:
            errors["password"] = "This field is required."
        return refusal("Some fields need attention.", 422, errors=errors)
    account = c.execute(
        "SELECT id, password_hash FROM accounts WHERE email = %s", (email,)
    ).fetchone()
    if account is None or not db.verify_password(password, account["password_hash"]):
        c.execute(
            "INSERT INTO sign_in_attempts (email, succeeded, attempted_at) VALUES (%s, FALSE, %s)",
            (email, now),
        )
        return refusal("Email or password is incorrect.", 401)
    token = secrets.token_urlsafe(32)
    expires = now + dt.timedelta(seconds=rules.SESSION_LIFETIME_SECONDS)
    c.execute(
        "INSERT INTO sessions (account_id, token, created_at, expires_at)"
        " VALUES (%s, %s, %s, %s)",
        (account["id"], token, now, expires),
    )
    c.execute(
        "INSERT INTO sign_in_attempts (email, succeeded, attempted_at) VALUES (%s, TRUE, %s)",
        (email, now),
    )
    return Response(json.dumps({"token": token}), 200, mimetype="application/json")


@app.post("/api/auth/logout")
def api_logout():
    c = conn()
    if session_account(c) is None:
        return refusal("Sign in to continue.", 401)
    c.execute(
        "UPDATE sessions SET revoked_at = %s WHERE token = %s",
        (db.db_now(c), authorization_token()),
    )
    return Response(status=204)


# --------------------------------------------------------------- public API


@app.get("/api/cases")
def api_cases():
    discipline = request.args.get("discipline")
    if discipline is not None:
        if discipline not in rules.DISCIPLINES or len(request.args.getlist("discipline")) > 1:
            return refusal("Some fields need attention.", 422,
                           errors={"discipline": "Choose ui-ux, 3d-web or frontend."})
    with db.connection() as c:
        order = published_order(c)
    ordinal_map = {r["slug"]: i + 1 for i, r in enumerate(order)}
    rows = [r for r in order if discipline is None or r["discipline"] == discipline]
    payload = [
        {
            "slug": r["slug"], "title": r["title"], "discipline": r["discipline"],
            "summary": r["summary"], "year": r["year"], "featured": r["featured"],
            "ordinal": rules.ordinal_string(ordinal_map[r["slug"]]),
        }
        for r in rows
    ]
    return Response(json.dumps(payload), 200, mimetype="application/json")


@app.get("/api/cases/<slug>")
def api_case(slug):
    case = public_case(slug)
    if case is None:
        return refusal("Not found.", 404)
    return Response(json.dumps({
        "slug": case["slug"], "title": case["title"], "discipline": case["discipline"],
        "summary": case["summary"], "challenge": case["challenge"],
        "approach": case["approach"], "outcome": case["outcome"], "stack": case["stack"],
        "year": case["year"], "featured": case["featured"], "ordinal": case["ordinal"],
        "total": case["total"], "previous": case["previous"], "next": case["next"],
    }), 200, mimetype="application/json")


@app.get("/api/journal")
def api_journal():
    with db.connection() as c:
        rows = public_journal_entries(c)
    payload = [
        {"slug": r["slug"], "title": r["title"], "excerpt": r["excerpt"],
         "published_on": r["published_on"].isoformat()}
        for r in rows
    ]
    return Response(json.dumps(payload), 200, mimetype="application/json")


@app.get("/api/journal/<slug>")
def api_journal_entry(slug):
    entry = public_journal_entry(slug)
    if entry is None:
        return refusal("Not found.", 404)
    return Response(json.dumps({
        "slug": entry["slug"], "title": entry["title"], "excerpt": entry["excerpt"],
        "body": entry["body"], "published_on": entry["published_on"].isoformat(),
    }), 200, mimetype="application/json")


@app.get("/api/recognitions")
def api_recognitions():
    with db.connection() as c:
        rows = c.execute(
            "SELECT award, issuer, awarded_on FROM recognitions ORDER BY position ASC"
        ).fetchall()
    payload = [
        {"award": r["award"], "issuer": r["issuer"], "awarded_on": r["awarded_on"].isoformat()}
        for r in rows
    ]
    return Response(json.dumps(payload), 200, mimetype="application/json")


@app.get("/api/figures")
def api_figures():
    with db.connection() as c:
        rows = c.execute(
            "SELECT value, label, caption FROM figures ORDER BY position ASC"
        ).fetchall()
    return Response(json.dumps([dict(r) for r in rows]), 200, mimetype="application/json")


# --------------------------------------------------------------- inquiries


def inquiry_errors(body):
    """One validation answer naming every failing inquiry field."""
    errors = {}
    for key in body:
        if key not in rules.INQUIRY_FIELDS:
            errors[key] = "This field cannot be set."
    for f in rules.INQUIRY_REQUIRED:
        v = body.get(f)
        if v is None:
            errors.setdefault(f, "This field is required.")
            continue
        if not isinstance(v, str):
            errors.setdefault(f, "Use text.")
            continue
        trimmed = v.strip()
        if f == "name":
            if not trimmed:
                errors.setdefault(f, "This field is required.")
            elif len(trimmed) > rules.NAME_MAX:
                errors.setdefault(f, f"Use at most {rules.NAME_MAX} characters.")
            elif any(ord(ch) <= 31 for ch in v):
                errors.setdefault(f, "Remove control characters.")
        elif f == "phone":
            if len(trimmed) < rules.PHONE_MIN:
                errors.setdefault(f, f"Use at least {rules.PHONE_MIN} characters.")
            elif len(trimmed) > rules.PHONE_MAX:
                errors.setdefault(f, f"Use at most {rules.PHONE_MAX} characters.")
            elif not rules.is_phone(trimmed):
                errors.setdefault(f, "Use digits, spaces, +, - ( and ) only.")
        elif f == "email":
            if not rules.check_email(trimmed):
                errors.setdefault(f, "Enter a valid email address.")
        elif f == "message":
            if len(trimmed) < rules.MESSAGE_MIN:
                errors.setdefault(f, f"Use at least {rules.MESSAGE_MIN} characters.")
            elif len(trimmed) > rules.MESSAGE_MAX:
                errors.setdefault(f, f"Use at most {rules.MESSAGE_MAX} characters.")
    if "project_type" in body:
        v = body["project_type"]
        if v is None or not isinstance(v, str) or v not in rules.PROJECT_TYPES:
            errors.setdefault("project_type", "Choose ui-ux, 3d-web, frontend or other.")
    return errors


def inquiry_stored_answer(row):
    return Response(json.dumps({"id": row["id"], "status": row["status"]}),
                    200, mimetype="application/json")


@app.post("/api/inquiries")
def api_create_inquiry():
    body, err = read_json_body()
    if err is not None:
        return err
    errors = inquiry_errors(body)
    if errors:
        return refusal("Some fields need attention.", 422, errors=errors)
    c = conn()
    email = body["email"].strip().lower()
    message = body["message"].strip()
    project_type = body.get("project_type")
    # The duplicate-inquiry window, decided once and judged by the database clock.
    # The advisory lock makes a burst of identical submissions land exactly once.
    with c.transaction():
        c.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (email + "\x1f" + message,))
        window_start = db.db_now(c) - dt.timedelta(seconds=rules.DUPLICATE_INQUIRY_WINDOW_SECONDS)
        existing = c.execute(
            "SELECT id, status FROM inquiries"
            " WHERE lower(email) = %s AND message = %s AND received_at >= %s"
            " ORDER BY id DESC LIMIT 1",
            (email, message, window_start),
        ).fetchone()
        if existing is not None:
            duplicate = existing
            row = None
        else:
            duplicate = None
            row = c.execute(
                "INSERT INTO inquiries (name, phone, email, message, project_type, status, received_at)"
                " VALUES (%s, %s, %s, %s, %s, 'new', %s)"
                " RETURNING id, status",
                (body["name"].strip(), body["phone"].strip(), email, message, project_type,
                 db.db_now(c)),
            ).fetchone()
    if duplicate is not None:
        return inquiry_stored_answer(duplicate)
    return Response(json.dumps({"id": row["id"], "status": row["status"]}),
                    201, mimetype="application/json")


# --------------------------------------------------------------- studio API


def studio_row(row):
    return {
        "id": row["id"], "slug": row["slug"], "title": row["title"],
        "discipline": row["discipline"], "summary": row["summary"],
        "challenge": row["challenge"], "approach": row["approach"],
        "outcome": row["outcome"], "stack": row["stack"], "year": row["year"],
        "featured": row["featured"], "position": row["position"],
        "published": row["published"], "published_at": row["published_at"],
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }


def inquiry_row(row):
    return {
        "id": row["id"], "name": row["name"], "phone": row["phone"], "email": row["email"],
        "message": row["message"], "project_type": row["project_type"],
        "status": row["status"], "received_at": row["received_at"],
        "resolved_at": row["resolved_at"],
    }


def case_errors(body, creating):
    """One validation answer naming every failing case study field.

    Lengths count Unicode code points after trimming; null is never accepted.
    """
    errors = {}
    accepted = rules.CREATE_FIELDS if creating else rules.EDITABLE_FIELDS
    for key in body:
        if key not in accepted:
            errors[key] = "This field cannot be set."
    if creating:
        for f in rules.REQUIRED_ON_CREATE:
            if f not in body:
                errors.setdefault(f, "This field is required.")
    if not creating and not any(f in body for f in rules.EDITABLE_FIELDS):
        errors["body"] = "Send at least one field to change."
        return errors

    def text_field(name, max_len, min_len=0):
        if name not in body:
            return
        v = body[name]
        if v is None:
            errors.setdefault(name, "This field is required." if name in rules.REQUIRED_ON_CREATE
                              else "Use text.")
            return
        if not isinstance(v, str):
            errors.setdefault(name, "Use text.")
            return
        trimmed = v.strip()
        if creating and name in rules.REQUIRED_ON_CREATE and not trimmed:
            errors.setdefault(name, "This field is required.")
            return
        if len(trimmed) < min_len:
            errors.setdefault(name, f"Use at least {min_len} characters.")
        elif len(trimmed) > max_len:
            errors.setdefault(name, f"Use at most {max_len} characters.")

    text_field("title", rules.TITLE_MAX, 1)
    if creating and "slug" in body:
        v = body["slug"]
        if v is None or not isinstance(v, str) or not v.strip():
            errors.setdefault("slug", "This field is required.")
        elif not rules.is_slug(v.strip()):
            errors.setdefault("slug", "Use lowercase letters, digits and single hyphens.")
    text_field("summary", rules.SUMMARY_MAX)
    text_field("challenge", rules.BODY_MAX)
    text_field("approach", rules.BODY_MAX)
    text_field("outcome", rules.BODY_MAX)
    text_field("stack", rules.STACK_MAX)

    def integer_field(name, lo, hi):
        if name not in body:
            return
        v = body[name]
        if v is None:
            errors.setdefault(name, "This field is required.")
        elif isinstance(v, bool) or not isinstance(v, int):
            errors.setdefault(name, "Use a whole number.")
        elif not lo <= v <= hi:
            errors.setdefault(name, f"Use a whole number from {lo} to {hi}.")

    integer_field("year", rules.YEAR_MIN, rules.YEAR_MAX)
    integer_field("position", rules.POSITION_MIN, rules.POSITION_MAX)

    for name in ("featured",):
        if name in body:
            v = body[name]
            if v is None or not isinstance(v, bool):
                errors.setdefault(name, "Use true or false.")
    if "discipline" in body:
        v = body["discipline"]
        if v is None or not isinstance(v, str) or v not in rules.DISCIPLINES:
            errors.setdefault("discipline", "Choose ui-ux, 3d-web or frontend.")
    return errors


def publish_blank_errors(summary, outcome):
    """The publish rule, decided once: publishing needs a summary and an outcome."""
    errors = {}
    if not summary.strip():
        errors["summary"] = "Add a summary before publishing."
    if not outcome.strip():
        errors["outcome"] = "Add an outcome before publishing."
    return errors


@app.get("/api/studio/cases")
@require_owner
def api_studio_cases():
    c = conn()
    rows = c.execute(
        "SELECT * FROM case_studies ORDER BY position ASC, slug ASC"
    ).fetchall()
    return Response(json.dumps([studio_row(r) for r in rows], default=json_default), 200, mimetype="application/json")


@app.post("/api/studio/cases")
@require_owner
def api_studio_create_case():
    body, err = read_json_body()
    if err is not None:
        return err
    errors = case_errors(body, creating=True)
    if errors:
        return refusal("Some fields need attention.", 422, errors=errors)
    c = conn()
    try:
        row = c.execute(
            "INSERT INTO case_studies (slug, title, discipline, summary, challenge, approach,"
            " outcome, stack, year, featured, position)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
            (body["slug"].strip(), body["title"].strip(), body["discipline"],
             body.get("summary", "").strip(), body.get("challenge", "").strip(),
             body.get("approach", "").strip(), body.get("outcome", "").strip(),
             body.get("stack", "").strip(), body["year"],
             body.get("featured", False), body["position"]),
        ).fetchone()
    except psycopg.errors.UniqueViolation:
        return refusal("That slug is already in use.", 409)
    return Response(json.dumps(studio_row(row), default=json_default), 201, mimetype="application/json")


def load_case(c, case_id):
    if not str(case_id).isdigit():
        return None
    return c.execute("SELECT * FROM case_studies WHERE id = %s", (int(case_id),)).fetchone()


@app.patch("/api/studio/cases/<case_id>")
@require_owner
def api_studio_edit_case(case_id):
    body, err = read_json_body()
    if err is not None:
        return err
    c = conn()
    row = load_case(c, case_id)
    if row is None:
        return refusal("Not found.", 404)
    errors = case_errors(body, creating=False)
    if errors:
        return refusal("Some fields need attention.", 422, errors=errors)
    # A published case study may not be left with a blank summary or outcome.
    if row["published"]:
        summary = body.get("summary", row["summary"])
        outcome = body.get("outcome", row["outcome"])
        blank = publish_blank_errors(
            summary if isinstance(summary, str) else "",
            outcome if isinstance(outcome, str) else "",
        )
        if blank:
            return refusal("Some fields need attention.", 422, errors=blank)
    updates, values = [], []
    for f in rules.EDITABLE_FIELDS:
        if f in body:
            v = body[f]
            if isinstance(v, str):
                v = v.strip()
            updates.append(sql.SQL("{} = %s").format(sql.Identifier(f)))
            values.append(v)
    updates.append(sql.SQL("updated_at = statement_timestamp()"))
    values.append(row["id"])
    updated = c.execute(
        sql.SQL("UPDATE case_studies SET {} WHERE id = %s RETURNING *").format(
            sql.SQL(", ").join(updates)
        ),
        values,
    ).fetchone()
    return Response(json.dumps(studio_row(updated), default=json_default), 200, mimetype="application/json")


@app.post("/api/studio/cases/<case_id>/publish")
@require_owner
def api_studio_publish_case(case_id):
    body, err = read_json_body()
    if err is not None:
        return err
    for key in body:
        if key != "published":
            return refusal("Some fields need attention.", 422,
                           errors={key: "This field cannot be set."})
    if "published" not in body or not isinstance(body.get("published"), bool):
        return refusal("Some fields need attention.", 422,
                       errors={"published": "Use true or false."})
    c = conn()
    row = load_case(c, case_id)
    if row is None:
        return refusal("Not found.", 404)
    target = body["published"]
    if target == row["published"]:
        if target:
            return refusal("This case study is already published.", 409)
        return refusal("This case study is already a draft.", 409)
    if target:
        blank = publish_blank_errors(row["summary"], row["outcome"])
        if blank:
            return refusal("Some fields need attention.", 422, errors=blank)
        stamped = c.execute(
            "UPDATE case_studies SET published = TRUE, published_at = statement_timestamp(),"
            " updated_at = statement_timestamp() WHERE id = %s AND published = FALSE"
            " RETURNING *", (row["id"],)
        ).fetchone()
        if stamped is None:
            return refusal("This case study is already published.", 409)
        return Response(json.dumps(studio_row(stamped), default=json_default), 200, mimetype="application/json")
    cleared = c.execute(
        "UPDATE case_studies SET published = FALSE, published_at = NULL,"
        " updated_at = statement_timestamp() WHERE id = %s AND published = TRUE"
        " RETURNING *", (row["id"],)
    ).fetchone()
    if cleared is None:
        return refusal("This case study is already a draft.", 409)
    return Response(json.dumps(studio_row(cleared), default=json_default), 200, mimetype="application/json")


@app.delete("/api/studio/cases/<case_id>")
@require_owner
def api_studio_delete_case(case_id):
    c = conn()
    row = load_case(c, case_id)
    if row is None:
        return refusal("Not found.", 404)
    c.execute("DELETE FROM case_studies WHERE id = %s", (row["id"],))
    return Response(status=204)


@app.get("/api/studio/inquiries")
@require_owner
def api_studio_inquiries():
    c = conn()
    rows = c.execute(
        "SELECT * FROM inquiries ORDER BY received_at DESC, id DESC"
    ).fetchall()
    return Response(json.dumps([inquiry_row(r) for r in rows], default=json_default), 200, mimetype="application/json")


@app.post("/api/studio/inquiries/<inquiry_id>/resolve")
@require_owner
def api_studio_resolve_inquiry(inquiry_id):
    c = conn()
    if not str(inquiry_id).isdigit():
        return refusal("Not found.", 404)
    row = c.execute("SELECT id FROM inquiries WHERE id = %s", (int(inquiry_id),)).fetchone()
    if row is None:
        return refusal("Not found.", 404)
    resolved = c.execute(
        "UPDATE inquiries SET status = 'resolved', resolved_at = statement_timestamp()"
        " WHERE id = %s AND status = 'new' RETURNING *", (row["id"],)
    ).fetchone()
    if resolved is None:
        return refusal("This inquiry is already resolved.", 409)
    return Response(json.dumps(inquiry_row(resolved), default=json_default), 200, mimetype="application/json")


# --------------------------------------------------------------- banned addresses


for _banned in ("/api/auth/signup", "/api/cart", "/api/checkout",
                "/api/newsletter", "/api/search"):
    def _banned_route():
        return refusal("Not found.", 404)
    _banned_route.__name__ = "banned_" + _banned.strip("/api/").replace("/", "_")
    app.add_url_rule(_banned, _banned_route.__name__, _banned_route,
                     methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
