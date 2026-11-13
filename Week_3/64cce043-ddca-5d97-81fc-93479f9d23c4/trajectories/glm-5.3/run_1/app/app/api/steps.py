"""Next steps: marking done, reopening, and the exposure score."""

from __future__ import annotations

import asyncio
from typing import Optional

import asyncpg
from aiohttp import web

from ..auth.store import Context
from ..core.exposure import (
    BreachView,
    HoldingView,
    Step,
    compute_exposure,
    affected_holding_ids,
)
from ..domain import KINDS, PERSON_LEVEL_STEP_TEXTS
from ..errors import (
    json_response,
    not_found,
    owner_only,
    step_already_done,
    step_already_open,
    step_out_of_order,
    validation,
)
from ..db.base import emit_notification
from .boundary import read_json_body
from .holdings import _exposure_for_vault


def _ctx(request: web.Request) -> Context:
    return request["ctx"]


def _vault_id(ctx: Context) -> str:
    if ctx.account.vault_id is None:
        raise not_found()
    return ctx.account.vault_id


async def _step_by_id(request: web.Request, vault_id: str, step_id: str) -> Optional[Step]:
    """Rebuild the step list and find the step with the given id."""
    reader = request.app["reader"]
    holdings = await reader.holdings(vault_id)
    breaches = await reader.breaches(vault_id)
    done = await reader.done_marks(vault_id)
    exposure = compute_exposure(holdings, breaches, done)
    for step in exposure.steps:
        if step.id == step_id:
            return step
    return None


def _same_holding_step(step: Step, exposure_steps: list[Step]) -> Optional[Step]:
    for other in exposure_steps:
        if (
            other.holding_id == step.holding_id
            and other.number != step.number
            and other.text not in PERSON_LEVEL_STEP_TEXTS
            and step.text not in PERSON_LEVEL_STEP_TEXTS
            and other.company == step.company
        ):
            return other
    return None


async def post_step_done(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    step_id = request.match_info["id"]
    await read_json_body(request)
    db = request.app["db"]
    writer = request.app["writer"]

    # Serialize identical requests; exactly one of them succeeds.
    lock_key = f"step:{vault_id}:{step_id}"
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", lock_key)
            step = await _step_by_id_conn(conn, vault_id, step_id)
            if step is None:
                raise not_found()
            if step.status == "done":
                raise step_already_done()
            # When both steps of a holding are holding-level, step 2 needs step 1 done.
            if step.text not in PERSON_LEVEL_STEP_TEXTS and step.number == 2:
                other = await _holding_step_1(conn, vault_id, step)
                if other is not None and other.status == "open":
                    raise step_out_of_order()
            await conn.execute(
                """
                INSERT INTO done_steps (id, vault_id, holding_id, step_key, number, done)
                VALUES ($1, $2, $3, $4, $5, true)
                ON CONFLICT (id) DO UPDATE SET done = true
                """,
                step.id, vault_id, step.holding_id, step.id.rsplit(":", 1)[0], step.number,
            )
            await emit_notification(conn, vault_id, "step.updated", step.id)
    exposure = await _exposure_for_vault(request, ctx, vault_id)
    from ..core.projection import step_for

    step_now = await _step_by_id(request, vault_id, step_id)
    return json_response({"step": step_for(step_now), "exposure": exposure})


async def _step_by_id_conn(conn, vault_id: str, step_id: str) -> Optional[Step]:
    reader = _ReaderOnConn(conn)
    holdings = await reader.holdings(vault_id)
    breaches = await reader.breaches(vault_id)
    done = await reader.done_marks(vault_id)
    exposure = compute_exposure(holdings, breaches, done)
    for step in exposure.steps:
        if step.id == step_id:
            return step
    return None


class _ReaderOnConn:
    def __init__(self, conn) -> None:
        self.conn = conn

    async def holdings(self, vault_id: str) -> list[HoldingView]:
        rows = await self.conn.fetch(
            "SELECT id, company, data_kind, level, created_at FROM holdings WHERE vault_id = $1",
            vault_id,
        )
        return [
            HoldingView(
                id=r["id"], company=r["company"], data_kind=r["data_kind"],
                level=r["level"], created_at=r["created_at"].isoformat(),
            )
            for r in rows
        ]

    async def breaches(self, vault_id: str) -> list[BreachView]:
        rows = await self.conn.fetch(
            """
            SELECT b.id, b.company,
                   (SELECT array_agg(bk.data_kind) FROM breach_kinds bk WHERE bk.breach_id = b.id) AS kinds
            FROM breaches b WHERE b.vault_id = $1
            """,
            vault_id,
        )
        return [BreachView(id=r["id"], company=r["company"], data_kinds=tuple(r["kinds"] or ())) for r in rows]

    async def done_marks(self, vault_id: str) -> dict[str, bool]:
        rows = await self.conn.fetch(
            "SELECT id, done FROM done_steps WHERE vault_id = $1", vault_id
        )
        return {r["id"]: r["done"] for r in rows}


async def _holding_step_1(conn, vault_id: str, step: Step) -> Optional[Step]:
    exposure_steps = await _steps_on_conn(conn, vault_id)
    for other in exposure_steps:
        if (
            other.holding_id == step.holding_id
            and other.number == 1
            and other.text not in PERSON_LEVEL_STEP_TEXTS
        ):
            return other
    return None


async def _steps_on_conn(conn, vault_id: str) -> list[Step]:
    reader = _ReaderOnConn(conn)
    holdings = await reader.holdings(vault_id)
    breaches = await reader.breaches(vault_id)
    done = await reader.done_marks(vault_id)
    exposure = compute_exposure(holdings, breaches, done)
    return exposure.steps


async def post_step_reopen(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    step_id = request.match_info["id"]
    await read_json_body(request)
    db = request.app["db"]

    lock_key = f"step:{vault_id}:{step_id}"
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", lock_key)
            step = await _step_by_id_conn(conn, vault_id, step_id)
            if step is None:
                raise not_found()
            if step.status == "open":
                raise step_already_open()
            reopened: list[Step] = []
            # Reopening step 1 also reopens a done step 2 of the same holding.
            if step.number == 1 and step.text not in PERSON_LEVEL_STEP_TEXTS:
                steps = await _steps_on_conn(conn, vault_id)
                for other in steps:
                    if (
                        other.holding_id == step.holding_id
                        and other.number == 2
                        and other.status == "done"
                        and other.text not in PERSON_LEVEL_STEP_TEXTS
                    ):
                        await conn.execute(
                            "UPDATE done_steps SET done = false WHERE vault_id = $1 AND id = $2",
                            vault_id, other.id,
                        )
                        await emit_notification(conn, vault_id, "step.updated", other.id)
                        reopened.append(other)
            await conn.execute(
                "UPDATE done_steps SET done = false WHERE vault_id = $1 AND id = $2",
                vault_id, step.id,
            )
            await emit_notification(conn, vault_id, "step.updated", step.id)
    exposure = await _exposure_for_vault(request, ctx, vault_id)
    from ..core.projection import step_for

    step_now = await _step_by_id(request, vault_id, step_id)
    return json_response({"step": step_for(step_now), "exposure": exposure})


async def get_exposure(request: web.Request) -> web.Response:
    """The caller's whole-scope exposure, whatever the filters."""
    ctx = _ctx(request)
    vault_id = _vault_id(ctx)
    exposure = await _exposure_for_vault(request, ctx, vault_id)
    return json_response(exposure)
