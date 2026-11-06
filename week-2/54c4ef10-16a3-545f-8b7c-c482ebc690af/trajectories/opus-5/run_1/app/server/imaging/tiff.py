"""TIFF reading: every published file check, then the pixels at full bit depth."""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass

import numpy as np

LITTLE_ENDIAN_SIGNATURE = b"II*\x00"
BIG_ENDIAN_SIGNATURE = b"MM\x00*"

TAG_IMAGE_WIDTH = 256
TAG_IMAGE_LENGTH = 257
TAG_BITS_PER_SAMPLE = 258
TAG_COMPRESSION = 259
TAG_PHOTOMETRIC = 262
TAG_STRIP_OFFSETS = 273
TAG_SAMPLES_PER_PIXEL = 277
TAG_ROWS_PER_STRIP = 278
TAG_STRIP_BYTE_COUNTS = 279
TAG_PLANAR_CONFIG = 284
TAG_TILE_WIDTH = 322
TAG_TILE_LENGTH = 323
TAG_TILE_OFFSETS = 324
TAG_TILE_BYTE_COUNTS = 325
TAG_PREDICTOR = 317
TAG_SAMPLE_FORMAT = 339

COMPRESSION_NONE = (1,)
COMPRESSION_LZW = (5,)
COMPRESSION_DEFLATE = (8, 32946)

_TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8}


class TiffError(Exception):
    """A published TIFF refusal. `kind` names the field message to publish."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


@dataclass(frozen=True)
class TiffDirectory:
    endian: str
    tags: dict[int, list[int]]

    def first(self, tag: int, default: int | None = None) -> int | None:
        values = self.tags.get(tag)
        if not values:
            return default
        return values[0]

    @property
    def width(self) -> int:
        value = self.first(TAG_IMAGE_WIDTH)
        if value is None:
            raise TiffError("unreadable")
        return value

    @property
    def height(self) -> int:
        value = self.first(TAG_IMAGE_LENGTH)
        if value is None:
            raise TiffError("unreadable")
        return value

    @property
    def channels(self) -> int:
        return self.first(TAG_SAMPLES_PER_PIXEL, 1) or 1

    @property
    def bit_depth(self) -> int:
        depths = self.tags.get(TAG_BITS_PER_SAMPLE) or [1]
        if len(set(depths)) != 1:
            raise TiffError("pixel_format")
        return depths[0]


def read_first_directory(data: bytes) -> TiffDirectory:
    """Read the first image directory; it must lie inside the file."""
    if len(data) < 8:
        raise TiffError("unreadable")
    if data[:4] == LITTLE_ENDIAN_SIGNATURE:
        endian = "<"
    elif data[:4] == BIG_ENDIAN_SIGNATURE:
        endian = ">"
    else:
        raise TiffError("unreadable")
    offset = struct.unpack(endian + "I", data[4:8])[0]
    return _read_directory(data, endian, offset)[0]


def _read_directory(
    data: bytes, endian: str, offset: int
) -> tuple[TiffDirectory, int]:
    if offset <= 0 or offset + 2 > len(data):
        raise TiffError("unreadable")
    count = struct.unpack(endian + "H", data[offset : offset + 2])[0]
    end = offset + 2 + count * 12
    if end + 4 > len(data):
        raise TiffError("unreadable")
    tags: dict[int, list[int]] = {}
    for i in range(count):
        entry = offset + 2 + i * 12
        tag, field_type, value_count = struct.unpack(
            endian + "HHI", data[entry : entry + 8]
        )
        tags[tag] = _read_values(data, endian, field_type, value_count, entry + 8)
    next_offset = struct.unpack(endian + "I", data[end : end + 4])[0]
    return TiffDirectory(endian, tags), next_offset


def _read_values(
    data: bytes, endian: str, field_type: int, count: int, value_offset: int
) -> list[int]:
    size = _TYPE_SIZES.get(field_type)
    if size is None:
        return []
    total = size * count
    if total > 4:
        pointer = struct.unpack(endian + "I", data[value_offset : value_offset + 4])[0]
        if pointer + total > len(data):
            raise TiffError("unreadable")
        raw = data[pointer : pointer + total]
    else:
        raw = data[value_offset : value_offset + total]
    codes = {1: "B", 2: "B", 3: "H", 4: "I", 6: "b", 7: "B", 8: "h", 9: "i"}
    code = codes.get(field_type)
    if code is None:
        return []
    return list(struct.unpack(f"{endian}{count}{code}", raw))


def check_layout(data: bytes) -> TiffDirectory:
    """Pixel format and layout checks, in the published order."""
    directory = read_first_directory(data)
    _check_pixel_format(directory)
    _check_single_striped_image(data, directory)
    return directory


def _check_pixel_format(directory: TiffDirectory) -> None:
    if directory.bit_depth not in (8, 16):
        raise TiffError("pixel_format")
    photometric = directory.first(TAG_PHOTOMETRIC, 1)
    channels = directory.channels
    if photometric == 1:
        if channels not in (1, 2):
            raise TiffError("pixel_format")
    elif photometric == 2:
        if channels not in (3, 4):
            raise TiffError("pixel_format")
    else:
        raise TiffError("pixel_format")
    sample_formats = directory.tags.get(TAG_SAMPLE_FORMAT) or [1]
    if any(value != 1 for value in sample_formats):
        raise TiffError("pixel_format")
    if directory.first(TAG_PREDICTOR, 1) == 3:
        raise TiffError("pixel_format")


def _check_single_striped_image(data: bytes, directory: TiffDirectory) -> None:
    endian = directory.endian
    offset = struct.unpack(endian + "I", data[4:8])[0]
    seen = [offset]
    next_offset = _read_directory(data, endian, offset)[1]
    while next_offset:
        if next_offset in seen:
            raise TiffError("unreadable")
        seen.append(next_offset)
        next_offset = _read_directory(data, endian, next_offset)[1]
    if len(seen) > 1:
        raise TiffError("tiff_layout")
    tile_tags = (
        TAG_TILE_WIDTH,
        TAG_TILE_LENGTH,
        TAG_TILE_OFFSETS,
        TAG_TILE_BYTE_COUNTS,
    )
    if any(tag in directory.tags for tag in tile_tags):
        raise TiffError("tiff_layout")
    compression = directory.first(TAG_COMPRESSION, 1)
    if compression not in COMPRESSION_NONE + COMPRESSION_LZW + COMPRESSION_DEFLATE:
        raise TiffError("tiff_layout")
    predictor = directory.first(TAG_PREDICTOR, 1)
    if predictor == 2 and compression in COMPRESSION_NONE:
        raise TiffError("tiff_layout")


def bytes_per_row(directory: TiffDirectory) -> int:
    return -(-(directory.width * directory.channels * directory.bit_depth) // 8)


def decode_samples(data: bytes) -> tuple[TiffDirectory, np.ndarray]:
    """Decode to a (height, width, channels) array at the file's own bit depth."""
    directory = check_layout(data)
    width, height = directory.width, directory.height
    channels, depth = directory.channels, directory.bit_depth
    if (directory.first(TAG_PLANAR_CONFIG, 1) or 1) != 1:
        raise TiffError("unreadable")
    offsets = directory.tags.get(TAG_STRIP_OFFSETS) or []
    counts = directory.tags.get(TAG_STRIP_BYTE_COUNTS) or []
    if not offsets or len(offsets) != len(counts):
        raise TiffError("unreadable")
    for offset, count in zip(offsets, counts):
        if offset < 0 or count < 0 or offset + count > len(data):
            raise TiffError("unreadable")
    compression = directory.first(TAG_COMPRESSION, 1)
    row_bytes = bytes_per_row(directory)
    if compression in COMPRESSION_NONE and sum(counts) < height * row_bytes:
        raise TiffError("unreadable")
    blocks: list[bytes] = []
    for offset, count in zip(offsets, counts):
        chunk = data[offset : offset + count]
        if compression in COMPRESSION_LZW:
            chunk = _lzw_decode(chunk)
        elif compression in COMPRESSION_DEFLATE:
            try:
                chunk = zlib.decompress(chunk)
            except zlib.error as exc:
                raise TiffError("unreadable") from exc
        blocks.append(chunk)

    raw = b"".join(blocks)
    if len(raw) < height * row_bytes:
        raise TiffError("unreadable")
    flat = np.frombuffer(raw[: height * row_bytes], dtype=np.uint8).reshape(
        height, row_bytes
    )
    if depth == 16:
        pairs = flat.reshape(height, width, channels, 2).astype(np.uint16)
        if directory.endian == "<":
            samples = (pairs[..., 1] << 8) | pairs[..., 0]
        else:
            samples = (pairs[..., 0] << 8) | pairs[..., 1]
    else:
        samples = flat.reshape(height, width, channels)
    if directory.first(TAG_PREDICTOR, 1) == 2:
        samples = _undo_horizontal_differencing(samples, depth)
    return directory, samples


def _undo_horizontal_differencing(samples: np.ndarray, depth: int) -> np.ndarray:
    modulus = 1 << depth
    out = np.cumsum(samples.astype(np.int64), axis=1) % modulus
    return out.astype(np.uint16 if depth == 16 else np.uint8)


def _lzw_decode(data: bytes) -> bytes:
    out = bytearray()
    table: list[bytes] = [bytes([i]) for i in range(256)] + [b"", b""]
    old: bytes | None = None
    code_width = 9
    bit_position = 0
    total_bits = len(data) * 8
    while bit_position + code_width <= total_bits:
        byte_index = bit_position // 8
        chunk = data[byte_index : byte_index + 3].ljust(3, b"\x00")
        window = (chunk[0] << 16) | (chunk[1] << 8) | chunk[2]
        shift = 24 - (bit_position % 8) - code_width
        code = (window >> shift) & ((1 << code_width) - 1)
        bit_position += code_width
        if code == 256:
            table = [bytes([i]) for i in range(256)] + [b"", b""]
            code_width = 9
            old = None
            continue
        if code == 257:
            break
        if code < len(table) and (code < 256 or table[code]):
            entry = table[code]
        elif old is not None:
            entry = old + old[:1]
        else:
            raise TiffError("unreadable")
        out += entry
        if old is not None:
            table.append(old + entry[:1])
        old = entry
        if len(table) + 1 >= (1 << code_width) and code_width < 12:
            code_width += 1
    return bytes(out)
