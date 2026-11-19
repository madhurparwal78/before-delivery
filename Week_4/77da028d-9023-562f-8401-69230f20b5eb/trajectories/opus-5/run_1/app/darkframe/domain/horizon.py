"""The 72-bin horizon mask and the position status it decides."""

from __future__ import annotations

BIN_COUNT = 72
BIN_WIDTH_DEG = 360 // BIN_COUNT

CLEAR = "clear"
BEHIND_TREELINE = "behind-treeline"
BELOW_MINIMUM = "below-minimum"
BELOW_HORIZON = "below-horizon"


def bin_of(azimuth_deg: float) -> int:
    """Bin `i` covers azimuths from 5i up to but not including 5i + 5."""
    return int(azimuth_deg % 360.0) // BIN_WIDTH_DEG


def mask_altitude(mask: list[int], azimuth_deg: float) -> int:
    return mask[bin_of(azimuth_deg)]


def position_status(
    altitude_deg: float, azimuth_deg: float, mask: list[int], min_altitude_deg: int
) -> str:
    if altitude_deg < 0:
        return BELOW_HORIZON
    treeline = mask_altitude(mask, azimuth_deg)
    if altitude_deg < treeline and treeline >= min_altitude_deg:
        return BEHIND_TREELINE
    if altitude_deg < min_altitude_deg:
        return BELOW_MINIMUM
    return CLEAR


def default_mask() -> list[int]:
    return [0] * BIN_COUNT


def valid_mask(altitudes: object) -> bool:
    return (
        isinstance(altitudes, list)
        and len(altitudes) == BIN_COUNT
        and all(
            isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 90
            for value in altitudes
        )
    )
