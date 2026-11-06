"""The JSON API under `/api`."""

from __future__ import annotations

from flask import Blueprint, Response, request

from . import auth, errors, records, service, validation
from .db import DATABASE
from .http_support import (
    check_same_origin,
    database,
    idempotency_key,
    json_response,
    presented_token,
    request_body,
    require_studio,
)

api = Blueprint("api", __name__, url_prefix="/api")


@api.get("/health")
def health() -> Response:
    if DATABASE.healthy():
        return json_response({"status": "ok"})
    return json_response({"status": "unavailable"}, 503)


# ---------------------------------------------------------------------------
# Sign in
# ---------------------------------------------------------------------------


@api.post("/auth/login")
def login() -> Response:
    body = request_body()
    with database() as conn:
        token, user = auth.sign_in(conn, body.get("email"), body.get("password"))
    response = json_response({"token": token, "user": records.user_shape(user)})
    response.set_cookie(
        auth.SESSION_COOKIE,
        token,
        httponly=True,
        samesite="Lax",
        path="/",
        max_age=60 * 60 * 24 * 30,
    )
    return response


@api.post("/auth/logout")
def logout() -> Response:
    with database() as conn:
        require_studio(conn)
        check_same_origin()
        token, _ = presented_token()
        auth.sign_out(conn, token)
    response = Response(status=204)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


@api.get("/me")
def me() -> Response:
    with database() as conn:
        user = require_studio(conn)
    return json_response(records.user_shape(user))


# ---------------------------------------------------------------------------
# Case studies
# ---------------------------------------------------------------------------


@api.get("/cases")
def cases() -> Response:
    with database() as conn:
        rows = service.list_cases(conn)
    return json_response([records.case_summary(row) for row in rows])


@api.get("/cases/<slug>")
def case(slug: str) -> Response:
    with database() as conn:
        rows = service.list_cases(conn)
        found = next((row for row in rows if row["slug"] == slug), None)
        if found is None:
            raise errors.not_found()
        more = service.more_cases(rows, slug)
    return json_response(
        {
            **records.case_detail(found),
            "more": [records.case_summary(row) for row in more],
        }
    )


# ---------------------------------------------------------------------------
# Inquiries
# ---------------------------------------------------------------------------


@api.post("/inquiries")
def create_inquiry() -> Response:
    body = request_body()
    key = idempotency_key()
    with database() as conn:
        status, payload = service.create_inquiry(conn, body, key)
    return json_response(payload, status)


@api.get("/inquiries/status/<token>")
def inquiry_status(token: str) -> Response:
    with database() as conn:
        public = service.public_status(conn, token)
    if public is None:
        raise errors.not_found()
    return json_response(public)


# ---------------------------------------------------------------------------
# The studio queue
# ---------------------------------------------------------------------------


@api.get("/studio/inquiries")
def studio_queue() -> Response:
    with database() as conn:
        require_studio(conn)
        tab, query = validation.check_queue_params(
            request.args.get("status"), request.args.get("q")
        )
        return json_response(service.queue(conn, tab, query))


@api.get("/studio/inquiries/<inquiry_id>")
def studio_inquiry(inquiry_id: str) -> Response:
    with database() as conn:
        user = require_studio(conn)
        row = _load_inquiry(conn, inquiry_id)
        return json_response(service.studio_detail(conn, row, user["role"]))


@api.post("/studio/inquiries/<inquiry_id>/transition")
def studio_transition(inquiry_id: str) -> Response:
    with database() as conn:
        user = require_studio(conn)
        row = _load_inquiry(conn, inquiry_id)
        body = request_body()
        key = idempotency_key()
        check_same_origin()
        service.check_lead_only(body.get("action"), user["role"])
        status, payload = service.apply_transition(conn, row["id"], user, body, key)
        return json_response(payload, status)


@api.post("/studio/inquiries/<inquiry_id>/notes")
def studio_note(inquiry_id: str) -> Response:
    with database() as conn:
        user = require_studio(conn)
        row = _load_inquiry(conn, inquiry_id)
        body = request_body()
        check_same_origin()
        note = service.add_note(conn, row["id"], user, body)
        return json_response(note, 201)


def _load_inquiry(conn, inquiry_id: str) -> dict:
    numeric = service.parse_inquiry_id(inquiry_id)
    row = service.find_by_id(conn, numeric) if numeric is not None else None
    if row is None:
        raise errors.not_found()
    return row


