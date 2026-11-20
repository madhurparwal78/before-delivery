"""Business time, shifts and the error shape. Europe/London decides every "today".

Every instant is an aware datetime, but all duration and comparison arithmetic
goes through epoch seconds, which stays correct across clock changes.
"""
import datetime as dt
import time
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")

SHIFTS = ("early", "late", "night")
SHIFT_TIMES = {"early": (dt.time(7, 0), dt.time(15, 0)),
               "late": (dt.time(15, 0), dt.time(22, 0)),
               "night": (dt.time(22, 0), dt.time(8, 0))}
SHIFT_CSV = {"early": "Early", "late": "Late", "night": "Night"}
SHIFT_LABELS = {"early": "Early", "late": "Late", "night": "Night"}
DAY_ABBREV = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS = ("January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December")


def now():
    return dt.datetime.now(dt.UTC)


def epoch(t):
    """The instant as epoch seconds; the one reliable measure of time."""
    return t.timestamp()


def current_epoch():
    return time.time()


def elapsed_seconds(start, end):
    return epoch(end) - epoch(start)


def elapsed_hours(start, end):
    return (epoch(end) - epoch(start)) / 3600


def before(a, b):
    return epoch(a) < epoch(b)


def today():
    """The current Europe/London date."""
    return now().astimezone(LONDON).date()


def parse_instant(text):
    """Parse an ISO 8601 instant that carries a UTC offset. Returns None when invalid."""
    if not isinstance(text, str) or not text:
        return None
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def parse_date(text):
    """Parse YYYY-MM-DD strictly."""
    if not isinstance(text, str) or len(text) != 10:
        return None
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def shift_bounds(date, shift):
    """Start and end instants of a shift on a date, in Europe/London wall time."""
    start_t, end_t = SHIFT_TIMES[shift]
    start_local = dt.datetime.combine(date, start_t, tzinfo=LONDON)
    end_date = date + dt.timedelta(days=1 if shift == "night" else 0)
    end_local = dt.datetime.combine(end_date, end_t, tzinfo=LONDON)
    return start_local, end_local


def shift_hours(date, shift):
    """Real elapsed hours between a shift's start and end, following clock changes."""
    start, end = shift_bounds(date, shift)
    return elapsed_hours(start, end)


def iso_instant(t):
    """Format with the Europe/London offset in force at that instant."""
    return t.astimezone(LONDON).isoformat()


def date_label(d):
    """Tue 3 Nov 2026"""
    return f"{DAY_ABBREV[d.weekday()]} {d.day} {MONTHS[d.month - 1][:3]} {d.year}"


def shift_label(d, shift):
    return f"{date_label(d)} {SHIFT_LABELS[shift]}"


def short_label(d, shift):
    return f"{DAY_ABBREV[d.weekday()]} {SHIFT_LABELS[shift]}"


def month_label(period):
    """'September 2026' from '2026-09'."""
    year, month = period.split("-")
    return f"{MONTHS[int(month) - 1]} {year}"


def hm(t):
    """<HH:MM> in Europe/London."""
    return t.astimezone(LONDON).strftime("%H:%M")


def hours_str(h):
    """Two-place decimal string for an hour value."""
    return f"{h:.2f}"


def accrual_str(h):
    """Four-place decimal string for an accrual value."""
    return f"{h:.4f}"


def week_monday(d):
    return d - dt.timedelta(days=d.weekday())


def iso_week(d):
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


def parse_iso_week(text):
    """'2026-W44' -> the Monday date, or None."""
    if not isinstance(text, str) or len(text) != 8 or text[5] != "W":
        return None
    try:
        year, week = int(text[:4]), int(text[6:])
    except ValueError:
        return None
    if not 1 <= week <= 53:
        return None
    try:
        return dt.date.fromisocalendar(year, week, 1)
    except ValueError:
        return None


def accrue_hours(worked_seconds):
    """12.07% of worked time, rounded up at the fourth decimal place, never down."""
    import decimal
    rate = decimal.Decimal("0.1207")
    hours = decimal.Decimal(str(worked_seconds)) * rate / decimal.Decimal(3600)
    return float(hours.quantize(decimal.Decimal("0.0001"), rounding=decimal.ROUND_CEILING))


def round_half_up_4(value):
    """Round to 4 decimal places, half away from zero."""
    import decimal
    return float(decimal.Decimal(str(value)).quantize(
        decimal.Decimal("0.0001"), rounding=decimal.ROUND_HALF_UP))
