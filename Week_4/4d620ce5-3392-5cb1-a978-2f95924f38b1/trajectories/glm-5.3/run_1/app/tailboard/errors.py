"""The single API error shape (DP-06). Every error body is {"error":{"code","message",...}}."""
import json


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra

    def body(self) -> dict:
        error = {"code": self.code, "message": self.message}
        error.update(self.extra)
        return {"error": error}


def json_error(status: int, code: str, message: str, **extra) -> tuple[bytes, str, int]:
    payload = ApiError(status, code, message, **extra).body()
    return json.dumps(payload).encode(), "application/json; charset=utf-8", status


def bad_request(code: str, message: str, **extra) -> ApiError:
    return ApiError(400, code, message, **extra)


def unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated", "Sign in to continue.")


def forbidden(message: str = "Your role cannot do this.", code: str = "forbidden", **extra) -> ApiError:
    return ApiError(403, code, message, **extra)


def not_found(message: str = "Not found.") -> ApiError:
    return ApiError(404, "not_found", message)


def method_not_allowed() -> ApiError:
    return ApiError(405, "method_not_allowed", "This path does not accept that method.")


def conflict(code: str, message: str, **extra) -> ApiError:
    return ApiError(409, code, message, **extra)


def payload_too_large(message: str = "That request body is too large.") -> ApiError:
    return ApiError(413, "payload_too_large", message)


def unsupported_media_type(message: str = "That content type is not accepted.") -> ApiError:
    return ApiError(415, "unsupported_media_type", message)


def validation(fields: dict) -> ApiError:
    return ApiError(422, "validation", "The request is not valid.", fields=fields)


def storage_unavailable(message: str = "Object storage is unavailable.") -> ApiError:
    return ApiError(503, "storage_unavailable", message)
