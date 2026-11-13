"""The API surface: one place produces every JSON answer and refusal."""

from __future__ import annotations

import datetime as dt
import json
import re

import clock
import core
import db
import desk
import queries
import seeddata
from flask import Blueprint, Response, request

api = Blueprint("api", __name__)

NOT_FOUND_BODY = json.dumps({"message": "Not found"}, separators=(",", ":"))
METHOD_NOT_ALLOWED = {"message": "Method not allowed"}
BODY_TOO_LARGE = {"message": "Request body too large"}
SIGN_IN_FIRST = {"message": "Sign in to use the desk"}
CANNOT_ACT = {"message": "Your account cannot do this"}
OUTAGE = {"message": "The reference desk is unavailable right now"}

ALREADY_PUBLISHED = {"message": "This reference is already published"}
NO_WINDOW = {"message": "Record a clearance window before publishing"}
WINDOW_ENDED = {"message": "The clearance window has ended"}
NO_FIGURE = {"message": "Add at least one result figure before publishing"}
NOT_PUBLISHED = {"message": "This reference is not published"}
ONLY_LIVE_MOVES = {"message": "Only a live reference can be moved"}
CHANGED_SINCE = {"message": "This reference has changed since you opened it"}
SIGN_IN_REFUSED = {"message": "The address or password is not right"}

# The desk's field messages. The keys are fixed; the wording is ours.
MSG_TITLE = "Give the reference a title of 1 to 120 characters"
MSG_SUMMARY = "Give the reference a summary"
MSG_CHALLENGE = "Describe the customer's challenge"
MSG_WORK = "Describe the work that was done"
MSG_SECTOR = "Give a sector of lowercase letters and hyphens, starting with a letter"
MSG_CUSTOMER = "Name the customer"
MSG_FIGURES = "Give 1 to 6 figures, each with a label and a value"
MSG_FIGURE_ITEM = "Give each figure a label and a value"
MSG_WINDOW = "Give both dates as YYYY-MM-DD"
MSG_WINDOW_ORDER = "The clearance window must end on or after the day it starts"

TIMESTAMP_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})"
    r"(Z|[+-]\d{2}:\d{2})$")


class ApiError(Exception):
    def __init__(self, status: int, payload: dict):
        self.status = status
        self.payload = payload


def json_response(payload, status: int = 200,
                  headers: dict | None = None) -> Response:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return Response(body, status=status, mimetype="application/json",
                    headers=headers or {})


def not_found() -> Response:
    return Response(NOT_FOUND_BODY, status=404, mimetype="application/json")


# The C json module overflows the Python stack near a thousand nested
# containers; the limit below keeps every body that fits the size limit safe.
_MAX_JSON_DEPTH = 900


def read_body(lenient: bool = False):
    """A write body is read as JSON whatever its content type declares.

    Returns the parsed object, or raises ApiError following the published
    precedence: size, then shape. An empty or absent body is {}. In lenient
    mode a hostile string inside is allowed through, so sign-in can answer
    its standard refusal. Nesting of any depth that fits the size limit is
    answered as a body error, never a stack overflow.
    """
    raw = request.get_data(cache=False, as_text=False)
    if len(raw) > core.BODY_MAX_BYTES:
        raise ApiError(413, BODY_TOO_LARGE)
    if not raw:
        return {}
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise ApiError(422, {"errors": {"body": "Send a JSON object"}})
    depth = 0
    for ch in text:
        if ch in "[{":
            depth += 1
            if depth > _MAX_JSON_DEPTH:
                raise ApiError(422, {"errors": {"body": "Send a JSON object"}})
        elif ch in "]}":
            depth -= 1
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, RecursionError):
        raise ApiError(422, {"errors": {"body": "Send a JSON object"}})
    if not isinstance(value, dict):
        raise ApiError(422, {"errors": {"body": "Send a JSON object"}})
    if not lenient and not _json_is_clean(value):
        raise ApiError(422, {"errors": {"body": "Send a JSON object"}})
    return value


def _json_is_clean(value) -> bool:
    """NaN, Infinity, -Infinity and hostile strings anywhere are refused.

    Walks the value iteratively so nesting of any depth that fits the size
    limit is judged without a stack overflow.
    """
    stack = [value]
    while stack:
        current = stack.pop()
        if isinstance(current, float):
            if current != current or current in (float("inf"), float("-inf")):
                return False
        elif isinstance(current, str):
            if _has_hostile_chars(current):
                return False
        elif isinstance(current, dict):
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return True


def _has_hostile_chars(text: str) -> bool:
    if "\x00" in text:
        return True
    for ch in text:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            return True
    return False


# ------------------------------------------------------------- public reads

@api.get("/api/health")
def health():
    try:
        db.run(lambda conn: conn.cursor().execute("SELECT 1").fetchone())
        return json_response({"status": "ok"})
    except db.Unavailable:
        return json_response({"status": "starting"}, 503)


def _query_sector() -> str | None:
    """With the parameter repeated, the first value is used. An empty value
    means no filter."""
    value = request.args.get("sector")
    if value is None or value == "":
        return None
    return value


def _needs_db(fn, *args, **kwargs):
    """Run a database unit of work; a failure answers the published outage."""
    try:
        return db.run(fn, *args, **kwargs)
    except db.Unavailable:
        raise ApiError(503, OUTAGE)


# ------------------------------------------------------ public reference API

def _index_payload(conn, today: dt.date, fi: bool, sector: str | None):
    rows = queries.live_references(conn, "northfall", today, sector)
    out = []
    for row in rows:
        figures = queries.figures_of(conn, row["id"])
        title = (row["title_fi"] or row["title"]) if fi else row["title"]
        result = None
        if figures:
            result = {"label": figures[0]["label"], "value": figures[0]["value"]}
        out.append({
            "slug": row["slug"], "ordinal": row["ordinal"], "sector": row["sector"],
            "title": title, "result": result,
        })
    return out


def _detail_payload(conn, row: dict, today: dt.date, fi: bool):
    figures = queries.figures_of(conn, row["id"])
    quote = None
    if row["quote"]:
        quote = {"text": row["quote"], "speaker": row["quote_speaker"],
                 "role": row["quote_role"]}
    payload = {
        "slug": row["slug"], "ordinal": row["ordinal"], "sector": row["sector"],
        "customer": row["customer"], "title": row["title"],
        "summary": row["summary"], "challenge": row["challenge"],
        "work": row["work"],
        "figures": [{"label": f["label"], "value": f["value"]} for f in figures],
        "quote": quote,
    }
    if fi:
        payload["title"] = row["title_fi"] or row["title"]
        payload["translated"] = bool(row["body_fi"])
        payload["body"] = row["body_fi"]
    return payload


def _public_detail(conn, slug: str, today: dt.date):
    """A live reference, a valid preview, or None for the standard 404."""
    programme_id = queries.programme_id_of(conn, "northfall")
    row = queries.reference_by_slug(conn, programme_id, slug)
    if row is None:
        redirect = queries.redirect_target(conn, programme_id, slug)
        if redirect is not None:
            return ("redirect", redirect["current_slug"])
        return None
    state = core.state_of(row, today)
    if state == core.LIVE:
        return ("live", row)
    token = request.args.get("preview")
    if token and not row["published"] and row["retired_at"] is None:
        now = clock.now(conn)
        if desk.valid_preview(conn, row, token, now):
            return ("preview", row)
    return None


def _preview_headers() -> dict:
    """A valid preview is served uncacheable and unindexed, exactly like the
    preview page."""
    return {"Cache-Control": "private, no-store",
            "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"}


@api.get("/api/references")
def references_index():
    def work(conn):
        today = clock.now_today(conn)
        return _index_payload(conn, today, False, _query_sector())
    return json_response(_needs_db(work))


@api.get("/api/references/<slug>")
def references_detail(slug: str):
    def work(conn):
        today = clock.now_today(conn)
        found = _public_detail(conn, slug, today)
        if found is None:
            return None
        kind, row = found
        if kind == "redirect":
            return ("redirect", row)
        payload = _detail_payload(conn, row, today, False)
        if kind == "preview":
            payload["_preview"] = True
        return ("detail", payload)
    result = _needs_db(work)
    if result is None:
        return not_found()
    kind, payload = result
    if kind == "redirect":
        target = f"/api/references/{payload}"
        return _redirect_response(target, request.query_string)
    headers = _preview_headers() if payload.get("_preview") else None
    payload.pop("_preview", None)
    return json_response(payload, headers=headers)


def _redirect_response(target: str, query_string: bytes) -> Response:
    """One permanent hop that keeps the query string byte for byte."""
    suffix = ""
    if query_string:
        suffix = "?" + query_string.decode("latin-1")
    return Response(status=301, headers={"Location": target + suffix})


@api.get("/api/sectors")
def sectors():
    def work(conn):
        today = clock.now_today(conn)
        return queries.live_sectors(conn, "northfall", today)
    return json_response(_needs_db(work))


@api.get("/api/notes")
def api_notes():
    def work(conn):
        return queries.notes(conn, "northfall")
    rows = _needs_db(work)
    return json_response([
        {"slug": n["slug"], "title": n["title"], "preview": n["preview"],
         "published_on": n["published_on"].isoformat() if n["published_on"] else None}
        for n in rows])


# --------------------------------------------------------- Finnish read API

@api.get("/api/fi/references")
def fi_references_index():
    def work(conn):
        today = clock.now_today(conn)
        return _index_payload(conn, today, True, _query_sector())
    return json_response(_needs_db(work))


@api.get("/api/fi/references/<slug>")
def fi_references_detail(slug: str):
    def work(conn):
        today = clock.now_today(conn)
        found = _public_detail(conn, slug, today)
        if found is None:
            return None
        kind, row = found
        if kind == "redirect":
            return ("redirect", row)
        payload = _detail_payload(conn, row, today, True)
        if kind == "preview":
            payload["_preview"] = True
        return ("detail", payload)
    result = _needs_db(work)
    if result is None:
        return not_found()
    kind, payload = result
    if kind == "redirect":
        target = f"/api/fi/references/{payload}"
        return _redirect_response(target, request.query_string)
    headers = _preview_headers() if payload.get("_preview") else None
    payload.pop("_preview", None)
    return json_response(payload, headers=headers)


@api.get("/api/fi/sectors")
def fi_sectors():
    def work(conn):
        today = clock.now_today(conn)
        return queries.live_sectors(conn, "northfall", today)
    return json_response(_needs_db(work))


@api.get("/api/fi/notes")
def fi_api_notes():
    def work(conn):
        return queries.notes(conn, "northfall")
    rows = _needs_db(work)
    return json_response([
        {"slug": n["slug"], "title": n["title"], "preview": n["preview"],
         "published_on": n["published_on"].isoformat() if n["published_on"] else None}
        for n in rows])


# ---------------------------------------------------------------- enquiries

EMAIL_MSG = "Enter a work address the desk can reply to"
AGREED_MSG = "Tick the box to agree to the privacy statement"
PHONE_MSG = "Enter a telephone number of at least ten characters"
REFERENCE_MSG = "Choose a reference from the library"


def _validate_enquiry(conn, body: dict, today: dt.date):
    """Every failing field is reported at once, in one pass."""
    errors = {}
    email = body.get("email")
    if not isinstance(email, str) or len(email) > 254 \
            or not core.EMAIL_RE.match(email.strip()):
        errors["email"] = EMAIL_MSG
    agreed = body.get("agreed")
    if agreed is not True:
        errors["agreed"] = AGREED_MSG
    phone = body.get("phone")
    if phone is not None:
        if not isinstance(phone, str):
            errors["phone"] = PHONE_MSG
        elif len(phone.strip()) < 10:
            errors["phone"] = PHONE_MSG
    reference = body.get("reference")
    if reference is not None and reference != "":
        if not isinstance(reference, str):
            errors["reference"] = REFERENCE_MSG
        else:
            programme_id = queries.programme_id_of(conn, "northfall")
            row = queries.reference_by_slug(conn, programme_id, reference)
            if row is None or core.state_of(row, today) != core.LIVE:
                errors["reference"] = REFERENCE_MSG
    return errors


@api.post("/api/enquiries")
def create_enquiry():
    body = read_body()
    def work(conn):
        today = clock.now_today(conn)
        errors = _validate_enquiry(conn, body, today)
        if errors:
            raise ApiError(422, {"errors": errors})
        now = clock.now(conn)
        programme_id = queries.programme_id_of(conn, "northfall")
        reference = body.get("reference")
        if reference == "":
            reference = None
        record = desk.record_enquiry(
            conn, programme_id, body["email"].strip(), body.get("phone"),
            reference, body["agreed"], now)
        return record
    try:
        record = _needs_db(work)
    except ApiError as exc:
        if exc.status == 503:
            raise
        return json_response(exc.payload, exc.status)
    return json_response({"id": record["id"], "reply_to": "hello@example.com"}, 201)


# ------------------------------------------------------------------- sign in

@api.post("/api/auth/login")
def login():
    body = read_body(lenient=True)

    def work(conn):
        email = body.get("email")
        password = body.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            return None
        # A hostile string is the standard failed sign-in: it never reaches
        # the store, because no query text can hold a NUL.
        if _has_hostile_chars(email) or _has_hostile_chars(password):
            return None
        row = queries._fetchone(conn.cursor(),
            "SELECT a.id, a.email, a.role, a.password_hash FROM account a "
            "WHERE lower(a.email) = lower(%s)", (email.strip(),))
        if row is None or not seeddata.verify_password(password, row["password_hash"]):
            return None
        now = clock.now(conn)
        token = desk.create_session(conn, row["id"], now)
        return {"token": token, "role": row["role"]}
    result = _needs_db(work)
    if result is None:
        return json_response(SIGN_IN_REFUSED, 401)
    return json_response(result)


# --------------------------------------------------------------- desk auth

def _desk_account(conn):
    """The acting account, its role and its programme, from the stored
    account behind the token, on every request."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    if not token:
        return None
    now = clock.now(conn)
    return desk.account_of_session(conn, token, now)


def _desk_work(fn):
    """A desk call with no bearer token, an unknown one or an ended one is
    refused 401."""
    def wrapper(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        return fn(conn, account)
    return wrapper


def _reference_or_404(conn, programme_id: int, slug: str, today: dt.date,
                     for_update: bool = False):
    row = desk.desk_reference(conn, programme_id, slug, today,
                              for_update=for_update)
    if row is None:
        raise ApiError(404, json.loads(NOT_FOUND_BODY))
    return row


def _validate_editable(body: dict, creating: bool) -> tuple[dict, dict]:
    """Validate the editable fields, ignoring every other key."""
    errors: dict[str, str] = {}
    fields: dict = {}
    required = ("title", "sector", "customer", "summary", "challenge", "work")

    def text_field(lo, hi):
        def validator(value):
            if not isinstance(value, str) or _has_hostile_chars(value):
                return False, None
            if len(value.strip()) < lo or len(value) > hi:
                return False, None
            return True, value
        return validator

    validators = {
        "title": (text_field(1, 120), MSG_TITLE),
        "summary": (text_field(1, 100000), MSG_SUMMARY),
        "challenge": (text_field(1, 100000), MSG_CHALLENGE),
        "work": (text_field(1, 100000), MSG_WORK),
        "sector": (lambda v: (isinstance(v, str) and bool(core.SECTOR_RE.match(v))
                               and not _has_hostile_chars(v), v), MSG_SECTOR),
        "customer": (text_field(1, 120), MSG_CUSTOMER),
    }
    for key in required:
        if creating and key not in body:
            errors[key] = validators[key][1]
        elif key in body:
            validator, message = validators[key]
            ok, cleaned = validator(body[key])
            if ok:
                fields[key] = cleaned
            else:
                errors[key] = message

    for key in ("quote", "quote_speaker", "quote_role", "title_fi", "body_fi"):
        if key in body:
            value = body[key]
            if value is None or (isinstance(value, str)
                                 and not _has_hostile_chars(value)):
                fields[key] = value
            else:
                errors[key] = MSG_TITLE

    if "figures" in body:
        figures = body["figures"]
        ok = isinstance(figures, list) and 1 <= len(figures) <= 6
        cleaned_figures = []
        if ok:
            for item in figures:
                if not isinstance(item, dict):
                    ok = False
                    break
                label, value = item.get("label"), item.get("value")
                hostile = any(_has_hostile_chars(v) for v in (label, value)
                              if isinstance(v, str))
                if hostile or not isinstance(label, str) or not label.strip() \
                        or not isinstance(value, str) or not value.strip():
                    ok = False
                    errors["figures"] = MSG_FIGURE_ITEM
                    break
                cleaned_figures.append({"label": label, "value": value})
        if not ok and "figures" not in errors:
            errors["figures"] = MSG_FIGURES
        elif ok:
            fields["figures"] = cleaned_figures
    return fields, errors


def _iso_or_none(value):
    return value.isoformat() if value is not None else None


def _reference_desk_payload(row: dict) -> dict:
    return {
        "slug": row["slug"], "title": row["title"], "sector": row["sector"],
        "state": row["state"], "published": row["published"],
        "live": row["state"] == core.LIVE, "ordinal": row["ordinal"],
        "clearance_from": _iso_or_none(row["clearance_from"]),
        "clearance_until": _iso_or_none(row["clearance_until"]),
    }


@api.get("/api/desk/references")
def desk_references():
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        today = clock.now_today(conn)
        rows = desk.desk_references(conn, account["programme_id"], today)
        return [_reference_desk_payload(r) for r in rows]
    return json_response(_needs_db(work))


@api.post("/api/desk/references")
def desk_create_reference():
    body = read_body()
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        today = clock.now_today(conn)
        fields, errors = _validate_editable(body, creating=True)
        if "title" in fields and not core.slugify(fields["title"]):
            errors["title"] = MSG_TITLE
        if errors:
            raise ApiError(422, {"errors": errors})
        record = desk.create_reference(conn, account["programme_id"], fields, today)
        return {"slug": record["slug"]}
    return json_response(_needs_db(work), 201)


@api.get("/api/desk/references/<slug>")
def desk_get_reference(slug: str):
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        today = clock.now_today(conn)
        row = _reference_or_404(conn, account["programme_id"], slug, today)
        payload = {
            "slug": row["slug"], "title": row["title"], "sector": row["sector"],
            "customer": row["customer"], "summary": row["summary"],
            "challenge": row["challenge"], "work": row["work"],
            "quote": row["quote"], "quote_speaker": row["quote_speaker"],
            "quote_role": row["quote_role"], "title_fi": row["title_fi"],
            "body_fi": row["body_fi"],
            "figures": [{"label": f["label"], "value": f["value"]}
                        for f in row["figures"]],
            "state": row["state"], "version": row["version"],
            "published": row["published"], "live": row["state"] == core.LIVE,
            "ordinal": row["ordinal"],
            "clearance_from": _iso_or_none(row["clearance_from"]),
            "clearance_until": _iso_or_none(row["clearance_until"]),
        }
        return payload
    return json_response(_needs_db(work))


@api.patch("/api/desk/references/<slug>")
def desk_edit_reference(slug: str):
    body = read_body()
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        today = clock.now_today(conn)
        row = _reference_or_404(conn, account["programme_id"], slug, today)
        if_match = request.headers.get("If-Match")
        if if_match is not None:
            if not (if_match.startswith('"') and if_match.endswith('"')) \
                    and if_match != "*":
                raise ApiError(412, CHANGED_SINCE)
            if if_match != "*":
                try:
                    expected = int(if_match[1:-1])
                except ValueError:
                    raise ApiError(412, CHANGED_SINCE)
                if expected != row["version"]:
                    raise ApiError(412, CHANGED_SINCE)
        fields, errors = _validate_editable(body, creating=False)
        if "title" in fields and not core.slugify(fields["title"]):
            errors["title"] = MSG_TITLE
        if errors:
            raise ApiError(422, {"errors": errors})
        result = desk.edit_reference(conn, account["programme_id"], row,
                                     fields, today)
        return result
    return json_response(_needs_db(work))


@api.post("/api/desk/references/<slug>/publish")
def desk_publish(slug: str):
    """Simultaneous publishes of one reference produce exactly one
    publication and one ordinal: the row is locked for the whole decision."""
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        today = clock.now_today(conn)
        row = _reference_or_404(conn, account["programme_id"], slug, today,
                               for_update=True)
        state = row["state"]
        if state in (core.LIVE, core.WITHHELD):
            raise ApiError(409, ALREADY_PUBLISHED)
        if row["clearance_from"] is None or row["clearance_until"] is None:
            raise ApiError(409, NO_WINDOW)
        if row["clearance_until"] < today:
            raise ApiError(409, WINDOW_ENDED)
        if not row["figures"]:
            raise ApiError(409, NO_FIGURE)
        return desk.publish(conn, account["programme_id"], row, today)
    return json_response(_needs_db(work))


@api.post("/api/desk/references/<slug>/retire")
def desk_retire(slug: str):
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        now = clock.now(conn)
        today = core.helsinki_date(now)
        row = _reference_or_404(conn, account["programme_id"], slug, today,
                               for_update=True)
        if row["state"] not in (core.LIVE, core.WITHHELD):
            raise ApiError(409, NOT_PUBLISHED)
        return desk.retire(conn, account["programme_id"], row, now, today)
    return json_response(_needs_db(work))


def _parse_timestamp(value, now: dt.datetime):
    """A preview expiry is written YYYY-MM-DDThh:mm:ss with Z or an offset."""
    if not isinstance(value, str):
        return None
    match = TIMESTAMP_RE.match(value)
    if not match:
        return None
    try:
        naive = dt.datetime(int(match.group(1)), int(match.group(2)),
                           int(match.group(3)), int(match.group(4)),
                           int(match.group(5)), int(match.group(6)))
    except ValueError:
        return None
    offset = match.group(7)
    if offset == "Z":
        tz = dt.timezone.utc
    else:
        sign = 1 if offset[0] == "+" else -1
        hours, minutes = int(offset[1:3]), int(offset[4:6])
        if hours > 23 or minutes > 59:
            return None
        tz = dt.timezone(sign * dt.timedelta(hours=hours, minutes=minutes))
    return naive.replace(tzinfo=tz)


@api.put("/api/desk/references/<slug>/clearance")
def desk_clearance(slug: str):
    body = read_body()
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        today = clock.now_today(conn)
        row = _reference_or_404(conn, account["programme_id"], slug, today)
        if account["role"] != "steward":
            raise ApiError(403, CANNOT_ACT)
        errors = {}
        start = core.parse_date(body.get("clearance_from"))
        until = core.parse_date(body.get("clearance_until"))
        if start is None:
            errors["clearance_from"] = MSG_WINDOW
        if until is None:
            errors["clearance_until"] = MSG_WINDOW
        if not errors and start > until:
            errors["clearance_until"] = MSG_WINDOW_ORDER
        if errors:
            raise ApiError(422, {"errors": errors})
        return desk.record_clearance(conn, account["programme_id"], row,
                                     start, until, today)
    return json_response(_needs_db(work))


@api.post("/api/desk/references/<slug>/preview")
def desk_preview(slug: str):
    body = read_body()
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        now = clock.now(conn)
        today = core.helsinki_date(now)
        row = _reference_or_404(conn, account["programme_id"], slug, today)
        if row["state"] in (core.LIVE, core.WITHHELD):
            raise ApiError(409, ALREADY_PUBLISHED)
        if body.get("expires_at"):
            expiry = _parse_timestamp(body["expires_at"], now)
            if expiry is None:
                raise ApiError(422, {"errors": {
                    "expires_at": "Give the expiry as YYYY-MM-DDThh:mm:ss with Z or an offset"}})
            seconds = (expiry - now).total_seconds()
            if seconds <= 0 or seconds > core.PREVIEW_MAX_SECONDS:
                raise ApiError(422, {"errors": {
                    "expires_at": "The expiry must be in the future and at most 30 days away"}})
        else:
            expiry = now + dt.timedelta(seconds=core.PREVIEW_DEFAULT_SECONDS)
        link = desk.mint_preview(conn, row["id"], expiry, now)
        return {"token": link["token"],
                "expires_at": format_timestamp(link["expires_at"])}
    return json_response(_needs_db(work), 201)


def format_timestamp(moment: dt.datetime) -> str:
    """The published form: YYYY-MM-DDThh:mm:ss with Z or an offset."""
    utc = moment.astimezone(dt.timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ")


@api.put("/api/desk/order")
def desk_order():
    body = read_body()
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        today = clock.now_today(conn)
        slug = body.get("slug")
        if not isinstance(slug, str) or not slug or _has_hostile_chars(slug):
            raise ApiError(422, {"errors": {"slug": "Name the reference to move"}})
        ordinal = body.get("ordinal")
        if not isinstance(ordinal, int) or isinstance(ordinal, bool) \
                or ordinal < 1:
            raise ApiError(422, {"errors": {"ordinal": "Give the position as a whole number of at least 1"}})
        row = desk.desk_reference(conn, account["programme_id"], slug, today)
        if row is None:
            raise ApiError(404, json.loads(NOT_FOUND_BODY))
        if row["state"] != core.LIVE:
            raise ApiError(409, ONLY_LIVE_MOVES)
        run = desk.move_reference(conn, account["programme_id"], row,
                                   ordinal, today)
        return run
    return json_response(_needs_db(work))


@api.get("/api/desk/enquiries")
def desk_enquiries():
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        rows = desk.desk_enquiries(conn, account["programme_id"])
        return [{"id": r["id"], "email": r["email"], "phone": r["phone"],
                 "reference": r["reference"],
                 "created_at": format_timestamp(r["created_at"]),
                 "agreed": r["agreed"]} for r in rows]
    return json_response(_needs_db(work))


@api.delete("/api/desk/enquiries/<int:enquiry_id>")
def desk_delete_enquiry(enquiry_id: int):
    def work(conn):
        account = _desk_account(conn)
        if account is None:
            raise ApiError(401, SIGN_IN_FIRST)
        exists = desk.delete_enquiry(conn, account["programme_id"],
                                     enquiry_id, check_only=True)
        if not exists:
            # The enquiry does not exist or belongs to another programme.
            raise ApiError(404, json.loads(NOT_FOUND_BODY))
        if account["role"] != "steward":
            raise ApiError(403, CANNOT_ACT)
        desk.delete_enquiry(conn, account["programme_id"], enquiry_id)
        return None
    _needs_db(work)
    return Response(status=204)
