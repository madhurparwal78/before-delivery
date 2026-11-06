"""Calibration, frame detection, matching, proposal, counters and curves.

Each rule named in the brief is decided exactly once here: density from a
calibration, the frame pipeline, the offset-and-slip match, the Spearman
proposal, the four counters and the characteristic-curve figures.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .exposure import round_half_away

MIN_SAMPLE_AREA = 8
WEDGE_MIN_WIDTH = 42
WEDGE_STEPS = 21
WEDGE_NOMINAL_FIRST = 0.05
WEDGE_NOMINAL_STEP = 0.15
MAX_DENSITY = 3.0
UNEXPOSED_NET = 0.05
GAP_BRIGHT_FRACTION = 0.8
BAND_TOP = 0.2
BAND_BOTTOM = 0.8
SHORT_RUN_FRACTION = 0.25
CUT_FRACTION = 0.5
WIDTH_TOLERANCE = 0.06
CENTRAL_FRACTION = 0.2

FORMATS: dict[str, dict[str, float]] = {
    "35mm": {"pitch": 38.0, "image_width": 36.0},
    "120-6x6": {"pitch": 62.0, "image_width": 56.0},
    "120-6x7": {"pitch": 72.0, "image_width": 70.0},
}


@dataclass
class Calibration:
    """One calibration: what it saw and how to turn linear values into density."""

    method: str  # clear_light | step_wedge
    reference: float | None  # mean linear value of the clear patch
    step_means: list[float] | None  # 21 mean linear values, least dense first
    step_logs: list[float] | None
    step_nominals: list[float] | None

    @classmethod
    def clear_light(cls, reference: float) -> "Calibration":
        return cls(method="clear_light", reference=reference, step_means=None,
                   step_logs=None, step_nominals=None)

    @classmethod
    def step_wedge(cls, means: list[float]) -> "Calibration":
        logs = [math.log10(m) if m > 0 else -math.inf for m in means]
        nominals = [WEDGE_NOMINAL_FIRST + WEDGE_NOMINAL_STEP * k for k in range(len(means))]
        return cls(method="step_wedge", reference=None, step_means=means,
                   step_logs=logs, step_nominals=nominals)

    def density(self, linear: float) -> float:
        """Gross density of one linear value, clamped to 0.00 to 3.00."""
        if self.method == "clear_light":
            reference = self.reference or 0.0
            if linear <= 0:
                return MAX_DENSITY
            return _clamp(math.log10(reference / linear))
        logs = self.step_logs or []
        nominals = self.step_nominals or []
        if linear <= 0:
            return MAX_DENSITY
        value = math.log10(linear)
        return _clamp(_piecewise(logs, nominals, value))


def _clamp(value: float) -> float:
    return max(0.0, min(MAX_DENSITY, value))


def _piecewise(xs: list[float], ys: list[float], x: float) -> float:
    """Interpolate ys against xs; the end segments extend beyond either end."""
    if x <= xs[0]:
        slope = _slope(xs, ys, 0)
        return ys[0] + slope * (x - xs[0])
    if x >= xs[-1]:
        slope = _slope(xs, ys, len(xs) - 2)
        return ys[-1] + slope * (x - xs[-1])
    for i in range(len(xs) - 1):
        if xs[i] <= x <= xs[i + 1]:
            slope = _slope(xs, ys, i)
            return ys[i] + slope * (x - xs[i])
    return ys[-1]


def _slope(xs: list[float], ys: list[float], i: int) -> float:
    if xs[i + 1] == xs[i]:
        return 0.0
    return (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])


def mean_linear(linear: np.ndarray) -> float:
    """Every mean in the product is a mean of linear values."""
    return float(np.mean(linear)) if linear.size else 0.0


def wedge_means(linear: np.ndarray, x: int, y: int, w: int, h: int) -> list[float]:
    """The 21 step means of a wedge area, least dense step at the left."""
    means = []
    for k in range(WEDGE_STEPS):
        start = x + (k * w) // WEDGE_STEPS
        end = x + ((k + 1) * w) // WEDGE_STEPS
        if end <= start:
            means.append(0.0)
            continue
        means.append(mean_linear(linear[y:y + h, start:end]))
    return means


def wedge_in_order(means: list[float]) -> bool:
    return all(means[k] > means[k + 1] for k in range(len(means) - 1))


@dataclass
class FrameEdges:
    x0: int
    x1: int
    blank_slot: bool


@dataclass
class DetectedFrame:
    number: int
    edge_number: int
    x0: int
    x1: int
    flag: str  # ok | flagged | accepted
    blank_slot: bool


def _maximal_runs(is_gap: "np.ndarray") -> list[tuple[int, int]]:
    """Maximal runs of non-gap columns as [x0, x1)."""
    runs: list[tuple[int, int]] = []
    width = len(is_gap)
    start = None
    for x in range(width):
        if not is_gap[x] and start is None:
            start = x
        elif is_gap[x] and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, width))
    return runs


def detect_frames(linear: np.ndarray, format_name: str, dpi: int,
                  first_edge: int) -> tuple[list[DetectedFrame], float]:
    """Find frames on a calibrated scan; returns frames and base plus fog."""
    height, width = linear.shape[0], linear.shape[1]
    band_top = int(BAND_TOP * height)
    band_bottom = int(BAND_BOTTOM * height)
    band = linear[band_top:band_bottom, :width]
    column_values = np.mean(band, axis=0)
    brightest = float(np.max(column_values))
    threshold = GAP_BRIGHT_FRACTION * brightest
    is_gap = column_values >= threshold

    spec = FORMATS[format_name]
    pitch = spec["pitch"] * dpi / 25.4
    expected_width = spec["image_width"] * dpi / 25.4

    runs = _maximal_runs(is_gap)
    kept: list[tuple[int, int]] = []
    for start, end in runs:
        if end - start <= (SHORT_RUN_FRACTION * pitch):
            continue
        touches_edge = start == 0 or end == width
        if touches_edge and (end - start) < CUT_FRACTION * expected_width:
            continue
        kept.append((start, end))

    if not kept:
        return [], float("nan")

    frames_with_slots: list[tuple[int, int, bool]] = []
    for index, (start, end) in enumerate(kept):
        frames_with_slots.append((start, end, False))
        if index + 1 < len(kept):
            next_start = kept[index + 1][0]
            count = int(round((next_start - start) / pitch)) - 1
            for i in range(1, count + 1):
                slot_x0 = int(round(start + i * pitch))
                slot_x1 = slot_x0 + int(round(expected_width))
                frames_with_slots.append((slot_x0, slot_x1, True))

    frames_with_slots.sort(key=lambda item: item[0])
    gap_columns = np.where(is_gap)[0]

    detected: list[DetectedFrame] = []
    for index, (x0, x1, blank) in enumerate(frames_with_slots):
        flag = "ok"
        if not blank:
            frame_width = x1 - x0
            limit = WIDTH_TOLERANCE * expected_width
            if abs(frame_width - expected_width) > limit:
                flag = "flagged"
        detected.append(DetectedFrame(
            number=index + 1, edge_number=first_edge + index, x0=x0, x1=x1,
            flag=flag, blank_slot=blank))

    base_fog = _base_fog(detected, gap_columns, calibration=None,
                        column_values=column_values)
    return detected, base_fog


def _base_fog(frames: list[DetectedFrame], gap_columns: np.ndarray,
              calibration: Calibration | None, column_values: np.ndarray | None) -> float:
    """Median gross density of the brightest gap columns inside no frame."""
    if len(gap_columns) == 0:
        return 0.0
    inside = np.ones(len(gap_columns), dtype=bool)
    for frame in frames:
        inside &= ~((gap_columns >= frame.x0) & (gap_columns < frame.x1))
    usable = gap_columns[inside]
    if usable.size == 0:
        usable = gap_columns
    values = np.sort(column_values[usable])
    return float(np.median(values))


def compute_frame_density(linear: np.ndarray, calibration: Calibration, x0: int,
                          x1: int, base_fog: float) -> tuple[float, float, bool]:
    """Mean density over the central 60% of columns, net and unexposed status."""
    height = linear.shape[0]
    band_top = int(BAND_TOP * height)
    band_bottom = int(BAND_BOTTOM * height)
    width = x1 - x0
    start = x0 + int(CENTRAL_FRACTION * width)
    end = x1 - int(CENTRAL_FRACTION * width)
    if end <= start:
        start, end = x0, x1
    block = linear[band_top:band_bottom, start:end]
    mean = mean_linear(block)
    mean_density = calibration.density(mean)
    net = mean_density - base_fog
    return mean_density, net, net <= UNEXPOSED_NET


def recompute_frames(linear: np.ndarray, calibration: Calibration,
                     frames: list[DetectedFrame]) -> tuple[float, list[tuple[float, float, bool]]]:
    """Base plus fog and every frame's density from the stored original."""
    height, width = linear.shape[0], linear.shape[1]
    band_top = int(BAND_TOP * height)
    band_bottom = int(BAND_BOTTOM * height)
    band = linear[band_top:band_bottom, :width]
    column_values = np.mean(band, axis=0)
    brightest = float(np.max(column_values))
    threshold = GAP_BRIGHT_FRACTION * brightest
    is_gap = column_values >= threshold
    gap_columns = np.where(is_gap)[0]

    first = frames[0] if frames else None
    last = frames[-1] if frames else None
    between = gap_columns
    if first is not None and last is not None:
        mask = (gap_columns >= first.x1) & (gap_columns < last.x0)
        between = gap_columns[mask]
    if between.size == 0:
        between = gap_columns
    if between.size == 0:
        base_fog = 0.0
    else:
        def density_of(columns: np.ndarray) -> float:
            values = np.sort(column_values[columns])
            return calibration.density(float(np.median(values)))
        base_fog = density_of(between)

    densities: list[tuple[float, float, bool]] = []
    for frame in frames:
        densities.append(compute_frame_density(linear, calibration, frame.x0, frame.x1, base_fog))
    return base_fog, densities


def sample_cell(x: int, y: int) -> tuple[int, int]:
    """The 8×8 block that holds a scan-pixel point."""
    return (x // 8) * 8, (y // 8) * 8


def cell_density(linear: np.ndarray, calibration: Calibration, cell_x: int,
                 cell_y: int, base_fog: float | None) -> tuple[float, float | None]:
    """Gross density of a sample cell and its net above base plus fog."""
    height, width = linear.shape[0], linear.shape[1]
    y0 = min(cell_y, height)
    y1 = min(cell_y + 8, height)
    x0 = min(cell_x, width)
    x1 = min(cell_x + 8, width)
    block = linear[y0:y1, x0:x1]
    if block.size == 0:
        return MAX_DENSITY, None
    mean = mean_linear(block)
    gross = calibration.density(mean)
    net = None if base_fog is None else gross - base_fog
    return gross, net


def width_mm(x0: int, x1: int, dpi: int) -> float:
    return round_half_away((x1 - x0) * 25.4 / dpi, 1)


def frame_width_flag(x0: int, x1: int, format_name: str, dpi: int) -> str:
    expected = FORMATS[format_name]["image_width"] * dpi / 25.4
    limit = WIDTH_TOLERANCE * expected
    return "ok" if abs((x1 - x0) - expected) <= limit else "flagged"
