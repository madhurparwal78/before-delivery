"""Declarative request validation. Values are checked in request order, so the first offending field wins."""
import re

from . import text
from .refusals import ApiError, invalid

DB_NAME = re.compile(r"^[a-z][a-z0-9_]{2,31}$")
SOURCE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PREDICATE = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
UNSTORABLE_MESSAGE = "Remove the control character from this text"


def join(path: str, part) -> str:
    return f"{path}.{part}" if path else str(part)


class Spec:
    nullable = False

    def check(self, value, path: str):
        raise NotImplementedError


class Loose(Spec):
    """A value the endpoint accepts and ignores; its strings must still be storable."""

    def check(self, value, path):
        if isinstance(value, str) and text.unstorable(value):
            raise invalid(path, UNSTORABLE_MESSAGE)
        if isinstance(value, list):
            for i, v in enumerate(value):
                self.check(v, join(path, i))
        if isinstance(value, dict):
            for k, v in value.items():
                self.check(v, join(path, k))
        return value


class Str(Spec):
    def __init__(self, lo: int = 1, hi: int | None = None, pattern: re.Pattern | None = None, trim: bool = False,
                 message: str | None = None, nullable: bool = False):
        self.lo, self.hi, self.pattern, self.trim, self.message, self.nullable = lo, hi, pattern, trim, message, nullable

    def check(self, value, path):
        if not isinstance(value, str):
            raise invalid(path, "Send this value as text")
        if text.unstorable(value):
            raise invalid(path, UNSTORABLE_MESSAGE)
        n = text.length(value.strip() if self.trim else value)
        if n < self.lo or (self.hi is not None and n > self.hi):
            raise invalid(path, self.message or f"Write {self.lo} to {self.hi} characters")
        if self.pattern and not self.pattern.match(value):
            raise invalid(path, self.message or "This value does not have the expected form")
        return value


class Int(Spec):
    def __init__(self, lo: int | None = None, hi: int | None = None, message: str | None = None):
        self.lo, self.hi, self.message = lo, hi, message

    def check(self, value, path):
        if isinstance(value, bool) or not isinstance(value, int) or \
                (self.lo is not None and value < self.lo) or (self.hi is not None and value > self.hi):
            raise invalid(path, self.message or "Send a whole number in range")
        return value


class Enum(Spec):
    def __init__(self, *values: str, nullable: bool = False):
        self.values, self.nullable = values, nullable

    def check(self, value, path):
        if not isinstance(value, str) or value not in self.values:
            raise invalid(path, "Choose one of " + ", ".join(self.values))
        return value


class Ts(Spec):
    def check(self, value, path):
        if isinstance(value, str) and text.unstorable(value):
            raise invalid(path, UNSTORABLE_MESSAGE)
        moment = text.parse_ts(value)
        if moment is None:
            raise invalid(path, "Write the time as YYYY-MM-DDTHH:MM:SSZ")
        return moment


class List(Spec):
    def __init__(self, item: Spec, lo: int = 0, hi: int | None = None, distinct: bool = False,
                 message: str | None = None, nullable: bool = False):
        self.item, self.lo, self.hi, self.distinct, self.message, self.nullable = item, lo, hi, distinct, message, nullable

    def check(self, value, path):
        if not isinstance(value, list):
            raise invalid(path, "Send a list here")
        if len(value) < self.lo or (self.hi is not None and len(value) > self.hi):
            raise invalid(path, self.message or f"Send {self.lo} to {self.hi} items")
        out, seen = [], set()
        for i, v in enumerate(value):
            item = self.item.check(v, join(path, i))
            if self.distinct:
                if item in seen:
                    raise invalid(join(path, i), "Each value may appear once")
                seen.add(item)
            out.append(item)
        return out


class Obj(Spec):
    """fields: name -> (spec, required). Unknown keys are refused at their own position."""

    def __init__(self, fields: dict, nullable: bool = False):
        self.fields, self.nullable = fields, nullable

    def check(self, value, path):
        if not isinstance(value, dict):
            raise invalid(path or None, "Send an object here")
        out = {}
        for k, v in value.items():
            if k not in self.fields:
                where = join(path, k)
                raise ApiError("UNKNOWN_FIELD", field=where, path=where)
            spec = self.fields[k][0]
            if v is None and spec.nullable:
                out[k] = None
            elif v is None:
                raise invalid(join(path, k), "This value is required")
            else:
                out[k] = spec.check(v, join(path, k))
        for k, (_, required) in self.fields.items():
            if required and k not in value:
                raise invalid(join(path, k), "This value is required")
        return out


class TextMap(Spec):
    """Feedback metadata: at most `hi` entries of key -> text."""

    KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

    def __init__(self, hi: int, value_hi: int):
        self.hi, self.value_hi = hi, value_hi
        self.nullable = True

    def check(self, value, path):
        if not isinstance(value, dict):
            raise invalid(path, "Send an object of text values")
        if len(value) > self.hi:
            raise invalid(path, f"Send at most {self.hi} entries")
        value_spec = Str(0, self.value_hi, message=f"Write at most {self.value_hi} characters")
        for k, v in value.items():
            if not self.KEY.match(k):
                raise invalid(join(path, k), "Use 1 to 64 letters, digits, _ or - for each key")
            value_spec.check(v, join(path, k))
        return value


def body_object(body) -> dict:
    if not isinstance(body, dict):
        raise invalid(None, "Send a JSON object")
    return body


def validate(spec: Obj, body) -> dict:
    return spec.check(body_object(body), "")


def query_param(query: dict, name: str, spec: Spec | None = None, required: bool = True):
    """A query-string value, checked by `spec` when given."""
    value = query.get(name)
    if value is None or value == "":
        if required:
            raise invalid(name, "This value is required")
        return None
    return spec.check(value, name) if spec else value


DB_NAME_SPEC = Str(3, 32, pattern=DB_NAME,
                   message="Lowercase letters, digits and underscores; 3 to 32 characters; starts with a letter")
DATABASE_REF = Str(1, 64, message="Name a database")
SOURCE_ID_SPEC = Str(1, 64, pattern=SOURCE_ID, message="Use 1 to 64 letters, digits, _ or -")
PREDICATE_SPEC = Str(2, 32, pattern=PREDICATE, message="Use an uppercase predicate such as OWNED_BY")
