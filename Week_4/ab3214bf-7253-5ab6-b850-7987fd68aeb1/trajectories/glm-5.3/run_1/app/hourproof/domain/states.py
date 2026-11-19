"""Window state words and the state transition table."""
from typing import Final

AWAITING_METERS: Final = "Awaiting meters"
RECONCILING: Final = "Reconciling"
IN_REVIEW: Final = "In review"
RETURNED: Final = "Returned"
CANCELLING: Final = "Cancelling"
CANCELLED: Final = "Cancelled"
SIGNED: Final = "Signed"
SEALED: Final = "Sealed"
RESTATED: Final = "Restated"

STATE_ORDER: Final = [
    AWAITING_METERS, RECONCILING, IN_REVIEW, RETURNED,
    CANCELLING, CANCELLED, SIGNED, SEALED, RESTATED,
]
