"""Server-side masking for the trusted contact's view."""
from __future__ import annotations

from typing import Final

MASKED_LEVELS: Final[frozenset[str]] = frozenset({"critical", "high"})
KEPT_CHARACTERS: Final = 4


def mask_value(value: str, level: str) -> str:
    """Mask a value for a trusted contact: Critical and High keep only their last four
    letters or digits; Moderate and Low show in full."""
    if level not in MASKED_LEVELS:
        return value
    alphanumeric = [index for index, char in enumerate(value) if char.isalnum()]
    kept = set(alphanumeric[-KEPT_CHARACTERS:]) if len(alphanumeric) > KEPT_CHARACTERS else set()
    return "".join(
        "*" if char.isalnum() and index not in kept else char
        for index, char in enumerate(value)
    )
