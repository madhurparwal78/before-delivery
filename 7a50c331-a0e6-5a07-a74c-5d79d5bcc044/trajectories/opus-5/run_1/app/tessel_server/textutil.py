"""Text rules: counting, tokenization, entity keys and timestamps.

Every length limit in the brief counts code points after NFC normalization,
while the value itself is stored as typed. Both rules are decided here.
"""
import datetime
import re
import unicodedata

STOPWORDS = frozenset(
    "a an and are as at be by for from in is it of on or that the this to was with".split()
)

_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")
_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

ALLOWED_CONTROLS = frozenset("\t\n\r")


def nfc(value):
    return unicodedata.normalize("NFC", value)


def length(value):
    """The code point count of the NFC form, which every limit counts."""
    return len(nfc(value))


def unstorable(value):
    """True when a string holds NUL, another C0 control, or a lone surrogate."""
    for char in value:
        code = ord(char)
        if code < 0x20 and char not in ALLOWED_CONTROLS:
            return True
        if 0xD800 <= code <= 0xDFFF:
            return True
    return False


def tokens(value):
    """The token list of a string: NFC, lowercased, split outside a-z0-9."""
    return [piece for piece in _TOKEN_SPLIT.split(nfc(value).lower()) if piece]


def terms(value):
    """The tokens of a string with the stopwords removed, in order."""
    return [token for token in tokens(value) if token not in STOPWORDS]


def entity_key(value):
    """The key an entity is filed under: NFC, Unicode lowercased, trimmed."""
    return nfc(value).lower().strip()


def utf8_length(value):
    return len(value.encode("utf-8"))


def snippet(text):
    """The first 160 code points of the text as typed."""
    return text[:160]


def parse_timestamp(value):
    """Parse the one pinned UTC form, or return None."""
    if not isinstance(value, str) or not _TIMESTAMP.match(value):
        return None
    try:
        naive = datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    return naive.replace(tzinfo=datetime.timezone.utc)


def format_timestamp(moment):
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    return moment.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def format_month(moment):
    return moment.astimezone(datetime.timezone.utc).strftime("%Y-%m")


def format_day(moment):
    return moment.astimezone(datetime.timezone.utc).strftime("%Y-%m-%d")
