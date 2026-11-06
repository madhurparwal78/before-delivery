"""The published JSON surface. Every answer here is application/json."""

import json
from functools import wraps

from flask import Blueprint, Response, g, jsonify, request

from . import accounts, catalogue, fields, inquiries, journal, records
from .db import database, transaction
from .errors import (
    ALREADY_DRAFT,
    ALREADY_PUBLISHED,
    NOT_A_JSON_OBJECT,
    SIGN_IN_REFUSED,
    SIGN_IN_REQUIRED,
    TOO_MANY_SIGN_IN_ATTEMPTS,
    UNSUPPORTED_MEDIA_TYPE,
    ApiError,
    not_found,
    validation_error,
)

api = Blueprint("api", __name__, url_prefix="/api")


def read_json_object():
    """Read a request body, in the order content type then JSON then shape."""
    if request.mimetype != "application/json":
        raise ApiError(415, UNSUPPORTED_MEDIA_TYPE)
    try:
        payload = json.loads(request.get_data(cache=False, as_text=True))
    except ValueError as error:
        raise ApiError(400, NOT_A_JSON_OBJECT) from error
    if not isinstance(payload, dict):
        raise ApiError(400, NOT_A_JSON_OBJECT)
    return payload


def bearer_token():
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def owner_only(view):
    """Refuse a missing, unknown, revoked or expired token before any record."""

    @wraps(view)
    def guarded(**parameters):
        token = bearer_token()
        if token is None:
            raise ApiError(401, SIGN_IN_REQUIRED)
        with transaction() as cursor:
            session = accounts.live_session(cursor, token)
        if session is None:
            raise ApiError(401, SIGN_IN_REQUIRED)
        g.studio_token = token
        return view(**parameters)

    return guarded


def moment(value):
    return value.isoformat() if value is not None else None


def case_list_item(entry):
    return {
        "slug": entry["slug"],
        "title": entry["title"],
        "discipline": entry["discipline"],
        "summary": entry["summary"],
        "year": entry["year"],
        "featured": entry["featured"],
        "ordinal": entry["ordinal"],
    }


def case_detail(entry, previous, following):
    return {
        "slug": entry["slug"],
        "title": entry["title"],
        "discipline": entry["discipline"],
        "summary": entry["summary"],
        "challenge": entry["challenge"],
        "approach": entry["approach"],
        "outcome": entry["outcome"],
        "stack": entry["stack"],
        "year": entry["year"],
        "featured": entry["featured"],
        "ordinal": entry["ordinal"],
        "total": entry["total"],
        "previous": previous,
        "next": following,
    }


def studio_case(row):
    return {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "discipline": row["discipline"],
        "summary": row["summary"],
        "challenge": row["challenge"],
        "approach": row["approach"],
        "outcome": row["outcome"],
        "stack": row["stack"],
        "year": row["year"],
        "featured": row["featured"],
        "position": row["position"],
        "published": row["published"],
        "published_at": moment(row["published_at"]),
        "created_at": moment(row["created_at"]),
        "updated_at": moment(row["updated_at"]),
    }


def inquiry_row(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "phone": row["phone"],
        "email": row["email"],
        "message": row["message"],
        "project_type": row["project_type"],
        "status": row["status"],
        "received_at": moment(row["received_at"]),
        "resolved_at": moment(row["resolved_at"]),
    }


def requested_discipline():
    """A public discipline filter is exactly one of the allowed values."""
    given = request.args.getlist("discipline")
    if not given:
        return None
    if len(given) > 1 or given[0] not in fields.DISCIPLINES:
        raise validation_error({"discipline": fields.DISCIPLINE_CHOICE})
    return given[0]


@api.get("/health")
def health():
    if database.ready():
        return jsonify({"status": "ok"})
    return Response(
        json.dumps({"status": "unavailable"}), 503, mimetype="application/json"
    )


@api.post("/auth/login")
def sign_in():
    payload = read_json_object()
    errors = {}
    for name in ("email", "password"):
        _, message = fields.check_text(payload.get(name), 1, 1_000_000, required=True)
        if message:
            errors[name] = message
    if errors:
        raise validation_error(errors)

    email = accounts.normalise_email(payload["email"])
    with transaction() as cursor:
        locked, _ = accounts.lock_state(cursor, email)
        if locked:
            accounts.record_attempt(cursor, email, False)
            _, retry_after = accounts.lock_state(cursor, email)
            outcome, detail = "locked", retry_after
        else:
            account = accounts.find_account(cursor, email)
            succeeded = accounts.verify(account, payload["password"])
            accounts.record_attempt(cursor, email, succeeded)
            if succeeded:
                outcome = "signed-in"
                detail = accounts.open_session(cursor, account["id"])
            else:
                outcome, detail = "refused", None

    if outcome == "locked":
        raise ApiError(
            429, TOO_MANY_SIGN_IN_ATTEMPTS, headers={"Retry-After": str(detail)}
        )
    if outcome == "refused":
        raise ApiError(401, SIGN_IN_REFUSED)
    return jsonify({"token": detail})


@api.post("/auth/logout")
@owner_only
def sign_out():
    with transaction() as cursor:
        accounts.revoke_session(cursor, g.studio_token)
    return "", 204


@api.get("/cases")
def list_cases():
    discipline = requested_discipline()
    with transaction() as cursor:
        published = catalogue.published_catalogue(cursor)
    return jsonify(
        [case_list_item(entry) for entry in catalogue.filtered(published, discipline)]
    )


@api.get("/cases/<slug>")
def read_case(slug):
    with transaction() as cursor:
        published = catalogue.published_catalogue(cursor)
    index, entry = catalogue.find_published(published, slug)
    if entry is None:
        raise not_found()
    previous, following = catalogue.neighbours(published, index)
    return jsonify(case_detail(entry, previous, following))


@api.get("/journal")
def list_journal():
    with transaction() as cursor:
        entries = journal.public_entries(cursor)
    return jsonify(
        [
            {
                "slug": entry["slug"],
                "title": entry["title"],
                "excerpt": entry["excerpt"],
                "published_on": entry["published_on"].isoformat(),
            }
            for entry in entries
        ]
    )


@api.get("/journal/<slug>")
def read_journal(slug):
    with transaction() as cursor:
        entry = journal.public_entry(cursor, slug)
    if entry is None:
        raise not_found()
    return jsonify(
        {
            "slug": entry["slug"],
            "title": entry["title"],
            "excerpt": entry["excerpt"],
            "body": entry["body"],
            "published_on": entry["published_on"].isoformat(),
        }
    )


@api.get("/recognitions")
def list_recognitions():
    with transaction() as cursor:
        rows = records.recognitions(cursor)
    return jsonify(
        [
            {
                "award": row["award"],
                "issuer": row["issuer"],
                "awarded_on": row["awarded_on"].isoformat(),
            }
            for row in rows
        ]
    )


@api.get("/figures")
def list_figures():
    with transaction() as cursor:
        rows = records.figures(cursor)
    return jsonify(rows)


@api.post("/inquiries")
def send_inquiry():
    payload = read_json_object()
    values, errors = inquiries.validate(payload)
    if errors:
        raise validation_error(errors)
    with transaction() as cursor:
        stored, created = inquiries.store(cursor, values)
    body = {"id": stored["id"], "status": stored["status"]}
    return jsonify(body), 201 if created else 200


@api.get("/studio/cases")
@owner_only
def studio_list_cases():
    with transaction() as cursor:
        rows = catalogue.studio_rows(cursor)
    return jsonify([studio_case(row) for row in rows])


@api.post("/studio/cases")
@owner_only
def studio_create_case():
    payload = read_json_object()
    values, errors = catalogue.validate(payload, creating=True)
    if errors:
        raise validation_error(errors)
    with transaction() as cursor:
        row = catalogue.create(cursor, values)
    return jsonify(studio_case(row)), 201


@api.patch("/studio/cases/<int:case_id>")
@owner_only
def studio_edit_case(case_id):
    payload = read_json_object()
    with transaction() as cursor:
        row = catalogue.fetch(cursor, case_id)
        if row is None:
            raise not_found()
        values, errors = catalogue.validate(payload, creating=False)
        if errors:
            raise validation_error(errors)
        if row["published"]:
            after = {**row, **values}
            blockers = catalogue.publish_blockers(after["summary"], after["outcome"])
            if blockers:
                raise validation_error(blockers)
        updated = catalogue.edit(cursor, case_id, values)
    return jsonify(studio_case(updated))


@api.post("/studio/cases/<int:case_id>/publish")
@owner_only
def studio_publish_case(case_id):
    payload = read_json_object()
    with transaction() as cursor:
        row = catalogue.fetch(cursor, case_id)
        if row is None:
            raise not_found()
        target, errors = _publish_target(payload)
        if errors:
            raise validation_error(errors)
        if row["published"] == target:
            raise ApiError(409, ALREADY_PUBLISHED if target else ALREADY_DRAFT)
        if target:
            blockers = catalogue.publish_blockers(row["summary"], row["outcome"])
            if blockers:
                raise validation_error(blockers)
        updated = catalogue.set_published(cursor, case_id, target)
    return jsonify(studio_case(updated))


def _publish_target(payload):
    errors = {}
    for key in payload:
        if key != "published":
            errors[key] = fields.CANNOT_BE_SET
    if "published" not in payload:
        errors["published"] = fields.REQUIRED
        return None, errors
    target, message = fields.check_boolean(payload["published"])
    if message:
        errors["published"] = message
    return target, errors


@api.delete("/studio/cases/<int:case_id>")
@owner_only
def studio_delete_case(case_id):
    with transaction() as cursor:
        removed = catalogue.delete(cursor, case_id)
    if not removed:
        raise not_found()
    return "", 204


@api.get("/studio/inquiries")
@owner_only
def studio_list_inquiries():
    with transaction() as cursor:
        rows = inquiries.inbox(cursor)
    return jsonify([inquiry_row(row) for row in rows])


@api.post("/studio/inquiries/<int:inquiry_id>/resolve")
@owner_only
def studio_resolve_inquiry(inquiry_id):
    with transaction() as cursor:
        if not inquiries.exists(cursor, inquiry_id):
            raise not_found()
        row = inquiries.resolve(cursor, inquiry_id)
    return jsonify(inquiry_row(row))
