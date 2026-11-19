"""Spreading one typed total across a run of hours by last week's weights."""

from __future__ import annotations

from datetime import datetime

from .model import Hour
from .repair import week_earlier_source

MINIMUM_HOURS = 2
MAXIMUM_HOURS = 168


def weights(
    hours: list[Hour], chosen: list[datetime], time_zone: str
) -> list[int]:
    """Last week's consumption as weights, or 1 each when any source is absent."""
    by_hour = {hour.hour_utc: hour for hour in hours}
    found = [week_earlier_source(by_hour, hour_utc, time_zone) for hour_utc in chosen]
    if any(value is None for value in found) or sum(found) == 0:  # type: ignore[arg-type]
        return [1] * len(chosen)
    return [value for value in found]  # type: ignore[misc]


def shares(total_wh: int, weight_list: list[int]) -> list[int]:
    """Floor shares by weight, with the remainder going to the largest remainders."""
    total_weight = sum(weight_list)
    products = [total_wh * weight for weight in weight_list]
    allotted = [product // total_weight for product in products]
    remainders = sorted(
        range(len(weight_list)),
        key=lambda index: (-(products[index] % total_weight), index),
    )
    left_over = total_wh - sum(allotted)
    for index in remainders[:left_over]:
        allotted[index] += 1
    return allotted
