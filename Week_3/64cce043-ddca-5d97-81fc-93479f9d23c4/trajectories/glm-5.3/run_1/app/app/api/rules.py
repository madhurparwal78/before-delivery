"""Grading rule routes: list, create, edit, delete, order and preview."""

from __future__ import annotations

import asyncio
from typing import Any

from aiohttp import web

from ..auth.store import Context, new_id
from ..core.exposure import BreachView, HoldingView, compute_exposure
from ..core.grading import GradingRule, grade
from ..core.vault_writer import VaultWriter, WriteError, regrade_holdings
from ..domain import KINDS, LEVELS, LEVEL_ORDER, match_company
from ..errors import (
    ApiError,
    internal_error,
    json_response,
    not_found,
    owner_only,
    rule_limit,
    stale_version,
    validation,
    MSG_RULE_LIST,
)
from ..db.base import emit_notification
from .boundary import read_json_body
from ..core.validation import (
    clean_company_contains,
    clean_kind,
    clean_level,
    clean_priority,
    reject_unknown_keys,
)
from ..core.versions import check_version
from .holdings import _affected_ids_on, _exposure_for_vault, _rules_on

RULE_EDITABLE_POST = {"data_kind", "company_contains", "level", "priority"}
RULE_EDITABLE_PATCH = {"data_kind", "company_contains", "level", "priority", "version"}


def _ctx(request: web.Request) -> Context:
    return request["ctx"]


def _vault_id(ctx: Context) -> str:
    if ctx.account.vault_id is None:
        raise not_found()
    return ctx.account.vault_id


async def list_rules(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    reader = request.app["reader"]
    rules = await reader.rules(vault_id)
    from ..core.projection import rule_for

    return json_response({"rules": [rule_for(r) for r in rules]})


def _clean_rule_body(body: dict, for_patch: bool, next_priority: int | None = None) -> dict:
    """Validate the editable rule fields; unknown keys answer 422."""
    data: dict[str, Any] = {}
    kind = clean_kind(body.get("data_kind"), "data_kind")
    data["data_kind"] = kind
    data["company_contains"] = clean_company_contains(body.get("company_contains"))
    data["level"] = clean_level(body.get("level"))
    if body.get("priority") is not None:
        data["priority"] = clean_priority(body.get("priority"))
    elif not for_patch:
        # priority defaults to one more than the highest, decided by the writer.
        data["priority"] = None
    return data


async def create_rule(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"data_kind": "Required."})
    reject_unknown_keys(body, RULE_EDITABLE_POST)
    if "data_kind" not in body or body.get("data_kind") is None:
        raise validation({"data_kind": "Required."})
    kind_raw = body.get("data_kind")
    if not isinstance(kind_raw, str):
        raise validation({"data_kind": "Choose a data kind from the list."})
    if kind_raw != "any" and kind_raw not in KINDS:
        raise validation({"data_kind": "Choose a data kind from the list."})
    data_kind = kind_raw
    company_contains = clean_company_contains(body.get("company_contains"))
    level = clean_level(body.get("level"))
    priority = clean_priority(body["priority"]) if body.get("priority") is not None else None
    writer: VaultWriter = request.app["writer"]
    db = request.app["db"]
    rule_id = new_id("rule")

    from ..core.projection import rule_for

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                # Serialize concurrent adds on the vault row so the 50-rule limit holds.
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", vault_id)
                if priority is None:
                    priority = await writer.next_priority(conn, vault_id)
                await writer.create_rule(
                    conn, vault_id, rule_id, priority, data_kind, company_contains, level
                )
                rules = await _rules_on(conn, vault_id)
                await regrade_holdings(conn, vault_id, rules)
                row = await conn.fetchrow(
                    "SELECT id, priority, data_kind, company_contains, level, version, created_at FROM rules WHERE id = $1",
                    rule_id,
                )
                rule = GradingRule(
                    id=row["id"], priority=row["priority"], data_kind=row["data_kind"],
                    company_contains=row["company_contains"], level=row["level"],
                    version=row["version"], created_at=row["created_at"].isoformat(),
                )
        exposure = await _exposure_for_vault(request, ctx, vault_id)
        return json_response({"rule": rule_for(rule), "exposure": exposure}, status=201)
    except WriteError as exc:
        if exc.code == "rule_limit":
            raise rule_limit()
        raise internal_error()


async def patch_rule(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    rule_id = request.match_info["id"]
    reader = request.app["reader"]
    writer: VaultWriter = request.app["writer"]
    db = request.app["db"]

    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"version": "Send the version you loaded."})
    current = await reader.rule_by_id(vault_id, rule_id)
    if current is None:
        raise not_found()
    check_version(body, current.version)
    reject_unknown_keys(body, RULE_EDITABLE_PATCH)
    kind = None
    if "data_kind" in body:
        kind_raw = body.get("data_kind")
        if not isinstance(kind_raw, str) or (kind_raw != "any" and kind_raw not in KINDS):
            raise validation({"data_kind": "Choose a data kind from the list."})
        kind = kind_raw
    contains = clean_company_contains(body.get("company_contains")) if "company_contains" in body else None
    level = clean_level(body.get("level")) if "level" in body else None
    priority = None
    if "priority" in body and body.get("priority") is not None:
        priority = clean_priority(body.get("priority"))

    from ..core.projection import rule_for

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", vault_id)
                new_version = await writer.update_rule(
                    conn, vault_id, rule_id, priority, kind, contains, level, current.version
                )
                rules = await _rules_on(conn, vault_id)
                await regrade_holdings(conn, vault_id, rules)
        rule = await reader.rule_by_id(vault_id, rule_id)
        exposure = await _exposure_for_vault(request, ctx, vault_id)
        return json_response({"rule": rule_for(rule), "exposure": exposure})
    except WriteError as exc:
        if exc.code == "stale_version":
            raise stale_version()
        if exc.code == "not_found":
            raise not_found()
        raise internal_error()


async def delete_rule(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    rule_id = request.match_info["id"]
    writer: VaultWriter = request.app["writer"]
    db = request.app["db"]
    reader = request.app["reader"]
    if await reader.rule_by_id(vault_id, rule_id) is None:
        raise not_found()

    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", vault_id)
            deleted = await writer.delete_rule(conn, vault_id, rule_id)
            if not deleted:
                raise not_found()
            rules = await _rules_on(conn, vault_id)
            await regrade_holdings(conn, vault_id, rules)
    return web.Response(status=204)


async def _rule_ids_field(rule_ids: Any) -> list[str]:
    if not isinstance(rule_ids, list):
        raise validation({"rule_ids": MSG_RULE_LIST})
    for rid in rule_ids:
        if not isinstance(rid, str):
            raise validation({"rule_ids": MSG_RULE_LIST})
    return list(rule_ids)


async def put_rule_order(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"rule_ids": MSG_RULE_LIST})
    reject_unknown_keys(body, {"rule_ids"})
    rule_ids = await _rule_ids_field(body.get("rule_ids"))

    writer: VaultWriter = request.app["writer"]
    db = request.app["db"]
    reader = request.app["reader"]

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", vault_id)
                await writer.reorder_rules(conn, vault_id, rule_ids)
                rules = await _rules_on(conn, vault_id)
                await regrade_holdings(conn, vault_id, rules)
        rules = await reader.rules(vault_id)
        from ..core.projection import rule_for

        exposure = await _exposure_for_vault(request, ctx, vault_id)
        return json_response(
            {"rules": [rule_for(r) for r in rules], "exposure": exposure}
        )
    except WriteError as exc:
        if exc.code == "rule_ids":
            raise validation({"rule_ids": MSG_RULE_LIST})
        raise internal_error()


async def post_rule_preview(request: web.Request) -> web.Response:
    """The levels and score an order would give, without storing anything."""
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"rule_ids": MSG_RULE_LIST})
    reject_unknown_keys(body, {"rule_ids"})
    rule_ids = await _rule_ids_field(body.get("rule_ids"))

    db = request.app["db"]
    reader = request.app["reader"]
    current_rules = await reader.rules(vault_id)
    current_ids = {r.id for r in current_rules}
    if len(rule_ids) != len(current_ids) or set(rule_ids) != current_ids or len(set(rule_ids)) != len(rule_ids):
        raise validation({"rule_ids": MSG_RULE_LIST})

    # Apply the candidate order and grade every holding with it.
    by_id = {r.id: r for r in current_rules}
    ordered = [by_id[rid] for rid in rule_ids]
    rows = await db.fetch(
        "SELECT id, data_kind, company, level, created_at FROM holdings WHERE vault_id = $1", vault_id
    )
    levels: list[dict[str, Any]] = []
    from ..domain import KIND_LIST

    kind_order = {k.code: i for i, k in enumerate(KIND_LIST)}
    rows = sorted(
        rows,
        key=lambda r: (match_company(r["company"]), kind_order.get(r["data_kind"], 99), r["created_at"]),
    )
    for row in rows:
        level, _rule_id = grade(ordered, row["data_kind"], row["company"])
        levels.append({"holding_id": row["id"], "level": level})

    # Score with the previewed levels applied.
    level_map = {l["holding_id"]: l["level"] for l in levels}
    preview_holdings = [
        HoldingView(id=r["id"], company=r["company"], data_kind=r["data_kind"], level=level_map[r["id"]])
        for r in rows
    ]
    breaches = await reader.breaches(vault_id)
    done = await reader.done_marks(vault_id)
    exposure = compute_exposure(preview_holdings, breaches, done)
    return json_response({"levels": levels, "score": exposure.score})
