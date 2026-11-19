"""Calibration sets: creation, versions, masters, matching, transitions."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from darkframe.common.http import ApiError, gen_id, read_json
from darkframe.common.validate import FILTERS, NAME_RE
from darkframe.services.ledger.api import (
    _batch_of, _session_of, _set_of, batch_body, db, now_utc, session_body, set_body,
)
from darkframe.services.ledger.batches import UPLOAD_LIMIT
from darkframe.services.ledger.frames import imager
from darkframe.services.ledger.sites import zone_from_header, site_today
from darkframe.services.ledger.storage import storage

MATCH_FIELDS = {
    "dark": ["camera", "binning", "gain", "offset", "exposure_s", "temperature_c"],
    "bias": ["camera", "binning", "gain", "offset"],
    "flat": ["camera", "binning", "filter"],
}
REASON_ORDER = ["camera", "binning", "gain", "offset", "exposure", "temperature", "filter"]
MASTER_CONTENT_TYPES = {"image/fits", "application/octet-stream"}
FRAME_NAME_MAX = 120


def _set_fields(raw: dict, kind: Optional[str] = None) -> dict:
    fields: dict[str, str] = {}
    if kind is None:
        kind = raw.get("kind")
    if kind not in ("dark", "flat", "bias"):
        fields["kind"] = "Kind must be dark, flat or bias."
    name = raw.get("name")
    if not isinstance(name, str) or not (1 <= len(name) <= 80):
        fields["name"] = "Set name must be between 1 and 80 characters."
    camera = raw.get("camera")
    if not isinstance(camera, str) or not (1 <= len(camera) <= 60):
        fields["camera"] = "Camera must be between 1 and 60 characters."
    gain = raw.get("gain")
    if not isinstance(gain, int) or isinstance(gain, bool) or not (0 <= gain <= 1000):
        fields["gain"] = "Gain must be a whole number between 0 and 1,000."
    offset = raw.get("offset")
    if not isinstance(offset, int) or isinstance(offset, bool) or not (0 <= offset <= 1000):
        fields["offset"] = "Offset must be a whole number between 0 and 1,000."
    exposure = raw.get("exposure_s")
    if kind == "dark":
        if not isinstance(exposure, int) or isinstance(exposure, bool) or not (1 <= exposure <= 3600):
            fields["exposure_s"] = "A dark set needs a whole exposure between 1 and 3,600 seconds."
    elif exposure is not None:
        fields["exposure_s"] = "Only a dark set has an exposure."
    temp = raw.get("temperature_c")
    if isinstance(temp, bool) or not isinstance(temp, (int, float)) or not (-40 <= temp <= 40) or round(temp, 1) != temp:
        fields["temperature_c"] = "Sensor temperature must be between -40 and 40 with at most one decimal."
    binning = raw.get("binning")
    if not isinstance(binning, int) or isinstance(binning, bool) or not (1 <= binning <= 4):
        fields["binning"] = "Binning must be 1, 2, 3 or 4."
    filt = raw.get("filter")
    if kind == "flat":
        if filt not in FILTERS:
            fields["filter"] = "A flat set needs a filter."
    elif filt is not None:
        fields["filter"] = "Only a flat set has a filter."
    frame_count = raw.get("frame_count")
    if not isinstance(frame_count, int) or isinstance(frame_count, bool) or not (1 <= frame_count <= 1000):
        fields["frame_count"] = "Frames combined must be a whole number between 1 and 1,000."
    captured = raw.get("captured_on")
    if not isinstance(captured, str) or not _is_date(captured):
        fields["captured_on"] = "Captured on must be a real YYYY-MM-DD date."
    return fields


def _is_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _set_values(raw: dict, kind: str) -> dict:
    return {
        "name": raw["name"], "kind": kind, "camera": raw["camera"], "gain": raw["gain"],
        "offset": raw["offset"],
        "exposure_s": raw.get("exposure_s") if kind == "dark" else None,
        "temperature_c": round(float(raw["temperature_c"]), 1), "binning": raw["binning"],
        "filter": raw.get("filter") if kind == "flat" else None,
        "frame_count": raw["frame_count"], "captured_on": raw["captured_on"],
    }


def _record_version(cursor, set_id: str, version: int, values: dict, master: Optional[dict]) -> None:
    cursor.execute(
        "INSERT INTO calibration_versions (id, set_id, version, fields, master, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
        (gen_id("calv"), set_id, version, json.dumps(values), json.dumps(master) if master else None, now_utc()),
    )


def matching_fields(set_row: dict, batch: dict) -> list[str]:
    return MATCH_FIELDS[set_row["kind"]]


def set_mismatches(set_row: dict, batch: dict) -> list[dict]:
    """The published mismatch fields and reasons for a set against a batch."""
    kind = set_row["kind"]
    reasons: list[str] = []
    out: list[dict] = []
    for field in MATCH_FIELDS[kind]:
        sv = set_row[field]
        bv = batch[field]
        if field == "temperature_c":
            if abs(float(sv) - float(bv)) > 2.0:
                reasons.append(f"temperature {float(sv):.1f} C is more than 2.0 C from {float(bv):.1f} C")
                out.append({"field": "temperature", "set": f"{float(sv):.1f}", "batch": f"{float(bv):.1f}"})
        elif field == "exposure_s":
            if sv != bv:
                reasons.append(f"exposure {sv} s does not match {bv} s")
                out.append({"field": "exposure", "set": str(sv), "batch": str(bv)})
        else:
            if sv != bv:
                label = {"camera": "camera", "binning": "binning", "gain": "gain", "offset": "offset", "filter": "filter"}[field]
                reasons.append(f"{label} {sv} does not match {bv}")
                out.append({"field": label, "set": str(sv), "batch": str(bv)})
    return out, reasons


def _mismatch_payload(set_row: dict, batch: dict) -> dict:
    out, reasons = set_mismatches(set_row, batch)
    message = "Calibration refused: " + "; ".join(reasons) + "."
    return out, message


# ---------------------------------------------------------------------------
# Library routes


async def list_sets(request: Request):
    ident = imager(request)
    zone = zone_from_header(request)
    today = site_today(zone)

    def fn(cursor):
        rows = cursor.execute("SELECT * FROM calibration_sets WHERE imager_id=%s ORDER BY name", (ident,)).fetchall()
        return {"calibration_sets": [set_body(cursor, dict(r), today) for r in rows]}
    return JSONResponse(db().run_in_transaction(fn))


async def create_set(request: Request):
    ident = imager(request)
    raw = await read_json(request)
    zone = zone_from_header(request)
    today = site_today(zone)
    kind = raw.get("kind")
    fields = _set_fields(raw)
    if kind is not None and "kind" in raw and kind not in ("dark", "flat", "bias"):
        pass
    if fields:
        raise ApiError(422, "validation", "Check the highlighted fields.", fields)
    if kind not in ("dark", "flat", "bias"):
        raise ApiError(422, "validation", "Kind must be dark, flat or bias.", {"kind": "Kind must be dark, flat or bias."})
    if _is_date(raw.get("captured_on", "")) and raw["captured_on"] > today:
        raise ApiError(422, "validation", "Check the highlighted fields.", {"captured_on": "Captured on cannot be after today."})
    values = _set_values(raw, kind)

    def fn(cursor):
        sid = gen_id("cal")
        cursor.execute(
            'INSERT INTO calibration_sets (id, imager_id, name, kind, camera, gain, "offset", exposure_s, temperature_c, binning, filter, frame_count, captured_on, status, version, current_master, created_at, updated_at)'
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (sid, ident, values["name"], kind, values["camera"], values["gain"], values["offset"], values["exposure_s"], values["temperature_c"], values["binning"], values["filter"], values["frame_count"], values["captured_on"], "building", 1, None, now_utc(), now_utc()),
        )
        _record_version(cursor, sid, 1, values, None)
        row = dict(cursor.execute("SELECT * FROM calibration_sets WHERE id=%s", (sid,)).fetchone())
        return set_body(cursor, row, today)
    return JSONResponse(db().run_in_transaction(fn), status_code=201)


async def get_set(request: Request):
    ident = imager(request)
    sid = request.path_params["set_id"]
    zone = zone_from_header(request)
    today = site_today(zone)

    def fn(cursor):
        row = _set_of(cursor, sid, ident)
        return set_body(cursor, row, today)
    return JSONResponse(db().run_in_transaction(fn))


async def patch_set(request: Request):
    ident = imager(request)
    sid = request.path_params["set_id"]
    raw = await read_json(request)
    zone = zone_from_header(request)
    today = site_today(zone)
    if "kind" in raw:
        raise ApiError(422, "validation", "Check the highlighted fields.", {"kind": "The kind of a set cannot change."})

    def fn(cursor):
        row = _set_of(cursor, sid, ident)
        if row["status"] == "retired":
            raise ApiError(409, "set_retired", "A retired set cannot be edited.")
        merged = {
            "name": raw.get("name", row["name"]), "camera": raw.get("camera", row["camera"]),
            "gain": raw.get("gain", row["gain"]), "offset": raw.get("offset", row["offset"]),
            "exposure_s": raw.get("exposure_s", row["exposure_s"]),
            "temperature_c": raw.get("temperature_c", row["temperature_c"]),
            "binning": raw.get("binning", row["binning"]), "filter": raw.get("filter", row["filter"]),
            "frame_count": raw.get("frame_count", row["frame_count"]),
            "captured_on": raw.get("captured_on", row["captured_on"]),
        }
        fields = _set_fields({**merged, "kind": row["kind"]}, kind=row["kind"])
        if fields:
            raise ApiError(422, "validation", "Check the highlighted fields.", fields)
        if merged["captured_on"] > today:
            raise ApiError(422, "validation", "Check the highlighted fields.", {"captured_on": "Captured on cannot be after today."})
        values = _set_values({**merged, "kind": row["kind"]}, row["kind"])
        version = int(row["version"]) + 1
        cursor.execute(
            'UPDATE calibration_sets SET name=%s, camera=%s, gain=%s, "offset"=%s, exposure_s=%s, temperature_c=%s, binning=%s, filter=%s, frame_count=%s, captured_on=%s, version=%s, updated_at=%s WHERE id=%s',
            (values["name"], values["camera"], values["gain"], values["offset"], values["exposure_s"], values["temperature_c"], values["binning"], values["filter"], values["frame_count"], values["captured_on"], version, now_utc(), sid),
        )
        master = row["current_master"]
        _record_version(cursor, sid, version, values, master)
        return set_body(cursor, dict(cursor.execute("SELECT * FROM calibration_sets WHERE id=%s", (sid,)).fetchone()), today)
    return JSONResponse(db().run_in_transaction(fn))


async def upload_master(request: Request):
    ident = imager(request)
    sid = request.path_params["set_id"]
    filename = request.query_params.get("filename", "")
    if not filename or len(filename) > FRAME_NAME_MAX or not NAME_RE.match(filename):
        raise ApiError(422, "validation", "The file name must be letters, digits, dots, underscores or hyphens.", {"filename": "The file name must be letters, digits, dots, underscores or hyphens."})
    body = await request.body()
    if not (1 <= len(body) <= UPLOAD_LIMIT):
        raise ApiError(413, "too_large", "Masters must be between 1 and 20,000,000 bytes.")
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if ctype not in MASTER_CONTENT_TYPES:
        raise ApiError(415, "unsupported_media_type", "Masters must be FITS or raw bytes.")

    def fn(cursor):
        row = _set_of(cursor, sid, ident)
        if row["status"] == "retired":
            raise ApiError(409, "set_retired", "A retired set cannot be edited.")
        version = int(row["version"]) + 1
        key = f"calibration/{ident}/{sid}/v{version}/{filename}"
        stored = storage().put(key, body, ctype)
        master = {"filename": filename, "size_bytes": stored["size_bytes"], "sha256": stored["sha256"]}
        cursor.execute("UPDATE calibration_sets SET version=%s, current_master=%s, updated_at=%s WHERE id=%s",
                       (version, json.dumps(master), now_utc(), sid))
        values = _editable_values(row)
        _record_version(cursor, sid, version, values, master)
        return version
    version = db().run_in_transaction(fn)
    return JSONResponse({"version": version}, status_code=200)


def _editable_values(row: dict) -> dict:
    return {
        "name": row["name"], "kind": row["kind"], "camera": row["camera"], "gain": row["gain"],
        "offset": row["offset"], "exposure_s": row["exposure_s"],
        "temperature_c": float(row["temperature_c"]), "binning": row["binning"],
        "filter": row["filter"], "frame_count": row["frame_count"], "captured_on": row["captured_on"],
    }


async def download_master(request: Request):
    ident = imager(request)
    sid = request.path_params["set_id"]

    def fn(cursor):
        row = _set_of(cursor, sid, ident)
        master = row["current_master"]
        if not master:
            raise ApiError(404, "not_found", "This set has no master yet.")
        return f"calibration/{ident}/{sid}/v{int(row['version'])}/{master['filename']}", master["filename"]
    key, _ = db().run_in_transaction(fn)
    data, _ = storage().get(key)
    return Response(data, media_type="application/octet-stream")


async def transition_set(request: Request):
    ident = imager(request)
    sid = request.path_params["set_id"]
    body = await read_json(request)
    to = body.get("to")
    if to not in ("ready", "retired"):
        raise ApiError(422, "validation", "A set can become ready or retired.", {"to": "A set can become ready or retired."})
    zone = zone_from_header(request)
    today = site_today(zone)

    def fn(cursor):
        row = _set_of(cursor, sid, ident)
        if to == "ready":
            if row["status"] != "building":
                raise ApiError(409, "illegal_transition", f"A calibration set that is {row['status']} cannot become ready.")
            if not row["current_master"]:
                raise ApiError(409, "master_missing", "Upload a master before marking the set ready.")
            cursor.execute("UPDATE calibration_sets SET status='ready' WHERE id=%s", (sid,))
        else:
            cursor.execute("UPDATE calibration_sets SET status='retired' WHERE id=%s", (sid,))
        return set_body(cursor, dict(cursor.execute("SELECT * FROM calibration_sets WHERE id=%s", (sid,)).fetchone()), today)
    return JSONResponse(db().run_in_transaction(fn))


async def list_versions(request: Request):
    ident = imager(request)
    sid = request.path_params["set_id"]

    def fn(cursor):
        _set_of(cursor, sid, ident)
        rows = cursor.execute("SELECT * FROM calibration_versions WHERE set_id=%s ORDER BY version", (sid,)).fetchall()
        out = []
        for r in rows:
            fields = json.loads(r["fields"]) if isinstance(r["fields"], str) else r["fields"]
            master = r["master"]
            if isinstance(master, str):
                master = json.loads(master)
            out.append({
                "version": int(r["version"]),
                "created_at": r["created_at"].isoformat().replace("+00:00", "Z"),
                **fields,
                "master": master,
            })
        return {"versions": out}
    return JSONResponse(db().run_in_transaction(fn))


async def restore_version(request: Request):
    ident = imager(request)
    sid = request.path_params["set_id"]
    body = await read_json(request)
    version = body.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise ApiError(422, "validation", "Choose a version to restore.", {"version": "Choose a version to restore."})
    zone = zone_from_header(request)
    today = site_today(zone)

    def fn(cursor):
        row = _set_of(cursor, sid, ident)
        if row["status"] == "retired":
            raise ApiError(409, "set_retired", "A retired set cannot be edited.")
        target = cursor.execute("SELECT * FROM calibration_versions WHERE set_id=%s AND version=%s", (sid, version)).fetchone()
        if not target:
            raise ApiError(404, "not_found", "There is no such version of this set.")
        fields = json.loads(target["fields"]) if isinstance(target["fields"], str) else target["fields"]
        master = target["master"]
        if isinstance(master, str):
            master = json.loads(master)
        new_version = int(row["version"]) + 1
        cursor.execute(
            'UPDATE calibration_sets SET name=%s, camera=%s, gain=%s, "offset"=%s, exposure_s=%s, temperature_c=%s, binning=%s, filter=%s, frame_count=%s, captured_on=%s, version=%s, current_master=%s, updated_at=%s WHERE id=%s',
            (fields["name"], fields["camera"], fields["gain"], fields["offset"], fields.get("exposure_s"), fields["temperature_c"], fields["binning"], fields.get("filter"), fields["frame_count"], fields["captured_on"], new_version, json.dumps(master) if master else None, now_utc(), sid),
        )
        _record_version(cursor, sid, new_version, fields, master)
        return set_body(cursor, dict(cursor.execute("SELECT * FROM calibration_sets WHERE id=%s", (sid,)).fetchone()), today)
    return JSONResponse(db().run_in_transaction(fn))


# ---------------------------------------------------------------------------
# Calibration linking


async def calibration_candidates(request: Request):
    ident = imager(request)
    batch_id = request.path_params["batch_id"]
    zone = zone_from_header(request)
    today = site_today(zone)

    def fn(cursor):
        batch = _batch_of(cursor, batch_id, ident)
        rows = cursor.execute("SELECT * FROM calibration_sets WHERE imager_id=%s ORDER BY name", (ident,)).fetchall()
        out = []
        for r in rows:
            row = dict(r)
            mismatches, reasons = set_mismatches(row, batch)
            status = row["status"]
            age_days = None
            usable = status in ("ready", "stale")
            if status == "ready" and row["kind"] == "dark":
                pass
            candidate = {
                "calibration_set_id": row["id"],
                "name": row["name"],
                "kind": row["kind"],
                "status": set_body(cursor, row, today)["status"],
                "matches": usable and not mismatches,
                "reasons": [f"{m['field']} mismatch" for m in mismatches],
            }
            out.append(candidate)
        return {"candidates": out}
    return JSONResponse(db().run_in_transaction(fn))


async def link_calibration(request: Request):
    ident = imager(request)
    batch_id = request.path_params["batch_id"]
    body = await read_json(request)
    set_id = body.get("calibration_set_id")
    if not isinstance(set_id, str):
        raise ApiError(422, "validation", "Choose a calibration set.", {"calibration_set_id": "Choose a calibration set."})
    zone = zone_from_header(request)
    today = site_today(zone)

    def fn(cursor):
        batch = _batch_of(cursor, batch_id, ident)
        session = _session_of(cursor, batch["session_id"], ident)
        if session["state"] == "trashed":
            raise ApiError(409, "wrong_state", "A trashed session cannot be calibrated.")
        row = _set_of(cursor, set_id, ident)
        body = set_body(cursor, row, today)
        if row["status"] in ("building", "retired"):
            raise ApiError(409, "calibration_not_usable", "This set cannot calibrate lights yet.")
        mismatches, reasons = set_mismatches(row, batch)
        if mismatches:
            message = "Calibration refused: " + "; ".join(reasons) + "."
            raise ApiError(422, "calibration_mismatch", message, mismatches=mismatches)
        cursor.execute(
            "INSERT INTO calibration_links (batch_id, kind, calibration_set_id, created_at) VALUES (%s,%s,%s,%s)"
            " ON CONFLICT (batch_id, kind) DO UPDATE SET calibration_set_id=EXCLUDED.calibration_set_id, created_at=EXCLUDED.created_at",
            (batch_id, row["kind"], set_id, now_utc()),
        )
        warning = "stale" if body["status"] == "stale" else None
        return {"batch": batch_body(cursor, dict(cursor.execute("SELECT * FROM batches WHERE id=%s", (batch_id,)).fetchone())), "warning": warning}
    return JSONResponse(db().run_in_transaction(fn))


async def unlink_calibration(request: Request):
    ident = imager(request)
    batch_id = request.path_params["batch_id"]
    kind = request.path_params["kind"]

    def fn(cursor):
        _batch_of(cursor, batch_id, ident)
        row = cursor.execute("SELECT * FROM calibration_links WHERE batch_id=%s AND kind=%s", (batch_id, kind)).fetchone()
        if not row:
            raise ApiError(404, "not_found", "There is no such calibration link.")
        cursor.execute("DELETE FROM calibration_links WHERE batch_id=%s AND kind=%s", (batch_id, kind))
        return batch_body(cursor, dict(cursor.execute("SELECT * FROM batches WHERE id=%s", (batch_id,)).fetchone()))
    return JSONResponse(db().run_in_transaction(fn))
