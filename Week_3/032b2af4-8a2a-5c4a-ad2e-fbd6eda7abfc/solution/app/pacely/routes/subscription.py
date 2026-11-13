"""The plan catalogue and the 30-day trial."""

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import db
from ..errors import validation
from ..http import authenticated, read_json
from ..plans import PLANS, billing_allowed, trial_end


@authenticated
async def list_plans(request: Request, me: dict) -> JSONResponse:
    return JSONResponse({"plans": PLANS})


@authenticated
async def start_trial(request: Request, me: dict) -> JSONResponse:
    body = await read_json(request)
    plan, billing = body.get("plan"), body.get("billing")
    if not isinstance(plan, str) or not isinstance(billing, str) or not billing_allowed(plan, billing):
        raise validation({"plan": "choose individual (annual or monthly), family (annual) or student (annual)"})
    ends = trial_end()
    async with db.pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "INSERT INTO subscriptions (athlete_id, plan, billing, status, trial_ends_on)"
            " VALUES ($1, $2, $3, 'trialing', $4) ON CONFLICT (athlete_id)"
            " DO UPDATE SET plan = $2, billing = $3, status = 'trialing', trial_ends_on = $4",
            me["id"], plan, billing, ends)
        await conn.execute("UPDATE athletes SET plan = $2 WHERE id = $1", me["id"], plan)
    return JSONResponse({"plan": plan, "billing": billing, "status": "trialing", "trial_ends_on": ends.isoformat()},
                        status_code=201)


@authenticated
async def cancel_subscription(request: Request, me: dict) -> Response:
    async with db.pool.acquire() as conn, conn.transaction():
        await conn.execute("DELETE FROM subscriptions WHERE athlete_id = $1", me["id"])
        await conn.execute("UPDATE athletes SET plan = 'free' WHERE id = $1", me["id"])
    return Response(status_code=204)


routes = [
    Route("/api/plans", list_plans, methods=["GET"]),
    Route("/api/subscription", start_trial, methods=["POST"]),
    Route("/api/subscription", cancel_subscription, methods=["DELETE"]),
]
