"""Shared pieces for the PNG and TIFF decoders."""
from __future__ import annotations

import zlib
from dataclasses import dataclass

import numpy as np

MAX_BYTES = 60_000_000
MAX_PIXELS = 40_000_000
MIN_WIDTH = 64
MAX_WIDTH = 20_000
MIN_HEIGHT = 64
MAX_HEIGHT = 4_000
PREVIEW_WIDTH = 2048

MSG_DIMENSIONS = "Scans are limited to 20,000 × 4,000 pixels and 40,000,000 pixels in total."
MSG_PIXEL_FORMAT = "Use 8- or 16-bit greyscale or RGB."
MSG_TIFF_LAYOUT = "TIFF scans must hold one striped image, uncompressed or LZW- or Deflate-compressed."
MSG_UNREADABLE = "This file could not be read as an image."


class ScanRefused(Exception):
    """A scan refused by an explicit published check."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass
class DecodedScan:
    """Decoded samples plus the transfer the linear values follow."""

    codes: np.ndarray  # uint8 or uint16, shape (height, width, channels)
    transfer: str  # linear | srgb | gamma
    gamma: float | None

    @property
    def height(self) -> int:
        return int(self.codes.shape[0])

    @property
    def width(self) -> int:
        return int(self.codes.shape[1])

    @property
    def channels(self) -> int:
        return int(self.codes.shape[2])

    def linear(self) -> np.ndarray:
        """Linear values as float32 in 0..1, per channel, at full bit depth."""
        codes = self.codes.astype(np.float32)
        maximum = 65535.0 if self.codes.dtype == np.uint16 else 255.0
        codes /= maximum
        if self.transfer == "srgb":
            linear = np.where(codes <= 0.04045, codes / 12.92,
                              np.power((codes + 0.055) / 1.055, 2.4))
        elif self.transfer == "gamma":
            linear = np.power(codes, 1.0 / float(self.gamma))
        else:
            linear = codes
        return linear.astype(np.float32, copy=False)

    def grey_codes(self) -> np.ndarray:
        """Display codes: RGB averaged, 16-bit scaled to 8-bit, no transfer."""
        if self.channels >= 3:
            grey = np.mean(self.codes[:, :, :3].astype(np.float64), axis=2)
        else:
            grey = self.codes[:, :, 0].astype(np.float64)
        if self.codes.dtype == np.uint16:
            return np.clip(np.rint(grey * 255.0 / 65535.0), 0, 255).astype(np.uint8)
        return grey.astype(np.uint8)

    def preview_slices(self) -> list[bytes]:
        """2048-pixel-wide 8-bit greyscale PNG slices covering the full height."""
        import io

        from PIL import Image

        grey = self.grey_codes()
        slices: list[bytes] = []
        for start in range(0, self.width, PREVIEW_WIDTH):
            buffer = io.BytesIO()
            Image.fromarray(grey[:, start:start + PREVIEW_WIDTH]).save(buffer, format="PNG")
            slices.append(buffer.getvalue())
        return slices


def check_dimensions(width: int, height: int) -> None:
    if not (MIN_WIDTH <= width <= MAX_WIDTH and MIN_HEIGHT <= height <= MAX_HEIGHT
            and width * height <= MAX_PIXELS):
        raise ScanRefused(MSG_DIMENSIONS)
