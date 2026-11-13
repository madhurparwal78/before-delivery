"""The followers feed and an athlete's activity list: newest first, paged by an opaque keyset cursor."""

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .. import db
from ..activity_view import ACTIVITY_SELECT, to_json
from ..cursor import decode_cursor, encode_cursor
from ..errors import not_found, validation
from ..http import authenticated, parse_id
from ..visibility import followees_of, visible_to

DEFAULT_LIMIT, MAX_LIMIT = 20, 50
FOLLOWED = f"(a.athlete_id = $1 OR a.athlete_id IN ({followees_of('$1')}))"


def page_limit(request: Request) -> int:
    raw = request.query_params.get("limit", str(DEFAULT_LIMIT))
    if not raw.isdecimal() or not 1 <= int(raw) <= MAX_LIMIT:
        raise validation({"limit": f"limit must be a whole number from 1 to {MAX_LIMIT}"})
    return int(raw)


async def activity_page(request: Request, me: dict, scope: str, scope_params: list) -> JSONResponse:
    """One page of the activities matching `scope` (SQL using $1 for the viewer and later parameters) that the viewer may see."""
    limit = page_limit(request)
    params = [me["id"], *scope_params]
    where = f"{scope} AND {visible_to('$1')}"
    cursor = request.query_params.get("cursor")
    if cursor:
        params += decode_cursor(cursor)
        where += f" AND (a.start_time, a.id) < (${len(params) - 1}, ${len(params)})"
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(f"{ACTIVITY_SELECT} WHERE {where} ORDER BY a.start_time DESC, a.id DESC LIMIT {limit + 1}",
                                *params)
        page = rows[:limit]
        items = await to_json(conn, page, me["id"], with_route=True)
    more = len(rows) > limit
    return JSONResponse({"activities": items,
                         "next_cursor": encode_cursor(page[-1]["start_time"], page[-1]["id"]) if more else None})


@authenticated
async def feed(request: Request, me: dict) -> JSONResponse:
    return await activity_page(request, me, FOLLOWED, [])


@authenticated
async def athlete_activities(request: Request, me: dict) -> JSONResponse:
    athlete_id = parse_id(request.path_params["athlete_id"])
    if not await db.pool.fetchval("SELECT EXISTS (SELECT 1 FROM athletes WHERE id = $1)", athlete_id):
        raise not_found()
    return await activity_page(request, me, "a.athlete_id = $2", [athlete_id])


routes = [
    Route("/api/feed", feed, methods=["GET"]),
    Route("/api/athletes/{athlete_id}/activities", athlete_activities, methods=["GET"]),
]
