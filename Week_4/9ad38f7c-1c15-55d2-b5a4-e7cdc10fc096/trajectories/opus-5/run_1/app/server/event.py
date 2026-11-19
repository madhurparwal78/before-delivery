"""The event window and its calendar file."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .seed_data import (
    CALENDAR_DESCRIPTION,
    CALENDAR_TITLE,
    EVENT_END,
    EVENT_NAME,
    EVENT_START,
)
from .times import as_calendar_stamp, as_iso

CALENDAR_UID = "downtime-strange-and-unusual-activity@nightward.invalid"
CALENDAR_FILENAME = "downtime.ics"
PRODID = "-//NightWard//Downtime Strange & Unusual Activity//EN"


def event_payload(server_time: datetime) -> dict[str, Any]:
    return {
        "name": EVENT_NAME,
        "start": EVENT_START,
        "end": EVENT_END,
        "live_windows": [{"start": EVENT_START, "end": EVENT_END}],
        "calendar_title": CALENDAR_TITLE,
        "calendar_description": CALENDAR_DESCRIPTION,
        "certificate_enabled": True,
        "server_time": as_iso(server_time),
    }


def _escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    """Fold lines longer than 75 octets with CRLF and one space."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    pieces = [raw[:75]]
    rest = raw[75:]
    while rest:
        pieces.append(rest[:74])
        rest = rest[74:]
    return "\r\n ".join(piece.decode("utf-8") for piece in pieces)


def _stamp(moment: datetime) -> str:
    return as_calendar_stamp(moment)


def _moment(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def calendar_file(server_time: datetime) -> bytes:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{_escape(PRODID)}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{CALENDAR_UID}",
        f"DTSTAMP:{_stamp(server_time)}",
        f"DTSTART:{_stamp(_moment(EVENT_START))}",
        f"DTEND:{_stamp(_moment(EVENT_END))}",
        f"SUMMARY:{_escape(CALENDAR_TITLE)}",
        f"DESCRIPTION:{_escape(CALENDAR_DESCRIPTION)}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    body = "".join(f"{_fold(line)}\r\n" for line in lines)
    return body.encode("utf-8")
