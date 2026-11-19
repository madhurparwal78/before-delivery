from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import struct
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    center,
    check,
    click,
    decode,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    pdf_text,
    same_origin,
    select,
    shipped_packages,
    tap,
    until,
)


HTTP_S = 60
WAIT_S = 30
POLL_MS = 500
STEP_MS = 50
PASSWORD = "lozenge-pass-1"

PREVIEW_ROWS = 20
CSV_MAX_BYTES = 20000000
ROW_MAX = 50000
JSON_MAX_BYTES = 1000000
FORMULA_MAX_CHARS = 2000
FORMULA_MAX_DEPTH = 16
MARK_MAX = 2000
QUERY_BUDGET_S = 5.0
FORMULA_CHECK_S = 1.0
ISOLATION_S = 1.0
EVERY_MINUTES = 60
STALE_MS = 7200000
GLIDE_MS = 240
SHEET_OPEN_MS = 240
TAP_MIN_PX = 44
PIXEL_TOL = 1
STAGE_W = 1280
STAGE_H = 800
PNG_W = 1200
PNG_H = 800
ALERT_THRESHOLD = 1400
ORDER_17_SALES = 100
HUGE_FORMULA_CHARS = 999000

PILL = "{caption} on {shelf}"
OPTION = "{field}, {kind}"
EDIT_BUTTON = "Edit {name}"
HIDE_BUTTON = "Hide {name}"
SHOW_BUTTON = "Show {name}"
INBOX_LINK = "Inbox, {n} unread"
GRID_SHEET = "Grid"
DAYS_SHEET = "Days"
MARK_LABEL = "{dims}, {caption} {value}, {shape} {i} of {n}"
LOG_LINE = "{n}. {type}: {name}"
AT_CALC = "AtRegion"
REVENUE = "Revenue"
CATEGORIES = "Categories"
REGIONS = "Regions"
MIX = "Region mix"
PRODUCTS = "Products"
SWAP_SET = "Swap set"
A_FILTER = "A filter"
B_FILTER = "B filter"
GLOW = "Glow"
EXPORT_SHEET = "Sales by region"
INJECT_SHEET = "Inject"
SECRET_SHEET = "Secrets"
COL_NAME = "Name"
COL_AMOUNT = "Amount"
COL_SECRET = "Secret"
FORMULA_CELLS = ["=1+2", "+cmd", "-x", "@sum"]
QUOTED_CELL = 'a,b "q"'
TAB_CELL = "\tTab"
CORS_PREFIX = "access-control-"


def pill_name(caption: str, shelf: str) -> str:
    return PILL.format(caption=caption, shelf=shelf)


def option_name(field_name: str, kind: str) -> str:
    return OPTION.format(field=field_name, kind=kind)


def mark_label(dims: list[str], caption: str, value: str, shape: str, i: int, n: int) -> str:
    return MARK_LABEL.format(dims=", ".join(dims), caption=caption, value=value, shape=shape, i=i, n=n)


def tip(*pairs: tuple[str, str]) -> str:
    return "; ".join(f"{caption}: {value}" for caption, value in pairs)


def mark_el(scope: Locator, mark: str) -> Locator:
    prefix = re.escape(", ".join(mark.split(" | ")) + ", ")
    return scope.get_by_role("button", name=re.compile("^" + prefix)).first

ALLOWLIST = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "BSD", "ISC"}

ORDERS_CSV = (
    "Order,Date,Stockist ID,Product,Category,Units,Sales\n"
    "1,2027-01-04,S1,Moss Sencha,Green,4,120\n"
    "2,2027-01-06,S1,Ember Assam,Black,2,50\n"
    "3,2027-01-11,S2,Moss Sencha,Green,3,90\n"
    "4,2027-01-13,S3,Quiet Mint,Herbal,5,75\n"
    "5,2027-01-20,S3,Ember Assam,Black,6,150\n"
    "6,2027-02-02,S4,Quiet Mint,Herbal,2,30\n"
    "7,2027-02-03,S4,Moss Sencha,Green,1,30\n"
    "8,2027-02-09,S5,Ember Assam,Black,8,200\n"
    "9,2027-02-10,S5,Dusk Blend,Black,4,80\n"
    "10,2027-02-17,S1,Dusk Blend,Black,5,100\n"
    "11,2027-02-24,S2,Quiet Mint,Herbal,6,90\n"
    "12,2027-03-01,S3,Moss Sencha,Green,7,210\n"
    "13,2027-03-03,S5,Quiet Mint,Herbal,3,45\n"
    "14,2027-03-08,S1,Quiet Mint,Herbal,2,30\n"
    "15,2027-03-15,S9,Dusk Blend,Black,1,20\n"
    "16,2027-03-16,S4,Ember Assam,Black,,\n"
)
STOCKISTS_CSV = (
    "Stockist ID,Stockist,Region,Tier,Target\n"
    "S1,Alder Cup,North,Gold,900\n"
    "S2,Birch Kettle,North,Silver,500\n"
    "S3,Cedar Pot,East,Gold,700\n"
    "S4,Dune Mug,South,Silver,400\n"
    "S5,Elm Leaf,West,Gold,600\n"
)
STOCKISTS_DUP_CSV = STOCKISTS_CSV + "S1,Alder Dup,South,Gold,1\n"
ORDER_15_LINE = "15,2027-03-15,S9,Dusk Blend,Black,1,20\n"

UPLOADED = "Uploaded {table}: {n} rows."
OUTAGE_UPLOAD = "Storage is unavailable. Your file was not saved. Try again."
JOIN_NOTICE = "{table} has {n} duplicate keys. First line kept: {key}."
DUP_COLUMN = 'Line 1: duplicate column name "{x}".'
NO_NAME = "Line 1: column {n} has no name."
FIELD_COUNT = "Line {n}: expected {m} fields, found {k}."
UNTERMINATED = "Line {n}: unterminated quote."
TOO_BIG = "File is {n} bytes. The limit is {max}."
TOO_MANY_ROWS = "Table has {n} rows. The limit is {max}."
EMPTY_FILE = "File is empty."
WORK_NOTICE = "This view needs too much work. The limit is {max} steps."
MARK_NOTICE = "This view would draw {n} marks. The limit is {max}. Add a filter or remove a field."
NO_ROWS = "No rows for your account."
HIDDEN_NOTICE = "{field} is hidden."
INBOX_ITEM = "{alert} crossed {threshold}: now {value}."
FRESH = "Fresh, refreshed {t} UTC"
STALE = "Stale, refreshed {t} UTC"
FAILED = "Refresh failed at {f} UTC. Showing data from {s} UTC."

GLIDE_JS = """
(() => {
  window.__lozAnimations = [];
  const original = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = original.call(this, keyframes, options);
    window.__lozAnimations.push({ animation, element: this });
    return animation;
  };
})();
"""


def fresh(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(5)}"


def M(field: str, agg: str = "SUM", table_calc: dict | None = None) -> dict:
    return {"field": field, "agg": agg, "table_calc": table_calc}


def TC(kind: str, using: str, fields: tuple[str, ...] = ()) -> dict:
    return {"kind": kind, "using": using, "fields": list(fields)}


def F(field: str, step: str, values: list | None = None, **extra: Any) -> dict:
    base = {"field": field, "step": step, "values": values or [], "n": None, "by": None,
            "min": None, "max": None, "agg": None, "table_calc": None}
    base.update(extra)
    return base


NOT_NULL = F("Region", "source", ["East", "North", "South", "West"])


def sheet(name: str, **kw: Any) -> dict:
    base = {"name": name, "rows": [], "columns": [], "color": None, "size": None, "label": [],
            "detail": [], "filters": [], "chart": "automatic", "totals": False,
            "reference_lines": [], "trend": False, "sort": {}, "calcs": []}
    base.update(kw)
    return base


def seed(app_url: str, body: dict) -> dict:
    r = httpx.post(f"{app_url}/api/grading/seed", json=body, timeout=HTTP_S)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code}: {r.text}"
    return r.json()


def grading(app_url: str, path: str, body: dict) -> dict:
    r = httpx.post(f"{app_url}/api/grading/{path}", json=body, timeout=HTTP_S)
    assert r.status_code in (200, 201), f"POST /api/grading/{path} answered {r.status_code}: {r.text}"
    return r.json() if r.content else {}


def grading_source(app_url: str, path: str, source_id: str, source_name: str, body: dict) -> None:
    answers = []
    for ref in (source_id, source_name):
        r = httpx.post(f"{app_url}/api/grading/{path}", json={"source": ref, **body}, timeout=HTTP_S)
        if r.status_code == 200:
            return
        answers.append(f"{r.status_code} {r.text}")
    pytest.fail(f"POST /api/grading/{path} accepted neither the source id nor its name: {answers}")


def client(app_url: str, username: str) -> httpx.Client:
    c = httpx.Client(base_url=app_url, timeout=HTTP_S)
    r = c.post("/api/grading/session", json={"username": username})
    assert r.status_code == 200, f"POST /api/grading/session answered {r.status_code}: {r.text}"
    return c


@contextmanager
def storage_down(app_url: str) -> Iterator[None]:
    grading(app_url, "storage", {"down": True})
    try:
        yield
    finally:
        grading(app_url, "storage", {"down": False})


def expect_health(app_url: str, status: str) -> None:
    deadline = time.monotonic() + 5
    got: dict = {}
    while time.monotonic() < deadline:
        got = httpx.get(f"{app_url}/api/health", timeout=HTTP_S).json()
        if got == {"status": status}:
            return
    pytest.fail(f"/api/health never answered {status}; last {got}")


@contextmanager
def exports_paused(app_url: str) -> Iterator[Callable[[], None]]:
    grading(app_url, "exports", {"paused": True})
    resumed = {"done": False}

    def resume() -> None:
        if not resumed["done"]:
            grading(app_url, "exports", {"paused": False})
            resumed["done"] = True

    try:
        yield resume
    finally:
        resume()


@dataclass
class World:
    creator: str
    project: str
    project_id: str
    source: str
    source_id: str
    workbook: str
    workbook_id: str
    sheets: dict[str, str] = field(default_factory=dict)
    dashboards: dict[str, str] = field(default_factory=dict)

    def sheet_path(self, name: str) -> str:
        return f"/workbooks/{self.workbook_id}/sheets/{self.sheets[name]}"


def world(app_url: str, *, sheets: list[dict] = (), dashboards: list[dict] = (), parameters: list[dict] = (),
          sets: list[dict] = (), members: dict[str, str] | None = None, state: str = "published",
          entitlements: dict[str, list[str]] | None = None, source_spec: dict | None = None) -> World:
    creator, project, src, wb = fresh("cr"), fresh("proj"), fresh("src"), fresh("wb")
    members = dict(members or {})
    body: dict[str, Any] = {
        "users": [{"username": u, "password": PASSWORD} for u in (creator, *members)],
        "projects": [{"name": project, "members": {creator: "creator", **members}, "explorers_schedule": False}],
        "sources": [{"name": src, "project": project, **(source_spec or {"sample": "fernhollow"})}],
        "workbooks": [{"name": wb, "project": project, "source": src, "state": state, "certified_by": None,
                       "parameters": list(parameters), "sets": list(sets), "sheets": list(sheets),
                       "dashboards": list(dashboards)}],
    }
    if entitlements is not None:
        body["entitlements"] = [{"source": src, "field": "Region", "users": entitlements}]
    ids = seed(app_url, body)
    return World(
        creator=creator, project=project, project_id=ids["projects"][project], source=src,
        source_id=ids["sources"][src], workbook=wb, workbook_id=ids["workbooks"][wb],
        sheets={s["name"]: ids["sheets"][f"{wb}/{s['name']}"] for s in sheets},
        dashboards={d["name"]: ids["dashboards"][f"{wb}/{d['name']}"] for d in dashboards},
    )


def creator_project(app_url: str, members: dict[str, str] | None = None) -> tuple[str, str, str, httpx.Client]:
    user, project = fresh("cr"), fresh("proj")
    members = dict(members or {})
    ids = seed(app_url, {
        "users": [{"username": u, "password": PASSWORD} for u in (user, *members)],
        "projects": [{"name": project, "members": {user: "creator", **members}, "explorers_schedule": False}],
    })
    return user, project, ids["projects"][project], client(app_url, user)


def upload(c: httpx.Client, project_id: str, source: str, table: str, data: bytes) -> httpx.Response:
    return c.post(f"/api/projects/{project_id}/sources", params={"name": source, "table": table},
                  content=data, headers={"Content-Type": "text/csv"})


def add_table(c: httpx.Client, source_id: str, table: str, data: bytes) -> httpx.Response:
    return c.post(f"/api/sources/{source_id}/tables", params={"table": table}, content=data,
                  headers={"Content-Type": "text/csv"})


def preview(c: httpx.Client, project_id: str, data: bytes) -> httpx.Response:
    return c.post(f"/api/projects/{project_id}/sources/preview", content=data, headers={"Content-Type": "text/csv"})


def project_sources(c: httpx.Client, project_id: str) -> dict[str, str]:
    r = c.get(f"/api/projects/{project_id}")
    assert r.status_code == 200, r.text
    return {s["name"]: s["id"] for s in r.json()["sources"]}


def new_workbook(c: httpx.Client, project_id: str, source_id: str) -> str:
    r = c.post(f"/api/projects/{project_id}/workbooks", json={"name": fresh("wb"), "source": source_id})
    assert r.status_code == 201, f"POST workbooks answered {r.status_code}: {r.text}"
    return r.json()["id"]


def workbook_version(c: httpx.Client, workbook_id: str) -> int:
    r = c.get(f"/api/workbooks/{workbook_id}")
    assert r.status_code == 200, r.text
    return r.json()["version"]


def add_sheet(c: httpx.Client, workbook_id: str, shape: dict) -> str:
    body = {k: v for k, v in shape.items() if k != "calcs"}
    r = c.post(f"/api/workbooks/{workbook_id}/sheets", json=body,
               headers={"If-Match": str(workbook_version(c, workbook_id))})
    assert r.status_code == 201, f"POST sheets answered {r.status_code}: {r.text}"
    return r.json()["id"]


def put_sheet(c: httpx.Client, workbook_id: str, sheet_id: str, shape: dict) -> httpx.Response:
    body = {k: v for k, v in shape.items() if k != "calcs"}
    return c.put(f"/api/sheets/{sheet_id}", json=body, headers={"If-Match": str(workbook_version(c, workbook_id))})


def fields_of(c: httpx.Client, source_id: str) -> dict[str, dict]:
    r = c.get(f"/api/sources/{source_id}")
    assert r.status_code == 200, r.text
    return {f["name"]: f for f in r.json()["fields"]}


def query(c: httpx.Client, sheet_id: str, filters: list | None = None, parameters: dict | None = None,
          sets: dict | None = None, gen: int = 1) -> httpx.Response:
    return c.post(f"/api/sheets/{sheet_id}/query", params={"gen": gen},
                  json={"filters": filters or [], "parameters": parameters or {}, "sets": sets or {}})


def ok_rows(r: httpx.Response) -> list[dict]:
    assert r.status_code == 200, f"query answered {r.status_code}: {r.text}"
    body = r.json()
    names = [col["name"] for col in body["columns"]]
    return [dict(zip(names, row)) for row in body["rows"]]


def by(rows: list[dict], key: str | tuple[str, ...], value: str) -> dict:
    if isinstance(key, tuple):
        return {tuple(r[k] for k in key): r[value] for r in rows}
    return {r[key]: r[value] for r in rows}


def near(actual: Any, expected: float | None, tol: float = 0.005) -> bool:
    if expected is None:
        return actual is None
    return actual is not None and abs(float(actual) - expected) <= tol


def assert_values(actual: dict, expected: dict, what: str) -> None:
    assert set(actual) == set(expected), f"{what}: marks {sorted(map(str, actual))}, expected {sorted(map(str, expected))}"
    for k, v in expected.items():
        assert near(actual[k], v), f"{what}: {k} is {actual[k]}, expected {v}"


def notices_of(r: httpx.Response) -> list[str]:
    body = r.json()
    if r.status_code == 422:
        return [body.get("message", "")]
    assert r.status_code == 200, r.text
    return list(body.get("notices") or [])


def refused(r: httpx.Response, message: str) -> None:
    assert r.status_code == 422, f"expected 422 view_refused, got {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("error") == "view_refused", body
    assert body.get("message") == message, f"View notice {body.get('message')!r}, expected {message!r}"


def either(message: str, template: str, **values: Any) -> None:
    plain = template.format(**values)
    commas = template.format(**{k: f"{v:,}" if isinstance(v, int) else v for k, v in values.items()})
    assert message in (plain, commas), f"message {message!r}, expected {commas!r}"


def message_for(error: dict, full: str) -> None:
    tail = re.sub(r"^Line \d+: ", "", full)
    assert error.get("message") in (full, tail), f"upload error {error}, expected {full!r}"


def sse(response: httpx.Response, deadline: float) -> Iterator[tuple[str, str]]:
    event, data = "message", []
    for line in response.iter_lines():
        if time.monotonic() > deadline:
            return
        if line == "":
            if data:
                yield event, "\n".join(data)
            event, data = "message", []
        elif line.startswith(":"):
            yield "comment", line
        elif line.startswith("event:"):
            event = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data.append(line[len("data:"):].strip())


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def minute(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%d %H:%M")


def png_size(data: bytes) -> tuple[int, int]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "export is not a PNG"
    return struct.unpack(">II", data[16:24])


def wait_export(c: httpx.Client, job_id: str, statuses: set[str]) -> dict:
    deadline = time.monotonic() + WAIT_S
    body: dict = {}
    while time.monotonic() < deadline:
        r = c.get(f"/api/exports/{job_id}")
        assert r.status_code == 200, r.text
        body = r.json()
        if body["status"] in statuses:
            return body
    pytest.fail(f"GET /api/exports/{job_id} never reached {statuses}; last {body}")


def export(c: httpx.Client, kind: str, target: dict, filters: list | None = None) -> dict:
    r = c.post("/api/exports", json={"kind": kind, **target, "filters": filters or [], "parameters": {}})
    assert r.status_code == 202, f"POST /api/exports answered {r.status_code}: {r.text}"
    job = wait_export(c, r.json()["id"], {"ready", "failed"})
    assert job["status"] == "ready", f"export ended {job}"
    return job


@contextmanager
def visit(browser: Browser, app_url: str, username: str | None, path: str, *, width: int = 1280,
          height: int = 800, reduced_motion: str = "no-preference", glide: bool = False) -> Iterator[Page]:
    with open_app(browser, f"{app_url}/api/health", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": width, "height": height})
        if glide:
            page.add_init_script(GLIDE_JS)
        if username:
            r = page.request.post(f"{app_url}/api/grading/session", data={"username": username})
            assert r.status == 200, f"grading session answered {r.status}"
        page.goto(f"{app_url}{path}")
        settle_page(page)
        yield page


def settle_page(page: Page) -> None:
    until(page, "() => document.body !== null && document.body.dataset.pending === '0'", seconds=WAIT_S)


def eventually(page: Page, check_fn: Callable[[], None], failure: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            check_fn()
            return
        except AssertionError as error:
            last = error
            advance(page, STEP_MS)
    pytest.fail(f"{failure}: {last}")


def announced(page: Page, name: str, text: str, scope: Locator | Page | None = None) -> None:
    region = (scope or page).get_by_role("status", name=name, exact=True)
    eventually(page, lambda: expect(region).to_have_text(text, timeout=POLL_MS),
               f'status "{name}" never read {text!r}')


def focused(locator: Locator) -> bool:
    return bool(locator.evaluate("e => e === document.activeElement"))


def holds_focus(locator: Locator) -> bool:
    return bool(locator.evaluate("e => e.contains(document.activeElement)"))


def flush(page: Page, turns: int = 5) -> None:
    for _ in range(turns):
        page.evaluate("() => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); })")


def mark_data(scope: Locator) -> list[dict]:
    return scope.locator("[data-mark]").evaluate_all(
        "els => els.map(e => ({mark: e.getAttribute('data-mark'), dims: e.getAttribute('data-dims'),"
        " measure: e.getAttribute('data-measure'), value: e.getAttribute('data-value'),"
        " color: e.getAttribute('data-color'), pattern: e.getAttribute('data-pattern'),"
        " pressed: e.getAttribute('aria-pressed'), dim: e.getAttribute('data-dim'),"
        " tabindex: e.getAttribute('tabindex'), label: e.getAttribute('aria-label'), role: e.getAttribute('role')}))")


def mark_values(scope: Locator) -> dict[str, str]:
    return {m["mark"]: m["value"] for m in mark_data(scope)}


def expect_marks(page: Page, scope: Locator, expected: dict[str, str], what: str) -> None:
    def probe() -> None:
        assert mark_values(scope) == expected
    eventually(page, probe, f"{what}: marks never read {expected}")


def twin_rows(scope: Locator | Page, sheet_name: str) -> list[dict]:
    grid = scope.get_by_role("grid", name=f"{sheet_name} table", exact=True)
    out = []
    for row in grid.get_by_role("row").all():
        heads = [t.strip() for t in row.get_by_role("rowheader").all_text_contents()]
        cells = row.get_by_role("gridcell")
        values = [cell.get_attribute("data-value") for cell in cells.all()]
        texts = [t.strip() for t in cells.all_text_contents()]
        if heads or values:
            out.append({"heads": heads, "values": values, "texts": texts,
                        "highlight": row.get_attribute("data-highlight")})
    return out


def expect_twin(page: Page, scope: Locator | Page, sheet_name: str, expected: list[tuple[list[str], list[str]]],
                what: str) -> None:
    def probe() -> None:
        rows = [(r["heads"], r["values"]) for r in twin_rows(scope, sheet_name)]
        assert rows == expected, rows
    eventually(page, probe, f"{what}: twin never read {expected}")


def twin_values(scope: Locator | Page, sheet_name: str) -> dict[str, str]:
    return {" | ".join(r["heads"]): r["values"][0] for r in twin_rows(scope, sheet_name) if r["values"]}


def expect_twin_values(page: Page, scope: Locator | Page, sheet_name: str, expected: dict[str, str], what: str) -> None:
    def probe() -> None:
        assert twin_values(scope, sheet_name) == expected
    eventually(page, probe, f"{what}: twin never read {expected}")


def highlights(scope: Locator | Page, sheet_name: str) -> dict[str, str | None]:
    return {" | ".join(r["heads"]): r["highlight"] for r in twin_rows(scope, sheet_name) if r["values"]}


def focus_option(page: Page, label: str) -> Locator:
    fields = page.get_by_role("listbox", name="Fields", exact=True)
    options = fields.get_by_role("option")
    target = fields.get_by_role("option", name=label, exact=True)
    options.first.focus()
    for _ in range(options.count() + 1):
        if focused(target):
            return target
        page.keyboard.press("ArrowDown")
    pytest.fail(f'ArrowDown in listbox "Fields" never reached option "{label}"')


def add_by_keyboard(page: Page, label: str, shelf: str) -> Locator:
    option = focus_option(page, label)
    page.keyboard.press("Enter")
    menu = page.get_by_role("menu", name="Add to shelf", exact=True)
    expect(menu).to_be_visible()
    item = menu.get_by_role("menuitem", name=shelf, exact=True)
    for _ in range(menu.get_by_role("menuitem").count() + 1):
        if focused(item):
            break
        page.keyboard.press("ArrowDown")
    else:
        pytest.fail(f'arrows in menu "Add to shelf" never reached menuitem "{shelf}"')
    page.keyboard.press("Enter")
    return option


def choose_file(page: Page, scope: Locator | Page, name: str, data: bytes) -> None:
    with page.expect_file_chooser() as chooser:
        click(scope.get_by_role("button", name="Choose file", exact=True))
    chooser.value.set_files({"name": name, "mimeType": "text/csv", "buffer": data})


def glide_records(page: Page) -> list[dict]:
    return page.evaluate(
        "() => (window.__lozAnimations || []).map(r => ({id: r.animation.id,"
        " duration: Number(r.animation.effect ? r.animation.effect.getTiming().duration : NaN),"
        " mark: r.element.getAttribute ? r.element.getAttribute('data-mark') : null}))")


def glide_reset(page: Page) -> None:
    page.evaluate("() => { if (window.__lozAnimations) window.__lozAnimations.length = 0; }")


def glide_finish(page: Page) -> None:
    page.evaluate("() => Promise.all((window.__lozAnimations || []).map(r => r.animation.finished.catch(() => null)))")


def query_responses(page: Page) -> list:
    seen: list = []
    page.on("response", lambda r: seen.append(r) if "/api/sheets/" in r.url and "/query" in r.url else None)
    return seen


def last_rows(page: Page, seen: list, sheet_id: str | None = None) -> list[dict]:
    flush(page)
    matching = [r for r in seen if sheet_id is None or f"/api/sheets/{sheet_id}/query" in r.url]
    ok = [r for r in matching if r.status == 200]
    assert ok, "the page sent no successful POST /api/sheets/<id>/query"
    body = ok[-1].json()
    names = [col["name"] for col in body["columns"]]
    return [dict(zip(names, row)) for row in body["rows"]]


def bar_geometry(scope: Locator, mark: str) -> tuple[dict, dict]:
    plot = scope.locator("[data-plot]").first.bounding_box()
    bar = mark_el(scope, mark).bounding_box()
    assert plot and bar, "plot or bar has no box"
    return plot, bar


def test_wf_data_upload_happy(browser: Browser, app_url: str) -> None:
    user, project, project_id, c = creator_project(app_url)
    source = fresh("src")
    extra = "".join(f"{n},2027-03-20,S2,Moss Sencha,Green,1,10\n" for n in range(17, 26))
    orders = (ORDERS_CSV + extra).encode()
    with visit(browser, app_url, user, "/sources/new") as page:
        select(page.get_by_role("combobox", name="Project", exact=True), project)
        fill(page.get_by_role("textbox", name="Source name", exact=True), source)
        fill(page.get_by_role("textbox", name="Table name", exact=True), "orders")
        choose_file(page, page, "orders.csv", orders)
        table = page.get_by_role("table", name="Preview", exact=True)
        eventually(page, lambda: expect(table.get_by_role("row")).to_have_count(PREVIEW_ROWS + 1, timeout=POLL_MS),
                   "table Preview did not show the header and the first 20 rows")
        for name, kind in [("Order", "number"), ("Date", "date"), ("Stockist ID", "text"),
                           ("Product", "text"), ("Units", "number"), ("Sales", "number")]:
            expect(table.get_by_role("columnheader", name=name)).to_have_attribute("data-type", kind)
        click(page.get_by_role("button", name="Upload", exact=True))
        announced(page, "Upload state", UPLOADED.format(table="orders", n=25))

        source_id = project_sources(c, project_id).get(source)
        assert source_id, "the uploaded source is missing from GET /api/projects/<id>"
        stored = c.get(f"/api/sources/{source_id}").json()
        assert [t["name"] for t in stored["tables"]] == ["orders"]
        assert stored["tables"][0]["rows"] == 25
        sha = hashlib.sha256(orders).hexdigest()
        assert S3().get(f"uploads/{source_id}/orders/{sha}.csv") == orders

        page.goto(f"{app_url}/sources/{source_id}")
        settle_page(page)
        opener = page.get_by_role("button", name="Add table", exact=True)
        click(opener)
        dialog = page.get_by_role("dialog", name="Add table", exact=True)
        fill(dialog.get_by_role("textbox", name="Table name", exact=True), "stockists")
        choose_file(page, dialog, "stockists.csv", STOCKISTS_CSV.encode())
        click(dialog.get_by_role("button", name="Upload", exact=True))
        announced(page, "Upload state", UPLOADED.format(table="stockists", n=5), scope=dialog)
        expect(dialog).to_be_visible()
        expect(page.get_by_role("link", name="Download stockists")).to_have_count(1)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()

    tables = {t["name"]: t for t in c.get(f"/api/sources/{source_id}").json()["tables"]}
    assert set(tables) == {"orders", "stockists"}
    assert tables["stockists"]["rows"] == 5
    sha2 = hashlib.sha256(STOCKISTS_CSV.encode()).hexdigest()
    assert S3().get(f"uploads/{source_id}/stockists/{sha2}.csv") == STOCKISTS_CSV.encode()


def test_wf_data_upload_errors(browser: Browser, app_url: str) -> None:
    user, project, project_id, c = creator_project(app_url)
    source = fresh("src")
    bad = b"A,B,A,D\n1,2,3,4\n1,2\n"
    with visit(browser, app_url, user, "/sources/new") as page:
        select(page.get_by_role("combobox", name="Project", exact=True), project)
        fill(page.get_by_role("textbox", name="Source name", exact=True), source)
        fill(page.get_by_role("textbox", name="Table name", exact=True), "orders")
        choose_file(page, page, "bad.csv", bad)
        click(page.get_by_role("button", name="Upload", exact=True))
        errors = page.get_by_role("list", name="Upload errors", exact=True).get_by_role("listitem")
        eventually(page, lambda: expect(errors).to_have_text(
            [DUP_COLUMN.format(x="A"), FIELD_COUNT.format(n=3, m=4, k=2)], timeout=POLL_MS),
            'list "Upload errors" did not list the published errors in line order')
        settle_page(page)
        assert source not in project_sources(c, project_id), "a file with errors was stored"
        assert not [k for k in S3().keys("uploads/") if source in k]

        choose_file(page, page, "orders.csv", ORDERS_CSV.encode())
        click(page.get_by_role("button", name="Upload", exact=True))
        announced(page, "Upload state", UPLOADED.format(table="orders", n=16))
    source_id = project_sources(c, project_id).get(source)
    assert source_id, "the fixed upload did not create the source"
    sha = hashlib.sha256(ORDERS_CSV.encode()).hexdigest()
    assert S3().get(f"uploads/{source_id}/orders/{sha}.csv") == ORDERS_CSV.encode()


def test_type_inference(app_url: str) -> None:
    _, _, project_id, c = creator_project(app_url)
    data = (
        "Flag,Amount,When,Note,Empty\n"
        "YES,-3,2027-01-04,abc,\n"
        "no,4.25,2027-01-03T23:30:00-05:00,12,NA\n"
        "True,NULL,2027-02-01,yes,null\n"
        "false,10,na,1.5e3,\n"
    ).encode()
    expected = {"Flag": "boolean", "Amount": "number", "When": "date", "Note": "text", "Empty": "text"}
    r = preview(c, project_id, data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {col["name"]: col["type"] for col in body["columns"]} == expected
    assert body["errors"] == []
    assert body["row_count"] == 4
    assert body["rows"][2][1] is None and body["rows"][1][4] is None, "NA, NULL and empty cells preview as null"

    r = upload(c, project_id, fresh("src"), "t", data)
    assert r.status_code == 201, r.text
    source_id = r.json()["id"]
    assert {col["name"]: col["type"] for col in r.json()["tables"][0]["columns"]} == expected

    r = c.post(f"/api/sources/{source_id}/refresh")
    assert r.status_code == 200, r.text
    after = c.get(f"/api/sources/{source_id}").json()
    assert {col["name"]: col["type"] for col in after["tables"][0]["columns"]} == expected
    assert {f["name"]: f["type"] for f in after["fields"] if f["name"] in expected} == expected


UPLOAD_ERROR_CASES = ["empty", "header_only", "malformed", "no_name", "oversized", "overlong"]


@pytest.mark.parametrize("case", UPLOAD_ERROR_CASES, ids=UPLOAD_ERROR_CASES)
@pytest.mark.timeout(900)
def test_upload_errors(app_url: str, case: str) -> None:
    _, _, project_id, c = creator_project(app_url)
    boundary: bytes | None = None
    if case == "empty":
        data, expected = b"", [(None, EMPTY_FILE)]
    elif case == "header_only":
        data, expected = b"A,B\n", [(None, EMPTY_FILE)]
    elif case == "malformed":
        data = b'A,B,A,D\n1,"two\nlines",3,4\n1,2\n5,6,7,8\n"x,1,2,3\n'
        expected = [(1, DUP_COLUMN.format(x="A")), (4, FIELD_COUNT.format(n=4, m=4, k=2)),
                    (6, UNTERMINATED.format(n=6))]
    elif case == "no_name":
        data, expected = b"A,,C\n1,2,3\n", [(1, NO_NAME.format(n=2))]
    elif case == "oversized":
        boundary = b"A\n" + (b"x" * 399 + b"\n") * (ROW_MAX - 1) + b"y" * 397 + b"\n"
        assert len(boundary) == CSV_MAX_BYTES
        data = boundary[:-1] + b"y\n"
        expected = [(None, "size")]
    else:
        boundary = b"A\n" + b"1\n" * ROW_MAX
        data = b"A\n" + b"1\n" * (ROW_MAX + 1)
        expected = [(None, "rows")]

    def check_errors(errors: list[dict]) -> None:
        assert len(errors) == len(expected), errors
        for error, (line, message) in zip(errors, expected):
            if message == "size":
                either(error["message"], TOO_BIG, n=CSV_MAX_BYTES + 1, max=CSV_MAX_BYTES)
            elif message == "rows":
                either(error["message"], TOO_MANY_ROWS, n=ROW_MAX + 1, max=ROW_MAX)
            elif message == EMPTY_FILE:
                assert error["message"] == EMPTY_FILE, error
            else:
                assert error["line"] == line, error
                message_for(error, message)

    r = preview(c, project_id, data)
    if case == "oversized":
        assert r.status_code == 413, r.text
        assert r.json()["error"] == "too_large"
        assert r.json()["errors"][0]["line"] is None
    else:
        assert r.status_code == 200, r.text
    check_errors(r.json()["errors"])

    name = fresh("src")
    r = upload(c, project_id, name, "t", data)
    if case == "oversized":
        assert r.status_code == 413, r.text
        assert r.json()["error"] == "too_large"
    else:
        assert r.status_code == 422, r.text
        assert r.json()["error"] == "invalid_csv"
    check_errors(r.json()["errors"])
    assert name not in project_sources(c, project_id), "a rejected file was stored"

    if boundary is not None:
        r = preview(c, project_id, boundary)
        assert r.status_code == 200, f"exactly the limit must be allowed: {r.status_code}"
        assert r.json()["errors"] == []


def test_files_kept_as_submitted(app_url: str) -> None:
    _, _, project_id, c = creator_project(app_url)
    first = 'Name,Amount\r\n"Th\xc3\xa9, ""one""",1\r\nplain ,  2'.encode("latin-1")
    r = upload(c, project_id, fresh("src"), "items", first)
    assert r.status_code == 201, r.text
    source_id = r.json()["id"]
    assert r.json()["version"] == 1
    sha = hashlib.sha256(first).hexdigest()
    assert r.json()["tables"][0]["sha256"] == sha
    assert S3().get(f"uploads/{source_id}/items/{sha}.csv") == first
    download = c.get(f"/api/sources/{source_id}/tables/items/file")
    assert download.status_code == 200
    assert download.content == first

    second = b"Name,Amount\nplain,3\n"
    r = c.put(f"/api/sources/{source_id}/tables/items", content=second, headers={"Content-Type": "text/csv"})
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2
    sha2 = hashlib.sha256(second).hexdigest()
    assert S3().get(f"uploads/{source_id}/items/{sha2}.csv") == second
    assert c.get(f"/api/sources/{source_id}/tables/items/file").content == second


def test_wf_data_upload_outage(browser: Browser, app_url: str) -> None:
    user, project, project_id, c = creator_project(app_url)
    source = fresh("src")
    with visit(browser, app_url, user, "/sources/new") as page:
        select(page.get_by_role("combobox", name="Project", exact=True), project)
        fill(page.get_by_role("textbox", name="Source name", exact=True), source)
        fill(page.get_by_role("textbox", name="Table name", exact=True), "orders")
        choose_file(page, page, "orders.csv", ORDERS_CSV.encode())
        table = page.get_by_role("table", name="Preview", exact=True)
        with storage_down(app_url):
            expect_health(app_url, "unavailable")
            click(page.get_by_role("button", name="Upload", exact=True))
            announced(page, "Upload state", OUTAGE_UPLOAD)
            expect(table.get_by_role("row")).to_have_count(17)
            assert source not in project_sources(c, project_id)
        click(page.get_by_role("button", name="Try again", exact=True))
        announced(page, "Upload state", UPLOADED.format(table="orders", n=16))
    source_id = project_sources(c, project_id).get(source)
    assert source_id, "Try again did not store the source"
    sha = hashlib.sha256(ORDERS_CSV.encode()).hexdigest()
    assert S3().get(f"uploads/{source_id}/orders/{sha}.csv") == ORDERS_CSV.encode()


def test_upload_storage_unreachable(app_url: str) -> None:
    down = os.environ.get("APP_MINIO_DOWN_URL")
    assert down, "APP_MINIO_DOWN_URL is not set for the minio-down outage instance"
    health = httpx.get(f"{down}/api/health", timeout=HTTP_S)
    assert health.status_code == 200 and health.json() == {"status": "unavailable"}
    user, project = fresh("cr"), fresh("proj")
    ids = seed(down, {"users": [{"username": user, "password": PASSWORD}],
                      "projects": [{"name": project, "members": {user: "creator"}, "explorers_schedule": False}]})
    c = client(down, user)
    name = fresh("src")
    r = upload(c, ids["projects"][project], name, "orders", ORDERS_CSV.encode())
    assert r.status_code == 503, r.text
    assert r.json() == {"error": "storage_unavailable"}
    assert name not in project_sources(c, ids["projects"][project])


def test_left_join(app_url: str) -> None:
    _, _, project_id, c = creator_project(app_url)
    r = upload(c, project_id, fresh("src"), "orders", ORDERS_CSV.encode())
    assert r.status_code == 201, r.text
    source_id = r.json()["id"]
    assert add_table(c, source_id, "stockists", STOCKISTS_DUP_CSV.encode()).status_code == 201
    third = add_table(c, source_id, "extra", b"X\n1\n")
    assert third.status_code == 422
    assert "A source holds at most 2 tables." in third.json()["errors"].values()

    mismatch = c.put(f"/api/sources/{source_id}/relation", json={
        "left_table": "orders", "left_key": "Order", "right_table": "stockists", "right_key": "Stockist ID"})
    assert mismatch.status_code == 422
    assert mismatch.json()["errors"]["right_key"] == "Keys must have the same type."

    r = c.put(f"/api/sources/{source_id}/relation", json={
        "left_table": "orders", "left_key": "Stockist ID", "right_table": "stockists", "right_key": "Stockist ID"})
    assert r.status_code == 200, r.text
    notice = JOIN_NOTICE.format(table="stockists", n=1, key="S1")
    assert r.json()["notices"] == [notice]
    assert notice in c.get(f"/api/sources/{source_id}").json()["notices"]

    workbook_id = new_workbook(c, project_id, source_id)
    targets = add_sheet(c, workbook_id, sheet("Targets", rows=["Region"], columns=[M("Target")]))
    assert_values(by(ok_rows(query(c, targets)), "Region", "Target"),
                  {"East": 700, "North": 1400, "South": 400, "West": 600, None: None}, "SUM(Target) by Region")
    sales = add_sheet(c, workbook_id, sheet("Sales", rows=["Region"], columns=[M("Sales")]))
    assert_values(by(ok_rows(query(c, sales)), "Region", "Sales"),
                  {"East": 435, "North": 480, "South": 60, "West": 325, None: 20}, "SUM(Sales) by Region")


def _two_table_source(app_url: str) -> tuple[str, str, str, httpx.Client]:
    user, _, project_id, c = creator_project(app_url)
    r = upload(c, project_id, fresh("src"), "orders", ORDERS_CSV.encode())
    assert r.status_code == 201, r.text
    source_id = r.json()["id"]
    assert add_table(c, source_id, "stockists", STOCKISTS_DUP_CSV.encode()).status_code == 201
    return user, project_id, source_id, c


def test_wf_related_tables_happy(browser: Browser, app_url: str) -> None:
    user, project_id, source_id, c = _two_table_source(app_url)
    with visit(browser, app_url, user, f"/sources/{source_id}") as page:
        click(page.get_by_role("button", name="Relate tables", exact=True))
        dialog = page.get_by_role("dialog", name="Relate tables", exact=True)
        select(dialog.get_by_role("combobox", name="Left key", exact=True), "Stockist ID")
        select(dialog.get_by_role("combobox", name="Right key", exact=True), "Stockist ID")
        click(dialog.get_by_role("button", name="Save relation", exact=True))
        announced(page, "Announcements", "Related orders to stockists.")
        announced(page, "Join notice", JOIN_NOTICE.format(table="stockists", n=1, key="S1"))

        click(page.get_by_role("button", name="Create bins for Units", exact=True))
        bins = page.get_by_role("dialog", name="Bins", exact=True)
        fill(bins.get_by_role("spinbutton", name="Bin size", exact=True), "3")
        click(bins.get_by_role("button", name="Save bins", exact=True))
        announced(page, "Announcements", "Created Units (bin).")

        click(page.get_by_role("button", name="Create group for Product", exact=True))
        group = page.get_by_role("dialog", name="Group", exact=True)
        fill(group.get_by_role("textbox", name="Group name", exact=True), "Morning teas")
        check(group.get_by_role("checkbox", name="Ember Assam", exact=True))
        check(group.get_by_role("checkbox", name="Dusk Blend", exact=True))
        click(group.get_by_role("button", name="Save group", exact=True))
        announced(page, "Announcements", "Created Product (group).")

        click(page.get_by_role("button", name="Rename Tier", exact=True))
        rename = page.get_by_role("dialog", name="Rename field", exact=True)
        fill(rename.get_by_role("textbox", name="Name", exact=True), "Level")
        click(rename.get_by_role("button", name="Save name", exact=True))
        announced(page, "Announcements", "Renamed Tier to Level.")

        hide = page.get_by_role("button", name="Hide Target", exact=True)
        click(hide)
        announced(page, "Announcements", "Target hidden.")
        expect(page.get_by_role("button", name="Show Target", exact=True)).to_be_visible()

    fields = fields_of(c, source_id)
    assert {"Units (bin)", "Product (group)", "Level"} <= set(fields)
    assert "Tier" not in fields
    assert fields["Target"]["hidden"] is True
    assert S3().get(f"uploads/{source_id}/stockists/{hashlib.sha256(STOCKISTS_DUP_CSV.encode()).hexdigest()}.csv") \
        == STOCKISTS_DUP_CSV.encode()

    workbook_id = new_workbook(c, project_id, source_id)
    grouped = add_sheet(c, workbook_id, sheet("Grouped", rows=["Product (group)"], columns=[M("Sales")]))
    assert_values(by(ok_rows(query(c, grouped)), "Product (group)", "Sales"),
                  {"Morning teas": 600, "Moss Sencha": 450, "Quiet Mint": 270}, "group Morning teas")
    hidden = add_sheet(c, workbook_id, sheet("Uses target", rows=["Region"], columns=[M("Target")]))
    assert HIDDEN_NOTICE.format(field="Target") in notices_of(query(c, hidden))


def test_wf_related_tables_key_mismatch(browser: Browser, app_url: str) -> None:
    user, _, source_id, c = _two_table_source(app_url)
    with visit(browser, app_url, user, f"/sources/{source_id}") as page:
        click(page.get_by_role("button", name="Relate tables", exact=True))
        dialog = page.get_by_role("dialog", name="Relate tables", exact=True)
        select(dialog.get_by_role("combobox", name="Left key", exact=True), "Order")
        select(dialog.get_by_role("combobox", name="Right key", exact=True), "Stockist ID")
        click(dialog.get_by_role("button", name="Save relation", exact=True))
        eventually(page, lambda: expect(dialog).to_contain_text("Keys must have the same type.", timeout=POLL_MS),
                   "the relation dialog never showed the key type error")
        assert c.get(f"/api/sources/{source_id}").json()["relation"] is None
        select(dialog.get_by_role("combobox", name="Left key", exact=True), "Stockist ID")
        click(dialog.get_by_role("button", name="Save relation", exact=True))
        announced(page, "Announcements", "Related orders to stockists.")
    assert c.get(f"/api/sources/{source_id}").json()["relation"] is not None


def _post_field_rule(c: httpx.Client, path: str, field_name: str, field_id: str, body: dict) -> httpx.Response:
    r = c.post(path, json={"field": field_id, **body})
    if r.status_code in (404, 422) and "size" not in r.text:
        r = c.post(path, json={"field": field_name, **body})
    return r


def test_fields_bins_groups_dates(app_url: str) -> None:
    w = world(app_url)
    c = client(app_url, w.creator)
    fields = fields_of(c, w.source_id)
    assert fields["Units"]["kind"] == "measure" and fields["Product"]["kind"] == "dimension"
    assert fields["Date"]["continuous"] is True

    bad = _post_field_rule(c, f"/api/sources/{w.source_id}/bins", "Units", fields["Units"]["id"], {"size": 0})
    assert bad.status_code == 422
    assert "Bin size must be a whole number of at least 1." in bad.json()["errors"].values()
    r = _post_field_rule(c, f"/api/sources/{w.source_id}/bins", "Units", fields["Units"]["id"], {"size": 3})
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Units (bin)"
    r = _post_field_rule(c, f"/api/sources/{w.source_id}/groups", "Product", fields["Product"]["id"],
                         {"groups": [{"name": "Morning teas", "members": ["Ember Assam", "Dusk Blend"]}]})
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Product (group)"

    sheet_id = add_sheet(c, w.workbook_id, sheet("Bins"))
    calc = c.post(f"/api/sheets/{sheet_id}/calculations", json={"name": "One", "formula": "1"})
    assert calc.status_code == 201, calc.text
    assert put_sheet(c, w.workbook_id, sheet_id, sheet("Bins", rows=["Units (bin)"], label=[M("One")])).status_code == 200
    rows = ok_rows(query(c, sheet_id))
    assert [r["Units (bin)"] for r in rows] == ["0 to 2", "3 to 5", "6 to 8", None]
    assert_values(by(rows, "Units (bin)", "One"), {"0 to 2": 5, "3 to 5": 6, "6 to 8": 4, None: 1}, "Units bins")

    group_id = add_sheet(c, w.workbook_id, sheet("Groups", rows=["Product (group)"], columns=[M("Sales")]))
    assert_values(by(ok_rows(query(c, group_id)), "Product (group)", "Sales"),
                  {"Morning teas": 600, "Moss Sencha": 450, "Quiet Mint": 270}, "Product group")

    r = c.patch(f"/api/sources/{w.source_id}/fields/{fields['Units']['id']}", json={"kind": "dimension"})
    assert r.status_code == 200 and r.json()["kind"] == "dimension"

    _, _, project_id, c2 = creator_project(app_url)
    r = upload(c2, project_id, fresh("src"), "t", b"Date,V\n2027-01-03T23:30:00-05:00,1\n")
    assert r.status_code == 201, r.text
    src = r.json()["id"]
    wb = new_workbook(c2, project_id, src)
    for level, expected in [("week", "2027-01-04"), ("day", "2027-01-04"), ("month", "2027-01")]:
        sid = add_sheet(c2, wb, sheet(level, rows=[{"field": "Date", "level": level}], label=[M("V")]))
        rows = ok_rows(query(c2, sid))
        assert [r["Date"] for r in rows] == [expected], f"Date at {level} level gave {rows}"


def test_wf_build_view_happy(browser: Browser, app_url: str) -> None:
    w = world(app_url, sheets=[sheet("Build", filters=[NOT_NULL])], state="draft")
    with visit(browser, app_url, w.creator, w.sheet_path("Build")) as page:
        seen = query_responses(page)
        view = page.get_by_role("region", name="View", exact=True)
        expect(view.get_by_text("Place a field on Rows or Columns.", exact=True)).to_be_visible()

        option = add_by_keyboard(page, "Region, dimension", "Rows")
        announced(page, "View announcements", "Added Region to Rows.")
        expect(option).to_be_focused()

        chip = page.get_by_role("listbox", name="Fields", exact=True).get_by_role("option", name=option_name("Sales", "measure"), exact=True)
        columns = page.get_by_role("list", name="Columns", exact=True)
        x0, y0 = center(chip)
        x1, y1 = center(columns)
        page.mouse.move(x0, y0)
        page.mouse.down()
        page.mouse.move(x0 + 2, y0)
        page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, steps=5)
        page.mouse.move(x1, y1, steps=5)
        expect(columns).to_have_attribute("data-drop", "true")
        page.mouse.up()
        expect(columns.get_by_role("button", name=pill_name("Sales", "Columns"), exact=True)).to_be_visible()

        expect_marks(page, view, {"East": "435", "North": "480", "South": "60", "West": "325"}, "Region by Sales")
        ticks = [t.strip() for t in view.locator("[data-tick]").all_text_contents()
                 if re.fullmatch(r"-?[\d,.]+", t.strip())]
        assert ticks == ["0", "200", "400", "600"], ticks
        marks = mark_data(view)
        assert marks[0]["label"] == "East, Sales 435, bar 1 of 4"
        assert {m["color"] for m in marks} == {"233, 71, 159"} and {m["pattern"] for m in marks} == {"solid"}
        plot, bar = bar_geometry(view, "East")
        assert abs(bar["width"] - plot["width"] * 435 / 600) <= PIXEL_TOL, (plot, bar)
        assert abs(bar["x"] - plot["x"]) <= PIXEL_TOL

        mark_el(view, "East").focus()
        expect(page.get_by_role("tooltip")).to_have_text("Region: East; Sales: 435")
        expect_twin(page, page, "Build", [(["East"], ["435"]), (["North"], ["480"]),
                                                  (["South"], ["60"]), (["West"], ["325"])], "twin")

        click(page.get_by_role("button", name="Expand Region", exact=True))
        announced(page, "View announcements", "Expanded Region.")
        expect_marks(page, view, {"East | Cedar Pot": "435", "North | Alder Cup": "300", "North | Birch Kettle": "180",
                                  "South | Dune Mug": "60", "West | Elm Leaf": "325"}, "drilled to Stockist")
        click(page.get_by_role("button", name="Collapse Region", exact=True))
        announced(page, "View announcements", "Collapsed Region.")
        expect_marks(page, view, {"East": "435", "North": "480", "South": "60", "West": "325"}, "collapsed")
        settle_page(page)
        assert_values(by(last_rows(page, seen), "Region", "Sales"),
                      {"East": 435, "North": 480, "South": 60, "West": 325}, "last query answer")


def test_wf_build_view_refusal(browser: Browser, app_url: str) -> None:
    w = world(app_url, sheets=[sheet("Refuse", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL])],
              state="draft")
    with visit(browser, app_url, w.creator, w.sheet_path("Refuse")) as page:
        view = page.get_by_role("region", name="View", exact=True)
        good = {"East": "435", "North": "480", "South": "60", "West": "325"}
        expect_marks(page, view, good, "initial chart")
        add_by_keyboard(page, "Units, measure", "Columns")
        announced(page, "View notice", "One measure per axis. Remove Units or place it on Label.")
        assert mark_values(view) == good, "the last good chart did not stay"
        expect_twin(page, page, "Refuse", [(["East"], ["435"]), (["North"], ["480"]),
                                                   (["South"], ["60"]), (["West"], ["325"])], "kept twin")
        units = page.get_by_role("button", name=pill_name("Units", "Columns"), exact=True)
        units.focus()
        page.keyboard.press("Delete")
        eventually(page, lambda: expect(page.get_by_role("status", name="View notice", exact=True)).to_have_text("", timeout=POLL_MS),
                   "View notice did not empty once the refusal was gone")


def test_keyboard_shelves_and_drill(browser: Browser, app_url: str) -> None:
    w = world(app_url, sheets=[sheet("Keys", filters=[NOT_NULL])], state="draft")
    with visit(browser, app_url, w.creator, w.sheet_path("Keys")) as page:
        fields = page.get_by_role("listbox", name="Fields", exact=True)
        options = fields.get_by_role("option")
        options.first.focus()
        page.keyboard.press("ArrowUp")
        expect(options.first).to_be_focused()
        last = options.nth(options.count() - 1)
        for _ in range(options.count()):
            page.keyboard.press("ArrowDown")
        expect(last).to_be_focused()

        region = focus_option(page, "Region, dimension")
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu", name="Add to shelf", exact=True)
        expect(menu).to_be_visible()
        page.keyboard.press("Escape")
        expect(menu).to_have_count(0)
        expect(region).to_be_focused()

        add_by_keyboard(page, "Region, dimension", "Rows")
        announced(page, "View announcements", "Added Region to Rows.")
        add_by_keyboard(page, "Category, dimension", "Rows")
        announced(page, "View announcements", "Added Category to Rows.")
        rows = page.get_by_role("list", name="Rows", exact=True)
        region_pill = rows.get_by_role("button", name=pill_name("Region", "Rows"), exact=True)
        category_pill = rows.get_by_role("button", name=pill_name("Category", "Rows"), exact=True)
        region_pill.focus()
        page.keyboard.press("Alt+ArrowRight")
        announced(page, "View announcements", "Moved Region to position 2 on Rows.")
        expect(region_pill).to_be_focused()
        assert category_pill.evaluate("(a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)",
                                      region_pill.element_handle()), "Category pill should now come before Region"
        page.keyboard.press("Alt+ArrowUp")
        announced(page, "View announcements", "Moved Region to position 1 on Rows.")
        expect(region_pill).to_be_focused()

        page.keyboard.press("Delete")
        announced(page, "View announcements", "Removed Region from Rows.")
        expect(category_pill).to_be_focused()
        page.keyboard.press("Delete")
        announced(page, "View announcements", "Removed Category from Rows.")
        expect(options.first).to_be_focused()

        add_by_keyboard(page, "Region, dimension", "Rows")
        expand = page.get_by_role("button", name="Expand Region", exact=True)
        expand.focus()
        page.keyboard.press("Enter")
        announced(page, "View announcements", "Expanded Region.")
        collapse = page.get_by_role("button", name="Collapse Region", exact=True)
        expect(collapse).to_be_focused()
        expect(rows.get_by_role("button", name=pill_name("Stockist", "Rows"), exact=True)).to_have_count(1)
        page.keyboard.press("Enter")
        announced(page, "View announcements", "Collapsed Region.")
        expect(page.get_by_role("button", name="Expand Region", exact=True)).to_be_focused()
        expect(rows.get_by_role("button", name=pill_name("Stockist", "Rows"), exact=True)).to_have_count(0)

        category = add_by_keyboard(page, "Category, dimension", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Category", exact=True)
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(category).to_be_focused()
        expect(page.get_by_role("button", name=pill_name("Category", "Filters"), exact=True)).to_have_count(0)


def test_chart_type_and_refusals(app_url: str) -> None:
    month = {"field": "Date", "level": "month"}
    shapes: dict[str, tuple[dict, str]] = {
        "scatter": (dict(rows=[M("Sales")], columns=[M("Units")], detail=["Order"]), "scatter"),
        "line": (dict(rows=[M("Sales")], columns=[month]), "line"),
        "bar_rows": (dict(rows=[M("Sales")], columns=["Category"]), "bar"),
        "bar_columns": (dict(rows=["Category"], columns=[M("Sales")]), "bar"),
        "heat_map": (dict(rows=["Region"], columns=["Category"], color=M("Sales")), "heat_map"),
        "text_table": (dict(rows=["Region"], columns=["Category"], label=[M("Sales")]), "text_table"),
        "empty": (dict(label=[M("Sales")]), "none"),
        "one_measure": (dict(rows=["Region"], columns=[M("Sales"), M("Units")]),
                        "One measure per axis. Remove Units or place it on Label."),
        "line_refused": (dict(chart="line", rows=["Region"], columns=[M("Sales")]),
                         "Line needs a date on Columns and a measure on Rows."),
        "scatter_refused": (dict(chart="scatter", rows=["Region"], columns=[M("Sales")]),
                            "Scatter needs a measure on Rows and on Columns."),
        "heat_map_refused": (dict(chart="heat_map", rows=["Region"], columns=["Category"]),
                             "Heat map needs a measure on Color."),
        "size_scatter_only": (dict(rows=["Region"], columns=[M("Sales")], size=M("Units")),
                              "Size works with Scatter only."),
        "size_measure": (dict(rows=[M("Sales")], columns=[M("Units")], detail=["Order"], size="Category"),
                         "Size needs a measure."),
        "refusal_order": (dict(chart="line", rows=["Region"], columns=[M("Sales"), M("Units")]),
                          "One measure per axis. Remove Units or place it on Label."),
    }
    w = world(app_url, sheets=[sheet(case, **shape) for case, (shape, _) in shapes.items()])
    c = client(app_url, w.creator)
    for case, (_, expected) in shapes.items():
        r = query(c, w.sheets[case])
        if expected in {"scatter", "line", "bar", "heat_map", "text_table", "none"}:
            assert r.status_code == 200, f"{case}: {r.text}"
            assert r.json()["chart"] == expected, case
        else:
            refused(r, expected)


def test_ticks_colours_sort(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[
        sheet("Stacked", rows=["Region"], columns=[M("Sales")], color="Category", filters=[NOT_NULL]),
        sheet("Heat", rows=["Region"], columns=["Category"], color=M("Sales"), filters=[NOT_NULL]),
        sheet("Plain", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]),
    ])
    small_user, small_project, small_src, small_wb = fresh("cr"), fresh("proj"), fresh("src"), fresh("wb")
    small = seed(app_url, {
        "users": [{"username": small_user, "password": PASSWORD}],
        "projects": [{"name": small_project, "members": {small_user: "creator"}, "explorers_schedule": False}],
        "sources": [{"name": small_src, "project": small_project, "rows": 3}],
        "workbooks": [{"name": small_wb, "project": small_project, "source": small_src, "state": "draft",
                       "certified_by": None, "parameters": [], "sets": [],
                       "sheets": [sheet("Small", rows=["Group"], columns=[M("Value")])], "dashboards": []}],
    })
    with visit(browser, app_url, w.creator, w.sheet_path("Stacked")) as page:
        view = page.get_by_role("region", name="View", exact=True)
        eventually(page, lambda: expect(view.locator("[data-mark]")).to_have_count(11, timeout=POLL_MS),
                   "stacked bars should draw one segment per Region and Category")
        colours = {"Black": ("233, 71, 159", "solid"), "Green": ("26, 10, 20", "dots"),
                   "Herbal": ("217, 225, 63", "stripes")}
        for m in mark_data(view):
            category = m["mark"].split(" | ")[-1]
            assert (m["color"], m["pattern"]) == colours[category], m
        expect(page.get_by_role("list", name="Legend").get_by_role("listitem")).to_have_text(["Black", "Green", "Herbal"])

        page.goto(f"{app_url}{w.sheet_path('Heat')}")
        settle_page(page)
        view = page.get_by_role("region", name="View", exact=True)
        eventually(page, lambda: expect(mark_el(view, "East | Black")).to_have_attribute(
            "data-color", "243, 159, 205", timeout=POLL_MS), "150 should take 243, 159, 205")
        expect(mark_el(view, "North | Green")).to_have_attribute("data-color", "239, 119, 184")
        expect(mark_el(view, "South | Black")).to_have_attribute("data-color", "")
        expect(view).to_contain_text("(null)")
        expect(page.get_by_role("list", name="Legend").get_by_role("listitem")).to_have_text(["30 to 280"])

        page.goto(f"{app_url}{w.sheet_path('Plain')}")
        settle_page(page)
        view = page.get_by_role("region", name="View", exact=True)
        order = lambda: view.locator("[data-mark]").evaluate_all("els => els.map(e => e.getAttribute('data-mark'))")
        eventually(page, lambda: _equal(order(), ["East", "North", "South", "West"]), "ascending by default")
        ticks = [t.strip() for t in view.locator("[data-tick]").all_text_contents()
                 if re.fullmatch(r"-?[\d,.]+", t.strip())]
        assert ticks == ["0", "200", "400", "600"], ticks
        sort = page.get_by_role("button", name="Sort Region", exact=True)
        for expected in (["West", "South", "North", "East"], ["North", "East", "West", "South"],
                         ["East", "North", "South", "West"]):
            click(sort)
            eventually(page, lambda e=expected: _equal(order(), e), f"sort cycle should give {expected}")

    with visit(browser, app_url, small_user,
               f"/workbooks/{small['workbooks'][small_wb]}/sheets/{small['sheets'][f'{small_wb}/Small']}") as page:
        view = page.get_by_role("region", name="View", exact=True)
        eventually(page, lambda: expect(view.locator("[data-mark]")).to_have_count(3, timeout=POLL_MS), "three bars")
        ticks = [t.strip() for t in view.locator("[data-tick]").all_text_contents()
                 if re.fullmatch(r"-?[\d,.]+", t.strip())]
        assert ticks == ["0", "1", "2", "3"], f"values 1, 2, 3 give step 1: {ticks}"


def _equal(actual: Any, expected: Any) -> None:
    assert actual == expected, f"{actual} != {expected}"


def test_marks_tooltips_twin(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[
        sheet("Marks", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]),
        sheet("Whole", columns=[M("Sales")]),
    ])
    with visit(browser, app_url, w.creator, w.sheet_path("Marks")) as page:
        view = page.get_by_role("region", name="View", exact=True)
        expect_marks(page, view, {"East": "435", "North": "480", "South": "60", "West": "325"}, "marks")
        marks = mark_data(view)
        assert [m["role"] for m in marks] == ["button"] * 4
        assert [m["tabindex"] for m in marks] == ["0", "-1", "-1", "-1"]
        assert marks[1]["dims"] == "North" and marks[1]["measure"] == "Sales"
        assert marks[3]["label"] == mark_label(["West"], "Sales", "325", "bar", 4, 4)
        items = view.locator("[data-mark]")
        items.first.focus()
        page.keyboard.press("ArrowLeft")
        expect(items.first).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(items.nth(1)).to_be_focused()
        assert [m["tabindex"] for m in mark_data(view)] == ["-1", "0", "-1", "-1"]
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowRight")
        expect(items.nth(3)).to_be_focused()
        expect(page.get_by_role("tooltip")).to_have_count(1)
        expect(page.get_by_role("tooltip")).to_have_text(tip(("Region", "West"), ("Sales", "325")))
        page.keyboard.press("Enter")
        assert [m["pressed"] for m in mark_data(view)] == ["false", "false", "false", "true"]
        page.keyboard.press("Escape")
        assert [m["pressed"] for m in mark_data(view)] == ["false"] * 4
        expect(page.get_by_role("tooltip")).to_have_count(0)
        expect(items.nth(3)).to_be_focused()

        x, y = center(items.nth(1))
        page.mouse.move(x, y)
        expect(page.get_by_role("tooltip")).to_have_text(tip(("Region", "North"), ("Sales", "480")))
        page.mouse.move(1, 1)
        expect(page.get_by_role("tooltip")).to_have_count(0)

        click(items.first)
        assert mark_data(view)[0]["pressed"] == "true"
        plot = view.locator("[data-plot]").first.bounding_box()
        east = items.first.bounding_box()
        page.mouse.click(plot["x"] + plot["width"] * 0.97, east["y"] + east["height"] / 2)
        assert [m["pressed"] for m in mark_data(view)] == ["false"] * 4

        rows = twin_rows(page, "Marks")
        assert [(r["heads"], r["values"]) for r in rows] == [
            (["East"], ["435"]), (["North"], ["480"]), (["South"], ["60"]), (["West"], ["325"])]
        expect(page.get_by_role("grid", name="Marks table").get_by_role("columnheader")).to_have_text(["Region", "Sales"])

        page.goto(f"{app_url}{w.sheet_path('Whole')}")
        settle_page(page)
        view = page.get_by_role("region", name="View", exact=True)
        expect_marks(page, view, {"all": "1320"}, "a view without dimensions")


def _copy_sheet(page: Page) -> str:
    with page.expect_response(lambda r: r.url.rstrip("/").endswith("/copy") and r.request.method == "POST") as posted:
        click(page.get_by_role("button", name="Copy sheet", exact=True))
    copy_id = posted.value.json()["id"]
    expect(page.get_by_role("button", name="New calculation", exact=True)).to_be_visible(timeout=WAIT_S * 1000)
    settle_page(page)
    return copy_id


def _formula_text(box: Locator) -> str:
    return box.evaluate("e => ('value' in e) ? e.value : e.textContent")


def test_wf_calc_editor_happy(browser: Browser, app_url: str) -> None:
    explorer = fresh("ex")
    w = world(app_url, members={explorer: "explorer"},
              sheets=[sheet("Explain", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL])])
    debounce = httpx.get(f"{app_url}/api/config", timeout=HTTP_S).json()["formula_debounce_ms"]
    with visit(browser, app_url, explorer, w.sheet_path("Explain")) as page:
        copy_id = _copy_sheet(page)
        checks: list = []
        page.on("request", lambda r: checks.append(r) if "/api/formula/check" in r.url else None)
        opener = page.get_by_role("button", name="New calculation", exact=True)
        click(opener)
        dialog = page.get_by_role("dialog", name="Calculation", exact=True)
        fill(dialog.get_by_role("textbox", name="Calculation name", exact=True), AT_CALC)
        box = dialog.get_by_role("combobox", name="Formula", exact=True)
        box.focus()
        suggestions = dialog.get_by_role("listbox", name="Suggestions", exact=True)

        page.keyboard.type("C")
        expect(box).to_have_attribute("aria-expanded", "true")
        expect(suggestions.get_by_role("option")).to_have_text(["CONTAINS", "COUNT", "COUNT_UNIQUE", "Category"])
        page.keyboard.press("Escape")
        expect(box).to_have_attribute("aria-expanded", "false")
        assert _formula_text(box) == "C"
        page.keyboard.press("Backspace")

        page.keyboard.type("{AT [Reg")
        expect(suggestions.get_by_role("option")).to_have_text(["Region"])
        page.keyboard.press("ArrowDown")
        assert box.get_attribute("aria-activedescendant"), "ArrowDown should set aria-activedescendant"
        expect(box).to_be_focused()
        page.keyboard.press("Enter")
        page.keyboard.type(" : SU")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        page.keyboard.type("[Sal")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        page.keyboard.type(")}")
        assert _formula_text(box) == "{AT [Region] : SUM([Sales])}"

        before = len(checks)
        advance(page, debounce - 1)
        flush(page)
        assert len(checks) == before, "the formula was checked before the debounce elapsed"
        advance(page, 1)
        announced(page, "Formula check", "Formula is valid.", scope=dialog)

        click(dialog.get_by_role("button", name="Save calculation", exact=True))
        announced(page, "View announcements", f"Saved {AT_CALC}.")
        expect(page.get_by_role("list", name="Calculations").get_by_role(
            "button", name=EDIT_BUTTON.format(name=AT_CALC))).to_be_visible()

    c = client(app_url, w.creator)
    sales = fields_of(c, w.source_id)["Sales"]["id"]
    assert c.patch(f"/api/sources/{w.source_id}/fields/{sales}", json={"name": REVENUE}).status_code == 200
    e = client(app_url, explorer)
    calcs = e.get(f"/api/sheets/{copy_id}").json()["calculations"]
    assert [x["formula"] for x in calcs if x["name"] == AT_CALC] == [f"{{AT [Region] : SUM([{REVENUE}])}}"]
    with visit(browser, app_url, explorer, f"/workbooks/{w.workbook_id}/sheets/{copy_id}") as page:
        click(page.get_by_role("button", name=EDIT_BUTTON.format(name=AT_CALC), exact=True))
        box = page.get_by_role("dialog", name="Calculation").get_by_role("combobox", name="Formula", exact=True)
        assert _formula_text(box) == f"{{AT [Region] : SUM([{REVENUE}])}}"


def test_wf_calc_editor_typo(browser: Browser, app_url: str) -> None:
    explorer = fresh("ex")
    w = world(app_url, members={explorer: "explorer"},
              sheets=[sheet("Explain", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL])])
    debounce = httpx.get(f"{app_url}/api/config", timeout=HTTP_S).json()["formula_debounce_ms"]
    with visit(browser, app_url, explorer, w.sheet_path("Explain")) as page:
        _copy_sheet(page)
        click(page.get_by_role("button", name="New calculation", exact=True))
        dialog = page.get_by_role("dialog", name="Calculation", exact=True)
        box = dialog.get_by_role("combobox", name="Formula", exact=True)
        status = dialog.get_by_role("status", name="Formula check", exact=True)

        fill(box, "SUM([Salez]) +")
        advance(page, debounce)
        announced(page, "Formula check", "Line 1, column 15: formula ended early.", scope=dialog)
        fill(box, "SUM([Salez])")
        advance(page, debounce)
        announced(page, "Formula check", 'Line 1, column 5: unknown field "Salez".', scope=dialog)

        parked: list = []
        page.route("**/api/formula/check*", lambda route: parked.append(route) if not parked else route.continue_())
        fill(box, "SUM([Product])")
        advance(page, debounce)
        deadline = time.monotonic() + WAIT_S
        while not parked and time.monotonic() < deadline:
            flush(page)
        assert parked, "the check for the older text was never sent"
        fill(box, "SUM([Sales])")
        advance(page, debounce)
        announced(page, "Formula check", "Formula is valid.", scope=dialog)
        parked[0].continue_()
        settle_page(page)
        flush(page)
        expect(status).to_have_text("Formula is valid.")


def test_calculation_language(app_url: str) -> None:
    row_cases = [
        ("IfBig", "IF([Units] > 4, 'big', 'small')", "dim", {"1": "small", "16": "small"}),
        ("IfNull", "IFNULL([Sales], 0)", "num", {"16": 0}),
        ("IsNull", "ISNULL([Units])", "dim", {"16": True}),
        ("Abs", "ABS(-135)", "num", {"1": 135}),
        ("Round", "ROUND(-2.5, 0)", "num", {"1": -3}),
        ("Upper", "UPPER('Moss Sencha')", "dim", {"1": "MOSS SENCHA"}),
        ("Lower", "LOWER('Moss Sencha')", "dim", {"1": "moss sencha"}),
        ("Len", "LEN('Quiet Mint')", "num", {"1": 10}),
        ("Left", "LEFT('Ember Assam', 5)", "dim", {"1": "Ember"}),
        ("Right", "RIGHT('Ember Assam', 5)", "dim", {"1": "Assam"}),
        ("Contains", "CONTAINS('Dusk Blend', 'Blend')", "dim", {"1": True}),
        ("PartYear", "PART_OF([Date], 'year')", "num", {"5": 2027}),
        ("PartMonth", "PART_OF([Date], 'month')", "num", {"5": 1}),
        ("PartWeek", "PART_OF([Date], 'week')", "num", {"5": 3}),
        ("PartDay", "PART_OF([Date], 'day')", "num", {"5": 20}),
        ("PartWeekday", "PART_OF([Date], 'weekday')", "num", {"5": 3}),
        ("TruncYear", "TEXT(TRUNC_TO([Date], 'year'))", "dim", {"5": "2027-01-01"}),
        ("TruncMonth", "TEXT(TRUNC_TO([Date], 'month'))", "dim", {"5": "2027-01-01"}),
        ("TruncWeek", "TEXT(TRUNC_TO([Date], 'week'))", "dim", {"5": "2027-01-18"}),
        ("Days", "DAYS_BETWEEN(TRUNC_TO([Date], 'month'), [Date])", "num", {"16": 15}),
        ("NumOk", "NUM('12.5')", "num", {"1": 12.5}),
        ("NumTea", "NUM('tea')", "num", {"1": None}),
        ("TextNum", "TEXT(12.5)", "dim", {"1": "12.5"}),
        ("TextDate", "TEXT([Date])", "dim", {"5": "2027-01-20"}),
        ("Mod", "-7 % 3", "num", {"1": -1}),
        ("DivZero", "5 / 0", "num", {"1": None}),
        ("NotNull", "NOT NULL", "dim", {"1": None}),
        ("OrNull", "TRUE OR NULL", "dim", {"1": True}),
        ("AndNull", "FALSE AND NULL", "dim", {"1": False}),
        ("JoinNull", "'a' & NULL", "dim", {"1": None}),
    ]
    agg_cases = [
        ("Sum", "{SUM([Sales])}", 1320), ("Avg", "{AVG([Sales])}", 88), ("Median", "{MEDIAN([Sales])}", 80),
        ("Min", "{MIN([Sales])}", 20), ("Max", "{MAX([Sales])}", 210), ("CountSales", "{COUNT([Sales])}", 15),
        ("CountOrder", "{COUNT([Order])}", 16), ("Unique", "{COUNT_UNIQUE([Product])}", 4),
    ]
    sheets = []
    for name, formula, kind, _ in row_cases:
        calcs = [{"name": name, "formula": formula}]
        if kind == "dim":
            sheets.append(sheet(name, rows=["Order", name], calcs=calcs))
        else:
            sheets.append(sheet(name, rows=["Order"], label=[M(name)], calcs=calcs))
    for name, formula, _ in agg_cases:
        sheets.append(sheet(name, rows=["Category"], label=[M(name, "AVG")], calcs=[{"name": name, "formula": formula}]))
    w = world(app_url, sheets=sheets)
    c = client(app_url, w.creator)

    def order_key(v: Any) -> str:
        return str(int(float(v)))

    for name, formula, kind, expected in row_cases:
        rows = ok_rows(query(c, w.sheets[name]))
        values = {order_key(r["Order"]): r[name] for r in rows}
        for order, want in expected.items():
            got = values.get(order, "missing")
            if isinstance(want, bool):
                assert got in (want, str(want).lower(), str(want).upper()), f"{formula} on Order {order} gave {got!r}"
            elif isinstance(want, str):
                assert got == want, f"{formula} on Order {order} gave {got!r}, expected {want!r}"
            else:
                assert got != "missing" and near(got, want), f"{formula} on Order {order} gave {got!r}, expected {want}"
    for name, formula, want in agg_cases:
        rows = ok_rows(query(c, w.sheets[name]))
        assert len(rows) == 3 and all(near(r[f"AVG {name}"], want) for r in rows), f"{formula} gave {rows}, expected {want}"

    for formula in ["RUN_TOTAL(SUM([Sales]))", "PREV_DIFF(SUM([Sales]))", "SHARE(SUM([Sales]))", "RANK_OF(SUM([Sales]))"]:
        r = c.post("/api/formula/check", json={"sheet": w.sheets["Sum"], "formula": formula})
        assert r.status_code == 200 and r.json()["valid"] is True and r.json()["aggregate"] is True, (formula, r.text)
    r = c.post("/api/formula/check", json={"sheet": w.sheets["Sum"], "formula": "SQRT(4)"})
    assert r.json() == {"valid": False, "message": 'Line 1, column 1: unknown function "SQRT".', "line": 1, "column": 1}


CHECK_CASES = ["too_long", "ended_early", "unknown_field", "argument_type", "mixed", "unexpected", "second_line",
               "too_deep", "lower_case", "argument_count", "cycle"]


@pytest.mark.parametrize("case", CHECK_CASES, ids=CHECK_CASES)
def test_formula_errors(app_url: str, case: str) -> None:
    w = world(app_url, sheets=[sheet("Calc", rows=["Region"], columns=[M("Sales")])])
    c = client(app_url, w.creator)
    sheet_id = w.sheets["Calc"]
    if case == "cycle":
        for name, formula in [("A", "1"), ("B", "[A] + 1")]:
            r = c.post(f"/api/sheets/{sheet_id}/calculations", json={"name": name, "formula": formula})
            assert r.status_code == 201, r.text
        a_id = c.get(f"/api/sheets/{sheet_id}").json()["calculations"]
        a_id = [x["id"] for x in a_id if x["name"] == "A"][0]
        r = c.put(f"/api/calculations/{a_id}", json={"name": "A", "formula": "[B] + 1"})
        assert r.status_code == 422, r.text
        assert r.json()["errors"]["formula"] == "Cycle: A -> B -> A."
        return
    cases: dict[str, tuple[str, str | None, int | None, int | None]] = {
        "ended_early": ("SUM([Salez]) +", "Line 1, column 15: formula ended early.", 1, 15),
        "unknown_field": ("SUM([Salez])", 'Line 1, column 5: unknown field "Salez".', 1, 5),
        "argument_type": ("SUM([Product])", "Line 1, column 5: SUM argument 1 must be number, found text.", 1, 5),
        "mixed": ("SUM([Sales]) / [Units]", "Line 1, column 16: cannot mix aggregate and row values.", 1, 16),
        "unexpected": ("SUM([Sales]))", 'Line 1, column 13: unexpected ")".', 1, 13),
        "second_line": ("SUM([Sales])\n  + [Salez]", 'Line 2, column 5: unknown field "Salez".', 2, 5),
        "too_deep": ("(" * (FORMULA_MAX_DEPTH + 1) + "1" + ")" * (FORMULA_MAX_DEPTH + 1),
                     f"Line 1, column {FORMULA_MAX_DEPTH + 1}: nested deeper than {FORMULA_MAX_DEPTH} levels.",
                     1, FORMULA_MAX_DEPTH + 1),
        "lower_case": ("sum([Sales])", 'Line 1, column 1: unknown function "sum".', 1, 1),
        "argument_count": ("ABS(1, 2)", "Line 1, column 1: ABS expects 1 arguments, found 2.", 1, 1),
        "too_long": ("1" * (FORMULA_MAX_CHARS + 1), None, None, None),
    }
    formula, message, line, column = cases[case]
    r = c.post("/api/formula/check", json={"sheet": sheet_id, "formula": formula})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["valid"] is False, body
    if case == "too_long":
        either(body["message"], "Formula is {n} characters. The limit is {max}.",
               n=FORMULA_MAX_CHARS + 1, max=FORMULA_MAX_CHARS)
        assert body["line"] is None and body["column"] is None
        at_limit = c.post("/api/formula/check", json={"sheet": sheet_id, "formula": "1" * FORMULA_MAX_CHARS})
        assert at_limit.json()["valid"] is True, "exactly the length limit is allowed"
        message = body["message"]
    else:
        if case == "argument_count":
            assert re.fullmatch(r"Line 1, column \d+: ABS expects 1 arguments, found 2\.", body["message"]), body
            assert body["line"] == 1, body
            message = body["message"]
        else:
            assert (body["message"], body["line"], body["column"]) == (message, line, column), body
    if case == "too_deep":
        ok = "(" * FORMULA_MAX_DEPTH + "1" + ")" * FORMULA_MAX_DEPTH
        assert c.post("/api/formula/check", json={"sheet": sheet_id, "formula": ok}).json()["valid"] is True
    saved = c.post(f"/api/sheets/{sheet_id}/calculations", json={"name": fresh("calc"), "formula": formula})
    assert saved.status_code == 422, saved.text
    assert saved.json()["errors"]["formula"] == message


@pytest.mark.timeout(900)
def test_bounded_query_work(app_url: str) -> None:
    heavy = "[Value]" + " + 1" * 50
    light = "-[Value]" + " + 1" * 49
    w = world(app_url, source_spec={"rows": ROW_MAX}, sheets=[
        sheet("Too much", rows=["Group"], label=[M("Heavy")], calcs=[{"name": "Heavy", "formula": heavy}]),
        sheet("Just enough", rows=["Group"], label=[M("Light")], calcs=[{"name": "Light", "formula": light}]),
    ])
    c = client(app_url, w.creator)
    started = time.monotonic()
    r = query(c, w.sheets["Too much"])
    assert time.monotonic() - started < QUERY_BUDGET_S
    refused(r, WORK_NOTICE.format(max="5,000,000"))
    assert query(c, w.sheets["Just enough"]).status_code == 200, "exactly the work limit is allowed"

    for rows, allowed in ((MARK_MAX + 1, False), (MARK_MAX, True)):
        mw = world(app_url, source_spec={"rows": rows})
        mc = client(app_url, mw.creator)
        id_field = fields_of(mc, mw.source_id)["Id"]["id"]
        assert mc.patch(f"/api/sources/{mw.source_id}/fields/{id_field}", json={"kind": "dimension"}).status_code == 200
        sid = add_sheet(mc, mw.workbook_id, sheet("Ids", rows=["Id"], columns=[M("Value")]))
        started = time.monotonic()
        r = query(mc, sid)
        assert time.monotonic() - started < QUERY_BUDGET_S
        if allowed:
            assert len(ok_rows(r)) == MARK_MAX
        else:
            refused(r, MARK_NOTICE.format(n="2,001", max="2,000"))

    for formula in ["(" * HUGE_FORMULA_CHARS, "(" * (FORMULA_MAX_CHARS // 2 - 1) + "1" + ")" * (FORMULA_MAX_CHARS // 2 - 1)]:
        started = time.monotonic()
        r = c.post("/api/formula/check", json={"sheet": w.sheets["Too much"], "formula": formula})
        assert time.monotonic() - started < FORMULA_CHECK_S, "a formula check took over one second"
        assert r.status_code == 200 and r.json()["valid"] is False

    other = world(app_url, sheets=[sheet("Small", rows=["Region"], columns=[M("Sales")])])
    oc = client(app_url, other.creator)
    first_done = threading.Event()
    stop = threading.Event()

    def run_heavy() -> None:
        hc = client(app_url, w.creator)
        deadline = time.monotonic() + WAIT_S
        while not stop.is_set() and time.monotonic() < deadline:
            query(hc, w.sheets["Just enough"])
            first_done.set()

    workers = [threading.Thread(target=run_heavy) for _ in range(4)]
    for worker in workers:
        worker.start()
    first_done.wait(HTTP_S)
    timings = []
    for _ in range(3):
        started = time.monotonic()
        r = query(oc, other.sheets["Small"])
        timings.append(time.monotonic() - started)
        assert r.status_code == 200
    stop.set()
    for worker in workers:
        worker.join(HTTP_S)
    assert max(timings) < ISOLATION_S, f"another user's small query took {max(timings):.2f} s"


def test_level_of_detail(app_url: str) -> None:
    at = {"name": "AtSales", "formula": "{AT [Region] : SUM([Sales])}"}
    whole = {"name": "WholeSales", "formula": "{SUM([Sales])}"}
    plus = {"name": "PlusSales", "formula": "{PLUS [Product] : SUM([Sales])}"}
    minus = {"name": "MinusSales", "formula": "{MINUS [Category] : SUM([Sales])}"}
    w = world(app_url, sheets=[
        sheet("At", rows=["Region"], label=[M("AtSales", "AVG")], filters=[NOT_NULL], calcs=[at]),
        sheet("Whole", rows=["Region"], label=[M("WholeSales", "AVG")], filters=[NOT_NULL], calcs=[whole]),
        sheet("Plus", rows=["Region"], label=[M("PlusSales", "AVG")], filters=[NOT_NULL], calcs=[plus]),
        sheet("PlusMax", rows=["Region"], label=[M("PlusSales", "MAX")], filters=[NOT_NULL], calcs=[plus]),
        sheet("Minus", rows=["Region"], columns=["Category"], label=[M("MinusSales", "AVG")], filters=[NOT_NULL],
              calcs=[minus]),
    ])
    c = client(app_url, w.creator)
    assert_values(by(ok_rows(query(c, w.sheets["At"])), "Region", "AVG AtSales"),
                  {"East": 435, "North": 480, "South": 60, "West": 325}, "AT Region")
    assert_values(by(ok_rows(query(c, w.sheets["Whole"])), "Region", "AVG WholeSales"),
                  {"East": 1300, "North": 1300, "South": 1300, "West": 1300}, "{SUM}")
    assert_values(by(ok_rows(query(c, w.sheets["Plus"])), "Region", "AVG PlusSales"),
                  {"East": 145, "North": 135, "South": 30, "West": 108.33}, "PLUS Product AVG")
    assert near(by(ok_rows(query(c, w.sheets["PlusMax"])), "Region", "MAX PlusSales")["North"], 210)
    minus_rows = by(ok_rows(query(c, w.sheets["Minus"])), ("Region", "Category"), "AVG MinusSales")
    assert near(minus_rows[("East", "Black")], 435) and near(minus_rows[("North", "Herbal")], 480), minus_rows


def test_query_order(app_url: str) -> None:
    at = {"name": "AtSales", "formula": "{AT [Region] : SUM([Sales])}"}
    plus = {"name": "PlusSales", "formula": "{PLUS [Product] : SUM([Sales])}"}
    minus = {"name": "MinusSales", "formula": "{MINUS [Category] : SUM([Sales])}"}
    rank = M("Sales", "SUM", TC("rank", "table_down"))
    share = M("Sales", "SUM", TC("share", "table_down"))
    w = world(app_url, sheets=[
        sheet("Order", rows=["Region"], label=[M("Sales"), M("AtSales", "AVG")], filters=[NOT_NULL], calcs=[at]),
        sheet("Plus", rows=["Region"], label=[M("PlusSales", "AVG")], filters=[NOT_NULL], calcs=[plus]),
        sheet("PlusMax", rows=["Region"], label=[M("PlusSales", "MAX")], filters=[NOT_NULL], calcs=[plus]),
        sheet("Minus", rows=["Region"], columns=["Category"], label=[M("MinusSales", "AVG")], filters=[NOT_NULL],
              calcs=[minus]),
        sheet("Share", rows=["Region"], columns=[share], filters=[NOT_NULL]),
        sheet("Ranked", rows=["Region"], columns=[M("Sales")], label=[rank, share], filters=[NOT_NULL]),
        sheet("Totals", rows=["Region"], columns=[M("Sales")], label=[rank, share, M("Sales", "AVG")], totals=True,
              reference_lines=[{"type": "average", "value": None, "parameter": None}], filters=[NOT_NULL]),
    ])
    c = client(app_url, w.creator)
    order = w.sheets["Order"]

    r = c.post(f"/api/sheets/{order}/members", json={"field": "Product", "step": "context",
                                                     "filters": [F("Category", "source", ["Green"])], "parameters": {}})
    assert r.status_code == 200 and r.json()["members"] == ["Moss Sencha"], r.text

    rows = ok_rows(query(c, order, [F("Product", "context", ["Quiet Mint"])]))
    assert_values(by(rows, "Region", "AVG AtSales"), {"East": 75, "North": 120, "South": 30, "West": 45}, "context then AT")

    rows = ok_rows(query(c, order, [F("Product", "dimension", ["Quiet Mint"])]))
    assert_values(by(rows, "Region", "Sales"), {"East": 75, "North": 120, "South": 30, "West": 45}, "dimension filter")
    assert_values(by(rows, "Region", "AVG AtSales"), {"East": 435, "North": 480, "South": 60, "West": 325}, "AT before dimension")

    top = F("Region", "top", n=1, by=M("Sales"))
    rows = ok_rows(query(c, order, [top, F("Category", "dimension", ["Black"])]))
    assert_values(by(rows, "Region", "Sales"), {"North": 150}, "top N beside a dimension filter")
    rows = ok_rows(query(c, order, [top, F("Category", "context", ["Black"])]))
    assert_values(by(rows, "Region", "Sales"), {"West": 280}, "top N after a context filter")

    rows = ok_rows(query(c, w.sheets["Plus"], [F("Category", "dimension", ["Black"])]))
    assert_values(by(rows, "Region", "AVG PlusSales"), {"East": 150, "North": 75, "South": None, "West": 140}, "PLUS after dimension")
    rows = ok_rows(query(c, w.sheets["Minus"], [F("Product", "dimension", ["Quiet Mint"])]))
    assert near(by(rows, ("Region", "Category"), "AVG MinusSales")[("East", "Herbal")], 75)

    assert near(by(ok_rows(query(c, w.sheets["Plus"])), "Region", "AVG PlusSales")["North"], 135)
    assert near(by(ok_rows(query(c, w.sheets["PlusMax"])), "Region", "MAX PlusSales")["North"], 210)

    measure = F("Sales", "measure", agg="SUM", min=300)
    rows = ok_rows(query(c, order, [measure]))
    assert sorted(r["Region"] for r in rows) == ["East", "North", "West"]

    caption = "Percent of total of Sales"
    shares = by(ok_rows(query(c, w.sheets["Share"], [measure])), "Region", caption)
    assert {k: round(v * 100, 1) for k, v in shares.items()} == {"East": 35.1, "North": 38.7, "West": 26.2}
    shares = by(ok_rows(query(c, w.sheets["Share"])), "Region", caption)
    assert {k: round(v * 100, 1) for k, v in shares.items()} == {"East": 33.5, "North": 36.9, "South": 4.6, "West": 25.0}

    rank_filter = F("Sales", "table_calc", agg="SUM", table_calc=TC("rank", "table_down"), max=2)
    rows = ok_rows(query(c, w.sheets["Ranked"], [rank_filter]))
    assert by(rows, "Region", "Rank of Sales") == {"East": 2, "North": 1}
    assert {k: round(v * 100, 1) for k, v in by(rows, "Region", caption).items()} == {"East": 33.5, "North": 36.9}

    r = query(c, w.sheets["Totals"], [rank_filter])
    rows = ok_rows(r)
    assert_values(by(rows, "Region", "AVG Sales"), {"East": 145, "North": 80}, "AVG beside the rank filter")
    total = r.json()["total"]
    numbers = [v for v in total if isinstance(v, (int, float)) and not isinstance(v, bool)]
    assert any(near(v, 915) for v in numbers), total
    assert any(near(v, 101.67) for v in numbers) and not any(near(v, 112.5) for v in numbers), total
    assert total.count("n/a") == 2, total
    lines = r.json()["reference_lines"]
    assert any(str(line["type"]).lower() == "average" and near(line["value"], 457.5) for line in lines), lines


def _only(dialog: Locator, member: str) -> None:
    boxes = dialog.get_by_role("checkbox")
    for i in range(boxes.count()):
        box = boxes.nth(i)
        name = box.evaluate("e => e.getAttribute('aria-label') || (e.labels && e.labels[0] ? e.labels[0].textContent : '') || e.textContent")
        if name and name.strip() in {"Data source filter", "Context filter"}:
            continue
        box.set_checked(bool(name) and name.strip() == member)


def test_wf_query_order_happy(browser: Browser, app_url: str) -> None:
    at = {"name": "AtSales", "formula": "{AT [Region] : SUM([Sales])}"}
    w = world(app_url, state="draft", sheets=[
        sheet("Explain", rows=["Region"], label=[M("Sales"), M("AtSales", "AVG")], filters=[NOT_NULL], calcs=[at])])
    with visit(browser, app_url, w.creator, w.sheet_path("Explain")) as page:
        seen = query_responses(page)
        add_by_keyboard(page, "Product, dimension", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Product", exact=True)
        click(dialog.get_by_role("radio", name="Members", exact=True))
        _only(dialog, "Quiet Mint")
        click(dialog.get_by_role("button", name="Apply", exact=True))
        pill = page.get_by_role("button", name=pill_name("Product", "Filters"), exact=True)
        expect(pill).to_be_focused()
        announced(page, "View announcements", "Filtered: 4 marks.")
        expect_twin(page, page, "Explain", [(["East"], ["75", "435"]), (["North"], ["120", "480"]),
                                                    (["South"], ["30", "60"]), (["West"], ["45", "325"])],
                    "dimension filter leaves AT unchanged")

        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Filter Product", exact=True)
        check(dialog.get_by_role("checkbox", name="Context filter", exact=True))
        click(dialog.get_by_role("button", name="Apply", exact=True))
        expect(pill).to_be_focused()
        expect_twin(page, page, "Explain", [(["East"], ["75", "75"]), (["North"], ["120", "120"]),
                                                    (["South"], ["30", "30"]), (["West"], ["45", "45"])],
                    "context filter changes AT")
        announced(page, "View announcements", "Filtered: 4 marks.")

        check(page.get_by_role("checkbox", name="Show totals", exact=True))
        def total_row() -> None:
            rows = twin_rows(page, "Explain")
            totals = [r for r in rows if r["heads"][:1] == ["Grand total"]]
            assert totals and totals[0]["texts"][0] == "270", rows
        eventually(page, total_row, "Grand total row should sum to 270")
        settle_page(page)
        assert_values(by(last_rows(page, seen), "Region", "AVG AtSales"),
                      {"East": 75, "North": 120, "South": 30, "West": 45}, "last query answer")


def test_wf_query_order_measure(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[
        sheet("Measures", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL])])
    with visit(browser, app_url, w.creator, w.sheet_path("Measures")) as page:
        seen = query_responses(page)
        add_by_keyboard(page, "Sales, measure", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Sales", exact=True)
        fill(dialog.get_by_role("spinbutton", name="At least", exact=True), "300")
        click(dialog.get_by_role("button", name="Apply", exact=True))
        expect(page.get_by_role("button", name=pill_name("Sales", "Filters"), exact=True)).to_be_focused()
        announced(page, "View announcements", "Filtered: 3 marks.")
        expect_twin(page, page, "Measures", [(["East"], ["435"]), (["North"], ["480"]), (["West"], ["325"])],
                    "measure filter")

        add_by_keyboard(page, "Region, dimension", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Region", exact=True)
        click(dialog.get_by_role("radio", name="Top N", exact=True))
        fill(dialog.get_by_role("spinbutton", name="Top N", exact=True), "1")
        select(dialog.get_by_role("combobox", name="By", exact=True), "Sales")
        click(dialog.get_by_role("button", name="Apply", exact=True))
        expect(page.get_by_role("button", name=pill_name("Region", "Filters"), exact=True)).to_be_focused()
        announced(page, "View announcements", "Filtered: 1 marks.")
        expect_twin(page, page, "Measures", [(["North"], ["480"])], "top 1 Region")

        option = add_by_keyboard(page, "Category, dimension", "Filters")
        page.keyboard.press("Escape")
        expect(option).to_be_focused()
        expect(page.get_by_role("button", name=pill_name("Category", "Filters"), exact=True)).to_have_count(0)
        settle_page(page)
        assert [r["Region"] for r in last_rows(page, seen)] == ["North"]


def test_table_calculation_rules(app_url: str) -> None:
    def grid(name: str, kind: str, using: str, fields: tuple[str, ...] = ()) -> dict:
        return sheet(name, rows=["Region"], columns=["Category"], label=[M("Sales", "SUM", TC(kind, using, fields))],
                     filters=[NOT_NULL])
    w = world(app_url, sheets=[
        grid("RunAcross", "run_total", "table_across"), grid("RunDown", "run_total", "table_down"),
        grid("DiffAcross", "prev_diff", "table_across"), grid("ShareDown", "share", "table_down"),
        grid("RankDown", "rank", "table_down"), grid("RankChosen", "rank", "chosen", ("Region", "Category")),
        sheet("Pane", rows=["Tier", "Stockist"], columns=[M("Sales", "SUM", TC("run_total", "pane_down"))], filters=[NOT_NULL]),
        sheet("PaneTable", rows=["Tier", "Stockist"], columns=[M("Sales", "SUM", TC("run_total", "table_down"))], filters=[NOT_NULL]),
    ])
    c = client(app_url, w.creator)

    def cells(name: str, caption: str) -> dict:
        return by(ok_rows(query(c, w.sheets[name])), ("Region", "Category"), caption)

    run = cells("RunAcross", "Running total of Sales")
    assert_values({k: v for k, v in run.items() if k[0] in ("East", "South", "West")},
                  {("East", "Black"): 150, ("East", "Green"): 360, ("East", "Herbal"): 435,
                   ("South", "Black"): None, ("South", "Green"): 30, ("South", "Herbal"): 60,
                   ("West", "Black"): 280, ("West", "Herbal"): 325}, "Running total across")
    down = cells("RunDown", "Running total of Sales")
    assert_values({k: v for k, v in down.items() if k[1] == "Black"},
                  {("East", "Black"): 150, ("North", "Black"): 300, ("South", "Black"): None, ("West", "Black"): 580},
                  "Running total down, Black")
    assert_values({k: v for k, v in down.items() if k[1] == "Herbal"},
                  {("East", "Herbal"): 75, ("North", "Herbal"): 195, ("South", "Herbal"): 225, ("West", "Herbal"): 270},
                  "Running total down, Herbal")
    diff = cells("DiffAcross", "Difference from previous of Sales")
    assert_values({k: v for k, v in diff.items() if k[0] in ("East", "South", "West")},
                  {("East", "Black"): None, ("East", "Green"): 60, ("East", "Herbal"): -135,
                   ("South", "Black"): None, ("South", "Green"): None, ("South", "Herbal"): 0,
                   ("West", "Black"): None, ("West", "Herbal"): -235}, "Difference across")
    share = cells("ShareDown", "Percent of total of Sales")
    assert {k[0]: (None if v is None else round(v * 100, 1)) for k, v in share.items() if k[1] == "Black"} == \
        {"East": 25.9, "North": 25.9, "South": None, "West": 48.3}
    rank = cells("RankDown", "Rank of Sales")
    assert {k[0]: v for k, v in rank.items() if k[1] == "Black"} == {"East": 2, "North": 2, "South": None, "West": 1}
    chosen = cells("RankChosen", "Rank of Sales")
    sales = {("East", "Black"): 150, ("East", "Green"): 210, ("East", "Herbal"): 75, ("North", "Black"): 150,
             ("North", "Green"): 210, ("North", "Herbal"): 120, ("South", "Green"): 30, ("South", "Herbal"): 30,
             ("West", "Black"): 280, ("West", "Herbal"): 45}
    want = {280: 1, 210: 2, 150: 4, 120: 6, 75: 7, 45: 8, 30: 9}
    assert chosen == {**{k: want[v] for k, v in sales.items()}, ("South", "Black"): None}, chosen
    pane = ok_rows(query(c, w.sheets["Pane"]))
    assert [r["Running total of Sales"] for r in pane] == [300, 735, 1060, 180, 240]
    table = ok_rows(query(c, w.sheets["PaneTable"]))
    assert [r["Running total of Sales"] for r in table] == [300, 735, 1060, 1240, 1300]


def _grid_values(page: Page, name: str) -> dict:
    return {tuple(r["heads"]): r["values"][0] for r in twin_rows(page, name) if len(r["heads"]) == 2}


def test_wf_table_calcs_happy(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[
        sheet("Grid", rows=["Region"], columns=["Category"], label=[M("Sales")], filters=[NOT_NULL])])
    with visit(browser, app_url, w.creator, w.sheet_path("Grid")) as page:
        seen = query_responses(page)

        def apply(calculation: str, using: str, fields: tuple[str, ...] = ()) -> None:
            opener = page.get_by_role("list", name="Label", exact=True).get_by_role(
            "button", name=re.compile(r"^Table calculation of "))
            click(opener)
            dialog = page.get_by_role("dialog", name="Table calculation", exact=True)
            select(dialog.get_by_role("combobox", name="Calculation", exact=True), calculation)
            select(dialog.get_by_role("combobox", name="Compute using", exact=True), using)
            for f in fields:
                check(dialog.get_by_role("checkbox", name=f, exact=True))
            click(dialog.get_by_role("button", name="Apply", exact=True))
            expect(dialog).to_have_count(0)

        apply("Running total", "Table across")
        def across() -> None:
            v = _grid_values(page, "Grid")
            assert (v[("East","Black")], v[("East", "Green")], v[("East", "Herbal")]) == ("150", "360", "435"), v
            assert (v[("South", "Black")], v[("South", "Green")], v[("South", "Herbal")]) == ("", "30", "60"), v
            assert (v[("West", "Black")], v[("West", "Herbal")]) == ("280", "325"), v
        eventually(page, across, "Running total, Table across")
        expect(page.get_by_role("grid", name=f"{GRID_SHEET} table").get_by_role("columnheader", name="Running total of Sales",
                                                                        exact=True)).to_have_count(1)

        apply("Running total", "Table down")
        def down() -> None:
            v = _grid_values(page, "Grid")
            assert [v[(r, "Black")] for r in ("East", "North", "South", "West")] == ["150", "300", "", "580"], v
        eventually(page, down, "Running total, Table down")
        grid = page.get_by_role("grid", name=f"{GRID_SHEET} table")
        expect(grid).to_contain_text("(null)")

        apply("Rank", "Chosen fields", ("Region", "Category"))
        def chosen() -> None:
            v = _grid_values(page, "Grid")
            assert v[("West", "Black")] == "1" and v[("East", "Green")] == "2" and v[("North", "Green")] == "2", v
            assert v[("East", "Black")] == "4" and v[("South", "Green")] == "9" and v[("South", "Black")] == "", v
        eventually(page, chosen, "Rank, Chosen fields Region and Category")
        settle_page(page)
        rows = last_rows(page, seen)
        assert by(rows, ("Region", "Category"), "Rank of Sales")[("West", "Black")] == 1


def test_wf_table_calcs_filter(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[
        sheet("Ranks", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL])])
    with visit(browser, app_url, w.creator, w.sheet_path("Ranks")) as page:
        seen = query_responses(page)
        add_by_keyboard(page, "Sales, measure", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Sales", exact=True)
        select(dialog.get_by_role("combobox", name="Calculation", exact=True), "Rank")
        select(dialog.get_by_role("combobox", name="Compute using", exact=True), "Table down")
        fill(dialog.get_by_role("spinbutton", name="At most", exact=True), "2")
        click(dialog.get_by_role("button", name="Apply", exact=True))
        announced(page, "View announcements", "Filtered: 2 marks.")
        expect_twin(page, page, "Ranks", [(["East"], ["435"]), (["North"], ["480"])], "rank at most 2")
        settle_page(page)
        assert sorted(r["Region"] for r in last_rows(page, seen)) == ["East", "North"]


TOP_COUNT = {"name": "Top count", "type": "number", "value": 2, "values": []}
TOP_SET = {"name": "Top regions", "field": "Region", "top": {"n": "@Top count", "by": M("Sales")}}
EXCESS = {"name": "Excess", "formula": "COUNT([Order]) - [@Top count]"}
CONSTANT_LINE = {"type": "constant", "value": None, "parameter": "Top count"}


def test_parameters_and_sets(app_url: str) -> None:
    w = world(app_url, parameters=[TOP_COUNT], sets=[TOP_SET], sheets=[
        sheet("Drive", rows=["Region"], columns=[M("Excess")], color="Top regions", reference_lines=[CONSTANT_LINE],
              filters=[NOT_NULL], calcs=[EXCESS])])
    c = client(app_url, w.creator)
    for value, excess, members in ((None, {"East": 1, "North": 4, "South": 1, "West": 1}, {"East", "North"}),
                                   (3, {"East": 0, "North": 3, "South": 0, "West": 0}, {"East", "North", "West"})):
        r = query(c, w.sheets["Drive"], parameters=None if value is None else {"Top count": value})
        rows = ok_rows(r)
        assert_values(by(rows, "Region", "Excess"), excess, f"Excess at Top count {value or 2}")
        assert {row["Region"] for row in rows if row["Top regions"] == "In"} == members
        assert {row["Region"] for row in rows if row["Top regions"] == "Out"} == {"East", "North", "South", "West"} - members
        lines = r.json()["reference_lines"]
        assert any(str(line["type"]).lower() == "constant" and near(line["value"], value or 2) for line in lines), lines

    p = c.post(f"/api/workbooks/{w.workbook_id}/parameters",
               json={"name": "Pick", "type": "list", "value": "East", "values": ["East", "West"]})
    assert p.status_code == 201, p.text
    s = c.post(f"/api/workbooks/{w.workbook_id}/sets", json={"name": "Picked", "field": "Region", "members": ["West"]})
    assert s.status_code == 201, s.text
    sid = add_sheet(c, w.workbook_id, sheet("Picked", rows=["Picked", "Region"], columns=[M("Sales")], filters=[NOT_NULL]))
    rows = ok_rows(query(c, sid))
    assert {r["Region"] for r in rows if r["Picked"] == "In"} == {"West"}


def test_reference_and_trend_lines(browser: Browser, app_url: str) -> None:
    lines = [{"type": "average", "value": None, "parameter": None}, {"type": "median", "value": None, "parameter": None},
             {"type": "constant", "value": 7, "parameter": None}]
    w = world(app_url, state="draft", sheets=[
        sheet("Bars", rows=["Region"], columns=[M("Sales")], reference_lines=lines, filters=[NOT_NULL]),
        sheet("Monthly", rows=[M("Sales")], columns=[{"field": "Date", "level": "month"}], trend=True),
        sheet("Scatter", rows=[M("Sales")], columns=[M("Units")], detail=["Order"], trend=True),
    ])
    c = client(app_url, w.creator)
    got = {str(line["type"]).lower(): line["value"] for line in query(c, w.sheets["Bars"]).json()["reference_lines"]}
    assert near(got["average"], 325) and near(got["median"], 380) and near(got["constant"], 7), got
    trend = query(c, w.sheets["Monthly"]).json()["trend"]
    assert near(trend["slope"], -90) and near(trend["intercept"], 530), trend
    trend = query(c, w.sheets["Scatter"]).json()["trend"]
    assert round(trend["slope"], 2) == 24.92 and round(trend["intercept"], 2) == -10.02, trend

    with visit(browser, app_url, w.creator, w.sheet_path("Bars")) as page:
        view = page.get_by_role("region", name="View", exact=True)
        refs = lambda: view.locator("[data-ref]").evaluate_all("els => els.map(e => e.getAttribute('data-ref'))")
        for kind in ("Average", "Median", "Constant"):
            eventually(page, lambda k=kind: _equal(refs().count(k), 1), f"no SVG line carries data-ref={kind}")
        def ref_rows() -> None:
            rows = {r["heads"][0]: [t for t in r["texts"] if t] for r in twin_rows(page, "Bars") if r["heads"]}
            assert rows.get("Average") == ["325"] and rows.get("Median") == ["380"] and rows.get("Constant") == ["7"], rows
        eventually(page, ref_rows, "twin reference line rows")
        for name, text in (("Monthly", "y = -90x + 530"), ("Scatter", "y = 24.92x - 10.02")):
            page.goto(f"{app_url}{w.sheet_path(name)}")
            settle_page(page)
            grid = page.get_by_role("grid", name=f"{name} table")
            eventually(page, lambda g=grid, t=text: expect(g).to_contain_text(t, timeout=POLL_MS), f"Trend row {text}")
            expect(grid.get_by_role("rowheader", name="Trend", exact=True)).to_have_count(1)


def _drive_world(app_url: str) -> tuple[World, str]:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, parameters=[TOP_COUNT], sets=[TOP_SET], sheets=[
        sheet("Drive", rows=["Region"], columns=[M("Excess")], color="Top regions", reference_lines=[CONSTANT_LINE],
              filters=[NOT_NULL], calcs=[EXCESS])])
    return w, viewer


def _drive_twin(page: Page, count: int) -> None:
    excess = {2: ["1", "4", "1", "1"], 3: ["0", "3", "0", "0"]}[count]
    members = {2: ["In", "In", "Out", "Out"], 3: ["In", "In", "Out", "In"]}[count]
    def probe() -> None:
        rows = twin_rows(page, "Drive")
        marks = [r for r in rows if len(r["heads"]) == 2]
        assert [r["heads"] for r in marks] == [[reg, m] for reg, m in zip(["East", "North", "South", "West"], members)], rows
        assert [r["values"][0] for r in marks] == excess, rows
        constant = [r for r in rows if r["heads"][:1] == ["Constant"]]
        assert constant and [t for t in constant[0]["texts"] if t] == [str(count)], rows
    eventually(page, probe, f"twin at Top count {count}")


def _drive(browser: Browser, app_url: str, key: str) -> None:
    w, viewer = _drive_world(app_url)
    with visit(browser, app_url, viewer, w.sheet_path("Drive")) as page:
        bodies: list = []
        page.on("request", lambda r: bodies.append(r.post_data_json) if "/query" in r.url and r.method == "POST" else None)
        _drive_twin(page, 2)
        control = page.get_by_role("region", name="Controls").get_by_role("spinbutton", name="Top count", exact=True)
        control.focus()
        before = len(bodies)
        page.keyboard.press("Control+A")
        page.keyboard.type("3")
        flush(page)
        assert len(bodies) == before, "the parameter applied on a keystroke"
        page.keyboard.press(key)
        announced(page, "View announcements", "Top count set to 3.")
        _drive_twin(page, 3)
        settle_page(page)
        assert bodies and bodies[-1]["parameters"].get("Top count") in (3, "3"), bodies[-1]


def test_wf_params_sets_enter(browser: Browser, app_url: str) -> None:
    _drive(browser, app_url, "Enter")


def test_wf_params_sets_blur(browser: Browser, app_url: str) -> None:
    _drive(browser, app_url, "Tab")


def _hz(*names: str, kind: str = "horizontal") -> dict:
    return {"type": kind, "children": [{"sheet": n, "fixed": None} for n in names]}


def test_dashboard_layout(browser: Browser, app_url: str) -> None:
    names = ["One", "Two", "Three", "Four", "Five"]
    sheets = [sheet(n, rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]) for n in names]
    w = world(app_url, sheets=sheets, dashboards=[{"name": "Board", "layout": _hz("One", "Two", "Three"), "floating": [],
                                                    "phone_order": [], "phone_heights": {}, "actions": []}])
    c = client(app_url, w.creator)
    ids = w.sheets

    def create(layout: dict, floating: list | None = None) -> httpx.Response:
        return c.post(f"/api/workbooks/{w.workbook_id}/dashboards",
                      json={"name": fresh("dash"), "layout": layout, "floating": floating or [], "phone_order": [],
                            "phone_heights": {}, "actions": []},
                      headers={"If-Match": str(workbook_version(c, w.workbook_id))})

    def boxes(r: httpx.Response) -> dict:
        assert r.status_code == 201, r.text
        return {o["sheet"]: (o["x"], o["y"], o["w"], o["h"]) for o in r.json()["objects"]}

    def lay(kind: str, *children: Any) -> dict:
        return {"type": kind, "children": [ch if isinstance(ch, dict) else {"sheet": ids[ch], "fixed": None} for ch in children]}

    got = boxes(create(lay("horizontal", "One", "Two", "Three")))
    assert got == {ids["One"]: (0, 0, 422, 800), ids["Two"]: (430, 0, 421, 800), ids["Three"]: (859, 0, 421, 800)}, got
    fixed = lay("vertical", "Two", "Three")
    fixed["children"].insert(0, {"sheet": ids["One"], "fixed": 200})
    got = boxes(create(fixed))
    assert [got[ids[n]][1:4:2] for n in ("One", "Two", "Three")] == [(0, 200), (208, 292), (508, 292)], got
    got = boxes(create(lay("horizontal", "One", lay("vertical", "Two", "Three")),
                       [{"sheet": ids["Four"], "x": 10, "y": 20, "w": 300, "h": 200}]))
    assert got[ids["One"]] == (0, 0, 636, 800) and got[ids["Two"]] == (644, 0, 636, 396)
    assert got[ids["Three"]] == (644, 404, 636, 396) and got[ids["Four"]] == (10, 20, 300, 200), got

    deep = create(lay("horizontal", lay("vertical", lay("horizontal", "One", "Two")), "Three"))
    assert deep.status_code == 422 and deep.json()["errors"]["layout"] == "Containers nest at most one level."
    for children in (["One"], names):
        r = create(lay("horizontal", *children))
        assert r.status_code == 422 and r.json()["errors"]["sheets"] == "A dashboard holds 2 to 4 sheets.", r.text

    with visit(browser, app_url, w.creator, f"/dashboards/{w.dashboards['Board']}") as page:
        def region_box(name: str) -> tuple:
            region = page.get_by_role("region", name=name, exact=True)
            return tuple(region.get_attribute(a) for a in ("data-x", "data-w"))
        eventually(page, lambda: _equal([region_box(n) for n in ("One", "Two", "Three")],
                                        [("0", "422"), ("430", "421"), ("859", "421")]), "desktop layout")
        hide = page.get_by_role("list", name="Dashboard objects").get_by_role("button", name="Hide Two", exact=True)
        click(hide)
        announced(page, "View announcements", "Two hidden.")
        show = page.get_by_role("button", name="Show Two", exact=True)
        expect(show).to_be_focused()
        eventually(page, lambda: _equal([region_box(n) for n in ("One", "Three")], [("0", "636"), ("644", "636")]),
                   "hiding Two reflows to 636 and 636")
        click(show)
        announced(page, "View announcements", "Two shown.")
        eventually(page, lambda: _equal([region_box(n) for n in ("One", "Two", "Three")],
                                        [("0", "422"), ("430", "421"), ("859", "421")]), "showing Two restores the layout")


def _phone_world(app_url: str) -> tuple[World, str]:
    viewer = fresh("vw")
    sheets = [sheet("Regions", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]),
              sheet("Categories", rows=["Category"], columns=[M("Sales")]),
              sheet("Products", rows=["Product"], columns=[M("Sales")])]
    w = world(app_url, members={viewer: "viewer"}, parameters=[TOP_COUNT], sheets=sheets, dashboards=[{
        "name": "Phone", "layout": _hz("Regions", "Categories", "Products"), "floating": [],
        "phone_order": ["Categories", "Regions"], "phone_heights": {"Categories": 320, "Regions": 320},
        "actions": []}])
    return w, viewer


def test_wf_phone_dashboard_happy(browser: Browser, app_url: str) -> None:
    w, viewer = _phone_world(app_url)
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Phone']}", width=375, height=812, glide=True) as page:
        regions = page.get_by_role("region", name=REGIONS, exact=True)
        categories = page.get_by_role("region", name=CATEGORIES, exact=True)
        expect_marks(page, regions, {"East": "435", "North": "480", "South": "60", "West": "325"}, "phone sheet")
        expect(page.get_by_role("region", name=PRODUCTS, exact=True)).to_have_count(0)
        assert categories.bounding_box()["y"] < regions.bounding_box()["y"], "phone_order puts Categories first"
        assert abs(categories.bounding_box()["width"] - regions.bounding_box()["width"]) <= PIXEL_TOL
        for i in range(4):
            assert regions.locator("[data-mark]").nth(i).bounding_box()["height"] >= TAP_MIN_PX
        glide_reset(page)
        tap(mark_el(regions, "East"))
        details = page.get_by_role("dialog", name="Mark details", exact=True)
        expect(details).to_have_attribute("data-sheet", "bottom")
        expect(details).to_contain_text("Region: East; Sales: 435")
        assert any(r["id"] == "sheet-open" and r["duration"] == SHEET_OPEN_MS for r in glide_records(page)), glide_records(page)
        page.keyboard.press("Escape")
        expect(details).to_have_count(0)
        glide_reset(page)
        tap(page.get_by_role("button", name="Filters", exact=True))
        filters = page.get_by_role("dialog", name="Filters", exact=True)
        expect(filters.get_by_role("spinbutton", name="Top count", exact=True)).to_be_visible()
        assert any(r["id"] == "sheet-open" and r["duration"] == SHEET_OPEN_MS for r in glide_records(page))
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": 360, "height": 740})
        settle_page(page)
        layout(page)


def test_wf_phone_dashboard_reduced_motion(browser: Browser, app_url: str) -> None:
    w, viewer = _phone_world(app_url)
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Phone']}", width=375, height=812,
               reduced_motion="reduce", glide=True) as page:
        regions = page.get_by_role("region", name=REGIONS, exact=True)
        expect_marks(page, regions, {"East": "435", "North": "480", "South": "60", "West": "325"}, "phone sheet")
        glide_reset(page)
        tap(mark_el(regions, "North"))
        details = page.get_by_role("dialog", name="Mark details", exact=True)
        expect(details).to_contain_text(tip(("Region", "North"), ("Sales", "480")))
        assert mark_el(regions, "North").get_attribute("aria-pressed") == "true"
        page.keyboard.press("Escape")
        tap(page.get_by_role("button", name="Filters", exact=True))
        expect(page.get_by_role("dialog", name="Filters", exact=True)).to_be_visible()
        assert glide_records(page) == [], "reduced motion must create no animation"
        assert page.evaluate("() => document.getAnimations().length") == 0


def test_wf_phone_dashboard_breakpoints(browser: Browser, app_url: str) -> None:
    w, viewer = _phone_world(app_url)
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Phone']}", width=768, height=1024) as page:
        products = page.get_by_role("region", name=PRODUCTS, exact=True)
        eventually(page, lambda: expect(products).to_have_attribute("data-x", "859", timeout=POLL_MS), "desktop at 768")
        expect(page.get_by_role("button", name="Filters", exact=True)).to_have_count(0)
        regions_box = page.get_by_role("region", name=REGIONS, exact=True).bounding_box()
        assert abs(regions_box["y"] - products.bounding_box()["y"]) <= PIXEL_TOL, "desktop sheets sit side by side"
        layout(page)
        page.set_viewport_size({"width": 375, "height": 812})
        settle_page(page)
        eventually(page, lambda: expect(products).to_have_count(0, timeout=POLL_MS), "phone layout at 375")
        expect(page.get_by_role("button", name="Filters", exact=True)).to_be_visible()
        layout(page)


ACTION_NAMES = ["Pick region", "Swap set", "B filter", "A filter", "Glow"]


def _action_world(app_url: str) -> tuple[World, str]:
    viewer = fresh("vw")
    def act(name: str, kind: str, targets: list[str], parameter: str | None = None, set_name: str | None = None) -> dict:
        return {"name": name, "type": kind, "source": "Regions", "targets": targets, "field": "Region",
                "parameter": parameter, "set": set_name}
    sheets = [sheet("Regions", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]),
              sheet("Categories", rows=["Category"], columns=[M("Sales")]),
              sheet("Region mix", rows=["Region"], columns=[M("Sales")], color="Chosen", filters=[NOT_NULL])]
    w = world(app_url, members={viewer: "viewer"},
              parameters=[{"name": "Picked", "type": "text", "value": "West", "values": []}],
              sets=[{"name": "Chosen", "field": "Region", "members": ["West"]}], sheets=sheets, dashboards=[{
                  "name": "Actions", "layout": _hz("Regions", "Categories", "Region mix"), "floating": [],
                  "phone_order": [], "phone_heights": {}, "actions": [
                      act("Glow", "highlight", ["Region mix"]), act("B filter", "filter", ["Categories"]),
                      act("Swap set", "change_set", ["Region mix"], set_name="Chosen"),
                      act("A filter", "filter", ["Categories"]),
                      act("Pick region", "set_parameter", ["Categories"], parameter="Picked")]}])
    return w, viewer


def test_dashboard_actions_order(browser: Browser, app_url: str) -> None:
    w, viewer = _action_world(app_url)
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Actions']}") as page:
        bodies: list = []
        page.on("request", lambda r: bodies.append(r.post_data_json) if "/query" in r.url and r.method == "POST" else None)
        source = page.get_by_role("region", name=REGIONS, exact=True)
        categories = page.get_by_role("region", name=CATEGORIES, exact=True)
        mix = page.get_by_role("region", name=MIX, exact=True)
        expect_twin_values(page, categories, CATEGORIES, {"Black": "600", "Green": "450", "Herbal": "270"}, "unfiltered")
        east = mark_el(source, "East")
        click(east)
        log = page.get_by_role("log", name="Action log", exact=True)
        runs = [("Set parameter", "Pick region"), ("Change set", SWAP_SET), ("Filter", A_FILTER),
                ("Filter", B_FILTER), ("Highlight", GLOW)]
        expected = [LOG_LINE.format(n=n, type=kind, name=name) for n, (kind, name) in enumerate(runs, 1)]
        eventually(page, lambda: _equal([l.strip() for l in log.inner_text().splitlines() if l.strip()], expected),
                   "action log order")
        expect_twin_values(page, categories, CATEGORIES, {"Black": "150", "Green": "210", "Herbal": "75"}, "filter action to East")
        def highlighted() -> None:
            rows = {tuple(r["heads"]): r["highlight"] for r in twin_rows(mix, MIX)}
            assert rows.get(("East", "In")) == "true" and rows.get(("West", "Out")) != "true", rows
        eventually(page, highlighted, "highlight and change set on Region mix")
        settle_page(page)
        assert any(b and b.get("parameters", {}).get("Picked") == "East" for b in bodies), "Picked was not set to East"

        east.focus()
        page.keyboard.press("Escape")
        eventually(page, lambda: _equal(log.inner_text().strip(), ""), "clearing empties the action log")
        expect_twin_values(page, categories, CATEGORIES, {"Black": "600", "Green": "450", "Herbal": "270"}, "clearing removes filters")
        def restored() -> None:
            marks = highlights(mix, MIX)
            assert "West | In" in marks and "true" not in marks.values(), marks
        eventually(page, restored, "clearing restores the set and removes highlights")
        settle_page(page)
        assert bodies[-1]["parameters"].get("Picked") == "East", "the parameter keeps its last value"


def _two_sheet_world(app_url: str, action: str) -> tuple[World, str]:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, sheets=[
        sheet("Regions", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]),
        sheet("Categories", rows=["Category"], columns=[M("Sales")]),
        sheet("Region mix", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL])], dashboards=[{
            "name": "Board", "layout": _hz("Regions", "Categories", "Region mix"), "floating": [], "phone_order": [],
            "phone_heights": {}, "actions": [
                {"name": "Narrow", "type": "filter", "source": "Regions", "targets": ["Categories"], "field": "Region",
                 "parameter": None, "set": None},
                {"name": "Glow", "type": "highlight", "source": "Regions", "targets": ["Region mix"], "field": "Region",
                 "parameter": None, "set": None}][(0 if action == "both" else 1):]}])
    return w, viewer


def test_selection_latest_wins(browser: Browser, app_url: str) -> None:
    w, viewer = _two_sheet_world(app_url, "both")
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Board']}") as page:
        source = page.get_by_role("region", name=REGIONS, exact=True)
        target = page.get_by_role("region", name=CATEGORIES, exact=True)
        expect_twin_values(page, target, CATEGORIES, {"Black": "600", "Green": "450", "Herbal": "270"}, "unfiltered")
        target_query = f"**/api/sheets/{w.sheets[CATEGORIES]}/query*"
        with held(page, target_query) as older:
            with page.expect_request(target_query) as first:
                click(mark_el(source, "East"))
            expect(target).to_have_attribute("aria-busy", "true")
            expect(target.get_by_text("Updating...")).to_be_visible()
            with held(page, target_query) as newer:
                with page.expect_request(target_query) as second:
                    click(mark_el(source, "North"))
                gens = [int(re.search(r"gen=(\d+)", r.value.url).group(1)) for r in (first, second)]
                assert gens[1] > gens[0], gens
                with page.expect_response(target_query) as answered:
                    older.release()
                assert answered.value.ok, answered.value.status
                flush(page, 10)
                expect(target).to_have_attribute("aria-busy", "true")
                assert twin_values(target, CATEGORIES).get("Herbal") != "75", "the older East answer was applied"
                newer.release()
        expect_twin_values(page, target, CATEGORIES, {"Black": "150", "Green": "210", "Herbal": "120"}, "newest selection North")
        expect(target).not_to_have_attribute("aria-busy", "true")
        announced(page, "View announcements", "Filtered to North: 2 sheets updated")


def test_wf_dashboard_actions_happy(browser: Browser, app_url: str) -> None:
    w, viewer = _two_sheet_world(app_url, "both")
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Board']}") as page:
        seen = query_responses(page)
        source = page.get_by_role("region", name=REGIONS, exact=True)
        target = page.get_by_role("region", name=CATEGORIES, exact=True)
        expect_twin_values(page, target, CATEGORIES, {"Black": "600", "Green": "450", "Herbal": "270"}, "unfiltered")
        with held(page, f"**/api/sheets/{w.sheets[CATEGORIES]}/query*") as gate:
            click(mark_el(source, "East"))
            eventually(page, lambda: expect(target).to_have_attribute("aria-busy", "true", timeout=POLL_MS), "busy target")
            expect(target.get_by_text("Updating...")).to_be_visible()
            gate.release()
        announced(page, "View announcements", "Filtered to East: 2 sheets updated")
        expect(target.get_by_text("Updating...")).to_be_hidden()
        expect_twin_values(page, target, CATEGORIES, {"Black": "150", "Green": "210", "Herbal": "75"}, "filtered to East")
        mix = page.get_by_role("region", name=MIX, exact=True)
        marks = highlights(mix, MIX)
        assert marks["East"] == "true" and marks["West"] != "true", marks
        settle_page(page)
        assert_values(by(last_rows(page, seen, w.sheets[CATEGORIES]), "Category", "Sales"),
                      {"Black": 150, "Green": 210, "Herbal": 75}, "Categories answer")
        mark_el(source, "East").focus()
        page.keyboard.press("Escape")
        announced(page, "View announcements", "Selection cleared: 2 sheets updated")
        expect_twin_values(page, target, CATEGORIES, {"Black": "600", "Green": "450", "Herbal": "270"}, "cleared")


def test_wf_dashboard_actions_keyboard(browser: Browser, app_url: str) -> None:
    w, viewer = _two_sheet_world(app_url, "highlight")
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Board']}") as page:
        source = page.get_by_role("region", name=REGIONS, exact=True)
        expect_twin_values(page, source, REGIONS, {"East": "435", "North": "480", "South": "60", "West": "325"}, "source sheet")
        mark_el(source, "South").focus()
        page.keyboard.press("Enter")
        announced(page, "View announcements", "Highlighted South: 1 sheets updated")
        mix = page.get_by_role("region", name=MIX, exact=True)
        marks = highlights(mix, MIX)
        assert marks["South"] == "true" and marks["East"] != "true", marks
        page.keyboard.press("Escape")
        announced(page, "View announcements", "Selection cleared: 1 sheets updated")


def test_accounts_and_access_checks(app_url: str) -> None:
    anon = httpx.Client(base_url=app_url, timeout=HTTP_S)
    name = fresh("u")
    r = anon.post("/api/auth/register", json={"username": name, "password": PASSWORD})
    assert r.status_code == 201 and r.json()["user"]["username"] == name, r.text
    cookie = r.headers.get("set-cookie", "")
    assert "loz_session" in cookie and "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    assert "Secure".lower() not in cookie.lower().replace("loz_session", "")
    assert anon.get("/api/me").status_code == 200
    taken = httpx.post(f"{app_url}/api/auth/register", json={"username": name, "password": PASSWORD}, timeout=HTTP_S)
    assert taken.status_code == 409 and taken.json() == {"error": "username_taken", "errors": {"username": "That username is taken."}}
    bad = httpx.post(f"{app_url}/api/auth/register", json={"username": "ab", "password": "short"}, timeout=HTTP_S)
    assert bad.status_code == 422
    assert bad.json()["errors"]["username"] == "Username must be 3 to 24 letters, digits or _."
    assert bad.json()["errors"]["password"] == "Password must be at least 8 characters."
    wrong = httpx.post(f"{app_url}/api/auth/login", json={"username": name, "password": PASSWORD + "x"}, timeout=HTTP_S)
    assert wrong.status_code == 401 and wrong.json() == {"error": "invalid_credentials"}
    assert anon.post("/api/auth/logout").status_code == 204
    me = anon.get("/api/me")
    assert me.status_code == 401 and me.json() == {"error": "unauthenticated"}
    assert httpx.post(f"{app_url}/api/auth/login", json={"username": name, "password": PASSWORD}, timeout=HTTP_S).status_code == 200

    viewer, explorer, other_explorer = fresh("vw"), fresh("ex"), fresh("ex")
    w = world(app_url, members={viewer: "viewer", explorer: "explorer", other_explorer: "explorer"},
              sheets=[sheet("S", rows=["Region"], columns=[M("Sales")])])
    draft = world(app_url, state="draft", members={viewer: "viewer"}, sheets=[sheet("D", rows=["Region"])])
    outsider, _, own_project, oc = creator_project(app_url)
    missing = "zz" + secrets.token_hex(8)
    for path in ("/api/workbooks/{}", "/api/sources/{}", "/api/projects/{}", "/api/sheets/{}"):
        real = {"/api/workbooks/{}": w.workbook_id, "/api/sources/{}": w.source_id,
                "/api/projects/{}": w.project_id, "/api/sheets/{}": w.sheets["S"]}[path]
        a, b = oc.get(path.format(real)), oc.get(path.format(missing))
        assert (a.status_code, a.json()) == (b.status_code, b.json()) == (404, {"error": "not_found"}), (path, a.text, b.text)
    assert httpx.get(f"{app_url}/api/workbooks/{missing}", timeout=HTTP_S).status_code == 401
    r = oc.post(f"/api/sources/{w.source_id}/refresh")
    assert r.status_code == 404 and r.json() == {"error": "not_found"}, "404 comes before 403"
    r = client(app_url, viewer).post(f"/api/sources/{w.source_id}/refresh")
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    r = oc.post(f"/api/projects/{own_project}/workbooks", json={"name": fresh("wb"), "source": w.source_id})
    assert r.status_code == 404 and r.json() == {"error": "not_found"}, "a foreign id inside a body answers 404"
    r = client(app_url, viewer).get(f"/api/workbooks/{draft.workbook_id}")
    assert r.status_code == 404, "a viewer asking for a draft gets 404"
    copy = client(app_url, explorer).post(f"/api/sheets/{w.sheets['S']}/copy")
    assert copy.status_code == 201, copy.text
    assert client(app_url, explorer).get(f"/api/sheets/{copy.json()['id']}").status_code == 200
    assert client(app_url, other_explorer).get(f"/api/sheets/{copy.json()['id']}").status_code == 404
    r = httpx.post(f"{app_url}/api/projects", content=b"name", headers={"Content-Type": "text/plain"}, timeout=HTTP_S)
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}, "415 comes before 401"
    big = json.dumps({"name": "x" * JSON_MAX_BYTES}).encode()
    r = oc.post("/api/projects", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "too_large"}


def test_wf_publishing_happy(browser: Browser, app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, state="draft", sheets=[sheet("S", rows=["Region"], columns=[M("Sales")])])
    seed(app_url, {"users": [{"username": viewer, "password": PASSWORD}]})
    v = client(app_url, viewer)
    with visit(browser, app_url, w.creator, f"/projects/{w.project_id}") as page:
        fill(page.get_by_role("textbox", name="Member username", exact=True), viewer)
        select(page.get_by_role("combobox", name="Role", exact=True), "Viewer")
        click(page.get_by_role("button", name="Add member", exact=True))
        announced(page, "Announcements", f"Member added: {viewer} as viewer.")
        expect(page.get_by_role("table", name="Members")).to_contain_text(viewer)
        assert v.get(f"/api/workbooks/{w.workbook_id}").status_code == 404, "a draft is hidden from viewers"
        with visit(browser, app_url, viewer, f"/workbooks/{w.workbook_id}") as other:
            expect(other.get_by_role("heading", name="Not found.", exact=True)).to_be_visible()

        page.goto(f"{app_url}/workbooks/{w.workbook_id}")
        settle_page(page)

        def publish() -> None:
            click(page.get_by_role("button", name="Publish", exact=True))
            dialog = page.get_by_role("dialog", name="Publish", exact=True)
            select(dialog.get_by_role("combobox", name="Project", exact=True), w.project)
            click(dialog.get_by_role("button", name="Publish workbook", exact=True))
            announced(page, "Publish state", f"Published to {w.project}.")

        publish()
        click(page.get_by_role("button", name="Certify", exact=True))
        announced(page, "Certified", f"Certified by {w.creator}")
        with visit(browser, app_url, viewer, f"/workbooks/{w.workbook_id}") as other:
            announced(other, "Certified", f"Certified by {w.creator}")
        listed = {x["id"]: x for x in v.get("/api/workbooks").json()}
        assert listed[w.workbook_id]["state"] == "published" and listed[w.workbook_id]["certified_by"] == w.creator
        r = v.put(f"/api/sheets/{w.sheets['S']}", json={k: x for k, x in sheet("S").items() if k != "calcs"},
                  headers={"If-Match": str(workbook_version(v, w.workbook_id))})
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}
        assert v.post(f"/api/workbooks/{w.workbook_id}/certify").status_code == 403
        publish()
        eventually(page, lambda: expect(page.get_by_role("status", name="Certified", exact=True)).to_have_text("", timeout=POLL_MS),
                   "a later publish clears the certification")
    assert client(app_url, w.creator).get(f"/api/workbooks/{w.workbook_id}").json()["certified_by"] is None


def test_wf_publishing_conflict(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[sheet("S", rows=["Region"], columns=[M("Sales")])])
    c = client(app_url, w.creator)
    with visit(browser, app_url, w.creator, f"/workbooks/{w.workbook_id}") as page:
        assert put_sheet(c, w.workbook_id, w.sheets["S"], sheet("S", rows=["Category"], columns=[M("Sales")])).status_code == 200
        click(page.get_by_role("button", name="Publish", exact=True))
        dialog = page.get_by_role("dialog", name="Publish", exact=True)
        select(dialog.get_by_role("combobox", name="Project", exact=True), w.project)
        click(dialog.get_by_role("button", name="Publish workbook", exact=True))
        announced(page, "Publish state", "This workbook changed since you opened it. Reload and publish again.")
    assert c.get(f"/api/workbooks/{w.workbook_id}").json()["state"] == "draft"
    r = c.post(f"/api/workbooks/{w.workbook_id}/certify")
    assert r.status_code == 409 and r.json()["error"] == "not_published"


def test_row_level_security_surfaces(app_url: str) -> None:
    south, nobody = fresh("south"), fresh("none")
    w = world(app_url, members={south: "viewer", nobody: "viewer"}, entitlements={south: ["South"]},
              sets=[{"name": "Top stockists", "field": "Stockist", "top": {"n": 2, "by": M("Sales")}}], sheets=[
        sheet("By category", rows=["Category"], columns=[M("Sales")], totals=True,
              reference_lines=[{"type": "average", "value": None, "parameter": None}]),
        sheet("Whole", rows=["Category"], label=[M("WholeSales", "AVG")], calcs=[{"name": "WholeSales", "formula": "{SUM([Sales])}"}]),
        sheet("At", rows=["Region"], label=[M("AtSales", "AVG")], calcs=[{"name": "AtSales", "formula": "{AT [Region] : SUM([Sales])}"}]),
        sheet("Top", rows=["Top stockists", "Stockist"], columns=[M("Sales")]),
    ])
    s = client(app_url, south)
    r = query(s, w.sheets["By category"])
    assert_values(by(ok_rows(r), "Category", "Sales"), {"Black": None, "Green": 30, "Herbal": 30}, "south by Category")
    assert any(near(v, 60) for v in r.json()["total"] if isinstance(v, (int, float)) and not isinstance(v, bool)), r.json()["total"]
    assert not any(near(v, 1320) for v in r.json()["total"] if isinstance(v, (int, float)) and not isinstance(v, bool))
    assert near(r.json()["reference_lines"][0]["value"], 30)
    members = lambda f: s.post(f"/api/sheets/{w.sheets['By category']}/members",
                               json={"field": f, "step": "dimension", "filters": [], "parameters": {}}).json()["members"]
    assert members("Stockist") == ["Dune Mug"]
    assert sorted(members("Product")) == ["Ember Assam", "Moss Sencha", "Quiet Mint"]
    assert [near(r_["AVG WholeSales"], 60) for r_ in ok_rows(query(s, w.sheets["Whole"]))] == [True, True, True]
    assert_values(by(ok_rows(query(s, w.sheets["At"])), "Region", "AVG AtSales"), {"South": 60}, "AT for south")
    top = ok_rows(query(s, w.sheets["Top"]))
    assert {r_["Stockist"] for r_ in top if r_["Top stockists"] == "In"} == {"Dune Mug"}
    for user in (nobody, w.creator):
        assert NO_ROWS in notices_of(query(client(app_url, user), w.sheets["By category"])), user


def test_wf_row_security_two_readers(browser: Browser, app_url: str) -> None:
    south, north = fresh("south"), fresh("north")
    w = world(app_url, members={south: "viewer", north: "viewer"}, entitlements={south: ["South"], north: ["North"]},
              sheets=[sheet("Regions", rows=["Region"], columns=[M("Sales")]),
                      sheet("Categories", rows=["Category"], columns=[M("Sales")])],
              dashboards=[{"name": "Shared", "layout": _hz("Regions", "Categories"), "floating": [], "phone_order": [],
                           "phone_heights": {}, "actions": []}])
    for user, own, other, line in ((south, "South", "North", "South,60"), (north, "North", "South", "North,480")):
        with visit(browser, app_url, user, f"/dashboards/{w.dashboards['Shared']}") as page:
            regions = page.get_by_role("region", name=REGIONS, exact=True)
            eventually(page, lambda: _equal(list(twin_values(regions, REGIONS)), [own]), f"{user} sees only {own}")
            with page.expect_response(lambda r: r.url.endswith("/api/exports") and r.request.method == "POST") as posted:
                click(page.get_by_role("button", name="Export crosstab", exact=True))
            job_id = posted.value.json()["id"]
            announced(page, "Export state", "Ready")
            with page.expect_download() as download:
                click(page.get_by_role("link", name="Download crosstab", exact=True))
            data = Path(download.value.path()).read_bytes()
        text = data.decode("utf-8")
        lines = text.split("\r\n")
        assert REGIONS in lines and line in lines, lines
        assert other not in text, f"{user}'s crosstab holds {other} rows"
        assert S3().get(f"exports/{job_id}.csv") == data


def test_wf_row_security_by_id(browser: Browser, app_url: str) -> None:
    south_world = world(app_url, sheets=[sheet("S", rows=["Region"], columns=[M("Sales")])])
    north_world = world(app_url, sheets=[sheet("N", rows=["Region"], columns=[M("Sales")])])
    north = north_world.creator
    with visit(browser, app_url, north, f"/workbooks/{south_world.workbook_id}") as page:
        expect(page.get_by_role("heading", name="Not found.", exact=True)).to_be_visible()
    c = client(app_url, north)
    a = c.get(f"/api/workbooks/{south_world.workbook_id}")
    b = c.get(f"/api/workbooks/zz{secrets.token_hex(8)}")
    assert (a.status_code, a.json()) == (b.status_code, b.json()) == (404, {"error": "not_found"})
    assert south_world.workbook_id not in {x["id"] for x in c.get("/api/workbooks").json()}


def _replace(c: httpx.Client, source_id: str, csv: str) -> None:
    r = c.put(f"/api/sources/{source_id}/tables/orders", content=csv.encode(), headers={"Content-Type": "text/csv"})
    assert r.status_code == 200, r.text


def test_scheduled_extract_refresh(app_url: str) -> None:
    t0 = datetime(2027, 6, 1, tzinfo=timezone.utc)
    grading(app_url, "clock", {"set": iso(t0)})
    w = world(app_url, sheets=[sheet("Total", rows=["Category"], label=[M("Sales")])])
    c = client(app_url, w.creator)
    extract = lambda: c.get(f"/api/sources/{w.source_id}/extract").json()
    total = lambda: sum(float(r["Sales"]) for r in ok_rows(query(c, w.sheets["Total"])) if r["Sales"] is not None)
    hour = timedelta(minutes=EVERY_MINUTES)

    bad = c.put(f"/api/sources/{w.source_id}/schedule", json={"every_minutes": 0, "kind": "full", "key": None})
    assert bad.status_code == 422 and "Every minutes must be a whole number from 1 to 10080." in bad.json()["errors"].values()
    bad = c.put(f"/api/sources/{w.source_id}/schedule", json={"every_minutes": EVERY_MINUTES, "kind": "incremental", "key": "Product"})
    assert bad.status_code == 422 and "Incremental refresh needs a number or date key." in bad.json()["errors"].values()
    r = c.put(f"/api/sources/{w.source_id}/schedule", json={"every_minutes": EVERY_MINUTES, "kind": "full", "key": None})
    assert r.status_code == 200 and parse_time(r.json()["next_run_at"]) == t0 + hour, r.text

    order17 = f"17,2027-03-20,S1,Moss Sencha,Green,1,{ORDER_17_SALES}\n"
    _replace(c, w.source_id, ORDERS_CSV + order17)
    grading(app_url, "clock", {"advance_ms": EVERY_MINUTES * 60000 - 60000})
    assert extract()["rows"] == 16, "a refresh ran before it was due"
    grading(app_url, "clock", {"advance_ms": 60000})
    e = extract()
    assert e["rows"] == 17 and e["state"] == "live" and parse_time(e["last_success_at"]) == t0 + hour, e
    assert parse_time(e["next_run_at"]) == t0 + 2 * hour
    assert near(total(), 1420)

    grading_source(app_url, "refresh-failure", w.source_id, w.source, {"times": 1})
    _replace(c, w.source_id, ORDERS_CSV + order17 + "18,2027-03-21,S1,Moss Sencha,Green,1,50\n")
    grading(app_url, "clock", {"advance_ms": EVERY_MINUTES * 60000})
    e = extract()
    assert e["state"] == "refresh_failed" and e["rows"] == 17, e
    assert parse_time(e["last_failure_at"]) == t0 + 2 * hour and parse_time(e["last_success_at"]) == t0 + hour
    assert near(total(), 1420), "a failed refresh must keep the last good snapshot"
    grading(app_url, "clock", {"advance_ms": EVERY_MINUTES * 60000})
    assert extract()["rows"] == 18 and extract()["state"] == "live"

    r = c.put(f"/api/sources/{w.source_id}/schedule", json={"every_minutes": EVERY_MINUTES, "kind": "incremental", "key": "Order"})
    assert r.status_code == 200, r.text
    _replace(c, w.source_id, ORDERS_CSV + order17 + "20,2027-03-22,S1,Moss Sencha,Green,1,5\n")
    grading(app_url, "clock", {"advance_ms": EVERY_MINUTES * 60000})
    assert extract()["rows"] == 19, "incremental should append only Order 20 and keep Order 18"

    assert c.delete(f"/api/sources/{w.source_id}/schedule").status_code == 204
    assert extract()["stale"] is False
    grading(app_url, "clock", {"advance_ms": STALE_MS - 1})
    assert extract()["stale"] is False
    grading(app_url, "clock", {"advance_ms": 1})
    assert extract()["stale"] is True


def test_alerts_and_inbox(app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, sheets=[sheet("Total", label=[M("Sales")])])
    c, v = client(app_url, w.creator), client(app_url, viewer)
    bad = v.post(f"/api/sheets/{w.sheets['Total']}/alerts", json={"name": "Total sales", "measure": M("Sales"), "above": "x"})
    assert bad.status_code == 422 and bad.json()["errors"]["above"] == "Above must be a number."
    r = v.post(f"/api/sheets/{w.sheets['Total']}/alerts", json={"name": "Total sales", "measure": M("Sales"), "above": ALERT_THRESHOLD})
    assert r.status_code == 201 and r.json()["armed"] is True, r.text

    def refresh_with(csv: str) -> list[str]:
        _replace(c, w.source_id, csv)
        assert c.post(f"/api/sources/{w.source_id}/refresh").json()["state"] == "live"
        return [i["text"] for i in v.get("/api/inbox").json()["items"] if i["text"].startswith("Total sales")]

    item = lambda value: INBOX_ITEM.format(alert="Total sales", threshold="1,400", value=value)
    assert refresh_with(ORDERS_CSV) == []
    assert refresh_with(ORDERS_CSV + "17,2027-03-20,S1,Moss Sencha,Green,1,100\n") == [item("1,420")]
    assert refresh_with(ORDERS_CSV + "17,2027-03-20,S1,Moss Sencha,Green,1,180\n") == [item("1,420")]
    assert refresh_with(ORDERS_CSV.replace(ORDER_15_LINE, "")) == [item("1,420")]
    grading(app_url, "clock", {"advance_ms": 60000})
    assert refresh_with(ORDERS_CSV + "17,2027-03-20,S1,Moss Sencha,Green,1,130\n") == [item("1,450"), item("1,420")]
    assert v.get("/api/inbox").json()["unread"] >= 2
    assert v.post("/api/inbox/read").json() == {"unread": 0}

    south = fresh("south")
    sw = world(app_url, members={south: "viewer"}, entitlements={south: ["South"]}, sheets=[sheet("Total", label=[M("Sales")])])
    s = client(app_url, south)
    assert s.post(f"/api/sheets/{sw.sheets['Total']}/alerts",
                  json={"name": "South sales", "measure": M("Sales"), "above": 50}).status_code == 201
    assert client(app_url, sw.creator).post(f"/api/sources/{sw.source_id}/refresh").status_code == 200
    texts = [i["text"] for i in s.get("/api/inbox").json()["items"]]
    assert INBOX_ITEM.format(alert="South sales", threshold=50, value=60) in texts, texts
    assert not any("1,320" in t for t in texts)


def test_wf_extracts_alerts_live(browser: Browser, app_url: str) -> None:
    t0 = datetime(2027, 5, 1, tzinfo=timezone.utc)
    grading(app_url, "clock", {"set": iso(t0)})
    explorer = fresh("ex")
    w = world(app_url, members={explorer: "explorer"}, sheets=[sheet("Total", label=[M("Sales")])])
    c = client(app_url, w.creator)
    assert c.put(f"/api/sources/{w.source_id}/schedule",
                 json={"every_minutes": EVERY_MINUTES, "kind": "full", "key": None}).status_code == 200
    hour = timedelta(minutes=EVERY_MINUTES)
    with visit(browser, app_url, explorer, w.sheet_path("Total")) as page:
        page.clock.set_system_time(datetime(2031, 1, 1, tzinfo=timezone.utc))
        state = page.get_by_role("status", name="Extract state", exact=True)
        grading(app_url, "clock", {"advance_ms": EVERY_MINUTES * 60000})
        expect(state).to_have_text(FRESH.format(t=minute(t0 + hour)), timeout=WAIT_S * 1000)
        grading_source(app_url, "refresh-failure", w.source_id, w.source, {"times": 1})
        grading(app_url, "clock", {"advance_ms": EVERY_MINUTES * 60000})
        expect(state).to_have_text(FAILED.format(f=minute(t0 + 2 * hour), s=minute(t0 + hour)), timeout=WAIT_S * 1000)
        grading(app_url, "clock", {"advance_ms": EVERY_MINUTES * 60000})
        expect(state).to_have_text(FRESH.format(t=minute(t0 + 3 * hour)), timeout=WAIT_S * 1000)
    e = c.get(f"/api/sources/{w.source_id}/extract").json()
    assert parse_time(e["last_success_at"]) == t0 + 3 * hour and parse_time(e["last_failure_at"]) == t0 + 2 * hour


def test_wf_extracts_alerts_stale_inbox(browser: Browser, app_url: str) -> None:
    t0 = datetime(2027, 7, 1, tzinfo=timezone.utc)
    grading(app_url, "clock", {"set": iso(t0)})
    explorer = fresh("ex")
    w = world(app_url, members={explorer: "explorer"}, sheets=[sheet("Total", label=[M("Sales")])])
    c, e = client(app_url, w.creator), client(app_url, explorer)
    assert e.post(f"/api/sheets/{w.sheets['Total']}/alerts",
                  json={"name": "Total sales", "measure": M("Sales"), "above": ALERT_THRESHOLD}).status_code == 201
    with visit(browser, app_url, explorer, w.sheet_path("Total")) as page, \
            visit(browser, app_url, w.creator, f"/sources/{w.source_id}") as other:
        page.clock.set_system_time(datetime(2020, 1, 1, tzinfo=timezone.utc))
        expect(page.get_by_role("link", name=INBOX_LINK.format(n=0))).to_be_visible()
        _replace(c, w.source_id, ORDERS_CSV + "17,2027-03-20,S1,Moss Sencha,Green,1,100\n")
        refreshed = c.post(f"/api/sources/{w.source_id}/refresh").json()
        expect(page.get_by_role("link", name=INBOX_LINK.format(n=1))).to_be_visible(timeout=WAIT_S * 1000)
        last = parse_time(refreshed["last_success_at"])
        state = page.get_by_role("status", name="Extract state", exact=True)
        expect(state).to_have_text(FRESH.format(t=minute(last)), timeout=WAIT_S * 1000)
        grading(app_url, "clock", {"advance_ms": STALE_MS})
        expect(state).to_have_text(STALE.format(t=minute(last)), timeout=WAIT_S * 1000)
        expect(other.get_by_role("status", name="Extract state", exact=True)).to_have_text(
            STALE.format(t=minute(last)), timeout=WAIT_S * 1000)
    assert e.get("/api/inbox").json()["unread"] == 1


def test_export_jobs(app_url: str) -> None:
    viewer, other = fresh("vw"), fresh("vw")
    w = world(app_url, members={viewer: "viewer", other: "viewer"},
              sheets=[sheet(EXPORT_SHEET, rows=["Region"], columns=[M("Sales")])])
    v = client(app_url, viewer)
    body = {"kind": "csv", "sheet": w.sheets[EXPORT_SHEET], "filters": [], "parameters": {}}
    events: list[tuple[str, str]] = []
    with exports_paused(app_url) as resume:
        r = v.post("/api/exports", json=body)
        assert r.status_code == 202 and r.json()["status"] == "queued" and r.json()["progress"] == 0, r.text
        job_id = r.json()["id"]
        again = v.post("/api/exports", json=body)
        assert again.status_code == 200 and again.json()["id"] == job_id
        assert v.get(f"/api/exports/{job_id}").json()["download"] is None
        assert v.get(f"/api/exports/{job_id}/file").json() == {"error": "not_ready"}
        assert v.post(f"/api/exports/{job_id}/retry").json() == {"error": "not_failed"}
        assert client(app_url, other).get(f"/api/exports/{job_id}").status_code == 404
        assert f"exports/{job_id}.csv" not in S3().keys("exports/")

        def listen() -> None:
            with httpx.Client(base_url=app_url, cookies=v.cookies, timeout=HTTP_S) as lc:
                with lc.stream("GET", f"/api/exports/{job_id}/events") as stream:
                    for item in sse(stream, time.monotonic() + WAIT_S):
                        events.append(item)
                        if item[0] == "end":
                            return

        listener = threading.Thread(target=listen)
        listener.start()
        deadline = time.monotonic() + WAIT_S
        while not events and time.monotonic() < deadline:
            listener.join(0.05)
        resume()
        listener.join(WAIT_S)
    states = [json.loads(d) for k, d in events if k == "state"]
    assert [(s["status"], s["progress"]) for s in states] == [("queued", 0), ("rendering", 50), ("ready", 100)], events
    assert events[-1][0] == "end" and json.loads(events[-1][1]) == {"status": "ready"}
    job = v.get(f"/api/exports/{job_id}").json()
    assert job["download"] == f"/api/exports/{job_id}/file" and job["progress"] == 100
    stored = S3().get(f"exports/{job_id}.csv")
    file = v.get(f"/api/exports/{job_id}/file")
    assert file.status_code == 200 and file.content == stored
    assert file.headers["content-type"].startswith("text/csv") and "charset=utf-8" in file.headers["content-type"].lower()
    assert f'filename="{EXPORT_SHEET}.csv"' in file.headers["content-disposition"]

    with storage_down(app_url):
        assert v.get(f"/api/exports/{job_id}/file").json() == {"error": "storage_unavailable"}
        assert v.get(f"/api/exports/{job_id}").json()["status"] == "ready"
        r = v.post("/api/exports", json={**body, "kind": "png"})
        failed_id = r.json()["id"]
        failed = wait_export(v, failed_id, {"failed", "ready"})
        assert failed["status"] == "failed" and failed["progress"] == 0 and failed["download"] is None, failed
        assert f"exports/{failed_id}.png" not in S3().keys("exports/")
    r = v.post(f"/api/exports/{failed_id}/retry")
    assert r.status_code == 202 and r.json()["status"] == "queued"
    assert wait_export(v, failed_id, {"ready", "failed"})["status"] == "ready"
    assert png_size(S3().get(f"exports/{failed_id}.png")) == (PNG_W, PNG_H)


def test_export_contents(app_url: str) -> None:
    _, _, project_id, c = creator_project(app_url)
    texts = [*FORMULA_CELLS, QUOTED_CELL, TAB_CELL]
    amounts = [-5, 10, 3, 4, 1200, 0]
    secret_cells = [f"s{n}" for n in range(1, len(texts) + 1)]

    def quote(cell: str) -> str:
        return '"' + cell.replace('"', '""') + '"' if any(ch in cell for ch in (",", '"', "\r", "\n")) else cell

    def neutralise(cell: str) -> str:
        return "'" + cell if cell.startswith(("=", "+", "-", "@", "\t", "\r")) else cell

    body = "\n".join([f"{COL_NAME},{COL_AMOUNT},{COL_SECRET}"]
                     + [f"{quote(t)},{a},{s}" for t, a, s in zip(texts, amounts, secret_cells)]) + "\n"
    r = upload(c, project_id, fresh("src"), "t", body.encode())
    assert r.status_code == 201, r.text
    source_id = r.json()["id"]
    secret = fields_of(c, source_id)[COL_SECRET]["id"]
    wb = new_workbook(c, project_id, source_id)
    sid = add_sheet(c, wb, sheet(INJECT_SHEET, rows=[COL_NAME], columns=[M(COL_AMOUNT)], totals=True))
    secret_sheet = add_sheet(c, wb, sheet(SECRET_SHEET, rows=[COL_NAME, COL_SECRET], columns=[M(COL_AMOUNT)]))
    assert c.patch(f"/api/sources/{source_id}/fields/{secret}", json={"hidden": True}).status_code == 200
    at_least = F(COL_AMOUNT, "measure", agg="SUM", min=3)
    kept = sorted((t, a) for t, a in zip(texts, amounts) if a >= 3)
    total = sum(a for _, a in kept)

    csv_job = export(c, "csv", {"sheet": sid}, [at_least])
    raw = c.get(csv_job["download"]).content
    assert not raw.startswith(b"\xef\xbb\xbf")
    lines = raw.decode("utf-8").split("\r\n")
    assert lines[0] == f"{COL_NAME},{COL_AMOUNT}"
    assert lines[1:len(kept) + 2] == [f"{quote(neutralise(t))},{a}" for t, a in kept] + [f"Grand total,{total}"], lines
    assert "\n" not in raw.decode("utf-8").replace("\r\n", "")
    unfiltered = c.get(export(c, "csv", {"sheet": sid})["download"]).content.decode("utf-8").split("\r\n")
    for t, a in zip(texts, amounts):
        if t.startswith(("=", "+", "-", "@", "\t")):
            assert f"'{t},{a}" in unfiltered, unfiltered

    pdf = pdf_text(c.get(export(c, "pdf", {"sheet": sid}, [at_least])["download"]).content)
    expected = [INJECT_SHEET, f"Filters: {COL_AMOUNT} is at least 3", INJECT_SHEET, f"{COL_NAME} | {COL_AMOUNT}"]
    expected += [f"{t} | {a:,}" for t, a in kept] + [f"Grand total | {total:,}"]
    position = 0
    for line in expected:
        found = pdf.find(line, position)
        assert found >= 0, f"PDF lacks {line!r} after position {position}: {pdf!r}"
        position = found + len(line)
    assert FORMULA_CELLS[0] not in pdf

    png = c.get(export(c, "png", {"sheet": sid})["download"]).content
    assert png_size(png) == (PNG_W, PNG_H)
    assert decode(png).variance() > 0, "the PNG is blank"

    hidden = c.get(export(c, "csv", {"sheet": secret_sheet})["download"]).content.decode("utf-8")
    assert COL_SECRET not in hidden and not set(secret_cells) & set(hidden.replace("\r\n", ",").split(",")), hidden


def test_wf_exports_happy(browser: Browser, app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, sheets=[
        sheet("Black teas", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL, F("Category", "dimension", ["Black"])])])
    with visit(browser, app_url, viewer, w.sheet_path("Black teas")) as page:
        status = page.get_by_role("status", name="Export state", exact=True)
        progress = page.get_by_role("progressbar", name="Export progress")
        for kind, label, ext in (("crosstab", "Export crosstab", "csv"), ("PDF", "Export PDF", "pdf"), ("PNG", "Export PNG", "png")):
            with exports_paused(app_url) as resume:
                with page.expect_response(lambda r: r.url.endswith("/api/exports") and r.request.method == "POST") as posted:
                    click(page.get_by_role("button", name=label, exact=True))
                job_id = posted.value.json()["id"]
                expect(status).to_have_text("Queued", timeout=WAIT_S * 1000)
                expect(progress).to_have_attribute("aria-valuenow", "0")
                expect(page.get_by_role("link", name=f"Download {kind}", exact=True)).to_have_count(0)
                resume()
                expect(status).to_have_text("Ready", timeout=WAIT_S * 1000)
            expect(progress).to_have_attribute("aria-valuenow", "100")
            with page.expect_download() as download:
                click(page.get_by_role("link", name=f"Download {kind}", exact=True))
            data = Path(download.value.path()).read_bytes()
            assert data == S3().get(f"exports/{job_id}.{ext}")
            if ext == "csv":
                lines = data.decode("utf-8").split("\r\n")
                assert {"East,150", "North,150", "West,280"} <= set(lines) and "Green" not in data.decode("utf-8"), lines
            elif ext == "pdf":
                assert "Black teas" in pdf_text(data)
            else:
                assert png_size(data) == (PNG_W, PNG_H)


def test_wf_exports_outage(browser: Browser, app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, sheets=[sheet("Regions", rows=["Region"], columns=[M("Sales")])])
    with visit(browser, app_url, viewer, w.sheet_path("Regions")) as page:
        status = page.get_by_role("status", name="Export state", exact=True)
        with storage_down(app_url):
            with page.expect_response(lambda r: r.url.endswith("/api/exports") and r.request.method == "POST") as posted:
                click(page.get_by_role("button", name="Export PNG", exact=True))
            job_id = posted.value.json()["id"]
            expect(status).to_have_text("Failed. Try again.", timeout=WAIT_S * 1000)
            expect(page.get_by_role("progressbar", name="Export progress")).to_have_attribute("aria-valuenow", "0")
            expect(page.get_by_role("link", name="Download PNG", exact=True)).to_have_count(0)
        click(page.get_by_role("button", name="Try again", exact=True))
        expect(status).to_have_text("Ready", timeout=WAIT_S * 1000)
        expect(page.get_by_role("link", name="Download PNG", exact=True)).to_be_visible()
    assert png_size(S3().get(f"exports/{job_id}.png")) == (PNG_W, PNG_H)


def test_regions_dialogs_focus(browser: Browser, app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, parameters=[TOP_COUNT],
              sheets=[sheet("Focus", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL])])
    with visit(browser, app_url, w.creator, w.sheet_path("Focus")) as page:
        region = lambda n: page.get_by_role("region", name=n, exact=True)
        expect_twin_values(page, page, "Focus", {"East": "435", "North": "480", "South": "60", "West": "325"}, "marks")
        page.get_by_role("button", name="Region on Rows", exact=True).focus()
        for name in ("View", "Data table", "Fields", "Shelves"):
            page.keyboard.press("F6")
            assert holds_focus(region(name)), f"F6 did not move focus into {name}"
        page.keyboard.press("Shift+F6")
        assert holds_focus(region("Fields"))
        region("View").locator("[data-mark]").first.focus()
        page.keyboard.press("F6")
        assert holds_focus(region("Data table")), "F6 from a mark"
        for name in ("Fields", "View"):
            if name == "View":
                region(name).locator("[data-mark]").first.focus()
            else:
                page.get_by_role("listbox", name="Fields").get_by_role("option").first.focus()
            for _ in range(40):
                page.keyboard.press("Tab")
                if not holds_focus(region(name)):
                    break
            else:
                pytest.fail(f"Tab never left region {name}")
        for status in ("View announcements", "View notice"):
            expect(page.get_by_role("status", name=status, exact=True)).to_have_attribute("aria-live", "polite")

        opener = page.get_by_role("button", name="New calculation", exact=True)
        click(opener)
        dialog = page.get_by_role("dialog", name="Calculation", exact=True)
        expect(dialog.get_by_role("textbox", name="Calculation name", exact=True)).to_be_focused()
        page.keyboard.press("Shift+Tab")
        assert holds_focus(dialog), "Shift+Tab from the first control left the dialog"
        for _ in range(30):
            page.keyboard.press("Tab")
            assert holds_focus(dialog), "Tab left the open dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()

    with visit(browser, app_url, viewer, w.sheet_path("Focus")) as page:
        region = lambda n: page.get_by_role("region", name=n, exact=True)
        region("Controls").get_by_role("spinbutton", name="Top count").focus()
        for name in ("View", "Data table", "Controls"):
            page.keyboard.press("F6")
            assert holds_focus(region(name)), f"F6 on the published view did not reach {name}"


def test_mark_glide(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[sheet(n, rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]) for n in ("Glide", "Still")])

    def drop_south(page: Page) -> None:
        add_by_keyboard(page, "Region, dimension", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Region", exact=True)
        dialog.get_by_role("checkbox", name="South", exact=True).set_checked(False)
        for member in ("East", "North", "West"):
            dialog.get_by_role("checkbox", name=member, exact=True).set_checked(True)
        click(dialog.get_by_role("button", name="Apply", exact=True))
        announced(page, "View announcements", "Filtered: 3 marks.")

    with visit(browser, app_url, w.creator, w.sheet_path("Glide"), glide=True) as page:
        expect_twin_values(page, page, "Glide", {"East": "435", "North": "480", "South": "60", "West": "325"}, "start")
        glide_reset(page)
        drop_south(page)
        glide_finish(page)
        glides = [r for r in glide_records(page) if r["id"] == "mark-glide"]
        for mark in ("East", "North", "West"):
            mine = [r for r in glides if r["mark"] == mark]
            assert len(mine) == 1 and mine[0]["duration"] == GLIDE_MS, (mark, glide_records(page))
        assert not [r for r in glide_records(page) if r["mark"] == "South"], "a gone mark animated"

        glide_reset(page)
        click(page.get_by_role("button", name="Expand Region", exact=True))
        announced(page, "View announcements", "Expanded Region.")
        glide_finish(page)
        assert [r for r in glide_records(page) if r["id"] == "mark-glide"] == [], "new marks must not animate"

    with visit(browser, app_url, w.creator, w.sheet_path("Still"), glide=True, reduced_motion="reduce") as page:
        expect_twin_values(page, page, "Still", {"East": "435", "North": "480", "South": "60", "West": "325"}, "start")
        glide_reset(page)
        drop_south(page)
        assert glide_records(page) == [] and page.evaluate("() => document.getAnimations().length") == 0


def test_platform_routes(app_url: str) -> None:
    health = httpx.get(f"{app_url}/api/health", timeout=HTTP_S)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    with storage_down(app_url):
        expect_health(app_url, "unavailable")
    expect_health(app_url, "ok")
    config = httpx.get(f"{app_url}/api/config", timeout=HTTP_S).json()
    assert set(config) >= {"formula_max_chars", "formula_max_depth", "mark_max", "formula_debounce_ms", "row_max",
                           "csv_max_bytes", "sse_heartbeat_ms"}
    assert (config["formula_max_chars"], config["formula_max_depth"], config["mark_max"], config["row_max"],
            config["csv_max_bytes"]) == (FORMULA_MAX_CHARS, FORMULA_MAX_DEPTH, MARK_MAX, ROW_MAX, CSV_MAX_BYTES)
    cross = httpx.get(f"{app_url}/api/health", headers={"Origin": "http://elsewhere.invalid"}, timeout=HTTP_S)
    assert not [k for k in cross.headers if k.lower().startswith(CORS_PREFIX)]

    t1 = datetime(2027, 8, 1, tzinfo=timezone.utc)
    assert parse_time(grading(app_url, "clock", {"set": iso(t1)})["now"]) == t1
    w = world(app_url)
    c = client(app_url, w.creator)
    assert parse_time(c.get("/api/time").json()["server_now"]) == t1
    assert parse_time(grading(app_url, "clock", {"advance_ms": 60000})["now"]) == t1 + timedelta(minutes=1)
    t2 = t1 + timedelta(days=1)

    seen: dict[str, Any] = {"extract": [], "heartbeat": False, "clock": []}
    deadline = time.monotonic() + WAIT_S + 3 * config["sse_heartbeat_ms"] / 1000
    with c.stream("GET", "/api/events") as stream:
        assert stream.headers["content-type"].startswith("text/event-stream")
        order: list[str] = []
        moved = False
        for kind, data in sse(stream, deadline):
            if kind == "comment":
                seen["heartbeat"] = seen["heartbeat"] or data.strip() == ": heartbeat"
            else:
                order.append(kind)
                payload = json.loads(data)
                if kind == "clock":
                    seen["clock"].append(parse_time(payload["server_now"]))
                if kind == "extract":
                    seen["extract"].append(payload)
                if kind == "inbox" and not moved:
                    grading(app_url, "clock", {"set": iso(t2)})
                    moved = True
            if seen["heartbeat"] and t2 in seen["clock"]:
                break
    assert order[0] == "clock" and "inbox" in order and order.index("inbox") > order.index("extract"), order
    mine = [e for e in seen["extract"] if e["source"] == w.source_id]
    assert mine and {"state", "stale", "last_success_at", "last_failure_at", "next_run_at"} <= set(mine[0])
    assert seen["heartbeat"], "no ': heartbeat' comment arrived"
    assert t2 in seen["clock"], "a grading clock change did not broadcast a clock event"


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing}"
    assert "Stack Sans Headline" in notices and "Stack Sans Text" in notices


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad}"
    assert "OFL" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores() -> None:
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "bullmq", "bull", "lowdb", "nedb",
                 "@seald-io/nedb", "level", "leveldown", "lmdb", "pouchdb", "memcached", "kafkajs", "amqplib"}
    assert not [p.name for p in shipped_packages() if p.name in forbidden]
    assert Postgres().tables(), "PostgreSQL holds no app tables"
    files = [p for pattern in ("*.sqlite", "*.sqlite3", "*.db") for p in Path(DEPLOYED_APP).rglob(pattern)
             if "node_modules" not in p.parts]
    assert not files, files


def test_if_same_origin(browser: Browser, app_url: str) -> None:
    w = world(app_url, sheets=[sheet("S", rows=["Region"], columns=[M("Sales")])])
    for user, path in ((None, "/"), (w.creator, w.sheet_path("S"))):
        with visit(browser, app_url, user, "/") as page:
            urls: list[str] = []
            page.on("request", lambda r: urls.append(r.url))
            page.goto(f"{app_url}{path}")
            settle_page(page)
            foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
            assert not foreign, foreign


def test_if_service_config(app_url: str) -> None:
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_S).json() == {"status": "ok"}
    _, _, project_id, c = creator_project(app_url)
    r = upload(c, project_id, fresh("src"), "orders", ORDERS_CSV.encode())
    assert r.status_code == 201
    sha = hashlib.sha256(ORDERS_CSV.encode()).hexdigest()
    assert S3().get(f"uploads/{r.json()['id']}/orders/{sha}.csv") == ORDERS_CSV.encode()


def test_if_typescript() -> None:
    skip = {"node_modules", "dist", "build", ".git", "out", "coverage", "public"}
    sources = [p for p in Path("/app").rglob("*") if p.is_file() and not skip & set(p.parts)]
    ts = [p for p in sources if p.suffix in {".ts", ".tsx"}]
    js = [p for p in sources if p.suffix in {".js", ".jsx", ".mjs", ".cjs"} and ".config." not in p.name and "scripts" not in p.parts]
    assert ts, "no TypeScript source found"
    assert not js, f"JavaScript source files: {js[:10]}"


def test_if_export_libraries(app_url: str) -> None:
    w = world(app_url, sheets=[sheet("Regions", rows=["Region"], columns=[M("Sales")])])
    c = client(app_url, w.creator)
    pdf = c.get(export(c, "pdf", {"sheet": w.sheets["Regions"]})["download"]).content
    assert pdf.startswith(b"%PDF") and "Regions" in pdf_text(pdf)
    png = c.get(export(c, "png", {"sheet": w.sheets["Regions"]})["download"]).content
    assert png_size(png) == (PNG_W, PNG_H)


def test_wf_build_view_heat_keyboard(browser: Browser, app_url: str) -> None:
    w = world(app_url, sheets=[sheet("Heat build", filters=[NOT_NULL])], state="draft")
    with visit(browser, app_url, w.creator, w.sheet_path("Heat build")) as page:
        view = page.get_by_role("region", name="View", exact=True)
        add_by_keyboard(page, "Region, dimension", "Rows")
        announced(page, "View announcements", "Added Region to Rows.")
        add_by_keyboard(page, "Category, dimension", "Columns")
        announced(page, "View announcements", "Added Category to Columns.")
        add_by_keyboard(page, "Sales, measure", "Color")
        announced(page, "View announcements", "Added Sales to Color.")
        expect_marks(page, view, {"East | Black": "150", "East | Green": "210", "East | Herbal": "75",
                                  "North | Black": "150", "North | Green": "210", "North | Herbal": "120",
                                  "South | Black": "", "South | Green": "30", "South | Herbal": "30",
                                  "West | Black": "280", "West | Herbal": "45"}, "heat map")
        marks = {m["mark"]: m for m in mark_data(view)}
        assert marks["East | Black"]["label"] == mark_label(["East", "Black"], "Sales", "150", "cell", 1, 11)
        assert marks["East | Black"]["color"] == "243, 159, 205" and marks["North | Green"]["color"] == "239, 119, 184"
        expect(page.get_by_role("list", name="Legend").get_by_role("listitem")).to_have_text(["30 to 280"])
        first = view.locator("[data-mark]").first
        first.focus()
        expect(page.get_by_role("tooltip")).to_have_text(tip(("Region", "East"), ("Category", "Black"), ("Sales", "150")))
        page.keyboard.press("ArrowRight")
        expect(view.locator("[data-mark]").nth(1)).to_be_focused()
        expect(page.get_by_role("tooltip")).to_have_text(tip(("Region", "East"), ("Category", "Green"), ("Sales", "210")))


def test_wf_query_order_top_n_context(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[sheet(
        "Top", rows=["Region"], columns=[M("Sales")],
        filters=[NOT_NULL, F("Region", "top", n=1, by=M("Sales")), F("Category", "dimension", ["Black"])])])
    with visit(browser, app_url, w.creator, w.sheet_path("Top")) as page:
        expect_twin(page, page, "Top", [(["North"], ["150"])], "top 1 beside a dimension filter")
        pill = page.get_by_role("button", name=pill_name("Category", "Filters"), exact=True)
        pill.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Filter Category", exact=True)
        check(dialog.get_by_role("checkbox", name="Context filter", exact=True))
        click(dialog.get_by_role("button", name="Apply", exact=True))
        expect(pill).to_be_focused()
        expect_twin(page, page, "Top", [(["West"], ["280"])], "top 1 after a context filter")
        announced(page, "View announcements", "Filtered: 1 marks.")


def test_wf_query_order_plus_dimension(browser: Browser, app_url: str) -> None:
    plus = {"name": "PlusSales", "formula": "{PLUS [Product] : SUM([Sales])}"}
    w = world(app_url, state="draft", sheets=[
        sheet("Plus", rows=["Region"], label=[M("PlusSales", "AVG")], filters=[NOT_NULL], calcs=[plus])])
    with visit(browser, app_url, w.creator, w.sheet_path("Plus")) as page:
        expect_twin(page, page, "Plus", [(["East"], ["145"]), (["North"], ["135"]), (["South"], ["30"]),
                                                 (["West"], ["108.3333"])], "unfiltered PLUS")
        add_by_keyboard(page, "Category, dimension", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Category", exact=True)
        click(dialog.get_by_role("radio", name="Members", exact=True))
        _only(dialog, "Black")
        click(dialog.get_by_role("button", name="Apply", exact=True))
        expect(page.get_by_role("button", name=pill_name("Category", "Filters"), exact=True)).to_be_focused()
        expect_twin(page, page, "Plus", [(["East"], ["150"]), (["North"], ["75"]), (["South"], [""]),
                                                 (["West"], ["140"])], "PLUS after a dimension filter")
        announced(page, "View announcements", "Filtered: 4 marks.")


def test_wf_query_order_share_after_measure(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[
        sheet("Shares", rows=["Region"], columns=[M("Sales", "SUM", TC("share", "table_down"))], filters=[NOT_NULL])])
    with visit(browser, app_url, w.creator, w.sheet_path("Shares")) as page:
        expect_twin(page, page, "Shares", [(["East"], ["0.3346"]), (["North"], ["0.3692"]), (["South"], ["0.0462"]),
                                                   (["West"], ["0.25"])], "shares before the filter")
        add_by_keyboard(page, "Sales, measure", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Sales", exact=True)
        fill(dialog.get_by_role("spinbutton", name="At least", exact=True), "300")
        click(dialog.get_by_role("button", name="Apply", exact=True))
        expect(page.get_by_role("button", name=pill_name("Sales", "Filters"), exact=True)).to_be_focused()
        expect_twin(page, page, "Shares", [(["East"], ["0.3508"]), (["North"], ["0.3871"]), (["West"], ["0.2621"])],
                    "shares after the measure filter")
        assert [r["texts"] for r in twin_rows(page, "Shares")] == [["35.1%"], ["38.7%"], ["26.2%"]]
        announced(page, "View announcements", "Filtered: 3 marks.")


def test_wf_query_order_rank_totals(browser: Browser, app_url: str) -> None:
    share = M("Sales", "SUM", TC("share", "table_down"))
    w = world(app_url, state="draft", sheets=[sheet(
        "Cut", rows=["Region"], columns=[M("Sales")], label=[share], filters=[NOT_NULL],
        reference_lines=[{"type": "average", "value": None, "parameter": None}])])
    with visit(browser, app_url, w.creator, w.sheet_path("Cut")) as page:
        add_by_keyboard(page, "Sales, measure", "Filters")
        dialog = page.get_by_role("dialog", name="Filter Sales", exact=True)
        select(dialog.get_by_role("combobox", name="Calculation", exact=True), "Rank")
        select(dialog.get_by_role("combobox", name="Compute using", exact=True), "Table down")
        fill(dialog.get_by_role("spinbutton", name="At most", exact=True), "2")
        click(dialog.get_by_role("button", name="Apply", exact=True))
        announced(page, "View announcements", "Filtered: 2 marks.")
        check(page.get_by_role("checkbox", name="Show totals", exact=True))

        def read() -> None:
            rows = {r["heads"][0]: r for r in twin_rows(page, "Cut")}
            assert rows["East"]["values"] == ["435", "0.3346"] and rows["North"]["values"] == ["480", "0.3692"], rows
            assert "Grand total" in rows and "Average" in rows, rows
            assert rows["Grand total"]["texts"][0] == "915" and rows["Grand total"]["texts"][1] == "n/a", rows
            assert rows["Average"]["texts"][0] == "457.5", rows
        eventually(page, read, "shares, total and average after the rank filter")


def test_wf_dashboard_two_contexts(browser: Browser, app_url: str) -> None:
    w, viewer = _two_sheet_world(app_url, "both")
    path = f"/dashboards/{w.dashboards['Board']}"
    unfiltered = {"Black": "600", "Green": "450", "Herbal": "270"}
    with visit(browser, app_url, viewer, path) as a, visit(browser, app_url, w.creator, path) as b:
        a_target = a.get_by_role("region", name=CATEGORIES, exact=True)
        b_target = b.get_by_role("region", name=CATEGORIES, exact=True)
        expect_twin_values(a, a_target, CATEGORIES, unfiltered, "first person at start")
        expect_twin_values(b, b_target, CATEGORIES, unfiltered, "second person at start")
        click(mark_el(a.get_by_role("region", name=REGIONS, exact=True), "East"))
        announced(a, "View announcements", "Filtered to East: 2 sheets updated")
        expect_twin_values(a, a_target, CATEGORIES, {"Black": "150", "Green": "210", "Herbal": "75"}, "first person East")
        expect_twin_values(b, b_target, CATEGORIES, unfiltered, "second person is not filtered")
        click(mark_el(b.get_by_role("region", name=REGIONS, exact=True), "West"))
        announced(b, "View announcements", "Filtered to West: 2 sheets updated")
        expect_twin_values(b, b_target, CATEGORIES, {"Black": "280", "Herbal": "45"}, "second person West")
        settle_page(a)
        assert twin_values(a_target, CATEGORIES) == {"Black": "150", "Green": "210", "Herbal": "75"}


def test_wf_dashboard_busy_every_target(browser: Browser, app_url: str) -> None:
    w, viewer = _two_sheet_world(app_url, "both")
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Board']}") as page:
        source = page.get_by_role("region", name=REGIONS, exact=True)
        target = page.get_by_role("region", name=CATEGORIES, exact=True)
        mix = page.get_by_role("region", name=MIX, exact=True)
        status = page.get_by_role("status", name="View announcements", exact=True)
        expect_twin_values(page, target, CATEGORIES, {"Black": "600", "Green": "450", "Herbal": "270"}, "unfiltered")
        with held(page, f"**/api/sheets/{w.sheets[CATEGORIES]}/query*") as first, \
                held(page, f"**/api/sheets/{w.sheets[MIX]}/query*") as second:
            click(mark_el(source, "East"))
            for region in (target, mix):
                eventually(page, lambda r=region: expect(r).to_have_attribute("aria-busy", "true", timeout=POLL_MS), "busy sheet")
                expect(region.get_by_text("Updating...")).to_be_visible()
            first.release()
            expect_twin_values(page, target, CATEGORIES, {"Black": "150", "Green": "210", "Herbal": "75"}, "first answer applied")
            expect(mix).to_have_attribute("aria-busy", "true")
            expect(status).not_to_have_text("Filtered to East: 2 sheets updated")
            second.release()
        announced(page, "View announcements", "Filtered to East: 2 sheets updated")
        expect(mix.get_by_text("Updating...")).to_be_hidden()


def _phone_action_world(app_url: str) -> tuple[World, str]:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, sheets=[
        sheet("Regions", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]),
        sheet("Categories", rows=["Category"], columns=[M("Sales")])], dashboards=[{
            "name": "Pocket", "layout": _hz("Regions", "Categories"), "floating": [],
            "phone_order": ["Regions", "Categories"], "phone_heights": {"Regions": 320, "Categories": 320},
            "actions": [{"name": "Narrow", "type": "filter", "source": "Regions", "targets": ["Categories"],
                         "field": "Region", "parameter": None, "set": None}]}])
    return w, viewer


def test_wf_phone_tap_filter_geometry(browser: Browser, app_url: str) -> None:
    w, viewer = _phone_action_world(app_url)
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Pocket']}", width=360, height=740, glide=True) as page:
        regions = page.get_by_role("region", name=REGIONS, exact=True)
        categories = page.get_by_role("region", name=CATEGORIES, exact=True)
        expect_marks(page, regions, {"East": "435", "North": "480", "South": "60", "West": "325"}, "phone sheet")
        plot, bar = bar_geometry(regions, "East")
        assert abs(bar["width"] - plot["width"] * 435 / 600) <= PIXEL_TOL, (plot, bar)
        assert bar["height"] >= TAP_MIN_PX, bar
        east = mark_el(regions, "East")
        tap(east)
        details = page.get_by_role("dialog", name="Mark details", exact=True)
        expect(details).to_contain_text(tip(("Region", "East"), ("Sales", "435")))
        expect(east).to_have_attribute("aria-pressed", "true")
        announced(page, "View announcements", "Filtered to East: 1 sheets updated")
        page.keyboard.press("Escape")
        expect(details).to_have_count(0)
        expect(east).to_be_focused()
        expect_marks(page, categories, {"Black": "150", "Green": "210", "Herbal": "75"}, "filtered to East")
        glide_finish(page)
        plot, bar = bar_geometry(categories, "Black")
        assert abs(bar["width"] - plot["width"] * 150 / 300) <= PIXEL_TOL, (plot, bar)
        layout(page)


def test_wf_phone_hide_show(browser: Browser, app_url: str) -> None:
    w, viewer = _phone_world(app_url)
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Phone']}", width=360, height=740) as page:
        regions = page.get_by_role("region", name=REGIONS, exact=True)
        categories = page.get_by_role("region", name=CATEGORIES, exact=True)
        expect_marks(page, regions, {"East": "435", "North": "480", "South": "60", "West": "325"}, "phone sheet")
        start = regions.bounding_box()["y"]
        objects = page.get_by_role("list", name="Dashboard objects", exact=True)
        tap(objects.get_by_role("button", name=HIDE_BUTTON.format(name=CATEGORIES), exact=True))
        announced(page, "View announcements", "Categories hidden.")
        show = objects.get_by_role("button", name=SHOW_BUTTON.format(name=CATEGORIES), exact=True)
        expect(show).to_be_focused()
        expect(categories).to_have_count(0)
        assert regions.bounding_box()["y"] < start, "a hidden object must take no length"
        layout(page)
        tap(show)
        announced(page, "View announcements", "Categories shown.")
        expect(objects.get_by_role("button", name=HIDE_BUTTON.format(name=CATEGORIES), exact=True)).to_be_focused()
        assert categories.bounding_box()["y"] < regions.bounding_box()["y"], "phone_order puts Categories first"
        layout(page)


def test_wf_phone_mark_glide_motion(browser: Browser, app_url: str) -> None:
    w, viewer = _phone_action_world(app_url)
    path = f"/dashboards/{w.dashboards['Pocket']}"
    with visit(browser, app_url, viewer, path, width=360, height=740, glide=True) as page:
        regions = page.get_by_role("region", name=REGIONS, exact=True)
        categories = page.get_by_role("region", name=CATEGORIES, exact=True)
        expect_marks(page, categories, {"Black": "600", "Green": "450", "Herbal": "270"}, "start")
        glide_reset(page)
        tap(mark_el(regions, "East"))
        expect_marks(page, categories, {"Black": "150", "Green": "210", "Herbal": "75"}, "filtered")
        glide_finish(page)
        glides = [r for r in glide_records(page) if r["id"] == "mark-glide"]
        for mark in ("Black", "Green", "Herbal"):
            mine = [r for r in glides if r["mark"] == mark]
            assert len(mine) == 1 and mine[0]["duration"] == GLIDE_MS, (mark, glides)
    with visit(browser, app_url, viewer, path, width=360, height=740, glide=True, reduced_motion="reduce") as page:
        regions = page.get_by_role("region", name=REGIONS, exact=True)
        categories = page.get_by_role("region", name=CATEGORIES, exact=True)
        expect_marks(page, categories, {"Black": "600", "Green": "450", "Herbal": "270"}, "start")
        glide_reset(page)
        tap(mark_el(regions, "East"))
        expect_marks(page, categories, {"Black": "150", "Green": "210", "Herbal": "75"}, "filtered")
        assert glide_records(page) == [] and page.evaluate("() => document.getAnimations().length") == 0
        plot, bar = bar_geometry(categories, "Black")
        assert abs(bar["width"] - plot["width"] * 150 / 300) <= PIXEL_TOL, (plot, bar)


def test_mark_glide_final_place(browser: Browser, app_url: str) -> None:
    w = world(app_url, state="draft", sheets=[sheet(n, rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]) for n in ("Place", "Still")])
    for name, motion_mode in (("Place", "no-preference"), ("Still", "reduce")):
        with visit(browser, app_url, w.creator, w.sheet_path(name), glide=True, reduced_motion=motion_mode) as page:
            view = page.get_by_role("region", name="View", exact=True)
            expect_marks(page, view, {"East": "435", "North": "480", "South": "60", "West": "325"}, "start")
            add_by_keyboard(page, "Region, dimension", "Filters")
            dialog = page.get_by_role("dialog", name="Filter Region", exact=True)
            dialog.get_by_role("checkbox", name="South", exact=True).set_checked(False)
            for member in ("East", "North", "West"):
                dialog.get_by_role("checkbox", name=member, exact=True).set_checked(True)
            click(dialog.get_by_role("button", name="Apply", exact=True))
            announced(page, "View announcements", "Filtered: 3 marks.")
            glide_finish(page)
            plot, bar = bar_geometry(view, "East")
            assert abs(bar["width"] - plot["width"] * 435 / 600) <= PIXEL_TOL, (motion_mode, plot, bar)


def test_cross_dashboard_regions(browser: Browser, app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, parameters=[TOP_COUNT], sheets=[
        sheet("Regions", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]),
        sheet("Categories", rows=["Category"], columns=[M("Sales")])], dashboards=[{
            "name": "Keys", "layout": _hz("Regions", "Categories"), "floating": [], "phone_order": [],
            "phone_heights": {}, "actions": []}])
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Keys']}") as page:
        region = lambda n: page.get_by_role("region", name=n, exact=True)
        expect_twin_values(page, region(REGIONS), REGIONS, {"East": "435", "North": "480", "South": "60", "West": "325"}, "sheet")
        region("Controls").get_by_role("spinbutton", name="Top count", exact=True).focus()
        for name in (REGIONS, CATEGORIES, "Controls"):
            page.keyboard.press("F6")
            assert holds_focus(region(name)), f"F6 did not move focus into {name}"
        page.keyboard.press("Shift+F6")
        assert holds_focus(region(CATEGORIES)), "Shift+F6 wraps back"
        for _ in range(60):
            page.keyboard.press("Tab")
            if not holds_focus(region(CATEGORIES)):
                break
        else:
            pytest.fail("Tab never left the sheet region")


def test_cross_source_dialogs(browser: Browser, app_url: str) -> None:
    w = world(app_url, sheets=[sheet("S", rows=["Region"], columns=[M("Sales")])])
    with visit(browser, app_url, w.creator, f"/sources/{w.source_id}") as page:
        for opener_name, dialog_name in (("Add table", "Add table"), ("Relate tables", "Relate tables")):
            opener = page.get_by_role("button", name=opener_name, exact=True)
            opener.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
            expect(dialog).to_be_visible()
            assert holds_focus(dialog), f"opening {dialog_name} left focus outside it"
            page.keyboard.press("Shift+Tab")
            assert holds_focus(dialog), "Shift+Tab from the first control left the dialog"
            for _ in range(12):
                page.keyboard.press("Tab")
                assert holds_focus(dialog), "Tab left the open dialog"
            page.keyboard.press("Escape")
            expect(dialog).to_have_count(0)
            expect(opener).to_be_focused()


def test_cross_announcements_ascii(browser: Browser, app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, parameters=[TOP_COUNT], sheets=[
        sheet("Regions", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL]),
        sheet("Categories", rows=["Category"], columns=[M("Sales")])], dashboards=[{
            "name": "Say", "layout": _hz("Regions", "Categories"), "floating": [], "phone_order": [],
            "phone_heights": {}, "actions": []}])
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Say']}") as page:
        status = page.get_by_role("status", name="View announcements", exact=True)
        expect(status).to_have_attribute("aria-live", "polite")
        count = page.get_by_role("region", name="Controls", exact=True).get_by_role("spinbutton", name="Top count", exact=True)
        fill(count, "3")
        page.keyboard.press("Enter")
        announced(page, "View announcements", "Top count set to 3.")
        expect(count).to_be_focused()
        hide = page.get_by_role("list", name="Dashboard objects", exact=True).get_by_role(
            "button", name=HIDE_BUTTON.format(name=CATEGORIES), exact=True)
        hide.focus()
        page.keyboard.press("Enter")
        announced(page, "View announcements", "Categories hidden.")
        for path in (f"/dashboards/{w.dashboards['Say']}", w.sheet_path("Regions"), "/workbooks", "/inbox", "/"):
            page.goto(f"{app_url}{path}")
            settle_page(page)
            text = page.evaluate("() => document.body.innerText")
            bad = sorted(set(re.findall("[‘’“”…]", text)))
            assert not bad, f"{path} shows {bad}"


def test_cross_phone_sheet_tab(browser: Browser, app_url: str) -> None:
    w, viewer = _phone_world(app_url)
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Phone']}", width=360, height=740) as page:
        opener = page.get_by_role("button", name="Filters", exact=True)
        tap(opener)
        dialog = page.get_by_role("dialog", name="Filters", exact=True)
        expect(dialog).to_be_visible()
        assert holds_focus(dialog), "opening Filters left focus outside the sheet"
        page.keyboard.press("Shift+Tab")
        assert holds_focus(dialog), "Shift+Tab from the first control left the sheet"
        for _ in range(8):
            page.keyboard.press("Tab")
            assert holds_focus(dialog), "Tab left the open sheet"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()


def _last_measure(r: httpx.Response, *dims: str) -> dict:
    assert r.status_code == 200, f"query answered {r.status_code}: {r.text}"
    last = r.json()["columns"][-1]["name"]
    rows = ok_rows(r)
    return by(rows, dims[0] if len(dims) == 1 else tuple(dims), last)


def _action(name: str, source: str, target: str, field: str) -> dict:
    return {"name": name, "type": "filter", "source": source, "targets": [target], "field": field,
            "parameter": None, "set": None}


def test_dashboard_two_filter_actions(browser: Browser, app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, sheets=[
        sheet(GRID_SHEET, rows=["Region"], columns=["Category"], color=M("Sales"), filters=[NOT_NULL]),
        sheet(PRODUCTS, rows=["Product"], columns=[M("Sales")])], dashboards=[{
            "name": "Both", "layout": _hz(GRID_SHEET, PRODUCTS), "floating": [], "phone_order": [], "phone_heights": {},
            "actions": [_action("A region", GRID_SHEET, PRODUCTS, "Region"), _action("B category", GRID_SHEET, PRODUCTS, "Category")]}])
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['Both']}") as page:
        source = page.get_by_role("region", name=GRID_SHEET, exact=True)
        target = page.get_by_role("region", name=PRODUCTS, exact=True)
        click(mark_el(source, "East | Black"))
        expect_twin_values(page, target, PRODUCTS, {"Ember Assam": "150"}, "both filter actions")


def test_dashboard_filter_from_day_mark(browser: Browser, app_url: str) -> None:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, sheets=[
        sheet(DAYS_SHEET, rows=[M("Sales")], columns=[{"field": "Date", "level": "day"}], chart="bar"),
        sheet(CATEGORIES, rows=["Category"], columns=[M("Sales")])], dashboards=[{
            "name": "ByDay", "layout": _hz(DAYS_SHEET, CATEGORIES), "floating": [], "phone_order": [], "phone_heights": {},
            "actions": [_action("One day", DAYS_SHEET, CATEGORIES, "Date")]}])
    with visit(browser, app_url, viewer, f"/dashboards/{w.dashboards['ByDay']}") as page:
        source = page.get_by_role("region", name=DAYS_SHEET, exact=True)
        target = page.get_by_role("region", name=CATEGORIES, exact=True)
        click(mark_el(source, "2027-01-20"))
        expect_twin_values(page, target, CATEGORIES, {"Black": "150"}, "one day")


def test_reference_lines_on_a_share(browser: Browser, app_url: str) -> None:
    lines = [{"type": "average", "value": None, "parameter": None}, {"type": "median", "value": None, "parameter": None}]
    w = world(app_url, state="draft", sheets=[
        sheet("Shares", rows=["Region"], columns=[M("Sales", "SUM", TC("share", "table_down"))],
              reference_lines=lines, filters=[NOT_NULL])])
    with visit(browser, app_url, w.creator, w.sheet_path("Shares")) as page:
        def read() -> None:
            rows = {r["heads"][0]: [x for x in r["texts"] if x] for r in twin_rows(page, "Shares") if r["heads"]}
            assert rows.get("Average") == ["25%"] and rows.get("Median") == ["29.2%"], rows
        eventually(page, read, "reference lines on a share measure")


def test_parameter_announcement_display(browser: Browser, app_url: str) -> None:
    w, viewer = _drive_world(app_url)
    with visit(browser, app_url, viewer, w.sheet_path("Drive")) as page:
        _drive_twin(page, 2)
        control = page.get_by_role("region", name="Controls").get_by_role("spinbutton", name="Top count", exact=True)
        control.focus()
        page.keyboard.press("Control+A")
        page.keyboard.type("1000")
        page.keyboard.press("Enter")
        announced(page, "View announcements", "Top count set to 1,000.")


def test_calc_naming_a_table_calc(app_url: str) -> None:
    calcs = [{"name": "Running", "formula": "RUN_TOTAL(SUM([Sales]))"}, {"name": "Named", "formula": "[Running]"}]
    w = world(app_url, state="draft", sheets=[
        sheet("Across", rows=["Region"], columns=["Category"], label=[M("Named")], filters=[NOT_NULL], calcs=calcs)])
    got = _last_measure(query(client(app_url, w.creator), w.sheets["Across"]), "Region", "Category")
    for key, value in ((("East", "Black"), 150), (("East", "Green"), 360), (("East", "Herbal"), 435), (("West", "Herbal"), 325)):
        assert near(got.get(key), value), (key, got)


def test_formula_share_shows_percent(browser: Browser, app_url: str) -> None:
    calcs = [{"name": "Portion", "formula": "SHARE(SUM([Sales]))"}]
    w = world(app_url, state="draft", sheets=[
        sheet("Portions", rows=["Region"], columns=["Category"], label=[M("Portion")], filters=[NOT_NULL], calcs=calcs)])
    with visit(browser, app_url, w.creator, w.sheet_path("Portions")) as page:
        def read() -> None:
            rows = {" | ".join(r["heads"]): r["texts"] for r in twin_rows(page, "Portions")}
            assert rows.get("East | Black") == ["34.5%"], rows
        eventually(page, read, "SHARE formula as a percent")


def _secured(app_url: str, field: str, values: list[str]) -> dict:
    viewer = fresh("vw")
    w = world(app_url, members={viewer: "viewer"}, sheets=[sheet("Rows", rows=["Region"], columns=[M("Sales")])])
    r = client(app_url, w.creator).put(f"/api/sources/{w.source_id}/entitlements", json={"field": field, "users": {viewer: values}})
    assert r.status_code == 200, r.text
    return _last_measure(query(client(app_url, viewer), w.sheets["Rows"]), "Region")


def test_entitlement_number_field(app_url: str) -> None:
    got = _secured(app_url, "Order", ["1", "2"])
    assert list(got) == ["North"] and near(got["North"], 170), got


def test_entitlement_date_field(app_url: str) -> None:
    got = _secured(app_url, "Date", ["2027-01-04"])
    assert list(got) == ["North"] and near(got["North"], 120), got


def test_renamed_field_keeps_its_data(app_url: str) -> None:
    w = world(app_url, sheets=[sheet("S", rows=["Region"], columns=[M("Sales")])])
    c = client(app_url, w.creator)
    tier = fields_of(c, w.source_id)["Tier"]["id"]
    assert c.patch(f"/api/sources/{w.source_id}/fields/{tier}", json={"name": "Level"}).status_code == 200
    got = _last_measure(query(c, add_sheet(c, w.workbook_id, sheet("Levels", rows=["Level"], columns=[M("Sales")]))), "Level")
    assert set(got) == {"Gold", "Silver", None}, got
    assert near(got["Gold"], 1060) and near(got["Silver"], 240) and near(got[None], 20), got


def test_join_notice_first_key_in_file_order(app_url: str) -> None:
    _, _, project_id, c = creator_project(app_url)
    r = upload(c, project_id, fresh("src"), "left_t", b"K,L\nA,1\nB,2\n")
    assert r.status_code == 201, r.text
    source_id = r.json()["id"]
    assert add_table(c, source_id, "right_t", b"K,V\nA,1\nB,2\nB,3\nA,4\n").status_code == 201
    r = c.put(f"/api/sources/{source_id}/relation", json={
        "left_table": "left_t", "left_key": "K", "right_table": "right_t", "right_key": "K"})
    assert r.status_code == 200, r.text
    assert r.json()["notices"] == [JOIN_NOTICE.format(table="right_t", n=2, key="A")], r.text


def test_hidden_field_leaves_pdf_filter_lines(app_url: str) -> None:
    w = world(app_url, sheets=[
        sheet("Teas", rows=["Region"], columns=[M("Sales")], filters=[NOT_NULL, F("Category", "dimension", ["Black"])])])
    c = client(app_url, w.creator)
    field = fields_of(c, w.source_id)["Category"]["id"]
    assert c.patch(f"/api/sources/{w.source_id}/fields/{field}", json={"hidden": True}).status_code == 200
    text = pdf_text(c.get(export(c, "pdf", {"sheet": w.sheets["Teas"]})["download"]).content)
    assert "Category" not in text, text


def test_hidden_measure_line_leaves_crosstab(app_url: str) -> None:
    lines = [{"type": "average", "value": None, "parameter": None}]
    w = world(app_url, sheets=[sheet("Goals", rows=["Region"], columns=[M("Target")], reference_lines=lines, filters=[NOT_NULL])])
    c = client(app_url, w.creator)
    field = fields_of(c, w.source_id)["Target"]["id"]
    assert c.patch(f"/api/sources/{w.source_id}/fields/{field}", json={"hidden": True}).status_code == 200
    text = c.get(export(c, "csv", {"sheet": w.sheets["Goals"]})["download"]).content.decode("utf-8")
    cells = set(re.split(r"[,\r\n]+", text))
    hidden_values = {"700", "1400", "400", "600", "775"}
    assert "Target" not in text, text
    assert not cells & hidden_values, f"hidden Target values reached the crosstab: {text!r}"
