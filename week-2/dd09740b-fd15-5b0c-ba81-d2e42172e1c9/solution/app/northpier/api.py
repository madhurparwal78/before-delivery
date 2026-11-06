"""The JSON API under /api. Each view follows the brief's single refusal order."""
from collections.abc import Callable
from functools import wraps
from typing import Any

import asyncpg
from django.http import HttpRequest, HttpResponse

from northpier import auth, db, inquiries, pipeline
from northpier.bodies import idempotency_key, json_object
from northpier.domain import validate_note
from northpier.errors import Refusal, json_response
from northpier.records import (inquiry_by_token, history_rows, inquiry_by_id, note_rows, note_shape, public_inquiry,
                               studio_inquiry)
from northpier.studio_queue import check_query, queue

BIGINT_MAX = 2**63 - 1
View = Callable[..., HttpResponse]


def methods(*allowed: str) -> Callable[[View], View]:
    """Refuse other methods on a known API path with 405 naming the allowed ones."""
    def decorate(view: View) -> View:
        @wraps(view)
        def wrapper(request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
            if request.method not in allowed:
                raise Refusal("method", allow=", ".join(allowed))
            return view(request, *args, **kwargs)
        return wrapper
    return decorate


def signed_in(request: HttpRequest) -> tuple[dict[str, Any], bool]:
    """The studio user and whether the session cookie carried the sign-in, or the sign-in-required refusal."""
    token, from_cookie = auth.request_token(request)
    user = auth.session_user(token)
    if user is None:
        raise Refusal("sign_in")
    return user, from_cookie


def refuse_foreign_cookie_write(request: HttpRequest, from_cookie: bool) -> None:
    if from_cookie and not auth.own_origin(request):
        raise Refusal("cross_origin")


def known_inquiry(raw_id: str) -> int:
    """The id of a stored inquiry, or the not-found refusal for anything else."""
    if not raw_id.isascii() or not raw_id.isdigit() or int(raw_id) > BIGINT_MAX:
        raise Refusal("not_found")
    with db.transaction() as tx:
        if tx.value("SELECT count(*) FROM inquiries WHERE id = :id", id=int(raw_id)) == 0:
            raise Refusal("not_found")
    return int(raw_id)


def health(request: HttpRequest) -> HttpResponse:
    try:
        with db.transaction() as tx:
            seeded = tx.value("SELECT count(*) FROM cases") == 8
    except (db.Unavailable, asyncpg.PostgresError):
        seeded = False
    return json_response({"status": "ok"} if seeded else {"status": "unavailable"}, 200 if seeded else 503)


@methods("POST")
def login(request: HttpRequest) -> HttpResponse:
    token, user = auth.sign_in(json_object(request))
    return json_response({"token": token, "user": user})


@methods("POST")
def logout(request: HttpRequest) -> HttpResponse:
    _user, from_cookie = signed_in(request)
    refuse_foreign_cookie_write(request, from_cookie)
    auth.sign_out(auth.request_token(request)[0])
    return HttpResponse(status=204)


@methods("GET", "HEAD")
def me(request: HttpRequest) -> HttpResponse:
    return json_response(signed_in(request)[0])


def case_shape(row: dict[str, Any]) -> dict[str, Any]:
    return {"slug": row["slug"], "client": row["client"], "industry": row["industry"], "theme": row["theme"],
            "position": row["position"], "headline": row["headline"], "body": row["body"], "awards": row["awards"],
            "testimonial": {"quote": row["testimonial_quote"], "name": row["testimonial_name"],
                            "role": row["testimonial_role"]}}


def all_cases(tx: db.Tx) -> list[dict[str, Any]]:
    return tx.rows("SELECT * FROM cases ORDER BY position")


def case_with_more(tx: db.Tx, slug: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """One case and the next two in position order, wrapping around; or the not-found refusal."""
    cases = all_cases(tx)
    index = next((i for i, c in enumerate(cases) if c["slug"] == slug), None)
    if index is None:
        raise Refusal("not_found")
    return cases[index], [cases[(index + step) % len(cases)] for step in (1, 2)]


def case_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {key: row[key] for key in ("slug", "client", "industry", "theme", "position")}


@methods("GET", "HEAD")
def cases_list(request: HttpRequest) -> HttpResponse:
    with db.transaction() as tx:
        return json_response([case_summary(c) for c in all_cases(tx)])


@methods("GET", "HEAD")
def case_detail(request: HttpRequest, slug: str) -> HttpResponse:
    with db.transaction() as tx:
        case, more = case_with_more(tx, slug)
    return json_response({**case_shape(case), "more": [case_summary(c) for c in more]})


@methods("POST")
def submit_inquiry(request: HttpRequest) -> HttpResponse:
    body = json_object(request)
    status, payload = inquiries.submit(body, idempotency_key(request))
    return json_response(payload, status)


def status_read(request: HttpRequest, token: str) -> HttpResponse:
    """GET or HEAD only; every other method was answered 405 by the boundary before reaching here."""
    with db.transaction() as tx:
        row = inquiry_by_token(tx, token)
        if row is None:
            raise Refusal("not_found")
        return json_response(public_inquiry(row, history_rows(tx, row["id"])))


@methods("GET", "HEAD")
def studio_queue(request: HttpRequest) -> HttpResponse:
    signed_in(request)
    status, q = check_query(request.GET.get("status", "new"), request.GET.get("q", ""))
    with db.transaction() as tx:
        rows, counts = queue(tx, status, q)
    return json_response({"inquiries": [studio_inquiry(r, with_message=False) for r in rows], "counts": counts})


@methods("GET", "HEAD")
def studio_detail(request: HttpRequest, raw_id: str) -> HttpResponse:
    user, _from_cookie = signed_in(request)
    inquiry_id = known_inquiry(raw_id)
    with db.transaction() as tx:
        detail = pipeline.studio_detail(tx, inquiry_by_id(tx, inquiry_id), user["role"])
        detail["notes"] = [note_shape(n) for n in note_rows(tx, inquiry_id)]
    return json_response(detail)


@methods("POST")
def transition(request: HttpRequest, raw_id: str) -> HttpResponse:
    user, from_cookie = signed_in(request)
    inquiry_id = known_inquiry(raw_id)
    body = json_object(request)
    key = idempotency_key(request)
    refuse_foreign_cookie_write(request, from_cookie)
    return json_response(pipeline.apply_transition(user, inquiry_id, body, key))


@methods("POST")
def add_note(request: HttpRequest, raw_id: str) -> HttpResponse:
    user, from_cookie = signed_in(request)
    inquiry_id = known_inquiry(raw_id)
    body = json_object(request)
    refuse_foreign_cookie_write(request, from_cookie)
    note = validate_note(body)
    with db.transaction() as tx:
        row = tx.one("INSERT INTO notes (inquiry_id, author_id, body, created_at) "
                     "VALUES (:id, :author, :body, clock_timestamp()) RETURNING id, body, created_at",
                     id=inquiry_id, author=user["id"], body=note)
    return json_response(note_shape({**row, "author_name": user["name"]}), 201)


def not_found(request: HttpRequest) -> HttpResponse:
    raise Refusal("not_found")
