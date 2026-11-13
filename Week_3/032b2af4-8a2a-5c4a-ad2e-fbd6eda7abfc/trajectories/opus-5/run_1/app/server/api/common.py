"""Shared request reading, validation and serialization for the JSON interface."""
import base64
import json
from datetime import datetime, timezone

from fastapi import Request

from ..errors import ApiError, not_found, validation

SPORT_TYPES = ("run", "ride", "walk", "hike")
VISIBILITIES = ("everyone", "followers", "only_me")


async def read_json(request: Request) -> dict:
    raw = await request.body()
    try:
        body = json.loads(raw or b"")
    except ValueError:
        raise ApiError(400, "validation")
    if not isinstance(body, dict):
        raise ApiError(400, "validation")
    return body


def parse_id(value: str) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise not_found()
    if number < 1:
        raise not_found()
    return number


def text_field(body: dict, field: str, minimum: int, maximum: int, fields: dict) -> str | None:
    value = body.get(field)
    if not isinstance(value, str) or not (minimum <= len(value.strip()) <= maximum):
        fields[field] = f"must be {minimum} to {maximum} characters"
        return None
    return value.strip()


def choice_field(body: dict, field: str, allowed: tuple, fields: dict) -> str | None:
    value = body.get(field)
    if value not in allowed:
        fields[field] = f"must be one of {', '.join(allowed)}"
        return None
    return value


def require(fields: dict) -> None:
    if fields:
        raise validation(fields)


def iso(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def encode_cursor(start_time: datetime, activity_id: int) -> str:
    raw = f"{start_time.astimezone(timezone.utc).isoformat()}|{activity_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    padded = cursor + "=" * (-len(cursor) % 4)
    try:
        moment, activity_id = base64.urlsafe_b64decode(padded.encode()).decode().split("|")
        return datetime.fromisoformat(moment), int(activity_id)
    except (ValueError, UnicodeDecodeError):
        raise validation({"cursor": "is not a cursor from this feed"})


def paging_limit(request: Request) -> int:
    raw = request.query_params.get("limit")
    if raw is None:
        return 20
    try:
        limit = int(raw)
    except ValueError:
        raise validation({"limit": "must be a whole number from 1 to 50"})
    if not 1 <= limit <= 50:
        raise validation({"limit": "must be a whole number from 1 to 50"})
    return limit


def athlete_json(athlete: dict) -> dict:
    return {
        "id": athlete["id"],
        "email": athlete["email"],
        "name": athlete["name"],
        "private": athlete["private"],
        "default_visibility": athlete["default_visibility"],
        "subscriber": bool(athlete.get("subscriber")),
        "plan": athlete["plan"],
        "time_zone": athlete["time_zone"],
    }


def _efforts_for(cursor, activity_ids: list[int]) -> dict[int, list]:
    efforts: dict[int, list] = {activity_id: [] for activity_id in activity_ids}
    if not activity_ids:
        return efforts
    cursor.execute(
        """
        SELECT e.activity_id, e.segment_id, s.name AS segment_name,
               e.elapsed_time_s, e.pr_rank, e.is_crown
        FROM segment_efforts e
        JOIN segments s ON s.id = e.segment_id
        WHERE e.activity_id = ANY(%s)
        ORDER BY e.id
        """,
        (activity_ids,),
    )
    for row in cursor.fetchall():
        efforts[row["activity_id"]].append(
            {
                "segment_id": row["segment_id"],
                "segment_name": row["segment_name"],
                "elapsed_time_s": row["elapsed_time_s"],
                "pr_rank": row["pr_rank"],
                "is_crown": row["is_crown"],
            }
        )
    return efforts


def activity_json(row: dict, segment_efforts: list) -> dict:
    return {
        "id": row["id"],
        "athlete_id": row["athlete_id"],
        "athlete_name": row["athlete_name"],
        "name": row["name"],
        "sport_type": row["sport_type"],
        "visibility": row["visibility"],
        "start_time": iso(row["start_time"]),
        "distance_m": row["distance_m"],
        "moving_time_s": row["moving_time_s"],
        "elapsed_time_s": row["elapsed_time_s"],
        "elevation_gain_m": row["elevation_gain_m"],
        "avg_pace_s_per_km": row["avg_pace_s_per_km"],
        "avg_speed_kmh": float(row["avg_speed_kmh"]),
        "kudos_count": row["kudos_count"],
        "comment_count": row["comment_count"],
        "splits": row["splits"],
        "best_efforts": row["best_efforts"],
        "segment_efforts": segment_efforts,
    }


def activities_json(cursor, rows: list[dict]) -> list[dict]:
    efforts = _efforts_for(cursor, [row["id"] for row in rows])
    return [activity_json(row, efforts[row["id"]]) for row in rows]
