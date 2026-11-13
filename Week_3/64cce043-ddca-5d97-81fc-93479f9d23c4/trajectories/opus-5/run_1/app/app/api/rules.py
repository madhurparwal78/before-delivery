"""Grading rules: the owner's published order and its preview."""
from __future__ import annotations

from dataclasses import replace

import asyncpg

from starlette.responses import Response

from ..config import RULE_LIMIT
from ..db import new_id
from ..domain.exposure import compute
from ..domain.projection import rule_json
from ..domain.records import GradingRule
from ..errors import ApiError, json_response
from ..store import load_breaches, load_done_marks, load_holdings, load_rules, load_view
from ..validate import Fields
from .base import Ctx

EDITABLE_POST = ("data_kind", "company_contains", "level", "priority")
EDITABLE_PATCH = EDITABLE_POST + ("version",)
MAX_PRIORITY = 999


async def list_rules(ctx: Ctx) -> Response:
    return json_response({"rules": [rule_json(rule) for rule in ctx.vault_view().rules]})


async def create_rule(ctx: Ctx) -> Response:
    async with ctx.db.transaction() as connection:
        await _lock_vault(ctx, connection)
        used = await connection.fetchval(
            "select count(*) from grading_rules where vault_id = $1", ctx.vault_id
        )
        if used >= RULE_LIMIT:
            raise ApiError("rule_limit")

        fields = Fields(ctx.body, EDITABLE_POST)
        data_kind = fields.data_kind(required=True, allow_any=True)
        company_contains = fields.text("company_contains", required=False, max_length=60)
        level = fields.level(required=True)
        priority = fields.priority()
        fields.done()
        if priority is None:
            highest = await connection.fetchval(
                "select coalesce(max(priority), 0) from grading_rules where vault_id = $1",
                ctx.vault_id,
            )
            priority = min(highest + 1, MAX_PRIORITY)

        rule_id = new_id()
        await connection.execute(
            """insert into grading_rules
                   (id, vault_id, priority, data_kind, company_contains, level)
               values ($1, $2, $3, $4, $5, $6)""",
            rule_id,
            ctx.vault_id,
            priority,
            data_kind,
            company_contains,
            level,
        )
        view = await load_view(connection, ctx.vault_id)
        await ctx.db.notify(connection, ctx.vault_id, "rule.created", rule_id)
    rule = next(rule for rule in view.rules if rule.id == rule_id)
    return json_response(
        {"rule": rule_json(rule), "exposure": view.exposure_json()}, status_code=201
    )


async def update_rule(ctx: Ctx) -> Response:
    current: GradingRule = ctx.target
    fields = Fields(ctx.body, EDITABLE_PATCH)
    version = fields.version()

    async with ctx.db.transaction() as connection:
        stored = await connection.fetchrow(
            "select version from grading_rules where id = $1 and vault_id = $2 for update",
            current.id,
            ctx.vault_id,
        )
        if stored is None:
            raise ApiError("not_found")
        if version and version != stored["version"]:
            raise ApiError("stale_version")
        data_kind = (
            fields.data_kind(required=True, allow_any=True)
            if fields.has("data_kind")
            else current.data_kind
        )
        company_contains = (
            fields.text("company_contains", required=False, max_length=60)
            if fields.has("company_contains")
            else current.company_contains
        )
        level = fields.level(required=True) if fields.has("level") else current.level
        priority = fields.priority(default=current.priority)
        fields.done()

        await connection.execute(
            """update grading_rules
               set data_kind = $3, company_contains = $4, level = $5, priority = $6,
                   version = version + 1
               where id = $1 and vault_id = $2""",
            current.id,
            ctx.vault_id,
            data_kind,
            company_contains,
            level,
            priority,
        )
        view = await load_view(connection, ctx.vault_id)
        await ctx.db.notify(connection, ctx.vault_id, "rule.updated", current.id)
    rule = next(rule for rule in view.rules if rule.id == current.id)
    return json_response({"rule": rule_json(rule), "exposure": view.exposure_json()})


async def delete_rule(ctx: Ctx) -> Response:
    rule: GradingRule = ctx.target
    async with ctx.db.transaction() as connection:
        deleted = await connection.fetchval(
            "delete from grading_rules where id = $1 and vault_id = $2 returning id",
            rule.id,
            ctx.vault_id,
        )
        if deleted is None:
            raise ApiError("not_found")
        await ctx.db.notify(connection, ctx.vault_id, "rule.deleted", rule.id)
    return Response(status_code=204)


async def reorder_rules(ctx: Ctx) -> Response:
    async with ctx.db.transaction() as connection:
        await _lock_vault(ctx, connection)
        current = await load_rules(connection, ctx.vault_id)
        fields = Fields(ctx.body, ("rule_ids",))
        order = fields.rule_ids([rule.id for rule in current])
        fields.done()

        priorities = {rule.id: rule.priority for rule in current}
        changed = [
            rule_id
            for position, rule_id in enumerate(order, start=1)
            if priorities[rule_id] != position
        ]
        for position, rule_id in enumerate(order, start=1):
            if priorities[rule_id] == position:
                continue
            await connection.execute(
                """update grading_rules set priority = $3, version = version + 1
                   where id = $1 and vault_id = $2""",
                rule_id,
                ctx.vault_id,
                position,
            )
        view = await load_view(connection, ctx.vault_id)
        for rule_id in changed:
            await ctx.db.notify(connection, ctx.vault_id, "rule.updated", rule_id)
    return json_response(
        {"rules": [rule_json(rule) for rule in view.rules], "exposure": view.exposure_json()}
    )


async def preview_rules(ctx: Ctx) -> Response:
    """The levels and score an order would give. Nothing is stored."""
    async with ctx.db.pool.acquire() as connection:
        current = await load_rules(connection, ctx.vault_id)
        fields = Fields(ctx.body, ("rule_ids",))
        order = fields.rule_ids([rule.id for rule in current])
        fields.done()
        by_id = {rule.id: rule for rule in current}
        reordered = [
            replace(by_id[rule_id], priority=position)
            for position, rule_id in enumerate(order, start=1)
        ]
        view = compute(
            ctx.vault_id,
            await load_holdings(connection, ctx.vault_id),
            reordered,
            await load_breaches(connection, ctx.vault_id),
            await load_done_marks(connection, ctx.vault_id),
        )
    return json_response(
        {
            "levels": [
                {"holding_id": holding.id, "level": view.levels[holding.id]}
                for holding in view.holdings
            ],
            "score": view.score,
        }
    )


async def _lock_vault(ctx: Ctx, connection: asyncpg.Connection) -> None:
    """Serialise the vault's rule writes, so the 50-rule limit and the order hold."""
    await connection.execute("select id from vaults where id = $1 for update", ctx.vault_id)
