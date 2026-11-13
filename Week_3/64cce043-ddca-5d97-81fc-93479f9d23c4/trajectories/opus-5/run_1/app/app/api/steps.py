"""Next steps: marking them done and reopening them."""
from __future__ import annotations

from starlette.responses import Response

from ..domain.exposure import NextStep
from ..domain.steps import StepConflict, plan_done, plan_reopen
from ..errors import ApiError, json_response
from ..store import load_view
from .base import Ctx


async def mark_done(ctx: Ctx) -> Response:
    return await _toggle(ctx, done=True)


async def reopen(ctx: Ctx) -> Response:
    return await _toggle(ctx, done=False)


async def _toggle(ctx: Ctx, done: bool) -> Response:
    step: NextStep = ctx.target
    async with ctx.db.transaction() as connection:
        # The vault row serialises simultaneous toggles, so exactly one of them wins.
        await connection.execute(
            "select id from vaults where id = $1 for update", ctx.vault_id
        )
        view = await load_view(connection, ctx.vault_id)
        current = view.step(step.id)
        if current is None:
            raise ApiError("not_found")
        try:
            changed = plan_done(view, current) if done else plan_reopen(view, current)
        except StepConflict as conflict:
            raise ApiError(conflict.code) from conflict

        if done:
            await connection.executemany(
                "insert into step_done (vault_id, step_id) values ($1, $2)",
                [(ctx.vault_id, step_id) for step_id in changed],
            )
        else:
            await connection.execute(
                "delete from step_done where vault_id = $1 and step_id = any($2::text[])",
                ctx.vault_id,
                changed,
            )
        updated = await load_view(connection, ctx.vault_id)
        for step_id in changed:
            await ctx.db.notify(connection, ctx.vault_id, "step.updated", step_id)
    answered = updated.step(step.id)
    assert answered is not None
    return json_response({"step": answered.as_json(), "exposure": updated.exposure_json()})
