"""Uploads and their delivery.

Bytes are stored in PostgreSQL exactly as received and served byte for byte. Metadata (type, displayed
size, running time) is read from the bytes and never changes them. Delivery streams in chunks: each
chunk is its own short query, so no database session is held while a client reads or after it leaves.
"""

from __future__ import annotations

import hashlib
import math
import re
import struct
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

from flask import Flask, Response, g, request
from werkzeug.exceptions import RequestEntityTooLarge

from . import catalog, db, errors
from .errors import ApiError
from .router import INT_MAX, route
from .messages import attachment_shape

FILENAME_MAX = 255
FRAMING_ALLOWANCE = 1 << 20
CHUNK = 256 * 1024
MEDIA_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
                 "Cache-Control": "no-cache"}
_ID = re.compile(r"[0-9]{1,10}")
_RANGE = re.compile(r"bytes=(\d{0,18})-(\d{0,18})")
_PNG = b"\x89PNG\r\n\x1a\n"
_EBML = b"\x1a\x45\xdf\xa3"


# --- reading metadata from the bytes -----------------------------------------------------------------------------

def sniff(data: bytes) -> str:
    head = data[:16]
    if head.startswith(_PNG):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(_EBML) and _webm(data)["doctype"] == "webm":
        return "video/webm"
    return "application/octet-stream"


def _exif_orientation(tiff: bytes) -> int:
    if len(tiff) < 8 or tiff[:2] not in (b"II", b"MM"):
        return 1
    order = "<" if tiff[:2] == b"II" else ">"
    (ifd,) = struct.unpack_from(order + "I", tiff, 4)
    if ifd + 2 > len(tiff):
        return 1
    (count,) = struct.unpack_from(order + "H", tiff, ifd)
    for index in range(count):
        entry = ifd + 2 + 12 * index
        if entry + 12 > len(tiff):
            return 1
        tag, _kind, _n = struct.unpack_from(order + "HHI", tiff, entry)
        if tag == 274:
            return struct.unpack_from(order + "H", tiff, entry + 8)[0]
    return 1


def _jpeg_size(data: bytes) -> tuple[int, int] | None:
    position, orientation, size = 2, 1, None
    while position + 4 <= len(data):
        if data[position] != 0xFF:
            position += 1
            continue
        marker = data[position + 1]
        if marker == 0xFF:
            position += 1
            continue
        if marker == 0x01 or 0xD0 <= marker <= 0xD9:
            position += 2
            continue
        (length,) = struct.unpack_from(">H", data, position + 2)
        segment = data[position + 4:position + 2 + length]
        if marker == 0xE1 and segment.startswith(b"Exif\x00\x00") and orientation == 1:
            orientation = _exif_orientation(segment[6:])
        elif 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC) and size is None and len(segment) >= 5:
            height, width = struct.unpack_from(">HH", segment, 1)
            size = (width, height)
        if marker == 0xDA:
            break
        position += 2 + length
    if size is None:
        return None
    return (size[1], size[0]) if orientation in (5, 6, 7, 8) else size


def _webp_size(data: bytes) -> tuple[int, int] | None:
    kind = data[12:16]
    if kind == b"VP8 " and len(data) >= 30:
        width, height = struct.unpack_from("<HH", data, 26)
        return width & 0x3FFF, height & 0x3FFF
    if kind == b"VP8L" and len(data) >= 25:
        bits = struct.unpack_from("<I", data, 21)[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X" and len(data) >= 30:
        return (int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1)
    return None


def _vint(data: bytes, position: int, keep_marker: bool) -> tuple[int, int, bool] | None:
    """(value, length, is_unknown) of an EBML variable-length integer."""
    if position >= len(data):
        return None
    first = data[position]
    length = 1
    mask = 0x80
    while length <= 8 and not first & mask:
        mask >>= 1
        length += 1
    if length > 8 or position + length > len(data):
        return None
    value = first if keep_marker else first & (mask - 1)
    unknown = (first & (mask - 1)) == mask - 1
    for byte in data[position + 1:position + length]:
        value = (value << 8) | byte
        unknown = unknown and byte == 0xFF
    return value, length, unknown


def _elements(data: bytes, start: int, end: int) -> Iterator[tuple[int, int, int]]:
    """(id, body_start, body_end) of each element in [start, end); an unknown size runs to ``end``."""
    position = start
    while position < end:
        ident = _vint(data, position, True)
        if ident is None:
            return
        size = _vint(data, position + ident[1], False)
        if size is None:
            return
        body = position + ident[1] + size[1]
        stop = end if size[2] else min(body + size[0], end)
        yield ident[0], body, stop
        position = stop


def _uint(data: bytes, start: int, stop: int) -> int:
    return int.from_bytes(data[start:stop], "big")


def _webm(data: bytes) -> dict[str, Any]:
    info: dict[str, Any] = {"doctype": None, "width": None, "height": None, "duration_ms": None}
    scale, duration = 1_000_000, None
    for ident, start, stop in _elements(data, 0, len(data)):
        if ident == 0x1a45dfa3:
            for child, c_start, c_stop in _elements(data, start, stop):
                if child == 0x4282:
                    info["doctype"] = data[c_start:c_stop].rstrip(b"\x00").decode("ascii", "replace")
        elif ident == 0x18538067:
            for child, c_start, c_stop in _elements(data, start, stop):
                if child == 0x1549a966:
                    for item, i_start, i_stop in _elements(data, c_start, c_stop):
                        if item == 0x2AD7B1:
                            scale = _uint(data, i_start, i_stop)
                        elif item == 0x4489 and i_stop - i_start in (4, 8):
                            duration = struct.unpack(">f" if i_stop - i_start == 4 else ">d", data[i_start:i_stop])[0]
                elif child == 0x1654ae6b and info["width"] is None:
                    _first_video_track(data, c_start, c_stop, info)
                elif child == 0x1F43B675:
                    break
    if duration is not None:
        info["duration_ms"] = math.floor(duration * scale / 1_000_000 + 0.5)
    return info


def _first_video_track(data: bytes, start: int, stop: int, info: dict[str, Any]) -> None:
    for entry, e_start, e_stop in _elements(data, start, stop):
        if entry != 0xAE:
            continue
        kind, width, height = None, None, None
        for item, i_start, i_stop in _elements(data, e_start, e_stop):
            if item == 0x83:
                kind = _uint(data, i_start, i_stop)
            elif item == 0xE0:
                for dim, d_start, d_stop in _elements(data, i_start, i_stop):
                    if dim == 0xB0:
                        width = _uint(data, d_start, d_stop)
                    elif dim == 0xBA:
                        height = _uint(data, d_start, d_stop)
        if kind == 1:
            info["width"], info["height"] = width, height
            return


def read_metadata(data: bytes) -> dict[str, Any]:
    """Content type, displayed pixel size and (WebM) running time, all read from the bytes."""
    content_type = sniff(data)
    size, duration = None, None
    try:
        if content_type == "image/png" and data[12:16] == b"IHDR":
            size = struct.unpack_from(">II", data, 16)
        elif content_type == "image/gif":
            size = struct.unpack_from("<HH", data, 6)
        elif content_type == "image/jpeg":
            size = _jpeg_size(data)
        elif content_type == "image/webp":
            size = _webp_size(data)
        elif content_type == "video/webm":
            found = _webm(data)
            size = (found["width"], found["height"]) if found["width"] and found["height"] else None
            duration = found["duration_ms"]
    except (struct.error, ValueError):
        size = None
    return {"content_type": content_type, "width": size[0] if size else None,
            "height": size[1] if size else None, "duration_ms": duration}


# --- upload --------------------------------------------------------------------------------------------------------

def clean_filename(raw: str) -> str:
    """The part's file name without directory parts, or a refusal naming file."""
    name = re.split(r"[\\/]", raw)[-1]
    if not name or len(name) > FILENAME_MAX or any(ord(c) < 32 or ord(c) == 127 for c in raw):
        raise errors.invalid("file")
    return name


def _drain(limit: int = 1 << 30) -> None:
    taken = 0
    while taken < limit and (chunk := request.stream.read(1 << 20)):
        taken += len(chunk)


@route("POST", "/api/attachments", session="required", body="multipart")
def upload():
    me = g.member
    limit = catalog.UPLOAD_LIMITS[me["tier"]]
    if request.content_length is not None and request.content_length > limit + FRAMING_ALLOWANCE:
        _drain()
        raise ApiError("payload_too_large", "file")
    request.max_content_length = limit + FRAMING_ALLOWANCE
    try:
        part = request.files.get("file")
    except RequestEntityTooLarge:
        raise ApiError("payload_too_large", "file") from None
    if part is None:
        raise errors.invalid("file")
    data = part.stream.read()
    if len(data) > limit:
        raise ApiError("payload_too_large", "file")
    if not data:
        raise errors.invalid("file")
    filename = clean_filename(part.filename or "")
    meta = read_metadata(data)
    digest = hashlib.sha256(data).hexdigest()
    with db.tx() as cur:
        cur.execute(
            "INSERT INTO attachments (uploader_id, filename, size_bytes, content_type, sha256, data, width, height, "
            "duration_ms) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, filename, size_bytes, content_type, sha256, width, height, duration_ms",
            (me["id"], filename, len(data), meta["content_type"], digest, data, meta["width"], meta["height"],
             meta["duration_ms"]))
        return attachment_shape(cur.fetchone()), 201


# --- delivery ------------------------------------------------------------------------------------------------------

def _requested_range(header: str | None, size: int) -> tuple[int, int] | str | None:
    """(first, last) bytes, ``"unsatisfiable"``, or None when the whole body is wanted."""
    found = _RANGE.fullmatch((header or "").strip())
    if not found or found.group(0) == "bytes=-":
        return None
    first, last = found.groups()
    if not first:
        suffix = int(last)
        return "unsatisfiable" if suffix == 0 else (max(size - suffix, 0), size - 1)
    start = int(first)
    end = int(last) if last else size - 1
    if last and end < start:
        return None
    return "unsatisfiable" if start >= size else (start, min(end, size - 1))


def _chunks(attachment_id: int, start: int, end: int) -> Iterator[bytes]:
    position = start
    while position <= end:
        row = db.one_row("SELECT substring(data FROM %s FOR %s) AS chunk FROM attachments WHERE id = %s",
                         (position + 1, min(CHUNK, end - position + 1), attachment_id))
        if row is None or not row["chunk"]:
            return
        chunk = bytes(row["chunk"])
        position += len(chunk)
        yield chunk


def _etag_listed(header: str | None, etag: str) -> bool:
    if not header:
        return False
    return any(item.strip() in ("*", etag, f"W/{etag}") for item in header.split(","))


def serve(rest: str) -> Response:
    if not _ID.fullmatch(rest) or not 1 <= int(rest) <= INT_MAX:
        return errors.refusal_response(ApiError("not_found"))
    row = db.one_row("SELECT id, filename, size_bytes, content_type, sha256 FROM attachments WHERE id = %s",
                     (int(rest),))
    if row is None:
        return errors.refusal_response(ApiError("not_found"))
    etag = f'"{row["sha256"]}"'
    disposition = "attachment" if row["content_type"] == "application/octet-stream" else "inline"
    headers = {**MEDIA_HEADERS, "ETag": etag, "Accept-Ranges": "bytes",
               "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(row['filename'], safe='!#$&+-.^_`|~')}"}
    size = row["size_bytes"]
    if _etag_listed(request.headers.get("If-None-Match"), etag):
        return Response(status=304, headers=headers)
    wanted = _requested_range(request.headers.get("Range"), size)
    if wanted == "unsatisfiable":
        response = errors.refusal_response(ApiError("range_not_satisfiable"))
        response.headers.update({**headers, "Content-Range": f"bytes */{size}"})
        return response
    first, last = wanted if wanted else (0, size - 1)
    headers.update({"Content-Type": row["content_type"], "Content-Length": str(last - first + 1)})
    if wanted:
        headers["Content-Range"] = f"bytes {first}-{last}/{size}"
    return Response(_chunks(row["id"], first, last), status=206 if wanted else 200, headers=headers,
                    direct_passthrough=True)


def register(app: Flask) -> None:
    app.add_url_rule("/media/<path:rest>", "media", serve, methods=["GET"])
