"""Effective-dated floors, shortfalls and breach labels."""

from __future__ import annotations

from datetime import date

from ..db import rows


def floor_versions(conn, unit_ids: list[str]) -> list[dict]:
    if not unit_ids:
        return []
    marks = ",".join(["%s"] * len(unit_ids))
    return rows(
        conn,
        f"""SELECT id, home_id, unit_id, shift, min_staff, min_seniors, effective_from,
                   created_by, created_at
            FROM floor_versions WHERE unit_id IN ({marks})
            ORDER BY effective_from DESC, id DESC""",
        tuple(unit_ids),
    )


class FloorBook:
    """The floor versions of some units, answering which one is in force on a date."""

    def __init__(self, versions: list[dict]):
        self._versions = versions

    def in_force(self, unit_id: str, shift: str, on: date) -> dict:
        """The version with the latest effective_from on or before the shift's date."""
        candidates = [
            version
            for version in self._versions
            if version["unit_id"] == unit_id
            and version["shift"] == shift
            and version["effective_from"] <= on
        ]
        if not candidates:
            return {"min_staff": 0, "min_seniors": 0, "effective_from": None}
        return max(candidates, key=lambda version: version["effective_from"])


def load_floors(conn, unit_ids: list[str]) -> FloorBook:
    return FloorBook(floor_versions(conn, unit_ids))


def shortfall(min_staff: int, on_duty: int) -> int:
    return max(0, min_staff - on_duty)


def breach_labels(staff_shortfall: int, senior_shortfall: int) -> list[str]:
    """A shift's breach labels come from its two shortfalls alone."""
    labels = []
    if staff_shortfall > 0:
        labels.append(f"-{staff_shortfall} below floor")
    if senior_shortfall > 0:
        labels.append("no senior on shift")
    return labels
