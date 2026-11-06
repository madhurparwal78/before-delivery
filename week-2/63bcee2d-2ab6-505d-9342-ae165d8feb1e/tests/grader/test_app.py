from __future__ import annotations

import base64
import contextlib
import csv
import fnmatch
import hashlib
import io
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from datetime import date, datetime, time as dtime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from html import unescape
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    animations,
    axe,
    capture,
    changed,
    click,
    decode,
    fill,
    held,
    idempotency_key,
    open_app,
    same_origin,
    select,
    session,
    settle,
    tap,
    text,
    unique,
)


APP_DIR = Path("/app")
PASSWORD = "Marrow-Hall-2026"

AVERY = "avery.tsang@marrowhall.example"
JORDAN = "jordan.lim@marrowhall.example"
CASEY = "casey.wong@marrowhall.example"
RIN = "rin.mok@marrowhall.example"
SAM = "sam.teo@marrowhall.example"
MORGAN = "morgan.ho@marrowhall.example"
DANA = "dana.cheung@kestreltea.example"
QUINN = "quinn.yeo@kestreltea.example"
ROBIN = "robin.chan@northvane.example"
ASH = "ash.kwok@harbourline.example"
KAI = "kai.ng@tideway.example"

KESTREL = "Kestrel Tea House"
NORTHVANE = "Northvane Optics"
TIDEWAY = "Tideway Joinery Pte Ltd"
HARBOURLINE = "Harbourline Fit-Out Ltd"
STUDIO_ORG = "Marrow Hall Interiors"

HK_STORES = [{"code": "HK-CWB-01", "name": "Causeway Bay", "weight": 120}, {"code": "HK-TST-02", "name": "Tsim Sha Tsui", "weight": 95}, {"code": "HK-MK-03", "name": "Mong Kok", "weight": 80}, {"code": "HK-CEN-04", "name": "Central", "weight": 105}, {"code": "HK-SHT-05", "name": "Sha Tin", "weight": 100}, {"code": "HK-KT-06", "name": "Kwun Tong", "weight": 100}]
SG_STORES = [{"code": "SG-ORC-01", "name": "Orchard", "weight": 3}, {"code": "SG-JEM-02", "name": "Jurong East", "weight": 2}, {"code": "SG-TPN-03", "name": "Tampines", "weight": 2}]
HK_FEES = {"groundwork": 6_000_000, "scheme": 18_000_000, "detailing": 24_000_000, "tenderAward": 9_000_000, "build": 32_000_000, "handover": 7_000_000}
SG_FEES = {k: 3_000_000 for k in ("groundwork", "scheme", "detailing", "tenderAward", "build", "handover")}
GROUNDWORK_FEE = "HKD 60,000.00"
GROUNDWORK = "Groundwork"
SCHEME_FEE = "HKD 180,000.00"
STAGE_KEYS = ["groundwork", "scheme", "detailing", "tender_award", "build", "handover", "aftercare"]

CONTRACT_SUM = "1,240,000.00"
V001_AMOUNT = "12,400.00"
JORDAN_LIMIT_SGD = "8,500.00"
JORDAN_LIMITS = {"HKD": 5_000_000, "SGD": 850_000}
RETENTION_PERCENT = Decimal(10)
CAP_PERCENT = Decimal(5)
SG_SPLIT_OF_1000 = {"SG-ORC-01": "428.57", "SG-JEM-02": "285.72", "SG-TPN-03": "285.71"}

SEED_RECEIVED = "2026-10-19T02:00:00.000Z"
HOLIDAYS_2026 = {date(2026, 1, 1), date(2026, 2, 17), date(2026, 2, 18), date(2026, 2, 19), date(2026, 4, 3), date(2026, 4, 4), date(2026, 4, 6), date(2026, 4, 7), date(2026, 5, 1), date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 1), date(2026, 9, 26), date(2026, 10, 1), date(2026, 10, 19), date(2026, 12, 25), date(2026, 12, 26)}
HOLIDAYS_2027 = {date(2027, 1, 1), date(2027, 2, 6), date(2027, 2, 8), date(2027, 2, 9), date(2027, 3, 26), date(2027, 3, 27), date(2027, 3, 29), date(2027, 4, 5), date(2027, 5, 1), date(2027, 5, 13), date(2027, 6, 9), date(2027, 7, 1), date(2027, 9, 16), date(2027, 10, 1), date(2027, 10, 8), date(2027, 12, 25), date(2027, 12, 27)}
HOLIDAYS = HOLIDAYS_2026 | HOLIDAYS_2027
CUTOFF = dtime(17, 0, 0)
REVIEW_DAYS = 5

SEED_FINISHES = [("PT-01", "Warm white eggshell", "Paint"), ("PT-02", "Oxide red accent", "Paint"), ("TL-01", "Terrazzo floor tile", "Tile"), ("LM-01", "Ash laminate", "Laminate"), ("ST-01", "Honed basalt counter", "Stone"), ("MT-01", "Brushed bronze trim", "Metal")]

FILE_LIMIT = 10_000_000
JSON_LIMIT = 65_536
CSV_LIMIT = 1_000_000
CSV_ROWS = 2_000
TOUCH_SLOP_PX = 8
NEAR_SEAM = 2
RAIL_DRAG_PX = 6
RAIL_SETTLE_MS = 640
RAIL_FLICK_PX_PER_MS = 0.5
RAIL_RELEASE_MS = 8
MOTION_MS = {160, 420, 640}
MAIL_SECONDS = 10
FAMILY = "\U0001F468\u200D\U0001F469\u200D\U0001F467"

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
VIEWPORTS = [PHONE, TABLET, DESKTOP]

LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
SPDX_SPELLINGS = {"mit license": "MIT", "the mit license": "MIT", "isc license": "ISC", "apache 2.0": "Apache-2.0",
                  "apache-2": "Apache-2.0", "apache 2": "Apache-2.0", "apache license 2.0": "Apache-2.0",
                  "apache license, version 2.0": "Apache-2.0", "bsd-2": "BSD-2-Clause", "bsd 2-clause": "BSD-2-Clause",
                  "simplified bsd": "BSD-2-Clause", "bsd-3": "BSD-3-Clause", "bsd 3-clause": "BSD-3-Clause",
                  "new bsd": "BSD-3-Clause", "cc0": "CC0-1.0", "cc0 1.0": "CC0-1.0", "ofl": "OFL-1.1", "ofl 1.1": "OFL-1.1",
                  "sil ofl 1.1": "OFL-1.1", "blueoak-1.0": "BlueOak-1.0.0"}
LICENCE_WORDING = ((("Permission is hereby granted, free of charge",), "MIT"),
                   (("Permission to use, copy, modify, and/or distribute",), "ISC"),
                   (("Apache License", "Version 2.0"), "Apache-2.0"),
                   (("Blue Oak Model License",), "BlueOak-1.0.0"),
                   (("SIL OPEN FONT LICENSE", "Version 1.1"), "OFL-1.1"),
                   (("CC0 1.0 Universal",), "CC0-1.0"),
                   (("Redistribution and use in source and binary forms", "Neither the name"), "BSD-3-Clause"),
                   (("Redistribution and use in source and binary forms",), "BSD-2-Clause"))
ENV_VARS = ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "KILLBILL_URL", "KILLBILL_USERNAME", "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET", "SMTP_HOST", "SMTP_PORT", "APP_PUBLIC_PORT", "APP_BASE_URL", "TENDER_LINK_TTL_SECONDS", "INVITATION_TTL_SECONDS", "SESSION_IDLE_TIMEOUT_SECONDS", "ENQUIRY_RATE_WINDOW_SECONDS"]

TIME_RE = r"\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}:\d{2} (HKT|SGT)"
HK = ZoneInfo("Asia/Hong_Kong")
SUITE_DAY = datetime.now(HK).date()
PAST_HOURS = 4

HTTP_SECONDS = 30
QUICK_MS = 500
UNTIL_SECONDS = 30
SEARCH_SECONDS = 3
ADVANCE_MS = 100
POLL_SECONDS = 0.25
BOOT_SECONDS = 180
TAB_LIMIT = 250
SUBPIXEL = 2
CLOSE_LEAD_SECONDS = 35
LINK_TTL_PROBE = 30
PIXEL_TOLERANCE = 40
PREVIEW_TTL_PROBE = 4
SITES = 12
ENQUIRY_MESSAGE = "Twelve stores next year."
LEGACY_BAD_CATEGORY = "Plastic"
SEALED_BASE = 1_234_567
UNKNOWN_ID = "00000000-0000-4000-8000-000000000000"
EVIL_ORIGIN = "http://evil.example"
RENDER_RGB = (40, 70, 200)
PHOTO_RGB = (60, 90, 50)
EXIF_ORIENTATION = 0x0112
EXIF_GPS = 0x8825

PDF = b"%PDF-1.4\n%probe sheet\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
OK_SVG = '\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<!-- drawn -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
SCRIPT_SVGS = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
]

TRANSITION_JS = """(() => {
  if (window.__transitionProbe) return;
  window.__transitionProbe = true;
  const save = (v) => { try {
    const seen = JSON.parse(sessionStorage.getItem('__transitions') || '[]');
    seen.push(v); sessionStorage.setItem('__transitions', JSON.stringify(seen)); } catch (e) {} };
  const look = (root) => { const v = root && root.getAttribute && root.getAttribute('data-transition'); if (v) save(v); };
  look(document.documentElement);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        for (const node of r.addedNodes) { if (node === document.documentElement) look(node); }
      } else if (r.target === document.documentElement) {
        if (r.oldValue) save(r.oldValue);
        look(r.target);
      }
    }
  }).observe(document, {childList: true, attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ['data-transition']});
})()"""

MOTION_JS = """(() => {
  if (window.__motionProbe) return;
  window.__motionProbe = true;
  const declared = (a) => { const el = a.effect && a.effect.target; if (!a.transitionProperty || !el) return null;
    const s = getComputedStyle(el), props = s.transitionProperty.split(',').map(p => p.trim());
    const times = s.transitionDuration.split(',').map(d => parseFloat(d) * (/ms$/.test(d.trim()) ? 1 : 1000));
    const name = a.transitionProperty, side = name.replace(/^border-(top|right|bottom|left)-/, 'border-');
    let k = -1; props.forEach((p, j) => { if (p === 'all' || p === name || p === side || name.startsWith(p + '-')
      || (p === 'inset' && ['top', 'right', 'bottom', 'left'].includes(name))) k = j; });
    return k < 0 ? Math.max(...times) : times[k % times.length]; };
  const rec = (a) => { try {
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
    const it = t.iterations;
    const seen = JSON.parse(sessionStorage.getItem('__motions') || '[]');
    seen.push({duration: declared(a) ?? (Number(t.duration) || 0), iterations: it === Infinity ? null : it});
    sessionStorage.setItem('__motions', JSON.stringify(seen)); } catch (e) {} };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); rec(a); return a; };
  for (const ev of ['transitionrun', 'animationstart']) {
    document.addEventListener(ev, (e) => { for (const a of e.target.getAnimations()) rec(a); }, true);
  }
})()"""


def _install_probe(page: Page, script: str, key: str) -> None:
    page.add_init_script(script)
    page.evaluate(f"() => sessionStorage.removeItem('{key}')")
    page.evaluate(script)


def _probe_records(page: Page, key: str) -> list[Any]:
    return page.evaluate(f"() => JSON.parse(sessionStorage.getItem('{key}') || '[]')")

ANNOUNCE = re.compile(r"^(Announcements|Site announcements)$")
PROBLEMS = re.compile(r"^(Problems|Site problems)$")


def _check(condition: Any, message: str = "") -> None:
    if not condition:
        raise AssertionError(message)


def _poll(fn: Callable[[], Any], seconds: float, message: str = "") -> Any:
    deadline = time.monotonic() + seconds
    while True:
        result = fn()
        if result:
            return result
        assert time.monotonic() < deadline, message
        threading.Event().wait(POLL_SECONDS)


def _elapse(seconds: float) -> None:
    end = time.monotonic() + seconds
    _poll(lambda: time.monotonic() >= end, seconds + 5, "clock did not advance")


@contextlib.contextmanager
def _entered(obj: Any) -> Iterator[Any]:
    if hasattr(obj, "__enter__"):
        with obj as value:
            yield value
    else:
        value = next(obj)
        try:
            yield value
        finally:
            obj.close()


class Api:
    def __init__(self, base: str, email: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.email = email
        self.client = httpx.Client(base_url=self.base, timeout=HTTP_SECONDS)
        if email:
            response = self.client.post("/api/session", json={"email": email, "password": PASSWORD})
            assert response.status_code == 200, (email, response.status_code, response.text)

    def request(self, method: str, path: str, body: Any = None, *, key: str | None = None, content: bytes | None = None,
                files: Any = None, data: Any = None, headers: dict[str, str] | None = None) -> httpx.Response:
        merged = dict(headers or {})
        if key is not None:
            merged["Idempotency-Key"] = key
        kwargs: dict[str, Any] = {}
        if body is not None:
            kwargs["json"] = body
        if content is not None:
            kwargs["content"] = content
        if files is not None:
            kwargs["files"] = files
        if data is not None:
            kwargs["data"] = data
        return self.client.request(method, path, headers=merged, **kwargs)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.request("POST", path, body, **kw)

    def put(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.request("PUT", path, body, **kw)

    def patch(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.request("PATCH", path, body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("DELETE", path, **kw)


def _ok(response: httpx.Response, status: int) -> dict[str, Any]:
    assert response.status_code == status, (response.request.method, str(response.request.url), response.status_code, response.text[:500])
    return response.json() if response.content else {}


def _err(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, (str(response.request.url), response.status_code, response.text[:500])
    body = response.json()
    assert body.get("error") == code, body
    return body


def _field(response: httpx.Response, field: str, copy: str | re.Pattern[str] | None = None) -> None:
    body = _err(response, 422, "validation")
    errors = body.get("errors") or {}
    assert field in errors, errors
    if isinstance(copy, re.Pattern):
        assert copy.search(errors[field]), errors[field]
    elif copy is not None:
        assert errors[field] == copy, errors[field]


def _too_long(label: str, limit: int) -> re.Pattern[str]:
    return re.compile(rf"^{re.escape(label)} can be at most ({limit}|{limit:,}) characters\.$")


def _name(prefix: str) -> str:
    return unique(prefix)[0]


def _code(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


def _bucket() -> Any:
    return S3()


def _hk_now() -> datetime:
    return datetime.now(HK)


def _today() -> date:
    return _hk_now().date()


def _month() -> str:
    return _hk_now().strftime("%Y-%m")


def _parse(instant: str) -> datetime:
    return datetime.fromisoformat(instant.replace("Z", "+00:00"))


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _fmt_date(day: date) -> str:
    return f"{day.day} {day:%b %Y}"


def _fmt_time(instant: str) -> str:
    local = _parse(instant).astimezone(HK)
    return f"{local.day} {local:%b %Y, %H:%M:%S} HKT"


def _fmt_local(local: str, zone: str = "HKT") -> str:
    moment = datetime.fromisoformat(local)
    return f"{moment.day} {moment:%b %Y, %H:%M:%S} {zone}"


def _close_local(seconds: float) -> str:
    moment = _hk_now() + timedelta(seconds=seconds)
    return (moment + timedelta(seconds=1 if moment.second == 0 else 0)).strftime("%Y-%m-%dT%H:%M:%S")


def _utc_of_local(local: str) -> datetime:
    return datetime.fromisoformat(local).replace(tzinfo=HK).astimezone(timezone.utc)


def _cents(amount: str) -> int:
    return int(Decimal(amount.replace(",", "")) * 100)


def _half_up(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _amount(currency: str, cents: int) -> str:
    return f"{currency} {Decimal(cents) / 100:,.2f}"


def _plain(cents: int) -> str:
    return f"{Decimal(cents) / 100:.2f}"


def _add_months(day: date, months: int) -> date:
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    following = date(year + (month == 12), month % 12 + 1, 1)
    return date(year, month, min(day.day, (following - timedelta(days=1)).day))


def _working(day: date) -> bool:
    return day.weekday() < 5 and day not in HOLIDAYS


def _next_working(day: date) -> date:
    day += timedelta(days=1)
    while not _working(day):
        day += timedelta(days=1)
    return day


def _due(instant: str) -> date:
    local = _parse(instant).astimezone(HK)
    start = local.date()
    if not _working(start) or local.time() > CUTOFF:
        start = _next_working(start)
    for _ in range(REVIEW_DAYS):
        start = _next_working(start)
    return start


def _revisions(count: int) -> list[str]:
    singles = [chr(c) for c in range(ord("A"), ord("Z") + 1) if chr(c) not in "IO"]
    letters = singles + [a + b for a in singles for b in singles]
    return letters[:count]


def _png(rgb: tuple[int, int, int], size: tuple[int, int] = (160, 100)) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, rgb).save(buffer, "PNG")
    return buffer.getvalue()


def _jpeg(rgb: tuple[int, int, int]) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), rgb).save(buffer, "JPEG")
    return buffer.getvalue()


def _identifies(value: Any, member: dict[str, Any], email: str) -> bool:
    found = list(value.values()) if isinstance(value, dict) else [value]
    return any(str(v) == str(member["id"]) or v == member["name"] or str(v).lower() == email.lower() for v in found)


def _sha256_of(value: Any, data: bytes) -> bool:
    digest, given = hashlib.sha256(data).digest(), str(value).strip()
    if given.lower() == digest.hex():
        return True
    try:
        return base64.b64decode(given + "=" * (-len(given) % 4), altchars=b"-_", validate=True) == digest
    except ValueError:
        return False


def _content(message: dict[str, Any]) -> str:
    markup = message.get("HTML") or ""
    words = " ".join(unescape(re.sub(r"<[^>]+>", " ", markup)).split())
    links = " ".join(unescape(target) for target in re.findall(r"""href\s*=\s*["']([^"']+)""", markup))
    return "\n".join(part for part in (text(message) if message.get("Text") else "", words, links) if part)


def _to(message: dict[str, Any]) -> list[str]:
    return [a.lower() for a in addresses(message.get("To") or [])]


def _subject(message: dict[str, Any]) -> str:
    return message.get("Subject") or ""


def _mails(mail: Any, pred: Callable[[dict[str, Any]], bool], count: int = 1) -> list[dict[str, Any]]:
    def enough() -> bool:
        return len([m for m in mail.messages(settle=0) if pred(m)]) >= count

    _poll(enough, MAIL_SECONDS + 10, "expected mail did not arrive")
    return [m for m in mail.messages(settle=1.5) if pred(m)]


def _quiet(mail: Any, pred: Callable[[dict[str, Any]], bool]) -> None:
    assert not [m for m in mail.messages(settle=MAIL_SECONDS) if pred(m)]


def _single_recipient(message: dict[str, Any]) -> None:
    assert len(addresses(message.get("To") or [])) == 1
    assert not addresses(message.get("Cc") or []) and not addresses(message.get("Bcc") or [])
    sender = message.get("From")
    assert "plumbline@marrowhall.example" in [a.lower() for a in addresses([sender] if isinstance(sender, dict) else sender or [])]


def _token(content: str, kind: str) -> str:
    match = re.search(rf"/{kind}/([A-Za-z0-9_\-]+)", content)
    assert match, f"no /{kind}/ link in mail"
    return match.group(1)


def _ics(message: dict[str, Any]) -> str:
    base = os.environ["MAILPIT_URL"].rstrip("/")
    part = next(a for a in message.get("Attachments") or [] if a.get("FileName") == "tender-close.ics")
    response = httpx.get(f"{base}/api/v1/message/{message['ID']}/part/{part['PartID']}", timeout=HTTP_SECONDS)
    assert response.status_code == 200
    return response.text.replace("\r\n ", "").replace("\n ", "")


def _kb_invoices(account_id: str) -> list[dict[str, Any]]:
    base = os.environ["KILLBILL_URL"].rstrip("/")
    response = httpx.get(
        f"{base}/1.0/kb/accounts/{account_id}/invoices", params={"includeInvoiceComponents": "true"},
        auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
        headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"], "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"]},
        timeout=HTTP_SECONDS)
    assert response.status_code == 200, response.text
    return [i for i in response.json() if Decimal(str(i.get("amount", 0))) != 0 or i.get("items")]


@contextlib.contextmanager
def _app(browser: Browser, base: str, path: str, api: Api | None = None, viewport: dict[str, int] | None = None,
         reduced: bool = False) -> Iterator[Page]:
    start = f"{base}/sign-in" if api else f"{base}{path}"
    with _entered(open_app(browser, start, reduced_motion="reduce" if reduced else "no-preference")) as page:
        if viewport:
            page.set_viewport_size(viewport)
        if api:
            page.context.add_cookies([{"name": n, "value": v, "url": base} for n, v in api.client.cookies.items()])
            page.goto(f"{base}{path}")
        _listen(page)
        yield page


def _listen(page: Page) -> None:
    page.wait_for_load_state("domcontentloaded")


def _go(page: Page, url: str) -> None:
    page.goto(url)
    _listen(page)


def _until(page: Page, fn: Callable[[], Any]) -> Any:
    deadline = time.monotonic() + UNTIL_SECONDS
    while True:
        try:
            return fn()
        except (AssertionError, PlaywrightTimeout):
            if time.monotonic() > deadline:
                raise
            advance(page, ADVANCE_MS)


def _visible(page: Page, locator: Locator) -> None:
    _until(page, lambda: expect(locator).to_be_visible(timeout=QUICK_MS))


def _attr(page: Page, locator: Locator, name: str, value: str | re.Pattern[str]) -> None:
    _until(page, lambda: expect(locator).to_have_attribute(name, value, timeout=QUICK_MS))


def _url(page: Page, pattern: str) -> None:
    _until(page, lambda: _check(re.search(pattern, page.url), page.url))


def _query(page: Page) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}


def _box(page: Page, locator: Locator) -> dict[str, float]:
    box = locator.bounding_box(timeout=QUICK_MS)
    assert box, "element has no box"
    return box


def _is_focused(locator: Locator) -> bool:
    return bool(locator.evaluate_all("els => els.some(e => e === document.activeElement)"))


def _focus(page: Page, locator: Locator) -> None:
    _until(page, lambda: _check(_is_focused(locator), "focus is elsewhere"))


def _tab_to(page: Page, locator: Locator) -> None:
    _until(page, lambda: expect(locator).to_be_attached(timeout=QUICK_MS))
    for _ in range(TAB_LIMIT):
        if _is_focused(locator):
            return
        page.keyboard.press("Tab")
    raise AssertionError("control not reachable by Tab")


def _press(page: Page, locator: Locator) -> None:
    _tab_to(page, locator)
    page.keyboard.press("Enter")


def _type(page: Page, locator: Locator, value: str) -> None:
    _tab_to(page, locator)
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.type(value)


def _hear(page: Page, copy: str | re.Pattern[str], kind: str = "status") -> None:
    region = page.get_by_role(kind, name=ANNOUNCE if kind == "status" else PROBLEMS).first
    _until(page, lambda: expect(region).to_contain_text(copy, timeout=QUICK_MS))


def _said(page: Page, copy: str, kind: str = "status") -> bool:
    region = page.get_by_role(kind, name=ANNOUNCE if kind == "status" else PROBLEMS).first
    return bool(region.count()) and copy in region.inner_text(timeout=QUICK_MS)


def _find_bidder(page: Page, value: str) -> None:
    box = page.get_by_role("searchbox", name="Find bidder")
    fill(box, value)
    deadline = time.monotonic() + SEARCH_SECONDS
    while _query(page).get("q") != value and time.monotonic() < deadline:
        advance(page, ADVANCE_MS)
    if _query(page).get("q") != value:
        box.press("Enter")


def _download(page: Page, link: Locator) -> str:
    url = link.evaluate("a => a.href", timeout=QUICK_MS)
    if url.startswith(("blob:", "data:")):
        return link.evaluate("a => fetch(a.href).then(r => r.text())", timeout=QUICK_MS)
    response = page.request.get(url)
    assert response.status == 200, response.status
    return response.body().decode("utf-8-sig")


def _listed(cases: Locator, expected: list[dict[str, Any]]) -> None:
    for case in expected:
        expect(cases.get_by_role("link", name=case["title"]).first).to_be_visible(timeout=QUICK_MS)
    targets = cases.get_by_role("link").evaluate_all("els => [...new Set(els.map(e => e.href))]")
    _check(len(targets) == len(expected), f"{len(targets)} case studies listed, expected {len(expected)}")


def _unobstructed(page: Page, locator: Locator) -> None:
    script = """e => { const r = e.getBoundingClientRect();
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2]];
      return pts.every(([x, y]) => { const t = document.elementFromPoint(x, y);
        return !!t && (t === e || e.contains(t) || t.contains(e) || [...(e.labels || [])].some(l => l.contains(t))); }); }"""
    _until(page, lambda: _check(locator.evaluate(script, timeout=QUICK_MS), "focused control is covered"))


def _rest(page: Page) -> None:
    page.evaluate("() => document.getAnimations().forEach(a => { if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); })")


def _steady(page: Page, act: Callable[[], None]) -> None:
    _until(page, lambda: (_rest(page), act()))


def _in_view(locator: Locator) -> None:
    locator.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})", timeout=QUICK_MS)


def _screen_layout(page: Page) -> None:
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"


def _pick(radio: Locator, by_touch: bool = False) -> None:
    page = radio.page
    script = """e => { const at = (el) => { el.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const t = r.width && r.height ? document.elementFromPoint(x, y) : null;
        return t && (t === e || el.contains(t)) ? {x, y} : null; };
      for (const el of [e, ...(e.labels || [])]) { const p = at(el); if (p) return p; }
      return null; }"""

    def chosen() -> None:
        _rest(page)
        point = radio.evaluate(script, timeout=QUICK_MS)
        _check(point, "neither the radio nor its label takes the press")
        (page.touchscreen.tap if by_touch else page.mouse.click)(point["x"], point["y"])
        expect(radio).to_be_checked(timeout=QUICK_MS)
    _until(page, chosen)


def _touch(page: Page, points: list[tuple[float, float]]) -> None:
    cdp = session(page)
    x, y = points[0]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for x, y in points[1:]:
        advance(page, 16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    advance(page, 16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def _mouse_drag(page: Page, start: tuple[float, float], end: tuple[float, float]) -> None:
    page.mouse.move(*start)
    page.mouse.down()
    for step in range(1, 11):
        advance(page, 16)
        page.mouse.move(start[0] + (end[0] - start[0]) * step / 10, start[1] + (end[1] - start[1]) * step / 10)
    advance(page, 16)
    page.mouse.up()


def _glide_ends(rail: Locator) -> list[float]:
    return rail.evaluate("""e => { const cards = [...e.querySelectorAll('a[href], [role="link"]')];
      return e.getAnimations({subtree: true}).filter(a => { const t = a.effect && a.effect.target;
        return !!t && cards.some(c => t.contains(c)); }).map(a => a.effect.getComputedTiming().endTime); }""")


def _watch_glides(rail: Locator) -> None:
    rail.evaluate("""e => { window.__glides = []; const cards = [...e.querySelectorAll('a[href], [role="link"]')];
      const paint = /^(color|background|border|outline|opacity|box-?shadow|text|fill|stroke|filter)/i;
      const keep = (a) => { try { const t = a.effect && a.effect.target;
        const props = a.transitionProperty ? [a.transitionProperty] : a.effect.getKeyframes().flatMap(k => Object.keys(k))
          .filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p));
        if (t && e.contains(t) && cards.some(c => t.contains(c)) && props.some(p => !paint.test(p)))
          window.__glides.push(a.effect.getComputedTiming().endTime); } catch (error) {} };
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) { const a = animate.apply(this, args); keep(a); return a; };
      for (const kind of ['transitionrun', 'animationstart']) e.addEventListener(kind, (v) => v.target.getAnimations().forEach(keep), true); }""")


def _seam_is(page: Page, s: int) -> None:
    slider = page.get_by_role("slider", name="Seam")
    frame = page.get_by_role("group", name="Intent seam")

    def same() -> None:
        now = slider.evaluate("e => e.getAttribute('aria-valuenow') ?? (e instanceof HTMLInputElement ? e.value : null)", timeout=QUICK_MS)
        _check(now == str(s), f"seam value is {now}, not {s}")
        expect(slider).to_have_attribute("aria-valuetext", f"Render {s}%, photo {100 - s}%", timeout=QUICK_MS)
        expect(frame).to_have_attribute("data-seam", str(s), timeout=QUICK_MS)
    _until(page, same)


def _frame_pixels(page: Page, frame: Locator) -> Any:
    advance(page, ADVANCE_MS)
    return decode(capture(frame))


def _frame_showing(page: Page, frame: Locator, left: tuple[int, int, int], right: tuple[int, int, int]) -> Any:
    def shown() -> Any:
        pixels = _frame_pixels(page, frame)
        _shows(pixels, 0.25, left)
        _shows(pixels, 0.75, right)
        return pixels
    return _until(page, shown)


def _shows(pixels: Any, fraction: float, rgb: tuple[int, int, int]) -> None:
    cx, cy = round(pixels.width * fraction), pixels.height // 2
    block = [pixels.rgb[(y * pixels.width + x) * 3:(y * pixels.width + x) * 3 + 3]
             for y in range(max(0, cy - 3), min(pixels.height, cy + 4)) for x in range(max(0, cx - 3), min(pixels.width, cx + 4))]
    got = tuple(sorted(p[c] for p in block)[len(block) // 2] for c in range(3))
    assert all(abs(a - b) <= PIXEL_TOLERANCE for a, b in zip(got, rgb)), (fraction, got, rgb)


def _shape(page: Page, locator: Locator, shape: str) -> None:
    script = """(e, s) => [e, ...e.querySelectorAll('[data-shape]')].some(x => { const r = x.getBoundingClientRect();
      return x.getAttribute('data-shape') === s && r.width > 0 && r.height > 0; })"""
    _until(page, lambda: _check(locator.evaluate(script, shape, timeout=QUICK_MS), f"no visible {shape} shape"))


def _record_button(page: Page, title: str, name: str) -> Locator:
    record = page.get_by_role("listitem").or_(page.get_by_role("row")).or_(page.get_by_role("article")).filter(has_text=title)
    return record.get_by_role("button", name=name, exact=True).first


def _marker(page: Page, n: int, state: str) -> Locator:
    return page.get_by_role("button", name=f"Snag {n} {state}", exact=True)


def _reorder(page: Page, code: str) -> Locator:
    return page.get_by_role("button", name=f"Reorder {code}")


def _choose(locator: Locator, label: str) -> None:
    value = locator.evaluate(
        "(e, l) => { const o = [...(e.options || [])].find(o => (o.label || o.textContent || '').trim() === l); return o ? o.value : null; }",
        label)
    if value is not None:
        select(locator, value)
        return
    click(locator)
    click(locator.page.get_by_role("option", name=label, exact=True))


def _audit(page: Page) -> None:
    page.evaluate("() => document.getAnimations().forEach(a => { if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); })")
    axe(page)


def _refused(page: Page, dialog: Locator, copy: str) -> None:
    _visible(page, dialog)
    script = """(d, c) => { const a = document.activeElement;
      return !!a && d.contains(a) && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(a.tagName) && (a.textContent || '').includes(c); }"""
    _until(page, lambda: _check(dialog.evaluate(script, copy, timeout=QUICK_MS), f"focus is not on the error text {copy!r}"))


def _first_button(page: Page, dialog: Locator) -> None:
    script = """d => { const first = [...d.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')]
      .find(e => (e.getAttribute('role') || 'button') === 'button' && e.getClientRects().length > 0);
      return !!first && first === document.activeElement; }"""
    _until(page, lambda: _check(dialog.evaluate(script, timeout=QUICK_MS), "focus is not on the dialog's first button"))


@contextlib.contextmanager
def _app_copy(env: dict[str, str]) -> Iterator[str]:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    process = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                               env={**os.environ, **env, "APP_PUBLIC_PORT": str(port), "APP_BASE_URL": base})

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-4000:]

    def healthy() -> bool:
        assert process.poll() is None, f"app copy exited:\n{tail()}"
        try:
            return httpx.get(f"{base}/api/health", timeout=5).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        _poll(healthy, BOOT_SECONDS, f"app copy never became healthy:\n{tail()}")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(20)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
        log.close()


def _lookup(api: Api, path: str, key: str, name: str) -> str:
    return next(x["id"] for x in _ok(api.get(path), 200)[key] if x["name"] == name)


def _project(avery: Api, region: str = "HK", brand: str = KESTREL, stores: list[dict[str, Any]] | None = None,
             contract: tuple[str, int] | None = None, defects: int = 12) -> dict[str, Any]:
    currency = "SGD" if region == "SG" else "HKD"
    body = {"name": f"{_name('project')} rollout", "brandId": _lookup(avery, "/api/brands", "brands", brand), "region": region,
            "currency": currency, "stageFees": SG_FEES if region == "SG" else HK_FEES,
            "stores": stores or (SG_STORES if region == "SG" else HK_STORES), "defectsPeriodMonths": defects}
    pid = _ok(avery.post("/api/projects", body), 201)["project"]["id"]
    if contract:
        company = _lookup(avery, "/api/companies", "companies", contract[0])
        _ok(avery.post(f"/api/projects/{pid}/contract", {"companyId": company, "contractSumCents": contract[1]}), 201)
    return _ok(avery.get(f"/api/projects/{pid}"), 200)["project"]


def _sg_contract(avery: Api, defects: int = 12) -> dict[str, Any]:
    return _project(avery, region="SG", brand=NORTHVANE, stores=SG_STORES, contract=(TIDEWAY, _cents(CONTRACT_SUM)), defects=defects)


def _join(app_url: str, avery: Api, mail: Any, role: str = "designer", **extra: Any) -> tuple[dict[str, Any], Api, str, str, str]:
    name, email = unique("member")
    _ok(avery.post("/api/invitations", {"email": email, "name": name, "role": role, **extra}), 201)
    token = _token(_content(_mails(mail, lambda m: email.lower() in _to(m))[0]), "invite")
    member = _ok(Api(app_url).post(f"/api/invitations/{token}/accept", {"name": name, "password": PASSWORD}), 201)["member"]
    return member, Api(app_url, email), name, email, token


def _request_stage(api: Api, pid: str, key: str = "groundwork") -> dict[str, Any]:
    return _ok(api.post(f"/api/projects/{pid}/stages/{key}/request", {}), 200)["stage"]


def _stages(api: Api, pid: str) -> dict[str, dict[str, Any]]:
    return {s["key"]: s for s in _ok(api.get(f"/api/projects/{pid}/stages"), 200)["stages"]}


def _upload_sheet(api: Api, pid: str, code: str, payload: bytes = PDF, name: str = "sheet.pdf", declared: str = "application/pdf",
                  title: str = "General arrangement plan") -> httpx.Response:
    return api.post(f"/api/projects/{pid}/sheet-revisions", files={"file": (name, payload, declared)},
                    data={"sheetCode": code, "title": title})


def _sheets(api: Api, pid: str) -> dict[str, dict[str, Any]]:
    return {s["code"]: s for s in _ok(api.get(f"/api/projects/{pid}/sheets"), 200)["sheets"]}


def _bidders(count: int) -> list[dict[str, str]]:
    result = []
    for _ in range(count):
        name, email = unique("bidder")
        result.append({"companyName": f"{name} Fit-Out", "contactName": name, "contactEmail": email})
    return result


def _bid(base: int, provisional: tuple[tuple[str, int], ...] = (), exclusions: tuple[str, ...] = ()) -> dict[str, Any]:
    return {"baseCents": base, "provisionalSums": [{"label": l, "amountCents": a} for l, a in provisional],
            "exclusions": [{"label": l} for l in exclusions]}


def _tender(lead: Api, pid: str, bidders: list[dict[str, str]], close_in: float = CLOSE_LEAD_SECONDS) -> dict[str, Any]:
    body = {"title": f"{_name('tender')} package", "scope": "Shopfront joinery", "closesAtLocal": _close_local(close_in),
            "contingencyPercent": "5.00", "bidders": bidders}
    tid = _ok(lead.post(f"/api/projects/{pid}/tenders", body), 201)["tender"]["id"]
    _ok(lead.post(f"/api/tenders/{tid}/publish", {}), 200)
    return _ok(lead.get(f"/api/tenders/{tid}"), 200)["tender"]


def _invitations(mail: Any, bidders: list[dict[str, str]], title: str) -> dict[str, dict[str, Any]]:
    found = {}
    for bidder in bidders:
        email = bidder["contactEmail"].lower()
        subject = f"Invitation to tender: {title} for {bidder['companyName']}"
        messages = _mails(mail, lambda m: email in _to(m) and _subject(m) == subject)
        assert len(messages) == 1
        found[email] = messages[0]
    return found


def _bidder_apis(app_url: str, mail: Any, bidders: list[dict[str, str]], title: str) -> list[Api]:
    invites = _invitations(mail, bidders, title)
    apis = []
    for bidder in bidders:
        api = Api(app_url)
        _ok(api.post("/api/tender-links/consume", {"token": _token(_content(invites[bidder["contactEmail"].lower()]), "tender-sign-in")}), 200)
        apis.append(api)
    return apis


def _wait_closed(lead: Api, tid: str) -> None:
    _poll(lambda: _ok(lead.get(f"/api/tenders/{tid}"), 200)["tender"]["status"] == "closed", CLOSE_LEAD_SECONDS * 3 + 30,
          "tender never closed")


def _closed_tender(app_url: str, mail: Any, lead: Api, pid: str, bids: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, str]], list[Api]]:
    bidders = _bidders(len(bids))
    tender = _tender(lead, pid, bidders)
    apis = _bidder_apis(app_url, mail, bidders, tender["title"])
    for api, bid in zip(apis, bids):
        _ok(api.post(f"/api/tenders/{tender['id']}/bid", bid), 201)
    _wait_closed(lead, tender["id"])
    return tender, bidders, apis


def _opened_tender(app_url: str, mail: Any, lead: Api, pid: str, bids: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, str]], list[Api]]:
    tender, bidders, apis = _closed_tender(app_url, mail, lead, pid, bids)
    _ok(lead.post(f"/api/tenders/{tender['id']}/open-bids", {}), 200)
    return tender, bidders, apis


def _levelling(lead: Api, tid: str) -> dict[str, dict[str, Any]]:
    return {b["reference"]: b for b in _ok(lead.get(f"/api/tenders/{tid}/levelling"), 200)["bids"]}


def _variation(api: Api, pid: str, amount: int, title: str | None = None) -> httpx.Response:
    body = {"title": title or f"{_name('variation')} works", "description": "Raised on site", "amountCents": amount, "storeCode": "SG-ORC-01"}
    return api.post(f"/api/projects/{pid}/variations", body, key=idempotency_key())


def _transition(api: Api, vid: str, action: str, reason: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"action": action}
    if reason:
        body["reason"] = reason
    return api.post(f"/api/variations/{vid}/transitions", body)


def _certificate(api: Api, pid: str, period: str, gross: int) -> httpx.Response:
    return api.post(f"/api/projects/{pid}/certificates", {"periodEnding": period, "grossValuationCents": gross})


def _submit_drawing(api: Api, pid: str, reference: str, received: str | None = None) -> httpx.Response:
    data = {"reference": reference, "title": "Display wall joinery"}
    if received:
        data["receivedAt"] = received
    return api.post(f"/api/projects/{pid}/shop-drawings", files={"file": ("drawing.pdf", PDF, "application/pdf")}, data=data)


def _site_walk(avery: Api, project: dict[str, Any] | None = None, store: str = "HK-CWB-01") -> tuple[dict[str, Any], dict[str, Any]]:
    project = project or _project(avery)
    viewpoint = _ok(avery.post(f"/api/projects/{project['id']}/viewpoints", {"name": f"VP-01 {_name('view')}", "storeCode": store}), 201)["viewpoint"]
    _ok(avery.put(f"/api/viewpoints/{viewpoint['id']}/render", files={"file": ("render.png", _png(RENDER_RGB), "image/png")}), 200)
    _ok(avery.post(f"/api/viewpoints/{viewpoint['id']}/photos", files={"file": ("photo.png", _png(PHOTO_RGB), "image/png")}), 201)
    return project, viewpoint


def _snag(api: Api, vid: str, s: int, y: int, title: str = "Shopfront mullion out of line") -> httpx.Response:
    return api.post(f"/api/viewpoints/{vid}/snags", {"s": s, "y": y, "title": title, "observedOn": _today().isoformat()})


def _finish(api: Api, pid: str, **fields: Any) -> dict[str, Any]:
    return _ok(api.post(f"/api/projects/{pid}/finishes", fields), 201)["finish"]


def _finishes(api: Api, pid: str) -> list[dict[str, Any]]:
    return sorted(_ok(api.get(f"/api/projects/{pid}/finishes"), 200)["finishes"], key=lambda f: f["position"])


def _seed_finishes(api: Api, pid: str) -> None:
    for code, name, category in SEED_FINISHES:
        _finish(api, pid, code=code, name=name, category=category)


def _case_study(avery: Api) -> dict[str, Any]:
    body = {"title": f"{_name('case')} Kestrel", "slug": f"probe-{uuid.uuid4().hex[:12]}", "sector": "food_beverage",
            "brandId": _lookup(avery, "/api/brands", "brands", KESTREL), "location": "Macao", "summary": "A tea house rollout.",
            "body": "Six stores signed off stage by stage.", "featured": True}
    return _ok(avery.post("/api/case-studies", body), 201)["caseStudy"]


def _preview(avery: Api, cid: str, seconds: float = 3600) -> tuple[dict[str, Any], str]:
    expires = _iso(datetime.now(timezone.utc) + timedelta(seconds=seconds))
    link = _ok(avery.post(f"/api/case-studies/{cid}/preview-links", {"expiresAt": expires}), 201)["previewLink"]
    return link, link["url"].rstrip("/").rsplit("/", 1)[-1]


def _published(app_url: str, avery: Api) -> tuple[dict[str, Any], str]:
    case = _case_study(avery)
    _, token = _preview(avery, case["id"])
    _ok(Api(app_url, DANA).post(f"/api/case-studies/{case['id']}/approve", {}), 200)
    _ok(avery.post(f"/api/case-studies/{case['id']}/publish", {}), 200)
    return case, token


def _enquiry(email: str | None = None, sites: int = SITES) -> dict[str, Any]:
    name, fresh = unique("enquirer")
    return {"name": name, "company": f"{name} Retail", "email": email or fresh, "phone": "+852 5550 0101", "sector": "retail",
            "region": "HK", "sites": sites, "openingMonth": _month(), "message": ENQUIRY_MESSAGE}


def test_wf_workspace_access_sign_in(browser: Browser, app_url: str) -> None:
    with _app(browser, app_url, "/sign-in") as page:
        _type(page, page.get_by_role("textbox", name="Email"), AVERY)
        password = page.get_by_label("Password", exact=True)
        _type(page, password, "wrong-password-probe")
        _press(page, page.get_by_role("button", name="Sign in"))
        _hear(page, "That email and password don't match. Check them and try again.", "alert")
        _url(page, r"/sign-in")
        assert page.request.get(f"{app_url}/api/session").status == 401
        _type(page, password, PASSWORD)
        _press(page, page.get_by_role("button", name="Sign in"))
        _url(page, r"/office(\?|$|#)")
        _visible(page, page.get_by_role("navigation", name="Workspace"))
        signed_in = page.request.get(f"{app_url}/api/session")
        assert signed_in.status == 200 and signed_in.json()["member"]["name"] == "Avery Tsang"
        _press(page, page.get_by_role("button", name="Sign out"))
        _url(page, r"/sign-in")
        assert page.request.get(f"{app_url}/api/session").status == 401


def test_wf_workspace_access_join(browser: Browser, app_url: str, mail: Any) -> None:
    avery = Api(app_url, AVERY)
    name, email = unique("invitee")
    _ok(avery.post("/api/invitations", {"email": email, "name": name, "role": "designer"}), 201)
    invite = _mails(mail, lambda m: email.lower() in _to(m) and _subject(m) == "You're invited to Marrow Hall Interiors on Plumbline")
    assert len(invite) == 1
    _single_recipient(invite[0])
    body = _content(invite[0])
    assert "Avery Tsang" in body and "designer" in body.lower()
    token = _token(body, "invite")
    with _app(browser, app_url, f"/invite/{token}") as page:
        _until(page, lambda: expect(page.get_by_text(email).first).to_be_visible(timeout=QUICK_MS))
        _type(page, page.get_by_role("textbox", name="Your name"), name)
        _type(page, page.get_by_label("Choose a password"), PASSWORD)
        _press(page, page.get_by_role("button", name="Join workspace"))
        _hear(page, f"Welcome to Marrow Hall Interiors, {name}.")
    joined = Api(app_url, email)
    assert _ok(joined.get("/api/session"), 200)["member"]["role"] == "designer"
    assert email.lower() in [m["email"].lower() for m in _ok(avery.get("/api/members"), 200)["members"]]
    _err(httpx.get(f"{app_url}/api/invitations/{token}"), 404, "not_found")


def test_member_admin(app_url: str, mail: Any) -> None:
    avery = Api(app_url, AVERY)
    me = _ok(avery.get("/api/session"), 200)["member"]
    member, member_api, name, email, token = _join(app_url, avery, mail)
    _err(Api(app_url).post(f"/api/invitations/{token}/accept", {"name": name, "password": PASSWORD}), 404, "not_found")
    _err(avery.post("/api/invitations", {"email": email, "name": name, "role": "designer"}), 409, "member_exists")
    short_name, short_email = unique("shortpw")
    _ok(avery.post("/api/invitations", {"email": short_email, "name": short_name, "role": "finance"}), 201)
    short_token = _token(_content(_mails(mail, lambda m: short_email.lower() in _to(m))[0]), "invite")
    _field(Api(app_url).post(f"/api/invitations/{short_token}/accept", {"name": short_name, "password": "short-pw"}), "password")
    _field(avery.post("/api/invitations", {"email": unique("ca")[1], "name": "No Brand", "role": "client_approver"}), "brandId")
    _field(avery.post("/api/invitations", {"email": unique("co")[1], "name": "No Company", "role": "contractor"}), "companyName")
    refused: list[str] = []
    for caller in (JORDAN, RIN, MORGAN, DANA, KAI):
        api = Api(app_url, caller)
        _, target = unique("refused")
        refused.append(target.lower())
        _err(api.post("/api/invitations", {"email": target, "name": "Refused", "role": "designer"}), 403, "forbidden")
        if caller in (JORDAN, RIN, MORGAN):
            _err(api.patch(f"/api/members/{member['id']}", {"version": 1, "role": "finance"}), 403, "forbidden")
            _err(api.delete(f"/api/members/{member['id']}"), 403, "forbidden")
    listed = next(m for m in _ok(avery.get("/api/members"), 200)["members"] if m["id"] == member["id"])
    version = listed.get("version", member.get("version", 1))
    limits = {"HKD": 1_000_000, "SGD": 200_000}
    edited = _ok(avery.patch(f"/api/members/{member['id']}", {"version": version, "role": "project_lead", "approvalLimits": limits}), 200)["member"]
    assert edited["role"] == "project_lead" and edited["approvalLimits"] == limits
    _err(avery.patch(f"/api/members/{member['id']}", {"version": version, "role": "designer"}), 412, "stale_version")
    _err(avery.patch(f"/api/members/{me['id']}", {"version": 1, "role": "designer"}), 409, "own_membership")
    _err(avery.delete(f"/api/members/{me['id']}"), 409, "own_membership")
    assert avery.delete(f"/api/members/{member['id']}").status_code == 204
    _err(member_api.get("/api/members"), 403, "access_removed")
    _quiet(mail, lambda m: any(a in refused for a in _to(m)))


MEMBER_STUDIO_FIELDS = {"id", "name", "email", "phone", "role", "organisation", "status", "approvalLimits"}
MEMBER_OUTSIDE_FIELDS = {"id", "name", "role", "organisation"}


def test_member_projection(app_url: str) -> None:
    for email, own_org, foreign in ((KAI, TIDEWAY, {HARBOURLINE, "Granite Pier Builders"}), (DANA, KESTREL, {NORTHVANE})):
        response = Api(app_url, email).get("/api/members")
        members = _ok(response, 200)["members"]
        assert members and all(set(m) <= MEMBER_OUTSIDE_FIELDS and MEMBER_OUTSIDE_FIELDS <= set(m) for m in members)
        orgs = {m["organisation"] for m in members}
        assert own_org in orgs and not orgs & foreign
        assert "@" not in response.text and "+852 5550" not in response.text and "+65 5550" not in response.text
    studio = {m["email"]: m for m in _ok(Api(app_url, MORGAN).get("/api/members"), 200)["members"]}
    assert MEMBER_STUDIO_FIELDS <= set(studio[JORDAN])
    assert studio[JORDAN]["approvalLimits"] == JORDAN_LIMITS and studio[JORDAN]["phone"] == "+852 5550 0102"
    assert studio[RIN]["approvalLimits"] is None and studio[RIN]["organisation"] == STUDIO_ORG
    assert studio[KAI]["organisation"] == TIDEWAY and studio[DANA]["organisation"] == KESTREL


def test_scoping(app_url: str, mail: Any) -> None:
    avery, lead, rin = Api(app_url, AVERY), Api(app_url, JORDAN), Api(app_url, RIN)
    dana, robin, kai, ash = (Api(app_url, e) for e in (DANA, ROBIN, KAI, ASH))
    unknown = _err(dana.get(f"/api/projects/{UNKNOWN_ID}"), 404, "not_found")
    hk = _project(avery)
    sg = _sg_contract(avery)
    for api, pid in ((dana, sg["id"]), (kai, hk["id"]), (ash, sg["id"]), (robin, hk["id"])):
        assert api.get(f"/api/projects/{pid}").json() == unknown
    _ok(dana.get(f"/api/projects/{hk['id']}"), 200)
    _ok(kai.get(f"/api/projects/{sg['id']}"), 200)
    code = _code("S")
    _ok(_upload_sheet(rin, sg["id"], code), 201)
    sheet = _sheets(rin, sg["id"])[code]
    file_path = f"/api/sheets/{sheet['id']}/revisions/A/file"
    assert dana.get(file_path).json() == unknown and ash.get(file_path).json() == unknown
    assert robin.get(file_path).status_code == 200
    variation = _ok(_variation(kai, sg["id"], 10_000), 201)["variation"]
    for api in (ash, dana):
        assert api.get(f"/api/variations/{variation['id']}").json() == unknown
    certificate = _ok(_certificate(lead, sg["id"], "2026-01-31", 1_000_000), 201)["certificate"]
    for api in (dana, ash):
        assert api.get(f"/api/certificates/{certificate['id']}").json() == unknown
    _ok(robin.get(f"/api/certificates/{certificate['id']}"), 200)
    ash_bidder = [{"companyName": HARBOURLINE, "contactName": "Ash Kwok", "contactEmail": ASH}]
    body = {"title": f"{_name('tender')} scope", "scope": "Joinery", "closesAtLocal": _close_local(3600), "contingencyPercent": "5.00", "bidders": ash_bidder}
    tid = _ok(lead.post(f"/api/projects/{hk['id']}/tenders", body), 201)["tender"]["id"]
    assert ash.get(f"/api/tenders/{tid}").json() == unknown
    _ok(lead.post(f"/api/tenders/{tid}/publish", {}), 200)
    _ok(ash.get(f"/api/tenders/{tid}"), 200)
    assert kai.get(f"/api/tenders/{tid}").json() == unknown


def test_stage_sequence(app_url: str) -> None:
    avery, lead, dana, robin = (Api(app_url, e) for e in (AVERY, JORDAN, DANA, ROBIN))
    pid = _project(avery)["id"]
    stages = _ok(lead.get(f"/api/projects/{pid}/stages"), 200)["stages"]
    assert [s["key"] for s in stages] == STAGE_KEYS
    assert all(s["state"] == "not_started" for s in stages[:6])
    assert _err(lead.post(f"/api/projects/{pid}/stages/scheme/request", {}), 409, "previous_stage_open")["stage"] == "groundwork"
    assert _err(dana.post(f"/api/projects/{pid}/stages/groundwork/sign-off", {}), 409, "illegal_transition")["from"] == "not_started"
    _err(dana.post(f"/api/projects/{pid}/stages/groundwork/return", {"reason": "Not ready"}), 409, "illegal_transition")
    assert _request_stage(lead, pid)["state"] == "requested"
    assert _err(lead.post(f"/api/projects/{pid}/stages/groundwork/request", {}), 409, "illegal_transition")["from"] == "requested"
    _err(lead.post(f"/api/projects/{pid}/stages/groundwork/sign-off", {}), 403, "forbidden")
    _err(robin.post(f"/api/projects/{pid}/stages/groundwork/sign-off", {}), 404, "not_found")
    _field(dana.post(f"/api/projects/{pid}/stages/groundwork/return", {}), "reason")
    reason = "Fix the plan"
    returned = _ok(dana.post(f"/api/projects/{pid}/stages/groundwork/return", {"reason": reason}), 200)["stage"]
    assert returned["state"] == "returned" and returned["returnedReason"] == reason
    assert _request_stage(lead, pid)["state"] == "requested"
    assert _ok(dana.post(f"/api/projects/{pid}/stages/groundwork/sign-off", {}), 200)["stage"]["state"] == "signed_off"
    _err(dana.post(f"/api/projects/{pid}/stages/groundwork/sign-off", {}), 409, "already_signed_off")
    _err(dana.post(f"/api/projects/{pid}/stages/groundwork/return", {"reason": "Late"}), 409, "illegal_transition")
    _err(lead.post(f"/api/projects/{pid}/stages/groundwork/request", {}), 409, "illegal_transition")
    assert _err(lead.post(f"/api/projects/{pid}/stages/detailing/request", {}), 409, "previous_stage_open")["stage"] == "scheme"
    assert _request_stage(lead, pid, "scheme")["state"] == "requested"
    current = next(p for p in _ok(lead.get("/api/overview"), 200)["projects"] if p["id"] == pid)["currentStage"]
    assert current in ("scheme", "Scheme")


def test_sign_off_effects(app_url: str, mail: Any, killbill: Any) -> None:
    avery, lead, dana = Api(app_url, AVERY), Api(app_url, JORDAN), Api(app_url, DANA)
    project = _project(avery)
    pid, ref = project["id"], project["reference"]
    note = f"Courtesy discount {_name('note')} do not quote"
    _ok(lead.patch(f"/api/projects/{pid}/stages/groundwork", {"internalNote": note}), 200)
    _request_stage(lead, pid)
    assert all("internalNote" not in s for s in _ok(dana.get(f"/api/projects/{pid}/stages"), 200)["stages"])
    stage = _ok(dana.post(f"/api/projects/{pid}/stages/groundwork/sign-off", {}), 200)["stage"]
    invoice = stage["invoice"]
    assert stage["state"] == "signed_off" and invoice["amountCents"] == HK_FEES["groundwork"] and invoice["currency"] == "HKD"
    account = killbill.account_by_key(f"plumbline-{ref}")
    assert account and account.get("name") == f"{KESTREL} - {project['name']}" and account.get("currency") == "HKD"
    invoices = _kb_invoices(account["accountId"])
    assert len(invoices) == 1 and invoices[0]["invoiceId"] == invoice["killbillInvoiceId"]
    items = [(i["description"], Decimal(str(i["amount"])), i["currency"]) for i in invoices[0].get("items") or []]
    assert items == [(f"{ref} Groundwork stage fee", Decimal("60000.00"), "HKD")]
    receipts = _mails(mail, lambda m: _subject(m) == f"Signed off: {ref} Groundwork")
    assert len(receipts) == 1 and _to(receipts[0]) == [DANA]
    _single_recipient(receipts[0])
    content = _content(receipts[0])
    for part in (project["name"], "Groundwork", GROUNDWORK_FEE, str(invoice["invoiceNumber"]), "Dana Cheung", _fmt_time(stage["signedOffAt"])):
        assert part in content, part
    assert note not in content and SCHEME_FEE not in content
    other = _project(avery)
    _request_stage(lead, other["id"])
    down = Api(os.environ["APP_KILLBILL_DOWN_URL"], DANA)
    _err(down.post(f"/api/projects/{other['id']}/stages/groundwork/sign-off", {}), 503, "billing_unavailable")
    assert _stages(lead, other["id"])["groundwork"]["state"] == "requested"
    assert killbill.account_by_key(f"plumbline-{other['reference']}") is None
    _quiet(mail, lambda m: _subject(m) == f"Signed off: {other['reference']} Groundwork")


def test_sign_off_race(app_url: str, mail: Any, killbill: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    project = _project(avery)
    pid = project["id"]
    _request_stage(lead, pid)
    callers = [Api(app_url, e) for e in (DANA, QUINN, DANA, QUINN)]
    names = {DANA: "Dana Cheung", QUINN: "Quinn Yeo"}
    barrier = threading.Barrier(len(callers), timeout=HTTP_SECONDS)
    results: list[tuple[str, httpx.Response]] = []

    def run(api: Api) -> None:
        barrier.wait()
        results.append((api.email or "", api.post(f"/api/projects/{pid}/stages/groundwork/sign-off", {})))

    threads = [threading.Thread(target=run, args=(a,)) for a in callers]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_SECONDS)
    assert sorted(r.status_code for _, r in results) == [200, 409, 409, 409]
    winner_email, winner = next((e, r) for e, r in results if r.status_code == 200)
    signed_at = winner.json()["stage"]["signedOffAt"]
    for _, loser in (x for x in results if x[1].status_code == 409):
        body = _err(loser, 409, "already_signed_off")
        assert body["by"] == names[winner_email] and body["at"] == signed_at
    account = killbill.account_by_key(f"plumbline-{project['reference']}")
    assert account and len(_kb_invoices(account["accountId"])) == 1
    receipts = _mails(mail, lambda m: _subject(m) == f"Signed off: {project['reference']} Groundwork")
    assert len(receipts) == 1 and _to(receipts[0]) == [winner_email]


def test_wf_stage_gates_keyboard_sign_off(browser: Browser, app_url: str, killbill: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    project = _project(avery)
    pid = project["id"]
    with _app(browser, app_url, f"/office/projects/{pid}/stages", lead) as page:
        _press(page, page.get_by_role("button", name=f"Request sign-off for {GROUNDWORK}"))
        dialog = page.get_by_role("dialog", name=f"Request sign-off for {GROUNDWORK}")
        message = dialog.get_by_role("textbox", name="Message to approvers")
        _focus(page, message)
        _audit(page)
        page.keyboard.type("Groundwork pack attached.")
        _press(page, dialog.get_by_role("button", name="Send request"))
        _hear(page, "Sign-off requested for Groundwork.")
        _focus(page, page.get_by_role("heading", name="Groundwork", exact=True))
    assert _stages(lead, pid)["groundwork"]["state"] == "requested"
    with _app(browser, app_url, f"/office/projects/{pid}/stages", Api(app_url, DANA)) as page:
        opener = page.get_by_role("button", name="Sign off Groundwork", exact=True)
        _press(page, opener)
        dialog = page.get_by_role("dialog", name="Sign off Groundwork")
        _visible(page, dialog)
        _until(page, lambda: _check(dialog.evaluate("d => d.contains(document.activeElement)", timeout=QUICK_MS), "focus never entered the dialog"))
        page.keyboard.press("Escape")
        _until(page, lambda: expect(dialog).to_be_hidden(timeout=QUICK_MS))
        _focus(page, opener)
        _press(page, opener)
        _until(page, lambda: expect(dialog).to_contain_text(GROUNDWORK_FEE, timeout=QUICK_MS))
        _audit(page)
        _press(page, dialog.get_by_role("button", name="Confirm sign-off"))
        _hear(page, re.compile(rf"Groundwork signed off\. Invoice \S+ raised; a receipt is on its way to {re.escape(DANA)}\."))
        _focus(page, page.get_by_role("heading", name="Groundwork", exact=True))
    stage = _stages(lead, pid)["groundwork"]
    dana = _ok(Api(app_url, DANA).get("/api/session"), 200)["member"]
    assert stage["state"] == "signed_off" and _identifies(stage["signedOffBy"], dana, DANA)
    account = killbill.account_by_key(f"plumbline-{project['reference']}")
    assert account and len(_kb_invoices(account["accountId"])) == 1


def test_wf_stage_gates_lost_race(browser: Browser, app_url: str, killbill: Any) -> None:
    avery, lead, quinn = Api(app_url, AVERY), Api(app_url, JORDAN), Api(app_url, QUINN)
    project = _project(avery)
    pid = project["id"]
    _request_stage(lead, pid)
    with _app(browser, app_url, f"/office/projects/{pid}/stages", Api(app_url, DANA)) as page:
        _press(page, page.get_by_role("button", name="Sign off Groundwork", exact=True))
        dialog = page.get_by_role("dialog", name="Sign off Groundwork")
        _visible(page, dialog)
        won = _ok(quinn.post(f"/api/projects/{pid}/stages/groundwork/sign-off", {}), 200)["stage"]
        _press(page, dialog.get_by_role("button", name="Confirm sign-off"))
        _hear(page, f"Quinn Yeo already signed off Groundwork on {_fmt_time(won['signedOffAt'])}.", "alert")
        _focus(page, page.get_by_role("heading", name="Groundwork", exact=True))
    account = killbill.account_by_key(f"plumbline-{project['reference']}")
    assert account and len(_kb_invoices(account["accountId"])) == 1


def test_wf_stage_gates_billing_outage_phone(browser: Browser, app_url: str, killbill: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    project = _project(avery)
    pid = project["id"]
    _request_stage(lead, pid)
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    with _app(browser, down, f"/office/projects/{pid}/stages", Api(down, DANA), viewport=PHONE) as page:
        tap(page.get_by_role("button", name="Sign off Groundwork", exact=True).first)
        sheet = page.get_by_role("dialog", name="Sign off Groundwork")
        _visible(page, sheet)
        _steady(page, lambda: tap(sheet.get_by_role("button", name="Confirm sign-off")))
        _hear(page, "Billing is unreachable, so Groundwork wasn't signed off. Nothing was recorded; try again in a few minutes.", "alert")
        _visible(page, sheet)
        _first_button(page, sheet)
        _audit(page)
        _screen_layout(page)
    assert _stages(lead, pid)["groundwork"]["state"] == "requested"
    assert killbill.account_by_key(f"plumbline-{project['reference']}") is None


def test_sheet_revisions(app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    code = _code("A")
    expected = _revisions(25)
    folder_name = "../plans/plan.pdf"
    for index, letter in enumerate(expected):
        name = folder_name if index == 0 else f"plan-{letter}.pdf"
        revision = _ok(_upload_sheet(rin, pid, code, PDF + letter.encode(), name), 201)["revision"]
        assert revision["revision"] == letter
    sheet = _sheets(rin, pid)[code]
    history = {r["revision"]: r for r in sheet["revisions"]}
    assert sheet["currentRevision"] == "AA" and set(history) == set(expected)
    assert history["AA"]["state"] != "superseded" and all(history[l]["state"] == "superseded" for l in expected[:-1])
    assert history["A"]["originalName"] == folder_name.rsplit("/", 1)[-1]
    _err(rin.patch(f"/api/sheets/{sheet['id']}/revisions/Z", {"note": "late"}), 409, "superseded_read_only")
    assert _ok(rin.patch(f"/api/sheets/{sheet['id']}/revisions/AA", {"note": "current"}), 200)["revision"]["note"] == "current"
    keys = _bucket().keys(f"projects/{pid}/sheets/{code}/")
    assert sorted(keys) == sorted(f"projects/{pid}/sheets/{code}/{l}.pdf" for l in expected)


def test_sheet_uploads_content(app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    bucket = _bucket()
    accepted = [("plan.png", PDF, "image/png", "application/pdf", "pdf"),
                ("render.pdf", _png(RENDER_RGB), "application/pdf", "image/png", "png"),
                ("site.svg", _jpeg(PHOTO_RGB), "image/svg+xml", "image/jpeg", "jpg"),
                ("elevation.txt", OK_SVG.encode(), "text/plain", "image/svg+xml", "svg")]
    for name, payload, declared, served, ext in accepted:
        code = _code("C")
        revision = _ok(_upload_sheet(rin, pid, code, payload, name, declared), 201)["revision"]
        assert revision["contentType"] == served and revision["bytes"] == len(payload)
        assert _sha256_of(revision["sha256"], payload)
        sheet = _sheets(rin, pid)[code]
        file = rin.get(f"/api/sheets/{sheet['id']}/revisions/A/file")
        assert file.status_code == 200 and file.content == payload and file.headers["content-type"].startswith(served)
        assert file.headers.get("x-content-type-options") == "nosniff"
        if ext == "svg":
            assert "sandbox" in file.headers.get("content-security-policy", "")
        assert bucket.get(f"projects/{pid}/sheets/{code}/A.{ext}") == payload
    refused = [("plan.pdf", b"plain text, not a drawing", "plan.pdf isn't a PDF, PNG, JPEG or SVG file."),
               ("page.svg", b"<html><svg/></html>", "page.svg isn't a PDF, PNG, JPEG or SVG file.")]
    refused += [("elevation.svg", svg.encode(), "elevation.svg contains scripts, so it wasn't accepted.") for svg in SCRIPT_SVGS]
    for name, payload, copy in refused:
        code = _code("R")
        _field(_upload_sheet(rin, pid, code, payload, name, "image/svg+xml"), "file", copy)
        assert code not in _sheets(rin, pid) and not bucket.keys(f"projects/{pid}/sheets/{code}/")
    exact = PDF + b"0" * (FILE_LIMIT - len(PDF))
    _ok(_upload_sheet(rin, pid, _code("L"), exact, "big.pdf"), 201)
    over = _code("O")
    assert _err(_upload_sheet(rin, pid, over, exact + b"0", "big.pdf"), 413, "file_too_large")["limitBytes"] == FILE_LIMIT
    assert over not in _sheets(rin, pid)
    down = Api(os.environ["APP_MINIO_DOWN_URL"], RIN)
    lost = _code("D")
    _err(_upload_sheet(down, pid, lost), 503, "storage_unavailable")
    assert lost not in _sheets(rin, pid) and not bucket.keys(f"projects/{pid}/sheets/{lost}/")
    existing = next(iter(_sheets(rin, pid).values()))
    _err(down.get(f"/api/sheets/{existing['id']}/revisions/A/file"), 503, "storage_unavailable")


def test_transmittal(app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    bucket = _bucket()
    plan, elevation = _code("A"), _code("E")
    _ok(_upload_sheet(rin, pid, plan), 201)
    _ok(_upload_sheet(rin, pid, elevation, OK_SVG.encode(), "elevation.svg", "image/svg+xml"), 201)
    sheets = _sheets(rin, pid)
    path = f"/api/projects/{pid}/transmittals"
    _field(rin.post(path, {"purpose": "for_tender"}), "idempotencyKey")
    key = idempotency_key()
    body = {"purpose": "for_tender", "sheetRevisions": [{"sheetId": sheets[c]["id"], "revision": "A"} for c in (plan, elevation)]}
    first = rin.post(path, body, key=key)
    transmittal = _ok(first, 201)["transmittal"]
    assert transmittal["number"] == "T-001"
    assert rin.post(path, body, key=key).json() == first.json()
    zips = bucket.keys(f"projects/{pid}/transmittals/")
    assert zips == [f"projects/{pid}/transmittals/T-001.zip"]
    archive_bytes = bucket.get(zips[0])
    assert transmittal["zipBytes"] == len(archive_bytes) and _sha256_of(transmittal["zipSha256"], archive_bytes)
    archive = zipfile.ZipFile(io.BytesIO(archive_bytes))
    assert set(archive.namelist()) == {f"{plan}_A.pdf", f"{elevation}_A.svg", "manifest.csv"}
    manifest = list(csv.DictReader(io.StringIO(archive.read("manifest.csv").decode("utf-8-sig"))))
    assert list(manifest[0]) == ["sheet", "revision", "file", "bytes", "sha256"]
    for row in manifest:
        entry = archive.read(row["file"])
        assert int(row["bytes"]) == len(entry) and row["sha256"] == hashlib.sha256(entry).hexdigest() and row["revision"] == "A"
    assert sorted(r["sheet"] for r in manifest) == sorted([plan, elevation])
    download = rin.get(f"/api/transmittals/{transmittal['id']}/zip")
    assert download.status_code == 200 and download.content == archive_bytes and download.headers["content-type"].startswith("application/zip")
    _ok(_upload_sheet(rin, pid, plan), 201)
    _field(rin.post(path, body, key=idempotency_key()), "sheetRevisions", "Only current revisions can be issued.")
    second = _ok(rin.post(path, {"purpose": "for_construction"}, key=idempotency_key()), 201)["transmittal"]
    assert second["number"] == "T-002" and {(s["code"], s["revision"]) for s in second["sheets"]} == {(plan, "B"), (elevation, "A")}
    down = Api(os.environ["APP_MINIO_DOWN_URL"], RIN)
    _err(down.post(path, {"purpose": "for_information"}, key=idempotency_key()), 503, "storage_unavailable")
    assert len(bucket.keys(f"projects/{pid}/transmittals/")) == 2
    assert len(_ok(rin.get(path), 200)["transmittals"]) == 2


def test_wf_drawing_register_multi_upload(browser: Browser, app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    good = [f"{_code('A')}.pdf" for _ in range(4)]
    bad = "site-notes.txt"
    files = [{"name": n, "mimeType": "application/pdf", "buffer": PDF} for n in good[:2]]
    files.append({"name": bad, "mimeType": "application/pdf", "buffer": b"plain text"})
    files += [{"name": n, "mimeType": "application/pdf", "buffer": PDF} for n in good[2:]]
    with _app(browser, app_url, f"/office/projects/{pid}/drawings", rin) as page:
        register = page.get_by_role("table", name="Drawing register")
        _visible(page, register)
        _audit(page)
        with _entered(held(page, "**/api/projects/*/sheet-revisions")) as gate:
            page.get_by_label("Sheet files").set_input_files(files)
            _hear(page, re.compile(r"Uploading [1-5] of 5: "))
            _until(page, lambda: expect(register).to_contain_text("Uploading", timeout=QUICK_MS))
            gate.release()
        _hear(page, "4 of 5 files uploaded.")
        _hear(page, f"{bad} wasn't uploaded: {bad} isn't a PDF, PNG, JPEG or SVG file.", "alert")
        _until(page, lambda: expect(register).not_to_contain_text("Uploading", timeout=QUICK_MS))
        _until(page, lambda: expect(register).not_to_contain_text(bad, timeout=QUICK_MS))
    sheets = _ok(rin.get(f"/api/projects/{pid}/sheets"), 200)["sheets"]
    names = {r["originalName"] for s in sheets for r in s["revisions"]}
    assert len(sheets) == 4 and names == set(good)


def test_wf_drawing_register_issue_set(browser: Browser, app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    code = _code("A")
    _ok(_upload_sheet(rin, pid, code), 201)
    with _app(browser, app_url, f"/office/projects/{pid}/drawings", rin) as page:
        opener = page.get_by_role("button", name="Issue set")
        _press(page, opener)
        dialog = page.get_by_role("dialog", name="Issue set")
        _visible(page, dialog)
        _until(page, lambda: _check(dialog.evaluate("d => d.contains(document.activeElement)", timeout=QUICK_MS), "focus never entered the dialog"))
        page.keyboard.press("Escape")
        _until(page, lambda: expect(dialog).to_be_hidden(timeout=QUICK_MS))
        _focus(page, opener)
        _press(page, opener)
        box = dialog.get_by_role("checkbox", name=f"{code} rev A")
        _tab_to(page, box)
        if not box.is_checked():
            page.keyboard.press("Space")
        _choose(dialog.get_by_role("combobox", name="Purpose"), "For tender")
        _audit(page)
        _press(page, dialog.get_by_role("button", name="Issue transmittal"))
        _hear(page, "Transmittal T-001 issued with 1 sheets.")
        number = "T-001"
        _focus(page, page.get_by_role("link", name=f"Download {number}"))
    transmittals = _ok(rin.get(f"/api/projects/{pid}/transmittals"), 200)["transmittals"]
    assert [(t["number"], t["purpose"]) for t in transmittals] == [("T-001", "for_tender")]
    assert _bucket().keys(f"projects/{pid}/transmittals/") == [f"projects/{pid}/transmittals/T-001.zip"]


def test_wf_drawing_register_storage_outage(browser: Browser, app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    name = f"{_code('A')}.pdf"
    down = os.environ["APP_MINIO_DOWN_URL"]
    with _app(browser, down, f"/office/projects/{pid}/drawings", Api(down, RIN)) as page:
        register = page.get_by_role("table", name="Drawing register")
        _visible(page, register)
        page.get_by_label("Sheet files").set_input_files([{"name": name, "mimeType": "application/pdf", "buffer": PDF}])
        _hear(page, f"File storage is unreachable, so {name} wasn't uploaded. Nothing was saved.", "alert")
        _until(page, lambda: expect(register).not_to_contain_text("Uploading", timeout=QUICK_MS))
    assert _ok(rin.get(f"/api/projects/{pid}/sheets"), 200)["sheets"] == []
    assert not _bucket().keys(f"projects/{pid}/sheets/")


def test_tender_lifecycle(app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    draft_body = {"title": f"{_name('tender')} draft", "scope": "Joinery", "contingencyPercent": "5.00", "bidders": _bidders(1)}
    draft = _ok(lead.post(f"/api/projects/{pid}/tenders", draft_body), 201)["tender"]
    assert draft["status"] == "draft"
    _field(lead.post(f"/api/tenders/{draft['id']}/publish", {}), "closesAtLocal")
    bidders = _bidders(2)
    tender = _tender(lead, pid, bidders)
    tid = tender["id"]
    assert tender["status"] == "open" and tender["timeZone"] == "Asia/Hong_Kong"
    assert _parse(tender["closesAt"]) == _utc_of_local(tender["closesAtLocal"])
    first, second = _bidder_apis(app_url, mail, bidders, tender["title"])
    first_base = 500_000
    first_bid = _ok(first.post(f"/api/tenders/{tid}/bid", _bid(first_base)), 201)["bid"]
    _err(lead.post(f"/api/tenders/{tid}/publish", {}), 409, "illegal_transition")
    assert _err(lead.post(f"/api/tenders/{tid}/open-bids", {}), 409, "tender_still_open")["closesAt"] == tender["closesAt"]
    _err(lead.post(f"/api/tenders/{tid}/award", {"bidId": first_bid["id"]}), 409, "illegal_transition")
    _wait_closed(lead, tid)
    late = _err(first.put(f"/api/tenders/{tid}/bid", _bid(400_000)), 409, "tender_closed")
    assert _parse(late["closedAt"]) == _parse(tender["closesAt"])
    _err(second.post(f"/api/tenders/{tid}/bid", _bid(300_000)), 409, "tender_closed")
    assert _ok(first.get(f"/api/tenders/{tid}/bid"), 200)["bid"]["baseCents"] == first_base
    assert _ok(second.get(f"/api/tenders/{tid}/bid"), 200)["bid"] is None
    _err(lead.patch(f"/api/tenders/{tid}", {"closesAtLocal": _close_local(3600)}), 409, "illegal_transition")
    assert _ok(lead.post(f"/api/tenders/{tid}/open-bids", {}), 200)["tender"]["status"] == "opened"
    _err(lead.post(f"/api/tenders/{tid}/open-bids", {}), 409, "illegal_transition")


def test_sealed_bids(app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    bidders = _bidders(2)
    tender = _tender(lead, pid, bidders)
    tid = tender["id"]
    first, second = _bidder_apis(app_url, mail, bidders, tender["title"])
    assert _ok(second.get(f"/api/tenders/{tid}/bid"), 200)["bid"] is None
    bid = _ok(first.post(f"/api/tenders/{tid}/bid", _bid(SEALED_BASE)), 201)["bid"]
    _err(first.post(f"/api/tenders/{tid}/bid", _bid(SEALED_BASE)), 409, "bid_exists")
    amended = _ok(first.put(f"/api/tenders/{tid}/bid", _bid(SEALED_BASE + 100)), 200)["bid"]
    assert amended["baseCents"] == SEALED_BASE + 100 and _parse(amended["finalSubmittedAt"]) >= _parse(bid["finalSubmittedAt"])
    secrets = (str(SEALED_BASE + 100), _plain(SEALED_BASE + 100), str(SEALED_BASE), _plain(SEALED_BASE))
    rival = second.get(f"/api/tenders/{tid}")
    view = _ok(rival, 200)["tender"]
    assert "bidders" not in view and not view.get("myBid") and not any(s in rival.text for s in secrets)
    studio = lead.get(f"/api/tenders/{tid}")
    detail = _ok(studio, 200)["tender"]
    assert not any(s in studio.text for s in secrets)
    b01 = next(b for b in detail["bidders"] if b["reference"] == "B-01")
    assert b01["hasBid"] is True and b01["finalSubmittedAt"] == amended["finalSubmittedAt"]
    assert next(b for b in detail["bidders"] if b["reference"] == "B-02")["hasBid"] is False
    _err(lead.get(f"/api/tenders/{tid}/levelling"), 409, "tender_not_opened")
    _err(lead.get(f"/api/tenders/{tid}/levelling.csv"), 409, "tender_not_opened")
    _err(second.get(f"/api/tenders/{tid}/levelling"), 403, "forbidden")
    _wait_closed(lead, tid)
    _ok(lead.post(f"/api/tenders/{tid}/open-bids", {}), 200)
    assert _levelling(lead, tid)["B-01"]["baseCents"] == SEALED_BASE + 100
    _err(first.get(f"/api/tenders/{tid}/levelling"), 403, "forbidden")
    assert not any(s in json.dumps(_ok(second.get(f"/api/tenders/{tid}"), 200)) for s in secrets)


def test_tender_invitations_ics(app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    project = _project(avery)
    pid = project["id"]
    evil = _bidders(1)
    evil[0]["companyName"] = "Evil Fit-Out\r\nBcc: someone@example.com"
    title = f"{_name('tender')} package"
    body = {"title": title, "scope": "Joinery", "closesAtLocal": _close_local(3600), "contingencyPercent": "5.00", "bidders": evil}
    _field(lead.post(f"/api/projects/{pid}/tenders", body), "bidders[0].companyName", "Company name must be on one line.")
    _field(lead.post(f"/api/projects/{pid}/tenders", {**body, "title": "Two\nlines", "bidders": _bidders(1)}), "title",
           "Tender title must be on one line.")
    studio_bidder = [{"companyName": "Studio Co", "contactName": "Rin Mok", "contactEmail": RIN}]
    _field(lead.post(f"/api/projects/{pid}/tenders", {**body, "bidders": studio_bidder}), "bidders[0].contactEmail")
    assert not [t for t in _ok(lead.get(f"/api/projects/{pid}/tenders"), 200)["tenders"] if t["title"] == title]
    bidders = _bidders(2)
    tender = _tender(lead, pid, bidders, close_in=3600)
    tid = tender["id"]
    invites = _invitations(mail, bidders, tender["title"])
    for own, other in ((bidders[0], bidders[1]), (bidders[1], bidders[0])):
        message = invites[own["contactEmail"].lower()]
        _single_recipient(message)
        content = _content(message)
        for part in (tender["title"], project["name"], "Shopfront joinery", _fmt_local(tender["closesAtLocal"]), "/tender-sign-in/"):
            assert part in content, part
        for leak in (other["companyName"], other["contactName"], other["contactEmail"]):
            assert leak not in content
        attachment = next(a for a in message.get("Attachments") or [] if a.get("FileName") == "tender-close.ics")
        assert attachment.get("ContentType", "").startswith("text/calendar")
        ics = _ics(message)
        assert f"UID:tender-{tid}@plumbline" in ics and "SEQUENCE:0" in ics
        assert f"DTSTART:{_parse(tender['closesAt']):%Y%m%dT%H%M%SZ}" in ics and f"SUMMARY:Tender closes: {tender['title']}" in ics
    _field(lead.patch(f"/api/tenders/{tid}", {"closesAtLocal": _close_local(-60)}), "closesAtLocal", "Choose a close time after now.")
    moved_local = _close_local(7200)
    moved = _ok(lead.patch(f"/api/tenders/{tid}", {"closesAtLocal": moved_local}), 200)["tender"]
    assert moved["icsSequence"] == tender["icsSequence"] + 1
    for bidder in bidders:
        email = bidder["contactEmail"].lower()
        found = _mails(mail, lambda m: email in _to(m) and _subject(m) == f"Tender close moved: {tender['title']}")
        assert len(found) == 1
        content = _content(found[0])
        assert _fmt_local(moved_local) in content
        assert _token(content, "tender-sign-in") != _token(_content(invites[email]), "tender-sign-in")
        ics = _ics(found[0])
        assert f"UID:tender-{tid}@plumbline" in ics and f"SEQUENCE:{moved['icsSequence']}" in ics
        assert f"DTSTART:{_utc_of_local(moved_local):%Y%m%dT%H%M%SZ}" in ics
    _quiet(mail, lambda m: evil[0]["contactEmail"].lower() in _to(m))


def test_tender_links_single_use(app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    bidders = _bidders(1)
    tender = _tender(lead, pid, bidders, close_in=3600)
    token = _token(_content(_invitations(mail, bidders, tender["title"])[bidders[0]["contactEmail"].lower()]), "tender-sign-in")
    assert httpx.get(f"{app_url}/tender-sign-in/{token}").status_code == 200
    first = Api(app_url)
    assert _ok(first.post("/api/tender-links/consume", {"token": token}), 200)["tenderId"] == tender["id"]
    _ok(first.get(f"/api/tenders/{tender['id']}"), 200)
    unknown = _err(Api(app_url).post("/api/tender-links/consume", {"token": f"{token}x"}), 404, "not_found")
    assert Api(app_url).post("/api/tender-links/consume", {"token": token}).json() == unknown
    with _app_copy({"TENDER_LINK_TTL_SECONDS": str(LINK_TTL_PROBE)}) as copy:
        copy_lead = Api(copy, JORDAN)
        pair = _bidders(2)
        copied = _tender(copy_lead, pid, pair, close_in=3600)
        invites = _invitations(mail, pair, copied["title"])
        fresh = _token(_content(invites[pair[0]["contactEmail"].lower()]), "tender-sign-in")
        stale = _token(_content(invites[pair[1]["contactEmail"].lower()]), "tender-sign-in")
        _ok(Api(copy).post("/api/tender-links/consume", {"token": fresh}), 200)
        _elapse(LINK_TTL_PROBE + 1)
        assert Api(copy).post("/api/tender-links/consume", {"token": stale}).json() == unknown


def test_wf_sealed_tender_keyboard_setup(browser: Browser, app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    bidders = _bidders(3)
    title = f"{_name('tender')} package"
    moved_local = _close_local(7200)
    with _app(browser, app_url, f"/office/projects/{pid}/tenders", lead) as page:
        _press(page, page.get_by_role("button", name="New tender"))
        _type(page, page.get_by_role("textbox", name="Tender title"), title)
        _type(page, page.get_by_role("textbox", name="Scope"), "Shopfront joinery")
        _audit(page)
        close = page.get_by_label("Close date and time")
        _tab_to(page, close)
        close.fill(_close_local(3600))
        _type(page, page.get_by_role("textbox", name="Contingency percent"), "5.00")
        for n, bidder in enumerate(bidders, start=1):
            group = page.get_by_role("group", name=f"Bidder {n}")
            if not group.count():
                _press(page, page.get_by_role("button", name="Add bidder"))
            _type(page, group.get_by_role("textbox", name="Company name"), bidder["companyName"])
            _type(page, group.get_by_role("textbox", name="Contact name"), bidder["contactName"])
            _type(page, group.get_by_role("textbox", name="Contact email"), bidder["contactEmail"])
        _press(page, page.get_by_role("button", name="Save draft"))
        _hear(page, "Tender draft saved.")
        _focus(page, page.get_by_role("button", name="Publish tender"))
        page.keyboard.press("Enter")
        _press(page, page.get_by_role("dialog", name="Publish tender").get_by_role("button", name="Publish and send invitations"))
        _hear(page, "Tender published. Invitations sent to 3 bidders.")
        _focus(page, page.get_by_role("heading", name="Tender status", exact=True))
        _press(page, page.get_by_role("button", name="Move close"))
        dialog = page.get_by_role("dialog", name="Move close")
        field = dialog.get_by_label("Close date and time")
        _tab_to(page, field)
        field.fill(_close_local(-PAST_HOURS * 3600))
        _press(page, dialog.get_by_role("button", name="Save new close"))
        _refused(page, dialog, "Choose a close time after now.")
        _audit(page)
        _tab_to(page, field)
        field.fill(moved_local)
        _press(page, dialog.get_by_role("button", name="Save new close"))
        _hear(page, f"Close moved to {_fmt_local(moved_local)}. Updated invitations sent to 3 bidders.")
        _focus(page, page.get_by_role("button", name="Move close"))
    tender = next(t for t in _ok(lead.get(f"/api/projects/{pid}/tenders"), 200)["tenders"] if t["title"] == title)
    detail = _ok(lead.get(f"/api/tenders/{tender['id']}"), 200)["tender"]
    assert detail["status"] == "open" and detail["closesAtLocal"] == moved_local and detail["icsSequence"] == 1
    assert len(_invitations(mail, bidders, title)) == 3
    moves = _mails(mail, lambda m: _subject(m) == f"Tender close moved: {title}", count=3)
    assert sorted(a for m in moves for a in _to(m)) == sorted(b["contactEmail"].lower() for b in bidders)


def test_wf_sealed_tender_contractor_bid_late(browser: Browser, app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    bidders = _bidders(1)
    tender = _tender(lead, pid, bidders, close_in=CLOSE_LEAD_SECONDS * 2)
    token = _token(_content(_invitations(mail, bidders, tender["title"])[bidders[0]["contactEmail"].lower()]), "tender-sign-in")
    with _app(browser, app_url, f"/tender-sign-in/{token}") as page:
        _until(page, lambda: expect(page.get_by_text(tender["title"]).first).to_be_visible(timeout=QUICK_MS))
        _audit(page)
        _press(page, page.get_by_role("button", name="Continue to tender"))
        _url(page, rf"/office/tenders/{tender['id']}")
        _listen(page)
        _visible(page, page.get_by_role("textbox", name="Base amount"))
        _audit(page)
        _type(page, page.get_by_role("textbox", name="Base amount"), "1250.00")
        _press(page, page.get_by_role("button", name="Submit bid"))
        _hear(page, re.compile(rf"Bid submitted at {TIME_RE}\."))
        _type(page, page.get_by_role("textbox", name="Base amount"), "1300.00")
        _press(page, page.get_by_role("button", name="Submit amendment"))
        _hear(page, re.compile(rf"Bid amended at {TIME_RE}\. Your latest amendment is the one that counts\."))
        _wait_closed(lead, tender["id"])
        _type(page, page.get_by_role("textbox", name="Base amount"), "1350.00")
        _press(page, page.get_by_role("button", name="Submit amendment"))
        _hear(page, f"This tender closed at {_fmt_local(tender['closesAtLocal'])}. Late bids and amendments can't be accepted.", "alert")
    _ok(lead.post(f"/api/tenders/{tender['id']}/open-bids", {}), 200)
    assert _levelling(lead, tender["id"])["B-01"]["baseCents"] == _cents("1300.00")


LEVEL_BIDS = [
    _bid(1_000_000, (("Signage", 100_000),), ("Out of hours works",)),
    _bid(950_200),
    _bid(950_200),
]


def _expected_level(base: int, provisional: int, allowances: int, priced: int, percent: str) -> tuple[int, int, int]:
    subtotal = base - provisional + allowances + priced
    contingency = _half_up(Decimal(subtotal) * Decimal(percent) / 100)
    return subtotal, contingency, subtotal + contingency


def test_levelling_totals_award(app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    tender, bidders, _ = _opened_tender(app_url, mail, lead, pid, LEVEL_BIDS)
    tid = tender["id"]
    _field(lead.patch(f"/api/tenders/{tid}", {"contingencyPercent": "25.01"}), "contingencyPercent")
    percent = "7.25"
    _ok(lead.patch(f"/api/tenders/{tid}", {"contingencyPercent": percent}), 200)
    bids = _levelling(lead, tid)
    for ref, base, provisional in (("B-01", 1_000_000, 100_000), ("B-02", 950_200, 0), ("B-03", 950_200, 0)):
        subtotal, contingency, total = _expected_level(base, provisional, 0, 0, percent)
        bid = bids[ref]
        assert (bid["provisionalSumsCents"], bid["subtotalCents"], bid["contingencyCents"], bid["levelledTotalCents"]) == (provisional, subtotal, contingency, total)
    assert bids["B-01"]["unpricedExclusions"] == 1
    assert [bids[r]["rank"] for r in ("B-01", "B-02", "B-03")] == [1, 2, 3]
    unpriced = _err(lead.post(f"/api/tenders/{tid}/award", {"bidId": bids["B-02"]["id"], "reason": "Programme"}), 409, "unpriced_exclusions")
    assert unpriced["count"] == 1
    exclusion = bids["B-01"]["exclusions"][0]["id"]
    zero = lead.patch(f"/api/bids/{bids['B-01']['id']}/levelling", {"allowances": [], "exclusionPrices": [{"exclusionId": exclusion, "priceCents": 0}]})
    assert "Price this exclusion above zero." in _err(zero, 422, "validation")["errors"].values()
    levelled = _ok(lead.patch(f"/api/bids/{bids['B-01']['id']}/levelling", {
        "allowances": [{"label": "Hoarding", "amountCents": 2_500}], "exclusionPrices": [{"exclusionId": exclusion, "priceCents": 30_000}]}), 200)["bid"]
    subtotal, contingency, total = _expected_level(1_000_000, 100_000, 2_500, 30_000, percent)
    assert (levelled["allowancesCents"], levelled["pricedExclusionsCents"], levelled["subtotalCents"], levelled["contingencyCents"], levelled["levelledTotalCents"]) == (2_500, 30_000, subtotal, contingency, total)
    _field(lead.post(f"/api/tenders/{tid}/award", {"bidId": bids["B-02"]["id"]}), "reason", "Give a reason for not awarding the lowest levelled bid.")
    awarded = _ok(lead.post(f"/api/tenders/{tid}/award", {"bidId": bids["B-01"]["id"]}), 200)
    assert awarded["tender"]["status"] == "awarded"
    contract = _ok(lead.get(f"/api/projects/{pid}"), 200)["project"]["contract"]
    assert contract["companyName"] == bidders[0]["companyName"] and contract["contractSumCents"] == LEVEL_BIDS[0]["baseCents"]
    assert lead.post(f"/api/tenders/{tid}/award", {"bidId": bids["B-01"]["id"]}).status_code == 409


def test_levelling_url_state(browser: Browser, app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    tender, bidders, _ = _opened_tender(app_url, mail, lead, pid, LEVEL_BIDS)
    with _app(browser, app_url, f"/office/tenders/{tender['id']}/levelling", lead) as page:
        table = page.get_by_role("table", name="Levelling")
        _until(page, lambda: expect(table).to_contain_text(bidders[2]["companyName"], timeout=QUICK_MS))
        assert _query(page).get("sort", "rank") == "rank" and _query(page).get("dir", "asc") == "asc"
        click(table.get_by_role("button", name="Levelled total"))
        _until(page, lambda: _check(_query(page).get("sort") == "levelled", page.url))
        first_dir = _query(page).get("dir", "asc")
        _attr(page, page.get_by_role("columnheader", name="Levelled total"), "aria-sort", re.compile("ascending|descending"))
        click(table.get_by_role("button", name="Levelled total"))
        _until(page, lambda: _check(_query(page).get("dir", "asc") != first_dir, page.url))
        sorted_url = page.url
        _choose(page.get_by_role("combobox", name="Unpriced exclusions"), "Only unpriced")
        _until(page, lambda: _check(_query(page).get("unpriced") == "only", page.url))
        _until(page, lambda: expect(table).not_to_contain_text(bidders[1]["companyName"], timeout=QUICK_MS))
        _choose(page.get_by_role("combobox", name="Unpriced exclusions"), "Show all")
        _find_bidder(page, bidders[1]["companyName"])
        _until(page, lambda: _check(_query(page).get("q") == bidders[1]["companyName"], page.url))
        _until(page, lambda: expect(table).not_to_contain_text(bidders[0]["companyName"], timeout=QUICK_MS))
        searched = page.url
        page.reload()
        _until(page, lambda: expect(page.get_by_role("searchbox", name="Find bidder")).to_have_value(bidders[1]["companyName"], timeout=QUICK_MS))
        assert page.url == searched
        _until(page, lambda: expect(table).not_to_contain_text(bidders[0]["companyName"], timeout=QUICK_MS))
        page.go_back()
        _until(page, lambda: _check("q" not in _query(page) and "unpriced" not in _query(page), page.url))
        _until(page, lambda: expect(table).to_contain_text(bidders[0]["companyName"], timeout=QUICK_MS))
        page.go_back()
        _until(page, lambda: _check(_query(page).get("unpriced") == "only", page.url))
        _until(page, lambda: expect(table).not_to_contain_text(bidders[1]["companyName"], timeout=QUICK_MS))
        page.go_back()
        _until(page, lambda: _check(page.url == sorted_url, page.url))
        _until(page, lambda: expect(table).to_contain_text(bidders[1]["companyName"], timeout=QUICK_MS))
        page.go_back()
        _until(page, lambda: _check(_query(page).get("sort") == "levelled" and _query(page).get("dir", "asc") == first_dir, page.url))
        page.go_forward()
        _until(page, lambda: _check(page.url == sorted_url, page.url))


def test_levelling_csv(app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    bids = [
        _bid(1_000_000, (("@SUM(A1)", 10_000), ("-2 leftover", 5_000)), ("=1+1", "+cmd")),
        _bid(1_100_000, (), ("\tTabbed",)),
    ]
    bidders = _bidders(2)
    bidders[0]["companyName"] = f"={_name('formula')}"
    tender = _tender(lead, pid, bidders)
    for api, bid in zip(_bidder_apis(app_url, mail, bidders, tender["title"]), bids):
        _ok(api.post(f"/api/tenders/{tender['id']}/bid", bid), 201)
    _wait_closed(lead, tender["id"])
    _ok(lead.post(f"/api/tenders/{tender['id']}/open-bids", {}), 200)
    response = lead.get(f"/api/tenders/{tender['id']}/levelling.csv")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert list(rows[0].keys()) == ["rank", "bidder_reference", "company", "base", "provisional_sums", "allowances", "priced_exclusions",
                                    "unpriced_exclusions", "subtotal", "contingency", "levelled_total", "final_submission",
                                    "provisional_sum_labels", "exclusion_labels"]
    by_ref = {r["bidder_reference"]: r for r in rows}
    assert set(by_ref) == {"B-01", "B-02"}
    first = by_ref["B-01"]
    assert first["company"] == "'" + bidders[0]["companyName"]
    assert first["base"] == _plain(bids[0]["baseCents"])
    assert first["provisional_sums"] == _plain(sum(p["amountCents"] for p in bids[0]["provisionalSums"]))
    sums, excluded = first["provisional_sum_labels"], first["exclusion_labels"]
    assert sums.startswith("'") and "; " in sums and all(p["label"] in sums for p in bids[0]["provisionalSums"])
    assert excluded.startswith("'") and "; " in excluded and all(e["label"] in excluded for e in bids[0]["exclusions"])
    assert by_ref["B-02"]["exclusion_labels"].startswith("'\t")
    level = _levelling(lead, tender["id"])
    for ref, row in by_ref.items():
        assert row["levelled_total"] == _plain(level[ref]["levelledTotalCents"]) and row["subtotal"] == _plain(level[ref]["subtotalCents"])
        assert re.fullmatch(TIME_RE, row["final_submission"])
        for column in ("base", "provisional_sums", "allowances", "priced_exclusions", "subtotal", "contingency", "levelled_total"):
            assert re.fullmatch(r"-?\d+\.\d{2}", row[column])


def test_wf_bid_levelling_keyboard_award(browser: Browser, app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    tender, bidders, _ = _closed_tender(app_url, mail, lead, pid, [LEVEL_BIDS[0], _bid(1_100_000)])
    company = bidders[0]["companyName"]
    with _app(browser, app_url, f"/office/tenders/{tender['id']}", lead) as page:
        _press(page, page.get_by_role("button", name="Open bids"))
        _hear(page, "Bids opened. 2 bids are ready to level.")
        _focus(page, page.get_by_role("heading", name="Tender status", exact=True))
        _go(page, f"{app_url}/office/tenders/{tender['id']}/levelling")
        _visible(page, page.get_by_role("table", name="Levelling"))
        _audit(page)
        _press(page, page.get_by_role("button", name="Award", exact=True))
        dialog = page.get_by_role("dialog", name="Award tender")
        radio = dialog.get_by_role("radio", name=f"B-01 {company}")
        _tab_to(page, radio)
        page.keyboard.press("Space")
        _press(page, dialog.get_by_role("button", name="Confirm award"))
        _hear(page, "Price every exclusion before awarding. 1 are still unpriced.", "alert")
        _first_button(page, dialog)
        page.keyboard.press("Escape")
        _focus(page, page.get_by_role("button", name="Award", exact=True))
        ref = "B-01"
        exclusion = LEVEL_BIDS[0]["exclusions"][0]["label"]
        _press(page, page.get_by_role("button", name=f"Level {ref}"))
        level = page.get_by_role("dialog", name=f"Level {ref}")
        price = level.get_by_role("textbox", name=f"Price for {exclusion}")
        _type(page, price, "0.00")
        _press(page, level.get_by_role("button", name="Save levelling"))
        _refused(page, level, "Price this exclusion above zero.")
        _audit(page)
        _type(page, price, "300.00")
        _press(page, level.get_by_role("button", name="Save levelling"))
        _hear(page, f"Levelling for {ref} saved.")
        _focus(page, page.get_by_role("button", name=f"Level {ref}"))
        _press(page, page.get_by_role("button", name="Award", exact=True))
        radio = page.get_by_role("dialog", name="Award tender").get_by_role("radio", name=f"B-01 {company}")
        _tab_to(page, radio)
        page.keyboard.press("Space")
        _press(page, page.get_by_role("dialog", name="Award tender").get_by_role("button", name="Confirm award"))
        _hear(page, f"Awarded to {company}.")
        _focus(page, page.get_by_role("heading", name="Tender status", exact=True))
    assert _ok(lead.get(f"/api/tenders/{tender['id']}"), 200)["tender"]["status"] == "awarded"
    assert _ok(lead.get(f"/api/projects/{pid}"), 200)["project"]["contract"]["companyName"] == company


def test_wf_bid_levelling_phone_pinned(browser: Browser, app_url: str, mail: Any) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _project(avery)["id"]
    tender, bidders, _ = _opened_tender(app_url, mail, lead, pid, LEVEL_BIDS)
    with _app(browser, app_url, f"/office/tenders/{tender['id']}/levelling", lead, viewport=PHONE) as page:
        table = page.get_by_role("table", name="Levelling")
        bidder_cell = table.get_by_text(bidders[0]["companyName"]).first
        submitted = page.get_by_role("columnheader", name="Submitted")
        _visible(page, bidder_cell)
        _in_view(bidder_cell)
        cell = _box(page, bidder_cell)
        far = _box(page, submitted)["x"]
        page.mouse.move(cell["x"] + cell["width"] / 2, cell["y"] + cell["height"] / 2)
        page.mouse.wheel(200, 0)
        _until(page, lambda: _check(_box(page, submitted)["x"] < far - SUBPIXEL, "table did not scroll sideways"))
        settle(table)
        pinned, nearer = _box(page, bidder_cell)["x"], _box(page, submitted)["x"]
        page.mouse.wheel(200, 0)
        _until(page, lambda: _check(_box(page, submitted)["x"] < nearer - SUBPIXEL, "table did not scroll further"))
        settle(table)
        moved = _box(page, bidder_cell)
        assert abs(moved["x"] - pinned) <= SUBPIXEL and moved["x"] >= -SUBPIXEL and moved["x"] + moved["width"] <= PHONE["width"] + SUBPIXEL
        _screen_layout(page)
        _audit(page)
    assert _levelling(lead, tender["id"])["B-01"]["companyName"] == bidders[0]["companyName"]


def test_variation_lifecycle_limits(app_url: str) -> None:
    avery = Api(app_url, AVERY)
    kai, jordan, casey, rin, ash = (Api(app_url, e) for e in (KAI, JORDAN, CASEY, RIN, ASH))
    pid = _sg_contract(avery)["id"]
    limit = _cents(JORDAN_LIMIT_SGD)
    v = _ok(_variation(kai, pid, _cents(V001_AMOUNT)), 201)["variation"]
    assert v["state"] == "raised" and v["number"] == "V-001" and v["version"] == 1 and v["currency"] == "SGD"
    over = _err(_transition(jordan, v["id"], "approve"), 403, "over_approval_limit")
    assert over["limitCents"] == limit and over["currency"] == "SGD"
    _err(_transition(casey, v["id"], "approve"), 409, "illegal_transition")
    _err(_transition(kai, v["id"], "start_review"), 403, "forbidden")
    reviewed = _ok(_transition(jordan, v["id"], "start_review"), 200)["variation"]
    assert reviewed["state"] == "under_review" and reviewed["version"] == 2
    _err(_transition(jordan, v["id"], "approve"), 403, "over_approval_limit")
    _field(_transition(casey, v["id"], "reject"), "reason")
    assert _ok(_transition(casey, v["id"], "approve"), 200)["variation"]["state"] == "approved"
    _err(_transition(kai, v["id"], "withdraw"), 409, "illegal_transition")
    own = _ok(_variation(jordan, pid, limit), 201)["variation"]
    _ok(_transition(casey, own["id"], "start_review"), 200)
    _err(_transition(jordan, own["id"], "approve"), 403, "own_variation")
    omission = _ok(_variation(kai, pid, -limit), 201)["variation"]
    _ok(_transition(jordan, omission["id"], "start_review"), 200)
    assert _ok(_transition(jordan, omission["id"], "approve"), 200)["variation"]["state"] == "approved"
    above = _ok(_variation(kai, pid, limit + 1), 201)["variation"]
    _ok(_transition(jordan, above["id"], "start_review"), 200)
    _err(_transition(jordan, above["id"], "approve"), 403, "over_approval_limit")
    _err(_transition(jordan, above["id"], "withdraw"), 403, "forbidden")
    assert _ok(_transition(kai, above["id"], "withdraw"), 200)["variation"]["state"] == "withdrawn"
    _field(_variation(kai, pid, 1, title="x" * 121), "title", _too_long("Title", 120))
    _ok(_variation(kai, pid, 1, title=FAMILY * 120), 201)
    long_body = {"title": "Long", "description": "d" * 2001, "amountCents": 1}
    _field(kai.post(f"/api/projects/{pid}/variations", long_body, key=idempotency_key()), "description", _too_long("Description", 2000))
    _field(_variation(kai, pid, 0), "amountCents")
    _err(_variation(rin, pid, 1), 403, "forbidden")
    _err(_variation(ash, pid, 1), 404, "not_found")


def test_variation_replay(app_url: str) -> None:
    avery, kai, jordan = Api(app_url, AVERY), Api(app_url, KAI), Api(app_url, JORDAN)
    pid = _sg_contract(avery)["id"]
    key = idempotency_key()
    title = f"{_name('variation')} retried"
    body = {"title": title, "description": "Raised on a flaky network", "amountCents": 120_000, "storeCode": "SG-ORC-01"}
    path = f"/api/projects/{pid}/variations"
    first = kai.post(path, body, key=key)
    _ok(first, 201)
    replay = kai.post(path, dict(reversed(list(body.items()))), key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    _err(kai.post(path, {**body, "amountCents": 120_001}, key=key), 409, "idempotency_key_reused")
    _field(kai.post(path, body), "idempotencyKey", "Retry key is missing; reload and try again.")
    other = _ok(jordan.post(path, body, key=key), 201)["variation"]
    assert other["id"] != first.json()["variation"]["id"]
    titles = [v["title"] for v in _ok(kai.get(path), 200)["variations"]]
    assert titles.count(title) == 2


def test_variation_stale_save(app_url: str) -> None:
    avery, kai, jordan, casey = (Api(app_url, e) for e in (AVERY, KAI, JORDAN, CASEY))
    pid = _sg_contract(avery)["id"]
    v = _ok(_variation(kai, pid, 120_000), 201)["variation"]
    jordan_title = "Jordan's title"
    saved = _ok(jordan.patch(f"/api/variations/{v['id']}", {"version": 1, "title": jordan_title}), 200)["variation"]
    assert saved["version"] == 2
    stale = _err(casey.patch(f"/api/variations/{v['id']}", {"version": 1, "title": "Casey's title"}), 412, "stale_version")
    assert stale["savedBy"] == "Jordan Lim" and stale["savedAt"] == saved["updatedAt"]
    assert _ok(casey.get(f"/api/variations/{v['id']}"), 200)["variation"]["title"] == jordan_title
    barrier = threading.Barrier(2, timeout=HTTP_SECONDS)
    results: list[httpx.Response | None] = [None, None]

    def run(index: int, api: Api) -> None:
        barrier.wait()
        results[index] = api.patch(f"/api/variations/{v['id']}", {"version": 2, "title": f"race {index}"})

    threads = [threading.Thread(target=run, args=(i, a)) for i, a in enumerate((jordan, casey))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_SECONDS)
    assert sorted(r.status_code for r in results if r) == [200, 412]


def test_wf_variations_phone_raise(browser: Browser, app_url: str) -> None:
    avery, kai = Api(app_url, AVERY), Api(app_url, KAI)
    pid = _sg_contract(avery)["id"]
    title = f"{_name('variation')} bulkhead"
    fetched: list[Any] = []

    def flaky(route: Any) -> None:
        if route.request.method == "POST" and not fetched:
            fetched.append(route.fetch())
            route.abort()
        else:
            route.continue_()

    with _app(browser, app_url, f"/office/projects/{pid}/variations", kai, viewport=PHONE) as page:
        page.route("**/api/projects/*/variations", flaky)
        tap(page.get_by_role("button", name="Raise variation").first)
        sheet = page.get_by_role("dialog", name="Raise variation")
        _visible(page, sheet)
        _audit(page)
        for field, value in (("Title", title), ("Description", "Bulkhead at Orchard entrance"), ("Amount", "124.00")):
            box = sheet.get_by_role("textbox", name=field)
            _type(page, box, value)
            _unobstructed(page, box)
        _steady(page, lambda: tap(page.get_by_role("button", name="Submit variation").first))
        lost = "We couldn't reach Plumbline. Check your connection; nothing was saved. Try again and we'll make sure it only happens once."
        _until(page, lambda: _check(_said(page, lost, "alert") or _said(page, "Variation V-001 raised."), "no network-failure or raised copy"))
        if not _said(page, "Variation V-001 raised."):
            tap(page.get_by_role("button", name="Submit variation").first)
        _hear(page, "Variation V-001 raised.")
        _focus(page, page.get_by_role("heading", name="V-001", exact=True))
        _screen_layout(page)
    assert fetched and fetched[0].status == 201
    matching = [v for v in _ok(kai.get(f"/api/projects/{pid}/variations"), 200)["variations"] if v["title"] == title]
    assert len(matching) == 1 and matching[0]["amountCents"] == _cents("124.00")


def test_wf_variations_withdraw_rollback(browser: Browser, app_url: str) -> None:
    avery, kai, casey = Api(app_url, AVERY), Api(app_url, KAI), Api(app_url, CASEY)
    pid = _sg_contract(avery)["id"]
    first = _ok(_variation(kai, pid, 124_000), 201)["variation"]
    second = _ok(_variation(kai, pid, 124_000), 201)["variation"]
    with _app(browser, app_url, f"/office/projects/{pid}/variations", kai) as page:
        _visible(page, page.get_by_role("heading", name="V-002", exact=True))
        _ok(_transition(casey, first["id"], "start_review"), 200)
        _ok(_transition(casey, first["id"], "approve"), 200)
        _press(page, page.get_by_role("button", name=f"Withdraw {first['number']}"))
        _hear(page, "Variation V-001 can't be withdrawn because it's already approved. It's back as it was.", "alert")
        item = page.get_by_role("list", name="Variations").get_by_role("listitem").filter(has=page.get_by_role("heading", name="V-001", exact=True))
        _until(page, lambda: expect(item).not_to_contain_text("Withdrawn", timeout=QUICK_MS))
        _press(page, page.get_by_role("button", name=f"Edit {second['number']}"))
        dialog = page.get_by_role("dialog", name=f"Edit {second['number']}")
        title_box = dialog.get_by_role("textbox", name="Title")
        _tab_to(page, title_box)
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.press("Backspace")
        _press(page, dialog.get_by_role("button", name="Save changes"))
        _refused(page, dialog, f"{'Title'} is required.")
        _audit(page)
        casey_title = "Casey's title"
        newer = _ok(casey.patch(f"/api/variations/{second['id']}", {"version": 1, "title": casey_title}), 200)["variation"]
        _type(page, title_box, "Kai's title")
        _press(page, dialog.get_by_role("button", name="Save changes"))
        _hear(page, f"Casey Wong saved a newer version at {_fmt_time(newer['updatedAt'])}. Your changes weren't saved; they're shown beside the latest version.", "alert")
    assert _ok(kai.get(f"/api/variations/{first['id']}"), 200)["variation"]["state"] == "approved"
    assert _ok(kai.get(f"/api/variations/{second['id']}"), 200)["variation"]["title"] == casey_title


def _retention(valuation: int, held: int, cap: int) -> int:
    return min(_half_up(Decimal(valuation) * RETENTION_PERCENT / 100), cap - held)


def test_certificate_retention(app_url: str) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    total = _cents(CONTRACT_SUM)
    cap = _half_up(Decimal(total) * CAP_PERCENT / 100)
    pid = _sg_contract(avery, defects=6)["id"]
    held = 0
    cert: dict[str, Any] = {}
    for period, gross, previous in (("2026-06-30", 40_000_000, 0), ("2026-07-31", 80_000_000, 40_000_000)):
        cert = _ok(_certificate(lead, pid, period, gross), 201)["certificate"]
        retention = _retention(gross - previous, held, cap)
        held += retention
        assert (cert["valuationThisPeriodCents"], cert["retentionThisPeriodCents"], cert["retentionHeldCents"], cert["amountDueCents"]) == (
            gross - previous, retention, held, gross - previous - retention)
    assert held == cap and cert["number"] == "PC-02" and cert["currency"] == "SGD"
    _field(_certificate(lead, pid, "2026-07-15", 90_000_000), "periodEnding", "Period ending must be after 31 Jul 2026.")
    _field(_certificate(lead, pid, "2026-08-15", 70_000_000), "grossValuationCents", "Gross valuation can't be lower than the last certificate's.")
    _field(lead.post(f"/api/projects/{pid}/practical-completion", {"date": (_today() + timedelta(days=1)).isoformat()}), "date")
    half = _ok(lead.post(f"/api/projects/{pid}/practical-completion", {"date": "2026-08-31"}), 201)["certificate"]
    assert half["kind"] == "retention_release_half" and half["number"] == "RR-01"
    assert half["amountDueCents"] == _half_up(Decimal(cap) / 2) and half["retentionHeldCents"] == cap - half["amountDueCents"]
    _err(lead.post(f"/api/projects/{pid}/practical-completion", {"date": "2026-08-31"}), 409, "illegal_transition")
    defects_end = _add_months(date(2026, 8, 31), 6).isoformat()
    assert _ok(lead.get(f"/api/projects/{pid}"), 200)["project"]["defectsEndOn"] == defects_end
    after = _ok(_certificate(lead, pid, "2026-09-30", 90_000_000), 201)["certificate"]
    assert after["retentionThisPeriodCents"] == 0 and after["amountDueCents"] == 90_000_000 - 80_000_000
    running = _err(lead.post(f"/api/projects/{pid}/retention/final-release", {}), 409, "defects_period_running")
    assert running["defectsEndOn"] == defects_end
    odd = _sg_contract(avery, defects=1)["id"]
    first = _ok(_certificate(lead, odd, "2026-01-15", 11_125), 201)["certificate"]
    assert first["retentionThisPeriodCents"] == _half_up(Decimal("1112.5"))
    release = _ok(lead.post(f"/api/projects/{odd}/practical-completion", {"date": "2026-01-31"}), 201)["certificate"]
    assert release["amountDueCents"] == _half_up(Decimal(first["retentionHeldCents"]) / 2)
    final = _ok(lead.post(f"/api/projects/{odd}/retention/final-release", {}), 201)["certificate"]
    assert final["kind"] == "retention_release_final" and final["number"] == "RR-02"
    assert final["amountDueCents"] == first["retentionHeldCents"] - release["amountDueCents"] and final["retentionHeldCents"] == 0
    _err(lead.post(f"/api/projects/{odd}/retention/final-release", {}), 409, "illegal_transition")
    _err(Api(app_url, KAI).post(f"/api/projects/{odd}/certificates", {"periodEnding": "2026-12-31", "grossValuationCents": 20_000}), 403, "forbidden")


def _assert_ledger(entries: list[dict[str, Any]], held: int) -> None:
    movements: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        movements.setdefault(entry["movementId"], []).append(entry)
    for pair in movements.values():
        assert len(pair) == 2 and pair[0]["amountCents"] == pair[1]["amountCents"] > 0
        sides = {(e["account"], e["side"]) for e in pair}
        assert sides in ({("contractor_payable", "debit"), ("retention_held", "credit")},
                         {("retention_held", "debit"), ("contractor_payable", "credit")})
    on_held = [e for e in entries if e["account"] == "retention_held"]
    assert held == sum(e["amountCents"] for e in on_held if e["side"] == "credit") - sum(e["amountCents"] for e in on_held if e["side"] == "debit")


def test_retention_ledger_pairs(app_url: str) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _sg_contract(avery, defects=1)["id"]
    path = f"/api/projects/{pid}/retention-ledger"
    _ok(_certificate(lead, pid, "2026-01-10", 1_000_000), 201)
    ledger = _ok(lead.get(path), 200)
    assert len(ledger["entries"]) == 2 and ledger["retentionHeldCents"] == _half_up(Decimal(1_000_000) * RETENTION_PERCENT / 100)
    _assert_ledger(ledger["entries"], ledger["retentionHeldCents"])
    _ok(_certificate(lead, pid, "2026-01-20", 1_000_000), 201)
    assert len(_ok(lead.get(path), 200)["entries"]) == 2
    _ok(lead.post(f"/api/projects/{pid}/practical-completion", {"date": "2026-01-31"}), 201)
    _ok(lead.post(f"/api/projects/{pid}/retention/final-release", {}), 201)
    ledger = _ok(Api(app_url, MORGAN).get(path), 200)
    assert len(ledger["entries"]) == 6 and ledger["retentionHeldCents"] == 0
    _assert_ledger(ledger["entries"], 0)
    _err(Api(app_url, KAI).get(path), 403, "forbidden")
    _err(Api(app_url, RIN).get(path), 403, "forbidden")
    _err(Api(app_url, ASH).get(path), 404, "not_found")


def test_store_split(app_url: str) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _sg_contract(avery, defects=1)["id"]
    cert = _ok(_certificate(lead, pid, "2026-01-10", 111_111), 201)["certificate"]
    assert cert["amountDueCents"] == _cents("1,000.00")
    assert {p["storeCode"]: p["amountCents"] for p in cert["storeSplit"]} == {k: _cents(v) for k, v in SG_SPLIT_OF_1000.items()}
    response = lead.get(f"/api/certificates/{cert['id']}/split.csv")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert list(rows[0]) == ["store_code", "store_name", "weight", "amount"]
    assert {r["store_code"]: r["amount"] for r in rows} == SG_SPLIT_OF_1000
    release = _ok(lead.post(f"/api/projects/{pid}/practical-completion", {"date": "2026-01-31"}), 201)["certificate"]
    assert sum(p["amountCents"] for p in release["storeSplit"]) == release["amountDueCents"]
    stores = [{"code": c, "name": c, "weight": 1} for c in ("ST-B", "ST-A", "ST-C")]
    tied = _project(avery, region="SG", brand=NORTHVANE, stores=stores, contract=(TIDEWAY, _cents(CONTRACT_SUM)))["id"]
    split = _ok(_certificate(lead, tied, "2026-01-10", 111), 201)["certificate"]["storeSplit"]
    assert {p["storeCode"]: p["amountCents"] for p in split} == {"ST-A": 34, "ST-B": 33, "ST-C": 33}
    _err(Api(app_url, KAI).get(f"/api/certificates/{cert['id']}/split.csv"), 403, "forbidden")


def test_wf_payment_certificates_keyboard_issue(browser: Browser, app_url: str) -> None:
    avery, lead = Api(app_url, AVERY), Api(app_url, JORDAN)
    pid = _sg_contract(avery)["id"]
    today = SUITE_DAY
    gross = _cents("400000.00")
    held = _half_up(Decimal(gross) * RETENTION_PERCENT / 100)
    with _app(browser, app_url, f"/office/projects/{pid}/certificates", lead) as page:
        _press(page, page.get_by_role("button", name="Issue certificate"))
        dialog = page.get_by_role("dialog", name="Issue payment certificate")
        period = dialog.get_by_label("Period ending")
        _focus(page, period)
        period.fill((today - timedelta(days=1)).isoformat())
        _press(page, dialog.get_by_role("button", name="Confirm and issue"))
        _refused(page, dialog, f"{'Gross valuation to date'} is required.")
        _audit(page)
        _type(page, dialog.get_by_role("textbox", name="Gross valuation to date"), "400000.00")
        _press(page, dialog.get_by_role("button", name="Confirm and issue"))
        _hear(page, f"Certificate PC-01 issued: {_amount('SGD', gross - held)} due.")
        _focus(page, page.get_by_role("link", name="PC-01", exact=True))
        _press(page, page.get_by_role("button", name="Record practical completion"))
        dialog = page.get_by_role("dialog", name="Record practical completion")
        when = dialog.get_by_label("Practical completion date")
        _focus(page, when)
        when.fill(today.isoformat())
        _press(page, dialog.get_by_role("button", name="Record and release half"))
        _hear(page, f"Practical completion recorded. Retention release RR-01 issued for {_amount('SGD', _half_up(Decimal(held) / 2))}.")
        _focus(page, page.get_by_role("link", name="RR-01", exact=True))
        _press(page, page.get_by_role("button", name="Release final retention"))
        _press(page, page.get_by_role("dialog", name="Release final retention").get_by_role("button", name="Confirm final release"))
        _hear(page, f"Final retention can be released after {_fmt_date(_add_months(today, 12))}.", "alert")
    certificates = _ok(lead.get(f"/api/projects/{pid}/certificates"), 200)["certificates"]
    assert sorted(c["number"] for c in certificates) == ["PC-01", "RR-01"]
    assert _ok(lead.get(f"/api/projects/{pid}/retention-ledger"), 200)["retentionHeldCents"] == held - _half_up(Decimal(held) / 2)


def test_wf_payment_certificates_finance_review(browser: Browser, app_url: str) -> None:
    avery, lead, morgan = Api(app_url, AVERY), Api(app_url, JORDAN), Api(app_url, MORGAN)
    pid = _sg_contract(avery)["id"]
    cert = _ok(_certificate(lead, pid, "2026-01-10", 111_111), 201)["certificate"]
    with _app(browser, app_url, f"/office/projects/{pid}/certificates", morgan) as page:
        _visible(page, page.get_by_role("table", name="Certificates"))
        click(page.get_by_role("link", name="PC-01", exact=True))
        split = page.get_by_role("table", name=f"Store split {cert['number']}")
        for code, amount in SG_SPLIT_OF_1000.items():
            _until(page, lambda: expect(split).to_contain_text(code, timeout=QUICK_MS))
            _until(page, lambda: expect(split).to_contain_text(amount, timeout=QUICK_MS))
        _visible(page, page.get_by_role("table", name="Retention ledger"))
        _audit(page)
        href = page.get_by_role("link", name=f"Export split {cert['number']}").get_attribute("href")
    assert href
    rows = list(csv.DictReader(io.StringIO(morgan.get(href).content.decode("utf-8-sig"))))
    assert sum(_cents(r["amount"]) for r in rows) == cert["amountDueCents"]


def test_review_due_dates(app_url: str) -> None:
    avery, rin, kai = Api(app_url, AVERY), Api(app_url, RIN), Api(app_url, KAI)
    pid = _sg_contract(avery)["id"]
    received = ["2026-09-30T09:00:00.000Z", "2026-09-30T09:00:00.001Z", "2026-09-30T09:00:01.000Z", "2026-09-26T02:00:00.000Z", SEED_RECEIVED]
    for index, instant in enumerate(received):
        drawing = _ok(_submit_drawing(rin, pid, f"SD-E{index}", instant), 201)["shopDrawing"]
        assert drawing["reviewDueOn"] == _due(instant).isoformat(), instant
    assert _fmt_date(_due(SEED_RECEIVED)) == "27 Oct 2026"
    assert _fmt_date(_due("2026-12-24T09:00:00.000Z")) == "4 Jan 2027"
    assert _fmt_date(_due("2026-12-24T09:00:01.000Z")) == "5 Jan 2027"
    late = _ok(_submit_drawing(rin, pid, "SD-OLD", "2026-01-02T02:00:00.000Z"), 201)["shopDrawing"]
    assert late["overdue"] is True
    _ok(rin.post(f"/api/shop-drawings/{late['id']}/review", {"code": 1}), 200)
    rows = {d["reference"]: d for d in _ok(rin.get(f"/api/projects/{pid}/shop-drawings"), 200)["shopDrawings"]}
    assert rows["SD-OLD"]["overdue"] is False
    fresh = _ok(_submit_drawing(kai, pid, "SD-NOW"), 201)["shopDrawing"]
    assert fresh["overdue"] is False and fresh["reviewDueOn"] == _due(fresh["receivedAt"]).isoformat()
    _field(_submit_drawing(kai, pid, "SD-K", "2026-09-30T09:00:00.000Z"), "receivedAt", "Only the studio can log a received time.")
    for outside in ("2025-12-31T15:59:59.000Z", _iso(datetime.now(timezone.utc) + timedelta(days=1))):
        _field(_submit_drawing(rin, pid, "SD-X", outside), "receivedAt", "Received at must be between 1 Jan 2026 and now.")


def test_review_codes_resubmission(app_url: str) -> None:
    avery, rin, sam, kai = (Api(app_url, e) for e in (AVERY, RIN, SAM, KAI))
    pid = _sg_contract(avery)["id"]
    names = {RIN: "Rin Mok", SAM: "Sam Teo"}
    first = _ok(_submit_drawing(kai, pid, "SD-201"), 201)["shopDrawing"]
    review = f"/api/shop-drawings/{first['id']}/review"
    _field(rin.post(review, {"code": 2}), "comments", "Comments are needed for Code 2 Proceed with comments.")
    _field(rin.post(review, {"code": 5}), "code")
    _field(rin.post(review, {"code": 2, "comments": "c" * 2001}), "comments", _too_long("Comments", 2000))
    _err(kai.post(review, {"code": 1}), 403, "forbidden")
    barrier = threading.Barrier(2, timeout=HTTP_SECONDS)
    results: dict[str, httpx.Response] = {}

    def run(api: Api) -> None:
        barrier.wait()
        results[api.email or ""] = api.post(review, {"code": 1})

    threads = [threading.Thread(target=run, args=(a,)) for a in (rin, sam)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_SECONDS)
    assert sorted(r.status_code for r in results.values()) == [200, 409]
    winner = next(e for e, r in results.items() if r.status_code == 200)
    returned = results[winner].json()["shopDrawing"]["review"]
    loser = _err(next(r for r in results.values() if r.status_code == 409), 409, "already_reviewed")
    assert loser["by"] == names[winner] and loser["at"] == returned["at"]
    _err(rin.post(review, {"code": 1}), 409, "already_reviewed")
    _err(kai.post(f"/api/shop-drawings/{first['id']}/resubmissions", files={"file": ("d.pdf", PDF, "application/pdf")}), 409, "illegal_transition")
    for code in (3, 4):
        drawing = _ok(_submit_drawing(kai, pid, f"SD-20{code}"), 201)["shopDrawing"]
        assert _ok(rin.post(f"/api/shop-drawings/{drawing['id']}/review", {"code": code, "comments": "Revise the plinth"}), 200)["shopDrawing"]["review"]["code"] == code
        again = _ok(kai.post(f"/api/shop-drawings/{drawing['id']}/resubmissions", files={"file": ("d.pdf", PDF, "application/pdf")}), 201)["shopDrawing"]
        assert again["submission"] == 2 and again["reviewDueOn"] == _due(again["receivedAt"]).isoformat()


def test_status_labels(browser: Browser, app_url: str) -> None:
    avery, rin, kai = Api(app_url, AVERY), Api(app_url, RIN), Api(app_url, KAI)
    project = _sg_contract(avery)
    pid = project["id"]
    for code in (1, 2, 3, 4):
        drawing = _ok(_submit_drawing(rin, pid, f"SD-C{code}", "2026-01-05T02:00:00.000Z"), 201)["shopDrawing"]
        _ok(rin.post(f"/api/shop-drawings/{drawing['id']}/review", {"code": code, "comments": "Noted"}), 200)
    _ok(_submit_drawing(rin, pid, "SD-LATE", "2026-01-05T02:00:00.000Z"), 201)
    fresh = _ok(_submit_drawing(kai, pid, "SD-FRESH"), 201)["shopDrawing"]
    with _app(browser, app_url, f"/office/projects/{pid}/shop-drawings", rin) as page:
        table = page.get_by_role("table", name="Shop drawings")
        for label in ("Code 1 Proceed", "Code 2 Proceed with comments", "Code 3 Revise and resubmit", "Code 4 Rejected", "Review overdue",
                      f"Due {_fmt_date(date.fromisoformat(fresh['reviewDueOn']))}"):
            _until(page, lambda: expect(table).to_contain_text(label, timeout=QUICK_MS))
        for code, shape in ((1, "circle"), (2, "ring"), (3, "triangle"), (4, "cross")):
            _shape(page, table.get_by_role("row").filter(has_text=f"SD-C{code}"), shape)
        _shape(page, table.get_by_role("row").filter(has_text="SD-LATE"), "clock")
        _audit(page)
    _, viewpoint = _site_walk(avery, project, "SG-ORC-01")
    snags = [_ok(_snag(rin, viewpoint["id"], s, 50), 201)["snag"] for s in (20, 40, 60, 80)]
    _ok(rin.post(f"/api/snags/{snags[1]['id']}/transitions", {"action": "fix"}), 200)
    _ok(rin.post(f"/api/snags/{snags[2]['id']}/transitions", {"action": "fix"}), 200)
    _ok(rin.post(f"/api/snags/{snags[2]['id']}/transitions", {"action": "close"}), 200)
    _ok(rin.post(f"/api/snags/{snags[3]['id']}/transitions", {"action": "fix"}), 200)
    _ok(rin.post(f"/api/snags/{snags[3]['id']}/transitions", {"action": "reopen"}), 200)
    with _app(browser, app_url, f"/office/projects/{pid}/site-walk", rin) as page:
        cards = page.get_by_role("list", name="Snags")
        for n, state, shape in ((1, "Open", "ring"), (2, "Fixed", "square"), (3, "Closed", "diamond"), (4, "Reopened", "triangle")):
            marker = page.get_by_role("button", name=f"Snag {n} {state}", exact=True)
            _visible(page, marker)
            _shape(page, marker, shape)
            _shape(page, cards.get_by_role("button", name=re.compile(rf"^Snag {n} {state} ")), shape)
        _audit(page)


def test_wf_shop_drawing_review_phone_submit_review(browser: Browser, app_url: str) -> None:
    avery, kai, rin = Api(app_url, AVERY), Api(app_url, KAI), Api(app_url, RIN)
    pid = _sg_contract(avery)["id"]
    with _app(browser, app_url, f"/office/projects/{pid}/shop-drawings", kai, viewport=PHONE) as page:
        tap(page.get_by_role("button", name="Submit shop drawing").first)
        sheet = page.get_by_role("dialog", name="Submit shop drawing")
        _visible(page, sheet)
        _audit(page)
        ref = "SD-101"
        _steady(page, lambda: fill(sheet.get_by_role("textbox", name="Reference"), ref))
        fill(sheet.get_by_role("textbox", name="Title"), "Display wall joinery")
        sheet.get_by_label("Drawing file").set_input_files([{"name": "drawing.pdf", "mimeType": "application/pdf", "buffer": PDF}])
        expect(sheet.get_by_label("Received at")).to_have_count(0)
        tap(sheet.get_by_role("button", name="Send for review"))
        _hear(page, re.compile(r"SD-101 received\. Review due \d{1,2} [A-Z][a-z]{2} \d{4}\."))
    drawing = next(d for d in _ok(kai.get(f"/api/projects/{pid}/shop-drawings"), 200)["shopDrawings"] if d["reference"] == ref)
    with _app(browser, app_url, f"/office/projects/{pid}/shop-drawings", rin, viewport=PHONE) as page:
        tap(page.get_by_role("button", name=f"Review {ref}"))
        dialog = page.get_by_role("dialog", name=f"Review {ref}")
        _pick(dialog.get_by_role("radiogroup", name="Review code").get_by_role("radio", name="Code 2 Proceed with comments"), by_touch=True)
        tap(dialog.get_by_role("button", name="Return drawing"))
        _refused(page, dialog, "Comments are needed for Code 2 Proceed with comments.")
        _audit(page)
        fill(dialog.get_by_role("textbox", name="Comments"), "Check the plinth height")
        tap(dialog.get_by_role("button", name="Return drawing"))
        _hear(page, "SD-101 returned with Code 2 Proceed with comments.")
        _focus(page, page.get_by_role("heading", name="Shop drawings", exact=True))
        _screen_layout(page)
    final = next(d for d in _ok(rin.get(f"/api/projects/{pid}/shop-drawings"), 200)["shopDrawings"] if d["id"] == drawing["id"])
    assert final["review"]["code"] == 2


def test_wf_shop_drawing_review_lost_race_outage(browser: Browser, app_url: str) -> None:
    avery, kai, rin, sam = Api(app_url, AVERY), Api(app_url, KAI), Api(app_url, RIN), Api(app_url, SAM)
    pid = _sg_contract(avery)["id"]
    race_ref, kept_ref = "SD-102", "SD-103"
    drawing = _ok(_submit_drawing(kai, pid, race_ref), 201)["shopDrawing"]
    with _app(browser, app_url, f"/office/projects/{pid}/shop-drawings", rin, viewport=PHONE) as page:
        tap(page.get_by_role("button", name=f"Review {race_ref}"))
        dialog = page.get_by_role("dialog", name=f"Review {race_ref}")
        _visible(page, dialog)
        returned = _ok(sam.post(f"/api/shop-drawings/{drawing['id']}/review", {"code": 1}), 200)["shopDrawing"]["review"]
        _pick(dialog.get_by_role("radio", name="Code 1 Proceed"), by_touch=True)
        tap(dialog.get_by_role("button", name="Return drawing"))
        _hear(page, f"Sam Teo already returned SD-102 on {_fmt_time(returned['at'])}.", "alert")
    down = os.environ["APP_MINIO_DOWN_URL"]
    for base, copy in ((down, "File storage is unreachable, so drawing.pdf wasn't uploaded. Nothing was saved."),
                       (app_url, "Your session ended. Sign in again and we'll put your draft back.")):
        api = Api(base, KAI)
        with _app(browser, base, f"/office/projects/{pid}/shop-drawings", api, viewport=PHONE) as page:
            tap(page.get_by_role("button", name="Submit shop drawing").first)
            sheet = page.get_by_role("dialog", name="Submit shop drawing")
            _steady(page, lambda: fill(sheet.get_by_role("textbox", name="Reference"), kept_ref))
            fill(sheet.get_by_role("textbox", name="Title"), "Counter joinery")
            sheet.get_by_label("Drawing file").set_input_files([{"name": "drawing.pdf", "mimeType": "application/pdf", "buffer": PDF}])
            if base == app_url:
                assert api.delete("/api/session").status_code == 204
            tap(sheet.get_by_role("button", name="Send for review"))
            _hear(page, copy, "alert")
    assert kept_ref not in {d["reference"] for d in _ok(rin.get(f"/api/projects/{pid}/shop-drawings"), 200)["shopDrawings"]}


def test_seam_input(browser: Browser, app_url: str) -> None:
    avery = Api(app_url, AVERY)
    project, _ = _site_walk(avery)
    with _app(browser, app_url, f"/office/projects/{project['id']}/site-walk", avery) as page:
        frame = page.get_by_role("group", name="Intent seam")
        _tab_to(page, page.get_by_role("slider", name="Seam"))
        page.keyboard.press("Home")
        _seam_is(page, 0)
        photo_only = _frame_showing(page, frame, PHOTO_RGB, PHOTO_RGB)
        page.keyboard.press("End")
        _seam_is(page, 100)
        render_only = _frame_showing(page, frame, RENDER_RGB, RENDER_RGB)
        changed(photo_only, render_only)
        for key, s in (("ArrowLeft", 99), ("Shift+ArrowLeft", 89), ("ArrowUp", 90), ("ArrowDown", 89), ("Shift+ArrowRight", 99)):
            page.keyboard.press(key)
            _seam_is(page, s)
        for _ in range(5):
            page.keyboard.press("Shift+ArrowLeft")
        page.keyboard.press("ArrowRight")
        _seam_is(page, 50)
        split = _frame_showing(page, frame, RENDER_RGB, PHOTO_RGB)
        changed(photo_only, split)
        changed(render_only, split)
        _in_view(frame)
        box = _box(page, frame)
        mid = box["y"] + box["height"] / 2

        def x_at(s: float) -> float:
            return box["x"] + box["width"] * s / 100

        page.mouse.move(x_at(25), mid)
        page.mouse.down()
        _seam_is(page, 25)
        page.mouse.move(x_at(60), mid)
        _seam_is(page, 60)
        page.mouse.up()
        _touch(page, [(x_at(40), mid)])
        _seam_is(page, 60)
        _touch(page, [(x_at(40), mid), (x_at(40) + 3, mid + TOUCH_SLOP_PX * 4)])
        _seam_is(page, 60)
        box = _box(page, frame)
        mid = box["y"] + box["height"] / 2
        _touch(page, [(x_at(60), mid), (x_at(60) - TOUCH_SLOP_PX / 2, mid), (x_at(60) - TOUCH_SLOP_PX * 2, mid), (x_at(30), mid)])
        _seam_is(page, 30)


def test_snag_markers(browser: Browser, app_url: str) -> None:
    avery = Api(app_url, AVERY)
    project, viewpoint = _site_walk(avery)
    title = f"{_name('snag')} mullion"
    other = _ok(_snag(avery, viewpoint["id"], 80, 30), 201)["snag"]
    with _app(browser, app_url, f"/office/projects/{project['id']}/site-walk", avery) as page:
        frame = page.get_by_role("group", name="Intent seam")
        expect(page.get_by_role("button", name="Split", exact=True)).to_have_count(0)
        _tab_to(page, page.get_by_role("slider", name="Seam"))
        page.keyboard.press("Home")
        for _ in range(4):
            page.keyboard.press("Shift+ArrowRight")
        _seam_is(page, 40)
        click(page.get_by_role("button", name="Drop snag here").first)
        dialog = page.get_by_role("dialog", name="Drop snag")
        _until(page, lambda: expect(dialog.get_by_role("spinbutton", name="Across")).to_have_value("40", timeout=QUICK_MS))
        expect(dialog.get_by_role("spinbutton", name="Height")).to_have_value("50")
        _steady(page, lambda: fill(dialog.get_by_role("textbox", name="Snag title"), title))
        dialog.get_by_label("Observed on").fill(SUITE_DAY.isoformat())
        click(dialog.get_by_role("button", name="Pin snag"))
        _hear(page, "Snag 2 pinned at 40% across, 50% down.")
        marker = _marker(page, 2, "Open")
        _focus(page, marker)
        _attr(page, marker, "data-near", "true")
        _attr(page, marker, "data-state", "open")

        def on_seam() -> None:
            settle(marker)
            fb, mb = _box(page, frame), _box(page, marker)
            assert abs(mb["x"] + mb["width"] / 2 - (fb["x"] + fb["width"] * 0.4)) <= SUBPIXEL
            assert abs(mb["y"] + mb["height"] / 2 - (fb["y"] + fb["height"] * 0.5)) <= SUBPIXEL
        _until(page, on_seam)
        page.reload()
        _listen(page)
        _until(page, on_seam)
        _tab_to(page, page.get_by_role("slider", name="Seam"))
        page.keyboard.press("Home")
        for key in ["Shift+ArrowRight"] * 4 + ["ArrowRight", "ArrowRight"]:
            page.keyboard.press(key)
        _seam_is(page, 40 + NEAR_SEAM)
        _attr(page, marker, "data-near", "true")
        page.keyboard.press("ArrowRight")
        _attr(page, marker, "data-near", "false")
        cards = page.get_by_role("list", name="Snags")
        card = cards.get_by_role("button", name=re.compile(r"^Snag 1 Open "))
        click(card)
        _attr(page, frame, "data-active-snag-id", other["id"])
        _seam_is(page, 80)
        _attr(page, _marker(page, 1, "Open"), "data-near", "true")
        _attr(page, marker, "data-near", "false")
        _until(page, lambda: expect(card).to_have_accessible_name(re.compile(r"Near seam$"), timeout=QUICK_MS))
    pinned = next(s for s in _ok(avery.get(f"/api/viewpoints/{viewpoint['id']}/snags"), 200)["snags"] if s["title"] == title)
    assert (pinned["s"], pinned["y"], pinned["number"]) == (40, 50, 2)


def test_seam_reduced_motion(browser: Browser, app_url: str) -> None:
    avery = Api(app_url, AVERY)
    project, viewpoint = _site_walk(avery)
    _ok(_snag(avery, viewpoint["id"], 30, 40), 201)
    with _app(browser, app_url, f"/office/projects/{project['id']}/site-walk", avery, reduced=True) as page:
        frame = page.get_by_role("group", name="Intent seam")
        for name, s in (("Render", 100), ("Split", 50), ("Photo", 0)):
            click(page.get_by_role("button", name=name, exact=True))
            _seam_is(page, s)
        click(page.get_by_role("list", name="Snags").get_by_role("button", name=re.compile(r"^Snag 1 ")))
        assert [a for a in animations(frame) if a["duration"] >= 1] == []
        _seam_is(page, 30)
        _tab_to(page, page.get_by_role("slider", name="Seam"))
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Drop snag")
        _visible(page, dialog)
        assert [a for a in animations(dialog) if a["duration"] >= 1] == []
        fill(dialog.get_by_role("textbox", name="Snag title"), "Counter edge banding lifted")
        dialog.get_by_label("Observed on").fill(SUITE_DAY.isoformat())
        click(dialog.get_by_role("button", name="Pin snag"))
        marker = _marker(page, 2, "Open")
        _visible(page, marker)
        assert [a for a in animations(marker) if a["duration"] >= 1] == []


def test_snag_rules(app_url: str) -> None:
    avery, rin, kai = Api(app_url, AVERY), Api(app_url, RIN), Api(app_url, KAI)
    project, viewpoint = _site_walk(avery, _sg_contract(avery, defects=1), "SG-ORC-01")
    vid = viewpoint["id"]
    snag = _ok(_snag(rin, vid, 30, 40), 201)["snag"]

    def act(api: Api, action: str) -> httpx.Response:
        return api.post(f"/api/snags/{snag['id']}/transitions", {"action": action})

    assert snag["state"] == "open" and snag["number"] == 1
    _err(act(rin, "close"), 409, "illegal_transition")
    _err(act(rin, "reopen"), 409, "illegal_transition")
    assert _ok(act(kai, "fix"), 200)["snag"]["state"] == "fixed"
    _err(act(kai, "close"), 403, "forbidden")
    assert _ok(act(rin, "close"), 200)["snag"]["state"] == "closed"
    moved = _err(rin.patch(f"/api/snags/{snag['id']}", {"s": 55}), 409, "illegal_transition")
    assert moved["action"] == "move"
    assert _ok(act(rin, "reopen"), 200)["snag"]["state"] == "reopened"
    assert _ok(act(rin, "fix"), 200)["snag"]["state"] == "fixed"
    assert _ok(act(rin, "reopen"), 200)["snag"]["state"] == "reopened"
    moved_s = 55
    assert _ok(rin.patch(f"/api/snags/{snag['id']}", {"s": moved_s}), 200)["snag"]["s"] == moved_s
    base = {"s": 10, "y": 10, "title": "Grout", "observedOn": _today().isoformat()}
    _field(rin.post(f"/api/viewpoints/{vid}/snags", {**base, "note": "n" * 501}), "note", _too_long("Note", 500))
    assert _ok(rin.post(f"/api/viewpoints/{vid}/snags", {**base, "note": FAMILY * 500}), 201)["snag"]["number"] == 2
    _field(rin.post(f"/api/viewpoints/{vid}/snags", {**base, "title": "t" * 121}), "title", _too_long("Snag title", 120))
    _field(rin.post(f"/api/viewpoints/{vid}/snags", {**base, "s": 101}), "s")
    _field(rin.post(f"/api/viewpoints/{vid}/snags", {**base, "observedOn": (_today() + timedelta(days=1)).isoformat()}), "observedOn",
           re.compile(r"can't be in the future\.$"))
    _ok(avery.post(f"/api/projects/{project['id']}/practical-completion", {"date": "2026-01-31"}), 201)
    _field(rin.post(f"/api/viewpoints/{vid}/snags", {**base, "observedOn": "2026-03-01"}), "observedOn",
           "This defect was observed after the defects period ended on 28 Feb 2026.")
    _ok(rin.post(f"/api/viewpoints/{vid}/snags", {**base, "observedOn": "2026-02-28"}), 201)


def test_site_photo_stripped(app_url: str) -> None:
    from PIL import Image

    avery = Api(app_url, AVERY)
    bucket = _bucket()
    project, viewpoint = _site_walk(avery)
    landscape = Image.new("RGB", (40, 20), PHOTO_RGB)
    exif = Image.Exif()
    exif[EXIF_ORIENTATION] = 6
    gps = exif.get_ifd(EXIF_GPS)
    gps[1], gps[2] = "N", (22.0, 16.0, 30.0)
    raw = io.BytesIO()
    landscape.save(raw, "JPEG", exif=exif.tobytes())
    photo = _ok(avery.post(f"/api/viewpoints/{viewpoint['id']}/photos", files={"file": ("site.jpg", raw.getvalue(), "image/jpeg")}), 201)["photo"]
    assert photo["width"] < photo["height"]
    key = next(k for k in bucket.keys(f"projects/{project['id']}/viewpoints/{viewpoint['id']}/photos/") if photo["id"] in k)
    served = avery.get(f"/api/viewpoints/{viewpoint['id']}/photo")
    assert served.status_code == 200 and served.headers.get("x-content-type-options") == "nosniff"
    for payload in (served.content, bucket.get(key)):
        image = Image.open(io.BytesIO(payload))
        assert image.width < image.height
        tags = image.getexif()
        assert tags.get(EXIF_ORIENTATION) in (None, 1) and not tags.get_ifd(EXIF_GPS)


def test_wf_snagging_phone_site_walk(browser: Browser, app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    project, viewpoint = _site_walk(avery)
    with _app(browser, app_url, f"/office/projects/{project['id']}/site-walk", rin, viewport=PHONE) as page:
        frame = page.get_by_role("group", name="Intent seam")
        _visible(page, frame)
        _in_view(frame)
        box = _box(page, frame)
        mid = box["y"] + box["height"] / 2

        def x_at(s: float) -> float:
            return box["x"] + box["width"] * s / 100

        _touch(page, [(x_at(60), mid), (x_at(60) - TOUCH_SLOP_PX * 2, mid), (x_at(30), mid)])
        _seam_is(page, 30)
        tap(page.get_by_role("button", name="Drop snag here").first)
        sheet = page.get_by_role("dialog", name="Drop snag")
        title = sheet.get_by_role("textbox", name="Snag title")
        observed = sheet.get_by_label("Observed on")
        _tab_to(page, observed)
        observed.fill(SUITE_DAY.isoformat())
        _steady(page, lambda: tap(sheet.get_by_role("button", name="Pin snag")))
        _refused(page, sheet, f"{'Snag title'} is required.")
        _audit(page)
        _type(page, title, "Shopfront mullion out of line")
        _unobstructed(page, title)
        _tab_to(page, observed)
        _unobstructed(page, observed)
        tap(sheet.get_by_role("button", name="Pin snag"))
        _hear(page, "Snag 1 pinned at 30% across, 50% down.")
        _visible(page, _marker(page, 1, "Open"))
        _screen_layout(page)
    snag = _ok(rin.get(f"/api/viewpoints/{viewpoint['id']}/snags"), 200)["snags"][0]
    assert (snag["s"], snag["y"], snag["title"]) == (30, 50, "Shopfront mullion out of line")


def test_wf_snagging_refused_move(browser: Browser, app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    project, viewpoint = _site_walk(avery)
    snag = _ok(_snag(rin, viewpoint["id"], 32, 58), 201)["snag"]
    for action in ("fix", "close"):
        _ok(rin.post(f"/api/snags/{snag['id']}/transitions", {"action": action}), 200)
    with _app(browser, app_url, f"/office/projects/{project['id']}/site-walk", rin) as page:
        marker = _marker(page, 1, "Closed")
        _visible(page, marker)
        _audit(page)
        _in_view(marker)
        start = _box(page, marker)
        centre = (start["x"] + start["width"] / 2, start["y"] + start["height"] / 2)
        _mouse_drag(page, centre, (centre[0] + 120, centre[1]))
        _hear(page, "Snag 1 is closed, so it can't be moved. It's back where it was.", "alert")

        def back() -> None:
            settle(marker)
            assert abs(_box(page, marker)["x"] - start["x"]) <= SUBPIXEL
        _until(page, back)
    assert _ok(rin.get(f"/api/viewpoints/{viewpoint['id']}/snags"), 200)["snags"][0]["s"] == snag["s"]


LEGACY_HEADER = "category,FINISH NAME,finish code,supplier,product ref,location,notes"
LEGACY_ROWS = [
    "Paint,Warm white eggshell,pt-01,Dulux,,,",
    "Laminate,  Ash   laminate ,LM-01,,,,",
    "Stone,Honed basalt counter,ST-99,,,,",
    "Timber,Oak veneer,,,,,",
    "Paint,,,,,,",
    "Plastic,Vinyl wrap,,,,,",
    "Tile,Terrazzo floor tile,TL-01,,,,",
    "Tile,Terrazzo floor tile,TL-01,,,,",
]


def _import(api: Api, pid: str, body: bytes) -> httpx.Response:
    return api.post(f"/api/projects/{pid}/finishes/import", content=body, headers={"Content-Type": "text/csv"})


def test_finishes_import(app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    _finish(rin, pid, code="PT-01", name="Warm white eggshell", category="Paint")
    _finish(rin, pid, name="Ash laminate", category="Laminate")
    _finish(rin, pid, code="ST-01", name="Honed basalt counter", category="Stone")
    _finish(rin, pid, name="Oak veneer", category="Timber")
    _finish(rin, pid, name="Oak veneer", category="Timber")
    payload = ("\ufeff" + "\n".join([LEGACY_HEADER, *LEGACY_ROWS]) + "\n").encode()
    report = _ok(_import(rin, pid, payload), 200)
    assert report["summary"] == {"created": 1, "updated": 2, "unchanged": 0, "rejected": 5}
    rows = {r["line"]: r for r in report["rows"]}
    assert [rows[n]["status"] for n in range(2, 10)] == ["updated", "updated", "rejected", "rejected", "rejected", "rejected", "created", "rejected"]
    cells = [row.split(",") for row in LEGACY_ROWS]
    assert rows[4]["reason"] == f"Code {cells[2][2]} conflicts with {SEED_FINISHES[4][0]} for the same name."
    assert rows[5]["reason"] == "Name matches more than one finish."
    assert rows[6]["reason"] == "Name is missing."
    assert rows[7]["reason"] == f"Unknown category {cells[5][0]}."
    assert rows[9]["reason"] == f"Duplicate of line {LEGACY_ROWS.index(LEGACY_ROWS[7]) + 2}."
    finishes = {f["name"]: f for f in _finishes(rin, pid)}
    assert finishes["Warm white eggshell"]["supplier"] == cells[0][3] and finishes["Ash laminate"]["code"] == "LM-01"
    assert finishes["Terrazzo floor tile"]["position"] == 6
    again = _ok(_import(rin, pid, payload), 200)["summary"]
    assert again["created"] == 0 and again["unchanged"] == 3 and len(_finishes(rin, pid)) == 6
    _field(_import(rin, pid, b"Finish Code,Supplier\nPT-09,Dulux\n"), "file", "The file needs Finish Name and Category columns.")
    many = "\n".join(["Finish Name,Category"] + [f"Finish {n},Paint" for n in range(CSV_ROWS + 1)]).encode()
    _field(_import(rin, pid, many), "file", "The file can have at most 2,000 rows.")
    huge = b"Finish Name,Category\n" + b"x" * CSV_LIMIT
    assert _err(_import(rin, pid, huge), 413, "file_too_large")["limitBytes"] == CSV_LIMIT
    assert len(_finishes(rin, pid)) == 6
    _err(_import(Api(app_url, KAI), pid, payload), 404, "not_found")


def test_finishes_reorder(browser: Browser, app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    _seed_finishes(rin, pid)
    finish = next(f for f in _finishes(rin, pid) if f["code"] == "MT-01")
    _field(rin.post(f"/api/finishes/{finish['id']}/move", {"position": 7}), "position")
    with _app(browser, app_url, f"/office/projects/{pid}/finishes", rin) as page:
        _tab_to(page, _reorder(page, "TL-01"))
        page.keyboard.press("Enter")
        _hear(page, "Picked up TL-01 Terrazzo floor tile. Position 3 of 6. Use the up and down arrow keys to move, Enter to drop, Escape to cancel.")
        page.keyboard.press("ArrowUp")
        _hear(page, "TL-01 Terrazzo floor tile moved to position 2 of 6.")
        page.keyboard.press("Enter")
        _hear(page, "TL-01 Terrazzo floor tile dropped at position 2 of 6.")
        _until(page, lambda: _check([f["code"] for f in _finishes(rin, pid)][1] == "TL-01", "keyboard move not saved"))
        _tab_to(page, _reorder(page, "MT-01"))
        page.keyboard.press("Space")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Escape")
        _hear(page, "Reorder cancelled. MT-01 Brushed bronze trim is back at position 6 of 6.")
        _in_view(_reorder(page, "ST-01"))
        source = _box(page, _reorder(page, "ST-01"))
        target = _box(page, _reorder(page, "PT-01"))
        _mouse_drag(page, (source["x"] + source["width"] / 2, source["y"] + source["height"] / 2),
                    (target["x"] + target["width"] / 2, target["y"] + 2))
        _until(page, lambda: _check([f["code"] for f in _finishes(rin, pid)][0] == "ST-01", "drag not saved"))
        page.reload()
        _until(page, lambda: expect(page.get_by_role("table", name="Finishes schedule").get_by_role("row").nth(1)).to_contain_text("ST-01", timeout=QUICK_MS))
    assert [f["code"] for f in _finishes(rin, pid)][-1] == "MT-01"


def test_finishes_csv(app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    _seed_finishes(rin, pid)
    _finish(rin, pid, name="+Plus finish", category="Other", supplier="=HYPERLINK(1)", location="@loc", notes="-minus")
    tab_note = "\tTabbed"
    _finish(rin, pid, name="Tab finish", category="Other", notes=tab_note)
    response = rin.get(f"/api/projects/{pid}/finishes.csv")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert list(rows[0]) == ["position", "code", "name", "category", "supplier", "product_ref", "location", "notes"]
    assert [r["position"] for r in rows] == [str(n) for n in range(1, len(rows) + 1)]
    assert [r["code"] for r in rows[:6]] == [c for c, _, _ in SEED_FINISHES]
    plus = rows[6]
    assert (plus["name"], plus["supplier"], plus["location"], plus["notes"]) == ("'+Plus finish", "'=HYPERLINK(1)", "'@loc", "'-minus")
    assert rows[7]["notes"] == "'" + tab_note


def test_wf_finishes_schedule_upkeep(browser: Browser, app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    _seed_finishes(rin, pid)
    new_code = "GL-01"
    legacy = f"Finish Code,Finish Name,Category\nPT-01,Warm white eggshell,Paint\n{new_code},Fluted glass,Glass\n,Mystery,{LEGACY_BAD_CATEGORY}\n".encode()
    with _app(browser, app_url, f"/office/projects/{pid}/finishes", rin) as page:
        _press(page, page.get_by_role("button", name="Import CSV"))
        dialog = page.get_by_role("dialog", name="Import finishes")
        _press(page, dialog.get_by_role("button", name="Import"))
        _refused(page, dialog, f"{'Legacy CSV file'} is required.")
        _audit(page)
        dialog.get_by_label("Legacy CSV file").set_input_files([{"name": "legacy.csv", "mimeType": "text/csv", "buffer": legacy}])
        _press(page, dialog.get_by_role("button", name="Import"))
        _hear(page, "Import finished: 1 created, 0 updated, 1 unchanged, 1 rejected.")
        report = page.get_by_role("table", name="Import report")
        _until(page, lambda: _check(report.evaluate("t => t.contains(document.activeElement)", timeout=QUICK_MS), "focus is not on the import report"))
        _until(page, lambda: expect(report).to_contain_text(f"Unknown category {LEGACY_BAD_CATEGORY}.", timeout=QUICK_MS))
        _audit(page)
        _tab_to(page, _reorder(page, "PT-02"))
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        _hear(page, "PT-02 Oxide red accent dropped at position 3 of 7.")
        _tab_to(page, _reorder(page, new_code))
        page.keyboard.press("Space")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Escape")
        _hear(page, "Reorder cancelled. GL-01 Fluted glass is back at position 7 of 7.")
        delivered = _download(page, page.get_by_role("link", name="Export finishes CSV"))
    order = [f["code"] for f in _finishes(rin, pid)]
    assert order[:3] == ["PT-01", "TL-01", "PT-02"] and order[-1] == new_code
    exported = [r["code"] for r in csv.DictReader(io.StringIO(delivered.lstrip("\ufeff")))]
    assert exported == order


def test_wf_finishes_schedule_reimport(browser: Browser, app_url: str) -> None:
    avery, rin = Api(app_url, AVERY), Api(app_url, RIN)
    pid = _project(avery)["id"]
    _seed_finishes(rin, pid)
    legacy = "Finish Code,Finish Name,Category\nPT-01,Warm white eggshell,Paint\nTL-01,Terrazzo floor tile,Tile\n".encode()
    with _app(browser, app_url, f"/office/projects/{pid}/finishes", rin) as page:
        for _ in range(2):
            _press(page, page.get_by_role("button", name="Import CSV"))
            dialog = page.get_by_role("dialog", name="Import finishes")
            dialog.get_by_label("Legacy CSV file").set_input_files([{"name": "legacy.csv", "mimeType": "text/csv", "buffer": legacy}])
            _press(page, dialog.get_by_role("button", name="Import"))
            _hear(page, "Import finished: 0 created, 0 updated, 2 unchanged, 0 rejected.")
            _until(page, lambda: expect(dialog).to_be_hidden(timeout=QUICK_MS))
    assert len(_finishes(rin, pid)) == len(SEED_FINISHES)


def test_case_study_lifecycle(app_url: str, mail: Any) -> None:
    avery, dana, robin = Api(app_url, AVERY), Api(app_url, DANA), Api(app_url, ROBIN)
    case = _case_study(avery)
    cid = case["id"]
    _err(dana.post(f"/api/case-studies/{cid}/approve", {}), 409, "illegal_transition")
    _err(avery.post(f"/api/case-studies/{cid}/publish", {}), 409, "illegal_transition")
    past = _iso(datetime.now(timezone.utc) - timedelta(minutes=1))
    _field(avery.post(f"/api/case-studies/{cid}/preview-links", {"expiresAt": past}), "expiresAt", "Choose an expiry after now.")
    _, first = _preview(avery, cid)
    preview = _ok(httpx.get(f"{app_url}/api/preview/{first}"), 200)
    assert preview["canApprove"] is False and preview["caseStudy"]["title"] == case["title"]
    sent = _mails(mail, lambda m: _subject(m) == f"Case study preview: {case['title']}", count=2)
    members = _ok(avery.get("/api/members"), 200)["members"]
    kestrel = {m["email"].lower() for m in members if m["role"] == "client_approver" and m["organisation"] == KESTREL}
    mailed = [a for m in sent for a in _to(m)]
    assert len(mailed) == len(set(mailed)) and {DANA, QUINN} <= set(mailed) <= kestrel
    assert all(f"/preview/{first}" in _content(m) for m in sent)
    _err(Api(app_url).post(f"/api/case-studies/{cid}/approve", {}), 401, "session_ended")
    link, second = _preview(avery, cid)
    _err(httpx.get(f"{app_url}/api/preview/{first}"), 404, "not_found")
    assert _ok(dana.get(f"/api/preview/{second}"), 200)["canApprove"] is True
    assert _ok(robin.get(f"/api/preview/{second}"), 200)["canApprove"] is False
    _err(robin.post(f"/api/case-studies/{cid}/approve", {}), 404, "not_found")
    assert avery.delete(f"/api/preview-links/{link['id']}").status_code == 204
    _err(httpx.get(f"{app_url}/api/preview/{second}"), 404, "not_found")
    _, brief = _preview(avery, cid, PREVIEW_TTL_PROBE)
    _ok(httpx.get(f"{app_url}/api/preview/{brief}"), 200)
    _poll(lambda: httpx.get(f"{app_url}/api/preview/{brief}").status_code == 404, PREVIEW_TTL_PROBE + 10, "preview link never expired")
    _err(httpx.get(f"{app_url}/api/preview/{brief}"), 404, "not_found")
    _preview(avery, cid)
    states = {c["id"]: c["state"] for c in _ok(avery.get("/api/case-studies"), 200)["caseStudies"]}
    assert states[cid] == "preview_sent"
    assert _ok(dana.post(f"/api/case-studies/{cid}/approve", {}), 200)["caseStudy"]["state"] == "client_approved"
    assert _ok(avery.post(f"/api/case-studies/{cid}/publish", {}), 200)["caseStudy"]["state"] == "published"
    _ok(httpx.get(f"{app_url}/api/public/case-studies/{case['slug']}"), 200)
    assert _ok(avery.post(f"/api/case-studies/{cid}/withdraw", {}), 200)["caseStudy"]["state"] == "withdrawn"
    _err(avery.post(f"/api/case-studies/{cid}/withdraw", {}), 409, "illegal_transition")
    _err(avery.post(f"/api/case-studies/{cid}/publish", {}), 409, "illegal_transition")


def test_withdrawn_vanishes(app_url: str) -> None:
    avery = Api(app_url, AVERY)
    case, token = _published(app_url, avery)
    slug = case["slug"]

    def public(path: str) -> list[str]:
        return [c["slug"] for c in _ok(httpx.get(f"{app_url}{path}"), 200)["caseStudies"]]

    def count() -> int:
        return next(s["count"] for s in _ok(httpx.get(f"{app_url}/api/public/sectors"), 200)["sectors"] if s["key"] == "food_beverage")

    assert slug in public("/api/public/case-studies") and slug in public("/api/public/featured")
    food = public("/api/public/case-studies?sector=food_beverage")
    assert slug in food and count() == len(food)
    cover = httpx.get(f"{app_url}/media/covers/{slug}.svg")
    assert cover.status_code == 200 and cover.headers["content-type"].startswith("image/svg+xml")
    _ok(avery.post(f"/api/case-studies/{case['id']}/withdraw", {}), 200)
    food = public("/api/public/case-studies?sector=food_beverage")
    assert slug not in public("/api/public/case-studies") and slug not in public("/api/public/featured") and slug not in food
    assert count() == len(food)
    _err(httpx.get(f"{app_url}/api/public/case-studies/{slug}"), 404, "not_found")
    assert httpx.get(f"{app_url}/media/covers/{slug}.svg").status_code == 404
    assert httpx.get(f"{app_url}/work/{slug}").status_code == 404
    _err(httpx.get(f"{app_url}/api/preview/{token}"), 404, "not_found")
    assert httpx.get(f"{app_url}/preview/{token}").status_code == 404


def test_work_index_url(browser: Browser, app_url: str) -> None:
    sectors = _ok(httpx.get(f"{app_url}/api/public/sectors"), 200)
    counts = {s["key"]: s["count"] for s in sectors["sectors"]}
    food = _ok(httpx.get(f"{app_url}/api/public/case-studies?sector=food_beverage"), 200)["caseStudies"]
    with _app(browser, app_url, "/work") as page:
        group = page.get_by_role("group", name="Sector")
        everything = group.get_by_role("button", name=f"All ({sectors['total']})")
        food_button = group.get_by_role("button", name=f"Food & beverage ({counts['food_beverage']})")
        _visible(page, group.get_by_role("button", name=f"Retail ({counts['retail']})"))
        _visible(page, group.get_by_role("button", name=f"Workplace ({counts['workplace']})"))
        _attr(page, everything, "aria-pressed", "true")
        click(food_button)
        _until(page, lambda: _check(_query(page).get("sector") == "food_beverage", page.url))
        _attr(page, food_button, "aria-pressed", "true")
        listed = page.get_by_role("list", name="Case studies")
        _until(page, lambda: _listed(listed, food))
        _pick(page.get_by_role("radiogroup", name="View").get_by_role("radio", name="List"))
        _until(page, lambda: _check(_query(page).get("view") == "list", page.url))
        page.go_back()
        _until(page, lambda: expect(page.get_by_role("radio", name="Grid")).to_be_checked(timeout=QUICK_MS))
        _attr(page, food_button, "aria-pressed", "true")
        page.go_back()
        _attr(page, everything, "aria-pressed", "true")
        assert "sector" not in _query(page)
        page.go_forward()
        _attr(page, food_button, "aria-pressed", "true")
        _until(page, lambda: _listed(listed, food))


def test_featured_rail(browser: Browser, app_url: str) -> None:
    with _app(browser, app_url, "/") as page:
        rail = page.get_by_role("region", name="Featured work")
        cards = rail.get_by_role("link")
        _visible(page, cards.first)
        _in_view(rail)
        settle(rail)
        start = _box(page, cards.nth(0))["x"]

        def aligned(index: int) -> None:
            _check(abs(_box(page, cards.nth(index))["x"] - start) <= SUBPIXEL, f"card {index} not at rail start")

        click(rail.get_by_role("button", name="Next"))
        _until(page, lambda: (settle(rail), aligned(1)))
        click(rail.get_by_role("button", name="Previous"))
        _until(page, lambda: (settle(rail), aligned(0)))
        box = _box(page, cards.nth(1))
        pitch = box["x"] - start
        y = box["y"] + box["height"] / 2
        grab = box["x"] + box["width"] / 2
        flick, frames = pitch * 0.4, 2
        assert flick > RAIL_DRAG_PX and flick / (frames * 16 + RAIL_RELEASE_MS) > RAIL_FLICK_PX_PER_MS
        page.mouse.move(grab, y)
        settle(rail)
        _watch_glides(rail)
        page.mouse.down()
        for step in range(1, frames + 1):
            advance(page, 16)
            page.mouse.move(grab - flick * step / frames, y)
        advance(page, RAIL_RELEASE_MS)
        page.mouse.up()
        advance(page, 16)
        gliding = _box(page, cards.nth(0))["x"]
        ends = _glide_ends(rail)
        advance(page, RAIL_SETTLE_MS - 16)
        glides = page.evaluate("() => window.__glides")
        settle(rail)
        assert glides and all(end <= RAIL_SETTLE_MS + 1 for end in ends + glides), (ends, glides)
        assert urlparse(page.url).path == "/"
        positions = [_box(page, cards.nth(i))["x"] for i in range(cards.count())]
        assert positions[0] < start - SUBPIXEL and any(abs(x - start) <= SUBPIXEL for x in positions)
        assert abs(gliding - positions[0]) > SUBPIXEL, "the rail jumped to a card instead of gliding"
        box = _box(page, rail)
        y = box["y"] + box["height"] / 2
        _touch(page, [(box["x"] + box["width"] * 0.3, y), (box["x"] + box["width"] * 0.5, y), (box["x"] + box["width"] * 0.7, y)])
        advance(page, RAIL_SETTLE_MS)
        settle(rail)
        assert urlparse(page.url).path == "/"
        positions = [_box(page, cards.nth(i))["x"] for i in range(cards.count())]
        target = next(i for i, x in enumerate(positions) if abs(x - start) <= SUBPIXEL)
        name = cards.nth(target).inner_text().strip()
        assert name
        click(cards.nth(target))
        _url(page, r"/work/[a-z0-9-]+$")


def test_public_motion_names(browser: Browser, app_url: str) -> None:
    with _app(browser, app_url, "/") as page:
        _until(page, lambda: expect(page).to_have_title("Marrow Hall Interiors", timeout=QUICK_MS))
        _visible(page, page.get_by_role("heading", level=1, name="Rollouts built store by store, signed off stage by stage."))
        for role, name in (("link", "Marrow Hall"), ("link", "See the work"), ("link", "Start a project"), ("button", "Next"), ("button", "Previous")):
            target = page.get_by_role(role, name=name, exact=True).first
            expect(target).to_have_accessible_name(name)
        cta = page.get_by_role("link", name="See the work", exact=True)
        cta.hover()
        expect(cta).to_have_accessible_name("See the work")
        banner = page.get_by_role("banner")
        _attr(page, banner, "data-tone", "light")
        page.get_by_role("heading", name="How we deliver").evaluate("h => window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - 10)")
        _attr(page, banner, "data-tone", "dark")
        page.evaluate("() => window.scrollTo(0, 0)")
        _attr(page, banner, "data-tone", "light")
        _install_probe(page, TRANSITION_JS, "__transitions")
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Work", exact=True))
        _until(page, lambda: expect(page).to_have_title("Work · Marrow Hall Interiors", timeout=QUICK_MS))
        _focus(page, page.get_by_role("heading", level=1))
        _until(page, lambda: _check("forward" in _probe_records(page, "__transitions"), "no forward wipe"))
        _until(page, lambda: _check(page.evaluate("() => document.documentElement.hasAttribute('data-transition')") is False, "wipe never ended"))
        page.go_back()
        _until(page, lambda: expect(page).to_have_title("Marrow Hall Interiors", timeout=QUICK_MS))
        _until(page, lambda: _check("back" in _probe_records(page, "__transitions"), "no back wipe"))
        _focus(page, page.get_by_role("heading", level=1, name="Rollouts built store by store, signed off stage by stage."))
    with _app(browser, app_url, "/nowhere-at-all") as page:
        _until(page, lambda: expect(page).to_have_title("Page not found · Marrow Hall Interiors", timeout=QUICK_MS))


def test_wf_case_studies_preview_publish_withdraw(browser: Browser, app_url: str, mail: Any) -> None:
    avery = Api(app_url, AVERY)
    case = _case_study(avery)
    with _app(browser, app_url, "/office/case-studies", avery) as page:
        _visible(page, _record_button(page, case["title"], "Send preview"))
        _audit(page)
        _press(page, _record_button(page, case["title"], "Send preview"))
        dialog = page.get_by_role("dialog", name="Send preview")
        expires = dialog.get_by_label("Link expires at")
        _focus(page, expires)
        expires.fill((_hk_now() - timedelta(hours=PAST_HOURS)).strftime("%Y-%m-%dT%H:%M"))
        _press(page, dialog.get_by_role("button", name="Send preview link"))
        _refused(page, dialog, "Choose an expiry after now.")
        _audit(page)
        _tab_to(page, expires)
        expires.fill((_hk_now() + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M"))
        _press(page, dialog.get_by_role("button", name="Send preview link"))
        _hear(page, re.compile(rf"Preview sent to \d+ approvers\. The link works until {TIME_RE}\."))
    sent = _mails(mail, lambda m: _subject(m) == f"Case study preview: {case['title']}" and DANA in _to(m))
    token = _token(_content(sent[0]), "preview")
    with _app(browser, app_url, f"/preview/{token}") as page:
        _visible(page, page.get_by_role("link", name="Sign in to approve"))
        _audit(page)
        expect(page.get_by_role("button", name="Approve for publishing")).to_have_count(0)
    with _app(browser, app_url, f"/preview/{token}", Api(app_url, DANA)) as page:
        _press(page, page.get_by_role("button", name="Approve for publishing"))
        _hear(page, "Approved for publishing.")
    with _app(browser, app_url, "/office/case-studies", avery) as page:
        _press(page, _record_button(page, case["title"], "Publish"))
        _hear(page, f"{case['title']} is live.")
        _focus(page, page.get_by_role("heading", name="Case study status", exact=True))
        _ok(httpx.get(f"{app_url}/api/public/case-studies/{case['slug']}"), 200)
        _press(page, _record_button(page, case["title"], "Withdraw"))
        _press(page, page.get_by_role("dialog", name="Withdraw case study").get_by_role("button", name="Withdraw from public site"))
        _hear(page, f"{case['title']} withdrawn from the public site.")
        _focus(page, page.get_by_role("heading", name="Case study status", exact=True))
    _err(httpx.get(f"{app_url}/api/public/case-studies/{case['slug']}"), 404, "not_found")
    _err(httpx.get(f"{app_url}/api/preview/{token}"), 404, "not_found")


def test_wf_case_studies_public_find(browser: Browser, app_url: str) -> None:
    avery = Api(app_url, AVERY)
    case, _ = _published(app_url, avery)
    count = next(s["count"] for s in _ok(httpx.get(f"{app_url}/api/public/sectors"), 200)["sectors"] if s["key"] == "food_beverage")
    with _app(browser, app_url, "/work") as page:
        click(page.get_by_role("group", name="Sector").get_by_role("button", name=f"Food & beverage ({count})"))
        _pick(page.get_by_role("radiogroup", name="View").get_by_role("radio", name="List"))
        _visible(page, page.get_by_role("list", name="Case studies").get_by_role("link", name=case["title"]))
        _audit(page)
        _go(page, f"{app_url}/")
        card = page.get_by_role("region", name="Featured work").get_by_role("link", name=case["title"])
        _tab_to(page, card)
        page.keyboard.press("Enter")
        _until(page, lambda: expect(page).to_have_title(f"{case['title']} · Marrow Hall Interiors", timeout=QUICK_MS))
        _url(page, rf"/work/{case['slug']}$")
        _audit(page)
    assert _ok(httpx.get(f"{app_url}/api/public/case-studies/{case['slug']}"), 200)["caseStudy"]["title"] == case["title"]


def test_enquiry_notifications(app_url: str, mail: Any) -> None:
    body = _enquiry()
    reference = _ok(httpx.post(f"{app_url}/api/enquiries", json=body), 201)["enquiry"]["reference"]
    assert re.fullmatch(r"ENQ-\d{4}", reference)
    notices = _mails(mail, lambda m: _subject(m) == f"New enquiry from {body['name']} at {body['company']}")
    assert AVERY in [a for m in notices for a in _to(m)]
    for notice in notices:
        _single_recipient(notice)
        assert [a.lower() for a in addresses(notice.get("ReplyTo") or [])] == [body["email"].lower()]
        for part in (body["name"], body["company"], body["email"], body["phone"], body["message"], reference):
            assert part in _content(notice)
    acks = _mails(mail, lambda m: body["email"].lower() in _to(m) and _subject(m) == "We've received your enquiry")
    assert len(acks) == 1 and all(p in _content(acks[0]) for p in (reference, body["name"], body["message"]))
    _single_recipient(acks[0])
    assert reference in json.dumps(_ok(Api(app_url, AVERY).get("/api/enquiries"), 200))
    injected = _enquiry()
    for field, copy in (("name", "Your name must be on one line."), ("company", "Company must be on one line.")):
        _field(httpx.post(f"{app_url}/api/enquiries", json={**injected, field: "Visitor\r\nBcc: probe@example.com"}), field, copy)
    _quiet(mail, lambda m: injected["email"].lower() in _to(m) or "probe@example.com" in json.dumps(m))


def test_enquiry_rate_limit(browser: Browser, app_url: str, mail: Any) -> None:
    _, email = unique("ratelimited")
    for _ in range(3):
        _ok(httpx.post(f"{app_url}/api/enquiries", json=_enquiry(email)), 201)
    _field(httpx.post(f"{app_url}/api/enquiries", json=_enquiry(email, sites=0)), "sites")
    limited = httpx.post(f"{app_url}/api/enquiries", json=_enquiry(email.upper()))
    body = _err(limited, 429, "rate_limited")
    assert isinstance(body["retryAfterSeconds"], int) and body["retryAfterSeconds"] >= 1
    assert limited.headers["retry-after"] == str(body["retryAfterSeconds"])
    with _app(browser, app_url, "/start?step=1") as page:
        for name, value in (("Your name", "Visitor"), ("Company", "Visitor Retail"), ("Email", email)):
            fill(page.get_by_role("textbox", name=name), value)
        click(page.get_by_role("button", name="Next"))
        _choose(page.get_by_role("combobox", name="Sector"), "Retail")
        _choose(page.get_by_role("combobox", name="Region"), "Hong Kong")
        fill(page.get_by_role("spinbutton", name="Number of sites"), str(SITES))
        page.get_by_label("Target opening month").fill(_month())
        click(page.get_by_role("button", name="Next"))
        fill(page.get_by_role("textbox", name="Tell us about the rollout"), ENQUIRY_MESSAGE)
        click(page.get_by_role("button", name="Send enquiry"))
        _until(page, lambda: expect(page.get_by_role("alert", name="Site problems")).to_contain_text(
            re.compile(rf"You've sent 3 enquiries from {re.escape(email)} recently\. Please try again in (1 second|\d+ seconds)\."), timeout=QUICK_MS))
    acks = _mails(mail, lambda m: email.lower() in _to(m) and _subject(m) == "We've received your enquiry", count=3)
    assert len(acks) == 3


def _enquiry_step_one(page: Page, name: str, company: str, email: str) -> None:
    _type(page, page.get_by_role("textbox", name="Your name"), name)
    _type(page, page.get_by_role("textbox", name="Company"), company)
    _type(page, page.get_by_role("textbox", name="Email"), email)


def test_wf_enquiries_keyboard_draft(browser: Browser, app_url: str, mail: Any) -> None:
    name, email = unique("enquirer")
    company = f"{name} Retail"
    with _app(browser, app_url, "/") as page:
        _press(page, page.get_by_role("link", name="Start a project", exact=True).first)
        _until(page, lambda: _check(_query(page).get("step") == "1", page.url))
        _focus(page, page.get_by_role("heading", name="Step 1 of 3: About you"))
        _audit(page)
        _enquiry_step_one(page, name, company, email)
        _type(page, page.get_by_role("textbox", name="Phone (optional)"), "+852 5550 0101")
        _press(page, page.get_by_role("button", name="Next"))
        _until(page, lambda: _check(_query(page).get("step") == "2", page.url))
        _focus(page, page.get_by_role("heading", name="Step 2 of 3: The rollout"))
        _audit(page)
        sector, region = page.get_by_role("combobox", name="Sector"), page.get_by_role("combobox", name="Region")
        _tab_to(page, sector)
        _choose(sector, "Retail")
        _tab_to(page, region)
        _choose(region, "Hong Kong")
        _type(page, page.get_by_role("spinbutton", name="Number of sites"), str(SITES))
        month = page.get_by_label("Target opening month")
        _tab_to(page, month)
        month.fill(_month())
        page.reload()
        _listen(page)
        _until(page, lambda: expect(page.get_by_role("spinbutton", name="Number of sites")).to_have_value(str(SITES), timeout=QUICK_MS))
        _press(page, page.get_by_role("button", name="Next"))
        _focus(page, page.get_by_role("heading", name="Step 3 of 3: Your message"))
        _audit(page)
        _type(page, page.get_by_role("textbox", name="Tell us about the rollout"), ENQUIRY_MESSAGE)
        page.go_back()
        _until(page, lambda: expect(page.get_by_role("spinbutton", name="Number of sites")).to_have_value(str(SITES), timeout=QUICK_MS))
        page.go_back()
        _until(page, lambda: expect(page.get_by_role("textbox", name="Your name")).to_have_value(name, timeout=QUICK_MS))
        page.go_forward()
        page.go_forward()
        _until(page, lambda: expect(page.get_by_role("textbox", name="Tell us about the rollout")).to_have_value(ENQUIRY_MESSAGE, timeout=QUICK_MS))
        _press(page, page.get_by_role("button", name="Send enquiry"))
        success = page.get_by_role("heading", name=re.compile(rf"^Thanks, {re.escape(name)}\. Your enquiry ENQ-\d{{4}} is with our studio\.$"))
        _focus(page, success)
        found = re.search(r"ENQ-\d{4}", success.inner_text())
        assert found
        reference = found.group(0)
        _go(page, f"{app_url}/start?step=1")
        _until(page, lambda: expect(page.get_by_role("textbox", name="Your name")).to_have_value("", timeout=QUICK_MS))
    acks = _mails(mail, lambda m: email.lower() in _to(m) and _subject(m) == "We've received your enquiry")
    assert len(acks) == 1 and reference in _content(acks[0])
    assert _mails(mail, lambda m: _subject(m) == f"New enquiry from {name} at {company}")


def test_wf_enquiries_error_summary(browser: Browser, app_url: str, mail: Any) -> None:
    name, email = unique("enquirer")
    with _app(browser, app_url, "/start?step=1") as page:
        _type(page, page.get_by_role("textbox", name="Email"), "not-an-email")
        _press(page, page.get_by_role("button", name="Next"))
        for copy, field in (("Your name is required.", "Your name"), ("Company is required.", "Company"),
                            ("Enter an email address like name@example.com.", "Email")):
            _press(page, page.get_by_role("link", name=copy))
            _focus(page, page.get_by_role("textbox", name=field))
        assert _query(page).get("step") == "1"
        _audit(page)
        _enquiry_step_one(page, name, f"{name} Retail", email)
        _press(page, page.get_by_role("button", name="Next"))
        _choose(page.get_by_role("combobox", name="Sector"), "Retail")
        _choose(page.get_by_role("combobox", name="Region"), "Hong Kong")
        _type(page, page.get_by_role("spinbutton", name="Number of sites"), str(SITES))
        page.get_by_label("Target opening month").fill(_month())
        _press(page, page.get_by_role("button", name="Next"))
        _type(page, page.get_by_role("textbox", name="Tell us about the rollout"), ENQUIRY_MESSAGE)
        _press(page, page.get_by_role("button", name="Send enquiry"))
        _focus(page, page.get_by_role("heading", name=re.compile(rf"^Thanks, {re.escape(name)}\.")))
    assert _mails(mail, lambda m: email.lower() in _to(m) and _subject(m) == "We've received your enquiry")


TABS = ["stages", "drawings", "tenders", "variations", "certificates", "shop-drawings", "site-walk", "finishes"]


def test_three_viewports(browser: Browser, app_url: str) -> None:
    avery = Api(app_url, AVERY)
    project, _ = _site_walk(avery, _sg_contract(avery), "SG-ORC-01")
    paths = ["/", "/work", "/start?step=1", "/sign-in", "/office", "/office/members", "/office/case-studies", "/office/enquiries",
             *[f"/office/projects/{project['id']}/{tab}" for tab in TABS]]
    for viewport in VIEWPORTS:
        with _app(browser, app_url, "/", avery, viewport=viewport) as page:
            for path in paths:
                _go(page, app_url + path)
                _until(page, lambda: _screen_layout(page))
    with _app(browser, app_url, f"/office/projects/{project['id']}/variations", avery, viewport=PHONE) as page:
        tap(page.get_by_role("button", name="Raise variation").first)
        sheet = page.get_by_role("dialog", name="Raise variation")
        for field in ("Title", "Description", "Amount"):
            box = sheet.get_by_role("textbox", name=field)
            _tab_to(page, box)
            _unobstructed(page, box)


def test_accessibility_audit(browser: Browser, app_url: str, mail: Any) -> None:
    avery = Api(app_url, AVERY)
    name, email = unique("audited")
    _ok(avery.post("/api/invitations", {"email": email, "name": name, "role": "designer"}), 201)
    token = _token(_content(_mails(mail, lambda m: email.lower() in _to(m))[0]), "invite")
    for viewport in VIEWPORTS:
        with _app(browser, app_url, "/sign-in", viewport=viewport) as page:
            for path in ("/sign-in", f"/invite/{token}", "/nowhere-at-all"):
                _go(page, app_url + path)
                _audit(page)
        with _app(browser, app_url, "/office", avery, viewport=viewport) as page:
            for path in ("/office", "/office/enquiries", "/office/members"):
                _go(page, app_url + path)
                _audit(page)
            click(page.get_by_role("button", name="Invite member").first)
            _visible(page, page.get_by_role("dialog", name="Invite member"))
            _audit(page)


def test_error_order(app_url: str, mail: Any) -> None:
    avery, jordan, rin, dana = (Api(app_url, e) for e in (AVERY, JORDAN, RIN, DANA))
    assert httpx.get(f"{app_url}/api/health").json() == {"status": "ok"}
    oversize = b'{"x":"' + b"a" * JSON_LIMIT + b'"}'
    big = Api(app_url).post("/api/invitations", content=oversize, headers={"Content-Type": "application/json"})
    assert _err(big, 413, "body_too_large")["limitBytes"] == JSON_LIMIT
    _err(Api(app_url).get("/api/members"), 401, "session_ended")
    member, removed, _, _, _ = _join(app_url, avery, mail)
    assert avery.delete(f"/api/members/{member['id']}").status_code == 204
    _err(removed.get(f"/api/projects/{UNKNOWN_ID}"), 403, "access_removed")
    pid = _project(avery)["id"]
    _err(rin.post(f"/api/projects/{UNKNOWN_ID}/stages/groundwork/request", {}), 404, "not_found")
    _request_stage(jordan, pid)
    _err(rin.post(f"/api/projects/{pid}/stages/groundwork/request", {}), 403, "forbidden")
    _err(dana.post(f"/api/projects/{pid}/stages/scheme/return", {"reason": "r" * 1001}), 409, "illegal_transition")
    note_path = f"/api/projects/{pid}/stages/groundwork"
    _err(jordan.patch(note_path, content=b"{", headers={"Content-Type": "application/json"}), 400, "bad_request")
    note = f"{_name('note')} kept"
    _ok(jordan.patch(note_path, {"internalNote": note}), 200)
    foreign = jordan.patch(note_path, {"internalNote": f"{note} changed"}, headers={"Origin": EVIL_ORIGIN})
    _err(foreign, 403, "forbidden")
    assert _stages(jordan, pid)["groundwork"]["internalNote"] == note
    cross_origin = httpx.get(f"{app_url}/api/health", headers={"Origin": EVIL_ORIGIN}).headers
    assert not [h for h in cross_origin if h.lower().startswith("access-control-allow")]
    code = _code("A")
    _ok(_upload_sheet(rin, pid, code), 201)
    sheet_id = _sheets(rin, pid)[code]["id"]
    key = idempotency_key()
    body = {"purpose": "for_tender", "sheetRevisions": [{"sheetId": sheet_id, "revision": "A"}]}
    original = rin.post(f"/api/projects/{pid}/transmittals", body, key=key)
    _ok(original, 201)
    _ok(_upload_sheet(rin, pid, code), 201)
    replay = rin.post(f"/api/projects/{pid}/transmittals", body, key=key)
    assert replay.status_code == 201 and replay.json() == original.json()


def test_ended_session_removed_access(browser: Browser, app_url: str, mail: Any) -> None:
    avery = Api(app_url, AVERY)
    pid = _sg_contract(avery)["id"]
    lead = Api(app_url, JORDAN)
    title = f"{_name('draft')} bulkhead"
    path = f"/office/projects/{pid}/variations"
    with _app(browser, app_url, path, lead) as page:
        click(page.get_by_role("button", name="Raise variation").first)
        dialog = page.get_by_role("dialog", name="Raise variation")
        _steady(page, lambda: fill(dialog.get_by_role("textbox", name="Title"), title))
        fill(dialog.get_by_role("textbox", name="Description"), "Kept through sign-in")
        fill(dialog.get_by_role("textbox", name="Amount"), "124.00")
        assert lead.delete("/api/session").status_code == 204
        click(page.get_by_role("button", name="Submit variation"))
        _url(page, r"/sign-in\?next=")
        _listen(page)
        _until(page, lambda: expect(page.get_by_role("alert", name="Problems")).to_contain_text(
            "Your session ended. Sign in again and we'll put your draft back.", timeout=QUICK_MS))
        fill(page.get_by_role("textbox", name="Email"), JORDAN)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        _url(page, re.escape(path))
        _listen(page)
        _until(page, lambda: expect(page.get_by_role("dialog", name="Raise variation").get_by_role("textbox", name="Title")).to_have_value(title, timeout=QUICK_MS))
        _hear(page, "Your draft is restored.")
    assert title not in json.dumps(_ok(avery.get(f"/api/projects/{pid}/variations"), 200))
    member, leaver, _, _, _ = _join(app_url, avery, mail)
    with _app(browser, app_url, f"/office/projects/{pid}/drawings", leaver) as page:
        _visible(page, page.get_by_role("table", name="Drawing register"))
        assert avery.delete(f"/api/members/{member['id']}").status_code == 204
        page.reload()
        _until(page, lambda: expect(page.get_by_text("Your access to this workspace was removed. Anything unsaved was discarded.").first).to_be_visible(timeout=QUICK_MS))


def test_run_health_boundary(app_url: str) -> None:
    health = httpx.get(f"{app_url}/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/node_modules/", "/src/",
                 "/USER_README.md", "/api/not-a-route"):
        assert httpx.get(f"{app_url}{path}").status_code == 404, path
    pages = [httpx.get(f"{app_url}{p}").text for p in ("/", "/sign-in", "/work")]
    partners = {"S3_SECRET_ACCESS_KEY": "S3_ACCESS_KEY_ID", "KILLBILL_PASSWORD": "KILLBILL_USERNAME",
                "KILLBILL_API_SECRET": "KILLBILL_API_KEY", "S3_ACCESS_KEY_ID": "S3_SECRET_ACCESS_KEY"}
    for name, partner in partners.items():
        secret = os.environ.get(name)
        if not secret:
            continue
        pair = f"{os.environ.get(partner, '')}:{secret}"
        everyday = secret.isalpha() and len(secret) < 16
        needles = [pair, base64.b64encode(pair.encode()).decode()] if everyday else [secret]
        assert all(needle not in page_html for needle in needles for page_html in pages), name


def test_motion_system(browser: Browser, app_url: str) -> None:
    for reduced in (False, True):
        with _app(browser, app_url, "/", reduced=reduced) as page:
            _install_probe(page, MOTION_JS, "__motions")
            page.get_by_role("link", name="See the work", exact=True).hover()
            click(page.get_by_role("region", name="Featured work").get_by_role("button", name="Next"))
            page.get_by_role("heading", name="How we deliver").evaluate("h => window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - 10)")
            click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Work", exact=True))
            _until(page, lambda: expect(page).to_have_title("Work · Marrow Hall Interiors", timeout=QUICK_MS))
            motions = [m for m in _probe_records(page, "__motions") if m["duration"] >= 1]
            if reduced:
                assert motions == [], motions
            else:
                assert motions, "no motion recorded"
                assert all(round(m["duration"]) in MOTION_MS and m["iterations"] is not None for m in motions), motions


def _lock_packages() -> dict[str, dict[str, Any]]:
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    shipped = {}
    for key, meta in lock.get("packages", {}).items():
        if not key or meta.get("dev") or meta.get("devOptional") or meta.get("link"):
            continue
        if meta.get("optional") and not (Path(DEPLOYED_APP) / key).is_dir():
            continue
        shipped[key.rsplit("node_modules/", 1)[-1]] = {**meta, "path": key}
    return shipped


def _licence_ok(expression: str) -> bool:
    expression = expression.strip().strip("()")
    if " OR " in expression:
        return any(_licence_ok(p) for p in expression.split(" OR "))
    if " AND " in expression:
        return all(_licence_ok(p) for p in expression.split(" AND "))
    return expression in LICENCES or SPDX_SPELLINGS.get(expression.lower()) in LICENCES


def _package_licence(meta: dict[str, Any]) -> str:
    installed = Path(DEPLOYED_APP) / meta["path"]
    declared: list[Any] = [meta.get("license")]
    if (installed / "package.json").is_file():
        package = json.loads((installed / "package.json").read_text())
        legacy = package.get("licenses")
        declared += [package.get("license"), *(legacy if isinstance(legacy, list) else [legacy])]
    for value in declared:
        value = value.get("type") if isinstance(value, dict) else value
        if isinstance(value, str) and value.strip() and not value.strip().upper().startswith("SEE LICEN"):
            return value.strip()
    files = sorted(p for p in installed.iterdir() if p.is_file() and p.name.lower().startswith(("licen", "copying"))) \
        if installed.is_dir() else []
    for file in files:
        words = " ".join(file.read_text(errors="ignore").split()).lower()
        for phrases, name in LICENCE_WORDING:
            if all(p.lower() in words for p in phrases):
                return name
    return ""


def _walk() -> Iterator[Path]:
    for root, dirs, files in os.walk(APP_DIR):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        for name in files:
            yield Path(root) / name


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in _lock_packages() if name not in notices]
    assert not missing, missing[:20]
    for asset in ("Instrument Serif", "Hanken Grotesk", "Lucide"):
        assert asset.lower() in notices.lower()


def test_if_licences() -> None:
    found = {name: _package_licence(meta) for name, meta in _lock_packages().items()}
    bad = {name: licence for name, licence in found.items() if not _licence_ok(licence)}
    assert not bad, bad


def test_if_no_other_datastore() -> None:
    assert not [p for p in _walk() if p.suffix in (".sqlite", ".sqlite3", ".db")]
    deps = json.loads((APP_DIR / "package.json").read_text()).get("dependencies", {})
    forbidden = {"sqlite3", "better-sqlite3", "redis", "ioredis", "mongodb", "mongoose", "lowdb", "nedb", "level"}
    assert not forbidden & set(deps)


def test_if_no_compose() -> None:
    patterns = ("compose*.yml", "compose*.yaml", "docker-compose*.yml", "docker-compose*.yaml")
    assert not [p for p in _walk() if any(fnmatch.fnmatch(p.name, pat) for pat in patterns)]


def test_if_lockfile() -> None:
    assert (APP_DIR / "package.json").is_file() and (APP_DIR / "package-lock.json").is_file()


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    avery = Api(app_url, AVERY)
    seen: list[str] = []
    with _app(browser, app_url, "/", avery) as page:
        page.on("request", lambda request: seen.append(request.url))
        for path in ("/", "/work", "/start?step=1", "/office", "/office/members"):
            _go(page, app_url + path)
            page.wait_for_load_state("load")
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_user_readme() -> None:
    readme = (APP_DIR / "USER_README.md").read_text()
    assert not [v for v in ENV_VARS if v not in readme]
