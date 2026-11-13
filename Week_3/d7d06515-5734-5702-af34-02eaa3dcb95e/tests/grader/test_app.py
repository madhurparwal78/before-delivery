from __future__ import annotations

import contextlib
import json
import math
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from datetime import time as dtime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    held,
    layout,
    licence_allowed,
    open_app,
    pdf_text,
    same_origin,
    select,
    settle,
    shipped_packages,
    state_styles,
    tap,
    unique,
)
from conftest import session as cdp_session
from conftest import text as mail_text

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
LIVE_S = 2
RESULT_S = 1
RECOVER_S = 10
TRIAL_DAYS = 30
PRESENCE_IDLE_S = 120
INVITE_COOLDOWN_S = 60
UPLOAD_MAX = 5000000
JSON_MAX = 1000000
MAX_FAILURES = 5
DRAW_IN_MS = 900
GRIP_POP_MS = 160
GRIP_HOLD_MS = 1200
HERO_PATH_MS = 900
HERO_STAGGER_MS = 40
HEADER_IN_MS = 200
HEADER_OUT_MS = 150
MOUSE_APERTURE = 10
TOUCH_APERTURE = 24
MARKER_PX = 12
PICK_PX = 5
PICK_MM = 10
A3_W_MM = 420
A3_H_MM = 297
TOUCH_MIN_PX = 44
ARC_SIDE_MM = 150
LIVE_SLACK_S = 3
UI_WAIT_S = 20
API_WAIT_S = 60
MAIL_WAIT_S = 30
HTTP_TIMEOUT_S = 60
BOOT_WAIT_S = 120
RETRY_SLACK_S = 8
TIMING_TOL = 0.25
INSTANT_MS = 50
SHORT_VERIFY_S = 20
SHORT_LOCK_S = 20
SKEW = datetime(2031, 6, 1, tzinfo=timezone.utc)
UNKNOWN_TOKEN = "AAAAnotarealconfirmationtokenAAAA"
PASSWORD = "correct-horse-staple-41"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}

STUDIO_LINES = {
    "1A": ((0, 0), (6000, 0)),
    "1B": ((6000, 0), (6000, 4200)),
    "1C": ((6000, 4200), (0, 4200)),
    "1D": ((0, 4200), (0, 0)),
    "3A": ((0, 2400), (2400, 2400)),
    "2A": ((3000, -600), (3000, 4800)),
}
STUDIO_LAYERS = {
    "0": ("White", "Continuous", True, False, False),
    "A-WALL": ("Yellow", "Continuous", True, False, False),
    "A-DOOR": ("Cyan", "Continuous", True, False, False),
    "A-ANNO": ("Green", "Continuous", True, False, False),
    "S-GRID": ("Red", "Center", True, False, True),
    "A-FURN": ("Magenta", "Dashed", True, True, False),
}
ACI = {"Red": 1, "Yellow": 2, "Green": 3, "Cyan": 4, "Blue": 5, "Magenta": 6, "White": 7}

BLOCK_VERTEX = {
    "Door 900": (0, 900),
    "Window 1200": (1200, 50),
    "Chair 450": (225, 225),
    "Table 1600x800": (800, 400),
    "North arrow": (-150, -600),
}

FIRST_PROMPT = {
    "LINE": "Specify first point:",
    "PLINE": "Specify start point:",
    "CIRCLE": "Specify center point:",
    "ARC": "Specify center point:",
    "RECTANG": "Specify first corner point:",
    "POLYGON": "Enter number of sides:",
    "SPLINE": "Specify first point:",
    "MOVE": "Select objects:",
    "COPY": "Select objects:",
    "ROTATE": "Select objects:",
    "SCALE": "Select objects:",
    "MIRROR": "Select objects:",
    "ERASE": "Select objects:",
    "OFFSET": "Specify offset distance:",
    "TRIM": "Select object to trim:",
    "EXTEND": "Select object to extend:",
    "FILLET": "Specify fillet radius:",
    "DIMLINEAR": "Specify first extension line origin:",
    "DIMALIGNED": "Specify first extension line origin:",
    "DIMRADIUS": "Select arc or circle:",
    "DIMANGULAR": "Select first line:",
    "MTEXT": "Specify first corner:",
    "DIST": "Specify first point:",
    "ZOOM": "Enter E for extents, or press + or -:",
}
ALIASES = {
    "L": "LINE", "PL": "PLINE", "C": "CIRCLE", "A": "ARC", "REC": "RECTANG", "POL": "POLYGON",
    "SPL": "SPLINE", "M": "MOVE", "CO": "COPY", "RO": "ROTATE", "SC": "SCALE", "MI": "MIRROR",
    "O": "OFFSET", "TR": "TRIM", "F": "FILLET", "E": "ERASE", "DLI": "DIMLINEAR", "DAL": "DIMALIGNED",
    "DRA": "DIMRADIUS", "DAN": "DIMANGULAR", "MT": "MTEXT", "T": "MTEXT", "DI": "DIST", "Z": "ZOOM",
    "EX": "EXTEND",
}
RIBBON = {
    "Draw": {"Line": "LINE", "Polyline": "PLINE", "Circle": "CIRCLE", "Arc": "ARC", "Rectangle": "RECTANG",
             "Polygon": "POLYGON", "Spline": "SPLINE"},
    "Annotate": {"Text": "MTEXT", "Linear": "DIMLINEAR", "Aligned": "DIMALIGNED", "Radius": "DIMRADIUS",
                 "Angular": "DIMANGULAR"},
    "Modify": {"Move": "MOVE", "Copy": "COPY", "Rotate": "ROTATE", "Mirror": "MIRROR", "Scale": "SCALE",
               "Trim": "TRIM", "Extend": "EXTEND", "Fillet": "FILLET", "Offset": "OFFSET", "Erase": "ERASE"},
}
FOLDER_NAME_ERROR = 'Folder names can\'t contain / \\ : * ? " < > | (1 to 80 characters).'
LAYER_NAME_ERROR = "Layer names can use letters, digits, spaces, - _ and $ (1 to 64 characters)."
OUTAGE_KINDS = ["valkey", "minio", "mailpit"]
MOTION_MODES = ["no-preference", "reduce"]
DRAFTER_NAME = "Ines Halloran"
DRAWING_STEM = "Plan A"
DOOR_BLOCK = "Door 900"
CHAIR_BLOCK = "Chair 450"
MEASURE_MARK = "<>"
NEXT_REVISION = "B"
QUOTE_DAY = datetime(2027, 2, 2)
LINK_DAY = datetime(2027, 1, 10)
FROZEN_NOTE = "FROZENNOTE"
REVIEW_NOTES = ("Door swing clashes", "Check grid line")
PHONE_NOTE = "Fix door swing"
PERMIT_NOTE = "Issued for permit."
TENDER_NOTE = "Issued for tender."
FOLDER_A = "Atlas"
FOLDER_K = "Kiln"
FILE_B = "Beacon.dxf"
FILE_M = "Mason.dxf"
PLAN_FILE = f"{DRAWING_STEM}.dxf"
TRACE_QUICK = "Quick"


def grip_name(handle: str) -> str:
    return f"Grip {handle}"


def changed_name(handle: str) -> str:
    return f"Changed {handle}"


def insert_name(block: str) -> str:
    return f"Insert {block}"


def cell_name(kind: str, layer_name: str) -> str:
    return f"{kind} {layer_name}"


def default_layer(n: int) -> str:
    return f"Layer{n}"


def paper_layout(n: int) -> str:
    return f"Layout{n}"


def sheet_file(stem: str, layout_name: str, n: int, ext: str) -> str:
    return f"{stem}-{layout_name}-{n}.{ext}"


def quote_no(day: datetime, seq: int) -> str:
    return f"Q-{day:%Y%m%d}-{seq:04d}"


def date_time_label(d: datetime) -> str:
    return f"{d:%b} {d.day}, {d.year}, {d.hour % 12 or 12}:{d:%M} {d:%p}"


def origin_of(url: str) -> str:
    u = urlparse(url)
    return f"{u.scheme}://{u.netloc}"


def outage(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} names the outage instance this test needs"
    return url.rstrip("/")


class Api:

    def __init__(self, base: str, session: str | None = None, link: str | None = None, origin: str | None = None):
        self.base = base.rstrip("/")
        self.headers = {"Origin": origin or origin_of(self.base)}
        if session:
            self.headers["Cookie"] = f"corbel_session={session}"
        if link:
            self.headers["Authorization"] = f"Link {link}"
        self.http = httpx.Client(timeout=HTTP_TIMEOUT_S)

    def get(self, path: str) -> httpx.Response:
        return self.http.get(self.base + path, headers=self.headers)

    def post(self, path: str, body: Any = None) -> httpx.Response:
        return self.http.post(self.base + path, headers=self.headers, json={} if body is None else body)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.http.put(self.base + path, headers=self.headers, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(self.base + path, headers=self.headers)

    def raw(self, path: str, content: bytes, ctype: str) -> httpx.Response:
        return self.http.post(self.base + path, headers={**self.headers, "Content-Type": ctype}, content=content)

    def upload(self, folder: str, name: str, data: bytes, ctype: str = "application/dxf") -> httpx.Response:
        return self.http.post(f"{self.base}/api/folders/{folder}/uploads", headers=self.headers,
                              files={"file": (name, data, ctype)})


def tag() -> str:
    return uuid.uuid4().hex[:8]


def email_for(prefix: str) -> str:
    a, b = unique(prefix)
    if "@" in a:
        return a
    if "@" in b:
        return b
    return f"{prefix}-{tag()}@corbel-verifier.test"


def workspace(base: str, preset: str = "studio-plan", time_zone: str | None = None, units: str | None = None):
    body: dict[str, Any] = {"preset": preset}
    if time_zone:
        body["time_zone"] = time_zone
    if units:
        body["units"] = units
    r = Api(base).post("/api/grading/workspaces", body)
    assert r.status_code == 201, f"POST /api/grading/workspaces answers 201: {r.status_code} {r.text}"
    data = r.json()
    session = data["session"]["value"]
    return SimpleNamespace(base=base.rstrip("/"), id=data["workspace_id"], drafter=data["drafter"],
                           reviewer=data["reviewer"], session=session, did=data["drawing"]["id"],
                           drawing=data["drawing"], api=Api(base, session=session), data=data)


def read(api: Api, did: str) -> dict:
    r = api.get(f"/api/drawings/{did}")
    assert r.status_code == 200, f"GET /api/drawings/{did}: {r.status_code} {r.text}"
    return r.json()


def run(api: Api, did: str, command: str, args: dict | None = None, base_version: int | None = None) -> httpx.Response:
    if base_version is None:
        base_version = read(api, did)["version"]
    return api.post(f"/api/drawings/{did}/commands",
                    {"base_version": base_version, "command": command, "args": args or {}})


def ok(api: Api, did: str, command: str, args: dict | None = None) -> dict:
    r = run(api, did, command, args)
    assert r.status_code == 200, f"{command} answers 200: {r.status_code} {r.text}"
    return r.json()


def obj(d: dict, handle: str) -> dict | None:
    return next((o for o in d["objects"] if o["handle"] == handle), None)


def layer(d: dict, name: str) -> dict:
    found = next((l for l in d["layers"] if l["name"] == name), None)
    assert found, f"layer {name} is listed"
    return found


def near(p, q, tol: float = 1e-6) -> bool:
    return abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol


def contains_point(points, q, tol: float = 1e-3) -> bool:
    return any(near(p, q, tol) for p in points)


def parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def set_clock(ws, when: datetime) -> None:
    r = Api(ws.base).put(f"/api/grading/workspaces/{ws.id}/clock", {"now": when.isoformat()})
    assert r.status_code == 200, f"PUT clock answers 200: {r.status_code} {r.text}"


def server_now(ws) -> datetime:
    return parse_time(ws.api.get("/api/me").json()["now"])


def share(ws, access: str, email: str | None = None, name: str | None = None, expiry: str | None = None) -> dict:
    body: dict[str, Any] = {"access": access, "recipient_email": email or email_for("recipient"), "expiry_date": expiry}
    if name:
        body["recipient_name"] = name
    r = ws.api.post(f"/api/drawings/{ws.did}/shares", body)
    assert r.status_code == 201, f"POST shares answers 201: {r.status_code} {r.text}"
    return r.json()["share"]


def holder(ws, access: str, name: str | None = None, email: str | None = None):
    s = share(ws, access, email=email, name=name or ws.reviewer["name"])
    return s, Api(ws.base, link=s["token"])


def root_folder(ws) -> str:
    return read(ws.api, ws.did)["folder_id"]


def listing(api: Api, folder: str, query: str = "") -> list[dict]:
    r = api.get(f"/api/folders/{folder}{query}")
    assert r.status_code == 200, f"GET folder listing: {r.status_code} {r.text}"
    return r.json()["items"]


def activity(api: Api, did: str) -> list[dict]:
    r = api.get(f"/api/drawings/{did}/activity")
    assert r.status_code == 200, r.text
    return r.json()["entries"]


def poll(fetch: Callable[[], Any], done: Callable[[Any], bool], what: str, seconds: float = API_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fetch()
        if done(last):
            return last
    pytest.fail(f"{what}; last seen {last!r}"[:3000])


def elapse_until(base: str, moment: float) -> None:
    while time.monotonic() < moment:
        httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)


def fmt(value: float, places: int) -> str:
    q = Decimal(repr(float(value))).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    text = f"{q:f}"
    return text[1:] if text.startswith("-") and float(q) == 0 else text


def export(api: Api, did: str, fmt_name: str, layout_name: str = "Model") -> dict:
    r = api.post(f"/api/drawings/{did}/exports", {"format": fmt_name, "layout": layout_name})
    assert r.status_code == 202, f"POST exports answers 202: {r.status_code} {r.text}"
    first = r.json()["export"]
    assert first["state"] == "rendering"
    return poll(lambda: api.get(f"/api/exports/{first['id']}").json()["export"],
                lambda e: e["state"] in ("stored", "failed"), "export leaves rendering")


def download(api: Api, ex: dict) -> bytes:
    r = api.get(f"/api/exports/{ex['id']}/download")
    assert r.status_code == 200, f"export download answers 200: {r.status_code}"
    assert "attachment" in r.headers.get("content-disposition", "")
    return r.content


def dxf_file(length: int = 1000, size: int | None = None) -> bytes:
    head = "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n"
    body = ("0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\nA-WALL\n70\n0\n62\n2\n6\nContinuous\n"
            "0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n"
            f"0\nLINE\n8\nA-WALL\n10\n0\n20\n0\n11\n{length}\n21\n0\n"
            "0\nCIRCLE\n8\nA-WALL\n10\n500\n20\n500\n40\n250\n"
            "0\nPOINT\n8\nA-WALL\n10\n5\n20\n5\n"
            "0\nENDSEC\n0\nEOF\n")
    data = head + body
    if size is not None:
        pad = size - len(data) - len("999\n") - 1
        data = head + "999\n" + "x" * pad + "\n" + body
        assert len(data) == size
    return data.encode("ascii")


def dxf_pairs(data: bytes) -> list[tuple[str, str]]:
    lines = data.decode("ascii").splitlines()
    return [(lines[i].strip(), lines[i + 1].strip()) for i in range(0, len(lines) - 1, 2)]


def dxf_records(pairs, section: str) -> list[dict]:
    out: list[dict] = []
    inside = False
    current = None
    for i, (code, value) in enumerate(pairs):
        if code == "0" and value == "SECTION":
            inside = i + 1 < len(pairs) and pairs[i + 1] == ("2", section)
            current = None
            continue
        if not inside:
            continue
        if code == "0":
            if value == "ENDSEC":
                inside = False
                current = None
                continue
            current = {"type": value, "groups": []}
            out.append(current)
        elif current is not None:
            current["groups"].append((code, value))
    return out


def groups(record: dict, code: str) -> list[str]:
    return [v for c, v in record["groups"] if c == code]


def header_value(pairs, name: str) -> str | None:
    for i, pair in enumerate(pairs):
        if pair == ("9", name) and i + 1 < len(pairs):
            return pairs[i + 1][1]
    return None


def pdf_content(data: bytes) -> str:
    chunks = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        raw = m.group(1)
        try:
            chunks.append(zlib.decompress(raw))
        except zlib.error:
            chunks.append(raw)
    return b"\n".join(chunks).decode("latin-1")


def pdf_page_size(data: bytes) -> tuple[float, float]:
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(data)
        f.flush()
        run = subprocess.run(["pdfinfo", f.name], capture_output=True, timeout=60)
    assert run.returncode == 0, f"pdfinfo exit {run.returncode}: {run.stderr[-300:]!r}"
    info = run.stdout.decode("utf-8", "replace")
    size = re.search(r"Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts", info)
    assert size, "the PDF declares its page box"
    w, h = float(size.group(1)), float(size.group(2))
    rot = re.search(r"Page rot:\s+(\d+)", info)
    return (h, w) if rot and int(rot.group(1)) % 180 == 90 else (w, h)


def pdf_image_count(data: bytes) -> int:
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(data)
        f.flush()
        run = subprocess.run(["pdfimages", "-list", f.name], capture_output=True, timeout=60)
    assert run.returncode == 0, f"pdfimages exit {run.returncode}: {run.stderr[-300:]!r}"
    rows = run.stdout.decode("utf-8", "replace").splitlines()[2:]
    return len([r for r in rows if r.strip()])


def stroke_colours(data: bytes) -> list[tuple[float, float, float]]:
    content = pdf_content(data)
    rgb = [(float(a), float(b), float(c)) for a, b, c, _ in
           re.findall(r"(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(RG|SC|SCN)\b", content)]
    grey = [(float(g), float(g), float(g)) for g in re.findall(r"(-?\d*\.?\d+)\s+G\b", content)]
    return rgb + grey


def words(text: str) -> str:
    return " ".join(text.split())


def mail_id(m: dict) -> str:
    return str(m.get("ID") or m.get("MessageID") or mail_text(m))


def mails_to(mail, address: str, settle_s: float = 0.5) -> list[dict]:
    return [m for m in mail.messages(settle=settle_s)
            if address.lower() in [a.lower() for a in addresses(m.get("To"))]]


def wait_mail(mail, address: str, seen=(), count: int = 1) -> list[dict]:
    deadline = time.monotonic() + MAIL_WAIT_S
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = [m for m in mails_to(mail, address) if mail_id(m) not in seen]
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit holds {len(found)} new message(s) to {address}; expected {count}")


def link_in(message: dict, kind: str) -> str:
    m = re.search(rf"https?://[^\s\"'<>]+?/{kind}/([A-Za-z0-9_\-~%]+)", mail_text(message))
    assert m, f"the email body holds <public URL>/{kind}/<token>"
    return m.group(1)


@contextlib.contextmanager
def tab(browser: Browser, base: str, path: str, *, session: str | None = None, size=DESKTOP,
        reduced: bool = False, skew: datetime | None = None):
    base = base.rstrip("/")
    with open_app(browser, base + "/api/health",
                  reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(size)
        if skew is not None:
            page.clock.set_system_time(skew)
        if session:
            page.context.add_cookies([{"name": "corbel_session", "value": session, "url": base}])
        page.goto(base + path)
        yield page


def eventually(page: Page, check: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> None:
    start = time.monotonic()
    advanced = 0.0
    last: Any = None
    while time.monotonic() - start < seconds:
        try:
            if check():
                return
        except Exception as error:
            last = error
        step = max((time.monotonic() - start) * 1000 - advanced, 50)
        advance(page, step)
        advanced += step
    pytest.fail(f"{what} (last error: {last!r})")


def text_of(loc: Locator) -> str:
    if loc.count() == 0 or not loc.first.is_visible():
        return ""
    return loc.first.inner_text(timeout=2000)


def visible(loc: Locator) -> bool:
    return loc.count() > 0 and any(loc.nth(i).is_visible() for i in range(loc.count()))


def shows(page: Page, loc: Locator, expected: str | re.Pattern | None = None, seconds: float = UI_WAIT_S) -> None:
    def check() -> bool:
        if expected is None:
            return visible(loc)
        t = text_of(loc)
        return bool(expected.search(t)) if isinstance(expected, re.Pattern) else expected in t
    eventually(page, check, f"{loc} shows {expected!r}", seconds)


def gone(page: Page, loc: Locator, what: str, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: not visible(loc), what, seconds)


def cmdbox(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Command")


def history(page: Page) -> Locator:
    return page.get_by_role("log", name="Command history")


def prompt(page: Page) -> Locator:
    return page.get_by_role("status", name="Command prompt")


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements")


def sync(page: Page) -> Locator:
    return page.get_by_role("status", name="Sync")


def prompt_is(page: Page, expected: str, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: text_of(prompt(page)).strip() == expected,
               f'status "Command prompt" reads {expected!r}', seconds)


def editor_ready(page: Page) -> None:
    shows(page, sync(page), re.compile(r"Synced · v\d+|Live sync paused"))
    shows(page, cmdbox(page))


def submit(page: Page, line: str, wait_write: tuple[Api, str] | None = None) -> None:
    before_version = read(*wait_write)["version"] if wait_write else None
    before = text_of(history(page)) + "|" + text_of(prompt(page))
    if line:
        page.keyboard.type(line)
    page.keyboard.press("Enter")
    start = time.monotonic()
    while time.monotonic() - start < RESULT_S + 0.5:
        if text_of(history(page)) + "|" + text_of(prompt(page)) != before:
            break
        advance(page, 50)
    if wait_write:
        latest = poll(lambda: read(*wait_write)["version"], lambda v: v > before_version,
                      f"the command line entry {line!r} saved a new drawing version", UI_WAIT_S)
        shows(page, sync(page), re.compile(rf"v{latest}\b|Live sync paused"))


def extents(d: dict) -> tuple[float, float, float, float]:
    shown = {l["name"] for l in d["layers"] if l["on"] and not l["frozen"]}
    xs: list[float] = []
    ys: list[float] = []
    for o in d["objects"]:
        if o["layer"] not in shown:
            continue
        if o["type"] == "line":
            pts = [o["start"], o["end"]]
        elif o["type"] == "circle":
            c, r = o["center"], o["radius"]
            pts = [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]]
        elif o["type"] == "polyline":
            pts = o["vertices"]
        else:
            pts = o["snaps"]["endpoint"] + o["snaps"]["center"]
        for p in pts:
            xs.append(p[0])
            ys.append(p[1])
    if not xs:
        return 0, 0, 10000, 7000
    return min(xs), min(ys), max(xs), max(ys)


class View:

    def __init__(self, page: Page, d: dict):
        box = page.get_by_role("application", name="Drawing canvas").bounding_box()
        assert box, 'application "Drawing canvas" is laid out'
        x0, y0, x1, y1 = extents(d)
        self.scale = min(0.8 * box["width"] / (x1 - x0), 0.8 * box["height"] / (y1 - y0))
        self.cx, self.cy = (x0 + x1) / 2, (y0 + y1) / 2
        self.box = box

    def at(self, x: float, y: float) -> tuple[float, float]:
        b = self.box
        return (b["x"] + b["width"] / 2 + (x - self.cx) * self.scale,
                b["y"] + b["height"] / 2 - (y - self.cy) * self.scale)

    def tol(self, px: float = 3) -> float:
        return px / self.scale


def touch_session(page: Page):
    cdp = cdp_session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    return cdp


def touch(cdp, x: float, y: float) -> None:
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def focused_inside(loc: Locator) -> bool:
    return bool(loc.evaluate("el => el.contains(document.activeElement)"))


def editor_panel(page: Page, name: str) -> None:
    page.get_by_role("tablist", name="Editor panels").get_by_role("tab", name=name).click()


def layer_row(page: Page, name: str) -> Locator:
    grid = page.get_by_role("grid", name="Layers")
    return grid.get_by_role("row").filter(has=page.get_by_role("checkbox", name=f"Lock {name}", exact=True))


def activate_in_place(button: Locator) -> None:
    button.evaluate("b => b.click()")


MOTION_JS = """
(() => {
  if (window.__motion) return;
  window.__motion = []; window.__motionEls = [];
  const labelOf = (el) => { for (let n = el; n; n = n.parentElement) { const l = n.getAttribute && n.getAttribute('aria-label'); if (l) return l; } return ''; };
  const rec = (el, anim, ev) => { try { const t = anim.effect.getComputedTiming();
      window.__motion.push({tag: (el.tagName || '').toLowerCase(), label: labelOf(el), dur: Number(t.duration) || 0,
        delay: Number(t.delay) || 0, iterations: t.iterations, at: performance.now() - (ev ? (Number(t.delay) || 0) : 0)});
      window.__motionEls.push(el); } catch (e) {} };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); rec(this, a); return a; };
  for (const type of ['animationstart', 'transitionrun']) {
    document.addEventListener(type, (ev) => { for (const a of ev.target.getAnimations()) rec(ev.target, a, true); }, true);
  }
})();
"""


def motion_records(page: Page, within: Locator | None = None) -> list[dict]:
    if within is None:
        return page.evaluate("() => (window.__motion || []).map(m => ({...m}))")
    return within.evaluate(
        "(root) => (window.__motion || []).map((m, i) => ({...m, inside: root.contains(window.__motionEls[i])}))")


def about(value: float, target: float) -> bool:
    return abs(value - target) <= target * TIMING_TOL


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Relay:

    def __init__(self, host: str, port: int):
        self.target = (host, port)
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.sockets: list[socket.socket] = []

    def start(self) -> None:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen(64)
        self.listener = listener
        threading.Thread(target=self._serve, args=(listener,), daemon=True).start()

    def _serve(self, listener: socket.socket) -> None:
        for _ in range(100000):
            try:
                client, _ = listener.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=10)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            self.sockets += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        for _ in range(10_000_000):
            try:
                data = src.recv(65536)
            except OSError:
                break
            if not data:
                break
            try:
                dst.sendall(data)
            except OSError:
                break
        for s in (src, dst):
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)

    def stop(self) -> None:
        if self.listener is not None:
            with contextlib.suppress(OSError):
                self.listener.shutdown(socket.SHUT_RDWR)
            self.listener.close()
            self.listener = None
        for s in self.sockets:
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
            s.close()


def provider_relay(kind: str) -> tuple[Relay, dict[str, str]]:
    env = os.environ
    if kind == "minio":
        assert env.get("S3_ENDPOINT"), "the verifier environment names S3_ENDPOINT"
        u = urlparse(env["S3_ENDPOINT"])
        relay = Relay(u.hostname or "127.0.0.1", u.port or (443 if u.scheme == "https" else 80))
        return relay, {"S3_ENDPOINT": f"{u.scheme}://127.0.0.1:{relay.port}"}
    if kind == "valkey":
        assert env.get("VALKEY_URL"), "the verifier environment names VALKEY_URL"
        u = urlparse(env["VALKEY_URL"])
        relay = Relay(u.hostname or "127.0.0.1", u.port or 6379)
        auth = u.netloc.rsplit("@", 1)[0] + "@" if "@" in u.netloc else ""
        return relay, {"VALKEY_URL": f"{u.scheme}://{auth}127.0.0.1:{relay.port}{u.path}"}
    assert env.get("SMTP_HOST") and env.get("SMTP_PORT"), "the verifier environment names SMTP_HOST/SMTP_PORT"
    relay = Relay(env["SMTP_HOST"], int(env["SMTP_PORT"]))
    return relay, {"SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(relay.port)}


@contextlib.contextmanager
def app_copy(overrides: dict[str, str]):
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_bytes()[-4000:].decode("utf-8", "replace")

    try:
        deadline = time.monotonic() + BOOT_WAIT_S
        up = False
        while time.monotonic() < deadline and not up:
            if proc.poll() is not None:
                pytest.fail(f"the app copy exited during boot with a provider unreachable:\n{tail()}")
            try:
                up = httpx.get(base + "/api/health", timeout=5).status_code == 200
            except httpx.HTTPError:
                up = False
        if not up:
            pytest.fail(f"the app copy never served /api/health with a provider unreachable:\n{tail()}")
        yield base, tail
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)


def signup_body(email: str, name: str = "Ada Quill") -> dict:
    return {"name": name, "email": email, "password": PASSWORD, "time_zone": "UTC"}


def test_wf_account_trial_signup(browser, app_url, mail):
    email = email_for("signup")
    with tab(browser, app_url, "/drawings") as page:
        eventually(page, lambda: urlparse(page.url).path == "/signin", "signed-out /drawings redirects to /signin")
        page.goto(app_url.rstrip("/") + "/")
        page.get_by_role("link", name="Start drafting").click()
        eventually(page, lambda: urlparse(page.url).path == "/signup", "Start drafting goes to /signup")
        form = page.get_by_role("form", name="Create account")
        form.get_by_role("textbox", name="Name").focus()
        page.keyboard.type("Ada Quill")
        form.get_by_role("textbox", name="Email").focus()
        page.keyboard.type(email)
        form.get_by_role("textbox", name="Password").focus()
        page.keyboard.type(PASSWORD)
        select(form.get_by_role("combobox", name="Studio time zone"), "Europe/Berlin")
        form.get_by_role("button", name="Create account").focus()
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("heading", name="Check your inbox"))
        shows(page, page.get_by_text(f"We sent a confirmation link to {email}."))
        message = wait_mail(mail, email)[0]
        assert message.get("Subject") == "Confirm your Corbel Draft account"
        token = link_in(message, "verify")
        page.goto(f"{app_url.rstrip('/')}/verify/{token}")
        shows(page, page.get_by_text("Your email is confirmed."))
        page.get_by_role("link", name="Sign in").first.click()
        signin = page.get_by_role("form", name="Sign in")
        shows(page, signin)
        signin.get_by_role("textbox", name="Email").fill(email)
        signin.get_by_role("textbox", name="Password").fill(PASSWORD)
        signin.get_by_role("button", name="Sign in").click()
        eventually(page, lambda: urlparse(page.url).path == "/drawings", "sign-in lands on /drawings")
        shows(page, page.get_by_text("No drawings yet. Start one with New Drawing or Upload."))
        shows(page, page.get_by_role("status", name="Trial"), f"{TRIAL_DAYS} days left in your trial")
        shows(page, page.get_by_role("complementary", name="Welcome"), "Welcome back, Ada")
        me = page.request.get(app_url.rstrip("/") + "/api/me").json()
        root = page.request.get(app_url.rstrip("/") + "/api/folders/root").json()
    assert me["user"]["verified"] is True and me["user"]["email"].lower() == email.lower()
    assert me["user"]["time_zone"] == "Europe/Berlin"
    assert me["trial"] == {"days_left": TRIAL_DAYS, "ended": False} or (
        me["trial"]["days_left"] == TRIAL_DAYS and me["trial"]["ended"] is False)
    assert root["items"] == [], "a new account's My Drawings is empty"


def test_wf_account_trial_invalid_signup(browser, app_url, mail):
    taken = workspace(app_url, "blank").drafter["email"]
    email = email_for("signup-fix")
    with tab(browser, app_url, "/signup") as page:
        form = page.get_by_role("form", name="Create account")
        form.get_by_role("button", name="Create account").click()
        shows(page, page.get_by_text("Enter your name (1 to 80 characters)."))
        shows(page, page.get_by_text("Enter a valid email address."))
        shows(page, page.get_by_text("Use at least 10 characters."))
        expect(form.get_by_role("textbox", name="Name")).to_have_accessible_description(
            re.compile(re.escape("Enter your name (1 to 80 characters).")))
        form.get_by_role("textbox", name="Name").fill("Ada Quill")
        form.get_by_role("textbox", name="Email").fill(taken)
        form.get_by_role("textbox", name="Password").fill(PASSWORD)
        form.get_by_role("button", name="Create account").click()
        shows(page, page.get_by_text("An account with this email already exists."))
        form.get_by_role("textbox", name="Email").fill(email)
        with held(page, "**/api/auth/signup") as gate:
            form.get_by_role("button", name="Create account").click()
            shows(page, page.get_by_role("button", name="Creating account…"))
            gate.release()
        shows(page, page.get_by_role("heading", name="Check your inbox"))
    assert wait_mail(mail, email)[0].get("Subject") == "Confirm your Corbel Draft account"
    assert mails_to(mail, taken, settle_s=1.5) == [], "a refused sign-up sends no confirmation email"


@pytest.mark.timeout(300)
def test_verify_link_lifetime(browser, mail):
    base = outage("APP_SHORT_TIMERS_URL")
    api = Api(base)
    first = email_for("verify-a")
    r = api.post("/api/auth/signup", signup_body(first))
    assert r.status_code == 201, r.text
    assert r.json()["user"]["verified"] is False and r.json()["email_status"] == "sent"
    token = link_in(wait_mail(mail, first)[0], "verify")
    r = api.post("/api/auth/verify", {"token": token})
    assert r.status_code == 200 and r.json()["verified"] is True, r.text
    assert api.post("/api/auth/verify", {"token": token}).status_code == 200, "an already verified account answers confirmed"

    second = email_for("verify-b")
    assert api.post("/api/auth/signup", signup_body(second)).status_code == 201
    original = wait_mail(mail, second)
    old = link_in(original[0], "verify")
    r = api.post("/api/auth/verify/resend", {"email": second})
    assert r.status_code == 202 and r.json()["email_status"] == "sent", r.text
    resent_at = time.monotonic()
    newer_mail = wait_mail(mail, second, seen={mail_id(m) for m in original})
    newer = link_in(newer_mail[0], "verify")
    assert newer != old
    r = api.post("/api/auth/verify", {"token": old})
    assert r.status_code == 410 and r.json()["error"] == "verify_link_replaced", r.text
    assert r.json()["email"].lower() == second.lower()
    with tab(browser, base, f"/verify/{old}") as page:
        shows(page, page.get_by_text("This confirmation link was replaced by a newer one."))
        shows(page, page.get_by_role("button", name="Send a new link"))
        page.goto(f"{base}/verify/{UNKNOWN_TOKEN}")
        shows(page, page.get_by_text("This confirmation link is not valid."))

    elapse_until(base, resent_at + SHORT_VERIFY_S + 1)
    r = api.post("/api/auth/verify", {"token": newer})
    assert r.status_code == 410 and r.json()["error"] == "verify_link_expired", r.text
    assert r.json()["email"].lower() == second.lower()
    seen = {mail_id(m) for m in mails_to(mail, second)}
    with tab(browser, base, f"/verify/{newer}") as page:
        shows(page, page.get_by_text("This confirmation link has expired."))
        page.get_by_role("button", name="Send a new link").click()
        shows(page, page.get_by_text(f"A new link is on its way to {second}."))
    fresh = link_in(wait_mail(mail, second, seen=seen)[0], "verify")
    r = api.post("/api/auth/verify", {"token": fresh})
    assert r.status_code == 200 and r.json()["verified"] is True, r.text
    r = api.post("/api/auth/verify/resend", {"email": email_for("nobody")})
    assert r.status_code == 202, "resend answers 202 for an unknown address"


@pytest.mark.timeout(300)
def test_signin_refusals_and_lockout(browser, mail):
    base = outage("APP_SHORT_TIMERS_URL")
    ws = workspace(base, "blank")
    email, password = ws.drafter["email"], ws.drafter["password"]

    def signin(e: str, p: str) -> httpx.Response:
        with httpx.Client(timeout=HTTP_TIMEOUT_S) as http:
            return http.post(base + "/api/auth/signin", json={"email": e, "password": p},
                             headers={"Origin": origin_of(base)})

    r = signin(email_for("ghost"), PASSWORD)
    assert r.status_code == 401 and r.json()["error"] == "invalid_credentials"
    unconfirmed = email_for("unconfirmed")
    assert Api(base).post("/api/auth/signup", signup_body(unconfirmed)).status_code == 201
    r = signin(unconfirmed, PASSWORD)
    assert r.status_code == 403 and r.json()["error"] == "unverified" and r.json()["email"].lower() == unconfirmed.lower()
    assert "corbel_session" not in r.headers.get("set-cookie", "")

    with tab(browser, base, "/signin") as page:
        form = page.get_by_role("form", name="Sign in")
        form.get_by_role("textbox", name="Email").fill(unconfirmed)
        form.get_by_role("textbox", name="Password").fill(PASSWORD)
        form.get_by_role("button", name="Sign in").click()
        shows(page, form.get_by_role("alert"), f"Confirm your email address first. We sent a link to {unconfirmed}.")
        shows(page, form.get_by_role("button", name="Resend link"))
        form.get_by_role("textbox", name="Email").fill(email)
        form.get_by_role("textbox", name="Password").fill(password + "x")
        form.get_by_role("button", name="Sign in").click()
        shows(page, form.get_by_role("alert"), "Email or password is incorrect.")
        for _ in range(MAX_FAILURES - 2):
            r = signin(email, password + "x")
            assert r.status_code == 401 and r.json()["error"] == "invalid_credentials"
        r = signin(email, password + "x")
        assert r.status_code in (401, 429), "the failure that reaches the count is refused"
        locked_at = time.monotonic()
        r = signin(email, password)
        assert r.status_code == 429 and r.json()["error"] == "signin_locked", "the right password is refused while locked"
        assert 0 < r.json()["retry_after_seconds"] <= SHORT_LOCK_S
        form.get_by_role("textbox", name="Password").fill(password)
        form.get_by_role("button", name="Sign in").click()
        shows(page, form.get_by_role("alert"), "Too many attempts. Try again in 1 minute.")
    elapse_until(base, locked_at + SHORT_LOCK_S + 1)
    r = signin(email, password)
    assert r.status_code == 200, f"sign-in works after the lock ends: {r.status_code} {r.text}"
    cookie = r.headers.get("set-cookie", "").lower()
    assert "corbel_session" in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie


def test_trial_countdown_and_end(browser, app_url):
    zone_name = "Asia/Tokyo"
    zone = ZoneInfo(zone_name)
    ws = workspace(app_url, "studio-plan", time_zone=zone_name)
    me = ws.api.get("/api/me").json()
    assert me["trial"]["days_left"] == TRIAL_DAYS and me["trial"]["ended"] is False
    confirmed = parse_time(me["now"]).astimezone(zone).date()
    set_clock(ws, datetime.combine(confirmed + timedelta(days=TRIAL_DAYS - 1), dtime(23, 30), zone))
    me = ws.api.get("/api/me").json()
    assert me["trial"]["days_left"] == 1 and me["trial"]["ended"] is False
    _, edit = holder(ws, "edit")
    v0 = read(ws.api, ws.did)["version"]
    with tab(browser, app_url, "/drawings", session=ws.session, skew=SKEW) as dash, \
            tab(browser, app_url, f"/d/{ws.did}", session=ws.session, skew=SKEW) as editor:
        shows(dash, dash.get_by_role("status", name="Trial"), "1 day left in your trial")
        editor_ready(editor)
        shows(editor, editor.get_by_role("status", name="Trial"), "1 day left in your trial")
        set_clock(ws, datetime.combine(confirmed + timedelta(days=TRIAL_DAYS), dtime(0, 30), zone))
        t0 = time.monotonic()
        shows(dash, dash.get_by_role("status", name="Trial"), "Your trial has ended", LIVE_S + LIVE_SLACK_S)
        left = max(LIVE_S + LIVE_SLACK_S - (time.monotonic() - t0), 1)
        shows(editor, editor.get_by_text("Your trial has ended. Drawings are read-only.").first, None, left)
    me = ws.api.get("/api/me").json()
    assert me["trial"]["days_left"] == 0 and me["trial"]["ended"] is True
    line = {"points": [[100, 100], [900, 100]], "close": False}
    for caller in (ws.api, edit):
        r = run(caller, ws.did, "LINE", line)
        assert r.status_code == 403 and r.json()["error"] == "trial_ended", r.text
    assert ws.api.post(f"/api/drawings/{ws.did}/measure", {"first": [0, 0], "second": [6000, 0]}).status_code == 200
    assert ws.api.post(f"/api/drawings/{ws.did}/traces", {"name": "After trial"}).status_code == 201
    assert ws.api.post(f"/api/drawings/{ws.did}/exports", {"format": "dxf", "layout": "Model"}).status_code == 202
    assert read(ws.api, ws.did)["version"] == v0, "refused base writes leave the version unchanged"


def test_pro_quote_email(browser, app_url, mail):
    ws = workspace(app_url, "blank", time_zone="Asia/Kolkata")
    set_clock(ws, datetime(2027, 2, 1, 20, 0, tzinfo=timezone.utc))
    email = ws.drafter["email"]
    with tab(browser, app_url, "/drawings", session=ws.session) as page:
        page.get_by_role("button", name="Get Pro for $12/month").click()
        dialog = page.get_by_role("dialog", name="Corbel Draft Pro")
        shows(page, dialog, "$12.00 per month. We'll email you a quote; there is nothing to pay here.")
        assert dialog.get_by_role("textbox").count() == 0, "the upgrade dialog holds no card form"
        with held(page, "**/api/quotes") as gate:
            dialog.get_by_role("button", name="Email me a quote").click()
            shows(page, dialog.get_by_role("button", name="Sending quote…"))
            assert not dialog.get_by_text(f"Quote sent to {email}").is_visible()
            assert mails_to(mail, email) == []
            gate.release()
        shows(page, dialog, f"Quote sent to {email}")
    message = wait_mail(mail, email)[0]
    assert message.get("Subject") == "Your Corbel Draft Pro quote"
    body = mail_text(message)
    assert "$12.00 per month" in body and quote_no(QUOTE_DAY, 1) in body, "studio-zone date and first daily sequence"
    r = ws.api.post("/api/quotes", {})
    assert r.status_code == 201, r.text
    quote = r.json()["quote"]
    assert quote["number"] == quote_no(QUOTE_DAY, 2) and quote["amount"] == "12.00" and quote["currency"] == "USD"
    assert quote["sent_to"].lower() == email.lower()

    down = workspace(outage("APP_MAILPIT_DOWN_URL"), "blank")
    r = down.api.post("/api/quotes", {})
    assert r.status_code == 503 and r.json()["error"] == "mail_unavailable"
    with tab(browser, down.base, "/drawings", session=down.session) as page:
        page.get_by_role("button", name="Get Pro for $12/month").click()
        dialog = page.get_by_role("dialog", name="Corbel Draft Pro")
        dialog.get_by_role("button", name="Email me a quote").click()
        shows(page, dialog, "Quote not sent. Mail is unavailable; try again shortly.")
        assert not dialog.get_by_text("Quote sent to").is_visible()
    assert mails_to(mail, down.drafter["email"], settle_s=1.5) == []


def test_wf_dashboard_files_browse(browser, app_url):
    ws = workspace(app_url, "blank", time_zone="America/Chicago")
    moment = datetime(2027, 4, 5, 18, 7, tzinfo=timezone.utc)
    set_clock(ws, moment)
    stamp = date_time_label(moment.astimezone(ZoneInfo("America/Chicago")))
    root = root_folder(ws)
    for name in (FOLDER_A, FOLDER_K):
        assert ws.api.post("/api/folders", {"parent_id": root, "name": name}).status_code == 201
    for name in (FILE_B, FILE_M):
        assert ws.api.post("/api/drawings", {"folder_id": root, "name": name}).status_code == 201
    atlas = next(i for i in listing(ws.api, root) if i["name"] == FOLDER_A)
    assert atlas["modified_label"] == stamp
    with tab(browser, app_url, "/drawings", session=ws.session) as page:
        table = page.get_by_role("table", name="Files")
        shows(page, table.get_by_role("link", name=FILE_M))

        def names() -> list[str]:
            links = table.get_by_role("link")
            return [links.nth(i).inner_text().strip() for i in range(links.count())]

        header = page.get_by_role("columnheader", name="Name")
        table.get_by_role("button", name="Name").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: header.get_attribute("aria-sort") == "ascending", "Name sorts A to Z")
        eventually(page, lambda: names() == [FOLDER_A, FOLDER_K, FILE_B, FILE_M, PLAN_FILE],
                   "folders first, then A to Z")
        page.keyboard.press("Enter")
        eventually(page, lambda: header.get_attribute("aria-sort") == "descending", "a second press flips")
        eventually(page, lambda: names() == [FOLDER_K, FOLDER_A, PLAN_FILE, FILE_M, FILE_B],
                   "folders stay first when descending")
        api_names = [i["name"] for i in listing(ws.api, root, "?sort=name&order=desc")]
        assert api_names == [FOLDER_K, FOLDER_A, PLAN_FILE, FILE_M, FILE_B]
        row = table.get_by_role("row").filter(has=page.get_by_role("link", name=FOLDER_A, exact=True))
        shows(page, row, stamp)
        status = page.get_by_role("status", name="Files status")
        search = page.get_by_role("searchbox", name="Search this folder")
        search.focus()
        page.keyboard.type("aso")
        eventually(page, lambda: names() == [FILE_M], "search filters as the drafter types, ignoring case")
        shows(page, status, "1 item")
        assert urlparse(page.url).path == "/drawings", "search runs without navigation"
        page.keyboard.press("Control+a")
        no_match = "qqzz"
        page.keyboard.type(no_match)
        shows(page, page.get_by_text(f'No files match "{no_match}".'))
        shows(page, status, "0 items")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        shows(page, status, "5 items")
        page.get_by_role("radiogroup", name="View").get_by_role("radio", name="List").focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("radio", name="Grid")).to_be_checked()
        shows(page, page.get_by_role("list", name="Files"), FILE_M)


def test_wf_dashboard_files_new_folder(browser, app_url):
    ws = workspace(app_url, "blank")
    root = root_folder(ws)
    name = f"Drafts {tag()}"
    with tab(browser, app_url, "/drawings", session=ws.session) as page:
        nav = page.get_by_role("navigation", name="Files")
        nav.get_by_role("button", name="New Folder").focus()
        page.keyboard.press("Enter")
        box = page.get_by_role("textbox", name="Folder name")
        shows(page, box)
        expect(box).to_have_value("New folder")
        assert box.evaluate("e => e.selectionStart === 0 && e.selectionEnd === e.value.length"), "name selected"
        page.keyboard.type("Bad/Name")
        page.keyboard.press("Enter")
        shows(page, page.get_by_text(FOLDER_NAME_ERROR).first)
        box.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type(name)
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("table", name="Files").get_by_role("link", name=name))
        assert any(i["name"] == name and i["kind"] == "folder" for i in listing(ws.api, root))
        nav.get_by_role("button", name="New Folder").focus()
        page.keyboard.press("Enter")
        box.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type(name)
        page.keyboard.press("Enter")
        shows(page, page.get_by_text(f'A folder named "{name}" already exists.').first)
        box.focus()
        page.keyboard.press("Escape")
        gone(page, box, "Escape removes the inline row")
        page.get_by_role("button", name=f"More actions for {name}").click()
        page.get_by_role("menuitem", name="Delete").click()
        confirm = page.get_by_role("alertdialog", name=f"Delete {name}?")
        shows(page, confirm, "This can't be undone.")
        confirm.get_by_role("button", name="Delete").click()
        shows(page, announcements(page), f"{name} deleted.")
    assert [i for i in listing(ws.api, root) if i["name"] == name] == []


def test_wf_dashboard_files_phone(browser, app_url):
    ws = workspace(app_url, "blank")
    root = root_folder(ws)
    name = f"Site {tag()}"
    with tab(browser, app_url, "/drawings", session=ws.session, size=PHONE) as page:
        layout(page)
        opener = page.get_by_role("button", name="Files menu")
        box = opener.bounding_box()
        assert box and box["width"] >= TOUCH_MIN_PX and box["height"] >= TOUCH_MIN_PX
        tap(opener)
        sheet = page.get_by_role("dialog", name="Files menu")
        shows(page, sheet)
        tap(sheet.get_by_role("button", name="New Folder"))
        folder_box = page.get_by_role("textbox", name="Folder name")
        shows(page, folder_box)
        folder_box.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type(name)
        page.keyboard.press("Enter")
        table = page.get_by_role("table", name="Files")
        shows(page, table.get_by_role("link", name=name))
        assert table.get_by_role("button", name="Name").is_visible()
        assert table.get_by_role("button", name="Date Modified").is_visible()
        for hidden in ("Size", "Owner", "Shared", "File Type"):
            assert not visible(table.get_by_role("button", name=hidden, exact=True)), f"{hidden} hidden on phones"
    assert any(i["name"] == name and i["kind"] == "folder" for i in listing(ws.api, root))


def test_folder_rules(app_url):
    ws = workspace(app_url, "blank")
    root = root_folder(ws)
    for bad in ("a/b", "x:y", "", "n" * 81):
        r = ws.api.post("/api/folders", {"parent_id": root, "name": bad})
        assert r.status_code == 422 and r.json()["errors"]["name"] == FOLDER_NAME_ERROR, (bad, r.text)
    assert ws.api.post("/api/folders", {"parent_id": root, "name": "m" * 80}).status_code == 201
    name = f"Shared {tag()}"

    def create(_: int) -> httpx.Response:
        return Api(ws.base, session=ws.session).post("/api/folders", {"parent_id": root, "name": name})

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(create, range(8)))
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1 and codes.count(422) == 7, codes
    for r in results:
        if r.status_code == 422:
            assert r.json()["errors"]["name"] == f'A folder named "{name}" already exists.'
    assert [i["name"] for i in listing(ws.api, root)].count(name) == 1
    r = ws.api.post("/api/folders", {"parent_id": root, "name": name.upper()})
    assert r.status_code == 422 and "name" in r.json()["errors"], "names are unique ignoring case"

    set_clock(ws, datetime(2027, 5, 1, 9, 0, tzinfo=timezone.utc))
    parent = ws.api.post("/api/folders", {"parent_id": root, "name": f"Parent {tag()}"}).json()["folder"]
    child = ws.api.post("/api/folders", {"parent_id": parent["id"], "name": "Child"}).json()["folder"]
    r = ws.api.delete(f"/api/folders/{parent['id']}")
    assert r.status_code == 409 and r.json()["error"] == "folder_not_empty"
    assert any(i["id"] == parent["id"] for i in listing(ws.api, root))
    later = datetime(2027, 5, 1, 12, 0, tzinfo=timezone.utc)
    set_clock(ws, later)
    assert ws.api.post("/api/drawings", {"folder_id": parent["id"], "name": "Inner.dxf"}).status_code == 201
    item = next(i for i in listing(ws.api, root) if i["id"] == parent["id"])
    modified = parse_time(item["modified_at"])
    assert later <= modified < later + timedelta(minutes=5), "creating inside a folder sets its Date Modified"
    inner = listing(ws.api, parent["id"])
    for i in inner:
        path = f"/api/folders/{i['id']}" if i["kind"] == "folder" else f"/api/drawings/{i['id']}"
        assert ws.api.delete(path).status_code == 204
    assert child["id"] in [i["id"] for i in inner]
    assert ws.api.delete(f"/api/folders/{parent['id']}").status_code == 204


def test_upload_and_versions(app_url):
    ws = workspace(app_url, "blank")
    root = root_folder(ws)
    s3 = S3()
    name = f"Site {tag()}.dxf"
    v1, v2 = dxf_file(1000), dxf_file(2000)
    r = ws.api.upload(root, name, v1)
    assert r.status_code == 201, r.text
    body = r.json()
    did = body["drawing"]["id"]
    assert body["file_version"] == 1 and body["imported"] == 2 and body["skipped"] == 1
    assert s3.get(f"drawings/{did}/v1.dxf") == v1
    d = read(ws.api, did)
    first = obj(d, "10")
    assert first and first["type"] == "line" and near(first["end"], [1000, 0]), "imports number from 10"
    assert layer(d, "A-WALL")["color"] == "Yellow"
    version = d["version"]
    r = ws.api.upload(root, name, v2)
    assert r.status_code == 201 and r.json()["drawing"]["id"] == did and r.json()["file_version"] == 2
    assert s3.get(f"drawings/{did}/v2.dxf") == v2
    assert read(ws.api, did)["version"] == version + 1
    versions = ws.api.get(f"/api/drawings/{did}/file-versions").json()["versions"]
    assert [v["number"] for v in versions] == [2, 1] and versions[1]["size_bytes"] == len(v1)
    r = ws.api.get(f"/api/drawings/{did}/file-versions/1/download")
    assert r.status_code == 200 and r.content == v1 and "attachment" in r.headers["content-disposition"]
    current = read(ws.api, did)["version"]
    r = ws.api.post(f"/api/drawings/{did}/file-versions/1/restore", {"base_version": current})
    assert r.status_code == 201 and r.json()["file_version"] == 3, r.text
    assert s3.get(f"drawings/{did}/v3.dxf") == v1
    restored = read(ws.api, did)
    assert restored["version"] == current + 1 and near(obj(restored, "10")["end"], [1000, 0])
    r = ws.api.post(f"/api/drawings/{did}/file-versions/2/restore", {"base_version": current})
    assert r.status_code == 409 and r.json()["error"] == "version_conflict"
    for bad, data in (("notes.txt", b"hello"), ("binary.dxf", b"\x00\x01binary\xff\x1a\x00")):
        r = ws.api.upload(root, bad, data)
        assert r.status_code == 422 and r.json()["errors"]["file"] == f"{bad} is not a DXF drawing.", r.text
    big = f"Big {tag()}.dxf"
    r = ws.api.upload(root, big, dxf_file(size=UPLOAD_MAX + 1))
    assert r.status_code == 413 and r.json()["error"] == "file_too_large" and r.json()["limit_bytes"] == UPLOAD_MAX
    assert all(i["name"] != big for i in listing(ws.api, root)), "a refused upload stores nothing"
    r = ws.api.upload(root, f"Edge {tag()}.dxf", dxf_file(size=UPLOAD_MAX))
    assert r.status_code == 201, "a file of exactly the limit is accepted"


def test_upload_stored_after_minio(browser, app_url):
    ws = workspace(app_url, "blank")
    root = root_folder(ws)
    name = f"Plot {tag()}.dxf"
    data = dxf_file(1500)
    with tab(browser, app_url, "/drawings", session=ws.session) as page:
        def upload(file_name: str, payload: bytes) -> None:
            with page.expect_file_chooser() as chooser:
                page.get_by_role("navigation", name="Files").get_by_role("button", name="Upload...").click()
            chooser.value.set_files(files=[{"name": file_name, "mimeType": "application/dxf", "buffer": payload}])

        with held(page, "**/uploads") as gate:
            upload(name, data)
            shows(page, page.get_by_text(f"Uploading {name}…").first)
            assert all(i["name"] != name for i in listing(ws.api, root))
            gate.release()
        shows(page, page.get_by_text("Stored").first)
        did = next(i["id"] for i in listing(ws.api, root) if i["name"] == name)
        assert S3().get(f"drawings/{did}/v1.dxf") == data
        upload(name, dxf_file(2500))
        shows(page, page.get_by_text(f"{name} updated to version 2.").first)
        imported, skipped = 2, 1
        summary = f"Imported {imported} objects; skipped {skipped} unsupported object{'' if skipped == 1 else 's'}."
        shows(page, page.get_by_text(summary).first)
        big_name, bad_name = "big.dxf", "notes.dxf"
        upload(big_name, dxf_file(size=UPLOAD_MAX + 1))
        shows(page, page.get_by_text(f"{big_name} is larger than {UPLOAD_MAX:,} bytes.").first)
        upload(bad_name, b"hello")
        shows(page, page.get_by_text(f"{bad_name} is not a DXF drawing.").first)
    down = workspace(outage("APP_MINIO_DOWN_URL"), "blank")
    down_root = root_folder(down)
    lost = f"Lost {tag()}.dxf"
    r = down.api.upload(down_root, lost, data)
    assert r.status_code == 503 and r.json()["error"] == "storage_unavailable"
    assert all(i["name"] != lost for i in listing(down.api, down_root)), "nothing stored in Postgres"
    with tab(browser, down.base, "/drawings", session=down.session) as page:
        with page.expect_file_chooser() as chooser:
            page.get_by_role("navigation", name="Files").get_by_role("button", name="Upload...").click()
        chooser.value.set_files(files=[{"name": lost, "mimeType": "application/dxf", "buffer": data}])
        shows(page, page.get_by_text("Upload failed: file storage is unavailable.").first)
        assert not visible(page.get_by_text("Stored", exact=True))


def test_live_file_list(browser, app_url):
    ws = workspace(app_url, "blank")
    root = root_folder(ws)
    folder, file_name, recent = f"Live {tag()}", f"Live {tag()}.dxf", f"Recent {tag()}.dxf"
    rid = ws.api.post("/api/drawings", {"folder_id": root, "name": recent}).json()["drawing"]["id"]
    with tab(browser, app_url, "/drawings", session=ws.session, size=PHONE) as phone, \
            tab(browser, app_url, "/drawings?view=recent", session=ws.session) as desk:
        shows(phone, phone.get_by_role("table", name="Files"))
        shows(desk, desk.get_by_role("status", name="Files status"))
        assert not visible(desk.get_by_role("link", name=recent))
        url = phone.url
        assert ws.api.post("/api/folders", {"parent_id": root, "name": folder}).status_code == 201
        shows(phone, phone.get_by_role("link", name=folder), None, LIVE_S + LIVE_SLACK_S)
        assert ws.api.upload(root, file_name, dxf_file()).status_code == 201
        shows(phone, phone.get_by_role("link", name=file_name), None, LIVE_S + LIVE_SLACK_S)
        assert phone.url == url
        assert ws.api.post(f"/api/drawings/{rid}/opened").status_code == 204
        shows(desk, desk.get_by_role("link", name=recent), None, LIVE_S + LIVE_SLACK_S)
    assert any(i["id"] == rid for i in ws.api.get("/api/recent").json()["items"])


def test_command_aliases_echo(browser, app_url):
    ws = workspace(app_url, "blank")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        expect(cmdbox(page)).to_be_focused()
        for i, (alias, full) in enumerate(ALIASES.items()):
            cmdbox(page).focus()
            submit(page, alias.lower() if i % 2 else alias)
            shows(page, history(page), f"Command: {full}")
            prompt_is(page, FIRST_PROMPT[full])
            page.keyboard.press("Escape")
            prompt_is(page, "Command:")
        shows(page, history(page), "*Cancel*")
        submit(page, "CIRCLE")
        prompt_is(page, FIRST_PROMPT["CIRCLE"])
        page.keyboard.press("Escape")
        prompt_is(page, "Command:")
        submit(page, "")
        prompt_is(page, FIRST_PROMPT["CIRCLE"])
        page.keyboard.press("Escape")
        submit(page, "XYZZY")
        shows(page, history(page), 'Unknown command "XYZZY". Press F1 for the command reference.')
        submit(page, "U")
        shows(page, history(page), "Nothing to undo.")
        submit(page, "REDO")
        shows(page, history(page), "Nothing to redo.")
        submit(page, "LA")
        eventually(page, lambda: focused_inside(page.get_by_role("grid", name="Layers")), "LA focuses the Layers grid")
        cmdbox(page).focus()
        submit(page, "I")
        eventually(page, lambda: page.evaluate("() => (document.activeElement.textContent || document.activeElement.getAttribute('aria-label') || '').includes('Insert')")
                   and focused_inside(page.get_by_role("list", name="Block library")), "I focuses the first Insert button")
    assert read(ws.api, ws.did)["objects"] == [], "cancelled commands create nothing"


def test_coordinate_entry_in_units(browser, app_url):
    ws = workspace(app_url, "blank", units="m")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "L")
        submit(page, "1,1")
        prompt_is(page, "Specify next point or [Undo]:")
        submit(page, "1,,2")
        shows(page, history(page), "Invalid point.")
        prompt_is(page, "Specify next point or [Undo]:")
        submit(page, "@2,0")
        prompt_is(page, "Specify next point or [Close/Undo]:")
        submit(page, "@1<90")
        submit(page, "", wait_write=(ws.api, ws.did))
        submit(page, "L")
        submit(page, "-0.5,2")
        submit(page, "@0.25,0")
        submit(page, "", wait_write=(ws.api, ws.did))
        submit(page, "C")
        submit(page, "5,5")
        page.keyboard.press("Escape")
        shows(page, history(page), "*Cancel*")
    lines = [(o["start"], o["end"]) for o in read(ws.api, ws.did)["objects"] if o["type"] == "line"]
    for a, b in (([1000, 1000], [3000, 1000]), ([3000, 1000], [3000, 2000]), ([-500, 2000], [-250, 2000])):
        assert any(near(s, a) and near(e, b) for s, e in lines), f"line {a}->{b} stored in millimetres"
    assert not [o for o in read(ws.api, ws.did)["objects"] if o["type"] == "circle"]


def test_wf_command_drafting_outline(browser, app_url):
    ws = workspace(app_url, "blank")
    w = (ws.api, ws.did)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "L")
        prompt_is(page, "Specify first point:")
        for p in ("0,0", "@6000,0", "@0,4200", "@-6000,0"):
            submit(page, p)
        submit(page, "C", wait_write=w)
        submit(page, "O")
        prompt_is(page, "Specify offset distance:")
        submit(page, "200")
        for pick, side in (("3000,0", "3000,100"), ("6000,2100", "5900,2100"),
                           ("3000,4200", "3000,4100"), ("0,2100", "100,2100")):
            prompt_is(page, "Select object to offset:")
            submit(page, pick)
            submit(page, side, wait_write=w)
        submit(page, "")
        submit(page, "TR")
        for pick in ("100,200", "5900,200", "5800,100", "5800,4100", "100,4000", "5900,4000", "200,100", "200,4100"):
            prompt_is(page, "Select object to trim:")
            submit(page, pick, wait_write=w)
        submit(page, "")
        editor_panel(page, "Activity")
        shows(page, page.get_by_role("log", name="Activity"), "LINE · 4 objects created")
    lines = [(o["start"], o["end"]) for o in read(ws.api, ws.did)["objects"] if o["type"] == "line"]
    assert len(lines) == 8, f"four walls and four trimmed inner lines: {lines}"
    for a, b in (([200, 200], [5800, 200]), ([5800, 200], [5800, 4000]),
                 ([5800, 4000], [200, 4000]), ([200, 4000], [200, 200]),
                 ([0, 0], [6000, 0]), ([6000, 0], [6000, 4200])):
        assert any((near(s, a) and near(e, b)) or (near(s, b) and near(e, a)) for s, e in lines), (a, b)
    commands = [e["command"] for e in activity(ws.api, ws.did)]
    assert commands.count("LINE") == 1 and "OFFSET" in commands and "TRIM" in commands


def test_wf_command_drafting_recovery(browser, app_url):
    ws = workspace(app_url, "blank")
    ok(ws.api, ws.did, "LINE", {"points": [[100, 100], [900, 100]], "close": False})
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "O")
        submit(page, "-5")
        shows(page, history(page), "Requires a positive number.")
        page.keyboard.press("Escape")
        submit(page, "TR")
        submit(page, "500,100")
        shows(page, history(page), "No cutting edge found.")
        page.keyboard.press("Escape")
        submit(page, "L")
        submit(page, "abc")
        shows(page, history(page), "Invalid point.")
        submit(page, "0,500")
        submit(page, "@700,0")
        submit(page, "", wait_write=(ws.api, ws.did))
    d = read(ws.api, ws.did)
    assert any(o["type"] == "line" and near(o["start"], [0, 500]) and near(o["end"], [700, 500]) for o in d["objects"])
    assert any(o["type"] == "line" and near(o["end"], [900, 100]) for o in d["objects"]), "the failed TRIM changed nothing"


def test_wf_command_drafting_ribbon_undo(browser, app_url):
    ws = workspace(app_url, "blank")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        page.get_by_role("tablist", name="Ribbon").get_by_role("tab", name="Draw").click()
        page.get_by_role("button", name="Rectangle", exact=True).click()
        expect(cmdbox(page)).to_be_focused()
        prompt_is(page, "Specify first corner point:")
        submit(page, "100,100")
        submit(page, "@500,300", wait_write=(ws.api, ws.did))
        rect = [o for o in read(ws.api, ws.did)["objects"] if o["type"] == "polyline"]
        assert len(rect) == 1 and rect[0]["closed"] is True
        for got, want in zip(rect[0]["vertices"], [[100, 100], [600, 100], [600, 400], [100, 400]]):
            assert near(got, want), rect[0]["vertices"]
        page.get_by_role("button", name="Undo", exact=True).click()
        shows(page, history(page), "Undo: RECTANG")
        poll(lambda: read(ws.api, ws.did)["objects"], lambda o: o == [], "Undo erases the rectangle", UI_WAIT_S)
        page.get_by_role("button", name="Rectangle", exact=True).focus()
        page.keyboard.press("Control+y")
        shows(page, history(page), "Redo: RECTANG")
        poll(lambda: read(ws.api, ws.did)["objects"], lambda o: len(o) == 1, "Ctrl+Y replays it", UI_WAIT_S)


def test_ribbon_buttons(browser, app_url):
    ws = workspace(app_url, "blank")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        ribbon = page.get_by_role("tablist", name="Ribbon")
        ribbon.get_by_role("tab", name="Draw").focus()
        page.keyboard.press("ArrowRight")
        expect(ribbon.get_by_role("tab", name="Annotate")).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(ribbon.get_by_role("tab", name="Modify")).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(ribbon.get_by_role("tab", name="Annotate")).to_be_focused()
        page.keyboard.press("Space")
        page.keyboard.press("Tab")
        names = list(RIBBON["Annotate"])
        eventually(page, lambda: page.evaluate("() => document.activeElement.textContent.trim()") in names
                   or page.evaluate("() => document.activeElement.getAttribute('aria-label')") in names,
                   "Tab moves into the active tab's buttons")
        for tab_name, buttons in RIBBON.items():
            ribbon.get_by_role("tab", name=tab_name).click()
            for label, full in buttons.items():
                page.get_by_role("button", name=label, exact=True).first.click()
                expect(cmdbox(page)).to_be_focused()
                shows(page, history(page), f"Command: {full}")
                prompt_is(page, FIRST_PROMPT[full])
                page.keyboard.press("Escape")
                prompt_is(page, "Command:")


def test_undo_redo_activity(browser, app_url):
    ws = workspace(app_url, "blank")
    _, edit = holder(ws, "edit")
    w = (ws.api, ws.did)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as a, \
            tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as b:
        editor_ready(a)
        editor_ready(b)
        editor_panel(b, "Activity")
        v0 = read(*w)["version"]
        cmdbox(a).focus()
        submit(a, "C")
        submit(a, "1000,1000")
        submit(a, "500", wait_write=w)
        d = read(*w)
        circle = [o for o in d["objects"] if o["type"] == "circle"]
        assert len(circle) == 1 and circle[0]["radius"] == 500 and d["version"] == v0 + 1
        entry = activity(*w)[0]
        assert entry["command"] == "CIRCLE" and entry["count"] == 1 and entry["verb"] == "created"
        assert re.fullmatch(" · ".join([r"\d{2}:\d{2}", DRAFTER_NAME, entry["command"], f"1 object {entry['verb']}"]),
                            entry["text"])
        shows(b, b.get_by_role("log", name="Activity"), "Ines Halloran · CIRCLE · 1 object created", LIVE_S + LIVE_SLACK_S)
        r = run(edit, ws.did, "UNDO", {})
        if r.status_code == 200:
            assert r.json()["history"] == "Nothing to undo."
        assert read(*w)["version"] == v0 + 1 and obj(read(*w), circle[0]["handle"]), "UNDO is per actor"
        submit(a, "U", wait_write=w)
        shows(a, history(a), "Undo: CIRCLE")
        assert obj(read(*w), circle[0]["handle"]) is None and read(*w)["version"] == v0 + 2
        submit(a, "REDO", wait_write=w)
        shows(a, history(a), "Redo: CIRCLE")
        assert obj(read(*w), circle[0]["handle"]) and read(*w)["version"] == v0 + 3
        submit(a, "REDO")
        shows(a, history(a), "Nothing to redo.")
        shows(b, b.get_by_role("log", name="Activity"), "Ines Halloran · REDO", LIVE_S + LIVE_SLACK_S)
    entries = activity(*w)
    assert [e["command"] for e in entries[:3]] == ["REDO", "UNDO", "CIRCLE"] and len(entries) == 3
    assert read(*w)["version"] == v0 + 3


def test_object_selection(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        view = View(page, read(ws.api, ws.did))
        grip = page.get_by_role("img", name=grip_name("1A"))
        cmdbox(page).focus()
        submit(page, "#1A")
        shows(page, page.get_by_role("region", name="Object Properties"), "Line")
        shows(page, grip)
        page.keyboard.press("Escape")
        gone(page, grip, "Escape clears the selection")
        submit(page, f"1000,{PICK_MM - 2}")
        shows(page, grip)
        page.keyboard.press("Escape")
        gone(page, grip, "cleared")
        submit(page, f"1000,{PICK_MM + 5}")
        shows(page, history(page), "No object found.")
        x, y = view.at(1500, 0)
        page.mouse.click(x, y - (PICK_PX - 1))
        shows(page, grip)
        page.keyboard.press("Escape")
        gone(page, grip, "cleared")
        page.mouse.click(x, y - (PICK_PX + 4))
        advance(page, 500)
        assert not visible(grip), "a click beyond 5 px selects nothing"
        cmdbox(page).focus()
        submit(page, "XYZZY")
        submit(page, "4500,2550")
        eventually(page, lambda: text_of(history(page)).strip().splitlines()[-1:] == ["No object found."],
                   "frozen circle not selected")
        assert not visible(page.get_by_role("img", name=grip_name("2B")))
        ok(ws.api, ws.did, "LAYER", {"op": "set", "name": "A-WALL", "on": False})
        shows(page, sync(page), f"v{read(ws.api, ws.did)['version']}", LIVE_S + LIVE_SLACK_S)
        submit(page, "XYZZY")
        submit(page, "1000,8")
        eventually(page, lambda: text_of(history(page)).strip().splitlines()[-1:] == ["No object found."],
                   "off-layer line not selected")
        assert not visible(grip)


def test_wf_object_properties_edit_field(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "#1A")
        panel = page.get_by_role("region", name="Object Properties")
        end_x = panel.get_by_role("textbox", name="End X")
        expect(end_x).to_have_value("6000.00")
        end_x.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("abc")
        page.keyboard.press("Enter")
        shows(page, panel, "Enter a number.")
        page.keyboard.press("Control+a")
        page.keyboard.type("4500")
        page.keyboard.press("Enter")
        shows(page, panel, "4500.00")
        line = poll(lambda: obj(read(ws.api, ws.did), "1A"), lambda o: near(o["end"], [4500, 0]), "End X saved")
        assert abs(line["length"] - 4500) < 1e-6
        start_y = panel.get_by_role("textbox", name="Start Y")
        start_y.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("300")
        page.keyboard.press("Tab")
        line = poll(lambda: obj(read(ws.api, ws.did), "1A"), lambda o: near(o["start"], [0, 300]), "leaving saves")
        shows(page, panel, fmt(line["length"], 2))
        shows(page, panel, fmt(line["angle"], 2) + "°")
        assert abs(line["angle"] - math.degrees(math.atan2(-300, 4500)) % 360) < 1e-3
        assert urlparse(page.url).path == f"/d/{ws.did}"


def test_wf_object_properties_grip_drag(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        view = View(page, read(ws.api, ws.did))
        cmdbox(page).focus()
        submit(page, "#1A")
        grips = page.get_by_role("img", name=grip_name("1A"))
        shows(page, grips)
        gx, gy = view.at(6000, 0)
        best = min(range(grips.count()), key=lambda i: math.dist(
            ((b := grips.nth(i).bounding_box())["x"] + b["width"] / 2, b["y"] + b["height"] / 2), (gx, gy)))
        box = grips.nth(best).bounding_box()
        end_x = page.get_by_role("region", name="Object Properties").get_by_role("textbox", name="End X")
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        tx, ty = view.at(5000, 0)
        page.mouse.move((gx + tx) / 2, ty, steps=4)
        page.mouse.move(tx, ty, steps=4)
        eventually(page, lambda: abs(float(end_x.input_value()) - 5000) < view.tol(4),
                   "End X follows the pointer during the drag")
        page.mouse.up()
        line = poll(lambda: obj(read(ws.api, ws.did), "1A"), lambda o: abs(o["end"][0] - 5000) < view.tol(4),
                    "the drag saves the new end")
        eventually(page, lambda: end_x.input_value() == fmt(line["end"][0], 2), "panel shows the saved value")
        shows(page, page.get_by_role("region", name="Object Properties"), fmt(line["length"], 2))


def test_multiple_selection(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        view = View(page, read(ws.api, ws.did))
        page.mouse.click(*view.at(1500, 0))
        shows(page, page.get_by_role("img", name=grip_name("1A")))
        page.keyboard.down("Shift")
        page.mouse.click(*view.at(1500, 4200))
        page.keyboard.up("Shift")
        panel = page.get_by_role("region", name="Object Properties")
        shows(page, panel, "2 objects selected")
        start_x = panel.get_by_role("textbox", name="Start X")
        eventually(page, lambda: "*VARIES*" in (start_x.input_value() + (start_x.get_attribute("placeholder") or "")
                                                + text_of(panel)), "differing Start X shows *VARIES*")
        v0 = read(ws.api, ws.did)["version"]
        select(panel.get_by_role("combobox", name="Color"), "Red")
        d = poll(lambda: read(ws.api, ws.did), lambda d: obj(d, "1A")["color"] == "Red", "colour saved")
    assert obj(d, "1C")["color"] == "Red" and obj(d, "1B")["color"] == "ByLayer"
    assert d["version"] == v0 + 1, "one change, one version"
    entry = activity(ws.api, ws.did)[0]
    assert entry["count"] == 2 and entry["verb"] == "modified"


def test_version_conflict_concurrency(app_url):
    ws = workspace(app_url, "studio-plan")
    v = read(ws.api, ws.did)["version"]
    handles = ["1A", "1B", "1C", "1D", "3A"]

    def move(h: str) -> httpx.Response:
        return run(Api(ws.base, session=ws.session), ws.did, "MOVE",
                   {"handles": [h], "from": [0, 0], "to": [0, 50]}, base_version=v)

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = dict(zip(handles, pool.map(move, handles)))
    winners = [h for h, r in results.items() if r.status_code == 200]
    assert len(winners) == 1, {h: r.status_code for h, r in results.items()}
    for h, r in results.items():
        if h != winners[0]:
            assert r.status_code == 409 and r.json()["error"] == "version_conflict"
            assert r.json()["current_version"] == v + 1 and r.json()["changed"] == winners
    d = read(ws.api, ws.did)
    assert d["version"] == v + 1
    for h in handles:
        moved = obj(d, h)["start"][1] - STUDIO_LINES[h][0][1]
        assert abs(moved - (50 if h == winners[0] else 0)) < 1e-6, "no lost or silent update"
    r = run(ws.api, ws.did, "PROPERTIES", {"handles": ["1A"], "set": {"color": "Blue"}}, base_version=v)
    assert r.status_code == 409 and r.json()["changed"] == winners
    assert obj(read(ws.api, ws.did), "1A")["color"] == "ByLayer"


def test_external_references(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    other = workspace(app_url, "blank")
    source_name = f"Grid {tag()}.dxf"
    sid = ws.api.post("/api/drawings", {"folder_id": root_folder(ws), "name": source_name}).json()["drawing"]["id"]
    ok(ws.api, sid, "LINE", {"points": [[1000, -500], [1000, 500]], "close": False})
    r = run(ws.api, ws.did, "XREF", {"op": "attach", "drawing_id": other.did})
    assert r.status_code == 404 and r.json()["error"] == "not_found", "another workspace's drawing is unknown"
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        editor_panel(page, "Xrefs")
        page.get_by_role("button", name="Attach drawing").click()
        dialog = page.get_by_role("dialog", name="Attach drawing")
        dialog.get_by_role("radiogroup", name="Drawing").get_by_role("radio", name=source_name).check()
        dialog.get_by_role("button", name="Attach").click()
        shows(page, announcements(page), f"{source_name} attached.")
        refs = page.get_by_role("list", name="External references")
        shows(page, refs, "Loaded")
        d = read(ws.api, ws.did)
        xref = d["xrefs"][0]
        assert xref["drawing_id"] == sid and xref["status"] == "loaded" and xref["objects"]
        assert contains_point(d["intersections"], [1000, 0]), "xref geometry counts for intersection snaps"
        assert all(o["handle"] not in {x["handle"] for x in xref["objects"]} or o["layer"] for o in d["objects"])
        cmdbox(page).focus()
        submit(page, "1000,-300")
        shows(page, history(page), "No object found.")
        ok(ws.api, ws.did, "XREF", {"op": "unload", "xref_id": xref["id"]})
        shows(page, refs, "Unloaded", LIVE_S + LIVE_SLACK_S)
    assert read(ws.api, ws.did)["xrefs"][0]["status"] == "unloaded"
    ok(ws.api, ws.did, "XREF", {"op": "reload", "xref_id": xref["id"]})
    assert ws.api.delete(f"/api/drawings/{sid}").status_code == 204
    assert read(ws.api, ws.did)["xrefs"][0]["status"] == "not_found"


def test_wf_layers_keyboard(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "LA")
        manager = page.get_by_role("region", name="Layer Properties Manager")
        manager.get_by_role("button", name="New layer").focus()
        page.keyboard.press("Enter")
        shows(page, announcements(page), "Layer Layer1 created.")
        page.keyboard.type("A-ROOF")
        page.keyboard.press("Enter")
        shows(page, announcements(page), "Layer Layer1 renamed to A-ROOF.")
        colour = page.get_by_role("combobox", name=cell_name("Color", "A-ROOF"))
        colour.focus()
        page.keyboard.press("Enter")
        select(colour, "Blue")
        shows(page, announcements(page), "Layer A-ROOF color set to Blue.")
        select(page.get_by_role("combobox", name=cell_name("Linetype", "A-ROOF")), "Dashed")
        shows(page, announcements(page), "Layer A-ROOF linetype set to Dashed.")
        page.get_by_role("checkbox", name=cell_name("Lock", "A-ROOF")).focus()
        activate_in_place(manager.get_by_role("button", name="Set current"))
        shows(page, announcements(page), "Layer A-ROOF is now current.")
        freeze = page.get_by_role("checkbox", name=cell_name("Freeze", "A-DOOR"))
        freeze.focus()
        page.keyboard.press("Space")
        shows(page, announcements(page), "Layer A-DOOR frozen.")
        assert layer(read(ws.api, ws.did), "A-DOOR")["frozen"] is True
        page.keyboard.press("Space")
        shows(page, announcements(page), "Layer A-DOOR thawed.")
    d = read(ws.api, ws.did)
    roof = layer(d, "A-ROOF")
    assert roof["color"] == "Blue" and roof["linetype"] == "Dashed" and roof["current"] is True
    assert layer(d, "A-DOOR")["frozen"] is False and layer(d, "0")["current"] is False


def test_wf_layers_invalid_name(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    ok(ws.api, ws.did, "LAYER", {"op": "new"})
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "LA")
        manager = page.get_by_role("region", name="Layer Properties Manager")
        cell = layer_row(page, default_layer(1)).get_by_role("gridcell", name=default_layer(1), exact=True)
        for bad, copy in (("Bad*Name", LAYER_NAME_ERROR), ("a-wall", re.compile(r'A layer named "(?i:a-wall)" already exists\.'))):
            cell.focus()
            page.keyboard.press("F2")
            page.keyboard.press("Control+a")
            page.keyboard.type(bad)
            page.keyboard.press("Enter")
            shows(page, manager.get_by_role("alert"), copy)
            page.keyboard.press("Escape")
    assert any(l["name"] == default_layer(1) for l in read(ws.api, ws.did)["layers"])


def test_layer_names(app_url):
    ws = workspace(app_url, "blank")
    ok(ws.api, ws.did, "LAYER", {"op": "new"})
    ok(ws.api, ws.did, "LAYER", {"op": "new"})
    names = [l["name"] for l in read(ws.api, ws.did)["layers"]]
    assert default_layer(1) in names and default_layer(2) in names
    fresh = layer(read(ws.api, ws.did), "Layer1")
    assert fresh["color"] == "White" and fresh["linetype"] == "Continuous" and fresh["lineweight"] == "0.25 mm"
    ok(ws.api, ws.did, "LAYER", {"op": "rename", "name": "Layer1", "new_name": "Walls $1_a-b"})
    ok(ws.api, ws.did, "LAYER", {"op": "new"})
    assert default_layer(1) in [l["name"] for l in read(ws.api, ws.did)["layers"]], "smallest free number reused"
    for bad in ("Bad*Name", "", "x" * 65):
        r = run(ws.api, ws.did, "LAYER", {"op": "rename", "name": "Layer2", "new_name": bad})
        assert r.status_code == 422 and LAYER_NAME_ERROR in r.json()["errors"].values(), (bad, r.text)
    r = run(ws.api, ws.did, "LAYER", {"op": "rename", "name": "Layer2", "new_name": "layer1"})
    assert r.status_code == 422
    assert any(m.lower() == f'A layer named "{default_layer(1)}" already exists.'.lower()
               for m in r.json()["errors"].values())
    ok(ws.api, ws.did, "LAYER", {"op": "rename", "name": "Layer2", "new_name": "y" * 64})
    r = run(ws.api, ws.did, "LAYER", {"op": "rename", "name": "0", "new_name": "Base"})
    assert r.status_code == 409 and r.json()["error"] == "layer_zero"


def test_frozen_layer_effects(app_url):
    ws = workspace(app_url, "studio-plan")
    ok(ws.api, ws.did, "LAYER", {"op": "new"})
    ok(ws.api, ws.did, "LAYER", {"op": "current", "name": "Layer1"})
    handle = ok(ws.api, ws.did, "LINE", {"points": [[1000, -100], [1000, 100]], "close": False})["created"][0]
    r = run(ws.api, ws.did, "LAYER", {"op": "set", "name": "Layer1", "frozen": True})
    assert r.status_code == 409 and r.json()["error"] == "layer_current"
    ok(ws.api, ws.did, "LAYER", {"op": "current", "name": "0"})
    assert contains_point(read(ws.api, ws.did)["intersections"], [1000, 0])
    ok(ws.api, ws.did, "LAYER", {"op": "set", "name": "Layer1", "frozen": True})
    d = read(ws.api, ws.did)
    assert obj(d, handle) and layer(d, default_layer(1))["objects"] == 1
    assert not contains_point(d["intersections"], [1000, 0]), "frozen objects are not snap candidates"
    entities = dxf_records(dxf_pairs(download(ws.api, export(ws.api, ws.did, "dxf"))), "ENTITIES")
    assert handle not in [h for e in entities for h in groups(e, "5")]
    ok(ws.api, ws.did, "LAYER", {"op": "set", "name": "Layer1", "frozen": False})
    assert contains_point(read(ws.api, ws.did)["intersections"], [1000, 0])
    entities = dxf_records(dxf_pairs(download(ws.api, export(ws.api, ws.did, "dxf"))), "ENTITIES")
    assert handle in [h for e in entities for h in groups(e, "5")]


def test_live_layer_counts(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        editor_panel(page, "Layers")

        def count(name: str) -> str:
            return text_of(layer_row(page, name).get_by_role("gridcell").last).strip()

        eventually(page, lambda: count("A-WALL") == "5", "A-WALL holds 5 objects")
        url = page.url
        ok(ws.api, ws.did, "LAYER", {"op": "current", "name": "A-WALL"})
        h = ok(ws.api, ws.did, "LINE", {"points": [[100, 100], [200, 100]], "close": False})["created"][0]
        eventually(page, lambda: count("A-WALL") == "6", "create raises the count live", LIVE_S + LIVE_SLACK_S)
        ok(ws.api, ws.did, "ERASE", {"handles": [h]})
        eventually(page, lambda: count("A-WALL") == "5", "erase lowers it live", LIVE_S + LIVE_SLACK_S)
        ok(ws.api, ws.did, "PROPERTIES", {"handles": ["1A"], "set": {"layer": "A-DOOR"}})
        eventually(page, lambda: count("A-WALL") == "4" and count("A-DOOR") == "1", "move between layers",
                   LIVE_S + LIVE_SLACK_S)
        assert page.url == url
    d = read(ws.api, ws.did)
    assert layer(d, "A-WALL")["objects"] == 4 and layer(d, "A-DOOR")["objects"] == 1


def test_locked_layer_refusals(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    v = read(ws.api, ws.did)["version"]
    res = ok(ws.api, ws.did, "MOVE", {"handles": ["1A", "2A"], "from": [0, 0], "to": [0, 100]})
    assert res["modified"] == ["1A"] and res["locked"] == ["2A"] and res["history"] == "1 object is on a locked layer."
    assert near(obj(read(ws.api, ws.did), "2A")["start"], [3000, -600])
    entries = len(activity(ws.api, ws.did))
    res = ok(ws.api, ws.did, "ERASE", {"handles": ["2A"]})
    assert res["locked"] == ["2A"] and read(ws.api, ws.did)["version"] == v + 1, "nothing changed keeps the version"
    assert len(activity(ws.api, ws.did)) == entries and obj(read(ws.api, ws.did), "2A")
    res = ok(ws.api, ws.did, "PROPERTIES", {"handles": ["2A"], "set": {"color": "Blue"}})
    assert res["locked"] == ["2A"] and obj(read(ws.api, ws.did), "2A")["color"] == "ByLayer"
    ok(ws.api, ws.did, "LAYER", {"op": "set", "name": "A-WALL", "locked": True})
    res = ok(ws.api, ws.did, "ERASE", {"handles": ["1B", "1C"]})
    assert res["history"] == f"{2} objects are on a locked layer."
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "#2A")
        panel = page.get_by_role("region", name="Object Properties")
        shows(page, panel, "On locked layer S-GRID")
        expect(panel.get_by_role("combobox", name="Color")).to_be_disabled()


def test_lock_and_edit_race(app_url):
    ws = workspace(app_url, "studio-plan")
    v = read(ws.api, ws.did)["version"]
    calls = [("LAYER", {"op": "set", "name": "A-WALL", "locked": True}),
             ("MOVE", {"handles": ["1A"], "from": [0, 0], "to": [0, 100]})]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda c: run(Api(ws.base, session=ws.session), ws.did, c[0], c[1], v), calls))
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409], codes
    d = read(ws.api, ws.did)
    locked = layer(d, "A-WALL")["locked"]
    moved = abs(obj(d, "1A")["start"][1] - 100) < 1e-6
    assert locked != moved and d["version"] == v + 1, "one winner, the loser applied nothing"
    if results[0].status_code == 409:
        assert results[0].json()["changed"] == ["1A"]


def test_layer_deletion_refusals(app_url):
    ws = workspace(app_url, "studio-plan")
    r = run(ws.api, ws.did, "LAYER", {"op": "delete", "name": "0"})
    assert r.status_code == 409 and r.json()["error"] == "layer_zero", "layer 0 is checked before current"
    ok(ws.api, ws.did, "LAYER", {"op": "set", "name": "A-WALL", "locked": True})
    ok(ws.api, ws.did, "LAYER", {"op": "current", "name": "A-WALL"})
    r = run(ws.api, ws.did, "LAYER", {"op": "delete", "name": "A-WALL"})
    assert r.status_code == 409 and r.json()["error"] == "layer_current", "current before locked and in use"
    ok(ws.api, ws.did, "LAYER", {"op": "current", "name": "0"})
    r = run(ws.api, ws.did, "LAYER", {"op": "delete", "name": "A-WALL"})
    assert r.status_code == 409 and r.json()["error"] == "layer_locked", "locked before in use"
    ok(ws.api, ws.did, "LAYER", {"op": "set", "name": "A-WALL", "locked": False})
    r = run(ws.api, ws.did, "LAYER", {"op": "delete", "name": "A-WALL"})
    assert r.status_code == 409 and r.json()["error"] == "layer_in_use" and r.json()["objects"] == 5
    ok(ws.api, ws.did, "LAYER", {"op": "delete", "name": "A-DOOR"})
    names = [l["name"] for l in read(ws.api, ws.did)["layers"]]
    assert "A-DOOR" not in names and "A-WALL" in names


def test_wf_locked_layer_unlock_erase(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    w = (ws.api, ws.did)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as a, \
            tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as b:
        for p in (a, b):
            editor_ready(p)
            cmdbox(p).focus()
            submit(p, "LA")
        b.get_by_role("checkbox", name=cell_name("Lock", "A-WALL")).focus()
        b.keyboard.press("Space")
        shows(b, announcements(b), "Layer A-WALL locked.")
        lock_a = a.get_by_role("checkbox", name=cell_name("Lock", "A-WALL"))
        eventually(a, lambda: lock_a.is_checked(), "the lock arrives live", LIVE_S + LIVE_SLACK_S)
        cmdbox(a).focus()
        submit(a, "E")
        submit(a, "#3A")
        submit(a, "")
        shows(a, history(a), "1 object is on a locked layer.")
        assert obj(read(*w), "3A")
        lock_a.focus()
        a.keyboard.press("Space")
        shows(a, announcements(a), "Layer A-WALL unlocked.")
        poll(lambda: layer(read(*w), "A-WALL")["locked"], lambda v: v is False, "unlock stored", UI_WAIT_S)
        cmdbox(a).focus()
        submit(a, "E")
        submit(a, "#3A")
        submit(a, "", wait_write=w)
    assert obj(read(*w), "3A") is None


def test_wf_locked_layer_delete_refusal(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "LA")
        page.get_by_role("checkbox", name=cell_name("Freeze", "0"), exact=True).focus()
        page.keyboard.press("Space")
        shows(page, page.get_by_role("region", name="Layer Properties Manager").get_by_role("alert"),
              "Layer 0 is current and can't be frozen.")
    assert layer(read(ws.api, ws.did), "0")["frozen"] is False


def test_wf_locked_layer_select_locked_object(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "LA")
        page.get_by_role("checkbox", name=cell_name("Lock", "A-WALL")).focus()
        page.keyboard.press("Space")
        shows(page, announcements(page), "Layer A-WALL locked.")
        poll(lambda: layer(read(ws.api, ws.did), "A-WALL")["locked"], lambda v: v is True, "lock stored", UI_WAIT_S)
        cmdbox(page).focus()
        submit(page, "#3A")
        editor_panel(page, "Properties")
        cmdbox(page).focus()
        panel = page.get_by_role("region", name="Object Properties")
        shows(page, panel, "On locked layer A-WALL")
        expect(panel.get_by_role("combobox", name="Color")).to_be_disabled()
        grip = page.get_by_role("group", name="Grips").get_by_role("img", name=grip_name("3A"))
        shows(page, grip)
        page.keyboard.press("Escape")
        gone(page, grip, "Escape clears the selection")
        shows(page, page.get_by_text("No selection").first)


def test_snap_markers(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    ok(ws.api, ws.did, "CIRCLE", {"center": [1500, 2100], "radius": 300})
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        view = View(page, read(ws.api, ws.did))

        def marker_at(name: str, x: float, y: float) -> None:
            marker = page.get_by_role("img", name=name)
            shows(page, marker)
            box = next(marker.nth(i).bounding_box() for i in range(marker.count()) if marker.nth(i).is_visible())
            sx, sy = view.at(x, y)
            assert abs(box["x"] + box["width"] / 2 - sx) <= 1 and abs(box["y"] + box["height"] / 2 - sy) <= 1
            assert abs(box["width"] - MARKER_PX) <= 1 and abs(box["height"] - MARKER_PX) <= 1

        cmdbox(page).focus()
        submit(page, "L")
        sx, sy = view.at(3000, 4200)
        page.mouse.move(sx + 2, sy - 3)
        marker_at("Midpoint snap", 3000, 4200)
        page.keyboard.press("Tab")
        marker_at("Intersection snap", 3000, 4200)
        sx, sy = view.at(1500, 2100)
        page.mouse.move(sx + 2, sy + 2)
        marker_at("Center snap", 1500, 2100)
        sx, sy = view.at(6000, 4200)
        page.mouse.move(sx + 3, sy + 2)
        marker_at("Endpoint snap", 6000, 4200)
        fx, fy = view.at(4500, 2100)
        page.mouse.move(fx + 2, fy + 2)
        gone(page, page.get_by_role("img", name="Endpoint snap"), "the marker leaves with the pointer")
        assert not visible(page.get_by_role("img", name="Center snap")), "frozen circle's centre is no candidate"
        sx, sy = view.at(6000, 0)
        page.mouse.move(sx + 3, sy + 2)
        marker_at("Endpoint snap", 6000, 0)
        page.mouse.click(sx + 3, sy + 2)
        cmdbox(page).focus()
        submit(page, "@0,-500")
        submit(page, "", wait_write=(ws.api, ws.did))
    assert any(o["type"] == "line" and o["start"] == [6000, 0] and near(o["end"], [6000, -500])
               for o in read(ws.api, ws.did)["objects"]), "the pick took the exact endpoint"


def test_drafting_aid_toggles(browser, app_url):
    ws = workspace(app_url, "blank")
    w = (ws.api, ws.did)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        view = View(page, read(*w))
        aids = page.get_by_role("toolbar", name="Drafting aids")

        def pressed(name: str) -> str:
            return aids.get_by_role("button", name=name, exact=True).get_attribute("aria-pressed")

        assert pressed("OSNAP") == "true" and all(pressed(n) == "false" for n in ("ORTHO", "POLAR", "SNAP & GRID", "OTRACK"))
        page.get_by_role("button", name="Line", exact=True).focus()
        page.keyboard.press("F3")
        shows(page, history(page), "<Osnap off>")
        assert pressed("OSNAP") == "false"
        aids.get_by_role("button", name="ORTHO").click()
        shows(page, history(page), "<Ortho on>")
        page.keyboard.press("F10")
        shows(page, history(page), "<Polar on>")
        assert pressed("POLAR") == "true" and pressed("ORTHO") == "false", "POLAR turns ORTHO off"
        page.keyboard.press("F8")
        shows(page, history(page), "<Ortho on>")
        assert pressed("POLAR") == "false"
        for key, on, off in (("F9", "<Snap on>", "<Snap off>"), ("F11", "<Otrack on>", "<Otrack off>")):
            page.keyboard.press(key)
            shows(page, history(page), on)
            page.keyboard.press(key)
            shows(page, history(page), off)
        tol = view.tol(3)
        cmdbox(page).focus()
        submit(page, "L")
        submit(page, "1000,1000")
        page.mouse.click(*view.at(2000, 1300))
        cmdbox(page).focus()
        submit(page, "", wait_write=w)
        page.keyboard.press("F10")
        submit(page, "L")
        submit(page, "1000,3000")
        page.mouse.click(*view.at(2000, 3950))
        cmdbox(page).focus()
        submit(page, "", wait_write=w)
        page.keyboard.press("F10")
        page.keyboard.press("F9")
        submit(page, "L")
        submit(page, "5000,5000")
        page.mouse.click(*view.at(6030, 5470))
        cmdbox(page).focus()
        submit(page, "", wait_write=w)
    lines = {tuple(o["start"]): o["end"] for o in read(*w)["objects"] if o["type"] == "line"}
    ortho = lines[(1000, 1000)]
    assert ortho[1] == 1000 and abs(ortho[0] - 2000) <= tol, "ORTHO keeps the larger delta's axis"
    polar = lines[(1000, 3000)]
    dx, dy = polar[0] - 1000, polar[1] - 3000
    assert abs(dx - dy) < 1e-3 and abs(math.hypot(dx, dy) - math.hypot(1000, 950)) <= tol, "45° kept distance"
    assert lines[(5000, 5000)] == [6000, 5500], "grid snap rounds to 100 mm"


def test_block_insertion(browser, app_url):
    ws = workspace(app_url, "blank")
    angle, scale, base = 30, 1.5, (2000, 1000)
    for block, (vx, vy) in BLOCK_VERTEX.items():
        res = ok(ws.api, ws.did, "INSERT", {"block": block, "position": list(base), "scale": scale, "rotation": angle})
        ins = obj(read(ws.api, ws.did), res["created"][0])
        assert ins["type"] == "insert" and ins["block"] == block and near(ins["position"], list(base))
        c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        want = [base[0] + scale * (vx * c - vy * s), base[1] + scale * (vx * s + vy * c)]
        assert contains_point(ins["snaps"]["endpoint"], want), f"{block} geometry transformed about its base point"
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "I")
        library = page.get_by_role("list", name="Block library")
        eventually(page, lambda: focused_inside(library), "I focuses the first Insert button")
        item = library.get_by_role("listitem").filter(has=page.get_by_role("button", name=insert_name(CHAIR_BLOCK)))
        item.get_by_role("spinbutton", name="Scale").fill("2")
        item.get_by_role("spinbutton", name="Rotation").fill("0")
        item.get_by_role("button", name=insert_name(CHAIR_BLOCK)).click()
        expect(cmdbox(page)).to_be_focused()
        prompt_is(page, "Specify insertion point:")
        submit(page, "500,500", wait_write=(ws.api, ws.did))
        shows(page, announcements(page), "Block Chair 450 inserted at 500.00, 500.00.")
    chair = [o for o in read(ws.api, ws.did)["objects"] if o["type"] == "insert" and o["block"] == CHAIR_BLOCK
             and near(o["position"], [500, 500])]
    assert chair and chair[0]["scale"] == 2 and contains_point(chair[0]["snaps"]["endpoint"], [950, 950])


def test_wf_blocks_osnap_pointer_insert(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    w = (ws.api, ws.did)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        view = View(page, read(*w))
        editor_panel(page, "Blocks")
        page.get_by_role("button", name=insert_name(DOOR_BLOCK)).click()
        prompt_is(page, "Specify insertion point:")
        x, y = view.at(3000, 0)
        page.mouse.move(x + 2, y + 3)
        shows(page, page.get_by_role("img", name="Midpoint snap"))
        page.mouse.click(x + 2, y + 3)
        shows(page, announcements(page), "Block Door 900 inserted at 3000.00, 0.00.")
        door = poll(lambda: [o for o in read(*w)["objects"] if o["type"] == "insert"], lambda d: len(d) == 1,
                    "door inserted")[0]
        assert door["position"] == [3000, 0]
        cmdbox(page).focus()
        page.keyboard.press("F8")
        submit(page, "CO")
        submit(page, f"#{door['handle']}")
        submit(page, "")
        submit(page, "3000,0")
        page.mouse.click(*view.at(4000, 150))
        poll(lambda: [o for o in read(*w)["objects"] if o["type"] == "insert"], lambda d: len(d) == 2, "copy made",
             UI_WAIT_S)
    copy = [o for o in read(*w)["objects"] if o["type"] == "insert" and o["handle"] != door["handle"]][0]
    assert copy["position"][1] == 0 and abs(copy["position"][0] - 4000) <= view.tol(3), "ORTHO constrained the copy"


def test_wf_blocks_osnap_phone_tap(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session, size=PHONE) as page:
        editor_ready(page)
        cdp = touch_session(page)
        tap(page.get_by_role("button", name="Panels"))
        panels = page.get_by_role("dialog", name="Panels")
        tap(panels.get_by_role("tab", name="Blocks"))
        tap(panels.get_by_role("button", name=insert_name(CHAIR_BLOCK)))
        prompt_is(page, "Specify insertion point:")
        if visible(panels):
            page.keyboard.press("Escape")
            gone(page, panels, "the Panels sheet closes")
        view = View(page, read(ws.api, ws.did))
        x, y = view.at(0, 4200)
        touch(cdp, x + TOUCH_APERTURE / 2, y + TOUCH_APERTURE / 3)
        shows(page, announcements(page), "Block Chair 450 inserted at 0.00, 4200.00.")
    inserts = [o for o in read(ws.api, ws.did)["objects"] if o["type"] == "insert"]
    assert len(inserts) == 1 and inserts[0]["position"] == [0, 4200] and inserts[0]["block"] == CHAIR_BLOCK


def test_wf_blocks_osnap_keyboard_insert_select(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    w = (ws.api, ws.did)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        submit(page, "I")
        library = page.get_by_role("list", name="Block library")
        eventually(page, lambda: focused_inside(library), "I focuses the first Insert button")
        library.get_by_role("button", name=insert_name(CHAIR_BLOCK)).focus()
        page.keyboard.press("Enter")
        expect(cmdbox(page)).to_be_focused()
        prompt_is(page, "Specify insertion point:")
        submit(page, "1200,900", wait_write=w)
        shows(page, announcements(page), "Block Chair 450 inserted at 1200.00, 900.00.")
        chair = next(o for o in read(*w)["objects"] if o["type"] == "insert" and o["block"] == CHAIR_BLOCK
                     and near(o["position"], [1200, 900]))
        submit(page, f"#{chair['handle']}")
        editor_panel(page, "Properties")
        cmdbox(page).focus()
        panel = page.get_by_role("region", name="Object Properties")
        shows(page, panel.get_by_role("heading"), "Block reference")
        shows(page, panel, CHAIR_BLOCK)
        grip = page.get_by_role("group", name="Grips").get_by_role("img", name=grip_name(chair["handle"]))
        shows(page, grip)
        page.keyboard.press("Escape")
        gone(page, grip, "Escape clears the selection")


def test_dimension_measurements(app_url):
    ws = workspace(app_url, "studio-plan")

    def dim(command: str, args: dict) -> dict:
        handle = ok(ws.api, ws.did, command, args)["created"][0]
        return obj(read(ws.api, ws.did), handle)

    below = dim("DIMLINEAR", {"first": [0, 0], "second": [6000, 4200], "location": [3000, -500]})
    assert below["kind"] == "linear" and below["measurement"] == 6000 and below["text"] == "6000.00"
    assert dim("DIMLINEAR", {"first": [0, 0], "second": [6000, 4200], "location": [6500, 2000]})["measurement"] == 4200
    assert dim("DIMLINEAR", {"first": [0, 0], "second": [6000, 4200], "location": [3000, 2000]})["measurement"] == 6000
    aligned = dim("DIMALIGNED", {"first": [0, 0], "second": [6000, 4200], "location": [2000, 3000]})
    assert abs(aligned["measurement"] - math.hypot(6000, 4200)) < 1e-6
    circle = ok(ws.api, ws.did, "CIRCLE", {"center": [1500, 2100], "radius": 450})["created"][0]
    radius = dim("DIMRADIUS", {"handle": circle, "location": [2500, 2100]})
    assert radius["measurement"] == 450 and radius["text"] == f"R{fmt(450, 2)}"
    diag = ok(ws.api, ws.did, "LINE", {"points": [[0, 0], [3000, 3000]], "close": False})["created"][0]
    acute = dim("DIMANGULAR", {"first_handle": "1A", "second_handle": diag, "location": [2000, 500]})
    obtuse = dim("DIMANGULAR", {"first_handle": "1A", "second_handle": diag, "location": [-2000, 500]})
    assert abs(acute["measurement"] - 45) < 1e-6 and abs(obtuse["measurement"] - (180 - 45)) < 1e-6
    override = MEASURE_MARK + " TYP." + MEASURE_MARK
    ok(ws.api, ws.did, "PROPERTIES", {"handles": [below["handle"]], "set": {"text_override": override}})
    shown = obj(read(ws.api, ws.did), below["handle"])
    assert shown["text"] == override.replace(MEASURE_MARK, below["text"]) and shown["text_override"] == override


def test_units_switch_in_place(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    dim_h = ok(ws.api, ws.did, "DIMLINEAR", {"first": [0, 0], "second": [6000, 0], "location": [3000, -500]})["created"][0]
    ok(ws.api, ws.did, "PROPERTIES", {"handles": [dim_h], "set": {"text_override": "<> TYP."}})
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as a, \
            tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as b:
        editor_ready(a)
        editor_ready(b)
        cmdbox(b).focus()
        submit(b, "#1A")
        end_x = b.get_by_role("region", name="Object Properties").get_by_role("textbox", name="End X")
        expect(end_x).to_have_value("6000.00")
        canvas = b.get_by_role("application", name="Drawing canvas").bounding_box()
        b.mouse.move(canvas["x"] + canvas["width"] / 3, canvas["y"] + canvas["height"] / 3)
        shows(b, b.get_by_role("status", name="Coordinates"), re.compile(r"-?\d+\.\d{2}(?!\d)"))
        url = b.url
        a.keyboard.press("Escape")
        select(a.get_by_role("region", name="Model Properties").get_by_role("combobox", name="Units"), "Meters")
        shows(a, announcements(a), "Units set to Meters.")
        eventually(b, lambda: end_x.input_value() == "6.000", "Properties reformat in place", LIVE_S + LIVE_SLACK_S)
        b.mouse.move(canvas["x"] + canvas["width"] / 2, canvas["y"] + canvas["height"] / 2)
        shows(b, b.get_by_role("status", name="Coordinates"), re.compile(r"-?\d+\.\d{3}(?!\d)"))
        assert b.url == url
    d = read(ws.api, ws.did)
    assert d["units"] == "m" and obj(d, "1A")["end"] == [6000, 0]
    dimension = obj(d, dim_h)
    assert dimension["measurement"] == 6000 and dimension["text"] == "6.000 TYP."


def test_wf_dimensions_keyboard(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    circle = ok(ws.api, ws.did, "CIRCLE", {"center": [1500, 1200], "radius": 450})["created"][0]
    w = (ws.api, ws.did)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        for lines, said in ((["DLI", "0,0", "6000,0", "3000,-600"], "Dimension added: 6000.00"),
                            (["DRA", f"#{circle}", "2000,1200"], "Dimension added: R450.00"),
                            (["DAN", "#1A", "#1B", "5500,500"], "Dimension added: 90.00°")):
            for line in lines[:-1]:
                submit(page, line)
            submit(page, lines[-1], wait_write=w)
            shows(page, announcements(page), said)
    dims = {o["kind"]: o["measurement"] for o in read(*w)["objects"] if o["type"] == "dimension"}
    assert dims == {"linear": 6000, "radius": 450, "angular": 90}


def test_wf_dimensions_snapped_pointer(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        view = View(page, read(ws.api, ws.did))
        cmdbox(page).focus()
        submit(page, "DAL")
        for x, y in ((0, 4200), (6000, 0)):
            sx, sy = view.at(x, y)
            page.mouse.move(sx + 3, sy - 2)
            shows(page, page.get_by_role("img", name="Endpoint snap"))
            page.mouse.click(sx + 3, sy - 2)
        cmdbox(page).focus()
        submit(page, "4000,3500", wait_write=(ws.api, ws.did))
        shows(page, announcements(page), f"Dimension added: {fmt(math.hypot(6000, 4200), 2)}")
    dim = next(o for o in read(ws.api, ws.did)["objects"] if o["type"] == "dimension")
    assert abs(dim["measurement"] - math.hypot(6000, 4200)) < 1e-6


def test_layouts_tablist(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        layouts = page.get_by_role("tablist", name="Layouts")
        for name in ("Model", "Layout1", "Layout2"):
            shows(page, layouts.get_by_role("tab", name=name))
        shows(page, page.get_by_role("status", name="Space"), "MODEL")
        layouts.get_by_role("tab", name="Layout1").click()
        shows(page, page.get_by_role("status", name="Space"), "PAPER")
        shows(page, page.get_by_text("1:50").first)
        page.get_by_role("button", name="New layout").click()
        expect(layouts.get_by_role("tab", name=paper_layout(3))).to_be_focused()
    d = read(ws.api, ws.did)
    assert [l["name"] for l in d["layouts"]] == ["Model", "Layout1", "Layout2", paper_layout(3)]
    ok(ws.api, ws.did, "LAYOUT", {"op": "scale", "name": "Layout1", "viewport_scale": "1:100"})
    assert next(l for l in read(ws.api, ws.did)["layouts"] if l["name"] == "Layout1")["viewport_scale"] == "1:100"


def test_export_stored_before_ready(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    pdf = export(ws.api, ws.did, "pdf", "Layout1")
    assert pdf["state"] == "stored" and pdf["file"] == sheet_file(DRAWING_STEM, "Layout1", 1, "pdf")
    key = f"exports/{ws.did}/{pdf['id']}.pdf"
    assert pdf["object_key"] == key
    body = download(ws.api, pdf)
    assert body.startswith(b"%PDF") and S3().get(key) == body and pdf["size_bytes"] == len(body)
    dxf = export(ws.api, ws.did, "dxf")
    assert dxf["file"] == sheet_file(DRAWING_STEM, "Model", 2, "dxf") and S3().get(f"exports/{ws.did}/{dxf['id']}.dxf") == download(ws.api, dxf)
    listed = ws.api.get(f"/api/drawings/{ws.did}/exports").json()["exports"]
    assert [e["id"] for e in listed[:2]] == [dxf["id"], pdf["id"]], "newest first"

    down = workspace(outage("APP_MINIO_DOWN_URL"), "studio-plan")
    failed = export(down.api, down.did, "pdf", "Layout1")
    assert failed["state"] == "failed"
    r = down.api.get(f"/api/exports/{failed['id']}/download")
    assert r.status_code == 409 and r.json()["error"] == "export_not_ready"
    assert S3().keys(f"exports/{down.did}/") == []
    with tab(browser, down.base, f"/d/{down.did}", session=down.session) as page:
        editor_ready(page)
        page.get_by_role("button", name="Print").click()
        dialog = page.get_by_role("dialog", name="Export")
        dialog.get_by_role("radio", name="PDF").check()
        select(dialog.get_by_role("combobox", name="Layout"), "Layout1")
        dialog.get_by_role("button", name="Export").click()
        shows(page, dialog.get_by_role("list", name="Exports"), f"{sheet_file(DRAWING_STEM, 'Layout1', 2, 'pdf')} · Failed")
        shows(page, announcements(page), "Export failed: file storage is unavailable.")
        assert not visible(dialog.get_by_role("link", name=f"Download {sheet_file(DRAWING_STEM, 'Layout1', 2, 'pdf')}"))


def test_pdf_title_block(app_url):
    ws = workspace(app_url, "studio-plan", time_zone="America/Los_Angeles")
    ok(ws.api, ws.did, "MTEXT", {"position": [4500, 2100], "width": 900, "height": 250, "contents": FROZEN_NOTE})
    handle = next(o["handle"] for o in read(ws.api, ws.did)["objects"] if o["type"] == "mtext")
    ok(ws.api, ws.did, "PROPERTIES", {"handles": [handle], "set": {"layer": "A-FURN"}})
    studio_today = server_now(ws).astimezone(ZoneInfo("America/Los_Angeles")).date()
    issue_day = (studio_today + timedelta(days=4)).isoformat()
    set_clock(ws, datetime.combine(studio_today + timedelta(days=5), dtime(5, 30), timezone.utc))
    styles = {}
    for style in ("Monochrome", "Color", "Grayscale"):
        ok(ws.api, ws.did, "PROPERTIES", {"model": {"plot_style": style}})
        ex = export(ws.api, ws.did, "pdf", "Layout1")
        assert ex["state"] == "stored" and ex["issue_date"] == issue_day
        styles[style] = download(ws.api, ex)
    data = styles["Monochrome"]
    w, h = pdf_page_size(data)
    assert abs(w - A3_W_MM / 25.4 * 72) < 2 and abs(h - A3_H_MM / 25.4 * 72) < 2, "A3 landscape"
    assert pdf_image_count(data) == 0, "vector paths, not images"
    text = words(pdf_text(data))
    for line in ("TITLE Plan A", "SHEET A-101", "SCALE 1:50", f"ISSUED {issue_day}", "REVISION A",
                 "NOTE Issued for coordination."):
        assert line in text, f"title block holds {line!r}"
    assert FROZEN_NOTE not in text, "frozen layers are left out"
    assert all(c == (0, 0, 0) for c in stroke_colours(styles["Monochrome"])), "Monochrome prints black"
    assert any(r > 0.5 and g < 0.3 and b < 0.3 for r, g, b in stroke_colours(styles["Color"])), "Color keeps red"
    grey = stroke_colours(styles["Grayscale"])
    assert grey and all(abs(r - g) < 0.01 and abs(g - b) < 0.01 for r, g, b in grey), "Grayscale prints greys"


def test_title_block_revision_effective_date(app_url):
    ws = workspace(app_url, "studio-plan")
    created = server_now(ws).astimezone(timezone.utc).date()
    day = datetime.combine(created + timedelta(days=10), dtime(12, 0), timezone.utc)
    set_clock(ws, day)
    first = export(ws.api, ws.did, "pdf", "Layout1")
    first_bytes = S3().get(first["object_key"])
    assert first["title_block_revision"] == "A" and f"REVISION {first['title_block_revision']}" in words(pdf_text(first_bytes))
    path = "/api/templates/title-block-a3/revisions"
    effective = (created + timedelta(days=11)).isoformat()
    r = ws.api.post(path, {"footer_note": "", "effective_date": effective})
    assert r.status_code == 422 and r.json()["errors"]["footer_note"] == "Enter a footer note of 1 to 120 characters."
    r = ws.api.post(path, {"footer_note": "Issued for permit.", "effective_date": (created + timedelta(days=9)).isoformat()})
    assert r.status_code == 422
    assert r.json()["errors"]["effective_date"] == "Choose a date after the latest revision and not before today."
    r = ws.api.post(path, {"footer_note": "Issued for permit.", "effective_date": effective})
    assert r.status_code == 201 and r.json()["revision"]["letter"] == "B"
    same_day = export(ws.api, ws.did, "pdf", "Layout1")
    assert same_day["title_block_revision"] == "A"
    set_clock(ws, day + timedelta(days=1))
    later = export(ws.api, ws.did, "pdf", "Layout1")
    text = words(pdf_text(download(ws.api, later)))
    assert later["title_block_revision"] == NEXT_REVISION and f"REVISION {NEXT_REVISION}" in text \
        and f"NOTE {PERMIT_NOTE}" in text
    assert S3().get(first["object_key"]) == first_bytes and download(ws.api, first) == first_bytes


def test_dxf_export_and_import(app_url):
    ws = workspace(app_url, "studio-plan")
    ok(ws.api, ws.did, "LAYER", {"op": "set", "name": "A-DOOR", "on": False})
    pairs = dxf_pairs(download(ws.api, export(ws.api, ws.did, "dxf")))
    assert header_value(pairs, "$INSUNITS") == "4"
    layers = {groups(r, "2")[0]: r for r in dxf_records(pairs, "TABLES") if r["type"] == "LAYER" and groups(r, "2")}
    for name, (colour, linetype, _on, frozen, locked) in STUDIO_LAYERS.items():
        rec = layers[name]
        aci = int(groups(rec, "62")[0])
        assert aci == (-ACI[colour] if name == "A-DOOR" else ACI[colour]), name
        assert groups(rec, "6")[0].casefold() == linetype.casefold()
        assert int(groups(rec, "70")[0]) == (1 if frozen else 0) + (4 if locked else 0)
    entities = dxf_records(pairs, "ENTITIES")
    lines = {groups(e, "5")[0]: e for e in entities if e["type"] == "LINE"}
    assert set(STUDIO_LINES) <= set(lines) and "2B" not in [h for e in entities for h in groups(e, "5")]
    assert groups(lines["1A"], "8") == ["A-WALL"] and float(groups(lines["1A"], "11")[0]) == 6000
    ok(ws.api, ws.did, "PROPERTIES", {"model": {"units": "m"}})
    data = download(ws.api, export(ws.api, ws.did, "dxf"))
    pairs = dxf_pairs(data)
    assert header_value(pairs, "$INSUNITS") == "6"
    one_a = next(e for e in dxf_records(pairs, "ENTITIES") if groups(e, "5") == ["1A"])
    assert float(groups(one_a, "11")[0]) == 6
    r = ws.api.upload(root_folder(ws), f"Roundtrip {tag()}.dxf", data)
    assert r.status_code == 201 and r.json()["imported"] == 6 and r.json()["skipped"] == 0, r.text
    d = read(ws.api, r.json()["drawing"]["id"])
    assert sorted(o["handle"] for o in d["objects"]) == [str(10 + i) for i in range(6)]
    assert any(o["type"] == "line" and near(o["start"], [0, 0]) and near(o["end"], [6000, 0]) for o in d["objects"])
    assert layer(d, "A-WALL")["color"] == "Yellow" and layer(d, "S-GRID")["locked"] is True
    assert layer(d, "S-GRID")["linetype"].casefold() == "center"


def test_wf_layouts_export_keyboard(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        cmdbox(page).focus()
        page.keyboard.press("Control+p")
        dialog = page.get_by_role("dialog", name="Export")
        shows(page, dialog)
        dialog.get_by_role("radio", name="PDF").focus()
        page.keyboard.press("Space")
        select(dialog.get_by_role("combobox", name="Layout"), "Layout1")
        dialog.get_by_role("button", name="Export").focus()
        page.keyboard.press("Enter")
        file = sheet_file(DRAWING_STEM, "Layout1", 1, "pdf")
        shows(page, dialog.get_by_role("list", name="Exports"), f"{file} · Ready", API_WAIT_S)
        shows(page, announcements(page), f"Export ready: {file}")
        href = dialog.get_by_role("link", name=f"Download {file}").get_attribute("href")
        served = page.request.get(href if href.startswith("http") else app_url.rstrip("/") + href).body()
    ex = ws.api.get(f"/api/drawings/{ws.did}/exports").json()["exports"][0]
    assert ex["file"] == file and S3().get(f"exports/{ws.did}/{ex['id']}.pdf") == served


def test_wf_layouts_export_revision(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    today = server_now(ws).date() + timedelta(days=5)
    set_clock(ws, datetime.combine(today, dtime(12, 0), timezone.utc))
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        page.get_by_role("button", name="Print").click()
        page.get_by_role("dialog", name="Export").get_by_role("button", name="Title block revisions").click()
        block = page.get_by_role("dialog", name="Title block A3")
        block.get_by_role("textbox", name="Footer note").fill("Issued for tender.")
        block.get_by_role("textbox", name="Effective date").fill(today.isoformat())
        block.get_by_role("button", name="Add revision").click()
        shows(page, announcements(page), f"Revision B added, effective {today.isoformat()}.")
        shows(page, block.get_by_role("list", name="Revisions"), "Issued for tender.")
    text = words(pdf_text(download(ws.api, export(ws.api, ws.did, "pdf", "Layout1"))))
    assert f"REVISION {NEXT_REVISION}" in text and f"NOTE {TENDER_NOTE}" in text


def test_traces_leave_base_untouched(app_url):
    ws = workspace(app_url, "studio-plan")
    _, mark = holder(ws, "markup")
    before = read(ws.api, ws.did)
    entries = len(activity(ws.api, ws.did))

    def unchanged(step: str) -> None:
        now = read(ws.api, ws.did)
        assert now["version"] == before["version"] and now["objects"] == before["objects"], f"{step} changed the base"

    r = run(mark, ws.did, "LINE", {"points": [[0, 0], [100, 0]], "close": False})
    assert r.status_code == 403 and r.json()["error"] == "markup_only"
    unchanged("refused base write")
    trace = mark.post(f"/api/drawings/{ws.did}/traces", {"name": "Site walk"}).json()["trace"]
    tid = trace["id"]
    for command, args in (("LINE", {"points": [[0, 0], [500, 500]], "close": False}),
                          ("CIRCLE", {"center": [1000, 1000], "radius": 200}),
                          ("REVCLOUD", {"first": [0, 0], "opposite": [600, 300]}),
                          ("MTEXT", {"position": [100, 100], "width": 500, "height": 250, "contents": "Check"})):
        assert mark.post(f"/api/traces/{tid}/commands", {"command": command, "args": args}).status_code == 200
        unchanged(command)
    objects = mark.get(f"/api/traces/{tid}").json()["trace"]["objects"]
    assert objects[0]["handle"] == "T1" and all(o["handle"].startswith("T") for o in objects)
    assert mark.post(f"/api/traces/{tid}/commands", {"command": "ERASE", "args": {"handles": ["T1"]}}).status_code == 200
    unchanged("trace ERASE")
    assert mark.post(f"/api/traces/{tid}/submit").status_code == 200
    unchanged("submit")
    assert ws.api.post(f"/api/traces/{tid}/close").status_code == 200
    unchanged("close")
    assert len(activity(ws.api, ws.did)) == entries


def test_trace_lifecycle_and_issues(app_url):
    ws = workspace(app_url, "studio-plan")
    _, mark = holder(ws, "markup")
    _, view = holder(ws, "view", name="Rhea Vale")
    _, edit = holder(ws, "edit", name="Ola Brandt")
    r = view.post(f"/api/drawings/{ws.did}/traces", {"name": "No"})
    assert r.status_code == 403 and r.json()["error"] == "view_only"
    r = mark.post(f"/api/drawings/{ws.did}/traces", {"name": ""})
    assert r.status_code == 422 and r.json()["errors"]["name"] == "Enter a trace name (1 to 80 characters)."
    trace = mark.post(f"/api/drawings/{ws.did}/traces", {"name": "Review"}).json()["trace"]
    assert trace["state"] == "open" and trace["objects"] == []
    tid = trace["id"]
    assert mark.post(f"/api/traces/{tid}/commands",
                     {"command": "REVCLOUD", "args": {"first": [0, 0], "opposite": [1000, 450]}}).status_code == 200
    cloud = next(o for o in mark.get(f"/api/traces/{tid}").json()["trace"]["objects"] if o["type"] == "revcloud")
    assert cloud["arcs"] == 2 * math.ceil(1000 / ARC_SIDE_MM) + 2 * math.ceil(450 / ARC_SIDE_MM)
    for text in ("Door swing clashes", "Check grid line"):
        args = {"position": [100, 100], "width": 800, "height": 250, "contents": text}
        assert mark.post(f"/api/traces/{tid}/commands", {"command": "MTEXT", "args": args}).status_code == 200
    r = edit.post(f"/api/traces/{tid}/commands", {"command": "LINE", "args": {"points": [[0, 0], [1, 1]], "close": False}})
    assert r.status_code == 403 and r.json()["error"] == "forbidden"
    r = ws.api.post(f"/api/traces/{tid}/close")
    assert r.status_code == 409 and r.json()["error"] == "trace_not_submitted"
    r = mark.post(f"/api/traces/{tid}/submit")
    assert r.status_code == 200 and r.json()["trace"]["state"] == "submitted"
    issues = ws.api.get(f"/api/drawings/{ws.did}/issues").json()["issues"]
    assert [(i["number"], i["text"], i["status"]) for i in issues] == [
        (1, REVIEW_NOTES[0], "open"), (2, REVIEW_NOTES[1], "open")]
    for again in (lambda: mark.post(f"/api/traces/{tid}/submit"),
                  lambda: mark.post(f"/api/traces/{tid}/commands", {"command": "CIRCLE", "args": {"center": [0, 0], "radius": 9}})):
        r = again()
        assert r.status_code == 409 and r.json()["error"] == "trace_not_open"
    r = mark.post(f"/api/traces/{tid}/close")
    assert r.status_code == 403 and r.json()["error"] == "markup_only"
    assert ws.api.post(f"/api/traces/{tid}/close").json()["trace"]["state"] == "closed"
    r = ws.api.post(f"/api/traces/{tid}/close")
    assert r.status_code == 409 and r.json()["error"] == "trace_not_submitted"
    assert ws.api.post(f"/api/drawings/{ws.did}/issues/1/resolve").json()["issue"]["status"] == "resolved"
    r = ws.api.post(f"/api/drawings/{ws.did}/issues/1/resolve")
    assert r.status_code == 409 and r.json()["error"] == "issue_resolved"


def test_trace_submitted_notice(browser, app_url, mail):
    ws = workspace(app_url, "studio-plan")
    _, mark = holder(ws, "markup")
    name = f"Walk {tag()}"
    tid = mark.post(f"/api/drawings/{ws.did}/traces", {"name": name}).json()["trace"]["id"]
    mark.post(f"/api/traces/{tid}/commands",
              {"command": "MTEXT", "args": {"position": [0, 0], "width": 500, "height": 250, "contents": "Fix"}})
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        r = mark.post(f"/api/traces/{tid}/submit")
        assert r.status_code == 200 and r.json()["trace"]["notice"] == "sent"
        shows(page, announcements(page), f'Trace "{name}" submitted by Tomas Wren', LIVE_S + LIVE_SLACK_S)
    message = wait_mail(mail, ws.drafter["email"])[0]
    assert message.get("Subject", "").startswith(f'Trace "{name}" submitted on {DRAWING_STEM}')
    assert "Tomas Wren" in mail_text(message)
    assert next(t for t in read(ws.api, ws.did)["traces"] if t["id"] == tid)["notice"] == "sent"
    down = workspace(outage("APP_MAILPIT_DOWN_URL"), "studio-plan")
    _, dmark = holder(down, "markup")
    did = dmark.post(f"/api/drawings/{down.did}/traces", {"name": "Down"}).json()["trace"]["id"]
    r = dmark.post(f"/api/traces/{did}/submit")
    assert r.status_code == 200 and r.json()["trace"]["state"] == "submitted" and r.json()["trace"]["notice"] == "not_sent"
    assert mails_to(mail, down.drafter["email"], settle_s=1.5) == []


def test_wf_trace_review_phone(browser, app_url, mail):
    ws = workspace(app_url, "studio-plan")
    reviewer = ws.reviewer["email"]
    s = share(ws, "markup", email=reviewer, name=ws.reviewer["name"])
    assert ws.api.post(f"/api/shares/{s['id']}/invite").status_code == 200
    token = link_in(wait_mail(mail, reviewer)[0], "s")
    name = f"Phone {tag()}"
    v0 = read(ws.api, ws.did)["version"]
    with tab(browser, app_url, f"/s/{token}", size=PHONE) as page:
        editor_ready(page)
        cdp = touch_session(page)
        shows(page, page.get_by_role("status", name="Access"), "Mark-up only")
        tap(page.get_by_role("button", name="Panels"))
        panels = page.get_by_role("dialog", name="Panels")
        tap(panels.get_by_role("tab", name="Traces"))
        tap(panels.get_by_role("button", name="New trace"))
        dialog = page.get_by_role("dialog", name="New trace")
        dialog.get_by_role("textbox", name="Trace name").fill(name)
        tap(dialog.get_by_role("button", name="Create trace"))
        shows(page, page.get_by_role("status", name="Trace"), f"Tracing: {name}")
        if visible(panels):
            page.keyboard.press("Escape")
            gone(page, panels, "the Panels sheet closes")
        tid = next(t["id"] for t in read(ws.api, ws.did)["traces"] if t["name"] == name)
        objects = lambda: Api(ws.base, link=token).get(f"/api/traces/{tid}").json()["trace"]["objects"]
        view = View(page, read(ws.api, ws.did))
        cmdbox(page).focus()
        submit(page, "RC")
        prompt_is(page, "Specify first corner:")
        touch(cdp, *view.at(1000, 3600))
        prompt_is(page, "Specify opposite corner:")
        touch(cdp, *view.at(2500, 3000))
        cloud = poll(objects, lambda o: any(x["type"] == "revcloud" for x in o), "the tapped cloud is stored", UI_WAIT_S)
        assert next(x for x in cloud if x["type"] == "revcloud")["arcs"] >= 4
        cmdbox(page).focus()
        submit(page, "T")
        touch(cdp, *view.at(3500, 3600))
        touch(cdp, *view.at(5500, 3000))
        prompt_is(page, "Enter text:")
        cmdbox(page).focus()
        page.keyboard.type("Fix door swing")
        page.keyboard.press("Enter")
        poll(objects, lambda o: any(x.get("contents") == PHONE_NOTE for x in o), "comment stored", UI_WAIT_S)
        tap(page.get_by_role("button", name="Panels"))
        tap(page.get_by_role("dialog", name="Panels").get_by_role("button", name="Submit trace"))
        poll(lambda: next(t for t in read(ws.api, ws.did)["traces"] if t["id"] == tid)["state"],
             lambda st: st == "submitted", "trace submitted", UI_WAIT_S)
    issues = ws.api.get(f"/api/drawings/{ws.did}/issues").json()["issues"]
    assert any(i["text"] == PHONE_NOTE and i["status"] == "open" for i in issues)
    strokes = [o["handle"] for o in ws.api.get(f"/api/traces/{tid}").json()["trace"]["objects"]]
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        editor_panel(page, "Traces")
        page.get_by_role("button", name=f"Open trace {name}").click()
        for handle in strokes[:1]:
            shows(page, page.get_by_role("group", name="Change highlight").get_by_role("img", name=f"Trace stroke {handle}"))
    assert read(ws.api, ws.did)["version"] == v0


def test_wf_trace_review_playback_reduced(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    _, mark = holder(ws, "markup")
    tid = mark.post(f"/api/drawings/{ws.did}/traces", {"name": TRACE_QUICK}).json()["trace"]["id"]
    for i in range(3):
        mark.post(f"/api/traces/{tid}/commands",
                  {"command": "REVCLOUD", "args": {"first": [i * 1000, 0], "opposite": [i * 1000 + 600, 600]}})
    mark.post(f"/api/traces/{tid}/submit")
    handles = [o["handle"] for o in mark.get(f"/api/traces/{tid}").json()["trace"]["objects"]]
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session, reduced=True) as page:
        editor_ready(page)
        page.evaluate(MOTION_JS)
        editor_panel(page, "Traces")
        page.get_by_role("button", name=f"Open trace {TRACE_QUICK}").click()
        group = page.get_by_role("group", name="Change highlight")
        eventually(page, lambda: all(visible(group.get_by_role("img", name=f"Trace stroke {h}")) for h in handles),
                   "every stroke shows")
        assert all(m["dur"] <= INSTANT_MS for m in motion_records(page, group) if m["inside"]), "no draw-in"


def test_live_change_delivery(browser, app_url, valkey):
    ws = workspace(app_url, "studio-plan")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as a, \
            tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as b:
        editor_ready(a)
        editor_ready(b)

        cmdbox(b).focus()
        submit(b, "#3A")
        end_x = b.get_by_role("region", name="Object Properties").get_by_role("textbox", name="End X")
        expect(end_x).to_have_value(fmt(2400, 2))
        url = b.url
        version = ok(ws.api, ws.did, "MOVE", {"handles": ["3A"], "from": [0, 0], "to": [100, 0]})["version"]
        for p in (a, b):
            shows(p, sync(p), f"Synced · v{version}", LIVE_S + LIVE_SLACK_S)
        eventually(b, lambda: end_x.input_value() == fmt(2400 + 100, 2), "Properties update in place")
        assert b.url == url


@pytest.mark.parametrize("mode", MOTION_MODES, ids=MOTION_MODES)
def test_remote_change_highlight(browser, app_url, mode):
    ws = workspace(app_url, "studio-plan")
    reduced = mode == "reduce"
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session, reduced=reduced) as page:
        editor_ready(page)
        page.evaluate(MOTION_JS)
        ok(ws.api, ws.did, "MOVE", {"handles": ["1A"], "from": [0, 0], "to": [0, 30]})
        grip = page.get_by_role("img", name=grip_name("1A"))
        shows(page, page.get_by_role("group", name="Grips").get_by_role("img", name=grip_name("1A")), None,
              LIVE_S + LIVE_SLACK_S)
        seen_at, advanced = time.monotonic(), 0.0
        records = motion_records(page)
        assert not visible(page.get_by_role("img", name=changed_name("1B"))), "unchanged objects do not redraw"
        assert all(m["label"] != changed_name("1B") for m in records)
        changed = [m for m in records if m["label"] == changed_name("1A")]
        if reduced:
            assert all(m["dur"] <= INSTANT_MS for m in changed), "no draw-in under reduced motion"
        else:
            assert any(about(m["dur"], DRAW_IN_MS) for m in changed), f"0.9 s draw-in on the overlay: {changed}"
            pops = [m for m in records if m["label"] == grip_name("1A")]
            assert any(about(m["dur"], GRIP_POP_MS) for m in pops), f"0.16 s grip pop: {pops}"
        deadline = time.monotonic() + UI_WAIT_S
        while visible(grip) and time.monotonic() < deadline:
            advance(page, 100)
            advanced += 100
        held_ms = max(advanced, (time.monotonic() - seen_at) * 1000)
        assert not visible(grip), "grips are removed after the hold"
        assert held_ms >= GRIP_HOLD_MS * (1 - TIMING_TOL), f"grips held about 1.2 s (held {held_ms:.0f} ms)"


def test_edit_conflict_dialog(browser, mail):
    ws = workspace(outage("APP_VALKEY_DOWN_URL"), "studio-plan")
    with tab(browser, ws.base, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        ok(ws.api, ws.did, "MOVE", {"handles": ["1A"], "from": [0, 0], "to": [0, 10]})
        cmdbox(page).focus()
        submit(page, "E")
        submit(page, "#3A")
        submit(page, "")
        dialog = page.get_by_role("alertdialog", name="Edit conflict")
        shows(page, dialog, "Another tab changed 1 object before your edit was saved. Your edit was not applied.")
        d = read(ws.api, ws.did)
        assert obj(d, "3A") and d["version"] == 2
        dialog.get_by_role("button", name="Load latest").click()
        expect(cmdbox(page)).to_be_focused()
        submit(page, "E")
        submit(page, "#3A")
        submit(page, "", wait_write=(ws.api, ws.did))
    assert obj(read(ws.api, ws.did), "3A") is None and read(ws.api, ws.did)["version"] == 3


def test_presence_and_idle(browser, app_url, valkey):
    ws = workspace(app_url, "studio-plan")
    edit_share, _ = holder(ws, "edit")
    view_share, _ = holder(ws, "view", name="Rhea Vale")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as owner, \
            tab(browser, app_url, f"/s/{edit_share['token']}", skew=SKEW) as editor, \
            tab(browser, app_url, f"/s/{view_share['token']}") as viewer:
        for p in (owner, editor, viewer):
            editor_ready(p)
        for p in (editor, viewer):
            box = p.get_by_role("application", name="Drawing canvas").bounding_box()
            p.mouse.move(box["x"] + 50, box["y"] + 50)
            p.mouse.move(box["x"] + 80, box["y"] + 60)
        people = owner.get_by_role("list", name="Collaborators")
        shows(owner, people, "Tomas Wren · Editing", LIVE_S + LIVE_SLACK_S)
        shows(owner, people, "Rhea Vale · Viewing", LIVE_S + LIVE_SLACK_S)
        tabs = valkey.members(f"presence:{ws.did}")
        assert len(tabs) >= 3
        fields = valkey.hash(f"presence:{ws.did}:{tabs[0]}")
        assert {"name", "access", "state", "last_input_at"} <= set(fields)
        assert 0 < valkey.ttl(f"presence:{ws.did}:{tabs[0]}") <= 30
        set_clock(ws, server_now(ws) + timedelta(seconds=PRESENCE_IDLE_S + 5))
        shows(owner, people, "Tomas Wren · Away", LIVE_S + LIVE_SLACK_S)
        box = editor.get_by_role("application", name="Drawing canvas").bounding_box()
        advance(editor, 2500)
        editor.mouse.move(box["x"] + 120, box["y"] + 90)
        editor.keyboard.press("Shift")
        shows(owner, people, "Tomas Wren · Editing", LIVE_S + LIVE_SLACK_S)


def test_wf_live_sync_two_tab(browser, app_url, mail):
    ws = workspace(app_url, "studio-plan")
    s = share(ws, "edit", email=ws.reviewer["email"], name=ws.reviewer["name"])
    assert ws.api.post(f"/api/shares/{s['id']}/invite").status_code == 200
    token = link_in(wait_mail(mail, ws.reviewer["email"])[0], "s")
    link = Api(ws.base, link=token)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as owner, \
            tab(browser, app_url, f"/s/{token}") as guest:
        for p in (owner, guest):
            editor_ready(p)
            editor_panel(p, "Activity")
        shows(guest, guest.get_by_role("status", name="Access"), "Can edit")
        cmdbox(guest).focus()
        for line in ("M", "#3A", "", "0,0"):
            submit(guest, line)
        submit(guest, "@0,100", wait_write=(link, ws.did))
        shows(owner, owner.get_by_role("log", name="Activity"), "Tomas Wren · MOVE · 1 object modified", LIVE_S + LIVE_SLACK_S)
        cmdbox(owner).focus()
        for line in ("E", "#1D"):
            submit(owner, line)
        submit(owner, "", wait_write=(ws.api, ws.did))
        shows(guest, guest.get_by_role("log", name="Activity"), "Ines Halloran · ERASE · 1 object erased", LIVE_S + LIVE_SLACK_S)
        version = read(ws.api, ws.did)["version"]
        for p in (owner, guest):
            shows(p, sync(p), f"Synced · v{version}", LIVE_S + LIVE_SLACK_S)
    d = read(ws.api, ws.did)
    assert near(obj(d, "3A")["start"], [0, 2500]) and obj(d, "1D") is None
    actors = {(e["command"], e["actor"]) for e in activity(ws.api, ws.did)}
    assert ("MOVE", "Tomas Wren") in actors and ("ERASE", "Ines Halloran") in actors


def test_wf_live_sync_paused(browser):
    ws = workspace(outage("APP_VALKEY_DOWN_URL"), "studio-plan")
    with tab(browser, ws.base, f"/d/{ws.did}", session=ws.session) as a, \
            tab(browser, ws.base, f"/d/{ws.did}", session=ws.session) as b:
        editor_ready(a)
        shows(b, sync(b), "Live sync paused")
        shows(b, b.get_by_role("status", name="Service status"),
              "Live sync is paused. Your edits still save; reload to see changes from other tabs.")
        cmdbox(a).focus()
        for line in ("E", "#3A"):
            submit(a, line)
        submit(a, "", wait_write=(ws.api, ws.did))
        b.reload()
        editor_ready(b)
    assert obj(read(ws.api, ws.did), "3A") is None


def test_share_invite_and_cooldown(browser, app_url, mail):
    ws = workspace(app_url, "studio-plan")
    recipient = email_for("invitee")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        page.get_by_role("button", name="Share").click()
        dialog = page.get_by_role("dialog", name="Share drawing")
        dialog.get_by_role("radio", name="Can view").check()
        dialog.get_by_role("textbox", name="Recipient email").fill(recipient)
        dialog.get_by_role("textbox", name="Recipient name").fill("Rhea Vale")
        with held(page, "**/api/shares/*/invite") as gate:
            dialog.get_by_role("button", name="Send invite").click()
            shows(page, dialog.get_by_role("button", name="Sending invite…"))
            assert mails_to(mail, recipient) == [] and not dialog.get_by_text(f"Invite sent to {recipient}").is_visible()
            gate.release()
        shows(page, dialog, f"Invite sent to {recipient}")
        shows(page, dialog.get_by_role("list", name="Share links"), re.compile(r"Can view · .+ · Active"))
    message = wait_mail(mail, recipient)[0]
    assert message.get("Subject") == f'{DRAFTER_NAME} shared "{DRAWING_STEM}.dxf" with you'
    body = mail_text(message)
    created = next(s for s in ws.api.get(f"/api/drawings/{ws.did}/shares").json()["shares"]
                   if s["recipient_email"].lower() == recipient.lower())
    assert f"/s/{created['token']}" in body and "Can view" in body and "Does not expire" in body
    r = ws.api.post(f"/api/shares/{created['id']}/invite")
    assert r.status_code == 429 and r.json()["error"] == "invite_cooldown"
    assert 0 < r.json()["retry_after_seconds"] <= INVITE_COOLDOWN_S
    assert len(mails_to(mail, recipient, settle_s=1.5)) == 1, "a refused invite sends nothing"
    set_clock(ws, server_now(ws) + timedelta(seconds=INVITE_COOLDOWN_S + 5))
    r = ws.api.post(f"/api/shares/{created['id']}/invite")
    assert r.status_code == 200 and r.json()["invite"] == "sent"
    wait_mail(mail, recipient, seen={mail_id(message)})
    for body_patch, field, copy in (({"expiry_date": "2027/01/10"}, "expiry_date", "Enter a date as YYYY-MM-DD."),
                                    ({"expiry_date": "2001-01-01"}, "expiry_date", "Choose today or a later date."),
                                    ({"recipient_email": "nope"}, "recipient_email", "Enter a valid email address.")):
        r = ws.api.post(f"/api/drawings/{ws.did}/shares",
                        {"access": "view", "recipient_email": email_for("x"), "expiry_date": None, **body_patch})
        assert r.status_code == 422 and r.json()["errors"][field] == copy
    down = workspace(outage("APP_MAILPIT_DOWN_URL"), "studio-plan")
    lost = email_for("lost")
    with tab(browser, down.base, f"/d/{down.did}", session=down.session) as page:
        editor_ready(page)
        page.get_by_role("button", name="Share").click()
        dialog = page.get_by_role("dialog", name="Share drawing")
        dialog.get_by_role("radio", name="Can mark up").check()
        dialog.get_by_role("textbox", name="Recipient email").fill(lost)
        dialog.get_by_role("button", name="Send invite").click()
        shows(page, dialog, "Invite not sent. Mail is unavailable; try again shortly.")
        assert not dialog.get_by_text(f"Invite sent to {lost}").is_visible()
    assert mails_to(mail, lost, settle_s=1.5) == []


def test_link_access_levels(app_url):
    ws = workspace(app_url, "studio-plan")
    _, view = holder(ws, "view", name="Rhea Vale")
    _, mark = holder(ws, "markup")
    _, edit = holder(ws, "edit", name="Ola Brandt")
    v0 = read(ws.api, ws.did)["version"]
    line = {"points": [[100, 100], [900, 100]], "close": False}
    for api, access, code in ((view, "view", "view_only"), (mark, "markup", "markup_only")):
        assert read(api, ws.did)["access"] == access
        r = api.post(f"/api/drawings/{ws.did}/measure", {"first": [0, 0], "second": [6000, 0]})
        assert r.status_code == 200 and r.json()["distance"] == 6000
        for attempt in (lambda: run(api, ws.did, "LINE", line),
                        lambda: api.post(f"/api/drawings/{ws.did}/exports", {"format": "pdf", "layout": "Layout1"}),
                        lambda: api.post(f"/api/drawings/{ws.did}/shares", {"access": "view", "recipient_email": email_for("y"), "expiry_date": None}),
                        lambda: api.post("/api/templates/title-block-a3/revisions", {"footer_note": "x", "effective_date": "2030-01-01"})):
            r = attempt()
            assert r.status_code == 403 and r.json()["error"] == code, r.text
        assert api.post(f"/api/drawings/{ws.did}/presence", {"tab_id": tag()}).status_code == 204
    trace = mark.post(f"/api/drawings/{ws.did}/traces", {"name": "Mine"})
    assert trace.status_code == 201
    tid = trace.json()["trace"]["id"]
    assert mark.post(f"/api/traces/{tid}/commands",
                     {"command": "REVCLOUD", "args": {"first": [0, 0], "opposite": [300, 300]}}).status_code == 200
    assert run(edit, ws.did, "LINE", line).status_code == 200
    for attempt in (lambda: edit.post(f"/api/drawings/{ws.did}/shares", {"access": "view", "recipient_email": email_for("z"), "expiry_date": None}),
                    lambda: edit.post("/api/templates/title-block-a3/revisions", {"footer_note": "x", "effective_date": "2030-01-01"}),
                    lambda: edit.post(f"/api/traces/{tid}/commands", {"command": "CIRCLE", "args": {"center": [0, 0], "radius": 5}})):
        r = attempt()
        assert r.status_code == 403 and r.json()["error"] == "forbidden", r.text
    r = Api(ws.base).get(f"/api/drawings/{ws.did}")
    assert r.status_code == 401 and r.json()["error"] == "unauthenticated"
    d = read(ws.api, ws.did)
    assert d["version"] == v0 + 1 and len(d["objects"]) == len(STUDIO_LINES) + 2


def test_link_expiry_studio_time(browser, app_url):
    zone_name = "America/New_York"
    zone = ZoneInfo(zone_name)
    ws = workspace(app_url, "studio-plan", time_zone=zone_name)
    set_clock(ws, datetime(2027, 1, 10, 12, 0, tzinfo=zone))
    r = ws.api.post(f"/api/drawings/{ws.did}/shares",
                    {"access": "view", "recipient_email": email_for("late"), "expiry_date": "2027-01-09"})
    assert r.status_code == 422 and r.json()["errors"]["expiry_date"] == "Choose today or a later date."
    s = share(ws, "view", expiry="2027-01-10")
    assert parse_time(s["expires_at"]) == datetime(2027, 1, 10, 23, 59, 59, tzinfo=zone) and s["time_zone"] == zone_name
    label = f"Expires {LINK_DAY:%b} {LINK_DAY.day}, {LINK_DAY.year}, 11:59 PM ({zone_name})"
    link = Api(ws.base, link=s["token"])
    info = link.get(f"/api/links/{s['token']}").json()
    assert info["status"] == "active" and info["expiry_label"] == label and info["time_zone"] == zone_name
    with tab(browser, app_url, f"/s/{s['token']}", skew=SKEW) as page:
        editor_ready(page)
        shows(page, page.get_by_role("status", name="Link"), label)
        set_clock(ws, datetime(2027, 1, 10, 20, 0, tzinfo=zone))
        assert link.get(f"/api/links/{s['token']}").status_code == 200
        set_clock(ws, datetime(2027, 1, 10, 23, 59, 58, tzinfo=zone))
        assert link.post(f"/api/drawings/{ws.did}/measure", {"first": [0, 0], "second": [1, 0]}).status_code == 200
        set_clock(ws, datetime(2027, 1, 10, 23, 59, 59, tzinfo=zone))
        r = link.get(f"/api/links/{s['token']}")
        assert r.status_code == 410 and r.json()["error"] == "link_expired"
        r = link.post(f"/api/drawings/{ws.did}/measure", {"first": [0, 0], "second": [1, 0]})
        assert r.status_code == 410 and r.json()["error"] == "link_expired"
        shows(page, page.get_by_role("heading", name="This link has expired."), None, LIVE_S + LIVE_SLACK_S)
    shares = ws.api.get(f"/api/drawings/{ws.did}/shares").json()["shares"]
    assert next(x for x in shares if x["id"] == s["id"])["status"] == "expired"


def test_revocation_live(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    gone_share, gone_api = holder(ws, "view", name="Rhea Vale")
    kept_share, kept_api = holder(ws, "view", name="Ola Brandt")
    with tab(browser, app_url, f"/s/{gone_share['token']}") as a, tab(browser, app_url, f"/s/{kept_share['token']}") as b:
        editor_ready(a)
        editor_ready(b)
        r = ws.api.post(f"/api/shares/{gone_share['id']}/revoke")
        assert r.status_code == 200 and r.json()["share"]["status"] == "revoked"
        assert ws.api.post(f"/api/shares/{gone_share['id']}/revoke").json()["share"]["status"] == "revoked"
        r = gone_api.get(f"/api/links/{gone_share['token']}")
        assert r.status_code == 410 and r.json()["error"] == "link_revoked"
        assert gone_api.post(f"/api/drawings/{ws.did}/measure", {"first": [0, 0], "second": [1, 0]}).status_code == 410
        shows(a, a.get_by_role("heading", name="This link was revoked by the owner."), None, LIVE_S + LIVE_SLACK_S)
        shows(b, b.get_by_role("status", name="Access"), "View only")
    assert kept_api.get(f"/api/links/{kept_share['token']}").status_code == 200
    r = Api(ws.base).get(f"/api/links/{UNKNOWN_TOKEN}")
    assert r.status_code == 404


def test_wf_share_links_phone_measure(browser, app_url, mail):
    ws = workspace(app_url, "studio-plan")
    reviewer = ws.reviewer["email"]
    s = share(ws, "view", email=reviewer, name=ws.reviewer["name"])
    assert ws.api.post(f"/api/shares/{s['id']}/invite").status_code == 200
    token = link_in(wait_mail(mail, reviewer)[0], "s")
    v0 = read(ws.api, ws.did)["version"]
    with tab(browser, app_url, f"/s/{token}", size=PHONE) as page:
        editor_ready(page)
        cdp = touch_session(page)
        shows(page, page.get_by_role("status", name="Access"), "View only")
        view = View(page, read(ws.api, ws.did))
        cmdbox(page).focus()
        submit(page, "L")
        shows(page, history(page), "This drawing is view-only.")
        cmdbox(page).focus()
        submit(page, "DI")
        x, y = view.at(0, 0)
        touch(cdp, x + 6, y - 5)
        prompt_is(page, "Specify second point:")
        x, y = view.at(6000, 0)
        touch(cdp, x - 6, y + 4)
        shows(page, announcements(page),
              "Distance = 6000.00, Angle in XY Plane = 0.00°, Delta X = 6000.00, Delta Y = 0.00 (millimeters)")
    assert read(ws.api, ws.did)["version"] == v0


def test_wf_share_links_edit_invite(browser, app_url, mail):
    ws = workspace(app_url, "studio-plan")
    recipient = email_for("editor")
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        page.get_by_role("button", name="Share").click()
        dialog = page.get_by_role("dialog", name="Share drawing")
        dialog.get_by_role("radio", name="Can edit").check()
        dialog.get_by_role("textbox", name="Recipient email").fill(recipient)
        dialog.get_by_role("textbox", name="Recipient name").fill("Ola Brandt")
        dialog.get_by_role("button", name="Send invite").click()
        shows(page, dialog, f"Invite sent to {recipient}")
    message = wait_mail(mail, recipient)[0]
    assert "Can edit" in mail_text(message)
    token = link_in(message, "s")
    with tab(browser, app_url, f"/s/{token}") as page:
        editor_ready(page)
        shows(page, page.get_by_role("status", name="Access"), "Can edit")
        cmdbox(page).focus()
        for line in ("L", "100,100", "@500,0"):
            submit(page, line)
        submit(page, "", wait_write=(ws.api, ws.did))
    assert any(o["type"] == "line" and near(o["start"], [100, 100]) and near(o["end"], [600, 100])
               for o in read(ws.api, ws.did)["objects"])


def test_grading_workspaces(app_url):
    a, b = workspace(app_url, "studio-plan"), workspace(app_url, "blank", units="m")
    assert a.id != b.id and a.did != b.did
    for ws in (a, b):
        assert ws.drafter["name"] == "Ines Halloran" and ws.reviewer["name"] == "Tomas Wren"
        assert ws.drafter["email"].endswith("@corbel-grading.test") and ws.reviewer["email"].endswith("@corbel-grading.test")
        assert ws.data["session"]["name"] == "corbel_session" and ws.drawing["name"] == "Plan A.dxf" and ws.drawing["version"] == 1
        assert ws.api.get("/api/me").json()["user"]["verified"] is True
    d = read(a.api, a.did)
    for h, (start, end) in STUDIO_LINES.items():
        o = obj(d, h)
        assert o["type"] == "line" and o["start"] == list(start) and o["end"] == list(end)
        assert o["color"] == "ByLayer" and o["linetype"] == "ByLayer" and o["lineweight"] == "ByLayer"
    circle = obj(d, "2B")
    assert circle["center"] == [4500, 2100] and circle["radius"] == 450 and circle["layer"] == "A-FURN"
    for name, (colour, linetype, on, frozen, locked) in STUDIO_LAYERS.items():
        l = layer(d, name)
        assert (l["color"], l["linetype"], l["on"], l["frozen"], l["locked"]) == (colour, linetype, on, frozen, locked)
    assert layer(d, "0")["current"] is True
    assert ok(a.api, a.did, "LINE", {"points": [[0, 0], [1, 1]], "close": False})["created"] == ["3B"]
    blank = read(b.api, b.did)
    assert blank["units"] == "m" and blank["objects"] == [] and [l["name"] for l in blank["layers"]] == ["0"]
    r = a.api.get(f"/api/drawings/{b.did}")
    assert r.status_code == 404 and r.json()["error"] == "not_found"
    base_b = server_now(b)
    target = datetime(2030, 6, 1, 12, 0, tzinfo=timezone.utc)
    set_clock(a, target)
    assert target <= server_now(a) < target + timedelta(minutes=1)
    assert abs((server_now(b) - base_b).total_seconds()) < timedelta(days=1).total_seconds(), "the clock is per workspace"
    assert Api(app_url).delete(f"/api/grading/workspaces/{a.id}/clock").status_code == 204
    assert abs((server_now(a) - base_b).total_seconds()) < timedelta(days=1).total_seconds()
    for body in ({"preset": "castle"}, {"preset": "blank", "time_zone": "Mars/Base"}, {"preset": "blank", "units": "ft"}):
        assert Api(app_url).post("/api/grading/workspaces", body).status_code == 422
    assert Api(app_url).put(f"/api/grading/workspaces/{a.id}/clock", {"now": "soon"}).status_code == 422


@pytest.mark.parametrize("mode", MOTION_MODES, ids=MOTION_MODES)
def test_hero_draw_in_and_header(browser, app_url, mode):
    reduced = mode == "reduce"
    with open_app(browser, app_url.rstrip("/") + "/api/health", reduced_motion=mode) as page:
        page.set_viewport_size(DESKTOP)
        page.add_init_script(MOTION_JS)
        page.goto(app_url.rstrip("/") + "/")
        start = page.get_by_role("link", name="Start drafting")
        shows(page, start)
        eventually(page, lambda: page.evaluate("() => document.readyState") == "complete", "landing loaded")
        advance(page, 2000)
        records = motion_records(page)
        paths = [m for m in records if m["tag"] == "path" and m["dur"] > INSTANT_MS]
        if reduced:
            assert paths == [], "wireframe paths show fully drawn on first paint"
        else:
            live = page.evaluate(
                "() => document.getAnimations().filter(a => a.effect && a.effect.target"
                " && a.effect.target.tagName.toLowerCase() === 'path').map(a => { const t = a.effect.getComputedTiming();"
                " return {dur: Number(t.duration) || 0, delay: Number(t.delay) || 0}; })")
            reveal = [m for m in paths + live if about(m["dur"], HERO_PATH_MS)]
            assert len(reveal) >= 3, f"hero paths reveal over 0.9 s: {paths[:5]} {live[:5]}"

            def median_step(xs: list[float]) -> float | None:
                steps = [b - a for a, b in zip(xs, xs[1:]) if b > a]
                return sorted(steps)[len(steps) // 2] if steps else None

            by_delay = median_step(sorted({round(m["delay"], 1) for m in reveal}))
            by_start = median_step(sorted(m["delay"] + m["at"] for m in paths if about(m["dur"], HERO_PATH_MS)))
            assert any(v is not None and about(v, HERO_STAGGER_MS) for v in (by_delay, by_start)), (
                f"0.04 s stagger: by delay {by_delay}, by start {by_start}")
            assert any(about(m["dur"], GRIP_POP_MS) for m in records), "endpoint grips grow over 0.16 s"
        banner = page.get_by_role("banner").filter(has=page.get_by_role("img", name="Corbel Works"))
        hidden_js = ("b => { for (let n = b; n; n = n.parentElement) { if (n.inert || n.getAttribute('aria-hidden') === 'true') return true; }"
                     " const s = getComputedStyle(b); return s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0"
                     " || b.getBoundingClientRect().bottom <= 0; }")
        header = page.get_by_role("banner", include_hidden=True).first
        assert header.evaluate(hidden_js), "the sticky account header is hidden and inert at the top"
        buttons = [start.bounding_box(), page.get_by_role("link", name="Open a shared drawing").first.bounding_box()]
        threshold = max(b["y"] + b["height"] for b in buttons)
        before = len(motion_records(page))
        page.evaluate(f"window.scrollTo(0, {threshold + 40})")
        eventually(page, lambda: len(motion_records(page)) > before or not header.evaluate(hidden_js), "header reacts")
        slide_in = [m for m in motion_records(page, header)[before:] if m["inside"]]
        if reduced:
            assert all(m["dur"] <= INSTANT_MS for m in slide_in)
        else:
            assert any(about(m["dur"], HEADER_IN_MS) for m in slide_in), f"0.2 s entry: {slide_in}"
            settle(header)
        eventually(page, lambda: not header.evaluate(hidden_js), "header shown once hero buttons scroll away")
        expect(banner.get_by_role("link", name="Create account")).to_be_visible()
        before = len(motion_records(page))
        page.evaluate("window.scrollTo(0, 0)")
        eventually(page, lambda: len(motion_records(page)) > before or header.evaluate(hidden_js), "header leaves")
        slide_out = [m for m in motion_records(page, header)[before:] if m["inside"]]
        if not reduced:
            assert any(about(m["dur"], HEADER_OUT_MS) for m in slide_out), f"0.15 s exit: {slide_out}"
            settle(header)
        eventually(page, lambda: header.evaluate(hidden_js), "header hidden and inert again")
        footer = page.get_by_role("contentinfo")
        footer.scroll_into_view_if_needed()
        advance(page, 1500)
        first_visit = len([m for m in motion_records(page) if m["tag"] == "path"])
        page.evaluate("window.scrollTo(0, 0)")
        advance(page, 500)
        footer.scroll_into_view_if_needed()
        advance(page, 1500)
        assert len([m for m in motion_records(page) if m["tag"] == "path"]) == first_visit, "constellations draw once"
        demo = page.get_by_role("region", name="Drafting demo")
        before = len(motion_records(page))
        demo.get_by_role("button", name="Play drafting demo").click()
        advance(page, 500)
        played = motion_records(page)[before:]
        if reduced:
            drawing = [m for m in motion_records(page, demo.get_by_role("img", name="Drafting demo"))[before:] if m["inside"]]
            assert all(m["dur"] <= INSTANT_MS for m in drawing), "the demo shows its final frame"
        else:
            assert played, "the demo plays an animation"
        assert all(m["iterations"] not in (None, math.inf) for m in motion_records(page)), "no decorative loops"


def test_landing_components_responsive(browser, app_url):
    titles = ["Command line first", "Markup that can't move a wall", "The same sheet everywhere"]
    for size in (DESKTOP, TABLET, PHONE):
        with tab(browser, app_url, "/", size=size) as page:
            hero = page.get_by_role("heading", level=1)
            shows(page, hero, "Draw the plan.")
            assert "Review the live sheet." in text_of(hero)
            shows(page, page.get_by_text("Command-line drafting and safe client markup in one browser tab."))
            shows(page, page.get_by_text("Free trial, no card needed. Already drafting with us?"))
            start = page.get_by_role("link", name="Start drafting")
            secondary = page.get_by_role("link", name="Open a shared drawing").first
            assert start.get_attribute("href").endswith("/signup") and secondary.get_attribute("href").endswith("/open")
            shows(page, page.get_by_role("img", name="Corbel Draft on a laptop, tablet and phone"))
            band = page.get_by_role("region", name="Drafting capability band")
            boxes = [band.get_by_text(t).first.bounding_box() for t in titles]
            if size is PHONE:
                assert boxes[0]["y"] < boxes[1]["y"] < boxes[2]["y"], "the band stacks into rows on phones"
                s, o = start.bounding_box(), secondary.bounding_box()
                assert s["y"] < o["y"] and abs(s["width"] - o["width"]) < 2, "hero buttons full-width and stacked"
            else:
                assert boxes[0]["x"] < boxes[1]["x"] < boxes[2]["x"], "three columns"
            demo = page.get_by_role("region", name="Drafting demo")
            shows(page, demo, "Every stroke lands where you typed it.")
            assert demo.get_by_role("button", name="Play drafting demo").count() == 1
            assert demo.get_by_role("img", name="Drafting demo").count() == 1
            shows(page, page.get_by_role("img", name="Corbel Draft editor preview"))
            shows(page, page.get_by_text("A full command set, in the browser you already have."))
            shows(page, page.get_by_role("region", name="Sheet sets"),
                  "Issue the sheet set. Keep every markup on the right revision.")
            footer = page.get_by_role("contentinfo")
            shows(page, footer, "© 2026 Corbel Works")
            assert footer.get_by_role("link", name="Command reference").count() == 1
            if size is DESKTOP:
                h, p = hero.bounding_box(), page.get_by_role("img", name="Corbel Draft on a laptop, tablet and phone").bounding_box()
                assert p["x"] > h["x"], "preview sits in the right column"
                for button in (start, secondary):
                    rest, hover = state_styles(button, "background-color", state="hover")
                    assert rest != hover, "hover changes the button fill"
                    rest, focus = state_styles(button, "outline-color", "outline-style", "box-shadow", state="focus")
                    assert rest != focus, "keyboard focus shows a ring"
            layout(page)


def test_wf_cross_cutting_phone_editor(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    s, _ = holder(ws, "view")
    for size in (DESKTOP, TABLET, PHONE):
        for path, session in (("/drawings", ws.session), (f"/d/{ws.did}", ws.session), (f"/s/{s['token']}", None)):
            with tab(browser, app_url, path, session=session, size=size) as page:
                shows(page, page.get_by_role("status", name="Announcements"))
                layout(page)
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session, size=PHONE) as page:
        editor_ready(page)
        for name in ("Tools", "Panels", "File actions"):
            box = page.get_by_role("button", name=name).bounding_box()
            assert box["width"] >= TOUCH_MIN_PX and box["height"] >= TOUCH_MIN_PX, f"{name} is a 44 px target"
        assert page.get_by_role("button", name="Undo", exact=True).is_visible()
        assert page.get_by_role("button", name="Redo", exact=True).is_visible()
        tap(page.get_by_role("button", name="File actions"))
        menu = page.get_by_role("menu")
        for item in ("Save as", "Print", "Share", "Learning material"):
            shows(page, menu.get_by_role("menuitem", name=item))
        page.keyboard.press("Escape")
        tap(page.get_by_role("button", name="Tools"))
        tools = page.get_by_role("dialog", name="Tools")
        shows(page, tools.get_by_role("tablist", name="Ribbon"))
        shows(page, tools.get_by_role("toolbar", name="Drafting aids"))
        page.keyboard.press("Escape")
        tap(page.get_by_role("button", name="Panels"))
        shows(page, page.get_by_role("dialog", name="Panels").get_by_role("tablist", name="Editor panels"))


def test_wf_cross_cutting_keyboard_dialogs(browser, app_url):
    ws = workspace(app_url, "studio-plan")

    def trapped(page: Page, dialog: Locator) -> None:
        eventually(page, lambda: focused_inside(dialog), "focus moves into the dialog")
        for key in ["Tab"] * 12 + ["Shift+Tab"] * 12:
            page.keyboard.press(key)
            assert focused_inside(dialog), f"{key} kept focus inside {dialog}"
        page.keyboard.press("Escape")
        gone(page, dialog, "Escape closes the dialog")

    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session) as page:
        editor_ready(page)
        for opener, name in (("Share", "Share drawing"), ("Save as", "Save as"), ("Print", "Export")):
            button = page.get_by_role("button", name=opener, exact=True)
            button.focus()
            page.keyboard.press("Enter")
            trapped(page, page.get_by_role("dialog", name=name))
            expect(button).to_be_focused()
        cmdbox(page).focus()
        page.keyboard.press("Control+p")
        trapped(page, page.get_by_role("dialog", name="Export"))
        expect(cmdbox(page)).to_be_focused()
        page.get_by_role("button", name="Share").focus()
        page.keyboard.press("F1")
        trapped(page, page.get_by_role("dialog", name="Command reference"))
        page.get_by_role("button", name="Share").focus()
        page.keyboard.press("F8")
        expect(page.get_by_role("toolbar", name="Drafting aids").get_by_role("button", name="ORTHO")).to_have_attribute("aria-pressed", "true")
    with tab(browser, app_url, "/drawings", session=ws.session) as page:
        opener = page.get_by_role("button", name="Get Pro for $12/month")
        opener.focus()
        page.keyboard.press("Enter")
        trapped(page, page.get_by_role("dialog", name="Corbel Draft Pro"))
        expect(opener).to_be_focused()
    with tab(browser, app_url, f"/d/{ws.did}", session=ws.session, size=PHONE) as page:
        editor_ready(page)
        opener = page.get_by_role("button", name="Tools")
        opener.focus()
        page.keyboard.press("Enter")
        trapped(page, page.get_by_role("dialog", name="Tools"))
        expect(opener).to_be_focused()


@pytest.mark.timeout(600)
@pytest.mark.parametrize("kind", OUTAGE_KINDS, ids=OUTAGE_KINDS)
def test_boot_outage_and_recovery(browser, kind, mail, valkey):
    relay, overrides = provider_relay(kind)
    try:
        with app_copy(overrides) as (base, tail):
            r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
            assert r.status_code == 200 and r.json() == {"status": "unavailable"}, tail()
            page_r = httpx.get(base + "/", timeout=HTTP_TIMEOUT_S)
            assert page_r.status_code == 200 and "application/json" not in page_r.headers.get("content-type", "")
            ws = workspace(base, "studio-plan")
            root = root_folder(ws)
            with tab(browser, base, f"/d/{ws.did}", session=ws.session) as page:
                editor_ready(page)
                banner = page.get_by_role("status", name="Service status")
                if kind == "minio":
                    r = ws.api.upload(root, f"Down {tag()}.dxf", dxf_file())
                    assert r.status_code == 503 and r.json()["error"] == "storage_unavailable"
                    shows(page, banner, "File storage is unavailable. Uploads and exports are paused until it returns.")
                elif kind == "valkey":
                    assert run(ws.api, ws.did, "ERASE", {"handles": ["3A"]}).status_code == 200, "saves land in Postgres"
                    shows(page, sync(page), "Live sync paused")
                    shows(page, banner, "Live sync is paused. Your edits still save; reload to see changes from other tabs.")
                else:
                    r = ws.api.post("/api/quotes", {})
                    assert r.status_code == 503 and r.json()["error"] == "mail_unavailable"
                relay.start()
                poll(lambda: httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json(),
                     lambda h: h == {"status": "ok"}, f"health turns ok after {kind} returns; log:\n{tail()}",
                     RECOVER_S + RETRY_SLACK_S)
                if kind == "valkey":
                    shows(page, sync(page), re.compile(r"Synced · v\d+"), RECOVER_S + RETRY_SLACK_S)
                    page.mouse.move(400, 400)
                    poll(lambda: valkey.members(f"presence:{ws.did}"), bool, "presence resumes in Valkey", UI_WAIT_S)
            if kind == "minio":
                name = f"Back {tag()}.dxf"
                data = dxf_file()
                r = ws.api.upload(root, name, data)
                assert r.status_code == 201, r.text
                assert S3().get(f"drawings/{r.json()['drawing']['id']}/v1.dxf") == data
            elif kind == "mailpit":
                assert ws.api.post("/api/quotes", {}).status_code == 201
                assert wait_mail(mail, ws.drafter["email"])[0].get("Subject") == "Your Corbel Draft Pro quote"
    finally:
        relay.stop()


def test_server_boundary(app_url):
    ws = workspace(app_url, "blank")
    root = root_folder(ws)
    http = httpx.Client(timeout=HTTP_TIMEOUT_S)
    base = app_url.rstrip("/")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/src/server.ts", "/tsconfig.json"):
        r = http.get(base + path)
        assert r.status_code != 200 or ("application/json" not in r.headers.get("content-type", "")
                                        and "run-manifest-v1" not in r.text), path
    secrets = [v for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "S3_ENDPOINT", "VALKEY_URL")
               if (v := os.environ.get(k)) and len(v) >= 8]
    index = http.get(base + "/").text
    assets = {a for a in re.findall(r'(?:src|href)="([^"]+)"', index) if a.startswith("/") and not urlparse(a).netloc}
    bodies = [index] + [http.get(base + a).text for a in sorted(assets)[:40]]
    bodies += [ws.api.get(p).text for p in ("/api/me", f"/api/drawings/{ws.did}", "/api/support-files")]
    for body in bodies:
        for secret in secrets:
            assert secret not in body, "provider credentials never reach the browser"
    evil = Api(base, session=ws.session, origin="http://evil.invalid")
    name = f"Cross {tag()}"
    assert not evil.post("/api/folders", {"parent_id": root, "name": name}).is_success
    assert all(i["name"] != name for i in listing(ws.api, root)), "cross-origin writes have no effect"

    def sized(n: int) -> bytes:
        shell = json.dumps({"parent_id": root, "name": ""})
        return json.dumps({"parent_id": root, "name": "x" * (n - len(shell))}).encode()

    r = ws.api.raw("/api/folders", sized(JSON_MAX + 1), "application/json")
    assert r.status_code == 413 and r.json()["error"] == "body_too_large"
    r = ws.api.raw("/api/folders", sized(JSON_MAX), "application/json")
    assert r.status_code == 422, "a body of exactly the limit is read"
    r = ws.api.raw("/api/folders", b"{not json", "application/json")
    assert r.status_code == 400 and r.json()["error"] == "bad_request"
    r = ws.api.raw("/api/folders", b"name=x", "text/plain")
    assert r.status_code == 400 and r.json()["error"] == "bad_request"
    r = Api(base).get("/api/me")
    assert r.status_code == 401 and r.json()["error"] == "unauthenticated"


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing[:20]}"
    assert "Fira Sans" in notices and "Lucide" in notices


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"packages outside the licence allowlist: {bad[:20]}"


def test_if_only_published_datastores():
    stores = {"sqlite3", "better-sqlite3", "sql.js", "mongodb", "mongoose", "mysql", "mysql2", "lowdb", "nedb",
              "level", "lmdb", "@libsql/client"}
    assert not stores & {p.name for p in shipped_packages()}
    found = []
    for path in Path(DEPLOYED_APP).rglob("*"):
        if "node_modules" in path.parts or len(found) > 5:
            continue
        if path.suffix in (".sqlite", ".sqlite3", ".db"):
            found.append(str(path))
    assert not found, f"local database files: {found}"


def test_if_seeded_config_unchanged(app_url):
    app = Path("/app")
    roots = subprocess.run(["git", "-C", str(app), "rev-list", "--max-parents=0", "HEAD"], capture_output=True, text=True)
    if roots.returncode == 0 and roots.stdout.strip():
        first = roots.stdout.split()[0]
        files = subprocess.run(["git", "-C", str(app), "ls-tree", "-r", "--name-only", first],
                               capture_output=True, text=True).stdout.split()
        seeded = [f for f in files if re.search(r"(^|/)(\.env[^/]*|[^/]*compose[^/]*\.ya?ml)$", f)]
        for f in seeded:
            diff = subprocess.run(["git", "-C", str(app), "diff", "--quiet", first, "--", f])
            assert diff.returncode == 0, f"seeded configuration {f} was changed"
    assert httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}


def test_if_no_third_party_origins(browser, app_url):
    ws = workspace(app_url, "studio-plan")
    origin = origin_of(app_url)
    for path in ("/", "/signin", "/drawings", f"/d/{ws.did}"):
        with tab(browser, app_url, "/open", session=ws.session) as page:
            urls: list[str] = []
            page.on("request", lambda req: urls.append(req.url))
            page.goto(origin + path)
            eventually(page, lambda: page.evaluate("() => document.readyState") == "complete", "page loaded")
            advance(page, 1000)
            foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, origin)]
            assert not foreign, f"{path} loaded third-party resources: {foreign[:5]}"


def test_if_exports_in_process(app_url):
    converters = {"puppeteer", "puppeteer-core", "playwright", "playwright-core", "html-pdf", "wkhtmltopdf",
                  "phantomjs-prebuilt", "libreoffice-convert"}
    assert not converters & {p.name for p in shipped_packages()}
    ws = workspace(app_url, "studio-plan")
    ex = export(ws.api, ws.did, "pdf", "Layout1")
    assert ex["state"] == "stored" and download(ws.api, ex).startswith(b"%PDF")


def test_if_lockfile_used():
    assert (Path("/app") / "package-lock.json").is_file()
    install = json.loads(Path("/app/run.json").read_text())["install"]
    assert re.search(r"\bnpm (ci|install)\b", install), install
