"""Every API refusal is built here, in the one JSON shape."""

import json

from flask import Response

from .config import MAX_BODY_BYTES

NOT_A_JSON_OBJECT = "The request body is not a JSON object."
SIGN_IN_REQUIRED = "Sign in to continue."
SIGN_IN_REFUSED = "Email or password is incorrect."
NOT_FOUND = "Not found."
METHOD_NOT_ALLOWED = "Method not allowed."
SLUG_CONFLICT = "That slug is already in use."
ALREADY_PUBLISHED = "This case study is already published."
ALREADY_DRAFT = "This case study is already a draft."
ALREADY_RESOLVED = "This inquiry is already resolved."
BODY_TOO_LARGE = f"The request body is larger than {MAX_BODY_BYTES:,} bytes."
UNSUPPORTED_MEDIA_TYPE = "Send the request body as application/json."
TOO_MANY_SIGN_IN_ATTEMPTS = "Too many sign-in attempts. Try again later."
SERVICE_UNAVAILABLE = "The service is briefly unavailable. Try again in a minute."
INTERNAL_ERROR = "Something went wrong."
FIELDS_NEED_ATTENTION = "Some fields need attention."


class ApiError(Exception):
    """A refusal to answer, carrying its own status, reason and headers."""

    def __init__(self, status, reason, errors=None, headers=None):
        super().__init__(reason)
        self.status = status
        self.reason = reason
        self.errors = errors
        self.headers = headers or {}


def validation_error(errors):
    return ApiError(422, FIELDS_NEED_ATTENTION, errors=errors)


def not_found():
    return ApiError(404, NOT_FOUND)


def json_refusal(error):
    """Render an ApiError as the one JSON refusal shape."""
    body = {"error": error.reason}
    if error.errors:
        body["errors"] = error.errors
    response = Response(
        json.dumps(body), status=error.status, mimetype="application/json"
    )
    for name, value in error.headers.items():
        response.headers[name] = value
    return response
