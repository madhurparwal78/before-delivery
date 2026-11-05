from __future__ import annotations

import json
import os
import re
import secrets
import signal
import socket
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, Route, expect

from conftest import (
    DEPLOYED_APP, PocketBase, S3, addresses, advance, animations, capture, center, changed, check, click, decode,
    fill, held, idempotency_key, layout, licence_allowed, open_app, pdf_text, same_origin, session,
    shipped_packages, tab_order, tap,
)
from conftest import text as message_text


APP_ROOT = Path("/app")
SEATS = 24
BENCH_FULL = 345000
ATELIER_FULL = 590000
BENCH_DEPOSIT = 90000
ATELIER_DEPOSIT = 150000
BENCH_BALANCE = 255000
ATELIER_BALANCE = 440000
UPGRADE_DIFF = 245000
UPGRADE_NOW_EARLY = 60000
EARLY_FEE = 25000
WORKED_REFUND = 565000
WORKED_PAID = 590000
HOLD_DEFAULT_S = 480
OFFER_DEFAULT_S = 86400
CLINIC_MAX = 6
ATELIER_CAP = 10
LINK_SECONDS = 60
FILE_LIMIT = 10_000_000
MULTIPART_LIMIT = 10_100_000
JSON_LIMIT = 65_536
NAME_MAX = 120
PASSWORD_MIN = 10
ID_MIN = 16
SESSION_MAX_MINUTES = 480
SESSION_MIN_MINUTES = 15
DEBOUNCE_MS = 200
MAP_REFRESH_MS = 2000
LIFT_SETTLE_MS = 600
PRELOAD_MS = 900
AZIMUTH_MAX = 35
ELEVATION_MIN = 20
ELEVATION_MAX = 62
OVERPULL = 8
RING_TOLERANCE = 0.02
EXPIRY_GRACE_S = 2
RECEIPT_RETRY_S = 10
MAIL_RETRY_S = 10
REMINDER_CHECK_S = 60
GRID_COLUMNS = 12
VIEW_PHONE = (375, 812)
VIEW_TABLET = (768, 1024)
VIEW_DESKTOP = (1280, 800)
LAST_DEPOSIT_DAY = date(2027, 3, 19).isoformat()
DEPOSITS_CLOSED_DAY = date(2027, 3, 20).isoformat()
CHECKIN_DAY1 = date(2027, 4, 16).isoformat()
CHECKIN_DAY2 = date(2027, 4, 17).isoformat()
SECOND_ANSWER = "Dp second answer"

FRAME_MS = 50
STEP_MS = 100
SLACK_S = 15
MAIL_WAIT_S = 30
UI_WAIT_S = 25
QUICK_MS = 2000
HTTP_TIMEOUT_S = 60
BOOT_S = 240
TAB_LIMIT = 150
NOTICE_WINDOW = 12
OFL_NAME = re.compile(r"(SIL )?Open Font Licen[cs]e", re.I)
SCRUB_SETTLE_STEPS = 40
CHOOSER_WAIT_MS = 2000
FILE_PICKER = re.compile(r"choose|browse|select|add|attach|pick|drop|file|scan", re.I)
FORM_SUBMIT = re.compile(r"\b(upload|save|submit|send)\b", re.I)
DRAG_STEPS = 10
DRAG_STEP_PX = 60
SCROLL_STEPS_PER_VIEW = 4
ELAPSED_S = 60

WRONG_CLOCK = "2031-06-01T12:00:00Z"
EARLY_CLOCK = "2027-01-10T12:00:00Z"
LATE_CLOCK = "2027-04-01T12:00:00Z"

STAFF = {
    "director": ("Mara Okonkwo-Lindqvist", "director@opaline-institute.test", "bench-days-director-2027"),
    "registrar": ("Theo Vasquez-Hale", "registrar@opaline-institute.test", "bench-days-registrar-2027"),
    "frontdesk": ("Priya Anand-Sorensen", "frontdesk@opaline-institute.test", "bench-days-frontdesk-2027"),
}
FONTS = ("Bodoni Moda", "Instrument Sans")
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
HANDS_ON_ERROR = "Hands-on time must stay at least 30% of the agenda."
ATELIER_DINNER = "Atelier dinner with the instructor"
EVENINGS = ("Welcome reception", ATELIER_DINNER, "Bench breakfast")
DAY1_TITLES = ("Shade and translucency mapping", "Palatal shell from a silicone index",
               "Dentin mamelons and internal effects", "Class IV layering on the typodont")
JSON_CT = {"Content-Type": "application/json"}
LABELS = [f"{row}{n}" for row in "ABCD" for n in range(1, 7)]

PDF = b"%PDF-1.4\n%dp-test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML = b"<!doctype html><html><script>alert(1)</script></html>"


def env_url(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        pytest.fail(f"{name} names an instance from the spec's outages; it is not set")
    return value.rstrip("/")


def fresh_identity(prefix: str = "dp") -> tuple[str, str]:
    tag = secrets.token_hex(5)
    return f"Dp {prefix.split('-')[-1].title()} {tag}", f"{prefix}-{tag}@example.test"


def ok(resp: httpx.Response, status: int = 200) -> Any:
    assert resp.status_code == status, f"{resp.request.method} {resp.request.url.path} answered {resp.status_code}; expected {status}: {resp.text[:600]}"
    return resp.json() if resp.content else None


def expect_error(resp: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert resp.status_code == status, f"{resp.request.method} {resp.request.url.path} answered {resp.status_code}; expected {status} {code}: {resp.text[:600]}"
    body = resp.json()
    assert body.get("error") == code, f"expected error {code!r}, got {body}"
    assert isinstance(body.get("message"), str), f"error shape lacks a message: {body}"
    return body


def cents(amount: Any) -> int:
    return int((Decimal(str(amount)) * 100).to_integral_value())


def usd(value: int) -> str:
    return f"{value // 100:,}.{value % 100:02d}"


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class Actor:
    def __init__(self, base: str, name: str, email: str, password: str, clinic_name: str | None = None) -> None:
        self.base, self.name, self.email, self.password, self.clinic_name = base, name, email, password, clinic_name
        self.account_id = ""
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)

    def sign_in(self) -> "Actor":
        body = ok(self.http.post("/api/auth/signin", json={"email": self.email, "password": self.password}))
        self.account_id = body["account"]["id"]
        return self

    def on(self, base: str) -> "Actor":
        return Actor(base, self.name, self.email, self.password, self.clinic_name).sign_in()

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.http.get(path, params=params or None)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        return self.http.post(path, json={} if body is None else body, headers={"Idempotency-Key": key} if key else {})

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.http.put(path, json=body)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)


def signup(base: str, kind: str = "practitioner", name: str | None = None, email: str | None = None) -> Actor:
    gen_name, gen_email = fresh_identity(f"dp-{kind}")
    actor = Actor(base, name or gen_name, email or gen_email, "pw-" + secrets.token_hex(8),
                  f"Dp Clinic {secrets.token_hex(4)}" if kind == "clinic" else None)
    body: dict[str, Any] = {"name": actor.name, "email": actor.email, "password": actor.password, "kind": kind}
    if actor.clinic_name:
        body["clinic_name"] = actor.clinic_name
    actor.account_id = ok(actor.http.post("/api/auth/signup", json=body), 201)["account"]["id"]
    return actor


def staff(base: str, role: str) -> Actor:
    name, email, password = STAFF[role]
    return Actor(base, name, email, password).sign_in()


def board(base: str, actor: Actor | None = None) -> dict[str, Any]:
    if actor is not None:
        return ok(actor.get("/api/benches"))
    return ok(httpx.get(base + "/api/benches", timeout=HTTP_TIMEOUT_S))


def state_map(body: dict[str, Any]) -> dict[str, str]:
    return {b["label"]: b["state"] for b in body["benches"]}


def open_labels(base: str, rows: str) -> list[str]:
    states = state_map(board(base))
    return [label for label in LABELS if label[0] in rows and states.get(label) == "open"]


def hold_body(actor: Actor, rows: str = "CD", label: str | None = None) -> dict[str, Any]:
    candidates = [label] if label else open_labels(actor.base, rows)
    for bench in candidates:
        r = actor.post("/api/holds", {"benches": [bench]})
        if r.status_code == 201:
            return r.json()
        if r.status_code != 409 or r.json().get("error") != "bench_taken" or label:
            pytest.fail(f"POST /api/holds for {bench} answered {r.status_code} {r.text[:300]}; expected 201")
    pytest.fail(f"no open bench in rows {rows} could be held; expected 201 for an open bench")


def hold(actor: Actor, rows: str = "CD", label: str | None = None) -> dict[str, Any]:
    return hold_body(actor, rows, label)["reservations"][0]


def pay(actor: Actor, rid: str, kind: str, key: str | None = None) -> httpx.Response:
    return actor.post(f"/api/reservations/{rid}/{kind}", {"billing_name": actor.name}, key or idempotency_key())


def seat(base: str, kind: str = "full", name: str | None = None, rows: str = "CD") -> tuple[Actor, dict[str, Any]]:
    actor = signup(base, name=name)
    res = hold(actor, rows)
    return actor, ok(pay(actor, res["id"], kind), 201)["reservation"]


def cancel(actor: Actor, rid: str) -> Any:
    return ok(actor.post(f"/api/reservations/{rid}/cancel"))


def release(actor: Actor, rid: str) -> Any:
    return ok(actor.post(f"/api/reservations/{rid}/release"))


def quietly(fn: Callable[..., Any], *args: Any) -> Any:
    try:
        return fn(*args)
    except Exception:
        return None


def reservation(actor: Actor, rid: str) -> dict[str, Any]:
    return ok(actor.get(f"/api/reservations/{rid}"))["reservation"]


def me_seat(actor: Actor, label: str) -> dict[str, Any]:
    for r in ok(actor.get("/api/me"))["reservations"]:
        if r["bench"] == label:
            return r
    pytest.fail(f"GET /api/me lists no reservation on Bench {label}")


def upgrade(actor: Actor, rid: str, bench: str, key: str | None = None) -> httpx.Response:
    return actor.post(f"/api/reservations/{rid}/upgrade", {"bench": bench, "billing_name": actor.name}, key or idempotency_key())


def group_hold(clinic: Actor, labels: list[str]) -> dict[str, Any]:
    return ok(clinic.post("/api/holds", {"benches": list(labels)}), 201)


def checkout(clinic: Actor, gid: str, assignments: list[dict[str, str]] | None = None, key: str | None = None) -> httpx.Response:
    return clinic.post(f"/api/groups/{gid}/checkout", {"billing_name": clinic.clinic_name or clinic.name,
                                                      "assignments": assignments or []}, key or idempotency_key())


def paid_group(base: str, labels: list[str], assignments: list[dict[str, str]] | None = None) -> tuple[Actor, dict[str, Any]]:
    clinic = signup(base, "clinic")
    gid = group_hold(clinic, labels)["group_id"]
    return clinic, ok(checkout(clinic, gid, assignments), 201)["group"]


def by_bench(group: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {r["bench"]: r for r in group["reservations"]}


def fill_rows(base: str, rows: str, first_size: int = CLINIC_MAX, keep: int = 0) -> list[tuple[Actor, str, list[str]]]:
    labels = open_labels(base, rows)
    labels = labels[: max(0, len(labels) - keep)]
    groups: list[tuple[Actor, str, list[str]]] = []
    size = first_size
    while labels:
        chunk, labels = labels[:size], labels[size:]
        clinic = signup(base, "clinic")
        groups.append((clinic, group_hold(clinic, chunk)["group_id"], chunk))
        size = CLINIC_MAX
    return groups


def fill_atelier(base: str, target_active: int) -> list[tuple[Actor, str, list[str]]]:
    need = target_active - board(base)["tiers"]["atelier"]["active"]
    assert need >= 0, "Atelier is already past the requested active count"
    labels = open_labels(base, "AB")[:need]
    groups = []
    while labels:
        chunk, labels = labels[:CLINIC_MAX], labels[CLINIC_MAX:]
        clinic = signup(base, "clinic")
        groups.append((clinic, group_hold(clinic, chunk)["group_id"], chunk))
    return groups


def release_groups(groups: list[tuple[Actor, str, list[str]]]) -> None:
    for clinic, gid, _ in groups:
        quietly(clinic.post, f"/api/groups/{gid}/release")


def race(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls), timeout=HTTP_TIMEOUT_S)

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def eventually(predicate: Callable[[], Any], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except (AssertionError, KeyError, StopIteration, TypeError, httpx.HTTPError) as exc:
            last = exc
    pytest.fail(f"expected {what} within {seconds}s ({last})")


def check_ledger(body: dict[str, Any]) -> None:
    states = state_map(body)
    not_open = sum(1 for s in states.values() if s != "open")
    assert body["seats_total"] == SEATS and len(states) == SEATS
    assert not_open == SEATS - body["seats_remaining"], body
    assert body["seats_remaining"] == SEATS - body["held"] - body["sold"], body
    assert body["tiers"]["bench"]["remaining"] == sum(1 for l, s in states.items() if l[0] in "CD" and s == "open")
    atelier = body["tiers"]["atelier"]
    open_ab = sum(1 for l, s in states.items() if l[0] in "AB" and s == "open")
    assert atelier["cap"] == ATELIER_CAP and atelier["remaining"] == min(open_ab, ATELIER_CAP - atelier["active"]), body
    assert atelier["sold_out"] == (atelier["active"] >= ATELIER_CAP)


def mails(mail: Any, to: str, subject: str | None = None) -> list[dict[str, Any]]:
    out = []
    for m in mail.messages():
        if to.lower() in [a.lower() for a in addresses(m.get("To"))] and (subject is None or m.get("Subject") == subject):
            out.append(m)
    return out


def await_mail(mail: Any, to: str, subject: str, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = mails(mail, to, subject)
        if found:
            return found
    pytest.fail(f'expected the email "{subject}" to reach {to} within {seconds}s')


def mail_text(message: dict[str, Any]) -> str:
    return message_text(message)


def kb_account(killbill: Any, actor: Actor) -> dict[str, Any]:
    acc = killbill.account_by_key(f"ob-{actor.account_id}")
    assert acc, f"Kill Bill has no account ob-{actor.account_id}"
    return acc


def kb_invoices(killbill: Any, actor: Actor) -> list[dict[str, Any]]:
    return killbill.invoices(kb_account(killbill, actor)["accountId"])


def kb_payment(killbill: Any, key: str) -> dict[str, Any]:
    payment = killbill.payment_by_key(key)
    assert payment, f"Kill Bill has no payment {key}"
    return payment


def kb_tx(payment: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [t for t in payment.get("transactions", []) if t.get("transactionType") == kind and t.get("status") == "SUCCESS"]


def invoice_with(invoices: list[dict[str, Any]], description: str) -> dict[str, Any]:
    for inv in invoices:
        if any(i.get("description") == description for i in inv.get("items", [])):
            return inv
    pytest.fail(f"no Kill Bill invoice has an item {description!r}")


def items_sum(inv: dict[str, Any]) -> int:
    return sum(cents(i["amount"]) for i in inv.get("items", []))


def item_net(inv: dict[str, Any], description: str) -> int:
    item = next(i for i in inv["items"] if i.get("description") == description)
    return cents(item["amount"]) + sum(cents(i["amount"]) for i in inv["items"]
                                       if i.get("linkedInvoiceItemId") == item["invoiceItemId"])


def fetch_link(base: str, url: str) -> httpx.Response:
    return httpx.get(urljoin(base + "/", url), timeout=HTTP_TIMEOUT_S)


def upload(actor: Actor, rid: str, kind: str, content: bytes, fields: dict[str, str],
           filename: str = "scan.pdf", ctype: str = "application/pdf") -> httpx.Response:
    return actor.http.post(f"/api/reservations/{rid}/{kind}", data=fields, files={"file": (filename, content, ctype)})


def licence_fields() -> dict[str, str]:
    return {"licence_number": "LIC" + secrets.token_hex(4).upper(), "licence_state": "Illinois"}


def passport_fields(name: str) -> dict[str, str]:
    return {"full_name": name, "nationality": "Nat" + secrets.token_hex(4), "passport_number": "P" + secrets.token_hex(5).upper()}


def _opened(browser: Browser, url: str, reduced_motion: str, no_webgl: bool) -> Any:
    made = open_app(browser, url, reduced_motion=reduced_motion, no_webgl=no_webgl)
    return made if hasattr(made, "__enter__") else contextmanager(lambda: made)()


@contextmanager
def visit(browser: Browser, base: str, path: str = "/", actor: Actor | None = None, viewport: tuple[int, int] = VIEW_DESKTOP,
          reduced_motion: str = "no-preference", no_webgl: bool = False) -> Iterator[Page]:
    with _opened(browser, base + path, reduced_motion, no_webgl) as page:
        page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        if actor is not None:
            r = page.request.post(base + "/api/auth/signin", data={"email": actor.email, "password": actor.password})
            assert r.status == 200, f"browser sign-in answered {r.status}"
            page.goto(base + path)
        yield page


def _true(condition: Any, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def wait_ui(page: Page, probe: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            probe()
            return
        except (AssertionError, PlaywrightError) as exc:
            last = exc
        advance(page, STEP_MS)
    pytest.fail(f"expected {what} within {seconds}s ({last})")


def see(page: Page, locator: Locator, what: str, seconds: float = UI_WAIT_S) -> None:
    wait_ui(page, lambda: _true(locator.is_visible(), f"{what} not visible"), what, seconds)


def norm(value: str) -> str:
    return " ".join(value.split())


def see_text(page: Page, locator: Locator, copy: str, what: str) -> None:
    wait_ui(page, lambda: _true(copy in norm(locator.inner_text()), f"{what}: {locator.inner_text()!r}"), f"{what}: {copy!r}")


def status_count(page: Page, locator: Locator, pattern: str, what: str) -> int:
    found: list[int] = []

    def probe() -> None:
        m = re.search(pattern, norm(locator.inner_text()), re.M)
        _true(m, f"{what}: {locator.inner_text()!r}")
        found.append(int(m.group(1)))

    wait_ui(page, probe, what)
    return found[-1]


def is_focused(locator: Locator) -> bool:
    return bool(locator.evaluate("e => e === document.activeElement"))


def focus_in(locator: Locator) -> bool:
    return bool(locator.evaluate("e => e.contains(document.activeElement)"))


def press_until(page: Page, key: str, predicate: Callable[[], bool], what: str, presses: int = TAB_LIMIT) -> None:
    for _ in range(presses):
        page.keyboard.press(key)
        if predicate():
            return
    pytest.fail(f"pressing {key} never reached {what}")


def bench_map(page: Page) -> Locator:
    return page.get_by_role("grid", name="Bench map")


def bench_button(page: Page, label: str, state: str) -> Locator:
    return bench_map(page).get_by_role("button", name=f"Bench {label}, {state}", exact=True)


def bench_any(page: Page, label: str) -> Locator:
    return bench_map(page).get_by_role("button", name=re.compile(rf"^Bench {label}, "))


def hold_panel(page: Page) -> Locator:
    return page.get_by_role("region", name="Your hold")


def hold_timer_anywhere(page: Page) -> Locator:
    return page.get_by_role("region", name="Your hold", include_hidden=True).get_by_role(
        "timer", name="Hold time remaining", include_hidden=True)


def bench_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Bench updates", include_hidden=True)


def lab_scene(page: Page) -> Locator:
    return page.get_by_role("region", name="Lab scene")


def scene_attr(page: Page, name: str) -> str:
    return lab_scene(page).get_attribute(name) or ""


def mmss(value: str) -> int:
    m = re.search(r"(\d\d):(\d\d)", value)
    assert m, f"timer text {value!r} is not mm:ss"
    return int(m.group(1)) * 60 + int(m.group(2))


def letters(heading: Locator) -> tuple[int, bool]:
    return tuple(heading.evaluate(
        "h => { const l = [...h.querySelectorAll('[data-letter]')];"
        " return [l.length, l.every(e => e.closest('[aria-hidden=\"true\"]') !== null)]; }"))


def press_and_confirm(page: Page, button: Locator, confirm: re.Pattern[str]) -> None:
    click(button)
    advance(page, STEP_MS)
    dialog = page.get_by_role("dialog").filter(has=page.get_by_role("button", name=confirm))
    if dialog.count():
        click(dialog.last.get_by_role("button", name=confirm).last)


def choose_file(page: Page, dialog: Locator, payload: dict[str, Any]) -> None:
    for _ in range(TAB_LIMIT // 10):
        page.keyboard.press("Tab")
        focused = page.evaluate("""() => { const a = document.activeElement; if (!a) return null;
            return {type: a.type || '', tag: a.tagName, role: a.getAttribute('role') || '',
                    name: (a.getAttribute('aria-label') || a.innerText || '').trim()}; }""")
        if not focused:
            continue
        if focused["type"] == "file":
            with page.expect_file_chooser() as chooser:
                page.keyboard.press("Space")
            chooser.value.set_files(payload)
            return
        picker = (focused["tag"] == "BUTTON" or focused["role"] == "button") and focused["type"] != "submit"
        if picker and FILE_PICKER.search(focused["name"]) and not FORM_SUBMIT.search(focused["name"]):
            try:
                with page.expect_file_chooser(timeout=CHOOSER_WAIT_MS) as chooser:
                    page.keyboard.press("Enter")
            except PlaywrightError:
                continue
            chooser.value.set_files(payload)
            return
    pytest.fail("the upload dialog has no keyboard-reachable file input")


def submit_dialog(dialog: Locator) -> None:
    click(dialog.get_by_role("button", name=re.compile(r"upload|save|submit|send", re.I)).last)


def hidden_from_at(page: Page, snippet: str) -> bool:
    flags = page.evaluate(
        """s => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const out = []; let n;
        while ((n = w.nextNode())) { if (!n.data.includes(s)) continue; let hidden = !n.parentElement.checkVisibility({visibilityProperty: true});
          for (let e = n.parentElement; e && !hidden; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (e.hidden || e.inert || e.getAttribute('aria-hidden') === 'true' || cs.display === 'none' || cs.visibility === 'hidden') hidden = true; }
          out.push(hidden); } return out; }""", snippet)
    return all(flags)


def share_text(h: int, t: int) -> str:
    q = 0 if t == 0 else h * 1000 // t
    return f"Hands-on {h} of {t} minutes ({q // 10}.{q % 10}%)"


class Relay:
    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.up = True
        self.stopped = False
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        while not self.stopped:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            if not self.up:
                client.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.conns += [client, upstream]
            threading.Thread(target=self._pipe, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pipe, args=(upstream, client), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while chunk := src.recv(65536):
                dst.sendall(chunk)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.close()
                except OSError:
                    pass

    def down(self) -> None:
        self.up = False
        with self.lock:
            for c in self.conns:
                try:
                    c.shutdown(socket.SHUT_RDWR)
                    c.close()
                except OSError:
                    pass
            self.conns.clear()

    def restore(self) -> None:
        self.up = True

    def stop(self) -> None:
        self.stopped = True
        self.down()
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def relayed(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, Any]]:
    kb, s3u = urlparse(os.environ["KILLBILL_URL"]), urlparse(os.environ["S3_ENDPOINT"])
    relays = {
        "kb": Relay(kb.hostname or "127.0.0.1", kb.port or 80),
        "s3": Relay(s3u.hostname or "127.0.0.1", s3u.port or 80),
        "smtp": Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])),
    }
    port = _free_port()
    env = dict(os.environ,
               KILLBILL_URL=f"{kb.scheme}://127.0.0.1:{relays['kb'].port}{kb.path}",
               S3_ENDPOINT=f"{s3u.scheme}://127.0.0.1:{relays['s3'].port}{s3u.path}",
               SMTP_HOST="127.0.0.1", SMTP_PORT=str(relays["smtp"].port), APP_PUBLIC_PORT=str(port))
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tmp_path_factory.mktemp("relayed") / "app.log"
    with log.open("wb") as out:
        proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=out, stderr=subprocess.STDOUT,
                                start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + BOOT_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            pytest.fail(f"relayed app copy exited: {log.read_text(errors='replace')[-3000:]}")
        try:
            if httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200:
                break
        except httpx.HTTPError:
            continue
    else:
        pytest.fail(f"relayed app copy never answered health: {log.read_text(errors='replace')[-3000:]}")
    try:
        yield {"base": base, **relays}
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        quietly(proc.wait, HTTP_TIMEOUT_S)
        for relay in relays.values():
            relay.stop()


def test_wf_cross_cutting_health(app_url: str) -> None:
    for base in (app_url, env_url("APP_KILLBILL_DOWN_URL"), env_url("APP_MINIO_DOWN_URL"), env_url("APP_MAILPIT_DOWN_URL")):
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, (base, r.text)
    for name in ("APP_KILLBILL_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_MAILPIT_DOWN_URL"):
        body = board(env_url(name))
        assert body["seats_total"] == SEATS and len(body["benches"]) == SEATS
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1" and manifest["serve"]


def _multipart(total: int) -> tuple[bytes, str]:
    boundary = "dpboundary" + secrets.token_hex(8)
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n").encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    return head + b"%PDF-" + b"0" * (total - len(head) - len(tail) - 5) + tail, f"multipart/form-data; boundary={boundary}"


def _json_of(size: int) -> bytes:
    prefix, suffix = '{"email":"dp-nobody@example.test","password":"', '"}'
    return (prefix + "p" * (size - len(prefix) - len(suffix)) + suffix).encode()


def test_wf_cross_cutting_boundary(app_url: str) -> None:
    evil = "https://evil.example"
    expect_error(httpx.post(app_url + "/api/auth/signout", headers={"Origin": evil}), 403, "cross_origin")
    expect_error(httpx.post(app_url + "/api/holds", content=b"{", headers={"Origin": evil, **JSON_CT}), 403, "cross_origin")
    u = urlparse(app_url)
    r = httpx.post(app_url + "/api/auth/signin", content=_json_of(JSON_LIMIT), headers={"Origin": f"{u.scheme}://{u.netloc}", **JSON_CT})
    expect_error(r, 401, "invalid_credentials")
    expect_error(httpx.post(app_url + "/api/auth/signin", content=_json_of(JSON_LIMIT + 1), headers=JSON_CT), 413, "payload_too_large")
    expect_error(httpx.post(app_url + "/api/holds", content=_json_of(JSON_LIMIT + 1), headers=JSON_CT), 413, "payload_too_large")
    path = f"/api/reservations/res_{secrets.token_hex(12)}/licence"
    body, ctype = _multipart(MULTIPART_LIMIT + 1)
    expect_error(httpx.post(app_url + path, content=body, headers={"Content-Type": ctype}, timeout=HTTP_TIMEOUT_S), 413, "payload_too_large")
    body, ctype = _multipart(MULTIPART_LIMIT)
    expect_error(httpx.post(app_url + path, content=body, headers={"Content-Type": ctype}, timeout=HTTP_TIMEOUT_S), 401, "unauthenticated")
    for secret_path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/.git/config"):
        r = httpx.get(app_url + secret_path, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 404, f"{secret_path} answered {r.status_code}"
        assert "run-manifest-v1" not in r.text


def test_error_shape_precedence() -> None:
    jan = env_url("APP_JAN_EVE_URL")
    anon = httpx.Client(base_url=jan, timeout=HTTP_TIMEOUT_S)
    expect_error(anon.get("/api/me"), 401, "unauthenticated")
    expect_error(anon.post("/api/holds", content=b"{", headers=JSON_CT), 401, "unauthenticated")
    reg, director, fd = staff(jan, "registrar"), staff(jan, "director"), staff(jan, "frontdesk")
    fake = "res_" + secrets.token_hex(12)
    expect_error(reg.post("/api/holds", {"benches": ["C1"]}), 403, "forbidden")
    expect_error(reg.post(f"/api/reservations/{fake}/deposit", {"billing_name": "X"}), 403, "forbidden")
    expect_error(director.get(f"/api/reservations/{fake}"), 403, "forbidden")
    expect_error(fd.get("/api/desk/content/sessions"), 403, "forbidden")
    p = signup(jan)
    expect_error(p.get("/api/desk/inventory"), 403, "forbidden")
    expect_error(p.http.post("/api/holds", content=b"{", headers=JSON_CT), 400, "malformed_json")
    expect_error(p.http.post("/api/holds", content=b"benches=C1", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    expect_error(p.http.post(f"/api/reservations/{fake}/deposit", content=b"{", headers=JSON_CT), 400, "malformed_json")
    expect_error(p.http.post(f"/api/reservations/{fake}/deposit", json={"billing_name": p.name}), 404, "not_found")
    assert "benches" in expect_error(p.post("/api/holds", {"benches": ["Z9"]}), 422, "validation")["errors"]
    res = hold(p)
    try:
        body = expect_error(p.http.post(f"/api/reservations/{res['id']}/deposit", json={"billing_name": p.name}), 422, "validation")
        assert "idempotency_key" in body["errors"]
        for bad in ("bad key!", "abc"):
            assert "idempotency_key" in expect_error(pay(p, res["id"], "deposit", key=bad), 422, "validation")["errors"]
        expect_error(signup(jan).post(f"/api/reservations/{res['id']}/release"), 404, "not_found")
        release(p, res["id"])
        r = p.http.post(f"/api/reservations/{res['id']}/deposit", json={"billing_name": p.name})
        assert r.status_code == 409 and isinstance(r.json().get("error"), str), r.text
    finally:
        quietly(release, p, res["id"])


def test_accounts_and_roles() -> None:
    jan = env_url("APP_JAN_EVE_URL")
    name, email = fresh_identity("dp-acct")
    password = "pw-" + secrets.token_hex(8)
    c = httpx.Client(base_url=jan, timeout=HTTP_TIMEOUT_S)
    r = c.post("/api/auth/signup", json={"name": name, "email": email, "password": password, "kind": "practitioner"})
    acc = ok(r, 201)["account"]
    assert acc["role"] == "practitioner" and acc["email"].lower() == email.lower()
    assert re.fullmatch(rf"acc_.{{{ID_MIN},}}", acc["id"]), acc["id"]
    cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith("ob_session="))
    assert "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower(), cookie
    assert ok(c.get("/api/me"))["account"]["id"] == acc["id"]
    assert c.post("/api/auth/signout", json={}).status_code == 204
    expect_error(c.get("/api/me"), 401, "unauthenticated")
    anon = httpx.Client(base_url=jan, timeout=HTTP_TIMEOUT_S)
    expect_error(anon.post("/api/auth/signup", json={"name": name, "email": email.upper(), "password": password, "kind": "practitioner"}), 409, "email_taken")
    assert ok(anon.post("/api/auth/signin", json={"email": email.upper(), "password": password}))["account"]["id"] == acc["id"]
    expect_error(httpx.post(jan + "/api/auth/signin", json={"email": email, "password": password + "x"}), 401, "invalid_credentials")
    base_body = {"name": "Dp Valid", "email": fresh_identity("dp-v")[1], "password": "p" * PASSWORD_MIN, "kind": "practitioner"}
    for field, change in (("password", {"password": "p" * (PASSWORD_MIN - 1)}), ("name", {"name": ""}),
                          ("name", {"name": "n" * (NAME_MAX + 1)}), ("email", {"email": "not-an-email"}),
                          ("clinic_name", {"kind": "clinic"})):
        body = expect_error(httpx.post(jan + "/api/auth/signup", json={**base_body, **change}), 422, "validation")
        assert field in body["errors"], (field, body)
    clinic = signup(jan, "clinic")
    assert ok(clinic.get("/api/me"))["account"]["role"] == "clinic"
    for role in STAFF:
        assert ok(staff(jan, role).get("/api/me"))["account"]["role"] == role
    fake = "res_" + secrets.token_hex(12)
    expect_error(staff(jan, "director").post("/api/holds", {"benches": ["C1"]}), 403, "forbidden")
    expect_error(staff(jan, "frontdesk").post(f"/api/desk/reservations/{fake}/refund", key=idempotency_key()), 403, "forbidden")
    expect_error(staff(jan, "registrar").post("/api/checkin", {"reservation_id": fake, "day": 1}), 403, "forbidden")
    expect_error(staff(jan, "director").post(f"/api/desk/reservations/{fake}/certificate"), 403, "forbidden")
    expect_error(clinic.post("/api/waitlist", {"tier": "bench"}), 403, "forbidden")


def test_wf_bench_hold_phone(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    label = open_labels(jan, "CD")[-1]
    name, email = fresh_identity("dp-phone")
    password = "pw-" + secrets.token_hex(8)
    actor = Actor(jan, name, email, password)
    try:
        with visit(browser, jan, viewport=VIEW_PHONE) as page:
            see(page, bench_button(page, label, "Open"), "open bench on the phone list")
            bench_button(page, label, "Open").evaluate("e => e.scrollIntoView({block: 'center', behavior: 'instant'})")
            tap(bench_button(page, label, "Open"))
            dlg = page.get_by_role("dialog", name="Sign in")
            see(page, dlg, "sign-in dialog")
            click(dlg.get_by_role("button", name="Create an account"))
            create = page.get_by_role("dialog", name="Create account")
            see(page, create, "create account dialog")
            fill(create.get_by_role("textbox", name="Name"), name)
            fill(create.get_by_role("textbox", name="Email"), email)
            fill(create.get_by_role("textbox", name="Password"), password)
            check(create.get_by_role("radio", name="Practitioner"))
            click(create.get_by_role("button", name="Create account"))
            see(page, bench_button(page, label, "Held by you"), "the pending hold is sent after sign-up")
            timer = page.get_by_role("timer", name="Hold time remaining")
            see(page, timer, "countdown in the reserve bar")
            box = timer.bounding_box()
            assert box and box["y"] > VIEW_PHONE[1] / 2, "the countdown sits in the bar docked to the bottom"
        actor.sign_in()
        live = [r for r in ok(actor.get("/api/me"))["reservations"] if r["state"] == "held"]
        assert [r["bench"] for r in live] == [label], "exactly one hold was sent"
    finally:
        if actor.account_id:
            for r in ok(actor.get("/api/me"))["reservations"]:
                quietly(release, actor, r["id"])


VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}
INERT_VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024)}

HEADING_FOCUSED = "() => { const e = document.activeElement; return !!e && (/^H[1-6]$/.test(e.tagName) || e.getAttribute('role') === 'heading'); }"


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_wf_explore_event_journey(browser: Browser, app_url: str, size: str) -> None:
    w, h = VIEWPORTS[size]
    with visit(browser, app_url, viewport=(w, h)) as page:
        if w == VIEW_PHONE[0]:
            click(page.get_by_role("button", name="Menu"))
            drawer = page.get_by_role("dialog", name="Chapters")
            see(page, drawer, "chapter drawer")
            click(drawer.get_by_role("link", name="03 Two days"))
        else:
            click(page.get_by_role("navigation", name="Chapters").get_by_role("link", name="03 Two days"))
        wait_ui(page, lambda: _true(page.evaluate(HEADING_FOCUSED), "focus not on a heading"), "focus on the chapter heading")
        day1, day2 = page.get_by_role("tab", name="Day 1"), page.get_by_role("tab", name="Day 2")
        click(day2)
        wait_ui(page, lambda: expect(day2).to_have_attribute("aria-selected", "true", timeout=QUICK_MS), "Day 2 selected")
        see(page, page.get_by_role("tabpanel").get_by_text("Posterior anatomy and occlusal stamping"), "day 2 sessions")
        assert day1.get_attribute("tabindex") == "-1", "only the selected tab is in the Tab order"
        day2.focus()
        page.keyboard.press("ArrowLeft")
        wait_ui(page, lambda: expect(day1).to_have_attribute("aria-selected", "true", timeout=QUICK_MS), "Left selects Day 1")
        see(page, page.get_by_role("tabpanel").get_by_text("Shade and translucency mapping"), "day 1 sessions")
        details = page.get_by_role("button", name=f"Details for {EVENINGS[0]}")
        details.scroll_into_view_if_needed()
        click(details)
        wait_ui(page, lambda: expect(details).to_have_attribute("aria-expanded", "true", timeout=QUICK_MS), "details expanded")
        see(page, page.get_by_text("Drinks and small plates with the instructor"), "evening details")
        assert is_focused(details)
        faq = page.get_by_role("button", name="What should I bring?")
        faq.scroll_into_view_if_needed()
        faq.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: expect(faq).to_have_attribute("aria-expanded", "true", timeout=QUICK_MS), "FAQ expanded")
        see(page, page.get_by_text(re.compile(r"Your own loupes\.")), "FAQ answer")
        assert is_focused(faq)
        click(page.get_by_role("button", name="Reserve a bench").first)
        wait_ui(page, lambda: _true(focus_in(bench_map(page)), "focus not in the bench map"), "focus moved into the bench map")
        if w != VIEW_PHONE[0]:
            reserve = page.get_by_role("navigation", name="Chapters").get_by_role("link", name="07 Reserve")
            click(reserve)
            wait_ui(page, lambda: expect(reserve).to_have_attribute("aria-current", "true", timeout=QUICK_MS), "rail marks Reserve")
        layout(page)


CONTENT_KINDS = {
    "hospitality": ("hospitality_events", "title", {"day": 2, "starts_at": "21:00", "venue": "Dp venue", "tier": "all", "description": "Dp evening"}, "venue"),
    "hotels": ("hotels", "name", {"distance": "0.4 miles", "rate": "from $289 a night", "map_url": "https://maps.example.com/dp"}, "rate"),
    "faq": ("faq_entries", "question", {"answer": "Dp answer", "sort": 90}, "answer"),
}


def _session_body(number: int, minutes: int, fmt: str = "lecture") -> dict[str, Any]:
    return {"number": number, "day": 2, "title": f"Dp session {number}", "format": fmt, "minutes": minutes, "outcomes": ""}


def _agenda(director: Actor) -> tuple[int, int, list[dict[str, Any]]]:
    items = ok(director.get("/api/desk/content/sessions"))["items"]
    t = sum(int(i["minutes"]) for i in items)
    h = sum(int(i["minutes"]) for i in items if i["format"] == "hands-on")
    return h, t, items


def test_wf_explore_event_content_desk(app_url: str) -> None:
    director = staff(app_url, "director")
    pb = PocketBase()
    tag = secrets.token_hex(4)
    for kind, (collection, key, extra, field) in CONTENT_KINDS.items():
        value = f"Dp {kind} {tag}"
        item = ok(director.post(f"/api/desk/content/{kind}", {key: value, **extra}), 201)["item"]
        try:
            rec = [r for r in pb.records(collection) if r.get(key) == value]
            assert len(rec) == 1, f"{collection} lacks the created record"
            ok(director.patch(f"/api/desk/content/{kind}/{item['id']}", {field: f"changed {tag}"}))
            rec = [r for r in pb.records(collection) if r.get(key) == value][0]
            assert rec[field] == f"changed {tag}" and rec[key] == value, "PATCH changes only the sent field"
            assert any(i.get(key) == value for i in ok(director.get(f"/api/desk/content/{kind}"))["items"])
        finally:
            assert director.delete(f"/api/desk/content/{kind}/{item['id']}").status_code == 204
        assert not [r for r in pb.records(collection) if r.get(key) == value], f"{collection} record not deleted"
    number = secrets.randbelow(80_000) + 10_000
    for kind, body, field in (
        ("hotels", {"name": "Dp", "distance": "1 mile", "rate": "r", "map_url": "http://maps.example.com/x"}, "map_url"),
        ("hospitality", {"title": "Dp", "day": 3, "starts_at": "21:00", "venue": "v", "tier": "all", "description": "d"}, "day"),
        ("hospitality", {"title": "Dp", "day": 1, "starts_at": "9pm", "venue": "v", "tier": "all", "description": "d"}, "starts_at"),
        ("hospitality", {"title": "Dp", "day": 1, "starts_at": "21:00", "venue": "v", "tier": "vip", "description": "d"}, "tier"),
        ("faq", {"question": "q", "answer": "a", "sort": "first"}, "sort"),
        ("sessions", _session_body(number, SESSION_MIN_MINUTES - 1), "minutes"),
        ("sessions", {**_session_body(number, SESSION_MIN_MINUTES), "format": "seminar"}, "format"),
    ):
        assert field in expect_error(director.post(f"/api/desk/content/{kind}", body), 422, "validation")["errors"], (kind, field)
    h, t, items = _agenda(director)
    taken = int(items[0]["number"])
    assert "number" in expect_error(director.post("/api/desk/content/sessions", _session_body(taken, SESSION_MIN_MINUTES)), 422, "validation")["errors"]
    created: list[str] = []
    try:
        x = SESSION_MAX_MINUTES // 2 + SESSION_MIN_MINUTES
        slack = h * 10 // 3 - t
        while slack >= 2 * x:
            m = min(SESSION_MAX_MINUTES, slack - x)
            created.append(ok(director.post("/api/desk/content/sessions", _session_body(number + len(created) + 1, m)), 201)["item"]["id"])
            slack -= m
        assert x <= slack < 2 * x
        results = race([lambda n=n: director.post("/api/desk/content/sessions", _session_body(n, x)) for n in (number + 50, number + 51)])
        assert sorted(r.status_code for r in results) == [201, 422], [r.text for r in results]
        loser = next(r for r in results if r.status_code == 422)
        assert expect_error(loser, 422, "validation")["errors"]["minutes"] == HANDS_ON_ERROR
        created.append(next(r for r in results if r.status_code == 201).json()["item"]["id"])
        h2, t2, _ = _agenda(director)
        assert h2 * 10 >= t2 * 3, "the stored agenda keeps the hands-on rule"
    finally:
        for sid in reversed(created):
            quietly(director.delete, f"/api/desk/content/sessions/{sid}")


def test_public_content_live(browser: Browser, app_url: str) -> None:
    director = staff(app_url, "director")
    kind = "faq"
    question = f"Dp question {secrets.token_hex(4)}?"
    item = ok(director.post("/api/desk/content/faq", {"question": question, "answer": "Dp first answer", "sort": 95}), 201)["item"]
    try:
        content = ok(httpx.get(app_url + "/api/content", timeout=HTTP_TIMEOUT_S))
        assert question in [f["question"] for f in content["faq"]]
        sorts = [f["sort"] for f in content["faq"]]
        assert sorts == sorted(sorts), "FAQ ordered by sort"
        order = [(s["day"], s["number"]) for s in content["sessions"]]
        assert order == sorted(order), "sessions ordered by day then number"
        ok(director.patch(f"/api/desk/content/{kind}/{item['id']}", {"answer": SECOND_ANSWER}))
        content = ok(httpx.get(app_url + "/api/content", timeout=HTTP_TIMEOUT_S))
        assert next(f for f in content["faq"] if f["question"] == question)["answer"] == SECOND_ANSWER
        with visit(browser, app_url) as page:
            button = page.get_by_role("button", name=question)
            wait_ui(page, lambda: expect(button).to_have_count(1, timeout=QUICK_MS), "new FAQ on the public page")
            assert director.delete(f"/api/desk/content/{kind}/{item['id']}").status_code == 204
            page.reload()
            wait_ui(page, lambda: expect(page.get_by_role("button", name="What should I bring?")).to_have_count(1, timeout=QUICK_MS), "page reloaded")
            assert page.get_by_role("button", name=question).count() == 0
        content = ok(httpx.get(app_url + "/api/content", timeout=HTTP_TIMEOUT_S))
        assert question not in [f["question"] for f in content["faq"]]
    finally:
        quietly(director.delete, f"/api/desk/content/{kind}/{item['id']}")


def _dinner(actor: Actor | None, base: str) -> dict[str, Any]:
    body = ok(actor.get("/api/content")) if actor else ok(httpx.get(base + "/api/content", timeout=HTTP_TIMEOUT_S))
    return next(e for e in body["hospitality"] if e["title"] == ATELIER_DINNER)


def test_hospitality_gating(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    gated = _dinner(None, jan)
    assert gated.get("gated") is True and gated["tier"] == "atelier"
    assert not {"starts_at", "venue", "description"} & set(gated), gated
    assert "Larkspur Room" not in httpx.get(jan + "/api/content", timeout=HTTP_TIMEOUT_S).text
    full = _dinner(staff(jan, "director"), jan)
    assert full["venue"] == "Larkspur Room, West Loop" and full["starts_at"] == "20:00"
    bench_buyer, bench_res = seat(jan, "full")
    q = signup(jan)
    qres = hold(q, "AB")
    try:
        assert "venue" not in _dinner(bench_buyer, jan)
        assert "venue" not in _dinner(q, jan)
        ok(pay(q, qres["id"], "deposit"), 201)
        assert _dinner(q, jan)["venue"] == "Larkspur Room, West Loop"
        with visit(browser, jan) as page:
            see(page, page.get_by_text("Atelier guests").first, "gated label")
            assert "Larkspur Room" not in page.content()
        with visit(browser, jan, actor=q) as page:
            details = page.get_by_role("button", name=f"Details for {ATELIER_DINNER}")
            details.scroll_into_view_if_needed()
            click(details)
            see(page, page.get_by_text("Larkspur Room, West Loop"), "revealed venue")
        cancel(q, qres["id"])
        assert "venue" not in _dinner(q, jan), "a cancelled seat no longer reveals the evening"
    finally:
        quietly(cancel, q, qres["id"])
        quietly(release, q, qres["id"])
        quietly(cancel, bench_buyer, bench_res["id"])


def test_wf_explore_event_hands_on_share(browser: Browser, app_url: str) -> None:
    director = staff(app_url, "director")
    h, t, items = _agenda(director)
    sel = sorted((i for i in items if i["format"] == "lecture"), key=lambda i: (i["day"], i["number"]))[0]
    m = int(sel["minutes"])
    base_t = t - m
    edge = h * 10 // 3 - base_t
    calls: list[str] = []
    with visit(browser, app_url, "/desk/content", actor=director) as page:
        click(page.get_by_role("tablist", name="Content").get_by_role("tab", name="Agenda"))
        status = page.get_by_role("status", name="Hands-on share")
        see_text(page, status, share_text(h, t), "share at load")
        click(page.get_by_role("list", name="Sessions").get_by_role("button", name=f"Session {sel['number']}: {sel['title']}"))
        minutes = page.get_by_role("textbox", name="Minutes")
        see(page, minutes, "minutes field")
        page.on("request", lambda r: calls.append(r.url) if "/api/desk/content" in r.url else None)
        minutes.focus()
        minutes.press("Control+A")
        minutes.press("Backspace")
        see_text(page, status, share_text(h, base_t), "empty Minutes counts as 0")
        for k, ch in enumerate(str(edge), start=1):
            minutes.press(ch)
            expect(status).to_have_text(share_text(h, base_t + int(str(edge)[:k])), timeout=QUICK_MS)
        no_rule_error = re.compile(rf"^(?!.*{re.escape(HANDS_ON_ERROR)}).*$", re.S)
        expect(minutes).to_have_accessible_description(no_rule_error, timeout=QUICK_MS)
        assert page.get_by_text(HANDS_ON_ERROR).count() == 0 or not page.get_by_text(HANDS_ON_ERROR).first.is_visible()
        minutes.press("Control+A")
        over = str(edge + 1)
        for k, ch in enumerate(over, start=1):
            minutes.press(ch)
            expect(status).to_have_text(share_text(h, base_t + int(over[:k])), timeout=QUICK_MS)
        expect(minutes).to_have_attribute("aria-invalid", "true", timeout=QUICK_MS)
        expect(minutes).to_have_accessible_description(re.compile(re.escape(HANDS_ON_ERROR)), timeout=QUICK_MS)
        check(page.get_by_role("radiogroup", name="Format").get_by_role("radio", name="Hands-on"))
        expect(status).to_have_text(share_text(h + edge + 1, base_t + edge + 1), timeout=QUICK_MS)
        expect(minutes).to_have_accessible_description(no_rule_error, timeout=QUICK_MS)
        check(page.get_by_role("radiogroup", name="Format").get_by_role("radio", name="Lecture"))
        expect(minutes).to_have_attribute("aria-invalid", "true", timeout=QUICK_MS)
        expect(minutes).to_have_accessible_description(re.compile(re.escape(HANDS_ON_ERROR)), timeout=QUICK_MS)
        minutes.press("Backspace")
        expect(status).to_have_text(share_text(h, base_t + int(over[:-1] or "0")), timeout=QUICK_MS)
        expect(minutes).to_have_accessible_description(no_rule_error, timeout=QUICK_MS)
    assert not calls, f"typing sent content requests: {calls}"
    assert int(next(i for i in _agenda(director)[2] if i["id"] == sel["id"])["minutes"]) == m, "nothing was saved"


def _xs(boxes: list[dict[str, float] | None]) -> int:
    return len({round(b["x"] / 8) for b in boxes if b})


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_layouts_three_viewports(browser: Browser, app_url: str, size: str) -> None:
    w, h = VIEWPORTS[size]
    phone, desktop = w == VIEW_PHONE[0], w == VIEW_DESKTOP[0]
    with visit(browser, app_url, viewport=(w, h)) as page:
        see(page, bench_map(page), "bench map")
        layout(page)
        row_a = [bench_any(page, f"A{i}").bounding_box() for i in range(1, 7)]
        row_b = bench_any(page, "B1").bounding_box()
        assert all(row_a) and row_b and row_b["y"] > row_a[0]["y"]
        ys = [b["y"] for b in row_a]
        if phone:
            assert ys == sorted(ys) and len(set(round(y) for y in ys)) == 6, "one bench per line at 375"
        else:
            assert max(ys) - min(ys) < row_a[0]["height"] / 2, "row A is one line of six"
        evening = [page.get_by_role("button", name=f"Details for {t}").bounding_box() for t in EVENINGS]
        assert _xs(evening) == (1 if phone else 3 if desktop else 2), f"evening columns at {size}: {evening}"
        panel = page.get_by_role("tabpanel")
        titles = [panel.get_by_text(t).first.bounding_box() for t in DAY1_TITLES]
        assert _xs(titles) == (2 if desktop else 1), f"agenda columns at {size}: {titles}"
        reserve = page.get_by_role("button", name="Reserve a bench").first.bounding_box()
        assert reserve
        if phone:
            assert reserve["y"] > h / 2, "reserve bar docked to the bottom at 375"
            assert page.get_by_role("button", name="Menu").is_visible()
            t1, t2 = page.get_by_role("tab", name="Day 1").bounding_box(), page.get_by_role("tab", name="Day 2").bounding_box()
            assert t1 and t2 and abs(t1["width"] - t2["width"]) <= 1 and t1["width"] + t2["width"] >= w / 2
        else:
            assert reserve["y"] < h / 2 and reserve["x"] > w / 2, "reserve bar in the top-right of the header"
            rail = page.get_by_role("navigation", name="Chapters").bounding_box()
            assert rail and rail["x"] + rail["width"] >= w * (GRID_COLUMNS - 1) / GRID_COLUMNS, "rail on the right edge"
        grid_box = bench_map(page).bounding_box()
        assert grid_box
        if desktop:
            assert grid_box["x"] >= w * 7 / GRID_COLUMNS, "bench map on the right third at 1280"
        else:
            assert grid_box["x"] < w / 3
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        advance(page, STEP_MS)
        layout(page)


@pytest.mark.parametrize("size", list(INERT_VIEWPORTS), ids=list(INERT_VIEWPORTS))
def test_collapsed_panels_inert(browser: Browser, app_url: str, size: str) -> None:
    w, h = INERT_VIEWPORTS[size]
    answer, detail = "Your own loupes.", "Drinks and small plates with the instructor"
    with visit(browser, app_url, viewport=(w, h)) as page:
        see(page, page.get_by_role("button", name="What should I bring?"), "FAQ question")
        layout(page)
        assert hidden_from_at(page, answer) and hidden_from_at(page, detail)
        names = tab_order(page, TAB_LIMIT)
        if w == VIEW_PHONE[0]:
            assert not [n for n in names if re.match(r"^0\d ", n or "")], f"closed drawer links focusable: {names}"
            assert hidden_from_at(page, "01 Overture")
            click(page.get_by_role("button", name="Menu"))
            drawer = page.get_by_role("dialog", name="Chapters")
            see(page, drawer.get_by_role("link", name="01 Overture"), "drawer link once open")
            click(drawer.get_by_role("button", name="Close menu"))
            wait_ui(page, lambda: _true(hidden_from_at(page, "01 Overture"), "drawer still exposed"), "drawer closed again")
        faq = page.get_by_role("button", name="What should I bring?")
        faq.scroll_into_view_if_needed()
        click(faq)
        wait_ui(page, lambda: _true(not hidden_from_at(page, answer), "answer hidden"), "answer opened")
        click(faq)
        wait_ui(page, lambda: _true(hidden_from_at(page, answer), "answer exposed"), "answer collapsed again")
        details = page.get_by_role("button", name=f"Details for {EVENINGS[0]}")
        click(details)
        wait_ui(page, lambda: _true(not hidden_from_at(page, detail), "details hidden"), "details opened")
        click(details)
        wait_ui(page, lambda: _true(hidden_from_at(page, detail), "details exposed"), "details collapsed again")
        layout(page)


def _wait_ready(page: Page) -> None:
    lab_scene(page).scroll_into_view_if_needed()
    wait_ui(page, lambda: _true(scene_attr(page, "data-ready") == "true", "scene not ready"), "lab scene ready")


def _drag(page: Page, x: float, y: float, dx: float, dy: float) -> float:
    page.mouse.move(x, y)
    page.mouse.down()
    worst = 0.0
    for i in range(1, DRAG_STEPS + 1):
        page.mouse.move(x + dx * i, y + dy * i)
        advance(page, FRAME_MS)
        worst = max(worst, abs(float(scene_attr(page, "data-azimuth") or 0)))
    page.mouse.up()
    advance(page, LIFT_SETTLE_MS)
    return worst


def test_lab_scene_orbit_drag(browser: Browser, app_url: str) -> None:
    with visit(browser, app_url) as page:
        _wait_ready(page)
        scene = lab_scene(page)
        before = decode(capture(scene))
        az0 = float(scene_attr(page, "data-azimuth"))
        x, y = center(scene)
        worst = _drag(page, x, y, DRAG_STEP_PX, 0)
        assert worst <= AZIMUTH_MAX + OVERPULL, f"drag pulled {worst} degrees"
        az1 = float(scene_attr(page, "data-azimuth"))
        assert az1 != az0 and abs(az1) <= AZIMUTH_MAX, (az0, az1)
        changed(before, decode(capture(scene)))
        el0 = float(scene_attr(page, "data-elevation"))
        _drag(page, x, y, 0, DRAG_STEP_PX / 2)
        el1 = float(scene_attr(page, "data-elevation"))
        if el1 == el0:
            _drag(page, x, y, 0, -DRAG_STEP_PX / 2)
            el1 = float(scene_attr(page, "data-elevation"))
        assert el1 != el0 and ELEVATION_MIN <= el1 <= ELEVATION_MAX, (el0, el1)
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        direction = -1 if az1 > 0 else 1
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for i in range(1, DRAG_STEPS + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + direction * DRAG_STEP_PX / 2 * i, "y": y}]})
            advance(page, FRAME_MS)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        advance(page, LIFT_SETTLE_MS)
        az2 = float(scene_attr(page, "data-azimuth"))
        assert az2 != az1 and abs(az2) <= AZIMUTH_MAX, (az1, az2)


def test_lab_scroll_camera_preloader(browser: Browser, app_url: str) -> None:
    with visit(browser, app_url) as page:
        bar = page.get_by_role("progressbar", name="Loading the lab")
        bench_map = page.get_by_role("grid", name="Bench map")
        see(page, bench_map, "the lab's bench map")
        bench_map.evaluate("e => e.scrollIntoView({block: 'center', behavior: 'instant'})")
        values: list[float] = []
        started_ms = elapsed = 0.0
        deadline = time.monotonic() + UI_WAIT_S
        while time.monotonic() < deadline:
            now = bar.get_attribute("aria-valuenow") if bar.count() else None
            if now is not None:
                if not values or float(now) == 0:
                    started_ms = elapsed
                values.append(float(now))
            elif values:
                break
            advance(page, FRAME_MS)
            elapsed += FRAME_MS
        else:
            pytest.fail(f"progressbar Loading the lab never counted to removal: {values}")
        assert values == sorted(values), f"preloader counts up: {values}"
        assert elapsed - started_ms <= PRELOAD_MS + FRAME_MS, f"preloader took {elapsed - started_ms} ms"
        _wait_ready(page)
        full = page.evaluate("() => document.documentElement.scrollHeight")
        view = page.evaluate("() => window.innerHeight")
        positions = list(range(0, full, max(1, view // SCROLL_STEPS_PER_VIEW)))
        samples = []
        for pos in positions + positions[::-1]:
            page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", pos)
            last = None
            for _ in range(SCRUB_SETTLE_STEPS):
                advance(page, FRAME_MS)
                now = (float(scene_attr(page, "data-scroll-progress") or 0), float(scene_attr(page, "data-elevation") or 0))
                if last and abs(now[0] - last[0]) < 0.001 and abs(now[1] - last[1]) < 0.05:
                    break
                last = now
            samples.append(now)
        down, back = samples[: len(positions)], samples[len(positions):]
        assert [p for p, _ in down] == sorted(p for p, _ in down), "progress rises with scroll"
        assert [p for p, _ in back] == sorted((p for p, _ in back), reverse=True), "progress reverses on scroll back"
        assert [e for _, e in down] == sorted((e for _, e in down), reverse=True), "camera descends as progress rises"
        assert any(p == 0 for p, _ in down) and any(p == 1 for p, _ in down)
        assert round(next(e for p, e in down if p == 0)) == ELEVATION_MAX and round(next(e for p, e in down if p == 1)) == ELEVATION_MIN


def test_reduced_motion_plan(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p = signup(jan)
    label = open_labels(jan, "CD")[0]
    try:
        with visit(browser, jan, actor=p, reduced_motion="reduce") as page:
            grid = bench_map(page)
            see(page, grid, "flat bench plan")
            assert lab_scene(page).count() == 0
            for row in "ABCD":
                assert grid.get_by_role("row", name=f"Row {row}").get_by_role("gridcell").count() == 6
            click(bench_button(page, label, "Open"))
            see(page, bench_button(page, label, "Held by you"), "held under reduced motion")
            panel = hold_panel(page)
            assert letters(panel.get_by_role("heading").first)[0] == 0, "no kinetic letters"
            assert not animations(grid) and not animations(panel), "nothing moves under reduced motion"
            timer = panel.get_by_role("timer", name="Hold time remaining")
            t1 = mmss(timer.inner_text())
            advance(page, 1000)
            assert 1 <= t1 - mmss(timer.inner_text()) <= 2
            click(panel.get_by_role("button", name="Pay in full"))
            dlg = page.get_by_role("dialog", name="Checkout")
            see(page, dlg, "checkout")
            click(dlg.get_by_role("button", name="Close"))
            click(panel.get_by_role("button", name="Release bench"))
            see(page, bench_button(page, label, "Open"), "released")
        with visit(browser, jan, no_webgl=True) as page:
            see(page, page.get_by_text("The 3D lab needs WebGL. Here is the flat bench plan."), "no-WebGL line")
            see(page, bench_map(page), "flat plan without WebGL")
            assert lab_scene(page).count() == 0
    finally:
        for r in ok(p.get("/api/me"))["reservations"]:
            quietly(release, p, r["id"])


def test_bench_states_per_viewer(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    a, b = signup(jan), signup(jan)
    director = staff(jan, "director")
    body = hold_body(a)
    res = body["reservations"][0]
    label = res["bench"]
    other = None
    try:
        after = board(jan)
        assert body["seats_remaining"] == after["seats_remaining"]
        check_ledger(after)
        assert set(state_map(after).values()) <= {"open", "held", "sold"}
        inv = ok(director.get("/api/desk/inventory"))
        assert (inv["seats_remaining"], inv["held"], inv["sold"]) == (after["seats_remaining"], after["held"], after["sold"])
        assert inv["atelier"]["active"] == after["tiers"]["atelier"]["active"]
        callers = [a, b] * 10
        answers = race([lambda c=c: c.get("/api/benches") for c in callers])
        for caller, r in zip(callers, answers):
            seen = state_map(ok(r))[label]
            assert seen == ("held_by_you" if caller is a else "held"), f"{caller.email} saw {seen}"
        assert state_map(board(jan))[label] == "held"
        with visit(browser, jan) as page:
            bar = page.get_by_text(re.compile(r"^\d+ of 24 seats remaining$")).first
            see(page, bar, "reserve bar count")
            other = hold(b)
            target = board(jan)["seats_remaining"]
            wait_ui(page, lambda: _true(norm(bar.inner_text()) == f"{target} of 24 seats remaining", bar.inner_text()),
                    "reserve bar shows the new ledger count", seconds=(MAP_REFRESH_MS + LIFT_SETTLE_MS) / 1000 + SLACK_S)
    finally:
        quietly(release, a, res["id"])
        if other:
            quietly(release, b, other["id"])


def test_wf_bench_hold_expiry(browser: Browser) -> None:
    short = env_url("APP_SHORT_URL")
    p = signup(short)
    body = hold_body(p)
    res = body["reservations"][0]
    started = time.monotonic()
    dur = res["hold"]["duration_seconds"]
    expires = parse_time(res["hold"]["expires_at"])
    assert 0 <= (expires - parse_time(body["server_time"])).total_seconds() <= dur
    for _ in range(3):
        cur = reservation(p, res["id"])
        if cur["state"] == "held":
            assert parse_time(cur["hold"]["expires_at"]) == expires, "reads never extend the hold"
            assert 0 <= cur["hold"]["seconds_remaining"] <= dur
    eventually(lambda: reservation(p, res["id"])["state"] == "released", dur + EXPIRY_GRACE_S + SLACK_S, "the expired hold released")
    assert time.monotonic() - started >= dur - 1, "the hold ended before its server expiry"
    assert state_map(board(short, p))[res["bench"]] != "held_by_you"

    jan = env_url("APP_JAN_EVE_URL")
    w = signup(jan)
    wlabel = open_labels(jan, "CD")[0]
    try:
        with visit(browser, jan, actor=w) as page:
            page.clock.set_system_time(WRONG_CLOCK)
            page.reload()
            see(page, bench_button(page, wlabel, "Open"), "open bench")
            click(bench_button(page, wlabel, "Open"))
            see(page, bench_button(page, wlabel, "Held by you"), "held")
            shown = mmss(hold_panel(page).get_by_role("timer", name="Hold time remaining").inner_text())
            server = reservation(w, me_seat(w, wlabel)["id"])["hold"]
            assert server["seconds_remaining"] - SLACK_S <= shown <= server["duration_seconds"], (
                f"countdown {shown}s with a wrong device clock; server reports {server['seconds_remaining']}s left")
    finally:
        for r in ok(w.get("/api/me"))["reservations"]:
            quietly(release, w, r["id"])

    q = signup(short)
    label = open_labels(short, "CD")[0]
    with visit(browser, short, actor=q) as page:
        see(page, bench_button(page, label, "Open"), "open bench")
        click(bench_button(page, label, "Open"))
        see(page, bench_button(page, label, "Held by you"), "held")
        qrid = me_seat(q, label)["id"]
        eventually(lambda: reservation(q, qrid)["state"] == "released", dur + EXPIRY_GRACE_S + SLACK_S, "the expired hold released")
        dialog = page.get_by_role("dialog", name="Hold ended")
        see(page, dialog, "hold-ended dialog after the server released the hold")
        click(dialog.get_by_role("button", name="Back to the map"))
        wait_ui(page, lambda: _true(bench_button(page, label, "Open").count() == 1, "bench not open"), "bench back to Open")
    assert reservation(q, qrid)["state"] == "released"


def test_wf_bench_hold_happy(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p = signup(jan)
    label = open_labels(jan, "CD")[0]
    rid = None
    try:
        with visit(browser, jan, actor=p) as page:
            see(page, bench_button(page, label, "Open"), "open bench")
            click(bench_button(page, label, "Open"))
            see(page, bench_button(page, label, "Held by you"), "held by you")
            panel = hold_panel(page)
            timer = panel.get_by_role("timer", name="Hold time remaining")
            assert re.fullmatch(r"\d\d:\d\d", norm(timer.inner_text())), timer.inner_text()
            t1 = mmss(timer.inner_text())
            advance(page, 3000)
            assert mmss(timer.inner_text()) < t1, "the countdown runs"
            n = status_count(page, bench_status(page), rf"Bench {label} is held for you\. (\d+) of 24 seats remaining\.", "hold copy")
            assert n == board(jan)["seats_remaining"]
            rid = me_seat(p, label)["id"]
            assert reservation(p, rid)["state"] == "held"
            click(panel.get_by_role("button", name="Release bench"))
            see(page, bench_button(page, label, "Open"), "bench back to Open")
            n = status_count(page, bench_status(page), rf"Bench {label} released\. (\d+) of 24 seats remaining\.", "released copy")
            assert n == board(jan)["seats_remaining"]
        assert reservation(p, rid)["state"] == "released" and state_map(board(jan))[label] == "open"
    finally:
        if rid:
            quietly(release, p, rid)


def _focused_label(page: Page) -> str:
    name = page.evaluate("() => { const e = document.activeElement; return (e.getAttribute('aria-label') || e.textContent || '').trim(); }")
    m = re.search(r"Bench ([A-D][1-6])", name)
    assert m, f"focus is not on a bench: {name!r}"
    return m.group(1)


def test_keyboard_bench_map(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p = signup(jan)
    try:
        with visit(browser, jan, actor=p) as page:
            grid = bench_map(page)
            see(page, grid, "bench map")
            states = state_map(board(jan, p))
            first_open = next(l for l in LABELS if l[0] in "CD" and states[l] == "open")
            press_until(page, "Tab", lambda: focus_in(grid), "the bench map")
            assert _focused_label(page) == first_open, "Tab lands on the first Open bench"
            row, num = first_open[0], int(first_open[1])
            page.keyboard.press("ArrowRight")
            assert _focused_label(page) == f"{row}{min(num + 1, 6)}"
            page.keyboard.press("Home")
            assert _focused_label(page) == f"{row}1"
            page.keyboard.press("End")
            assert _focused_label(page) == f"{row}6"
            page.keyboard.press("ArrowRight")
            assert _focused_label(page) == f"{row}6", "Right stops at the row end"
            page.keyboard.press("ArrowUp")
            above = f"{chr(ord(row) - 1)}6"
            assert _focused_label(page) == above
            if states[above] == "open" and not board(jan)["tiers"]["atelier"]["sold_out"] and above[0] in "AB":
                page.keyboard.press("Enter")
                see_text(page, bench_status(page), f"Bench {above} is an Atelier bench. Switch to Atelier to hold it.", "Atelier-only copy")
            page.keyboard.press("ArrowDown")
            assert _focused_label(page) == f"{row}6"
            target = next(l for l in LABELS if l[0] in "CD" and state_map(board(jan, p))[l] == "open")
            bench_button(page, target, "Open").focus()
            page.keyboard.press("Enter")
            see(page, bench_button(page, target, "Held by you"), "Enter holds")
            assert me_seat(p, target)["state"] == "held"
            bench_any(page, "D6").focus()
            page.keyboard.press("Escape")
            see(page, bench_button(page, target, "Open"), "Escape releases from any bench")
            assert me_seat(p, target)["state"] == "released"
            page.set_viewport_size({"width": VIEW_PHONE[0], "height": VIEW_PHONE[1]})
            see(page, bench_any(page, "C6"), "stacked list")
            bench_any(page, "C6").focus()
            page.keyboard.press("ArrowDown")
            assert _focused_label(page) == "D1", "Down crosses rows at 375"
            page.keyboard.press("ArrowUp")
            assert _focused_label(page) == "C6"
            page.keyboard.press("ArrowRight")
            assert _focused_label(page) == "D1"
    finally:
        for r in ok(p.get("/api/me"))["reservations"]:
            quietly(release, p, r["id"])


def test_wf_keyboard_deposit_happy(browser: Browser, killbill: Any, mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p = signup(jan)
    rid = None
    try:
        with visit(browser, jan, actor=p) as page:
            grid = bench_map(page)
            see(page, grid, "bench map")
            press_until(page, "Tab", lambda: focus_in(grid), "the bench map")
            label = _focused_label(page)
            page.keyboard.press("Enter")
            see(page, bench_button(page, label, "Held by you"), "held by keyboard")
            panel = hold_panel(page)
            opener = panel.get_by_role("button", name="Pay deposit")
            press_until(page, "Tab", lambda: is_focused(opener), "Pay deposit")
            page.keyboard.press("Enter")
            dlg = page.get_by_role("dialog", name="Checkout")
            see(page, dlg, "checkout dialog")
            name_box = dlg.get_by_role("textbox", name="Name for the receipt")
            assert is_focused(name_box) and name_box.input_value() == p.name
            for key in ("Tab", "Shift+Tab"):
                for _ in range(TAB_LIMIT // 10):
                    page.keyboard.press(key)
                    assert focus_in(dlg), f"{key} left the checkout dialog"
            page.keyboard.press("Escape")
            wait_ui(page, lambda: _true(dlg.count() == 0 or not dlg.is_visible(), "dialog open"), "checkout closed")
            assert is_focused(opener), "focus returns to the opener"
            page.keyboard.press("Enter")
            see(page, dlg, "checkout reopened")
            pay_button = dlg.get_by_role("button", name=f"Pay deposit ${usd(BENCH_DEPOSIT)}")
            press_until(page, "Tab", lambda: is_focused(pay_button), "the pay button")
            page.keyboard.press("Enter")
            see(page, dlg.get_by_role("heading", name=f"Bench {label} is yours"), "confirmation heading")
            n = status_count(page, bench_status(page), rf"Bench {label} is yours\. (\d+) of 24 seats remaining\.", "payment copy")
            assert n == board(jan)["seats_remaining"]
            done = dlg.get_by_role("button", name="Done")
            press_until(page, "Tab", lambda: is_focused(done), "Done")
            page.keyboard.press("Enter")
            wait_ui(page, lambda: _true(is_focused(panel.get_by_role("heading").first), "focus not on the hold panel heading"), "focus after Done")
        cur = me_seat(p, label)
        rid = cur["id"]
        assert cur["state"] == "deposit_paid" and cur["paid_cents"] == BENCH_DEPOSIT and cur["balance_cents"] == BENCH_BALANCE
        acc = kb_account(killbill, p)
        assert acc.get("currency") == "USD"
        purchases = kb_tx(kb_payment(killbill, f"ob-deposit-{rid}"), "PURCHASE")
        assert len(purchases) == 1 and cents(purchases[0]["amount"]) == BENCH_DEPOSIT
        assert S3("-jan").get(f"receipts/{rid}/deposit.pdf").startswith(b"%PDF-")
        await_mail(mail, p.email, f"Deposit received: Bench {label} is yours")
    finally:
        if rid:
            quietly(cancel, p, rid)


def test_wf_keyboard_deposit_replay(killbill: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p = signup(jan)
    res = hold(p)
    q = signup(jan)
    qres = hold(q)
    try:
        key = idempotency_key()
        first = pay(p, res["id"], "deposit", key=key)
        body = ok(first, 201)
        assert body["reservation"]["state"] == "deposit_paid"
        assert ok(pay(p, res["id"], "deposit", key=key), 201) == body
        expect_error(p.post(f"/api/reservations/{res['id']}/deposit", {"billing_name": p.name + " B"}, key), 409, "idempotency_conflict")
        expect_error(pay(p, res["id"], "full", key=key), 409, "idempotency_conflict")
        expect_error(pay(p, res["id"], "deposit"), 409, "already_paid")
        purchases = kb_tx(kb_payment(killbill, f"ob-deposit-{res['id']}"), "PURCHASE")
        assert len(purchases) == 1 and cents(purchases[0]["amount"]) == BENCH_DEPOSIT
        results = race([lambda: pay(q, qres["id"], "full") for _ in range(3)])
        assert {r.status_code for r in results} <= {201, 409} and any(r.status_code == 201 for r in results), [r.text for r in results]
        assert len(kb_tx(kb_payment(killbill, f"ob-full-{qres['id']}"), "PURCHASE")) == 1
        assert reservation(q, qres["id"])["state"] == "paid_in_full"
        short = env_url("APP_SHORT_URL")
        s = signup(short)
        sres = hold_body(s)["reservations"][0]
        eventually(lambda: reservation(s, sres["id"])["state"] == "released", sres["hold"]["duration_seconds"] + EXPIRY_GRACE_S + SLACK_S, "hold expired")
        expect_error(pay(s, sres["id"], "deposit"), 409, "hold_expired")
        assert killbill.payment_by_key(f"ob-deposit-{sres['id']}") is None
    finally:
        quietly(cancel, p, res["id"])
        quietly(cancel, q, qres["id"])


def test_payment_pending_until_receipt(app_url: str, killbill: Any, mail: Any) -> None:
    kb_down = env_url("APP_KILLBILL_DOWN_URL")
    k = signup(kb_down)
    kres = hold(k)
    try:
        expect_error(pay(k, kres["id"], "full"), 503, "billing_unavailable")
        assert reservation(k, kres["id"])["state"] == "held" and killbill.payment_by_key(f"ob-full-{kres['id']}") is None
    finally:
        quietly(release, k, kres["id"])
    down = env_url("APP_MINIO_DOWN_URL")
    p = signup(down)
    res = hold(p)
    try:
        r = pay(p, res["id"], "full")
        assert r.status_code == 202, r.text
        pending = r.json()["reservation"]
        assert pending["payment_pending"] == "full" and pending["state"] == "held"
        assert pending["hold"]["seconds_remaining"] >= 0
        assert state_map(board(down))[res["bench"]] in ("held", "sold")
        assert len(kb_tx(kb_payment(killbill, f"ob-full-{res['id']}"), "PURCHASE")) == 1
        primary = p.on(app_url)
        eventually(lambda: reservation(primary, res["id"])["state"] == "paid_in_full", RECEIPT_RETRY_S * 3 + SLACK_S,
                   "the receipt retry stores the PDF and moves the seat to paid in full")
        assert S3().get(f"receipts/{res['id']}/full.pdf").startswith(b"%PDF-")
        await_mail(mail, p.email, f"Paid in full: Bench {res['bench']}")
        assert len(mails(mail, p.email, f"Paid in full: Bench {res['bench']}")) == 1
        assert len(kb_tx(kb_payment(killbill, f"ob-full-{res['id']}"), "PURCHASE")) == 1
    finally:
        quietly(cancel, p.on(app_url), res["id"])


def test_wf_keyboard_deposit_timer(browser: Browser) -> None:
    short = env_url("APP_SHORT_URL")
    p = signup(short)
    label = open_labels(short, "CD")[0]
    stash: dict[str, Any] = {}

    def gate(route: Route) -> None:
        stash["response"] = route.fetch()
        stash["route"] = route

    with visit(browser, short, actor=p) as page:
        page.route(re.compile(r"/api/reservations/[^/]+/full$"), gate)
        see(page, bench_button(page, label, "Open"), "open bench")
        click(bench_button(page, label, "Open"))
        see(page, bench_button(page, label, "Held by you"), "held")
        started = time.monotonic()
        dur = reservation(p, me_seat(p, label)["id"])["hold"]["duration_seconds"]
        click(hold_panel(page).get_by_role("button", name="Pay in full"))
        dlg = page.get_by_role("dialog", name="Checkout")
        click(dlg.get_by_role("button", name=f"Pay in full ${usd(BENCH_FULL)}"))
        wait_ui(page, lambda: _true("response" in stash, "payment not sent"), "payment request reaches the server")
        assert stash["response"].status == 201, stash["response"].text()
        advance(page, (dur + 1) * 1000)
        assert page.get_by_role("dialog", name="Hold ended").count() == 0
        stash["route"].fulfill(response=stash["response"])
        heading = page.get_by_role("heading", name=f"Bench {label} is yours").first
        see(page, heading, "confirmation heading")
        deadline = started + dur + EXPIRY_GRACE_S + 1
        while time.monotonic() < deadline:
            advance(page, STEP_MS)
        advance(page, MAP_REFRESH_MS * 2)
        assert heading.is_visible(), "confirmation still on screen after the hold time"
        assert page.get_by_role("dialog", name="Hold ended").count() == 0
        assert f"Bench {label} is yours." in norm(bench_status(page).inner_text())
    assert me_seat(p, label)["state"] == "paid_in_full"
    quietly(cancel, p, me_seat(p, label)["id"])


def test_wf_last_bench_race_api() -> None:
    jan = env_url("APP_JAN_EVE_URL")
    label = open_labels(jan, "CD")[0]
    racers = [signup(jan) for _ in range(5)]
    groups: list[tuple[Actor, str, list[str]]] = []
    winners: list[tuple[Actor, str]] = []
    try:
        results = race([lambda a=a: a.post("/api/holds", {"benches": [label]}) for a in racers])
        assert sorted(r.status_code for r in results) == [201, 409, 409, 409, 409], [r.text for r in results]
        for actor, r in zip(racers, results):
            if r.status_code == 201:
                winners.append((actor, r.json()["reservations"][0]["id"]))
            else:
                body = expect_error(r, 409, "bench_taken")
                assert body["waitlist"]["tier"] == "bench" and isinstance(body["waitlist"]["open"], bool)
        groups = fill_atelier(jan, ATELIER_CAP - 1)
        free = open_labels(jan, "AB")
        assert len(free) >= 2
        x, y = signup(jan), signup(jan)
        results = race([lambda: x.post("/api/holds", {"benches": [free[0]]}), lambda: y.post("/api/holds", {"benches": [free[1]]})])
        assert sorted(r.status_code for r in results) == [201, 409], [r.text for r in results]
        loser = expect_error(next(r for r in results if r.status_code == 409), 409, "atelier_sold_out")
        assert loser["waitlist"] == {"tier": "atelier", "open": True}
        winner_actor = x if results[0].status_code == 201 else y
        winner_rid = next(r for r in results if r.status_code == 201).json()["reservations"][0]["id"]
        after = board(jan)
        assert after["tiers"]["atelier"]["sold_out"] is True and after["tiers"]["atelier"]["active"] == ATELIER_CAP
        check_ledger(after)
        release(winner_actor, winner_rid)
        target = open_labels(jan, "AB")[0]
        u, v = signup(jan), signup(jan)
        results = race([lambda: u.post("/api/holds", {"benches": [target]}), lambda: v.post("/api/holds", {"benches": [target]})])
        assert sorted(r.status_code for r in results) == [201, 409]
        expect_error(next(r for r in results if r.status_code == 409), 409, "bench_taken")
        winners.append((u if results[0].status_code == 201 else v, next(r for r in results if r.status_code == 201).json()["reservations"][0]["id"]))
    finally:
        for actor, rid in winners:
            quietly(release, actor, rid)
        release_groups(groups)


def test_atelier_cap_and_rows() -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p, q = signup(jan), signup(jan)
    a_res = hold(p, "AB")
    c_res = hold(q, "CD")
    assert a_res["tier"] == "atelier" and c_res["tier"] == "bench"
    release(p, a_res["id"])
    release(q, c_res["id"])
    s, sres = seat(jan, "full")
    groups: list[tuple[Actor, str, list[str]]] = []
    try:
        cd = open_labels(jan, "CD")[0]
        assert "bench" in expect_error(upgrade(s, sres["id"], cd), 422, "validation")["errors"]
        groups = fill_atelier(jan, ATELIER_CAP)
        b = board(jan)
        assert b["tiers"]["atelier"]["sold_out"] is True and b["tiers"]["atelier"]["remaining"] == 0
        free = open_labels(jan, "AB")
        assert free, "open A or B benches remain while sold out"
        body = expect_error(signup(jan).post("/api/holds", {"benches": [free[0]]}), 409, "atelier_sold_out")
        assert body["waitlist"] == {"tier": "atelier", "open": True}
        expect_error(upgrade(s, sres["id"], free[0]), 409, "atelier_sold_out")
        expect_error(signup(jan, "clinic").post("/api/holds", {"benches": free[:1]}), 409, "atelier_sold_out")
        assert board(jan)["tiers"]["atelier"]["active"] == ATELIER_CAP
        assert reservation(s, sres["id"])["bench"] == sres["bench"]
    finally:
        release_groups(groups)
        quietly(cancel, s, sres["id"])


def test_wf_last_bench_race_ui(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    a, b, c, e = signup(jan), signup(jan), signup(jan), signup(jan)
    director = staff(jan, "director")
    mine, contested = open_labels(jan, "CD")[:2]
    rival = None
    partial = None
    try:
        with visit(browser, jan, actor=a) as page:
            _wait_ready(page)
            see(page, bench_button(page, mine, "Open"), "open bench")
            before_selected = scene_attr(page, "data-selected-bench")
            panel = hold_panel(page)
            with held(page, "**/api/holds") as gate:
                click(bench_button(page, mine, "Open"))
                advance(page, LIFT_SETTLE_MS)
                assert scene_attr(page, "data-lift") == "0.00" and scene_attr(page, "data-ring") == "none"
                assert scene_attr(page, "data-selected-bench") == before_selected
                if panel.get_by_role("heading").count():
                    assert letters(panel.get_by_role("heading").first)[0] == 0
                with page.expect_response(lambda r: "/api/holds" in r.url) as info:
                    gate.release()
            res = info.value.json()["reservations"][0]
            s, d = res["hold"]["seconds_remaining"], res["hold"]["duration_seconds"]
            advance(page, LIFT_SETTLE_MS)
            wait_ui(page, lambda: _true(scene_attr(page, "data-lift") == "1.00", scene_attr(page, "data-lift")), "lift settles at 1.00")
            assert scene_attr(page, "data-selected-bench") == mine and scene_attr(page, "data-ring") == "depleting"
            ring = float(scene_attr(page, "data-ring-remaining"))
            assert abs(ring - (s - LIFT_SETTLE_MS / 1000) / d) <= RING_TOLERANCE + STEP_MS / 1000 / d, (ring, s, d)
            heading = panel.get_by_role("heading", name=re.compile(rf"\b{mine}\b"))
            count, hidden = letters(heading.first)
            assert count == len(mine) and hidden, "each label character is its own hidden data-letter element"
            mark = float(scene_attr(page, "data-ring-remaining"))
            timer_before = mmss(panel.get_by_role("timer", name="Hold time remaining").inner_text())
            advance(page, 10_000)
            assert abs(float(scene_attr(page, "data-ring-remaining")) - (mark - 10 / d)) <= RING_TOLERANCE
            assert abs(timer_before - mmss(panel.get_by_role("timer", name="Hold time remaining").inner_text()) - 10) <= 1
        with visit(browser, jan, actor=b) as page:
            _wait_ready(page)
            see(page, bench_button(page, contested, "Open"), "contested bench open")
            with held(page, "**/api/holds") as gate:
                click(bench_button(page, contested, "Open"))
                rival = hold(c, label=contested)
                gate.release()
            see(page, bench_button(page, contested, "Held"), "refused bench shows Held")
            assert bench_button(page, contested, "Held by you").count() == 0
            assert scene_attr(page, "data-lift") == "0.00" and scene_attr(page, "data-selected-bench") != contested
            n = status_count(page, bench_status(page), rf"Bench {contested} was just taken\. (\d+) of 24 seats remaining\.", "taken copy")
            ledger, inv = board(jan), ok(director.get("/api/desk/inventory"))
            assert n == ledger["seats_remaining"] == inv["seats_remaining"]
            bar = page.get_by_text(re.compile(r"^\d+ of 24 seats remaining$")).first
            wait_ui(page, lambda: _true(norm(bar.inner_text()) == f"{n} of 24 seats remaining", bar.inner_text()), "reserve bar agrees")
        partial = hold(e)
        pd = partial["hold"]["duration_seconds"]
        eventually(lambda: reservation(e, partial["id"])["hold"]["seconds_remaining"] <= pd - ELAPSED_S,
                   ELAPSED_S + SLACK_S, "the hold has run on server time before the page opens")
        before = reservation(e, partial["id"])["hold"]["seconds_remaining"]
        with visit(browser, jan, actor=e) as page:
            _wait_ready(page)
            wait_ui(page, lambda: _true(scene_attr(page, "data-ring") == "depleting", scene_attr(page, "data-ring")),
                    "the ring depletes around the live hold")
            ring = float(scene_attr(page, "data-ring-remaining"))
            shown = mmss(hold_panel(page).get_by_role("timer", name="Hold time remaining").inner_text())
        after = reservation(e, partial["id"])["hold"]["seconds_remaining"]
        assert (after - SLACK_S) / pd - RING_TOLERANCE <= ring <= (before + 1) / pd + RING_TOLERANCE, (
            f"data-ring-remaining {ring}; server seconds_remaining {before}..{after} of {pd}")
        assert after - SLACK_S <= shown <= before + 1, f"timer {shown}s; server seconds_remaining {before}..{after}"
        assert abs(ring - shown / pd) <= RING_TOLERANCE + 1 / pd, "ring and timer show the same time"
    finally:
        quietly(release, a, me_seat(a, mine)["id"])
        if rival:
            quietly(release, c, rival["id"])
        if partial:
            quietly(release, e, partial["id"])


def test_bench_updates_copy(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    a, rival = signup(jan), signup(jan)
    first, second = open_labels(jan, "CD")[:2]
    rival_res = None
    try:
        with visit(browser, jan, actor=a) as page:
            status, panel = bench_status(page), hold_panel(page)
            see(page, bench_button(page, first, "Open"), "open bench")
            with held(page, "**/api/holds") as gate:
                click(bench_button(page, first, "Open"))
                see_text(page, panel, f"Holding Bench {first}", "pending text")
                assert panel.get_by_role("timer").count() == 0
                assert panel.get_by_role("button", name="Pay in full").count() == 0
                assert bench_button(page, first, "Open").count() == 1, "the bench keeps its previous state text"
                rival_res = hold(rival, label=first)
                gate.release()
            n = status_count(page, status, rf"Bench {first} was just taken\. (\d+) of 24 seats remaining\.", "taken copy")
            assert n == board(jan)["seats_remaining"]
            click(bench_button(page, second, "Open"))
            n = status_count(page, status, rf"Bench {second} is held for you\. (\d+) of 24 seats remaining\.", "held copy")
            assert n == board(jan)["seats_remaining"]
            click(panel.get_by_role("button", name="Release bench"))
            n = status_count(page, status, rf"Bench {second} released\. (\d+) of 24 seats remaining\.", "released copy")
            assert n == board(jan)["seats_remaining"]
            if not board(jan)["tiers"]["atelier"]["sold_out"]:
                ab = open_labels(jan, "AB")[0]
                bench_button(page, ab, "Atelier only").focus()
                page.keyboard.press("Enter")
                see_text(page, status, f"Bench {ab} is an Atelier bench. Switch to Atelier to hold it.", "Atelier-only copy")
    finally:
        if rival_res:
            quietly(release, rival, rival_res["id"])
        for r in ok(a.get("/api/me"))["reservations"]:
            quietly(release, a, r["id"])


def test_atelier_sold_out_copy(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p = signup(jan)
    groups = fill_atelier(jan, ATELIER_CAP)
    try:
        free = open_labels(jan, "AB")
        assert free
        with visit(browser, jan, actor=p) as page:
            tier = page.get_by_role("radiogroup", name="Tier")
            see(page, tier, "tier switch")
            atelier = tier.get_by_role("radio", name=re.compile(r"^Atelier"))
            sold_marker = tier.get_by_text("Sold out")
            wait_ui(page, lambda: _true(
                tier.get_by_role("radio", name=re.compile(r"^Atelier.*Sold out")).count() > 0
                or (sold_marker.count() > 0 and sold_marker.first.is_visible()),
                "the Atelier radio shows Sold out"), "Atelier radio sold-out text")
            check(atelier)
            see(page, page.get_by_role("heading", name="Atelier is sold out"), "sold-out heading")
            see(page, page.get_by_text("All 10 Atelier places are taken. Join the Atelier waitlist and we will offer you the next Atelier bench that opens."), "sold-out banner")
            see(page, bench_button(page, free[0], "Sold out"), "open A/B bench reads Sold out")
            see(page, page.get_by_role("button", name="Join the Atelier waitlist"), "Atelier waitlist button")
            release_groups(groups)
            groups = []
            wait_ui(page, lambda: _true(bench_button(page, free[0], "Open").count() == 1, "still sold out"), "Atelier reopens within the refresh")
            assert page.get_by_role("heading", name="Atelier is sold out").count() == 0
    finally:
        release_groups(groups)


def test_waitlist_join_rules(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    a, b, c, d = (signup(jan) for _ in range(4))
    expect_error(a.post("/api/waitlist", {"tier": "bench"}), 409, "benches_available") if open_labels(jan, "CD") else None
    groups = fill_rows(jan, "CD")
    try:
        assert "tier" in expect_error(a.post("/api/waitlist", {"tier": "gold"}), 422, "validation")["errors"]
        pa = ok(a.post("/api/waitlist", {"tier": "bench"}), 201)
        assert pa["tier"] == "bench"
        pb = ok(b.post("/api/waitlist", {"tier": "bench"}), 201)
        assert pb["position"] == pa["position"] + 1
        expect_error(a.post("/api/waitlist", {"tier": "bench"}), 409, "already_reserved")
        if not board(jan)["tiers"]["atelier"]["sold_out"] and open_labels(jan, "AB"):
            expect_error(d.post("/api/waitlist", {"tier": "atelier"}), 409, "benches_available")
            expect_error(a.post("/api/holds", {"benches": open_labels(jan, "AB")[:1]}), 409, "already_reserved")
        with visit(browser, jan, actor=c) as page:
            tier_name = "Bench"
            join = page.get_by_role("button", name=f"Join the {tier_name} waitlist")
            see(page, join, "Bench waitlist button")
            click(join)
            n = status_count(page, bench_status(page), r"You are number (\d+) on the Bench waitlist\.", "waitlist copy")
        assert n == ok(c.get("/api/me"))["waitlist"]["position"] == pb["position"] + 1
        assert a.delete("/api/waitlist").status_code == 204
        assert ok(b.get("/api/me"))["waitlist"]["position"] == pa["position"], "positions recompute on read"
        assert ok(a.get("/api/me"))["waitlist"] is None
    finally:
        for actor in (a, b, c):
            quietly(actor.delete, "/api/waitlist")
        release_groups(groups)


def test_wf_waitlist_offer_lapse(mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    groups = fill_rows(jan, "CD", first_size=1)
    a, b = signup(jan), signup(jan)
    try:
        ok(a.post("/api/waitlist", {"tier": "bench"}), 201)
        ok(b.post("/api/waitlist", {"tier": "bench"}), 201)
        clinic, gid, (freed,) = groups[0]
        ok(clinic.post(f"/api/groups/{gid}/release"))
        eventually(lambda: ok(a.get("/api/me"))["offers"], SLACK_S, "an offer for the first waitlisted buyer")
        offer = ok(a.get("/api/me"))["offers"][0]
        assert offer["bench"] == freed and 0 < offer["seconds_remaining"] <= OFFER_DEFAULT_S
        await_mail(mail, a.email, "A bench is open for you: sign in to accept")
        assert state_map(board(jan))[freed] == "held" and state_map(board(jan, a))[freed] == "offered_to_you"
        assert state_map(board(jan, b))[freed] == "held"
        check_ledger(board(jan))
        assert ok(a.post(f"/api/offers/{offer['id']}/decline"))["offer"]
        expect_error(a.post(f"/api/offers/{offer['id']}/accept"), 409, "offer_lapsed")
        eventually(lambda: ok(b.get("/api/me"))["offers"], EXPIRY_GRACE_S + SLACK_S, "the declined bench passes to the next buyer")
        boffer = ok(b.get("/api/me"))["offers"][0]
        assert boffer["bench"] == freed
        await_mail(mail, b.email, "A bench is open for you: sign in to accept")
        ok(b.post(f"/api/offers/{boffer['id']}/decline"))
        eventually(lambda: state_map(board(jan))[freed] == "open", EXPIRY_GRACE_S + SLACK_S, "the bench opens with nobody waiting")
    finally:
        for actor in (a, b):
            quietly(actor.delete, "/api/waitlist")
        release_groups(groups)
    short = env_url("APP_SHORT_URL")
    sgroups = fill_rows(short, "CD", first_size=1)
    c = signup(short)
    try:
        ok(c.post("/api/waitlist", {"tier": "bench"}), 201)
        sclinic, sgid, (sfreed,) = sgroups[0]
        ok(sclinic.post(f"/api/groups/{sgid}/release"))
        eventually(lambda: ok(c.get("/api/me"))["offers"], SLACK_S, "an offer on the short timer")
        soffer = ok(c.get("/api/me"))["offers"][0]
        assert soffer["seconds_remaining"] > 0
        eventually(lambda: state_map(board(short))[sfreed] == "open", soffer["seconds_remaining"] + EXPIRY_GRACE_S + SLACK_S,
                   "the lapsed offer opens the bench")
        expect_error(c.post(f"/api/offers/{soffer['id']}/accept"), 409, "offer_lapsed")
    finally:
        quietly(c.delete, "/api/waitlist")
        release_groups(sgroups)


def test_wf_waitlist_offer_hold_ended(browser: Browser) -> None:
    short = env_url("APP_SHORT_URL")
    p = signup(short)
    label = open_labels(short, "CD")[0]
    with visit(browser, short, actor=p) as page:
        see(page, bench_button(page, label, "Open"), "open bench")
        click(bench_button(page, label, "Open"))
        see(page, bench_button(page, label, "Held by you"), "held")
        rid = me_seat(p, label)["id"]
        dur = reservation(p, rid)["hold"]["duration_seconds"]
        dialog = page.get_by_role("dialog", name="Hold ended")
        advance(page, (dur + 1) * 1000)
        shown_early = dialog.count() > 0 and dialog.is_visible()
        if reservation(p, rid)["state"] == "held":
            assert not shown_early, "dialog opened before the server reported the hold released"
        see(page, dialog, "hold-ended dialog", seconds=dur + EXPIRY_GRACE_S + SLACK_S)
        assert reservation(p, rid)["state"] == "released"
        see(page, dialog.get_by_role("heading", name="Your hold has ended"), "dialog heading")
        see_text(page, dialog, f"Bench {label} is back on the map. Pick another bench or join the waitlist.", "dialog body")
        back = dialog.get_by_role("button", name="Back to the map")
        assert is_focused(back)
        for _ in range(4):
            page.keyboard.press("Tab")
            assert focus_in(dialog)
        n = status_count(page, bench_status(page), rf"Your hold on Bench {label} has ended\. (\d+) of 24 seats remaining\.", "ended copy")
        assert n == board(short)["seats_remaining"]
        page.keyboard.press("Escape")
        wait_ui(page, lambda: _true(dialog.count() == 0 or not dialog.is_visible(), "dialog open"), "dialog closed")
        assert focus_in(bench_map(page)), "focus returns to the bench map"
        assert scene_attr(page, "data-lift") in ("", "0.00") and scene_attr(page, "data-ring") in ("", "none")


def test_wf_waitlist_offer_accept(browser: Browser, mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    groups = fill_rows(jan, "CD")
    a = signup(jan)
    try:
        ok(a.post("/api/waitlist", {"tier": "bench"}), 201)
        release_groups(groups)
        groups = []
        eventually(lambda: ok(a.get("/api/me"))["offers"], SLACK_S, "an offer for the waitlisted practitioner")
        offer = ok(a.get("/api/me"))["offers"][0]
        msg = await_mail(mail, a.email, "A bench is open for you: sign in to accept")[0]
        assert "/account" in mail_text(msg) and not msg.get("Attachments")
        with visit(browser, jan, "/account", actor=a) as page:
            page.clock.set_system_time(WRONG_CLOCK)
            page.reload()
            region = page.get_by_role("region", name="Waitlist offer")
            see(page, region.get_by_role("heading", name=f"Bench {offer['bench']} is waiting for you"), "offer heading")
            m = re.search(r"(\d\d):(\d\d):(\d\d) left to accept", norm(region.inner_text()))
            assert m, region.inner_text()
            left = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
            assert offer["seconds_remaining"] - SLACK_S <= left <= offer["seconds_remaining"], (left, offer)
            click(region.get_by_role("button", name="Accept bench"))
            n = status_count(page, page.get_by_role("status", name="Account updates"),
                             rf"Bench {offer['bench']} is held for you\. (\d+) of 24 seats remaining\.", "accepted copy")
            assert n == board(jan)["seats_remaining"]
        held_res = me_seat(a, offer["bench"])
        assert held_res["state"] == "held"
        assert held_res["hold"]["duration_seconds"] - SLACK_S <= held_res["hold"]["seconds_remaining"] <= held_res["hold"]["duration_seconds"]
        assert state_map(board(jan, a))[offer["bench"]] == "held_by_you"
    finally:
        quietly(a.delete, "/api/waitlist")
        release_groups(groups)
        for r in ok(a.get("/api/me"))["reservations"]:
            quietly(release, a, r["id"])


def test_wf_balance_upgrade_balance(browser: Browser, killbill: Any, mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p, res = seat(jan, "deposit")
    rid, label = res["id"], res["bench"]
    try:
        q = signup(jan)
        qres = hold(q)
        expect_error(pay(q, qres["id"], "balance"), 409, "not_deposit_paid")
        release(q, qres["id"])
        with visit(browser, jan, "/account", actor=p) as page:
            region = page.get_by_role("region", name=f"Bench {label}")
            button = region.get_by_role("button", name=f"Pay balance ${usd(BENCH_BALANCE)}")
            see(page, button, "Pay balance button")
            press_and_confirm(page, button, re.compile(r"^Pay balance"))
            see_text(page, page.get_by_role("status", name="Account updates"), f"Bench {label} is paid in full.", "balance copy")
        cur = reservation(p, rid)
        assert cur["state"] == "paid_in_full" and cur["balance_cents"] == 0 and cur["paid_cents"] == BENCH_FULL
        purchases = kb_tx(kb_payment(killbill, f"ob-balance-{rid}"), "PURCHASE")
        assert len(purchases) == 1 and cents(purchases[0]["amount"]) == BENCH_BALANCE
        assert S3("-jan").get(f"receipts/{rid}/balance.pdf").startswith(b"%PDF-")
        await_mail(mail, p.email, f"Paid in full: Bench {label}")
    finally:
        quietly(cancel, p, rid)


@pytest.mark.timeout(900)
def test_wf_balance_upgrade_reminders(mail: Any) -> None:
    names = ("APP_HALF_EVE_URL", "APP_HALF_WINDOW_URL", "APP_SEVEN_EVE_URL", "APP_SEVEN_DAY_URL")
    seats = {name: seat(env_url(name), "deposit") for name in names}
    full_actor, full_res = seat(env_url("APP_HALF_WINDOW_URL"), "full")
    started = time.monotonic()

    def s21(r: dict[str, Any]) -> str:
        return f"Balance reminder: 21 days to pay for Bench {r['bench']}"

    def s7(r: dict[str, Any]) -> str:
        return f"Balance reminder: 7 days to pay for Bench {r['bench']}"

    try:
        for name, subject in (("APP_HALF_WINDOW_URL", s21), ("APP_SEVEN_EVE_URL", s21), ("APP_SEVEN_DAY_URL", s7)):
            actor, res = seats[name]
            await_mail(mail, actor.email, subject(res), seconds=REMINDER_CHECK_S + SLACK_S)
        deadline = started + REMINDER_CHECK_S + SLACK_S
        while time.monotonic() < deadline:
            mail.messages()
        expected = {"APP_HALF_EVE_URL": (0, 0), "APP_HALF_WINDOW_URL": (1, 0), "APP_SEVEN_EVE_URL": (1, 0), "APP_SEVEN_DAY_URL": (0, 1)}
        for name, (n21, n7) in expected.items():
            actor, res = seats[name]
            got = (len(mails(mail, actor.email, s21(res))), len(mails(mail, actor.email, s7(res))))
            assert got == (n21, n7), f"{name}: reminders (21-day, 7-day) = {got}; expected {(n21, n7)}"
        assert not [m for m in mails(mail, full_actor.email) if (m.get("Subject") or "").startswith("Balance reminder")]
    finally:
        for actor, res in list(seats.values()) + [(full_actor, full_res)]:
            quietly(cancel, actor, res["id"])


def test_deposits_deadline(browser: Browser, killbill: Any) -> None:
    eve, past = env_url("APP_DEADLINE_EVE_URL"), env_url("APP_DEADLINE_PAST_URL")
    b_eve, b_past = board(eve), board(past)
    assert (b_eve["venue_date"], b_eve["deposits_open"]) == (LAST_DEPOSIT_DAY, True)
    assert (b_past["venue_date"], b_past["deposits_open"]) == (DEPOSITS_CLOSED_DAY, False)
    probe = signup(past)
    me = ok(probe.get("/api/me"))
    assert (me["venue_date"], me["deposits_open"]) == (DEPOSITS_CLOSED_DAY, False)
    paid: list[tuple[Actor, str]] = []
    holds: list[tuple[Actor, str]] = []
    try:
        x, xres = seat(eve, "deposit")
        paid.append((x, xres["id"]))
        assert xres["state"] == "deposit_paid"
        q = signup(past)
        res = hold(q)
        holds.append((q, res["id"]))
        expect_error(pay(q, res["id"], "deposit"), 409, "deposits_closed")
        assert reservation(q, res["id"])["state"] == "held" and killbill.payment_by_key(f"ob-deposit-{res['id']}") is None
        assert ok(pay(q, res["id"], "full"), 201)["reservation"]["state"] == "paid_in_full"
        paid.append((q, res["id"]))
        for base, clock, deposits in ((past, EARLY_CLOCK, False), (eve, LATE_CLOCK, True)):
            r = signup(base)
            label = open_labels(base, "CD")[0]
            with visit(browser, base, actor=r) as page:
                page.clock.set_system_time(clock)
                page.reload()
                see(page, bench_button(page, label, "Open"), "open bench")
                click(bench_button(page, label, "Open"))
                panel = hold_panel(page)
                see(page, panel.get_by_role("button", name="Pay in full"), "Pay in full")
                holds.append((r, me_seat(r, label)["id"]))
                if deposits:
                    see(page, panel.get_by_role("button", name="Pay deposit"), "Pay deposit while open")
                else:
                    see_text(page, panel, "Deposits closed on 19 March 2027. Pay in full to reserve a bench.", "deposits-closed line")
                    assert panel.get_by_role("button", name="Pay deposit").count() == 0
    finally:
        for actor, rid in paid:
            quietly(cancel, actor.on(eve), rid)
        for actor, rid in holds:
            quietly(release, actor, rid)


def test_wf_balance_upgrade_split(killbill: Any, mail: Any, app_url: str) -> None:
    jan, half = env_url("APP_JAN_EVE_URL"), env_url("APP_HALF_WINDOW_URL")
    eve, past = env_url("APP_DEADLINE_EVE_URL"), env_url("APP_DEADLINE_PAST_URL")
    cleanup: list[tuple[Actor, str, str]] = []
    try:
        p, res = seat(jan, "full")
        cleanup.append((p, res["id"], jan))
        h = signup(jan)
        hres = hold(h)
        expect_error(upgrade(h, hres["id"], open_labels(jan, "AB")[0]), 409, "not_paid")
        release(h, hres["id"])
        target = open_labels(jan, "AB")[0]
        cur = ok(upgrade(p, res["id"], target), 201)["reservation"]
        assert (cur["bench"], cur["tier"], cur["paid_cents"], cur["balance_cents"]) == (target, "atelier", ATELIER_FULL, 0)
        assert state_map(board(jan))[res["bench"]] in ("open", "held"), "the old bench frees at once"
        purchases = kb_tx(kb_payment(killbill, f"ob-upgrade-{res['id']}"), "PURCHASE")
        assert len(purchases) == 1 and cents(purchases[0]["amount"]) == UPGRADE_DIFF
        invoice_with(kb_invoices(killbill, p), f"Bench {target} Atelier upgrade")
        await_mail(mail, p.email, f"Upgrade confirmed: Bench {target} is Atelier")
        expect_error(upgrade(p, res["id"], open_labels(jan, "AB")[0]), 409, "already_atelier")
        d, dres = seat(half, "deposit")
        cleanup.append((d, dres["id"], half))
        cur = ok(upgrade(d, dres["id"], open_labels(half, "AB")[0]), 201)["reservation"]
        assert (cur["paid_cents"], cur["balance_cents"]) == (ATELIER_DEPOSIT, ATELIER_BALANCE)
        assert cents(kb_tx(kb_payment(killbill, f"ob-upgrade-{dres['id']}"), "PURCHASE")[0]["amount"]) == UPGRADE_NOW_EARLY
        e, eres = seat(eve, "deposit")
        cleanup.append((e, eres["id"], eve))
        cur = ok(upgrade(e.on(past), eres["id"], open_labels(past, "AB")[0]), 201)["reservation"]
        assert (cur["paid_cents"], cur["balance_cents"]) == (BENCH_DEPOSIT + UPGRADE_DIFF, BENCH_BALANCE)
        assert cents(kb_tx(kb_payment(killbill, f"ob-upgrade-{eres['id']}"), "PURCHASE")[0]["amount"]) == UPGRADE_DIFF
        k, kres = seat(app_url, "full")
        cleanup.append((k, kres["id"], app_url))
        key = idempotency_key()
        down = k.on(env_url("APP_KILLBILL_DOWN_URL"))
        expect_error(upgrade(down, kres["id"], open_labels(app_url, "AB")[0], key=key), 503, "billing_unavailable")
        assert reservation(k, kres["id"])["bench"] == kres["bench"] and killbill.payment_by_key(f"ob-upgrade-{kres['id']}") is None
        assert ok(upgrade(k, kres["id"], open_labels(app_url, "AB")[0], key=key), 201)["reservation"]["tier"] == "atelier"
    finally:
        for actor, rid, base in cleanup:
            quietly(cancel, actor.on(base), rid)


def test_cancellation_frees_bench() -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p, res = seat(jan, "full")
    groups = fill_rows(jan, "CD")
    w = signup(jan)
    try:
        h = signup(jan)
        expect_error(signup(jan).post(f"/api/reservations/{res['id']}/cancel"), 404, "not_found")
        expect_error(staff(jan, "registrar").post(f"/api/reservations/{res['id']}/cancel"), 403, "forbidden")
        ok(w.post("/api/waitlist", {"tier": "bench"}), 201)
        body = cancel(p, res["id"])["reservation"]
        assert body["state"] == "cancelled" and body["refund_due_cents"] == BENCH_FULL - EARLY_FEE
        eventually(lambda: [o for o in ok(w.get("/api/me"))["offers"] if o["bench"] == res["bench"]], SLACK_S,
                   "the cancelled bench is offered to the waitlist")
        expect_error(p.post(f"/api/reservations/{res['id']}/cancel"), 409, "invalid_transition")
        release_groups(groups)
        groups = []
        hres = hold(h)
        expect_error(h.post(f"/api/reservations/{hres['id']}/cancel"), 409, "invalid_transition")
        release(h, hres["id"])
    finally:
        quietly(w.delete, "/api/waitlist")
        for o in ok(w.get("/api/me"))["offers"]:
            quietly(w.post, f"/api/offers/{o['id']}/decline")
        release_groups(groups)
        quietly(cancel, p, res["id"])


REFUND_CASES = {
    "jan-eve": ("APP_JAN_EVE_URL", "APP_JAN_EVE_URL", "fee"),
    "jan-past": ("APP_JAN_PAST_URL", "APP_JAN_PAST_URL", "half"),
    "deadline-eve": ("APP_DEADLINE_EVE_URL", "APP_DEADLINE_EVE_URL", "half"),
    "deadline-past": ("APP_DEADLINE_EVE_URL", "APP_DEADLINE_PAST_URL", "none"),
}


@pytest.mark.parametrize("case", list(REFUND_CASES), ids=list(REFUND_CASES))
def test_refund_schedule(case: str) -> None:
    pay_name, cancel_name, rule = REFUND_CASES[case]
    pay_url, cancel_url = env_url(pay_name), env_url(cancel_name)
    seats = [seat(pay_url, "deposit"), seat(pay_url, "full")]
    try:
        for actor, res in seats:
            paid = res["paid_cents"]
            canceller = actor.on(cancel_url)
            if rule == "none":
                expect_error(canceller.post(f"/api/reservations/{res['id']}/cancel"), 409, "no_refund_window")
                assert reservation(canceller, res["id"])["state"] == res["state"]
                continue
            due = cancel(canceller, res["id"])["reservation"]["refund_due_cents"]
            assert due == (paid - EARLY_FEE if rule == "fee" else paid // 2), (case, paid, due)
            assert isinstance(due, int)
    finally:
        for actor, res in seats:
            quietly(cancel, actor.on(pay_url), res["id"])


def test_wf_cancel_refund_rules(killbill: Any, mail: Any) -> None:
    past = env_url("APP_JAN_PAST_URL")
    p, res = seat(past, "full")
    other, ores = seat(past, "full")
    rid = res["id"]
    reg = staff(past, "registrar")
    try:
        expect_error(reg.post(f"/api/desk/reservations/{ores['id']}/refund", key=idempotency_key()), 409, "not_cancelled")
        due = cancel(p, rid)["reservation"]["refund_due_cents"]
        assert due == BENCH_FULL // 2
        expect_error(p.post(f"/api/desk/reservations/{rid}/refund", key=idempotency_key()), 403, "forbidden")
        expect_error(staff(past, "director").post(f"/api/desk/reservations/{rid}/refund", key=idempotency_key()), 403, "forbidden")
        assert "idempotency_key" in expect_error(reg.post(f"/api/desk/reservations/{rid}/refund"), 422, "validation")["errors"]
        assert killbill.payment_by_key(f"ob-full-{rid}") and not kb_tx(kb_payment(killbill, f"ob-full-{rid}"), "REFUND")
        key = idempotency_key()
        body = ok(reg.post(f"/api/desk/reservations/{rid}/refund", key=key))
        assert body["reservation"]["state"] == "refunded"
        assert body["refund"] == {"amount_cents": due, "transaction_external_keys": [f"ob-refund-{rid}-1"]}
        assert ok(reg.post(f"/api/desk/reservations/{rid}/refund", key=key)) == body
        expect_error(reg.post(f"/api/desk/reservations/{rid}/refund", key=idempotency_key()), 409, "already_refunded")
        refunds = kb_tx(kb_payment(killbill, f"ob-full-{rid}"), "REFUND")
        assert [(t["transactionExternalKey"], cents(t["amount"])) for t in refunds] == [(f"ob-refund-{rid}-1", due)]
        assert reservation(p, rid)["paid_cents"] == BENCH_FULL - due
        await_mail(mail, p.email, f"Refund confirmed: Bench {res['bench']}")
    finally:
        quietly(cancel, other, ores["id"])


def test_wf_cancel_refund_registrar(browser: Browser, killbill: Any, mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p, res = seat(jan, "deposit")
    rid, original = res["id"], res["bench"]
    target = open_labels(jan, "AB")[0]
    up = ok(upgrade(p, rid, target), 201)["reservation"]
    assert (up["paid_cents"], up["balance_cents"]) == (ATELIER_DEPOSIT, ATELIER_BALANCE)
    assert ok(pay(p, rid, "balance"), 201)["reservation"]["state"] == "paid_in_full"
    reg = staff(jan, "registrar")
    with visit(browser, jan, "/account", actor=p) as page:
        region = page.get_by_role("region", name=f"Bench {target}")
        see(page, region.get_by_role("button", name="Cancel seat"), "Cancel seat")
        press_and_confirm(page, region.get_by_role("button", name="Cancel seat"), re.compile(r"cancel seat|confirm", re.I))
        see_text(page, page.get_by_role("status", name="Account updates"),
                 f"Bench {target} is cancelled. Refund due: ${usd(WORKED_REFUND)}. The registrar will send it.", "cancel copy")
    assert reservation(p, rid)["refund_due_cents"] == WORKED_REFUND
    row_api = next(r for r in ok(reg.get("/api/desk/reservations", q=p.name))["reservations"] if r["id"] == rid)
    assert row_api["kb"]["refunded_cents"] == 0 and row_api["buyer_email"].lower() == p.email.lower()
    with visit(browser, jan, "/desk", actor=reg) as page:
        fill(page.get_by_role("searchbox", name="Find a reservation"), p.name)
        row = page.get_by_role("table", name="Reservations").get_by_role("row").filter(has_text=p.name)
        wait_ui(page, lambda: expect(row).to_have_count(1, timeout=QUICK_MS), "desk row")
        click(row.get_by_role("button", name=f"Issue refund ${usd(WORKED_REFUND)}"))
        see_text(page, page.get_by_role("status", name="Desk updates"), f"Refunded ${usd(WORKED_REFUND)} for Bench {target}.", "refund copy")
        wait_ui(page, lambda: expect(row.get_by_role("button", name=re.compile(r"^Issue refund"))).to_have_count(0, timeout=QUICK_MS), "row turns refunded")
    assert reservation(p, rid)["state"] == "refunded"
    parts = [(f"ob-balance-{rid}", f"ob-refund-{rid}-1", ATELIER_BALANCE), (f"ob-upgrade-{rid}", f"ob-refund-{rid}-2", UPGRADE_NOW_EARLY),
             (f"ob-deposit-{rid}", f"ob-refund-{rid}-3", WORKED_REFUND - ATELIER_BALANCE - UPGRADE_NOW_EARLY)]
    for payment_key, refund_key, amount in parts:
        refunds = kb_tx(kb_payment(killbill, payment_key), "REFUND")
        assert [(t["transactionExternalKey"], cents(t["amount"])) for t in refunds] == [(refund_key, amount)], payment_key
    deposit_inv = invoice_with(kb_invoices(killbill, p), f"Bench {original} Bench deposit")
    assert item_net(deposit_inv, f"Bench {original} Bench deposit") == BENCH_DEPOSIT - parts[2][2]
    row_api = next(r for r in ok(reg.get("/api/desk/reservations", q=p.name))["reservations"] if r["id"] == rid)
    assert row_api["kb"]["refunded_cents"] == WORKED_REFUND and row_api["state"] == "refunded"
    await_mail(mail, p.email, f"Refund confirmed: Bench {target}")


def test_wf_group_purchase_api(mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    clinic, practitioner = signup(jan, "clinic"), signup(jan)
    free = open_labels(jan, "CD")
    expect_error(practitioner.post("/api/holds", {"benches": free[:2]}), 422, "validation")
    expect_error(clinic.post("/api/holds", {"benches": free[:CLINIC_MAX + 1]}), 422, "validation")
    expect_error(clinic.post("/api/holds", {"benches": []}), 422, "validation")
    expect_error(clinic.post("/api/holds", {"benches": [free[0], free[0]]}), 422, "validation")
    body = group_hold(clinic, free[:3])
    gid = body["group_id"]
    assert re.fullmatch(r"grp_.{16,}", gid)
    assert len({r["hold"]["expires_at"] for r in body["reservations"]}) == 1, "group benches share one expiry"
    expect_error(clinic.post("/api/holds", {"benches": free[3:4]}), 409, "hold_limit")
    ok(clinic.post(f"/api/groups/{gid}/release"))
    states = state_map(board(jan))
    assert all(states[l] == "open" for l in free[:3]), "group release frees every bench"
    attendee, attended = seat(jan, "full")
    colleague_name, colleague_email = fresh_identity("dp-colleague")
    benches = [b for b in free if b != attended["bench"]][:2]
    gid = group_hold(clinic, benches)["group_id"]
    seats: list[str] = []
    try:
        expect_error(checkout(clinic, gid, [{"bench": benches[0], "name": attendee.name, "email": attendee.email}]), 409, "already_attending")
        expect_error(checkout(practitioner, gid), 404, "not_found")
        group = ok(checkout(clinic, gid, [{"bench": benches[0], "name": colleague_name, "email": colleague_email}]), 201)["group"]
        seats = [r["id"] for r in group["reservations"]]
        assert all(r["state"] == "paid_in_full" for r in group["reservations"]) and group["invoice"]
        await_mail(mail, colleague_email, f"{clinic.clinic_name} assigned you Bench {benches[0]} at Opaline Bench Days")
    finally:
        for rid in seats:
            quietly(cancel, clinic, rid)
        quietly(cancel, attendee, attended["id"])


def test_group_invoice_items(killbill: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    clinic = signup(jan, "clinic")
    labels = open_labels(jan, "AB")[:1] + open_labels(jan, "CD")[:2]
    gid = group_hold(clinic, labels)["group_id"]
    group: dict[str, Any] = {"reservations": []}
    try:
        stranger = open_labels(jan, "CD")[0]
        body = expect_error(checkout(clinic, gid, [{"bench": stranger, "name": "X", "email": "x@example.test"}]), 422, "validation")
        assert "assignments" in body["errors"]
        assert killbill.payment_by_key(f"ob-group-{gid}") is None
        key = idempotency_key()
        first = ok(checkout(clinic, gid, key=key), 201)
        group = first["group"]
        assert ok(checkout(clinic, gid, key=key), 201) == first
        expect_error(checkout(clinic, gid), 409, "already_paid")
        expected = {labels[0]: ATELIER_FULL, labels[1]: BENCH_FULL, labels[2]: BENCH_FULL}
        assert {i["bench"]: i["amount_cents"] for i in group["invoice"]["items"]} == expected
        total = sum(expected.values())
        assert group["invoice"]["total_cents"] == total
        inv = invoice_with(kb_invoices(killbill, clinic), f"Bench {labels[1]} Bench full price")
        assert inv.get("invoiceId") == group["invoice"]["kb_invoice_id"]
        charges = [i for i in inv["items"] if (i.get("description") or "").endswith("full price")]
        assert sorted(i["description"] for i in charges) == sorted(
            [f"Bench {labels[0]} Atelier full price", f"Bench {labels[1]} Bench full price", f"Bench {labels[2]} Bench full price"])
        assert items_sum(inv) == cents(inv["amount"]) == total
        purchases = kb_tx(kb_payment(killbill, f"ob-group-{gid}"), "PURCHASE")
        assert len(purchases) == 1 and cents(purchases[0]["amount"]) == total
    finally:
        for r in group["reservations"]:
            quietly(cancel, clinic, r["id"])
        quietly(clinic.post, f"/api/groups/{gid}/release")


def test_wf_group_purchase_ui(browser: Browser, mail: Any, killbill: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    clinic = signup(jan, "clinic")
    labels = open_labels(jan, "CD")[:2]
    colleague_name, colleague_email = fresh_identity("dp-colleague")
    gid = None
    try:
        with visit(browser, jan, actor=clinic) as page:
            for label in labels:
                see(page, bench_button(page, label, "Open"), "open bench")
                click(bench_button(page, label, "Open"))
            panel = hold_panel(page)
            click(panel.get_by_role("button", name="Hold 2 benches"))
            status_count(page, bench_status(page), r"^2 benches are held for you\. (\d+) of 24 seats remaining\.$", "group hold copy")
            click(panel.get_by_role("button", name="Pay group invoice"))
            dlg = page.get_by_role("dialog", name="Group checkout")
            see(page, dlg, "group checkout")
            fill(dlg.get_by_role("textbox", name=f"Colleague name for Bench {labels[0]}"), colleague_name)
            fill(dlg.get_by_role("textbox", name=f"Colleague email for Bench {labels[0]}"), colleague_email)
            click(dlg.get_by_role("button", name=f"Pay group invoice ${usd(2 * BENCH_FULL)}"))
            see(page, page.get_by_role("heading", name="Group invoice confirmed: 2 seats on one invoice").first, "group heading")
            n = status_count(page, bench_status(page), r"^2 benches are yours\. (\d+) of 24 seats remaining\.$", "group paid copy")
            assert n == board(jan)["seats_remaining"]
        gid = ok(clinic.get("/api/me"))["groups"][0]["id"]
        group = ok(clinic.get(f"/api/groups/{gid}"))["group"]
        assert all(r["state"] == "paid_in_full" for r in group["reservations"]) and group["invoice"]["total_cents"] == 2 * BENCH_FULL
        assert cents(kb_tx(kb_payment(killbill, f"ob-group-{gid}"), "PURCHASE")[0]["amount"]) == 2 * BENCH_FULL
        await_mail(mail, colleague_email, f"{clinic.clinic_name} assigned you Bench {labels[0]} at Opaline Bench Days")
    finally:
        if gid:
            for r in ok(clinic.get(f"/api/groups/{gid}"))["group"]["reservations"]:
                quietly(cancel, clinic, r["id"])


def test_group_emails_private(mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    labels = open_labels(jan, "CD")[:2]
    name, email = fresh_identity("dp-colleague")
    clinic, group = paid_group(jan, labels, [{"bench": labels[0], "name": name, "email": email}])
    seats = by_bench(group)
    try:
        receipt = await_mail(mail, clinic.email, "Group invoice paid: 2 seats")[0]
        body = mail_text(receipt)
        assert f"Bench {labels[0]}: {name}" in body and f"Bench {labels[1]}: Unassigned" in body
        colleague = signup(jan, name=name, email=email)
        rid = seats[labels[0]]["id"]
        ok(colleague.post(f"/api/reservations/{rid}/accept"))
        lic, pas = licence_fields(), passport_fields(name)
        ok(upload(colleague, rid, "licence", PDF, lic), 201)
        ok(upload(colleague, rid, "passport", PDF, pas), 201)
        ok(clinic.post(f"/api/reservations/{seats[labels[1]]['id']}/cancel"))
        ok(staff(jan, "registrar").post(f"/api/desk/reservations/{seats[labels[1]]['id']}/refund", key=idempotency_key()))
        refund = await_mail(mail, clinic.email, f"Refund confirmed: Bench {labels[1]}")[0]
        assert f"Bench {labels[0]}" in mail_text(refund) and name in mail_text(refund)
        for m in mails(mail, clinic.email) + mails(mail, email):
            content = (m.get("Subject") or "") + mail_text(m)
            for secret in (lic["licence_number"], pas["passport_number"], pas["nationality"]):
                assert secret not in content, f"email {m.get('Subject')!r} leaks {secret}"
            assert not m.get("Attachments"), f"email {m.get('Subject')!r} attaches a file"
        link = ok(clinic.get(f"/api/groups/{group['id']}/documents/invoice"))
        pdf = pdf_text(fetch_link(jan, link["url"]).content)
        assert labels[0] in pdf and lic["licence_number"] not in pdf and pas["passport_number"] not in pdf
    finally:
        quietly(cancel, clinic, seats[labels[0]]["id"])


def test_wf_seat_assignment_reassign(mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    labels = open_labels(jan, "CD")[:2]
    clinic, group = paid_group(jan, labels)
    s1, s2 = by_bench(group)[labels[0]]["id"], by_bench(group)[labels[1]]["id"]
    a, b = signup(jan), signup(jan)
    extra = None
    try:
        assert "email" in expect_error(clinic.put(f"/api/reservations/{s1}/assignee", {"name": "X", "email": "nope"}), 422, "validation")["errors"]
        extra = group_hold(signup(jan, "clinic"), open_labels(jan, "CD")[:1])
        held_res = extra["reservations"][0]["id"]
        ok(clinic.put(f"/api/reservations/{s1}/assignee", {"name": a.name, "email": a.email}))
        await_mail(mail, a.email, f"{clinic.clinic_name} assigned you Bench {labels[0]} at Opaline Bench Days")
        ok(a.post(f"/api/reservations/{s1}/accept"))
        ok(upload(a, s1, "licence", PDF, licence_fields()), 201)
        ok(upload(a, s1, "passport", PDF, passport_fields(a.name)), 201)
        ok(staff(jan, "registrar").post(f"/api/desk/reservations/{s1}/visa-letter"), 201)
        s3 = S3("-jan")
        assert s3.keys(f"licences/{s1}/") and s3.keys(f"passports/{s1}/") and s3.keys(f"visa-letters/{s1}.pdf")
        ok(clinic.put(f"/api/reservations/{s1}/assignee", {"name": b.name, "email": b.email}))
        for path in (f"/api/reservations/{s1}", f"/api/reservations/{s1}/licence", f"/api/reservations/{s1}/passport",
                     f"/api/reservations/{s1}/documents/visa-letter"):
            expect_error(a.get(path), 404, "not_found")
        assert s1 not in [r["id"] for r in ok(a.get("/api/me"))["reservations"]]
        eventually(lambda: not (s3.keys(f"licences/{s1}/") or s3.keys(f"passports/{s1}/") or s3.keys(f"visa-letters/{s1}.pdf")),
                   SLACK_S, "former assignee's scans and visa letter are deleted from MinIO")
        cur = reservation(clinic, s1)
        assert "visa-letter" not in cur["documents"] and cur["licence_status"] == "none" and cur["passport_status"] == "none"
        assert cur["attendee"]["accepted"] is False
        await_mail(mail, b.email, f"{clinic.clinic_name} assigned you Bench {labels[0]} at Opaline Bench Days")
        ok(b.post(f"/api/reservations/{s1}/accept"))
        ok(clinic.put(f"/api/reservations/{s2}/assignee", {"name": a.name, "email": a.email}))
        ok(a.post(f"/api/reservations/{s2}/accept"))
        expect_error(clinic.put(f"/api/reservations/{s2}/assignee", {"name": b.name, "email": b.email}), 409, "already_attending")
        expect_error(clinic.put(f"/api/reservations/{held_res}/assignee", {"name": b.name, "email": b.email}), 404, "not_found")
    finally:
        quietly(cancel, clinic, s1)
        quietly(cancel, clinic, s2)


def test_seat_visibility(mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    label = open_labels(jan, "CD")[0]
    name, email = fresh_identity("dp-attendee")
    clinic, group = paid_group(jan, [label], [{"bench": label, "name": name, "email": email}])
    rid = group["reservations"][0]["id"]
    try:
        c = signup(jan, name=name, email=email)
        ok(c.post(f"/api/reservations/{rid}/accept"))
        lic, pas = licence_fields(), passport_fields(name)
        ok(upload(c, rid, "licence", PDF, lic), 201)
        ok(upload(c, rid, "passport", PDF, pas), 201)
        ok(staff(jan, "registrar").post(f"/api/desk/reservations/{rid}/visa-letter"), 201)
        assert ok(c.get(f"/api/reservations/{rid}/licence"))["licence_number"] == lic["licence_number"]
        ok(c.get(f"/api/reservations/{rid}/documents/visa-letter"))
        assert [r["id"] for r in ok(c.get("/api/me"))["reservations"]] == [rid]
        r = clinic.get(f"/api/reservations/{rid}")
        cur = ok(r)["reservation"]
        assert cur["licence_status"] == "submitted" and cur["passport_status"] == "submitted" and cur["attendee"]["email"].lower() == email.lower()
        assert lic["licence_number"] not in r.text and pas["passport_number"] not in r.text
        for path in ("licence", "passport", "documents/visa-letter", "documents/certificate"):
            expect_error(clinic.get(f"/api/reservations/{rid}/{path}"), 404, "not_found")
        ok(clinic.get(f"/api/groups/{group['id']}/documents/invoice"))
        expect_error(c.get(f"/api/groups/{group['id']}"), 404, "not_found")
        expect_error(c.get(f"/api/groups/{group['id']}/documents/invoice"), 404, "not_found")
        stranger = signup(jan)
        for path in (f"/api/reservations/{rid}", f"/api/reservations/{rid}/licence"):
            expect_error(stranger.get(path), 404, "not_found")
        expect_error(stranger.get(f"/api/reservations/res_{secrets.token_hex(12)}"), 404, "not_found")
        for m in mails(mail, clinic.email) + mails(mail, email):
            content = (m.get("Subject") or "") + mail_text(m)
            assert lic["licence_number"] not in content and pas["passport_number"] not in content and not m.get("Attachments")
    finally:
        quietly(cancel, clinic, rid)


def test_wf_seat_assignment_colleague(browser: Browser, mail: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    label = open_labels(jan, "CD")[0]
    name, email = fresh_identity("dp-colleague")
    password = "pw-" + secrets.token_hex(8)
    clinic, group = paid_group(jan, [label], [{"bench": label, "name": name, "email": email}])
    rid = group["reservations"][0]["id"]
    colleague = Actor(jan, name, email, password)
    try:
        await_mail(mail, email, f"{clinic.clinic_name} assigned you Bench {label} at Opaline Bench Days")
        other = open_labels(jan, "CD")[0]
        with visit(browser, jan) as page:
            see(page, bench_button(page, other, "Open"), "open bench")
            click(bench_button(page, other, "Open"))
            click(page.get_by_role("dialog", name="Sign in").get_by_role("button", name="Create an account"))
            dlg = page.get_by_role("dialog", name="Create account")
            see(page, dlg, "create account dialog")
            fill(dlg.get_by_role("textbox", name="Name"), name)
            fill(dlg.get_by_role("textbox", name="Email"), email)
            fill(dlg.get_by_role("textbox", name="Password"), password)
            check(dlg.get_by_role("radio", name="Practitioner"))
            click(dlg.get_by_role("button", name="Create account"))
            see(page, hold_panel(page).get_by_role("button", name="Release bench"), "signed-up hold")
            click(hold_panel(page).get_by_role("button", name="Release bench"))
            see(page, bench_button(page, other, "Open"), "hold released")
            page.goto(jan + "/account")
            region = page.get_by_role("region", name=f"Bench {label}")
            see(page, region, "assigned seat on the account page")
            click(region.get_by_role("button", name="Accept seat"))
            status = page.get_by_role("status", name="Account updates")
            see_text(page, status, f"Bench {label} is now your seat.", "seat accepted copy")
            click(region.get_by_role("button", name="Upload licence"))
            up = page.get_by_role("dialog").last
            fill(up.get_by_role("textbox", name="Licence number"), "LIC" + secrets.token_hex(4).upper())
            fill(up.get_by_role("textbox", name="Issuing state"), "Illinois")
            up.get_by_role("textbox", name="Issuing state").focus()
            choose_file(page, up, {"name": "licence.pdf", "mimeType": "application/pdf", "buffer": PDF})
            submit_dialog(up)
            see_text(page, status, "Licence received. The registrar will check it.", "licence copy")
        colleague.sign_in()
        cur = reservation(colleague, rid)
        assert cur["licence_status"] == "submitted" and cur["attendee"]["accepted"] is True
        active = [r for r in ok(colleague.get("/api/me"))["reservations"] if r["state"] not in ("released",)]
        assert [r["id"] for r in active] == [rid]
        assert S3("-jan").keys(f"licences/{rid}/")
        expect_error(clinic.get(f"/api/reservations/{rid}/licence"), 404, "not_found")
    finally:
        quietly(cancel, clinic, rid)


def test_wf_group_seat_changes_cancel(killbill: Any) -> None:
    past = env_url("APP_JAN_PAST_URL")
    labels = open_labels(past, "CD")[:3]
    clinic, group = paid_group(past, labels)
    seats = by_bench(group)
    target = seats[labels[1]]["id"]
    try:
        due = ok(clinic.post(f"/api/reservations/{target}/cancel"))["reservation"]["refund_due_cents"]
        assert due == BENCH_FULL // 2
        reg = staff(past, "registrar")
        key = idempotency_key()
        body = ok(reg.post(f"/api/desk/reservations/{target}/refund", key=key))
        assert body["reservation"]["state"] == "refunded"
        assert ok(reg.post(f"/api/desk/reservations/{target}/refund", key=key)) == body
        refunds = kb_tx(kb_payment(killbill, f"ob-group-{group['id']}"), "REFUND")
        assert [(t["transactionExternalKey"], cents(t["amount"])) for t in refunds] == [(f"ob-refund-{target}-1", due)]
        inv = invoice_with(kb_invoices(killbill, clinic), f"Bench {labels[0]} Bench full price")
        assert item_net(inv, f"Bench {labels[1]} Bench full price") == BENCH_FULL - due
        assert item_net(inv, f"Bench {labels[0]} Bench full price") == BENCH_FULL == item_net(inv, f"Bench {labels[2]} Bench full price")
        assert items_sum(inv) == cents(inv["amount"])
        app = ok(clinic.get(f"/api/groups/{group['id']}"))["group"]
        amounts = {i["bench"]: i["amount_cents"] for i in app["invoice"]["items"]}
        assert amounts == {labels[0]: BENCH_FULL, labels[1]: BENCH_FULL - due, labels[2]: BENCH_FULL}
        assert app["invoice"]["total_cents"] == sum(amounts.values()) == cents(inv["amount"])
        others = by_bench(app)
        assert others[labels[0]]["state"] == others[labels[2]]["state"] == "paid_in_full"
    finally:
        quietly(cancel, clinic, seats[labels[0]]["id"])
        quietly(cancel, clinic, seats[labels[2]]["id"])


def test_wf_group_seat_changes_upgrade(killbill: Any) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    labels = open_labels(jan, "CD")[:2]
    clinic, group = paid_group(jan, labels)
    s1, s2 = by_bench(group)[labels[0]]["id"], by_bench(group)[labels[1]]["id"]
    try:
        before = invoice_with(kb_invoices(killbill, clinic), f"Bench {labels[0]} Bench full price")
        app_before = ok(clinic.get(f"/api/groups/{group['id']}"))["group"]["invoice"]
        target = open_labels(jan, "AB")[0]
        key = idempotency_key()
        first = ok(upgrade(clinic, s1, target, key=key), 201)
        assert ok(upgrade(clinic, s1, target, key=key), 201) == first
        cur = first["reservation"]
        assert (cur["bench"], cur["tier"]) == (target, "atelier") and cur["paid_cents"] == BENCH_FULL + UPGRADE_DIFF
        purchases = kb_tx(kb_payment(killbill, f"ob-upgrade-{s1}"), "PURCHASE")
        assert len(purchases) == 1 and cents(purchases[0]["amount"]) == UPGRADE_DIFF
        invoices = kb_invoices(killbill, clinic)
        up = invoice_with(invoices, f"Bench {target} Atelier upgrade")
        assert len([i for i in up["items"] if i.get("description") == f"Bench {target} Atelier upgrade"]) == 1
        assert items_sum(up) == UPGRADE_DIFF
        after = invoice_with(invoices, f"Bench {labels[0]} Bench full price")
        assert cents(after["amount"]) == cents(before["amount"]) and len(after["items"]) == len(before["items"])
        assert ok(clinic.get(f"/api/groups/{group['id']}"))["group"]["invoice"] == app_before
        other = reservation(clinic, s2)
        assert (other["bench"], other["tier"], other["state"]) == (labels[1], "bench", "paid_in_full")
        rows = ok(staff(jan, "registrar").get("/api/desk/reservations", q=target))["reservations"]
        assert next(r for r in rows if r["id"] == s1)["kb"]["paid_cents"] == BENCH_FULL + UPGRADE_DIFF
    finally:
        quietly(cancel, clinic, s1)
        quietly(cancel, clinic, s2)


UPLOAD_CASES = [
    ("pdf", PDF, "scan.png", "image/png", 201, ".pdf"),
    ("jpeg", JPEG, "scan.pdf", "application/pdf", 201, ".jpg"),
    ("png", PNG, "scan.jpg", "image/jpeg", 201, ".png"),
    ("svg", SVG, "scan.svg", "image/svg+xml", 415, None),
    ("html-as-pdf", HTML, "scan.pdf", "application/pdf", 415, None),
]


def test_upload_rules(app_url: str) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p, res = seat(jan, "full")
    rid = res["id"]
    s3 = S3("-jan")
    try:
        for case, content, filename, ctype, status, ext in UPLOAD_CASES:
            marker = f"dp-original-{secrets.token_hex(4)}"
            r = upload(p, rid, "licence", content, licence_fields(), filename=f"{marker}-{filename}", ctype=ctype)
            if status == 415:
                expect_error(r, 415, "unsupported_file_type")
                continue
            ok(r, 201)
            keys = s3.keys(f"licences/{rid}/")
            assert not any(marker in k for k in keys), f"{case}: key reuses the file name"
            match = [k for k in keys if k.endswith(ext) and s3.get(k) == content]
            assert match, f"{case}: no private object {ext} equal to the upload in {keys}"
            link = ok(p.get(f"/api/reservations/{rid}/licence"))
            assert link["expires_in"] == LINK_SECONDS
            assert fetch_link(jan, link["url"]).content == content
            assert fetch_link(jan, link["url"].split("?")[0]).status_code != 200, "objects are not public"
        expect_error(upload(p, rid, "licence", b"%PDF-" + b"0" * (FILE_LIMIT - 4), licence_fields()), 413, "file_too_large")
        ok(upload(p, rid, "licence", b"%PDF-" + b"0" * (FILE_LIMIT - 5), licence_fields()), 201)
        r = p.http.post(f"/api/reservations/{rid}/passport", data=passport_fields(p.name),
                        files=[("file", ("a.pdf", PDF, "application/pdf")), ("file", ("b.pdf", PDF, "application/pdf"))])
        assert "file" in expect_error(r, 422, "validation")["errors"]
        assert "licence_number" in expect_error(upload(p, rid, "licence", PDF, {"licence_state": "Illinois"}), 422, "validation")["errors"]
        expect_error(upload(signup(jan), rid, "licence", PDF, licence_fields()), 404, "not_found")
    finally:
        quietly(cancel, p, rid)


def test_wf_licence_visa_review(browser: Browser) -> None:
    jan = env_url("APP_JAN_EVE_URL")
    p, res = seat(jan, "full")
    rid = res["id"]
    reg = staff(jan, "registrar")
    path = f"/api/desk/reservations/{rid}/licence-review"
    try:
        expect_error(reg.post(path, {"decision": "matched"}), 409, "no_licence")
        ok(upload(p, rid, "licence", PDF, licence_fields()), 201)
        expect_error(p.post(path, {"decision": "matched"}), 403, "forbidden")
        expect_error(staff(jan, "director").post(path, {"decision": "matched"}), 403, "forbidden")
        assert "decision" in expect_error(reg.post(path, {"decision": "maybe"}), 422, "validation")["errors"]
        assert ok(reg.post(path, {"decision": "rejected"}))["reservation"]["licence_status"] == "rejected"
        assert ok(upload(p, rid, "licence", PNG, licence_fields(), "l.png", "image/png"), 201)["reservation"]["licence_status"] == "submitted"
        stranger = signup(jan)
        expect_error(stranger.get(f"/api/reservations/{rid}/licence"), 404, "not_found")
        ok(reg.get(f"/api/reservations/{rid}/licence"))
        with visit(browser, jan, "/desk", actor=reg) as page:
            fill(page.get_by_role("searchbox", name="Find a reservation"), p.name)
            row = page.get_by_role("table", name="Reservations").get_by_role("row").filter(has_text=p.name)
            wait_ui(page, lambda: expect(row).to_have_count(1, timeout=QUICK_MS), "desk row")
            click(row.get_by_role("button", name="Mark licence matched"))
            see_text(page, page.get_by_role("status", name="Desk updates"), f"Licence matched for {p.name}.", "matched copy")
        assert reservation(p, rid)["licence_status"] == "matched"
        expect_error(upload(p, rid, "licence", PDF, licence_fields()), 409, "licence_locked")
        expect_error(reg.post(path, {"decision": "rejected"}), 409, "invalid_transition")
    finally:
        quietly(cancel, p, rid)


def test_wf_licence_visa_letter(browser: Browser, app_url: str, mail: Any) -> None:
    p, res = seat(app_url, "full")
    rid = res["id"]
    reg = staff(app_url, "registrar")
    try:
        expect_error(reg.post(f"/api/desk/reservations/{rid}/visa-letter"), 409, "passport_missing")
        pas = passport_fields(p.name)
        ok(upload(p, rid, "passport", PDF, pas), 201)
        down = staff(env_url("APP_MINIO_DOWN_URL"), "registrar")
        expect_error(down.post(f"/api/desk/reservations/{rid}/visa-letter"), 503, "storage_unavailable")
        assert "visa-letter" not in reservation(p, rid)["documents"]
        assert not S3().keys(f"visa-letters/{rid}.pdf")
        assert not mails(mail, p.email, "Your visa-support letter for Opaline Bench Days")
        with visit(browser, app_url, "/desk", actor=reg) as page:
            fill(page.get_by_role("searchbox", name="Find a reservation"), p.name)
            row = page.get_by_role("table", name="Reservations").get_by_role("row").filter(has_text=p.name)
            wait_ui(page, lambda: expect(row).to_have_count(1, timeout=QUICK_MS), "desk row")
            click(row.get_by_role("button", name="Issue visa letter"))
            see_text(page, page.get_by_role("status", name="Desk updates"), f"Visa-support letter issued to {p.name}.", "visa copy")
        assert "visa-letter" in reservation(p, rid)["documents"]
        stored = S3().get(f"visa-letters/{rid}.pdf")
        assert stored.startswith(b"%PDF-")
        again = ok(reg.post(f"/api/desk/reservations/{rid}/visa-letter"))
        assert "visa-letter" in again["reservation"]["documents"] and S3().get(f"visa-letters/{rid}.pdf") == stored
        assert fetch_link(app_url, ok(p.get(f"/api/reservations/{rid}/documents/visa-letter"))["url"]).content == stored
        msgs = await_mail(mail, p.email, "Your visa-support letter for Opaline Bench Days")
        assert len(mails(mail, p.email, "Your visa-support letter for Opaline Bench Days")) == 1
        assert pas["passport_number"] not in mail_text(msgs[0]) and not msgs[0].get("Attachments")
    finally:
        quietly(cancel, p, rid)


def test_checkin_venue_dates() -> None:
    d1, d2late, d2 = env_url("APP_EVENT_DAY1_URL"), env_url("APP_EVENT_DAY2_LATE_URL"), env_url("APP_EVENT_DAY2_URL")
    closed = env_url("APP_EVENT_CLOSED_URL")
    p, res = seat(d1, "full")
    q, qres = seat(d1, "full")
    clinic = signup(d1, "clinic")
    gid = group_hold(clinic, open_labels(d1, "CD")[:1])["group_id"]
    unassigned = ok(checkout(clinic, gid), 201)["group"]["reservations"][0]["id"]
    fd1, fd2, fd2late, fdc = (staff(b, "frontdesk") for b in (d1, d2, d2late, closed))
    expect_error(p.get("/api/checkin", q=p.name[:4]), 403, "forbidden")
    expect_error(fd1.get("/api/checkin", q=p.name[:1]), 422, "validation")
    found = ok(fd1.get("/api/checkin", q=p.name))
    assert found["q"] == p.name and found["open_day"] == 1 and found["venue_date"] == CHECKIN_DAY1
    assert [r["reservation_id"] for r in found["results"]] == [res["id"]]
    shut = ok(fdc.get("/api/checkin", q=p.name))
    assert shut["open_day"] is None and shut["venue_date"] not in (CHECKIN_DAY1, CHECKIN_DAY2)
    expect_error(fdc.post("/api/checkin", {"reservation_id": res["id"], "day": 1}), 409, "checkin_closed")
    expect_error(fdc.post("/api/checkin", {"reservation_id": unassigned, "day": 1}), 409, "checkin_closed")
    expect_error(fd1.post("/api/checkin", {"reservation_id": res["id"], "day": 2}), 409, "checkin_closed")
    expect_error(fd1.post("/api/checkin", {"reservation_id": unassigned, "day": 1}), 409, "no_attendee")
    assert ok(fd1.post("/api/checkin", {"reservation_id": res["id"], "day": 1}), 201)["reservation"]["state"] == "checked_in_day1"
    expect_error(fd1.post("/api/checkin", {"reservation_id": res["id"], "day": 1}), 409, "already_checked_in")
    late = ok(fd2late.get("/api/checkin", q=p.name))
    assert late["open_day"] == 2 and late["venue_date"] == CHECKIN_DAY2
    assert ok(fd2late.post("/api/checkin", {"reservation_id": res["id"], "day": 2}), 201)["reservation"]["state"] == "checked_in_day2"
    expect_error(fd2.post("/api/checkin", {"reservation_id": qres["id"], "day": 2}), 409, "not_checked_in_day1")


def test_wf_checkin_certificate_desk(browser: Browser) -> None:
    d1 = env_url("APP_EVENT_DAY1_URL")
    tag = "Zed" + secrets.token_hex(3)
    alpha, _ = seat(d1, "full", name=f"{tag}Alpha Kim")
    beta, _ = seat(d1, "full", name=f"{tag}Beta Kim")
    fd = staff(d1, "frontdesk")
    captured: list[Route] = []

    def gate(route: Route) -> None:
        if not captured and parse_qs(urlparse(route.request.url).query).get("q") == [tag]:
            captured.append(route)
        else:
            route.continue_()

    with visit(browser, d1, "/checkin", actor=fd) as page:
        see(page, page.get_by_role("heading", name="Day 1 check-in"), "day heading")
        page.route(lambda url: "/api/checkin" in url and "q=" in url, gate)
        box = page.get_by_role("searchbox", name="Attendee name")
        page.keyboard.press("/")
        assert is_focused(box), "/ moves focus to the search box"
        box.press_sequentially(tag)
        wait_ui(page, lambda: _true(captured, "first query not sent"), "the first search is sent after the debounce")
        box.press_sequentially("A")
        advance(page, DEBOUNCE_MS + FRAME_MS)
        matches = page.get_by_role("list", name="Matches")
        status = page.get_by_role("status", name="Check-in updates")
        see(page, matches.get_by_role("button", name=f"Check in {alpha.name} for day 1"), "latest matches")
        see_text(page, status, f'Found 1 for "{tag}A".', "latest announcement")
        with page.expect_response(lambda r: parse_qs(urlparse(r.url).query).get("q") == [tag]):
            captured[0].continue_()
        advance(page, STEP_MS)
        expect(matches.get_by_role("button")).to_have_count(1)
        expect(status).to_have_text(f'Found 1 for "{tag}A".')
        box.press("Enter")
        see_text(page, status, f"{alpha.name} checked in for day 1.", "Enter checks in the single match")
        assert is_focused(box)
        sel = page.evaluate("() => { const e = document.activeElement; return [e.selectionStart, e.selectionEnd, e.value.length]; }")
        assert sel[0] == 0 and sel[1] == sel[2] > 0, f"search text is selected: {sel}"
        box.press_sequentially(f"{tag}Q")
        advance(page, DEBOUNCE_MS + FRAME_MS)
        see_text(page, status, f'No attendee matches "{tag}Q".', "no-match copy")
        box.press("Enter")
        advance(page, STEP_MS)
        expect(status).to_have_text(f'No attendee matches "{tag}Q".')
        box.press("Control+A")
        box.press_sequentially(f"{tag}B")
        advance(page, DEBOUNCE_MS + FRAME_MS)
        target = matches.get_by_role("button", name=f"Check in {beta.name} for day 1")
        see(page, target, "beta listed")
        box.press("ArrowDown")
        assert is_focused(target)
        page.keyboard.press("Enter")
        see_text(page, status, f"{beta.name} checked in for day 1.", "Enter on a match checks in")
    reg = staff(d1, "registrar")
    for actor in (alpha, beta):
        rows = ok(reg.get("/api/desk/reservations", q=actor.name))["reservations"]
        assert rows and rows[0]["state"] == "checked_in_day1"


def test_wf_checkin_certificate_issue(mail: Any) -> None:
    d1, d2, dmin = env_url("APP_EVENT_DAY1_URL"), env_url("APP_EVENT_DAY2_URL"), env_url("APP_EVENT_MINIO_DOWN_URL")
    reg1, reg2, regm = staff(d1, "registrar"), staff(d2, "registrar"), staff(dmin, "registrar")
    fd1, fd2 = staff(d1, "frontdesk"), staff(d2, "frontdesk")
    people = []
    for _ in range(2):
        actor, res = seat(d1, "full")
        lic = licence_fields()
        ok(upload(actor, res["id"], "licence", PDF, lic), 201)
        ok(reg1.post(f"/api/desk/reservations/{res['id']}/licence-review", {"decision": "matched"}))
        ok(fd1.post("/api/checkin", {"reservation_id": res["id"], "day": 1}), 201)
        ok(fd2.post("/api/checkin", {"reservation_id": res["id"], "day": 2}), 201)
        people.append((actor, res["id"], lic))
    _, pending = seat(d1, "full")
    body = expect_error(reg2.post(f"/api/desk/reservations/{pending['id']}/certificate"), 409, "certificate_not_eligible")
    assert body["missing"] == ["day1_check_in", "day2_check_in", "licence_not_matched"]
    (p1, r1, lic1), (p2, r2, _) = people
    expect_error(regm.post(f"/api/desk/reservations/{r1}/certificate"), 503, "storage_unavailable")
    assert reservation(reg2, r1)["state"] == "checked_in_day2" and "certificate" not in reservation(reg2, r1)["documents"]
    first = ok(reg2.post(f"/api/desk/reservations/{r1}/certificate"), 201)
    m = re.fullmatch(r"OB-2027-(\d{4})", first["certificate_number"])
    assert m and first["reservation"]["state"] == "certificate_issued"
    expect_error(regm.post(f"/api/desk/reservations/{r2}/certificate"), 503, "storage_unavailable")
    results = race([lambda: reg2.post(f"/api/desk/reservations/{r2}/certificate") for _ in range(3)])
    assert sorted(r.status_code for r in results) == [200, 200, 201], [r.text for r in results]
    assert {r.json()["certificate_number"] for r in results} == {f"OB-2027-{int(m.group(1)) + 1:04d}"}
    assert ok(reg2.post(f"/api/desk/reservations/{r1}/certificate"))["certificate_number"] == first["certificate_number"]
    stored = S3("-event").get(f"certificates/{r1}.pdf")
    p1d2 = p1.on(d2)
    for _ in range(2):
        link = ok(p1d2.get(f"/api/reservations/{r1}/documents/certificate"))
        assert fetch_link(d2, link["url"]).content == stored
    content = pdf_text(stored)
    for expected in (p1.name, lic1["licence_number"], lic1["licence_state"], "Layered Composite Masterclass", "Opaline Institute",
                     "OI-PACE-219874", "April 2027", "Chicago, Illinois", "Lecture and participation (hands-on)", "16 credits",
                     "250 Operative (restorative) dentistry", first["certificate_number"], "Dr. Celeste Marrow-Ibarra"):
        assert expected in content, f"certificate PDF lacks {expected!r}"
    await_mail(mail, p1.email, "Your CE certificate for Opaline Bench Days")
    assert len(mails(mail, p1.email, "Your CE certificate for Opaline Bench Days")) == 1


def test_wf_outage_recovery_killbill(browser: Browser, killbill: Any, relayed: dict[str, Any]) -> None:
    base = relayed["base"]
    s, sres = seat(base, "full")
    ok(s.post(f"/api/reservations/{sres['id']}/cancel"))
    reg = staff(base, "registrar")
    down_inst = env_url("APP_KILLBILL_DOWN_URL")
    expect_error(pay(signup(down_inst), hold(signup(down_inst))["id"], "full"), 404, "not_found")
    p = signup(base)
    label = open_labels(base, "CD")[0]
    res_id = None
    try:
        with visit(browser, base, actor=p) as page:
            see(page, bench_button(page, label, "Open"), "open bench")
            click(bench_button(page, label, "Open"))
            see(page, bench_button(page, label, "Held by you"), "held")
            res_id = me_seat(p, label)["id"]
            relayed["kb"].down()
            try:
                key = idempotency_key()
                expect_error(pay(p, res_id, "full", key=key), 503, "billing_unavailable")
                assert reservation(p, res_id)["state"] == "held" and killbill.payment_by_key(f"ob-full-{res_id}") is None
                expect_error(reg.post(f"/api/desk/reservations/{sres['id']}/refund", key=idempotency_key()), 503, "billing_unavailable")
                assert reservation(reg, sres["id"])["state"] == "cancelled"
                desk = ok(reg.get("/api/desk/reservations", q=s.name))
                assert desk["billing"] == "unavailable" and all(r["kb"] is None for r in desk["reservations"])
                click(hold_panel(page).get_by_role("button", name="Pay in full"))
                dlg = page.get_by_role("dialog", name="Checkout")
                click(dlg.get_by_role("button", name=f"Pay in full ${usd(BENCH_FULL)}"))
                copy = "Billing is offline right now. Your hold keeps running and no money has moved."
                see(page, page.get_by_role("alert").filter(has_text=copy).first, "billing-offline banner")
                see_text(page, bench_status(page), copy, "billing-offline announcement")
                timer = hold_timer_anywhere(page)
                t1 = mmss(timer.inner_text())
                advance(page, MAP_REFRESH_MS)
                assert mmss(timer.inner_text()) < t1, "the hold keeps running"
            finally:
                relayed["kb"].restore()
            click(dlg.get_by_role("button", name=f"Pay in full ${usd(BENCH_FULL)}"))
            see(page, dlg.get_by_role("heading", name=f"Bench {label} is yours"), "retry succeeds without a restart")
        assert reservation(p, res_id)["state"] == "paid_in_full"
        assert len(kb_tx(kb_payment(killbill, f"ob-full-{res_id}"), "PURCHASE")) == 1
        assert ok(reg.post(f"/api/desk/reservations/{sres['id']}/refund", key=idempotency_key()))["reservation"]["state"] == "refunded"
        desk = ok(reg.get("/api/desk/reservations", q=p.name))
        assert desk["billing"] == "ok" and desk["reservations"][0]["kb"]["paid_cents"] == BENCH_FULL
        down_desk = ok(staff(down_inst, "registrar").get("/api/desk/reservations", q=p.name))
        assert down_desk["billing"] == "unavailable"
    finally:
        relayed["kb"].restore()
        if res_id:
            quietly(cancel, p, res_id)


def test_wf_outage_recovery_storage_mail(app_url: str, mail: Any, relayed: dict[str, Any]) -> None:
    base = relayed["base"]
    p = signup(base)
    res = hold(p)
    seats: list[tuple[Actor, str]] = [(p, res["id"])]
    try:
        relayed["s3"].down()
        try:
            r = pay(p, res["id"], "full")
            assert r.status_code == 202 and r.json()["reservation"]["payment_pending"] == "full", r.text
            expect_error(upload(p, res["id"], "licence", PDF, licence_fields()), 503, "storage_unavailable")
        finally:
            relayed["s3"].restore()
        eventually(lambda: reservation(p, res["id"])["state"] == "paid_in_full", RECEIPT_RETRY_S + SLACK_S * 2,
                   "the pending payment finishes after MinIO returns")
        assert f"receipts/{res['id']}/full.pdf" in S3().keys(f"receipts/{res['id']}/")
        ok(upload(p, res["id"], "licence", PDF, licence_fields()), 201)
        await_mail(mail, p.email, f"Paid in full: Bench {res['bench']}")
        relayed["smtp"].down()
        try:
            q = signup(base)
            qres = hold(q)
            seats.append((q, qres["id"]))
            ok(pay(q, qres["id"], "full"), 201)
        finally:
            relayed["smtp"].restore()
        await_mail(mail, q.email, f"Paid in full: Bench {qres['bench']}", seconds=MAIL_RETRY_S + MAIL_WAIT_S)
        m = signup(env_url("APP_MAILPIT_DOWN_URL"))
        mres = hold(m)
        seats.append((m, mres["id"]))
        ok(pay(m, mres["id"], "full"), 201)
        await_mail(mail, m.email, f"Paid in full: Bench {mres['bench']}", seconds=MAIL_RETRY_S + MAIL_WAIT_S)
    finally:
        relayed["s3"].restore()
        relayed["smtp"].restore()
        for actor, rid in seats:
            quietly(cancel, actor.on(app_url), rid)


def test_if_run_manifest() -> None:
    data = json.loads((APP_ROOT / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}, data
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[k], str) and data[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    assert packages, "the deployed app ships packages"
    missing = sorted({p.name for p in packages if p.name not in notices})
    assert not missing, f"notices omit shipped packages: {missing}"
    assert all(font in notices for font in FONTS), "notices name both bundled fonts"


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad}"
    lines = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for font in FONTS:
        named = [i for i, line in enumerate(lines) if font in line]
        assert named, f"{font} is not named in the notices"
        near = " ".join(" ".join(lines[i: i + NOTICE_WINDOW]) for i in named)
        assert any(lic in near for lic in ALLOWLIST) or OFL_NAME.search(near), f"{font} has no allowed licence in the notices"


def test_if_no_extra_datastore() -> None:
    names = {p.name for p in shipped_packages()}
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "@seald-io/nedb", "lokijs",
                 "level", "node-persist", "keyv"}
    assert not names & forbidden, f"extra datastore packages: {names & forbidden}"
    for root in (APP_ROOT, Path(DEPLOYED_APP)):
        found = [str(p) for p in root.rglob("*") if "node_modules" not in p.parts and p.suffix in (".sqlite", ".sqlite3", ".db")]
        assert not found, f"database files on disk: {found[:5]}"


def test_if_service_config_unchanged(killbill: Any) -> None:
    S3().keys("receipts/")
    collections = PocketBase().collections()
    assert {"agenda_sessions", "hospitality_events", "hotels", "faq_entries"} <= set(collections)
    assert killbill.account_by_key("ob-acc_" + secrets.token_hex(12)) is None


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    seen: list[str] = []
    with visit(browser, app_url) as page:
        page.on("request", lambda r: seen.append(r.url) if r.resource_type in ("script", "stylesheet", "font", "image") else None)
        page.goto(app_url + "/")
        for frac in (0.25, 0.5, 0.75, 1.0):
            page.evaluate("f => window.scrollTo({top: document.body.scrollHeight * f, behavior: 'instant'})", frac)
            advance(page, LIFT_SETTLE_MS)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert seen and not foreign, f"cross-origin assets: {foreign}"


def test_if_lockfile_matches() -> None:
    pkg = json.loads((APP_ROOT / "package.json").read_text())
    lock = json.loads((APP_ROOT / "package-lock.json").read_text())
    root = lock.get("packages", {}).get("", {})
    for field in ("dependencies", "devDependencies"):
        assert (root.get(field) or {}) == (pkg.get(field) or {}), f"lockfile {field} differ from package.json"
