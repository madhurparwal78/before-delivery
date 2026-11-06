"""Field checks: unknown keys, unstorable characters and value rules."""
import re

from .errors import TesselError, validation_error
from . import textutil

ANY = object()


def join(path, part):
    return "%s.%s" % (path, part) if path else str(part)


def require_object(body):
    if not isinstance(body, dict):
        raise validation_error(None, "The request body must be a JSON object")
    return body


def scan_unknown(value, spec, path=""):
    """Refuse the first key the endpoint does not define, in request order."""
    if spec is ANY:
        return
    if isinstance(spec, tuple):
        if isinstance(value, list):
            for index, item in enumerate(value):
                scan_unknown(item, spec[1], join(path, index))
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        if key not in spec:
            raise TesselError("UNKNOWN_FIELD", field=join(path, key), path=join(path, key))
        scan_unknown(item, spec[key], join(path, key))


def scan_unstorable(value, path=""):
    """Refuse the first string holding a character that cannot be stored."""
    if isinstance(value, str):
        if textutil.unstorable(value):
            raise validation_error(
                path or None, "This value holds a character that cannot be stored"
            )
    elif isinstance(value, dict):
        for key, item in value.items():
            scan_unstorable(item, join(path, key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            scan_unstorable(item, join(path, index))


def string(body, key, path, minimum, maximum, required=True, default=None):
    if key not in body or body[key] is None:
        if required:
            raise validation_error(path, "This field is required")
        return default
    value = body[key]
    if not isinstance(value, str):
        raise validation_error(path, "This field must be a string")
    size = textutil.length(value)
    if size < minimum or size > maximum:
        raise validation_error(
            path, "Write between %d and %d characters" % (minimum, maximum)
        )
    return value


def pattern(body, key, path, regex, message, required=True, default=None):
    if key not in body or body[key] is None:
        if required:
            raise validation_error(path, "This field is required")
        return default
    value = body[key]
    if not isinstance(value, str):
        raise validation_error(path, "This field must be a string")
    if not re.match(regex, textutil.nfc(value)):
        raise validation_error(path, message)
    return value


def choice(body, key, path, options, required=True, default=None):
    if key not in body or body[key] is None:
        if required:
            raise validation_error(path, "This field is required")
        return default
    value = body[key]
    if value not in options:
        raise validation_error(path, "This field must be one of %s" % ", ".join(options))
    return value


def whole_number(body, key, path, minimum, maximum, required=True, default=None):
    if key not in body or body[key] is None:
        if required:
            raise validation_error(path, "This field is required")
        return default
    value = body[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise validation_error(path, "This field must be a whole number")
    if value < minimum or value > maximum:
        raise validation_error(
            path, "This field must be between %d and %d" % (minimum, maximum)
        )
    return value


def timestamp(body, key, path, required=True):
    if key not in body or body[key] is None:
        if required:
            raise validation_error(path, "This field is required")
        return None
    value = body[key]
    if not isinstance(value, str):
        raise validation_error(path, "This field must be a string")
    moment = textutil.parse_timestamp(value)
    if moment is None:
        raise validation_error(path, "Write a UTC moment as YYYY-MM-DDTHH:MM:SSZ")
    return moment


def listed(body, key, path, minimum, maximum, required=True):
    if key not in body or body[key] is None:
        if required:
            raise validation_error(path, "This field is required")
        return None
    value = body[key]
    if not isinstance(value, list):
        raise validation_error(path, "This field must be a list")
    if len(value) < minimum or len(value) > maximum:
        raise validation_error(
            path, "Send between %d and %d items" % (minimum, maximum)
        )
    return value


EMAIL = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
DATABASE_NAME = r"^[a-z][a-z0-9_]{2,31}$"
SOURCE_ID = r"^[A-Za-z0-9_-]{1,64}$"
PREDICATE = r"^[A-Z][A-Z0-9_]{1,31}$"
IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
METADATA_KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
RECOVERY_CODE = re.compile(r"^[0-9a-f]{4}-[0-9a-f]{4}$")


def email(body, key, path, required=True):
    if key not in body or body[key] is None:
        if required:
            raise validation_error(path, "This field is required")
        return None
    value = body[key]
    if not isinstance(value, str):
        raise validation_error(path, "This field must be a string")
    trimmed = value.strip()
    if len(trimmed) > 254 or not EMAIL.match(trimmed):
        raise validation_error(path, "Enter a valid email address")
    return trimmed.lower()


def password(body, key, path):
    value = body.get(key)
    if not isinstance(value, str):
        raise validation_error(path, "This field must be a string")
    if textutil.length(value) < 12:
        raise validation_error(path, "Use at least 12 characters")
    if textutil.length(value) > 200:
        raise validation_error(path, "Use at most 200 characters")
    return value
