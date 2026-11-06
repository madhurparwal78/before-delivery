"""Every published message, in one place, for the server and the browser alike."""

from __future__ import annotations

FIELD_COPY: dict[str, str] = {
    "email": "Enter a valid email address.",
    "password": "Use 10 to 128 characters.",
    "name": "Give the roll a name of up to 80 characters.",
    "stock": "Name the stock in up to 60 characters.",
    "format": "Choose 35mm, 120 6×6 or 120 6×7.",
    "kind": "Choose normal roll or test roll.",
    "format_change": "Format and kind cannot change after the roll is created.",
    "ei": "EI is a whole number from 6 to 12800.",
    "push_pull": "Push or pull is a whole number of stops from −3 to +3.",
    "reciprocity_p": (
        "Reciprocity exponent is a number from 0.50 to 1.00 with up to two decimals."
    ),
    "development_note": "Development notes are limited to 500 characters.",
    "curve_roll_id": "Choose one of your test rolls.",
    "counter": "Counter is a whole number from 0 to 99.",
    "aperture": "Use a marked aperture such as 5.6 or 11.",
    "shutter": 'Use a shutter speed such as 1/125, 1/2 or 2".',
    "metered_ev": "Metered EV is a number from −6 to 21.",
    "note": "Notes are limited to 500 characters.",
    "title": "Titles are limited to 80 characters.",
    "dpi": "DPI is a whole number from 300 to 10000.",
    "first_edge": "Edge number is a whole number from 0 to 99.",
    "size": "Declared size does not match the received file.",
    "sha256": "Checksum does not match the received file.",
    "file_dimensions": (
        "Scans are limited to 20,000 × 4,000 pixels and 40,000,000 pixels in total."
    ),
    "file_pixel_format": "Use 8- or 16-bit greyscale or RGB.",
    "file_tiff_layout": (
        "TIFF scans must hold one striped image, uncompressed or LZW- or "
        "Deflate-compressed."
    ),
    "file_unreadable": "This file could not be read as an image.",
    "area": "Mark an area inside the scan, at least 8 × 8 pixels.",
    "wedge_size": "Mark the whole wedge, at least 42 pixels wide and 8 tall.",
    "wedge_order": "The wedge steps must darken from left to right.",
    "x0": (
        "Frame edges must stay inside the scan, at least 8 pixels apart, "
        "without overlapping a neighbour."
    ),
    "reading_point": "Point is outside the scan.",
    "pin_inside": "Pin inside a frame.",
    "scan_detection": "No frames found for this format and DPI.",
    "offset": "Offset is a whole number from −2 to +2.",
    "slip_after": "Choose a note on this roll, or no slip.",
    "overrides": "Each note and frame can appear once and must belong to this roll.",
    "version": "Reload the alignment before saving.",
}

ERROR_COPY: dict[str, str] = {
    "invalid_credentials": "Email or password is wrong.",
    "email_taken": "An account with this email already exists.",
    "counter_taken": "Counter <counter> is already logged on this roll.",
    "too_large": "This scan is larger than 60,000,000 bytes.",
    "unsupported_format": "Only PNG or TIFF scans can be stored.",
    "duplicate_scan": "This strip is already on this roll.",
    "not_calibrated": "Calibrate this scan first.",
    "frames_exist": "Frames are already found; nudge them instead.",
    "no_frames": "Find frames first.",
    "unframed_scans": "Find frames on every strip of this roll first.",
    "flagged_frames": "Accept or nudge every flagged frame first.",
    "stale_alignment": (
        "This alignment changed in another tab. Reload it before saving."
    ),
    "storage_unavailable_upload": (
        "Storage is unreachable. Nothing was stored; try again when it is back."
    ),
    "storage_unavailable": "Storage is unreachable, so new readings are paused.",
}

PENDING_COPY: dict[str, str] = {
    "signin": "Signing in…",
    "signup": "Creating account…",
    "roll": "Saving roll…",
    "entry": "Logging…",
    "note": "Saving note…",
    "upload": "Uploading <filename>…",
    "calibrate": "Calibrating…",
    "detect": "Finding frames…",
    "frame": "Saving frame <n>…",
    "proposal": "Comparing notes with frames…",
    "alignment": "Saving alignment…",
    "pin": "Pinning…",
    "title": "Saving title…",
}

SUCCESS_COPY: dict[str, str] = {
    "roll": "Roll saved.",
    "entry": "Note <counter> logged.",
    "note_saved": "Note <counter> saved.",
    "note_deleted": "Note <counter> deleted.",
    "upload": "Stored <filename>: size and checksum confirmed.",
    "calibrate_clear_light": "Calibrated from clear light.",
    "calibrate_step_wedge": "Calibrated from the step wedge.",
    "detect": "Found <count> frames, <flagged> flagged.",
    "frame": "Frame <n> saved.",
    "accept_width": "Frame <n> width accepted.",
    "proposal_offset": "Proposed offset <offset> (ρ <rho>).",
    "proposal_slip": "Proposed offset <offset>, slip after note <s> (ρ <rho>).",
    "proposal_none": (
        "Not enough exposed frames to propose an offset. "
        "Choose one in Override alignment."
    ),
    "alignment": "Alignment saved: <aligned> notes matched, <unmatched> unmatched.",
    "pin": "Pinned net <net> on frame <n>.",
    "title": "Title saved.",
    "upload_failed": (
        "Upload failed: the connection was lost. Nothing was stored; try again."
    ),
}

DRAFT_COPY: dict[str, str] = {
    "entry_expired": "Your session ended. Sign in to keep this exposure.",
    "entry_restored": "Your unsent exposure is back. Press Log exposure to send it.",
    "note_expired": "Your session ended. Sign in to keep this note.",
    "note_restored": "Your unsent note is back. Press Save note <counter> to send it.",
}

EMPTY_COPY: dict[str, str] = {
    "archive": "Your archive is empty. Start a roll before you shoot.",
    "no_strips": "No strips yet.",
    "no_readings": "No pinned readings.",
    "no_curve": "No curve yet. Link a curve-ready test roll.",
    "not_ready": (
        "Needs at least 7 aligned bracket frames spanning 6 stops "
        "(now <frames> frames, <span> stops)."
    ),
    "not_found": "Not in your archive.",
    "preview_unavailable": "Preview unavailable",
}

BANNER_COPY = (
    "Negative storage is unreachable. Uploads and new readings are paused; "
    "your notes, alignments and pinned readings are still here."
)

HEADLINE = "Every frame, back with its notes."
HERO_SENTENCE = "Density read from the negative, not guessed from the print."

FILE_KIND_TO_FIELD_COPY: dict[str, str] = {
    "dimensions": FIELD_COPY["file_dimensions"],
    "pixel_format": FIELD_COPY["file_pixel_format"],
    "tiff_layout": FIELD_COPY["file_tiff_layout"],
    "unreadable": FIELD_COPY["file_unreadable"],
}


def browser_copy() -> dict[str, object]:
    """The copy tables handed to the page, so both sides show the same text."""
    return {
        "field": FIELD_COPY,
        "error": ERROR_COPY,
        "pending": PENDING_COPY,
        "success": SUCCESS_COPY,
        "draft": DRAFT_COPY,
        "empty": EMPTY_COPY,
        "banner": BANNER_COPY,
        "headline": HEADLINE,
        "heroSentence": HERO_SENTENCE,
    }
