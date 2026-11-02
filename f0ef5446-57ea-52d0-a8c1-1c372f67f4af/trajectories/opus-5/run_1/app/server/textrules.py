"""The counting rule and the unsupported-character rule, decided in one place."""

from __future__ import annotations

import unicodedata

WHITE_SPACE = frozenset(
    "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)

_ALLOWED_CONTROLS = frozenset("\u0009\u000a\u000d")


def normalise(value: str) -> str:
    """The trimmed NFC form that the missing, limit and malformed checks read."""
    composed = unicodedata.normalize("NFC", value)
    start = 0
    end = len(composed)
    while start < end and composed[start] in WHITE_SPACE:
        start += 1
    while end > start and composed[end - 1] in WHITE_SPACE:
        end -= 1
    return composed[start:end]


def count_code_points(value: str) -> int:
    """A value's length under the counting rule."""
    return len(normalise(value))


def has_unsupported_characters(value: str) -> bool:
    """True when the value, exactly as sent, carries an unsupported character."""
    for char in value:
        code = ord(char)
        if code < 0x20 and char not in _ALLOWED_CONTROLS:
            return True
        if code == 0x7F:
            return True
        if 0xD800 <= code <= 0xDFFF:
            return True
    return False


def contains_white_space(value: str) -> bool:
    return any(char in WHITE_SPACE for char in value)


def email_key(value: str) -> str:
    """The stored form of a work email, and the sign-in failure limit's email key."""
    return normalise(value).lower()
