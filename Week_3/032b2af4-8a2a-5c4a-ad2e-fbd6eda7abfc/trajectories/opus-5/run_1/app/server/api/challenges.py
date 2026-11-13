"""Monthly challenges, trophies, weekly stats, the year recap, plans and subscriptions."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .. import auth, db
from ..domain.calendar import (
    current_year,
    day_start_utc,
    month_window,
    week_starts,
    year_window,
    zone as time_zone,
)
from ..domain.challenges import progress_and_completion, qualifying
from ..errors import not_found, validation
from .common import iso, parse_id, read_json

router = APIRouter()

PLANS = [
    {"id": "free", "name": "Free", "annual_price_cents": 0, "monthly_price_cents": 0, "seats": 1},
    {"id": "individual", "name": "Individual", "annual_price_cents": 7999, "monthly_price_cents": 1199, "seats": 1},
    {"id": "family", "name": "Family", "annual_price_cents": 12999, "monthly_price_cents": None, "seats": 4},
    {"id": "student", "name": "Student", "annual_price_cents": 3999, "monthly_price_cents": None, "seats": 1},
]
TRIAL_DAYS = 30


def _challenges_for(cursor, athlete: dict) -> list[dict]:
    starts_at, ends_at = month_window(athlete["time_zone"])
    cursor.execute(
        """
        SELECT sport_type, start_time, distance_m, elevation_gain_m, moving_time_s
        FROM activities WHERE athlete_id = %s AND start_time >= %s AND start_time < %s
        ORDER BY start_time, id
        """,
        (athlete["id"], starts_at, ends_at),
    )
    activities = cursor.fetchall()
    cursor.execute(
        """
        SELECT c.*, (p.id IS NOT NULL) AS joined
        FROM challenges c
        LEFT JOIN challenge_participants p ON p.challenge_id = c.id AND p.athlete_id = %s
        ORDER BY c.id
        """,
        (athlete["id"],),
    )
    listed = []
    for challenge in cursor.fetchall():
        progress, completed_at = 0, None
        if challenge["joined"]:
            progress, completed_at = progress_and_completion(
                challenge["dimension"], challenge["goal"], qualifying(activities, challenge["sport_types"])
            )
        listed.append(
            {
                "id": challenge["id"],
                "name": challenge["name"],
                "sport_types": challenge["sport_types"],
                "dimension": challenge["dimension"],
                "goal": challenge["goal"],
                "starts_at": iso(starts_at),
                "ends_at": iso(ends_at),
                "joined": challenge["joined"],
                "progress": progress,
                "completed": completed_at is not None,
                "completed_at": iso(completed_at),
            }
        )
    return listed


@router.get("/challenges")
def list_challenges(athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        return {"challenges": _challenges_for(cursor, athlete)}


@router.post("/challenges/{challenge_id}/join")
def join_challenge(challenge_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        cursor.execute("SELECT id FROM challenges WHERE id = %s", (parse_id(challenge_id),))
        challenge = cursor.fetchone()
        if challenge is None:
            raise not_found()
        cursor.execute(
            """
            INSERT INTO challenge_participants (challenge_id, athlete_id) VALUES (%s, %s)
            ON CONFLICT (challenge_id, athlete_id) DO NOTHING RETURNING id
            """,
            (challenge["id"], athlete["id"]),
        )
        created = cursor.fetchone() is not None
        return JSONResponse({"joined": True}, status_code=201 if created else 200)


@router.delete("/challenges/{challenge_id}/join")
def leave_challenge(challenge_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        cursor.execute(
            "DELETE FROM challenge_participants WHERE challenge_id = %s AND athlete_id = %s",
            (parse_id(challenge_id), athlete["id"]),
        )
    return Response(status_code=204)


@router.get("/athletes/{athlete_id}/trophies")
def trophies(athlete_id: str, athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM athletes WHERE id = %s", (parse_id(athlete_id),))
        target = cursor.fetchone()
        if target is None:
            raise not_found()
        return {
            "trophies": [
                challenge
                for challenge in _challenges_for(cursor, target)
                if challenge["joined"] and challenge["completed"]
            ]
        }


@router.get("/athletes/me/stats")
def weekly_stats(request: Request, athlete: dict = Depends(auth.require_athlete)):
    raw = request.query_params.get("weeks", "12")
    try:
        weeks = int(raw)
    except ValueError:
        raise validation({"weeks": "must be a whole number from 1 to 52"})
    if not 1 <= weeks <= 52:
        raise validation({"weeks": "must be a whole number from 1 to 52"})
    zone = athlete["time_zone"]
    mondays = week_starts(zone, weeks)
    window_start = day_start_utc(zone, mondays[0])
    window_end = day_start_utc(zone, mondays[-1] + timedelta(days=7))
    buckets = {
        monday: {
            "week_start": monday.isoformat(),
            "distance_m": 0,
            "moving_time_s": 0,
            "elevation_gain_m": 0,
            "activity_count": 0,
        }
        for monday in mondays
    }
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT start_time, distance_m, moving_time_s, elevation_gain_m
            FROM activities WHERE athlete_id = %s AND start_time >= %s AND start_time < %s
            """,
            (athlete["id"], window_start, window_end),
        )
        for row in cursor.fetchall():
            day = row["start_time"].astimezone(time_zone(zone)).date()
            monday = day - timedelta(days=day.weekday())
            bucket = buckets.get(monday)
            if bucket is None:
                continue
            bucket["distance_m"] += row["distance_m"]
            bucket["moving_time_s"] += row["moving_time_s"]
            bucket["elevation_gain_m"] += row["elevation_gain_m"]
            bucket["activity_count"] += 1
        year_start, year_end = year_window(zone, current_year(zone))
        cursor.execute(
            """
            SELECT coalesce(sum(distance_m), 0) AS distance_m, count(*) AS activity_count
            FROM activities WHERE athlete_id = %s AND start_time >= %s AND start_time < %s
            """,
            (athlete["id"], year_start, year_end),
        )
        totals = cursor.fetchone()
    return {
        "weeks": [buckets[monday] for monday in mondays],
        "year_to_date": {
            "distance_m": int(totals["distance_m"]),
            "activity_count": totals["activity_count"],
        },
    }


@router.get("/athletes/me/recap")
def recap(request: Request, athlete: dict = Depends(auth.require_athlete)):
    zone = athlete["time_zone"]
    raw = request.query_params.get("year")
    try:
        year = int(raw) if raw is not None else current_year(zone)
    except ValueError:
        raise validation({"year": "must be a four digit year"})
    if not 1970 <= year <= 9999:
        raise validation({"year": "must be a four digit year"})
    start, end = year_window(zone, year)
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, sport_type, distance_m, moving_time_s, elevation_gain_m,
                   (SELECT count(*) FROM kudos k WHERE k.activity_id = a.id) AS kudos
            FROM activities a WHERE athlete_id = %s AND start_time >= %s AND start_time < %s
            """,
            (athlete["id"], start, end),
        )
        activities = cursor.fetchall()
    by_sport: dict[str, list[int]] = {}
    for activity in activities:
        counted = by_sport.setdefault(activity["sport_type"], [0, 0])
        counted[0] += 1
        counted[1] += activity["distance_m"]
    longest = max(activities, key=lambda a: (a["distance_m"], -a["id"]), default=None)
    top_sport = max(by_sport.items(), key=lambda item: (item[1][0], item[1][1]), default=(None, None))[0]
    return {
        "year": year,
        "activity_count": len(activities),
        "distance_m": sum(a["distance_m"] for a in activities),
        "moving_time_s": sum(a["moving_time_s"] for a in activities),
        "elevation_gain_m": sum(a["elevation_gain_m"] for a in activities),
        "longest_activity_id": longest["id"] if longest else None,
        "top_sport": top_sport,
        "kudos_received": sum(a["kudos"] for a in activities),
    }


@router.get("/plans")
def list_plans(athlete: dict = Depends(auth.require_athlete)):
    return {"plans": PLANS}


@router.post("/subscription")
async def start_subscription(request: Request, athlete: dict = Depends(auth.require_athlete)):
    body = await read_json(request)
    plan = body.get("plan")
    billing = body.get("billing", "annual")
    known = {entry["id"] for entry in PLANS} - {"free"}
    fields: dict = {}
    if plan not in known:
        fields["plan"] = "must be individual, family or student"
    if billing not in ("annual", "monthly"):
        fields["billing"] = "must be annual or monthly"
    elif billing == "monthly" and plan != "individual":
        fields["billing"] = "monthly billing is only for the individual plan"
    if fields:
        raise validation(fields)
    trial_ends_on = date.today() + timedelta(days=TRIAL_DAYS)
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO subscriptions (athlete_id, plan, billing, status, trial_ends_on)
            VALUES (%s, %s, %s, 'trialing', %s)
            ON CONFLICT (athlete_id) DO UPDATE
                SET plan = EXCLUDED.plan, billing = EXCLUDED.billing,
                    status = 'trialing', trial_ends_on = EXCLUDED.trial_ends_on
            """,
            (athlete["id"], plan, billing, trial_ends_on),
        )
        cursor.execute("UPDATE athletes SET plan = %s WHERE id = %s", (plan, athlete["id"]))
    return JSONResponse(
        {
            "plan": plan,
            "billing": billing,
            "status": "trialing",
            "trial_ends_on": trial_ends_on.isoformat(),
        },
        status_code=201,
    )


@router.delete("/subscription")
def cancel_subscription(athlete: dict = Depends(auth.require_athlete)):
    with db.cursor() as cursor:
        cursor.execute("DELETE FROM subscriptions WHERE athlete_id = %s", (athlete["id"],))
        cursor.execute("UPDATE athletes SET plan = 'free' WHERE id = %s", (athlete["id"],))
    return Response(status_code=204)
