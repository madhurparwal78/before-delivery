"""Follows, follow requests, kudos and comments."""
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .. import auth, db
from ..errors import ApiError, forbidden, not_found, validation
from .activities import load_activity
from .common import iso, parse_id, read_json

router = APIRouter()


def _follow_status(cursor, viewer_id: int, target_id: int) -> str:
    if viewer_id == target_id:
        return "self"
    cursor.execute(
        "SELECT status FROM follows WHERE follower_id = %s AND followee_id = %s",
        (viewer_id, target_id),
    )
    row = cursor.fetchone()
    return row["status"] if row else "none"


@router.get("/athletes/{athlete_id}")
def athlete_profile(athlete_id: str, athlete: dict = Depends(auth.require_athlete)):
    target_id = parse_id(athlete_id)
    with db.cursor() as cursor:
        cursor.execute("SELECT id, name, private FROM athletes WHERE id = %s", (target_id,))
        target = cursor.fetchone()
        if target is None:
            raise not_found()
        cursor.execute(
            """
            SELECT
              (SELECT count(*) FROM follows WHERE followee_id = %(id)s AND status = 'accepted') AS followers,
              (SELECT count(*) FROM follows WHERE follower_id = %(id)s AND status = 'accepted') AS following
            """,
            {"id": target_id},
        )
        counts = cursor.fetchone()
        return {
            "id": target["id"],
            "name": target["name"],
            "private": target["private"],
            "follower_count": counts["followers"],
            "following_count": counts["following"],
            "follow_status": _follow_status(cursor, athlete["id"], target_id),
        }


@router.post("/athletes/{athlete_id}/follow")
def follow_athlete(athlete_id: str, athlete: dict = Depends(auth.require_athlete)):
    target_id = parse_id(athlete_id)
    if target_id == athlete["id"]:
        raise validation({"athlete_id": "an athlete cannot follow themselves"})
    with db.cursor() as cursor:
        cursor.execute("SELECT id, private FROM athletes WHERE id = %s", (target_id,))
        target = cursor.fetchone()
        if target is None:
            raise not_found()
        wanted = "pending" if target["private"] else "accepted"
        cursor.execute(
            """
            INSERT INTO follows (follower_id, followee_id, status) VALUES (%s, %s, %s)
            ON CONFLICT (follower_id, followee_id) DO NOTHING
            RETURNING status
            """,
            (athlete["id"], target_id, wanted),
        )
        created = cursor.fetchone()
        if created is not None:
            return JSONResponse({"status": created["status"]}, status_code=201)
        return JSONResponse({"status": _follow_status(cursor, athlete["id"], target_id)}, status_code=200)


@router.delete("/athletes/{athlete_id}/follow")
def unfollow_athlete(athlete_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        cursor.execute(
            "DELETE FROM follows WHERE follower_id = %s AND followee_id = %s",
            (athlete["id"], parse_id(athlete_id)),
        )
    return Response(status_code=204)


@router.get("/follow-requests")
def follow_requests(athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT f.id, f.follower_id, ath.name AS follower_name
            FROM follows f JOIN athletes ath ON ath.id = f.follower_id
            WHERE f.followee_id = %s AND f.status = 'pending'
            ORDER BY f.id
            """,
            (athlete["id"],),
        )
        return {"requests": cursor.fetchall()}


def _decide_request(request_id: str, athlete: dict, accept: bool) -> dict:
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM follows WHERE id = %s", (parse_id(request_id),))
        row = cursor.fetchone()
        if row is None or row["status"] != "pending":
            raise not_found()
        if row["followee_id"] != athlete["id"]:
            raise forbidden()
        if accept:
            cursor.execute("UPDATE follows SET status = 'accepted' WHERE id = %s", (row["id"],))
            return {"status": "accepted"}
        cursor.execute("DELETE FROM follows WHERE id = %s", (row["id"],))
        return {"status": "rejected"}


@router.post("/follow-requests/{request_id}/approve")
def approve_request(request_id: str, athlete: dict = Depends(auth.require_athlete)):
    return _decide_request(request_id, athlete, True)


@router.post("/follow-requests/{request_id}/reject")
def reject_request(request_id: str, athlete: dict = Depends(auth.require_athlete)):
    return _decide_request(request_id, athlete, False)


def _kudos_count(cursor, activity_id: int) -> int:
    cursor.execute("SELECT count(*) AS total FROM kudos WHERE activity_id = %s", (activity_id,))
    return cursor.fetchone()["total"]


@router.post("/activities/{activity_id}/kudos")
def give_kudos(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_activity(cursor, parse_id(activity_id), athlete["id"])
        if row["athlete_id"] == athlete["id"]:
            raise ApiError(422, "cannot_kudo_own_activity")
        cursor.execute(
            """
            INSERT INTO kudos (activity_id, athlete_id) VALUES (%s, %s)
            ON CONFLICT ON CONSTRAINT kudos_athlete_key DO NOTHING
            RETURNING id
            """,
            (row["id"], athlete["id"]),
        )
        created = cursor.fetchone() is not None
        return JSONResponse({"kudos_count": _kudos_count(cursor, row["id"])}, status_code=201 if created else 200)


@router.delete("/activities/{activity_id}/kudos")
def take_back_kudos(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_activity(cursor, parse_id(activity_id), athlete["id"])
        cursor.execute(
            "DELETE FROM kudos WHERE activity_id = %s AND athlete_id = %s", (row["id"], athlete["id"])
        )
    return Response(status_code=204)


@router.get("/activities/{activity_id}/kudos")
def list_kudos(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_activity(cursor, parse_id(activity_id), athlete["id"])
        cursor.execute(
            """
            SELECT ath.id, ath.name FROM kudos k JOIN athletes ath ON ath.id = k.athlete_id
            WHERE k.activity_id = %s ORDER BY k.id
            """,
            (row["id"],),
        )
        return {"athletes": cursor.fetchall()}


@router.post("/activities/{activity_id}/comments")
async def post_comment(activity_id: str, request: Request, athlete: dict = Depends(auth.require_athlete)):
    body = await read_json(request)
    text = body.get("text")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
        raise validation({"text": "must be 1 to 500 characters"})
    with db.cursor() as cursor:
        row = load_activity(cursor, parse_id(activity_id), athlete["id"])
        cursor.execute(
            "INSERT INTO comments (activity_id, athlete_id, text) VALUES (%s, %s, %s) RETURNING id, created_at",
            (row["id"], athlete["id"], text.strip()),
        )
        created = cursor.fetchone()
        return JSONResponse(
            {
                "id": created["id"],
                "athlete_id": athlete["id"],
                "athlete_name": athlete["name"],
                "text": text.strip(),
                "created_at": iso(created["created_at"]),
            },
            status_code=201,
        )


@router.get("/activities/{activity_id}/comments")
def list_comments(activity_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        row = load_activity(cursor, parse_id(activity_id), athlete["id"])
        cursor.execute(
            """
            SELECT c.id, c.athlete_id, ath.name AS athlete_name, c.text, c.created_at
            FROM comments c JOIN athletes ath ON ath.id = c.athlete_id
            WHERE c.activity_id = %s ORDER BY c.id
            """,
            (row["id"],),
        )
        return {
            "comments": [
                {
                    "id": c["id"],
                    "athlete_id": c["athlete_id"],
                    "athlete_name": c["athlete_name"],
                    "text": c["text"],
                    "created_at": iso(c["created_at"]),
                }
                for c in cursor.fetchall()
            ]
        }


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.id, c.athlete_id, c.activity_id, a.athlete_id AS owner_id
            FROM comments c JOIN activities a ON a.id = c.activity_id
            WHERE c.id = %s
            """,
            (parse_id(comment_id),),
        )
        row = cursor.fetchone()
        if row is None:
            raise not_found()
        load_activity(cursor, row["activity_id"], athlete["id"])
        if athlete["id"] not in (row["athlete_id"], row["owner_id"]):
            raise forbidden()
        cursor.execute("DELETE FROM comments WHERE id = %s", (row["id"],))
    return Response(status_code=204)
