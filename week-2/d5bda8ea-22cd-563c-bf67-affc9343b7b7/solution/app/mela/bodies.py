"""The request-body check: a JSON object holding only the keys an endpoint names, each of its exact type."""
import json

from flask import request

from .errors import invalid


def _is_text(value):
    return isinstance(value, str) and "\x00" not in value


def _is_bool(value):
    return isinstance(value, bool)


def _is_int_or_null(value):
    return value is None or (isinstance(value, int) and not isinstance(value, bool))


def _is_text_list(value):
    return isinstance(value, list) and all(_is_text(item) for item in value)


def _is_text_or_null(value):
    return value is None or _is_text(value)


TEXT = (_is_text, "Must be text")
BOOL = (_is_bool, "Must be true or false")
INT_OR_NULL = (_is_int_or_null, "Must be a whole number or null")
TEXT_LIST = (_is_text_list, "Must be a list of category slugs")
TEXT_OR_NULL = (_is_text_or_null, "Must be a community slug or null")

EVENT_FIELDS = {
    "name": TEXT, "description": TEXT, "start_at": TEXT, "end_at": TEXT, "timezone": TEXT, "location_type": TEXT,
    "venue_name": TEXT, "street_address": TEXT, "city": TEXT, "virtual_link": TEXT, "visibility": TEXT,
    "require_approval": BOOL, "capacity": INT_OR_NULL, "waitlist": BOOL, "theme": TEXT, "categories": TEXT_LIST,
    "calendar": TEXT_OR_NULL, "show_guest_list": BOOL,
}
EVENT_EDIT_FIELDS = {**EVENT_FIELDS, "registration_status": TEXT}
NONE = {}


def parse(fields):
    """The request's JSON object, or a 422 naming the body, every unknown key and every wrongly typed value."""
    raw = request.get_data(cache=True)
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise invalid({"body": "Expected a JSON object"})
    errors = {}
    for key, value in body.items():
        if key not in fields:
            errors[key] = "Unknown field"
        elif not fields[key][0](value):
            errors[key] = fields[key][1]
    if errors:
        raise invalid(errors)
    return body
