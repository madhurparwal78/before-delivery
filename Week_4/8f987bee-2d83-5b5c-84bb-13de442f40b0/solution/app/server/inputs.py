"""Input rules for every request body: a JSON object, only the listed fields, the right types, no NUL."""

import json
from typing import Any, TypeVar

from fastapi import Request
from pydantic import BaseModel, ConfigDict, ValidationError

from .errors import FIELD_NOT_ACCEPTED, validation

MESSAGES = {
    "extra_forbidden": FIELD_NOT_ACCEPTED,
    "missing": "This field is required.",
    "string_type": "Enter text for this field.",
    "int_type": "Enter a whole number.",
    "bool_type": "Choose true or false.",
    "list_type": "This field must be a list.",
    "dict_type": "This field must be an object.",
    "model_type": "This field must be an object.",
    "model_attributes_type": "This field must be an object.",
    "literal_error": "Choose one of the listed values.",
    "string_too_short": "This field cannot be empty.",
    "string_too_long": "This text is too long.",
}
NUL_MESSAGE = "This text contains a character that is not allowed."
BODY_MESSAGE = "Send a JSON object as the request body."
NAME_MAX = 80


class Body(BaseModel):
    """Every request model: unknown keys refused at every depth, JSON types taken strictly."""

    model_config = ConfigDict(extra="forbid", strict=True)


ModelT = TypeVar("ModelT", bound=Body)


def dotted(location: tuple[Any, ...]) -> str:
    return ".".join(str(part) for part in location)


def _nul_paths(value: Any, path: tuple[Any, ...] = ()) -> list[str]:
    if isinstance(value, str):
        return [dotted(path)] if "\x00" in value else []
    if isinstance(value, dict):
        found = [dotted((*path, key)) for key in value if "\x00" in key]
        return found + [p for key, item in value.items() for p in _nul_paths(item, (*path, key))]
    if isinstance(value, list):
        return [p for index, item in enumerate(value) for p in _nul_paths(item, (*path, index))]
    return []


def raw_json(request: Request) -> Any:
    """The parsed body, `{}` for an empty body; a body that is not a JSON object is refused."""
    raw: bytes = request.scope.get("wayline.body", b"")
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise validation({"body": BODY_MESSAGE}) from None
    if not isinstance(value, dict):
        raise validation({"body": BODY_MESSAGE})
    return value


def shape_errors(model: type[ModelT], value: dict[str, Any]) -> tuple[ModelT | None, dict[str, str]]:
    """Validate `value` against `model`; returns the instance or the field messages."""
    fields = {path: NUL_MESSAGE for path in _nul_paths(value)}
    try:
        parsed = model.model_validate(value)
    except ValidationError as error:
        for item in error.errors():
            fields.setdefault(dotted(item["loc"]), MESSAGES.get(item["type"], "This value is not valid."))
        return None, fields
    return (None, fields) if fields else (parsed, {})


def parse(request: Request, model: type[ModelT]) -> ModelT:
    parsed, fields = shape_errors(model, raw_json(request))
    if fields:
        raise validation(fields)
    return parsed


def name_error(name: str) -> str | None:
    """Names of sources, destinations, connections, projects and members: 1 to 80 characters once trimmed."""
    return None if 1 <= len(name.strip()) <= NAME_MAX else "Enter a name of 1 to 80 characters."
