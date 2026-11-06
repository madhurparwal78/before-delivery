"""PNG decoding: chunk rules, filters, Adam7 and the published stream checks."""
from __future__ import annotations

import struct
import zlib
from typing import TYPE_CHECKING

import numpy as np

from .base import (MSG_PIXEL_FORMAT, MSG_UNREADABLE, DecodedScan, ScanRefused,
                   check_dimensions)

if TYPE_CHECKING:
    from numpy.typing import NDArray

ADAM7 = ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
         (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2))
CHANNELS_BY_COLOUR_TYPE = {0: 1, 2: 3, 4: 2, 6: 4}
TEXT_CHUNKS = (b"zTXt", b"iTXt", b"iCCP")


def decode_png(data: bytes) -> DecodedScan:
    width, height, bit_depth, colour_type, interlace = _read_header(data)
    _check_pixel_format(bit_depth, colour_type)
    idat, transfer, gamma = _read_chunks(data)
    channels = CHANNELS_BY_COLOUR_TYPE[colour_type]
    sample_bytes = bit_depth // 8
    bytes_per_row = (width * channels * bit_depth + 7) // 8
    expected = implied_bytes(width, height, channels, bit_depth, interlace)
    raw = _inflate_at_most(b"".join(idat), expected)
    if len(raw) != expected:
        raise ScanRefused(MSG_UNREADABLE)
    if interlace == 1:
        codes = _deinterlace(raw, width, height, channels, sample_bytes)
    else:
        flat = _unfilter(raw, height, bytes_per_row, channels, sample_bytes)
        codes = _unpack_samples(flat, sample_bytes).reshape(height, width, channels)
    return DecodedScan(codes=codes, transfer=transfer, gamma=gamma)


def implied_bytes(width: int, height: int, channels: int, bit_depth: int,
                  interlace: int) -> int:
    """The byte count the header implies, filter bytes included.

    bytes per row = ceil(width × channels × bit depth / 8).
    """
    bytes_per_row = (width * channels * bit_depth + 7) // 8
    if interlace == 0:
        return height * (1 + bytes_per_row)
    total = 0
    for x_start, y_start, x_step, y_step in ADAM7:
        pass_width = 0 if width <= x_start else (width - x_start + x_step - 1) // x_step
        pass_height = 0 if height <= y_start else (height - y_start + y_step - 1) // y_step
        if pass_width and pass_height:
            pass_row = (pass_width * channels * bit_depth + 7) // 8
            total += pass_height * (1 + pass_row)
    return total


def _inflate_at_most(compressed: bytes, limit: int) -> bytes:
    """Inflate up to limit + 1 bytes so oversize streams are caught."""
    decompressor = zlib.decompressobj()
    try:
        out = decompressor.decompress(compressed, limit + 1)
    except zlib.error:
        raise ScanRefused(MSG_UNREADABLE) from None
    if len(out) > limit or decompressor.unconsumed_tail:
        raise ScanRefused(MSG_UNREADABLE)
    try:
        out += decompressor.flush()
    except zlib.error:
        raise ScanRefused(MSG_UNREADABLE) from None
    if len(out) > limit:
        raise ScanRefused(MSG_UNREADABLE)
    return out


def _read_header(data: bytes) -> tuple[int, int, int, int, int]:
    if len(data) < 8 + 8 + 13 + 4:
        raise ScanRefused(MSG_UNREADABLE)
    offset = 8
    length = struct.unpack(">I", data[offset:offset + 4])[0]
    chunk_type = data[offset + 4:offset + 8]
    if length != 13 or chunk_type != b"IHDR":
        raise ScanRefused(MSG_UNREADABLE)
    chunk = data[offset + 8:offset + 21]
    crc = struct.unpack(">I", data[offset + 21:offset + 25])[0]
    if crc != zlib.crc32(b"IHDR" + chunk) & 0xFFFFFFFF:
        raise ScanRefused(MSG_UNREADABLE)
    width, height, bit_depth, colour_type, compression, filter_method, interlace = (
        struct.unpack(">IIBBBBB", chunk))
    if compression != 0 or filter_method != 0 or interlace not in (0, 1):
        raise ScanRefused(MSG_UNREADABLE)
    check_dimensions(width, height)
    return width, height, bit_depth, colour_type, interlace


def _check_pixel_format(bit_depth: int, colour_type: int) -> None:
    if colour_type == 3 or bit_depth not in (8, 16) or colour_type not in CHANNELS_BY_COLOUR_TYPE:
        raise ScanRefused(MSG_PIXEL_FORMAT)


def _read_chunks(data: bytes) -> tuple[list[bytes], str, float | None]:
    idat: list[bytes] = []
    idat_done = False
    saw_srgb = False
    gamma: float | None = None
    offset = 8 + 25
    while offset + 8 <= len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        chunk_type = data[offset + 4:offset + 8]
        start = offset + 8
        end = start + length
        if end + 4 > len(data):
            raise ScanRefused(MSG_UNREADABLE)
        chunk = data[start:end]
        if struct.unpack(">I", data[end:end + 4])[0] != zlib.crc32(chunk_type + chunk) & 0xFFFFFFFF:
            raise ScanRefused(MSG_UNREADABLE)
        if chunk_type == b"IDAT":
            if idat_done:
                raise ScanRefused(MSG_UNREADABLE)
            idat.append(chunk)
        else:
            if idat:
                idat_done = True
            if chunk_type == b"sRGB":
                saw_srgb = True
            elif chunk_type == b"gAMA" and length == 4:
                gamma = struct.unpack(">I", chunk)[0] / 100000.0
            elif chunk_type in TEXT_CHUNKS:
                _check_text_chunk(chunk_type, chunk)
            elif chunk_type == b"IEND":
                break
        offset = end + 4
    if not idat:
        raise ScanRefused(MSG_UNREADABLE)
    if saw_srgb:
        return idat, "srgb", None
    if gamma is not None:
        if gamma <= 0:
            raise ScanRefused(MSG_UNREADABLE)
        return idat, "gamma", gamma
    return idat, "linear", None


def _check_text_chunk(chunk_type: bytes, chunk: bytes) -> None:
    """Refuse a compressed text or profile chunk that inflates past 1 MB."""
    if chunk_type == b"iTXt":
        parts = chunk.split(b"\x00", 3)
        if len(parts) < 4 or parts[1][0:1] != b"\x01":
            return
        compressed = parts[3][1:]
    else:
        parts = chunk.split(b"\x00", 1)
        compressed = parts[1][1:] if len(parts) > 1 else b""
    _inflate_at_most(compressed, 1_000_000)


def _unfilter(raw: bytes, height: int, bytes_per_row: int, channels: int,
              sample_bytes: int) -> NDArray[np.uint8]:
    """Undo the PNG filters; returns a flat sample byte array."""
    stride = 1 + bytes_per_row
    raw_arr = np.frombuffer(raw, dtype=np.uint8)
    if raw_arr.size < height * stride:
        raise ScanRefused(MSG_UNREADABLE)
    rows = raw_arr[:height * stride].reshape(height, stride)
    bpp = channels * sample_bytes
    out = np.empty((height, bytes_per_row), dtype=np.uint8)
    previous = np.zeros(bytes_per_row, dtype=np.int64)
    for y in range(height):
        f = int(rows[y, 0])
        row = rows[y, 1:].astype(np.int64)
        if f == 1:
            for i in range(bpp, bytes_per_row):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif f == 2:
            row = (row + previous) & 0xFF
        elif f == 3:
            left = np.concatenate((np.zeros(bpp, dtype=np.int64), row[:-bpp]))
            row = (row + ((left + previous) >> 1)) & 0xFF
        elif f == 4:
            a = np.concatenate((np.zeros(bpp, dtype=np.int64), row[:-bpp]))
            b = previous
            c = np.concatenate((np.zeros(bpp, dtype=np.int64), previous[:-bpp]))
            p = a + b - c
            pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - c)
            pr = np.where(pa <= pb, np.where(pa <= pc, a, b), np.where(pb <= pc, b, c))
            row = (row + pr) & 0xFF
        elif f != 0:
            raise ScanRefused(MSG_UNREADABLE)
        out[y] = row.astype(np.uint8)
        previous = row
    return out.reshape(-1)


def _unpack_samples(flat: NDArray[np.uint8], sample_bytes: int) -> NDArray:
    if sample_bytes == 1:
        return flat
    pairs = flat.reshape(-1, 2)
    return (pairs[:, 0].astype(np.uint32) * 256 + pairs[:, 1].astype(np.uint32)).astype(np.uint16)


def _deinterlace(raw: bytes, width: int, height: int, channels: int,
                 sample_bytes: int) -> NDArray:
    dtype = np.uint16 if sample_bytes == 2 else np.uint8
    full = np.zeros((height, width, channels), dtype=dtype)
    offset = 0
    bit_depth = 16 if sample_bytes == 2 else 8
    for x_start, y_start, x_step, y_step in ADAM7:
        pass_width = 0 if width <= x_start else (width - x_start + x_step - 1) // x_step
        pass_height = 0 if height <= y_start else (height - y_start + y_step - 1) // y_step
        if pass_width == 0 or pass_height == 0:
            continue
        bytes_per_row = (pass_width * channels * bit_depth + 7) // 8
        expected = pass_height * (1 + bytes_per_row)
        block = raw[offset:offset + expected]
        if len(block) < expected:
            raise ScanRefused(MSG_UNREADABLE)
        flat = _unfilter(block, pass_height, bytes_per_row, channels, sample_bytes)
        samples = _unpack_samples(flat, sample_bytes)
        codes = samples.reshape(pass_height, pass_width, channels)
        ys = y_start + np.arange(pass_height) * y_step
        xs = x_start + np.arange(pass_width) * x_step
        full[np.ix_(ys, xs)] = codes
        offset += expected
    return full
