"""The JSON API. Each route follows the published error precedence: 401, 403 access_ended, 404, 403 owner_only,
idempotent replay, 409, 503, then 422."""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import string
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Any

import asyncpg
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import auth, db, domain
from .auth import Caller, Grant
from .errors import ApiError
from .realm import RealmUnavailable
from .state import State

LIMITS = {"company": 80, "value": 120, "notes": 500, "company_contains": 60, "contact_name": 80, "contact_email": 254}
Q_LIMIT = 100
PRIORITY_MAX = 999
DATE_FORM = re.compile(r"\d{4}-\d{2}-\d{2}")
EMAIL_FORM = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
PASSWORD_LENGTH = (12, 128)
TEMPORARY_ALPHABET = string.ascii_letters + string.digits

M_REQUIRED = "Required."
M_TOO_LONG = "Too long."
M_KIND = "Choose a data kind from the list."
M_LEVEL = "Choose a level from the list."
M_DATE = "Use a date in the form YYYY-MM-DD."
M_FUTURE = "Date cannot be in the future."
M_KINDS_EMPTY = "Tick at least one data kind."
M_KINDS_REPEATED = "Each data kind can appear once."
M_PRIORITY = "Priority must be a whole number from 1 to 999."
M_RULE_IDS = "List every rule exactly once."
M_VERSION = "Send the version you loaded."
M_EMAIL = "Enter an email address."
M_EMAIL_TAKEN = "This email cannot be used for a trusted contact."
M_DURATION = "Choose 24h, 7d or 30d."
M_LEVELS_EMPTY = "Choose at least one level."
M_WIDEN = "Scope can only be narrowed. Revoke and grant again to widen it."
M_UNKNOWN_KEY = "This field cannot be set."
M_WRONG_PASSWORD = "Current password is incorrect."
M_PASSWORD_LENGTH = "Use 12 to 128 characters."
M_PASSWORD_SAME = "New password must differ from the current one."

HOLDING_KEYS = frozenset({"company", "data_kind", "value", "notes"})
RULE_KEYS = frozenset({"data_kind", "company_contains", "level", "priority"})
BREACH_KEYS = frozenset({"company", "announced_on", "data_kinds"})
GRANT_KEYS = frozenset({"contact_name", "contact_email", "duration", "levels"})
PASSWORD_KEYS = frozenset({"current_password", "new_password"})


# --------------------------------------------------------------------------- plumbing


def _state(request: Request) -> State:
    return request.app.state.strongroom


@asynccontextmanager
async def _reading(request: Request) -> AsyncIterator[tuple[asyncpg.Connection, Caller, domain.Snapshot]]:
    """A consistent read of the caller's vault."""
    async with _state(request).pool.acquire() as conn:
        who = await auth.caller(request, conn)
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            yield conn, who, await db.load_snapshot(conn, who.vault_id)


@asynccontextmanager
async def _writing(request: Request) -> AsyncIterator[tuple[asyncpg.Connection, Caller]]:
    """A write transaction that first takes the vault's row lock. Every write to one vault is serialised by it,
    which is what keeps a single active grant: the grant check and its insert run inside this lock."""
    async with _state(request).pool.acquire() as conn:
        who = await auth.caller(request, conn)
        async with conn.transaction():
            await conn.execute("SELECT 1 FROM vault WHERE id = $1 FOR UPDATE", who.vault_id)
            yield conn, who


@asynccontextmanager
async def _signed_in(request: Request) -> AsyncIterator[tuple[asyncpg.Connection, Caller]]:
    async with _state(request).pool.acquire() as conn:
        yield conn, await auth.caller(request, conn)


def _owner_only(who: Caller) -> None:
    if not who.is_owner:
        raise ApiError("owner_only")


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        raise ApiError("validation", {"body": "Send JSON."}) from None
    if not isinstance(body, dict):
        raise ApiError("validation", {"body": "Send JSON."})
    return body


def _unknown(body: dict[str, Any], allowed: frozenset[str]) -> dict[str, str]:
    return {key: M_UNKNOWN_KEY for key in body if key not in allowed}


def _parse_id(raw: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


def _valid_version(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def check_version(body: dict[str, Any], current: int) -> dict[str, str]:
    """The one version check: a stale version is refused before any validation; a missing one is a field error."""
    sent = body.get("version")
    if _valid_version(sent) and sent != current:
        raise ApiError("stale_version")
    return {} if _valid_version(sent) else {"version": M_VERSION}


def _text(body: dict[str, Any], key: str, errors: dict[str, str], *, required: bool, collapse: bool = False) -> str:
    raw = body.get(key)
    if raw is None and not required:
        return ""
    if not isinstance(raw, str):
        errors[key] = M_REQUIRED
        return ""
    value = domain.collapse(raw) if collapse else raw.strip()
    if required and not value:
        errors[key] = M_REQUIRED
    elif len(value) > LIMITS[key]:
        errors[key] = M_TOO_LONG
    return value


def _fail(errors: dict[str, str]) -> None:
    if errors:
        raise ApiError("validation", errors)


def iso(moment: datetime) -> str:
    moment = moment.astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


# --------------------------------------------------------------------------- projections


def holding_json(g: domain.Graded, who: Caller) -> dict[str, Any]:
    """The contact field projection is decided here: contacts get six keys and masked sensitive values."""
    h = g.holding
    if not who.is_owner:
        return {"id": str(h.id), "company": h.company, "data_kind": h.data_kind, "level": g.level,
                "value": domain.masked(h.value, g.level),
                "affected": g.affected}
    return {"id": str(h.id), "company": h.company, "data_kind": h.data_kind, "value": h.value, "notes": h.notes,
            "level": g.level, "rule_id": str(g.rule.id) if g.rule else None, "affected": g.affected,
            "version": h.version, "created_at": iso(h.created_at), "updated_at": iso(h.updated_at)}


def step_json(s: domain.Step) -> dict[str, Any]:
    return {"id": str(s.id), "holding_id": str(s.holding_id), "company": s.company, "data_kind": s.data_kind,
            "level": s.level, "number": s.number, "text": s.text, "status": "done" if s.done else "open",
            "points": s.points}


def exposure_json(view: domain.View) -> dict[str, Any]:
    return {"score": view.score, "band": view.band, "affected_count": view.affected_count,
            "open_steps": view.open_steps, "steps": [step_json(s) for s in view.steps]}


def breach_json(bv: domain.BreachView, who: Caller) -> dict[str, Any]:
    b = bv.breach
    body: dict[str, Any] = {"id": str(b.id), "company": b.company, "announced_on": b.announced_on.isoformat(),
                            "data_kinds": list(b.data_kinds), "affected_holding_ids": [str(i) for i in bv.affected_holding_ids]}
    if who.is_owner:
        body |= {"version": b.version, "created_at": iso(b.created_at)}
    return body


def rule_json(r: domain.Rule) -> dict[str, Any]:
    return {"id": str(r.id), "priority": r.priority, "data_kind": r.data_kind, "company_contains": r.company_contains,
            "level": r.level, "label": domain.rule_label(r), "version": r.version}


def grant_json(g: Grant) -> dict[str, Any]:
    return {"id": str(g.id), "status": g.status, "contact_name": g.contact_name, "contact_email": g.contact_email,
            "duration": g.duration, "levels": list(g.levels), "created_at": iso(g.created_at), "ends_at": iso(g.ends_at),
            "remaining_seconds": g.remaining_seconds}


def _view(snapshot: domain.Snapshot, who: Caller) -> domain.View:
    return domain.build_view(snapshot, scope=who.scope)


def _find_holding(view: domain.View, raw: str) -> domain.Graded:
    hid = _parse_id(raw)
    found = next((g for g in view.ledger if g.holding.id == hid), None)
    if found is None:
        raise ApiError("not_found")
    return found


def _find_breach(view: domain.View, raw: Any) -> domain.BreachView:
    bid = _parse_id(raw) if isinstance(raw, str) else None
    found = next((bv for bv in view.breaches if bv.breach.id == bid), None)
    if found is None:
        raise ApiError("not_found")
    return found


def _find_rule(snapshot: domain.Snapshot, who: Caller, raw: str) -> domain.Rule:
    rid = _parse_id(raw)
    found = next((r for r in snapshot.rules if r.id == rid), None) if who.is_owner else None
    if found is None:
        raise ApiError("not_found")
    return found


# --------------------------------------------------------------------------- reference routes


async def health(request: Request) -> Response:
    if _state(request).pool is None:
        return JSONResponse({"status": "starting"}, status_code=503)
    return JSONResponse({"status": "ok"})


async def status(request: Request) -> Response:
    return JSONResponse({"identity": "ok" if await _state(request).realm.is_up() else "down"})


async def me(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        return JSONResponse({"role": who.role, "name": who.name, "email": who.email})


async def kinds(request: Request) -> Response:
    async with _signed_in(request):
        return JSONResponse({
            "kinds": [{"code": k.code, "label": k.label, "steps": list(k.steps)} for k in domain.KINDS],
            "levels": [{"code": lv.code, "label": lv.label, "weight": lv.weight} for lv in domain.LEVELS]})


async def exposure(request: Request) -> Response:
    async with _reading(request) as (_conn, who, snapshot):
        return JSONResponse(exposure_json(_view(snapshot, who)))


# --------------------------------------------------------------------------- holdings


async def list_holdings(request: Request) -> Response:
    async with _reading(request) as (_conn, who, snapshot):
        params = request.query_params
        search = domain.Search(params.get("q", "").strip(), params.get("company", "").strip(),
                               params.get("data_kind", ""), params.get("level", ""))
        errors: dict[str, str] = {}
        if len(params.get("q", "")) > Q_LIMIT:
            errors["q"] = M_TOO_LONG
        if search.data_kind and search.data_kind not in domain.KIND_BY_CODE:
            errors["data_kind"] = M_KIND
        if search.level and search.level not in domain.LEVEL_BY_CODE:
            errors["level"] = M_LEVEL
        _fail(errors)
        view = _view(snapshot, who)
        holdings, facets = domain.search_ledger(view, search, owner=who.is_owner)
        # "items" is the brief's published key for the holdings list (GET /api/holdings); in code they are holdings.
        return JSONResponse({"items": [holding_json(g, who) for g in holdings], "total": len(holdings), "facets": facets,
                             "exposure": {"score": view.score, "band": view.band}})


def _holding_fields(body: dict[str, Any], *, partial: bool) -> tuple[dict[str, str], dict[str, str]]:
    errors = _unknown(body, HOLDING_KEYS | ({"version"} if partial else frozenset()))
    clean: dict[str, str] = {}
    for key, collapse in (("company", True), ("value", False)):
        if not partial or key in body:
            clean[key] = _text(body, key, errors, required=True, collapse=collapse)
    if not partial or "data_kind" in body:
        kind = body.get("data_kind")
        if kind is None:
            errors["data_kind"] = M_REQUIRED
        elif not isinstance(kind, str) or kind not in domain.KIND_BY_CODE:
            errors["data_kind"] = M_KIND
        else:
            clean["data_kind"] = kind
    if "notes" in body or not partial:
        clean["notes"] = _text(body, "notes", errors, required=False)
    return clean, errors


async def _holding_answer(conn: asyncpg.Connection, who: Caller, holding_id: uuid.UUID, status_code: int) -> Response:
    view = domain.build_view(await db.sync_steps(conn, who.vault_id))
    graded = next(g for g in view.ledger if g.holding.id == holding_id)
    return JSONResponse({"holding": holding_json(graded, who), "exposure": exposure_json(view)}, status_code=status_code)


async def create_holding(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    clean, errors = _holding_fields(body, partial=False)
    _fail(errors)
    async with _writing(request) as (conn, who):
        holding_id = await conn.fetchval(
            "INSERT INTO holding (id, vault_id, company, company_key, data_kind, value, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) "
            "ON CONFLICT (vault_id, company_key, data_kind) DO NOTHING RETURNING id",
            uuid.uuid4(), who.vault_id, clean["company"], domain.company_key(clean["company"]), clean["data_kind"],
            clean["value"], clean["notes"])
        if holding_id is None:
            raise ApiError("holding_exists")
        await db.notify(conn, who.vault_id, "holding.created", holding_id)
        return await _holding_answer(conn, who, holding_id, 201)


async def get_holding(request: Request) -> Response:
    async with _reading(request) as (_conn, who, snapshot):
        graded = _find_holding(_view(snapshot, who), request.path_params["id"])
        return JSONResponse({"holding": holding_json(graded, who)})


async def update_holding(request: Request) -> Response:
    try:
        async with _writing(request) as (conn, who):
            holding = _find_holding(_view(await db.load_snapshot(conn, who.vault_id), who), request.path_params["id"]).holding
            _owner_only(who)
            body = await _body(request)
            errors = check_version(body, holding.version)
            clean, field_errors = _holding_fields(body, partial=True)
            _fail(errors | field_errors)
            company = clean.get("company", holding.company)
            await conn.execute(
                "UPDATE holding SET company = $2, company_key = $3, data_kind = $4, value = $5, notes = $6, "
                "version = version + 1, updated_at = clock_timestamp() WHERE id = $1",
                holding.id, company, domain.company_key(company), clean.get("data_kind", holding.data_kind),
                clean.get("value", holding.value), clean.get("notes", holding.notes))
            await db.notify(conn, who.vault_id, "holding.updated", holding.id)
            return await _holding_answer(conn, who, holding.id, 200)
    except asyncpg.UniqueViolationError:
        raise ApiError("holding_exists") from None


async def delete_holding(request: Request) -> Response:
    async with _writing(request) as (conn, who):
        holding = _find_holding(_view(await db.load_snapshot(conn, who.vault_id), who), request.path_params["id"]).holding
        _owner_only(who)
        await conn.execute("DELETE FROM holding WHERE id = $1", holding.id)
        await db.notify(conn, who.vault_id, "holding.deleted", holding.id)
        await db.sync_steps(conn, who.vault_id)
    return Response(status_code=204)


# --------------------------------------------------------------------------- grading rules


def _rule_fields(body: dict[str, Any], *, partial: bool) -> tuple[dict[str, Any], dict[str, str]]:
    errors = _unknown(body, RULE_KEYS | ({"version"} if partial else frozenset()))
    clean: dict[str, Any] = {}
    if not partial or "data_kind" in body:
        kind = body.get("data_kind")
        if kind is None:
            errors["data_kind"] = M_REQUIRED
        elif not isinstance(kind, str) or (kind != "any" and kind not in domain.KIND_BY_CODE):
            errors["data_kind"] = M_KIND
        else:
            clean["data_kind"] = kind
    if not partial or "level" in body:
        level = body.get("level")
        if level is None:
            errors["level"] = M_REQUIRED
        elif not isinstance(level, str) or level not in domain.LEVEL_BY_CODE:
            errors["level"] = M_LEVEL
        else:
            clean["level"] = level
    if "company_contains" in body:
        clean["company_contains"] = _text(body, "company_contains", errors, required=False)
    if "priority" in body:
        priority = body["priority"]
        if isinstance(priority, int) and not isinstance(priority, bool) and 1 <= priority <= PRIORITY_MAX:
            clean["priority"] = priority
        else:
            errors["priority"] = M_PRIORITY
    return clean, errors


async def _rules_answer(conn: asyncpg.Connection, who: Caller, **extra: Any) -> dict[str, Any]:
    view = domain.build_view(await db.sync_steps(conn, who.vault_id))
    return {**extra, "exposure": exposure_json(view)}


async def list_rules(request: Request) -> Response:
    async with _reading(request) as (_conn, who, snapshot):
        _owner_only(who)
        return JSONResponse({"rules": [rule_json(r) for r in domain.order_rules(snapshot.rules)]})


async def create_rule(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    async with _writing(request) as (conn, who):
        clean, errors = _rule_fields(body, partial=False)
        if errors:
            # A full vault answers 409 before any field problem, as the error precedence orders.
            if await conn.fetchval("SELECT count(*) FROM grading_rule WHERE vault_id = $1", who.vault_id) >= domain.RULE_LIMIT:
                raise ApiError("rule_limit")
            _fail(errors)
        # One statement both enforces the limit and inserts.
        rule_id = await conn.fetchval(
            "INSERT INTO grading_rule (id, vault_id, priority, data_kind, company_contains, level) "
            "SELECT $1, $2, coalesce($3, least(coalesce(max(priority), 0) + 1, $7)), $4, $5, $6 FROM grading_rule "
            "WHERE vault_id = $2 HAVING count(*) < $8 RETURNING id",
            uuid.uuid4(), who.vault_id, clean.get("priority"), clean["data_kind"], clean.get("company_contains", ""),
            clean["level"], PRIORITY_MAX, domain.RULE_LIMIT)
        if rule_id is None:
            raise ApiError("rule_limit")
        await db.notify(conn, who.vault_id, "rule.created", rule_id)
        rule = next(r for r in (await db.load_snapshot(conn, who.vault_id)).rules if r.id == rule_id)
        return JSONResponse(await _rules_answer(conn, who, rule=rule_json(rule)), status_code=201)


async def update_rule(request: Request) -> Response:
    async with _writing(request) as (conn, who):
        rule = _find_rule(await db.load_snapshot(conn, who.vault_id), who, request.path_params["id"])
        body = await _body(request)
        errors = check_version(body, rule.version)
        clean, field_errors = _rule_fields(body, partial=True)
        _fail(errors | field_errors)
        await conn.execute(
            "UPDATE grading_rule SET priority = $2, data_kind = $3, company_contains = $4, level = $5, "
            "version = version + 1 WHERE id = $1", rule.id, clean.get("priority", rule.priority),
            clean.get("data_kind", rule.data_kind), clean.get("company_contains", rule.company_contains),
            clean.get("level", rule.level))
        await db.notify(conn, who.vault_id, "rule.updated", rule.id)
        saved = next(r for r in (await db.load_snapshot(conn, who.vault_id)).rules if r.id == rule.id)
        return JSONResponse(await _rules_answer(conn, who, rule=rule_json(saved)))


async def delete_rule(request: Request) -> Response:
    async with _writing(request) as (conn, who):
        rule = _find_rule(await db.load_snapshot(conn, who.vault_id), who, request.path_params["id"])
        await conn.execute("DELETE FROM grading_rule WHERE id = $1", rule.id)
        await db.notify(conn, who.vault_id, "rule.deleted", rule.id)
    return Response(status_code=204)


def _rule_order(body: dict[str, Any], snapshot: domain.Snapshot) -> list[uuid.UUID]:
    """Validates a full rule order against the vault's rules at this moment (never a 404)."""
    errors = _unknown(body, frozenset({"rule_ids"}))
    raw = body.get("rule_ids")
    order = [_parse_id(i) if isinstance(i, str) else None for i in raw] if isinstance(raw, list) else None
    current = {r.id for r in snapshot.rules}
    if order is None or len(order) != len(current) or set(order) != current:
        errors["rule_ids"] = M_RULE_IDS
    _fail(errors)
    return order


async def reorder_rules(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    async with _writing(request) as (conn, who):
        snapshot = await db.load_snapshot(conn, who.vault_id)
        order = _rule_order(body, snapshot)
        before = {r.id: r.priority for r in snapshot.rules}
        moved = [(rid, priority) for priority, rid in enumerate(order, 1) if before[rid] != priority]
        await conn.executemany("UPDATE grading_rule SET priority = $2, version = version + 1 WHERE id = $1", moved)
        for rid, _priority in moved:
            await db.notify(conn, who.vault_id, "rule.updated", rid)
        saved = domain.order_rules((await db.load_snapshot(conn, who.vault_id)).rules)
        return JSONResponse(await _rules_answer(conn, who, rules=[rule_json(r) for r in saved]))


async def preview_rules(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    async with _reading(request) as (_conn, who, snapshot):
        order = _rule_order(body, snapshot)
        view = domain.build_view(snapshot, rules=domain.reprioritised(snapshot.rules, order))
        return JSONResponse({"levels": [{"holding_id": str(g.holding.id), "level": g.level} for g in view.ledger],
                             "score": view.score})


# --------------------------------------------------------------------------- breaches


def _kinds_field(body: dict[str, Any], errors: dict[str, str]) -> tuple[str, ...]:
    raw = body.get("data_kinds")
    if not isinstance(raw, list) or not raw:
        errors["data_kinds"] = M_KINDS_EMPTY
    elif any(k not in domain.KIND_BY_CODE for k in raw if isinstance(k, str)) or not all(isinstance(k, str) for k in raw):
        errors["data_kinds"] = M_KIND
    elif len(set(raw)) != len(raw):
        errors["data_kinds"] = M_KINDS_REPEATED
    else:
        return tuple(sorted(raw, key=domain.KIND_ORDER.__getitem__))
    return ()


def _sorted_breaches(view: domain.View) -> list[domain.BreachView]:
    return sorted(view.breaches, key=lambda bv: (bv.breach.announced_on, bv.breach.seq), reverse=True)


async def list_breaches(request: Request) -> Response:
    async with _reading(request) as (_conn, who, snapshot):
        return JSONResponse({"breaches": [breach_json(bv, who) for bv in _sorted_breaches(_view(snapshot, who))]})


async def create_breach(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    key = request.headers.get("idempotency-key")
    request_hash = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    async with _writing(request) as (conn, who):
        if key is not None:
            stored = await conn.fetchrow("SELECT request_hash, response FROM breach_request "
                                         "WHERE vault_id = $1 AND idempotency_key = $2", who.vault_id, key)
            if stored is not None:
                if stored["request_hash"] != request_hash:
                    raise ApiError("idempotency_conflict")
                return Response(stored["response"], status_code=201, media_type="application/json")
        errors = _unknown(body, BREACH_KEYS)
        if key is not None and not 1 <= len(key) <= 100:
            errors["idempotency_key"] = M_TOO_LONG
        company = _text(body, "company", errors, required=True, collapse=True)
        announced = await _announced_on(conn, body, errors)
        kinds_sent = _kinds_field(body, errors)
        _fail(errors)
        breach_id = uuid.uuid4()
        await conn.execute(
            "INSERT INTO breach (id, vault_id, company, company_key, announced_on, data_kinds) VALUES ($1,$2,$3,$4,$5,$6)",
            breach_id, who.vault_id, company, domain.company_key(company), announced, list(kinds_sent))
        await db.notify(conn, who.vault_id, "breach.created", breach_id)
        view = domain.build_view(await db.sync_steps(conn, who.vault_id))
        answer = json.dumps({"breach": breach_json(_find_breach(view, str(breach_id)), who),
                             "exposure": exposure_json(view)})
        if key is not None:
            await conn.execute("INSERT INTO breach_request (vault_id, idempotency_key, request_hash, response) "
                               "VALUES ($1, $2, $3, $4)", who.vault_id, key, request_hash, answer)
        return Response(answer, status_code=201, media_type="application/json")


async def _announced_on(conn: asyncpg.Connection, body: dict[str, Any], errors: dict[str, str]) -> date | None:
    raw = body.get("announced_on")
    if raw is None:
        errors["announced_on"] = M_REQUIRED
        return None
    try:
        if not isinstance(raw, str) or not DATE_FORM.fullmatch(raw):
            raise ValueError(raw)
        announced = date.fromisoformat(raw)
    except ValueError:
        errors["announced_on"] = M_DATE
        return None
    if announced > await conn.fetchval("SELECT current_date"):
        errors["announced_on"] = M_FUTURE
    return announced


async def preview_breach(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    async with _reading(request) as (_conn, who, snapshot):
        view = domain.build_view(snapshot)
        existing = _find_breach(view, body["breach_id"]).breach if "breach_id" in body else None
        errors = _unknown(body, frozenset({"company", "data_kinds", "breach_id"}))
        company = body.get("company", "")
        kinds_sent = body.get("data_kinds", [])
        if not isinstance(company, str):
            errors["company"] = M_REQUIRED
        if not isinstance(kinds_sent, list) or not all(k in domain.KIND_BY_CODE for k in kinds_sent if isinstance(k, str)) \
                or not all(isinstance(k, str) for k in kinds_sent):
            errors["data_kinds"] = M_KIND
        _fail(errors)
        kinds_set = tuple(dict.fromkeys(kinds_sent))
        if existing is not None:
            hypothetical = domain.Breach(existing.id, existing.company, existing.company_key, existing.announced_on,
                                         kinds_set, existing.version, existing.created_at, existing.seq)
            others = tuple(b for b in snapshot.breaches if b.id != existing.id)
        else:
            text = domain.collapse(company)
            hypothetical = domain.Breach(None, text, domain.company_key(text), None, kinds_set, 0, None, 0)
            others = snapshot.breaches
        projected = domain.build_view(snapshot, breaches=others + (hypothetical,))
        touched = domain.affected_ids(hypothetical, projected.ledger)
        return JSONResponse({"affected_holding_ids": [str(i) for i in touched], "current_score": view.score,
                             "score": projected.score})


def _breach_detail(view: domain.View, bv: domain.BreachView, who: Caller) -> dict[str, Any]:
    touched = set(bv.affected_holding_ids)
    return {"breach": breach_json(bv, who),
            "holdings": [holding_json(g, who) for g in view.ledger if g.holding.id in touched],
            "steps": [step_json(s) for s in view.steps if touched.intersection(s.contributors)]}


async def get_breach(request: Request) -> Response:
    async with _reading(request) as (_conn, who, snapshot):
        view = _view(snapshot, who)
        return JSONResponse(_breach_detail(view, _find_breach(view, request.path_params["id"]), who))


async def update_breach(request: Request) -> Response:
    async with _writing(request) as (conn, who):
        breach = _find_breach(_view(await db.load_snapshot(conn, who.vault_id), who), request.path_params["id"]).breach
        _owner_only(who)
        body = await _body(request)
        errors = check_version(body, breach.version) | _unknown(body, frozenset({"data_kinds", "version"}))
        kinds_sent = _kinds_field(body, errors)
        _fail(errors)
        await conn.execute("UPDATE breach SET data_kinds = $2, version = version + 1 WHERE id = $1",
                           breach.id, list(kinds_sent))
        await db.notify(conn, who.vault_id, "breach.updated", breach.id)
        view = domain.build_view(await db.sync_steps(conn, who.vault_id))
        return JSONResponse({"breach": breach_json(_find_breach(view, str(breach.id)), who),
                             "exposure": exposure_json(view)})


async def delete_breach(request: Request) -> Response:
    async with _writing(request) as (conn, who):
        breach = _find_breach(_view(await db.load_snapshot(conn, who.vault_id), who), request.path_params["id"]).breach
        _owner_only(who)
        await conn.execute("DELETE FROM breach WHERE id = $1", breach.id)
        await db.notify(conn, who.vault_id, "breach.deleted", breach.id)
        await db.sync_steps(conn, who.vault_id)
    return Response(status_code=204)


# --------------------------------------------------------------------------- next steps


async def change_step(request: Request) -> Response:
    action = request.path_params["action"]
    if action not in ("done", "reopen"):
        raise ApiError("not_found")
    async with _writing(request) as (conn, who):
        snapshot = await db.load_snapshot(conn, who.vault_id)
        step_id = _parse_id(request.path_params["id"])
        step = next((s for s in _view(snapshot, who).steps if s.id == step_id), None)
        if step is None:
            raise ApiError("not_found")
        _owner_only(who)
        steps = domain.build_view(snapshot).steps
        to_done, to_open = domain.plan_step_change(steps, step, action)
        _fail(_unknown(await _body(request), frozenset()))
        changed = to_done + to_open
        await conn.execute("UPDATE next_step SET done = $3 WHERE vault_id = $1 AND id = ANY($2)",
                           who.vault_id, changed, bool(to_done))
        for sid in changed:
            await db.notify(conn, who.vault_id, "step.updated", sid)
        view = domain.build_view(await db.load_snapshot(conn, who.vault_id))
        return JSONResponse({"step": step_json(next(s for s in view.steps if s.id == step.id)),
                             "exposure": exposure_json(view)})


# --------------------------------------------------------------------------- trusted contact grant


async def _latest_grant(conn: asyncpg.Connection, vault_id: uuid.UUID, now: datetime) -> Grant | None:
    row = await conn.fetchrow("SELECT * FROM access_grant WHERE vault_id = $1 ORDER BY created_at DESC LIMIT 1", vault_id)
    return None if row is None else Grant.from_row(row, now)


async def _clock(conn: asyncpg.Connection) -> datetime:
    return await conn.fetchval("SELECT clock_timestamp()")


async def get_grant(request: Request) -> Response:
    async with _signed_in(request) as (conn, who):
        _owner_only(who)
        latest = await _latest_grant(conn, who.vault_id, await _clock(conn))
        return JSONResponse({"grant": None if latest is None else grant_json(latest)})


def _levels_field(body: dict[str, Any], errors: dict[str, str]) -> tuple[str, ...]:
    raw = body.get("levels")
    if not isinstance(raw, list) or not raw:
        errors["levels"] = M_LEVELS_EMPTY
    elif not all(isinstance(lv, str) and lv in domain.LEVEL_BY_CODE for lv in raw):
        errors["levels"] = M_LEVEL
    else:
        return domain.ordered_levels(raw)
    return ()


async def create_grant(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    state = _state(request)
    temporary = "".join(secrets.choice(TEMPORARY_ALPHABET) for _ in range(16))
    try:
        async with _writing(request) as (conn, who):
            now = await _clock(conn)
            latest = await _latest_grant(conn, who.vault_id, now)
            if latest is not None and latest.status == "active":
                raise ApiError("grant_active")
            if not await state.realm.is_up():
                raise ApiError("identity_unavailable")
            errors = _unknown(body, GRANT_KEYS)
            name = _text(body, "contact_name", errors, required=True)
            email = body.get("contact_email")
            if not isinstance(email, str) or not EMAIL_FORM.fullmatch(email.strip()):
                errors["contact_email"] = M_EMAIL
            elif len(email.strip()) > LIMITS["contact_email"]:
                errors["contact_email"] = M_TOO_LONG
            email = email.strip().lower() if isinstance(email, str) else ""
            duration = body.get("duration")
            if not isinstance(duration, str) or duration not in db.GRANT_HOURS:
                errors["duration"] = M_DURATION
            levels = _levels_field(body, errors)
            existing_user = None
            if "contact_email" not in errors:
                existing_user = await state.realm.find_user(email)
                past = await conn.fetchval("SELECT count(*) FROM access_grant WHERE vault_id = $1 AND contact_email = $2",
                                           who.vault_id, email)
                if existing_user is not None and not past:
                    errors["contact_email"] = M_EMAIL_TAKEN
            _fail(errors)
            grant_id = uuid.uuid4()
            # The grant row is won under the vault lock before the realm is touched; a failed realm call rolls it back.
            await conn.execute(
                "INSERT INTO access_grant (id, vault_id, contact_name, contact_email, duration, levels, created_at, ends_at) "
                "SELECT $1, $2, $3, $4, $5, $6, t, t + $7 FROM clock_timestamp() t", grant_id, who.vault_id, name, email,
                duration, list(levels), timedelta(seconds=db.GRANT_HOURS[duration] * state.config.grant_hour_seconds))
            user_id = await state.realm.put_contact(email, name, temporary,
                                                    existing_user["id"] if existing_user else None)
            await conn.execute("UPDATE access_grant SET contact_user_id = $2 WHERE id = $1", grant_id, user_id)
            await db.notify(conn, who.vault_id, "grant.created", grant_id)
            created = await _latest_grant(conn, who.vault_id, await _clock(conn))
    except RealmUnavailable:
        raise ApiError("identity_unavailable") from None
    return JSONResponse({"grant": grant_json(created), "temporary_password": temporary}, status_code=201)


async def end_realm_sessions(state: State, user_ids: list[str]) -> None:
    """Ends realm sessions now; any the realm cannot take yet stay queued for the 30-second retry."""
    for user_id in user_ids:
        try:
            await state.realm.end_sessions(user_id)
        except RealmUnavailable:
            async with state.pool.acquire() as conn:
                await conn.execute("INSERT INTO realm_logout (user_id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)


async def end_contact_sessions(state: State, user_id: str | None, email: str) -> None:
    """Ends the contact's realm sessions; a grant that never saw its contact sign in finds the account by email."""
    if user_id is None:
        try:
            user = await state.realm.find_user(email.lower())
        except RealmUnavailable:
            return
        if user is None:
            return
        user_id = user["id"]
    await end_realm_sessions(state, [user_id])


async def narrow_grant(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    async with _writing(request) as (conn, who):
        latest = await _latest_grant(conn, who.vault_id, await _clock(conn))
        if latest is None or latest.status != "active":
            raise ApiError("no_active_grant")
        errors = _unknown(body, frozenset({"levels"}))
        levels = _levels_field(body, errors)
        if "levels" not in errors and not set(levels) <= set(latest.levels):
            errors["levels"] = M_WIDEN
        _fail(errors)
        narrowed = set(levels) != set(latest.levels)
        if narrowed:
            await conn.execute("UPDATE access_grant SET levels = $2 WHERE id = $1", latest.id, list(levels))
            await db.notify(conn, who.vault_id, "grant.updated", latest.id)
        saved = await _latest_grant(conn, who.vault_id, await _clock(conn))
    # Every successful narrow, an equal set included, ends the contact's realm sessions (brief: Contact accounts).
    await end_contact_sessions(_state(request), saved.contact_user_id, saved.contact_email)
    return JSONResponse({"grant": grant_json(saved)})


async def revoke_grant(request: Request) -> Response:
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    async with _writing(request) as (conn, who):
        # One conditional update revokes the most recent grant; an already ended grant rolls it back.
        row = await conn.fetchrow(
            "UPDATE access_grant SET revoked_at = clock_timestamp() WHERE id = (SELECT id FROM access_grant "
            "WHERE vault_id = $1 ORDER BY created_at DESC LIMIT 1) AND revoked_at IS NULL "
            "RETURNING ends_at, revoked_at, id, contact_user_id", who.vault_id)
        if row is None or domain.grant_status(None, row["ends_at"], row["revoked_at"]) != "active":
            raise ApiError("no_active_grant")
        await conn.execute("DELETE FROM app_session WHERE vault_id = $1 AND role = 'contact'", who.vault_id)
        await db.notify(conn, who.vault_id, "grant.updated", row["id"])
        saved = await _latest_grant(conn, who.vault_id, await _clock(conn))
    await end_contact_sessions(_state(request), row["contact_user_id"], saved.contact_email)
    return JSONResponse({"grant": grant_json(saved)})


async def contact_grant(request: Request) -> Response:
    async with _signed_in(request) as (conn, who):
        if who.is_owner or who.grant is None:
            raise ApiError("not_found")
        owner_name = await conn.fetchval("SELECT owner_name FROM vault WHERE id = $1", who.vault_id)
        g = who.grant
        return JSONResponse({"status": g.status, "ends_at": iso(g.ends_at), "remaining_seconds": g.remaining_seconds,
                             "levels": list(g.levels), "owner_name": owner_name})


# --------------------------------------------------------------------------- account


async def change_password(request: Request) -> Response:
    state = _state(request)
    async with _signed_in(request) as (_conn, who):
        _owner_only(who)
    body = await _body(request)
    try:
        if not await state.realm.is_up():
            raise ApiError("identity_unavailable")
        errors = _unknown(body, PASSWORD_KEYS)
        current, new = body.get("current_password"), body.get("new_password")
        if not isinstance(current, str) or not current:
            errors["current_password"] = M_REQUIRED
        if not isinstance(new, str) or not PASSWORD_LENGTH[0] <= len(new) <= PASSWORD_LENGTH[1]:
            errors["new_password"] = M_PASSWORD_LENGTH
        elif new == current:
            errors["new_password"] = M_PASSWORD_SAME
        _fail(errors)
        if not await state.realm.password_is(who.email, current):
            raise ApiError("validation", {"current_password": M_WRONG_PASSWORD})
        await state.realm.set_password(who.sub, new)
    except RealmUnavailable:
        raise ApiError("identity_unavailable") from None
    async with state.pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM app_session WHERE (sub = $1 AND id <> $2) OR (vault_id = $3 AND role = 'contact')",
                               who.sub, auth.digest(who.session_id), who.vault_id)
            contacts = [r["contact_user_id"] for r in await conn.fetch(
                "SELECT DISTINCT contact_user_id FROM access_grant WHERE vault_id = $1 AND contact_user_id IS NOT NULL",
                who.vault_id)]
    await end_realm_sessions(state, [who.sub, *contacts])
    return JSONResponse({"status": "changed"})
