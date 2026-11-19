"""The seven filters, their order, their windows and their Moon distances."""

from __future__ import annotations

FILTER_ORDER: tuple[str, ...] = ("L", "R", "G", "B", "Ha", "OIII", "SII")
NARROWBAND: frozenset[str] = frozenset({"Ha", "OIII", "SII"})
NARROWBAND_MARGIN_MINUTES = 30

MOON_MINIMUM_SEPARATION_DEG: dict[str, float] = {
    "L": 60.0,
    "R": 60.0,
    "G": 60.0,
    "B": 60.0,
    "OIII": 45.0,
    "Ha": 30.0,
    "SII": 30.0,
}


def is_filter(name: object) -> bool:
    return isinstance(name, str) and name in FILTER_ORDER


def filter_sort_key(name: str) -> int:
    return FILTER_ORDER.index(name)


def filter_window(name: str, night_minutes: int) -> tuple[int, int]:
    """The half-open window of night minutes a filter may use."""
    if night_minutes == 0:
        return (0, 0)
    if name in NARROWBAND:
        return (-NARROWBAND_MARGIN_MINUTES, night_minutes + NARROWBAND_MARGIN_MINUTES)
    return (0, night_minutes)
