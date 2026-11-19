"""Calibration matching, the refusal text and the staleness windows, decided once."""
from typing import Any

MAX_AGE_DAYS = {"dark": 180, "flat": 30, "bias": 365}
TEMPERATURE_TOLERANCE_TENTHS = 20
COMPARED_FIELDS = {
    "dark": ("camera", "binning", "gain", "offset", "exposure", "temperature"),
    "bias": ("camera", "binning", "gain", "offset"),
    "flat": ("camera", "binning", "filter"),
}


def reported_status(stored: str, age_days: int, kind: str) -> str:
    return "stale" if stored == "ready" and age_days > MAX_AGE_DAYS[kind] else stored


def _tenths(value: float) -> int:
    return round(value * 10)


def _values(calibration_set: dict[str, Any], batch: dict[str, Any], field: str) -> tuple[Any, Any]:
    if field == "exposure":
        return calibration_set["exposure_s"], batch["exposure_s"]
    if field == "temperature":
        return calibration_set["temperature_c"], batch["temperature_c"]
    return calibration_set[field], batch[field]


def reason(entry: dict[str, Any]) -> str:
    field, set_value, batch_value = entry["field"], entry["set"], entry["batch"]
    if field == "exposure":
        return f"exposure {set_value} s does not match {batch_value} s"
    if field == "temperature":
        return f"temperature {set_value:.1f} C is more than 2.0 C from {batch_value:.1f} C"
    return f"{field} {set_value} does not match {batch_value}"


def mismatches(calibration_set: dict[str, Any], batch: dict[str, Any]) -> list[dict[str, Any]]:
    """Every failing field, in the order the refusal lists them."""
    found = []
    for field in COMPARED_FIELDS[calibration_set["kind"]]:
        set_value, batch_value = _values(calibration_set, batch, field)
        if field == "temperature":
            matches = abs(_tenths(set_value) - _tenths(batch_value)) <= TEMPERATURE_TOLERANCE_TENTHS
        else:
            matches = set_value == batch_value
        if not matches:
            found.append({"field": field, "set": set_value, "batch": batch_value})
    return found


def refusal_message(failing: list[dict[str, Any]]) -> str:
    reasons = "; ".join(reason(entry) for entry in failing)
    return f"Calibration refused: {reasons}."
