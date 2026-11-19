"""Small shared helpers: clock, business day, email and JSON text."""
import json
import re
from datetime import date, datetime, timedelta, timezone

from . import config

UTC = timezone.utc
BUSINESS_ZONE = timezone(timedelta(minutes=config.BUSINESS_UTC_OFFSET_MINUTES))
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$")


def now() -> datetime:
    return datetime.now(UTC)


def iso(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_moment(text) -> datetime | None:
    if not isinstance(text, str) or not text.strip():
        return None
    value = text.strip().replace(" ", "T")
    if value.endswith(("Z", "z")):
        value = value[:-1] + "+00:00"
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        return None
    return stamp.astimezone(UTC) if stamp.tzinfo else stamp.replace(tzinfo=UTC)


def business_day(moment: datetime) -> date:
    """The calendar date of a moment in Asia/Kolkata; the turnover moment belongs to the later day."""
    return moment.astimezone(BUSINESS_ZONE).date()


def norm_email(value) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def valid_email(value: str) -> bool:
    return bool(value) and len(value) <= 254 and bool(EMAIL_RE.match(value))


def dumps(value) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def uint(raw, ceiling: int = 10**15) -> int | None:
    """A non-negative whole number written in ASCII digits below `ceiling`, else None: the one parser for ids, pages
    and cursor fields."""
    if isinstance(raw, bool) or not isinstance(raw, (str, int)):
        return None
    text = str(raw)
    if not (text.isascii() and text.isdigit()) or len(text) > 18:
        return None
    value = int(text)
    return value if value < ceiling else None
