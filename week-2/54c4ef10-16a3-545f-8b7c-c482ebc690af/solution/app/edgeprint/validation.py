"""Field rules and their published copy. The browser form takes the same copy and limits from `web_domain.py`."""

import math
import re
from decimal import Decimal
from typing import Any, Callable

from .errors import validation_failed
from .exposure import APERTURES, EV_MAX, EV_MIN, aperture_index, parse_shutter

MINUS = "−"
NOTE_LIMIT = 500
TITLE_LIMIT = 80
NAME_LIMIT = 80
STOCK_LIMIT = 60
EI_RANGE = (6, 12800)
PUSH_PULL_RANGE = (-3, 3)
RECIPROCITY_RANGE = (0.50, 1.00)
COUNTER_RANGE = (0, 99)
PASSWORD_LENGTH = (10, 128)
UPLOAD_LIMIT = 60_000_000
EMAIL_LIMIT = 254
DPI_RANGE = (300, 10000)
FIRST_EDGE_RANGE = (0, 99)
FORMATS = ("35mm", "120-6x6", "120-6x7")
KINDS = ("normal", "test")

MESSAGES: dict[str, str] = {
    "email": "Enter a valid email address.",
    "password": "Use 10 to 128 characters.",
    "name": "Give the roll a name of up to 80 characters.",
    "stock": "Name the stock in up to 60 characters.",
    "format": "Choose 35mm, 120 6×6 or 120 6×7.",
    "kind": "Choose normal roll or test roll.",
    "format_kind_change": "Format and kind cannot change after the roll is created.",
    "ei": "EI is a whole number from 6 to 12800.",
    "push_pull": f"Push or pull is a whole number of stops from {MINUS}3 to +3.",
    "reciprocity_p": "Reciprocity exponent is a number from 0.50 to 1.00 with up to two decimals.",
    "development_note": "Development notes are limited to 500 characters.",
    "curve_roll_id": "Choose one of your test rolls.",
    "counter": "Counter is a whole number from 0 to 99.",
    "aperture": "Use a marked aperture such as 5.6 or 11.",
    "shutter": 'Use a shutter speed such as 1/125, 1/2 or 2".',
    "metered_ev": f"Metered EV is a number from {MINUS}6 to 21.",
    "note": "Notes are limited to 500 characters.",
    "title": "Titles are limited to 80 characters.",
    "dpi": "DPI is a whole number from 300 to 10000.",
    "first_edge": "Edge number is a whole number from 0 to 99.",
    "size": "Declared size does not match the received file.",
    "sha256": "Checksum does not match the received file.",
    "file_dimensions": "Scans are limited to 20,000 × 4,000 pixels and 40,000,000 pixels in total.",
    "file_pixel_format": "Use 8- or 16-bit greyscale or RGB.",
    "file_tiff_layout": "TIFF scans must hold one striped image, uncompressed or LZW- or Deflate-compressed.",
    "file_unreadable": "This file could not be read as an image.",
    "area": "Mark an area inside the scan, at least 8 × 8 pixels.",
    "wedge_size": "Mark the whole wedge, at least 42 pixels wide and 8 tall.",
    "wedge_order": "The wedge steps must darken from left to right.",
    "edge": "Frame edges must stay inside the scan, at least 8 pixels apart, without overlapping a neighbour.",
    "point_outside": "Point is outside the scan.",
    "pin_outside_frame": "Pin inside a frame.",
    "scan_no_frames": "No frames found for this format and DPI.",
    "offset": f"Offset is a whole number from {MINUS}2 to +2.",
    "slip_after": "Choose a note on this roll, or no slip.",
    "overrides": "Each note and frame can appear once and must belong to this roll.",
    "version": "Reload the alignment before saving.",
}

LIMITS: dict[str, int] = {"note": NOTE_LIMIT, "title": TITLE_LIMIT, "name": NAME_LIMIT, "stock": STOCK_LIMIT,
                          "development_note": NOTE_LIMIT}

_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class Invalid(Exception):
    """A value that breaks its field's rule."""


Rule = Callable[[Any], Any]


def text(min_length: int, max_length: int) -> Rule:
    def rule(value: Any) -> str:
        if not isinstance(value, str) or not min_length <= len(value.strip()) <= max_length:
            raise Invalid
        return value.strip()
    return rule


def password(value: Any) -> str:
    if not isinstance(value, str) or not PASSWORD_LENGTH[0] <= len(value) <= PASSWORD_LENGTH[1]:
        raise Invalid
    return value


def whole_number(low: int, high: int) -> Rule:
    def rule(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise Invalid
        if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
            raise Invalid
        if not low <= value <= high:
            raise Invalid
        return int(value)
    return rule


def number(low: float, high: float, decimals: int | None = None) -> Rule:
    def rule(value: Any) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise Invalid
        if not low <= value <= high:
            raise Invalid
        if decimals is not None and Decimal(repr(float(value))).as_tuple().exponent < -decimals:  # type: ignore[operator]
            raise Invalid
        return float(value)
    return rule


def one_of(options: tuple[str, ...]) -> Rule:
    def rule(value: Any) -> str:
        if value not in options:
            raise Invalid
        return value
    return rule


def aperture(value: Any) -> str:
    if not isinstance(value, str):
        raise Invalid
    index = aperture_index(value.strip())
    if index is None:
        raise Invalid
    return APERTURES[index]


def shutter(value: Any) -> str:
    if not isinstance(value, str) or parse_shutter(value.strip()) is None:
        raise Invalid
    return value.strip()


def email(value: Any) -> str:
    if not isinstance(value, str) or len(value.strip()) > EMAIL_LIMIT or not _EMAIL.fullmatch(value.strip()):
        raise Invalid
    return value.strip().lower()


def boolean(value: Any) -> bool:
    if not isinstance(value, bool):
        raise Invalid
    return value


ROLL_RULES: dict[str, Rule] = {
    "name": text(1, NAME_LIMIT), "stock": text(1, STOCK_LIMIT), "format": one_of(FORMATS),
    "ei": whole_number(*EI_RANGE), "push_pull": whole_number(*PUSH_PULL_RANGE),
    "reciprocity_p": number(*RECIPROCITY_RANGE, decimals=2), "development_note": text(0, NOTE_LIMIT),
    "kind": one_of(KINDS),
}
ENTRY_RULES: dict[str, Rule] = {
    "counter": whole_number(*COUNTER_RANGE), "aperture": aperture, "shutter": shutter,
    "metered_ev": number(EV_MIN, EV_MAX), "note": text(0, NOTE_LIMIT), "misfire": boolean,
}

REQUIRED = object()


class Form:
    """Collects every failing field of one request body, then raises them together."""

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body
        self.errors: dict[str, str] = {}
        self.values: dict[str, Any] = {}

    def field(self, name: str, rule: Rule, default: Any = REQUIRED) -> None:
        """Validate `name`; an absent key takes `default` or, when there is none, is an error."""
        if name not in self.body:
            if default is REQUIRED:
                self.errors[name] = MESSAGES[name]
            else:
                self.values[name] = default
            return
        try:
            self.values[name] = rule(self.body[name])
        except Invalid:
            self.errors[name] = MESSAGES[name]

    def optional(self, name: str, rule: Rule) -> None:
        """Validate `name` only when the body names it (a PATCH)."""
        if name in self.body:
            self.field(name, rule)

    def fail(self, name: str, message_key: str | None = None) -> None:
        self.errors[name] = MESSAGES[message_key or name]

    def done(self) -> dict[str, Any]:
        if self.errors:
            raise validation_failed(self.errors)
        return self.values


ROLL_DEFAULTS: dict[str, Any] = {"reciprocity_p": 1.0, "development_note": "", "kind": "normal"}
ENTRY_DEFAULTS: dict[str, Any] = {"note": "", "misfire": False}
