"""Follows, follow requests, athlete profiles, kudos and comments."""

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import db
from ..activity_view import owner_of_visible
from ..errors import ApiError, forbidden, not_found, validation
from ..http import authenticated, iso, parse_id, read_json, text_field


async def _athlete_or_404(request: Request) -> dict:
    row = await db.pool.fetchrow("SELECT id, name, private FROM athletes WHERE id = $1",
                                 parse_id(request.path_params["athlete_id"]))
    if row is None:
        raise not_found()
    return dict(row)


@authenticated
async def follow(request: Request, me: dict) -> JSONResponse:
    target = await _athlete_or_404(request)
    if target["id"] == me["id"]:
        raise ApiError(400, "cannot_follow_self")
    status = "pending" if target["private"] else "accepted"
    created = await db.pool.fetchval(
        "INSERT INTO follows (follower_id, followee_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
        me["id"], target["id"], status)
    if created is None:
        status = await db.pool.fetchval("SELECT status FROM follows WHERE follower_id = $1 AND followee_id = $2",
                                        me["id"], target["id"])
    return JSONResponse({"status": status}, status_code=201 if created else 200)


@authenticated
async def unfollow(request: Request, me: dict) -> Response:
    target = await _athlete_or_404(request)
    await db.pool.execute("DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2", me["id"], target["id"])
    return Response(status_code=204)


@authenticated
async def list_requests(request: Request, me: dict) -> JSONResponse:
    rows = await db.pool.fetch(
        "SELECT f.id, f.follower_id, a.name AS follower_name FROM follows f JOIN athletes a ON a.id = f.follower_id"
        " WHERE f.followee_id = $1 AND f.status = 'pending' ORDER BY f.id", me["id"])
    return JSONResponse({"requests": [dict(r) for r in rows]})


async def _decide(request: Request, me: dict, sql: str, status: str) -> JSONResponse:
    """Settle a pending follow request addressed to the caller in one statement; anyone else is refused."""
    request_id = parse_id(request.path_params["request_id"])
    if await db.pool.fetchval(sql, request_id, me["id"]) is None:
        if await db.pool.fetchval("SELECT EXISTS (SELECT 1 FROM follows WHERE id = $1 AND status = 'pending')", request_id):
            raise forbidden()
        raise not_found()
    return JSONResponse({"status": status})


@authenticated
async def approve_request(request: Request, me: dict) -> JSONResponse:
    return await _decide(request, me, "UPDATE follows SET status = 'accepted' WHERE id = $1 AND followee_id = $2"
                         " AND status = 'pending' RETURNING id", "accepted")


@authenticated
async def reject_request(request: Request, me: dict) -> JSONResponse:
    return await _decide(request, me, "DELETE FROM follows WHERE id = $1 AND followee_id = $2 AND status = 'pending'"
                         " RETURNING id", "rejected")


@authenticated
async def read_athlete(request: Request, me: dict) -> JSONResponse:
    row = await db.pool.fetchrow(
        "SELECT a.id, a.name, a.private,"
        " (SELECT count(*) FROM follows WHERE followee_id = a.id AND status = 'accepted') AS follower_count,"
        " (SELECT count(*) FROM follows WHERE follower_id = a.id AND status = 'accepted') AS following_count,"
        " (SELECT status FROM follows WHERE follower_id = $1 AND followee_id = a.id) AS follow_status"
        " FROM athletes a WHERE a.id = $2", me["id"], parse_id(request.path_params["athlete_id"]))
    if row is None:
        raise not_found()
    status = "self" if row["id"] == me["id"] else row["follow_status"] or "none"
    return JSONResponse({"id": row["id"], "name": row["name"], "private": row["private"],
                         "follower_count": row["follower_count"], "following_count": row["following_count"],
                         "follow_status": status})


async def _visible_owner(request: Request, me: dict) -> tuple[int, int]:
    activity_id = parse_id(request.path_params["activity_id"])
    owner = await owner_of_visible(db.pool, activity_id, me["id"])
    if owner is None:
        raise not_found()
    return activity_id, owner


@authenticated
async def give_kudos(request: Request, me: dict) -> JSONResponse:
    activity_id, owner = await _visible_owner(request, me)
    if owner == me["id"]:
        raise ApiError(422, "cannot_kudo_own_activity")
    created = await db.pool.fetchval(
        "INSERT INTO kudos (athlete_id, activity_id) VALUES ($1, $2) ON CONFLICT (athlete_id, activity_id) DO NOTHING"
        " RETURNING id", me["id"], activity_id)
    count = await db.pool.fetchval("SELECT count(*) FROM kudos WHERE activity_id = $1", activity_id)
    return JSONResponse({"kudos_count": count}, status_code=201 if created else 200)


@authenticated
async def take_back_kudos(request: Request, me: dict) -> Response:
    activity_id, _ = await _visible_owner(request, me)
    await db.pool.execute("DELETE FROM kudos WHERE athlete_id = $1 AND activity_id = $2", me["id"], activity_id)
    return Response(status_code=204)


@authenticated
async def list_kudos(request: Request, me: dict) -> JSONResponse:
    activity_id, _ = await _visible_owner(request, me)
    rows = await db.pool.fetch(
        "SELECT a.id, a.name FROM kudos k JOIN athletes a ON a.id = k.athlete_id WHERE k.activity_id = $1"
        " ORDER BY k.created_at, k.id", activity_id)
    return JSONResponse({"athletes": [dict(r) for r in rows]})


def comment_json(row) -> dict:
    return {"id": row["id"], "athlete_id": row["athlete_id"], "athlete_name": row["athlete_name"],
            "text": row["text"], "created_at": iso(row["created_at"])}


@authenticated
async def list_comments(request: Request, me: dict) -> JSONResponse:
    activity_id, _ = await _visible_owner(request, me)
    rows = await db.pool.fetch(
        "SELECT c.id, c.author_id AS athlete_id, a.name AS athlete_name, c.text, c.created_at FROM comments c"
        " JOIN athletes a ON a.id = c.author_id WHERE c.activity_id = $1 ORDER BY c.created_at, c.id", activity_id)
    return JSONResponse({"comments": [comment_json(r) for r in rows]})


@authenticated
async def post_comment(request: Request, me: dict) -> JSONResponse:
    activity_id, _ = await _visible_owner(request, me)
    fields: dict[str, str] = {}
    text = text_field(await read_json(request), "text", 1, 500, fields)
    if fields:
        raise validation(fields)
    row = await db.pool.fetchrow(
        "INSERT INTO comments (activity_id, author_id, text) VALUES ($1, $2, $3)"
        " RETURNING id, author_id AS athlete_id, $4::text AS athlete_name, text, created_at",
        activity_id, me["id"], text, me["name"])
    return JSONResponse(comment_json(row), status_code=201)


@authenticated
async def delete_comment(request: Request, me: dict) -> Response:
    row = await db.pool.fetchrow("SELECT id, activity_id, author_id FROM comments WHERE id = $1",
                                 parse_id(request.path_params["comment_id"]))
    if row is None:
        raise not_found()
    owner = await owner_of_visible(db.pool, row["activity_id"], me["id"])
    if owner is None:
        raise not_found()
    if me["id"] not in (row["author_id"], owner):
        raise forbidden()
    await db.pool.execute("DELETE FROM comments WHERE id = $1", row["id"])
    return Response(status_code=204)


routes = [
    Route("/api/athletes/{athlete_id}/follow", follow, methods=["POST"]),
    Route("/api/athletes/{athlete_id}/follow", unfollow, methods=["DELETE"]),
    Route("/api/follow-requests", list_requests, methods=["GET"]),
    Route("/api/follow-requests/{request_id}/approve", approve_request, methods=["POST"]),
    Route("/api/follow-requests/{request_id}/reject", reject_request, methods=["POST"]),
    Route("/api/athletes/{athlete_id}", read_athlete, methods=["GET"]),
    Route("/api/activities/{activity_id}/kudos", give_kudos, methods=["POST"]),
    Route("/api/activities/{activity_id}/kudos", take_back_kudos, methods=["DELETE"]),
    Route("/api/activities/{activity_id}/kudos", list_kudos, methods=["GET"]),
    Route("/api/activities/{activity_id}/comments", list_comments, methods=["GET"]),
    Route("/api/activities/{activity_id}/comments", post_comment, methods=["POST"]),
    Route("/api/comments/{comment_id}", delete_comment, methods=["DELETE"]),
]
