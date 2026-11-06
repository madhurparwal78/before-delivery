"""Strip scans: upload, calibration, frame detection, nudges and readings."""

from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import numpy as np

from . import db, errors, pixels, records, storage, validate
from .config import UPLOAD_BODY_LIMIT
from .copy import FIELD_COPY, FILE_KIND_TO_FIELD_COPY
from .domain import curve as curve_rules
from .domain import density as density_rules
from .domain import frames as frame_rules
from .domain.rounding import round_half_away
from .imaging import scan as scan_images
from .validate import Fields
from .web import Request, Response, json_response

MAX_FILENAME = 120
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")

_guards: dict[tuple[str, str], threading.Lock] = {}
_guards_lock = threading.Lock()
_scan_locks: dict[str, threading.Lock] = {}
_scan_locks_lock = threading.Lock()


def _account_id(request: Request) -> str:
    assert request.account is not None
    return str(request.account["id"])


def _require_view(request: Request, roll_id: str) -> records.RollView:
    view = records.load_view(_account_id(request), roll_id)
    if view is None:
        raise errors.not_found()
    return view


def _require_scan(request: Request, scan_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        """
        SELECT s.*, r.account_id, r.format AS roll_format
        FROM scans s JOIN rolls r ON r.id = s.roll_id
        WHERE s.id = %s AND r.account_id = %s
        """,
        (scan_id, _account_id(request)),
    )
    if row is None:
        raise errors.not_found()
    return row


def _require_frame(request: Request, frame_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    row = db.fetch_one(
        """
        SELECT f.*
        FROM frames f
        JOIN scans s ON s.id = f.scan_id
        JOIN rolls r ON r.id = s.roll_id
        WHERE f.id = %s AND r.account_id = %s
        """,
        (frame_id, _account_id(request)),
    )
    if row is None:
        raise errors.not_found()
    return row, _require_scan(request, str(row["scan_id"]))


@contextmanager
def _duplicate_guard(roll_id: str, sha256: str) -> Iterator[None]:
    """Held from the duplicate check until the scan record is committed."""
    key = (roll_id, sha256)
    with _guards_lock:
        guard = _guards.setdefault(key, threading.Lock())
    guard.acquire()
    try:
        yield
    finally:
        guard.release()
        with _guards_lock:
            if not guard.locked():
                _guards.pop(key, None)


@contextmanager
def _scan_guard(scan_id: str) -> Iterator[None]:
    """Nudges and recalibrations on one scan are applied one at a time."""
    with _scan_locks_lock:
        guard = _scan_locks.setdefault(scan_id, threading.Lock())
    with guard:
        yield


def safe_filename(raw: str | None) -> str:
    candidate = (raw or "").replace("\\", "/").split("/")[-1]
    candidate = _CONTROL_CHARACTERS.sub("", candidate).strip()[:MAX_FILENAME]
    return candidate or "strip"


def list_scans(request: Request, roll_id: str) -> Response:
    view = _require_view(request, roll_id)
    return json_response(
        200, {"scans": [records.serialise_scan(scan) for scan in view.scans]}
    )


def get_scan(request: Request, scan_id: str) -> Response:
    scan = _require_scan(request, scan_id)
    view = _require_view(request, str(scan["roll_id"]))
    body = records.serialise_scan(scan)
    body["frames"] = [
        records.serialise_frame(view, frame)
        for frame in view.frames
        if str(frame.row["scan_id"]) == scan_id
    ]
    return json_response(200, body)


def upload_scan(request: Request, roll_id: str) -> Response:
    """All-or-nothing: the record is committed only after storage confirms."""
    _require_view(request, roll_id)
    declared_length = request.content_length()
    if declared_length > UPLOAD_BODY_LIMIT:
        raise errors.too_large()
    data = request.read_exactly(declared_length)
    if len(data) > UPLOAD_BODY_LIMIT:
        raise errors.too_large()
    image_format = scan_images.detect_format(data)
    if image_format is None:
        raise errors.unsupported_format()
    sha256 = hashlib.sha256(data).hexdigest()

    with _duplicate_guard(roll_id, sha256):
        existing = db.fetch_one(
            "SELECT id FROM scans WHERE roll_id = %s AND sha256 = %s",
            (roll_id, sha256),
        )
        if existing:
            raise errors.conflict("duplicate_scan", {"scan_id": str(existing["id"])})

        fields = Fields()
        dpi = validate.query_whole_number(
            fields, request.query.get("dpi"), "dpi", low=300, high=10000
        )
        first_edge = validate.query_whole_number(
            fields, request.query.get("first_edge"), "first_edge", low=0, high=99
        )
        if request.header("X-Scan-Size") != str(len(data)):
            fields.fail("size")
        if (request.header("X-Scan-SHA256") or "").lower() != sha256:
            fields.fail("sha256")
        decoded = None
        try:
            scan_images.inspect(data)
            decoded = scan_images.decode(data)
        except scan_images.ScanFileError as error:
            fields.errors["file"] = FILE_KIND_TO_FIELD_COPY[error.kind]
        if not fields.ok():
            raise errors.validation_failed(fields.errors)
        assert decoded is not None and dpi is not None and first_edge is not None

        scan_id = str(uuid.uuid4())
        account_id = _account_id(request)
        filename = safe_filename(request.query.get("filename"))
        slices = scan_images.preview_slices(decoded.display)
        written: list[str] = []
        try:
            original_key = storage.original_key(account_id, scan_id)
            storage.put_object(
                original_key, data, f"image/{'png' if image_format == 'png' else 'tiff'}"
            )
            written.append(original_key)
            for index, slice_bytes in enumerate(slices):
                key = storage.preview_key(account_id, scan_id, index)
                storage.put_object(key, slice_bytes, "image/png")
                written.append(key)
            stored_bytes = storage.get_object(original_key)
            if len(stored_bytes) != len(data) or hashlib.sha256(
                stored_bytes
            ).hexdigest() != sha256:
                raise storage.StorageUnavailable("stored object does not match")
        except storage.StorageUnavailable as exc:
            for key in written:
                storage.delete_object(key)
            raise errors.storage_unavailable() from exc

        with db.transaction() as cur:
            cur.execute(
                "SELECT coalesce(max(position), 0) AS highest FROM scans WHERE roll_id = %s",
                (roll_id,),
            )
            position = int(cur.fetchone()["highest"]) + 1
            cur.execute(
                """
                INSERT INTO scans (id, roll_id, position, filename, format, size,
                                   sha256, width, height, dpi, first_edge, transfer,
                                   gamma, state, preview_slices)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        'stored', %s)
                """,
                (
                    scan_id,
                    roll_id,
                    position,
                    filename,
                    image_format,
                    len(data),
                    sha256,
                    decoded.width,
                    decoded.height,
                    dpi,
                    first_edge,
                    decoded.transfer,
                    decoded.gamma,
                    len(slices),
                ),
            )
    scan = _require_scan(request, scan_id)
    return json_response(201, records.serialise_scan(scan))


def get_original(request: Request, scan_id: str) -> Response:
    scan = _require_scan(request, scan_id)
    key = storage.original_key(str(scan["account_id"]), scan_id)
    try:
        data = storage.get_object(key)
    except storage.StorageUnavailable as exc:
        raise errors.storage_unavailable() from exc
    return Response(
        status=200,
        body=data,
        content_type="image/png" if scan["format"] == "png" else "image/tiff",
        headers=[
            (
                "Content-Disposition",
                f'attachment; filename="{scan["filename"]}"',
            ),
            ("X-Scan-SHA256", scan["sha256"]),
        ],
    )


def get_preview(request: Request, scan_id: str, index: str) -> Response:
    scan = _require_scan(request, scan_id)
    number = int(index)
    if number >= int(scan["preview_slices"]):
        raise errors.not_found()
    try:
        data = storage.get_object(
            storage.preview_key(str(scan["account_id"]), scan_id, number)
        )
    except storage.StorageUnavailable as exc:
        raise errors.storage_unavailable() from exc
    return Response(status=200, body=data, content_type="image/png")


def _densitometer(scan: dict[str, Any]) -> density_rules.Densitometer:
    calibration = records.load_calibration(scan["calibration_id"])
    assert calibration is not None
    return density_rules.densitometer_from_calibration(calibration)


def _require_calibrated(scan: dict[str, Any]) -> None:
    if scan["calibration_id"] is None:
        raise errors.conflict("not_calibrated")


def calibrate(request: Request, scan_id: str) -> Response:
    scan = _require_scan(request, scan_id)
    body = request.json_body()
    fields = Fields()
    method = body.get("method")
    if method not in ("clear_light", "step_wedge"):
        fields.fail("area")
        method = None
    area_body = body.get("area") if isinstance(body.get("area"), dict) else {}
    area_fields = Fields()
    x = validate.whole_number(area_fields, area_body, "x", low=0, high=scan_images.MAX_WIDTH)
    y = validate.whole_number(area_fields, area_body, "y", low=0, high=scan_images.MAX_HEIGHT)
    w = validate.whole_number(area_fields, area_body, "w", low=1, high=scan_images.MAX_WIDTH)
    h = validate.whole_number(area_fields, area_body, "h", low=1, high=scan_images.MAX_HEIGHT)
    if not area_fields.ok():
        fields.fail("area")
    area = None
    if area_fields.ok():
        assert x is not None and y is not None and w is not None and h is not None
        area = density_rules.Area(x, y, w, h)
        if (
            not area.inside(int(scan["width"]), int(scan["height"]))
            or w < density_rules.MIN_AREA_SIDE
            or h < density_rules.MIN_AREA_SIDE
        ):
            fields.fail("area")
    if method == "step_wedge" and area is not None and "area" not in fields.errors:
        if area.w < density_rules.MIN_WEDGE_WIDTH or area.h < density_rules.MIN_WEDGE_HEIGHT:
            fields.errors["wedge"] = FIELD_COPY["wedge_size"]
    if not fields.ok():
        raise errors.validation_failed(fields.errors)
    assert area is not None and method is not None

    with _scan_guard(scan_id):
        linear = pixels.linear_values(scan)
        steps: list[dict[str, Any]] | None = None
        reference: float | None = None
        if method == "clear_light":
            reference = density_rules.clear_light_reference(linear, area)
        else:
            try:
                values = density_rules.wedge_step_values(linear, area)
            except density_rules.WedgeOrderError as exc:
                raise errors.validation_failed(
                    {"wedge": FIELD_COPY["wedge_order"]}
                ) from exc
            steps = [
                {
                    "k": k,
                    "nominal": density_rules.nominal_step_density(k),
                    "value": value,
                }
                for k, value in enumerate(values)
            ]
        calibration_id = str(uuid.uuid4())
        db.execute(
            """
            INSERT INTO calibrations (id, scan_id, method, area_x, area_y, area_w,
                                      area_h, reference, steps)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                calibration_id,
                scan_id,
                method,
                area.x,
                area.y,
                area.w,
                area.h,
                reference,
                json.dumps(steps) if steps else None,
            ),
        )
        db.execute(
            """
            UPDATE scans
            SET calibration_id = %s,
                state = CASE WHEN state = 'stored' THEN 'calibrated' ELSE state END
            WHERE id = %s
            """,
            (calibration_id, scan_id),
        )
        fresh = _require_scan(request, scan_id)
        _recompute_densities(fresh, linear)
    return json_response(
        201, records.serialise_calibration(records.load_calibration(calibration_id))
    )


def _recompute_densities(scan: dict[str, Any], linear: np.ndarray) -> None:
    """Base plus fog and every frame density of one scan, from the original."""
    frame_rows = db.fetch_all(
        "SELECT id, x0, x1 FROM frames WHERE scan_id = %s ORDER BY x0",
        (str(scan["id"]),),
    )
    if not frame_rows:
        return
    analysis = frame_rules.analyse(linear)
    densitometer = _densitometer(scan)
    slots = [(int(row["x0"]), int(row["x1"])) for row in frame_rows]
    base_fog = frame_rules.base_plus_fog(analysis, densitometer, slots)
    with db.transaction() as cur:
        for row in frame_rows:
            mean = frame_rules.frame_mean_density(
                analysis, densitometer, int(row["x0"]), int(row["x1"])
            )
            cur.execute(
                "UPDATE frames SET mean_density = %s WHERE id = %s",
                (mean, str(row["id"])),
            )
        cur.execute(
            "UPDATE scans SET base_fog = %s WHERE id = %s", (base_fog, str(scan["id"]))
        )


def detect_frames(request: Request, scan_id: str) -> Response:
    scan = _require_scan(request, scan_id)
    request.json_body()
    _require_calibrated(scan)
    if scan["state"] in ("framed", "aligned"):
        raise errors.conflict("frames_exist")
    with _scan_guard(scan_id):
        linear = pixels.linear_values(scan)
        analysis = frame_rules.analyse(linear)
        slots = frame_rules.detect_slots(
            analysis, scan["roll_format"], int(scan["dpi"])
        )
        if not slots:
            raise errors.validation_failed({"scan": FIELD_COPY["scan_detection"]})
        densitometer = _densitometer(scan)
        base_fog = frame_rules.base_plus_fog(
            analysis, densitometer, [(slot.x0, slot.x1) for slot in slots]
        )
        with db.transaction() as cur:
            for index, slot in enumerate(slots):
                cur.execute(
                    """
                    INSERT INTO frames (id, scan_id, slot_index, x0, x1, blank_slot,
                                        mean_density)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        str(uuid.uuid4()),
                        scan_id,
                        index,
                        slot.x0,
                        slot.x1,
                        slot.blank_slot,
                        frame_rules.frame_mean_density(
                            analysis, densitometer, slot.x0, slot.x1
                        ),
                    ),
                )
            cur.execute(
                "UPDATE scans SET state = 'framed', base_fog = %s WHERE id = %s",
                (base_fog, scan_id),
            )
    view = _require_view(request, str(scan["roll_id"]))
    return json_response(
        201,
        {
            "frames": [
                records.serialise_frame(view, frame)
                for frame in view.frames
                if str(frame.row["scan_id"]) == scan_id
            ]
        },
    )


def get_frame(request: Request, frame_id: str) -> Response:
    frame_row, scan = _require_frame(request, frame_id)
    view = _require_view(request, str(scan["roll_id"]))
    frame = view.frame_by_id(frame_id)
    assert frame is not None
    entry = view.entry_for_frame(frame_id)
    curve = records.reading_curve(view)
    return json_response(
        200,
        {
            "frame": records.serialise_frame(view, frame),
            "entry": records.serialise_entry(view, entry) if entry else None,
            "readings": [
                records.serialise_reading(row, curve)
                for row in records.readings_for_frame(frame_id)
            ],
        },
    )


def patch_frame(request: Request, frame_id: str) -> Response:
    frame_row, scan = _require_frame(request, frame_id)
    body = request.json_body()
    fields = Fields()
    title = None
    if "title" in body:
        title = validate.note_text(fields, body, "title", validate.MAX_TITLE)
    wants_edge = "x0" in body or "x1" in body
    x0 = int(frame_row["x0"])
    x1 = int(frame_row["x1"])
    if "x0" in body:
        value = validate.whole_number(
            fields, body, "x0", low=0, high=int(scan["width"]), copy_key="x0"
        )
        if value is not None:
            x0 = value
    if "x1" in body:
        value = validate.whole_number(
            fields, body, "x1", low=0, high=int(scan["width"]), copy_key="x0"
        )
        if value is not None:
            x1 = value
    if not fields.ok():
        raise errors.validation_failed(fields.errors)

    if not wants_edge:
        if title is not None:
            db.execute("UPDATE frames SET title = %s WHERE id = %s", (title, frame_id))
        return _frame_response(request, scan, frame_id)

    with _scan_guard(str(scan["id"])):
        with db.transaction() as cur:
            cur.execute(
                "SELECT id, x0, x1 FROM frames WHERE scan_id = %s ORDER BY x0 FOR UPDATE",
                (str(scan["id"]),),
            )
            siblings = [dict(row) for row in cur.fetchall()]
            current = next(row for row in siblings if str(row["id"]) == frame_id)
            new_x0 = x0 if "x0" in body else int(current["x0"])
            new_x1 = x1 if "x1" in body else int(current["x1"])
            neighbours = [
                (int(row["x0"]), int(row["x1"]))
                for row in siblings
                if str(row["id"]) != frame_id
            ]
            if not frame_rules.edges_allowed(
                new_x0, new_x1, int(scan["width"]), neighbours
            ):
                raise errors.validation_failed(
                    {key: FIELD_COPY["x0"] for key in body if key in ("x0", "x1")}
                )
            linear = pixels.linear_values(scan)
            cur.execute(
                """
                UPDATE frames SET x0 = %s, x1 = %s, accepted = false
                WHERE id = %s
                """,
                (new_x0, new_x1, frame_id),
            )
            if title is not None:
                cur.execute(
                    "UPDATE frames SET title = %s WHERE id = %s", (title, frame_id)
                )
        _recompute_densities(scan, linear)
    return _frame_response(request, scan, frame_id)


def _frame_response(
    request: Request, scan: dict[str, Any], frame_id: str
) -> Response:
    view = _require_view(request, str(scan["roll_id"]))
    frame = view.frame_by_id(frame_id)
    assert frame is not None
    return json_response(200, records.serialise_frame(view, frame))


def accept_width(request: Request, frame_id: str) -> Response:
    frame_row, scan = _require_frame(request, frame_id)
    request.json_body()
    view = _require_view(request, str(scan["roll_id"]))
    frame = view.frame_by_id(frame_id)
    assert frame is not None
    if frame.flag != "flagged":
        raise errors.conflict("not_flagged")
    db.execute("UPDATE frames SET accepted = true WHERE id = %s", (frame_id,))
    return _frame_response(request, scan, frame_id)


def _cell_reading(
    scan: dict[str, Any], view: records.RollView, x: int, y: int, linear: np.ndarray
) -> dict[str, Any]:
    cell_x, cell_y = density_rules.sample_cell_origin(x, y)
    mean = density_rules.sample_cell_mean(linear, x, y)
    densitometer = _densitometer(scan)
    gross = densitometer.density(mean)
    base_fog = scan["base_fog"]
    net = None if base_fog is None else gross - float(base_fog)
    frame_id = None
    for frame in view.frames:
        if str(frame.row["scan_id"]) != str(scan["id"]):
            continue
        if int(frame.row["x0"]) <= cell_x < int(frame.row["x1"]):
            frame_id = frame.id
            break
    return {
        "x": cell_x,
        "y": cell_y,
        "gross": gross,
        "net": net,
        "frame_id": frame_id,
        "calibration_id": str(scan["calibration_id"]),
    }


def _reading_point(scan: dict[str, Any], body: dict[str, Any]) -> tuple[int, int]:
    fields = Fields()
    x = validate.whole_number(
        fields, body, "x", low=0, high=int(scan["width"]) - 1, copy_key="reading_point"
    )
    y = validate.whole_number(
        fields, body, "y", low=0, high=int(scan["height"]) - 1, copy_key="reading_point"
    )
    if not fields.ok():
        raise errors.validation_failed(fields.errors)
    assert x is not None and y is not None
    return x, y


def get_reading(request: Request, scan_id: str) -> Response:
    scan = _require_scan(request, scan_id)
    _require_calibrated(scan)
    fields = Fields()
    x = validate.query_whole_number(
        fields, request.query.get("x"), "x", low=0, high=int(scan["width"]) - 1
    )
    y = validate.query_whole_number(
        fields, request.query.get("y"), "y", low=0, high=int(scan["height"]) - 1
    )
    if not fields.ok():
        raise errors.validation_failed(
            {key: FIELD_COPY["reading_point"] for key in fields.errors}
        )
    assert x is not None and y is not None
    view = _require_view(request, str(scan["roll_id"]))
    linear = pixels.linear_values(scan)
    reading = _cell_reading(scan, view, x, y, linear)
    curve = records.reading_curve(view)
    net = reading["net"]
    log_h = curve.invert(net) if (curve.ready and net is not None) else None
    zone = (
        curve_rules.zone_label(curve.zone(net))
        if (curve.ready and net is not None)
        else None
    )
    return json_response(
        200,
        {
            "x": reading["x"],
            "y": reading["y"],
            "gross": round_half_away(reading["gross"], 2),
            "net": None if net is None else round_half_away(net, 2),
            "log_h": None if log_h is None else round_half_away(log_h, 2),
            "zone": zone,
            "frame_id": reading["frame_id"],
            "calibration_id": reading["calibration_id"],
        },
    )


def pin_reading(request: Request, scan_id: str) -> Response:
    scan = _require_scan(request, scan_id)
    body = request.json_body()
    _require_calibrated(scan)
    view = _require_view(request, str(scan["roll_id"]))
    if not any(str(frame.row["scan_id"]) == scan_id for frame in view.frames):
        raise errors.conflict("no_frames")
    x, y = _reading_point(scan, body)
    linear = pixels.linear_values(scan)
    reading = _cell_reading(scan, view, x, y, linear)
    if reading["frame_id"] is None or reading["net"] is None:
        raise errors.validation_failed({"x": FIELD_COPY["pin_inside"]})
    entry = view.entry_for_frame(reading["frame_id"])
    reading_id = str(uuid.uuid4())
    db.execute(
        """
        INSERT INTO readings (id, scan_id, frame_id, entry_id, x, y, gross, net,
                              calibration_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            reading_id,
            scan_id,
            reading["frame_id"],
            entry.id if entry else None,
            reading["x"],
            reading["y"],
            round_half_away(reading["gross"], 2),
            round_half_away(reading["net"], 2),
            reading["calibration_id"],
        ),
    )
    row = db.fetch_one("SELECT * FROM readings WHERE id = %s", (reading_id,))
    assert row is not None
    return json_response(
        201, records.serialise_reading(row, records.reading_curve(view))
    )
