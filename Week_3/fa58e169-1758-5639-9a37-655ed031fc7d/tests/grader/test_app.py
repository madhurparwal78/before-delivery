from __future__ import annotations

import json
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Locator, Page, expect

from conftest import (
    Postgres,
    addresses,
    advance,
    animations,
    axe,
    capture,
    center,
    click as kit_click,
    decode,
    difference,
    fill as kit_fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    pdf_text,
    same_origin,
    select as kit_select,
    session,
    shipped_packages,
    state_styles,
    style,
    text,
    unique,
)

HTTP_SECONDS = 30
WAIT_SECONDS = 20
EXPECT_MS = 15000
TAB_LIMIT = 80
WRAP_PRESSES = 12
RATE_DEADLINE_SECONDS = 55
RATE_BATCH = 200
RATE_WORKERS = 16
GRADING_KEY = os.environ.get("GRADING_KEY", "twinrow-grading-key-2027")
PASSWORD = "stockinette-27"
OTHER_PASSWORD = "garter-stitch-27"
HEX_A = "#2f4858"
HEX_B = "#c94f7c"
HEX_C = "#5b8c5a"
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
TOUCH_PHONE = (390, 844)
BELOW_TABLET = 599
TABLET_START = 600
TABLET_END = 1023
DESKTOP_START = 1024
MIN_CELL_PX = 32
MIN_TARGET_PX = 44
RAIL_MIN_PX = 190
RAIL_MAX_PX = 320
SWIPE_PX = 50
FLASH_MS = 600
NOTICE_SLIDE_MS = 250
OUTLINE_MS = 2000
SAVE_MAX_SECONDS = 1
BODY_LIMIT = 1000000
NAME_LIMIT = 120
VERSION_NOTE_LIMIT = 200
UNKNOWN_TOKEN = "unknown-token"

K4 = "k k k k"
K8 = "k k k k k k k k"
K10 = "k k k k k k k k k k"
K24 = "k k k k k k k k k k k k k k k k k k k k k k k k"
RIB = "k k p p k k p p k k"


def W(*parts: str | tuple[str, int]) -> str:
    return " ".join(p if isinstance(p, str) else " ".join([p[0]] * p[1]) for p in parts)


def needs(row: int, needed: int, found: int) -> str:
    return f"Row {row} needs {needed} stitches, found {found}."


def newer(latest: int, following: int) -> str:
    return f"Version {latest} is out. You are following version {following}."


def by_data_row(scope: Locator, row: int) -> Locator:
    return scope.locator(f'[data-row="{row}"]')

SHAPING_ROWS = {
    "1": "k k k k k k k k k k k k",
    "2": "k k k k k k k k k k k k",
    "3": "ns k k2tog k k k k k k ssk k ns",
    "4": "ns k ssk k k k k k2tog k ns ns ns",
    "5": "ns k k k k k k k k ns ns ns",
    "6": "ns k k k k k k k k ns ns ns",
    "7": "ns k m1r k k k k k k m1l k ns",
}
SHAPING_LINES = {
    "1": "Row 1 (RS): k12. (12 sts)",
    "2": "Row 2 (WS): p12. (12 sts)",
    "3": "Row 3 (RS): k1, ssk, k6, k2tog, k1. (10 sts)",
    "4": "Row 4 (WS): p1, ssp, p4, p2tog, p1. (8 sts)",
    "5": "Row 5 (RS): k8. (8 sts)",
    "6": "Row 6 (WS): p8. (8 sts)",
    "7": "Row 7 (RS): k1, m1l, k6, m1r, k1. (10 sts)",
}
CROCHET_ROWS = {
    "1": "sc sc sc sc sc sc ns ns",
    "2": "sc inc sc sc inc sc ns ns",
    "3": "dc dc dc dc dc dc dc dc",
    "4": "dec dc dc dc dec dc ns ns",
}

expect.set_options(timeout=EXPECT_MS)

MAIN = {"letter": "A", "name": "Main", "hex": HEX_A}
CONTRAST = {"letter": "B", "name": "Contrast", "hex": HEX_B}
THIRD = {"letter": "C", "name": "Moss", "hex": HEX_C}

CHART_JS = """g => ({
  colcount: g.getAttribute('aria-colcount'),
  order: [...g.querySelectorAll('[data-side]')].map(r => r.getAttribute('data-row')),
  rows: Object.fromEntries([...g.querySelectorAll('[data-side]')].map(r => [r.getAttribute('data-row'), {
    side: r.getAttribute('data-side'), used: r.getAttribute('data-used'), made: r.getAttribute('data-made'),
    state: r.getAttribute('data-count-state'), notes: r.getAttribute('data-notes'),
    follow: r.getAttribute('data-follow'),
    count: ((r.querySelector('[data-count]') || {}).textContent || '').trim()}])),
  cells: [...g.querySelectorAll('[data-col]')].map(c => ({
    row: Number(c.getAttribute('data-row')), col: Number(c.getAttribute('data-col')),
    stitch: c.getAttribute('data-stitch'), colour: c.getAttribute('data-colour'),
    repeat: c.getAttribute('data-repeat'), lift: c.getAttribute('data-lift'),
    cursor: c.getAttribute('data-cursor'), tabindex: c.getAttribute('tabindex'),
    selected: c.getAttribute('aria-selected') === 'true', current: c.getAttribute('aria-current'),
    peer: c.getAttribute('data-peer'), diff: c.getAttribute('data-diff'),
    motion: c.getAttribute('data-motion'), outline: c.getAttribute('data-outline')}))
})"""
LINES_JS = """l => Object.fromEntries([...l.querySelectorAll('[data-line]')].map(
  e => [e.closest('[data-row]').getAttribute('data-row'), e.textContent.trim()]))"""
TOP_JS = "e => e.getBoundingClientRect().top"
LEFT_JS = "e => e.getBoundingClientRect().left"
FOCUSED_JS = "e => e === document.activeElement"
IN_DIALOG_JS = "() => !!document.activeElement.closest('[role=dialog],dialog')"
ANY_MOTION_JS = "() => document.querySelector('[data-motion]') !== null"
MIDDLE_JS = """g => {
  let e = g;
  while (e && e !== document.documentElement) {
    const s = getComputedStyle(e);
    if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) break;
    e = e.parentElement;
  }
  const box = e.getBoundingClientRect();
  const row = g.querySelector('[data-follow="current"]').getBoundingClientRect();
  return (row.top + row.height / 2 - box.top) / box.height;
}"""
SCROLLS_JS = """() => [document.documentElement, ...document.querySelectorAll('*')]
  .filter(e => e.scrollTop > 0).map(e => e.scrollTop)"""

LABEL_POINT_JS = """(e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const own = !!hit && (hit === e || e.contains(hit));
  if (own || !e.labels || !e.labels.length) return null;
  if (!(r.width < 4 || r.height < 4 || s.opacity === '0' || Array.from(e.labels).some(l => l.contains(hit)))) return null;
  const l = Array.from(e.labels).find(x => x.getBoundingClientRect().width > 0) || e.labels[0];
  const b = l.getBoundingClientRect(), p = {x: b.left + Math.min(b.width / 2, 12), y: b.top + b.height / 2};
  const at = document.elementFromPoint(p.x, p.y);
  return at && l.contains(at) ? p : null; }"""

SOCKET_FRAMES: dict[int, list[int]] = {}


def centred(locator: Locator) -> Locator:
    expect(locator).to_be_visible()
    locator.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})")
    return locator


def click(locator: Locator) -> None:
    kit_click(centred(locator))


def fill(locator: Locator, value: str) -> None:
    kit_fill(centred(locator), value)


def select(locator: Locator, choice: str) -> None:
    kit_select(centred(locator), choice)


def check(locator: Locator) -> None:
    if not locator.is_checked():
        point = centred(locator).evaluate(LABEL_POINT_JS)
        if point:
            expect(locator).to_be_enabled()
            locator.page.mouse.click(point["x"], point["y"])
        else:
            kit_click(locator)
    expect(locator).to_be_checked()


@dataclass(frozen=True)
class Person:
    name: str
    email: str
    password: str = PASSWORD


def person(name: str) -> Person:
    first, second = unique("twin")
    email = first if "@" in first else second
    if "@" not in email:
        email = f"{email}@twinrow.test"
    return Person(name, email.lower())


def tag(prefix: str) -> str:
    return f"{prefix} {idempotency_key().replace('-', '')[:8]}"


def url(base: str, path: str) -> str:
    return base.rstrip("/") + path


def down() -> str:
    return os.environ["APP_VALKEY_DOWN_URL"]


def poll(check_fn: Callable[[], Any], what: str, seconds: float = WAIT_SECONDS) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = check_fn()
        if last:
            return last
    pytest.fail(f"{what}; last saw {last!r}")


def poll_eq(get: Callable[[], Any], want: Any, what: str, seconds: float = WAIT_SECONDS) -> None:
    deadline = time.monotonic() + seconds
    seen = None
    while time.monotonic() < deadline:
        seen = get()
        if seen == want:
            return
    pytest.fail(f"{what}; expected {want!r}, saw {seen!r}")


def snap(rows: dict[str, str], width: int, height: int, cast_on: int, **extra: Any) -> dict[str, Any]:
    version = {"note": "", "rows": rows, "colourRows": {}, "height": height, "width": width,
               "castOn": cast_on, "repeats": []}
    version.update(extra)
    return version


def tester(who: Person, version: int = 1, row: int = 1, notes: list | None = None) -> dict[str, Any]:
    return {"email": who.email, "version": version, "row": row, "notes": notes or []}


tester.__test__ = False


def seed(base: str, owner: Person, *others: Person, **fields: Any) -> str:
    key = tag("chart").replace(" ", "-")
    pattern: dict[str, Any] = {
        "key": key, "owner": owner.email, "name": tag("Swatch"), "craft": "knit", "mode": "flat",
        "terms": None, "castOn": 10, "width": 10, "height": 2, "rows": {}, "colours": [MAIN],
        "colourRows": {}, "repeats": [], "coDesigners": [], "versions": [], "published": False,
        "testers": [], "invites": [],
    }
    pattern.update(fields)
    users = [{"email": p.email, "name": p.name, "password": p.password, "verified": True}
             for p in (owner, *others)]
    response = httpx.post(url(base, "/api/grading/setup"), json={"users": users, "patterns": [pattern]},
                          headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_SECONDS)
    assert response.status_code == 200, response.text
    return response.json()["patterns"][key]


def client(base: str, who: Person | None = None) -> httpx.Client:
    c = httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_SECONDS)
    if who:
        response = c.post("/api/session", json={"email": who.email, "password": who.password})
        assert response.status_code == 200, response.text
    return c


def limits(base: str) -> dict[str, int]:
    return httpx.get(url(base, "/api/config"), timeout=HTTP_SECONDS).json()["limits"]


def read(c: httpx.Client, pid: str) -> dict[str, Any]:
    response = c.get(f"/api/patterns/{pid}")
    assert response.status_code == 200, response.text
    return response.json()


def by_row(data: dict[str, Any]) -> dict[int, dict[str, Any]]:
    return {r["row"]: r for r in data["rows"]}


def cell_of(data: dict[str, Any], row: int, col: int) -> dict[str, Any]:
    return next(c for c in data["cells"] if c["row"] == row and c["col"] == col)


def row_of(data: dict[str, Any], row: int) -> str:
    cells = sorted((c for c in data["cells"] if c["row"] == row), key=lambda c: c["col"])
    return " ".join(c["stitch"] for c in cells)


def plain_cells(data: dict[str, Any]) -> list[tuple]:
    return sorted((c["row"], c["col"], c["stitch"], c["colour"], c.get("repeat") or "") for c in data["cells"])


def put(c: httpx.Client, pid: str, row: int, col: int, stitch: str, colour: str = "A") -> dict[str, Any]:
    rev = cell_of(read(c, pid), row, col)["rev"]
    response = c.post(f"/api/patterns/{pid}/cells", json={
        "opId": idempotency_key(),
        "cells": [{"row": row, "col": col, "stitch": stitch, "colour": colour, "rev": rev}]})
    assert response.status_code == 200, response.text
    return response.json()


def hold(base: str, pid: str, email: str, on: bool) -> None:
    response = httpx.post(url(base, f"/api/grading/patterns/{pid}/hold-updates"),
                          json={"email": email, "hold": on},
                          headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_SECONDS)
    assert response.status_code == 200, response.text


def mails(mail: Any, to: str, subject: str | None = None, count: int = 1) -> list[dict[str, Any]]:
    def matching(settle: float) -> list[dict[str, Any]]:
        return [m for m in mail.messages(0, settle)
                if to.lower() in [a.lower() for a in addresses(m.get("To"))]
                and (subject is None or m.get("Subject") == subject)]

    poll(lambda: len(matching(0.2)) >= count, f"Mailpit received {count} mail to {to} ({subject})")
    final = matching(1.5)
    assert len(final) == count, f"expected exactly {count} mail to {to} ({subject}), saw {len(final)}"
    return final


def watch(page: Page) -> None:
    frames: list[int] = []
    SOCKET_FRAMES[id(page)] = frames
    page.on("websocket", lambda ws: ws.on("framereceived", lambda _: frames.append(1)))


def live(page: Page) -> None:
    poll(lambda: page.evaluate("1") and SOCKET_FRAMES[id(page)], "the live socket sent its first message")


def reload(page: Page) -> None:
    SOCKET_FRAMES[id(page)].clear()
    page.reload()


@contextmanager
def opened(browser: Any, base: str, who: Person | None, path: str, size: tuple[int, int] = DESKTOP,
           reduced: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, url(base, "/signin"), reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if who:
            response = page.request.post(url(base, "/api/session"),
                                         data={"email": who.email, "password": who.password})
            assert response.status == 200, response.text()
        watch(page)
        page.goto(url(base, path))
        yield page


def role(page: Any, kind: str, name: str) -> Locator:
    return page.get_by_role(kind, name=name, exact=True)


def status_of(page: Any, name: str) -> Locator:
    return role(page, "status", name)


def alert_of(page: Any, name: str) -> Locator:
    return role(page, "alert", name)


def button_of(page: Any, name: str) -> Locator:
    return role(page, "button", name)


def list_of(page: Any, name: str) -> Locator:
    return role(page, "list", name)


def grid(page: Page, name: str = "Stitch chart") -> Locator:
    return role(page, "grid", name)


def written(page: Page) -> Locator:
    return list_of(page, "Written instructions")


def cell(page: Page, row: int, col: int) -> Locator:
    return grid(page).get_by_role("gridcell", name=f"Row {row}, column {col}:")


def cursor_cell(page: Page) -> Locator:
    return grid(page).locator('[data-cursor="true"]')


def snapshot(page: Page, name: str = "Stitch chart") -> dict[str, Any]:
    return grid(page, name).evaluate(CHART_JS)


def row_cells(page: Page, row: int, name: str = "Stitch chart") -> list[dict[str, Any]]:
    return sorted((c for c in snapshot(page, name)["cells"] if c["row"] == row), key=lambda c: c["col"])


def stitches(page: Page, row: int) -> str:
    return " ".join(c["stitch"] for c in row_cells(page, row))


def colours(page: Page, row: int) -> str:
    return " ".join(c["colour"] for c in row_cells(page, row))


def see_row(page: Page, row: int, want: str) -> None:
    poll_eq(lambda: stitches(page, row), want, f"row {row} of the grid shows the expected stitches")


def see_colours(page: Page, row: int, want: str) -> None:
    poll_eq(lambda: colours(page, row), want, f"row {row} of the grid shows the expected colours")


def lines(page: Page) -> dict[str, str]:
    return written(page).evaluate(LINES_JS)


def see_line(page: Page, row: int, want: str | None) -> None:
    poll_eq(lambda: lines(page).get(str(row)), want, f"written line of row {row}")


def items(locator: Locator) -> list[str]:
    return [t.strip() for t in locator.get_by_role("listitem").all_text_contents()]


def see_items(page: Page, name: str, want: list[str]) -> None:
    poll_eq(lambda: items(list_of(page, name)), want, f'list "{name}" items')


def text_of(locator: Locator) -> str:
    return (locator.text_content() or "").strip() if locator.count() else ""


def see_cleared(locator: Locator, what: str) -> None:
    poll_eq(lambda: text_of(locator), "", what)


def at(page: Page) -> tuple[int, int]:
    found = [c for c in snapshot(page)["cells"] if c["cursor"] == "true"]
    assert len(found) == 1, f"expected exactly one cursor cell, saw {len(found)}"
    return found[0]["row"], found[0]["col"]


def key(page: Page, name: str) -> None:
    page.keyboard.press(name)


def go(page: Page, row: int, col: int) -> None:
    cursor_cell(page).focus()
    now_row, now_col = at(page)
    for _ in range(abs(row - now_row)):
        key(page, "ArrowUp" if row > now_row else "ArrowDown")
    for _ in range(abs(col - now_col)):
        key(page, "ArrowRight" if col > now_col else "ArrowLeft")
    poll_eq(lambda: at(page), (row, col), "the cursor reached its cell by the arrow keys")


def typed(page: Page, letters: str, step: int) -> None:
    width = int(snapshot(page)["colcount"])
    for letter in letters:
        row, col = at(page)
        key(page, letter)
        target = (row, min(width, max(1, col + step)))
        poll_eq(lambda: at(page), target, f"cursor after pressing {letter}")


def tokens(page: Page, row: int) -> Locator:
    return written(page).locator(f'[data-row="{row}"]').locator("[data-token]")


def lifted(page: Page) -> list[tuple[int, int]]:
    return sorted((c["row"], c["col"]) for c in snapshot(page)["cells"] if c["lift"] == "twin")


def see_lifted(page: Page, want: list[tuple[int, int]]) -> None:
    poll_eq(lambda: lifted(page), sorted(want), "the exact twin set carries data-lift")


def park_pointer(page: Page) -> None:
    page.mouse.move(1, 1)


def hover(page: Page, locator: Locator) -> None:
    page.mouse.move(*center(locator))


def mark(page: Page) -> None:
    page.evaluate("window.twinMark = 1")


def not_reloaded(page: Page) -> None:
    assert page.evaluate("window.twinMark") == 1, "the page reloaded; the update had to land in place"


def dom_counts(page: Page) -> dict[int, tuple]:
    return {int(n): (int(r["used"]), int(r["made"]), r["state"]) for n, r in snapshot(page)["rows"].items()}


def api_counts(data: dict[str, Any]) -> dict[int, tuple]:
    return {r["row"]: (r["used"], r["made"], r["state"]) for r in data["rows"]}


def edit_box(page: Page, row: int) -> Locator:
    return role(page, "textbox", f"Row {row} instructions")


def open_edit(page: Page, row: int) -> Locator:
    click(button_of(page, f"Edit row {row}"))
    box = edit_box(page, row)
    expect(box).to_be_focused()
    return box


def apply_text(page: Page, row: int, value: str) -> None:
    fill(open_edit(page, row), value)
    key(page, "Enter")


def caret(box: Locator) -> int:
    return box.evaluate("e => e.selectionStart")


def tab_to(page: Page, locator: Locator) -> None:
    for _ in range(TAB_LIMIT):
        key(page, "Tab")
        if locator.evaluate(FOCUSED_JS):
            return
    pytest.fail(f"Tab never reached {locator}")


def save_version_ui(page: Page, note: str) -> None:
    click(button_of(page, "Save version"))
    dialog = role(page, "dialog", "Save version")
    fill(role(dialog, "textbox", "Version note"), note)
    click(button_of(dialog, "Save"))


def tester_cells(page: Page, name: str) -> list[int] | None:
    row = role(page, "table", "Testers").get_by_role("row", name=re.compile(re.escape(name)))
    if not row.count():
        return None
    cells = row.first.evaluate("r => [...r.children].map(c => c.textContent.trim())")
    return [int(re.findall(r"\d+", value)[-1]) for value in cells[1:4]]


tester_cells.__test__ = False


def touch_on(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    return cdp


def gesture(cdp: Any, points: list[tuple[float, float]]) -> None:
    def at_point(point: tuple[float, float]) -> list[dict[str, float]]:
        return [{"x": point[0], "y": point[1]}]

    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": at_point(points[0])})
    for point in points[1:]:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": at_point(point)})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def swipe(cdp: Any, locator: Locator, dx: float, dy: float = 0) -> None:
    x, y = center(locator)
    start = (x - dx / 2, y - dy / 2)
    gesture(cdp, [start] + [(start[0] + dx * i / 4, start[1] + dy * i / 4) for i in range(1, 5)])


def box_of(locator: Locator) -> dict[str, float]:
    return locator.evaluate(
        "e => { const r = e.getBoundingClientRect();"
        " return {left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height}; }")


def layout_name(page: Page) -> str | None:
    return page.locator("[data-layout]").first.get_attribute("data-layout")


def resize(page: Page, width: int, height: int) -> None:
    page.set_viewport_size({"width": width, "height": height})


def test_blank_chart_tab_and_arrows(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=2)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        for _ in range(TAB_LIMIT):
            key(page, "Tab")
            if page.evaluate("document.activeElement.getAttribute('data-cursor')") == "true":
                break
        else:
            pytest.fail('Tab never reached the cursor cell of grid "Stitch chart"')
        expect(cursor_cell(page)).to_have_attribute("aria-label", "Row 1, column 1: No stitch, colour A")
        chart = snapshot(page)
        assert chart["colcount"] == "10"
        assert chart["order"] == ["2", "1"], "highest row number comes first, so row 1 is at the bottom"
        assert [c for c in chart["cells"] if c["tabindex"] == "0"] == [c for c in chart["cells"] if c["cursor"] == "true"]
        assert [t.strip() for t in grid(page).get_by_role("rowheader").all_text_contents()] == ["Row 2", "Row 1"]
        key(page, "ArrowLeft")
        key(page, "ArrowDown")
        assert at(page) == (1, 1), "the cursor stops at the left and bottom edges"
        key(page, "ArrowUp")
        poll_eq(lambda: at(page), (2, 1), "ArrowUp goes to a higher row number")
        key(page, "ArrowUp")
        assert at(page) == (2, 1), "the cursor stops at the top edge"
        key(page, "ArrowRight")
        poll_eq(lambda: at(page), (2, 2), "ArrowRight moves one cell")
        for _ in range(12):
            key(page, "ArrowRight")
        poll_eq(lambda: at(page), (2, 10), "the cursor stops at the right edge")


def test_letter_keys_follow_reading_direction(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=2)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        go(page, 1, 10)
        typed(page, "kpotsdlrx", -1)
        see_row(page, 1, "ns ns m1r m1l cdd ssk k2tog yo p k")
        key(page, "k")
        see_row(page, 1, "k ns m1r m1l cdd ssk k2tog yo p k")
        assert at(page) == (1, 1), "at the row's end the cursor stays put"
        go(page, 2, 1)
        typed(page, "p", 1)
        see_row(page, 2, W("p", ("ns", 9)))
        before = stitches(page, 2)
        key(page, "h")
        assert at(page) == (2, 2) and stitches(page, 2) == before, "a key outside the craft does nothing"
        key(page, "Shift+ArrowRight")
        key(page, "Shift+ArrowRight")
        poll_eq(lambda: at(page), (2, 4), "the cursor moves with the selection's far corner")
        key(page, "k")
        see_row(page, 2, W("p", ("k", 3), ("ns", 6)))
        assert at(page) == (2, 4), "with a selection the cursor stays"
    assert row_of(read(client(app_url, asha), pid), 2) == W("p", ("k", 3), ("ns", 6))


def test_cell_announcements(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=3)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        spoken = status_of(page, "Cell announcement")
        go(page, 3, 5)
        label = cursor_cell(page).get_attribute("aria-label")
        expect(spoken).to_have_text(f"{label}.")
        key(page, "p")
        expect(spoken).to_have_text("Placed Purl at row 3, column 5.")
        poll_eq(lambda: cell(page, 3, 5).get_attribute("data-stitch"), "p", "the purl was placed")
        expect(spoken).to_have_text("Placed Purl at row 3, column 5.")
        go(page, 3, 5)
        placed = cursor_cell(page).get_attribute("aria-label")
        assert "Purl" in placed
        expect(spoken).to_have_text(f"{placed}.")
        key(page, "Delete")
        expect(spoken).to_contain_text("No stitch")
        poll_eq(lambda: cell(page, 3, 5).get_attribute("data-stitch"), "ns", "Delete made the cell no stitch")
        assert at(page) == (3, 5), "Delete does not move the cursor"


def test_wf_rib_swatch_happy(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=2)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        go(page, 1, 10)
        page.evaluate("""() => {
          window.twinPairs = [];
          const read = () => {
            const c = document.querySelector('[data-row="1"][data-col="10"]');
            const l = document.querySelector('[data-line]');
            window.twinPairs.push([c && c.getAttribute('data-stitch'), l ? l.textContent.trim() : null]);
          };
          new MutationObserver(read).observe(document.body,
            {subtree: true, attributes: true, childList: true, characterData: true});
        }""")
        mark(page)
        typed(page, "k", -1)
        see_line(page, 1, "Row 1 (RS): k1. (1 st)")
        for stitch, line in page.evaluate("window.twinPairs"):
            assert (stitch == "k") == (line is not None), "the cell and its line must change in the same render"
        typed(page, "kppkkppkk", -1)
        go(page, 2, 1)
        typed(page, "kkppkkppkk", 1)
        see_row(page, 1, RIB)
        see_row(page, 2, RIB)
        see_line(page, 1, "Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)")
        see_line(page, 2, "Row 2 (WS): *p2, k2; rep from * to last 2 sts, p2. (10 sts)")
        see_items(page, "Row errors", ["All rows check out."])
        not_reloaded(page)
        shown = lines(page)
        reload(page)
        see_row(page, 1, RIB)
        see_row(page, 2, RIB)
        poll_eq(lambda: lines(page), shown, "cells and lines survive a reload")
    data = read(client(app_url, asha), pid)
    assert by_row(data)[2]["text"] == "Row 2 (WS): *p2, k2; rep from * to last 2 sts, p2. (10 sts)"


def test_wf_rib_swatch_save_failed(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=2)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        go(page, 1, 10)
        page.route("**/api/patterns/*/cells", lambda route: route.abort())
        key(page, "k")
        expect(status_of(page, "Chart sync")).to_have_text("That change was not saved. Try again.")
        see_row(page, 1, "ns ns ns ns ns ns ns ns ns ns")
        page.unroute("**/api/patterns/*/cells")
        go(page, 1, 10)
        key(page, "k")
        see_row(page, 1, W(("ns", 9), "k"))
    assert row_of(read(client(app_url, asha), pid), 1) == W(("ns", 9), "k")


def test_wf_rib_swatch_crochet(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, craft="crochet", terms="us", width=4, height=3, castOn=4)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        go(page, 1, 4)
        key(page, "k")
        key(page, "c")
        assert at(page) == (1, 4) and stitches(page, 1) == "ns ns ns ns", "keys outside the craft do nothing"
        typed(page, "ssss", -1)
        go(page, 2, 1)
        typed(page, "hdss", 1)
        go(page, 3, 4)
        typed(page, "ies", -1)
        see_row(page, 2, "hdc dc sc sc")
        see_row(page, 3, "ns sc dec inc")
        see_line(page, 1, "Row 1 (RS): sc4. (4 sts)")
        see_line(page, 2, "Row 2 (WS): hdc1, dc1, sc2. (4 sts)")
        see_line(page, 3, "Row 3 (RS): inc, dec, sc1. (4 sts)")
        see_items(page, "Row errors", ["All rows check out."])
    assert by_row(read(client(app_url, asha), pid))[3]["made"] == 4


def test_wf_rib_swatch_own_edit_still(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=1, castOn=4)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 1, 4)
        key(page, "k")
        see_row(page, 1, "ns ns ns k")
        poll_eq(lambda: at(page), (1, 3), "the cursor moved one cell in reading direction")
        assert not page.evaluate(ANY_MOTION_JS), "an own edit carries no data-motion"
        assert animations(grid(page)) == [], "an own edit animates nothing"
        key(page, "p")
        see_row(page, 1, "ns ns p k")
        assert not page.evaluate(ANY_MOTION_JS), "an own edit carries no data-motion"
        assert animations(grid(page)) == [], "an own edit animates nothing"


def test_row_rule_and_error_list(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=6, height=5, castOn=6, rows={
        "1": "k k k k k ns", "3": "k k k k k ns", "4": "k k k k ns ns", "5": "k k k k ns ns"})
    data = read(client(app_url, asha), pid)
    rows = by_row(data)
    assert rows[1]["errors"] == ["Row 1 needs 6 stitches, found 5."]
    assert rows[2]["state"] == "empty" and rows[2]["errors"] == [] and rows[2]["text"] == ""
    assert rows[3]["errors"] == [] and rows[3]["state"] == "ok"
    assert rows[4]["errors"] == ["Row 4 needs 5 stitches, found 4."]
    assert rows[5]["state"] == "ok"
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        messages = ["Row 1 needs 6 stitches, found 5.", "Row 4 needs 5 stitches, found 4."]
        see_items(page, "Row errors", messages)
        entry = by_data_row(list_of(page, "Row errors"), 4)
        click(button_of(entry, messages[1]))
        poll_eq(lambda: at(page)[0], 4, "the error's button moves the cursor to that row")
    single = seed(app_url, asha, width=2, height=1, castOn=1, rows={"1": "k k"})
    assert by_row(read(client(app_url, asha), single))[1]["errors"] == ["Row 1 needs 1 stitches, found 2."]
    worked = seed(app_url, asha, width=24, height=2, castOn=24,
                  rows={"1": K24, "2": K24.rsplit(" ", 1)[0] + " ns"})
    assert by_row(read(client(app_url, asha), worked))[2]["errors"] == ["Row 2 needs 24 stitches, found 23."]


def test_row_counts_reach_other_designer(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=4, height=3, castOn=4, rows={"1": K4, "2": K4, "3": K4},
               coDesigners=[lena.email])
    c = client(app_url, lena)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        live(page)
        mark(page)
        poll_eq(lambda: dom_counts(page), api_counts(read(c, pid)), "chart rows carry the server's counts")
        assert snapshot(page)["rows"]["1"]["count"] == "4"
        put(c, pid, 2, 1, "ns")
        want = api_counts(read(c, pid))
        assert want[2] == (3, 3, "error")
        poll_eq(lambda: dom_counts(page), want, "the peer's edit reached the row counts")
        assert snapshot(page)["rows"]["2"]["count"] == "3"
        not_reloaded(page)


def test_row_check_announcements(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=4, height=3, castOn=4, coDesigners=[lena.email],
               rows={"1": K4, "2": "k k k ns", "3": "k k k ns"})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        live(page)
        live(peer)
        go(page, 2, 4)
        key(page, "k")
        both = "Row 3 needs 4 stitches, found 3. Row 2 is correct."
        expect(status_of(page, "Row check")).to_have_text(both)
        expect(status_of(peer, "Row check")).to_have_text(both)
        see_items(page, "Row errors", ["Row 3 needs 4 stitches, found 3."])
        go(page, 1, 1)
        key(page, "p")
        see_row(page, 1, "p k k k")
        expect(status_of(page, "Row check")).to_have_text(both)
        go(page, 3, 4)
        key(page, "k")
        expect(status_of(page, "Row check")).to_have_text("Row 3 is correct.")
        expect(status_of(peer, "Row check")).to_have_text("Row 3 is correct.")


def test_wf_row_count_two_screens(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    rows = {"1": K4, "2": K4, "3": K4}
    pid = seed(app_url, asha, lena, width=4, height=3, castOn=4, rows=rows, coDesigners=[lena.email],
               versions=[snap(rows, 4, 3, 4)])
    c = client(app_url, asha)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        live(page)
        live(peer)
        go(page, 2, 1)
        key(page, "Delete")
        errors = ["Row 2 needs 4 stitches, found 3.", "Row 3 needs 3 stitches, found 4."]
        see_items(page, "Row errors", errors)
        see_items(peer, "Row errors", errors)
        expect(status_of(peer, "Row check")).to_have_text(" ".join(errors))
        want = api_counts(read(c, pid))
        poll_eq(lambda: dom_counts(peer), want, "the peer's rows equal the server's derived counts")
        go(page, 2, 1)
        key(page, "k")
        cleared = "Row 2 is correct. Row 3 is correct."
        expect(status_of(page, "Row check")).to_have_text(cleared)
        expect(status_of(peer, "Row check")).to_have_text(cleared)
        see_items(peer, "Row errors", ["All rows check out."])
        click(button_of(page, "Publish"))
        expect(status_of(page, "Chart sync")).to_have_text("Published version 1.")
    assert httpx.get(url(app_url, f"/api/public/{pid}"), timeout=HTTP_SECONDS).json()["version"] == 1


def test_wf_row_count_publish_refused(browser, app_url):
    asha = person("Asha Verma")
    rows = {"1": K8, "2": "k k k k k k k ns", "3": K8}
    colour_rows = {"1": "A B B B B B B A"}
    pid = seed(app_url, asha, width=8, height=3, castOn=8, rows=rows, colourRows=colour_rows,
               colours=[MAIN, CONTRAST], versions=[snap(rows, 8, 3, 8, colourRows=colour_rows)])
    c = client(app_url, asha)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        see_items(page, "Colour warnings", ["Row 1: float of 6 stitches in colour A."])
        click(button_of(page, "Publish"))
        expect(alert_of(page, "Publish error")).to_have_text("Fix 2 row errors before publishing.")
        anonymous = httpx.get(url(app_url, f"/api/public/{pid}"), timeout=HTTP_SECONDS)
        assert anonymous.status_code == 404
        go(page, 2, 8)
        key(page, "k")
        see_items(page, "Row errors", ["All rows check out."])
        refused = c.post(f"/api/patterns/{pid}/publish", json={})
        assert refused.status_code == 409
        assert refused.json() == {"error": "row_errors", "message": "Fix 2 row errors before publishing."}
        save_version_ui(page, "balanced")
        expect(status_of(page, "Chart sync")).to_have_text("Version 2 saved.")
        click(button_of(page, "Publish"))
        expect(status_of(page, "Chart sync")).to_have_text("Published version 2.")
    public = httpx.get(url(app_url, f"/api/public/{pid}"), timeout=HTTP_SECONDS)
    assert public.status_code == 200 and public.json()["version"] == 2


def test_wf_row_count_no_version(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=1, castOn=4, rows={"1": "k k k ns"})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        click(button_of(page, "Publish"))
        expect(alert_of(page, "Publish error")).to_have_text("Save a version before publishing.")
    c = client(app_url, asha)
    refused = c.post(f"/api/patterns/{pid}/publish", json={})
    assert refused.status_code == 409 and refused.json()["error"] == "no_version"
    assert read(c, pid)["state"] == "draft"


def test_wf_row_count_times_announce(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=6, height=2, castOn=6, rows={"1": "k p p k ns ns", "2": "k k k k k k"},
               coDesigners=[lena.email],
               repeats=[{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 1, "toRow": 1, "times": 2}])
    broken = [needs(1, 6, 8), needs(2, 8, 6)]
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        live(page)
        live(peer)
        times = role(page, "spinbutton", "Times for A")
        fill(times, "3")
        key(page, "Tab")
        see_items(page, "Row errors", broken)
        expect(status_of(page, "Row check")).to_have_text(" ".join(broken))
        expect(status_of(peer, "Row check")).to_have_text(" ".join(broken))
        fill(times, "2")
        key(page, "Tab")
        cleared = f"Row {1} is correct. Row {2} is correct."
        expect(status_of(page, "Row check")).to_have_text(cleared)
        expect(status_of(peer, "Row check")).to_have_text(cleared)


def test_shaping_lines_and_sample(browser, app_url):
    asha, fresh = person("Asha Verma"), person("Sam Ortiz")
    pid = seed(app_url, asha, fresh, width=12, height=7, castOn=12, rows=SHAPING_ROWS)
    data = read(client(app_url, asha), pid)
    assert {str(r["row"]): r["text"] for r in data["rows"]} == SHAPING_LINES
    assert all(r["errors"] == [] for r in data["rows"])
    with opened(browser, app_url, fresh, "/") as page:
        expect(role(page, "heading", "Your patterns")).to_be_visible()
        expect(page.get_by_text("No patterns yet. Start one from the sample or a blank chart.", exact=True)).to_be_visible()
        click(button_of(page, "Use the sample"))
        c = client(app_url, fresh)
        sample = poll(lambda: c.get("/api/patterns").json()["patterns"], "Use the sample made a pattern")[0]
        assert sample["name"] == "Sample swatch" and sample["role"] == "owner"
        page.goto(url(app_url, f"/patterns/{sample['id']}"))
        poll_eq(lambda: lines(page), SHAPING_LINES, "the sample reads as the seven printed lines")
        assert read(c, sample["id"])["castOn"] == 12


def test_wf_shaping_edit_counts(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=12, height=7, castOn=12, rows=SHAPING_ROWS)
    c = client(app_url, asha)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 3, 3)
        key(page, "Delete")
        see_line(page, 3, f"Row {3} (RS): k{1}, ssk, k{7}. ({9} sts)")
        poll_eq(lambda: snapshot(page)["rows"]["3"]["made"], "9", "row 3's made count changed at once")
        see_items(page, "Row errors", [needs(3, 12, 10), needs(4, 9, 10)])
        poll_eq(lambda: dom_counts(page), api_counts(read(c, pid)), "grid counts equal the server's")
        made = by_row(read(c, pid))[3]["made"]
        assert f"({made} sts)" in lines(page)["3"], "the closing count and the row count are one value"
        key(page, "Control+z")
        poll_eq(lambda: lines(page), SHAPING_LINES, "undo restored the earlier lines")
        see_items(page, "Row errors", ["All rows check out."])
    assert {str(r["row"]): r["text"] for r in read(c, pid)["rows"]} == SHAPING_LINES


def test_wf_shaping_break_and_retype(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=12, height=7, castOn=12, rows=SHAPING_ROWS)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 5, 5)
        key(page, "Delete")
        see_items(page, "Row errors", ["Row 5 needs 8 stitches, found 7.", "Row 6 needs 7 stitches, found 8."])
        apply_text(page, 5, "k8.")
        expect(status_of(page, "Chart sync")).to_have_text(f"Row {5} updated: {1} cell changed.")
        see_items(page, "Row errors", ["All rows check out."])
        see_line(page, 5, "Row 5 (RS): k8. (8 sts)")
    assert row_of(read(client(app_url, asha), pid), 5) == SHAPING_ROWS["5"]


def test_cable_cells_and_errors(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=6, height=1, castOn=6, rows={"1": "k k k k k k"})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 1, 5)
        key(page, "c")
        see_row(page, 1, "k c22 c22 c22 c22 k")
        see_line(page, 1, "Row 1 (RS): k1, 2/2 LC, k1. (6 sts)")
        poll_eq(lambda: at(page), (1, 1), "the cursor moved past the four cable cells")
        go(page, 1, 2)
        key(page, "x")
    edge = seed(app_url, asha, width=6, height=1, castOn=6, rows={"1": K4 + " k k"})
    with opened(browser, app_url, asha, f"/patterns/{edge}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 1, 2)
        key(page, "c")
        see_row(page, 1, "c22 c22 k k k k")
        assert at(page) == (1, 2) or at(page) == (1, 1)
        see_items(page, "Row errors", ["Row 1: a 2/2 cable needs 4 cells."])
    wrong = seed(app_url, asha, width=6, height=2, castOn=6,
                 rows={"1": "k k k k k k", "2": "c22 c22 c22 ns ns ns"})
    row = by_row(read(client(app_url, asha), wrong))[2]
    assert row["errors"] == ["Row 2 needs 6 stitches, found 3.", "Row 2: a 2/2 cable needs 4 cells.",
                             "Row 2: 2/2 LC can only be worked on a right-side row."]
    assert "2/2 LC" in row["text"] and row["used"] == 3 and row["made"] == 3


def test_crochet_terms(browser, app_url):
    asha = person("Asha Verma")
    printed = {
        "us": ["Row 1 (RS): sc6. (6 sts)", "Row 2 (WS): *sc1, inc, sc1; rep from * to end. (8 sts)",
               "Row 3 (RS): dc8. (8 sts)", "Row 4 (WS): dec, dc3, dec, dc1. (6 sts)"],
        "uk": ["Row 1 (RS): dc6. (6 sts)", "Row 2 (WS): *dc1, inc, dc1; rep from * to end. (8 sts)",
               "Row 3 (RS): tr8. (8 sts)", "Row 4 (WS): dec, tr3, dec, tr1. (6 sts)"],
    }
    c = client(app_url)
    for terms, want in printed.items():
        pid = seed(app_url, asha, craft="crochet", terms=terms, width=8, height=4, castOn=6, rows=CROCHET_ROWS)
        c = client(app_url, asha)
        data = read(c, pid)
        assert [r["text"] for r in data["rows"]] == want
        assert all(r["errors"] == [] for r in data["rows"])
        with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
            poll_eq(lambda: list(lines(page).values()), want, f"{terms} lines on the page")
            assert stitches(page, 1) == CROCHET_ROWS["1"], "symbol keys never change with terms"


REPEAT_CASES = {
    "rib_rs": {"mode": "flat", "row": 1, "cells": "k k p p k k p p k k", "height": 1,
               "line": "Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)"},
    "rib_ws": {"mode": "flat", "row": 2, "cells": "k k p p k k p p k k", "height": 2,
               "line": "Row 2 (WS): *p2, k2; rep from * to last 2 sts, p2. (10 sts)"},
    "round_one": {"mode": "round", "row": 1, "height": 2,
                  "cells": "k k p p k k p p k k p p k k p p k k p p k k p p",
                  "line": "Rnd 1: *p2, k2; rep from * to end. (24 sts)"},
    "round_two": {"mode": "round", "row": 2, "height": 2,
                  "cells": "k k p p k k p p k k p p k k p p k k p p k k p p",
                  "line": "Rnd 2: *p2, k2; rep from * to end. (24 sts)"},
    "lace": {"mode": "flat", "row": 3, "height": 3, "cells": "k yo k2tog yo k2tog yo k2tog yo k2tog k",
             "line": "Row 3 (RS): k1, *k2tog, yo; rep from * to last st, k1. (10 sts)"},
    "first_read": {"mode": "flat", "row": 1, "height": 1, "cells": "k k k k p k p k",
                   "line": "Row 1 (RS): *k1, p1; rep from * to last 4 sts, k4. (8 sts)"},
    "lead_in": {"mode": "flat", "row": 1, "height": 1, "cells": "k p k p k p p k",
                "line": "Row 1 (RS): k1, p1, *p1, k1; rep from * to end. (8 sts)"},
    "zero_tail": {"mode": "flat", "row": 1, "height": 1, "cells": "yo k p k p",
                  "line": "Row 1 (RS): *p1, k1; rep from * to end, yo. (5 sts)"},
    "cables": {"mode": "flat", "row": 1, "height": 1, "cells": "p c22 c22 c22 c22 p p c22 c22 c22 c22 p",
               "line": "Row 1 (RS): *p1, 2/2 LC, p1; rep from * to end. (12 sts)"},
}


@pytest.mark.parametrize("case", list(REPEAT_CASES.values()), ids=list(REPEAT_CASES))
def test_repeat_detection(browser, app_url, case):
    asha = person("Asha Verma")
    cells = case["cells"].split()
    rows = {str(n): case["cells"] for n in range(1, case["height"] + 1)} if case["row"] != 3 \
        else {"3": case["cells"]}
    pid = seed(app_url, asha, mode=case["mode"], width=len(cells), height=case["height"], castOn=len(cells), rows=rows)
    assert by_row(read(client(app_url, asha), pid))[case["row"]]["text"] == case["line"]
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        see_line(page, case["row"], case["line"])


def test_wf_repeats_box_keyboard(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=1, castOn=8, rows={"1": "k p p k"})
    c = client(app_url, asha)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        see_items(page, "Repeats", ["No repeats yet."])
        go(page, 1, 2)
        key(page, "Shift+ArrowRight")
        key(page, "b")
        times = role(page, "spinbutton", "Times for A")
        expect(times).to_have_value("2")
        expect(list_of(page, "Repeats")).to_contain_text("Repeat A")
        see_line(page, 1, "Row 1 (RS): k1, p4, k1. (6 sts)")
        poll_eq(lambda: [x["repeat"] for x in row_cells(page, 1)], ["", "A", "A", ""], "cells carry data-repeat")
        expect(cell(page, 1, 2)).to_have_attribute("aria-label", "Row 1, column 2: Purl, colour A, repeat A")
        fill(times, "3")
        key(page, "Tab")
        see_line(page, 1, "Row 1 (RS): k1, p6, k1. (8 sts)")
        poll_eq(lambda: dom_counts(page), api_counts(read(c, pid)), "box counts equal the server's")
        assert dom_counts(page)[1] == (8, 8, "ok")
        fill(times, "21")
        key(page, "Tab")
        expect(status_of(page, "Chart sync")).to_have_text("Times must be from 2 to 20.")
        go(page, 1, 3)
        key(page, "b")
        expect(status_of(page, "Chart sync")).to_have_text("Repeat boxes cannot overlap.")
    overlap = c.post(f"/api/patterns/{pid}/repeats", json={"fromCol": 3, "toCol": 4, "fromRow": 1, "toRow": 1})
    assert overlap.status_code == 409 and overlap.json()["error"] == "overlap"
    invalid = c.patch(f"/api/patterns/{pid}/repeats/A", json={"times": 1})
    assert invalid.status_code == 422 and invalid.json()["field"] == "times"
    data = read(c, pid)
    assert [(r["id"], r["times"]) for r in data["repeats"]] == [("A", 3)]


def test_wf_repeats_expand(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=2, castOn=8, rows={"1": "k p p k", "2": "k k k p"},
               repeats=[{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 1, "toRow": 1, "times": 3}])
    c = client(app_url, asha)
    before = read(c, pid)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        see_line(page, 1, "Row 1 (RS): k1, p6, k1. (8 sts)")
        shown = lines(page)
        click(button_of(page, "Expand repeat A"))
        expect(status_of(page, "Chart sync")).to_have_text("Repeat A expanded: 4 columns added.")
        poll_eq(lambda: snapshot(page)["colcount"], "8", "the chart grew to width 8")
        see_row(page, 1, "k p p p p p p k")
        see_row(page, 2, "k k k ns ns ns ns p")
        assert lines(page) == shown, "expanding never changes a line"
        see_items(page, "Repeats", ["No repeats yet."])
        after = read(c, pid)
        assert api_counts(after) == api_counts(before) and after["width"] == 8
        cursor_cell(page).focus()
        key(page, "Control+z")
        poll_eq(lambda: snapshot(page)["colcount"], "4", "undo returned the width")
        see_row(page, 1, "k p p k")
        expect(role(page, "spinbutton", "Times for A")).to_have_value("3")
    assert plain_cells(read(c, pid)) == plain_cells(before)


def test_wf_repeats_too_wide(browser, app_url):
    asha = person("Asha Verma")
    limit = limits(app_url)["maxChartCols"]
    width = limit - 2
    row = " ".join(["k"] * width)
    pid = seed(app_url, asha, width=width, height=1, castOn=width + 4, rows={"1": row},
               repeats=[{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 1, "toRow": 1, "times": 3}])
    c = client(app_url, asha)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        click(button_of(page, "Expand repeat A"))
        expect(status_of(page, "Chart sync")).to_have_text(f"That is wider than the {limit} column limit.")
        assert snapshot(page)["colcount"] == str(width)
    refused = c.post(f"/api/patterns/{pid}/repeats/A/expand", json={})
    assert refused.status_code == 409 and refused.json()["error"] == "too_wide"
    data = read(c, pid)
    assert data["width"] == width and len(data["repeats"]) == 1


def test_twin_lift_through_repeats(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=4, castOn=10, rows={
        "1": RIB, "2": RIB, "3": "c22 c22 c22 c22 k k k k k k", "4": "k p p k ns ns ns ns ns ns"},
        repeats=[{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 4, "toRow": 4, "times": 3}])
    table = {
        (1, 0): ("k2", [10, 9, 6, 5]), (1, 1): ("p2", [8, 7, 4, 3]), (1, 2): ("k2", [2, 1]),
        (2, 0): ("p2", [1, 2, 5, 6]), (2, 1): ("k2", [3, 4, 7, 8]), (2, 2): ("p2", [9, 10]),
        (3, 0): ("k6", [10, 9, 8, 7, 6, 5]), (3, 1): ("2/2 LC", [4, 3, 2, 1]),
        (4, 1): ("k6", [3, 2]),
    }
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(tokens(page, 1).first).to_be_visible()
        for (row, index), (printed, cols) in table.items():
            token = tokens(page, row).nth(index)
            expect(token).to_have_text(printed)
            hover(page, token)
            see_lifted(page, [(row, col) for col in cols])
            expect(token).to_have_attribute("data-lift", "twin")
            park_pointer(page)
            see_lifted(page, [])
        tokens(page, 1).first.focus()
        see_lifted(page, [(1, 10), (1, 9), (1, 6), (1, 5)])
        key(page, "ArrowRight")
        see_lifted(page, [(1, 8), (1, 7), (1, 4), (1, 3)])


def test_wf_repeats_cursor_survives_undo(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=1, castOn=8, rows={"1": "k p p k"},
               repeats=[{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 1, "toRow": 1, "times": 3}])
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        click(button_of(page, "Expand repeat A"))
        poll_eq(lambda: snapshot(page)["colcount"], "8", "the chart grew to width 8")
        go(page, 1, 8)
        key(page, "Control+z")
        poll_eq(lambda: snapshot(page)["colcount"], "4", "undo returned the width")
        expect(grid(page).locator('[data-cursor="true"][tabindex="0"]')).to_have_count(1)
        go(page, 1, 1)
        key(page, "p")
        see_row(page, 1, "p p p k")


def test_wf_text_edit_apply(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=1, castOn=10, rows={"1": RIB})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        box = open_edit(page, 1)
        expect(box).to_have_value("Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)")
        fill(box, "k4, p6.")
        key(page, "Enter")
        expect(status_of(page, "Chart sync")).to_have_text("Row 1 updated: 6 cells changed.")
        see_row(page, 1, "p p p p p p k k k k")
        see_line(page, 1, "Row 1 (RS): k4, p6. (10 sts)")
        expect(button_of(page, "Edit row 1")).to_be_focused()
        apply_text(page, 1, "k1, k1, k1, k1, p6.")
        expect(status_of(page, "Chart sync")).to_have_text("Row 1 updated: 0 cells changed.")
        see_line(page, 1, "Row 1 (RS): k4, p6. (10 sts)")
    assert row_of(read(client(app_url, asha), pid), 1) == "p p p p p p k k k k"
    short = seed(app_url, asha, width=4, height=1, castOn=4, rows={"1": K4})
    answer = client(app_url, asha).post(f"/api/patterns/{short}/text", json={"row": 1, "text": "k1, k1, p2."})
    assert answer.status_code == 200
    assert by_row(answer.json())[1]["text"] == "Row 1 (RS): k2, p2. (4 sts)"


def test_wf_text_edit_invalid_recovery(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=1, castOn=10, rows={"1": RIB})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        box = open_edit(page, 1)
        word = "q5"
        fill(box, f"k5, {word}.")
        click(button_of(page, "Apply text"))
        expect(alert_of(page, "Text error")).to_have_text(f'Row {1}, position {5}: unknown stitch "{word}".')
        see_row(page, 1, RIB)
        fill(box, "k5, p5.")
        click(button_of(page, "Apply text"))
        expect(status_of(page, "Chart sync")).to_have_text(f"Row {1} updated: {5} cells changed.")
        see_row(page, 1, W(("p", 5), ("k", 5)))
        box = open_edit(page, 1)
        fill(box, "k10.")
        key(page, "Escape")
        expect(button_of(page, "Edit row 1")).to_be_focused()
        see_row(page, 1, W(("p", 5), ("k", 5)))
    assert row_of(read(client(app_url, asha), pid), 1) == W(("p", 5), ("k", 5))


TEXT_ERRORS = {
    "label": {"chart": "knit", "row": 3, "text": "Row 4 (WS): k4.", "position": 1,
              "message": "Row 3, position 1: the label says Row 4."},
    "unknown": {"chart": "knit", "row": 3, "text": "yo, k2tog, k2t.", "position": 12,
                "message": 'Row 3, position 12: unknown stitch "k2t".'},
    "no_count": {"chart": "knit", "row": 3, "text": "k.", "position": 1,
                 "message": 'Row 3, position 1: unknown stitch "k".'},
    "separator": {"chart": "knit", "row": 3, "text": "k1, p1, k10 p1.", "position": 12,
                  "message": "Row 3, position 12: expected a comma or a full stop."},
    "ends_early": {"chart": "knit", "row": 3, "text": "k1", "position": 3,
                   "message": "Row 3, position 3: expected a comma or a full stop."},
    "wrong_side": {"chart": "knit", "row": 4, "text": "p1, k2tog, p1.", "position": 5,
                   "message": "Row 4, position 5: k2tog is not valid on a wrong-side row."},
    "right_side": {"chart": "knit", "row": 3, "text": "k1, p2tog.", "position": 5,
                   "message": "Row 3, position 5: p2tog is not valid on a right-side row."},
    "terms_uk": {"chart": "uk", "row": 2, "text": "hdc4.", "position": 1,
                 "message": "Row 2, position 1: hdc is not valid in UK terms."},
    "terms_us": {"chart": "us", "row": 2, "text": "tr4.", "position": 1,
                 "message": "Row 2, position 1: tr is not valid in US terms."},
    "colour": {"chart": "knit", "row": 1, "text": "k2 in C.", "position": 7,
               "message": "Row 1, position 7: colour C is not in the key."},
    "repeat_fit": {"chart": "knit", "row": 3, "text": "k1, *k5; rep from * to end.", "position": 5,
                   "message": "Row 3, position 5: the repeat does not fit 24 stitches."},
    "cell_count": {"chart": "knit", "row": 3, "text": "k26.", "position": 1,
                   "message": "Row 3, position 1: the text needs 26 cells, the chart is 24 wide."},
    "closing": {"chart": "knit", "row": 3, "text": "Row 3 (RS): ssk, k2tog, k20. (24 sts)", "position": 30,
                "message": "Row 3, position 30: the closing count says 24 sts, the row makes 22."},
    "repeat_box": {"chart": "boxed", "row": 3, "text": "k24.", "position": None,
                   "message": "Row 3: expand repeat A before editing this row as text."},
}


def text_chart(base: str, owner: Person, chart: str) -> str:
    if chart in ("uk", "us"):
        row = "sc sc sc sc sc sc"
        return seed(base, owner, craft="crochet", terms=chart, width=6, height=2, castOn=6,
                    rows={"1": row, "2": row})
    repeats = [{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 3, "toRow": 3, "times": 2}] if chart == "boxed" else []
    return seed(base, owner, width=24, height=4, castOn=24, colours=[MAIN, CONTRAST], repeats=repeats,
                rows={"1": K24, "2": K24, "3": K24, "4": K24})


@pytest.mark.parametrize("case", list(TEXT_ERRORS.values()), ids=list(TEXT_ERRORS))
def test_text_errors_name_row_and_position(browser, app_url, case):
    asha = person("Asha Verma")
    pid = text_chart(app_url, asha, case["chart"])
    c = client(app_url, asha)
    before = read(c, pid)
    refused = c.post(f"/api/patterns/{pid}/text", json={"row": case["row"], "text": case["text"]})
    assert refused.status_code == 422
    body = refused.json()
    assert (body["error"], body["field"], body["message"], body["position"]) == (
        "invalid", "text", case["message"], case["position"])
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        box = open_edit(page, case["row"])
        if case["position"] is None:
            expect(alert_of(page, "Text error")).to_have_text(case["message"])
        fill(box, case["text"])
        key(page, "Enter")
        expect(alert_of(page, "Text error")).to_have_text(case["message"])
        expect(box).to_have_value(case["text"])
        expect(box).to_be_focused()
        if case["position"] is not None:
            expect(box).to_have_attribute("aria-invalid", "true")
            assert caret(box) == case["position"] - 1
    assert read(c, pid)["cells"] == before["cells"], "a refused text changes nothing"


def test_repeat_text_fills_the_row(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=12, height=2, castOn=10,
               rows={"1": "k k k k k k k k k k ns ns", "2": "k k k k k k k k k k ns ns"})
    c = client(app_url, asha)

    def applied(row: int, typed_text: str) -> dict[int, dict[str, Any]]:
        answer = c.post(f"/api/patterns/{pid}/text", json={"row": row, "text": typed_text})
        assert answer.status_code == 200, answer.text
        return by_row(answer.json())

    fills = "*k1, p1; rep from * to end."
    assert applied(1, fills)[1]["text"] == f"Row 1 (RS): {fills} (10 sts)"
    nine = W("p", ("k", 9), ("ns", 2))
    for typed_tail in ("*k3; rep from * to last st, p1.", "*k3; rep from * to last 1 st, p1."):
        done = applied(1, typed_tail)[1]
        assert done["text"].endswith(" (10 sts)") and row_of(read(c, pid), 1) == nine
    assert applied(2, "*p2, k2; rep from * to last 2 sts, p2.")[2]["text"] == \
        "Row 2 (WS): *p2, k2; rep from * to last 2 sts, p2. (10 sts)"
    assert row_of(read(c, pid), 2) == W(RIB, ("ns", 2))
    for typed_text in ("*k3; rep from * to end.", "*k2; rep from * to last 3 sts, k2.", "*yo; rep from * to end."):
        before = read(c, pid)["cells"]
        refused = c.post(f"/api/patterns/{pid}/text", json={"row": 1, "text": typed_text})
        assert refused.status_code == 422
        assert refused.json()["message"] == "Row 1, position 1: the repeat does not fit 10 stitches."
        assert refused.json()["position"] == 1
        assert read(c, pid)["cells"] == before
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        apply_text(page, 1, "*k2, p2; rep from * to last 2 sts, k2.")
        see_line(page, 1, "Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)")
    assert row_of(read(c, pid), 1) == W(RIB, ("ns", 2))


def test_wf_text_edit_push_while_typing(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=10, height=3, castOn=10, coDesigners=[lena.email],
               rows={"1": K10, "2": K10, "3": K10})
    c = client(app_url, lena)
    bad = "k1, p1, k10 p1."
    message = "Row 3, position 12: expected a comma or a full stop."
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        live(page)
        box = open_edit(page, 3)
        fill(box, bad)
        key(page, "Enter")
        expect(alert_of(page, "Text error")).to_have_text(message)
        put(c, pid, 1, 4, "p")
        see_row(page, 1, W(("k", 3), "p", ("k", 6)))
        expect(box).to_have_value(bad)
        expect(box).to_be_focused()
        expect(alert_of(page, "Text error")).to_have_text(message)
        assert caret(box) == 11
        assert text_of(status_of(page, "Row changed")) == "", "a push to another row raises no warning"
        put(c, pid, 3, 4, "p")
        expect(status_of(page, "Row changed")).to_have_text("Row 3 changed while you were typing.")
        see_row(page, 3, W(("k", 3), "p", ("k", 6)))
        expect(box).to_have_value(bad)
        assert caret(box) == 11
        expect(alert_of(page, "Text error")).to_have_text(message)
        key(page, "End")
        page.keyboard.type("x")
        expect(box).to_have_value(bad + "x")
        key(page, "Escape")
        expect(button_of(page, "Edit row 3")).to_be_focused()
        see_cleared(status_of(page, "Row changed"), "the warning shows only until the box closes")
    assert row_of(read(c, pid), 3) == W(("k", 3), "p", ("k", 6)), "typing costs the co-designer nothing"


def test_wf_text_edit_reaches_codesigner(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=10, height=1, castOn=10, coDesigners=[lena.email], rows={"1": RIB})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        live(peer)
        mark(peer)
        apply_text(page, 1, "k4, p6.")
        see_row(peer, 1, "p p p p p p k k k k")
        see_line(peer, 1, "Row 1 (RS): k4, p6. (10 sts)")
        flashing = [c["col"] for c in row_cells(peer, 1) if c["motion"] == "flash"]
        assert flashing == [3, 4, 5, 6, 7, 8] or flashing == [1, 2, 5, 6, 7, 8], flashing
        assert flashing == [1, 2, 5, 6, 7, 8], "only the six changed cells flash"
        not_reloaded(peer)
    assert row_of(read(client(app_url, lena), pid), 1) == "p p p p p p k k k k"


def test_wf_text_edit_undo_chain(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=1, castOn=4, rows={"1": K4})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        apply_text(page, 1, f"p{4}.")
        see_row(page, 1, "p p p p")
        go(page, 1, 1)
        key(page, "k")
        see_row(page, 1, "k p p p")
        key(page, "Control+z")
        see_row(page, 1, "p p p p")
        key(page, "Control+z")
        see_row(page, 1, K4)
        see_line(page, 1, f"Row {1} (RS): k{4}. ({4} sts)")
    assert row_of(read(client(app_url, asha), pid), 1) == K4


def test_wf_selection_tools_clipboard(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=6, height=4, castOn=6, colours=[MAIN, CONTRAST],
               rows={"1": "k p k k k k", "2": "p k k k k k", "3": "ns ns ns ns ns ns", "4": "ns ns ns ns ns ns"},
               colourRows={"1": "B A A A A A"})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 1, 1)
        key(page, "Shift+ArrowRight")
        key(page, "Shift+ArrowUp")
        poll_eq(lambda: sorted((c["row"], c["col"]) for c in snapshot(page)["cells"] if c["selected"]),
                [(1, 1), (1, 2), (2, 1), (2, 2)], "aria-selected marks the rectangle")
        assert at(page) == (2, 2), "the cursor moves with the far corner"
        key(page, "Control+c")
        key(page, "Escape")
        poll_eq(lambda: any(c["selected"] for c in snapshot(page)["cells"]), False, "Escape clears the selection")
        go(page, 3, 3)
        key(page, "Control+v")
        expect(status_of(page, "Chart sync")).to_have_text("Pasted 4 cells.")
        see_row(page, 3, "ns ns k p ns ns")
        see_row(page, 4, "ns ns p k ns ns")
        see_colours(page, 3, "A A B A A A")
        go(page, 3, 6)
        key(page, "Control+v")
        expect(status_of(page, "Chart sync")).to_have_text(f"Pasted {2} of {4} cells. {2} were past the edge.")
        see_row(page, 3, "ns ns k p ns k")
        see_row(page, 4, W(("ns", 2), "p", "k", "ns", "p"))
        go(page, 1, 1)
        key(page, "Control+x")
        see_row(page, 1, "ns p k k k k")
        see_colours(page, 1, "A A A A A A")
        go(page, 3, 1)
        key(page, "Control+v")
        expect(status_of(page, "Chart sync")).to_have_text("Pasted 1 cell.")
        see_row(page, 3, "k ns k p ns k")
    data = read(client(app_url, asha), pid)
    assert row_of(data, 4) == W(("ns", 2), "p", "k", "ns", "p") and cell_of(data, 3, 1)["colour"] == "B"


def test_wf_selection_tools_mirror(browser, app_url):
    asha = person("Asha Verma")
    source = "k2tog k yo ssk m1r"
    pid = seed(app_url, asha, width=5, height=1, castOn=5, colours=[MAIN, CONTRAST], rows={"1": source},
               colourRows={"1": "A B A A A"})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 1, 1)
        for _ in range(4):
            key(page, "Shift+ArrowRight")
        key(page, "m")
        see_row(page, 1, "m1l k2tog yo k ssk")
        see_colours(page, 1, "A A A B A")
        key(page, "Escape")
        go(page, 1, 5)
        for _ in range(4):
            key(page, "Shift+ArrowLeft")
        role(page, "radio", "Paint").focus()
        key(page, "m")
        see_row(page, 1, source)
        see_colours(page, 1, "A B A A A")
    boxed = seed(app_url, asha, width=4, height=1, castOn=4, rows={"1": "k2tog k k ssk"},
                 repeats=[{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 1, "toRow": 1, "times": 2}])
    with opened(browser, app_url, asha, f"/patterns/{boxed}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 1, 1)
        key(page, "Shift+ArrowRight")
        click(button_of(page, "Mirror"))
        expect(status_of(page, "Chart sync")).to_have_text("Mirror cannot cross a repeat box.")
    c = client(app_url, asha)
    refused = c.post(f"/api/patterns/{boxed}/mirror", json={
        "opId": idempotency_key(), "fromRow": 1, "toRow": 1, "fromCol": 1, "toCol": 2})
    assert refused.status_code == 409 and refused.json()["error"] == "crosses_repeat"
    assert row_of(read(c, boxed), 1) == "k2tog k k ssk"


def test_undo_and_redo_keys(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=5, height=1, castOn=5)
    blank = "ns ns ns ns ns"
    placed = "ns ns ns ns k"
    filled = "p p ns ns k"
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 1, 5)
        key(page, "k")
        see_row(page, 1, placed)
        go(page, 1, 1)
        key(page, "Shift+ArrowRight")
        key(page, "p")
        see_row(page, 1, filled)
        key(page, "Control+z")
        see_row(page, 1, placed)
        key(page, "Control+z")
        see_row(page, 1, blank)
        key(page, "Control+y")
        see_row(page, 1, placed)
        key(page, "Control+Shift+Z")
        see_row(page, 1, filled)
        key(page, "Meta+z")
        see_row(page, 1, placed)
        role(page, "radio", "Paint").focus()
        key(page, "Control+z")
        see_row(page, 1, blank)
        key(page, "Control+y")
        see_row(page, 1, placed)
        go(page, 1, 3)
        key(page, "p")
        see_row(page, 1, "ns ns p ns k")
        key(page, "Control+y")
        key(page, "Control+z")
        see_row(page, 1, placed)
    assert row_of(read(client(app_url, asha), pid), 1) == placed


def test_paint_and_select_by_pointer(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=6, height=3, castOn=6)
    blank = "ns ns ns ns ns ns"
    sent: list[str] = []
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        page.on("request", lambda r: sent.append(r.url) if r.method == "POST" and r.url.endswith("/cells") else None)
        page.mouse.move(*center(cell(page, 1, 1)))
        page.mouse.down()
        page.mouse.move(*center(cell(page, 1, 6)))
        page.mouse.up()
        see_row(page, 1, "k k k k k k")
        assert len(sent) == 1, "a drag is one request"
        assert page.evaluate("window.getSelection().isCollapsed"), "a drag never starts text selection"
        check(role(page, "radio", "Purl"))
        page.mouse.move(*center(cell(page, 1, 1)))
        page.mouse.down()
        page.mouse.move(*center(cell(page, 3, 3)))
        page.mouse.up()
        see_row(page, 2, "ns p ns ns ns ns")
        see_row(page, 3, "ns ns p ns ns ns")
        assert stitches(page, 1).startswith("p k"), "the drag painted its first cell"
        assert len(sent) == 2
        cursor_cell(page).focus()
        key(page, "Control+z")
        see_row(page, 2, blank)
        see_row(page, 3, blank)
        see_row(page, 1, "k k k k k k")
        key(page, "Control+z")
        see_row(page, 1, blank)
        check(role(page, "radio", "Select"))
        page.mouse.move(*center(cell(page, 1, 1)))
        page.mouse.down()
        page.mouse.move(*center(cell(page, 2, 3)))
        page.mouse.up()
        expect(status_of(page, "Chart sync")).to_have_text(f"Selected {2} rows by {3} columns.")
        assert sum(c["selected"] for c in snapshot(page)["cells"]) == 6


def test_wf_selection_tools_touch_paint(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=3, castOn=4)
    with opened(browser, app_url, asha, f"/patterns/{pid}", size=TOUCH_PHONE) as page:
        expect(grid(page)).to_be_visible()
        cdp = touch_on(page)
        rect = box_of(cell(page, 1, 1))
        assert rect["width"] >= MIN_CELL_PX and rect["height"] >= MIN_CELL_PX
        x, y = center(cell(page, 1, 1))
        gesture(cdp, [(x, y)])
        see_row(page, 1, "k ns ns ns")
        path = [center(cell(page, 2, 1)), center(cell(page, 2, 4))]
        scrolled = page.evaluate("window.scrollY")
        gesture(cdp, path)
        see_row(page, 2, "k k k k")
        assert page.evaluate("window.scrollY") == scrolled, "the grid takes the gesture, not the page"
        swipe(cdp, grid(page).get_by_role("rowheader", name="Row 3"), 0, 40)
        gesture(cdp, [center(cell(page, 1, 4))])
        see_row(page, 1, "k ns ns k")
        assert stitches(page, 3) == "ns ns ns ns", "a gesture on a row header paints nothing"
    data = read(client(app_url, asha), pid)
    assert row_of(data, 2) == "k k k k" and row_of(data, 1) == "k ns ns k"


def test_wf_colourwork_key_and_digits(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=1, castOn=4, rows={"1": K4})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        see_items(page, "Colour key", ["A Main"])
        hex_box = role(page, "textbox", "Colour hex")
        name_box = role(page, "textbox", "Colour name")
        fill(hex_box, HEX_B)
        click(button_of(page, "Add colour"))
        expect(alert_of(page, "Colour error")).to_have_text("Enter a colour name.")
        expect(name_box).to_have_attribute("aria-invalid", "true")
        fill(name_box, "Moss")
        fill(hex_box, "green")
        click(button_of(page, "Add colour"))
        expect(alert_of(page, "Colour error")).to_have_text("Enter a colour as # and six hex digits.")
        expect(hex_box).to_have_attribute("aria-invalid", "true")
        see_items(page, "Colour key", ["A Main"])
        fill(hex_box, HEX_C)
        click(button_of(page, "Add colour"))
        see_items(page, "Colour key", ["A Main", "B Moss"])
        expect(role(page, "radio", "B Moss")).to_be_visible()
        go(page, 1, 1)
        key(page, "3")
        key(page, "2")
        see_colours(page, 1, "B A A A")
        assert at(page) == (1, 1), "a digit does not move the cursor"
        see_line(page, 1, "Row 1 (RS): k3 in A, k1 in B. (4 sts)")
        expect(cell(page, 1, 1)).to_have_attribute("aria-label", "Row 1, column 1: Knit, colour B")
        key(page, "Shift+ArrowRight")
        key(page, "2")
        see_colours(page, 1, "B B A A")
        see_line(page, 1, "Row 1 (RS): k2 in A, k2 in B. (4 sts)")
    data = read(client(app_url, asha), pid)
    assert [c["letter"] for c in data["colours"]] == ["A", "B"]
    assert cell_of(data, 1, 2)["colour"] == "B"


def test_wf_colourwork_limit_recovery(browser, app_url):
    asha = person("Asha Verma")
    limit = limits(app_url)["maxColours"]
    letters = "ABCDEF"[: limit - 1]
    key_colours = [{"letter": letter, "name": f"Yarn {letter}", "hex": HEX_A} for letter in letters]
    pid = seed(app_url, asha, width=4, height=1, castOn=4, rows={"1": K4}, colours=key_colours)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        fill(role(page, "textbox", "Colour name"), "Last")
        fill(role(page, "textbox", "Colour hex"), HEX_B)
        click(button_of(page, "Add colour"))
        poll_eq(lambda: len(items(list_of(page, "Colour key"))), limit, "the key reached the limit")
        fill(role(page, "textbox", "Colour name"), "Extra")
        fill(role(page, "textbox", "Colour hex"), HEX_C)
        click(button_of(page, "Add colour"))
        expect(alert_of(page, "Colour error")).to_have_text(f"A pattern can have {limit} colours.")
        assert len(items(list_of(page, "Colour key"))) == limit
    c = client(app_url, asha)
    refused = c.post(f"/api/patterns/{pid}/colours", json={"name": "Extra", "hex": HEX_C})
    assert refused.status_code == 409 and refused.json()["error"] == "too_many_colours"
    assert len(read(c, pid)["colours"]) == limit


def test_colour_in_written_lines(browser, app_url):
    asha = person("Asha Verma")
    cases = [
        (K10, "A A B B B B B B A A", "Rnd 1: k2 in A, k6 in B, k2 in A. (10 sts)"),
        (K8, "A B A B A B A B", "Rnd 1: *k1 in B, k1 in A; rep from * to end. (8 sts)"),
        ("k2tog k2tog k2tog k k", "B B B A A", "Rnd 1: k2 in A, k2tog x3 in B. (5 sts)"),
        ("c22 c22 c22 c22 k k", "A A A B A A", "Rnd 1: k2 in A, 2/2 LC in B. (6 sts)"),
        ("k k ns ns", "A A B B", "Rnd 1: k2. (2 sts)"),
    ]
    c = None
    for cells, colour_row, want in cases:
        width = len(cells.split())
        pid = seed(app_url, asha, mode="round", width=width, height=1, castOn=width, rows={"1": cells},
                   colours=[MAIN, CONTRAST], colourRows={"1": colour_row})
        c = c or client(app_url, asha)
        assert by_row(read(c, pid))[1]["text"] == want
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        see_line(page, 1, "Rnd 1: k2. (2 sts)")


def test_colour_warnings(browser, app_url):
    asha = person("Asha Verma")
    first = "Row 1: float of 6 stitches in colour A."
    rest = ["Row 2 uses 3 colours, the limit is 2.", "Row 3 uses 3 colours, the limit is 2.",
            "Row 3: float of 6 stitches in colour A."]
    pid = seed(app_url, asha, width=10, height=3, castOn=10, colours=[MAIN, CONTRAST, THIRD],
               rows={"1": K10, "2": K10, "3": K10},
               colourRows={"1": "A A B B B B B B A A", "2": "A B C A B C A B C A", "3": "A B B B B B B A C C"})
    c = client(app_url, asha)
    assert [w["message"] for w in read(c, pid)["colourWarnings"]] == [first, *rest]
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        see_items(page, "Colour warnings", [first, *rest])
        assert by_data_row(list_of(page, "Colour warnings"), 2).count() == 1
        go(page, 1, 5)
        key(page, "1")
        see_items(page, "Colour warnings", rest)
    edge = seed(app_url, asha, width=7, height=1, castOn=7, colours=[MAIN, CONTRAST],
                rows={"1": "k k k k k k k"}, colourRows={"1": "A B B B B B A"})
    assert read(c, edge)["colourWarnings"] == []
    with opened(browser, app_url, asha, f"/patterns/{edge}") as page:
        see_items(page, "Colour warnings", ["No colour warnings."])
    cable = seed(app_url, asha, width=8, height=1, castOn=8, colours=[MAIN, CONTRAST],
                 rows={"1": "k c22 c22 c22 c22 k k k"}, colourRows={"1": "A B B B B B B A"})
    assert [w["message"] for w in read(c, cable)["colourWarnings"]] == [first]
    boxed = seed(app_url, asha, width=4, height=1, castOn=8, colours=[MAIN, CONTRAST], rows={"1": K4},
                 colourRows={"1": "A B B A"},
                 repeats=[{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 1, "toRow": 1, "times": 3}])
    assert [w["message"] for w in read(c, boxed)["colourWarnings"]] == [first]


def test_wf_colourwork_twin_tokens(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, mode="round", width=10, height=1, castOn=10, rows={"1": K10},
               colours=[MAIN, CONTRAST], colourRows={"1": "A A B B B B B B A A"})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(tokens(page, 1).first).to_be_visible()
        park_pointer(page)
        assert [text_of(tokens(page, 1).nth(i)) for i in range(3)] == ["k2 in A", "k6 in B", "k2 in A"]
        yarn = style(cell(page, 1, 9), "background-color")
        tokens(page, 1).first.focus()
        see_lifted(page, [(1, 10), (1, 9)])
        assert style(cell(page, 1, 9), "background-color") == yarn, "a colourwork cell keeps its yarn colour"
        key(page, "ArrowRight")
        expect(tokens(page, 1).nth(1)).to_be_focused()
        see_lifted(page, [(1, col) for col in range(3, 9)])
        key(page, "ArrowRight")
        expect(tokens(page, 1).nth(2)).to_be_focused()
        see_lifted(page, [(1, 2), (1, 1)])
        key(page, "ArrowLeft")
        see_lifted(page, [(1, col) for col in range(3, 9)])


def test_wf_colourwork_clipboard_keeps_colours(browser, app_url):
    asha = person("Asha Verma")
    plain = "A A A A A A A A A A"
    pid = seed(app_url, asha, mode="round", width=10, height=2, castOn=10, rows={"1": K10, "2": K10},
               colours=[MAIN, CONTRAST], colourRows={"1": plain, "2": "B B A A A A A A A A"})
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        see_items(page, "Colour warnings", ["No colour warnings."])
        go(page, 2, 1)
        key(page, "Shift+ArrowRight")
        key(page, "Control+c")
        key(page, "Escape")
        go(page, 1, 9)
        key(page, "Control+v")
        expect(status_of(page, "Chart sync")).to_have_text("Pasted 2 cells.")
        see_colours(page, 1, "A A A A A A A A B B")
        see_line(page, 1, "Rnd 1: k2 in B, k8 in A. (10 sts)")
        see_items(page, "Colour warnings", ["No colour warnings."])
        go(page, 1, 1)
        key(page, "Control+v")
        see_colours(page, 1, "B B A A A A A A B B")
        see_line(page, 1, "Rnd 1: k2 in B, k6 in A, k2 in B. (10 sts)")
        see_items(page, "Colour warnings", ["Row 1: float of 6 stitches in colour B."])
        key(page, "Control+z")
        see_colours(page, 1, "A A A A A A A A B B")
        see_items(page, "Colour warnings", ["No colour warnings."])
        key(page, "Control+y")
        see_items(page, "Colour warnings", ["Row 1: float of 6 stitches in colour B."])
        reload(page)
        see_colours(page, 1, "B B A A A A A A B B")


def test_wf_co_design_presence(browser, app_url, valkey):
    asha, lena, mei = person("Asha Verma"), person("Lena Holt"), person("Mei Lin")
    pid = seed(app_url, asha, lena, mei, width=6, height=3, castOn=6, coDesigners=[lena.email, mei.email])
    ids = {who.email: client(app_url, who).get("/api/me").json()["id"] for who in (asha, lena, mei)}
    path = f"/patterns/{pid}"
    with opened(browser, app_url, asha, path) as page:
        expect(grid(page)).to_be_visible()
        with opened(browser, app_url, lena, path) as peer:
            expect(grid(peer)).to_be_visible()
            with opened(browser, app_url, mei, path) as third:
                expect(grid(third)).to_be_visible()
                see_items(page, "Here now", ["Asha Verma (you)", "Lena Holt", "Mei Lin"])
                see_items(third, "Here now", ["Mei Lin (you)", "Asha Verma", "Lena Holt"])
                poll_eq(lambda: valkey.hash(f"presence:{pid}"),
                        {ids[asha.email]: asha.name, ids[lena.email]: lena.name, ids[mei.email]: mei.name},
                        "the presence hash maps user id to name")
            see_items(page, "Here now", ["Asha Verma (you)", "Lena Holt"])
            go(peer, 2, 3)
            poll_eq(lambda: [(c["row"], c["col"]) for c in snapshot(page)["cells"] if c["peer"] == lena.name],
                    [(2, 3)], "data-peer follows the peer's cursor")
            key(peer, "ArrowLeft")
            poll_eq(lambda: [(c["row"], c["col"]) for c in snapshot(page)["cells"] if c["peer"] == lena.name],
                    [(2, 2)], "data-peer moved with the cursor")
            with opened(browser, app_url, lena, path) as second:
                expect(grid(second)).to_be_visible()
                live(second)
            see_items(page, "Here now", ["Asha Verma (you)", "Lena Holt"])
        see_items(page, "Here now", ["Asha Verma (you)"])


def test_wf_co_design_live_edits(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    rows = {str(n): K4 for n in range(1, 41)}
    pid = seed(app_url, asha, lena, width=4, height=40, castOn=4, rows=rows, coDesigners=[lena.email])
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        live(page)
        live(peer)
        go(peer, 30, 2)
        cell(peer, 30, 2).evaluate("e => e.scrollIntoView({block: 'center'})")
        scrolls = peer.evaluate(SCROLLS_JS)
        mark(peer)
        go(page, 2, 1)
        poll_eq(lambda: [(c["row"], c["col"]) for c in snapshot(peer)["cells"] if c["peer"] == asha.name],
                [(2, 1)], "the cursor move reached the peer")
        key(page, "Delete")
        see_row(peer, 2, "ns k k k")
        see_line(peer, 2, by_row(read(client(app_url, lena), pid))[2]["text"])
        expect(status_of(peer, "Row check")).to_have_text(f"{needs(2, 4, 3)} {needs(3, 3, 4)}")
        not_reloaded(peer)
        assert peer.evaluate(SCROLLS_JS) == scrolls, "no scroll jump on the peer's page"
        assert at(peer) == (30, 2) and cursor_cell(peer).evaluate(FOCUSED_JS), "the peer keeps cursor and focus"
    assert row_of(read(client(app_url, lena), pid), 2) == "ns k k k"


def test_wf_co_design_conflict(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=10, height=1, castOn=10, coDesigners=[lena.email], rows={"1": K10})
    c = client(app_url, asha)
    notice_ms = limits(app_url)["noticeSeconds"] * 1000
    with opened(browser, app_url, lena, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        live(page)
        conflict = alert_of(page, "Conflict")
        hold(app_url, pid, lena.email, True)
        put(c, pid, 1, 5, "p")
        go(page, 1, 5)
        key(page, "t")
        expect(conflict).to_have_text(f"{asha.name} changed row 1, column 5 first. Your change was not kept.")
        see_row(page, 1, W(("k", 4), "p", ("k", 5)))
        advance(page, notice_ms - 100)
        expect(conflict).to_contain_text("Your change was not kept.")
        advance(page, 200)
        see_cleared(conflict, "the notice clears after NOTICE_SECONDS")
        assert stitches(page, 1) == W(("k", 4), "p", ("k", 5))
        for col in range(6, 11):
            put(c, pid, 1, col, "p")
        go(page, 1, 6)
        for _ in range(4):
            key(page, "Shift+ArrowRight")
        key(page, "t")
        for col in (6, 7, 8):
            expect(conflict).to_contain_text(f"{asha.name} changed row 1, column {col} first. Your change was not kept.")
        expect(conflict).to_contain_text("and 2 more cells.")
        expect(conflict).not_to_contain_text("column 9")
        advance(page, notice_ms - 2000)
        put(c, pid, 1, 1, "p")
        go(page, 1, 1)
        key(page, "t")
        expect(conflict).to_have_text(f"{asha.name} changed row 1, column 1 first. Your change was not kept.")
        advance(page, notice_ms - 100)
        expect(conflict).to_contain_text("column 1 first", timeout=EXPECT_MS)
        advance(page, 200)
        see_cleared(conflict, "a newer conflict restarts the notice time")
        hold(app_url, pid, lena.email, False)
    assert row_of(read(c, pid), 1) == W("p", ("k", 3), ("p", 6)), "accepted edits stand and refused ones left no trace"


def test_wf_co_design_concurrent_edit(app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=4, height=1, castOn=4, coDesigners=[lena.email], rows={"1": K4})
    clients = {asha.name: (client(app_url, asha), "p"), lena.name: (client(app_url, lena), "yo")}
    rev = cell_of(read(clients[asha.name][0], pid), 1, 1)["rev"]

    def send(item: tuple[str, tuple[httpx.Client, str]]) -> tuple[str, dict[str, Any]]:
        name, (c, stitch) = item
        response = c.post(f"/api/patterns/{pid}/cells", json={"opId": idempotency_key(), "cells": [
            {"row": 1, "col": 1, "stitch": stitch, "colour": "A", "rev": rev}]})
        assert response.status_code == 200, response.text
        return name, response.json()

    with ThreadPoolExecutor(2) as pool:
        answers = dict(pool.map(send, clients.items()))
    winners = [name for name, body in answers.items() if body["applied"]]
    assert len(winners) == 1, answers
    loser = next(name for name in answers if name != winners[0])
    refused = answers[loser]["conflicts"]
    assert len(refused) == 1 and refused[0]["by"] == winners[0]
    data = read(clients[asha.name][0], pid)
    assert cell_of(data, 1, 1)["stitch"] == clients[winners[0]][1]
    assert cell_of(data, 1, 1)["rev"] == rev + 1 and refused[0]["rev"] == rev + 1
    revs = {col: cell_of(data, 1, col)["rev"] for col in (2, 3)}
    for name, col in ((asha.name, 2), (lena.name, 3)):
        response = clients[name][0].post(f"/api/patterns/{pid}/cells", json={"opId": idempotency_key(), "cells": [
            {"row": 1, "col": col, "stitch": "p", "colour": "A", "rev": revs[col]}]})
        assert response.json()["conflicts"] == []
    final = read(clients[asha.name][0], pid)
    assert cell_of(final, 1, 2)["stitch"] == "p" and cell_of(final, 1, 3)["stitch"] == "p"


def test_undo_leaves_later_change_alone(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=5, height=1, castOn=5, coDesigners=[lena.email], rows={"1": "k k k k k"})
    c = client(app_url, lena)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        live(page)
        go(page, 1, 1)
        key(page, "Shift+ArrowRight")
        key(page, "p")
        see_row(page, 1, "p p k k k")
        put(c, pid, 1, 1, "yo")
        see_row(page, 1, "yo p k k k")
        cursor_cell(page).focus()
        key(page, "Control+z")
        expect(status_of(page, "Chart sync")).to_have_text(f"1 cell left as {lena.name} changed it.")
        see_row(page, 1, "yo k k k k")
        assert text_of(alert_of(page, "Conflict")) == "", "undo reports in Chart sync, not the Conflict notice"
        go(page, 1, 3)
        key(page, "Shift+ArrowRight")
        key(page, "Shift+ArrowRight")
        key(page, "p")
        see_row(page, 1, "yo k p p p")
        put(c, pid, 1, 3, "yo")
        put(c, pid, 1, 4, "yo")
        see_row(page, 1, "yo k yo yo p")
        cursor_cell(page).focus()
        key(page, "Control+z")
        expect(status_of(page, "Chart sync")).to_have_text(f"2 cells left as {lena.name} changed them.")
        see_row(page, 1, W("yo", "k", "yo", "yo", "k"))
    assert row_of(read(c, pid), 1) == W("yo", "k", "yo", "yo", "k")


def test_wf_co_design_mirror_reaches_peers(browser, app_url):
    asha, lena, mei = person("Asha Verma"), person("Lena Holt"), person("Mei Lin")
    pid = seed(app_url, asha, lena, mei, width=5, height=1, castOn=5, rows={"1": "k2tog k yo ssk m1r"},
               coDesigners=[lena.email, mei.email])
    want = "m1l k2tog yo k ssk"
    changed = [1, 2, 4, 5]
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, lena, f"/patterns/{pid}") as peer, \
            opened(browser, app_url, mei, f"/patterns/{pid}", reduced="reduce") as calm:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        expect(grid(calm)).to_be_visible()
        live(peer)
        live(calm)
        mark(peer)
        go(page, 1, 1)
        for _ in range(4):
            key(page, "Shift+ArrowRight")
        key(page, "m")
        see_row(page, 1, want)
        see_row(peer, 1, want)
        see_row(calm, 1, want)
        see_line(peer, 1, "Row 1 (RS): ssk, k1, yo, k2tog, m1l. (5 sts)")
        poll_eq(lambda: [c["col"] for c in row_cells(peer, 1) if c["motion"] == "flash"], changed,
                "the peer's changed cells flash")
        poll_eq(lambda: [c["col"] for c in row_cells(calm, 1) if c["outline"] == "static"], changed,
                "under reduced motion the changed cells take the static outline")
        assert not calm.evaluate(ANY_MOTION_JS), "no data-motion under reduced motion"
        assert not page.evaluate(ANY_MOTION_JS), "a person's own mirror moves nothing"
        advance(peer, FLASH_MS + 100)
        poll_eq(lambda: [c for c in row_cells(peer, 1) if c["motion"]], [], "the flash ends after 0.6 seconds")
        advance(calm, OUTLINE_MS + 100)
        poll_eq(lambda: [c for c in row_cells(calm, 1) if c["outline"]], [], "the outline ends after 2 seconds")
        not_reloaded(peer)


def invite_token(body: str) -> str:
    found = re.findall(r"/invite/([^\s\"'<>]+)", body)
    assert len(set(found)) == 1, f"the mail carries one invitation link, saw {found}"
    return found[0]


def test_wf_tester_follow_invite_join(browser, app_url, mail):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    name = tag("Lace cowl")
    rows = {"1": K4, "2": K4}
    pid = seed(app_url, asha, name=name, width=4, height=2, castOn=4, rows=rows, versions=[snap(rows, 4, 2, 4)])
    c = client(app_url, asha)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        box = role(page, "textbox", "Tester email")
        fill(box, "not-an-email")
        click(button_of(page, "Invite tester"))
        expect(alert_of(page, "Tester error")).to_have_text("Enter a valid email address.")
        expect(box).to_have_attribute("aria-invalid", "true")
        fill(box, tomas.email)
        click(button_of(page, "Invite tester"))
        expect(status_of(page, "Chart sync")).to_have_text(f"Invitation sent to {tomas.email}.")
    message = mails(mail, tomas.email, f"Test {name} on Twinrow")[0]
    assert mail_from_address() in addresses(message.get("From"))
    body = text(message)
    assert len(set(re.findall(r"https?://[^\s\"'<>]+", body))) == 1
    token = invite_token(body)
    with opened(browser, app_url, None, f"/invite/{token}") as page:
        fill(role(page, "textbox", "Name"), tomas.name)
        fill(page.get_by_label("Password", exact=True), tomas.password)
        click(button_of(page, "Join as tester"))
        page.wait_for_url(f"**/follow/{pid}")
        expect(status_of(page, "Row counter")).to_have_text("Row 1 of 2")
        reload(page)
        expect(status_of(page, "Row counter")).to_have_text("Row 1 of 2")
        assert page.url.endswith(f"/follow/{pid}")
    tc = client(app_url, tomas)
    assert tc.get(f"/api/patterns/{pid}/counter").json() == {"row": 1, "version": 1, "total": 2}
    again = c.post(f"/api/patterns/{pid}/testers", json={"email": tomas.email})
    assert again.status_code == 409 and again.json()["error"] == "already_testing"
    assert again.json()["message"] == "That person is already testing this pattern."
    mails(mail, tomas.email, f"Test {name} on Twinrow")
    blank = seed(app_url, asha)
    refused = c.post(f"/api/patterns/{blank}/testers", json={"email": tomas.email})
    assert refused.status_code == 409 and refused.json()["message"] == "Save a version before inviting testers."


def test_wf_tester_follow_expired_used(browser, app_url, mail):
    asha, late, used, known = person("Asha Verma"), person("Mei Lin"), person("Tomas Reed"), person("Sam Ortiz")
    ttl = limits(app_url)["inviteTtlHours"]
    name = tag("Rib hat")
    rows = {"1": K4}
    pid = seed(app_url, asha, late, used, known, name=name, width=4, height=1, castOn=4, rows=rows,
               versions=[snap(rows, 4, 1, 4)], invites=[
                   {"email": late.email, "sentHoursAgo": ttl + 1, "status": "sent"},
                   {"email": used.email, "sentHoursAgo": 0, "status": "accepted"},
                   {"email": known.email, "sentHoursAgo": ttl - 1, "status": "sent"}])
    subject = f"Test {name} on Twinrow"
    token = {who.email: invite_token(text(mails(mail, who.email, subject)[0])) for who in (late, used, known)}
    c = client(app_url)
    assert c.get(f"/api/invites/{token[late.email]}").json()["status"] == "expired"
    assert c.get(f"/api/invites/{token[used.email]}").json()["status"] == "accepted"
    assert c.get(f"/api/invites/{UNKNOWN_TOKEN}").status_code == 404
    expired = c.post(f"/api/invites/{token[late.email]}/accept", json={"password": late.password})
    assert expired.status_code == 409 and expired.json()["error"] == "invite_expired"
    spent = c.post(f"/api/invites/{token[used.email]}/accept", json={"password": used.password})
    assert spent.status_code == 409 and spent.json()["error"] == "invite_used"
    with opened(browser, app_url, None, f"/invite/{token[late.email]}") as page:
        expect(page.get_by_text("This invitation has expired. Ask the designer for a new one.", exact=True)).to_be_visible()
        expect(button_of(page, "Join as tester")).to_have_count(0)
        page.goto(url(app_url, f"/invite/{token[used.email]}"))
        expect(page.get_by_text("This invitation has already been used.", exact=True)).to_be_visible()
        expect(button_of(page, "Join as tester")).to_have_count(0)
        page.goto(url(app_url, f"/invite/{token[known.email]}"))
        expect(button_of(page, "Join as tester")).to_be_visible()
        expect(role(page, "textbox", "Name")).to_have_count(0)
        fill(page.get_by_label("Password", exact=True), OTHER_PASSWORD)
        click(button_of(page, "Join as tester"))
        expect(alert_of(page, "Invite error")).to_be_visible()
        fill(page.get_by_label("Password", exact=True), known.password)
        click(button_of(page, "Join as tester"))
        page.wait_for_url(f"**/follow/{pid}")


def test_follow_touch_steps(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4, "2": K4, "4": K4}
    pid = seed(app_url, asha, tomas, width=4, height=4, castOn=4, rows=rows, versions=[snap(rows, 4, 4, 4)],
               testers=[tester(tomas)])
    c = client(app_url, tomas)
    with opened(browser, app_url, tomas, f"/follow/{pid}", size=PHONE) as page:
        counter = status_of(page, "Row counter")
        expect(counter).to_have_text("Row 1 of 4")
        cdp = touch_on(page)
        region = role(page, "region", "Current row")
        nxt, prev, note = button_of(page, "Next row"), button_of(page, "Previous row"), button_of(page, "Add note")
        for control in (nxt, prev, note):
            rect = box_of(control)
            assert rect["width"] >= MIN_TARGET_PX and rect["height"] >= MIN_TARGET_PX
            assert rect["left"] >= 0 and rect["right"] <= PHONE[0] and rect["bottom"] <= PHONE[1]
        expect(prev).to_be_disabled()
        gesture(cdp, [center(nxt)])
        expect(counter).to_have_text("Row 2 of 4")
        expect(status_of(page, "Row announcement")).to_have_text(by_row(read(client(app_url, asha), pid))[2]["text"])
        expect(region).to_contain_text(by_row(read(client(app_url, asha), pid))[2]["text"])
        swipe(cdp, region, -(SWIPE_PX - 10))
        swipe(cdp, region, -(SWIPE_PX + 10), SWIPE_PX + 40)
        swipe(cdp, region, -(SWIPE_PX + 20))
        expect(counter).to_have_text("Row 3 of 4")
        assert c.get(f"/api/patterns/{pid}/counter").json()["row"] == 3, "short and downward swipes must not step"
        expect(region).to_contain_text("This row has no stitches.")
        expect(status_of(page, "Row announcement")).to_have_text("This row has no stitches.")
        swipe(cdp, region, SWIPE_PX + 20)
        expect(counter).to_have_text("Row 2 of 4")
        swipe(cdp, region, -(SWIPE_PX + 20))
        expect(counter).to_have_text("Row 3 of 4")
        swipe(cdp, region, -(SWIPE_PX + 20))
        expect(counter).to_have_text("Row 4 of 4")
        expect(nxt).to_be_disabled()
        rect = box_of(region)
        assert rect["top"] >= 0 and rect["bottom"] <= PHONE[1], "the line stays on screen"
    assert c.get(f"/api/patterns/{pid}/counter").json()["row"] == 4


def test_wf_tester_follow_layouts(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {str(n): K4 for n in range(1, 31)}
    pid = seed(app_url, asha, tomas, width=4, height=30, castOn=4, rows=rows, versions=[snap(rows, 4, 30, 4)],
               testers=[tester(tomas)])
    with opened(browser, app_url, tomas, f"/follow/{pid}") as page:
        expect(grid(page)).to_be_visible()
        assert layout_name(page) == "desktop"
        layout(page)
        assert box_of(status_of(page, "Row counter"))["left"] >= box_of(grid(page))["right"] - 1
        assert box_of(list_of(page, "Your notes"))["left"] >= box_of(grid(page))["right"] - 1
        for (width, height), name in ((TABLET, "tablet"), (PHONE, "phone")):
            resize(page, width, height)
            poll_eq(lambda: layout_name(page), name, f"data-layout at {width}")
            layout(page)
            page.evaluate("window.scrollTo(0, 200)")
            dock = box_of(button_of(page, "Next row"))
            assert dock["bottom"] <= height and dock["top"] >= height * 2 / 3, "the dock is pinned at thumb reach"
            assert box_of(status_of(page, "Row counter"))["bottom"] <= height


def test_counter_two_devices_and_replay(browser, app_url, valkey):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {str(n): K4 for n in range(1, 7)}
    pid = seed(app_url, asha, tomas, width=4, height=6, castOn=4, rows=rows, versions=[snap(rows, 4, 6, 4)],
               testers=[tester(tomas)])
    c = client(app_url, tomas)
    uid = c.get("/api/me").json()["id"]
    route = f"/api/patterns/{pid}/counter"

    def step(body: dict[str, Any]) -> int:
        response = c.post(route, json=body)
        assert response.status_code == 200, response.text
        return response.json()["row"]

    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(step, [{"from": 1, "step": 1, "stepId": idempotency_key()} for _ in range(2)]))
    assert answers == [2, 2], "two devices stepping from one row end one row on"
    assert valkey.command("GET", f"counter:{pid}:{uid}") == "2"
    replay = {"from": 2, "step": 1, "stepId": idempotency_key()}
    assert step(replay) == 3
    assert step({"from": 3, "step": -1, "stepId": idempotency_key()}) == 2
    assert step(replay) == 2, "a replayed stepId changes nothing even when its from-row matches"
    assert step({"from": 5, "step": 1, "stepId": idempotency_key()}) == 2, "a stale from-row changes nothing"
    bad = c.post(route, json={"from": 2, "step": 2, "stepId": idempotency_key()})
    assert bad.status_code == 422 and bad.json()["field"] == "step"
    with opened(browser, app_url, tomas, f"/follow/{pid}") as first, \
            opened(browser, app_url, tomas, f"/follow/{pid}") as second:
        expect(status_of(first, "Row counter")).to_have_text("Row 2 of 6")
        expect(status_of(second, "Row counter")).to_have_text("Row 2 of 6")
        live(first)
        live(second)
        mark(second)
        nxt = button_of(first, "Next row")
        nxt.focus()
        key(first, "n")
        expect(status_of(second, "Row counter")).to_have_text("Row 3 of 6")
        key(first, "p")
        expect(status_of(second, "Row counter")).to_have_text("Row 2 of 6")
        key(first, "Space")
        expect(status_of(second, "Row counter")).to_have_text("Row 3 of 6")
        assert c.get(route).json()["row"] == 3, "Space on a focused button presses only that button"
        role(first, "link", "Your patterns").focus()
        key(first, "Space")
        expect(status_of(second, "Row counter")).to_have_text("Row 4 of 6")

        def pinned() -> bool:
            chart = snapshot(second)
            here = [x for x in chart["cells"] if x["row"] == 4]
            others = [x for x in chart["cells"] if x["row"] != 4]
            return (all(x["current"] == "true" and x["lift"] == "twin" for x in here)
                    and not any(x["current"] for x in others)
                    and chart["rows"]["4"]["follow"] == "current" and chart["rows"]["3"]["follow"] == "done"
                    and chart["rows"]["5"]["follow"] == "todo")

        poll(pinned, "the pin and follow marks moved with the counter on the other device")
        not_reloaded(second)
    edge = c.post(route, json={"from": 4, "step": 1, "stepId": idempotency_key()}).json()["row"]
    assert edge == 5
    assert step({"from": 5, "step": 1, "stepId": idempotency_key()}) == 6
    assert step({"from": 6, "step": 1, "stepId": idempotency_key()}) == 6, "a step past the last row changes nothing"


def test_wf_tester_follow_two_testers(browser, app_url):
    asha, tomas, mei = person("Asha Verma"), person("Tomas Reed"), person("Mei Lin")
    rows = {"1": K4, "2": K4, "3": K4}
    pid = seed(app_url, asha, tomas, mei, width=4, height=3, castOn=4, rows=rows, versions=[snap(rows, 4, 3, 4)],
               testers=[tester(tomas), tester(mei, row=2)])
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, tomas, f"/follow/{pid}") as follow:
        expect(grid(page)).to_be_visible()
        live(page)
        mark(page)
        expect(status_of(follow, "Row counter")).to_have_text("Row 1 of 3")
        poll_eq(lambda: tester_cells(page, tomas.name), [1, 1, 0], "Tomas's starting table row")
        poll_eq(lambda: tester_cells(page, mei.name), [1, 2, 0], "Mei's starting table row")
        click(button_of(follow, "Next row"))
        expect(status_of(follow, "Row counter")).to_have_text("Row 2 of 3")
        click(button_of(follow, "Next row"))
        poll_eq(lambda: tester_cells(page, tomas.name), [1, 3, 0], "the table followed Tomas with no reload")
        assert tester_cells(page, mei.name) == [1, 2, 0], "each tester keeps their own row"
        not_reloaded(page)
    assert client(app_url, mei).get(f"/api/patterns/{pid}/counter").json()["row"] == 2
    assert client(app_url, tomas).get(f"/api/patterns/{pid}/counter").json()["row"] == 3


def test_tester_and_stranger_access(browser, app_url):
    asha, lena, tomas, mei, sam = (person(n) for n in ("Asha Verma", "Lena Holt", "Tomas Reed", "Mei Lin", "Sam Ortiz"))
    rows = {"1": K4, "2": K4}
    note = tag("mine")
    other = tag("theirs")
    pid = seed(app_url, asha, lena, tomas, mei, sam, width=4, height=2, castOn=4, rows=rows, coDesigners=[lena.email],
               versions=[snap(rows, 4, 2, 4), snap(rows, 4, 2, 4)],
               testers=[tester(tomas, notes=[{"row": 1, "text": note}]),
                        tester(mei, notes=[{"row": 1, "text": other}])])
    base = f"/api/patterns/{pid}"
    designer_reads = [base, f"{base}/versions", f"{base}/versions/1", f"{base}/compare?a=1&b=2"]
    tester_reads = [f"{base}/follow", f"{base}/counter"]
    writes = [(f"{base}/cells", {"cells": "bad"}), (f"{base}/text", {"row": "bad"}), (f"{base}/repeats", {}),
              (f"{base}/mirror", {}), (f"{base}/colours", {}), (f"{base}/versions", {"note": 1}),
              (f"{base}/publish", {}), (f"{base}/testers", {"email": "bad"}), (f"{base}/co-designers", {}),
              (f"{base}/versions/1/restore", {}), (f"{base}/notes", {}), (f"{base}/counter", {})]
    stranger = client(app_url, sam)
    for path in designer_reads + tester_reads + [f"{base}/notes"]:
        response = stranger.get(path)
        assert response.status_code == 404 and response.json() == {"error": "not_found"}, path
    for path, body in writes:
        response = stranger.post(path, json=body)
        assert response.status_code == 404 and response.json() == {"error": "not_found"}, path
    anonymous = client(app_url)
    assert anonymous.get(base).status_code == 401
    assert anonymous.get(base).json() == {"error": "unauthenticated"}
    follower = client(app_url, tomas)
    for path in designer_reads[:2] + [f"{base}/versions/2"]:
        assert follower.get(path).status_code == 404, path
    assert follower.get(f"{base}/versions/1").status_code == 200
    assert follower.post(f"{base}/cells", json={"cells": []}).status_code == 404
    seen = follower.get(f"{base}/notes").json()["notes"]
    assert [n["text"] for n in seen] == [note], "a tester reads only their own notes"
    assert follower.get(f"{base}/follow").json()["rows"][0]["notes"] == 1
    designer = client(app_url, asha)
    assert {n["text"] for n in designer.get(f"{base}/notes").json()["notes"]} == {note, other}
    assert designer.get(f"{base}/counter").status_code == 404, "a designer calling a tester route is not found"
    assert client(app_url, lena).post(f"{base}/co-designers", json={"email": sam.email}).status_code == 404
    with opened(browser, app_url, sam, f"/patterns/{pid}") as page:
        expect(role(page, "heading", "Not found.")).to_be_visible()
        page.goto(url(app_url, f"/follow/{pid}"))
        expect(role(page, "heading", "Not found.")).to_be_visible()
        page.goto(url(app_url, f"/patterns/{pid}/compare"))
        expect(role(page, "heading", "Not found.")).to_be_visible()
    with opened(browser, app_url, tomas, f"/patterns/{pid}") as page:
        expect(role(page, "heading", "Not found.")).to_be_visible()


def test_wf_notes_versions_note_mail(browser, app_url, mail):
    asha, tomas, mei = person("Asha Verma"), person("Tomas Reed"), person("Mei Lin")
    name = tag("Note cowl")
    rows = {"1": K4, "2": K4}
    pid = seed(app_url, asha, tomas, mei, name=name, width=4, height=2, castOn=4, rows=rows,
               versions=[snap(rows, 4, 2, 4)], testers=[tester(tomas, row=2), tester(mei, row=2)])
    limit = limits(app_url)["noteMaxChars"]
    note = tag("Row 2 feels tight")
    subject = f"Note on row 2 of {name}"
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, tomas, f"/follow/{pid}") as follow, \
            opened(browser, app_url, mei, f"/follow/{pid}") as other:
        expect(grid(page)).to_be_visible()
        live(page)
        expect(status_of(other, "Row counter")).to_have_text("Row 2 of 2")
        live(other)
        expect(status_of(follow, "Row counter")).to_have_text("Row 2 of 2")
        click(button_of(follow, "Add note"))
        dialog = role(follow, "dialog", "Add note")
        box = role(dialog, "textbox", "Note for row 2")
        click(button_of(dialog, "Save note"))
        expect(alert_of(dialog, "Note error")).to_have_text("Write a note first.")
        fill(box, "x" * (limit + 1))
        click(button_of(dialog, "Save note"))
        expect(alert_of(dialog, "Note error")).to_have_text(f"A note can be {limit} characters at most.")
        assert [m for m in mail.messages(0, 0.2) if m.get("Subject") == subject] == [], "a refused note sends no mail"
        fill(box, note)
        click(button_of(dialog, "Save note"))
        expect(status_of(follow, "Note status")).to_have_text(f"Note saved on row {2}.")
        see_items(follow, "Your notes", [f"Row 2: {note}"])
        see_items(page, "Row notes", [f"Row 2: {note} ({tomas.name})"])
        poll_eq(lambda: snapshot(page)["rows"]["2"]["notes"], "1", "data-notes reached the designer's chart row")
        poll_eq(lambda: tester_cells(page, tomas.name), [1, 2, 1], "the Notes cell followed the note")
        assert items(list_of(other, "Your notes")) == [], "no other tester sees it"
        assert snapshot(other)["rows"]["2"]["notes"] in (None, "0")
    message = mails(mail, asha.email, subject)[0]
    assert note in text(message)
    c = client(app_url, tomas)
    exact = c.post(f"/api/patterns/{pid}/notes", json={"row": 1, "text": "y" * limit})
    assert exact.status_code == 201
    mails(mail, asha.email, f"Note on row 1 of {name}")
    assert client(app_url, mei).get(f"/api/patterns/{pid}/notes").json()["notes"] == []


def test_wf_notes_versions_new_version_notice(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    old = {"1": K4, "2": K4, "3": K4}
    pid = seed(app_url, asha, tomas, width=4, height=3, castOn=4, rows={"1": K4, "2": "p p p p", "3": K4},
               versions=[snap(old, 4, 3, 4)],
               testers=[tester(tomas, row=2, notes=[{"row": 2, "text": "old note"}])])
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, tomas, f"/follow/{pid}") as follow:
        expect(grid(page)).to_be_visible()
        expect(status_of(follow, "Version")).to_have_text("Version 1")
        live(follow)
        mark(follow)
        before = snapshot(follow)["cells"]
        next_row = button_of(follow, "Next row")
        next_row.focus()
        save_version_ui(page, "swapped row 2")
        expect(status_of(follow, "Version")).to_have_text(newer(2, 1))
        expect(status_of(follow, "Row counter")).to_have_text("Row 2 of 3")
        expect(next_row).to_be_focused()
        assert snapshot(follow)["cells"] == before, "the notice leaves the chart as it was"
        expect(role(follow, "region", "Current row")).to_contain_text(f"Row {2} (WS): p{4}. ({4} sts)")
        not_reloaded(follow)
        see_items(follow, "Your notes", ["Row 2: old note"])
        click(button_of(follow, "Move to version 2"))
        expect(status_of(follow, "Version")).to_have_text("Version 2")
        expect(status_of(follow, "Row counter")).to_have_text("Row 2 of 3")
        expect(role(follow, "region", "Current row")).to_contain_text("Row 2 (WS): k4. (4 sts)")
        see_items(follow, "Your notes", [])
        poll_eq(lambda: tester_cells(page, tomas.name), [2, 2, 1], "the table shows the new version")
    c = client(app_url, tomas)
    assert c.get(f"/api/patterns/{pid}/counter").json() == {"row": 2, "version": 2, "total": 3}
    assert client(app_url, asha).get(f"/api/patterns/{pid}/notes").json()["notes"][0]["text"] == "old note"


def test_wf_notes_versions_move_phone(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    long_rows = {"1": K4, "2": K4, "3": K4}
    short_rows = {"1": K4, "2": K4}
    pid = seed(app_url, asha, tomas, width=4, height=2, castOn=4, rows=short_rows,
               versions=[snap(long_rows, 4, 3, 4), snap(short_rows, 4, 2, 4)], testers=[tester(tomas, row=3)])
    c = client(app_url, tomas)
    refused = c.post(f"/api/patterns/{pid}/follow", json={"version": 1})
    assert refused.status_code == 422 and refused.json()["field"] == "version"
    assert refused.json()["message"] == "Only the latest version can be followed."
    with opened(browser, app_url, tomas, f"/follow/{pid}", size=PHONE, reduced="reduce") as page, \
            opened(browser, app_url, tomas, f"/follow/{pid}") as second:
        version = status_of(page, "Version")
        expect(version).to_have_text(newer(2, 1))
        expect(status_of(second, "Row counter")).to_have_text("Row 3 of 3")
        live(page)
        live(second)
        assert not page.evaluate(ANY_MOTION_JS), "under reduced motion no data-motion ever appears"
        cdp = touch_on(page)
        gesture(cdp, [center(button_of(page, "Move to version 2"))])
        expect(version).to_have_text(f"Version {2}. Row {3} is not in this version.")
        expect(status_of(page, "Row counter")).to_have_text("Row 2 of 2")
        expect(status_of(second, "Row counter")).to_have_text("Row 2 of 2")
        expect(role(second, "region", "Current row")).to_contain_text(f"Row {2} (WS): p{4}. ({4} sts)")
        swipe(cdp, role(page, "region", "Current row"), SWIPE_PX + 20)
        expect(status_of(second, "Row counter")).to_have_text("Row 1 of 2")
    assert c.get(f"/api/patterns/{pid}/counter").json() == {"row": 1, "version": 2, "total": 2}


def test_wf_notes_versions_keyboard_note(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4, "2": K4, "3": K4}
    pid = seed(app_url, asha, tomas, width=4, height=3, castOn=4, rows=rows, versions=[snap(rows, 4, 3, 4)],
               testers=[tester(tomas)])
    note = tag("Purl side runs on")
    with opened(browser, app_url, tomas, f"/follow/{pid}") as page:
        counter = status_of(page, "Row counter")
        expect(counter).to_have_text("Row 1 of 3")
        live(page)
        opener = button_of(page, "Add note")
        opener.focus()
        key(page, "n")
        expect(counter).to_have_text("Row 2 of 3")
        expect(status_of(page, "Row announcement")).to_have_text(f"Row {2} (WS): p{4}. ({4} sts)")
        key(page, "n")
        expect(counter).to_have_text("Row 3 of 3")
        key(page, "p")
        expect(counter).to_have_text("Row 2 of 3")
        expect(opener).to_be_focused()
        key(page, "Space")
        dialog = role(page, "dialog", "Add note")
        expect(dialog).to_be_visible()
        expect(counter).to_have_text("Row 2 of 3")
        box = role(dialog, "textbox", "Note for row 2")
        if not box.evaluate(FOCUSED_JS):
            tab_to(page, box)
        page.keyboard.type("np")
        expect(box).to_have_value("np")
        expect(counter).to_have_text("Row 2 of 3")
        key(page, "Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        assert client(app_url, tomas).get(f"/api/patterns/{pid}/notes").json()["notes"] == [], "Escape saves nothing"
        key(page, "Enter")
        expect(dialog).to_be_visible()
        if not box.evaluate(FOCUSED_JS):
            tab_to(page, box)
        box.fill("")
        page.keyboard.type(note)
        tab_to(page, button_of(dialog, "Save note"))
        key(page, "Enter")
        expect(status_of(page, "Note status")).to_have_text(f"Note saved on row {2}.")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        see_items(page, "Your notes", [f"Row 2: {note}"])
    assert [n["text"] for n in client(app_url, asha).get(f"/api/patterns/{pid}/notes").json()["notes"]] == [note]


def test_wf_notes_versions_move_by_keyboard(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    old = {"1": K4, "2": K4, "3": K4}
    new = {"1": K4, "2": "p p p p", "3": K4}
    pid = seed(app_url, asha, tomas, width=4, height=3, castOn=4, rows=new,
               versions=[snap(old, 4, 3, 4), snap(new, 4, 3, 4)], testers=[tester(tomas, row=2)])
    line = "Row 2 (WS): k4. (4 sts)"

    def pinned(page: Page) -> list[tuple[int, int]]:
        return sorted((c["row"], c["col"]) for c in snapshot(page)["cells"] if c["current"] == "true")

    with opened(browser, app_url, tomas, f"/follow/{pid}") as page, \
            opened(browser, app_url, tomas, f"/follow/{pid}") as second:
        expect(status_of(page, "Version")).to_have_text(newer(2, 1))
        expect(status_of(second, "Row counter")).to_have_text("Row 2 of 3")
        live(page)
        live(second)
        mark(second)
        tab_to(page, button_of(page, "Move to version 2"))
        key(page, "Enter")
        expect(status_of(page, "Version")).to_have_text("Version 2")
        expect(role(page, "region", "Current row")).to_contain_text(line)
        expect(status_of(second, "Version")).to_have_text("Version 2")
        expect(role(second, "region", "Current row")).to_contain_text(line)
        poll_eq(lambda: pinned(second), [(2, col) for col in range(1, 5)], "the current row is pinned on the other device")
        button_of(page, "Next row").focus()
        key(page, "n")
        expect(status_of(second, "Row counter")).to_have_text("Row 3 of 3")
        poll_eq(lambda: pinned(second), [(3, col) for col in range(1, 5)], "the pin moved with the counter")
        not_reloaded(second)


def test_compare_versions(browser, app_url):
    asha = person("Asha Verma")
    v1 = snap({"1": "k k"}, 2, 1, 2)
    v2 = snap({"1": "k p k", "2": "k k k"}, 3, 2, 2)
    pid = seed(app_url, asha, width=3, height=2, castOn=2, rows=v2["rows"], versions=[v1, v2])
    c = client(app_url, asha)
    summary = "1 row changed, 1 row added, 0 rows removed, 2 cells changed. Stitches 2 to 3."
    body = c.get(f"/api/patterns/{pid}/compare", params={"a": 1, "b": 2}).json()
    assert body["summary"] == summary
    assert (body["rowsChanged"], body["rowsAdded"], body["rowsRemoved"], body["cellsChanged"]) == (1, 1, 0, 2)
    assert (body["stitchesFrom"], body["stitchesTo"]) == (2, 3)
    back = c.get(f"/api/patterns/{pid}/compare", params={"a": 2, "b": 1}).json()
    assert (back["rowsChanged"], back["rowsAdded"], back["rowsRemoved"], back["cellsChanged"]) == (1, 0, 1, 2)
    assert (back["stitchesFrom"], back["stitchesTo"]) == (3, 2)
    assert back["summary"].startswith("1 row changed")
    assert back["summary"].endswith(f"Stitches {back['stitchesFrom']} to {back['stitchesTo']}.")
    assert c.get(f"/api/patterns/{pid}/compare", params={"a": 1, "b": 9}).status_code == 404

    def marks(page: Page, row: int) -> list[str]:
        return [x["diff"] for x in row_cells(page, row, "Compare chart")]

    with opened(browser, app_url, asha, f"/patterns/{pid}/compare?a=1&b=2") as page:
        expect(status_of(page, "Compare result")).to_have_text(summary)
        assert marks(page, 1) == ["same", "changed", "added"]
        assert marks(page, 2) == ["added", "added", "added"]
        select(role(page, "combobox", "From version"), "Version 2")
        select(role(page, "combobox", "To version"), "Version 1")
        click(button_of(page, "Compare"))
        expect(status_of(page, "Compare result")).to_have_text(back["summary"])
        assert f"a={2}" in page.url and f"b={1}" in page.url
        assert marks(page, 1) == ["same", "changed"]
        page.goto(url(app_url, f"/patterns/{pid}/compare"))
        expect(status_of(page, "Compare result")).to_have_text(summary)
        page.goto(url(app_url, f"/patterns/{pid}/compare?a=1&b=9"))
        expect(role(page, "heading", "Not found.")).to_be_visible()
        blank = seed(app_url, asha)
        page.goto(url(app_url, f"/patterns/{blank}/compare"))
        expect(button_of(page, "Compare")).to_be_disabled()


def test_wf_compare_sheet_restore(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    box = {"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 1, "toRow": 1, "times": 2}
    v1 = snap({"1": "k p p k k k"}, 6, 1, 8, colourRows={"1": "A B B A A A"}, repeats=[box])
    v2 = snap({"1": K4, "2": K4, "3": K4}, 4, 3, 4)
    pid = seed(app_url, asha, lena, width=4, height=3, castOn=4, rows=v2["rows"], colours=[MAIN, CONTRAST],
               coDesigners=[lena.email], versions=[v1, v2])
    c = client(app_url, asha)
    first = c.get(f"/api/patterns/{pid}/versions/1").json()
    second = c.get(f"/api/patterns/{pid}/versions/2").json()
    rev_before = cell_of(read(c, pid), 1, 1)["rev"]
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        live(peer)
        mark(peer)
        go(page, 1, 1)
        key(page, "p")
        see_row(page, 1, "p k k k")
        rev_before = cell_of(read(c, pid), 1, 2)["rev"]
        opener = button_of(page, "Restore version 1")
        opener.focus()
        key(page, "Enter")
        dialog = role(page, "dialog", "Restore version 1?")
        expect(dialog).to_contain_text("This makes version 3 from version 1. Nothing is deleted.")
        tab_to(page, button_of(dialog, "Restore"))
        key(page, "Enter")
        expect(status_of(page, "Chart sync")).to_have_text(f"Restored version {1} as version {3}.")
        see_row(peer, 1, "k p p k k k")
        poll_eq(lambda: snapshot(peer)["colcount"], "6", "the restore reached the peer live")
        not_reloaded(peer)
        see_row(page, 1, "k p p k k k")
        cursor_cell(page).focus()
        key(page, "Control+z")
        expect(status_of(page, "Chart sync")).to_have_text(f"Restored version {1} as version {3}.")
    third = c.get(f"/api/patterns/{pid}/versions/3").json()
    assert plain_cells(third) == plain_cells(first)
    assert third["colours"] == first["colours"] and third["repeats"] == first["repeats"]
    assert [r["text"] for r in third["rows"]] == [r["text"] for r in first["rows"]]
    assert (third["width"], third["height"], third["castOn"]) == (first["width"], first["height"], first["castOn"])
    assert third["note"] == "Restored from version 1"
    kept = c.get(f"/api/patterns/{pid}/versions/2").json()
    assert plain_cells(kept) == plain_cells(second), "nothing later is destroyed"
    assert [v["version"] for v in c.get(f"/api/patterns/{pid}/versions").json()["versions"]] == [1, 2, 3]
    working = read(c, pid)
    assert plain_cells(working) == plain_cells(first) and cell_of(working, 1, 2)["rev"] == rev_before + 1


def test_wf_compare_sheet_publish_public(browser, app_url):
    asha = person("Asha Verma")
    name = tag("Public swatch")
    rows = {"1": K4, "2": K4}
    pid = seed(app_url, asha, name=name, width=4, height=2, castOn=4, rows=rows, versions=[snap(rows, 4, 2, 4)])
    anonymous = client(app_url)
    assert anonymous.get(f"/api/public/{pid}").status_code == 404
    assert anonymous.get(f"/api/patterns/{pid}/sheet.pdf").status_code == 404
    with opened(browser, app_url, None, f"/p/{pid}") as visitor:
        expect(role(visitor, "heading", "Not found.")).to_be_visible()
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        click(button_of(page, "Publish"))
        expect(status_of(page, "Chart sync")).to_have_text("Published version 1.")
    c = client(app_url, asha)
    put(c, pid, 1, 1, "p")
    with opened(browser, app_url, None, f"/p/{pid}") as visitor:
        expect(grid(visitor)).to_be_visible()
        see_line(visitor, 1, "Row 1 (RS): k4. (4 sts)")
        expect(button_of(visitor, "Pin row 1")).to_be_visible()
        expect(button_of(visitor, "Edit row 1")).to_have_count(0)
        link = role(visitor, "link", "Download sheet")
        expect(link).to_be_visible()
        sheet = httpx.get(url(app_url, "") + "/" + link.get_attribute("href").split("://")[-1].split("/", 1)[-1].lstrip("/"),
                          timeout=HTTP_SECONDS)
        assert sheet.status_code == 200 and sheet.content.startswith(b"%PDF")
        assert name in pdf_text(sheet.content)
    public = anonymous.get(f"/api/public/{pid}").json()
    assert public["version"] == 1 and by_row(public)[1]["text"] == "Row 1 (RS): k4. (4 sts)"
    assert "notes" not in public["rows"][0]
    assert c.post(f"/api/patterns/{pid}/versions", json={"note": ""}).json()["version"] == 2
    assert anonymous.get(f"/api/public/{pid}").json()["version"] == 1, "a new version waits for a publish"
    assert c.post(f"/api/patterns/{pid}/publish", json={}).json() == {"state": "published", "version": 2}
    assert anonymous.get(f"/api/public/{pid}").json()["version"] == 2


def sheet_pages(data: bytes) -> list[str]:
    return [p for p in (" ".join(part.split()) for part in pdf_text(data).split("\f")) if p]


def test_pdf_sheet(app_url):
    asha = person("Asha Verma")
    name = tag("Sheet scarf")
    rows = {str(n): K4 for n in range(1, 25)}
    rows["3"] = "p p p p"
    rows["5"] = "yo k2tog k k"
    pid = seed(app_url, asha, name=name, width=4, height=24, castOn=4, rows=rows,
               versions=[snap(rows, 4, 24, 4)], published=True)
    c = client(app_url, asha)
    edited = by_row(put(c, pid, 1, 1, "p"))[1]["text"]
    per_page = limits(app_url)["sheetLinesPerPage"]
    response = httpx.get(url(app_url, f"/api/patterns/{pid}/sheet.pdf"), timeout=HTTP_SECONDS)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF")
    pages = sheet_pages(response.content)
    public = httpx.get(url(app_url, f"/api/public/{pid}"), timeout=HTTP_SECONDS).json()
    written_lines = [r["text"] for r in public["rows"]]
    assert written_lines[0] == "Row 1 (RS): k4. (4 sts)"
    total = 1 + math.ceil(len(written_lines) / per_page)
    assert len(pages) == total
    cursor = 0
    for line in (name, "Version 1", "Cast on 4 stitches", "Chart", "Key", "k Knit", "p Purl", "yo Yarn over",
                 "k2tog Knit two together"):
        found = pages[0].find(line, cursor)
        assert found >= 0, f"page 1 lacks {line!r} in order: {pages[0]!r}"
        cursor = found + len(line)
    assert "No stitch" not in pages[0] and "Slip slip knit" not in pages[0]
    for number, page_text in enumerate(pages, start=1):
        assert page_text.endswith(f"{name} - page {number} of {total}")
    for index, page_text in enumerate(pages[1:]):
        assert page_text.startswith("Instructions")
        chunk = written_lines[index * per_page:(index + 1) * per_page]
        cursor = 0
        for line in chunk:
            found = page_text.find(line, cursor)
            assert found >= 0, f"instruction page {index + 2} lacks {line!r}"
            cursor = found + len(line)
    assert edited not in " ".join(pages), "later edits never reach the sheet"
    terms = seed(app_url, asha, name=tag("Tiny"), craft="crochet", terms="uk", width=1, height=1, castOn=1,
                 rows={"1": "sc"}, versions=[snap({"1": "sc"}, 1, 1, 1)], published=True)
    tiny = sheet_pages(httpx.get(url(app_url, f"/api/patterns/{terms}/sheet.pdf"), timeout=HTTP_SECONDS).content)
    assert len(tiny) == 2
    assert "Cast on 1 stitch" in tiny[0] and "dc Single crochet" in tiny[0]
    assert "Row 1 (RS): dc1. (1 st)" in tiny[1]


def test_wf_compare_sheet_private_copies(browser, app_url):
    asha, tomas = person("Asha Verma"), person(tag("Tomas"))
    note = tag("private gauge note")
    rows = {"1": K4, "2": K4}
    pid = seed(app_url, asha, tomas, width=4, height=2, castOn=4, rows=rows, versions=[snap(rows, 4, 2, 4)],
               published=True, testers=[tester(tomas, notes=[{"row": 1, "text": note}])])
    designer = client(app_url, asha).get(f"/api/patterns/{pid}/notes").json()["notes"]
    assert [n["text"] for n in designer] == [note], "the note exists, so its absence below means something"
    public = httpx.get(url(app_url, f"/api/public/{pid}"), timeout=HTTP_SECONDS)
    pdf = httpx.get(url(app_url, f"/api/patterns/{pid}/sheet.pdf"), timeout=HTTP_SECONDS)
    with opened(browser, app_url, None, f"/p/{pid}") as visitor:
        expect(grid(visitor)).to_be_visible()
        see_line(visitor, 1, "Row 1 (RS): k4. (4 sts)")
        html = visitor.content()
        assert all(r["notes"] is None for r in snapshot(visitor)["rows"].values()), "no count of notes"
    extracted = pdf_text(pdf.content)
    for secret in (tomas.name, tomas.email, note):
        assert secret not in public.text and secret not in html and secret not in extracted
        assert secret.encode() not in pdf.content
    assert all("notes" not in row for row in public.json()["rows"])


def test_wf_compare_sheet_keyboard_phone(browser, app_url):
    asha = person("Asha Verma")
    v1 = snap({"1": K4, "2": K4}, 4, 2, 4)
    v2 = snap({"1": "k p k k", "2": K4}, 4, 2, 4)
    v3 = snap({"1": "k p p k", "2": K4, "3": K4}, 4, 3, 4)
    pid = seed(app_url, asha, width=4, height=3, castOn=4, rows=v3["rows"], versions=[v1, v2, v3])
    first = "1 row changed, 0 rows added, 0 rows removed, 1 cell changed. Stitches 4 to 4."
    second = "1 row changed, 1 row added, 0 rows removed, 1 cell changed. Stitches 4 to 4."
    with opened(browser, app_url, asha, f"/patterns/{pid}/compare?a=1&b=2") as page:
        result = status_of(page, "Compare result")
        expect(result).to_have_text(first)
        select(role(page, "combobox", "From version"), "Version 2")
        select(role(page, "combobox", "To version"), "Version 3")
        tab_to(page, button_of(page, "Compare"))
        key(page, "Enter")
        expect(result).to_have_text(second)
        poll_eq(lambda: [x["diff"] for x in row_cells(page, 1, "Compare chart")], ["same", "same", "changed", "same"],
                "the row's changed cell is marked")
        poll_eq(lambda: [x["diff"] for x in row_cells(page, 3, "Compare chart")], ["added"] * 4, "the new row is marked")
    with opened(browser, app_url, asha, f"/patterns/{pid}/compare?a=2&b=3", size=PHONE) as page:
        expect(status_of(page, "Compare result")).to_have_text(second)
        assert layout_name(page) == "phone"
        layout(page)


def test_wf_compare_sheet_restore_cancel(browser, app_url):
    asha = person("Asha Verma")
    v1 = snap({"1": RIB, "2": RIB}, 10, 2, 10)
    v2 = snap({"1": K10, "2": K10}, 10, 2, 10)
    pid = seed(app_url, asha, width=10, height=2, castOn=10, rows=v2["rows"], versions=[v1, v2])
    c = client(app_url, asha)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        opener = button_of(page, "Restore version 1")
        opener.focus()
        key(page, "Enter")
        dialog = role(page, "dialog", "Restore version 1?")
        expect(dialog).to_be_visible()
        key(page, "Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        key(page, "Enter")
        expect(dialog).to_be_visible()
        tab_to(page, button_of(dialog, "Cancel"))
        key(page, "Enter")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        assert [v["version"] for v in c.get(f"/api/patterns/{pid}/versions").json()["versions"]] == [1, 2]
        see_row(page, 1, K10)
        key(page, "Enter")
        expect(dialog).to_be_visible()
        tab_to(page, button_of(dialog, "Restore"))
        key(page, "Enter")
        expect(status_of(page, "Chart sync")).to_have_text(f"Restored version {1} as version {3}.")
        see_line(page, 1, "Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)")
        see_line(page, 2, "Row 2 (WS): *p2, k2; rep from * to last 2 sts, p2. (10 sts)")
        expect(role(page, "table", "Versions")).to_contain_text("Restored from version 1")
        park_pointer(page)
        tokens(page, 2).first.focus()
        see_lifted(page, [(2, 1), (2, 2), (2, 5), (2, 6)])


def test_wf_compare_sheet_restore_while_typing(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    old = snap({"1": K4, "2": "p p p p"}, 4, 2, 4)
    new = snap({"1": K4, "2": K4}, 4, 2, 4)
    pid = seed(app_url, asha, lena, width=4, height=2, castOn=4, rows=new["rows"], coDesigners=[lena.email],
               versions=[old, new])
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page, \
            opened(browser, app_url, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        live(peer)
        box = open_edit(peer, 2)
        fill(box, f"p{4}")
        opener = button_of(page, "Restore version 1")
        opener.focus()
        key(page, "Enter")
        dialog = role(page, "dialog", "Restore version 1?")
        tab_to(page, button_of(dialog, "Restore"))
        key(page, "Enter")
        see_row(peer, 2, "p p p p")
        expect(box).to_have_value(f"p{4}")
        expect(box).to_be_focused()
        expect(status_of(peer, "Row changed")).to_have_text(f"Row {2} changed while you were typing.")


NOTICE = "Live updates are off. Your work is still saved."


def test_wf_live_outage_notice(browser, app_url):
    base = down()
    health = httpx.get(url(base, "/api/health"), timeout=HTTP_SECONDS)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4}
    pid = seed(base, asha, tomas, width=4, height=1, castOn=4, rows=rows, versions=[snap(rows, 4, 1, 4)],
               testers=[tester(tomas)])
    assert Postgres("_valkey_down").tables(), "the outage copy saves to its own Postgres"
    with opened(browser, base, asha, "/") as page:
        for path in ("/", "/settings", f"/patterns/{pid}", f"/patterns/{pid}/compare"):
            page.goto(url(base, path))
            expect(status_of(page, "Live")).to_have_text(NOTICE)
    with opened(browser, base, tomas, f"/follow/{pid}") as page:
        expect(status_of(page, "Live")).to_have_text(NOTICE)
        expect(grid(page)).to_be_visible()
    other = person("Asha Verma")
    primary = seed(app_url, other, width=4, height=1, castOn=4, rows=rows)
    with opened(browser, app_url, other, f"/patterns/{primary}") as page:
        expect(grid(page)).to_be_visible()
        live(page)
        expect(status_of(page, "Live")).to_have_text("Live")


def test_wf_live_outage_saved_work(browser):
    base = down()
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(base, asha, lena, width=4, height=2, castOn=4, rows={"1": K4, "2": K4}, coDesigners=[lena.email])
    c = client(base, asha)
    with opened(browser, base, asha, f"/patterns/{pid}") as page, \
            opened(browser, base, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        go(page, 1, 4)
        key(page, "p")
        see_row(page, 1, "k k k p")
        apply_text(page, 2, "k2, p2.")
        expect(status_of(page, "Chart sync")).to_have_text(f"Row {2} updated: {2} cells changed.")
        save_version_ui(page, "offline")
        expect(status_of(page, "Chart sync")).to_have_text("Version 1 saved.")
        assert stitches(peer, 1) == K4, "another open page gets nothing until it reloads"
        assert lines(peer)["2"] == f"Row {2} (WS): p{4}. ({4} sts)"
        rev = cell_of(read(c, pid), 1, 1)["rev"]
        started = time.monotonic()
        answer = c.post(f"/api/patterns/{pid}/cells", json={"opId": idempotency_key(), "cells": [
            {"row": 1, "col": 1, "stitch": "p", "colour": "A", "rev": rev}]})
        assert answer.status_code == 200
        assert time.monotonic() - started < SAVE_MAX_SECONDS, "no save waits on Valkey for more than one second"
        reload(peer)
        see_row(peer, 1, "p k k p")
        reload(page)
        see_row(page, 1, "p k k p")
        expect(status_of(page, "Live")).to_have_text(NOTICE)
    versions = c.get(f"/api/patterns/{pid}/versions").json()["versions"]
    assert [v["version"] for v in versions] == [1]
    saved = c.get(f"/api/patterns/{pid}/versions/1").json()
    assert row_of(saved, 1) == "k k k p"


def test_wf_live_outage_counter_notes(browser, mail, valkey):
    base = down()
    asha, lena, tomas = person("Asha Verma"), person("Lena Holt"), person("Tomas Reed")
    name = tag("Outage shawl")
    rows = {"1": K4, "2": K4, "3": K4}
    pid = seed(base, asha, lena, tomas, name=name, width=4, height=3, castOn=4, rows=rows,
               coDesigners=[lena.email], versions=[snap(rows, 4, 3, 4)], testers=[tester(tomas)])
    c = client(base, tomas)
    note = tag("outage note")
    with opened(browser, base, tomas, f"/follow/{pid}") as first, \
            opened(browser, base, tomas, f"/follow/{pid}") as second:
        expect(status_of(first, "Row counter")).to_have_text("Row 1 of 3")
        expect(status_of(second, "Row counter")).to_have_text("Row 1 of 3")
        click(button_of(first, "Next row"))
        expect(status_of(first, "Row counter")).to_have_text("Row 2 of 3")
        assert text_of(status_of(second, "Row counter")) == "Row 1 of 3", "the other device waits for a reload"
        stale = c.post(f"/api/patterns/{pid}/counter", json={"from": 1, "step": 1, "stepId": idempotency_key()})
        assert stale.status_code == 200 and stale.json() == {"row": 2}, "the same from-row rule holds on Postgres"
        reload(second)
        expect(status_of(second, "Row counter")).to_have_text("Row 2 of 3")
        click(button_of(first, "Add note"))
        dialog = role(first, "dialog", "Add note")
        fill(role(dialog, "textbox", "Note for row 2"), note)
        click(button_of(dialog, "Save note"))
        expect(status_of(first, "Note status")).to_have_text(f"Note saved on row {2}.")
    message = mails(mail, asha.email, f"Note on row 2 of {name}")[0]
    assert note in text(message)
    assert [n["text"] for n in client(base, asha).get(f"/api/patterns/{pid}/notes").json()["notes"]] == [note]

    with opened(browser, base, asha, f"/patterns/{pid}") as page, \
            opened(browser, base, lena, f"/patterns/{pid}") as peer:
        expect(grid(page)).to_be_visible()
        expect(grid(peer)).to_be_visible()
        see_items(page, "Here now", [f"{asha.name} (you)"])
        see_items(peer, "Here now", [f"{lena.name} (you)"])


def test_wf_live_outage_keyboard_checks(browser):
    base = down()
    asha = person("Asha Verma")
    pid = seed(base, asha, width=4, height=2, castOn=4, rows={"1": K4, "2": K4})
    with opened(browser, base, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        expect(status_of(page, "Live")).to_have_text(NOTICE)
        go(page, 2, 1)
        key(page, "Delete")
        expect(status_of(page, "Row check")).to_have_text(needs(2, 4, 3))
        see_items(page, "Row errors", [needs(2, 4, 3)])
        key(page, "Control+z")
        expect(status_of(page, "Row check")).to_have_text("Row 2 is correct.")
        see_row(page, 2, K4)
        see_items(page, "Row errors", ["All rows check out."])
        go(page, 2, 1)
        key(page, "p")
        expect(status_of(page, "Cell announcement")).to_have_text(f"Placed Purl at row {2}, column {1}.")
        assert at(page) == (2, 2), "on a wrong-side row the cursor moves right"
        see_line(page, 2, "Row 2 (WS): k1, p3. (4 sts)")
        box = open_edit(page, 1)
        fill(box, "k2t.")
        key(page, "Enter")
        expect(alert_of(page, "Text error")).to_have_text('Row 1, position 1: unknown stitch "k2t".')
        expect(box).to_have_attribute("aria-invalid", "true")
        expect(box).to_be_focused()
        assert caret(box) == 0, "the caret moves to the failing position"
        key(page, "Escape")
        see_row(page, 1, K4)
        expect(status_of(page, "Live")).to_have_text(NOTICE)


def test_wf_live_outage_phone_follow(browser):
    base = down()
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4, "2": K4, "3": K4}
    pid = seed(base, asha, tomas, width=4, height=3, castOn=4, rows=rows, versions=[snap(rows, 4, 3, 4)],
               testers=[tester(tomas)])
    with opened(browser, base, tomas, f"/follow/{pid}", size=PHONE) as page:
        counter = status_of(page, "Row counter")
        expect(counter).to_have_text("Row 1 of 3")
        expect(status_of(page, "Live")).to_have_text(NOTICE)
        cdp = touch_on(page)
        gesture(cdp, [center(button_of(page, "Next row"))])
        expect(counter).to_have_text("Row 2 of 3")
        expect(role(page, "region", "Current row")).to_contain_text(f"Row {2} (WS): p{4}. ({4} sts)")
        swipe(cdp, role(page, "region", "Current row"), -(SWIPE_PX + 20))
        expect(counter).to_have_text("Row 3 of 3")
        assert client(base, asha).post(f"/api/patterns/{pid}/versions", json={"note": ""}).status_code == 201
        expect(status_of(page, "Version")).to_have_text("Version 1")
        layout(page)
        reload(page)
        expect(status_of(page, "Version")).to_have_text(newer(2, 1))
        expect(counter).to_have_text("Row 3 of 3")
        expect(status_of(page, "Live")).to_have_text(NOTICE)
    assert client(base, tomas).get(f"/api/patterns/{pid}/counter").json()["row"] == 3


def test_wf_cross_cutting_account_journey(browser, app_url, mail):
    who = person("Mei Lin")
    taken = person("Sam Ortiz")
    seed(app_url, taken)
    with opened(browser, app_url, None, "/signup") as page:
        name_box, email_box = role(page, "textbox", "Name"), role(page, "textbox", "Email")
        password_box = page.get_by_label("Password", exact=True)
        error = alert_of(page, "Sign-up error")
        create = button_of(page, "Create account")
        fill(email_box, who.email)
        fill(password_box, who.password)
        click(create)
        expect(error).to_have_text("Enter your name.")
        expect(name_box).to_have_attribute("aria-invalid", "true")
        fill(name_box, who.name)
        fill(email_box, "not-an-email")
        click(create)
        expect(error).to_have_text("Enter a valid email address.")
        fill(email_box, who.email)
        fill(password_box, "short")
        click(create)
        expect(error).to_have_text("A password needs at least 10 characters.")
        fill(email_box, taken.email)
        fill(password_box, who.password)
        click(create)
        expect(error).to_have_text("That email already has an account.")
        fill(email_box, who.email)
        click(create)
        expect(page.get_by_text("Check your email to verify your account.", exact=True)).to_be_visible()
        message = mails(mail, who.email, "Verify your Twinrow email")[0]
        found = re.findall(r"/verify\?token=([^\s\"'<>]+)", text(message))
        assert len(set(found)) == 1, "the mail carries one verification link"
        page.goto(url(app_url, "/signin"))
        fill(role(page, "textbox", "Email"), who.email)
        fill(page.get_by_label("Password", exact=True), who.password)
        click(button_of(page, "Sign in"))
        expect(alert_of(page, "Sign-in error")).to_have_text("Verify your email first.")
        page.goto(url(app_url, f"/verify?token={found[0]}"))
        expect(page.get_by_text("Your email is verified.")).to_be_visible()
        expect(role(page, "link", "Sign in")).to_be_visible()
        page.goto(url(app_url, "/settings"))
        page.wait_for_url("**/signin**")
        page.goto(url(app_url, "/signin?next=/settings"))
        fill(role(page, "textbox", "Email"), who.email)
        fill(page.get_by_label("Password", exact=True), OTHER_PASSWORD)
        click(button_of(page, "Sign in"))
        expect(alert_of(page, "Sign-in error")).to_have_text("Email or password is incorrect.")
        fill(page.get_by_label("Password", exact=True), who.password)
        click(button_of(page, "Sign in"))
        page.wait_for_url(url(app_url, "/settings"))
        cookies = page.context.cookies()
        assert cookies and all(cookie["httpOnly"] for cookie in cookies), "session cookies are HTTP-only"
    c = client(app_url)
    assert c.post("/api/signup", json={"name": "X", "email": taken.email, "password": PASSWORD}).status_code == 409
    assert c.post("/api/verify", json={"token": "unknown-token"}).status_code == 404
    signed = client(app_url, who)
    me = signed.get("/api/me").json()
    assert (me["name"], me["email"], me["reduceMotion"]) == (who.name, who.email, False)
    assert signed.delete("/api/session").status_code == 204
    assert signed.get("/api/me").status_code == 401


def test_settings_profile_and_password(browser, app_url):
    who = person("Tomas Reed")
    seed(app_url, who)
    with opened(browser, app_url, who, "/settings") as page:
        error = alert_of(page, "Settings error")
        name_box = role(page, "textbox", "Name")
        fill(name_box, "")
        click(button_of(page, "Save profile"))
        expect(error).to_have_text("Enter your name.")
        expect(name_box).to_have_attribute("aria-invalid", "true")
        fill(name_box, "Tomas R")
        click(button_of(page, "Save profile"))
        expect(status_of(page, "Settings")).to_have_text("Saved.")
        current = page.get_by_label("Current password", exact=True)
        new = page.get_by_label("New password", exact=True)
        fill(current, OTHER_PASSWORD)
        fill(new, OTHER_PASSWORD)
        click(button_of(page, "Change password"))
        expect(error).to_have_text("That password is not right.")
        expect(current).to_have_attribute("aria-invalid", "true")
        fill(current, who.password)
        fill(new, "short")
        click(button_of(page, "Change password"))
        expect(error).to_have_text("A password needs at least 10 characters.")
        expect(new).to_have_attribute("aria-invalid", "true")
        fill(new, OTHER_PASSWORD)
        click(button_of(page, "Change password"))
        c = client(app_url)
        poll(lambda: c.post("/api/session", json={"email": who.email, "password": OTHER_PASSWORD}).status_code == 200,
             "the new password signs in")
    assert c.get("/api/me").json()["name"] == "Tomas R"
    refused = client(app_url).post("/api/session", json={"email": who.email, "password": who.password})
    assert refused.status_code == 401 and refused.json()["error"] == "invalid_credentials"


def clusters(values: list[float], gap: float = 40) -> int:
    ordered = sorted(values)
    return 1 + sum(1 for a, b in zip(ordered, ordered[1:]) if b - a > gap)


def test_published_layout_widths(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4, "2": K4}
    pid = seed(app_url, asha, tomas, width=4, height=2, castOn=4, rows=rows, versions=[snap(rows, 4, 2, 4)],
               testers=[tester(tomas)])
    edges = ((BELOW_TABLET, "phone"), (TABLET_START, "tablet"), (TABLET_END, "tablet"), (DESKTOP_START, "desktop"))
    with opened(browser, app_url, tomas, f"/follow/{pid}") as follow:
        expect(grid(follow)).to_be_visible()
        for width, name in edges:
            resize(follow, width, 800)
            poll_eq(lambda: layout_name(follow), name, f"follow data-layout at {width}")
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        for width, name in edges:
            resize(page, width, 800)
            poll_eq(lambda: layout_name(page), name, f"designer data-layout at {width}")
        resize(page, *DESKTOP)
        poll_eq(lambda: layout_name(page), "desktop", "desktop at 1280")
        layout(page)
        expect(role(page, "tablist", "Pattern")).to_have_count(0)
        chart, words = box_of(role(page, "region", "Chart")), box_of(role(page, "region", "Instructions"))
        assert chart["right"] <= words["left"] + 1 and abs(chart["top"] - words["top"]) < chart["height"]
        panels = [list_of(page, n) for n in ("Repeats", "Colour key", "Row errors", "Colour warnings", "Here now", "Row notes")]
        boxes = [box_of(p) for p in panels]
        assert all(b["top"] >= min(chart["bottom"], words["bottom"]) - 1 for b in boxes), "side panels sit beneath"
        assert clusters([b["left"] for b in boxes]) == 2, "side panels run in two columns"
        for size, name in ((TABLET, "tablet"), (PHONE, "phone")):
            resize(page, *size)
            poll_eq(lambda: layout_name(page), name, f"data-layout at {size[0]}")
            layout(page)
            tabs = role(page, "tablist", "Pattern")
            assert [t.strip() for t in tabs.get_by_role("tab").all_text_contents()] == ["Chart", "Instructions", "Testers"]
            chart_tab = role(page, "tab", "Chart")
            expect(chart_tab).to_have_attribute("aria-selected", "true")
            expect(role(page, "region", "Chart")).to_be_visible()
            expect(role(page, "region", "Instructions")).to_have_count(0)
            chart_tab.focus()
            key(page, "ArrowRight")
            expect(role(page, "tab", "Instructions")).to_be_focused()
            key(page, "Enter")
            expect(role(page, "tab", "Instructions")).to_have_attribute("aria-selected", "true")
            expect(role(page, "region", "Instructions")).to_be_visible()
            expect(status_of(page, "Row check")).to_have_count(1)
            click(role(role(page, "navigation", "Workspace"), "link", "Versions"))
            expect(role(page, "tab", "Testers")).to_have_attribute("aria-selected", "true")
            expect(role(page, "table", "Testers")).to_be_visible()
            click(role(page, "tab", "Chart"))
            if name == "phone":
                rect = box_of(cell(page, 1, 1))
                assert rect["width"] >= MIN_CELL_PX and rect["height"] >= MIN_CELL_PX


def test_shell_top_bar_rail_and_stacked_nav(browser, app_url):
    asha = person("Asha Verma")
    rows = {str(n): K4 for n in range(1, 31)}
    pid = seed(app_url, asha, width=4, height=30, castOn=4, rows=rows)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        toggle, new = button_of(page, "Toggle workspace rail"), button_of(page, "New pattern")
        rail = role(page, "navigation", "Workspace")
        for name in ("Your patterns", "Settings", "Chart", "Instructions", "Versions", "Testers", "Row notes"):
            expect(role(rail, "link", name)).to_be_visible()
        left, right = box_of(toggle), box_of(new)
        assert left["left"] < right["left"] and right["right"] > DESKTOP[0] * 0.9
        assert right["height"] >= MIN_TARGET_PX
        assert style(new, "box-shadow")["box-shadow"] == "none"
        rail_box = box_of(rail)
        assert RAIL_MIN_PX <= rail_box["width"] <= RAIL_MAX_PX, "the rail is about a fifth of the window"
        assert rail_box["right"] <= box_of(role(page, "region", "Chart"))["left"]
        page.evaluate("window.scrollTo(0, 300)")
        assert abs(box_of(toggle)["top"] - left["top"]) < 1, "the top bar stays pinned during scroll"
        page.evaluate("window.scrollTo(0, 0)")
        expect(toggle).to_have_attribute("aria-expanded", "true")
        click(toggle)
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(rail).to_have_count(0)
        click(toggle)
        expect(toggle).to_have_attribute("aria-expanded", "true")
        expect(rail).to_be_visible()
        page.goto(url(app_url, "/settings"))
        active, rest = role(rail, "link", "Settings"), role(rail, "link", "Your patterns")
        expect(active).to_be_visible()
        fill_js = ("e => { const c = getComputedStyle(e).backgroundColor;"
                   " return c === 'rgba(0, 0, 0, 0)' ? getComputedStyle(e.parentElement).backgroundColor : c; }")
        assert active.evaluate(fill_js) != rest.evaluate(fill_js), "the active row sits on its pill"
        assert box_of(active)["right"] >= box_of(rail)["right"] - 1, "the pill runs flush to the rail's right edge"
        page.goto(url(app_url, f"/patterns/{pid}"))
        expect(grid(page)).to_be_visible()
        resize(page, *PHONE)
        poll_eq(lambda: layout_name(page), "phone", "phone layout")
        expect(button_of(page, "New pattern")).to_have_count(0)
        stacked = box_of(rail)
        assert stacked["top"] >= box_of(role(page, "region", "Chart"))["bottom"], "the stacked nav follows the panel"
        assert stacked["width"] >= PHONE[0] * 0.8, "the stacked nav is a full-width block"
        click(toggle)
        expect(rail).to_have_count(0)
        click(toggle)
        expect(rail).to_be_visible()


LEAD_JS = """t => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0
  && e.textContent.trim() === t && !e.closest('[role=status],[role=alert],[role=list],ul,ol,button')
  && Number(getComputedStyle(e).fontWeight) >= 600).length"""
PANEL_JS = """e => { for (let p = e; p; p = p.parentElement) { const s = getComputedStyle(p);
  if (parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderTopLeftRadius) > 0) return true; } return false; }"""


def test_lead_line_panel_and_tiles(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=2, castOn=4, rows={"1": K4, "2": K4})
    path = f"/patterns/{pid}"
    with opened(browser, app_url, asha, "/settings") as page:
        expect(role(page, "heading", "Not found.")).to_have_count(0)
        with held(page, "**/api/patterns/*") as pending:
            page.goto(url(app_url, path))
            poll(lambda: page.evaluate(LEAD_JS, "Loading..."), "the lead line reads Loading... while data loads")
            getattr(pending, "release", pending)()
        expect(grid(page)).to_be_visible()
        poll(lambda: page.evaluate(LEAD_JS, "All rows check out."), "the lead line reads All rows check out.")
        assert role(page, "region", "Chart").evaluate(PANEL_JS), "the chart panel has a hairline, rounded border"
        tile = by_data_row(written(page), 1).get_by_text("RS", exact=True)
        expect(tile).to_be_visible()
        rect = box_of(tile)
        assert rect["height"] >= rect["width"], "the tile is slightly upright"
        ground = page.evaluate("getComputedStyle(document.body).backgroundColor")
        fill_of = tile.evaluate("e => { const c = getComputedStyle(e).backgroundColor;"
                                " return c === 'rgba(0, 0, 0, 0)' ? getComputedStyle(e.parentElement).backgroundColor : c; }")
        assert fill_of != ground, "the stitch family tile is a pastel tint on the ground"
        expect(by_data_row(written(page), 2).get_by_text("WS", exact=True)).to_be_visible()
        go(page, 2, 1)
        key(page, "Delete")
        poll(lambda: page.evaluate(LEAD_JS, "Row 2 needs 4 stitches, found 3."), "the lead line carries the first error")
        for size, name in ((TABLET, "tablet"), (PHONE, "phone")):
            resize(page, *size)
            poll_eq(lambda: layout_name(page), name, "data-layout follows the published width")
            layout(page)
        resize(page, *DESKTOP)
        page.route("**/api/patterns/*", lambda route: route.abort())
        page.goto(url(app_url, path))
        poll(lambda: page.evaluate(LEAD_JS, "This page could not be loaded. Reload to try again."),
             "the lead line reports a failed data call")


def test_patterns_home_cards(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4}
    first, second = tag("Card one"), tag("Card two")
    followed = seed(app_url, asha, tomas, name=first, width=4, height=1, castOn=4, rows=rows,
                    versions=[snap(rows, 4, 1, 4)], testers=[tester(tomas)])
    seed(app_url, asha, name=second)
    with opened(browser, app_url, asha, "/") as page:
        expect(role(page, "heading", "Your patterns")).to_be_visible()
        links = [role(list_of(page, "Patterns"), "link", name) for name in (first, second)]
        expect(links[0]).to_be_visible()
        assert links[0].get_attribute("href").endswith(f"/patterns/{followed}")
        for size, columns in ((DESKTOP, 2), (TABLET, 2), (PHONE, 1)):
            resize(page, *size)
            poll_eq(lambda: clusters([box_of(link)["left"] for link in links]), columns, f"card columns at {size[0]}")
        expect(button_of(page, "New pattern")).to_have_count(1)
        expect(button_of(page, "New pattern")).to_be_visible()
    with opened(browser, app_url, tomas, "/") as page:
        link = role(list_of(page, "Patterns"), "link", first)
        expect(link).to_be_visible()
        assert link.get_attribute("href").endswith(f"/follow/{followed}")


def test_twin_lift_and_pins(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=10, height=2, castOn=10, rows={"1": RIB, "2": "k k k k k ns k k k k"})
    first = [(1, 10), (1, 9), (1, 6), (1, 5)]
    second = [(1, 8), (1, 7), (1, 4), (1, 3)]
    tail = [(1, 2), (1, 1)]
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(tokens(page, 1).first).to_be_visible()
        park_pointer(page)
        rest_pin = decode(capture(button_of(page, "Pin row 1")))
        target, neighbour = cell(page, 1, 9), cell(page, 1, 8)
        center(target)
        rest, beside = target.evaluate(TOP_JS), neighbour.evaluate(TOP_JS)
        hover(page, target)
        see_lifted(page, first)
        expect(tokens(page, 1).first).to_have_attribute("data-lift", "twin")
        assert abs(target.evaluate(TOP_JS) - (rest - 2)) < 0.01, "a lifted cell moves up by exactly 2 px"
        assert neighbour.evaluate(TOP_JS) == beside, "neighbours stay still"
        assert animations(target) == [], "the lift is an instant step"
        park_pointer(page)
        see_lifted(page, [])
        assert target.evaluate(TOP_JS) == rest
        hover(page, cell(page, 2, 6))
        see_lifted(page, [])
        tokens(page, 1).nth(1).focus()
        park_pointer(page)
        see_lifted(page, second)
        hover(page, cell(page, 1, 10))
        see_lifted(page, first)
        park_pointer(page)
        see_lifted(page, second)
        key(page, "Enter")
        expect(tokens(page, 1).nth(1)).to_have_attribute("aria-current", "true")
        go(page, 1, 1)
        key(page, "Enter")
        poll_eq(lambda: sorted((c["row"], c["col"]) for c in snapshot(page)["cells"] if c["current"] == "true"),
                sorted(tail), "a new pin replaces the old")
        expect(tokens(page, 1).nth(1)).not_to_have_attribute("aria-current", "true")
        role(page, "radio", "Paint").focus()
        see_lifted(page, tail)
        pin = button_of(page, "Pin row 1")
        before, x = rest_pin, pin.evaluate(LEFT_JS)
        click(pin)
        park_pointer(page)
        everything = [(1, col) for col in range(1, 11)]
        poll_eq(lambda: sorted((c["row"], c["col"]) for c in snapshot(page)["cells"] if c["current"] == "true"),
                everything, "Pin row pins all the row's stitch cells")
        see_lifted(page, everything)
        expect(by_data_row(written(page), 1).locator("[data-line]")).to_have_attribute("aria-current", "true")
        assert difference(before, decode(capture(pin))) > 0, "the row pin arrow turns accent when pinned"
        assert pin.evaluate(LEFT_JS) == x, "the row pin arrow never slides"
        click(pin)
        park_pointer(page)
        poll_eq(lambda: [c for c in snapshot(page)["cells"] if c["current"]], [], "pinning again clears the pin")


@pytest.mark.parametrize("source", ["system", "checkbox"], ids=["system", "checkbox"])
def test_reduced_motion_keeps_states(browser, app_url, source):
    asha, lena, tomas = person("Asha Verma"), person("Lena Holt"), person("Tomas Reed")
    rows = {"1": K10, "2": K10, "3": K10}
    pid = seed(app_url, asha, lena, tomas, width=10, height=3, castOn=10, rows=rows, coDesigners=[lena.email],
               versions=[snap(rows, 10, 3, 10)], testers=[tester(tomas)])
    reduced = "reduce" if source == "system" else "no-preference"
    designer, follower = client(app_url, asha), client(app_url, tomas)
    if source == "checkbox":
        assert follower.patch("/api/me", json={"reduceMotion": True}).status_code == 200
    with opened(browser, app_url, asha, "/settings", reduced=reduced) as page:
        if source == "checkbox":
            check(role(page, "checkbox", "Reduce motion"))
            click(button_of(page, "Save profile"))
            poll(lambda: designer.get("/api/me").json()["reduceMotion"], "the setting saved")
        page.goto(url(app_url, f"/patterns/{pid}"))
        expect(grid(page)).to_be_visible()
        live(page)
        park_pointer(page)
        target = cell(page, 1, 5)
        center(target)
        rest = target.evaluate(TOP_JS)
        hover(page, target)
        poll(lambda: lifted(page), "data-lift stays under reduced motion")
        assert target.evaluate(TOP_JS) == rest, "no 2 px shift occurs"
        park_pointer(page)
        put(client(app_url, lena), pid, 3, 2, "p")
        poll_eq(lambda: row_cells(page, 3)[1]["outline"], "static", "the flash became a static outline")
        assert not page.evaluate(ANY_MOTION_JS), "no data-motion ever appears"
        advance(page, OUTLINE_MS - 100)
        assert row_cells(page, 3)[1]["outline"] == "static"
        advance(page, 200)
        poll_eq(lambda: row_cells(page, 3)[1]["outline"], None, "the outline lasts 2 seconds")
    with opened(browser, app_url, tomas, f"/follow/{pid}", reduced=reduced) as page:
        expect(status_of(page, "Row counter")).to_have_text("Row 1 of 3")
        live(page)
        click(button_of(page, "Next row"))
        expect(status_of(page, "Row counter")).to_have_text("Row 2 of 3")
        poll_eq(lambda: snapshot(page)["rows"]["2"]["follow"], "current", "the highlight jumps at once")
        assert not page.evaluate(ANY_MOTION_JS)
        assert designer.post(f"/api/patterns/{pid}/versions", json={"note": ""}).status_code == 201
        expect(status_of(page, "Version")).to_have_text(newer(2, 1))
        assert not page.evaluate(ANY_MOTION_JS), "the notice appears in place"


def test_named_motion(browser, app_url):
    asha, lena, tomas = person("Asha Verma"), person("Lena Holt"), person("Tomas Reed")
    rows = {"1": K10, "2": K10, "3": K10}
    pid = seed(app_url, asha, lena, tomas, width=10, height=3, castOn=10, rows=rows, coDesigners=[lena.email],
               versions=[snap(rows, 10, 3, 10)], testers=[tester(tomas)])
    row_ms = limits(app_url)["rowMotionMs"]
    peer = client(app_url, lena)
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        live(page)
        park_pointer(page)
        go(page, 3, 10)
        key(page, "p")
        see_row(page, 3, "k k k k k k k k k p")
        assert animations(grid(page)) == [] and not page.evaluate(ANY_MOTION_JS), "the chart never animates"

        def flash() -> str | None:
            return row_cells(page, 1)[1]["motion"]

        put(peer, pid, 1, 2, "p")
        poll_eq(flash, "flash", "a peer's cell flashes")
        advance(page, FLASH_MS - 200)
        assert flash() == "flash"
        put(peer, pid, 1, 2, "yo")
        see_row(page, 1, "k yo k k k k k k k k")
        advance(page, FLASH_MS - 200)
        assert flash() == "flash", "a new flash restarts its time"
        advance(page, 300)
        poll_eq(flash, None, "the flash ends after 0.6 seconds")
    with opened(browser, app_url, tomas, f"/follow/{pid}") as page:
        expect(status_of(page, "Row counter")).to_have_text("Row 1 of 3")
        live(page)
        click(button_of(page, "Next row"))
        expect(grid(page)).to_have_attribute("data-motion", "row")
        advance(page, row_ms - 50)
        expect(grid(page)).to_have_attribute("data-motion", "row")
        advance(page, 100)
        expect(grid(page)).not_to_have_attribute("data-motion", "row")
        version = status_of(page, "Version")
        assert client(app_url, asha).post(f"/api/patterns/{pid}/versions", json={"note": ""}).status_code == 201
        expect(version).to_have_text(newer(2, 1))
        expect(version).to_have_attribute("data-motion", "notice")
        advance(page, NOTICE_SLIDE_MS - 150)
        expect(version).to_have_attribute("data-motion", "notice")
        advance(page, 300)
        expect(version).not_to_have_attribute("data-motion", "notice")


def test_follow_scroll_middle_third(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    height = 40
    rows = {str(n): K4 for n in range(1, height + 1)}
    pid = seed(app_url, asha, tomas, width=4, height=height, castOn=4, rows=rows,
               versions=[snap(rows, 4, height, 4)], testers=[tester(tomas, row=2)])
    c = client(app_url, tomas)
    with opened(browser, app_url, tomas, f"/follow/{pid}") as page:
        counter = status_of(page, "Row counter")
        expect(counter).to_have_text(f"Row 2 of {height}")
        live(page)
        click(button_of(page, "Previous row"))
        expect(counter).to_have_text(f"Row 1 of {height}")
        poll(lambda: 1 / 3 <= grid(page).evaluate(MIDDLE_JS) <= 2 / 3, "row 1 reached the middle third before time advanced")
        for row in range(1, height):
            assert c.post(f"/api/patterns/{pid}/counter",
                          json={"from": row, "step": 1, "stepId": idempotency_key()}).json()["row"] == row + 1
        expect(counter).to_have_text(f"Row {height} of {height}")
        poll(lambda: 1 / 3 <= grid(page).evaluate(MIDDLE_JS) <= 2 / 3, "the top row reached the middle third")


def trap_check(page: Page, opener: Locator, name: str) -> None:
    opener.focus()
    key(page, "Enter")
    dialog = role(page, "dialog", name)
    expect(dialog).to_be_visible()
    for press in ("Tab", "Shift+Tab"):
        for _ in range(WRAP_PRESSES):
            key(page, press)
            assert page.evaluate(IN_DIALOG_JS), f"{press} left dialog {name}"
    key(page, "Escape")
    expect(dialog).to_have_count(0)
    expect(opener).to_be_focused()


def test_dialogs_keep_focus(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4}
    pid = seed(app_url, asha, tomas, width=4, height=1, castOn=4, rows=rows, versions=[snap(rows, 4, 1, 4)],
               testers=[tester(tomas)])
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        trap_check(page, button_of(page, "New pattern"), "New pattern")
        trap_check(page, button_of(page, "Save version"), "Save version")
        trap_check(page, button_of(page, "Restore version 1"), "Restore version 1?")
    with opened(browser, app_url, tomas, f"/follow/{pid}") as page:
        expect(status_of(page, "Row counter")).to_have_text("Row 1 of 1")
        trap_check(page, button_of(page, "Add note"), "Add note")


def test_new_pattern_chart_kind_cards(browser, app_url):
    asha = person("Asha Verma")
    seed(app_url, asha)
    limit = limits(app_url)["maxChartRows"]
    name = tag("Fair isle yoke")
    with opened(browser, app_url, asha, "/settings") as page:
        click(button_of(page, "New pattern"))
        dialog = role(page, "dialog", "New pattern")
        key(page, "Escape")
        expect(dialog).to_have_count(0)
        expect(button_of(page, "New pattern")).to_be_focused()
        click(button_of(page, "New pattern"))
        group = role(dialog, "radiogroup", "Chart kind")
        kinds = ["Flat knitting", "Knitting in the round", "Stranded in the round", "Crochet rows in US terms",
                 "Crochet rows in UK terms", "Tapestry crochet"]
        for kind in kinds:
            card = role(group, "radio", kind)
            expect(card).to_have_count(1)
            height = card.evaluate("e => (e.closest('label') || e).getBoundingClientRect().height")
            assert height >= MIN_TARGET_PX, "a chart-kind card is at least a tap target tall"
        expect(role(group, "radio", "Flat knitting")).to_be_checked()
        for field in ("Rows", "Columns", "Cast on"):
            expect(role(dialog, "spinbutton", field)).to_have_value("24")
        pattern_name = role(dialog, "textbox", "Pattern name")
        error = alert_of(dialog, "Pattern error")
        click(button_of(dialog, "Create"))
        expect(error).to_have_text("Give the pattern a name.")
        expect(pattern_name).to_have_attribute("aria-invalid", "true")
        fill(pattern_name, name)
        fill(role(dialog, "spinbutton", "Rows"), str(limit + 1))
        click(button_of(dialog, "Create"))
        expect(error).to_have_text(f"Rows must be from 1 to {limit}.")
        fill(role(dialog, "spinbutton", "Rows"), "6")
        check(role(group, "radio", "Stranded in the round"))
        click(button_of(dialog, "Create"))
        c = client(app_url, asha)
        made = poll(lambda: [p for p in c.get("/api/patterns").json()["patterns"] if p["name"] == name],
                    "Create made the pattern")[0]
    data = read(c, made["id"])
    assert (data["craft"], data["mode"], data["height"], data["width"], data["castOn"]) == ("knit", "round", 6, 24, 24)
    assert [(x["letter"], x["name"]) for x in data["colours"]] == [("A", "Main"), ("B", "Contrast")]


def test_focus_always_visible(browser, app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=4, height=1, castOn=4, rows={"1": K4})
    properties = ("outline-style", "outline-width", "box-shadow", "border-top-color", "background-color")
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        for target in (cursor_cell(page), tokens(page, 1).first, button_of(page, "Mirror")):
            rest, focused = state_styles(target, *properties, state="focus")
            assert rest != focused, f"focus shows no change on {target}"


@pytest.mark.parametrize("size", [PHONE, TABLET, DESKTOP], ids=["375", "768", "1280"])
def test_accessibility_checks(browser, app_url, size):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4, "2": K4}
    pid = seed(app_url, asha, tomas, width=4, height=2, castOn=4, rows=rows,
               versions=[snap(rows, 4, 2, 4), snap(rows, 4, 2, 4)], testers=[tester(tomas, version=2)])
    with opened(browser, app_url, asha, f"/patterns/{pid}", size=size) as page:
        expect(grid(page)).to_be_visible()
        axe(page)
        page.goto(url(app_url, f"/patterns/{pid}/compare"))
        expect(grid(page, "Compare chart")).to_be_visible()
        axe(page)
    with opened(browser, app_url, tomas, f"/follow/{pid}", size=size) as page:
        expect(status_of(page, "Row counter")).to_have_text("Row 1 of 2")
        axe(page)


def test_wf_cross_cutting_platform_contract(app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha)
    health = httpx.get(url(app_url, "/api/health"), timeout=HTTP_SECONDS)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    anonymous = client(app_url)
    assert anonymous.post("/api/patterns", json={}).status_code == 401
    plain = anonymous.post("/api/patterns", content="x", headers={"Content-Type": "text/plain"})
    assert plain.status_code == 415 and plain.json() == {"error": "unsupported_media_type"}
    c = client(app_url, asha)
    head, tail = b'{"name":"', b'"}'
    json_type = {"Content-Type": "application/json"}
    fits = head + b"x" * (BODY_LIMIT - len(head) - len(tail)) + tail
    assert c.post("/api/patterns", content=fits, headers=json_type).status_code == 422
    large = c.post("/api/patterns", content=head + b"x" * (BODY_LIMIT - len(head) - len(tail) + 1) + tail, headers=json_type)
    assert large.status_code == 413 and large.json() == {"error": "too_large"}
    broken = c.post("/api/patterns", content=b"{", headers=json_type)
    assert broken.status_code == 422
    assert broken.json() == {"error": "invalid", "field": "body", "message": "The request body is not valid JSON."}
    cap = limits(app_url)
    good = {"name": "Valid", "kind": "Flat knitting", "rows": 2, "columns": 2, "castOn": 2}
    cases = [
        ({"name": ""}, "name", "Give the pattern a name."),
        ({"name": "x" * (NAME_LIMIT + 1)}, "name", "A pattern name can be 120 characters at most."),
        ({"rows": cap["maxChartRows"] + 1}, "rows", f"Rows must be from 1 to {cap['maxChartRows']}."),
        ({"rows": 0}, "rows", f"Rows must be from 1 to {cap['maxChartRows']}."),
        ({"columns": cap["maxChartCols"] + 1}, "columns", f"Columns must be from 1 to {cap['maxChartCols']}."),
        ({"castOn": 0}, "castOn", "Cast on must be at least 1."),
    ]
    for change, field, message in cases:
        refused = c.post("/api/patterns", json={**good, **change})
        assert refused.status_code == 422
        assert refused.json() == {"error": "invalid", "field": field, "message": message}
    assert c.post("/api/patterns", json={**good, "kind": "Pixel art"}).json()["field"] == "kind"
    assert c.post("/api/patterns", json={**good, "name": "x" * NAME_LIMIT}).status_code == 201
    off = c.post(f"/api/patterns/{pid}/cells", json={"opId": idempotency_key(), "cells": [
        {"row": 99, "col": 1, "stitch": "k", "colour": "A", "rev": 0}]})
    assert off.status_code == 422 and off.json()["field"] == "cells"
    note = c.post(f"/api/patterns/{pid}/versions", json={"note": "x" * (VERSION_NOTE_LIMIT + 1)})
    assert note.status_code == 422 and note.json()["message"] == "A version note can be 200 characters at most."
    for headers in ({}, {"X-Grading-Key": "wrong-key"}):
        gate = httpx.post(url(app_url, "/api/grading/setup"), json={"users": [], "patterns": []},
                          headers=headers, timeout=HTTP_SECONDS)
        assert gate.status_code == 404


def test_config_limits(app_url):
    response = httpx.get(url(app_url, "/api/config"), timeout=HTTP_SECONDS)
    assert response.status_code == 200
    body = response.json()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", body["today"]) and body["timeZone"]
    names = {"maxChartRows", "maxChartCols", "maxColours", "coloursPerRow", "maxFloat", "undoDepth", "noteMaxChars",
             "editsPerMinute", "sheetLinesPerPage", "noticeSeconds", "rowMotionMs", "presenceTtlSeconds",
             "inviteTtlHours", "verifyTtlHours"}
    assert set(body["limits"]) == names
    assert all(isinstance(value, int) and value > 0 for value in body["limits"].values())
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=2, height=1, castOn=2, rows={"1": "k k"})
    c = client(app_url, asha)
    assert c.post(f"/api/patterns/{pid}/versions", json={"note": ""}).status_code == 201
    saved = c.get(f"/api/patterns/{pid}/versions").json()["versions"][0]
    assert saved["savedOn"] == body["today"] and saved["stitches"] == 2


def test_replayed_edit(app_url):
    asha = person("Asha Verma")
    pid = seed(app_url, asha, width=2, height=1, castOn=2, rows={"1": "k k"})
    c = client(app_url, asha)
    rev = cell_of(read(c, pid), 1, 1)["rev"]
    op = idempotency_key()
    first = c.post(f"/api/patterns/{pid}/cells", json={"opId": op, "cells": [
        {"row": 1, "col": 1, "stitch": "p", "colour": "A", "rev": rev}]})
    assert first.status_code == 200
    again = c.post(f"/api/patterns/{pid}/cells", json={"opId": op, "cells": [
        {"row": 1, "col": 2, "stitch": "yo", "colour": "A", "rev": rev}]})
    assert again.status_code == 200 and again.json() == first.json()
    data = read(c, pid)
    assert row_of(data, 1) == "p k" and cell_of(data, 1, 1)["rev"] == rev + 1


@pytest.mark.timeout(180)
def test_edit_rate_limit(browser, app_url):
    asha, lena = person("Asha Verma"), person("Lena Holt")
    pid = seed(app_url, asha, lena, width=2, height=1, castOn=2, rows={"1": "k k"}, coDesigners=[lena.email])
    c = client(app_url, asha)
    route = f"/api/patterns/{pid}/cells"
    budget = limits(app_url)["editsPerMinute"] * 3
    deadline = time.monotonic() + RATE_DEADLINE_SECONDS

    def burst(_: int) -> httpx.Response:
        return c.post(route, json={"opId": idempotency_key(), "cells": []})

    limited = None
    sent = 0
    with ThreadPoolExecutor(RATE_WORKERS) as pool:
        while limited is None and sent < budget and time.monotonic() < deadline:
            answers = list(pool.map(burst, range(RATE_BATCH)))
            sent += RATE_BATCH
            limited = next((a for a in answers if a.status_code == 429), None)
    if limited is None:
        pytest.fail("POST /cells never answered 429 past EDITS_PER_MINUTE")
    message = "Too many edits. Wait a moment."
    assert limited.json() == {"error": "rate_limited", "message": message}
    rev = cell_of(read(c, pid), 1, 1)["rev"]
    refused = c.post(route, json={"opId": idempotency_key(), "cells": [
        {"row": 1, "col": 1, "stitch": "p", "colour": "A", "rev": rev}]})
    assert refused.status_code == 429
    assert c.post(f"/api/patterns/{pid}/text", json={"row": 1, "text": "p2."}).status_code == 429
    assert row_of(read(c, pid), 1) == "k k"
    with opened(browser, app_url, asha, f"/patterns/{pid}") as page:
        expect(grid(page)).to_be_visible()
        go(page, 1, 2)
        key(page, "p")
        expect(status_of(page, "Chart sync")).to_have_text(message)
    assert put(client(app_url, lena), pid, 1, 2, "p")["applied"], "the limit is per person"


APP = Path("/app")
SKIPPED_DIRS = {"node_modules", "dist", "build", ".git", "coverage", "public", "vendor"}
ALLOWLIST = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "ISC", "Apache-2.0", "OFL-1.1"}
OTHER_STORES = {"mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "amqplib", "kafkajs",
                "bullmq", "bull", "pg-boss", "memcached", "nats"}
BROWSERS = {"puppeteer", "puppeteer-core", "playwright", "playwright-core", "chromium", "selenium-webdriver",
            "phantomjs", "nightmare"}
SOURCE_SUFFIXES = {".ts", ".tsx", ".json", ".md", ".yaml", ".yml", ".sql", ".html"}


def source_files() -> Iterator[Path]:
    for folder, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in SKIPPED_DIRS]
        for name in files:
            yield Path(folder) / name


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[field], str) and manifest[field] for field in ("install", "build", "serve"))


def test_if_notices_name_everything():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == []
    assert "Manrope" in notices and "Open Sans" in notices


def test_if_open_licences():
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert refused == []


def test_if_only_published_services():
    assert {p.name for p in shipped_packages()} & OTHER_STORES == set()
    assert Postgres().tables()


def test_if_same_origin_pages(browser, app_url):
    asha, tomas = person("Asha Verma"), person("Tomas Reed")
    rows = {"1": K4}
    pid = seed(app_url, asha, tomas, width=4, height=1, castOn=4, rows=rows, versions=[snap(rows, 4, 1, 4)],
               published=True, testers=[tester(tomas)])
    seen: list[str] = []
    with opened(browser, app_url, asha, "/settings") as page:
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/", f"/patterns/{pid}", f"/patterns/{pid}/compare", f"/p/{pid}"):
            page.goto(url(app_url, path))
            page.wait_for_load_state("load")
    assert seen
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert foreign == []


def test_if_typescript_source():
    files = list(source_files())
    assert any(f.suffix in (".ts", ".tsx") for f in files)
    plain = [f for f in files if f.suffix in (".js", ".jsx") and not (f.parent == APP and ".config." in f.name)]
    assert plain == []


def test_if_no_headless_browser():
    assert {p.name for p in shipped_packages()} & BROWSERS == set()


def test_if_no_committed_credentials(valkey):
    assert Postgres().tables()
    assert isinstance(valkey.keys("presence:*"), list)
    secrets = [value for value in (GRADING_KEY, os.environ.get("DATABASE_URL"), os.environ.get("VALKEY_URL")) if value]
    leaked = [str(f) for f in source_files() if f.suffix in SOURCE_SUFFIXES
              and any(secret in f.read_text(errors="ignore") for secret in secrets)]
    assert leaked == []
