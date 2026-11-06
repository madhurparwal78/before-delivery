"""TIFF decoding: one striped image directory, uncompressed, LZW or Deflate."""
from __future__ import annotations

import struct
import zlib
from typing import TYPE_CHECKING

import numpy as np

from .base import (MSG_PIXEL_FORMAT, MSG_TIFF_LAYOUT, MSG_UNREADABLE,
                   DecodedScan, ScanRefused, check_dimensions)

if TYPE_CHECKING:
    from numpy.typing import NDArray

BYTE, ASCII, SHORT, LONG, RATIONAL = 1, 2, 3, 4, 5
TAG_WIDTH, TAG_HEIGHT, TAG_BITS = 256, 257, 258
TAG_COMPRESSION, TAG_PHOTOMETRIC, TAG_STRIPOFFSETS = 259, 262, 273
TAG_SAMPLES, TAG_ROWSPERSTRIP, TAG_STRIPBYTECOUNTS = 277, 278, 279
TAG_PREDICTOR, TAG_TILEWIDTH, TAG_TILELENGTH = 317, 322, 323
TAG_TILEOFFSETS, TAG_TILEBYTECOUNTS = 324, 325
TAG_SAMPLEFORMAT = 339

COMPRESSION_NONE, COMPRESSION_LZW = 1, 5
COMPRESSION_DEFLATE, COMPRESSION_DEFLATE_OLD = 8, 32946
PHOTOMETRIC_WHITE_IS_ZERO, PHOTOMETRIC_BLACK_IS_ZERO, PHOTOMETRIC_RGB = 0, 1, 2

_TYPE_SIZE = {BYTE: 1, ASCII: 1, SHORT: 2, LONG: 4, RATIONAL: 8}


class TiffEntries:
    """The values of one image directory, read on demand."""

    def __init__(self, data: bytes, little: bool, offset: int) -> None:
        self.data = data
        self.little = little
        self.values: dict[int, list[int]] = {}
        if offset + 2 > len(data):
            raise ScanRefused(MSG_UNREADABLE)
        count = self._u16(offset)
        pos = offset + 2
        if pos + 12 * count > len(data):
            raise ScanRefused(MSG_UNREADABLE)
        for _ in range(count):
            tag = self._u16(pos)
            field_type = self._u16(pos + 2)
            value_count = self._u32(pos + 4)
            size = _TYPE_SIZE.get(field_type)
            if size is None or value_count > 64_000_000:
                raise ScanRefused(MSG_UNREADABLE)
            byte_count = size * value_count
            if byte_count <= 4:
                inline = self.data[pos + 8:pos + 8 + byte_count]
                self.values[tag] = [int.from_bytes(inline[i * size:(i + 1) * size],
                                                    "little" if little else "big")
                                   for i in range(value_count)]
            else:
                value_offset = self._u32(pos + 8)
                if value_offset + byte_count > len(data):
                    raise ScanRefused(MSG_UNREADABLE)
                self.values[tag] = []
                for i in range(value_count):
                    at = value_offset + i * size
                    if size == 1:
                        self.values[tag].append(self.data[at])
                    elif size == 2:
                        self.values[tag].append(self._u16(at))
                    else:
                        self.values[tag].append(self._u32(at))
            pos += 12
        self.next_offset = self._u32(offset + 2 + 12 * count)

    def _u16(self, at: int) -> int:
        if at + 2 > len(self.data):
            raise ScanRefused(MSG_UNREADABLE)
        return struct.unpack("<H" if self.little else ">H", self.data[at:at + 2])[0]

    def _u32(self, at: int) -> int:
        if at + 4 > len(self.data):
            raise ScanRefused(MSG_UNREADABLE)
        return struct.unpack("<I" if self.little else ">I", self.data[at:at + 4])[0]

    def one(self, tag: int, default: int | None = None) -> int | None:
        values = self.values.get(tag)
        if not values:
            return default
        return values[0]

    def many(self, tag: int, count: int) -> list[int]:
        values = self.values.get(tag)
        if not values or len(values) != count:
            raise ScanRefused(MSG_UNREADABLE)
        return values


def decode_tiff(data: bytes) -> DecodedScan:
    little = data[:2] == b"II"
    if not little and data[:2] != b"MM":
        raise ScanRefused(MSG_UNREADABLE)
    first_offset = _u32(data, little, 4)
    entries = TiffEntries(data, little, first_offset)
    _reject_multiple_directories(data, little, first_offset, entries)
    width = entries.one(TAG_WIDTH)
    height = entries.one(TAG_HEIGHT)
    if width is None or height is None:
        raise ScanRefused(MSG_UNREADABLE)
    check_dimensions(width, height)
    _check_pixel_format(entries)
    _check_layout(entries)
    codes = _decode_strips(data, entries, width, height)
    return DecodedScan(codes=codes, transfer="linear", gamma=None)


def _u32(data: bytes, little: bool, at: int) -> int:
    if at + 4 > len(data):
        raise ScanRefused(MSG_UNREADABLE)
    return struct.unpack("<I" if little else ">I", data[at:at + 4])[0]


def _reject_multiple_directories(data: bytes, little: bool, first_offset: int,
                                  entries: TiffEntries) -> None:
    """A second directory, or a chain that cycles, refuses the scan."""
    offset = entries.next_offset
    if offset == 0:
        return
    seen = {first_offset}
    while offset != 0:
        if offset in seen:
            raise ScanRefused(MSG_UNREADABLE)
        seen.add(offset)
        directory = TiffEntries(data, little, offset)
        offset = directory.next_offset
    raise ScanRefused(MSG_TIFF_LAYOUT)


def _check_pixel_format(entries: TiffEntries) -> None:
    bits = entries.one(TAG_BITS)
    if bits not in (8, 16):
        raise ScanRefused(MSG_PIXEL_FORMAT)
    photometric = entries.one(TAG_PHOTOMETRIC)
    if photometric is None:
        raise ScanRefused(MSG_UNREADABLE)
    if photometric not in (PHOTOMETRIC_BLACK_IS_ZERO, PHOTOMETRIC_RGB):
        raise ScanRefused(MSG_PIXEL_FORMAT)
    expected = 1 if photometric == PHOTOMETRIC_BLACK_IS_ZERO else 3
    samples = entries.one(TAG_SAMPLES, expected)
    if samples not in (expected, expected + 1):
        raise ScanRefused(MSG_PIXEL_FORMAT)
    sample_format = entries.one(TAG_SAMPLEFORMAT)
    if sample_format is not None and sample_format != 1:
        raise ScanRefused(MSG_PIXEL_FORMAT)


def _check_layout(entries: TiffEntries) -> None:
    for tile_tag in (TAG_TILEWIDTH, TAG_TILELENGTH, TAG_TILEOFFSETS, TAG_TILEBYTECOUNTS):
        if tile_tag in entries.values:
            raise ScanRefused(MSG_TIFF_LAYOUT)
    compression = entries.one(TAG_COMPRESSION, COMPRESSION_NONE)
    if compression not in (COMPRESSION_NONE, COMPRESSION_LZW, COMPRESSION_DEFLATE,
                           COMPRESSION_DEFLATE_OLD):
        raise ScanRefused(MSG_TIFF_LAYOUT)
    predictor = entries.one(TAG_PREDICTOR, 1)
    if predictor == 3:
        raise ScanRefused(MSG_PIXEL_FORMAT)
    if predictor == 2 and compression == COMPRESSION_NONE:
        raise ScanRefused(MSG_TIFF_LAYOUT)
    if entries.one(284, 1) != 1:
        raise ScanRefused(MSG_TIFF_LAYOUT)


def _decode_strips(data: bytes, entries: TiffEntries, width: int, height: int) -> NDArray:
    bits = entries.one(TAG_BITS)
    photometric = entries.one(TAG_PHOTOMETRIC)
    channels = 1 if photometric == PHOTOMETRIC_BLACK_IS_ZERO else 3
    samples = entries.one(TAG_SAMPLES, channels)
    rows_per_strip = entries.one(TAG_ROWSPERSTRIP, height)
    rows_per_strip = height if not rows_per_strip or rows_per_strip > height else max(rows_per_strip, 1)
    strip_count = (height + rows_per_strip - 1) // rows_per_strip
    offsets = entries.many(TAG_STRIPOFFSETS, strip_count)
    byte_counts = entries.many(TAG_STRIPBYTECOUNTS, strip_count)
    compression = entries.one(TAG_COMPRESSION, COMPRESSION_NONE)
    predictor = entries.one(TAG_PREDICTOR, 1)
    bytes_per_row = (width * samples * bits + 7) // 8
    dtype = np.dtype("<u2" if bits == 16 else "u1")
    out = np.zeros((height, width, samples), dtype=np.uint16 if bits == 16 else np.uint8)
    for strip in range(strip_count):
        y0 = strip * rows_per_strip
        rows = min(rows_per_strip, height - y0)
        if rows <= 0:
            break
        offset, byte_count = offsets[strip], byte_counts[strip]
        if offset + byte_count > len(data):
            raise ScanRefused(MSG_UNREADABLE)
        raw = data[offset:offset + byte_count]
        needed = rows * bytes_per_row
        if compression == COMPRESSION_NONE:
            if byte_count < needed:
                raise ScanRefused(MSG_UNREADABLE)
            pixels = raw[:needed]
        else:
            pixels = _decompress(compression, raw, needed, predictor, samples, bits, width)
            if len(pixels) < needed:
                raise ScanRefused(MSG_UNREADABLE)
        block = np.frombuffer(pixels[:needed], dtype=dtype)
        out[y0:y0 + rows] = block.reshape(rows, width, samples)
    return out


def _decompress(compression: int, raw: bytes, needed: int, predictor: int,
                samples: int, bits: int, width: int) -> bytes:
    if compression in (COMPRESSION_DEFLATE, COMPRESSION_DEFLATE_OLD):
        try:
            out = zlib.decompress(raw)
        except zlib.error:
            raise ScanRefused(MSG_UNREADABLE) from None
    else:
        out = _lzw(raw)
    if predictor == 2:
        out = _undo_horizontal_predictor(out, samples, bits, width, needed)
    return out


def _undo_horizontal_predictor(out: bytes, samples: int, bits: int, width: int,
                              needed: int) -> bytes:
    dtype = np.dtype("<u2" if bits == 16 else "u1")
    row_values = (width * samples * bits + 7) // 8 // dtype.itemsize
    rows = len(out) // dtype.itemsize // row_values
    if rows == 0:
        return out
    block = np.frombuffer(out[:rows * row_values * dtype.itemsize], dtype=dtype).copy()
    block = block.reshape(rows, row_values)
    mask = 0xFFFF if bits == 16 else 0xFF
    for i in range(samples, row_values):
        block[:, i] = (block[:, i] + block[:, i - samples]) & mask
    return block.tobytes()


def _lzw(raw: bytes) -> bytes:
    """TIFF LZW with early-change code-width growth."""
    out = bytearray()
    table = {i: bytes([i]) for i in range(256)}
    dict_size = 258
    bit_size = 9
    previous: bytes | None = None
    bit_pos = 0
    total_bits = len(raw) * 8
    while bit_pos + bit_size <= total_bits:
        at = bit_pos >> 3
        chunk = int.from_bytes(raw[at:at + 3].ljust(3, b"\x00"), "big")
        code = (chunk >> (24 - bit_size - (bit_pos & 7))) & ((1 << bit_size) - 1)
        bit_pos += bit_size
        if code == 256:
            table = {i: bytes([i]) for i in range(256)}
            dict_size = 258
            bit_size = 9
            previous = None
            continue
        if code == 257:
            break
        if code in table:
            entry = table[code]
            if previous is not None:
                table[dict_size] = previous + entry[:1]
                dict_size += 1
        elif code == dict_size and previous is not None:
            entry = previous + previous[:1]
            table[dict_size] = entry
            dict_size += 1
        else:
            raise ScanRefused(MSG_UNREADABLE)
        out += entry
        if dict_size + 1 >= (1 << bit_size) and bit_size < 12:
            bit_size += 1
        previous = entry
    return bytes(out)
