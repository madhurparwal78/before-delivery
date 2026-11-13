"""Breaches: logging an exposure and previewing its blast."""
from __future__ import annotations

import hashlib
import json

import asyncpg
from starlette.responses import Response

from ..db import new_id
from ..domain.exposure import compute, step_contributors
from ..domain.projection import breach_json, holding_json
from ..domain.records import Breach, company_key
from ..errors import ApiError, json_response
from ..store import (
    load_breaches,
    load_done_marks,
    load_holdings,
    load_rules,
    prune_done_marks,
)
from ..validate import Fields
from .base import Ctx

EDITABLE_POST = ("company", "announced_on", "data_kinds")
EDITABLE_PATCH = ("data_kinds", "version")
EDITABLE_PREVIEW = ("company", "data_kinds", "breach_id")
IDEMPOTENCY_HEADER = "Idempotency-Key"


async def list_breaches(ctx: Ctx) -> Response:
    view = ctx.vault_view()
    return json_response(
        {"breaches": [breach_json(breach, view, ctx.role) for breach in view.breaches]}
    )


async def read_breach(ctx: Ctx) -> Response:
    breach: Breach = ctx.target
    view = ctx.vault_view()
    touched = set(view.breach_affected.get(breach.id, []))
    holdings = [holding for holding in view.holdings if holding.id in touched]
    steps = [
        step
        for step in view.steps
        if touched.intersection(step_contributors(view, step))
    ]
    return json_response(
        {
            "breach": breach_json(breach, view, ctx.role),
            "holdings": [holding_json(holding, view, ctx.role) for holding in holdings],
            "steps": [step.as_json() for step in steps],
        }
    )


async def create_breach(ctx: Ctx) -> Response:
    key = _idempotency_key(ctx)
    request_hash = _body_hash(ctx.body)
    if key is not None:
        stored = await ctx.db.fetchrow(
            """select request_hash, response_status, response_body
               from idempotency_keys where vault_id = $1 and key = $2""",
            ctx.vault_id,
            key,
        )
        if stored is not None:
            return _replayed(stored, request_hash)

    try:
        return await _store_breach(ctx, key, request_hash)
    except _ReplayRace:
        stored = await ctx.db.fetchrow(
            """select request_hash, response_status, response_body
               from idempotency_keys where vault_id = $1 and key = $2""",
            ctx.vault_id,
            key,
        )
        return _replayed(stored, request_hash)


async def _store_breach(ctx: Ctx, key: str | None, request_hash: str) -> Response:
    async with ctx.db.transaction() as connection:
        today = await connection.fetchval("select current_date")
        fields = Fields(ctx.body, EDITABLE_POST)
        company = fields.text("company", required=True, max_length=80, collapse=True)
        announced_on = fields.announced_on("announced_on", today)
        data_kinds = fields.data_kinds()
        fields.done()
        assert announced_on is not None

        breach_id = new_id()
        await connection.execute(
            """insert into breaches (id, vault_id, company, announced_on, data_kinds)
               values ($1, $2, $3, $4, $5)""",
            breach_id,
            ctx.vault_id,
            company,
            announced_on,
            data_kinds,
        )
        view = await prune_done_marks(connection, ctx.vault_id)
        breach = view.breach(breach_id)
        assert breach is not None
        payload = {
            "breach": breach_json(breach, view, ctx.role),
            "exposure": view.exposure_json(),
        }
        if key is not None:
            try:
                await connection.execute(
                    """insert into idempotency_keys
                           (vault_id, key, request_hash, response_status, response_body)
                       values ($1, $2, $3, 201, $4::jsonb)""",
                    ctx.vault_id,
                    key,
                    request_hash,
                    json.dumps(payload),
                )
            except asyncpg.UniqueViolationError:
                raise _ReplayRace() from None
        await ctx.db.notify(connection, ctx.vault_id, "breach.created", breach_id)
    return json_response(payload, status_code=201)


async def update_breach(ctx: Ctx) -> Response:
    current: Breach = ctx.target
    fields = Fields(ctx.body, EDITABLE_PATCH)
    version = fields.version()

    async with ctx.db.transaction() as connection:
        stored = await connection.fetchrow(
            "select version from breaches where id = $1 and vault_id = $2 for update",
            current.id,
            ctx.vault_id,
        )
        if stored is None:
            raise ApiError("not_found")
        if version and version != stored["version"]:
            raise ApiError("stale_version")
        data_kinds = fields.data_kinds()
        fields.done()

        await connection.execute(
            """update breaches set data_kinds = $3, version = version + 1
               where id = $1 and vault_id = $2""",
            current.id,
            ctx.vault_id,
            data_kinds,
        )
        view = await prune_done_marks(connection, ctx.vault_id)
        await ctx.db.notify(connection, ctx.vault_id, "breach.updated", current.id)
    breach = view.breach(current.id)
    assert breach is not None
    return json_response(
        {"breach": breach_json(breach, view, ctx.role), "exposure": view.exposure_json()}
    )


async def delete_breach(ctx: Ctx) -> Response:
    breach: Breach = ctx.target
    async with ctx.db.transaction() as connection:
        deleted = await connection.fetchval(
            "delete from breaches where id = $1 and vault_id = $2 returning id",
            breach.id,
            ctx.vault_id,
        )
        if deleted is None:
            raise ApiError("not_found")
        await prune_done_marks(connection, ctx.vault_id)
        await ctx.db.notify(connection, ctx.vault_id, "breach.deleted", breach.id)
    return Response(status_code=204)


async def preview_breach(ctx: Ctx) -> Response:
    """The holdings a company and set of kinds would touch, and the score with them."""
    fields = Fields(ctx.body, EDITABLE_PREVIEW)
    company = fields.text("company", required=False, max_length=80, collapse=True)
    raw_kinds = ctx.body.get("data_kinds")
    data_kinds = fields.data_kinds() if raw_kinds else []
    replaced_id = ctx.body.get("breach_id")
    fields.done()

    async with ctx.db.pool.acquire() as connection:
        clock = await connection.fetchrow("select current_date as today, now() as db_now")
        holdings = await load_holdings(connection, ctx.vault_id)
        rules = await load_rules(connection, ctx.vault_id)
        breaches = await load_breaches(connection, ctx.vault_id)
        done_marks = await load_done_marks(connection, ctx.vault_id)

    replaced = next((breach for breach in breaches if breach.id == replaced_id), None)
    if replaced_id is not None and replaced is None:
        raise ApiError("not_found")

    current = compute(ctx.vault_id, holdings, rules, breaches, done_marks)
    hypothetical = [breach for breach in breaches if breach.id != replaced_id]
    preview_id = "preview"
    if company and data_kinds:
        hypothetical.append(
            Breach(
                id=preview_id,
                company=company,
                company_key=company_key(company),
                announced_on=replaced.announced_on if replaced else clock["today"],
                data_kinds=tuple(data_kinds),
                version=1,
                created_at=replaced.created_at if replaced else clock["db_now"],
            )
        )
    projected = compute(ctx.vault_id, holdings, rules, hypothetical, done_marks)
    return json_response(
        {
            "affected_holding_ids": projected.breach_affected.get(preview_id, []),
            "current_score": current.score,
            "score": projected.score,
        }
    )


class _ReplayRace(Exception):
    """Another request stored this Idempotency-Key first."""


def _idempotency_key(ctx: Ctx) -> str | None:
    key = ctx.request.headers.get(IDEMPOTENCY_HEADER)
    if key is None or not 1 <= len(key) <= 100:
        return None
    return key


def _body_hash(body: dict[str, object]) -> str:
    return hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _replayed(stored: asyncpg.Record, request_hash: str) -> Response:
    if stored["request_hash"] != request_hash:
        raise ApiError("idempotency_conflict")
    return json_response(json.loads(stored["response_body"]), status_code=stored["response_status"])
