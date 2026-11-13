"""Activity visibility and feed ordering: the single places these rules live."""
from lib import store


def can_view(viewer_id, activity_row) -> bool:
    """The visibility rule. activity_row needs athlete_id, visibility and private fields."""
    owner_id = activity_row["athlete_id"] if isinstance(activity_row, dict) else activity_row.athlete_id
    if viewer_id is not None and viewer_id == owner_id:
        return True
    visibility = activity_row["visibility"]
    if visibility == "only_me":
        return False
    is_private = bool(activity_row["owner_private"])
    if visibility == "everyone" and not is_private:
        return viewer_id is not None
    if viewer_id is None:
        return False
    return store.one(
        "SELECT 1 AS ok FROM follows WHERE follower_id=%s AND followee_id=%s AND status='accepted'",
        (viewer_id, owner_id)) is not None


def feed_query_where(viewer_id: str) -> tuple[str, list]:
    """Activities visible to the caller: their own, plus others' when the visibility rule allows."""
    where = """(a.athlete_id = %s OR (
                a.visibility != 'only_me'
                AND (NOT ar.private OR a.athlete_id IN (
                     SELECT followee_id FROM follows WHERE follower_id=%s AND status='accepted'))
                AND (a.visibility = 'everyone' OR a.athlete_id IN (
                     SELECT followee_id FROM follows WHERE follower_id=%s AND status='accepted'))))"""
    return where, [viewer_id, viewer_id, viewer_id]


FEED_ORDER = "ORDER BY a.start_time DESC, a.id DESC"


def encode_cursor(start_time, activity_id: str) -> str:
    """Opaque cursors are start-time and activity id joined with a separator the ids never contain."""
    return f"{start_time}|{activity_id}"


def decode_cursor(cursor: str | None):
    parts = (cursor or "").split("|", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None, None
    return parts[0], parts[1]
