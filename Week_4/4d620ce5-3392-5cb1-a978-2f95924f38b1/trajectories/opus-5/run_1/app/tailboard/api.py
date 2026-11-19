"""The API: one route table, one precedence order, one error shape."""

import datetime
import hashlib
import json
import queue
import re
import string

from . import clock, events, session, storage
from .config import (
    IMPORT_BODY_LIMIT,
    JSON_BODY_LIMIT,
    OBJECT_BODY_LIMIT,
    SESSION_COOKIE,
)
from .db import transaction
from .domain import audit as audit_rules
from .domain import exportcsv, imports, notices, packs, search
from .domain import people as people_rules
from .domain import supersession
from .domain import threads as thread_rules
from .domain import validate, work
from .domain.directives import directive_shape, load_directive, revision_number_of
from .errors import ApiError
from .ids import new_id
from .seed import MODEL_CODES
from .web import (
    Response,
    StreamResponse,
    clear_session_cookie,
    error_response,
    json_response,
    set_session_cookie,
    static_response,
)

ALL_ROLES = people_rules.ROLES
PLANNER = ("compliance_planner",)
INSPECTOR = ("licensed_inspector",)
ENGINEER = ("certifying_engineer",)
CLERK = ("records_clerk",)

EVIDENCE_TYPES = ("image/jpeg", "image/png", "application/pdf")
KEY_CHARACTERS = set(string.printable[:95])
CONTENT_TYPES = {
    "json": ("application/json",),
    "pdf": ("application/pdf",),
    "evidence": EVIDENCE_TYPES,
    "csv": ("text/csv",),
}
BODY_LIMITS = {
    "json": JSON_BODY_LIMIT,
    "pdf": OBJECT_BODY_LIMIT,
    "evidence": OBJECT_BODY_LIMIT,
    "csv": IMPORT_BODY_LIMIT,
}


class Route:
    def __init__(self, handler, roles=None, body=None, keyed=False, public=False):
        self.handler = handler
        self.roles = roles
        self.body = body
        self.keyed = keyed
        self.public = public
        self.limit = BODY_LIMITS.get(body, JSON_BODY_LIMIT)
        self.content_types = CONTENT_TYPES.get(body, ())


# ---------------------------------------------------------------- resource loaders

def directive_resource(cursor, params):
    return load_directive(cursor, params["id"])


def thread_resource(cursor, params):
    return thread_rules.load_thread_row(cursor, params["id"])


def pack_resource(cursor, params):
    return packs.load(cursor, params["id"])


def engineer_resource(cursor, params):
    row = cursor.one(
        "SELECT id, role FROM users WHERE id = %s AND role = 'certifying_engineer'",
        (params["user_id"],),
    )
    if row is None:
        raise ApiError("not_found", "No such certifying engineer.")
    return row


def person_resource(cursor, params):
    row = cursor.one(
        "SELECT id, contractor, erased FROM users WHERE id = %s AND is_system = false",
        (params["user_id"],),
    )
    if row is None:
        raise ApiError("not_found", "No such person.")
    return row


def tail_resource(cursor, params):
    row = cursor.one(
        "SELECT registration FROM tails WHERE registration = %s", (params["registration"],)
    )
    if row is None:
        raise ApiError("not_found", "No such tail.")
    return row


# ---------------------------------------------------------------- session and health

def health(_request, _cursor):
    return {"status": "ok"}, 200


def session_create(request, cursor):
    body = request.json()
    identifier, row = session.sign_in(cursor, body.get("username"), body.get("passcode"))
    people = people_rules.load_people(cursor)
    response = json_response({"user": people_rules.user(people[row["id"]])})
    set_session_cookie(response, identifier)
    return response


def session_read(request, cursor):
    people = people_rules.load_people(cursor)
    return {"user": people_rules.user(people[request.user["id"]])}, 200


def session_delete(request, cursor):
    session.sign_out(cursor, request.session_id)
    response = Response(204)
    clear_session_cookie(response)
    return response


def event_stream(_request, _cursor):
    channel = events.subscribe()

    def generator():
        yield b": connected\n\n"
        try:
            while True:
                try:
                    yield channel.get(timeout=events.HEARTBEAT_SECONDS)
                except queue.Empty:
                    yield b": keep-alive\n\n"
        finally:
            events.unsubscribe(channel)

    return StreamResponse(generator())


# ---------------------------------------------------------------- documents

def document_create(request, cursor):
    if not request.body.startswith(b"%PDF-"):
        raise validate.validation({"document": "must be a PDF"})
    digest = storage.sha256_hex(request.body)
    key = storage.document_key(digest)
    storage.put(key, request.body, "application/pdf")
    existing = cursor.one(
        "SELECT id, key, sha256, bytes FROM documents WHERE sha256 = %s", (digest,)
    )
    if existing:
        return {
            "document_id": existing["id"],
            "key": existing["key"],
            "sha256": existing["sha256"],
            "bytes": int(existing["bytes"]),
        }, 200
    document_id = new_id("doc")
    cursor.execute(
        """INSERT INTO documents (id, key, sha256, bytes, uploaded_by, uploaded_at)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (document_id, key, digest, len(request.body), request.user["id"], clock.now()),
    )
    return {"document_id": document_id, "key": key, "sha256": digest,
            "bytes": len(request.body)}, 201


# ---------------------------------------------------------------- directives

def directives_list(_request, cursor):
    return {"directives": thread_rules.directive_list(cursor)}, 200


def directive_read(request, cursor):
    people = people_rules.load_people(cursor)
    return {"directive": directive_shape(request.resource, people)}, 200


def _documents_exist(cursor):
    def check(document_id):
        return bool(cursor.value("SELECT 1 FROM documents WHERE id = %s", (document_id,)))

    return check


def directive_create(request, cursor):
    fields = validate.revision_body(request.json(), True, _documents_exist(cursor))
    at = clock.now()
    directive_id, splice = supersession.ingest_directive(cursor, request.user["id"], fields, at)
    people = people_rules.load_people(cursor)
    directive = directive_shape(load_directive(cursor, directive_id), people)
    request.after_commit.append(lambda: events.revision_changed(directive_id, splice))
    return {"directive": directive, "splice": splice}, 201


def revision_create(request, cursor):
    body = request.json()
    directive_id = request.resource["id"]
    fields = validate.revision_body(body, False, _documents_exist(cursor))
    number = revision_number_of(body.get("revision"))
    if number is None:
        raise validate.validation({"revision": "must be the next whole revision number"})
    at = clock.now()
    splice = supersession.ingest_revision(
        cursor, request.user["id"], directive_id, fields, number,
        bool(body.get("prior_credit")), at,
    )
    people = people_rules.load_people(cursor)
    directive = directive_shape(load_directive(cursor, directive_id), people)
    request.after_commit.append(lambda: events.revision_changed(directive_id, splice))
    return {"directive": directive, "splice": splice}, 201


def directive_withdraw(request, cursor):
    reason = validate.reason(request.json(), "reason")
    directive_id = request.resource["id"]
    directive = supersession.withdraw(
        cursor, request.user["id"], directive_id, reason, clock.now()
    )
    people = people_rules.load_people(cursor)
    thread_ids = [
        row["id"] for row in thread_rules.thread_rows(cursor, directive_id=directive_id)
    ]
    request.after_commit.append(lambda: events.threads_changed(thread_ids))
    return {"directive": directive_shape(directive, people)}, 200


def directive_export(request, cursor):
    directive = request.resource
    data = exportcsv.render(cursor, directive["id"])
    name = f"{directive['authority']}-{directive['number']}".replace(" ", "-")
    return Response(
        200,
        data,
        "text/csv; charset=utf-8",
        [("Content-Disposition", f'attachment; filename="{name}-compliance.csv"')],
    )


# ---------------------------------------------------------------- board and tails

def board(request, cursor):
    directive_id = request.q("directive_id")
    as_of = request.q("as_of")
    if as_of:
        if not directive_id:
            raise validate.validation({"as_of": "needs a directive_id"})
        load_directive(cursor, directive_id)
        snapshot = supersession.read_snapshot(cursor, directive_id, as_of)
        context = thread_rules.load_context(cursor)
        return {
            "generated_at": clock.iso(clock.now()),
            "as_of": as_of,
            "directives": [snapshot["directive"]],
            "tails": [thread_rules.tail_shape(row) for row in context["tails"].values()],
            "cells": snapshot["cells"],
            "totals": snapshot["totals"],
        }, 200
    if directive_id:
        load_directive(cursor, directive_id)
    return thread_rules.board(cursor, directive_id), 200


def tails_list(_request, cursor):
    context = thread_rules.load_context(cursor)
    return {"tails": [thread_rules.tail_shape(row) for row in context["tails"].values()]}, 200


def flight_hours(request, cursor):
    hours = validate.hours(request.json())
    at = clock.now()
    result, affected = work.log_flight_hours(
        cursor, request.user, request.resource["registration"], hours, at
    )
    result["logged_at"] = clock.iso(at)
    request.after_commit.append(lambda: events.threads_changed(affected))
    return result, 201


# ---------------------------------------------------------------- threads

def threads_list(request, cursor):
    context = thread_rules.load_context(cursor)
    rows = thread_rules.thread_rows(
        cursor,
        directive_id=request.q("directive_id"),
        registration=request.q("registration"),
    )
    wanted = request.q("state")
    at = clock.now()
    shapes = []
    for row in rows:
        shape = thread_rules.thread_shape(cursor, row, context, at)
        if wanted and shape["state"] != wanted:
            continue
        shapes.append(shape)
    return {"threads": shapes}, 200


def thread_read(request, cursor):
    return {"thread": thread_rules.thread_shape(cursor, request.resource)}, 200


def _thread_result(request, pair):
    thread, affected = pair
    request.after_commit.append(lambda: events.threads_changed(affected))
    return {"thread": thread}, 200


def thread_claim(request, cursor):
    return _thread_result(
        request, work.claim(cursor, request.user, request.resource["id"], clock.now())
    )


def thread_release(request, cursor):
    return _thread_result(
        request, work.release(cursor, request.user, request.resource["id"], clock.now())
    )


def thread_evidence(request, cursor):
    digest = storage.sha256_hex(request.body)
    key = storage.evidence_key(digest, request.content_type)
    shape, affected = work.attach_evidence(
        cursor, request.user, request.resource["id"], key, digest, request.content_type,
        len(request.body), clock.now(),
    )
    storage.put(key, request.body, request.content_type)
    request.after_commit.append(lambda: events.threads_changed(affected))
    return {"evidence": shape}, 201


def thread_inspection(request, cursor):
    thread, signature, affected = work.sign_inspection(
        cursor, request.user, request.resource["id"], request.json(), clock.now()
    )
    request.after_commit.append(lambda: events.threads_changed(affected))
    return {"thread": thread, "signature": signature}, 201


def thread_countersign(request, cursor):
    thread, signature, affected = work.countersign(
        cursor, request.user, request.resource["id"], request.json(), clock.now()
    )
    request.after_commit.append(lambda: events.threads_changed(affected))
    return {"thread": thread, "signature": signature}, 201


def thread_deferral(request, cursor):
    reason = validate.reason(request.json(), "reason")
    thread, affected = work.defer(
        cursor, request.user, request.resource["id"], reason, clock.now()
    )
    request.after_commit.append(lambda: events.threads_changed(affected))
    return {"thread": thread}, 201


def thread_effectivity(request, cursor):
    body = request.json()
    decision = body.get("decision")
    if decision not in ("confirmed", "not_applicable"):
        raise validate.validation({"decision": "must be confirmed or not_applicable"})
    reason = validate.reason(body, "reason")
    return _thread_result(
        request,
        work.decide_effectivity(
            cursor, request.user, request.resource["id"], decision, reason, clock.now()
        ),
    )


def thread_reopen(request, cursor):
    reason = validate.reason(request.json(), "reason")
    return _thread_result(
        request,
        work.reopen(cursor, request.user, request.resource["id"], reason, clock.now()),
    )


# ---------------------------------------------------------------- people

def people_list(_request, cursor):
    return {"people": people_rules.listed_users(people_rules.load_people(cursor))}, 200


def engineer_scope(request, cursor):
    models = request.json().get("models")
    if not isinstance(models, list) or any(model not in MODEL_CODES for model in models):
        raise validate.validation({"models": "must list known model codes"})
    engineer_id = request.resource["id"]
    succession = people_rules.set_scope(
        cursor, request.user["id"], engineer_id, models, clock.now()
    )
    people = people_rules.load_people(cursor)
    request.after_commit.append(
        lambda: events.threads_changed([entry["thread_id"] for entry in succession])
    )
    return {
        "engineer": people_rules.user(people[engineer_id]),
        "succession": [
            {
                "thread_id": entry["thread_id"],
                "from": people_rules.person(people.get(entry["from"])),
                "to": people_rules.person(people.get(entry["to"])),
            }
            for entry in succession
        ],
    }, 200


def person_erasure(request, cursor):
    reason = validate.reason(request.json(), "reason")
    row = request.resource
    if not row["contractor"]:
        raise ApiError("not_contractor")
    if row["erased"]:
        raise ApiError("already_erased")
    _token, touched = people_rules.erase(
        cursor, request.user["id"], row["id"], reason, clock.now()
    )
    people = people_rules.load_people(cursor)
    request.after_commit.append(lambda: events.threads_changed(touched))
    return {"person": people_rules.person(people[row["id"]])}, 200


# ---------------------------------------------------------------- imports, packs, notices

def imports_create(request, cursor):
    result, status, touched = imports.run(cursor, request.user, request.body, clock.now())
    request.after_commit.append(lambda: events.threads_changed(touched))
    return result, status


def imports_list(_request, cursor):
    return {"imports": imports.listed(cursor)}, 200


def packs_create(request, cursor):
    directive_id = request.json().get("directive_id")
    if not isinstance(directive_id, str):
        raise validate.validation({"directive_id": "is required"})
    load_directive(cursor, directive_id)
    pack_id = packs.request(cursor, request.user, directive_id, clock.now())
    packs.attempt(cursor, pack_id, request.user["id"])
    row = packs.load(cursor, pack_id)
    people = people_rules.load_people(cursor)
    return (
        {"pack": packs.shape(row, people)},
        201 if row["status"] == "transmitted" else 202,
    )


def packs_list(_request, cursor):
    return {"packs": packs.listed(cursor)}, 200


def pack_read(request, cursor):
    people = people_rules.load_people(cursor)
    return {"pack": packs.shape(request.resource, people)}, 200


def pack_pdf(request, _cursor):
    data, content_type = packs.download(request.resource, "pdf")
    return Response(200, data, content_type)


def pack_csv(request, _cursor):
    data, content_type = packs.download(request.resource, "csv")
    return Response(
        200,
        data,
        content_type,
        [("Content-Disposition", f'attachment; filename="{request.params["id"]}-manifest.csv"')],
    )


def notices_list(request, cursor):
    return {"notices": notices.listed(cursor, request.q("status"))}, 200


def search_run(request, cursor):
    query = validate.search_query(request.q("q"))
    return {"results": search.run(cursor, query)}, 200


def audit_list(request, cursor):
    return {
        "entries": audit_rules.entries(cursor, request.q("directive_id"), request.q("thread_id"))
    }, 200


ROUTES = [
    (r"^/api/health$", {"GET": Route(health, public=True)}, None),
    (
        r"^/api/session$",
        {
            "POST": Route(session_create, body="json", public=True),
            "GET": Route(session_read, roles=ALL_ROLES),
            "DELETE": Route(session_delete, roles=ALL_ROLES),
        },
        None,
    ),
    (r"^/api/events$", {"GET": Route(event_stream, roles=ALL_ROLES)}, None),
    (r"^/api/documents$", {"POST": Route(document_create, roles=PLANNER, body="pdf")}, None),
    (
        r"^/api/directives$",
        {
            "GET": Route(directives_list, roles=ALL_ROLES),
            "POST": Route(directive_create, roles=PLANNER, body="json"),
        },
        None,
    ),
    (
        r"^/api/directives/(?P<id>[^/]+)$",
        {"GET": Route(directive_read, roles=ALL_ROLES)},
        directive_resource,
    ),
    (
        r"^/api/directives/(?P<id>[^/]+)/revisions$",
        {"POST": Route(revision_create, roles=PLANNER, body="json")},
        directive_resource,
    ),
    (
        r"^/api/directives/(?P<id>[^/]+)/withdrawal$",
        {"POST": Route(directive_withdraw, roles=PLANNER, body="json")},
        directive_resource,
    ),
    (
        r"^/api/directives/(?P<id>[^/]+)/export\.csv$",
        {"GET": Route(directive_export, roles=ALL_ROLES)},
        directive_resource,
    ),
    (r"^/api/board$", {"GET": Route(board, roles=ALL_ROLES)}, None),
    (r"^/api/tails$", {"GET": Route(tails_list, roles=ALL_ROLES)}, None),
    (
        r"^/api/tails/(?P<registration>[^/]+)/flight-hours$",
        {"POST": Route(flight_hours, roles=PLANNER, body="json")},
        tail_resource,
    ),
    (r"^/api/threads$", {"GET": Route(threads_list, roles=ALL_ROLES)}, None),
    (
        r"^/api/threads/(?P<id>[^/]+)$",
        {"GET": Route(thread_read, roles=ALL_ROLES)},
        thread_resource,
    ),
    (
        r"^/api/threads/(?P<id>[^/]+)/claim$",
        {"POST": Route(thread_claim, roles=INSPECTOR, body="json", keyed=True)},
        thread_resource,
    ),
    (
        r"^/api/threads/(?P<id>[^/]+)/release$",
        {"POST": Route(thread_release, roles=INSPECTOR, body="json")},
        thread_resource,
    ),
    (
        r"^/api/threads/(?P<id>[^/]+)/evidence$",
        {"POST": Route(thread_evidence, roles=INSPECTOR, body="evidence")},
        thread_resource,
    ),
    (
        r"^/api/threads/(?P<id>[^/]+)/inspection$",
        {"POST": Route(thread_inspection, roles=INSPECTOR, body="json", keyed=True)},
        thread_resource,
    ),
    (
        r"^/api/threads/(?P<id>[^/]+)/countersign$",
        {"POST": Route(thread_countersign, roles=ENGINEER, body="json", keyed=True)},
        thread_resource,
    ),
    (
        r"^/api/threads/(?P<id>[^/]+)/deferral$",
        {"POST": Route(thread_deferral, roles=PLANNER, body="json", keyed=True)},
        thread_resource,
    ),
    (
        r"^/api/threads/(?P<id>[^/]+)/effectivity$",
        {"POST": Route(thread_effectivity, roles=PLANNER, body="json")},
        thread_resource,
    ),
    (
        r"^/api/threads/(?P<id>[^/]+)/reopen$",
        {"POST": Route(thread_reopen, roles=CLERK, body="json")},
        thread_resource,
    ),
    (r"^/api/people$", {"GET": Route(people_list, roles=ALL_ROLES)}, None),
    (
        r"^/api/engineers/(?P<user_id>[^/]+)/scope$",
        {"PUT": Route(engineer_scope, roles=CLERK, body="json")},
        engineer_resource,
    ),
    (
        r"^/api/people/(?P<user_id>[^/]+)/erasure$",
        {"POST": Route(person_erasure, roles=CLERK, body="json")},
        person_resource,
    ),
    (
        r"^/api/imports$",
        {
            "POST": Route(imports_create, roles=CLERK, body="csv", keyed=True),
            "GET": Route(imports_list, roles=ALL_ROLES),
        },
        None,
    ),
    (
        r"^/api/packs$",
        {
            "POST": Route(packs_create, roles=CLERK, body="json", keyed=True),
            "GET": Route(packs_list, roles=ALL_ROLES),
        },
        None,
    ),
    (
        r"^/api/packs/(?P<id>[^/]+)$",
        {"GET": Route(pack_read, roles=ALL_ROLES)},
        pack_resource,
    ),
    (
        r"^/api/packs/(?P<id>[^/]+)/pdf$",
        {"GET": Route(pack_pdf, roles=ALL_ROLES)},
        pack_resource,
    ),
    (
        r"^/api/packs/(?P<id>[^/]+)/csv$",
        {"GET": Route(pack_csv, roles=ALL_ROLES)},
        pack_resource,
    ),
    (r"^/api/notices$", {"GET": Route(notices_list, roles=ALL_ROLES)}, None),
    (r"^/api/search$", {"GET": Route(search_run, roles=ALL_ROLES)}, None),
    (r"^/api/audit$", {"GET": Route(audit_list, roles=ALL_ROLES)}, None),
    (r"^/api/audit/.*$", {}, None),
]
COMPILED = [(re.compile(pattern), methods, loader) for pattern, methods, loader in ROUTES]


def _match(path):
    for pattern, methods, loader in COMPILED:
        found = pattern.match(path)
        if found:
            return found, methods, loader
    return None, None, None


def _check_key(request, route):
    if not route.keyed:
        return None
    key = request.headers.get("idempotency-key")
    if not key:
        raise ApiError("idempotency_key_required")
    if len(key) > 100 or any(character not in KEY_CHARACTERS for character in key):
        raise ApiError("idempotency_key_invalid")
    return key


def _replay(cursor, request, key):
    row = cursor.one(
        """SELECT request_hash, status, response FROM idempotency
            WHERE user_id = %s AND method = %s AND path = %s AND key = %s""",
        (request.user["id"], request.method, request.path, key),
    )
    if row is None:
        return None
    if row["request_hash"] != hashlib.sha256(request.body).hexdigest():
        raise ApiError("idempotency_mismatch")
    payload = row["response"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    return json_response(payload, row["status"], [("Idempotent-Replayed", "true")])


def _store_key(cursor, request, key, payload, status):
    cursor.execute(
        """INSERT INTO idempotency (user_id, method, path, key, request_hash, status, response,
                                    created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
           ON CONFLICT (user_id, method, path, key) DO NOTHING""",
        (request.user["id"], request.method, request.path, key,
         hashlib.sha256(request.body).hexdigest(), status, json.dumps(payload), clock.now()),
    )
    cursor.execute(
        "DELETE FROM idempotency WHERE created_at < %s",
        (clock.now() - datetime.timedelta(hours=24),),
    )


def dispatch(request, read_body, declared_length):
    """The published precedence, in order, for every request."""
    if not request.path.startswith("/api/"):
        if request.method in ("GET", "HEAD"):
            return static_response(request.path)
        raise ApiError("method_not_allowed")

    found, methods, loader = _match(request.path)
    route = methods.get(request.method) if methods else None

    limit = route.limit if route else JSON_BODY_LIMIT
    if declared_length > limit:
        raise ApiError("payload_too_large")
    if route and route.body and declared_length > 0 and (
        request.content_type not in route.content_types
    ):
        raise ApiError("unsupported_media_type")
    if methods is not None and route is None:
        raise ApiError("method_not_allowed")
    if methods is None:
        raise ApiError("not_found")

    request.body = read_body(limit) if route.body else b""
    if len(request.body) > limit:
        raise ApiError("payload_too_large")
    request.params = found.groupdict()
    request.after_commit = []
    request.resource = None

    with transaction() as cursor:
        if not route.public:
            request.session_id = request.cookie(SESSION_COOKIE)
            request.user = session.current_user(cursor, request.session_id)
            if request.user is None:
                raise ApiError("unauthenticated")
            if request.method != "GET" and not request.client_origin_ok:
                raise ApiError("forbidden")
        key = _check_key(request, route)
        if key:
            replayed = _replay(cursor, request, key)
            if replayed is not None:
                return replayed
        if loader:
            request.resource = loader(cursor, request.params)
        if route.roles and request.user["role"] not in route.roles:
            raise ApiError("forbidden")
        outcome = route.handler(request, cursor)
        if isinstance(outcome, (Response, StreamResponse)):
            response = outcome
        else:
            payload, status = outcome
            if key:
                _store_key(cursor, request, key, payload, status)
            response = json_response(payload, status)
    for action in request.after_commit:
        action()
    return response


def handle(request, read_body, declared_length):
    try:
        return dispatch(request, read_body, declared_length)
    except ApiError as error:
        return error_response(error)
