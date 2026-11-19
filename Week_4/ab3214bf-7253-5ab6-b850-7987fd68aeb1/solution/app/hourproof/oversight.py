"""The group lead's side: site policy, verifier assignment and group scores."""

from __future__ import annotations


from .desk import Desk, User, field_errors, is_whole
from .errors import ApiError
from .jsontypes import JsonObject
from .repository import Window
from .scoring import GRAINS, matched_bp, residual_emissions
from .views import window_json

LEAD = ("lead",)
POLICY_GRAINS = ("MONTH", "WEEK", "DAY", "HOUR")
ASSIGNABLE = ("Awaiting meters", "Reconciling", "Returned")


async def set_policy(desk: Desk, user: User, site_id: str, body: JsonObject) -> JsonObject:
    if not await desk.pool.fetchval("SELECT count(*) FROM sites WHERE id = $1", site_id):
        raise ApiError("NOT_FOUND")
    if user.role not in LEAD:
        raise ApiError("FORBIDDEN")
    grain, bp = body.get("target_grain"), body.get("target_bp")
    field_errors(target_grain=grain in POLICY_GRAINS, target_bp=is_whole(bp) and 0 <= bp <= 10000)
    await desk.pool.execute("UPDATE sites SET target_grain = $2, target_bp = $3 WHERE id = $1", site_id, grain, bp)
    return {"site_id": site_id, "target_grain": grain, "target_bp": bp}


async def assign_verifier(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    firm_id = body.get("firm_id")
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=LEAD, states=ASSIGNABLE)
            field_errors(firm_id=isinstance(firm_id, str))
            if not await connection.fetchval("SELECT count(*) FROM firms WHERE id = $1", firm_id):
                raise ApiError("NOT_FOUND")
            if firm_id != window.columns["firm_id"]:
                await connection.execute(
                    "UPDATE windows SET firm_id = $2, sample_digest = NULL WHERE id = $1", window_id, firm_id
                )
                await connection.execute("DELETE FROM samples WHERE window_id = $1", window_id)
    return await desk.window_view(window_id)


async def list_firms(desk: Desk, user: User) -> JsonObject:
    if user.role not in LEAD:
        raise ApiError("FORBIDDEN")
    rows = await desk.pool.fetch("SELECT id, name FROM firms ORDER BY name")
    return {"firms": [{"id": row["id"], "name": row["name"]} for row in rows]}


async def group_scores(desk: Desk, user: User) -> JsonObject:
    if user.role not in LEAD:
        raise ApiError("FORBIDDEN")
    windows = await desk.visible_windows(user)
    ctx = desk.context()
    grains = {window.id: window.grains(ctx.now) for window in windows}
    months: dict[str, list[Window]] = {}
    for window in windows:
        if window.state != "Restated":
            months.setdefault(window.columns["month"], []).append(window)
    rollups = []
    for month in sorted(months, reverse=True):
        members = months[month]
        consumed = sum(sum(b.consumed for b in grains[d.id].by_grain["month"]) for d in members)
        scores = {}
        for grain in GRAINS:
            matched = sum(sum(b.matched for b in grains[d.id].by_grain[grain]) for d in members)
            total = sum(sum(b.consumed for b in grains[d.id].by_grain[grain]) for d in members)
            scores[f"{grain}_bp"] = matched_bp(matched, total)
        residuals = [residual_emissions(grains[d.id].by_grain["hour"], d.factors) for d in members]
        rollups.append(
            {
                "month": month,
                "window_count": len(members),
                "consumed_wh": consumed,
                "scores": scores,
                "residual_emissions_g": None if None in residuals else sum(residuals),
            }
        )
    for window in windows:
        if (
            grains[window.id].by_grain["hour"]
            and residual_emissions(grains[window.id].by_grain["hour"], window.factors) is None
        ):
            desk.schedule_factors(window.id)
    return {"windows": [window_json(window, ctx, grains[window.id]) for window in windows], "rollups": rollups}
