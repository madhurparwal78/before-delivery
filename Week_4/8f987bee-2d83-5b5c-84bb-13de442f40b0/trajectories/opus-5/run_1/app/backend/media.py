"""The film and its text tracks, served from the app's own origin."""

from __future__ import annotations

CAPTION_CUES: tuple[tuple[str, str, str], ...] = (
    ("00:00:00.000", "00:00:08.000", "Every record that moves makes a sound."),
    ("00:00:08.000", "00:00:17.000", "Rising pitch means more rows are arriving."),
    ("00:00:17.000", "00:00:26.000", "Quiet means the pipeline is caught up."),
    ("00:00:26.000", "00:00:34.000", "Wayline turns your syncs into signal."),
)

CHAPTER_CUES: tuple[tuple[str, str, str], ...] = (
    ("00:00:00.000", "00:00:12.000", "Arrival"),
    ("00:00:12.000", "00:00:24.000", "Volume"),
    ("00:00:24.000", "00:00:34.000", "Caught up"),
)


def captions_vtt() -> str:
    cues = "\n\n".join(f"{index + 1}\n{start} --> {end}\n{text}" for index, (start, end, text) in enumerate(CAPTION_CUES))
    return f"WEBVTT\n\n{cues}\n"


def chapters_vtt() -> str:
    cues = "\n\n".join(f"{text}\n{start} --> {end}\n{text}" for start, end, text in CHAPTER_CUES)
    return f"WEBVTT\n\n{cues}\n"
