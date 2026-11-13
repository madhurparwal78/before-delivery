"""Masking for trusted contacts: values of Critical and High holdings only."""

from __future__ import annotations

import re

_ALNUM = re.compile(r"[A-Za-z0-9]")


def mask_value(value: str, level: str) -> str:
    """Mask every letter and digit except the last four; keep spaces and punctuation.

    A value with four or fewer letters and digits is fully replaced.
    Moderate and Low values show in full; callers only mask Critical and High.
    """
    if level not in ("critical", "high"):
        return value
    indexes = [m.start() for m in _ALNUM.finditer(value)]
    if len(indexes) <= 4:
        chars = list(value)
        for i in indexes:
            chars[i] = "*"
        return "".join(chars)
    keep = set(indexes[-4:])
    chars = list(value)
    for i in indexes:
        if i not in keep:
            chars[i] = "*"
    return "".join(chars)
