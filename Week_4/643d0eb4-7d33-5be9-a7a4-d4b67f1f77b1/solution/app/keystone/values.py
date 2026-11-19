"""Typed values at the write boundary: a value is accepted for its column type or refused 422 naming the caption."""
import math
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from . import config
from .errors import refuse

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LIMIT = 10**12


def _wrong(caption: str, wanted: str):
    refuse(422, f"{caption} must be {wanted}", caption)


def check_value(col: dict, value):
    """Return the stored form of `value` for column `col` or refuse."""
    caption, kind = col["caption"], col["type"]
    if kind == "text":
        if value is None:
            return None
        if not isinstance(value, str):
            _wrong(caption, "text")
        if len(value) > config.TEXT_CEILING:
            _wrong(caption, f"text of at most {config.TEXT_CEILING} characters")
        return value
    if kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int) or abs(value) >= LIMIT:
            _wrong(caption, "a whole number (integer)")
        return value
    if kind == "decimal":
        if value is None:
            return None
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                or abs(value) >= LIMIT):
            _wrong(caption, "a number with at most two decimal places (decimal)")
        try:
            exponent = Decimal(repr(value)).as_tuple().exponent
        except InvalidOperation:
            _wrong(caption, "a number with at most two decimal places (decimal)")
        if isinstance(exponent, int) and exponent < -2:
            _wrong(caption, "a number with at most two decimal places (decimal)")
        return value
    if kind == "date":
        if value is None:
            return None
        if not isinstance(value, str) or not DATE_RE.match(value):
            _wrong(caption, "a calendar date written year-month-day (date)")
        try:
            date.fromisoformat(value)
        except ValueError:
            _wrong(caption, "a calendar date written year-month-day (date)")
        return value
    if kind == "choice":
        if value is None:
            return None
        if not isinstance(value, str) or value not in (col["options"] or []):
            _wrong(caption, "one of " + ", ".join(col["options"] or []) + " (choice)")
        return value
    if kind == "flag":
        if not isinstance(value, bool):
            _wrong(caption, "true or false (flag)")
        return value
    _wrong(caption, kind)


def check_values(columns: list[dict], values, *, partial: bool) -> dict:
    """Validate a whole `values` map. A create fills every column (missing ones empty); an update names changes."""
    if not isinstance(values, dict):
        refuse(422, "values must be an object keyed by column caption", "values")
    by_caption = {c["caption"]: c for c in columns}
    unknown = [k for k in values if k not in by_caption]
    if unknown:
        refuse(422, f"There is no column {unknown[0]}", unknown[0])
    out = {}
    for col in columns:
        caption = col["caption"]
        if caption in values:
            out[caption] = check_value(col, values[caption])
        elif not partial:
            out[caption] = None
    return out


def column_spec(body: dict) -> tuple[str, str, list | None]:
    caption = body.get("caption")
    if not isinstance(caption, str) or not caption.strip() or len(caption.strip()) > 60:
        refuse(422, "Give the column a caption of up to 60 characters", "caption")
    kind = body.get("type")
    if kind not in config.COLUMN_TYPES:
        refuse(422, "The column type must be one of " + ", ".join(config.COLUMN_TYPES), "type")
    options = body.get("options")
    if kind == "choice":
        if (not isinstance(options, list) or not options
                or not all(isinstance(o, str) and o.strip() and len(o) <= 60 for o in options)
                or len(set(options)) != len(options)):
            refuse(422, "A choice column needs a list of distinct options", "options")
    else:
        options = None
    return caption.strip(), kind, options
