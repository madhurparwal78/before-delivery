"""Markup building with escaping by default, for pages and for the SVG."""

from __future__ import annotations

import html
import string
from collections.abc import Iterable
from typing import Any


class Markup(str):
    """Text already safe to place inside markup."""

    __slots__ = ()


class _EscapingFormatter(string.Formatter):
    def format_field(self, value: Any, format_spec: str) -> str:
        if isinstance(value, Markup):
            return str(value)
        return html.escape(format(value, format_spec), quote=True)


_FORMATTER = _EscapingFormatter()


def fmt(template: str, *args: Any, **kwargs: Any) -> Markup:
    """Fill a markup template, escaping every value that is not Markup."""
    return Markup(_FORMATTER.vformat(template, args, kwargs))


def escape(value: Any) -> Markup:
    if isinstance(value, Markup):
        return value
    return Markup(html.escape(str(value), quote=True))


def join(parts: Iterable[Any], separator: str = "") -> Markup:
    return Markup(separator.join(str(escape(part)) for part in parts))
