from __future__ import annotations

import json
import os
import re
import secrets
import struct
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    AXE,
    S3,
    Postgres,
    addresses,
    advance,
    check,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    settle,
    shipped_packages,
    text,
    until,
)


PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}
TARGET_PX = 44
FOLD_TOLERANCE_PX = 1
STRIP_MAX_DAY = 14
JSON_LIMIT_BYTES = 100_000
FILE_LIMIT_BYTES = 5_000_000
PROVIDER_ANSWER_S = 6
STATUS_CACHE_S = 10
KESTREL_DAY_RATE_CENTS = 65_000
KESTREL_DEPOSIT_CENTS = 250_000
KESTREL_REPLACEMENT_CENTS = 8_350_000
MONEY_MAX_CENTS = 100_000_000

HTTP_TIMEOUT_S = 30
WAIT_S = 60
POLL_S = 0.25
UI_MS = 15_000
COUNTDOWN_SLACK_S = 120
MOVING_ANIMATIONS = """document.getAnimations().filter(a => a.playState === 'running'
  && !/color|shadow|opacity/i.test(a.transitionProperty || '')).length"""
UNKNOWN_REF = "NB-0"
FAR_FUTURE = date(2031, 1, 1)
FAR_SPAN_DAYS = 2_500_000
FUTURE_CARD_DAYS = 3650
WRONG_DEVICE_TIME = datetime(2099, 1, 1, tzinfo=timezone.utc)
SHORT_RATE_BUMP_CENTS = 10_000

OWNER_PASSCODE = "northbar-owner-4417"
PREP_PASSCODE = "northbar-prep-2093"

KITS = {
    "kestrel-lf": "Kestrel LF Camera Package",
    "wren-s35": "Wren S35 Documentary Kit",
    "lantern-led": "Lantern 4-Light LED Package",
}
CATEGORIES = {"kestrel-lf": "Camera", "wren-s35": "Camera", "lantern-led": "Lighting"}
SEED_SERIALS = [
    "KLF-001", "KLF-002", "HPS-01", "HPS-02", "HPS-03", "FMP-01", "FMP-02", "FMP-03",
    "WS35-01", "TZ-01", "TZ-02", "LP-01", "LP-02", "SG-01", "SG-02", "SG-03",
]
CHECKS = ["Powers on", "Accessories present", "Cosmetic condition as listed"]
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"

expect.set_options(timeout=UI_MS)

SQLITE = "SQLite".lower()
KLF_BODY = "Kestrel LF body"
WREN_BODY = "Wren S35 body"
HALDEN = "Halden Prime Set"


def units_table(page: Page, class_name: str) -> Locator:
    return page.get_by_role("table", name=f"{class_name} units")


def fri(n: int) -> str:
    return f"{n} Fri"


def plus(day: str, n: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


def wait_for_count(page: Page, locator: Locator, count: int) -> None:
    for _ in range(200):
        if locator.count() == count:
            return
        advance(page, 48)
    expect(locator).to_have_count(count)


def declared_licence(package: Any) -> str:
    found = re.match(r"SEE LICENSE IN (\S+)", package.licence or "", re.I)
    if not found:
        return package.licence
    text_ = (Path("/app/node_modules") / package.name / found.group(1)).read_text(errors="ignore")
    named = {"MIT License": "MIT", "Apache License": "Apache-2.0", "ISC License": "ISC"}
    return next((spdx for title, spdx in named.items() if title in text_), package.licence)


def raw_json(body: bytes) -> dict:
    return {"content": body, "headers": {"Content-Type": "application/json"}}


def multipart_pdf(data: bytes, boundary: bytes) -> dict:
    head = b"--" + boundary + b'\r\nContent-Disposition: form-data; name="file"; filename="cover.pdf"\r\nContent-Type: application/pdf\r\n\r\n'
    return {"content": head + data + b"\r\n--" + boundary + b"--\r\n",
            "headers": {"Content-Type": "multipart/form-data; boundary=" + boundary.decode()}}


def contrast_audit(page: Page) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate(
        """() => {
          const result={done:false,error:null,violations:[]};
          window.__CONTRAST_RESULT__=()=>structuredClone(result);
          axe.run(document,{runOnly:['color-contrast']}).then(value=>{
            result.violations=value.violations.map(v=>v.nodes.map(n=>n.target));result.done=true;
          },error=>{result.error=String(error);result.done=true});
        }"""
    )
    for _ in range(625):
        status = page.evaluate("window.__CONTRAST_RESULT__()")
        if status["done"]:
            assert status["error"] is None, status["error"]
            assert not status["violations"], f"contrast violations: {status['violations']}"
            return
        advance(page, 16)
    raise AssertionError("contrast audit did not settle under controlled time")


def window(days: int, weekday: int | None = None) -> tuple[str, str]:
    start = FAR_FUTURE + timedelta(days=secrets.randbelow(FAR_SPAN_DAYS))
    if weekday is not None:
        start += timedelta(days=(weekday - start.weekday()) % 7)
    return start.isoformat(), (start + timedelta(days=days)).isoformat()


def person(prefix: str = "renter") -> tuple[str, str]:
    tag = uuid.uuid4().hex[:12]
    return f"Renter {tag}", f"{prefix}-{tag}@example.test"


def ikey() -> str:
    return uuid.uuid4().hex


def dollars(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def plain_dollars(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def billable_label(n: int) -> str:
    return "1 billable day" if n == 1 else f"{n} billable days"


def hire_total(cents: int, n: int) -> str:
    return f"Hire total {dollars(cents)} for {billable_label(n)}"


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def server_today(booking: dict) -> date:
    expires = instant(booking["holdExpiresAt"])
    return (expires - timedelta(seconds=booking["holdSecondsRemaining"])).date()


def pdf(tag: str, size: int | None = None) -> bytes:
    body = b"%PDF-1.4\n% Tallyslate verifier " + tag.encode() + b"\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    if size is not None:
        body = body + b"%" * (size - len(body))
    return body


def png(tag: str) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\x80\x20\x20" * 2 for _ in range(2))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
        + chunk(b"tEXt", b"Comment\x00" + tag.encode())
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def poll(probe: Callable[[], Any], what: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
        threading.Event().wait(POLL_S)
    pytest.fail(f"{what} (gave up after {seconds}s)")


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=HTTP_TIMEOUT_S)
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def api(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)


def staff(base: str, passcode: str = OWNER_PASSCODE) -> httpx.Client:
    client = api(base)
    r = client.post("/api/session", json={"passcode": passcode})
    assert r.status_code == 200, f"POST /api/session refused a seeded passcode: {r.status_code} {r.text[:300]}"
    return client


def renter(key: str) -> dict[str, str]:
    return {"X-Renter-Key": key}


def error(r: httpx.Response, status: int, code: str | None = None, message: str | None = None) -> dict:
    assert r.status_code == status, (
        f"{r.request.method} {r.request.url.path} answered {r.status_code} {r.text[:400]}; expected {status} {code}"
    )
    body = r.json()
    assert set(body) == {"error"}, f"error body must be {{'error': ...}}, got {body}"
    err = body["error"]
    assert isinstance(err.get("code"), str) and isinstance(err.get("message"), str), err
    if code is not None:
        assert err["code"] == code, err
    if message is not None:
        assert err["message"] == message, err
    return err


def field(r: httpx.Response, name: str, message: str | None = None) -> None:
    err = error(r, 422, "validation")
    assert name in err.get("fields", {}), f"expected fields.{name}, got {err}"
    if message is not None:
        assert err["fields"][name] == message, err


def get_kits(base: str, pickup: str | None = None, ret: str | None = None) -> list[dict]:
    params = {"pickupDate": pickup, "returnDate": ret} if pickup else {}
    r = httpx.get(base + "/api/kits", params=params, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    return r.json()["kits"]


def get_kit(base: str, kit: str, pickup: str | None = None, ret: str | None = None) -> dict:
    params = {"pickupDate": pickup, "returnDate": ret} if pickup else {}
    r = httpx.get(f"{base}/api/kits/{kit}", params=params, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    return r.json()


def free_serials(kit: dict, class_id: str) -> list[str]:
    return sorted(u["serial"] for u in kit["units"] if u["classId"] == class_id and u["status"] == "free")


def price(base: str, kit: str, pickup: str, ret: str) -> dict:
    r = httpx.get(base + "/api/price", params={"kitId": kit, "pickupDate": pickup, "returnDate": ret}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    return r.json()


def hold(base: str, kit: str, pickup: str, ret: str, units: dict | None = None,
         who: tuple[str, str] | None = None, key: str | None = None) -> httpx.Response:
    name, email = who or person()
    body: dict[str, Any] = {"kitId": kit, "pickupDate": pickup, "returnDate": ret, "renter": {"name": name, "email": email}}
    if units:
        body["units"] = units
    return httpx.post(base + "/api/bookings", json=body, headers={"Idempotency-Key": key or ikey()}, timeout=HTTP_TIMEOUT_S)


def held_booking(base: str, kit: str, pickup: str, ret: str, units: dict | None = None,
                 who: tuple[str, str] | None = None) -> dict:
    name, email = who or person()
    r = hold(base, kit, pickup, ret, units, (name, email))
    assert r.status_code == 201, f"POST /api/bookings refused a fresh hold: {r.status_code} {r.text[:400]}"
    body = r.json()
    return {"ref": body["booking"]["ref"], "key": body["renterKey"], "name": name, "email": email,
            "booking": body["booking"], "base": base}


def serials(booking: dict) -> list[str]:
    return [u["serial"] for u in booking["units"]]


def read(b: dict, base: str | None = None) -> dict:
    r = httpx.get(f"{base or b['base']}/api/bookings/{b['ref']}", headers=renter(b["key"]), timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    return r.json()


def upload_cert(base: str, b: dict, data: bytes, name: str = "certificate.pdf", ctype: str = "application/pdf") -> httpx.Response:
    return httpx.post(f"{base}/api/bookings/{b['ref']}/certificate", headers=renter(b["key"]),
                      files={"file": (name, data, ctype)}, timeout=HTTP_TIMEOUT_S)


def approve(owner: httpx.Client, cert_id: str, start: str, end: str, limit: int) -> httpx.Response:
    return owner.post(f"/api/certificates/{cert_id}/review", json={
        "decision": "approve", "coverageStart": start, "coverageEnd": end, "limitCents": limit, "lossPayeeNamed": True})


def certify(base: str, owner: httpx.Client, b: dict, start: str | None = None, end: str | None = None,
            limit: int | None = None) -> dict:
    r = upload_cert(base, b, pdf(b["ref"]))
    assert r.status_code == 201, r.text
    bk = r.json()
    r = approve(owner, bk["certificate"]["id"], start or bk["pickupDate"], end or bk["returnDate"],
                limit if limit is not None else bk["replacementValueCents"])
    assert r.status_code == 200, r.text
    b["booking"] = r.json()
    return b


def ready(base: str, owner: httpx.Client, kit: str, pickup: str, ret: str, units: dict | None = None,
          who: tuple[str, str] | None = None) -> dict:
    return certify(base, owner, held_booking(base, kit, pickup, ret, units, who))


def confirm(base: str, b: dict, key: str | None = None) -> httpx.Response:
    return httpx.post(f"{base}/api/bookings/{b['ref']}/confirm", json={},
                      headers={**renter(b["key"]), "Idempotency-Key": key or ikey()}, timeout=HTTP_TIMEOUT_S)


def confirmed(base: str, owner: httpx.Client, kit: str, pickup: str, ret: str, units: dict | None = None,
              who: tuple[str, str] | None = None) -> dict:
    b = ready(base, owner, kit, pickup, ret, units, who)
    r = confirm(base, b)
    assert r.status_code == 200, f"confirm of a ready quote failed: {r.status_code} {r.text[:400]}"
    b["booking"] = r.json()
    return b


def prep(client: httpx.Client, ref: str) -> httpx.Response:
    return client.post(f"/api/bookings/{ref}/prep", json={})


def prepped(base: str, owner: httpx.Client, kit: str, pickup: str, ret: str) -> dict:
    b = confirmed(base, owner, kit, pickup, ret)
    r = prep(owner, b["ref"])
    assert r.status_code == 200, f"prep of a confirmed booking failed: {r.status_code} {r.text[:400]}"
    b["booking"] = r.json()
    return b


def photo(client: httpx.Client, ref: str, phase: str, serial: str, data: bytes | None = None,
          name: str = "unit.png", ctype: str = "image/png") -> httpx.Response:
    return client.post(f"/api/bookings/{ref}/photos", data={"phase": phase, "serial": serial},
                       files={"file": (name, data if data is not None else png(f"{ref}-{phase}-{serial}"), ctype)})


def checkout_body(units: list[str]) -> dict:
    return {"units": [{"serial": s, "checklist": {"powersOn": True, "accessoriesPresent": True, "cosmeticOk": True},
                       "notes": "Clean"} for s in units]}


def out_booking(base: str, owner: httpx.Client, kit: str = "lantern-led") -> dict:
    b = prepped(base, owner, kit, *window(3))
    for s in serials(b["booking"]):
        r = photo(owner, b["ref"], "checkout", s)
        assert r.status_code == 201, r.text
    r = owner.post(f"/api/bookings/{b['ref']}/checkout", json=checkout_body(serials(b["booking"])))
    assert r.status_code == 200, f"checkout of a ready booking failed: {r.status_code} {r.text[:400]}"
    b["booking"] = r.json()
    return b


def checkin(client: httpx.Client, ref: str, serial: str, condition: str = "ok", charge: int = 0) -> httpx.Response:
    return client.post(f"/api/bookings/{ref}/checkin",
                       json={"serial": serial, "condition": condition, "damageChargeCents": charge, "notes": "Back"})


def close(client: httpx.Client, ref: str, key: str | None = None) -> httpx.Response:
    return client.post(f"/api/bookings/{ref}/close", json={}, headers={"Idempotency-Key": key or ikey()})


def history(client: httpx.Client, serial: str) -> dict:
    r = client.get(f"/api/units/{serial}/history")
    assert r.status_code == 200, r.text
    return r.json()


def move(client: httpx.Client, serial: str, to: str) -> httpx.Response:
    return client.post(f"/api/units/{serial}/moves", json={"to": to})


def restore(client: httpx.Client, serial: str) -> None:
    if history(client, serial)["location"] == "repair":
        move(client, serial, "shelf")


def wind_up(base: str, ref: str) -> None:
    try:
        owner = staff(base)
        bk = owner.get(f"/api/bookings/{ref}").json()
        if bk["state"] == "out":
            for u in bk["units"]:
                if not u["checkedIn"]:
                    checkin(owner, ref, u["serial"])
            bk = owner.get(f"/api/bookings/{ref}").json()
        if bk["state"] == "returned":
            for u in bk["units"]:
                photo(owner, ref, "checkin", u["serial"])
            close(owner, ref)
        for u in bk["units"]:
            restore(owner, u["serial"])
    except Exception:
        pass


def paired(movement: dict) -> None:
    entries = sorted((e["location"], e["delta"]) for e in movement["entries"])
    assert entries == sorted([(movement["from"], -1), (movement["to"], 1)]), movement


def ledger_balanced(h: dict) -> None:
    for m in h["movements"]:
        paired(m)
    assert h["balances"] == {"acquired": -1, h["location"]: 1}, h["balances"]
    assert h["location"] != "acquired"


def mails(mail: Any, email: str, subject: str) -> list[dict]:
    return [m for m in mail.messages(settle=1.5)
            if email.lower() in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject]


def await_mail(mail: Any, email: str, subject: str) -> list[dict]:
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        found = mails(mail, email, subject)
        if found:
            return found
    pytest.fail(f"Mailpit received no mail {subject!r} to {email}; expected the app to send it")


def lines(message: dict) -> list[str]:
    return [line.strip() for line in text(message).splitlines()]


def transactions(killbill: Any, ref: str) -> list[dict]:
    payment = killbill.payment_by_key(ref)
    return [] if payment is None else list(payment.get("transactions", []))


def cents(amount: Any) -> int:
    return round(float(amount) * 100)


def tx(killbill: Any, ref: str, kind: str) -> list[dict]:
    return [t for t in transactions(killbill, ref) if t.get("transactionType") == kind and t.get("status") == "SUCCESS"]


@contextmanager
def ui(browser: Browser, base: str, path: str, size: dict = DESKTOP, reduced: bool = False, live: bool = True,
       device_time: datetime | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/api/health", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(size)
        if device_time is not None:
            page.clock.set_system_time(device_time)
        page.goto(base + path)
        if live:
            page.clock.resume()
        yield page


def desk_sign_in(page: Page, base: str, passcode: str, landing: str) -> None:
    page.goto(base + "/desk")
    page.get_by_role("textbox", name="Passcode").fill(passcode)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(re.compile(re.escape(landing)))


def open_counter_booking(page: Page, ref: str, kit: str) -> Locator:
    page.get_by_role("list", name="Bookings").get_by_role("button", name=f"{ref} · {KITS[kit]}", exact=True).click()
    detail = page.get_by_role("region", name="Booking detail")
    expect(detail).to_contain_text(ref)
    return detail


def strip_texts(strip: Locator) -> list[str]:
    return [" ".join(t.split()) for t in strip.get_by_role("listitem").all_inner_texts() if t.strip()]


def strip_expected(days: list[dict]) -> list[Any]:
    if days and all(d["kind"] == "weekend" for d in days):
        return ["weekend · 1 day"]
    cells: list[Any] = []
    for d in days:
        if d["kind"] == "free":
            if not cells or cells[-1] != "free":
                cells.append("free")
        else:
            cells.append(d["day"])
    return cells


def strip_matches(actual: list[str], expected: list[Any]) -> bool:
    if len(actual) != len(expected):
        return False
    for got, want in zip(actual, expected):
        if isinstance(want, int):
            if not re.fullmatch(rf"{want} [A-Z][a-z]{{2}}", got):
                return False
        elif got != want:
            return False
    return True


def cell(strip: Locator, label: str) -> Locator:
    return strip.get_by_role("listitem").filter(has_text=re.compile(rf"^\s*{re.escape(label)}\s*$"))


def box(locator: Locator) -> dict:
    b = locator.bounding_box()
    assert b is not None, "expected the element to be rendered"
    return b


def out_of_view(locator: Locator, size: dict) -> bool:
    if locator.count() == 0 or not locator.first.is_visible():
        return True
    b = locator.first.bounding_box()
    return b is None or b["x"] >= size["width"] or b["x"] + b["width"] <= 0 or b["width"] == 0


def tab_to(page: Page, target: Locator, presses: int = 8, key: str = "Tab") -> None:
    for _ in range(presses):
        page.keyboard.press(key)
        if target.evaluate("e => e === document.activeElement"):
            return
    pytest.fail(f"{key} never reached the expected control within {presses} presses")


def inside(dialog: Locator) -> bool:
    return bool(dialog.evaluate("d => d.contains(document.activeElement)"))


def countdown(page: Page) -> int:
    region = page.get_by_role("region", name="Hold")
    expect(region).to_contain_text(re.compile(r"Hold ends in \d{2,}:\d{2}:\d{2}"))
    h, m, s = re.search(r"Hold ends in (\d{2,}):(\d{2}):(\d{2})", region.inner_text()).groups()
    return int(h) * 3600 + int(m) * 60 + int(s)


@pytest.fixture
def base(app_url: str) -> str:
    return app_url.rstrip("/")


@pytest.fixture
def short_url() -> str:
    return os.environ["APP_SHORT_URL"].rstrip("/")


@pytest.fixture
def payments_down_url() -> str:
    return os.environ["APP_KILLBILL_DOWN_URL"].rstrip("/")


@pytest.fixture
def storage_down_url() -> str:
    return os.environ["APP_MINIO_DOWN_URL"].rstrip("/")


def test_wf_browse_and_price_catalogue(browser: Browser, base: str) -> None:
    pickup, ret = window(7, weekday=0)
    kits = get_kits(base, pickup, ret)
    assert [k["id"] for k in kits] == list(KITS), "kits come in seed order"
    for k in kits:
        assert k["category"] == CATEGORIES[k["id"]]
        assert k["price"]["billableDays"] == 3
        assert k["price"]["hirePriceCents"] == 3 * k["dayRateCents"]
    with ui(browser, base, f"/?pickup={pickup}&return={ret}") as page:
        nav = page.get_by_role("navigation", name="Kit categories")
        expect(nav.get_by_role("link", name="Camera")).to_be_visible()
        expect(nav.get_by_role("link", name="Lighting")).to_be_visible()
        tops = []
        for k in kits:
            sheet = page.get_by_role("article", name=k["name"])
            expect(sheet.get_by_role("heading", level=2, name=k["name"])).to_be_visible()
            expect(sheet).to_contain_text(f"{k['freeForDates']} free for these dates")
            expect(sheet).to_contain_text(billable_label(3))
            expect(sheet).to_contain_text(re.compile(",?".join(str(k["price"]["hirePriceCents"] // 100))))
            expect(sheet.get_by_role("link", name=f"Open {k['name']}")).to_be_visible()
            tops.append(box(sheet)["y"])
        assert tops == sorted(tops), "sheets follow seed order, Camera before Lighting"
        before = kits[0]["freeForDates"]
        held_booking(base, "kestrel-lf", pickup, ret)
        after = get_kits(base, pickup, ret)[0]["freeForDates"]
        assert after == before - 1, "a hold takes one complete kit out of the free count"
        page.reload()
        expect(page.get_by_role("article", name=KITS["kestrel-lf"])).to_contain_text(f"{after} free for these dates")


def test_price_rules(base: str) -> None:
    cases = [
        (4, 3, 1), (4, 2, 1), (4, 1, 1), (4, 4, 3), (0, 1, 1), (0, 7, 3), (0, 10, 6), (0, 14, 6), (3, 3, 3),
    ]
    for weekday, n, billable in cases:
        pickup, ret = window(n, weekday)
        p = price(base, "kestrel-lf", pickup, ret)
        assert p["hireDays"] == n and p["billableDays"] == billable, (weekday, n, p)
        weekend = weekday == 4 and n in (2, 3)
        kinds = ["weekend"] * n if weekend else ["free" if (d - 1) % 7 >= 3 else "billable" for d in range(1, n + 1)]
        assert [d["kind"] for d in p["days"]] == kinds, (weekday, n, p["days"])
        assert [d["day"] for d in p["days"]] == list(range(1, n + 1))
        assert [d["date"] for d in p["days"]] == [plus(pickup, d) for d in range(n)]
        assert p["dayRateCents"] == KESTREL_DAY_RATE_CENTS
        assert p["hirePriceCents"] == billable * KESTREL_DAY_RATE_CENTS
        assert p["depositCents"] == KESTREL_DEPOSIT_CENTS
        assert p["totalCents"] == p["hirePriceCents"] + p["depositCents"]
        assert isinstance(p["rateCardVersion"], int)
    pickup, _ = window(1, 0)
    r = httpx.get(base + "/api/price", params={"kitId": "no-such-kit", "pickupDate": pickup, "returnDate": plus(pickup, 2)})
    error(r, 404, "not_found")
    for ret, msg_field in [(plus(pickup, STRIP_MAX_DAY + 1), "returnDate"), (pickup, "returnDate")]:
        r = httpx.get(base + "/api/price", params={"kitId": "kestrel-lf", "pickupDate": pickup, "returnDate": ret})
        field(r, msg_field, "Return between 1 and 14 days after pickup")
    r = httpx.get(base + "/api/price", params={"kitId": "kestrel-lf", "pickupDate": "2020-01-02", "returnDate": "2020-01-05"})
    field(r, "pickupDate", "Pick a pickup date from today on")
    r = httpx.get(base + "/api/price", params={"kitId": "kestrel-lf", "pickupDate": pickup})
    error(r, 422, "validation")


def test_wf_browse_and_price_week_fold(browser: Browser, base: str) -> None:
    pickup, _ = window(1, weekday=4)
    with ui(browser, base, f"/kits/kestrel-lf?pickup={pickup}&return={plus(pickup, 1)}") as page:
        slider = page.get_by_role("slider", name="Return day")
        strip = page.get_by_role("list", name="Hire days")
        total = page.get_by_role("status", name="Hire total")
        assert (slider.get_attribute("aria-valuemax") or slider.get_attribute("max")) == str(STRIP_MAX_DAY)
        assert (slider.get_attribute("aria-valuemin") or slider.get_attribute("min")) == "1"
        expect(slider).to_have_attribute("aria-valuetext", f"Day 1, return {plus(pickup, 1)}")
        poll(lambda: strip_texts(strip) == ["1 Fri"], "strip shows the single billable Friday cell `1 Fri`")
        slider.focus()
        visited = {}
        for n in range(2, 9):
            page.keyboard.press("ArrowRight")
            ret = plus(pickup, n)
            expect(slider).to_have_attribute("aria-valuetext", f"Day {n}, return {ret}")
            q = price(base, "kestrel-lf", pickup, ret)
            want = strip_expected(q["days"])
            poll(lambda: strip_matches(strip_texts(strip), want), f"day strip for day {n} shows {want}")
            expect(total).to_have_text(hire_total(q["hirePriceCents"], q["billableDays"]))
            expect(page.get_by_text(billable_label(q["billableDays"]), exact=True).first).to_be_visible()
            visited[n] = q
            if n == 7:
                settle(strip)
                band, bill = box(cell(strip, "free")), box(cell(strip, "1 Fri"))
                assert abs(band["width"] - bill["width"]) <= FOLD_TOLERANCE_PX, (band, bill)
        assert visited[2]["billableDays"] == 1 and visited[3]["billableDays"] == 1
        assert strip_texts(strip)[-1] == fri(8)
        assert re.search(rf"return={plus(pickup, 8)}", page.url) and f"pickup={pickup}" in page.url
        page.keyboard.press("ArrowLeft")
        expect(slider).to_have_attribute("aria-valuetext", f"Day 7, return {plus(pickup, 7)}")
        poll(lambda: strip_matches(strip_texts(strip), strip_expected(visited[7]["days"])), "moving back unfolds day 8")
        expect(total).to_have_text(hire_total(visited[7]["hirePriceCents"], visited[7]["billableDays"]))
        page.keyboard.press("Home")
        expect(slider).to_have_attribute("aria-valuetext", f"Day 1, return {plus(pickup, 1)}")
        page.keyboard.press("PageUp")
        expect(slider).to_have_attribute("aria-valuetext", f"Day 8, return {plus(pickup, 8)}")
        page.keyboard.press("End")
        expect(slider).to_have_attribute("aria-valuetext", f"Day 14, return {plus(pickup, 14)}")
        page.keyboard.press("PageDown")
        expect(slider).to_have_attribute("aria-valuetext", f"Day 7, return {plus(pickup, 7)}")
        page.reload()
        expect(page.get_by_role("slider", name="Return day")).to_have_attribute("aria-valuetext", f"Day 7, return {plus(pickup, 7)}")


def test_wf_browse_and_price_empty(browser: Browser, base: str) -> None:
    with ui(browser, base, "/") as page:
        expect(page.get_by_role("heading", name="Pick your shoot dates")).to_be_visible()
        expect(page.get_by_text("Set a pickup day and drag the return handle to see what's free and what it costs.", exact=True)).to_be_visible()
        expect(page.get_by_text("free for these dates")).to_have_count(0)
    pickup, ret = window(3, weekday=1)
    for _ in range(10):
        pending = [k for k in get_kits(base, pickup, ret) if k["freeForDates"] > 0]
        if not pending:
            break
        for k in pending:
            held_booking(base, k["id"], pickup, ret)
    else:
        pytest.fail("holding every free kit never brought freeForDates to 0")
    with ui(browser, base, f"/?pickup={pickup}&return={ret}") as page:
        expect(page.get_by_role("heading", name="Nothing free for these dates")).to_be_visible()
        expect(page.get_by_text("Every kit is out or held on at least one of these days. Move the return handle or try another pickup day.", exact=True)).to_be_visible()
        expect(page.get_by_role("heading", name="Pick your shoot dates")).to_have_count(0)


def test_renter_layouts(browser: Browser, base: str) -> None:
    pickup, ret = window(10, weekday=4)
    for label, size in VIEWPORTS.items():
        with ui(browser, base, f"/?pickup={pickup}&return={ret}", size=size) as page:
            nav = page.get_by_role("navigation", name="Kit categories")
            pick = page.get_by_role("textbox", name="Pickup date")
            slider = page.get_by_role("slider", name="Return day")
            strip = page.get_by_role("list", name="Hire days")
            sheets = [page.get_by_role("article", name=n) for n in KITS.values()]
            expect(sheets[0]).to_contain_text("free for these dates")
            poll(lambda: cell(strip, fri(8)).count() == 1, "strip renders day 8 for a 10-day Friday hire")
            layout(page)
            assert box(pick)["y"] < box(slider)["y"] < box(sheets[0])["y"], label
            boxes = [box(s) for s in sheets]
            for upper, lower in zip(boxes, boxes[1:]):
                assert lower["y"] >= upper["y"] + upper["height"] - 1, f"{label}: sheets form one column"
                assert abs(lower["x"] - upper["x"]) <= 1, f"{label}: sheets form one column"
            one, eight = box(cell(strip, fri(1))), box(cell(strip, fri(8)))
            if label == "desktop":
                assert box(nav)["x"] + box(nav)["width"] <= boxes[0]["x"] + 1, "desktop rail sits left of the sheets"
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                rail = box(nav)
                assert rail["y"] >= -1 and rail["y"] < size["height"], "desktop rail stays in view while sheets scroll"
            else:
                assert box(nav)["y"] + box(nav)["height"] <= box(pick)["y"] + 1, f"{label}: category links sit above the date controls"
            if label == "phone":
                assert eight["y"] >= one["y"] + one["height"] - 1, "phone strip puts week two below week one"
                head = box(sheets[0].get_by_role("heading", level=2))
                free = box(sheets[0].get_by_text(re.compile(r"\d+ free for these dates")))
                assert head["y"] + head["height"] <= free["y"] + 1, "phone band stacks name above free count"
            else:
                assert eight["y"] < one["y"] + one["height"] / 2, f"{label}: strip is one row"
        with ui(browser, base, f"/kits/wren-s35?pickup={pickup}&return={ret}", size=size) as page:
            heading = page.get_by_role("heading", level=1, name=KITS["wren-s35"])
            slider = page.get_by_role("slider", name="Return day")
            table = units_table(page, WREN_BODY)
            name = page.get_by_role("textbox", name="Your name")
            hold_button = page.get_by_role("button", name="Hold this kit")
            expect(table).to_be_visible()
            layout(page)
            ys = [box(x)["y"] for x in (heading, slider, table, name, hold_button)]
            assert ys == sorted(ys), f"{label}: kit sheet order is band, strip, unit tables, hold form"
            if label == "desktop":
                nav = page.get_by_role("navigation", name="Kit categories")
                assert box(nav)["x"] + box(nav)["width"] <= box(heading)["x"] + 1, "desktop kit sheet keeps the rail left"


def test_wf_hold_a_kit_happy(browser: Browser, base: str) -> None:
    pickup, ret = window(3, weekday=1)
    kit = get_kit(base, "kestrel-lf", pickup, ret)
    chosen = free_serials(kit, "halden-primes")[-1]
    name, email = person()
    with ui(browser, base, "/kits/kestrel-lf") as page:
        hold_button = page.get_by_role("button", name="Hold this kit")
        expect(hold_button).to_be_disabled()
        page.get_by_role("textbox", name="Pickup date").fill(pickup)
        slider = page.get_by_role("slider", name="Return day")
        slider.focus()
        page.keyboard.press("Home")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        expect(slider).to_have_attribute("aria-valuetext", f"Day 3, return {ret}")
        table = units_table(page, HALDEN)
        expect(page.get_by_role("radio", name=f"Any free {HALDEN}")).to_be_checked()
        check(table.get_by_role("radio", name=chosen, exact=True))
        page.get_by_role("textbox", name="Your name").fill(name)
        page.get_by_role("textbox", name="Email").fill(email)
        with held(page, "**/api/bookings") as gate:
            page.get_by_role("button", name="Hold this kit").click()
            expect(page.get_by_role("button", name="Holding your units")).to_be_visible()
            gate.release()
        page.wait_for_url(re.compile(r"/bookings/NB-\d+\?key="))
        ref = re.search(r"/bookings/(NB-\d+)", page.url).group(1)
        key = re.search(r"[?&]key=([^&]+)", page.url).group(1)
        expect(page.get_by_role("heading", level=1, name=f"{ref} · {KITS['kestrel-lf']}")).to_be_visible()
        expect(page.get_by_role("heading", name="Held for you")).to_be_visible()
        expect(page.get_by_text(f"Booking {ref} is on hold. Upload your certificate and confirm before the hold ends.", exact=True).first).to_be_visible()
        countdown(page)
        expect(page.get_by_text("Deposit: Not taken")).to_be_visible()
        bk = read({"ref": ref, "key": key, "base": base})
        expect(page.get_by_text(re.compile(rf"Rate card v{bk['rateCardVersion']}\b"))).to_be_visible()
    assert bk["state"] == "quote" and bk["paymentStatus"] == "none"
    assert bk["renter"] == {"name": name, "email": email}
    assert (bk["pickupDate"], bk["returnDate"]) == (pickup, ret)
    assert chosen in serials(bk)
    with ui(browser, base, f"/kits/kestrel-lf?pickup={pickup}&return={ret}") as page:
        table = units_table(page, HALDEN)
        expect(table.get_by_role("row").filter(has_text=chosen)).to_contain_text("Booked")
        expect(table.get_by_role("radio", name=chosen, exact=True)).to_be_disabled()
    who = person()
    field(hold(base, "kestrel-lf", pickup, ret, who=(who[0], "not-an-email")), "renter.email", "Enter a valid email")
    field(hold(base, "kestrel-lf", pickup, ret, who=("   ", who[1])), "renter.name", "Enter your name")
    field(hold(base, "kestrel-lf", pickup, ret, units={"halden-primes": "TZ-01"}, who=who), "units", "Pick a unit that belongs to this kit")
    error(hold(base, "no-such-kit", pickup, ret, who=who), 404, "not_found")


def test_no_double_booked_serials(base: str) -> None:
    owner = staff(base)
    pickup, ret = window(4)
    bodies = free_serials(get_kit(base, "kestrel-lf", pickup, ret), "kestrel-lf-body")
    body = bodies[0]
    a = held_booking(base, "kestrel-lf", pickup, ret, units={"kestrel-lf-body": body})
    assert body in serials(a["booking"])
    overlap = (ret, plus(ret, 2))
    expected_next = (free_serials(get_kit(base, "kestrel-lf", *overlap), "kestrel-lf-body") or [None])[0]
    who = person()
    err = error(hold(base, "kestrel-lf", *overlap, units={"kestrel-lf-body": body}, who=who), 409, "unit_taken", "This unit was just booked")
    assert err["serial"] == body and err["nextFreeSerial"] == expected_next
    listed = owner.get("/api/bookings").json()["bookings"]
    assert not [b for b in listed if b["renter"]["email"] == who[1]], "a refused hold creates no booking"
    later = held_booking(base, "kestrel-lf", plus(ret, 1), plus(ret, 3), units={"kestrel-lf-body": body})
    assert body in serials(later["booking"])
    units = {u["serial"]: u["status"] for u in get_kit(base, "kestrel-lf", pickup, ret)["units"]}
    assert units[body] == "booked"
    other = held_booking(base, "kestrel-lf", pickup, ret)
    other_body = [s for s in serials(other["booking"]) if s.startswith("KLF")][0]
    assert other_body != body
    err = error(owner.post(f"/api/bookings/{other['ref']}/swap", json={"from": other_body, "to": body}), 409, "unit_taken")
    assert err["serial"] == body
    assert other_body in serials(read(other))


def test_wf_hold_a_kit_last_unit_race(base: str) -> None:
    owner = staff(base)
    pickup, ret = window(3)
    people = [person() for _ in range(5)]
    results = together([lambda w=w: hold(base, "wren-s35", pickup, ret, who=w) for w in people])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409, 409], [r.text for r in results]
    for r in results:
        if r.status_code == 409:
            err = error(r, 409, "unit_taken", "This unit was just booked")
            assert err["serial"] is None and err["nextFreeSerial"] is None
    emails = {w[1] for w in people}
    created = [b for b in owner.get("/api/bookings").json()["bookings"] if b["renter"]["email"] in emails]
    assert len(created) == 1
    pickup, ret = window(3)
    bodies = free_serials(get_kit(base, "kestrel-lf", pickup, ret), "kestrel-lf-body")
    target, nxt = bodies[0], (bodies[1] if len(bodies) > 1 else None)
    results = together([lambda: hold(base, "kestrel-lf", pickup, ret, units={"kestrel-lf-body": target}) for _ in range(4)])
    winners = [r for r in results if r.status_code == 201]
    assert len(winners) == 1, [r.text for r in results]
    assert target in serials(winners[0].json()["booking"])
    for r in results:
        if r.status_code != 201:
            err = error(r, 409, "unit_taken")
            assert err["serial"] == target and err["nextFreeSerial"] == nxt


def test_wf_hold_a_kit_unit_taken(browser: Browser, base: str) -> None:
    pickup, ret = window(3)
    bodies = free_serials(get_kit(base, "kestrel-lf", pickup, ret), "kestrel-lf-body")
    taken, nxt = bodies[0], bodies[1]
    name, email = person()
    with ui(browser, base, f"/kits/kestrel-lf?pickup={pickup}&return={ret}") as page:
        table = units_table(page, KLF_BODY)
        expect(table.get_by_role("radio", name=taken, exact=True)).to_be_enabled()
        held_booking(base, "kestrel-lf", pickup, ret, units={"kestrel-lf-body": taken})
        check(table.get_by_role("radio", name=taken, exact=True))
        page.get_by_role("textbox", name="Your name").fill(name)
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("button", name="Hold this kit").click()
        alert = page.get_by_role("alert")
        expect(alert.get_by_role("heading", name="This unit was just booked")).to_be_visible()
        expect(alert).to_contain_text(f"{taken} was taken by another booking a moment ago.")
        again = alert.get_by_role("button", name=f"Book {nxt} instead")
        expect(again).to_be_focused()
        hold_y = box(page.get_by_role("button", name="Hold this kit"))["y"]
        assert box(alert)["y"] < hold_y, "the notice sits above the hold form"
        again.click()
        page.wait_for_url(re.compile(r"/bookings/NB-\d+\?key="))
        ref = re.search(r"/bookings/(NB-\d+)", page.url).group(1)
        key = re.search(r"[?&]key=([^&]+)", page.url).group(1)
    bk = read({"ref": ref, "key": key, "base": base})
    assert nxt in serials(bk) and bk["renter"]["email"] == email
    pickup, ret = window(3)
    with ui(browser, base, f"/kits/wren-s35?pickup={pickup}&return={ret}") as page:
        expect(units_table(page, WREN_BODY)).to_contain_text("Free")
        held_booking(base, "wren-s35", pickup, ret)
        page.get_by_role("textbox", name="Your name").fill(name)
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("button", name="Hold this kit").click()
        alert = page.get_by_role("alert")
        expect(alert.get_by_role("heading", name="This unit was just booked")).to_be_visible()
        expect(alert).to_contain_text("The last free unit was taken by another booking a moment ago.")
        choose = alert.get_by_role("button", name="Choose new dates")
        expect(choose).to_be_focused()
        choose.click()
        expect(page.get_by_role("slider", name="Return day")).to_be_focused()
        assert "/bookings/" not in page.url


def test_hold_idempotency(base: str) -> None:
    owner = staff(base)
    pickup, ret = window(3)
    name, email = person()
    body = {"kitId": "lantern-led", "pickupDate": pickup, "returnDate": ret, "renter": {"name": name, "email": email}}
    key = ikey()
    first = httpx.post(base + "/api/bookings", json=body, headers={"Idempotency-Key": key})
    second = httpx.post(base + "/api/bookings", json=body, headers={"Idempotency-Key": key})
    assert first.status_code == 201 and second.status_code == 201, (first.text, second.text)
    assert second.content == first.content
    mine = [b for b in owner.get("/api/bookings").json()["bookings"] if b["renter"]["email"] == email]
    assert len(mine) == 1
    changed = {**body, "returnDate": plus(ret, 1)}
    r = httpx.post(base + "/api/bookings", json=changed, headers={"Idempotency-Key": key})
    error(r, 422, "idempotency_key_reused", "Idempotency-Key was used for a different request")
    r = httpx.post(base + "/api/bookings", json=body)
    field(r, "idempotencyKey", "Send an Idempotency-Key header")
    mine = [b for b in owner.get("/api/bookings").json()["bookings"] if b["renter"]["email"] == email]
    assert len(mine) == 1, "neither rejection created a booking"


def test_wf_certificates_upload(browser: Browser, base: str) -> None:
    owner = staff(base)
    b = held_booking(base, "lantern-led", *window(3))
    data = pdf(f"upload-{b['ref']}-{uuid.uuid4().hex}")
    with ui(browser, base, f"/bookings/{b['ref']}?key={b['key']}") as page:
        expect(page.get_by_text("No certificate yet")).to_be_visible()
        page.get_by_label("Certificate of insurance (PDF)").set_input_files({"name": "cover.pdf", "mimeType": "application/pdf", "buffer": data})
        page.get_by_role("button", name="Send certificate").click()
        expect(page.get_by_text("Certificate received. The owner will review it before you can confirm.").first).to_be_visible()
        expect(page.get_by_text("Certificate under review").first).to_be_visible()
    cert = read(b)["certificate"]
    assert cert["status"] == "pending_review" and cert["sizeBytes"] == len(data)
    assert cert["coverageStart"] is None and cert["limitCents"] is None and cert["reason"] is None
    key = f"certificates/{b['ref']}/{cert['id']}.pdf"
    assert S3().get(key) == data, "MinIO holds the uploaded bytes exactly"
    r = owner.get(f"/api/certificates/{cert['id']}/file")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and r.content == data
    queue = owner.get("/api/certificates", params={"status": "pending_review"}).json()["certificates"]
    assert [c for c in queue if c["id"] == cert["id"] and c["bookingRef"] == b["ref"]]
    r = upload_cert(base, b, b"GIF89a not a certificate", name="cover.pdf")
    field(r, "file", "Upload the certificate as a PDF")
    assert read(b)["certificate"]["id"] == cert["id"]
    assert S3().keys(f"certificates/{b['ref']}/") == [key], "a refused upload stores nothing"
    prep_tech = staff(base, PREP_PASSCODE)
    error(owner.get("/api/certificates/not-a-certificate/file"), 404, "not_found")
    error(prep_tech.get(f"/api/certificates/{uuid.uuid4()}/file"), 404, "not_found")
    q = held_booking(base, "lantern-led", *window(3))
    boundary = b"CoverBoundary"
    tricky = pdf(q["ref"]) + b"abc--" + boundary + b"tail\n%%EOF\n"
    parts = multipart_pdf(tricky, boundary)
    r = httpx.post(f"{base}/api/bookings/{q['ref']}/certificate", content=parts["content"],
                   headers={**parts["headers"], **renter(q["key"])}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, r.text[:300]
    stored = owner.get(f"/api/certificates/{read(q)['certificate']['id']}/file")
    assert stored.content == tricky, "the certificate is stored byte for byte"


def test_wf_certificates_review(browser: Browser, base: str) -> None:
    b = held_booking(base, "lantern-led", *window(3))
    r = upload_cert(base, b, pdf(b["ref"]))
    assert r.status_code == 201, r.text
    bk = r.json()
    with ui(browser, base, "/desk") as page:
        desk_sign_in(page, base, OWNER_PASSCODE, "/desk/owner")
        page.get_by_role("region", name="Certificates to review").get_by_role("button", name=f"Review {b['ref']}").click()
        dialog = page.get_by_role("dialog", name="Review certificate")
        expect(dialog.get_by_role("link", name="Open certificate PDF")).to_be_visible()
        assert inside(dialog), "opening the dialog moves focus into it"
        dialog.get_by_role("textbox", name="Cover starts").fill(bk["pickupDate"])
        dialog.get_by_role("textbox", name="Cover ends").fill(bk["returnDate"])
        dialog.get_by_role("textbox", name="Limit").fill(plain_dollars(bk["replacementValueCents"]))
        check(dialog.get_by_role("checkbox", name="Names Northbar Camera Hire as loss payee"))
        dialog.get_by_role("button", name="Approve").click()
        expect(page.get_by_role("status", name="Desk status")).to_contain_text(f"Certificate for {b['ref']} approved")
    now = read(b)
    cert = now["certificate"]
    assert cert["status"] == "approved" and cert["reason"] is None
    assert (cert["coverageStart"], cert["coverageEnd"]) == (bk["pickupDate"], bk["returnDate"])
    assert cert["limitCents"] == bk["replacementValueCents"]
    assert now["confirmable"] is True
    with ui(browser, base, f"/bookings/{b['ref']}?key={b['key']}") as page:
        expect(page.get_by_text("Certificate approved")).to_be_visible()
        expect(page.get_by_role("button", name="Confirm and pay")).to_be_enabled()


def test_certificate_reject_mail(browser: Browser, base: str, mail: Any) -> None:
    owner, prep_tech = staff(base), staff(base, PREP_PASSCODE)
    b = held_booking(base, "lantern-led", *window(3))
    bk = upload_cert(base, b, pdf(b["ref"])).json()
    cid, start, end = bk["certificate"]["id"], bk["pickupDate"], bk["returnDate"]
    url = f"/api/certificates/{cid}/review"
    base_body = {"decision": "approve", "coverageStart": start, "coverageEnd": end, "limitCents": bk["replacementValueCents"], "lossPayeeNamed": True}
    field(owner.post(url, json={**base_body, "lossPayeeNamed": False}), "lossPayeeNamed", "The certificate must name Northbar Camera Hire as loss payee")
    field(owner.post(url, json={**base_body, "coverageEnd": plus(start, -1)}), "coverageEnd", "Cover must end on or after it starts")
    field(owner.post(url, json={**base_body, "limitCents": 0}), "limitCents", "Enter a whole number of cents above zero")
    field(owner.post(url, json={**base_body, "limitCents": MONEY_MAX_CENTS + 1}), "limitCents", "Enter a whole number of cents above zero")
    field(owner.post(url, json={"decision": "reject", "reason": ""}), "reason")
    field(owner.post(url, json={"decision": "reject", "reason": "x" * 301}), "reason")
    field(owner.post(url, json={"decision": "maybe"}), "decision")
    error(prep_tech.post(url, json={"decision": "reject", "reason": "No"}), 403, "forbidden")
    error(httpx.post(base + url, json={"decision": "reject", "reason": "No"}, headers=renter(b["key"])), 401, "unauthenticated")
    assert read(b)["certificate"]["status"] == "pending_review"
    assert mails(mail, b["email"], f"Certificate not accepted · {b['ref']}") == []
    reason = f"Loss payee missing {uuid.uuid4().hex[:6]}"
    r = owner.post(url, json={"decision": "reject", "reason": reason})
    assert r.status_code == 200, r.text
    cert = r.json()["certificate"]
    assert cert["status"] == "rejected" and cert["reason"] == reason and r.json()["confirmable"] is False
    sent = await_mail(mail, b["email"], f"Certificate not accepted · {b['ref']}")
    assert f"Reason: {reason}" in lines(sent[0])
    error(owner.post(url, json=base_body), 409, "invalid_transition")
    assert len(mails(mail, b["email"], f"Certificate not accepted · {b['ref']}")) == 1
    with ui(browser, base, f"/bookings/{b['ref']}?key={b['key']}") as page:
        expect(page.get_by_text(f"Certificate not accepted: {reason}").first).to_be_visible()
        expect(page.get_by_role("button", name="Confirm and pay")).to_be_disabled()


def test_wf_confirm_and_pay_happy(browser: Browser, base: str, killbill: Any, mail: Any) -> None:
    owner = staff(base)
    b = ready(base, owner, "lantern-led", *window(3))
    total = b["booking"]["totalCents"]
    not_object = raw_json(b"[]")
    error(httpx.post(f"{base}/api/bookings/{b['ref']}/confirm", **not_object), 401, "unauthenticated")
    error(owner.post(f"/api/bookings/{UNKNOWN_REF}/confirm", **not_object), 404, "not_found")
    with ui(browser, base, f"/bookings/{b['ref']}?key={b['key']}") as page:
        expect(page.get_by_text("Deposit: Not taken")).to_be_visible()
        pay = page.get_by_role("button", name="Confirm and pay")
        expect(pay).to_be_enabled()
        with held(page, "**/api/bookings/*/confirm") as gate:
            pay.click()
            expect(page.get_by_role("button", name="Taking payment")).to_be_disabled()
            expect(page.get_by_text("Deposit: Pending")).to_be_visible()
            assert tx(killbill, b["ref"], "PURCHASE") == []
            gate.release()
        expect(page.get_by_text("Deposit: Paid")).to_be_visible()
        expect(page.get_by_role("heading", name="You're booked")).to_be_visible()
        expect(page.get_by_text(f"Booking {b['ref']} is confirmed. We've emailed your serial list to {b['email']}.", exact=True).first).to_be_visible()
        expect(page.get_by_role("button", name="Cancel booking")).to_be_visible()
    bk = read(b)
    assert bk["state"] == "confirmed" and bk["paymentStatus"] == "paid"
    purchases = tx(killbill, b["ref"], "PURCHASE")
    assert len(purchases) == 1 and cents(purchases[0]["amount"]) == total
    await_mail(mail, b["email"], f"Booking confirmed · {b['ref']} · {KITS['lantern-led']}")


def test_payment_status_from_killbill(base: str, killbill: Any) -> None:
    owner = staff(base)
    tag = uuid.uuid4().hex[:10]
    who = (f"Renter {tag}", f"Renter-{tag}@Example.test")
    b = ready(base, owner, "wren-s35", *window(3), who=who)
    assert read(b)["paymentStatus"] == "none"
    assert killbill.payment_by_key(b["ref"]) is None
    r = confirm(base, b)
    assert r.status_code == 200, r.text
    bk = r.json()
    assert bk["paymentStatus"] == "paid" and bk["state"] == "confirmed"
    account = killbill.account_by_key(who[1].lower())
    assert account is not None, "Kill Bill account keyed by the lower-case email"
    assert account["name"] == who[0] and account["currency"] == "USD"
    assert killbill.default_plugin(account["accountId"]) == "__EXTERNAL_PAYMENT__"
    purchases = tx(killbill, b["ref"], "PURCHASE")
    assert len(purchases) == 1
    assert purchases[0]["transactionExternalKey"] == f"{b['ref']}-confirm"
    assert cents(purchases[0]["amount"]) == bk["totalCents"] == bk["hirePriceCents"] + bk["depositCents"]


def test_all_or_nothing_confirmation(base: str, storage_down_url: str, killbill: Any, mail: Any) -> None:
    owner = staff(base)
    b = held_booking(base, "lantern-led", *window(3))
    bk = upload_cert(base, b, pdf(b["ref"])).json()
    error(confirm(base, b), 409, "certificate_not_approved", "Your certificate must be approved first")
    assert approve(owner, bk["certificate"]["id"], bk["pickupDate"], bk["returnDate"], bk["replacementValueCents"]).status_code == 200
    started = time.monotonic()
    error(confirm(storage_down_url, b), 503, "storage_unavailable", "Storage service unreachable")
    assert time.monotonic() - started < PROVIDER_ANSWER_S
    now = read(b)
    assert now["state"] == "quote" and now["paymentStatus"] == "none"
    assert killbill.payment_by_key(b["ref"]) is None, "no charge stands after a failed confirm"
    subject = f"Booking confirmed · {b['ref']} · {KITS['lantern-led']}"
    assert mails(mail, b["email"], subject) == []
    r = confirm(base, b)
    assert r.status_code == 200, r.text
    assert len(tx(killbill, b["ref"], "PURCHASE")) == 1
    assert len(await_mail(mail, b["email"], subject)) == 1


def test_confirmation_mail(base: str, mail: Any) -> None:
    owner = staff(base)
    pickup, ret = window(7, weekday=0)
    b = ready(base, owner, "kestrel-lf", pickup, ret)
    key = ikey()
    r = confirm(base, b, key)
    assert r.status_code == 200, r.text
    bk = r.json()
    assert bk["billableDays"] == 3 and bk["totalCents"] == 3 * KESTREL_DAY_RATE_CENTS + KESTREL_DEPOSIT_CENTS
    subject = f"Booking confirmed · {b['ref']} · {KITS['kestrel-lf']}"
    message = await_mail(mail, b["email"], subject)[0]
    assert mail_from_address() in addresses(message.get("From"))
    body = lines(message)
    for u in bk["units"]:
        assert f"{u['serial']} · {u['className']}" in body
    for line in [
        f"Pickup {pickup} · Return {ret}", "Billable days: 3", "Day rate: $650.00", "Hire: $1,950.00",
        "Deposit: $2,500.00", f"Charged: {dollars(bk['totalCents'])}", f"Rate card: v{bk['rateCardVersion']}",
    ]:
        assert line in body, f"confirmation mail lacks {line!r}: {body}"
    assert confirm(base, b, key).status_code == 200
    assert len(mails(mail, b["email"], subject)) == 1, "an idempotent replay sends no second mail"


def test_wf_confirm_and_pay_race(base: str, killbill: Any, mail: Any) -> None:
    owner = staff(base)
    a = ready(base, owner, "lantern-led", *window(3))
    key = ikey()
    first = confirm(base, a, key)
    assert first.status_code == 200, first.text
    replay = confirm(base, a, key)
    assert replay.status_code == 200 and replay.content == first.content
    assert len(tx(killbill, a["ref"], "PURCHASE")) == 1
    other = ready(base, owner, "lantern-led", *window(3))
    error(confirm(base, other, key), 422, "idempotency_key_reused", "Idempotency-Key was used for a different request")
    r = httpx.post(f"{base}/api/bookings/{other['ref']}/confirm", json={}, headers=renter(other["key"]))
    field(r, "idempotencyKey", "Send an Idempotency-Key header")
    assert read(other)["state"] == "quote" and killbill.payment_by_key(other["ref"]) is None
    error(confirm(base, a), 409, "invalid_transition", f"Booking {a['ref']} is confirmed")
    c = ready(base, owner, "lantern-led", *window(3))
    results = together([lambda: confirm(base, c) for _ in range(4)])
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409], [r.text for r in results]
    for r in results:
        if r.status_code == 409:
            error(r, 409, "invalid_transition")
    account = killbill.account_by_key(c["email"])
    assert account is not None and len(killbill.payments(account["accountId"])) == 1
    assert len(tx(killbill, c["ref"], "PURCHASE")) == 1
    assert len(await_mail(mail, c["email"], f"Booking confirmed · {c['ref']} · {KITS['lantern-led']}")) == 1


def test_wf_hold_expiry_countdown(browser: Browser, base: str, short_url: str) -> None:
    owner = staff(base)
    b = ready(base, owner, "lantern-led", *window(3))
    with ui(browser, base, f"/bookings/{b['ref']}?key={b['key']}", live=False, device_time=WRONG_DEVICE_TIME) as page:
        shown = countdown(page)
        remaining = read(b)["holdSecondsRemaining"]
        assert abs(shown - remaining) <= COUNTDOWN_SLACK_S, (shown, remaining)
        expect(page.get_by_role("button", name="Confirm and pay")).to_be_enabled()
        expect(page.get_by_role("heading", name="This hold has ended")).to_have_count(0)
        advance(page, 5000)
        later = countdown(page)
        assert shown - COUNTDOWN_SLACK_S <= later < shown, (shown, later)
    s = held_booking(short_url, "lantern-led", *window(3))
    with ui(browser, short_url, f"/bookings/{s['ref']}?key={s['key']}") as page:
        expect(page.get_by_role("heading", name="This hold has ended")).to_be_visible(timeout=WAIT_S * 1000)
        expect(page.get_by_text("The units have been released. Pick dates again to make a new hold.", exact=True).first).to_be_visible()
        expect(page.get_by_role("button", name="Confirm and pay")).to_be_disabled()
    bk = read(s)
    assert bk["state"] == "expired" and bk["holdSecondsRemaining"] is None and bk["confirmable"] is False


def test_wf_hold_expiry_release(short_url: str) -> None:
    pickup, ret = window(3)
    a = held_booking(short_url, "wren-s35", pickup, ret)
    body = [s for s in serials(a["booking"]) if s.startswith("WS35")][0]
    assert get_kits(short_url, pickup, ret)[1]["freeForDates"] == 0
    error(hold(short_url, "wren-s35", pickup, ret), 409, "unit_taken")
    poll(lambda: read(a)["state"] == "expired", "GET /api/bookings/<ref> reported the short quote expired")
    assert read(a)["holdExpiresAt"] is None
    assert get_kits(short_url, pickup, ret)[1]["freeForDates"] == 1, "an expired quote releases its unit"
    status = {u["serial"]: u["status"] for u in get_kit(short_url, "wren-s35", pickup, ret)["units"]}
    assert status[body] == "free"
    err = error(confirm(short_url, a), 409)
    assert err["code"] in {"quote_expired", "invalid_transition"}
    again = held_booking(short_url, "wren-s35", pickup, ret)
    assert body in serials(again["booking"])


def test_wf_rate_cards_publish(browser: Browser, base: str) -> None:
    owner, prep_tech = staff(base), staff(base, PREP_PASSCODE)
    today = server_today(held_booking(base, "lantern-led", *window(1))["booking"])
    cards = owner.get("/api/rate-cards").json()
    active = cards["activeVersion"]
    rates = {r["kitId"]: r for r in [c for c in cards["rateCards"] if c["version"] == active][0]["rates"]}
    newest = max(c["version"] for c in cards["rateCards"])
    effective = (today + timedelta(days=FUTURE_CARD_DAYS)).isoformat()
    with ui(browser, base, "/desk") as page:
        desk_sign_in(page, base, OWNER_PASSCODE, "/desk/owner")
        page.get_by_role("region", name="Rate cards").get_by_role("button", name="Publish rate card").click()
        dialog = page.get_by_role("dialog", name="Publish rate card")
        dialog.get_by_role("textbox", name="Effective date").fill(effective)
        for kit_id, name in KITS.items():
            dialog.get_by_role("textbox", name=f"{name} day rate").fill(plain_dollars(rates[kit_id]["dayRateCents"]))
            dialog.get_by_role("textbox", name=f"{name} deposit").fill(plain_dollars(rates[kit_id]["depositCents"]))
        dialog.get_by_role("button", name="Publish").click()
        expect(page.get_by_role("status", name="Desk status")).to_contain_text(f"Rate card v{newest + 1} published, effective {effective}")
        expect(page.get_by_role("region", name="Rate cards")).to_contain_text(effective)
    after = owner.get("/api/rate-cards").json()
    card = [c for c in after["rateCards"] if c["version"] == newest + 1][0]
    assert card["effectiveDate"] == effective and after["activeVersion"] == active
    assert {r["kitId"]: (r["dayRateCents"], r["depositCents"]) for r in card["rates"]} == {
        k: (v["dayRateCents"], v["depositCents"]) for k, v in rates.items()}
    assert [c["version"] for c in after["rateCards"]] == sorted(c["version"] for c in after["rateCards"])
    good = [{"kitId": k, "dayRateCents": v["dayRateCents"], "depositCents": v["depositCents"]} for k, v in rates.items()]
    field(owner.post("/api/rate-cards", json={"effectiveDate": (today - timedelta(days=1)).isoformat(), "rates": good}),
          "effectiveDate", "Effective date must be today or later")
    field(owner.post("/api/rate-cards", json={"effectiveDate": effective, "rates": good[:2]}),
          "rates", "Give a day rate and deposit for every kit")
    error(owner.post("/api/rate-cards", json={"effectiveDate": effective, "rates": [{**good[0], "dayRateCents": 0}, *good[1:]]}), 422, "validation")
    error(prep_tech.post("/api/rate-cards", json={"effectiveDate": effective, "rates": good}), 403, "forbidden")
    error(httpx.post(base + "/api/rate-cards", json={"effectiveDate": effective, "rates": good}), 401, "unauthenticated")
    assert len(owner.get("/api/rate-cards").json()["rateCards"]) == len(after["rateCards"]), "refusals publish nothing"


def test_wf_rate_cards_reprice(browser: Browser, base: str, killbill: Any, mail: Any) -> None:
    owner = staff(base)
    kept = confirmed(base, owner, "lantern-led", *window(3))
    old = kept["booking"]["rateCardVersion"]
    ui_quote = ready(base, owner, "lantern-led", *window(3))
    api_quote = ready(base, owner, "lantern-led", *window(3))
    today = server_today(ui_quote["booking"]).isoformat()
    cards = owner.get("/api/rate-cards").json()
    active = [c for c in cards["rateCards"] if c["version"] == cards["activeVersion"]][0]
    r = owner.post("/api/rate-cards", json={"effectiveDate": today, "rates": [
        {"kitId": x["kitId"], "dayRateCents": x["dayRateCents"], "depositCents": x["depositCents"]} for x in active["rates"]]})
    assert r.status_code == 201, r.text
    new = r.json()["version"]
    assert new > old and owner.get("/api/rate-cards").json()["activeVersion"] == new
    err = error(confirm(base, api_quote), 409, "quote_repriced", "Prices changed")
    assert err["booking"]["ref"] == api_quote["ref"] and err["booking"]["rateCardVersion"] == new
    assert killbill.payment_by_key(api_quote["ref"]) is None
    with ui(browser, base, f"/bookings/{ui_quote['ref']}?key={ui_quote['key']}") as page:
        expect(page.get_by_text(re.compile(rf"Rate card v{old}\b"))).to_be_visible()
        page.get_by_role("button", name="Confirm and pay").click()
        expect(page.get_by_text(f"Prices changed on {today}. Check the new total and confirm again.").first).to_be_visible()
        expect(page.get_by_text(re.compile(rf"Rate card v{new}\b"))).to_be_visible()
        assert read(ui_quote)["state"] == "quote" and killbill.payment_by_key(ui_quote["ref"]) is None
        page.get_by_role("button", name="Confirm and pay").click()
        expect(page.get_by_role("heading", name="You're booked")).to_be_visible()
    bk = read(ui_quote)
    assert bk["rateCardVersion"] == new and bk["state"] == "confirmed"
    assert cents(tx(killbill, ui_quote["ref"], "PURCHASE")[0]["amount"]) == bk["totalCents"]
    message = await_mail(mail, ui_quote["email"], f"Booking confirmed · {ui_quote['ref']} · {KITS['lantern-led']}")[0]
    assert f"Rate card: v{new}" in lines(message)
    still = read(kept)
    assert still["rateCardVersion"] == old and still["totalCents"] == kept["booking"]["totalCents"]
    with ui(browser, base, f"/bookings/{kept['ref']}?key={kept['key']}") as page:
        expect(page.get_by_text(re.compile(rf"Rate card v{old}\b"))).to_be_visible()
        desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
        detail = open_counter_booking(page, kept["ref"], "lantern-led")
        expect(detail.get_by_text(re.compile(rf"Rate card v{old}\b"))).to_be_visible()


def test_active_rate_card_prices_new_quotes(short_url: str) -> None:
    owner = staff(short_url)
    today = server_today(held_booking(short_url, "lantern-led", *window(1))["booking"]).isoformat()
    cards = owner.get("/api/rate-cards").json()
    active = [c for c in cards["rateCards"] if c["version"] == cards["activeVersion"]][0]
    bumped = [{"kitId": x["kitId"], "dayRateCents": x["dayRateCents"] + SHORT_RATE_BUMP_CENTS, "depositCents": x["depositCents"]}
              for x in active["rates"]]
    r = owner.post("/api/rate-cards", json={"effectiveDate": today, "rates": bumped})
    assert r.status_code == 201, r.text
    version = r.json()["version"]
    pickup, ret = window(7, weekday=0)
    q = price(short_url, "kestrel-lf", pickup, ret)
    rate = [x for x in bumped if x["kitId"] == "kestrel-lf"][0]["dayRateCents"]
    assert q["rateCardVersion"] == version and q["dayRateCents"] == rate
    assert q["hirePriceCents"] == 3 * rate
    kit = get_kits(short_url, pickup, ret)[0]
    assert kit["dayRateCents"] == rate and kit["rateCardVersion"] == version


def test_wf_prep_kit_counter(browser: Browser, base: str) -> None:
    owner, prep_tech = staff(base), staff(base, PREP_PASSCODE)
    quote = held_booking(base, "lantern-led", *window(3))
    error(prep(prep_tech, quote["ref"]), 409, "invalid_transition", f"Booking {quote['ref']} is quote")
    broken = raw_json(b"{")
    error(httpx.post(f"{base}/api/bookings/{quote['ref']}/prep", **broken), 401, "unauthenticated")
    error(prep_tech.post(f"/api/bookings/{UNKNOWN_REF}/prep", **broken), 404, "not_found")
    error(prep_tech.post(f"/api/bookings/{quote['ref']}/prep", **broken), 409, "invalid_transition")
    b = confirmed(base, owner, "lantern-led", *window(3))
    missing = serials(b["booking"])[0]
    try:
        r = move(owner, missing, "repair")
        assert r.status_code == 201, r.text
        paired(r.json()["movement"])
        err = error(prep(prep_tech, b["ref"]), 409, "unit_not_on_shelf", f"{missing} not on the shelf")
        assert err["serials"] == [missing]
        assert read(b)["state"] == "confirmed"
    finally:
        restore(owner, missing)
    with ui(browser, base, "/desk") as page:
        desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
        detail = open_counter_booking(page, b["ref"], "lantern-led")
        detail.get_by_role("button", name="Prep kit").click()
        expect(page.get_by_role("status", name="Counter status")).to_contain_text(f"Kit prepped · {b['ref']}")
    assert read(b)["state"] == "prepped"


def test_wf_prep_kit_swap(browser: Browser, base: str) -> None:
    owner, prep_tech = staff(base), staff(base, PREP_PASSCODE)
    pickup, ret = window(3)
    a = held_booking(base, "kestrel-lf", pickup, ret)
    old = [s for s in serials(a["booking"]) if s.startswith("HPS")][0]
    target = [s for s in free_serials(get_kit(base, "kestrel-lf", pickup, ret), "halden-primes") if s != old][0]
    with ui(browser, base, "/desk") as page:
        desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
        detail = open_counter_booking(page, a["ref"], "kestrel-lf")
        detail.get_by_role("button", name=f"Swap {old}").click()
        dialog = page.get_by_role("dialog", name="Swap unit")
        select(dialog.get_by_role("combobox", name="Replacement serial"), target)
        dialog.get_by_role("button", name="Swap").click()
        expect(page.get_by_role("status", name="Counter status")).to_contain_text(f"Swapped {old} for {target}")
    assert target in serials(read(a)) and old not in serials(read(a))
    url = f"/api/bookings/{a['ref']}/swap"
    field(prep_tech.post(url, json={"from": "WS35-01", "to": old}), "from", "WS35-01 is not on this booking")
    field(prep_tech.post(url, json={"from": target, "to": "TZ-01"}), "to", "Pick a unit of the same class")
    b = held_booking(base, "kestrel-lf", pickup, ret, units={"halden-primes": old})
    assert old in serials(b["booking"]), "the swapped-out serial is free again"
    err = error(prep_tech.post(url, json={"from": target, "to": old}), 409, "unit_taken")
    assert err["serial"] == old
    error(httpx.post(base + url, json={"from": target, "to": old}, headers=renter(a["key"])), 401, "unauthenticated")
    pickup2, ret2 = window(3)
    d = held_booking(base, "kestrel-lf", pickup2, ret2)
    e = held_booking(base, "kestrel-lf", pickup2, ret2)
    spare = free_serials(get_kit(base, "kestrel-lf", pickup2, ret2), "halden-primes")[0]
    calls = [lambda x=x: prep_tech.post(f"/api/bookings/{x['ref']}/swap", json={
        "from": [s for s in serials(x["booking"]) if s.startswith("HPS")][0], "to": spare}) for x in (d, e)]
    results = together(calls)
    assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
    for r in results:
        if r.status_code == 409:
            error(r, 409, "unit_taken")
    assert [spare in serials(read(x)) for x in (d, e)].count(True) == 1
    f = prepped(base, owner, "lantern-led", *window(3))
    unit = serials(f["booking"])[0]
    error(prep_tech.post(f"/api/bookings/{f['ref']}/swap", json={"from": unit, "to": unit}), 409, "invalid_transition")


def test_checkout_gate(browser: Browser, base: str) -> None:
    owner = staff(base)
    pickup, ret = window(3)
    b = held_booking(base, "lantern-led", pickup, ret)
    value = b["booking"]["replacementValueCents"]
    certify(base, owner, b, start=plus(pickup, 1), end=ret, limit=value - 1)
    b["booking"] = confirm(base, b).json()
    gate = read(b)["checkout"]
    assert gate["allowed"] is False
    assert [x["code"] for x in gate["blockers"]] == ["not_prepped", "certificate_dates", "certificate_limit"]
    assert [x["message"] for x in gate["blockers"]] == [
        "Kit is not prepped", "Certificate does not cover every hire day", "Certificate limit is below the kit replacement value"]
    body = checkout_body(serials(b["booking"]))
    error(owner.post(f"/api/bookings/{b['ref']}/checkout", json=body), 409, "invalid_transition")
    assert prep(owner, b["ref"]).status_code == 200
    err = error(owner.post(f"/api/bookings/{b['ref']}/checkout", json=body), 409, "checkout_blocked")
    assert [x["code"] for x in err["blockers"]] == ["certificate_dates", "certificate_limit"]
    with ui(browser, base, "/desk", device_time=WRONG_DEVICE_TIME) as page:
        desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
        detail = open_counter_booking(page, b["ref"], "lantern-led")
        expect(detail.get_by_role("button", name="Start checkout")).to_be_disabled()
        blockers = detail.get_by_role("list", name="Checkout blockers")
        expect(blockers).to_contain_text("Certificate does not cover every hire day")
        expect(blockers).to_contain_text("Certificate limit is below the kit replacement value")
        r = upload_cert(base, b, pdf(f"second-{b['ref']}"))
        assert r.status_code == 201, r.text
        latest = read(b)["checkout"]
        codes = [x["code"] for x in latest["blockers"]]
        published = ["not_prepped", "certificate_missing", "certificate_dates", "certificate_limit"]
        assert latest["allowed"] is False and "certificate_missing" in codes, latest
        assert codes == [c for c in published if c in codes], f"blockers out of published order: {codes}"
        page.reload()
        detail = open_counter_booking(page, b["ref"], "lantern-led")
        expect(detail.get_by_role("list", name="Checkout blockers")).to_contain_text("No approved certificate of insurance")
        assert approve(owner, r.json()["certificate"]["id"], pickup, ret, value).status_code == 200
        assert read(b)["checkout"] == {"allowed": True, "blockers": []}
        page.reload()
        detail = open_counter_booking(page, b["ref"], "lantern-led")
        expect(detail.get_by_role("button", name="Start checkout")).to_be_enabled()


def test_wf_counter_checkout_keyboard(browser: Browser, base: str) -> None:
    owner = staff(base)
    b = prepped(base, owner, "lantern-led", *window(3))
    units = serials(b["booking"])
    try:
        with ui(browser, base, "/desk") as page:
            desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
            entry = page.get_by_role("list", name="Bookings").get_by_role("button", name=f"{b['ref']} · {KITS['lantern-led']}", exact=True)
            entry.focus()
            page.keyboard.press("Enter")
            detail = page.get_by_role("region", name="Booking detail")
            expect(detail).to_contain_text(b["ref"])
            start = detail.get_by_role("button", name="Start checkout")
            expect(start).to_be_enabled()
            start.focus()
            page.keyboard.press("Enter")
            region = page.get_by_role("region", name="Checkout")
            scan = region.get_by_role("textbox", name="Scan serial")
            expect(scan).to_be_focused()
            page.keyboard.type("WS35-01")
            page.keyboard.press("Enter")
            expect(page.get_by_text("WS35-01 is not on this booking").first).to_be_visible()
            expect(scan).to_be_focused()
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            for serial in units:
                page.keyboard.press("Control+A")
                page.keyboard.type(serial)
                page.keyboard.press("Enter")
                group = region.get_by_role("group", name=serial)
                expect(group).to_be_visible()
                for name in CHECKS:
                    box_ = group.get_by_role("checkbox", name=name)
                    tab_to(page, box_)
                    page.keyboard.press("Space")
                    expect(box_).to_be_checked()
                tab_to(page, group.get_by_role("textbox", name="Condition notes"))
                page.keyboard.type(f"Clean {serial}")
                tab_to(page, group.get_by_label("Condition photo"))
                with page.expect_file_chooser() as chooser:
                    page.keyboard.press("Enter")
                chooser.value.set_files({"name": f"{serial}.png", "mimeType": "image/png", "buffer": png(serial)})
                expect(group.get_by_text("Stored", exact=True)).to_be_visible()
                tab_to(page, group.get_by_role("button", name="Done with unit"))
                page.keyboard.press("Enter")
                expect(scan).to_be_focused()
            review = page.get_by_role("button", name="Review checkout")
            tab_to(page, review)
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Confirm checkout")
            expect(dialog).to_be_visible()
            assert inside(dialog), "opening Confirm checkout focuses its first control"
            for key in ["Tab"] * 4 + ["Shift+Tab"] * 4:
                page.keyboard.press(key)
                assert inside(dialog), f"{key} left the open Confirm checkout dialog"
            page.keyboard.press("Escape")
            expect(dialog).to_have_count(0)
            expect(review).to_be_focused()
            page.keyboard.press("Enter")
            tab_to(page, dialog.get_by_role("button", name="Check out kit"), presses=4)
            page.keyboard.press("Enter")
            expect(page.get_by_role("status", name="Counter status")).to_contain_text(f"Kit out · {b['ref']}")
            expect(dialog).to_have_count(0)
            assert detail.evaluate(
                "d => d.contains(document.activeElement) && (/^H[1-6]$/.test(document.activeElement.tagName)"
                " || document.activeElement.getAttribute('role') === 'heading')"), "focus moves to the booking detail heading"
        bk = read(b)
        assert bk["state"] == "out"
        assert all(u["location"] == f"booking:{b['ref']}" for u in bk["units"])
    finally:
        wind_up(base, b["ref"])


def test_wf_counter_checkout_layout(browser: Browser, base: str) -> None:
    b = held_booking(base, "lantern-led", *window(3))
    name = f"{b['ref']} · {KITS['lantern-led']}"
    for label, size in VIEWPORTS.items():
        with ui(browser, base, "/desk", size=size) as page:
            desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
            listing = page.get_by_role("list", name="Bookings")
            detail = page.get_by_role("region", name="Booking detail")
            expect(listing.get_by_role("button", name=name, exact=True)).to_be_attached()
            layout(page)
            if label == "desktop":
                expect(detail).to_be_visible()
                lb, db = box(listing), box(detail)
                assert lb["x"] + lb["width"] <= db["x"] + 1, "desktop: list left of detail"
                assert lb["y"] < db["y"] + db["height"] and db["y"] < lb["y"] + lb["height"], "both panes share the screen"
                assert out_of_view(page.get_by_role("button", name="Back to bookings"), size)
                open_counter_booking(page, b["ref"], "lantern-led")
                expect(listing).to_be_visible()
            else:
                assert out_of_view(detail, size), f"{label}: only the list shows on load"
                entry = listing.get_by_role("button", name=name, exact=True)
                entry.click()
                expect(detail).to_contain_text(b["ref"])
                assert out_of_view(listing, size), f"{label}: the detail replaces the list"
                layout(page)
                detail.get_by_role("button", name="Back to bookings").click()
                expect(listing).to_be_visible()
                expect(listing.get_by_role("button", name=name, exact=True)).to_be_focused()
                assert out_of_view(detail, size)


def test_wf_counter_checkout_happy(browser: Browser, base: str, mail: Any) -> None:
    owner = staff(base)
    b = prepped(base, owner, "lantern-led", *window(3))
    units = serials(b["booking"])
    try:
        with ui(browser, base, "/desk") as page:
            desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
            detail = open_counter_booking(page, b["ref"], "lantern-led")
            detail.get_by_role("button", name="Start checkout").click()
            region = page.get_by_role("region", name="Checkout")
            scan = region.get_by_role("textbox", name="Scan serial")
            for index, serial in enumerate(units):
                scan.fill(serial)
                scan.press("Enter")
                group = region.get_by_role("group", name=serial)
                for name in CHECKS:
                    check(group.get_by_role("checkbox", name=name))
                group.get_by_role("textbox", name="Condition notes").fill(f"Lens caps on {serial}")
                payload = {"name": f"{serial}.png", "mimeType": "image/png", "buffer": png(f"ui-{serial}")}
                if index == 0:
                    with held(page, "**/api/bookings/*/photos") as gate:
                        group.get_by_label("Condition photo").set_input_files(payload)
                        expect(group).to_contain_text(re.compile("Pending|Uploading photo"))
                        expect(group.get_by_text("Stored", exact=True)).to_have_count(0)
                        done = group.get_by_role("button", name="Done with unit")
                        if done.is_enabled():
                            done.click()
                            expect(page.get_by_text("Tick every check and attach a stored photo first").first).to_be_visible()
                        gate.release()
                else:
                    group.get_by_label("Condition photo").set_input_files(payload)
                expect(group.get_by_text("Stored", exact=True)).to_be_visible()
                group.get_by_role("button", name="Done with unit").click()
            page.get_by_role("button", name="Review checkout").click()
            page.get_by_role("dialog", name="Confirm checkout").get_by_role("button", name="Check out kit").click()
            expect(page.get_by_role("status", name="Counter status")).to_contain_text(f"Kit out · {b['ref']}")
        bk = read(b)
        assert bk["state"] == "out"
        for u in bk["units"]:
            assert u["location"] == f"booking:{b['ref']}" and u["checkedOut"] is True
            assert S3().keys(f"photos/{b['ref']}/checkout/{u['serial']}/"), "the checkout photo is in MinIO"
            last = history(owner, u["serial"])["movements"][-1]
            assert (last["reason"], last["from"], last["to"], last["bookingRef"]) == ("checkout", "shelf", f"booking:{b['ref']}", b["ref"])
            paired(last)
    finally:
        wind_up(base, b["ref"])


def test_unit_checkin(base: str) -> None:
    owner = staff(base)
    b = out_booking(base, owner)
    first, last = serials(b["booking"])
    deposit = b["booking"]["depositCents"]
    try:
        field(checkin(owner, b["ref"], first, "ok", deposit // 4), "damageChargeCents", "Only damaged units carry a charge")
        field(checkin(owner, b["ref"], first, "damaged", deposit + 1), "damageChargeCents",
              f"Damage charges cannot exceed the {dollars(deposit)} deposit")
        field(checkin(owner, b["ref"], first, "broken"), "condition")
        r = checkin(owner, b["ref"], first, "ok")
        assert r.status_code == 200, r.text
        bk = r.json()
        assert bk["state"] == "out"
        unit = [u for u in bk["units"] if u["serial"] == first][0]
        assert unit["checkedIn"] is True and unit["condition"] == "ok" and unit["location"] == "shelf"
        error(checkin(owner, b["ref"], first, "ok"), 409, "unit_already_returned", f"{first} is already checked in")
        r = checkin(owner, b["ref"], last, "damaged", deposit // 4)
        assert r.status_code == 200, r.text
        bk = r.json()
        assert bk["state"] == "returned"
        unit = [u for u in bk["units"] if u["serial"] == last][0]
        assert unit["condition"] == "damaged" and unit["damageChargeCents"] == deposit // 4 and unit["location"] == "repair"
        h = history(owner, last)
        assert h["location"] == "repair"
        move_in = h["movements"][-1]
        assert (move_in["reason"], move_in["from"], move_in["to"]) == ("checkin", f"booking:{b['ref']}", "repair")
        paired(move_in)
        assert history(owner, first)["location"] == "shelf"
        error(checkin(owner, b["ref"], last, "damaged", deposit // 4), 409, "invalid_transition", f"Booking {b['ref']} is returned")
    finally:
        wind_up(base, b["ref"])


def test_photos_stored_before_they_count(browser: Browser, base: str, storage_down_url: str) -> None:
    owner = staff(base)
    b = prepped(base, owner, "lantern-led", *window(3))
    first, second = serials(b["booking"])
    try:
        data = png(f"stored-{b['ref']}")
        r = photo(owner, b["ref"], "checkout", first, data)
        assert r.status_code == 201, r.text
        stored = r.json()
        assert stored["status"] == "stored" and stored["serial"] == first and stored["phase"] == "checkout"
        assert stored["key"] == f"photos/{b['ref']}/checkout/{first}/{stored['id']}.png"
        assert S3().get(stored["key"]) == data
        jpeg = photo(owner, b["ref"], "checkout", first, JPEG, name="unit.png", ctype="image/png")
        assert jpeg.status_code == 201 and jpeg.json()["key"].endswith(".jpg"), jpeg.text
        field(photo(owner, b["ref"], "checkout", first, pdf("not-a-photo"), name="unit.png"), "file", "Attach a JPEG or PNG photo")
        field(photo(owner, b["ref"], "checkout", "WS35-01"), "serial", "WS35-01 is not on this booking")
        error(photo(owner, b["ref"], "checkin", first), 409, "invalid_transition")
        down = staff(storage_down_url)
        error(photo(down, b["ref"], "checkout", second), 503, "storage_unavailable")
        records = [p for p in read(b)["photos"] if p["serial"] == second]
        assert records and all(p["status"] == "failed" for p in records)
        assert S3().keys(f"photos/{b['ref']}/checkout/{second}/") == []
        err = error(owner.post(f"/api/bookings/{b['ref']}/checkout", json=checkout_body([first, second])), 409, "photos_not_stored")
        assert err["serials"] == [second]
        with ui(browser, base, "/desk") as page:
            desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
            detail = open_counter_booking(page, b["ref"], "lantern-led")
            expect(detail.get_by_text("Failed", exact=True).first).to_be_visible()
            expect(detail.get_by_text("Stored", exact=True).first).to_be_visible()
        assert photo(owner, b["ref"], "checkout", second).status_code == 201
        r = owner.post(f"/api/bookings/{b['ref']}/checkout", json=checkout_body([first, second]))
        assert r.status_code == 200 and r.json()["state"] == "out", r.text
    finally:
        wind_up(base, b["ref"])


def test_wf_check_in_and_close_settle(base: str, killbill: Any, mail: Any) -> None:
    owner = staff(base)
    b = out_booking(base, owner)
    ref, (first, second) = b["ref"], serials(b["booking"])
    deposit = b["booking"]["depositCents"]
    charge = deposit // 4
    try:
        error(close(owner, ref), 409, "invalid_transition", f"Booking {ref} is out")
        assert [x["code"] for x in read(b)["close"]["blockers"]][0] == "not_returned"
        assert checkin(owner, ref, first, "ok").status_code == 200
        assert checkin(owner, ref, second, "damaged", charge).status_code == 200
        gate = read(b)["close"]
        assert gate["allowed"] is False and [x["code"] for x in gate["blockers"]] == ["photos_not_stored"]
        listed = re.fullmatch(r"Condition photos are not stored for (.+)", gate["blockers"][0]["message"]).group(1)
        assert {s.strip() for s in listed.split(",")} == {first, second}
        err = error(close(owner, ref), 409, "close_blocked")
        assert [x["code"] for x in err["blockers"]] == ["photos_not_stored"]
        assert photo(owner, ref, "checkin", first).status_code == 201
        listed = re.fullmatch(r"Condition photos are not stored for (.+)", read(b)["close"]["blockers"][0]["message"]).group(1)
        assert listed.strip() == second
        assert photo(owner, ref, "checkin", second).status_code == 201
        assert read(b)["close"] == {"allowed": True, "blockers": []}
        field(owner.post(f"/api/bookings/{ref}/close", json={}), "idempotencyKey", "Send an Idempotency-Key header")
        key = ikey()
        r = close(owner, ref, key)
        assert r.status_code == 200, r.text
        bk = r.json()
        assert bk["state"] == "closed" and bk["paymentStatus"] == "refunded"
        assert bk["damageCents"] == charge and bk["refundCents"] == deposit - charge
        replay = close(owner, ref, key)
        assert replay.status_code == 200 and replay.content == r.content
        account = killbill.account_by_key(b["email"])
        items = [i for inv in killbill.invoices(account["accountId"]) for i in inv.get("items", [])]
        assert [i for i in items if i.get("description") == f"Damage · {ref}" and cents(i["amount"]) == charge]
        refunds = [t for t in tx(killbill, ref, "REFUND") if t.get("transactionExternalKey") == f"{ref}-refund"]
        assert len(refunds) == 1 and cents(refunds[0]["amount"]) == deposit - charge
        receipt = await_mail(mail, b["email"], f"Return receipt · {ref}")
        body = lines(receipt[0])
        for line in [f"{first} · OK", f"{second} · Damaged · {dollars(charge)}",
                     f"Damage charge: {dollars(charge)}", f"Deposit refunded: {dollars(deposit - charge)}"]:
            assert line in body, f"receipt lacks {line!r}: {body}"
        error(close(owner, ref), 409, "invalid_transition", f"Booking {ref} is closed")
        assert len(mails(mail, b["email"], f"Return receipt · {ref}")) == 1
    finally:
        wind_up(base, ref)
    whole = out_booking(base, owner)
    try:
        units = serials(whole["booking"])
        assert checkin(owner, whole["ref"], units[0], "damaged", whole["booking"]["depositCents"]).status_code == 200
        assert checkin(owner, whole["ref"], units[1], "ok").status_code == 200
        for s in units:
            assert photo(owner, whole["ref"], "checkin", s).status_code == 201
        r = close(owner, whole["ref"])
        assert r.status_code == 200, r.text
        bk = r.json()
        assert bk["refundCents"] == 0 and bk["paymentStatus"] == "paid" and bk["damageCents"] == whole["booking"]["depositCents"]
        assert [t for t in tx(killbill, whole["ref"], "REFUND") if t.get("transactionExternalKey") == f"{whole['ref']}-refund"] == []
    finally:
        wind_up(base, whole["ref"])


def test_wf_check_in_and_close_happy(browser: Browser, base: str, killbill: Any, mail: Any) -> None:
    owner = staff(base)
    b = out_booking(base, owner)
    ref, (good, bad) = b["ref"], serials(b["booking"])
    charge = b["booking"]["depositCents"] // 4
    try:
        r = owner.post(f"/api/bookings/{ref}/checkin", json={"serial": bad, "condition": "damaged", "damageChargeCents": None})
        field(r, "damageChargeCents")
        with ui(browser, base, "/desk") as page:
            desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
            detail = open_counter_booking(page, ref, "lantern-led")
            detail.get_by_role("button", name="Start check-in").click()
            region = page.get_by_role("region", name="Check-in")
            scan = region.get_by_role("textbox", name="Scan serial")
            status = page.get_by_role("status", name="Counter status")
            for serial, condition in [(good, "OK"), (bad, "Damaged")]:
                scan.fill(serial)
                scan.press("Enter")
                group = region.get_by_role("group", name=serial)
                check(group.get_by_role("radio", name=condition, exact=True))
                charge_box = group.get_by_role("textbox", name="Damage charge")
                if condition == "OK":
                    expect(charge_box).to_be_disabled()
                else:
                    expect(charge_box).to_be_enabled()
                    charge_box.fill(plain_dollars(charge))
                group.get_by_role("textbox", name="Condition notes").fill(f"Returned {serial}")
                group.get_by_label("Condition photo").set_input_files({"name": f"{serial}.png", "mimeType": "image/png", "buffer": png(f"in-{serial}")})
                expect(group.get_by_text("Stored", exact=True)).to_be_visible()
                group.get_by_role("button", name="Check in unit").focus()
                page.keyboard.press("Enter")
                expect(status).to_contain_text(f"{serial} checked in")
                if serial == good:
                    expect(scan).to_be_focused()
            close_button = page.get_by_role("button", name="Close check-in")
            expect(close_button).to_be_enabled()
            assert not page.evaluate("document.activeElement === document.body"), "focus is lost after the last check-in"
            tab_to(page, close_button)
            page.keyboard.press("Enter")
            expect(status).to_contain_text(f"Check-in closed · {ref}")
        bk = read(b)
        assert bk["state"] == "closed" and bk["damageCents"] == charge
        for serial, place in [(good, "shelf"), (bad, "repair")]:
            h = history(owner, serial)
            assert h["location"] == place
            last = h["movements"][-1]
            assert (last["reason"], last["from"], last["to"]) == ("checkin", f"booking:{ref}", place)
            ledger_balanced(h)
        account = killbill.account_by_key(b["email"])
        items = [i for inv in killbill.invoices(account["accountId"]) for i in inv.get("items", [])]
        assert [i for i in items if i.get("description") == f"Damage · {ref}" and cents(i["amount"]) == charge]
        await_mail(mail, b["email"], f"Return receipt · {ref}")
    finally:
        wind_up(base, ref)


def test_paired_ledger(base: str) -> None:
    owner = staff(base)
    for serial in SEED_SERIALS:
        h = history(owner, serial)
        ledger_balanced(h)
        first = h["movements"][0]
        assert (first["reason"], first["from"], first["to"], first["bookingRef"]) == ("opening", "acquired", "shelf", None)
        assert [m["at"] for m in h["movements"]] == sorted(m["at"] for m in h["movements"])
        assert h["movements"][-1]["to"] == h["location"]
    assert [m for m in history(owner, "SG-03")["movements"] if m["reason"] == "to_repair" and (m["from"], m["to"]) == ("shelf", "repair")]
    serial = [s for s in ["TZ-02", "FMP-03", "HPS-03"] if history(owner, s)["location"] == "shelf"][0]
    before = len(history(owner, serial)["movements"])
    try:
        assert move(owner, serial, "repair").status_code == 201
        assert move(owner, serial, "shelf").status_code == 201
    finally:
        restore(owner, serial)
    h = history(owner, serial)
    ledger_balanced(h)
    added = h["movements"][before:]
    assert [(m["reason"], m["from"], m["to"], m["bookingRef"]) for m in added] == [
        ("to_repair", "shelf", "repair", None), ("from_repair", "repair", "shelf", None)]


def test_wf_repair_and_ledger_repair(browser: Browser, base: str) -> None:
    owner, prep_tech = staff(base), staff(base, PREP_PASSCODE)
    serial = [s for s in ["TZ-02", "FMP-02", "HPS-02"] if history(owner, s)["location"] == "shelf"][0]
    before = len(history(owner, serial)["movements"])
    try:
        with ui(browser, base, "/desk") as page:
            desk_sign_in(page, base, OWNER_PASSCODE, "/desk/owner")
            units = page.get_by_role("region", name="Units")
            status = page.get_by_role("status", name="Desk status")
            units.get_by_role("button", name=f"Send {serial} to repair").click()
            expect(status).to_contain_text(f"{serial} sent to repair")
            assert history(owner, serial)["location"] == "repair"
            units.get_by_role("button", name=f"Return {serial} from repair").click()
            expect(status).to_contain_text(f"{serial} back on the shelf")
            units.get_by_role("button", name=f"History {serial}").click()
            expect(page.get_by_role("dialog", name=f"Unit history {serial}")).to_be_visible()
        h = history(owner, serial)
        assert h["location"] == "shelf"
        assert [m["reason"] for m in h["movements"][before:]] == ["to_repair", "from_repair"]
        error(move(prep_tech, serial, "shelf"), 409, "illegal_move", f"{serial} can't move from shelf to shelf")
        r = move(prep_tech, serial, "repair")
        assert r.status_code == 201 and r.json()["location"] == "repair", r.text
        error(move(prep_tech, serial, "repair"), 409, "illegal_move", f"{serial} can't move from repair to repair")
        field(move(prep_tech, serial, "acquired"), "to")
        error(httpx.post(f"{base}/api/units/{serial}/moves", json={"to": "shelf"}), 401, "unauthenticated")
        assert len(history(owner, serial)["movements"]) == before + 3, "refused moves add no movement"
    finally:
        restore(owner, serial)
    b = prepped(base, owner, "lantern-led", *window(3))
    units = serials(b["booking"])
    try:
        for unit in units:
            assert photo(owner, b["ref"], "checkout", unit).status_code == 201
        move(owner, units[0], "repair")
        owner.post(f"/api/bookings/{b['ref']}/checkout", json=checkout_body(units))
        ledger_balanced(history(owner, units[0]))
    finally:
        wind_up(base, b["ref"])


def test_wf_repair_and_ledger_counts(browser: Browser, base: str) -> None:
    owner = staff(base)
    pickup, ret = window(3)

    def agree(stage: str) -> dict:
        where = {s: history(owner, s)["location"] for s in SEED_SERIALS}
        ready_to_go, free = {}, {}
        for kit_id in KITS:
            classes: dict[str, list[dict]] = {}
            for u in get_kit(base, kit_id, pickup, ret)["units"]:
                classes.setdefault(u["classId"], []).append(u)
                assert u["location"] == where[u["serial"]], f"{stage}: {u['serial']} location disagrees with its history"
                assert (u["status"] == "repair") == (where[u["serial"]] == "repair"), stage
            ready_to_go[kit_id] = min(sum(1 for u in us if where[u["serial"]] == "shelf") for us in classes.values())
            free[kit_id] = min(sum(1 for u in us if u["status"] == "free") for us in classes.values())
        listed = {k["id"]: k for k in get_kits(base, pickup, ret)}
        util = owner.get("/api/utilisation").json()
        out = sum(1 for v in where.values() if v.startswith("booking:"))
        shelf = sum(1 for v in where.values() if v == "shelf")
        repair = sum(1 for v in where.values() if v == "repair")
        total = len(SEED_SERIALS)
        assert (util["totalUnits"], util["onShelf"], util["out"], util["repair"]) == (total, shelf, out, repair), stage
        assert util["utilisationPercent"] == (out * 200 + total) // (2 * total), stage
        assert {k["kitId"]: k["readyToGo"] for k in util["kits"]} == ready_to_go, stage
        for kit_id in KITS:
            assert listed[kit_id]["readyToGo"] == ready_to_go[kit_id], stage
            assert listed[kit_id]["freeForDates"] == free[kit_id], stage
        return {"util": util, "ready": ready_to_go}

    start = agree("start")
    serial = [s for s in ["TZ-01", "TZ-02"] if history(owner, s)["location"] == "shelf"][0]
    b = None
    try:
        assert move(owner, serial, "repair").status_code == 201
        moved = agree("after a repair move")
        assert moved["util"]["repair"] == start["util"]["repair"] + 1
        assert move(owner, serial, "shelf").status_code == 201
        agree("after a return from repair")
        b = out_booking(base, owner)
        out = agree("after checkout")
        assert out["util"]["out"] == start["util"]["out"] + len(serials(b["booking"]))
        with ui(browser, base, "/desk") as page:
            desk_sign_in(page, base, OWNER_PASSCODE, "/desk/owner")
            util = out["util"]
            region = page.get_by_role("region", name="Utilisation")
            expect(region).to_contain_text(f"{util['out']} of {util['totalUnits']} units out")
            expect(region).to_contain_text(f"{util['onShelf']} on the shelf")
            expect(region).to_contain_text(f"{util['repair']} in repair")
            expect(region).to_contain_text(f"{util['utilisationPercent']}% utilisation")
            kits = page.get_by_role("region", name="Kits")
            for kit_id, name in KITS.items():
                expect(kits).to_contain_text(name)
                expect(kits).to_contain_text(f"{out['ready'][kit_id]} ready to go")
        for s in serials(b["booking"]):
            assert checkin(owner, b["ref"], s, "ok").status_code == 200
        agree("after check-in")
    finally:
        restore(owner, serial)
        if b is not None:
            wind_up(base, b["ref"])


def test_wf_booking_lifecycle_cancel(browser: Browser, base: str, killbill: Any) -> None:
    owner = staff(base)
    pickup, ret = window(3)
    before = get_kits(base, pickup, ret)[2]["freeForDates"]
    b = confirmed(base, owner, "lantern-led", pickup, ret)
    assert get_kits(base, pickup, ret)[2]["freeForDates"] == before - 1
    total = b["booking"]["totalCents"]
    not_object = raw_json(b"[]")
    error(httpx.post(f"{base}/api/bookings/{b['ref']}/cancel", **not_object), 401, "unauthenticated")
    error(owner.post(f"/api/bookings/{UNKNOWN_REF}/cancel", **not_object), 404, "not_found")
    with ui(browser, base, f"/bookings/{b['ref']}?key={b['key']}") as page:
        opener = page.get_by_role("button", name="Cancel booking")
        opener.click()
        dialog = page.get_by_role("dialog", name="Cancel booking")
        expect(dialog.get_by_role("button", name="Cancel booking and refund")).to_be_visible()
        assert inside(dialog)
        for key in ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]:
            page.keyboard.press(key)
            assert inside(dialog), f"{key} escaped the Cancel booking dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        opener.click()
        expect(dialog).to_be_visible()
        with page.expect_response(lambda r: f"/api/bookings/{b['ref']}" in r.url and r.request.method == "GET", timeout=45_000):
            pass
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        opener.click()
        dialog.get_by_role("button", name="Keep booking").click()
        expect(dialog).to_have_count(0)
        assert read(b)["state"] == "confirmed" and tx(killbill, b["ref"], "REFUND") == []
        opener.click()
        dialog.get_by_role("button", name="Cancel booking and refund").click()
        expect(page.get_by_role("heading", name="Booking cancelled")).to_be_visible()
        expect(page.get_by_text(f"We've refunded {dollars(total)} to your card.", exact=True).first).to_be_visible()
    bk = read(b)
    assert bk["state"] == "cancelled" and bk["paymentStatus"] == "refunded"
    assert bk["refundCents"] == total and bk["damageCents"] == 0
    refunds = [t for t in tx(killbill, b["ref"], "REFUND") if t.get("transactionExternalKey") == f"{b['ref']}-cancel"]
    assert len(refunds) == 1 and cents(refunds[0]["amount"]) == total
    assert get_kits(base, pickup, ret)[2]["freeForDates"] == before, "cancelling releases the units"
    c = confirmed(base, owner, "lantern-led", *window(3))
    r = owner.post(f"/api/bookings/{c['ref']}/cancel", json={})
    assert r.status_code == 200 and r.json()["state"] == "cancelled", r.text
    assert cents(tx(killbill, c["ref"], "REFUND")[0]["amount"]) == c["booking"]["totalCents"]
    error(owner.post(f"/api/bookings/{c['ref']}/cancel", json={}), 409, "invalid_transition", f"Booking {c['ref']} is cancelled")
    q = held_booking(base, "lantern-led", *window(3))
    r = httpx.post(f"{base}/api/bookings/{q['ref']}/cancel", json={}, headers=renter(q["key"]))
    error(r, 409, "invalid_transition", f"Booking {q['ref']} is quote")


def test_wf_booking_lifecycle_rights(base: str) -> None:
    owner, prep_tech = staff(base), staff(base, PREP_PASSCODE)
    q = held_booking(base, "lantern-led", *window(3))
    stranger = held_booking(base, "lantern-led", *window(3))
    ref = q["ref"]
    error(prep_tech.post(f"/api/bookings/{ref}/confirm", json={}, headers={"Idempotency-Key": ikey()}), 403, "forbidden")
    error(prep_tech.post(f"/api/bookings/{ref}/cancel", json={}), 403, "forbidden")
    error(httpx.post(f"{base}/api/bookings/{ref}/prep", json={}, headers=renter(q["key"])), 401, "unauthenticated")
    error(httpx.get(f"{base}/api/bookings/{ref}", headers=renter(stranger["key"])), 404, "not_found")
    error(confirm(base, {**q, "key": stranger["key"]}), 404, "not_found")
    error(prep(prep_tech, ref), 409, "invalid_transition", f"Booking {ref} is quote")
    error(prep_tech.post(f"/api/bookings/{ref}/checkout", json=checkout_body(serials(q["booking"]))), 409, "invalid_transition")
    error(checkin(prep_tech, ref, serials(q["booking"])[0]), 409, "invalid_transition")
    error(close(prep_tech, ref), 409, "invalid_transition", f"Booking {ref} is quote")
    c = confirmed(base, owner, "lantern-led", *window(3))
    error(prep_tech.post(f"/api/bookings/{c['ref']}/confirm", json={}, headers={"Idempotency-Key": ikey()}), 403, "forbidden")
    error(owner.post(f"/api/bookings/{c['ref']}/confirm", json={}, headers={"Idempotency-Key": ikey()}), 409, "invalid_transition",
          f"Booking {c['ref']} is confirmed")
    error(owner.post(f"/api/bookings/{c['ref']}/checkout", json=checkout_body(serials(c["booking"]))), 409, "invalid_transition")
    error(photo(owner, c["ref"], "checkout", serials(c["booking"])[0]), 409, "invalid_transition")
    d = ready(base, owner, "lantern-led", *window(3))
    r = owner.post(f"/api/bookings/{d['ref']}/confirm", json={}, headers={"Idempotency-Key": ikey()})
    assert r.status_code == 200 and r.json()["state"] == "confirmed", "the owner may confirm"
    field(prep_tech.get("/api/bookings", params={"state": "parked"}), "state")
    listed = prep_tech.get("/api/bookings", params={"state": "quote"}).json()["bookings"]
    assert all(b["state"] == "quote" for b in listed) and ref in [b["ref"] for b in listed]
    order = [(b["pickupDate"], len(b["ref"]), b["ref"]) for b in listed]
    assert order == sorted(order), "bookings are ordered by pickup date then ref"


def test_wf_provider_outages_payments(browser: Browser, base: str, payments_down_url: str, killbill: Any, mail: Any) -> None:
    down = payments_down_url
    started = time.monotonic()
    assert httpx.get(down + "/api/status", timeout=HTTP_TIMEOUT_S).json()["payments"] == "down"
    assert time.monotonic() - started < PROVIDER_ANSWER_S
    owner = staff(base)
    q = ready(base, owner, "lantern-led", *window(3))
    started = time.monotonic()
    error(confirm(down, q), 503, "payments_unavailable", "Payment service unreachable")
    assert time.monotonic() - started < PROVIDER_ANSWER_S
    now = read(q)
    assert now["state"] == "quote" and now["paymentStatus"] == "none" and now["confirmable"] is True
    assert killbill.account_by_key(q["email"]) is None
    assert mails(mail, q["email"], f"Booking confirmed · {q['ref']} · {KITS['lantern-led']}") == []
    c = confirmed(base, owner, "lantern-led", *window(3))
    error(httpx.post(f"{down}/api/bookings/{c['ref']}/cancel", json={}, headers=renter(c["key"]), timeout=HTTP_TIMEOUT_S), 503, "payments_unavailable")
    now = read(c)
    assert now["state"] == "confirmed" and now["paymentStatus"] == "paid" and tx(killbill, c["ref"], "REFUND") == []
    o = out_booking(base, owner)
    try:
        for s in serials(o["booking"]):
            assert checkin(owner, o["ref"], s, "ok").status_code == 200
            assert photo(owner, o["ref"], "checkin", s).status_code == 201
        key = ikey()
        error(close(staff(down), o["ref"], key), 503, "payments_unavailable")
        now = read(o)
        assert now["state"] == "returned" and now["paymentStatus"] == "paid" and now["refundCents"] == 0
        assert tx(killbill, o["ref"], "REFUND") == []
        assert mails(mail, o["email"], f"Return receipt · {o['ref']}") == []
        retry = close(owner, o["ref"], key)
        assert retry.status_code == 200 and retry.json()["state"] == "closed", "a 5xx is not stored, so the key may be retried"
    finally:
        wind_up(base, o["ref"])
    with ui(browser, down, f"/bookings/{q['ref']}?key={q['key']}") as page:
        notice = page.get_by_role("region", name="Service notice")
        expect(notice.get_by_role("heading", name="Payments are offline")).to_be_visible()
        expect(notice).to_contain_text("We can't take or refund payments right now, so bookings can't be confirmed, cancelled or closed. Holds keep running on their own timers.")
        page.get_by_role("button", name="Confirm and pay").click()
        expect(page.get_by_text("Payment service unreachable").first).to_be_visible()
    with ui(browser, down, "/") as page:
        expect(page.get_by_role("region", name="Service notice").get_by_role("heading", name="Payments are offline")).to_be_visible()


def test_wf_provider_outages_storage(browser: Browser, base: str, storage_down_url: str) -> None:
    down = storage_down_url
    started = time.monotonic()
    assert httpx.get(down + "/api/status", timeout=HTTP_TIMEOUT_S).json()["storage"] == "down"
    assert time.monotonic() - started < PROVIDER_ANSWER_S
    owner = staff(base)
    q = held_booking(base, "lantern-led", *window(3))
    started = time.monotonic()
    error(upload_cert(down, q, pdf(q["ref"])), 503, "storage_unavailable")
    assert time.monotonic() - started < PROVIDER_ANSWER_S
    assert read(q)["certificate"] is None, "a failed upload leaves no certificate record"
    assert S3().keys(f"certificates/{q['ref']}/") == []
    p = prepped(base, owner, "lantern-led", *window(3))
    unit = serials(p["booking"])[0]
    down_owner = staff(down)
    error(photo(down_owner, p["ref"], "checkout", unit), 503, "storage_unavailable")
    assert all(x["status"] != "stored" for x in read(p)["photos"])
    assert S3().keys(f"photos/{p['ref']}/") == []
    error(down_owner.get(f"/api/certificates/{p['booking']['certificate']['id']}/file"), 503, "storage_unavailable")
    with ui(browser, down, f"/bookings/{q['ref']}?key={q['key']}") as page:
        notice = page.get_by_role("region", name="Service notice")
        expect(notice.get_by_role("heading", name="Photo storage is offline")).to_be_visible()
        expect(notice).to_contain_text("Certificates and condition photos can't be saved right now. Anything already stored is safe.")
        page.get_by_label("Certificate of insurance (PDF)").set_input_files({"name": "cover.pdf", "mimeType": "application/pdf", "buffer": pdf(q["ref"])})
        page.get_by_role("button", name="Send certificate").click()
        expect(page.get_by_text("No certificate yet")).to_be_visible()
    assert read(q)["certificate"] is None


def test_health_and_status(base: str, payments_down_url: str, storage_down_url: str) -> None:
    for url in (base, payments_down_url, storage_down_url):
        r = httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert r.headers["content-type"].startswith("application/json")
    status = httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT_S).json()
    assert status == {"payments": "up", "storage": "up"}


def test_wf_cross_cutting_sign_in(browser: Browser, base: str) -> None:
    error(httpx.post(base + "/api/session", json={"passcode": "not-a-passcode"}), 401, "invalid_passcode", "That passcode isn't recognised")
    client = api(base)
    r = client.post("/api/session", json={"passcode": OWNER_PASSCODE})
    assert r.status_code == 200 and r.json() == {"role": "owner"}
    cookie = r.headers.get("set-cookie", "")
    assert "tallyslate_session" in cookie and "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    assert client.get("/api/session").json() == {"role": "owner"}
    assert client.delete("/api/session").status_code == 204
    error(client.get("/api/session"), 401, "unauthenticated")
    prep_tech = staff(base, PREP_PASSCODE)
    assert prep_tech.get("/api/session").json() == {"role": "prep_tech"}
    assert prep_tech.get("/api/bookings").status_code == 200
    error(prep_tech.get("/api/utilisation"), 403, "forbidden")
    for path in ["/api/bookings", "/api/utilisation", "/api/rate-cards", "/api/certificates", "/api/session"]:
        error(httpx.get(base + path), 401, "unauthenticated")
    with ui(browser, base, "/desk") as page:
        desk_sign_in(page, base, PREP_PASSCODE, "/desk/counter")
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
        page.goto(base + "/desk/owner")
        expect(page.get_by_role("heading", name="This page is for the owner")).to_be_visible()
        expect(page.get_by_role("region", name="Utilisation")).to_have_count(0)
    with ui(browser, base, "/desk") as page:
        desk_sign_in(page, base, OWNER_PASSCODE, "/desk/owner")
        expect(page.get_by_role("region", name="Utilisation")).to_be_visible()
        page.get_by_role("button", name="Sign out").click()
        poll(lambda: page.request.get(base + "/api/session").status == 401, "Sign out ended the owner session")


def test_error_shape_and_precedence(base: str, payments_down_url: str) -> None:
    owner, prep_tech = staff(base), staff(base, PREP_PASSCODE)
    q = held_booking(base, "lantern-led", *window(3))
    error(httpx.get(f"{base}/api/no-such-endpoint"), 404, "not_found")
    huge = json.dumps({"pad": "x" * JSON_LIMIT_BYTES}).encode()
    error(httpx.post(f"{base}/api/bookings/{q['ref']}/prep", content=huge, headers={"Content-Type": "application/json"}), 413, "too_large")
    error(httpx.post(f"{base}/api/bookings/{q['ref']}/prep", content=b"{}", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    error(httpx.post(f"{base}/api/bookings/{q['ref']}/prep", json={}), 401, "unauthenticated")
    error(httpx.get(f"{base}/api/bookings/{q['ref']}"), 401, "unauthenticated")
    error(prep_tech.post(f"/api/bookings/{UNKNOWN_REF}/confirm", json={}), 404, "not_found")
    error(prep_tech.post(f"/api/bookings/{q['ref']}/confirm", json={}), 403, "forbidden")
    error(prep_tech.post(f"/api/bookings/{q['ref']}/checkout", json={"units": []}), 409, "invalid_transition")
    ready_quote = ready(base, owner, "lantern-led", *window(3))
    r = httpx.post(f"{payments_down_url}/api/bookings/{ready_quote['ref']}/confirm", json={}, headers=renter(ready_quote["key"]), timeout=HTTP_TIMEOUT_S)
    field(r, "idempotencyKey", "Send an Idempotency-Key header")
    error(confirm(payments_down_url, ready_quote), 503, "payments_unavailable")


def test_wf_cross_cutting_boundary(browser: Browser, base: str, payments_down_url: str, storage_down_url: str) -> None:
    r = httpx.post(base + "/api/session", json={"passcode": OWNER_PASSCODE}, headers={"Origin": "http://elsewhere.invalid"})
    error(r, 403, "cross_origin")
    secure_twin = base.replace("http://", "https://", 1)
    for origin in ["null", secure_twin]:
        r = httpx.post(base + "/api/session", json={"passcode": OWNER_PASSCODE}, headers={"Origin": origin})
        error(r, 403, "cross_origin")
    error(httpx.post(base + "/api/session", content=b"passcode", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    q = held_booking(base, "lantern-led", *window(3))
    error(httpx.post(f"{base}/api/bookings/{q['ref']}/certificate", json={"file": "x"}, headers=renter(q["key"])), 415, "unsupported_media_type")
    error(upload_cert(base, q, pdf(q["ref"], FILE_LIMIT_BYTES + 1)), 413, "too_large")
    assert read(q)["certificate"] is None
    exact = pdf(q["ref"], FILE_LIMIT_BYTES)
    r = upload_cert(base, q, exact)
    assert r.status_code == 201 and r.json()["certificate"]["sizeBytes"] == FILE_LIMIT_BYTES, r.text[:300]
    for path in ["/.env", "/package.json", "/run.json"]:
        assert httpx.get(base + path).status_code == 404, f"{path} must answer 404"
    for url in (payments_down_url, storage_down_url):
        page_r = httpx.get(url + "/", timeout=HTTP_TIMEOUT_S)
        assert page_r.status_code == 200 and not page_r.headers["content-type"].startswith("application/json")
    secrets_ = [OWNER_PASSCODE, PREP_PASSCODE] + [
        os.environ[n] for n in ["KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY",
                                "S3_ACCESS_KEY_ID", "DATABASE_URL"] if len(os.environ.get(n, "")) >= 8]
    served: set[str] = set()
    with ui(browser, base, "/") as page:
        for path in ["/", "/desk", f"/bookings/{q['ref']}?key={q['key']}", "/kits/kestrel-lf"]:
            page.goto(base + path)
            page.wait_for_load_state("networkidle")
            served.update(page.evaluate("performance.getEntriesByType('resource').map(e => e.name)"))
            served.add(page.url)
        missing = page.goto(base + f"/no-such-page-{uuid.uuid4().hex[:6]}")
        assert missing is not None and missing.status == 404
        expect(page.get_by_role("heading", name="We couldn't find that page")).to_be_visible()
        hrefs = page.get_by_role("link").evaluate_all("ls => ls.map(l => new URL(l.href).pathname)")
        assert "/" in hrefs, "the not-found page links back to the catalogue"
    for url in served:
        if not same_origin(url, base):
            continue
        body = httpx.get(url, timeout=HTTP_TIMEOUT_S).text
        for value in secrets_:
            assert value not in body, f"{url} serves a credential or passcode"


def test_reduced_motion(browser: Browser, base: str) -> None:
    pickup, _ = window(3, weekday=4)
    with ui(browser, base, f"/kits/kestrel-lf?pickup={pickup}&return={plus(pickup, 3)}", reduced=True, live=False) as page:
        strip = page.get_by_role("list", name="Hire days")
        slider = page.get_by_role("slider", name="Return day")
        weekend = price(base, "kestrel-lf", pickup, plus(pickup, 3))
        until(page, "(t) => document.body.textContent.includes(t)", hire_total(weekend["hirePriceCents"], 1))
        assert strip_texts(strip) == ["weekend · 1 day"]
        slider.focus()
        page.keyboard.press("ArrowRight")
        fold = price(base, "kestrel-lf", pickup, plus(pickup, 4))
        expected = hire_total(fold["hirePriceCents"], fold["billableDays"])
        wait_for_count(page, cell(strip, "free"), 1)
        assert page.evaluate(MOVING_ANIMATIONS) == 0, "no animation runs as the strip folds"
        band, bill = box(cell(strip, "free")), box(cell(strip, "1 Fri"))
        assert abs(band["width"] - bill["width"]) <= FOLD_TOLERANCE_PX, "the band is folded straight away"
        until(page, "(t) => document.body.textContent.includes(t)", expected)
        assert page.evaluate(MOVING_ANIMATIONS) == 0
        assert strip_matches(strip_texts(strip), strip_expected(fold["days"]))
        expect(page.get_by_role("status", name="Hire total")).to_have_text(expected)
        expect(page.get_by_text(billable_label(fold["billableDays"]), exact=True).first).to_be_visible()
        band, bill = box(cell(strip, "free")), box(cell(strip, "1 Fri"))
        assert abs(band["width"] - bill["width"]) <= FOLD_TOLERANCE_PX, "the band is folded straight away"


def test_touch_targets_and_contrast(browser: Browser, base: str) -> None:
    pickup, ret = window(3, weekday=1)
    b = held_booking(base, "lantern-led", pickup, ret)
    for path in [f"/?pickup={pickup}&return={ret}", f"/kits/lantern-led?pickup={pickup}&return={ret}",
                 f"/bookings/{b['ref']}?key={b['key']}", "/desk"]:
        with ui(browser, base, path, size=PHONE) as page:
            expect(page.get_by_role("link").or_(page.get_by_role("button")).first).to_be_visible()
            contrast_audit(page)
            for role in ["button", "link", "textbox", "slider"]:
                for control in page.get_by_role(role).all():
                    if not control.is_visible():
                        continue
                    b_ = control.bounding_box()
                    assert b_ and b_["width"] >= TARGET_PX - 0.5 and b_["height"] >= TARGET_PX - 0.5, (
                        f"{path}: {role} {control.get_attribute('aria-label') or control.inner_text()[:40]!r} is {b_}")


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ["install", "build", "serve"]:
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices, f"{package.name} missing from THIRD_PARTY_NOTICES.md"
        assert str(package.version) in notices, f"{package.name} {package.version} version missing"
    for name in ["Big Shoulders Display", "IBM Plex Sans", "Lucide"]:
        assert name in notices


def test_if_licences() -> None:
    for package in shipped_packages():
        assert licence_allowed(declared_licence(package), ALLOWLIST), f"{package.name} is {package.licence}"
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert re.search(r"OFL|Open Font Licen[cs]e", notices, re.I) and "ISC" in notices


def test_if_no_extra_datastore() -> None:
    assert Postgres().tables(), "the app keeps its records in the provided Postgres"
    assert not [p.name for p in shipped_packages() if SQLITE in p.name.lower()]
    found = []
    for root, dirs, files in os.walk("/app"):
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".git"}]
        found += [os.path.join(root, f) for f in files if SQLITE in f.lower()]
    assert not found, f"file-based database present: {found}"


def test_if_same_origin_assets(browser: Browser, base: str) -> None:
    requested: list[str] = []
    with open_app(browser, base + "/api/health") as page:
        page.on("request", lambda req: requested.append(req.url))
        for path in ["/", "/kits/kestrel-lf", "/desk"]:
            page.goto(base + path)
            page.wait_for_load_state("networkidle")
    foreign = [u for u in requested if u.startswith("http") and not same_origin(u, base)]
    assert not foreign, f"third-party requests at run time: {foreign}"


def test_if_service_config_untouched(killbill: Any, mail: Any) -> None:
    assert killbill.account_by_key(f"probe-{uuid.uuid4().hex}@example.test") is None
    S3().keys("certificates/")
    mail.messages(settle=0)
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return
    compose = re.compile(r"(^|/)(docker-)?compose[^/]*\.ya?ml$")
    writes: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            target = node.get("file_path") or node.get("path")
            if isinstance(target, str) and compose.search(target) and any(k in node for k in ("content", "new_string", "edits")):
                writes.append(target)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(json.loads(trajectory.read_text()))
    assert not writes, f"compose files were modified: {writes}"
