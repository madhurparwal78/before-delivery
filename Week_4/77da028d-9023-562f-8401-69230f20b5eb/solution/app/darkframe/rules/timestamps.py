"""Record timestamps are UTC with a trailing Z."""
from datetime import UTC, datetime


def utc_text(instant: datetime) -> str:
    return instant.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
