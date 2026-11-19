"""The input rules every request body and query string goes through."""

from __future__ import annotations

import json
import re
from datetime import date
from typing import Any, TypeVar

from pydantic import BaseModel, ConfigDict, ValidationError

from .errors import UNKNOWN_FIELD_MESSAGE, validation_error

CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
NAMESPACE_PREFIX = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
FIELD_NAME = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
STREAM_NAME = re.compile(r"^[a-z][a-z0-9_]*$")
UUID_TEXT = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
IDEMPOTENCY_KEY = re.compile(r"^[\x21-\x7e]{1,255}$")
REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")

_MESSAGES: dict[str, str] = {
    "extra_forbidden": UNKNOWN_FIELD_MESSAGE,
    "missing": "This field is required.",
    "string_too_short": "This value is too short.",
    "string_too_long": "This value is too long.",
    "greater_than_equal": "This number is too small.",
    "less_than_equal": "This number is too large.",
    "literal_error": "This value is not one of the accepted values.",
    "enum": "This value is not one of the accepted values.",
    "too_short": "This list needs at least one entry.",
}


class Body(BaseModel):
    """Every request body model: strict types, and only the fields it lists."""

    model_config = ConfigDict(extra="forbid", strict=True)


ModelT = TypeVar("ModelT", bound=Body)


def parse_body(raw: bytes, model: type[ModelT]) -> ModelT:
    data = read_json_object(raw)
    reject_nul(data, "")
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise validation_error(_fields_from(exc)) from exc


def read_json_object(raw: bytes) -> dict[str, Any]:
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise validation_error({"body": "This request body is not readable JSON."}) from exc
    if not isinstance(data, dict):
        raise validation_error({"body": "This request body must be a JSON object."})
    return data


def reject_nul(value: Any, path: str) -> None:
    if isinstance(value, str):
        if "\x00" in value:
            raise validation_error({path or "body": "This text may not contain a NUL character."})
    elif isinstance(value, dict):
        for key, item in value.items():
            reject_nul(item, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            reject_nul(item, f"{path}.{index}" if path else str(index))


def _fields_from(exc: ValidationError) -> dict[str, str]:
    fields: dict[str, str] = {}
    for error in exc.errors():
        location = ".".join(str(part) for part in error["loc"] if part != "__root__")
        key = location or "body"
        fields.setdefault(key, _MESSAGES.get(error["type"], "This value is not accepted."))
    return fields


def parse_limit(raw: str | None, default: int) -> int:
    if raw is None:
        return default
    if not re.fullmatch(r"[0-9]{1,4}", raw):
        raise validation_error({"limit": "This value must be a whole number from 1 to 100."})
    value = int(raw)
    if not 1 <= value <= 100:
        raise validation_error({"limit": "This value must be a whole number from 1 to 100."})
    return value


def parse_search_query(raw: str | None) -> str | None:
    if raw is None:
        return None
    trimmed = raw.strip()
    if CONTROL_CHARACTERS.search(trimmed):
        raise validation_error({"q": "This search text may not contain control characters."})
    if len(trimmed) > 100:
        raise validation_error({"q": "This search text may hold at most 100 characters."})
    return trimmed or None


def parse_start_date(raw: str) -> date:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        raise validation_error({"config.start_date": "Write this date as YYYY-MM-DD."})
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise validation_error({"config.start_date": "Write this date as YYYY-MM-DD."}) from exc


def well_formed_id(raw: str) -> bool:
    return bool(UUID_TEXT.match(raw))


def read_idempotency_key(raw: str | None) -> str | None:
    if raw is None:
        return None
    if not IDEMPOTENCY_KEY.match(raw):
        raise validation_error({"Idempotency-Key": "This header must be 1 to 255 visible ASCII characters."})
    return raw


def multi_values(raw: list[str]) -> list[str]:
    """Several values for one filter, as repeated parameters or comma-separated."""
    values: list[str] = []
    for item in raw:
        values.extend(part for part in (piece.strip() for piece in item.split(",")) if part)
    return values
