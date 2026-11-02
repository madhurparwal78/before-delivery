"""The published API surface: routes, methods, query parameters and the check order."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable

from werkzeug.wrappers import Request, Response

from . import applications, boot, db, keycloak, public, sign_in
from .http import ApiError, error_response, json_response, parse_json_object, read_body, require_json_media_type
from .idempotency import check_key
from .validation import SUMMARY_MESSAGE, check_decision

log = logging.getLogger("relayo.api")

Handler = Callable[..., Response]


def health(request: Request) -> Response:
    if boot.ready.is_set():
        try:
            with db.connection() as conn:
                conn.run("SELECT 1")
            return json_response(200, {"status": "ok"})
        except db.DatabaseUnavailable:
            pass
    return json_response(503, {"status": "starting"})


def login(request: Request) -> Response:
    raw = read_body(request)
    require_json_media_type(request)
    return sign_in.sign_in(parse_json_object(raw))


def logout(request: Request) -> Response:
    read_body(request)
    staff = keycloak.authenticate(request)
    keycloak.sign_out(staff)
    return Response(status=204)


def create_application(request: Request) -> Response:
    raw = read_body(request)
    require_json_media_type(request)
    body = parse_json_object(raw)
    key = request.headers.get("Idempotency-Key")
    return applications.create(body, None if key is None else check_key(key))


def queue(request: Request) -> Response:
    keycloak.authorize_reviewer(keycloak.authenticate(request))
    status = public.single(request.args, "status", "invalid_status")
    if status is not None and status not in applications.STATUSES:
        raise ApiError(400, "invalid_status")
    sort = public.single(request.args, "sort", "invalid_sort")
    if sort is not None and sort not in applications.SORTS:
        raise ApiError(400, "invalid_sort")
    return json_response(200, applications.read_queue(status, sort or "submitted"))


def application(request: Request, raw_id: str) -> Response:
    keycloak.authorize_reviewer(keycloak.authenticate(request))
    return json_response(200, applications.read_one(applications.existing_id(raw_id)))


def decision(request: Request, raw_id: str) -> Response:
    raw = read_body(request)
    require_json_media_type(request)
    staff = keycloak.authenticate(request)
    keycloak.authorize_reviewer(staff)
    application_id = applications.existing_id(raw_id)
    body = parse_json_object(raw)
    errors, note = check_decision(body)
    if errors:
        raise ApiError(422, "validation_failed", message=SUMMARY_MESSAGE, errors=errors)
    return json_response(200, applications.decide(application_id, body["decision"], note, staff.email))


def integrations(request: Request) -> Response:
    category = public.single(request.args, "category", "invalid_category")
    with db.connection() as conn:
        items = public.integrations(conn, category)
    return public.list_response(request, {"items": items})


def _paged(request: Request, list_name: str) -> Response:
    category = public.single(request.args, "category", "invalid_category")
    limit = public.parse_limit(public.single(request.args, "limit", "invalid_limit"))
    after = public.decode_cursor(public.single(request.args, "cursor", "invalid_cursor"), list_name, category)
    shown = public.press_filter(category) if list_name == "press" else category
    with db.connection() as conn:
        page = public.page_of(conn, list_name, category, shown, limit, after)
    return public.list_response(request, {"items": page.items, "next_cursor": page.next_cursor})


def blog(request: Request) -> Response:
    return _paged(request, "blog")


def press(request: Request) -> Response:
    return _paged(request, "press")


ROUTES: list[tuple[re.Pattern[str], dict[str, Handler]]] = [
    (re.compile(r"/api/health"), {"GET": health}),
    (re.compile(r"/api/auth/login"), {"POST": login}),
    (re.compile(r"/api/auth/logout"), {"POST": logout}),
    (re.compile(r"/api/partner-applications"), {"POST": create_application}),
    (re.compile(r"/api/review/partner-applications"), {"GET": queue}),
    (re.compile(r"/api/review/partner-applications/([^/]+)"), {"GET": application}),
    (re.compile(r"/api/review/partner-applications/([^/]+)/decision"), {"POST": decision}),
    (re.compile(r"/api/integrations"), {"GET": integrations}),
    (re.compile(r"/api/blog"), {"GET": blog}),
    (re.compile(r"/api/press"), {"GET": press}),
]
PRIVATE_PREFIXES = ("/api/auth/", "/api/review/")


def _route(request: Request) -> Response:
    for pattern, methods in ROUTES:
        found = pattern.fullmatch(request.path)
        if not found:
            continue
        allowed = sorted({*methods, *(["HEAD"] if "GET" in methods else [])})
        if request.method not in allowed:
            raise ApiError(405, "method_not_allowed", {"Allow": ", ".join(allowed)})
        return methods["GET" if request.method == "HEAD" else request.method](request, *found.groups())
    raise ApiError(404, "not_found")


def dispatch(request: Request) -> Response:
    try:
        response = _route(request)
    except ApiError as refused:
        response = refused.response()
    except db.DatabaseUnavailable as error:
        log.warning("database unavailable: %s", error)
        response = error_response(503, "service_unavailable")
    except keycloak.AuthUnavailable as error:
        log.warning("auth service unavailable: %s", error)
        response = error_response(503, "auth_unavailable")
    except Exception:
        log.exception("unexpected error on %s %s", request.method, request.path)
        response = error_response(500, "internal_error")
    if request.path.startswith(PRIVATE_PREFIXES):
        response.headers["Cache-Control"] = "no-store"
        response.headers.pop("ETag", None)
        response.headers.pop("Last-Modified", None)
    return response
