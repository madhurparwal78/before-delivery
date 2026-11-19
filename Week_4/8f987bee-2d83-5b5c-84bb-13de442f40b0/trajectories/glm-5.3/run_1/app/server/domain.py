"""Domain rules decided once: return address, cron, next-run text, ids, cursors."""
from __future__ import annotations

import base64
import binascii
import datetime as dt
import hashlib
import hmac
import json
import re
import secrets
import unicodedata
import urllib.parse
import zoneinfo

# ---------------------------------------------------------------- ids

_ID_RE = re.compile(r"^[0-9a-f]{24}$")


def new_id(prefix: str = "") -> str:
    return secrets.token_hex(12)


def is_well_formed_id(value: str) -> bool:
    return bool(value) and bool(_ID_RE.match(value))


# ---------------------------------------------------------------- return address

_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")


def _remove_dot_segments(path: str) -> str:
    segments = path.split("/")
    out: list[str] = []
    for seg in segments:
        if seg == ".":
            continue
        if seg == "..":
            if out and out != [""]:
                out.pop()
            continue
        out.append(seg)
    if path.startswith("/"):
        return "/" + "/".join(out[1:]) if out and out[0] == "" else "/" + "/".join(out)
    return "/".join(out)


def safe_return_address(raw: str | None) -> str:
    """One place that decides redirect_to after sign-in."""
    if not raw:
        return "/app"
    cut = len(raw)
    for marker in ("?", "#"):
        idx = raw.find(marker)
        if idx != -1 and idx < cut:
            cut = idx
    path, suffix = raw[:cut], raw[cut:]
    try:
        decoded = urllib.parse.unquote(path, errors="strict")
    except Exception:
        return "/app"
    if "\\" in decoded or "//" in decoded or _SCHEME_RE.match(decoded) or "@" in decoded:
        return "/app"
    for ch in decoded:
        if ord(ch) <= 31 or ord(ch) == 127:
            return "/app"
    resolved = _remove_dot_segments(decoded)
    if not (resolved == "/app" or resolved.startswith("/app/")):
        return "/app"
    return resolved + suffix


# ---------------------------------------------------------------- cron

CRON_FIELDS = (
    ("minute", 0, 59),
    ("hour", 0, 23),
    ("day_of_month", 1, 31),
    ("month", 1, 12),
    ("day_of_week", 0, 7),
)


def _parse_cron_field(field: str, lo: int, hi: int) -> tuple[set[int], bool] | None:
    """Return matched values and whether the field is unrestricted."""
    if field == "":
        return None
    values: set[int] = set()
    unrestricted = field == "*"
    for item in field.split(","):
        item = item.strip()
        if item == "":
            return None
        base: str
        step: int | None = None
        if "/" in item:
            base, _, step_s = item.partition("/")
            if step_s == "":
                return None
            if not step_s.isdigit():
                return None
            step = int(step_s)
            if step < 1:
                return None
        else:
            base = item
        if base == "*":
            start, end = lo, hi
        elif "-" in base:
            a, _, b = base.partition("-")
            if not (a.isdigit() and b.isdigit()):
                return None
            start, end = int(a), int(b)
            if start > end:
                return None
        else:
            if not base.isdigit():
                return None
            start = end = int(base)
        if step is None:
            step = 1
        if start < lo or end > hi:
            return None
        values.update(range(start, end + 1, step))
    if not values:
        return None
    return values, unrestricted


class CronExpr:
    """Parsed five-field cron expression."""

    def __init__(self, minutes: set[int], hours: set[int], doms: set[int],
                 months: set[int], dows: set[int],
                 dom_unrestricted: bool, dow_unrestricted: bool) -> None:
        self.minutes = minutes
        self.hours = hours
        self.doms = doms
        self.months = months
        self.dows = dows
        self.dom_unrestricted = dom_unrestricted
        self.dow_unrestricted = dow_unrestricted

    def minute_gap(self) -> int:
        """Smallest gap between matched minutes, counted across the hour."""
        if len(self.minutes) <= 1:
            return 60
        ordered = sorted(self.minutes)
        gaps = [b - a for a, b in zip(ordered, ordered[1:])]
        gaps.append(60 - ordered[-1] + ordered[0])
        return min(gaps)

    def day_matches(self, day: dt.date) -> bool:
        if day.month not in self.months:
            return False
        dom_ok = day.day in self.doms
        # cron: 0 and 7 both mean Sunday
        dow_ok = day.isoweekday() % 7 in self.dows
        if not self.dom_unrestricted and not self.dow_unrestricted:
            return dom_ok or dow_ok
        return dom_ok and dow_ok

    def next_after(self, anchor: dt.datetime, time_zone: str) -> dt.datetime | None:
        """First wall-clock minute strictly after anchor that matches, in tz."""
        tz = zoneinfo.ZoneInfo(time_zone)
        if anchor.tzinfo is None:
            anchor = anchor.replace(tzinfo=dt.timezone.utc)
        candidate = anchor.astimezone(dt.timezone.utc).replace(second=0, microsecond=0)
        # step forward in UTC minute by minute, at most 5 years
        limit = 366 * 24 * 60 * 5
        for _ in range(limit):
            candidate = candidate + dt.timedelta(minutes=1)
            local = candidate.astimezone(tz)
            if local.minute not in self.minutes or local.hour not in self.hours:
                continue
            # skip non-existent local times (spring forward): offset check
            if not self.day_matches(local.date()):
                continue
            # A local minute occurs twice when clocks fall back; only the first occurrence matches.
            rewound = local.replace(fold=1).astimezone(dt.timezone.utc)
            if rewound != candidate and rewound == candidate - dt.timedelta(hours=1):
                continue
            return candidate
        return None


def parse_cron(expression: str) -> CronExpr | None:
    fields = expression.split()
    if len(fields) != 5:
        return None
    parsed: list[tuple[set[int], bool]] = []
    for value, (_, lo, hi) in zip(fields, CRON_FIELDS):
        result = _parse_cron_field(value, lo, hi)
        if result is None:
            return None
        parsed.append(result)
    dow_values = {0 if v == 7 else v for v in parsed[4][0]}
    expr = CronExpr(parsed[0][0], parsed[1][0], parsed[2][0], parsed[3][0], dow_values,
                    parsed[2][1], parsed[4][1])
    now = dt.datetime.now(dt.timezone.utc)
    if expr.next_after(now - dt.timedelta(minutes=2), "UTC") is None:
        return None
    return expr


# ---------------------------------------------------------------- next run text

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def next_run_text(next_run_at, time_zone: str | None = None) -> str:
    if not next_run_at:
        return "—"
    if next_run_at.tzinfo is None:
        next_run_at = next_run_at.replace(tzinfo=dt.timezone.utc)
    tz_name = time_zone or "UTC"
    tz = zoneinfo.ZoneInfo(tz_name)
    local = next_run_at.astimezone(tz)
    offset = local.utcoffset() or dt.timedelta(0)
    total = int(offset.total_seconds())
    sign = "+" if total >= 0 else "-"
    total = abs(total)
    off_h, off_m = divmod(total // 60, 60)
    return (f"{_DAYS[local.weekday()]} {local.day} {_MONTHS[local.month - 1]} {local.year}, "
            f"{local.hour:02d}:{local.minute:02d} {tz_name} "
            f"(UTC{sign}{off_h:02d}:{off_m:02d})")


def parse_zulu(value: str) -> dt.datetime | None:
    if not isinstance(value, str) or not value.endswith("Z"):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(dt.timezone.utc)


def to_zulu(value) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ---------------------------------------------------------------- cursors

def encode_cursor(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(b"wayline-cursor", raw, hashlib.sha256).digest()[:8]
    return base64.urlsafe_b64encode(sig + raw).decode().rstrip("=")


def decode_cursor(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        padded = token + "=" * (-len(token) % 4)
        blob = base64.urlsafe_b64decode(padded.encode())
    except (binascii.Error, ValueError):
        return None
    if len(blob) < 9:
        return None
    sig, raw = blob[:8], blob[8:]
    expect = hmac.new(b"wayline-cursor", raw, hashlib.sha256).digest()[:8]
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        payload = json.loads(raw)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


# ---------------------------------------------------------------- audit hash

GENESIS = "0" * 64


def audit_hash(prev_hash: str, seq: int, action: str, target_id: str, actor_email: str) -> str:
    text = f"{prev_hash}|{seq}|{action}|{target_id}|{actor_email}"
    return hashlib.sha256(text.encode()).hexdigest()


# ---------------------------------------------------------------- secrets

def hash_secret(value: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.sha256((salt + value).encode()).hexdigest()
    return f"{salt}${digest}"


def seal_secret(value: str) -> str:
    """Reversible encryption for an API key; the readable text never sits in the database."""
    import base64

    key = _secret_key()
    raw = value.encode()
    pad = secrets.token_bytes(8)
    blob = pad + raw
    masked = bytes(b ^ key[i % len(key)] for i, b in enumerate(blob))
    return "v1:" + base64.urlsafe_b64encode(masked).decode().rstrip("=")


def unseal_secret(stored: str) -> str:
    import base64

    if not (stored or "").startswith("v1:"):
        return ""
    key = _secret_key()
    padded = stored[3:] + "=" * (-len(stored[3:]) % 4)
    try:
        masked = base64.urlsafe_b64decode(padded.encode())
    except Exception:
        return ""
    blob = bytes(b ^ key[i % len(key)] for i, b in enumerate(masked))
    return blob[8:].decode(errors="replace")


def _secret_key() -> bytes:
    import hashlib
    import os

    material = os.environ.get("DATABASE_URL", "") or os.environ.get("DB_URL", "") or "wayline"
    return hashlib.sha256(("wayline-seal:" + material).encode()).digest()


def verify_secret(value: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hashlib.sha256((salt + value).encode()).hexdigest(), digest)


# ---------------------------------------------------------------- names

PREFIX_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
STREAM_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
FIELD_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")


def valid_prefix(prefix: str) -> bool:
    return bool(PREFIX_RE.match(prefix or ""))


def normalize_email(email: str) -> str:
    return unicodedata.normalize("NFKC", email or "").strip().lower()


def slugify(name: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return text
