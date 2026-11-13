"""Baseline data seeded on first start; restarting adds no duplicate rows."""
from datetime import date, datetime, timedelta, timezone

from . import auth, db
from .api.activities import insert_activity, match_segments
from .config import SEED_PASSWORD
from .domain.parsing import TrackPoint, summarize

ATHLETES = [
    {"email": "ava@example.com", "name": "Ava Brooks", "private": False, "plan": "individual"},
    {"email": "leo@example.com", "name": "Leo Park", "private": False, "plan": "free"},
    {"email": "mia@example.com", "name": "Mia Chen", "private": True, "plan": "free"},
    {"email": "sam@example.com", "name": "Sam Ortiz", "private": False, "plan": "free"},
]
FOLLOWS = [("ava@example.com", "leo@example.com"), ("leo@example.com", "ava@example.com"),
           ("sam@example.com", "ava@example.com")]

HARBOR_CLIMB = {
    "name": "Harbor Climb",
    "start_lat": 47.60000,
    "start_lon": -122.33000,
    "end_lat": 47.60900,
    "end_lon": -122.33000,
    "distance_m": 1001,
    "elevation_diff_m": 40,
}
SEEDED_RUNS = [
    ("leo@example.com", "Harbor Climb Morning Run", "2026-01-10T07:00:00Z", 238),
    ("ava@example.com", "Harbor Climb Tempo", "2026-01-11T07:00:00Z", 251),
    ("sam@example.com", "Harbor Climb Easy Run", "2026-01-12T07:00:00Z", 302),
]
TRACK_POINTS = 11

CHALLENGES = [
    ("Monthly 5K Challenge", ["run"], "single_distance", 5000),
    ("Monthly 10K Challenge", ["run"], "single_distance", 10000),
    ("Monthly Half Marathon Challenge", ["run"], "single_distance", 21097),
    ("Monthly Run 100K Challenge", ["run"], "distance", 100000),
    ("Monthly Climbing Challenge", ["run", "ride", "walk", "hike"], "elevation", 2000),
    ("Monthly Gran Fondo Challenge", ["ride"], "single_distance", 100000),
    ("Monthly Ride 200K Challenge", ["ride"], "distance", 200000),
    ("Monthly Moving Time Challenge", ["run", "ride", "walk", "hike"], "moving_time", 36000),
]


def _track(start: datetime, seconds: int) -> list[TrackPoint]:
    steps = TRACK_POINTS - 1
    return [
        TrackPoint(
            HARBOR_CLIMB["start_lat"]
            + (HARBOR_CLIMB["end_lat"] - HARBOR_CLIMB["start_lat"]) * index / steps,
            HARBOR_CLIMB["start_lon"],
            10.0 + 40.0 * index / steps,
            start + timedelta(seconds=seconds * index / steps),
        )
        for index in range(TRACK_POINTS)
    ]


def seed() -> None:
    with db.connect() as conn:
        cursor = conn.cursor()
        for challenge in CHALLENGES:
            cursor.execute(
                """
                INSERT INTO challenges (name, sport_types, dimension, goal)
                VALUES (%s, %s, %s, %s) ON CONFLICT (name) DO NOTHING
                """,
                challenge,
            )
        cursor.execute("SELECT id FROM athletes WHERE lower(email) = 'ava@example.com'")
        if cursor.fetchone() is not None:
            return
        password_hash = auth.hash_password(SEED_PASSWORD)
        ids: dict[str, int] = {}
        for athlete in ATHLETES:
            cursor.execute(
                """
                INSERT INTO athletes (email, name, password_hash, private, plan)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
                """,
                (athlete["email"], athlete["name"], password_hash, athlete["private"], athlete["plan"]),
            )
            ids[athlete["email"]] = cursor.fetchone()["id"]
        for follower, followee in FOLLOWS:
            cursor.execute(
                "INSERT INTO follows (follower_id, followee_id, status) VALUES (%s, %s, 'accepted')",
                (ids[follower], ids[followee]),
            )
        cursor.execute(
            """
            INSERT INTO subscriptions (athlete_id, plan, billing, status, trial_ends_on)
            VALUES (%s, 'individual', 'annual', 'trialing', %s)
            """,
            (ids["ava@example.com"], date.today() + timedelta(days=30)),
        )
        cursor.execute(
            """
            INSERT INTO segments (name, start_lat, start_lon, end_lat, end_lon,
                                  distance_m, elevation_diff_m, created_by)
            VALUES (%(name)s, %(start_lat)s, %(start_lon)s, %(end_lat)s, %(end_lon)s,
                    %(distance_m)s, %(elevation_diff_m)s, %(created_by)s)
            """,
            HARBOR_CLIMB | {"created_by": ids["leo@example.com"]},
        )
        for email, name, started, seconds in SEEDED_RUNS:
            start = datetime.fromisoformat(started.replace("Z", "+00:00")).astimezone(timezone.utc)
            points = _track(start, seconds)
            activity_id = insert_activity(
                cursor, ids[email], name, "run", "everyone", points, summarize(points, "run")
            )
            match_segments(
                cursor,
                {"id": activity_id, "athlete_id": ids[email], "visibility": "everyone"},
                points,
            )
