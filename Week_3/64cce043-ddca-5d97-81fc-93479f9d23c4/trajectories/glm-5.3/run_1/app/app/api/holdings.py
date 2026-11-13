"""Holdings routes: list with facets, create, read, update, delete."""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from aiohttp import web

from ..auth.store import Context, new_id
from ..core.exposure import BreachView, HoldingView, compute_exposure
from ..core.grading import grade
from ..core.grant_state import grant_status
from ..core.vault_reader import VaultReader
from ..core.vault_writer import VaultWriter, WriteError
from ..domain import KINDS, LEVELS, LEVEL_LIST, KIND_LIST, match_company
from ..errors import (
    ApiError,
    holding_exists,
    internal_error,
    not_found,
    owner_only,
    signed_out,
    validation,
)
from ..db.base import emit_notification
from .boundary import read_json_body
from ..core.validation import (
    clean_company,
    clean_kind,
    clean_notes,
    clean_value,
    reject_unknown_keys,
)
from ..core.versions import check_version

HOLDING_EDITABLE_POST = {"company", "data_kind", "value", "notes"}
HOLDING_EDITABLE_PATCH = {"company", "data_kind", "value", "notes", "version"}


def _ctx(request: web.Request) -> Context:
    return request["ctx"]


def _reader(request: web.Request) -> VaultReader:
    return request.app["reader"]


def _writer(request: web.Request) -> VaultWriter:
    return request.app["writer"]


def _vault_id(ctx: Context) -> str:
    if ctx.account.vault_id is None:
        raise not_found()
    return ctx.account.vault_id


async def holdings_query(ctx: Context, request: web.Request) -> dict[str, Any]:
    """The holdings list with items, total, facets and the whole-scope exposure."""
    reader = _reader(request)
    vault_id = _vault_id(ctx)

    q = (request.query.get("q") or "").strip()
    company = (request.query.get("company") or "").strip()
    data_kind = request.query.get("data_kind") or ""
    level = request.query.get("level") or ""

    field_errors: dict[str, str] = {}
    if len(q) > 100:
        field_errors["q"] = "Too long."
    if data_kind and data_kind not in KINDS:
        field_errors["data_kind"] = "Choose a data kind from the list."
    if level and level not in LEVELS:
        field_errors["level"] = "Choose a level from the list."
    if field_errors:
        raise validation(field_errors)

    # Scope: owners see every holding; contacts only the grant's levels.
    if ctx.account.role == "owner":
        holdings = await reader.holdings_full(vault_id)
        breaches = await reader.breaches(vault_id)
        done = await reader.done_marks(vault_id)
        for h in holdings:
            h["affected"] = False
        breach_views = breaches
    else:
        grant = await reader.grant_for_vault(vault_id)
        db_now = await request.app["db"].fetchval("SELECT now()")
        status, _remaining = grant_status(grant, db_now) if grant else ("expired", 0)
        if grant is None or status != "active":
            from ..errors import access_ended

            raise access_ended()
        holdings_rows = await request.app["db"].fetch(
            """
            SELECT id, company, data_kind, value, notes, level, rule_id, version, created_at, updated_at
            FROM holdings WHERE vault_id = $1 AND level = ANY($2::text[])
            """,
            vault_id, list(grant.levels),
        )
        holdings = [dict(r) for r in holdings_rows]
        scope_holdings = [
            HoldingView(id=h["id"], company=h["company"], data_kind=h["data_kind"], level=h["level"])
            for h in holdings
        ]
        breaches = await reader.scope_breaches(vault_id, scope_holdings)
        done = await reader.done_marks(vault_id)
        breach_views = breaches

    affected_ids = compute_exposure(
        [
            HoldingView(id=h["id"], company=h["company"], data_kind=h["data_kind"], level=h["level"])
            for h in holdings
        ],
        [b for b in breach_views],
        {},
    )
    # compute affected separately for flags
    from ..core.exposure import affected_holding_ids

    aff_ids = affected_ids.steps  # not used; recompute below
    all_views = [
        HoldingView(id=h["id"], company=h["company"], data_kind=h["data_kind"], level=h["level"])
        for h in holdings
    ]
    affected_set = set(affected_holding_ids(all_views, breach_views))
    for h in holdings:
        h["affected"] = h["id"] in affected_set

    # --- Filtering
    def matches(h: dict) -> bool:
        if company and match_company(h["company"]) != match_company(company):
            return False
        if data_kind and h["data_kind"] != data_kind:
            return False
        if level and h["level"] != level:
            return False
        if q and not _text_match(ctx, h, q):
            return False
        return True

    items = [h for h in holdings if matches(h)]
    kind_order = {k.code: i for i, k in enumerate(KIND_LIST)}
    items.sort(
        key=lambda h: (
            match_company(h["company"]),
            kind_order.get(h["data_kind"], 99),
            h["created_at"],
            h["id"],
        )
    )

    # --- Facets: each counts holdings matching q and every filter except its own.
    company_facet: dict[str, int] = {}
    kind_facet: dict[str, int] = {}
    level_facet: dict[str, int] = {}
    for h in holdings:
        if q and not _text_match(ctx, h, q):
            continue
        if data_kind and h["data_kind"] != data_kind:
            continue
        if level and h["level"] != level:
            continue
        company_facet[h["company"]] = company_facet.get(h["company"], 0) + 1
    for h in holdings:
        if q and not _text_match(ctx, h, q):
            continue
        if company and match_company(h["company"]) != match_company(company):
            continue
        if level and h["level"] != level:
            continue
        kind_facet[h["data_kind"]] = kind_facet.get(h["data_kind"], 0) + 1
    for h in holdings:
        if q and not _text_match(ctx, h, q):
            continue
        if company and match_company(h["company"]) != match_company(company):
            continue
        if data_kind and h["data_kind"] != data_kind:
            continue
        level_facet[h["level"]] = level_facet.get(h["level"], 0) + 1

    exposure = compute_exposure(all_views, breach_views, done)
    from ..core.projection import exposure_for, holding_for

    return {
        "items": [holding_for(ctx, h) for h in items],
        "total": len(items),
        "facets": {
            "company": company_facet,
            "data_kind": kind_facet,
            "level": level_facet,
        },
        "exposure": exposure_for(exposure),
    }


def _text_match(ctx: Context, h: dict, q: str) -> bool:
    if ctx.account.role == "contact":
        hay = [h["company"], KINDS[h["data_kind"]].label]
    else:
        hay = [h["company"], h["value"], h["notes"], KINDS[h["data_kind"]].label]
    return any(q.casefold() in part.casefold() for part in hay)


async def list_holdings(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    data = await holdings_query(ctx, request)
    from ..errors import json_response

    return json_response(data)


async def create_holding(request: web.Request) -> web.Response:
    """Add a holding: the server sets the level from the grading rules."""
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"company": "Required."})
    reject_unknown_keys(body, HOLDING_EDITABLE_POST)
    company = clean_company(body.get("company"))
    data_kind = clean_kind(body.get("data_kind"))
    value = clean_value(body.get("value"))
    notes = clean_notes(body.get("notes"))

    reader = _reader(request)
    writer = _writer(request)
    db = request.app["db"]
    holding_id = new_id("hold")
    company_key = match_company(company)

    async def op(conn) -> dict:
        rules = await _rules_on(conn, vault_id)
        level, rule_id = grade(rules, data_kind, company)
        await writer.create_holding(
            conn, vault_id, holding_id, company, company_key, data_kind, value, notes, level, rule_id
        )
        return {"level": level, "rule_id": rule_id}

    from ..errors import json_response
    from ..core.projection import holding_for

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await op(conn)
                row = await conn.fetchrow(
                    """
                    SELECT id, company, data_kind, value, notes, level, rule_id, version, created_at, updated_at
                    FROM holdings WHERE id = $1
                    """,
                    holding_id,
                )
                holding = dict(row)
                affected = await _affected_ids_on(conn, vault_id)
                holding["affected"] = holding["id"] in affected
        exposure = await _exposure_for_vault(request, ctx, vault_id)
        return json_response(
            {"holding": holding_for(ctx, holding), "exposure": exposure}, status=201
        )
    except WriteError as exc:
        if exc.code == "holding_exists":
            raise holding_exists()
        raise internal_error()


async def _rules_on(conn, vault_id: str):
    from ..core.grading import GradingRule

    rows = await conn.fetch(
        "SELECT id, priority, data_kind, company_contains, level, version, created_at FROM rules WHERE vault_id = $1",
        vault_id,
    )
    rules = [
        GradingRule(
            id=r["id"], priority=r["priority"], data_kind=r["data_kind"],
            company_contains=r["company_contains"], level=r["level"],
            version=r["version"], created_at=r["created_at"].isoformat(),
        )
        for r in rows
    ]
    rules.sort(key=lambda r: (r.priority, r.level, r.created_at or "", r.id))
    return rules


async def _affected_ids_on(conn, vault_id: str) -> set[str]:
    from ..core.exposure import HoldingView, BreachView, affected_holding_ids

    hrows = await conn.fetch(
        "SELECT id, company, data_kind, level, created_at FROM holdings WHERE vault_id = $1",
        vault_id,
    )
    holdings = [
        HoldingView(id=r["id"], company=r["company"], data_kind=r["data_kind"], level=r["level"])
        for r in hrows
    ]
    brows = await conn.fetch(
        """
        SELECT b.id, b.company,
               (SELECT array_agg(bk.data_kind) FROM breach_kinds bk WHERE bk.breach_id = b.id) AS kinds
        FROM breaches b WHERE b.vault_id = $1
        """,
        vault_id,
    )
    breaches = [
        BreachView(id=r["id"], company=r["company"], data_kinds=tuple(r["kinds"] or ()))
        for r in brows
    ]
    return set(affected_holding_ids(holdings, breaches))


async def _exposure_for_vault(request: web.Request, ctx: Context, vault_id: str):
    reader = _reader(request)
    holdings = await reader.holdings(vault_id)
    breaches = await reader.breaches(vault_id)
    done = await reader.done_marks(vault_id)
    from ..core.projection import exposure_for

    return exposure_for(compute_exposure(holdings, breaches, done))


async def get_holding(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    vault_id = _vault_id(ctx)
    holding_id = request.match_info["id"]
    reader = _reader(request)
    holding = await reader.holding_by_id(vault_id, holding_id)
    if holding is None:
        raise not_found()
    if ctx.account.role == "contact":
        grant = await reader.grant_for_vault(vault_id)
        db_now = await request.app["db"].fetchval("SELECT now()")
        from ..core.grant_state import grant_status as gs

        status, _ = gs(grant, db_now) if grant else ("expired", 0)
        if grant is None or status != "active" or holding["level"] not in grant.levels:
            raise not_found()
    affected = await _affected_ids_on_pool(request, vault_id)
    holding["affected"] = holding["id"] in affected
    from ..core.projection import holding_for
    from ..errors import json_response

    return json_response({"holding": holding_for(ctx, holding)})


async def _affected_ids_on_pool(request: web.Request, vault_id: str) -> set[str]:
    db = request.app["db"]
    async with db.pool.acquire() as conn:
        return await _affected_ids_on(conn, vault_id)


async def patch_holding(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    vault_id = _vault_id(ctx)
    holding_id = request.match_info["id"]
    if ctx.account.role != "owner":
        raise owner_only()
    reader = _reader(request)
    writer = _writer(request)
    db = request.app["db"]

    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"version": "Send the version you loaded."})
    current = await reader.holding_by_id(vault_id, holding_id)
    if current is None:
        raise not_found()
    check_version(body, current["version"])
    reject_unknown_keys(body, HOLDING_EDITABLE_PATCH)

    company = clean_company(body.get("company", current["company"]))
    data_kind = clean_kind(body.get("data_kind", current["data_kind"]), "data_kind")
    value = clean_value(body.get("value", current["value"]))
    notes = clean_notes(body.get("notes", current["notes"]))
    company_key = match_company(company)

    from ..errors import json_response
    from ..core.projection import holding_for

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                rules = await _rules_on(conn, vault_id)
                level, rule_id = grade(rules, data_kind, company)
                await writer.update_holding(
                    conn, vault_id, holding_id, company, company_key, data_kind,
                    value, notes, level, rule_id, current["version"],
                )
                # A holding that changes kind or stops being affected loses its done marks.
                await conn.execute(
                    "DELETE FROM done_steps WHERE vault_id = $1 AND holding_id = $2",
                    vault_id, holding_id,
                )
        holding = await reader.holding_by_id(vault_id, holding_id)
        affected = await _affected_ids_on_pool(request, vault_id)
        holding["affected"] = holding["id"] in affected
        exposure = await _exposure_for_vault(request, ctx, vault_id)
        return json_response({"holding": holding_for(ctx, holding), "exposure": exposure})
    except WriteError as exc:
        if exc.code == "stale_version":
            from ..errors import stale_version

            raise stale_version()
        if exc.code == "holding_exists":
            raise holding_exists()
        raise internal_error()


async def delete_holding(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    vault_id = _vault_id(ctx)
    holding_id = request.match_info["id"]
    if ctx.account.role != "owner":
        raise owner_only()
    writer = _writer(request)
    db = request.app["db"]
    reader = _reader(request)
    if await reader.holding_by_id(vault_id, holding_id) is None:
        raise not_found()

    from ..errors import json_response

    async with db.pool.acquire() as conn:
        async with conn.transaction():
            # Delete the holding's done marks with it, in the same transaction.
            await conn.execute(
                "DELETE FROM done_steps WHERE vault_id = $1 AND holding_id = $2",
                vault_id, holding_id,
            )
            deleted = await writer.delete_holding(conn, vault_id, holding_id)
            if not deleted:
                raise not_found()
    return web.Response(status=204)
