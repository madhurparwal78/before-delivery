"""The JSON API under /api: public reads (also mounted at /api/fi), enquiries, sign-in and the desk."""
import json
import math
import re
import sys
from contextlib import contextmanager

from flask import Blueprint, Response, g, request

from . import library
from .clock import published_form
from .store import db, lock_programme

BODY_LIMIT = 65_536
DRAIN_LIMIT = 16 * 1024 * 1024
BODY_METHODS = ("POST", "PUT", "PATCH", "DELETE")
LARGEST_ENQUIRY_ID = 2 ** 63 - 1
# A JSON integer of any length that fits the body limit is still a number ("a very large integer places it last").
sys.set_int_max_str_digits(0)

MESSAGES = {
    401: "Sign in to use the desk",
    403: "Your account cannot do this",
    404: "Not found",
    405: "Method not allowed",
    413: "Request body too large",
    500: "The reference desk is unavailable right now",
    503: "The reference desk is unavailable right now",
}
BAD_SIGN_IN = "The address or password is not right"
STALE_VERSION = "This reference has changed since you opened it"
NOT_PUBLISHED = "This reference is not published"
ONLY_LIVE_MOVES = "Only a live reference can be moved"
PREVIEW_HEADERS = {"Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"}


def send(payload, status=200, headers=None):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
    return Response(body, status, headers, mimetype="application/json")


class Refusal(Exception):
    """Every /api refusal: `{"errors": {...}}` for invalid input, `{"message": ...}` for the rest."""

    def __init__(self, status, message=None, errors=None, headers=None):
        super().__init__(status)
        self.status, self.message, self.errors, self.headers = status, message, errors, headers

    def response(self):
        payload = {"errors": self.errors} if self.errors else {"message": self.message or MESSAGES[self.status]}
        return send(payload, self.status, self.headers)


def is_api_path(path):
    return path == "/api" or path.startswith("/api/")


def guard_api_request():
    """Before any listed /api handler: the body limit (rule 2), then the store (the outage comes before rules 3 to 8)."""
    if not is_api_path(request.path) or request.routing_exception is not None or request.endpoint == "api.health":
        return None
    if request.method in BODY_METHODS:
        if (request.content_length or 0) > BODY_LIMIT:
            return Refusal(413).response()
        g.raw_body = request.stream.read(BODY_LIMIT + 1)
        if len(g.raw_body) > BODY_LIMIT:
            return Refusal(413).response()
    library.settle_every_run(db())
    return None


def drain_body():
    """Read what is left of the request body before answering: gunicorn drains at most 64 KiB of an unread body
    and otherwise drops a connection it has already answered as keep-alive, so the client's next request on it
    would find it gone (a 413, or any refusal sent before the body was read)."""
    for _ in range(DRAIN_LIMIT // BODY_LIMIT):
        if not request.stream.read(BODY_LIMIT):
            break


def _refuse_constant(constant):
    raise ValueError(constant)


def _finite_float(text):
    value = float(text)
    if not math.isfinite(value):
        raise ValueError(text)
    return value


def json_body():
    """The request body as a JSON object; an empty body reads as {}."""
    raw = g.get("raw_body", b"")
    if not raw:
        return {}
    try:
        body = json.loads(raw.decode("utf-8"), parse_constant=_refuse_constant, parse_float=_finite_float)
    except (ValueError, RecursionError):
        body = None
    if not isinstance(body, dict):
        raise Refusal(422, errors={"body": "Send a JSON object"})
    return body


def moved_address(current_slug):
    """The current address of an earlier slug: same prefix, the query string byte for byte, root-relative."""
    query = request.query_string.decode("latin-1")
    return request.path.rsplit("/", 1)[0] + f"/{current_slug}" + (f"?{query}" if query else "")


# ---------------------------------------------------------------- public reads (English and Finnish)

reads = Blueprint("reads", __name__)


def reading_finnish():
    return request.blueprint == "reads_fi"


@reads.get("/references")
def reference_index():
    conn = db()
    rows = library.live_rows(conn, library.served_programme(conn)["id"], request.args.get("sector") or None)
    return send([library.index_entry(row, reading_finnish()) for row in rows])


@reads.get("/references/<slug>")
def reference_detail(slug):
    conn = db()
    found, reference = library.find_public_reference(conn, library.served_programme(conn)["id"], slug,
                                                     request.args.get("preview"))
    if found == "moved":
        return send({"slug": reference}, 301, {"Location": moved_address(reference)})
    if found is None:
        raise Refusal(404)
    return send(library.reference_detail(conn, reference, reading_finnish()),
                headers=PREVIEW_HEADERS if found == "preview" else None)


@reads.get("/sectors")
def sectors():
    conn = db()
    return send(library.live_sectors(conn, library.served_programme(conn)["id"]))


@reads.get("/notes")
def notes():
    conn = db()
    return send(library.dated_notes(conn, library.served_programme(conn)["id"]))


# ---------------------------------------------------------------- health, enquiries, sign-in

api = Blueprint("api", __name__)


@api.get("/health")
def health():
    db()
    return send({"status": "ok"})


@api.post("/enquiries")
def send_enquiry():
    body = json_body()
    conn = db()
    programme_id = library.served_programme(conn)["id"]
    enquiry, errors = library.read_enquiry(conn, programme_id, body)
    if errors:
        raise Refusal(422, errors=errors)
    return send({"id": library.record_enquiry(conn, programme_id, enquiry), "reply_to": library.REPLY_TO}, 201)


@api.post("/auth/login")
def sign_in():
    body = json_body()
    signed_in = library.sign_in(db(), body.get("email"), body.get("password"))
    if signed_in is None:
        raise Refusal(401, BAD_SIGN_IN)
    token, role, programme = signed_in
    # The desk compares this across sign-ins to decide whether a pending action may resume.
    return send({"token": token, "role": role}, headers={"X-Desk-Programme": programme})


# ---------------------------------------------------------------- the desk

def desk_account():
    """The acting account (id, role, programme) behind the bearer token; never from the request body."""
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    account = library.session_account(db(), token.strip()) if scheme.lower() == "bearer" and token.strip() else None
    if account is None:
        raise Refusal(401)
    return account


def require_steward(account):
    """The one role check: recording a clearance window and deleting an enquiry are a steward's."""
    if account["role"] != "steward":
        raise Refusal(403)


@contextmanager
def programme_change(conn, account):
    """One transaction holding the account's programme lock, with the run settled after the change."""
    with conn.transaction():
        lock_programme(conn, account["programme_id"])
        library.settle_run(conn, account["programme_id"])
        yield
        library.settle_run(conn, account["programme_id"])


def desk_reference(conn, account, slug):
    """A reference of the account's own programme by its current slug, locked for the change."""
    reference = conn.execute("SELECT * FROM reference_entry WHERE programme_id = %s AND slug = %s FOR UPDATE",
                             (account["programme_id"], slug)).fetchone()
    if reference is None:
        raise Refusal(404)
    return reference


def desk_list_entry(row):
    return {"slug": row["slug"], "title": row["title"], "sector": row["sector"], "state": library.reference_state(row),
            "published": row["published"], "live": row["live"], "ordinal": row["ordinal"],
            "clearance_from": row["clearance_from"], "clearance_until": row["clearance_until"]}


@api.get("/desk/references")
def desk_references():
    account = desk_account()
    return send([desk_list_entry(row) for row in library.desk_rows(db(), account["programme_id"])])


@api.post("/desk/references")
def create_draft():
    account = desk_account()
    fields, errors = library.read_editable(json_body(), creating=True)
    if errors:
        raise Refusal(422, errors=errors)
    conn = db()
    with programme_change(conn, account):
        slug = library.create_draft(conn, account["programme_id"], fields)
    return send({"slug": slug}, 201)


@api.get("/desk/references/<slug>")
def desk_reference_detail(slug):
    account = desk_account()
    conn = db()
    row = library.desk_row(conn, account["programme_id"], slug)
    if row is None:
        raise Refusal(404)
    editable = {key: row[key] for key in library.EDITABLE_FIELDS if key != "figures"}
    return send(desk_list_entry(row) | editable | {"version": row["version"],
                                                   "figures": library.figures_of(conn, row["id"])})


@api.patch("/desk/references/<slug>")
def edit_reference(slug):
    account = desk_account()
    body = json_body()
    conn = db()
    with programme_change(conn, account):
        reference = desk_reference(conn, account, slug)
        if not library.matches_version(request.headers.get("If-Match"), reference["version"]):
            raise Refusal(412, STALE_VERSION)
        fields, errors = library.read_editable(body, creating=False)
        if errors:
            raise Refusal(422, errors=errors)
        slug, version, voided = library.edit_reference(conn, reference, fields)
    return send({"slug": slug, "version": version, "clearance_voided": voided})


@api.post("/desk/references/<slug>/publish")
def publish(slug):
    account = desk_account()
    conn = db()
    with programme_change(conn, account):
        reference = desk_reference(conn, account, slug)
        refusal = library.publication_refusal(conn, reference)
        if refusal:
            raise Refusal(409, refusal)
        library.publish(conn, reference)
    return send({"slug": slug, "ordinal": library.desk_row(conn, account["programme_id"], slug)["ordinal"]})


@api.post("/desk/references/<slug>/retire")
def retire(slug):
    account = desk_account()
    conn = db()
    with programme_change(conn, account):
        reference = desk_reference(conn, account, slug)
        if not reference["published"]:
            raise Refusal(409, NOT_PUBLISHED)
        library.retire(conn, reference)
    return send({"slug": slug})


@api.put("/desk/references/<slug>/clearance")
def record_clearance_window(slug):
    account = desk_account()
    body = json_body()
    conn = db()
    with programme_change(conn, account):
        reference = desk_reference(conn, account, slug)
        require_steward(account)
        window, errors = library.read_clearance_window(body)
        if errors:
            raise Refusal(422, errors=errors)
        library.record_clearance_window(conn, reference, window)
    return send({"slug": slug, **window, "live": library.desk_row(conn, account["programme_id"], slug)["live"]})


@api.post("/desk/references/<slug>/preview")
def make_preview_link(slug):
    account = desk_account()
    body = json_body()
    conn = db()
    with programme_change(conn, account):
        reference = desk_reference(conn, account, slug)
        if reference["published"]:
            raise Refusal(409, library.ALREADY_PUBLISHED)
        expires_at, problem = library.read_preview_expiry(conn, body)
        if problem:
            raise Refusal(422, errors={"expires_at": problem})
        token = library.mint_preview_link(conn, reference, expires_at)
    return send({"token": token, "expires_at": published_form(expires_at)}, 201)


@api.put("/desk/order")
def move():
    account = desk_account()
    body = json_body()
    slug, ordinal = body.get("slug"), body.get("ordinal")
    if not library.is_clean_text(slug):
        raise Refusal(422, errors={"slug": "Name the reference to move by its slug"})
    conn = db()
    with programme_change(conn, account):
        reference = desk_reference(conn, account, slug)
        if reference["ordinal"] is None:
            raise Refusal(409, ONLY_LIVE_MOVES)
        if not (type(ordinal) is int and ordinal >= 1):
            raise Refusal(422, errors={"ordinal": "Give a whole number of 1 or more"})
        run = library.move_in_run(conn, account["programme_id"], reference["id"], ordinal)
    return send(run)


@api.get("/desk/enquiries")
def enquiry_queue():
    account = desk_account()
    return send(library.open_enquiries(db(), account["programme_id"]))


@api.delete("/desk/enquiries/<enquiry_id>")
def delete_enquiry(enquiry_id):
    account = desk_account()
    if not re.fullmatch(r"[0-9]+", enquiry_id) or int(enquiry_id) > LARGEST_ENQUIRY_ID:
        raise Refusal(404)
    conn = db()
    with conn.transaction():
        enquiry = conn.execute("SELECT id FROM enquiry WHERE id = %s AND programme_id = %s AND open FOR UPDATE",
                               (int(enquiry_id), account["programme_id"])).fetchone()
        if enquiry is None:
            raise Refusal(404)
        require_steward(account)
        conn.execute("UPDATE enquiry SET open = false WHERE id = %s", (enquiry["id"],))
    return Response(status=204, mimetype="application/json")
