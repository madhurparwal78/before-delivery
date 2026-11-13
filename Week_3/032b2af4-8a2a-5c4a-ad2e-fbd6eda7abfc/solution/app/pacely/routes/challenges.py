"""Monthly challenges: progress, completion and trophies are computed on read from the athlete's activities."""

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import db
from ..calendar import month_window
from ..errors import not_found
from ..http import authenticated, iso, parse_id

MEASURE = {"distance": "distance_m", "single_distance": "distance_m", "elevation": "elevation_gain_m",
           "moving_time": "moving_time_s"}


def progress_of(challenge, activities: list) -> tuple[int, str | None]:
    """(progress, completed_at) from the athlete's activities of the window in start-time order."""
    column = MEASURE[challenge["dimension"]]
    total, reached = 0, None
    for a in activities:
        if a["sport_type"] not in challenge["sport_types"]:
            continue
        total = max(total, a[column]) if challenge["dimension"] == "single_distance" else total + a[column]
        if reached is None and total >= challenge["goal"]:
            reached = a["start_time"]
    return total, reached


def challenge_json(challenge, window, joined: bool, activities: list) -> dict:
    progress, reached = progress_of(challenge, activities) if joined else (0, None)
    return {"id": challenge["id"], "name": challenge["name"], "sport_types": list(challenge["sport_types"]),
            "dimension": challenge["dimension"], "goal": challenge["goal"], "starts_at": iso(window[0]),
            "ends_at": iso(window[1]), "joined": joined, "progress": progress, "completed": reached is not None,
            "completed_at": None if reached is None else iso(reached)}


async def challenges_for(athlete_id: int, zone: str) -> list[dict]:
    window = month_window(zone)
    challenges = await db.pool.fetch("SELECT id, name, sport_types, dimension, goal FROM challenges ORDER BY id")
    joined = {r["challenge_id"] for r in await db.pool.fetch(
        "SELECT challenge_id FROM challenge_participants WHERE athlete_id = $1", athlete_id)}
    activities = await db.pool.fetch(
        "SELECT start_time, sport_type, distance_m, elevation_gain_m, moving_time_s FROM activities"
        " WHERE athlete_id = $1 AND start_time >= $2 AND start_time < $3 ORDER BY start_time, id",
        athlete_id, window[0], window[1])
    return [challenge_json(c, window, c["id"] in joined, activities) for c in challenges]


@authenticated
async def list_challenges(request: Request, me: dict) -> JSONResponse:
    return JSONResponse({"challenges": await challenges_for(me["id"], me["time_zone"])})


async def _challenge_or_404(request: Request) -> int:
    challenge_id = parse_id(request.path_params["challenge_id"])
    if not await db.pool.fetchval("SELECT EXISTS (SELECT 1 FROM challenges WHERE id = $1)", challenge_id):
        raise not_found()
    return challenge_id


@authenticated
async def join_challenge(request: Request, me: dict) -> JSONResponse:
    challenge_id = await _challenge_or_404(request)
    created = await db.pool.fetchval(
        "INSERT INTO challenge_participants (athlete_id, challenge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1",
        me["id"], challenge_id)
    row = next(c for c in await challenges_for(me["id"], me["time_zone"]) if c["id"] == challenge_id)
    return JSONResponse(row, status_code=201 if created else 200)


@authenticated
async def leave_challenge(request: Request, me: dict) -> Response:
    challenge_id = await _challenge_or_404(request)
    await db.pool.execute("DELETE FROM challenge_participants WHERE athlete_id = $1 AND challenge_id = $2",
                          me["id"], challenge_id)
    return Response(status_code=204)


@authenticated
async def trophies(request: Request, me: dict) -> JSONResponse:
    athlete_id = parse_id(request.path_params["athlete_id"])
    zone = await db.pool.fetchval("SELECT time_zone FROM athletes WHERE id = $1", athlete_id)
    if zone is None:
        raise not_found()
    return JSONResponse({"trophies": [c for c in await challenges_for(athlete_id, zone) if c["joined"] and c["completed"]]})


routes = [
    Route("/api/challenges", list_challenges, methods=["GET"]),
    Route("/api/challenges/{challenge_id}/join", join_challenge, methods=["POST"]),
    Route("/api/challenges/{challenge_id}/join", leave_challenge, methods=["DELETE"]),
    Route("/api/athletes/{athlete_id}/trophies", trophies, methods=["GET"]),
]
