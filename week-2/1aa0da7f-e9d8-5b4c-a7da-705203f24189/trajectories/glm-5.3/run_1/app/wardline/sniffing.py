"""Byte sniffing for uploads (DP-09)."""
from __future__ import annotations

ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "audio/wav", "audio/mpeg"]


def sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        return "audio/wav"
    if len(data) >= 3:
        if data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
            # MPEG audio frame sync (layer 3 etc.); ID3 leads the tag form
            return "audio/mpeg"
    if data.startswith(b"ID3"):
        return "audio/mpeg"
    return None
