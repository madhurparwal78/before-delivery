"""Outbound email wording, recording and delivery rules.

Every message is plain-text UTF-8 with headers built only from fixed text,
MAIL_FROM, the validated work email, the row id and the recipient display
name (Business rules rule 16, DP-77). The whole display name is carried as
base64 encoded words, so quotes, commas, at signs, angle brackets and text
that itself looks like an encoded word all round-trip exactly, and the
header carries exactly one address.
"""
from __future__ import annotations

import base64
import re
from email.utils import formatdate

DISPLAY_NAME_BREAKS = re.compile(r"[\r\n\t\x85\u2028\u2029]+")

SUBJECTS = {
    "receipt": "We received your Relayo partner application",
    "approved": "Your Relayo partner application: Approved",
    "rejected": "Your Relayo partner application: Not approved",
}

_MAX_LINE = 998


def display_name(first_name: str, last_name: str) -> str:
    """Each unbroken run of break characters becomes one space."""
    first = DISPLAY_NAME_BREAKS.sub(" ", first_name)
    last = DISPLAY_NAME_BREAKS.sub(" ", last_name)
    return f"{first} {last}"


def subject(kind: str) -> str:
    return SUBJECTS[kind]


def body_text(kind: str, first_name: str, company_name: str) -> str:
    if kind == "receipt":
        middle = (
            "Thank you for applying to the Relayo partner program on behalf of "
            f"{company_name}. Our partner team reviews every application and "
            "replies by email."
        )
    elif kind == "approved":
        middle = (
            "Thank you for applying to the Relayo partner program on behalf of "
            f"{company_name}. Your application has been approved, and a partner "
            "manager will contact you at this address."
        )
    else:
        middle = (
            "Thank you for applying to the Relayo partner program on behalf of "
            f"{company_name}. After review, we are not able to offer a "
            "partnership at this time."
        )
    return (
        f"Hello {first_name},\n"
        "\n"
        f"{middle}\n"
        "\n"
        "The Relayo partner team"
    )


def _encoded_words(display: str) -> list[str]:
    """One base64 encoded word per 42 raw bytes: each word decodes on its
    own and stays well under the 75-character limit."""
    raw = display.encode("utf-8")
    return [
        f"=?utf-8?b?{base64.b64encode(raw[start:start + 42]).decode('ascii')}?="
        for start in range(0, len(raw), 42)
    ]


def _folded(value: str) -> str:
    """Fold a header line on word boundaries so no line exceeds 998 octets."""
    words = value.split(" ")
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = current + " " + word
        if len(candidate.encode("utf-8")) <= _MAX_LINE:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return "\r\n ".join(lines)


def to_header(display: str, address: str) -> str:
    """A single To header value that a standard RFC 5322 and RFC 2047
    parser recovers character for character."""
    return " ".join(_encoded_words(display)) + f" <{address}>"


def build_raw(row_id: int, kind: str, recipient: str, display: str,
              first_name: str, company_name: str, mail_from: str) -> bytes:
    """The whole message as bytes: one recipient, one subject, no added
    header, and no header line over 998 octets."""
    headers = [
        ("From", mail_from),
        ("To", to_header(display, recipient)),
        ("Subject", subject(kind)),
        ("Message-ID", f"<outbound-email-{row_id}@relayo.example>"),
        ("Date", formatdate()),
        ("MIME-Version", "1.0"),
        ("Content-Type", 'text/plain; charset="utf-8"'),
        ("Content-Transfer-Encoding", "8bit"),
    ]
    lines = [f"{name}: {_folded(value)}" for name, value in headers]
    body = body_text(kind, first_name, company_name)
    return ("\r\n".join(lines) + "\r\n\r\n" + body).encode("utf-8")
