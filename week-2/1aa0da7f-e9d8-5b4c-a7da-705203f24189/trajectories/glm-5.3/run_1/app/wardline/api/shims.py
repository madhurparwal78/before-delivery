"""Response helpers for the API layer."""
from __future__ import annotations

import time
from typing import Any

from starlette.responses import JSONResponse, Response


class APIResponse:
    def __init__(self, status: int, body: Any, headers: dict[str, str] | None = None):
        self.status = status
        self.body = body
        self.headers = dict(headers or {})

    def to_response(self) -> Response:
        headers = dict(self.headers)
        headers.setdefault("X-Content-Type-Options", "nosniff")
        if self.status == 204:
            return Response(status_code=204, headers=headers)
        if "set_cookie" in headers:
            cookie = headers.pop("set_cookie")
            resp = JSONResponse(self.body, status_code=self.status, headers=headers)
            resp.set_cookie("wardline_session", cookie.split("=", 1)[1].split(";", 1)[0],
                            path="/", httponly=True, samesite="strict")
            return resp
        return JSONResponse(self.body, status_code=self.status, headers=headers)


class FileBytesResponse(Response):
    def __init__(self, data: bytes, content_type: str, filename: str):
        super().__init__(
            content=data,
            media_type=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Cache-Control": "no-store",
            },
        )


class StorageStreamResponse:
    """Streams object bytes outside any transaction (DP-64)."""

    CHUNK = 256 * 1024

    def __init__(self, app, key: str, size: int, content_type: str, filename: str):
        self.app = app
        self.key = key
        self.size = size
        self.content_type = content_type
        self.filename = filename

    async def __call__(self, scope, receive, send):
        headers = [
            (b"content-type", self.content_type.encode()),
            (b"content-length", str(self.size).encode()),
            (b"content-disposition", f'attachment; filename="{self.filename}"'.encode()),
            (b"x-content-type-options", b"nosniff"),
            (b"referrer-policy", b"no-referrer"),
            (b"cache-control", b"no-store"),
        ]
        await send({"type": "http.response.start", "status": 200, "headers": headers})
        obj = None
        try:
            obj = self.app.storage.open_stream(self.key)
            while True:
                chunk = obj.read(self.CHUNK)
                if not chunk:
                    break
                await send({"type": "http.response.body", "body": chunk, "more_body": True})
            await send({"type": "http.response.body", "body": b"", "more_body": False})
        except Exception:
            try:
                await send({"type": "http.response.body", "body": b"", "more_body": False})
            except Exception:
                pass
        finally:
            if obj is not None:
                try:
                    obj.close()
                    obj.release_conn()
                except Exception:
                    pass
