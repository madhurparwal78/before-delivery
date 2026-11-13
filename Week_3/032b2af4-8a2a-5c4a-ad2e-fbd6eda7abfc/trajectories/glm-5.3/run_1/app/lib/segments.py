"""Segments, efforts and leaderboards: the matching and ranking rules in one place."""
from datetime import datetime, timezone

from lib import security, store
from lib.parse import haversine_m
from lib.errors import ApiError

MATCH_RADIUS_M = 25.0


def _iso(dt) -> str:
    from web import iso
    return iso(dt)


def match_activity_against_segments(activity_id: str) -> None:
    """One effort per activity per segment, timed between the first points within 25 m."""
    points = store.query(
        "SELECT lat, lon, ele, point_time FROM activity_points WHERE activity_id=%s ORDER BY seq",
        (activity_id,))
    if len(points) < 2:
        return
    activity = store.one(
        "SELECT athlete_id, start_time, visibility FROM activities WHERE id=%s", (activity_id,))
    if not activity:
        return
    segments = store.query("SELECT id, start_lat, start_lon, end_lat, end_lon FROM segments")
    for segment in segments:
        if store.one("SELECT 1 AS ok FROM segment_efforts WHERE activity_id=%s AND segment_id=%s",
                     (activity_id, segment["id"])):
            continue
        start_idx = None
        end_idx = None
        for i, p in enumerate(points):
            if start_idx is None:
                if haversine_m(p["lat"], p["lon"], segment["start_lat"], segment["start_lon"]) <= MATCH_RADIUS_M:
                    start_idx = i
            elif end_idx is None:
                if haversine_m(p["lat"], p["lon"], segment["end_lat"], segment["end_lon"]) <= MATCH_RADIUS_M:
                    end_idx = i
                    break
        if start_idx is None or end_idx is None or end_idx <= start_idx:
            continue
        elapsed = round((points[end_idx]["point_time"] - points[start_idx]["point_time"]).total_seconds())
        effort_id = security.new_id("eff")
        with store.conn() as c:
            try:
                c.execute(
                    """INSERT INTO segment_efforts (id, segment_id, activity_id, athlete_id,
                                                    elapsed_time_s, start_time)
                       VALUES (%s,%s,%s,%s,%s,%s)""",
                    (effort_id, segment["id"], activity_id, activity["athlete_id"], elapsed,
                     points[start_idx]["point_time"]))
            except Exception:
                return
            pr_rank = compute_pr_rank(c, segment["id"], activity["athlete_id"], elapsed,
                                      points[start_idx]["point_time"])
            is_crown = compute_crown(c, segment["id"], effort_id, activity["athlete_id"],
                                     elapsed, points[start_idx]["point_time"], activity["visibility"])
            c.execute("UPDATE segment_efforts SET pr_rank=%s, is_crown=%s WHERE id=%s",
                      (pr_rank, is_crown, effort_id))


def compute_pr_rank(c, segment_id: str, athlete_id: str, elapsed: int, start_time) -> int | None:
    """1, 2 or 3 when this effort is the athlete's fastest, second or third fastest here."""
    faster = c.execute(
        """SELECT count(*) AS n FROM segment_efforts e
           JOIN activities a ON a.id = e.activity_id
           WHERE e.segment_id=%s AND e.athlete_id=%s AND e.id != %s
             AND (e.elapsed_time_s < %s OR (e.elapsed_time_s = %s AND e.start_time < %s))
             AND e.start_time <= %s""",
        (segment_id, athlete_id, _current_effort_id(c, segment_id, athlete_id, start_time), elapsed, elapsed,
         start_time, start_time)).fetchone()["n"]
    rank = faster + 1
    return rank if rank <= 3 else None


def _current_effort_id(c, segment_id, athlete_id, start_time):
    row = c.execute(
        "SELECT id FROM segment_efforts WHERE segment_id=%s AND athlete_id=%s AND start_time=%s LIMIT 1",
        (segment_id, athlete_id, start_time)).fetchone()
    return row["id"] if row else ""


def compute_crown(c, segment_id: str, effort_id: str, athlete_id: str, elapsed: int, start_time,
                  visibility: str) -> bool:
    """A crown is first place on the leaderboard at the moment the effort is recorded."""
    if visibility == "only_me":
        return False
    rows = c.execute(
        """SELECT e.elapsed_time_s, e.start_time, e.athlete_id FROM segment_efforts e
           JOIN activities a ON a.id = e.activity_id
           WHERE e.segment_id=%s AND a.visibility != 'only_me' AND e.id != %s""",
        (segment_id, effort_id)).fetchall()
    for row in rows:
        if (row["elapsed_time_s"] < elapsed or
                (row["elapsed_time_s"] == elapsed and row["start_time"] < start_time)):
            return False
    return True


def segment_efforts_payload(activity_id: str) -> list[dict]:
    rows = store.query(
        """SELECT e.segment_id, s.name AS segment_name, e.elapsed_time_s, e.pr_rank, e.is_crown
           FROM segment_efforts e JOIN segments s ON s.id = e.segment_id
           WHERE e.activity_id=%s ORDER BY e.start_time""",
        (activity_id,))
    return [{"segment_id": r["segment_id"], "segment_name": r["segment_name"],
             "elapsed_time_s": r["elapsed_time_s"], "pr_rank": r["pr_rank"], "is_crown": r["is_crown"]}
            for r in rows]


def leaderboard(segment_id: str, viewer_id: str, follower_ids: list[str] | None = None,
                limit: int | None = None, rank_within: list[str] | None = None) -> dict:
    """Each athlete's fastest effort, sorted by time with ties to the earlier start."""
    where = "a.visibility != 'only_me'"
    params: list = [segment_id]
    if follower_ids is not None:
        where += " AND e.athlete_id = ANY(%s)"
        params.append(follower_ids)
    rows = store.query(
        f"""SELECT e.athlete_id, a2.name AS athlete_name, MIN(e.elapsed_time_s) AS best_time
            FROM segment_efforts e
            JOIN activities a ON a.id = e.activity_id
            JOIN athletes a2 ON a2.id = e.athlete_id
            WHERE e.segment_id=%s AND {where}
            GROUP BY e.athlete_id, a2.name""",
        params)
    entries = []
    for row in rows:
        best = store.one(
            f"""SELECT e.id, e.activity_id, e.elapsed_time_s, e.start_time FROM segment_efforts e
                JOIN activities a ON a.id = e.activity_id
                WHERE e.segment_id=%s AND e.athlete_id=%s AND {where}
                ORDER BY e.elapsed_time_s, e.start_time LIMIT 1""",
            (segment_id, row["athlete_id"]))
        if best:
            entries.append({"athlete_id": row["athlete_id"], "athlete_name": row["athlete_name"],
                            "elapsed_time_s": best["elapsed_time_s"], "activity_id": best["activity_id"],
                            "start_time": _iso(best["start_time"])})
    entries.sort(key=lambda e: (e["elapsed_time_s"], e["start_time"]))
    return {"entries": entries}
