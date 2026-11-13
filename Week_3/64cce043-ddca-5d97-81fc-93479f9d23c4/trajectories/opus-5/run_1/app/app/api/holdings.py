"""Holdings: the ledger of who holds which piece of personal data."""
from __future__ import annotations

import asyncpg
from starlette.responses import Response

from .. import errors
from ..db import new_id
from ..domain.kinds import KIND_CODES, LEVEL_CODES
from ..domain.projection import holding_json
from ..domain.query import LedgerFilters, facet_counts, filter_holdings
from ..domain.records import Holding
from ..errors import ApiError, json_response
from ..store import prune_done_marks
from ..validate import Fields
from .base import Ctx

EDITABLE_POST = ("company", "data_kind", "value", "notes")
EDITABLE_PATCH = EDITABLE_POST + ("version",)
MAX_SEARCH_LENGTH = 100


def read_filters(ctx: Ctx) -> LedgerFilters:
    params = ctx.request.query_params
    filters = LedgerFilters(
        q=params.get("q", ""),
        company=params.get("company", ""),
        data_kind=params.get("data_kind", ""),
        level=params.get("level", ""),
    )
    found: dict[str, str] = {}
    if len(filters.q) > MAX_SEARCH_LENGTH:
        found["q"] = errors.FIELD_TOO_LONG
    if filters.data_kind and filters.data_kind not in KIND_CODES:
        found["data_kind"] = errors.FIELD_UNKNOWN_KIND
    if filters.level and filters.level not in LEVEL_CODES:
        found["level"] = errors.FIELD_UNKNOWN_LEVEL
    if found:
        raise ApiError("validation", found)
    return filters


async def list_holdings(ctx: Ctx) -> Response:
    filters = read_filters(ctx)
    view = ctx.vault_view()
    items = filter_holdings(view, filters, ctx.role)
    return json_response(
        {
            "items": [holding_json(holding, view, ctx.role) for holding in items],
            "total": len(items),
            "facets": facet_counts(view, filters, ctx.role),
            "exposure": {"score": view.score, "band": view.band},
        }
    )


async def read_holding(ctx: Ctx) -> Response:
    holding: Holding = ctx.target
    return json_response({"holding": holding_json(holding, ctx.vault_view(), ctx.role)})


async def create_holding(ctx: Ctx) -> Response:
    fields = Fields(ctx.body, EDITABLE_POST)
    company = fields.text("company", required=True, max_length=80, collapse=True)
    data_kind = fields.data_kind(required=True)
    value = fields.text("value", required=True, max_length=120)
    notes = fields.text("notes", required=False, max_length=500)
    fields.done()

    async with ctx.db.transaction() as connection:
        holding_id = new_id()
        try:
            await connection.execute(
                """insert into holdings (id, vault_id, company, data_kind, value, notes)
                   values ($1, $2, $3, $4, $5, $6)""",
                holding_id,
                ctx.vault_id,
                company,
                data_kind,
                value,
                notes,
            )
        except asyncpg.UniqueViolationError as conflict:
            raise ApiError("holding_exists") from conflict
        view = await prune_done_marks(connection, ctx.vault_id)
        await ctx.db.notify(connection, ctx.vault_id, "holding.created", holding_id)
    holding = view.holding(holding_id)
    assert holding is not None
    return json_response(
        {"holding": holding_json(holding, view, ctx.role), "exposure": view.exposure_json()},
        status_code=201,
    )


async def update_holding(ctx: Ctx) -> Response:
    current: Holding = ctx.target
    fields = Fields(ctx.body, EDITABLE_PATCH)
    version = fields.version()

    async with ctx.db.transaction() as connection:
        stored = await connection.fetchrow(
            "select version from holdings where id = $1 and vault_id = $2 for update",
            current.id,
            ctx.vault_id,
        )
        if stored is None:
            raise ApiError("not_found")
        if version and version != stored["version"]:
            raise ApiError("stale_version")
        company = (
            fields.text("company", required=True, max_length=80, collapse=True)
            if fields.has("company")
            else current.company
        )
        data_kind = fields.data_kind(required=True) if fields.has("data_kind") else current.data_kind
        value = (
            fields.text("value", required=True, max_length=120)
            if fields.has("value")
            else current.value
        )
        notes = (
            fields.text("notes", required=False, max_length=500)
            if fields.has("notes")
            else current.notes
        )
        fields.done()
        try:
            await connection.execute(
                """update holdings
                   set company = $3, data_kind = $4, value = $5, notes = $6,
                       version = version + 1, updated_at = now()
                   where id = $1 and vault_id = $2""",
                current.id,
                ctx.vault_id,
                company,
                data_kind,
                value,
                notes,
            )
        except asyncpg.UniqueViolationError as conflict:
            raise ApiError("holding_exists") from conflict
        view = await prune_done_marks(connection, ctx.vault_id)
        await ctx.db.notify(connection, ctx.vault_id, "holding.updated", current.id)
    holding = view.holding(current.id)
    assert holding is not None
    return json_response(
        {"holding": holding_json(holding, view, ctx.role), "exposure": view.exposure_json()}
    )


async def delete_holding(ctx: Ctx) -> Response:
    holding: Holding = ctx.target
    async with ctx.db.transaction() as connection:
        deleted = await connection.fetchval(
            "delete from holdings where id = $1 and vault_id = $2 returning id",
            holding.id,
            ctx.vault_id,
        )
        if deleted is None:
            raise ApiError("not_found")
        await prune_done_marks(connection, ctx.vault_id)
        await ctx.db.notify(connection, ctx.vault_id, "holding.deleted", holding.id)
    return Response(status_code=204)


async def exposure(ctx: Ctx) -> Response:
    return json_response(ctx.vault_view().exposure_json())
