"""The one home of challenge progress and completion."""

DIMENSION_FIELDS = {
    "distance": "distance_m",
    "elevation": "elevation_gain_m",
    "moving_time": "moving_time_s",
    "single_distance": "distance_m",
}


def qualifying(activities: list[dict], sport_types: list[str]) -> list[dict]:
    return [activity for activity in activities if activity["sport_type"] in sport_types]


def progress_and_completion(dimension: str, goal: int, activities: list[dict]) -> tuple[int, object]:
    """Activities arrive in start_time order; completion lands on the one that reaches the goal."""
    field = DIMENSION_FIELDS[dimension]
    running = 0
    completed_at = None
    for activity in activities:
        value = activity[field]
        running = max(running, value) if dimension == "single_distance" else running + value
        if completed_at is None and running >= goal:
            completed_at = activity["start_time"]
    return running, completed_at
