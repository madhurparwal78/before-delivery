"""The one home of segment leaderboard ranking."""

PUBLIC_LEADERBOARD_DEPTH = 10


def rank_efforts(efforts: list[dict]) -> list[dict]:
    """One entry per athlete, their fastest effort, ranked by time then earlier start."""
    fastest: dict[int, dict] = {}
    for effort in efforts:
        current = fastest.get(effort["athlete_id"])
        if current is None or (effort["elapsed_time_s"], effort["start_time"]) < (
            current["elapsed_time_s"],
            current["start_time"],
        ):
            fastest[effort["athlete_id"]] = effort
    ordered = sorted(fastest.values(), key=lambda e: (e["elapsed_time_s"], e["start_time"]))
    return [
        {
            "rank": position,
            "athlete_id": effort["athlete_id"],
            "athlete_name": effort["athlete_name"],
            "elapsed_time_s": effort["elapsed_time_s"],
            "activity_id": effort["activity_id"],
            "start_time": effort["start_time"],
        }
        for position, effort in enumerate(ordered, start=1)
    ]
