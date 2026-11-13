"""Challenges, stats, recap and plans."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from lib import security, store
from lib.errors import ApiError
from web import json_response, route, iso


def athlete_zone(me) -> ZoneInfo:
    try:
        return ZoneInfo(me["time_zone"])
    except Exception:
        return ZoneInfo("UTC")


def month_window(me) -> tuple[datetime, datetime]:
    """The current calendar month in the athlete's time zone, written in UTC."""
    zone = athlete_zone(me)
    now = datetime.now(timezone.utc).astimezone(zone)
    start = datetime(now.year, now.month, 1, tzinfo=zone)
    if now.month == 12:
        end = datetime(now.year + 1, 1, 1, tzinfo=zone)
    else:
        end = datetime(now.year, now.month + 1, 1, tzinfo=zone)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


@route("GET", "/api/challenges")
def challenges_list(handler, body, me):
    start, end = month_window(me)
    rows = store.query("SELECT * FROM challenges ORDER BY name")
    out = []
    for r in rows:
        joined = store.one(
            "SELECT 1 AS ok FROM challenge_participants WHERE athlete_id=%s AND challenge_id=%s",
            (me["id"], r["id"])) is not None
        progress = challenge_progress(me, r, start, end) if joined else 0
        completed_at = None
        if joined:
            completed_at = completion_time(me, r, start, end)
        out.append({
            "id": r["id"], "name": r["name"], "sport_types": r["sport_types"], "dimension": r["dimension"],
            "goal": r["goal"], "starts_at": iso(start), "ends_at": iso(end),
            "joined": joined, "progress": progress,
            "completed": progress >= r["goal"] if joined else False,
            "completed_at": completed_at,
        })
    return json_response({"challenges": out})


def qualifying_activities(me, challenge, start, end):
    sports = challenge["sport_types"]
    return store.query(
        """SELECT * FROM activities WHERE athlete_id=%s AND sport_type = ANY(%s)
           AND start_time >= %s AND start_time < %s ORDER BY start_time""",
        (me["id"], sports, start, end))


def challenge_progress(me, challenge, start, end) -> int:
    activities = qualifying_activities(me, challenge, start, end)
    dimension = challenge["dimension"]
    if dimension == "single_distance":
        return max((a["distance_m"] for a in activities), default=0)
    key = {"distance": "distance_m", "elevation": "elevation_gain_m",
           "moving_time": "moving_time_s"}[dimension]
    return sum(a[key] for a in activities)


def completion_time(me, challenge, start, end):
    """The start time of the qualifying activity that reached the goal, in start-time order."""
    dimension = challenge["dimension"]
    goal = challenge["goal"]
    running = 0
    for a in qualifying_activities(me, challenge, start, end):
        if dimension == "single_distance":
            value = a["distance_m"]
        else:
            value = a[{"distance": "distance_m", "elevation": "elevation_gain_m",
                       "moving_time": "moving_time_s"}[dimension]]
        if dimension == "single_distance":
            if value >= goal:
                return iso(a["start_time"])
        else:
            running += value
            if running >= goal:
                return iso(a["start_time"])
    return None


@route("POST", "/api/challenges/{id}/join")
def join_challenge(handler, body, me):
    challenge = store.one("SELECT * FROM challenges WHERE id=%s", (handler.path_params["id"],))
    if not challenge:
        raise ApiError(404, "not_found")
    existing = store.one(
        "SELECT 1 AS ok FROM challenge_participants WHERE athlete_id=%s AND challenge_id=%s",
        (me["id"], challenge["id"]))
    if existing:
        return json_response({"joined": True}, 200)
    store.execute(
        "INSERT INTO challenge_participants (id, athlete_id, challenge_id) VALUES (%s,%s,%s)",
        (security.new_id("cp"), me["id"], challenge["id"]))
    return json_response({"joined": True}, 201)


@route("DELETE", "/api/challenges/{id}/join")
def leave_challenge(handler, body, me):
    challenge = store.one("SELECT * FROM challenges WHERE id=%s", (handler.path_params["id"],))
    if not challenge:
        raise ApiError(404, "not_found")
    store.execute(
        "DELETE FROM challenge_participants WHERE athlete_id=%s AND challenge_id=%s",
        (me["id"], challenge["id"]))
    return 204, [], b""


@route("GET", "/api/athletes/{id}/trophies")
def trophies(handler, body, me):
    target = store.one("SELECT * FROM athletes WHERE id=%s", (handler.path_params["id"],))
    if not target:
        raise ApiError(404, "not_found")
    start, end = month_window(target)
    rows = store.query(
        """SELECT c.* FROM challenges c
           JOIN challenge_participants p ON p.challenge_id=c.id
           WHERE p.athlete_id=%s""", (target["id"],))
    completed = []
    for r in rows:
        if completion_time(target, r, start, end):
            completed.append({"id": r["id"], "name": r["name"], "sport_types": r["sport_types"],
                              "dimension": r["dimension"], "goal": r["goal"],
                              "completed_at": completion_time(target, r, start, end)})
    return json_response({"trophies": completed})


@route("GET", "/api/athletes/me/stats")
def stats(handler, body, me):
    weeks_raw = handler.parsed_query.get("weeks", ["12"])[0]
    try:
        weeks = int(weeks_raw)
    except ValueError:
        raise ApiError(400, "validation", {"weeks": "invalid"})
    if weeks < 1 or weeks > 52:
        raise ApiError(400, "validation", {"weeks": "invalid"})
    zone = athlete_zone(me)
    now = datetime.now(timezone.utc).astimezone(zone)
    monday = now.date() - timedelta(days=now.weekday())
    week_rows = []
    for i in range(weeks - 1, -1, -1):
        ws = monday - timedelta(weeks=i)
        week_start = datetime(ws.year, ws.month, ws.day, tzinfo=zone)
        week_end = week_start + timedelta(weeks=1)
        acts = store.query(
            """SELECT distance_m, moving_time_s, elevation_gain_m FROM activities
               WHERE athlete_id=%s AND start_time >= %s AND start_time < %s""",
            (me["id"], week_start.astimezone(timezone.utc), week_end.astimezone(timezone.utc)))
        week_rows.append({
            "week_start": ws.isoformat(),
            "distance_m": sum(a["distance_m"] for a in acts),
            "moving_time_s": sum(a["moving_time_s"] for a in acts),
            "elevation_gain_m": sum(a["elevation_gain_m"] for a in acts),
            "activity_count": len(acts),
        })
    year_start = datetime(now.year, 1, 1, tzinfo=zone)
    ytd = store.query(
        """SELECT coalesce(sum(distance_m),0) AS d, count(*) AS n FROM activities
           WHERE athlete_id=%s AND start_time >= %s""",
        (me["id"], year_start.astimezone(timezone.utc)))
    return json_response({"weeks": week_rows,
                          "year_to_date": {"distance_m": ytd[0]["d"], "activity_count": ytd[0]["n"]}})


@route("GET", "/api/athletes/me/recap")
def recap(handler, body, me):
    year_raw = handler.parsed_query.get("year", [str(datetime.now(timezone.utc).year)])[0]
    try:
        year = int(year_raw)
    except ValueError:
        raise ApiError(400, "validation", {"year": "invalid"})
    zone = athlete_zone(me)
    start = datetime(year, 1, 1, tzinfo=zone).astimezone(timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=zone).astimezone(timezone.utc)
    acts = store.query(
        """SELECT a.*, (SELECT count(*) FROM kudos k WHERE k.activity_id=a.id) AS kudos_n
           FROM activities a WHERE a.athlete_id=%s AND a.start_time >= %s AND a.start_time < %s
           ORDER BY a.start_time""",
        (me["id"], start, end))
    distance = sum(a["distance_m"] for a in acts)
    longest = max(acts, key=lambda a: a["distance_m"], default=None)
    sport_counts: dict[str, list[int]] = {}
    for a in acts:
        sport_counts.setdefault(a["sport_type"], [0, 0])
        sport_counts[a["sport_type"]][0] += 1
        sport_counts[a["sport_type"]][1] += a["distance_m"]
    top_sport = None
    if sport_counts:
        top_sport = max(sport_counts, key=lambda s: (sport_counts[s][0], sport_counts[s][1]))
    return json_response({
        "year": year, "activity_count": len(acts), "distance_m": distance,
        "moving_time_s": sum(a["moving_time_s"] for a in acts),
        "elevation_gain_m": sum(a["elevation_gain_m"] for a in acts),
        "longest_activity_id": longest["id"] if longest else None,
        "top_sport": top_sport,
        "kudos_received": sum(a["kudos_n"] for a in acts),
    })


PLANS = [
    {"id": "free", "name": "Free", "annual_price_cents": 0, "monthly_price_cents": 0, "seats": 1},
    {"id": "individual", "name": "Individual", "annual_price_cents": 7999, "monthly_price_cents": 1199, "seats": 1},
    {"id": "family", "name": "Family", "annual_price_cents": 12999, "monthly_price_cents": None, "seats": 4},
    {"id": "student", "name": "Student", "annual_price_cents": 3999, "monthly_price_cents": None, "seats": 1},
]


@route("GET", "/api/plans")
def plans_list(handler, body, me):
    return json_response({"plans": PLANS})


@route("POST", "/api/subscription")
def start_subscription(handler, body, me):
    plan = body.get("plan")
    billing = body.get("billing")
    if plan not in ("free", "individual", "family", "student"):
        raise ApiError(400, "validation", {"plan": "invalid"})
    if plan != "individual" and billing == "monthly":
        raise ApiError(400, "validation", {"billing": "invalid"})
    if billing not in ("annual", "monthly"):
        raise ApiError(400, "validation", {"billing": "invalid"})
    trial_end = date.today() + timedelta(days=30)
    store.execute(
        """INSERT INTO subscriptions (athlete_id, plan, billing, status, trial_ends_on)
           VALUES (%s,%s,%s,'trialing',%s)
           ON CONFLICT (athlete_id) DO UPDATE SET plan=EXCLUDED.plan, billing=EXCLUDED.billing,
                                                 status='trialing', trial_ends_on=EXCLUDED.trial_ends_on""",
        (me["id"], plan, billing, trial_end))
    store.execute("UPDATE athletes SET subscriber=TRUE, plan=%s WHERE id=%s", (plan, me["id"]))
    return json_response({"plan": plan, "billing": billing, "status": "trialing",
                          "trial_ends_on": trial_end.isoformat()}, 201)


@route("DELETE", "/api/subscription")
def cancel_subscription(handler, body, me):
    store.execute("DELETE FROM subscriptions WHERE athlete_id=%s", (me["id"],))
    store.execute("UPDATE athletes SET subscriber=FALSE, plan='free' WHERE id=%s", (me["id"],))
    return 204, [], b""
