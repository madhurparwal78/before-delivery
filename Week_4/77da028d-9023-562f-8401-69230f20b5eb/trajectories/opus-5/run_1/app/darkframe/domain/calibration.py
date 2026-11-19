"""Calibration set ages, matching and the refusal message."""

from __future__ import annotations

from dataclasses import dataclass

BUILDING = "building"
READY = "ready"
STALE = "stale"
RETIRED = "retired"

KINDS: tuple[str, ...] = ("dark", "flat", "bias")
MAX_AGE_DAYS: dict[str, int] = {"dark": 180, "flat": 30, "bias": 365}

COMPARED_FIELDS: dict[str, tuple[str, ...]] = {
    "dark": ("camera", "binning", "gain", "offset", "exposure", "temperature"),
    "bias": ("camera", "binning", "gain", "offset"),
    "flat": ("camera", "binning", "filter"),
}
REASON_ORDER: tuple[str, ...] = (
    "camera",
    "binning",
    "gain",
    "offset",
    "exposure",
    "temperature",
    "filter",
)
TEMPERATURE_TOLERANCE_C = 2.0


@dataclass(frozen=True)
class SetFacts:
    kind: str
    camera: str
    gain: int
    offset: int
    exposure_s: int | None
    temperature_c: float
    binning: int
    filter: str | None


@dataclass(frozen=True)
class BatchFacts:
    camera: str
    gain: int
    offset: int
    exposure_s: int
    temperature_c: float
    binning: int
    filter: str


@dataclass(frozen=True)
class Mismatch:
    field: str
    set_value: object
    batch_value: object
    reason: str


def reported_status(stored_status: str, age_days: int, kind: str) -> str:
    """A ready set past its age window is reported as stale."""
    if stored_status == READY and age_days > MAX_AGE_DAYS[kind]:
        return STALE
    return stored_status


def calibrates(reported: str) -> bool:
    return reported in (READY, STALE)


def mismatches(candidate: SetFacts, batch: BatchFacts) -> list[Mismatch]:
    compared = COMPARED_FIELDS[candidate.kind]
    found: list[Mismatch] = []
    for field in REASON_ORDER:
        if field not in compared:
            continue
        if field == "camera" and candidate.camera != batch.camera:
            found.append(
                Mismatch(
                    "camera",
                    candidate.camera,
                    batch.camera,
                    f"camera {candidate.camera} does not match {batch.camera}",
                )
            )
        elif field == "binning" and candidate.binning != batch.binning:
            found.append(
                Mismatch(
                    "binning",
                    candidate.binning,
                    batch.binning,
                    f"binning {candidate.binning} does not match {batch.binning}",
                )
            )
        elif field == "gain" and candidate.gain != batch.gain:
            found.append(
                Mismatch(
                    "gain",
                    candidate.gain,
                    batch.gain,
                    f"gain {candidate.gain} does not match {batch.gain}",
                )
            )
        elif field == "offset" and candidate.offset != batch.offset:
            found.append(
                Mismatch(
                    "offset",
                    candidate.offset,
                    batch.offset,
                    f"offset {candidate.offset} does not match {batch.offset}",
                )
            )
        elif field == "exposure" and candidate.exposure_s != batch.exposure_s:
            found.append(
                Mismatch(
                    "exposure",
                    candidate.exposure_s,
                    batch.exposure_s,
                    f"exposure {candidate.exposure_s} s does not match "
                    f"{batch.exposure_s} s",
                )
            )
        elif field == "temperature" and (
            abs(candidate.temperature_c - batch.temperature_c)
            > TEMPERATURE_TOLERANCE_C
        ):
            found.append(
                Mismatch(
                    "temperature",
                    candidate.temperature_c,
                    batch.temperature_c,
                    f"temperature {candidate.temperature_c:.1f} C is more than "
                    f"{TEMPERATURE_TOLERANCE_C:.1f} C from {batch.temperature_c:.1f} C",
                )
            )
        elif field == "filter" and candidate.filter != batch.filter:
            found.append(
                Mismatch(
                    "filter",
                    candidate.filter,
                    batch.filter,
                    f"filter {candidate.filter} does not match {batch.filter}",
                )
            )
    return found


def refusal_message(found: list[Mismatch]) -> str:
    return "Calibration refused: " + "; ".join(item.reason for item in found) + "."
