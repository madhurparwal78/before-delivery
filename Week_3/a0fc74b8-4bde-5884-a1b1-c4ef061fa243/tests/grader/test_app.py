from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import uuid
import zlib
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    S3,
    Mailpit,
    addresses,
    advance,
    animations,
    axe,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    tap,
    text,
)


GRADING_KEY = os.environ.get("GRADING_KEY", "")
STORAGE_DOWN_URL = os.environ.get("APP_STORAGE_DOWN_URL", "").rstrip("/")
MAIL_DOWN_URL = os.environ.get("APP_MAIL_DOWN_URL", "").rstrip("/")
SHORT_URL = os.environ.get("APP_SHORT_URL", "").rstrip("/")
APP_ROOT = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")

APP_WIDTHS = {"375": (375, 812), "768": (768, 1024), "1280": (1280, 800)}
WIDTH_IDS = ["375", "768", "1280"]

HTTP_TIMEOUT_S = 180
STEP_MS = 100
POLL_MS = 250
LOAD_S = 25
MAIL_WAIT_S = 30
LIVE_SLACK_S = 1
CLOCK_SLACK_S = 1
RETRY_SLACK_S = 5
TURN_SLACK_S = 1
PX_TOL = 1
SETTLE_PX = 0.01
TAB_PRESSES = 7
WHEEL_STEPS = 80
WHEEL_PX = 120
TALL_VIEWPORT_PX = 1800
TAB_LIMIT = 60
FILL_SHARE = 0.9
PAST_EDGE = 0.05

GEOM_TOL = 0.01
STEP = 0.005
BIG_STEP = 0.05
MIN_SIZE = 0.02
DEFAULT_SIZE = {"signature": (0.30, 0.06), "initials": (0.10, 0.05), "date": (0.20, 0.04), "text": (0.30, 0.04)}

UPLOAD_LIMIT = 25_000_000
JSON_LIMIT = 1_000_000
PAGE_LIMIT = 60
TEXT_LIMIT = 200
REASON_LIMIT = 500
TYPED_LIMIT = 100
STROKE_POINT_LIMIT = 5000
TAP_MIN_PX = 44
PAD_MIN_PX = 140

APERTURE_MIN_MS = 300
APERTURE_MAX_MS = 450
PANEL_MIN_MS = 250
PANEL_MAX_MS = 350
MOTION_WINDOW_MS = 700
FRAME_MS = 16
SAMPLE_SLACK_MS = 60
FIELD_TOP_MIN = 0.30
FIELD_TOP_MAX = 0.40

LIVE_S = 3
SAVE_S = 2
EXPIRY_CHECK_S = 2
HEALTH_CHECK_S = 10
RETRY_S = 30
RETRY_MAX_S = 63
SHORT_TTL_S = 8
SHORT_COOLDOWN_S = 4
DEFAULT_TTL = timedelta(days=14)
ZERO_HASH = "0" * 64

AUDIT_TYPES = {
    "document.created", "document.sent", "invite.sent", "invite.held", "recipient.viewed",
    "recipient.signed", "recipient.declined", "document.voided", "reminder.sent", "link.resent",
    "document.sealed", "document.completed",
}


def tag() -> str:
    return uuid.uuid4().hex[:10]


def person(first: str, last: str, role: str) -> dict[str, str]:
    t = tag()
    return {
        "email": f"{first}.{last}.{t}@fenwick-lane.example".lower(),
        "name": f"{first} {last}",
        "password": f"Ledger-{t}-pw",
        "role": role,
    }


def signer(first: str, last: str) -> dict[str, str]:
    return {"name": f"{first} {last}", "email": f"{first}.{last}.{tag()}@harbour-row.example".lower()}


def fld(recipient: int, kind: str, page: int, x: float, y: float, w: float, h: float, required: bool = True) -> dict[str, Any]:
    return {"recipient": recipient, "kind": kind, "page": page, "x": x, "y": y, "w": w, "h": h, "required": required}


def document(title: str, owner: dict[str, str], recipients: list[dict[str, str]], fields: list[dict[str, Any]], *,
             state: str = "draft", signed: int = 0, sample: str = "letter-1", tz: str = "UTC") -> dict[str, Any]:
    return {"title": title, "owner": owner["email"], "sample": sample, "timeZone": tz, "recipients": recipients,
            "fields": fields, "state": state, "signed": signed}


class World:
    def __init__(self, body: dict[str, Any]) -> None:
        self.team_id = body["teams"][0]["id"]
        self.users = {u["email"]: u["id"] for u in body["users"]}
        self.docs = {d["title"]: d["id"] for d in body["documents"]}


def seed(base: str, members: list[dict[str, str]], documents: list[dict[str, Any]] | tuple = ()) -> World:
    team = f"Fenwick Lane Studio {tag()}"
    body = {"teams": [{"name": team, "members": members}], "documents": [{**d, "team": team} for d in documents]}
    r = httpx.post(f"{base}/api/grading/setup", json=body, headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, f"POST /api/grading/setup answered {r.status_code}: {r.text[:500]}"
    return World(r.json())


def sample_pdf(base: str, name: str) -> bytes:
    r = httpx.get(f"{base}/api/grading/samples/{name}", headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.content.startswith(b"%PDF-"), f"GET /api/grading/samples/{name} answered {r.status_code}"
    return r.content


def make_pdf(pages: int = 1, *, rotate: int = 0, encrypt: bool = False, script: bool = False, size: int | None = None) -> bytes:
    note = tag()

    def build(pad: int) -> bytes:
        objects: list[str] = []
        font = 3 + 2 * pages
        catalog = "<< /Type /Catalog /Pages 2 0 R"
        if script:
            catalog += f" /OpenAction {font + 1} 0 R"
        objects.append(catalog + " >>")
        kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(pages))
        objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>")
        for i in range(pages):
            rot = f" /Rotate {rotate}" if rotate else ""
            objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]{rot} "
                           f"/Resources << /Font << /F1 {font} 0 R >> >> /Contents {4 + 2 * i} 0 R >>")
            content = f"BT /F1 24 Tf 72 700 Td (Probe {note} page {i + 1}) Tj ET"
            objects.append(f"<< /Length {len(content)} >>\nstream\n{content}\nendstream")
        objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        if script:
            objects.append("<< /S /JavaScript /JS (app.alert\\(1\\)) >>")
        if encrypt:
            objects.append("<< /Filter /Standard /V 1 /R 2 /O <" + "a" * 64 + "> /U <" + "b" * 64 + "> /P -4 >>")
        out = bytearray(b"%PDF-1.4\n")
        if pad:
            out += b"%" + b"0" * (pad - 2) + b"\n"
        offsets = []
        for n, body in enumerate(objects, 1):
            offsets.append(len(out))
            out += f"{n} 0 obj\n{body}\nendobj\n".encode("latin-1")
        xref = len(out)
        out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
        for off in offsets:
            out += f"{off:010d} 00000 n \n".encode()
        trailer = f"<< /Size {len(objects) + 1} /Root 1 0 R"
        if encrypt:
            trailer += f" /Encrypt {len(objects)} 0 R /ID [<{note}{note}> <{note}{note}>]"
        out += f"trailer\n{trailer} >>\nstartxref\n{xref}\n%%EOF\n".encode()
        return bytes(out)

    data = build(0)
    if size is None:
        return data
    pad = size - len(data)
    for _ in range(6):
        data = build(pad)
        if len(data) == size:
            return data
        pad += size - len(data)
    raise AssertionError("could not size the probe PDF exactly")


class Api:
    def __init__(self, base: str) -> None:
        self.base = base
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S, follow_redirects=False)

    def login(self, user: dict[str, str]) -> "Api":
        r = self.http.post("/api/session", json={"email": user["email"], "password": user["password"]})
        assert r.status_code == 200, f"POST /api/session for {user['email']} answered {r.status_code}: {r.text[:300]}"
        return self

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.get(path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.http.post(path, json=body, **kw) if body is not None else self.http.post(path, **kw)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)

    def doc(self, doc_id: str) -> dict[str, Any]:
        r = self.get(f"/api/documents/{doc_id}")
        assert r.status_code == 200, f"GET /api/documents/{doc_id} answered {r.status_code}: {r.text[:300]}"
        return r.json()

    def audit(self, doc_id: str) -> list[dict[str, Any]]:
        r = self.get(f"/api/documents/{doc_id}/audit")
        assert r.status_code == 200, f"GET /api/documents/{doc_id}/audit answered {r.status_code}"
        return r.json()["events"]

    def upload(self, data: bytes, name: str, title: str | None = None, mime: str = "application/pdf") -> httpx.Response:
        form = {"title": title} if title else {}
        return self.http.post("/api/documents", files={"file": (name, data, mime)}, data=form)


class Link:
    def __init__(self, base: str, token: str) -> None:
        self.base = base
        self.token = token
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)

    def state(self) -> httpx.Response:
        return self.http.get(f"/api/sign/{self.token}")

    def put(self, field_id: str, body: Any) -> httpx.Response:
        return self.http.put(f"/api/sign/{self.token}/fields/{field_id}", json=body)

    def finish(self) -> httpx.Response:
        return self.http.post(f"/api/sign/{self.token}/finish")

    def decline(self, reason: str) -> httpx.Response:
        return self.http.post(f"/api/sign/{self.token}/decline", json={"reason": reason})

    def original(self) -> httpx.Response:
        return self.http.get(f"/api/sign/{self.token}/original.pdf")

    def completed(self) -> httpx.Response:
        return self.http.get(f"/sign/{self.token}/completed.pdf")

    def fill_all(self, name: str) -> None:
        r = self.state()
        assert r.status_code == 200, f"GET /api/sign/<token> answered {r.status_code}"
        for f in r.json()["fields"]:
            if f["kind"] in ("signature", "initials"):
                put = self.put(f["id"], {"typed": name})
            elif f["kind"] == "text":
                put = self.put(f["id"], {"value": name})
            else:
                continue
            assert put.status_code == 200, f"PUT field {f['label']} answered {put.status_code}: {put.text[:200]}"

    def sign(self, name: str) -> dict[str, Any]:
        self.fill_all(name)
        r = self.finish()
        assert r.status_code == 200, f"POST /api/sign/<token>/finish answered {r.status_code}: {r.text[:200]}"
        return r.json()


def field_value(link: Link, field_id: str) -> Any:
    for f in link.state().json()["fields"]:
        if f["id"] == field_id:
            return f["value"]
    raise AssertionError(f"field {field_id} missing from GET /api/sign/<token>")


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))
    results: list[httpx.Response | None] = [None] * len(calls)

    def run(i: int, fn: Callable[[], httpx.Response]) -> None:
        barrier.wait(timeout=HTTP_TIMEOUT_S)
        results[i] = fn()

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=HTTP_TIMEOUT_S)
    assert all(r is not None for r in results), "a simultaneous request never returned"
    return [r for r in results if r is not None]


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def mails(mail: Mailpit, address: str, subject: str | None = None) -> list[dict[str, Any]]:
    found = []
    for m in mail.messages():
        to = [a.lower() for a in addresses(m.get("To"))]
        if address.lower() in to and (subject is None or m.get("Subject") == subject):
            found.append(m)
    return found


def await_mail(mail: Mailpit, address: str, subject: str, expected: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        found = mails(mail, address, subject)
        if len(found) >= expected:
            return found
    pytest.fail(f"Mailpit received {len(found)} message(s) {subject!r} for {address}; expected {expected}")


def token_of(message: dict[str, Any]) -> str:
    m = re.search(r"Open the document: \S*/sign/([^\s/]+)", text(message))
    assert m, f"no 'Open the document:' line with a /sign/<token> link in: {text(message)[:300]}"
    return m.group(1)


def invite_token(mail: Mailpit, address: str, title: str) -> str:
    return token_of(await_mail(mail, address, f"Please sign: {title}")[0])


@contextmanager
def browse(browser: Browser, base: str, path: str, *, user: dict[str, str] | None = None,
           viewport: tuple[int, int] = APP_WIDTHS["1280"], touch: bool = False, reduced: bool = False,
           shift: timedelta | None = None) -> Iterator[Page]:
    with open_app(browser, f"{base}/api/health", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        if touch:
            session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        if shift is not None:
            page.clock.set_system_time(datetime.now(timezone.utc) + shift)
        if user is not None:
            api = Api(base).login(user)
            page.context.add_cookies([{"name": c.name, "value": c.value, "url": base} for c in api.http.cookies.jar])
        page.goto(f"{base}{path}")
        yield page


def eventually(page: Page | None, check: Callable[[], Any], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        if page is not None:
            advance(page, STEP_MS)
        try:
            check()
            return
        except AssertionError as exc:
            last = exc
    pytest.fail(f"{what} (last check: {last})")


def visible(page: Page, locator: Any, what: str, seconds: float = LOAD_S) -> None:
    eventually(page, lambda: expect(locator).to_be_visible(timeout=POLL_MS), seconds, what)


def focused(page: Page, element_id: str) -> bool:
    return page.evaluate("id => { const e = document.getElementById(id); return !!e && e.contains(document.activeElement); }", element_id)


def active_id(page: Page) -> str:
    return page.evaluate("() => document.activeElement ? document.activeElement.id : ''")


REL_BOX_JS = """([a, b]) => { const e = document.getElementById(a), p = document.getElementById(b);
  if (!e || !p) return null; const r = e.getBoundingClientRect(), q = p.getBoundingClientRect();
  return {x: (r.left - q.left) / q.width, y: (r.top - q.top) / q.height, w: r.width / q.width, h: r.height / q.height}; }"""


def rel_box(page: Page, element_id: str, page_no: int) -> dict[str, float] | None:
    return page.evaluate(REL_BOX_JS, [element_id, f"page-{page_no}"])


def assert_box(box: dict[str, float] | None, f: dict[str, Any], what: str) -> None:
    assert box is not None, f"{what}: element or its page-<n> group is missing"
    for k in ("x", "y", "w", "h"):
        assert abs(box[k] - f[k]) <= GEOM_TOL, f"{what}: {k} renders {box[k]:.4f}, stored {f[k]:.4f}"


def top_in_band(page: Page, element_id: str, what: str) -> None:
    def check() -> None:
        top = page.evaluate("id => document.getElementById(id).getBoundingClientRect().top / window.innerHeight", element_id)
        assert FIELD_TOP_MIN <= top <= FIELD_TOP_MAX, f"{what} top at {top:.3f} of the viewport"

    eventually(page, check, LOAD_S, f"{what} top settles between 30% and 40% of the viewport height")


def in_view(locator: Any, viewport: tuple[int, int]) -> bool:
    if not locator.count() or not locator.is_visible():
        return False
    box = locator.bounding_box()
    if not box:
        return False
    return box["x"] < viewport[0] and box["y"] < viewport[1] and box["x"] + box["width"] > 0 and box["y"] + box["height"] > 0


def crosses_middle(page: Page, n: int) -> bool:
    return page.evaluate("n => { const r = document.getElementById('page-' + n).getBoundingClientRect(), m = window.innerHeight / 2;"
                         " return r.top <= m && r.bottom >= m; }", n)


def tab_to(page: Page, locator: Any, what: str) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if locator.evaluate("e => e === document.activeElement"):
            return
    pytest.fail(f"{what} is not reachable by Tab")


def on_screen(page: Page, locator: Any, what: str) -> None:
    def check() -> None:
        box, size = locator.bounding_box(), page.viewport_size
        assert box and size and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= size["width"] \
            and box["y"] + box["height"] <= size["height"], f"{what} at {box}"

    eventually(page, check, LOAD_S, f"{what} is fully on screen once the panel or sheet stops moving")


def focus_lands(page: Page, locator: Any) -> None:
    eventually(page, lambda: expect(locator).to_be_focused(timeout=POLL_MS), LOAD_S, "focus lands on the expected control")


def scroll_settled(page: Page) -> list[float]:
    held: dict[str, Any] = {}

    def check() -> None:
        pos = page.evaluate("() => [window.scrollX, window.scrollY]")
        advance(page, MOTION_WINDOW_MS)
        assert pos == page.evaluate("() => [window.scrollX, window.scrollY]"), "the page is still scrolling"
        held["pos"] = pos

    eventually(page, check, LOAD_S, "the page scroll settles")
    return held["pos"]


def position_copy(label: str, page_no: int, x: float, y: float, w: float, h: float) -> str:
    return f"{label}: page {page_no}, x {x:.3f}, y {y:.3f}, width {w:.3f}, height {h:.3f}"


def progress_copy(i: int, n: int, label: str, page_no: int) -> str:
    return f"Field {i} of {n}: {label}, page {page_no}"


def left_copy(n: int) -> str:
    return f"{n} left"


def counter_copy(n: int, limit: int) -> str:
    return f"{n} of {limit} characters"


def required_total(fields: list[dict[str, Any]]) -> int:
    return sum(1 for f in fields if f["required"] and f["kind"] != "date")


def page_group(page: Page, n: int, count: int) -> Any:
    return page.get_by_role("group", name=f"Page {n} of {count}", exact=True)


APERTURE_ID = "aperture"


def by_id(page: Page, element_id: str) -> Any:
    return page.locator(f'[id="{element_id}"]')


def touch_tap(page: Page, x: float, y: float) -> None:
    cdp = session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def touch_stroke(page: Page, box: dict[str, float], steps: int = 8) -> None:
    cdp = session(page)
    x0, y0 = box["x"] + box["width"] * 0.2, box["y"] + box["height"] * 0.5
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
    for i in range(1, steps + 1):
        point = {"x": x0 + box["width"] * 0.6 * i / steps, "y": y0 + (-1) ** i * box["height"] * 0.15}
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [point]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def mouse_stroke(page: Page, box: dict[str, float], steps: int = 8) -> None:
    x0, y0 = box["x"] + box["width"] * 0.2, box["y"] + box["height"] * 0.5
    page.mouse.move(x0, y0)
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(x0 + box["width"] * 0.6 * i / steps, y0 + (-1) ** i * box["height"] * 0.15)
    page.mouse.up()


def drag(page: Page, x0: float, y0: float, x1: float, y1: float) -> None:
    page.mouse.move(x0, y0)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10)
    page.mouse.up()


def await_fields(api: Api, doc_id: str, count: int, page: Page | None) -> list[dict[str, Any]]:
    holder: dict[str, Any] = {}

    def check() -> None:
        fs = api.doc(doc_id)["fields"]
        assert len(fs) == count, f"{len(fs)} field(s)"
        holder["fields"] = fs

    eventually(page, check, SAVE_S + LIVE_SLACK_S, f"GET /api/documents/<id> lists {count} field(s) within 2 s")
    return holder["fields"]


def await_field(api: Api, doc_id: str, field_id: str, view: Page | None, what: str, **expected: Any) -> dict[str, Any]:
    holder: dict[str, Any] = {}

    def check() -> None:
        f = next((x for x in api.doc(doc_id)["fields"] if x["id"] == field_id), None)
        assert f is not None, "field gone"
        for k, v in expected.items():
            if isinstance(v, float):
                assert abs(f[k] - v) <= GEOM_TOL, f"{k}={f[k]}, expected {v}"
            else:
                assert f[k] == v, f"{k}={f[k]}, expected {v}"
        holder["f"] = f

    eventually(view, check, SAVE_S + LIVE_SLACK_S, what)
    return holder["f"]


def adopt_with_dialog(page: Page, field_id: str) -> None:
    by_id(page, f"field-{field_id}").focus()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name=re.compile(r"^Adopt your (signature|initials)$"))
    visible(page, dialog, "Enter on an empty signature field opens the Adopt dialog")
    dialog.get_by_role("button", name="Adopt and sign").click()
    eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "Adopt and sign closes the dialog")


def _true(cond: bool, msg: str = "condition not met") -> None:
    assert cond, msg


def fill_in_view(page: Page, link: Link, name: str) -> None:
    for f in link.state().json()["fields"]:
        if f["kind"] in ("signature", "initials") and f["value"] is None:
            visible(page, by_id(page, f"field-{f['id']}"), f"field {f['label']} in the signer view")
            by_id(page, f"field-{f['id']}").focus()
            page.keyboard.press("Enter")

            def adopted(fid: str = f["id"]) -> None:
                d = page.get_by_role("dialog", name=re.compile(r"^Adopt your (signature|initials)$"))
                if d.count() and d.is_visible():
                    d.get_by_role("button", name="Adopt and sign").click()
                assert field_value(link, fid) is not None, "value not stored"

            eventually(page, adopted, LOAD_S, f"field {f['label']} gets a value from the signer view")
        elif f["kind"] == "text" and f["value"] is None:
            box = by_id(page, f"field-{f['id']}")
            visible(page, box, f"text field {f['label']} in the signer view")
            box.focus()
            page.keyboard.insert_text(name)
            page.keyboard.press("Tab")
            eventually(page, lambda fid=f["id"]: _true(field_value(link, fid) == name), SAVE_S + LIVE_SLACK_S,
                       f"text field {f['label']} saves when focus leaves it")


def order_row(page: Page, order: int, name: str) -> Any:
    return page.get_by_role("list", name="Signing order").get_by_role("listitem").filter(has_text=f"{order}. {name}")


def doc_row(page: Page, title: str) -> Any:
    return page.get_by_role("table", name="Documents").get_by_role("row").filter(
        has=page.get_by_role("link", name=title, exact=True))


RECT_JS = "e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }"
SEEK_ALL_JS = """(e, [n, frame]) => {
  const end = a => a.effect.getComputedTiming().endTime;
  const own = e.getAnimations({subtree: true});
  for (let up = e.parentElement; up; up = up.parentElement) own.push(...up.getAnimations());
  const anims = own.filter(a => Number.isFinite(end(a)) && a.playState !== 'finished');
  if (!anims.length) return null;
  const back = a => a.playbackRate < 0;
  const saved = anims.map(a => [a, a.currentTime ?? 0, a.playState === 'paused']);
  const from = new Map(saved.map(([a, now]) => [a, now]));
  const total = Math.max(...anims.map(a => (back(a) ? from.get(a) : end(a))));
  const at = t => { anims.forEach(a => { a.pause(); a.currentTime = back(a) ? Math.max(from.get(a) - t, 0) : Math.min(t, end(a)); });
    const r = e.getBoundingClientRect(); return [t, r.left, r.top, r.width, r.height]; };
  const out = total <= frame ? [at(0), at(total)] : Array.from({length: n + 1}, (_, i) => at(total * i / n));
  saved.forEach(([a, now, paused]) => { a.currentTime = now; if (!paused) a.play(); });
  return out;
}"""


def path_of(locator: Any, window_ms: float = MOTION_WINDOW_MS, samples: int = 28) -> list[tuple[float, ...]]:
    page = locator.page
    step = window_ms / (samples - 1)
    element = locator.element_handle()
    path = [(0.0, *element.evaluate(RECT_JS))]
    for i in range(1, samples):
        seeked = element.evaluate(SEEK_ALL_JS, [samples - 1, FRAME_MS])
        if seeked:
            return [tuple(float(v) for v in s) for s in seeked]
        page.clock.run_for(round(step))
        path.append((step * i, *element.evaluate(RECT_JS)))
    return path


def settle_time(pts: list[tuple[float, ...]]) -> float:
    end = pts[-1]
    settled = end[0]
    for p in reversed(pts):
        if all(abs(p[i] - end[i]) <= SETTLE_PX for i in range(1, 5)):
            settled = p[0]
        else:
            break
    return settled - pts[0][0]


def in_between(pts: list[tuple[float, ...]]) -> list[tuple[float, ...]]:
    start, end = pts[0], pts[-1]
    return [p for p in pts[1:-1]
            if any(min(start[i], end[i]) + PX_TOL < p[i] < max(start[i], end[i]) - PX_TOL for i in range(1, 5))]


def choose_file(page: Page, name: str, data: bytes, mime: str = "application/pdf") -> None:
    with page.expect_file_chooser() as chooser:
        page.get_by_role("button", name="Upload PDF").click()
    chooser.value.set_files({"name": name, "mimeType": mime, "buffer": data})


def test_wf_upload_pages_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    seed(base, [owner])
    data = sample_pdf(base, "letter-3")
    title = f"Harbour lease {tag()}"
    with browse(browser, base, "/documents", user=owner) as page:
        visible(page, page.get_by_role("heading", name="Documents", level=1), "documents heading")
        choose_file(page, f"{title}.pdf", data)
        holder: dict[str, str] = {}

        def opened() -> None:
            m = re.search(r"/documents/([0-9a-fA-F-]{36})(?:[?#].*)?$", page.url)
            assert m, f"still on {page.url}"
            holder["id"] = m.group(1)

        eventually(page, opened, LOAD_S, "Upload PDF opens the new draft's document page")
        doc_id = holder["id"]
        visible(page, page.get_by_role("heading", name=title, level=1), "document heading is the file name without .pdf")
        nav = page.get_by_role("navigation", name="Pages")
        for n in (1, 2, 3):
            group = page.get_by_role("group", name=f"Page {n} of 3", exact=True)
            visible(page, group, f"group 'Page {n} of 3'")
            assert group.get_attribute("id") == f"page-{n}"
            visible(page, nav.get_by_role("button", name=f"Page {n}", exact=True), f"filmstrip button 'Page {n}'")
    api = Api(base).login(owner)
    d = api.doc(doc_id)
    assert d["status"] == "draft" and d["pageCount"] == 3 and d["title"] == title
    assert d["originalSha256"] == hashlib.sha256(data).hexdigest()
    assert S3().get(f"documents/{doc_id}/original.pdf") == data, "MinIO original differs from the uploaded bytes"
    r = api.get(f"/api/documents/{doc_id}/original.pdf")
    assert r.status_code == 200 and r.content == data


def test_wf_upload_pages_navigation(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Ledger pages {tag()}"
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], [], sample="letter-3")])
    with browse(browser, base, f"/documents/{w.docs[title]}", user=owner) as page:
        nav = page.get_by_role("navigation", name="Pages")
        b1, b2, b3 = (nav.get_by_role("button", name=f"Page {n}", exact=True) for n in (1, 2, 3))
        visible(page, b1, "filmstrip button 'Page 1'")
        b1.focus()
        page.keyboard.press("ArrowDown")
        focus_lands(page, b2)
        page.keyboard.press("ArrowDown")
        focus_lands(page, b3)
        page.keyboard.press("ArrowUp")
        focus_lands(page, b2)
        page.keyboard.press("Enter")
        eventually(page, lambda: (expect(b2).to_have_attribute("aria-current", "page", timeout=POLL_MS),
                                  _true(active_id(page) == "page-2", "focus not on page-2")),
                   LOAD_S, "Enter makes Page 2 current and focuses group page-2")
        layout(page)
        for key in ("768", "375"):
            page.set_viewport_size({"width": APP_WIDTHS[key][0], "height": APP_WIDTHS[key][1]})
            combo = page.get_by_role("combobox", name="Page", exact=True)
            visible(page, combo, f"combobox 'Page' at {key} px")
            expect(page.get_by_role("navigation", name="Pages")).to_have_count(0)
            select(combo, "Page 3 of 3")
            eventually(page, lambda: _true(active_id(page) == "page-3", "focus not on page-3"), LOAD_S,
                       f"choosing 'Page 3 of 3' at {key} px focuses group page-3")
            layout(page)
            select(combo, "Page 1 of 3")


UPLOAD_CASES = {
    "renamed_image": {"status": 415, "body": {"error": "not_a_pdf"}, "copy": "That file is not a PDF."},
    "encrypted": {"status": 422, "body": {"error": "pdf_encrypted"}, "copy": "Password-protected PDFs can't be uploaded."},
    "scripted": {"status": 422, "body": {"error": "pdf_has_scripts"}, "copy": "PDFs with scripts can't be uploaded."},
    "rotated": {"status": 422, "body": {"error": "pdf_rotated"}, "copy": "Rotated pages aren't supported. Upload a PDF with upright pages."},
    "pages_61": {"status": 422, "body": {"error": "too_many_pages", "limit": 60}, "copy": "This PDF has more than 60 pages."},
    "bytes_25000001": {"status": 413, "body": {"error": "too_large", "limit": 25000000}, "copy": "This PDF is larger than 25 MB."},
    "storage_down": {"status": 503, "body": {"error": "storage_unavailable"}, "copy": "File storage is unavailable. Your PDF was not uploaded."},
    "pages_60_allowed": {"status": 201, "body": None, "copy": None},
    "bytes_25000000_allowed": {"status": 201, "body": None, "copy": None},
}


def _upload_bytes(case: str) -> tuple[bytes, int]:
    if case == "renamed_image":
        return b"\x89PNG\r\n\x1a\n" + uuid.uuid4().bytes * 64, 0
    if case == "encrypted":
        return make_pdf(1, encrypt=True), 1
    if case == "scripted":
        return make_pdf(1, script=True), 1
    if case == "rotated":
        return make_pdf(2, rotate=90), 2
    if case == "pages_61":
        return make_pdf(PAGE_LIMIT + 1), PAGE_LIMIT + 1
    if case == "bytes_25000001":
        return make_pdf(1, size=UPLOAD_LIMIT + 1), 1
    if case == "pages_60_allowed":
        return make_pdf(PAGE_LIMIT), PAGE_LIMIT
    if case == "bytes_25000000_allowed":
        return make_pdf(1, size=UPLOAD_LIMIT), 1
    return make_pdf(1), 1


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=list(UPLOAD_CASES))
def test_wf_upload_pages_refusals(browser: Browser, app_url: str, case: str) -> None:
    expected = UPLOAD_CASES[case]
    base = STORAGE_DOWN_URL if case == "storage_down" else app_url.rstrip("/")
    assert base, "APP_STORAGE_DOWN_URL is not set"
    owner = person("Ada", "Byrne", "owner")
    seed(app_url.rstrip("/"), [owner])
    data, pages = _upload_bytes(case)
    title = f"Upload probe {tag()}"
    api = Api(base).login(owner)
    before = set(S3().keys("documents/"))
    r = api.upload(data, f"{title}.pdf", title)
    assert r.status_code == expected["status"], f"{case}: POST /api/documents answered {r.status_code}: {r.text[:200]}"
    if expected["body"] is None:
        d = r.json()
        assert d["pageCount"] == pages and d["originalSha256"] == hashlib.sha256(data).hexdigest()
        assert S3().get(f"documents/{d['id']}/original.pdf") == data
        return
    assert r.json() == expected["body"]
    with browse(browser, base, "/documents", user=owner) as page:
        visible(page, page.get_by_role("button", name="Upload PDF"), "Upload PDF control")
        choose_file(page, f"{title}.pdf", data)
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text=expected["copy"]).first).to_be_visible(timeout=POLL_MS),
                   LOAD_S + LOAD_S, f"{case}: alert {expected['copy']!r}")
        focus_lands(page, page.get_by_role("button", name="Upload PDF"))
    listed = Api(app_url.rstrip("/")).login(owner).get("/api/documents?filter=all").json()["documents"]
    assert not [d for d in listed if d["title"].startswith(title)], f"{case}: a refused upload created a document row"
    fresh = set(S3().keys("documents/")) - before
    for key in fresh:
        assert S3().get(key) != data, f"{case}: refused bytes were stored at {key}"


def test_wf_upload_pages_scroll_current(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Scroll pages {tag()}"
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], [], sample="letter-3")])
    with browse(browser, base, f"/documents/{w.docs[title]}", user=owner) as page:
        nav = page.get_by_role("navigation", name="Pages")
        buttons = {n: nav.get_by_role("button", name=f"Page {n}", exact=True) for n in (1, 2, 3)}
        visible(page, buttons[3], "filmstrip button 'Page 3'")
        buttons[3].focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: (expect(buttons[3]).to_have_attribute("aria-current", "page", timeout=POLL_MS),
                                  _true(in_view(page_group(page, 3, 3), APP_WIDTHS["1280"]), "page-3 not in view")),
                   LOAD_S, "Enter on Page 3 scrolls group page-3 into view and makes it current")
        box = page_group(page, 3, 3).bounding_box()
        assert box is not None
        page.mouse.move(box["x"] + box["width"] / 2, APP_WIDTHS["1280"][1] / 2)
        for n in (2, 1):
            for _ in range(WHEEL_STEPS):
                if crosses_middle(page, n):
                    break
                page.mouse.wheel(0, -WHEEL_PX)
                advance(page, STEP_MS)
            assert crosses_middle(page, n), f"wheel scrolling never brought page-{n} across the vertical middle"
            eventually(page, lambda n=n: expect(buttons[n]).to_have_attribute("aria-current", "page", timeout=POLL_MS),
                       LOAD_S, f"page-{n} crossing the vertical middle becomes the current page")


def test_wf_upload_pages_draft_page(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    seed(base, [owner])
    data = sample_pdf(base, "letter-1")
    title = f"Fresh draft {tag()}"
    with browse(browser, base, "/documents", user=owner) as page:
        visible(page, page.get_by_role("button", name="Upload PDF"), "Upload PDF control")
        choose_file(page, f"{title}.pdf", data)
        visible(page, page.get_by_role("heading", name=title, level=1), "the new draft's document page")
        visible(page, page.get_by_text("Add signers and fields", exact=True).first, "Next step for a draft")
        visible(page, page.get_by_text("Draft", exact=True).first, "Draft status word")
        expect(page.get_by_role("link", name="Download completed PDF")).to_have_count(0)
        expect(page.get_by_text("Completed PDF SHA-256")).to_have_count(0)


def test_wf_place_fields_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Keyboard placement {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [], sample="letter-3")])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    first_recipient = api.doc(doc_id)["recipients"][0]["id"]
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        target_page = 2
        b2 = page.get_by_role("navigation", name="Pages").get_by_role("button", name=f"Page {target_page}", exact=True)
        visible(page, b2, f"filmstrip button 'Page {target_page}'")
        b2.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(b2).to_have_attribute("aria-current", "page", timeout=POLL_MS), LOAD_S, "Page 2 current")
        toolbar = page.get_by_role("toolbar", name="Fields")
        position = page.get_by_role("status", name="Field position")
        cases = [("Signature", "Enter", "signature", "Signature 1"), ("Date", "Space", "date", "Date 1")]
        for count, (button, key, kind, label) in enumerate(cases, 1):
            btn = toolbar.get_by_role("button", name=button, exact=True)
            eventually(page, lambda b=btn: expect(b).to_be_enabled(timeout=POLL_MS), LOAD_S, f"{button} enabled")
            b2.evaluate("b => b.focus({preventScroll: true})")
            page.keyboard.press("Enter")
            eventually(page, lambda: _true(active_id(page) == "page-2", "focus not on page-2"), LOAD_S,
                       "Enter on Page 2 focuses its group")
            btn.evaluate("b => b.focus({preventScroll: true})")
            eventually(page, lambda: expect(b2).to_have_attribute("aria-current", "page", timeout=POLL_MS), LOAD_S,
                       "Page 2 stays current while the toolbar button has focus")
            page.keyboard.press(key)
            f = await_fields(api, doc_id, count, page)[-1]
            w_, h_ = DEFAULT_SIZE[kind]
            assert f["kind"] == kind and f["page"] == 2 and f["label"] == label and f["required"] is True
            assert f["recipientId"] == first_recipient
            for k, v in (("x", (1 - w_) / 2), ("y", (1 - h_) / 2), ("w", w_), ("h", h_)):
                assert abs(f[k] - v) <= GEOM_TOL, f"{label}: {k}={f[k]}, expected {v}"
            field = by_id(page, f"field-{f['id']}")
            eventually(page, lambda fl=field: (expect(fl).to_be_focused(timeout=POLL_MS),
                                               expect(fl).to_have_attribute("aria-pressed", "true", timeout=POLL_MS)),
                       LOAD_S, f"{label} selected and focused")
            copy = position_copy(label, 2, (1 - w_) / 2, (1 - h_) / 2, w_, h_)
            eventually(page, lambda c=copy: expect(position).to_have_text(c, timeout=POLL_MS), LOAD_S, f"Field position announces {copy!r}")
            page.keyboard.press("Escape")


def test_wf_place_fields_touch(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Touch placement {tag()}"
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], [])])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    with browse(browser, base, f"/documents/{doc_id}", user=owner, viewport=APP_WIDTHS["375"], touch=True) as page:
        sig = page.get_by_role("toolbar", name="Fields").get_by_role("button", name="Signature", exact=True)
        eventually(page, lambda: expect(sig).to_be_enabled(timeout=POLL_MS), LOAD_S, "Signature button enabled")
        tap(sig)
        eventually(page, lambda: expect(sig).to_have_attribute("aria-pressed", "true", timeout=POLL_MS), LOAD_S, "tap arms Signature")
        tap(sig)
        eventually(page, lambda: expect(sig).not_to_have_attribute("aria-pressed", "true", timeout=POLL_MS), LOAD_S, "second tap disarms")
        group = page_group(page, 1, 1)
        w_, h_ = DEFAULT_SIZE["signature"]
        targets = [((0.25, 0.3), (0.25 - w_ / 2, 0.3 - h_ / 2)), ((0.97, 0.98), (1 - w_, 1 - h_))]
        panel = page.get_by_role("complementary", name="Field properties")
        for n, ((fx, fy), (ex, ey)) in enumerate(targets, 1):
            if in_view(panel, APP_WIDTHS["375"]):
                on_screen(page, panel.get_by_role("button", name="Close"), "Field properties Close")
                tap(panel.get_by_role("button", name="Close"))
                eventually(page, lambda: _true(not in_view(panel, APP_WIDTHS["375"]), "Field properties sheet still in view"),
                           LOAD_S, "Close hides the Field properties sheet")
            if sig.get_attribute("aria-pressed") != "true":
                tap(sig)
            eventually(page, lambda: expect(sig).to_have_attribute("aria-pressed", "true", timeout=POLL_MS), LOAD_S, "armed")
            group.scroll_into_view_if_needed()
            box = group.bounding_box()
            assert box is not None
            touch_tap(page, box["x"] + fx * box["width"], box["y"] + fy * box["height"])
            f = await_fields(api, doc_id, n, page)[-1]
            assert abs(f["x"] - ex) <= GEOM_TOL and abs(f["y"] - ey) <= GEOM_TOL, f"tap at ({fx},{fy}) gave {f}"
            assert f["x"] + f["w"] <= 1 and f["y"] + f["h"] <= 1


def test_wf_place_fields_drag(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Drag placement {tag()}"
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], [])])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        sig = page.get_by_role("toolbar", name="Fields").get_by_role("button", name="Signature", exact=True)
        eventually(page, lambda: expect(sig).to_be_enabled(timeout=POLL_MS), LOAD_S, "Signature button enabled")
        w_, h_ = DEFAULT_SIZE["signature"]
        targets = [((0.6, 0.3), (0.6 - w_ / 2, 0.3 - h_ / 2)), ((0.99, 0.01), (1 - w_, 0.0))]
        for n, ((fx, fy), (ex, ey)) in enumerate(targets, 1):
            page.keyboard.press("Escape")
            page.evaluate("() => window.scrollTo(0, 0)")
            sb = sig.bounding_box()
            box = page_group(page, 1, 1).bounding_box()
            assert sb is not None and box is not None
            drag(page, sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2,
                 box["x"] + fx * box["width"], box["y"] + fy * box["height"])
            f = await_fields(api, doc_id, n, page)[-1]
            assert abs(f["x"] - ex) <= GEOM_TOL and abs(f["y"] - ey) <= GEOM_TOL, f"drop at ({fx},{fy}) gave {f}"
            assert f["x"] + f["w"] <= 1 and f["y"] + f["h"] <= 1 and f["x"] >= 0 and f["y"] >= 0


def mail_addr(api: Api, doc_id: str, order: int = 1) -> str:
    return api.doc(doc_id)["recipients"][order - 1]["email"]


def test_wf_place_fields_geometry(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1 = signer("Ines", "Okafor")
    fields = [fld(1, "signature", 2, 0.123, 0.456, 0.25, 0.05), fld(1, "text", 1, 0.6, 0.1, 0.3, 0.04)]
    draft, sent = f"Geometry draft {tag()}", f"Geometry sent {tag()}"
    w = seed(base, [owner], [document(draft, owner, [s1], fields, sample="letter-3"),
                             document(sent, owner, [signer("Mira", "Lund")], fields, sample="letter-3", state="in_progress")])
    api = Api(base).login(owner)
    stored = api.doc(w.docs[draft])["fields"]
    stored_sent = api.doc(w.docs[sent])["fields"]
    with browse(browser, base, f"/documents/{w.docs[draft]}", user=owner) as page:
        for key in WIDTH_IDS:
            page.set_viewport_size({"width": APP_WIDTHS[key][0], "height": APP_WIDTHS[key][1]})
            for reload in (False, True):
                if reload:
                    page.reload()
                for f in stored:
                    eventually(page, lambda f=f: assert_box(rel_box(page, f"field-{f['id']}", f["page"]), f, f"editor {f['label']}"),
                               LOAD_S, f"editor field {f['label']} within 0.01 at {key} px (reload={reload})")
    token = invite_token(mail, mail_addr(api, w.docs[sent]), sent)
    with browse(browser, base, f"/sign/{token}") as page:
        for key in WIDTH_IDS:
            page.set_viewport_size({"width": APP_WIDTHS[key][0], "height": APP_WIDTHS[key][1]})
            for f in stored_sent:
                eventually(page, lambda f=f: assert_box(rel_box(page, f"field-{f['id']}", f["page"]), f, f"signer {f['label']}"),
                           LOAD_S, f"signer field {f['label']} within 0.01 at {key} px")


def test_field_properties(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Properties {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.2, 0.2, 0.3, 0.06)])])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    d = api.doc(doc_id)
    f = d["fields"][0]
    r2 = d["recipients"][1]["id"]
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        field = page.get_by_role("button", name=f"Signature 1 for {s1['name']}")
        visible(page, field, "field button 'Signature 1 for <name>'")
        field.focus()
        panel = page.get_by_role("complementary", name="Field properties")
        visible(page, panel, "Field properties opens on select")
        on_screen(page, panel.get_by_role("combobox", name="Assign to"), "Assign to")
        select(panel.get_by_role("combobox", name="Assign to"), s2["name"])
        await_field(api, doc_id, f["id"], page, "Assign to stores the new recipient", recipientId=r2)
        visible(page, page.get_by_role("button", name=f"Signature 1 for {s2['name']}"), "accessible name follows Assign to")
        req = panel.get_by_role("checkbox", name="Required")
        req.focus()
        page.keyboard.press("Space")
        await_field(api, doc_id, f["id"], page, "Required off is stored", required=False)
        expect(req).not_to_be_checked()
        label = panel.get_by_role("textbox", name="Label")
        label.focus()
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type("Lessee")
        await_field(api, doc_id, f["id"], page, "Label is stored", label="Lessee")
        visible(page, page.get_by_role("button", name=f"Lessee for {s2['name']}"), "accessible name follows Label", seconds=LIVE_S)


def test_wf_adjust_fields_pointer(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Pointer adjust {tag()}"
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], [fld(1, "signature", 1, 0.2, 0.2, 0.3, 0.06)])])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    placed = api.doc(doc_id)["fields"][0]
    fid, label = placed["id"], placed["label"]
    tall = (APP_WIDTHS["1280"][0], TALL_VIEWPORT_PX)
    with browse(browser, base, f"/documents/{doc_id}", user=owner, viewport=tall) as page:
        field = by_id(page, f"field-{fid}")
        visible(page, field, "placed field")
        page.evaluate("() => window.scrollTo(0, 0)")

        def drag_field(dx: float, dy: float) -> None:
            pb = page_group(page, 1, 1).bounding_box()
            fb = field.bounding_box()
            assert pb and fb
            cx, cy = fb["x"] + fb["width"] / 2, fb["y"] + fb["height"] / 2
            drag(page, cx, cy, cx + dx * pb["width"], cy + dy * pb["height"])

        drag_field(0.1, 0.15)
        await_field(api, doc_id, fid, page, "drag moves by the drag distance", x=0.3, y=0.35)
        field.click()
        handle = page.get_by_role("button", name=f"Resize {label}")
        visible(page, handle, "Resize <label> handle")

        def drag_handle(dx: float, dy: float) -> None:
            pb = page_group(page, 1, 1).bounding_box()
            hb = handle.bounding_box()
            assert pb and hb
            cx, cy = hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2
            drag(page, cx, cy, cx + dx * pb["width"], cy + dy * pb["height"])

        drag_handle(0.1, 0.04)
        await_field(api, doc_id, fid, page, "resize grows width and height", w=0.4, h=0.1)
        pb, fb = page_group(page, 1, 1).bounding_box(), field.bounding_box()
        assert pb and fb and pb["y"] + pb["height"] + 2 * PX_TOL < tall[1], "the page does not fit the window"
        drag(page, fb["x"] + fb["width"] / 2, fb["y"] + fb["height"] / 2,
             pb["x"] + pb["width"] * (1 + PAST_EDGE), pb["y"] + pb["height"] * (1 + PAST_EDGE / 2))
        f = await_field(api, doc_id, fid, page, "drag clamps inside the page", x=0.6, y=0.9, w=0.4, h=0.1)
        assert f["x"] + f["w"] <= 1 and f["y"] + f["h"] <= 1
        field.click()
        drag_handle(-(0.4 + PAST_EDGE), -(0.1 + PAST_EDGE))
        f = await_field(api, doc_id, fid, page, "resize clamps at the minimum size", w=MIN_SIZE, h=MIN_SIZE)
        assert f["w"] >= MIN_SIZE and f["h"] >= MIN_SIZE


def test_wf_adjust_fields_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Keyboard adjust {tag()}"
    fields = [fld(1, "signature", 1, 0.4, 0.4, 0.3, 0.06), fld(1, "text", 1, 0.1, 0.8, 0.3, 0.04)]
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], fields, sample="letter-3")])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    f1, f2 = api.doc(doc_id)["fields"]
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        field = by_id(page, f"field-{f1['id']}")
        visible(page, field, "placed field")
        field.focus()
        position = page.get_by_role("status", name="Field position")
        state = {"page": 1, "x": 0.4, "y": 0.4, "w": 0.3, "h": 0.06}
        steps = [("ArrowRight", "x", STEP), ("Shift+ArrowDown", "y", BIG_STEP), ("ArrowLeft", "x", -STEP),
                 ("Alt+ArrowRight", "w", STEP), ("Alt+Shift+ArrowDown", "h", BIG_STEP), ("Alt+ArrowLeft", "w", -STEP),
                 ("Alt+Shift+ArrowUp", "h", -BIG_STEP), ("Shift+ArrowUp", "y", -BIG_STEP)]
        for key, prop, delta in steps:
            page.keyboard.press(key)
            state[prop] = round(state[prop] + delta, 4)
            await_field(api, doc_id, f1["id"], page, f"{key} saves {prop}", **{prop: state[prop]})
            copy = position_copy("Signature 1", state["page"], state["x"], state["y"], state["w"], state["h"])
            eventually(page, lambda c=copy: expect(position).to_have_text(c, timeout=POLL_MS), LOAD_S, f"{key} announces {copy!r}")
        for _ in range(20):
            page.keyboard.press("Shift+ArrowRight")
        await_field(api, doc_id, f1["id"], page, "Shift+ArrowRight clamps x + w <= 1", x=1 - state["w"])
        state["x"] = round(1 - state["w"], 4)
        for target in (2, 3, 3):
            page.keyboard.press("PageDown")
            await_field(api, doc_id, f1["id"], page, f"PageDown moves to page {target}", page=target, x=state["x"], y=state["y"])
            eventually(page, lambda: _true(focused(page, f"field-{f1['id']}"), "focus left the field"), LOAD_S, "focus follows the field")
        copy = position_copy("Signature 1", 3, state["x"], state["y"], state["w"], state["h"])
        eventually(page, lambda: expect(position).to_have_text(copy, timeout=POLL_MS), LOAD_S, "page change announced")
        page.keyboard.press("PageUp")
        page.keyboard.press("PageUp")
        await_field(api, doc_id, f1["id"], page, "PageUp moves back to page 1", page=1)
        page.keyboard.press("Escape")
        eventually(page, lambda: (_true(active_id(page) == "page-1", "focus not on page-1"),
                                  expect(page.get_by_role("complementary", name="Field properties")).to_have_count(0, timeout=POLL_MS)),
                   LOAD_S, "Escape deselects, closes Field properties and focuses the page group")
        expect(field).not_to_have_attribute("aria-pressed", "true")
        field.focus()
        page.keyboard.press("Delete")
        await_fields(api, doc_id, 1, page)
        eventually(page, lambda: _true(focused(page, f"field-{f2['id']}"), "focus not on the next field"), LOAD_S,
                   "Delete moves focus to the next field on the page")
        page.keyboard.press("Delete")
        await_fields(api, doc_id, 0, page)
        eventually(page, lambda: _true(active_id(page) == "page-1", "focus not on page-1"), LOAD_S,
                   "Delete of the last field focuses the page group")


def test_wf_adjust_fields_cross_team(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner_a, owner_b = person("Ada", "Byrne", "owner"), person("Cora", "Lindqvist", "owner")
    ta, tc, tb = f"Fenwick lease {tag()}", f"Fenwick sealed {tag()}", f"Northgate lease {tag()}"
    sig = [fld(1, "signature", 1, 0.1, 0.1, 0.3, 0.06)]
    wa = seed(base, [owner_a], [document(ta, owner_a, [signer("Ines", "Okafor")], sig),
                                document(tc, owner_a, [signer("Mira", "Lund")], sig, state="completed")])
    wb = seed(base, [owner_b], [document(tb, owner_b, [signer("Tomas", "Reyes")], sig)])
    a, b = Api(base).login(owner_a), Api(base).login(owner_b)
    da, db = a.doc(wa.docs[ta]), b.doc(wb.docs[tb])
    tr = a.post(f"/api/documents/{da['id']}/template")
    assert tr.status_code == 201
    tid = tr.json()["id"]
    assert a.post(f"/api/templates/{tid}/share").status_code == 200
    fa, ra, fb = da["fields"][0], da["recipients"][0], db["fields"][0]
    probes: list[tuple[str, str, Any]] = [
        ("GET", f"/api/documents/{da['id']}", None),
        ("PATCH", f"/api/documents/{da['id']}", {"title": "Renamed elsewhere"}),
        ("PATCH", f"/api/documents/{da['id']}/fields/{fa['id']}", {"x": 0.5}),
        ("DELETE", f"/api/documents/{da['id']}/fields/{fa['id']}", None),
        ("PATCH", f"/api/documents/{da['id']}/recipients/{ra['id']}", {"name": "Mallory Pike"}),
        ("DELETE", f"/api/documents/{da['id']}/recipients/{ra['id']}", None),
        ("POST", f"/api/documents/{da['id']}/send", None),
        ("GET", f"/api/documents/{da['id']}/audit", None),
        ("GET", f"/api/documents/{da['id']}/original.pdf", None),
        ("GET", f"/api/documents/{wa.docs[tc]}/completed.pdf", None),
        ("GET", f"/api/templates/{tid}", None),
        ("POST", f"/api/templates/{tid}/use", {"signers": [signer("Pia", "Hart")]}),
        ("POST", f"/api/documents/{db['id']}/fields", {"recipientId": ra["id"], "kind": "signature", "page": 1,
                                                        "x": 0.1, "y": 0.5, "w": 0.3, "h": 0.06}),
        ("PATCH", f"/api/documents/{db['id']}/fields/{fb['id']}", {"recipientId": ra["id"]}),
    ]
    for method, path, body in probes:
        r = b.http.request(method, path, json=body) if body is not None else b.http.request(method, path)
        assert r.status_code == 404, f"{method} {path} by another team answered {r.status_code}"
        assert r.json() == {"error": "not_found"}, f"{method} {path} body {r.text[:200]}"
    listed = {d["id"] for d in b.get("/api/documents?filter=all").json()["documents"]}
    assert da["id"] not in listed and wa.docs[tc] not in listed and db["id"] in listed
    assert tid not in {t["id"] for t in b.get("/api/templates").json()["templates"]}
    after_a, after_b = a.doc(da["id"]), b.doc(db["id"])
    assert after_a["title"] == ta and after_a["version"] == da["version"] and after_a["fields"] == da["fields"]
    assert after_a["recipients"] == da["recipients"]
    assert len(after_b["fields"]) == 1 and after_b["fields"][0]["recipientId"] == db["recipients"][0]["id"]
    with browse(browser, base, f"/documents/{da['id']}", user=owner_b) as page:
        visible(page, page.get_by_role("heading", name="Document not found"), "not-found heading for another team's document")
        visible(page, page.get_by_text("Check the link, or ask your team owner.", exact=True), "not-found body")


def test_wf_adjust_fields_drag_to_page(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Drag across pages {tag()}"
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")],
                                      [fld(1, "signature", 1, 0.2, 0.85, 0.3, 0.06)], sample="letter-3")])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    placed = api.doc(doc_id)["fields"][0]
    tall = (APP_WIDTHS["1280"][0], TALL_VIEWPORT_PX)
    with browse(browser, base, f"/documents/{doc_id}", user=owner, viewport=tall) as page:
        field = by_id(page, f"field-{placed['id']}")
        visible(page, field, "placed field")
        page.evaluate("() => document.getElementById('page-2').scrollIntoView({block: 'center'})")
        advance(page, MOTION_WINDOW_MS)
        fb, target = field.bounding_box(), page_group(page, 2, 3).bounding_box()
        assert fb and target and in_view(field, tall), "the field on page 1 and page 2 are not on screen together"
        tx, ty = 0.5, 0.3
        drag(page, fb["x"] + fb["width"] / 2, fb["y"] + fb["height"] / 2,
             target["x"] + tx * target["width"], target["y"] + ty * target["height"])
        f = await_field(api, doc_id, placed["id"], page, "releasing over page 2 moves the field there",
                        page=2, x=tx - placed["w"] / 2, y=ty - placed["h"] / 2, w=placed["w"], h=placed["h"])
        eventually(page, lambda: assert_box(rel_box(page, f"field-{placed['id']}", 2), f, "moved field"), LOAD_S,
                   "the moved field renders inside page-2 at its stored fractions")


def test_wf_adjust_fields_label_keys(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Label keys {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1], [fld(1, "signature", 1, 0.4, 0.4, 0.3, 0.06)], sample="letter-3")])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    placed = api.doc(doc_id)["fields"][0]
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        field = by_id(page, f"field-{placed['id']}")
        visible(page, field, "placed field")
        field.focus()
        label = page.get_by_role("complementary", name="Field properties").get_by_role("textbox", name="Label")
        visible(page, label, "Label textbox in Field properties")
        label.focus()
        page.keyboard.press("End")
        page.keyboard.press("Backspace")
        page.keyboard.type("B")
        for key in ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Shift+ArrowUp", "PageDown", "PageUp", "End", "Shift+ArrowLeft"):
            page.keyboard.press(key)
        page.keyboard.type("C")
        page.keyboard.press("Delete")
        new_label = f"{placed['label'][:-1]}C"
        await_field(api, doc_id, placed["id"], page, "the keys edited the label only",
                    label=new_label, page=1, x=placed["x"], y=placed["y"], w=placed["w"], h=placed["h"])
        assert len(api.doc(doc_id)["fields"]) == 1, "a key typed in Label deleted the field"
        visible(page, page.get_by_role("button", name=f"{new_label} for {s1['name']}"), "the field's name follows the label", seconds=LIVE_S)
        focus_lands(page, label)


def test_wf_signing_order_editing(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Order editing {tag()}"
    w = seed(base, [owner], [document(title, owner, [], [])])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    people = [signer("Ines", "Okafor"), signer("Tomas", "Reyes"), signer("Mira", "Lund")]
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        name_box = page.get_by_role("textbox", name="Name", exact=True)
        email_box = page.get_by_role("textbox", name="Email", exact=True)
        visible(page, name_box, "add-signer Name box")
        for k, p in enumerate(people, 1):
            name_box.focus()
            page.keyboard.type(p["name"])
            email_box.focus()
            page.keyboard.type(p["email"])
            page.keyboard.press("Enter")
            visible(page, order_row(page, k, p["name"]), f"row '{k}. {p['name']}'")
            focus_lands(page, name_box)
        assert [r["name"] for r in api.doc(doc_id)["recipients"]] == [p["name"] for p in people]
        third = people[2]["name"]
        updates = page.get_by_role("status", name="Signing order updates")
        up = page.get_by_role("button", name=f"Move {third} up")
        up.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(updates).to_contain_text(f"{third} is now signer 2 of 3", timeout=POLL_MS), LOAD_S, "reorder announced")
        focus_lands(page, up)
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(updates).to_contain_text(f"{third} is now signer 1 of 3", timeout=POLL_MS), LOAD_S, "reorder announced")
        expect(up).to_be_disabled()
        focus_lands(page, page.get_by_role("button", name=f"Move {third} down"))
    order = sorted(api.doc(doc_id)["recipients"], key=lambda r: r["order"])
    assert [r["name"] for r in order] == [third, people[0]["name"], people[1]["name"]]


def test_wf_signing_order_send_checks(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2, s3 = signer("Ines", "Okafor"), signer("Tomas", "Reyes"), signer("Mira", "Lund")
    title, empty = f"Send checks {tag()}", f"No signers {tag()}"
    fields = [fld(1, "signature", 1, 0.1, 0.1, 0.3, 0.06), fld(2, "signature", 1, 0.1, 0.3, 0.3, 0.06, required=False)]
    w = seed(base, [owner], [document(title, owner, [s1, s2, s3], fields), document(empty, owner, [], [])])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    r = api.post(f"/api/documents/{w.docs[empty]}/send")
    assert r.status_code == 422 and r.json() == {"error": "no_recipients"}
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        opener = page.get_by_role("button", name="Send for signing")
        visible(page, opener, "Send for signing")
        opener.click()
        dialog = page.get_by_role("dialog", name="Send for signing")
        visible(page, dialog, "Send for signing dialog")
        for n, p in enumerate((s1, s2, s3), 1):
            expect(dialog).to_contain_text(f"{n}. {p['name']} ({p['email']})")
        for key in ["Tab"] * TAB_PRESSES + ["Shift+Tab"] * TAB_PRESSES:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the dialog"
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "Escape closes the dialog")
        focus_lands(page, opener)
        opener.click()
        dialog.get_by_role("button", name="Send", exact=True).click()
        copy = f"Every signer needs a signature field. Missing: {s2['name']}, {s3['name']}"
        eventually(page, lambda: expect(dialog.get_by_role("alert").filter(has_text=copy).first).to_be_visible(timeout=POLL_MS),
                   LOAD_S, "missing-signature alert inside the dialog")
    r = api.post(f"/api/documents/{doc_id}/send")
    assert r.status_code == 422
    assert r.json() == {"error": "missing_signature_fields", "recipients": [s2["name"], s3["name"]]}
    assert api.doc(doc_id)["status"] == "draft"
    assert not mails(mail, s1["email"], f"Please sign: {title}"), "a refused send mailed an invitation"


def test_wf_signing_order_handoff(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    people = [signer("Ines", "Okafor"), signer("Tomas", "Reyes"), signer("Mira", "Lund")]
    title = f"Hand-off {tag()}"
    fields = [fld(k, "signature", 1, 0.1, 0.1 + 0.2 * (k - 1), 0.3, 0.06) for k in (1, 2, 3)]
    w = seed(base, [owner], [document(title, owner, people, fields)])
    doc_id = w.docs[title]
    with browse(browser, base, f"/documents/{doc_id}", user=owner, shift=timedelta(days=30)) as page:
        page.get_by_role("button", name="Send for signing").click()
        page.get_by_role("dialog", name="Send for signing").get_by_role("button", name="Send", exact=True).click()
        updates = page.get_by_role("status", name="Signing order updates")
        eventually(page, lambda: expect(updates).to_contain_text(f"Sent for signing. {people[0]['name']} has the first turn.", timeout=POLL_MS),
                   LOAD_S, "send announcement")
        eventually(page, lambda: expect(page.get_by_role("heading", level=1, name=title)).to_be_focused(timeout=POLL_MS),
                   LOAD_S, "focus moves to the document heading after send")
        eventually(page, lambda: (expect(order_row(page, 1, people[0]["name"])).to_contain_text("Invited", timeout=POLL_MS),
                                  expect(order_row(page, 2, people[1]["name"])).to_contain_text("Waiting", timeout=POLL_MS),
                                  expect(order_row(page, 3, people[2]["name"])).to_contain_text("Waiting", timeout=POLL_MS)),
                   LOAD_S, "rows read Invited, Waiting, Waiting")
        token = invite_token(mail, people[0]["email"], title)
        assert not mails(mail, people[1]["email"], f"Please sign: {title}") and not mails(mail, people[2]["email"], f"Please sign: {title}")
        assert Link(base, token).sign(people[0]["name"]) == {"state": "signed_waiting"}
        eventually(page, lambda: (expect(order_row(page, 1, people[0]["name"])).to_contain_text("Signed", timeout=POLL_MS),
                                  expect(order_row(page, 2, people[1]["name"])).to_contain_text("Invited", timeout=POLL_MS)),
                   LIVE_S + LIVE_SLACK_S, "sender page shows Signed and Invited within 3 s without reload")
    await_mail(mail, people[1]["email"], f"Please sign: {title}")
    assert not mails(mail, people[2]["email"], f"Please sign: {title}"), "signer 3 was invited out of turn"
    d = Api(base).login(owner).doc(doc_id)
    assert d["currentOrder"] == 2 and [r["status"] for r in d["recipients"]] == ["signed", "invited", "waiting"]


def test_wf_signing_order_header_injection(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    t = tag()
    mallory_cc = f"mallory.cc.{t}@harbour-row.example"
    mallory_bcc = f"mallory.bcc.{t}@harbour-row.example"
    owner = person("Ada", "Byrne", "owner")
    owner["name"] = f"Ada\r\nByrne\nBcc: {mallory_bcc}"
    s1 = signer("Ines", "Okafor")
    title = f"Lease {t}\r\n\r\nCc: {mallory_cc}"
    w = seed(base, [owner], [document(title, owner, [s1], [fld(1, "signature", 1, 0.1, 0.1, 0.3, 0.06)])])
    with browse(browser, base, f"/documents/{w.docs[title]}", user=owner) as page:
        opener = page.get_by_role("button", name="Send for signing")
        visible(page, opener, "Send for signing")
        opener.click()
        page.get_by_role("dialog", name="Send for signing").get_by_role("button", name="Send", exact=True).click()
        eventually(page, lambda: expect(order_row(page, 1, s1["name"])).to_contain_text("Invited", timeout=POLL_MS), LOAD_S, "sent")
    subject = f"Please sign: Lease {t} Cc: {mallory_cc}"
    msg = await_mail(mail, s1["email"], subject)[0]
    assert [a.lower() for a in addresses(msg.get("To"))] == [s1["email"]]
    assert not addresses(msg.get("Cc")) and not addresses(msg.get("Bcc"))
    sender = msg.get("From") or {}
    assert sender.get("Name") == f"Ada Byrne Bcc: {mallory_bcc} via Undersign"
    assert sender.get("Address", "").lower() == mail_from_address().lower()
    assert not mails(mail, mallory_cc) and not mails(mail, mallory_bcc), "a line break added a recipient"


def test_send_replay_and_races(app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    sig = [fld(1, "signature", 1, 0.1, 0.1, 0.3, 0.06)]
    titles = [f"Replay {tag()}", f"Reuse {tag()}", f"Race send {tag()}", f"Race finish {tag()}"]
    people = [signer("Ines", "Okafor") for _ in titles]
    w = seed(base, [owner], [document(titles[0], owner, [people[0]], sig), document(titles[1], owner, [people[1]], sig),
                             document(titles[2], owner, [people[2]], sig),
                             document(titles[3], owner, [people[3]], sig, state="in_progress")])
    api = Api(base).login(owner)
    key = uuid.uuid4().hex
    first = api.post(f"/api/documents/{w.docs[titles[0]]}/send", headers={"Idempotency-Key": key})
    assert first.status_code == 200 and first.json()["status"] == "in_progress"
    again = api.post(f"/api/documents/{w.docs[titles[0]]}/send", headers={"Idempotency-Key": key})
    assert again.status_code == first.status_code and again.json() == first.json(), "replay did not return the stored response"
    reuse = api.post(f"/api/documents/{w.docs[titles[1]]}/send", headers={"Idempotency-Key": key})
    assert reuse.status_code == 422 and reuse.json() == {"error": "idempotency_key_reused"}
    assert api.doc(w.docs[titles[1]])["status"] == "draft"
    clients = [Api(base).login(owner) for _ in range(2)]
    results = together([lambda c=c: c.post(f"/api/documents/{w.docs[titles[2]]}/send") for c in clients])
    assert sorted(r.status_code for r in results) == [200, 409], [r.text[:120] for r in results]
    loser = next(r for r in results if r.status_code == 409)
    assert loser.json() == {"error": "invalid_state", "status": "in_progress"}
    token = invite_token(mail, people[3]["email"], titles[3])
    Link(base, token).fill_all(people[3]["name"])
    links = [Link(base, token) for _ in range(2)]
    results = together([lambda l=l: l.finish() for l in links])
    assert sorted(r.status_code for r in results) == [200, 409]
    assert next(r for r in results if r.status_code == 409).json()["error"] == "link_closed"
    rid = api.doc(w.docs[titles[3]])["recipients"][0]["id"]
    signed = [e for e in api.audit(w.docs[titles[3]]) if e["type"] == "recipient.signed" and e["recipientId"] == rid]
    assert len(signed) == 1, f"{len(signed)} recipient.signed events for one signer"
    for idx in (0, 2):
        await_mail(mail, people[idx]["email"], f"Please sign: {titles[idx]}")
        assert len(mails(mail, people[idx]["email"], f"Please sign: {titles[idx]}")) == 1, "a replayed or raced send mailed twice"
    assert not mails(mail, people[1]["email"], f"Please sign: {titles[1]}")


def test_wf_signing_order_sent_controls(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Sent controls {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.1, 0.6, 0.3, 0.06)], state="in_progress")])
    with browse(browser, base, f"/documents/{w.docs[title]}", user=owner) as page:
        visible(page, order_row(page, 1, s1["name"]), "signing order row 1")
        for role, name in (("button", f"Move {s1['name']} down"), ("button", f"Move {s2['name']} up"), ("button", f"Remove {s1['name']}"),
                           ("button", "Add signer"), ("textbox", "Name"), ("textbox", "Email"), ("toolbar", "Fields"),
                           ("button", "Send for signing")):
            expect(page.get_by_role(role, name=name, exact=True)).to_have_count(0)


WALK_FIELDS = [
    fld(1, "signature", 1, 0.1, 0.55, 0.3, 0.06),
    fld(1, "text", 2, 0.55, 0.5, 0.35, 0.04),
    fld(1, "signature", 3, 0.3, 0.3, 0.3, 0.06),
    fld(1, "text", 1, 0.55, 0.8, 0.3, 0.04, required=False),
]


def _walk_setup(app_url: str, mail: Mailpit) -> tuple[str, str, Api, str, list[dict[str, Any]], dict[str, str]]:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Walk {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                      WALK_FIELDS + [fld(2, "signature", 3, 0.1, 0.7, 0.3, 0.06)],
                                      state="in_progress", sample="letter-3")])
    api = Api(base).login(owner)
    fields = list(api.doc(w.docs[title])["fields"])[:4]
    return base, title, api, invite_token(mail, s1["email"], title), fields, s1


def test_aperture_on_open(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base, title, _, token, fields, _ = _walk_setup(app_url, mail)
    first = fields[0]
    with browse(browser, base, f"/sign/{token}") as page:
        visible(page, page.get_by_role("heading", name=title, level=1), "signer view heading")
        eventually(page, lambda: assert_box(rel_box(page, "aperture", 1), first, "aperture"), LOAD_S, "aperture frames Signature 1")
        eventually(page, lambda: _true(focused(page, f"field-{first['id']}"), "focus not in the first field"), LOAD_S, "focus enters field")
        top_in_band(page, f"field-{first['id']}", "first field")
        total = required_total(fields)
        progress = page.get_by_role("status", name="Signing progress")
        eventually(page, lambda: expect(progress).to_contain_text(progress_copy(1, total, first["label"], first["page"]), timeout=POLL_MS),
                   LOAD_S, "announcement")
        visible(page, page.get_by_text(left_copy(total), exact=True), "count '<n> left'")
        assert page.evaluate("() => !!document.getElementById('aperture').closest('[aria-hidden=\"true\"]')"), "aperture exposed to assistive tech"


def test_wf_guided_signing_walk(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base, title, _, token, fields, _ = _walk_setup(app_url, mail)
    a, b, c = fields[0], fields[1], fields[2]
    total = required_total(fields)
    approval = f"Approved {tag()}"
    link = Link(base, token)
    with browse(browser, base, f"/sign/{token}") as page:
        visible(page, page.get_by_role("heading", name=title, level=1), "signer view")
        aperture = by_id(page, APERTURE_ID)
        eventually(page, lambda: assert_box(rel_box(page, "aperture", 1), a, "aperture"), LOAD_S, "aperture on Signature 1")
        adopt_with_dialog(page, a["id"])
        eventually(page, lambda: _true(focused(page, f"field-{a['id']}"), "focus not back on field"), LOAD_S, "focus returns to the field")
        visible(page, page.get_by_text(left_copy(total - 1), exact=True), "count drops by one after adoption")
        page.keyboard.press("Enter")
        pts = path_of(aperture)
        assert in_between(pts), "aperture jumped without in-between positions"
        took = settle_time(pts)
        assert APERTURE_MIN_MS - SAMPLE_SLACK_MS <= took <= APERTURE_MAX_MS + SAMPLE_SLACK_MS, f"aperture travel took {took} ms"
        eventually(page, lambda: assert_box(rel_box(page, "aperture", 2), b, "aperture"), LOAD_S, "aperture lands on Text 1")
        progress = page.get_by_role("status", name="Signing progress")
        eventually(page, lambda: expect(progress).to_contain_text(progress_copy(2, total, b["label"], b["page"]), timeout=POLL_MS),
                   LOAD_S, "announcement")
        eventually(page, lambda: _true(focused(page, f"field-{b['id']}"), "focus not in Text 1"), LOAD_S, "focus follows")
        top_in_band(page, f"field-{b['id']}", "Text 1")
        page.keyboard.type(approval)
        page.keyboard.press("Tab")
        eventually(page, lambda: (expect(progress).to_contain_text(progress_copy(3, total, c["label"], c["page"]), timeout=POLL_MS),
                                  _true(focused(page, f"field-{c['id']}"), "focus not in Signature 2")),
                   LOAD_S, "Tab from a completed field acts as Next")
        visible(page, page.get_by_text(left_copy(total - 2), exact=True), "count drops after the text field saves")
        assert field_value(link, b["id"]) == approval
        eventually(page, lambda: assert_box(rel_box(page, "aperture", 3), c, "aperture"), LOAD_S, "aperture on Signature 2")
        by_id(page, f"field-{c['id']}").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: _true(field_value(link, c["id"]) is not None, "Signature 2 empty"), LOAD_S, "one activation fills Signature 2")
        visible(page, page.get_by_text("0 left", exact=True), "count '0 left'")
        page.get_by_role("button", name="Next", exact=True).click()
        eventually(page, lambda: expect(page.get_by_role("button", name="Finish and sign")).to_be_focused(timeout=POLL_MS),
                   LOAD_S, "Next with nothing left moves focus to Finish and sign")


def test_wf_guided_signing_reduced_motion(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base, title, _, token, fields, _ = _walk_setup(app_url, mail)
    a, b = fields[0], fields[1]
    with browse(browser, base, f"/sign/{token}", reduced=True) as page:
        visible(page, page.get_by_role("heading", name=title, level=1), "signer view")
        eventually(page, lambda: assert_box(rel_box(page, "aperture", 1), a, "aperture"), LOAD_S, "aperture on Signature 1")
        adopt_with_dialog(page, a["id"])
        page.get_by_role("button", name="Next", exact=True).click()
        pts = path_of(by_id(page, APERTURE_ID))
        assert not in_between(pts), f"aperture showed in-between frames under reduced motion: {in_between(pts)[:3]}"
        eventually(page, lambda: assert_box(rel_box(page, "aperture", 2), b, "aperture"), LOAD_S, "aperture lands on Text 1")
        eventually(page, lambda: (expect(page.get_by_role("status", name="Signing progress")).to_contain_text(
            progress_copy(2, required_total(fields), b["label"], b["page"]), timeout=POLL_MS),
                                  _true(focused(page, f"field-{b['id']}"), "focus not in Text 1")),
                   LOAD_S, "announcement and focus under reduced motion")


def test_wf_guided_signing_finish(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Finish {tag()}"
    fields = [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06), fld(1, "text", 1, 0.1, 0.6, 0.3, 0.04), fld(2, "signature", 1, 0.5, 0.8, 0.3, 0.06)]
    w = seed(base, [owner], [document(title, owner, [s1, s2], fields, state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    first = link.state().json()["fields"][0]
    with browse(browser, base, f"/sign/{token}") as page:
        finish = page.get_by_role("button", name="Finish and sign")
        visible(page, finish, "Finish and sign")
        page.get_by_role("button", name="Next", exact=True).click()
        finish.click()
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text="Complete 2 required fields first.").first).to_be_visible(timeout=POLL_MS),
                   LOAD_S, "incomplete-fields alert")
        eventually(page, lambda: (assert_box(rel_box(page, "aperture", 1), first, "aperture"),
                                  _true(focused(page, f"field-{first['id']}"), "focus not on first incomplete")),
                   LOAD_S, "aperture and focus return to the first incomplete field")
        assert link.state().json()["state"] == "your_turn"
        fill_in_view(page, link, s1["name"])
        finish.click()
        visible(page, page.get_by_role("heading", name=f"You signed {title}", level=1), "signed state heading")
        visible(page, page.get_by_text(f"Waiting for {s2['name']} (signer 2 of 2).", exact=True), "signed_waiting body")
    d = Api(base).login(owner).doc(w.docs[title])
    assert d["recipients"][0]["status"] == "signed" and d["currentOrder"] == 2


def seed_doc_id(base: str, user: dict[str, str], title: str) -> str:
    docs = Api(base).login(user).get("/api/documents?filter=all").json()["documents"]
    return next(d["id"] for d in docs if d["title"] == title)


@pytest.mark.timeout(240)
def test_wf_guided_signing_wrong_clock(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Clock {tag()}"
    seed(base, [owner], [document(title, owner, [s1], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    for shift in (DEFAULT_TTL + timedelta(days=6), timedelta(days=-365)):
        with browse(browser, base, f"/sign/{token}", shift=shift) as page:
            visible(page, page.get_by_role("heading", name=title, level=1), f"your_turn heading with the clock shifted {shift}")
            expect(page.get_by_role("heading", name="This link has expired")).to_have_count(0)
    assert SHORT_URL, "APP_SHORT_URL is not set"
    s2 = signer("Mira", "Lund")
    short_title = f"Short clock {tag()}"
    seed(SHORT_URL, [owner], [document(short_title, owner, [s2], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06)], state="in_progress")])
    short_token = invite_token(mail, s2["email"], short_title)
    link = Link(SHORT_URL, short_token)
    with browse(browser, SHORT_URL, f"/sign/{short_token}", shift=timedelta(days=-2)) as page:
        eventually(page, lambda: expect(page.get_by_role("heading", name="This link has expired", level=1)).to_be_visible(timeout=POLL_MS),
                   SHORT_TTL_S + EXPIRY_CHECK_S + LIVE_S + LIVE_SLACK_S + LOAD_S, "server-side expiry reaches the page")
    fid = Api(SHORT_URL).login(owner).doc(seed_doc_id(SHORT_URL, owner, short_title))["fields"][0]["id"]
    for r in (link.put(fid, {"typed": s2["name"]}), link.finish(), link.decline("Too late"), link.original()):
        assert r.status_code == 409 and r.json() == {"error": "link_closed", "state": "expired"}, r.text[:200]


def test_wf_guided_signing_phone_text_aperture(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Phone text aperture {tag()}"
    seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                  [fld(1, "text", 1, 0.1, 0.3, 0.35, 0.04), fld(1, "signature", 1, 0.1, 0.6, 0.3, 0.06),
                                   fld(2, "signature", 1, 0.5, 0.85, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    first = Link(base, token).state().json()["fields"][0]
    with browse(browser, base, f"/sign/{token}", viewport=APP_WIDTHS["375"], touch=True) as page:
        visible(page, page.get_by_role("heading", name=title, level=1), "signer view at 375 px")
        eventually(page, lambda: assert_box(rel_box(page, APERTURE_ID, 1), first, "aperture at 375 px"), LOAD_S,
                   "the aperture frames the text field within 0.01 at 375 px")


def test_wf_adopt_signature_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = {"name": "Ada Byrne", "email": f"ada.byrne.{tag()}@harbour-row.example"}
    title = f"Adopt {tag()}"
    fields = [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06), fld(1, "initials", 1, 0.1, 0.4, 0.1, 0.05), fld(1, "signature", 1, 0.1, 0.6, 0.3, 0.06)]
    seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")], fields + [fld(2, "signature", 1, 0.5, 0.8, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    sig1, init1, sig2 = link.state().json()["fields"][:3]
    with browse(browser, base, f"/sign/{token}") as page:
        field = page.get_by_role("button", name="Signature 1", exact=True)
        visible(page, field, "Signature 1 field")
        field.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Adopt your signature")
        visible(page, dialog, "Adopt your signature dialog")
        expect(dialog.get_by_role("tab", name="Type", selected=True)).to_be_visible()
        expect(dialog.get_by_role("textbox", name="Full name")).to_have_value("Ada Byrne")
        dialog.get_by_role("tab", name="Type").focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: expect(dialog.get_by_role("tab", name="Draw", selected=True)).to_be_visible(timeout=POLL_MS), LOAD_S, "ArrowRight selects Draw")
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: expect(dialog.get_by_role("tab", name="Type", selected=True)).to_be_visible(timeout=POLL_MS), LOAD_S, "ArrowLeft selects Type")
        for key in ["Tab"] * TAB_PRESSES + ["Shift+Tab"] * TAB_PRESSES:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the Adopt dialog"
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "Escape closes the dialog")
        focus_lands(page, field)
        page.keyboard.press("Space")
        visible(page, dialog, "Space opens the dialog")
        expect(dialog.get_by_role("tab", name="Type", selected=True)).to_be_visible()
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "Escape closes the dialog again")
        focus_lands(page, field)
        assert field_value(link, sig1["id"]) is None, "Escape stored a value"
        page.get_by_role("button", name=init1["label"], exact=True).focus()
        page.keyboard.press("Enter")
        idialog = page.get_by_role("dialog", name="Adopt your initials")
        visible(page, idialog, "Adopt your initials dialog")
        expect(idialog.get_by_role("tab", name="Type", selected=True)).to_be_visible()
        expect(idialog.get_by_role("textbox", name="Initials")).to_have_value("AB")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(idialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "Escape closes the initials dialog")
        focus_lands(page, page.get_by_role("button", name=init1["label"], exact=True))
        assert field_value(link, init1["id"]) is None and field_value(link, sig2["id"]) is None


def test_drawn_signature(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = {"name": "Ada Byrne", "email": f"ada.byrne.{tag()}@harbour-row.example"}
    title = f"Drawn {tag()}"
    seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                  [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06), fld(1, "initials", 1, 0.1, 0.35, 0.1, 0.05),
                                   fld(1, "signature", 1, 0.1, 0.5, 0.3, 0.06), fld(1, "signature", 1, 0.1, 0.65, 0.3, 0.06),
                                   fld(2, "signature", 1, 0.5, 0.85, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    f1, i1, fb, f2 = link.state().json()["fields"][:4]
    with browse(browser, base, f"/sign/{token}") as page:
        field = by_id(page, f"field-{f1['id']}")
        visible(page, field, "signature field")
        field.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Adopt your signature")
        visible(page, dialog, "Adopt dialog")
        adopt = dialog.get_by_role("button", name="Adopt and sign")
        name_box = dialog.get_by_role("textbox", name="Full name")
        name_box.focus()
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.press("Backspace")
        expect(adopt).to_be_disabled()
        page.keyboard.type("Ada Byrne")
        expect(adopt).to_be_enabled()
        adopt.click()
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "Adopt and sign closes the dialog")
        eventually(None, lambda: _true(field_value(link, f1["id"]) == "typed:Ada Byrne", "typed value not stored"),
                   SAVE_S + LIVE_SLACK_S, "typed:<text> stored")
        by_id(page, f"field-{i1['id']}").focus()
        page.keyboard.press("Enter")
        idialog = page.get_by_role("dialog", name="Adopt your initials")
        visible(page, idialog, "Adopt your initials dialog")
        idialog.get_by_role("button", name="Adopt and sign").click()
        eventually(None, lambda: _true(field_value(link, i1["id"]) == "typed:AB", "initials not stored"), SAVE_S + LIVE_SLACK_S, "typed:AB stored")
        by_id(page, f"field-{fb['id']}").focus()
        page.keyboard.press("Enter")
        eventually(None, lambda: _true(field_value(link, fb["id"]) == "typed:Ada Byrne", "later signature empty"), SAVE_S + LIVE_SLACK_S,
                   "a later signature field fills on one activation")
        expect(dialog).to_have_count(0)
        field.focus()
        page.keyboard.press("Space")
        visible(page, dialog, "Space on a filled field reopens the dialog")
        dialog.get_by_role("tab", name="Draw").click()
        pad = dialog.get_by_role("img", name="Signature pad")
        visible(page, pad, "signature pad")
        expect(adopt).to_be_disabled()
        box = pad.bounding_box()
        assert box is not None
        mouse_stroke(page, box)
        eventually(page, lambda: expect(adopt).to_be_enabled(timeout=POLL_MS), LOAD_S, "a stroke enables Adopt and sign")
        dialog.get_by_role("button", name="Clear").click()
        eventually(page, lambda: expect(adopt).to_be_disabled(timeout=POLL_MS), LOAD_S, "Clear disables Adopt and sign")
        mouse_stroke(page, box)
        eventually(page, lambda: expect(adopt).to_be_enabled(timeout=POLL_MS), LOAD_S, "stroke again")
        adopt.click()
        eventually(None, lambda: _true(field_value(link, f1["id"]) == "drawn", "drawn not stored"), SAVE_S + LIVE_SLACK_S, "drawn stored")
    copy = {"error": "validation", "fields": {"typed": "Enter 1 to 100 characters."}}
    r = link.put(f2["id"], {"typed": ""})
    assert r.status_code == 422 and r.json() == copy
    r = link.put(f2["id"], {"typed": "🖋" * (TYPED_LIMIT + 1)})
    assert r.status_code == 422 and r.json() == copy
    assert field_value(link, f2["id"]) is None, "a refused adoption stored a value"
    ok = link.put(f2["id"], {"typed": "🖋" * TYPED_LIMIT})
    assert ok.status_code == 200 and ok.json()["value"] == "typed:" + "🖋" * TYPED_LIMIT


def test_wf_adopt_signature_text_limit(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Text limit {tag()}"
    seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                  [fld(1, "text", 1, 0.1, 0.3, 0.3, 0.04), fld(1, "signature", 1, 0.1, 0.5, 0.3, 0.06),
                                   fld(2, "signature", 1, 0.5, 0.8, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    tf = link.state().json()["fields"][0]
    with browse(browser, base, f"/sign/{token}") as page:
        box = page.get_by_role("textbox", name=tf["label"])
        visible(page, box, "textbox '<label>'")
        box.focus()
        page.keyboard.insert_text("🖋🖋a")
        visible(page, page.get_by_text(counter_copy(3, TEXT_LIMIT), exact=True), "live counter counts emoji as one")
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.press("Backspace")
        page.keyboard.insert_text("a" * (TEXT_LIMIT - 1))
        page.keyboard.insert_text("🖋🖋")
        eventually(page, lambda: _true(box.evaluate("e => Array.from(e.value).length") == TEXT_LIMIT, "box does not hold 200 code points"),
                   LOAD_S, "the box stops at 200 code points")
        visible(page, page.get_by_text(counter_copy(TEXT_LIMIT, TEXT_LIMIT), exact=True), "counter at the limit")
        page.get_by_role("button", name="Next", exact=True).click()
        eventually(None, lambda: _true(len(field_value(link, tf["id"]) or "") == TEXT_LIMIT, "value not 200 code points"),
                   SAVE_S + LIVE_SLACK_S, "200 code points saved")
    r = link.put(tf["id"], {"value": "🖋" * (TEXT_LIMIT + 1)})
    assert r.status_code == 422 and r.json() == {"error": "validation", "fields": {"value": "Text can be at most 200 characters."}}
    assert link.put(tf["id"], {"value": "🖋" * TEXT_LIMIT}).status_code == 200


def test_wf_adopt_signature_active_tab(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Active tab {tag()}"
    seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                  [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06), fld(1, "text", 1, 0.1, 0.5, 0.3, 0.04),
                                   fld(2, "signature", 1, 0.5, 0.8, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    sig, txt = link.state().json()["fields"][:2]
    with browse(browser, base, f"/sign/{token}") as page:
        field = by_id(page, f"field-{sig['id']}")
        visible(page, field, "signature field")
        field.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Adopt your signature")
        visible(page, dialog, "Adopt your signature dialog")
        adopt = dialog.get_by_role("button", name="Adopt and sign")
        expect(dialog.get_by_role("textbox", name="Full name")).to_have_value(s1["name"])
        expect(adopt).to_be_enabled()
        dialog.get_by_role("tab", name="Type").focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: (expect(dialog.get_by_role("tab", name="Draw", selected=True)).to_be_visible(timeout=POLL_MS),
                                  expect(adopt).to_be_disabled(timeout=POLL_MS)),
                   LOAD_S, "an empty Draw pad disables Adopt and sign even with a typed name")
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: (expect(dialog.get_by_role("tab", name="Type", selected=True)).to_be_visible(timeout=POLL_MS),
                                  expect(adopt).to_be_enabled(timeout=POLL_MS)),
                   LOAD_S, "back on Type with a name, Adopt and sign is enabled")
        for _ in range(TAB_PRESSES):
            if adopt.evaluate("b => b === document.activeElement"):
                break
            page.keyboard.press("Tab")
        focus_lands(page, adopt)
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "Enter on Adopt and sign closes the dialog")
        eventually(page, lambda: _true(focused(page, f"field-{sig['id']}"), "focus not back on the field"), LOAD_S,
                   "focus returns to the adopted field")
        eventually(None, lambda: _true(field_value(link, sig["id"]) == f"typed:{s1['name']}", "typed value not stored"),
                   SAVE_S + LIVE_SLACK_S, "typed:<name> stored")
        page.keyboard.press("Enter")
        eventually(page, lambda: (_true(focused(page, f"field-{txt['id']}"), "focus not in the text field"),
                                  expect(page.get_by_role("status", name="Signing progress")).to_contain_text(
                                      progress_copy(2, 2, txt["label"], 1), timeout=POLL_MS)),
                   LOAD_S, "Enter on the filled signature field acts as Next")


def test_wf_phone_signing_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Phone {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.4, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.5, 0.8, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    fid = link.state().json()["fields"][0]["id"]
    with browse(browser, base, f"/sign/{token}", viewport=APP_WIDTHS["375"], touch=True) as page:
        field = by_id(page, f"field-{fid}")
        visible(page, field, "signature field on the phone")
        layout(page)
        tap(field)
        dialog = page.get_by_role("dialog", name="Adopt your signature")
        visible(page, dialog, "tap opens the Adopt dialog")
        tap(dialog.get_by_role("tab", name="Draw"))
        pad = dialog.get_by_role("img", name="Signature pad")
        visible(page, pad, "signature pad")
        box = pad.bounding_box()
        assert box is not None
        touch_stroke(page, box)
        adopt = dialog.get_by_role("button", name="Adopt and sign")
        eventually(page, lambda: expect(adopt).to_be_enabled(timeout=POLL_MS), LOAD_S, "touch stroke enables Adopt and sign")
        tap(adopt)
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "dialog closes")
        tap(page.get_by_role("button", name="Finish and sign"))
        visible(page, page.get_by_role("heading", name=f"You signed {title}", level=1), "you-signed state")
    assert link.state().json()["state"] == "signed_waiting"
    d = Api(base).login(owner).doc(w.docs[title])
    assert d["recipients"][0]["status"] == "signed" and d["fields"][0]["value"] == "drawn"


def test_wf_phone_signing_pad(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Pad {tag()}"
    seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                  [fld(1, "signature", 1, 0.1, 0.7, 0.3, 0.06), fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06),
                                   fld(2, "signature", 1, 0.5, 0.9, 0.3, 0.06)], state="in_progress", sample="letter-3")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    f1, f2 = link.state().json()["fields"][:2]
    with browse(browser, base, f"/sign/{token}", viewport=APP_WIDTHS["375"], touch=True) as page:
        field = by_id(page, f"field-{f1['id']}")
        visible(page, field, "signature field")
        tap(field)
        dialog = page.get_by_role("dialog", name="Adopt your signature")
        visible(page, dialog, "Adopt dialog")
        tap(dialog.get_by_role("tab", name="Draw"))
        pad = dialog.get_by_role("img", name="Signature pad")
        visible(page, pad, "signature pad")
        dbox, pbox = dialog.bounding_box(), pad.bounding_box()
        assert dbox and pbox
        assert dbox["x"] >= 0 and dbox["x"] + dbox["width"] <= APP_WIDTHS["375"][0], f"dialog spans {dbox}"
        assert pbox["height"] >= PAD_MIN_PX, f"pad is {pbox['height']} px tall"
        before = scroll_settled(page)
        pbox = pad.bounding_box()
        assert pbox is not None
        touch_stroke(page, pbox, steps=12)
        advance(page, STEP_MS)
        assert page.evaluate("() => [window.scrollX, window.scrollY]") == before, "drawing scrolled the page"
        eventually(page, lambda: expect(dialog.get_by_role("button", name="Adopt and sign")).to_be_enabled(timeout=POLL_MS), LOAD_S, "stroke recorded")
    copy = {"error": "validation", "fields": {"strokes": "Draw at least one stroke of at most 5,000 points."}}
    r = link.put(f2["id"], {"strokes": []})
    assert r.status_code == 422 and r.json() == copy
    over = [[[i / STROKE_POINT_LIMIT, 0.5] for i in range(STROKE_POINT_LIMIT + 1)]]
    r = link.put(f2["id"], {"strokes": over})
    assert r.status_code == 422 and r.json() == copy
    ok = link.put(f2["id"], {"strokes": [over[0][:STROKE_POINT_LIMIT]]})
    assert ok.status_code == 200 and ok.json()["value"] == "drawn"


def test_wf_phone_signing_header(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Phone header {tag()}"
    seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                  [fld(1, "signature", 1, 0.1, 0.4, 0.3, 0.06), fld(2, "signature", 1, 0.5, 0.8, 0.3, 0.06)],
                                  state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    width = APP_WIDTHS["375"][0]
    with browse(browser, base, f"/sign/{token}", viewport=APP_WIDTHS["375"], touch=True) as page:
        visible(page, page.get_by_role("heading", name=title, level=1), "signer view on the phone")
        group = page_group(page, 1, 1)
        visible(page, group, "page group")
        gb = group.bounding_box()
        assert gb is not None and gb["width"] >= FILL_SHARE * width, f"the page is {gb and gb['width']} px wide at 375 px"
        tops = []
        for name in ("Previous", "Next", "Finish and sign", "Decline"):
            b = page.get_by_role("button", name=name, exact=True).bounding_box()
            assert b is not None and b["height"] >= TAP_MIN_PX, f"{name} is {b} at 375 px"
            assert b["x"] >= 0 and b["x"] + b["width"] <= width, f"{name} is outside the screen: {b}"
            tops.append(b["y"])
        rows = 1 + sum(1 for a, b in zip(sorted(tops), sorted(tops)[1:]) if b - a >= TAP_MIN_PX / 2)
        assert rows == 2, f"header controls sit on {rows} row(s) at 375 px; tops {sorted(tops)}"


def test_wf_phone_signing_tap_walk(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Phone walk {tag()}"
    seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                  [fld(1, "text", 1, 0.1, 0.3, 0.35, 0.04), fld(1, "signature", 1, 0.1, 0.6, 0.3, 0.06),
                                   fld(2, "signature", 1, 0.5, 0.85, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    txt, sig = link.state().json()["fields"][:2]
    note = f"Approved {tag()}"
    with browse(browser, base, f"/sign/{token}", viewport=APP_WIDTHS["375"], touch=True) as page:
        box = page.get_by_role("textbox", name=txt["label"])
        visible(page, box, "text field on the phone")
        visible(page, page.get_by_text(left_copy(2), exact=True), "count '2 left'")
        tap(box)
        page.keyboard.insert_text(note)
        tap(page.get_by_role("button", name="Next", exact=True))
        eventually(page, lambda: (_true(focused(page, f"field-{sig['id']}"), "focus not in the signature field"),
                                  expect(page.get_by_role("status", name="Signing progress")).to_contain_text(
                                      progress_copy(2, 2, sig["label"], 1), timeout=POLL_MS),
                                  expect(page.get_by_text(left_copy(1), exact=True)).to_be_visible(timeout=POLL_MS)),
                   LOAD_S, "tapping Next saves the text, moves to the signature, updates the count and announces it")
        eventually(None, lambda: _true(field_value(link, txt["id"]) == note, "text not saved"), SAVE_S + LIVE_SLACK_S, "text saved")
        tap(by_id(page, f"field-{sig['id']}"))
        dialog = page.get_by_role("dialog", name="Adopt your signature")
        visible(page, dialog, "tap opens the Adopt dialog")
        tap(dialog.get_by_role("button", name="Adopt and sign"))
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "tap on Adopt and sign closes the dialog")
        visible(page, page.get_by_text(left_copy(0), exact=True), "count '0 left'")
        tap(page.get_by_role("button", name="Finish and sign"))
        visible(page, page.get_by_role("heading", name=f"You signed {title}", level=1), "you-signed state")
    assert link.state().json()["state"] == "signed_waiting"


def test_wf_phone_signing_text_field_box(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Phone text box {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                      [fld(1, "text", 1, 0.1, 0.3, 0.35, 0.04), fld(1, "signature", 1, 0.1, 0.6, 0.3, 0.06),
                                       fld(2, "signature", 1, 0.5, 0.85, 0.3, 0.06)], state="in_progress")])
    stored = [f for f in Api(base).login(owner).doc(w.docs[title])["fields"] if f["kind"] == "text"][0]
    token = invite_token(mail, s1["email"], title)
    with browse(browser, base, f"/sign/{token}", viewport=APP_WIDTHS["375"], touch=True) as page:
        visible(page, page.get_by_role("textbox", name=stored["label"], exact=True), "text field on the phone")
        eventually(page, lambda: assert_box(rel_box(page, f"field-{stored['id']}", 1), stored, "text field at 375 px"), LOAD_S,
                   "the signer's text field renders within 0.01 of its stored fractions at 375 px")


def test_wf_decline_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Decline keys {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                      [fld(1, "signature", 1, 0.1, 0.4, 0.3, 0.06), fld(2, "signature", 1, 0.5, 0.8, 0.3, 0.06)], state="in_progress")])
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    r = link.decline("")
    assert r.status_code == 422 and r.json() == {"error": "validation", "fields": {"reason": "Enter a reason for declining."}}
    r = link.decline("🖋" * (REASON_LIMIT + 1))
    assert r.status_code == 422 and r.json() == {"error": "validation", "fields": {"reason": "Reason can be at most 500 characters."}}
    with browse(browser, base, f"/sign/{token}") as page:
        opener = page.get_by_role("button", name="Decline", exact=True)
        visible(page, opener, "Decline button")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Decline to sign")
        visible(page, dialog, "Decline to sign dialog")
        reason = dialog.get_by_role("textbox", name="Reason")
        submit = dialog.get_by_role("button", name="Decline", exact=True)
        submit.focus()
        page.keyboard.press("Enter")
        visible(page, dialog.get_by_text("Enter a reason for declining.", exact=True), "empty-reason error")
        focus_lands(page, reason)
        page.keyboard.type("abc")
        visible(page, dialog.get_by_text(counter_copy(3, REASON_LIMIT), exact=True), "live counter")
        page.keyboard.insert_text("x" * (REASON_LIMIT - 3))
        page.keyboard.insert_text("y")
        eventually(page, lambda: _true(reason.evaluate("e => Array.from(e.value).length") == REASON_LIMIT, "501st character accepted"),
                   LOAD_S, "reason box stops at 500")
        visible(page, dialog.get_by_text(counter_copy(REASON_LIMIT, REASON_LIMIT), exact=True), "counter at the limit")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), LOAD_S, "Escape closes")
        focus_lands(page, opener)
        page.keyboard.press("Enter")
        visible(page, dialog, "dialog reopens by keyboard")
        reason.focus()
        page.keyboard.press("ControlOrMeta+a")
        reason_text = f"Terms changed {tag()}"
        page.keyboard.type(reason_text)
        submit.focus()
        page.keyboard.press("Enter")
        visible(page, page.get_by_role("heading", name="You declined this document", level=1), "decliner's page")
    d = Api(base).login(owner).doc(w.docs[title])
    assert d["status"] == "declined" and d["recipients"][0]["declineReason"] == reason_text


def test_wf_decline_closes_document(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Cora", "Lindqvist", "owner")
    s1, s2, s3 = signer("Ines", "Okafor"), signer("Tomas", "Reyes"), signer("Mira", "Lund")
    title = f"Decline close {tag()}"
    fields = [fld(k, "signature", 1, 0.1, 0.2 * k, 0.3, 0.06) for k in (1, 2, 3)]
    w = seed(base, [owner], [document(title, owner, [s1, s2, s3], fields, state="in_progress", signed=1)])
    doc_id = w.docs[title]
    token = invite_token(mail, s2["email"], title)
    reason = f"Rate is wrong {tag()}"
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as sender:
        visible(sender, order_row(sender, 2, s2["name"]), "sender's signing order")
        with browse(browser, base, f"/sign/{token}") as page:
            page.get_by_role("button", name="Decline", exact=True).click()
            dialog = page.get_by_role("dialog", name="Decline to sign")
            dialog.get_by_role("textbox", name="Reason").fill(reason)
            dialog.get_by_role("button", name="Decline", exact=True).click()
            visible(page, page.get_by_role("heading", name="You declined this document", level=1), "decliner's page")
            visible(page, page.get_by_text(f"{s2['name']} declined to sign. No further signatures are needed.", exact=True), "declined body")
        eventually(sender, lambda: (expect(sender.get_by_text(f"{s2['name']} declined: {reason}", exact=True)).to_be_visible(timeout=POLL_MS),
                                    expect(order_row(sender, 1, s1["name"])).to_contain_text("Not binding", timeout=POLL_MS),
                                    expect(sender.get_by_text("Declined", exact=True).first).to_be_visible(timeout=POLL_MS)),
                   LIVE_S + LIVE_SLACK_S + LOAD_S, "sender sees the declined banner, Not binding and Declined live")
    d = Api(base).login(owner).doc(doc_id)
    assert d["status"] == "declined" and all(r["binding"] is False for r in d["recipients"])
    assert d["recipients"][1]["status"] == "declined" and d["recipients"][1]["declineReason"] == reason
    for addr in (owner["email"], s1["email"]):
        msg = await_mail(mail, addr, f"Declined: {title}")[0]
        assert f"Reason: {reason}" in text(msg).splitlines()
    for addr in (s2["email"], s3["email"]):
        assert not mails(mail, addr, f"Declined: {title}"), f"{addr} received a decline notice"


def test_wf_decline_void(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    team_owner, m1, m2, viewer = (person("Ada", "Byrne", "owner"), person("Cora", "Lindqvist", "member"),
                                  person("Jonas", "Vale", "member"), person("Pia", "Hart", "viewer"))
    s1, s2, s3 = signer("Ines", "Okafor"), signer("Tomas", "Reyes"), signer("Mira", "Lund")
    t1, t2, t3 = f"Void own {tag()}", f"Void other {tag()}", f"Void draft {tag()}"
    fields = [fld(k, "signature", 1, 0.1, 0.2 * k, 0.3, 0.06) for k in (1, 2, 3)]
    w = seed(base, [team_owner, m1, m2, viewer], [
        document(t1, m1, [s1, s2, s3], fields, state="in_progress", signed=1),
        document(t2, m2, [signer("Lena", "Moss")], fields[:1], state="in_progress"),
        document(t3, m1, [signer("Otto", "Brand")], fields[:1]),
    ])
    d1 = w.docs[t1]
    for u in (m2, viewer):
        r = Api(base).login(u).post(f"/api/documents/{d1}/void", {"reason": "Not mine"})
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert Api(base).login(m1).doc(d1)["status"] == "in_progress"
    with browse(browser, base, f"/documents/{d1}", user=m2) as page:
        visible(page, page.get_by_role("heading", name=t1, level=1), "document page for another member")
        expect(page.get_by_role("button", name="Void document")).to_have_count(0)
    reason = f"Wrong rate {tag()}"
    with browse(browser, base, f"/documents/{d1}", user=m1) as page:
        opener = page.get_by_role("button", name="Void document")
        visible(page, opener, "Void document")
        opener.click()
        dialog = page.get_by_role("dialog", name="Void document")
        dialog.get_by_role("button", name="Void", exact=True).click()
        visible(page, dialog.get_by_text("Enter a reason for voiding.", exact=True), "empty-reason error")
        dialog.get_by_role("textbox", name="Reason").fill(reason)
        dialog.get_by_role("button", name="Void", exact=True).click()
        visible(page, page.get_by_text(f"Voided by {m1['name']}: {reason}", exact=True), "voided banner")
    d = Api(base).login(m1).doc(d1)
    assert d["status"] == "voided" and all(r["binding"] is False for r in d["recipients"])
    assert Api(base).login(team_owner).post(f"/api/documents/{w.docs[t2]}/void", {"reason": "Team cleanup"}).json()["status"] == "voided"
    r = Api(base).login(m1).post(f"/api/documents/{w.docs[t3]}/void", {"reason": "Draft"})
    assert r.status_code == 409 and r.json() == {"error": "invalid_state", "status": "draft"}
    for addr in (m1["email"], s1["email"], s2["email"]):
        assert f"Reason: {reason}" in text(await_mail(mail, addr, f"Voided: {t1}")[0]).splitlines()
    assert not mails(mail, s3["email"], f"Voided: {t1}"), "a waiting signer got the void notice"


CLOSED_CASES = ["declined", "voided", "expired", "replaced"]


@pytest.mark.timeout(300)
@pytest.mark.parametrize("case", CLOSED_CASES, ids=CLOSED_CASES)
def test_wf_decline_closed_links(browser: Browser, app_url: str, mail: Mailpit, case: str) -> None:
    base = app_url.rstrip("/") if case in ("declined", "voided") else SHORT_URL
    assert base, "APP_SHORT_URL is not set"
    owner = person("Cora", "Lindqvist", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Closed {case} {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.1, 0.6, 0.3, 0.06)], state="in_progress")])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    token = invite_token(mail, s1["email"], title)
    link = Link(base, token)
    fid = api.doc(doc_id)["fields"][0]["id"]
    if case == "declined":
        link.sign(s1["name"])
        assert Link(base, invite_token(mail, s2["email"], title)).decline("No longer needed").status_code == 200
        heading, body = "This document was declined", f"{s2['name']} declined to sign. No further signatures are needed."
    elif case == "voided":
        assert api.post(f"/api/documents/{doc_id}/void", {"reason": "Sent in error"}).status_code == 200
        heading, body = "This document was voided", f"{owner['name']} voided it: Sent in error"
    else:
        eventually(None, lambda: _true(link.state().json()["state"] == "expired", "link not expired"),
                   SHORT_TTL_S + EXPIRY_CHECK_S + LOAD_S, "short-timer link expires")
        heading, body = "This link has expired", f"Ask {owner['name']} to send a new link."
        if case == "replaced":
            rid = api.doc(doc_id)["recipients"][0]["id"]
            assert api.post(f"/api/documents/{doc_id}/recipients/{rid}/new-link").status_code == 200
            fresh = token_of(await_mail(mail, s1["email"], f"New link: {title}")[0])
            assert fresh != token
            fresh_expires = iso(api.doc(doc_id)["recipients"][0]["linkExpiresAt"])
            fresh_state = Link(base, fresh).state().json()["state"]
            if fresh_expires > datetime.now(timezone.utc) + timedelta(seconds=CLOCK_SLACK_S):
                assert fresh_state == "your_turn", f"new link answered {fresh_state} before its expiry"
    state = case if case in ("declined", "voided") else "expired"
    assert link.state().json()["state"] == state
    for r in (link.original(), link.put(fid, {"typed": s1["name"]}), link.finish(), link.decline("Late")):
        assert r.status_code == 409 and r.json() == {"error": "link_closed", "state": state}, f"{case}: {r.status_code} {r.text[:200]}"
    with browse(browser, base, f"/sign/{token}") as page:
        visible(page, page.get_by_role("heading", name=heading, level=1), f"{case}: state heading")
        visible(page, page.get_by_text(body, exact=True), f"{case}: state body")
        expect(page.get_by_role("button", name="Finish and sign")).to_have_count(0)


def test_wf_live_dashboard_table(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    first_name = "Ines Okafor"
    sig = [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06), fld(2, "signature", 1, 0.1, 0.6, 0.3, 0.06)]
    t = tag()
    rows = {
        f"Alpha {t}": ("draft", "Draft", "Add signers and fields"),
        f"Bravo {t}": ("in_progress", "In progress", f"Waiting for {first_name} (1 of 2)"),
        f"Charlie {t}": ("completed", "Completed", "None"),
        f"Delta {t}": ("declined", "Declined", "None"),
        f"Echo {t}": ("voided", "Voided", "None"),
    }
    seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor"), signer("Tomas", "Reyes")], sig, state=st)
                         for title, (st, _, _) in rows.items()])
    api = Api(base).login(owner)
    listed = {d["title"]: d for d in api.get("/api/documents?filter=all").json()["documents"]}
    for title, (st, _, step) in rows.items():
        assert listed[title]["status"] == st, f"{title} status {listed[title]['status']}"
        assert listed[title]["nextStep"] == step, f"{title} nextStep {listed[title]['nextStep']!r}"
    expected = {k: (v[1], v[2]) for k, v in rows.items()}
    filters = {"in_progress": {f"Bravo {t}"}, "completed": {f"Charlie {t}"}, "closed": {f"Delta {t}", f"Echo {t}"}}
    for flt, titles in filters.items():
        got = {d["title"] for d in api.get(f"/api/documents?filter={flt}").json()["documents"]} & set(rows)
        assert got == titles, f"filter={flt} listed {got}"
    with browse(browser, base, "/documents", user=owner) as page:
        for title, (word, step) in expected.items():
            row = doc_row(page, title)
            visible(page, row, f"row for {title}")
            expect(row.get_by_role("cell", name=word, exact=True)).to_be_visible()
            expect(row.get_by_role("cell", name=step, exact=True)).to_be_visible()
        tablist = page.get_by_role("tablist", name="Status filter")
        tablist.get_by_role("tab", name="All").focus()
        for tab, flt in (("In progress", "in_progress"), ("Completed", "completed"), ("Declined or voided", "closed")):
            page.keyboard.press("ArrowRight")
            eventually(page, lambda tb=tab: expect(tablist.get_by_role("tab", name=tb, selected=True)).to_be_focused(timeout=POLL_MS),
                       LOAD_S, f"ArrowRight selects and focuses {tab}")
            for title in expected:
                want = 1 if title in filters[flt] else 0
                eventually(page, lambda ti=title, n=want: expect(doc_row(page, ti)).to_have_count(n, timeout=POLL_MS), LOAD_S,
                           f"{tab} tab shows {title}: {want}")
        tablist.get_by_role("tab", name="All").click()
        page.set_viewport_size({"width": APP_WIDTHS["375"][0], "height": APP_WIDTHS["375"][1]})
        cards = page.get_by_role("list", name="Documents")
        visible(page, cards, "card list 'Documents' at 375 px")
        for title, (word, step) in expected.items():
            card = cards.get_by_role("listitem").filter(has=page.get_by_role("link", name=title, exact=True))
            visible(page, card, f"card for {title}")
            expect(card).to_contain_text(word)
            expect(card).to_contain_text(step)
        layout(page)


def test_wf_live_dashboard_updates(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Live rows {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.1, 0.6, 0.3, 0.06)], state="in_progress")])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    t1 = invite_token(mail, s1["email"], title)
    with browse(browser, base, "/documents", user=owner, shift=timedelta(days=3)) as listing, \
            browse(browser, base, f"/documents/{doc_id}", user=owner, shift=timedelta(days=-3)) as detail:
        row = doc_row(listing, title)
        visible(listing, row.get_by_role("cell", name=f"Waiting for {s1['name']} (1 of 2)", exact=True), "initial Next step")
        visible(detail, detail.get_by_role("heading", name=title, level=1), "document page")
        Link(base, t1).sign(s1["name"])
        step = f"Waiting for {s2['name']} (2 of 2)"
        eventually(listing, lambda: expect(row.get_by_role("cell", name=step, exact=True)).to_be_visible(timeout=POLL_MS),
                   LIVE_S + LIVE_SLACK_S, "list Next step updates within 3 s")
        eventually(detail, lambda: expect(detail.get_by_text(step, exact=True).first).to_be_visible(timeout=POLL_MS),
                   LIVE_S + LIVE_SLACK_S, "document page Next step updates within 3 s")
        Link(base, invite_token(mail, s2["email"], title)).sign(s2["name"])
        eventually(None, lambda: _true(api.doc(doc_id)["status"] == "completed", "not completed"), LOAD_S, "document completes")
        updates = listing.get_by_role("status", name="Document updates")
        eventually(listing, lambda: (expect(row.get_by_role("cell", name="Completed", exact=True)).to_be_visible(timeout=POLL_MS),
                                     expect(row.get_by_role("cell", name="None", exact=True)).to_be_visible(timeout=POLL_MS),
                                     expect(updates).to_contain_text(f"{title}: Completed", timeout=POLL_MS)),
                   LIVE_S + LIVE_SLACK_S, "Completed row and Document updates announcement within 3 s")


@pytest.mark.timeout(300)
def test_wf_live_dashboard_reminders(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner, stranger = person("Ada", "Byrne", "owner"), person("Cora", "Lindqvist", "owner")
    s1, s3 = signer("Ines", "Okafor"), signer("Mira", "Lund")
    title, race = f"Remind {tag()}", f"Remind race {tag()}"
    sig = [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06)]
    w = seed(base, [owner], [document(title, owner, [s1], sig, state="in_progress", tz="Europe/London"),
                             document(race, owner, [s3], sig, state="in_progress")])
    seed(base, [stranger])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    other = Api(base).login(stranger)
    for path in (f"/api/documents/{doc_id}/remind", f"/api/documents/{doc_id}/recipients/{api.doc(doc_id)['recipients'][0]['id']}/new-link"):
        r = other.post(path)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
    assert MAIL_DOWN_URL, "APP_MAIL_DOWN_URL is not set"
    r = Api(MAIL_DOWN_URL).login(owner).post(f"/api/documents/{doc_id}/remind")
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable"}
    assert api.doc(doc_id)["reminderAvailableAt"] is None, "a failed reminder started the cooldown"
    first = api.post(f"/api/documents/{doc_id}/remind")
    assert first.status_code == 200
    available = first.json()["reminderAvailableAt"]
    assert api.doc(doc_id)["reminderAvailableAt"] == available
    second = api.post(f"/api/documents/{doc_id}/remind")
    assert second.status_code == 429 and second.json() == {"error": "reminder_cooldown", "availableAt": available}
    msgs = await_mail(mail, s1["email"], f"Reminder: please sign {title}")
    assert len(msgs) == 1 and "Open the document: " in text(msgs[0])
    local = iso(available).astimezone(ZoneInfo("Europe/London"))
    choices = {f"Next reminder after {(local + timedelta(minutes=m)).strftime('%Y-%m-%d %H:%M')} Europe/London" for m in (0, 1)}
    with browse(browser, base, f"/documents/{doc_id}", user=owner, shift=timedelta(days=5)) as page:
        btn = page.get_by_role("button", name=re.compile(r"^Next reminder after "))
        visible(page, btn, "cooldown button")
        expect(btn).to_be_disabled()
        assert btn.inner_text().strip() in choices, f"cooldown copy {btn.inner_text()!r}"
    clients = [Api(base).login(owner) for _ in range(2)]
    results = together([lambda c=c: c.post(f"/api/documents/{w.docs[race]}/remind") for c in clients])
    assert sorted(r.status_code for r in results) == [200, 429]
    assert len(await_mail(mail, s3["email"], f"Reminder: please sign {race}")) == 1
    assert SHORT_URL, "APP_SHORT_URL is not set"
    s2 = signer("Tomas", "Reyes")
    short_title = f"Remind short {tag()}"
    ws = seed(SHORT_URL, [owner], [document(short_title, owner, [s2], sig, state="in_progress")])
    sid = ws.docs[short_title]
    sapi = Api(SHORT_URL).login(owner)
    with browse(browser, SHORT_URL, f"/documents/{sid}", user=owner, shift=timedelta(hours=-9)) as page:
        eventually(None, lambda: _true(sapi.doc(sid)["recipients"][0]["status"] == "expired", "not expired"),
                   SHORT_TTL_S + EXPIRY_CHECK_S + LOAD_S, "short link expires")
        r = sapi.post(f"/api/documents/{sid}/remind")
        assert r.status_code == 409 and r.json() == {"error": "invalid_state", "status": "expired"}
        eventually(page, lambda: expect(page.get_by_role("button", name="Send reminder")).to_have_count(0, timeout=POLL_MS),
                   EXPIRY_CHECK_S + LIVE_S + LIVE_SLACK_S, "Send reminder absent while the link is expired")
        rid = sapi.doc(sid)["recipients"][0]["id"]
        assert sapi.post(f"/api/documents/{sid}/recipients/{rid}/new-link").status_code == 200
        r = sapi.post(f"/api/documents/{sid}/remind")
        assert r.status_code == 200, f"reminder right after a new link answered {r.status_code}: {r.text[:200]}"
        due = time.monotonic() + (iso(r.json()["reminderAvailableAt"]) - datetime.now(timezone.utc)).total_seconds()
        visible(page, page.get_by_role("button", name=re.compile(r"^Next reminder after ")), "cooldown shown live", seconds=LIVE_S + LIVE_SLACK_S)
        eventually(page, lambda: expect(page.get_by_role("button", name="Send reminder")).to_be_enabled(timeout=POLL_MS),
                   max(due - time.monotonic(), 0) + LIVE_S + LIVE_SLACK_S + CLOCK_SLACK_S,
                   "Send reminder returns within 3 s of reminderAvailableAt")


def test_wf_live_dashboard_cards_live(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Live cards {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.1, 0.6, 0.3, 0.06)], state="in_progress")])
    api = Api(base).login(owner)
    with browse(browser, base, "/documents", user=owner, viewport=APP_WIDTHS["375"]) as page:
        card = page.get_by_role("list", name="Documents").get_by_role("listitem").filter(
            has=page.get_by_role("link", name=title, exact=True))
        eventually(page, lambda: expect(card).to_contain_text(f"Waiting for {s1['name']} (1 of 2)", timeout=POLL_MS), LOAD_S,
                   "card shows the first Next step")
        Link(base, invite_token(mail, s1["email"], title)).sign(s1["name"])
        eventually(page, lambda: expect(card).to_contain_text(f"Waiting for {s2['name']} (2 of 2)", timeout=POLL_MS),
                   LIVE_S + LIVE_SLACK_S, "card Next step updates within 3 s")
        Link(base, invite_token(mail, s2["email"], title)).sign(s2["name"])
        eventually(None, lambda: _true(api.doc(w.docs[title])["status"] == "completed", "not completed"), LOAD_S, "document completes")
        eventually(page, lambda: (expect(card).to_contain_text("Completed", timeout=POLL_MS),
                                  expect(page.get_by_role("status", name="Document updates")).to_contain_text(f"{title}: Completed", timeout=POLL_MS)),
                   LIVE_S + LIVE_SLACK_S, "card turns Completed within 3 s with the Document updates announcement")
        layout(page)


def test_wf_live_dashboard_tab_roving(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Roving {tag()}"
    seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06)])])
    with browse(browser, base, "/documents", user=owner) as page:
        tablist = page.get_by_role("tablist", name="Status filter")
        visible(page, tablist.get_by_role("tab", name="All"), "All tab")
        for presses, name in ((0, "All"), (2, "Completed")):
            tablist.get_by_role("tab", name="All").focus()
            for _ in range(presses):
                page.keyboard.press("ArrowRight")
            tab = tablist.get_by_role("tab", name=name, selected=True)
            eventually(page, lambda tb=tab: expect(tb).to_be_focused(timeout=POLL_MS), LOAD_S, f"{name} selected and focused")
            in_order = tablist.evaluate("t => Array.from(t.querySelectorAll('[role=tab]')).filter(x => x.tabIndex >= 0).length")
            assert in_order == 1, f"{in_order} tabs are in the Tab order with {name} selected"
            page.keyboard.press("Tab")
            assert not tablist.evaluate("t => t.contains(document.activeElement)"), "Tab moved to another tab instead of leaving the tablist"
            page.keyboard.press("Shift+Tab")
            focus_lands(page, tab)


def test_wf_complete_and_seal_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Journey {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.1, 0.6, 0.3, 0.06)], state="in_progress")])
    doc_id = w.docs[title]
    t1 = invite_token(mail, s1["email"], title)
    with browse(browser, base, f"/sign/{t1}") as waiting:
        fill_in_view(waiting, Link(base, t1), s1["name"])
        waiting.get_by_role("button", name="Finish and sign").click()
        visible(waiting, waiting.get_by_role("heading", name=f"You signed {title}", level=1), "signer 1 signed state")
        t2 = invite_token(mail, s2["email"], title)
        with browse(browser, base, f"/sign/{t2}") as page:
            fill_in_view(page, Link(base, t2), s2["name"])
            page.get_by_role("button", name="Finish and sign").click()
            visible(page, page.get_by_role("heading", name=re.compile(rf"^(You signed {re.escape(title)}|{re.escape(title)} is complete)$"), level=1), "signer 2 done")
        eventually(waiting, lambda: (expect(waiting.get_by_role("heading", name=f"{title} is complete", level=1)).to_be_visible(timeout=POLL_MS),
                                     expect(waiting.get_by_text("Everyone has signed.", exact=True)).to_be_visible(timeout=POLL_MS)),
                   LOAD_S, "the waiting signer's page turns completed live")
        href = waiting.get_by_role("link", name="Download completed PDF").get_attribute("href")
    assert href
    d = Api(base).login(owner).doc(doc_id)
    assert d["status"] == "completed"
    stored = S3().get(f"documents/{doc_id}/completed.pdf")
    assert hashlib.sha256(stored).hexdigest() == d["completedSha256"]
    from_link = httpx.get(urljoin(f"{base}/sign/{t1}", href), timeout=HTTP_TIMEOUT_S)
    for r in (from_link, Link(base, t2).completed(), Api(base).login(owner).get(f"/api/documents/{doc_id}/completed.pdf")):
        assert r.status_code == 200 and r.content == stored
    link = Link(base, t1)
    fid = d["fields"][0]["id"]
    for r in (link.put(fid, {"typed": "Changed"}), link.original(), link.finish()):
        assert r.status_code == 409 and r.json() == {"error": "link_closed", "state": "completed"}


@pytest.mark.timeout(420)
def test_wf_complete_and_seal_storage_outage(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    assert STORAGE_DOWN_URL, "APP_STORAGE_DOWN_URL is not set"
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Sealing {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.1, 0.6, 0.3, 0.06)], state="in_progress", signed=1)])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    token = invite_token(mail, s2["email"], title)
    down = Link(STORAGE_DOWN_URL, token)
    down.fill_all(s2["name"])
    r = down.finish()
    t0 = time.monotonic()
    assert r.status_code == 200 and r.json() == {"state": "sealing"}, r.text[:200]
    with browse(browser, STORAGE_DOWN_URL, "/documents", user=owner) as page:
        eventually(page, lambda: expect(page.get_by_role("status", name="Service notice")).to_contain_text(
            "File storage is unavailable. New uploads are paused and completed PDFs are sealed when it recovers.", timeout=POLL_MS),
                   LOAD_S, "storage notice on the storage-down instance")
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        visible(page, page.get_by_text("Sealing the completed PDF", exact=True), "Next step while sealing")
        visible(page, page.get_by_text("Sealing", exact=True).first, "Sealing status word")
    with browse(browser, base, f"/sign/{token}") as page:
        visible(page, page.get_by_role("heading", name=f"You signed {title}", level=1), "sealing heading")
        visible(page, page.get_by_text("Your signature is recorded. The completed PDF will be emailed once it is sealed.", exact=True), "sealing body")
    while time.monotonic() < t0 + RETRY_S - CLOCK_SLACK_S:
        d = api.doc(doc_id)
        assert d["status"] == "sealing" and d["completedSha256"] is None, f"completed before the retry interval: {d['status']}"
        assert f"documents/{doc_id}/completed.pdf" not in S3().keys(f"documents/{doc_id}/")
        assert not mails(mail, s1["email"], f"Completed: {title}"), "completed email before the seal"
    eventually(None, lambda: _true(api.doc(doc_id)["status"] == "completed", "still sealing"),
               t0 + RETRY_MAX_S + RETRY_SLACK_S - time.monotonic(), "main instance seals within 63 s of the failed attempt")
    d = api.doc(doc_id)
    assert hashlib.sha256(S3().get(f"documents/{doc_id}/completed.pdf")).hexdigest() == d["completedSha256"]
    for addr in (owner["email"], s1["email"], s2["email"]):
        await_mail(mail, addr, f"Completed: {title}")
    types = [e["type"] for e in api.audit(doc_id)]
    assert types[-3:] == ["recipient.signed", "document.sealed", "document.completed"] and types.count("document.sealed") == 1


def _unescape(raw: bytes) -> str:
    out, i = bytearray(), 0
    table = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}
    while i < len(raw):
        c = raw[i]
        if c == 0x5C and i + 1 < len(raw):
            n = raw[i + 1]
            m = re.match(rb"[0-7]{1,3}", raw[i + 1:i + 4])
            if m:
                out.append(int(m.group(0), 8) & 0xFF)
                i += 1 + len(m.group(0))
                continue
            out.append(table.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return out.decode("latin-1")


TEXT_OP = re.compile(rb"\((?P<lit>(?:\\.|[^\\)])*)\)\s*Tj|<(?P<hex>[0-9A-Fa-f\s]*)>\s*Tj|"
                     rb"\[\s*(?:\((?P<alit>(?:\\.|[^\\)])*)\)|<(?P<ahex>[0-9A-Fa-f\s]*)>)\s*\]\s*TJ", re.S)


def pdf_streams(data: bytes) -> list[list[str]]:
    streams = []
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", data, re.S):
        raw = m.group(1)
        try:
            raw = zlib.decompressobj().decompress(raw)
        except zlib.error:
            pass
        found = []
        for t in TEXT_OP.finditer(raw):
            lit = t.group("lit") if t.group("lit") is not None else t.group("alit")
            hx = t.group("hex") if t.group("hex") is not None else t.group("ahex")
            found.append(_unescape(lit) if lit is not None else bytes.fromhex(re.sub(rb"\s", b"", hx).decode()).decode("latin-1"))
        streams.append(found)
    return streams


STRING_TOKEN = re.compile(rb"\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>", re.S)
SHOW_OP = re.compile(rb"(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)\s*(?:Tj|'|\")|"
                     rb"\[((?:\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|[^\]\(<])*)\]\s*TJ", re.S)


def _decode_token(tok: bytes) -> str:
    if tok.startswith(b"("):
        return _unescape(tok[1:-1])
    hx = re.sub(rb"\s", b"", tok[1:-1]).decode()
    if len(hx) % 2:
        hx += "0"
    return bytes.fromhex(hx).decode("latin-1")


def pdf_joined(data: bytes) -> list[str]:
    joined = []
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", data, re.S):
        raw = m.group(1)
        try:
            raw = zlib.decompressobj().decompress(raw)
        except zlib.error:
            pass
        parts = []
        for op in SHOW_OP.finditer(raw):
            chunk = op.group(1) if op.group(1) is not None else op.group(2)
            parts.extend(_decode_token(t.group(0)) for t in STRING_TOKEN.finditer(chunk))
        joined.append("".join(parts))
    return joined


def test_wf_complete_and_seal_certificate(app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Certificate {tag()}"
    fields = [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06), fld(1, "date", 1, 0.5, 0.2, 0.2, 0.04),
              fld(2, "signature", 2, 0.1, 0.5, 0.3, 0.06), fld(2, "text", 3, 0.1, 0.7, 0.3, 0.04)]
    w = seed(base, [owner], [document(title, owner, [s1, s2], fields, state="completed", sample="letter-3")])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    eventually(None, lambda: _true(api.doc(doc_id)["status"] == "completed", "not completed"), LOAD_S, "seeded document completes")
    d = api.doc(doc_id)
    r = api.get(f"/api/documents/{doc_id}/completed.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF-")
    data = r.content
    assert hashlib.sha256(data).hexdigest() == d["completedSha256"]
    assert len(re.findall(rb"/Type\s*/Page(?![A-Za-z])", data)) == d["pageCount"] + 1
    events = api.audit(doc_id)
    head = [e for e in events if e["type"] == "recipient.signed"][-1]["hash"]
    lines = ["Certificate of completion", f"Document: {title}", f"Document ID: {doc_id}",
             f"Original SHA-256: {d['originalSha256']}", f"Pages in original: {d['pageCount']}"]
    for rec in d["recipients"]:
        stamp = iso(rec["signedAt"]).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
        lines.append(f"Signer {rec['order']}: {rec['name']} <{rec['email']}> signed {stamp} UTC")
    lines.append(f"Audit chain head: {head}")
    streams = pdf_streams(data)
    cert = [s for s in streams if "Certificate of completion" in s]
    assert len(cert) == 1, "no single certificate content stream with 'Certificate of completion'"
    positions = [cert[0].index(line) if line in cert[0] else -1 for line in lines]
    assert -1 not in positions, f"missing certificate lines: {[l for l, p in zip(lines, positions) if p < 0]}"
    assert positions == sorted(positions), "certificate lines out of order"
    bodies = [t for t in pdf_joined(data) if "Certificate of completion" not in t]
    date_value = next(f["value"] for f in d["fields"] if f["kind"] == "date")
    for value in (s1["name"], s2["name"], date_value):
        squeezed = value.replace(" ", "")
        assert any(value in t or squeezed in t.replace(" ", "") for t in bodies), \
            f"field value {value!r} not drawn on the original pages"


def test_wf_complete_and_seal_emails(app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title, both = f"Completed mail {tag()}", f"Completed self {tag()}"
    sig = [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06), fld(2, "signature", 1, 0.1, 0.5, 0.3, 0.06)]
    as_signer = {"name": owner["name"], "email": owner["email"]}
    w = seed(base, [owner], [document(title, owner, [s1, s2], sig, state="completed"),
                             document(both, owner, [as_signer, signer("Mira", "Lund")], sig, state="completed")])
    api = Api(base).login(owner)
    eventually(None, lambda: _true(all(api.doc(w.docs[t])["status"] == "completed" for t in (title, both)), "not completed"), LOAD_S, "seeded completion")
    sha = api.doc(w.docs[title])["completedSha256"]
    for addr in (owner["email"], s1["email"], s2["email"]):
        msgs = await_mail(mail, addr, f"Completed: {title}")
        assert len(mails(mail, addr, f"Completed: {title}")) == 1, f"{addr} got more than one completed email"
        body = text(msgs[0]).splitlines()
        assert f"SHA-256 of the completed PDF: {sha}" in body
        link = next((l for l in body if l.startswith("Download: ")), "")
        path = urlparse(link[len("Download: "):]).path
        if addr == owner["email"]:
            assert path == f"/api/documents/{w.docs[title]}/completed.pdf"
            got = api.get(path)
        else:
            assert re.fullmatch(r"/sign/[^/]+/completed\.pdf", path), path
            got = httpx.get(f"{base}{path}", timeout=HTTP_TIMEOUT_S)
        assert got.status_code == 200 and hashlib.sha256(got.content).hexdigest() == sha
        assert (msgs[0].get("From") or {}).get("Address", "").lower() == mail_from_address().lower()
    await_mail(mail, owner["email"], f"Completed: {both}")
    assert len(mails(mail, owner["email"], f"Completed: {both}")) == 1, "sender who is also a signer got two completed emails"


def test_audit_chain(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1 = signer("Ines", "Okafor")
    title = f"Audit {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, signer("Tomas", "Reyes")],
                                      [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06), fld(2, "signature", 1, 0.1, 0.5, 0.3, 0.06)], state="in_progress")])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    before = api.audit(doc_id)
    link = Link(base, invite_token(mail, s1["email"], title))
    link.state()
    link.state()
    events = api.audit(doc_id)
    assert len(events) == len(before) + 1 and events[-1]["type"] == "recipient.viewed"
    assert events[-1]["recipientId"] == api.doc(doc_id)["recipients"][0]["id"] and events[-1]["actor"] == s1["email"]
    prev = ZERO_HASH
    for n, e in enumerate(events, 1):
        assert e["seq"] == n and e["prevHash"] == prev and e["type"] in AUDIT_TYPES
        raw = f"{e['prevHash']}|{e['seq']}|{e['type']}|{e['recipientId'] or '-'}|{e['at']}"
        assert e["hash"] == hashlib.sha256(raw.encode()).hexdigest(), f"event {n} hash breaks the chain"
        if e["type"].startswith("invite."):
            assert e["actor"] == "system"
        prev = e["hash"]
    assert {"document.created", "document.sent"} <= {e["type"] for e in events}
    with browse(browser, base, f"/documents/{doc_id}/audit", user=owner) as page:
        visible(page, page.get_by_role("heading", name="Audit trail"), "Audit trail heading")
        table = page.get_by_role("table", name="Audit trail")
        rows = table.get_by_role("row")
        eventually(page, lambda: expect(rows).to_have_count(len(events) + 1, timeout=POLL_MS), LOAD_S, "one row per event")
        for i, e in enumerate(events, 1):
            row = rows.nth(i)
            expect(row).to_contain_text(e["type"])
            expect(row).to_contain_text(iso(e["at"]).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
            cell = row.get_by_role("cell").filter(has_text=e["hash"][:12]).first
            tip = cell.evaluate("c => c.title || (c.querySelector('[title]') || {}).title || ''")
            assert tip == e["hash"], f"row {i} tooltip {tip!r}"


def test_wf_complete_and_seal_sender_live(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Sender live {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.1, 0.6, 0.3, 0.06)],
                                      state="in_progress", signed=1)])
    doc_id = w.docs[title]
    api = Api(base).login(owner)
    token = invite_token(mail, s2["email"], title)
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        visible(page, page.get_by_role("heading", name=title, level=1), "document page")
        download = page.get_by_role("link", name="Download completed PDF")
        expect(download).to_have_count(0)
        Link(base, token).sign(s2["name"])
        eventually(None, lambda: _true(api.doc(doc_id)["status"] == "completed", "not completed"), LOAD_S, "document completes")
        sha = api.doc(doc_id)["completedSha256"]
        eventually(page, lambda: (expect(page.get_by_text("Completed PDF SHA-256").first).to_be_visible(timeout=POLL_MS),
                                  expect(page.get_by_text(sha).first).to_be_visible(timeout=POLL_MS),
                                  expect(download).to_be_visible(timeout=POLL_MS),
                                  expect(page.get_by_role("status", name="Document updates")).to_contain_text(f"{title}: Completed", timeout=POLL_MS)),
                   LIVE_S + LIVE_SLACK_S, "the open page shows the hash and download link with the announcement within 3 s")
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        tab_to(page, download, "Download completed PDF")
        href = download.get_attribute("href")
    assert href
    got = api.get(urljoin(f"{base}/documents/{doc_id}", href))
    assert got.status_code == 200 and hashlib.sha256(got.content).hexdigest() == sha


@pytest.mark.timeout(480)
def test_wf_delivery_and_expiry_held(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    assert MAIL_DOWN_URL, "APP_MAIL_DOWN_URL is not set"
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Held {tag()}"
    w = seed(base, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06),
                                                               fld(2, "signature", 1, 0.1, 0.5, 0.3, 0.06)])])
    doc_id = w.docs[title]
    banner = "Email is unavailable. Invitations are held and sent when email recovers."
    with browse(browser, MAIL_DOWN_URL, "/documents", user=owner) as page:
        eventually(page, lambda: expect(page.get_by_role("status", name="Service notice")).to_contain_text(banner, timeout=POLL_MS), LOAD_S, "email banner on list")
        page.goto(f"{MAIL_DOWN_URL}/documents/{doc_id}")
        eventually(page, lambda: expect(page.get_by_role("status", name="Service notice")).to_contain_text(banner, timeout=POLL_MS), LOAD_S, "email banner on document")
        page.get_by_role("button", name="Send for signing").click()
        t_click = time.monotonic()
        page.get_by_role("dialog", name="Send for signing").get_by_role("button", name="Send", exact=True).click()
        eventually(page, lambda: (expect(order_row(page, 1, s1["name"])).to_contain_text("Not delivered yet", timeout=POLL_MS),
                                  expect(page.get_by_text(f"Invitation not delivered yet to {s1['name']}", exact=True)).to_be_visible(timeout=POLL_MS)),
                   LOAD_S, "held row word and Next step")
        t_sent = time.monotonic()
    api = Api(base).login(owner)
    d = api.doc(doc_id)
    assert d["recipients"][0]["status"] == "invited" and d["recipients"][0]["delivery"] == "held"
    assert [e for e in api.audit(doc_id) if e["type"] == "invite.held"]
    while time.monotonic() < t_click + RETRY_S - CLOCK_SLACK_S:
        assert not mails(mail, s1["email"], f"Please sign: {title}"), "held invitation sent before the retry interval"
        assert api.doc(doc_id)["recipients"][0]["delivery"] == "held"
    await_mail(mail, s1["email"], f"Please sign: {title}", seconds=t_sent + RETRY_MAX_S + RETRY_SLACK_S - time.monotonic())
    t_delivered = time.monotonic()
    eventually(None, lambda: _true(api.doc(doc_id)["recipients"][0]["delivery"] == "sent", "delivery not sent"), LOAD_S, "delivery becomes sent")
    while time.monotonic() < t_delivered + RETRY_S + CLOCK_SLACK_S:
        assert len(mails(mail, s1["email"], f"Please sign: {title}")) == 1, "held invitation delivered more than once"
    types = [e["type"] for e in api.audit(doc_id)]
    assert types.count("invite.sent") == 1 and types.index("invite.held") < types.index("invite.sent")
    assert not mails(mail, s2["email"], f"Please sign: {title}")
    with browse(browser, base, f"/documents/{doc_id}", user=owner) as page:
        visible(page, order_row(page, 1, s1["name"]).filter(has_text="Invited"), "row reads Invited after delivery")


@pytest.mark.timeout(300)
def test_wf_delivery_and_expiry_new_link(browser: Browser, mail: Mailpit) -> None:
    assert SHORT_URL, "APP_SHORT_URL is not set"
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"New link {tag()}"
    w = seed(SHORT_URL, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06),
                                                                    fld(2, "signature", 1, 0.1, 0.5, 0.3, 0.06)], state="in_progress")])
    doc_id = w.docs[title]
    api = Api(SHORT_URL).login(owner)
    rec = api.doc(doc_id)["recipients"][0]
    sent_at = iso(next(e for e in api.audit(doc_id) if e["type"] == "document.sent")["at"])
    lifetime = (iso(rec["linkExpiresAt"]) - sent_at).total_seconds()
    assert abs(lifetime - SHORT_TTL_S) <= TURN_SLACK_S, f"linkExpiresAt is {lifetime} s after the turn began"
    old = invite_token(mail, s1["email"], title)
    with browse(browser, SHORT_URL, f"/documents/{doc_id}", user=owner, shift=timedelta(hours=-6)) as page:
        row = order_row(page, 1, s1["name"])
        eventually(page, lambda: (expect(row).to_contain_text("Link expired", timeout=POLL_MS),
                                  expect(page.get_by_text(f"Link expired for {s1['name']}", exact=True)).to_be_visible(timeout=POLL_MS)),
                   SHORT_TTL_S + EXPIRY_CHECK_S + LIVE_S + LIVE_SLACK_S + LOAD_S, "Link expired shown live")
        expect(page.get_by_role("button", name="Send reminder")).to_have_count(0)
        row.get_by_role("button", name="Send a new link").click()
        eventually(page, lambda: expect(page.get_by_role("status", name="Signing order updates")).to_contain_text(
            f"New link issued for {s1['name']}.", timeout=POLL_MS), LOAD_S, "new-link announcement")
        new = token_of(await_mail(mail, s1["email"], f"New link: {title}")[0])
        assert new != old
        assert Link(SHORT_URL, new).state().json()["state"] == "your_turn"
    assert Link(SHORT_URL, old).state().json()["state"] == "expired"
    assert [e["type"] for e in api.audit(doc_id)].count("link.resent") == 1


def test_wf_delivery_and_expiry_link_pages(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1, s2, s3 = signer("Ines", "Okafor"), signer("Tomas", "Reyes"), signer("Mira", "Lund")
    title, done = f"Link pages {tag()}", f"Link done {tag()}"
    sig = [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06), fld(2, "signature", 1, 0.1, 0.5, 0.3, 0.06)]
    w = seed(base, [owner], [document(title, owner, [s1, s2], sig, state="in_progress"),
                             document(done, owner, [s3, signer("Lena", "Moss")], sig, state="completed")])
    junk = uuid.uuid4().hex
    assert httpx.get(f"{base}/api/sign/{junk}", timeout=HTTP_TIMEOUT_S).json() == {"error": "not_found"}
    with browse(browser, base, f"/sign/{junk}") as page:
        visible(page, page.get_by_role("heading", name="This link is not valid", level=1), "unknown token heading")
        visible(page, page.get_by_text("Check that you copied the whole link.", exact=True), "unknown token body")
    token = invite_token(mail, s1["email"], title)
    Link(base, token).sign(s1["name"])
    with browse(browser, base, f"/sign/{token}", shift=timedelta(days=2)) as page:
        visible(page, page.get_by_role("heading", name=f"You signed {title}", level=1), "signed_waiting heading")
        visible(page, page.get_by_text(f"Waiting for {s2['name']} (signer 2 of 2).", exact=True), "signed_waiting body")
        assert Api(base).login(owner).post(f"/api/documents/{w.docs[title]}/void", {"reason": "Rates changed"}).status_code == 200
        eventually(page, lambda: (expect(page.get_by_role("heading", name="This document was voided", level=1)).to_be_visible(timeout=POLL_MS),
                                  expect(page.get_by_text(f"{owner['name']} voided it: Rates changed", exact=True)).to_be_visible(timeout=POLL_MS),
                                  expect(page.get_by_role("status", name="Document status")).to_contain_text("This document was voided", timeout=POLL_MS)),
                   LIVE_S + LIVE_SLACK_S, "voided state within 3 s")
    msg = await_mail(mail, s3["email"], f"Completed: {done}")[0]
    m = re.search(r"/sign/([^\s/]+)/completed\.pdf", text(msg))
    assert m, "completed email lacks the signer download link"
    with browse(browser, base, f"/sign/{m.group(1)}") as page:
        visible(page, page.get_by_role("heading", name=f"{done} is complete", level=1), "completed heading")
        visible(page, page.get_by_text("Everyone has signed.", exact=True), "completed body")
        visible(page, page.get_by_role("link", name="Download completed PDF"), "download link")


@pytest.mark.timeout(300)
def test_wf_delivery_and_expiry_new_link_phone(browser: Browser, mail: Mailpit) -> None:
    assert SHORT_URL, "APP_SHORT_URL is not set"
    owner = person("Ada", "Byrne", "owner")
    s1, s2 = signer("Ines", "Okafor"), signer("Tomas", "Reyes")
    title = f"Phone new link {tag()}"
    w = seed(SHORT_URL, [owner], [document(title, owner, [s1, s2], [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06),
                                                                    fld(2, "signature", 1, 0.1, 0.5, 0.3, 0.06)], state="in_progress")])
    old = invite_token(mail, s1["email"], title)
    with browse(browser, SHORT_URL, f"/documents/{w.docs[title]}", user=owner, viewport=APP_WIDTHS["375"], touch=True) as page:
        opener = page.get_by_role("button", name="Signing order")
        visible(page, opener, "Signing order button at 375 px")
        tap(opener)
        sheet = page.get_by_role("dialog", name="Signing order")
        visible(page, sheet, "Signing order sheet")
        row = sheet.get_by_role("list", name="Signing order").get_by_role("listitem").filter(has_text=f"1. {s1['name']}")
        eventually(page, lambda: expect(row).to_contain_text("Link expired", timeout=POLL_MS),
                   SHORT_TTL_S + EXPIRY_CHECK_S + LIVE_S + LIVE_SLACK_S + LOAD_S, "the open sheet shows Link expired live")
        tap(row.get_by_role("button", name="Send a new link"))
        eventually(page, lambda: (expect(page.get_by_role("status", name="Signing order updates")).to_contain_text(
                                      f"New link issued for {s1['name']}.", timeout=POLL_MS),
                                  expect(row).to_contain_text("Invited", timeout=POLL_MS)),
                   LOAD_S, "tapping Send a new link announces it and the row reads Invited")
    new = token_of(await_mail(mail, s1["email"], f"New link: {title}")[0])
    assert new != old


def test_wf_team_templates_roles(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner, member, other, viewer = (person("Ada", "Byrne", "owner"), person("Cora", "Lindqvist", "member"),
                                    person("Jonas", "Vale", "member"), person("Pia", "Hart", "viewer"))
    tm, to = f"Member draft {tag()}", f"Other draft {tag()}"
    sig = [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06)]
    w = seed(base, [owner, member, other, viewer], [document(tm, member, [signer("Ines", "Okafor")], sig),
                                                     document(to, other, [signer("Tomas", "Reyes")], sig)])
    stranger = person("Lena", "Moss", "owner")
    ws = seed(base, [stranger], [document(f"Foreign {tag()}", stranger, [signer("Mira", "Lund")], sig)])
    dm, do = w.docs[tm], w.docs[to]
    v, m = Api(base).login(viewer), Api(base).login(member)
    field = v.doc(dm)["fields"][0]
    forbidden = [
        (v, "POST", f"/api/documents/{dm}/recipients", {"name": "Otto Brand", "email": f"otto.{tag()}@harbour-row.example"}),
        (v, "PATCH", f"/api/documents/{dm}/fields/{field['id']}", {"x": 0.5}),
        (v, "POST", f"/api/documents/{dm}/send", None),
        (v, "PATCH", f"/api/team/members/{w.users[member['email']]}", {"role": "viewer"}),
        (m, "PATCH", f"/api/team/members/{w.users[other['email']]}", {"role": "viewer"}),
        (m, "POST", f"/api/documents/{dm}/template", None),
        (m, "PATCH", f"/api/documents/{do}", {"title": "Hijacked"}),
        (m, "POST", f"/api/documents/{do}/send", None),
    ]
    for client, method, path, body in forbidden:
        r = client.http.request(method, path, json=body) if body is not None else client.http.request(method, path)
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}, f"{method} {path}: {r.status_code}"
    r = v.upload(make_pdf(1), "viewer.pdf")
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    foreign = next(iter(ws.docs.values()))
    r = v.post(f"/api/documents/{foreign}/send")
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    assert v.get(f"/api/documents/{dm}").status_code == 200 and v.get(f"/api/documents/{dm}/audit").status_code == 200
    after = m.doc(dm)
    assert after["status"] == "draft" and len(after["recipients"]) == 1 and after["fields"][0]["x"] == field["x"]
    assert m.doc(do)["title"] == to and m.doc(do)["status"] == "draft"
    with browse(browser, base, "/documents", user=viewer) as page:
        visible(page, page.get_by_role("heading", name="Documents", level=1), "viewer documents")
        expect(page.get_by_role("button", name="Upload PDF")).to_have_count(0)
        page.goto(f"{base}/documents/{dm}")
        visible(page, page.get_by_role("heading", name=tm, level=1), "viewer document page")
        for role, name in (("toolbar", "Fields"), ("button", "Send for signing"), ("button", "Add signer"), ("button", "Save as template")):
            expect(page.get_by_role(role, name=name)).to_have_count(0)
    with browse(browser, base, f"/documents/{dm}", user=member) as page:
        visible(page, page.get_by_role("toolbar", name="Fields"), "member Fields toolbar")
        visible(page, page.get_by_role("button", name="Send for signing"), "member Send for signing")
        expect(page.get_by_role("button", name="Save as template")).to_have_count(0)
        page.goto(f"{base}/team")
        visible(page, page.get_by_role("table", name="Members"), "members table")
        expect(page.get_by_role("combobox", name=re.compile(r"^Role for "))).to_have_count(0)
    with browse(browser, base, f"/documents/{dm}", user=owner) as page:
        visible(page, page.get_by_role("button", name="Save as template"), "owner Save as template")
        page.goto(f"{base}/team")
        visible(page, page.get_by_role("combobox", name=f"Role for {member['name']}"), "owner role combobox")


def test_wf_team_templates_live_role(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner, member = person("Ada", "Byrne", "owner"), person("Cora", "Lindqvist", "member")
    title = f"Role change {tag()}"
    w = seed(base, [owner, member], [document(title, member, [signer("Ines", "Okafor")], [fld(1, "signature", 1, 0.1, 0.2, 0.3, 0.06)])])
    with browse(browser, base, "/documents", user=member) as listing, \
            browse(browser, base, f"/documents/{w.docs[title]}", user=member) as detail, \
            browse(browser, base, "/team", user=owner) as team:
        visible(listing, listing.get_by_role("button", name="Upload PDF"), "member Upload PDF")
        visible(detail, detail.get_by_role("toolbar", name="Fields"), "member Fields toolbar")
        combo = team.get_by_role("combobox", name=f"Role for {member['name']}")
        visible(team, combo, "role combobox")
        new_role = "Viewer"
        select(combo, new_role)
        eventually(None, lambda: _true(any(x["role"] == "viewer" for x in Api(base).login(owner).get("/api/team").json()["members"]
                                           if x["email"] == member["email"]), "role not stored"), LOAD_S, "role stored")
        for p in (listing, detail):
            eventually(p, lambda p=p: expect(p.get_by_role("status", name="Account notice")).to_contain_text(f"Your role is now {new_role}.", timeout=POLL_MS),
                       LIVE_S + LIVE_SLACK_S, "role banner within 3 s")
        eventually(listing, lambda: expect(listing.get_by_role("button", name="Upload PDF")).to_have_count(0, timeout=POLL_MS), LIVE_S + LIVE_SLACK_S, "Upload PDF removed")
        eventually(detail, lambda: expect(detail.get_by_role("toolbar", name="Fields")).to_have_count(0, timeout=POLL_MS), LIVE_S + LIVE_SLACK_S, "Fields toolbar removed")
        assert Api(base).login(member).upload(make_pdf(1), "late.pdf").status_code == 403
        select(team.get_by_role("combobox", name=f"Role for {owner['name']}"), "Member")
        eventually(team, lambda: expect(team.get_by_role("alert").filter(has_text="A team needs at least one owner.").first).to_be_visible(timeout=POLL_MS),
                   LOAD_S, "last-owner alert")
    r = Api(base).login(owner).patch(f"/api/team/members/{w.users[owner['email']]}", {"role": "member"})
    assert r.status_code == 409 and r.json() == {"error": "last_owner"}


def test_wf_team_templates_share_use(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner, member = person("Ada", "Byrne", "owner"), person("Cora", "Lindqvist", "member")
    title = f"Template source {tag()}"
    fields = [fld(1, "signature", 1, 0.11, 0.22, 0.3, 0.06), fld(2, "text", 1, 0.4, 0.6, 0.3, 0.04)]
    w = seed(base, [owner, member], [document(title, owner, [signer("Ines", "Okafor"), signer("Tomas", "Reyes")], fields)])
    oapi, mapi = Api(base).login(owner), Api(base).login(member)
    src = oapi.doc(w.docs[title])
    with browse(browser, base, f"/documents/{src['id']}", user=owner) as page:
        page.get_by_role("button", name="Save as template").click()
        eventually(page, lambda: _true(any(t["name"] == title for t in oapi.get("/api/templates").json()["templates"]), "no template"), LOAD_S, "template saved")
        page.goto(f"{base}/templates")
        page.get_by_role("button", name=f"Share {title}").click()
    tmpl = next(t for t in oapi.get("/api/templates").json()["templates"] if t["name"] == title)
    eventually(None, lambda: _true(oapi.get(f"/api/templates/{tmpl['id']}").json()["status"] == "shared", "not shared"), LOAD_S, "shared")
    assert tmpl["signerCount"] == 2
    people = [signer("Mira", "Lund"), signer("Otto", "Brand")]
    holder: dict[str, str] = {}
    with browse(browser, base, "/templates", user=member) as page:
        item = page.get_by_role("list", name="Templates").get_by_role("listitem").filter(has_text=title)
        visible(page, item, "shared template for the member")
        item.get_by_role("button", name="Use template").click()
        dialog = page.get_by_role("dialog", name="Use template")
        for k, p in enumerate(people, 1):
            dialog.get_by_role("textbox", name=f"Name for Signer {k}").fill(p["name"])
            dialog.get_by_role("textbox", name=f"Email for Signer {k}").fill(p["email"])
        dialog.get_by_role("button", name="Create draft").click()

        def opened() -> None:
            m = re.search(r"/documents/([0-9a-fA-F-]{36})", page.url)
            assert m, f"still on {page.url}"
            holder["id"] = m.group(1)

        eventually(page, opened, LOAD_S, "Create draft opens the new draft")
    new = mapi.doc(holder["id"])
    assert new["status"] == "draft" and new["title"] == title and new["originalSha256"] == src["originalSha256"]
    assert [(r["name"], r["email"]) for r in new["recipients"]] == [(p["name"], p["email"]) for p in people]
    order = {r["id"]: r["order"] for r in new["recipients"]}
    src_order = {r["id"]: r["order"] for r in src["recipients"]}
    assert [(order[f["recipientId"]], f["kind"], f["page"], f["x"], f["y"], f["w"], f["h"]) for f in new["fields"]] == \
           [(src_order[f["recipientId"]], f["kind"], f["page"], f["x"], f["y"], f["w"], f["h"]) for f in src["fields"]]
    with browse(browser, base, "/templates", user=member) as page, browse(browser, base, "/templates", user=owner) as admin:
        item = page.get_by_role("list", name="Templates").get_by_role("listitem").filter(has_text=title)
        visible(page, item, "member list before retire")
        admin.get_by_role("button", name=f"Retire {title}").click()
        eventually(page, lambda: expect(item).to_have_count(0, timeout=POLL_MS), LIVE_S + LIVE_SLACK_S + LOAD_S, "retired template leaves the member list")
    assert mapi.get(f"/api/templates/{tmpl['id']}").status_code == 404


REDIRECT_PROBES = ["//evil.example/x", "/\\evil.example/x", "https://evil.example/x"]


def test_wf_team_templates_return(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    member = person("Cora", "Lindqvist", "owner")
    title = f"Return {tag()}"
    w = seed(base, [member], [document(title, member, [signer("Ines", "Okafor")], [])])
    target = f"/documents/{w.docs[title]}?from=mail"
    r = httpx.get(f"{base}{target}", follow_redirects=False, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 302
    loc = urlparse(r.headers["location"])
    assert loc.path == "/sign-in" and parse_qs(loc.query)["next"] == [target]

    def sign_in(page: Page, password: str) -> None:
        visible(page, page.get_by_role("textbox", name="Email"), "sign-in form")
        page.get_by_role("textbox", name="Email").fill(member["email"])
        page.get_by_label("Password").fill(password)
        page.get_by_role("button", name="Sign in").click()

    with browse(browser, base, target) as page:
        sign_in(page, "wrong-password")
        visible(page, page.get_by_role("alert").filter(has_text="Email or password is incorrect.").first, "bad credentials alert")
        sign_in(page, member["password"])
        eventually(page, lambda: _true(urlparse(page.url).path + "?" + urlparse(page.url).query == target, page.url), LOAD_S, "returns to the page")
        visible(page, page.get_by_role("heading", name=title, level=1), "document after sign-in")
        page.goto(f"{base}/sign-in?next={quote('/templates', safe='')}")
        eventually(page, lambda: _true(urlparse(page.url).path == "/templates", page.url), LOAD_S, "signed-in /sign-in goes to next")
    for probe in REDIRECT_PROBES:
        with browse(browser, base, f"/sign-in?next={quote(probe, safe='')}") as page:
            sign_in(page, member["password"])
            eventually(page, lambda: _true(urlparse(page.url).path == "/documents" and same_origin(page.url, base), page.url),
                       LOAD_S, f"next={probe!r} goes to /documents")


MID_JS = """el => { const a = el.getAnimations({subtree: true}); for (const x of a) { x.pause();
  const d = x.effect.getComputedTiming().duration; x.currentTime = (typeof d === 'number' ? d : 0) / 2; } return a.length; }"""


def test_panel_and_sheet_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Motion {tag()}"
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], [fld(1, "signature", 1, 0.2, 0.2, 0.3, 0.06)])])
    doc_id = w.docs[title]
    fid = Api(base).login(owner).doc(doc_id)["fields"][0]["id"]
    cases = [("1280", "panel", 1), ("375", "sheet", 2)]
    for key, kind, axis in cases:
        with browse(browser, base, f"/documents/{doc_id}", user=owner, viewport=APP_WIDTHS[key]) as page:
            if kind == "panel":
                target = page.get_by_role("complementary", name="Field properties")
                opener = by_id(page, f"field-{fid}")
                visible(page, opener, "field")
                open_ = lambda: opener.focus()
            else:
                target = page.get_by_role("dialog", name="Signing order")
                opener = page.get_by_role("button", name="Signing order")
                visible(page, opener, "Signing order button")
                open_ = lambda: opener.click()
            close = lambda: page.keyboard.press("Escape")
            open_()
            pts = path_of(target)
            took = settle_time(pts)
            assert PANEL_MIN_MS - SAMPLE_SLACK_MS <= took <= PANEL_MAX_MS + SAMPLE_SLACK_MS, f"{kind} entered in {took} ms"
            assert pts[0][axis] > pts[-1][axis] + PX_TOL, f"{kind} did not slide in from its edge"
            hidden_pos, open_pos = pts[0][axis], pts[-1][axis]
            close()
            advance(page, MOTION_WINDOW_MS)
            open_()
            if target.evaluate(MID_JS) == 0:
                advance(page, (PANEL_MIN_MS + PANEL_MAX_MS) / 4)
            box = target.bounding_box()
            assert box is not None
            mid = box["x"] if axis == 1 else box["y"]
            close()
            back = path_of(target)
            first = back[0][axis]
            assert abs(first - mid) < abs(first - open_pos) and abs(first - mid) < abs(first - hidden_pos), \
                f"{kind} jumped on mid-slide close: mid {mid}, first sample {first}"
            vw, vh = APP_WIDTHS[key]

            def hidden() -> None:
                end = target.bounding_box() if target.count() else None
                assert end is None or end["x"] >= vw or end["y"] >= vh, f"{kind} still in view after closing: {end}"

            eventually(page, hidden, LOAD_S, f"{kind} ends fully hidden after the mid-slide close")
            advance(page, MOTION_WINDOW_MS * 2)
            hidden()
        with browse(browser, base, f"/documents/{doc_id}", user=owner, viewport=APP_WIDTHS[key], reduced=True) as page:
            target = page.get_by_role("complementary", name="Field properties") if kind == "panel" else page.get_by_role("dialog", name="Signing order")
            if kind == "panel":
                visible(page, by_id(page, f"field-{fid}"), "field")
                by_id(page, f"field-{fid}").focus()
            else:
                visible(page, page.get_by_role("button", name="Signing order"), "Signing order button")
                page.get_by_role("button", name="Signing order").click()
            visible(page, target, f"{kind} under reduced motion")
            running = [a for a in animations(target)
                       if a.get("playState") != "finished" and float(a.get("duration", 0) or 0) > FRAME_MS]
            assert not running, f"{kind} animates under reduced motion: {running[:2]}"


@pytest.mark.parametrize("width", WIDTH_IDS, ids=WIDTH_IDS)
def test_accessible_at_every_width(browser: Browser, app_url: str, mail: Mailpit, width: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    s1 = signer("Ines", "Okafor")
    draft, sent = f"A11y draft {tag()}", f"A11y sent {tag()}"
    sig = [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06)]
    w = seed(base, [owner], [document(draft, owner, [signer("Tomas", "Reyes")], sig), document(sent, owner, [s1], sig, state="in_progress")])
    token = invite_token(mail, s1["email"], sent)
    editor_control = "Signing order" if width == "375" else "Send for signing"
    screens = [("/documents", "Upload PDF", owner), (f"/documents/{w.docs[draft]}", editor_control, owner), (f"/sign/{token}", "Finish and sign", None)]
    for path, control, user in screens:
        with browse(browser, base, path, user=user, viewport=APP_WIDTHS[width]) as page:
            btn = page.get_by_role("button", name=control)
            visible(page, btn, f"{control} on {path}")
            advance(page, MOTION_WINDOW_MS)
            axe(page)
            layout(page)
            rest, focus = state_styles(btn, "outline-style", "outline-width", "box-shadow", state="focus")
            assert rest != focus, f"no visible focus change on {control}"
            if width != "375":
                continue
            small = []
            for role in ("button", "tab", "textbox", "combobox", "checkbox"):
                for loc in page.get_by_role(role).all():
                    if not loc.is_visible():
                        continue
                    ident = loc.get_attribute("id") or ""
                    label = loc.get_attribute("aria-label") or loc.inner_text()
                    if ident.startswith("field-") or label.startswith("Resize "):
                        continue
                    box = loc.bounding_box()
                    if box and (box["width"] < TAP_MIN_PX or box["height"] < TAP_MIN_PX):
                        small.append((role, label, box["width"], box["height"]))
            assert not small, f"targets under 44 px on {path}: {small[:5]}"


def test_self_contained_serving(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    for url in [base] + [u for u in (STORAGE_DOWN_URL, MAIL_DOWN_URL, SHORT_URL) if u]:
        r = httpx.get(f"{url}/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, f"{url}/api/health"
    owner = person("Ada", "Byrne", "owner")
    s1 = signer("Ines", "Okafor")
    draft, sent, done = f"Serve draft {tag()}", f"Serve sent {tag()}", f"Serve done {tag()}"
    sig = [fld(1, "signature", 1, 0.1, 0.3, 0.3, 0.06)]
    w = seed(base, [owner], [document(draft, owner, [signer("Tomas", "Reyes")], sig, sample="a4-12"),
                             document(sent, owner, [s1], sig, state="in_progress"),
                             document(done, owner, [signer("Mira", "Lund")], sig, state="completed")])
    token = invite_token(mail, s1["email"], sent)
    requests: list[str] = []
    families: set[str] = set()
    with browse(browser, base, "/documents", user=owner) as page:
        page.context.on("request", lambda req: requests.append(req.url))
        for path, ready in (("/documents", ("heading", "Documents")), (f"/documents/{w.docs[draft]}", ("group", "Page 1 of 12")),
                            (f"/documents/{w.docs[done]}/audit", ("heading", "Audit trail")), (f"/sign/{token}", ("heading", sent))):
            page.goto(f"{base}{path}")
            visible(page, page.get_by_role(ready[0], name=ready[1]).first, f"{path} ready")
            advance(page, MOTION_WINDOW_MS)
            families |= set(page.evaluate("() => Array.from(document.fonts).filter(f => f.status === 'loaded').map(f => f.family.replace(/[\"']/g, ''))"))
    foreign = [u for u in requests if not u.startswith(("data:", "blob:")) and not same_origin(u, base)]
    assert not foreign, f"browser requested other origins: {foreign[:5]}"
    for family in ("Fraunces", "Public Sans", "IBM Plex Mono"):
        assert any(f.startswith(family) for f in families), f"font {family} never loaded; loaded {sorted(families)}"
    secrets = [v for v in (os.environ.get("S3_SECRET_ACCESS_KEY"), os.environ.get("S3_ACCESS_KEY_ID"), GRADING_KEY,
                           urlparse(os.environ.get("DATABASE_URL", "")).password) if v and len(v) >= 6]
    assets = sorted({u.split("#")[0] for u in requests if same_origin(u, base) and re.search(r"\.(m?js|css)$", urlparse(u).path)})
    for u in assets + [f"{base}/documents"]:
        body = httpx.get(u, timeout=HTTP_TIMEOUT_S).text
        for s in secrets:
            assert s not in body, f"a configured secret is served in {u}"
    for u in assets:
        assert httpx.get(u.split("?")[0] + ".map", timeout=HTTP_TIMEOUT_S).status_code == 404, f"source map served for {u}"
    for probe in ("/package.json", "/.env", "/tsconfig.json", "/package-lock.json"):
        assert httpx.get(f"{base}{probe}", timeout=HTTP_TIMEOUT_S).status_code == 404, f"{probe} served"
    api = Api(base).login(owner)
    before = len(api.doc(w.docs[draft])["recipients"])
    r = api.post(f"/api/documents/{w.docs[draft]}/recipients", {"name": "Otto Brand", "email": f"otto.{tag()}@harbour-row.example"},
                 headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert len(api.doc(w.docs[draft])["recipients"]) == before
    shell = '{"email": "", "password": ""}'
    big = '{"email": "' + "x" * (JSON_LIMIT + 1 - len(shell)) + '", "password": ""}'
    r = httpx.post(f"{base}/api/session", content=big.encode(), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 413 and r.json() == {"error": "too_large", "limit": JSON_LIMIT}
    fits = big.replace("x", "", 1)
    assert len(fits.encode()) == JSON_LIMIT
    assert httpx.post(f"{base}/api/session", content=fits.encode(), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S).status_code != 413


def test_panel_reopen_mid_close(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = person("Ada", "Byrne", "owner")
    title = f"Reopen {tag()}"
    w = seed(base, [owner], [document(title, owner, [signer("Ines", "Okafor")], [fld(1, "signature", 1, 0.2, 0.2, 0.3, 0.06)])])
    fid = Api(base).login(owner).doc(w.docs[title])["fields"][0]["id"]
    with browse(browser, base, f"/documents/{w.docs[title]}", user=owner) as page:
        field = by_id(page, f"field-{fid}")
        visible(page, field, "field")
        panel = page.get_by_role("complementary", name="Field properties")
        field.focus()
        visible(page, panel, "Field properties opens when the field is selected")
        advance(page, MOTION_WINDOW_MS)
        opened = panel.bounding_box()
        assert opened is not None

        def at_open_place() -> None:
            expect(panel).to_be_visible(timeout=POLL_MS)
            box = panel.bounding_box()
            assert box is not None and abs(box["x"] - opened["x"]) <= PX_TOL, f"panel at {box}, open place {opened}"

        page.keyboard.press("Escape")
        advance(page, (PANEL_MIN_MS + PANEL_MAX_MS) / 4)
        field.focus()
        advance(page, MOTION_WINDOW_MS)
        eventually(page, at_open_place, LOAD_S, "reselecting mid-close brings the panel back to its open place")
        advance(page, MOTION_WINDOW_MS * 3)
        at_open_place()
        expect(field).to_have_attribute("aria-pressed", "true")


ALLOWED_LICENCES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
FONT_LICENCES = ALLOWED_LICENCES | {"OFL-1.1"}
FONT_SUFFIXES = {".woff", ".woff2", ".ttf", ".otf"}
DATASTORE_CLIENTS = {"redis", "ioredis", "mongodb", "mongoose", "sqlite3", "better-sqlite3", "amqplib", "kafkajs",
                     "memcached", "bullmq", "bull", "level", "lowdb", "nedb", "lokijs"}


def font_package(name: str) -> bool:
    import conftest
    for root in {APP_ROOT, Path(getattr(conftest, "DEPLOYED_APP", APP_ROOT))}:
        folder = root / "node_modules" / name
        if folder.is_dir() and any(f.suffix.lower() in FONT_SUFFIXES for f in folder.rglob("*") if f.is_file()):
            return True
    return False


def test_if_run_manifest() -> None:
    data = json.loads((APP_ROOT / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), f"run.json {key} missing"


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:10]}"


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages()
           if not licence_allowed(p.licence, FONT_LICENCES if font_package(p.name) else ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad[:10]}"


def test_if_no_extra_datastores() -> None:
    found = sorted({p.name for p in shipped_packages()} & DATASTORE_CLIENTS)
    assert not found, f"extra datastore clients shipped: {found}"


def test_if_service_config_unchanged() -> None:
    if not TRAJECTORY.exists():
        return
    edits: list[str] = []
    compose_file = re.compile(r"(^|[/\\])[\w.-]*compose[\w.-]*\.ya?ml$")
    bash_edit = re.compile(r"(?:>>?\s*|\btee\s+(?:-a\s+)?)\S*compose[\w.-]*\.ya?ml|\bsed\s+-i\S*\s[^;&|\n]*compose[\w.-]*\.ya?ml")

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or "")
            args = node.get("input") or node.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {"command": args}
            if not isinstance(args, dict):
                args = {}
            if name in {"Write", "Edit", "MultiEdit", "write_file", "edit_file", "str_replace_editor"}:
                target = str(args.get("file_path") or args.get("path") or "")
                if compose_file.search(target):
                    edits.append(target)
            if name in {"Bash", "bash", "shell"}:
                command = str(args.get("command") or args.get("cmd") or "")
                if bash_edit.search(command):
                    edits.append(command[:200])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(json.loads(TRAJECTORY.read_text()))
    assert not edits, f"the agent edited the compose definitions: {edits[:3]}"


def test_if_typescript_source() -> None:
    import conftest
    skip = {"node_modules", "dist", "build", ".git", "coverage", ".next", "out"}
    candidates = [p for p in APP_ROOT.rglob("*") if p.is_file() and p.suffix in {".js", ".jsx", ".mjs", ".cjs"}
                  and not skip & set(p.relative_to(APP_ROOT).parts) and ".config." not in p.name
                  and not any(part.startswith(".") for part in p.relative_to(APP_ROOT).parts[:-1])]
    module_dirs = [d / "node_modules" for d in {APP_ROOT, Path(getattr(conftest, "DEPLOYED_APP", APP_ROOT))}
                   if (d / "node_modules").is_dir()]

    def vendored(p: Path) -> bool:
        data = p.read_bytes()
        for nm in module_dirs:
            for c in nm.rglob(p.name):
                if c.is_file() and c.stat().st_size == len(data) and c.read_bytes() == data:
                    return True
        return False

    js = [str(p) for p in candidates if not vendored(p)]
    assert not js, f"JavaScript source files: {js[:10]}"
