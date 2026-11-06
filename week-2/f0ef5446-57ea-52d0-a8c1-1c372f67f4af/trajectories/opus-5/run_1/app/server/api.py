"""The published API surface and the one check order every endpoint follows."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from . import content, idempotency
from .applications import (
    AlreadyDecided,
    DuplicateApplication,
    SORT_SUBMITTED,
    SORTS,
    STATUSES,
    decide_application,
    read_application,
    read_queue,
    store_application,
)
from .auth import AUTH, AuthUnavailable, InvalidCredentials, StaffPrincipal
from .db import DATABASE
from .errors import (
    auth_unavailable,
    error,
    forbidden,
    method_not_allowed,
    not_found,
    unauthorized,
    validation_error,
    validation_payload,
)
from .jsonbody import InvalidJson, canonical_json, parse_json_object
from .signin import Locked, forget_failures, release_reservation, reserve_attempt
from .staff import principal_for_token
from .state import READINESS
from .textrules import email_key, has_unsupported_characters, normalise
from .validation import REQUIRED_MESSAGE, validate_application, validate_decision
from .web import Request, Response, json_response, no_content

PARAM_CODES = {
    "status": "invalid_status",
    "sort": "invalid_sort",
    "category": "invalid_category",
    "limit": "invalid_limit",
    "cursor": "invalid_cursor",
}
PARAM_ORDER = ("status", "sort", "category", "limit", "cursor")

MAX_APPLICATION_ID = 2_147_483_647
_POSITIVE_INTEGER = re.compile(r"\A[0-9]+\Z")


@dataclass
class Context:
    request: Request
    params: dict[str, str]
    principal: StaffPrincipal | None = None

    def json_body(self) -> dict[str, Any]:
        return parse_json_object(self.request.body)

    def single(self, name: str) -> str | None:
        values = self.request.query.get(name, [])
        return values[0] if values else None

    def repeated(self, *names: str) -> list[str]:
        query = self.request.query
        return [name for name in names if len(query.get(name, [])) > 1]


Handler = Callable[[Context], Awaitable[Response]]


@dataclass(frozen=True)
class RouteSpec:
    methods: tuple[str, ...]
    handler: Handler
    auth: str = "none"


def _first_invalid(names: list[str]) -> str:
    return min(names, key=PARAM_ORDER.index)


def _query_error(names: list[str]) -> Response:
    return error(400, PARAM_CODES[_first_invalid(names)])


async def health(ctx: Context) -> Response:
    if READINESS.ready:
        return json_response(200, {"status": "ok"})
    return json_response(503, {"status": "starting"})


async def login(ctx: Context) -> Response:
    try:
        body = ctx.json_body()
    except InvalidJson:
        return error(400, "invalid_json")

    email = body.get("email")
    password = body.get("password")
    errors = {
        name: REQUIRED_MESSAGE
        for name, value in (("email", email), ("password", password))
        if not isinstance(value, str)
    }
    if errors:
        return validation_error(errors)

    key = email_key(email)
    attempt = await reserve_attempt(key)
    if isinstance(attempt, Locked):
        return error(
            429,
            "too_many_attempts",
            headers=[("Retry-After", str(attempt.retry_after))],
        )

    if has_unsupported_characters(email) or has_unsupported_characters(password):
        return error(401, "invalid_credentials")

    try:
        result = await AUTH.sign_in(normalise(email), password)
    except InvalidCredentials:
        return error(401, "invalid_credentials")
    except AuthUnavailable:
        await release_reservation(attempt)
        return auth_unavailable()

    await forget_failures(key)
    return json_response(
        200,
        {
            "access_token": result.access_token,
            "token_type": "Bearer",
            "expires_in": result.expires_in,
        },
    )


async def logout(ctx: Context) -> Response:
    principal = ctx.principal
    try:
        await AUTH.end_session(principal.session_id)
    except AuthUnavailable:
        return auth_unavailable()
    return no_content()


async def create_partner_application(ctx: Context) -> Response:
    try:
        body = ctx.json_body()
    except InvalidJson:
        return error(400, "invalid_json")

    key = ctx.request.header("idempotency-key")
    if key is not None and not idempotency.is_valid_key(key):
        return error(400, "invalid_idempotency_key")

    fingerprint = canonical_json(body)
    if key is not None:
        async with DATABASE.acquire() as connection:
            claim = await idempotency.claim_key(connection, key, fingerprint)
        if isinstance(claim, idempotency.Replay):
            return json_response(
                claim.status,
                claim.body,
                headers=[("Idempotent-Replayed", "true")],
            )
        if isinstance(claim, idempotency.InProgress):
            return error(409, "request_in_progress")
        if isinstance(claim, idempotency.KeyReused):
            return error(422, "idempotency_key_reused")

    try:
        return await _store_new_application(body, key)
    except Exception:
        # Anything escaping here answers 5xx, and a 5xx releases the key.
        if key is not None:
            async with DATABASE.acquire() as connection:
                await idempotency.release_key(connection, key)
        raise


async def _store_new_application(body: dict[str, Any], key: str | None) -> Response:
    errors, values, draft = validate_application(body)
    if draft is None:
        payload = validation_payload(errors, values)
        await _remember(key, 422, payload)
        return json_response(422, payload)

    try:
        created = await store_application(draft)
    except DuplicateApplication:
        payload = {
            "error": "duplicate_application",
            "message": "An application for this work email already exists.",
        }
        await _remember(key, 409, payload)
        return json_response(409, payload)

    await _remember(key, 201, created)
    return json_response(201, created)


async def _remember(key: str | None, status: int, payload: dict[str, Any]) -> None:
    if key is None:
        return
    async with DATABASE.acquire() as connection:
        await idempotency.store_answer(connection, key, status, payload)


async def review_queue(ctx: Context) -> Response:
    invalid = ctx.repeated("status", "sort")
    status = ctx.single("status")
    sort = ctx.single("sort")
    if status is not None and status not in STATUSES and "status" not in invalid:
        invalid.append("status")
    if sort is not None and sort not in SORTS and "sort" not in invalid:
        invalid.append("sort")
    if invalid:
        return _query_error(invalid)

    items, counts = await read_queue(status, sort or SORT_SUBMITTED)
    return json_response(200, {"items": items, "counts": counts})


async def review_application(ctx: Context) -> Response:
    application_id = _application_id(ctx)
    if application_id is None:
        return not_found()
    application = await read_application(application_id)
    if application is None:
        return not_found()
    return json_response(200, application)


async def review_decision(ctx: Context) -> Response:
    application_id = _application_id(ctx)
    if application_id is None:
        return not_found()
    exists = await DATABASE.fetchval(
        "SELECT true FROM partner_applications WHERE id = $1",
        application_id,
    )
    if not exists:
        return not_found()

    try:
        body = ctx.json_body()
    except InvalidJson:
        return error(400, "invalid_json")

    errors, decision, note = validate_decision(body)
    if decision is None:
        return validation_error(errors)

    try:
        application = await decide_application(
            application_id,
            decision,
            note,
            ctx.principal.email,
        )
    except AlreadyDecided as decided:
        return error(409, "already_decided", status=decided.status)
    if application is None:
        return not_found()
    return json_response(200, application)


def _application_id(ctx: Context) -> int | None:
    raw = ctx.params["id"]
    if _POSITIVE_INTEGER.match(raw) is None:
        return None
    value = int(raw)
    if value < 1 or value > MAX_APPLICATION_ID:
        return None
    return value


async def integrations_list(ctx: Context) -> Response:
    invalid = ctx.repeated("category")
    if invalid:
        return _query_error(invalid)
    category = ctx.single("category")
    async with DATABASE.acquire() as connection:
        items = await content.list_integrations(connection, category)
    return _conditional(ctx.request, {"items": items})


async def blog_list(ctx: Context) -> Response:
    invalid = ctx.repeated("category", "limit", "cursor")
    category = ctx.single("category")
    limit = content.DEFAULT_LIMIT
    cursor = None
    if "limit" not in invalid:
        try:
            limit = content.parse_limit(ctx.single("limit"))
        except ValueError:
            invalid.append("limit")
    raw_cursor = ctx.single("cursor")
    if raw_cursor is not None and "cursor" not in invalid:
        try:
            cursor = content.decode_cursor(raw_cursor, content.BLOG_LIST, category)
        except (content.InvalidCursor, ValueError):
            invalid.append("cursor")
    if invalid:
        return _query_error(invalid)

    async with DATABASE.acquire() as connection:
        items, next_cursor = await content.list_articles(connection, category, limit, cursor)
    return _conditional(ctx.request, {"items": items, "next_cursor": next_cursor})


async def press_list(ctx: Context) -> Response:
    invalid = ctx.repeated("category", "limit", "cursor")
    raw_category = ctx.single("category")
    category = None if raw_category in (None, "All") else raw_category
    limit = content.DEFAULT_LIMIT
    cursor = None
    if "limit" not in invalid:
        try:
            limit = content.parse_limit(ctx.single("limit"))
        except ValueError:
            invalid.append("limit")
    raw_cursor = ctx.single("cursor")
    if raw_cursor is not None and "cursor" not in invalid:
        try:
            cursor = content.decode_cursor(raw_cursor, content.PRESS_LIST, category)
        except (content.InvalidCursor, ValueError):
            invalid.append("cursor")
    if invalid:
        return _query_error(invalid)

    async with DATABASE.acquire() as connection:
        items, next_cursor = await content.list_press(connection, category, limit, cursor)
    return _conditional(ctx.request, {"items": items, "next_cursor": next_cursor})


def _conditional(request: Request, payload: dict[str, Any]) -> Response:
    """A public list answer with its strong tag and the If-None-Match rule."""
    answer = json_response(200, payload)
    etag = content.strong_etag(answer.body)
    if content.if_none_match_matches(request.header("if-none-match"), etag):
        answer = Response(status=304, body=b"", content_type=None)
    answer.with_header("ETag", etag)
    answer.with_header("Cache-Control", "no-cache")
    return answer


ROUTES: tuple[tuple[re.Pattern[str], RouteSpec], ...] = (
    (re.compile(r"\A/api/health\Z"), RouteSpec(("GET", "HEAD"), health)),
    (re.compile(r"\A/api/auth/login\Z"), RouteSpec(("POST",), login)),
    (re.compile(r"\A/api/auth/logout\Z"), RouteSpec(("POST",), logout, auth="token")),
    (
        re.compile(r"\A/api/partner-applications\Z"),
        RouteSpec(("POST",), create_partner_application),
    ),
    (
        re.compile(r"\A/api/review/partner-applications\Z"),
        RouteSpec(("GET", "HEAD"), review_queue, auth="reviewer"),
    ),
    (
        re.compile(r"\A/api/review/partner-applications/(?P<id>[^/]+)\Z"),
        RouteSpec(("GET", "HEAD"), review_application, auth="reviewer"),
    ),
    (
        re.compile(r"\A/api/review/partner-applications/(?P<id>[^/]+)/decision\Z"),
        RouteSpec(("POST",), review_decision, auth="reviewer"),
    ),
    (re.compile(r"\A/api/integrations\Z"), RouteSpec(("GET", "HEAD"), integrations_list)),
    (re.compile(r"\A/api/blog\Z"), RouteSpec(("GET", "HEAD"), blog_list)),
    (re.compile(r"\A/api/press\Z"), RouteSpec(("GET", "HEAD"), press_list)),
)


def _match(path: str) -> tuple[RouteSpec, dict[str, str]] | None:
    for pattern, spec in ROUTES:
        found = pattern.match(path)
        if found is not None:
            return spec, found.groupdict()
    return None


def _json_media_type(request: Request) -> bool:
    declared = request.content_type
    if declared is None:
        return not request.body
    return declared.split(";", 1)[0].strip().lower() == "application/json"


async def _authenticate(request: Request) -> StaffPrincipal | Response:
    token = request.bearer_token
    if token is None:
        return unauthorized()
    try:
        principal = await principal_for_token(token)
    except AuthUnavailable:
        return auth_unavailable()
    if principal is None:
        return unauthorized()
    return principal


async def handle_api(request: Request) -> Response:
    """Answer one API request, following the published check order."""
    matched = _match(request.path)
    if matched is None:
        return not_found()
    spec, params = matched
    if request.method not in spec.methods:
        return method_not_allowed(list(spec.methods))

    if request.body_too_large:
        return error(413, "payload_too_large")
    if request.method == "POST" and not _json_media_type(request):
        return error(415, "unsupported_media_type")

    ctx = Context(request=request, params=params)
    if spec.auth != "none":
        principal = await _authenticate(request)
        if isinstance(principal, Response):
            return principal
        ctx.principal = principal
        if spec.auth == "reviewer":
            try:
                holds_role = await AUTH.holds_reviewer_role(principal.user_id)
            except AuthUnavailable:
                return auth_unavailable()
            if not holds_role:
                return forbidden()

    return await spec.handler(ctx)
