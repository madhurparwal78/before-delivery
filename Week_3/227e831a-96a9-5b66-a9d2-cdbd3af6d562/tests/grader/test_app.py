from __future__ import annotations

import json
import os
import re
import struct
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    S3,
    advance,
    check,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    select,
    shipped_packages,
    tab_order,
    tap,
    unique,
)

PASSPHRASE = "switchback-ridge-47"
GOAL_GRAMS = 4500
OZ_GRAMS = Decimal("28.349523125")
LB_GRAMS = Decimal("453.59237")
KG_GRAMS = Decimal("1000")
LB_OZ = Decimal("16.0")
TENTH = Decimal("0.1")
CATEGORIES = ["Shelter", "Sleep", "Pack", "Kitchen", "Water", "Clothing", "Electronics", "Essentials", "Hygiene", "Food"]
NAME_MAX = 80
NOTES_MAX = 1000
UNITS_MAX = 99
WEIGHT_MAX_G = 50000
DISPLAY_NAME_MAX = 60
JSON_LIMIT = 100000
PHOTO_LIMIT = 5000000
CSV_LIMIT = 1000000
ROW_LIMIT = 2000
SYNC_MAX_OPS = 200
TOKEN_MIN_CHARS = 22
FORGED_BODY_BYTES = 2000000
STRATA_H_WIDE = 480
STRATA_H_PHONE = 360
STRATA_CAP = Decimal("1.25")
SEQUENCE_MAX_MS = 1200
REDUCED_MAX_MS = 100
TOUCH_MIN_PX = 44
TWO_MINUTES_MS = 120000
SHEET_SECONDS = 15
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
JUST_BELOW_TABLET = {"width": 767, "height": 1024}
JUST_BELOW_DESKTOP = {"width": 1199, "height": 800}
DESKTOP_EDGE = {"width": 1200, "height": 800}
LETTER_IN = (Decimal("8.5"), Decimal("11"))
A4_MM = (Decimal("210"), Decimal("297"))
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"
REQUIRED_COLUMNS = ["Item Name", "Category", "weight", "unit"]

HTTP_TIMEOUT = 60
POLL_SECONDS = 25
SHORT_MS = 1500
TICK_MS = 100
IDLE_STEP_MS = 1000
SAMPLE_MS = 40
PX_TOLERANCE = 2
PT_PER_IN = Decimal("72")
MM_PER_IN = Decimal("25.4")
PT_TOLERANCE = 2
CONCURRENCY = 5
EIGHT_MOVES = 8
MINIO_DOWN_ENV = "APP_MINIO_DOWN_URL"
GOTENBERG_DOWN_ENV = "APP_GOTENBERG_DOWN_URL"
NOTE_MULTILINE = "line one\nline two"
PRICE_TEXT = "$12.50"
PRICE_CENTS = int(Decimal(PRICE_TEXT.lstrip("$")) * 100)
NO_ROUTE = "/api/no-such-route-here"
REWEIGH_INPUT = "600"


def skip_idle(page: Page, milliseconds: float) -> None:
    remaining = round(milliseconds)
    while remaining > 0:
        step = min(IDLE_STEP_MS, remaining)
        page.clock.run_for(step)
        remaining -= step


def root(url: str) -> str:
    return url.rstrip("/")


def outage_url(var: str) -> str:
    url = os.environ.get(var)
    assert url, f"{var} is not set; the outage instance is required"
    return root(url)


def fresh(prefix: str = "t") -> str:
    tok = re.sub(r"[^A-Za-z0-9]+", "-", unique(prefix)[0]).strip("-")
    return tok[:48]


def norm(s: str | None) -> str:
    return " ".join((s or "").split())


def half_up(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_grams(written: str, unit: str) -> int:
    factor = {"g": Decimal(1), "oz": OZ_GRAMS, "lb": LB_GRAMS, "kg": KG_GRAMS}[unit]
    return half_up(Decimal(written) * factor)


def fmt(grams: int, unit: str = "g") -> str:
    if unit == "g":
        return f"{grams} g"
    oz = (Decimal(grams) / OZ_GRAMS).quantize(TENTH, rounding=ROUND_HALF_UP)
    if unit == "oz":
        return f"{oz} oz"
    pounds = int(oz // LB_OZ)
    rest = (oz - LB_OZ * pounds).quantize(TENTH)
    return f"{pounds} lb {rest} oz"


def delta_text(base: int, goal: int, unit: str = "g") -> str:
    if base <= goal:
        return f"{fmt(goal - base, unit)} under goal"
    return f"{fmt(base - goal, unit)} over goal"


def share_pct(part: int, whole: int) -> int:
    return half_up(Decimal(part) * 100 / Decimal(whole))


def band_px(grams: int, h: int, goal: int) -> int:
    return half_up(Decimal(grams) * h / Decimal(goal))


def fullwidth(s: str) -> str:
    return "".join(chr(ord(ch) + 0xFEE0) if 0x21 <= ord(ch) <= 0x7E else ch for ch in s)


def png_bytes() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return PNG_MAGIC + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00\x30\x60\x30")) + chunk(b"IEND", b"")


def csv_field(v: str) -> str:
    if any(ch in v for ch in ',"\r\n'):
        return '"' + v.replace('"', '""') + '"'
    return v


def csv_bytes(header: list[str], rows: list[list[str]], eol: str = "\n") -> bytes:
    lines = [",".join(csv_field(h) for h in header)] + [",".join(csv_field(v) for v in r) for r in rows]
    return (eol.join(lines) + eol).encode("utf-8")


def hiker(base: str) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    r = c.post("/api/session", json={"passphrase": PASSPHRASE})
    assert r.status_code == 204, f"POST /api/session answered {r.status_code} {r.text[:300]}; expected 204"
    return c


def clone(c: httpx.Client) -> httpx.Client:
    return httpx.Client(base_url=c.base_url, cookies=c.cookies, timeout=HTTP_TIMEOUT)


def ok(r: httpx.Response, status: int) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} -> {r.status_code} {r.text[:500]}; expected {status}"
    return r.json() if r.content else {}


def err(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} -> {r.status_code} {r.text[:500]}; expected {status} {code}"
    body = r.json()
    assert set(body) == {"error"}, f"error body must be the single error shape, got {body}"
    e = body["error"]
    assert e["code"] == code, f"expected code {code}, got {e}"
    if message is not None:
        assert e["message"] == message, f"expected message {message!r}, got {e['message']!r}"
    return e


def field_err(r: httpx.Response, field: str, message: str) -> dict:
    e = err(r, 422, "validation_failed")
    assert e.get("fields", {}).get(field) == message, f"expected field {field}: {message!r}, got {e.get('fields')}"
    return e


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls), timeout=HTTP_TIMEOUT)

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def closet(c: httpx.Client) -> list[dict]:
    return ok(c.get("/api/closet"), 200)["items"]


def get_item(c: httpx.Client, iid: Any) -> dict | None:
    return next((it for it in closet(c) if it["id"] == iid), None)


def items_named(c: httpx.Client, name: str) -> list[dict]:
    return [it for it in closet(c) if it["name"] == name]


def add_item(c: httpx.Client, category: str = "Shelter", grams: int = 100, units: int = 1, prefix: str = "gear",
             name: str | None = None, **extra: Any) -> dict:
    body = {"name": name or fresh(prefix), "category": category, "weight": {"value": grams, "unit": "g"},
            "unitsOwned": units, **extra}
    return ok(c.post("/api/closet", json=body), 201)["item"]


def patch_item(c: httpx.Client, iid: Any, body: dict, version: int | None = None) -> httpx.Response:
    v = version if version is not None else get_item(c, iid)["version"]
    return c.patch(f"/api/closet/{iid}", json=body, headers={"If-Match": f'"{v}"'})


def retire(c: httpx.Client, iid: Any, units: int, reason: str = "retired", key: str | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key else {}
    return c.post(f"/api/closet/{iid}/retire", json={"units": units, "reason": reason}, headers=headers)


def add_list(c: httpx.Client, prefix: str = "trip") -> dict:
    return ok(c.post("/api/lists", json={"name": fresh(prefix)}), 201)["list"]


def get_list(c: httpx.Client, lid: Any) -> dict:
    return ok(c.get(f"/api/lists/{lid}"), 200)["list"]


def pack(c: httpx.Client, lid: Any, iid: Any, quantity: int = 1, mode: str = "base") -> dict:
    return ok(c.post(f"/api/lists/{lid}/lines", json={"itemId": iid, "quantity": quantity, "mode": mode}), 201)["list"]


def line_for(lst: dict, iid: Any) -> dict | None:
    return next((ln for ln in lst["lines"] if ln["itemId"] == iid), None)


def set_line(c: httpx.Client, lid: Any, line_id: Any, **body: Any) -> httpx.Response:
    return c.patch(f"/api/lists/{lid}/lines/{line_id}", json=body)


def set_state(c: httpx.Client, lid: Any, to: str) -> httpx.Response:
    return c.post(f"/api/lists/{lid}/state", json={"to": to})


def sync(c: httpx.Client, ops: list[dict]) -> httpx.Response:
    return c.post("/api/sync", json={"ops": ops})


def upload_csv(c: httpx.Client, data: bytes, filename: str | None = None) -> httpx.Response:
    return c.post("/api/imports", files={"file": (filename or f"{fresh('gear')}.csv", data, "text/csv")})


def imports_named(c: httpx.Client, filename: str) -> list[dict]:
    return [i for i in ok(c.get("/api/imports"), 200)["imports"] if i["filename"] == filename]


def probe_id(real: Any) -> Any:
    if isinstance(real, int):
        return 2**31 - 7
    if str(real).isdigit():
        return str(int(str(real)) + 10**9)
    s = str(real)
    if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", s):
        return "ffffffff-ffff-4fff-bfff-fffffffffff0"
    return s[:-1] + ("a" if s[-1] != "a" else "b")


@contextmanager
def profile_as(c: httpx.Client, **fields: Any) -> Iterator[dict]:
    before = ok(c.get("/api/profile"), 200)["profile"]
    after = ok(c.patch("/api/profile", json=fields), 200)["profile"]
    try:
        yield after
    finally:
        c.patch("/api/profile", json={"displayName": before["displayName"], "unit": before["unit"],
                                      "goal": {"value": before["goalGrams"], "unit": "g"},
                                      "timeZone": before["timeZone"], "paperSize": before["paperSize"]})


def grams_profile(c: httpx.Client, **more: Any):
    return profile_as(c, unit="g", goal={"value": GOAL_GRAMS, "unit": "g"}, **more)


def today_for_share(c: httpx.Client, lid: Any) -> date:
    lo, hi = date(2000, 1, 1), date(2100, 1, 1)
    for _ in range(20):
        if lo >= hi:
            break
        mid = lo + (hi - lo) // 2
        r = c.post(f"/api/lists/{lid}/share", json={"expiresOn": mid.isoformat()})
        if r.status_code == 201:
            hi = mid
        else:
            field_err(r, "expiresOn", "Choose today or a later date.")
            lo = mid + timedelta(days=1)
    c.delete(f"/api/lists/{lid}/share")
    return lo


@contextmanager
def signed_in(browser: Browser, base: str, path: str, client: httpx.Client | None = None,
              viewport: dict | None = None, reduced_motion: str = "no-preference") -> Iterator[Page]:
    c = client or hiker(base)
    with open_app(browser, base + "/api/health", reduced_motion=reduced_motion) as page:
        page.set_viewport_size(viewport or DESKTOP)
        page.context.add_cookies([{"name": k.name, "value": k.value, "url": base} for k in c.cookies.jar])
        page.goto(base + path)
        yield page


def eventually(page: Page, check_fn: Callable[[], bool], what: str, seconds: float = POLL_SECONDS,
               tick: float = TICK_MS) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check_fn():
                return
        except (PlaywrightError, AssertionError, httpx.HTTPError, KeyError, StopIteration, TypeError) as exc:
            last = exc
        if tick:
            advance(page, tick)
    pytest.fail(f"{what} (last error: {last})")


def text(loc: Locator) -> str:
    return norm(loc.inner_text(timeout=SHORT_MS))


def focused(loc: Locator) -> bool:
    return loc.count() == 1 and loc.evaluate("e => e === document.activeElement")


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def see(page: Page, loc: Locator, expected: str, what: str, seconds: float = POLL_SECONDS) -> None:
    eventually(page, lambda: text(loc) == expected, f"{what}: expected {expected!r}", seconds)


def see_focus(page: Page, loc: Locator, what: str) -> None:
    eventually(page, lambda: focused(loc), f"focus expected on {what}")


def btn(scope: Page | Locator, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def heading1(page: Page, name: str) -> Locator:
    return page.get_by_role("heading", name=name, level=1, exact=True)


def open_workspace(page: Page, lst: dict) -> None:
    eventually(page, lambda: heading1(page, lst["name"]).count() == 1, f"workspace heading {lst['name']}")


def spin(page: Page, name: str) -> Locator:
    return page.get_by_role("spinbutton", name=f"Quantity of {name}", exact=True)


def mode_radio(page: Page, name: str, mode: str) -> Locator:
    return page.get_by_role("radiogroup", name=f"Carry mode for {name}", exact=True).get_by_role("radio", name=mode, exact=True)


def totals_text(page: Page) -> str:
    return text(page.get_by_role("region", name="Pack totals", exact=True))


def strata_list(page: Page) -> Locator:
    return page.get_by_role("list", name="Base weight by category", exact=True)


def band(page: Page, category: str) -> Locator:
    return strata_list(page).get_by_role("listitem", name=re.compile("^" + re.escape(category) + ": "))


def ledger_row(page: Page, table: str, name: str) -> Locator:
    return page.get_by_role("table", name=table, exact=True).get_by_role("row").filter(has_text=name)


def box(loc: Locator) -> dict:
    b = loc.bounding_box(timeout=SHORT_MS)
    assert b is not None, "element has no box"
    return b


def server_line(c: httpx.Client, lid: Any, iid: Any) -> dict | None:
    return line_for(get_list(c, lid), iid)


def watch_body_focus(page: Page) -> None:
    page.evaluate("""() => {
        window.__bodyFocus = 0;
        const frame = () => {
            if (document.activeElement === document.body || document.activeElement === null) window.__bodyFocus++;
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }""")


def body_focus_count(page: Page) -> int:
    return page.evaluate("() => window.__bodyFocus")


def mark_page(page: Page) -> None:
    page.evaluate("() => { window.__noReload = 'kept'; }")


def not_reloaded(page: Page) -> bool:
    return page.evaluate("() => window.__noReload === 'kept'")


def trips_row(page: Page, list_name: str) -> Locator:
    link = page.get_by_role("link", name=list_name, exact=True)
    rows = page.get_by_role("row").filter(has=link)
    return rows if rows.count() else page.get_by_role("listitem").filter(has=link)


def test_wf_cross_cutting_health(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    with open_app(browser, base + "/sign-in") as page:
        eventually(page, lambda: page.get_by_role("textbox", name="Passphrase", exact=True).count() == 1
                   and btn(page, "Sign in").count() == 1, "sign-in screen with Passphrase and Sign in")


def test_wf_cross_cutting_sign_in(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, follow_redirects=False)
    r = anon.get("/trips")
    assert r.status_code == 302 and urlparse(r.headers["location"]).path == "/sign-in"
    for path in ["/api/closet", "/api/lists", "/api/profile", "/api/imports"]:
        err(anon.get(path), 401, "unauthenticated", "Sign in to continue.")
    assert anon.get("/api/health").status_code == 200
    err(anon.get("/api/share/" + "q" * TOKEN_MIN_CHARS), 404, "share_not_found")
    err(anon.post("/api/session", json={"passphrase": "not-the-passphrase"}), 401, "invalid_passphrase")
    with open_app(browser, base + "/sign-in") as page:
        page.set_viewport_size(DESKTOP)
        field = page.get_by_role("textbox", name="Passphrase", exact=True)
        eventually(page, lambda: field.count() == 1, "Passphrase field")
        fill(field, "wrong-passphrase")
        click(btn(page, "Sign in"))
        eventually(page, lambda: page.get_by_text("That passphrase didn't match.", exact=True).count() == 1,
                   "sign-in refusal copy")
        fill(field, PASSPHRASE)
        click(btn(page, "Sign in"))
        eventually(page, lambda: btn(page, "Sign out").count() == 1, "signed-in header with Sign out")
        for link in ["Closet", "Trips", "Imports", "Settings"]:
            assert page.get_by_role("link", name=link, exact=True).count() == 1, f"header link {link}"
        click(page.get_by_role("link", name="Trips", exact=True))
        eventually(page, lambda: heading1(page, "Trips").count() == 1, "Trips heading")
        jar = {ck["name"]: ck["value"] for ck in page.context.cookies()}
        tab = httpx.Client(base_url=base, cookies=jar, timeout=HTTP_TIMEOUT)
        ok(tab.get("/api/profile"), 200)
        click(btn(page, "Sign out"))
        eventually(page, lambda: tab.get("/api/profile").status_code == 401, "sign-out ends the server session")
    err(tab.get("/api/closet"), 401, "unauthenticated", "Sign in to continue.")


def test_error_shape_and_routes(app_url: str) -> None:
    c = hiker(root(app_url))
    err(c.get(NO_ROUTE), 404, "not_found")
    r = c.post("/api/lists", content=b"name=x", headers={"Content-Type": "text/plain"})
    err(r, 415, "unsupported_media_type")
    e = field_err(c.post("/api/lists", json={"name": ""}), "name", "Enter a list name of up to 80 characters.")
    assert set(e) == {"code", "message", "fields"}


def test_body_limits(app_url: str) -> None:
    c = hiker(root(app_url))
    pad = JSON_LIMIT - len('{"name":""}')
    at_limit = ('{"name":"' + "x" * pad + '"}').encode()
    assert len(at_limit) == JSON_LIMIT
    r = c.post("/api/lists", content=at_limit, headers={"Content-Type": "application/json"})
    field_err(r, "name", "Enter a list name of up to 80 characters.")
    over = ('{"name":"' + "x" * (pad + 1) + '"}').encode()
    err(c.post("/api/lists", content=over, headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    item = add_item(c)
    photo = PNG_MAGIC + b"\x00" * (PHOTO_LIMIT - len(PNG_MAGIC))
    ok(c.post(f"/api/closet/{item['id']}/photo", files={"photo": ("big.png", photo, "image/png")}), 201)
    err(c.post(f"/api/closet/{item['id']}/photo", files={"photo": ("big.png", photo + b"\x00", "image/png")}),
        413, "payload_too_large")
    head = b"Item Name,Category,weight,unit,desc\n"
    row_start = f"{fresh('pad')},Food,1,g,".encode()
    filler = CSV_LIMIT - len(head) - len(row_start) - 1
    csv_at = head + row_start + b"a" * filler + b"\n"
    assert len(csv_at) == CSV_LIMIT
    ok(upload_csv(c, csv_at), 201)
    err(upload_csv(c, csv_at + b"a"), 413, "payload_too_large")


def test_never_serves_source_or_credentials(app_url: str) -> None:
    base = root(app_url)
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    for path in ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json",
                 "/src/server.ts", "/server/index.ts", "/src/index.ts"]:
        assert anon.get(path).status_code == 404, f"{path} must answer 404"
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "GOTENBERG_URL", "S3_ENDPOINT")]
    secrets = [s for s in secrets if len(s) >= 6]
    html = anon.get("/sign-in").text
    bodies = [html] + [anon.get(urljoin_path(src)).text for src in re.findall(r'src="([^"]+)"', html) if src.startswith("/")]
    bodies.append(anon.get("/api/closet").text)
    bodies.append(anon.get(NO_ROUTE).text)
    for body in bodies:
        for s in secrets:
            assert s not in body, "a served page, script or error carries a service credential or URL"
    r = anon.get("/api/health", headers={"Origin": "https://elsewhere.example"})
    assert "Access-Control-Allow-Origin".lower() not in {k.lower() for k in r.headers}


def urljoin_path(src: str) -> str:
    return src.split("#")[0]


def test_upload_type_by_content(app_url: str) -> None:
    c = hiker(root(app_url))
    store = S3()
    item = add_item(c)
    iid = item["id"]
    png = png_bytes()
    r = c.post(f"/api/closet/{iid}/photo", files={"photo": ("tarp.jpg", png, "image/jpeg")})
    photo = ok(r, 201)["photo"]
    assert photo["status"] == "ready" and photo["url"] == f"/api/photos/{photo['id']}"
    got = c.get(photo["url"])
    assert got.status_code == 200 and got.headers["content-type"].startswith("image/png")
    assert got.headers.get("x-content-type-options", "").lower() == "nosniff"
    assert got.content == png
    assert store.keys(f"photos/{iid}/") == [f"photos/{iid}/{photo['id']}.png"]
    rejects = {
        "x.svg": b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
        "x.html": b"<!doctype html><p>hi</p>",
        "x.gif": b"GIF89a\x01\x00\x01\x00",
        "x.png": b"",
    }
    for fname, data in rejects.items():
        r = c.post(f"/api/closet/{iid}/photo", files={"photo": (fname, data, "image/png")})
        field_err(r, "photo", "Use a JPEG, PNG or WebP image.")
        assert store.keys(f"photos/{iid}/") == [f"photos/{iid}/{photo['id']}.png"], "a refused upload wrote an object"
        assert c.get(photo["url"]).content == png, "earlier photo must stay served"
    webp = b"RIFF" + struct.pack("<I", 12) + b"WEBPVP8 " + b"\x00" * 8
    r = c.post(f"/api/closet/{iid}/photo", files={"photo": ("pad.png", webp, "image/png")})
    second = ok(r, 201)["photo"]
    assert c.get(second["url"]).headers["content-type"].startswith("image/webp")
    assert store.keys(f"photos/{iid}/") == [f"photos/{iid}/{second['id']}.webp"], "previous photo object must be deleted"
    err(c.get(photo["url"]), 404, "photo_not_found")
    jpeg = JPEG_MAGIC + b"\xe0" + b"\x00" * 16
    third = ok(c.post(f"/api/closet/{iid}/photo", files={"photo": ("pad.webp", jpeg, "image/webp")}), 201)["photo"]
    assert c.get(third["url"]).headers["content-type"].startswith("image/jpeg")
    assert store.keys(f"photos/{iid}/") == [f"photos/{iid}/{third['id']}.jpg"]


def test_cross_site_writes_refused(app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c, units=2)
    iid = item["id"]
    forged = [{"Origin": "https://forger.example"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}]
    msg = "This request did not come from Skinout."
    for h in forged:
        err(c.post(f"/api/closet/{iid}/retire", json={"units": 1, "reason": "sold"}, headers=h), 403, "cross_site_request", msg)
        err(c.delete(f"/api/closet/{iid}", headers=h), 403, "cross_site_request", msg)
        err(c.patch("/api/profile", json={"displayName": "Forged"}, headers=h), 403, "cross_site_request", msg)
        err(c.post(f"/api/closet/{probe_id(iid)}/retire", json={"units": 1, "reason": "sold"}, headers=h), 403, "cross_site_request")
        err(c.post(f"/api/closet/{iid}/retire", json={"units": "lots"}, headers=h), 403, "cross_site_request")
        anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        err(anon.post("/api/lists", json={"name": "x"}, headers=h), 403, "cross_site_request")
        err(anon.post("/api/session", json={"passphrase": PASSPHRASE}, headers=h), 403, "cross_site_request")
        err(c.delete("/api/session", headers=h), 403, "cross_site_request")
    after = get_item(c, iid)
    assert after is not None and after["unitsOwned"] == 2 and after["version"] == item["version"]
    ok(c.get("/api/profile"), 200)
    big = b'{"name":"' + b"x" * FORGED_BODY_BYTES + b'"}'
    err(c.post("/api/lists", content=big, headers={"Content-Type": "application/json", "Origin": "https://forger.example"}),
        413, "payload_too_large")
    own = urlparse(base)
    same = f"{own.scheme}://{own.netloc}"
    ok(c.post(f"/api/closet/{iid}/retire", json={"units": 1, "reason": "sold"}, headers={"Origin": same}), 200)
    r = httpx.post(base + "/api/session", json={"passphrase": PASSPHRASE}, timeout=HTTP_TIMEOUT)
    cookie = r.headers.get("set-cookie", "").lower()
    assert "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie, f"session cookie attributes: {cookie}"
    assert "Access-Control-Allow-Origin".lower() not in {k.lower() for k in r.headers}


def test_wf_closet_keeping_add_gear(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        shelter = add_item(c, category="Shelter", grams=482)
        food = add_item(c, category="Food", grams=180)
        gone = add_item(c, category="Kitchen", grams=200)
        ok(retire(c, gone["id"], 1), 200)
        name = fresh("stove")
        with signed_in(browser, base, "/closet", client=c) as page:
            eventually(page, lambda: heading1(page, "Closet").count() == 1, "Closet heading")
            click(btn(page, "Add gear"))
            dialog = page.get_by_role("dialog", name="Add gear", exact=True)
            eventually(page, lambda: dialog.count() == 1, "Add gear dialog")
            fill(dialog.get_by_role("textbox", name="Name", exact=True), name)
            select(dialog.get_by_role("combobox", name="Category", exact=True), "Kitchen")
            check(dialog.get_by_role("radiogroup", name="Weight unit", exact=True).get_by_role("radio", name="oz", exact=True))
            fill(dialog.get_by_role("spinbutton", name="Weight", exact=True), "3.75")
            fill(dialog.get_by_role("spinbutton", name="Units owned", exact=True), "2")
            click(btn(dialog, "Save gear"))
            see(page, status(page, "Closet updates"), f"Saved {name}.", "save announcement")
            grams = to_grams("3.75", "oz")
            row = ledger_row(page, "Closet ledger", name)
            eventually(page, lambda: row.count() == 1 and fmt(grams) in text(row) and "Packed in 0 / owned 2" in text(row)
                       and "Kitchen" in text(row), "new ledger row with grams, category and packed-in text")
            for action in [f"Edit {name}", f"Retire {name}", f"Add photo for {name}"]:
                assert btn(row, action).count() == 1, f"row action {action}"
            ys = [box(ledger_row(page, "Closet ledger", n))["y"] for n in (shelter["name"], name, food["name"])]
            assert ys == sorted(ys), "ledger rows must follow category order Shelter, Kitchen, Food"
            assert ledger_row(page, "Closet ledger", gone["name"]).count() == 0
            assert page.get_by_role("heading", name="Retired gear", exact=True).count() == 1
            retired = ledger_row(page, "Retired gear", gone["name"])
            assert retired.count() == 1 and btn(retired, f"Delete {gone['name']}").count() == 1
            assert btn(retired, f"Retire {gone['name']}").count() == 0
            assert page.get_by_role("img", name=f"Photo of {name}", exact=True).count() == 0
    made = items_named(c, name)
    assert len(made) == 1 and made[0]["weightGrams"] == grams and made[0]["unitsOwned"] == 2 and made[0]["version"] == 1


def test_wf_closet_keeping_photo(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c)
    name, iid = item["name"], item["id"]
    png = png_bytes()
    with signed_in(browser, base, "/closet", client=c) as page:
        row = ledger_row(page, "Closet ledger", name)
        eventually(page, lambda: row.count() == 1, "ledger row")
        with held(page, f"**/api/closet/{iid}/photo") as hold:
            with page.expect_file_chooser() as chooser:
                click(btn(row, f"Add photo for {name}"))
            chooser.value.set_files({"name": "tarp.jpg", "mimeType": "image/jpeg", "buffer": png})
            see(page, status(page, "Closet updates"), "Uploading photo...", "photo pending copy")
            assert page.get_by_role("img", name=f"Photo of {name}", exact=True).count() == 0, "thumbnail before server confirmed"
            assert S3().keys(f"photos/{iid}/") == []
            hold.release()
        see(page, status(page, "Closet updates"), "Photo ready.", "photo ready copy")
        img = page.get_by_role("img", name=f"Photo of {name}", exact=True)
        eventually(page, lambda: img.count() == 1 and img.evaluate("i => i.complete && i.naturalWidth > 0"), "thumbnail rendered")
    after = get_item(c, iid)
    assert after["photo"]["status"] == "ready" and after["version"] == item["version"] + 1
    key = f"photos/{iid}/{after['photo']['id']}.png"
    assert S3().keys(f"photos/{iid}/") == [key]
    assert S3().get(key) == png


def test_wf_closet_keeping_empty(browser: Browser) -> None:
    base = outage_url(GOTENBERG_DOWN_ENV)
    c = hiker(base)
    for it in closet(c):
        if it["status"] == "active":
            ok(retire(c, it["id"], it["unitsOwned"]), 200)
    assert all(it["status"] == "retired" for it in closet(c))
    with signed_in(browser, base, "/closet", client=c) as page:
        copy = page.get_by_text("Your closet is empty. Add your first piece of gear or import a gear list.", exact=True)
        eventually(page, lambda: copy.count() == 1, "empty-closet copy")
        assert btn(page, "Add gear").count() == 1
        assert page.get_by_role("table", name="Closet ledger", exact=True).count() == 0
        click(btn(page, "Import gear list"))
        eventually(page, lambda: urlparse(page.url).path == "/imports"
                   and page.get_by_role("dialog", name="Import gear list", exact=True).count() == 1,
                   "Import gear list goes to Imports with its dialog open")


GEAR_CASES = ["name_blank", "name_too_long", "category_case", "weight_over", "weight_fraction_grams",
              "weight_three_decimals_oz", "weight_negative", "units_zero", "units_over", "price_negative",
              "notes_too_long", "edges_allowed", "duplicate_normalised", "duplicate_retired", "edit_validates",
              "units_only_raise"]


@pytest.mark.parametrize("case", GEAR_CASES, ids=GEAR_CASES)
def test_gear_validation(app_url: str, case: str) -> None:
    c = hiker(root(app_url))
    name = fresh("gear")
    good = {"name": name, "category": "Shelter", "weight": {"value": 100, "unit": "g"}, "unitsOwned": 1}
    weight_msg = "Enter a weight from 0 to 50000 g."
    bad = {
        "name_blank": ({"name": "   "}, "name", "Enter a name."),
        "name_too_long": ({"name": name + "x" * (NAME_MAX + 1 - len(name))}, "name", "Enter a name."),
        "category_case": ({"category": "shelter"}, "category", "Choose a category."),
        "weight_over": ({"weight": {"value": WEIGHT_MAX_G + 1, "unit": "g"}}, "weight", weight_msg),
        "weight_fraction_grams": ({"weight": {"value": 1.5, "unit": "g"}}, "weight", weight_msg),
        "weight_three_decimals_oz": ({"weight": {"value": 1.125, "unit": "oz"}}, "weight", weight_msg),
        "weight_negative": ({"weight": {"value": -1, "unit": "g"}}, "weight", weight_msg),
        "units_zero": ({"unitsOwned": 0}, "unitsOwned", "Enter whole units from 1 to 99."),
        "units_over": ({"unitsOwned": UNITS_MAX + 1}, "unitsOwned", "Enter whole units from 1 to 99."),
        "price_negative": ({"priceCents": -1}, "priceCents", "Enter a price of 0 or more."),
        "notes_too_long": ({"notes": "n" * (NOTES_MAX + 1)}, "notes", "Notes can be at most 1000 characters."),
    }
    if case in bad:
        override, field, message = bad[case]
        field_err(c.post("/api/closet", json={**good, **override}), field, message)
        assert not [it for it in closet(c) if it["name"].startswith(name)], "a refused add wrote an item"
    elif case == "edges_allowed":
        long_name = name + "x" * (NAME_MAX - len(name))
        a = ok(c.post("/api/closet", json={**good, "name": long_name, "weight": {"value": 0, "unit": "g"},
                                           "unitsOwned": UNITS_MAX, "priceCents": 0, "notes": "n" * NOTES_MAX}), 201)["item"]
        assert a["weightGrams"] == 0 and a["unitsOwned"] == UNITS_MAX and a["version"] == 1
        b = ok(c.post("/api/closet", json={**good, "weight": {"value": WEIGHT_MAX_G, "unit": "g"}}), 201)["item"]
        assert b["weightGrams"] == WEIGHT_MAX_G and b["status"] == "active"
    elif case == "duplicate_normalised":
        first = add_item(c, name=f"{name} Big Tarp")
        variant = f"  {name.upper()}\u00a0big   TARP "
        err(c.post("/api/closet", json={**good, "name": variant}), 409, "item_exists")
        other = ok(c.post("/api/closet", json={**good, "name": variant, "category": "Sleep"}), 201)["item"]
        assert other["category"] == "Sleep" and len(items_named(c, first["name"])) == 1
    elif case == "duplicate_retired":
        first = add_item(c, name=name)
        ok(retire(c, first["id"], 1), 200)
        err(c.post("/api/closet", json=good), 409, "item_exists")
    elif case == "edit_validates":
        item = add_item(c, name=name)
        field_err(patch_item(c, item["id"], {"name": " "}), "name", "Enter a name.")
        field_err(patch_item(c, item["id"], {"category": "tent"}), "category", "Choose a category.")
        after = get_item(c, item["id"])
        assert after["name"] == name and after["category"] == "Shelter" and after["version"] == 1
    elif case == "units_only_raise":
        item = add_item(c, name=name, units=3)
        field_err(patch_item(c, item["id"], {"unitsOwned": 2}), "unitsOwned", "Use retire to reduce units owned.")
        assert get_item(c, item["id"])["unitsOwned"] == 3
        raised = ok(patch_item(c, item["id"], {"unitsOwned": 4}), 200)["item"]
        assert raised["unitsOwned"] == 4 and raised["version"] == 2


WEIGHT_CASES = ["oz_one_and_half", "oz_sixteen", "oz_hundredth", "oz_upper_edge", "oz_over_limit", "g_whole"]
WEIGHT_INPUTS = {
    "oz_one_and_half": ("1.5", "oz"),
    "oz_sixteen": ("16", "oz"),
    "oz_hundredth": ("0.01", "oz"),
    "oz_upper_edge": ("1763.70", "oz"),
    "oz_over_limit": ("1763.72", "oz"),
    "g_whole": ("482", "g"),
}


@pytest.mark.parametrize("case", WEIGHT_CASES, ids=WEIGHT_CASES)
def test_weight_conversion(app_url: str, case: str) -> None:
    c = hiker(root(app_url))
    written, unit = WEIGHT_INPUTS[case]
    expected = to_grams(written, unit)
    name = fresh("weigh")
    raw = f'{{"name":"{name}","category":"Shelter","weight":{{"value":{written},"unit":"{unit}"}},"unitsOwned":1}}'
    r = c.post("/api/closet", content=raw.encode(), headers={"Content-Type": "application/json"})
    if expected > WEIGHT_MAX_G:
        field_err(r, "weight", "Enter a weight from 0 to 50000 g.")
        assert items_named(c, name) == []
        return
    item = ok(r, 201)["item"]
    assert item["weightGrams"] == expected and isinstance(item["weightGrams"], int)
    base_item = add_item(c, grams=1)
    edit = f'{{"weight":{{"value":{written},"unit":"{unit}"}}}}'
    r = c.patch(f"/api/closet/{base_item['id']}", content=edit.encode(),
                headers={"Content-Type": "application/json", "If-Match": '"1"'})
    assert ok(r, 200)["item"]["weightGrams"] == expected


def test_photo_storage_outage(browser: Browser) -> None:
    base = outage_url(MINIO_DOWN_ENV)
    c = hiker(base)
    item = add_item(c)
    err(c.post(f"/api/closet/{item['id']}/photo", files={"photo": ("p.png", png_bytes(), "image/png")}), 503, "storage_unavailable")
    after = get_item(c, item["id"])
    assert after["photo"] is None and after["version"] == 1
    with signed_in(browser, base, "/closet", client=c) as page:
        row = ledger_row(page, "Closet ledger", item["name"])
        eventually(page, lambda: row.count() == 1, "ledger row")
        with page.expect_file_chooser() as chooser:
            click(btn(row, f"Add photo for {item['name']}"))
        chooser.value.set_files({"name": "p.png", "mimeType": "image/png", "buffer": png_bytes()})
        see(page, status(page, "Closet updates"), "Photo storage is unavailable. The item was saved without a new photo.",
            "photo outage copy")
        assert page.get_by_role("img", name=f"Photo of {item['name']}", exact=True).count() == 0
    assert get_item(c, item["id"])["photo"] is None


def test_packed_in_counts(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c, units=2)
    iid = item["id"]
    plan, packed, walked = add_list(c), add_list(c), add_list(c)
    pack(c, plan["id"], iid, quantity=2)
    pack(c, packed["id"], iid)
    ok(set_state(c, packed["id"], "packed"), 200)
    pack(c, walked["id"], iid)
    ok(set_state(c, walked["id"], "packed"), 200)
    ok(set_state(c, walked["id"], "walked"), 200)
    assert get_item(c, iid)["packedInLists"] == 2, "walked lists never count"
    ok(retire(c, iid, 1), 200)
    assert get_item(c, iid)["packedInLists"] == 1, "a Not in closet line no longer counts"
    via_sync = add_list(c)
    res = ok(sync(c, [{"opId": fresh("op"), "listId": via_sync["id"], "itemId": iid, "type": "pack"}]), 200)
    assert res["results"][0]["result"] == "applied"
    assert get_item(c, iid)["packedInLists"] == 2
    fresh_list = add_list(c)
    with signed_in(browser, base, "/closet", client=c) as page:
        row = ledger_row(page, "Closet ledger", item["name"])
        eventually(page, lambda: "Packed in 2 / owned 1" in text(row), "server packed-in count on Closet")
        mark_page(page)
        click(page.get_by_role("link", name="Trips", exact=True))
        click(page.get_by_role("link", name=fresh_list["name"], exact=True))
        open_workspace(page, fresh_list)
        click(btn(page, f"Pack {item['name']}"))
        eventually(page, lambda: server_line(c, fresh_list["id"], iid) is not None, "pack reached the server")
        click(page.get_by_role("link", name="Closet", exact=True))
        row = ledger_row(page, "Closet ledger", item["name"])
        eventually(page, lambda: "Packed in 3 / owned 1" in text(row), "Closet shows the new count after an in-page pack")
        assert not_reloaded(page), "Closet must update without a reload"
    assert get_item(c, iid)["packedInLists"] == 3


UNKNOWN_FIELD_CASES = ["closet_patch_weight_grams", "closet_post_status", "profile_goal_grams", "list_post_state",
                       "line_patch_unit_weight", "share_post_token", "retire_version", "state_post_name",
                       "sync_top_level", "retired_status_conflict"]


@pytest.mark.parametrize("case", UNKNOWN_FIELD_CASES, ids=UNKNOWN_FIELD_CASES)
def test_unknown_fields_refused(app_url: str, case: str) -> None:
    c = hiker(root(app_url))
    msg = "This field can't be set."

    def exactly(r: httpx.Response, fields: dict) -> None:
        e = err(r, 422, "validation_failed")
        assert e["fields"] == fields, f"expected only {fields}, got {e['fields']}"

    item = add_item(c, units=3, grams=100)
    if case == "closet_patch_weight_grams":
        exactly(patch_item(c, item["id"], {"weightGrams": 1}), {"weightGrams": msg})
        after = get_item(c, item["id"])
        assert after["weightGrams"] == 100 and after["version"] == 1
    elif case == "closet_post_status":
        name = fresh("mass")
        exactly(c.post("/api/closet", json={"name": name, "category": "Shelter", "weight": {"value": 1, "unit": "g"},
                                            "unitsOwned": 1, "status": "retired", "packedInLists": 4}),
                {"status": msg, "packedInLists": msg})
        assert items_named(c, name) == []
    elif case == "profile_goal_grams":
        before = ok(c.get("/api/profile"), 200)["profile"]
        exactly(c.patch("/api/profile", json={"goalGrams": 1}), {"goalGrams": msg})
        assert ok(c.get("/api/profile"), 200)["profile"]["goalGrams"] == before["goalGrams"]
    elif case == "list_post_state":
        name = fresh("loop")
        exactly(c.post("/api/lists", json={"name": name, "state": "walked"}), {"state": msg})
        assert not [ls for ls in ok(c.get("/api/lists"), 200)["lists"] if ls["name"] == name]
    elif case == "line_patch_unit_weight":
        lst = add_list(c)
        line = line_for(pack(c, lst["id"], item["id"]), item["id"])
        exactly(set_line(c, lst["id"], line["id"], unitWeightGrams=1, quantity=2), {"unitWeightGrams": msg})
        after = server_line(c, lst["id"], item["id"])
        assert after["quantity"] == 1 and after["unitWeightGrams"] == 100
    elif case == "share_post_token":
        lst = add_list(c)
        exactly(c.post(f"/api/lists/{lst['id']}/share", json={"token": "chosen"}), {"token": msg})
        assert ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"] is None
    elif case == "retire_version":
        exactly(c.post(f"/api/closet/{item['id']}/retire", json={"units": 1, "reason": "sold", "version": 1}), {"version": msg})
        assert get_item(c, item["id"])["unitsOwned"] == 3
    elif case == "state_post_name":
        lst = add_list(c)
        pack(c, lst["id"], item["id"])
        exactly(c.post(f"/api/lists/{lst['id']}/state", json={"to": "packed", "name": "x"}), {"name": msg})
        assert get_list(c, lst["id"])["state"] == "planning"
    elif case == "sync_top_level":
        lst = add_list(c)
        op = {"opId": fresh("op"), "listId": lst["id"], "itemId": item["id"], "type": "pack"}
        exactly(c.post("/api/sync", json={"ops": [op], "device": "phone"}), {"device": msg})
        assert get_list(c, lst["id"])["lines"] == []
    elif case == "retired_status_conflict":
        gone = add_item(c)
        ok(retire(c, gone["id"], 1), 200)
        err(patch_item(c, gone["id"], {"status": "active"}), 409, "item_retired")
        assert get_item(c, gone["id"])["status"] == "retired"


def test_wf_trip_packing_create_lands(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    older = add_list(c)
    name = fresh("desert")
    with signed_in(browser, base, "/trips", client=c) as page:
        eventually(page, lambda: heading1(page, "Trips").count() == 1, "Trips heading")
        click(btn(page, "New trip list"))
        dialog = page.get_by_role("dialog", name="New trip list", exact=True)
        eventually(page, lambda: dialog.count() == 1, "New trip list dialog")
        fill(dialog.get_by_role("textbox", name="List name", exact=True), name)
        click(btn(dialog, "Create list"))
        eventually(page, lambda: re.fullmatch(r"/lists/[^/]+", urlparse(page.url).path) is not None, "address shows /lists/<id>")
        see_focus(page, heading1(page, name), "the new list heading")
        assert dialog.count() == 0
        lid = urlparse(page.url).path.split("/")[-1]
        made = get_list(c, lid)
        assert made["name"] == name and made["state"] == "planning"
        page.go_back()
        eventually(page, lambda: urlparse(page.url).path == "/trips", "Back returns to /trips")
        new_link = page.get_by_role("link", name=name, exact=True)
        old_link = page.get_by_role("link", name=older["name"], exact=True)
        eventually(page, lambda: new_link.count() == 1 and old_link.count() == 1, "both lists on Trips")
        assert box(new_link)["y"] < box(old_link)["y"], "newest list must come first"
        assert page.get_by_role("dialog", name="New trip list", exact=True).count() == 0, "dialog must not reopen"
        page.goto(f"{base}/lists/{lid}")
        eventually(page, lambda: heading1(page, name).count() == 1, "deep link shows the same workspace")


def test_wf_trip_packing_build(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        bottle = add_item(c, category="Water", grams=37, units=2, prefix="bottle")
        runners = add_item(c, category="Clothing", grams=640, prefix="runners")
        socks = add_item(c, category="Clothing", grams=34, units=3, prefix="socks")
        food = add_item(c, category="Food", grams=180, units=6, prefix="ration")
        lst = add_list(c)
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            mark_page(page)
            click(btn(page, f"Pack {bottle['name']}"))
            eventually(page, lambda: spin(page, bottle["name"]).count() == 1, "bottle line")
            click(btn(page, f"Increase {bottle['name']}"))
            eventually(page, lambda: btn(page, f"Pack {bottle['name']}").count() == 0, "bottle leaves the available gear")
            click(btn(page, f"Pack {runners['name']}"))
            eventually(page, lambda: mode_radio(page, runners["name"], "Worn").count() == 1, "runners line")
            check(mode_radio(page, runners["name"], "Worn"))
            click(btn(page, f"Pack {socks['name']}"))
            eventually(page, lambda: spin(page, socks["name"]).count() == 1, "socks line")
            click(btn(page, f"Increase {socks['name']}"))
            check(mode_radio(page, socks["name"], "Worn"))
            click(btn(page, f"Pack {food['name']}"))
            eventually(page, lambda: mode_radio(page, food["name"], "Consumable").count() == 1, "food line")
            check(mode_radio(page, food["name"], "Consumable"))
            base_g, worn_g, cons_g = 74 + 34, 640 + 34, 180
            want = f"Base weight {fmt(base_g)}. {delta_text(base_g, GOAL_GRAMS)}."
            see(page, status(page, "Pack updates"), want, "final pack announcement")

            def server_settled() -> bool:
                t = get_list(c, lst["id"])["totals"]
                return (t["baseGrams"], t["wornGrams"], t["consumableGrams"]) == (base_g, worn_g, cons_g)

            eventually(page, server_settled, "server totals equal the hiker's inputs")
            advance(page, SEQUENCE_MAX_MS)
            eventually(page, lambda: all(s in totals_text(page) for s in
                                         [fmt(base_g), fmt(worn_g), fmt(cons_g), fmt(base_g + worn_g + cons_g),
                                          delta_text(base_g, GOAL_GRAMS)]), "totals strip shows server figures")
            pl = page.get_by_role("table", name="Pack list", exact=True)
            assert "worn 1, 1 in pack" in text(pl.get_by_role("row").filter(has_text=socks["name"]))
            assert "consumable" in text(pl.get_by_role("row").filter(has_text=food["name"]))
            assert band(page, "Water").count() == 1 and band(page, "Clothing").count() == 1
            click(page.get_by_role("link", name="Trips", exact=True))
            row = trips_row(page, lst["name"])
            eventually(page, lambda: fmt(base_g) in text(row), "Trips row shows the list base weight")
            click(page.get_by_role("link", name="Closet", exact=True))
            eventually(page, lambda: "Packed in 1 / owned 2" in text(ledger_row(page, "Closet ledger", bottle["name"])),
                       "Closet packed-in count without reload")
            assert not_reloaded(page)
    assert get_list(c, lst["id"])["totals"]["skinOutGrams"] == base_g + worn_g + cons_g


def test_rapid_decrease_last_input_wins(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        food = add_item(c, category="Food", grams=180, units=6, prefix="ration")
        lst = add_list(c)
        pack(c, lst["id"], food["id"], quantity=4, mode="consumable")
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            stalled: list[Any] = []

            def hold_first(route: Any) -> None:
                if route.request.method == "PATCH" and not stalled:
                    stalled.append(route)
                    return
                route.continue_()

            page.route("**/api/lists/*/lines/*", hold_first)
            dec = btn(page, f"Decrease {food['name']}")
            eventually(page, lambda: dec.count() == 1, "Decrease button")
            for _ in range(3):
                click(dec)
            eventually(page, lambda: spin(page, food["name"]).input_value(timeout=SHORT_MS) == "1", "screen shows the last tap")
            eventually(page, lambda: bool(stalled), "first quantity write was sent")
            for _ in range(10):
                advance(page, TICK_MS)
            stalled[0].continue_()
            eventually(page, lambda: server_line(c, lst["id"], food["id"])["quantity"] == 1, "server ends at the last tap")
            eventually(page, lambda: spin(page, food["name"]).input_value(timeout=SHORT_MS) == "1", "screen still at 1 after late answer")
            advance(page, SEQUENCE_MAX_MS)
            eventually(page, lambda: fmt(180) in totals_text(page), "Consumable reads 180 g")
            see(page, status(page, "Pack updates"), f"Base weight {fmt(0)}. {delta_text(0, GOAL_GRAMS)}.", "last announcement")
            page.unroute("**/api/lists/*/lines/*")
    assert get_list(c, lst["id"])["totals"]["consumableGrams"] == 180


def test_wf_trip_packing_retired_elsewhere(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        bank = add_item(c, category="Electronics", grams=180, prefix="bank")
        keep = add_item(c, category="Shelter", grams=482, prefix="tarp")
        lst = add_list(c)
        pack(c, lst["id"], keep["id"])
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            pack_btn = btn(page, f"Pack {bank['name']}")
            eventually(page, lambda: pack_btn.count() == 1, "power bank Pack button")
            ok(retire(c, bank["id"], 1), 200)
            click(pack_btn)
            see(page, status(page, "Pack updates"), f"{bank['name']} is no longer in your closet.", "refusal announcement")
            eventually(page, lambda: spin(page, bank["name"]).count() == 0, "provisional line removed")
            eventually(page, lambda: btn(page, f"Pack {bank['name']}").count() == 0, "row dropped from available gear")
            see_focus(page, page.get_by_role("region", name="Closet", exact=True), "region Closet")
            advance(page, SEQUENCE_MAX_MS)
            eventually(page, lambda: fmt(482) in totals_text(page) and fmt(662) not in totals_text(page), "server totals restored")
    assert line_for(get_list(c, lst["id"]), bank["id"]) is None


def test_wf_trip_packing_session_ended(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    browser_client = hiker(base)
    item = add_item(c, units=3, prefix="bottle")
    lst = add_list(c)
    pack(c, lst["id"], item["id"])
    with signed_in(browser, base, f"/lists/{lst['id']}", client=browser_client) as page:
        open_workspace(page, lst)
        mark_page(page)
        statuses: list[int] = []
        page.on("response", lambda resp: statuses.append(resp.status)
                if resp.request.method == "PATCH" and "/lines/" in urlparse(resp.url).path else None)
        ok(browser_client.delete("/api/session"), 204)
        inc = btn(page, f"Increase {item['name']}")
        click(inc)
        dialog = page.get_by_role("dialog", name="Sign in again", exact=True)
        eventually(page, lambda: dialog.count() == 1, "Sign in again dialog")
        assert dialog.get_by_text("Your session ended. Sign in to finish this change.", exact=True).count() == 1
        field = dialog.get_by_role("textbox", name="Passphrase", exact=True)
        see_focus(page, field, "dialog Passphrase")
        assert spin(page, item["name"]).input_value(timeout=SHORT_MS) == "1", "held change must not show as saved"
        fill(field, "nope-nope")
        click(btn(dialog, "Sign in"))
        eventually(page, lambda: dialog.get_by_text("That passphrase didn't match.", exact=True).count() == 1, "refusal text")
        fill(field, PASSPHRASE)
        click(btn(dialog, "Sign in"))
        eventually(page, lambda: dialog.count() == 0, "dialog closes after sign-in")
        eventually(page, lambda: server_line(c, lst["id"], item["id"])["quantity"] == 2, "held change saved")
        see_focus(page, inc, f"Increase {item['name']}")
        eventually(page, lambda: statuses.count(200) == 1, "exactly one accepted quantity write")
        assert not_reloaded(page) and urlparse(page.url).path == f"/lists/{lst['id']}"
        for _ in range(10):
            advance(page, TICK_MS)
        assert statuses.count(200) == 1 and server_line(c, lst["id"], item["id"])["quantity"] == 2, "change was doubled"
        click(page.get_by_role("link", name="Trips", exact=True))
        eventually(page, lambda: heading1(page, "Trips").count() == 1, "Trips shown")


def test_quantity_within_stock(app_url: str) -> None:
    c = hiker(root(app_url))
    item = add_item(c, units=2)
    lst = add_list(c)
    lid, iid = lst["id"], item["id"]
    field_err(c.post(f"/api/lists/{lid}/lines", json={"itemId": iid, "quantity": 3}), "quantity", "You own 2.")
    assert get_list(c, lid)["lines"] == []
    line = line_for(pack(c, lid, iid, quantity=2), iid)
    err(c.post(f"/api/lists/{lid}/lines", json={"itemId": iid}), 409, "line_exists")
    field_err(set_line(c, lid, line["id"], quantity=3), "quantity", "You own 2.")
    field_err(set_line(c, lid, line["id"], quantity=0), "quantity", "Quantity must be at least 1.")
    field_err(set_line(c, lid, line["id"], mode="carried"), "mode", "Choose base, worn or consumable.")
    assert server_line(c, lid, iid)["quantity"] == 2
    err(c.post(f"/api/lists/{lid}/lines", json={"itemId": probe_id(iid)}), 404, "item_not_found")
    racer = add_item(c, units=3)
    race_list = add_list(c)
    calls = [lambda cl=clone(c): cl.post(f"/api/lists/{race_list['id']}/lines", json={"itemId": racer["id"]})
             for _ in range(CONCURRENCY)]
    rs = together(calls)
    assert sorted(r.status_code for r in rs).count(201) == 1, f"statuses {[r.status_code for r in rs]}"
    for r in rs:
        if r.status_code != 201:
            err(r, 409, "line_exists")
    lines = [ln for ln in get_list(c, race_list["id"])["lines"] if ln["itemId"] == racer["id"]]
    assert len(lines) == 1 and lines[0]["quantity"] == 1


def test_derived_totals(app_url: str) -> None:
    c = hiker(root(app_url))
    goal = ok(c.get("/api/profile"), 200)["profile"]["goalGrams"]
    socks = add_item(c, category="Clothing", grams=34, units=3)
    runners = add_item(c, category="Clothing", grams=640)
    bottle = add_item(c, category="Water", grams=37, units=2)
    food = add_item(c, category="Food", grams=180, units=6)
    tarp = add_item(c, category="Shelter", grams=482)
    lst = add_list(c)
    lid = lst["id"]
    pack(c, lid, socks["id"], 2, "worn")
    pack(c, lid, runners["id"], 1, "worn")
    pack(c, lid, bottle["id"], 2, "base")
    pack(c, lid, food["id"], 4, "consumable")
    got = pack(c, lid, tarp["id"], 1, "base")
    s = line_for(got, socks["id"])
    assert (s["lineWeightGrams"], s["baseGrams"], s["wornGrams"], s["consumableGrams"]) == (68, 34, 34, 0)
    assert s["carryNote"] == "worn 1, 1 in pack" and line_for(got, runners["id"])["carryNote"] == "worn"
    assert line_for(got, food["id"])["carryNote"] == "consumable" and line_for(got, bottle["id"])["carryNote"] == ""
    t = got["totals"]
    assert (t["baseGrams"], t["wornGrams"], t["consumableGrams"]) == (34 + 74 + 482, 674, 720)
    assert t["skinOutGrams"] == 590 + 674 + 720 and t["goalGrams"] == goal and t["deltaGrams"] == goal - 590
    cats = got["categories"]
    assert [e["category"] for e in cats] == ["Shelter", "Water", "Clothing", "Food"]
    clothing = next(e for e in cats if e["category"] == "Clothing")
    assert clothing["subtotalGrams"] == 2 * socks["weightGrams"] + runners["weightGrams"] and clothing["baseGrams"] == socks["weightGrams"]
    after = ok(set_line(c, lid, s["id"], quantity=3), 200)["list"]
    assert after["totals"]["baseGrams"] == 590 + 34 and line_for(after, socks["id"])["carryNote"] == "worn 1, 2 in pack"
    ok(retire(c, tarp["id"], 1), 200)
    now = get_list(c, lid)
    tl = line_for(now, tarp["id"])
    assert tl is not None and tl["inCloset"] is False and tl["lineWeightGrams"] == 482
    assert (tl["baseGrams"], tl["wornGrams"], tl["consumableGrams"]) == (0, 0, 0)
    after_retire_base = 2 * socks["weightGrams"] + 2 * bottle["weightGrams"]
    assert now["totals"]["baseGrams"] == after_retire_base and "Shelter" not in [e["category"] for e in now["categories"]]
    summary = next(ls for ls in ok(c.get("/api/lists"), 200)["lists"] if ls["id"] == lid)
    assert summary["totals"]["baseGrams"] == after_retire_base


def test_settings_and_goal(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        name = fresh("Rowan")
        with signed_in(browser, base, "/settings", client=c) as page:
            eventually(page, lambda: heading1(page, "Settings").count() == 1, "Settings heading")
            fill(page.get_by_role("textbox", name="Display name", exact=True), name)
            check(page.get_by_role("radiogroup", name="Display unit", exact=True).get_by_role("radio", name="Ounces", exact=True))
            fill(page.get_by_role("spinbutton", name="Base-weight goal", exact=True), "100")
            check(page.get_by_role("radiogroup", name="Goal unit", exact=True).get_by_role("radio", name="oz", exact=True))
            select(page.get_by_role("combobox", name="Time zone", exact=True), "Pacific/Pago_Pago")
            check(page.get_by_role("radiogroup", name="Paper size", exact=True).get_by_role("radio", name="A4", exact=True))
            click(btn(page, "Save settings"))
            see(page, status(page, "Settings"), "Settings saved.", "settings saved copy")
            prof = ok(c.get("/api/profile"), 200)["profile"]
            goal = to_grams("100", "oz")
            assert (prof["displayName"], prof["unit"], prof["goalGrams"], prof["timeZone"], prof["paperSize"]) == \
                (name, "oz", goal, "Pacific/Pago_Pago", "A4")
            assert prof["goalDisplay"] == fmt(goal, "oz")
            page.reload()
            goal_field = page.get_by_role("spinbutton", name="Base-weight goal", exact=True)
            eventually(page, lambda: goal_field.input_value(timeout=SHORT_MS) == str(goal), "goal reloads in whole grams")
            assert page.get_by_role("radiogroup", name="Goal unit", exact=True).get_by_role("radio", name="g", exact=True).is_checked()
        item = add_item(c, grams=goal - 5)
        lst = add_list(c)
        under = pack(c, lst["id"], item["id"])["totals"]
        assert under["deltaGrams"] == 5 and under["display"]["delta"] == delta_text(goal - 5, goal, "oz")
        ok(patch_item(c, item["id"], {"weight": {"value": goal + 300, "unit": "g"}}), 200)
        over = get_list(c, lst["id"])["totals"]
        assert over["deltaGrams"] == -300 and over["display"]["delta"] == delta_text(goal + 300, goal, "oz")
        field_err(c.patch("/api/profile", json={"goal": {"value": WEIGHT_MAX_G + 1, "unit": "g"}}), "goal", "Enter a goal from 1 to 50000 g.")
        field_err(c.patch("/api/profile", json={"goal": {"value": 0, "unit": "g"}}), "goal", "Enter a goal from 1 to 50000 g.")
        field_err(c.patch("/api/profile", json={"displayName": "n" * (DISPLAY_NAME_MAX + 1)}), "displayName",
                  "Enter a display name of up to 60 characters.")
        field_err(c.patch("/api/profile", json={"timeZone": "Mars/Olympus_Mons"}), "timeZone", "Choose a time zone.")
        field_err(c.patch("/api/profile", json={"unit": "stone"}), "unit", "Choose a display unit.")
        field_err(c.patch("/api/profile", json={"paperSize": "A5"}), "paperSize", "Choose A4 or Letter.")
        assert ok(c.get("/api/profile"), 200)["profile"]["goalGrams"] == goal
        ok(c.patch("/api/profile", json={"goal": {"value": 1, "unit": "g"}}), 200)
        ok(c.patch("/api/profile", json={"goal": {"value": WEIGHT_MAX_G, "unit": "g"}}), 200)


def test_pack_announcements(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        tarp = add_item(c, category="Shelter", grams=100)
        food = add_item(c, category="Food", grams=50, units=3)
        lst = add_list(c)
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            region = status(page, "Pack updates")

            def says(b: int, what: str) -> None:
                see(page, region, f"Base weight {fmt(b)}. {delta_text(b, GOAL_GRAMS)}.", what)

            click(btn(page, f"Pack {tarp['name']}"))
            says(100, "after pack")
            click(btn(page, f"Pack {food['name']}"))
            says(150, "after second pack")
            eventually(page, lambda: btn(page, f"Increase {food['name']}").count() == 1, "food line")
            click(btn(page, f"Increase {food['name']}"))
            says(200, "after quantity change")
            check(mode_radio(page, food["name"], "Consumable"))
            says(100, "after carry-mode change")
            click(btn(page, f"Unpack {tarp['name']}"))
            says(0, "after unpack")
            eventually(page, lambda: get_list(c, lst["id"])["totals"]["consumableGrams"] == 100
                       and line_for(get_list(c, lst["id"]), tarp["id"]) is None, "server agrees")


def test_provisional_line_held_inputs(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        food = add_item(c, category="Food", grams=180, units=6, prefix="ration")
        doomed = add_item(c, category="Electronics", grams=56, units=2, prefix="lamp")
        lst = add_list(c)
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            line_writes: list[str] = []
            page.on("request", lambda req: line_writes.append(urlparse(req.url).path)
                    if req.method in ("PATCH", "DELETE") and "/lines/" in urlparse(req.url).path else None)
            with held(page, "**/api/lists/*/lines") as hold:
                click(btn(page, f"Pack {food['name']}"))
                inc = btn(page, f"Increase {food['name']}")
                eventually(page, lambda: inc.count() == 1, "provisional line controls")
                click(inc)
                click(inc)
                inc.focus()
                page.keyboard.press("w")
                eventually(page, lambda: spin(page, food["name"]).input_value(timeout=SHORT_MS) == "3", "screen shows held inputs")
                assert line_writes == [], f"no line write may precede the 201, saw {line_writes}"
                hold.release()
            eventually(page, lambda: (lambda ln: ln is not None and ln["quantity"] == 3 and ln["mode"] == "worn")(
                server_line(c, lst["id"], food["id"])), "server line holds the last input")
            ln = server_line(c, lst["id"], food["id"])
            assert ln["carryNote"] == "worn 1, 2 in pack"
            assert line_writes and all(p.endswith(f"/lines/{ln['id']}") for p in line_writes), line_writes
            see(page, status(page, "Pack updates"), f"Base weight {fmt(360)}. {delta_text(360, GOAL_GRAMS)}.", "last announcement")
            assert mode_radio(page, food["name"], "Worn").is_checked()
            before = list(line_writes)
            ok(retire(c, doomed["id"], 2), 200)
            with held(page, "**/api/lists/*/lines") as hold:
                click(btn(page, f"Pack {doomed['name']}"))
                d_inc = btn(page, f"Increase {doomed['name']}")
                eventually(page, lambda: d_inc.count() == 1, "provisional line for the retired item")
                click(d_inc)
                hold.release()
            copy = f"{doomed['name']} is no longer in your closet."
            see(page, status(page, "Pack updates"), copy, "single refusal announcement")
            eventually(page, lambda: spin(page, doomed["name"]).count() == 0, "provisional line removed")
            assert line_writes == before, "held inputs of a refused pack must never be sent"
    assert line_for(get_list(c, lst["id"]), doomed["id"]) is None


def test_wf_keyboard_packing_shortcuts(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    socks = add_item(c, category="Clothing", grams=34, units=3, prefix="socks")
    lst = add_list(c)
    n = socks["name"]
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
        open_workspace(page, lst)
        pack_btn = btn(page, f"Pack {n}")
        eventually(page, lambda: pack_btn.count() == 1, "Pack button")
        pack_btn.focus()
        page.keyboard.press("p")
        qty = spin(page, n)
        see_focus(page, qty, "Quantity after P")
        inc = btn(page, f"Increase {n}")
        inc.focus()
        for key, radio in [("w", "Worn"), ("W", "Base"), ("c", "Consumable"), ("C", "Base"), ("w", "Worn"), ("b", "Base")]:
            page.keyboard.press(key)
            eventually(page, lambda r=radio: mode_radio(page, n, r).is_checked(), f"{key} gives {radio}")
            assert focused(inc), f"focus left Increase after {key}"
        for key, value in [("+", "2"), ("=", "3"), ("-", "2")]:
            page.keyboard.press(key)
            eventually(page, lambda v=value: qty.input_value(timeout=SHORT_MS) == v, f"{key} gives quantity {value}")
            assert focused(inc)
        page.keyboard.press("Alt+u")
        assert qty.count() == 1, "Alt+U must not unpack"
        qty.focus()
        page.keyboard.press("w")
        page.keyboard.press("-")
        assert qty.input_value(timeout=SHORT_MS) == "2" and mode_radio(page, n, "Base").is_checked()
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: qty.input_value(timeout=SHORT_MS) == "3", "ArrowUp raises quantity")
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: qty.input_value(timeout=SHORT_MS) == "2", "ArrowDown lowers quantity")
        base_radio = mode_radio(page, n, "Base")
        base_radio.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: mode_radio(page, n, "Worn").is_checked(), "arrow key moves to Worn")
        eventually(page, lambda: (lambda ln: ln["quantity"] == 2 and ln["mode"] == "worn")(server_line(c, lst["id"], socks["id"])),
                   "server holds quantity 2, worn")
        dec = btn(page, f"Decrease {n}")
        dec.focus()
        page.keyboard.press("U")
        see_focus(page, btn(page, f"Pack {n}"), "Pack button after U")
    eventually_api = server_line(c, lst["id"], socks["id"])
    assert eventually_api is None, "U must unpack the line on the server"


def test_wf_keyboard_packing_focus_moves(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    active = add_item(c, category="Shelter", prefix="tent")
    r1 = add_item(c, category="Sleep", prefix="quilt")
    r2 = add_item(c, category="Pack", prefix="pack")
    lst = add_list(c)
    for it in (active, r1, r2):
        pack(c, lst["id"], it["id"])
    ok(retire(c, r1["id"], 1), 200)
    ok(retire(c, r2["id"], 1), 200)
    solo_item = add_item(c, category="Food", prefix="solo")
    solo = add_list(c)
    pack(c, solo["id"], solo_item["id"])
    ok(retire(c, solo_item["id"], 1), 200)
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
        open_workspace(page, lst)
        unpack_r1 = btn(page, f"Unpack {r1['name']}")
        eventually(page, lambda: unpack_r1.count() == 1, "retired line Unpack")
        unpack_r1.focus()
        watch_body_focus(page)
        page.keyboard.press("Enter")
        see_focus(page, btn(page, f"Unpack {r2['name']}"), "Unpack of the line that took its place")
        page.keyboard.press("Enter")
        see_focus(page, btn(page, f"Unpack {active['name']}"), "Unpack of the line before the removed last line")
        page.keyboard.press("Enter")
        see_focus(page, btn(page, f"Pack {active['name']}"), "Pack button of the returned item")
        page.keyboard.press("Enter")
        see_focus(page, spin(page, active["name"]), "Quantity after Pack")
        assert body_focus_count(page) == 0, "focus fell to the page body during a row move"
        page.goto(f"{base}/lists/{solo['id']}")
        open_workspace(page, solo)
        last = btn(page, f"Unpack {solo_item['name']}")
        eventually(page, lambda: last.count() == 1, "solo line")
        last.focus()
        watch_body_focus(page)
        page.keyboard.press("Enter")
        see_focus(page, page.get_by_role("region", name="Pack list", exact=True), "region Pack list when the list empties")
        assert body_focus_count(page) == 0
    assert get_list(c, solo["id"])["lines"] == []


def test_wf_keyboard_packing_dialog_focus(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c, units=2)
    lst = add_list(c)

    def cycle(page: Page, opener: Locator, dialog_name: str, first: Callable[[Locator], Locator]) -> None:
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
        eventually(page, lambda: dialog.count() == 1, f"{dialog_name} dialog opens")
        see_focus(page, first(dialog), f"first field of {dialog_name}")
        inside = lambda: dialog.evaluate("d => d.contains(document.activeElement)")
        for _ in range(12):
            page.keyboard.press("Tab")
            assert inside(), f"Tab left {dialog_name}"
        first(dialog).focus()
        page.keyboard.press("Shift+Tab")
        assert inside() and not focused(first(dialog)), f"Shift+Tab from the first control must wrap inside {dialog_name}"
        page.keyboard.press("Escape")
        eventually(page, lambda: dialog.count() == 0, f"Escape closes {dialog_name}")
        see_focus(page, opener, f"opener of {dialog_name}")

    with signed_in(browser, base, "/closet", client=c) as page:
        eventually(page, lambda: btn(page, "Add gear").count() == 1, "Closet loaded")
        cycle(page, btn(page, "Add gear"), "Add gear", lambda d: d.get_by_role("textbox", name="Name", exact=True))
        cycle(page, btn(page, f"Retire {item['name']}"), f"Retire {item['name']}",
              lambda d: d.get_by_role("spinbutton", name="Units", exact=True))
        assert get_item(c, item["id"])["unitsOwned"] == 2, "Escape must not save"
        page.goto(f"{base}/trips")
        eventually(page, lambda: btn(page, "New trip list").count() == 1, "Trips loaded")
        cycle(page, btn(page, "New trip list"), "New trip list", lambda d: d.get_by_role("textbox", name="List name", exact=True))
        page.goto(f"{base}/lists/{lst['id']}")
        open_workspace(page, lst)
        cycle(page, btn(page, "Share list"), "Share list", lambda d: d.get_by_role("textbox", name="Expires on", exact=True))


def test_wf_keyboard_packing_live_figures(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        bottle = add_item(c, category="Water", grams=37, units=2, prefix="bottle")
        lst = add_list(c)
        n = bottle["name"]
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            mark_page(page)
            click(btn(page, f"Pack {n}"))
            row = ledger_row(page, "Available gear", n)
            eventually(page, lambda: "1 left" in text(row), "row reads 1 left")
            water_h = page.get_by_role("heading", name="Water 37 g", level=3, exact=True)
            eventually(page, lambda: water_h.count() == 1, "heading Water 37 g")
            eventually(page, lambda: strata_list(page).get_by_role("listitem", name=f"Water: {fmt(37)}, {share_pct(37, 37)}% of base weight", exact=True).count() == 1,
                       "band label for 37 g")
            see(page, status(page, "Pack updates"), f"Base weight {fmt(37)}. {delta_text(37, GOAL_GRAMS)}.", "pack announcement")
            inc = btn(page, f"Increase {n}")
            inc.focus()
            page.keyboard.press("Enter")
            eventually(page, lambda: ledger_row(page, "Available gear", n).count() == 0, "row leaves available gear at 0 left")
            eventually(page, lambda: page.get_by_role("heading", name="Water 74 g", level=3, exact=True).count() == 1, "heading Water 74 g")
            eventually(page, lambda: strata_list(page).get_by_role("listitem", name="Water: 74 g, 100% of base weight", exact=True).count() == 1,
                       "band label for 74 g")
            assert focused(inc), "focus must stay on Increase"
            page.set_viewport_size(PHONE)
            summary = page.get_by_text(f"Base {fmt(74)}, {delta_text(74, GOAL_GRAMS)}.", exact=True)
            eventually(page, lambda: summary.count() == 1, "collapsed summary at 74 g")
            dec = btn(page, f"Decrease {n}")
            dec.focus()
            page.keyboard.press("Enter")
            eventually(page, lambda: page.get_by_text(f"Base {fmt(37)}, {delta_text(37, GOAL_GRAMS)}.", exact=True).count() == 1,
                       "collapsed summary updates in place")
            assert focused(dec) and not_reloaded(page)
            eventually(page, lambda: server_line(c, lst["id"], bottle["id"])["quantity"] == 1, "server quantity 1")
            page.set_viewport_size(DESKTOP)
            click(page.get_by_role("link", name="Trips", exact=True))
            eventually(page, lambda: fmt(37) in text(trips_row(page, lst["name"])), "Trips base weight matches the server")
            assert not_reloaded(page)


def test_wf_pack_strata_geometry(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        quilt = add_item(c, category="Sleep", grams=595)
        pad = add_item(c, category="Sleep", grams=354)
        jacket = add_item(c, category="Clothing", grams=198)
        socks = add_item(c, category="Clothing", grams=34, units=3)
        runners = add_item(c, category="Clothing", grams=640)
        food = add_item(c, category="Food", grams=180)
        lst = add_list(c)
        for it in (quilt, pad, jacket):
            pack(c, lst["id"], it["id"])
        pack(c, lst["id"], socks["id"], 2, "worn")
        pack(c, lst["id"], runners["id"], 1, "worn")
        pack(c, lst["id"], food["id"], 1, "consumable")
        big = add_item(c, category="Shelter", grams=6000)
        heavy = add_list(c)
        pack(c, heavy["id"], big["id"])
        base_g = 949 + 232
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            advance(page, SEQUENCE_MAX_MS)
            sleep_b = strata_list(page).get_by_role("listitem", name=f"Sleep: {fmt(949)}, {share_pct(949, base_g)}% of base weight", exact=True)
            cloth_b = strata_list(page).get_by_role("listitem", name=f"Clothing: {fmt(232)}, {share_pct(232, base_g)}% of base weight", exact=True)
            eventually(page, lambda: sleep_b.count() == 1 and cloth_b.count() == 1, "one labelled band per category")
            assert strata_list(page).get_by_role("listitem").count() == 2, "categories with no base weight have no band"
            assert abs(box(sleep_b)["height"] - band_px(949, STRATA_H_WIDE, GOAL_GRAMS)) <= PX_TOLERANCE
            assert abs(box(cloth_b)["height"] - band_px(232, STRATA_H_WIDE, GOAL_GRAMS)) <= PX_TOLERANCE
            assert box(sleep_b)["y"] > box(cloth_b)["y"], "Sleep sits below Clothing"
            worn = page.get_by_role("img", name=f"Worn {fmt(674)}", exact=True)
            cons = page.get_by_role("img", name=f"Consumable {fmt(180)}", exact=True)
            assert worn.count() == 1 and cons.count() == 1
            assert abs(box(worn)["height"] - band_px(674, STRATA_H_WIDE, GOAL_GRAMS)) <= PX_TOLERANCE + 1
            assert abs(box(cons)["height"] - band_px(180, STRATA_H_WIDE, GOAL_GRAMS)) <= PX_TOLERANCE + 1
            assert page.get_by_role("img", name=f"Goal {fmt(GOAL_GRAMS)}", exact=True).count() == 1
            assert page.get_by_role("img", name=re.compile("^Over goal by ")).count() == 0
            page.goto(f"{base}/lists/{heavy['id']}")
            open_workspace(page, heavy)
            advance(page, SEQUENCE_MAX_MS)
            over = page.get_by_role("img", name=f"Over goal by {fmt(6000 - GOAL_GRAMS)}", exact=True)
            eventually(page, lambda: over.count() == 1, "over-goal chevron labelled with the excess")
            cap = int(STRATA_CAP * STRATA_H_WIDE)
            assert box(band(page, "Shelter"))["height"] <= cap + PX_TOLERANCE, "stack must be capped at 1.25 x H"


def _strata_sample(page: Page, category: str, chip: str, old: str, new: str) -> dict:
    b = band(page, category)
    h = box(b)["height"] if b.count() else 0.0
    t = totals_text(page)
    rx = lambda s: re.search(r"(?<!\d)" + re.escape(s), t) is not None
    return {"chip": page.get_by_role("img", name=chip, exact=True).count(), "h": h, "old": rx(old), "new": rx(new)}


def test_wf_pack_strata_sequence(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        first = add_item(c, category="Shelter", grams=450)
        second = add_item(c, category="Shelter", grams=450)
        extra = add_item(c, category="Sleep", grams=200, units=2)
        runners = add_item(c, category="Clothing", grams=640)
        lst = add_list(c)
        pack(c, lst["id"], first["id"])
        pack(c, lst["id"], runners["id"], 1, "worn")
        pack(c, lst["id"], extra["id"])
        h_old = band_px(450, STRATA_H_WIDE, GOAL_GRAMS)
        h_new = band_px(900, STRATA_H_WIDE, GOAL_GRAMS)
        old_b, new_b = fmt(650), fmt(1100)
        chip = f"Moving {second['name']}, {fmt(450)}"
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            advance(page, SEQUENCE_MAX_MS)
            eventually(page, lambda: abs(box(band(page, "Shelter"))["height"] - h_old) <= 1, "starting band height")

            def run(action: Callable[[], None], old: str, new: str) -> list[dict]:
                action()
                samples, t = [], 0
                while t <= SEQUENCE_MAX_MS + 2 * SAMPLE_MS:
                    samples.append({"t": t, **_strata_sample(page, "Shelter", chip, old, new)})
                    advance(page, SAMPLE_MS)
                    t += SAMPLE_MS
                return samples

            s = run(lambda: click(btn(page, f"Pack {second['name']}")), old_b, new_b)
            assert any(x["chip"] for x in s), "no chip flew on a new line"
            for x in s:
                if x["chip"]:
                    assert abs(x["h"] - h_old) <= 1 and x["old"] and not x["new"], f"chip overlapped later steps: {x}"
                if abs(x["h"] - h_old) > 1 and abs(x["h"] - h_new) > 1:
                    assert x["old"] and not x["chip"], f"band grew while numerals moved or chip flew: {x}"
                if not x["old"] and not x["new"]:
                    assert abs(x["h"] - h_new) <= 1 and not x["chip"], f"numerals counted before the band finished: {x}"
            end = next(x for x in s if x["t"] >= SEQUENCE_MAX_MS)
            assert end["chip"] == 0 and abs(end["h"] - h_new) <= 1 and end["new"], f"not settled within 1.2 s: {end}"
            s = run(lambda: click(btn(page, f"Unpack {second['name']}")), new_b, old_b)
            assert any(x["chip"] for x in s), "unpack flies the chip back"
            for x in s:
                if x["chip"]:
                    assert abs(x["h"] - h_old) <= 1 and x["new"], f"chip flew before numerals and band finished: {x}"
                if abs(x["h"] - h_old) > 1 and abs(x["h"] - h_new) > 1:
                    assert x["new"] and not x["chip"], f"band shrank before numerals finished: {x}"
            end = next(x for x in s if x["t"] >= SEQUENCE_MAX_MS)
            assert end["chip"] == 0 and abs(end["h"] - h_old) <= 1 and end["new"]
            raise_chip = f"Moving {extra['name']}, {fmt(200)}"
            click(btn(page, f"Pack {extra['name']}"))
            for _ in range(int(SEQUENCE_MAX_MS / SAMPLE_MS)):
                assert page.get_by_role("img", name=raise_chip, exact=True).count() == 0, "Pack on an existing line is a quantity change"
                advance(page, SAMPLE_MS)
            eventually(page, lambda: server_line(c, lst["id"], extra["id"])["quantity"] == 2, "quantity raised")


def test_wf_pack_strata_reduced_motion(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        first = add_item(c, category="Shelter", grams=450)
        second = add_item(c, category="Shelter", grams=450)
        lst = add_list(c)
        pack(c, lst["id"], first["id"])
        chip = f"Moving {second['name']}, {fmt(450)}"
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c, reduced_motion="reduce") as page:
            open_workspace(page, lst)
            eventually(page, lambda: btn(page, f"Pack {second['name']}").count() == 1, "Pack button")
            advance(page, REDUCED_MAX_MS)
            click(btn(page, f"Pack {second['name']}"))
            assert page.get_by_role("img", name=chip, exact=True).count() == 0
            advance(page, REDUCED_MAX_MS)
            assert page.get_by_role("img", name=chip, exact=True).count() == 0, "no chip under reduced motion"
            total = first["weightGrams"] + second["weightGrams"]
            assert abs(box(band(page, "Shelter"))["height"] - band_px(total, STRATA_H_WIDE, GOAL_GRAMS)) <= 1
            assert re.search(r"(?<!\d)" + re.escape(fmt(total)), totals_text(page)), "numerals jump to the final value"
            assert strata_list(page).get_by_role("listitem", name=f"Shelter: {fmt(total)}, 100% of base weight", exact=True).count() == 1
            see(page, status(page, "Pack updates"), f"Base weight {fmt(total)}. {delta_text(total, GOAL_GRAMS)}.", "same announcement")
    assert get_list(c, lst["id"])["totals"]["baseGrams"] == total


def test_wf_pack_strata_band_labels(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        tarp = add_item(c, category="Shelter", grams=300, units=2)
        quilt = add_item(c, category="Sleep", grams=700)
        lst = add_list(c)
        pack(c, lst["id"], tarp["id"])
        pack(c, lst["id"], quilt["id"])
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            shelter = f"Shelter: {fmt(300)}, {share_pct(300, 1000)}% of base weight"
            sleep = f"Sleep: {fmt(700)}, {share_pct(700, 1000)}% of base weight"
            s_band = strata_list(page).get_by_role("listitem", name=shelter, exact=True)
            q_band = strata_list(page).get_by_role("listitem", name=sleep, exact=True)
            eventually(page, lambda: s_band.count() == 1 and q_band.count() == 1, "labelled bands")
            s_band.focus()
            assert focused(s_band), "band takes keyboard focus"
            page.keyboard.press("ArrowUp")
            see_focus(page, q_band, "band above after ArrowUp")
            page.keyboard.press("ArrowDown")
            see_focus(page, s_band, "band below after ArrowDown")
            btn(page, f"Unpack {quilt['name']}").focus()
            names = tab_order(page, 2)
            assert names[:2] == [shelter, sleep], f"bands follow the pack list bottom to top, got {names}"
            click(btn(page, f"Increase {tarp['name']}"))
            want = f"Shelter: {fmt(600)}, {share_pct(600, 1300)}% of base weight"
            eventually(page, lambda: strata_list(page).get_by_role("listitem", name=want, exact=True).count() == 1,
                       "label takes its final text at once", tick=0)


FORMAT_CASES = ["grams", "ounces", "pounds"]
FORMAT_SPECS = {
    "grams": {"unit": "g", "goal": 4500, "items": [("Shelter", 2797)]},
    "ounces": {"unit": "oz", "goal": 4500, "items": [("Shelter", 2797)]},
    "pounds": {"unit": "lb", "goal": 453, "items": [("Shelter", 453), ("Clothing", 210)]},
}


@pytest.mark.parametrize("case", FORMAT_CASES, ids=FORMAT_CASES)
def test_display_formatting_everywhere(browser: Browser, app_url: str, case: str) -> None:
    base = root(app_url)
    c = hiker(base)
    spec = FORMAT_SPECS[case]
    unit, goal = spec["unit"], spec["goal"]
    with profile_as(c, unit=unit, goal={"value": goal, "unit": "g"}):
        made = [add_item(c, category=cat, grams=g) for cat, g in spec["items"]]
        lst = add_list(c)
        for it in made:
            pack(c, lst["id"], it["id"])
        base_g = sum(g for _, g in spec["items"])
        got = get_list(c, lst["id"])
        assert got["totals"]["display"]["base"] == fmt(base_g, unit)
        assert got["totals"]["display"]["goal"] == fmt(goal, unit)
        assert got["totals"]["display"]["delta"] == delta_text(base_g, goal, unit)
        for it in made:
            assert get_item(c, it["id"])["weightDisplay"] == fmt(it["weightGrams"], unit)
        token = ok(c.post(f"/api/lists/{lst['id']}/share", json={}), 201)["share"]["token"]
        shared = ok(httpx.get(f"{base}/api/share/{token}", timeout=HTTP_TIMEOUT), 200)["share"]
        assert shared["totals"]["display"]["base"] == fmt(base_g, unit)
        assert shared["totals"]["display"]["delta"] == delta_text(base_g, goal, unit)
        sheet = ok(c.post(f"/api/lists/{lst['id']}/pack-sheets", json={}), 201)["sheet"]
        pdf = norm(pdf_text(c.get(sheet["url"]).content))
        assert f"Base {fmt(base_g, unit)}" in pdf and delta_text(base_g, goal, unit) in pdf and f"Goal {fmt(goal, unit)}" in pdf
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            advance(page, SEQUENCE_MAX_MS)
            eventually(page, lambda: fmt(base_g, unit) in totals_text(page) and delta_text(base_g, goal, unit) in totals_text(page),
                       "workspace totals strip")
            first = made[0]
            cat0 = spec["items"][0][0]
            assert band(page, cat0).first.evaluate("e => e.getAttribute('aria-label') || e.textContent") is not None
            eventually(page, lambda: strata_list(page).get_by_role("listitem", name=re.compile(
                "^" + re.escape(f"{cat0}: {fmt(first['weightGrams'], unit)}, "))).count() == 1, "band label figure")
            assert page.get_by_role("img", name=f"Goal {fmt(goal, unit)}", exact=True).count() == 1
            page.goto(f"{base}/closet")
            eventually(page, lambda: fmt(first["weightGrams"], unit) in text(ledger_row(page, "Closet ledger", first["name"])),
                       "Closet row figure")


def test_wf_retire_gear_lost_answer(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c, category="Electronics", grams=56, units=2, prefix="headlamp")
    iid, n = item["id"], item["name"]
    with signed_in(browser, base, "/closet", client=c) as page:
        sent: list[tuple[str | None, Any]] = []
        dropped = {"done": False}

        def drop_first(route: Any) -> None:
            req = route.request
            if req.method != "POST":
                route.continue_()
                return
            sent.append((req.headers.get("idempotency-key"), json.loads(req.post_data or "null")))
            if not dropped["done"]:
                dropped["done"] = True
                route.fetch()
                route.abort()
            else:
                route.continue_()

        page.route(f"**/api/closet/{iid}/retire", drop_first)
        row = ledger_row(page, "Closet ledger", n)
        eventually(page, lambda: row.count() == 1, "ledger row")
        click(btn(row, f"Retire {n}"))
        dialog = page.get_by_role("dialog", name=f"Retire {n}", exact=True)
        eventually(page, lambda: dialog.count() == 1, "Retire dialog")
        assert dialog.get_by_role("spinbutton", name="Units", exact=True).input_value(timeout=SHORT_MS) == "1"
        check(dialog.get_by_role("radiogroup", name="Reason", exact=True).get_by_role("radio", name="Sold", exact=True))
        confirm = btn(dialog, "Confirm retire")
        click(confirm)
        see(page, status(page, "Closet updates"), "Couldn't reach Skinout. Your retirement was not confirmed; confirm again.",
            "lost-answer copy")
        assert dialog.count() == 1
        see_focus(page, confirm, "Confirm retire")
        assert get_item(c, iid)["unitsOwned"] == 1, "the lost request reached the server"
        click(confirm)
        see(page, status(page, "Closet updates"), f"Retired 1 of {n}.", "replayed success copy")
        eventually(page, lambda: dialog.count() == 0, "dialog closes on success")
        see_focus(page, btn(ledger_row(page, "Closet ledger", n), f"Edit {n}"), "row Edit button")
        assert len(sent) == 2 and sent[0][0] and sent[0] == sent[1], f"retry must resend one key and body: {sent}"
    after = get_item(c, iid)
    assert after["unitsOwned"] == 1 and after["status"] == "active", "retry sold a second unit"


def test_retire_idempotency(app_url: str) -> None:
    c = hiker(root(app_url))
    item = add_item(c, units=3)
    iid = item["id"]
    key = fresh("key")
    first = retire(c, iid, 1, "sold", key)
    body = ok(first, 200)
    assert body["item"]["unitsOwned"] == 2 and body["affectedLines"] == 0
    version = get_item(c, iid)["version"]
    replay = retire(c, iid, 1, "sold", key)
    assert replay.status_code == 200 and replay.content == first.content
    assert get_item(c, iid)["unitsOwned"] == 2 and get_item(c, iid)["version"] == version
    err(retire(c, iid, 1, "lost", key), 422, "idempotency_key_reused", "This key was already used for a different retirement.")
    other = add_item(c, units=2)
    ok(retire(c, other["id"], 1, "sold", key), 200)
    assert get_item(c, other["id"])["unitsOwned"] == 1
    field_err(retire(c, iid, 1, "sold", "bad key!"), "Idempotency-Key", "Send a key of 1 to 64 letters, digits, - or _.")
    small = add_item(c, units=2)
    k422 = fresh("k")
    stored_422 = retire(c, small["id"], 5, "sold", k422)
    field_err(stored_422, "units", "Enter whole units from 1 to 2.")
    ok(patch_item(c, small["id"], {"unitsOwned": 6}), 200)
    again = retire(c, small["id"], 5, "sold", k422)
    assert again.status_code == 422 and again.content == stored_422.content, "a stored 422 replays even after stock changed"
    one = add_item(c)
    ok(retire(c, one["id"], 1), 200)
    k409 = fresh("k")
    stored_409 = retire(c, one["id"], 1, "sold", k409)
    err(stored_409, 409, "item_retired")
    assert retire(c, one["id"], 1, "sold", k409).content == stored_409.content
    race = add_item(c, units=3)
    rk = fresh("race")
    rs = together([lambda cl=clone(c): retire(cl, race["id"], 1, "sold", rk) for _ in range(CONCURRENCY)])
    oks = [r for r in rs if r.status_code == 200]
    assert oks, "one keyed retirement must succeed"
    assert all(r.content == oks[0].content for r in oks)
    for r in rs:
        if r.status_code != 200:
            err(r, 409, "request_in_progress", "This retirement is still being processed.")
    assert get_item(c, race["id"])["unitsOwned"] == 2


def test_concurrent_retirements_and_delete_rules(app_url: str) -> None:
    c = hiker(root(app_url))
    fuel = add_item(c, category="Kitchen", grams=200, units=3)
    rs = together([lambda cl=clone(c): retire(cl, fuel["id"], 1, "retired") for _ in range(CONCURRENCY)])
    assert [r.status_code for r in rs].count(200) == 3, [r.status_code for r in rs]
    for r in rs:
        if r.status_code != 200:
            err(r, 409, "item_retired")
    after = get_item(c, fuel["id"])
    assert after["unitsOwned"] == 0 and after["status"] == "retired"
    lamp = add_item(c, units=1)
    rs = together([lambda cl=clone(c): retire(cl, lamp["id"], 1, "sold") for _ in range(2)])
    assert sorted(r.status_code for r in rs) == [200, 409]
    two = add_item(c, units=2)
    field_err(retire(c, two["id"], 3), "units", "Enter whole units from 1 to 2.")
    field_err(c.post(f"/api/closet/{two['id']}/retire", json={"units": 1, "reason": "gifted"}), "reason", "Choose a reason.")
    lost = ok(retire(c, two["id"], 1, "lost"), 200)["item"]
    assert lost["unitsOwned"] == 1 and lost["status"] == "active"
    err(retire(c, probe_id(two["id"]), 1), 404, "item_not_found")
    used = add_item(c)
    walked = add_list(c)
    pack(c, walked["id"], used["id"])
    ok(set_state(c, walked["id"], "packed"), 200)
    ok(set_state(c, walked["id"], "walked"), 200)
    ok(retire(c, used["id"], 1), 200)
    err(c.delete(f"/api/closet/{used['id']}"), 409, "item_in_lists")
    assert get_item(c, used["id"]) is not None
    unused = add_item(c)
    assert c.delete(f"/api/closet/{unused['id']}").status_code == 204
    assert get_item(c, unused["id"]) is None
    err(c.delete(f"/api/closet/{unused['id']}"), 404, "item_not_found")


def test_wf_retire_gear_not_in_closet(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        lamp = add_item(c, category="Electronics", grams=56, prefix="headlamp")
        tarp = add_item(c, category="Shelter", grams=482)
        plan, packed = add_list(c), add_list(c)
        for lst in (plan, packed):
            pack(c, lst["id"], lamp["id"])
            pack(c, lst["id"], tarp["id"])
        ok(set_state(c, packed["id"], "packed"), 200)
        token = ok(c.post(f"/api/lists/{plan['id']}/share", json={}), 201)["share"]["token"]
        n = lamp["name"]
        with signed_in(browser, base, "/closet", client=c) as page:
            row = ledger_row(page, "Closet ledger", n)
            eventually(page, lambda: row.count() == 1, "ledger row")
            click(btn(row, f"Retire {n}"))
            dialog = page.get_by_role("dialog", name=f"Retire {n}", exact=True)
            eventually(page, lambda: dialog.count() == 1, "Retire dialog")
            check(dialog.get_by_role("radio", name="Sold", exact=True))
            click(btn(dialog, "Confirm retire"))
            see(page, status(page, "Closet updates"), f"Retired 1 of {n}.", "retire success copy")
            see_focus(page, heading1(page, "Closet"), "Closet heading after the item is retired")
            eventually(page, lambda: ledger_row(page, "Retired gear", n).count() == 1
                       and ledger_row(page, "Closet ledger", n).count() == 0, "item moves to Retired gear")
            page.goto(f"{base}/lists/{plan['id']}")
            open_workspace(page, plan)
            line_row = page.get_by_role("table", name="Pack list", exact=True).get_by_role("row").filter(has_text=n)
            eventually(page, lambda: "Not in closet" in text(line_row), "Not in closet marker")
            advance(page, SEQUENCE_MAX_MS)
            assert fmt(482) in totals_text(page) and fmt(538) not in totals_text(page)
        for lst in (plan, packed):
            got = get_list(c, lst["id"])
            ln = line_for(got, lamp["id"])
            assert ln is not None and ln["inCloset"] is False, "line kept and marked Not in closet"
            assert got["totals"]["baseGrams"] == 482
        shared = ok(httpx.get(f"{base}/api/share/{token}", timeout=HTTP_TIMEOUT), 200)["share"]
        assert n not in json.dumps(shared), "Not in closet line must not reach the share view"
        assert get_item(c, lamp["id"])["packedInLists"] == 0


def test_wf_retire_gear_delete(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    store = S3()
    name = fresh("sandals")
    data = csv_bytes(REQUIRED_COLUMNS, [[name, "Clothing", "210", "g"]])
    imp = ok(upload_csv(c, data), 201)["import"]
    ok(c.post(f"/api/imports/{imp['id']}/commit", json={}), 200)
    item = items_named(c, name)[0]
    photo = ok(c.post(f"/api/closet/{item['id']}/photo", files={"photo": ("s.png", png_bytes(), "image/png")}), 201)["photo"]
    ok(retire(c, item["id"], 1), 200)
    kept = add_item(c, category="Clothing")
    lst = add_list(c)
    pack(c, lst["id"], kept["id"])
    ok(retire(c, kept["id"], 1), 200)
    with signed_in(browser, base, "/closet", client=c) as page:
        blocked = btn(ledger_row(page, "Retired gear", kept["name"]), f"Delete {kept['name']}")
        eventually(page, lambda: blocked.count() == 1, "retired row Delete")
        click(blocked)
        see(page, status(page, "Closet updates"), f"{kept['name']} is on a trip list and can't be deleted. Retire it instead.",
            "delete refusal copy")
        assert ledger_row(page, "Retired gear", kept["name"]).count() == 1
        see_focus(page, blocked, "Delete button after refusal")
        click(btn(ledger_row(page, "Retired gear", name), f"Delete {name}"))
        see(page, status(page, "Closet updates"), f"Deleted {name}.", "delete success copy")
        eventually(page, lambda: ledger_row(page, "Retired gear", name).count() == 0, "row leaves Retired gear")
        see_focus(page, heading1(page, "Closet"), "Closet heading after delete")
    assert store.keys(f"photos/{item['id']}/") == []
    err(c.get(photo["url"]), 404, "photo_not_found")
    assert get_item(c, item["id"]) is None and get_item(c, kept["id"]) is not None
    again = add_item(c, category="Clothing", name=name)
    assert again["name"] == name
    after = ok(c.get(f"/api/imports/{imp['id']}"), 200)["import"]
    row = after["rows"][0]
    assert row["itemId"] is None and row["name"] == name and row["outcome"] == "created"
    assert after["counts"] == {"matched": 0, "created": 1, "rejected": 0}
    assert c.get(f"/api/imports/{imp['id']}/original").content == data


def test_delete_without_photo_during_outage(app_url: str) -> None:
    c = hiker(outage_url(MINIO_DOWN_ENV))
    item = add_item(c)
    assert c.delete(f"/api/closet/{item['id']}").status_code == 204
    assert get_item(c, item["id"]) is None


def test_list_state_machine(app_url: str) -> None:
    c = hiker(root(app_url))
    item = add_item(c, units=2)
    empty = add_list(c)
    err(set_state(c, empty["id"], "planning"), 409, "illegal_transition", "Cannot move a planning list to planning.")
    err(set_state(c, empty["id"], "walked"), 409, "illegal_transition", "Cannot move a planning list to walked.")
    err(set_state(c, empty["id"], "packed"), 409, "empty_list")
    field_err(set_state(c, empty["id"], "lost"), "to", "Choose planning, packed or walked.")
    lst = add_list(c)
    line = line_for(pack(c, lst["id"], item["id"]), item["id"])
    assert ok(set_state(c, lst["id"], "packed"), 200)["list"]["state"] == "packed"
    err(set_state(c, lst["id"], "packed"), 409, "illegal_transition", "Cannot move a packed list to packed.")
    err(set_line(c, lst["id"], line["id"], quantity=2), 409, "list_not_editable", f"{lst['name']} is packed and can't be edited.")
    assert ok(set_state(c, lst["id"], "planning"), 200)["list"]["state"] == "planning"
    ok(set_state(c, lst["id"], "packed"), 200)
    assert ok(set_state(c, lst["id"], "walked"), 200)["list"]["state"] == "walked"
    err(set_state(c, lst["id"], "planning"), 409, "illegal_transition", "Cannot move a walked list to planning.")
    err(set_state(c, lst["id"], "packed"), 409, "illegal_transition", "Cannot move a walked list to packed.")
    err(c.patch(f"/api/lists/{lst['id']}", json={"name": "renamed"}), 409, "list_not_editable",
        f"{lst['name']} is walked and can't be edited.")
    err(c.delete(f"/api/lists/{lst['id']}/lines/{line['id']}"), 409, "list_not_editable")
    gone = add_item(c)
    nic = add_list(c)
    pack(c, nic["id"], gone["id"])
    ok(retire(c, gone["id"], 1), 200)
    err(set_state(c, nic["id"], "packed"), 409, "lines_not_in_closet")
    err(set_state(c, probe_id(nic["id"]), "packed"), 404, "list_not_found")
    race = add_list(c)
    pack(c, race["id"], item["id"])
    rs = together([lambda cl=clone(c): set_state(cl, race["id"], "packed") for _ in range(EIGHT_MOVES)])
    assert [r.status_code for r in rs].count(200) == 1
    for r in rs:
        if r.status_code != 200:
            err(r, 409, "illegal_transition", "Cannot move a packed list to packed.")
    fork = together([lambda cl=clone(c): set_state(cl, race["id"], "planning"),
                     lambda cl=clone(c): set_state(cl, race["id"], "walked")])
    assert [r.status_code for r in fork].count(200) == 1
    winner = "planning" if fork[0].status_code == 200 else "walked"
    loser_to = "walked" if winner == "planning" else "planning"
    loser = fork[1] if winner == "planning" else fork[0]
    err(loser, 409, "illegal_transition", f"Cannot move a {winner} list to {loser_to}.")
    assert get_list(c, race["id"])["state"] == winner


def test_wf_list_lifecycle_freeze_rename(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        quilt = add_item(c, category="Sleep", grams=595, prefix="quilt")
        old = quilt["name"]
        new = fresh("quilt-new")
        plan, packed, walked = add_list(c), add_list(c), add_list(c)
        for lst in (plan, packed, walked):
            pack(c, lst["id"], quilt["id"])
        ok(set_state(c, walked["id"], "packed"), 200)
        ok(set_state(c, walked["id"], "walked"), 200)
        with signed_in(browser, base, "/closet", client=c) as page:
            row = ledger_row(page, "Closet ledger", old)
            eventually(page, lambda: row.count() == 1, "quilt row")
            click(btn(row, f"Edit {old}"))
            dialog = page.get_by_role("dialog", name=f"Edit {old}", exact=True)
            eventually(page, lambda: dialog.count() == 1, "Edit dialog")
            fill(dialog.get_by_role("textbox", name="Name", exact=True), new)
            check(dialog.get_by_role("radio", name="g", exact=True))
            fill(dialog.get_by_role("spinbutton", name="Weight", exact=True), "610")
            click(btn(dialog, "Save gear"))
            see(page, status(page, "Closet updates"), f"Saved {new}.", "save copy")
            page.goto(f"{base}/lists/{packed['id']}")
            open_workspace(page, packed)
            eventually(page, lambda: btn(page, "Mark packed").count() == 1, "Mark packed")
        ok(set_state(c, packed["id"], "packed"), 200)
        ok(patch_item(c, quilt["id"], {"name": old, "weight": {"value": 595, "unit": "g"}}), 200)
        p = line_for(get_list(c, plan["id"]), quilt["id"])
        k = line_for(get_list(c, packed["id"]), quilt["id"])
        w = line_for(get_list(c, walked["id"]), quilt["id"])
        assert (p["name"], p["unitWeightGrams"]) == (old, 595), "planning follows the closet"
        assert (k["name"], k["unitWeightGrams"]) == (new, 610), "packed keeps the values it was packed with"
        assert (w["name"], w["unitWeightGrams"]) == (old, 595), "walked keeps its frozen values"
        token = ok(c.post(f"/api/lists/{packed['id']}/share", json={}), 201)["share"]["token"]
        shared = ok(httpx.get(f"{base}/api/share/{token}", timeout=HTTP_TIMEOUT), 200)["share"]
        assert shared["lines"][0]["name"] == new and shared["lines"][0]["unitWeightGrams"] == 610
        assert get_list(c, packed["id"])["totals"]["baseGrams"] == 610
        with signed_in(browser, base, f"/lists/{packed['id']}", client=c) as page:
            open_workspace(page, packed)
            table = page.get_by_role("table", name="Pack list", exact=True)
            eventually(page, lambda: new in text(table), "workspace shows the frozen name")
            click(btn(page, "Return to planning"))
            see(page, status(page, "List state"), "List returned to planning.", "return copy")
            eventually(page, lambda: old in text(table), "planning takes the closet name again")
        back = line_for(get_list(c, packed["id"]), quilt["id"])
        assert (back["name"], back["unitWeightGrams"]) == (old, 595)
        assert get_list(c, packed["id"])["totals"]["baseGrams"] == 595


def test_read_only_banners(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c, units=2)
    spare = add_item(c)
    packed, walked = add_list(c), add_list(c)
    for lst in (packed, walked):
        pack(c, lst["id"], item["id"])
        ok(set_state(c, lst["id"], "packed"), 200)
    ok(set_state(c, walked["id"], "walked"), 200)
    n = item["name"]
    with signed_in(browser, base, f"/lists/{packed['id']}", client=c) as page:
        open_workspace(page, packed)
        eventually(page, lambda: page.get_by_text("Packed — weights are frozen. Return to planning to change this list.", exact=True).count() == 1,
                   "packed banner")
        assert btn(page, "Return to planning").count() == 1 and btn(page, "Mark walked").count() == 1
        assert btn(page, "Mark packed").count() == 0
        for name in [f"Decrease {n}", f"Increase {n}", f"Unpack {n}", f"Pack {spare['name']}"]:
            assert btn(page, name).count() == 0, f"{name} must be absent on a packed list"
        assert spin(page, n).count() == 0 and page.get_by_role("radiogroup", name=f"Carry mode for {n}", exact=True).count() == 0
        page.goto(f"{base}/lists/{walked['id']}")
        open_workspace(page, walked)
        eventually(page, lambda: page.get_by_text("Walked — this list is kept for history and can't be changed.", exact=True).count() == 1,
                   "walked banner")
        for name in ["Mark packed", "Return to planning", "Mark walked", f"Unpack {n}", f"Pack {spare['name']}"]:
            assert btn(page, name).count() == 0, f"{name} must be absent on a walked list"
        assert spin(page, n).count() == 0


def test_wf_list_lifecycle_two_devices(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c, units=2)
    lst = add_list(c)
    pack(c, lst["id"], item["id"])
    path = f"/lists/{lst['id']}"
    with signed_in(browser, base, path, client=c) as a, signed_in(browser, base, path, client=c) as b, \
            signed_in(browser, base, path, client=c) as third:
        for p in (a, b, third):
            open_workspace(p, lst)
            eventually(p, lambda p=p: btn(p, "Mark packed").count() == 1, "Mark packed on every device")
        click(btn(a, "Mark packed"))
        click(btn(b, "Mark packed"))
        msgs = {}
        for p in (a, b):
            eventually(p, lambda p=p: text(status(p, "List state")) in ("List marked packed.", "Cannot move a packed list to packed."),
                       "List state answer")
            msgs[id(p)] = text(status(p, "List state"))
        assert sorted(msgs.values()) == ["Cannot move a packed list to packed.", "List marked packed."]
        loser = a if msgs[id(a)].startswith("Cannot") else b
        winner = b if loser is a else a
        banner = "Packed — weights are frozen. Return to planning to change this list."
        for p in (loser, winner):
            eventually(p, lambda p=p: p.get_by_text(banner, exact=True).count() == 1, "packed banner")
            assert btn(p, "Return to planning").count() == 1 and btn(p, "Mark packed").count() == 0
            assert btn(p, f"Increase {item['name']}").count() == 0
            see_focus(p, heading1(p, lst["name"]), "heading after the state answer")
        skip_idle(loser, TWO_MINUTES_MS)
        assert text(status(loser, "List state")) == "Cannot move a packed list to packed."
        assert loser.get_by_text(banner, exact=True).count() == 1
        skip_idle(winner, TWO_MINUTES_MS)
        assert text(status(winner, "List state")) == "List marked packed."
        click(btn(third, f"Increase {item['name']}"))
        see(third, status(third, "Pack updates"), f"{lst['name']} is packed on another device and can't be edited.", "stale tab refusal")
        eventually(third, lambda: third.get_by_text(banner, exact=True).count() == 1
                   and btn(third, f"Increase {item['name']}").count() == 0, "stale tab switches to packed")
        see_focus(third, heading1(third, lst["name"]), "heading on the stale tab")
    got = get_list(c, lst["id"])
    assert got["state"] == "packed" and line_for(got, item["id"])["quantity"] == 1


def test_wf_list_lifecycle_double_tap(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c)
    lst = add_list(c)
    pack(c, lst["id"], item["id"])
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
        open_workspace(page, lst)
        state_posts: list[str] = []
        page.on("request", lambda req: state_posts.append(req.url) if req.method == "POST" and urlparse(req.url).path.endswith("/state") else None)
        mark = btn(page, "Mark packed")
        eventually(page, lambda: mark.count() == 1, "Mark packed")
        banner = "Packed — weights are frozen. Return to planning to change this list."
        with held(page, "**/api/lists/*/state") as hold:
            click(mark)
            click(mark)
            eventually(page, lambda: len(state_posts) >= 1, "one state request sent")
            for _ in range(5):
                advance(page, TICK_MS)
            assert len(state_posts) == 1, f"a pending state change must block further presses, saw {len(state_posts)}"
            assert page.get_by_text(banner, exact=True).count() == 0, "requested state shown before the 200"
            hold.release()
        see(page, status(page, "List state"), "List marked packed.", "success copy")
        eventually(page, lambda: page.get_by_text(banner, exact=True).count() == 1, "packed banner")
        skip_idle(page, TWO_MINUTES_MS)
        assert text(status(page, "List state")) == "List marked packed." and page.get_by_text(banner, exact=True).count() == 1
        assert len(state_posts) == 1
        click(btn(page, "Return to planning"))
        eventually(page, lambda: len(state_posts) == 2, "next legal action sends on its first press")
        see(page, status(page, "List state"), "List returned to planning.", "return copy")
    assert get_list(c, lst["id"])["state"] == "planning"


def _make_offline_ready(page: Page) -> None:
    page.evaluate("() => navigator.serviceWorker ? navigator.serviceWorker.ready.then(() => true) : true")
    page.reload()


def test_wf_offline_sync_trailhead(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        a = add_item(c, category="Shelter", grams=100, units=3)
        b = add_item(c, category="Sleep", grams=50)
        lst = add_list(c)
        pack(c, lst["id"], a["id"])
        pack(c, lst["id"], b["id"])
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            _make_offline_ready(page)
            open_workspace(page, lst)
            eventually(page, lambda: btn(page, f"Unpack {b['name']}").count() == 1, "lines loaded online")
            page.context.set_offline(True)
            offline_copy = "You're offline. Changes stay on this device and sync when you reconnect."
            see(page, status(page, "Connection"), offline_copy, "offline banner")
            click(btn(page, f"Unpack {b['name']}"))
            click(btn(page, f"Increase {a['name']}"))
            see(page, status(page, "Pack updates"), f"Base weight {fmt(200)}. {delta_text(200, GOAL_GRAMS)}.", "offline totals")
            page.reload()
            open_workspace(page, lst)
            eventually(page, lambda: spin(page, a["name"]).input_value(timeout=SHORT_MS) == "2"
                       and btn(page, f"Unpack {b['name']}").count() == 0, "offline changes survive the reload")
            see(page, status(page, "Connection"), offline_copy, "offline banner after reload")
            server = get_list(c, lst["id"])
            assert line_for(server, b["id"]) is not None and line_for(server, a["id"])["quantity"] == 1, "nothing synced while offline"
            page.context.set_offline(False)
            see(page, status(page, "Sync results"), "Back online. Synced 2 of 2 changes.", "sync summary")
            eventually(page, lambda: text(status(page, "Connection")) == "", "Connection empties when back online")
    got = get_list(c, lst["id"])
    assert line_for(got, b["id"]) is None and line_for(got, a["id"])["quantity"] == 2


def test_wf_offline_sync_conflict(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    food = add_item(c, category="Food", grams=180, units=6, prefix="ration")
    lamp = add_item(c, category="Electronics", grams=56, units=2, prefix="lamp")
    lst = add_list(c)
    pack(c, lst["id"], food["id"], 4, "consumable")
    pack(c, lst["id"], lamp["id"])
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
        open_workspace(page, lst)
        _make_offline_ready(page)
        open_workspace(page, lst)
        eventually(page, lambda: btn(page, f"Decrease {food['name']}").count() == 1, "lines loaded")
        page.context.set_offline(True)
        eventually(page, lambda: text(status(page, "Connection")) != "", "offline banner")
        click(btn(page, f"Decrease {food['name']}"))
        click(btn(page, f"Decrease {food['name']}"))
        click(btn(page, f"Increase {lamp['name']}"))
        eventually(page, lambda: spin(page, food["name"]).input_value(timeout=SHORT_MS) == "2", "offline quantity")
        line = line_for(get_list(c, lst["id"]), food["id"])
        ok(set_line(c, lst["id"], line["id"], quantity=5), 200)
        ok(retire(c, lamp["id"], 2), 200)
        page.context.set_offline(False)
        changed = f"Not synced: {food['name']} was changed on another device."
        want = f"Back online. Synced 0 of 3 changes. {changed} {changed} Not synced: {lamp['name']} is no longer in your closet."
        see(page, status(page, "Sync results"), want, "sync results with refusals in queue order")
        eventually(page, lambda: spin(page, food["name"]).input_value(timeout=SHORT_MS) == "5", "spinbutton shows the server's 5")
    assert line_for(get_list(c, lst["id"]), food["id"])["quantity"] == 5


def test_sync_replays_each_change_once(app_url: str) -> None:
    c = hiker(root(app_url))
    item = add_item(c, units=3)
    other = add_item(c)
    lst = add_list(c)
    lid, iid = lst["id"], item["id"]

    def op(**kw: Any) -> dict:
        return {"opId": fresh("op"), "listId": lid, "itemId": iid, **kw}

    def results(r: httpx.Response) -> list[dict]:
        return ok(r, 200)["results"]

    p1 = op(type="pack")
    res = ok(sync(c, [p1]), 200)
    assert res["results"] == [{"opId": p1["opId"], "result": "applied", "reason": None}]
    assert any(s["id"] == lid for s in res["lists"])
    q1 = op(type="set_quantity", quantity=2, fromQuantity=1)
    assert results(sync(c, [q1]))[0]["result"] == "applied"
    assert results(sync(c, [q1]))[0] == {"opId": q1["opId"], "result": "applied", "reason": None}
    assert server_line(c, lid, iid)["quantity"] == 2, "a replayed op must not apply again"
    assert results(sync(c, [dict(q1, quantity=3)]))[0]["reason"] == "op_id_reused"
    assert results(sync(c, [q1]))[0]["result"] == "applied", "stored result stays after a reuse"
    deleted = add_item(c)
    assert c.delete(f"/api/closet/{deleted['id']}").status_code == 204
    gone = add_item(c)
    ok(retire(c, gone["id"], 1), 200)
    packed = add_list(c)
    pack(c, packed["id"], other["id"])
    ok(set_state(c, packed["id"], "packed"), 200)
    before = get_list(c, lid)["totals"]
    batch = [
        {"listId": lid, "itemId": iid, "type": "set_mode", "mode": "worn"},
        op(type="set_mode", mode="worn", fromQuantity=2),
        op(type="pack", colour="red"),
        op(type="set_quantity", quantity=3),
        op(type="set_mode", mode="flying"),
        dict(op(type="pack"), listId=probe_id(lid)),
        dict(op(type="pack"), itemId=deleted["id"]),
        dict(op(type="set_mode", mode="worn"), listId=packed["id"], itemId=other["id"]),
        dict(op(type="pack"), itemId=gone["id"]),
        op(type="pack"),
        dict(op(type="unpack"), itemId=other["id"]),
        op(type="set_quantity", quantity=3, fromQuantity=1),
        op(type="set_quantity", quantity=4, fromQuantity=2),
    ]
    expected = ["invalid_op", "invalid_op", "invalid_op", "invalid_op", "invalid_op", "unknown_list", "unknown_item",
                "list_not_editable", "item_retired", "already_packed", "not_packed", "line_changed", "quantity_exceeds_owned"]
    got = results(sync(c, batch))
    assert [r["reason"] for r in got] == expected, got
    assert all(r["result"] == "refused" for r in got)
    assert got[0]["opId"] is None and [r["opId"] for r in got[1:]] == [o["opId"] for o in batch[1:]]
    assert get_list(c, lid)["totals"] == before and server_line(c, lid, iid)["quantity"] == 2
    field_err(c.post("/api/sync", json={"ops": []}), "ops", "Send 1 to 200 changes.")
    field_err(c.post("/api/sync", json={"ops": [op(type="set_mode", mode="base") for _ in range(SYNC_MAX_OPS + 1)]}),
              "ops", "Send 1 to 200 changes.")
    full = results(sync(c, [op(type="set_mode", mode="base") for _ in range(SYNC_MAX_OPS)]))
    assert len(full) == SYNC_MAX_OPS and all(r["result"] == "applied" for r in full)


def test_sync_line_changed(app_url: str) -> None:
    c = hiker(root(app_url))
    food = add_item(c, category="Food", grams=180, units=6)
    for meddle in (True, False):
        lst = add_list(c)
        line = line_for(pack(c, lst["id"], food["id"], 4, "consumable"), food["id"])
        ops = [{"opId": fresh("op"), "listId": lst["id"], "itemId": food["id"], "type": "set_quantity", "quantity": 3, "fromQuantity": 4},
               {"opId": fresh("op"), "listId": lst["id"], "itemId": food["id"], "type": "set_quantity", "quantity": 2, "fromQuantity": 3}]
        if meddle:
            ok(set_line(c, lst["id"], line["id"], quantity=5), 200)
        res = ok(sync(c, ops), 200)["results"]
        if meddle:
            assert [r["reason"] for r in res] == ["line_changed", "line_changed"]
            assert server_line(c, lst["id"], food["id"])["quantity"] == 5
        else:
            assert [r["result"] for r in res] == ["applied", "applied"]
            assert server_line(c, lst["id"], food["id"])["quantity"] == 2


def test_messages_stay_until_replaced(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        item = add_item(c, units=2, grams=120)
        lst = add_list(c)
        pack(c, lst["id"], item["id"])
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            click(btn(page, "Share list"))
            dialog = page.get_by_role("dialog", name="Share list", exact=True)
            eventually(page, lambda: dialog.count() == 1, "Share dialog")
            click(btn(dialog, "Create link"))
            see(page, status(page, "Sharing"), "Share link created.", "share created copy")
            click(btn(dialog, "Close"))
            click(btn(page, "Print pack sheet"))
            see(page, status(page, "Pack sheet"), "Pack sheet ready.", "sheet ready copy", seconds=SHEET_SECONDS + POLL_SECONDS)
            click(btn(page, f"Increase {item['name']}"))
            pack_msg = f"Base weight {fmt(240)}. {delta_text(240, GOAL_GRAMS)}."
            see(page, status(page, "Pack updates"), pack_msg, "pack announcement")
            notice = page.get_by_text("This pack sheet is out of date. Print again to include your latest changes.", exact=True)
            eventually(page, lambda: notice.count() == 1, "out-of-date notice")
            click(btn(page, "Share list"))
            eventually(page, lambda: dialog.count() == 1, "Share dialog reopened")
            page.context.set_offline(True)
            offline_copy = "You're offline. Changes stay on this device and sync when you reconnect."
            see(page, status(page, "Connection"), offline_copy, "offline banner")
            skip_idle(page, TWO_MINUTES_MS)
            assert dialog.count() == 1, "an open dialog must not close on a timer"
            assert text(status(page, "Pack updates")) == pack_msg
            assert text(status(page, "Pack sheet")) == "Pack sheet ready."
            assert text(status(page, "Sharing")) == "Share link created."
            assert text(status(page, "Connection")) == offline_copy
            assert notice.count() == 1 and page.get_by_role("link", name="Download pack sheet", exact=True).count() == 1
            page.context.set_offline(False)
            eventually(page, lambda: text(status(page, "Connection")) == "", "banner leaves when the connection returns")


def test_wf_pack_sheet_print(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c, category="Shelter", grams=482)
    lst = add_list(c)
    pack(c, lst["id"], item["id"])
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
        open_workspace(page, lst)
        with held(page, "**/api/lists/*/pack-sheets") as hold:
            click(btn(page, "Print pack sheet"))
            see(page, status(page, "Pack sheet"), "Rendering pack sheet...", "pending copy")
            assert page.get_by_role("link", name="Download pack sheet", exact=True).count() == 0
            hold.release()
        see(page, status(page, "Pack sheet"), "Pack sheet ready.", "ready copy", seconds=SHEET_SECONDS + POLL_SECONDS)
        link = page.get_by_role("link", name="Download pack sheet", exact=True)
        eventually(page, lambda: link.count() == 1, "Download pack sheet link")
        with page.expect_download() as dl:
            click(link)
        data = Path(dl.value.path()).read_bytes()
    sheets = ok(c.get(f"/api/lists/{lst['id']}/pack-sheets"), 200)["sheets"]
    assert len(sheets) == 1
    key = f"pack-sheets/{lst['id']}/{sheets[0]['id']}.pdf"
    assert S3().get(key) == data, "downloaded PDF must equal the stored object"
    assert pdf_pages(data) >= 1
    words = norm(pdf_text(data))
    assert lst["name"] in words and "Pack sheet" in words


def test_pack_sheet_contents(app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    secret = f"secret-{fresh('note')}"
    price = 98765
    with grams_profile(c, displayName=fresh("Rowan"), paperSize="Letter") as prof:
        tarp = add_item(c, category="Shelter", grams=482, priceCents=price, notes=secret)
        socks = add_item(c, category="Clothing", grams=34, units=3)
        gone = add_item(c, category="Electronics", grams=56)
        closet_only = add_item(c, category="Kitchen", grams=73)
        lst = add_list(c)
        pack(c, lst["id"], tarp["id"])
        pack(c, lst["id"], socks["id"], 2, "worn")
        pack(c, lst["id"], gone["id"])
        ok(retire(c, gone["id"], 1), 200)
        sheet = ok(c.post(f"/api/lists/{lst['id']}/pack-sheets", json={}), 201)["sheet"]
        data = c.get(sheet["url"]).content
        words = norm(pdf_text(data))
        for part in [lst["name"], "Pack sheet", prof["displayName"], "planning", f"Shelter {fmt(482)}", f"Clothing {fmt(68)}",
                     f"1 × {tarp['name']}", f"2 × {socks['name']}", "worn 1, 1 in pack", f"Base {fmt(516)}", f"Worn {fmt(34)}",
                     f"Consumable {fmt(0)}", f"Skin-out {fmt(550)}", f"Goal {fmt(GOAL_GRAMS)}", delta_text(516, GOAL_GRAMS)]:
            assert part in words, f"pack sheet text lacks {part!r}"
        assert words.index(f"Shelter {fmt(482)}") < words.index(f"Clothing {fmt(68)}")
        for leak in [secret, "987.65", str(price), gone["name"], closet_only["name"]]:
            assert leak not in words, f"pack sheet leaks {leak!r}"
        _assert_paper(data, LETTER_IN[0] * PT_PER_IN, LETTER_IN[1] * PT_PER_IN)
        ok(c.patch("/api/profile", json={"paperSize": "A4"}), 200)
        a4 = c.get(ok(c.post(f"/api/lists/{lst['id']}/pack-sheets", json={}), 201)["sheet"]["url"]).content
        _assert_paper(a4, A4_MM[0] / MM_PER_IN * PT_PER_IN, A4_MM[1] / MM_PER_IN * PT_PER_IN)


def _assert_paper(data: bytes, width: Decimal, height: Decimal) -> None:
    boxes = re.findall(rb"/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]", data)
    assert boxes, "PDF carries no readable MediaBox"
    x0, y0, x1, y1 = (Decimal(v.decode()) for v in boxes[0])
    assert abs((x1 - x0) - width) <= PT_TOLERANCE and abs((y1 - y0) - height) <= PT_TOLERANCE, f"page size {(x1 - x0, y1 - y0)}"


def test_sheet_ready_only_when_stored(app_url: str) -> None:
    c = hiker(root(app_url))
    item = add_item(c)
    lst = add_list(c)
    pack(c, lst["id"], item["id"])
    sheet = ok(c.post(f"/api/lists/{lst['id']}/pack-sheets"), 201)["sheet"]
    assert sheet["status"] == "ready" and sheet["current"] is True and sheet["url"] == f"/api/pack-sheets/{sheet['id']}/pdf"
    key = f"pack-sheets/{lst['id']}/{sheet['id']}.pdf"
    stored = S3().get(key)
    served = c.get(sheet["url"])
    assert served.status_code == 200 and served.headers["content-type"].startswith("application/pdf")
    assert served.content == stored and pdf_pages(stored) >= 1 and sheet["bytes"] == len(stored)
    err(c.get(f"/api/pack-sheets/{probe_id(sheet['id'])}/pdf"), 404, "sheet_not_found")
    down = hiker(outage_url(MINIO_DOWN_ENV))
    d_item = add_item(down)
    d_list = add_list(down)
    pack(down, d_list["id"], d_item["id"])
    err(down.post(f"/api/lists/{d_list['id']}/pack-sheets", json={}), 503, "storage_unavailable")
    assert ok(down.get(f"/api/lists/{d_list['id']}/pack-sheets"), 200)["sheets"] == []


def test_wf_pack_sheet_outage(browser: Browser) -> None:
    base = outage_url(GOTENBERG_DOWN_ENV)
    c = hiker(base)
    with grams_profile(c):
        a = add_item(c, grams=100)
        b = add_item(c, category="Sleep", grams=60)
        lst = add_list(c)
        pack(c, lst["id"], a["id"])
        err(c.post(f"/api/lists/{lst['id']}/pack-sheets", json={}), 503, "printing_unavailable")
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            click(btn(page, "Print pack sheet"))
            see(page, status(page, "Pack sheet"), "Pack sheets can't be printed right now. Your list is unchanged; try again later.",
                "printing outage copy", seconds=POLL_SECONDS + SHEET_SECONDS)
            assert page.get_by_role("link", name="Download pack sheet", exact=True).count() == 0
            click(btn(page, f"Pack {b['name']}"))
            see(page, status(page, "Pack updates"), f"Base weight {fmt(160)}. {delta_text(160, GOAL_GRAMS)}.", "packing still works")
        assert ok(c.get(f"/api/lists/{lst['id']}/pack-sheets"), 200)["sheets"] == []
        assert S3("-gotenberg-down").keys(f"pack-sheets/{lst['id']}/") == []
        assert line_for(get_list(c, lst["id"]), b["id"]) is not None


def test_wf_pack_sheet_out_of_date(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        item = add_item(c, units=3)
        lst = add_list(c)
        pack(c, lst["id"], item["id"])
        current = lambda: ok(c.get(f"/api/lists/{lst['id']}/pack-sheets"), 200)["sheets"][0]["current"]
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            click(btn(page, "Print pack sheet"))
            see(page, status(page, "Pack sheet"), "Pack sheet ready.", "ready", seconds=SHEET_SECONDS + POLL_SECONDS)
            notice = page.get_by_text("This pack sheet is out of date. Print again to include your latest changes.", exact=True)
            assert notice.count() == 0
            click(btn(page, f"Increase {item['name']}"))
            eventually(page, lambda: notice.count() == 1, "notice after a change")
            assert current() is False
            skip_idle(page, TWO_MINUTES_MS)
            assert notice.count() == 1, "out-of-date notice must outlive two minutes"
            assert text(status(page, "Pack sheet")) == "Pack sheet ready."
            assert page.get_by_role("link", name="Download pack sheet", exact=True).count() == 1
            click(btn(page, f"Decrease {item['name']}"))
            eventually(page, lambda: notice.count() == 0, "undo clears the notice")
            assert current() is True
            check(mode_radio(page, item["name"], "Worn"))
            eventually(page, lambda: notice.count() == 1, "carry-mode change dates the sheet")
            click(btn(page, "Print pack sheet"))
            eventually(page, lambda: notice.count() == 0, "printing again clears the notice", seconds=SHEET_SECONDS + POLL_SECONDS)
        assert current() is True
        ok(patch_item(c, item["id"], {"name": item["name"] + "-x"}), 200)
        assert current() is False
        ok(patch_item(c, item["id"], {"name": item["name"]}), 200)
        assert current() is True
        ok(c.patch("/api/profile", json={"unit": "oz"}), 200)
        assert current() is False
        ok(c.patch("/api/profile", json={"unit": "g"}), 200)
        assert current() is True
        ok(patch_item(c, item["id"], {"category": "Sleep"}), 200)
        assert current() is False


def test_wf_share_link_partner(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    prof = ok(c.get("/api/profile"), 200)["profile"]
    socks = add_item(c, category="Clothing", grams=34, units=3)
    lst = add_list(c)
    pack(c, lst["id"], socks["id"], 2, "worn")
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
        open_workspace(page, lst)
        click(btn(page, "Share list"))
        dialog = page.get_by_role("dialog", name="Share list", exact=True)
        eventually(page, lambda: dialog.count() == 1, "Share dialog")
        click(btn(dialog, "Create link"))
        see(page, status(page, "Sharing"), "Share link created.", "created copy")
        field = dialog.get_by_role("textbox", name="Share link", exact=True)
        share = ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"]
        token = share["token"]
        assert len(token) >= TOKEN_MIN_CHARS and re.fullmatch(r"[A-Za-z0-9_-]+", token)
        eventually(page, lambda: field.input_value(timeout=SHORT_MS).endswith(f"/s/{token}"), "field holds the full link")
        link = field.input_value(timeout=SHORT_MS)
        click(btn(dialog, "Copy link"))
        eventually(page, lambda: page.evaluate("() => navigator.clipboard.readText()") == link, "Copy link fills the clipboard")
    target = link if link.startswith("http") else base + link
    with open_app(browser, target) as partner:
        partner.set_viewport_size(DESKTOP)
        eventually(partner, lambda: heading1(partner, lst["name"]).count() == 1, "partner sees the list heading")
        assert partner.get_by_text(f"Shared by {prof['displayName']}", exact=True).count() == 1
        table = partner.get_by_role("table", name="Shared pack list", exact=True)
        assert socks["name"] in text(table) and "worn 1, 1 in pack" in text(table)
        assert partner.get_by_role("region", name="Pack totals", exact=True).count() == 1
        for nav in ["Closet", "Trips", "Imports", "Settings"]:
            assert partner.get_by_role("link", name=nav, exact=True).count() == 0
        assert partner.get_by_role("button").count() == 0, "the shared view has no controls"
    r = httpx.get(f"{base}/api/share/{token}", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and "no-store" in r.headers.get("cache-control", "")
    assert r.json()["share"]["listName"] == lst["name"]


def test_wf_share_link_revoke(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c)
    lst = add_list(c)
    pack(c, lst["id"], item["id"])
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
        open_workspace(page, lst)
        click(btn(page, "Share list"))
        dialog = page.get_by_role("dialog", name="Share list", exact=True)
        eventually(page, lambda: dialog.count() == 1, "Share dialog")
        field = dialog.get_by_role("textbox", name="Share link", exact=True)
        click(btn(dialog, "Create link"))
        eventually(page, lambda: "/s/" in field.input_value(timeout=SHORT_MS), "link created")
        first = ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"]["token"]
        click(btn(dialog, "Revoke link"))
        see(page, status(page, "Sharing"), "Share link revoked.", "revoked copy")
        eventually(page, lambda: field.input_value(timeout=SHORT_MS) == "", "field cleared")
        err(anon.get(f"/api/share/{first}"), 404, "share_not_found")
        dead = anon.get(f"/s/{first}")
        assert dead.status_code == 404 and "This shared list is no longer available." in dead.text
        click(btn(dialog, "Create link"))
        eventually(page, lambda: btn(dialog, "Create new link").count() == 1, "button reads Create new link")
        second = ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"]["token"]
        click(btn(dialog, "Create new link"))
        eventually(page, lambda: ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"]["token"] != second, "link replaced")
        third = ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"]["token"]
        eventually(page, lambda: field.input_value(timeout=SHORT_MS).endswith(f"/s/{third}"), "field holds the new link")
    err(anon.get(f"/api/share/{second}"), 404, "share_not_found")
    ok(anon.get(f"/api/share/{third}"), 200)


def test_share_concurrent_and_read_only(app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c)
    lst = add_list(c)
    pack(c, lst["id"], item["id"])
    rs = together([lambda cl=clone(c): cl.post(f"/api/lists/{lst['id']}/share", json={}) for _ in range(CONCURRENCY)])
    assert all(r.status_code == 201 for r in rs), [r.status_code for r in rs]
    tokens = [r.json()["share"]["token"] for r in rs]
    active = ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"]["token"]
    assert active in tokens
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    for t in tokens:
        assert anon.get(f"/api/share/{t}").status_code == (200 if t == active else 404)
    for method in ["POST", "PUT", "PATCH", "DELETE"]:
        r = anon.request(method, f"/api/share/{active}", json={"listName": "x"})
        err(r, 405, "read_only")
        assert r.headers.get("allow") == "GET"
    assert get_list(c, lst["id"])["name"] == lst["name"] and ok(anon.get(f"/api/share/{active}"), 200)
    other = add_list(c)
    assert ok(anon.get(f"/api/share/{active}"), 200)["share"]["listName"] != other["name"]
    assert c.delete(f"/api/lists/{lst['id']}/share").status_code == 204
    assert c.delete(f"/api/lists/{lst['id']}/share").status_code == 204
    err(anon.get(f"/api/share/{active}"), 404, "share_not_found")


def test_share_link_expiry(app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    lst = add_list(c)
    with profile_as(c, timeZone="Pacific/Pago_Pago"):
        today = today_for_share(c, lst["id"])
        field_err(c.post(f"/api/lists/{lst['id']}/share", json={"expiresOn": (today - timedelta(days=1)).isoformat()}),
                  "expiresOn", "Choose today or a later date.")
        field_err(c.post(f"/api/lists/{lst['id']}/share", json={"expiresOn": "not-a-date"}), "expiresOn", "Choose today or a later date.")
        share = ok(c.post(f"/api/lists/{lst['id']}/share", json={"expiresOn": today.isoformat()}), 201)["share"]
        assert share["expiresOn"] == today.isoformat() and share["expired"] is False
        ok(anon.get(f"/api/share/{share['token']}"), 200)
        ok(c.patch("/api/profile", json={"timeZone": "Pacific/Kiritimati"}), 200)
        now = ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"]
        assert now["token"] == share["token"] and now["expired"] is True, "expiry is not revocation"
        err(anon.get(f"/api/share/{share['token']}"), 404, "share_not_found")
        assert anon.get(f"/s/{share['token']}").status_code == 404
        ok(c.patch("/api/profile", json={"timeZone": "Pacific/Pago_Pago"}), 200)
        assert ok(c.get(f"/api/lists/{lst['id']}/share"), 200)["share"]["expired"] is False
        ok(anon.get(f"/api/share/{share['token']}"), 200)
        open_ended = ok(c.post(f"/api/lists/{lst['id']}/share", json={}), 201)["share"]
        assert open_ended["expiresOn"] is None and open_ended["expired"] is False


def test_wf_share_link_expiry(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    lst = add_list(c)
    with profile_as(c, timeZone="Pacific/Pago_Pago"):
        today = today_for_share(c, lst["id"])
        notice = f"This link expired on {today.isoformat()}. Create a new link to share again."
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
            open_workspace(page, lst)
            click(btn(page, "Share list"))
            dialog = page.get_by_role("dialog", name="Share list", exact=True)
            eventually(page, lambda: dialog.count() == 1, "Share dialog")
            fill(dialog.get_by_role("textbox", name="Expires on", exact=True), today.isoformat())
            click(btn(dialog, "Create link"))
            see(page, status(page, "Sharing"), "Share link created.", "created")
            click(btn(dialog, "Close"))
            page.goto(f"{base}/settings")
            eventually(page, lambda: heading1(page, "Settings").count() == 1, "Settings")
            select(page.get_by_role("combobox", name="Time zone", exact=True), "Pacific/Kiritimati")
            click(btn(page, "Save settings"))
            see(page, status(page, "Settings"), "Settings saved.", "zone saved")
            page.goto(f"{base}/lists/{lst['id']}")
            open_workspace(page, lst)
            click(btn(page, "Share list"))
            eventually(page, lambda: dialog.get_by_text(notice, exact=True).count() == 1, "expired notice")
            assert "/s/" in dialog.get_by_role("textbox", name="Share link", exact=True).input_value(timeout=SHORT_MS)
            click(btn(dialog, "Close"))
            ok(c.patch("/api/profile", json={"timeZone": "Pacific/Pago_Pago"}), 200)
            click(btn(page, "Share list"))
            eventually(page, lambda: dialog.count() == 1 and "/s/" in dialog.get_by_role("textbox", name="Share link", exact=True)
                       .input_value(timeout=SHORT_MS), "dialog reloaded")
            assert dialog.get_by_text(notice, exact=True).count() == 0
            ok(c.patch("/api/profile", json={"timeZone": "Pacific/Kiritimati"}), 200)
            click(btn(dialog, "Close"))
            click(btn(page, "Share list"))
            eventually(page, lambda: dialog.get_by_text(notice, exact=True).count() == 1, "expired again")
            fill(dialog.get_by_role("textbox", name="Expires on", exact=True), "")
            click(btn(dialog, "Create new link"))
            eventually(page, lambda: dialog.get_by_text(notice, exact=True).count() == 0, "new link removes the notice")


def test_share_fields_only(app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    secret = f"private-{fresh('n')}"
    tarp = add_item(c, grams=482, priceCents=18900, notes=secret)
    gone = add_item(c, category="Electronics")
    closet_only = add_item(c, category="Kitchen")
    lst, other = add_list(c), add_list(c)
    pack(c, lst["id"], tarp["id"])
    pack(c, lst["id"], gone["id"])
    pack(c, other["id"], closet_only["id"])
    ok(retire(c, gone["id"], 1), 200)
    token = ok(c.post(f"/api/lists/{lst['id']}/share", json={}), 201)["share"]["token"]
    r = httpx.get(f"{base}/api/share/{token}", timeout=HTTP_TIMEOUT)
    body = ok(r, 200)
    assert set(body) == {"share"}
    s = body["share"]
    assert set(s) == {"listName", "state", "hikerName", "lines", "categories", "totals"}
    assert not {"id", "itemId", "token"} & set(s)
    assert [ln["name"] for ln in s["lines"]] == [tarp["name"]]
    line_keys = {"name", "category", "quantity", "mode", "unitWeightGrams", "lineWeightGrams", "baseGrams", "wornGrams",
                 "consumableGrams", "carryNote", "weightDisplay"}
    assert all(set(ln) == line_keys for ln in s["lines"])
    assert all(set(e) == {"category", "subtotalGrams", "baseGrams", "subtotalDisplay", "baseDisplay"} for e in s["categories"])
    assert set(s["totals"]) == {"baseGrams", "wornGrams", "consumableGrams", "skinOutGrams", "goalGrams", "deltaGrams", "display"}
    assert set(s["totals"]["display"]) == {"base", "worn", "consumable", "skinOut", "goal", "delta"}
    page = httpx.get(f"{base}/s/{token}", timeout=HTTP_TIMEOUT)
    assert page.status_code == 200 and tarp["name"] in page.text
    for blob in (r.text, page.text):
        for leak in [secret, "189.00", "18900", gone["name"], closet_only["name"], other["name"]]:
            assert leak not in blob, f"share leaks {leak!r}"


IMPORT_HEADER = ["Item Name", "Category", "weight", "unit", "desc", "qty", "price"]


def _import_dialog(page: Page) -> Locator:
    click(btn(page, "Import gear list"))
    dialog = page.get_by_role("dialog", name="Import gear list", exact=True)
    eventually(page, lambda: dialog.count() == 1, "Import dialog")
    return dialog


def _choose(dialog: Locator, name: str, data: bytes) -> None:
    dialog.get_by_label("CSV file").set_input_files({"name": name, "mimeType": "text/csv", "buffer": data})


def test_wf_gear_import_preview_confirm(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    tok = fresh("imp")
    quilt = add_item(c, category="Sleep", grams=595, name=f"{tok} down quilt")
    trowel = add_item(c, category="Hygiene", grams=17, name=f"{tok}trowel")
    new1, new2 = f"{tok} pot", f"{tok} oats"
    rows = [[f"{tok}  down\u00a0QUILT", "sleep", "595", "g", "", "", ""],
            [fullwidth(trowel["name"]), "HYGIENE", "17", "g", "", "", ""],
            [new1, "Kitchen", "1.0005", "kg", NOTE_MULTILINE, "2", PRICE_TEXT],
            [new2, "Food", "1.5", "lb", "", "", ""],
            [f"{tok} bad", "Nowhere", "1", "g", "", "", ""]]
    data = csv_bytes(IMPORT_HEADER, rows)
    filename = f"{tok}.csv"
    with signed_in(browser, base, "/imports", client=c) as page:
        eventually(page, lambda: heading1(page, "Imports").count() == 1, "Imports page")
        dialog = _import_dialog(page)
        _choose(dialog, filename, data)
        click(btn(dialog, "Preview import"))
        see(page, status(page, "Import"), "Import ready: 2 matched, 2 new, 1 rejected. Nothing is saved until you confirm.", "preview counts")
        preview = dialog.get_by_role("table", name="Import preview", exact=True)
        cells = lambda name: preview.get_by_role("cell", name=name, exact=True).count()
        assert (cells("Matched"), cells("New"), cells("Rejected: Unknown category")) == (2, 2, 1)
        assert items_named(c, new1) == [], "preview must write nothing"
        click(btn(dialog, "Confirm import"))
        see(page, status(page, "Import"), "Imported: 2 matched, 2 new, 1 rejected.", "confirm counts")
        eventually(page, lambda: dialog.count() == 0, "dialog closes")
        see_focus(page, btn(page, "Import gear list"), "Import gear list button")
        link = page.get_by_role("link", name=f"Download original {filename}", exact=True)
        eventually(page, lambda: link.count() == 1, "history row link")
        with page.expect_download() as dl:
            click(link)
        assert Path(dl.value.path()).read_bytes() == data
    pot = items_named(c, new1)
    assert len(pot) == 1 and pot[0]["weightGrams"] == 1001 and pot[0]["unitsOwned"] == 2
    assert pot[0]["notes"] == NOTE_MULTILINE and pot[0]["priceCents"] == PRICE_CENTS
    assert [it["weightGrams"] for it in items_named(c, new2)] == [680]
    assert get_item(c, quilt["id"])["weightGrams"] == 595 and len(items_named(c, quilt["name"])) == 1
    again = ok(upload_csv(c, data), 201)["import"]
    assert again["counts"] == {"matched": 4, "created": 0, "rejected": 1}
    assert ok(c.post(f"/api/imports/{again['id']}/commit", json={}), 200)["import"]["counts"]["created"] == 0
    assert len(items_named(c, new1)) == 1 and len(items_named(c, new2)) == 1


def test_wf_gear_import_unreadable(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    tok = fresh("bad")
    msg = "This file isn't readable as CSV."
    with signed_in(browser, base, "/imports", client=c) as page:
        eventually(page, lambda: heading1(page, "Imports").count() == 1, "Imports page")
        dialog = _import_dialog(page)
        field = dialog.get_by_label("CSV file")
        _choose(dialog, f"{tok}.csv", b"Item Name,Category,weight,unit\n\xff\xfe broken,Sleep,1,g\n")
        click(btn(dialog, "Preview import"))
        see(page, status(page, "Import"), msg, "refusal announced")
        eventually(page, lambda: field.get_attribute("aria-invalid") == "true", "aria-invalid set")
        expect(field).to_have_accessible_description(msg, timeout=SHORT_MS)
        see_focus(page, field, "CSV file field")
        assert dialog.count() == 1
        good = csv_bytes(REQUIRED_COLUMNS, [[f"{tok} a", "Food", "1", "g"], [f"{tok} b", "Nowhere", "1", "g"]])
        _choose(dialog, f"{tok}-ok.csv", good)
        eventually(page, lambda: field.get_attribute("aria-invalid") != "true", "new file clears aria-invalid")
        expect(field).to_have_accessible_description("", timeout=SHORT_MS)
        click(btn(dialog, "Preview import"))
        see(page, status(page, "Import"), "Import ready: 0 matched, 1 new, 1 rejected. Nothing is saved until you confirm.", "preview")
        preview = dialog.get_by_role("table", name="Import preview", exact=True)
        assert preview.get_by_role("cell", name="New", exact=True).count() == 1
        assert preview.get_by_role("cell", name="Rejected: Unknown category", exact=True).count() == 1
        _choose(dialog, f"{tok}-again.csv", good)
        eventually(page, lambda: preview.get_by_role("cell", name="New", exact=True).count() == 0, "new choice clears the old preview")
    assert imports_named(c, f"{tok}.csv") == []


def test_wf_gear_import_outage(browser: Browser) -> None:
    base = outage_url(MINIO_DOWN_ENV)
    c = hiker(base)
    tok = fresh("down")
    data = csv_bytes(REQUIRED_COLUMNS, [[f"{tok} item", "Food", "1", "g"]])
    err(upload_csv(c, data, f"{tok}.csv"), 503, "storage_unavailable")
    err(upload_csv(c, b"Item Name,Category\n\"open", f"{tok}-bad.csv"), 503, "storage_unavailable")
    with signed_in(browser, base, "/imports", client=c) as page:
        eventually(page, lambda: heading1(page, "Imports").count() == 1, "Imports page")
        dialog = _import_dialog(page)
        _choose(dialog, f"{tok}-ui.csv", data)
        click(btn(dialog, "Preview import"))
        see(page, status(page, "Import"), "File storage is unavailable, so nothing was imported. Try again later.", "outage copy")
    for name in (f"{tok}.csv", f"{tok}-bad.csv", f"{tok}-ui.csv"):
        assert imports_named(c, name) == []
    assert items_named(c, f"{tok} item") == []


def test_import_matching_rules(app_url: str) -> None:
    c = hiker(root(app_url))
    tok = fresh("match")
    existing = add_item(c, category="Sleep", grams=500, name=f"{tok} quilt")
    retired = add_item(c, category="Food", name=f"{tok} bar")
    ok(retire(c, retired["id"], 1), 200)
    new = f"{tok} cup"
    data = csv_bytes(REQUIRED_COLUMNS, [[f"{tok} QUILT", "Sleep", "999", "g"], [new, "Kitchen", "100", "g"],
                                        [f" {new.upper()} ", "kitchen", "200", "g"], [f"{tok} quilt", "SLEEP", "1", "g"],
                                        [f"{tok} bar", "food", "1", "g"]])
    imp = ok(upload_csv(c, data), 201)["import"]
    rows = imp["rows"]
    assert [(r["row"], r["outcome"], r["sameAsRow"]) for r in rows] == [(1, "matched", None), (2, "created", None),
                                                                       (3, "matched", 2), (4, "matched", 1), (5, "matched", None)]
    assert rows[0]["itemId"] == existing["id"] and rows[3]["itemId"] == existing["id"] and rows[4]["itemId"] == retired["id"]
    assert rows[1]["itemId"] is None and rows[2]["itemId"] is None and rows[2]["name"] == new.upper()
    assert imp["counts"] == {"matched": 4, "created": 1, "rejected": 0}
    done = ok(c.post(f"/api/imports/{imp['id']}/commit", json={}), 200)["import"]
    made = items_named(c, new)
    assert len(made) == 1 and made[0]["weightGrams"] == 100
    assert done["rows"][1]["itemId"] == made[0]["id"] and done["rows"][2]["itemId"] == made[0]["id"]
    assert get_item(c, existing["id"])["weightGrams"] == 500, "matching never changes the existing item"
    again = ok(upload_csv(c, data), 201)["import"]
    assert again["counts"]["created"] == 0
    ok(c.post(f"/api/imports/{again['id']}/commit", json={}), 200)
    assert len(items_named(c, new)) == 1


def test_import_commit_once(app_url: str) -> None:
    c = hiker(root(app_url))
    tok = fresh("commit")
    name = f"{tok} stove"
    imp = ok(upload_csv(c, csv_bytes(REQUIRED_COLUMNS, [[name, "Kitchen", "73", "g"]])), 201)["import"]
    assert imp["status"] == "previewed"
    rs = together([lambda cl=clone(c): cl.post(f"/api/imports/{imp['id']}/commit", json={}) for _ in range(CONCURRENCY)])
    assert [r.status_code for r in rs].count(200) == 1
    for r in rs:
        if r.status_code != 200:
            err(r, 409, "import_committed")
    assert len(items_named(c, name)) == 1
    assert ok(c.get(f"/api/imports/{imp['id']}"), 200)["import"]["status"] == "committed"
    later = f"{tok} pot"
    pending = ok(upload_csv(c, csv_bytes(REQUIRED_COLUMNS, [[later, "Kitchen", "100", "g"]])), 201)["import"]
    assert pending["rows"][0]["outcome"] == "created"
    made = add_item(c, category="Kitchen", name=later)
    done = ok(c.post(f"/api/imports/{pending['id']}/commit"), 200)["import"]
    assert done["rows"][0]["outcome"] == "matched" and done["rows"][0]["itemId"] == made["id"]
    assert done["counts"] == {"matched": 1, "created": 0, "rejected": 0} and len(items_named(c, later)) == 1
    err(c.post(f"/api/imports/{probe_id(pending['id'])}/commit", json={}), 404, "import_not_found")


def test_import_original_bytes(app_url: str) -> None:
    c = hiker(root(app_url))
    tok = fresh("orig")
    data = b"\xef\xbb\xbfItem Name,Category,weight,unit,desc\r\n" + f'{tok} a,Food,1,g,"two\r\nlines"\r\n'.encode()
    filename = f"{tok}.csv"
    imp = ok(upload_csv(c, data, filename), 201)["import"]
    assert imp["filename"] == filename and imp["bytes"] == len(data)
    assert S3().get(f"imports/{imp['id']}/original.csv") == data
    r = c.get(f"/api/imports/{imp['id']}/original")
    assert r.status_code == 200 and r.content == data and r.headers["content-type"].startswith("text/csv")
    assert f'filename="{filename}"' in r.headers.get("content-disposition", "")
    ok(c.post(f"/api/imports/{imp['id']}/commit", json={}), 200)
    assert c.get(f"/api/imports/{imp['id']}/original").content == data
    listed = imports_named(c, filename)
    assert len(listed) == 1 and listed[0]["status"] == "committed" and "rows" not in listed[0]


def test_unreadable_csv_refused_plainly(app_url: str) -> None:
    c = hiker(root(app_url))
    tok = fresh("unread")
    store = S3()
    secrets = [v for v in (os.environ.get("S3_BUCKET", ""), os.environ.get("S3_ENDPOINT", "")) if len(v) >= 4]
    for i, data in enumerate([b"Item Name,Category,weight,unit\n\xc3\x28 bad,Food,1,g\n",
                              b'Item Name,Category,weight,unit\n"never closed,Food,1,g\nnext,Food,1,g\n']):
        name = f"{tok}-{i}.csv"
        r = upload_csv(c, data, name)
        field_err(r, "file", "This file isn't readable as CSV.")
        for marker in ["node_modules", "    at ", ".ts:", "SELECT ", "imports/"] + secrets:
            assert marker not in r.text, f"error exposes {marker!r}"
        assert imports_named(c, name) == []
    field_err(upload_csv(c, b"", f"{tok}-empty.csv"), "file", "Choose a CSV file.")
    known = {str(i["id"]) for i in ok(c.get("/api/imports"), 200)["imports"]}
    for key in store.keys("imports/"):
        assert key.split("/")[1] in known, f"stored object {key} has no recorded import run"


CSV_CASES = ["multiline_quoted", "empty_lines", "duplicate_column", "missing_columns", "rows_2000", "rows_2001",
             "weights_and_values", "unicode_names", "bom_crlf"]


@pytest.mark.parametrize("case", CSV_CASES, ids=CSV_CASES)
def test_csv_records_exact(app_url: str, case: str) -> None:
    c = hiker(root(app_url))
    tok = fresh("csv")
    if case == "multiline_quoted":
        quoted = f'{tok} "big" bag'
        data = csv_bytes(["Item Name", "Category", "weight", "unit", "desc"],
                         [[f"{tok} a", "Sleep", "100", "g", "one\ntwo, three"], [quoted, "Pack", "50", "g", ""]])
        rows = ok(upload_csv(c, data), 201)["import"]["rows"]
        assert [(r["row"], r["name"], r["outcome"]) for r in rows] == [(1, f"{tok} a", "created"), (2, quoted, "created")]
    elif case == "empty_lines":
        data = f"Item Name,Category,weight,unit\n\n{tok} a,Food,1,g\n\n,,,\n   \n{tok} b,Food,1,g\n\n".encode()
        rows = ok(upload_csv(c, data), 201)["import"]["rows"]
        assert [(r["row"], r["outcome"], r["reason"]) for r in rows] == [
            (1, "created", None), (2, "rejected", "missing_name"), (3, "rejected", "missing_name"), (4, "created", None)]
    elif case == "duplicate_column":
        name = f"{tok}.csv"
        field_err(upload_csv(c, f"Item Name,Category,weight,unit, ITEM NAME \n{tok},Food,1,g,x\n".encode(), name),
                  "file", "Duplicate column: Item Name")
        assert imports_named(c, name) == []
    elif case == "missing_columns":
        field_err(upload_csv(c, f"Item Name,weight\n{tok},1\n".encode()), "file", "Missing column: Category")
    elif case in ("rows_2000", "rows_2001"):
        count = ROW_LIMIT if case == "rows_2000" else ROW_LIMIT + 1
        data = ("Item Name,Category,weight,unit\n" + "".join(f"{tok}-{i},Food,1,g\n" for i in range(count)) + "\n").encode()
        r = upload_csv(c, data)
        if count == ROW_LIMIT:
            assert len(ok(r, 201)["import"]["rows"]) == ROW_LIMIT
        else:
            field_err(r, "file", "A file can have at most 2000 rows.")
    elif case == "weights_and_values":
        spec = [("a", "Food", "1.0005", "kg", "", "", 1001, None), ("b", "Food", "0.0125", "kg", "", "", 13, None),
                ("c", "Food", "1.5", "lb", "", "", 680, None), ("d", "Food", "50000.4", "g", "", "", 50000, None),
                ("e", "Food", "50000.5", "g", "", "", None, "invalid_weight"), ("f", "Food", "1e3", "g", "", "", None, "invalid_weight"),
                ("g", "Food", ".5", "g", "", "", None, "invalid_weight"), ("h", "Food", "1,5", "g", "", "", None, "invalid_weight"),
                ("i", "Food", "-2", "g", "", "", None, "invalid_weight"), ("j", "Food", "", "g", "", "", None, "invalid_weight"),
                ("k", "Food", "5", "stone", "", "", None, "unknown_unit"), ("l", "Food", "5", "OUNCES", "", "", to_grams("5", "oz"), None),
                ("m", "Food", "1", "g", "02", "$1,234.50", 1, None), ("n", "Food", "1", "g", "2.0", "", None, "invalid_qty"),
                ("o", "Food", "1", "g", "+3", "", None, "invalid_qty"), ("p", "Food", "1", "g", "0", "", None, "invalid_qty"),
                ("q", "Food", "1", "g", "100", "", None, "invalid_qty"), ("r", "Food", "1", "g", "", "12.5", 1, None),
                ("s", "Food", "1", "g", "", PRICE_TEXT, 1, None), ("", "Food", "1", "g", "", "", None, "missing_name"),
                ("u", "Sleeping", "x", "stone", "", "", None, "unknown_category"), ("v", "Food", "abc", "stone", "", "", None, "invalid_weight")]
        rows = [[f"{tok} {n}" if n else "", cat, w, u, q, p] for n, cat, w, u, q, p, _, _ in spec]
        data = csv_bytes(["Item Name", "Category", "weight", "unit", "qty", "price"], rows)
        got = ok(upload_csv(c, data), 201)["import"]
        assert [r["reason"] for r in got["rows"]] == [s[7] for s in spec]
        ok(c.post(f"/api/imports/{got['id']}/commit", json={}), 200)
        for n, _, _, _, _, _, grams, reason in spec:
            if reason is None:
                assert [it["weightGrams"] for it in items_named(c, f"{tok} {n}")] == [grams], n
        assert items_named(c, f"{tok} m")[0]["unitsOwned"] == 2 and items_named(c, f"{tok} m")[0]["priceCents"] is None
        assert items_named(c, f"{tok} r")[0]["priceCents"] is None and items_named(c, f"{tok} s")[0]["priceCents"] == PRICE_CENTS
    elif case == "unicode_names":
        e1 = add_item(c, category="Sleep", name=f"{tok} down quilt")
        e2 = add_item(c, category="Hygiene", name=f"{tok}trowel")
        e3 = add_item(c, category="Kitchen", name=f"{tok} camp mug")
        rows = [[f"{tok}  down\u00a0QUILT", "sleep", "1", "g"], [fullwidth(e2["name"]), "HYGIENE", "1", "g"],
                [f"  {tok}\u3000camp\u2003mug  ", "kitchen", "1", "g"]]
        got = ok(upload_csv(c, csv_bytes(REQUIRED_COLUMNS, rows)), 201)["import"]["rows"]
        assert [(r["outcome"], r["itemId"]) for r in got] == [("matched", e1["id"]), ("matched", e2["id"]), ("matched", e3["id"])]
        assert got[2]["name"] == f"{tok}\u3000camp\u2003mug"
    elif case == "bom_crlf":
        data = b"\xef\xbb\xbfItem Name,Category,weight,unit\r\n" + f"{tok} a,Food,1,g\r\n".encode()
        rows = ok(upload_csv(c, data), 201)["import"]["rows"]
        assert [(r["name"], r["category"], r["outcome"]) for r in rows] == [(f"{tok} a", "Food", "created")]


def _regions(page: Page) -> dict[str, dict]:
    return {n: box(page.get_by_role("region", name=n, exact=True)) for n in ("Pack totals", "Closet", "Pack list", "Pack Strata")}


def test_wf_responsive_workspace_breakpoints(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    item = add_item(c, name=fresh("long") + " ultralight trekking pole tent with extra long name")
    other = add_item(c, category="Sleep")
    lst = add_list(c)
    pack(c, lst["id"], other["id"])
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c) as page:
        open_workspace(page, lst)
        for vp in (PHONE, JUST_BELOW_TABLET):
            page.set_viewport_size(vp)
            advance(page, TICK_MS)
            layout(page)
            r = _regions(page)
            toggle = box(btn(page, "Pack Strata"))
            assert r["Pack totals"]["y"] < toggle["y"] < r["Pack list"]["y"] < r["Closet"]["y"], f"one-column order at {vp}"
        for vp in (TABLET, JUST_BELOW_DESKTOP):
            page.set_viewport_size(vp)
            advance(page, TICK_MS)
            layout(page)
            r = _regions(page)
            assert r["Closet"]["x"] + r["Closet"]["width"] <= r["Pack list"]["x"] + PX_TOLERANCE, f"two panes at {vp}"
            assert r["Pack Strata"]["y"] >= r["Pack list"]["y"] + r["Pack list"]["height"] - PX_TOLERANCE
            assert abs(r["Pack Strata"]["x"] - r["Pack list"]["x"]) <= r["Pack list"]["width"]
            assert btn(page, "Pack Strata").count() == 0
        for vp in (DESKTOP_EDGE, DESKTOP):
            page.set_viewport_size(vp)
            advance(page, TICK_MS)
            layout(page)
            r = _regions(page)
            assert r["Closet"]["x"] < r["Pack list"]["x"] < r["Pack Strata"]["x"], f"three columns at {vp}"
            tops = [r[n]["y"] for n in ("Closet", "Pack list", "Pack Strata")]
            assert max(tops) - min(tops) <= PX_TOLERANCE and min(tops) >= r["Pack totals"]["y"] + r["Pack totals"]["height"] - PX_TOLERANCE
        for path in ("/closet", "/trips", "/imports", "/settings"):
            for vp in (PHONE, TABLET, DESKTOP):
                page.set_viewport_size(vp)
                page.goto(base + path)
                eventually(page, lambda: page.get_by_role("heading", level=1).count() >= 1, f"{path} loaded")
                layout(page)
        assert item["name"]


def test_wf_responsive_workspace_phone_touch(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    a = add_item(c, units=3)
    b = add_item(c, category="Sleep")
    lst = add_list(c)
    pack(c, lst["id"], a["id"])
    with signed_in(browser, base, f"/lists/{lst['id']}", client=c, viewport=PHONE) as page:
        open_workspace(page, lst)
        targets = [btn(page, f"Pack {b['name']}"), btn(page, f"Unpack {a['name']}"), btn(page, f"Decrease {a['name']}"),
                   btn(page, f"Increase {a['name']}"), btn(page, "Pack Strata")] + \
                  [mode_radio(page, a["name"], m) for m in ("Base", "Worn", "Consumable")]
        for t in targets:
            eventually(page, lambda t=t: t.count() == 1, "phone control present")
            bb = box(t)
            assert bb["width"] >= TOUCH_MIN_PX - 0.5 and bb["height"] >= TOUCH_MIN_PX - 0.5, f"touch target {bb}"
        toggle = btn(page, "Pack Strata")
        assert toggle.get_attribute("aria-expanded") == "false"
        tap(toggle)
        eventually(page, lambda: toggle.get_attribute("aria-expanded") == "true" and strata_list(page).count() == 1, "strip opens")
        tap(toggle)
        eventually(page, lambda: toggle.get_attribute("aria-expanded") == "false" and strata_list(page).count() == 0, "strip closes")
        tap(btn(page, f"Increase {a['name']}"))
        eventually(page, lambda: server_line(c, lst["id"], a["id"])["quantity"] == 2, "tap changes quantity")
        click(btn(page, "Share list"))
        dialog = page.get_by_role("dialog", name="Share list", exact=True)
        eventually(page, lambda: dialog.count() == 1, "Share dialog")
        for b_ in dialog.get_by_role("button").all():
            bb = box(b_)
            assert bb["width"] >= TOUCH_MIN_PX - 0.5 and bb["height"] >= TOUCH_MIN_PX - 0.5, f"dialog button {bb}"


def test_wf_responsive_workspace_collapsed(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    with grams_profile(c):
        a = add_item(c, grams=300)
        b = add_item(c, category="Sleep", grams=200)
        lst = add_list(c)
        pack(c, lst["id"], a["id"])
        with signed_in(browser, base, f"/lists/{lst['id']}", client=c, viewport=PHONE) as page:
            open_workspace(page, lst)
            toggle = btn(page, "Pack Strata")
            eventually(page, lambda: toggle.count() == 1, "toggle")
            assert toggle.get_attribute("aria-expanded") == "false"

            def collapsed_clean() -> None:
                assert strata_list(page).count() == 0
                for rx in ("^Worn ", "^Consumable ", "^Goal ", "^Over goal by "):
                    assert page.get_by_role("img", name=re.compile(rx)).count() == 0

            collapsed_clean()
            assert page.get_by_text(f"Base {fmt(300)}, {delta_text(300, GOAL_GRAMS)}.", exact=True).count() == 1
            toggle.focus()
            nxt = tab_order(page, 1)[0]
            assert not re.match(r"^(Shelter|Sleep): |^(Worn|Consumable|Goal) ", nxt or ""), f"Tab reached a collapsed band: {nxt}"
            chip = f"Moving {b['name']}, {fmt(200)}"
            click(btn(page, f"Pack {b['name']}"))
            for _ in range(int(SEQUENCE_MAX_MS / SAMPLE_MS)):
                assert page.get_by_role("img", name=chip, exact=True).count() == 0, "no chip while collapsed"
                advance(page, SAMPLE_MS)
            eventually(page, lambda: page.get_by_text(f"Base {fmt(500)}, {delta_text(500, GOAL_GRAMS)}.", exact=True).count() == 1,
                       "summary updates")
            collapsed_clean()
            assert toggle.get_attribute("aria-expanded") == "false", "changes keep the hiker's strip state"
            click(toggle)
            eventually(page, lambda: strata_list(page).count() == 1, "expanded")
            page.set_viewport_size(TABLET)
            eventually(page, lambda: btn(page, "Pack Strata").count() == 0
                       and page.get_by_role("button", name="Pack Strata", exact=True, include_hidden=True).count() == 0
                       and page.get_by_text(f"Base {fmt(500)}, {delta_text(500, GOAL_GRAMS)}.", exact=True).count() == 0,
                       "no toggle or summary from 768 px")
            page.set_viewport_size(PHONE)
            eventually(page, lambda: btn(page, "Pack Strata").get_attribute("aria-expanded") == "true", "phone state kept across resize")
            page.reload()
            open_workspace(page, lst)
            eventually(page, lambda: btn(page, "Pack Strata").get_attribute("aria-expanded") == "false", "collapsed on every load")


def test_item_versions(app_url: str) -> None:
    c = hiker(root(app_url))
    item = add_item(c, units=3)
    iid = item["id"]
    assert item["version"] == 1
    r = c.patch(f"/api/closet/{iid}", json={"notes": "x"})
    err(r, 428, "precondition_required", "Send the version you last saw.")
    stale_whole = dict(item)
    ok(patch_item(c, iid, {"notes": "laptop"}, version=1), 200)
    err(patch_item(c, iid, stale_whole, version=1), 412, "item_changed", f"{item['name']} changed on another device.")
    e = err(patch_item(c, iid, stale_whole, version=2), 422, "validation_failed")
    assert "weightGrams" in e["fields"] and "version" in e["fields"]
    assert get_item(c, iid)["notes"] == "laptop" and get_item(c, iid)["version"] == 2
    lst = add_list(c)
    pack(c, lst["id"], iid)
    assert get_item(c, iid)["version"] == 2, "packing never changes the version"
    ok(retire(c, iid, 1), 200)
    assert get_item(c, iid)["version"] == 3
    err(patch_item(c, iid, {"notes": "phone"}, version=2), 412, "item_changed")
    ok(c.post(f"/api/closet/{iid}/photo", files={"photo": ("p.png", png_bytes(), "image/png")}), 201)
    assert get_item(c, iid)["version"] == 4
    err(c.patch(f"/api/closet/{probe_id(iid)}", json={"notes": "x"}, headers={"If-Match": '"1"'}), 404, "item_not_found")
    rs = together([lambda cl=clone(c), i=i: patch_item(cl, iid, {"notes": f"device {i}"}, version=4) for i in range(2)])
    assert sorted(r.status_code for r in rs) == [200, 412]
    assert get_item(c, iid)["version"] == 5


def test_wf_edit_conflicts_two_devices(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    quilt = add_item(c, category="Sleep", grams=595, prefix="quilt")
    n = quilt["name"]
    with signed_in(browser, base, "/closet", client=c) as page:
        row = ledger_row(page, "Closet ledger", n)
        eventually(page, lambda: row.count() == 1, "quilt row")
        click(btn(row, f"Edit {n}"))
        dialog = page.get_by_role("dialog", name=f"Edit {n}", exact=True)
        eventually(page, lambda: dialog.count() == 1, "Edit dialog")
        ok(patch_item(c, quilt["id"], {"weight": {"value": 610, "unit": "g"}}, version=1), 200)
        check(dialog.get_by_role("radio", name="g", exact=True))
        fill(dialog.get_by_role("spinbutton", name="Weight", exact=True), "580")
        click(btn(dialog, "Save gear"))
        copy = f"{n} changed on another device. Close this form and open it again to see the latest."
        see(page, status(page, "Closet updates"), copy, "conflict announcement")
        eventually(page, lambda: dialog.get_by_text(copy, exact=True).count() == 1, "conflict copy in the form")
        see_focus(page, btn(dialog, "Cancel"), "dialog Cancel")
    after = get_item(c, quilt["id"])
    assert after["weightGrams"] == 610 and after["version"] == 2


def test_wf_edit_conflicts_reopen(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    quilt = add_item(c, category="Sleep", grams=595, prefix="quilt")
    n = quilt["name"]
    with signed_in(browser, base, "/closet", client=c) as page:
        row = ledger_row(page, "Closet ledger", n)
        eventually(page, lambda: row.count() == 1, "quilt row")
        click(btn(row, f"Edit {n}"))
        dialog = page.get_by_role("dialog", name=f"Edit {n}", exact=True)
        eventually(page, lambda: dialog.count() == 1, "Edit dialog")
        ok(patch_item(c, quilt["id"], {"weight": {"value": 610, "unit": "g"}}, version=1), 200)
        click(btn(dialog, "Save gear"))
        eventually(page, lambda: btn(dialog, "Cancel").count() == 1 and focused(btn(dialog, "Cancel")), "conflict shown")
        click(btn(dialog, "Cancel"))
        eventually(page, lambda: dialog.count() == 0, "dialog closed")
        click(btn(ledger_row(page, "Closet ledger", n), f"Edit {n}"))
        eventually(page, lambda: dialog.count() == 1, "dialog reopened")
        check(dialog.get_by_role("radio", name="g", exact=True))
        weight = dialog.get_by_role("spinbutton", name="Weight", exact=True)
        eventually(page, lambda: weight.input_value(timeout=SHORT_MS) == "610", "latest weight loaded")
        fill(weight, REWEIGH_INPUT)
        click(btn(dialog, "Save gear"))
        see(page, status(page, "Closet updates"), f"Saved {n}.", "save succeeds")
    after = get_item(c, quilt["id"])
    assert after["weightGrams"] == int(REWEIGH_INPUT) and after["version"] == 3


APP_DIR = Path("/app")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def test_if_run_manifest() -> None:
    data = json.loads((APP_DIR / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in data.values())


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    for p in shipped_packages():
        assert p.name in notices, f"notices omit {p.name}"
        assert p.version in notices, f"notices omit the version of {p.name}"
    for font in ["Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"]:
        assert font in notices, f"notices omit font {font}"


def test_if_licences_allowed() -> None:
    bad = [f"{p.name}@{p.version}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad}"
    assert re.search(r"OFL|Open Font License", (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text())


def test_if_no_extra_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "sql.js", "level", "leveldown", "lmdb", "nedb", "lowdb", "redis", "ioredis", "mongodb"}
    shipped = {p.name for p in shipped_packages()}
    assert not (shipped & banned), f"extra datastore packages: {shipped & banned}"
    skip = {"node_modules", ".git"}
    for path in APP_DIR.rglob("*"):
        if skip & set(path.parts):
            continue
        assert path.suffix not in {".sqlite", ".sqlite3", ".db"}, f"database file {path}"


def test_if_compose_untouched() -> None:
    traj = Path("/logs/agent/trajectory.json")
    if not traj.exists():
        return
    blob = traj.read_text(errors="replace")
    pattern = re.compile(r"(sed\s+-i[^\n]{0,200}compose[^\s\"']*\.ya?ml|>\s*\S*compose[^\s\"']*\.ya?ml|"
                         r"\"(?:file_path|path)\"\s*:\s*\"[^\"]*compose[^\"]*\.ya?ml\"[^}]{0,400}\"(?:new_string|content)\")")
    assert not pattern.search(blob), "the agent modified a provided compose file"


def test_if_typescript_sources() -> None:
    skip = {"node_modules", ".git", "dist", "build", "out", ".next", "coverage"}
    offenders = []
    for path in APP_DIR.rglob("*"):
        if skip & set(path.relative_to(APP_DIR).parts) or not path.is_file():
            continue
        if path.suffix in {".js", ".mjs", ".cjs", ".jsx"} and not re.search(r"(config|rc)\.", path.name) and not path.name.startswith("."):
            offenders.append(str(path))
    assert not offenders, f"plain JavaScript source files: {offenders}"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    c = hiker(base)
    lst = add_list(c)
    with signed_in(browser, base, "/sign-in", client=c) as page:
        seen: list[str] = []
        page.on("request", lambda req: seen.append(req.url))
        for path in ["/sign-in", "/closet", "/trips", "/imports", "/settings", f"/lists/{lst['id']}"]:
            page.goto(base + path)
            eventually(page, lambda: page.get_by_role("heading", level=1).count() >= 1 or "/sign-in" in page.url, f"{path} loaded")
            advance(page, SEQUENCE_MAX_MS)
        foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, base)]
        assert not foreign, f"requests left the app origin: {foreign[:5]}"
