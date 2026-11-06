"""Calibration and density: the only place a linear value becomes a density."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .rounding import round_half_away

MIN_DENSITY = 0.00
MAX_DENSITY = 3.00
WEDGE_STEPS = 21
MIN_AREA_SIDE = 8
MIN_WEDGE_WIDTH = 42
MIN_WEDGE_HEIGHT = 8
SAMPLE_CELL = 8


def nominal_step_density(k: int) -> float:
    return 0.05 + 0.15 * k


@dataclass(frozen=True)
class Area:
    x: int
    y: int
    w: int
    h: int

    def inside(self, width: int, height: int) -> bool:
        return (
            self.w >= 1
            and self.h >= 1
            and 0 <= self.x
            and 0 <= self.y
            and self.x + self.w <= width
            and self.y + self.h <= height
        )

    def crop(self, linear: np.ndarray) -> np.ndarray:
        return linear[self.y : self.y + self.h, self.x : self.x + self.w]


class WedgeOrderError(Exception):
    """A wedge whose steps do not darken from left to right."""


@dataclass(frozen=True)
class Densitometer:
    """A scan's current calibration, turned into gross densities."""

    method: str
    reference: float | None
    step_values: tuple[float, ...] | None

    def density(self, linear: float) -> float:
        return float(self.densities(np.array([linear], dtype=np.float64))[0])

    def densities(self, linear: np.ndarray) -> np.ndarray:
        values = np.asarray(linear, dtype=np.float64)
        dark = values <= 0
        safe = np.where(dark, 1.0, values)
        if self.method == "clear_light":
            assert self.reference is not None
            reference = self.reference if self.reference > 0 else 1.0
            out = np.log10(reference / safe)
        else:
            assert self.step_values is not None
            nominals = np.array(
                [nominal_step_density(k) for k in range(len(self.step_values))]
            )
            step_logs = np.log10(np.clip(np.array(self.step_values), 1e-12, None))
            order = np.argsort(step_logs)
            out = np.interp(
                np.log10(safe), step_logs[order], nominals[order]
            )
            out = _extend_ends(np.log10(safe), step_logs[order], nominals[order], out)
        out = np.where(dark, MAX_DENSITY, out)
        return np.clip(out, MIN_DENSITY, MAX_DENSITY)


def _extend_ends(
    sample_logs: np.ndarray,
    step_logs: np.ndarray,
    nominals: np.ndarray,
    interpolated: np.ndarray,
) -> np.ndarray:
    """Beyond either end of the wedge, the end segment is extended."""
    out = interpolated.copy()
    below = sample_logs < step_logs[0]
    above = sample_logs > step_logs[-1]
    if below.any():
        slope = (nominals[1] - nominals[0]) / (step_logs[1] - step_logs[0])
        out[below] = nominals[0] + (sample_logs[below] - step_logs[0]) * slope
    if above.any():
        slope = (nominals[-1] - nominals[-2]) / (step_logs[-1] - step_logs[-2])
        out[above] = nominals[-1] + (sample_logs[above] - step_logs[-1]) * slope
    return out


def clear_light_reference(linear: np.ndarray, area: Area) -> float:
    return float(area.crop(linear).mean())


def wedge_step_values(linear: np.ndarray, area: Area) -> list[float]:
    """The 21 step means, left to right, as the published split defines them."""
    values: list[float] = []
    for k in range(WEDGE_STEPS):
        start = area.x + (k * area.w) // WEDGE_STEPS
        stop = area.x + ((k + 1) * area.w) // WEDGE_STEPS
        block = linear[area.y : area.y + area.h, start:stop]
        values.append(float(block.mean()))
    for earlier, later in zip(values, values[1:]):
        if not later < earlier:
            raise WedgeOrderError
    return values


def densitometer_from_calibration(calibration: dict) -> Densitometer:
    steps = calibration.get("steps")
    return Densitometer(
        method=calibration["method"],
        reference=(
            float(calibration["reference"]) if calibration.get("reference") is not None else None
        ),
        step_values=tuple(float(step["value"]) for step in steps) if steps else None,
    )


def sample_cell_origin(x: int, y: int) -> tuple[int, int]:
    return SAMPLE_CELL * (x // SAMPLE_CELL), SAMPLE_CELL * (y // SAMPLE_CELL)


def sample_cell_mean(linear: np.ndarray, x: int, y: int) -> float:
    """The mean linear value of the 8x8 cell holding (x, y), cut at the edges."""
    height, width = linear.shape
    x0, y0 = sample_cell_origin(x, y)
    block = linear[y0 : min(y0 + SAMPLE_CELL, height), x0 : min(x0 + SAMPLE_CELL, width)]
    return float(block.mean())


def round_density(value: float) -> float:
    return round_half_away(value, 2)
