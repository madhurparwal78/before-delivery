from __future__ import annotations

import contextlib
import html as htmllib
import json
import math
import os
import re
import secrets
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest

from conftest import (
    DEPLOYED_APP,
    Postgres,
    S3,
    addresses,
    advance,
    animations,
    center,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    select,
    settle,
    shipped_packages,
    tab_order,
    tap,
    text,
    unique,
)


UTC = timezone.utc
LONDON = ZoneInfo("Europe/London")
APP = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")
RNG = secrets.SystemRandom()

HTTP_TIMEOUT = 30
UPLOAD_TIMEOUT = 180
UI_WAIT_S = 30
MAIL_WAIT_S = 30
BOOT_WAIT_S = 120
POLL_S = 0.25
TAB_LIMIT = 120
OBSERVE_S = 7

CONFIRM_MAIL_S = 10
QUEUE_SEND_S = 60
QUEUE_CHECK_S = 10
SHARE_REFRESH_MS = 30_000
SHARE_CHANGE_MS = 35_000
WORKSPACE_REFRESH_MS = 10_000
GLIDE_SETTLED_MS = 300
DIALOG_FADE_OUT_MS = 160
CARRIER_WAIT_S = 4
SHORT_TTL_S = 10
SHORT_LOCK_S = 10
SHORT_TERM_S = 20
SHORT_RATE = 5
SHORT_SESSION_S = 10
LOCK_TRIES = 5
ZERO_RATE_RETRY = "60"
FOCUS_RING_MIN = 2

PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
VIEWPORTS = (PHONE, TABLET, DESKTOP)
MARGIN_NARROW = 16
MARGIN_WIDE = 24
GUTTER_MIN = 40
CONFIRM_COLUMN = 560
FIND_COLUMN = 480
DIALOG_WIDTH = 480
COLUMN_LEFT = 16
COLUMN_RIGHT = 359
TARGET_MIN = 44
SHARE_MAX = 1200
PAGE_SIDES = 32
TOL = 1

GAP_WIDE = 48
GAP_NARROW = 28
FAN_KEYS = {"ArrowRight": 5, "ArrowUp": 5, "ArrowLeft": -5, "ArrowDown": -5, "PageUp": 25, "PageDown": -25}

OPERATOR_EMAIL = "operator@holmgarth.example"
OPERATOR_PASSWORD = "fan-out-2026-desk"
MAIL_FROM_ADDRESS = "desk@holmgarth.example"

KESTLE = "kestle-shelving-unit"
ALDRA = "aldra-wardrobe"
BRAMWELL = "bramwell-sofa-frame"
FENWICK = "fenwick-bed-frame"
MODELS = {
    ALDRA: ("Aldra Wardrobe", "y", ("Side panel", "Top panel", "Shelf", "Hanging rail", "Cam lock", "Cam bolt")),
    BRAMWELL: ("Bramwell Sofa Frame", "x", ("Back rail", "Seat slat", "Front leg", "Corner block", "Bolt M8 × 80")),
    KESTLE: ("Kestle Shelving Unit", "iso", ("Upright", "Shelf board", "Shelf pin", "Wall bracket", "Back brace")),
    FENWICK: ("Fenwick Bed Frame", None, ("Headboard", "Side rail", "Slat", "Centre leg")),
}
PIN_PRICE = 15
PIN_NUMBER = "101345"
PIN_WEIGHT = 3
PIN_SIDE = 16
UPRIGHT_SIDE = 1810
WITHDRAWN_BOOKLET = 5
PURCHASE = "2025-02-11"
POSTCODE = "SW1A 1AA"
POSTCODE_ZE = "ze1 0aa"
POSTCODE_IV = "IV1 1AA"
POSTCODE_HS = "HS1 2AB"
POSTCODE_KW = "KW1 4AB"
DEFAULT_BAND, DEFAULT_CHARGE = "S2", 395
ZE_BAND, ZE_CHARGE = "S3", 695
LARGE_BAND, LARGE_CHARGE = "L1", 2450
VALID_UNTIL = "2030-12-31T23:59:59Z"
EXAMPLE_QUANTITY = 10
EXAMPLE_PART_LINE = 38
EXAMPLE_TOTAL = 433
AC_2025, AC_2026 = "AC-2025", "AC-2026"
AC_2026_START = date(2026, 7, 15)
CONTRIBUTION_2026 = 25
STANDARD_MONTHS = 24
CLUB_MONTHS = 36
CLUB_TOM = "tom.ashby@example.net"
TOM_JOINED = date(2025, 9, 10)
CLUB_INES = "ines.kowalczyk@example.org"
MALFORMED_REF = "HG-0OOOO1"
REF_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
REF_RE = re.compile(r"HG-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}")
TOKEN_MIN = 32
PHOTO_CAP = 8_000_000
CLAIM_BODY_CAP = 33_000_000
JSON_CAP = 64_000
SUPPLIER_CAP = 2_000_000
KEY_MAX = 64
NAME_MAX = 120
DESCRIPTION_MAX = 1000
TITLE_MAX = 80
MONTHS_MAX = 120
PARTS_PAGE_MAX = 50
PARTS_DEFAULT = 20
QUANTITY_MAX = 20
IMPORT_HEADER = "model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status"
BANK_HOLIDAYS = frozenset({
    date(2026, 1, 1), date(2026, 4, 3), date(2026, 4, 6), date(2026, 5, 4), date(2026, 5, 25),
    date(2026, 8, 31), date(2026, 12, 25), date(2026, 12, 28),
    date(2027, 1, 1), date(2027, 3, 26), date(2027, 3, 29), date(2027, 5, 3), date(2027, 5, 31),
    date(2027, 8, 30), date(2027, 12, 27), date(2027, 12, 28),
})
FROZEN = {
    "london-edge": datetime(2026, 7, 14, 23, 0, 0, tzinfo=UTC),
    "london-edge-before": datetime(2026, 7, 14, 22, 59, 59, tzinfo=UTC),
    "before-cutoff": datetime(2026, 7, 15, 12, 59, 59, tzinfo=UTC),
    "after-cutoff": datetime(2026, 7, 15, 13, 0, 0, tzinfo=UTC),
    "ttl-one": datetime(2026, 7, 15, 9, 0, 0, tzinfo=UTC),
}
TTL_ONE_LINE_EN = "This link works until 10:00 on 15 July 2026 (UK time)."
TTL_ONE_LINE_PL = "Link działa do 10:00 dnia 15 lipca 2026 (czas brytyjski)."
DEVICE_CLOCK = datetime(2031, 3, 30, 1, 30, tzinfo=UTC)
EVIL_ORIGIN = "http://evil.example"
PL_MONTHS = ("stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia",
             "września", "października", "listopada", "grudnia")

COPY_ENV = {
    "minio-down": "APP_MINIO_DOWN_URL", "carrier-down": "APP_CARRIER_DOWN_URL",
    "killbill-down": "APP_KILLBILL_DOWN_URL", "mailpit-down": "APP_MAILPIT_DOWN_URL",
    "postgres-down": "APP_POSTGRES_DOWN_URL", "london-edge": "APP_LONDON_EDGE_URL",
    "london-edge-before": "APP_LONDON_EDGE_BEFORE_URL", "before-cutoff": "APP_BEFORE_CUTOFF_URL",
    "after-cutoff": "APP_AFTER_CUTOFF_URL", "ttl-one": "APP_TTL_ONE_URL", "zero-limits": "APP_ZERO_LIMITS_URL",
    "zero-term": "APP_ZERO_TERM_URL", "zero-ttl": "APP_ZERO_TTL_URL", "short-timer": "APP_SHORT_TIMER_URL",
    "short-session": "APP_SHORT_SESSION_URL", "zero-session": "APP_ZERO_SESSION_URL",
}
COPY_DB = {c: "_" + c.replace("-", "_") for c in (
    "london-edge", "london-edge-before", "before-cutoff", "after-cutoff", "ttl-one", "zero-limits",
    "zero-term", "zero-ttl", "short-timer", "short-session", "zero-session")}
COPY_BUCKET = {c: "-" + c for c in COPY_DB}
COPY_BUCKET["postgres-down"] = "-pgdown"

OWN = {
    "link_lapsed": ("This confirmation link has lapsed. Start your claim again to get a new one.",
                    "Ten link potwierdzający wygasł. Rozpocznij zgłoszenie ponownie, aby otrzymać nowy."),
    "link_used": ("This confirmation link has already been used.", "Ten link potwierdzający został już użyty."),
    "link_unknown": ("We couldn't find that confirmation link.", "Nie znaleźliśmy tego linku potwierdzającego."),
    "claim_unknown": ("We couldn't find that claim.", "Nie znaleźliśmy tego zgłoszenia."),
    "photo_count": ("Add between 1 and 4 photos.", "Dodaj od 1 do 4 zdjęć."),
    "carrier_unavailable": ("The carrier isn't answering right now. Try the estimate again later.",
                            "Przewoźnik nie odpowiada w tej chwili. Spróbuj ponownie później."),
    "carrier_timeout": ("The carrier is taking too long to answer. Try the estimate again in a minute.",
                        "Przewoźnik zbyt długo nie odpowiada. Spróbuj ponownie za minutę."),
    "carrier_malformed": ("The carrier sent an answer we can't read. Try the estimate again later.",
                          "Przewoźnik przesłał odpowiedź, której nie możemy odczytać. Spróbuj ponownie później."),
    "storage_unavailable": ("We can't store photos right now, so nothing was saved. Please try again in a few minutes.",
                            "Nie możemy teraz zapisać zdjęć, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut."),
    "mail_unavailable": ("We can't send email right now, so nothing was saved. Please try again in a few minutes.",
                         "Nie możemy teraz wysłać e-maila, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut."),
    "database_unavailable": ("We can't reach our claim records right now, so nothing was saved. Please try again in a few minutes.",
                             "Nie możemy teraz połączyć się z rejestrem zgłoszeń, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut."),
    "not_found": ("We couldn't find a claim with that reference and email.",
                  "Nie znaleźliśmy zgłoszenia o tym numerze i adresie e-mail."),
    "reference_locked": ("This reference is locked after too many wrong tries. Try again later.",
                         "Ten numer zgłoszenia jest zablokowany po zbyt wielu błędnych próbach. Spróbuj ponownie później."),
    "wrong_state": ("This claim hasn't been confirmed yet. Use the link in the email we sent.",
                    "To zgłoszenie nie zostało jeszcze potwierdzone. Użyj linku z wysłanego e-maila."),
    "claim_closed": ("This claim is closed, so its link no longer works.", "To zgłoszenie jest zamknięte, więc link już nie działa."),
    "link_withdrawn": ("This link has been withdrawn. Ask Holmgarth Aftercare for a new one.",
                       "Ten link został wycofany. Poproś Holmgarth Aftercare o nowy."),
    "share_unknown": ("We couldn't find that link.", "Nie znaleźliśmy tego linku."),
    "rate_limited": ("Too many requests. Please wait a moment.", "Zbyt wiele zapytań. Poczekaj chwilę."),
}
NOT_A_PHOTO = ("The file {f} isn't a JPEG, PNG or WebP photo.", "Plik {f} nie jest zdjęciem JPEG, PNG ani WebP.")
TOO_LARGE = ("The file {f} is larger than 8 MB.", "Plik {f} jest większy niż 8 MB.")
PART_WITHDRAWN_OWNER = "Part {n} is no longer available to claim."
PART_NOT_FOUND = "Choose the broken or missing part."
FIELDS_MESSAGE = "Some fields need attention."

OPS = {
    "bad_credentials": "That email and password don't match.",
    "not_paid": "Record the owner's payment before dispatch.",
    "already_paid": "This claim is already paid.",
    "idempotency_conflict": "That request was already used for a different action.",
    "billing_unavailable": "Billing isn't answering. Nothing was charged or changed.",
    "carrier_unavailable": "The carrier isn't answering. No quote was made.",
    "carrier_timeout": "The carrier took too long to answer. No quote was made.",
    "carrier_malformed": "The carrier's answer couldn't be read. No quote was made.",
    "storage_unavailable": "File storage isn't answering. Nothing was changed.",
    "mail_unavailable": "Email isn't answering. Nothing was erased.",
    "database_unavailable": "The claim records aren't answering. Nothing was changed.",
    "must_be_future": "Choose a date after today.",
    "edition_date_taken": "An edition already starts on that date.",
    "edition_code_taken": "That edition code is already used.",
    "file_too_large": "The file is larger than 2,000,000 bytes.",
    "not_found": "No claim with that reference.",
}
WRONG_STATE = "This claim is {state}, so that can't be done now."
OPS_PART_WITHDRAWN = "Part {n} has been withdrawn."
STATES = {
    "started": ("Started", "Rozpoczęte"), "confirmed": ("Confirmed", "Potwierdzone"),
    "identified": ("Identified", "Zidentyfikowane"), "quoted": ("Quoted", "Wycenione"),
    "declined": ("Declined", "Odrzucone"), "dispatched": ("Dispatched", "Wysłane"),
    "closed": ("Closed", "Zamknięte"), "erased": ("Erased", "Usunięte"),
}
LABELS = {
    "en": {"name": "Your name", "email": "Email", "postcode": "Postcode", "model": "Model",
           "purchase": "Date of purchase", "quantity": "Quantity", "what": "What happened",
           "photos": "Damage photos", "estimate_region": "Carriage estimate", "estimate": "Estimate carriage",
           "start": "Start claim", "confirm": "Confirm my claim", "ref": "Claim reference", "find": "Find claim",
           "slip": "Claim slip", "history": "Claim history", "fan": "Fitting fan", "slider": "Separate parts",
           "part": "Part", "radio": "English"},
    "pl": {"name": "Imię i nazwisko", "email": "E-mail", "postcode": "Kod pocztowy", "model": "Model",
           "purchase": "Data zakupu", "quantity": "Ilość", "what": "Co się stało",
           "photos": "Zdjęcia uszkodzeń", "estimate_region": "Szacunkowy koszt przesyłki", "estimate": "Oszacuj przesyłkę",
           "start": "Wyślij zgłoszenie", "confirm": "Potwierdzam zgłoszenie", "ref": "Numer zgłoszenia",
           "find": "Znajdź zgłoszenie", "slip": "Karta zgłoszenia", "history": "Historia zgłoszenia",
           "fan": "Rozkład części", "slider": "Rozsuń części", "part": "Część", "radio": "Polski"},
}
SHARE_VIEW_KEYS = {"reference", "state", "language", "model", "part", "quantity", "purchase_date", "ruling",
                   "quote", "paid_minor", "decline", "dispatched_at", "history"}

SIGNATURES = {"jpeg": b"\xff\xd8\xff", "png": b"\x89PNG\r\n\x1a\n", "webp": b"RIFF\x00\x00\x00\x00WEBP"}

FOCUS_SIG = """() => { const e = document.activeElement; if (!e) return '';
  const l = e.getAttribute('aria-label') || (e.labels && e.labels[0] ? e.labels[0].textContent : '') || e.textContent || '';
  return e.tagName + ':' + (e.getAttribute('role') || '') + ':' + l.trim().slice(0, 80); }"""
RING_JS = """() => { let e = document.activeElement; const out = [];
  for (let i = 0; e && i < 3; i++, e = e.parentElement) { const s = getComputedStyle(e);
    out.push({w: parseFloat(s.outlineWidth) || 0, style: s.outlineStyle, shadow: s.boxShadow}); }
  return out; }"""


def pause() -> None:
    threading.Event().wait(POLL_S)


def poll(fn: Callable[[], Any], what: str, seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            value = fn()
        except (AssertionError, httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            last, value = exc, None
        if value:
            return value
        pause()
    pytest.fail(f"{what} within {seconds}s (last: {last})")


def holds_for(cond: Callable[[], bool], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert cond(), what
        pause()


def copy_url(copy: str) -> str:
    value = os.environ.get(COPY_ENV[copy], "")
    if not value:
        pytest.fail(f"{COPY_ENV[copy]} must name the {copy} copy of the desk")
    return value.rstrip("/")


def copy_pg(copy: str | None) -> Any:
    return Postgres(COPY_DB[copy]) if copy in COPY_DB else Postgres()


def copy_s3(copy: str | None) -> Any:
    return S3(COPY_BUCKET[copy]) if copy in COPY_BUCKET else S3()


def owner(prefix: str = "owner") -> tuple[str, str]:
    a, b = unique(prefix)
    email = next((x for x in (a, b) if "@" in x), None)
    other = b if email == a else a
    if email is None:
        email = f"{re.sub(r'[^a-z0-9.-]', '', a.lower()) or uuid.uuid4().hex}@example.org"
    name = other if other and "@" not in other else f"Owner {uuid.uuid4().hex[:8]}"
    return name[:NAME_MAX], email.lower()


def random_ref() -> str:
    return "HG-" + "".join(RNG.choice(REF_ALPHABET) for _ in range(6))


def err(r: httpx.Response, status: int, code: str, message: str | None = None, what: str = "") -> dict:
    assert r.status_code == status, f"{what}: expected {status} {code}; got {r.status_code} {r.text[:400]}"
    body = r.json()
    e = body.get("error", {})
    assert e.get("code") == code, f"{what}: expected error code {code}; got {body}"
    if message is not None:
        assert e.get("message") == message, f"{what}: expected message {message!r}; got {e.get('message')!r}"
    return e


def ok(r: httpx.Response, status: int = 200, what: str = "") -> Any:
    assert r.status_code == status, f"{what}: expected {status}; got {r.status_code} {r.text[:400]}"
    return r.json() if r.content and r.headers.get("content-type", "").startswith("application/json") else None


def get(base: str, path: str, **kw: Any) -> httpx.Response:
    return httpx.get(base + path, timeout=HTTP_TIMEOUT, **kw)


def post(base: str, path: str, body: Any, headers: dict | None = None) -> httpx.Response:
    return httpx.post(base + path, json=body, headers=headers or {}, timeout=HTTP_TIMEOUT)


def session_cookie(r: httpx.Response) -> str:
    raw = r.headers.get_list("set-cookie")
    assert raw, "POST /api/ops/session should set the operator cookie"
    return raw[0].split(";", 1)[0]


def money(minor: int, lang: str = "en") -> str:
    pounds, pence_part = divmod(int(minor), 100)
    if lang == "en":
        return f"£{pounds:,}.{pence_part:02d}"
    whole = str(pounds)
    if len(whole) >= 5:
        groups = []
        while whole:
            groups.insert(0, whole[-3:])
            whole = whole[:-3]
        whole = "\u00a0".join(groups)
    return f"{whole},{pence_part:02d}\u00a0£"


def instant(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def zulu(dt: datetime) -> datetime:
    return dt.astimezone(UTC)


def hhmm(dt: datetime) -> str:
    return f"{dt.hour:02d}:{dt.minute:02d}"


def date_text(d: date, lang: str = "en") -> str:
    if lang == "en":
        return f"{d.day} {d.strftime('%B')} {d.year}"
    return f"{d.day} {PL_MONTHS[d.month - 1]} {d.year}"


def lifetime_line(confirm_by: str, lang: str = "en") -> str:
    dt = instant(confirm_by).astimezone(LONDON)
    if lang == "en":
        return f"This link works until {hhmm(dt)} on {date_text(dt.date())} (UK time)."
    return f"Link działa do {hhmm(dt)} dnia {date_text(dt.date(), 'pl')} (czas brytyjski)."


def history_line(state: str, at: str, lang: str = "en") -> str:
    dt = instant(at).astimezone(LONDON)
    name = STATES[state][0 if lang == "en" else 1]
    joiner = "on" if lang == "en" else "dnia"
    return f"{name}, {hhmm(dt)} {joiner} {date_text(dt.date(), lang)}"


VOID_LINE = "Revision <revision> (void): Total <amount>"
HISTORY_LINE = "<state>, <time> on <date>"


def anniversary(purchase: date, months: int) -> date:
    y, m = divmod(purchase.month - 1 + months, 12)
    year, month = purchase.year + y, m + 1
    try:
        return date(year, month, purchase.day)
    except ValueError:
        return date(year + month // 12, month % 12 + 1, 1)


def london_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=LONDON).astimezone(UTC)


def working_day(d: date) -> bool:
    return d.weekday() < 5 and d not in BANK_HOLIDAYS


def working_days_after(d: date, n: int) -> date:
    cur = d
    for _ in range(n):
        cur += timedelta(days=1)
        for _ in range(14):
            if working_day(cur):
                break
            cur += timedelta(days=1)
    return cur


def half_up(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def part_line(unit: int, quantity: int, percent: int) -> int:
    return half_up(Decimal(unit) * quantity * percent / 100)


def pence(amount: Any) -> int:
    return half_up(Decimal(str(amount)) * 100)


def photo_bytes(kind: str = "jpeg", marker: bytes = b"", size: int | None = None) -> bytes:
    head = SIGNATURES[kind] + marker
    size = len(head) + 512 if size is None else size
    return head + b"\x00" * (size - len(head))


def multipart(fields: dict[str, Any], files: list[tuple[str, bytes, str]]) -> tuple[bytes, str]:
    boundary = "hg" + uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n'.encode() + str(v).encode() + b"\r\n"
    for name, data, ctype in files:
        safe = name.replace('"', "%22")
        out += (f'--{boundary}\r\nContent-Disposition: form-data; name="photos"; filename="{safe}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n").encode() + data + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def start_claim(base: str, email: str, *, name: str = "Ada Fitter", model: str = KESTLE, booklet: Any = 3,
                quantity: Any = 1, postcode: str = POSTCODE, purchase_date: str = PURCHASE, language: str = "en-GB",
                description: str = "One pin snapped.", photos: list | None = None,
                omit: tuple = ()) -> httpx.Response:
    fields = {"name": name, "email": email, "postcode": postcode, "model": model, "booklet_number": booklet,
              "quantity": quantity, "purchase_date": purchase_date, "description": description, "language": language}
    for k in omit:
        fields.pop(k, None)
    files = [("damage.jpg", photo_bytes(), "image/jpeg")] if photos is None else photos
    body, ctype = multipart(fields, files)
    return httpx.post(base + "/api/claims", content=body, headers={"Content-Type": ctype}, timeout=UPLOAD_TIMEOUT)


def mine(mail: Any, email: str, subject: Any = None) -> list[dict]:
    out = []
    for m in mail.messages(settle=0):
        if email.lower() not in [a.lower() for a in addresses(m.get("To"))]:
            continue
        subj = m.get("Subject", "")
        if subject is None or (subject(subj) if callable(subject) else subj == subject):
            out.append(m)
    return out


def inbox(mail: Any, email: str, subject: Any = None, *, count: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = mine(mail, email, subject)
        if len(found) >= count:
            return found
        pause()
    pytest.fail(f"Mailpit should hold {count} message(s) to {email} ({subject}) within {seconds}s; found {len(found)}")


def quote_notice(mail: Any, c: dict) -> list[dict]:
    return inbox(mail, c["email"], lambda s: s.startswith(f"Quote for claim {c['reference']}:"),
                 seconds=QUEUE_SEND_S + QUEUE_CHECK_S)


def confirm_subject(ref: str, lang: str = "en") -> str:
    return f"Confirm your Holmgarth claim {ref}" if lang == "en" else f"Potwierdź zgłoszenie Holmgarth {ref}"


def token_from(message: dict) -> str:
    m = re.search(r"/confirm/([A-Za-z0-9_\-~.]+)", text(message))
    assert m, "the confirmation email should carry a /confirm/<token> link"
    return m.group(1)


def new_claim(base: str, mail: Any, email: str | None = None, **kw: Any) -> dict:
    name, fresh = owner()
    email = email or fresh
    kw.setdefault("name", name)
    r = start_claim(base, email, **kw)
    body = ok(r, 201, "POST /api/claims")
    ref = body["reference"]
    lang = "pl" if kw.get("language") == "pl-PL" else "en"
    msg = inbox(mail, email, confirm_subject(ref, lang))[0]
    return {"reference": ref, "email": email, "name": kw["name"], "token": token_from(msg),
            "confirm_by": body["confirm_by"], "message": msg, "base": base}


def confirm(base: str, token: str, reference: str | None = None) -> httpx.Response:
    payload: dict[str, Any] = {"token": token}
    if reference is not None:
        payload["reference"] = reference
    return post(base, "/api/claims/confirm", payload)


class Operator:
    def __init__(self, base: str, cookie: str | None = None) -> None:
        self.base = base
        if cookie is None:
            r = post(base, "/api/ops/session", {"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD})
            assert r.status_code == 204, f"POST /api/ops/session should answer 204; got {r.status_code} {r.text}"
            cookie = session_cookie(r)
        self.cookie = cookie

    def on(self, base: str) -> "Operator":
        return Operator(base, self.cookie)

    def call(self, method: str, path: str, body: Any = None, *, key: Any = None, headers: dict | None = None,
             content: bytes | None = None) -> httpx.Response:
        h: dict[str, Any] = {"Cookie": self.cookie}
        if key is not None:
            h["Idempotency-Key"] = key
        h.update(headers or {})
        kw: dict[str, Any] = {}
        if content is not None:
            kw["content"] = content
        elif body is not None:
            kw["json"] = body
        return httpx.request(method, self.base + path, headers=h, timeout=HTTP_TIMEOUT, **kw)

    def view(self, ref: str) -> dict:
        return ok(self.call("GET", f"/api/ops/claims/{ref}"), 200, f"GET claim view {ref}")

    def identify(self, ref: str, model: str = KESTLE, booklet: int = 3, quantity: int = 1) -> httpx.Response:
        return self.call("POST", f"/api/ops/claims/{ref}/identify",
                         {"model": model, "booklet_number": booklet, "quantity": quantity})

    def action(self, ref: str, name: str, body: Any = None, key: Any = None) -> httpx.Response:
        return self.call("POST", f"/api/ops/claims/{ref}/{name}", {} if body is None else body,
                         key=idempotency_key() if key is None else key)

    def quote(self, ref: str, key: Any = None) -> httpx.Response:
        return self.action(ref, "quote", key=key)

    def pay(self, ref: str, key: Any = None) -> httpx.Response:
        return self.action(ref, "payment", key=key)

    def dispatch(self, ref: str, key: Any = None) -> httpx.Response:
        return self.action(ref, "dispatch", key=key)

    def decline(self, ref: str, reason: str = "owner_declined", key: Any = None) -> httpx.Response:
        return self.action(ref, "decline", {"reason": reason}, key=key)

    def close(self, ref: str) -> httpx.Response:
        return self.call("POST", f"/api/ops/claims/{ref}/close", {})

    def withdraw(self, ref: str) -> httpx.Response:
        return self.call("DELETE", f"/api/ops/claims/{ref}/share-link")

    def new_link(self, ref: str) -> httpx.Response:
        return self.call("POST", f"/api/ops/claims/{ref}/share-link", {})

    def erase(self, ref: str, confirm_reference: Any) -> httpx.Response:
        return self.call("POST", f"/api/ops/claims/{ref}/erase", {"confirm_reference": confirm_reference})

    def stats(self) -> dict:
        return ok(self.call("GET", "/api/ops/stats"), 200, "GET /api/ops/stats")

    def import_csv(self, data: bytes, ctype: str = "text/csv") -> httpx.Response:
        return self.call("POST", "/api/ops/imports", content=data, headers={"Content-Type": ctype})


STAGES = ("started", "confirmed", "identified", "quoted", "paid", "dispatched")


def claim_at(base: str, mail: Any, stage: str, op: Operator | None = None, *, model: str = KESTLE,
             booklet: int = 3, quantity: int = 1, **kw: Any) -> dict:
    c = new_claim(base, mail, model=model, booklet=booklet, quantity=quantity, **kw)
    order = STAGES.index(stage)
    ref = c["reference"]
    if order >= 1:
        body = ok(confirm(base, c["token"]), 200, "POST /api/claims/confirm")
        c["share_url"] = body["share_url"]
        c["share_token"] = body["share_url"].rsplit("/", 1)[1]
    if order >= 2:
        ok(op.identify(ref, model, booklet, quantity), 200, "identify")
    if order >= 3:
        ok(op.quote(ref), 200, "quote")
    if order >= 4:
        ok(op.pay(ref), 200, "payment")
    if order >= 5:
        ok(op.dispatch(ref), 200, "dispatch")
    if op is not None:
        c["view"] = op.view(ref)
    return c


def share(base: str, token: str, **kw: Any) -> httpx.Response:
    return get(base, f"/api/share/{token}", **kw)


def kb_state(killbill: Any, ref: str) -> dict:
    acct = killbill.account_by_key(ref)
    if acct is None:
        return {"account": None, "invoices": [], "payments": []}
    aid = acct.get("accountId")
    r = killbill.client.get(f"/accounts/{aid}/invoices",
                            params={"includeInvoiceComponents": "true", "includeVoidedInvoices": "true"})
    assert r.status_code == 200, r.text
    return {"account": acct, "invoices": r.json() or [], "payments": killbill.payments(aid) or []}


def is_void(inv: dict) -> bool:
    return str(inv.get("status", "")).upper() == "VOID"


def kb_current(killbill: Any, ref: str) -> dict:
    st = kb_state(killbill, ref)
    live = [i for i in st["invoices"] if not is_void(i) and i.get("items")]
    assert len(live) == 1, f"Kill Bill should hold exactly one current invoice for {ref}; got {len(live)}"
    inv = live[0]
    parts = [it for it in inv["items"] if str(it.get("description", "")).startswith("Part ")]
    carriage = [it for it in inv["items"] if str(it.get("description", "")).startswith("Carriage band ")]
    assert len(parts) == 1 and len(carriage) == 1, f"invoice items should be one part and one carriage line: {inv['items']}"
    return {"invoice": inv, "part": pence(parts[0]["amount"]), "part_desc": parts[0]["description"],
            "carriage": pence(carriage[0]["amount"]), "carriage_desc": carriage[0]["description"],
            "total": pence(inv["amount"]), "state": st}


def kb_tx(killbill: Any, ref: str, kind: str) -> list[int]:
    out = []
    for p in kb_state(killbill, ref)["payments"]:
        for t in p.get("transactions", []):
            if t.get("transactionType") == kind and t.get("status") == "SUCCESS":
                out.append(pence(t["amount"]))
    return out


def kb_balance_zero(st: dict) -> bool:
    acct = st["account"] or {}
    if "accountBalance" in acct and acct["accountBalance"] is not None:
        return pence(acct["accountBalance"]) == 0
    return sum(pence(i.get("balance", 0)) for i in st["invoices"] if not is_void(i)) == 0


def claim_row(db: Any, ref: str) -> dict | None:
    assert REF_RE.fullmatch(ref.upper()), ref
    rows = db.rows("SELECT reference, state, floor(extract(epoch FROM confirmed_at))::bigint AS confirmed_s, "
                   f"erased_at IS NOT NULL AS erased FROM claims WHERE upper(reference) = '{ref.upper()}'")
    return rows[0] if rows else None


def rows_mentioning(db: Any, needle: str) -> int:
    total = 0
    safe = needle.replace("'", "''")
    for table in db.tables():
        ident = ".".join('"' + p.replace('"', '""') + '"' for p in table.split("."))
        rows = db.rows(f"SELECT count(*)::int AS n FROM {ident} AS t WHERE t::text ILIKE '%{safe}%'")
        total += int(rows[0]["n"])
    return total


def carrier_calls(wiremock: Any) -> list[dict[str, str]]:
    out = []
    for entry in wiremock.requests("/v1/carriage/quote"):
        out.append({k: str(v) for k, v in (entry.get("query") or {}).items()})
    return out


def new_objects_with(s3: Any, before: set[str], marker: bytes) -> list[str]:
    return [k for k in s3.keys("claims/") if k not in before and marker in s3.get(k)]


@contextlib.contextmanager
def browse(browser: Any, url: str, *, viewport: tuple[int, int] = DESKTOP, device_clock: datetime | None = None,
           reduced_motion: str = "no-preference") -> Iterator[Any]:
    with open_app(browser, url, reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        if device_clock is not None:
            page.clock.set_system_time(device_clock)
            page.goto(url)
        yield page


def ui_until(page: Any, check: Callable[[], Any], what: str, seconds: float = UI_WAIT_S, step_ms: int = 100) -> None:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except Exception as exc:
            last = exc
        advance(page, step_ms)
    pytest.fail(f"{what} (within {seconds}s; last error: {last})")


def path_of(page: Any) -> str:
    return urlparse(page.url).path


def wait_path(page: Any, pattern: str, seconds: float = UI_WAIT_S) -> str:
    rx = re.compile(pattern)
    ui_until(page, lambda: rx.search(path_of(page)), f"address bar should reach {pattern}; it shows {page.url}", seconds)
    return path_of(page)


def loc_text(loc: Any) -> str:
    return loc.first.inner_text(timeout=2000) if loc.count() else ""


def has(loc: Any, s: str) -> bool:
    return s in loc_text(loc)


def page_text(page: Any) -> str:
    return page.evaluate("() => document.body ? document.body.innerText : ''")


def focused(loc: Any) -> bool:
    return loc.count() > 0 and loc.first.evaluate("e => e === document.activeElement || e.contains(document.activeElement)")


def ring_ok(page: Any) -> bool:
    for s in page.evaluate(RING_JS):
        if (s["w"] >= FOCUS_RING_MIN and s["style"] != "none") or s["shadow"] not in ("", "none"):
            return True
    return False


def tab_to(page: Any, loc: Any, what: str, back: bool = False, limit: int = TAB_LIMIT) -> None:
    for _ in range(limit):
        if focused(loc):
            return
        page.keyboard.press("Shift+Tab" if back else "Tab")
    if not focused(loc):
        pytest.fail(f"{'Shift+' if back else ''}Tab should reach {what} within {limit} presses")


def box(loc: Any) -> dict:
    b = loc.first.bounding_box()
    assert b, "element should have a bounding box"
    return b


def reveal(loc: Any) -> None:
    loc.first.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")


def box_center(loc: Any) -> tuple[float, float]:
    b = box(loc)
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def near(a: float, b: float, tol: float = TOL) -> bool:
    return abs(a - b) <= tol


def slip(page: Any, lang: str = "en") -> Any:
    return page.get_by_role("region", name=LABELS[lang]["slip"], exact=True)


def fan(page: Any, lang: str = "en") -> Any:
    return page.get_by_role("region", name=LABELS[lang]["fan"], exact=True)


def slider(page: Any, lang: str = "en") -> Any:
    return fan(page, lang).get_by_role("slider", name=LABELS[lang]["slider"], exact=True)


def slider_value(loc: Any) -> str | None:
    return loc.first.evaluate(
        "e => { const v = e.getAttribute('aria-valuenow'); if (v !== null) return v;"
        " return e.value === undefined || e.value === null ? null : String(e.value); }")


def part_button(page: Any, booklet: int, name: str, lang: str = "en") -> Any:
    return page.get_by_role("button", name=f"{LABELS[lang]['part']} {booklet}: {name}", exact=True)


def alert(page: Any) -> Any:
    return page.get_by_role("alert")


def status(page: Any) -> Any:
    return page.get_by_role("status").filter(has_not_text="Decided claims:")


def sbtn(page: Any, name: str) -> Any:
    return slip(page).get_by_role("button", name=name, exact=True)


def choose_part(page: Any, booklet: int, name: str, lang: str = "en") -> None:
    b = part_button(page, booklet, name, lang)
    b.focus()
    page.keyboard.press("Enter")
    ui_until(page, lambda: b.get_attribute("aria-pressed") == "true", f"Enter on part {booklet} marks it pressed")


def file_payload(name: str, data: bytes, mime: str = "image/jpeg") -> dict:
    return {"name": name, "mimeType": mime, "buffer": data}


def ui_fill_claim(page: Any, *, name: str, email: str, postcode: str = POSTCODE, model: str = KESTLE,
                  booklet: int = 3, quantity: int = 1, purchase: str = PURCHASE, files: list | None = None,
                  lang: str = "en", pick: bool = True) -> None:
    L = LABELS[lang]
    ui_until(page, lambda: page.get_by_role("combobox", name=L["model"], exact=True).count() == 1, "claim form renders")
    fill(page.get_by_role("textbox", name=L["name"], exact=True), name)
    fill(page.get_by_role("textbox", name=L["email"], exact=True), email)
    fill(page.get_by_role("textbox", name=L["postcode"], exact=True), postcode)
    select(page.get_by_role("combobox", name=L["model"], exact=True), MODELS[model][0])
    part = MODELS[model][2][booklet - 1]
    ui_until(page, lambda: part_button(page, booklet, part, lang).count() == 1, "the fan draws the chosen model")
    if pick:
        choose_part(page, booklet, part, lang)
    fill(page.get_by_role("spinbutton", name=L["quantity"], exact=True), str(quantity))
    fill(page.get_by_label(L["purchase"], exact=True), purchase)
    page.get_by_label(L["photos"], exact=True).set_input_files(files or [file_payload("damage.jpg", photo_bytes())])


def ui_switch(page: Any, lang: str) -> None:
    group = page.get_by_role("radiogroup", name="Language · Język", exact=True)
    click(group.get_by_role("radio", name=LABELS[lang]["radio"], exact=True))
    want = "pl-PL" if lang == "pl" else "en-GB"
    ui_until(page, lambda: page.evaluate("() => document.documentElement.lang") == want, f"page language becomes {want}")


def ui_sign_in(page: Any, base: str) -> None:
    page.goto(base + "/ops/sign-in")
    ui_until(page, lambda: page.get_by_role("button", name="Sign in", exact=True).count() == 1, "sign-in form renders")
    fill(page.get_by_role("textbox", name="Email", exact=True), OPERATOR_EMAIL)
    fill(page.get_by_label("Password", exact=True), OPERATOR_PASSWORD)
    click(page.get_by_role("button", name="Sign in", exact=True))
    wait_path(page, r"^/ops/claims$")


def ui_workspace(page: Any, base: str, ref: str, stage: str = "") -> None:
    page.goto(f"{base}/ops/claims/{ref}{stage}")
    ui_until(page, lambda: has(slip(page), ref), f"workspace slip shows {ref}")


def open_dialog(page: Any, opener: str, name: str) -> Any:
    click(sbtn(page, opener))
    dlg = page.get_by_role("dialog", name=name, exact=True)
    ui_until(page, lambda: dlg.count() == 1 and dlg.is_visible(), f"{name} dialog opens")
    advance(page, 300)
    return dlg


def ui_decline(page: Any, reason: str) -> None:
    dlg = open_dialog(page, "Decline", "Decline claim")
    click(dlg.get_by_role("radio", name=reason, exact=True))
    click(dlg.get_by_role("button", name="Confirm decline", exact=True))


def no_overflow(page: Any) -> None:
    layout(page)
    w = page.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
    assert w[0] <= w[1], f"document is {w[0]} px wide in a {w[1]} px window"


def aria(loc: Any) -> str:
    return loc.aria_snapshot() if loc.count() else ""


def fan_offset(value: int, k: int, gap: int) -> int:
    return half_up(Decimal(value) / 100 * k * gap)


def fan_scale(value: int) -> str:
    return str((1 - Decimal("0.25") * Decimal(value) / 100).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def set_slider(page: Any, value: int) -> None:
    s = slider(page)
    s.focus()
    page.keyboard.press("Home")
    for _ in range(value // 25):
        page.keyboard.press("PageUp")
    for _ in range((value % 25) // 5):
        page.keyboard.press("ArrowRight")


def check_fan(page: Any, model: str, value: int, gap: int, settled: bool = True) -> None:
    _, axis, names = MODELS[model]
    n = len(names)
    root = fan(page)
    assert root.get_attribute("data-fan-axis") == axis, f"{model} fan axis should be {axis}"
    assert root.get_attribute("data-fan-separation") == str(half_up(Decimal(value) / 100 * gap * (n - 1))), \
        f"data-fan-separation at value {value} should be round(s*g*(n-1)) with g={gap}"
    assert root.get_attribute("data-fan-scale") == fan_scale(value), f"data-fan-scale at value {value}"
    buttons = [part_button(page, k + 1, names[k]) for k in range(n)]
    for k, b in enumerate(buttons):
        assert b.get_attribute("data-part-offset") == str(fan_offset(value, k, gap)), f"part {k + 1} data-part-offset"
    if not settled:
        return
    scale = float(root.get_attribute("data-fan-scale"))
    c0 = box_center(buttons[0])
    for k in range(1, n):
        ck = box_center(buttons[k])
        dx, dy = (ck[0] - c0[0]) / scale, (ck[1] - c0[1]) / scale
        off = fan_offset(value, k, gap)
        exp = {"x": (off, 0.0), "y": (0.0, off),
               "iso": (off * math.cos(math.radians(30)), -off * math.sin(math.radians(30)))}[axis]
        assert abs(dx - exp[0]) <= TOL and abs(dy - exp[1]) <= TOL, \
            f"{model} part {k + 1} sits at ({dx:.1f},{dy:.1f}) from part 1; expected {exp} along {axis}"


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Relay:
    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = free_port()
        self.sock: socket.socket | None = None
        self.conns: list[socket.socket] = []

    def start(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.sock = s
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while self.sock is not None:
            try:
                client, _ = self.sock.accept()
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                return
            self.conns += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        try:
            while chunk := a.recv(65536):
                b.sendall(chunk)
        except OSError:
            pass
        with contextlib.suppress(OSError):
            b.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        s, self.sock = self.sock, None
        if s is not None:
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
            s.close()
        for c in self.conns:
            with contextlib.suppress(OSError):
                c.close()
        self.conns = []


def with_hostport(url: str, host: str, port: int) -> str:
    p = urlparse(url)
    userinfo = p.netloc.rsplit("@", 1)[0] + "@" if "@" in p.netloc else ""
    return p._replace(netloc=f"{userinfo}{host}:{port}").geturl()


@contextlib.contextmanager
def spawn_copy(overrides: dict[str, str]) -> Iterator[str]:
    manifest_path = APP / "run.json" if (APP / "run.json").exists() else Path(DEPLOYED_APP) / "run.json"
    serve = json.loads(manifest_path.read_text())["serve"]
    port = free_port()
    env = dict(os.environ)
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=str(DEPLOYED_APP), env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_bytes()[-3000:].decode("utf-8", "replace")

    try:
        deadline = time.monotonic() + BOOT_WAIT_S
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"spawned copy exited with {proc.returncode}; log tail:\n{tail()}")
            with contextlib.suppress(httpx.HTTPError):
                if httpx.get(base + "/api/health", timeout=2).status_code == 200:
                    break
            pause()
        else:
            pytest.fail(f"spawned copy never answered /api/health; log tail:\n{tail()}")
        yield base
        assert proc.poll() is None, f"spawned copy exited while a service was down; log tail:\n{tail()}"
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=15)
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)


def proxy_to(base: str) -> Callable[[Any], None]:

    def handler(route: Any) -> None:
        req = route.request
        headers = {k: v for k, v in req.all_headers().items()
                   if k.lower() not in ("host", "origin", "referer", "content-length", "connection")}
        u = urlparse(req.url)
        r = httpx.request(req.method, base + u.path + (f"?{u.query}" if u.query else ""), headers=headers,
                          content=req.post_data_buffer, timeout=HTTP_TIMEOUT)
        route.fulfill(status=r.status_code, body=r.content,
                      headers={"content-type": r.headers.get("content-type", "application/json")})

    return handler


def test_wf_claim_start_happy(browser: Any, app_url: str, mail: Any) -> None:
    name, email = owner()
    marker = uuid.uuid4().hex.encode()
    shots = [("crack.jpg", photo_bytes("jpeg", marker), "image/jpeg"), ("side.png", photo_bytes("png", marker), "image/png")]
    with browse(browser, app_url + "/", viewport=PHONE) as page:
        click(page.get_by_role("link", name="Start a claim", exact=True))
        wait_path(page, r"^/claim/new$")
        ui_fill_claim(page, name=name, email=email, files=[file_payload(n, d, m) for n, d, m in shots])
        click(page.get_by_role("button", name="Start claim", exact=True))
        path = wait_path(page, r"^/claim/HG-[A-Z0-9]{6}/sent$")
        ref = path.split("/")[2]
        assert REF_RE.fullmatch(ref), f"reference {ref} should match the published pattern"
        ui_until(page, lambda: page.get_by_role("heading", name="Check your email").count() == 1, "sent page heading")
        msg = inbox(mail, email, confirm_subject(ref))[0]
        status_body = ok(get(app_url, f"/api/claims/{ref}/confirmation"), 200, "confirmation status")
        line = lifetime_line(status_body["confirm_by"])
        ui_until(page, lambda: line in page_text(page), f"sent page shows {line!r}")
        assert f"We've emailed a link to confirm claim {ref}. Open it on any device." in page_text(page)
        assert line in text(msg), "the confirmation email carries the same link-lifetime line"
        assert token_from(msg) not in page.content(), "the sent page never shows the confirmation token"
        page.reload()
        ui_until(page, lambda: line in page_text(page), "cold reload of the sent page shows the same line")
    s3 = S3()
    assert sorted(s3.keys(f"claims/{ref}/photos/")) == [f"claims/{ref}/photos/1", f"claims/{ref}/photos/2"]
    for i, (_, data, _) in enumerate(shots, 1):
        assert s3.get(f"claims/{ref}/photos/{i}") == data, f"photo {i} is stored byte for byte"
    assert len(Operator(app_url).view(ref)["photos"]) == 2
    assert len(mine(mail, email)) == 1, "exactly one confirmation message"


def test_claim_form_breakpoints(browser: Any, app_url: str) -> None:
    for w, h in VIEWPORTS:
        with browse(browser, app_url + "/claim/new", viewport=(w, h)) as page:
            select(page.get_by_role("combobox", name="Model", exact=True), MODELS[KESTLE][0])
            ui_until(page, lambda: fan(page).count() == 1, "fan draws")
            f, name_box = box(fan(page)), box(page.get_by_role("textbox", name="Your name", exact=True))
            no_overflow(page)
            margin = MARGIN_NARROW if w < 768 else MARGIN_WIDE
            assert f["x"] >= margin - TOL, f"{w}: fan inside the page margin"
            assert name_box["x"] + name_box["width"] <= w - margin + TOL, f"{w}: form inside the page margin"
            if w < 768:
                assert f["y"] + f["height"] <= name_box["y"] + TOL, f"{w}: fan above the form"
            else:
                assert f["x"] < name_box["x"], f"{w}: fan left edge left of the form"
                assert name_box["x"] - (f["x"] + f["width"]) >= GUTTER_MIN - TOL, f"{w}: gutter at least 40 px"


def test_wf_claim_start_photo_refusal(browser: Any, app_url: str, mail: Any) -> None:
    name, email = owner()
    with browse(browser, app_url + "/claim/new") as page:
        ui_fill_claim(page, name=name, email=email,
                      files=[file_payload("notes.jpg", b"plain text renamed", "image/jpeg"),
                             file_payload("good.jpg", photo_bytes())])
        click(page.get_by_role("button", name="Start claim", exact=True))
        msg = NOT_A_PHOTO[0].format(f="notes.jpg")
        ui_until(page, lambda: has(alert(page), msg), "alert names the disguised photo")
        assert alert(page).count() == 1
        assert alert(page).first.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"), \
            "focus moves to the alert region"
        assert path_of(page) == "/claim/new"
        page.get_by_label("Damage photos", exact=True).set_input_files([
            file_payload("good.png", photo_bytes("png")),
            file_payload("big.jpg", photo_bytes("jpeg", size=PHOTO_CAP + 1)),
            file_payload("fake.gif", b"GIF89a" + b"\x00" * 64, "image/gif")])
        click(page.get_by_role("button", name="Start claim", exact=True))
        big, gif = TOO_LARGE[0].format(f="big.jpg"), NOT_A_PHOTO[0].format(f="fake.gif")
        ui_until(page, lambda: big in page_text(page) and gif in page_text(page), "each refused photo is listed")
        assert has(alert(page), big) or has(alert(page), gif)
        ui_switch(page, "pl")
        click(page.get_by_role("button", name="Wyślij zgłoszenie", exact=True))
        pbig, pgif = TOO_LARGE[1].format(f="big.jpg"), NOT_A_PHOTO[1].format(f="fake.gif")
        ui_until(page, lambda: pbig in page_text(page) and pgif in page_text(page), "Polish photo refusals")
        page.get_by_label("Zdjęcia uszkodzeń", exact=True).set_input_files([file_payload("ok.webp", photo_bytes("webp"), "image/webp")])
        click(page.get_by_role("button", name="Wyślij zgłoszenie", exact=True))
        ref = wait_path(page, r"^/claim/HG-[A-Z0-9]{6}/sent$").split("/")[2]
    inbox(mail, email, confirm_subject(ref, "pl"))
    assert S3().keys(f"claims/{ref}/photos/") == [f"claims/{ref}/photos/1"]


def test_wf_claim_start_newest_estimate(browser: Any, app_url: str) -> None:
    name, email = owner()
    with browse(browser, app_url + "/claim/new") as page:
        ui_fill_claim(page, name=name, email=email, postcode=POSTCODE_ZE)
        region = page.get_by_role("region", name="Carriage estimate", exact=True)
        region.evaluate("el => { window.__estimates = []; new MutationObserver(() => window.__estimates.push(el.innerText))"
                        ".observe(el, {subtree: true, childList: true, characterData: true}); }")
        held_routes: list[Any] = []

        def hold_first(route: Any) -> None:
            if not held_routes:
                held_routes.append(route)
                return
            route.continue_()

        page.route("**/api/carriage-estimate*", hold_first)
        button = region.get_by_role("button", name="Estimate carriage", exact=True)
        click(button)
        ui_until(page, lambda: held_routes, "first estimate request is held")
        assert button.is_enabled(), "Estimate carriage stays enabled while an estimate is pending"
        fill(page.get_by_role("textbox", name="Postcode", exact=True), POSTCODE)
        click(button)
        newest = f"Band {DEFAULT_BAND} · {money(DEFAULT_CHARGE)}"
        ui_until(page, lambda: has(region, newest), f"region shows {newest}")
        with contextlib.suppress(Exception):
            held_routes[0].continue_()
        deadline = time.monotonic() + OBSERVE_S
        while time.monotonic() < deadline:
            assert f"Band {ZE_BAND}" not in loc_text(region), "older ZE answer must never replace the newest"
            advance(page, 200)
        seen = page.evaluate("() => window.__estimates")
        assert not any(f"Band {ZE_BAND}" in s for s in seen), "older answer never shown, even for a moment"
        assert has(region, newest)
        page.unroute("**/api/carriage-estimate*")


def test_wf_claim_start_minio_outage(browser: Any, app_url: str, mail: Any) -> None:
    base = copy_url("minio-down")
    name, email = owner()
    marker = uuid.uuid4().hex.encode()
    before = set(S3().keys("claims/"))
    files = [file_payload("a.jpg", photo_bytes("jpeg", marker))]
    with browse(browser, base + "/claim/new") as page:
        ui_fill_claim(page, name=name, email=email, files=files)
        click(page.get_by_role("button", name="Start claim", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["storage_unavailable"][0]), "storage outage copy in alert")
        assert path_of(page) == "/claim/new"
    assert rows_mentioning(Postgres(), email) == 0, "no row remains from the failed start"
    assert not new_objects_with(S3(), before, marker), "no photo object remains"
    assert not mine(mail, email), "no email was sent"
    with browse(browser, app_url + "/claim/new") as page:
        ui_fill_claim(page, name=name, email=email, files=files)
        click(page.get_by_role("button", name="Start claim", exact=True))
        ref = wait_path(page, r"^/claim/HG-[A-Z0-9]{6}/sent$").split("/")[2]
    assert S3().get(f"claims/{ref}/photos/1") == files[0]["buffer"]


def test_photo_bytes_rules(app_url: str) -> None:
    _, email = owner()
    j = photo_bytes()
    cases = [
        ([("a.jpg", j, "image/jpeg"), ("b.png", photo_bytes("png"), "image/png"), ("c.webp", photo_bytes("webp"), "image/webp")], {}),
        ([("photo.gif", j, "image/gif")], {}),
        ([("edge.jpg", photo_bytes(size=PHOTO_CAP), "image/jpeg")], {}),
        ([("evil.jpg", b"just text", "image/jpeg")], {"photos.1": "not_a_photo"}),
        ([("x.png", b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", "image/png")], {"photos.1": "not_a_photo"}),
        ([("x.jpg", b"GIF89a" + b"\x00" * 32, "image/jpeg")], {"photos.1": "not_a_photo"}),
        ([("x.jpg", b"%PDF-1.7" + b"\x00" * 32, "image/jpeg")], {"photos.1": "not_a_photo"}),
        ([("empty.jpg", b"", "image/jpeg")], {"photos.1": "not_a_photo"}),
        ([("big.jpg", photo_bytes(size=PHOTO_CAP + 1), "image/jpeg")], {"photos.1": "too_large"}),
        ([("both.jpg", b"t" * (PHOTO_CAP + 1), "image/jpeg")], {"photos.1": "not_a_photo"}),
        ([("ok.jpg", j, "image/jpeg"), ("bad.jpg", b"text", "image/jpeg"), ("big.jpg", photo_bytes(size=PHOTO_CAP + 1), "image/jpeg")],
         {"photos.2": "not_a_photo", "photos.3": "too_large"}),
        ([], {"photos": "count"}),
        ([("1.jpg", j, "image/jpeg")] * 4 + [("5.jpg", b"text", "image/jpeg")], {"photos": "count", "photos.5": "not_a_photo"}),
    ]
    for files, expected in cases:
        r = start_claim(app_url, email, photos=files)
        label = [f[0] for f in files]
        if not expected:
            ok(r, 201, f"photos {label}")
            continue
        e = err(r, 422, "validation_failed", FIELDS_MESSAGE, f"photos {label}")
        for field, code in expected.items():
            assert e["fields"].get(field) == code, f"{label}: fields.{field} should be {code}; got {e['fields']}"
        assert "photos.1" in e["fields"] or "photos.1" not in expected
        assert not any(k.startswith("photos.") and k not in expected for k in e["fields"]), \
            f"{label}: only refused files are reported; got {e['fields']}"
    r = ok(start_claim(app_url, email, photos=[("../../etc/passwd.jpg", j, "text/plain")]), 201, "traversal name")
    ref = r["reference"]
    assert S3().keys(f"claims/{ref}/") == [f"claims/{ref}/photos/1"], "file names never reach a storage key"
    op = Operator(app_url)
    pr = op.call("GET", f"/api/ops/claims/{ref}/photos/1")
    assert pr.status_code == 200 and pr.content == j
    assert pr.headers.get("content-type", "").startswith("image/jpeg"), "photo served with its detected type"
    assert pr.headers.get("x-content-type-options") == "nosniff"
    big = start_claim(app_url, email, photos=[("p.jpg", photo_bytes(size=PHOTO_CAP), "image/jpeg")] * 4)
    ok(big, 201, "four 8,000,000-byte photos fit the 33,000,000-byte body")
    try:
        too = start_claim(app_url, email, photos=[("p.jpg", photo_bytes(size=PHOTO_CAP), "image/jpeg")] * 5)
    except (httpx.WriteError, httpx.ReadError, httpx.RemoteProtocolError):
        too = None
    if too is not None:
        err(too, 413, "request_too_large", None, "five 8 MB photos")
    assert ok(get(app_url, "/api/health")) == {"status": "ok"}, "the desk still serves after refusing the oversize body"


def test_claim_start_all_or_nothing(app_url: str, mail: Any) -> None:
    for copy, code in (("mailpit-down", "mail_unavailable"), ("minio-down", "storage_unavailable"),
                       ("postgres-down", "database_unavailable")):
        _, email = owner()
        marker = uuid.uuid4().hex.encode()
        s3 = copy_s3(copy if copy == "postgres-down" else None)
        before = set(s3.keys("claims/"))
        r = start_claim(copy_url(copy), email, photos=[("m.jpg", photo_bytes("jpeg", marker), "image/jpeg")])
        err(r, 503, code, OWN[code][0], f"claim start on {copy}")
        if copy != "postgres-down":
            assert rows_mentioning(Postgres(), email) == 0, f"{copy}: no row remains"
        assert not new_objects_with(s3, before, marker), f"{copy}: no object remains"
        assert not mine(mail, email), f"{copy}: no email"
        ok(start_claim(app_url, email, photos=[("m.jpg", photo_bytes("jpeg", marker), "image/jpeg")]), 201, "main recovers")


def test_carriage_estimate(browser: Any, app_url: str, wiremock: Any) -> None:
    q = {"model": KESTLE, "part": 3, "quantity": EXAMPLE_QUANTITY, "postcode": POSTCODE}
    r = ok(get(app_url, "/api/carriage-estimate", params=q), 200, "estimate")
    assert (r["band"], r["charge_minor"], r["currency"]) == (DEFAULT_BAND, DEFAULT_CHARGE, "GBP")
    assert isinstance(r["valid_until"], str) and r["valid_until"].endswith("Z"), "valid_until is a UTC instant ending in Z"
    assert instant(r["valid_until"]) == instant(VALID_UNTIL), "valid_until is the carrier's instant"
    want = {"weight_g": str(PIN_WEIGHT * EXAMPLE_QUANTITY), "longest_side_mm": str(PIN_SIDE), "postcode_area": "SW"}
    assert want in carrier_calls(wiremock), "the carrier was asked with weight, longest side and postcode area"
    r = ok(get(app_url, "/api/carriage-estimate", params={**q, "postcode": POSTCODE_ZE}), 200, "ZE estimate")
    assert (r["band"], r["charge_minor"]) == (ZE_BAND, ZE_CHARGE)
    r = ok(get(app_url, "/api/carriage-estimate", params={**q, "model": ALDRA, "part": 1, "quantity": 1}), 200, "large part")
    assert (r["band"], r["charge_minor"]) == (LARGE_BAND, LARGE_CHARGE)
    for postcode, status_code, code in ((POSTCODE_IV, 504, "carrier_timeout"), (POSTCODE_HS, 503, "carrier_unavailable"),
                                        (POSTCODE_KW, 502, "carrier_malformed")):
        err(get(app_url, "/api/carriage-estimate", params={**q, "postcode": postcode}), status_code, code, OWN[code][0], postcode)
    err(get(copy_url("carrier-down"), "/api/carriage-estimate", params=q), 503, "carrier_unavailable", OWN["carrier_unavailable"][0])
    calls = len(carrier_calls(wiremock))
    err(get(app_url, "/api/carriage-estimate", params={**q, "part": WITHDRAWN_BOOKLET, "postcode": POSTCODE_HS}), 409,
        "part_withdrawn", PART_WITHDRAWN_OWNER.format(n=WITHDRAWN_BOOKLET), "withdrawn part")
    assert len(carrier_calls(wiremock)) == calls, "a withdrawn part is refused before any carrier call"
    err(get(app_url, "/api/carriage-estimate", params={**q, "model": "no-such-model"}), 404, "not_found", PART_NOT_FOUND)
    e = err(get(app_url, "/api/carriage-estimate", params={**q, "part": 0, "quantity": QUANTITY_MAX + 1, "postcode": "nonsense"}),
            422, "validation_failed", FIELDS_MESSAGE)
    assert {e["fields"].get(k) for k in ("part", "quantity", "postcode")} == {"invalid"}
    name, email = owner()
    with browse(browser, app_url + "/claim/new") as page:
        ui_fill_claim(page, name=name, email=email, postcode=POSTCODE_HS)
        region = page.get_by_role("region", name="Carriage estimate", exact=True)
        click(region.get_by_role("button", name="Estimate carriage", exact=True))
        ui_until(page, lambda: has(region, OWN["carrier_unavailable"][0]) or has(alert(page), OWN["carrier_unavailable"][0]),
                 "failing carrier copy shows")
        start = page.get_by_role("button", name="Start claim", exact=True)
        assert start.is_enabled(), "a failed estimate never disables Start claim"
        click(start)
        wait_path(page, r"^/claim/HG-[A-Z0-9]{6}/sent$")


def test_confirmation_email(app_url: str, mail: Any) -> None:
    name, email = owner()
    t0 = time.monotonic()
    body = ok(start_claim(app_url, email, name=name, description="probe-desc-" + uuid.uuid4().hex), 201, "claim start")
    ref = body["reference"]
    msg = inbox(mail, email, confirm_subject(ref), seconds=CONFIRM_MAIL_S + 2)[0]
    assert time.monotonic() - t0 <= CONFIRM_MAIL_S + POLL_S * 4, "confirmation email arrives within 10 seconds"
    assert MAIL_FROM_ADDRESS in [a.lower() for a in addresses(msg.get("From"))]
    token = token_from(msg)
    assert len(token) >= TOKEN_MIN
    assert lifetime_line(body["confirm_by"]) in text(msg)
    assert name not in text(msg) and POSTCODE not in text(msg)
    holds_for(lambda: len(mine(mail, email)) == 1, 3, "exactly one confirmation message")
    pl = ok(start_claim(copy_url("ttl-one"), email, language="pl-PL"), 201, "Polish claim")
    pmsg = inbox(mail, email, confirm_subject(pl["reference"], "pl"))[0]
    assert TTL_ONE_LINE_PL in text(pmsg), "Polish lifetime line with the server's frozen closing time"


def test_wf_confirm_claim_happy(browser: Any, app_url: str, mail: Any) -> None:
    c = new_claim(app_url, mail)
    ref = c["reference"]
    with browse(browser, f"{app_url}/confirm/{c['token']}") as page:
        button = page.get_by_role("button", name="Confirm my claim", exact=True)
        ui_until(page, lambda: button.count() == 1 and button.is_enabled(), "confirm button enabled")
        assert claim_row(Postgres(), ref)["state"] == "started", "nothing confirmed before the press"
        with held(page, "**/api/claims/confirm") as gate:
            click(button)
            ui_until(page, lambda: button.is_disabled() and has(status(page), "Confirming…"), "pending state")
            gate.release()
        path = wait_path(page, r"^/s/[A-Za-z0-9_\-]+$")
        ui_until(page, lambda: has(slip(page), "Confirmed"), "share page shows Confirmed")
        assert page.get_by_role("heading", name=f"Claim {ref}").count() == 1
        page.reload()
        ui_until(page, lambda: has(slip(page), "Confirmed"), "cold reload keeps Confirmed")
    with browse(browser, app_url + path) as fresh:
        ui_until(fresh, lambda: has(slip(fresh), "Confirmed"), "fresh browser shows Confirmed")
    assert claim_row(Postgres(), ref)["state"] == "confirmed"
    assert ok(share(app_url, path.rsplit("/", 1)[1]), 200)["state"] == "confirmed"


def test_wf_confirm_claim_device_clock(browser: Any, mail: Any) -> None:
    base = copy_url("ttl-one")
    op = Operator(base)
    c = new_claim(base, mail, quantity=EXAMPLE_QUANTITY)
    ref = c["reference"]
    with browse(browser, f"{base}/claim/{ref}/sent", device_clock=DEVICE_CLOCK) as page:
        ui_until(page, lambda: TTL_ONE_LINE_EN in page_text(page), "sent page shows the server's closing time")
        page.goto(f"{base}/confirm/{c['token']}")
        button = page.get_by_role("button", name="Confirm my claim", exact=True)
        ui_until(page, lambda: button.count() == 1 and button.is_enabled(), "button enabled whatever the device clock")
        click(button)
        path = wait_path(page, r"^/s/")
        ok(op.identify(ref, KESTLE, 3, EXAMPLE_QUANTITY), 200, "identify")
        ok(op.quote(ref), 200, "quote")
        page.reload()
        cover = anniversary(date.fromisoformat(PURCHASE), STANDARD_MONTHS)
        for line in ("Inside aftercare", f"Cover until 00:00 on {date_text(cover)}", f"Ruled by edition {AC_2026}",
                     f"Same-working-day dispatch: leaves the workshop on {date_text(FROZEN['ttl-one'].date())}"):
            ui_until(page, lambda line=line: has(slip(page), line), f"share slip shows {line!r}")
        click(slip(page).get_by_role("button", name="Claim history", exact=True))
        ui_until(page, lambda: has(slip(page), "Confirmed, 10:00 on 15 July 2026"), "history uses the server instant")
    assert path.startswith("/s/")


def test_wf_confirm_claim_layout(browser: Any, app_url: str, mail: Any) -> None:
    c = new_claim(app_url, mail)
    for w, h in VIEWPORTS:
        with browse(browser, f"{app_url}/confirm/{c['token']}", viewport=(w, h)) as page:
            group = page.get_by_role("radiogroup", name="Language · Język", exact=True)
            heading = page.get_by_role("heading", name="Confirm your claim", exact=True)
            button = page.get_by_role("button", name="Confirm my claim", exact=True)
            ui_until(page, lambda: button.count() == 1, "confirm page renders")
            g, hd, b = box(group), box(heading), box(button)
            assert g["y"] < hd["y"] < b["y"], f"{w}: header, heading, button in order"
            assert b["height"] >= TARGET_MIN - TOL
            no_overflow(page)
            if w < 768:
                assert near(b["x"], COLUMN_LEFT) and near(b["x"] + b["width"], COLUMN_RIGHT), f"{w}: button spans 16..359"
            else:
                left = (w - CONFIRM_COLUMN) / 2
                assert near(hd["x"], left), f"{w}: 560 px column centred (heading left {hd['x']})"
                assert near(b["x"], hd["x"]), f"{w}: button left edge lines up with heading"
                assert b["width"] < CONFIRM_COLUMN - TOL, f"{w}: button keeps its natural width"
            ui_switch(page, "pl")
            pb = box(page.get_by_role("button", name="Potwierdzam zgłoszenie", exact=True))
            ph = box(page.get_by_role("heading", name="Potwierdź zgłoszenie", exact=True))
            assert near(ph["x"], hd["x"]) and near(pb["x"], b["x"]), f"{w}: Polish left edges match English"
            if w < 768:
                assert near(pb["width"], b["width"]), f"{w}: full-width button keeps its width in Polish"
            no_overflow(page)


def test_wf_confirm_claim_agreement(browser: Any, app_url: str, mail: Any) -> None:
    c = new_claim(app_url, mail)
    ref, email = c["reference"], c["email"]
    line = lifetime_line(c["confirm_by"])
    assert line in text(c["message"])
    with browse(browser, f"{app_url}/claim/{ref}/sent") as page:
        ui_until(page, lambda: line in page_text(page), "sent page line names the same minute")
        page.goto(f"{app_url}/confirm/{c['token']}")
        click(page.get_by_role("button", name="Confirm my claim", exact=True))
        path = wait_path(page, r"^/s/")
        token = path.rsplit("/", 1)[1]
        view = ok(share(app_url, token), 200)
        row = claim_row(Postgres(), ref)
        assert row["state"] == "confirmed" and view["history"][1]["state"] == "confirmed"
        assert int(row["confirmed_s"]) == math.floor(instant(view["history"][1]["at"]).timestamp()), \
            "Postgres confirmed_at equals history[1].at to the second"
        entry = history_line("confirmed", view["history"][1]["at"])
        click(slip(page).get_by_role("button", name="Claim history", exact=True))
        ui_until(page, lambda: has(slip(page), entry), f"history entry {entry!r}")
        page.goto(f"{app_url}/claim/{ref}/sent")
        ui_until(page, lambda: "This claim is already confirmed. Follow it through your share link." in page_text(page),
                 "sent page shows the used-link copy")
    holds_for(lambda: len(mine(mail, email)) == 1, 3, "exactly one message after confirming")
    err(confirm(app_url, c["token"]), 409, "link_used", OWN["link_used"][0], "second confirm")
    assert claim_row(Postgres(), ref)["confirmed_s"] == row["confirmed_s"], "second confirm leaves the row"
    assert len(mine(mail, email)) == 1


def test_wf_confirm_claim_lapsed_edge(browser: Any, mail: Any) -> None:
    base = copy_url("short-timer")
    c = new_claim(base, mail)
    ref = c["reference"]
    assert ok(get(base, f"/api/claims/{ref}/confirmation"))["link_state"] == "live"
    with browse(browser, f"{base}/confirm/{c['token']}") as page:
        button = page.get_by_role("button", name="Confirm my claim", exact=True)
        ui_until(page, lambda: button.count() == 1, "confirm page renders")
        poll(lambda: get(base, f"/api/claims/{ref}/confirmation").json().get("link_state") == "lapsed",
             "server reports the link lapsed at its closing instant", SHORT_TTL_S + UI_WAIT_S)
        click(button)
        ui_until(page, lambda: has(alert(page), OWN["link_lapsed"][0]), "lapsed copy in alert")
        assert path_of(page).startswith("/confirm/")
        ui_until(page, lambda: button.is_enabled(), "button enabled again after a refusal")
        page.goto(f"{base}/claim/{ref}/sent")
        ui_until(page, lambda: OWN["link_lapsed"][0] in page_text(page), "sent page shows the lapsed refusal")
        assert "This link works until" not in page_text(page)
    err(confirm(base, c["token"]), 410, "link_lapsed", OWN["link_lapsed"][0])
    assert claim_row(copy_pg("short-timer"), ref)["state"] == "started"


def test_wf_confirm_claim_zero_ttl(browser: Any, mail: Any) -> None:
    base = copy_url("zero-ttl")
    c = new_claim(base, mail, language="pl-PL")
    st = ok(get(base, f"/api/claims/{c['reference']}/confirmation"))
    assert st["link_state"] == "lapsed"
    with browse(browser, f"{base}/confirm/{c['token']}") as page:
        ui_switch(page, "pl")
        click(page.get_by_role("button", name="Potwierdzam zgłoszenie", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["link_lapsed"][1]), "Polish lapsed copy")
    assert claim_row(copy_pg("zero-ttl"), c["reference"])["state"] == "started"


def test_wf_confirm_claim_reused_link(browser: Any, app_url: str, mail: Any) -> None:
    c = new_claim(app_url, mail)
    ok(confirm(app_url, c["token"]), 200)
    with browse(browser, f"{app_url}/confirm/{c['token']}") as page:
        click(page.get_by_role("button", name="Confirm my claim", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["link_used"][0]), "used-link copy")
        page.goto(f"{app_url}/confirm/{secrets.token_urlsafe(32)}")
        click(page.get_by_role("button", name="Confirm my claim", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["link_unknown"][0]), "unknown-link copy")
    err(confirm(app_url, c["token"]), 409, "link_used", OWN["link_used"][0])


def test_wf_confirm_claim_unknown_refs(app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    a = new_claim(app_url, mail)
    b = claim_at(app_url, mail, "confirmed", op)
    erased = new_claim(app_url, mail)
    ok(op.erase(erased["reference"], erased["reference"]), 200, "erase")
    unknown = get(app_url, f"/api/claims/{random_ref()}/confirmation")
    err(unknown, 404, "claim_unknown", OWN["claim_unknown"][0])
    for ref in (MALFORMED_REF, erased["reference"]):
        assert get(app_url, f"/api/claims/{ref}/confirmation").content == unknown.content, f"{ref} looks unknown"
    t_unknown = confirm(app_url, secrets.token_urlsafe(32))
    err(t_unknown, 404, "link_unknown", OWN["link_unknown"][0])
    for r in (confirm(app_url, a["token"], b["reference"]), confirm(app_url, a["token"], MALFORMED_REF),
              post(app_url, "/api/claims/confirm", {"token": "", "reference": MALFORMED_REF}),
              confirm(app_url, b["share_token"]), confirm(app_url, erased["token"])):
        assert r.status_code == 404 and r.content == t_unknown.content, f"expected unknown-link bytes; got {r.text}"
    assert claim_row(Postgres(), a["reference"])["state"] == "started", "nothing changed"
    assert len(mine(mail, a["email"])) == 1
    ok(confirm(app_url, a["token"], a["reference"].lower()), 200, "body reference may differ only in case")


def test_wf_confirm_claim_records_outage(browser: Any, app_url: str, mail: Any) -> None:
    c = new_claim(app_url, mail)
    with browse(browser, f"{copy_url('postgres-down')}/confirm/{c['token']}") as page:
        button = page.get_by_role("button", name="Confirm my claim", exact=True)
        click(button)
        ui_until(page, lambda: has(alert(page), OWN["database_unavailable"][0]), "records copy")
        assert path_of(page).startswith("/confirm/") and button.is_enabled()
    with browse(browser, f"{app_url}/confirm/{c['token']}") as page:
        click(page.get_by_role("button", name="Confirm my claim", exact=True))
        wait_path(page, r"^/s/")
    assert claim_row(Postgres(), c["reference"])["state"] == "confirmed"


def test_wf_confirm_claim_polish(browser: Any, mail: Any) -> None:
    base = copy_url("ttl-one")
    c = new_claim(base, mail, language="pl-PL")
    ref = c["reference"]
    assert TTL_ONE_LINE_PL in text(c["message"])
    with browse(browser, f"{base}/claim/{ref}/sent") as page:
        ui_switch(page, "pl")
        for s in ("Sprawdź pocztę", TTL_ONE_LINE_PL,
                  f"Wysłaliśmy e-mailem link do potwierdzenia zgłoszenia {ref}. Otwórz go na dowolnym urządzeniu."):
            ui_until(page, lambda s=s: s in page_text(page), f"sent page shows {s!r}")
        page.goto(f"{base}/confirm/{c['token']}")
        ui_until(page, lambda: page.get_by_role("heading", name="Potwierdź zgłoszenie").count() == 1, "Polish heading")
        click(page.get_by_role("button", name="Potwierdzam zgłoszenie", exact=True))
        wait_path(page, r"^/s/")
        ui_until(page, lambda: has(slip(page, "pl"), "Potwierdzone"), "Polish state name")
        assert page.get_by_role("heading", name=f"Zgłoszenie {ref}").count() == 1
        click(slip(page, "pl").get_by_role("button", name="Historia zgłoszenia", exact=True))
        ui_until(page, lambda: has(slip(page, "pl"), "Potwierdzone, 10:00 dnia 15 lipca 2026"), "Polish history entry")


def test_confirm_link_edges(mail: Any) -> None:
    base = copy_url("ttl-one")
    c = new_claim(base, mail)
    assert instant(c["confirm_by"]) == FROZEN["ttl-one"] + timedelta(seconds=1)
    assert ok(confirm(base, c["token"]))["state"] == "confirmed"
    err(confirm(base, c["token"]), 409, "link_used", OWN["link_used"][0])
    assert ok(get(base, f"/api/claims/{c['reference']}/confirmation"))["link_state"] == "used"
    z = new_claim(copy_url("zero-ttl"), mail)
    assert instant(z["confirm_by"]) <= instant(ok(Operator(copy_url("zero-ttl")).call(
        "GET", f"/api/ops/claims/{z['reference']}"))["started_at"])
    err(confirm(copy_url("zero-ttl"), z["token"]), 410, "link_lapsed", OWN["link_lapsed"][0])
    s = new_claim(copy_url("short-timer"), mail)
    poll(lambda: get(copy_url("short-timer"), f"/api/claims/{s['reference']}/confirmation").json().get("link_state")
         == "lapsed", "short-timer link lapses", SHORT_TTL_S + UI_WAIT_S)
    err(confirm(copy_url("short-timer"), s["token"]), 410, "link_lapsed", OWN["link_lapsed"][0])


def test_operator_sign_in(browser: Any, app_url: str) -> None:
    err(post(app_url, "/api/ops/session", {"email": OPERATOR_EMAIL, "password": "wrong"}), 401, "bad_credentials",
        OPS["bad_credentials"])
    r = post(app_url, "/api/ops/session", {"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD})
    assert r.status_code == 204
    raw = r.headers.get_list("set-cookie")[0].lower()
    assert "HttpOnly".lower() in raw and "SameSite=Strict".lower() in raw
    for method, path in (("GET", "/api/ops/claims"), ("GET", "/api/ops/stats"), ("GET", "/api/ops/editions"),
                         ("POST", f"/api/ops/claims/{random_ref()}/identify")):
        err(httpx.request(method, app_url + path, json={} if method == "POST" else None, timeout=HTTP_TIMEOUT),
            401, "unauthenticated", None, f"{method} {path} without a session")
    cookie = session_cookie(r)
    assert httpx.delete(app_url + "/api/ops/session", headers={"Cookie": cookie}, timeout=HTTP_TIMEOUT).status_code == 204
    assert get(app_url, "/api/ops/stats", headers={"Cookie": cookie}).status_code == 401, "signed-out session refused"
    with browse(browser, app_url + "/ops/claims") as page:
        wait_path(page, r"^/ops/sign-in$")
        fill(page.get_by_role("textbox", name="Email", exact=True), OPERATOR_EMAIL)
        fill(page.get_by_label("Password", exact=True), "wrong")
        click(page.get_by_role("button", name="Sign in", exact=True))
        ui_until(page, lambda: has(alert(page), OPS["bad_credentials"]), "bad-credentials alert")
        ui_sign_in(page, app_url)
        assert page.get_by_role("table", name="Claims").count() == 1
    zr = post(copy_url("zero-session"), "/api/ops/session", {"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD})
    assert zr.status_code == 204
    err(get(copy_url("zero-session"), "/api/ops/stats", headers={"Cookie": session_cookie(zr)}), 401, "unauthenticated")
    short = Operator(copy_url("short-session"))
    assert short.call("GET", "/api/ops/stats").status_code == 200, "session works before its end"
    poll(lambda: short.call("GET", "/api/ops/stats").status_code == 401, "short session ends",
         SHORT_SESSION_S + UI_WAIT_S)


def test_wf_identify_and_rule_happy(browser: Any, mail: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "confirmed", quantity=EXAMPLE_QUANTITY)
    ref = c["reference"]
    before = op.stats()
    cover = anniversary(date.fromisoformat(PURCHASE), STANDARD_MONTHS)
    with browse(browser, base + "/ops/sign-in", device_clock=DEVICE_CLOCK) as page:
        ui_sign_in(page, base)
        click(page.get_by_role("table", name="Claims").get_by_role("link", name=ref, exact=True))
        wait_path(page, rf"^/ops/claims/{ref}$")
        ui_until(page, lambda: part_button(page, 3, "Shelf pin").count() == 1, "workspace fan draws")
        choose_part(page, 3, "Shelf pin")
        fill(slip(page).get_by_role("spinbutton", name="Quantity", exact=True), str(EXAMPLE_QUANTITY))
        click(sbtn(page, "Identify part"))
        wait_path(page, rf"^/ops/claims/{ref}/quote$")
        lines = ("Inside aftercare", f"Cover until 00:00 on {date_text(cover)}", f"Ruled by edition {AC_2026}")
        for line in lines:
            ui_until(page, lambda line=line: has(slip(page), line), f"slip shows {line!r}")
        ui_until(page, lambda: has(status(page), f"Part identified. Ruled by edition {AC_2026}."), "identified status")
        page.reload()
        ui_until(page, lambda: all(has(slip(page), x) for x in lines), "cold reload keeps the ruling")
        after = op.stats()
        assert after["decided_claims"] == before["decided_claims"] + 1
        assert after["decided_inside"] == before["decided_inside"] + 1
        page.goto(base + "/ops/claims")
        expected = (f"Decided claims: {after['decided_claims']} (inside {after['decided_inside']}, "
                    f"outside {after['decided_outside']})")
        ui_until(page, lambda: has(page.get_by_role("status", name="Decided claims"), expected), "count text")
    ruling = op.view(ref)["ruling"]
    assert ruling["inside"] is True and ruling["edition"] == AC_2026 and ruling["cover_ends_on"] == cover.isoformat()
    assert instant(ruling["cover_ends_at"]) == london_midnight(cover) and ruling["term_months"] == STANDARD_MONTHS
    assert claim_row(copy_pg("before-cutoff"), ref)["state"] == "identified"


def test_wf_identify_and_rule_keyboard(browser: Any, app_url: str, mail: Any) -> None:
    c = claim_at(app_url, mail, "confirmed")
    ref = c["reference"]
    rings: list[str] = []

    def ring(what: str) -> None:
        if not ring_ok(page):
            rings.append(what)

    with browse(browser, app_url + "/ops/sign-in") as page:
        page.keyboard.press("Tab")
        assert focused(page.get_by_role("link", name="Skip to claim workspace")), "skip link is the first Tab stop"
        tab_to(page, page.get_by_role("textbox", name="Email", exact=True), "email")
        ring("email")
        page.keyboard.type(OPERATOR_EMAIL)
        tab_to(page, page.get_by_label("Password", exact=True), "password")
        page.keyboard.type(OPERATOR_PASSWORD)
        tab_to(page, page.get_by_role("button", name="Sign in", exact=True), "Sign in")
        ring("sign in")
        page.keyboard.press("Enter")
        wait_path(page, r"^/ops/claims$")
        link = page.get_by_role("table", name="Claims").get_by_role("link", name=ref, exact=True)
        ui_until(page, lambda: link.count() == 1, "queue lists the claim")
        tab_to(page, link, "queue link")
        ring("queue link")
        page.keyboard.press("Enter")
        wait_path(page, rf"^/ops/claims/{ref}$")
        ui_until(page, lambda: slider(page).count() == 1, "workspace fan renders")
        tab_to(page, slider(page), "slider")
        ring("slider")
        page.keyboard.press("End")
        assert slider_value(slider(page)) == "100"
        page.keyboard.press("Tab")
        assert focused(part_button(page, 1, "Upright")), "Tab from the slider reaches part 1"
        page.keyboard.press("Shift+Tab")
        assert focused(slider(page)), "Shift+Tab from the first part returns to the slider"
        sigs = []
        for _ in range(4):
            page.keyboard.press("Tab")
            sigs.append(page.evaluate(FOCUS_SIG))
        back = []
        for _ in range(3):
            page.keyboard.press("Shift+Tab")
            back.append(page.evaluate(FOCUS_SIG))
        assert back == sigs[:3][::-1], f"Shift+Tab retraces {sigs} but visited {back}"
        tab_to(page, part_button(page, 3, "Shelf pin"), "part 3", back=True)
        page.keyboard.press("Enter")
        ui_until(page, lambda: part_button(page, 3, "Shelf pin").get_attribute("aria-pressed") == "true", "part selected")
        qty = slip(page).get_by_role("spinbutton", name="Quantity", exact=True)
        tab_to(page, qty, "quantity")
        ring("quantity")
        page.keyboard.press("Control+A")
        page.keyboard.type("1")
        tab_to(page, sbtn(page, "Identify part"), "Identify part")
        ring("identify")
        page.keyboard.press("Enter")
        wait_path(page, rf"^/ops/claims/{ref}/quote$")
        ui_until(page, lambda: sbtn(page, "Get quote").is_enabled(), "Get quote enabled")
        tab_to(page, sbtn(page, "Get quote"), "Get quote", back=True)
        page.keyboard.press("Enter")
        wait_path(page, rf"^/ops/claims/{ref}/quote/1$")
        ui_until(page, lambda: sbtn(page, "Decline").is_enabled(), "Decline enabled")
        tab_to(page, sbtn(page, "Decline"), "Decline")
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Decline claim", exact=True)
        ui_until(page, lambda: dlg.count() == 1, "dialog opens")
        assert focused(dlg.get_by_role("radio", name="Owner declined the quote", exact=True)), "focus on first radio"
        ring("radio")
        page.keyboard.press("Space")
        tab_to(page, dlg.get_by_role("button", name="Confirm decline", exact=True), "Confirm decline")
        page.keyboard.press("Enter")
        wait_path(page, rf"^/ops/claims/{ref}/declined$")
    assert not rings, f"focused controls without a 2 px ring: {rings}"
    assert Operator(app_url).view(ref)["state"] == "declined"


def test_wf_identify_and_rule_london_edge(browser: Any, mail: Any) -> None:
    base = copy_url("london-edge")
    op = Operator(base)
    out = claim_at(base, mail, "identified", op, purchase_date="2024-07-15")
    inn = claim_at(base, mail, "identified", op, purchase_date="2024-07-16")
    assert out["view"]["ruling"]["inside"] is False and inn["view"]["ruling"]["inside"] is True
    assert out["view"]["ruling"]["edition"] == inn["view"]["ruling"]["edition"] == AC_2026
    assert claim_row(copy_pg("london-edge"), out["reference"])["confirmed_s"] == int(FROZEN["london-edge"].timestamp())
    sv = ok(share(base, out["share_token"]))
    assert sv["ruling"]["edition"] == AC_2026 and sv["ruling"]["inside"] is False
    lines = ("Outside aftercare", "Cover until 00:00 on 15 July 2026", f"Ruled by edition {AC_2026}")
    with browse(browser, base + out["share_url"], device_clock=DEVICE_CLOCK) as page:
        for line in lines:
            ui_until(page, lambda line=line: has(slip(page), line), f"share page shows {line!r}")
        ui_sign_in(page, base)
        ui_workspace(page, base, out["reference"])
        for line in lines:
            ui_until(page, lambda line=line: has(slip(page), line), f"operator slip shows {line!r}")


def test_wf_identify_and_rule_closed_panes(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "quoted", op)
    ref = c["reference"]
    ok(op.quote(ref), 200, "re-quote")
    for w, h in VIEWPORTS:
        with browse(browser, app_url + "/ops/sign-in", viewport=(w, h)) as page:
            ui_sign_in(page, app_url)
            ui_workspace(page, app_url, ref, "/quote/2")
            if w < 1280:
                assert page.get_by_role("navigation", name="Claim queue").count() == 0, f"{w}: queue pane not rendered"
                assert page.get_by_role("link", name="All claims").count() == 1
                names = tab_order(page, 40)
                assert not any(REF_RE.fullmatch(n or "") for n in names), f"{w}: no queue link is focusable: {names}"
            disclosure = sbtn(page, "Earlier revisions (1)")
            assert disclosure.get_attribute("aria-expanded") == "false"
            assert VOID_LINE.split(":")[0].replace("<revision>", "1") not in aria(slip(page)), f"{w}: collapsed revisions absent from the tree"
            for opener, name, inner in (("Decline", "Decline claim", ("radio", "Owner declined the quote")),
                                        ("Erase owner data", "Erase owner data", ("textbox", "Type the reference to confirm"))):
                assert page.get_by_role("dialog", name=name).count() == 0
                open_dialog(page, opener, name)
                page.keyboard.press("Escape")
                advance(page, DIALOG_FADE_OUT_MS + 100)
                assert page.get_by_role("dialog", name=name).count() == 0, f"{w}: closed {name} dialog absent"
                assert page.get_by_role(inner[0], name=inner[1]).count() == 0
                assert inner[1] not in tab_order(page, 30)
    with browse(browser, app_url + c["share_url"], viewport=PHONE) as page:
        hist = slip(page).get_by_role("button", name="Claim history", exact=True)
        ui_until(page, lambda: hist.count() == 1, "history button")
        assert hist.get_attribute("aria-expanded") == "false"
        assert HISTORY_LINE.split(" <time>")[0].replace("<state>", "Started") not in aria(slip(page)), "collapsed history absent from the tree"


def test_workspace_breakpoints(browser: Any, app_url: str, mail: Any) -> None:
    c = claim_at(app_url, mail, "confirmed")
    for w, h in VIEWPORTS:
        with browse(browser, app_url + "/ops/sign-in", viewport=(w, h)) as page:
            ui_sign_in(page, app_url)
            ui_workspace(page, app_url, c["reference"])
            no_overflow(page)
            f, s = box(fan(page)), box(slip(page))
            nav = page.get_by_role("navigation", name="Claim queue")
            if w < 768:
                assert f["y"] + f["height"] <= s["y"] + TOL, "fan above slip"
                assert nav.count() == 0 and page.get_by_role("link", name="All claims").count() == 1
            elif w < 1280:
                share_ = f["width"] / (f["width"] + s["width"])
                assert 0.60 - 0.005 <= share_ <= 0.70 + 0.005, f"fan share {share_:.3f}"
                assert s["x"] - (f["x"] + f["width"]) >= GUTTER_MIN - TOL
                assert nav.count() == 0 and page.get_by_role("link", name="All claims").count() == 1
            else:
                q = box(nav)
                total = q["width"] + f["width"] + s["width"]
                assert q["x"] < f["x"] < s["x"], "queue, fan, slip left to right"
                assert 0.15 - 0.005 <= q["width"] / total <= 0.22 + 0.005, f"queue share {q['width'] / total:.3f}"
                assert 0.45 - 0.005 <= f["width"] / total <= 0.55 + 0.005, f"fan share {f['width'] / total:.3f}"
                assert f["x"] - (q["x"] + q["width"]) >= GUTTER_MIN - TOL
                assert s["x"] - (f["x"] + f["width"]) >= GUTTER_MIN - TOL


def test_aftercare_term(mail: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    std = claim_at(base, mail, "identified", op)["view"]["ruling"]
    assert std["inside"] and std["term_months"] == STANDARD_MONTHS
    club = claim_at(base, mail, "identified", op, email=CLUB_TOM, purchase_date="2025-09-11")["view"]["ruling"]
    assert club["term_months"] == CLUB_MONTHS and club["cover_ends_on"] == anniversary(date(2025, 9, 11), CLUB_MONTHS).isoformat()
    joined_day = claim_at(base, mail, "identified", op, email=CLUB_TOM, purchase_date=TOM_JOINED.isoformat())["view"]["ruling"]
    assert joined_day["term_months"] == STANDARD_MONTHS, "joined on the purchase date is not strictly before"
    leap = claim_at(base, mail, "identified", op, purchase_date="2024-02-29")["view"]["ruling"]
    first = anniversary(date(2024, 2, 29), STANDARD_MONTHS)
    assert leap["cover_ends_on"] == first.isoformat() and leap["inside"] is False
    assert instant(leap["cover_ends_at"]) == london_midnight(first)
    zt = Operator(copy_url("zero-term"))
    zero = claim_at(copy_url("zero-term"), mail, "identified", zt)["view"]["ruling"]
    assert zero["inside"] is False and zero["term_months"] == 0 and zero["cover_ends_on"] == PURCHASE
    zl = Operator(copy_url("zero-limits"))
    v = claim_at(copy_url("zero-limits"), mail, "identified", zl)["view"]
    assert v["ruling"]["inside"] is False and v["ruling"]["term_months"] is None
    assert instant(v["ruling"]["cover_ends_at"]) == instant(v["started_at"])
    st = Operator(copy_url("short-timer"))
    v = claim_at(copy_url("short-timer"), mail, "identified", st)["view"]
    assert v["ruling"]["inside"] is True and v["ruling"]["term_months"] is None
    assert instant(v["ruling"]["cover_ends_at"]) == instant(v["started_at"]) + timedelta(seconds=SHORT_TERM_S)


def test_london_business_day(browser: Any, mail: Any) -> None:
    edge, before = copy_url("london-edge"), copy_url("london-edge-before")
    _, email = owner()
    ok(start_claim(edge, email, purchase_date="2026-07-15"), 201, "London today on london-edge")
    e = err(start_claim(edge, email, purchase_date="2026-07-16"), 422, "validation_failed")
    assert e["fields"]["purchase_date"] == "in_future"
    e = err(start_claim(before, email, purchase_date="2026-07-15"), 422, "validation_failed")
    assert e["fields"]["purchase_date"] == "in_future"
    ok(start_claim(before, email, purchase_date="2026-07-14"), 201)
    op = Operator(copy_url("before-cutoff"))
    r = claim_at(copy_url("before-cutoff"), mail, "identified", op, purchase_date="2025-07-20")["view"]["ruling"]
    end = anniversary(date(2025, 7, 20), STANDARD_MONTHS)
    assert r["cover_ends_on"] == end.isoformat() and instant(r["cover_ends_at"]) == london_midnight(end)
    name, email2 = owner()
    with browse(browser, edge + "/claim/new", device_clock=FROZEN["london-edge"] - timedelta(hours=12)) as page:
        ui_fill_claim(page, name=name, email=email2, purchase="2026-07-15")
        click(page.get_by_role("button", name="Start claim", exact=True))
        wait_path(page, r"^/claim/HG-[A-Z0-9]{6}/sent$")


def test_clock_change_sundays(mail: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    for purchase in ("2025-03-28", "2024-10-25"):
        end = anniversary(date.fromisoformat(purchase), STANDARD_MONTHS)
        noon, late = (datetime(end.year, end.month, end.day, h, tzinfo=LONDON).utcoffset() for h in (0, 23))
        assert noon != late, f"{end} is a clock-change Sunday"
        c = claim_at(base, mail, "identified", op, purchase_date=purchase)
        r = c["view"]["ruling"]
        assert r["cover_ends_on"] == end.isoformat() and instant(r["cover_ends_at"]) == london_midnight(end)
        assert r["inside"] is (instant(r["cover_ends_at"]) > FROZEN["before-cutoff"])
        e = err(op.identify(c["reference"]), 409, "wrong_state", WRONG_STATE.format(state="Identified"))
        assert e["state"] == "identified"
        assert op.view(c["reference"])["ruling"] == r, "the ruling is never made twice"


def test_decided_claims_count(browser: Any, mail: Any) -> None:
    zt = Operator(copy_url("zero-term"))
    before = zt.stats()
    c = claim_at(copy_url("zero-term"), mail, "quoted", zt)
    mid = zt.stats()
    assert (mid["decided_claims"], mid["decided_outside"], mid["decided_inside"]) == (
        before["decided_claims"] + 1, before["decided_outside"] + 1, before["decided_inside"])
    zt.identify(c["reference"])
    ok(zt.decline(c["reference"]), 200)
    ok(zt.erase(c["reference"], c["reference"]), 200)
    assert zt.stats() == mid, "re-identify, decline and erasure leave the count"
    st = Operator(copy_url("short-timer"))
    b2 = st.stats()
    claim_at(copy_url("short-timer"), mail, "identified", st)
    assert st.stats()["decided_inside"] == b2["decided_inside"] + 1
    with browse(browser, copy_url("zero-term") + "/ops/sign-in") as page:
        ui_sign_in(page, copy_url("zero-term"))
        s = zt.stats()
        want = f"Decided claims: {s['decided_claims']} (inside {s['decided_inside']}, outside {s['decided_outside']})"
        ui_until(page, lambda: has(page.get_by_role("status", name="Decided claims"), want), "count text")


def edition_body(code: str, starts_on: str, **kw: Any) -> dict:
    body = {"code": code, "title": "Aftercare probe", "starts_on": starts_on, "standard_months": STANDARD_MONTHS,
            "club_months": CLUB_MONTHS, "owner_contribution_percent": CONTRIBUTION_2026}
    body.update(kw)
    return body


def fresh_code() -> str:
    return "ED-" + uuid.uuid4().hex[:10].upper()


def far_date() -> date:
    return date(RNG.randint(2100, 2999), RNG.randint(1, 12), RNG.randint(1, 28))


def test_wf_catalogue_and_editions_publish_edition(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "identified", op)
    ruling = c["view"]["ruling"]
    code, start = fresh_code(), far_date()
    with browse(browser, app_url + "/ops/sign-in", device_clock=DEVICE_CLOCK) as page:
        ui_sign_in(page, app_url)
        page.goto(app_url + "/ops/editions")
        fill(page.get_by_role("textbox", name="Edition code", exact=True), code)
        fill(page.get_by_role("textbox", name="Title", exact=True), "Aftercare probe")
        fill(page.get_by_label("Starts on", exact=True), start.isoformat())
        for label, value in (("Standard months", STANDARD_MONTHS), ("Club months", CLUB_MONTHS),
                             ("Owner contribution percent", CONTRIBUTION_2026)):
            fill(page.get_by_role("spinbutton", name=label, exact=True), str(value))
        click(page.get_by_role("button", name="Save edition", exact=True))
        msg = f"Edition {code} saved. It rules claims confirmed from 00:00 on {date_text(start)}."
        ui_until(page, lambda: has(status(page), msg), "edition saved status")
        table = page.get_by_role("table", name="Editions")
        ui_until(page, lambda: has(table, code) and (has(table, date_text(start)) or has(table, start.isoformat())),
                 "edition listed with its start")
    listed = [e for e in ok(op.call("GET", "/api/ops/editions"))["editions"] if e["code"] == code]
    assert listed and listed[0]["starts_on"] == start.isoformat()
    assert op.view(c["reference"])["ruling"] == ruling, "saving an edition changes no ruling"
    before = copy_url("london-edge-before")
    with browse(browser, before + "/ops/sign-in", device_clock=DEVICE_CLOCK) as page:
        ui_sign_in(page, before)
        page.goto(before + "/ops/editions")
        fill(page.get_by_role("textbox", name="Edition code", exact=True), fresh_code())
        fill(page.get_by_role("textbox", name="Title", exact=True), "Aftercare probe")
        fill(page.get_by_label("Starts on", exact=True), "2026-07-14")
        for label, value in (("Standard months", STANDARD_MONTHS), ("Club months", CLUB_MONTHS),
                             ("Owner contribution percent", CONTRIBUTION_2026)):
            fill(page.get_by_role("spinbutton", name=label, exact=True), str(value))
        click(page.get_by_role("button", name="Save edition", exact=True))
        ui_until(page, lambda: has(alert(page), OPS["must_be_future"]), "today's London date refused")
        assert path_of(page) == "/ops/editions"


def test_editions_never_reach_back(mail: Any) -> None:
    for copy, edition, inside in (("london-edge", AC_2026, False), ("london-edge-before", AC_2025, True)):
        op = Operator(copy_url(copy))
        r = claim_at(copy_url(copy), mail, "identified", op, purchase_date="2024-07-15")["view"]["ruling"]
        assert (r["edition"], r["inside"]) == (edition, inside), f"{copy}: deciding edition {edition}"
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "identified", op)
    ruling = c["view"]["ruling"]
    r = op.call("POST", "/api/ops/editions", edition_body(fresh_code(), "2026-07-16"))
    if r.status_code == 409:
        err(r, 409, "edition_date_taken", OPS["edition_date_taken"], "tomorrow already saved by an earlier run")
    else:
        ok(r, 201, "tomorrow is allowed")
    assert op.view(c["reference"])["ruling"] == ruling
    assert claim_at(base, mail, "identified", op)["view"]["ruling"]["edition"] == AC_2026
    e = err(Operator(copy_url("london-edge-before")).call("POST", "/api/ops/editions", edition_body(fresh_code(), "2026-07-14")),
            422, "validation_failed")
    assert e["fields"]["starts_on"] == "must_be_future"
    cases = {"code": ("lower-case", "invalid"), "title": ("t" * (TITLE_MAX + 1), "too_long"),
             "standard_months": (MONTHS_MAX + 1, "invalid"), "club_months": (0, "invalid"),
             "owner_contribution_percent": (101, "invalid")}
    for field, (value, code) in cases.items():
        fields = {"code": fresh_code(), field: value}
        e = err(op.call("POST", "/api/ops/editions", edition_body(fields.pop("code"), far_date().isoformat(), **fields)),
                422, "validation_failed", None, field)
        assert e["fields"][field] == code
    e = err(op.call("POST", "/api/ops/editions", edition_body(fresh_code(), far_date().isoformat(), owner_contribution_percent=-1)),
            422, "validation_failed")
    assert e["fields"]["owner_contribution_percent"] == "invalid"
    code = fresh_code()
    ok(op.call("POST", "/api/ops/editions", edition_body(code, far_date().isoformat(), title="t" * TITLE_MAX,
                                                         owner_contribution_percent=0)), 201, "edges allowed")
    err(op.call("POST", "/api/ops/editions", edition_body(code, far_date().isoformat())), 409, "edition_code_taken",
        OPS["edition_code_taken"])


def free_booklets(base: str, slug: str, n: int) -> list[int]:
    used = {p["booklet_number"] for p in ok(get(base, f"/api/models/{slug}"))["parts"]}
    free = [b for b in range(1, 100) if b not in used]
    assert len(free) >= n, f"{slug} needs {n} free booklet numbers"
    return RNG.sample(free, n)


def part_no() -> str:
    return "9" + "".join(RNG.choice("0123456789") for _ in range(7))


def test_wf_catalogue_and_editions_import(browser: Any) -> None:
    base = copy_url("zero-ttl")
    b1, = free_booklets(base, ALDRA, 1)
    b2, = free_booklets(base, KESTLE, 1)
    p1, p2 = part_no(), part_no()
    csv = "\n".join([
        IMPORT_HEADER,
        f"ALDRA WARDROBE-AW12,{b1},{p1},Probe brace,12.50,500,400,active",
        "",
        f"Kestle Shelving Unit / ks05,{b2},{p2},Probe cleat,1.25,40,60,active",
        f"Holm Classic,{b1},{part_no()},Probe,1.00,1,1,active",
        f"Nowhere Unit,{b1},{part_no()},Probe,1.00,1,1,active",
        f"aldra wardrobe,{b1},{p1},Probe brace,12.50,500,400,active",
        f"Aldra Wardrobe,{b1},12345,Probe,1.00,1,1,active",
    ]).encode() + b"\n"
    expected = {5: "ambiguous_model", 6: "unknown_model", 7: "duplicate_row", 8: "bad_part_number"}
    with browse(browser, base + "/ops/sign-in") as page:
        ui_sign_in(page, base)
        page.goto(base + "/ops/imports")
        for created, unchanged in ((2, 0), (0, 2)):
            page.get_by_label("Supplier parts file", exact=True).set_input_files(file_payload("parts.csv", csv, "text/csv"))
            click(page.get_by_role("button", name="Import file", exact=True))
            msg = f"Imported: {created} new, 0 updated, {unchanged} unchanged, 4 unmatched."
            ui_until(page, lambda msg=msg: has(status(page), msg), f"import status {msg!r}")
            table = page.get_by_role("table", name="Unmatched rows")
            for line, reason in expected.items():
                row = table.get_by_role("row").filter(has_text=reason)
                ui_until(page, lambda row=row, line=line: row.count() == 1 and str(line) in loc_text(row),
                         f"line {line} listed as {reason}")
    parts = {p["part_number"]: p for p in ok(get(base, f"/api/models/{ALDRA}"))["parts"]}
    assert parts[p1]["booklet_number"] == b1
    assert any(p["part_number"] == p2 for p in ok(get(base, f"/api/models/{KESTLE}"))["parts"])


def test_model_name_matching(app_url: str) -> None:
    base = copy_url("zero-ttl")
    op = Operator(base)
    names = {ALDRA: ["aldra wardrobe", "ALDRA-WARDROBE", "  Aldra   Wardrobe  ", "Aldra Robe", "Aldra 2-Door"],
             KESTLE: ["Kestle Tall Shelf/KT2026", "kestle 5 tier"], BRAMWELL: ["Bramwell 3-Seater BW0099"]}
    rows, want = [IMPORT_HEADER], {}
    for slug, variants in names.items():
        for name, b in zip(variants, free_booklets(base, slug, len(variants))):
            pn = part_no()
            rows.append(f"{name},{b},{pn},Probe part,2.00,10,10,active")
            want[pn] = (slug, b)
    rows += [f"Holm Classic,7,{part_no()},Probe,1.00,1,1,active", f"Fenwick Single,7,{part_no()},Probe,1.00,1,1,active"]
    report = ok(op.import_csv(("\n".join(rows) + "\n").encode()))
    assert report["created"] == len(want)
    got = {(u["line"], u["reason"]) for u in report["unmatched"]}
    assert got == {(len(rows) - 1, "ambiguous_model"), (len(rows), "unknown_model")}
    for slug in names:
        listed = {p["part_number"]: p["booklet_number"] for p in ok(get(base, f"/api/models/{slug}"))["parts"]}
        for pn, (s, b) in want.items():
            if s == slug:
                assert listed.get(pn) == b, f"{pn} belongs to {slug} at booklet {b}"


def test_import_report_and_reimport() -> None:
    base = copy_url("zero-ttl")
    op = Operator(base)
    b, = free_booklets(base, BRAMWELL, 1)
    pn = part_no()
    good = f"Bramwell Sofa Frame,{b},{pn},Probe slat,13.00,100,100,active"
    bad = [",1,12345678,x,1.00,1,1,active", f"Bramwell Sofa Frame,0,{part_no()},x,1.00,1,1,active",
           f"Bramwell Sofa Frame,2.5,{part_no()},x,1.00,1,1,active", "Bramwell Sofa Frame,7,1234567,x,1.00,1,1,active",
           f"Bramwell Sofa Frame,7,{part_no()},x,0.00,1,1,active", f"Bramwell Sofa Frame,7,{part_no()},x,1.234,1,1,active",
           f"Bramwell Sofa Frame,7,{part_no()},x,1.00,0,1,active", f"Bramwell Sofa Frame,7,{part_no()},x,1.00,1,1.5,active",
           f"Bramwell Sofa Frame,7,{part_no()},x,1.00,1,1,retired"]
    reasons = ["missing_field", "bad_booklet_number", "bad_booklet_number", "bad_part_number", "bad_price", "bad_price",
               "bad_weight", "bad_size", "bad_status"]
    data = ("\n".join([IMPORT_HEADER, good, *bad]) + "\n").encode()
    first = ok(op.import_csv(data))
    assert (first["created"], first["updated"]) == (1, 0)
    assert sorted((u["line"], u["reason"]) for u in first["unmatched"]) == [(i + 3, r) for i, r in enumerate(reasons)]
    again = ok(op.import_csv(data))
    assert (again["created"], again["updated"], again["unchanged"]) == (0, 0, 1), "re-import creates and changes nothing"
    new_price = "13.50"
    changed = ok(op.import_csv(f"{IMPORT_HEADER}\n{good.replace('13.00', new_price)}\n".encode()))
    assert changed["updated"] == 1
    prices = [p for p in ok(get(base, "/api/parts", params={"model": BRAMWELL, "limit": PARTS_PAGE_MAX}))["parts"]
              if p["part_number"] == pn]
    assert prices and prices[0]["price_minor"] == int(Decimal(new_price) * 100)
    err(op.import_csv(b"model,booklet\nx,1\n"), 422, "validation_failed")
    assert op.import_csv(b"model,booklet\nx,1\n").json()["error"]["fields"]["file"] == "bad_header"
    big = (IMPORT_HEADER + "\n").encode() + b"\n" * SUPPLIER_CAP
    err(op.import_csv(big), 413, "file_too_large", OPS["file_too_large"])
    assert op.import_csv(data, "application/json").status_code == 415


def test_wf_catalogue_and_editions_withdrawn(browser: Any, mail: Any) -> None:
    base = copy_url("zero-term")
    op = Operator(base)
    b, = free_booklets(base, ALDRA, 1)
    pn = part_no()
    row = f"Aldra Wardrobe,{b},{pn},Probe hinge,{{price}},500,400,{{status}}"
    ok(op.import_csv(f"{IMPORT_HEADER}\n{row.format(price='10.00', status='active')}\n".encode()))
    c = claim_at(base, mail, "quoted", op, model=ALDRA, booklet=b)
    other = claim_at(base, mail, "confirmed", op)
    figures = {k: c["view"]["quotes"][0][k] for k in ("part_line_minor", "carriage_minor", "total_minor")}
    ok(op.import_csv(f"{IMPORT_HEADER}\n{row.format(price='10.00', status='withdrawn')}\n".encode()))
    _, email = owner()
    err(start_claim(base, email, model=ALDRA, booklet=b), 409, "part_withdrawn", PART_WITHDRAWN_OWNER.format(n=b))
    err(get(base, "/api/carriage-estimate", params={"model": ALDRA, "part": b, "quantity": 1, "postcode": POSTCODE}),
        409, "part_withdrawn")
    err(op.identify(other["reference"], ALDRA, b, 1), 409, "part_withdrawn", OPS_PART_WITHDRAWN.format(n=b))
    err(op.quote(c["reference"]), 409, "part_withdrawn", OPS_PART_WITHDRAWN.format(n=b))
    view = op.view(c["reference"])
    assert {k: view["quotes"][0][k] for k in figures} == figures and view["quotes"][0]["status"] == "current"
    ok(op.pay(c["reference"]))
    assert ok(op.dispatch(c["reference"]))["state"] == "dispatched"
    name, email2 = owner()
    with browse(browser, base + "/claim/new") as page:
        select(page.get_by_role("combobox", name="Model", exact=True), MODELS[ALDRA][0])
        btn = part_button(page, b, "Probe hinge")
        ui_until(page, lambda: btn.count() == 1, "withdrawn part stays in the diagram")
        assert btn.get_attribute("aria-disabled") == "true"
        btn.focus()
        page.keyboard.press("Enter")
        advance(page, 300)
        assert fan(page).get_attribute("data-active-part") == "none", "selecting a withdrawn part does nothing"


def test_public_parts_list(app_url: str) -> None:
    def walk(limit: int) -> list[tuple]:
        seen, cursor = [], None
        for _ in range(PARTS_PAGE_MAX):
            params = {"limit": limit, **({"cursor": cursor} if cursor else {})}
            body = ok(get(app_url, "/api/parts", params=params))
            assert len(body["parts"]) <= limit
            seen += [(p["model"], int(p["booklet_number"]), p["part_number"]) for p in body["parts"]]
            cursor = body["next_cursor"]
            if not cursor:
                return seen
        pytest.fail("following next_cursor should end")
    first = walk(7)
    assert first == sorted(first) and len(set(first)) == len(first), "ordered by model, booklet, part, each once"
    assert walk(7) == first, "paging is stable"
    assert len(ok(get(app_url, "/api/parts"))["parts"]) == min(PARTS_DEFAULT, len(first))
    assert len(ok(get(app_url, "/api/parts", params={"limit": 100}))["parts"]) <= PARTS_PAGE_MAX
    for bad in ("0", "-1", "1.5", "abc"):
        assert err(get(app_url, "/api/parts", params={"limit": bad}), 422, "validation_failed")["fields"]["limit"] == "invalid"
    assert err(get(app_url, "/api/parts", params={"cursor": "not-a-cursor"}), 422, "validation_failed")["fields"]["cursor"] == "invalid"
    short = copy_url("short-timer")
    for i in range(SHORT_RATE):
        assert get(short, "/api/parts").status_code == 200, f"request {i + 1} within the rate"
    r = get(short, "/api/parts")
    err(r, 429, "rate_limited", OWN["rate_limited"][0])
    assert int(r.headers["Retry-After"]) >= 1
    for _ in range(2):
        r = get(copy_url("zero-limits"), "/api/parts")
        assert r.status_code == 429 and r.headers.get("Retry-After") == ZERO_RATE_RETRY


def test_wf_quote_and_dispatch_happy(browser: Any, mail: Any, killbill: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "identified", op, quantity=EXAMPLE_QUANTITY)
    ref = c["reference"]
    with browse(browser, base + "/ops/sign-in", device_clock=DEVICE_CLOCK) as page:
        ui_sign_in(page, base)
        ui_workspace(page, base, ref, "/quote")
        button = sbtn(page, "Get quote")
        with held(page, "**/api/ops/claims/*/quote") as gate:
            click(button)
            ui_until(page, lambda: button.is_disabled() and has(status(page), "Working…"), "pending quote")
            gate.release()
        wait_path(page, rf"^/ops/claims/{ref}/quote/1$")
        kb = kb_current(killbill, ref)
        assert (kb["part"], kb["carriage"], kb["total"]) == (EXAMPLE_PART_LINE, DEFAULT_CHARGE, EXAMPLE_TOTAL)
        assert kb["part_desc"] == f"Part {PIN_NUMBER} × {EXAMPLE_QUANTITY}" and kb["carriage_desc"] == f"Carriage band {DEFAULT_BAND}"
        acct = kb["state"]["account"]
        assert acct["name"] == ref and acct.get("currency") == "GBP" and not acct.get("email")
        lines = ("Quote revision 1", f"Part {money(kb['part'])}", f"Carriage, band {DEFAULT_BAND} {money(kb['carriage'])}",
                 f"Total {money(kb['total'])}",
                 f"Same-working-day dispatch: leaves the workshop on {date_text(FROZEN['before-cutoff'].date())}")
        for line in lines:
            ui_until(page, lambda line=line: has(slip(page), line), f"slip shows {line!r}")
        ui_until(page, lambda: has(status(page), "Quote revision 1 recorded in billing."), "quoted status")
        q = inbox(mail, c["email"], f"Quote for claim {ref}: {money(kb['total'])}")[0]
        for s in (money(kb["part"]), money(kb["carriage"]), lines[4], c["share_url"]):
            assert s in text(q), f"quoted notice carries {s!r}"
        click(sbtn(page, "Record payment"))
        ui_until(page, lambda: has(status(page), f"Payment of {money(kb['total'])} recorded in billing."), "payment status")
        assert path_of(page) == f"/ops/claims/{ref}/quote/1"
        assert kb_tx(killbill, ref, "PURCHASE") == [kb["total"]]
        ui_until(page, lambda: sbtn(page, "Re-quote").is_disabled() and sbtn(page, "Dispatch").is_enabled(), "controls follow payment")
        click(sbtn(page, "Dispatch"))
        wait_path(page, rf"^/ops/claims/{ref}/dispatched$")
        ui_until(page, lambda: slip(page).get_by_role("link", name="Dispatch note").count() == 1, "dispatch note link")
        ui_until(page, lambda: has(status(page), "Dispatched. Dispatch note stored."), "dispatched status")
        page.reload()
        ui_until(page, lambda: has(slip(page), "Dispatched"), "cold reload shows dispatched")
    assert copy_s3("before-cutoff").keys(f"claims/{ref}/dispatch-note.html")
    d = inbox(mail, c["email"], f"Part on its way for claim {ref}")[0]
    assert money(kb["total"]) in text(d)


def test_wf_quote_and_dispatch_requote(browser: Any, mail: Any, killbill: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "quoted", op)
    ref = c["reference"]
    bin_after_first = op.view(ref)["part"]["bin_count"]
    with browse(browser, base + "/ops/sign-in") as page:
        ui_sign_in(page, base)
        ui_workspace(page, base, ref, "/quote/1")
        click(sbtn(page, "Re-quote"))
        wait_path(page, rf"^/ops/claims/{ref}/quote/2$")
        ui_until(page, lambda: has(slip(page), "Quote revision 2"), "revision 2 current")
        disclosure = sbtn(page, "Earlier revisions (1)")
        assert disclosure.get_attribute("aria-expanded") == "false"
        void_total = op.view(ref)["quotes"][1]["total_minor"]
        void_line = f"Revision 1 (void): Total {money(void_total)}"
        assert void_line not in aria(slip(page))
        disclosure.focus()
        page.keyboard.press("Enter")
        ui_until(page, lambda: disclosure.get_attribute("aria-expanded") == "true" and has(slip(page), void_line), "expands")
        page.keyboard.press("Space")
        ui_until(page, lambda: disclosure.get_attribute("aria-expanded") == "false", "Space collapses")
        page.reload()
        ui_until(page, lambda: sbtn(page, "Earlier revisions (1)").get_attribute("aria-expanded") == "false", "collapsed on open")
    st = kb_state(killbill, ref)
    assert sorted(is_void(i) for i in st["invoices"] if i.get("items")) == [False, True]
    v = op.view(ref)
    assert [(q["revision"], q["status"]) for q in v["quotes"]] == [(2, "current"), (1, "void")]
    assert v["part"]["bin_count"] == bin_after_first, "void returns and the new revision takes the same units"
    assert len(inbox(mail, c["email"], lambda s: s.startswith(f"Quote for claim {ref}:"), count=2)) == 2


def test_wf_quote_and_dispatch_billing_outage(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    down = copy_url("killbill-down")
    c = claim_at(app_url, mail, "confirmed")
    ref = c["reference"]
    with browse(browser, down + "/ops/sign-in") as page:
        ui_sign_in(page, down)
        ui_workspace(page, down, ref)
        choose_part(page, 3, "Shelf pin")
        fill(slip(page).get_by_role("spinbutton", name="Quantity", exact=True), "1")
        click(sbtn(page, "Identify part"))
        wait_path(page, rf"^/ops/claims/{ref}/quote$")
        click(sbtn(page, "Get quote"))
        ui_until(page, lambda: has(alert(page), OPS["billing_unavailable"]), "billing copy on quote")
        assert path_of(page) == f"/ops/claims/{ref}/quote"
    op = Operator(app_url)
    assert kb_state(killbill, ref)["account"] is None and op.view(ref)["state"] == "identified"
    assert not mine(mail, c["email"], lambda s: s.startswith("Quote for claim"))
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref, "/quote")
        click(sbtn(page, "Get quote"))
        wait_path(page, rf"^/ops/claims/{ref}/quote/1$")
    with browse(browser, down + "/ops/sign-in") as page:
        ui_sign_in(page, down)
        ui_workspace(page, down, ref, "/quote/1")
        click(sbtn(page, "Record payment"))
        ui_until(page, lambda: has(alert(page), OPS["billing_unavailable"]), "billing copy on payment")
    assert kb_tx(killbill, ref, "PURCHASE") == [] and op.view(ref)["payment"] is None
    ok(op.pay(ref))
    assert kb_tx(killbill, ref, "PURCHASE") == [kb_current(killbill, ref)["total"]]


def test_quote_figures(mail: Any, killbill: Any) -> None:
    cases = [("before-cutoff", EXAMPLE_QUANTITY, CONTRIBUTION_2026), ("before-cutoff", 2, CONTRIBUTION_2026),
             ("before-cutoff", 1, CONTRIBUTION_2026), ("zero-term", EXAMPLE_QUANTITY, 100)]
    for copy, qty, pct in cases:
        op = Operator(copy_url(copy))
        c = claim_at(copy_url(copy), mail, "quoted", op, quantity=qty)
        expected = part_line(PIN_PRICE, qty, pct)
        kb = kb_current(killbill, c["reference"])
        assert (kb["part"], kb["carriage"], kb["total"]) == (expected, DEFAULT_CHARGE, expected + DEFAULT_CHARGE), \
            f"{copy} qty {qty}: Kill Bill figures"
        q = c["view"]["quotes"][0]
        assert (q["part_line_minor"], q["carriage_minor"], q["total_minor"]) == (kb["part"], kb["carriage"], kb["total"])
        assert len([i for i in kb["state"]["invoices"] if i.get("items")]) == 1
    assert part_line(PIN_PRICE, EXAMPLE_QUANTITY, CONTRIBUTION_2026) == EXAMPLE_PART_LINE


CARRIER_CASES = {"slow": ("main", POSTCODE_IV, 504, "carrier_timeout"),
                 "failing": ("main", POSTCODE_HS, 503, "carrier_unavailable"),
                 "malformed": ("main", POSTCODE_KW, 502, "carrier_malformed"),
                 "refused": ("carrier-down", POSTCODE, 503, "carrier_unavailable")}


CARRIER_IDS = ["slow", "failing", "malformed", "refused"]


@pytest.mark.parametrize("case", CARRIER_IDS, ids=CARRIER_IDS)
def test_no_quote_without_carrier(case: str, app_url: str, mail: Any, killbill: Any) -> None:
    copy, postcode, status_code, code = CARRIER_CASES[case]
    op = Operator(app_url)
    c = claim_at(app_url, mail, "identified", op, postcode=postcode, booklet=4)
    bin_before = c["view"]["part"]["bin_count"]
    target = op if copy == "main" else op.on(copy_url(copy))
    err(target.quote(c["reference"]), status_code, code, OPS[code])
    v = op.view(c["reference"])
    assert v["state"] == "identified" and v["quotes"] == [] and v["part"]["bin_count"] == bin_before
    assert kb_state(killbill, c["reference"])["account"] is None
    assert not mine(mail, c["email"], lambda s: s.startswith("Quote for claim"))


def test_dispatch_promise(mail: Any) -> None:
    day = FROZEN["before-cutoff"].date()
    for copy, booklet, kind, when in (("before-cutoff", 3, "same_day", day),
                                      ("after-cutoff", 3, "later", working_days_after(day, 1)),
                                      ("before-cutoff", 1, "later", working_days_after(day, 3))):
        op = Operator(copy_url(copy))
        q = claim_at(copy_url(copy), mail, "quoted", op, booklet=booklet)["view"]["quotes"][0]
        assert q["promise"] == {"kind": kind, "date": when.isoformat()}, f"{copy} booklet {booklet}: {q['promise']}"
        assert q["source"] == ("supplier" if booklet == 1 else "bin")
    op = Operator(copy_url("zero-limits"))
    q = claim_at(copy_url("zero-limits"), mail, "quoted", op)["view"]["quotes"][0]
    assert q["promise"]["kind"] == "later", "cut-off 00:00 never promises same day"


def test_record_payment(mail: Any, killbill: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "quoted", op)
    ref = c["reference"]
    v = ok(op.pay(ref))
    kb = kb_current(killbill, ref)
    assert kb_tx(killbill, ref, "PURCHASE") == [kb["total"]] == [v["payment"]["paid_minor"]]
    err(op.pay(ref), 409, "already_paid", OPS["already_paid"])
    err(op.quote(ref), 409, "already_paid", OPS["already_paid"])
    assert len(kb_tx(killbill, ref, "PURCHASE")) == 1
    other = claim_at(base, mail, "identified", op)
    assert err(op.pay(other["reference"]), 409, "wrong_state", WRONG_STATE.format(state="Identified"))["state"] == "identified"


def test_dispatch_part(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "quoted", op)
    ref = c["reference"]
    err(op.dispatch(ref), 409, "not_paid", OPS["not_paid"])
    ok(op.pay(ref))
    err(op.on(copy_url("minio-down")).dispatch(ref), 503, "storage_unavailable", OPS["storage_unavailable"])
    assert op.view(ref)["state"] == "quoted" and not S3().keys(f"claims/{ref}/dispatch-note")
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref, "/quote/1")
        click(sbtn(page, "Dispatch"))
        wait_path(page, rf"^/ops/claims/{ref}/dispatched$")
        link = slip(page).get_by_role("link", name="Dispatch note")
        ui_until(page, lambda: link.count() == 1, "dispatch note link")
        r = page.request.get(urlparse(page.url)._replace(path=urlparse(link.get_attribute("href")).path).geturl())
        assert r.status == 200 and "Dispatch note" in r.text()
    v = op.view(ref)
    assert v["state"] == "dispatched" and v["dispatched_at"]
    assert err(op.dispatch(ref), 409, "wrong_state")["state"] == "dispatched"
    n = op.call("GET", f"/api/ops/claims/{ref}/dispatch-note")
    assert n.status_code == 200 and n.headers["content-type"].lower().replace(" ", "") == "text/html; charset=utf-8".replace(" ", "")


NOTE_BLOCK_TAGS = r"p|tr|li|h[1-6]|div|br|table|section|thead|tbody|tfoot|ul|ol|header|footer|main|article|body|html|head|title"


def note_lines(raw: bytes) -> list[str]:
    text = raw.decode("utf-8")
    text = re.sub(r"(?is)<(style|script)\b.*?</\1\s*>", "\n", text)
    text = re.sub(r"(?s)<!--.*?-->", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(rf"(?i)</?(?:{NOTE_BLOCK_TAGS})\b[^>]*>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    plain = htmllib.unescape(text)
    return [re.sub(r"\s+", " ", ln).strip() for ln in plain.splitlines() if ln.strip()]


def test_dispatch_note(mail: Any, killbill: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "dispatched", op, quantity=EXAMPLE_QUANTITY, description="probe-" + uuid.uuid4().hex)
    ref = c["reference"]
    s3 = copy_s3("before-cutoff")
    assert s3.keys(f"claims/{ref}/dispatch-note") == [f"claims/{ref}/dispatch-note.html"]
    raw = s3.get(f"claims/{ref}/dispatch-note.html")
    assert op.call("GET", f"/api/ops/claims/{ref}/dispatch-note").content == raw
    kb = kb_current(killbill, ref)
    paid = kb_tx(killbill, ref, "PURCHASE")[0]
    want = ["Dispatch note", f"Claim {ref}", "Part 3: Shelf pin", f"Part number {PIN_NUMBER}", f"Part {money(kb['part'])}",
            f"Carriage, band {DEFAULT_BAND} {money(kb['carriage'])}", f"Total {money(kb['total'])}",
            f"Paid {money(paid)}", f"Quantity {EXAMPLE_QUANTITY}"]
    lines = note_lines(raw)
    idx = [lines.index(w) if w in lines else -1 for w in want]
    assert -1 not in idx and idx == sorted(idx), f"note lines in order: {want}; got {lines}"
    body = raw.decode("utf-8")
    for private in (c["email"], c["name"], POSTCODE, c["view"]["description"]):
        assert private not in body, f"dispatch note leaks {private!r}"


def test_bin_stock(mail: Any) -> None:
    op = Operator(copy_url("before-cutoff"))
    base = copy_url("before-cutoff")
    probe = claim_at(base, mail, "identified", op, model=ALDRA, booklet=4)
    b0 = probe["view"]["part"]["bin_count"]
    assert 2 <= b0 <= QUANTITY_MAX, f"Aldra hanging rail bin {b0} must allow the stock edges"

    def bin_now() -> int:
        return op.view(probe["reference"])["part"]["bin_count"]

    a = claim_at(base, mail, "quoted", op, model=ALDRA, booklet=4, quantity=2)
    assert a["view"]["quotes"][0]["source"] == "bin" and bin_now() == b0 - 2
    b = claim_at(base, mail, "quoted", op, model=ALDRA, booklet=4, quantity=b0 - 1)
    assert b["view"]["quotes"][0]["source"] == "supplier" and bin_now() == b0 - 2
    ok(op.quote(a["reference"]))
    assert bin_now() == b0 - 2
    ok(op.decline(a["reference"]))
    ok(op.decline(b["reference"]))
    assert bin_now() == b0, "void and decline return each revision once"
    c1, c2 = (claim_at(base, mail, "identified", op, model=ALDRA, booklet=4, quantity=b0) for _ in range(2))
    with ThreadPoolExecutor(2) as pool:
        rs = list(pool.map(lambda c: op.quote(c["reference"]), (c1, c2)))
    assert all(r.status_code == 200 for r in rs)
    assert sorted(r.json()["quotes"][0]["source"] for r in rs) == ["bin", "supplier"], "exactly one gets the last units"
    assert bin_now() == 0
    for c in (c1, c2):
        ok(op.decline(c["reference"]))
    assert bin_now() == b0


def test_replayed_billing_actions(app_url: str, mail: Any, killbill: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "identified", op)
    ref = c["reference"]
    err(op.call("POST", f"/api/ops/claims/{ref}/quote", {}), 422, "validation_failed")
    k = idempotency_key()
    first = ok(op.quote(ref, k))
    assert ok(op.quote(ref, k)) == first
    assert len([i for i in kb_state(killbill, ref)["invoices"] if i.get("items")]) == 1
    err(op.pay(ref, k), 409, "idempotency_conflict", OPS["idempotency_conflict"])
    err(op.call("POST", f"/api/ops/claims/{ref}/quote", {"note": "other"}, key=k), 409, "idempotency_conflict")
    pk = idempotency_key()
    assert ok(op.pay(ref, pk)) == ok(op.pay(ref, pk))
    assert len(kb_tx(killbill, ref, "PURCHASE")) == 1
    dk = idempotency_key()
    assert ok(op.dispatch(ref, dk)) == ok(op.dispatch(ref, dk))
    assert len(copy_s3("before-cutoff").keys(f"claims/{ref}/dispatch-note")) == 1
    holds_for(lambda: len(mine(mail, c["email"], f"Part on its way for claim {ref}")) <= 1, 3, "one dispatched notice")
    main = Operator(app_url)
    m = claim_at(app_url, mail, "identified", main)
    mk = idempotency_key()
    err(main.on(copy_url("carrier-down")).quote(m["reference"], mk), 503, "carrier_unavailable")
    ok(main.quote(m["reference"], mk), 200, "a key whose request failed is a fresh attempt")


def test_wf_decline_and_close_unpaid(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    probe = claim_at(app_url, mail, "identified", op, model=BRAMWELL, booklet=2)
    b0 = probe["view"]["part"]["bin_count"]
    c = claim_at(app_url, mail, "quoted", op, model=BRAMWELL, booklet=2)
    ref = c["reference"]
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref, "/quote/1")
        ui_decline(page, "Owner declined the quote")
        wait_path(page, rf"^/ops/claims/{ref}/declined$")
        ui_until(page, lambda: has(slip(page), "Nothing charged") and has(status(page), "Claim declined."), "declined slip")
        page.goto(app_url + c["share_url"])
        ui_until(page, lambda: has(slip(page), "Nothing charged") and has(slip(page), "Declined"), "share page")
    st = kb_state(killbill, ref)
    assert st["invoices"] and all(is_void(i) for i in st["invoices"] if i.get("items")) and kb_balance_zero(st)
    v = op.view(ref)
    assert v["decline"] == {"reason": "owner_declined", "charged_minor": 0, "refunded_minor": 0}
    inbox(mail, c["email"], f"Claim {ref} declined — nothing charged")
    holds_for(lambda: len(mine(mail, c["email"], lambda s: "declined" in s)) == 1, 3, "one declined notice")
    assert op.view(probe["reference"])["part"]["bin_count"] == b0


def test_wf_decline_and_close_refund(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "paid", op, model=BRAMWELL, booklet=3)
    ref = c["reference"]
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref, "/quote/1")
        ui_decline(page, "Part cannot be sent")
        wait_path(page, rf"^/ops/claims/{ref}/declined$")
        refunds = poll(lambda: kb_tx(killbill, ref, "REFUND"), "Kill Bill holds a REFUND", MAIL_WAIT_S)
        assert refunds == kb_tx(killbill, ref, "PURCHASE"), "refund equals the purchase"
        ui_until(page, lambda: has(slip(page), f"Refunded {money(refunds[0])}"), "slip shows the refund")
        page.goto(app_url + c["share_url"])
        ui_until(page, lambda: has(slip(page), f"Refunded {money(refunds[0])}"), "share page shows the refund")
    assert op.view(ref)["decline"]["refunded_minor"] == refunds[0]
    inbox(mail, c["email"], f"Claim {ref} declined — {money(refunds[0])} refunded")


def test_wf_decline_and_close_polish(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    paid = claim_at(app_url, mail, "paid", op, model=BRAMWELL, booklet=4, language="pl-PL")
    unpaid = claim_at(app_url, mail, "quoted", op, language="pl-PL")
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, paid["reference"], "/quote/1")
        ui_decline(page, "Part cannot be sent")
        wait_path(page, r"/declined$")
        refund = poll(lambda: kb_tx(killbill, paid["reference"], "REFUND"), "REFUND recorded", MAIL_WAIT_S)[0]
        ui_until(page, lambda: has(slip(page), f"Refunded {money(refund)}"), "operator slip in English")
        ok(op.decline(unpaid["reference"]))
        page.goto(app_url + paid["share_url"])
        ui_switch(page, "pl")
        ui_until(page, lambda: has(slip(page, "pl"), f"Zwrócono {money(refund, 'pl')}"), "Polish refunded line")
        page.goto(app_url + unpaid["share_url"])
        ui_until(page, lambda: has(slip(page, "pl"), "Bez opłat"), "Polish nothing charged")
    inbox(mail, paid["email"], f"Zgłoszenie {paid['reference']} odrzucone — zwrot {money(refund, 'pl')}")
    inbox(mail, unpaid["email"], f"Zgłoszenie {unpaid['reference']} odrzucone — bez opłat")
    assert kb_balance_zero(kb_state(killbill, unpaid["reference"]))


def test_wf_decline_and_close_dialog_keyboard(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "quoted", op)
    ref = c["reference"]
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref, "/quote/1")
        opener = sbtn(page, "Decline")
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Decline claim", exact=True)
        ui_until(page, lambda: dlg.count() == 1, "dialog opens")
        first = dlg.get_by_role("radio", name="Owner declined the quote", exact=True)
        assert focused(first)
        assert dlg.get_by_role("radiogroup", name="Reason").count() == 1
        confirm_btn = dlg.get_by_role("button", name="Confirm decline", exact=True)
        if confirm_btn.is_enabled():
            click(confirm_btn)
            advance(page, 500)
        assert op.view(ref)["state"] == "quoted", "Confirm decline needs a reason"
        cancel = dlg.get_by_role("button", name="Cancel", exact=True)
        cancel.focus()
        page.keyboard.press("Tab")
        assert dlg.first.evaluate("e => e.contains(document.activeElement)"), "Tab from Cancel stays in the dialog"
        assert focused(first) or focused(dlg.get_by_role("radio", name="Part cannot be sent")), "wraps to the first control"
        first.focus()
        page.keyboard.press("Shift+Tab")
        assert focused(cancel), "Shift+Tab from the first control wraps to Cancel"
        page.keyboard.press("Escape")
        advance(page, DIALOG_FADE_OUT_MS + 100)
        assert dlg.count() == 0 and focused(opener), "Escape closes and returns focus to Decline"
        page.keyboard.press("Enter")
        ui_until(page, lambda: dlg.count() == 1, "reopens")
        click(dlg.get_by_role("radio", name="Part cannot be sent", exact=True))
        dlg.get_by_role("button", name="Confirm decline", exact=True).focus()
        page.keyboard.press("Enter")
        wait_path(page, rf"^/ops/claims/{ref}/declined$")
    assert op.view(ref)["decline"]["reason"] == "cannot_send"


def test_wf_decline_and_close_dialog_reopen(browser: Any, app_url: str, mail: Any) -> None:
    c = claim_at(app_url, mail, "quoted", Operator(app_url))
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, c["reference"], "/quote/1")
        for opener, name, first in (("Decline", "Decline claim", ("radio", "Owner declined the quote")),
                                    ("Erase owner data", "Erase owner data", ("textbox", "Type the reference to confirm"))):
            dlg = open_dialog(page, opener, name)
            page.keyboard.press("Escape")
            advance(page, DIALOG_FADE_OUT_MS // 3)
            sbtn(page, opener).focus()
            page.keyboard.press("Enter")
            for _ in range(4):
                advance(page, 500)
                assert dlg.count() == 1 and dlg.is_visible(), f"{name} stays open after the earlier close timer"
            assert focused(dlg.get_by_role(first[0], name=first[1])), f"focus on {first[1]}"
            page.keyboard.press("Escape")
            advance(page, DIALOG_FADE_OUT_MS + 100)


def check_dialog_layout(page: Any, w: int, h: int, dlg: Any, action: str, stacked: list[Any]) -> None:
    d = box(dlg)
    a = box(dlg.get_by_role("button", name=action, exact=True))
    c = box(dlg.get_by_role("button", name="Cancel", exact=True))
    tops = [box(x)["y"] for x in stacked]
    assert tops == sorted(tops) and len(set(round(t) for t in tops)) == len(tops), f"{w}: controls stacked in order"
    if w < 768:
        assert near(d["x"], COLUMN_LEFT) and near(d["x"] + d["width"], COLUMN_RIGHT), f"{w}: dialog spans 16..359"
        assert a["y"] < c["y"] and near(a["width"], c["width"]), f"{w}: action above Cancel, equal widths"
    else:
        assert near(d["width"], DIALOG_WIDTH) and near(d["x"], (w - DIALOG_WIDTH) / 2), f"{w}: 480 px centred"
        assert near(d["y"], h - d["y"] - d["height"]), f"{w}: centred vertically"
        assert near(a["y"], c["y"]) and a["x"] < c["x"], f"{w}: buttons share a row, action left"
        assert c["x"] + c["width"] <= d["x"] + d["width"] + TOL
    no_overflow(page)


def test_wf_decline_and_close_dialog_layout(browser: Any, app_url: str, mail: Any) -> None:
    c = claim_at(app_url, mail, "quoted", Operator(app_url))
    for w, h in VIEWPORTS:
        with browse(browser, app_url + "/ops/sign-in", viewport=(w, h)) as page:
            ui_sign_in(page, app_url)
            ui_workspace(page, app_url, c["reference"], "/quote/1")
            panes = [fan(page), slip(page)] + ([page.get_by_role("navigation", name="Claim queue")] if w >= 1280 else [])
            reveal(sbtn(page, "Decline"))
            before = [box(p) for p in panes]
            dlg = open_dialog(page, "Decline", "Decline claim")
            settle(dlg)
            for b0, p in zip(before, panes):
                b1 = box(p)
                assert all(near(b0[k], b1[k]) for k in ("x", "y", "width", "height")), f"{w}: pane moved {b0} -> {b1}"
            check_dialog_layout(page, w, h, dlg, "Confirm decline",
                                [dlg.get_by_role("radio", name="Owner declined the quote"),
                                 dlg.get_by_role("radio", name="Part cannot be sent"),
                                 dlg.get_by_role("button", name="Confirm decline")])


def test_wf_decline_and_close_mail_outage(browser: Any, app_url: str, mail: Any) -> None:
    down = copy_url("mailpit-down")
    op = Operator(app_url)
    c = claim_at(app_url, mail, "quoted", op, booklet=4, description="probe-" + uuid.uuid4().hex)
    ref = c["reference"]
    with browse(browser, down + "/ops/sign-in") as page:
        ui_sign_in(page, down)
        ui_workspace(page, down, ref, "/quote/1")
        ui_decline(page, "Owner declined the quote")
        wait_path(page, rf"^/ops/claims/{ref}/declined$")
        ui_until(page, lambda: loc_text(status(page)).startswith("Claim declined."), "declined status")
        st = loc_text(status(page))
        assert st == "Claim declined." or re.fullmatch(r"Claim declined\. Notices waiting to send: [1-9]\d*", st), st
        msg = inbox(mail, c["email"], f"Claim {ref} declined — nothing charged", seconds=QUEUE_SEND_S + QUEUE_CHECK_S)[0]
        ui_until(page, lambda: "Notices waiting to send" not in loc_text(status(page)), "waiting line removed at 0",
                 seconds=UI_WAIT_S, step_ms=WORKSPACE_REFRESH_MS)
    holds_for(lambda: len(mine(mail, c["email"], lambda s: "declined" in s)) == 1, QUEUE_CHECK_S * 2, "sent exactly once")
    quoted = mine(mail, c["email"], lambda s: s.startswith(f"Quote for claim {ref}:"))
    assert len(quoted) == 1
    for m in (msg, quoted[0]):
        for private in (c["name"], POSTCODE, c["view"]["description"]):
            assert private not in text(m), f"notice leaks {private!r}"
    assert op.view(ref)["state"] == "declined"


def test_wf_decline_and_close_stock_edge(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    probe = claim_at(app_url, mail, "identified", op, model=ALDRA, booklet=3)
    b0 = probe["view"]["part"]["bin_count"]
    assert 1 <= b0 < QUANTITY_MAX, f"Aldra shelf bin {b0} must allow the stock edge"

    def bin_now() -> int:
        return op.view(probe["reference"])["part"]["bin_count"]

    a = claim_at(app_url, mail, "quoted", op, model=ALDRA, booklet=3, quantity=b0)
    assert a["view"]["quotes"][0]["source"] == "bin" and bin_now() == 0
    b = claim_at(app_url, mail, "quoted", op, model=ALDRA, booklet=3, quantity=b0 + 1)
    assert b["view"]["quotes"][0]["source"] == "supplier" and bin_now() == 0
    ok(op.quote(a["reference"]))
    assert bin_now() == 0
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, a["reference"], "/quote/2")
        ui_decline(page, "Owner declined the quote")
        wait_path(page, r"/declined$")
    ok(op.decline(b["reference"]))
    assert bin_now() == b0, "decline returns the units exactly once"
    c1 = claim_at(app_url, mail, "quoted", op)
    c2 = claim_at(app_url, mail, "quoted", op)
    for bad, code in (("k" * (KEY_MAX + 1), "invalid"), ("key\tpart", "invalid"), ("two words", "invalid"),
                      ("ключ".encode("utf-8"), "invalid"), ("", "required")):
        e = err(op.decline(c1["reference"], key=bad), 422, "validation_failed", None, f"key {bad!r}")
        assert e["fields"]["idempotency_key"] == code
    key = "k" * KEY_MAX
    first = ok(op.decline(c1["reference"], key=key))
    assert ok(op.decline(c1["reference"], key=key)) == first
    err(op.decline(c1["reference"], "cannot_send", key=key), 409, "idempotency_conflict", OPS["idempotency_conflict"])
    ok(op.decline(c2["reference"], key=key), 200, "the same key on another claim is independent")


def test_wf_decline_and_close_foreign_refs(app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    a = claim_at(app_url, mail, "quoted", op)
    b = claim_at(app_url, mail, "quoted", op)
    ra, rb = a["reference"], b["reference"]
    quote_notice(mail, a)
    quote_notice(mail, b)
    before = (kb_state(killbill, ra)["invoices"], kb_state(killbill, rb)["invoices"],
              len(mine(mail, a["email"])), len(mine(mail, b["email"])))
    unknown = op.decline(random_ref())
    assert unknown.status_code == 404 and unknown.json() == {"error": {"code": "not_found", "message": OPS["not_found"]}}
    attempts = []
    for ref in (MALFORMED_REF, random_ref()):
        for name in ("identify", "quote", "payment", "decline", "dispatch", "close", "share-link"):
            attempts.append(op.call("POST", f"/api/ops/claims/{ref}/{name}", {}, key=idempotency_key()))
        attempts.append(op.call("GET", f"/api/ops/claims/{ref}"))
        attempts.append(op.call("DELETE", f"/api/ops/claims/{ref}/share-link"))
    attempts += [op.action(ra, "decline", {"reason": "bogus", "reference": rb}),
                 op.action(ra, "quote", {"reference": rb}),
                 op.call("POST", f"/api/ops/claims/{ra}/payment", {"reference": rb}),
                 op.call("POST", f"/api/ops/claims/{ra}/identify", {"reference": rb, "booklet_number": 0})]
    for r in attempts:
        assert r.status_code == 404 and r.content == unknown.content, f"{r.request.method} {r.request.url}: {r.text}"
    assert op.view(ra)["state"] == op.view(rb)["state"] == "quoted"
    after = (kb_state(killbill, ra)["invoices"], kb_state(killbill, rb)["invoices"],
             len(mine(mail, a["email"])), len(mine(mail, b["email"])))
    assert after == before, "nothing changed in Kill Bill or Mailpit"


def test_wf_decline_and_close_close(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "dispatched", op)
    ref = c["reference"]
    assert err(op.close(claim_at(app_url, mail, "quoted", op)["reference"]), 409, "wrong_state")["state"] == "quoted"
    with browse(browser, app_url + c["share_url"], viewport=PHONE) as owner_page:
        ui_until(owner_page, lambda: has(slip(owner_page), "Dispatched"), "share page open")
        assert share(app_url, c["share_token"]).status_code == 200, "last request before close answers"
        with browse(browser, app_url + "/ops/sign-in") as page:
            ui_sign_in(page, app_url)
            ui_workspace(page, app_url, ref, "/dispatched")
            click(sbtn(page, "Close claim"))
            ui_until(page, lambda: has(status(page), "Claim closed."), "closed status")
            assert path_of(page) == f"/ops/claims/{ref}"
        err(share(app_url, c["share_token"]), 410, "claim_closed", OWN["claim_closed"][0])
        advance(owner_page, SHARE_REFRESH_MS)
        ui_until(owner_page, lambda: has(alert(owner_page), OWN["claim_closed"][0]) and slip(owner_page).count() == 0,
                 "share page removes the claim and shows the closed copy", step_ms=1000)
    m = inbox(mail, c["email"], f"Claim {ref} is closed")[0]
    assert "/s/" not in text(m)
    holds_for(lambda: len(mine(mail, c["email"], f"Claim {ref} is closed")) == 1, 3, "closed notice once")
    for r in (op.withdraw(ref), op.new_link(ref)):
        assert err(r, 409, "wrong_state")["state"] == "closed"
    d = claim_at(app_url, mail, "quoted", op)
    ok(op.decline(d["reference"]))
    assert ok(op.close(d["reference"]))["state"] == "closed"


def test_wf_decline_and_close_billing_outage(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "quoted", op, booklet=4)
    ref = c["reference"]
    bin_before = op.view(ref)["part"]["bin_count"]
    down = copy_url("killbill-down")
    with browse(browser, down + "/ops/sign-in") as page:
        ui_sign_in(page, down)
        ui_workspace(page, down, ref, "/quote/1")
        ui_decline(page, "Owner declined the quote")
        ui_until(page, lambda: has(alert(page), OPS["billing_unavailable"]), "billing copy")
        assert path_of(page) == f"/ops/claims/{ref}/quote/1"
    v = op.view(ref)
    assert v["state"] == "quoted" and v["decline"] is None and v["part"]["bin_count"] == bin_before
    assert kb_current(killbill, ref)["total"] > 0, "invoice not voided"
    assert not mine(mail, c["email"], lambda s: "declined" in s)
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref, "/quote/1")
        ui_decline(page, "Owner declined the quote")
        wait_path(page, r"/declined$")


def test_wf_owner_tracking_follow(browser: Any, mail: Any, killbill: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "confirmed", op, quantity=EXAMPLE_QUANTITY)
    ref = c["reference"]
    cover = anniversary(date.fromisoformat(PURCHASE), STANDARD_MONTHS)
    with browse(browser, base + c["share_url"], device_clock=DEVICE_CLOCK) as page:
        def see(*lines: str) -> None:
            page.reload()
            for line in lines:
                ui_until(page, lambda line=line: has(slip(page), line), f"share slip shows {line!r}")
        see("Confirmed", "Not yet ruled", "Part 3: Shelf pin", f"Part number {PIN_NUMBER}")
        ok(op.identify(ref, KESTLE, 3, EXAMPLE_QUANTITY))
        see("Identified", "Inside aftercare", f"Cover until 00:00 on {date_text(cover)}", f"Ruled by edition {AC_2026}")
        ok(op.quote(ref))
        kb = kb_current(killbill, ref)
        see("Quoted", "Quote revision 1", f"Part {money(kb['part'])}", f"Total {money(kb['total'])}",
            f"Carriage, band {DEFAULT_BAND} {money(kb['carriage'])}",
            f"Same-working-day dispatch: leaves the workshop on {date_text(FROZEN['before-cutoff'].date())}")
        ok(op.pay(ref))
        see(f"Paid {money(kb_tx(killbill, ref, 'PURCHASE')[0])}")
        ok(op.dispatch(ref))
        see("Dispatched")
    sv = ok(share(base, c["share_token"]))
    assert sv["state"] == "dispatched" and sv["ruling"]["edition"] == AC_2026 and sv["quote"]["total_minor"] == kb["total"]


def test_wf_owner_tracking_live_update(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "identified", op)
    with browse(browser, app_url + c["share_url"], viewport=PHONE) as page:
        ui_until(page, lambda: has(slip(page), "Identified"), "share page loads")
        page.evaluate("() => { window.__noLoad = true; window.scrollTo(0, 200); }")
        hist = slip(page).get_by_role("button", name="Claim history", exact=True)
        hist.focus()
        advance(page, 100)
        y0 = page.evaluate("() => window.scrollY")
        ok(op.quote(c["reference"]))
        elapsed = 0
        while elapsed < SHARE_CHANGE_MS and not has(slip(page), "Quote revision 1"):
            advance(page, 5000)
            elapsed += 5000
            settle = time.monotonic() + 3
            while time.monotonic() < settle and elapsed < SHARE_CHANGE_MS and not has(slip(page), "Quote revision 1"):
                advance(page, 100)
                elapsed += 100
        assert has(slip(page), "Quote revision 1"), "new revision shows within 35 s"
        assert page.evaluate("() => window.__noLoad === true"), "no page load"
        assert abs(page.evaluate("() => window.scrollY") - y0) <= TOL and focused(hist)
        page.route("**/api/share/**", proxy_to(copy_url("postgres-down")))
        advance(page, SHARE_REFRESH_MS)
        ui_until(page, lambda: has(alert(page), OWN["database_unavailable"][0]), "records copy on a 503 refresh", step_ms=500)
        assert has(slip(page), "Quote revision 1"), "content kept through the outage"
        page.unroute("**/api/share/**")
        advance(page, SHARE_REFRESH_MS)
        ui_until(page, lambda: loc_text(alert(page)).strip() == "", "next good refresh empties the alert", step_ms=500)
        ok(op.withdraw(c["reference"]), 204)
        advance(page, SHARE_REFRESH_MS)
        ui_until(page, lambda: has(alert(page), OWN["link_withdrawn"][0]) and slip(page).count() == 0,
                 "content removed when the link ends", step_ms=500)


def test_wf_owner_tracking_link_end(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "confirmed", op)
    ref = c["reference"]
    assert share(app_url, c["share_token"]).status_code == 200
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref)
        click(sbtn(page, "Withdraw share link"))
        ui_until(page, lambda: has(status(page), "Share link withdrawn."), "withdrawn status")
        assert path_of(page) == f"/ops/claims/{ref}"
        err(share(app_url, c["share_token"]), 410, "link_withdrawn", OWN["link_withdrawn"][0])
        click(sbtn(page, "Send new share link"))
        ui_until(page, lambda: has(status(page), "New share link created."), "new link status")
    m = inbox(mail, c["email"], f"New link for claim {ref}")[0]
    new = re.search(r"/s/([A-Za-z0-9_\-]+)", text(m)).group(1)
    assert new != c["share_token"] and ok(share(app_url, new))["reference"] == ref
    err(share(app_url, c["share_token"]), 410, "link_withdrawn")
    with browse(browser, app_url + c["share_url"]) as page:
        ui_until(page, lambda: has(alert(page), OWN["link_withdrawn"][0]) and slip(page).count() == 0, "old link refused")
    d = claim_at(app_url, mail, "dispatched", op)
    assert share(app_url, d["share_token"]).status_code == 200
    ok(op.close(d["reference"]))
    err(share(app_url, d["share_token"]), 410, "claim_closed")


def test_wf_owner_tracking_find(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "confirmed", op)
    started = new_claim(app_url, mail)
    with browse(browser, app_url + "/find") as page:
        ref_box = page.get_by_role("textbox", name="Claim reference", exact=True)
        mail_box = page.get_by_role("textbox", name="Email", exact=True)
        button = page.get_by_role("button", name="Find claim", exact=True)
        fill(ref_box, c["reference"])
        fill(mail_box, "wrong-" + c["email"])
        click(button)
        ui_until(page, lambda: has(alert(page), OWN["not_found"][0]), "not-found copy")
        assert path_of(page) == "/find"
        fill(ref_box, started["reference"])
        fill(mail_box, started["email"])
        click(button)
        ui_until(page, lambda: has(alert(page), OWN["wrong_state"][0]), "unconfirmed copy")
        ui_switch(page, "pl")
        fill(page.get_by_role("textbox", name="Numer zgłoszenia", exact=True), c["reference"])
        fill(page.get_by_role("textbox", name="E-mail", exact=True), "wrong-" + c["email"])
        click(page.get_by_role("button", name="Znajdź zgłoszenie", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["not_found"][1]), "Polish not-found copy")
        ui_switch(page, "en")
        fill(ref_box, c["reference"].lower())
        fill(mail_box, c["email"].upper())
        with held(page, "**/api/claims/lookup") as gate:
            click(button)
            ui_until(page, lambda: button.is_disabled() and has(status(page), "Looking up your claim…"), "pending")
            gate.release()
        assert wait_path(page, r"^/s/") == c["share_url"]
    e = err(post(app_url, "/api/claims/lookup", {}), 422, "validation_failed")
    assert e["fields"] == {"reference": "required", "email": "required"}
    d = claim_at(app_url, mail, "dispatched", op)
    ok(op.close(d["reference"]))
    err(post(app_url, "/api/claims/lookup", {"reference": d["reference"], "email": d["email"]}), 410, "claim_closed",
        OWN["claim_closed"][0])


def test_wf_owner_tracking_lock(browser: Any, mail: Any) -> None:
    base = copy_url("short-timer")
    c = claim_at(base, mail, "confirmed")
    right = {"reference": c["reference"], "email": c["email"]}
    wrong = {"reference": c["reference"], "email": "wrong-" + c["email"]}
    for _ in range(LOCK_TRIES - 1):
        err(post(base, "/api/claims/lookup", wrong), 404, "not_found")
    ok(post(base, "/api/claims/lookup", right), 200, "4 wrong tries do not lock; success resets")
    for _ in range(LOCK_TRIES):
        err(post(base, "/api/claims/lookup", wrong), 404, "not_found", OWN["not_found"][0])
    r = post(base, "/api/claims/lookup", right)
    err(r, 423, "reference_locked", OWN["reference_locked"][0])
    assert 1 <= int(r.headers["Retry-After"]) <= SHORT_LOCK_S
    with browse(browser, base + "/find") as page:
        fill(page.get_by_role("textbox", name="Claim reference", exact=True), c["reference"])
        fill(page.get_by_role("textbox", name="Email", exact=True), c["email"])
        click(page.get_by_role("button", name="Find claim", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["reference_locked"][0]), "locked copy")
    poll(lambda: post(base, "/api/claims/lookup", right).status_code == 200, "lock ends", SHORT_LOCK_S + UI_WAIT_S)
    zb = copy_url("zero-limits")
    z = claim_at(zb, mail, "confirmed")
    for _ in range(LOCK_TRIES):
        err(post(zb, "/api/claims/lookup", {"reference": z["reference"], "email": "x" + z["email"]}), 404, "not_found")
    ok(post(zb, "/api/claims/lookup", {"reference": z["reference"], "email": z["email"]}), 200, "zero lock")


def test_wf_owner_tracking_layouts(browser: Any, app_url: str, mail: Any) -> None:
    c = claim_at(app_url, mail, "confirmed", Operator(app_url))
    for w, h in VIEWPORTS:
        with browse(browser, app_url + c["share_url"], viewport=(w, h)) as page:
            heading = page.get_by_role("heading", name=f"Claim {c['reference']}")
            ui_until(page, lambda: slip(page).count() == 1 and heading.count() == 1, "share page renders")
            hd, f, s = box(heading), box(fan(page)), box(slip(page))
            no_overflow(page)
            if w < 768:
                assert hd["y"] < f["y"] and f["y"] + f["height"] <= s["y"] + TOL, "heading, fan, slip"
                assert near(f["width"], w - PAGE_SIDES) and near(s["width"], w - PAGE_SIDES)
            else:
                assert f["x"] < s["x"] and near(f["y"], s["y"]), f"{w}: two columns with equal tops"
                assert 0.595 <= f["width"] / (f["width"] + s["width"]) <= 0.705
                assert s["x"] - (f["x"] + f["width"]) >= GUTTER_MIN - TOL
                if w >= 1280:
                    content = s["x"] + s["width"] - f["x"]
                    assert content <= SHARE_MAX + TOL and near(f["x"], w - (s["x"] + s["width"])), "≤1,200 px centred"
            ui_switch(page, "pl")
            for en, loc in ((f, fan(page, "pl")), (s, slip(page, "pl"))):
                pb = box(loc)
                assert near(pb["x"], en["x"]) and near(pb["width"], en["width"]), f"{w}: Polish box kept"
        with browse(browser, app_url + "/find", viewport=(w, h)) as page:
            hd = box(page.get_by_role("heading", name="Find my claim"))
            r = box(page.get_by_role("textbox", name="Claim reference", exact=True))
            e = box(page.get_by_role("textbox", name="Email", exact=True))
            b = box(page.get_by_role("button", name="Find claim", exact=True))
            assert hd["y"] < r["y"] < e["y"] < b["y"], f"{w}: find order"
            col = w - PAGE_SIDES if w < 768 else FIND_COLUMN
            for t in (r, e):
                assert near(t["width"], col), f"{w}: textbox {t['width']} wide; expected {col}"
            if w >= 768:
                assert near(r["x"], (w - FIND_COLUMN) / 2)
            assert b["x"] + b["width"] <= r["x"] + col + TOL and near(b["x"], r["x"])
            no_overflow(page)
            ui_switch(page, "pl")
            pr = box(page.get_by_role("textbox", name="Numer zgłoszenia", exact=True))
            assert near(pr["x"], r["x"]) and near(pr["width"], r["width"])


def test_wf_owner_tracking_billing_agreement(browser: Any, mail: Any, killbill: Any) -> None:
    base = copy_url("before-cutoff")
    op = Operator(base)
    c = claim_at(base, mail, "quoted", op, quantity=EXAMPLE_QUANTITY)
    ref = c["reference"]
    ok(op.quote(ref))
    ok(op.pay(ref))
    ok(op.dispatch(ref))
    kb = kb_current(killbill, ref)
    paid = kb_tx(killbill, ref, "PURCHASE")
    assert paid == [kb["total"]]
    lines = [f"Part {money(kb['part'])}", f"Carriage, band {DEFAULT_BAND} {money(kb['carriage'])}",
             f"Total {money(kb['total'])}", f"Paid {money(paid[0])}"]
    with browse(browser, base + c["share_url"]) as page:
        for line in lines:
            ui_until(page, lambda line=line: has(slip(page), line), f"share page shows {line!r}")
        assert has(slip(page), "Quote revision 2") and not has(slip(page), "Quote revision 1")
        assert "void" not in loc_text(slip(page)).lower()
    note = note_lines(copy_s3("before-cutoff").get(f"claims/{ref}/dispatch-note.html"))
    assert all(line in note for line in lines), "the note carries the same figures"
    quoted = inbox(mail, c["email"], lambda s: s.startswith(f"Quote for claim {ref}:"), count=2)
    newest = max(quoted, key=lambda m: m.get("Created", ""))
    assert newest["Subject"] == f"Quote for claim {ref}: {money(kb['total'])}"
    assert ok(share(base, c["share_token"]))["quote"]["revision"] == 2


def test_wf_owner_tracking_foreign_refs(app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    a = claim_at(app_url, mail, "confirmed", op)
    b = claim_at(app_url, mail, "confirmed", op)
    e = claim_at(app_url, mail, "confirmed", op)
    ok(op.erase(e["reference"], e["reference"]))
    lookup = lambda ref, email: post(app_url, "/api/claims/lookup", {"reference": ref, "email": email})
    base_body = lookup(random_ref(), a["email"])
    err(base_body, 404, "not_found", OWN["not_found"][0])
    for r in (lookup(MALFORMED_REF, a["email"]), lookup(e["reference"], e["email"]), lookup(a["reference"], b["email"])):
        assert r.status_code == 404 and r.content == base_body.content
    for _ in range(LOCK_TRIES - 2):
        lookup(a["reference"], b["email"])
    ok(lookup(b["reference"], b["email"]), 200, "b's own reference is not counted")
    err(lookup(a["reference"], b["email"]), 404, "not_found")
    err(lookup(a["reference"], a["email"]), 423, "reference_locked")
    ok(lookup(b["reference"], b["email"]))
    unknown = share(app_url, secrets.token_urlsafe(32))
    err(unknown, 404, "share_unknown", OWN["share_unknown"][0])
    for token in (e["share_token"], "x"):
        r = share(app_url, token)
        assert r.status_code == 404 and r.content == unknown.content
    assert ok(share(app_url, b["share_token"], params={"reference": a["reference"]}))["reference"] == b["reference"]
    assert op.view(b["reference"])["state"] == "confirmed"


def test_wf_owner_tracking_read_only(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "quoted", op, description="probe-" + uuid.uuid4().hex)
    r = share(app_url, c["share_token"])
    body = ok(r)
    assert set(body) <= SHARE_VIEW_KEYS
    acct = kb_state(killbill, c["reference"])["account"]
    for private in (c["email"], c["name"], POSTCODE, c["view"]["description"], acct["accountId"], f"claims/{c['reference']}/"):
        assert private not in r.text, f"share view leaks {private!r}"
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for headers in ({}, {"Cookie": op.cookie}):
            err(httpx.request(method, f"{app_url}/api/share/{c['share_token']}", json={"state": "closed"},
                              headers=headers, timeout=HTTP_TIMEOUT), 405, "read_only", None, method)
    assert op.view(c["reference"])["state"] == "quoted"
    with browse(browser, app_url + c["share_url"]) as page:
        ui_until(page, lambda: fan(page).get_attribute("data-active-part") == "3", "claimed part selected")
        part_button(page, 2, "Shelf board").focus()
        page.keyboard.press("Enter")
        page.keyboard.press("]")
        advance(page, 400)
        assert fan(page).get_attribute("data-active-part") == "3", "the owner cannot change the selection"
        slider(page).focus()
        page.keyboard.press("Home")
        assert slider_value(slider(page)) == "0" and fan(page).get_attribute("data-fan-separation") == "0"


def test_wf_owner_tracking_history(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "identified", op)
    hist_api = ok(share(app_url, c["share_token"]))["history"]
    assert [h["state"] for h in hist_api] == ["started", "confirmed", "identified"]
    with browse(browser, app_url + c["share_url"], device_clock=DEVICE_CLOCK) as page:
        button = slip(page).get_by_role("button", name="Claim history", exact=True)
        ui_until(page, lambda: button.count() == 1, "history button inside the slip")
        assert button.get_attribute("aria-expanded") == "false"
        entries = [history_line(h["state"], h["at"]) for h in hist_api]
        assert entries[0] not in aria(slip(page))
        button.focus()
        page.keyboard.press("Enter")
        ui_until(page, lambda: button.get_attribute("aria-expanded") == "true", "expanded")
        for line in entries:
            ui_until(page, lambda line=line: has(slip(page), line), f"entry {line!r}")
        first = slip(page).get_by_text(entries[0], exact=False)
        assert box(first)["y"] >= box(button)["y"] + box(button)["height"] - TOL, "entries sit below the button"
        page.keyboard.press("Space")
        ui_until(page, lambda: button.get_attribute("aria-expanded") == "false", "Space collapses")


def test_wf_owner_tracking_records_outage_find(browser: Any, app_url: str, mail: Any) -> None:
    c = claim_at(app_url, mail, "confirmed", Operator(app_url))
    down = copy_url("postgres-down")
    with browse(browser, down + "/find") as page:
        fill(page.get_by_role("textbox", name="Claim reference", exact=True), c["reference"])
        fill(page.get_by_role("textbox", name="Email", exact=True), "x" + c["email"])
        click(page.get_by_role("button", name="Find claim", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["database_unavailable"][0]), "records copy")
        ui_switch(page, "pl")
        click(page.get_by_role("button", name="Znajdź zgłoszenie", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["database_unavailable"][1]), "Polish records copy")
    for _ in range(LOCK_TRIES):
        err(post(down, "/api/claims/lookup", {"reference": c["reference"], "email": "x" + c["email"]}), 503,
            "database_unavailable", OWN["database_unavailable"][0])
    assert ok(post(app_url, "/api/claims/lookup", {"reference": c["reference"], "email": c["email"]}))["share_url"] == c["share_url"]


def ui_erase(page: Any, ref: str) -> None:
    dlg = open_dialog(page, "Erase owner data", "Erase owner data")
    fill(dlg.get_by_role("textbox", name="Type the reference to confirm", exact=True), ref)
    click(dlg.get_by_role("button", name="Erase everything", exact=True))
    wait_path(page, rf"^/ops/claims/{ref}$")
    ui_until(page, lambda: has(status(page), "Owner data erased."), "erased status")


def owner_claims(base: str, mail: Any, op: Operator, email: str, stages: tuple[str, ...], **kw: Any) -> list[dict]:
    return [claim_at(base, mail, s, op, email=email, **kw) for s in stages]


def test_wf_erasure_happy(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    _, email = owner()
    claims = owner_claims(app_url, mail, op, email, ("confirmed", "quoted"))
    ref = claims[0]["reference"]
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref)
        ui_erase(page, ref)
        ui_until(page, lambda: has(slip(page), "Erased"), "slip shows Erased")
        page.reload()
        ui_until(page, lambda: has(slip(page), "Erased"), "cold reload keeps Erased")
    for c in claims:
        v = op.view(c["reference"])
        assert set(v) == {"reference", "state", "erased_at"} and v["state"] == "erased"
        row = claim_row(Postgres(), c["reference"])
        assert row["state"] == "erased" and row["erased"]


def test_wf_erasure_nothing_left(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    name, email = owner()
    desc = "probe-" + uuid.uuid4().hex
    claims = owner_claims(app_url, mail, op, email, ("started", "confirmed", "dispatched"), name=name, description=desc)
    stats = op.stats()
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        counts = page.get_by_role("status", name="Decided claims")
        ui_until(page, lambda: re.search(r"\d", loc_text(counts)), "decided-claims count loaded")
        count_text = loc_text(counts)
        ui_workspace(page, app_url, claims[2]["reference"])
        ui_erase(page, claims[2]["reference"])
        page.goto(app_url + "/ops/claims")
        ui_until(page, lambda: loc_text(page.get_by_role("status", name="Decided claims")) == count_text, "count unchanged")
    db = Postgres()
    for needle in (email, name, desc):
        assert rows_mentioning(db, needle) == 0, f"a Postgres row still holds {needle!r}"
    for c in claims:
        assert rows_mentioning(db, c["reference"]) == 1, f"only the claims row holds {c['reference']}"
        assert S3().keys(f"claims/{c['reference']}/") == []
    assert mine(mail, email) == []
    assert op.stats() == stats


def test_wf_erasure_remains(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    _, email = owner()
    c = claim_at(app_url, mail, "quoted", op, email=email)
    decoy = claim_at(app_url, mail, "confirmed", op, email="agnes." + email)
    decoy_mail = len(mine(mail, "agnes." + email))
    assert decoy_mail >= 1
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, c["reference"])
        ui_erase(page, c["reference"])
        ui_until(page, lambda: sbtn(page, "Erase owner data").count() == 0 or sbtn(page, "Erase owner data").is_disabled(),
                 "Erase owner data disabled once erased")
    acct = killbill.account_by_key(c["reference"])
    assert acct is not None and acct["name"] == c["reference"] and not acct.get("email")
    assert len(mine(mail, "agnes." + email)) == decoy_mail, "a containing address keeps its mail"
    assert mine(mail, email) == []
    unknown = share(app_url, secrets.token_urlsafe(32))
    r = share(app_url, c["share_token"])
    assert r.status_code == 404 and r.content == unknown.content
    assert err(op.erase(c["reference"], c["reference"]), 409, "wrong_state")["state"] == "erased"
    assert op.view(decoy["reference"])["state"] == "confirmed"


def test_wf_erasure_typed_reference(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "confirmed", op)
    other = claim_at(app_url, mail, "confirmed", op)
    ref = c["reference"]
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref)
        dlg = open_dialog(page, "Erase owner data", "Erase owner data")
        box_ = dlg.get_by_role("textbox", name="Type the reference to confirm", exact=True)
        go = dlg.get_by_role("button", name="Erase everything", exact=True)
        for typed in (ref.lower(), " " + ref, ref + " ", "", other["reference"]):
            fill(box_, typed)
            assert go.is_disabled(), f"Erase everything disabled for {typed!r}"
        fill(box_, ref)
        ui_until(page, lambda: go.is_enabled(), "exact reference enables Erase everything")
        click(dlg.get_by_role("button", name="Cancel", exact=True))
    for typed, code in ((ref.lower(), "mismatch"), (" " + ref, "mismatch"), (ref + " ", "mismatch"),
                        ("", "required"), (other["reference"], "mismatch")):
        e = err(op.erase(ref, typed), 422, "validation_failed", None, repr(typed))
        assert e["fields"]["confirm_reference"] == code
    assert op.view(ref)["state"] == op.view(other["reference"])["state"] == "confirmed"
    assert ref in ok(op.erase(ref, ref))["erased"]


def test_wf_erasure_dialog_keyboard(browser: Any, app_url: str, mail: Any) -> None:
    c = claim_at(app_url, mail, "confirmed", Operator(app_url))
    ref = c["reference"]
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref)
        opener = sbtn(page, "Erase owner data")
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Erase owner data", exact=True)
        ui_until(page, lambda: dlg.count() == 1, "dialog opens")
        field = dlg.get_by_role("textbox", name="Type the reference to confirm", exact=True)
        cancel = dlg.get_by_role("button", name="Cancel", exact=True)
        assert focused(field)
        cancel.focus()
        page.keyboard.press("Tab")
        assert focused(field), "Tab from Cancel wraps to the textbox"
        page.keyboard.press("Shift+Tab")
        assert focused(cancel), "Shift+Tab wraps to Cancel"
        page.keyboard.press("Escape")
        advance(page, DIALOG_FADE_OUT_MS + 100)
        assert dlg.count() == 0 and focused(opener)
        assert "Type the reference to confirm" not in tab_order(page, 30), "closed dialog is unfocusable"
        opener.focus()
        page.keyboard.press("Enter")
        ui_until(page, lambda: focused(field), "reopens on the textbox")
        page.keyboard.type(ref)
        page.keyboard.press("Tab")
        assert focused(dlg.get_by_role("button", name="Erase everything", exact=True))
        page.keyboard.press("Enter")
        wait_path(page, rf"^/ops/claims/{ref}$")
        ui_until(page, lambda: (claim_row(Postgres(), ref) or {}).get("state") == "erased",
                 "the keyboard erase reaches the claims row")
    assert claim_row(Postgres(), ref)["state"] == "erased"


def test_wf_erasure_dialog_layout(browser: Any, app_url: str, mail: Any) -> None:
    c = claim_at(app_url, mail, "confirmed", Operator(app_url))
    for w, h in VIEWPORTS:
        with browse(browser, app_url + "/ops/sign-in", viewport=(w, h)) as page:
            ui_sign_in(page, app_url)
            ui_workspace(page, app_url, c["reference"])
            panes = [fan(page), slip(page)] + ([page.get_by_role("navigation", name="Claim queue")] if w >= 1280 else [])
            reveal(sbtn(page, "Erase owner data"))
            before = [box(p) for p in panes]
            dlg = open_dialog(page, "Erase owner data", "Erase owner data")
            settle(dlg)
            for b0, p in zip(before, panes):
                b1 = box(p)
                assert all(near(b0[k], b1[k]) for k in ("x", "y", "width", "height")), f"{w}: pane moved"
            stack = [dlg.get_by_role("textbox", name="Type the reference to confirm")]
            stack += [dlg.get_by_role("button", name="Erase everything")] if w < 768 else []
            check_dialog_layout(page, w, h, dlg, "Erase everything", stack + [dlg.get_by_role("button", name="Cancel")]
                                if w < 768 else stack + [dlg.get_by_role("button", name="Erase everything")])


def test_wf_erasure_foreign_refs(app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    a = claim_at(app_url, mail, "confirmed", op)
    b = claim_at(app_url, mail, "confirmed", op)
    unknown = op.erase(random_ref(), "x")
    assert unknown.status_code == 404 and unknown.json() == {"error": {"code": "not_found", "message": OPS["not_found"]}}
    attempts = [op.erase(MALFORMED_REF, MALFORMED_REF),
                op.call("POST", f"/api/ops/claims/{a['reference']}/erase", {"reference": b["reference"], "confirm_reference": a["reference"]}),
                op.call("POST", f"/api/ops/claims/{a['reference']}/erase", {"reference": b["reference"], "confirm_reference": ""}),
                op.call("POST", f"/api/ops/claims/{a['reference']}/erase", {"reference": MALFORMED_REF})]
    for r in attempts:
        assert r.status_code == 404 and r.content == unknown.content, r.text
    for c in (a, b):
        assert op.view(c["reference"])["state"] == "confirmed"
        assert mine(mail, c["email"]) and S3().keys(f"claims/{c['reference']}/photos/")


def test_wf_erasure_outage(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "confirmed", op)
    ref = c["reference"]
    for copy, code in (("minio-down", "storage_unavailable"), ("mailpit-down", "mail_unavailable")):
        base = copy_url(copy)
        with browse(browser, base + "/ops/sign-in") as page:
            ui_sign_in(page, base)
            ui_workspace(page, base, ref)
            dlg = open_dialog(page, "Erase owner data", "Erase owner data")
            fill(dlg.get_by_role("textbox", name="Type the reference to confirm", exact=True), ref)
            click(dlg.get_by_role("button", name="Erase everything", exact=True))
            ui_until(page, lambda code=code: has(alert(page), OPS[code]), f"{copy} copy")
        assert op.view(ref)["state"] == "confirmed" and S3().keys(f"claims/{ref}/photos/") and mine(mail, c["email"])
    ok(op.erase(ref, ref))
    assert S3().keys(f"claims/{ref}/") == [] and mine(mail, c["email"]) == []


def test_wf_erasure_club_roster(browser: Any, mail: Any) -> None:
    base = copy_url("london-edge-before")
    op = Operator(base)
    c = claim_at(base, mail, "confirmed", op, email=CLUB_INES)
    with browse(browser, base + "/ops/sign-in") as page:
        ui_sign_in(page, base)
        ui_workspace(page, base, c["reference"])
        ui_erase(page, c["reference"])
    later = claim_at(base, mail, "identified", op, email=CLUB_INES)
    assert later["view"]["ruling"]["term_months"] == STANDARD_MONTHS


def test_wf_erasure_all_states(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    _, email = owner()
    started = claim_at(app_url, mail, "started", op, email=email)
    declined = claim_at(app_url, mail, "quoted", op, email=email)
    ok(op.decline(declined["reference"]))
    closed = claim_at(app_url, mail, "dispatched", op, email=email)
    ok(op.close(closed["reference"]))
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, declined["reference"], "/declined")
        ui_erase(page, declined["reference"])
    for c in (started, declined, closed):
        assert op.view(c["reference"])["state"] == "erased"
    err(get(app_url, f"/api/claims/{started['reference']}/confirmation"), 404, "claim_unknown")
    err(post(app_url, "/api/claims/lookup", {"reference": closed["reference"], "email": email}), 404, "not_found")


def test_wf_fitting_fan_geometry(browser: Any, app_url: str) -> None:
    for (w, h), models in ((PHONE, (KESTLE,)), (TABLET, (KESTLE,)), (DESKTOP, (KESTLE, ALDRA, BRAMWELL))):
        gap = GAP_NARROW if w < 768 else GAP_WIDE
        with browse(browser, app_url + "/claim/new", viewport=(w, h)) as page:
            for model in models:
                select(page.get_by_role("combobox", name="Model", exact=True), MODELS[model][0])
                ui_until(page, lambda model=model: part_button(page, 1, MODELS[model][2][0]).count() == 1, "fan draws")
                for value in (25, 5, 100):
                    set_slider(page, value)
                    check_fan(page, model, value, gap, settled=False)
                    advance(page, GLIDE_SETTLED_MS)
                    settle(fan(page))
                    check_fan(page, model, value, gap)
                set_slider(page, 0)
                seps = []
                for _ in range(20):
                    page.keyboard.press("ArrowRight")
                    seps.append(int(fan(page).get_attribute("data-fan-separation")))
                assert seps == sorted(seps) and seps[-1] > seps[0], "separation rises step by step"
                down = []
                for _ in range(20):
                    page.keyboard.press("ArrowLeft")
                    down.append(int(fan(page).get_attribute("data-fan-separation")))
                assert down == sorted(down, reverse=True) and down[-1] == 0, "and falls step by step"


def test_wf_fitting_fan_keyboard(browser: Any, app_url: str) -> None:
    with browse(browser, app_url + "/claim/new") as page:
        select(page.get_by_role("combobox", name="Model", exact=True), MODELS[KESTLE][0])
        ui_until(page, lambda: slider(page).count() == 1, "fan draws")
        s = slider(page)
        s.focus()
        page.keyboard.press("Home")
        value = 0
        for key in ("ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowDown", "PageUp", "PageDown", "PageDown", "End",
                    "ArrowRight", "PageUp", "Home"):
            page.keyboard.press(key)
            value = {"End": 100, "Home": 0}.get(key, min(100, max(0, value + FAN_KEYS.get(key, 0))))
            assert slider_value(s) == str(value), f"{key} sets {value}"
        page.keyboard.press("End")
        advance(page, GLIDE_SETTLED_MS)
        names = MODELS[KESTLE][2]
        for k, name in enumerate(names, 1):
            page.keyboard.press("Tab")
            assert focused(part_button(page, k, name)), f"Tab reaches part {k} in booklet order"
        withdrawn = part_button(page, WITHDRAWN_BOOKLET, names[WITHDRAWN_BOOKLET - 1])
        assert withdrawn.get_attribute("aria-disabled") == "true"
        page.keyboard.press("Enter")
        assert fan(page).get_attribute("data-active-part") == "none"
        part_button(page, 2, names[1]).focus()
        page.keyboard.press("Enter")
        ui_until(page, lambda: fan(page).get_attribute("data-active-part") == "2", "Enter selects part 2")
        assert part_button(page, 2, names[1]).get_attribute("aria-pressed") == "true"
        assert part_button(page, 1, names[0]).get_attribute("aria-pressed") == "false"
        assert "Part 2: Shelf board" in page_text(page), "part line shows under the form"
        part_button(page, 1, names[0]).focus()
        page.keyboard.press("Shift+Tab")
        assert focused(s)


def test_wf_fitting_fan_reduced_motion(browser: Any, app_url: str, mail: Any) -> None:
    name, email = owner()
    n = len(MODELS[KESTLE][2])
    with browse(browser, app_url + "/claim/new", viewport=PHONE, reduced_motion="reduce") as page:
        fill(page.get_by_role("textbox", name="Your name", exact=True), name)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Postcode", exact=True), POSTCODE)
        select(page.get_by_role("combobox", name="Model", exact=True), MODELS[KESTLE][0])
        ui_until(page, lambda: slider(page).count() == 1, "fan draws")
        assert fan(page).get_attribute("data-fan-separation") == str(GAP_NARROW * (n - 1))
        assert slider_value(slider(page)) == "100"
        check_fan(page, KESTLE, 100, GAP_NARROW)
        slider(page).focus()
        page.keyboard.press("PageDown")
        assert not animations(fan(page)), "no glide under reduced motion"
        check_fan(page, KESTLE, 75, GAP_NARROW)
        page.keyboard.press("End")
        tap(part_button(page, 3, "Shelf pin"))
        ui_until(page, lambda: fan(page).get_attribute("data-active-part") == "3", "tap selects part 3")
        fill(page.get_by_role("spinbutton", name="Quantity", exact=True), "1")
        fill(page.get_by_label("Date of purchase", exact=True), PURCHASE)
        page.get_by_label("Damage photos", exact=True).set_input_files([file_payload("d.jpg", photo_bytes())])
        tap(page.get_by_role("button", name="Start claim", exact=True))
        ref = wait_path(page, r"^/claim/HG-[A-Z0-9]{6}/sent$").split("/")[2]
    inbox(mail, email, confirm_subject(ref))


def test_wf_fitting_fan_glide(browser: Any, app_url: str) -> None:
    names = MODELS[KESTLE][2]
    with browse(browser, app_url + "/claim/new") as page:
        select(page.get_by_role("combobox", name="Model", exact=True), MODELS[KESTLE][0])
        ui_until(page, lambda: slider(page).count() == 1, "fan draws")
        s = slider(page)
        s.focus()
        page.keyboard.press("[")
        assert fan(page).get_attribute("data-active-part") == "4", "[ with none selected picks the last active part"
        page.keyboard.press("End")
        for key, want in (("]", "4"), ("[", "3"), ("[", "2"), ("[", "1"), ("[", "1"), ("]", "2")):
            page.keyboard.press(key)
            assert fan(page).get_attribute("data-active-part") == want, f"{key} -> {want}"
            assert focused(s), "the shortcut leaves focus on the slider"
        part_button(page, 1, names[0]).focus()
        for key, want in (("]", "3"), ("]", "4"), ("]", "4")):
            page.keyboard.press(key)
            assert fan(page).get_attribute("data-active-part") == want, f"from a part button {key} -> {want}"
        advance(page, GLIDE_SETTLED_MS)
        click(part_button(page, 2, names[1]))
        advance(page, 50)
        click(part_button(page, 3, names[2]))
        for _ in range(4):
            advance(page, 500)
            pressed = [part_button(page, k + 1, names[k]).get_attribute("aria-pressed") for k in range(len(names))]
            assert pressed == ["false", "false", "true", "false", "false"], f"only the second pick stays: {pressed}"
            assert fan(page).get_attribute("data-active-part") == "3"


def test_fallback_list(browser: Any, app_url: str) -> None:
    names = MODELS[FENWICK][2]
    with browse(browser, app_url + "/claim/new") as page:
        select(page.get_by_role("combobox", name="Model", exact=True), MODELS[FENWICK][0])
        heading = page.get_by_role("heading", name="Diagram unavailable — choose your part from the list", exact=True)
        lst = page.get_by_role("list", name="Parts in booklet order", exact=True)
        ui_until(page, lambda: heading.count() == 1 and lst.count() == 1, "fallback heading and list")
        assert page.get_by_role("slider").count() == 0, "no slider in the accessibility tree"
        assert lst.get_attribute("data-active-part") == "none"
        tops = [box(lst.get_by_role("button", name=f"Part {k + 1}: {n}", exact=True))["y"] for k, n in enumerate(names)]
        assert tops == sorted(tops), "buttons in booklet order"
        lst.get_by_role("button", name=f"Part 2: {names[1]}", exact=True).focus()
        page.keyboard.press("Enter")
        ui_until(page, lambda: lst.get_attribute("data-active-part") == "2", "Enter selects")
        page.keyboard.press("]")
        assert lst.get_attribute("data-active-part") == "3", "the shortcut works in the list"
        ui_switch(page, "pl")
        assert page.get_by_role("heading", name="Diagram niedostępny — wybierz część z listy", exact=True).count() == 1
        assert page.get_by_role("list", name="Części w kolejności z instrukcji", exact=True).get_by_role(
            "button", name=f"Część 1: {names[0]}", exact=True).count() == 1


def test_wf_service_outages_boot(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    for copy in ("minio-down", "carrier-down", "killbill-down", "mailpit-down", "postgres-down"):
        base = copy_url(copy)
        assert ok(get(base, "/api/health")) == {"status": "ok"}
        with browse(browser, base + "/") as page:
            ui_until(page, lambda: page.get_by_role("heading", name="Holmgarth Aftercare").count() >= 1, f"{copy} home")
    q = {"model": KESTLE, "part": 3, "quantity": 1, "postcode": POSTCODE}
    err(get(copy_url("carrier-down"), "/api/carriage-estimate", params=q), 503, "carrier_unavailable", OWN["carrier_unavailable"][0])
    op = Operator(app_url)
    c = claim_at(app_url, mail, "identified", op)
    err(op.on(copy_url("killbill-down")).quote(c["reference"]), 503, "billing_unavailable", OPS["billing_unavailable"])
    assert kb_state(killbill, c["reference"])["account"] is None
    d = claim_at(app_url, mail, "paid", op)
    err(op.on(copy_url("minio-down")).dispatch(d["reference"]), 503, "storage_unavailable", OPS["storage_unavailable"])
    assert op.view(d["reference"])["state"] == "quoted"
    _, email = owner()
    err(start_claim(copy_url("mailpit-down"), email), 503, "mail_unavailable", OWN["mail_unavailable"][0])
    pg = copy_url("postgres-down")
    err(get(pg, "/api/models"), 503, "database_unavailable", OWN["database_unavailable"][0])
    err(post(pg, "/api/ops/session", {"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD}), 503,
        "database_unavailable", OPS["database_unavailable"])
    with browse(browser, copy_url("carrier-down") + "/claim/new") as page:
        name, em = owner()
        ui_fill_claim(page, name=name, email=em)
        region = page.get_by_role("region", name="Carriage estimate", exact=True)
        click(region.get_by_role("button", name="Estimate carriage", exact=True))
        ui_until(page, lambda: has(region, OWN["carrier_unavailable"][0]) or has(alert(page), OWN["carrier_unavailable"][0]),
                 "carrier outage copy")


@pytest.mark.timeout(1200)
def test_wf_service_outages_recover(browser: Any) -> None:
    db_url, carrier_url = os.environ.get("DATABASE_URL"), os.environ.get("WIREMOCK_URL")
    if not db_url or not carrier_url:
        pytest.fail("DATABASE_URL and WIREMOCK_URL must be set to start a recovery copy")
    pg, wm = urlparse(db_url), urlparse(carrier_url)
    pg_relay = Relay(pg.hostname, pg.port or 5432)
    wm_relay = Relay(wm.hostname, wm.port or 80)
    overrides = {"DATABASE_URL": with_hostport(db_url, "127.0.0.1", pg_relay.port),
                 "WIREMOCK_URL": with_hostport(carrier_url, "127.0.0.1", wm_relay.port)}
    try:
        with spawn_copy(overrides) as base:
            err(get(base, "/api/models"), 503, "database_unavailable", OWN["database_unavailable"][0])
            pg_relay.start()
            assert get(base, "/api/models").status_code == 200, "first request after Postgres returns succeeds"
            name, email = owner()
            with browse(browser, base + "/claim/new") as page:
                ui_fill_claim(page, name=name, email=email)
                region = page.get_by_role("region", name="Carriage estimate", exact=True)
                button = region.get_by_role("button", name="Estimate carriage", exact=True)
                click(button)
                ui_until(page, lambda: has(region, OWN["carrier_unavailable"][0]) or has(alert(page), OWN["carrier_unavailable"][0]),
                         "carrier unreachable copy")
                wm_relay.start()
                click(button)
                ui_until(page, lambda: has(region, f"Band {DEFAULT_BAND} · {money(DEFAULT_CHARGE)}"),
                         "first estimate after the carrier returns succeeds")
    finally:
        pg_relay.stop()
        wm_relay.stop()


def test_wf_service_outages_announced_retry(browser: Any, app_url: str, mail: Any) -> None:
    name, email = owner()
    with browse(browser, app_url + "/claim/new") as page:
        ui_fill_claim(page, name=name, email=email)
        assert alert(page).count() == 1 and page.get_by_role("status").count() == 1, "one alert and one status region"
        page.route("**/api/carriage-estimate*", proxy_to(copy_url("carrier-down")))
        region = page.get_by_role("region", name="Carriage estimate", exact=True)
        click(region.get_by_role("button", name="Estimate carriage", exact=True))
        ui_until(page, lambda: has(alert(page), OWN["carrier_unavailable"][0]), "carrier refusal announced")
        page.unroute("**/api/carriage-estimate*")
        click(region.get_by_role("button", name="Estimate carriage", exact=True))
        ui_until(page, lambda: has(region, f"Band {DEFAULT_BAND}") and loc_text(alert(page)).strip() == "", "alert emptied")
        page.route("**/api/claims", proxy_to(copy_url("minio-down")))
        with held(page, "**/api/claims") as gate:
            click(page.get_by_role("button", name="Start claim", exact=True))
            ui_until(page, lambda: has(status(page), "Sending your claim…"), "pending copy in the status region")
            gate.release()
        ui_until(page, lambda: has(alert(page), OWN["storage_unavailable"][0]), "storage refusal announced")
        page.unroute("**/api/claims")
    op = Operator(app_url)
    c = claim_at(app_url, mail, "identified", op)
    ref = c["reference"]
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref, "/quote")
        page.route("**/api/ops/claims/*/quote", proxy_to(copy_url("killbill-down")))
        click(sbtn(page, "Get quote"))
        ui_until(page, lambda: has(alert(page), OPS["billing_unavailable"]), "billing refusal announced")
        page.unroute("**/api/ops/claims/*/quote")
        click(sbtn(page, "Get quote"))
        wait_path(page, rf"^/ops/claims/{ref}/quote/1$")
        ui_until(page, lambda: loc_text(alert(page)).strip() == "" and has(status(page), "Quote revision 1 recorded in billing."),
                 "retry success empties the alert")
        page.route("**/api/ops/claims/*/payment", proxy_to(copy_url("killbill-down")))
        click(sbtn(page, "Record payment"))
        ui_until(page, lambda: has(alert(page), OPS["billing_unavailable"]), "payment refusal")
        page.unroute("**/api/ops/claims/*/payment")
        click(sbtn(page, "Record payment"))
        ui_until(page, lambda: loc_text(alert(page)).strip() == "" and has(status(page), "Payment of"), "payment retry")


def test_wf_service_outages_mail_queue(app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    assert op.on(copy_url("killbill-down")).call("GET", "/api/ops/stats").status_code == 200, "session works on every copy"
    c = claim_at(app_url, mail, "confirmed", op)
    wrong = {"reference": c["reference"], "email": "x" + c["email"]}
    for _ in range(3):
        post(app_url, "/api/claims/lookup", wrong)
    for _ in range(2):
        post(copy_url("carrier-down"), "/api/claims/lookup", wrong)
    for base in (app_url, copy_url("carrier-down")):
        err(post(base, "/api/claims/lookup", {"reference": c["reference"], "email": c["email"]}), 423, "reference_locked")
    q = claim_at(app_url, mail, "identified", op)
    key = idempotency_key()
    first = ok(op.quote(q["reference"], key))
    assert ok(op.on(copy_url("carrier-down")).quote(q["reference"], key)) == first, "replay answered on another copy"
    assert len([i for i in kb_state(killbill, q["reference"])["invoices"] if i.get("items")]) == 1
    d = claim_at(app_url, mail, "confirmed", op)
    ok(op.on(copy_url("mailpit-down")).new_link(d["reference"]), 201)
    inbox(mail, d["email"], f"New link for claim {d['reference']}", seconds=QUEUE_SEND_S + QUEUE_CHECK_S)
    holds_for(lambda: len(mine(mail, d["email"], f"New link for claim {d['reference']}")) == 1, QUEUE_CHECK_S * 2,
              "the waiting notice is sent exactly once")
    poll(lambda: op.view(d["reference"])["notices_pending"] == 0, "queue drained", QUEUE_SEND_S)


def test_billing_outage_changes_nothing(app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    down = op.on(copy_url("killbill-down"))
    c = claim_at(app_url, mail, "confirmed", op)
    ok(down.identify(c["reference"]), 200, "identify never calls Kill Bill")
    err(down.quote(c["reference"]), 503, "billing_unavailable", OPS["billing_unavailable"])
    assert kb_state(killbill, c["reference"])["account"] is None
    q = claim_at(app_url, mail, "quoted", op, booklet=4)
    quote_notice(mail, q)
    before = (kb_state(killbill, q["reference"]), op.view(q["reference"]), len(mine(mail, q["email"])))
    err(down.pay(q["reference"]), 503, "billing_unavailable", OPS["billing_unavailable"])
    err(down.decline(q["reference"]), 503, "billing_unavailable", OPS["billing_unavailable"])
    after = (kb_state(killbill, q["reference"]), op.view(q["reference"]), len(mine(mail, q["email"])))
    assert after[0]["payments"] == before[0]["payments"] and after[0]["invoices"] == before[0]["invoices"]
    assert after[1]["state"] == "quoted" and after[1]["part"]["bin_count"] == before[1]["part"]["bin_count"]
    assert after[2] == before[2]
    m = claim_at(app_url, mail, "quoted", op)
    assert ok(op.on(copy_url("mailpit-down")).decline(m["reference"]))["state"] == "declined"


def test_records_outage(browser: Any, app_url: str, mail: Any) -> None:
    pg = copy_url("postgres-down")
    assert ok(get(pg, "/api/health")) == {"status": "ok"}
    for path in ("/", "/claim/new", "/find", "/ops/sign-in"):
        r = get(pg, path)
        assert r.status_code == 200 and "text/html" in r.headers.get("content-type", ""), path
    assert httpx.post(pg + "/api/claims/lookup", content=b"x", headers={"Content-Type": "text/plain"},
                      timeout=HTTP_TIMEOUT).status_code == 415
    pad = JSON_CAP + 1 - len(json.dumps({"reference": "", "email": "a@b.c"}).encode())
    big = json.dumps({"reference": "R" * pad, "email": "a@b.c"}).encode()
    assert len(big) == JSON_CAP + 1
    assert httpx.post(pg + "/api/claims/lookup", content=big, headers={"Content-Type": "application/json"},
                      timeout=HTTP_TIMEOUT).status_code == 413
    err(post(pg, "/api/claims/lookup", {"reference": random_ref(), "email": "a@b.c"}, {"Origin": EVIL_ORIGIN}), 403, "cross_origin")
    err(get(pg, "/api/ops/stats"), 401, "unauthenticated")
    signed_in = Operator(app_url).cookie
    err(get(pg, "/api/ops/stats", headers={"Cookie": signed_in}), 503, "database_unavailable", OPS["database_unavailable"])
    err(post(pg, "/api/claims/lookup", {"reference": random_ref(), "email": "a@b.c"}), 503, "database_unavailable",
        OWN["database_unavailable"][0])
    _, email = owner()
    marker = uuid.uuid4().hex.encode()
    s3 = copy_s3("postgres-down")
    before = set(s3.keys("claims/"))
    err(start_claim(pg, email, photos=[("m.jpg", photo_bytes("jpeg", marker), "image/jpeg")]), 503, "database_unavailable")
    assert not new_objects_with(s3, before, marker) and not mine(mail, email)
    with browse(browser, pg + "/claim/new") as page:
        ui_until(page, lambda: page.get_by_role("heading", name="Claim a part").count() >= 1, "claim form page served")


def test_run_manifest_and_health(app_url: str) -> None:
    r = get(app_url, "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    manifest = json.loads((APP / "run.json").read_text())
    assert all(isinstance(manifest.get(k), str) and manifest[k] for k in ("install", "build", "serve"))


def test_wf_cross_cutting_roles(browser: Any, app_url: str, mail: Any, killbill: Any) -> None:
    op = Operator(app_url)
    c = claim_at(app_url, mail, "paid", op)
    ref = c["reference"]
    err(post(app_url, "/api/ops/session", {"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD}, {"Origin": EVIL_ORIGIN}),
        403, "cross_origin")
    err(op.call("POST", f"/api/ops/claims/{ref}/close", {}, headers={"Origin": EVIL_ORIGIN}), 403, "cross_origin")
    err(httpx.post(f"{app_url}/api/share/{c['share_token']}", json={}, headers={"Cookie": op.cookie}, timeout=HTTP_TIMEOUT),
        405, "read_only")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/.git/config", "/tsconfig.json"):
        assert get(app_url, path).status_code == 404, f"{path} must not be served"
    st = kb_state(killbill, ref)
    ids = [st["account"]["accountId"]] + [i["invoiceId"] for i in st["invoices"]] + [p["paymentId"] for p in st["payments"]]
    surfaces = [op.call("GET", f"/api/ops/claims/{ref}").text, share(app_url, c["share_token"]).text]
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, ref, "/quote/1")
        surfaces.append(page.content())
        page.goto(app_url + c["share_url"])
        ui_until(page, lambda: slip(page).count() == 1, "share page")
        surfaces.append(page.content())
    for s in surfaces:
        for secret in ids:
            assert secret not in s, f"{secret!r} reached the browser"
        assert not re.search(rf"(?<!ops/)(?<!api/)claims/{re.escape(ref)}/", s), "a storage key reached the browser"
    with browse(browser, app_url + "/ops/editions") as page:
        wait_path(page, r"^/ops/sign-in$")


def test_wf_cross_cutting_state_machine(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    started = claim_at(app_url, mail, "started", op)
    conf = claim_at(app_url, mail, "confirmed", op)
    for name in ("quote", "payment", "decline", "dispatch"):
        e = err(op.action(conf["reference"], name, {"reason": "owner_declined"} if name == "decline" else None), 409,
                "wrong_state", WRONG_STATE.format(state="Confirmed"), name)
        assert e["state"] == "confirmed"
    assert err(op.close(conf["reference"]), 409, "wrong_state")["state"] == "confirmed"
    assert err(op.identify(started["reference"]), 409, "wrong_state")["state"] == "started"
    assert err(op.withdraw(started["reference"]), 409, "wrong_state")["state"] == "started"
    racer = claim_at(app_url, mail, "confirmed", op)
    with ThreadPoolExecutor(4) as pool:
        rs = list(pool.map(lambda _: op.identify(racer["reference"]), range(4)))
    codes = sorted(r.status_code for r in rs)
    assert codes == [200, 409, 409, 409], f"exactly one identify wins: {codes}"
    assert all(r.json()["error"]["code"] == "wrong_state" for r in rs if r.status_code == 409)
    with browse(browser, app_url + "/ops/sign-in") as page:
        ui_sign_in(page, app_url)
        ui_workspace(page, app_url, conf["reference"])
        for name in ("Get quote", "Record payment", "Decline", "Dispatch", "Close claim"):
            assert sbtn(page, name).is_disabled(), f"{name} disabled on a confirmed claim"
        assert sbtn(page, "Identify part").is_enabled()
        q = claim_at(app_url, mail, "quoted", op)
        ui_workspace(page, app_url, q["reference"], "/quote/1")
        assert sbtn(page, "Dispatch").is_disabled() and sbtn(page, "Close claim").is_disabled()
        assert sbtn(page, "Record payment").is_enabled() and sbtn(page, "Re-quote").is_enabled()


def test_wf_cross_cutting_addresses(browser: Any, app_url: str, mail: Any) -> None:
    op = Operator(app_url)
    d = claim_at(app_url, mail, "dispatched", op)
    x = claim_at(app_url, mail, "quoted", op)
    ok(op.decline(x["reference"]))
    for path, state in ((f"/ops/claims/{d['reference']}/dispatched", "Dispatched"),
                        (f"/ops/claims/{d['reference']}/quote/1", "Dispatched"),
                        (f"/ops/claims/{x['reference']}/declined", "Declined")):
        with browse(browser, app_url + "/ops/sign-in") as page:
            ui_sign_in(page, app_url)
            page.goto(app_url + path)
            ui_until(page, lambda state=state: has(slip(page), state), f"{path} shows {state}")
            assert path_of(page) == path
    s = new_claim(app_url, mail)
    with browse(browser, f"{app_url}/claim/{s['reference']}/sent") as page:
        ui_until(page, lambda: page.get_by_role("heading", name="Check your email").count() == 1, "sent page deep link")
    with browse(browser, app_url + d["share_url"]) as page:
        ui_until(page, lambda: has(slip(page), "Dispatched"), "share deep link")


def test_wf_cross_cutting_languages(browser: Any, app_url: str) -> None:
    with browse(browser, app_url + "/") as page:
        ui_until(page, lambda: page.get_by_role("link", name="Start a claim").count() == 1, "home")
        group = page.get_by_role("radiogroup", name="Language · Język", exact=True)
        before, y0 = box(group), page.evaluate("() => window.scrollY")
        ui_switch(page, "pl")
        after = box(group)
        assert near(before["x"], after["x"]) and near(before["y"], after["y"]) and \
            abs(page.evaluate("() => window.scrollY") - y0) <= TOL
        assert page.get_by_role("link", name="Zgłoś część").count() == 1
        assert page.get_by_role("link", name="Znajdź moje zgłoszenie").count() == 1
        page.reload()
        ui_until(page, lambda: page.evaluate("() => document.documentElement.lang") == "pl-PL", "cookie remembers")
        page.goto(app_url + "/claim/new")
        ui_until(page, lambda: page.get_by_role("heading", name="Zgłoś część").count() == 1, "Polish form heading")
        name, email = owner()
        ui_fill_claim(page, name=name, email=email, postcode="nonsense", purchase="2999-01-01", lang="pl")
        click(page.get_by_role("button", name="Wyślij zgłoszenie", exact=True))
        for s in ("Podaj brytyjski kod pocztowy.", "Podaj datę zakupu, nie późniejszą niż dziś."):
            ui_until(page, lambda s=s: s in page_text(page), f"Polish field error {s!r}")
        fill(page.get_by_role("textbox", name="Kod pocztowy", exact=True), POSTCODE)
        region = page.get_by_role("region", name="Szacunkowy koszt przesyłki", exact=True)
        click(region.get_by_role("button", name="Oszacuj przesyłkę", exact=True))
        ui_until(page, lambda: has(region, f"Strefa {DEFAULT_BAND} · {money(DEFAULT_CHARGE, 'pl')}"), "Polish estimate")
        ui_switch(page, "en")
        fill(page.get_by_role("textbox", name="Postcode", exact=True), "nonsense")
        click(page.get_by_role("button", name="Start claim", exact=True))
        for s in ("Enter a UK postcode.", "Enter the date you bought it, not in the future."):
            ui_until(page, lambda s=s: s in page_text(page), f"English field error {s!r}")


def test_settings_not_in_browser(app_url: str, mail: Any) -> None:
    names = ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")
    secrets_ = [os.environ[n] for n in names if len(os.environ.get(n, "")) >= 6]
    db_pass = urlparse(os.environ.get("DATABASE_URL", "")).password
    if db_pass and len(db_pass) >= 6:
        secrets_.append(db_pass)
    secrets_.append(OPERATOR_PASSWORD)
    pages = [get(app_url, p).text for p in ("/", "/claim/new", "/find", "/ops/sign-in")]
    assets = []
    for html_ in pages:
        for src in set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css|mjs))"', html_)):
            assets.append(get(app_url, src).text)
    op = Operator(app_url)
    c = claim_at(app_url, mail, "quoted", op)
    apis = [get(app_url, "/api/models").text, op.call("GET", f"/api/ops/claims/{c['reference']}").text,
            share(app_url, c["share_token"]).text] + [text(m) for m in mine(mail, c["email"])]
    for s in secrets_:
        scopes = apis if s.isalpha() else pages + assets + apis
        assert not any(s in body for body in scopes), "an environment credential reached the browser or an email"


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(manifest.get(k), str) and manifest[k].strip(), f"run.json {k} must be a command string"


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"
    for name in ("Space Grotesk", "IBM Plex Sans", "IBM Plex Mono", "Lucide"):
        assert name in notices, f"{name} must be listed with its licence"


def test_if_licences() -> None:
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, f"packages outside the licence allowlist: {bad[:20]}"


def test_if_no_extra_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "@seald-io/nedb", "level",
              "lmdb", "keyv", "node-persist", "mongodb", "mysql", "mysql2"}
    found = sorted(p.name for p in shipped_packages() if p.name in banned)
    assert not found, f"extra datastore packages shipped: {found}"
    files = [p for p in Path(DEPLOYED_APP).rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db")
             and "node_modules" not in p.parts]
    assert not files, f"database files in the app: {files[:5]}"


def test_if_service_config_untouched() -> None:
    if not TRAJECTORY.exists():
        return
    data = json.loads(TRAJECTORY.read_text())
    hits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            path = str(node.get("file_path") or node.get("path") or "")
            if re.search(r"(^|/)(docker-)?compose[^/]*\.ya?ml$", path) and any(
                    k in node for k in ("content", "new_string", "old_string", "edits")):
                hits.append(path)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    assert not hits, f"the trajectory edited provided service configuration: {sorted(set(hits))}"


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", ".git", "coverage", "public", ".next", "out", ".output", ".vite",
            ".turbo", ".cache", "scripts", "tools", "config"}
    js = [p for p in APP.rglob("*") if p.suffix in (".js", ".jsx", ".mjs", ".cjs")
          and len(p.relative_to(APP).parts) > 1
          and not (skip & set(p.relative_to(APP).parts[:-1]))
          and ".config." not in p.name and not p.name.startswith(".")]
    assert not js, f"JavaScript source files found: {[str(p) for p in js[:10]]}"
