"""The browser's copy of the shared rules: generated from the Python declarations, never written twice."""

import json

from . import alignment, curves, exposure, imaging, validation


def domain_script() -> str:
    """An ES module exporting the aperture table, exposure constants, field limits and field copy."""
    shared = {
        "APERTURES": list(exposure.APERTURES),
        "DEFAULT_APERTURE": exposure.DEFAULT_APERTURE,
        "LOG_H_PER_STOP": exposure.LOG_H_PER_STOP,
        "EV_RANGE": [exposure.EV_MIN, exposure.EV_MAX],
        "SHUTTER_DENOMINATORS": list(exposure.SHUTTER_DENOMINATORS),
        "SHUTTER_WHOLE_SECONDS": list(exposure.SHUTTER_WHOLE_SECONDS),
        "LIMITS": validation.LIMITS,
        "MESSAGES": validation.MESSAGES,
        "RANGES": {"ei": validation.EI_RANGE, "push_pull": validation.PUSH_PULL_RANGE,
                   "reciprocity_p": validation.RECIPROCITY_RANGE, "counter": validation.COUNTER_RANGE,
                   "dpi": validation.DPI_RANGE, "first_edge": validation.FIRST_EDGE_RANGE,
                   "password": validation.PASSWORD_LENGTH, "offset": alignment.OFFSET_RANGE},
        "CURVE_READY": {"frames": curves.MIN_BRACKET_FRAMES, "span": curves.MIN_BRACKET_SPAN},
        "SLICE_WIDTH": imaging.PREVIEW_SLICE_WIDTH,
        "UPLOAD_LIMIT": validation.UPLOAD_LIMIT,
    }
    return "".join(f"export const {name} = {json.dumps(value, ensure_ascii=False)};\n" for name, value in shared.items())
