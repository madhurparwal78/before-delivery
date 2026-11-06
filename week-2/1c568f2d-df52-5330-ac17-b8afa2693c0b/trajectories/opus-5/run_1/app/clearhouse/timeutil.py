"""UTC time, UTC days and quarters."""
import datetime as dt
import re

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
QUARTER_RE = re.compile(r"^(\d{4})-Q([1-4])$")
MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def now():
    return dt.datetime.now(dt.timezone.utc)


def today():
    return now().date()


def iso(moment):
    if moment is None:
        return None
    return moment.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def stamp(moment):
    if moment is None:
        return ""
    return moment.astimezone(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def day_text(value):
    if value is None:
        return ""
    return value.strftime("%Y-%m-%d")


def parse_day(text):
    if not isinstance(text, str) or not DAY_RE.match(text):
        return None
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def quarter_of(moment):
    if moment is None:
        return None
    moment = moment.astimezone(dt.timezone.utc)
    return "{}-Q{}".format(moment.year, (moment.month - 1) // 3 + 1)


def current_quarter():
    return quarter_of(now())


def quarter_range(quarter):
    match = QUARTER_RE.match(quarter or "")
    if not match:
        return None
    year = int(match.group(1))
    index = int(match.group(2))
    start = dt.datetime(year, 3 * (index - 1) + 1, 1, tzinfo=dt.timezone.utc)
    end_year = year + 1 if index == 4 else year
    end_month = 1 if index == 4 else 3 * index + 1
    end = dt.datetime(end_year, end_month, 1, tzinfo=dt.timezone.utc)
    return start, end


def month_range(month):
    match = MONTH_RE.match(month or "")
    if not match:
        return None
    year, index = int(match.group(1)), int(match.group(2))
    if not 1 <= index <= 12:
        return None
    start = dt.date(year, index, 1)
    end = dt.date(year + 1, 1, 1) if index == 12 else dt.date(year, index + 1, 1)
    return start, end


def current_month():
    return today().strftime("%Y-%m")


def shift_month(month, step):
    start = month_range(month)[0]
    index = start.month - 1 + step
    return "{:04d}-{:02d}".format(start.year + index // 12, index % 12 + 1)


def relative(moment, reference=None):
    if moment is None:
        return ""
    reference = reference or now()
    seconds = int((reference - moment).total_seconds())
    if seconds < 0:
        seconds = 0
    if seconds < 60:
        return "just now"
    minutes = seconds // 60
    if minutes < 60:
        return "{} minute{} ago".format(minutes, "" if minutes == 1 else "s")
    hours = minutes // 60
    if hours < 24:
        return "{} hour{} ago".format(hours, "" if hours == 1 else "s")
    days = hours // 24
    if days < 30:
        return "{} day{} ago".format(days, "" if days == 1 else "s")
    months = days // 30
    if months < 12:
        return "{} month{} ago".format(months, "" if months == 1 else "s")
    years = days // 365
    return "{} year{} ago".format(years, "" if years == 1 else "s")
