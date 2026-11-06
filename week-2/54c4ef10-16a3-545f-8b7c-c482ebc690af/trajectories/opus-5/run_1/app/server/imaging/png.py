"""PNG reading: every published file check, then the pixels at full bit depth."""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass

import numpy as np

SIGNATURE = b"\x89PNG\r\n\x1a\n"
TEXT_INFLATE_LIMIT = 1_000_000

_CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4}
_ADAM7 = (
    (0, 0, 8, 8),
    (4, 0, 8, 8),
    (0, 4, 4, 8),
    (2, 0, 4, 4),
    (0, 2, 2, 4),
    (1, 0, 2, 2),
    (0, 1, 1, 2),
)


class PngError(Exception):
    """A published PNG refusal. `kind` names the field message to publish."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


@dataclass(frozen=True)
class PngHeader:
    width: int
    height: int
    bit_depth: int
    colour_type: int
    interlaced: bool

    @property
    def channels(self) -> int:
        return _CHANNELS[self.colour_type]

    @property
    def bytes_per_pixel(self) -> int:
        return max(1, self.channels * self.bit_depth // 8)


def read_header(data: bytes) -> PngHeader:
    """Read IHDR, checking its length and CRC. Raises PngError('unreadable')."""
    if len(data) < 8 + 25 or data[:8] != SIGNATURE:
        raise PngError("unreadable")
    length, chunk_type = struct.unpack(">I4s", data[8:16])
    if chunk_type != b"IHDR" or length != 13:
        raise PngError("unreadable")
    body = data[16:29]
    stored_crc = struct.unpack(">I", data[29:33])[0]
    if zlib.crc32(b"IHDR" + body) & 0xFFFFFFFF != stored_crc:
        raise PngError("unreadable")
    width, height, bit_depth, colour_type, _comp, _filter, interlace = struct.unpack(
        ">IIBBBBB", body
    )
    return PngHeader(width, height, bit_depth, colour_type, interlace == 1)


def check_pixel_format(header: PngHeader) -> None:
    if header.colour_type not in _CHANNELS or header.bit_depth not in (8, 16):
        raise PngError("pixel_format")


def implied_raw_bytes(header: PngHeader) -> int:
    """The byte count the header implies for the decompressed image stream."""
    if not header.interlaced:
        row = _bytes_per_row(header.width, header)
        return header.height * (1 + row)
    total = 0
    for x_start, y_start, x_step, y_step in _ADAM7:
        pass_width = _pass_extent(header.width, x_start, x_step)
        pass_height = _pass_extent(header.height, y_start, y_step)
        if pass_width == 0 or pass_height == 0:
            continue
        total += pass_height * (1 + _bytes_per_row(pass_width, header))
    return total


def _pass_extent(size: int, start: int, step: int) -> int:
    if size <= start:
        return 0
    return -(-(size - start) // step)


def _bytes_per_row(width: int, header: PngHeader) -> int:
    return -(-(width * header.channels * header.bit_depth) // 8)


@dataclass(frozen=True)
class PngChunks:
    header: PngHeader
    idat: bytes
    transfer: str
    gamma: float | None


def read_chunks(data: bytes) -> PngChunks:
    """Walk every chunk, checking CRCs, IDAT order and text inflation limits."""
    header = read_header(data)
    offset = 8
    idat_parts: list[bytes] = []
    idat_closed = False
    saw_srgb = False
    gamma_value: int | None = None
    seen_end = False
    while offset + 8 <= len(data):
        length, chunk_type = struct.unpack(">I4s", data[offset : offset + 8])
        body_start = offset + 8
        body_end = body_start + length
        if body_end + 4 > len(data):
            raise PngError("unreadable")
        body = data[body_start:body_end]
        stored_crc = struct.unpack(">I", data[body_end : body_end + 4])[0]
        if zlib.crc32(chunk_type + body) & 0xFFFFFFFF != stored_crc:
            raise PngError("unreadable")
        if chunk_type == b"IDAT":
            if idat_closed:
                raise PngError("unreadable")
            idat_parts.append(body)
        else:
            if idat_parts:
                idat_closed = True
            if chunk_type == b"sRGB":
                saw_srgb = True
            elif chunk_type == b"gAMA" and length == 4:
                gamma_value = struct.unpack(">I", body)[0]
            elif chunk_type in (b"zTXt", b"iTXt", b"iCCP"):
                _check_text_inflation(chunk_type, body)
            elif chunk_type == b"IEND":
                seen_end = True
        offset = body_end + 4
        if seen_end:
            break
    if not idat_parts:
        raise PngError("unreadable")
    if saw_srgb:
        transfer, gamma = "srgb", None
    elif gamma_value:
        transfer, gamma = "gamma", gamma_value / 100000
    else:
        transfer, gamma = "linear", None
    return PngChunks(header, b"".join(idat_parts), transfer, gamma)


def _check_text_inflation(chunk_type: bytes, body: bytes) -> None:
    if chunk_type == b"iCCP":
        split = body.find(b"\x00")
        stream = body[split + 2 :] if split >= 0 else b""
    elif chunk_type == b"zTXt":
        split = body.find(b"\x00")
        stream = body[split + 2 :] if split >= 0 else b""
    else:
        parts = body.split(b"\x00", 2)
        if len(parts) < 3 or not parts[1][:1] == b"\x01":
            return
        stream = parts[2].split(b"\x00", 2)[-1]
    if not stream:
        return
    inflater = zlib.decompressobj()
    inflated = inflater.decompress(stream, TEXT_INFLATE_LIMIT + 1)
    if len(inflated) > TEXT_INFLATE_LIMIT:
        raise PngError("unreadable")


def inflate_image_data(chunks: PngChunks) -> bytes:
    """Inflate IDAT and insist on exactly the byte count the header implies."""
    implied = implied_raw_bytes(chunks.header)
    inflater = zlib.decompressobj()
    try:
        raw = inflater.decompress(chunks.idat, implied + 1)
    except zlib.error as exc:
        raise PngError("unreadable") from exc
    if len(raw) != implied:
        raise PngError("unreadable")
    return raw


def decode_samples(data: bytes) -> tuple[PngChunks, np.ndarray]:
    """Decode to a (height, width, channels) array at the file's own bit depth."""
    chunks = read_chunks(data)
    check_pixel_format(chunks.header)
    raw = inflate_image_data(chunks)
    header = chunks.header
    if header.interlaced:
        samples = _decode_interlaced(header, raw)
    else:
        samples = _decode_pass(header, raw, header.width, header.height)
    return chunks, samples


def _decode_interlaced(header: PngHeader, raw: bytes) -> np.ndarray:
    dtype = np.uint16 if header.bit_depth == 16 else np.uint8
    out = np.zeros((header.height, header.width, header.channels), dtype=dtype)
    offset = 0
    for x_start, y_start, x_step, y_step in _ADAM7:
        pass_width = _pass_extent(header.width, x_start, x_step)
        pass_height = _pass_extent(header.height, y_start, y_step)
        if pass_width == 0 or pass_height == 0:
            continue
        size = pass_height * (1 + _bytes_per_row(pass_width, header))
        block = _decode_pass(header, raw[offset : offset + size], pass_width, pass_height)
        offset += size
        out[y_start::y_step, x_start::x_step] = block
    return out


def _decode_pass(
    header: PngHeader, raw: bytes, width: int, height: int
) -> np.ndarray:
    row_bytes = _bytes_per_row(width, header)
    bpp = header.bytes_per_pixel
    rows = _unfilter(raw, height, row_bytes, bpp)
    flat = np.frombuffer(rows, dtype=np.uint8).reshape(height, row_bytes)
    if header.bit_depth == 16:
        values = flat.reshape(height, width, header.channels, 2).astype(np.uint16)
        return (values[..., 0] << 8) | values[..., 1]
    return flat.reshape(height, width, header.channels)


def _unfilter(raw: bytes, height: int, row_bytes: int, bpp: int) -> bytes:
    out = bytearray(height * row_bytes)
    previous = bytearray(row_bytes)
    source = memoryview(raw)
    for y in range(height):
        start = y * (row_bytes + 1)
        filter_type = source[start]
        line = bytearray(source[start + 1 : start + 1 + row_bytes])
        if filter_type == 0:
            pass
        elif filter_type == 1:
            _unfilter_sub(line, bpp)
        elif filter_type == 2:
            _unfilter_up(line, previous)
        elif filter_type == 3:
            _unfilter_average(line, previous, bpp)
        elif filter_type == 4:
            _unfilter_paeth(line, previous, bpp)
        else:
            raise PngError("unreadable")
        out[y * row_bytes : (y + 1) * row_bytes] = line
        previous = line
    return bytes(out)


def _unfilter_sub(line: bytearray, bpp: int) -> None:
    column = np.frombuffer(bytes(line), dtype=np.uint8).astype(np.int64)
    for offset in range(bpp):
        lane = np.cumsum(column[offset::bpp]) % 256
        line[offset::bpp] = bytes(lane.astype(np.uint8))


def _unfilter_up(line: bytearray, previous: bytearray) -> None:
    a = np.frombuffer(bytes(line), dtype=np.uint8)
    b = np.frombuffer(bytes(previous), dtype=np.uint8)
    line[:] = bytes((a + b).astype(np.uint8))


def _unfilter_average(line: bytearray, previous: bytearray, bpp: int) -> None:
    for i in range(len(line)):
        left = line[i - bpp] if i >= bpp else 0
        line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF


def _unfilter_paeth(line: bytearray, previous: bytearray, bpp: int) -> None:
    for i in range(len(line)):
        left = line[i - bpp] if i >= bpp else 0
        up = previous[i]
        upper_left = previous[i - bpp] if i >= bpp else 0
        estimate = left + up - upper_left
        da = abs(estimate - left)
        db = abs(estimate - up)
        dc = abs(estimate - upper_left)
        if da <= db and da <= dc:
            predictor = left
        elif db <= dc:
            predictor = up
        else:
            predictor = upper_left
        line[i] = (line[i] + predictor) & 0xFF
