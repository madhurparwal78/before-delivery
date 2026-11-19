"""One refusal shape: every client error is built by `refuse`."""
from typing import NoReturn

from starlette.responses import JSONResponse


class Refusal(Exception):
    def __init__(self, status: int, reason: str, field: str | None = None, headers: dict | None = None,
                 meta: dict | None = None, **extra) -> None:
        super().__init__(reason)
        self.status, self.reason, self.field = status, reason, field
        self.headers, self.extra = headers or {}, extra
        self.meta = meta or {}  # for pages only; never part of the JSON body

    def body(self) -> dict:
        return {"reason": self.reason, "field": self.field, **self.extra}


def refuse(status: int, reason: str, field: str | None = None, headers: dict | None = None, meta: dict | None = None,
           **extra) -> NoReturn:
    raise Refusal(status, reason, field, headers, meta, **extra)


def refusal_response(exc: Refusal) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status, headers=exc.headers)
