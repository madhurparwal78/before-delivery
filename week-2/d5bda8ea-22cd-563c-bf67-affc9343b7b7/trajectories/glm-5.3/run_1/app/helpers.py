"""Shared helpers: API errors, strict request bodies, time zones and formatting.

Every domain rule named in the brief has exactly one home: request bodies are
checked only here, and every error leaves the server through ApiError.
"""

import datetime as dt
import hashlib
import json
import os
import re
import urllib.parse

import dateutil.tz
from flask import jsonify, request

MAX_BODY_BYTES = 65536
THEMES = ["amber", "harbor", "moss", "plum", "ember", "night"]
THEME_LABELS = {"amber": "Amber", "harbor": "Harbor", "moss": "Moss",
                "plum": "Plum", "ember": "Ember", "night": "Night"}
REGISTRATION_STATUSES = ("pending", "approved", "waitlisted", "declined", "cancelled")
REPORT_REASONS = ("spam", "misleading", "inappropriate", "other")
STATUS_LABELS = {"pending": "Pending", "approved": "Going", "waitlisted": "Waitlist",
                 "declined": "Declined", "cancelled": "Cancelled"}

CAPACITY_RANGE_MESSAGE = ("Capacity must be a whole number from 1 to 10,000, "
                          "or empty for unlimited")
IDEMPOTENCY_KEY_MESSAGE = ("Idempotency-Key must be 1 to 64 letters, digits, "
                           "hyphens or underscores")
OUTAGE_COPY = ("Mela is taking a short break. Your change was not saved. "
               "Please try again in a moment.")


class ApiError(Exception):
    """The one shared path for every API error response."""

    def __init__(self, status, code, **extra):
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra

    def response(self):
        body = {"error": self.code}
        body.update(self.extra)
        return jsonify(body), self.status, self.retry_headers()

    def retry_headers(self):
        if self.status == 503:
            return {"Retry-After": "5"}
        if "retry_after" in self.extra:
            return {"Retry-After": str(int(self.extra["retry_after"]))}
        return None


def validation_error(errors):
    return jsonify({"errors": errors}), 422


class BodyError(Exception):
    def __init__(self, payload):
        super().__init__("body error")
        self.payload = payload


def read_raw_body():
    length = request.content_length
    if length is not None and length > MAX_BODY_BYTES:
        raise BodyError(jsonify({"error": "payload_too_large"}), )
    raw = request.get_data()
    if len(raw) > MAX_BODY_BYTES:
        raise BodyError(jsonify({"error": "payload_too_large"}))
    return raw


def read_body(spec):
    """Parse and strictly check a JSON request body against ``spec``.

    ``spec`` maps each allowed key to a checker; any other key is refused.
    """
    raw = read_raw_body()
    if not raw:
        body = {}
    else:
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise BodyError(validation_error({"body": "Expected a JSON object"}))
        if not isinstance(body, dict):
            raise BodyError(validation_error({"body": "Expected a JSON object"}))

    data = {}
    for key, value in body.items():
        checker = spec.get(key)
        if checker is None:
            raise BodyError(validation_error({key: "Unknown field"}))
        data[key] = checker(value, key)
    return data


def type_message(expected):
    return f"Expected {expected}"


def _string_field(min_len=None, max_len=None, trimmed=False):
    def check(value, key):
        if not isinstance(value, str):
            raise BodyError(validation_error({key: type_message("a string")}))
        text = value.strip() if trimmed else value
        if min_len is not None and len(text) < min_len:
            raise BodyError(validation_error(
                {key: f"Must be at least {min_len} characters"}))
        if max_len is not None and len(text) > max_len:
            raise BodyError(validation_error(
                {key: f"Must be at most {max_len} characters"}))
        return text
    return check


def string_field(max_len=None, min_len=None):
    return _string_field(min_len=min_len, max_len=max_len, trimmed=False)


def text_field(min_len=None, max_len=None):
    """A string trimmed before storing, with length bounds on the trimmed text."""
    return _string_field(min_len=min_len, max_len=max_len, trimmed=True)


def int_or_null_field(value, key):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise BodyError(validation_error({key: "Expected a whole number or null"}))
    return value


def bool_field(value, key):
    if not isinstance(value, bool):
        raise BodyError(validation_error({key: "Expected true or false"}))
    return value


def string_array_field(value, key):
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise BodyError(validation_error({key: "Expected a list of strings"}))
    return value


def string_or_null_field(value, key):
    if value is None:
        return None
    if not isinstance(value, str):
        raise BodyError(validation_error({key: "Expected a string or null"}))
    return value


def choice_field(options):
    def check(value, key):
        if not isinstance(value, str) or value not in options:
            raise BodyError(validation_error(
                {key: "Expected one of: " + ", ".join(options)}))
        return value
    return check


def datetime_field(value, key):
    if not isinstance(value, str):
        raise BodyError(validation_error({key: "Expected an ISO 8601 date-time"}))
    parsed = parse_datetime(value)
    if parsed is None:
        raise BodyError(validation_error(
            {key: "Expected an ISO 8601 date-time with an offset"}))
    return parsed


def parse_datetime(value):
    """Parse an ISO 8601 date-time that carries an offset."""
    if not isinstance(value, str) or not value:
        return None
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed


def utcnow():
    return dt.datetime.now(tz=dt.timezone.utc)


def iso_utc(value):
    return value.astimezone(dt.timezone.utc).isoformat()


_TZ_CACHE = {}


def get_zone(name):
    zone = _TZ_CACHE.get(name)
    if zone is None:
        zone = dateutil.tz.gettz(name)
        if zone is None:
            return None
        _TZ_CACHE[name] = zone
    return zone


def local_time(value, zone_name):
    zone = get_zone(zone_name) or dt.timezone.utc
    return value.astimezone(zone)


WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                "Sep", "Oct", "Nov", "Dec"]


def long_date(value, zone_name):
    """For example: Wednesday, October 21"""
    local = local_time(value, zone_name)
    return f"{WEEKDAYS[local.weekday()]}, {MONTHS[local.month - 1]} {local.day}"


def clock_time(value, zone_name):
    """For example: 5:00 PM"""
    local = local_time(value, zone_name)
    hour = local.hour % 12 or 12
    meridiem = "AM" if local.hour < 12 else "PM"
    return f"{hour}:{local.minute:02d} {meridiem}"


def time_range(start_at, end_at, zone_name):
    return f"{clock_time(start_at, zone_name)} - {clock_time(end_at, zone_name)}"


def short_start(value, zone_name):
    """For example: Wed, Oct 21, 5:00 PM"""
    local = local_time(value, zone_name)
    weekday = WEEKDAYS[local.weekday()][:3]
    month = MONTHS[local.month - 1][:3]
    return f"{weekday}, {month} {local.day}, {clock_time(value, zone_name)}"


def month_day(value, zone_name):
    """Date tile: month abbreviation over the day number."""
    local = local_time(value, zone_name)
    return MONTHS[local.month - 1][:3].upper(), str(local.day)


def countdown_text(start_at, end_at, now=None):
    """Server-rendered countdown text, mirrored by the client script."""
    now = now or utcnow()
    if now >= end_at:
        return None
    if now >= start_at:
        return "Happening now"
    remaining = start_at - now
    total = int(remaining.total_seconds())
    days, rest = divmod(total, 86400)
    hours, rest = divmod(rest, 3600)
    minutes, seconds = divmod(rest, 60)
    if days > 0:
        return f"{days} {'day' if days == 1 else 'days'} {hours:02d} hrs {minutes:02d} min"
    if hours > 0:
        return f"{hours} {'hr' if hours == 1 else 'hrs'} {minutes:02d} min {seconds:02d} sec"
    if minutes > 0:
        return f"{minutes} min {seconds:02d} sec"
    return f"{seconds} sec"


def ordinal(number):
    """English ordinals that handle the teens: 1st, 2nd, 11th, 21st, 111th."""
    if 11 <= number % 100 <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix}"


def days_since(end_at, now=None):
    now = now or utcnow()
    return max(0, (now - end_at).days)


def name_list(names):
    """A, B and C — used for guest lines and moved-up toasts."""
    names = list(names)
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def initials(name):
    parts = [p for p in name.split() if p]
    if not parts:
        return "?"
    return "".join(p[0] for p in parts[:2]).upper()


def safe_next(raw):
    """Return an in-origin path to land on after sign-in, or /home."""
    if not raw:
        return "/home"
    try:
        decoded = urllib.parse.unquote(raw, errors="strict")
    except UnicodeDecodeError:
        return "/home"
    if not decoded.startswith("/") or decoded.startswith("//"):
        return "/home"
    if "\\" in decoded:
        return "/home"
    if any(ord(c) < 32 or ord(c) == 127 for c in decoded):
        return "/home"
    if re.match(r"^/[A-Za-z][A-Za-z0-9+.\-]*:", decoded):
        return "/home"
    return decoded


def encode_next(path):
    return urllib.parse.quote(path, safe="")


def geo_link(street_address):
    return "geo:0,0?q=" + urllib.parse.quote(street_address)


def slug_chars(length=8):
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(alphabet[b % len(alphabet)]
                   for b in os.urandom(length))


def body_hash(body):
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def idempotency_key_valid(value):
    return bool(re.fullmatch(r"[A-Za-z0-9\-_]{1,64}", value or ""))


def env_seconds(name, default):
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


CATEGORY_LABELS = {
    "family": "Family", "books": "Books", "games": "Games", "tech": "Tech",
    "food-drink": "Food & Drink", "ai": "AI", "running": "Running",
    "arts-culture": "Arts & Culture", "climate": "Climate", "fitness": "Fitness",
    "wellness": "Wellness", "crypto": "Crypto",
}

EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")


def valid_email(value):
    return bool(value) and len(value) <= 254 and bool(EMAIL_RE.match(value))


def plural(count, singular_word, plural_word=None):
    if count == 1:
        return f"{count} {singular_word}"
    return f"{count} {plural_word or singular_word + 's'}"
