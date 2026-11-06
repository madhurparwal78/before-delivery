"""PNG and TIFF scans: the published file checks, decoding to samples, linear values and 8-bit previews.

Every refusal is raised by an explicit check of one published rule (`RefusedFile` names which). Nothing
here touches the disk.
"""

import struct
import zlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
TIFF_SIGNATURES = (b"II*\x00", b"MM\x00*")
MIN_SIDE, MAX_WIDTH, MAX_HEIGHT, MAX_PIXELS = 64, 20_000, 4_000, 40_000_000
TEXT_INFLATE_LIMIT = 1_000_000
PREVIEW_SLICE_WIDTH = 2048
BLOCK_ROWS = 1024
CHUNK_ROWS = 128
ADAM7 = ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2))
PNG_COLOUR_SAMPLES = {0: 1, 2: 3, 4: 2, 6: 4}
TIFF_TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8}
TIFF_TYPE_FORMATS = {1: "B", 3: "H", 4: "I", 8: "h", 9: "i"}
TIFF_DEFLATE, TIFF_DEFLATE_ADOBE, TIFF_LZW, TIFF_NONE = 32946, 8, 5, 1
MAX_TIFF_DIRECTORIES = 10_000


class RefusedFile(Exception):
    """A scan the published rules refuse; `kind` is unsupported, dimensions, pixel_format, tiff_layout or unreadable."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


@dataclass(slots=True)
class DecodedImage:
    """A scan that passed every header check; `blocks()` decodes its samples."""

    format: str
    width: int
    height: int
    colour_samples: int
    samples: int
    depth: int
    transfer: str
    gamma: float | None
    reader: Callable[[], Iterator[tuple[int, np.ndarray]]]

    def blocks(self) -> Iterator[tuple[int, np.ndarray]]:
        """Yield (first row, samples shaped rows x width x samples) in row order, 8- or 16-bit unsigned."""
        return self.reader()


# --- linear values and previews -------------------------------------------------------------------------------


def linear_lut(transfer: str, gamma: float | None, depth: int) -> np.ndarray:
    """Linear value of every sample code, undoing the scan's own transfer (the one linearisation rule)."""
    maximum = 255 if depth == 8 else 65535
    c = np.arange(maximum + 1, dtype=np.float64) / maximum
    if transfer == "srgb":
        return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    if transfer == "gamma":
        return c ** (1 / gamma)
    return c


def linear_rows(image: DecodedImage, block: np.ndarray, lut: np.ndarray) -> np.ndarray:
    """Per-pixel mean of the colour channels' linear values (alpha ignored), float32 rows x width."""
    result = np.empty(block.shape[:2], dtype=np.float32)
    for first in range(0, len(block), CHUNK_ROWS):
        colour = block[first : first + CHUNK_ROWS, :, : image.colour_samples]
        result[first : first + CHUNK_ROWS] = lut[colour].mean(axis=2)
    return result


def preview_rows(image: DecodedImage, block: np.ndarray) -> np.ndarray:
    """8-bit greyscale display codes: colour codes averaged, 16-bit codes scaled, no transfer applied."""
    result = np.empty(block.shape[:2], dtype=np.uint8)
    for first in range(0, len(block), CHUNK_ROWS):
        grey = block[first : first + CHUNK_ROWS, :, : image.colour_samples].mean(axis=2)
        if image.depth == 16:
            grey = grey * 255 / 65535
        result[first : first + CHUNK_ROWS] = np.rint(grey)
    return result


def linear_image(image: DecodedImage) -> np.ndarray:
    """The whole scan as float32 linear values, rows x width."""
    lut = linear_lut(image.transfer, image.gamma, image.depth)
    result = np.empty((image.height, image.width), dtype=np.float32)
    for first, block in image.blocks():
        result[first : first + len(block)] = linear_rows(image, block, lut)
    return result


def preview_image(image: DecodedImage) -> np.ndarray:
    result = np.empty((image.height, image.width), dtype=np.uint8)
    for first, block in image.blocks():
        result[first : first + len(block)] = preview_rows(image, block)
    return result


def _png_chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def encode_grey_png(pixels: np.ndarray) -> bytes:
    """An 8-bit greyscale PNG with no colour chunks, so the browser draws the codes as they are."""
    height, width = pixels.shape
    rows = np.concatenate([np.zeros((height, 1), np.uint8), pixels], axis=1)
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return (PNG_SIGNATURE + _png_chunk(b"IHDR", header) + _png_chunk(b"IDAT", zlib.compress(rows.tobytes(), 3))
            + _png_chunk(b"IEND", b""))


def preview_slices(pixels: np.ndarray) -> list[bytes]:
    """Slices PREVIEW_SLICE_WIDTH wide (the last may be narrower), each covering the full scan height."""
    return [encode_grey_png(np.ascontiguousarray(pixels[:, left : left + PREVIEW_SLICE_WIDTH]))
            for left in range(0, pixels.shape[1], PREVIEW_SLICE_WIDTH)]


# --- entry point -----------------------------------------------------------------------------------------------


def open_image(data: bytes) -> DecodedImage:
    """Run the published file checks in order and return the image ready to decode."""
    if data.startswith(PNG_SIGNATURE):
        return _open_png(data)
    if data.startswith(TIFF_SIGNATURES):
        return _open_tiff(data)
    raise RefusedFile("unsupported")


def _check_dimensions(width: int, height: int) -> None:
    if not (MIN_SIDE <= width <= MAX_WIDTH and MIN_SIDE <= height <= MAX_HEIGHT and width * height <= MAX_PIXELS):
        raise RefusedFile("dimensions")


def _implied_row_bytes(width: int, samples: int, depth: int) -> int:
    return -(-width * samples * depth // 8)


# --- unfiltering -----------------------------------------------------------------------------------------------


def _unfilter(filters: np.ndarray, rows: np.ndarray, bpp: int) -> np.ndarray:
    """Reconstruct PNG scanlines. Pixels on one anti-diagonal are independent, so each diagonal is one numpy step."""
    height, row_bytes = rows.shape
    if not filters.any():
        return rows
    width = row_bytes // bpp
    raw = rows.reshape(height, width, bpp).astype(np.int16)
    padded = np.zeros((height + 1, width + 1, bpp), dtype=np.int16)
    for diagonal in range(width + height - 1):
        ys = np.arange(max(0, diagonal - width + 1), min(height - 1, diagonal) + 1)
        xs = diagonal - ys
        left, up, upper_left = padded[ys + 1, xs], padded[ys, xs + 1], padded[ys, xs]
        kind = filters[ys][:, None]
        estimate = left + up - upper_left
        distance_left, distance_up = np.abs(estimate - left), np.abs(estimate - up)
        distance_corner = np.abs(estimate - upper_left)
        paeth = np.where((distance_left <= distance_up) & (distance_left <= distance_corner), left,
                         np.where(distance_up <= distance_corner, up, upper_left))
        predicted = np.where(kind == 1, left, np.where(kind == 2, up, np.where(kind == 3, (left + up) >> 1,
                                                                             np.where(kind == 4, paeth, 0))))
        padded[ys + 1, xs + 1] = (raw[ys, xs] + predicted) & 255
    return padded[1:, 1:].astype(np.uint8).reshape(height, row_bytes)


def _samples_from_bytes(rows: np.ndarray, width: int, samples: int, depth: int, big_endian: bool) -> np.ndarray:
    """Bytes of unfiltered rows to rows x width x samples codes."""
    height = rows.shape[0]
    if depth == 8:
        return rows.reshape(height, width, samples)
    pairs = rows.reshape(height, width, samples, 2).astype(np.uint16)
    high, low = (0, 1) if big_endian else (1, 0)
    return (pairs[..., high] << 8) | pairs[..., low]


# --- PNG -------------------------------------------------------------------------------------------------------


def _open_png(data: bytes) -> DecodedImage:
    if len(data) < 33 or struct.unpack(">I", data[8:12])[0] != 13 or data[12:16] != b"IHDR":
        raise RefusedFile("unreadable")
    if struct.unpack(">I", data[29:33])[0] != zlib.crc32(data[12:29]):
        raise RefusedFile("unreadable")
    width, height, depth, colour, compression, filtering, interlace = struct.unpack(">IIBBBBB", data[16:29])
    _check_dimensions(width, height)
    if colour not in PNG_COLOUR_SAMPLES or depth not in (8, 16):
        raise RefusedFile("pixel_format")
    if compression != 0 or filtering != 0 or interlace not in (0, 1):
        raise RefusedFile("unreadable")
    samples = PNG_COLOUR_SAMPLES[colour]
    idat, srgb, gamma_value = _walk_png_chunks(data)
    transfer, gamma = "srgb" if srgb else "linear", None
    if not srgb and gamma_value is not None:
        if gamma_value == 0:
            raise RefusedFile("unreadable")
        transfer, gamma = "gamma", gamma_value / 100000

    def reader() -> Iterator[tuple[int, np.ndarray]]:
        yield from _png_blocks(idat, width, height, samples, depth, interlace == 1)

    return DecodedImage("png", width, height, 1 if samples < 3 else 3, samples, depth, transfer, gamma, reader)


def _bounded_inflate(compressed: bytes, limit: int) -> bytes:
    """Inflate at most `limit` bytes; one byte more than that means the stream is larger than allowed."""
    inflater = zlib.decompressobj()
    try:
        output = inflater.decompress(compressed, limit + 1)
    except zlib.error as error:
        raise RefusedFile("unreadable") from error
    return output


def _walk_png_chunks(data: bytes) -> tuple[bytes, bool, int | None]:
    """Check every chunk (CRC, consecutive IDAT, text inflate limit) and return IDAT bytes, sRGB seen, gAMA value."""
    position, idat, finished, srgb, gamma_value = 8, [], False, False, None
    last_was_idat, idat_ended = False, False
    while position < len(data) and not finished:
        if position + 12 > len(data):
            raise RefusedFile("unreadable")
        length, kind = struct.unpack(">I4s", data[position : position + 8])
        end = position + 8 + length
        if end + 4 > len(data):
            raise RefusedFile("unreadable")
        body = data[position + 8 : end]
        if struct.unpack(">I", data[end : end + 4])[0] != zlib.crc32(data[position + 4 : end]):
            raise RefusedFile("unreadable")
        if kind == b"IDAT":
            if idat_ended:
                raise RefusedFile("unreadable")
            idat.append(body)
        elif last_was_idat:
            idat_ended = True
        last_was_idat = kind == b"IDAT"
        if kind == b"sRGB":
            srgb = True
        elif kind == b"gAMA" and length == 4:
            gamma_value = struct.unpack(">I", body)[0]
        elif kind in (b"zTXt", b"iCCP", b"iTXt"):
            _check_compressed_text(kind, body)
        finished = kind == b"IEND"
        position = end + 4
    if not finished or not idat:
        raise RefusedFile("unreadable")
    return b"".join(idat), srgb, gamma_value


def _check_compressed_text(kind: bytes, body: bytes) -> None:
    """zTXt, iTXt and iCCP chunks may not inflate past TEXT_INFLATE_LIMIT bytes."""
    keyword_end = body.find(b"\x00")
    if keyword_end < 0:
        raise RefusedFile("unreadable")
    rest = body[keyword_end + 1 :]
    if kind == b"iTXt":
        if len(rest) < 2:
            raise RefusedFile("unreadable")
        compressed, rest = rest[0] == 1, rest[2:]
        for _ in range(2):
            separator = rest.find(b"\x00")
            if separator < 0:
                raise RefusedFile("unreadable")
            rest = rest[separator + 1 :]
        if not compressed:
            return
    else:
        rest = rest[1:]
    if len(_bounded_inflate(rest, TEXT_INFLATE_LIMIT)) > TEXT_INFLATE_LIMIT:
        raise RefusedFile("unreadable")


def _adam7_passes(width: int, height: int) -> list[tuple[int, int, int, int, int, int]]:
    """(x start, y start, x step, y step, pass width, pass height) for every non-empty Adam7 pass."""
    passes = []
    for x_start, y_start, x_step, y_step in ADAM7:
        pass_width = -(-(width - x_start) // x_step) if width > x_start else 0
        pass_height = -(-(height - y_start) // y_step) if height > y_start else 0
        if pass_width and pass_height:
            passes.append((x_start, y_start, x_step, y_step, pass_width, pass_height))
    return passes


def _png_blocks(idat: bytes, width: int, height: int, samples: int, depth: int,
                interlaced: bool) -> Iterator[tuple[int, np.ndarray]]:
    bpp = samples * depth // 8
    if interlaced:
        passes = _adam7_passes(width, height)
        sizes = [ph * (1 + _implied_row_bytes(pw, samples, depth)) for *_, pw, ph in passes]
    else:
        passes = [(0, 0, 1, 1, width, height)]
        sizes = [height * (1 + _implied_row_bytes(width, samples, depth))]
    inflated = _bounded_inflate(idat, sum(sizes))
    if len(inflated) != sum(sizes):
        raise RefusedFile("unreadable")
    stream = np.frombuffer(inflated, dtype=np.uint8)
    offset = 0
    image = np.zeros((height, width, samples), dtype=np.uint16 if depth == 16 else np.uint8) if interlaced else None
    for (x_start, y_start, x_step, y_step, pass_width, pass_height), size in zip(passes, sizes):
        scanlines = stream[offset : offset + size].reshape(pass_height, 1 + pass_width * bpp)
        offset += size
        for first in range(0, pass_height, BLOCK_ROWS):
            part = scanlines[first : first + BLOCK_ROWS]
            rows = _unfilter(part[:, 0], part[:, 1:], bpp)
            codes = _samples_from_bytes(rows, pass_width, samples, depth, big_endian=True)
            if image is None:
                yield first, codes
            else:
                image[y_start + first * y_step :: y_step, x_start::x_step][: len(codes)] = codes
    if image is not None:
        for first in range(0, height, BLOCK_ROWS):
            yield first, image[first : first + BLOCK_ROWS]


# --- TIFF ------------------------------------------------------------------------------------------------------


@dataclass(slots=True)
class _Directory:
    tags: dict[int, tuple[int, ...]]

    def one(self, tag: int, default: int | None = None) -> int | None:
        values = self.tags.get(tag)
        return values[0] if values else default


def _read_directory(data: bytes, offset: int, order: str) -> tuple[_Directory, int]:
    """Parse one image directory at `offset` and return it with the offset of the next one."""
    if offset < 8 or offset + 2 > len(data):
        raise RefusedFile("unreadable")
    count = struct.unpack_from(order + "H", data, offset)[0]
    end = offset + 2 + 12 * count
    if end + 4 > len(data):
        raise RefusedFile("unreadable")
    tags: dict[int, tuple[int, ...]] = {}
    for entry in range(count):
        tag, kind, items = struct.unpack_from(order + "HHI", data, offset + 2 + 12 * entry)
        size = TIFF_TYPE_SIZES.get(kind)
        if size is None or kind not in TIFF_TYPE_FORMATS:
            continue
        where = offset + 2 + 12 * entry + 8
        if size * items > 4:
            where = struct.unpack_from(order + "I", data, where)[0]
            if where + size * items > len(data):
                raise RefusedFile("unreadable")
        tags[tag] = struct.unpack_from(f"{order}{items}{TIFF_TYPE_FORMATS[kind]}", data, where)
    return _Directory(tags), struct.unpack_from(order + "I", data, end)[0]


def _directory_count(data: bytes, first: int, following: int, order: str) -> int:
    """How many distinct directories the chain holds; a chain that returns to an earlier directory is unreadable."""
    seen, count = {first}, 1
    while following and count <= MAX_TIFF_DIRECTORIES:
        if following in seen:
            raise RefusedFile("unreadable")
        seen.add(following)
        count += 1
        if following + 2 > len(data):
            raise RefusedFile("unreadable")
        entries = struct.unpack_from(order + "H", data, following)[0]
        if following + 2 + 12 * entries + 4 > len(data):
            raise RefusedFile("unreadable")
        following = struct.unpack_from(order + "I", data, following + 2 + 12 * entries)[0]
    return count


def _open_tiff(data: bytes) -> DecodedImage:
    order = "<" if data.startswith(b"II") else ">"
    first = struct.unpack_from(order + "I", data, 4)[0] if len(data) >= 8 else len(data)
    if first < 8 or first + 2 > len(data):
        raise RefusedFile("unreadable")
    directory, following = _read_directory(data, first, order)
    width, height = directory.one(256), directory.one(257)
    if width is None or height is None:
        raise RefusedFile("unreadable")
    _check_dimensions(width, height)
    samples = directory.one(277, 1)
    depths = directory.tags.get(258, (1,))
    photometric, sample_format = directory.one(262), directory.tags.get(339, (1,))
    colour_samples = {(1, 1): 1, (1, 2): 1, (2, 3): 3, (2, 4): 3}.get((photometric, samples))
    if (colour_samples is None or len(set(depths)) != 1 or depths[0] not in (8, 16)
            or any(value != 1 for value in sample_format)):
        raise RefusedFile("pixel_format")
    compression, predictor = directory.one(259, TIFF_NONE), directory.one(317, 1)
    if predictor == 3:
        raise RefusedFile("pixel_format")
    directories = _directory_count(data, first, following, order)
    if directories > 1 or 322 in directory.tags or 323 in directory.tags or 324 in directory.tags \
            or compression not in (TIFF_NONE, TIFF_LZW, TIFF_DEFLATE, TIFF_DEFLATE_ADOBE) \
            or (predictor == 2 and compression == TIFF_NONE):
        raise RefusedFile("tiff_layout")
    if predictor not in (1, 2) or directory.one(284, 1) != 1:
        raise RefusedFile("unreadable")
    offsets, counts = directory.tags.get(273), directory.tags.get(279)
    rows_per_strip = min(directory.one(278, height) or height, height)
    if offsets is None or counts is None or len(offsets) != len(counts) or len(offsets) != -(-height // rows_per_strip):
        raise RefusedFile("unreadable")
    if any(start + length > len(data) for start, length in zip(offsets, counts)):
        raise RefusedFile("unreadable")
    depth, row_bytes = depths[0], _implied_row_bytes(width, samples, depths[0])
    if compression == TIFF_NONE and sum(counts) < height * row_bytes:
        raise RefusedFile("unreadable")

    def reader() -> Iterator[tuple[int, np.ndarray]]:
        for strip, (start, length) in enumerate(zip(offsets, counts)):
            first = strip * rows_per_strip
            rows = min(rows_per_strip, height - first)
            raw = _tiff_strip_bytes(data[start : start + length], compression, rows * row_bytes)
            codes = _samples_from_bytes(np.frombuffer(raw, dtype=np.uint8).reshape(rows, row_bytes), width, samples,
                                        depth, big_endian=order == ">")
            if predictor == 2:
                codes = (np.cumsum(codes, axis=1, dtype=np.uint32) & (2**depth - 1)).astype(codes.dtype)
            for block_first in range(0, rows, BLOCK_ROWS):
                yield first + block_first, codes[block_first : block_first + BLOCK_ROWS]

    return DecodedImage("tiff", width, height, colour_samples, samples, depth, "linear", None, reader)


def _tiff_strip_bytes(stored: bytes, compression: int, expected: int) -> bytes:
    if compression == TIFF_NONE:
        raw = stored[:expected]
    elif compression == TIFF_LZW:
        raw = _lzw_decode(stored, expected)
    else:
        raw = _bounded_inflate(stored, expected)
    if len(raw) != expected:
        raise RefusedFile("unreadable")
    return raw


def _lzw_decode(stored: bytes, limit: int) -> bytes:
    """TIFF LZW (MSB first, early change), stopping one byte past `limit` so a bomb cannot grow."""
    clear, end_of_information = 256, 257
    table = [bytes((value,)) for value in range(256)] + [b"", b""]
    output, bits, accumulator, width, previous = bytearray(), 0, 0, 9, b""
    for byte in stored:
        accumulator, bits = (accumulator << 8) | byte, bits + 8
        while bits >= width:
            bits -= width
            code = (accumulator >> bits) & ((1 << width) - 1)
            accumulator &= (1 << bits) - 1
            if code == end_of_information:
                return bytes(output)
            if code == clear:
                table, width, previous = table[:258], 9, b""
                continue
            if code < len(table):
                entry = table[code]
            elif previous:
                entry = previous + previous[:1]
            else:
                raise RefusedFile("unreadable")
            output += entry
            if len(output) > limit:
                return bytes(output)
            if previous:
                table.append(previous + entry[:1])
            previous = entry
            width = 9 if len(table) < 511 else 10 if len(table) < 1023 else 11 if len(table) < 2047 else 12
    return bytes(output)


def has_supported_signature(data: bytes) -> bool:
    return data.startswith(PNG_SIGNATURE) or data.startswith(TIFF_SIGNATURES)
