"""The brief's text rules in one place: lengths, unstorable characters, tokens, entity keys, timestamps, formats."""
import re
import unicodedata
from datetime import datetime, timezone

STOPWORDS = frozenset("a an and are as at be by for from in is it of on or that the this to was with".split())
TIMESTAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$")
_SPLIT = re.compile(r"[^a-z0-9]+")
_UNSTORABLE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SNIPPET = 160


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def length(s: str) -> int:
    """Every length limit counts code points after NFC normalization."""
    return len(nfc(s))


def unstorable(s: str) -> bool:
    """NUL, a C0 control other than tab, line feed or carriage return, or a lone surrogate."""
    return bool(_UNSTORABLE.search(s))


def lower(s: str) -> str:
    return nfc(s).lower()


def key(s: str) -> str:
    """Entity key: NFC, Unicode lowercase, trimmed."""
    return nfc(s).lower().strip()


def display(s: str) -> str:
    return s.strip()


def tokens(s: str) -> list[str]:
    return [p for p in _SPLIT.split(nfc(s).lower()) if p]


def terms(s: str) -> list[str]:
    return [t for t in tokens(s) if t not in STOPWORDS]


def token_count(title: str, body: str) -> int:
    return len(tokens(title + " " + body))


def snippet(body: str) -> str:
    return body[:SNIPPET]


def parse_ts(value) -> datetime | None:
    """The pinned UTC form YYYY-MM-DDTHH:MM:SSZ, or None."""
    if not isinstance(value, str):
        return None
    m = TIMESTAMP.match(value)
    if not m:
        return None
    try:
        return datetime(*map(int, m.groups()), tzinfo=timezone.utc)
    except ValueError:
        return None


def ts(dt: datetime | None) -> str | None:
    return None if dt is None else dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now() -> datetime:
    return datetime.now(timezone.utc)


def dollars(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def count(n: int) -> str:
    return f"{n:,}"
