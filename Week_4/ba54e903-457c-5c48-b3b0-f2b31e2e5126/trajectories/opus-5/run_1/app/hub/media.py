"""Uploaded media: what the bytes say, how the name is cleaned, how it is served.

Stored bytes are never rotated, re-encoded or stripped; reading their size, type and
running time only reads.
"""

from __future__ import annotations

import struct
from typing import Any, AsyncIterator

from starlette.requests import Request
from starlette.responses import Response, StreamingResponse

from .db import DB
from .errors import ApiError, error_response, not_found
from .validation import has_control

CHUNK = 262_144
SAFE_NAME_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" "!#$&+-.^_`|~"
)
INLINE_TYPES = ("image/", "video/webm")

SOF_MARKERS = frozenset(
    {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
)


def clean_filename(raw: str) -> str:
    """Drop every directory part, then refuse what is left if it breaks the rules."""
    name = raw
    for separator in ("/", "\\"):
        name = name.rsplit(separator, 1)[-1]
    if not name or has_control(name) or len(name) > 255:
        raise ApiError(422, "validation_failed", "file")
    return name


def detect_content_type(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"\x1a\x45\xdf\xa3") and _ebml_doctype(data) == "webm":
        return "video/webm"
    return "application/octet-stream"


# --- EBML (WebM) ----------------------------------------------------------


def _read_vint(data: bytes, index: int, keep_marker: bool) -> tuple[int, int]:
    if index >= len(data):
        raise ValueError("short")
    first = data[index]
    if first == 0:
        raise ValueError("bad vint")
    length = 1
    mask = 0x80
    while not first & mask:
        mask >>= 1
        length += 1
    value = first if keep_marker else first & (mask - 1)
    for offset in range(1, length):
        if index + offset >= len(data):
            raise ValueError("short")
        value = (value << 8) | data[index + offset]
    return value, index + length


def _elements(data: bytes, start: int, end: int) -> list[tuple[int, int, int]]:
    """(id, body start, body end) for each element between two offsets."""
    found: list[tuple[int, int, int]] = []
    index = start
    while index < end:
        try:
            element_id, after_id = _read_vint(data, index, True)
            size, after_size = _read_vint(data, after_id, False)
        except ValueError:
            break
        unknown = size >= (1 << (7 * (after_size - after_id))) - 1
        body_end = end if unknown else min(end, after_size + size)
        found.append((element_id, after_size, body_end))
        if unknown:
            index = after_size
        else:
            index = body_end
        if index <= after_id:
            break
    return found


def _ebml_doctype(data: bytes) -> str | None:
    for element_id, start, end in _elements(data, 0, len(data)):
        if element_id == 0x1A45DFA3:
            for child_id, child_start, child_end in _elements(data, start, end):
                if child_id == 0x4282:
                    return data[child_start:child_end].rstrip(b"\x00").decode(
                        "ascii", errors="replace"
                    )
    return None


def _uint(data: bytes, start: int, end: int) -> int:
    value = 0
    for byte in data[start:end]:
        value = (value << 8) | byte
    return value


def _float(data: bytes, start: int, end: int) -> float:
    width = end - start
    if width == 4:
        return struct.unpack(">f", data[start:end])[0]
    if width == 8:
        return struct.unpack(">d", data[start:end])[0]
    return 0.0


def _webm_details(data: bytes) -> tuple[int | None, int | None, int | None]:
    width = height = None
    duration = None
    timecode_scale = 1_000_000
    segment_duration: float | None = None
    for element_id, start, end in _elements(data, 0, len(data)):
        if element_id != 0x18538067:
            continue
        for child_id, child_start, child_end in _elements(data, start, end):
            if child_id == 0x1549A966:
                for info_id, info_start, info_end in _elements(data, child_start, child_end):
                    if info_id == 0x2AD7B1:
                        timecode_scale = _uint(data, info_start, info_end) or 1_000_000
                    elif info_id == 0x4489:
                        segment_duration = _float(data, info_start, info_end)
            elif child_id == 0x1654AE6B:
                for track_id, track_start, track_end in _elements(data, child_start, child_end):
                    if track_id != 0xAE:
                        continue
                    track_type = None
                    this_width = this_height = None
                    for field_id, field_start, field_end in _elements(
                        data, track_start, track_end
                    ):
                        if field_id == 0x83:
                            track_type = _uint(data, field_start, field_end)
                        elif field_id == 0xE0:
                            for video_id, video_start, video_end in _elements(
                                data, field_start, field_end
                            ):
                                if video_id == 0xB0:
                                    this_width = _uint(data, video_start, video_end)
                                elif video_id == 0xBA:
                                    this_height = _uint(data, video_start, video_end)
                    if track_type == 1 and width is None:
                        width, height = this_width, this_height
    if segment_duration is not None:
        duration = round(segment_duration * timecode_scale / 1_000_000)
    return width, height, duration


# --- still images ---------------------------------------------------------


def _png_size(data: bytes) -> tuple[int | None, int | None]:
    if len(data) < 24:
        return None, None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def _gif_size(data: bytes) -> tuple[int | None, int | None]:
    if len(data) < 10:
        return None, None
    width, height = struct.unpack("<HH", data[6:10])
    return width, height


def _webp_size(data: bytes) -> tuple[int | None, int | None]:
    if len(data) < 30:
        return None, None
    kind = data[12:16]
    if kind == b"VP8 ":
        width = struct.unpack("<H", data[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        return width, height
    if kind == b"VP8L":
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X":
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return width, height
    return None, None


def _jpeg_orientation(data: bytes) -> int:
    index = 2
    while index + 4 <= len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        if marker == 0xD9 or marker == 0xDA:
            return 1
        length = struct.unpack(">H", data[index + 2 : index + 4])[0]
        segment = data[index + 4 : index + 2 + length]
        if marker == 0xE1 and segment.startswith(b"Exif\x00\x00"):
            return _exif_orientation(segment[6:])
        index += 2 + length
    return 1


def _exif_orientation(tiff: bytes) -> int:
    if len(tiff) < 8:
        return 1
    if tiff[:2] == b"II":
        order = "<"
    elif tiff[:2] == b"MM":
        order = ">"
    else:
        return 1
    magic, first_ifd = struct.unpack(order + "HI", tiff[2:8])
    if magic != 42 or first_ifd + 2 > len(tiff):
        return 1
    count = struct.unpack(order + "H", tiff[first_ifd : first_ifd + 2])[0]
    for entry in range(count):
        start = first_ifd + 2 + entry * 12
        if start + 12 > len(tiff):
            break
        tag, kind = struct.unpack(order + "HH", tiff[start : start + 4])
        if tag == 274:
            if kind == 3:
                return struct.unpack(order + "H", tiff[start + 8 : start + 10])[0]
            if kind == 4:
                return struct.unpack(order + "I", tiff[start + 8 : start + 12])[0]
    return 1


def _jpeg_size(data: bytes) -> tuple[int | None, int | None]:
    index = 2
    while index + 4 <= len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        if marker == 0xD9:
            break
        length = struct.unpack(">H", data[index + 2 : index + 4])[0]
        if marker in SOF_MARKERS and index + 9 <= len(data):
            height, width = struct.unpack(">HH", data[index + 5 : index + 9])
            if _jpeg_orientation(data) in (5, 6, 7, 8):
                return height, width
            return width, height
        if marker == 0xDA:
            break
        index += 2 + length
    return None, None


def inspect(data: bytes) -> dict[str, Any]:
    """The type, displayed pixel size and running time the bytes themselves report."""
    content_type = detect_content_type(data)
    width = height = duration_ms = None
    if content_type == "image/png":
        width, height = _png_size(data)
    elif content_type == "image/gif":
        width, height = _gif_size(data)
    elif content_type == "image/webp":
        width, height = _webp_size(data)
    elif content_type == "image/jpeg":
        width, height = _jpeg_size(data)
    elif content_type == "video/webm":
        width, height, duration_ms = _webm_details(data)
    return {
        "content_type": content_type,
        "width": width,
        "height": height,
        "duration_ms": duration_ms,
    }


# --- serving --------------------------------------------------------------


def encode_filename(name: str) -> str:
    out: list[str] = []
    for byte in name.encode("utf-8"):
        character = chr(byte)
        if character in SAFE_NAME_CHARS:
            out.append(character)
        else:
            out.append(f"%{byte:02X}")
    return "".join(out)


def safety_headers(row: Any) -> dict[str, str]:
    disposition = (
        "inline"
        if row["content_type"].startswith("image/") or row["content_type"] == "video/webm"
        else "attachment"
    )
    return {
        "ETag": f'"{row["sha256"]}"',
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": (
            f"{disposition}; filename*=UTF-8''{encode_filename(row['filename'])}"
        ),
    }


def parse_range(header: str, size: int) -> tuple[int, int] | None:
    """One byte range, or None when the header names no single satisfiable range."""
    if not header.startswith("bytes="):
        return None
    spec = header[6:].strip()
    if "," in spec:
        return None
    start_text, _, end_text = spec.partition("-")
    if not start_text and end_text.isdigit():
        length = int(end_text)
        if length == 0:
            return None
        start = max(0, size - length)
        return start, size - 1
    if not start_text.isdigit():
        return None
    start = int(start_text)
    if start >= size:
        return None
    if not end_text:
        return start, size - 1
    if not end_text.isdigit():
        return None
    return start, min(int(end_text), size - 1)


async def _stream(attachment_id: int, start: int, end: int) -> AsyncIterator[bytes]:
    position = start
    while position <= end:
        length = min(CHUNK, end - position + 1)
        async with DB.connection() as conn:
            data = await conn.fetchval(
                "SELECT substring(data from $2 for $3) FROM attachments WHERE id = $1",
                attachment_id,
                position + 1,
                length,
            )
        if not data:
            return
        yield data
        position += len(data)


async def media_response(attachment_id: int, request: Request) -> Response:
    row = await DB.fetchrow(
        """
        SELECT id, filename, size_bytes, content_type, sha256
        FROM attachments WHERE id = $1 AND message_id IS NOT NULL
        """,
        attachment_id,
    )
    if row is None:
        raise not_found()

    headers = safety_headers(row)
    size = int(row["size_bytes"])

    if_none_match = request.headers.get("if-none-match", "")
    tags = {tag.strip() for tag in if_none_match.split(",") if tag.strip()}
    if headers["ETag"] in tags or "*" in tags:
        return Response(status_code=304, headers=headers)

    range_header = request.headers.get("range")
    if range_header:
        span = parse_range(range_header, size)
        if span is None:
            return error_response(
                416,
                "range_not_satisfiable",
                None,
                {**headers, "Content-Range": f"bytes */{size}"},
            )
        start, end = span
        return StreamingResponse(
            _stream(attachment_id, start, end),
            status_code=206,
            media_type=row["content_type"],
            headers={
                **headers,
                "Accept-Ranges": "bytes",
                "Content-Length": str(end - start + 1),
                "Content-Range": f"bytes {start}-{end}/{size}",
            },
        )

    if size == 0:
        return Response(
            b"",
            status_code=200,
            media_type=row["content_type"],
            headers={**headers, "Accept-Ranges": "bytes", "Content-Length": "0"},
        )
    return StreamingResponse(
        _stream(attachment_id, 0, size - 1),
        status_code=200,
        media_type=row["content_type"],
        headers={**headers, "Accept-Ranges": "bytes", "Content-Length": str(size)},
    )
