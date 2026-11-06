"""Frame detection on a strip, width flags, nudges and base plus fog."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .density import Densitometer

GAP_BRIGHTNESS = 0.80
SHORT_RUN_PITCH_SHARE = 0.25
CUT_FRAME_SHARE = 0.50
WIDTH_TOLERANCE = 0.06
BAND_TOP = 0.2
BAND_BOTTOM = 0.8
FRAME_CENTRAL_SHARE = 0.2
UNEXPOSED_NET_DENSITY = 0.05
MIN_EDGE_GAP = 8

FORMAT_PITCH_MM = {"35mm": 38.0, "120-6x6": 62.0, "120-6x7": 72.0}
FORMAT_IMAGE_WIDTH_MM = {"35mm": 36.0, "120-6x6": 56.0, "120-6x7": 70.0}


def mm_to_px(mm: float, dpi: int) -> float:
    return mm * dpi / 25.4


def pitch_px(roll_format: str, dpi: int) -> float:
    return mm_to_px(FORMAT_PITCH_MM[roll_format], dpi)


def expected_width_px(roll_format: str, dpi: int) -> float:
    return mm_to_px(FORMAT_IMAGE_WIDTH_MM[roll_format], dpi)


def width_mm(x0: int, x1: int, dpi: int) -> float:
    return (x1 - x0) * 25.4 / dpi


def width_flag(x0: int, x1: int, roll_format: str, dpi: int, blank_slot: bool) -> str:
    if blank_slot:
        return "ok"
    expected = expected_width_px(roll_format, dpi)
    if abs((x1 - x0) - expected) > WIDTH_TOLERANCE * expected:
        return "flagged"
    return "ok"


@dataclass(frozen=True)
class Slot:
    x0: int
    x1: int
    blank_slot: bool


@dataclass(frozen=True)
class StripAnalysis:
    """The column figures a strip's densities are read from."""

    columns: np.ndarray
    gap_columns: np.ndarray
    band: np.ndarray


def analyse(linear: np.ndarray) -> StripAnalysis:
    height = linear.shape[0]
    top = math.ceil(BAND_TOP * height)
    bottom = math.ceil(BAND_BOTTOM * height)
    band = linear[top:bottom, :]
    columns = band.mean(axis=0)
    brightest = float(columns.max()) if columns.size else 0.0
    gap_columns = columns >= GAP_BRIGHTNESS * brightest
    return StripAnalysis(columns=columns, gap_columns=gap_columns, band=band)


def detect_slots(analysis: StripAnalysis, roll_format: str, dpi: int) -> list[Slot]:
    """Runs between the brighter gaps, cut frames dropped, blank slots inserted."""
    width = analysis.gap_columns.size
    pitch = pitch_px(roll_format, dpi)
    expected = expected_width_px(roll_format, dpi)
    runs = _non_gap_runs(analysis.gap_columns)
    kept: list[tuple[int, int]] = []
    for x0, x1 in runs:
        if (x1 - x0) < SHORT_RUN_PITCH_SHARE * pitch:
            continue
        touches_edge = x0 == 0 or x1 == width
        if touches_edge and (x1 - x0) < CUT_FRAME_SHARE * expected:
            continue
        kept.append((x0, x1))
    slots: list[Slot] = []
    for index, (x0, x1) in enumerate(kept):
        slots.append(Slot(x0, x1, False))
        if index + 1 < len(kept):
            next_x0 = kept[index + 1][0]
            blanks = round((next_x0 - x0) / pitch) - 1
            for i in range(1, blanks + 1):
                start = round(x0 + i * pitch)
                slots.append(Slot(start, start + round(expected), True))
    return slots


def _non_gap_runs(gap_columns: np.ndarray) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, is_gap in enumerate(gap_columns.tolist()):
        if not is_gap and start is None:
            start = index
        elif is_gap and start is not None:
            runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, gap_columns.size))
    return runs


def frame_mean_density(
    analysis: StripAnalysis, densitometer: Densitometer, x0: int, x1: int
) -> float:
    """The gross density of the mean linear value over the frame's central 60%."""
    span = x1 - x0
    start = int(math.ceil(x0 + FRAME_CENTRAL_SHARE * span))
    stop = int(math.floor(x1 - FRAME_CENTRAL_SHARE * span))
    if stop <= start:
        start, stop = x0, x1
    block = analysis.band[:, start:stop]
    return densitometer.density(float(block.mean()))


def base_plus_fog(
    analysis: StripAnalysis,
    densitometer: Densitometer,
    slots: list[tuple[int, int]],
) -> float:
    """The median gross density of the gap columns between the outer frames."""
    gap_columns = analysis.gap_columns
    candidates = np.zeros(gap_columns.size, dtype=bool)
    if slots:
        first_x1 = slots[0][1]
        last_x0 = slots[-1][0]
        candidates[first_x1:last_x0] = True
        for x0, x1 in slots:
            candidates[x0:x1] = False
    chosen = gap_columns & candidates
    if not chosen.any():
        chosen = gap_columns
    values = analysis.columns[chosen]
    return float(np.median(densitometer.densities(values)))


def net_density(mean_density: float, base_fog: float) -> float:
    return mean_density - base_fog


def is_unexposed(net: float) -> bool:
    return net <= UNEXPOSED_NET_DENSITY


def edges_allowed(
    x0: int,
    x1: int,
    scan_width: int,
    neighbours: list[tuple[int, int]],
) -> bool:
    if not 0 <= x0 < x1 <= scan_width:
        return False
    if x1 - x0 < MIN_EDGE_GAP:
        return False
    return all(x0 >= other_x1 or x1 <= other_x0 for other_x0, other_x1 in neighbours)
