import json
import re
import secrets
import time
import unicodedata
import uuid
from urllib.parse import urlsplit, quote

TS_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$")
DB_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,31}$")
SOURCE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PREDICATE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")
STOPWORDS = frozenset("a an and are as at be by for from in is it of on or that the this to was with".split())
IDEM_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
META_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ApiError(Exception):
    def __init__(self, status, code, message, field=None, headers=None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.field = field
        self.headers = headers or {}


def verification_error(field, message="Invalid value"):
    return ApiError(400, "VALIDATION_ERROR", message, field)


def parse_timestamp(v, field):
    if not isinstance(v, str) or not TS_RE.match(v):
        raise verification_error(field)
    y, mo, rest = v.split("-")
    try:
        t = datetime_str_to_dt(v)
    except ValueError:
        raise verification_error(field)
    return t


def datetime_str_to_dt(v):
    y = int(v[0:4]); mo = int(v[5:7]); d = int(v[8:10])
    h = int(v[11:13]); mi = int(v[14:16]); s = int(v[17:19])
    import datetime
    return datetime.datetime(y, mo, d, h, mi, s, tzinfo=datetime.timezone.utc)


def dt_to_str(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def now_str():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def nfc(v):
    return unicodedata.normalize("NFC", v)


def cp_len(v):
    return len(nfc(v))


FORBIDDEN_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

def check_storable(v, field):
    if FORBIDDEN_RE.search(v):
        raise verification_error(field)


def tokens(s):
    s = nfc(s).lower()
    out = []
    for piece in re.split(r"[^a-z0-9]+", s):
        if piece:
            out.append(piece)
    return out


def terms(s):
    return [t for t in tokens(s) if t not in STOPWORDS]


def entity_key(v):
    return nfc(v).strip().casefold()


def sha_hex(data):
    import hashlib
    return hashlib.sha256(data).hexdigest()


def digest_token(v):
    return sha_hex(("t1:" + v).encode("utf-8")).encode("utf-8").decode("utf-8")


def new_secret():
    return "tsl_" + secrets.token_hex(20)


def format_cents(c):
    d = "%d" % (c // 100)
    neg = c < 0
    if neg:
        d = "%d" % ((-c) // 100)
    out = ""
    while len(d) > 3:
        out = "," + d[-3:] + out
        d = d[:-3]
    out = d + out
    return ("$" if not neg else "-$") + out + ".%02d" % (abs(c) % 100)


def money_console(c):
    return format_cents(c)


def thousands(n):
    return "{:,}".format(n)


def random_uuid():
    return str(uuid.uuid4())


def now():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc)


def new_request_id():
    return str(uuid.uuid4())


def json_dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def json_dumps_sorted(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def md_escape(s):
    return s.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def link(text, href):
    return "[%s](%s)" % (md_escape(text), href)


def ts_attr(value):
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def jstr(value):
    return json.dumps(value, ensure_ascii=False)


def monotonic_ms():
    return time.monotonic() * 1000


def var_name_matches(name):
    return re.match(r"^[a-z][a-z0-9_]*$", name) is not None


def is_plain_console_path(next_value):
    if not isinstance(next_value, str) or not next_value:
        return False
    decoded = next_value
    if not (decoded == "/console" or decoded.startswith("/console/") or decoded.startswith("/console?")):
        return False
    if "\\" in decoded or "//" in decoded:
        return False
    import re as _re
    if _re.search(r"/\./|/\.\./", decoded):
        return False
    for ch in decoded:
        if ord(ch) < 0x20 or ord(ch) == 0x7f:
            return False
    return True


def rate_after(count, window, start):
    elapsed = (now() - start).total_seconds()
    if elapsed < window:
        return max(1, int(window - elapsed) + 1)
    return 1


def csv_neutralize(field):
    if field and field[0] in ("=", "+", "-", "@", "\t", "\r"):
        field = "'" + field
    need = any(ch in field for ch in (",", '"', "\n", "\r"))
    if need:
        return '"' + field.replace('"', '""') + '"'
    return field


def csv_join(values):
    return ",".join(csv_neutralize(v) for v in values)


def valid_email(v):
    return isinstance(v, str) and EMAIL_RE.match(v) is not None and len(v) <= 254


def plan_limit(plan):
    return 3 if plan == "ship" else 20


def plan_rate(plan):
    return 50 if plan == "ship" else 25


def plan_minimum_cents(plan):
    return 2500 if plan == "ship" else 30000


def plan_query_limit(plan):
    return 20 if plan == "ship" else 200


def tokenize_query(q):
    out = []
    i = 0
    n = len(q)
    while i < n:
        if q[i] == '"':
            j = q.find('"', i + 1)
            if j == -1:
                chunk = q[i + 1:]
                i = n
            else:
                chunk = q[i + 1:j]
                i = j + 1
            out.append(("phrase", chunk))
        else:
            j = q.find('"', i)
            if j == -1:
                chunk = q[i:]
                i = n
            else:
                chunk = q[i:j]
                i = j
            out.append(("words", chunk))
    return out


def query_terms_excluded(q):
    """Return (terms, phrases, excluded)."""
    t, ph, ex = [], [], []
    for kind, chunk in tokenize_query(q):
        if kind == "phrase":
            toks = terms(chunk)
            ph.extend(toks)
            t.extend(toks)
        else:
            for w in chunk.split():
                if w.startswith("-") and len(w) > 1:
                    ex.extend(terms(w[1:]))
                else:
                    t.extend(terms(w))
    return t, ph, ex


def clamp_limit(v, lo, hi, field, default):
    if v is None:
        return default
    if isinstance(v, str) and v.isdigit():
        v = int(v)
    if isinstance(v, bool) or not isinstance(v, int) or v < lo or v > hi:
        raise verification_error(field)
    return v


def uuid_ok(v):
    try:
        uuid.UUID(str(v))
        return True
    except Exception:
        return False
