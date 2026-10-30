"""The one refusal catalogue and the one refusal type.

Every refusal in the app is raised as a TesselError built from this catalogue,
so the API and the console always read the same.
"""

CATALOGUE = {
    "API_VERSION_REQUIRED": (400, "Send the header API-Version: 2"),
    "UNSUPPORTED_API_VERSION": (400, "Only API-Version 2 is supported"),
    "MALFORMED_JSON": (400, "The request body is not valid JSON"),
    "UNKNOWN_FIELD": (400, "Unknown field {path}"),
    "INVALID_CURSOR": (400, "This cursor is not valid"),
    "READ_ONLY_QUERY": (400, "Graph queries are read-only"),
    "CYPHER_SYNTAX": (400, "The statement does not follow the query grammar"),
    "CYPHER_SEMANTIC": (400, "The statement returns a variable it never bound"),
    "RESET_TOKEN_INVALID": (400, "This reset link is no longer valid"),
    "VALIDATION_ERROR": (400, None),
    "UNAUTHENTICATED": (401, "Sign in or send an API key"),
    "INVALID_API_KEY": (401, "This credential is not valid"),
    "BAD_CREDENTIALS": (401, "Email or password is incorrect"),
    "TOTP_REQUIRED": (401, "Enter the code from your authenticator app"),
    "BAD_TOTP": (401, "That code is not valid"),
    "FORBIDDEN_ROLE": (403, "Your role cannot do this"),
    "PLAN_LIMIT": (403, "Your plan allows {allowed} databases"),
    "DATABASE_NOT_FOUND": (404, "Database not found"),
    "SOURCE_NOT_FOUND": (404, "Source not found"),
    "COLLECTION_NOT_FOUND": (404, "Collection not found"),
    "REQUEST_NOT_FOUND": (404, "No answered request has this id"),
    "MEMBER_NOT_FOUND": (404, "Member not found"),
    "KEY_NOT_FOUND": (404, "API key not found"),
    "JOB_NOT_FOUND": (404, "Job not found"),
    "ROUTE_NOT_FOUND": (404, "No route matches this address"),
    "METHOD_NOT_ALLOWED": (405, "This address does not accept {method}"),
    "DATABASE_NOT_READY": (409, "This database is still provisioning"),
    "DATABASE_ALREADY_EXISTS": (409, "A database with this name already exists"),
    "MEMBER_EXISTS": (409, "A member with this email already exists"),
    "LAST_OWNER": (409, "An organization needs at least one owner"),
    "PLAN_DOWNGRADE_BLOCKED": (
        409,
        "Ship allows 3 databases. Delete databases before switching.",
    ),
    "VERSION_CONFLICT": (409, "Source {id} is at version {version}"),
    "SOURCE_IS_LIVE": (409, "Source {id} is not deleted"),
    "KEY_REVOKED": (409, "This API key is revoked"),
    "JOB_NOT_FINISHED": (409, "This export is not finished"),
    "IDEMPOTENCY_IN_PROGRESS": (
        409,
        "A request with this idempotency key is still running",
    ),
    "COLLECTION_NOT_EMPTY": (409, "Delete the sources in this collection first"),
    "COLLECTION_IS_DEFAULT": (409, "The default collection cannot be deleted"),
    "TOTP_ALREADY_ON": (409, "Two-step sign-in is already on"),
    "TOTP_NOT_ON": (409, "Two-step sign-in is off"),
    "PAYLOAD_TOO_LARGE": (413, "The request body is over 2 MB"),
    "IDEMPOTENCY_KEY_REUSED": (
        422,
        "This idempotency key was used with a different request",
    ),
    "RATE_LIMITED": (429, "Too many requests. Try again in {seconds} seconds."),
    "SIGN_IN_THROTTLED": (
        429,
        "Too many sign-in attempts. Try again in {seconds} seconds.",
    ),
}

SOURCE_MISSING_MESSAGE = "No source with this id in this scope"


class TesselError(Exception):
    """A refusal carrying its catalogue code, status, message and field."""

    def __init__(self, code, field=None, message=None, headers=None, **parts):
        status, template = CATALOGUE[code]
        if message is None:
            if template is None:
                raise ValueError("VALIDATION_ERROR needs a message")
            message = template.format(**parts) if parts else template
        self.code = code
        self.status = status
        self.message = message
        self.field = field
        self.headers = headers or {}
        super().__init__(message)


def validation_error(field, message):
    return TesselError("VALIDATION_ERROR", field=field, message=message)
