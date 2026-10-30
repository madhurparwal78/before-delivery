"""The one refusal shape used by every handler."""


class Refusal(Exception):
    def __init__(self, status, message, field=None, lines=None, current=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.field = field
        self.lines = lines
        self.current = current

    def body(self):
        error = {"message": self.message}
        if self.field is not None:
            error["field"] = self.field
        if self.lines is not None:
            error["lines"] = self.lines
        payload = {"error": error}
        if self.current is not None:
            payload["current"] = self.current
        return payload


NOT_FOUND = "Not found"
TOO_LARGE = "That request is too large"
NO_METHOD = "That cannot be done here"
CROSS_SITE = "Cross-site requests are refused"
SEND_JSON = "Send JSON"
SEND_OBJECT = "Send a JSON object"
SIGN_IN_FIRST = "Sign in first"
ROLE_REFUSED = "Your role may not do that"
OWN_PIECE = "You cannot review your own piece"
SECOND_REVIEWER = "A second reviewer is required"
VERSION_REQUIRED = "A version is required"
STALE_VERSION = "This piece changed while you were deciding. Reload and try again"
IDENTITY_DOWN = "Sign-in is unavailable right now. Try again shortly"
BAD_CREDENTIALS = "Email or passphrase is not recognised"
LOCKED_OUT = "Too many attempts, wait 15 minutes"


def not_found():
    return Refusal(404, NOT_FOUND)
