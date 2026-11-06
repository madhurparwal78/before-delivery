"""Whole-request validation: unknown fields, types, lengths and unstorable characters."""
import re

from .textutil import (ApiError, verification_error, cp_len, FORBIDDEN_RE,
                       DB_NAME_RE, SOURCE_ID_RE, PREDICATE_RE, TS_RE, parse_timestamp)


def scan_unstorable(value, field):
    """Refuse NUL, other C0 controls (but tab, LF, CR) and lone surrogates."""
    if FORBIDDEN_RE.search(value):
        raise verification_error(field)
    for ch in value:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            raise verification_error(field)

LONE_SURROGATE_RE = re.compile(r"[\ud800-\udfff]")


def collect_strings(value, path, out):
    if isinstance(value, str):
        out.append((path, value))
    elif isinstance(value, list):
        for i, item in enumerate(value):
            collect_strings(item, "%s.%d" % (path, i), out)
    elif isinstance(value, dict):
        for k in sorted(value.keys()):
            collect_strings(value[k], "%s.%s" % (path, k), out)


def check_all_strings(body, root=""):
    """Walk the whole body in order and refuse unstorable strings before any other check."""
    out = []
    collect_strings(body, root, out)
    for path, value in out:
        scan_unstorable(value, path or None)


def require_object(body, known, field=None):
    if not isinstance(body, dict):
        raise verification_error(field)
    for key in body:
        if key not in known:
            raise ApiError(400, "UNKNOWN_FIELD", "Unknown field %s" % key, key)


def get_str(body, key, lo=1, hi=None, optional=False, allow_empty=False, field=None):
    field = field or key
    v = body.get(key)
    if v is None:
        if optional:
            return None
        raise verification_error(field)
    if not isinstance(v, str):
        raise verification_error(field)
    if lo is not None and (cp_len(v) < lo or (v == "" and not allow_empty and lo > 0)):
        raise verification_error(field)
    if hi is not None and cp_len(v) > hi:
        raise verification_error(field)
    return v


def get_int(body, key, optional=False, field=None, minimum=None, maximum=None):
    field = field or key
    v = body.get(key)
    if v is None:
        if optional:
            return None
        raise verification_error(field)
    if isinstance(v, bool) or not isinstance(v, int):
        raise verification_error(field)
    if minimum is not None and v < minimum:
        raise verification_error(field)
    if maximum is not None and v > maximum:
        raise verification_error(field)
    return v


def get_timestamp(body, key, optional=False, field=None):
    field = field or key
    v = body.get(key)
    if v is None:
        if optional:
            return None
        raise verification_error(field)
    if not isinstance(v, str) or not TS_RE.match(v):
        raise verification_error(field)
    return parse_timestamp(v, field)
