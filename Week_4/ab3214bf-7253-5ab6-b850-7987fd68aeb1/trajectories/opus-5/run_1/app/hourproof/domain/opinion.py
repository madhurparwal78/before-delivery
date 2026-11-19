"""The verifier's opinion, fixed by the server."""

from __future__ import annotations

UNQUALIFIED = "Unqualified"
QUALIFIED = "Qualified"

NON_ACTUAL_SHARE_PERCENT = 5


def decide(non_actual_wh: int, consumed_wh: int, exceptions: int) -> str:
    if exceptions > 0:
        return QUALIFIED
    if non_actual_wh * 100 > consumed_wh * NON_ACTUAL_SHARE_PERCENT:
        return QUALIFIED
    return UNQUALIFIED
