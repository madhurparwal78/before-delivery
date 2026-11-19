"""Media probing: content type, pixel size and duration read from bytes only."""
from __future__ import annotations

import struct
from typing import Optional


def sniff_content_type(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:4] == b"\x1aE\xdf\xa3" and _ebml_doctype_is_webm(data):
        return "video/webm"
    return "application/octet-stream"


def _ebml_doctype_is_webm(data: bytes) -> bool:
    # Minimal EBML header parse: find the DocType element and read its string value.
    pos = 0
    end = min(len(data), 4096)
    limit = end
    id_info = _read_element_id(data, pos)
    if id_info is None or id_info[1] != 0x1A45DFA3:
        return False
    pos = id_info[0]
    size_info = _read_vint(data, pos)
    if size_info is None:
        return False
    body_end = min(size_info[0] + size_info[1], limit)
    pos = size_info[0]
    while pos < body_end:
        id_info2 = _read_element_id(data, pos)
        size_info2 = _read_vint(data, id_info2[0]) if id_info2 else None
        if id_info2 is None or size_info2 is None:
            return False
        if id_info2[1] == 0x4282:  # DocType
            value = data[size_info2[0]:size_info2[0] + size_info2[1]]
            return value == b"webm"
        pos = size_info2[0] + size_info2[1]
    return False


def _read_vint(data: bytes, pos: int) -> Optional[tuple[int, int]]:
    """Read one EBML size vint: return (end_pos, value) with marker bits removed."""
    if pos >= len(data):
        return None
    first = data[pos]
    if first == 0:
        return None
    length = 1
    mask = 0x80
    while not (first & mask):
        mask >>= 1
        length += 1
        if length > 8:
            return None
    value = first & (0xFF >> length)
    for i in range(1, length):
        if pos + i >= len(data):
            return None
        value = (value << 8) | data[pos + i]
    return pos + length, value


def _read_element_id(data: bytes, pos: int) -> Optional[tuple[int, int]]:
    """Read an EBML element id: marker bits stay part of the id."""
    if pos >= len(data):
        return None
    first = data[pos]
    if first == 0:
        return None
    length = 1
    mask = 0x80
    while not (first & mask):
        mask >>= 1
        length += 1
        if length > 8:
            return None
    value = 0
    for i in range(length):
        if pos + i >= len(data):
            return None
        value = (value << 8) | data[pos + i]
    return pos + length, value


def png_size(data: bytes) -> tuple[Optional[int], Optional[int]]:
    if len(data) < 24:
        return None, None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def gif_size(data: bytes) -> tuple[Optional[int], Optional[int]]:
    if len(data) < 10:
        return None, None
    width, height = struct.unpack("<HH", data[6:10])
    return width, height


def jpeg_size(data: bytes) -> tuple[Optional[int], Optional[int]]:
    """First start-of-frame; Exif orientation 5-8 swaps the reported size."""
    pos = 2
    width = height = None
    orientation = 1
    sof_scanned = False
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            pos += 1
            continue
        marker = data[pos + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            pos += 2
            continue
        if pos + 4 > len(data):
            break
        seg_len = struct.unpack(">H", data[pos + 2:pos + 4])[0]
        if seg_len < 2:
            break
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if pos + 9 <= len(data):
                height = struct.unpack(">H", data[pos + 5:pos + 7])[0]
                width = struct.unpack(">H", data[pos + 7:pos + 9])[0]
                sof_scanned = True
                break
            break
        if marker == 0xE1 and data[pos + 4:pos + 10] == b"Exif\x00\x00":
            orientation = _jpeg_exif_orientation(data[pos + 10:pos + 2 + seg_len]) or 1
        pos += 2 + seg_len
    if not sof_scanned:
        return None, None
    if orientation in (5, 6, 7, 8):
        return height, width
    return width, height


def _jpeg_exif_orientation(exif: bytes) -> Optional[int]:
    if len(exif) < 8:
        return None
    order = exif[0:2]
    if order == b"II":
        endian = "<"
    elif order == b"MM":
        endian = ">"
    else:
        return None
    ifd_offset = struct.unpack(endian + "I", exif[4:8])[0]
    if ifd_offset + 2 > len(exif):
        return None
    count = struct.unpack(endian + "H", exif[ifd_offset:ifd_offset + 2])[0]
    base = ifd_offset + 2
    for i in range(count):
        entry = exif[base + i * 12: base + (i + 1) * 12]
        if len(entry) < 12:
            return None
        tag, _typ, _cnt = struct.unpack(endian + "HHI", entry[0:8])
        if tag == 274:
            value = struct.unpack(endian + "H", entry[8:10])[0]
            return value
    return None


def webp_size(data: bytes) -> tuple[Optional[int], Optional[int]]:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None, None
    chunk = data[12:16]
    if chunk == b"VP8 ":
        # lossy: 3 frame tags then start code then 14 bytes of size info
        frame = data[20:]
        if len(frame) < 10:
            return None, None
        width = struct.unpack("<H", frame[6:8])[0] & 0x3FFF
        height = struct.unpack("<H", frame[8:10])[0] & 0x3FFF
        return width, height
    if chunk == b"VP8L":
        frame = data[21:]
        if len(frame) < 4:
            return None, None
        bits = struct.unpack("<I", frame[0:4])[0]
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height
    if chunk == b"VP8X":
        if len(data) < 30:
            return None, None
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return width, height
    return None, None


def webm_size_duration(data: bytes) -> tuple[Optional[int], Optional[int], Optional[int]]:
    """PixelWidth/PixelHeight of the first video track, plus segment Duration."""
    size = _webm_track_size(data)
    duration = _webm_duration(data)
    return size[0], size[1], duration


def _read_vint_value(data: bytes, pos: int) -> Optional[tuple[int, int]]:
    if pos >= len(data):
        return None
    first = data[pos]
    if first == 0:
        return None
    length = 1
    mask = 0x80
    while not (first & mask) and mask > 1:
        mask >>= 1
        length += 1
    value = first & (mask - 1)
    for i in range(1, length):
        if pos + i >= len(data):
            return None
        value = (value << 8) | data[pos + i]
    return pos + length, value


def _find_ebml_element(data: bytes, pos: int, end: int) -> list:
    """Return a list of (code, value_pos, size, next_pos) inside [pos, end)."""
    out = []
    while pos < end:
        id_info = _read_element_id(data, pos)
        if id_info is None or id_info[1] == 0:
            break
        code, code_len = id_info[1], id_info[0] - pos
        size_info = _read_vint(data, id_info[0])
        if size_info is None:
            break
        value_pos = size_info[0]
        size = size_info[1]
        if size == 0:
            # unknown size: treat as the rest of the buffer
            size = end - value_pos
        out.append((code, value_pos, size, value_pos + size))
        pos = value_pos + size
        if size <= 0:
            break
    return out


def _webm_track_size(data: bytes) -> tuple[Optional[int], Optional[int]]:
    """PixelWidth/PixelHeight of the first video track, wherever it sits."""
    try:
        for code, vpos, size, _next in _find_ebml_element(data, 0, min(len(data), 1 << 22)):
            if code != 0x18538067:  # Segment
                continue
            for c2, p2, s2, _n2 in _find_ebml_element(data, vpos, vpos + size):
                if c2 != 0x1654AE6B:  # Tracks
                    continue
                for c3, p3, s3, _n3 in _find_ebml_element(data, p2, p2 + s2):
                    if c3 != 0xAE:  # TrackEntry
                        continue
                    track_type = None
                    width = height = None
                    for c4, p4, s4, _n4 in _find_ebml_element(data, p3, p3 + s3):
                        if c4 == 0x83:
                            raw = data[p4:p4 + s4]
                            track_type = raw[-1] if raw else None
                        elif c4 == 0xB0:
                            width = _read_uint(data, p4, s4)
                        elif c4 == 0xBA:
                            height = _read_uint(data, p4, s4)
                        elif c4 == 0xE0:  # Video: PixelWidth/PixelHeight nest here
                            for c5, p5, s5, _n5 in _find_ebml_element(data, p4, p4 + s4):
                                if c5 == 0xB0:
                                    width = _read_uint(data, p5, s5)
                                elif c5 == 0xBA:
                                    height = _read_uint(data, p5, s5)
                    if track_type == 1 and width and height:
                        return width, height
    except Exception:
        return None, None
    return None, None


def _read_uint(data: bytes, pos: int, size: int) -> Optional[int]:
    if pos + size > len(data):
        return None
    return int.from_bytes(data[pos:pos + size], "big")


def _webm_duration(data: bytes) -> Optional[int]:
    try:
        for code, vpos, size, _next in _find_ebml_element(data, 0, min(len(data), 1 << 22)):
            if code == 0x18538067:  # Segment
                for c2, p2, s2, _n2 in _find_ebml_element(data, vpos, vpos + size):
                    if c2 == 0x1549A966:  # Info
                        duration = None
                        scale = 1_000_000
                        for c3, p3, s3, _n3 in _find_ebml_element(data, p2, p2 + s2):
                            if c3 == 0x4489:  # Duration
                                raw = _read_float(data, p3, s3)
                                if raw is not None:
                                    duration = raw
                            elif c3 == 0x2AD7B1:  # TimecodeScale
                                scale = _read_uint(data, p3, s3) or 1_000_000
                        if duration is None:
                            return None
                        return int(round(duration * scale / 1_000_000))
    except Exception:
        return None
    return None


def _read_float(data: bytes, pos: int, size: int) -> Optional[float]:
    import struct as _s
    if pos + size > len(data) or size not in (4, 8):
        return None
    if size == 4:
        return _s.unpack(">f", data[pos:pos + 4])[0]
    return _s.unpack(">d", data[pos:pos + 8])[0]
