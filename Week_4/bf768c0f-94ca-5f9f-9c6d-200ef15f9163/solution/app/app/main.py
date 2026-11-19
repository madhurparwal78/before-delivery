"""Gambit Hall: one server for the pages, the API and the media."""
from __future__ import annotations

import json
import sys
import time
import traceback
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import api_core, api_games, pages
from .db import init_schema, wait_for_db
from .errors import NOT_HERE
from .seed import run_seed

BASE = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    wait_for_db()
    init_schema()
    run_seed()
    app.state.ready = True
    yield


app = FastAPI(title="Gambit Hall", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def observe(request: Request, call_next):
    # Minted here for every request, never taken from the caller, so no two requests share one.
    request_id = uuid.uuid4().hex
    request.state.request_id = request_id
    started = time.perf_counter()
    status = 500
    fault = None
    try:
        if "\x00" in unquote(request.url.path) or "\x00" in unquote(request.url.query):
            response = JSONResponse({"error": "An address cannot carry a NUL character.",
                                     "detail": "An address cannot carry a NUL character.",
                                     "request_id": request_id}, status_code=400)
        else:
            try:
                response = await call_next(request)
            except Exception as exc:  # noqa: BLE001 - a fault is still one answered, logged request
                fault = "".join(traceback.format_exception_only(type(exc), exc)).strip()
                response = JSONResponse({"error": "Something went wrong on our side.",
                                         "detail": "Something went wrong on our side.",
                                         "request_id": request_id}, status_code=500)
        status = response.status_code
        response.headers["X-Request-Id"] = request_id
        return response
    finally:
        line = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
            "level": "info",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "query": request.url.query,
            "status": status,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "client": request.client.host if request.client else None,
        }
        if fault:
            line["level"] = "error"
            line["error"] = fault
        sys.stdout.write(json.dumps(line) + "\n")
        sys.stdout.flush()


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", "")
    detail = exc.detail if isinstance(exc.detail, str) else "That request was refused."
    if request.url.path.startswith("/api/"):
        return JSONResponse(
            {"error": detail, "detail": detail, "request_id": request_id},
            status_code=exc.status_code,
            headers={"X-Request-Id": request_id},
        )
    if exc.status_code in (401, 403):
        target = request.url.path
        return RedirectResponse(f"/login?next={target}", status_code=302)
    return pages.not_found_page(request, detail if exc.status_code == 404 else detail)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    request_id = getattr(request.state, "request_id", "")
    return JSONResponse(
        {
            "error": "That request could not be processed.",
            "detail": exc.errors()[0].get("msg", "invalid request") if exc.errors() else "invalid",
            "request_id": request_id,
        },
        status_code=422,
        headers={"X-Request-Id": request_id},
    )


@app.get("/api/health")
def health():
    from .db import conn, q1

    with conn() as c:
        q1(c, "SELECT 1 AS ok")
    return {"status": "ok", "ready": True}


app.include_router(api_core.router, prefix="/api")
app.include_router(api_games.router, prefix="/api")
app.include_router(pages.router)
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


@app.get("/{path:path}", include_in_schema=False)
def catch_all(path: str, request: Request):
    if path.startswith("api/"):
        return JSONResponse({"error": "No such endpoint.", "detail": "No such endpoint."}, status_code=404)
    return pages.not_found_page(request, NOT_HERE)
