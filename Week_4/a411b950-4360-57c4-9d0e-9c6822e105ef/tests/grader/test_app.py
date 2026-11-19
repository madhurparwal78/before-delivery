from __future__ import annotations

import concurrent.futures
import contextlib
import csv
import io
import json
import math
import os
import random
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from html import unescape
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from PIL import Image
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    shipped_packages as kit_shipped_packages,
    DEPLOYED_APP,
    KillBill,
    Mailpit,
    S3,
    addresses,
    advance,
    camera,
    check,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    select,
    settle,
    text,
    unique,
)

SCROLL_RANGE = 1600
INTENSITY_STEP = 16
SEARCH_DEBOUNCE_MS = 250
Q_MAX = 100
SPLIT_FEE = 499_999
SPLIT_EXAMPLE = [149_999, 99_999, 99_999, 150_002]
MILESTONE_NAMES = ["Deposit", "Vertical slice", "Content complete", "Final delivery"]
MILESTONE_PERCENTS = [30, 20, 20, 30]
OPERATOR_EMAIL = "operator@kettlehole.example"
OPERATOR_PASSWORD = "ladder-console-2026"
SEED_ZONE = "America/Toronto"
SEED_LINK_TOKEN = "glasshouse-seed-preview"
POSITION_MAX = 999
SLUG_MAX = 48
TEXT_MAX = 120
CREDIT_LINE_MAX = 200
BLURB_MAX = 1000
TAG_MAX = 30
TAGS_MAX = 10
STEM_LIMIT = 20_000_000
RATE_MIN = 22_050
RATE_MAX = 96_000
STEM_MAX_SECONDS = 180
FILENAME_MAX = 200
LINK_MAX_SECONDS = 31_536_000
LINK_DEFAULT_SECONDS = 3600
LABEL_MAX = 80
EXPIRY_MS = 2000
REVOKE_MS = 6000
BRIEF_MIN = 20
BRIEF_MAX = 4000
REFERENCE_LIMIT = 10_000_000
SENDER_LIMIT = 3
PACING_WINDOW = 600
STRICT_IP_LIMIT = 5
KEY_MAX = 100
RETRY_MS = 3000
RETRY_ATTEMPTS = 5
NOTES_MAX = 4000
CSV_HEADER = "reference,received_at,status,name,email,studio,brief,preferred_month,project_slug,fit_score,receipt"
FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")
PAGE_SIZE = 25
LIMIT_MAX = 100
LIVE_MS = 3000
FEE_MIN = 100
FEE_MAX = 100_000_000
SMALL_DEPOSIT = 435
LARGE_DEPOSIT = 30_000_000
SMALL_DEPOSIT_FEE = 1_450
CAPACITY_MAX = 12
PREVIEW_MS = 500
OPTIMISTIC_MS = 100
HOLD_SECONDS = 45
MAIN_RETRY_SECONDS = 10
SECOND_MS = 1000
LIST_RELOAD_MS = 15_000
GATE_MAX_MS = 500
CAMERA_MAX_MS = 1000
CAMERA_MIN_MS = 600
CROSSFADE_MAX_MS = 500
TAP_MIN = 44
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
JSON_LIMIT = 65_536
ENQUIRY_BODY_LIMIT = 10_500_000
STEM_BODY_LIMIT = 20_500_000
KIND_ORDER = ("receipt", "alert", "proposal", "month_held", "deposit")
LAYERS = ("bed", "pulse", "lead", "stinger")
LAYER_WORD = {"bed": "Bed", "pulse": "Pulse", "lead": "Lead", "stinger": "Stinger"}
RUNGS = {"bed": "Bed layer", "pulse": "Pulse layer", "lead": "Lead layer", "stinger": "Stinger layer"}
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
               "October", "November", "December"]
BRIEF_TEXT = "Looking for an adaptive combat score for a roguelite with four intensity tiers."
FONTS = ("Bricolage Grotesque", "Inter", "JetBrains Mono")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}

SHORT_LINK_SECONDS = 5
LINK_LEAD_SECONDS = 15
FRESH_MONTH_MIN = 24
FRESH_MONTH_MAX = 600
FRESH_MONTH_TRIES = 1000
PAGES_MAX = 10000
LINK_EDGE_WAIT_SECONDS = 60
REAL_GRACE_MS = 1000
FRAME_MS = 50
STEP_MS = 500
TAB_WINDOW_EXTRA = 150
HTTP_TIMEOUT = 60
POLL_SECONDS = 0.5
EDGE_SLACK = 0.05
EXPIRY_WAIT = 60
MAIL_WAIT = 30
OUTAGE_MAIL_WAIT = 150
START_WAIT = 120
MAX_PAGES = 40
SETTLE_SECONDS = 5
FRAME_STEP_MS = 16
PAGE_SLACK_MS = 100
INSTANT_MS = 1
RAW_CHUNK = 65_536
ICON_MAX_PX = 512

RING_JS = """
(e) => {
  const out = {};
  for (const pseudo of [null, '::before', '::after']) {
    const s = getComputedStyle(e, pseudo);
    for (const p of ['outline-style', 'outline-width', 'outline-color', 'box-shadow', 'border-top-style',
                     'border-top-width', 'border-top-color']) out[(pseudo || '') + p] = s.getPropertyValue(p);
  }
  return out;
}
"""

HEADING_FOCUSED_JS = ("() => { const el = document.activeElement; return !!el && "
                      "(/^H[1-6]$/.test(el.tagName) || el.getAttribute('role') === 'heading'); }")

AUDIO_PROBE_JS = """
(() => {
  if (window.__earshotAudio) return;
  const list = [];
  window.__earshotAudio = list;
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) return;
  const Probe = class extends Orig { constructor(...args) { super(...args); list.push(this); } };
  window.AudioContext = Probe;
  if (window.webkitAudioContext) window.webkitAudioContext = Probe;
})();
"""

ANIMATIONS_JS = """
(root) => document.getAnimations().filter(a => {
  if (!root) return true;
  const t = a.effect && a.effect.target;
  return !!t && (t === root || root.contains(t));
}).map(a => {
  const t = a.effect.getComputedTiming();
  const infinite = t.iterations === Infinity || t.endTime === Infinity;
  return {infinite, end: infinite ? -1 : t.endTime};
})
"""

TEXT_BYTES = b"just some plain text renamed to look like audio\n" * 20
SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML_BYTES = b"<!doctype html><html><body><script>alert(1)</script></body></html>"
ZIP_BYTES = b"PK\x03\x04" + bytes(200)
MP3_BYTES = b"ID3\x04\x00\x00\x00\x00\x00\x0a" + bytes(10) + b"\xff\xfb\x90\x00" + bytes(400)


def tag() -> str:
    return uuid.uuid4().hex[:10]


def person(prefix: str) -> tuple[str, str]:
    return unique(prefix)


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def high() -> str:
    return env_url("APP_HIGH_LIMITS_URL")


def storage() -> S3:
    return S3()


def describe(response: httpx.Response) -> str:
    return f"{response.status_code} {response.text[:500]}"


def eventually(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() <= deadline:
        if value := fn():
            return value
        threading.Event().wait(POLL_SECONDS)
    if value := fn():
        return value
    raise AssertionError(f"timed out after {seconds}s waiting for {what}")


def stays(fn: Callable[[], None], seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        fn()
        threading.Event().wait(POLL_SECONDS * 2)
    fn()


def live(page: Page, check_fn: Callable[[], None], within_ms: float, step_ms: float = STEP_MS) -> None:
    elapsed = 0.0
    while elapsed < within_ms:
        try:
            check_fn()
            return
        except AssertionError:
            pass
        advance(page, step_ms)
        elapsed += step_ms
    check_fn()


def wait_for(page: Page, check: Callable[[], Any], seconds: float = SETTLE_SECONDS) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() <= deadline:
        try:
            if check() is not False:
                return
        except AssertionError:
            pass
        advance(page, FRAME_STEP_MS)
    if check() is False:
        raise AssertionError("page state not reached")


def focused(locator: Locator) -> bool:
    return locator.count() == 1 and bool(locator.evaluate("e => e === document.activeElement"))


def wait_focus(page: Page, locator: Locator) -> None:
    wait_for(page, lambda: focused(locator))


def tab_to(page: Page, locator: Locator, presses: int, key: str = "Tab") -> None:
    for _ in range(presses):
        page.keyboard.press(key)
        if focused(locator):
            return
    raise AssertionError(f"not reached by {key}")


def joined(*sentences: str) -> re.Pattern:
    return re.compile(r"\s*".join(map(re.escape, sentences)))


def assert_error(response: httpx.Response, status: int, code: str | None = None) -> dict:
    assert response.status_code == status, describe(response)
    body = response.json()
    if code is not None:
        assert body["error"] == code, body
    return body


def assert_invalid(response: httpx.Response, field: str) -> dict:
    body = assert_error(response, 422, "validation")
    assert field in body["errors"], body
    return body


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def written(moment: datetime, zone_name: str) -> str:
    local = moment.astimezone(ZoneInfo(zone_name))
    return f"{local.day} {MONTH_NAMES[local.month - 1]} {local.year}, {local.hour:02d}:{local.minute:02d}"


def written_day(day: date) -> str:
    return f"{day.day} {MONTH_NAMES[day.month - 1]} {day.year}"


def month_label(month: str) -> str:
    year, number = month.split("-")
    return f"{MONTH_NAMES[int(number) - 1]} {year}"


def money(amount: int) -> str:
    return f"${amount // 100:,}.{amount % 100:02d}"


def dollars(amount: int) -> str:
    return f"{amount // 100}.{amount % 100:02d}"


def cents(value: Any) -> int:
    exact = Decimal(str(value)) * 100
    assert exact == exact.to_integral_value(), value
    return int(exact)


def split(fee: int) -> list[int]:
    first = [fee * p // 100 for p in MILESTONE_PERCENTS[:3]]
    return first + [fee - sum(first)]


def ref_number(reference: str) -> int:
    return int(reference.split("-")[1])


def intensity(offset: int) -> int:
    return math.floor(offset / INTENSITY_STEP + 0.5)


def active(t: dict, value: int) -> str:
    return ",".join(l for l in LAYERS if value >= t[l])


def came_in(layer: str, n: int) -> str:
    return f"{LAYER_WORD[layer]} in at intensity {n}."


def went_out(layer: str, n: int) -> str:
    return f"{LAYER_WORD[layer]} out at intensity {n}."


def milestone_description(n: int, reference: str) -> str:
    return f"Milestone {n} of 4: {MILESTONE_NAMES[n - 1]} ({reference})"


def wav(seconds: float, rate: int = RATE_MIN, channels: int = 1, bits: int = 16, tag_value: int = 1,
        sub: int | None = None) -> bytes:
    block = channels * bits // 8
    data = bytes(round(seconds * rate) * block)
    fmt = struct.pack("<HHIIHH", tag_value, channels, rate, rate * block, block, bits)
    if tag_value == 0xFFFE:
        guid = struct.pack("<IHH", sub or 1, 0, 0x10) + bytes.fromhex("800000aa00389b71")
        fmt += struct.pack("<HHI", 22, bits, 0) + guid
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def sized_wav(total: int) -> bytes:
    block = 6
    fmt = struct.pack("<HHIIHH", 1, 2, RATE_MAX, RATE_MAX * block, block, 24)
    data_len = total - 44
    return (b"RIFF" + struct.pack("<I", total - 8) + b"WAVE" + b"fmt " + struct.pack("<I", 16) + fmt + b"data"
            + struct.pack("<I", data_len) + bytes(data_len))


def pdf(size: int | None = None) -> bytes:
    head = b"%PDF-1.4\n%verifier\n"
    if size is None:
        return head + b"%%EOF\n"
    return head + b"0" * (size - len(head))


def multipart(fields: list[tuple[str, str]], files: list[tuple[str, str, bytes, str]]) -> tuple[bytes, str]:
    boundary = f"earshot{uuid.uuid4().hex}"
    out = bytearray()
    for name, value in fields:
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        out += value.encode("utf-8") + b"\r\n"
    for name, filename, data, ctype in files:
        quoted = filename.replace("\\", "\\\\").replace('"', '\\"')
        out += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{quoted}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n").encode("utf-8")
        out += data + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def send_brief(base: str, *, name: str | None = None, email: str | None = None, studio: str | None = None,
               brief: str | None = None, extra: dict[str, str] | None = None,
               attachment: tuple[str, bytes, str] | None = None, key: str | None = None) -> httpx.Response:
    default_name, default_email = person("director")
    fields = [("name", default_name if name is None else name),
              ("email", default_email if email is None else email),
              ("studio", f"Studio {tag()}" if studio is None else studio),
              ("brief", BRIEF_TEXT if brief is None else brief)]
    fields += list((extra or {}).items())
    files = [("attachment", *attachment)] if attachment else []
    body, ctype = multipart(fields, files)
    headers = {"Content-Type": ctype}
    if key is not None:
        headers["Idempotency-Key"] = key
    return httpx.post(f"{base}/api/enquiries", content=body, headers=headers, timeout=HTTP_TIMEOUT)


def journey_stations(base: str) -> list[dict]:
    response = httpx.get(f"{base}/api/journey", timeout=HTTP_TIMEOUT)
    assert response.status_code == 200, describe(response)
    return response.json()["stations"]


def journey_station(base: str, slug: str) -> dict | None:
    return next((s for s in journey_stations(base) if s["slug"] == slug), None)


def search(base: str, q: str) -> list[dict]:
    response = httpx.get(f"{base}/api/search", params={"q": q}, timeout=HTTP_TIMEOUT)
    assert response.status_code == 200, describe(response)
    return response.json()["results"]


def listen(base: str, token: str) -> httpx.Response:
    return httpx.get(f"{base}/api/listen/{token}", timeout=HTTP_TIMEOUT)


def public_months(base: str) -> list[str]:
    return [m["month"] for m in httpx.get(f"{base}/api/months", timeout=HTTP_TIMEOUT).json()["months"]]


def proposal(base: str, token: str) -> httpx.Response:
    return httpx.get(f"{base}/api/proposals/{token}", timeout=HTTP_TIMEOUT)


def accept(base: str, token: str) -> httpx.Response:
    return httpx.post(f"{base}/api/proposals/{token}/accept", json={}, timeout=HTTP_TIMEOUT)


def pay(base: str, token: str, key: str | None, amount: int, payer: str = "Rowan Producer") -> httpx.Response:
    headers = {} if key is None else {"Idempotency-Key": key}
    return httpx.post(f"{base}/api/proposals/{token}/deposit", json={"payer_name": payer, "amount_cents": amount},
                      headers=headers, timeout=HTTP_TIMEOUT)


def operator(base: str) -> httpx.Client:
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    response = client.post("/api/console/session", json={"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD})
    assert response.status_code == 200, describe(response)
    return client


def base_of(c: httpx.Client) -> str:
    return str(c.base_url).rstrip("/")


def server_clock(c: httpx.Client) -> tuple[datetime, float, float]:
    sent = time.time()
    body = c.get("/api/console/mail-queue").json()
    got = time.time()
    server = parse_iso(body["server_time"])
    return server, server.timestamp() - (sent + got) / 2, (got - sent) / 2


def zone(c: httpx.Client) -> str:
    return c.get("/api/console/settings").json()["time_zone"]


def set_zone(c: httpx.Client, name: str) -> None:
    response = c.put("/api/console/settings", json={"time_zone": name})
    assert response.status_code == 200, describe(response)


def new_project(c: httpx.Client, **overrides: Any) -> dict:
    t = tag()
    body = {"slug": f"p-{t}", "title": f"Probe {t}", "credit_type": "jam", "credit_line": f"Jam build {t}",
            "role": "Solo audio", "blurb": f"Layers built for a probe {t}."}
    body.update(overrides)
    response = c.post("/api/console/projects", json=body)
    assert response.status_code == 201, describe(response)
    return response.json()["project"]


def upload(c: httpx.Client, pid: str, layer: str, data: bytes, filename: str = "stem.wav") -> httpx.Response:
    body, ctype = multipart([("layer", layer)], [("file", filename, data, "audio/wav")])
    return c.post(f"/api/console/projects/{pid}/stems", content=body, headers={"Content-Type": ctype})


def fill_stems(c: httpx.Client, pid: str) -> dict[str, bytes]:
    stems = {layer: wav(1.0 + i * 0.25) for i, layer in enumerate(LAYERS)}
    for layer, data in stems.items():
        response = upload(c, pid, layer, data)
        assert response.status_code == 201, describe(response)
    return stems


def move_project(c: httpx.Client, pid: str, to: str) -> httpx.Response:
    return c.post(f"/api/console/projects/{pid}/transition", json={"to": to})


def project(c: httpx.Client, pid: str) -> dict:
    return c.get(f"/api/console/projects/{pid}").json()["project"]


def published_project(c: httpx.Client, **overrides: Any) -> tuple[dict, dict[str, bytes]]:
    created = new_project(c, **overrides)
    stems = fill_stems(c, created["id"])
    assert move_project(c, created["id"], "in_review").status_code == 200
    response = move_project(c, created["id"], "published")
    assert response.status_code == 200, describe(response)
    return response.json()["project"], stems


def withdraw(c: httpx.Client, pid: str) -> None:
    move_project(c, pid, "withdrawn")


def make_link(c: httpx.Client, pid: str, seconds: float = LINK_DEFAULT_SECONDS, label: str | None = None) -> dict:
    server, _, _ = server_clock(c)
    response = c.post(f"/api/console/projects/{pid}/links",
                      json={"label": label or tag(), "expires_at": iso(server + timedelta(seconds=seconds))})
    assert response.status_code == 201, describe(response)
    return response.json()["link"]


def fresh_month(c: httpx.Client, capacity: int) -> str:
    taken = {r["month"] for r in c.get("/api/console/months").json()["months"]}
    now = datetime.now(ZoneInfo(zone(c)))
    for _ in range(FRESH_MONTH_TRIES):
        index = now.year * 12 + now.month - 1 + random.randint(FRESH_MONTH_MIN, FRESH_MONTH_MAX)
        month = f"{index // 12}-{index % 12 + 1:02d}"
        if month not in taken:
            break
    else:
        pytest.fail(f"no free production month {FRESH_MONTH_MIN}-{FRESH_MONTH_MAX} months ahead after {FRESH_MONTH_TRIES} draws")
    response = c.put(f"/api/console/months/{month}", json={"capacity": capacity})
    assert response.status_code == 200, describe(response)
    return month


def month_row(c: httpx.Client, month: str) -> dict:
    return next(r for r in c.get("/api/console/months").json()["months"] if r["month"] == month)


def page_of_enquiries(c: httpx.Client, status: str | None = None, limit: int | None = None,
                      cursor: str | None = None) -> dict:
    params = {k: v for k, v in (("status", status), ("limit", limit), ("cursor", cursor)) if v is not None}
    response = c.get("/api/console/enquiries", params=params)
    assert response.status_code == 200, describe(response)
    return response.json()


def enquiry_pages(c: httpx.Client, status: str | None = None) -> Iterator[list[dict]]:
    cursor = None
    for _ in range(PAGES_MAX):
        body = page_of_enquiries(c, status=status, limit=LIMIT_MAX, cursor=cursor)
        yield body["enquiries"]
        cursor = body["next_cursor"]
        if not cursor:
            return
    pytest.fail(f"the Enquiries list still had a next_cursor after {PAGES_MAX} pages of {LIMIT_MAX}: paging never ends")


def find_enquiry(c: httpx.Client, reference: str, status: str | None = None) -> dict | None:
    target = ref_number(reference)
    for rows in enquiry_pages(c, status):
        for row in rows:
            if row["reference"] == reference:
                return row
        if rows and ref_number(rows[-1]["reference"]) < target:
            return None
    return None


def newest_number(c: httpx.Client) -> int:
    rows = page_of_enquiries(c, limit=1)["enquiries"]
    return ref_number(rows[0]["reference"]) if rows else 0


def enquiries_since(c: httpx.Client, marker: int) -> list[dict]:
    out: list[dict] = []
    for rows in enquiry_pages(c):
        out += [r for r in rows if ref_number(r["reference"]) > marker]
        if rows and ref_number(rows[-1]["reference"]) <= marker:
            break
    return out


def intake(c: httpx.Client) -> dict:
    response = send_brief(high())
    assert response.status_code == 201, describe(response)
    found = find_enquiry(c, response.json()["reference"])
    assert found
    return found


def current(c: httpx.Client, eid: str) -> tuple[dict, str]:
    response = c.get(f"/api/console/enquiries/{eid}")
    assert response.status_code == 200, describe(response)
    return response.json()["enquiry"], response.headers["etag"]


def act(c: httpx.Client, eid: str, suffix: str, body: Any, method: str = "POST") -> httpx.Response:
    _, etag = current(c, eid)
    return c.request(method, f"/api/console/enquiries/{eid}{suffix}", json=body, headers={"If-Match": etag})


def invoice(c: httpx.Client, eid: str, n: int, etag: str | None = None) -> httpx.Response:
    if etag is None:
        _, etag = current(c, eid)
    return c.post(f"/api/console/enquiries/{eid}/milestones/{n}/invoice", json={}, headers={"If-Match": etag})


def deal(c: httpx.Client, month: str, fee: int = SPLIT_FEE, base: str | None = None,
         brief_base: str | None = None) -> dict:
    name, email = person("director")
    studio = f"Studio {tag()}"
    response = send_brief(brief_base or high(), name=name, email=email, studio=studio)
    assert response.status_code == 201, describe(response)
    reference = response.json()["reference"]
    found = find_enquiry(c, reference)
    assert found
    assert act(c, found["id"], "/transition", {"to": "qualified"}).status_code == 200
    pname, pemail = person("producer")
    title = f"Score {tag()}"
    sender = operator(base) if base else c
    sent = act(sender, found["id"], "/proposal", {"producer_name": pname, "producer_email": pemail,
                                                  "project_title": title, "scope": "Four adaptive layers.",
                                                  "fee_cents": fee, "production_month": month})
    assert sent.status_code == 201, describe(sent)
    enquiry = sent.json()["enquiry"]
    return {"id": found["id"], "reference": reference, "email": email, "studio": studio, "producer_name": pname,
            "producer_email": pemail, "title": title, "token": enquiry["proposal"]["token"], "enquiry": enquiry}


def accepted(c: httpx.Client, month: str, fee: int = SPLIT_FEE) -> dict:
    d = deal(c, month, fee)
    response = accept(base_of(c), d["token"])
    assert response.status_code == 201, describe(response)
    d["deposit"] = response.json()["deposit"]
    return d


def paid(c: httpx.Client, month: str) -> dict:
    d = accepted(c, month)
    response = pay(base_of(c), d["token"], idempotency_key(), d["deposit"]["amount_cents"])
    assert response.status_code == 200, describe(response)
    return d


def booked(c: httpx.Client, month: str) -> dict:
    d = paid(c, month)
    assert act(c, d["id"], "/transition", {"to": "booked"}).status_code == 200
    return d


def recipients(message: dict) -> set[str]:
    found: set[str] = set()
    for field in ("To", "Cc", "Bcc"):
        found |= {a.lower() for a in addresses(message.get(field))}
    return found


def messages_to(mail: Mailpit, address: str, settle: float = 1.5) -> list[dict]:
    return [m for m in mail.messages(settle=settle) if address.lower() in recipients(m)]


def inbox(mail: Mailpit, address: str, subject: str | None = None, count: int = 1,
          seconds: float = MAIL_WAIT) -> list[dict]:
    def matching(settle: float) -> list[dict]:
        return [m for m in messages_to(mail, address, settle) if subject is None or m["Subject"] == subject]

    eventually(lambda: len(matching(0)) >= count, seconds, f"{count} message(s) to {address}")
    return matching(1.5)


def html_text(message: dict) -> str:
    markup = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h[1-6])>", "\n", message.get("HTML") or "")
    return unescape(re.sub(r"<[^>]+>", "", markup))


def body_of(message: dict) -> str:
    return "\n".join((text(message), message.get("HTML") or "", html_text(message))).replace("\r\n", "\n")


def body_lines(message: dict) -> list[str]:
    plain = text(message) + "\n" + html_text(message)
    return [line.strip() for line in plain.replace("\r\n", "\n").split("\n") if line.strip()]


def kb(method: str, path: str, params: dict | None = None, content: str | None = None) -> httpx.Response:
    headers = {"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
               "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
               "X-Killbill-CreatedBy": "verifier", "Content-Type": "application/json",
               "Accept": "application/json"}
    return httpx.request(method, f"{os.environ['KILLBILL_URL'].rstrip('/')}/1.0/kb{path}", params=params,
                         content=content, headers=headers, timeout=HTTP_TIMEOUT,
                         auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]))


def kb_invoices(account_id: str) -> list[dict]:
    response = kb("GET", f"/accounts/{account_id}/invoices",
                  params={"includeInvoiceComponents": "true", "includeVoidedInvoices": "true"})
    assert response.status_code == 200, describe(response)
    return json.loads(response.text, parse_float=Decimal)


def kb_invoice_on(account_id: str, invoice_id: str) -> dict:
    return next(i for i in kb_invoices(account_id) if i["invoiceId"] == invoice_id)


def live_invoices(account_id: str) -> list[dict]:
    return [i for i in kb_invoices(account_id) if i["status"] != "VOID"]


def described(account_id: str, description: str) -> list[dict]:
    return [i for i in live_invoices(account_id)
            if any(item.get("description") == description for item in i.get("items") or [])]


def item_of(invoice_body: dict, description: str) -> dict:
    return next(item for item in invoice_body["items"] if item.get("description") == description)


def kb_account(killbill: KillBill, key: str, name: str, email: str) -> dict:
    response = kb("POST", "/accounts", content=json.dumps({"externalKey": key, "name": name, "email": email,
                                                           "currency": "USD"}))
    assert response.status_code == 201, describe(response)
    account = killbill.account_by_key(key)
    assert account
    return account


def kb_charge(account_id: str, amount: int, description: str) -> str:
    before = {i["invoiceId"] for i in kb_invoices(account_id)}
    body = ('[{"accountId":%s,"amount":%s,"currency":"USD","description":%s}]'
            % (json.dumps(account_id), dollars(amount), json.dumps(description)))
    response = kb("POST", f"/invoices/charges/{account_id}", params={"autoCommit": "true"}, content=body)
    assert response.status_code in (200, 201), describe(response)
    made = [i for i in described(account_id, description) if i["invoiceId"] not in before]
    assert len(made) == 1
    return made[0]["invoiceId"]


def kb_pay_invoice(account_id: str, invoice_id: str, amount: int) -> None:
    body = ('{"accountId":%s,"purchasedAmount":%s,"targetInvoiceId":%s}'
            % (json.dumps(account_id), dollars(amount), json.dumps(invoice_id)))
    response = kb("POST", f"/invoices/{invoice_id}/payments", params={"externalPayment": "true"}, content=body)
    assert response.status_code in (200, 201), describe(response)


def account_of(killbill: KillBill, reference: str) -> dict:
    account = killbill.account_by_key(f"earshot-{reference}")
    assert account, reference
    return account


def purchases(killbill: KillBill, account_id: str) -> list[tuple[dict, dict]]:
    out = []
    for payment in killbill.payments(account_id):
        for tx in payment.get("transactions") or []:
            if tx.get("transactionType") == "PURCHASE" and tx.get("status") == "SUCCESS":
                out.append((payment, tx))
    return out


def gate(page: Page) -> Locator:
    return page.get_by_role("dialog", name="Sound gate", exact=True)


def enter(page: Page, choice: str = "Enter muted") -> None:
    button = gate(page).get_by_role("button", name=choice, exact=True)
    expect(button).to_be_visible(timeout=REAL_GRACE_MS * 4)
    click(button)
    advance(page, GATE_MAX_MS)
    expect(gate(page)).to_be_hidden()


def station(page: Page, title: str) -> Locator:
    return page.get_by_role("region", name=title, exact=True)


def ladder(region: Locator) -> Locator:
    return region.get_by_role("group", name="Intensity ladder", exact=True)


def rung(region: Locator, layer: str) -> Locator:
    return region.get_by_role("button", name=RUNGS[layer], exact=True)


def meter(page: Page) -> Locator:
    return page.get_by_role("meter", name="Intensity", exact=True)


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Layer changes", exact=True)


def brief_form(page: Page) -> Locator:
    return page.get_by_role("form", name="Send a brief", exact=True)


def brief_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Brief status", exact=True)


def proposal_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Proposal status", exact=True)


def console_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Console status", exact=True)


def query(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(page.url).query)


def scroll_to(page: Page, y: int) -> None:
    page.evaluate("(y) => window.scrollTo({ top: y, behavior: 'instant' })", y)
    advance(page, FRAME_MS)


def jump(page: Page, region: Locator, layer: str = "bed") -> int:
    click(rung(region, layer))
    advance(page, FRAME_MS)
    reached = int(region.get_attribute("data-intensity") or "0")
    return int(page.evaluate("() => Math.round(window.scrollY)")) - reached * INTENSITY_STEP


def assert_at(page: Page, region: Locator, value: int, t: dict) -> None:
    assert region.get_attribute("data-intensity") == str(value), (value, region.get_attribute("data-intensity"))
    assert ladder(region).get_attribute("data-active-layers") == active(t, value)
    assert meter(page).get_attribute("aria-valuenow") == str(value)
    assert f"{value:03d}" in (meter(page).text_content() or "")


def assert_idle(page: Page, region: Locator) -> None:
    assert region.get_attribute("data-intensity") == "0"
    assert ladder(region).get_attribute("data-active-layers") == ""
    assert "000" in (meter(page).text_content() or "")


def fill_brief(page: Page, name: str, email: str, studio: str, brief: str = BRIEF_TEXT) -> Locator:
    form = brief_form(page)
    fill(form.get_by_role("textbox", name="Your name", exact=True), name)
    fill(form.get_by_role("textbox", name="Email", exact=True), email)
    fill(form.get_by_role("textbox", name="Studio", exact=True), studio)
    fill(form.get_by_role("textbox", name="Brief", exact=True), brief)
    return form


def received_reference(page: Page) -> str:
    status = brief_status(page)
    expect(status).to_have_text(re.compile(r"^Brief ENQ-\d{6} received\. A receipt will follow by email\.$"),
                                timeout=REAL_GRACE_MS * 8)
    found = re.search(r"ENQ-\d{6}", status.text_content() or "")
    assert found
    return found.group(0)


def probe_audio(page: Page) -> None:
    page.add_init_script(AUDIO_PROBE_JS)
    page.reload()


def audio(page: Page) -> dict[str, int]:
    return page.evaluate("() => ({ running: (window.__earshotAudio || []).filter(c => c.state === 'running').length })")


def animations_of(page: Page, root: Any = None) -> list[dict]:
    return page.evaluate(ANIMATIONS_JS, root)


def dolly(page: Page, region: Locator, end: str) -> None:
    wait_for(page, lambda: region.get_attribute("data-camera") == "moving")
    since = page.evaluate("() => Date.now()")
    wait_for(page, lambda: region.get_attribute("data-camera") == end)
    spent = page.evaluate("() => Date.now()") - since
    assert CAMERA_MIN_MS <= spent <= CAMERA_MAX_MS + PAGE_SLACK_MS, f"{end} after {spent} ms of page time"


@contextlib.contextmanager
def console_page(browser: Browser, app_url: str, view: str | None = None) -> Iterator[Page]:
    with open_app(browser, f"{app_url}/console") as page:
        sign_in(page)
        if view:
            open_view(page, view)
        yield page


def sign_in(page: Page) -> None:
    form = page.get_by_role("form", name="Operator sign in", exact=True)
    fill(form.get_by_role("textbox", name="Email", exact=True), OPERATOR_EMAIL)
    fill(form.get_by_label("Password", exact=True), OPERATOR_PASSWORD)
    click(form.get_by_role("button", name="Sign in", exact=True))
    expect(page.get_by_role("navigation", name="Console", exact=True)).to_be_visible(timeout=REAL_GRACE_MS * 4)


def open_view(page: Page, name: str) -> None:
    click(page.get_by_role("navigation", name="Console", exact=True).get_by_role("link", name=name, exact=True))


def open_row(page: Page, reference: str) -> None:
    button = page.get_by_role("button", name=f"Open {reference}", exact=True)
    more = page.get_by_role("button", name="Show more enquiries", exact=True)
    for _ in range(MAX_PAGES):
        try:
            expect(button).to_have_count(1, timeout=REAL_GRACE_MS * 2)
            break
        except AssertionError:
            click(more)
    click(button)


def open_project(page: Page, title: str, slug: str) -> None:
    open_view(page, "Projects")
    rows = page.get_by_role("list", name="Projects", exact=True).get_by_role("listitem")
    expect(rows.filter(has_text=title).or_(rows.filter(has_text=slug)).first).to_be_visible(timeout=REAL_GRACE_MS * 4)
    key = title if rows.filter(has_text=title).count() else slug
    item = rows.filter(has_text=key)
    expect(item).to_have_count(1, timeout=REAL_GRACE_MS * 4)
    named = item.get_by_role("link", name=key).or_(item.get_by_role("button", name=key))
    click(named.first if named.count() else item.get_by_text(key).first)


def send_stem(page: Page, layer: str) -> None:
    advance(page, FRAME_MS)
    word = LAYER_WORD[layer]
    named = page.get_by_role("button", name=re.compile(rf"^(?!.*stem file)(.*upload.*{word}|.*{word}.*upload)", re.I))
    plain = page.get_by_role("button", name=re.compile(r"^\W*upload(\s+(stems?|files?))?\W*$", re.I))
    if named.count():
        click(named.first)
    elif plain.count() == len(LAYERS):
        click(plain.nth(LAYERS.index(layer)))
    elif plain.count() == 1:
        click(plain.first)


def option_count(page: Page, combo: Locator, name: str) -> int:
    options = page.get_by_role("option", name=name, exact=True, include_hidden=True)
    if options.count() or combo.get_attribute("aria-expanded") != "false":
        return options.count()
    click(combo)
    advance(page, FRAME_MS)
    found = options.count()
    if combo.get_attribute("aria-expanded") == "true":
        click(combo)
        advance(page, FRAME_MS)
    return found


def spin_value(locator: Locator) -> str:
    return locator.evaluate("e => e.tagName === 'INPUT' ? e.value : (e.getAttribute('aria-valuenow') || '')")


def ring_styles(locator: Locator) -> tuple[dict, dict]:
    locator.page.mouse.move(0, 0)
    settle(locator)
    before = locator.evaluate(RING_JS)
    locator.focus()
    settle(locator)
    return before, locator.evaluate(RING_JS)


def raw_post(base: str, path: str, body: bytes, headers: dict[str, str]) -> tuple[int, dict]:
    target = urlparse(base)
    head = [f"POST {path} HTTP/1.1", f"Host: {target.netloc}", f"Content-Length: {len(body)}", "Connection: close"]
    head += [f"{k}: {v}" for k, v in headers.items()]
    data = b""
    with socket.create_connection((target.hostname, target.port or 80), timeout=HTTP_TIMEOUT) as conn:
        conn.sendall(("\r\n".join(head) + "\r\n\r\n").encode())
        with contextlib.suppress(OSError):
            for start in range(0, len(body), RAW_CHUNK):
                conn.sendall(body[start:start + RAW_CHUNK])
        with contextlib.suppress(OSError):
            while chunk := conn.recv(RAW_CHUNK):
                data += chunk
    status_head, _, rest = data.partition(b"\r\n\r\n")
    lines = status_head.decode("latin-1").split("\r\n")
    assert lines and lines[0].startswith("HTTP/"), data[:200]
    fields = {k.strip().lower(): v.strip() for k, _, v in (line.partition(":") for line in lines[1:])}
    if "chunked" in fields.get("transfer-encoding", "").lower():
        plain = b""
        while rest:
            size_line, _, rest = rest.partition(b"\r\n")
            size = int(size_line.split(b";")[0] or b"0", 16)
            if size == 0:
                break
            plain, rest = plain + rest[:size], rest[size + 2:]
        rest = plain
    return int(lines[0].split()[1]), json.loads(rest or b"{}")


def proposal_saved(address: str) -> re.Pattern:
    return re.compile("^(?:" + re.escape(f"Proposal sent to {address}.") + "|"
                      + re.escape("Proposal saved. The email is queued and will go out when mail is reachable.") + ")$")


def milestone_item(page: Page, n: int) -> Locator:
    return page.get_by_role("list", name="Milestone invoices", exact=True).get_by_role("listitem").filter(
        has_text=f"Milestone {n}:")


def test_sound_gate(browser: Browser, app_url: str) -> None:
    salt = journey_station(app_url, "salt-flats-chase")
    assert salt
    thresholds = salt["thresholds"]
    states: dict[str, tuple[str | None, str | None, str]] = {}
    for choice in ("Enter muted", "Enter with sound"):
        with open_app(browser, app_url) as page:
            probe_audio(page)
            dialog = gate(page)
            expect(dialog).to_be_visible(timeout=REAL_GRACE_MS * 4)
            expect(dialog.get_by_role("heading", name="Earshot by Kettlehole Audio", exact=True)).to_be_visible()
            expect(dialog).to_contain_text("Every station builds from silence. Choose how you want to listen.")
            assert audio(page)["running"] == 0
            enter(page, choice)
            region = station(page, salt["title"])
            jump(page, region, "lead")
            wait_for(page, lambda: "lead" in (ladder(region).get_attribute("data-active-layers") or "").split(","))
            states[choice] = (region.get_attribute("data-intensity"),
                              ladder(region).get_attribute("data-active-layers"),
                              json.dumps(query(page), sort_keys=True))
            sound = page.get_by_role("button", name="Sound on", exact=True)
            if choice == "Enter muted":
                assert audio(page)["running"] == 0
                expect(sound).to_have_attribute("aria-pressed", "false")
                click(sound)
                expect(sound).to_have_attribute("aria-pressed", "true")
                eventually(lambda: audio(page)["running"] >= 1, 10, "audio engine started by Sound on")
            else:
                expect(sound).to_have_attribute("aria-pressed", "true")
                eventually(lambda: audio(page)["running"] >= 1, 10, "audio engine started by Enter with sound")
    muted_state, sound_state = states["Enter muted"], states["Enter with sound"]
    assert muted_state == sound_state, states
    assert muted_state[0] == str(thresholds["lead"])


def test_scroll_intensity(browser: Browser, app_url: str) -> None:
    salt = journey_station(app_url, "salt-flats-chase")
    assert salt
    with open_app(browser, app_url) as page:
        enter(page)
        region = station(page, salt["title"])
        top = jump(page, region)
        offsets = [0, 7, 8, INTENSITY_STEP - 1, INTENSITY_STEP + 8, SCROLL_RANGE // 4, SCROLL_RANGE // 2,
                   SCROLL_RANGE - 1, SCROLL_RANGE]
        for direction in (offsets, list(reversed(offsets))):
            seen: list[int] = []
            for offset in direction:
                scroll_to(page, top + offset)
                value = intensity(offset)

                def shows(value: int = value, offset: int = offset) -> None:
                    assert region.get_attribute("data-intensity") == str(value), (offset, value)
                    assert meter(page).get_attribute("aria-valuenow") == str(value)
                    assert f"{value:03d}" in (meter(page).text_content() or "")

                wait_for(page, shows)
                box = meter(page).bounding_box()
                assert box and box["x"] > page.viewport_size["width"] / 2
                seen.append(value)
            assert seen in (sorted(seen), sorted(seen, reverse=True))
        scroll_to(page, top + SCROLL_RANGE)
        wait_for(page, lambda: region.get_attribute("data-intensity") == "100")
        scroll_to(page, top + SCROLL_RANGE + 1)
        wait_for(page, lambda: region.get_attribute("data-intensity") == "0")
        wait_for(page, lambda: "000" in (meter(page).text_content() or ""))


def test_ladder_scroll(browser: Browser, app_url: str) -> None:
    salt = journey_station(app_url, "salt-flats-chase")
    assert salt
    t, slug = salt["thresholds"], salt["slug"]
    with open_app(browser, app_url) as page:
        enter(page)
        region = station(page, salt["title"])
        top = jump(page, region)
        scroll_to(page, top - 1)
        wait_for(page, lambda: assert_idle(page, region))
        scroll_to(page, top)
        wait_for(page, lambda: assert_at(page, region, 0, t))
        expect(announcements(page)).to_contain_text(came_in("bed", 0))
        assert query(page) == {"station": [slug], "i": ["0"]}
        box = meter(page).bounding_box()
        assert box and box["x"] > page.viewport_size["width"] / 2
        offsets = sorted({0, 7, 8, 24, SCROLL_RANGE // 2, SCROLL_RANGE - 1, SCROLL_RANGE,
                          *[t[l] * INTENSITY_STEP - 9 for l in LAYERS[1:]],
                          *[t[l] * INTENSITY_STEP - 8 for l in LAYERS[1:]]})
        previous = active(t, 0)
        seen: list[int] = []
        for offset in offsets:
            scroll_to(page, top + offset)
            value = intensity(offset)
            wait_for(page, lambda: assert_at(page, region, value, t))
            seen.append(value)
            now = active(t, value)
            if now != previous:
                assert query(page) == {"station": [slug], "i": [str(value)]}
                for layer in set(now.split(",")) - set(previous.split(",")):
                    expect(announcements(page)).to_contain_text(came_in(layer, value))
            previous = now
        assert seen == sorted(seen)
        box = meter(page).bounding_box()
        assert box and box["x"] > page.viewport_size["width"] / 2
        seen = []
        for offset in reversed(offsets):
            scroll_to(page, top + offset)
            value = intensity(offset)
            wait_for(page, lambda: assert_at(page, region, value, t))
            seen.append(value)
            now = active(t, value)
            if now != previous:
                assert query(page) == {"station": [slug], "i": [str(value)]}
                for layer in set(previous.split(",")) - set(now.split(",")):
                    expect(announcements(page)).to_contain_text(went_out(layer, value))
            previous = now
        assert seen == sorted(seen, reverse=True)
        lead = t["lead"]
        scroll_to(page, top + lead * INTENSITY_STEP)
        wait_for(page, lambda: joined(came_in("pulse", lead), came_in("lead", lead)).search(
            announcements(page).text_content() or "") is not None)
        scroll_to(page, top)
        wait_for(page, lambda: joined(went_out("lead", 0), went_out("pulse", 0)).search(
            announcements(page).text_content() or "") is not None)
        scroll_to(page, top + SCROLL_RANGE)
        wait_for(page, lambda: assert_at(page, region, 100, t))
        scroll_to(page, top + SCROLL_RANGE + 1)
        wait_for(page, lambda: assert_idle(page, region))
        all_out = re.compile(r"\s*".join(rf"{LAYER_WORD[l]} out at intensity \d+\."
                                          for l in ("stinger", "lead", "pulse", "bed")))
        wait_for(page, lambda: all_out.search(announcements(page).text_content() or "") is not None)


def test_wf_listening_journey_scroll(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    t = tag()
    created, _ = published_project(c, title=f"Corridor {t}", credit_type="redesign",
                                   credit_line=f"Redesign line {t}", role=f"Role {t}", blurb=f"Corridor blurb {t}.")
    try:
        stations = journey_stations(app_url)
        assert all(s["slug"] not in ("glasshouse", "kiln-interior") for s in stations)
        projects = c.get("/api/console/projects").json()["projects"]
        ordered = sorted((p for p in projects if p["status"] == "published" and p["visibility"] == "public"),
                         key=lambda p: (p["position"], p["title"]))
        assert [s["slug"] for s in stations] == [p["slug"] for p in ordered]
        mine = next(s for s in stations if s["slug"] == created["slug"])
        assert (mine["title"], mine["credit_label"], mine["credit_line"], mine["role"], mine["blurb"]) == (
            created["title"], "Redesign", f"Redesign line {t}", f"Role {t}", f"Corridor blurb {t}.")
        with open_app(browser, app_url) as page:
            enter(page)
            regions = [r for r in page.get_by_role("region").all() if r.get_attribute("data-station") is not None]
            assert [r.get_attribute("data-station") for r in regions] == [s["slug"] for s in stations]
            for data, region in zip(stations, regions):
                content = region.text_content() or ""
                for field in ("credit_label", "title", "role", "credit_line", "blurb"):
                    assert data[field] in content, (field, data["slug"])
            region = station(page, created["title"])
            expect(region).to_have_attribute("data-station", created["slug"])
            content = region.text_content() or ""
            for copy in ("Redesign", created["title"], f"Role {t}", f"Redesign line {t}", f"Corridor blurb {t}."):
                assert copy in content, copy
            jump(page, region)
            box = region.get_by_role("heading", name=created["title"], exact=True).bounding_box()
            size = page.viewport_size
            assert box and box["x"] + box["width"] / 2 < size["width"] / 2 and box["y"] > size["height"] / 3
            follows = page.evaluate(
                "([a, b]) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)",
                [regions[-1].element_handle(), brief_form(page).element_handle()])
            assert follows
    finally:
        withdraw(c, created["id"])


def test_wf_listening_journey_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    stations = journey_stations(app_url)
    first = stations[0]
    t = first["thresholds"]
    name, email = person("keyboard")
    studio = f"Keys {tag()}"
    presses = 5 * len(stations) + TAB_WINDOW_EXTRA
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        wait_focus(page, gate(page).get_by_role("button", name="Enter with sound", exact=True))
        page.keyboard.press("Tab")
        expect(gate(page).get_by_role("button", name="Enter muted", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        advance(page, FRAME_MS)
        expect(gate(page)).to_be_hidden()
        wait_for(page, lambda: page.evaluate(HEADING_FOCUSED_JS))
        form = brief_form(page)
        fields = {n: form.get_by_role("textbox", name=n, exact=True) for n in ("Your name", "Email", "Studio", "Brief")}
        send = form.get_by_role("button", name="Send brief", exact=True)
        targets: list[tuple[str, Locator]] = []
        for s in stations:
            targets.append((f"Intensity for {s['title']}",
                            page.get_by_role("slider", name=f"Intensity for {s['title']}", exact=True)))
            targets += [(RUNGS[l], rung(station(page, s["title"]), l)) for l in LAYERS]
        targets += [*fields.items(), ("Send brief", send)]
        handles = [loc.element_handle() for _, loc in targets]
        names = []
        for _ in range(presses):
            page.keyboard.press("Tab")
            index = page.evaluate("(els) => els.indexOf(document.activeElement)", handles)
            names.append(targets[index][0] if index >= 0 else "")
        assert "Send brief" in names, names
        window = names[: names.index("Send brief") + 1]
        ladder_names = {f"Intensity for {s['title']}" for s in stations} | set(RUNGS.values())
        expected: list[str] = []
        for s in stations:
            expected += [f"Intensity for {s['title']}", *RUNGS.values()]
        assert [n for n in window if n in ladder_names] == expected
        last_rung = max(i for i, n in enumerate(window) if n == "Stinger layer")
        form_order = [window.index(n) for n in ("Your name", "Email", "Studio", "Brief", "Send brief")]
        assert form_order == sorted(form_order) and form_order[0] > last_rung

        region = station(page, first["title"])
        tab_to(page, page.get_by_role("slider", name=f"Intensity for {first['title']}", exact=True), presses)
        region.evaluate("e => e.scrollIntoView({ block: 'start', behavior: 'instant' })")
        page.keyboard.press("Home")
        wait_for(page, lambda: region.get_attribute("data-intensity") == "0")
        for step in range(1, t["pulse"] + 1):
            page.keyboard.press("ArrowRight")
            wait_for(page, lambda: region.get_attribute("data-intensity") == str(step))
        expect(announcements(page)).to_contain_text(came_in("pulse", t["pulse"]))
        wait_for(page, lambda: ladder(region).get_attribute("data-active-layers") == "bed,pulse")
        tab_to(page, rung(region, "stinger"), presses)
        page.keyboard.press("Space")
        wait_for(page, lambda: region.get_attribute("data-intensity") == str(t["stinger"]))
        expect(rung(region, "stinger")).to_have_attribute("aria-pressed", "true")
        wait_for(page, lambda: region.get_attribute("data-camera") == "close")
        for label, value in (("Your name", name), ("Email", email), ("Studio", studio), ("Brief", BRIEF_TEXT)):
            tab_to(page, fields[label], presses)
            page.keyboard.type(value)
        tab_to(page, fields["Studio"], presses, "Shift+Tab")
        page.keyboard.press("Enter")
        reference = received_reference(page)
    c = operator(app_url)
    enquiry = find_enquiry(c, reference)
    assert enquiry and enquiry["email"] == email and enquiry["studio"] == studio
    assert len(inbox(mail, email)) == 1


def test_reduced_motion_ladder(browser: Browser, app_url: str) -> None:
    salt = journey_station(app_url, "salt-flats-chase")
    assert salt
    t, title = salt["thresholds"], salt["title"]
    slider_name = f"Intensity for {title}"
    with open_app(browser, app_url) as page:
        enter(page)
        expect(page.get_by_role("slider", name=slider_name, exact=True)).to_have_count(0)
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        enter(page)
        region = station(page, title)
        region.evaluate("e => e.scrollIntoView({ block: 'start', behavior: 'instant' })")
        wait_for(page, lambda: region.get_attribute("data-camera") == "close")
        others = [r for r in page.get_by_role("region").all()
                  if r.get_attribute("data-station") not in (None, salt["slug"])]
        wait_for(page, lambda: all(r.get_attribute("data-camera") == "wide" for r in others))
        start = region.get_attribute("data-intensity")
        page.evaluate("() => window.scrollBy({ top: 400, behavior: 'instant' })")
        advance(page, FRAME_MS)
        assert region.get_attribute("data-intensity") == start
        slider = page.get_by_role("slider", name=slider_name, exact=True)
        slider.focus()
        page.keyboard.press("End")
        wait_for(page, lambda: region.get_attribute("data-intensity") == "100")
        wait_for(page, lambda: ladder(region).get_attribute("data-active-layers") == "bed,pulse,lead,stinger")
        assert query(page) == {"station": [salt["slug"]], "i": ["100"]}
        page.keyboard.press("Home")
        wait_for(page, lambda: region.get_attribute("data-intensity") == "0")
        expect(announcements(page)).to_contain_text(went_out("stinger", 0))
        page.keyboard.press("ArrowRight")
        wait_for(page, lambda: region.get_attribute("data-intensity") == "1")
        click(rung(region, "lead"))
        wait_for(page, lambda: region.get_attribute("data-intensity") == str(t["lead"]))
        for layer, pressed in zip(LAYERS, ("true", "true", "true", "false")):
            expect(rung(region, layer)).to_have_attribute("aria-pressed", pressed)
        wait_for(page, lambda: joined(came_in("pulse", t["lead"]), came_in("lead", t["lead"])).search(
            announcements(page).text_content() or "") is not None)
        assert query(page) == {"station": [salt["slug"]], "i": [str(t["lead"])]}
        assert region.get_attribute("data-camera") == "close"


def test_search(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    words = {k: tag() for k in ("title", "credit", "blurb", "tag")}
    created, _ = published_project(c, title=f"Seek {words['title']}", credit_line=f"Credit {words['credit']}",
                                   blurb=f"Blurb mentions {words['blurb']}.", tags=[words["tag"]])
    try:
        for word in words.values():
            for q in (word, word.upper()):
                results = search(app_url, q)
                assert [r["slug"] for r in results] == [created["slug"]], (q, results)
                assert results[0]["credit_label"] == "Game jam" and results[0]["title"] == created["title"]
        assert all(r["slug"] != "glasshouse" for r in search(app_url, "Glasshouse"))
        assert all(r["slug"] != "kiln-interior" for r in search(app_url, "Kiln Interior"))
        for params in ({}, {"q": ""}, {"q": "x" * (Q_MAX + 1)}):
            assert_invalid(httpx.get(f"{app_url}/api/search", params=params, timeout=HTTP_TIMEOUT), "q")
        with open_app(browser, app_url) as page:
            enter(page)
            box = page.get_by_role("searchbox", name="Search projects", exact=True)
            fill(box, words["title"])
            advance(page, SEARCH_DEBOUNCE_MS)
            results = page.get_by_role("list", name="Search results", exact=True)
            link = results.get_by_role("link", name=created["title"], exact=True)
            expect(link).to_be_visible(timeout=REAL_GRACE_MS * 2)
            count = results.get_by_role("link").count()
            expect(page.get_by_role("status", name="Search status", exact=True)).to_have_text(f"{count} projects found.")
            click(link)
            advance(page, FRAME_MS)
            region = station(page, created["title"])
            wait_for(page, lambda: region.get_attribute("data-intensity") == "0"
                     and ladder(region).get_attribute("data-active-layers") == "bed")
            expect(region.get_by_role("heading", name=created["title"], exact=True)).to_be_focused()
            missing = f"zq{tag()}"
            fill(box, missing)
            advance(page, SEARCH_DEBOUNCE_MS)
            expect(page.get_by_role("status", name="Search status", exact=True)).to_have_text(
                f"No projects match “{missing}”.", timeout=REAL_GRACE_MS * 2)
        listed = journey_station(app_url, created["slug"])
        assert listed and listed["stems"]
        stem_urls = [f"{app_url}{s['url']}" for s in listed["stems"]]
        assert move_project(c, created["id"], "withdrawn").status_code == 200
        for word in words.values():
            assert all(r["slug"] != created["slug"] for r in search(app_url, word))
        assert journey_station(app_url, created["slug"]) is None
        for url in stem_urls:
            assert_error(httpx.get(url, timeout=HTTP_TIMEOUT), 404, "not_found")
    finally:
        withdraw(c, created["id"])


def test_console_auth(browser: Browser, app_url: str) -> None:
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    calls = [("GET", "/api/console/projects", None), ("GET", "/api/console/enquiries", None),
             ("GET", "/api/console/months", None), ("GET", "/api/console/settings", None),
             ("GET", "/api/console/mail-queue", None), ("GET", "/api/console/enquiries.csv", None),
             ("POST", "/api/console/milestones/preview", {"fee_cents": SPLIT_FEE}),
             ("POST", "/api/console/projects", {}), ("DELETE", "/api/console/session", None)]
    for method, path, body in calls:
        assert_error(anon.request(method, path, json=body), 401, "unauthenticated")
    forged = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT, cookies={"earshot_session": f"forged-{tag()}"})
    assert_error(forged.get("/api/console/projects"), 401, "unauthenticated")
    wrong = anon.post("/api/console/session", json={"email": OPERATOR_EMAIL, "password": f"wrong-{tag()}"})
    assert_error(wrong, 401, "invalid_credentials")
    signed = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    response = signed.post("/api/console/session", json={"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD})
    assert response.status_code == 200 and response.json() == {"operator": {"email": OPERATOR_EMAIL}}
    cookie = response.headers.get("set-cookie", "")
    assert "earshot_session" in cookie
    assert "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    assert signed.get("/api/console/projects").status_code == 200
    assert signed.delete("/api/console/session").status_code == 204
    assert_error(signed.get("/api/console/projects"), 401, "unauthenticated")
    with open_app(browser, f"{app_url}/console") as page:
        form = page.get_by_role("form", name="Operator sign in", exact=True)
        fill(form.get_by_role("textbox", name="Email", exact=True), OPERATOR_EMAIL)
        fill(form.get_by_label("Password", exact=True), f"wrong-{tag()}")
        click(form.get_by_role("button", name="Sign in", exact=True))
        expect(console_status(page)).to_have_text("That email and password don’t match.", timeout=REAL_GRACE_MS * 2)
        expect(page.get_by_role("navigation", name="Console", exact=True)).to_have_count(0)


def test_project_records(app_url: str) -> None:
    c = operator(app_url)
    created = new_project(c)
    assert created["status"] == "draft" and created["tags"] == [] and created["visibility"] == "public"
    assert created["thresholds"] == {"bed": 0, "pulse": 25, "lead": 50, "stinger": 75}
    assert created["stems"] == [] and isinstance(created["position"], int) and 1 <= created["position"] <= POSITION_MAX
    t = tag()
    base = {"slug": f"rec-{t}", "title": "Rec", "credit_type": "shipped", "credit_line": "Line", "role": "Role",
            "blurb": "Blurb."}
    bad = [("slug", "ab"), ("slug", "Bad_Slug"), ("slug", "a" * (SLUG_MAX + 1)), ("title", ""), ("title", "a\nb"),
           ("title", "x" * (TEXT_MAX + 1)), ("credit_type", "film"), ("credit_line", "x" * (CREDIT_LINE_MAX + 1)),
           ("role", ""), ("blurb", "x" * (BLURB_MAX + 1)), ("blurb", "bad\x01char"),
           ("tags", [f"t{i}" for i in range(TAGS_MAX + 1)]), ("tags", ["x" * (TAG_MAX + 1)]), ("tags", ["a\tb"]),
           ("visibility", "secret"), ("position", 0), ("position", POSITION_MAX + 1), ("position", 2.5),
           ("position", "5"), ("thresholds", {"bed": 5, "pulse": 25, "lead": 50, "stinger": 75}),
           ("thresholds", {"bed": 0, "pulse": 25, "lead": 25, "stinger": 75}),
           ("thresholds", {"bed": 0, "pulse": 25, "lead": 50}),
           ("thresholds", {"bed": 0, "pulse": 25, "lead": 50, "stinger": 101}),
           ("thresholds", {"bed": 0, "pulse": 25, "lead": 50, "stinger": 75, "drop": 90})]
    for field, value in bad:
        assert_invalid(c.post("/api/console/projects", json={**base, field: value}), field)
    assert all(p["slug"] != base["slug"] for p in c.get("/api/console/projects").json()["projects"])
    assert_error(c.post("/api/console/projects", json={**base, "slug": created["slug"]}), 409, "slug_taken")
    full = c.post("/api/console/projects", json={**base, "tags": ["chase", "synth"], "visibility": "nda",
                                                 "position": 7, "thresholds": {"bed": 0, "pulse": 30, "lead": 55,
                                                                               "stinger": 85}})
    assert full.status_code == 201, describe(full)
    record = full.json()["project"]
    assert record["tags"] == ["chase", "synth"] and record["visibility"] == "nda" and record["position"] == 7
    assert record["thresholds"] == {"bed": 0, "pulse": 30, "lead": 55, "stinger": 85}
    pid = created["id"]
    renamed = tag()
    patched = c.patch(f"/api/console/projects/{pid}", json={"title": renamed, "tags": ["ambient"]})
    assert patched.status_code == 200 and patched.json()["project"]["title"] == renamed
    assert project(c, pid)["tags"] == ["ambient"]
    assert_invalid(c.patch(f"/api/console/projects/{pid}", json={"thresholds": {"bed": 0, "pulse": 60, "lead": 50,
                                                                                 "stinger": 75}}), "thresholds")
    assert project(c, pid)["thresholds"] == created["thresholds"]
    assert_invalid(c.patch(f"/api/console/projects/{pid}", json={}), "body")
    assert_error(c.patch(f"/api/console/projects/{pid}", json={"slug": record["slug"]}), 409, "slug_taken")
    assert move_project(c, pid, "withdrawn").status_code == 200
    assert_error(c.patch(f"/api/console/projects/{pid}", json={"title": "Again"}), 409, "project_withdrawn")
    withdraw(c, record["id"])


def test_stem_upload_checks(app_url: str) -> None:
    c = operator(app_url)
    s3 = storage()
    created = new_project(c)
    pid = created["id"]
    prefix = f"projects/{pid}/stems/"
    try:
        good = {"bed": wav(1.0), "pulse": wav(2.0, rate=RATE_MAX, channels=2, bits=32, tag_value=0xFFFE, sub=3),
                "lead": sized_wav(STEM_LIMIT), "stinger": wav(float(STEM_MAX_SECONDS))}
        ids = {}
        response = None
        for layer, data in good.items():
            response = upload(c, pid, layer, data)
            assert response.status_code == 201, (layer, describe(response))
            stem = response.json()["stem"]
            assert stem["layer"] == layer and stem["format"] == "wav" and stem["bytes"] == len(data)
            ids[layer] = stem["id"]
        assert response is not None and response.json()["stem"]["duration_ms"] == STEM_MAX_SECONDS * 1000
        assert sorted(s3.keys(prefix)) == sorted(f"{prefix}{ids[l]}.wav" for l in LAYERS)
        assert s3.get(f"{prefix}{ids['bed']}.wav") == good["bed"]
        replacement = wav(1.5)
        response = upload(c, pid, "bed", replacement)
        assert response.status_code == 201
        new_bed = response.json()["stem"]["id"]
        keys = s3.keys(prefix)
        assert f"{prefix}{new_bed}.wav" in keys and f"{prefix}{ids['bed']}.wav" not in keys
        stored = sorted(s3.keys(prefix))
        refusals = [
            (sized_wav(STEM_LIMIT + 8), "stem.wav", (413,), "file_too_large"),
            (TEXT_BYTES, "renamed.wav", (415,), "unsupported_media"),
            (SVG_BYTES, "stem.wav", (415,), "unsupported_media"),
            (HTML_BYTES, "stem.wav", (415,), "unsupported_media"),
            (ZIP_BYTES, "stem.wav", (415,), "unsupported_media"),
            (wav(1.0, tag_value=2), "stem.wav", (415,), None),
            (wav(1.0, channels=3), "stem.wav", (415, 422), None),
            (wav(1.0, rate=RATE_MIN - 1), "stem.wav", (415, 422), None),
            (wav(1.0, rate=RATE_MAX + 1), "stem.wav", (415, 422), None),
            (wav(float(STEM_MAX_SECONDS + 1)), "stem.wav", (415, 422), None),
            (wav(0.5), "stem.wav", (415, 422), None),
        ]
        for data, filename, statuses, code in refusals:
            response = upload(c, pid, "bed", data, filename)
            assert response.status_code in statuses, (filename, len(data), describe(response))
            if code:
                assert response.json()["error"] == code
        for filename in ("../stem.wav", "a/b.wav", "a\\b.wav", "x" * (FILENAME_MAX - 3) + ".wav"):
            assert_invalid(upload(c, pid, "bed", wav(1.0), filename), "file")
        assert_invalid(upload(c, pid, "drums", wav(1.0)), "layer")
        assert sorted(s3.keys(prefix)) == stored
        assert {s["id"] for s in project(c, pid)["stems"]} == {new_bed, ids["pulse"], ids["lead"], ids["stinger"]}
    finally:
        withdraw(c, pid)


def test_project_lifecycle_moves(app_url: str) -> None:
    c = operator(app_url)
    pid = new_project(c)["id"]
    for to in ("published", "draft"):
        body = assert_error(move_project(c, pid, to), 409, "illegal_transition")
        assert body["from"] == "draft" and body["to"] == to
    assert_invalid(move_project(c, pid, "archived"), "to")
    assert move_project(c, pid, "in_review").status_code == 200
    for layer in ("bed", "pulse"):
        assert upload(c, pid, layer, wav(1.0)).status_code == 201
    body = assert_error(move_project(c, pid, "published"), 409, "stems_incomplete")
    assert body["missing"] == ["lead", "stinger"]
    assert project(c, pid)["status"] == "in_review"
    assert move_project(c, pid, "draft").status_code == 200
    assert move_project(c, pid, "in_review").status_code == 200
    for layer in ("lead", "stinger"):
        assert upload(c, pid, layer, wav(1.0)).status_code == 201
    assert move_project(c, pid, "published").json()["project"]["status"] == "published"
    for to in ("in_review", "draft", "published"):
        assert_error(move_project(c, pid, to), 409, "illegal_transition")
    assert move_project(c, pid, "withdrawn").status_code == 200
    for to in ("draft", "in_review", "published", "withdrawn"):
        body = assert_error(move_project(c, pid, to), 409, "illegal_transition")
        assert body["from"] == "withdrawn"
    assert_error(upload(c, pid, "bed", wav(1.0)), 409, "project_withdrawn")
    assert project(c, pid)["status"] == "withdrawn"


def choose(form: Locator, label: str, word: str) -> None:
    pattern = re.compile(rf"\b{re.escape(word)}\b", re.I)
    radio = form.get_by_role("radio", name=pattern)
    if radio.count():
        check(radio.first)
        return
    named = re.compile(rf"^\s*{re.escape(label)}\b")
    field = form.get_by_role("combobox", name=named).or_(form.get_by_label(label, exact=True)).first
    picked = field.evaluate("""(e, w) => {
        if (e.tagName !== 'SELECT') return null;
        const re = new RegExp('\\\\b' + w + '\\\\b', 'i');
        const o = [...e.options].find(o => re.test((o.label || o.text || '').trim()) || re.test(o.value));
        return o ? (o.label || o.text || '').trim() : '';
    }""", re.escape(word))
    if picked:
        select(field, picked)
        return
    assert picked is None, f"no {label} option holds {word!r}"
    click(field)
    click(form.page.get_by_role("option", name=pattern).first)


def test_wf_project_lifecycle_publish(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    t = tag()
    slug, title = f"ui-{t}", f"Console {t}"
    stems = {layer: wav(1 + i) for i, layer in enumerate(LAYERS)}
    with console_page(browser, app_url, "Projects") as page:
        click(page.get_by_role("button", name="New project", exact=True))
        form = page.get_by_role("form", name="Project details", exact=True)
        fill(form.get_by_label("Slug", exact=True), slug)
        fill(form.get_by_label("Title", exact=True), title)
        choose(form, "Credit type", "jam")
        fill(form.get_by_label("Credit line", exact=True), f"Jam build {t}")
        fill(form.get_by_label("Role", exact=True), "Solo audio")
        fill(form.get_by_label("Blurb", exact=True), f"Layers built at a jam {t}.")
        fill(form.get_by_label("Position", exact=True), str(POSITION_MAX // 2))
        for layer, value in zip(LAYERS[1:], ("25", "50", "75")):
            fill(form.get_by_label(f"{LAYER_WORD[layer]} threshold", exact=True), value)
        click(form.get_by_role("button", name="Save project", exact=True))
        expect(console_status(page)).to_have_text("Project saved.", timeout=REAL_GRACE_MS * 2)
        for layer, data in stems.items():
            field = page.get_by_label(f"{LAYER_WORD[layer]} stem file", exact=True)
            field.set_input_files({"name": f"{layer}.wav", "mimeType": "audio/wav", "buffer": data})
            send_stem(page, layer)
            expect(console_status(page)).to_have_text(f"{LAYER_WORD[layer]} stem stored.", timeout=REAL_GRACE_MS * 4)
        click(page.get_by_role("button", name="Send for review", exact=True))
        click(page.get_by_role("button", name="Publish", exact=True))
        expect(console_status(page)).to_have_text(f"{title} is live in the journey.", timeout=REAL_GRACE_MS * 4)
    record = next(p for p in c.get("/api/console/projects").json()["projects"] if p["slug"] == slug)
    try:
        assert record["status"] == "published"
        data = journey_station(app_url, slug)
        assert data and data["playable"] is True and len(data["stems"]) == 4
        for stem in data["stems"]:
            response = httpx.get(f"{app_url}{stem['url']}", timeout=HTTP_TIMEOUT)
            assert response.status_code == 200 and response.headers["content-type"].startswith("audio/wav")
            assert response.content == stems[stem["layer"]]
        assert [r["slug"] for r in search(app_url, title)] == [slug]
        assert len(storage().keys(f"projects/{record['id']}/stems/")) == 4
        with open_app(browser, app_url) as page:
            enter(page)
            expect(station(page, title)).to_have_attribute("data-station", slug)
    finally:
        withdraw(c, record["id"])


def test_wf_project_lifecycle_rejected_stem(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    created = new_project(c)
    try:
        with console_page(browser, app_url) as page:
            open_project(page, created["title"], created["slug"])
            field = page.get_by_label("Bed stem file", exact=True)
            field.set_input_files({"name": "bed.wav", "mimeType": "audio/wav", "buffer": TEXT_BYTES})
            send_stem(page, "bed")
            expect(console_status(page)).to_have_text("That file isn’t a WAV or OGG stem.", timeout=REAL_GRACE_MS * 2)
            expect(page.get_by_text("Missing").first).to_be_visible()
        assert project(c, created["id"])["stems"] == []
        assert storage().keys(f"projects/{created['id']}/stems/") == []
    finally:
        withdraw(c, created["id"])


def test_withdraw_project(app_url: str) -> None:
    c = operator(app_url)
    s3 = storage()
    created, _ = published_project(c)
    pid, slug = created["id"], created["slug"]
    link = make_link(c, pid)
    prefix = f"projects/{pid}/"
    station_data = journey_station(app_url, slug)
    assert station_data and len(s3.keys(prefix)) == 4
    stem_urls = [f"{app_url}{s['url']}" for s in station_data["stems"]]
    link_stems = [f"{app_url}{s['url']}" for s in listen(app_url, link["token"]).json()["station"]["stems"]]
    assert all(httpx.get(u, timeout=HTTP_TIMEOUT).status_code == 200 for u in stem_urls + link_stems)
    assert [r["slug"] for r in search(app_url, created["title"])] == [slug]
    response = move_project(c, pid, "withdrawn")
    assert response.status_code == 200 and response.json()["project"]["status"] == "withdrawn"
    assert s3.keys(prefix) == []
    assert journey_station(app_url, slug) is None
    assert search(app_url, created["title"]) == []
    for url in stem_urls + link_stems:
        assert_error(httpx.get(url, timeout=HTTP_TIMEOUT), 404, "not_found")
    assert_error(listen(app_url, link["token"]), 404, "not_found")
    listed = c.get(f"/api/console/projects/{pid}/links")
    if listed.status_code == 404:
        assert_error(listed, 404, "not_found")
    else:
        assert listed.status_code == 200, describe(listed)
        assert [l["status"] for l in listed.json()["links"]] == ["revoked"]


def test_wf_project_lifecycle_storage_outage(browser: Browser, app_url: str) -> None:
    down = env_url("APP_MINIO_DOWN_URL")
    c = operator(app_url)
    cd = operator(down)
    s3 = storage()
    stations = journey_stations(down)
    assert stations and all(s["playable"] is False and s["stems"] == [] for s in stations)
    salt = journey_station(app_url, "salt-flats-chase")
    assert salt
    assert_error(httpx.get(f"{down}{salt['stems'][0]['url']}", timeout=HTTP_TIMEOUT), 503, "storage_unavailable")
    draft = new_project(cd)
    assert_error(upload(cd, draft["id"], "bed", wav(1.0)), 503, "storage_unavailable")
    assert s3.keys(f"projects/{draft['id']}/") == []
    ready = new_project(c)
    fill_stems(c, ready["id"])
    assert move_project(c, ready["id"], "in_review").status_code == 200
    assert_error(move_project(cd, ready["id"], "published"), 503, "storage_unavailable")
    assert project(c, ready["id"])["status"] == "in_review"
    assert_error(move_project(cd, ready["id"], "withdrawn"), 503, "storage_unavailable")
    assert project(c, ready["id"])["status"] == "in_review" and len(s3.keys(f"projects/{ready['id']}/")) == 4
    marker = newest_number(c)
    name, email = person("outage")
    response = send_brief(down, name=name, email=email, attachment=("ref.pdf", pdf(), "application/pdf"))
    assert_error(response, 503, "storage_unavailable")
    assert all(e["email"] != email for e in enquiries_since(c, marker))
    assert send_brief(down, name=name, email=email).status_code == 201
    with open_app(browser, down) as page:
        enter(page)
        region = station(page, salt["title"])
        expect(region).to_contain_text("Audio is resting. Credits and notes are still here.")
        expect(region).to_contain_text(salt["title"])
        jump(page, region, "lead")
        wait_for(page, lambda: ladder(region).get_attribute("data-active-layers") == "bed,pulse,lead")
    withdraw(c, ready["id"])
    withdraw(c, draft["id"])


def test_link_rules(app_url: str) -> None:
    c = operator(app_url)
    draft = new_project(c)
    server, _, _ = server_clock(c)
    body = {"label": "Preview", "expires_at": iso(server + timedelta(hours=1))}
    assert_error(c.post(f"/api/console/projects/{draft['id']}/links", json=body), 409, "illegal_transition")
    review = new_project(c)
    assert move_project(c, review["id"], "in_review").status_code == 200
    path = f"/api/console/projects/{review['id']}/links"
    wanted = server + timedelta(hours=1)
    label = tag()
    response = c.post(path, json={"label": label, "expires_at": iso(wanted)})
    assert response.status_code == 201, describe(response)
    link = response.json()["link"]
    assert link["url"] == f"/listen/{link['token']}" and link["status"] == "active"
    assert link["label"] == label and parse_iso(link["expires_at"]) == parse_iso(iso(wanted))
    other = c.post(path, json={"label": "Second", "expires_at": iso(wanted)}).json()["link"]
    assert other["token"] != link["token"]
    data = listen(app_url, link["token"])
    assert data.status_code == 200 and data.json()["station"]["slug"] == review["slug"]
    assert data.json()["nda"] is False and parse_iso(data.json()["expires_at"]) == parse_iso(link["expires_at"])
    server, _, _ = server_clock(c)
    for value in (iso(server - timedelta(minutes=1)), "not a date",
                  iso(server + timedelta(seconds=LINK_MAX_SECONDS + 60))):
        assert_invalid(c.post(path, json={"label": "Bound", "expires_at": value}), "expires_at")
    near_max = c.post(path, json={"label": "Year", "expires_at": iso(server + timedelta(seconds=LINK_MAX_SECONDS - 60))})
    assert near_max.status_code == 201, describe(near_max)
    for label in ("", "a\nb", "x" * (LABEL_MAX + 1)):
        assert_invalid(c.post(path, json={"label": label, "expires_at": iso(wanted)}), "label")
    seed = listen(app_url, SEED_LINK_TOKEN).json()["station"]["stems"]
    targets = [f"/api/listen/{link['token']}", seed[0]["url"]]
    for target in targets:
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            r = httpx.request(method, f"{app_url}{target}", json={"label": "x"}, timeout=HTTP_TIMEOUT)
            assert_error(r, 405, "read_only")
            assert "GET" in r.headers.get("allow", "")
    assert listen(app_url, link["token"]).status_code == 200
    withdraw(c, review["id"])
    withdraw(c, draft["id"])


def test_revoke_regenerate(app_url: str) -> None:
    c = operator(app_url)
    created, stems = published_project(c)
    pid = created["id"]
    a = make_link(c, pid)
    urls = [f"{app_url}{s['url']}" for s in listen(app_url, a["token"]).json()["station"]["stems"]]
    assert all(httpx.get(u, timeout=HTTP_TIMEOUT).status_code == 200 for u in urls)
    revoked = c.post(f"/api/console/links/{a['id']}/revoke", json={})
    assert revoked.status_code == 200 and revoked.json()["link"]["status"] == "revoked"
    assert_error(listen(app_url, a["token"]), 404, "not_found")
    for url in urls:
        assert_error(httpx.get(url, timeout=HTTP_TIMEOUT), 404, "not_found")
    assert_error(c.post(f"/api/console/links/{a['id']}/regenerate", json={}), 409, "link_not_active")
    b = make_link(c, pid, label="Second director")
    old_urls = [f"{app_url}{s['url']}" for s in listen(app_url, b["token"]).json()["station"]["stems"]]
    response = c.post(f"/api/console/links/{b['id']}/regenerate", json={})
    assert response.status_code == 201, describe(response)
    fresh = response.json()["link"]
    assert fresh["id"] != b["id"] and fresh["token"] != b["token"] and fresh["label"] == b["label"]
    assert parse_iso(fresh["expires_at"]) == parse_iso(b["expires_at"]) and fresh["status"] == "active"
    assert_error(listen(app_url, b["token"]), 404, "not_found")
    for url in old_urls:
        assert_error(httpx.get(url, timeout=HTTP_TIMEOUT), 404, "not_found")
    new_stems = listen(app_url, fresh["token"]).json()["station"]["stems"]
    for stem in new_stems:
        r = httpx.get(f"{app_url}{stem['url']}", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.content == stems[stem["layer"]]
    e = make_link(c, pid, seconds=SHORT_LINK_SECONDS, label="Short")
    eventually(lambda: listen(app_url, e["token"]).status_code == 410, EXPIRY_WAIT, "short link expired")
    assert_error(c.post(f"/api/console/links/{e['id']}/regenerate", json={}), 409, "link_not_active")
    revoked = c.post(f"/api/console/links/{e['id']}/revoke", json={})
    assert revoked.status_code == 200 and revoked.json()["link"]["status"] == "revoked"
    assert_error(listen(app_url, e["token"]), 404, "not_found")
    statuses = {l["id"]: l["status"] for l in c.get(f"/api/console/projects/{pid}/links").json()["links"]}
    assert statuses[a["id"]] == "revoked" and statuses[b["id"]] == "revoked" and statuses[fresh["id"]] == "active"
    withdraw(c, pid)


def test_nda_off_public(app_url: str) -> None:
    c = operator(app_url)
    assert journey_station(app_url, "glasshouse") is None
    assert all(r["slug"] != "glasshouse" for r in search(app_url, "Glasshouse"))
    seed = listen(app_url, SEED_LINK_TOKEN)
    assert seed.status_code == 200 and seed.json()["nda"] is True and seed.json()["station"]["slug"] == "glasshouse"
    for stem in seed.json()["station"]["stems"]:
        assert_error(httpx.get(f"{app_url}/api/stems/{stem['id']}", timeout=HTTP_TIMEOUT), 404, "not_found")
    nda, _ = published_project(c, visibility="nda")
    review = new_project(c)
    fill_stems(c, review["id"])
    assert move_project(c, review["id"], "in_review").status_code == 200
    public, _ = published_project(c)
    try:
        for hidden, flag in ((nda, True), (review, False)):
            assert journey_station(app_url, hidden["slug"]) is None
            assert search(app_url, hidden["title"]) == []
            for stem in project(c, hidden["id"])["stems"]:
                assert_error(httpx.get(f"{app_url}/api/stems/{stem['id']}", timeout=HTTP_TIMEOUT), 404, "not_found")
            data = listen(app_url, make_link(c, hidden["id"])["token"])
            assert data.status_code == 200 and data.json()["nda"] is flag
            for stem in data.json()["station"]["stems"]:
                assert httpx.get(f"{app_url}{stem['url']}", timeout=HTTP_TIMEOUT).status_code == 200
        assert journey_station(app_url, public["slug"]) is not None
        assert c.patch(f"/api/console/projects/{public['id']}", json={"visibility": "nda"}).status_code == 200
        assert journey_station(app_url, public["slug"]) is None and search(app_url, public["title"]) == []
    finally:
        for p in (nda, review, public):
            withdraw(c, p["id"])


def test_link_expiry_edges(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    created, _ = published_project(c, visibility="nda")
    _, skew, spread = server_clock(c)
    link = make_link(c, created["id"], seconds=LINK_LEAD_SECONDS)
    token = link["token"]
    expires = parse_iso(link["expires_at"])
    deadline = expires.timestamp()
    data = listen(app_url, token)
    stem_url = f"{app_url}{data.json()['station']['stems'][0]['url']}"
    for response in (data, httpx.get(stem_url, timeout=HTTP_TIMEOUT), listen(app_url, f"unknown-{tag()}"),
                     httpx.post(f"{app_url}/api/listen/{token}", json={}, timeout=HTTP_TIMEOUT)):
        assert "no-store" in response.headers.get("cache-control", ""), response.status_code
    html = httpx.get(f"{app_url}/listen/{token}", timeout=HTTP_TIMEOUT)
    assert html.status_code == 200 and html.headers.get("referrer-policy") == "no-referrer"
    assert "no-store" in html.headers.get("cache-control", "")
    with open_app(browser, f"{app_url}/listen/{token}") as page:
        enter(page)
        region = station(page, created["title"])
        expect(region).to_be_visible()
        expect(page.get_by_role("region", name="NDA notice", exact=True)).to_contain_text(
            f"Private listening under NDA. This link stops working on {written(expires, zone(c))}.")
        status = page.get_by_role("status", name="Link status", exact=True)
        expect(status).to_have_text("")
        samples = []
        give_up = time.time() + LINK_LEAD_SECONDS + LINK_EDGE_WAIT_SECONDS
        while time.time() < give_up:
            sent = time.time()
            if sent + skew < deadline - 1.5:
                threading.Event().wait(POLL_SECONDS)
            response = listen(app_url, token)
            got = time.time()
            samples.append((sent, got, response.status_code, response.json().get("error")))
            if sent + skew - spread > deadline + 1:
                break
        else:
            pytest.fail(f"the link's expiry edge was not passed within {LINK_LEAD_SECONDS + LINK_EDGE_WAIT_SECONDS}s")
        for sent, got, code, error in samples:
            if got + skew + spread + EDGE_SLACK < deadline:
                assert code == 200, (sent, deadline)
            if sent + skew - spread - EDGE_SLACK > deadline:
                assert code == 410 and error == "link_expired", (sent, deadline, code)
        assert {s[2] for s in samples} == {200, 410}
        stem = httpx.get(stem_url, timeout=HTTP_TIMEOUT)
        assert_error(stem, 410, "link_expired")
        assert "no-store" in stem.headers.get("cache-control", "")
        remaining = deadline * 1000 - page.evaluate("() => Date.now()")
        if remaining > SECOND_MS:
            page.clock.fast_forward(int(remaining - SECOND_MS))
            remaining = SECOND_MS
        if remaining > 0:
            advance(page, remaining)
        live(page, lambda: expect(status).to_have_text(
            "This listening link has expired. Ask Kettlehole Audio for a new one.", timeout=REAL_GRACE_MS), EXPIRY_MS)
        expect(region).to_have_count(0)
        expect(page.get_by_role("button", name="Send brief", exact=True)).to_be_enabled()
    withdraw(c, created["id"])


def test_open_page_revocation(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    created, _ = published_project(c)
    doomed, _ = published_project(c)
    links = {"revoke": make_link(c, created["id"]), "regenerate": make_link(c, created["id"]),
             "withdraw": make_link(c, doomed["id"])}
    titles = {"revoke": created["title"], "regenerate": created["title"], "withdraw": doomed["title"]}
    for action, link in links.items():
        stems = [f"{app_url}{s['url']}" for s in listen(app_url, link["token"]).json()["station"]["stems"]]
        with open_app(browser, f"{app_url}/listen/{link['token']}") as page:
            enter(page)
            region = station(page, titles[action])
            expect(region).to_be_visible()
            if action == "revoke":
                assert c.post(f"/api/console/links/{link['id']}/revoke", json={}).status_code == 200
            elif action == "regenerate":
                response = c.post(f"/api/console/links/{link['id']}/regenerate", json={})
                assert response.status_code == 201
                assert listen(app_url, response.json()["link"]["token"]).status_code == 200
            else:
                assert move_project(c, doomed["id"], "withdrawn").status_code == 200
            assert_error(listen(app_url, link["token"]), 404, "not_found")
            for url in stems:
                assert_error(httpx.get(url, timeout=HTTP_TIMEOUT), 404, "not_found")
            status = page.get_by_role("status", name="Link status", exact=True)
            live(page, lambda: expect(status).to_have_text("This listening link is not available.",
                                                           timeout=REAL_GRACE_MS), REVOKE_MS)
            expect(region).to_have_count(0)
            expect(page.get_by_role("button", name="Send brief", exact=True)).to_be_enabled()
    withdraw(c, created["id"])


def test_wf_private_links_listen(browser: Browser, app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    created, _ = published_project(c, visibility="nda")
    link = make_link(c, created["id"])
    t = listen(app_url, link["token"]).json()["station"]["thresholds"]
    name, email = person("nda")
    try:
        with open_app(browser, f"{app_url}{link['url']}") as page:
            probe_audio(page)
            enter(page, "Enter with sound")
            eventually(lambda: audio(page)["running"] >= 1, 10, "audio running on private page")
            expect(page.get_by_role("region", name="NDA notice", exact=True)).to_contain_text(
                f"Private listening under NDA. This link stops working on {written(parse_iso(link['expires_at']), zone(c))}.")
            expect(page.get_by_role("searchbox", name="Search projects", exact=True)).to_have_count(0)
            region = station(page, created["title"])
            jump(page, region, "lead")
            wait_for(page, lambda: region.get_attribute("data-intensity") == str(t["lead"])
                     and ladder(region).get_attribute("data-active-layers") == "bed,pulse,lead"
                     and query(page) == {"station": [created["slug"]], "i": [str(t["lead"])]})
            expect(announcements(page)).to_contain_text(came_in("lead", t["lead"]))
            fill_brief(page, name, email, f"Studio {tag()}")
            click(page.get_by_role("button", name="Send brief", exact=True))
            reference = received_reference(page)
        enquiry = find_enquiry(c, reference)
        assert enquiry and enquiry["project_slug"] == created["slug"]
        assert len(inbox(mail, email)) == 1
    finally:
        withdraw(c, created["id"])


def test_wf_private_links_revoked(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    created, _ = published_project(c, visibility="nda")
    link = make_link(c, created["id"])
    name, email = person("revoked")
    try:
        with open_app(browser, f"{app_url}{link['url']}") as page:
            enter(page)
            assert c.post(f"/api/console/links/{link['id']}/revoke", json={}).status_code == 200
            status = page.get_by_role("status", name="Link status", exact=True)
            live(page, lambda: expect(status).to_have_text("This listening link is not available.",
                                                           timeout=REAL_GRACE_MS), REVOKE_MS)
            fill_brief(page, name, email, f"Studio {tag()}")
            click(page.get_by_role("button", name="Send brief", exact=True))
            reference = received_reference(page)
        enquiry = find_enquiry(c, reference)
        assert enquiry and enquiry["email"] == email and not enquiry["project_slug"]
    finally:
        withdraw(c, created["id"])


def test_brief_validation(app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    base = high()
    marker = newest_number(c)
    full = fresh_month(c, 0)
    rejected = []
    cases = [("name", {"name": ""}), ("name", {"name": "x" * (TEXT_MAX + 1)}), ("name", {"name": "Ann\nBcc"}),
             ("email", {"email": "not-an-address"}), ("email", {"email": "a@b"}), ("studio", {"studio": ""}),
             ("studio", {"studio": "Tab\tStudio"}), ("brief", {"brief": "x" * (BRIEF_MIN - 1)}),
             ("brief", {"brief": "x" * (BRIEF_MAX + 1)}), ("brief", {"brief": BRIEF_TEXT + "\x07"}),
             ("preferred_month", {"extra": {"preferred_month": "2001-01"}}),
             ("preferred_month", {"extra": {"preferred_month": full}})]
    for field, override in cases:
        name, email = person("invalid")
        kwargs: dict[str, Any] = {"name": name, "email": email}
        kwargs.update(override)
        assert_invalid(send_brief(base, **kwargs), field)
        rejected.append(kwargs["email"])
    assert enquiries_since(c, marker) == []
    open_month = fresh_month(c, 2)
    public, _ = published_project(c)
    nda, _ = published_project(c, visibility="nda")
    try:
        multi = "Line one of the brief.\r\nLine two\twith a tab."
        response = send_brief(base, brief=multi, extra={"preferred_month": open_month, "project_slug": public["slug"]})
        assert response.status_code == 201, describe(response)
        body = response.json()
        assert body["status"] == "new" and body["receipt"] in ("sent", "pending")
        assert ref_number(body["reference"]) > marker
        stored = find_enquiry(c, body["reference"])
        assert stored and stored["brief"] == multi and stored["preferred_month"] == open_month
        assert stored["project_slug"] == public["slug"] and stored["version"] == 1
        hidden = find_enquiry(c, send_brief(base, extra={"project_slug": nda["slug"]}).json()["reference"])
        assert hidden and not hidden["project_slug"]
        link = make_link(c, nda["id"])
        via = find_enquiry(c, send_brief(base, extra={"listen_token": link["token"]}).json()["reference"])
        assert via and via["project_slug"] == nda["slug"]
    finally:
        withdraw(c, public["id"])
        withdraw(c, nda["id"])
    found = {a for m in mail.messages() for a in recipients(m)}
    assert not found & {e.lower() for e in rejected}


def test_wf_enquiry_intake_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    name, studio = 'Hale, Imogen "Imo"', "Ålborg Lydværk"
    _, email = person("happy")
    reference_wav = wav(2.0)
    filename = f"{tag()}.wav"
    with open_app(browser, app_url) as page:
        enter(page)
        form = fill_brief(page, name, email, studio)
        form.get_by_label("Reference file (optional)", exact=True).set_input_files(
            {"name": filename, "mimeType": "audio/wav", "buffer": reference_wav})
        click(form.get_by_role("button", name="Send brief", exact=True))
        reference = received_reference(page)
        expect(form.get_by_role("textbox", name="Your name", exact=True)).to_have_value("")
    enquiry = find_enquiry(c, reference)
    assert enquiry and enquiry["name"] == name and enquiry["studio"] == studio and enquiry["status"] == "new"
    assert enquiry["attachment"]["filename"] == filename and enquiry["attachment"]["bytes"] == len(reference_wav)
    keys = storage().keys(f"briefs/{enquiry['id']}/")
    assert len(keys) == 1 and keys[0].endswith(".wav") and storage().get(keys[0]) == reference_wav
    receipt = inbox(mail, email, subject=f"Your brief reached Kettlehole Audio ({reference})")
    assert len(receipt) == 1 and receipt[0]["To"][0]["Name"] == name


def test_wf_enquiry_intake_invalid(browser: Browser, app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    name, email = person("fixer")
    with open_app(browser, app_url) as page:
        enter(page)
        form = fill_brief(page, name, "a@b", f"Studio {tag()}")
        click(form.get_by_role("button", name="Send brief", exact=True))
        expect(brief_status(page)).to_have_text("Check the highlighted fields.", timeout=REAL_GRACE_MS * 2)
        expect(form.get_by_role("textbox", name="Email", exact=True)).to_be_focused()
        fill(form.get_by_role("textbox", name="Email", exact=True), email)
        click(form.get_by_role("button", name="Send brief", exact=True))
        reference = received_reference(page)
    found = find_enquiry(c, reference)
    assert found and found["email"] == email
    assert len(inbox(mail, email)) == 1
    assert messages_to(mail, "a@b") == []


def test_reference_file_checks(app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    s3 = storage()
    base = high()
    for filename, data, ctype, ext in (("ref.wav", wav(2.0), "audio/wav", "wav"),
                                       ("ref.mp3", MP3_BYTES, "audio/mpeg", "mp3"),
                                       ("limit.pdf", pdf(REFERENCE_LIMIT), "application/pdf", "pdf")):
        response = send_brief(base, attachment=(filename, data, ctype))
        assert response.status_code == 201, describe(response)
        enquiry = find_enquiry(c, response.json()["reference"])
        assert enquiry and enquiry["attachment"]["filename"] == filename
        assert enquiry["attachment"]["bytes"] == len(data)
        keys = s3.keys(f"briefs/{enquiry['id']}/")
        assert len(keys) == 1 and keys[0].endswith(f".{ext}")
        download = c.get(f"/api/console/enquiries/{enquiry['id']}/attachment")
        assert download.status_code == 200 and download.content == data
        assert download.headers["content-disposition"].startswith("attachment")
    marker = newest_number(c)
    refused = []
    for filename, data, status, code in (("big.pdf", pdf(REFERENCE_LIMIT + 1), 413, "file_too_large"),
                                         ("art.svg", SVG_BYTES, 415, "unsupported_media"),
                                         ("page.html", HTML_BYTES, 415, "unsupported_media"),
                                         ("bundle.zip", ZIP_BYTES, 415, "unsupported_media"),
                                         ("renamed.wav", TEXT_BYTES, 415, "unsupported_media"),
                                         ("three.wav", wav(1.0, channels=3), 415, "unsupported_media")):
        _, email = person("refused")
        assert_error(send_brief(base, email=email, attachment=(filename, data, "audio/wav")), status, code)
        refused.append(email)
    _, email = person("traversal")
    assert_invalid(send_brief(base, email=email, attachment=("../ref.pdf", pdf(), "application/pdf")), "attachment")
    refused.append(email)
    assert enquiries_since(c, marker) == []
    found = {a for m in mail.messages() for a in recipients(m)}
    assert not found & {e.lower() for e in refused}


def test_enquiry_pacing(browser: Browser, app_url: str, mail: Mailpit) -> None:
    name, email = person("pacing")
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        responses = list(pool.map(lambda _: send_brief(app_url, name=name, email=email), range(6)))
    created = [r for r in responses if r.status_code == 201]
    limited = [r for r in responses if r.status_code == 429]
    assert len(created) == SENDER_LIMIT and len(limited) == 6 - SENDER_LIMIT, [r.status_code for r in responses]
    for response in limited:
        body = assert_error(response, 429, "rate_limited")
        seconds = body["retry_after_seconds"]
        assert isinstance(seconds, int) and 1 <= seconds <= PACING_WINDOW
        assert response.headers["retry-after"] == str(seconds)
    assert send_brief(app_url, name=name, email=email.upper()).status_code == 429
    receipts = inbox(mail, email, count=SENDER_LIMIT)
    assert len(receipts) == SENDER_LIMIT
    strict = env_url("APP_STRICT_PACING_URL")
    senders = [person("ip")[1] for _ in range(STRICT_IP_LIMIT + 3)]
    with concurrent.futures.ThreadPoolExecutor(len(senders)) as pool:
        burst = list(pool.map(lambda e: (e, send_brief(strict, email=e)), senders))
    saved = [e for e, r in burst if r.status_code == 201]
    blocked = [(e, r) for e, r in burst if r.status_code != 201]
    assert len(saved) <= STRICT_IP_LIMIT and blocked
    for _, response in blocked:
        assert_error(response, 429, "rate_limited")
        assert int(response.headers["retry-after"]) >= 1
    assert send_brief(strict).status_code == 429
    found = {a for m in mail.messages() for a in recipients(m)}
    assert not found & {e.lower() for e, _ in blocked}
    with open_app(browser, app_url) as page:
        enter(page)
        form = fill_brief(page, name, email, f"Studio {tag()}")
        click(form.get_by_role("button", name="Send brief", exact=True))
        expect(brief_status(page)).to_have_text(re.compile(
            r"^You have sent several briefs in a short time\. Try again in \d+ (seconds|minutes)\.$"),
            timeout=REAL_GRACE_MS * 2)


def test_receipt_and_alert(app_url: str, mail: Mailpit) -> None:
    name, email = person("receipt")
    studio = f"Studio {tag()}"
    brief = "First line of the brief for the score.\nSecond line keeps the break."
    response = send_brief(high(), name=name, email=email, studio=studio, brief=brief)
    assert response.status_code == 201
    reference = response.json()["reference"]
    receipts = inbox(mail, email)
    assert len(receipts) == 1
    receipt = receipts[0]
    assert receipt["Subject"] == f"Your brief reached Kettlehole Audio ({reference})"
    assert addresses(receipt["From"]) == [mail_from_address()]
    lines, wanted = body_lines(receipt), [line.strip() for line in brief.split("\n")]
    assert any(lines[i].endswith(wanted[0]) and lines[i + 1].startswith(wanted[1])
               for i in range(len(lines) - 1)), lines
    alerts = inbox(mail, OPERATOR_EMAIL, subject=f"New brief {reference} from {studio}")
    assert len(alerts) == 1 and addresses(alerts[0]["From"]) == [mail_from_address()]
    assert [a.lower() for a in addresses(alerts[0]["ReplyTo"])] == [email.lower()]


def test_header_safe_brief_emails(app_url: str, mail: Mailpit) -> None:
    base = high()
    watched = []
    cases = [("name", lambda bcc: {"name": f"Mallory\r\nBcc: {bcc}"}),
             ("studio", lambda bcc: {"studio": f"Evil\nBcc: {bcc}"}),
             ("email", lambda bcc: {"email": f"Ann <{bcc}>"}),
             ("email", lambda bcc: {"email": f"{person('first')[1]}, {bcc}"}),
             ("email", lambda bcc: {"email": f"{person('first')[1]}\r\nBcc: {bcc}"})]
    for field, build in cases:
        name, email = person("inject")
        bcc = person("bcc")[1]
        fields: dict[str, Any] = {"name": name, "email": email}
        fields.update(build(bcc))
        assert_invalid(send_brief(base, **fields), field)
        watched += [email, bcc]
    for name, studio in (('Hale, Imogen "Imo"', "Ålborg Lydværk"), ("Søren Ålund", f"Studio {tag()}")):
        email = person("display")[1]
        response = send_brief(base, name=name, email=email, studio=studio)
        assert response.status_code == 201
        reference = response.json()["reference"]
        receipt = inbox(mail, email)
        assert len(receipt) == 1
        assert [(r["Name"], r["Address"].lower()) for r in receipt[0]["To"]] == [(name, email.lower())]
        assert not receipt[0].get("Cc") and not receipt[0].get("Bcc")
        alert = inbox(mail, OPERATOR_EMAIL, subject=f"New brief {reference} from {studio}")
        assert len(alert) == 1
        assert [(r["Name"], r["Address"].lower()) for r in alert[0]["ReplyTo"]] == [(name, email.lower())]
        assert addresses(alert[0]["To"]) == [OPERATOR_EMAIL] and not alert[0].get("Cc") and not alert[0].get("Bcc")
    found = {a for m in mail.messages() for a in recipients(m)}
    assert not found & {e.lower() for e in watched}


def test_brief_idempotency(app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    base = high()
    marker = newest_number(c)
    name, email = person("idem")
    studio = f"Studio {tag()}"
    key = idempotency_key()
    first = send_brief(base, name=name, email=email, studio=studio, key=key)
    assert first.status_code == 201
    again = send_brief(base, name=name, email=email, studio=studio, key=key)
    assert again.status_code == 201 and again.json() == first.json()
    assert_error(send_brief(base, name=name, email=email, studio=studio, brief=BRIEF_TEXT + " Changed.", key=key),
                 409, "idempotency_conflict")
    name2, email2 = person("race")
    key2 = idempotency_key()
    with concurrent.futures.ThreadPoolExecutor(5) as pool:
        racing = list(pool.map(lambda _: send_brief(base, name=name2, email=email2, studio=studio, key=key2), range(5)))
    assert {r.status_code for r in racing} <= {201, 409}
    assert all(r.json()["error"] == "request_in_progress" for r in racing if r.status_code == 409)
    assert len({json.dumps(r.json(), sort_keys=True) for r in racing if r.status_code == 201}) == 1
    for bad in ("", "x" * (KEY_MAX + 1), "has space"):
        assert_invalid(send_brief(base, key=bad), "Idempotency-Key")
    key3 = idempotency_key()
    short = send_brief(base, name=name, email=email, studio=studio, brief="too short", key=key3)
    assert_invalid(short, "brief")
    assert send_brief(base, name=name, email=email, studio=studio, brief="too short", key=key3).json() == short.json()
    assert_error(send_brief(base, name=name, email=email, studio=studio, key=key3), 409, "idempotency_conflict")
    name4, email4 = person("attach")
    key4 = idempotency_key()
    sample = ("ref.wav", wav(1.0), "audio/wav")
    with_file = send_brief(base, name=name4, email=email4, studio=studio, attachment=sample, key=key4)
    assert with_file.status_code == 201
    replay = send_brief(base, name=name4, email=email4, studio=studio, attachment=sample, key=key4)
    assert replay.json() == with_file.json()
    assert_error(send_brief(base, name=name4, email=email4, studio=studio,
                            attachment=("ref.wav", wav(1.5), "audio/wav"), key=key4), 409, "idempotency_conflict")
    saved = enquiries_since(c, marker)
    for address in (email, email2, email4):
        assert len([e for e in saved if e["email"] == address]) == 1, address
        assert len(inbox(mail, address)) == 1
    four = next(e for e in saved if e["email"] == email4)
    assert len(storage().keys(f"briefs/{four['id']}/")) == 1


def test_wf_enquiry_intake_upload(browser: Browser, app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    name, email = person("upload")
    studio = f"Studio {tag()}"
    sent: list[str | None] = []
    with open_app(browser, app_url) as page:
        page.route("**/api/enquiries", lambda route: (sent.append(route.request.headers.get("idempotency-key")),
                                                      route.continue_()))
        enter(page)
        form = fill_brief(page, name, email, studio)
        field = form.get_by_label("Reference file (optional)", exact=True)
        send = form.get_by_role("button", name=re.compile(r"^(Send brief|Sending…)$"))
        for data, copy in ((bytes(REFERENCE_LIMIT + 1), "That file is too large. The limit is 10,000,000 bytes."),
                           (wav(1.0, tag_value=2), "That WAV isn’t PCM or float audio. Send WAV, OGG, MP3 or PDF."),
                           (wav(1.0, channels=3), "That WAV must have one or two channels. Send a mono or stereo file."),
                           (wav(1.0, rate=RATE_MIN - 1), "That WAV’s sample rate isn’t accepted. Use 22,050 to 96,000 Hz.")):
            field.set_input_files({"name": "ref.wav", "mimeType": "audio/wav", "buffer": data})
            click(send)
            expect(brief_status(page)).to_have_text(copy, timeout=REAL_GRACE_MS * 2)
            expect(field).to_be_focused()
            expect(send).to_be_enabled()
        assert sent == []
        field.set_input_files({"name": "ref.wav", "mimeType": "audio/wav", "buffer": wav(2.0)})
        with held(page, "**/api/enquiries") as gate_:
            click(send)
            bar = form.get_by_role("progressbar", name="Reference upload", exact=True)
            expect(bar).to_be_visible(timeout=REAL_GRACE_MS)
            expect(bar).to_have_attribute("aria-valuemin", "0")
            expect(bar).to_have_attribute("aria-valuemax", "100")
            value = int(bar.get_attribute("aria-valuenow") or "-1")
            assert 0 <= value <= 100 and f"{value}%" in (bar.text_content() or "")
            expect(send).to_be_disabled()
            expect(brief_status(page)).to_have_text("Sending your brief…")
            gate_.release()
        first_reference = received_reference(page)
        expect(form.get_by_role("progressbar", name="Reference upload", exact=True)).to_have_count(0)
        page.unroute("**/api/enquiries")
        keys: list[str | None] = []
        outcomes: list[int] = []

        def drop_first(route: Any) -> None:
            keys.append(route.request.headers.get("idempotency-key"))
            if len(keys) == 1:
                outcomes.append(route.fetch().status)
                route.abort("connectionreset")
            else:
                route.continue_()

        page.route("**/api/enquiries", drop_first)
        _, email2 = person("retry")
        fill_brief(page, name, email2, studio)
        field.set_input_files({"name": "ref.wav", "mimeType": "audio/wav", "buffer": wav(1.0)})
        click(send)
        expect(brief_status(page)).to_have_text("Connection lost. Retrying your brief…", timeout=REAL_GRACE_MS * 4)
        expect(send).to_be_disabled()
        advance(page, RETRY_MS)
        second_reference = received_reference(page)
    assert outcomes == [201] and len(keys) >= 2 and keys[0] and len(set(keys)) == 1
    assert first_reference != second_reference
    matches = [e for e in enquiries_since(c, ref_number(first_reference) - 1) if e["email"] == email2]
    assert len(matches) == 1 and matches[0]["reference"] == second_reference
    assert len(inbox(mail, email2)) == 1


def test_triage_rules(app_url: str) -> None:
    c = operator(app_url)
    e = intake(c)
    eid = e["id"]
    notes = "Fits the roguelite pipeline.\n\tTiered."
    response = act(c, eid, "", {"triage_notes": notes, "fit_score": 4, "rate_floor_cents": 800000}, "PATCH")
    assert response.status_code == 200
    saved = response.json()["enquiry"]
    assert (saved["triage_notes"], saved["fit_score"], saved["rate_floor_cents"]) == (notes, 4, 800000)
    assert saved["version"] == 2 and response.headers["etag"] == json.dumps(str(saved["version"]))
    for field, value in (("fit_score", 0), ("fit_score", 6), ("fit_score", 2.5), ("fit_score", "3"),
                         ("rate_floor_cents", -1), ("rate_floor_cents", 1.5), ("triage_notes", "x" * (NOTES_MAX + 1)),
                         ("triage_notes", "bad\x01")):
        assert_invalid(act(c, eid, "", {field: value}, "PATCH"), field)
    cleared = act(c, eid, "", {"fit_score": None, "rate_floor_cents": None}, "PATCH").json()["enquiry"]
    assert cleared["fit_score"] is None and cleared["rate_floor_cents"] is None and cleared["version"] == 3
    body = assert_error(act(c, eid, "/transition", {"to": "booked"}), 409, "illegal_transition")
    assert body["from"] == "new" and body["to"] == "booked"
    for to in ("accepted", "proposal_sent", "expired", "deposit_paid", "new"):
        assert_invalid(act(c, eid, "/transition", {"to": to}), "to")
    assert act(c, eid, "/transition", {"to": "qualified"}).json()["enquiry"]["status"] == "qualified"
    assert_error(act(c, eid, "/transition", {"to": "qualified"}), 409, "illegal_transition")
    assert act(c, eid, "/transition", {"to": "declined"}).json()["enquiry"]["status"] == "declined"
    for to in ("qualified", "declined", "booked"):
        assert assert_error(act(c, eid, "/transition", {"to": to}), 409, "illegal_transition")["from"] == "declined"
    assert act(c, eid, "", {"triage_notes": "Still editable."}, "PATCH").status_code == 200
    other = intake(c)
    assert act(c, other["id"], "/transition", {"to": "declined"}).json()["enquiry"]["status"] == "declined"


def test_wf_enquiry_triage_two_tabs(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    e = intake(c)
    reference = e["reference"]
    mine, theirs = "Mine: keep the roguelite tiers.", "Agreed stinger budget with the studio."
    with console_page(browser, app_url, "Enquiries") as first, console_page(browser, app_url, "Enquiries") as second:
        open_row(first, reference)
        open_row(second, reference)
        fill(second.get_by_role("textbox", name="Triage notes", exact=True), mine)
        fill(second.get_by_role("textbox", name="Rate floor (USD)", exact=True), "900.00")
        fill(first.get_by_role("textbox", name="Triage notes", exact=True), theirs)
        fill(first.get_by_role("spinbutton", name="Fit score", exact=True), "4")
        fill(first.get_by_role("textbox", name="Rate floor (USD)", exact=True), "1234.00")
        click(first.get_by_role("button", name="Save triage", exact=True))
        expect(console_status(first)).to_have_text("Triage saved.", timeout=REAL_GRACE_MS * 2)
        click(second.get_by_role("button", name="Save triage", exact=True))
        expect(console_status(second)).to_have_text(
            "This enquiry changed in another window. Choose which value to keep for each field shown, then save again.",
            timeout=REAL_GRACE_MS * 2)
        region = second.get_by_role("region", name="Changed in another window", exact=True)
        expect(region).to_be_visible()
        fit = second.get_by_role("spinbutton", name="Fit score", exact=True)
        wait_for(second, lambda: spin_value(fit) == "4")
        for copy in (f"Theirs: {theirs}", f"Yours: {mine}", "Theirs: $1,234.00", "Yours: $900.00"):
            expect(region).to_contain_text(copy)
        expect(region.get_by_role("radiogroup", name="Fit score", exact=True)).to_have_count(0)
        notes_group = region.get_by_role("radiogroup", name="Triage notes", exact=True)
        floor_group = region.get_by_role("radiogroup", name="Rate floor (USD)", exact=True)
        expect(notes_group.get_by_role("radio", name="Keep mine", exact=True)).to_be_checked()
        expect(floor_group.get_by_role("radio", name="Keep mine", exact=True)).to_be_checked()
        check(floor_group.get_by_role("radio", name="Use theirs", exact=True))
        click(second.get_by_role("button", name="Save triage", exact=True))
        expect(console_status(second)).to_have_text("Triage saved.", timeout=REAL_GRACE_MS * 2)
        expect(region).to_be_hidden()
        stored, _ = current(c, e["id"])
        assert (stored["triage_notes"], stored["fit_score"], stored["rate_floor_cents"]) == (mine, 4, 123400)
        assert stored["version"] == 3
        click(first.get_by_role("button", name="Qualify", exact=True))
        expect(console_status(first)).to_have_text(
            "This enquiry changed in another window. The latest version is shown; save again to apply your edit.",
            timeout=REAL_GRACE_MS * 2)
        assert current(c, e["id"])[0]["status"] == "new"
        click(first.get_by_role("button", name="Qualify", exact=True))
        expect(first.get_by_role("button", name="Build proposal", exact=True)).to_be_visible(timeout=REAL_GRACE_MS * 2)
        assert current(c, e["id"])[0]["status"] == "qualified"
        click(second.get_by_role("button", name="Decline", exact=True))
        expect(console_status(second)).to_contain_text("This enquiry changed in another window.",
                                                       timeout=REAL_GRACE_MS * 2)
        with second.expect_response(lambda r: r.request.method == "POST"
                                    and r.url.endswith(f"/api/console/enquiries/{e['id']}/transition")):
            click(second.get_by_role("button", name="Decline", exact=True))
        expect(second.get_by_role("button", name="Qualify", exact=True)).to_have_count(0)
    final, _ = current(c, e["id"])
    assert final["status"] == "declined" and final["version"] == 5 and final["triage_notes"] == mine


def test_csv_export(app_url: str) -> None:
    c = operator(app_url)
    base = high()
    public, _ = published_project(c)
    crafted: list[dict[str, Any]] = [
        {"name": "+Plus Name", "studio": '=HYPERLINK("http://x.example","y")', "brief": "@SUM(1,2) " + BRIEF_TEXT},
        {"name": 'Hale, Imogen "Imo"', "studio": "-Minus Studio", "brief": "\t" + BRIEF_TEXT},
        {"name": "Plain Name", "studio": "Plain Studio", "brief": "\r\n" + BRIEF_TEXT,
         "extra": {"project_slug": public["slug"]}},
    ]
    refs = []
    for fields in crafted:
        response = send_brief(base, **fields)
        assert response.status_code == 201, describe(response)
        refs.append(response.json()["reference"])
    third = find_enquiry(c, refs[2])
    assert third and act(c, third["id"], "", {"fit_score": 2}, "PATCH").status_code == 200

    def rows() -> dict[str, dict]:
        response = c.get("/api/console/enquiries.csv")
        assert response.status_code == 200
        assert response.headers["content-type"].replace(" ", "").lower().startswith("text/csv;charset=utf-8")
        assert response.headers["content-disposition"] == 'attachment; filename="earshot-enquiries.csv"'
        assert response.text.splitlines()[0] == CSV_HEADER
        parsed = list(csv.DictReader(io.StringIO(response.text, newline="")))
        numbers = [ref_number(r["reference"]) for r in parsed]
        assert numbers == sorted(numbers, reverse=True)
        return {r["reference"]: r for r in parsed}

    assert rows()[refs[2]]["project_slug"] == public["slug"]
    withdraw(c, public["id"])
    table = rows()
    one, two, three = (table[r] for r in refs)
    assert one["name"] == "'" + crafted[0]["name"] and one["studio"] == "'" + crafted[0]["studio"]
    assert one["brief"] == "'" + crafted[0]["brief"]
    assert two["name"] == crafted[1]["name"] and two["studio"] == "'" + crafted[1]["studio"]
    assert two["brief"] == "'" + crafted[1]["brief"]
    assert three["brief"] == "'" + crafted[2]["brief"] and three["project_slug"] == ""
    assert three["fit_score"] == "2" and three["status"] == "new" and three["receipt"]
    assert re.search(r"(Z|\+00:00)$", three["received_at"])
    for row in (one, two, three):
        for value in row.values():
            assert not value.startswith(FORMULA_STARTS), row


def test_wf_enquiry_triage_export(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    studio = "=" + tag()
    response = send_brief(high(), studio=studio)
    assert response.status_code == 201
    reference = response.json()["reference"]
    with console_page(browser, app_url, "Enquiries") as page:
        with page.expect_download() as download_info:
            click(page.get_by_role("link", name="Export CSV", exact=True))
        content = Path(download_info.value.path()).read_text(encoding="utf-8")
    assert content.splitlines()[0] == CSV_HEADER
    row = next(r for r in csv.DictReader(io.StringIO(content, newline="")) if r["reference"] == reference)
    assert row["studio"] == "'" + studio
    stored = find_enquiry(c, reference)
    assert stored and stored["studio"] == studio


def test_private_fields(browser: Browser, app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    marker = f"PRIVATE-{tag()}"
    floor = 123_456
    month = fresh_month(c, 2)
    e = intake(c)
    saved = act(c, e["id"], "", {"triage_notes": marker, "fit_score": 5, "rate_floor_cents": floor}, "PATCH")
    assert saved.status_code == 200
    assert act(c, e["id"], "/transition", {"to": "qualified"}).status_code == 200
    pname, pemail = person("private")
    sent = act(c, e["id"], "/proposal", {"producer_name": pname, "producer_email": pemail, "project_title": "Quiet",
                                         "scope": "Layers.", "fee_cents": 500_000, "production_month": month})
    assert sent.status_code == 201, describe(sent)
    token = sent.json()["enquiry"]["proposal"]["token"]
    assert accept(app_url, token).status_code == 201
    deposit = proposal(app_url, token).json()["deposit"]["amount_cents"]
    assert pay(app_url, token, idempotency_key(), deposit).status_code == 200
    leaks = (marker, "SEED-PRIVATE-NOTE", money(floor), "1234.56")
    api = proposal(app_url, token)
    assert not {"triage_notes", "fit_score", "rate_floor_cents"} & set(api.json())
    for blob in (api.text, httpx.get(f"{app_url}/api/journey", timeout=HTTP_TIMEOUT).text,
                 listen(app_url, SEED_LINK_TOKEN).text):
        assert not any(leak in blob for leak in leaks)
    for message in inbox(mail, pemail, count=3) + inbox(mail, e["email"]):
        assert not any(leak in body_of(message) for leak in leaks), message["Subject"]
    with open_app(browser, f"{app_url}/p/{token}") as page:
        expect(page.get_by_role("heading", name=f"Proposal {e['reference']}", exact=True)).to_be_visible(
            timeout=REAL_GRACE_MS * 2)
        assert not any(leak in page.content() for leak in leaks)


def test_stale_console_saves(app_url: str) -> None:
    c = operator(app_url)
    e = intake(c)
    eid = e["id"]
    path = f"/api/console/enquiries/{eid}"
    assert_error(c.patch(path, json={"triage_notes": "x"}), 428, "precondition_required")
    for stale in ("*", '"999"'):
        body = assert_error(c.patch(path, json={"triage_notes": "x"}, headers={"If-Match": stale}), 412, "stale_version")
        assert body["current"]["version"] == 1
    _, etag = current(c, eid)

    def save(i: int) -> httpx.Response:
        return c.patch(path, json={"triage_notes": f"tab {i}"}, headers={"If-Match": etag})

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        results = list(pool.map(save, range(8)))
    assert sorted(r.status_code for r in results) == [200] + [412] * 7
    winner = next(r for r in results if r.status_code == 200).json()["enquiry"]["triage_notes"]
    stored, new_etag = current(c, eid)
    assert stored["version"] == 2 and stored["triage_notes"] == winner
    assert new_etag == json.dumps(str(stored["version"]))
    month = fresh_month(c, 1)
    d = deal(c, month)
    before, old_etag = current(c, d["id"])
    assert accept(app_url, d["token"]).status_code == 201
    body = assert_error(c.patch(f"/api/console/enquiries/{d['id']}", json={"triage_notes": "late"},
                                headers={"If-Match": old_etag}), 412, "stale_version")
    assert body["current"]["status"] == "accepted" and body["current"]["version"] == before["version"] + 1
    assert_error(c.post(f"/api/console/enquiries/{d['id']}/transition", json={"to": "declined"},
                        headers={"If-Match": old_etag}), 412, "stale_version")
    after, _ = current(c, d["id"])
    assert after["status"] == "accepted" and after["triage_notes"] != "late"


def test_writable_fields(app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    e = intake(c)
    for key in ("status", "version", "reference", "name", "email", "studio", "brief", "preferred_month",
                "project_slug", "attachment", "proposal", "receipt", "received_at", "id", "colour"):
        body = assert_invalid(act(c, e["id"], "", {"triage_notes": "changed", key: "booked"}, "PATCH"), key)
        assert body["errors"][key] == "Field is not writable."
    stored, _ = current(c, e["id"])
    assert stored["version"] == 1 and stored["triage_notes"] != "changed" and stored["status"] == "new"
    assert_invalid(act(c, e["id"], "", {}, "PATCH"), "body")
    assert_invalid(act(c, e["id"], "/transition", {"to": "qualified", "status": "booked"}), "status")
    assert current(c, e["id"])[0]["status"] == "new"
    assert act(c, e["id"], "/transition", {"to": "qualified"}).status_code == 200
    month = fresh_month(c, 1)
    pname, pemail = person("mass")
    body = {"producer_name": pname, "producer_email": pemail, "project_title": "Mass", "scope": "Scope.",
            "fee_cents": SPLIT_FEE, "production_month": month, "status": "accepted"}
    assert_invalid(act(c, e["id"], "/proposal", body), "status")
    after, _ = current(c, e["id"])
    assert after["status"] == "qualified" and after["proposal"] is None and after["version"] == 2
    created = new_project(c)
    for key in ("id", "status", "stems"):
        assert_invalid(c.post("/api/console/projects", json={"slug": f"m-{tag()}", "title": "M", "credit_type": "jam",
                                                             "credit_line": "L", "role": "R", "blurb": "B.",
                                                             key: "published"}), key)
        assert_invalid(c.patch(f"/api/console/projects/{created['id']}", json={"title": "Changed", key: "published"}),
                       key)
    unchanged = project(c, created["id"])
    assert unchanged["status"] == "draft" and unchanged["title"] == created["title"]
    assert messages_to(mail, pemail) == []
    withdraw(c, created["id"])


def test_enquiry_paging(app_url: str) -> None:
    c = operator(app_url)
    for bad in ("0", "101", "2.5", "abc", ""):
        assert_invalid(c.get("/api/console/enquiries", params={"limit": bad}), "limit")
    assert_invalid(c.get("/api/console/enquiries", params={"status": "archived"}), "status")
    assert len(page_of_enquiries(c, limit=LIMIT_MAX)["enquiries"]) <= LIMIT_MAX
    assert len(page_of_enquiries(c)["enquiries"]) <= PAGE_SIZE
    mine = [intake(c)["reference"] for _ in range(5)]
    first = page_of_enquiries(c, limit=2)
    assert [r["reference"] for r in first["enquiries"]] == mine[:-3:-1]
    cursor = first["next_cursor"]
    assert cursor
    assert_invalid(c.get("/api/console/enquiries", params={"cursor": f"forged-{tag()}"}), "cursor")
    mid = next(i for i in range(len(cursor) // 2, len(cursor) - 1) if cursor[i] != cursor[i + 1])
    altered = cursor[:mid] + cursor[mid + 1] + cursor[mid] + cursor[mid + 2:]
    assert altered != cursor
    assert_invalid(c.get("/api/console/enquiries", params={"cursor": altered}), "cursor")
    assert_invalid(c.get("/api/console/enquiries", params={"cursor": cursor, "status": "new"}), "cursor")
    late = [intake(c)["reference"] for _ in range(2)]
    seen = [r["reference"] for r in first["enquiries"]]
    floor = ref_number(mine[0])
    while cursor:
        body = page_of_enquiries(c, limit=2, cursor=cursor)
        page_refs = [r["reference"] for r in body["enquiries"]]
        assert len(page_refs) <= 2
        seen += page_refs
        cursor = body["next_cursor"]
        if page_refs and ref_number(page_refs[-1]) <= floor:
            break
    assert len(seen) == len(set(seen)) and not set(late) & set(seen)
    numbers = [ref_number(r) for r in seen]
    assert numbers == sorted(numbers, reverse=True)
    assert set(mine) <= set(seen)
    month = fresh_month(c, 2)
    short = env_url("APP_MAILPIT_DOWN_SHORT_TTL_URL")
    d = deal(c, month, base=short)
    expires = parse_iso(d["enquiry"]["proposal"]["expires_at"])
    assert find_enquiry(c, d["reference"], "proposal_sent") is not None
    eventually(lambda: proposal(app_url, d["token"]).status_code == 410,
               min(EXPIRY_WAIT, (expires - datetime.now(timezone.utc)).total_seconds() + 30), "proposal expired")
    expired = find_enquiry(c, d["reference"], "expired")
    assert expired and expired["status"] == "expired"
    assert find_enquiry(c, d["reference"], "proposal_sent") is None
    expired_page = page_of_enquiries(c, status="expired", limit=1)
    if expired_page["next_cursor"]:
        assert_invalid(c.get("/api/console/enquiries", params={"cursor": expired_page["next_cursor"]}), "cursor")


def test_wf_enquiry_triage_paging(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    while page_of_enquiries(c, limit=2 * PAGE_SIZE)["next_cursor"] is None:
        intake(c)
    with console_page(browser, app_url, "Enquiries") as page:
        rows = page.get_by_role("list", name="Enquiries", exact=True).get_by_role("listitem")
        expect(rows).to_have_count(PAGE_SIZE, timeout=REAL_GRACE_MS * 2)
        more = page.get_by_role("button", name="Show more enquiries", exact=True)
        click(more)
        expect(rows).to_have_count(2 * PAGE_SIZE, timeout=REAL_GRACE_MS * 2)
        expect(more).to_be_focused()
        buttons = page.get_by_role("button", name=re.compile(r"^Open ENQ-\d{6}$"))
        before_count = buttons.count()
        shown = [r["reference"] for r in page_of_enquiries(c, limit=2 * PAGE_SIZE)["enquiries"]]
        anchor = page.get_by_role("button", name=f"Open {shown[PAGE_SIZE + 5]}", exact=True)
        expect(anchor).to_have_count(1)
        anchor.scroll_into_view_if_needed()
        advance(page, FRAME_MS)
        box0 = anchor.bounding_box()
        assert box0
        fresh = send_brief(high()).json()["reference"]
        live(page, lambda: expect(page.get_by_role("button", name=f"Open {fresh}", exact=True)).to_have_count(
            1, timeout=REAL_GRACE_MS), LIVE_MS)

        def kept_place() -> bool:
            box1 = anchor.bounding_box()
            return bool(box1) and abs(box1["y"] - box0["y"]) <= 1

        wait_for(page, kept_place)
        for reference in [fresh, *shown]:
            expect(page.get_by_role("button", name=f"Open {reference}", exact=True)).to_have_count(1)
        assert buttons.count() == before_count + 1
        assert fresh in (rows.first.text_content() or "")


def test_milestone_split(app_url: str) -> None:
    c = operator(app_url)

    def preview(fee: Any) -> httpx.Response:
        return c.post("/api/console/milestones/preview", json={"fee_cents": fee})

    example = preview(SPLIT_FEE).json()["milestones"]
    assert [m["amount_cents"] for m in example] == SPLIT_EXAMPLE
    assert [(m["number"], m["name"], m["percent"]) for m in example] == list(
        zip(range(1, 5), MILESTONE_NAMES, MILESTONE_PERCENTS))
    for fee in (FEE_MIN, FEE_MIN + 1, SMALL_DEPOSIT_FEE, 333_333, 1_000_001, 77_777_777, FEE_MAX):
        amounts = [m["amount_cents"] for m in preview(fee).json()["milestones"]]
        assert amounts == split(fee) and sum(amounts) == fee
    for bad in (FEE_MIN - 1, FEE_MAX + 1, 800000.5, "800000", True, None):
        assert_invalid(preview(bad), "fee_cents")


def test_proposal_rules(app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 2)
    closed = fresh_month(c, 0)
    e = intake(c)
    pname, pemail = person("producer")
    title = f"Score {tag()}"
    body = {"producer_name": pname, "producer_email": pemail, "project_title": title,
            "scope": "Four layers.", "fee_cents": 500_000, "production_month": month}
    assert_error(act(c, e["id"], "/proposal", body), 409, "illegal_transition")
    assert act(c, e["id"], "", {"rate_floor_cents": 500_000}, "PATCH").status_code == 200
    assert act(c, e["id"], "/transition", {"to": "qualified"}).status_code == 200
    for field, value in (("fee_cents", 499_999), ("fee_cents", FEE_MIN - 1), ("fee_cents", FEE_MAX + 1),
                         ("fee_cents", "500000"), ("production_month", closed), ("production_month", "2001-01"),
                         ("producer_email", f"Ann <{pemail}>"), ("producer_email", f"{pemail}, x@y.example"),
                         ("producer_name", "A\nB"), ("scope", ""), ("project_title", "x" * (TEXT_MAX + 1))):
        assert_invalid(act(c, e["id"], "/proposal", {**body, field: value}), field)
    assert current(c, e["id"])[0]["version"] == 3
    response = act(c, e["id"], "/proposal", body)
    assert response.status_code == 201, describe(response)
    sent = response.json()["enquiry"]
    assert sent["status"] == "proposal_sent" and sent["version"] == 4
    p = sent["proposal"]
    assert [m["amount_cents"] for m in p["milestones"]] == split(500_000) and p["email"] in ("sent", "pending")
    assert p["production_month"] == month and p["url"].endswith(f"/p/{p['token']}")
    emails = inbox(mail, pemail)
    assert len(emails) == 1
    message = emails[0]
    assert message["Subject"] == f"Proposal {e['reference']} from Kettlehole Audio: {title}"
    assert message["To"][0]["Name"] == pname
    content = body_of(message)
    assert f"/p/{p['token']}" in content and written(parse_iso(p["expires_at"]), zone(c)) in content
    assert all(money(a) in content for a in split(500_000))
    assert_error(act(c, e["id"], "/proposal", body), 409, "illegal_transition")


def test_proposal_page_and_expiry(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    month = fresh_month(c, 3)
    label = month_label(month)
    d = deal(c, month)
    preview = c.post("/api/console/milestones/preview", json={"fee_cents": SPLIT_FEE}).json()["milestones"]
    data = proposal(app_url, d["token"]).json()
    assert data["milestones"] == preview and data["fee_cents"] == SPLIT_FEE and data["currency"] == "USD"
    assert data["production_month"] == month and data["production_month_label"] == label
    assert data["status"] == "proposal_sent" and data["month_open"] is True and data["deposit"] is None
    with open_app(browser, f"{app_url}/p/{d['token']}") as page:
        expect(page.get_by_role("heading", name=f"Proposal {d['reference']}", exact=True)).to_be_visible(
            timeout=REAL_GRACE_MS * 2)
        table = page.get_by_role("table", name="Milestones", exact=True)
        for name, percent, amount in zip(MILESTONE_NAMES, MILESTONE_PERCENTS, SPLIT_EXAMPLE):
            row = table.get_by_role("row").filter(has_text=name)
            expect(row).to_contain_text(f"{percent}%")
            expect(row).to_contain_text(money(amount))
        expect(page.get_by_text(money(SPLIT_FEE)).first).to_be_visible()
        expect(page.get_by_role("button", name=f"Accept and hold {label}", exact=True)).to_be_visible()
    short = env_url("APP_MAILPIT_DOWN_SHORT_TTL_URL")
    s = deal(c, month, base=short)
    expires = parse_iso(s["enquiry"]["proposal"]["expires_at"])
    assert proposal(app_url, s["token"]).status_code == 200
    eventually(lambda: proposal(app_url, s["token"]).status_code == 410,
               min(EXPIRY_WAIT, (expires - datetime.now(timezone.utc)).total_seconds() + 30), "proposal TTL passed")
    assert_error(proposal(app_url, s["token"]), 410, "proposal_expired")
    for base in (app_url, short):
        assert_error(accept(base, s["token"]), 410, "proposal_expired")
    with open_app(browser, f"{app_url}/p/{s['token']}") as page:
        expect(proposal_status(page)).to_have_text("This proposal has expired. Ask Kettlehole Audio for a new one.",
                                                   timeout=REAL_GRACE_MS * 2)
        expect(page.get_by_role("button", name=f"Accept and hold {label}", exact=True)).to_have_count(0)
    closed = deal(c, month)
    assert act(c, closed["id"], "/transition", {"to": "declined"}).status_code == 200
    assert_error(proposal(app_url, closed["token"]), 410, "proposal_closed")
    assert_error(accept(app_url, closed["token"]), 410, "proposal_closed")
    assert month_row(c, month)["claimed"] == 0


def test_production_months(app_url: str) -> None:
    c = operator(app_url)
    month = fresh_month(c, 2)
    for bad in (-1, CAPACITY_MAX + 1, 2.5, "2"):
        assert_invalid(c.put(f"/api/console/months/{month}", json={"capacity": bad}), "capacity")
    for path in ("2026-13", "garbage", "2001-01"):
        assert c.put(f"/api/console/months/{path}", json={"capacity": 1}).status_code == 422
    now = datetime.now(ZoneInfo(zone(c)))
    this = f"{now.year}-{now.month:02d}"
    last = f"{now.year - 1}-12" if now.month == 1 else f"{now.year}-{now.month - 1:02d}"
    assert c.put(f"/api/console/months/{last}", json={"capacity": 1}).status_code == 422
    existing = {r["month"]: r for r in c.get("/api/console/months").json()["months"]}
    keep = existing[this]["capacity"] if this in existing else 0
    row = c.put(f"/api/console/months/{this}", json={"capacity": keep})
    assert row.status_code == 200 and row.json()["month"]["label"] == month_label(this)
    d = deal(c, month)
    assert accept(app_url, d["token"]).status_code == 201
    assert_invalid(c.put(f"/api/console/months/{month}", json={"capacity": 0}), "capacity")
    assert month_row(c, month) == {"month": month, "label": month_label(month), "capacity": 2, "claimed": 1,
                                   "open": True}
    response = c.put(f"/api/console/months/{month}", json={"capacity": 1})
    assert response.status_code == 200 and response.json()["month"]["open"] is False
    assert month not in public_months(app_url)


def test_wf_proposal_building_send(browser: Browser, app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 2)
    label = month_label(month)
    e = intake(c)
    assert act(c, e["id"], "", {"rate_floor_cents": 400_000}, "PATCH").status_code == 200
    assert act(c, e["id"], "/transition", {"to": "qualified"}).status_code == 200
    pname, pemail = person("builder")
    title = f"Score {tag()}"
    with console_page(browser, app_url, "Enquiries") as page:
        open_row(page, e["reference"])
        click(page.get_by_role("button", name="Build proposal", exact=True))
        dialog = page.get_by_role("dialog", name="Build proposal", exact=True)
        fill(dialog.get_by_role("textbox", name="Producer name", exact=True), pname)
        fill(dialog.get_by_role("textbox", name="Producer email", exact=True), pemail)
        fill(dialog.get_by_role("textbox", name="Project title", exact=True), title)
        fill(dialog.get_by_role("textbox", name="Scope", exact=True), "Four adaptive layers.")
        select(dialog.get_by_role("combobox", name="Production month", exact=True), label)
        fee = dialog.get_by_role("textbox", name="Fee (USD)", exact=True)
        send = dialog.get_by_role("button", name="Send proposal", exact=True)
        floor_copy = f"Below your rate floor of {money(400_000)}."
        fill(fee, "3999.99")
        advance(page, PREVIEW_MS)
        try:
            wait_for(page, lambda: floor_copy in (dialog.text_content() or ""), REAL_GRACE_MS / 1000)
        except AssertionError:
            click(send)
            wait_for(page, lambda: floor_copy in (dialog.text_content() or ""))
        assert current(c, e["id"])[0]["status"] == "qualified"
        fill(fee, "4999.99")
        advance(page, PREVIEW_MS)
        table = dialog.get_by_role("table", name="Milestone preview", exact=True)
        for amount in SPLIT_EXAMPLE:
            expect(table).to_contain_text(money(amount), timeout=REAL_GRACE_MS)
        click(send)
        expect(console_status(page)).to_have_text(proposal_saved(pemail), timeout=REAL_GRACE_MS * 2)
        sent_row = page.get_by_role("list", name="Enquiries", exact=True).get_by_role("listitem").filter(
            has_text=e["reference"])
        live(page, lambda: expect(sent_row).to_contain_text("Proposal sent", timeout=REAL_GRACE_MS), LIVE_MS)
    stored, _ = current(c, e["id"])
    assert stored["status"] == "proposal_sent" and stored["proposal"]["fee_cents"] == SPLIT_FEE
    message = inbox(mail, pemail)
    assert len(message) == 1 and f"/p/{stored['proposal']['token']}" in body_of(message[0])


def test_wf_proposal_building_live_month(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    month, spare = fresh_month(c, 1), fresh_month(c, 2)
    label, spare_label = month_label(month), month_label(spare)
    blocker = deal(c, month)
    e = intake(c)
    assert act(c, e["id"], "/transition", {"to": "qualified"}).status_code == 200
    full_copy = f"{label} is now full. Choose another production month."
    producer_email = person("live")[1]
    with console_page(browser, app_url, "Enquiries") as page:
        open_row(page, e["reference"])
        click(page.get_by_role("button", name="Build proposal", exact=True))
        dialog = page.get_by_role("dialog", name="Build proposal", exact=True)
        fill(dialog.get_by_role("textbox", name="Producer name", exact=True), "Rowan Live")
        fill(dialog.get_by_role("textbox", name="Producer email", exact=True), producer_email)
        fill(dialog.get_by_role("textbox", name="Project title", exact=True), "Live month")
        fill(dialog.get_by_role("textbox", name="Fee (USD)", exact=True), "4999.99")
        months = dialog.get_by_role("combobox", name="Production month", exact=True)
        select(months, label)
        scope = dialog.get_by_role("textbox", name="Scope", exact=True)
        fill(scope, "Layers.")
        send = dialog.get_by_role("button", name="Send proposal", exact=True)
        expect(send).to_be_enabled()
        assert accept(app_url, blocker["token"]).status_code == 201
        live(page, lambda: expect(send).to_be_disabled(timeout=REAL_GRACE_MS), LIVE_MS)
        expect(months).to_have_accessible_description(full_copy)
        expect(scope).to_be_focused()
        expect(scope).to_have_value("Layers.")
        assert option_count(page, months, f"{label} (full)") == 1
        select(months, spare_label)
        expect(send).to_be_enabled()
        expect(dialog.get_by_text(full_copy)).to_have_count(0)
        assert c.put(f"/api/console/months/{month}", json={"capacity": 2}).status_code == 200

        def reopened() -> None:
            deadline = time.monotonic() + REAL_GRACE_MS / 1000
            while option_count(page, months, label) != 1:
                assert time.monotonic() < deadline, f"{label} not offered again"
                threading.Event().wait(POLL_SECONDS / 5)

        live(page, reopened, LIVE_MS)
        select(months, label)
        expect(send).to_be_enabled()
        expect(dialog.get_by_text(full_copy)).to_have_count(0)
        click(send)
        expect(console_status(page)).to_have_text(proposal_saved(producer_email), timeout=REAL_GRACE_MS * 2)
    assert current(c, e["id"])[0]["proposal"]["production_month"] == month


def test_wf_proposal_acceptance_happy(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 2)
    label = month_label(month)
    d = deal(c, month)
    with open_app(browser, f"{app_url}/p/{d['token']}") as page:
        button = page.get_by_role("button", name=f"Accept and hold {label}", exact=True)
        expect(button).to_be_visible(timeout=REAL_GRACE_MS * 2)
        click(button)
        expect(proposal_status(page)).to_have_text(f"{label} is held. Pay the deposit to confirm it.",
                                                   timeout=REAL_GRACE_MS * 4)
        region = page.get_by_role("region", name="Deposit invoice", exact=True)
        expect(region).to_contain_text(f"Deposit {money(SPLIT_EXAMPLE[0])}")
        found = re.search(r"Invoice (\d+)", region.text_content() or "")
        assert found
        number = found.group(1)
    stored, _ = current(c, d["id"])
    assert stored["status"] == "accepted" and month_row(c, month)["claimed"] == 1
    account = account_of(killbill, d["reference"])
    assert account["name"] == d["producer_name"] and account["email"].lower() == d["producer_email"].lower()
    assert account["company"] == d["studio"] and account["currency"] == "USD"
    deposits = described(account["accountId"], milestone_description(1, d["reference"]))
    assert len(deposits) == 1 and str(deposits[0]["invoiceNumber"]) == number
    assert cents(deposits[0]["amount"]) == SPLIT_EXAMPLE[0]
    held_mail = inbox(mail, d["producer_email"], subject=f"{label} held for {d['title']}: deposit due")
    assert len(held_mail) == 1


def test_wf_proposal_acceptance_two_tabs(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 1)
    label = month_label(month)
    d = deal(c, month)
    url = f"{app_url}/p/{d['token']}"
    button_name = f"Accept and hold {label}"
    with open_app(browser, url) as tab_a, open_app(browser, url) as tab_b, open_app(browser, url) as tab_c, \
            console_page(browser, app_url, "Months") as console, open_app(browser, app_url) as journey:
        for tab in (tab_a, tab_b, tab_c):
            expect(tab.get_by_role("button", name=button_name, exact=True)).to_be_visible(timeout=REAL_GRACE_MS * 2)
        enter(journey)
        select(brief_form(journey).get_by_role("combobox", name="Preferred production month", exact=True), label)
        row = console.get_by_role("table", name="Production months", exact=True).get_by_role("row").filter(has_text=label)
        expect(row.get_by_role("cell").last).to_have_text("0", timeout=REAL_GRACE_MS * 2)
        focus_before = tab_b.evaluate_handle("() => document.activeElement")
        click(tab_a.get_by_role("button", name=button_name, exact=True))
        expect(proposal_status(tab_a)).to_have_text(f"{label} is held. Pay the deposit to confirm it.",
                                                    timeout=REAL_GRACE_MS * 4)
        region = tab_a.get_by_role("region", name="Deposit invoice", exact=True)
        expect(region).to_contain_text(f"Deposit {money(SPLIT_EXAMPLE[0])}")
        found = re.search(r"Invoice (\d+)", region.text_content() or "")
        assert found
        number = found.group(1)
        click(tab_c.get_by_role("button", name=button_name, exact=True))
        expect(proposal_status(tab_c)).to_have_text(
            "This proposal has already been accepted. The deposit invoice is below.", timeout=REAL_GRACE_MS * 4)
        expect(tab_c.get_by_role("region", name="Deposit invoice", exact=True)).to_contain_text(f"Invoice {number}")
        live(tab_b, lambda: expect(proposal_status(tab_b)).to_have_text(
            "This proposal has already been accepted. The deposit invoice is below.", timeout=REAL_GRACE_MS), LIVE_MS)
        expect(tab_b.get_by_role("region", name="Deposit invoice", exact=True)).to_contain_text(f"Invoice {number}")
        expect(tab_b.get_by_role("button", name=button_name, exact=True)).to_have_count(0)
        assert tab_b.evaluate("(el) => document.activeElement === el", focus_before)
        live(console, lambda: expect(row.get_by_role("cell").last).to_have_text("1", timeout=REAL_GRACE_MS), LIVE_MS)
        live(journey, lambda: expect(brief_status(journey)).to_have_text(
            f"{label} is now fully booked. Choose another month or No preference.", timeout=REAL_GRACE_MS), LIVE_MS)
    stored, _ = current(c, d["id"])
    assert stored["status"] == "accepted" and month_row(c, month)["claimed"] == 1
    account = account_of(killbill, d["reference"])
    assert account["name"] == d["producer_name"] and account["email"].lower() == d["producer_email"].lower()
    assert account["company"] == d["studio"] and account["currency"] == "USD" and account["timeZone"] == zone(c)
    assert "external" in (killbill.default_plugin(account["accountId"]) or "").lower()
    deposits = described(account["accountId"], milestone_description(1, d["reference"]))
    assert len(deposits) == 1 and str(deposits[0]["invoiceNumber"]) == number
    assert cents(deposits[0]["amount"]) == SPLIT_EXAMPLE[0]
    held_mail = inbox(mail, d["producer_email"], subject=f"{label} held for {d['title']}: deposit due")
    assert len(held_mail) == 1 and f"/p/{d['token']}" in body_of(held_mail[0])


def test_wf_proposal_acceptance_month_taken(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 1)
    label = month_label(month)
    winner, loser = deal(c, month), deal(c, month)
    with open_app(browser, f"{app_url}/p/{loser['token']}") as page:
        button = page.get_by_role("button", name=f"Accept and hold {label}", exact=True)
        expect(button).to_be_visible(timeout=REAL_GRACE_MS * 2)
        assert accept(app_url, winner["token"]).status_code == 201
        click(button)
        expect(proposal_status(page)).to_have_text(
            f"{label} has just been booked by another production. Ask Kettlehole Audio for another month.",
            timeout=REAL_GRACE_MS * 4)
        expect(button).to_have_count(0)
    assert current(c, loser["id"])[0]["status"] == "proposal_sent"
    assert killbill.account_by_key(f"earshot-{loser['reference']}") is None
    assert month_row(c, month)["claimed"] == 1
    assert [m for m in messages_to(mail, loser["producer_email"]) if "held for" in m["Subject"]] == []


def test_last_open_month(browser: Browser, app_url: str, killbill: KillBill) -> None:
    c = operator(app_url)
    month = fresh_month(c, 2)
    deals = [deal(c, month) for _ in range(4)]
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda d: (d, accept(app_url, d["token"])), deals))
    winners = [d for d, r in results if r.status_code == 201]
    losers = [(d, r) for d, r in results if r.status_code != 201]
    assert len(winners) == 2 and len(losers) == 2, [r.status_code for _, r in results]
    for d, response in losers:
        assert assert_error(response, 409, "month_taken")["month"] == month
        assert current(c, d["id"])[0]["status"] == "proposal_sent"
        account = killbill.account_by_key(f"earshot-{d['reference']}")
        assert account is None or live_invoices(account["accountId"]) == []
    assert month_row(c, month)["claimed"] == 2 and month not in public_months(app_url)
    with open_app(browser, f"{app_url}/p/{losers[0][0]['token']}") as page:
        expect(proposal_status(page)).to_have_text(
            f"{month_label(month)} has just been booked by another production. Ask Kettlehole Audio for another month.",
            timeout=REAL_GRACE_MS * 2)
    race = fresh_month(c, 2)
    first, second = deal(c, race), deal(c, race)
    assert accept(app_url, first["token"]).status_code == 201
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        cut = pool.submit(lambda: c.put(f"/api/console/months/{race}", json={"capacity": 1}))
        late = pool.submit(lambda: accept(app_url, second["token"]))
        cut_r, late_r = cut.result(), late.result()
    row = month_row(c, race)
    if late_r.status_code == 201:
        assert_invalid(cut_r, "capacity")
        assert row["capacity"] == 2 and row["claimed"] == 2
    else:
        assert cut_r.status_code == 200
        assert_error(late_r, 409, "month_taken")
        assert row["capacity"] == 1 and row["claimed"] == 1
    assert row["claimed"] <= row["capacity"]


def test_acceptance_all_or_nothing(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 2)
    d = deal(c, month)
    key = f"earshot-{d['reference']}"
    account = kb_account(killbill, key, d["producer_name"], d["producer_email"])
    description = milestone_description(1, d["reference"])
    orphan = kb_charge(account["accountId"], SPLIT_EXAMPLE[0], description)
    response = accept(app_url, d["token"])
    assert response.status_code == 201, describe(response)
    assert kb_invoice_on(account["accountId"], orphan)["status"] == "VOID"
    reused = killbill.account_by_key(key)
    assert reused and reused["accountId"] == account["accountId"]
    deposits = described(account["accountId"], description)
    assert len(deposits) == 1 and deposits[0]["invoiceId"] != orphan
    assert str(deposits[0]["invoiceNumber"]) == str(response.json()["deposit"]["invoice_number"])
    assert month_row(c, month)["claimed"] == 1
    full = fresh_month(c, 1)
    taken, waiting = deal(c, full), deal(c, full)
    assert accept(app_url, taken["token"]).status_code == 201
    before, _ = current(c, waiting["id"])
    assert_error(accept(app_url, waiting["token"]), 409, "month_taken")
    after, _ = current(c, waiting["id"])
    assert after["status"] == "proposal_sent" and after["version"] == before["version"]
    assert killbill.account_by_key(f"earshot-{waiting['reference']}") is None
    assert month_row(c, full)["claimed"] == 1
    assert [m for m in messages_to(mail, waiting["producer_email"]) if "held for" in m["Subject"]] == []
    assert c.put(f"/api/console/months/{full}", json={"capacity": 2}).status_code == 200
    assert accept(app_url, waiting["token"]).status_code == 201
    assert month_row(c, full)["claimed"] == 2
    assert len(inbox(mail, waiting["producer_email"],
                     subject=f"{month_label(full)} held for {waiting['title']}: deposit due")) == 1


def test_double_acceptance(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 3)
    d = deal(c, month)
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        results = list(pool.map(lambda _: accept(app_url, d["token"]), range(6)))
    assert sorted(r.status_code for r in results) == [201] + [409] * 5
    for response in results:
        if response.status_code == 409:
            body = assert_error(response, 409, "illegal_transition")
            assert body["from"] in ("accepted", "deposit_paid", "booked") and body["to"] == "accepted"
    assert month_row(c, month)["claimed"] == 1
    account = account_of(killbill, d["reference"])
    by_email = killbill.account(d["producer_email"])
    assert by_email and by_email["accountId"] == account["accountId"]
    assert len(described(account["accountId"], milestone_description(1, d["reference"]))) == 1
    numbers = {proposal(app_url, d["token"]).json()["deposit"]["invoice_number"] for _ in range(3)}
    assert len(numbers) == 1
    held_mail = inbox(mail, d["producer_email"], subject=f"{month_label(month)} held for {d['title']}: deposit due")
    assert len(held_mail) == 1


def test_month_count_everywhere(app_url: str) -> None:
    c = operator(app_url)
    month = fresh_month(c, 3)
    deals = [deal(c, month) for _ in range(5)]
    a, b, d3, waiting, dropped = deals
    assert act(c, dropped["id"], "/transition", {"to": "declined"}).status_code == 200
    assert accept(app_url, a["token"]).status_code == 201
    assert month_row(c, month)["claimed"] == 1
    for item in (b, d3):
        assert accept(app_url, item["token"]).status_code == 201
        dep = proposal(app_url, item["token"]).json()["deposit"]["amount_cents"]
        assert pay(app_url, item["token"], idempotency_key(), dep).status_code == 200
    assert act(c, d3["id"], "/transition", {"to": "booked"}).status_code == 200
    row = month_row(c, month)
    assert row["claimed"] == 3 and row["open"] is False
    assert month not in public_months(app_url)
    assert proposal(app_url, waiting["token"]).json()["month_open"] is False
    assert_invalid(send_brief(high(), extra={"preferred_month": month}), "preferred_month")
    q = intake(c)
    assert act(c, q["id"], "/transition", {"to": "qualified"}).status_code == 200
    assert_invalid(act(c, q["id"], "/proposal", {"producer_name": "P", "producer_email": person("p")[1],
                                                 "project_title": "T", "scope": "S.", "fee_cents": SPLIT_FEE,
                                                 "production_month": month}), "production_month")
    assert c.put(f"/api/console/months/{month}", json={"capacity": 4}).status_code == 200
    row = month_row(c, month)
    assert row["claimed"] == 3 and row["open"] is True
    assert month in public_months(app_url)
    assert proposal(app_url, waiting["token"]).json()["month_open"] is True


def test_deposit_idempotency(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 3)
    d = accepted(c, month)
    amount = d["deposit"]["amount_cents"]
    assert_invalid(pay(app_url, d["token"], None, amount), "Idempotency-Key")
    assert_invalid(pay(app_url, d["token"], "x" * (KEY_MAX + 1), amount), "Idempotency-Key")
    assert_invalid(pay(app_url, d["token"], idempotency_key(), amount + 1), "amount_cents")
    account = account_of(killbill, d["reference"])
    assert purchases(killbill, account["accountId"]) == []
    key = idempotency_key()
    first = pay(app_url, d["token"], key, amount)
    assert first.status_code == 200, describe(first)
    body = first.json()
    assert body["status"] == "deposit_paid" and body["amount_cents"] == amount and body["payment_id"]
    second = pay(app_url, d["token"], key, amount)
    assert second.status_code == 200 and second.json() == body
    assert_error(pay(app_url, d["token"], key, amount, payer="Someone Else"), 409, "idempotency_conflict")
    late = assert_error(pay(app_url, d["token"], idempotency_key(), amount), 409, "illegal_transition")
    assert late["from"] == "deposit_paid"
    made = purchases(killbill, account["accountId"])
    assert len(made) == 1 and cents(made[0][1]["amount"]) == amount
    assert made[0][1]["transactionExternalKey"] == f"earshot-{d['reference']}-deposit"
    subject = f"Deposit received: {month_label(month)} confirmed for {d['title']}"
    assert len(inbox(mail, d["producer_email"], subject=subject)) == 1
    for racer_keys in ([idempotency_key(), idempotency_key()], [idempotency_key()] * 3):
        r = accepted(c, month)
        with concurrent.futures.ThreadPoolExecutor(len(racer_keys)) as pool:
            outcomes = list(pool.map(lambda k: pay(app_url, r["token"], k, r["deposit"]["amount_cents"]), racer_keys))
        oks = [o for o in outcomes if o.status_code == 200]
        assert oks and len({json.dumps(o.json(), sort_keys=True) for o in oks}) == 1
        for o in outcomes:
            if o.status_code != 200:
                expected = "illegal_transition" if len(set(racer_keys)) > 1 else "request_in_progress"
                assert_error(o, 409, expected)
        assert len(purchases(killbill, account_of(killbill, r["reference"])["accountId"])) == 1


def test_exact_deposit_money(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 3)
    for fee, expected in ((SMALL_DEPOSIT_FEE, SMALL_DEPOSIT), (FEE_MAX, LARGE_DEPOSIT)):
        d = accepted(c, month, fee)
        dep = proposal(app_url, d["token"]).json()["deposit"]
        assert (dep["amount_cents"], dep["balance_cents"], dep["paid"], dep["billing"]) == (expected, expected, False, "live")
        account = account_of(killbill, d["reference"])
        invoice_body = described(account["accountId"], milestone_description(1, d["reference"]))[0]
        assert cents(invoice_body["amount"]) == expected
        assert pay(app_url, d["token"], idempotency_key(), expected).status_code == 200
        made = purchases(killbill, account["accountId"])
        assert len(made) == 1 and cents(made[0][1]["amount"]) == expected
        after = proposal(app_url, d["token"]).json()["deposit"]
        assert after["balance_cents"] == 0 and after["paid"] is True and after["amount_cents"] == expected
    d = accepted(c, month)
    amount = d["deposit"]["amount_cents"]
    account = account_of(killbill, d["reference"])
    target = described(account["accountId"], milestone_description(1, d["reference"]))[0]
    kb_pay_invoice(account["accountId"], target["invoiceId"], amount)
    existing = purchases(killbill, account["accountId"])
    assert len(existing) == 1
    response = pay(app_url, d["token"], idempotency_key(), amount)
    assert response.status_code == 200, describe(response)
    assert response.json()["payment_id"] == existing[0][0]["paymentId"]
    assert len(purchases(killbill, account["accountId"])) == 1
    assert current(c, d["id"])[0]["status"] == "deposit_paid"
    subject = f"Deposit received: {month_label(month)} confirmed for {d['title']}"
    assert len(inbox(mail, d["producer_email"], subject=subject)) == 1


def test_honest_payment_state(browser: Browser, app_url: str, killbill: KillBill) -> None:
    c = operator(app_url)
    month = fresh_month(c, 1)
    d = accepted(c, month)
    label = month_label(month)
    paid_copy = f"Deposit received. {label} is confirmed. A confirmation email will follow."
    with open_app(browser, f"{app_url}/p/{d['token']}") as page:
        fill(page.get_by_role("textbox", name="Name on payment", exact=True), "Rowan Producer")
        button = page.get_by_role("button", name="Pay deposit", exact=True)
        with held(page, "**/deposit") as gate_:
            click(button)
            expect(proposal_status(page)).to_have_text("Recording payment…", timeout=REAL_GRACE_MS)
            expect(button).to_be_disabled()
            gate_.release()
        expect(proposal_status(page)).to_have_text(paid_copy, timeout=REAL_GRACE_MS * 4)
    d2 = accepted(c, fresh_month(c, 1))
    keys: list[str | None] = []
    with open_app(browser, f"{app_url}/p/{d2['token']}") as page:
        page.route("**/deposit", lambda route: (keys.append(route.request.headers.get("idempotency-key")),
                                                route.abort("connectionreset")))
        fill(page.get_by_role("textbox", name="Name on payment", exact=True), "Rowan Producer")
        button = page.get_by_role("button", name="Pay deposit", exact=True)
        click(button)
        expect(proposal_status(page)).to_have_text("Connection lost. Retrying with the same payment…",
                                                   timeout=REAL_GRACE_MS * 2)
        for attempt in range(RETRY_ATTEMPTS):
            assert "Deposit received." not in (proposal_status(page).text_content() or "")
            target = attempt + 2
            elapsed = 0.0
            while len(keys) < target:
                assert elapsed <= RETRY_MS * 3, (attempt, len(keys))
                advance(page, STEP_MS)
                elapsed += STEP_MS
        expect(proposal_status(page)).to_have_text(
            "We couldn't confirm the payment. Press Pay deposit to check again. You won't be charged twice.",
            timeout=REAL_GRACE_MS * 2)
        expect(button).to_be_enabled()
        assert len(keys) == 1 + RETRY_ATTEMPTS and len(set(keys)) == 1 and keys[0]
        assert purchases(killbill, account_of(killbill, d2["reference"])["accountId"]) == []
        page.unroute("**/deposit")
        click(button)
        expect(proposal_status(page)).to_contain_text("Deposit received.", timeout=REAL_GRACE_MS * 4)
        expect(button).to_have_count(0)
    assert len(purchases(killbill, account_of(killbill, d2["reference"])["accountId"])) == 1


def test_wf_deposit_payment_retry(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    c = operator(app_url)
    month = fresh_month(c, 1)
    label = month_label(month)
    d = accepted(c, month)
    keys: list[str | None] = []
    outcomes: list[int] = []

    def lose_first(route: Any) -> None:
        keys.append(route.request.headers.get("idempotency-key"))
        if len(keys) == 1:
            outcomes.append(route.fetch().status)
            route.abort("connectionreset")
        else:
            route.continue_()

    with open_app(browser, f"{app_url}/p/{d['token']}") as page:
        page.route("**/deposit", lose_first)
        expect(page.get_by_role("region", name="Deposit invoice", exact=True)).to_contain_text(
            f"Deposit {money(SPLIT_EXAMPLE[0])}", timeout=REAL_GRACE_MS * 2)
        fill(page.get_by_role("textbox", name="Name on payment", exact=True), "Rowan Producer")
        click(page.get_by_role("button", name="Pay deposit", exact=True))
        expect(proposal_status(page)).to_have_text("Connection lost. Retrying with the same payment…",
                                                   timeout=REAL_GRACE_MS * 4)
        advance(page, RETRY_MS)
        expect(proposal_status(page)).to_have_text(
            f"Deposit received. {label} is confirmed. A confirmation email will follow.", timeout=REAL_GRACE_MS * 4)
        expect(page.get_by_role("button", name="Pay deposit", exact=True)).to_have_count(0)
        expect(page.get_by_role("textbox", name="Name on payment", exact=True)).to_have_count(0)
    assert outcomes == [200] and len(keys) == 2 and keys[0] == keys[1]
    account = account_of(killbill, d["reference"])
    made = purchases(killbill, account["accountId"])
    assert len(made) == 1 and cents(made[0][1]["amount"]) == SPLIT_EXAMPLE[0]
    deposit_invoice = described(account["accountId"], milestone_description(1, d["reference"]))[0]
    assert cents(deposit_invoice["balance"]) == 0
    assert current(c, d["id"])[0]["status"] == "deposit_paid"
    subject = f"Deposit received: {label} confirmed for {d['title']}"
    assert len(inbox(mail, d["producer_email"], subject=subject)) == 1


def test_wf_deposit_payment_paid_on_load(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    month = fresh_month(c, 2)
    label = month_label(month)
    d = accepted(c, month)
    with open_app(browser, f"{app_url}/p/{d['token']}") as page:
        expect(page.get_by_role("button", name="Pay deposit", exact=True)).to_be_visible(timeout=REAL_GRACE_MS * 2)
        expect(proposal_status(page)).not_to_contain_text("Deposit received.")
    assert pay(app_url, d["token"], idempotency_key(), d["deposit"]["amount_cents"]).status_code == 200
    with open_app(browser, f"{app_url}/p/{d['token']}") as page:
        expect(proposal_status(page)).to_have_text(
            f"Deposit received. {label} is confirmed. A confirmation email will follow.", timeout=REAL_GRACE_MS * 2)
        expect(page.get_by_role("button", name="Pay deposit", exact=True)).to_have_count(0)
        expect(page.get_by_role("region", name="Deposit invoice", exact=True)).to_contain_text("Invoice ")


def test_start_production(app_url: str) -> None:
    c = operator(app_url)
    month = fresh_month(c, 3)
    e = intake(c)
    assert assert_error(act(c, e["id"], "/transition", {"to": "booked"}), 409, "illegal_transition")["from"] == "new"
    assert act(c, e["id"], "/transition", {"to": "qualified"}).status_code == 200
    assert_error(act(c, e["id"], "/transition", {"to": "booked"}), 409, "illegal_transition")
    sent = deal(c, month)
    assert_error(act(c, sent["id"], "/transition", {"to": "booked"}), 409, "illegal_transition")
    a = accepted(c, month)
    assert assert_error(act(c, a["id"], "/transition", {"to": "booked"}), 409, "illegal_transition")["from"] == "accepted"
    assert pay(app_url, a["token"], idempotency_key(), a["deposit"]["amount_cents"]).status_code == 200
    before, _ = current(c, a["id"])
    response = act(c, a["id"], "/transition", {"to": "booked"})
    assert response.status_code == 200 and response.json()["enquiry"]["status"] == "booked"
    assert response.json()["enquiry"]["version"] == before["version"] + 1
    assert assert_error(act(c, a["id"], "/transition", {"to": "booked"}), 409, "illegal_transition")["from"] == "booked"


def test_milestone_invoices(app_url: str, killbill: KillBill) -> None:
    c = operator(app_url)
    month = fresh_month(c, 1)
    d = paid(c, month)
    assert_error(invoice(c, d["id"], 2), 409, "illegal_transition")
    assert act(c, d["id"], "/transition", {"to": "booked"}).status_code == 200
    for n in (1, 5):
        assert invoice(c, d["id"], n).status_code == 404
    assert_error(invoice(c, d["id"], 3), 409, "milestone_out_of_order")
    account = account_of(killbill, d["reference"])
    for n in (2, 3, 4):
        response = invoice(c, d["id"], n)
        assert response.status_code == 201, describe(response)
        body = response.json()
        assert body["milestone"]["number"] == n and body["milestone"]["amount_cents"] == SPLIT_EXAMPLE[n - 1]
        assert n in body["enquiry"]["proposal"]["invoiced_milestones"]
        found = described(account["accountId"], milestone_description(n, d["reference"]))
        assert len(found) == 1 and cents(found[0]["amount"]) == SPLIT_EXAMPLE[n - 1]
        assert str(found[0]["invoiceNumber"]) == str(body["milestone"]["invoice_number"])
        assert item_of(found[0], milestone_description(n, d["reference"]))["startDate"] == body["milestone"]["invoice_date"]
        assert_error(invoice(c, d["id"], n), 409, "milestone_already_invoiced")
    invoices = live_invoices(account["accountId"])
    assert len(invoices) == 4 and sum(cents(i["amount"]) for i in invoices) == SPLIT_FEE
    assert sorted(current(c, d["id"])[0]["proposal"]["invoiced_milestones"]) == [2, 3, 4]


def test_milestone_invoice_once(app_url: str, killbill: KillBill) -> None:
    c = operator(app_url)
    month = fresh_month(c, 1)
    d = booked(c, month)
    account = account_of(killbill, d["reference"])["accountId"]
    _, etag = current(c, d["id"])
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        results = list(pool.map(lambda _: invoice(c, d["id"], 2, etag), range(6)))
    assert sorted(r.status_code for r in results) == [201] + [412] * 5
    assert len(described(account, milestone_description(2, d["reference"]))) == 1
    description3 = milestone_description(3, d["reference"])
    existing = kb_charge(account, SPLIT_EXAMPLE[2], description3)
    existing_body = kb_invoice_on(account, existing)
    held_date = item_of(existing_body, description3)["startDate"]
    response = invoice(c, d["id"], 3)
    assert response.status_code == 201, describe(response)
    assert str(response.json()["milestone"]["invoice_number"]) == str(existing_body["invoiceNumber"])
    assert response.json()["milestone"]["invoice_date"] == held_date
    assert len(described(account, description3)) == 1
    kb_charge(account, SPLIT_EXAMPLE[3] + 1, milestone_description(4, d["reference"]))
    before, _ = current(c, d["id"])
    assert_error(invoice(c, d["id"], 4), 409, "milestone_mismatch")
    after, _ = current(c, d["id"])
    assert after["version"] == before["version"] and 4 not in after["proposal"]["invoiced_milestones"]
    assert len(described(account, milestone_description(4, d["reference"]))) == 1


def test_business_dates_in_killbill(app_url: str, killbill: KillBill) -> None:
    c = operator(app_url)
    original = zone(c)
    hour = datetime.now(timezone.utc).hour
    chosen = "Pacific/Kiritimati" if hour >= 10 else "Pacific/Pago_Pago"

    def local_day() -> str:
        return datetime.now(ZoneInfo(chosen)).date().isoformat()

    set_zone(c, chosen)
    try:
        month = fresh_month(c, 1)
        d = deal(c, month)
        days = {local_day()}
        response = accept(app_url, d["token"])
        days.add(local_day())
        assert response.status_code == 201, describe(response)
        account = account_of(killbill, d["reference"])
        assert account["timeZone"] == chosen
        description1 = milestone_description(1, d["reference"])
        deposit_item = item_of(described(account["accountId"], description1)[0], description1)
        assert deposit_item["startDate"] in days
        assert response.json()["deposit"]["invoice_date"] == deposit_item["startDate"]
        assert pay(app_url, d["token"], idempotency_key(), response.json()["deposit"]["amount_cents"]).status_code == 200
        assert act(c, d["id"], "/transition", {"to": "booked"}).status_code == 200
        days = {local_day()}
        milestone = invoice(c, d["id"], 2)
        days.add(local_day())
        assert milestone.status_code == 201, describe(milestone)
        description2 = milestone_description(2, d["reference"])
        item = item_of(described(account["accountId"], description2)[0], description2)
        assert item["startDate"] in days and milestone.json()["milestone"]["invoice_date"] == item["startDate"]
    finally:
        set_zone(c, original)


def test_wf_milestone_invoicing_production(browser: Browser, app_url: str, killbill: KillBill) -> None:
    c = operator(app_url)
    month = fresh_month(c, 1)
    d = paid(c, month)
    operator_zone = ZoneInfo(zone(c))
    with console_page(browser, app_url, "Enquiries") as page:
        open_row(page, d["reference"])
        click(page.get_by_role("button", name="Start production", exact=True))
        expect(console_status(page)).to_have_text("Production started.", timeout=REAL_GRACE_MS * 2)
        for n in (2, 3, 4):
            item = milestone_item(page, n)
            expect(item).to_have_attribute("data-state", "not-invoiced")
            days = {written_day(datetime.now(operator_zone).date())}
            click(page.get_by_role("button", name=f"Invoice milestone {n}", exact=True))
            expect(console_status(page)).to_have_text(
                re.compile(rf"^Milestone {n} invoiced: {re.escape(money(SPLIT_EXAMPLE[n - 1]))} on .+\.$"),
                timeout=REAL_GRACE_MS * 4)
            days.add(written_day(datetime.now(operator_zone).date()))
            shown = re.search(r" on (.+)\.$", console_status(page).text_content() or "")
            assert shown and shown.group(1) in days
            expect(item).to_have_attribute("data-state", "invoiced")
            expect(item).to_have_text(f"Milestone {n}: {MILESTONE_NAMES[n - 1]}, {money(SPLIT_EXAMPLE[n - 1])}. Invoiced")
    assert current(c, d["id"])[0]["status"] == "booked"
    account = account_of(killbill, d["reference"])["accountId"]
    invoices = live_invoices(account)
    assert len(invoices) == 4 and sum(cents(i["amount"]) for i in invoices) == SPLIT_FEE
    for n in (2, 3, 4):
        assert len(described(account, milestone_description(n, d["reference"]))) == 1


def test_wf_milestone_invoicing_optimistic(browser: Browser, app_url: str, killbill: KillBill) -> None:
    c = operator(app_url)
    month = fresh_month(c, 1)
    d = booked(c, month)
    sent: list[str] = []
    with console_page(browser, app_url, "Enquiries") as tab_a, console_page(browser, app_url, "Enquiries") as tab_b:
        open_row(tab_a, d["reference"])
        open_row(tab_b, d["reference"])
        with held(tab_a, "**/milestones/2/invoice") as gate_:
            click(tab_a.get_by_role("button", name="Invoice milestone 2", exact=True))
            advance(tab_a, OPTIMISTIC_MS)
            expect(milestone_item(tab_a, 2)).to_have_attribute("data-state", "invoicing", timeout=REAL_GRACE_MS)
            expect(milestone_item(tab_a, 2)).to_contain_text("Invoicing…")
            expect(tab_a.get_by_role("button", name="Invoice milestone 2", exact=True)).to_have_count(0)
            expect(tab_a.get_by_role("list", name="Milestone invoices", exact=True)).to_be_focused()
            gate_.release()
        expect(milestone_item(tab_a, 2)).to_have_attribute("data-state", "invoiced", timeout=REAL_GRACE_MS * 4)
        live(tab_b, lambda: expect(milestone_item(tab_b, 2)).to_have_attribute("data-state", "invoiced",
                                                                             timeout=REAL_GRACE_MS), LIVE_MS)
        click(tab_b.get_by_role("button", name="Invoice milestone 3", exact=True))
        expect(console_status(tab_b)).to_have_text(
            "This enquiry changed in another window. The milestones shown are the current state.",
            timeout=REAL_GRACE_MS * 2)
        expect(milestone_item(tab_b, 3)).to_have_attribute("data-state", "not-invoiced")
        click(tab_b.get_by_role("button", name="Invoice milestone 3", exact=True))
        expect(milestone_item(tab_b, 3)).to_have_attribute("data-state", "invoiced", timeout=REAL_GRACE_MS * 4)
        live(tab_a, lambda: expect(milestone_item(tab_a, 3)).to_have_attribute("data-state", "invoiced",
                                                                             timeout=REAL_GRACE_MS), LIVE_MS)
        click(tab_a.get_by_role("button", name="Invoice milestone 4", exact=True))
        expect(milestone_item(tab_a, 4)).to_have_attribute("data-state", "not-invoiced", timeout=REAL_GRACE_MS * 2)
        expect(console_status(tab_a)).to_have_text(
            "This enquiry changed in another window. The milestones shown are the current state.")
        tab_a.route("**/milestones/4/invoice", lambda route: (sent.append(route.request.url), route.continue_()))
        tab_a.get_by_role("button", name="Invoice milestone 4", exact=True).dblclick()
        expect(milestone_item(tab_a, 4)).to_have_attribute("data-state", "invoiced", timeout=REAL_GRACE_MS * 4)
    assert len(sent) == 1
    account = account_of(killbill, d["reference"])["accountId"]
    for n in (2, 3, 4):
        assert len(described(account, milestone_description(n, d["reference"]))) == 1
    assert sorted(current(c, d["id"])[0]["proposal"]["invoiced_milestones"]) == [2, 3, 4]


def test_mail_outage_catch_up(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    down = env_url("APP_MAILPIT_DOWN_URL")
    c = operator(app_url)
    cd = operator(down)
    original = zone(c)
    zone_b = "Asia/Kolkata"
    set_zone(c, SEED_ZONE)
    try:
        month = fresh_month(c, 1)
        label = month_label(month)
        name, email = person("outage")
        brief = send_brief(down, name=name, email=email)
        assert brief.status_code == 201 and brief.json()["receipt"] == "pending"
        reference = brief.json()["reference"]
        e = find_enquiry(c, reference)
        assert e and e["receipt"] == "pending"
        secret = f"PRIVATE-{tag()}"
        secret_floor = 432_109
        triaged = act(c, e["id"], "", {"triage_notes": secret, "fit_score": 5, "rate_floor_cents": secret_floor},
                      "PATCH")
        assert triaged.status_code == 200, describe(triaged)
        assert act(c, e["id"], "/transition", {"to": "qualified"}).status_code == 200
        pname, pemail = person("outage-producer")
        title = f"Score {tag()}"
        sent = act(cd, e["id"], "/proposal", {"producer_name": pname, "producer_email": pemail, "project_title": title,
                                              "scope": "Layers.", "fee_cents": SPLIT_FEE, "production_month": month})
        assert sent.status_code == 201 and sent.json()["enquiry"]["proposal"]["email"] == "pending"
        token = sent.json()["enquiry"]["proposal"]["token"]
        expires = parse_iso(sent.json()["enquiry"]["proposal"]["expires_at"])
        set_zone(c, zone_b)
        held_response = accept(down, token)
        assert held_response.status_code == 201 and held_response.json()["email"] == "pending"
        paid_response = pay(down, token, idempotency_key(), held_response.json()["deposit"]["amount_cents"])
        assert paid_response.status_code == 200 and paid_response.json()["email"] == "pending"
        assert messages_to(mail, email, settle=0) == [] and messages_to(mail, pemail, settle=0) == []

        def queued() -> list[dict]:
            return [r for r in cd.get("/api/console/mail-queue").json()["emails"] if r["reference"] == reference]

        def held_rows() -> list[dict] | None:
            rows = queued()
            return rows if len(rows) == len(KIND_ORDER) and all(r["retry_at"] for r in rows) else None

        rows = eventually(held_rows, MAIL_WAIT, "five held rows")
        assert sorted(r["kind"] for r in rows) == sorted(KIND_ORDER)
        for row in rows:
            gap = (parse_iso(row["retry_at"]) - parse_iso(row["queued_at"])).total_seconds()
            assert gap >= HOLD_SECONDS, row
        receipt = inbox(mail, email, seconds=OUTAGE_MAIL_WAIT)
        assert len(receipt) == 1 and receipt[0]["Subject"] == f"Your brief reached Kettlehole Audio ({reference})"
        alerts = inbox(mail, OPERATOR_EMAIL, subject=f"New brief {reference} from {e['studio']}",
                       seconds=OUTAGE_MAIL_WAIT)
        assert len(alerts) == 1
        producer = inbox(mail, pemail, count=3, seconds=OUTAGE_MAIL_WAIT)
        subjects = sorted(m["Subject"] for m in producer)
        assert subjects == sorted([f"Proposal {reference} from Kettlehole Audio: {title}",
                                   f"{label} held for {title}: deposit due",
                                   f"Deposit received: {label} confirmed for {title}"])
        proposal_mail = next(m for m in producer if m["Subject"].startswith("Proposal "))
        held_mail = next(m for m in producer if "held for" in m["Subject"])
        assert f"/p/{token}" in body_of(proposal_mail) and f"/p/{token}" in body_of(held_mail)
        for message in receipt + alerts + producer:
            content = body_of(message)
            assert secret not in content and money(secret_floor) not in content, message["Subject"]
        eventually(lambda: queued() == [], MAIL_WAIT, "queue drained for the reference")
        final = find_enquiry(c, reference)
        assert final and final["receipt"] == "sent"
        assert (final["proposal"]["email"], final["proposal"]["held_email"], final["proposal"]["deposit_email"]) == (
            "sent", "sent", "sent")
        assert len(purchases(killbill, account_of(killbill, reference)["accountId"])) == 1
    finally:
        set_zone(c, original)


def test_business_time_in_emails(app_url: str, mail: Mailpit) -> None:
    down = env_url("APP_MAILPIT_DOWN_URL")
    c = operator(app_url)
    original = zone(c)
    zone_b = "Asia/Kolkata"
    set_zone(c, SEED_ZONE)
    try:
        month = fresh_month(c, 1)
        label = month_label(month)
        d = deal(c, month, base=down)
        assert d["enquiry"]["proposal"]["email"] == "pending"
        expires = parse_iso(d["enquiry"]["proposal"]["expires_at"])
        set_zone(c, zone_b)
        proposal_mail = inbox(mail, d["producer_email"],
                              subject=f"Proposal {d['reference']} from Kettlehole Audio: {d['title']}",
                              seconds=OUTAGE_MAIL_WAIT)
        assert len(proposal_mail) == 1
        content = body_of(proposal_mail[0])
        assert written(expires, SEED_ZONE) in content
        assert written(expires, zone_b) not in content
        assert accept(app_url, d["token"]).status_code == 201
        held_mail = inbox(mail, d["producer_email"], subject=f"{label} held for {d['title']}: deposit due")
        assert len(held_mail) == 1 and written(expires, zone_b) in body_of(held_mail[0])
    finally:
        set_zone(c, original)


def test_cancelled_proposal_emails(app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    down = env_url("APP_MAILPIT_DOWN_URL")
    short = env_url("APP_MAILPIT_DOWN_SHORT_TTL_URL")
    month = fresh_month(c, 2)
    declined = deal(c, month, base=down, brief_base=down)
    assert declined["enquiry"]["proposal"]["email"] == "pending"
    before, _ = current(c, declined["id"])
    assert act(c, declined["id"], "/transition", {"to": "declined"}).status_code == 200
    after, _ = current(c, declined["id"])
    assert after["proposal"]["email"] == "cancelled" and after["version"] == before["version"] + 1
    expiring = deal(c, month, base=short, brief_base=short)
    expires = parse_iso(expiring["enquiry"]["proposal"]["expires_at"])
    eventually(lambda: proposal(app_url, expiring["token"]).status_code == 410,
               min(EXPIRY_WAIT, (expires - datetime.now(timezone.utc)).total_seconds() + 30), "accept link expired")
    stale = find_enquiry(c, expiring["reference"])
    assert stale and stale["status"] == "expired" and stale["proposal"]["email"] == "cancelled"
    queue = c.get("/api/console/mail-queue").json()["emails"]
    assert not [r for r in queue if r["kind"] == "proposal" and r["reference"] in (declined["reference"],
                                                                                 expiring["reference"])]
    for d in (declined, expiring):
        assert len(inbox(mail, d["email"], seconds=OUTAGE_MAIL_WAIT)) == 1

    def no_proposal_mail() -> None:
        assert messages_to(mail, declined["producer_email"], settle=0) == []
        assert messages_to(mail, expiring["producer_email"], settle=0) == []

    stays(no_proposal_mail, MAIN_RETRY_SECONDS * 2)
    for d in (declined, expiring):
        found = find_enquiry(c, d["reference"])
        assert found and found["proposal"]["email"] == "cancelled"


def test_wf_mail_recovery_queue(browser: Browser, app_url: str) -> None:
    down = env_url("APP_MAILPIT_DOWN_URL")
    c = operator(app_url)
    name, email = person("queue")
    reference = send_brief(down, name=name, email=email).json()["reference"]
    month = fresh_month(c, 1)
    waiting = deal(c, month, base=down)
    body = c.get("/api/console/mail-queue").json()
    parse_iso(body["server_time"])
    order = [parse_iso(r["queued_at"]) for r in body["emails"]]
    assert order == sorted(order)
    mine = {r["kind"]: r for r in body["emails"] if r["reference"] == reference}
    assert set(mine) == {"receipt", "alert"} and mine["receipt"]["to"].lower() == email.lower()
    assert mine["alert"]["to"] == OPERATOR_EMAIL
    with console_page(browser, app_url, "Settings") as page:
        pending = page.get_by_role("region", name="Mail queue", exact=True).get_by_role("list", name="Pending emails",
                                                                                       exact=True)
        receipt = pending.get_by_role("listitem").filter(has_text=f"Receipt for {reference} to {email}.")
        live(page, lambda: expect(receipt).to_contain_text(re.compile(r"Next try in \d+s"), timeout=REAL_GRACE_MS),
             LIVE_MS)
        expect(receipt).to_have_attribute("data-kind", "receipt")
        expect(pending.get_by_role("listitem").filter(has_text=f"New-brief alert for {reference} to {OPERATOR_EMAIL}.")
               ).to_have_attribute("data-kind", "alert")
        started = time.monotonic()
        first_match = re.search(r"Next try in (\d+)s", receipt.text_content() or "")
        assert first_match
        first = int(first_match.group(1))
        advance(page, SECOND_MS)
        second_match = re.search(r"Next try in (\d+)s", receipt.text_content() or "")
        assert second_match
        second = int(second_match.group(1))
        slack = math.ceil(time.monotonic() - started) + 1
        assert first - 1 - slack <= second <= first - 1
        item = pending.get_by_role("listitem").filter(has_text=f"Proposal email for {waiting['reference']}")
        expect(item).to_have_count(1)
        assert act(c, waiting["id"], "/transition", {"to": "declined"}).status_code == 200
        live(page, lambda: expect(item).to_have_count(0, timeout=REAL_GRACE_MS), LIVE_MS)


def test_wf_mail_recovery_announcements(browser: Browser, app_url: str) -> None:
    down = env_url("APP_MAILPIT_DOWN_URL")
    c = operator(app_url)
    selected = intake(c)
    draft_notes = f"Half typed {tag()}"
    with console_page(browser, app_url, "Enquiries") as page:
        open_row(page, selected["reference"])
        notes = page.get_by_role("textbox", name="Triage notes", exact=True)
        fill(notes, draft_notes)
        reference = send_brief(down).json()["reference"]
        row = page.get_by_role("list", name="Enquiries", exact=True).get_by_role("listitem").filter(has_text=reference)
        live(page, lambda: expect(row).to_contain_text("Receipt pending", timeout=REAL_GRACE_MS), LIVE_MS)

        def delivered() -> bool:
            found = find_enquiry(c, reference)
            return bool(found and found["receipt"] == "sent")

        eventually(delivered, OUTAGE_MAIL_WAIT, "receipt delivered")
        live(page, lambda: expect(console_status(page)).to_contain_text(f"Receipt for {reference} sent.",
                                                                        timeout=REAL_GRACE_MS),
             LIST_RELOAD_MS + LIVE_MS, SECOND_MS)
        expect(row).to_contain_text("Receipt sent")
        expect(notes).to_be_focused()
        expect(notes).to_have_value(draft_notes)
        expect(page.get_by_role("button", name=f"Open {selected['reference']}", exact=True)).to_have_attribute(
            "aria-current", "true")
    assert current(c, selected["id"])[0]["triage_notes"] != draft_notes


def test_motion_timing(browser: Browser, app_url: str) -> None:
    salt = journey_station(app_url, "salt-flats-chase")
    assert salt
    t = salt["thresholds"]
    with open_app(browser, app_url) as page:
        handle = gate(page).element_handle()
        click(gate(page).get_by_role("button", name="Enter muted", exact=True))
        for anim in animations_of(page, handle):
            assert not anim["infinite"] and anim["end"] < GATE_MAX_MS, anim
        advance(page, GATE_MAX_MS)
        expect(gate(page)).to_be_hidden()
        region = station(page, salt["title"])
        assert region.get_attribute("data-camera") == "wide"
        before = camera(page)
        top = jump(page, region)
        dolly(page, region, "close")
        assert camera(page) != before
        scroll_to(page, top + t["pulse"] * INTENSITY_STEP)
        for anim in animations_of(page, ladder(region).element_handle()):
            assert not anim["infinite"] and anim["end"] < CROSSFADE_MAX_MS, anim
        assert all(not a["infinite"] for a in animations_of(page))
        scroll_to(page, top + SCROLL_RANGE + 1)
        dolly(page, region, "wide")
        advance(page, CAMERA_MAX_MS)
        assert all(not a["infinite"] for a in animations_of(page))
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        click(gate(page).get_by_role("button", name="Enter muted", exact=True))
        advance(page, FRAME_MS)
        expect(gate(page)).to_be_hidden()
        region = station(page, salt["title"])
        region.evaluate("e => e.scrollIntoView({ block: 'start', behavior: 'instant' })")
        wait_for(page, lambda: region.get_attribute("data-camera") == "close")
        rung(region, "stinger").press("Enter")
        for anim in animations_of(page, ladder(region).element_handle()):
            assert anim["end"] <= INSTANT_MS, anim
        assert region.get_attribute("data-camera") == "close"


def test_wf_cross_cutting_dialogs(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        dialog = gate(page)
        with_sound = dialog.get_by_role("button", name="Enter with sound", exact=True)
        muted = dialog.get_by_role("button", name="Enter muted", exact=True)
        expect(with_sound).to_be_visible(timeout=REAL_GRACE_MS * 4)
        wait_focus(page, with_sound)
        page.keyboard.press("Tab")
        expect(muted).to_be_focused()
        page.keyboard.press("Tab")
        expect(with_sound).to_be_focused()
        page.keyboard.press("Shift+Tab")
        expect(muted).to_be_focused()
        page.keyboard.press("Escape")
        advance(page, GATE_MAX_MS)
        expect(dialog).to_be_hidden()
        expect(page.get_by_role("button", name="Sound on", exact=True)).to_have_attribute("aria-pressed", "false")
        wait_for(page, lambda: page.evaluate(HEADING_FOCUSED_JS))
        rest, ring = ring_styles(rung(station(page, "Salt Flats Chase"), "bed"))
        assert ring != rest, rest
    c = operator(app_url)
    created, _ = published_project(c)
    try:
        with console_page(browser, app_url) as page:
            open_project(page, created["title"], created["slug"])
            for opener_name, role, name, first_field in (
                    ("New listening link", "dialog", "New listening link", "Label"),
                    ("Withdraw project", "alertdialog", f"Withdraw {created['title']}?", None)):
                opener = page.get_by_role("button", name=opener_name, exact=True)
                click(opener)
                box = page.get_by_role(role, name=name, exact=True)
                expect(box).to_be_visible(timeout=REAL_GRACE_MS)
                if first_field:
                    wait_focus(page, box.get_by_role("textbox", name=first_field, exact=True))
                handle = box.element_handle()
                for _ in range(6):
                    page.keyboard.press("Tab")
                    assert handle.evaluate("(d) => d.contains(document.activeElement)")
                page.keyboard.press("Shift+Tab")
                assert handle.evaluate("(d) => d.contains(document.activeElement)")
                page.keyboard.press("Escape")
                advance(page, GATE_MAX_MS)
                expect(box).to_be_hidden()
                expect(opener).to_be_focused()
            click(page.get_by_role("button", name="Withdraw project", exact=True))
            click(page.get_by_role("button", name="Keep project", exact=True))
            advance(page, GATE_MAX_MS)
            expect(page.get_by_role("button", name="Withdraw project", exact=True)).to_be_focused()
        assert project(c, created["id"])["status"] == "published"
    finally:
        withdraw(c, created["id"])


def test_responsive_layouts(browser: Browser, app_url: str) -> None:
    c = operator(app_url)
    month = fresh_month(c, 2)
    d = deal(c, month)

    def targets(page: Page) -> None:
        for role in ("button", "link", "textbox", "combobox", "slider", "spinbutton", "searchbox"):
            for loc in page.get_by_role(role).all():
                if not loc.is_visible():
                    continue
                box = loc.bounding_box()
                if not box or box["width"] == 0:
                    continue
                labels = loc.evaluate("""e => e.tagName === 'INPUT' && e.type === 'file'
                    ? [...e.labels].map(l => { const r = l.getBoundingClientRect(); return {width: r.width, height: r.height}; })
                    : []""")
                assert any(b["width"] >= TAP_MIN - 0.5 and b["height"] >= TAP_MIN - 0.5 for b in [box, *labels]), (role, box)

    screens = [(app_url, "journey"), (f"{app_url}/listen/{SEED_LINK_TOKEN}", "private"),
               (f"{app_url}/p/{d['token']}", "proposal"), (f"{app_url}/console", "console")]
    for url, kind in screens:
        with open_app(browser, url) as page:
            if kind in ("journey", "private"):
                enter(page)
            if kind == "console":
                sign_in(page)
                open_view(page, "Enquiries")
            for width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                advance(page, FRAME_MS)
                if kind == "journey" and width == VIEWPORTS[0][0]:
                    expect(page.get_by_role("button", name="Search", exact=True)).to_be_visible()
                if kind == "console" and width == VIEWPORTS[0][0]:
                    open_row(page, d["reference"])
                    expect(page.get_by_role("button", name="Back to list", exact=True)).to_be_visible()
                layout(page)
                targets(page)


def test_wf_cross_cutting_health(app_url: str) -> None:
    urls = [app_url] + [env_url(n) for n in ("APP_MAILPIT_DOWN_URL", "APP_MINIO_DOWN_URL",
                                             "APP_MAILPIT_DOWN_SHORT_TTL_URL", "APP_HIGH_LIMITS_URL",
                                             "APP_STRICT_PACING_URL")]
    for url in urls:
        response = httpx.get(f"{url}/api/health", timeout=HTTP_TIMEOUT)
        assert response.status_code == 200 and response.json() == {"status": "ok"}
        assert response.headers["content-type"].startswith("application/json")


def test_server_boundary(app_url: str) -> None:
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    login = {"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD}
    foreign = "http://evil.example"
    assert_error(httpx.post(f"{app_url}/api/console/session", json=login, headers={"Origin": foreign},
                            timeout=HTTP_TIMEOUT), 403, "cross_origin")
    assert httpx.post(f"{app_url}/api/console/session", json=login, headers={"Origin": origin},
                      timeout=HTTP_TIMEOUT).status_code == 200
    c = operator(app_url)

    def padded(total: int) -> bytes:
        head = b'{"fee_cents":100,"pad":"'
        return head + b"x" * (total - len(head) - 2) + b'"}'

    over = c.post("/api/console/milestones/preview", content=padded(JSON_LIMIT + 1),
                  headers={"Content-Type": "application/json"})
    assert_error(over, 413, "payload_too_large")
    exact = c.post("/api/console/milestones/preview", content=padded(JSON_LIMIT),
                   headers={"Content-Type": "application/json"})
    assert exact.status_code == 422
    marker = newest_number(c)
    _, email = person("oversize")
    body, ctype = multipart([("name", "Oversize"), ("email", email), ("studio", "Studio"), ("brief", BRIEF_TEXT)],
                            [("attachment", "big.pdf", pdf(ENQUIRY_BODY_LIMIT + 1), "application/pdf")])
    status, payload = raw_post(high(), "/api/enquiries", body, {"Content-Type": ctype})
    assert status == 413 and payload["error"] == "payload_too_large", (status, payload)
    assert all(e["email"] != email for e in enquiries_since(c, marker))
    pid = new_project(c)["id"]
    body, ctype = multipart([("layer", "bed")], [("file", "stem.wav", sized_wav(STEM_BODY_LIMIT + 8), "audio/wav")])
    cookie = "; ".join(f"{k}={v}" for k, v in c.cookies.items())
    status, payload = raw_post(app_url, f"/api/console/projects/{pid}/stems", body,
                               {"Content-Type": ctype, "Cookie": cookie})
    assert status == 413 and payload["error"] == "payload_too_large", (status, payload)
    withdraw(c, pid)
    for path in ("/run.json", "/.env", "/package.json"):
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).status_code == 404, path
    with httpx.Client(timeout=HTTP_TIMEOUT) as raw:
        url = httpx.URL(app_url).copy_with(raw_path=b"/assets/../package.json")
        assert raw.get(url).status_code == 404
    broken = httpx.post(f"{app_url}/api/console/session", content=b"{not json",
                        headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert_error(broken, 400, "malformed_json")
    assert "\n    at " not in broken.text
    root = Path(DEPLOYED_APP)
    manifest = json.loads((root / "run.json").read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    unreachable = "http://127.0.0.1:9"
    env = {**os.environ, "APP_PUBLIC_PORT": str(port),
           "DATABASE_URL": "postgres://earshot:probe@127.0.0.1:9/earshot"}
    for name, value in (("S3_ENDPOINT", unreachable), ("S3_REGION", "us-east-1"), ("S3_BUCKET", "probe"),
                        ("S3_FORCE_PATH_STYLE", "true"), ("S3_ACCESS_KEY_ID", "probe"), ("S3_SECRET_ACCESS_KEY", "probe"),
                        ("SMTP_HOST", "127.0.0.1"), ("SMTP_PORT", "9"), ("MAIL_FROM", mail_from_address()),
                        ("KILLBILL_URL", unreachable), ("KILLBILL_USERNAME", "probe"), ("KILLBILL_PASSWORD", "probe"),
                        ("KILLBILL_API_KEY", "probe"), ("KILLBILL_API_SECRET", "probe")):
        env.setdefault(name, value)
    log = tempfile.NamedTemporaryFile(prefix="earshot-dbdown-", suffix=".log", delete=False)
    process = subprocess.Popen(manifest["serve"], shell=True, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT,
                               start_new_session=True)
    copy = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-3000:]

    try:
        def healthy() -> bool:
            assert process.poll() is None, f"copy exited: {tail()}"
            try:
                return httpx.get(f"{copy}/api/health", timeout=5).status_code == 200
            except httpx.HTTPError:
                return False

        eventually(healthy, START_WAIT, "copy with Postgres down serving health")
        assert httpx.get(f"{copy}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
        assert_error(httpx.get(f"{copy}/api/journey", timeout=HTTP_TIMEOUT), 503, "database_unavailable")
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=20)


LICENCE_SPELLINGS = {"mit license": "MIT", "the mit license": "MIT", "isc license": "ISC", "apache 2.0": "Apache-2.0",
                     "apache license 2.0": "Apache-2.0", "apache license version 2.0": "Apache-2.0",
                     "apache license, version 2.0": "Apache-2.0", "apache2": "Apache-2.0", "apache 2": "Apache-2.0",
                     "bsd 2 clause": "BSD-2-Clause", "bsd 3 clause": "BSD-3-Clause",
                     "0bsd": "0BSD"}
FONT_LICENCE = re.compile(r"OFL[-\s]*(v(ersion)?\s*)?1\.1|Open Font Licen[cs]e,?\s*(v(ersion)?\.?\s*)?1\.1", re.I)
BUILD_DIRS = {"node_modules", "dist", "build", ".git", ".next", "coverage", "out", "lib", ".output", ".cache", ".turbo",
              ".vite"}
JS_TOOLING = re.compile(r"^\.|\.config\.[cm]?js$|rc\.[cm]?js$")
TOOL_DIRS = {"scripts", "tools"}
OUT_DIR = re.compile(r"""["']?outDir["']?\s*:\s*["']([^"']+)["']""")


def shipped_packages() -> dict[str, str]:
    return {package.name: package.licence for package in kit_shipped_packages()}


def licence_ok(expression: str) -> bool:
    def allowed(part: str) -> bool:
        name = part.strip("() ")
        return name in ALLOWED_LICENCES or LICENCE_SPELLINGS.get(re.sub(r"[\s_-]+", " ", name).lower()) in ALLOWED_LICENCES

    terms = re.split(r"\s+OR\s+", expression.strip().strip("()"))
    return any(all(allowed(part) for part in re.split(r"\s+AND\s+", term)) for term in terms)


def is_icon(path: Path) -> bool:
    name = path.name.lower()
    if name.startswith(("favicon", "icon", "apple-touch-icon", "android-chrome", "mstile")) or any(
            part.lower() in ("icons", "icon") for part in path.parts):
        return True
    try:
        with Image.open(path) as image:
            return max(image.size) <= ICON_MAX_PX
    except Exception:
        return False


def app_files() -> Iterator[Path]:
    skip = {"node_modules", "dist", "build", "out", "coverage"}
    for path in Path("/app").rglob("*"):
        parts = path.relative_to("/app").parts
        if any(p in skip or p.startswith(".") for p in parts[:-1]) or not path.is_file():
            continue
        yield path


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in shipped_packages() if name not in notices]
    assert missing == []
    assert all(font in notices for font in FONTS)


def test_if_licences() -> None:
    bad = {name: licence for name, licence in shipped_packages().items() if not licence_ok(licence)}
    assert bad == {}
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert FONT_LICENCE.search(notices)


def test_if_no_extra_datastore() -> None:
    package = json.loads(Path("/app/package.json").read_text())
    names = [*package.get("dependencies", {}), *package.get("devDependencies", {})]
    assert not [n for n in names if any(s in n.lower() for s in ("sqlite", "redis", "lowdb", "nedb", "lmdb"))]
    assert not [p for p in app_files() if p.suffix.lower() in (".sqlite", ".sqlite3", ".db")]


def test_if_typescript_source() -> None:
    app = Path("/app")
    sources = [p for p in app.rglob("*") if p.is_file() and not BUILD_DIRS & set(p.relative_to(app).parts)
               and not any("dist" in part for part in p.relative_to(app).parts)]
    assert any(p.suffix in (".ts", ".tsx") for p in sources)
    configs = [p for p in sources if re.match(r"tsconfig.*\.json$|.*\.config\.[cm]?[jt]s$", p.name)]
    outs = {(cfg.parent / m).resolve() for cfg in configs for m in OUT_DIR.findall(cfg.read_text(errors="ignore"))}
    stray = [p for p in sources if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and not JS_TOOLING.search(p.name)
             and p.relative_to(app).parts[0] not in TOOL_DIRS and not any(o in p.resolve().parents for o in outs)]
    assert stray == []


def test_if_no_media_files() -> None:
    audio_ext = {".wav", ".ogg", ".mp3", ".flac", ".aac", ".m4a", ".opus"}
    image_ext = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".tif", ".tiff"}
    found = [p for p in app_files() if p.suffix.lower() in audio_ext
             or (p.suffix.lower() in image_ext and not is_icon(p))]
    assert found == []


def test_if_seeded_credentials(app_url: str, mail: Mailpit) -> None:
    c = operator(app_url)
    assert c.get("/api/console/settings").json()["operator_email"] == OPERATOR_EMAIL
    name, email = person("seeded")
    assert send_brief(high(), name=name, email=email).status_code == 201
    assert addresses(inbox(mail, email)[0]["From"]) == [mail_from_address()]
