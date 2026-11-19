from __future__ import annotations

import json
import hashlib
import math
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from itertools import combinations
from pathlib import Path
from statistics import median
from typing import Any, Callable, Iterator
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    AXE,
    DEPLOYED_APP,
    Postgres,
    S3,
    addresses,
    advance,
    axe,
    capture,
    center,
    check,
    click,
    decode,
    fill,
    held,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    style,
    tab_order,
    tap,
)
from conftest import text as mail_text

PHONE = "375x812"
TABLET = "768x1024"
DESKTOP = "1280x800"
SIZES = ["375x812", "768x1024", "1280x800"]
TWO_SIZES = ["1280x800", "375x812"]

PASSWORD = "estate-demo-2026"
LEAD = "lead.atlantico@tramela.example"
LEAD_CL = "lead.casalusa@tramela.example"
TIAGO = "gerente.faro@tramela.example"
RUI = "gerente.lisboa@tramela.example"
SOFIA = "gerente.pdelgada@tramela.example"
CARE = "apoio.atlantico@tramela.example"
CARE_CL = "apoio.casalusa@tramela.example"
ANA = "cliente.ana@tramela.example"
BRUNO = "cliente.bruno@tramela.example"
EVA = "cliente.eva@tramela.example"
FILIPE = "cliente.filipe@tramela.example"
GIL = "cliente.gil@tramela.example"
HELENA = "cliente.helena@tramela.example"
DIOGO = "cliente.diogo@tramela.example"
SHOPPERS = [ANA, BRUNO, EVA, FILIPE, GIL, HELENA]
MANAGERS = {"AT01": RUI, "AT05": TIAGO, "AT06": TIAGO, "AT11": SOFIA}
STORE_NAMES = {"AT01": "Loja Lisboa Baixa", "AT05": "Loja Faro Centro", "AT06": "Loja Olhão", "AT11": "Loja Ponta Delgada"}
STATE_WORDS = {"open": "open", "closing_soon": "closing soon", "closed": "closed",
               "stock_critical": "stock critical", "suspended": "suspended"}
STATE_LABELS = {"open": "Open", "closing_soon": "Closing soon", "closed": "Closed",
                "stock_critical": "Stock critical", "suspended": "Suspended"}
ALL_STATES = "open,closing_soon,closed,stock_critical,suspended"
LISBOA = {"lat": 38.7223, "lon": -9.1393}
FARO = {"lat": 37.0194, "lon": -7.9304}
WEEK = [1, 2, 3, 4, 5, 6, 7]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000"
REASON_DEFECT = "Defeito"
REASON_TAPE = "Fita danificada"
REASON_COLOUR = "Cor errada"
SUSPEND_REASON = "Obras no armazém"
LATER_OPEN = "10:00"
UNKNOWN_API_PATH = "/api/nothing-here"
CORS_HEADER_PREFIX = "access-control-"
FILE_KEY_MARKER = "dependencies"


def viewport_text(lon: float, lat: float, zoom: float) -> str:
    return f"{lon:.4f},{lat:.4f},{zoom:.2f}"


def progress_text(value: float) -> str:
    return f"{value:.3f}"

MIN_TARGET = 44
TARGET_SLACK = 0.01  # px: boxes of transformed elements carry float rounding (44 can read as 43.99997)
PHONE_SIDE_MARGIN = 24
FIG_MIN_MS, FIG_MAX_MS = 320, 400
STATE_MIN_MS, STATE_MAX_MS = 160, 240
GLIDE_MIN_MS, GLIDE_MAX_MS = 560, 720
PANEL_DELAY_MIN_MS, PANEL_DELAY_MAX_MS = 120, 220
HALF_MIN_MS, HALF_MAX_MS = 200, 280
TRAVEL_MIN_MS, TRAVEL_MAX_MS = 240, 320
STAGGER_MS = 40
DROP_MIN_MS, DROP_MAX_MS = 360, 480
PULSE_MIN_MS, PULSE_MAX_MS = 520, 680
POLL_MS = 5000
DEBOUNCE_MS = 400
BODY_LIMIT = 65536
Q_LIMIT = 100
LIST_BUDGET_S = 0.5
RECOVERY_S = 10
SHORT_HOLD = 5
SHORT_SESSION = 40
CART_MAX = 999


def cents_of(printed: str) -> int:
    whole, fraction = printed.removesuffix(" €").split(",")
    return int(whole) * 100 + int(fraction)


FITA_THREE = cents_of("14,99 €")
FITA_THREE_VAT_MAINLAND = cents_of("2,80 €")
FITA_THREE_VAT_AZORES = cents_of("2,07 €")
VARNISH = cents_of("24,90 €")
VARNISH_VAT_MAINLAND = cents_of("4,66 €")
VARNISH_VAT_AZORES = cents_of("3,43 €")
FITA_UNIT = cents_of("5,00 €")
TES_POD_CENTS = 12490 // 10


def tagged(scope: Any, name: str, value: str | None = None) -> Any:
    return scope.locator(f'[{name}="{value}"]' if value is not None else f"[{name}]")


def store_item(scope: Any, code: str) -> Any:
    return tagged(scope, "data-store-id", code)


def store_url(store: str) -> str:
    return f"/api/stores/{store}"


def stock_url(store: str) -> str:
    return f"/api/stores/{store}/stock"


def till_url(store: str) -> str:
    return f"/api/stores/{store}/till-sales"


def count_url(store: str, sku: str) -> str:
    return f"/api/stores/{store}/stock/{sku}/count"


def avail_url(sku: str) -> str:
    return f"/api/products/{sku}/availability"


def line_url(sku: str) -> str:
    return f"/api/cart/lines/{sku}"
def hours_url(store: str) -> str:
    return f"/api/stores/{store}/hours"


def plan_url(store: str) -> str:
    return f"/api/stores/{store}/day-plan"


def slots_url(store: str) -> str:
    return f"/api/stores/{store}/slots"


def susp_url(store: str) -> str:
    return f"/api/stores/{store}/suspension"


LATE_CLOSE = "18:00"
MARGIN_MS = 40
STEP_MS = 100
FINE_MS = 20
WAIT_S = 20.0
HTTP_TIMEOUT = 30.0
BOOT_S = 180.0


def env_url(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        pytest.fail(f"expected the verifier to provide {name}")
    return value.rstrip("/")


def twin() -> str:
    return env_url("APP_TWIN_URL")


def minio_down() -> str:
    return env_url("APP_MINIO_DOWN_URL")


def short_hold() -> str:
    return env_url("APP_SHORT_HOLD_URL")


def short_session() -> str:
    return env_url("APP_SHORT_SESSION_URL")


def dims(size: str) -> tuple[int, int]:
    width, height = size.split("x")
    return int(width), int(height)


def euro(cents: int) -> str:
    return f"{cents // 100},{cents % 100:02d} €"


def request_key() -> str:
    return str(uuid.uuid4())


def own_email(prefix: str = "cliente") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}@tramela.example"


def poll(check_fn: Callable[[], Any], what: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check_fn()
        if value:
            return value
    pytest.fail(f"expected: {what} (within {seconds}s)")


class Api:

    def __init__(self, base: str, email: str | None = None, password: str = PASSWORD) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        if email:
            answer = self.post("/api/session", {"email": email, "password": password})
            assert answer.status_code == 200, f"sign-in of {email}: {answer.status_code} {answer.text}"
            self.user = answer.json()["user"]

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.http.get(path, params=params or None)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        headers = {"Request-Key": key} if key else {}
        return self.http.post(path, json={} if body is None else body, headers=headers)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.http.put(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)


def ok(answer: httpx.Response, status: int = 200) -> Any:
    assert answer.status_code == status, f"{answer.request.method} {answer.request.url}: {answer.status_code} {answer.text}"
    return answer.json()


def reset_shopper(shopper: Api) -> None:
    cart = ok(shopper.get("/api/cart"))
    for line in cart["lines"]:
        ok(shopper.put(f"/api/cart/lines/{line['sku']}", {"quantity": 0}))
    if cart["hold"] and cart["hold"]["status"] == "active":
        shopper.delete(f"/api/holds/{cart['hold']['id']}")


def set_available(base: str, store: str, sku: str, available: int) -> dict:
    manager = Api(base, MANAGERS[store])
    lines = ok(manager.get(f"/api/stores/{store}/stock"))["lines"]
    line = next(item for item in lines if item["sku"] == sku)
    return ok(manager.post(f"/api/stores/{store}/stock/{sku}/count", {"on_hand": line["held"] + available}))


def heal_store(base: str, store: str) -> None:
    manager = Api(base, MANAGERS[store])
    for line in ok(manager.get(f"/api/stores/{store}/stock"))["lines"]:
        if line["on_hand"] <= 2:
            ok(manager.post(f"/api/stores/{store}/stock/{line['sku']}/count", {"on_hand": line["held"] + 20}))


def fill_cart(shopper: Api, store: str, lines: dict[str, int], area: dict | None = None) -> dict:
    reset_shopper(shopper)
    ok(shopper.put("/api/cart/area", area or FARO))
    ok(shopper.put("/api/cart/store", {"store_id": store}))
    cart = {}
    for sku, quantity in lines.items():
        cart = ok(shopper.put(f"/api/cart/lines/{sku}", {"quantity": quantity}))
    return cart


def offered_slot(person: Api, store: str) -> dict:
    days = ok(person.get(f"/api/stores/{store}/slots"))["days"]
    for day in reversed(days):
        for slot in reversed(day["slots"]):
            if slot["remaining"] > 0:
                return {**slot, "date": day["date"]}
    pytest.fail(f"GET /api/stores/{store}/slots offered no slot with room")


def new_order(base: str, email: str, store: str = "AT06", sku: str = "FITA-48", quantity: int = 1,
              customer: str | None = None, stocked: bool = False) -> dict:
    shopper = Api(base, email)
    if not stocked:
        set_available(base, store, sku, quantity + 5)
    fill_cart(shopper, store, {sku: quantity})
    hold = ok(shopper.post("/api/holds", {}), 201)
    slot = offered_slot(shopper, store)
    body = {"hold_id": hold["id"], "slot_start_utc": slot["start_utc"],
            "customer": {"name": "Cliente de teste", "email": customer or own_email()}}
    return ok(shopper.post("/api/orders", body, key=request_key()), 201)


def move_order(manager: Api, order_id: str, *states: str) -> dict:
    order = {}
    for state in states:
        order = ok(manager.post(f"/api/orders/{order_id}/transitions", {"to": state}))
    return order


def collected_order(base: str, email: str = EVA, store: str = "AT06", quantity: int = 3,
                    customer: str | None = None) -> dict:
    order = new_order(base, email, store, quantity=quantity, customer=customer)
    return move_order(Api(base, MANAGERS[store]), order["id"], "picking", "ready", "collected")


def publish(base: str, store: str, days: list[dict], effective_from: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"days": days}
    if effective_from:
        body["effective_from"] = effective_from
    return Api(base, MANAGERS[store]).put(f"/api/stores/{store}/hours", body)


def week(opens: str | None, closes: str | None) -> list[dict]:
    return [{"weekday": day, "open": opens is not None, "opens": opens, "closes": closes} for day in WEEK]


def daily() -> list[dict]:
    return week("08:00", "20:00")


def server_now(base: str) -> datetime:
    return parsedate_to_datetime(httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT).headers["date"])


def mails_to(mail: Any, email: str, expected: int = 1) -> list[dict]:
    poll(lambda: [m for m in mail.messages(settle=0) if email in addresses(m["To"])] if expected else True,
         f"a confirmation message to {email}")
    return [m for m in mail.messages() if email in addresses(m["To"])]


WATCH_JS = """
(() => {
  const ATTRS = ['data-state','data-phase','data-panel','data-counting','data-arrival','data-cluster-phase','data-viewport','data-rank'];
  window.__log = [];
  const stamp = () => ({f: performance.now(), r: document.timeline ? document.timeline.currentTime : 0});
  const push = (el, attr, value) => window.__log.push({el, attr, value, id: el.getAttribute('data-store-id'), ...stamp()});
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    for (const el of [node, ...node.querySelectorAll('*')])
      for (const attr of ATTRS) if (el.hasAttribute(attr)) push(el, attr, el.getAttribute(attr));
  };
  new MutationObserver((records) => {
    for (const m of records) {
      if (m.type === 'attributes') push(m.target, m.attributeName, m.target.getAttribute(m.attributeName));
      else {
        m.addedNodes.forEach(scan);
        m.removedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          for (const el of [n, ...n.querySelectorAll('[data-state]')])
            if (el.hasAttribute('data-state')) push(el, 'removed', 'removed');
        });
      }
    }
  }).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ATTRS});
})();
"""


@contextmanager
def screen(browser: Any, base: str, email: str | None = None, path: str = "/", size: str = DESKTOP,
           reduced: bool = False) -> Iterator[Any]:
    motion_pref = "reduce" if reduced else "no-preference"
    with open_app(browser, base + "/", reduced_motion=motion_pref) as page:
        page.add_init_script(WATCH_JS)
        width, height = dims(size)
        page.set_viewport_size({"width": width, "height": height})
        if size == PHONE:
            session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        if email:
            answer = page.request.post(base + "/api/session", data={"email": email, "password": PASSWORD})
            assert answer.status == 200, f"sign-in of {email}: {answer.status}"
        page.goto(base + path)
        yield page


def soon(page: Any, check_fn: Callable[[], Any], what: str, seconds: float = WAIT_S, step: float = STEP_MS) -> Any:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = check_fn()
            if value:
                return value
        except (AssertionError, PlaywrightError) as error:
            last = error
        advance(page, step)
    pytest.fail(f"expected: {what} (within {seconds}s; last error: {last})")


def role(scope: Any, kind: str, name: Any = None) -> Any:
    if name is None:
        return scope.get_by_role(kind)
    return scope.get_by_role(kind, name=name, exact=True) if isinstance(name, str) else scope.get_by_role(kind, name=name)


def button(scope: Any, name: Any) -> Any:
    return role(scope, "button", name)


def status(page: Any, name: str) -> Any:
    return role(page, "status", name)


def txt(locator: Any) -> str:
    return locator.inner_text(timeout=1000).strip()


def attr(locator: Any, name: str) -> str | None:
    return locator.get_attribute(name, timeout=1000)


def visible(page: Any, locator: Any, what: str = "", seconds: float = WAIT_S) -> Any:
    soon(page, lambda: locator.count() > 0 and locator.first.is_visible(), what or f"{locator} visible", seconds)
    return locator


def says(page: Any, locator: Any, copy: str, seconds: float = WAIT_S) -> None:
    soon(page, lambda: txt(locator) == copy, f"{locator} reads {copy!r}", seconds)


def has_attr(page: Any, locator: Any, name: str, value: str, seconds: float = WAIT_S) -> None:
    soon(page, lambda: attr(locator, name) == value, f"{locator} {name}={value!r}", seconds)


def focused(locator: Any) -> bool:
    return locator.evaluate("e => e === document.activeElement", timeout=1000)


def focus_inside(locator: Any) -> bool:
    return locator.evaluate("e => e.contains(document.activeElement)", timeout=1000)


def focus_is(page: Any, locator: Any, seconds: float = WAIT_S) -> None:
    soon(page, lambda: focused(locator), f"focus on {locator}", seconds)


def tab_to(page: Any, locator: Any, presses: int = 60, inside: bool = False) -> None:
    for _ in range(presses):
        if (focus_inside if inside else focused)(locator):
            return
        page.keyboard.press("Tab")
    pytest.fail(f"expected Tab to reach {locator} within {presses} presses")


def box(locator: Any) -> dict:
    found = locator.bounding_box(timeout=2000)
    assert found, f"{locator} has no box"
    return found


def settled(page: Any, locator: Any, what: str) -> None:
    soon(page, lambda: locator.evaluate(
        "e => { for (let n = e; n; n = n.parentElement) if (n.getAnimations().some(a => a.playState === 'running')) return false; return true; }"),
        f"{what} settles")


def assert_target(locator: Any) -> None:
    found = box(locator)
    if found["width"] >= MIN_TARGET - TARGET_SLACK and found["height"] >= MIN_TARGET - TARGET_SLACK:
        return
    labels = locator.evaluate("""el => ['checkbox', 'radio'].includes(el.type)
      ? [...(el.labels || [])].map(l => { const r = l.getBoundingClientRect(); return {width: r.width, height: r.height}; })
      : []""")
    assert any(r["width"] >= MIN_TARGET - TARGET_SLACK and r["height"] >= MIN_TARGET - TARGET_SLACK for r in labels), f"{locator} target {found}"


def axe_contrast(page: Any) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate(
        """options => {
          const result = {done: false, error: null, violations: []};
          window.__axeScrollPanels = () => structuredClone(result);
          axe.run(document, options).then(value => {
            result.violations = value.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target)}));
            result.done = true;
          }, error => { result.error = String(error); result.done = true; });
        }""",
        {"runOnly": {"type": "rule", "values": ["color-contrast"]}},
    )
    for _ in range(625):
        status = page.evaluate("window.__axeScrollPanels()")
        if status["done"]:
            assert status["error"] is None, status["error"]
            assert not status["violations"], f"WCAG violations: {status['violations']}"
            return
        advance(page, 16)
    raise AssertionError("axe audit did not settle under controlled time")


CLIPPED_JS = """e => {
  const r = e.getBoundingClientRect();
  let left = r.left, right = r.right, top = r.top, bottom = r.bottom;
  for (let p = e.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/hidden|clip/.test(s.overflowX + ' ' + s.overflowY)) {
      const q = p.getBoundingClientRect();
      left = Math.max(left, q.left); right = Math.min(right, q.right);
      top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom);
    }
  }
  return right - left <= 0 || bottom - top <= 0;
}"""


CONTENT_INSIDE_JS = """e => {
  const box = e.getBoundingClientRect(), nodes = [e, ...e.querySelectorAll('*')];
  const scrolls = nodes.some(n => n.scrollHeight > n.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowY));
  const fits = nodes.every(n => { const r = n.getBoundingClientRect();
    return !r.height || (r.top >= box.top - 1 && r.bottom <= box.bottom + 1); });
  return scrolls || fits;
}"""


def no_sideways(page: Any) -> None:
    width = page.viewport_size["width"]
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if not control.is_visible() or control.evaluate(CLIPPED_JS):
            continue
        control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
        found = control.bounding_box()
        assert found and found["x"] >= -1 and found["x"] + found["width"] <= width + 1, f"button off screen {found}"
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"page scrolls sideways by {overflow}px"


def track(locator: Any) -> None:
    locator.evaluate("""el => {
      window.__said = window.__said || new Map();
      const said = []; let last = el.textContent.trim();
      new MutationObserver(() => { const now = el.textContent.trim();
        if (now !== last) { said.push(now); last = now; } })
        .observe(el, {childList: true, characterData: true, subtree: true});
      window.__said.set(el, said);
    }""")


def announced(locator: Any) -> list[str]:
    return [x for x in locator.evaluate("el => window.__said.get(el)") if x]


def events_of(target: Any, name: str) -> list[dict]:
    return target.evaluate(
        "(el, a) => window.__log.filter(x => x.el === el && x.attr === a).map(({value, f, r}) => ({value, f, r}))", name)


def values_of(target: Any, name: str) -> list[str]:
    return [item["value"] for item in events_of(target, name)]


def assert_span(events: list[dict], start: str, end: str, low: float, high: float) -> None:
    first = next((item for item in events if item["value"] == start), None)
    assert first, f"no {start!r} in {events}"
    later = next((item for item in events if item["value"] == end and item["f"] >= first["f"] and item["r"] >= first["r"]), None)
    assert later, f"no {end!r} after {start!r} in {events}"
    fake, real = later["f"] - first["f"], later["r"] - first["r"]
    assert low - MARGIN_MS <= fake <= high + MARGIN_MS or low - MARGIN_MS <= real <= high + MARGIN_MS, \
        f"{start}->{end} took {fake}ms page clock, {real}ms timeline; published {low}-{high}ms"


def sign_in_keys(page: Any, email: str, password: str = PASSWORD) -> None:
    box_email = role(page, "textbox", "Email")
    visible(page, box_email)
    focus_is(page, box_email)
    page.keyboard.type(email)
    page.keyboard.press("Tab")
    page.keyboard.type(password)
    page.keyboard.press("Enter")


def activate(page: Any, locator: Any, size: str) -> None:
    if size == PHONE:
        tap(locator)
    else:
        locator.focus()
        page.keyboard.press("Enter")


def estate_map(page: Any) -> Any:
    return role(page, "region", "Estate map")


def marker(page: Any, code: str) -> Any:
    return estate_map(page).locator(f'[data-store-id="{code}"]')


def shops_row(page: Any, code: str) -> Any:
    return role(page, "table", "Shops").locator(f'[data-store-id="{code}"]')


def view(page: Any) -> tuple[float, float, float]:
    lon, lat, zoom = attr(estate_map(page), "data-viewport").split(",")
    return float(lon), float(lat), float(zoom)


def estate_ready(page: Any) -> None:
    visible(page, estate_map(page), "region Estate map")
    soon(page, lambda: attr(estate_map(page), "data-store-count") not in (None, ""), "map data-store-count set")


def zoom_to_markers(page: Any) -> None:
    estate_map(page).focus()
    page.keyboard.press("+")
    page.keyboard.press("+")
    soon(page, lambda: view(page)[2] >= 3, "zoom 3 reached", step=FINE_MS)
    soon(page, lambda: all(attr(item, "data-cluster-phase") == "placed"
                           for item in estate_map(page).locator("[data-store-id]").all()),
         "markers placed at zoom 3", step=FINE_MS)


def checkout_dialog(page: Any) -> Any:
    return role(page, "dialog", "Checkout")


def open_checkout(page: Any) -> Any:
    opener = button(page, "Checkout")
    visible(page, opener)
    click(opener)
    dialog = checkout_dialog(page)
    visible(page, dialog)
    has_attr(page, dialog, "data-state", "open")
    return dialog


def press_hold(page: Any, name: str = "Hold items") -> None:
    click(button(checkout_dialog(page), name))
    visible(page, role(checkout_dialog(page), "timer", "Hold time left"))


def choose_slot(page: Any, date: str | None = None, time_local: str | None = None) -> None:
    dialog = checkout_dialog(page)
    days = role(dialog, "radiogroup", "Collection day")
    day = days.get_by_role("radio", name=re.compile(re.escape(date) + "$" if date else r"\d{4}-\d{2}-\d{2}$"))
    visible(page, day)
    check(day.first)
    times = role(dialog, "radiogroup", "Collection time")
    pick = times.get_by_role("radio", name=time_local or re.compile(r"^\d\d:\d\d$"), exact=bool(time_local))
    visible(page, pick)
    check(pick.first)


def fill_contact(page: Any, name: str, email: str) -> None:
    dialog = checkout_dialog(page)
    fill(role(dialog, "textbox", "Full name"), name)
    fill(role(dialog, "textbox", "Email"), email)


def placements(page: Any) -> list[tuple[str, Any]]:
    sent: list[tuple[str, Any]] = []

    def record(request: Any) -> None:
        if request.method == "POST" and urlparse(request.url).path == "/api/orders":
            sent.append((request.headers.get("request-key"), request.post_data_json))

    page.on("request", record)
    return sent


def order_page_id(page: Any) -> str:
    soon(page, lambda: re.search(r"/orders/[^/?]+$", page.url), "address /orders/<order id>")
    return page.url.rsplit("/", 1)[1]


def not_found_screen(page: Any, answer: Any) -> None:
    assert answer.status == 404, f"expected 404, got {answer.status}"
    heading = role(page, "heading", "We couldn't find that page.")
    visible(page, heading, "not-found heading")
    soon(page, lambda: heading.evaluate("e => e.tagName === 'H1' || e.getAttribute('aria-level') === '1'"), "level-1 heading")
    focus_is(page, heading)


def section_open(page: Any, name: str, size: str) -> None:
    if size == PHONE:
        toggle = button(page, name)
        visible(page, toggle)
        if attr(toggle, "aria-expanded") != "true":
            click(toggle)
            has_attr(page, toggle, "aria-expanded", "true")


def touch_drag(page: Any, start: tuple[float, float], end: tuple[float, float], moves: int = 5) -> None:
    cdp = session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": start[0], "y": start[1], "id": 1}]})
    for index in range(1, moves + 1):
        x = start[0] + (end[0] - start[0]) * index / moves
        y = start[1] + (end[1] - start[1]) * index / moves
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y, "id": 1}]})
        advance(page, 16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def pinch(page: Any, centre: tuple[float, float], start_gap: float, end_gap: float) -> None:
    cdp = session(page)
    cx, cy = centre
    pair = lambda gap: [{"x": cx - gap / 2, "y": cy, "id": 1}, {"x": cx + gap / 2, "y": cy, "id": 2}]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pair(start_gap)})
    for index in range(1, 7):
        gap = start_gap + (end_gap - start_gap) * index / 6
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pair(gap)})
        advance(page, 16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


class Relay:
    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.up = True
        self.conns: list[socket.socket] = []
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(64)
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            if not self.up:
                client.close()
                continue
            try:
                server = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                client.close()
                continue
            self.conns += [client, server]
            for a, b in ((client, server), (server, client)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(source: socket.socket, sink: socket.socket) -> None:
        try:
            while data := source.recv(65536):
                sink.sendall(data)
        except OSError:
            pass
        finally:
            for item in (source, sink):
                try:
                    item.close()
                except OSError:
                    pass

    def set_up(self, value: bool) -> None:
        self.up = value
        if not value:
            for item in self.conns:
                try:
                    item.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            self.conns.clear()

    def stop(self) -> None:
        self.set_up(False)
        try:
            self.listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.listener.close()


class RelayCopy:
    def __init__(self, url: str, relay: Relay) -> None:
        self.url = url
        self.relay = relay

    def storage(self, up: bool) -> None:
        self.relay.set_up(up)
        wanted = "up" if up else "down"
        poll(lambda: httpx.get(self.url + "/api/status", timeout=HTTP_TIMEOUT).json()["storage"] == wanted,
             f"GET /api/status reports storage {wanted}", RECOVERY_S)


@pytest.fixture(scope="module")
def relay_copy() -> Iterator[RelayCopy]:
    endpoint = urlparse(os.environ["S3_ENDPOINT"])
    relay = Relay(endpoint.hostname or "127.0.0.1", endpoint.port or 9000)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), APP_PUBLIC_URL=url,
               S3_ENDPOINT=f"http://127.0.0.1:{relay.port}",
               DATABASE_URL=os.environ["DATABASE_URL"] + "_minio_down",
               S3_BUCKET=os.environ["S3_BUCKET"] + "-relay")
    serve = json.loads((DEPLOYED_APP / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    process = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=log, start_new_session=True)

    def healthy() -> bool:
        if process.poll() is not None:
            pytest.fail(f"extra copy exited: {Path(log.name).read_text()[-2000:]}")
        try:
            return httpx.get(url + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    poll(healthy, f"extra copy healthy; log: {log.name}", BOOT_S)
    try:
        yield RelayCopy(url, relay)
    finally:
        try:
            os.killpg(process.pid, 15)
        except ProcessLookupError:
            pass
        process.wait(timeout=30)
        relay.stop()


ROLE_LANDINGS = [(LEAD, "/estate"), (CARE, "/care"), (ANA, "/catalogue"), (TIAGO, "/shop/AT05")]


def landing_mark(page: Any, route: str) -> Any:
    if route == "/estate":
        return estate_map(page)
    if route == "/care":
        return role(page, "searchbox", "Find order")
    if route == "/catalogue":
        return role(page, "searchbox", "Search products")
    return role(page, "table", "Orders")


def choose_and_leave(locator: Any, choice: str) -> None:
    center(locator)
    locator.focus()
    picked = locator.evaluate(
        """(e, v) => {
            if (e.tagName !== 'SELECT') return null;
            const label = o => (o.label || o.text || '').trim();
            const o = [...e.options].find(o => label(o) === v) || [...e.options].find(o => o.value === v);
            if (!o) return [...e.options].map(label);
            e.value = o.value;
            e.dispatchEvent(new Event('input', {bubbles: true}));
            e.dispatchEvent(new Event('change', {bubbles: true}));
            return true;
        }""",
        choice,
    )
    if picked is None:
        locator.click()
        locator.page.get_by_role("option", name=choice, exact=True).first.click()
        return
    assert picked is True, f"no option {choice!r} in the dropdown (options: {picked})"


def test_wf_sign_in_landing_routes(browser: Any, app_url: str) -> None:
    for size in SIZES:
        for email, route in ROLE_LANDINGS:
            with screen(browser, app_url, None, "/sign-in", size) as page:
                if size == PHONE:
                    fill(role(page, "textbox", "Email"), email)
                    fill(role(page, "textbox", "Password"), PASSWORD)
                    tap(button(page, "Sign in"))
                else:
                    sign_in_keys(page, email)
                soon(page, lambda: urlparse(page.url).path == route, f"address {route} after sign-in at {size}")
                visible(page, landing_mark(page, route), f"{route} screen")
                page.reload()
                assert urlparse(page.url).path == route
                visible(page, landing_mark(page, route), f"{route} after reload")
                page.goto(app_url + route)
                visible(page, landing_mark(page, route), f"{route} when opened")
                if email == TIAGO:
                    if size == PHONE:
                        click(button(page, "Menu"))
                    choose_and_leave(role(page, "combobox", "Shop"), "Loja Olhão")
                    soon(page, lambda: urlparse(page.url).path == "/shop/AT06", "address /shop/AT06 after switching")
                    page.reload()
                    visible(page, landing_mark(page, "/shop/AT06"), "/shop/AT06 after reload")
    with screen(browser, app_url, None, "/sign-in?next=%2Fcare", DESKTOP) as page:
        sign_in_keys(page, ANA)
        soon(page, lambda: urlparse(page.url).path == "/catalogue", "next of another role is ignored")
    with screen(browser, app_url, None, "/sign-in?next=%2Festate%3Fstate%3Dopen", DESKTOP) as page:
        sign_in_keys(page, LEAD)
        soon(page, lambda: page.url.endswith("/estate?state=open"), "next of the role is honoured")


def test_session_api_and_lifetime() -> None:
    base = short_session()
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    answer = anon.get("/api/me")
    assert answer.status_code == 401 and answer.json() == {"code": "unauthenticated"}
    person = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    answer = person.post("/api/session", json={"email": LEAD, "password": PASSWORD})
    body = ok(answer)
    cookie = answer.headers["set-cookie"]
    assert cookie.startswith("tramela_session=") and "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    assert body["landing"] == "/estate"
    assert body["user"]["role"] == "lead" and body["user"]["operator_id"] == "atlantico" and body["user"]["email"] == LEAD
    me = ok(person.get("/api/me"))
    assert me["operator"] == {"id": "atlantico", "name": "Grupo Atlântico Ferragens"} and me["store_ids"] == []
    assert ok(Api(base, TIAGO).get("/api/me"))["store_ids"] == ["AT05", "AT06"]
    expires = datetime.fromisoformat(me["session_expires_at"].replace("Z", "+00:00"))
    left = (expires - server_now(base)).total_seconds()
    assert 0 < left <= SHORT_SESSION + 1, f"session_expires_at is {left}s away"
    ended = Api(base, ANA)
    assert ended.delete("/api/session").status_code == 204
    assert ended.get("/api/me").status_code == 401
    started = time.monotonic()
    poll(lambda: person.get("/api/me").status_code == 401, "the session ends a fixed time after sign-in", SHORT_SESSION + 10)
    assert time.monotonic() - started <= SHORT_SESSION + 5
    answer = person.get("/api/stores")
    assert answer.status_code == 401 and answer.json() == {"code": "unauthenticated"}
    for path in ("/cart?checkout=open", "/estate", f"/orders/{UNKNOWN_UUID}", "/shop/ZZ99", "/products/NOPE"):
        answer = anon.get(path, follow_redirects=False)
        assert answer.status_code == 302, f"{path}: {answer.status_code}"
        location = answer.headers["location"]
        assert location.startswith("/sign-in?next=%2F") and unquote(location.split("next=", 1)[1]) == path
    assert anon.get("/api/health").json() == {"status": "ok"}


def test_operator_isolation_interleaved(browser: Any, app_url: str) -> None:
    people = [(Api(app_url, LEAD), "AT", "atlantico"), (Api(twin(), LEAD_CL), "CL", "casalusa"),
              (Api(twin(), LEAD), "AT", "atlantico"), (Api(app_url, LEAD_CL), "CL", "casalusa")]
    prefix_of = {"atlantico": "AT", "casalusa": "CL"}
    own = new_order(app_url, EVA)

    def one(item: tuple[Api, str, str]) -> None:
        person, prefix, operator = item
        stores = ok(person.get("/api/stores"))
        assert stores["count"] == len(stores["stores"]) and all(s["id"].startswith(prefix) for s in stores["stores"])
        found = ok(person.get("/api/stores", q="Faro"))
        assert all(s["id"].startswith(prefix) for s in found["stores"])
        products = ok(person.get("/api/products"))["products"]
        assert all(p["sku"].startswith("CL-") == (prefix == "CL") for p in products)
        orders = ok(person.get("/api/orders", limit=100))["orders"]
        assert all(o["number"].startswith(prefix_of[operator] + "-") for o in orders)
        review = ok(person.get("/api/estate/review"))["events"]
        assert all(e["store_id"].startswith(prefix) for e in review)
        assert ok(person.get("/api/me"))["operator"]["id"] == operator

    with ThreadPoolExecutor(12) as pool:
        list(pool.map(one, people * 12))
    assert ok(Api(app_url, LEAD_CL).get("/api/orders", q=own["number"]))["count"] == 0
    with screen(browser, app_url, LEAD_CL, "/estate", PHONE) as page:
        estate_ready(page)
        assert attr(estate_map(page), "data-store-count") == "10"
        click(button(page, "Menu"))
        visible(page, role(page, "dialog", "Menu").get_by_text("Casa Lusa Ferragens"), "operator name in the menu")
        page_text = page.evaluate("document.body.innerText")
        assert "Atlântico" not in page_text and "Loja " not in page_text
        assert all((attr(m, "data-store-id") or "").startswith("CL") for m in tagged(estate_map(page), "data-store-id").all())


def test_foreign_ids_answer_as_never_existing(browser: Any, app_url: str) -> None:
    order = collected_order(app_url)
    manager = Api(app_url, TIAGO)
    ret = ok(manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": "Teste"}), 201)
    shopper = Api(app_url, EVA)
    set_available(app_url, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    hold = ok(shopper.post("/api/holds", {}), 201)
    foreign = Api(app_url, LEAD_CL)
    diogo = Api(app_url, DIOGO)
    rui = Api(app_url, RUI)
    care = Api(app_url, CARE)
    cases: list[tuple[Api, str, str, Any, str]] = [
        (foreign, "GET", f"/api/stores/{'AT01'}", None, "/api/stores/ZZ99"),
        (foreign, "GET", "/api/stores/AT01/hours", None, "/api/stores/ZZ99/hours"),
        (foreign, "GET", "/api/products/VM-750", None, "/api/products/NOPE-1"),
        (foreign, "GET", f"/api/orders/{order['id']}", None, f"/api/orders/{UNKNOWN_UUID}"),
        (foreign, "GET", f"/api/orders/{order['id']}/document", None, f"/api/orders/{UNKNOWN_UUID}/document"),
        (foreign, "POST", f"/api/returns/{ret['id']}/transitions", {"to": "received"}, f"/api/returns/{UNKNOWN_UUID}/transitions"),
        (diogo, "GET", f"/api/holds/{hold['id']}", None, f"/api/holds/{UNKNOWN_UUID}"),
        (Api(app_url, ANA), "GET", f"/api/holds/{hold['id']}", None, f"/api/holds/{UNKNOWN_UUID}"),
        (Api(app_url, ANA), "GET", f"/api/orders/{order['id']}", None, f"/api/orders/{UNKNOWN_UUID}"),
        (care, "GET", "/api/stores/AT05/stock", None, "/api/stores/ZZ99/stock"),
        (rui, "GET", "/api/stores/AT05/stock", None, "/api/stores/ZZ99/stock"),
        (rui, "GET", f"/api/orders/{order['id']}", None, "/api/orders/not-a-uuid"),
    ]
    for person, method, foreign_path, body, unknown_path in cases:
        call = (lambda p: person.http.request(method, p, json=body)) if body else (lambda p: person.http.request(method, p))
        seen, never = call(foreign_path), call(unknown_path)
        assert seen.status_code == 404 and seen.json() == {"code": "not_found"}, f"{foreign_path}: {seen.status_code} {seen.text}"
        assert never.status_code == 404 and never.content == seen.content
        strip = lambda r: {k: v for k, v in r.headers.items() if k.lower() != "date"}
        assert strip(seen) == strip(never), f"{foreign_path} headers differ"
    till = rui.post(till_url("AT05"), {"sku": "FITA-48", "quantity": 1}, key=request_key())
    assert till.status_code == 404 and till.json() == {"code": "not_found"}
    nested = diogo.put("/api/cart/store", {"store_id": "AT01"})
    assert nested.status_code == 404 and nested.content == diogo.put("/api/cart/store", {"store_id": "ZZ99"}).content
    take = lambda p: median([_timed(foreign, p) for _ in range(5)])
    slow, fast = take(f"/api/orders/{order['id']}"), take(f"/api/orders/{UNKNOWN_UUID}")
    assert max(slow, fast) <= 10 * min(slow, fast) + LIST_BUDGET_S / 10, f"response times {slow} and {fast}"
    reset_shopper(shopper)
    with screen(browser, app_url, DIOGO, "/catalogue", DESKTOP) as page:
        not_found_screen(page, page.goto(f"{app_url}/orders/{order['id']}"))
    with screen(browser, app_url, RUI, "/shop/AT01", DESKTOP) as page:
        not_found_screen(page, page.goto(f"{app_url}/shop/AT05"))


def _timed(person: Api, path: str) -> float:
    started = time.monotonic()
    person.get(path)
    return time.monotonic() - started


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_wf_sign_in_lockout(browser: Any, app_url: str, size: str) -> None:
    locked = own_email("bloqueado")
    for index in range(5):
        base = app_url if index % 2 else twin()
        answer = Api(base).post("/api/session", {"email": f"  {locked.upper()} ", "password": "errada"})
        assert answer.status_code == 401 and answer.json() == {"code": "invalid_credentials"}
    answer = Api(app_url).post("/api/session", {"email": locked, "password": "errada"})
    assert answer.status_code == 429 and answer.json()["code"] == "too_many_attempts"
    retry = answer.json()["retry_after"]
    assert isinstance(retry, int) and 0 < retry <= 900 and answer.headers["retry-after"] == str(retry)

    base = minio_down()
    known = CARE_CL
    unknown = own_email("desconhecido")
    for _ in range(4):
        pair = [Api(base).post("/api/session", {"email": e, "password": "errada"}) for e in (known, unknown)]
        assert pair[0].content == pair[1].content and pair[0].status_code == 401
    assert Api(base).post("/api/session", {"email": known, "password": PASSWORD}).status_code == 200, "a successful sign-in clears the failures"
    Api(base).post("/api/session", {"email": unknown, "password": "errada"})
    assert Api(base).post("/api/session", {"email": unknown, "password": PASSWORD}).json()["code"] == "too_many_attempts"

    victim = own_email("ecra")
    for _ in range(4):
        Api(app_url).post("/api/session", {"email": victim, "password": "errada"})
    with screen(browser, app_url, None, "/sign-in", size) as page:
        fill(role(page, "textbox", "Email"), victim)
        fill(role(page, "textbox", "Password"), "errada")
        page.keyboard.press("Enter")
        says(page, role(page, "alert"), "Email or password is wrong.")
        assert role(page, "textbox", "Password").input_value() == ""
        focus_is(page, role(page, "textbox", "Email"))
        fill(role(page, "textbox", "Password"), "errada")
        with held(page, "**/api/session") as release:
            page.keyboard.press("Enter")
            release()
        locked_answer = Api(app_url).post("/api/session", {"email": victim, "password": PASSWORD}).json()
        timer = role(page, "timer", "Sign-in locked")
        visible(page, timer)
        minutes = math.ceil(locked_answer["retry_after"] / 60)
        says(page, role(page, "alert"), f"Too many attempts. Try again in {minutes} minutes.")
        assert role(page, "textbox", "Password").input_value() == ""
        focus_is(page, role(page, "alert"))
        assert attr(button(page, "Sign in"), "aria-disabled") == "true"
        shown = int(attr(timer, "data-seconds-left"))
        assert 0 < shown <= 900 and txt(timer) == f"{shown} s"
        advance(page, 3000)
        soon(page, lambda: int(attr(timer, "data-seconds-left")) == shown - 3, "the lock timer drops one per second")
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if r.url.endswith("/api/session") else None)
        role(page, "textbox", "Password").focus()
        page.keyboard.press("Enter")
        locked_button = button(page, "Sign in")
        locked_button.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
        spot = box(locked_button)
        page.mouse.click(spot["x"] + spot["width"] / 2, spot["y"] + spot["height"] / 2)
        assert sent == [], "a locked Sign in sent a request"


def test_wf_sign_in_switch_person(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        visible(page, page.get_by_text("Grupo Atlântico Ferragens"))
        click(role(page, "checkbox", "Open"))
        soon(page, lambda: "state=" in page.url, "the filter applied")
        before_nav: list[int] = []
        page.on("framenavigated", lambda f: before_nav.append(1) if f == page.main_frame else None)
        page.evaluate("window.__sameTab = 'yes'")
        stale: list[Any] = []
        page.route("**/api/stores*", lambda route: stale.append(route))
        click(role(page, "checkbox", "Closed"))
        soon(page, lambda: stale, "a shop list request in flight")
        click(button(page, "Sign out"))
        soon(page, lambda: urlparse(page.url).path == "/sign-in", "address /sign-in after Sign out")
        page.unroute("**/api/stores*")
        fill(role(page, "textbox", "Email"), LEAD_CL)
        fill(role(page, "textbox", "Password"), PASSWORD)
        click(button(page, "Sign in"))
        soon(page, lambda: urlparse(page.url).path == "/estate", "address /estate for the next person")
        assert page.evaluate("window.__sameTab") == "yes", "the app reloaded the tab"
        visible(page, page.get_by_text("Casa Lusa Ferragens"))
        soon(page, lambda: attr(estate_map(page), "data-store-count") == "10", "Casa Lusa's 10 shops")
        for route in stale:
            route.fallback()
        for _ in range(10):
            advance(page, STEP_MS)
        body = page.evaluate("document.body.innerText")
        assert "Grupo Atlântico" not in body and "Loja " not in body, "first person's data still on screen"
        codes = [attr(m, "data-store-id") for m in tagged(estate_map(page), "data-store-id").all()]
        assert codes and all(code.startswith("CL") for code in codes), codes
        assert attr(estate_map(page), "data-store-count") == "10"
        saved = page.evaluate("JSON.stringify(Object.entries(sessionStorage).concat(Object.entries(localStorage)))")
        assert "Loja " not in saved and "AT0" not in saved, "saved state keeps the first person's shops"


def test_sign_in_and_menu_keyboard(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, None, "/sign-in", DESKTOP) as page:
        focus_is(page, role(page, "textbox", "Email"))
        page.keyboard.press("Shift+Tab")
        focus_is(page, role(page, "link", "Tramela Estate"))
        assert tab_order(page, 3) == ["Email", "Password", "Sign in"]
        fill(role(page, "textbox", "Email"), own_email("erro"))
        fill(role(page, "textbox", "Password"), "errada")
        page.keyboard.press("Enter")
        says(page, role(page, "alert"), "Email or password is wrong.")
        assert role(page, "textbox", "Password").input_value() == ""
        focus_is(page, role(page, "textbox", "Email"))
    for reduced in (False, True):
        with screen(browser, app_url, LEAD, "/estate", PHONE, reduced=reduced) as page:
            estate_ready(page)
            opener = button(page, "Menu")
            assert_target(opener)
            assert attr(opener, "aria-expanded") == "false"
            assert role(page, "dialog", "Menu").count() == 0
            assert "Sign out" not in tab_order(page, 6), "closed menu reachable by Tab"
            opener.focus()
            page.keyboard.press("Enter")
            menu = role(page, "dialog", "Menu")
            visible(page, menu)
            handle = menu.element_handle()
            has_attr(page, menu, "data-state", "open")
            assert attr(opener, "aria-expanded") == "true"
            soon(page, lambda: focus_inside(menu), "focus moves into the menu")
            first = page.evaluate("document.activeElement.textContent")
            names = tab_order(page, 6)
            assert "Close menu" in names and "Sign out" in names
            assert all(n in ("Close menu", "Sign out") or n == first.strip() for n in names), f"Tab left the menu: {names}"
            box_menu = box(menu)
            assert box_menu["width"] == 375
            page.keyboard.press("Escape")
            focus_is(page, opener)
            soon(page, lambda: role(page, "dialog", "Menu").count() == 0, "menu closed", step=FINE_MS)
            states = values_of(handle, "data-state")
            if reduced:
                assert "opening" not in states and "closing" not in states, states
            else:
                assert "opening" in states and "closing" in states, states
                assert_span(events_of(handle, "data-state"), "opening", "open", STATE_MIN_MS, STATE_MAX_MS)
            assert "Sign out" not in tab_order(page, 6)
            click(opener)
            visible(page, role(page, "dialog", "Menu"))
            click(button(page, "Close menu"))
            focus_is(page, opener)


def test_sign_in_reload_keeps(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, None, "/sign-in?next=%2Fcatalogue", DESKTOP) as page:
        email = own_email("recarga")
        fill(role(page, "textbox", "Email"), email)
        fill(role(page, "textbox", "Password"), "errada")
        page.keyboard.press("Enter")
        says(page, role(page, "alert"), "Email or password is wrong.")
        fill(role(page, "textbox", "Password"), "secreta")
        page.keyboard.press("Tab") if focused(role(page, "textbox", "Email")) else None
        role(page, "textbox", "Password").focus()
        page.reload()
        visible(page, role(page, "textbox", "Email"))
        soon(page, lambda: role(page, "textbox", "Email").input_value() == email, "typed email kept")
        assert role(page, "textbox", "Password").input_value() == ""
        assert unquote(page.url.split("next=", 1)[1]) == "/catalogue"
        focus_is(page, role(page, "textbox", "Password"))
        alert = role(page, "alert")
        says(page, alert, "Email or password is wrong.")
        track(alert)
        for _ in range(10):
            advance(page, 500)
        assert announced(alert) == [], "alert text re-inserted by a repaint"
        assert txt(alert) == "Email or password is wrong."
        fill(role(page, "textbox", "Password"), PASSWORD)
        fill(role(page, "textbox", "Email"), ANA)
        click(button(page, "Sign in"))
        soon(page, lambda: urlparse(page.url).path == "/catalogue", "next still honoured after reload")


def test_map_markers_and_isolation(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    listing = ok(lead.get("/api/stores"))
    with screen(browser, app_url, LEAD, "/estate", PHONE) as page:
        estate_ready(page)
        assert attr(estate_map(page), "data-store-count") == str(listing["count"])
        zoom_to_markers(page)
        markers = tagged(estate_map(page), "data-store-id")
        assert sorted(attr(m, "data-store-id") for m in markers.all()) == sorted(s["id"] for s in listing["stores"])
        for item in markers.all():
            if item.is_visible():
                assert_target(item)
        legend = role(page, "list", "Map legend")
        assert role(legend, "listitem").count() == 5
        legend_text = txt(legend)
        for label in STATE_LABELS.values():
            assert label in legend_text
        for item in role(legend, "listitem").all():
            found = box(item)
            assert found["x"] >= 0 and found["x"] + found["width"] <= 375, "legend item overflows"
        drawn = decode(capture(estate_map(page)))
        assert drawn.variance() > 0, "the map shows a blank field"
        lon, lat, zoom = view(page)
        estate_map(page).focus()
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        advance(page, STEP_MS)
        panned = f"{lon - 2 * 40 / (31 * zoom):.4f},{lat:.4f},{zoom:.2f}"
        soon(page, lambda: attr(estate_map(page), "data-viewport") == panned, f"data-viewport {panned} after two Arrow Left presses")
    with screen(browser, app_url, LEAD_CL, "/estate?q=faro", DESKTOP) as page:
        estate_ready(page)
        found = ok(Api(app_url, LEAD_CL).get("/api/stores", q="faro"))
        soon(page, lambda: attr(estate_map(page), "data-store-count") == str(found["count"]), "filtered count")
        assert [attr(m, "data-store-id") for m in tagged(estate_map(page), "data-store-id").all()] == ["CL08"]
        assert "AT05" not in [attr(r, "data-store-id") for r in tagged(role(page, "table", "Shops"), "data-store-id").all()]


TEXT_BOXES_JS = """e => {
  const box = e.getBoundingClientRect(), boxes = [];
  const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) boxes.push([r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top]);
  }
  return boxes;
}"""


def near(first: tuple[int, int, int], second: tuple[int, int, int]) -> bool:
    return sum(abs(a - b) for a, b in zip(first, second)) <= 40


def painted_colours(locator: Any) -> dict[tuple[int, int, int], float]:
    locator.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    holes = locator.evaluate(TEXT_BOXES_JS)
    pixels = decode(capture(locator))
    binned = [tuple(min(255, round(value / 8) * 8) for value in pixels.rgb[i:i + 3]) for i in range(0, len(pixels.rgb), 3)]
    edge = [binned[y * pixels.width + x] for y in range(pixels.height) for x in range(pixels.width)
            if x in (0, pixels.width - 1) or y in (0, pixels.height - 1)]
    field = Counter(edge).most_common(1)[0][0]
    counts = Counter(
        colour for index, colour in enumerate(binned)
        if not near(colour, field) and not any(
            left - 2 <= index % pixels.width <= right + 2 and top - 2 <= index // pixels.width <= bottom + 2
            for left, top, right, bottom in holes))
    total = sum(counts.values())
    assert total, "the element paints nothing beyond its text and field"
    return {colour: count / total for colour, count in counts.items() if count / total >= 0.06}


def state_fills(swatches: dict[str, dict[tuple[int, int, int], float]]) -> dict[str, tuple[int, int, int]]:
    common = [colour for colour in next(iter(swatches.values()))
              if all(any(near(colour, other) for other in colours) for colours in swatches.values())]
    fills = {}
    for state, colours in swatches.items():
        own = sorted((c for c in colours if not any(near(c, shared) for shared in common)), key=colours.get, reverse=True)
        assert own, f"the {state} swatch has no colour that the other swatches do not all share"
        fills[state] = own[0]
    for first, second in combinations(fills, 2):
        assert not near(fills[first], fills[second]), f"the {first} and {second} swatches share one fill"
    return fills


def shows(fill: tuple[int, int, int], colours: dict[tuple[int, int, int], float]) -> bool:
    return any(near(fill, colour) for colour in colours)


def most_isolated(stores: list[dict], state: str) -> dict:
    def gap(shop: dict) -> float:
        return min((((shop["lon"] - other["lon"]) * 31 * 6) ** 2 + ((shop["lat"] - other["lat"]) * 40 * 6) ** 2) ** 0.5
                   for other in stores if other["id"] != shop["id"])
    return max((shop for shop in stores if shop["display_state"] == state), key=gap)


def test_state_definition_shared(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    stores = ok(lead.get("/api/stores"))["stores"]
    with screen(browser, app_url, LEAD, "/estate", DESKTOP, reduced=True) as page:
        estate_ready(page)
        zoom_to_markers(page)
        legend = role(page, "list", "Map legend")
        items = role(legend, "listitem").all()
        assert len(items) == 5
        swatches = {}
        for state, label in STATE_LABELS.items():
            item = next(i for i in items if txt(i).startswith(label))
            figure = tagged(item, "data-figure", "legend-count")
            soon(page, lambda: attr(figure, "data-value") == str(sum(s["display_state"] == state for s in stores)),
                 f"legend count of {state}")
            swatches[state] = painted_colours(item)
        fills = state_fills(swatches)
        for shop in stores:
            row = shops_row(page, shop["id"])
            assert attr(row, "data-marker-state") == shop["display_state"]
            assert attr(marker(page, shop["id"]), "data-marker-state") == shop["display_state"]
            assert STATE_LABELS[shop["display_state"]] in txt(row), "the table state has no word"
            assert button(page, f"Open {shop['name']}, {STATE_WORDS[shop['display_state']]}, critical lines: {shop['critical_lines']}").count() == 1
        axe(page)
        for state in sorted({shop["display_state"] for shop in stores}):
            shop = most_isolated(stores, state)
            cell = shops_row(page, shop["id"]).get_by_role("cell").filter(has_text=re.compile(rf"^\s*{re.escape(STATE_LABELS[state])}\s*$")).first
            assert shows(fills[state], painted_colours(cell)), f"the {state} table sample does not use the {state} legend fill"
            click(button(page, f"Details for {shop['name']}"))
            soon(page, lambda: attr(estate_map(page), "data-phase") == "settled", f"map settled on {shop['name']}")
            assert shows(fills[state], painted_colours(marker(page, shop["id"]))), f"the {state} marker does not use the {state} legend fill"
            page.keyboard.press("Escape")
            soon(page, lambda: attr(estate_map(page), "data-panel") == "closed", "detail panel closed")


def test_display_state_from_server_clock(browser: Any, app_url: str) -> None:
    base = app_url
    heal_store(base, "AT11")
    lead = Api(base, LEAD)
    sofia_store = "/api/stores/AT11"
    try:
        ok(publish(base, "AT11", week(None, None)))
        shop = ok(lead.get(sofia_store))
        assert shop["display_state"] == "closed" and shop["closes_local"] is None
        now = server_now(base).astimezone(ZoneInfo("Atlantic/Azores"))
        minutes = now.hour * 60 + now.minute
        boundary = minutes - minutes % 30
        fmt = lambda m: f"{m // 60:02d}:{m % 60:02d}"
        if 60 <= boundary <= 21 * 60:
            ok(publish(base, "AT11", week(fmt(boundary - 60), fmt(boundary + 30))))
            shop = ok(lead.get(sofia_store))
            assert shop["display_state"] == "closing_soon", f"Azores local {now}: {shop}"
            assert shop["closes_local"] == fmt(boundary + 30)
            ok(publish(base, "AT11", week(fmt(boundary - 60), fmt(boundary + 120))))
            shop = ok(lead.get(sofia_store))
            assert shop["display_state"] == "open", f"Azores local {now}: {shop}"
        ok(publish(base, "AT11", daily()))
        set_available(base, "AT11", "VM-750", 2)
        assert ok(lead.get(sofia_store))["display_state"] == "stock_critical"
        ok(lead.post(f"{sofia_store}/suspension", {"suspended": True, "reason": "Teste"}))
        assert ok(lead.get(sofia_store))["display_state"] == "suspended"
        ok(lead.post(f"{sofia_store}/suspension", {"suspended": False}))
        heal_store(base, "AT11")
        now = server_now(base).astimezone(ZoneInfo("Atlantic/Azores"))
        minutes = now.hour * 60 + now.minute
        boundary = minutes - minutes % 30
        if 60 <= boundary <= 21 * 60:
            ok(publish(base, "AT11", week(fmt(boundary - 60), fmt(boundary + 120))))
            assert ok(lead.get(sofia_store))["display_state"] == "open", f"Azores local {now}"
        else:
            assert ok(lead.get(sofia_store))["display_state"] == "closed", f"Azores local {now}"
        with screen(browser, base, LEAD, "/", DESKTOP) as page:
            page.clock.set_system_time(server_now(base) + timedelta(hours=12))
            page.goto(base + "/estate")
            estate_ready(page)
            zoom_to_markers(page)
            for shop in ok(lead.get("/api/stores"))["stores"]:
                has_attr(page, marker(page, shop["id"]), "data-marker-state", shop["display_state"])
                has_attr(page, shops_row(page, shop["id"]), "data-marker-state", shop["display_state"])
                if shop["closes_local"]:
                    assert shop["closes_local"] in txt(shops_row(page, shop["id"]))
    finally:
        lead.post(f"{sofia_store}/suspension", {"suspended": False})
        publish(base, "AT11", daily())


def test_map_limits_glide_clusters(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        region = estate_map(page)
        assert attr(region, "data-viewport") == "-18.7500,39.5000,1.00"
        assert attr(region, "data-phase") == "idle" and attr(region, "data-motion") == "full"
        expected = {"centro": ("Centro", 4), "sul": ("Sul", 3), "norte": ("Norte", 3)}
        for slug, (name, count) in expected.items():
            cluster = button(page, f"Cluster of {count} shops in {name}, zoom in")
            visible(page, cluster)
            assert attr(cluster, "data-cluster-count") == str(count) and attr(cluster, "data-region") == slug
        assert sum(m.is_visible() for m in marker(page, "AT11").all()) == 1, "a lone shop keeps its marker"
        assert attr(marker(page, "AT05"), "data-cluster-phase") == "clustered"
        region.focus()
        page.keyboard.press("ArrowRight")
        assert attr(region, "data-viewport") == "-17.4597,39.5000,1.00"
        assert attr(region, "data-phase") == "settled"
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowUp")
        assert attr(region, "data-viewport") == "-18.7500,40.5000,1.00"
        page.keyboard.press("ArrowDown")
        for key, value in (("ArrowRight", "-6.0000"), ("ArrowLeft", "-31.5000")):
            for _ in range(25):
                page.keyboard.press(key)
            assert attr(region, "data-viewport").split(",")[0] == value
        for key, value in (("ArrowUp", "42.2000"), ("ArrowDown", "36.8000")):
            for _ in range(10):
                page.keyboard.press(key)
            assert attr(region, "data-viewport").split(",")[1] == value
        lon_lat = attr(region, "data-viewport").rsplit(",", 1)[0]
        for key, value in (("+", "8.00"), ("-", "1.00"), ("=", "8.00")):
            for _ in range(9):
                page.keyboard.press(key)
            assert attr(region, "data-viewport") == f"{lon_lat},{value}"
        for _ in range(7):
            page.keyboard.press("-")
        for _ in range(8):
            page.keyboard.press("ArrowUp")
        for _ in range(12):
            page.keyboard.press("ArrowLeft")
        page.reload()
        estate_ready(page)
        page.mouse.move(*_centre(estate_map(page)))
        page.mouse.wheel(0, -100)
        soon(page, lambda: view(page)[2] == 1.25, "one wheel step up raises zoom by 0.25")
        page.mouse.wheel(0, 100)
        soon(page, lambda: view(page)[2] == 1.0, "one wheel step down lowers zoom by 0.25")
        click(button(page, "Zoom in"))
        assert view(page)[2] == 2.0, "Zoom in changes zoom by exactly 1"
        click(button(page, "Zoom in"))
        soon(page, lambda: attr(marker(page, "AT07"), "data-cluster-phase") == "placed", "markers separate", step=FINE_MS)
        sul = ["AT05", "AT06", "AT07"]
        trips = [events_of(marker(page, code).element_handle(), "data-cluster-phase") for code in sul]
        for trip in trips:
            assert_span(trip, "separating", "placed", TRAVEL_MIN_MS, TRAVEL_MAX_MS)
        starts = [next(e for e in trip if e["value"] == "separating") for trip in trips]
        gaps = [starts[i + 1]["f"] - starts[i]["f"] for i in range(2)]
        gaps_real = [starts[i + 1]["r"] - starts[i]["r"] for i in range(2)]
        assert all(abs(g - STAGGER_MS) <= MARGIN_MS and g > 0 for g in gaps) or \
               all(abs(g - STAGGER_MS) <= MARGIN_MS and g > 0 for g in gaps_real), f"stagger {gaps} / {gaps_real}"
        click(button(page, "Zoom out"))
        soon(page, lambda: attr(marker(page, "AT05"), "data-cluster-phase") == "clustered", "zoom below 3 gathers at once", 2)
        estate_map(page).focus()
        for _ in range(2):
            page.keyboard.press("+")
        x, y = _centre(estate_map(page))
        start_lon = view(page)[0]
        page.mouse.move(x, y)
        page.mouse.down()
        for index in range(1, 5):
            page.mouse.move(x + 10 * index, y)
            advance(page, 16)
        soon(page, lambda: attr(estate_map(page), "data-phase") == "dragging", "data-phase dragging", 2, 0)
        page.mouse.up()
        soon(page, lambda: attr(estate_map(page), "data-phase") == "moving", "data-phase moving after release", 2, 0)
        lons, stamps = [], []
        for _ in range(16):
            lons.append(view(page)[0])
            stamps.append(page.evaluate("performance.now()"))
            advance(page, 40)
        speeds = [abs(lons[i + 1] - lons[i]) / (stamps[i + 1] - stamps[i]) for i in range(len(lons) - 1)]
        assert speeds[0] > 0 and view(page)[0] != start_lon, "the map does not glide on after release"
        v0, v1 = sum(speeds[1:4]) / 3, sum(speeds[8:11]) / 3
        assert v1 > 0 and v0 > v1, f"speeds do not fall: {speeds}"
        half_life = (stamps[9] - stamps[2]) * math.log(2) / math.log(v0 / v1)
        assert HALF_MIN_MS - MARGIN_MS <= half_life <= HALF_MAX_MS + MARGIN_MS, f"half-life {half_life}ms"
        soon(page, lambda: attr(estate_map(page), "data-phase") == "settled", "data-phase settled when the glide stops")


def _centre(locator: Any) -> tuple[float, float]:
    found = box(locator)
    return found["x"] + found["width"] / 2, found["y"] + found["height"] / 2


def test_live_estate_in_place_and_arrival(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    set_available(app_url, "AT06", "FITA-48", 8)
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        zoom_to_markers(page)
        keep = {code: marker(page, code).element_handle() for code in ("AT05", "AT06", "AT01")}
        row_node = shops_row(page, "AT06").element_handle()
        try:
            ok(lead.post(susp_url("AT06"), {"suspended": True, "reason": "Teste"}))
            advance(page, POLL_MS)
            soon(page, lambda: attr(marker(page, "AT06"), "data-marker-state") == "suspended", "marker restates after a poll", step=10)
            has_attr(page, shops_row(page, "AT06"), "data-marker-state", "suspended")
            assert keep["AT06"].evaluate("e => e.isConnected") and row_node.evaluate("e => e.isConnected")
            assert marker(page, "AT06").evaluate("(e, kept) => e === kept", keep["AT06"]), "the marker node was replaced"
            assert keep["AT06"].evaluate("e => e.getAttribute('data-marker-state')") == "suspended"
            legend_item = next(i for i in role(role(page, "list", "Map legend"), "listitem").all() if txt(i).startswith("Suspended"))
            count = sum(s["display_state"] == "suspended" for s in ok(lead.get("/api/stores"))["stores"])
            has_attr(page, tagged(legend_item, "data-figure", "legend-count"), "data-value", str(count))
        finally:
            ok(lead.post(susp_url("AT06"), {"suspended": False}))
        advance(page, POLL_MS)
        soon(page, lambda: attr(marker(page, "AT06"), "data-marker-state") != "suspended", "marker resumes")
        order = new_order(app_url, FILIPE, stocked=True)
        estate_updates = status(page, "Estate updates")
        advance(page, POLL_MS)
        soon(page, lambda: attr(marker(page, "AT06"), "data-arrival") in ("dropping", "pulsing"), "the new order drops on its marker", step=FINE_MS)
        soon(page, lambda: "none" == attr(marker(page, "AT06"), "data-arrival"), "the arrival ends", step=FINE_MS)
        arrival = [e for e in events_of(keep["AT06"], "data-arrival") if e["value"] != "none" or True]
        values = [e["value"] for e in arrival]
        assert values.count("dropping") == 1 and values.count("pulsing") == 1, values
        assert_span(arrival, "dropping", "pulsing", DROP_MIN_MS, DROP_MAX_MS)
        assert_span(arrival, "pulsing", "none", PULSE_MIN_MS, PULSE_MAX_MS)
        says(page, estate_updates, f"New order {order['number']} at Loja Olhão.")
        for node in keep.values():
            assert node.evaluate("e => e.isConnected"), "an arrival re-created a marker"


def test_estate_filters_in_address(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    count_for = lambda **params: str(ok(lead.get("/api/stores", **params))["count"])
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        length = page.evaluate("history.length")
        click(role(page, "checkbox", "Open"))
        wanted = "closing_soon,closed,stock_critical,suspended"
        soon(page, lambda: page.url.endswith(f"/estate?state={wanted}"), "state list in the address")
        assert page.evaluate("history.length") == length + 1
        soon(page, lambda: attr(estate_map(page), "data-store-count") == count_for(state=wanted), "count from the API")
        search = role(page, "searchbox", "Search shops")
        search.focus()
        page.keyboard.type("  Loja Faro ")
        advance(page, DEBOUNCE_MS)
        soon(page, lambda: page.url.endswith(f"/estate?q=Loja%20Faro&state={wanted}"), "trimmed q in the address")
        assert page.evaluate("history.length") == length + 2, "typing added more than one entry"
        soon(page, lambda: attr(estate_map(page), "data-store-count") == count_for(q="Loja Faro", state=wanted), "searched count")
        page.reload()
        estate_ready(page)
        assert role(page, "searchbox", "Search shops").input_value().strip() == "Loja Faro"
        assert not role(page, "checkbox", "Open").is_checked()
        page.go_back()
        soon(page, lambda: page.url.endswith(f"/estate?state={wanted}"), "Back restores the earlier entry")
        soon(page, lambda: role(page, "searchbox", "Search shops").input_value() == "", "Back clears the search box")
        soon(page, lambda: attr(estate_map(page), "data-store-count") == count_for(state=wanted), "Back restores the count")
        page.go_back()
        soon(page, lambda: role(page, "checkbox", "Open").is_checked(), "Back re-checks Open")
        soon(page, lambda: urlparse(page.url).query == "", "all defaults leave the address bare")
        calls: list[str] = []
        page.goto(app_url + "/estate?state=none")
        page.on("request", lambda r: calls.append(r.url) if "/api/stores?" in r.url or r.url.endswith("/api/stores") else None)
        visible(page, estate_map(page))
        soon(page, lambda: attr(estate_map(page), "data-store-count") == "0", "state=none lists nothing")
        says(page, status(page, "Estate updates"), "No shops match these filters.")
        for name in STATE_LABELS.values():
            assert not role(page, "checkbox", name).is_checked()
        length = page.evaluate("history.length")
        page.goto(app_url + "/estate?state=suspended,bogus,open,open")
        soon(page, lambda: page.url.endswith("/estate?state=open,suspended"), "address normalised in place")
        assert attr(estate_map(page), "data-store-count") is not None
        page.goto(app_url + f"/estate?state={ALL_STATES}")
        soon(page, lambda: urlparse(page.url).query == "", "a list equal to all five is left out")


def _morning_expect(page: Any, lead: Api, step: str, states: str | None) -> None:
    listing = ok(lead.get("/api/stores", **({"state": states} if states else {})))
    says(page, status(page, "Estate updates"), f"{listing['count']} shops shown.")
    has_attr(page, estate_map(page), "data-store-count", str(listing["count"]))
    codes = sorted(attr(r, "data-store-id") for r in role(page, "table", "Shops").locator("[data-store-id]").all()) if page.viewport_size["width"] > 375 else None
    if codes is not None:
        assert codes == sorted(s["id"] for s in listing["stores"]), f"{step}: table rows {codes}"


def test_wf_estate_map_morning_keyboard(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    with screen(browser, app_url, None, "/sign-in", DESKTOP) as page:
        sign_in_keys(page, LEAD, "errada")
        says(page, role(page, "alert"), "Email or password is wrong.")
        focus_is(page, role(page, "textbox", "Email"))
        for _ in range(len(LEAD)):
            page.keyboard.press("Backspace")
        page.keyboard.press("Control+A")
        page.keyboard.type(LEAD)
        page.keyboard.press("Tab")
        page.keyboard.type(PASSWORD)
        page.keyboard.press("Enter")
        soon(page, lambda: urlparse(page.url).path == "/estate", "address /estate")
        estate_ready(page)
        states = [("Open", "closing_soon,closed,stock_critical,suspended"),
                  ("Closing soon", "closed,stock_critical,suspended"), ("Closed", "stock_critical,suspended")]
        for name, wanted in states:
            tab_to(page, role(page, "checkbox", name))
            page.keyboard.press("Space")
            soon(page, lambda: page.url.endswith("?state=" + wanted), f"address state={wanted}")
            _morning_expect(page, lead, name, wanted)
        tab_to(page, estate_map(page))
        page.keyboard.press("+")
        page.keyboard.press("+")
        soon(page, lambda: view(page)[2] == 3.0, "zoom 3")
        visible_markers = [m for m in estate_map(page).locator("[data-store-id]").all()]
        listing = ok(lead.get("/api/stores", state="stock_critical,suspended"))
        assert sorted(attr(m, "data-store-id") for m in visible_markers) == sorted(s["id"] for s in listing["stores"])
        assert button(page, re.compile("^Cluster of")).count() == 0
        page.go_back()
        soon(page, lambda: page.url.endswith("?state=closed,stock_critical,suspended"), "Back re-checks Closed")
        assert role(page, "checkbox", "Closed").is_checked()
        _morning_expect(page, lead, "Back", "closed,stock_critical,suspended")


def test_wf_estate_map_morning_touch(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    with screen(browser, app_url, LEAD, "/estate", PHONE) as page:
        estate_ready(page)
        tap(button(page, "Filters"))
        sheet = role(page, "region", "Filters")
        visible(page, sheet)
        has_attr(page, sheet, "data-state", "open")
        assert box(sheet)["width"] == 375, "the phone sheet is full-screen"
        for name, wanted in [("Open", "closing_soon,closed,stock_critical,suspended"),
                             ("Closing soon", "closed,stock_critical,suspended"), ("Closed", "stock_critical,suspended")]:
            box_item = role(page, "checkbox", name)
            tap(box_item)
            soon(page, lambda: page.url.endswith("?state=" + wanted), f"address state={wanted}")
            _morning_expect(page, lead, name, wanted)
        tap(button(page, "Filters"))
        soon(page, lambda: role(page, "searchbox", "Search shops").count() == 0, "filter sheet closed")
        tap(button(page, "Zoom in"))
        tap(button(page, "Zoom in"))
        soon(page, lambda: view(page)[2] == 3.0, "zoom 3 by touch")
        page.go_back()
        soon(page, lambda: page.url.endswith("?state=closed,stock_critical,suspended"), "Back one filter step")
        _morning_expect(page, lead, "Back", "closed,stock_critical,suspended")


def test_selecting_shop_glide_and_reduced(browser: Any, app_url: str) -> None:
    target = viewport_text(-7.9304, 37.0194, 6)
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        region = estate_map(page).element_handle()
        details = button(page, "Details for Loja Faro Centro")
        details.focus()
        page.keyboard.press("Enter")
        soon(page, lambda: attr(estate_map(page), "data-panel") == "open", "panel opens after the glide", step=FINE_MS)
        phases = events_of(region, "data-phase")
        assert_span(phases, "moving", "settled", GLIDE_MIN_MS, GLIDE_MAX_MS)
        assert attr(estate_map(page), "data-viewport") == target
        settled = next(e for e in phases if e["value"] == "settled")
        panel = next(e for e in events_of(region, "data-panel") if e["value"] == "open")
        fake, real = panel["f"] - settled["f"], panel["r"] - settled["r"]
        assert PANEL_DELAY_MIN_MS - MARGIN_MS <= fake <= PANEL_DELAY_MAX_MS + MARGIN_MS or \
               PANEL_DELAY_MIN_MS - MARGIN_MS <= real <= PANEL_DELAY_MAX_MS + MARGIN_MS, f"panel delay {fake}/{real}"
        lons = [float(e["value"].split(",")[0]) for e in events_of(region, "data-viewport")]
        travel = [v for v in lons if v != lons[0] or v == lons[-1]]
        assert len(travel) >= 3, f"the viewport jumped: {lons}"
        assert all(travel[i] <= travel[i + 1] for i in range(len(travel) - 1)), f"overshoot or reversal: {travel}"
        assert page.url.endswith("shop=AT05")
        focus_is(page, role(role(page, "region", "Shop detail"), "heading", "Loja Faro Centro"))
    with screen(browser, app_url, LEAD, "/estate", DESKTOP, reduced=True) as page:
        estate_ready(page)
        region = estate_map(page).element_handle()
        click(button(page, "Details for Loja Olhão"))
        has_attr(page, estate_map(page), "data-phase", "settled", 3)
        has_attr(page, estate_map(page), "data-panel", "open", 3)
        assert attr(estate_map(page), "data-viewport") == viewport_text(-7.8411, 37.0260, 6)
        assert "moving" not in values_of(region, "data-phase")
        assert len(set(values_of(region, "data-viewport"))) <= 2, "a reduced selection travelled"
        assert attr(estate_map(page), "data-motion") == "reduced"


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_wf_shop_detail_review(browser: Any, app_url: str, size: str) -> None:
    lead = Api(app_url, LEAD)
    shop = ok(lead.get(store_url("AT05")))
    stock = ok(lead.get(stock_url("AT05")))["lines"]
    critical = [line["sku"] for line in stock if line["critical"]]
    width, height = dims(size)
    with screen(browser, app_url, LEAD, "/estate", size) as page:
        estate_ready(page)
        cluster = button(page, re.compile(r"^Cluster of \d+ shops in Sul"))
        activate(page, cluster, size)
        soon(page, lambda: view(page)[2] == 3.0, "a cluster zooms to 3")
        soon(page, lambda: attr(marker(page, "AT05"), "data-cluster-phase") == "placed", "AT05 placed", step=FINE_MS)
        opener = marker(page, "AT05")
        activate(page, opener, size)
        panel = role(page, "region", "Shop detail")
        visible(page, panel)
        has_attr(page, panel, "data-state", "open")
        heading = role(panel, "heading", "Loja Faro Centro")
        visible(page, heading)
        body = txt(panel)
        assert shop["state_label"].lower() in body.lower()
        if shop["closes_local"]:
            assert shop["closes_local"] in body
        assert attr(tagged(panel, "data-figure", "critical-lines"), "data-value") == str(shop["critical_lines"])
        table = role(panel, "table", "Critical lines")
        for sku in critical:
            assert sku in txt(table), f"critical line {sku} missing"
        found = box(panel)
        if size == DESKTOP:
            assert 0.2 * width <= found["width"] <= 0.3 * width and found["x"] + found["width"] <= width + 1
        else:
            share = (0.55, 0.65) if size == TABLET else (0.65, 0.75)
            assert share[0] * height <= found["height"] <= share[1] * height, f"panel {found}"
            assert abs(found["y"] + found["height"] - height) <= 2, "bottom sheet touches the bottom"
            if size == PHONE:
                assert found["width"] == width
        no_sideways(page)
        if size == PHONE:
            tap(button(panel, "Close detail"))
        else:
            page.keyboard.press("Escape")
        has_attr(page, estate_map(page), "data-panel", "closed")
        assert "shop=" not in page.url
        focus_is(page, marker(page, "AT05"))


def test_detail_panel_reload_escape(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, LEAD, "/estate?shop=AT05", PHONE) as page:
        estate_ready(page)
        panel = role(page, "region", "Shop detail")
        visible(page, panel)
        close = button(panel, "Close detail")
        close.focus()
        scrolled = panel.evaluate("e => { e.scrollTop = 40; return e.scrollTop; }")
        page.reload()
        estate_ready(page)
        panel = role(page, "region", "Shop detail")
        visible(page, panel)
        has_attr(page, estate_map(page), "data-panel", "open")
        assert attr(panel, "data-state") == "open"
        states = values_of(panel.element_handle(), "data-state")
        assert "opening" not in states, f"restored panel played an entrance: {states}"
        assert "moving" not in values_of(estate_map(page).element_handle(), "data-phase")
        focus_is(page, button(panel, "Close detail"))
        assert abs(panel.evaluate("e => e.scrollTop") - scrolled) <= 10
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        opener = button(page, "Details for Loja Olhão")
        opener.focus()
        page.keyboard.press("Enter")
        has_attr(page, estate_map(page), "data-panel", "open")
        page.keyboard.press("Escape")
        has_attr(page, estate_map(page), "data-panel", "closed")
        focus_is(page, opener)
        assert "shop=" not in page.url
        click(opener)
        has_attr(page, estate_map(page), "data-panel", "open")
        panel = role(page, "region", "Shop detail")
        click(button(panel, "Close detail"))
        focus_is(page, opener)


def test_collapsed_sheets_unavailable(browser: Any, app_url: str) -> None:
    for size in (TABLET, PHONE):
        with screen(browser, app_url, LEAD, "/estate", size) as page:
            estate_ready(page)
            assert role(page, "searchbox", "Search shops").count() == 0
            names = tab_order(page, 12)
            assert "Search shops" not in names and "Close detail" not in names, names
            opener = button(page, "Filters")
            opener.focus()
            page.keyboard.press("Enter")
            visible(page, role(page, "searchbox", "Search shops"))
            has_attr(page, role(page, "region", "Filters"), "data-state", "open")
            page.keyboard.press("Escape")
            names = tab_order(page, 4)
            assert "Search shops" not in names and "Open" not in names, f"closing sheet reachable: {names}"
            soon(page, lambda: role(page, "searchbox", "Search shops").count() == 0, "closed sheet out of the tree", step=FINE_MS)
            no_sideways(page)
            if size == PHONE:
                assert role(page, "table", "Shops").count() == 0, "unselected Table tab in the tree"
                assert f"Details for {STORE_NAMES['AT01']}" not in tab_order(page, 15)
                click(role(page, "tab", "Table"))
                visible(page, role(page, "table", "Shops"))
                assert estate_map(page).count() == 0 or not estate_map(page).is_visible(), "unselected Map tab shown"
                click(button(page, f"Details for {STORE_NAMES['AT06']}"))
                soon(page, lambda: role(page, "tab", "Map").get_attribute("aria-selected") == "true", "Details selects the Map tab")
            else:
                click(button(page, f"Details for {STORE_NAMES['AT06']}"))
            panel = role(page, "region", "Shop detail")
            visible(page, panel)
            has_attr(page, panel, "data-state", "open")
            page.keyboard.press("Escape")
            names = tab_order(page, 3)
            assert "Close detail" not in names, f"closing panel reachable: {names}"
            soon(page, lambda: role(page, "region", "Shop detail").count() == 0, "closed panel out of the tree", step=FINE_MS)


def test_wf_shop_detail_suspend_resume(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    shopper = Api(app_url, GIL)
    set_available(app_url, "AT06", "FITA-48", 5)
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        zoom_to_markers(page)
        opener = button(page, "Suspend Loja Olhão")
        tab_to(page, opener, presses=70)
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Suspend shop")
        visible(page, dialog)
        reason = role(dialog, "textbox", "Reason")
        focus_is(page, reason)
        order = tab_order(page, 3)
        assert sorted(order[:2]) == ["Keep open", "Suspend"] and order[2] == "Reason", f"Tab must wrap inside the dialog: {order}"
        page.keyboard.press("Shift+Tab")
        focus_is(page, button(dialog, order[1]))
        if order[1] != "Keep open":
            page.keyboard.press("Shift+Tab")
        focus_is(page, button(dialog, "Keep open"))
        page.keyboard.press("Enter")
        soon(page, lambda: role(page, "dialog", "Suspend shop").count() == 0, "Keep open closes the dialog")
        focus_is(page, opener)
        assert ok(lead.get(store_url("AT06")))["suspended"] is False, "Keep open changed the shop"
        page.keyboard.press("Enter")
        visible(page, dialog)
        button(dialog, "Suspend").focus()
        page.keyboard.press("Enter")
        visible(page, dialog.get_by_text("Give a reason."))
        assert attr(role(dialog, "textbox", "Reason"), "aria-invalid") == "true"
        assert ok(lead.get(store_url("AT06")))["suspended"] is False
        try:
            role(dialog, "textbox", "Reason").focus()
            page.keyboard.type(SUSPEND_REASON)
            button(dialog, "Suspend").focus()
            page.keyboard.press("Enter")
            says(page, status(page, "Estate updates"), "Loja Olhão is suspended.")
            shop = ok(lead.get(store_url("AT06")))
            assert shop["suspended"] and shop["suspension_reason"] == SUSPEND_REASON and shop["display_state"] == "suspended"
            has_attr(page, marker(page, "AT06"), "data-marker-state", "suspended")
            has_attr(page, shops_row(page, "AT06"), "data-marker-state", "suspended")
            fill_cart(shopper, "AT06", {"FITA-48": 1})
            refused = shopper.post("/api/holds", {})
            assert refused.status_code == 409 and refused.json() == {"code": "store_suspended", "store_id": "AT06"}
            assert ok(shopper.get(slots_url("AT06")))["days"] == []
            resume = button(page, "Resume Loja Olhão")
            resume.focus()
            page.keyboard.press("Enter")
            says(page, status(page, "Estate updates"), "Loja Olhão is open for orders again.")
        finally:
            lead.post(susp_url("AT06"), {"suspended": False})
        assert ok(lead.get(store_url("AT06")))["suspended"] is False
        soon(page, lambda: attr(marker(page, "AT06"), "data-marker-state") != "suspended", "marker resumes")
        assert ok(shopper.get(slots_url("AT06")))["days"], "resumed shop offers slots"
        ok(shopper.post("/api/holds", {}), 201)
        reset_shopper(shopper)
        bad = lead.post(susp_url("AT06"), {"suspended": True, "reason": ""})
        assert bad.status_code == 422


def test_wf_estate_table_rows_in_place(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    heal_store(app_url, "AT01")
    stores = ok(lead.get("/api/stores"))["stores"]
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        table = role(page, "table", "Shops")
        headers = table.locator('th:not([scope="row"]), [role="columnheader"]')
        for header in ("Shop", "City", "State", "Critical lines", "Closes", "Actions"):
            assert headers.filter(has_text=re.compile(rf"^\s*{re.escape(header)}\s*$")).count() == 1, f"column {header}"
        assert tagged(table, "data-store-id").count() == len(stores)
        for shop in stores:
            row = shops_row(page, shop["id"])
            cells = txt(row)
            assert shop["name"] in cells and shop["city"] in cells and STATE_LABELS[shop["display_state"]] in cells
            assert button(row, f"Details for {shop['name']}").count() == 1
            action = "Resume" if shop["suspended"] else "Suspend"
            assert button(row, f"{action} {shop['name']}").count() == 1
        node = shops_row(page, "AT01").element_handle()
        figure = tagged(shops_row(page, "AT01"), "data-figure", "critical-lines")
        assert attr(figure, "data-value") == "0"
        figure_node = figure.element_handle()
        try:
            set_available(app_url, "AT01", "TE-BR-4L", 2)
            advance(page, POLL_MS)
            soon(page, lambda: attr(shops_row(page, "AT01"), "data-marker-state") == "stock_critical", "row restated", step=FINE_MS)
            assert node.evaluate("e => e.isConnected") and shops_row(page, "AT01").evaluate("(e, n) => e === n", node)
            assert attr(figure, "data-value") == "1"
            soon(page, lambda: attr(figure, "data-counting") == "false", "figure settles", step=FINE_MS)
            counted = events_of(figure_node, "data-counting")
            assert_span(counted, "true", "false", FIG_MIN_MS, FIG_MAX_MS)
            assert "Stock critical" in txt(shops_row(page, "AT01"))
        finally:
            heal_store(app_url, "AT01")


def test_wf_estate_table_keyboard_order(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        names = tab_order(page, 24)
        wanted = ["Sign out", "Skip to shops table", "Search shops", "Open", "Closing soon", "Closed", "Stock critical", "Suspended",
                  "Estate map", "Cluster of 4 shops in Centro, zoom in", "Cluster of 3 shops in Sul, zoom in",
                  "Cluster of 3 shops in Norte, zoom in"]
        position = -1
        for name in wanted:
            assert name in names[position + 1:], f"{name} after index {position} in {names}"
            position = names.index(name, position + 1)
        rest = names[position + 1:]
        assert len(rest) >= 5 and rest[0].startswith("Open Loja Ponta Delgada") and rest[1].startswith("Open Loja Angra")
        assert rest[2:6] == ["Zoom in", "Zoom out", "Review last 24 hours", "Details for Loja Lisboa Baixa"], rest
        page.reload()
        estate_ready(page)
        skip = role(page, "link", "Skip to shops table")
        tab_to(page, skip)
        page.keyboard.press("Enter")
        table = role(page, "table", "Shops")
        focus_is(page, table)
        page.keyboard.press("Tab")
        focus_is(page, button(page, "Details for Loja Lisboa Baixa"))
        cluster = button(page, "Cluster of 3 shops in Sul, zoom in")
        cluster.focus()
        before = view(page)
        page.keyboard.press("ArrowRight")
        assert view(page)[0] > before[0], "arrow key ignored on a cluster"
        page.keyboard.press("+")
        assert view(page)[2] == 2.0, "plus ignored on a cluster"
        page.keyboard.press("-")
        solo = button(page, re.compile(r"^Open Loja Ponta Delgada"))
        solo.focus()
        page.keyboard.press("=")
        assert view(page)[2] == 2.0, "equals ignored on a marker"
        page.keyboard.press("-")
        page.keyboard.press("ArrowUp")
        assert attr(estate_map(page), "data-phase") == "settled"
        cluster.focus()
        page.keyboard.press("Enter")
        soon(page, lambda: view(page)[2] == 3.0, "Enter on a cluster zooms to 3")
        details = button(page, "Details for Loja Faro Centro")
        details.focus()
        page.keyboard.press("Enter")
        has_attr(page, estate_map(page), "data-panel", "open")


def test_phone_tabs_pan_pinch(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, LEAD, "/estate", PHONE) as page:
        estate_ready(page)
        for control in (role(page, "tab", "Map"), role(page, "tab", "Table"), button(page, "Filters"), button(page, "Zoom in"), button(page, "Zoom out")):
            assert_target(control)
        found = box(estate_map(page))
        left, right = found["x"], 375 - found["x"] - found["width"]
        assert -1 <= left <= PHONE_SIDE_MARGIN and -1 <= right <= PHONE_SIDE_MARGIN, f"map {found}"
        assert abs(found["height"] - 0.6 * 812) <= 8, f"map {found}"
        tap(role(page, "tab", "Table"))
        table = role(page, "table", "Shops")
        visible(page, table)
        no_sideways(page)
        row_button = button(page, "Details for Loja Faro Centro")
        assert_target(row_button)
        tap(role(page, "tab", "Map"))
        visible(page, estate_map(page))
        role(page, "tab", "Map").focus()
        page.keyboard.press("ArrowRight")
        soon(page, lambda: role(page, "tab", "Table").get_attribute("aria-selected") == "true", "Arrow Right moves to Table")
        page.keyboard.press("ArrowLeft")
        soon(page, lambda: role(page, "tab", "Map").get_attribute("aria-selected") == "true", "Arrow Left moves to Map")
        cx, cy = _centre(estate_map(page))
        lon_before = view(page)[0]
        scroll_before = page.evaluate("window.scrollY")
        touch_drag(page, (cx, cy), (cx + 60, cy))
        soon(page, lambda: view(page)[0] != lon_before, "one finger pans the map")
        assert page.evaluate("window.scrollY") == scroll_before, "the page scrolled under the finger"
        soon(page, lambda: attr(estate_map(page), "data-phase") == "settled", "pan settles")
        for _ in range(8):
            pinch(page, (cx, cy), 60, 240)
        soon(page, lambda: view(page)[2] == 8.0, "pinch stops at zoom 8")
        pinch(page, (cx, cy), 60, 240)
        assert view(page)[2] == 8.0, "pinch passed the limit"
        tap(button(page, "Filters"))
        visible(page, role(page, "searchbox", "Search shops"))
        tap(button(page, "Filters"))
        soon(page, lambda: role(page, "searchbox", "Search shops").count() == 0, "filter sheet closes")
        tap(role(page, "tab", "Table"))
        tap(button(page, "Details for Loja Faro Centro"))
        soon(page, lambda: role(page, "tab", "Map").get_attribute("aria-selected") == "true", "Details selects the Map tab")
        has_attr(page, estate_map(page), "data-panel", "open")
        no_sideways(page)


def test_estate_reduced_motion(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, LEAD, "/estate", DESKTOP, reduced=True) as page:
        estate_ready(page)
        assert attr(estate_map(page), "data-motion") == "reduced"
        click(button(page, "Zoom in"))
        click(button(page, "Zoom in"))
        soon(page, lambda: attr(marker(page, "AT07"), "data-cluster-phase") == "placed", "markers placed")
        node = marker(page, "AT07").element_handle()
        assert "separating" not in values_of(node, "data-cluster-phase")
        x, y = _centre(estate_map(page))
        page.mouse.move(x, y)
        page.mouse.down()
        for index in range(1, 5):
            page.mouse.move(x + 10 * index, y)
            advance(page, 16)
        page.mouse.up()
        soon(page, lambda: attr(estate_map(page), "data-phase") == "settled", "a released drag stops dead", 2, 0)
        region = estate_map(page).element_handle()
        assert values_of(region, "data-phase").count("moving") == 0
        stopped = view(page)
        advance(page, 500)
        assert view(page) == stopped, "the map glided under reduced motion"
        tap_filter = role(page, "checkbox", "Open")
        click(tap_filter)
        soon(page, lambda: "state=" in page.url, "filter still works")
        legend = tagged(role(page, "list", "Map legend"), "data-figure", "legend-count")
        for item in legend.all():
            assert "true" not in values_of(item.element_handle(), "data-counting")
            assert attr(item, "data-counting") == "false"
        slider = role(page, "slider", "Review last 24 hours")
        slider.focus()
        page.keyboard.press("Home")
        has_attr(page, estate_map(page), "data-review-progress", "0.000")


def test_marker_cluster_row_names(browser: Any, app_url: str) -> None:
    lead = Api(app_url, LEAD)
    heal_store(app_url, "AT01")
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        assert button(page, "Cluster of 4 shops in Centro, zoom in").count() == 1
        assert button(page, "Cluster of 3 shops in Norte, zoom in").count() == 1
        zoom_to_markers(page)
        stores = ok(lead.get("/api/stores"))["stores"]
        for shop in stores:
            name = f"Open {shop['name']}, {STATE_WORDS[shop['display_state']]}, critical lines: {shop['critical_lines']}"
            assert button(page, name).count() == 1, name
        node = marker(page, "AT01").element_handle()
        try:
            set_available(app_url, "AT01", "TE-BR-4L", 2)
            advance(page, POLL_MS)
            renamed = button(page, "Open Loja Lisboa Baixa, stock critical, critical lines: 1")
            soon(page, lambda: renamed.count() == 1, "marker renamed in the poll that changed it", step=10)
            assert attr(marker(page, "AT01"), "data-marker-state") == "stock_critical"
            assert marker(page, "AT01").evaluate("(e, n) => e === n", node), "marker node replaced"
            ok(lead.post(susp_url("AT01"), {"suspended": True, "reason": "Teste"}))
            advance(page, POLL_MS)
            resumed = button(page, "Resume Loja Lisboa Baixa")
            soon(page, lambda: resumed.count() == 1, "row action renamed", step=10)
            assert button(page, "Open Loja Lisboa Baixa, suspended, critical lines: 1").count() == 1
        finally:
            lead.post(susp_url("AT01"), {"suspended": False})
            heal_store(app_url, "AT01")


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_wf_nearest_shop_find_and_add(browser: Any, app_url: str, size: str) -> None:
    shopper = Api(app_url, ANA)
    reset_shopper(shopper)
    set_available(app_url, "AT05", "VM-750", 3)
    expected = ok(shopper.get(avail_url("VM-750"), lat=FARO["lat"], lon=FARO["lon"]))["shops"]
    with screen(browser, app_url, ANA, "/catalogue", size) as page:
        search = role(page, "searchbox", "Search products")
        visible(page, search)
        region = status(page, "Catalogue results")
        for query in ("tinta", "%", "verniz"):
            if size == PHONE:
                tap(search)
            search.focus()
            page.keyboard.press("Control+A")
            page.keyboard.type(query)
            advance(page, DEBOUNCE_MS)
            count = ok(shopper.get("/api/products", q=query))["count"]
            says(page, region, f"{count} products found.")
        link = role(page, "link", "Verniz marítimo 750 ml")
        activate(page, link, size)
        soon(page, lambda: urlparse(page.url).path == "/products/VM-750", "address /products/VM-750")
        area = role(page, "combobox", "Your area")
        visible(page, area)
        ranked = role(page, "list", "Shops with this item")
        ranking = status(page, "Shop ranking")
        select(area, "Lisboa")
        says(page, ranking, f"{len(expected)} shops ranked from Lisboa.")
        has_attr(page, tagged(ranked, "data-rank", "1"), "data-store-id", "AT01")
        select(area, "Faro")
        says(page, ranking, f"{len(expected)} shops ranked from Faro.")
        soon(page, lambda: attr(tagged(ranked, "data-rank", "1"), "data-store-id") == "AT05", "Faro ranks Loja Faro Centro first")
        assert role(ranked, "listitem").count() == len(expected)
        first = store_item(ranked, "AT05")
        assert attr(tagged(first, "data-figure", "distance"), "data-value") == "0.00"
        soon(page, lambda: attr(tagged(first, "data-figure", "shop-available"), "data-value") == str(expected[0]["available"]), "available figure")
        collect = button(first, "Collect from Loja Faro Centro")
        assert_target(collect)
        activate(page, collect, size)
        has_attr(page, collect, "aria-pressed", "true")
        if size != PHONE:
            focus_is(page, collect)
        assert ok(shopper.get("/api/cart"))["store_id"] == "AT05"
        updates = status(page, "Cart updates")
        track(updates)
        figure = tagged(page, "data-figure", "cart-total")
        add = button(page, "Add to cart")
        activate(page, add, size)
        has_attr(page, figure, "data-value", str(VARNISH), 10)
        soon(page, lambda: attr(figure, "data-counting") == "false", "cart total settles", step=FINE_MS)
        says(page, updates, "Cart total 24,90 €.")
        for _ in range(5):
            advance(page, 1000)
        assert announced(updates) == ["Cart total 24,90 €."], announced(updates)
        if size != PHONE:
            focus_is(page, add)
        assert role(page, "spinbutton", "Quantity").input_value() == "1"
        cart = ok(shopper.get("/api/cart"))
        assert [(line["sku"], line["quantity"]) for line in cart["lines"]] == [("VM-750", 1)] and cart["total_cents"] == VARNISH
    reset_shopper(shopper)


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> Decimal:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return Decimal(str(2 * 6371.0 * math.asin(math.sqrt(a)))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def test_ranking_formula_and_ties(app_url: str) -> None:
    shopper = Api(app_url, HELENA)
    stores = {s["id"]: s for s in ok(shopper.get("/api/stores"))["stores"]}
    answer = ok(shopper.get(avail_url("VM-750"), lat=38.7223, lon=-9.1393))
    assert answer["sku"] == "VM-750" and len(answer["shops"]) == 12 and answer["lat"] == 38.7223
    for shop in answer["shops"]:
        store = stores[shop["store_id"]]
        assert Decimal(str(shop["distance_km"])) == _haversine(38.7223, -9.1393, store["lat"], store["lon"]), shop
        assert shop["available"] == shop["on_hand"] - shop["held"]
        assert shop["holdable"] is (not store["suspended"])
    distances = [shop["distance_km"] for shop in answer["shops"]]
    assert distances == sorted(distances)
    assert abs(float(_haversine(38.7223, -9.1393, 41.1579, -8.6291)) - 274.3) < 0.1

    for params in ({"lat": 38.7}, {"lat": 91, "lon": 0}, {"lat": 0, "lon": 181}, {"lat": "x", "lon": 0}):
        assert shopper.get(avail_url("VM-750"), **params).status_code == 422
    set_available(app_url, "AT05", "CAD-40", 3)
    set_available(app_url, "AT06", "CAD-40", 9)
    midpoint = {"lat": 37.0227, "lon": -7.88575}
    tied = ok(shopper.get(avail_url("CAD-40"), **midpoint))["shops"]
    top = [s for s in tied if s["store_id"] in ("AT05", "AT06")]
    assert top[0]["distance_km"] == top[1]["distance_km"], "the probe should tie"
    assert top[0]["store_id"] == "AT06", f"more units on hand must rank first: {top}"
    set_available(app_url, "AT05", "CAD-40", 9)

    equal = ok(Api(app_url, TIAGO).get(stock_url("AT06")))["lines"]
    held = next(line for line in equal if line["sku"] == "CAD-40")
    other = next(line for line in ok(Api(app_url, TIAGO).get(stock_url("AT05")))["lines"] if line["sku"] == "CAD-40")
    if held["on_hand"] == other["on_hand"]:
        tied = ok(shopper.get(avail_url("CAD-40"), **midpoint))["shops"]
        assert [s["store_id"] for s in tied if s["store_id"] in ("AT05", "AT06")] == ["AT05", "AT06"], "code breaks the last tie"
    reset_shopper(shopper)
    area_missing = Api(app_url, HELENA)
    fill_cart(area_missing, "AT06", {"CAD-40": 1}, midpoint)
    cart_shops = ok(area_missing.get("/api/cart/shops"))["shops"]
    assert len(cart_shops) == 12 and all(isinstance(s["complete"], bool) for s in cart_shops)
    assert [s["distance_km"] for s in cart_shops] == sorted(s["distance_km"] for s in cart_shops)
    reset_shopper(shopper)
    assert all(s["store_id"].startswith("CL") for s in ok(Api(app_url, DIOGO).get(avail_url("CL-LUV"), **midpoint))["shops"])


def test_search_literal_and_bounded(app_url: str) -> None:
    person = Api(app_url, CARE)
    for path, key in (("/api/products", "products"), ("/api/stores", "stores")):
        everything = ok(person.get(path))
        assert everything["count"] == len(everything[key])
        for literal in ("%", "_", "\\"):
            answer = ok(person.get(path, q=literal))
            assert answer["count"] == 0 and answer[key] == [], f"{path} q={literal}: {answer}"
        assert ok(person.get(path, q="   "))["count"] == everything["count"]
    assert [s["id"] for s in ok(person.get("/api/stores", q="heroismo"))["stores"]] == ["AT12"]
    assert [s["id"] for s in ok(person.get("/api/stores", q=" HEROÍSMO "))["stores"]] == ["AT12"]
    assert [p["sku"] for p in ok(person.get("/api/products", q="prf"))["products"]] == ["PRF-440"]
    assert ok(person.get("/api/products", q="VERNIZ"))["count"] == 1
    olhao = ok(person.get("/api/stores", q="olhao"))
    assert olhao["count"] == 2 and [s["id"] for s in olhao["stores"]] == ["AT06", "AT08"], olhao
    for path in ("/api/products", "/api/stores", "/api/orders"):
        started = time.monotonic()
        allowed = person.get(path, q="x" * Q_LIMIT)
        elapsed = time.monotonic() - started
        assert allowed.status_code == 200 and allowed.json()["count"] == 0, path
        assert elapsed < LIST_BUDGET_S, f"{path} took {elapsed}s"
        too_long = person.get(path, q="x" * (Q_LIMIT + 1))
        assert too_long.status_code == 422 and too_long.json()["code"] == "validation_failed" and "q" in too_long.json()["errors"]
        padded = person.get(path, q="  " + "x" * Q_LIMIT + "  ")
        assert padded.status_code == 200, f"{path}: the trimmed length decides"
    customer = own_email("Procura")
    order = new_order(app_url, EVA, customer=customer)
    assert ok(person.get("/api/orders", q=customer.upper()))["count"] == 1
    assert ok(person.get("/api/orders", q=order["number"]))["orders"][0]["id"] == order["id"]
    assert ok(person.get("/api/orders", q=f"  {order['number']} "))["count"] == 1
    assert ok(person.get("/api/orders", q="%"))["count"] == 0
    assert ok(person.get("/api/orders", q=customer[:-1]))["count"] == 0, "order q matches exactly"


def _stale_route(page: Any, glob: str, marker_text: str) -> list[Any]:
    kept: list[Any] = []

    def handler(route: Any) -> None:
        if marker_text in route.request.url and not kept:
            kept.append(route)
        else:
            route.fallback()

    page.route(glob, handler)
    return kept


def test_wf_nearest_shop_latest_input_wins(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, ANA)
    reset_shopper(shopper)
    with screen(browser, app_url, ANA, "/catalogue", DESKTOP) as page:
        search = role(page, "searchbox", "Search products")
        visible(page, search)
        kept = _stale_route(page, "**/api/products*", "tinta")
        search.focus()
        page.keyboard.type("tinta")
        advance(page, DEBOUNCE_MS)
        soon(page, lambda: kept, "the first search in flight")
        page.keyboard.press("Control+A")
        page.keyboard.type("verniz")
        advance(page, DEBOUNCE_MS)
        says(page, status(page, "Catalogue results"), "1 products found.")
        visible(page, role(page, "link", "Verniz marítimo 750 ml"))
        kept[0].fallback()
        for _ in range(10):
            advance(page, STEP_MS)
        assert txt(status(page, "Catalogue results")) == "1 products found."
        assert role(page, "link", "Tinta esmalte branca 4 L").count() == 0
        page.unroute("**/api/products*")
        page.goto(app_url + "/products/VM-750")
        area = role(page, "combobox", "Your area")
        visible(page, area)
        kept = _stale_route(page, "**/availability*", "lat=38.7223")
        select(area, "Lisboa")
        soon(page, lambda: kept, "the Lisboa ranking in flight")
        select(area, "Faro")
        ranked = role(page, "list", "Shops with this item")
        soon(page, lambda: attr(tagged(ranked, "data-rank", "1"), "data-store-id") == "AT05", "Faro ranking shown")
        says(page, status(page, "Shop ranking"), "12 shops ranked from Faro.")
        kept[0].fallback()
        for _ in range(10):
            advance(page, STEP_MS)
        assert attr(tagged(ranked, "data-rank", "1"), "data-store-id") == "AT05"
        assert txt(status(page, "Shop ranking")) == "12 shops ranked from Faro."
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        search = role(page, "searchbox", "Search shops")
        kept = _stale_route(page, "**/api/stores*", "q=faro")
        search.focus()
        page.keyboard.type("faro")
        advance(page, DEBOUNCE_MS)
        soon(page, lambda: kept, "the first shop search in flight")
        page.keyboard.press("Control+A")
        page.keyboard.type("olhao")
        advance(page, DEBOUNCE_MS)
        has_attr(page, estate_map(page), "data-store-count", "2")
        kept[0].fallback()
        for _ in range(10):
            advance(page, STEP_MS)
        assert attr(estate_map(page), "data-store-count") == "2"
        rows = sorted(attr(r, "data-store-id") for r in tagged(role(page, "table", "Shops"), "data-store-id").all())
        assert rows == ["AT06", "AT08"], rows
        assert txt(status(page, "Estate updates")) == "2 shops shown."
    customer = own_email("recente")
    order = new_order(app_url, EVA, customer=customer)
    with screen(browser, app_url, CARE, "/care", DESKTOP) as page:
        find = role(page, "searchbox", "Find order")
        visible(page, find)
        kept = _stale_route(page, "**/api/orders*", "q=nobody")
        find.focus()
        page.keyboard.type("nobody@tramela.example")
        advance(page, DEBOUNCE_MS)
        soon(page, lambda: kept, "the first order search in flight")
        page.keyboard.press("Control+A")
        page.keyboard.type(customer)
        advance(page, DEBOUNCE_MS)
        says(page, status(page, "Care updates"), "1 orders found.")
        kept[0].fallback()
        for _ in range(10):
            advance(page, STEP_MS)
        assert txt(status(page, "Care updates")) == "1 orders found."
        assert role(page, "link", f"Open order {order['number']}").count() == 1


def test_ranked_list_moves_in_place(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, ANA)
    reset_shopper(shopper)
    ok(shopper.put("/api/cart/area", LISBOA))
    with screen(browser, app_url, ANA, "/products/VM-750", DESKTOP) as page:
        ranked = role(page, "list", "Shops with this item")
        visible(page, ranked)
        soon(page, lambda: role(ranked, "listitem").count() == 12, "12 ranked items")
        node = store_item(ranked, "AT05").element_handle()
        figure = tagged(store_item(ranked, "AT05"), "data-figure", "distance").element_handle()
        list_node = ranked.element_handle()
        top_before = node.evaluate("e => e.getBoundingClientRect().top")
        updates = status(page, "Shop ranking")
        track(updates)
        select(role(page, "combobox", "Your area"), "Faro")
        soon(page, lambda: node.evaluate("e => e.getAttribute('data-rank')") == "1", "AT05 takes rank 1 in the first frame", step=FINE_MS)
        soon(page, lambda: attr(ranked, "data-phase") == "settled" and "moving" in values_of(list_node, "data-phase"), "list reports moving then settled", step=FINE_MS)
        assert_span(events_of(list_node, "data-phase"), "moving", "settled", TRAVEL_MIN_MS, TRAVEL_MAX_MS)
        assert store_item(ranked, "AT05").evaluate("(e, n) => e === n", node), "node replaced"
        assert node.evaluate("e => e.getBoundingClientRect().top") < top_before, "the item did not rise"
        assert figure.evaluate("e => e.getAttribute('data-value')") == "0.00"
        soon(page, lambda: figure.evaluate("e => e.getAttribute('data-counting')") == "false", "distance counted", step=FINE_MS)
        assert_span(events_of(figure, "data-counting"), "true", "false", FIG_MIN_MS, FIG_MAX_MS)
        says(page, updates, "12 shops ranked from Faro.")
        assert [item for item in announced(updates) if item != "Ranking shops..."] == ["12 shops ranked from Faro."]
        ids = [attr(i, "data-store-id") for i in role(ranked, "listitem").all()]
        assert len(ids) == len(set(ids)) == 12
    ok(shopper.put("/api/cart/area", LISBOA))
    with screen(browser, app_url, ANA, "/products/VM-750", DESKTOP, reduced=True) as page:
        ranked = role(page, "list", "Shops with this item")
        soon(page, lambda: role(ranked, "listitem").count() == 12, "12 ranked items")
        list_node = ranked.element_handle()
        select(role(page, "combobox", "Your area"), "Faro")
        soon(page, lambda: attr(tagged(ranked, "data-rank", "1"), "data-store-id") == "AT05", "new order at once", 5)
        assert "moving" not in values_of(list_node, "data-phase")
        assert attr(ranked, "data-phase") == "settled"
        says(page, status(page, "Shop ranking"), "12 shops ranked from Faro.")


COLUMNS = {"375x812": 1, "768x1024": 2, "1280x800": 3}
PRODUCT_NAMES = ["Verniz marítimo 750 ml", "Tinta esmalte branca 4 L", "Fita-cola de pintor 48 mm",
                 "Parafuso inox A2 4x40 mm (unidade)", "Mangueira de jardim 25 m", "Tesoura de poda",
                 "Cadeado latão 40 mm", "Semente de relva 1 kg"]


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_catalogue_product_layout(browser: Any, app_url: str, size: str) -> None:
    reset_shopper(Api(app_url, ANA))
    with screen(browser, app_url, ANA, "/catalogue", size) as page:
        visible(page, role(page, "searchbox", "Search products"))
        links = [role(page, "link", name) for name in PRODUCT_NAMES]
        for link in links:
            visible(page, link)
            assert_target(link)
        columns: list[list[float]] = []
        for left, right in sorted((b["x"], b["x"] + b["width"]) for b in map(box, links)):
            if columns and left < columns[-1][1] - 1:
                columns[-1][1] = max(columns[-1][1], right)
            else:
                columns.append([left, right])
        assert len(columns) == COLUMNS[size], f"{size}: columns at {columns}"
        no_sideways(page)
    with screen(browser, app_url, ANA, "/products/VM-750", size) as page:
        area = role(page, "combobox", "Your area")
        visible(page, area)
        select(area, "Faro")
        ranked = role(page, "list", "Shops with this item")
        soon(page, lambda: role(ranked, "listitem").count() > 0, "ranked shops listed")
        quantity, add = role(page, "spinbutton", "Quantity"), button(page, "Add to cart")
        collect = button(ranked, re.compile(r"^Collect from ")).first
        for control in (quantity, add, area, button(page, "Use my location"), collect):
            visible(page, control)
            assert_target(control)
        item, zone, listing = box(add), box(area), box(ranked)
        if size == PHONE:
            assert item["y"] < zone["y"] < listing["y"], f"one column order: {item} {zone} {listing}"
        else:
            assert item["x"] + item["width"] <= zone["x"] + 1, f"item left of the area choice: {item} {zone}"
            assert item["x"] + item["width"] <= listing["x"] + 1
            assert zone["y"] < listing["y"], "area choice above the list"
        no_sideways(page)


def test_product_page_reload(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, ANA)
    reset_shopper(shopper)
    with screen(browser, app_url, ANA, "/products/VM-750", DESKTOP) as page:
        area = role(page, "combobox", "Your area")
        visible(page, area)
        select(area, "Faro")
        ranked = role(page, "list", "Shops with this item")
        collect = button(ranked, "Collect from Loja Faro Centro")
        visible(page, collect)
        click(collect)
        has_attr(page, collect, "aria-pressed", "true")
        quantity = role(page, "spinbutton", "Quantity")
        fill(quantity, "4")
        quantity.focus()
        page.reload()
        area = role(page, "combobox", "Your area")
        visible(page, area)
        shown = lambda: area.evaluate("e => e.tagName === 'SELECT' ? e.selectedOptions[0].textContent.trim() : (e.value || e.textContent).trim()")
        soon(page, lambda: shown() == "Faro", "area restored from the cart")
        ranked = role(page, "list", "Shops with this item")
        again = button(ranked, "Collect from Loja Faro Centro")
        visible(page, again)
        has_attr(page, again, "aria-pressed", "true")
        quantity = role(page, "spinbutton", "Quantity")
        assert quantity.input_value() == "4"
        focus_is(page, quantity)
    assert ok(shopper.get("/api/cart"))["store_id"] == "AT05"
    reset_shopper(shopper)


def test_cart_totals_exact_cents(app_url: str) -> None:
    shopper = Api(app_url, FILIPE)
    for store, sku in (("AT06", "FITA-48"), ("AT06", "PRF-440"), ("AT06", "VM-750"), ("AT11", "FITA-48"), ("AT11", "VM-750")):
        set_available(app_url, store, sku, 10)
    cart = fill_cart(shopper, "AT06", {"FITA-48": 3})
    line = cart["lines"][0]
    assert line["line_total_cents"] == FITA_THREE and line["vat_cents"] == FITA_THREE_VAT_MAINLAND and cart["total_cents"] == FITA_THREE and cart["vat_cents"] == FITA_THREE_VAT_MAINLAND
    assert line["unit_price_milli"] == 4995 and line["status"] == "ok" and cart["units"] == 3
    cart = fill_cart(shopper, "AT11", {"FITA-48": 3})
    assert cart["lines"][0]["vat_cents"] == FITA_THREE_VAT_AZORES
    cart = fill_cart(shopper, "AT06", {"PRF-440": 7})
    assert cart["lines"][0]["line_total_cents"] == 25
    cart = fill_cart(shopper, "AT06", {"VM-750": 1})
    assert cart["lines"][0]["line_total_cents"] == VARNISH and cart["lines"][0]["vat_cents"] == VARNISH_VAT_MAINLAND
    cart = fill_cart(shopper, "AT11", {"VM-750": 1})
    assert cart["lines"][0]["vat_cents"] == VARNISH_VAT_AZORES
    cart = fill_cart(shopper, "AT06", {"FITA-48": 3, "VM-750": 1})
    assert cart["total_cents"] == FITA_THREE + VARNISH and cart["vat_cents"] == FITA_THREE_VAT_MAINLAND + VARNISH_VAT_MAINLAND
    assert ok(shopper.get("/api/cart"))["area"] == {"lat": FARO["lat"], "lon": FARO["lon"]}
    set_available(app_url, "AT06", "VM-750", 0)
    cart = ok(shopper.get("/api/cart"))
    short = next(item for item in cart["lines"] if item["sku"] == "VM-750")
    assert short["status"] == "short" and short["available"] == 0
    assert cart["total_cents"] == FITA_THREE and cart["vat_cents"] == FITA_THREE_VAT_MAINLAND and cart["units"] == 3
    assert ok(shopper.get("/api/cart/shops"))["shops"]
    reset_shopper(shopper)
    other = Api(app_url, FILIPE)
    ok(other.put(line_url("FITA-48"), {"quantity": 2}))
    assert ok(shopper.get("/api/cart"))["store_id"] == "AT06", "cart kept on the server"
    assert shopper.put(line_url("FITA-48"), {"quantity": CART_MAX + 1}).status_code == 422
    assert shopper.put(line_url("FITA-48"), {"quantity": -1}).status_code == 422
    assert shopper.put(line_url("NOPE-1"), {"quantity": 1}).status_code == 404
    assert Api(app_url, CARE).get("/api/cart").status_code == 403
    reset_shopper(shopper)
    assert ok(shopper.get("/api/cart"))["lines"] == []


def test_cart_changes_follow_server(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, GIL)
    set_available(app_url, "AT06", "FITA-48", 20)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    with screen(browser, app_url, GIL, "/cart", DESKTOP) as page:
        figure = tagged(page, "data-figure", "cart-total")
        visible(page, figure)
        has_attr(page, figure, "data-value", "500")
        stepper = role(page, "spinbutton", "Quantity of FITA-48")
        updates = status(page, "Cart updates")
        with held(page, "**/api/cart/lines/*") as release:
            fill(stepper, "3")
            page.keyboard.press("Tab")
            for _ in range(5):
                advance(page, STEP_MS)
            assert attr(figure, "data-value") == "500", "total changed before the answer"
            release()
        has_attr(page, figure, "data-value", str(FITA_THREE))
        says(page, updates, "Cart total 14,99 €.")
        page.route("**/api/cart/lines/*", lambda route: route.fulfill(status=500, json={"code": "internal"}))
        track(updates)
        fill(stepper, "5")
        page.keyboard.press("Tab")
        says(page, updates, "Something went wrong. Try again.")
        soon(page, lambda: stepper.input_value() == "3", "the box returns to the server's quantity")
        assert attr(figure, "data-value") == str(FITA_THREE)
        assert not [m for m in announced(updates) if m.startswith("Cart total")], "a failed change announced a total"
        page.unroute("**/api/cart/lines/*")
        assert ok(shopper.get("/api/cart"))["lines"][0]["quantity"] == 3
        click(button(page, "Remove FITA-48"))
        soon(page, lambda: any(found.is_visible() for found in page.get_by_text("Your cart is empty.", exact=True).all()),
             "the empty-cart copy on screen")
        soon(page, lambda: {"Your cart is empty.", f"Cart total {euro(0)}."} & set(announced(updates)),
             "the emptied cart announced in Cart updates")
    ok(shopper.put(line_url("FITA-48"), {"quantity": CART_MAX - 1}))
    with screen(browser, app_url, GIL, "/products/FITA-48", DESKTOP) as page:
        add = button(page, "Add to cart")
        visible(page, add)
        quantity = role(page, "spinbutton", "Quantity")
        fill(quantity, "1000")
        click(add)
        visible(page, page.get_by_text("Enter a whole number from 1 to 999."))
        assert attr(quantity, "aria-invalid") == "true"
        assert ok(shopper.get("/api/cart"))["lines"][0]["quantity"] == CART_MAX - 1, "an invalid Quantity sent a change"
        fill(quantity, "5")
        click(add)
        says(page, status(page, "Cart updates"), "Something went wrong. Try again.")
        assert quantity.input_value() == "5", "typed Quantity kept after a failure"
        assert ok(shopper.get("/api/cart"))["lines"][0]["quantity"] == CART_MAX - 1
    reset_shopper(shopper)


def test_checkout_dialog_keyboard_geometry(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, HELENA)
    set_available(app_url, "AT06", "FITA-48", 10)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    for size in SIZES:
        with screen(browser, app_url, HELENA, "/cart", size) as page:
            opener = button(page, "Checkout")
            visible(page, opener)
            opener.focus()
            page.keyboard.press("Enter")
            dialog = checkout_dialog(page)
            visible(page, dialog)
            soon(page, lambda: page.url.endswith("/cart?checkout=open"), "address /cart?checkout=open")
            soon(page, lambda: focus_inside(role(dialog, "radiogroup", "Collection shop")), "focus on Collection shop")
            has_attr(page, dialog, "data-state", "open")
            settled(page, dialog, "the checkout dialog")
            found = box(dialog)
            width, height = dims(size)
            if size == PHONE:
                assert found["x"] == 0 and found["y"] == 0 and found["width"] == width and found["height"] == height, found
            else:
                assert 520 <= found["width"] <= 600 and abs(found["x"] + found["width"] / 2 - width / 2) <= 8, found
            if size == DESKTOP:
                seen = tab_order(page, 8)
                assert "Hold items" in seen and "Full name" in seen and "Email" in seen, seen
                assert seen.index("Hold items") < seen.index("Full name") < seen.index("Email") < seen.index("Place order") < seen.index("Close checkout")
                for _ in range(14):
                    page.keyboard.press("Tab")
                    assert focus_inside(dialog), "Tab left the dialog"
                button(dialog, "Close checkout").focus()
                page.keyboard.press("Tab")
                soon(page, lambda: focus_inside(role(dialog, "radiogroup", "Collection shop")), "Tab wraps to Collection shop")
                page.keyboard.press("Shift+Tab")
                focus_is(page, button(dialog, "Close checkout"))
            scroll = page.evaluate("window.scrollY")
            page.mouse.wheel(0, 300)
            advance(page, STEP_MS)
            assert page.evaluate("window.scrollY") == scroll, "the page behind scrolled"
            page.keyboard.press("Escape")
            soon(page, lambda: page.url.endswith("/cart"), "Escape restores /cart")
            soon(page, lambda: checkout_dialog(page).count() == 0, "dialog closes")
            focus_is(page, opener)
    ok(shopper.put(line_url("FITA-48"), {"quantity": 0}))


def test_checkout_survives_reload(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, ANA)
    set_available(app_url, "AT06", "FITA-48", 10)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    with screen(browser, app_url, ANA, "/cart", PHONE) as page:
        dialog = open_checkout(page)
        choose_slot(page)
        fill_contact(page, "Ana Ribeiro", "ana@tramela.example")
        days = role(dialog, "radiogroup", "Collection day").get_by_role("radio")
        day_checked = next(txt_name for txt_name in [r.get_attribute("aria-label") or r.evaluate("e => e.labels && e.labels[0] ? e.labels[0].innerText : e.textContent") for r in days.all() if r.is_checked()])
        time_group = role(dialog, "radiogroup", "Collection time").get_by_role("radio")
        time_checked = [r.evaluate("e => (e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].innerText) || e.textContent).trim()") for r in time_group.all() if r.is_checked()]
        email_box = role(dialog, "textbox", "Email")
        email_box.focus()
        scrolled = email_box.evaluate("""e => { let n = e.parentElement;
            while (n && n.scrollHeight <= n.clientHeight) n = n.parentElement;
            if (!n) return 0; n.scrollTop = 120; return n.scrollTop; }""")
        page.reload()
        dialog = checkout_dialog(page)
        visible(page, dialog)
        assert page.url.endswith("/cart?checkout=open")
        email_box = role(dialog, "textbox", "Email")
        soon(page, lambda: email_box.input_value() == "ana@tramela.example", "email restored")
        assert role(dialog, "textbox", "Full name").input_value() == "Ana Ribeiro"
        focus_is(page, email_box)
        shop_radio = role(dialog, "radiogroup", "Collection shop").get_by_role("radio", name=re.compile("^Loja Olhão, "))
        visible(page, shop_radio)
        assert shop_radio.is_checked()
        times = role(dialog, "radiogroup", "Collection time").get_by_role("radio")
        soon(page, lambda: [r.evaluate("e => (e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].innerText) || e.textContent).trim()") for r in times.all() if r.is_checked()] == time_checked, "time restored")
        assert day_checked is not None
        restored = email_box.evaluate("""e => { let n = e.parentElement;
            while (n && n.scrollHeight <= n.clientHeight) n = n.parentElement;
            return n ? n.scrollTop : 0; }""")
        assert abs(restored - scrolled) <= 10, f"dialog scroll {restored} vs {scrolled}"
    reset_shopper(shopper)


def test_lost_line_beneath_checkout(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, BRUNO)
    manager = Api(app_url, TIAGO)
    set_available(app_url, "AT06", "FITA-48", 1)
    set_available(app_url, "AT06", "TES-POD", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1, "TES-POD": 1})
    with screen(browser, app_url, BRUNO, "/cart", DESKTOP) as page:
        dialog = open_checkout(page)
        name = role(dialog, "textbox", "Full name")
        name.focus()
        page.keyboard.type("Bruno")
        total = tagged(dialog, "data-figure", "checkout-total")
        has_attr(page, total, "data-value", str(FITA_UNIT + TES_POD_CENTS))
        node = checkout_dialog(page).element_handle()
        ok(manager.post(till_url("AT06"), {"sku": "FITA-48", "quantity": 1}, key=request_key()), 201)
        advance(page, POLL_MS)
        lines = role(dialog, "list", "Checkout lines")
        soon(page, lambda: "Only 0 left at Loja Olhão." in txt(lines), "the short-line message within five seconds", step=10)
        has_attr(page, total, "data-value", "1249")
        says(page, status(page, "Checkout total"), f"Cart total {euro(1249)}.")
        assert focused(name) and name.input_value() == "Bruno", "focus or field disturbed"
        assert checkout_dialog(page).evaluate("(e, n) => e === n", node), "the dialog was rebuilt"
    reset_shopper(shopper)


@pytest.mark.parametrize("size", TWO_SIZES, ids=TWO_SIZES)
def test_wf_checkout_keyboard_to_order(browser: Any, app_url: str, mail: Any, size: str) -> None:
    shopper = Api(app_url, EVA)
    set_available(app_url, "AT06", "FITA-48", 10)
    fill_cart(shopper, "AT06", {"FITA-48": 3})
    customer = own_email("teclado")
    with screen(browser, app_url, EVA, "/cart", size) as page:
        opener = button(page, "Checkout")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dialog = checkout_dialog(page)
        visible(page, dialog)
        hold_button = button(dialog, "Hold items")
        tab_to(page, hold_button)
        page.keyboard.press("Enter")
        visible(page, role(dialog, "timer", "Hold time left"))
        says(page, status(page, "Hold status"), "Items held at Loja Olhão.")
        tab_to(page, role(dialog, "radiogroup", "Collection day"), inside=True)
        page.keyboard.press("Space")
        times = role(dialog, "radiogroup", "Collection time").get_by_role("radio")
        visible(page, times)
        tab_to(page, role(dialog, "radiogroup", "Collection time"), inside=True)
        page.keyboard.press("Space")
        tab_to(page, role(dialog, "textbox", "Full name"))
        page.keyboard.type("Eva Couto")
        page.keyboard.press("Tab")
        focus_is(page, role(dialog, "textbox", "Email"))
        page.keyboard.type(customer)
        page.keyboard.press("Tab")
        focus_is(page, button(dialog, "Place order"))
        page.keyboard.press("Enter")
        order_id = order_page_id(page)
        order = ok(shopper.get(f"/api/orders/{order_id}"))
        assert order["customer"]["email"] == customer and order["total_cents"] == FITA_THREE and order["status"] == "placed"
        heading = role(page, "heading", f"Order {order['number']}")
        focus_is(page, heading)
        assert ok(shopper.get("/api/cart"))["lines"] == [], "the order empties the cart"
    mails = mails_to(mail, customer)
    assert len(mails) == 1 and order["number"] in mails[0]["Subject"]


def test_wf_checkout_reduced_motion(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, FILIPE)
    manager = Api(app_url, TIAGO)
    set_available(app_url, "AT06", "FITA-48", 1)
    set_available(app_url, "AT06", "TES-POD", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1, "TES-POD": 1})
    with screen(browser, app_url, FILIPE, "/cart", DESKTOP, reduced=True) as page:
        click(visible(page, button(page, "Checkout")))
        dialog = checkout_dialog(page)
        visible(page, dialog)
        has_attr(page, dialog, "data-state", "open")
        node = dialog.element_handle()
        total = tagged(dialog, "data-figure", "checkout-total")
        has_attr(page, total, "data-value", str(FITA_UNIT + TES_POD_CENTS))
        total_node = total.element_handle()
        ok(manager.post(till_url("AT06"), {"sku": "FITA-48", "quantity": 1}, key=request_key()), 201)
        advance(page, POLL_MS)
        soon(page, lambda: attr(total, "data-value") == "1249", "the total changes", step=10)
        assert "true" not in values_of(total_node, "data-counting") and attr(total, "data-counting") == "false"
        assert euro(1249) in txt(total), "shown value equals the final value at once"
        says(page, status(page, "Checkout total"), f"Cart total {euro(1249)}.")
        page.keyboard.press("Escape")
        soon(page, lambda: checkout_dialog(page).count() == 0, "checkout closes")
        states = values_of(node, "data-state")
        assert "opening" not in states and "closing" not in states, states
    reset_shopper(shopper)


def test_holds_on_server_clock(app_url: str) -> None:
    base = short_hold()
    shopper = Api(base, ANA)
    set_available(base, "AT06", "FITA-48", 4)
    fill_cart(shopper, "AT06", {"FITA-48": 2})
    hold = ok(shopper.post("/api/holds", {}), 201)
    window = datetime.fromisoformat(hold["expires_at"].replace("Z", "+00:00")) - datetime.fromisoformat(hold["created_at"].replace("Z", "+00:00"))
    assert window.total_seconds() == SHORT_HOLD and 0 < hold["seconds_left"] <= SHORT_HOLD and hold["status"] == "active"
    assert hold["lines"] == [{"sku": "FITA-48", "quantity": 2}]
    again = shopper.post("/api/holds", {})
    assert again.status_code == 409 and again.json() == {"code": "hold_active", "hold_id": hold["id"]}
    line = lambda: next(i for i in ok(Api(base, TIAGO).get(stock_url("AT06")))["lines"] if i["sku"] == "FITA-48")
    assert line()["held"] == 2
    expiry = poll(lambda: (lambda a: a if a["status"] == "released" else None)(ok(shopper.get(f"/api/holds/{hold['id']}"))),
                  "GET /api/holds answers released once the window ended", SHORT_HOLD + 5)
    assert expiry["seconds_left"] == 0 and expiry["released_at"]
    released_at = datetime.fromisoformat(expiry["released_at"].replace("Z", "+00:00"))
    assert released_at >= datetime.fromisoformat(hold["expires_at"].replace("Z", "+00:00")), "released before expiry"
    assert line()["held"] == 0 and line()["on_hand"] == line()["available"]
    shopper = Api(app_url, BRUNO)
    set_available(app_url, "AT06", "CAD-40", 5)
    set_available(app_url, "AT06", "FITA-48", 0)
    fill_cart(shopper, "AT06", {"FITA-48": 1, "CAD-40": 1})
    refused = shopper.post("/api/holds", {})
    assert refused.status_code == 409
    assert refused.json() == {"code": "stock_conflict", "store_id": "AT06", "sku": "FITA-48", "remaining": 0}
    stock = {i["sku"]: i for i in ok(Api(app_url, TIAGO).get(stock_url("AT06")))["lines"]}
    assert stock["CAD-40"]["available"] == 5, "a refused hold kept a unit"
    set_available(app_url, "AT06", "FITA-48", 3)
    set_available(app_url, "AT06", "CAD-40", 3)
    people = [Api(app_url if i % 2 else twin(), e) for i, e in enumerate(SHOPPERS)]
    for person, lines in zip(people, [{"CAD-40": 1, "FITA-48": 1}, {"FITA-48": 1, "CAD-40": 1}] * 3):
        fill_cart(person, "AT06", lines)
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda p: p.post("/api/holds", {}), people))
    codes = sorted(a.status_code for a in answers)
    assert codes == [201, 201, 201, 409, 409, 409], [a.text for a in answers]
    assert all(a.json()["code"] == "stock_conflict" for a in answers if a.status_code == 409)
    for person in people:
        reset_shopper(person)
    assert shopper.post("/api/holds", {}).status_code == 422 if ok(shopper.get("/api/cart"))["lines"] == [] else True


def test_single_release_of_hold(app_url: str) -> None:
    shopper = Api(app_url, ANA)
    set_available(app_url, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 2})
    stock = lambda base=app_url: next(i for i in ok(Api(base, TIAGO).get(stock_url("AT06")))["lines"] if i["sku"] == "FITA-48")
    before = stock()
    hold = ok(shopper.post("/api/holds", {}), 201)
    assert stock()["held"] == before["held"] + 2
    copies = [Api(app_url, ANA) if i % 2 else Api(twin(), ANA) for i in range(8)]
    with ThreadPoolExecutor(8) as pool:
        answers = list(pool.map(lambda p: p.delete(f"/api/holds/{hold['id']}"), copies))
    wins = [a for a in answers if a.status_code == 200]
    assert len(wins) == 1, [a.status_code for a in answers]
    assert all(a.status_code == 409 and a.json()["code"] == "invalid_transition" for a in answers if a.status_code != 200)
    assert wins[0].json()["status"] == "released"
    assert stock()["held"] == before["held"] and stock()["available"] == before["available"]
    base = short_hold()
    shopper = Api(base, BRUNO)
    set_available(base, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 2})
    hold = ok(shopper.post("/api/holds", {}), 201)
    manager = Api(base, TIAGO)
    fita = lambda: next(i for i in ok(manager.get(stock_url("AT06")))["lines"] if i["sku"] == "FITA-48")
    assert fita()["held"] == 2
    poll(lambda: fita()["held"] == 0, "the sweep returns the units", SHORT_HOLD + 10)
    assert fita()["available"] == 5, "units returned twice or not at all"
    late = shopper.delete(f"/api/holds/{hold['id']}")
    assert late.status_code == 409 and late.json() == {"code": "invalid_transition", "from": "released", "to": "released"}
    assert fita()["available"] == 5
    assert ok(shopper.get(f"/api/holds/{hold['id']}"))["status"] == "released"


def test_hold_countdown_follows_server(browser: Any) -> None:
    base = short_hold()
    shopper = Api(base, EVA)
    set_available(base, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    with screen(browser, base, EVA, "/cart", DESKTOP) as page:
        page.clock.set_system_time(datetime(2031, 1, 5, 3, 0, tzinfo=timezone.utc))
        dialog = open_checkout(page)
        hold_status = status(page, "Hold status")
        track(hold_status)
        name = role(dialog, "textbox", "Full name")
        fill(name, "Eva Couto")
        click(button(dialog, "Hold items"))
        timer = role(dialog, "timer", "Hold time left")
        visible(page, timer)
        soon(page, lambda: attr(timer, "data-hold-state") == "active", "hold state from the answer", 10, 0)
        shown = int(attr(timer, "data-seconds-left"))
        assert 0 < shown <= SHORT_HOLD, f"countdown {shown}"
        assert txt(timer) == f"0:{shown:02d}"
        assert attr(timer, "data-hold-fraction") == f"{shown / SHORT_HOLD:.3f}"
        name.focus()
        with held(page, "**/api/{holds/*,cart}") as release:
            soon(page, lambda: attr(timer, "data-seconds-left") == "0", "the countdown reaches zero", step=STEP_MS)
            assert txt(timer) == "0:00"
            has_attr(page, timer, "data-hold-state", "checking")
            says(page, hold_status, "Checking your hold...")
            assert "Your hold has ended. Hold again to keep these items." not in announced(hold_status)
            release()
        says(page, hold_status, "Your hold has ended. Hold again to keep these items.")
        has_attr(page, timer, "data-hold-state", "released")
        visible(page, button(dialog, "Hold again"))
        said = announced(hold_status)
        assert said.count("One minute left on your hold.") == 1, said
        assert said.count("Your hold has ended. Hold again to keep these items.") == 1, said
        assert checkout_dialog(page).count() == 1 and page.url.endswith("/cart?checkout=open")
        assert name.input_value() == "Eva Couto"
        assert focused(name), "the hold ending moved focus"
        assert attr(checkout_dialog(page), "data-state") == "open"
    reset_shopper(shopper)


@pytest.mark.parametrize("size", TWO_SIZES, ids=TWO_SIZES)
def test_wf_stock_hold_hold_again(browser: Any, mail: Any, size: str) -> None:
    base = short_hold()
    shopper = Api(base, FILIPE)
    set_available(base, "AT06", "FITA-48", 6)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    customer = own_email("novamente")
    with screen(browser, base, FILIPE, "/cart", size) as page:
        sent = placements(page)
        dialog = open_checkout(page)
        choose_slot(page)
        fill_contact(page, "Filipe Rocha", customer)
        button(dialog, "Hold items").focus()
        page.keyboard.press("Enter")
        visible(page, role(dialog, "timer", "Hold time left"))
        hold_id = ok(shopper.get("/api/cart"))["hold"]["id"]
        poll(lambda: ok(shopper.get(f"/api/holds/{hold_id}"))["status"] == "released", "the hold window ends on the server", SHORT_HOLD + 5)
        button(dialog, "Place order").focus()
        page.keyboard.press("Enter")
        again = button(dialog, "Hold again")
        visible(page, again)
        says(page, status(page, "Checkout messages"), "Your hold has ended. Hold again to keep these items.")
        focus_is(page, again)
        assert len(sent) == 1
        old_key, old_body = sent[0]
        page.keyboard.press("Enter")
        soon(page, lambda: attr(role(dialog, "timer", "Hold time left"), "data-hold-state") == "active", "a new hold", 10, 0)
        button(dialog, "Place order").focus()
        page.keyboard.press("Enter")
        order_id = order_page_id(page)
        assert len(sent) == 2
        new_key, new_body = sent[1]
        assert new_key != old_key and new_body["hold_id"] != old_body["hold_id"]
        assert new_body["customer"] == old_body["customer"]
        assert ok(shopper.get(f"/api/orders/{order_id}"))["customer"]["email"] == customer
    replay = shopper.post("/api/orders", old_body, key=old_key)
    assert replay.status_code == 409 and replay.json() == {"code": "hold_expired", "hold_id": old_body["hold_id"]}
    assert ok(shopper.get("/api/orders", q=customer))["count"] == 1
    assert len(mails_to(mail, customer)) == 1


def test_held_checkout_survives_reload(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, GIL)
    set_available(app_url, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    with screen(browser, app_url, GIL, "/cart", DESKTOP) as page:
        dialog = open_checkout(page)
        press_hold(page)
        hold = ok(shopper.get("/api/cart"))["hold"]
        poll(lambda: ok(shopper.get(f"/api/holds/{hold['id']}"))["seconds_left"] < hold["seconds_left"] - 1, "the server's remaining time falls")
        name = role(dialog, "textbox", "Full name")
        name.focus()
        with held(page, "**/api/{holds/*,cart}") as release:
            page.reload()
            dialog = checkout_dialog(page)
            deadline = time.monotonic() + 5
            while not dialog.count() and time.monotonic() < deadline:
                advance(page, 0)
            timer = role(dialog, "timer", "Hold time left")
            assert timer.count() == 0 or txt(timer) == "", "the timer showed a value before the server answered"
            if timer.count():
                assert attr(timer, "data-hold-state") == "checking"
            release()
        soon(page, lambda: dialog.count() == 1, "the dialog is back", step=0)
        timer = role(dialog, "timer", "Hold time left")
        visible(page, timer)
        soon(page, lambda: attr(timer, "data-hold-state") == "active", "hold state active", step=0)
        left = ok(shopper.get(f"/api/holds/{hold['id']}"))["seconds_left"]
        shown = int(attr(timer, "data-seconds-left"))
        assert shown >= left - 2 and shown < hold["seconds_left"], f"shown {shown}, server {left}, started {hold['seconds_left']}"
        assert txt(timer) == f"{shown // 60}:{shown % 60:02d}"
        focus_is(page, role(dialog, "textbox", "Full name"))
        assert attr(timer, "data-hold-fraction") == f"{shown / 600:.3f}"
    reset_shopper(shopper)


def test_wf_stock_hold_touch(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, HELENA)
    set_available(app_url, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    stock = lambda: next(i for i in ok(Api(app_url, TIAGO).get(stock_url("AT06")))["lines"] if i["sku"] == "FITA-48")
    with screen(browser, app_url, HELENA, "/cart", PHONE) as page:
        tap(visible(page, button(page, "Checkout")))
        dialog = checkout_dialog(page)
        visible(page, dialog)
        has_attr(page, dialog, "data-state", "open")
        settled(page, dialog, "the checkout dialog")
        found = box(dialog)
        assert found["width"] == 375 and found["height"] == 812, found
        hold_button = button(dialog, "Hold items")
        assert box(hold_button)["height"] >= MIN_TARGET
        tap(hold_button)
        timer = role(dialog, "timer", "Hold time left")
        visible(page, timer)
        says(page, status(page, "Hold status"), "Items held at Loja Olhão.")
        assert box(timer)["height"] >= MIN_TARGET
        assert ok(shopper.get("/api/cart"))["hold"]["status"] == "active"
        assert stock()["held"] == 1
        release_button = button(dialog, "Release hold")
        assert box(release_button)["height"] >= MIN_TARGET
        tap(release_button)
        visible(page, button(dialog, "Hold items"))
        cart_hold = ok(shopper.get("/api/cart"))["hold"]
        assert stock()["held"] == 0 and (cart_hold is None or cart_hold["status"] == "released"), cart_hold
        assert dialog.evaluate(CONTENT_INSIDE_JS), "the dialog's content spills out of it instead of scrolling inside it"
        no_sideways(page)
    reset_shopper(shopper)


def test_last_unit_one_winner(app_url: str) -> None:
    people = [Api(app_url if i % 2 else twin(), e) for i, e in enumerate(SHOPPERS)]
    set_available(app_url, "AT06", "MANG-25", 7)
    for person in people:
        fill_cart(person, "AT06", {"MANG-25": 1})
    set_available(app_url, "AT06", "MANG-25", 1)
    till = Api(twin(), TIAGO)

    def claim(index: int) -> httpx.Response:
        if index == len(people):
            return till.post(till_url("AT06"), {"sku": "MANG-25", "quantity": 1}, key=request_key())
        return people[index].post("/api/holds", {})

    with ThreadPoolExecutor(7) as pool:
        answers = list(pool.map(claim, range(7)))
    wins = [a for a in answers if a.status_code == 201]
    losers = [a for a in answers if a.status_code != 201]
    assert len(wins) == 1, [a.status_code for a in answers]
    assert len(losers) == 6
    for loser in losers:
        assert loser.status_code == 409
        assert loser.json() == {"code": "stock_conflict", "store_id": "AT06", "sku": "MANG-25", "remaining": 0}
    line = next(i for i in ok(Api(app_url, TIAGO).get(stock_url("AT06")))["lines"] if i["sku"] == "MANG-25")
    assert line["available"] == 0 and line["on_hand"] >= 0 and line["held"] <= line["on_hand"]
    for person in people:
        reset_shopper(person)


def test_till_sales_and_counts(app_url: str) -> None:
    manager = Api(app_url, TIAGO)
    copy = Api(twin(), TIAGO)
    path = till_url("AT06")
    set_available(app_url, "AT06", "TES-POD", 5)
    on_hand = lambda: next(i for i in ok(manager.get(stock_url("AT06")))["lines"] if i["sku"] == "TES-POD")
    start = on_hand()["on_hand"]
    key = request_key()
    first = manager.post(path, {"sku": "TES-POD", "quantity": 2}, key=key)
    body = ok(first, 201)
    assert body["sku"] == "TES-POD" and body["store_id"] == "AT06" and body["on_hand"] == start - 2
    assert body["available"] == body["on_hand"] - body["held"]
    replay = copy.post(path, {"quantity": 2, "sku": "TES-POD"}, key=key)
    assert replay.status_code == 201 and replay.content == first.content
    assert on_hand()["on_hand"] == start - 2, "a replay moved the stock"
    reuse = copy.post(path, {"sku": "TES-POD", "quantity": 1}, key=key)
    assert reuse.status_code == 409 and reuse.json() == {"code": "request_key_reuse"}
    for bad in (None, "short", "not valid key!"):
        answer = manager.post(path, {"sku": "TES-POD", "quantity": 1}, key=bad) if bad else manager.post(path, {"sku": "TES-POD", "quantity": 1})
        assert answer.status_code == 422 and "request_key" in answer.json()["errors"], f"{bad}: {answer.text}"
    conflict_key = request_key()
    conflict = manager.post(path, {"sku": "TES-POD", "quantity": 999}, key=conflict_key)
    assert conflict.status_code == 409
    assert conflict.json() == {"code": "stock_conflict", "store_id": "AT06", "sku": "TES-POD", "remaining": start - 2}
    set_available(app_url, "AT06", "TES-POD", 11)
    stored = copy.post(path, {"sku": "TES-POD", "quantity": 999}, key=conflict_key)
    assert stored.status_code == 409 and stored.content == conflict.content, "a stored conflict replays with its remaining"
    invalid = manager.post(path, {"sku": "TES-POD", "quantity": 0}, key=request_key())
    assert invalid.status_code == 422
    race_key = request_key()
    level = on_hand()["on_hand"]
    clients = [Api(app_url if i % 2 else twin(), TIAGO) for i in range(8)]
    with ThreadPoolExecutor(8) as pool:
        racers = list(pool.map(lambda c: c.post(path, {"sku": "TES-POD", "quantity": 1}, key=race_key), clients))
    assert on_hand()["on_hand"] == level - 1, "one key moved stock more than once"
    for answer in racers:
        assert answer.status_code == 201 or (answer.status_code == 409 and answer.json() == {"code": "request_in_progress"}), answer.text
    assert any(a.status_code == 201 for a in racers)
    shopper = Api(app_url, GIL)
    fill_cart(shopper, "AT06", {"TES-POD": 2})
    ok(shopper.post("/api/holds", {}), 201)
    held_now = on_hand()["held"]
    below = manager.post(count_url("AT06", "TES-POD"), {"on_hand": held_now - 1})
    assert below.status_code == 409 and below.json() == {"code": "below_held", "held": held_now}
    counted = ok(manager.post(count_url("AT06", "TES-POD"), {"on_hand": held_now + 4}))
    assert counted["on_hand"] == held_now + 4 and counted["available"] == 4 and counted["critical"] is False
    assert manager.post(count_url("AT06", "TES-POD"), {"on_hand": 100000}).status_code == 422
    reset_shopper(shopper)


def test_derived_counters_agree(app_url: str) -> None:
    heal_store(app_url, "AT01")
    lead = Api(app_url, LEAD)
    shopper = Api(app_url, ANA)
    manager = Api(app_url, RUI)
    set_available(app_url, "AT01", "FITA-48", 10)

    def agree(on_hand: int, critical: bool, available: int) -> None:
        stock = next(i for i in ok(manager.get(stock_url("AT01")))["lines"] if i["sku"] == "TE-BR-4L")
        assert stock["on_hand"] == on_hand and stock["critical"] is critical and stock["available"] == available, stock
        store = ok(lead.get(store_url("AT01")))
        assert store["critical_lines"] == (1 if critical else 0)
        assert (store["display_state"] == "stock_critical") is critical, store
        listed = [s["id"] for s in ok(lead.get("/api/stores", state="stock_critical"))["stores"]]
        assert ("AT01" in listed) is critical
        shop = next(s for s in ok(shopper.get(avail_url("TE-BR-4L"), **LISBOA))["shops"] if s["store_id"] == "AT01")
        assert shop["on_hand"] == on_hand and shop["available"] == available and shop["display_state"] == store["display_state"]

    fill_cart(shopper, "AT01", {"TE-BR-4L": 2}, LISBOA)
    set_available(app_url, "AT01", "TE-BR-4L", 5)
    agree(5, False, 5)
    ok(manager.post(till_url("AT01"), {"sku": "TE-BR-4L", "quantity": 3}, key=request_key()), 201)
    agree(2, True, 2)
    assert ok(shopper.get("/api/cart"))["lines"][0]["status"] == "ok"
    ok(manager.post(count_url("AT01", "TE-BR-4L"), {"on_hand": 1}))
    agree(1, True, 1)
    cart = ok(shopper.get("/api/cart"))
    assert cart["lines"][0]["status"] == "short" and cart["lines"][0]["available"] == 1 and cart["total_cents"] == 0
    ok(manager.post(count_url("AT01", "TE-BR-4L"), {"on_hand": 6}))
    agree(6, False, 6)
    hold = ok(shopper.post("/api/holds", {}), 201)
    agree(6, False, 4)
    cart = ok(shopper.get("/api/cart"))
    assert cart["lines"][0]["available"] == 6 and cart["lines"][0]["status"] == "ok", "own hold counts for the cart"
    slot = offered_slot(shopper, "AT01")
    order = ok(shopper.post("/api/orders", {"hold_id": hold["id"], "slot_start_utc": slot["start_utc"],
                                            "customer": {"name": "Ana", "email": own_email()}}, key=request_key()), 201)
    agree(4, False, 4)
    ok(manager.post(f"/api/orders/{order['id']}/transitions", {"to": "cancelled"}))
    agree(6, False, 6)
    done = new_order(app_url, ANA, "AT01", "TE-BR-4L", 4, stocked=True)
    agree(2, True, 2)
    move_order(manager, done["id"], "picking", "ready", "collected")
    ret = ok(manager.post(f"/api/orders/{done['id']}/returns", {"lines": [{"sku": "TE-BR-4L", "quantity": 1}], "reason": "Teste"}), 201)
    agree(2, True, 2)
    ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "received"}))
    agree(3, False, 3)
    reset_shopper(shopper)
    heal_store(app_url, "AT01")


def test_conflict_dialog(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, BRUNO)
    set_available(app_url, "AT06", "FITA-48", 1)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    with screen(browser, app_url, BRUNO, "/cart", DESKTOP) as page:
        dialog = open_checkout(page)
        ok(Api(app_url, TIAGO).post(till_url("AT06"), {"sku": "FITA-48", "quantity": 1}, key=request_key()), 201)
        hold_button = button(dialog, "Hold items")
        hold_button.focus()
        page.keyboard.press("Enter")
        alert = role(page, "alertdialog", "Stock changed")
        visible(page, alert)
        node = alert.element_handle()
        has_attr(page, alert, "data-state", "open")
        assert "Only 0 left at Loja Olhão." in txt(alert)
        says(page, status(page, "Checkout messages"), "Only 0 left at Loja Olhão.")
        assert_span(events_of(node, "data-state"), "opening", "open", STATE_MIN_MS, STATE_MAX_MS)
        found = box(alert)
        assert 520 <= found["width"] <= 600 and abs(found["x"] + found["width"] / 2 - 640) <= 8, found
        remove, back = button(alert, "Remove line"), button(alert, "Back to checkout")
        focus_is(page, remove)
        assert tab_order(page, 3) == ["Back to checkout", "Remove line", "Back to checkout"]
        page.keyboard.press("Escape")
        soon(page, lambda: role(page, "alertdialog", "Stock changed").count() == 0, "Escape closes Stock changed", step=FINE_MS)
        assert "closing" in values_of(node, "data-state")
        focus_is(page, hold_button)
        assert checkout_dialog(page).count() == 1, "Escape closed checkout too"
        assert ok(shopper.get("/api/cart"))["lines"], "Escape removed the line"
        page.keyboard.press("Enter")
        visible(page, alert)
        focus_is(page, remove)
        page.keyboard.press("Enter")
        soon(page, lambda: role(page, "alertdialog", "Stock changed").count() == 0, "Remove line closes the dialog")
        focus_is(page, button(checkout_dialog(page), "Hold items"))
        assert ok(shopper.get("/api/cart"))["lines"] == [], "Remove line deletes the named line"
    reset_shopper(shopper)


@pytest.mark.parametrize("size", TWO_SIZES, ids=TWO_SIZES)
def test_wf_last_unit_till_sale_journey(browser: Any, app_url: str, size: str) -> None:
    set_available(app_url, "AT06", "CAD-40", 1)
    set_available(app_url, "AT06", "FITA-48", 5)
    heal_store(app_url, "AT01")
    set_available(app_url, "AT01", "TE-BR-4L", 3)
    bruno = Api(app_url, BRUNO)
    fill_cart(bruno, "AT06", {"CAD-40": 1, "FITA-48": 1})
    manager_read = Api(app_url, TIAGO)
    try:
        with screen(browser, app_url, BRUNO, "/cart", DESKTOP) as shopper_page, \
                screen(browser, app_url, TIAGO, "/shop/AT06", size) as till_page, \
                screen(browser, app_url, LEAD, "/estate", DESKTOP) as lead_page:
            dialog = open_checkout(shopper_page)
            estate_ready(lead_page)
            zoom_to_markers(lead_page)
            lead_node = marker(lead_page, "AT01").element_handle()
            section_open(till_page, "Stock", size)
            opener = button(till_page, "Record till sale")
            visible(till_page, opener)
            keys = []
            dropped = []

            def drop_first(route: Any) -> None:
                keys.append(route.request.headers.get("request-key"))
                if not dropped:
                    dropped.append(1)
                    route.fetch()
                    route.abort("connectionreset")
                else:
                    route.fallback()

            till_page.route("**" + till_url("AT06"), drop_first)
            tab_to(till_page, opener, presses=40)
            till_page.keyboard.press("Enter")
            sale = role(till_page, "dialog", "Till sale")
            visible(till_page, sale)
            select(role(sale, "combobox", "Item"), "CAD-40 Cadeado latão 40 mm")
            tab_to(till_page, role(sale, "spinbutton", "Units"))
            till_page.keyboard.press("Control+A")
            till_page.keyboard.type("1")
            tab_to(till_page, button(sale, "Record sale"))
            till_page.keyboard.press("Enter")
            soon(till_page, lambda: dropped, "the first answer dropped")
            soon(till_page, lambda: attr(button(sale, "Record sale"), "aria-disabled") != "true", "the dialog can retry")
            button(sale, "Record sale").focus()
            till_page.keyboard.press("Enter")
            says(till_page, status(till_page, "Shop updates"), "Till sale recorded.")
            assert len(keys) == 2 and keys[0] == keys[1], f"the retry must reuse its key: {keys}"
            line = next(i for i in ok(manager_read.get(stock_url("AT06")))["lines"] if i["sku"] == "CAD-40")
            assert line["available"] == 0, "stock falls exactly once"
            assert line["on_hand"] == line["held"]
            advance(shopper_page, POLL_MS)
            lines = role(dialog, "list", "Checkout lines")
            soon(shopper_page, lambda: "Only 0 left at Loja Olhão." in txt(lines), "the line shortens in place", step=10)
            has_attr(shopper_page, tagged(dialog, "data-figure", "checkout-total"), "data-value", "500")
            says(shopper_page, status(shopper_page, "Checkout total"), "Cart total 5,00 €.")
            button(dialog, "Hold items").focus()
            shopper_page.keyboard.press("Enter")
            alert = role(shopper_page, "alertdialog", "Stock changed")
            visible(shopper_page, alert)
            assert "Only 0 left at Loja Olhão." in txt(alert)
            focus_is(shopper_page, button(alert, "Remove line"))
            shopper_page.keyboard.press("Enter")
            soon(shopper_page, lambda: alert.count() == 0, "Remove line closes the dialog")
            focus_is(shopper_page, button(dialog, "Hold items"))
            assert [i["sku"] for i in ok(bruno.get("/api/cart"))["lines"]] == ["FITA-48"]
            ok(Api(app_url, RUI).post(till_url("AT01"), {"sku": "TE-BR-4L", "quantity": 1}, key=request_key()), 201)
            advance(lead_page, POLL_MS)
            soon(lead_page, lambda: attr(marker(lead_page, "AT01"), "data-marker-state") == "stock_critical", "the marker restates without a reload", step=10)
            assert button(lead_page, "Open Loja Lisboa Baixa, stock critical, critical lines: 1").count() == 1
            assert marker(lead_page, "AT01").evaluate("(e, n) => e === n", lead_node), "the marker node was replaced"
    finally:
        reset_shopper(bruno)
        heal_store(app_url, "AT01")


def test_wf_last_unit_total_counts_down(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, ANA)
    manager = Api(app_url, TIAGO)
    set_available(app_url, "AT06", "FITA-48", 1)
    set_available(app_url, "AT06", "TES-POD", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1, "TES-POD": 1})
    with screen(browser, app_url, ANA, "/cart", DESKTOP) as page:
        dialog = open_checkout(page)
        close = button(dialog, "Close checkout")
        close.focus()
        total = tagged(dialog, "data-figure", "checkout-total")
        has_attr(page, total, "data-value", str(FITA_UNIT + TES_POD_CENTS))
        node = total.element_handle()
        region = status(page, "Checkout total")
        track(region)
        ok(manager.post(till_url("AT06"), {"sku": "FITA-48", "quantity": 1}, key=request_key()), 201)
        soon(page, lambda: attr(total, "data-value") == "1249", "data-value final from the first frame", seconds=60, step=10)
        assert attr(total, "data-counting") == "true", "the figure must count"
        midway = txt(total)
        soon(page, lambda: attr(total, "data-counting") == "false", "the figure settles", step=FINE_MS)
        assert_span(events_of(node, "data-counting"), "true", "false", FIG_MIN_MS, FIG_MAX_MS)
        assert midway != euro(FITA_UNIT + TES_POD_CENTS) or txt(total) == euro(TES_POD_CENTS)
        assert euro(1249) in txt(total)
        assert total.evaluate("(e, n) => e === n", node), "figure replaced"
        assert "tabular" in style(total, "font-variant-numeric")["font-variant-numeric"]
        assert announced(region) == [f"Cart total {euro(1249)}."], announced(region)
        assert focused(close), "focus moved"
    reset_shopper(shopper)


def test_request_keys_on_order(app_url: str, mail: Any) -> None:
    shopper = Api(app_url, GIL)
    copy = Api(twin(), GIL)
    set_available(app_url, "AT06", "FITA-48", 6)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    hold = ok(shopper.post("/api/holds", {}), 201)
    slot = offered_slot(shopper, "AT06")
    customer = own_email("chave")
    body = {"hold_id": hold["id"], "slot_start_utc": slot["start_utc"], "customer": {"name": "Gil", "email": customer}}
    for bad in (None, "short"):
        answer = shopper.post("/api/orders", body, key=bad) if bad else shopper.post("/api/orders", body)
        assert answer.status_code == 422 and "request_key" in answer.json()["errors"]
    key = request_key()
    first = shopper.post("/api/orders", body, key=key)
    order = ok(first, 201)
    shuffled = {"customer": {"email": customer, "name": "Gil"}, "slot_start_utc": slot["start_utc"], "hold_id": hold["id"]}
    replay = copy.post("/api/orders", shuffled, key=key)
    assert replay.status_code == 201 and replay.content == first.content
    assert ok(shopper.get("/api/orders", q=customer))["count"] == 1
    events = ok(Api(app_url, CARE).get(f"/api/orders/{order['id']}/events"))["events"]
    assert [e["type"] for e in events] == ["order.placed"], "a replay added history"
    assert len(Postgres().rows(f"SELECT seq FROM order_events WHERE order_id = '{order['id']}'")) == 1
    assert len(mails_to(mail, customer)) == 1
    reuse = copy.post("/api/orders", {**body, "customer": {"name": "Outro", "email": customer}}, key=key)
    assert reuse.status_code == 409 and reuse.json() == {"code": "request_key_reuse"}
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    hold = ok(shopper.post("/api/holds", {}), 201)
    customer = own_email("corrida")
    race = {"hold_id": hold["id"], "slot_start_utc": offered_slot(shopper, "AT06")["start_utc"], "customer": {"name": "Gil", "email": customer}}
    key = request_key()
    clients = [Api(app_url if i % 2 else twin(), GIL) for i in range(8)]
    with ThreadPoolExecutor(8) as pool:
        answers = list(pool.map(lambda c: c.post("/api/orders", race, key=key), clients))
    wins = [a for a in answers if a.status_code == 201]
    assert wins and len({a.content for a in wins}) == 1, [a.status_code for a in answers]
    for answer in answers:
        assert answer.status_code == 201 or answer.json() == {"code": "request_in_progress"}, answer.text
    assert ok(shopper.get("/api/orders", q=customer))["count"] == 1
    assert len(mails_to(mail, customer)) == 1
    other = request_key()
    converted = shopper.post("/api/orders", race, key=other)
    assert converted.status_code == 409 and converted.json()["code"] == "invalid_transition"
    assert copy.post("/api/orders", race, key=other).content == converted.content


def test_wf_repeat_submit_one_order_per_press(browser: Any, app_url: str, mail: Any) -> None:
    shopper = Api(app_url, FILIPE)
    set_available(app_url, "AT06", "FITA-48", 6)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    customer = own_email("duplo")
    with screen(browser, app_url, FILIPE, "/cart", DESKTOP) as page:
        sent = placements(page)
        dialog = open_checkout(page)
        press_hold(page)
        choose_slot(page)
        fill_contact(page, "Filipe Rocha", customer)
        place = button(dialog, "Place order")
        messages = status(page, "Checkout messages")
        track(messages)
        calls = {"n": 0}

        def in_progress_first(route: Any) -> None:
            calls["n"] += 1
            if calls["n"] == 1:
                route.fulfill(status=409, json={"code": "request_in_progress"})
            else:
                route.fallback()

        page.route("**/api/orders", in_progress_first)
        place.focus()
        page.keyboard.press("Enter")
        says(page, messages, "Your order is still being placed. Wait a moment.")
        page.unroute("**/api/orders")
        with held(page, "**/api/orders") as release:
            page.keyboard.press("Enter")
            has_attr(page, place, "aria-disabled", "true")
            soon(page, lambda: "Placing your order..." in (place.evaluate("e => (e.getAttribute('aria-describedby') || '').split(' ').map(i => document.getElementById(i)?.textContent || '').join(' ')") or ""), "described by the pending copy")
            says(page, messages, "Placing your order...")
            page.keyboard.press("Enter")
            place.click(force=True)
            assert len(sent) == 2, f"further presses sent {len(sent) - 2} more"
            said = announced(messages)
            release()
        order_id = order_page_id(page)
        assert sent[0] == sent[1], "the same key and body must go out"
        assert said.count("Placing your order...") == 2, said
        order = ok(shopper.get(f"/api/orders/{order_id}"))
        focus_is(page, role(page, "heading", f"Order {order['number']}"))
    assert ok(shopper.get("/api/orders", q=customer))["count"] == 1

    set_available(app_url, "AT06", "FITA-48", 6)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    customer = own_email("queda")
    with screen(browser, app_url, FILIPE, "/cart", DESKTOP) as page:
        sent = placements(page)
        dialog = open_checkout(page)
        press_hold(page)
        choose_slot(page)
        fill_contact(page, "Filipe Rocha", customer)
        dropped: list[int] = []

        def drop_answer(route: Any) -> None:
            if not dropped:
                dropped.append(1)
                route.fetch()
                route.abort("connectionreset")
            else:
                route.fallback()

        page.route("**/api/orders", drop_answer)
        place = button(dialog, "Place order")
        click(place)
        soon(page, lambda: dropped, "the first answer dropped")
        soon(page, lambda: attr(place, "aria-disabled") != "true", "a dropped answer leaves Place order usable")
        page.reload()
        dialog = checkout_dialog(page)
        visible(page, dialog)
        place = button(dialog, "Place order")
        soon(page, lambda: role(dialog, "textbox", "Email").input_value() == customer, "values restored")
        click(place)
        order_page_id(page)
        assert len(sent) == 2 and sent[0] == sent[1], f"retry after a reload: {sent}"
    assert ok(shopper.get("/api/orders", q=customer))["count"] == 1
    assert len(mails_to(mail, customer)) == 1


@pytest.mark.parametrize("size", TWO_SIZES, ids=TWO_SIZES)
def test_wf_repeat_submit_session_end(browser: Any, mail: Any, size: str) -> None:
    base = short_session()
    setup = Api(base, BRUNO)
    set_available(base, "AT06", "FITA-48", 6)
    fill_cart(setup, "AT06", {"FITA-48": 1})
    customer = own_email("sessao")
    with screen(browser, base, BRUNO, "/cart", size) as page:
        sent = placements(page)
        dialog = open_checkout(page)
        press_hold(page)
        choose_slot(page)
        fill_contact(page, "Bruno Faria", customer)
        place = button(dialog, "Place order")
        place.focus()
        poll(lambda: page.request.get(base + "/api/me").status == 401, "the session reaches its fixed lifetime", SHORT_SESSION + 10)
        page.keyboard.press("Enter")
        soon(page, lambda: page.url.endswith("/sign-in?next=%2Fcart%3Fcheckout%3Dopen"), "sign-in with next")
        says(page, role(page, "alert"), "Your session ended. Sign in to continue.")
        fill(role(page, "textbox", "Email"), BRUNO)
        fill(role(page, "textbox", "Password"), PASSWORD)
        role(page, "textbox", "Password").focus()
        page.keyboard.press("Enter")
        soon(page, lambda: page.url.endswith("/cart?checkout=open"), "back at the open checkout")
        dialog = checkout_dialog(page)
        visible(page, dialog)
        has_attr(page, dialog, "data-state", "open")
        assert "opening" not in values_of(dialog.element_handle(), "data-state"), "a restored dialog played an entrance"
        assert role(dialog, "textbox", "Full name").input_value() == "Bruno Faria"
        assert role(dialog, "textbox", "Email").input_value() == customer
        focus_is(page, button(dialog, "Place order"))
        assert role(dialog, "radiogroup", "Collection time").get_by_role("radio", checked=True).count() == 1
        page.keyboard.press("Enter")
        order_id = order_page_id(page)
        assert len(sent) == 2 and sent[0] == sent[1], f"saved key and body: {sent}"
        fresh = Api(base, BRUNO)
        order = ok(fresh.get(f"/api/orders/{order_id}"))
        assert order["customer"]["email"] == customer
        assert ok(fresh.get("/api/orders", q=customer))["count"] == 1
    assert len(mails_to(mail, customer)) == 1


def test_restored_checkout_appears_open(browser: Any, app_url: str) -> None:
    shopper = Api(app_url, HELENA)
    set_available(app_url, "AT06", "FITA-48", 6)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    for reduced in (False, True):
        with screen(browser, app_url, HELENA, "/cart", DESKTOP, reduced=reduced) as page:
            click(visible(page, button(page, "Checkout")))
            dialog = checkout_dialog(page)
            visible(page, dialog)
            has_attr(page, dialog, "data-state", "open")
            states = values_of(dialog.element_handle(), "data-state")
            assert ("opening" in states) is (not reduced), states
            if not reduced:
                assert_span(events_of(dialog.element_handle(), "data-state"), "opening", "open", STATE_MIN_MS, STATE_MAX_MS)
            page.reload()
            dialog = checkout_dialog(page)
            visible(page, dialog)
            assert attr(dialog, "data-state") == "open"
            assert values_of(dialog.element_handle(), "data-state") == ["open"] or "opening" not in values_of(dialog.element_handle(), "data-state")
    reset_shopper(shopper)


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_order_page_landing(browser: Any, app_url: str, size: str) -> None:
    shopper = Api(app_url, EVA)
    set_available(app_url, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 3})
    customer = own_email("pagina")
    with screen(browser, app_url, EVA, "/cart", size) as page:
        dialog = open_checkout(page)
        press_hold(page)
        choose_slot(page)
        fill_contact(page, "Eva Couto", customer)
        click(button(dialog, "Place order"))
        order_id = order_page_id(page)
        order = ok(shopper.get(f"/api/orders/{order_id}"))
        heading = role(page, "heading", f"Order {order['number']}")
        focus_is(page, heading)
        copy = (f"Order {order['number']} placed. Collect at {order['store_name']} on "
                f"{order['slot_local_date']} at {order['slot_local_time']}.")
        says(page, status(page, "Order messages"), copy)
        assert_target(button(page, "Download order document"))
        assert attr(tagged(page, "data-figure", "order-total"), "data-value") == str(FITA_THREE)
        no_sideways(page)
        assert box(heading)["x"] >= 0
        page.reload()
        says(page, status(page, "Order messages"), copy)
        page.goto(app_url + "/catalogue")
    with screen(browser, app_url, EVA, f"/orders/{order_id}", size) as page:
        visible(page, role(page, "heading", f"Order {order['number']}"))
        assert txt(status(page, "Order messages")) == "", "opened another way the region starts empty"


def test_all_or_nothing_placement(relay_copy: RelayCopy, mail: Any) -> None:
    base = relay_copy.url
    relay_copy.storage(True)
    db = Postgres("_minio_down")
    shopper = Api(base, ANA)
    previous = new_order(base, ANA)
    set_available(base, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 2})
    hold = ok(shopper.post("/api/holds", {}), 201)
    slot = offered_slot(shopper, "AT06")
    customer = own_email("atomico")
    body = {"hold_id": hold["id"], "slot_start_utc": slot["start_utc"], "customer": {"name": "Ana", "email": customer}}
    key = request_key()
    stock_before = ok(Api(base, TIAGO).get(stock_url("AT06")))
    views_before = db.rows("SELECT count(*) AS n FROM order_view")[0]["n"]
    events_before = db.rows("SELECT count(*) AS n FROM order_events")[0]["n"]
    try:
        relay_copy.storage(False)
        failed = shopper.post("/api/orders", body, key=key)
        assert failed.status_code == 503 and failed.json() == {"code": "storage_unavailable"}
        assert db.rows("SELECT count(*) AS n FROM order_view")[0]["n"] == views_before
        assert db.rows("SELECT count(*) AS n FROM order_events")[0]["n"] == events_before
        assert ok(shopper.get(f"/api/holds/{hold['id']}"))["status"] == "active", "the hold must survive"
        assert ok(Api(base, TIAGO).get(stock_url("AT06"))) == stock_before, "stock moved on a failed placement"
        cart = ok(shopper.get("/api/cart"))
        assert cart["lines"] and cart["hold"]["id"] == hold["id"], "a failed placement leaves the cart"
        assert ok(shopper.get("/api/orders", q=customer))["count"] == 0
    finally:
        relay_copy.storage(True)
    order = ok(shopper.post("/api/orders", body, key=key), 201)
    assert order["number"].startswith("AT-") and len(order["number"]) == 9
    assert int(order["number"][3:]) == int(previous["number"][3:]) + 1, "a failed placement used up a number"
    bucket = S3("-relay")
    key_name = f"orders/atlantico/{order['number']}.json"
    assert key_name in bucket.keys("orders/atlantico/")
    assert json.loads(bucket.get(key_name)) == order
    view = db.rows(f"SELECT * FROM order_view WHERE order_id = '{order['id']}'")
    assert len(view) == 1 and view[0]["status"] == "placed" and view[0]["number"] == order["number"]
    assert view[0]["last_seq"] == 1 and view[0]["total_cents"] == order["total_cents"] and view[0]["store_id"] == "AT06"
    mails = mails_to(mail, customer)
    assert len(mails) == 1
    people = [Api(env, e) for env, e in zip([app_url_of_twin() for _ in SHOPPERS], SHOPPERS)]
    set_available(twin(), "AT06", "FITA-48", len(people) + 2)
    bodies = []
    for person in people:
        fill_cart(person, "AT06", {"FITA-48": 1})
        hold = ok(person.post("/api/holds", {}), 201)
        bodies.append((person, {"hold_id": hold["id"], "slot_start_utc": offered_slot(person, "AT06")["start_utc"],
                                "customer": {"name": "Cliente", "email": own_email()}}))
    with ThreadPoolExecutor(len(bodies)) as pool:
        answers = list(pool.map(lambda pair: pair[0].post("/api/orders", pair[1], key=request_key()), bodies))
    numbers = sorted(int(a.json()["number"][3:]) for a in answers if a.status_code == 201)
    assert len(numbers) == len(set(numbers)), f"duplicate numbers {numbers}"
    assert numbers[-1] - numbers[0] <= len(answers) - 1, f"gaps in {numbers}"


def app_url_of_twin() -> str:
    return twin()


def test_one_confirmation_email(app_url: str, mail: Any) -> None:
    customer = own_email("correio")
    order = new_order(twin(), GIL, "AT06", quantity=3, customer=customer)
    mails = mails_to(mail, customer)
    assert len(mails) == 1, f"{len(mails)} messages"
    message = mails[0]
    assert message["Subject"] == f"Order {order['number']} confirmed: collect at Loja Olhão"
    assert "encomendas@tramela.example" in addresses(message["From"])
    body = mail_text(message)
    for line in (f"Order {order['number']}", "Shop: Loja Olhão",
                 f"Collect on {order['slot_local_date']} at {order['slot_local_time']} (Europe/Lisbon)", "Total: 14,99 €"):
        assert line in body, f"{line!r} missing from {body!r}"
    refused_mail = own_email("recusado")
    shopper = Api(app_url, GIL)
    set_available(app_url, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    hold = ok(shopper.post("/api/holds", {}), 201)
    answer = shopper.post("/api/orders", {"hold_id": hold["id"], "slot_start_utc": "2027-10-31T01:00:00.000Z",
                                          "customer": {"name": "Gil", "email": refused_mail}}, key=request_key())
    assert answer.status_code == 409 and answer.json() == {"code": "slot_unavailable"}
    down = Api(minio_down(), GIL)
    fill_cart(down, "AT06", {"FITA-48": 1})
    down_hold = ok(down.post("/api/holds", {}), 201)
    down_mail = own_email("sem-storage")
    failed = down.post("/api/orders", {"hold_id": down_hold["id"], "slot_start_utc": offered_slot(down, "AT06")["start_utc"],
                                       "customer": {"name": "Gil", "email": down_mail}}, key=request_key())
    assert failed.status_code == 503
    leftovers = [m for m in mail.messages() if refused_mail in addresses(m["To"]) or down_mail in addresses(m["To"])]
    assert leftovers == [], "a placement that did not commit sent mail"
    reset_shopper(shopper)
    reset_shopper(down)


def test_documents_stored_as_placed(app_url: str) -> None:
    bucket = S3()
    order_answer_shopper = Api(app_url, HELENA)
    set_available(app_url, "AT06", "FITA-48", 8)
    fill_cart(order_answer_shopper, "AT06", {"FITA-48": 3})
    hold = ok(order_answer_shopper.post("/api/holds", {}), 201)
    first = order_answer_shopper.post("/api/orders", {
        "hold_id": hold["id"], "slot_start_utc": offered_slot(order_answer_shopper, "AT06")["start_utc"],
        "customer": {"name": "Helena Duarte", "email": own_email()}}, key=request_key())
    order = ok(first, 201)
    key = f"orders/atlantico/{order['number']}.json"
    stored = bucket.get(key)
    assert json.loads(stored) == order and json.loads(stored)["status"] == "placed"
    assert key in bucket.keys("orders/atlantico/")
    manager = Api(app_url, TIAGO)
    move_order(manager, order["id"], "picking", "ready", "collected")
    ret = ok(manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": "Teste"}), 201)
    ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "received"}))
    ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "settled"}))
    assert bucket.get(key) == stored, "the document was rewritten"
    for person in (order_answer_shopper, Api(app_url, CARE), manager, Api(app_url, LEAD)):
        answer = person.get(f"/api/orders/{order['id']}/document")
        assert answer.status_code == 200 and answer.content == stored
        assert answer.headers["content-type"].startswith("application/json")
    assert ok(order_answer_shopper.get(f"/api/orders/{order['id']}"))["status"] == "collected"


def test_storage_outage_and_recovery(browser: Any, relay_copy: RelayCopy) -> None:
    down = minio_down()
    assert httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert httpx.get(down + "/api/status", timeout=HTTP_TIMEOUT).json()["storage"] == "down"
    copy = "Order storage is unreachable. Placing orders, order documents and return labels are paused."
    base = relay_copy.url
    relay_copy.storage(True)
    order = new_order(base, GIL)
    manager = Api(base, TIAGO)
    move_order(manager, order["id"], "picking", "ready", "collected")
    ret = ok(manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": "Teste"}), 201)
    try:
        with screen(browser, base, CARE, f"/care/orders/{order['id']}", DESKTOP) as page, \
                screen(browser, base, TIAGO, "/shop/AT06", DESKTOP) as shop_page, \
                screen(browser, base, CARE, f"/care/orders/{order['id']}", DESKTOP, reduced=True) as still_page:
            download = button(page, "Download order document")
            visible(page, download)
            assert attr(download, "aria-disabled") != "true"
            label = button(shop_page, f"Return label {ret['number']}")
            visible(shop_page, label)
            verify = button(page, "Verify history")
            verify.focus()
            relay_copy.storage(False)
            notice = status(page, "Storage notice")
            soon(page, lambda: notice.count() == 1 and copy in txt(notice), "storage notice appears", RECOVERY_S + 5)
            band_states = values_of(notice.element_handle(), "data-state")
            soon(page, lambda: attr(notice, "data-state") == "open", "notice opens", step=FINE_MS)
            band_states = values_of(notice.element_handle(), "data-state")
            assert "opening" in band_states, f"full motion slides in: {band_states}"
            soon(still_page, lambda: status(still_page, "Storage notice").count() == 1, "notice on the reduced page", RECOVERY_S + 5)
            assert "opening" not in values_of(status(still_page, "Storage notice").element_handle(), "data-state")
            soon(page, lambda: attr(download, "aria-disabled") == "true", "download paused")
            assert download.get_attribute("aria-describedby") and download.is_visible()
            assert focused(verify), "the outage moved focus"
            assert attr(verify, "aria-disabled") != "true" and attr(button(page, "Cancel order"), "aria-disabled") != "true" if button(page, "Cancel order").count() else True
            soon(shop_page, lambda: attr(label, "aria-disabled") == "true", "return label paused")
            answer = manager.post(f"/api/returns/{ret['id']}/label", {})
            assert answer.status_code == 503 and answer.json() == {"code": "storage_unavailable"}
            assert Api(base, CARE).get(f"/api/orders/{order['id']}/document").status_code == 503
            assert ok(Api(base, ANA).get("/api/stores"))["count"] == 12
            started = time.monotonic()
            relay_copy.storage(True)
            soon(page, lambda: attr(download, "aria-disabled") != "true", "download enabled", RECOVERY_S + 2)
            soon(page, lambda: status(page, "Storage notice").count() == 0, "notice closes", RECOVERY_S + 2)
            assert time.monotonic() - started <= RECOVERY_S + 5
            soon(shop_page, lambda: attr(label, "aria-disabled") != "true", "label enabled", RECOVERY_S + 2)
            assert focused(verify), "recovery moved focus"
            assert Api(base, CARE).get(f"/api/orders/{order['id']}/document").status_code == 200
    finally:
        relay_copy.storage(True)


@pytest.mark.parametrize("size", TWO_SIZES, ids=TWO_SIZES)
def test_wf_order_commit_outage_work(browser: Any, relay_copy: RelayCopy, size: str) -> None:
    relay_copy.storage(True)
    base = relay_copy.url
    order = collected_order(base, GIL, customer=own_email("falha"))
    other = new_order(base, GIL)
    down = minio_down()
    pause_order = "Placing orders is paused until order documents can be stored."
    pause_document = "Order documents are unavailable until storage returns."
    pause_label = "Return labels are paused until storage returns."
    notice_copy = "Order storage is unreachable. Placing orders, order documents and return labels are paused."
    manager = Api(down, TIAGO)
    ret = ok(manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": "Teste"}), 201)
    with screen(browser, down, CARE, f"/care/orders/{other['id']}", size) as page:
        says(page, status(page, "Storage notice"), notice_copy)
        download = button(page, "Download order document")
        tab_to(page, download)
        has_attr(page, download, "aria-disabled", "true")
        page.keyboard.press("Enter")
        says(page, status(page, "Care updates"), pause_document)
        tab_to(page, button(page, "Verify history"))
        page.keyboard.press("Enter")
        says(page, status(page, "Care updates"), "History verified: 1 entries.")
        tab_to(page, button(page, "Cancel order"))
        page.keyboard.press("Enter")
        alert = role(page, "alertdialog", "Cancel order")
        visible(page, alert)
        focus_is(page, button(alert, "Keep order"))
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        says(page, status(page, "Care updates"), f"Order {other['number']} is now cancelled.")
    assert ok(Api(down, CARE).get(f"/api/orders/{other['id']}"))["status"] == "cancelled"
    with screen(browser, down, TIAGO, "/shop/AT06", size) as page:
        section_open(page, "Returns", size)
        label = button(page, f"Return label {ret['number']}")
        visible(page, label)
        tab_to(page, label, presses=120)
        has_attr(page, label, "aria-disabled", "true")
        page.keyboard.press("Enter")
        says(page, status(page, "Shop updates"), pause_label)
    shopper = Api(down, GIL)
    set_available(down, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    with screen(browser, down, GIL, "/cart", size) as page:
        dialog = open_checkout(page)
        click(button(dialog, "Hold items"))
        visible(page, role(dialog, "timer", "Hold time left"))
        place = button(dialog, "Place order")
        tab_to(page, place)
        has_attr(page, place, "aria-disabled", "true")
        page.keyboard.press("Enter")
        says(page, status(page, "Checkout messages"), pause_order)
        assert focused(place)
        assert ok(shopper.get("/api/cart"))["hold"]["status"] == "active", "other shopping tasks keep working"
    reset_shopper(shopper)
    assert ok(Api(down, LEAD).get("/api/stores"))["count"] == 12


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_wf_order_commit_notice_layout(browser: Any, relay_copy: RelayCopy, size: str) -> None:
    relay_copy.storage(True)
    order = new_order(relay_copy.url, GIL)
    width, _ = dims(size)
    with screen(browser, minio_down(), CARE, f"/care/orders/{order['id']}", size) as page:
        notice = status(page, "Storage notice")
        visible(page, notice)
        has_attr(page, notice, "data-state", "open")
        settled(page, notice, "the storage notice band")
        band = box(notice)
        assert band["x"] == 0 and band["width"] == width, f"band {band}"
        wordmark = box(role(page, "link", "Tramela Estate"))
        assert band["y"] >= wordmark["y"] + wordmark["height"] - 1, f"band covers the header: {band} vs {wordmark}"
        paused = button(page, "Download order document")
        paused.scroll_into_view_if_needed()
        control = box(paused)
        band = box(notice)
        overlap = control["y"] < band["y"] + band["height"] and band["y"] < control["y"] + control["height"]
        assert not overlap, f"the band covers a paused control: {band} vs {control}"
        no_sideways(page)
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        advance(page, STEP_MS)
        last = box(button(page, "Cancel order"))
        band = box(notice)
        assert band["y"] + band["height"] <= last["y"] or band["y"] >= last["y"] + last["height"], "the last row stays under the band"


def test_effective_dated_hours(app_url: str) -> None:
    base = app_url
    ok(publish(base, "AT11", daily()))
    person = Api(base, ANA)
    hours = ok(person.get(hours_url("AT11")))
    assert hours["timezone"] == "Atlantic/Azores" and hours["upcoming"] is None
    today = datetime.strptime(hours["local_today"], "%Y-%m-%d").date()
    local_clock = server_now(base).astimezone(ZoneInfo("Atlantic/Azores"))
    assert hours["local_today"] == local_clock.strftime("%Y-%m-%d"), "local_today is the shop's date"
    tomorrow = (today + timedelta(days=1)).isoformat()
    try:
        answer = ok(publish(base, "AT11", week("09:00", LATE_CLOSE), tomorrow))
        assert answer["upcoming"]["effective_from"] == tomorrow
        assert answer["days"][0]["opens"] == "08:00", "today's hours stay"
        assert answer["upcoming"]["days"][0]["opens"] == "09:00"
        plan_today = ok(person.get(plan_url("AT11"), date=today.isoformat()))
        plan_next = ok(person.get(plan_url("AT11"), date=tomorrow))
        assert plan_today["opens_local"] == "08:00" and plan_today["closes_local"] == "20:00"
        assert plan_next["opens_local"] == "09:00" and plan_next["closes_local"] == LATE_CLOSE and plan_next["timezone"] == "Atlantic/Azores"
        past = ok(person.get(plan_url("AT11"), date=(today - timedelta(days=3)).isoformat()))
        assert past["opens_local"] == "08:00", "earlier dates keep the earlier plan"
        assert ok(person.get(store_url("AT11")))["closes_local"] == "20:00"
        slots = ok(person.get(slots_url("AT11")))["days"]
        for day in slots:
            times = [slot["start_local"] for slot in day["slots"]]
            assert times, day
            if day["date"] == today.isoformat():
                assert all(t >= "08:00" and t < "20:00" for t in times)
            if day["date"] == tomorrow:
                assert min(times) >= "09:00" and max(times) < LATE_CLOSE
        offset = local_clock.utcoffset()
        sign = "-" if offset.total_seconds() < 0 else "+"
        hhmm = f"{sign}{abs(int(offset.total_seconds())) // 3600:02d}:00"
        assert plan_today["slots"][0]["utc_offset"] == hhmm
        start = datetime.fromisoformat(plan_today["slots"][0]["start_utc"].replace("Z", "+00:00")).astimezone(ZoneInfo("Atlantic/Azores"))
        assert start.strftime("%H:%M") == plan_today["slots"][0]["start_local"]
        for bad_days, field in ((week("08:15", "20:00"), "days.0.opens"), (week("20:00", "08:00"), "days.0.closes"), (daily()[:6], None)):
            bad = publish(base, "AT11", bad_days)
            assert bad.status_code == 422 and bad.json()["code"] == "validation_failed", bad.text
            if field:
                assert any(k.startswith("days.0") for k in bad.json()["errors"]), bad.text
        for bad_date in ((today - timedelta(days=1)).isoformat(), (today + timedelta(days=61)).isoformat()):
            assert publish(base, "AT11", daily(), bad_date).status_code == 422, bad_date
        last = (today + timedelta(days=60)).isoformat()
        assert ok(publish(base, "AT11", week("10:00", "12:00"), last))["upcoming"]["effective_from"] == last
        assert ok(person.get(plan_url("AT11"), date=tomorrow))["opens_local"] == "08:00", "a later publish replaces the earlier upcoming plan"
        cleared = ok(publish(base, "AT11", daily()))
        assert cleared["upcoming"] is None and cleared["days"][0]["opens"] == "08:00"
        foreign = Api(base, TIAGO).put(hours_url("AT11"), {"days": daily()})
        assert foreign.status_code == 403 and foreign.json() == {"code": "forbidden"}
    finally:
        publish(base, "AT11", daily())


def _plan(person: Api, store: str, date: str) -> list[tuple[str, str, str]]:
    return [(s["start_local"], s["utc_offset"], s["start_utc"]) for s in ok(person.get(f"/api/stores/{store}/day-plan", date=date))["slots"]]


def test_dst_plans_and_repeated_hour(browser: Any, app_url: str) -> None:
    person = Api(app_url, ANA)
    sunday = lambda opens, closes: [{"weekday": d, "open": True, "opens": "08:00", "closes": "20:00"} for d in WEEK[:6]] + \
        [{"weekday": 7, "open": True, "opens": opens, "closes": closes}]
    ok(publish(app_url, "AT01", daily()))
    ok(publish(app_url, "AT11", daily()))
    try:
        first = lambda store, date: next(s for s in ok(person.get(f"/api/stores/{store}/day-plan", date=date))["slots"] if s["start_local"] == "08:00")
        for store, date, utc, offset in (("AT01", "2027-03-27", "2027-03-27T08:00", "+00:00"), ("AT01", "2027-03-28", "2027-03-28T07:00", "+01:00"),
                                         ("AT11", "2027-03-27", "2027-03-27T09:00", "-01:00"), ("AT11", "2027-03-28", "2027-03-28T08:00", "+00:00"),
                                         ("AT01", "2027-10-31", "2027-10-31T08:00", "+00:00"), ("AT11", "2027-10-31", "2027-10-31T09:00", "-01:00"),
                                         ("AT01", "2027-10-30", "2027-10-30T07:00", "+01:00"), ("AT11", "2027-10-30", "2027-10-30T08:00", "+00:00")):
            slot = first(store, date)
            assert slot["start_utc"].startswith(utc), f"{store} {date}: {slot}"
            assert slot["utc_offset"] == offset, f"{store} {date}: {slot}"
        ok(publish(app_url, "AT01", sunday("00:30", "03:00")))
        spring = [(a, b) for a, b, _ in _plan(person, "AT01", "2027-03-28")]
        assert spring == [("00:30", "+00:00"), ("02:00", "+01:00"), ("02:30", "+01:00")], spring
        autumn = _plan(person, "AT01", "2027-10-31")
        assert [(a, b) for a, b, _ in autumn] == [("00:30", "+01:00"), ("01:00", "+01:00"), ("01:30", "+01:00"), ("02:00", "+00:00"), ("02:30", "+00:00")], autumn
        assert next(c for a, _, c in autumn if a == "01:00").startswith("2027-10-31T00:00:00.000Z")
        ok(publish(app_url, "AT11", sunday("00:00", "02:00")))
        azores = [(a, b) for a, b, _ in _plan(person, "AT11", "2027-03-28")]
        assert azores == [("01:00", "+00:00"), ("01:30", "+00:00")], azores
        shopper = Api(app_url, ANA)
        set_available(app_url, "AT01", "FITA-48", 5)
        fill_cart(shopper, "AT01", {"FITA-48": 1}, LISBOA)
        hold = ok(shopper.post("/api/holds", {}), 201)
        refused = shopper.post("/api/orders", {"hold_id": hold["id"], "slot_start_utc": "2027-10-31T01:00:00.000Z",
                                               "customer": {"name": "Ana", "email": own_email()}}, key=request_key())
        assert refused.status_code == 409 and refused.json() == {"code": "slot_unavailable"}
        assert ok(shopper.get(f"/api/holds/{hold['id']}"))["status"] == "active"
        reset_shopper(shopper)
        with screen(browser, app_url, RUI, "/shop/AT01", DESKTOP) as page:
            preview = role(page, "textbox", "Preview date")
            visible(page, preview)
            fill(preview, "2027-10-31")
            slots = role(page, "list", "Slots on preview date")
            soon(page, lambda: role(slots, "listitem").count() == 5, "five slots on the autumn Sunday")
            items = [txt(i) for i in role(slots, "listitem").all()]
            assert items[:3] == [f"00:30 (UTC+01:00), {_r(autumn, 0)} left", f"01:00 (UTC+01:00), {_r(autumn, 1)} left", f"01:30 (UTC+01:00), {_r(autumn, 2)} left"], items
            assert items[3].startswith("02:00 (UTC+00:00), ") and items[4].startswith("02:30 (UTC+00:00), ")
            fill(preview, "2027-03-28")
            soon(page, lambda: [txt(i) for i in role(slots, "listitem").all()] == ["00:30 (UTC+00:00), 2 left", "02:00 (UTC+01:00), 2 left", "02:30 (UTC+01:00), 2 left"], "spring preview items")
    finally:
        publish(app_url, "AT01", daily())
        publish(app_url, "AT11", daily())
        reset_shopper(Api(app_url, ANA))


def _r(_: list, __: int) -> int:
    return 2


def test_slots_and_capacity(app_url: str) -> None:
    person = Api(app_url, CARE)
    answer = ok(person.get(slots_url("AT06")))
    now = server_now(app_url)
    assert answer["timezone"] == "Europe/Lisbon" and answer["days"]
    for day in answer["days"]:
        assert day["slots"], "days with no offered slot are left out"
        for slot in day["slots"]:
            start = datetime.fromisoformat(slot["start_utc"].replace("Z", "+00:00"))
            assert 7200 - 10 <= (start - now).total_seconds() <= 604800 + 10, slot
            assert slot["start_local"][3:] in ("00", "30") and slot["remaining"] in (1, 2)
    people = [Api(app_url if i % 2 else twin(), e) for i, e in enumerate(SHOPPERS)]
    set_available(app_url, "AT06", "CAD-40", 10)
    slot = next(s for d in reversed(answer["days"]) for s in reversed(d["slots"]) if s["remaining"] == 2)
    requests = []
    for person_item in people:
        fill_cart(person_item, "AT06", {"CAD-40": 1})
        hold = ok(person_item.post("/api/holds", {}), 201)
        requests.append((person_item, {"hold_id": hold["id"], "slot_start_utc": slot["start_utc"],
                                       "customer": {"name": "Cliente", "email": own_email()}}, request_key()))
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda r: r[0].post("/api/orders", r[1], key=r[2]), requests))
    wins = [a for a in answers if a.status_code == 201]
    assert len(wins) == 2, [a.status_code for a in answers]
    numbers = sorted(a.json()["number"] for a in wins)
    for request, answered in zip(requests, answers):
        person_item, body, key = request
        if answered.status_code == 201:
            continue
        assert answered.status_code == 409 and answered.json() == {"code": "slot_unavailable"}, answered.text
        assert ok(person_item.get(f"/api/holds/{body['hold_id']}"))["status"] == "active"
        assert ok(person_item.get("/api/cart"))["lines"], "the loser's cart must stay"
        replay = person_item.post("/api/orders", body, key=key)
        assert replay.content == answered.content, "a stored slot_unavailable replays"
    assert ok(Api(app_url, CARE).get(slots_url("AT06")))["days"], "other slots stay"
    date_plan = ok(Api(app_url, CARE).get(plan_url("AT06"), date=_local_date(slot)))
    assert next(s for s in date_plan["slots"] if s["start_utc"] == slot["start_utc"])["remaining"] == 0
    offered = [s["start_utc"] for d in ok(Api(app_url, CARE).get(slots_url("AT06")))["days"] for s in d["slots"]]
    assert slot["start_utc"] not in offered, "a full slot is not offered"
    move_order(Api(app_url, TIAGO), wins[0].json()["id"], "cancelled")
    freed = ok(Api(app_url, CARE).get(plan_url("AT06"), date=_local_date(slot)))
    assert next(s for s in freed["slots"] if s["start_utc"] == slot["start_utc"])["remaining"] == 1, "cancel frees the place"
    assert len(numbers) == 2
    for person_item in people:
        reset_shopper(person_item)


def _local_date(slot: dict) -> str:
    return datetime.fromisoformat(slot["start_utc"].replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Lisbon")).strftime("%Y-%m-%d")


@pytest.mark.parametrize("size", TWO_SIZES, ids=TWO_SIZES)
def test_wf_opening_hours_publish(browser: Any, app_url: str, size: str) -> None:
    ok(publish(app_url, "AT11", daily()))
    reader = Api(app_url, ANA)
    hours = ok(reader.get(hours_url("AT11")))
    tomorrow = (datetime.strptime(hours["local_today"], "%Y-%m-%d").date() + timedelta(days=1)).isoformat()
    try:
        with screen(browser, app_url, SOFIA, "/", size) as page:
            page.clock.set_system_time(datetime(2031, 1, 5, 3, 0, tzinfo=timezone.utc))
            page.goto(app_url + "/shop/AT11")
            if size == PHONE:
                toggle = button(page, "Opening hours")
                visible(page, toggle)
                toggle.focus()
                page.keyboard.press("Enter")
                has_attr(page, toggle, "aria-expanded", "true")
                focus_is(page, toggle)
            effective = role(page, "textbox", "Effective from")
            visible(page, effective)
            soon(page, lambda: effective.input_value() == hours["local_today"], "Effective from shows the shop's local today")
            effective.focus()
            page.keyboard.press("Control+A")
            page.keyboard.type(tomorrow)
            for day in WEEKDAYS:
                role(page, "textbox", f"{day} opens").focus()
                page.keyboard.press("Control+A")
                page.keyboard.type("09:00")
            publish_button = button(page, "Publish hours")
            publish_button.focus()
            page.keyboard.press("Enter")
            updates = status(page, "Shop updates")
            says(page, updates, f"Opening hours published from {tomorrow}.")
            focus_is(page, publish_button)
            visible(page, page.get_by_text(f"New hours start on {tomorrow}."))
            stored = ok(reader.get(hours_url("AT11")))
            assert stored["days"][0]["opens"] == "08:00" and stored["upcoming"]["effective_from"] == tomorrow
            assert stored["upcoming"]["days"][0]["opens"] == "09:00"
            preview = role(page, "textbox", "Preview date")
            preview.focus()
            page.keyboard.press("Control+A")
            page.keyboard.type(hours["local_today"])
            slots = role(page, "list", "Slots on preview date")
            today_plan = ok(reader.get(plan_url("AT11"), date=hours["local_today"]))["slots"]
            soon(page, lambda: role(slots, "listitem").count() == len(today_plan), "today's preview keeps the old hours")
            figure = tagged(page, "data-figure", "slot-count")
            has_attr(page, figure, "data-value", str(len(today_plan)))
            soon(page, lambda: attr(figure, "data-counting") == "false", "slot count settles", step=FINE_MS)
            list_node = slots.element_handle()
            kept_item = role(slots, "listitem").filter(has_text="09:00 (").element_handle()
            figure_node = figure.element_handle()
            track(updates)
            page.keyboard.press("Control+A")
            page.keyboard.type(tomorrow)
            plan = ok(reader.get(plan_url("AT11"), date=tomorrow))["slots"]
            soon(page, lambda: attr(figure, "data-value") == str(len(plan)), "slot count takes the new number", step=FINE_MS)
            soon(page, lambda: attr(figure, "data-counting") == "false", "slot count counted", step=FINE_MS)
            assert_span(events_of(figure_node, "data-counting"), "true", "false", FIG_MIN_MS, FIG_MAX_MS)
            items = [txt(i) for i in role(slots, "listitem").all()]
            assert items == [f"{s['start_local']} (UTC{s['utc_offset']}), {s['remaining']} left" for s in plan], items
            assert slots.evaluate("(e, n) => e === n", list_node), "the list node was replaced"
            assert kept_item.evaluate("e => e.isConnected"), "the item of a shared time was replaced"
            line = "Times are local to Loja Ponta Delgada (Atlantic/Azores)."
            says(page, updates, line)
            assert announced(updates).count(line) == 1, announced(updates)
            focus_is(page, preview)
    finally:
        publish(app_url, "AT11", daily())


def test_wf_opening_hours_draft_reload(browser: Any, app_url: str) -> None:
    ok(publish(app_url, "AT11", daily()))
    try:
        with screen(browser, app_url, SOFIA, "/shop/AT11", PHONE) as page:
            section_open(page, "Opening hours", PHONE)
            monday = role(page, "textbox", "Monday opens")
            visible(page, monday)
            fill(monday, "08:15")
            fill(role(page, "textbox", "Tuesday opens"), LATER_OPEN)
            click(role(page, "checkbox", "Open on Sunday"))
            click(button(page, "Publish hours"))
            error = page.get_by_text("Use a time on the hour or half hour.")
            visible(page, error)
            assert attr(monday, "aria-invalid") == "true"
            monday.focus()
            page.reload()
            monday = role(page, "textbox", "Monday opens")
            visible(page, monday)
            soon(page, lambda: monday.input_value() == "08:15", "draft value restored")
            assert role(page, "textbox", "Tuesday opens").input_value() == LATER_OPEN
            assert not role(page, "checkbox", "Open on Sunday").is_checked()
            visible(page, page.get_by_text("Use a time on the hour or half hour."))
            assert attr(monday, "aria-invalid") == "true"
            focus_is(page, monday)
            assert attr(button(page, "Opening hours"), "aria-expanded") == "true"
            assert ok(Api(app_url, ANA).get(hours_url("AT11")))["days"][1]["opens"] == "08:00", "a draft reached the server"
            fill(monday, "08:00")
            click(button(page, "Publish hours"))
            today = ok(Api(app_url, ANA).get(hours_url("AT11")))["local_today"]
            says(page, status(page, "Shop updates"), f"Opening hours published from {today}.")
            assert ok(Api(app_url, ANA).get(hours_url("AT11")))["days"][1]["opens"] == LATER_OPEN

            page.reload()
            visible(page, role(page, "textbox", "Tuesday opens"))
            soon(page, lambda: role(page, "textbox", "Tuesday opens").input_value() == LATER_OPEN, "published hours shown")
            assert page.get_by_text("Use a time on the hour or half hour.").count() == 0, "the draft outlived its publish"
    finally:
        publish(app_url, "AT11", daily())


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_hours_editor_layout(browser: Any, app_url: str, size: str) -> None:
    with screen(browser, app_url, SOFIA, "/shop/AT11", size) as page:
        section_open(page, "Opening hours", size)
        group = role(page, "group", "Opening hours")
        visible(page, group)
        rows = []
        for day in WEEKDAYS:
            cells = [role(page, "checkbox", f"Open on {day}"), role(page, "textbox", f"{day} opens"), role(page, "textbox", f"{day} closes")]
            found = [box(cell) for cell in cells]
            for cell in cells:
                assert_target(cell)
            mids = [item["y"] + item["height"] / 2 for item in found]
            assert max(mids) - min(mids) <= MIN_TARGET / 2, f"{day} is not on one line: {found}"
            assert found[0]["x"] < found[1]["x"] < found[2]["x"], f"{day} order: {found}"
            rows.append(found)
        assert all(rows[i][0]["y"] < rows[i + 1][0]["y"] for i in range(6)), "weekdays run Monday to Sunday"
        effective, publish_button = box(role(page, "textbox", "Effective from")), box(button(page, "Publish hours"))
        if size == PHONE:
            section = box(group)
            preview = box(role(page, "textbox", "Preview date"))
            for item in (effective, publish_button, preview):
                assert abs(item["width"] - section["width"]) <= 32, f"{item} against {section}"
        else:
            for column in range(3):
                edges = [row[column]["x"] for row in rows]
                assert max(edges) - min(edges) <= 2, f"column {column}: {edges}"
            assert abs(effective["y"] - publish_button["y"]) <= MIN_TARGET, "side by side on one row"
            assert effective["x"] + effective["width"] <= publish_button["x"]
        no_sideways(page)
        assert group.evaluate("e => e.scrollWidth <= e.clientWidth"), "the editor scrolls sideways"


def test_state_machine(app_url: str) -> None:
    manager = Api(app_url, TIAGO)
    care = Api(app_url, CARE)

    def refuse(person: Api, path: str, current: str, wanted: str) -> None:
        answer = person.post(path, {"to": wanted})
        assert answer.status_code == 409, f"{current}->{wanted}: {answer.status_code}"
        assert answer.json() == {"code": "invalid_transition", "from": current, "to": wanted}

    order = new_order(app_url, HELENA)
    path = f"/api/orders/{order['id']}/transitions"
    refuse(manager, path, "placed", "ready")
    refuse(manager, path, "placed", "collected")
    refused = Api(app_url, LEAD).post(path, {"to": "picking"})
    assert refused.status_code == 403 and refused.json() == {"code": "forbidden"}
    assert Api(app_url, HELENA).post(path, {"to": "cancelled"}).status_code == 403
    assert care.post(path, {"to": "picking"}).status_code == 403
    assert manager.post(path, {"to": "bogus"}).status_code == 422
    assert len(ok(care.get(f"/api/orders/{order['id']}/events"))["events"]) == 1, "a refused move added history"
    assert ok(manager.post(path, {"to": "picking"}))["status"] == "picking"
    refuse(manager, path, "picking", "picking")
    refuse(manager, path, "picking", "collected")
    assert ok(manager.post(path, {"to": "ready"}))["status"] == "ready"
    refuse(manager, path, "ready", "picking")
    assert ok(manager.post(path, {"to": "collected"}))["status"] == "collected"
    for wanted in ("cancelled", "picking", "ready", "collected"):
        refuse(manager, path, "collected", wanted)
    for start in ((), ("picking",), ("picking", "ready")):
        other = new_order(app_url, HELENA)
        move_order(manager, other["id"], *start)
        assert ok(care.post(f"/api/orders/{other['id']}/transitions", {"to": "cancelled"}))["status"] == "cancelled"
        refuse(manager, f"/api/orders/{other['id']}/transitions", "cancelled", "picking")
    too_early = new_order(app_url, HELENA)
    answer = manager.post(f"/api/orders/{too_early['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": "Cedo"})
    assert answer.status_code == 409 and answer.json()["code"] == "invalid_transition"
    make = lambda: ok(manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": "Teste"}), 201)
    first = make()
    ret = f"/api/returns/{first['id']}/transitions"
    refuse(manager, ret, "requested", "settled")
    assert first["status"] == "requested"
    assert ok(manager.post(ret, {"to": "declined"}))["status"] == "declined"
    refuse(manager, ret, "declined", "received")
    second = make()
    ret = f"/api/returns/{second['id']}/transitions"
    assert ok(manager.post(ret, {"to": "received"}))["status"] == "received"
    refuse(manager, ret, "received", "declined")
    refuse(manager, ret, "received", "received")
    assert ok(manager.post(ret, {"to": "settled"}))["status"] == "settled"
    refuse(manager, ret, "settled", "received")
    shopper = Api(app_url, HELENA)
    set_available(app_url, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    hold = ok(shopper.post("/api/holds", {}), 201)
    assert ok(shopper.delete(f"/api/holds/{hold['id']}"))["status"] == "released"
    again = shopper.delete(f"/api/holds/{hold['id']}")
    assert again.status_code == 409 and again.json()["code"] == "invalid_transition"
    placed_on_released = shopper.post("/api/orders", {"hold_id": hold["id"], "slot_start_utc": offered_slot(shopper, "AT06")["start_utc"],
                                                      "customer": {"name": "Helena", "email": own_email()}}, key=request_key())
    assert placed_on_released.status_code == 409 and placed_on_released.json()["code"] == "invalid_transition"
    reset_shopper(shopper)


def test_returns_refunds_labels(app_url: str) -> None:
    order = collected_order(app_url, BRUNO, quantity=3)
    manager = Api(app_url, TIAGO)
    stock = lambda: next(i for i in ok(manager.get(stock_url("AT06")))["lines"] if i["sku"] == "FITA-48")["on_hand"]
    request = lambda q: manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": q}], "reason": REASON_DEFECT})
    over = request(4)
    assert over.status_code == 422 and "lines.0.quantity" in over.json()["errors"]
    assert manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": ""}).status_code == 422
    declined = ok(request(3), 201)
    assert declined["refund_cents"] == FITA_THREE
    assert request(1).status_code == 422, "a requested return still counts against the line"
    ok(manager.post(f"/api/returns/{declined['id']}/transitions", {"to": "declined"}))
    refunds, numbers = [], []
    start = stock()
    settled_sum = 0
    for index, expected in enumerate((500, 500, 499), start=1):
        ret = ok(request(1), 201)
        assert ret["refund_cents"] == expected and ret["lines"] == [{"sku": "FITA-48", "quantity": 1, "refund_cents": expected}]
        assert ret["number"] == f"{order['number']}-R{index + 1}", ret["number"]
        assert ret["order_id"] == order["id"] and ret["status"] == "requested" and ret["reason"] == REASON_DEFECT
        assert stock() == start + index - 1, "a requested return moved stock"
        assert ok(manager.get(f"/api/orders/{order['id']}"))["refunded_cents"] == settled_sum
        ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "received"}))
        assert stock() == start + index, "a received return adds its unit"
        assert ok(manager.get(f"/api/orders/{order['id']}"))["refunded_cents"] == settled_sum, "refunded only once settled"
        ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "settled"}))
        settled_sum += expected
        refunds.append(expected)
        numbers.append(ret)
    final = ok(manager.get(f"/api/orders/{order['id']}"))
    assert final["refunded_cents"] == FITA_THREE and final["lines"][0]["returned_quantity"] == 3
    assert request(1).status_code == 422
    assert {r["id"] for r in ok(manager.get("/api/returns", store_id="AT06"))["returns"]} >= {r["id"] for r in numbers}
    ret = numbers[0]
    label = manager.post(f"/api/returns/{ret['id']}/label", {})
    assert label.status_code == 200 and label.headers["content-type"].startswith("text/plain")
    lines = label.text.splitlines()
    assert lines[:3] == [f"Tramela return {ret['number']}", f"Order {order['number']}", "Shop Loja Olhão"], lines
    assert "1 x FITA-48 Fita-cola de pintor 48 mm" in lines
    key = f"returns/atlantico/{ret['number']}.txt"
    bucket = S3()
    stored = bucket.get(key)
    assert stored == label.content
    again = Api(twin(), TIAGO).post(f"/api/returns/{ret['id']}/label", {})
    assert again.content == stored and bucket.get(key) == stored
    assert Api(app_url, LEAD).post(f"/api/returns/{ret['id']}/label", {}).status_code == 403
    assert Api(app_url, RUI).post(f"/api/returns/{ret['id']}/label", {}).status_code == 404


SECTIONS = ["Orders", "Active holds", "Stock", "Opening hours", "Returns"]


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_backoffice_breakpoints(browser: Any, app_url: str, size: str) -> None:
    with screen(browser, app_url, TIAGO, "/shop/AT05", size) as page:
        orders = role(page, "table", "Orders")
        visible(page, orders)
        no_sideways(page)
        if size == PHONE:
            for name in SECTIONS:
                assert attr(button(page, name), "aria-expanded") == ("true" if name == "Orders" else "false"), name
            assert role(page, "table", "Stock").count() == 0, "a collapsed section is in the tree"
            assert "Record till sale" not in tab_order(page, 12)
            toggle = button(page, "Stock")
            toggle.focus()
            page.keyboard.press("Enter")
            stock = role(page, "table", "Stock")
            visible(page, stock)
            focus_is(page, toggle)
            body = stock.evaluate_handle("e => e.closest('[data-state]')")
            soon(page, lambda: body.evaluate("e => e.getAttribute('data-state')") == "open", "section opens", step=FINE_MS)
            assert_span(events_of(body, "data-state"), "opening", "open", STATE_MIN_MS, STATE_MAX_MS)
            page.reload()
            visible(page, role(page, "table", "Stock"))
            assert attr(button(page, "Stock"), "aria-expanded") == "true", "the expanded set survives a reload"
            assert attr(button(page, "Returns"), "aria-expanded") == "false"
            toggle = button(page, "Stock")
            click(toggle)
            soon(page, lambda: role(page, "table", "Stock").count() == 0, "section closes", step=FINE_MS)
            xs = {round(box(role(page, "button", name))["x"]) for name in SECTIONS}
            assert len(xs) == 1, f"one column: {xs}"
            return
        for name in SECTIONS:
            assert button(page, name).count() == 0, f"{name} must be a plain heading at {size}"
            assert role(page, "heading", name).count() >= 1, f"heading {name}"
        place = {name: box(role(page, "heading", name).first) for name in SECTIONS}
        if size == TABLET:
            columns = (("Orders", "Returns"), ("Active holds", "Stock", "Opening hours"))
        else:
            columns = (("Orders",), ("Active holds", "Stock"), ("Opening hours", "Returns"))
        lefts = [place[column[0]]["x"] for column in columns]
        assert lefts == sorted(lefts) and len(set(round(x) for x in lefts)) == len(columns), f"columns: {place}"
        for column in columns:
            assert all(abs(place[name]["x"] - place[column[0]]["x"]) <= 2 for name in column), f"{column}: {place}"
            ys = [place[name]["y"] for name in column]
            assert ys == sorted(ys), f"{column} order: {place}"


def test_backoffice_stays_live(browser: Any, app_url: str) -> None:
    order = new_order(app_url, GIL)
    with screen(browser, app_url, TIAGO, "/shop/AT06", DESKTOP) as page:
        table = role(page, "table", "Orders")
        visible(page, table)
        row = role(table, "row", re.compile(re.escape(order["number"])))
        visible(page, row)
        node = row.element_handle()
        click(button(page, "Count FITA-48"))
        count_dialog = role(page, "dialog", "Stock count")
        visible(page, count_dialog)
        current = next(i for i in ok(Api(app_url, TIAGO).get(stock_url("AT06")))["lines"] if i["sku"] == "FITA-48")
        fill(role(count_dialog, "spinbutton", "Counted units"), str(current["held"] + 15))
        click(button(count_dialog, "Save count"))
        updates = status(page, "Shop updates")
        says(page, updates, "Count saved.")
        on_hand = tagged(role(page, "row", re.compile("FITA-48")), "data-figure", "on-hand")
        has_attr(page, on_hand, "data-value", str(current["held"] + 15))
        click(button(page, "Record till sale"))
        sale = role(page, "dialog", "Till sale")
        visible(page, sale)
        units = role(sale, "spinbutton", "Units")
        fill(units, "7")
        units.focus()
        Api(app_url, CARE).post(f"/api/orders/{order['id']}/transitions", {"to": "cancelled"})
        arrived = new_order(app_url, GIL, stocked=True)
        ok(Api(app_url, TIAGO).post(till_url("AT06"), {"sku": "FITA-48", "quantity": 1}, key=request_key()), 201)
        expected = next(i for i in ok(Api(app_url, TIAGO).get(stock_url("AT06")))["lines"] if i["sku"] == "FITA-48")
        advance(page, POLL_MS)
        visible(page, role(table, "row", re.compile(re.escape(arrived["number"]))), "a new order appears in place", 10)
        soon(page, lambda: "cancelled" in txt(row), "the cancelled row updates in place")
        assert row.evaluate("(e, n) => e === n", node), "the row node was replaced"
        assert button(row, f"Start picking {order['number']}").count() == 0
        has_attr(page, on_hand, "data-value", str(expected["on_hand"]))
        for _ in range(3):
            advance(page, POLL_MS)
        assert sale.count() == 1 and units.input_value() == "7", "a poll disturbed the dialog"
        assert focused(units), "a poll moved focus"
        assert txt(updates) == "Count saved.", "a poll replaced the last message"
    with screen(browser, app_url, TIAGO, "/shop/AT06", PHONE) as page:
        toggle = button(page, "Stock")
        visible(page, toggle)
        visible(page, role(role(page, "table", "Orders"), "row", re.compile(re.escape(arrived["number"]))), "the order queue loaded")
        click(toggle)
        stock = role(page, "table", "Stock")
        visible(page, stock)
        body = stock.evaluate_handle("e => e.closest('[data-state]')")
        soon(page, lambda: body.evaluate("e => e.getAttribute('data-state')") == "open", "section open", step=FINE_MS)
        click(toggle)
        click(toggle)
        for _ in range(30):
            advance(page, FINE_MS)
        soon(page, lambda: attr(toggle, "aria-expanded") == "true" and stock.is_visible(), "the reopened section stays open")
        for _ in range(3):
            advance(page, POLL_MS)
        assert stock.is_visible() and body.evaluate("e => e.getAttribute('data-state')") == "open", "a stale timer re-hid the section"


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_wf_fulfilment_keyboard(browser: Any, app_url: str, size: str) -> None:
    manager = Api(app_url, TIAGO)
    order = new_order(app_url, HELENA, "AT05", "FITA-48")
    other = new_order(app_url, HELENA, "AT05", "FITA-48")
    number = order["number"]
    before = lambda: next(i for i in ok(manager.get(stock_url("AT05")))["lines"] if i["sku"] == "FITA-48")["on_hand"]
    with screen(browser, app_url, TIAGO, "/shop/AT05", size) as page:
        updates = status(page, "Shop updates")
        steps = [("Start picking", "picking", "Mark ready"), ("Mark ready", "ready", "Hand over"), ("Hand over", "collected", "Start return")]
        for action, state, following in steps:
            control = button(page, f"{action} {number}")
            visible(page, control)
            assert_target(control)
            control.focus()
            page.keyboard.press("Enter")
            says(page, updates, f"Order {number} is now {state}.")
            focus_is(page, button(page, f"{following} {number}"))
            assert ok(manager.get(f"/api/orders/{order['id']}"))["status"] == state
        assert button(page, f"Cancel {number}").count() == 0, "Cancel offered on a collected order"
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Return items")
        visible(page, dialog)
        quantity = role(dialog, "spinbutton", "Return quantity FITA-48")
        focus_is(page, quantity)
        page.keyboard.press("Control+A")
        page.keyboard.type("1")
        reason = role(dialog, "textbox", "Reason")
        tab_to(page, reason)
        page.keyboard.type(REASON_TAPE)
        ok(Api(app_url, CARE).post(f"/api/orders/{other['id']}/transitions", {"to": "cancelled"}))
        stock_level = before()
        advance(page, POLL_MS)
        other_row = role(page, "table", "Orders", ).get_by_role("row", name=re.compile(re.escape(other["number"])))
        soon(page, lambda: other_row.count() == 1 and button(other_row, f"Start picking {other['number']}").count() == 0, "the cancel appears beneath the dialog", 10)
        assert reason.input_value() == REASON_TAPE and quantity.input_value() == "1"
        assert focused(reason), "the refresh moved focus"
        tab_to(page, button(dialog, "Request return"))
        page.keyboard.press("Enter")
        ret = poll(lambda: [r for r in ok(manager.get("/api/returns", store_id="AT05"))["returns"] if r["order_id"] == order["id"]], "a stored return")[0]
        says(page, updates, f"Return {ret['number']} requested.")
        section_open(page, "Returns", size)
        receive = button(page, f"Receive {ret['number']}")
        visible(page, receive)
        assert_target(receive)
        assert button(page, f"Decline {ret['number']}").count() == 1
        label = button(page, f"Return label {ret['number']}")
        label.focus()
        page.keyboard.press("Enter")
        visible(page, page.get_by_text(f"Tramela return {ret['number']}"))
        focus_is(page, label)
        stored = S3().get(f"returns/atlantico/{ret['number']}.txt")
        page.keyboard.press("Enter")
        focus_is(page, label)
        assert S3().get(f"returns/atlantico/{ret['number']}.txt") == stored
        receive.focus()
        page.keyboard.press("Enter")
        says(page, updates, f"Return {ret['number']} is now received.")
        settle = button(page, f"Settle {ret['number']}")
        focus_is(page, settle)
        assert before() == stock_level + 1, "the received unit returns to stock"
        page.keyboard.press("Enter")
        says(page, updates, f"Return {ret['number']} is now settled.")
        focus_is(page, role(page, "table", "Returns"))
        assert button(page, f"Return label {ret['number']}").count() == 0
    final = ok(manager.get(f"/api/orders/{order['id']}"))
    assert final["status"] == "collected" and final["refunded_cents"] == 500 and final["lines"][0]["returned_quantity"] == 1
    assert before() == stock_level + 1


def test_wf_fulfilment_return_dialog_reload(browser: Any, app_url: str) -> None:
    order = collected_order(app_url, GIL, "AT05", quantity=3)
    manager = Api(app_url, TIAGO)
    with screen(browser, app_url, TIAGO, "/shop/AT05", TABLET) as page:
        click(visible(page, button(page, f"Start return {order['number']}")))
        dialog = role(page, "dialog", "Return items")
        visible(page, dialog)
        fill(role(dialog, "spinbutton", "Return quantity FITA-48"), "2")
        reason = role(dialog, "textbox", "Reason")
        fill(reason, REASON_COLOUR)
        reason.focus()
        scrolled = dialog.evaluate("e => { e.scrollTop = 30; return e.scrollTop; }")
        page.reload()
        dialog = role(page, "dialog", "Return items")
        visible(page, dialog)
        assert attr(dialog, "data-state") == "open"
        assert "opening" not in values_of(dialog.element_handle(), "data-state")
        reason = role(dialog, "textbox", "Reason")
        soon(page, lambda: reason.input_value() == REASON_COLOUR, "reason restored")
        assert role(dialog, "spinbutton", "Return quantity FITA-48").input_value() == "2"
        focus_is(page, reason)
        assert abs(dialog.evaluate("e => e.scrollTop") - scrolled) <= 10
        click(button(dialog, "Request return"))
        ret = poll(lambda: [r for r in ok(manager.get("/api/returns", store_id="AT05"))["returns"] if r["order_id"] == order["id"]], "a stored return")[0]
        assert ret["lines"][0]["quantity"] == 2 and ret["reason"] == REASON_COLOUR
        says(page, status(page, "Shop updates"), f"Return {ret['number']} requested.")


def _canonical(event: dict, order_id: str) -> bytes:
    body = {"at": event["at"], "data": event["data"], "order_id": order_id, "seq": event["seq"], "type": event["type"]}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _psql(sql: str) -> None:
    done = subprocess.run(["psql", os.environ["DATABASE_URL"], "-v", "ON_ERROR_STOP=1", "-c", sql],
                          capture_output=True, text=True, timeout=HTTP_TIMEOUT)
    assert done.returncode == 0, done.stderr


def test_history_chain_and_replay(browser: Any, app_url: str) -> None:
    order = collected_order(app_url, FILIPE, quantity=3)
    manager = Api(app_url, TIAGO)
    care = Api(app_url, CARE)
    ret = ok(manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": "Teste"}), 201)
    ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "received"}))
    ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "settled"}))
    events = ok(care.get(f"/api/orders/{order['id']}/events"))["events"]
    assert [e["type"] for e in events] == ["order.placed", "order.picking", "order.ready", "order.collected",
                                           "return.requested", "return.received", "return.settled"]
    previous = "0" * 64
    for seq, event in enumerate(events, start=1):
        assert event["seq"] == seq and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", event["at"])
        digest = hashlib.sha256(previous.encode("utf-8") + _canonical(event, order["id"])).hexdigest()
        assert event["digest"] == digest, f"entry {seq}"
        previous = digest
    placed = events[0]["data"]
    assert placed["number"] == order["number"] and placed["store_id"] == "AT06" and placed["total_cents"] == FITA_THREE
    assert placed["lines"][0]["sku"] == "FITA-48" and placed["lines"][0]["unit_price_milli"] == 4995
    assert events[1]["data"]["from"] == "placed" and events[1]["data"]["to"] == "picking" and events[1]["data"]["by"]
    assert events[4]["data"]["return_id"] == ret["id"] and events[4]["data"]["refund_cents"] == 500
    rows = Postgres().rows(f"SELECT seq, digest FROM order_events WHERE order_id = '{order['id']}' ORDER BY seq")
    assert [r["digest"] for r in rows] == [e["digest"] for e in events]
    replay = ok(care.get(f"/api/orders/{order['id']}/replay"))
    assert replay == {"order_id": order["id"], "status": "collected", "last_seq": 7, "total_cents": FITA_THREE, "refunded_cents": 500,
                      "returns": [{"id": ret["id"], "status": "settled", "refund_cents": 500}]}
    view = Postgres().rows(f"SELECT * FROM order_view WHERE order_id = '{order['id']}'")[0]
    assert (view["status"], view["last_seq"], view["total_cents"], view["refunded_cents"]) == ("collected", 7, FITA_THREE, 500)
    assert Api(app_url, ANA).get(f"/api/orders/{order['id']}/replay").status_code == 404
    _psql(f"UPDATE order_view SET status = 'cancelled', refunded_cents = 1 WHERE order_id = '{order['id']}'")
    assert ok(care.get(f"/api/orders/{order['id']}/replay")) == replay, "replay read the summary row"
    _psql(f"UPDATE order_events SET data = jsonb_set(data, '{{to}}', '\"ready\"') WHERE order_id = '{order['id']}' AND seq = 2")
    broken = {"code": "sequence_broken", "first_bad_seq": 2}
    for answer in (care.get(f"/api/orders/{order['id']}/events"), care.get(f"/api/orders/{order['id']}/replay"),
                   manager.post(f"/api/orders/{order['id']}/transitions", {"to": "picking"})):
        assert answer.status_code == 409 and answer.json() == broken, answer.text
    with screen(browser, app_url, CARE, f"/care/orders/{order['id']}", DESKTOP) as page:
        verify = button(page, "Verify history")
        visible(page, verify)
        click(verify)
        says(page, status(page, "Care updates"), "History is damaged from entry 2.")


def test_review_scrubber(browser: Any, app_url: str) -> None:
    order = new_order(app_url, GIL)
    lead = Api(app_url, LEAD)
    review = ok(lead.get("/api/estate/review"))
    start, end = [datetime.fromisoformat(review[k].replace("Z", "+00:00")) for k in ("window_start", "window_end")]
    assert (end - start).total_seconds() == 86400
    assert any(e["order_id"] == order["id"] and e["type"] == "order.placed" for e in review["events"])
    assert [e["at"] for e in review["events"]] == sorted(e["at"] for e in review["events"]), "oldest first"
    placed = sum(e["type"] == "order.placed" for e in review["events"])
    assert Api(app_url, ANA).get("/api/estate/review").status_code == 403
    with screen(browser, app_url, LEAD, "/estate", DESKTOP) as page:
        estate_ready(page)
        zoom_to_markers(page)
        region, slider = estate_map(page), role(page, "slider", "Review last 24 hours")
        assert attr(region, "data-review-progress") == progress_text(1)
        figure = tagged(page, "data-figure", "review-count")
        soon(page, lambda: int(attr(figure, "data-value")) >= placed, "the count at the newest moment")
        readout = status(page, "Review readout")
        for _ in range(3):
            advance(page, POLL_MS)
        assert attr(region, "data-review-progress") == progress_text(1), "the slider moved on its own"
        slider.focus()
        page.keyboard.press("ArrowLeft")
        has_attr(page, region, "data-review-progress", "0.990")
        assert slider.input_value() == "990" if slider.evaluate("e => e.tagName === 'INPUT'") else attr(slider, "aria-valuenow") == "990"
        page.keyboard.press("ArrowUp")
        has_attr(page, region, "data-review-progress", progress_text(1))
        page.keyboard.press("ArrowRight")
        assert attr(region, "data-review-progress") == progress_text(1), "keys stop at the end"
        page.keyboard.press("PageDown")
        has_attr(page, region, "data-review-progress", "0.900")
        page.keyboard.press("PageUp")
        has_attr(page, region, "data-review-progress", progress_text(1))
        node = figure.element_handle()
        page.keyboard.press("Home")
        has_attr(page, region, "data-review-progress", "0.000")
        has_attr(page, figure, "data-value", "0")
        soon(page, lambda: re.fullmatch(r"0 orders by \d\d:\d\d Lisbon time", txt(readout)), "readout at the window start")
        expected = start.astimezone(ZoneInfo("Europe/Lisbon"))
        minute = int(txt(readout).split(" by ")[1][:2]) * 60 + int(txt(readout).split(":")[1][:2])
        assert abs(minute - (expected.hour * 60 + expected.minute)) <= 1 or abs(minute - (expected.hour * 60 + expected.minute)) >= 86400 // 60 - 1
        soon(page, lambda: attr(figure, "data-counting") == "false", "the figure settles", step=FINE_MS)
        assert_span(events_of(node, "data-counting"), "true", "false", FIG_MIN_MS, FIG_MAX_MS)
        assert tagged(estate_map(page), "data-figure", "review-badge").count() == 0, "no badges before any order"
        page.keyboard.press("End")
        has_attr(page, region, "data-review-progress", progress_text(1))
        soon(page, lambda: re.fullmatch(rf"{attr(figure, 'data-value')} orders by \d\d:\d\d Lisbon time", txt(readout)), "readout at the end")
        badge = tagged(marker(page, "AT06"), "data-figure", "review-badge")
        visible(page, badge, "a count badge on a shop with an order")
        count = sum(e["type"] == "order.placed" and e["store_id"] == "AT06" for e in review["events"])
        assert int(attr(badge, "data-value")) >= count
    with screen(browser, app_url, LEAD, "/estate", DESKTOP, reduced=True) as page:
        estate_ready(page)
        slider = role(page, "slider", "Review last 24 hours")
        figure = tagged(page, "data-figure", "review-count")
        slider.focus()
        node = figure.element_handle()
        page.keyboard.press("Home")
        has_attr(page, estate_map(page), "data-review-progress", "0.000")
        has_attr(page, figure, "data-value", "0")
        assert "true" not in values_of(node, "data-counting")


def test_order_search_paging(app_url: str) -> None:
    customer = own_email("paginas")
    set_available(app_url, "AT01", "FITA-48", 12)
    made = [new_order(app_url, HELENA, "AT01", customer=customer, stocked=True) for _ in range(5)]
    care = Api(app_url, CARE)
    first = ok(care.get("/api/orders", q=customer, limit=2))
    assert first["count"] == 5 and len(first["orders"]) == 2 and first["next_before"]
    late = new_order(app_url, HELENA, "AT01", customer=customer, stocked=True)
    second = ok(care.get("/api/orders", q=customer, limit=2, before=first["next_before"]))
    assert second["count"] == 6, "count reflects the moment of the request"
    third = ok(care.get("/api/orders", q=customer, limit=2, before=second["next_before"]))
    assert third["next_before"] is None
    seen = [o["id"] for page_of in (first, second, third) for o in page_of["orders"]]
    assert seen == [o["id"] for o in reversed(made)], "pages repeat, skip or misorder"
    assert late["id"] not in seen, "a later order leaked into later pages"
    newest = ok(care.get("/api/orders", q=customer))
    assert newest["orders"][0]["id"] == late["id"] and newest["next_before"] is None
    row = newest["orders"][0]
    assert row["customer_email"].lower() == customer.lower() and row["store_id"] == "AT01" and row["number"] == late["number"]
    for params in ({"limit": 0}, {"limit": 101}, {"limit": "x"}, {"before": "not a cursor"}):
        answer = care.get("/api/orders", q=customer, **params)
        assert answer.status_code == 422 and next(iter(params)) in answer.json()["errors"], answer.text
    assert ok(care.get("/api/orders", q=customer, limit=100))["count"] == 6
    assert ok(Api(app_url, ANA).get("/api/orders", q=customer))["count"] == 0, "shoppers see only their own orders"
    filtered = ok(care.get("/api/orders", q=customer, store_id="AT01", status="placed", limit=1))
    assert filtered["count"] == 6 and len(filtered["orders"]) == 1
    manager = Api(app_url, RUI)
    for order in made + [late]:
        manager.post(f"/api/orders/{order['id']}/transitions", {"to": "cancelled"})


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_wf_order_history_care(browser: Any, app_url: str, size: str) -> None:
    customer = own_email("apoio")
    manager = Api(app_url, RUI)
    set_available(app_url, "AT01", "FITA-48", 30)
    orders = [new_order(app_url, HELENA, "AT01", customer=customer, stocked=True) for _ in range(21)]
    try:
        oldest, newest = orders[0], orders[-1]
        move_order(manager, oldest["id"], "picking", "ready", "collected")
        with screen(browser, app_url, CARE, "/care", size) as page:
            find = role(page, "searchbox", "Find order")
            tab_to(page, find)
            page.keyboard.type(customer)
            advance(page, DEBOUNCE_MS)
            updates = status(page, "Care updates")
            says(page, updates, "21 orders found.")
            more = button(page, "Show more orders")
            pressed = False
            for _ in range(25):
                if more.count() == 0:
                    break
                previous = txt(updates)
                tab_to(page, more)
                page.keyboard.press("Enter")
                pressed = True
                soon(page, lambda: txt(updates) != previous and txt(updates).startswith("Showing "), "the next page appended")
                assert page.evaluate("document.activeElement.getAttribute('href') || ''").startswith("/care/orders/"), "focus on an appended Open order link"
            if pressed:
                says(page, updates, "Showing 21 of 21 orders.")
            assert button(page, "Show more orders").count() == 0, "no next page, no button"
            link = role(page, "link", f"Open order {oldest['number']}")
            visible(page, link)
            link.focus()
            assert role(page, "link", f"Open order {newest['number']}").count() == 1
            page.keyboard.press("Enter")
            soon(page, lambda: urlparse(page.url).path == f"/care/orders/{oldest['id']}", "the care order address")
            history = role(page, "list", "Order history")
            visible(page, history)
            items = [txt(i) for i in role(history, "listitem").all()]
            assert len(items) == 4 and items[0].startswith("#1 order.placed ") and items[3].startswith("#4 order.collected ")
            assert re.fullmatch(r"#1 order\.placed \d{4}-\d\d-\d\d \d\d:\d\d", items[0]), items[0]
            verify = button(page, "Verify history")
            tab_to(page, verify)
            page.keyboard.press("Enter")
            says(page, updates, "History verified: 4 entries.")
            download = button(page, "Download order document")
            page.keyboard.press("Tab")
            focus_is(page, download)
            with page.expect_download() as info:
                page.keyboard.press("Enter")
            stored = S3().get(f"orders/atlantico/{oldest['number']}.json")
            assert Path(info.value.path()).read_bytes() == stored, "the download differs from the stored document"
            assert json.loads(stored)["status"] == "placed"
            page.goto(f"{app_url}/care/orders/{newest['id']}")
            cancel = button(page, "Cancel order")
            tab_to(page, cancel)
            page.keyboard.press("Enter")
            alert = role(page, "alertdialog", "Cancel order")
            visible(page, alert)
            focus_is(page, button(alert, "Keep order"))
            page.keyboard.press("Enter")
            soon(page, lambda: alert.count() == 0, "Keep order closes")
            focus_is(page, cancel)
            assert ok(manager.get(f"/api/orders/{newest['id']}"))["status"] == "placed", "Keep order cancelled"
            page.keyboard.press("Enter")
            visible(page, alert)
            button(alert, "Cancel order").focus()
            page.keyboard.press("Enter")
            says(page, status(page, "Care updates"), f"Order {newest['number']} is now cancelled.")
            assert ok(manager.get(f"/api/orders/{newest['id']}"))["status"] == "cancelled"
    finally:
        for order in orders:
            manager.post(f"/api/orders/{order['id']}/transitions", {"to": "cancelled"})


def _returned_order(base: str, customer: str | None = None) -> dict:
    order = collected_order(base, GIL, quantity=3, customer=customer)
    manager = Api(base, TIAGO)
    ret = ok(manager.post(f"/api/orders/{order['id']}/returns", {"lines": [{"sku": "FITA-48", "quantity": 1}], "reason": "Teste"}), 201)
    ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "received"}))
    ok(manager.post(f"/api/returns/{ret['id']}/transitions", {"to": "settled"}))
    return order


HISTORY_SCROLLER = """e => { for (let n = e; n && n !== document.body; n = n.parentElement) {
  const y = getComputedStyle(n).overflowY;
  if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) return n; } return null; }"""


def test_care_order_layout(browser: Any, app_url: str) -> None:
    order = _returned_order(app_url)
    for size in SIZES:
        with screen(browser, app_url, CARE, f"/care/orders/{order['id']}", size) as page:
            history = role(page, "list", "Order history")
            visible(page, history)
            fact = page.get_by_text(order["number"]).first
            spot, facts = box(history), box(fact)
            if size == DESKTOP:
                assert spot["x"] >= facts["x"] + facts["width"] - 1, f"history beside facts: {spot} {facts}"
            else:
                assert spot["y"] >= facts["y"] + facts["height"] - 1, f"history below facts: {spot} {facts}"
            height = history.evaluate_handle(HISTORY_SCROLLER).evaluate("p => p && p.getBoundingClientRect().height")
            assert height, "seven entries must scroll inside the panel"
            assert height <= 240, f"history panel {height} pixels tall"
            for item in role(history, "listitem").all():
                assert item.evaluate("e => e.getBoundingClientRect().height") >= MIN_TARGET
            visible(page, role(page, "table", "Order lines"))
            no_sideways(page)


def test_wf_order_history_reload(browser: Any, app_url: str) -> None:
    order = _returned_order(app_url)
    with screen(browser, app_url, CARE, f"/care/orders/{order['id']}", DESKTOP) as page:
        verify = button(page, "Verify history")
        visible(page, verify)
        click(verify)
        copy = "History verified: 7 entries."
        says(page, status(page, "Care updates"), copy)
        history = role(page, "list", "Order history")
        scrolled = history.evaluate_handle(HISTORY_SCROLLER).evaluate("p => { if (!p) return 0; p.scrollTop = 60; return p.scrollTop; }")
        assert scrolled > 0, "the history list must scroll"
        button(page, "Download order document").focus()
        page.reload()
        history = role(page, "list", "Order history")
        visible(page, history)
        soon(page, lambda: abs(history.evaluate_handle(HISTORY_SCROLLER).evaluate("p => p ? p.scrollTop : -100") - scrolled) <= 10,
             "history scroll restored")
        focus_is(page, button(page, "Download order document"))
        says(page, status(page, "Care updates"), copy)
    assert len(ok(Api(app_url, CARE).get(f"/api/orders/{order['id']}/events"))["events"]) == 7


def test_wf_cross_cutting_manifest_health(browser: Any, app_url: str) -> None:
    for base in (app_url, twin()):
        answer = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
        assert answer.status_code == 200 and answer.json() == {"status": "ok"}
        assert httpx.get(base + "/", timeout=HTTP_TIMEOUT).status_code == 200
    order = new_order(app_url, EVA)
    read = ok(Api(twin(), CARE).get(f"/api/orders/{order['id']}"))
    assert read["number"] == order["number"]
    with screen(browser, twin(), None, "/sign-in", DESKTOP) as page:
        sign_in_keys(page, CARE)
        soon(page, lambda: urlparse(page.url).path == "/care", "sign-in on the twin lands on /care")
        find = role(page, "searchbox", "Find order")
        visible(page, find)
        fill(find, order["number"])
        advance(page, DEBOUNCE_MS)
        says(page, status(page, "Care updates"), "1 orders found.")
        visible(page, role(page, "link", f"Open order {order['number']}"))


def test_server_boundary(browser: Any, app_url: str) -> None:
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    body = {"email": own_email("fronteira"), "password": PASSWORD}
    answer = anon.post("/api/session", json=body, headers={"Origin": "https://elsewhere.example"})
    assert answer.status_code == 403 and answer.json() == {"code": "cross_origin"}
    assert not [h for h in answer.headers if h.lower().startswith(CORS_HEADER_PREFIX)]
    no_body = anon.delete("/api/session", headers={"Origin": "https://elsewhere.example"})
    assert no_body.status_code == 403 and no_body.json() == {"code": "cross_origin"}
    assert anon.delete("/api/session").status_code == 401, "a write with no body needs no content type"
    plain = anon.post("/api/session", content="email=x", headers={"Content-Type": "text/plain"})
    assert plain.status_code == 415 and plain.json() == {"code": "unsupported_media_type"}
    base = json.dumps({"email": own_email("tamanho"), "password": "x", "pad": ""})
    fitted = base[:-2] + "x" * (BODY_LIMIT - len(base)) + '"}'
    assert len(fitted.encode()) == BODY_LIMIT
    headers = {"Content-Type": "application/json"}
    assert anon.post("/api/session", content=fitted, headers=headers).status_code == 401, "exactly the limit is accepted"
    over = anon.post("/api/session", content=fitted + " ", headers=headers)
    assert over.status_code == 413 and over.json() == {"code": "payload_too_large"}
    for path in ("/package.json", "/run.json", "/.env", "/package-lock.json", "/src/server.ts", "/tsconfig.json"):
        answer = anon.get(path, follow_redirects=False)
        assert answer.status_code == 404 and answer.headers["content-type"].startswith("text/html"), f"{path}: {answer.status_code}"
        assert "We couldn't find that page." in answer.text or "_schema" not in answer.text
        assert FILE_KEY_MARKER not in answer.text and "run-manifest-v1" not in answer.text, f"{path} leaks a file"
    unknown = anon.get(UNKNOWN_API_PATH)
    assert unknown.status_code == 404 and unknown.json() == {"code": "not_found"}
    secrets = [os.environ[name] for name in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if os.environ.get(name)]
    with screen(browser, app_url, ANA, "/catalogue", DESKTOP) as page:
        assets: list[str] = []
        page.on("response", lambda r: assets.append(r.url) if same_origin(r.url, app_url) else None)
        page.reload()
        visible(page, role(page, "searchbox", "Search products"))
        for url in set(assets):
            content = httpx.get(url, timeout=HTTP_TIMEOUT).text
            for secret in secrets:
                assert secret not in content, f"a credential was served at {url}"


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_wf_cross_cutting_responsive(browser: Any, app_url: str, size: str) -> None:
    order = new_order(app_url, HELENA)
    shopper = Api(app_url, ANA)
    set_available(app_url, "AT06", "FITA-48", 5)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    routes = [(LEAD, "/estate"), (ANA, "/catalogue"), (ANA, "/products/VM-750"), (ANA, "/cart"),
              (TIAGO, "/shop/AT06"), (CARE, "/care"), (CARE, f"/care/orders/{order['id']}"), (HELENA, f"/orders/{order['id']}")]
    for email, route in routes:
        with screen(browser, app_url, email, route, size) as page:
            link = role(page, "link", "Tramela Estate")
            visible(page, link)
            advance(page, 1000)
            no_sideways(page)
            axe_contrast(page)
            for kind in ("button", "checkbox", "textbox", "searchbox", "combobox", "spinbutton"):
                for control in role(page, kind).all():
                    if control.is_visible():
                        assert_target(control)
            sample = button(page, "Sign out") if size != PHONE else button(page, "Menu")
            _, focus_state = state_styles(sample, "outline-style", "outline-width", state="focus")
            assert focus_state["outline-style"] == "solid" and float(focus_state["outline-width"].replace("px", "")) >= 3, f"{route}: {focus_state}"
    with screen(browser, app_url, TIAGO, "/shop/AT06", size) as page:
        row = role(page, "table", "Orders").get_by_role("row", name=re.compile(re.escape(order["number"])))
        visible(page, row)
        assert "placed" in txt(row).lower(), "an order status needs a word"
    reset_shopper(shopper)


def _no_running(page: Any, where: str) -> None:
    running = "document.getAnimations().filter(a => a.playState === 'running').length"
    soon(page, lambda: page.evaluate(running) == 0, f"no running animation on {where}", seconds=10)
    advance(page, 2000)
    assert page.evaluate(running) == 0, f"an animation restarted on {where}"


def test_motion_contract(browser: Any, app_url: str) -> None:
    with screen(browser, app_url, None, "/", DESKTOP) as page:
        _no_running(page, "the landing page")
    order = new_order(app_url, HELENA)
    for email, route in ((LEAD, "/estate"), (ANA, "/catalogue"), (TIAGO, "/shop/AT06"), (CARE, f"/care/orders/{order['id']}"), (HELENA, f"/orders/{order['id']}")):
        with screen(browser, app_url, email, route, DESKTOP) as page:
            visible(page, role(page, "link", "Tramela Estate"))
            _no_running(page, route)
    for reduced in (False, True):
        with screen(browser, app_url, LEAD, "/estate", TABLET, reduced=reduced) as page:
            estate_ready(page)
            click(button(page, "Filters"))
            sheet = role(page, "region", "Filters")
            visible(page, sheet)
            handle = sheet.element_handle()
            has_attr(page, sheet, "data-state", "open")
            click(button(page, "Filters"))
            soon(page, lambda: role(page, "region", "Filters").count() == 0, "filter sheet closed", step=FINE_MS)
            soon(page, lambda: "closed" in values_of(handle, "data-state") or events_of(handle, "removed"),
                 "filter sheet finished closing", step=FINE_MS)
            states = values_of(handle, "data-state")
            if reduced:
                assert "opening" not in states and "closing" not in states, states
            else:
                assert_span(events_of(handle, "data-state"), "opening", "open", STATE_MIN_MS, STATE_MAX_MS)
                final = "closed" if "closed" in states else ("removed" if events_of(handle, "removed") else None)
                assert final, states
                assert_span(events_of(handle, "data-state") + events_of(handle, "removed"), "closing", final, STATE_MIN_MS, STATE_MAX_MS)
            _no_running(page, "the estate after a sheet")
        shopper = Api(app_url, ANA)
        reset_shopper(shopper)
        with screen(browser, app_url, ANA, "/products/FITA-48", DESKTOP, reduced=reduced) as page:
            figure = tagged(page, "data-figure", "cart-total")
            visible(page, figure)
            node = figure.element_handle()
            click(button(page, "Add to cart"))
            has_attr(page, figure, "data-value", "500")
            soon(page, lambda: attr(figure, "data-counting") == "false", "the figure settles", step=FINE_MS)
            seen = values_of(node, "data-counting")
            if reduced:
                assert "true" not in seen, seen
            else:
                assert_span(events_of(node, "data-counting"), "true", "false", FIG_MIN_MS, FIG_MAX_MS)
            _no_running(page, "the product page")
        reset_shopper(shopper)


LANDING = {"375x812": (24, 40), "768x1024": (32, 64), "1280x800": (48, 80)}


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_landing_geometry(browser: Any, app_url: str, size: str) -> None:
    width, height = dims(size)
    reach, tall = LANDING[size]
    with screen(browser, app_url, None, "/", size) as page:
        tramela, estate = tagged(page, "data-pin", "tramela"), tagged(page, "data-pin", "estate")
        visible(page, tramela)
        for scroll in (0, 400):
            page.evaluate("y => window.scrollTo(0, y)", scroll)
            advance(page, STEP_MS)
            top, bottom = box(tramela), box(estate)
            assert 0 <= top["x"] <= reach and 0 <= top["y"] <= reach, f"TRAMELA at {top}"
            assert width - reach <= bottom["x"] + bottom["width"] <= width, f"ESTATE at {bottom}"
            assert height - reach <= bottom["y"] + bottom["height"] <= height, f"ESTATE at {bottom}"
            assert top["height"] >= tall and bottom["height"] >= tall
            if size == PHONE:
                assert top["width"] < width and bottom["width"] < width
        for word in (tramela, estate):
            found = style(word, "mix-blend-mode", "pointer-events")
            assert found["mix-blend-mode"] == "difference" and found["pointer-events"] == "none", found
        page.evaluate("window.scrollTo(0, 0)")
        advance(page, STEP_MS)
        sentence = page.get_by_text("Every shop in your group, every tin on its shelves, every collection hour in its own local time.")
        visible(page, sentence)
        link = role(page, "link", "Sign in")
        visible(page, link)
        assert_target(link)
        shared = sentence.evaluate("""(e, link) => {
            const paint = document.createElement('canvas').getContext('2d');
            let n = e; while (n && !n.contains(link)) n = n.parentElement;
            for (; n; n = n.parentElement) {
              paint.clearRect(0, 0, 1, 1); paint.fillStyle = getComputedStyle(n).backgroundColor; paint.fillRect(0, 0, 1, 1);
              const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
              if (a > 0) return Math.min(r, g, b) >= 230; }
            return false; }""", link.element_handle())
        assert shared, "the sentence and Sign in share the white panel"
        if size != PHONE:
            assert box(link)["x"] + box(link)["width"] <= width / 2 + reach, "the white panel is on the left"
        no_sideways(page)


@pytest.mark.parametrize("size", SIZES, ids=SIZES)
def test_not_found_screen(browser: Any, app_url: str, size: str) -> None:
    with screen(browser, app_url, None, "/", size) as page:
        not_found_screen(page, page.goto(app_url + "/no-such-page"))
        assert role(page, "link", "Tramela Estate").count() == 1
        assert button(page, "Sign out").count() == 0 and button(page, "Menu").count() == 0
        no_sideways(page)
    with screen(browser, app_url, ANA, "/catalogue", size) as page:
        not_found_screen(page, page.goto(app_url + "/no-such-page"))
        no_sideways(page)
        not_found_screen(page, page.goto(app_url + "/estate"))
        not_found_screen(page, page.goto(app_url + "/run.json"))


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
FONT_LICENCE = r"OFL[-\s]*(?:v(?:ersion)?\s*)?1\.1|Open Font Licen[cs]e[^\n]{0,30}?1\.1"
APP_DIR = Path("/app")


def _source_files() -> list[Path]:
    skip = {"node_modules", "dist", "build", "out", ".git", ".next", "coverage"}
    return [p for p in APP_DIR.rglob("*") if p.is_file() and not skip & set(p.relative_to(APP_DIR).parts)]


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest[field], str) and manifest[field].strip(), field


def test_if_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices, f"{package.name} is not in the notices"
    for name in ("Big Shoulders", "Public Sans"):
        assert name in notices, name
    assert re.search(FONT_LICENCE, notices, re.I), "the fonts' licence is not named"
    assert re.search(r"coast|geometr|natural earth", notices, re.I), "the coastline data is not named"


def test_if_licences() -> None:
    for package in shipped_packages():
        assert licence_allowed(package.licence, ALLOWLIST), f"{package.name}: {package.licence}"
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    assert re.search(FONT_LICENCE, notices, re.I), "font licence"
    assert re.search(r"CC0|Creative Commons Zero|public[- ]domain", notices, re.I), "geometry licence"


def test_if_no_extra_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "memcached", "level", "lmdb", "mongodb", "mongoose", "nedb"}
    assert not banned & {package.name for package in shipped_packages()}
    assert not [p for p in _source_files() if p.suffix in (".sqlite", ".sqlite3", ".db")]
    tables = {name.rsplit(".", 1)[-1] for name in Postgres().tables()}
    assert "order_events" in tables and "order_view" in tables


def test_if_typescript_only() -> None:
    files = _source_files()
    typescript: dict[Path, set[str]] = {}
    for p in files:
        if p.suffix in (".ts", ".tsx", ".mts", ".cts"):
            typescript.setdefault(p.parent, set()).add(p.name.split(".")[0])
    assert typescript, "no TypeScript sources"
    javascript = [p for p in files if p.suffix in (".js", ".mjs", ".cjs", ".jsx") and p.parent in typescript
                  and p.name.split(".")[0] not in typescript[p.parent] and not p.with_name(p.name + ".map").exists()
                  and ".config." not in p.name and not p.name.startswith(".")]
    assert javascript == [], f"hand-written JavaScript: {javascript}"


def test_if_service_config() -> None:
    provided = ("postgres", "minio", "mailpit")
    for path in _source_files():
        if re.fullmatch(r"(docker-)?compose.*\.ya?ml", path.name):
            content = path.read_text()
            if any(re.search(rf"(?m)^\s+{service}\s*:\s*(#.*)?$", content) for service in provided):
                for service in provided:
                    assert service in content, f"{path} lost {service}"


def test_if_same_origin(browser: Any, app_url: str) -> None:
    seen: list[str] = []
    with screen(browser, app_url, None, "/", DESKTOP) as page:
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        visible(page, role(page, "link", "Sign in"))
    with screen(browser, app_url, LEAD, "/", DESKTOP) as page:
        page.on("request", lambda r: seen.append(r.url))
        page.goto(app_url + "/estate")
        estate_ready(page)
        advance(page, 1000)
    outside = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert seen and outside == [], f"third-party requests: {outside}"


STANDARD_WEEKDAY_SLOTS = [f"{hour:02d}:{minute:02d}" for hour in range(9, 19) for minute in (0, 30)]


def test_order_money_fields(app_url: str) -> None:
    lead = Api(app_url, LEAD)
    assert ok(lead.get(store_url("AT01")))["vat_rate"] == 23 and ok(lead.get(store_url("AT11")))["vat_rate"] == 16
    shopper = Api(app_url, EVA)
    set_available(app_url, "AT01", "FITA-48", 8)
    set_available(app_url, "AT01", "VM-750", 6)
    fill_cart(shopper, "AT01", {"FITA-48": 3, "VM-750": 1})
    hold = ok(shopper.post("/api/holds", {}), 201)
    slot = offered_slot(shopper, "AT01")
    body = {"hold_id": hold["id"], "slot_start_utc": slot["start_utc"],
            "customer": {"name": "Eva Couto", "email": own_email("iva")}}
    mainland = ok(shopper.post("/api/orders", body, key=request_key()), 201)
    lines = {line["sku"]: line for line in mainland["lines"]}
    assert sorted(lines) == ["FITA-48", "VM-750"], mainland["lines"]
    fita, varnish = lines["FITA-48"], lines["VM-750"]
    assert (fita["quantity"], fita["unit_price_milli"], fita["line_total_cents"]) == (3, 4995, FITA_THREE)
    assert (varnish["quantity"], varnish["unit_price_milli"], varnish["line_total_cents"]) == (1, 24900, VARNISH)
    assert fita["vat_rate"] == 23 and varnish["vat_rate"] == 23
    assert fita["vat_cents"] == FITA_THREE_VAT_MAINLAND and varnish["vat_cents"] == VARNISH_VAT_MAINLAND
    assert fita["returned_quantity"] == 0 and varnish["returned_quantity"] == 0
    assert mainland["total_cents"] == FITA_THREE + VARNISH, mainland
    assert mainland["vat_cents"] == FITA_THREE_VAT_MAINLAND + VARNISH_VAT_MAINLAND, mainland
    assert mainland["refunded_cents"] == 0
    azores = new_order(app_url, EVA, "AT11", "FITA-48", 3)
    line = azores["lines"][0]
    assert line["vat_rate"] == 16 and line["line_total_cents"] == FITA_THREE and line["vat_cents"] == FITA_THREE_VAT_AZORES, line
    assert azores["total_cents"] == FITA_THREE and azores["vat_cents"] == FITA_THREE_VAT_AZORES and azores["refunded_cents"] == 0
    reset_shopper(shopper)


def test_hold_expired_answer_replays(app_url: str) -> None:
    base = short_hold()
    shopper = Api(base, BRUNO)
    set_available(base, "AT06", "FITA-48", 6)
    fill_cart(shopper, "AT06", {"FITA-48": 1})
    hold = ok(shopper.post("/api/holds", {}), 201)
    slot = offered_slot(shopper, "AT06")
    poll(lambda: ok(shopper.get(f"/api/holds/{hold['id']}"))["status"] == "released", "the hold window ends on the server", SHORT_HOLD + 5)
    customer = own_email("expirada")
    body = {"hold_id": hold["id"], "slot_start_utc": slot["start_utc"], "customer": {"name": "Bruno Faria", "email": customer}}
    key = request_key()
    first = shopper.post("/api/orders", body, key=key)
    assert first.status_code == 409 and first.json() == {"code": "hold_expired", "hold_id": hold["id"]}, first.text
    again = shopper.post("/api/orders", body, key=key)
    assert again.status_code == 409 and again.content == first.content, again.text
    assert [line["sku"] for line in ok(shopper.get("/api/cart"))["lines"]] == ["FITA-48"], "a failed placement leaves the cart unchanged"
    fresh = ok(shopper.post("/api/holds", {}), 201)
    placed = ok(shopper.post("/api/orders", {**body, "hold_id": fresh["id"]}, key=request_key()), 201)
    assert placed["status"] == "placed" and placed["customer"]["email"] == customer
    late = shopper.post("/api/orders", body, key=key)
    assert late.status_code == 409 and late.content == first.content, late.text
    assert ok(shopper.get("/api/orders", q=customer))["count"] == 1
    reset_shopper(shopper)


def test_cart_change_releases_hold(app_url: str) -> None:
    shopper = Api(app_url, GIL)
    manager = Api(app_url, TIAGO)
    held_units = lambda: next(i for i in ok(manager.get(stock_url("AT06")))["lines"] if i["sku"] == "REL-1KG")["held"]
    set_available(app_url, "AT06", "REL-1KG", 6)
    fill_cart(shopper, "AT06", {"REL-1KG": 2})
    before = held_units()
    first = ok(shopper.post("/api/holds", {}), 201)
    assert held_units() == before + 2
    changed_lines = ok(shopper.put(line_url("REL-1KG"), {"quantity": 1}))
    assert changed_lines["hold"] is None and [(i["sku"], i["quantity"]) for i in changed_lines["lines"]] == [("REL-1KG", 1)]
    assert ok(shopper.get(f"/api/holds/{first['id']}"))["status"] == "released" and held_units() == before
    late = shopper.delete(f"/api/holds/{first['id']}")
    assert late.status_code == 409 and late.json()["code"] == "invalid_transition", late.text
    assert held_units() == before, "a release returned its units twice"
    second = ok(shopper.post("/api/holds", {}), 201)
    assert held_units() == before + 1
    kept = ok(shopper.put("/api/cart/area", LISBOA))
    assert kept["hold"] is not None and kept["hold"]["id"] == second["id"] and kept["hold"]["status"] == "active", kept
    assert held_units() == before + 1
    moved = ok(shopper.put("/api/cart/store", {"store_id": "AT05"}))
    assert moved["hold"] is None and moved["store_id"] == "AT05", moved
    assert ok(shopper.get(f"/api/holds/{second['id']}"))["status"] == "released" and held_units() == before
    reset_shopper(shopper)


def test_store_state_filter_api(app_url: str) -> None:
    lead = Api(app_url, LEAD)
    manager = Api(app_url, RUI)
    for wrong in ("bogus", "open,bogus"):
        answer = lead.get("/api/stores", state=wrong)
        assert answer.status_code == 422, answer.text
        assert answer.json()["code"] == "validation_failed" and "state" in answer.json()["errors"], answer.text

    def agree() -> list[str]:
        everything = ok(lead.get("/api/stores"))
        union = ok(lead.get("/api/stores", state=ALL_STATES))
        assert [s["id"] for s in union["stores"]] == [s["id"] for s in everything["stores"]] and union["count"] == everything["count"]
        pair = ok(lead.get("/api/stores", state="stock_critical,suspended"))
        expected = [s["id"] for s in everything["stores"] if s["display_state"] in ("stock_critical", "suspended")]
        assert [s["id"] for s in pair["stores"]] == expected and pair["count"] == len(expected), pair
        return expected

    assert "AT07" in agree(), "the seeded suspended shop is listed"
    before = next(i for i in ok(manager.get(stock_url("AT01")))["lines"] if i["sku"] == "REL-1KG")
    try:
        ok(manager.post(count_url("AT01", "REL-1KG"), {"on_hand": 2}))
        assert "AT01" in agree(), "a stock count that makes a line critical is in the filter on the next read"
    finally:
        ok(manager.post(count_url("AT01", "REL-1KG"), {"on_hand": before["on_hand"]}))
    agree()


def test_suspended_shop_keeps_day_plan(app_url: str) -> None:
    lead = Api(app_url, LEAD)
    shop = ok(lead.get(store_url("AT07")))
    assert shop["suspended"] is True and shop["display_state"] == "suspended" and shop["suspension_reason"] == "Flood repairs", shop
    shopper = Api(app_url, ANA)
    fill_cart(shopper, "AT07", {"FITA-48": 1})
    refused = shopper.post("/api/holds", {})
    assert refused.status_code == 409 and refused.json() == {"code": "store_suspended", "store_id": "AT07"}, refused.text
    assert ok(shopper.get("/api/cart"))["hold"] is None
    assert ok(shopper.get(slots_url("AT07")))["days"] == []
    plan = ok(shopper.get(plan_url("AT07"), date="2027-03-24"))
    assert plan["open"] is True and plan["opens_local"] == "09:00" and plan["closes_local"] == "19:00", plan
    assert [s["start_local"] for s in plan["slots"]] == STANDARD_WEEKDAY_SLOTS, plan["slots"]
    assert all(s["remaining"] == 2 and s["utc_offset"] == "+00:00" for s in plan["slots"]), plan["slots"]
    shops = ok(shopper.get(avail_url("FITA-48"), lat=FARO["lat"], lon=FARO["lon"]))["shops"]
    assert {s["store_id"]: s["holdable"] for s in shops}.get("AT07") is False, shops
    assert all(s["holdable"] is (s["display_state"] != "suspended") for s in shops), shops
    reset_shopper(shopper)


def test_day_plan_date_bounds(app_url: str) -> None:
    person = Api(app_url, ANA)
    for date in ("2026-01-01", "2030-12-31"):
        plan = ok(person.get(plan_url("AT02"), date=date))
        assert plan["store_id"] == "AT02" and plan["date"] == date and plan["timezone"] == "Europe/Lisbon", plan
        assert plan["open"] is True and [s["start_local"] for s in plan["slots"]] == STANDARD_WEEKDAY_SLOTS, plan
        assert all(s["remaining"] == 2 for s in plan["slots"]), plan["slots"]
    for date in ("2025-12-31", "2031-01-01", "2026-02-30"):
        assert person.get(plan_url("AT02"), date=date).status_code == 422, date


def test_hold_needs_cart_lines(app_url: str) -> None:
    shopper = Api(app_url, HELENA)
    fill_cart(shopper, "AT06", {})
    refused = shopper.post("/api/holds", {})
    assert refused.status_code == 422, refused.text
    assert refused.json()["code"] == "validation_failed" and "cart" in refused.json()["errors"], refused.text
    assert ok(shopper.get("/api/cart"))["hold"] is None
