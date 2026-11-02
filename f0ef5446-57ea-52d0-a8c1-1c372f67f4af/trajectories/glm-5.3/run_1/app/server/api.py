"""The published API surface, its check order and its error shape.

One check order holds for every endpoint (Business rules rule 1):
route and method, body size and media type, authentication, permission,
unknown record, malformed JSON, Idempotency-Key format, stored idempotency
answers, query and body validation, state conflicts.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from typing import Any

import pg8000.dbapi as pg

from . import (
    application_rules,
    config,
    db,
    idempotency,
    keycloak,
    outbound_email,
    public_lists,
    reply_due,
    request_boundary,
)

PUBLIC_PATHS: dict[str, set[str]] = {
    "/api/health": {"GET", "HEAD"},
    "/api/auth/login": {"POST"},
    "/api/auth/logout": {"POST"},
    "/api/partner-applications": {"POST"},
    "/api/review/partner-applications": {"GET", "HEAD"},
    "/api/review/partner-applications/{id}": {"GET", "HEAD"},
    "/api/review/partner-applications/{id}/decision": {"POST"},
    "/api/integrations": {"GET", "HEAD"},
    "/api/blog": {"GET", "HEAD"},
    "/api/press": {"GET", "HEAD"},
}

PRIVATE_PREFIXES = ("/api/auth/", "/api/review/")
_QUEUE_PREFIX = "/api/review/partner-applications/"


class ApiError(Exception):
    """One consistent error shape for every answer."""

    def __init__(self, status: int, code: str, **extra: Any):
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra


class ApiResponse:
    def __init__(self, status: int, body: bytes, headers: dict[str, str],
                 private: bool = False):
        self.status = status
        self.body = body
        self.headers = headers
        self.private = private

    @classmethod
    def json(cls, payload: Any, status: int = 200,
             headers: dict[str, str] | None = None,
             private: bool = False) -> "ApiResponse":
        body = json.dumps(
            payload, ensure_ascii=True, separators=(",", ":")
        ).encode("utf-8")
        return cls(status, body, headers or {}, private)


def error_response(http_status: int, code: str, private: bool = False,
                   **extra: Any) -> ApiResponse:
    headers = {"WWW-Authenticate": "Bearer"} if http_status == 401 else {}
    payload: dict[str, Any] = {"error": code}
    payload.update(extra)
    return ApiResponse.json(payload, http_status, headers, private)


def validation_response(errors: dict[str, str], values: dict[str, Any] | None,
                        private: bool = False) -> ApiResponse:
    payload: dict[str, Any] = {
        "error": "validation_failed",
        "message": "Please correct the fields below.",
        "errors": errors,
    }
    if values is not None:
        payload["values"] = values
    return ApiResponse.json(payload, 422, private=private)


def handle(path: str, method: str, headers: dict[str, str],
           query: dict[str, list[str]], body: bytes) -> ApiResponse:
    route, ident = _match(path)
    if route is None:
        return error_response(404, "not_found")
    allowed = PUBLIC_PATHS[route]
    private = _is_private(path)
    if method not in allowed:
        return ApiResponse.json(
            {"error": "method_not_allowed"}, 405,
            {"Allow": ", ".join(sorted(allowed))}, private,
        )
    if route == "/api/health":
        return health()
    if method == "POST":
        # Step 1: body size and media type, right after the route check.
        if len(body) > request_boundary.MAX_BODY_BYTES:
            return error_response(413, "payload_too_large", private)
        media_type = headers.get("content-type", "").split(";")[0].strip().lower()
        if body and media_type != "application/json":
            return error_response(415, "unsupported_media_type", private)
    if route == "/api/auth/login":
        return login(body)
    if route == "/api/auth/logout":
        return logout(_bearer(headers))
    if route == "/api/partner-applications":
        return create_application(body, headers)
    if route in ("/api/integrations", "/api/blog", "/api/press"):
        return public_list(route, query, headers)
    # Staff routes: steps 2 and 3 before any application is read.
    caller = authenticate(_bearer(headers))
    if caller is None:
        return error_response(401, "unauthorized", private)
    if not is_reviewer(caller):
        return error_response(403, "forbidden", private)
    if route == "/api/review/partner-applications":
        return queue(query)
    if ident is None:
        return error_response(404, "not_found", private)
    if route.endswith("/decision"):
        return decide(ident, body, caller)
    return application_detail(ident)


def _match(path: str) -> tuple[str | None, int | None]:
    if path.startswith(_QUEUE_PREFIX):
        rest = path[len(_QUEUE_PREFIX):]
        if rest.endswith("/decision"):
            raw = rest[: -len("/decision")]
            if "/" in raw:
                return None, None
            return "/api/review/partner-applications/{id}/decision", _valid_id(raw)
        if "/" in rest:
            return None, None
        return "/api/review/partner-applications/{id}", _valid_id(rest)
    return path if path in PUBLIC_PATHS else None, None


def _valid_id(raw: str) -> int | None:
    if raw.isdigit() and str(int(raw)) == raw and int(raw) > 0:
        return int(raw)
    return None


def _is_private(path: str) -> bool:
    return path.startswith(PRIVATE_PREFIXES)


def _bearer(headers: dict[str, str]) -> str | None:
    value = headers.get("authorization", "")
    if value.lower().startswith("bearer "):
        return value[7:].strip()
    return None


def authenticate(token: str | None) -> dict | None:
    """The staff token check, asked of the auth service on every request."""
    if token is None:
        return None
    try:
        return keycloak.staff_email(token)
    except keycloak.CredentialsInvalid:
        return None
    except keycloak.AuthUnavailable as exc:
        raise ApiError(503, "auth_unavailable") from exc


def is_reviewer(caller: dict) -> bool:
    """The partner-reviewer role check, from current role mappings only."""
    try:
        roles = keycloak.realm_role_mappings(caller["user_id"])
    except keycloak.AuthUnavailable as exc:
        raise ApiError(503, "auth_unavailable") from exc
    return config.REVIEWER_ROLE in roles


def health() -> ApiResponse:
    from . import state

    if state.ready() and state.database_ok():
        return ApiResponse.json({"status": "ok"})
    return ApiResponse.json({"status": "starting"}, 503)


def _ready_guard() -> None:
    from . import state

    if not state.ready():
        raise ApiError(503, "service_unavailable")


def _parse_json(body: bytes) -> Any:
    try:
        return request_boundary.validate_body(body)
    except request_boundary.InvalidJSON as exc:
        raise ApiError(400, "invalid_json") from exc


def login(body: bytes) -> ApiResponse:
    _ready_guard()
    payload = _parse_json(body)  # step 5
    errors: dict[str, str] = {}
    email = payload.get("email")
    password = payload.get("password")
    if not isinstance(email, str) or application_rules.normalise(email) == "":
        errors["email"] = application_rules.MSG_REQUIRED
    if not isinstance(password, str) or (
        application_rules.normalise(password) == ""
    ):
        errors["password"] = application_rules.MSG_REQUIRED
    if errors:  # the 422 body check
        return validation_response(errors, None, private=True)
    email_key = application_rules.work_email_key(email)
    wait = _locked_wait(email_key)  # the limit
    if wait is not None:
        return _too_many_attempts(email_key)
    if application_rules.unsupported_characters(email) or (
        application_rules.unsupported_characters(password)
    ):
        if not _record_failure(email_key):
            return _too_many_attempts(email_key)
        return error_response(401, "invalid_credentials", private=True)
    try:  # the credential exchange
        tokens = keycloak.sign_in(email, password)
    except keycloak.CredentialsInvalid:
        if not _record_failure(email_key):
            return _too_many_attempts(email_key)
        return error_response(401, "invalid_credentials", private=True)
    except keycloak.AuthUnavailable:
        return error_response(503, "auth_unavailable", private=True)
    _clear_failures(email_key)
    return ApiResponse.json({
        "access_token": tokens["access_token"],
        "token_type": "Bearer",
        "expires_in": tokens.get("expires_in", 300),
    }, private=True)


def _too_many_attempts(email_key: str) -> ApiResponse:
    """The 429 answer with its Retry-After, for one email key."""
    wait = _locked_wait(email_key)
    return ApiResponse.json(
        {"error": "too_many_attempts"}, 429,
        {"Retry-After": str(wait if wait else 1)}, private=True,
    )


def _record_failure(email_key: str) -> bool:
    """Record one failure atomically, per email key. Returns False when the
    email key is already locked and this failure is not recorded
    (Business rules rule 15)."""
    with db.connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))", (email_key,)
                )
                cur.execute(
                    "SELECT count(*) FROM sign_in_failures WHERE email_key = %s"
                    " AND failed_at > now() -"
                    " make_interval(secs => %s)",
                    (email_key, config.LOGIN_FAILURE_WINDOW_SECONDS),
                )
                if cur.fetchone()[0] >= 5:
                    return False
                cur.execute(
                    "INSERT INTO sign_in_failures (email_key, failed_at)"
                    " VALUES (%s, now())", (email_key,)
                )
    return True


def _locked_wait(email_key: str) -> int | None:
    """Retry-After for a locked email key, else None."""
    with db.connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))", (email_key,)
                )
                cur.execute(
                    "SELECT count(*), min(failed_at), now() FROM"
                    " sign_in_failures WHERE email_key = %s AND failed_at >"
                    " now() - make_interval(secs => %s)",
                    (email_key, config.LOGIN_FAILURE_WINDOW_SECONDS),
                )
                count, oldest, now = cur.fetchone()
    if count < 5:
        return None
    window = dt.timedelta(seconds=config.LOGIN_FAILURE_WINDOW_SECONDS)
    seconds = (oldest + window - now).total_seconds()
    return max(1, math.ceil(seconds))


def _clear_failures(email_key: str) -> None:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM sign_in_failures WHERE email_key = %s",
                (email_key,),
            )


def logout(token: str | None) -> ApiResponse:
    caller = authenticate(token)
    if caller is None:
        return error_response(401, "unauthorized", private=True)
    try:
        keycloak.end_session(caller["session_id"])
    except keycloak.AuthUnavailable:
        return error_response(503, "auth_unavailable", private=True)
    return ApiResponse(204, b"", {}, private=True)


def create_application(body: bytes, headers: dict[str, str]) -> ApiResponse:
    _ready_guard()
    payload = _parse_json(body)  # step 5
    key = headers.get("idempotency-key")
    if key is not None and not idempotency.valid_key(key):
        return error_response(400, "invalid_idempotency_key")  # step 6
    request_hash = idempotency.request_hash(payload)
    taken = None
    if key is not None:
        try:
            taken = _take_key(key, request_hash)  # step 7
        except _Reused:
            return error_response(422, "idempotency_key_reused")
        except _InProgress:
            return error_response(409, "request_in_progress")
        if isinstance(taken, ApiResponse):
            return taken
    try:
        response = _process_application(payload)
    except Exception:
        if taken is not None:
            _release_key(key)
        raise
    if key is not None and taken is not None:
        if idempotency.is_storable(response.status, _error_code(response)):
            _store_idempotent(key, response)
        else:
            _release_key(key)
    return response


def _error_code(response: ApiResponse) -> str | None:
    try:
        return json.loads(response.body).get("error")
    except (ValueError, AttributeError):
        return None


def _process_application(payload: dict[str, Any]) -> ApiResponse:
    errors = application_rules.validate_application(payload)  # step 8
    if errors:
        values = {
            field: payload.get(field) for field in application_rules.FIELD_ORDER
        }
        return validation_response(errors, values)
    stored = application_rules.stored_fields(payload)
    try:
        with db.connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("SELECT now()")
                    created_at = _utc(cur.fetchone()[0])
                    cur.execute(
                        "INSERT INTO partner_applications"
                        " (first_name, last_name, work_email, job_title,"
                        " company_name, website, company_type, employee_band,"
                        " markets, customer_segment, partnership_interests,"
                        " goals, consent, status, created_at)"
                        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
                        " 'pending', %s) RETURNING id",
                        (
                            stored["first_name"], stored["last_name"],
                            stored["work_email"], stored["job_title"],
                            stored["company_name"], stored["website"],
                            stored["company_type"], stored["employee_band"],
                            json.dumps(stored["markets"]),
                            stored["customer_segment"],
                            json.dumps(stored["partnership_interests"]),
                            stored["goals"], True, created_at,
                        ),
                    )
                    application_id = cur.fetchone()[0]
                    _record_email(
                        cur, application_id, "receipt", stored, created_at
                    )
    except db.DatabaseUnavailable as exc:
        raise ApiError(503, "service_unavailable") from exc
    except pg.DatabaseError as exc:  # the refused second write
        if not db.is_unique_violation(exc):
            raise
        return error_response(
            409, "duplicate_application",
            message="An application for this work email already exists.",
        )
    return ApiResponse.json({
        "id": application_id,
        "status": "pending",
        "work_email": stored["work_email"],
    }, 201)


def _take_key(key: str, request_hash: str):
    """One processing per Idempotency-Key, including an expired key's
    takeover. Returns True when the caller takes the key, or the stored
    answer to return."""
    with db.connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))", (key,)
                )
                cur.execute(
                    "SELECT request_hash, status, body, first_used_at, locked_at"
                    " FROM idempotency_keys WHERE key = %s", (key,)
                )
                row = cur.fetchone()
                if row is None:
                    cur.execute(
                        "INSERT INTO idempotency_keys"
                        " (key, request_hash, status, first_used_at, locked_at)"
                        " VALUES (%s, %s, NULL, now(), now())",
                        (key, request_hash),
                    )
                    return True
                stored_hash, status, stored_body, first_used, locked = row
                if stored_hash != request_hash:
                    raise _Reused()
                if status is None:
                    raise _InProgress()
                cur.execute(
                    "SELECT now() - make_interval(secs => %s) >="
                    " first_used_at FROM idempotency_keys WHERE key = %s",
                    (config.IDEMPOTENCY_KEY_TTL_SECONDS, key),
                )
                expired = cur.fetchone()[0]
                if not expired:
                    return _replay(status, stored_body)
                cur.execute(
                    "UPDATE idempotency_keys SET status = NULL, body = NULL,"
                    " locked_at = now(), first_used_at = now(),"
                    " request_hash = %s WHERE key = %s",
                    (request_hash, key),
                )
                return True
    return True


class _Reused(Exception):
    """Same key, different body."""


class _InProgress(Exception):
    """The first request with this key is still being processed."""


def _replay(status: int, stored_body: str) -> ApiResponse:
    return ApiResponse(
        status, stored_body.encode("utf-8"),
        {"Idempotent-Replayed": "true"},
    )


def _store_idempotent(key: str, response: ApiResponse) -> None:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE idempotency_keys SET status = %s, body = %s,"
                " locked_at = NULL, error_code = NULL WHERE key = %s",
                (response.status, response.body.decode("utf-8"), key),
            )


def _release_key(key: str) -> None:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM idempotency_keys WHERE key = %s", (key,))


def _record_email(cur, application_id: int, kind: str,
                  stored: dict[str, Any], now: dt.datetime) -> None:
    """One outbound email row, in the caller's transaction (rule 16)."""
    cur.execute(
        "INSERT INTO outbound_emails"
        " (application_id, kind, recipient, subject, body, status, attempts,"
        " next_attempt_at, created_at)"
        " VALUES (%s,%s,%s,%s,%s,'queued',0,%s,%s)",
        (
            application_id, kind, stored["work_email"],
            outbound_email.subject(kind),
            outbound_email.body_text(
                kind, stored["first_name"], stored["company_name"]
            ),
            now, now,
        ),
    )


def _select_columns() -> str:
    return (
        "id, first_name, last_name, work_email, job_title, company_name,"
        " website, company_type, employee_band, markets, customer_segment,"
        " partnership_interests, goals, consent, status, reviewer,"
        " decision_note, created_at, decided_at"
    )


def queue(query: dict[str, list[str]]) -> ApiResponse:
    _ready_guard()
    status_values = query.get("status", [])
    if len(status_values) > 1:
        return error_response(400, "invalid_status", private=True)
    status = status_values[0] if status_values else None
    if status is not None and status not in ("pending", "approved", "rejected"):
        return error_response(400, "invalid_status", private=True)
    sort_values = query.get("sort", [])
    if len(sort_values) > 1:
        return error_response(400, "invalid_sort", private=True)
    sort = sort_values[0] if sort_values else "submitted"
    if sort not in ("submitted", "reply_due"):
        return error_response(400, "invalid_sort", private=True)
    try:
        with db.connection() as conn:
            # Items and counts from one database snapshot (rule 17).
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
                    )
                    where = " WHERE status = %s" if status else ""
                    order = (
                        " ORDER BY created_at DESC, id DESC"
                        if sort == "submitted"
                        else " ORDER BY created_at ASC, id ASC"
                    )
                    cur.execute(
                        "SELECT " + _select_columns() +
                        " FROM partner_applications" + where + order,
                        (status,) if status else (),
                    )
                    rows = list(cur.fetchall())
                    cur.execute(
                        "SELECT status, count(*) FROM partner_applications"
                        " GROUP BY status"
                    )
                    counted = dict(cur.fetchall())
    except db.DatabaseUnavailable as exc:
        raise ApiError(503, "service_unavailable") from exc
    if sort == "reply_due":
        rows.sort(key=lambda row: (reply_due.reply_due_at(row[17]), row[0]))
    counts = {
        "pending": counted.get("pending", 0),
        "approved": counted.get("approved", 0),
        "rejected": counted.get("rejected", 0),
    }
    items = [_application_payload(row) for row in rows]
    return ApiResponse.json({"items": items, "counts": counts}, private=True)


def application_detail(application_id: int) -> ApiResponse:
    _ready_guard()
    row = _fetch_application(application_id)  # step 4
    if row is None:
        return error_response(404, "not_found", private=True)
    return ApiResponse.json(_application_payload(row), private=True)


def _fetch_application(application_id: int):
    try:
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT " + _select_columns() +
                    " FROM partner_applications WHERE id = %s",
                    (application_id,),
                )
                return cur.fetchone()
    except db.DatabaseUnavailable as exc:
        raise ApiError(503, "service_unavailable") from exc


def _application_payload(row) -> dict[str, Any]:
    (identifier, first_name, last_name, work_email, job_title, company_name,
     website, company_type, employee_band, markets, customer_segment,
     interests, goals, consent, status, reviewer, decision_note, created_at,
     decided_at) = row
    return {
        "id": identifier,
        "first_name": first_name,
        "last_name": last_name,
        "work_email": work_email,
        "job_title": job_title,
        "company_name": company_name,
        "website": website,
        "company_type": company_type,
        "employee_band": employee_band,
        "markets": markets,
        "customer_segment": customer_segment,
        "partnership_interests": interests,
        "goals": goals,
        "consent": consent,
        "status": status,
        "reviewer": reviewer,
        "decision_note": decision_note,
        "created_at": _iso(created_at),
        "decided_at": _iso(decided_at),
        "reply_due_at": _iso(reply_due.reply_due_at(_utc(created_at))),
        "outcome_email_status": _outcome_email_status(identifier, status),
    }


def _outcome_email_status(application_id: int, status: str) -> str | None:
    if status == "pending":
        return None
    kind = "approved" if status == "approved" else "rejected"
    try:
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT status FROM outbound_emails WHERE"
                    " application_id = %s AND kind = %s",
                    (application_id, kind),
                )
                row = cur.fetchone()
    except db.DatabaseUnavailable:
        return "queued"
    return row[0] if row else "queued"


def _iso(moment: dt.datetime | None) -> str | None:
    if moment is None:
        return None
    return _utc(moment).strftime("%Y-%m-%dT%H:%M:%SZ")


def _utc(moment: dt.datetime) -> dt.datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=dt.timezone.utc)
    return moment.astimezone(dt.timezone.utc)


def decide(application_id: int, body: bytes, caller: dict) -> ApiResponse:
    _ready_guard()
    payload = _parse_json(body)  # step 5
    errors = application_rules.validate_decision(payload)  # step 8
    if errors:
        return validation_response(errors, None, private=True)
    status = "approved" if payload["decision"] == "approve" else "rejected"
    kind = "approved" if status == "approved" else "rejected"
    note = application_rules.stored_note(payload)
    try:
        with db.connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    row = _fetch_for_update(cur, application_id)
                    if row is None:
                        return error_response(404, "not_found", private=True)
                    if row[14] != "pending":
                        return error_response(
                            409, "already_decided", private=True,
                            status=row[14],
                        )
                    cur.execute("SELECT now()")
                    now = _utc(cur.fetchone()[0])
                    cur.execute(
                        "UPDATE partner_applications SET status = %s,"
                        " reviewer = %s, decision_note = %s, decided_at = %s"
                        " WHERE id = %s",
                        (status, caller["email"], note, now, application_id),
                    )
                    _record_email(cur, application_id, kind, {
                        "first_name": row[1], "work_email": row[3],
                        "company_name": row[5],
                    }, now)
                    row = tuple(row[:14]) + (status, caller["email"], note,
                                              row[17], now)
    except db.DatabaseUnavailable as exc:
        raise ApiError(503, "service_unavailable") from exc
    return ApiResponse.json(_application_payload(row), private=True)


def _fetch_for_update(cur, application_id: int):
    cur.execute(
        "SELECT " + _select_columns() +
        " FROM partner_applications WHERE id = %s FOR UPDATE",
        (application_id,),
    )
    return cur.fetchone()


def public_list(route: str, query: dict[str, list[str]],
                headers: dict[str, str]) -> ApiResponse:
    _ready_guard()
    try:
        return public_lists.handle(route, query, headers)
    except db.DatabaseUnavailable as exc:
        raise ApiError(503, "service_unavailable") from exc
