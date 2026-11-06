"""API routes: every endpoint in the published table, in one file."""
from __future__ import annotations

import hashlib
import json
import math
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import alignment as al
from . import darkroom
from . import service as svc
from .exposure import (parse_aperture, parse_shutter, relative_stops,
                        round_half_away)
from .imaging import ScanRefused, decode_scan, sniff_format
from .config import JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT
from .passwords import hash_password, verify_password
from .server import (ERROR_COPY, FIELD_MESSAGES, SESSION_COOKIE, UPLOAD_OUTAGE_COPY,
                     AppState, api_error, code_points, validation_error)


class BodyTooLarge(Exception):
    """A JSON body past the published limit."""


class UnsupportedMediaType(Exception):
    """A JSON request sent with another content type."""


async def json_body(request: Request) -> dict:
    """Read a JSON body, refusing wrong content types and oversize bodies."""
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type and content_type != "application/json" \
            and not content_type.endswith("+json"):
        raise UnsupportedMediaType
    body = await request.body()
    if len(body) > JSON_BODY_LIMIT:
        raise BodyTooLarge
    return json.loads(body) if body else {}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}"
                     r"-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def is_uuid(value) -> bool:
    return isinstance(value, str) and UUID_RE.match(value) is not None


# ------------------------------------------------------------ auth


async def signup(request: Request) -> Response:
    state = request.app.state
    data = await json_body(request)
    fields: dict[str, str] = {}
    email = data.get("email")
    password = data.get("password")
    email_text = email.strip().lower() if isinstance(email, str) else ""
    if not isinstance(email, str) or not EMAIL_RE.match(email_text) or len(email_text) > 254:
        fields["email"] = FIELD_MESSAGES["email"]
    if not isinstance(password, str) or not 10 <= len(password) <= 128:
        fields["password"] = FIELD_MESSAGES["password"]
    if fields:
        return validation_error(fields)
    with state.db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM accounts WHERE email=%s", (email_text,))
            if cur.fetchone():
                conn.rollback()
                return api_error(409, "email_taken")
            cur.execute("INSERT INTO accounts (email, password_hash) VALUES (%s,%s) RETURNING id",
                        (email_text, hash_password(password)))
            account = cur.fetchone()
            response = await _start_session(request, conn, str(account["id"]), email_text)
            conn.commit()
            return response


async def signin(request: Request) -> Response:
    state = request.app.state
    data = await json_body(request)
    email = data.get("email")
    password = data.get("password")
    email_text = email.strip().lower() if isinstance(email, str) else ""
    with state.db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, password_hash FROM accounts WHERE email=%s",
                        (email_text,))
            account = cur.fetchone()
            if account is None:
                conn.rollback()
                return api_error(401, "invalid_credentials")
            if not verify_password(account["password_hash"], password or ""):
                conn.rollback()
                return api_error(401, "invalid_credentials")
            response = await _start_session(request, conn, str(account["id"]), email_text)
            conn.commit()
            return response


async def _start_session(request: Request, conn, account_id: str,
                         email: str | None = None) -> JSONResponse:
    token = secrets.token_urlsafe(32)
    ttl = request.app.state.config.session_ttl
    expires = datetime.now(timezone.utc) + timedelta(seconds=ttl)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO sessions (token, account_id, expires_at) VALUES (%s,%s,%s)",
                    (token, account_id, expires))
    response = JSONResponse({"id": account_id, "email": email}, status_code=200)
    response.set_cookie(SESSION_COOKIE, token, max_age=ttl, httponly=True,
                        samesite="lax", path="/")
    return response


async def signout(request: Request) -> Response:
    state = request.app.state
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with state.db() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM sessions WHERE token=%s", (token,))
            conn.commit()
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


async def me(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    with state.db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email FROM accounts WHERE id=%s", (account_id,))
            account = cur.fetchone()
            latest = _latest_aligned_frame(cur, account_id)
            return JSONResponse({
                "id": str(account["id"]),
                "email": account["email"],
                "latest_aligned_frame": latest,
            })


def _latest_aligned_frame(cur, account_id: str) -> dict | None:
    """The lowest-numbered matched frame in the account's most recently saved alignment."""
    cur.execute("""
        SELECT id FROM rolls
        WHERE account_id=%s AND align_offset IS NOT NULL
        ORDER BY align_version DESC, created_at DESC LIMIT 1""", (account_id,))
    roll = cur.fetchone()
    if roll is None:
        return None
    roll_row = svc.fetch_roll(cur, str(roll["id"]), account_id)
    entries = svc.roll_entries(cur, str(roll["id"]))
    frames = svc.roll_frames(cur, str(roll["id"]))
    matches = svc.roll_matches(cur, roll_row, entries, frames)
    frames_by_id = {str(f["id"]): f for f in frames}
    best = None
    for match in matches.values():
        if not match.frame_id:
            continue
        frame = frames_by_id[match.frame_id]
        if best is None or frame["number"] < best["number"]:
            best = frame
    if best is None:
        return None
    return {"frame_id": str(best["id"]), "scan_id": str(best["scan_id"]),
            "x0": best["x0"], "x1": best["x1"]}


# ------------------------------------------------------------ rolls


async def list_rolls(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    with state.db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM rolls WHERE account_id=%s ORDER BY created_at DESC",
                        (account_id,))
            rolls = list(cur.fetchall())
            payload = {"rolls": [svc.serialise_roll(cur, roll) for roll in rolls]}
            return JSONResponse(payload)


def validate_roll_fields(cur, data: dict, existing: dict | None,
                         account_id: str) -> tuple[dict, dict]:
    """Every roll field rule; a PATCH validates only the fields it names."""
    fields: dict[str, str] = {}
    values: dict = {}
    creating = existing is None
    for name in ("name", "stock"):
        if name not in data and not creating:
            continue
        value = data.get(name)
        limit = 80 if name == "name" else 60
        if not isinstance(value, str) or not 1 <= code_points(value) <= limit:
            fields[name] = FIELD_MESSAGES[name]
        else:
            values[name] = value.strip()
    if "format" in data or existing is None:
        value = data.get("format")
        if value not in ("35mm", "120-6x6", "120-6x7"):
            fields["format"] = FIELD_MESSAGES["format"]
        elif existing is not None and value != existing["format"]:
            fields["format"] = FIELD_MESSAGES["format_kind"]
        else:
            values["format"] = value
    if "kind" in data or existing is None:
        value = data.get("kind", "normal")
        if value not in ("normal", "test"):
            fields["kind"] = FIELD_MESSAGES["kind"]
        elif existing is not None and value != existing["kind"]:
            fields["kind"] = FIELD_MESSAGES["format_kind"]
        else:
            values["kind"] = value
    if "ei" in data or existing is None:
        ei = _whole(data.get("ei"), 6, 12800)
        if ei is None:
            fields["ei"] = FIELD_MESSAGES["ei"]
        else:
            values["ei"] = ei
    if "push_pull" in data or existing is None:
        push_pull = _whole(data.get("push_pull", 0), -3, 3)
        if push_pull is None:
            fields["push_pull"] = FIELD_MESSAGES["push_pull"]
        else:
            values["push_pull"] = push_pull
    if "reciprocity_p" in data or existing is None:
        reciprocity = _two_decimals(data.get("reciprocity_p", 1.0), 0.5, 1.0)
        if reciprocity is None:
            fields["reciprocity_p"] = FIELD_MESSAGES["reciprocity_p"]
        else:
            values["reciprocity_p"] = reciprocity
    if "development_note" in data or existing is None:
        note = data.get("development_note", "")
        if not isinstance(note, str) or code_points(note) > 500:
            fields["development_note"] = FIELD_MESSAGES["development_note"]
        else:
            values["development_note"] = note
    if "curve_roll_id" in data and data["curve_roll_id"] is not None:
        value = data["curve_roll_id"]
        if not is_uuid(value):
            fields["curve_roll_id"] = FIELD_MESSAGES["curve_roll_id"]
        else:
            cur.execute("SELECT id, kind FROM rolls WHERE id=%s AND account_id=%s",
                        (value, account_id))
            linked = cur.fetchone()
            if linked is None or linked["kind"] != "test" or (
                    "kind" in values and values.get("kind") == "test"):
                fields["curve_roll_id"] = FIELD_MESSAGES["curve_roll_id"]
            else:
                values["curve_roll_id"] = value
    elif existing is None:
        values["curve_roll_id"] = None
    return values, fields


def _whole(value, low: int, high: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float):
        if not math.isfinite(value) or value != int(value):
            return None
        value = int(value)
    if not low <= value <= high:
        return None
    return value


def _two_decimals(value, low: float, high: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or not low <= number <= high:
        return None
    if round(number, 2) != round(number, 10):
        return None
    if abs(round(number, 2) - number) > 1e-9:
        return None
    return number


async def create_roll(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    data = await json_body(request)
    with state.db() as conn:
        with conn.cursor() as cur:
            values, fields = validate_roll_fields(cur, data, None, account_id)
            if fields:
                conn.rollback()
                return validation_error(fields)
            if values.get("kind") == "test":
                values["curve_roll_id"] = None
            columns = ["account_id"] + list(values.keys())
            placeholders = ["%s"] * len(columns)
            cur.execute(
                f"INSERT INTO rolls ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING *",
                [account_id] + list(values.values()))
            roll = cur.fetchone()
            conn.commit()
            return JSONResponse(svc.serialise_roll(cur, roll), status_code=201)


async def get_roll(request: Request) -> Response:
    state = request.app.state
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, request.path_params["roll_id"],
                                  request.state.account_id)
            if roll is None:
                return api_error(404, "not_found")
            return JSONResponse(svc.serialise_roll(cur, roll))


async def patch_roll(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    roll_id = request.path_params["roll_id"]
    data = await json_body(request)
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, roll_id, account_id)
            if roll is None:
                conn.rollback()
                return api_error(404, "not_found")
            values, fields = validate_roll_fields(cur, data, roll, account_id)
            if "kind" in values and values["kind"] == "test":
                values["curve_roll_id"] = None
            if fields:
                conn.rollback()
                return validation_error(fields)
            if "curve_roll_id" in data and data["curve_roll_id"] is None:
                values["curve_roll_id"] = None
            sets = ", ".join(f"{key}=%s" for key in values)
            cur.execute(f"UPDATE rolls SET {sets} WHERE id=%s RETURNING *",
                        list(values.values()) + [roll_id])
            roll = cur.fetchone()
            conn.commit()
            return JSONResponse(svc.serialise_roll(cur, roll))


# ------------------------------------------------------------ entries


def validate_entry_fields(data: dict, existing: dict | None) -> tuple[dict, dict]:
    """Entry fields; a PATCH validates only the fields it names."""
    fields: dict[str, str] = {}
    values: dict = {}
    creating = existing is None
    if "counter" in data or creating:
        counter = _whole(data.get("counter"), 0, 99)
        if counter is None:
            fields["counter"] = FIELD_MESSAGES["counter"]
        else:
            values["counter"] = counter
    if "aperture" in data or creating:
        aperture = parse_aperture(data.get("aperture", ""))
        if aperture is None:
            fields["aperture"] = FIELD_MESSAGES["aperture"]
        else:
            values["aperture"] = aperture
    if "shutter" in data or creating:
        if parse_shutter(data.get("shutter", "")) is None:
            fields["shutter"] = FIELD_MESSAGES["shutter"]
        else:
            values["shutter"] = str(data.get("shutter")).strip()
    if "metered_ev" in data or creating:
        metered_ev = _two_decimals(data.get("metered_ev"), -6.0, 21.0)
        if metered_ev is None:
            fields["metered_ev"] = FIELD_MESSAGES["metered_ev"]
        else:
            values["metered_ev"] = metered_ev
    if "note" in data or creating:
        note = data.get("note", "")
        if not isinstance(note, str) or code_points(note) > 500:
            fields["note"] = FIELD_MESSAGES["note"]
        else:
            values["note"] = note
    if "misfire" in data or creating:
        values["misfire"] = bool(data.get("misfire", False))
    return values, fields


async def list_entries(request: Request) -> Response:
    state = request.app.state
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, request.path_params["roll_id"],
                                  request.state.account_id)
            if roll is None:
                return api_error(404, "not_found")
            entries = svc.roll_entries(cur, str(roll["id"]))
            frames = svc.roll_frames(cur, str(roll["id"]))
            matches = svc.roll_matches(cur, roll, entries, frames)
            return JSONResponse({"entries": [
                svc.serialise_entry(entry, roll, matches.get(str(entry["id"])))
                for entry in entries]})


async def create_entry(request: Request) -> Response:
    state = request.app.state
    data = await json_body(request)
    roll_id = request.path_params["roll_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, roll_id, request.state.account_id)
            if roll is None:
                conn.rollback()
                return api_error(404, "not_found")
            values, fields = validate_entry_fields(data, None)
            if "counter" in values:
                cur.execute("SELECT id FROM entries WHERE roll_id=%s AND counter=%s",
                            (roll_id, values["counter"]))
                if cur.fetchone():
                    conn.rollback()
                    return api_error(409, "counter_taken",
                                      message=ERROR_COPY["counter_taken"].format(
                                          counter=values["counter"]))
            if fields:
                conn.rollback()
                return validation_error(fields)
            columns = ["roll_id"] + list(values.keys())
            placeholders = ["%s"] * len(columns)
            cur.execute(
                f"INSERT INTO entries ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING *",
                [roll_id] + list(values.values()))
            entry = cur.fetchone()
            conn.commit()
            return JSONResponse(svc.serialise_entry(entry, roll, None), status_code=201)


async def patch_entry(request: Request) -> Response:
    state = request.app.state
    data = await json_body(request)
    entry_id = request.path_params["entry_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            entry = svc.fetch_entry(cur, entry_id, request.state.account_id)
            if entry is None:
                conn.rollback()
                return api_error(404, "not_found")
            roll = svc.fetch_roll(cur, str(entry["roll_id"]), request.state.account_id)
            values, fields = validate_entry_fields(data, entry)
            if "counter" in values and values["counter"] != entry["counter"]:
                cur.execute("SELECT id FROM entries WHERE roll_id=%s AND counter=%s AND id<>%s",
                            (str(entry["roll_id"]), values["counter"], entry_id))
                if cur.fetchone():
                    conn.rollback()
                    return api_error(409, "counter_taken",
                                      message=ERROR_COPY["counter_taken"].format(
                                          counter=values["counter"]))
            if fields:
                conn.rollback()
                return validation_error(fields)
            sets = ", ".join(f"{key}=%s" for key in values)
            cur.execute(f"UPDATE entries SET {sets} WHERE id=%s RETURNING *",
                        list(values.values()) + [entry_id])
            entry = cur.fetchone()
            frames = svc.roll_frames(cur, str(entry["roll_id"]))
            entries = svc.roll_entries(cur, str(entry["roll_id"]))
            matches = svc.roll_matches(cur, roll, entries, frames)
            conn.commit()
            return JSONResponse(
                svc.serialise_entry(entry, roll, matches.get(str(entry["id"]))))


async def delete_entry(request: Request) -> Response:
    state = request.app.state
    entry_id = request.path_params["entry_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            entry = svc.fetch_entry(cur, entry_id, request.state.account_id)
            if entry is None:
                conn.rollback()
                return api_error(404, "not_found")
            cur.execute("DELETE FROM alignment_overrides WHERE entry_id=%s", (entry_id,))
            cur.execute("UPDATE readings SET entry_id=NULL WHERE entry_id=%s", (entry_id,))
            cur.execute("UPDATE rolls SET align_slip_after=NULL "
                        "WHERE id=%s AND align_slip_after=%s",
                        (str(entry["roll_id"]), entry["counter"]))
            cur.execute("DELETE FROM entries WHERE id=%s", (entry_id,))
            conn.commit()
            return Response(status_code=204)


# ------------------------------------------------------------ scans


async def list_scans(request: Request) -> Response:
    state = request.app.state
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, request.path_params["roll_id"],
                                  request.state.account_id)
            if roll is None:
                return api_error(404, "not_found")
            scans = svc.roll_scans(cur, str(roll["id"]))
            payload = []
            for scan in scans:
                calibration = svc.fetch_calibration(cur, str(scan["id"]))
                payload.append(svc.serialise_scan(scan, calibration))
            return JSONResponse({"scans": payload})


async def get_scan(request: Request) -> Response:
    state = request.app.state
    with state.db() as conn:
        with conn.cursor() as cur:
            scan = svc.fetch_scan(cur, request.path_params["scan_id"],
                                  request.state.account_id)
            if scan is None:
                return api_error(404, "not_found")
            calibration = svc.fetch_calibration(cur, str(scan["id"]))
            frames = svc.scan_frames(cur, str(scan["id"]))
            body = svc.serialise_scan(scan, calibration)
            entries_by_frame = _matched_entries_by_frame(cur, scan, frames)
            body["frames"] = [svc.serialise_frame(frame, entries_by_frame.get(str(frame["id"])))
                              for frame in frames]
            return JSONResponse(body)


def _matched_entries_by_frame(cur, scan: dict, frames: list[dict]) -> dict[str, dict]:
    """The entry each frame on this scan is matched to, from the roll's alignment."""
    roll = svc.fetch_roll(cur, str(scan["roll_id"]), _scan_account(cur, scan))
    if roll is None:
        return {}
    entries = svc.roll_entries(cur, str(scan["roll_id"]))
    matches = svc.roll_matches(cur, roll, entries, svc.roll_frames(cur, str(scan["roll_id"])))
    by_frame: dict[str, dict] = {}
    entry_by_id = {str(e["id"]): e for e in entries}
    for entry_id, match in matches.items():
        if match.frame_id:
            by_frame[match.frame_id] = entry_by_id[entry_id]
    return by_frame


def _scan_account(cur, scan: dict) -> str:
    cur.execute("SELECT account_id FROM rolls WHERE id=%s", (str(scan["roll_id"]),))
    row = cur.fetchone()
    return str(row["account_id"]) if row else ""


def _decode_original(state: AppState, account_id: str, scan: dict):
    """The stored original, decoded; None when storage is unreachable."""
    try:
        data = state.storage.read_original(account_id, str(scan["id"]))
    except OSError:
        return None
    try:
        return decode_scan(data)
    except ScanRefused:
        return None


# ------------------------------------------------------------ upload


UPLOAD_LOCKS: dict[str, "UploadLock"] = {}


class UploadLock:
    """One in-flight upload per (roll, sha256), released within 2 seconds of a cut-off."""

    def __init__(self) -> None:
        import threading
        self.lock = threading.Lock()
        self.owner: str | None = None


def clean_filename(name: str) -> str:
    """Path components and control characters removed, cut to 120 characters."""
    parts = [part for part in name.replace("\\", "/").split("/") if part not in ("", ".", "..")]
    text = " ".join(parts)
    text = "".join(ch for ch in text if ord(ch) >= 32 and ord(ch) != 127)
    return text[:120] or "strip"


async def upload_scan(request: Request) -> Response:
    """The upload rule, in order: size, format, duplicate, validation, storage."""
    state = request.app.state
    account_id = request.state.account_id
    roll_id = request.path_params["roll_id"]
    dpi_text = request.query_params.get("dpi", "")
    first_edge_text = request.query_params.get("first_edge", "")
    filename = clean_filename(request.query_params.get("filename", "") or "strip")

    declared_size = request.headers.get("x-scan-size", "")
    declared_sha = request.headers.get("x-scan-sha256", "")
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > UPLOAD_BODY_LIMIT:
        return api_error(413, "too_large")
    body = await request.body()
    if len(body) > UPLOAD_BODY_LIMIT:
        return api_error(413, "too_large")

    fmt = sniff_format(body)
    if fmt is None:
        return api_error(415, "unsupported_format")
    sha256 = hashlib.sha256(body).hexdigest()

    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, roll_id, account_id)
            if roll is None:
                conn.rollback()
                return api_error(404, "not_found")

    fields: dict[str, str] = {}
    dpi = _whole(int(dpi_text) if dpi_text.lstrip("+").isdigit() else None, 300, 10000)
    first_edge = _whole(int(first_edge_text) if first_edge_text.lstrip("+").isdigit()
                        else None, 0, 99)
    if dpi is None:
        fields["dpi"] = FIELD_MESSAGES["dpi"]
    if first_edge is None:
        fields["first_edge"] = FIELD_MESSAGES["first_edge"]
    if declared_size.isdigit() and int(declared_size) == len(body):
        pass
    else:
        fields["size"] = FIELD_MESSAGES["size"]
    if re.fullmatch(r"[0-9a-f]{64}", declared_sha) and declared_sha == sha256:
        pass
    else:
        fields["sha256"] = FIELD_MESSAGES["sha256"]

    file_message: str | None = None
    decoded = None
    try:
        decoded = decode_scan(body)
    except ScanRefused as refusal:
        file_message = refusal.message
    if decoded is None and file_message is None:
        file_message = MSG_UNREADABLE

    if file_message:
        fields["file"] = file_message
    if fields:
        return validation_error(fields)

    lock_key = f"{roll_id}:{sha256}"
    lock = UPLOAD_LOCKS.setdefault(lock_key, UploadLock())
    if not lock.lock.acquire(timeout=0.05):
        with state.db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM scans WHERE roll_id=%s AND sha256=%s",
                            (roll_id, sha256))
                existing = cur.fetchone()
                if existing:
                    return api_error(409, "duplicate_scan", scan_id=str(existing["id"]))
                return api_error(409, "duplicate_scan", scan_id=None)
    try:
        with state.db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM scans WHERE roll_id=%s AND sha256=%s",
                            (roll_id, sha256))
                existing = cur.fetchone()
                if existing:
                    conn.rollback()
                    return api_error(409, "duplicate_scan", scan_id=str(existing["id"]))
                if not state.storage_ok():
                    conn.rollback()
                    return api_error(503, "storage_unavailable",
                                     message=UPLOAD_OUTAGE_COPY)
                scan_id = str(uuid.uuid4())
                content_type = "image/png" if fmt == "png" else "image/tiff"
                slices = decoded.preview_slices()
                written: list[str] = []
                stored = b""
                try:
                    state.storage.store_original(account_id, scan_id, body, content_type)
                    written.append(state.storage.original_key(account_id, scan_id))
                    state.storage.store_previews(account_id, scan_id, slices)
                    written += state.storage.preview_keys(account_id, scan_id, len(slices))
                    stored = state.storage.read_original(account_id, scan_id)
                except OSError:
                    state.storage.remove_many(written)
                    conn.rollback()
                    return api_error(503, "storage_unavailable",
                                     message=UPLOAD_OUTAGE_COPY)
                if len(stored) != len(body) or hashlib.sha256(stored).hexdigest() != sha256:
                    state.storage.remove_many(written)
                    conn.rollback()
                    return api_error(503, "storage_unavailable",
                                     message=UPLOAD_OUTAGE_COPY)
                cur.execute("SELECT COALESCE(MAX(position),0)+1 AS next_position "
                            "FROM scans WHERE roll_id=%s", (roll_id,))
                position = cur.fetchone()["next_position"]
                cur.execute("""
                    INSERT INTO scans (id, roll_id, position, filename, format, size, sha256,
                        width, height, dpi, first_edge, transfer, gamma, state,
                        preview_slices)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (scan_id, roll_id, position, filename, fmt, len(body), sha256,
                     decoded.width, decoded.height, dpi, first_edge, decoded.transfer,
                     (round(decoded.gamma, 5) if decoded.gamma is not None else None),
                     "stored", len(slices)))
                scan = cur.fetchone()
                conn.commit()
                calibration = svc.fetch_calibration(cur, str(scan["id"]))
                return JSONResponse(svc.serialise_scan(scan, calibration), status_code=201)
    finally:
        lock.lock.release()
        UPLOAD_LOCKS.pop(lock_key, None)


async def download_original(request: Request) -> Response:
    state = request.app.state
    with state.db() as conn:
        with conn.cursor() as cur:
            scan = svc.fetch_scan(cur, request.path_params["scan_id"],
                                  request.state.account_id)
            if scan is None:
                return api_error(404, "not_found")
    try:
        data = state.storage.read_original(request.state.account_id, str(scan["id"]))
    except OSError:
        return api_error(503, "storage_unavailable")
    content_type = "image/png" if scan["format"] == "png" else "image/tiff"
    return Response(data, media_type=content_type, headers={
        "Content-Disposition": f'attachment; filename="{scan["filename"]}"',
        "X-Content-Type-Options": "nosniff",
        "X-Scan-SHA256": scan["sha256"],
    })


async def download_preview(request: Request) -> Response:
    state = request.app.state
    with state.db() as conn:
        with conn.cursor() as cur:
            scan = svc.fetch_scan(cur, request.path_params["scan_id"],
                                  request.state.account_id)
            if scan is None:
                return api_error(404, "not_found")
    try:
        n = int(request.path_params["n"])
    except ValueError:
        return api_error(404, "not_found")
    if not 0 <= n < scan["preview_slices"]:
        return api_error(404, "not_found")
    try:
        data = state.storage.read_preview(request.state.account_id, str(scan["id"]), n)
    except OSError:
        return api_error(503, "storage_unavailable")
    return Response(data, media_type="image/png",
                    headers={"X-Content-Type-Options": "nosniff"})


# ------------------------------------------------------------ calibration


def calibration_of(row: dict) -> darkroom.Calibration:
    if row["method"] == "clear_light":
        return darkroom.Calibration.clear_light(float(row["reference"]))
    steps = row["steps"] or []
    return darkroom.Calibration.step_wedge([step["value"] for step in steps])


async def create_calibration(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    data = await json_body(request)
    scan_id = request.path_params["scan_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            scan = svc.fetch_scan(cur, scan_id, account_id)
            if scan is None:
                conn.rollback()
                return api_error(404, "not_found")
            method = data.get("method")
            area = data.get("area") or {}
            x = _whole(area.get("x"), 0, 10_000_000)
            y = _whole(area.get("y"), 0, 10_000_000)
            w = _whole(area.get("w"), 0, 10_000_000)
            h = _whole(area.get("h"), 0, 10_000_000)
            fields: dict[str, str] = {}
            if method not in ("clear_light", "step_wedge") or None in (x, y, w, h):
                fields["area"] = FIELD_MESSAGES["area"]
            elif x + w > scan["width"] or y + h > scan["height"]:
                fields["area"] = FIELD_MESSAGES["area"]
            elif method == "clear_light" and (w < 8 or h < 8):
                fields["area"] = FIELD_MESSAGES["area"]
            elif method == "step_wedge" and (w < darkroom.WEDGE_MIN_WIDTH or h < 8):
                fields["wedge"] = FIELD_MESSAGES["wedge_size"]
            if fields:
                conn.rollback()
                return validation_error(fields)
            if not state.storage_ok():
                conn.rollback()
                return api_error(503, "storage_unavailable")
            decoded = _decode_original(state, account_id, scan)
            if decoded is None:
                conn.rollback()
                return api_error(503, "storage_unavailable")
            linear = _mean_linear(decoded)
            if method == "clear_light":
                reference = darkroom.mean_linear(linear[y:y + h, x:x + w])
                cur.execute("""
                    INSERT INTO calibrations (scan_id, method, area_x, area_y, area_w,
                        area_h, reference, steps)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,NULL) RETURNING *""",
                    (scan_id, method, x, y, w, h, reference))
            else:
                means = darkroom.wedge_means(linear, x, y, w, h)
                if not darkroom.wedge_in_order(means):
                    conn.rollback()
                    return validation_error({"wedge": FIELD_MESSAGES["wedge_order"]})
                steps_json = [
                    {"k": k, "nominal": darkroom.WEDGE_NOMINAL_FIRST
                     + darkroom.WEDGE_NOMINAL_STEP * k, "value": means[k]}
                    for k in range(len(means))]
                cur.execute("""
                    INSERT INTO calibrations (scan_id, method, area_x, area_y, area_w,
                        area_h, reference, steps)
                    VALUES (%s,%s,%s,%s,%s,%s,NULL,%s) RETURNING *""",
                    (scan_id, method, x, y, w, h, json.dumps(steps_json)))
            calibration_row = cur.fetchone()
            calibration = calibration_of(calibration_row)
            _recompute_scan_density(cur, state, account_id, scan, calibration)
            cur.execute("""
                UPDATE scans SET state = CASE
                    WHEN state = 'stored' THEN 'calibrated' ELSE state END
                WHERE id=%s""", (scan_id,))
            scan = svc.fetch_scan(cur, scan_id, account_id)
            conn.commit()
            return JSONResponse(svc.serialise_calibration(calibration_row),
                                status_code=201)


def _mean_linear(decoded) -> np.ndarray:
    linear = decoded.linear()
    return np.mean(linear, axis=2)


def _recompute_scan_density(cur, state: AppState, account_id: str, scan: dict,
                            calibration: darkroom.Calibration) -> None:
    """Base plus fog and every frame's density, from the stored original."""
    decoded = _decode_original(state, account_id, scan)
    if decoded is None:
        return
    linear = _mean_linear(decoded)
    frames = svc.scan_frames(cur, str(scan["id"]))
    if not frames:
        return
    views = [darkroom.DetectedFrame(number=f["number"], edge_number=f["edge_number"],
                                    x0=f["x0"], x1=f["x1"], flag=f["flag"],
                                    blank_slot=f["blank_slot"])
             for f in frames]
    base_fog, densities = darkroom.recompute_frames(linear, calibration, views)
    for frame, (mean_density, net, unexposed) in zip(frames, densities):
        cur.execute("""
            UPDATE frames SET mean_density=%s, net_density=%s, unexposed=%s
            WHERE id=%s""",
            (round_half_away(mean_density, 3), round_half_away(net, 3), unexposed,
             str(frame["id"])))
    cur.execute("UPDATE scans SET base_fog=%s WHERE id=%s",
                (round_half_away(base_fog, 3), str(scan["id"])))


# ------------------------------------------------------------ frames


async def detect_frames(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    scan_id = request.path_params["scan_id"]
    data = await json_body(request)
    with state.db() as conn:
        with conn.cursor() as cur:
            scan = svc.fetch_scan(cur, scan_id, account_id)
            if scan is None:
                conn.rollback()
                return api_error(404, "not_found")
            if scan["state"] == "stored":
                conn.rollback()
                return api_error(409, "not_calibrated")
            if scan["state"] in ("framed", "aligned"):
                conn.rollback()
                return api_error(409, "frames_exist")
            if not state.storage_ok():
                conn.rollback()
                return api_error(503, "storage_unavailable")
            roll = svc.fetch_roll(cur, str(scan["roll_id"]), account_id)
            calibration_row = svc.fetch_calibration(cur, scan_id)
            decoded = _decode_original(state, account_id, scan)
            if decoded is None or calibration_row is None:
                conn.rollback()
                return api_error(503, "storage_unavailable")
            calibration = calibration_of(calibration_row)
            linear = _mean_linear(decoded)
            detected, base_fog = darkroom.detect_frames(
                linear, roll["format"], scan["dpi"], scan["first_edge"])
            if not detected:
                conn.rollback()
                return validation_error({"scan": FIELD_MESSAGES["scan"]})
            # Frames are numbered across the roll by scan position, then x0.
            cur.execute("""
                SELECT COALESCE(MAX(f.number),0) AS top FROM frames f
                JOIN scans s ON s.id=f.scan_id WHERE s.roll_id=%s
                  AND s.position < %s""", (str(scan["roll_id"]), scan["position"]))
            base_number = cur.fetchone()["top"]
            for frame in detected:
                frame.number += base_number
                cur.execute("""
                    INSERT INTO frames (scan_id, number, edge_number, x0, x1, width_mm,
                        flag, blank_slot)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (scan_id, frame.number, frame.edge_number, frame.x0, frame.x1,
                     darkroom.width_mm(frame.x0, frame.x1, scan["dpi"]),
                     frame.flag, frame.blank_slot))
            _recompute_scan_density(cur, state, account_id, scan, calibration)
            cur.execute("UPDATE scans SET state='framed' WHERE id=%s", (scan_id,))
            conn.commit()
            frames = svc.scan_frames(cur, scan_id)
            cur.execute("SELECT base_fog FROM scans WHERE id=%s", (scan_id,))
            return JSONResponse({"frames": [svc.serialise_frame(f, None)
                                            for f in frames]}, status_code=201)


async def get_frame(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    frame_id = request.path_params["frame_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            frame = svc.fetch_frame(cur, frame_id, account_id)
            if frame is None:
                return api_error(404, "not_found")
            roll = _frame_roll(cur, frame)
            entry, readings = _frame_details(cur, frame, roll)
            return JSONResponse({
                "frame": svc.serialise_frame(frame, entry),
                "entry": svc.serialise_entry(entry, roll, None) if entry else None,
                "readings": [_serialise_reading_with_curve(cur, state, row)
                             for row in readings],
            })


def _frame_roll(cur, frame: dict) -> dict:
    cur.execute("""
        SELECT r.* FROM rolls r JOIN scans s ON s.roll_id=r.id
        WHERE s.id=%s""", (str(frame["scan_id"]),))
    return cur.fetchone()


def _frame_details(cur, frame: dict, roll: dict | None = None) -> tuple[dict | None, list[dict]]:
    """The entry the frame is matched to, and its readings in creation order."""
    roll = roll or _frame_roll(cur, frame)
    if roll is None or roll["align_offset"] is None:
        entry = None
    else:
        entries = svc.roll_entries(cur, str(roll["id"]))
        frames = svc.roll_frames(cur, str(roll["id"]))
        matches = svc.roll_matches(cur, roll, entries, frames)
        entry = next((e for e in entries
                      if matches.get(str(e["id"]))
                      and matches[str(e["id"])].frame_id == str(frame["id"])), None)
    cur.execute("""
        SELECT * FROM readings WHERE frame_id=%s ORDER BY created_at, id""",
        (str(frame["id"]),))
    return entry, list(cur.fetchall())


def _serialise_reading_with_curve(cur, state: AppState, row: dict) -> dict:
    cur.execute("""
        SELECT r.* FROM rolls r JOIN scans s ON s.roll_id=r.id
        WHERE s.id=%s""", (str(row["scan_id"]),))
    roll = cur.fetchone()
    log_h, zone = svc.reading_log_h(cur, roll, float(row["net"]))
    return svc.serialise_reading(row, log_h, zone)


# ------------------------------------------------------------ frame patch and accept


async def patch_frame(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    data = await json_body(request)
    frame_id = request.path_params["frame_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            frame = svc.fetch_frame(cur, frame_id, account_id)
            if frame is None:
                conn.rollback()
                return api_error(404, "not_found")
            edge_changes = [key for key in ("x0", "x1") if key in data]
            new_x0 = data.get("x0", frame["x0"])
            new_x1 = data.get("x1", frame["x1"])
            fields: dict[str, str] = {}
            title = data.get("title")
            values: dict = {}
            if "title" in data:
                if not isinstance(title, str) or code_points(title) > 80:
                    fields["title"] = FIELD_MESSAGES["title"]
                else:
                    values["title"] = title.strip()
            if edge_changes:
                x0 = _whole(new_x0, 0, 10_000_000)
                x1 = _whole(new_x1, 0, 10_000_000)
                if x0 is None or x1 is None:
                    fields["x0" if "x0" in data else "x1"] = FIELD_MESSAGES["x0"]
                else:
                    scan = svc.fetch_scan(cur, str(frame["scan_id"]), account_id)
                    neighbours = _neighbours(cur, frame)
                    bad = _edge_refusal(cur, frame, scan, neighbours, x0, x1)
                    if bad:
                        fields[bad] = FIELD_MESSAGES[bad]
                    else:
                        values["x0"] = x0
                        values["x1"] = x1
                        values["width_mm"] = darkroom.width_mm(x0, x1, scan["dpi"])
            if fields:
                conn.rollback()
                return validation_error(fields)
            if edge_changes:
                if not state.storage_ok():
                    conn.rollback()
                    return api_error(503, "storage_unavailable")
                scan = svc.fetch_scan(cur, str(frame["scan_id"]), account_id)
                roll = svc.fetch_roll(cur, str(scan["roll_id"]), account_id)
                calibration_row = svc.fetch_calibration(cur, str(scan["id"]))
                calibration = calibration_of(calibration_row)
                x0 = values.get("x0", frame["x0"])
                x1 = values.get("x1", frame["x1"])
                flag = darkroom.frame_width_flag(x0, x1, roll["format"], scan["dpi"])
                values["flag"] = flag
                sets = ", ".join(f"{key}=%s" for key in values)
                cur.execute(f"UPDATE frames SET {sets} WHERE id=%s RETURNING *",
                            list(values.values()) + [frame_id])
                frame = cur.fetchone()
                _recompute_scan_density(cur, state, account_id, scan, calibration)
            elif values:
                sets = ", ".join(f"{key}=%s" for key in values)
                cur.execute(f"UPDATE frames SET {sets} WHERE id=%s RETURNING *",
                            list(values.values()) + [frame_id])
                frame = cur.fetchone()
            conn.commit()
            entry, _ = _frame_details(cur, frame)
            return JSONResponse(svc.serialise_frame(frame, entry))


def _neighbours(cur, frame: dict) -> list[dict]:
    cur.execute("""
        SELECT * FROM frames WHERE scan_id=%s AND id<>%s ORDER BY x0""",
        (str(frame["scan_id"]), str(frame["id"])))
    return list(cur.fetchall())


def _edge_refusal(cur, frame: dict, scan: dict, neighbours: list[dict],
                  x0: int, x1: int) -> str | None:
    """The published x0/x1 rule; the first failing edge name is returned."""
    if not 0 <= x0 < x1 <= scan["width"] or x1 - x0 < 8:
        return "x0" if x0 <= 0 or x0 >= x1 else "x1"
    for other in neighbours:
        if x0 < other["x1"] and other["x0"] < x1:
            if other["x0"] < frame["x0"] or (other["x0"] == frame["x0"]
                                             and other["x1"] < frame["x1"]):
                return "x0"
            return "x1"
    return None


async def accept_width(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    frame_id = request.path_params["frame_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            frame = svc.fetch_frame(cur, frame_id, account_id)
            if frame is None:
                conn.rollback()
                return api_error(404, "not_found")
            if frame["flag"] != "flagged":
                conn.rollback()
                return api_error(409, "not_flagged")
            cur.execute("UPDATE frames SET flag='accepted' WHERE id=%s RETURNING *",
                        (frame_id,))
            frame = cur.fetchone()
            conn.commit()
            entry, _ = _frame_details(cur, frame)
            return JSONResponse(svc.serialise_frame(frame, entry))


async def contact_sheet(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    roll_id = request.path_params["roll_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, roll_id, account_id)
            if roll is None:
                return api_error(404, "not_found")
            entries = svc.roll_entries(cur, roll_id)
            frames = svc.roll_frames(cur, roll_id)
            matches = svc.roll_matches(cur, roll, entries, frames)
            counter_values = al.counters(svc.frame_views(frames),
                                         svc.entry_views(entries, roll), matches)
            return JSONResponse({
                "counters": counter_values,
                "frames": [svc.serialise_frame(f, None) for f in frames],
                "entries": [svc.serialise_entry(e, roll, matches.get(str(e["id"])))
                            for e in entries],
            })


# ------------------------------------------------------------ alignment


async def propose_alignment(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    roll_id = request.path_params["roll_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, roll_id, account_id)
            if roll is None:
                conn.rollback()
                return api_error(404, "not_found")
            entries = svc.roll_entries(cur, roll_id)
            frames = svc.roll_frames(cur, roll_id)
            if not frames:
                conn.rollback()
                return api_error(409, "no_frames")
            proposal = al.propose(svc.entry_views(entries, roll), svc.frame_views(frames))
            cur.execute("UPDATE rolls SET proposed_offset=%s, proposed_slip_after=%s "
                        "WHERE id=%s",
                        (proposal["proposed_offset"], proposal["proposed_slip_after"],
                         roll_id))
            conn.commit()
            return JSONResponse(_proposal_body(proposal))


def _proposal_body(proposal: dict) -> dict:
    candidates = [{"offset": c.offset, "rho": c.rho,
                   "pairs": c.pairs} for c in proposal["candidates"]]
    slip_candidates = [{"offset": c.offset, "slip_after": c.slip_after,
                        "rho": c.rho, "pairs": c.pairs}
                       for c in proposal["slip_candidates"]]
    for candidate in candidates:
        candidate["rho"] = None if candidate["rho"] is None else round_half_away(
            candidate["rho"], 4)
    for candidate in slip_candidates:
        candidate["rho"] = None if candidate["rho"] is None else round_half_away(
            candidate["rho"], 4)
    return {"proposed_offset": proposal["proposed_offset"],
            "proposed_slip_after": proposal["proposed_slip_after"],
            "candidates": candidates, "slip_candidates": slip_candidates}


async def get_alignment(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    roll_id = request.path_params["roll_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, roll_id, account_id)
            if roll is None:
                return api_error(404, "not_found")
            entries = svc.roll_entries(cur, roll_id)
            frames = svc.roll_frames(cur, roll_id)
            matches = svc.roll_matches(cur, roll, entries, frames)
            counter_values = al.counters(svc.frame_views(frames),
                                         svc.entry_views(entries, roll), matches)
            proposal = {"proposed_offset": roll["proposed_offset"],
                        "proposed_slip_after": roll["proposed_slip_after"],
                        "candidates": [], "slip_candidates": []}
            overrides = svc.roll_overrides(cur, roll_id)
            return JSONResponse({
                "version": roll["align_version"],
                "offset": roll["align_offset"],
                "slip_after": roll["align_slip_after"],
                "source": roll["align_source"],
                "overrides": [{"entry_id": entry_id, "frame_id": frame_id}
                              for entry_id, frame_id in overrides.items()],
                "proposal": proposal if roll["proposed_offset"] is not None else None,
                "counters": counter_values,
            })


async def save_alignment(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    roll_id = request.path_params["roll_id"]
    data = await json_body(request)
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, roll_id, account_id)
            if roll is None:
                conn.rollback()
                return api_error(404, "not_found")
            entries = svc.roll_entries(cur, roll_id)
            frames = svc.roll_frames(cur, roll_id)
            if not frames:
                conn.rollback()
                return api_error(409, "no_frames")
            scans = svc.roll_scans(cur, roll_id)
            if any(scan["state"] not in ("framed", "aligned") for scan in scans):
                conn.rollback()
                return api_error(409, "unframed_scans")
            if any(frame["flag"] == "flagged" for frame in frames):
                conn.rollback()
                return api_error(409, "flagged_frames")

            version = data.get("version")
            if not isinstance(version, int) or isinstance(version, bool):
                conn.rollback()
                return validation_error({"version": FIELD_MESSAGES["version"]})
            if version != roll["align_version"]:
                conn.rollback()
                return JSONResponse(
                    {"error": "stale_alignment", "version": roll["align_version"],
                     "message": ERROR_COPY["stale_alignment"]}, status_code=412)

            fields: dict[str, str] = {}
            offset = _whole(data.get("offset"), -2, 2)
            if offset is None:
                fields["offset"] = FIELD_MESSAGES["offset"]
            slip_after = data.get("slip_after")
            if slip_after is not None:
                slip_after = _whole(slip_after, 0, 99)
                if slip_after is None or slip_after not in {e["counter"] for e in entries}:
                    fields["slip_after"] = FIELD_MESSAGES["slip_after"]

            override_rows = data.get("overrides") or []
            valid_entries = {str(e["id"]): e for e in entries}
            valid_frames = {str(f["id"]) for f in frames}
            override_map: dict[str, str | None] = {}
            if not isinstance(override_rows, list):
                fields["overrides"] = FIELD_MESSAGES["overrides"]
            else:
                for row in override_rows:
                    entry_id = row.get("entry_id") if isinstance(row, dict) else None
                    frame_id = row.get("frame_id") if isinstance(row, dict) else None
                    if (not isinstance(entry_id, str) or entry_id not in valid_entries
                            or entry_id in override_map
                            or (frame_id is not None
                                and (not isinstance(frame_id, str)
                                     or frame_id not in valid_frames))
                            or (frame_id is not None
                                and frame_id in override_map.values())):
                        fields["overrides"] = FIELD_MESSAGES["overrides"]
                        break
                    override_map[entry_id] = frame_id
            if fields:
                conn.rollback()
                return validation_error(fields)

            source = "manual"
            if (offset == roll["proposed_offset"]
                    and slip_after == roll["proposed_slip_after"]
                    and roll["proposed_offset"] is not None):
                source = "proposed"
            cur.execute("""
                UPDATE rolls SET align_offset=%s, align_slip_after=%s,
                    align_source=%s, align_version=align_version+1
                WHERE id=%s RETURNING align_version""",
                (offset, slip_after, source, roll_id))
            new_version = cur.fetchone()["align_version"]
            cur.execute("DELETE FROM alignment_overrides WHERE roll_id=%s", (roll_id,))
            for entry_id, frame_id in override_map.items():
                cur.execute("""
                    INSERT INTO alignment_overrides (roll_id, entry_id, frame_id)
                    VALUES (%s,%s,%s)""", (roll_id, entry_id, frame_id))
            cur.execute("UPDATE scans SET state='aligned' WHERE roll_id=%s", (roll_id,))
            conn.commit()
            frames = svc.roll_frames(cur, roll_id)
            entries = svc.roll_entries(cur, roll_id)
            roll = svc.fetch_roll(cur, roll_id, account_id)
            matches = svc.roll_matches(cur, roll, entries, frames)
            counter_values = al.counters(svc.frame_views(frames),
                                         svc.entry_views(entries, roll), matches)
            return JSONResponse({
                "version": new_version,
                "offset": offset,
                "slip_after": slip_after,
                "source": source,
                "overrides": [{"entry_id": k, "frame_id": v}
                              for k, v in override_map.items()],
                "proposal": None,
                "counters": counter_values,
            })


# ------------------------------------------------------------ readings


async def loupe_reading(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    scan_id = request.path_params["scan_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            scan = svc.fetch_scan(cur, scan_id, account_id)
            if scan is None:
                return api_error(404, "not_found")
            if scan["state"] == "stored":
                return api_error(409, "not_calibrated")
            x_text = request.query_params.get("x", "")
            y_text = request.query_params.get("y", "")
            x = _whole(int(x_text) if x_text.lstrip("+").isdigit() else None,
                       0, scan["width"] - 1)
            y = _whole(int(y_text) if y_text.lstrip("+").isdigit() else None,
                       0, scan["height"] - 1)
            if x is None or y is None:
                return validation_error({"x": FIELD_MESSAGES["reading_point"],
                                          "y": FIELD_MESSAGES["reading_point"]})
            if not state.storage_ok():
                return api_error(503, "storage_unavailable")
            decoded = _decode_original(state, account_id, scan)
            calibration_row = svc.fetch_calibration(cur, scan_id)
            if decoded is None or calibration_row is None:
                return api_error(503, "storage_unavailable")
            calibration = calibration_of(calibration_row)
            cell_x, cell_y = darkroom.sample_cell(x, y)
            gross, net = darkroom.cell_density(
                _mean_linear(decoded), calibration, cell_x, cell_y,
                None if scan["base_fog"] is None else float(scan["base_fog"]))
            roll = svc.fetch_roll(cur, str(scan["roll_id"]), account_id)
            log_h, zone = (None, None) if net is None else svc.reading_log_h(cur, roll, net)
            frame = _frame_for_cell(cur, scan, cell_x)
            return JSONResponse({
                "x": cell_x, "y": cell_y,
                "gross": round_half_away(gross, 2),
                "net": None if net is None else round_half_away(net, 2),
                "log_h": log_h, "zone": None if zone is None else ROMAN[zone],
                "frame_id": str(frame["id"]) if frame else None,
                "calibration_id": str(calibration_row["id"]),
            })


def _frame_for_cell(cur, scan: dict, cell_x: int) -> dict | None:
    cur.execute("""
        SELECT * FROM frames WHERE scan_id=%s AND %s >= x0 AND %s < x1
        ORDER BY number LIMIT 1""",
        (str(scan["id"]), cell_x, cell_x))
    return cur.fetchone()


async def pin_reading(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    scan_id = request.path_params["scan_id"]
    data = await json_body(request)
    with state.db() as conn:
        with conn.cursor() as cur:
            scan = svc.fetch_scan(cur, scan_id, account_id)
            if scan is None:
                conn.rollback()
                return api_error(404, "not_found")
            if scan["state"] == "stored":
                conn.rollback()
                return api_error(409, "not_calibrated")
            x = _whole(data.get("x"), 0, scan["width"] - 1)
            y = _whole(data.get("y"), 0, scan["height"] - 1)
            if x is None or y is None:
                conn.rollback()
                return validation_error({"x": FIELD_MESSAGES["reading_point"],
                                          "y": FIELD_MESSAGES["reading_point"]})
            cell_x, cell_y = darkroom.sample_cell(x, y)
            frame = _frame_for_cell(cur, scan, cell_x)
            if frame is None:
                conn.rollback()
                return validation_error({"x": FIELD_MESSAGES["pin"]})
            if not state.storage_ok():
                conn.rollback()
                return api_error(503, "storage_unavailable")
            decoded = _decode_original(state, account_id, scan)
            calibration_row = svc.fetch_calibration(cur, scan_id)
            if decoded is None or calibration_row is None:
                conn.rollback()
                return api_error(503, "storage_unavailable")
            calibration = calibration_of(calibration_row)
            gross, net = darkroom.cell_density(
                _mean_linear(decoded), calibration, cell_x, cell_y,
                None if scan["base_fog"] is None else float(scan["base_fog"]))
            roll = svc.fetch_roll(cur, str(scan["roll_id"]), account_id)
            entries = svc.roll_entries(cur, str(roll["id"]))
            frames = svc.roll_frames(cur, str(roll["id"]))
            matches = svc.roll_matches(cur, roll, entries, frames)
            entry_by_frame = {m.frame_id: e_id for e_id, m in matches.items()
                              if m.frame_id}
            cur.execute("""
                INSERT INTO readings (scan_id, frame_id, entry_id, x, y, gross, net,
                    calibration_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                (scan_id, str(frame["id"]), entry_by_frame.get(str(frame["id"])),
                 cell_x, cell_y, round_half_away(gross, 2), round_half_away(net, 2),
                 str(calibration_row["id"])))
            reading = cur.fetchone()
            conn.commit()
            log_h, zone = svc.reading_log_h(cur, roll, float(reading["net"]))
            return JSONResponse(svc.serialise_reading(reading, log_h, zone),
                                status_code=201)


# ------------------------------------------------------------ curves


async def roll_curve(request: Request) -> Response:
    state = request.app.state
    account_id = request.state.account_id
    roll_id = request.path_params["roll_id"]
    with state.db() as conn:
        with conn.cursor() as cur:
            roll = svc.fetch_roll(cur, roll_id, account_id)
            if roll is None:
                return api_error(404, "not_found")
            curve = svc.roll_curve(cur, roll)
            return JSONResponse(_curve_body(cur, roll, curve))


def _curve_body(cur, roll: dict, curve: dict) -> dict:
    return {
        "curve_roll_id": curve["curve_roll_id"],
        "ready": curve["ready"],
        "points": [{"log_h": round_half_away(p.log_h, 2),
                    "net": round_half_away(p.net, 2)} for p in curve["points"]],
        "base_fog": curve["base_fog"],
        "speed_point_log_h": None if curve["speed_point_log_h"] is None
        else round_half_away(curve["speed_point_log_h"], 2),
        "contrast_index": curve["contrast_index"],
        "frames_used": curve["frames_used"],
        "stops_span": round_half_away(curve["stops_span"], 1),
        "meter_bias_stops": curve["meter_bias_stops"],
    }






