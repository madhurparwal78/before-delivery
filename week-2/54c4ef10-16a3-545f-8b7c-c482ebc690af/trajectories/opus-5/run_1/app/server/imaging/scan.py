"""Strip scans: the published file checks, linear values and preview slices."""

from __future__ import annotations

import io
import struct
import zlib
from dataclasses import dataclass

import numpy as np
from PIL import Image

from . import png, tiff

MIN_WIDTH = 64
MAX_WIDTH = 20_000
MIN_HEIGHT = 64
MAX_HEIGHT = 4_000
MAX_PIXELS = 40_000_000
PREVIEW_SLICE_WIDTH = 2_048

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ScanFileError(Exception):
    """A refusal from the published file checks."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


@dataclass(frozen=True)
class ScanFacts:
    """What the header alone tells us, before any pixel is decoded."""

    format: str
    width: int
    height: int


@dataclass(frozen=True)
class DecodedScan:
    width: int
    height: int
    transfer: str
    gamma: float | None
    linear: np.ndarray
    display: np.ndarray


def detect_format(data: bytes) -> str | None:
    """PNG or TIFF judged by the leading bytes alone."""
    if data[:8] == png.SIGNATURE:
        return "png"
    if data[:4] in (tiff.LITTLE_ENDIAN_SIGNATURE, tiff.BIG_ENDIAN_SIGNATURE):
        return "tiff"
    return None


def inspect(data: bytes) -> ScanFacts:
    """Header, dimension, pixel-format and TIFF-layout checks, in that order."""
    image_format = detect_format(data)
    if image_format == "png":
        try:
            header = png.read_header(data)
            _check_dimensions(header.width, header.height)
            png.check_pixel_format(header)
        except png.PngError as exc:
            raise ScanFileError(exc.kind) from exc
        return ScanFacts("png", header.width, header.height)
    try:
        directory = tiff.read_first_directory(data)
        _check_dimensions(directory.width, directory.height)
        tiff.check_layout(data)
    except tiff.TiffError as exc:
        raise ScanFileError(exc.kind) from exc
    return ScanFacts("tiff", directory.width, directory.height)


def _check_dimensions(width: int, height: int) -> None:
    if not MIN_WIDTH <= width <= MAX_WIDTH or not MIN_HEIGHT <= height <= MAX_HEIGHT:
        raise ScanFileError("dimensions")
    if width * height > MAX_PIXELS:
        raise ScanFileError("dimensions")


def decode(data: bytes) -> DecodedScan:
    """Decode a scan that `inspect` accepted into linear and display values."""
    image_format = detect_format(data)
    if image_format == "png":
        try:
            chunks = png.read_chunks(data)
            png.inflate_image_data(chunks)
            samples = _samples_from_png(data, chunks)
        except png.PngError as exc:
            raise ScanFileError(exc.kind) from exc
        transfer, gamma = chunks.transfer, chunks.gamma
        max_value = 65535 if chunks.header.bit_depth == 16 else 255
        colour_channels = _colour_channels(chunks.header.colour_type)
    else:
        try:
            directory, samples = _samples_from_tiff(data)
        except tiff.TiffError as exc:
            raise ScanFileError(exc.kind) from exc
        transfer, gamma = "linear", None
        max_value = 65535 if directory.bit_depth == 16 else 255
        colour_channels = 3 if directory.channels in (3, 4) else 1

    height, width = samples.shape[0], samples.shape[1]
    linear = np.empty((height, width), dtype=np.float32)
    display = np.empty((height, width), dtype=np.uint8)
    for start in range(0, height, 256):
        stop = min(start + 256, height)
        colour = samples[start:stop, :, :colour_channels].astype(np.float32) / max_value
        linear[start:stop] = _linearise(colour, transfer, gamma).mean(axis=2)
        display[start:stop] = np.rint(colour.mean(axis=2) * 255).astype(np.uint8)
    return DecodedScan(width, height, transfer, gamma, linear, display)


def _colour_channels(colour_type: int) -> int:
    return 3 if colour_type in (2, 6) else 1


def _samples_from_png(data: bytes, chunks: png.PngChunks) -> np.ndarray:
    header = chunks.header
    lossless_in_pillow = header.bit_depth == 8 or header.colour_type == 0
    if lossless_in_pillow:
        samples = _pillow_samples(data, header.width, header.height)
        if samples is not None:
            return samples
    return png.decode_samples(data)[1]


def _samples_from_tiff(data: bytes) -> tuple[tiff.TiffDirectory, np.ndarray]:
    directory = tiff.check_layout(data)
    lossless_in_pillow = directory.bit_depth == 8 or directory.channels == 1
    if lossless_in_pillow:
        samples = _pillow_samples(data, directory.width, directory.height)
        if samples is not None:
            return directory, samples
    return tiff.decode_samples(data)


def _pillow_samples(data: bytes, width: int, height: int) -> np.ndarray | None:
    """Pillow's decoders, used only where they keep every bit of every sample."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            array = np.asarray(image)
    except (OSError, ValueError, SyntaxError):
        return None
    if array.ndim == 2:
        array = array[:, :, None]
    if array.shape[0] != height or array.shape[1] != width:
        return None
    if array.dtype == np.uint8:
        return array
    if array.dtype in (np.int32, np.uint16, np.dtype(">u2"), np.dtype("<u2")):
        return array.astype(np.uint16)
    return None


def _linearise(colour: np.ndarray, transfer: str, gamma: float | None) -> np.ndarray:
    if transfer == "srgb":
        low = colour / 12.92
        high = ((colour + 0.055) / 1.055) ** 2.4
        return np.where(colour <= 0.04045, low, high)
    if transfer == "gamma":
        assert gamma is not None
        return colour ** (1 / gamma)
    return colour


def preview_slices(display: np.ndarray) -> list[bytes]:
    """8-bit greyscale PNG slices, 2048 pixels wide, at full resolution."""
    width = display.shape[1]
    slices = []
    for start in range(0, width, PREVIEW_SLICE_WIDTH):
        block = display[:, start : start + PREVIEW_SLICE_WIDTH]
        slices.append(encode_grey_png(np.ascontiguousarray(block)))
    return slices


def encode_grey_png(grey: np.ndarray) -> bytes:
    height, width = grey.shape
    raw = np.concatenate(
        [np.zeros((height, 1), dtype=np.uint8), grey.astype(np.uint8)], axis=1
    ).tobytes()
    parts = [png.SIGNATURE]
    parts.append(
        _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
    )
    parts.append(_chunk(b"IDAT", zlib.compress(raw, 6)))
    parts.append(_chunk(b"IEND", b""))
    return b"".join(parts)


def _chunk(kind: bytes, body: bytes) -> bytes:
    return (
        struct.pack(">I", len(body))
        + kind
        + body
        + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    )
