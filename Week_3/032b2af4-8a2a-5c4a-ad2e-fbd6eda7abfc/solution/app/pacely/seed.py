"""Baseline data, written once: athletes, follows, the Harbor Climb segment with its three runs, and the challenges."""

from datetime import datetime, timedelta, timezone

from . import plans, security
from .gpx import TrackPoint, measure
from .recording import insert_segment, store_activity

SEED_LOCK = 4172002
SEED_PASSWORD = "deku-demo-pw-2026"
ATHLETES = [  # email, name, private, plan
    ("ava@example.com", "Ava Brooks", False, "individual"),
    ("leo@example.com", "Leo Park", False, "free"),
    ("mia@example.com", "Mia Chen", True, "free"),
    ("sam@example.com", "Sam Ortiz", False, "free"),
]
FOLLOWS = [("ava@example.com", "leo@example.com"), ("leo@example.com", "ava@example.com"),
           ("sam@example.com", "ava@example.com")]
HARBOR_START = (47.60000, -122.33000)
HARBOR_END = (47.60900, -122.33000)
HARBOR_RUNS = [  # email, name, start, seconds; recorded in start-time order
    ("leo@example.com", "Harbor Climb Morning Run", datetime(2026, 1, 10, 7, 0, tzinfo=timezone.utc), 238),
    ("ava@example.com", "Harbor Climb Tempo", datetime(2026, 1, 11, 7, 0, tzinfo=timezone.utc), 251),
    ("sam@example.com", "Harbor Climb Easy Run", datetime(2026, 1, 12, 7, 0, tzinfo=timezone.utc), 302),
]
CHALLENGES = [  # name, sports, dimension, goal
    ("Monthly 5K Challenge", ["run"], "single_distance", 5000),
    ("Monthly 10K Challenge", ["run"], "single_distance", 10000),
    ("Monthly Half Marathon Challenge", ["run"], "single_distance", 21097),
    ("Monthly Run 100K Challenge", ["run"], "distance", 100000),
    ("Monthly Climbing Challenge", ["run", "ride", "walk", "hike"], "elevation", 2000),
    ("Monthly Gran Fondo Challenge", ["ride"], "single_distance", 100000),
    ("Monthly Ride 200K Challenge", ["ride"], "distance", 200000),
    ("Monthly Moving Time Challenge", ["run", "ride", "walk", "hike"], "moving_time", 36000),
]
POINTS = 11


def harbor_track(start: datetime, seconds: int) -> list[TrackPoint]:
    """Eleven points due north from the segment start to its end; elevation 10 to 50 m, evenly timed."""
    steps = POINTS - 1
    return [TrackPoint(round(HARBOR_START[0] + (HARBOR_END[0] - HARBOR_START[0]) * i / steps, 5), HARBOR_START[1],
                       10.0 + 40.0 * i / steps, start + timedelta(seconds=seconds * i / steps)) for i in range(POINTS)]


async def seed(conn) -> None:
    await conn.execute("SELECT pg_advisory_xact_lock($1)", SEED_LOCK)
    password_hash = await security.hash_password(SEED_PASSWORD)
    for email, name, private, plan in ATHLETES:
        await conn.execute(
            "INSERT INTO athletes (email, name, password_hash, private, plan) VALUES ($1, $2, $3, $4, $5)"
            " ON CONFLICT (email) DO NOTHING", email, name, password_hash, private, plan)
    ids = {r["email"]: r["id"] for r in await conn.fetch("SELECT id, email FROM athletes WHERE email = ANY($1)",
                                                         [a[0] for a in ATHLETES])}
    for follower, followee in FOLLOWS:
        await conn.execute("INSERT INTO follows (follower_id, followee_id, status) VALUES ($1, $2, 'accepted')"
                           " ON CONFLICT DO NOTHING", ids[follower], ids[followee])
    await conn.execute(
        "INSERT INTO subscriptions (athlete_id, plan, billing, status, trial_ends_on)"
        " VALUES ($1, 'individual', 'annual', 'trialing', $2) ON CONFLICT DO NOTHING", ids["ava@example.com"],
        plans.trial_end())
    for name, sports, dimension, goal in CHALLENGES:
        await conn.execute("INSERT INTO challenges (name, sport_types, dimension, goal) VALUES ($1, $2, $3, $4)"
                           " ON CONFLICT (name) DO NOTHING", name, sports, dimension, goal)
    await seed_harbor_climb(conn, ids)


async def seed_harbor_climb(conn, ids: dict) -> None:
    exists = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM segments WHERE start_lat = $1 AND start_lon = $2 AND end_lat = $3 AND end_lon = $4)",
        *HARBOR_START, *HARBOR_END)
    if exists:
        return
    leo_track = harbor_track(HARBOR_RUNS[0][2], HARBOR_RUNS[0][3])
    await insert_segment(conn, "Harbor Climb", ids["leo@example.com"], leo_track, measure(leo_track, "run")["totals"],
                         0, POINTS - 1)
    for email, name, start, seconds in HARBOR_RUNS:
        track = harbor_track(start, seconds)
        await store_activity(conn, ids[email], name, "run", "everyone", track, measure(track, "run"))
