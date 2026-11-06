from __future__ import annotations

import concurrent.futures as cf
import csv
import datetime as dt
import io
import json
import os
import re
import struct
import subprocess
import threading
import time
import uuid
import zlib
from contextlib import contextmanager
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    S3,
    Postgres,
    addresses,
    advance,
    capture,
    center,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    same_origin,
    select,
    text,
)


PASSWORD = "kilnroom-2026"
NEW_PASSWORD = "wedged-clay-2026"
TIMEOUT = 60
LIVE_S = 3
UI_S = 20
MAIL_S = 10
NO_MAIL_S = 3
SETTLE_S = 150
STORAGE_WAIT_S = 240
LOCK_WAIT_S = 60
REMINDER_WAIT_S = 60
REMINDER_SETTLE_S = 8
STEP_MS = 400
QUICK_MS = 150
NPM_TIMEOUT = 300
RACE = 6
TAB_MAX = 12
RAIL_MAX = 400
JSON_LIMIT = 100_000
PHOTO_LIMIT = 5_000_000
REQUEST_LIMIT = 5_100_000
LONG_ID = "x" * 10_000
MAX_DIM = 24
STACK_IN = Decimal("27.0")
SHELF_IN = Decimal("0.625")
CLEARANCE_IN = Decimal("0.5")
FAILS = 5
PACKS_PER_DAY = 3
ANIM_SETTLE_MS = 1000
FIGURE_SETTLE_MS = 1500
EARLY_MS = 50
ELEVATION_MIN_PX = 420
PNG_PX = 64
REMINDER_WINDOW = 3
STORAGE_FEE = 50
UUID_RE = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

SLOW_PROXY_PORT = 18091
SWITCH_PROXY_PORT = 18092
SLOW_PROXY_DELAY_S = 7


def _serve_proxy(port: int, delay: float) -> None:
    import asyncio

    target = urlparse(os.environ["KILLBILL_URL"])
    host, tport = target.hostname, target.port or 80

    async def handle(cr: Any, cw: Any) -> None:
        try:
            sr, sw = await asyncio.open_connection(host, tport)
        except OSError:
            cw.close()
            return
        loop = asyncio.get_running_loop()

        async def upstream() -> None:
            try:
                while data := await cr.read(65536):
                    sw.write(data)
                    await sw.drain()
            except OSError:
                pass
            finally:
                sw.close()

        async def answers() -> None:
            try:
                while data := await sr.read(65536):
                    loop.call_later(delay, cw.write, data)
            except OSError:
                pass
            loop.call_later(delay, cw.close)

        await asyncio.gather(upstream(), answers(), return_exceptions=True)

    async def main() -> None:
        server = await asyncio.start_server(handle, "127.0.0.1", port)
        async with server:
            await server.serve_forever()

    asyncio.run(main())


@pytest.fixture(scope="session", autouse=True)
def kill_bill_proxies() -> None:
    for port, delay in ((SLOW_PROXY_PORT, SLOW_PROXY_DELAY_S), (SWITCH_PROXY_PORT, 0)):
        threading.Thread(target=_serve_proxy, args=(port, delay), daemon=True).start()


STUDIOS = {"ember-lane": "Ember Lane Clay", "saltmarsh": "Saltmarsh Pottery Co-op", "andes": "Andes Kiln Works"}
TZ = {"ember-lane": "Pacific/Auckland", "saltmarsh": "Pacific/Honolulu", "andes": "America/Santiago"}
OWNER = {"ember-lane": "rowan@ember-lane.example", "saltmarsh": "dana@saltmarsh.example", "andes": "valentina@andes.example"}
TECH = {"ember-lane": "ines@ember-lane.example", "saltmarsh": "kofi@saltmarsh.example", "andes": "matias@andes.example"}
THEO = "theo@ember-lane.example"
PRIYA = "priya@ember-lane.example"
WEN = "wen@ember-lane.example"
ANA = "ana@saltmarsh.example"
CAMILA = "camila@andes.example"
DIEGO = "diego@andes.example"
SHELF = {"North Kiln": Decimal("380.0"), "South Kiln": Decimal("264.0"), "Tide Kiln": Decimal("380.0")}

VASE = (5.2, 5.0, 11.3)
BOWL = (6.1, 6.1, 3.2)
MUG = (3.6, 4.4, 4.0)
JAR = (4.0, 4.0, 6.0)
EXAMPLE = (5.2, 4.1, 7.0)
WIDE = (18, 18, 2)
EXACT85 = (17, 19, 1)
TINY = (1, 1, 1)
TALL = (5, 5, 24)
TOWER = (5, 5, 15)
SQUAT = (4, 4, 2)
SLAB = (17, 17, 2)
TILE = (6, 6, 1)

FOREIGN_ORIGIN = "http://elsewhere.example"
JSON_CT = {"Content-Type": "application/json"}
TICKET_KEYS = {"id", "title", "status", "clay_body", "length_in", "width_in", "height_in", "photo_url", "owner_handle", "waiting_since"}
DIM_MSG = "Enter a number above 0 and up to 24 inches, with at most two decimals."
DECK_MSG = "That deck is no longer in this load."
KILN_MSG = "Choose a kiln and a firing."
CENTS_MSG = "Enter whole cents from 1 to 100."
LIMIT_COPY = "You can buy at most 3 credit packs a day. Try again after midnight studio time."
HEADER = "date,entry,charge_id,member_handle,piece_title,firing,cubic_inches,rate_cents,amount"
BAD_IDS = [LONG_ID, str(uuid.uuid4()), "%00", "..%2F"]
BAD_DECKS = ["0", "-1", "9007199254740992", "abc"]
BAD_MONTHS = ["2026-13", "2026-1", "abcd-ef"]
NEVER_SERVED = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/node_modules/.package-lock.json", "/src/index.ts"]
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
TILES = ["Logged", "Waiting for bisque", "Bisqued", "Waiting for glaze", "Ready for pickup"]
APP = Path("/app")


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=TIMEOUT)
        self.user: dict[str, Any] = {}
        self.email = ""
        self.password = PASSWORD

    @property
    def id(self) -> str:
        return self.user["id"]

    @property
    def handle(self) -> str:
        return self.user["handle"]

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.get(path, **kw)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.http.put(path, json=body)

    def post(self, path: str, body: Any = None, key: str | None = None, headers: dict | None = None) -> httpx.Response:
        h = dict(headers or {})
        if key is not None:
            h["Idempotency-Key"] = key
        if body is None:
            return self.http.post(path, headers=h)
        return self.http.post(path, json=body, headers=h)


def j(r: httpx.Response, code: int = 200) -> Any:
    assert r.status_code == code, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:400]}"
    return r.json() if r.content else None


def err(r: httpx.Response, code: int, error: str) -> dict:
    assert r.status_code == code, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:400]}"
    b = r.json()
    assert b.get("error") == error and isinstance(b.get("message"), str) and b["message"], b
    extra = {"errors"} if code == 422 else {"next_purchase_at"} if error == "pack_limit_reached" else set()
    assert {"error", "message"} <= set(b) <= {"error", "message"} | extra, b
    return b


def invalid(r: httpx.Response, field: str | None, message: str) -> None:
    b = err(r, 422, "validation")
    assert isinstance(b.get("errors"), dict), b
    if field is None:
        assert message in b["errors"].values(), b
    else:
        assert b["errors"].get(field) == message, b


def user_of(body: dict) -> dict:
    return body.get("user", body)


def sign_in(base: str, slug: str, email: str, password: str = PASSWORD) -> Api:
    api = Api(base)
    body = j(api.post("/api/session", {"studio": slug, "email": email, "password": password}))
    api.user, api.email, api.password = user_of(body), email, password
    return api


def poll(fn: Any, seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < deadline, f"timed out after {seconds}s waiting for {what}"


def inbox(mail: Any, to: str, subject: str, n: int = 1, seconds: float = MAIL_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages(0, 0) if to.lower() in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject]
        if len(found) >= n or time.monotonic() > deadline:
            return found


def invite_links(mail: Any, slug: str, email: str, n: int = 1) -> list[str]:
    found = inbox(mail, email, f"Join {STUDIOS[slug]} on Kiln Desk", n)
    assert len(found) >= n, f"expected {n} invite emails to {email}, got {len(found)}"
    return [re.search(r"https?://[^\s\"'<>]+/invite/[^\s\"'<>)]+", text(m)).group(0) for m in found]


def token_of(link: str) -> str:
    return link.rsplit("/invite/", 1)[1]


def fresh_email() -> str:
    return f"potter-{uuid.uuid4().hex[:12]}@kiln-test.example"


def new_member(base: str, mail: Any, slug: str = "ember-lane", membership: str = "member") -> Api:
    tag = uuid.uuid4().hex[:12]
    email = f"potter-{tag}@kiln-test.example"
    owner = sign_in(base, slug, OWNER[slug])
    j(owner.post("/api/invites", {"email": email, "role": "member", "membership": membership}), 201)
    token = token_of(invite_links(mail, slug, email)[0])
    api = Api(base)
    body = j(api.post(f"/api/invites/{token}/accept", {"name": f"Potter {tag}", "handle": f"p-{tag}", "password": NEW_PASSWORD}), 201)
    api.user, api.email, api.password = user_of(body), email, NEW_PASSWORD
    return api


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(shade: int = 0) -> bytes:
    rows = b"".join(b"\x00" + b"".join(bytes(((x * 4) % 256, (y * 4) % 256, shade % 256)) for x in range(PNG_PX)) for y in range(PNG_PX))
    header = struct.pack(">IIBBBBB", PNG_PX, PNG_PX, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", header) + _chunk(b"IDAT", zlib.compress(rows)) + _chunk(b"IEND", b"")


def upload(m: Api, pid: str, data: bytes | None = None, name: str = "intake.png", ctype: str = "image/png") -> httpx.Response:
    return m.http.put(f"/api/pieces/{pid}/photo", files={"photo": (name, png() if data is None else data, ctype)})


def log_piece(m: Api, dims: tuple, title: str | None = None, photo: bool = True) -> dict:
    clay = j(m.get("/api/clay-bodies"))[0]["id"]
    title = title or f"Piece {uuid.uuid4().hex[:10]}"
    body = {"title": title, "clay_body_id": clay, "length_in": dims[0], "width_in": dims[1], "height_in": dims[2]}
    p = j(m.post("/api/pieces", body), 201)
    if photo:
        j(upload(m, p["id"]))
    return p


def ready(m: Api, staff: Api, dims: tuple, title: str | None = None) -> dict:
    p = log_piece(m, dims, title)
    j(staff.post(f"/api/pieces/{p['id']}/check-in"))
    return p


def passport(api: Api, pid: str) -> dict:
    return j(api.get(f"/api/pieces/{pid}"))


def kiln_id(staff: Api, name: str) -> str:
    return next(k["id"] for k in j(staff.get("/api/kilns")) if k["name"] == name)


def new_load(staff: Api, kiln: str, firing: str = "bisque") -> dict:
    return j(staff.post("/api/loads", {"kiln_id": kiln_id(staff, kiln), "firing": firing}), 201)


def place(staff: Api, lid: str, pid: str, deck: Any = 1) -> httpx.Response:
    return staff.post(f"/api/loads/{lid}/placements", {"piece_id": pid, "deck": deck})


def move(staff: Api, lid: str, pid: str, deck: Any) -> httpx.Response:
    return staff.post(f"/api/loads/{lid}/moves", {"piece_id": pid, "deck": deck})


def set_status(staff: Api, lid: str, status: str) -> httpx.Response:
    return staff.post(f"/api/loads/{lid}/status", {"status": status})


def unload(staff: Api, lid: str, outcomes: dict, key: str | None = None) -> httpx.Response:
    return staff.post(f"/api/loads/{lid}/unload", {"outcomes": outcomes}, key=key or idempotency_key())


def load_pieces(load: dict) -> list[list[str]]:
    return [[t["id"] for t in d["pieces"]] for d in load["decks"]]


def free_kiln(staff: Api, kid: str, keep: str = "") -> None:
    for load in j(staff.get("/api/loads", params={"open": 1})):
        if load["kiln"]["id"] != kid or load["id"] == keep:
            continue
        if load["status"] == "loaded":
            set_status(staff, load["id"], "cancelled")
        if load["status"] == "firing":
            set_status(staff, load["id"], "cooling")
            load["status"] = "cooling"
        if load["status"] == "cooling":
            unload(staff, load["id"], {t["id"]: "damaged" for d in load["decks"] for t in d["pieces"]})


def to_cooling(staff: Api, load: dict) -> None:
    free_kiln(staff, load["kiln"]["id"], load["id"])
    for status in ("loaded", "firing", "cooling"):
        j(set_status(staff, load["id"], status))


def fire(staff: Api, kiln: str, decks: list[list[str]], firing: str = "bisque", outcome: Any = "intact", key: str | None = None) -> dict:
    load = new_load(staff, kiln, firing)
    for n, pids in enumerate(decks, 1):
        if n > 1:
            j(staff.post(f"/api/loads/{load['id']}/decks"), 201)
        for pid in pids:
            j(place(staff, load["id"], pid, n), 201)
    to_cooling(staff, load)
    outs = {pid: (outcome[pid] if isinstance(outcome, dict) else outcome) for d in decks for pid in d}
    return j(unload(staff, load["id"], outs, key))


def settled(api: Api, pid: str, n: int, status: str = "settled", seconds: float = SETTLE_S) -> list[dict]:
    def ready_charges() -> list[dict] | None:
        cs = passport(api, pid)["charges"]
        return cs if len(cs) >= n and all(c["status"] == status for c in cs) else None
    return poll(ready_charges, seconds, f"{n} {status} charges on {pid}")


def credit(m: Api) -> dict:
    return j(m.get("/api/me/credit"))


def check_ledger(entries: list[dict], balance: int) -> dict[str, list[dict]]:
    assert balance == sum(e["amount_cents"] for e in entries if e["account"] == "member_credit")
    moves: dict[str, list[dict]] = {}
    for e in entries:
        moves.setdefault(e["movement_id"], []).append(e)
    for pair in moves.values():
        assert len(pair) == 2 and sum(e["amount_cents"] for e in pair) == 0 and pair[0]["account"] != pair[1]["account"], pair
    return moves


def charge_entries(entries: list[dict], cid: str) -> list[tuple]:
    return sorted((e["account"], e["amount_cents"], e["kind"]) for e in entries if e["charge_id"] == cid)


def kb_txns(kb: Any, member_id: str, key: str | None = None, kind: str = "PURCHASE", prefix: str = "") -> list[dict]:
    acct = kb.account_by_key(f"kd-{member_id}")
    if not acct:
        return []
    found = []
    for pay in kb.payments(acct["accountId"]):
        for t in pay.get("transactions") or []:
            k = t.get("transactionExternalKey") or ""
            if t.get("transactionType") == kind and t.get("status") == "SUCCESS" and (key is None or k == key) and k.startswith(prefix):
                found.append(t)
    return found


def cents(t: dict) -> int:
    return int((Decimal(str(t["amount"])) * 100).to_integral_value())


def pack_id(api: Api, name: str) -> str:
    return next(p["id"] for p in j(api.get("/api/credit-packs")) if p["name"] == name)


def half_up(x: Any) -> Decimal:
    return (Decimal(str(x)) * 2).to_integral_value(ROUND_CEILING) / 2


def num(x: Any) -> Decimal:
    return Decimal(str(x))


def fee_of(cubic: Any, rate: int) -> int:
    return int((num(cubic) * rate).to_integral_value(ROUND_HALF_UP))


def pct(sq: Any, area: Any) -> Decimal:
    return (num(sq) / num(area) * 100).quantize(Decimal("0.1"), ROUND_HALF_UP)


def expect_load(body: dict, decks: list[list[tuple]], area: Decimal) -> None:
    assert len(body["decks"]) == len(decks), body
    used = Decimal(0)
    for deck, dims in zip(body["decks"], decks):
        post = max((half_up(d[2]) for d in dims), default=None)
        post = post + CLEARANCE_IN if post is not None else Decimal(0)
        foot = sum((half_up(d[0]) * half_up(d[1]) for d in dims), Decimal(0))
        assert num(deck["post_height_in"]) == post and num(deck["deck_height_in"]) == post + SHELF_IN, deck
        assert num(deck["footprint_sq_in"]) == foot and num(deck["footprint_pct"]) == pct(foot, area), deck
        used += post + SHELF_IN
    assert num(body["headroom_in"]) == STACK_IN - used, body


def today(api: Api) -> dt.date:
    return dt.date.fromisoformat(j(api.get("/api/studio"))["today"])


def instant(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def day_start(d: dt.date, tz: str) -> dt.datetime:
    return dt.datetime(d.year, d.month, d.day, tzinfo=ZoneInfo(tz)).astimezone(dt.timezone.utc)


def local_date(s: str, tz: str) -> dt.date:
    return instant(s).astimezone(ZoneInfo(tz)).date()


def screen_date(d: dt.date) -> str:
    return f"{d:%A} {d.day} {d:%B} {d.year}"


def month_name(d: dt.date) -> str:
    return f"{d:%B} {d.year}"


def money(c: int) -> str:
    return f"${abs(c) // 100}.{abs(c) % 100:02d}"


def together(calls: list) -> list[httpx.Response]:
    with cf.ThreadPoolExecutor(len(calls)) as ex:
        return list(ex.map(lambda f: f(), calls))


def statement_rows(r: httpx.Response) -> list[list[str]]:
    return list(csv.reader(io.StringIO(r.content.decode("utf-8"))))


def ui(page: Any, check_fn: Any, seconds: float = UI_S) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            check_fn()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, STEP_MS)


def shows(page: Any, role: str, name: str, seconds: float = UI_S, root: Any = None, **kw: Any) -> Any:
    loc = (root or page).get_by_role(role, name=name, **kw)
    ui(page, lambda: expect(loc.first).to_be_visible(timeout=QUICK_MS), seconds)
    return loc


def gone(page: Any, loc: Any, seconds: float = UI_S) -> None:
    ui(page, lambda: expect(loc).to_have_count(0, timeout=QUICK_MS), seconds)


def says(page: Any, region: str, copy: str, seconds: float = UI_S) -> None:
    loc = page.get_by_role("status", name=region)
    ui(page, lambda: expect(loc).to_have_text(copy, timeout=QUICK_MS), seconds)


def reads(page: Any, loc: Any, copy: Any, seconds: float = UI_S) -> None:
    ui(page, lambda: expect(loc).to_contain_text(copy, use_inner_text=True, ignore_case=True, timeout=QUICK_MS), seconds)


def go(p: Any, base: str, path: str) -> None:
    p.goto(f"{base}{path}")
    shows(p, "navigation", "Main")


@contextmanager
def signed_in(browser: Any, base: str, slug: str, email: str, password: str = PASSWORD, path: str = "", **opts: Any) -> Any:
    with open_app(browser, f"{base}/signin", **opts) as p:
        fill(p.get_by_role("textbox", name="Studio"), slug)
        fill(p.get_by_role("textbox", name="Email"), email)
        fill(p.get_by_label("Password", exact=True), password)
        click(p.get_by_role("button", name="Sign in"))
        shows(p, "navigation", "Main")
        if path:
            go(p, base, path)
        yield p


def ticket(p: Any, piece: dict, owner: Api) -> Any:
    rail = p.get_by_role("listbox", name="Waiting pieces")
    return rail.get_by_role("option", name=re.compile(re.escape(f"{piece['title']} · {owner.handle}")))


def drag(p: Any, source: Any, target: Any, fy: float = 0.97) -> None:
    source.scroll_into_view_if_needed()
    sx, sy = center(source)
    box = target.bounding_box()
    tx, ty = box["x"] + box["width"] / 2, box["y"] + box["height"] * fy
    p.mouse.move(sx, sy)
    p.mouse.down()
    p.mouse.move(sx + 10, sy + 10, steps=3)
    p.mouse.move(tx, ty, steps=8)
    p.mouse.up()


def meter_value(loc: Any) -> float:
    return float(loc.evaluate("e => e.getAttribute('aria-valuenow') ?? e.value"))


ACTIVE_JS = """() => { const a = document.activeElement; if (!a) return '';
  const id = a.getAttribute('aria-activedescendant'); const el = id ? document.getElementById(id) : a;
  if (!id && a.getAttribute('role') === 'listbox') return '';  // no active option yet: the first arrow press picks one
  return el ? el.textContent : ''; }"""


def key_select(p: Any, listbox: Any, label: str) -> None:
    listbox.focus()
    if not listbox.evaluate("l => l.contains(document.activeElement)"):
        listbox.get_by_role("option").first.focus()
    for _ in range(RAIL_MAX):
        if label in p.evaluate(ACTIVE_JS):
            p.keyboard.press("Enter")
            return
        p.keyboard.press("ArrowDown")
    raise AssertionError(f"arrow keys never reached {label}")


def tab_to(p: Any, target: Any) -> None:
    for _ in range(TAB_MAX):
        p.keyboard.press("Tab")
        if target.evaluate("e => e === document.activeElement"):
            return
    raise AssertionError("Tab never reached the control")


def figure(group: Any) -> int:
    return int(re.findall(r"\d+", group.inner_text().replace(",", ""))[-1])


def test_health(app_url):
    r = httpx.get(f"{app_url}/api/health", timeout=TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}, r.text
    assert sign_in(app_url, "ember-lane", OWNER["ember-lane"]).user["role"] == "owner"
    names = [c["name"] for c in j(sign_in(app_url, "ember-lane", PRIYA).get("/api/clay-bodies"))]
    assert "Buff Stoneware" in names


def test_boot_with_services_down(app_url):
    for base in (os.environ["APP_KILLBILL_DOWN_URL"], os.environ["APP_MINIO_DOWN_URL"]):
        r = httpx.get(f"{base}/api/health", timeout=TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, r.text
        assert sign_in(base, "ember-lane", OWNER["ember-lane"]).user["role"] == "owner"
        kilns = [k["name"] for k in j(sign_in(base, "ember-lane", TECH["ember-lane"]).get("/api/kilns"))]
        assert "North Kiln" in kilns and "South Kiln" in kilns


def test_signin_session_and_signout(app_url):
    a = Api(app_url)
    err(a.post("/api/session", {"studio": "ember-lane", "email": THEO, "password": "not-the-password"}), 401, "invalid_credentials")
    err(a.post("/api/session", {"studio": "saltmarsh", "email": THEO, "password": PASSWORD}), 401, "invalid_credentials")
    r = a.post("/api/session", {"studio": "ember-lane", "email": THEO, "password": PASSWORD})
    user = user_of(j(r))
    assert user["role"] == "kiln_tech" and user["handle"] == "theo"
    assert user["studio"]["slug"] == "ember-lane" and user["studio"]["time_zone"] == "Pacific/Auckland"
    cookie = r.headers.get("set-cookie", "").lower()
    assert "kd_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert user_of(j(a.get("/api/me")))["id"] == user["id"]
    err(a.get("/api/members"), 403, "forbidden")
    twin = Api(app_url)
    twin.http.cookies.set("kd_session", a.http.cookies.get("kd_session"))
    assert user_of(j(twin.get("/api/me")))["id"] == user["id"]
    assert a.delete("/api/session").status_code == 204
    err(twin.get("/api/me"), 401, "unauthenticated")
    err(a.get("/api/me"), 401, "unauthenticated")


def test_signin_throttle(mail):
    base = os.environ["APP_SHORT_URL"]
    m = new_member(base, mail, "saltmarsh")
    bad = {"studio": "saltmarsh", "email": m.email, "password": "not-the-password"}
    good = {**bad, "password": NEW_PASSWORD}
    a = Api(base)
    for _ in range(FAILS):
        err(a.post("/api/session", bad), 401, "invalid_credentials")
    err(a.post("/api/session", good), 429, "too_many_attempts")
    err(Api(base).post("/api/session", {**good, "studio": "ember-lane"}), 401, "invalid_credentials")
    poll(lambda: a.post("/api/session", good).status_code == 200, LOCK_WAIT_S, "the sign-in lock to end")
    m2 = new_member(base, mail, "saltmarsh")
    bad2 = {**bad, "email": m2.email}
    rs = together([lambda: Api(base).post("/api/session", bad2) for _ in range(2 * RACE)])
    codes = [r.status_code for r in rs]
    assert codes.count(401) == FAILS and codes.count(429) == 2 * RACE - FAILS, codes
    for r in rs:
        err(r, r.status_code, "invalid_credentials" if r.status_code == 401 else "too_many_attempts")


def test_error_shape_precedence_and_path_ids(app_url):
    member = sign_in(app_url, "ember-lane", PRIYA)
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    foreign = sign_in(app_url, "saltmarsh", TECH["saltmarsh"])
    anon = Api(app_url)
    lid = new_load(tech, "South Kiln")["id"]
    for bad in BAD_IDS:
        err(member.get(f"/api/pieces/{bad}"), 404, "not_found")
        err(tech.get(f"/api/loads/{bad}"), 404, "not_found")
        err(owner.get(f"/api/members/{bad}"), 404, "not_found")
        err(anon.get(f"/api/invites/{bad}"), 404, "not_found")
    err(foreign.get(f"/api/loads/{lid}"), 404, "not_found")
    for deck in BAD_DECKS + ["2"]:
        err(tech.delete(f"/api/loads/{lid}/decks/{deck}"), 404, "not_found")
    for month in BAD_MONTHS:
        err(owner.post(f"/api/reports/months/{month}/close"), 404, "not_found")
    err(member.get("/api/no-such-endpoint"), 404, "not_found")
    err(owner.post(f"/api/members/{tech.id}/adjustments", {"amount_cents": 100, "reason": "probe"}), 404, "not_found")
    err(anon.get(f"/api/loads/{BAD_IDS[1]}"), 401, "unauthenticated")
    err(anon.post("/api/loads", {"kiln_id": "x"}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    err(tech.http.post("/api/rate-schedules", content=b"{", headers=JSON_CT), 400, "invalid_json")
    err(tech.post("/api/rate-schedules", {"effective_from": "soon"}), 403, "forbidden")
    err(tech.post(f"/api/loads/{lid}/unload", {"outcomes": {}}), 400, "idempotency_key_required")
    err(tech.post(f"/api/loads/{lid}/unload", {"outcomes": {}}, key=""), 400, "idempotency_key_required")
    err(tech.post(f"/api/loads/{lid}/unload", {"outcomes": {}}, key=idempotency_key()), 409, "illegal_transition")
    invalid(member.post("/api/quotes", {"length_in": 0, "width_in": 1, "height_in": 1}), "length_in", DIM_MSG)
    j(set_status(tech, lid, "cancelled"))


def test_server_boundary(app_url):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    lid = new_load(tech, "South Kiln")["id"]
    err(tech.http.post("/api/loads", content=b'{"firing":"bisque"}', headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    assert len(j(tech.http.post(f"/api/loads/{lid}/decks", headers={"Content-Type": "text/plain"}), 201)["decks"]) == 2
    err(tech.http.post("/api/loads", content=b'{"firing":', headers=JSON_CT), 400, "invalid_json")

    def sized(n: int) -> bytes:
        base = json.dumps({"firing": "bisque", "kiln_id": "none", "pad": ""})
        return (base[:-2] + "x" * (n - len(base)) + '"}').encode()

    assert len(sized(JSON_LIMIT)) == JSON_LIMIT
    err(tech.http.post("/api/loads", content=sized(JSON_LIMIT + 1), headers=JSON_CT), 413, "too_large")
    invalid(tech.http.post("/api/loads", content=sized(JSON_LIMIT), headers=JSON_CT), None, KILN_MSG)
    err(tech.post(f"/api/loads/{lid}/decks", headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    assert len(j(tech.get(f"/api/loads/{lid}"))["decks"]) == 2
    j(tech.post(f"/api/loads/{lid}/decks", headers={"Origin": app_url.rstrip("/")}), 201)
    me = tech.get("/api/me", headers={"Origin": FOREIGN_ORIGIN})
    assert "access-control-allow-origin" not in me.headers and "no-store" in me.headers.get("cache-control", "")
    page = httpx.get(f"{app_url}/signin", timeout=TIMEOUT)
    assert page.status_code == 200 and "no-store" in page.headers.get("cache-control", "")
    for path in NEVER_SERVED:
        assert httpx.get(f"{app_url}{path}", timeout=TIMEOUT).status_code == 404, path
    secrets = [os.environ.get(n, "") for n in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")]
    bodies = [page.text] + [httpx.get(f"{app_url}{a}", timeout=TIMEOUT).text for a in set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', page.text))]
    for secret in [s for s in secrets if len(s) >= 6 and not s.isalpha()]:
        assert all(secret not in b for b in bodies)
    j(set_status(tech, lid, "cancelled"))


def test_layout_three_viewports(browser, app_url):
    priya = sign_in(app_url, "ember-lane", PRIYA)
    piece = log_piece(priya, MUG)
    with open_app(browser, f"{app_url}/signin") as p:
        for w, h in VIEWPORTS:
            p.set_viewport_size({"width": w, "height": h})
            shows(p, "button", "Sign in")
            layout(p)
    screens = [
        (PRIYA, ["/pieces", "/pieces/new", "/credit", f"/pieces/{piece['id']}"]),
        (TECH["ember-lane"], ["/intake", "/planner"]),
        (OWNER["ember-lane"], ["/dashboard", "/planner", "/intake", "/rates", "/members", "/reports", "/settings"]),
    ]
    for email, paths in screens:
        with signed_in(browser, app_url, "ember-lane", email) as p:
            for w, h in VIEWPORTS:
                p.set_viewport_size({"width": w, "height": h})
                for path in paths:
                    go(p, app_url, path)
                    layout(p)
                    if path == "/planner" and w == VIEWPORTS[0][0]:
                        assert shows(p, "img", "Kiln elevation").bounding_box()["height"] >= ELEVATION_MIN_PX
                    if path == "/dashboard":
                        per = {375: 2, 768: 3, 1280: 5}[w]
                        tops = [shows(p, "group", t, exact=True).bounding_box()["y"] for t in TILES]
                        assert all(abs(t - tops[0]) < 1 for t in tops[:per]), tops
                        if per < len(TILES):
                            assert tops[per] > tops[0], tops


def test_feedback_pending_and_field_errors(browser, app_url, mail):
    m = new_member(app_url, mail)
    with signed_in(browser, app_url, "ember-lane", m.email, NEW_PASSWORD, path="/pieces/new") as p:
        title = p.get_by_role("textbox", name="Title")
        fill(title, "   ")
        select(p.get_by_role("combobox", name="Clay body"), "Buff Stoneware")
        for name, v in (("Length (in)", "4"), ("Width (in)", "4"), ("Height (in)", "4")):
            fill(p.get_by_role("spinbutton", name=name), v)
        button = p.get_by_role("button", name="Log piece")
        with held(p, "**/api/pieces") as gate:
            click(button)
            says(p, "Piece status", "Logging piece…")
            expect(button).to_be_disabled()
            gate.release()
        says(p, "Piece status", "Fix the highlighted fields.")
        ui(p, lambda: expect(title).to_have_accessible_description("Enter a title of 1 to 80 characters.", timeout=QUICK_MS))
        fill(title, "Bud vase")
        ui(p, lambda: expect(title).not_to_have_accessible_description("Enter a title of 1 to 80 characters.", timeout=QUICK_MS))
    assert j(m.get("/api/pieces")) == []


def test_planner_placement_motion(browser, app_url, mail):
    placement_motion(browser, app_url, mail, "no-preference")


def test_planner_reduced_motion(browser, app_url, mail):
    placement_motion(browser, app_url, mail, "reduce")


def common_difference(a: Any, b: Any) -> float:
    w, h = min(a.width, b.width), min(a.height, b.height)
    rows = lambda x: b"".join(x.rgb[r * x.width * 3:(r * x.width + w) * 3] for r in range(h))
    ra, rb = rows(a), rows(b)
    return sum(abs(p - q) for p, q in zip(ra, rb, strict=True)) / max(1, len(ra))


def placement_motion(browser: Any, app_url: str, mail: Any, preference: str) -> None:
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    vase, wide = ready(m, tech, VASE), ready(m, tech, WIDE)
    load = new_load(tech, "North Kiln")
    final = "HEADROOM 14.375 IN"
    with signed_in(browser, app_url, "ember-lane", TECH["ember-lane"], path="/planner", reduced_motion=preference) as p, \
            signed_in(browser, app_url, "ember-lane", THEO, path="/planner") as q:
        drawing = shows(p, "img", "Kiln elevation")
        figures = p.get_by_role("region", name="Load figures")
        source = ticket(p, vase, m)
        ui(p, lambda: expect(source).to_be_visible(timeout=QUICK_MS))
        before = decode(capture(drawing))
        with p.expect_response(lambda r: r.url.endswith("/placements") and r.request.method == "POST") as reply:
            drag(p, source, drawing)
        assert reply.value.status == 201
        headroom = p.get_by_role("meter", name="Headroom")
        poll(lambda: meter_value(headroom) == pytest.approx(14.375), UI_S, "the headroom meter value")
        advance(p, EARLY_MS)
        early = decode(capture(drawing))
        if preference == "reduce":
            assert final in figures.inner_text()
        else:
            assert final not in figures.inner_text()
        frames = [decode(capture(drawing))]

        def settled() -> bool:
            advance(p, ANIM_SETTLE_MS)
            frames.append(decode(capture(drawing)))
            return common_difference(frames[-2], frames[-1]) == 0

        poll(settled, UI_S, "the elevation drawing to settle")
        end = frames[-1]
        assert common_difference(before, end) > 0
        if preference == "reduce":
            assert common_difference(early, end) == 0
        advance(p, FIGURE_SETTLE_MS)
        reads(p, figures, final)
        reads(p, figures, "FOOTPRINT D1 7.2%")
        drag(p, ticket(p, wide, m), drawing)
        says(p, "Planner status", f"Deck 1 is full: footprint would be {pct(Decimal('27.5') + 324, SHELF['North Kiln'])}%.")
        shows(q, "button", f"Remove {vase['title']}", seconds=LIVE_S + UI_S)
        p.reload()
        shows(p, "button", f"Remove {vase['title']}")
        reads(p, p.get_by_role("region", name="Load figures"), final)
    assert load_pieces(j(tech.get(f"/api/loads/{load['id']}"))) == [[vase["id"]]]
    j(set_status(tech, load["id"], "cancelled"))


def test_invites_latest_link_and_races(app_url, mail):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    anon = Api(app_url)
    email = fresh_email()
    j(owner.post("/api/invites", {"email": email, "role": "kiln_tech"}), 201)
    j(owner.post("/api/invites", {"email": email, "role": "member", "membership": "drop_off"}), 201)
    links = invite_links(mail, "ember-lane", email, 2)
    assert all(urlparse(app_url).netloc in link for link in links)
    states = {token_of(link): anon.get(f"/api/invites/{token_of(link)}").status_code for link in links}
    assert sorted(states.values()) == [200, 410], states
    live = next(t for t, s in states.items() if s == 200)
    retired = next(t for t, s in states.items() if s == 410)
    info = j(anon.get(f"/api/invites/{live}"))
    assert info["email"] == email and info["role"] == "member" and info["studio_name"] == "Ember Lane Clay"
    err(anon.http.post(f"/api/invites/{retired}/accept", content=b"{", headers=JSON_CT), 400, "invalid_json")
    err(anon.post(f"/api/invites/{retired}/accept", {"name": "Late", "handle": f"l-{uuid.uuid4().hex[:8]}", "password": NEW_PASSWORD}), 410, "invite_gone")
    tag = uuid.uuid4().hex[:8]
    rs = together([lambda i=i: Api(app_url).post(f"/api/invites/{live}/accept", {"name": "Racer", "handle": f"r{i}-{tag}", "password": NEW_PASSWORD}) for i in range(RACE)])
    assert [r.status_code for r in rs].count(201) == 1
    for r in rs:
        if r.status_code != 201:
            err(r, 410, "invite_gone")
    people = [x for x in j(owner.get("/api/members", params={"q": email})) if x["email"] == email]
    assert len(people) == 1 and people[0]["membership"] == "drop_off" and people[0]["card_status"] == "none" and people[0]["balance_cents"] == 0
    err(owner.post("/api/invites", {"email": email, "role": "member", "membership": "member"}), 409, "already_member")
    err(owner.post("/api/invites", {"email": THEO, "role": "kiln_tech"}), 409, "already_member")
    invalid(owner.post("/api/invites", {"email": "not-an-email", "role": "kiln_tech"}), "email", "Enter a valid email address.")
    invalid(owner.post("/api/invites", {"email": fresh_email(), "role": "chef"}), "role", "Choose a role.")
    pair = [fresh_email(), fresh_email()]
    for e in pair:
        j(owner.post("/api/invites", {"email": e, "role": "member", "membership": "member"}), 201)
    tokens = [token_of(invite_links(mail, "ember-lane", e)[0]) for e in pair]
    shared = f"s-{uuid.uuid4().hex[:8]}"
    rs = together([lambda t=t: Api(app_url).post(f"/api/invites/{t}/accept", {"name": "Twin", "handle": shared, "password": NEW_PASSWORD}) for t in tokens])
    assert sorted(r.status_code for r in rs) == [201, 422]
    invalid(next(r for r in rs if r.status_code == 422), "handle", "That handle is already used in this studio.")
    crowd = fresh_email()
    together([lambda: owner.post("/api/invites", {"email": crowd, "role": "kiln_tech"}) for _ in range(3)])
    links = invite_links(mail, "ember-lane", crowd, 3)
    assert sorted(anon.get(f"/api/invites/{token_of(x)}").status_code for x in links) == [200, 410, 410]


QUOTE_CASES = {
    "published-example": (PRIYA, EXAMPLE, (5.5, 4.5, 7.0), "173.25", 520, 1040),
    "tall-vase": (PRIYA, VASE, (5.5, 5.0, 11.5), "316.25", 949, 1898),
    "breakfast-bowl": (PRIYA, BOWL, (6.5, 6.5, 3.5), "147.875", 444, 887),
    "mug": (PRIYA, MUG, (4.0, 4.5, 4.0), "72", 216, 432),
    "drop-off-platter": (WEN, (14.0, 10.2, 1.4), (14.0, 10.5, 1.5), "220.5", 1103, 1544),
}


QUOTE_IDS = ["published-example", "tall-vase", "breakfast-bowl", "mug", "drop-off-platter"]


def test_passport_history_studio_dates(browser, app_url, mail):
    m = new_member(app_url, mail)
    p = log_piece(m, MUG)
    first = passport(m, p["id"])["history"][0]
    label = screen_date(local_date(first["at"], TZ["ember-lane"]))
    with signed_in(browser, app_url, "ember-lane", m.email, NEW_PASSWORD, path=f"/pieces/{p['id']}") as page:
        history = shows(page, "list", "Piece history")
        ui(page, lambda: expect(history.get_by_role("listitem").first).to_contain_text(label, timeout=QUICK_MS))
        assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:", history.inner_text())


@pytest.mark.parametrize("case", QUOTE_IDS, ids=QUOTE_IDS)
def test_quote_exact(app_url, case):
    email, dims, rounded, cubic, bisque, glaze = QUOTE_CASES[case]
    m = sign_in(app_url, "ember-lane", email)
    q = j(m.post("/api/quotes", {"length_in": dims[0], "width_in": dims[1], "height_in": dims[2]}))
    assert [num(q[k]) for k in ("length_in", "width_in", "height_in")] == [num(x) for x in rounded]
    assert num(q["cubic_inches"]) == num(cubic)
    assert q["membership"] == ("drop_off" if email == WEN else "member") and q["rates_effective_from"] == "2026-01-01"
    assert q["bisque"]["fee_cents"] == bisque and q["glaze"]["fee_cents"] == glaze
    rates = (5, 7) if email == WEN else (3, 6)
    assert (q["bisque"]["rate_cents"], q["glaze"]["rate_cents"]) == rates
    edge = j(m.post("/api/quotes", {"length_in": MAX_DIM, "width_in": MAX_DIM, "height_in": MAX_DIM}))
    assert edge["bisque"]["fee_cents"] == fee_of(MAX_DIM ** 3, rates[0])
    for bad in (0, -1, MAX_DIM + 0.01, 1.234, "abc"):
        invalid(m.post("/api/quotes", {"length_in": 2, "width_in": bad, "height_in": 2}), "width_in", DIM_MSG)


def test_log_piece_frozen_quote(app_url, mail):
    m = new_member(app_url, mail)
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    p = log_piece(m, EXAMPLE, photo=False)
    assert p["status"] == "logged" and p["photo_url"] is None and p["location"] is None and p["charges"] == []
    assert num(p["cubic_inches"]) == Decimal("173.25") and num(p["rounded"]["length_in"]) == Decimal("5.5")
    assert p["quote"]["bisque"] == {"rate_cents": 3, "fee_cents": 520} and p["quote"]["glaze"] == {"rate_cents": 6, "fee_cents": 1040}
    assert p["quote"]["rates_effective_from"] == "2026-01-01" and p["quote"]["membership"] == "member"
    assert [h["status"] for h in p["history"]] == ["logged"] and p["outcomes"] == {"bisque": None, "glaze": None}
    assert num(p["length_in"]) == Decimal("5.2") and p["pickup_deadline"] is None
    assert p["id"] in [x["id"] for x in j(m.get("/api/pieces"))]
    j(upload(m, p["id"]))
    j(tech.post(f"/api/pieces/{p['id']}/check-in"))
    charge = fire(tech, "South Kiln", [[p["id"]]])["charges"][0]
    assert charge["fee_cents"] == 520 and charge["rate_cents"] == 3 and num(charge["cubic_inches"]) == Decimal("173.25")
    clay = j(m.get("/api/clay-bodies"))[0]["id"]
    foreign_clay = j(sign_in(app_url, "saltmarsh", ANA).get("/api/clay-bodies"))[0]["id"]
    base = {"title": "Ok", "clay_body_id": clay, "length_in": 2, "width_in": 2, "height_in": 2}
    invalid(m.post("/api/pieces", {**base, "title": " "}), "title", "Enter a title of 1 to 80 characters.")
    invalid(m.post("/api/pieces", {**base, "title": "t" * 81}), "title", "Enter a title of 1 to 80 characters.")
    invalid(m.post("/api/pieces", {**base, "clay_body_id": foreign_clay}), "clay_body_id", "Choose a clay body.")
    invalid(m.post("/api/pieces", {**base, "height_in": MAX_DIM + 1}), "height_in", DIM_MSG)
    err(tech.post("/api/pieces", base), 403, "forbidden")


def test_photo_upload_checks(app_url, mail):
    m = new_member(app_url, mail)
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    bucket = S3()
    p = log_piece(m, MUG, photo=False)
    prefix_re = re.compile(rf"^studios/[^/]+/pieces/{re.escape(p['id'])}/{UUID_RE}\.png$")

    def keys() -> list[str]:
        return [k for k in bucket.keys("studios/") if f"/pieces/{p['id']}/" in k]

    first = png(1)
    assert j(upload(m, p["id"], first, name="../../../escape.png"))["photo_url"] == f"/api/pieces/{p['id']}/photo"
    assert len(keys()) == 1 and prefix_re.match(keys()[0]) and "escape" not in keys()[0]
    for data, name, ctype in (
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "pot.png", "image/png"),
        (b"<!doctype html><script>alert(1)</script>", "pot.jpg", "image/jpeg"),
        (b"console.log('hi')", "pot.webp", "image/webp"),
    ):
        err(upload(m, p["id"], data, name, ctype), 415, "unsupported_photo")
    err(upload(m, p["id"], png() + b"\0" * (PHOTO_LIMIT + 1 - len(png()))), 413, "photo_too_large")
    err(upload(m, p["id"], png() + b"\0" * (REQUEST_LIMIT + 1 - len(png()))), 413, "too_large")
    assert len(keys()) == 1 and bucket.get(keys()[0]) == first
    exact = png(2) + b"\0" * (PHOTO_LIMIT - len(png(2)))
    j(upload(m, p["id"], exact))
    poll(lambda: len(keys()) == 1 and bucket.get(keys()[0]) == exact, UI_S, "the old photo object to be deleted")
    shots = [png(10 + i) for i in range(RACE)]
    rs = together([lambda s=s: upload(m, p["id"], s) for s in shots])
    assert all(r.status_code == 200 for r in rs), [r.text for r in rs]
    poll(lambda: len(keys()) == 1, UI_S, "exactly one photo object")
    stored = bucket.get(keys()[0])
    assert stored in shots
    photo = m.get(f"/api/pieces/{p['id']}/photo")
    assert photo.status_code == 200 and photo.content == stored and photo.headers["content-type"].startswith("image/png")
    assert "private" in photo.headers.get("cache-control", "") and "no-store" in photo.headers.get("cache-control", "")
    j(tech.post(f"/api/pieces/{p['id']}/check-in"))
    err(upload(m, p["id"]), 409, "photo_locked")
    err(upload(m, p["id"], png() + b"\0" * PHOTO_LIMIT), 409, "photo_locked")
    assert len(keys()) == 1


def test_piece_privacy(app_url, mail):
    a, b = new_member(app_url, mail), new_member(app_url, mail)
    pa = log_piece(a, MUG)
    others = [b, sign_in(app_url, "saltmarsh", TECH["saltmarsh"]), sign_in(app_url, "saltmarsh", ANA)]
    for other in others:
        err(other.get(f"/api/pieces/{pa['id']}"), 404, "not_found")
        err(other.get(f"/api/pieces/{pa['id']}/photo"), 404, "not_found")
    err(upload(b, pa["id"], png(9)), 404, "not_found")
    err(others[1].post(f"/api/pieces/{pa['id']}/check-in"), 404, "not_found")
    assert pa["id"] not in [x["id"] for x in j(b.get("/api/pieces"))]
    assert j(a.get(f"/api/pieces/{pa['id']}"))["status"] == "logged"
    assert a.get(f"/api/pieces/{pa['id']}/photo").content == png()


def test_wf_piece_passport_follow(browser, app_url, mail):
    m = new_member(app_url, mail)
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    p = log_piece(m, EXAMPLE)
    with signed_in(browser, app_url, "ember-lane", m.email, NEW_PASSWORD, path=f"/pieces/{p['id']}") as page:
        shows(page, "heading", p["title"], level=1)
        shows(page, "img", f"Intake photo of {p['title']}")
        body = page.locator("body")
        reads(page, body, "173.25 CU IN")
        reads(page, body, "$5.20")
        reads(page, body, "Logged")
        history = shows(page, "list", "Piece history")
        j(tech.post(f"/api/pieces/{p['id']}/check-in"))
        reads(page, body, "Waiting for bisque", LIVE_S)
        ui(page, lambda: expect(history.get_by_role("listitem")).to_have_count(2, timeout=QUICK_MS), LIVE_S)
        load = new_load(tech, "North Kiln")
        j(place(tech, load["id"], p["id"]), 201)
        reads(page, body, "North Kiln, deck 1", LIVE_S)
    assert passport(m, p["id"])["location"]["kiln_name"] == "North Kiln"
    j(set_status(tech, load["id"], "cancelled"))


def test_wf_piece_passport_charges(browser, app_url, mail):
    m = new_member(app_url, mail)
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    p = ready(m, tech, MUG)
    charge = fire(tech, "South Kiln", [[p["id"]]])["charges"][0]
    with signed_in(browser, app_url, "ember-lane", m.email, NEW_PASSWORD, path=f"/pieces/{p['id']}") as page:
        reads(page, page.locator("body"), "BISQUE Intact")
        table = shows(page, "table", "Charges")
        reads(page, table, "Bisque")
        reads(page, table, "Paid from credit")
        reads(page, table, "$2.16")
        j(owner.post(f"/api/charges/{charge['id']}/refund", {"reason": "Studio damaged it"}))
        reads(page, table, "Refunded", LIVE_S)
    assert passport(m, p["id"])["charges"][0]["status"] == "refunded"


def test_checkin_rules_and_races(app_url, mail):
    m = new_member(app_url, mail)
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    foreign = sign_in(app_url, "saltmarsh", TECH["saltmarsh"])
    p = log_piece(m, MUG, photo=False)
    err(tech.post(f"/api/pieces/{p['id']}/check-in"), 409, "photo_required")
    assert passport(m, p["id"])["status"] == "logged"
    j(upload(m, p["id"]))
    err(m.post(f"/api/pieces/{p['id']}/check-in"), 403, "forbidden")
    err(foreign.post(f"/api/pieces/{p['id']}/check-in"), 404, "not_found")
    err(foreign.get(f"/api/pieces/{p['id']}"), 404, "not_found")
    assert p["id"] not in [t["id"] for t in j(foreign.get("/api/pieces", params={"status": "logged"}))]
    assert passport(m, p["id"])["status"] == "logged" and len(passport(m, p["id"])["history"]) == 1
    after = j(tech.post(f"/api/pieces/{p['id']}/check-in"))
    assert after["status"] == "waiting_bisque" and after["waiting_since"] and [h["status"] for h in after["history"]] == ["logged", "waiting_bisque"]
    err(tech.post(f"/api/pieces/{p['id']}/check-in"), 409, "illegal_transition")
    err(tech.post(f"/api/pieces/{p['id']}/collect"), 409, "illegal_transition")
    err(owner.post(f"/api/pieces/{p['id']}/mark-uncollected"), 409, "illegal_transition")
    q = log_piece(m, MUG)
    rs = together([lambda: tech.post(f"/api/pieces/{q['id']}/check-in") for _ in range(RACE)])
    assert [r.status_code for r in rs].count(200) == 1
    for r in rs:
        if r.status_code != 200:
            err(r, 409, "illegal_transition")
    assert [h["status"] for h in passport(m, q["id"])["history"]].count("waiting_bisque") == 1
    r = log_piece(m, MUG, photo=False)
    up, ci = together([lambda: upload(m, r["id"]), lambda: tech.post(f"/api/pieces/{r['id']}/check-in")])
    assert up.status_code == 200, up.text
    state = passport(m, r["id"])
    if ci.status_code == 200:
        assert state["status"] == "waiting_bisque" and state["photo_url"]
    else:
        err(ci, 409, "photo_required")
        assert state["status"] == "logged"
    fire(tech, "South Kiln", [[q["id"]]])
    glazed = j(tech.post(f"/api/pieces/{q['id']}/check-in"))
    assert glazed["status"] == "waiting_glaze" and glazed["history"][-1]["status"] == "waiting_glaze"


def test_ticket_fields(app_url, mail):
    m = new_member(app_url, mail)
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    a, b, c = ready(m, tech, MUG), ready(m, tech, BOWL), ready(m, tech, JAR)
    load = new_load(tech, "North Kiln")
    body = j(place(tech, load["id"], c["id"]), 201)
    assert set(body["decks"][0]["pieces"][0]) == TICKET_KEYS
    r = tech.get("/api/pieces", params={"status": "waiting_bisque"})
    listing = j(r)
    assert m.email not in r.text and all(set(t) == TICKET_KEYS for t in listing)
    mine = {t["id"]: t for t in listing if t["owner_handle"] == m.handle}
    assert {a["id"], b["id"], c["id"]} <= set(mine)
    assert num(mine[a["id"]]["length_in"]) == Decimal("3.6") and mine[a["id"]]["photo_url"] and mine[a["id"]]["waiting_since"]
    unplaced = [t["id"] for t in j(tech.get("/api/pieces", params={"status": "waiting_bisque", "unplaced": 1}))]
    assert c["id"] not in unplaced and unplaced.index(a["id"]) < unplaced.index(b["id"])
    staff_view = tech.get(f"/api/pieces/{a['id']}")
    assert m.email not in staff_view.text and not {"email", "balance_cents", "card_status"} & set(staff_view.json())
    invalid(tech.get("/api/pieces", params={"status": "frozen"}), "status", "Choose a piece status.")
    invalid(tech.get("/api/pieces", params={"status": "waiting_bisque", "unplaced": 2}), "unplaced", "Use unplaced=1 or leave it out.")
    j(set_status(tech, load["id"], "cancelled"))


def test_wf_intake_desk_checkin(browser, app_url, mail):
    m = new_member(app_url, mail)
    p = log_piece(m, MUG)
    with signed_in(browser, app_url, "ember-lane", TECH["ember-lane"], path="/intake") as first, \
            signed_in(browser, app_url, "ember-lane", THEO, path="/intake") as second:
        planner = second.context.new_page()
        go(planner, app_url, "/planner")
        theirs = shows(second, "button", f"Check in {p['title']}", exact=True)
        button = shows(first, "button", f"Check in {p['title']}", exact=True)
        with held(first, "**/check-in") as gate:
            click(button)
            says(first, "Intake status", "Checking in…")
            gate.release()
        says(first, "Intake status", f"{p['title']} is on the waiting for bisque rack.")
        gone(first, first.get_by_role("list", name="Logged pieces").get_by_role("button", name=f"Check in {p['title']}", exact=True))
        gone(second, theirs, LIVE_S)
        ui(planner, lambda: expect(ticket(planner, p, m)).to_be_visible(timeout=QUICK_MS), LIVE_S)
    after = passport(m, p["id"])
    assert after["status"] == "waiting_bisque" and after["history"][-1]["status"] == "waiting_bisque"


def test_wf_intake_desk_refusal(browser, app_url, mail):
    m = new_member(app_url, mail)
    p = log_piece(m, MUG, photo=False)
    with signed_in(browser, app_url, "ember-lane", TECH["ember-lane"], path="/intake") as page:
        click(shows(page, "button", f"Check in {p['title']}", exact=True))
        says(page, "Intake status", f"{p['title']} needs an intake photo before check-in.")
        shows(page, "button", f"Check in {p['title']}", exact=True)
    assert passport(m, p["id"])["status"] == "logged"


def test_load_figures_server_derived(app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    vase, bowl = ready(m, tech, VASE), ready(m, tech, BOWL)
    load = new_load(tech, "North Kiln")
    lid, area = load["id"], SHELF["North Kiln"]
    assert load["status"] == "planning" and load_pieces(load) == [[]] and load["value_cents"] == 0
    expect_load(load, [[]], area)
    body = j(tech.post(f"/api/loads/{lid}/placements", {"piece_id": vase["id"], "deck": 1, "headroom_in": 99, "value_cents": 1, "post_height_in": 30}), 201)
    d1 = body["decks"][0]
    assert num(d1["post_height_in"]) == Decimal("12.0") and num(d1["deck_height_in"]) == Decimal("12.625")
    assert num(body["headroom_in"]) == Decimal("14.375") and num(d1["footprint_sq_in"]) == Decimal("27.5") and num(d1["footprint_pct"]) == Decimal("7.2")
    assert body["value_cents"] == 949
    body = j(place(tech, lid, bowl["id"]), 201)
    expect_load(body, [[VASE, BOWL]], area)
    assert body["value_cents"] == 949 + 444 and load_pieces(body) == [[vase["id"], bowl["id"]]]
    body = j(tech.post(f"/api/loads/{lid}/decks"), 201)
    expect_load(body, [[VASE, BOWL], []], area)
    body = j(move(tech, lid, vase["id"], 2))
    expect_load(body, [[BOWL], [VASE]], area)
    body = j(tech.delete(f"/api/loads/{lid}/placements/{vase['id']}"))
    expect_load(body, [[BOWL], []], area)
    assert body["value_cents"] == 444
    again = j(tech.get(f"/api/loads/{lid}"))
    assert again["decks"] == body["decks"] and again["headroom_in"] == body["headroom_in"]
    assert passport(m, vase["id"])["location"] is None
    j(set_status(tech, lid, "cancelled"))


def test_placement_limits(app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    wide, exact, tiny, tall, small, extra = (ready(m, tech, d) for d in (WIDE, EXACT85, TINY, TALL, TINY, MUG))
    south = new_load(tech, "South Kiln")
    b = err(place(tech, south["id"], wide["id"]), 409, "exceeds_footprint")
    assert str(pct(324, SHELF["South Kiln"])) in b["message"]
    assert load_pieces(j(tech.get(f"/api/loads/{south['id']}"))) == [[]]
    north = new_load(tech, "North Kiln")
    body = j(place(tech, north["id"], exact["id"]), 201)
    assert num(body["decks"][0]["footprint_pct"]) == Decimal("85.0")
    b = err(place(tech, north["id"], tiny["id"]), 409, "exceeds_footprint")
    assert str(pct(324, SHELF["North Kiln"])) in b["message"]
    tower = new_load(tech, "South Kiln")
    lid = tower["id"]
    j(place(tech, lid, tall["id"]), 201)
    expect_load(j(tech.post(f"/api/loads/{lid}/decks"), 201), [[TALL], []], SHELF["South Kiln"])
    b = err(place(tech, lid, small["id"], 2), 409, "exceeds_headroom")
    assert "0.250" in b["message"]
    j(tech.post(f"/api/loads/{lid}/decks"), 201)
    zero = j(tech.post(f"/api/loads/{lid}/decks"), 201)
    assert num(zero["headroom_in"]) == 0
    err(tech.post(f"/api/loads/{lid}/decks"), 409, "exceeds_headroom")
    err(tech.delete(f"/api/loads/{lid}/decks/2"), 409, "deck_not_removable")
    err(tech.delete(f"/api/loads/{lid}/decks/1"), 409, "deck_not_removable")
    assert len(j(tech.delete(f"/api/loads/{lid}/decks/4"))["decks"]) == 3
    invalid(place(tech, lid, extra["id"], 9), "deck", DECK_MSG)
    assert load_pieces(j(tech.get(f"/api/loads/{lid}"))) == [[tall["id"]], [], []]
    glaze = new_load(tech, "North Kiln", "glaze")
    err(place(tech, glaze["id"], extra["id"]), 409, "wrong_firing")
    for load in (south, north, tower, glaze):
        j(set_status(tech, load["id"], "cancelled"))
    err(place(tech, south["id"], extra["id"]), 409, "load_not_planning")


def test_one_open_load_per_piece(app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    x = ready(m, tech, MUG)
    one, two = new_load(tech, "North Kiln"), new_load(tech, "South Kiln")
    rs = together([lambda i=i: place(tech, (one, two)[i % 2]["id"], x["id"]) for i in range(RACE)])
    assert [r.status_code for r in rs].count(201) == 1
    for r in rs:
        if r.status_code != 201:
            err(r, 409, "piece_taken")
    homes = [ld["id"] for ld in (one, two) if x["id"] in sum(load_pieces(j(tech.get(f"/api/loads/{ld['id']}"))), [])]
    assert len(homes) == 1
    err(place(tech, homes[0], x["id"]), 409, "piece_taken")
    many = [ready(m, tech, MUG) for _ in range(RACE)]
    rs = together([lambda p=p: place(tech, one["id"], p["id"]) for p in many])
    assert all(r.status_code == 201 for r in rs), [r.text for r in rs]
    assert {p["id"] for p in many} <= set(load_pieces(j(tech.get(f"/api/loads/{one['id']}")))[0])
    y = ready(m, tech, MUG)
    j(tech.post(f"/api/loads/{two['id']}/decks"), 201)
    removal, placing = together([lambda: tech.delete(f"/api/loads/{two['id']}/decks/2"), lambda: place(tech, two["id"], y["id"], 2)])
    final = j(tech.get(f"/api/loads/{two['id']}"))
    if removal.status_code == 200:
        invalid(placing, "deck", DECK_MSG)
        assert len(final["decks"]) == 1
    else:
        err(removal, 409, "deck_not_removable")
        assert placing.status_code == 201 and load_pieces(final)[1] == [y["id"]]
    for ld in (one, two):
        j(set_status(tech, ld["id"], "cancelled"))


def test_load_state_edges(app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    empty = new_load(tech, "South Kiln")
    err(set_status(tech, empty["id"], "loaded"), 409, "empty_load")
    b = err(set_status(tech, empty["id"], "firing"), 409, "illegal_transition")
    assert "planning" in b["message"].lower() and "firing" in b["message"].lower()
    invalid(set_status(tech, empty["id"], "unloaded"), "status", "Choose loaded, firing, cooling or cancelled.")
    a, b2 = ready(m, tech, MUG), ready(m, tech, MUG)
    first = new_load(tech, "South Kiln")
    j(place(tech, first["id"], a["id"]), 201)
    free_kiln(tech, first["kiln"]["id"], first["id"])
    j(set_status(tech, first["id"], "loaded"))
    err(set_status(tech, first["id"], "loaded"), 409, "illegal_transition")
    err(set_status(tech, first["id"], "cooling"), 409, "illegal_transition")
    second = new_load(tech, "South Kiln")
    j(place(tech, second["id"], b2["id"]), 201)
    err(set_status(tech, second["id"], "loaded"), 409, "kiln_busy")
    j(set_status(tech, first["id"], "firing"))
    err(set_status(tech, first["id"], "cancelled"), 409, "illegal_transition")
    j(set_status(tech, first["id"], "cooling"))
    j(unload(tech, first["id"], {a["id"]: "intact"}))
    j(set_status(tech, second["id"], "loaded"))
    assert j(set_status(tech, second["id"], "cancelled"))["status"] == "cancelled"
    assert passport(m, b2["id"])["status"] == "waiting_bisque" and passport(m, b2["id"])["location"] is None
    rivals = [new_load(tech, "South Kiln") for _ in range(2)]
    for ld in rivals:
        j(place(tech, ld["id"], ready(m, tech, MUG)["id"]), 201)
    rs = together([lambda ld=ld: set_status(tech, ld["id"], "loaded") for ld in rivals])
    assert sorted(r.status_code for r in rs) == [200, 409]
    err(next(r for r in rs if r.status_code == 409), 409, "kiln_busy")
    for ld in rivals:
        set_status(tech, ld["id"], "cancelled")
    target = new_load(tech, "North Kiln")
    held_piece = ready(m, tech, MUG)
    j(place(tech, target["id"], held_piece["id"]), 201)
    racers = [ready(m, tech, MUG) for _ in range(RACE - 1)]
    calls = [lambda: set_status(tech, target["id"], "cancelled")] + [lambda p=p: place(tech, target["id"], p["id"]) for p in racers]
    rs = together(calls)
    assert rs[0].status_code == 200
    for r in rs[1:]:
        if r.status_code != 201:
            err(r, 409, "load_not_planning")
    final = j(tech.get(f"/api/loads/{target['id']}"))
    assert final["status"] == "cancelled" and all(p == [] for p in load_pieces(final))
    fresh = new_load(tech, "North Kiln")
    for p in [held_piece] + racers:
        state = passport(m, p["id"])
        assert state["status"] == "waiting_bisque" and state["location"] is None
        j(place(tech, fresh["id"], p["id"]), 201)
    j(set_status(tech, fresh["id"], "cancelled"))


def test_moves_between_decks(app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    h1, h2, tile, squat, slab, stray = (ready(m, tech, d) for d in (TOWER, TOWER, TILE, SQUAT, SLAB, MUG))
    load = new_load(tech, "North Kiln")
    lid, area = load["id"], SHELF["North Kiln"]
    for p in (h1, h2, tile):
        j(place(tech, lid, p["id"]), 201)
    j(tech.post(f"/api/loads/{lid}/decks"), 201)
    for p in (squat, slab):
        j(place(tech, lid, p["id"], 2), 201)
    before = j(tech.get(f"/api/loads/{lid}"))
    b = err(move(tech, lid, h2["id"], 2), 409, "exceeds_headroom")
    assert "5.250" in b["message"]
    b = err(move(tech, lid, tile["id"], 2), 409, "exceeds_footprint")
    assert str(pct(289 + 16 + 36, area)) in b["message"]
    invalid(move(tech, lid, tile["id"], 3), "deck", DECK_MSG)
    err(move(tech, lid, stray["id"], 1), 404, "not_found")
    same = j(tech.get(f"/api/loads/{lid}"))
    assert same["decks"] == before["decks"] and same["headroom_in"] == before["headroom_in"]
    body = j(move(tech, lid, squat["id"], 1))
    assert load_pieces(body) == [[h1["id"], h2["id"], tile["id"], squat["id"]], [slab["id"]]]
    expect_load(body, [[TOWER, TOWER, TILE, SQUAT], [SLAB]], area)
    unchanged = j(move(tech, lid, squat["id"], 1))
    assert load_pieces(unchanged) == load_pieces(body) and unchanged["headroom_in"] == body["headroom_in"]
    assert passport(m, squat["id"])["location"]["deck"] == 1
    j(set_status(tech, lid, "cancelled"))
    err(move(tech, lid, squat["id"], 2), 409, "load_not_planning")


def test_wf_load_planning_drag(browser, app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    vase, wide = ready(m, tech, VASE), ready(m, tech, WIDE)
    free_kiln(tech, kiln_id(tech, "South Kiln"))
    with signed_in(browser, app_url, "ember-lane", TECH["ember-lane"], path="/planner") as p:
        opener = shows(p, "button", "New load")
        click(opener)
        dlg = shows(p, "dialog", "New load")
        select(dlg.get_by_role("combobox", name="Kiln"), "South Kiln")
        check(dlg.get_by_role("radiogroup", name="Firing").get_by_role("radio", name="Bisque"))
        click(dlg.get_by_role("button", name="Create load"))
        says(p, "Planner status", "Load created.")
        drawing = shows(p, "img", "Kiln elevation")
        source = ticket(p, vase, m)
        ui(p, lambda: expect(source).to_be_visible(timeout=QUICK_MS))
        drag(p, source, drawing)
        says(p, "Planner status", f"{vase['title']} placed on deck 1.")
        shows(p, "button", f"Remove {vase['title']}")
        drag(p, ticket(p, wide, m), drawing)
        says(p, "Planner status", f"Deck 1 is full: footprint would be {pct(Decimal('27.5') + 324, SHELF['South Kiln'])}%.")
        ui(p, lambda: expect(ticket(p, wide, m)).to_be_visible(timeout=QUICK_MS))
        click(shows(p, "button", "Mark loaded"))
        says(p, "Planner status", "Load is now Loaded.")
    loads = [ld for ld in j(tech.get("/api/loads", params={"open": 1})) if vase["id"] in sum(load_pieces(ld), [])]
    assert len(loads) == 1 and loads[0]["status"] == "loaded" and load_pieces(loads[0]) == [[vase["id"]]]
    assert passport(m, wide["id"])["location"] is None
    j(set_status(tech, loads[0]["id"], "cancelled"))


def test_wf_load_planning_keyboard(browser, app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    mug, wide = ready(m, tech, MUG), ready(m, tech, WIDE)
    load = new_load(tech, "North Kiln")
    with signed_in(browser, app_url, "ember-lane", TECH["ember-lane"], path="/planner") as p:
        rail = shows(p, "listbox", "Waiting pieces")
        ui(p, lambda: expect(ticket(p, mug, m)).to_be_visible(timeout=QUICK_MS))
        key_select(p, rail, mug["title"])
        opener = p.get_by_role("button", name="Place piece")
        opener.focus()
        p.keyboard.press("Enter")
        dlg = shows(p, "dialog", "Place piece")
        decks = dlg.get_by_role("listbox", name="Deck")
        def focus_in_decks() -> None:
            assert decks.evaluate("l => l.contains(document.activeElement)")

        ui(p, focus_in_decks)
        for key in ["Tab"] * TAB_MAX + ["Shift+Tab"] * TAB_MAX:
            p.keyboard.press(key)
            assert dlg.evaluate("d => d.contains(document.activeElement)"), key
        tab_to(p, dlg.get_by_role("button", name="Confirm placement"))
        p.keyboard.press("Enter")
        says(p, "Planner status", f"{mug['title']} placed on deck 1.")
        gone(p, p.get_by_role("dialog", name="Place piece"))
        ui(p, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
        key_select(p, rail, wide["title"])
        opener.focus()
        p.keyboard.press("Enter")
        dlg = shows(p, "dialog", "Place piece")
        decks = dlg.get_by_role("listbox", name="Deck")
        ui(p, focus_in_decks)
        tab_to(p, dlg.get_by_role("button", name="Confirm placement"))
        p.keyboard.press("Enter")
        refusal = f"Deck 1 is full: footprint would be {pct(324 + 18, SHELF['North Kiln'])}%."
        says(p, "Planner status", refusal)
        reads(p, dlg, refusal)
        p.keyboard.press("Escape")
        gone(p, p.get_by_role("dialog", name="Place piece"))
        ui(p, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
        adder = p.get_by_role("button", name="Add deck")
        adder.focus()
        p.keyboard.press("Enter")
        says(p, "Planner status", "Load updated.")
        mover = shows(p, "button", f"Move {mug['title']}", exact=True)
        mover.focus()
        p.keyboard.press("Enter")
        dlg = shows(p, "dialog", "Move piece")
        reads(p, dlg, f"MOVE {mug['title']}")
        decks = dlg.get_by_role("listbox", name="Deck")
        ui(p, focus_in_decks)
        p.keyboard.press("ArrowDown")
        tab_to(p, dlg.get_by_role("button", name="Confirm move"))
        p.keyboard.press("Enter")
        says(p, "Planner status", f"{mug['title']} moved to deck 2.")
        ui(p, lambda: expect(p.get_by_role("button", name=f"Move {mug['title']}", exact=True)).to_be_focused(timeout=QUICK_MS))
    assert load_pieces(j(tech.get(f"/api/loads/{load['id']}"))) == [[], [mug["id"]]]
    j(set_status(tech, load["id"], "cancelled"))


def test_unload_charges_funding_and_receipts(app_url, mail, killbill):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    j(owner.post(f"/api/members/{m.id}/adjustments", {"amount_cents": 1000, "reason": "Opening credit"}), 201)
    a, b, c = ready(m, tech, VASE), ready(m, tech, MUG), ready(m, tech, BOWL)
    res = fire(tech, "South Kiln", [[a["id"], b["id"]], [c["id"]]], outcome={a["id"]: "intact", b["id"]: "cracked", c["id"]: "damaged"})
    assert res["load"]["status"] == "unloaded" and res["load"]["unloaded_at"]
    by_piece = {ch["piece_id"]: ch for ch in res["charges"]}
    assert set(by_piece) == {a["id"], b["id"]}
    assert by_piece[a["id"]]["fee_cents"] == 949 and by_piece[b["id"]]["fee_cents"] == 216
    assert all(ch["status"] == "settled" and ch["funding"] == "credit" and ch["firing"] == "bisque" for ch in res["charges"])
    for piece, outcome in ((a, "intact"), (b, "cracked"), (c, "damaged")):
        state = passport(m, piece["id"])
        assert state["status"] == "bisqued" and state["outcomes"]["bisque"] == outcome and state["history"][-1]["status"] == "bisqued"
    assert passport(m, c["id"])["charges"] == []
    cr = credit(m)
    check_ledger(cr["entries"], cr["balance_cents"])
    assert cr["balance_cents"] == 1000 - 949 - 216
    for ch in res["charges"]:
        fee = ch["fee_cents"]
        assert charge_entries(cr["entries"], ch["id"]) == [("firing_revenue", fee, "firing_fee"), ("member_credit", -fee, "firing_fee")]
        txns = kb_txns(killbill, m.id, f"kd-charge-{ch['id']}")
        assert len(txns) == 1 and cents(txns[0]) == fee
    fee_order = [e["charge_id"] for e in cr["entries"] if e["kind"] == "firing_fee" and e["account"] == "member_credit"]
    assert fee_order == [by_piece[a["id"]]["id"], by_piece[b["id"]]["id"]]
    for piece, after in ((a, "Balance after $0.51"), (b, "Balance after -$1.65")):
        receipts = inbox(mail, m.email, f"Firing receipt: {piece['title']}")
        assert len(receipts) == 1 and "Paid from credit" in text(receipts[0]) and after in text(receipts[0])
        assert mail_from_address() in addresses(receipts[0].get("From"))
    assert inbox(mail, m.email, f"Firing receipt: {c['title']}", seconds=NO_MAIL_S) == []
    wen = sign_in(app_url, "ember-lane", WEN)
    balance = credit(wen)["balance_cents"]
    if balance:
        j(owner.post(f"/api/members/{wen.id}/adjustments", {"amount_cents": -balance, "reason": "Reset for card test"}), 201)
    w = ready(wen, tech, MUG)
    charge = fire(tech, "South Kiln", [[w["id"]]])["charges"][0]
    assert charge["status"] == "settled" and charge["funding"] == "card" and charge["fee_cents"] == fee_of(72, 5)
    wc = credit(wen)
    assert wc["balance_cents"] == 0 and charge_entries(wc["entries"], charge["id"]) == [("card_receipts", -360, "firing_fee"), ("firing_revenue", 360, "firing_fee")]
    assert len(kb_txns(killbill, wen.id, f"kd-charge-{charge['id']}")) == 1
    receipt = inbox(mail, WEN, f"Firing receipt: {w['title']}")
    assert len(receipt) == 1 and "Paid by card" in text(receipt[0])


def test_unload_outcomes(app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    a, b, c = ready(m, tech, MUG), ready(m, tech, TILE), ready(m, tech, SQUAT)
    load = new_load(tech, "South Kiln")
    for p in (a, b, c):
        j(place(tech, load["id"], p["id"]), 201)
    to_cooling(tech, load)
    invalid(unload(tech, load["id"], {a["id"]: "intact", b["id"]: "intact"}), "outcomes", "Give one outcome for every piece in the load.")
    assert j(tech.get(f"/api/loads/{load['id']}"))["status"] == "cooling"
    assert passport(m, a["id"])["status"] == "waiting_bisque"
    res = j(unload(tech, load["id"], {a["id"]: "intact", b["id"]: "cracked", c["id"]: "damaged"}))
    assert res["load"]["status"] == "unloaded"
    for piece, outcome in ((a, "intact"), (b, "cracked"), (c, "damaged")):
        state = passport(m, piece["id"])
        assert state["status"] == "bisqued" and state["outcomes"] == {"bisque": outcome, "glaze": None}
        assert state["history"][-1]["status"] == "bisqued" and state["location"] is None
    j(tech.post(f"/api/pieces/{a['id']}/check-in"))
    fire(tech, "South Kiln", [[a["id"]]], "glaze", "cracked")
    state = passport(m, a["id"])
    assert state["status"] == "ready_for_pickup" and state["outcomes"] == {"bisque": "intact", "glaze": "cracked"}
    assert [h["status"] for h in state["history"]][-3:] == ["waiting_glaze", "glazed", "ready_for_pickup"]


def test_unload_replay(app_url, mail, killbill):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    p = ready(m, tech, MUG)
    load = new_load(tech, "South Kiln")
    j(place(tech, load["id"], p["id"]), 201)
    to_cooling(tech, load)
    key, body = idempotency_key(), {p["id"]: "intact"}
    rs = together([lambda: unload(tech, load["id"], body, key) for _ in range(3)])
    assert all(r.status_code == 200 for r in rs), [r.text for r in rs]
    assert all(r.json() == rs[0].json() for r in rs)
    assert j(unload(tech, load["id"], body, key)) == rs[0].json()
    err(unload(tech, load["id"], {p["id"]: "cracked"}, key), 409, "idempotency_conflict")
    err(unload(tech, load["id"], body), 409, "illegal_transition")
    charges = settled(m, p["id"], 1)
    assert len(charges) == 1
    assert len(kb_txns(killbill, m.id, f"kd-charge-{charges[0]['id']}")) == 1
    assert len(charge_entries(credit(m)["entries"], charges[0]["id"])) == 2
    assert len(inbox(mail, m.email, f"Firing receipt: {p['title']}", 2, NO_MAIL_S)) == 1


def unload_by_ui(p: Any, base: str, pieces: list[dict], outcomes: dict | None = None, double: bool = False) -> None:
    for button, label in (("Mark loaded", "Loaded"), ("Start firing", "Firing"), ("Start cooling", "Cooling")):
        click(shows(p, "button", button))
        says(p, "Planner status", f"Load is now {label}.")
    click(shows(p, "button", "Unload"))
    dlg = shows(p, "dialog", "Unload")
    for piece, outcome in (outcomes or {}).items():
        check(dlg.get_by_role("radiogroup", name=f"{piece} outcome").get_by_role("radio", name=outcome))
    confirm = dlg.get_by_role("button", name="Confirm unload")
    if double:
        confirm.dblclick()
    else:
        click(confirm)


def test_wf_unload_billing_happy(browser, app_url, mail, killbill):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    mug, bowl = ready(m, tech, MUG), ready(m, tech, BOWL)
    free_kiln(tech, kiln_id(tech, "South Kiln"))
    load = new_load(tech, "South Kiln")
    for p in (mug, bowl):
        j(place(tech, load["id"], p["id"]), 201)
    with signed_in(browser, app_url, "ember-lane", m.email, NEW_PASSWORD, path="/credit") as member, \
            signed_in(browser, app_url, "ember-lane", TECH["ember-lane"], path="/planner") as p:
        unload_by_ui(p, app_url, [mug, bowl], {bowl["title"]: "Cracked"})
        says(p, "Planner status", "Unloaded. 2 charges settled; receipts follow by email.")
        reads(member, member.get_by_role("region", name="Credit balance"), "OWING $6.60", LIVE_S + UI_S)
        shows(member, "table", "Ledger")
    assert passport(m, bowl["id"])["outcomes"]["bisque"] == "cracked"
    for p in (mug, bowl):
        ch = settled(m, p["id"], 1)[0]
        assert len(kb_txns(killbill, m.id, f"kd-charge-{ch['id']}")) == 1
        assert len(inbox(mail, m.email, f"Firing receipt: {p['title']}")) == 1


def test_wf_unload_billing_double_tap(browser, app_url, mail, killbill):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    mug = ready(m, tech, MUG)
    free_kiln(tech, kiln_id(tech, "South Kiln"))
    load = new_load(tech, "South Kiln")
    j(place(tech, load["id"], mug["id"]), 201)
    with signed_in(browser, app_url, "ember-lane", TECH["ember-lane"], path="/planner") as p:
        unload_by_ui(p, app_url, [mug], double=True)
        says(p, "Planner status", "Unloaded. 1 charges settled; receipts follow by email.")
    charges = settled(m, mug["id"], 1)
    assert len(charges) == 1 and len(kb_txns(killbill, m.id, prefix="kd-charge-")) == 1


def test_billing_down_settles_once_across_instances(app_url, mail, killbill):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    a, b = ready(m, tech, VASE), ready(m, tech, MUG)
    load = new_load(tech, "South Kiln")
    j(place(tech, load["id"], a["id"]), 201)
    j(place(tech, load["id"], b["id"]), 201)
    to_cooling(tech, load)
    res = j(unload(sign_in(down, "ember-lane", TECH["ember-lane"]), load["id"], {a["id"]: "intact", b["id"]: "intact"}))
    assert res["load"]["status"] == "unloaded" and len(res["charges"]) == 2
    assert all(c["status"] == "pending" and c["funding"] is None for c in res["charges"])
    ids = [c["id"] for c in sorted(res["charges"], key=lambda c: c["created_at"])]
    for p in (a, b):
        settled(m, p["id"], 1)
    cr = credit(m)
    check_ledger(cr["entries"], cr["balance_cents"])
    assert [e["charge_id"] for e in cr["entries"] if e["kind"] == "firing_fee" and e["account"] == "member_credit"] == ids
    for cid in ids:
        assert len(kb_txns(killbill, m.id, f"kd-charge-{cid}")) == 1 and len(charge_entries(cr["entries"], cid)) == 2
    for p in (a, b):
        assert len(inbox(mail, m.email, f"Firing receipt: {p['title']}", 2, MAIL_S)) == 1


def test_pending_charge_settles_before_newer_unload(app_url, mail, killbill):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    a, b = ready(m, tech, VASE), ready(m, tech, MUG)
    first, second = new_load(tech, "South Kiln"), new_load(tech, "North Kiln")
    j(place(tech, first["id"], a["id"]), 201)
    j(place(tech, second["id"], b["id"]), 201)
    to_cooling(tech, first)
    to_cooling(tech, second)
    older = j(unload(sign_in(down, "ember-lane", TECH["ember-lane"]), first["id"], {a["id"]: "intact"}))["charges"]
    assert [c["status"] for c in older] == ["pending"]
    newer = j(unload(tech, second["id"], {b["id"]: "intact"}))["charges"]
    for p in (a, b):
        settled(m, p["id"], 1)
    cr = credit(m)
    check_ledger(cr["entries"], cr["balance_cents"])
    order = [e["charge_id"] for e in cr["entries"] if e["kind"] == "firing_fee" and e["account"] == "member_credit"]
    assert order == [older[0]["id"], newer[0]["id"]]
    for c in older + newer:
        assert len(kb_txns(killbill, m.id, f"kd-charge-{c['id']}")) == 1


def test_several_instances_act_once(app_url, mail, killbill):
    bases = [app_url, os.environ["APP_KILLBILL_DOWN_URL"], os.environ["APP_MINIO_DOWN_URL"]]
    techs = [sign_in(b, "ember-lane", TECH["ember-lane"]) for b in bases]
    m1, m2 = new_member(app_url, mail), new_member(app_url, mail)
    racer = log_piece(m1, MUG)
    rs = together([lambda t=t: t.post(f"/api/pieces/{racer['id']}/check-in") for t in techs])
    assert [r.status_code for r in rs].count(200) == 1
    for r in rs:
        if r.status_code != 200:
            err(r, 409, "illegal_transition")
    owners = [m1, m2, m1, m2]
    pieces = [ready(m, techs[0], MUG) for m in owners]
    owner_of = {p["id"]: m for p, m in zip(pieces, owners)}
    load = new_load(techs[0], "South Kiln")
    for p in pieces:
        j(place(techs[0], load["id"], p["id"]), 201)
    to_cooling(techs[0], load)
    res = j(unload(techs[1], load["id"], {p["id"]: "intact" for p in pieces}))
    assert len(res["charges"]) == len(pieces) and all(c["status"] == "pending" for c in res["charges"])
    for p in pieces:
        settled(owner_of[p["id"]], p["id"], 1)
    for m in (m1, m2):
        cr = credit(m)
        check_ledger(cr["entries"], cr["balance_cents"])
        for c in res["charges"]:
            if owner_of[c["piece_id"]] is m:
                assert len(kb_txns(killbill, m.id, f"kd-charge-{c['id']}")) == 1
                assert len(charge_entries(cr["entries"], c["id"])) == 2
    for p in pieces:
        assert len(inbox(mail, owner_of[p["id"]].email, f"Firing receipt: {p['title']}", 2, MAIL_S)) == 1


def test_slow_billing_unload(mail, killbill):
    base = os.environ["APP_SLOW_BILLING_URL"]
    tech = sign_in(base, "ember-lane", TECH["ember-lane"])
    m = new_member(base, mail)
    p = ready(m, tech, MUG)
    res = fire(tech, "South Kiln", [[p["id"]]])
    assert res["load"]["status"] == "unloaded"
    assert res["charges"][0]["status"] == "pending" and res["charges"][0]["funding"] is None
    assert passport(m, p["id"])["status"] == "bisqued"
    charge = settled(m, p["id"], 1)[0]
    assert len(kb_txns(killbill, m.id, f"kd-charge-{charge['id']}")) == 1
    cr = credit(m)
    check_ledger(cr["entries"], cr["balance_cents"])
    assert len(charge_entries(cr["entries"], charge["id"])) == 2
    assert len(inbox(mail, m.email, f"Firing receipt: {p['title']}", 2, MAIL_S)) == 1


def test_slow_billing_pack_and_refund(mail, killbill):
    base = os.environ["APP_SLOW_BILLING_URL"]
    tech = sign_in(base, "ember-lane", TECH["ember-lane"])
    owner = sign_in(base, "ember-lane", OWNER["ember-lane"])
    m = new_member(base, mail)
    p = ready(m, tech, MUG)
    fire(tech, "South Kiln", [[p["id"]]])
    charge = settled(m, p["id"], 1)[0]
    r = owner.post(f"/api/charges/{charge['id']}/refund", {"reason": "Cracked by studio"})
    assert j(r, 202)["charge"]["status"] == "refund_pending"
    err(owner.post(f"/api/charges/{charge['id']}/refund", {"reason": "again"}), 409, "charge_not_refundable")
    settled(m, p["id"], 1, "refunded")
    assert len(kb_txns(killbill, m.id, f"kd-refund-{charge['id']}", "REFUND")) == 1
    assert [e for e in credit(m)["entries"] if e["kind"] == "refund" and e["account"] == "member_credit"][0]["amount_cents"] == 216
    assert len([e for e in credit(m)["entries"] if e["kind"] == "refund"]) == 2
    wen = sign_in(base, "ember-lane", WEN)
    pack, key = pack_id(wen, "Credit 20"), idempotency_key()
    packs_before = len([e for e in credit(wen)["entries"] if e["kind"] == "pack"])
    first = j(wen.post(f"/api/credit-packs/{pack}/purchase", {}, key=key), 202)
    assert first["purchase"]["status"] == "pending"
    assert len([e for e in credit(wen)["entries"] if e["kind"] == "pack"]) == packs_before
    done = poll(lambda: (lambda r: r.json() if r.status_code == 201 else None)(wen.post(f"/api/credit-packs/{pack}/purchase", {}, key=key)), SETTLE_S, "pack completion")
    assert done["purchase"]["status"] == "completed" and done["purchase"]["id"] == first["purchase"]["id"]
    assert len([e for e in credit(wen)["entries"] if e["kind"] == "pack"]) == packs_before + 2
    assert len(kb_txns(killbill, wen.id, f"kd-pack-{first['purchase']['id']}")) == 1


def test_photo_storage_outage(app_url, mail):
    down = os.environ["APP_MINIO_DOWN_URL"]
    m = new_member(app_url, mail)
    stored = log_piece(m, MUG)
    md = sign_in(down, "ember-lane", m.email, NEW_PASSWORD)
    err(md.get(f"/api/pieces/{stored['id']}/photo"), 503, "storage_unavailable")
    p = log_piece(md, MUG, photo=False)
    assert p["status"] == "logged"
    err(upload(md, p["id"]), 503, "storage_unavailable")
    err(sign_in(down, "ember-lane", TECH["ember-lane"]).post(f"/api/pieces/{p['id']}/check-in"), 409, "photo_required")
    assert passport(m, p["id"])["photo_url"] is None
    assert not [k for k in S3().keys("studios/") if f"/pieces/{p['id']}/" in k]


def test_wf_service_outages_billing_down(browser, app_url, mail, killbill):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    mug = ready(m, tech, MUG)
    free_kiln(tech, kiln_id(tech, "South Kiln"))
    load = new_load(tech, "South Kiln")
    j(place(tech, load["id"], mug["id"]), 201)
    with signed_in(browser, down, "ember-lane", TECH["ember-lane"], path="/planner") as p:
        unload_by_ui(p, down, [mug])
        says(p, "Planner status", "Unloaded. 1 charges are waiting for billing and will settle automatically.")
    ch = settled(m, mug["id"], 1)[0]
    assert len(kb_txns(killbill, m.id, f"kd-charge-{ch['id']}")) == 1


def test_wf_service_outages_photo(browser, app_url, mail):
    down = os.environ["APP_MINIO_DOWN_URL"]
    m = new_member(app_url, mail)
    stored = log_piece(m, MUG)
    title = f"Outage {uuid.uuid4().hex[:8]}"
    with signed_in(browser, down, "ember-lane", m.email, NEW_PASSWORD, path="/pieces/new") as p:
        fill(p.get_by_role("textbox", name="Title"), title)
        select(p.get_by_role("combobox", name="Clay body"), "Buff Stoneware")
        for name, v in (("Length (in)", "4"), ("Width (in)", "4"), ("Height (in)", "4")):
            fill(p.get_by_role("spinbutton", name=name), v)
        p.get_by_label("Intake photo").set_input_files({"name": "pot.png", "mimeType": "image/png", "buffer": png()})
        click(p.get_by_role("button", name="Log piece"))
        says(p, "Piece status", "Photo storage is unavailable. The piece is logged; add the photo again in a few minutes.")
        go(p, down, f"/pieces/{stored['id']}")
        reads(p, p.locator("body"), "Photo unavailable right now")
        mine = next(x for x in j(m.get("/api/pieces")) if x["title"] == title)
        go(p, down, f"/pieces/{mine['id']}")
        reads(p, p.locator("body"), "No photo yet")
    assert mine["status"] == "logged" and mine["photo_url"] is None


def test_credit_pack_rules_and_daily_limit(app_url, mail, killbill):
    nocard = new_member(app_url, mail, "andes")
    pack = pack_id(nocard, "Credit 20")
    err(nocard.post(f"/api/credit-packs/{pack}/purchase", {}, key=idempotency_key()), 409, "no_card_on_file")
    cam = sign_in(app_url, "andes", CAMILA)
    err(cam.post(f"/api/credit-packs/{pack}/purchase", {}), 400, "idempotency_key_required")
    d, made = today(cam), []
    for _ in range(PACKS_PER_DAY + 1):
        key = idempotency_key()
        r = cam.post(f"/api/credit-packs/{pack}/purchase", {}, key=key)
        if r.status_code == 409:
            break
        b = j(r, 201)
        assert b["purchase"]["status"] == "completed" and b["purchase"]["amount_cents"] == 2000
        made.append((key, r.json()))
    limit = err(r, 409, "pack_limit_reached")
    assert limit["message"] == LIMIT_COPY
    assert instant(limit["next_purchase_at"]) == day_start(d + dt.timedelta(days=1), TZ["andes"])
    assert j(cam.post(f"/api/credit-packs/{pack}/purchase", {}, key=key), 409) == limit
    cr = credit(cam)
    check_ledger(cr["entries"], cr["balance_cents"])
    todays = [e for e in cr["entries"] if e["kind"] == "pack" and e["account"] == "member_credit" and local_date(e["created_at"], TZ["andes"]) == d]
    assert len(todays) == PACKS_PER_DAY
    for k, b in made:
        assert j(cam.post(f"/api/credit-packs/{pack}/purchase", {}, key=k), 201) == b
        txns = kb_txns(killbill, cam.id, f"kd-pack-{b['purchase']['id']}")
        assert len(txns) == 1 and cents(txns[0]) == 2000
    if made:
        err(cam.post(f"/api/credit-packs/{pack}/purchase", {"extra": 1}, key=made[0][0]), 409, "idempotency_conflict")


def test_studio_days(app_url, mail):
    for slug, tz in TZ.items():
        owner = sign_in(app_url, slug, OWNER[slug])
        m = new_member(app_url, mail, slug)
        before = today(owner)
        adj = j(owner.post(f"/api/members/{m.id}/adjustments", {"amount_cents": 100, "reason": "Day check"}), 201)
        after = today(owner)
        stamp = next(e["created_at"] for e in credit(m)["entries"] if e["movement_id"] == adj["movement_id"])
        assert local_date(stamp, tz) in {before, after}, (slug, stamp, before, after)
        log = j(owner.get("/api/firing-log"))
        assert log["time_zone"] == tz and dt.date.fromisoformat(log["date"]) in {before, after, today(owner)}
        assert j(owner.get("/api/studio"))["time_zone"] == tz


def test_credit_pack_race(app_url, killbill):
    ana = sign_in(app_url, "saltmarsh", ANA)
    d, pack = today(ana), pack_id(ana, "Credit 20")

    def todays() -> int:
        return len([e for e in credit(ana)["entries"] if e["kind"] == "pack" and e["account"] == "member_credit" and local_date(e["created_at"], TZ["saltmarsh"]) == d])

    remaining = PACKS_PER_DAY - todays()
    kb_before = len(kb_txns(killbill, ana.id, prefix="kd-pack-"))
    rs = together([lambda: ana.post(f"/api/credit-packs/{pack}/purchase", {}, key=idempotency_key()) for _ in range(RACE)])
    wins = [r for r in rs if r.status_code == 201]
    assert len(wins) == remaining
    for r in rs:
        if r.status_code != 201:
            err(r, 409, "pack_limit_reached")
    assert todays() == PACKS_PER_DAY
    assert len(kb_txns(killbill, ana.id, prefix="kd-pack-")) == kb_before + remaining


def test_paired_ledger(app_url, mail):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    p = ready(m, tech, MUG)
    load = new_load(tech, "South Kiln")
    j(place(tech, load["id"], p["id"]), 201)
    to_cooling(tech, load)
    amounts = [300 if i % 2 == 0 else -100 for i in range(RACE)]
    calls = [lambda a=a: owner.post(f"/api/members/{m.id}/adjustments", {"amount_cents": a, "reason": "Race"}) for a in amounts]
    calls.append(lambda: unload(tech, load["id"], {p["id"]: "intact"}))
    rs = together(calls)
    assert all(r.status_code == 201 for r in rs[:-1]) and rs[-1].status_code == 200, [r.text for r in rs]
    settled(m, p["id"], 1)
    cr = credit(m)
    moves = check_ledger(cr["entries"], cr["balance_cents"])
    assert cr["balance_cents"] == sum(amounts) - 216
    kinds = [pair[0]["kind"] for pair in moves.values()]
    assert kinds.count("adjustment") == RACE and kinds.count("firing_fee") == 1
    assert j(owner.get(f"/api/members/{m.id}"))["balance_cents"] == cr["balance_cents"]
    assert [x["balance_cents"] for x in j(owner.get("/api/members", params={"q": m.handle})) if x["id"] == m.id] == [cr["balance_cents"]]


def test_ledger_refund_and_adjustment(app_url, mail, killbill):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    adj = j(owner.post(f"/api/members/{m.id}/adjustments", {"amount_cents": 500, "reason": "Welcome"}), 201)
    assert adj["balance_cents"] == 500
    pair = sorted((e["account"], e["amount_cents"], e["kind"]) for e in credit(m)["entries"] if e["movement_id"] == adj["movement_id"])
    assert pair == [("adjustments", -500, "adjustment"), ("member_credit", 500, "adjustment")]
    amount_msg = "Enter a non-zero amount up to $1,000.00 either way."
    for bad in (0, 100001):
        invalid(owner.post(f"/api/members/{m.id}/adjustments", {"amount_cents": bad, "reason": "x"}), "amount_cents", amount_msg)
    invalid(owner.post(f"/api/members/{m.id}/adjustments", {"amount_cents": 1, "reason": ""}), "reason", "Enter a reason of 1 to 200 characters.")
    rs = together([lambda: owner.post(f"/api/members/{m.id}/adjustments", {"amount_cents": 100, "reason": "Race"}) for _ in range(RACE)])
    assert all(r.status_code == 201 for r in rs)
    assert credit(m)["balance_cents"] == 500 + 100 * RACE
    for caller in (tech, m):
        err(caller.post(f"/api/members/{m.id}/adjustments", {"amount_cents": 100, "reason": "Self"}), 403, "forbidden")
    assert credit(m)["balance_cents"] == 500 + 100 * RACE
    p = ready(m, tech, MUG)
    charge = fire(tech, "South Kiln", [[p["id"]]])["charges"][0]
    assert charge["funding"] == "credit"
    for caller in (tech, m):
        err(caller.post(f"/api/charges/{charge['id']}/refund", {"reason": "Self"}), 403, "forbidden")
    assert passport(m, p["id"])["charges"][0]["status"] == "settled"
    before = credit(m)["entries"]
    r = j(owner.post(f"/api/charges/{charge['id']}/refund", {"reason": "Damaged in kiln"}))
    assert r["charge"]["status"] == "refunded" and r["balance_cents"] == 500 + 100 * RACE
    after = credit(m)
    assert after["entries"][: len(before)] == before
    assert charge_entries(after["entries"], charge["id"]) == sorted([("firing_revenue", 216, "firing_fee"), ("member_credit", -216, "firing_fee"), ("firing_revenue", -216, "refund"), ("member_credit", 216, "refund")])
    assert len(kb_txns(killbill, m.id, f"kd-refund-{charge['id']}", "REFUND")) == 1
    err(owner.post(f"/api/charges/{charge['id']}/refund", {"reason": "again"}), 409, "charge_not_refundable")
    err(owner.post(f"/api/charges/{uuid.uuid4()}/refund", {"reason": "x"}), 404, "not_found")
    j(owner.post(f"/api/members/{m.id}/adjustments", {"amount_cents": -2000, "reason": "Correction"}), 201)
    final = credit(m)
    check_ledger(final["entries"], final["balance_cents"])
    assert final["balance_cents"] == 500 + 100 * RACE - 2000
    assert j(owner.get(f"/api/members/{m.id}"))["balance_cents"] == final["balance_cents"]


def test_wf_member_credit_buy(browser, app_url, killbill):
    wen = sign_in(app_url, "ember-lane", WEN)
    start = credit(wen)
    with signed_in(browser, app_url, "ember-lane", WEN, path="/credit") as p:
        buy = shows(p, "button", "Buy Credit 20")
        click(buy)
        dlg = shows(p, "dialog", "Buy credit")
        reads(p, dlg, "$20.00")
        click(dlg.get_by_role("button", name="Cancel"))
        gone(p, p.get_by_role("dialog", name="Buy credit"))
        ui(p, lambda: expect(buy).to_be_focused(timeout=QUICK_MS))
        assert credit(wen)["entries"] == start["entries"]
        click(buy)
        click(shows(p, "dialog", "Buy credit").get_by_role("button", name="Confirm purchase"))
        after = start["balance_cents"] + 2000
        label = f"BALANCE {money(after)}" if after >= 0 else f"OWING {money(after)}"
        says(p, "Credit status", f"Credit added. Balance {money(after)}." if after >= 0 else f"Credit added. Balance -{money(after)}.")
        reads(p, p.get_by_role("region", name="Credit balance"), label)
        shows(p, "table", "Ledger")
    cr = credit(wen)
    assert cr["balance_cents"] == after and len(cr["entries"]) == len(start["entries"]) + 2
    assert len(kb_txns(killbill, wen.id, prefix="kd-pack-")) >= 1


def test_wf_member_credit_owner_desk(browser, app_url, mail, killbill):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    p = ready(m, tech, MUG)
    charge = fire(tech, "South Kiln", [[p["id"]]])["charges"][0]
    with signed_in(browser, app_url, "ember-lane", m.email, NEW_PASSWORD, path="/credit") as member, \
            signed_in(browser, app_url, "ember-lane", OWNER["ember-lane"], path="/members") as o:
        fill(o.get_by_role("searchbox", name="Search members"), m.handle)
        click(shows(o, "link", m.user["name"], root=o.get_by_role("table", name="Members")))
        click(shows(o, "button", "Adjust credit"))
        dlg = shows(o, "dialog", "Adjust credit")
        fill(dlg.get_by_role("textbox", name="Amount ($)"), "5.00")
        fill(dlg.get_by_role("textbox", name="Reason"), "Goodwill")
        click(dlg.get_by_role("button", name="Post adjustment"))
        says(o, "Members status", "Adjustment posted. Balance $2.84.")
        click(shows(o, "button", f"Refund {p['title']}"))
        dlg = shows(o, "dialog", "Refund charge")
        fill(dlg.get_by_role("textbox", name="Reason"), "Studio damaged it")
        click(dlg.get_by_role("button", name="Confirm refund"))
        says(o, "Members status", "Refund issued. Balance $5.00.")
        click(shows(o, "button", "Deactivate"))
        click(shows(o, "dialog", "Deactivate member").get_by_role("button", name="Confirm deactivation"))
        says(o, "Members status", f"{m.user['name']} deactivated. Their sessions have ended.")
        reads(o, o.locator("body"), "INACTIVE")
        says(member, "Session status", "Your session ended. Sign in again.", LIVE_S + UI_S)
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    detail = j(owner.get(f"/api/members/{m.id}"))
    assert detail["active"] is False and detail["balance_cents"] == 500
    assert len(kb_txns(killbill, m.id, f"kd-refund-{charge['id']}", "REFUND")) == 1


def test_deactivation(app_url, mail):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    logged, placed, racer = log_piece(m, MUG), ready(m, tech, BOWL), log_piece(m, MUG)
    load = new_load(tech, "South Kiln")
    j(place(tech, load["id"], placed["id"]), 201)
    second = sign_in(app_url, "ember-lane", m.email, NEW_PASSWORD)
    deact, ci = together([lambda: owner.post(f"/api/members/{m.id}/deactivate"), lambda: tech.post(f"/api/pieces/{racer['id']}/check-in")])
    assert j(deact)["active"] is False
    if ci.status_code == 200:
        assert j(tech.get(f"/api/pieces/{racer['id']}"))["history"][-1]["status"] == "waiting_bisque"
    else:
        err(ci, 409, "member_inactive")
    for s in (m, second):
        err(s.get("/api/me"), 401, "unauthenticated")
    for _ in range(FAILS + 1):
        err(Api(app_url).post("/api/session", {"studio": "ember-lane", "email": m.email, "password": NEW_PASSWORD}), 403, "account_inactive")
    err(owner.post("/api/invites", {"email": m.email, "role": "member", "membership": "member"}), 409, "member_inactive")
    assert logged["id"] not in [t["id"] for t in j(tech.get("/api/pieces", params={"status": "logged"}))]
    err(tech.post(f"/api/pieces/{logged['id']}/check-in"), 409, "member_inactive")
    to_cooling(tech, load)
    res = j(unload(tech, load["id"], {placed["id"]: "intact"}))
    assert len(res["charges"]) == 1
    poll(lambda: [c for c in j(owner.get(f"/api/members/{m.id}"))["charges"] if c["status"] == "settled"], SETTLE_S, "charge settling")
    assert j(owner.post(f"/api/members/{m.id}/deactivate"))["active"] is False
    assert j(owner.post(f"/api/members/{m.id}/reactivate"))["active"] is True
    assert j(owner.post(f"/api/members/{m.id}/reactivate"))["active"] is True
    back = sign_in(app_url, "ember-lane", m.email, NEW_PASSWORD)
    err(second.get("/api/me"), 401, "unauthenticated")
    assert user_of(j(back.get("/api/me")))["id"] == m.id
    assert logged["id"] in [t["id"] for t in j(tech.get("/api/pieces", params={"status": "logged"}))]
    assert j(tech.post(f"/api/pieces/{logged['id']}/check-in"))["status"] == "waiting_bisque"


def test_rate_schedule_effective_dates(mail):
    base = os.environ["APP_SHORT_URL"]
    owner = sign_in(base, "saltmarsh", OWNER["saltmarsh"])
    tech = sign_in(base, "saltmarsh", TECH["saltmarsh"])
    m = new_member(base, mail, "saltmarsh")
    early = log_piece(m, JAR)
    assert early["quote"]["bisque"]["fee_cents"] == 192 and early["quote"]["glaze"]["fee_cents"] == 384
    d = today(owner)
    rates = {"member_bisque_cents": 3, "member_glaze_cents": 9, "dropoff_bisque_cents": 5, "dropoff_glaze_cents": 9}
    r = owner.post("/api/rate-schedules", {**rates, "effective_from": d.isoformat()})
    fresh = r.status_code == 201
    if not fresh:
        invalid(r, "effective_from", "A rate schedule already starts on that date.")
    sched = next(s for s in j(owner.get("/api/rate-schedules")) if s["effective_from"] == d.isoformat())
    q = j(m.post("/api/quotes", {"length_in": 4, "width_in": 4, "height_in": 6}))
    assert q["rates_effective_from"] == d.isoformat() and q["bisque"]["rate_cents"] == sched["member_bisque_cents"]
    assert q["glaze"]["fee_cents"] == fee_of(96, sched["member_glaze_cents"])
    if fresh:
        assert passport(m, early["id"])["quote"]["bisque"] == {"rate_cents": 2, "fee_cents": 192}
        j(upload(m, early["id"]))
        j(tech.post(f"/api/pieces/{early['id']}/check-in"))
        load = new_load(tech, "Tide Kiln")
        assert j(place(tech, load["id"], early["id"]), 201)["value_cents"] == 192
        to_cooling(tech, load)
        charge = j(unload(tech, load["id"], {early["id"]: "intact"}))["charges"][0]
        assert charge["fee_cents"] == 192 and charge["rate_cents"] == 2
    invalid(owner.post("/api/rate-schedules", {**rates, "effective_from": (d - dt.timedelta(days=1)).isoformat()}), "effective_from", "Choose today or a later date.")
    future = (d + dt.timedelta(days=400 + uuid.uuid4().int % 3000)).isoformat()
    for bad in (0, 101):
        invalid(owner.post("/api/rate-schedules", {**rates, "member_bisque_cents": bad, "effective_from": future}), "member_bisque_cents", CENTS_MSG)
    rs = together([lambda: owner.post("/api/rate-schedules", {**rates, "effective_from": future}) for _ in range(RACE)])
    assert [x.status_code for x in rs].count(201) == 1
    for x in rs:
        if x.status_code != 201:
            invalid(x, "effective_from", "A rate schedule already starts on that date.")
    listed = [s["effective_from"] for s in j(owner.get("/api/rate-schedules"))]
    assert listed == sorted(listed, reverse=True) and future in listed
    assert j(m.post("/api/quotes", {"length_in": 4, "width_in": 4, "height_in": 6}))["rates_effective_from"] == d.isoformat()


def test_owner_only_actions(app_url, mail):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    p = ready(m, tech, MUG)
    charge = fire(tech, "South Kiln", [[p["id"]]])["charges"][0]
    studio, month, probe = j(owner.get("/api/studio")), today(owner).strftime("%Y-%m"), fresh_email()
    calls = [
        ("PUT", "/api/studio/settings", {"pickup_window_days": 30}),
        ("POST", "/api/rate-schedules", {"effective_from": "2099-01-01", "member_bisque_cents": 9, "member_glaze_cents": 9, "dropoff_bisque_cents": 9, "dropoff_glaze_cents": 9}),
        ("GET", "/api/rate-schedules", None),
        ("POST", f"/api/charges/{charge['id']}/refund", {"reason": "x"}),
        ("POST", f"/api/members/{m.id}/adjustments", {"amount_cents": 100, "reason": "x"}),
        ("POST", "/api/invites", {"email": probe, "role": "kiln_tech"}),
        ("POST", f"/api/members/{m.id}/deactivate", None),
        ("POST", f"/api/members/{m.id}/reactivate", None),
        ("POST", f"/api/pieces/{p['id']}/mark-uncollected", None),
        ("POST", f"/api/reports/months/{month}/close", None),
        ("GET", "/api/dashboard", None),
        ("GET", "/api/reports/revenue", None),
        ("GET", "/api/reports/statement.csv", None),
        ("GET", "/api/firing-log", None),
        ("GET", "/api/members", None),
        ("GET", f"/api/members/{m.id}", None),
    ]
    for caller in (tech, m):
        for method, path, body in calls:
            r = caller.http.request(method, path, json=body) if body is not None else caller.http.request(method, path)
            err(r, 403, "forbidden")
    assert j(owner.get("/api/studio")) == studio
    detail = j(owner.get(f"/api/members/{m.id}"))
    assert detail["active"] is True and [c["status"] for c in detail["charges"]] == ["settled"]
    assert detail["balance_cents"] == -216 and inbox(mail, probe, "Join Ember Lane Clay on Kiln Desk", seconds=NO_MAIL_S) == []


def test_wf_rate_changes_schedule(browser):
    base = os.environ["APP_SHORT_URL"]
    owner = sign_in(base, "saltmarsh", OWNER["saltmarsh"])
    start = today(owner) + dt.timedelta(days=400 + uuid.uuid4().int % 3000)
    with signed_in(browser, base, "saltmarsh", OWNER["saltmarsh"], path="/rates") as p:
        fill(p.get_by_label("Effective from"), start.isoformat())
        for name, v in (("Member bisque (¢/cu in)", "4"), ("Member glaze (¢/cu in)", "8"), ("Drop-off bisque (¢/cu in)", "6"), ("Drop-off glaze (¢/cu in)", "9")):
            fill(p.get_by_role("spinbutton", name=name), v)
        click(p.get_by_role("button", name="Schedule rates"))
        says(p, "Rates status", f"Rates scheduled from {screen_date(start)}.")
        reads(p, p.get_by_role("table", name="Rate schedules"), screen_date(start))
    s = next(x for x in j(owner.get("/api/rate-schedules")) if x["effective_from"] == start.isoformat())
    assert (s["member_bisque_cents"], s["member_glaze_cents"], s["dropoff_bisque_cents"], s["dropoff_glaze_cents"]) == (4, 8, 6, 9)


def test_wf_rate_changes_invalid(browser):
    base = os.environ["APP_SHORT_URL"]
    owner = sign_in(base, "saltmarsh", OWNER["saltmarsh"])
    start = today(owner) + dt.timedelta(days=400 + uuid.uuid4().int % 3000)
    with signed_in(browser, base, "saltmarsh", OWNER["saltmarsh"], path="/rates") as p:
        fill(p.get_by_label("Effective from"), start.isoformat())
        for name, v in (("Member bisque (¢/cu in)", "0"), ("Member glaze (¢/cu in)", "8"), ("Drop-off bisque (¢/cu in)", "6"), ("Drop-off glaze (¢/cu in)", "9")):
            fill(p.get_by_role("spinbutton", name=name), v)
        click(p.get_by_role("button", name="Schedule rates"))
        field = p.get_by_role("spinbutton", name="Member bisque (¢/cu in)")
        if field.evaluate("e => e.validity.valid"):
            says(p, "Rates status", "Fix the highlighted fields.")
            ui(p, lambda: expect(field).to_have_accessible_description(CENTS_MSG, timeout=QUICK_MS))
    assert start.isoformat() not in [x["effective_from"] for x in j(owner.get("/api/rate-schedules"))]


def report(owner: Api, month: str) -> tuple[dict, httpx.Response]:
    for _ in range(5):
        a = j(owner.get("/api/reports/revenue", params={"month": month}))
        r = owner.get("/api/reports/statement.csv", params={"month": month})
        if j(owner.get("/api/reports/revenue", params={"month": month})) == a:
            return a, r
    raise AssertionError("revenue kept changing")


def test_statement_csv_and_revenue(app_url, mail):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    m = new_member(app_url, mail)
    title = '=HYPERLINK("x")'
    p = ready(m, tech, VASE, title=title)
    charge = fire(tech, "South Kiln", [[p["id"]]])["charges"][0]
    refund = j(owner.post(f"/api/charges/{charge['id']}/refund", {"reason": "Cracked by the studio"}))["charge"]
    tz = TZ["ember-lane"]
    month = local_date(charge["settled_at"], tz).strftime("%Y-%m")
    rev, r = report(owner, month)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert f'filename="statement-{month}.csv"' in r.headers.get("content-disposition", "") and "attachment" in r.headers["content-disposition"]
    rows = statement_rows(r)
    assert ",".join(rows[0]) == HEADER
    mine = [x for x in rows[1:] if x[2] == charge["id"]]
    assert [x for x in mine if x[1] == "fee"] == [[local_date(charge["settled_at"], tz).isoformat(), "fee", charge["id"], m.handle, "'" + title, "bisque", "316.250", "3", "9.49"]]
    back = [x for x in mine if x[1] == "refund"]
    assert len(back) == 1 and back[0][0] == local_date(refund["refunded_at"], tz).isoformat() and back[0][3:5] == [m.handle, "'" + title] and back[0][8] == "9.49"
    dollars = lambda kinds: sum(int(Decimal(x[8]) * 100) for x in rows[1:] if x[1] in kinds)
    assert rev["month"] == month and rev["fees_cents"] == dollars({"fee", "storage"}) and rev["refunds_cents"] == dollars({"refund"})
    assert rev["net_cents"] == rev["fees_cents"] - rev["refunds_cents"] and rev["charge_count"] == len([x for x in rows[1:] if x[1] in {"fee", "storage"}])
    invalid(owner.get("/api/reports/revenue", params={"month": "2026-13"}), "month", "Choose a month.")
    invalid(owner.get("/api/reports/statement.csv", params={"month": "soon"}), "month", "Choose a month.")


def test_reports_scoped(app_url, mail):
    e_owner, e_tech = sign_in(app_url, "ember-lane", OWNER["ember-lane"]), sign_in(app_url, "ember-lane", TECH["ember-lane"])
    s_owner, s_tech = sign_in(app_url, "saltmarsh", OWNER["saltmarsh"]), sign_in(app_url, "saltmarsh", TECH["saltmarsh"])
    em, sm = new_member(app_url, mail), new_member(app_url, mail, "saltmarsh")
    eres = fire(e_tech, "South Kiln", [[ready(em, e_tech, MUG)["id"]]])
    sres = fire(s_tech, "Tide Kiln", [[ready(sm, s_tech, JAR)["id"]]])
    assert j(e_owner.get("/api/members", params={"q": sm.handle})) == []
    assert [x["id"] for x in j(e_owner.get("/api/members", params={"q": em.handle.upper()}))] == [em.id]
    err(e_owner.get(f"/api/members/{sm.id}"), 404, "not_found")
    month = local_date(eres["charges"][0]["settled_at"], TZ["ember-lane"]).strftime("%Y-%m")
    csv_text = e_owner.get("/api/reports/statement.csv", params={"month": month}).text
    assert eres["charges"][0]["id"] in csv_text and sres["charges"][0]["id"] not in csv_text and sm.handle not in csv_text
    counts = j(e_owner.get("/api/dashboard"))["counts"]
    ready(sm, s_tech, MUG)
    assert j(e_owner.get("/api/dashboard"))["counts"] == counts
    ed = local_date(eres["load"]["unloaded_at"], TZ["ember-lane"]).isoformat()
    assert sres["load"]["id"] not in [f["load_id"] for f in j(e_owner.get("/api/firing-log", params={"date": ed}))["firings"]]
    sday = local_date(sres["load"]["unloaded_at"], TZ["saltmarsh"]).isoformat()
    s_ids = [f["load_id"] for f in j(s_owner.get("/api/firing-log", params={"date": sday}))["firings"]]
    assert sres["load"]["id"] in s_ids and eres["load"]["id"] not in s_ids


def test_firing_log_day(app_url, mail):
    for studio, kiln_name in (("saltmarsh", "Tide Kiln"), ("ember-lane", "South Kiln")):
        firing_log_day(app_url, mail, studio, kiln_name)


def firing_log_day(app_url, mail, studio, kiln_name):
    e_owner, e_tech = sign_in(app_url, studio, OWNER[studio]), sign_in(app_url, studio, TECH[studio])
    em = new_member(app_url, mail, studio)
    piece = ready(em, e_tech, MUG)
    eres = fire(e_tech, kiln_name, [[piece["id"]]])
    tz = TZ[studio]
    d = local_date(eres["load"]["unloaded_at"], tz)
    log = j(e_owner.get("/api/firing-log", params={"date": d.isoformat()}))
    assert log["date"] == d.isoformat() and log["time_zone"] == tz
    ours = [f for f in log["firings"] if f["load_id"] == eres["load"]["id"]]
    assert len(ours) == 1 and ours[0]["kiln_name"] == kiln_name and ours[0]["firing"] == "bisque"
    assert ours[0]["piece_count"] == 1 and ours[0]["value_cents"] == piece["quote"]["bisque"]["fee_cents"]
    for f in log["firings"]:
        assert day_start(d, tz) <= instant(f["unloaded_at"]) < day_start(d + dt.timedelta(days=1), tz)
    for other in (d - dt.timedelta(days=1), d + dt.timedelta(days=1)):
        assert eres["load"]["id"] not in [f["load_id"] for f in j(e_owner.get("/api/firing-log", params={"date": other.isoformat()}))["firings"]]
    assert j(e_owner.get("/api/firing-log"))["date"] == today(e_owner).isoformat()
    invalid(e_owner.get("/api/firing-log", params={"date": "2026-02-30"}), "date", "Choose a day.")


def test_month_close(app_url):
    owner = sign_in(app_url, "saltmarsh", OWNER["saltmarsh"])
    t = today(owner)
    prev = (t.replace(day=1) - dt.timedelta(days=1))
    prev2 = (prev.replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m")
    err(owner.post(f"/api/reports/months/{t.strftime('%Y-%m')}/close"), 409, "month_open")
    err(owner.post("/api/reports/months/2099-01/close"), 409, "month_open")
    assert j(owner.get("/api/reports/revenue"))["closed_at"] is None
    r = owner.post(f"/api/reports/months/{prev.strftime('%Y-%m')}/close")
    if r.status_code == 200:
        assert r.json()["month"] == prev.strftime("%Y-%m") and r.json()["closed_at"]
    else:
        err(r, 409, "month_closed")
    err(owner.post(f"/api/reports/months/{prev.strftime('%Y-%m')}/close"), 409, "month_closed")
    rev = j(owner.get("/api/reports/revenue", params={"month": prev.strftime("%Y-%m")}))
    assert rev["closed_at"] and j(owner.get("/api/reports/revenue", params={"month": prev.strftime("%Y-%m")})) == rev
    one = owner.get("/api/reports/statement.csv", params={"month": prev.strftime("%Y-%m")})
    two = owner.get("/api/reports/statement.csv", params={"month": prev.strftime("%Y-%m")})
    assert one.status_code == 200 and one.content == two.content and one.content.decode().splitlines()[0] == HEADER
    rs = together([lambda: owner.post(f"/api/reports/months/{prev2}/close") for _ in range(RACE)])
    assert [x.status_code for x in rs].count(200) <= 1
    for x in rs:
        if x.status_code != 200:
            err(x, 409, "month_closed")
    assert j(owner.get("/api/reports/revenue", params={"month": prev2}))["closed_at"]


def test_wf_owner_reports_dashboard(browser, app_url, mail):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    m = new_member(app_url, mail)
    with signed_in(browser, app_url, "ember-lane", OWNER["ember-lane"]) as p:
        shows(p, "region", "Backlog")
        for name in TILES + ["Pending charges", "Month revenue"]:
            shows(p, "group", name, exact=True)
        shows(p, "table", "Longest waiting")
        reads(p, p.get_by_role("group", name="Month revenue"), "$")
        logged = p.get_by_role("group", name="Logged", exact=True)
        ui(p, lambda: expect(logged).to_contain_text(str(j(owner.get("/api/dashboard"))["counts"]["logged"]), timeout=QUICK_MS))
        before = figure(logged)
        log_piece(m, MUG)
        ui(p, lambda: expect(logged).to_contain_text(str(before + 1), timeout=QUICK_MS), LIVE_S)
        assert figure(logged) == before + 1
    assert j(owner.get("/api/dashboard"))["counts"]["logged"] >= before + 1


def test_wf_owner_reports_close_export(browser, app_url):
    owner = sign_in(app_url, "saltmarsh", OWNER["saltmarsh"])
    month = dt.date(2020 + uuid.uuid4().int % 5, 1 + uuid.uuid4().int % 12, 1)
    key = month.strftime("%Y-%m")
    was_closed = j(owner.get("/api/reports/revenue", params={"month": key}))["closed_at"] is not None
    with signed_in(browser, app_url, "saltmarsh", OWNER["saltmarsh"], path="/reports") as p:
        fill(p.get_by_label("Month", exact=True), key)
        revenue = p.get_by_role("region", name="Monthly revenue")
        if not was_closed:
            click(shows(p, "button", f"Close {month_name(month)}"))
            dlg = shows(p, "dialog", "Close month")
            reads(p, dlg, f"Close {month_name(month)}? Its statement becomes final.")
            click(dlg.get_by_role("button", name="Confirm close"))
            says(p, "Reports status", f"{month_name(month)} closed. Its statement is final.")
        reads(p, revenue, "CLOSED")
        with p.expect_download() as dl:
            click(p.get_by_role("button", name="Export statement"))
        assert dl.value.suggested_filename == f"statement-{key}.csv"
        assert Path(dl.value.path()).read_text(encoding="utf-8").splitlines()[0] == HEADER
    assert j(owner.get("/api/reports/revenue", params={"month": key}))["closed_at"]


def test_wf_owner_reports_month_close_ui(browser, app_url):
    owner = sign_in(app_url, "andes", OWNER["andes"])
    month = dt.date(2015 + uuid.uuid4().int % 5, 1 + uuid.uuid4().int % 12, 1)
    key = month.strftime("%Y-%m")
    assert j(owner.get("/api/reports/revenue", params={"month": key}))["closed_at"] is None
    with signed_in(browser, app_url, "andes", OWNER["andes"], path="/reports") as p:
        fill(p.get_by_label("Month", exact=True), key)
        click(shows(p, "button", f"Close {month_name(month)}"))
        dlg = shows(p, "dialog", "Close month")
        click(dlg.get_by_role("button", name="Confirm close"))
        says(p, "Reports status", f"{month_name(month)} closed. Its statement is final.")
        reads(p, p.get_by_role("region", name="Monthly revenue"), "CLOSED")
    assert j(owner.get("/api/reports/revenue", params={"month": key}))["closed_at"]


def glaze_ready(base: str, mail: Any, dims_list: list[tuple]) -> tuple[Api, Api, list[dict], dict]:
    tech = sign_in(base, "ember-lane", TECH["ember-lane"])
    m = new_member(base, mail)
    pieces = [ready(m, tech, d) for d in dims_list]
    fire(tech, "South Kiln", [[p["id"] for p in pieces]])
    for p in pieces:
        j(tech.post(f"/api/pieces/{p['id']}/check-in"))
    res = fire(tech, "South Kiln", [[p["id"] for p in pieces]], "glaze")
    return m, tech, pieces, res


def test_pickup_deadline_reminder_and_collection(mail):
    base = os.environ["APP_SHORT_URL"]
    owner = sign_in(base, "ember-lane", OWNER["ember-lane"])
    invalid(owner.put("/api/studio/settings", {"pickup_window_days": 2}), "pickup_window_days", "Enter whole days from 3 to 60.")
    invalid(owner.put("/api/studio/settings", {"storage_fee_cents": 501}), "storage_fee_cents", "Enter whole cents from 0 to 500.")
    fee = j(owner.get("/api/studio"))["storage_fee_cents"]
    s = j(owner.put("/api/studio/settings", {"pickup_window_days": REMINDER_WINDOW}))
    assert s["pickup_window_days"] == REMINDER_WINDOW and s["storage_fee_cents"] == fee
    m, tech, (a, b), res = glaze_ready(base, mail, [MUG, BOWL])
    deadline = local_date(res["load"]["unloaded_at"], TZ["ember-lane"]) + dt.timedelta(days=REMINDER_WINDOW)
    for p in (a, b):
        state = passport(m, p["id"])
        assert state["status"] == "ready_for_pickup" and state["pickup_deadline"] == deadline.isoformat() and state["outcomes"]["glaze"] == "intact"
        assert [h["status"] for h in state["history"]][-2:] == ["glazed", "ready_for_pickup"]
    ready_mail = inbox(mail, m.email, "Ready for pickup at Ember Lane Clay")
    assert len(ready_mail) == 1 and all(p["title"] in text(ready_mail[0]) for p in (a, b)) and f"Collect by {screen_date(deadline)}" in text(ready_mail[0])
    for p in (a, b):
        assert inbox(mail, m.email, f"Pickup reminder: {p['title']}", seconds=REMINDER_WAIT_S)
    mail.messages(0, REMINDER_SETTLE_S)
    for p in (a, b):
        found = inbox(mail, m.email, f"Pickup reminder: {p['title']}", 2, 0)
        assert len(found) == 1 and f"Collect by {screen_date(deadline)}" in text(found[0])
    j(owner.put("/api/studio/settings", {"pickup_window_days": 10}))
    assert passport(m, b["id"])["pickup_deadline"] == deadline.isoformat()
    err(owner.post(f"/api/pieces/{a['id']}/mark-uncollected"), 409, "pickup_not_due")
    assert j(tech.post(f"/api/pieces/{a['id']}/collect"))["status"] == "collected"
    err(tech.post(f"/api/pieces/{a['id']}/collect"), 409, "illegal_transition")
    late = owner.post(f"/api/pieces/{a['id']}/mark-uncollected")
    assert late.status_code == 409 and late.json().get("error") in ("pickup_not_due", "illegal_transition"), late.text
    assert passport(m, b["id"])["status"] == "ready_for_pickup"


def test_wf_pickup_history_dates(browser, mail):
    base = os.environ["APP_SHORT_URL"]
    m, tech, (p,), res = glaze_ready(base, mail, [MUG])
    assert j(tech.post(f"/api/pieces/{p['id']}/collect"))["status"] == "collected"
    last = passport(m, p["id"])["history"][-1]
    label = screen_date(local_date(last["at"], TZ["ember-lane"]))
    with signed_in(browser, base, "ember-lane", m.email, NEW_PASSWORD, path=f"/pieces/{p['id']}") as page:
        history = shows(page, "list", "Piece history")
        ui(page, lambda: expect(history.get_by_role("listitem").last).to_contain_text(label, timeout=QUICK_MS))
        assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:", history.inner_text())


def test_storage_fee_charges(killbill):
    base = os.environ["APP_PICKUP_DUE_URL"]
    diego = sign_in(base, "andes", DIEGO)
    planter = next(p for p in j(diego.get("/api/pieces")) if p["title"] == "Terrace Planter")
    assert planter["pickup_deadline"] == "2026-11-13"
    day = dt.date(2026, 11, 14)

    def storage() -> list[dict] | None:
        cs = [c for c in passport(diego, planter["id"])["charges"] if c["firing"] == "storage"]
        return cs if any(c["storage_day"] == day.isoformat() and c["status"] == "settled" for c in cs) else None

    cs = poll(storage, STORAGE_WAIT_S, "the first storage day to settle")
    days = [c["storage_day"] for c in cs]
    assert len(days) == len(set(days)) <= 10 and min(days) == day.isoformat()
    c = next(x for x in cs if x["storage_day"] == day.isoformat())
    assert c["fee_cents"] == STORAGE_FEE and c["rate_cents"] == STORAGE_FEE and c["cubic_inches"] is None and c["funding"] == "credit"
    assert instant(c["created_at"]) >= day_start(day, TZ["andes"])
    txns = kb_txns(killbill, diego.id, f"kd-storage-{planter['id']}-{day.isoformat()}")
    assert len(txns) == 1 and cents(txns[0]) == STORAGE_FEE
    cr = credit(diego)
    check_ledger(cr["entries"], cr["balance_cents"])
    assert charge_entries(cr["entries"], c["id"]) == [("firing_revenue", STORAGE_FEE, "storage_fee"), ("member_credit", -STORAGE_FEE, "storage_fee")]


def test_wf_piece_passport_collect(browser, mail):
    base = os.environ["APP_SHORT_URL"]
    window = j(sign_in(base, "ember-lane", OWNER["ember-lane"]).get("/api/studio"))["pickup_window_days"]
    m, tech, (p,), res = glaze_ready(base, mail, [MUG])
    deadline = local_date(res["load"]["unloaded_at"], TZ["ember-lane"]) + dt.timedelta(days=window)
    assert passport(m, p["id"])["pickup_deadline"] == deadline.isoformat()
    with signed_in(browser, base, "ember-lane", m.email, NEW_PASSWORD, path=f"/pieces/{p['id']}") as member, \
            signed_in(browser, base, "ember-lane", TECH["ember-lane"], path="/intake") as t:
        reads(member, member.locator("body"), "Ready for pickup")
        reads(member, member.locator("body"), re.compile(re.escape(f"COLLECT BY {screen_date(deadline)}"), re.I))
        click(shows(t, "button", f"Mark collected {p['title']}"))
        says(t, "Intake status", f"{p['title']} collected.")
        reads(member, member.locator("body"), "Collected", LIVE_S)
    assert passport(m, p["id"])["status"] == "collected"


def test_wf_pickup_not_due(browser, mail):
    base = os.environ["APP_SHORT_URL"]
    m, tech, (p,), res = glaze_ready(base, mail, [MUG])
    state = passport(m, p["id"])
    assert state["status"] == "ready_for_pickup" and state["pickup_deadline"]
    deadline = dt.date.fromisoformat(state["pickup_deadline"])
    assert deadline > local_date(res["load"]["unloaded_at"], TZ["ember-lane"])
    with signed_in(browser, base, "ember-lane", OWNER["ember-lane"], path="/intake") as o:
        click(shows(o, "button", f"Mark uncollected {p['title']}"))
        says(o, "Intake status", f"{p['title']} can still be collected until the end of {screen_date(deadline)}.")
    after = passport(m, p["id"])
    assert after["status"] == "ready_for_pickup" and after["pickup_deadline"] == deadline.isoformat()


def test_wf_pickup_storage_label(browser, mail):
    base = os.environ["APP_PICKUP_DUE_URL"]
    diego = sign_in(base, "andes", DIEGO)
    planter = next(p for p in j(diego.get("/api/pieces")) if p["title"] == "Terrace Planter")
    poll(lambda: [c for c in passport(diego, planter["id"])["charges"] if c["firing"] == "storage"], STORAGE_WAIT_S, "a storage charge")
    with signed_in(browser, base, "andes", DIEGO, path=f"/pieces/{planter['id']}") as p:
        table = shows(p, "table", "Charges")
        reads(p, table, f"Storage, {screen_date(dt.date(2026, 11, 14))}")
        reads(p, table, re.compile("Paid from credit|Pending billing"))


def test_live_updates_bound_and_scope(browser, app_url, mail):
    tech = sign_in(app_url, "ember-lane", TECH["ember-lane"])
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    ftech = sign_in(app_url, "saltmarsh", TECH["saltmarsh"])
    a, b, f = new_member(app_url, mail), new_member(app_url, mail), new_member(app_url, mail, "saltmarsh")
    pa, pb, pf = log_piece(a, MUG), log_piece(b, MUG), log_piece(f, MUG)
    events: list[str] = []
    listener = httpx.Client(base_url=app_url, cookies=b.http.cookies, timeout=httpx.Timeout(TIMEOUT))

    def listen() -> None:
        try:
            with listener.stream("GET", "/api/events") as r:
                if "text/event-stream" not in r.headers.get("content-type", ""):
                    return
                events.append("open")
                for line in r.iter_lines():
                    if line.startswith("data:"):
                        events.append(line[5:].strip())
        except Exception:
            return

    thread = threading.Thread(target=listen, daemon=True)
    thread.start()
    poll(lambda: "open" in events or not thread.is_alive(), UI_S, "the event stream to open or be refused")
    j(tech.post(f"/api/pieces/{pa['id']}/check-in"))
    j(ftech.post(f"/api/pieces/{pf['id']}/check-in"))
    j(tech.post(f"/api/pieces/{pb['id']}/check-in"))
    if "open" in events:
        poll(lambda: any(pb["id"] in e for e in events), LIVE_S, "the member's own piece event")
        assert not any(pa["id"] in e or pf["id"] in e for e in events)
    listener.close()
    x = log_piece(a, MUG)
    with signed_in(browser, app_url, "ember-lane", THEO, path="/intake") as p, \
            signed_in(browser, app_url, "ember-lane", a.email, NEW_PASSWORD, path="/credit") as c:
        row = shows(p, "button", f"Check in {x['title']}", exact=True)
        j(tech.post(f"/api/pieces/{x['id']}/check-in"))
        gone(p, row, LIVE_S)
        j(owner.post(f"/api/members/{a.id}/adjustments", {"amount_cents": 300, "reason": "Live"}), 201)
        reads(c, c.get_by_role("region", name="Credit balance"), "BALANCE $3.00", LIVE_S)


def test_wf_join_and_log_happy(browser, app_url, mail):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    email, tag = fresh_email(), uuid.uuid4().hex[:8]
    j(owner.post("/api/invites", {"email": email, "role": "member", "membership": "member"}), 201)
    link = invite_links(mail, "ember-lane", email)[0]
    title = f"Teapot {tag}"
    with open_app(browser, link) as p:
        shows(p, "textbox", "Your name")
        reads(p, p.locator("body"), email)
        fill(p.get_by_role("textbox", name="Your name"), f"Joiner {tag}")
        fill(p.get_by_role("textbox", name="Studio handle"), f"j-{tag}")
        fill(p.get_by_label("Choose a password"), NEW_PASSWORD)
        click(p.get_by_role("button", name="Join studio"))
        ui(p, lambda: expect(p).to_have_url(re.compile(r"/pieces/?$"), timeout=QUICK_MS))
        click(p.get_by_role("navigation", name="Main").get_by_role("link", name="Log a piece"))
        fill(shows(p, "textbox", "Title"), title)
        select(p.get_by_role("combobox", name="Clay body"), "Buff Stoneware")
        for name, v in zip(("Length (in)", "Width (in)", "Height (in)"), ("5.2", "4.1", "7.0")):
            fill(p.get_by_role("spinbutton", name=name), v)
        quote = p.get_by_role("region", name="Quote")
        for copy in ("173.25 CU IN", "BISQUE $5.20", "GLAZE $10.40"):
            reads(p, quote, copy)
        p.get_by_label("Intake photo").set_input_files({"name": "pot.png", "mimeType": "image/png", "buffer": png()})
        click(p.get_by_role("button", name="Log piece"))
        shows(p, "heading", title, level=1)
        shows(p, "img", f"Intake photo of {title}")
        go(p, app_url, "/pieces")
        shows(p, "link", title, root=p.get_by_role("list", name="My pieces"))
    me = sign_in(app_url, "ember-lane", email, NEW_PASSWORD)
    piece = next(x for x in j(me.get("/api/pieces")) if x["title"] == title)
    assert piece["status"] == "logged" and piece["photo_url"] and piece["quote"]["bisque"]["fee_cents"] == 520
    assert len([k for k in S3().keys("studios/") if f"/pieces/{piece['id']}/" in k]) == 1


def test_wf_join_and_log_invalid(browser, app_url, mail):
    owner = sign_in(app_url, "ember-lane", OWNER["ember-lane"])
    email, tag = fresh_email(), uuid.uuid4().hex[:8]
    j(owner.post("/api/invites", {"email": email, "role": "member", "membership": "member"}), 201)
    link = invite_links(mail, "ember-lane", email)[0]
    with open_app(browser, f"{app_url}/invite/{uuid.uuid4()}") as p:
        says(p, "Join status", "This invite link is not valid.")
    with open_app(browser, link) as p:
        fill(shows(p, "textbox", "Your name"), f"Joiner {tag}")
        handle = p.get_by_role("textbox", name="Studio handle")
        fill(handle, "AB")
        fill(p.get_by_label("Choose a password"), NEW_PASSWORD)
        click(p.get_by_role("button", name="Join studio"))
        says(p, "Join status", "Fix the highlighted fields.")
        ui(p, lambda: expect(handle).to_have_accessible_description("Use 3 to 24 lowercase letters, digits or hyphens.", timeout=QUICK_MS))
        fill(handle, f"j-{tag}")
        click(p.get_by_role("button", name="Join studio"))
        ui(p, lambda: expect(p).to_have_url(re.compile(r"/pieces/?$"), timeout=QUICK_MS))
        go(p, app_url, "/pieces/new")
        fill(p.get_by_role("spinbutton", name="Length (in)"), "30")
        fill(p.get_by_role("spinbutton", name="Width (in)"), "4")
        fill(p.get_by_role("spinbutton", name="Height (in)"), "4")
        reads(p, p.get_by_role("region", name="Quote"), "Quote unavailable — check the dimensions.")
    assert j(sign_in(app_url, "ember-lane", email, NEW_PASSWORD).get("/api/pieces")) == []


def test_wf_cross_cutting_signin(browser, app_url):
    with open_app(browser, f"{app_url}/pieces") as p:
        button = shows(p, "button", "Sign in")
        fill(p.get_by_role("textbox", name="Studio"), "ember-lane")
        fill(p.get_by_role("textbox", name="Email"), OWNER["ember-lane"])
        fill(p.get_by_label("Password", exact=True), "not-the-password")
        with held(p, "**/api/session") as gate:
            click(button)
            says(p, "Sign-in status", "Signing in…")
            expect(button).to_be_disabled()
            gate.release()
        says(p, "Sign-in status", "Studio, email or password is wrong.")
        fill(p.get_by_label("Password", exact=True), PASSWORD)
        click(button)
        shows(p, "region", "Backlog")
        nav = p.get_by_role("navigation", name="Main")
        for link in ("Dashboard", "Planner", "Intake", "Rates", "Members", "Reports", "Settings"):
            shows(p, "link", link, root=nav)
        assert p.url.rstrip("/").endswith("/dashboard")


def test_wf_cross_cutting_session_end(browser, app_url, mail):
    m = new_member(app_url, mail)
    with signed_in(browser, app_url, "ember-lane", m.email, NEW_PASSWORD) as p:
        q = p.context.new_page()
        go(q, app_url, "/credit")
        cookie = next(c["value"] for c in p.context.cookies() if c["name"] == "kd_session")
        with p.expect_response(lambda r: r.url.endswith("/api/session") and r.request.method == "DELETE"):
            click(p.get_by_role("button", name="Sign out"))
        says(q, "Session status", "Your session ended. Sign in again.", LIVE_S)
        shows(q, "button", "Sign in")
        p.go_back()
        shows(p, "button", "Sign in")
    stale = Api(app_url)
    stale.http.cookies.set("kd_session", cookie)
    err(stale.get("/api/me"), 401, "unauthenticated")


def shipped() -> dict[str, dict]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=APP, capture_output=True, text=True, timeout=NPM_TIMEOUT)
    found: dict[str, dict] = {}

    def walk(node: dict) -> None:
        for name, dep in (node.get("dependencies") or {}).items():
            if dep.get("version") and name not in found:
                found[name] = dep
                walk(dep)

    walk(json.loads(out.stdout or "{}"))
    return found


def licence_of(dep: dict) -> str:
    lic = dep.get("license")
    if not lic and dep.get("path"):
        lic = json.loads((Path(dep["path"]) / "package.json").read_text()).get("license")
    return (lic.get("type") if isinstance(lic, dict) else lic) or ""


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in shipped() if name not in notices]
    assert not missing, missing
    for font in ("Barlow Condensed", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices


def test_if_licences():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
    bad = {n: licence_of(d) for n, d in shipped().items() if not any(part.strip("() ") in allowed for part in re.split(r"\s+OR\s+", licence_of(d)))}
    assert not bad, bad
    assert "OFL-1.1" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_state_only_postgres_minio():
    banned = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "lowdb", "nedb", "level", "mongodb", "mongoose", "lokijs"}
    assert not banned & set(shipped())
    stray = [str(f) for f in APP.rglob("*") if f.suffix in {".sqlite", ".sqlite3", ".db"} and "node_modules" not in f.parts]
    assert not stray, stray


def test_if_service_definitions_unchanged(killbill):
    assert Postgres().rows("select 1 as one") == [{"one": 1}]
    assert any(k.endswith(".png") for k in S3().keys("studios/"))
    assert killbill.account_by_key(f"kd-{uuid.uuid4()}") is None


def test_if_typescript_only():
    js = [str(f) for f in (APP / "src").rglob("*") if f.suffix in {".js", ".jsx", ".mjs", ".cjs"}]
    assert not js, js
    scripts = json.loads((APP / "package.json").read_text()).get("scripts", {})
    commands = list(json.loads((APP / "run.json").read_text()).values()) + list(scripts.values())
    hand = [c for c in commands if isinstance(c, str) and re.search(r"\bnode\s+(?!dist/|build/|\.?/?dist/|\.?/?build/)[\w./-]+\.(?:m|c)?js\b", c)]
    assert not hand, hand


def test_if_same_origin_assets(browser, app_url):
    with signed_in(browser, app_url, "ember-lane", TECH["ember-lane"]) as p:
        seen: list[str] = []
        p.on("request", lambda r: seen.append(r.url))
        p.reload()
        go(p, app_url, "/planner")
        foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
        assert seen and not foreign, foreign
