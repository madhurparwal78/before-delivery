"""Request body parsing: unknown fields, NUL, types. Decided once for every endpoint."""
from __future__ import annotations

import json

from . import domain
from .core import validation


def check_nul(value, path: str, errors: dict[str, str]) -> None:
    if isinstance(value, str) and "\x00" in value:
        errors[path] = "This value contains an unsupported character."


def find_unknown(value, allowed: dict, path: str, errors: dict[str, str]) -> None:
    """Walk a parsed JSON body and report keys not in `allowed` for that level."""
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if key not in allowed:
                errors[child_path] = "This field is not accepted here."
            else:
                rule = allowed[key]
                if isinstance(rule, dict):
                    find_unknown(child, rule, child_path, errors)
                elif isinstance(rule, list) and isinstance(child, list):
                    for idx, item in enumerate(child):
                        find_unknown(item, rule[0], f"{child_path}.{idx}", errors)
                elif isinstance(rule, list) and not isinstance(child, list):
                    pass


def check_types(value, spec: dict, path: str, errors: dict[str, str]) -> None:
    """spec maps key -> python type or (list_of, item_spec) marker."""
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        child_path = f"{path}.{key}" if path else key
        if key not in spec:
            continue
        rule = spec[key]
        if isinstance(rule, type):
            if rule is str and not isinstance(child, str):
                errors[child_path] = "This value must be text."
            elif rule is bool:
                if not isinstance(child, bool):
                    errors[child_path] = "This value must be true or false."
            elif rule is int and (not isinstance(child, int) or isinstance(child, bool)):
                errors[child_path] = "This value must be a whole number."
            elif rule not in (str, bool, int) and not isinstance(child, rule):
                errors[child_path] = "This value has the wrong type."
        elif isinstance(rule, dict):
            if not isinstance(child, dict):
                errors[child_path] = "This value must be an object."
            else:
                check_types(child, rule, child_path, errors)
        elif isinstance(rule, tuple):
            _, item_spec = rule
            if not isinstance(child, list):
                errors[child_path] = "This value must be a list."
            else:
                for idx, item in enumerate(child):
                    if isinstance(item_spec, dict):
                        if not isinstance(item, dict):
                            errors[f"{child_path}.{idx}"] = "This value must be an object."
                        else:
                            check_types(item, item_spec, f"{child_path}.{idx}", errors)


def walk_strings(value, path: str, errors: dict[str, str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            walk_strings(child, f"{path}.{key}" if path else key, errors)
    elif isinstance(value, list):
        for idx, item in enumerate(value):
            walk_strings(item, f"{path}.{idx}", errors)
    elif isinstance(value, str):
        check_nul(value, path, errors)


def validate_body(raw_body: bytes, allowed_fields: dict | None,
                  type_spec: dict | None = None) -> dict:
    """Parse a JSON object body applying the general input rules. Raises ApiError."""
    if raw_body in (b"", None):
        return {}
    try:
        parsed = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise validation({"body": "The request body must be a JSON object."})
    if not isinstance(parsed, dict):
        raise validation({"body": "The request body must be a JSON object."})
    errors: dict[str, str] = {}
    walk_strings(parsed, "", errors)
    if allowed_fields is not None:
        find_unknown(parsed, allowed_fields, "", errors)
    if type_spec is not None:
        check_types(parsed, type_spec, "", errors)
    if errors:
        raise validation(errors)
    return parsed


def parse_q(value: str | None) -> tuple[str | None, str | None]:
    """Trim search text; return (value, error)."""
    if value is None:
        return None, None
    if len(value) > 100:
        return None, "q"
    trimmed = value.strip()
    for ch in trimmed:
        if ord(ch) <= 31 or ord(ch) == 127:
            return None, "q"
    return (trimmed if trimmed else None), None


def catalog_matches(name: str, q: str) -> bool:
    """Literal case-insensitive substring match on the connector name."""
    return q.lower() in name.lower()


def builder_resolve(base_url: str, path: str) -> tuple[str | None, str | None]:
    """Resolve a Builder address; returns (final_path, error_field)."""
    decoded_base = decode_once(base_url)
    if decoded_base is None:
        return None, "base_url"
    if refused(decoded_base):
        return None, "base_url"
    base = remove_dots(decoded_base)
    if not base.startswith("/mock-api/"):
        return None, "base_url"
    decoded_path = decode_once(path)
    if decoded_path is None or refused(decoded_path):
        return None, "streams.0.path"
    combined = base.rstrip("/") + decoded_path
    final = remove_dots(combined)
    if not final.startswith("/mock-api/"):
        return None, "streams.0.path"
    return final, None


def decode_once(value: str) -> str | None:
    import urllib.parse

    try:
        decoded = urllib.parse.unquote(value, errors="strict")
    except Exception:
        return None
    return decoded


def refused(value: str) -> bool:
    if "\\" in value or "//" in value:
        return True
    if domain._SCHEME_RE.match(value):
        return True
    return any(ch in value for ch in ("@", "?", "#"))


def remove_dots(path: str) -> str:
    return domain._remove_dot_segments(path)
