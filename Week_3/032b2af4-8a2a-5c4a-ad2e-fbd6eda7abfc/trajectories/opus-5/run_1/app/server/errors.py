"""The one shared error shape for every /api response."""
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, error: str, **extra):
        super().__init__(error)
        self.status = status
        self.body = {"error": error, **extra}

    def response(self) -> JSONResponse:
        return JSONResponse(self.body, status_code=self.status)


def validation(fields: dict) -> ApiError:
    return ApiError(400, "validation", fields=fields)


def not_found() -> ApiError:
    return ApiError(404, "not_found")


def forbidden() -> ApiError:
    return ApiError(403, "forbidden")


def unauthorized() -> ApiError:
    return ApiError(401, "unauthorized")
