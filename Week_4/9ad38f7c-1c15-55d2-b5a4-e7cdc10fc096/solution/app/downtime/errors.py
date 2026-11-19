"""The one error shape every API refusal uses: {"error": code} plus "fields" for validation."""

from starlette.responses import JSONResponse

NO_STORE = {"Cache-Control": "no-store"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, *, fields: dict[str, str] | None = None,
                 headers: dict[str, str] | None = None) -> None:
        super().__init__(code)
        self.status, self.code, self.fields, self.headers = status, code, fields, headers or {}

    def response(self) -> JSONResponse:
        body: dict[str, object] = {"error": self.code}
        if self.fields is not None:
            body["fields"] = self.fields
        return JSONResponse(body, status_code=self.status, headers={**NO_STORE, **self.headers})


def validation(fields: dict[str, str]) -> ApiError:
    return ApiError(400, "validation", fields=fields)

