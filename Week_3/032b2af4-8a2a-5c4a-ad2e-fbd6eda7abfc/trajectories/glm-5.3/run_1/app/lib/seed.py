"""Idempotent seed of Pacely's baseline data on first start."""
from datetime import datetime, timedelta, timezone

from lib import security, store
from lib.parse import Point, ParsedTrack, haversine_m, round_half_up

SEED_PASSWORD = "deku-demo-pw-2026"

ATHLETES = [
    ("ath_ava", "ava@example.com", "Ava Brooks", True, "individual"),   # subscriber, public
    ("ath_leo", "leo@example.com", "Leo Park", False, "free"),
    ("ath_mia", "mia@example.com", "Mia Chen", False, "free"),          # private account
    ("ath_sam", "sam@example.com", "Sam Ortiz", False, "free"),
]

FOLLOWS = [("ath_ava", "ath_leo"), ("ath_leo", "ath_ava"), ("ath_sam", "ath_ava")]

CHALLENGES = [
    ("ch_5k", "Monthly 5K Challenge", ["run"], "single_distance", 5000),
    ("ch_10k", "Monthly 10K Challenge", ["run"], "single_distance", 10000),
    ("ch_half", "Monthly Half Marathon Challenge", ["run"], "single_distance", 21097),
    ("ch_run100", "Monthly Run 100K Challenge", ["run"], "distance", 100000),
    ("ch_climb", "Monthly Climbing Challenge", ["run", "ride", "walk", "hike"], "elevation", 2000),
    ("ch_gran", "Monthly Gran Fondo Challenge", ["ride"], "single_distance", 100000),
    ("ch_ride200", "Monthly Ride 200K Challenge", ["ride"], "distance", 200000),
    ("ch_move", "Monthly Moving Time Challenge", ["run", "ride", "walk", "hike"], "moving_time", 36000),
]

SEG_START = (47.60000, -122.33000)
SEG_END = (47.60900, -122.33000)
SEG_DISTANCE_M = 1001
SEG_ELEV_DIFF_M = 40
SEED_RUNS = [
    ("act_leo_harbor", "ath_leo", "Harbor Climb Morning Run", "2026-01-10T07:00:00Z", 238, True),
    ("act_ava_harbor", "ath_ava", "Harbor Climb Tempo", "2026-01-11T07:00:00Z", 251, False),
    ("act_sam_harbor", "ath_sam", "Harbor Climb Easy Run", "2026-01-12T07:00:00Z", 302, False),
]


def seed_track_points(start_time: datetime, seconds: int, count: int = 11) -> list[Point]:
    """A straight line due north, elevation rising evenly from 10 to 50 metres."""
    points = []
    for i in range(count):
        frac = i / (count - 1)
        lat = SEG_START[0] + (SEG_END[0] - SEG_START[0]) * frac
        lon = SEG_START[1]
        ele = 10.0 + 40.0 * frac
        t = start_time + timedelta(seconds=round(seconds * frac))
        points.append(Point(lat, lon, ele, t))
    return points


def recompute_efforts_for_activity(activity_id: str) -> None:
    """Match one activity against every segment, exactly as an upload is matched."""
    from lib.segments import match_activity_against_segments
    match_activity_against_segments(activity_id)


def seed() -> None:
    with store.conn() as c:
        for aid, email, name, subscriber, plan in ATHLETES:
            is_private = aid == "ath_mia"
            c.execute(
                """INSERT INTO athletes (id, email, name, password_hash, private, default_visibility,
                                         plan, subscriber, time_zone, created_at)
                   VALUES (%s,%s,%s,%s,%s,'everyone',%s,%s,'UTC', now())
                   ON CONFLICT (id) DO NOTHING""",
                (aid, email, name, security.hash_password(SEED_PASSWORD), is_private, plan, subscriber))
        for follower, followee in FOLLOWS:
            c.execute(
                """INSERT INTO follows (id, follower_id, followee_id, status)
                   VALUES (%s,%s,%s,'accepted') ON CONFLICT (follower_id, followee_id) DO NOTHING""",
                (security.new_id("fw"), follower, followee))
        for cid, cname, sports, dimension, goal in CHALLENGES:
            c.execute(
                """INSERT INTO challenges (id, name, sport_types, dimension, goal)
                   VALUES (%s,%s,%s::jsonb,%s,%s) ON CONFLICT (name) DO NOTHING""",
                (cid, cname, __import__("json").dumps(sports), dimension, goal))
        c.execute(
            """INSERT INTO segments (id, name, start_lat, start_lon, end_lat, end_lon,
                                     distance_m, elevation_diff_m, creator_id)
               VALUES (%s,'Harbor Climb',%s,%s,%s,%s,%s,%s,'ath_leo')
               ON CONFLICT (id) DO NOTHING""",
            ("seg_harbor", SEG_START[0], SEG_START[1], SEG_END[0], SEG_END[1],
             SEG_DISTANCE_M, SEG_ELEV_DIFF_M))
        c.execute(
            """INSERT INTO subscriptions (athlete_id, plan, billing, status, trial_ends_on)
               VALUES ('ath_ava','individual','annual','trialing', now()::date + interval '30 days')
               ON CONFLICT (athlete_id) DO NOTHING""")

        # seeded runs, each with its points and figures computed by the parsing rules
        for activity_id, athlete_id, name, start_iso, seconds, crown in SEED_RUNS:
            if store.one("SELECT 1 AS ok FROM activities WHERE id=%s", (activity_id,)):
                continue
            start_time = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
            points = seed_track_points(start_time, seconds)
            track = ParsedTrack(points)
            c.execute(
                """INSERT INTO activities (id, athlete_id, name, sport_type, visibility, start_time,
                        distance_m, moving_time_s, elapsed_time_s, elevation_gain_m,
                        avg_pace_s_per_km, avg_speed_kmh, splits, best_efforts, created_at)
                   VALUES (%s,%s,%s,'run','everyone',%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb, now())""",
                (activity_id, athlete_id, name, track.start_time, track.distance_m, track.moving_time_s,
                 track.elapsed_time_s, track.elevation_gain_m, track.pace("run"), track.avg_speed_kmh,
                 __import__("json").dumps(track.splits()), __import__("json").dumps(track.best_efforts("run"))))
            for seq, p in enumerate(points):
                cum = round_half_up(track.cumulative_m[seq])
                c.execute(
                    """INSERT INTO activity_points (activity_id, seq, lat, lon, ele, point_time, distance_m)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                    (activity_id, seq, p.lat, p.lon, p.ele, p.time, cum))
        # efforts recorded in start-time order so pr_rank and crown are earned naturally
        from lib.segments import match_activity_against_segments
        for activity_id, *_ in SEED_RUNS:
            match_activity_against_segments(activity_id)
        c.execute("DELETE FROM segment_efforts WHERE segment_id='seg_harbor' AND athlete_id IS NULL")
