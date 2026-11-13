"""Field checks: trimming, limits and the published field messages."""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Iterable

from . import errors
from .domain.kinds import ANY_KIND, KIND_CODES, LEVEL_CODES
from .domain.records import collapse_company
from .errors import ApiError

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
MISSING: Any = object()


class Fields:
    """Collects field errors so one request reports them all at once."""

    def __init__(self, body: dict[str, Any], editable: Iterable[str]) -> None:
        self._body = body
        self._errors: dict[str, str] = {}
        for key in body:
            if key not in set(editable):
                self._errors[key] = errors.FIELD_NOT_SETTABLE

    @property
    def errors(self) -> dict[str, str]:
        return self._errors

    def has(self, name: str) -> bool:
        return name in self._body

    def fail(self, name: str, message: str) -> None:
        self._errors.setdefault(name, message)

    def done(self) -> None:
        if self._errors:
            raise ApiError("validation", self._errors)

    # -- single fields -------------------------------------------------------

    def text(
        self,
        name: str,
        *,
        required: bool,
        max_length: int,
        collapse: bool = False,
        default: str = "",
    ) -> str:
        if name not in self._body:
            if required:
                self.fail(name, errors.FIELD_REQUIRED)
            return default
        raw = self._body[name]
        if not isinstance(raw, str):
            self.fail(name, errors.FIELD_REQUIRED)
            return default
        value = collapse_company(raw) if collapse else raw.strip()
        if not value and required:
            self.fail(name, errors.FIELD_REQUIRED)
        elif len(value) > max_length:
            self.fail(name, errors.FIELD_TOO_LONG)
        return value

    def data_kind(self, name: str = "data_kind", *, required: bool, allow_any: bool = False) -> str:
        if name not in self._body:
            if required:
                self.fail(name, errors.FIELD_REQUIRED)
            return ""
        raw = self._body[name]
        allowed = set(KIND_CODES) | ({ANY_KIND} if allow_any else set())
        if not isinstance(raw, str) or not raw.strip():
            self.fail(name, errors.FIELD_REQUIRED)
            return ""
        if raw not in allowed:
            self.fail(name, errors.FIELD_UNKNOWN_KIND)
            return ""
        return raw

    def level(self, name: str = "level", *, required: bool) -> str:
        if name not in self._body:
            if required:
                self.fail(name, errors.FIELD_REQUIRED)
            return ""
        raw = self._body[name]
        if not isinstance(raw, str) or not raw.strip():
            self.fail(name, errors.FIELD_REQUIRED)
            return ""
        if raw not in LEVEL_CODES:
            self.fail(name, errors.FIELD_UNKNOWN_LEVEL)
            return ""
        return raw

    def priority(self, name: str = "priority", *, default: int | None = None) -> int | None:
        if name not in self._body:
            return default
        raw = self._body[name]
        if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= 999:
            self.fail(name, errors.FIELD_BAD_PRIORITY)
            return default
        return raw

    def version(self, name: str = "version") -> int:
        raw = self._body.get(name, MISSING)
        if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
            self.fail(name, errors.FIELD_VERSION)
            return 0
        return raw

    def announced_on(self, name: str, today: date) -> date | None:
        if name not in self._body:
            self.fail(name, errors.FIELD_REQUIRED)
            return None
        raw = self._body[name]
        if not isinstance(raw, str) or not raw.strip():
            self.fail(name, errors.FIELD_REQUIRED)
            return None
        try:
            parsed = date.fromisoformat(raw.strip())
        except ValueError:
            self.fail(name, errors.FIELD_BAD_DATE)
            return None
        if parsed > today:
            self.fail(name, errors.FIELD_FUTURE_DATE)
            return None
        return parsed

    def data_kinds(self, name: str = "data_kinds") -> list[str]:
        raw = self._body.get(name, MISSING)
        if raw is MISSING or not isinstance(raw, list) or not raw:
            self.fail(name, errors.FIELD_KINDS_EMPTY)
            return []
        if any(not isinstance(code, str) or code not in KIND_CODES for code in raw):
            self.fail(name, errors.FIELD_UNKNOWN_KIND)
            return []
        if len(set(raw)) != len(raw):
            self.fail(name, errors.FIELD_KIND_REPEATED)
            return []
        return list(raw)

    def levels(self, name: str = "levels") -> list[str]:
        raw = self._body.get(name, MISSING)
        if raw is MISSING or not isinstance(raw, list) or not raw:
            self.fail(name, errors.FIELD_LEVELS_EMPTY)
            return []
        if any(not isinstance(code, str) or code not in LEVEL_CODES for code in raw):
            self.fail(name, errors.FIELD_UNKNOWN_LEVEL)
            return []
        return sorted(set(raw), key=LEVEL_CODES.index)

    def duration(self, name: str = "duration") -> str:
        raw = self._body.get(name, MISSING)
        if not isinstance(raw, str) or raw not in ("24h", "7d", "30d"):
            self.fail(name, errors.FIELD_BAD_DURATION)
            return ""
        return raw

    def email(self, name: str = "contact_email") -> str:
        if name not in self._body:
            self.fail(name, errors.FIELD_REQUIRED)
            return ""
        raw = self._body[name]
        if not isinstance(raw, str) or not raw.strip():
            self.fail(name, errors.FIELD_REQUIRED)
            return ""
        value = raw.strip().lower()
        if len(value) > 254:
            self.fail(name, errors.FIELD_TOO_LONG)
            return value
        if not EMAIL_PATTERN.match(value):
            self.fail(name, errors.FIELD_BAD_EMAIL)
        return value

    def password(self, name: str) -> str:
        if name not in self._body:
            self.fail(name, errors.FIELD_REQUIRED)
            return ""
        raw = self._body[name]
        if not isinstance(raw, str) or not raw:
            self.fail(name, errors.FIELD_REQUIRED)
            return ""
        return raw

    def rule_ids(self, current: list[str], name: str = "rule_ids") -> list[str]:
        raw = self._body.get(name, MISSING)
        if raw is MISSING or not isinstance(raw, list):
            self.fail(name, errors.FIELD_RULE_IDS)
            return []
        if any(not isinstance(value, str) for value in raw):
            self.fail(name, errors.FIELD_RULE_IDS)
            return []
        if len(raw) != len(set(raw)) or set(raw) != set(current):
            self.fail(name, errors.FIELD_RULE_IDS)
            return []
        return list(raw)
