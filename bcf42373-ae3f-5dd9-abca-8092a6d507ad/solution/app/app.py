"""Ivo Kastrel: the public site, the owner's studio and the JSON API, served from one Flask app."""

import json
import re
from datetime import date

import psycopg
from flask import Flask, g, jsonify, redirect, render_template, request
from flask.json.provider import DefaultJSONProvider
from werkzeug.exceptions import HTTPException, MethodNotAllowed, NotFound, RequestEntityTooLarge

import config
import store
from rules import (DISCIPLINE_CHOICE, DISCIPLINES, NUMBER_LIMITS, PROJECT_TYPES, TEXT_LIMITS, Refused, case_changes,
                   inquiry_values, invalid, not_found, publish_choice, sign_in_email, sign_in_problems)
from visuals import stage_grid, visual


class JSONProvider(DefaultJSONProvider):
    sort_keys = False

    @staticmethod
    def default(value):
        if isinstance(value, date):
            return value.isoformat()
        return DefaultJSONProvider.default(value)


app = Flask(__name__)
app.config["PROVIDE_AUTOMATIC_OPTIONS"] = False
app.json = JSONProvider(app)
app.config["MAX_CONTENT_LENGTH"] = config.BODY_LIMIT_BYTES
app.url_map.merge_slashes = False
app.teardown_appcontext(store.close)
app.jinja_env.globals.update(visual=visual, stage_grid=stage_grid, disciplines=DISCIPLINES,
                             project_types=PROJECT_TYPES, text_limits=TEXT_LIMITS, number_limits=NUMBER_LIMITS)

PUBLIC_CASE = ("slug", "title", "discipline", "summary", "year", "featured", "ordinal")
CASE_DETAIL = ("slug", "title", "discipline", "summary", "challenge", "approach", "outcome", "stack", "year",
               "featured", "ordinal", "total", "previous", "next")
FRAMEWORK_REASONS = {
    400: "The request body is not a JSON object.",
    404: "Not found.",
    405: "Method not allowed.",
    413: f"The request body is larger than {config.BODY_LIMIT_BYTES:,} bytes.",
    415: "Send the request body as application/json.",
    500: "Something went wrong.",
}
STORED_ID = re.compile(r"[1-9][0-9]{0,18}")
BIGINT_MAX = 2**63 - 1


@app.template_filter("long_date")
def long_date(value: date) -> str:
    return f"{value:%B} {value.day}, {value.year}"


@app.template_filter("paragraphs")
def paragraphs(text: str) -> list[str]:
    return [part.strip() for part in text.split("\n\n") if part.strip()]


# Refusals ------------------------------------------------------------------------------------------------

def refusal(status: int, reason: str, errors: dict | None = None, headers: dict | None = None):
    """The one JSON refusal shape every /api error answers with."""
    body = {"error": reason}
    if errors:
        body["errors"] = errors
    return jsonify(body), status, headers or {}


def is_api() -> bool:
    return request.path == "/api" or request.path.startswith("/api/")


def not_found_page():
    return render_template("not_found.html"), 404


@app.errorhandler(Refused)
def refused(error: Refused):
    if is_api():
        return refusal(error.status, error.reason, error.errors, error.headers)
    return not_found_page()


@app.errorhandler(HTTPException)
def framework_error(error: HTTPException):
    if is_api():
        headers = {"Allow": ", ".join(error.valid_methods)} if isinstance(error, MethodNotAllowed) else None
        return refusal(error.code, FRAMEWORK_REASONS.get(error.code, FRAMEWORK_REASONS[500]), headers=headers)
    return not_found_page()


@app.errorhandler(psycopg.OperationalError)
def database_unreachable(_error):
    if request.path == "/api/health":
        return {"status": "unavailable"}, 503
    if is_api():
        return refusal(503, "The service is briefly unavailable. Try again in a minute.")
    return render_template("message.html", heading="Briefly offline",
                           text="The studio is briefly offline. Try again in a minute."), 503


@app.errorhandler(Exception)
def unexpected(error: Exception):
    app.logger.exception("unexpected failure", exc_info=error)
    if is_api():
        return refusal(500, FRAMEWORK_REASONS[500])
    return render_template("message.html", heading="Something went wrong",
                           text="This page could not be shown. Try again in a minute."), 500


# Request guard: the error precedence up to authorization -----------------------------------------------

def owner_only(view):
    view.owner_only = True
    return view


def bearer_token() -> str | None:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" else None


@app.before_request
def guard():
    if request.routing_exception is not None:
        raise request.routing_exception
    if not request.view_args and not exact_address():
        raise NotFound()
    if (request.content_length or 0) > config.BODY_LIMIT_BYTES:
        raise RequestEntityTooLarge()
    if request.endpoint != "static":
        store.db()
    if getattr(app.view_functions[request.endpoint], "owner_only", False):
        g.session_id = store.owner_session(bearer_token())


@app.after_request
def response_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if is_api() or request.path.startswith("/studio"):
        response.headers["Cache-Control"] = "no-store"
    return response


def json_object() -> dict:
    if request.mimetype != "application/json":
        raise Refused(415, FRAMEWORK_REASONS[415])
    try:
        body = json.loads(request.get_data(cache=False))
    except (ValueError, RecursionError):
        body = None
    if not isinstance(body, dict):
        raise Refused(400, FRAMEWORK_REASONS[400])
    return body


def exact_address() -> bool:
    return request.environ.get("RAW_URI", request.path).partition("?")[0] == request.path


def exact_slug(slug: str) -> str:
    """A slug or id path matches only as written: an encoded form is an unknown address (precedence step 6)."""
    if not exact_address():
        raise not_found()
    return slug


def stored_id(raw: str) -> int:
    if not STORED_ID.fullmatch(exact_slug(raw)) or int(raw) > BIGINT_MAX:
        raise not_found()
    return int(raw)


def discipline_filter() -> str | None:
    """The one optional `discipline` query value, which must be exactly one allowed value."""
    values = request.args.getlist("discipline")
    if not values:
        return None
    if len(values) != 1 or values[0] not in DISCIPLINES:
        raise invalid({"discipline": DISCIPLINE_CHOICE})
    return values[0]


def listed(discipline: str | None) -> list[dict]:
    return [case for case in store.catalogue() if discipline in (None, case["discipline"])]


def pick(row: dict, keys: tuple) -> dict:
    return {key: row[key] for key in keys}


# Public pages ----------------------------------------------------------------------------------------------

@app.get("/")
def home():
    return render_template("home.html", featured=[case for case in store.catalogue() if case["featured"]],
                           figures=store.figures(), entries=store.public_journal()[:3],
                           recognitions=store.recognitions())


@app.get("/work")
def work():
    try:
        discipline = discipline_filter()
    except Refused:
        return redirect("/work")
    return render_template("work.html", cases=listed(discipline), discipline=discipline)


@app.get("/work/<slug>")
def case_study(slug: str):
    return render_template("case.html", case=store.published_case(exact_slug(slug)))


@app.get("/journal")
def journal():
    return render_template("journal.html", entries=store.public_journal())


@app.get("/journal/<slug>")
def journal_entry(slug: str):
    return render_template("entry.html", entry=store.journal_entry(exact_slug(slug)))


@app.get("/contact")
def contact():
    return render_template("contact.html")


@app.get("/studio/login")
def studio_login():
    return render_template("login.html")


@app.get("/studio")
def studio():
    return render_template("studio.html")


# Public API ------------------------------------------------------------------------------------------------

@app.get("/api/health")
def api_health():
    store.ready()
    return {"status": "ok"}


@app.post("/api/auth/login")
def api_login():
    body = json_object()
    email = sign_in_email(body)
    if errors := sign_in_problems(body):
        if email:
            store.refuse_if_locked(email)
        raise invalid(errors)
    return {"token": store.sign_in(email, body["password"])}


@app.post("/api/auth/logout")
@owner_only
def api_logout():
    store.sign_out(g.session_id)
    return "", 204


@app.get("/api/cases")
def api_cases():
    return jsonify([pick(case, PUBLIC_CASE) for case in listed(discipline_filter())])


@app.get("/api/cases/<slug>")
def api_case(slug: str):
    return pick(store.published_case(exact_slug(slug)), CASE_DETAIL)


@app.get("/api/journal")
def api_journal():
    return jsonify([pick(entry, ("slug", "title", "excerpt", "published_on")) for entry in store.public_journal()])


@app.get("/api/journal/<slug>")
def api_journal_entry(slug: str):
    return pick(store.journal_entry(exact_slug(slug)), ("slug", "title", "excerpt", "body", "published_on"))


@app.get("/api/recognitions")
def api_recognitions():
    return jsonify(store.recognitions())


@app.get("/api/figures")
def api_figures():
    return jsonify(store.figures())


@app.post("/api/inquiries")
def api_inquiries():
    inquiry, created = store.receive_inquiry(inquiry_values(json_object()))
    return {"id": inquiry["id"], "status": inquiry["status"]}, 201 if created else 200


# Studio API ------------------------------------------------------------------------------------------------

@app.get("/api/studio/cases")
@owner_only
def api_studio_cases():
    return jsonify(store.studio_cases())


@app.post("/api/studio/cases")
@owner_only
def api_create_case():
    return store.create_case(case_changes(json_object(), creating=True)), 201


@app.patch("/api/studio/cases/<case_id>")
@owner_only
def api_edit_case(case_id: str):
    body = json_object()
    stored = stored_id(case_id)
    store.require_case(stored)
    return store.update_case(stored, case_changes(body, creating=False))


@app.delete("/api/studio/cases/<case_id>")
@owner_only
def api_delete_case(case_id: str):
    store.delete_case(stored_id(case_id))
    return "", 204


@app.post("/api/studio/cases/<case_id>/publish")
@owner_only
def api_publish_case(case_id: str):
    body = json_object()
    stored = stored_id(case_id)
    store.require_case(stored)
    return store.set_published(stored, publish_choice(body))


@app.get("/api/studio/inquiries")
@owner_only
def api_studio_inquiries():
    return jsonify(store.inquiries())


@app.post("/api/studio/inquiries/<inquiry_id>/resolve")
@owner_only
def api_resolve_inquiry(inquiry_id: str):
    return store.resolve_inquiry(stored_id(inquiry_id))
