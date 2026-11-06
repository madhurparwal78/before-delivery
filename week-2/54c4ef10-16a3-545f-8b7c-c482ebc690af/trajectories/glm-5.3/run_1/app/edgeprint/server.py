"""The HTTP server: same-origin pages, API endpoints and the error shape."""
from __future__ import annotations

import re

import psycopg
from psycopg.rows import dict_row
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .config import Config, JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT
from .exposure import APERTURES
from .imaging import (MSG_DIMENSIONS, MSG_PIXEL_FORMAT, MSG_TIFF_LAYOUT,
                      MSG_UNREADABLE)
from .storage import ObjectStorage


SESSION_COOKIE = "edgeprint_session"

# The one error shape, produced in one place.
FIELD_MESSAGES = {
    "email": "Enter a valid email address.",
    "password": "Use 10 to 128 characters.",
    "name": "Give the roll a name of up to 80 characters.",
    "stock": "Name the stock in up to 60 characters.",
    "format": "Choose 35mm, 120 6×6 or 120 6×7.",
    "kind": "Choose normal roll or test roll.",
    "format_kind": "Format and kind cannot change after the roll is created.",
    "ei": "EI is a whole number from 6 to 12800.",
    "push_pull": "Push or pull is a whole number of stops from −3 to +3.",
    "reciprocity_p": "Reciprocity exponent is a number from 0.50 to 1.00 with up to two decimals.",
    "development_note": "Development notes are limited to 500 characters.",
    "curve_roll_id": "Choose one of your test rolls.",
    "counter": "Counter is a whole number from 0 to 99.",
    "aperture": "Use a marked aperture such as 5.6 or 11.",
    "shutter": "Use a shutter speed such as 1/125, 1/2 or 2\".",
    "metered_ev": "Metered EV is a number from −6 to 21.",
    "note": "Notes are limited to 500 characters.",
    "title": "Titles are limited to 80 characters.",
    "dpi": "DPI is a whole number from 300 to 10000.",
    "first_edge": "Edge number is a whole number from 0 to 99.",
    "size": "Declared size does not match the received file.",
    "sha256": "Checksum does not match the received file.",
    "file_dimensions": MSG_DIMENSIONS,
    "file_pixel_format": MSG_PIXEL_FORMAT,
    "file_tiff_layout": MSG_TIFF_LAYOUT,
    "file_unreadable": MSG_UNREADABLE,
    "area": "Mark an area inside the scan, at least 8 × 8 pixels.",
    "wedge_size": "Mark the whole wedge, at least 42 pixels wide and 8 tall.",
    "wedge_order": "The wedge steps must darken from left to right.",
    "x0": "Frame edges must stay inside the scan, at least 8 pixels apart, without overlapping a neighbour.",
    "x1": "Frame edges must stay inside the scan, at least 8 pixels apart, without overlapping a neighbour.",
    "reading_point": "Point is outside the scan.",
    "pin": "Pin inside a frame.",
    "scan": "No frames found for this format and DPI.",
    "offset": "Offset is a whole number from −2 to +2.",
    "slip_after": "Choose a note on this roll, or no slip.",
    "overrides": "Each note and frame can appear once and must belong to this roll.",
    "version": "Reload the alignment before saving.",
}

ERROR_COPY = {
    "invalid_credentials": "Email or password is wrong.",
    "email_taken": "An account with this email already exists.",
    "counter_taken": "Counter {counter} is already logged on this roll.",
    "too_large": "This scan is larger than 60,000,000 bytes.",
    "unsupported_format": "Only PNG or TIFF scans can be stored.",
    "duplicate_scan": "This strip is already on this roll.",
    "not_calibrated": "Calibrate this scan first.",
    "frames_exist": "Frames are already found; nudge them instead.",
    "no_frames": "Find frames first.",
    "unframed_scans": "Find frames on every strip of this roll first.",
    "flagged_frames": "Accept or nudge every flagged frame first.",
    "not_flagged": "This frame is not flagged.",
    "stale_alignment": "This alignment changed in another tab. Reload it before saving.",
    "storage_unavailable": "Storage is unreachable, so new readings are paused.",
}
UPLOAD_OUTAGE_COPY = "Storage is unreachable. Nothing was stored; try again when it is back."

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def error_body(code: str) -> dict:
    return {"error": code, "message": ERROR_COPY.get(code, code)}


def code_points(text: str) -> int:
    """Lengths count Unicode code points after trimming outer whitespace."""
    return len(text.strip())


class AppState:
    """Shared server state: password hashing and object storage."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.storage = ObjectStorage(
            endpoint=config.s3_endpoint,
            access_key=config.s3_access_key,
            secret_key=config.s3_secret_key,
            bucket=config.s3_bucket,
            secure=config.s3_endpoint.startswith("https://"),
            region=config.s3_region,
        )
        self.db_ready = False

    def db(self) -> psycopg.Connection:
        """A per-request connection; opened lazily and closed by the caller."""
        return psycopg.connect(self.config.database_url, autocommit=False,
                               row_factory=dict_row)

    def storage_ok(self) -> bool:
        return self.storage.available()

    def session_account(self, token: str) -> str | None:
        """The account of a live session, or None for an expired one."""
        try:
            with self.db() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT account_id FROM sessions "
                                "WHERE token=%s AND expires_at > now()", (token,))
                    row = cur.fetchone()
                    return str(row["account_id"]) if row else None
        except psycopg.OperationalError:
            return None


def json_response(payload: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status)


def api_error(status: int, code: str, **extra) -> JSONResponse:
    body = error_body(code)
    body.update(extra)
    return JSONResponse(body, status_code=status)


def validation_error(fields: dict[str, str]) -> JSONResponse:
    return JSONResponse(
        {"error": "validation_failed", "fields": fields,
         "message": next(iter(fields.values()))},
        status_code=422)



# ------------------------------------------------------------ app assembly


async def health(request: Request) -> Response:
    if not request.app.state.db_ready:
        return JSONResponse({"status": "starting"}, status_code=503)
    return JSONResponse({"status": "ok"})


async def storage_status(request: Request) -> Response:
    if request.app.state.storage_ok():
        return JSONResponse({"storage": "ok"})
    return JSONResponse({"storage": "unavailable"})


async def apertures_config(request: Request) -> Response:
    """The same aperture table the server reads, for the browser preview."""
    return JSONResponse({"apertures": list(APERTURES)})


def build_app(config: Config) -> Starlette:
    from . import routes as api
    from .pages import page_routes

    state = AppState(config)
    app = Starlette(routes=_all_routes(api, page_routes()))
    # The request's app.state carries the shared state and the config.
    app.state.config = config
    app.state.db = state.db
    app.state.storage = state.storage
    app.state.storage_ok = state.storage_ok
    app.state.session_account = state.session_account
    app.state.app_state = state
    app.state.db_ready = False
    app.add_middleware(SessionMiddleware)

    async def body_too_large(request: Request, exc: Exception) -> Response:
        return JSONResponse({"error": "too_large",
                             "message": ERROR_COPY["too_large"]}, status_code=413)

    async def unsupported_media(request: Request, exc: Exception) -> Response:
        return JSONResponse({"error": "unsupported_media_type"},
                            status_code=415)

    from .routes import BodyTooLarge, UnsupportedMediaType
    app.add_exception_handler(BodyTooLarge, body_too_large)
    app.add_exception_handler(UnsupportedMediaType, unsupported_media)
    return app


def _all_routes(api, pages: list) -> list:
    return [
        Route("/api/health", health, methods=["GET"]),
        Route("/api/storage", storage_status, methods=["GET"]),
        Route("/api/config/apertures", apertures_config, methods=["GET"]),
        Route("/api/auth/signup", api.signup, methods=["POST"]),
        Route("/api/auth/signin", api.signin, methods=["POST"]),
        Route("/api/auth/signout", api.signout, methods=["POST"]),
        Route("/api/me", api.me, methods=["GET"]),
        Route("/api/rolls", api.list_rolls, methods=["GET"]),
        Route("/api/rolls", api.create_roll, methods=["POST"]),
        Route("/api/rolls/{roll_id}", api.get_roll, methods=["GET"]),
        Route("/api/rolls/{roll_id}", api.patch_roll, methods=["PATCH"]),
        Route("/api/rolls/{roll_id}/entries", api.list_entries, methods=["GET"]),
        Route("/api/rolls/{roll_id}/entries", api.create_entry, methods=["POST"]),
        Route("/api/entries/{entry_id}", api.patch_entry, methods=["PATCH", "DELETE"]),
        Route("/api/rolls/{roll_id}/scans", api.list_scans, methods=["GET"]),
        Route("/api/rolls/{roll_id}/scans", api.upload_scan, methods=["POST"]),
        Route("/api/scans/{scan_id}", api.get_scan, methods=["GET"]),
        Route("/api/scans/{scan_id}/original", api.download_original, methods=["GET"]),
        Route("/api/scans/{scan_id}/preview/{n}", api.download_preview, methods=["GET"]),
        Route("/api/scans/{scan_id}/calibration", api.create_calibration,
              methods=["POST"]),
        Route("/api/scans/{scan_id}/frames/detect", api.detect_frames, methods=["POST"]),
        Route("/api/frames/{frame_id}", api.get_frame, methods=["GET"]),
        Route("/api/frames/{frame_id}", api.patch_frame, methods=["PATCH"]),
        Route("/api/frames/{frame_id}/accept-width", api.accept_width, methods=["POST"]),
        Route("/api/rolls/{roll_id}/contact-sheet", api.contact_sheet, methods=["GET"]),
        Route("/api/rolls/{roll_id}/alignment/proposal", api.propose_alignment,
              methods=["POST"]),
        Route("/api/rolls/{roll_id}/alignment", api.get_alignment, methods=["GET"]),
        Route("/api/rolls/{roll_id}/alignment", api.save_alignment, methods=["PUT"]),
        Route("/api/scans/{scan_id}/reading", api.loupe_reading, methods=["GET"]),
        Route("/api/scans/{scan_id}/readings", api.pin_reading, methods=["POST"]),
        Route("/api/rolls/{roll_id}/curve", api.roll_curve, methods=["GET"]),
    ] + pages


class SessionMiddleware:
    """Session lookup, cross-origin refusal, and the one error shape."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        app_state = scope.get("app")
        path = scope["path"]
        if not path.startswith("/api/") or app_state is None:
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        config = app_state.state.config
        method = scope["method"]
        origin = request.headers.get("origin")
        if origin is not None and method not in ("GET", "HEAD") \
                and origin != _app_origin(request, config):
            await _send_json(scope, receive, send, 403, {"error": "cross_origin"})
            return
        content_type = request.headers.get("content-type", "")
        if method in ("POST", "PUT", "PATCH") and _is_json_type(content_type):
            length = request.headers.get("content-length", "")
            if length.isdigit() and int(length) > JSON_BODY_LIMIT:
                await _send_json(scope, receive, send, 413,
                                 {"error": "too_large",
                                  "message": ERROR_COPY["too_large"]})
                return
        public = path in ("/api/health", "/api/storage", "/api/auth/signup",
                          "/api/auth/signin", "/api/config/apertures")
        account_id = None
        token = request.cookies.get(SESSION_COOKIE)
        if token and not public:
            account_id = _session_account(app_state.state.app_state, token)
            if account_id is _STARTING:
                await _send_json(scope, receive, send, 503, {"status": "starting"})
                return
        elif token and public:
            account_id = _session_account(app_state.state.app_state, token)
            if account_id is _STARTING:
                account_id = None
        if public or account_id:
            scope["state"] = {"account_id": account_id}
            await self.app(scope, receive, send)
            return
        await _send_json(scope, receive, send, 401, {"error": "unauthenticated"})


_STARTING = object()


def _session_account(state: "AppState", token: str):
    try:
        with state.db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT account_id FROM sessions "
                            "WHERE token=%s AND expires_at > now()", (token,))
                row = cur.fetchone()
                return str(row["account_id"]) if row else None
    except psycopg.OperationalError:
        return _STARTING


async def _send_json(scope, receive, send, status: int, body: dict) -> None:
    response = JSONResponse(body, status_code=status)
    await response(scope, receive, send)


def _app_origin(request: Request, config) -> str:
    if config.public_url:
        return config.public_url.rstrip("/")
    host = request.headers.get("host", "")
    return f"{request.url.scheme}://{host}"


def _is_json_type(content_type: str) -> bool:
    """The body limit rule applies to JSON bodies of any JSON content type."""
    media_type = content_type.split(";")[0].strip().lower()
    return media_type == "application/json" or media_type.endswith("+json")
