"""Email and calendar-invitation composition, as Business rules 25 and 26 pin them."""
from __future__ import annotations

import datetime as dt

from . import rules
from .config import CONFIG
from .labels import call_time_label, status_line, STATUS_LABELS


def status_url(reference_token: str) -> str:
    return f"{CONFIG.public_url}/inquiry/{reference_token}"


def confirmation_email(inquiry: dict) -> dict:
    reference = inquiry["reference"]
    link = status_url(inquiry["status_token"])
    body = (
        f"Hi {inquiry['name']},\n"
        f"\n"
        f"We have your inquiry {reference}.\n"
        f"\n"
        f"Follow your inquiry: {link}"
    )
    return {
        "to_address": inquiry["email"],
        "subject": f"We have your inquiry {reference}",
        "body": body,
        "calendar": None,
        "calendar_method": None,
    }


def transition_email(inquiry: dict, new_status: str, calendar: str | None = None,
                     calendar_method: str | None = None) -> dict:
    reference = inquiry["reference"]
    link = status_url(inquiry["status_token"])
    line = status_line(new_status, inquiry.get("call_at"), inquiry.get("decline_reason"))
    label = STATUS_LABELS[new_status]
    body = f"{line}\n\nFollow your inquiry: {link}"
    return {
        "to_address": inquiry["email"],
        "subject": f"Your inquiry {reference} is now {label}",
        "body": body,
        "calendar": calendar,
        "calendar_method": calendar_method,
    }


def _fold_ics_line(line: str) -> list[str]:
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return [line]
    parts = []
    current = ""
    current_len = 0
    limit = 75
    for ch in line:
        width = len(ch.encode("utf-8"))
        if current_len + width > limit:
            parts.append(current)
            current = ch
            current_len = width
            limit = 76
        else:
            current += ch
            current_len += width
    if current:
        parts.append(current)
    return [parts[0]] + [" " + p for p in parts[1:]]


def _ics_lines(properties: list[str]) -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Northpier Studio//Inquiry desk//EN"]
    lines.extend(properties)
    lines.append("END:VCALENDAR")
    folded: list[str] = []
    for line in lines:
        folded.extend(_fold_ics_line(line))
    return "\r\n".join(folded) + "\r\n"


def _ics_stamp(now: dt.datetime) -> str:
    return now.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ics_utc(moment: dt.datetime) -> str:
    return moment.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def intro_call_invitation(inquiry: dict, sequence: int, call_at: dt.datetime,
                          now: dt.datetime, cancel: bool = False) -> str:
    method = "CANCEL" if cancel else "REQUEST"
    status = "CANCELLED" if cancel else "CONFIRMED"
    end = call_at + dt.timedelta(minutes=rules.CALL_MINUTES)
    properties = [
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{inquiry['reference']}@northpier.studio",
        f"SEQUENCE:{sequence}",
        f"DTSTAMP:{_ics_stamp(now)}",
        f"DTSTART:{_ics_utc(call_at)}",
        f"DTEND:{_ics_utc(end)}",
        f"SUMMARY:Northpier intro call {inquiry['reference']}",
        "ORGANIZER:mailto:hello@northpier.studio",
        f"ATTENDEE:mailto:{inquiry['email']}",
        f"STATUS:{status}",
        "END:VEVENT",
    ]
    return _ics_lines(properties)
