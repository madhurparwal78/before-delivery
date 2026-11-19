"""The one error shape and the one error precedence."""

import json

class ApiError(Exception):
    """Every API error. Refusals store nothing: the handler rolls the
    transaction back whenever this escapes the domain call."""

    def __init__(self, status, code, fields=None, headers=None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.fields = fields
        self.headers = headers

    def body(self):
        out = {"error": self.code}
        if self.fields:
            out["fields"] = self.fields
        return out

def validation(field, message):
    return ApiError(400, "validation", {field: message})

# --- precedence step 1 and 2: the address ------------------------------------

def not_found():
    return ApiError(404, "not_found")

def method_not_allowed(allow):
    return ApiError(405, "method_not_allowed", headers=[("Allow", allow)])

# --- precedence step 3 to 5 ---------------------------------------------------

def payload_too_large():
    return ApiError(413, "payload_too_large")

def unsupported_media_type():
    return ApiError(415, "unsupported_media_type")

def invalid_json():
    return ApiError(400, "invalid_json")

def unauthenticated():
    return ApiError(401, "unauthenticated")

# --- precedence step 6 to 9 ---------------------------------------------------

def not_in_team():
    """Teamless where a team is needed: 409."""
    return ApiError(409, "not_in_team")

def team_room_not_in_team():
    """GET /api/teams/mine is that route's own standing answer: 404."""
    return ApiError(404, "not_in_team")

def no_team():
    return ApiError(409, "no_team")

def already_in_team():
    return ApiError(409, "already_in_team")

def not_complete():
    return ApiError(403, "not_complete")

def not_captain():
    return ApiError(403, "not_captain")

def unknown_scenario():
    return ApiError(404, "unknown_scenario")

def unknown_invite_code():
    return ApiError(404, "unknown_invite_code")

def not_a_member():
    return ApiError(404, "not_a_member")

def captain_cannot_remove_self():
    return ApiError(409, "captain_cannot_remove_self")

# --- precedence step 10 ------------------------------------------------------

def email_taken():
    return ApiError(409, "email_taken")

def name_taken():
    return ApiError(409, "name_taken")

def team_full():
    return ApiError(409, "team_full")

def already_claimed():
    return ApiError(409, "already_claimed")

# --- precedence step 11 ------------------------------------------------------

def too_many_attempts(retry_after):
    return ApiError(429, "too_many_attempts",
                    headers=[("Retry-After", str(retry_after))])

# --- precedence step 12 ------------------------------------------------------

def wrong_flag():
    return ApiError(422, "wrong_flag")

def invalid_credentials():
    return ApiError(401, "invalid_credentials")

# --- database outage ---------------------------------------------------------

def starting():
    return ApiError(503, "starting")

def unavailable():
    return ApiError(503, "unavailable")

def error_bytes(err):
    return (json.dumps(err.body(), ensure_ascii=False) + "\n").encode("utf-8")
