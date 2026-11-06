"""Density from linear values: calibration, frame detection, frame and cell readings, base plus fog."""

import math
from dataclasses import dataclass

import numpy as np

SAMPLE_CELL = 8
WEDGE_STEPS = 21
MIN_AREA = 8
MIN_WEDGE_WIDTH = 42
MAX_DENSITY = 3.0
UNEXPOSED_NET = 0.05
GAP_FRACTION = 0.8
WIDTH_TOLERANCE = 0.06
BAND_TOP, BAND_BOTTOM = 0.2, 0.8
CENTRAL_MARGIN = 0.2
MM_PER_INCH = 25.4
# Film format -> (pitch mm, expected image width mm)
FORMAT_MM = {"35mm": (38.0, 36.0), "120-6x6": (62.0, 56.0), "120-6x7": (72.0, 70.0)}


def round_half_up(value: float) -> int:
    """Whole-number rounding for positive pixel sizes."""
    return math.floor(value + 0.5)


def wedge_nominal(step: int) -> float:
    return 0.05 + 0.15 * step


@dataclass(frozen=True, slots=True)
class Area:
    x: int
    y: int
    w: int
    h: int


def _clamped(raw: np.ndarray, positive: np.ndarray) -> np.ndarray:
    """Density limited to 0.00 to 3.00; a linear value of 0 is density 3.00."""
    return np.where(positive, np.clip(raw, 0.0, MAX_DENSITY), MAX_DENSITY)


@dataclass(frozen=True, slots=True)
class ClearLight:
    """Density is log10(reference / linear value) against a marked clear-light patch."""

    reference: float
    method = "clear_light"

    def density(self, linear: np.ndarray | float) -> np.ndarray:
        values = np.asarray(linear, dtype=np.float64)
        positive = values > 0
        return _clamped(np.log10(self.reference) - np.log10(np.where(positive, values, 1.0)), positive)


@dataclass(frozen=True, slots=True)
class StepWedge:
    """Density is read off the 21 scanned step means at their nominal densities, piecewise linear in log10."""

    step_means: tuple[float, ...]
    method = "step_wedge"

    def density(self, linear: np.ndarray | float) -> np.ndarray:
        values = np.asarray(linear, dtype=np.float64)
        positive = values > 0
        log_linear = np.log10(np.where(positive, values, 1.0))
        axis = np.log10(np.array(self.step_means))
        nominal = np.array([wedge_nominal(k) for k in range(WEDGE_STEPS)])
        inside = np.interp(log_linear, axis[::-1], nominal[::-1])
        slope_light = (nominal[1] - nominal[0]) / (axis[1] - axis[0])
        slope_dark = (nominal[-1] - nominal[-2]) / (axis[-1] - axis[-2])
        raw = np.where(log_linear > axis[0], nominal[0] + slope_light * (log_linear - axis[0]),
                       np.where(log_linear < axis[-1], nominal[-1] + slope_dark * (log_linear - axis[-1]), inside))
        return _clamped(raw, positive)


Calibration = ClearLight | StepWedge


def area_mean(linear: np.ndarray, area: Area) -> float:
    return float(linear[area.y : area.y + area.h, area.x : area.x + area.w].mean(dtype=np.float64))


def wedge_step_means(linear: np.ndarray, area: Area) -> list[float]:
    """Mean linear value of each of the 21 steps; step k covers columns x + floor(k*w/21) up to x + floor((k+1)*w/21)."""
    means = []
    for step in range(WEDGE_STEPS):
        left = area.x + step * area.w // WEDGE_STEPS
        right = area.x + (step + 1) * area.w // WEDGE_STEPS
        means.append(float(linear[area.y : area.y + area.h, left:right].mean(dtype=np.float64)))
    return means


def wedge_darkens_in_order(means: list[float]) -> bool:
    return all(earlier > later for earlier, later in zip(means, means[1:]))


def band_columns(linear: np.ndarray) -> np.ndarray:
    """Mean linear value of each column over the rows 0.2*height <= y < 0.8*height."""
    height = linear.shape[0]
    rows = np.arange(height)
    inside = (rows >= BAND_TOP * height) & (rows < BAND_BOTTOM * height)
    return linear[inside].mean(axis=0, dtype=np.float64)


def sample_cell_origin(x: int, y: int) -> tuple[int, int]:
    return SAMPLE_CELL * (x // SAMPLE_CELL), SAMPLE_CELL * (y // SAMPLE_CELL)


def cell_linear(linear: np.ndarray, x: int, y: int) -> float:
    """Mean linear value of the 8 x 8 block holding (x, y), cut at the scan's edges."""
    left, top = sample_cell_origin(x, y)
    return float(linear[top : top + SAMPLE_CELL, left : left + SAMPLE_CELL].mean(dtype=np.float64))


@dataclass(frozen=True, slots=True)
class DetectedFrame:
    x0: int
    x1: int
    blank_slot: bool


def expected_pixels(film_format: str, dpi: int) -> tuple[float, float]:
    """(pitch, image width) in scan pixels."""
    pitch_mm, image_mm = FORMAT_MM[film_format]
    return pitch_mm * dpi / MM_PER_INCH, image_mm * dpi / MM_PER_INCH


def gap_columns(band: np.ndarray) -> np.ndarray:
    return band >= GAP_FRACTION * band.max()


def detect_frames(band: np.ndarray, film_format: str, dpi: int) -> list[DetectedFrame]:
    """Frames between the brighter gaps at the format's pitch: short runs and cut end frames dropped, blank slots added."""
    width = len(band)
    pitch, image_width = expected_pixels(film_format, dpi)
    runs, start = [], None
    for column, is_gap in enumerate(gap_columns(band)):
        if not is_gap and start is None:
            start = column
        elif is_gap and start is not None:
            runs.append((start, column))
            start = None
    if start is not None:
        runs.append((start, width))
    kept = [(x0, x1) for x0, x1 in runs if x1 - x0 >= pitch / 4]
    kept = [(x0, x1) for x0, x1 in kept
            if not ((x0 == 0 or x1 == width) and x1 - x0 < 0.5 * image_width)]
    frames: list[DetectedFrame] = []
    for index, (x0, x1) in enumerate(kept):
        frames.append(DetectedFrame(x0, x1, blank_slot=False))
        if index + 1 < len(kept):
            missing = round_half_up((kept[index + 1][0] - x0) / pitch) - 1
            for slot in range(1, missing + 1):
                slot_x0 = round_half_up(x0 + slot * pitch)
                frames.append(DetectedFrame(slot_x0, slot_x0 + round_half_up(image_width), blank_slot=True))
    return frames


def width_flag(x0: int, x1: int, film_format: str, dpi: int) -> str:
    """`flagged` when the width differs from the expected image width by more than 6% of it, otherwise `ok`."""
    _, image_width = expected_pixels(film_format, dpi)
    return "flagged" if abs((x1 - x0) - image_width) > WIDTH_TOLERANCE * image_width else "ok"


def frame_flag(blank_slot: bool, x0: int, x1: int, film_format: str, dpi: int) -> str:
    """The flag a frame starts with, or returns to after a nudge: blank slots are always `ok`."""
    return "ok" if blank_slot else width_flag(x0, x1, film_format, dpi)


def width_mm(x0: int, x1: int, dpi: int) -> float:
    return (x1 - x0) * MM_PER_INCH / dpi


def frame_density(band: np.ndarray, x0: int, x1: int, calibration: Calibration) -> float:
    """Gross density of the mean linear value over the frame's central 60% of columns within the band."""
    span = x1 - x0
    columns = np.arange(x0, x1)
    central = band[columns[(columns >= x0 + CENTRAL_MARGIN * span) & (columns < x1 - CENTRAL_MARGIN * span)]]
    return float(calibration.density(central.mean()))


def base_plus_fog(band: np.ndarray, edges: list[tuple[int, int]], calibration: Calibration) -> float:
    """Median gross density of the gap columns between the first frame and the last that lie in no frame,
    or of every gap column when there are none."""
    ordered = sorted(edges)
    gaps = np.flatnonzero(gap_columns(band))
    between = [column for column in gaps
               if ordered[0][1] <= column < ordered[-1][0] and not any(x0 <= column < x1 for x0, x1 in ordered)]
    chosen = np.array(between) if between else gaps
    return float(np.median(calibration.density(band[chosen])))


def reading_densities(linear: np.ndarray, x: int, y: int, calibration: Calibration,
                      base_fog: float | None) -> tuple[float, float | None]:
    """(gross, net) of the sample cell holding (x, y); net is None before frames exist."""
    gross = float(calibration.density(cell_linear(linear, x, y)))
    return gross, None if base_fog is None else gross - base_fog
