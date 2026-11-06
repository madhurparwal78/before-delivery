"""Scan decoding: PNG and TIFF judged and decoded by content."""
from __future__ import annotations

from .base import (DecodedScan, MAX_BYTES, MSG_DIMENSIONS, MSG_PIXEL_FORMAT,
                   MSG_TIFF_LAYOUT, MSG_UNREADABLE, PREVIEW_WIDTH, ScanRefused)
from .png import decode_png
from .tiff import decode_tiff

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
TIFF_SIGNATURES = (b"II*\x00", b"MM\x00*")

__all__ = [
    "DecodedScan", "MAX_BYTES", "MSG_DIMENSIONS", "MSG_PIXEL_FORMAT",
    "MSG_TIFF_LAYOUT", "MSG_UNREADABLE", "PREVIEW_WIDTH", "ScanRefused",
    "decode_png", "decode_tiff", "decode_scan", "sniff_format",
]


def sniff_format(data: bytes) -> str | None:
    """The format judged from the bytes, never the name or content type."""
    if data.startswith(PNG_SIGNATURE):
        return "png"
    if data.startswith(TIFF_SIGNATURES):
        return "tiff"
    return None


def decode_scan(data: bytes) -> DecodedScan:
    if data.startswith(PNG_SIGNATURE):
        return decode_png(data)
    if data.startswith(TIFF_SIGNATURES):
        return decode_tiff(data)
    raise ScanRefused(MSG_UNREADABLE)

