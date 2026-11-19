from __future__ import annotations

import concurrent.futures as cf
import contextlib
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, Route

from conftest import (
    AXE,
    DEPLOYED_APP,
    S3,
    Mailpit,
    Postgres,
    addresses,
    advance,
    animations,
    axe,
    center,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    same_origin,
    state_styles,
    tab_order,
    text,
    unique,
)
from conftest import check as tick
from conftest import select as choose


PASSWORD = "ledger-demo-2026"
MARA = "mara@harbourlane.test"
DEV = "dev@harbourlane.test"
PRIYA = "priya@harbourlane.test"
SAM = "sam@harbourlane.test"
JONAH = "jonah@harbourlane.test"
DISPLAY_NAMES = {MARA: "Mara Lindqvist", DEV: "Dev Okafor", PRIYA: "Priya Raman", SAM: "Sam Whitlock", JONAH: "Jonah Reyes"}
SEED_DOC = "Harbour Lane Ops"

DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)

ROLL_STEP_MS = 60
ROLL_MS = 220
ROLL_SAMPLE_MS = 170
TALLY_MAX_MS = 600
DELETED_ROW_MS = 8000
RESEND_MS = 10_000
PREVIEW_PAUSE_MS = 500
ANNOUNCE_FILL_MS = 100
LONG_PRESS_MS = 500
SWEEP_MS = 1200
EXPORT_SETTLE_S = 15
COMMIT_BUDGET_S = 1.0
PREVIEW_BUDGET_S = 0.5
TOUCH_PX = 44
FOCUS_OUTLINE_PX = 2
GRID_AREA_JS = """g => { const r = g.getBoundingClientRect(); let left = r.left, right = r.right, top = r.top, bottom = r.bottom;
    for (let p = g.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { const q = p.getBoundingClientRect();
        left = Math.max(left, q.left); right = Math.min(right, q.right); top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom); break; } }
    return {x: left, y: top, width: right - left, height: bottom - top}; }"""
FOCUS_RING_JS = """e => { const s = getComputedStyle(e); const outline = s.outlineStyle === "none" ? 0 : parseFloat(s.outlineWidth) || 0;
    const px = (s.boxShadow.match(/-?[\\d.]+px/g) || []).map(parseFloat); let ring = 0;
    for (let i = 0; i + 3 < px.length; i += 4) if (px[i] === 0 && px[i + 1] === 0) ring = Math.max(ring, px[i + 3]);
    return Math.max(outline, ring); }"""
MAX_BODY_BYTES = 1_000_000
PASTE_MAX = 500
STACK_MAX = 50
TEXT_MAX = 10_000
FORMULA_MAX = 2000
DOC_NAME_MAX = 80
TABLE_NAME_MAX = 40
COLUMN_NAME_MAX = 60
KEY_MAX = 100
EMAIL_MAX = 254
LONG_NAME = 64
LONG_FORMULA = 200

HTTP_TIMEOUT = 30.0
WAIT_S = 20.0
LOCATOR_MS = 1000
SHORT_TTL_WAIT_S = 30.0
PARALLEL = 8
ABANDONS = 10
DRIFT_MS = 1

SIGN_IN_FAIL = "Email or password is incorrect."
DOC_NAME_MSG = "Use 1 to 80 characters without line breaks or control characters."
TABLE_NAME_MSG = "Use 1 to 40 letters, digits or underscores, starting with a letter."
TABLE_DUP_MSG = "A table with this name already exists."
COLUMN_NAME_MSG = "Use 1 to 60 characters without square brackets."
COLUMN_DUP_MSG = "A column with this name already exists."
TYPE_LOCKED_MSG = "This column's type cannot be changed."
COLUMN_REVISION_MSG = "Send the column's revision."
CELL_REVISION_MSG = "Send the cell's revision."
DECIMAL_MSG = "Enter a number with up to 15 digits before the decimal point."
FORMULA_CELL_MSG = "Formula cells are calculated. Edit the column formula instead."
OWN_ROWS_MSG = "You can only assign rows to yourself."
EMAIL_MSG = "Enter a valid email address."
OWN_DOC_MSG = "You already own this document."
TEXT_COLUMN_MSG = "Choose a Text column."
ROW_ID_MSG = "Choose a row in this table."
PASTE_COUNT_MSG = "Send 1 to 500 cell writes."
PASTE_TWICE_MSG = "Each cell can be written once per paste."
KEY_FORMAT_MSG = "Send a key of 1 to 100 letters, digits, hyphens or underscores."
KEY_REUSED_MSG = "This key was already used for a different change."
ENDED_EARLY = "Check the formula: it ended too early."
TOO_LONG = "Check the formula: use at most 2,000 characters."
EMPTY_DOC = "This document has no tables yet."
EMPTY_TABLE = "This table has no rows yet."
READ_ONLY = "You can view this document but not change it."
NO_MATCH = "No matching rows."
ROW_CONFLICT = "Someone else changed this row first. It was not deleted."
ROW_GONE = "This row no longer exists. Your change was not saved."
COLUMN_CONFLICT = "Someone else changed this column first. Your change was not saved."
TABLE_CONFLICT = "Someone else renamed this table first. Your change was not saved."
CIRCULAR = "This change makes a formula depend on itself. Affected cells show #CIRC!."
NO_FIT = "The pasted block does not fit here. Nothing was changed."
NOTHING_UNDO = "Nothing to undo."
NOTHING_REDO = "Nothing to redo."
PERMISSION_LOST = "You no longer have permission to change this document."
CONNECTION = "Could not reach Tallyframe. Your last change was not saved."
SAVING = "Saving changes"
MAIL_OUTAGE = "Invite not sent: the mail server is unreachable. The share is saved. Press Resend when mail is back."
EXPORT_FAILED = "Export failed: the file could not be stored. Your edits are safe. Try again later."
DOWNLOAD_UNREACHABLE = "Download failed: the file store is unreachable. Try again later."
TOOLTIPS = {
    "#DIV/0!": "#DIV/0! Division by zero.",
    "#TYPE!": "#TYPE! A value has the wrong type for this operation.",
    "#NAME?": "#NAME? This formula uses a name that does not exist.",
    "#REF!": "#REF! This formula points at a row that was deleted.",
    "#CIRC!": "#CIRC! This formula depends on itself.",
}

UNITS_ORDERED = "SUMBY(Orders.[Qty], Orders.[Product])"
STOCK_LEFT = "[Stock] - [Units Ordered]"
LINE_TOTAL = "[Qty] * [Product].[Price]"
REGION = "[Customer].[Region]"
COOKIE = "tf_session"
OTHER_FORMULA = "[Qty] * 3"
DOUBLE = "Double"
OTHER = "Other"
JOURNEY_FORMULA = "[{}] * 2"
TALLY = 'COUNT({}) & "Orders"'
TALLY_TOKEN = "orders"
SPACED = 'SUM( orders.[{}] ) & "[Qty]"'
SPACED_TOKEN = "qty"

PRODUCTS = [
    {"Name": "Oak Shelf Bracket", "SKU": "OSB-01", "Price": "12.5000", "Stock": "40.0000"},
    {"Name": "Walnut Floating Shelf", "SKU": "WFS-02", "Price": "68.0000", "Stock": "12.0000"},
    {"Name": "Brass Hinge Pair", "SKU": "BHP-03", "Price": "9.7500", "Stock": "150.0000"},
    {"Name": "Birch Ply Sheet", "SKU": "BPS-04", "Price": "41.2000", "Stock": "25.0000"},
]
CUSTOMERS = [
    {"Name": "Pell & Daughters Catering", "Region": "North", "Phone": "+1-555-0142", "Owner": DEV},
    {"Name": "Greyfield Installers, Ltd", "Region": "South", "Phone": "555-0199", "Owner": PRIYA},
    {"Name": "Moss Street Bakery", "Region": "North", "Phone": "+1-555-0178", "Owner": DEV},
]
ORDERS = [
    {"Order No": "ORD-1001", "Customer": "Pell & Daughters Catering", "Product": "Oak Shelf Bracket", "Qty": "4.0000", "Owner": DEV},
    {"Order No": "ORD-1002", "Customer": "Greyfield Installers, Ltd", "Product": "Walnut Floating Shelf", "Qty": "2.0000", "Owner": PRIYA},
    {"Order No": "ORD-1003", "Customer": "Moss Street Bakery", "Product": "Brass Hinge Pair", "Qty": "10.0000", "Owner": DEV},
    {"Order No": "ORD-1004", "Customer": "Greyfield Installers, Ltd", "Product": "Oak Shelf Bracket", "Qty": "6.0000", "Owner": PRIYA},
    {"Order No": "ORD-1005", "Customer": "Pell & Daughters Catering", "Product": "Birch Ply Sheet", "Qty": "3.0000", "Owner": DEV},
]
SEED_SHARES = [(DEV, "editor", "own"), (PRIYA, "editor", "all"), (SAM, "viewer", "all")]
PRODUCT_NAMES = [p["Name"] for p in PRODUCTS]

CELL_RE = re.compile(r"/api/documents/[^/]+/tables/[^/]+/rows/[^/]+/cells/[^/?]+$")
PASTE_RE = re.compile(r"/api/documents/[^/]+/tables/[^/]+/cells$")
ROWS_RE = re.compile(r"/api/documents/[^/]+/tables/[^/]+/rows$")
UNDO_RE = re.compile(r"/api/documents/[^/]+/undo$")
EXPORT_RE = re.compile(r"/api/documents/[^/]+/tables/[^/]+/exports$")
PREVIEW_RE = re.compile(r"/formula-preview$")
DOCS_RE = re.compile(r"/api/documents$")
TALLY_RE = re.compile(r"Recalculated (\d+) cells? in (\d+) tables?\.")

_NO_BODY = object()


def sentence(count: int, tables: int) -> str:
    return f"Recalculated {count} {'cell' if count == 1 else 'cells'} in {tables} {'table' if tables == 1 else 'tables'}."


def cell_conflict(current: str) -> str:
    return f"Someone else changed this cell. It now shows {current or 'blank'}. Your edit was not saved."


def rows_hidden(n: int) -> str:
    return "1 row is no longer shown to you." if n == 1 else f"{n} rows are no longer shown to you."


def unreadable(n: int) -> str:
    return f"Check the formula: it could not be read at character {n}."


def q4(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP):.4f}"


def rail_name(table: str, n: int, changed: int | None = None) -> str:
    name = f"{table}, 1 row" if n == 1 else f"{table}, {n} rows"
    return name if changed is None else f"{name}, {changed} changed"


def opts(column: str) -> str:
    return f"{column} options"


def choices(column: str) -> str:
    return f"{column} choices"


def column_menu(column: str) -> str:
    return f"Column options for {column}"


def row_actions(row: str) -> str:
    return f"Row actions for {row}"


def edit_button(column: str, formula: bool = False) -> str:
    return f"Edit {column} formula" if formula else f"Edit {column}"


def summary_name(source: str, groups: list[str]) -> str:
    return f"{source} by {' and '.join(groups)}"


def csv_file(table: str) -> str:
    return f"{table}.csv"


def writing_copy(file: str) -> str:
    return f"Writing {file}"


def ready_copy(file: str) -> str:
    return f"{file} is ready."


def downloaded_copy(file: str) -> str:
    return f"{file} downloaded."


def download_link(file: str) -> str:
    return f"Download {file}"


def ref_msg(table: str) -> str:
    return f"Choose a row from {table}."


def result_copy(display: str) -> str:
    return f"Result: {display}"


def deleted_copy(row: str) -> str:
    return f"Deleted row {row}."


def restored_copy(row: str) -> str:
    return f"Restored row {row}."


def created_table_copy(name: str) -> str:
    return f"Created table {name}."


def fresh(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    email = next((v for v in (first, second) if "@" in v), "")
    token = re.sub(r"[^A-Za-z0-9]", "", first + second)[-16:] or "x"
    if not email:
        email = f"{token.lower()}@example.test"
    return token, email.lower()


def outage(var: str) -> str:
    return os.environ[var].rstrip("/")


def poll(check: Callable[[], Any], seconds: float = WAIT_S, what: str = "") -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = check()
        if last:
            return last
    raise AssertionError(f"timed out waiting for {what}: {last!r}")


class Api:

    def __init__(self, base: str, email: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        self.user: dict[str, Any] = {}
        if email:
            r = self.request("POST", "/api/auth/sign-in", {"email": email, "password": PASSWORD})
            assert r.status_code == 200, f"sign-in {email}: {r.status_code} {r.text}"
            self.user = r.json()["user"]

    @property
    def token(self) -> str:
        return self.http.cookies.get("tf_session") or ""

    def request(self, method: str, path: str, body: Any = _NO_BODY, *, key: str | None = None,
                raw: str | bytes | None = None, headers: dict[str, str] | None = None,
                params: dict[str, Any] | None = None) -> httpx.Response:
        h = dict(headers or {})
        content: bytes | None = None
        if key is not None:
            h["Idempotency-Key"] = key
        if raw is not None:
            content = raw if isinstance(raw, bytes) else raw.encode()
            h.setdefault("Content-Type", "application/json")
        elif body is not _NO_BODY:
            content = json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        return self.http.request(method, path, content=content, headers=h, params=params)

    def ok(self, method: str, path: str, body: Any = _NO_BODY, **kw: Any) -> dict:
        r = self.request(method, path, body, **kw)
        assert r.status_code in (200, 201), f"{method} {path}: {r.status_code} {r.text}"
        return r.json()


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text}"
    body = r.json()
    assert set(body) == {"error"}, body
    e = body["error"]
    assert e["code"] == code and isinstance(e["message"], str), e
    return e


def parallel(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return call()

    with cf.ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [f.result() for f in [pool.submit(run, c) for c in calls]]


class Ledger:

    def __init__(self, base: str, *, shares: bool = True) -> None:
        self.base = base.rstrip("/")
        self.mara = Api(self.base, MARA)
        self._apis: dict[str, Api] = {MARA: self.mara}
        token, _ = fresh("ledger")
        self.name = f"Ledger {token}"
        self.doc = self.mara.ok("POST", "/api/documents", {"name": self.name})["document"]["id"]
        self.d = f"/api/documents/{self.doc}"
        self.t: dict[str, str] = {}
        self.c: dict[str, dict[str, str]] = {}
        self.r: dict[str, dict[str, str]] = {}
        self.names: dict[str, str] = {}
        self.summaries: set[str] = set()
        for table in ("Products", "Customers", "Orders"):
            self.add_table(table)
        for name, kind in (("Name", "text"), ("SKU", "text"), ("Price", "decimal"), ("Stock", "decimal")):
            self.add_column("Products", name, kind)
        for name in ("Name", "Region", "Phone", "Owner"):
            self.add_column("Customers", name, "text")
        self.add_column("Orders", "Order No", "text")
        self.add_column("Orders", "Customer", "reference", target_table_id=self.t["Customers"])
        self.add_column("Orders", "Product", "reference", target_table_id=self.t["Products"])
        self.add_column("Orders", "Qty", "decimal")
        self.add_column("Orders", "Owner", "text")
        for row in PRODUCTS:
            self.add_row("Products", row)
        for row in CUSTOMERS:
            self.add_row("Customers", row)
        for row in ORDERS:
            self.add_row("Orders", {**row, "Customer": self.r["Customers"][row["Customer"]],
                                    "Product": self.r["Products"][row["Product"]]})
        self.add_column("Products", "Units Ordered", "formula", formula=UNITS_ORDERED)
        self.add_column("Products", "Stock Left", "formula", formula=STOCK_LEFT)
        self.add_column("Orders", "Line Total", "formula", formula=LINE_TOTAL)
        self.add_column("Orders", "Region", "formula", formula=REGION)
        for table in ("Customers", "Orders"):
            self.mara.ok("PUT", f"{self.tp(table)}/access", {"owner_column_id": self.c[table]["Owner"]})
        self.add_summary("Orders", ["Region"], ["Qty", "Line Total"])
        if shares:
            for email, role, scope in SEED_SHARES:
                self.share(email, role, scope)

    def api(self, email: str) -> Api:
        if email not in self._apis:
            self._apis[email] = Api(self.base, email)
        return self._apis[email]

    def tp(self, table: str) -> str:
        return f"{self.d}/tables/{self.t[table]}"

    def path(self, table: str | None = None) -> str:
        return f"/d/{self.doc}" + (f"/t/{self.t[table]}" if table else "")

    def add_table(self, name: str) -> dict:
        table = self.mara.ok("POST", f"{self.d}/tables", {"name": name})["table"]
        self.t[name], self.c[name], self.r[name] = table["id"], {}, {}
        return table

    def add_column(self, table: str, name: str, kind: str, api: Api | None = None, **extra: Any) -> dict:
        col = (api or self.mara).ok("POST", f"{self.tp(table)}/columns", {"name": name, "type": kind, **extra})["column"]
        self.c[table][name] = col["id"]
        return col

    def add_row(self, table: str, values: dict[str, Any], api: Api | None = None) -> dict:
        row = (api or self.mara).ok("POST", f"{self.tp(table)}/rows",
                                    {"cells": {self.c[table][k]: v for k, v in values.items()}})["row"]
        key = values.get(next(iter(self.c[table])))
        if key is not None:
            self.r[table][key] = row["id"]
            self.names[row["id"]] = key
        return row

    def add_summary(self, source: str, groups: list[str], sums: list[str], api: Api | None = None) -> dict:
        body = {"source_table_id": self.t[source], "group_by": [self.c[source][g] for g in groups],
                "sum_columns": [self.c[source][s] for s in sums]}
        resp = (api or self.mara).ok("POST", f"{self.d}/summaries", body)
        name = resp["table"]["name"]
        self.t[name] = resp["table"]["id"]
        self.summaries.add(name)
        self.c[name] = {c["name"]: c["id"] for c in sorted(self.read(self.mara, name)["columns"], key=lambda c: c["position"])}
        self.r[name] = {}
        return resp

    def share(self, email: str, role: str, scope: str, api: Api | None = None) -> dict:
        return (api or self.mara).ok("POST", f"{self.d}/shares", {"email": email, "role": role, "row_scope": scope})

    def read(self, api: Api, table: str) -> dict:
        return api.ok("GET", self.tp(table))["table"]

    def columns(self, api: Api, table: str) -> list[dict]:
        return sorted(self.read(api, table)["columns"], key=lambda c: c["position"])

    def col(self, api: Api, table: str, name: str) -> dict:
        return next(c for c in self.read(api, table)["columns"] if c["id"] == self.c[table][name])

    def idx(self, api: Api, table: str, name: str) -> int:
        return [c["id"] for c in self.columns(api, table)].index(self.c[table][name])

    def rows(self, api: Api, table: str) -> list[dict]:
        data = self.read(api, table)
        first = min(data["columns"], key=lambda c: c["position"])["id"]
        return [{"key": r["cells"][first]["display"], **r} for r in data["rows"]]

    def row_of(self, api: Api, table: str, key: str) -> dict | None:
        return next((r for r in self.rows(api, table) if r["key"] == key), None)

    def cell(self, api: Api, table: str, key: str, col: str) -> dict:
        row = self.row_of(api, table, key)
        assert row is not None, f"{table} {key} not visible"
        return row["cells"][self.c[table][col]]

    def disp(self, api: Api, table: str, key: str, col: str) -> str:
        return self.cell(api, table, key, col)["display"]

    def put(self, api: Api, table: str, key: str, col: str, value: Any, *, revision: int | None = None,
            idem: str | None = None) -> httpx.Response:
        row_id = self.r[table].get(key) or self.row_of(self.mara, table, key)["id"]
        if revision is None:
            revision = self.cell(self.mara, table, key, col)["revision"]
        return api.request("PUT", f"{self.tp(table)}/rows/{row_id}/cells/{self.c[table][col]}",
                           {"value": value, "revision": revision}, key=idem)

    def delete_row(self, api: Api, table: str, key: str, revision: int | None = None) -> httpx.Response:
        row = self.row_of(self.mara, table, key)
        rev = row["revision"] if revision is None else revision
        return api.request("DELETE", f"{self.tp(table)}/rows/{row['id']}", params={"revision": rev})

    def patch_col(self, api: Api, table: str, column: str, revision: int | None = None, **changes: Any) -> httpx.Response:
        rev = self.col(self.mara, table, column)["revision"] if revision is None else revision
        return api.request("PATCH", f"{self.tp(table)}/columns/{self.c[table][column]}", {"revision": rev, **changes})

    def preview(self, api: Api, table: str, key: str, formula: str) -> httpx.Response:
        return api.request("POST", f"{self.tp(table)}/formula-preview", {"formula": formula, "row_id": self.r[table][key]})

    def export(self, api: Api, table: str, **headers: str) -> httpx.Response:
        return api.request("POST", f"{self.tp(table)}/exports", headers=headers)

    def revision(self, api: Api | None = None) -> int:
        return (api or self.mara).ok("GET", self.d)["document"]["revision"]

    def history(self) -> list[dict]:
        return self.mara.ok("GET", f"{self.d}/history")["entries"]

    def learn(self, api: Api) -> None:
        for name in self.summaries:
            for row in self.rows(api, name):
                self.names[row["id"]] = row["key"]
                self.r[name][row["key"]] = row["id"]

    def describe(self, recalc: dict) -> list[tuple]:
        tables = {v: k for k, v in self.t.items()}
        out = []
        for e in recalc["cells"]:
            table = tables.get(e["table_id"], e["table_id"])
            cols = {v: k for k, v in self.c.get(table, {}).items()}
            out.append((table, self.names.get(e["row_id"], e["row_id"]), cols.get(e["column_id"], e["column_id"]),
                        e["old_display"], e["new_display"], e["depth"]))
        return out

    def check_list(self, api: Api, recalc: dict) -> None:
        seen: set[tuple] = set()
        reads: dict[str, dict] = {}
        for e in recalc["cells"]:
            ident = (e["table_id"], e["row_id"], e["column_id"])
            assert ident not in seen, f"cell listed twice: {ident}"
            seen.add(ident)
            if e["table_id"] not in reads:
                reads[e["table_id"]] = api.ok("GET", f"{self.d}/tables/{e['table_id']}")["table"]
            rows = {r["id"]: r for r in reads[e["table_id"]]["rows"]}
            if e["new_display"] is None:
                assert e["row_id"] not in rows or e["column_id"] not in rows[e["row_id"]]["cells"], e
            else:
                assert rows[e["row_id"]]["cells"][e["column_id"]]["display"] == e["new_display"], e
        assert recalc["count"] == len(recalc["cells"])
        assert recalc["tables"] == len({e["table_id"] for e in recalc["cells"]})
        assert recalc["sentence"] == sentence(recalc["count"], recalc["tables"])

    def check_totals(self, api: Api) -> None:
        c = self.c
        products = {r["id"]: r for r in self.read(api, "Products")["rows"]}
        orders = self.read(api, "Orders")["rows"]
        num = lambda cell: Decimal(cell["value"] or "0")
        units: dict[str, Decimal] = {pid: Decimal(0) for pid in products}
        groups: dict[str, list[Decimal]] = {}
        for o in orders:
            qty, ref = num(o["cells"][c["Orders"]["Qty"]]), o["cells"][c["Orders"]["Product"]]["value"]
            if ref in products:
                units[ref] += qty
                line = q4(qty * num(products[ref]["cells"][c["Products"]["Price"]]))
                assert o["cells"][c["Orders"]["Line Total"]]["display"] == line, o
            g = groups.setdefault(o["cells"][c["Orders"]["Region"]]["display"], [Decimal(0), Decimal(0), Decimal(0)])
            g[0] += 1
            g[1] += qty
            g[2] += num(o["cells"][c["Orders"]["Line Total"]]) if o["cells"][c["Orders"]["Line Total"]]["kind"] == "decimal" else 0
        for pid, p in products.items():
            assert p["cells"][c["Products"]["Units Ordered"]]["display"] == q4(units[pid])
            assert p["cells"][c["Products"]["Stock Left"]]["display"] == q4(num(p["cells"][c["Products"]["Stock"]]) - units[pid])
        summary = {r["key"]: r for r in self.rows(api, "Orders by Region")}
        assert set(summary) == set(groups)
        s = c["Orders by Region"]
        for key, (count, qty, _total) in groups.items():
            assert summary[key]["cells"][s["Count"]]["display"] == q4(count)
            assert summary[key]["cells"][s["Sum of Qty"]]["display"] == q4(qty)


class Mini:

    def __init__(self, api: Api, columns: list[tuple[str, str, dict]], table: str = "Items") -> None:
        self.api = api
        token, _ = fresh("mini")
        self.doc = api.ok("POST", "/api/documents", {"name": f"Mini {token}"})["document"]["id"]
        self.d = f"/api/documents/{self.doc}"
        self.table = table
        self.tid = api.ok("POST", f"{self.d}/tables", {"name": table})["table"]["id"]
        self.tp = f"{self.d}/tables/{self.tid}"
        self.c: dict[str, str] = {}
        for name, kind, extra in columns:
            self.add(name, kind, **extra)

    def add(self, name: str, kind: str, **extra: Any) -> dict:
        col = self.api.ok("POST", f"{self.tp}/columns", {"name": name, "type": kind, **extra})["column"]
        self.c[name] = col["id"]
        return col

    def row(self, values: dict[str, Any] | None = None) -> dict:
        return self.api.ok("POST", f"{self.tp}/rows", {"cells": {self.c[k]: v for k, v in (values or {}).items()}})["row"]

    def read(self) -> dict:
        return self.api.ok("GET", self.tp)["table"]

    def cell(self, row_id: str, name: str) -> dict:
        return next(r for r in self.read()["rows"] if r["id"] == row_id)["cells"][self.c[name]]

    def put(self, row_id: str, name: str, value: Any, revision: int, key: str | None = None) -> httpx.Response:
        return self.api.request("PUT", f"{self.tp}/rows/{row_id}/cells/{self.c[name]}", {"value": value, "revision": revision}, key=key)

    def path(self) -> str:
        return f"/d/{self.doc}/t/{self.tid}"

    def revision(self) -> int:
        return self.api.ok("GET", self.d)["document"]["revision"]


def csv_rows(data: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(data.decode("utf-8"), newline="")))


def inbox(mail: Mailpit, email: str) -> list[dict]:
    return [m for m in mail.messages() if email.lower() in [a.lower() for a in addresses(m.get("To"))]]


@contextlib.contextmanager
def workspace(browser: Browser, api: Api, path: str, size: tuple[int, int] = DESKTOP,
              reduced: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, f"{api.base}/sign-in", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if api.token:
            page.context.add_cookies([{"name": "tf_session", "value": api.token, "url": api.base}])
        page.goto(f"{api.base}{path}")
        yield page


def wait(page: Page, check: Callable[[], Any], what: str = "", *, step: float = 16, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    error: Exception | None = None
    while True:
        try:
            if check():
                return
        except Exception as exc:
            error = exc
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what or 'condition'}: {error}")
        if step:
            advance(page, step)
        else:
            page.evaluate("0")


def contrast_audit(page: Page) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate(
        """options => {
          const result={done:false,error:null,violations:[]};
          Object.defineProperty(window,'__CONTRAST_RESULT__',{value:()=>structuredClone(result),configurable:true});
          axe.run(document,options).then(value=>{
            result.violations=value.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));result.done=true;
          },error=>{result.error=String(error);result.done=true});
        }""",
        {"runOnly": {"type": "rule", "values": ["color-contrast"]}},
    )
    for _ in range(625):
        state = page.evaluate("window.__CONTRAST_RESULT__()")
        if state["done"]:
            assert state["error"] is None, state["error"]
            assert not state["violations"], f"contrast violations: {state['violations']}"
            return
        advance(page, 16)
    raise AssertionError("contrast audit did not settle under controlled time")


def txt(loc: Locator) -> str:
    return (loc.text_content(timeout=LOCATOR_MS) or "").strip()


def attr(loc: Locator, name: str) -> str | None:
    return loc.get_attribute(name, timeout=LOCATOR_MS)


def focused(loc: Locator) -> bool:
    return bool(loc.evaluate("e => e === document.activeElement", timeout=LOCATOR_MS))


def path_of(page: Page) -> str:
    return urllib.parse.urlsplit(page.url).path


def grid(page: Page, table: str) -> Locator:
    return page.get_by_role("grid", name=table, exact=True)


def data_row(page: Page, table: str, key: str) -> Locator:
    return grid(page, table).get_by_role("row").filter(has=page.get_by_role("gridcell", name=key, exact=True))


def gcell(page: Page, table: str, key: str, index: int) -> Locator:
    return data_row(page, table, key).get_by_role("gridcell").nth(index)


def at(page: Page, table: str, row: int, index: int) -> Locator:
    return grid(page, table).get_by_role("row").nth(row + 1).get_by_role("gridcell").nth(index)


def button(scope: Page | Locator, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def link(page: Page, name: str) -> Locator:
    return page.get_by_role("link", name=name, exact=True)


def alerts(page: Page) -> Locator:
    return page.get_by_role("alert", name="Grid alerts", exact=True)


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def records(page: Page) -> Locator:
    return page.get_by_role("list", name="Records", exact=True)


def card(page: Page, key: str) -> Locator:
    return records(page).get_by_role("listitem").filter(has=page.get_by_role("heading", level=3, name=key, exact=True))


def main(page: Page) -> Locator:
    return page.get_by_role("main", name="Workspace", exact=True)


def ready(page: Page, table: str, key: str | None = None) -> None:
    wait(page, lambda: grid(page, table).is_visible() and (key is None or data_row(page, table, key).count() == 1), f"grid {table}")


def commit(page: Page, cell: Locator, value: str, key: str = "Enter") -> None:
    cell.click()
    page.keyboard.type(value)
    page.keyboard.press(key)


RECORD_JS = """(el, key) => {
  window.__tf = window.__tf || {};
  const log = window.__tf[key] = [];
  let last = el.textContent;
  if (last && last.trim()) log.push(last.trim());
  new MutationObserver(() => { const t = el.textContent; if (t !== last) { last = t; if (t && t.trim()) log.push(t.trim()); } })
    .observe(el, {subtree: true, childList: true, characterData: true});
}"""


def record(loc: Locator, key: str) -> None:
    loc.evaluate(RECORD_JS, key)


def fills(page: Page, key: str, copy: str) -> int:
    return sum(1 for t in page.evaluate("k => (window.__tf || {})[k] || []", key) if t == copy)


def described(page: Page, loc: Locator) -> str:
    ref = attr(loc, "aria-describedby") or ""
    return page.evaluate("ids => ids.split(/\\s+/).map(i => document.getElementById(i)?.textContent || '').join(' ').trim()", ref)


def selected(loc: Locator) -> int:
    return loc.evaluate("g => g.querySelectorAll('[role=gridcell][aria-selected=\"true\"]').length")


def markers(loc: Locator) -> list[str]:
    return loc.evaluate("g => [...g.querySelectorAll('[data-recalc-depth]')].map(e => e.textContent + '@' + e.getAttribute('data-recalc-depth'))")


LIVE_REGIONS = (("status", "Recalculation announcements"), ("alert", "Grid alerts"), ("status", "Workspace status"),
                ("status", "Formula announcements"))


def visible_text(page: Page) -> str:
    for role, name in LIVE_REGIONS:
        region = page.get_by_role(role, name=name, exact=True)
        for i in range(region.count()):
            region.nth(i).evaluate("e => { e.__tfHide = true; }")
    return page.evaluate("""() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let out = ''; let n;
      while ((n = w.nextNode())) { let p = n.parentElement, skip = false;
        while (p) { if (p.__tfHide) { skip = true; break; } p = p.parentElement; }
        if (!skip) out += n.textContent + ' '; } return out; }""")


def tally(page: Page) -> list[int]:
    return [int(m.group(1)) for m in TALLY_RE.finditer(visible_text(page))]


def writes(page: Page) -> list[tuple[str, str]]:
    seen: list[tuple[str, str]] = []
    page.on("request", lambda r: seen.append((r.method, r.url)) if r.method in ("POST", "PUT", "PATCH", "DELETE") and "/api/" in r.url and "formula-preview" not in r.url else None)
    return seen


def paste(page: Page, data: str) -> None:
    page.evaluate("""t => { const dt = new DataTransfer(); dt.setData('text/plain', t);
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); }""", data)


class Gate:

    def __init__(self, page: Page, pattern: re.Pattern[str], *, method: str = "PUT", mode: str = "hold", count: int = 1) -> None:
        self.page, self.pattern, self.method, self.mode, self.left = page, pattern, method, mode, count
        self.held: list[tuple[Route, Any]] = []
        self.seen: list[dict[str, Any]] = []
        page.route(pattern, self._on)

    def _on(self, route: Route) -> None:
        req = route.request
        if req.method != self.method:
            route.fallback()
            return
        self.seen.append({"key": req.headers.get("idempotency-key"), "body": req.post_data, "url": req.url})
        if self.left <= 0:
            route.fallback()
            return
        self.left -= 1
        if self.mode == "abort":
            route.abort()
        elif self.mode == "fail":
            route.fulfill(status=500, content_type="application/json", body='{"error":{"code":"probe","message":"probe"}}')
        else:
            response = route.fetch()
            if self.mode == "lose":
                route.abort()
            else:
                self.held.append((route, response))

    def release(self) -> None:
        for route, response in self.held:
            route.fulfill(response=response)
        self.held.clear()


def test_sign_in_identical_401(app_url: str) -> None:
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    good = client.post("/api/auth/sign-in", json={"email": MARA, "password": PASSWORD})
    assert good.status_code == 200
    assert good.json()["user"]["email"] == MARA and good.json()["user"]["display_name"] == DISPLAY_NAMES[MARA]
    cookie = next((v for _, v in good.headers.multi_items() if v.startswith(f"{COOKIE}=")), "")
    assert cookie and "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    assert client.get("/api/me").json()["user"]["email"] == MARA
    _, ghost = fresh("ghost")
    wrong = httpx.post(f"{app_url}/api/auth/sign-in", json={"email": MARA, "password": PASSWORD + "x"})
    unknown = httpx.post(f"{app_url}/api/auth/sign-in", json={"email": ghost, "password": PASSWORD})
    for r in (wrong, unknown):
        assert r.status_code == 401 and not r.cookies and not any(v.startswith(COOKIE) for _, v in r.headers.multi_items())
        assert r.json() == {"error": {"code": "invalid_credentials", "message": SIGN_IN_FAIL}}
    assert wrong.content == unknown.content


def test_sessions_required(app_url: str) -> None:
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    for method, path in (("GET", "/api/me"), ("GET", "/api/documents"), ("POST", "/api/documents")):
        r = anon.request(method, path, json={"name": "probe"} if method == "POST" else None)
        err(r, 401, "unauthenticated")
    assert anon.get("/api/health").json() == {"status": "ok"}
    api = Api(app_url, PRIYA)
    assert api.ok("GET", "/api/me")["user"]["display_name"] == DISPLAY_NAMES[PRIYA]
    token = api.token
    assert api.request("POST", "/api/auth/sign-out").status_code == 204
    err(httpx.get(f"{app_url}/api/me", cookies={"tf_session": token}), 401, "unauthenticated")


def test_documents(app_url: str) -> None:
    mara, jonah = Api(app_url, MARA), Api(app_url, JONAH)
    token, _ = fresh("doc")
    name = f"Smörgås Café Ops {token}"
    r = mara.request("POST", "/api/documents", {"name": name})
    assert r.status_code == 201
    doc = r.json()["document"]
    assert doc["name"] == name and doc["role"] == "owner"
    full = mara.ok("GET", f"/api/documents/{doc['id']}")
    assert full["tables"] == [] and full["document"]["revision"] == 0 and full["document"]["role"] == "owner"
    assert {d["id"]: d["role"] for d in mara.ok("GET", "/api/documents")["documents"]}[doc["id"]] == "owner"
    assert doc["id"] not in [d["id"] for d in jonah.ok("GET", "/api/documents")["documents"]]
    err(jonah.request("GET", f"/api/documents/{doc['id']}"), 404, "not_found")
    assert mara.request("POST", "/api/documents", {"name": "é" * DOC_NAME_MAX}).status_code == 201
    for bad in ("", "é" * (DOC_NAME_MAX + 1)):
        e = err(mara.request("POST", "/api/documents", {"name": bad}), 422, "invalid")
        assert e["fields"]["name"] == DOC_NAME_MSG


def test_tables_and_columns(app_url: str) -> None:
    api = Api(app_url, MARA)
    m = Mini(api, [])
    t = api.request("POST", f"{m.d}/tables", {"name": "Stock_Items"})
    assert t.status_code == 201
    table = t.json()["table"]
    assert (table["kind"], table["revision"], table["owner_column_id"], table["columns"], table["rows"]) == ("table", 1, None, [], [])
    for bad in ("1Items", "Has space", "A" * (TABLE_NAME_MAX + 1), ""):
        assert err(api.request("POST", f"{m.d}/tables", {"name": bad}), 422, "invalid")["fields"]["name"] == TABLE_NAME_MSG
    assert api.request("POST", f"{m.d}/tables", {"name": "A" * TABLE_NAME_MAX}).status_code == 201
    assert err(api.request("POST", f"{m.d}/tables", {"name": "stock_items"}), 422, "invalid")["fields"]["name"] == TABLE_DUP_MSG
    for name, kind in (("Label", "text"), ("Cost", "decimal"), ("When", "date"), ("Done", "bool")):
        col = m.add(name, kind)
        assert col["type"] == kind and col["revision"] == 1 and col["formula"] is None
    assert "target_table_id" in err(api.request("POST", f"{m.tp}/columns", {"name": "Link", "type": "reference"}), 422, "invalid")["fields"]
    assert m.add("Link", "reference", target_table_id=table["id"])["target_table_id"] == table["id"]
    double = "[Cost] * 2"
    assert m.add("Double", "formula", formula="=" + double)["formula"] == double
    for bad in ("Bad[Name", "X" * (COLUMN_NAME_MAX + 1)):
        assert err(api.request("POST", f"{m.tp}/columns", {"name": bad, "type": "text"}), 422, "invalid")["fields"]["name"] == COLUMN_NAME_MSG
    assert m.add("X" * COLUMN_NAME_MAX, "text")["name"] == "X" * COLUMN_NAME_MAX
    assert err(api.request("POST", f"{m.tp}/columns", {"name": "label", "type": "text"}), 422, "invalid")["fields"]["name"] == COLUMN_DUP_MSG
    row = m.row({"Label": "true", "Cost": "12.5", "When": "2026-03-14", "Done": True})
    patch = lambda col, **ch: api.request("PATCH", f"{m.tp}/columns/{m.c[col]}", {"revision": next(c for c in m.read()["columns"] if c["id"] == m.c[col])["revision"], **ch})
    assert err(patch("Cost", type="reference"), 422, "invalid")["fields"]["type"] == TYPE_LOCKED_MSG
    assert err(patch("Double", type="text"), 422, "invalid")["fields"]["type"] == TYPE_LOCKED_MSG
    no_rev = api.request("PATCH", f"{m.tp}/columns/{m.c['Label']}", {"name": "Tag"})
    assert err(no_rev, 422, "invalid")["fields"]["revision"] == COLUMN_REVISION_MSG
    for name, kind, display in (("Label", "bool", "TRUE"), ("Cost", "text", "12.5000"), ("When", "decimal", ""), ("Done", "text", "TRUE")):
        assert patch(name, type=kind).status_code == 200
        cell = m.cell(row["id"], name)
        assert cell["display"] == display and cell["revision"] == 2
    assert next(r for r in m.read()["rows"] if r["id"] == row["id"])["revision"] == 5
    flag = "Flag"
    renamed = patch("Label", name=flag)
    assert renamed.status_code == 200 and renamed.json()["column"]["name"] == flag
    assert api.ok("POST", f"{m.d}/undo")["undone"]["kind"] == "column_update"
    assert api.ok("POST", f"{m.d}/undo")["undone"]["kind"] == "column_update"
    done = m.cell(row["id"], "Done")
    assert done["display"] == "TRUE" and done["kind"] == "bool"


TYPED = {
    "decimal_half_away": ("decimal", "1.00005", 200, "1.0001"),
    "decimal_small": ("decimal", "0.00005", 200, "0.0001"),
    "decimal_negative": ("decimal", "-1.00005", 200, "-1.0001"),
    "decimal_negative_zero": ("decimal", "-0.00004", 200, "0.0000"),
    "decimal_negative_zero_string": ("decimal", '"-0.00004"', 200, "0.0000"),
    "decimal_padded": ("decimal", "12.5", 200, "12.5000"),
    "decimal_exponent_number": ("decimal", "1e3", 422, "Enter a number with up to 15 digits before the decimal point."),
    "decimal_exponent_string": ("decimal", '"1E-2"', 422, "Enter a number with up to 15 digits before the decimal point."),
    "decimal_sixteen_digits": ("decimal", '"1234567890123456"', 422, "Enter a number with up to 15 digits before the decimal point."),
    "text_non_string": ("text", "12", 422, "Enter text."),
    "text_too_long": ("text", "<long text>", 422, "Text can be at most 10,000 characters."),
    "text_blank": ("text", '""', 200, ""),
    "date_valid": ("date", '"2026-03-14"', 200, "2026-03-14"),
    "date_unreal": ("date", '"2026-02-30"', 422, "Enter a date as YYYY-MM-DD."),
    "bool_string_any_case": ("bool", '"True"', 200, "TRUE"),
    "bool_false": ("bool", "false", 200, "FALSE"),
    "bool_invalid": ("bool", '"yes"', 422, "Enter true or false."),
    "formula_cell": ("formula", "1", 422, "Formula cells are calculated. Edit the column formula instead."),
}


@pytest.mark.parametrize("case", list(TYPED), ids=list(TYPED))
def test_typed_values(app_url: str, case: str) -> None:
    kind, raw, code, expected = TYPED[case]
    api = Api(app_url, MARA)
    extra = {"formula": "1"} if kind == "formula" else {}
    m = Mini(api, [("Value", kind, extra)])
    row = m.row()
    value = json.dumps("x" * (TEXT_MAX + 1)) if raw == "<long text>" else raw
    before = m.cell(row["id"], "Value")
    r = api.request("PUT", f"{m.tp}/rows/{row['id']}/cells/{m.c['Value']}", raw='{"value":' + value + ',"revision":' + (json.dumps(before["revision"]) if kind == "formula" else str(before["revision"] or 1)) + "}")
    after = m.cell(row["id"], "Value")
    if code == 200:
        assert r.status_code == 200, r.text
        assert r.json()["cell"]["display"] == expected and after["display"] == expected
    else:
        assert expected in err(r, 422, "invalid")["fields"].values()
        assert after == before


def test_stale_cell_revision(app_url: str) -> None:
    api = Api(app_url, MARA)
    m = Mini(api, [("Qty", "decimal", {})])
    row = m.row({"Qty": "4"})
    first = m.put(row["id"], "Qty", "5", 1)
    assert first.status_code == 200 and first.json()["cell"]["revision"] == 2
    rev = m.revision()
    e = err(m.put(row["id"], "Qty", "6", 1), 409, "stale_revision")
    assert e["current"] == {"value": "5.0000", "display": "5.0000", "revision": 2}
    assert m.cell(row["id"], "Qty")["display"] == "5.0000" and m.revision() == rev


def test_one_winner_per_cell(app_url: str) -> None:
    api = Api(app_url, MARA)
    m = Mini(api, [("Qty", "decimal", {})])
    row = m.row({"Qty": "1"})
    results = parallel([lambda i=i: m.put(row["id"], "Qty", str(i + 2), 1) for i in range(PARALLEL)])
    winners = [r for r in results if r.status_code == 200]
    assert len(winners) == 1
    won = winners[0].json()["cell"]
    for r in results:
        if r is not winners[0]:
            assert err(r, 409, "stale_revision")["current"]["display"] == won["display"]
    assert m.cell(row["id"], "Qty")["display"] == won["display"]


FORMULA_CASES = [
    ("2 + 3 * 2", "8.0000"), ("(1 + 1) * 5", "10.0000"), ("-2 * -3", "6.0000"), ("10/3", "3.3333"),
    ("2/3", "0.6667"), ("0 * -1", "0.0000"), ("-0.00001 + 0", "0.0000"), ('[Qty] & " each"', "12.5000 each"),
    ('"oak" = "Oak"', "FALSE"), ('"B" < "a"', "TRUE"), ("true", "TRUE"), ("False", "FALSE"),
    ("1 + 1 = 2", "TRUE"), ('[Empty] = ""', "TRUE"), ("[Empty] + 5", "5.0000"), ('[Qty] = "12.5000"', "#TYPE!"),
    ("[Label] + 1", "#TYPE!"), ("[QTY] * 0", "0.0000"), ('[Product].[Price] & " each"', "12.5000 each"),
    ("[Product].[Maker].[Name]", "Moss Street Bakery"), ("[Spare].[Price] + 0", "0.0000"),
    ('[Product] & ""', "Oak Shelf Bracket"), ('"""" & ""', '"'), ("1/[Empty]", "#DIV/0!"),
]


def test_formula_language(app_url: str) -> None:
    api = Api(app_url, MARA)
    m = Mini(api, [])
    makers = api.ok("POST", f"{m.d}/tables", {"name": "Makers"})["table"]["id"]
    maker_name = api.ok("POST", f"{m.d}/tables/{makers}/columns", {"name": "Name", "type": "text"})["column"]["id"]
    maker = api.ok("POST", f"{m.d}/tables/{makers}/rows", {"cells": {maker_name: "Moss Street Bakery"}})["row"]["id"]
    parts = api.ok("POST", f"{m.d}/tables", {"name": "Parts"})["table"]["id"]
    pc = {n: api.ok("POST", f"{m.d}/tables/{parts}/columns", {"name": n, "type": k, **x})["column"]["id"]
          for n, k, x in (("Name", "text", {}), ("Price", "decimal", {}), ("Maker", "reference", {"target_table_id": makers}))}
    part = api.ok("POST", f"{m.d}/tables/{parts}/rows", {"cells": {pc["Name"]: "Oak Shelf Bracket", pc["Price"]: "12.5", pc["Maker"]: maker}})["row"]["id"]
    for name, kind, extra in (("Qty", "decimal", {}), ("Label", "text", {}), ("Empty", "decimal", {}),
                              ("Product", "reference", {"target_table_id": parts}), ("Spare", "reference", {"target_table_id": parts})):
        m.add(name, kind, **extra)
    row = m.row({"Qty": "12.5", "Label": "oak", "Product": part})
    failures = []
    for i, (formula, expected) in enumerate(FORMULA_CASES):
        m.add(f"F{i}", "formula", formula=formula)
        got = m.cell(row["id"], f"F{i}")["display"]
        if got != expected:
            failures.append((formula, expected, got))
    assert not failures


def test_error_values(app_url: str) -> None:
    api = Api(app_url, MARA)
    m = Mini(api, [("Qty", "decimal", {})])
    row = m.row({"Qty": "4"})
    specs = [("E1", "1/0", "#DIV/0!"), ("E2", "[E1] + 1", "#DIV/0!"), ("E3", "[Nope] + 1/0", "#NAME?"),
             ("E4", "1/0 + [Nope]", "#DIV/0!"), ("E5", "IFERROR([E1], 5)", "5.0000"), ("E6", '"a" * 2', "#TYPE!"),
             ("E7", "IFERROR([E6], [Nope])", "#NAME?"), ("X", "[Y] + 1", "#NAME?")]
    for name, formula, expected in specs:
        assert api.request("POST", f"{m.tp}/columns", {"name": name, "type": "formula", "formula": formula}).status_code == 201
        m.c[name] = next(c["id"] for c in m.read()["columns"] if c["name"] == name)
        cell = m.cell(row["id"], name)
        assert cell["display"] == expected, (formula, cell)
        if expected.startswith("#"):
            assert cell["kind"] == "error"
    m.add("Y", "formula", formula="[X] + 1")
    m.add("Z", "formula", formula="IFERROR([X], 5)")
    m.add("W", "formula", formula="IFERROR([Z], [Nope])")
    for name in ("X", "Y", "Z", "W"):
        assert m.cell(row["id"], name)["display"] == "#CIRC!"


def test_cycles(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    api = L.mara
    L.add_column("Products", "A", "formula", formula="[B] + 1")
    assert [L.disp(api, "Products", p, "A") for p in PRODUCT_NAMES] == ["#NAME?"] * 4
    r = api.request("POST", f"{L.tp('Products')}/columns", {"name": "B", "type": "formula", "formula": "[A] + 1"})
    assert r.status_code == 201
    L.c["Products"]["B"] = r.json()["column"]["id"]
    expected = []
    for p in PRODUCT_NAMES:
        expected += [("Products", p, "A", "#NAME?", "#CIRC!", 1), ("Products", p, "B", None, "#CIRC!", 1)]
    assert L.describe(r.json()["recalc"]) == expected
    assert r.json()["recalc"]["sentence"] == "Recalculated 8 cells in 1 table."
    L.add_column("Products", "D", "formula", formula="[A] & [Nope]")
    assert [L.disp(api, "Products", p, "D") for p in PRODUCT_NAMES] == ["#CIRC!"] * 4
    assert L.disp(api, "Products", "Oak Shelf Bracket", "Stock Left") == "30.0000"
    assert api.request("DELETE", f"{L.tp('Products')}/columns/{L.c['Products']['D']}").status_code == 200
    fix = L.patch_col(api, "Products", "B", formula="5")
    assert fix.status_code == 200
    expected = [("Products", p, "B", "#CIRC!", "5.0000", 1) for p in PRODUCT_NAMES]
    expected += [("Products", p, "A", "#CIRC!", "6.0000", 2) for p in PRODUCT_NAMES]
    assert L.describe(fix.json()["recalc"]) == expected
    assert fix.json()["recalc"]["sentence"] == "Recalculated 8 cells in 1 table."


def test_recalc_consistency(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    steps = [lambda: L.put(priya, "Orders", "ORD-1003", "Qty", "7")]
    paste_body = lambda: {"writes": [{"row_id": L.r["Orders"][k], "column_id": L.c["Orders"]["Qty"], "value": v,
                                      "revision": L.cell(priya, "Orders", k, "Qty")["revision"]} for k, v in (("ORD-1001", "3"), ("ORD-1005", "8"))]}
    steps.append(lambda: priya.request("POST", f"{L.tp('Orders')}/cells", paste_body()))
    steps.append(lambda: L.patch_col(L.mara, "Orders", "Qty", name="Quantity"))
    steps.append(lambda: L.mara.request("POST", f"{L.d}/undo"))
    steps.append(lambda: priya.request("POST", f"{L.d}/undo"))
    steps.append(lambda: priya.request("POST", f"{L.d}/redo"))
    for step in steps:
        r = step()
        assert r.status_code == 200, r.text
        L.check_list(L.mara, r.json()["recalc"])
        L.check_totals(L.mara)


PRICE_LIST = [
    ("Orders", "ORD-1001", "Line Total", "50.0000", "52.0000", 1), ("Orders", "ORD-1004", "Line Total", "75.0000", "78.0000", 1),
    ("Orders by Region", "North", "Sum of Line Total", "271.1000", "273.1000", 2),
    ("Orders by Region", "South", "Sum of Line Total", "211.0000", "214.0000", 2),
]
QTY_LIST = [
    ("Products", "Oak Shelf Bracket", "Units Ordered", "10.0000", "10.1600", 1),
    ("Orders", "ORD-1001", "Line Total", "50.0000", "52.0000", 1),
    ("Orders by Region", "North", "Sum of Qty", "17.0000", "17.1600", 1),
    ("Products", "Oak Shelf Bracket", "Stock Left", "30.0000", "29.8400", 2),
    ("Orders by Region", "North", "Sum of Line Total", "271.1000", "273.1000", 2),
]


def test_recalc_list(app_url: str) -> None:
    L = Ledger(app_url)
    L.learn(L.mara)
    rev = L.revision()
    base = L.mara.ok("GET", L.d)["document"]["undo_count"]
    r = L.put(L.mara, "Products", "Oak Shelf Bracket", "Price", "13").json()["recalc"]
    assert L.describe(r) == PRICE_LIST
    assert (r["count"], r["tables"], r["sentence"]) == (4, 2, "Recalculated 4 cells in 2 tables.")
    assert r["stacks"] == {"undo_count": min(base + 1, STACK_MAX), "redo_count": 0} and r["access"] == {"role": "owner", "row_scope": "all"}
    assert r["document_revision"] == rev + 1
    L.mara.ok("POST", f"{L.d}/undo")
    dev = L.api(DEV)
    d = L.put(dev, "Products", "Oak Shelf Bracket", "Price", "13").json()["recalc"]
    assert [x[:3] for x in L.describe(d)] == [("Orders", "ORD-1001", "Line Total"), ("Orders by Region", "North", "Sum of Line Total")]
    assert d["sentence"] == "Recalculated 2 cells in 2 tables." and d["access"] == {"role": "editor", "row_scope": "own"}
    dev.ok("POST", f"{L.d}/undo")
    q = L.put(L.mara, "Orders", "ORD-1001", "Qty", "4.16").json()["recalc"]
    assert L.describe(q) == QTY_LIST and q["sentence"] == "Recalculated 5 cells in 3 tables."


def test_summary_tables(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    resp = L.add_summary("Orders", ["Customer"], ["Qty"])
    table, recalc = resp["table"], resp["recalc"]
    assert table["name"] == summary_name("Orders", ["Customer"]) and table["kind"] == "summary"
    cols = L.columns(L.mara, "Orders by Customer")
    assert [(c["id"], c["name"]) for c in cols] == [(L.c["Orders"]["Customer"], "Customer"), ("count", "Count"), (f"sum:{L.c['Orders']['Qty']}", "Sum of Qty")]
    L.learn(L.mara)
    expected = []
    for name, count, qty in (("Pell & Daughters Catering", "2.0000", "7.0000"), ("Greyfield Installers, Ltd", "2.0000", "8.0000"), ("Moss Street Bakery", "1.0000", "10.0000")):
        expected += [("Orders by Customer", name, "Customer", None, name, 1), ("Orders by Customer", name, "Count", None, count, 1),
                     ("Orders by Customer", name, "Sum of Qty", None, qty, 1)]
    assert L.describe(recalc) == expected and recalc["sentence"] == "Recalculated 9 cells in 1 table."
    assert recalc["row_counts"][table["id"]] == 3 and recalc["column_counts"][table["id"]] == 3
    twin = L.mara.ok("POST", f"{L.tp('Customers')}/rows", {"cells": {L.c["Customers"]["Name"]: "Moss Street Bakery"}})["row"]["id"]
    L.mara.ok("POST", f"{L.tp('Orders')}/rows", {"cells": {L.c["Orders"]["Customer"]: twin, L.c["Orders"]["Qty"]: "1"}})
    L.mara.ok("POST", f"{L.tp('Orders')}/rows", {"cells": {L.c["Orders"]["Qty"]: "1"}})
    keys = [r["key"] for r in L.rows(L.mara, "Orders by Customer")]
    assert keys.count("Moss Street Bakery") == 2 and keys.count("") == 1
    bad = lambda body: err(L.mara.request("POST", f"{L.d}/summaries", body), 422, "invalid")["fields"]
    o = L.c["Orders"]
    assert "group_by" in bad({"source_table_id": L.t["Orders"], "group_by": [], "sum_columns": []})
    assert "group_by" in bad({"source_table_id": L.t["Orders"], "group_by": [o["Order No"], o["Customer"], o["Product"], o["Owner"]], "sum_columns": []})
    assert "sum_columns" in bad({"source_table_id": L.t["Orders"], "group_by": [o["Customer"]], "sum_columns": [o["Order No"]]})


def test_totals_after_row_changes(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    count_entry = lambda recalc: next(e for e in L.describe(recalc) if e[:3] == ("Orders by Region", "North", "Count"))
    L.learn(priya)
    added = L.add_row("Orders", {"Order No": "ORD-T1", "Customer": L.r["Customers"]["Pell & Daughters Catering"],
                                 "Product": L.r["Products"]["Oak Shelf Bracket"], "Qty": "1", "Owner": DEV}, api=priya)
    r = priya.ok("GET", L.d)
    rec = L.put(priya, "Orders", "ORD-T1", "Qty", "1.5").json()["recalc"]
    L.check_list(L.mara, rec)
    deleted = L.delete_row(priya, "Orders", "ORD-T1").json()["recalc"]
    assert count_entry(deleted)[3:5] == ("4.0000", "3.0000")
    L.check_list(L.mara, deleted)
    L.check_totals(L.mara)
    blank = priya.ok("POST", f"{L.tp('Orders')}/rows", {"cells": {L.c["Orders"]["Qty"]: "1"}})
    appear = [e for e in blank["recalc"]["cells"] if e["table_id"] == L.t["Orders by Region"] and e["old_display"] is None]
    assert appear, "the blank group appears in the add's own response"
    gone = priya.ok("DELETE", f"{L.tp('Orders')}/rows/{blank['row']['id']}", params={"revision": blank["row"]["revision"]})
    assert [e for e in gone["recalc"]["cells"] if e["new_display"] is None and e["row_id"] == appear[0]["row_id"]]
    assert added["id"] and r["document"]["revision"] > 0
    body = {"writes": [{"row_id": L.r["Orders"][k], "column_id": L.c["Orders"]["Qty"], "value": "5", "revision": 1} for k in ("ORD-1001", "ORD-1003")]}
    pasted = priya.ok("POST", f"{L.tp('Orders')}/cells", body)["recalc"]
    L.check_list(L.mara, pasted)
    L.check_totals(L.mara)


DELETE_LIST = [
    ("Orders", "ORD-1001", "Product", "Oak Shelf Bracket", "#REF!", 1), ("Orders", "ORD-1004", "Product", "Oak Shelf Bracket", "#REF!", 1),
    ("Orders", "ORD-1001", "Line Total", "50.0000", "#REF!", 2), ("Orders", "ORD-1004", "Line Total", "75.0000", "#REF!", 2),
    ("Orders by Region", "North", "Sum of Line Total", "271.1000", "#REF!", 3), ("Orders by Region", "South", "Sum of Line Total", "211.0000", "#REF!", 3),
]
RESTORE_LIST = [
    ("Orders", "ORD-1001", "Product", "#REF!", "Oak Shelf Bracket", 1), ("Orders", "ORD-1004", "Product", "#REF!", "Oak Shelf Bracket", 1),
    ("Products", "Oak Shelf Bracket", "Units Ordered", None, "10.0000", 2), ("Orders", "ORD-1001", "Line Total", "#REF!", "50.0000", 2),
    ("Orders", "ORD-1004", "Line Total", "#REF!", "75.0000", 2), ("Products", "Oak Shelf Bracket", "Stock Left", None, "30.0000", 3),
    ("Orders by Region", "North", "Sum of Line Total", "#REF!", "271.1000", 3), ("Orders by Region", "South", "Sum of Line Total", "#REF!", "211.0000", 3),
]


def test_delete_row_references(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    L.learn(priya)
    r = L.delete_row(priya, "Products", "Oak Shelf Bracket")
    assert r.status_code == 200
    rec = r.json()["recalc"]
    assert L.describe(rec) == DELETE_LIST and rec["sentence"] == "Recalculated 6 cells in 2 tables."
    assert rec["row_counts"][L.t["Products"]] == 3
    for key in ("ORD-1001", "ORD-1004"):
        ref = L.cell(priya, "Orders", key, "Product")
        assert (ref["display"], ref["kind"], ref["revision"]) == ("#REF!", "error", 2)
        assert L.row_of(priya, "Orders", key)["revision"] == 2
        assert L.disp(priya, "Orders", key, "Line Total") == "#REF!"


def test_deleted_row_gone(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    oak = L.r["Products"]["Oak Shelf Bracket"]
    assert L.delete_row(priya, "Products", "Oak Shelf Bracket").status_code == 200
    assert oak not in [r["id"] for r in L.read(priya, "Products")["rows"]]
    err(priya.request("PUT", f"{L.tp('Products')}/rows/{oak}/cells/{L.c['Products']['Stock']}", {"value": "1", "revision": 1}), 404, "not_found")
    err(priya.request("DELETE", f"{L.tp('Products')}/rows/{oak}", params={"revision": 1}), 404, "not_found")
    err(priya.request("POST", f"{L.tp('Products')}/cells", {"writes": [{"row_id": oak, "column_id": L.c["Products"]["Stock"], "value": "1", "revision": 1}]}), 404, "not_found")
    e = err(L.put(priya, "Orders", "ORD-1002", "Product", oak), 422, "invalid")
    assert ref_msg("Products") in e["fields"].values()
    p = priya.request("POST", f"{L.tp('Products')}/formula-preview", {"formula": "1", "row_id": oak})
    assert err(p, 422, "invalid")["fields"]["row_id"] == ROW_ID_MSG
    assert L.preview(priya, "Products", "Brass Hinge Pair", "COUNT(Products)").json()["display"] == "3.0000"
    assert next(t for t in priya.ok("GET", L.d)["tables"] if t["id"] == L.t["Products"])["row_count"] == 3
    exported = L.export(priya, "Products").json()["export"]
    assert b"Oak Shelf Bracket" not in priya.request("GET", exported["download_url"]).content
    priya.ok("POST", f"{L.d}/undo")
    assert [r["id"] for r in L.read(priya, "Products")["rows"]][0] == oak


def test_restore_deleted_row(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    L.learn(priya)
    before = L.row_of(priya, "Products", "Oak Shelf Bracket")
    L.delete_row(priya, "Products", "Oak Shelf Bracket")
    rec = priya.ok("POST", f"{L.d}/undo")["recalc"]
    assert L.describe(rec) == RESTORE_LIST and rec["sentence"] == "Recalculated 8 cells in 3 tables."
    assert rec["row_counts"][L.t["Products"]] == 4
    rows = L.rows(priya, "Products")
    assert rows[0]["id"] == before["id"] and rows[0]["revision"] == before["revision"]
    assert all(rows[0]["cells"][L.c["Products"][c]] == before["cells"][L.c["Products"][c]] for c in ("Name", "SKU", "Price", "Stock"))
    south = L.r["Orders by Region"]["South"]
    L.delete_row(priya, "Customers", "Greyfield Installers, Ltd")
    assert "South" not in [r["key"] for r in L.rows(priya, "Orders by Region")]
    priya.ok("POST", f"{L.d}/undo")
    assert next(r for r in L.rows(priya, "Orders by Region") if r["key"] == "South")["id"] == south
    L.delete_row(priya, "Products", "Oak Shelf Bracket")
    L.put(L.mara, "Orders", "ORD-1004", "Product", L.r["Products"]["Walnut Floating Shelf"])
    priya.ok("POST", f"{L.d}/undo")
    assert L.disp(priya, "Orders", "ORD-1004", "Product") == "Walnut Floating Shelf"
    assert L.disp(priya, "Orders", "ORD-1001", "Product") == "Oak Shelf Bracket"


def test_delete_column(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    api = L.mara
    r = api.ok("DELETE", f"{L.tp('Products')}/columns/{L.c['Products']['Stock']}")["recalc"]
    assert L.describe(r) == [("Products", p, "Stock Left", old, "#NAME?", 1) for p, old in zip(PRODUCT_NAMES, ("30.0000", "10.0000", "140.0000", "22.0000"))]
    assert r["sentence"] == "Recalculated 4 cells in 1 table."
    err(api.request("DELETE", f"{L.tp('Orders')}/columns/{L.c['Orders']['Qty']}"), 409, "column_in_summary")
    err(api.request("DELETE", f"{L.tp('Orders')}/columns/{L.c['Orders']['Owner']}"), 409, "column_is_row_owner")
    L.add_summary("Customers", ["Owner"], [])
    err(api.request("DELETE", f"{L.tp('Customers')}/columns/{L.c['Customers']['Owner']}"), 409, "column_in_summary")


def test_restore_deleted_column(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    api = L.mara
    position = L.idx(api, "Products", "Stock")
    api.ok("DELETE", f"{L.tp('Products')}/columns/{L.c['Products']['Stock']}")
    assert L.patch_col(api, "Orders", "Qty", name="Quantity").status_code == 200
    first = api.ok("POST", f"{L.d}/undo")
    assert first["recalc"]["cells"] == []
    assert L.col(api, "Orders", "Qty")["name"] == "Qty" and L.col(api, "Orders", "Line Total")["formula"] == LINE_TOTAL
    assert L.col(api, "Products", "Units Ordered")["formula"] == UNITS_ORDERED
    second = api.ok("POST", f"{L.d}/undo")["recalc"]
    assert L.describe(second) == [("Products", p, "Stock Left", "#NAME?", v, 1) for p, v in zip(PRODUCT_NAMES, ("30.0000", "10.0000", "140.0000", "22.0000"))]
    assert second["sentence"] == "Recalculated 4 cells in 1 table."
    assert L.idx(api, "Products", "Stock") == position
    assert [L.disp(api, "Products", p, "Stock") for p in PRODUCT_NAMES] == ["40.0000", "12.0000", "150.0000", "25.0000"]


def test_personal_undo(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    L.put(L.mara, "Orders", "ORD-1003", "Qty", "7")
    L.put(priya, "Orders", "ORD-1001", "Qty", "5")
    priya.ok("POST", f"{L.d}/undo")
    assert L.disp(priya, "Orders", "ORD-1001", "Qty") == "4.0000" and L.disp(priya, "Orders", "ORD-1003", "Qty") == "7.0000"
    body = {"writes": [{"row_id": L.r["Orders"][k], "column_id": L.c["Orders"]["Qty"], "value": "8",
                        "revision": L.cell(priya, "Orders", k, "Qty")["revision"]} for k in ("ORD-1001", "ORD-1002", "ORD-1005")]}
    priya.ok("POST", f"{L.tp('Orders')}/cells", body)
    undone = priya.ok("POST", f"{L.d}/undo")
    assert undone["undone"]["kind"] == "cell_batch"
    assert [L.disp(priya, "Orders", k, "Qty") for k in ("ORD-1001", "ORD-1002", "ORD-1005")] == ["4.0000", "2.0000", "3.0000"]
    assert undone["recalc"]["stacks"]["redo_count"] == 1
    last = L.put(priya, "Orders", "ORD-1002", "Qty", "1").json()["recalc"]
    assert last["stacks"]["redo_count"] == 0
    for i in range(STACK_MAX + 1):
        last = L.put(priya, "Products", "Walnut Floating Shelf", "Stock", str(i)).json()["recalc"]
    assert last["stacks"]["undo_count"] == STACK_MAX


def test_undo_conflicts(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    for price in ("13", "14"):
        L.put(priya, "Products", "Oak Shelf Bracket", "Price", price)
    assert priya.request("POST", f"{L.d}/undo").status_code == 200
    assert L.disp(priya, "Products", "Oak Shelf Bracket", "Price") == "13.0000"
    assert priya.request("POST", f"{L.d}/undo").status_code == 200
    assert L.disp(priya, "Products", "Oak Shelf Bracket", "Price") == "12.5000"
    err(priya.request("POST", f"{L.d}/undo"), 409, "nothing_to_undo")
    L.put(priya, "Orders", "ORD-1001", "Qty", "5")
    L.put(L.mara, "Orders", "ORD-1001", "Qty", "9")
    rev = L.revision()
    e = err(priya.request("POST", f"{L.d}/undo"), 409, "undo_conflict")
    assert e["stacks"]["undo_count"] == 0
    assert L.disp(priya, "Orders", "ORD-1001", "Qty") == "9.0000" and L.revision() == rev
    err(priya.request("POST", f"{L.d}/undo"), 409, "nothing_to_undo")
    redo = err(priya.request("POST", f"{L.d}/redo"), 409, "nothing_to_redo")
    assert redo["stacks"] == {"undo_count": 0, "redo_count": 0}


def test_parallel_undo(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    for key in ("ORD-1001", "ORD-1002", "ORD-1003"):
        L.put(priya, "Orders", key, "Qty", "1")
    for route, code, field in (("undo", "nothing_to_undo", "undo_count"), ("redo", "nothing_to_redo", "redo_count")):
        results = parallel([lambda: priya.request("POST", f"{L.d}/{route}") for _ in range(5)])
        ok = [r for r in results if r.status_code == 200]
        assert len(ok) == 3
        assert sorted(r.json()["recalc"]["stacks"][field] for r in ok) == [0, 1, 2]
        for r in results:
            if r.status_code != 200:
                err(r, 409, code)
    assert [L.disp(priya, "Orders", k, "Qty") for k in ("ORD-1001", "ORD-1002", "ORD-1003")] == ["1.0000"] * 3


def test_role_permissions(app_url: str, mail: Mailpit) -> None:
    L = Ledger(app_url)
    sam, priya = L.api(SAM), L.api(PRIYA)
    o, p = L.c["Orders"], L.tp("Orders")
    _, outsider = fresh("perm")
    row = L.r["Orders"]["ORD-1001"]
    viewer_ops = [
        ("PUT", f"{p}/rows/{row}/cells/{o['Qty']}", {"value": "9", "revision": 1}),
        ("POST", f"{p}/cells", {"writes": [{"row_id": row, "column_id": o["Qty"], "value": "9", "revision": 1}]}),
        ("POST", f"{p}/rows", {"cells": {}}), ("DELETE", f"{p}/rows/{row}?revision=1", _NO_BODY),
        ("PATCH", f"{p}/columns/{o['Line Total']}", {"revision": 1, "formula": "1"}),
        ("PATCH", f"{p}/columns/{o['Qty']}", {"revision": 1, "name": "Quantity"}),
        ("PATCH", p, {"name": "Sales", "revision": 1}), ("POST", f"{L.d}/undo", _NO_BODY), ("POST", f"{L.d}/redo", _NO_BODY),
        ("PUT", f"{p}/access", {"owner_column_id": None}), ("POST", f"{p}/columns", {"name": "Note", "type": "text"}),
        ("POST", f"{L.d}/summaries", {"source_table_id": L.t["Orders"], "group_by": [o["Owner"]], "sum_columns": []}),
        ("POST", f"{L.d}/shares", {"email": outsider, "role": "viewer", "row_scope": "all"}),
    ]
    editor_ops = [
        ("POST", f"{L.d}/tables", {"name": "Extra"}), ("PATCH", p, {"name": "Sales", "revision": 1}),
        ("POST", f"{p}/columns", {"name": "Note", "type": "text"}),
        ("PATCH", f"{p}/columns/{o['Qty']}", {"revision": 1, "name": "Quantity"}),
        ("PATCH", f"{p}/columns/{o['Owner']}", {"revision": 1, "type": "decimal"}),
        ("DELETE", f"{p}/columns/{o['Order No']}", _NO_BODY), ("PUT", f"{p}/access", {"owner_column_id": None}),
        ("POST", f"{L.d}/summaries", {"source_table_id": L.t["Orders"], "group_by": [o["Owner"]], "sum_columns": []}),
        ("POST", f"{L.d}/shares", {"email": outsider, "role": "viewer", "row_scope": "all"}),
    ]
    rev, before = L.revision(), L.read(L.mara, "Orders")
    for api, ops in ((sam, viewer_ops), (priya, editor_ops)):
        for method, path, body in ops:
            err(api.request(method, path, body), 403, "forbidden")
    assert L.revision() == rev and L.read(L.mara, "Orders") == before
    assert outsider not in [s["email"] for s in L.mara.ok("GET", f"{L.d}/shares")["shares"]]
    assert inbox(mail, outsider) == []
    assert L.patch_col(priya, "Orders", "Line Total", formula="[Qty] * 2").status_code == 200


def test_row_access(app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    assert [r["key"] for r in L.rows(dev, "Orders")] == ["ORD-1001", "ORD-1003", "ORD-1005"]
    assert [r["key"] for r in L.rows(dev, "Customers")] == ["Pell & Daughters Catering", "Moss Street Bakery"]
    err(L.put(dev, "Orders", "ORD-1002", "Qty", "1"), 404, "not_found")
    err(L.delete_row(dev, "Orders", "ORD-1002"), 404, "not_found")
    e = err(L.mara.request("PUT", f"{L.tp('Orders')}/access", {"owner_column_id": L.c["Orders"]["Qty"]}), 422, "invalid")
    assert e["fields"]["owner_column_id"] == TEXT_COLUMN_MSG
    L.put(L.mara, "Orders", "ORD-1002", "Owner", f"  {DEV.upper()} ")
    assert "ORD-1002" in [r["key"] for r in L.rows(dev, "Orders")]
    L.mara.ok("PUT", f"{L.tp('Orders')}/access", {"owner_column_id": None})
    assert len(L.rows(dev, "Orders")) == 5


def test_restricted_views(app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    assert [L.disp(dev, "Products", p, "Units Ordered") for p in PRODUCT_NAMES] == ["4.0000", "0.0000", "10.0000", "3.0000"]
    assert [L.disp(dev, "Products", p, "Stock Left") for p in PRODUCT_NAMES] == ["36.0000", "12.0000", "140.0000", "22.0000"]
    assert L.disp(L.mara, "Products", "Oak Shelf Bracket", "Units Ordered") == "10.0000"
    summary = L.rows(dev, "Orders by Region")
    s = L.c["Orders by Region"]
    assert [r["key"] for r in summary] == ["North"]
    assert [summary[0]["cells"][s[c]]["display"] for c in ("Count", "Sum of Qty", "Sum of Line Total")] == ["3.0000", "17.0000", "271.1000"]
    counts = {t["name"]: t["row_count"] for t in dev.ok("GET", L.d)["tables"]}
    assert counts == {"Products": 4, "Customers": 2, "Orders": 3, "Orders by Region": 1}
    for formula, value in (("COUNT(Orders)", "3.0000"), ("MAX(Orders.[Qty])", "10.0000"), ("AVERAGE(Orders.[Qty])", "5.6667")):
        assert L.preview(dev, "Products", "Oak Shelf Bracket", formula).json()["display"] == value
    orders = dev.request("GET", L.export(dev, "Orders").json()["export"]["download_url"]).content
    assert [r[0] for r in csv_rows(orders)[1:]] == ["ORD-1001", "ORD-1003", "ORD-1005"]
    groups = dev.request("GET", L.export(dev, "Orders by Region").json()["export"]["download_url"]).content
    assert [r[0] for r in csv_rows(groups)[1:]] == ["North"]


def test_own_scope_rows(app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    row = dev.ok("POST", f"{L.tp('Orders')}/rows", {"cells": {L.c["Orders"]["Order No"]: "ORD-D1"}})["row"]
    assert row["cells"][L.c["Orders"]["Owner"]]["display"] == DEV
    e = err(dev.request("POST", f"{L.tp('Orders')}/rows", {"cells": {L.c["Orders"]["Owner"]: PRIYA}}), 422, "invalid")
    assert OWN_ROWS_MSG in e["fields"].values()
    assert OWN_ROWS_MSG in err(L.put(dev, "Orders", "ORD-1001", "Owner", PRIYA), 422, "invalid")["fields"].values()
    paste = {"writes": [{"row_id": L.r["Orders"]["ORD-1003"], "column_id": L.c["Orders"]["Owner"], "value": "", "revision": 1}]}
    assert OWN_ROWS_MSG in err(dev.request("POST", f"{L.tp('Orders')}/cells", paste), 422, "invalid")["fields"].values()
    hidden = L.put(dev, "Orders", "ORD-1001", "Customer", L.r["Customers"]["Greyfield Installers, Ltd"])
    assert ref_msg("Customers") in err(hidden, 422, "invalid")["fields"].values()
    assert L.disp(L.mara, "Orders", "ORD-1001", "Owner") == DEV


def test_permission_changes(app_url: str) -> None:
    L = Ledger(app_url)
    dev, dev2 = L.api(DEV), Api(app_url, DEV)
    L.put(dev, "Orders", "ORD-1001", "Qty", "5")
    L.share(DEV, "editor", "all")
    for api in (dev, dev2):
        assert len(L.rows(api, "Orders")) == 5
        assert len(L.rows(api, "Orders by Region")) == 2
    assert L.preview(dev, "Products", "Oak Shelf Bracket", "COUNT(Orders)").json()["display"] == "5.0000"
    L.share(DEV, "editor", "own")
    err(L.put(dev2, "Orders", "ORD-1002", "Qty", "1"), 404, "not_found")
    L.share(DEV, "viewer", "own")
    err(L.put(dev, "Orders", "ORD-1003", "Qty", "1"), 403, "forbidden")
    err(dev2.request("POST", f"{L.d}/undo"), 403, "forbidden")
    L.share(DEV, "editor", "own")
    assert dev.ok("POST", f"{L.d}/undo")["recalc"]["access"] == {"role": "editor", "row_scope": "own"}
    assert L.disp(L.mara, "Orders", "ORD-1001", "Qty") == "4.0000"


def test_request_scoped_views(app_url: str) -> None:
    L = Ledger(app_url)
    dev = Api(app_url, DEV)
    mara_lists: list[dict] = []

    def mara_edits() -> None:
        for price in ("13", "12.5") * 4:
            mara_lists.append(L.put(L.mara, "Products", "Oak Shelf Bracket", "Price", price).json()["recalc"])

    def dev_reads() -> list[tuple]:
        seen = []
        for _ in range(6):
            seen.append((L.disp(dev, "Products", "Oak Shelf Bracket", "Units Ordered"),
                         tuple(r["key"] for r in L.rows(dev, "Orders by Region")),
                         L.preview(dev, "Products", "Oak Shelf Bracket", "COUNT(Orders)").json()["display"]))
        return seen

    with cf.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(mara_edits), pool.submit(dev_reads), pool.submit(dev_reads)]
        results = [f.result() for f in futures]
    for reads in results[1:]:
        assert set(reads) == {("4.0000", ("North",), "3.0000")}
    assert all(r["count"] == 4 and r["access"]["role"] == "owner" for r in mara_lists)


def test_share_no_enumeration(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    _, ghost = fresh("ghost")
    a = L.mara.request("POST", f"{L.d}/shares", {"email": ghost.upper(), "role": "editor", "row_scope": "own"})
    b = L.mara.request("POST", f"{L.d}/shares", {"email": JONAH, "role": "editor", "row_scope": "own"})
    assert a.status_code == b.status_code == 201
    strip = lambda r: {k: v for k, v in r.json()["share"].items() if k not in ("id", "email")}
    assert strip(a) == strip(b) and set(a.json()["share"]) == set(b.json()["share"])
    assert a.json()["share"]["email"] == ghost
    again = L.mara.request("POST", f"{L.d}/shares", {"email": JONAH, "role": "viewer", "row_scope": "all"})
    assert again.status_code == 200 and again.json()["share"]["role"] == "viewer"
    assert err(L.mara.request("POST", f"{L.d}/shares", {"email": MARA, "role": "viewer", "row_scope": "all"}), 422, "invalid")["fields"]["email"] == OWN_DOC_MSG
    assert "role" in err(L.mara.request("POST", f"{L.d}/shares", {"email": ghost, "role": "owner", "row_scope": "all"}), 422, "invalid")["fields"]


def test_invite_email(app_url: str, mail: Mailpit) -> None:
    L = Ledger(app_url, shares=False)
    _, email = fresh("invite")
    L.share(email, "viewer", "all")
    msgs = inbox(mail, email)
    assert len(msgs) == 1
    m = msgs[0]
    assert addresses(m.get("To")) == [email] and not addresses(m.get("Cc")) and not addresses(m.get("Bcc"))
    assert addresses(m.get("From")) == [mail_from_address()]
    assert m["Subject"] == f"Mara Lindqvist shared {L.name} with you"
    lines = text(m).replace("\r\n", "\n").rstrip("\n").split("\n")
    assert lines[0] == f'Mara Lindqvist shared "{L.name}" with you as Viewer.'
    assert len(lines) == 2 and re.fullmatch(rf"Open it here: https?://\S+/d/{re.escape(L.doc)}", lines[1])


def test_invite_outage_resend(app_url: str, mail: Mailpit) -> None:
    L = Ledger(app_url, shares=False)
    down = Api(outage("APP_MAILPIT_DOWN_URL"), MARA)
    _, email = fresh("outage")
    share = down.ok("POST", f"{L.d}/shares", {"email": email, "role": "viewer", "row_scope": "all"})["share"]
    assert share["invite_status"] == "not_sent"
    resend = f"{L.d}/shares/{share['id']}/resend"
    err(down.request("POST", resend), 503, "mail_unavailable")
    assert inbox(mail, email) == []
    assert L.mara.ok("POST", resend)["share"]["invite_status"] == "sent"
    err(L.mara.request("POST", resend), 409, "invite_already_sent")
    assert len(inbox(mail, email)) == 1
    _, email2 = fresh("race")
    share2 = down.ok("POST", f"{L.d}/shares", {"email": email2, "role": "editor", "row_scope": "own"})["share"]
    results = parallel([lambda: L.mara.request("POST", f"{L.d}/shares/{share2['id']}/resend") for _ in range(5)])
    assert [r.status_code for r in results].count(200) == 1 and [r.status_code for r in results].count(409) == 4
    assert len(inbox(mail, email2)) == 1


def test_invite_header_safety(app_url: str, mail: Mailpit) -> None:
    L = Ledger(app_url, shares=False)
    token, _ = fresh("hdr")
    for bad in (f"a\n{token}@example.test", f"a\t{token}@example.test", f"a {token}@example.test", f"a,{token}@example.test",
                f"a;{token}@example.test", f"<{token}@example.test>", f'"{token}"@example.test', f"({token})@example.test",
                f"a\x07{token}@example.test", f"{token}example.test", "a" * EMAIL_MAX + "@x"):
        assert err(L.mara.request("POST", f"{L.d}/shares", {"email": bad, "role": "viewer", "row_scope": "all"}), 422, "invalid")["fields"]["email"] == EMAIL_MSG
        assert inbox(mail, bad) == []
    for bad_name in (f"Ops\n{token}", f"Ops\r{token}", f"Ops\x07{token}", f"Ops\x85{token}"):
        assert err(L.mara.request("POST", "/api/documents", {"name": bad_name}), 422, "invalid")["fields"]["name"] == DOC_NAME_MSG
    for name in (f"Smörgås Café Ops {token}", (f"Smörgås Café Ops {token} " + "é" * DOC_NAME_MAX)[:DOC_NAME_MAX]):
        doc = L.mara.ok("POST", "/api/documents", {"name": name})["document"]["id"]
        _, email = fresh("subject")
        L.mara.ok("POST", f"/api/documents/{doc}/shares", {"email": email, "role": "editor", "row_scope": "all"})
        msgs = inbox(mail, email)
        assert len(msgs) == 1 and msgs[0]["Subject"] == f"Mara Lindqvist shared {name} with you"


def test_cross_site_refused(app_url: str, mail: Mailpit) -> None:
    L = Ledger(app_url, shares=False)
    parts = urllib.parse.urlsplit(app_url)
    port = parts.port or 80
    origins = ["http://other.example", f"https://{parts.netloc}", f"http://{parts.hostname}:{port + 1}",
               f"http://{parts.hostname}.:{port}", "null"]
    variants = [{"Origin": o} for o in origins] + [{"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"}]
    for headers in variants:
        signin = httpx.post(f"{app_url}/api/auth/sign-in", json={"email": MARA, "password": PASSWORD}, headers=headers)
        err(signin, 403, "cross_origin")
        assert not signin.cookies
        err(L.mara.request("PUT", f"{L.tp('Orders')}/rows/{L.r['Orders']['ORD-1001']}/cells/{L.c['Orders']['Qty']}",
                           {"value": "9", "revision": 1}, headers=headers), 403, "cross_origin")
    err(httpx.post(f"{app_url}/api/auth/sign-out", headers={"Origin": "null"}), 403, "cross_origin")
    err(L.mara.request("POST", "/api/auth/sign-out", headers={"Origin": "http://other.example"}), 403, "cross_origin")
    assert L.mara.ok("GET", "/api/me")["user"]["email"] == MARA
    _, email = fresh("csrf")
    err(L.mara.request("POST", f"{L.d}/shares", {"email": email, "role": "viewer", "row_scope": "all"}, headers={"Origin": "http://other.example"}), 403, "cross_origin")
    share = Api(outage("APP_MAILPIT_DOWN_URL"), MARA).ok("POST", f"{L.d}/shares", {"email": email, "role": "viewer", "row_scope": "all"})["share"]
    err(L.mara.request("POST", f"{L.d}/shares/{share['id']}/resend", headers={"Sec-Fetch-Site": "cross-site"}), 403, "cross_origin")
    assert next(s for s in L.mara.ok("GET", f"{L.d}/shares")["shares"] if s["id"] == share["id"])["invite_status"] == "not_sent"
    assert inbox(mail, email) == []
    assert L.disp(L.mara, "Orders", "ORD-1001", "Qty") == "4.0000"
    same = L.mara.request("PUT", f"{L.tp('Orders')}/rows/{L.r['Orders']['ORD-1001']}/cells/{L.c['Orders']['Qty']}",
                          {"value": "5", "revision": 1}, headers={"Origin": f"{parts.scheme}://{parts.netloc}"})
    assert same.status_code == 200


def test_export_storage_confirmed(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    s3 = S3()
    listed = lambda: [e["id"] for e in L.mara.ok("GET", f"{L.d}/exports")["exports"]]
    err(L.export(L.mara, "Customers", Origin="http://other.example"), 403, "cross_origin")
    assert listed() == [] and s3.keys(f"exports/{L.doc}/") == []
    r = L.export(L.mara, "Customers")
    assert r.status_code == 201
    e = r.json()["export"]
    assert e["status"] == "ready" and e["file_name"] == csv_file("Customers") and e["download_url"] == f"/api/exports/{e['id']}/download"
    stored = s3.get(f"exports/{L.doc}/{e['id']}.csv")
    assert e["byte_size"] == len(stored) and e["sha256"] == hashlib.sha256(stored).hexdigest()
    download = L.mara.request("GET", e["download_url"])
    assert download.status_code == 200 and download.content == stored
    assert download.headers["content-type"].startswith("text/csv")
    assert listed() == [e["id"]]


def test_csv_format(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    L.put(L.mara, "Orders", "ORD-1005", "Owner", 'a "q"\nb')
    e = L.export(L.mara, "Orders").json()["export"]
    body = L.mara.request("GET", e["download_url"]).content
    expected = (
        "Order No,Customer,Product,Qty,Owner,Line Total,Region\r\n"
        "ORD-1001,Pell & Daughters Catering,Oak Shelf Bracket,4.0000,dev@harbourlane.test,50.0000,North\r\n"
        'ORD-1002,"Greyfield Installers, Ltd",Walnut Floating Shelf,2.0000,priya@harbourlane.test,136.0000,South\r\n'
        "ORD-1003,Moss Street Bakery,Brass Hinge Pair,10.0000,dev@harbourlane.test,97.5000,North\r\n"
        'ORD-1004,"Greyfield Installers, Ltd",Oak Shelf Bracket,6.0000,priya@harbourlane.test,75.0000,South\r\n'
        'ORD-1005,Pell & Daughters Catering,Birch Ply Sheet,3.0000,"a ""q""\nb",123.6000,North\r\n'
    )
    assert body == expected.encode("utf-8")


def test_csv_neutralised(app_url: str) -> None:
    api = Api(app_url, MARA)
    m = Mini(api, [("Note", "text", {}), ("Amount", "decimal", {}), ("Echo", "formula", {"formula": '[Note] & ""'}), ("=Label", "text", {})])
    for note, amount in (("\r=Note", "-3.25"), ("\tNote", None), ("+1-555-0142", None), ("@home", None), ("-dash", None), ("plain", None)):
        m.row({"Note": note, **({"Amount": amount} if amount else {})})
    e = api.ok("POST", f"{m.tp}/exports")["export"]
    body = api.request("GET", e["download_url"]).content
    expected = ("Note,Amount,Echo,'=Label\r\n" '"\'\r=Note",-3.2500,"\'\r=Note",\r\n' "'\tNote,,'\tNote,\r\n"
                "'+1-555-0142,,'+1-555-0142,\r\n" "'@home,,'@home,\r\n" "'-dash,,'-dash,\r\n" "plain,,plain,\r\n")
    assert body == expected.encode("utf-8")
    assert [r["cells"][m.c["Note"]]["display"] for r in m.read()["rows"]][:3] == ["\r=Note", "\tNote", "+1-555-0142"]


def test_export_storage_down(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    down = Api(outage("APP_MINIO_DOWN_URL"), MARA)
    r = down.request("POST", f"{L.tp('Customers')}/exports")
    assert r.status_code == 201
    e = r.json()["export"]
    assert (e["status"], e["byte_size"], e["sha256"], e["download_url"]) == ("failed", None, None, None)
    err(down.request("GET", f"/api/exports/{e['id']}/download"), 409, "export_not_ready")
    assert S3().keys(f"exports/{L.doc}/{e['id']}") == []
    started = time.monotonic()
    assert L.put(down, "Customers", "Moss Street Bakery", "Phone", "555-0199").status_code == 200
    assert time.monotonic() - started < COMMIT_BUDGET_S
    assert L.disp(L.mara, "Customers", "Moss Street Bakery", "Phone") == "555-0199"


def test_export_snapshot_download(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    e = L.export(L.mara, "Orders by Region").json()["export"]
    first = L.mara.request("GET", e["download_url"])
    assert first.headers["content-disposition"] == "attachment; filename=\"Orders by Region.csv\"; filename*=UTF-8''Orders%20by%20Region.csv"
    L.put(L.mara, "Orders", "ORD-1001", "Qty", "9")
    again = L.mara.request("GET", e["download_url"])
    assert again.content == first.content == S3().get(f"exports/{L.doc}/{e['id']}.csv")
    err(Api(outage("APP_MINIO_DOWN_URL"), MARA).request("GET", e["download_url"]), 503, "storage_unavailable")
    L.add_column("Orders", "Café", "text")
    L.add_column("Orders", "Re\ngion", "text")
    for groups, ascii_name, encoded in ((["Café"], "Orders by Caf_.csv", "Orders%20by%20Caf%C3%A9.csv"), (["Re\ngion"], None, None)):
        L.add_summary("Orders", groups, [])
        name = f"Orders by {groups[0]}"
        x = L.export(L.mara, name).json()["export"]
        header = L.mara.request("GET", x["download_url"]).headers["content-disposition"]
        assert header.isascii() and "\n" not in header and "\r" not in header
        if ascii_name:
            assert header == f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"
        assert urllib.parse.unquote(header.split("filename*=UTF-8''")[1]) == x["file_name"] == f"{name}.csv"
    assert L.mara.ok("GET", f"/api/exports/{e['id']}")["export"] == e


def test_export_abandoned(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    for _ in range(ABANDONS):
        with contextlib.suppress(httpx.TimeoutException):
            httpx.post(f"{app_url}{L.tp('Customers')}/exports", cookies={"tf_session": L.mara.token},
                       timeout=httpx.Timeout(HTTP_TIMEOUT, read=0.001))
    started = time.monotonic()
    assert L.put(L.mara, "Customers", "Moss Street Bakery", "Phone", "555-0199").status_code == 200
    assert time.monotonic() - started < COMMIT_BUDGET_S
    poll(lambda: all(e["status"] != "writing" for e in L.mara.ok("GET", f"{L.d}/exports")["exports"]), EXPORT_SETTLE_S, "exports leave writing")
    ready = L.export(L.mara, "Customers").json()["export"]
    for _ in range(ABANDONS):
        with L.mara.http.stream("GET", ready["download_url"]) as r:
            next(r.iter_raw(1))
    pg = Postgres()
    sql = ("SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user "
           "AND state IN ('active', 'idle in transaction')")
    poll(lambda: pg.rows(sql)[0]["n"] == 0, WAIT_S, "no app session active or idle in transaction")
    assert L.mara.request("GET", ready["download_url"]).status_code == 200
    assert httpx.get(app_url).status_code == 200


def test_export_record_point(app_url: str) -> None:
    L = Ledger(app_url)
    stop = threading.Event()

    def edits() -> None:
        stock = 40
        while not stop.is_set():
            stock += 1
            L.put(L.mara, "Products", "Oak Shelf Bracket", "Stock", str(stock))

    with cf.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(edits)
        try:
            records = [L.export(L.mara, "Products").json()["export"] for _ in range(5)]
        finally:
            stop.set()
        future.result()
    head = None
    for e in records:
        rows = csv_rows(L.mara.request("GET", e["download_url"]).content)
        head = rows[0]
        for row in rows[1:]:
            stock, units, left = (Decimal(row[head.index(c)]) for c in ("Stock", "Units Ordered", "Stock Left"))
            assert stock - units == left, row
        assert e["created_by"] == L.mara.user["id"] and e["document_revision"] <= L.revision()
    viewer = L.export(L.api(SAM), "Products").json()["export"]
    assert viewer["created_by"] == L.api(SAM).user["id"]
    assert L.mara.request("PATCH", L.tp("Products"), {"name": "Goods", "revision": 1}).status_code == 200
    for e in records:
        assert L.mara.ok("GET", f"/api/exports/{e['id']}")["export"] == e


PREVIEW_CASES = {
    "exponent": ("1e3", None, "Check the formula: it could not be read at character 2."),
    "exponent_after_equals": ("=1e3", None, "Check the formula: it could not be read at character 3."),
    "double_operator": ("[Qty] * * 2", None, "Check the formula: it could not be read at character 9."),
    "unmatched_paren": ("[Qty] * 2)", None, "Check the formula: it could not be read at character 10."),
    "open_string": ('[Qty] & "each', None, "Check the formula: it could not be read at character 9."),
    "open_bracket": ("[Qty", None, "Check the formula: it could not be read at character 1."),
    "bad_character": ("[Qty] # 2", None, "Check the formula: it could not be read at character 7."),
    "bare_point": ("5. + 1", None, "Check the formula: it could not be read at character 2."),
    "accented_name": ('"é" & é', None, "Check the formula: it could not be read at character 7."),
    "table_alone": ("Orders", None, "Check the formula: it could not be read at character 1."),
    "unknown_table": ("Foo + 1", None, "Check the formula: it could not be read at character 1."),
    "table_column_outside": ("Foo.[Qty] + 1", None, "Check the formula: it could not be read at character 1."),
    "table_after_equals": ("=Orders.[Qty] + 1", None, "Check the formula: it could not be read at character 2."),
    "table_in_expression": ("SUM(Orders.[Qty] + 1)", None, "Check the formula: it could not be read at character 5."),
    "ends_operator": ("[Qty] *", None, "Check the formula: it ended too early."),
    "ends_call": ("SUM(", None, "Check the formula: it ended too early."),
    "ends_argument": ("SUM(Orders.[Qty]", None, "Check the formula: it ended too early."),
    "equals_only": ("=", None, "Check the formula: it ended too early."),
    "too_long": ("<too long>", None, "Check the formula: use at most 2,000 characters."),
    "longest": ("<longest>", "4.0000", None),
    "decimal_result": ("=[Qty] * 2", "8.0000", None),
    "error_result": ("1/0", "#DIV/0!", "#DIV/0! Division by zero."),
    "name_result": ("[Nope] + 1", "#NAME?", "#NAME? This formula uses a name that does not exist."),
    "blank_result": ("[Note]", "", None),
}


@pytest.mark.parametrize("case", list(PREVIEW_CASES), ids=list(PREVIEW_CASES))
def test_formula_preview(app_url: str, case: str) -> None:
    formula, display, diagnosis = PREVIEW_CASES[case]
    formula = {"<too long>": "4" + " " * FORMULA_MAX, "<longest>": "4" + " " * (FORMULA_MAX - 1)}.get(formula, formula)
    api = Api(app_url, MARA)
    m = Mini(api, [("Qty", "decimal", {}), ("Note", "text", {})], table="Orders")
    row = m.row({"Qty": "4"})
    rev = m.revision()
    started = time.monotonic()
    r = api.request("POST", f"{m.tp}/formula-preview", {"formula": formula, "row_id": row["id"]})
    assert time.monotonic() - started < PREVIEW_BUDGET_S
    assert r.status_code == 200
    body = r.json()
    assert (body["display"], body["diagnosis"]) == (display, diagnosis)
    if display is None:
        assert body["kind"] is None
    elif display.startswith("#"):
        assert body["kind"] == "error"
    unknown = api.request("POST", f"{m.tp}/formula-preview", {"formula": "1", "row_id": "probe-row"})
    assert err(unknown, 422, "invalid")["fields"]["row_id"] == ROW_ID_MSG
    assert m.revision() == rev and len(m.read()["columns"]) == 2


PRECEDENCE = ["stale_and_invalid", "viewer_unknown_table", "editor_stale_rename", "viewer_empty_undo", "replay_after_viewer",
              "replay_after_change", "paste_hidden_and_stale", "paste_stale_and_invalid", "signed_out_null_origin", "export_foreign_no_session"]


@pytest.mark.parametrize("case", PRECEDENCE, ids=PRECEDENCE)
def test_error_precedence(app_url: str, case: str) -> None:
    if case == "signed_out_null_origin":
        err(httpx.post(f"{app_url}/api/auth/sign-out", headers={"Origin": "null"}), 403, "cross_origin")
        return
    L = Ledger(app_url)
    rev = L.revision()
    o, p = L.c["Orders"], L.tp("Orders")
    if case == "stale_and_invalid":
        err(L.put(L.api(PRIYA), "Orders", "ORD-1001", "Qty", "abc", revision=0), 409, "stale_revision")
    elif case == "viewer_unknown_table":
        err(L.api(SAM).request("PUT", f"{L.d}/tables/probe-table/rows/x/cells/y", {"value": "1", "revision": 1}), 404, "not_found")
    elif case == "editor_stale_rename":
        err(L.patch_col(L.api(PRIYA), "Orders", "Qty", revision=0, name="Quantity"), 403, "forbidden")
    elif case == "viewer_empty_undo":
        err(L.api(SAM).request("POST", f"{L.d}/undo"), 403, "forbidden")
    elif case == "replay_after_viewer":
        jonah, key = L.api(JONAH), idempotency_key()
        L.share(JONAH, "editor", "all")
        assert L.put(jonah, "Orders", "ORD-1001", "Qty", "5", revision=1, idem=key).status_code == 200
        L.share(JONAH, "viewer", "all")
        rev = L.revision()
        err(L.put(jonah, "Orders", "ORD-1001", "Qty", "5", revision=1, idem=key), 403, "forbidden")
    elif case == "replay_after_change":
        priya, key = L.api(PRIYA), idempotency_key()
        first = L.put(priya, "Orders", "ORD-1001", "Qty", "5", revision=1, idem=key)
        L.put(L.mara, "Orders", "ORD-1001", "Qty", "7")
        rev = L.revision()
        replay = L.put(priya, "Orders", "ORD-1001", "Qty", "5", revision=1, idem=key)
        assert replay.status_code == 200 and replay.content == first.content and replay.headers["Idempotent-Replayed"] == "true"
        assert L.disp(L.mara, "Orders", "ORD-1001", "Qty") == "7.0000"
    elif case == "paste_hidden_and_stale":
        body = {"writes": [{"row_id": L.r["Orders"]["ORD-1002"], "column_id": o["Qty"], "value": "1", "revision": 1},
                           {"row_id": L.r["Orders"]["ORD-1001"], "column_id": o["Qty"], "value": "1", "revision": 0}]}
        err(L.api(DEV).request("POST", f"{p}/cells", body), 404, "not_found")
    elif case == "paste_stale_and_invalid":
        body = {"writes": [{"row_id": L.r["Orders"]["ORD-1001"], "column_id": o["Qty"], "value": "1", "revision": 0},
                           {"row_id": L.r["Orders"]["ORD-1003"], "column_id": o["Qty"], "value": "abc", "revision": 1}]}
        e = err(L.api(PRIYA).request("POST", f"{p}/cells", body), 409, "stale_revision")
        assert [(c["row_id"], c["column_id"]) for c in e["conflicts"]] == [(L.r["Orders"]["ORD-1001"], o["Qty"])]
        assert e["current"]["display"] == "4.0000"
    elif case == "export_foreign_no_session":
        err(httpx.post(f"{app_url}{L.tp('Customers')}/exports", headers={"Origin": "http://other.example"}), 403, "cross_origin")
        assert L.mara.ok("GET", f"{L.d}/exports")["exports"] == []
    assert L.revision() == rev


def test_health_and_outage_boot(app_url: str) -> None:
    for base in (app_url.rstrip("/"), outage("APP_MAILPIT_DOWN_URL"), outage("APP_MINIO_DOWN_URL")):
        r = httpx.get(f"{base}/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert any(d["name"] == SEED_DOC for d in Api(base, MARA).ok("GET", "/api/documents")["documents"])
    L = Ledger(app_url, shares=False)
    assert Api(outage("APP_MAILPIT_DOWN_URL"), MARA).ok("POST", f"{L.d}/shares", {"email": fresh("boot")[1], "role": "viewer", "row_scope": "all"})["share"]["invite_status"] == "not_sent"
    assert L.export(L.mara, "Customers").json()["export"]["status"] == "ready"


BOUNDARY = ["oversized_body", "exact_limit", "wrong_content_type", "unknown_api_path", "no_store", "no_cross_origin_headers",
            "no_source_files", "no_credentials"]


@pytest.mark.parametrize("case", BOUNDARY, ids=BOUNDARY)
def test_server_boundary(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    if case in ("oversized_body", "exact_limit"):
        size = MAX_BODY_BYTES + (1 if case == "oversized_body" else 0)
        body = '{"name":"' + "a" * (size - len('{"name":""}')) + '"}'
        r = httpx.post(f"{base}/api/documents", content=body.encode(), headers={"Content-Type": "application/json"})
        if case == "oversized_body":
            err(r, 413, "payload_too_large")
        else:
            assert r.status_code != 413
    elif case == "wrong_content_type":
        err(httpx.post(f"{base}/api/documents", content=b"name=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    elif case == "unknown_api_path":
        r = httpx.get(f"{base}/api/probe-unknown")
        err(r, 404, "not_found")
        assert r.headers["content-type"].startswith("application/json")
    elif case == "no_store":
        for path in ("/", "/api/health", "/d/probe"):
            assert "no-store" in httpx.get(f"{base}{path}").headers.get("cache-control", "")
    elif case == "no_cross_origin_headers":
        for r in (httpx.get(f"{base}/api/health", headers={"Origin": "http://other.example"}),
                  httpx.options(f"{base}/api/documents", headers={"Origin": "http://other.example", "Access-Control-Request-Method": "POST"})):
            assert not any(h.lower().startswith("access-control-") for h in r.headers)
    elif case == "no_source_files":
        shell = httpx.get(base).text
        for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts"):
            r = httpx.get(f"{base}{path}")
            assert r.status_code != 200 or r.text == shell
        for asset in re.findall(r'(?:src|href)="(/[^"]+\.js)"', shell):
            r = httpx.get(f"{base}{asset}.map")
            assert r.status_code != 200 or r.text == shell
    else:
        secrets = [os.environ.get(v, "") for v in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
        secrets.append(urllib.parse.urlsplit(os.environ.get("DATABASE_URL", "")).password or "")
        secrets = [s for s in secrets if len(s) >= 6]
        shell = httpx.get(base).text
        bodies = [shell] + [httpx.get(f"{base}{a}").text for a in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', shell)]
        bodies.append(Api(base, MARA).request("GET", "/api/me").text)
        for body in bodies:
            assert not any(s in body for s in secrets)


def test_seed_data(app_url: str) -> None:
    for email in DISPLAY_NAMES:
        assert Api(app_url, email).user["display_name"] == DISPLAY_NAMES[email]
    mara = Api(app_url, MARA)
    doc = next(d for d in mara.ok("GET", "/api/documents")["documents"] if d["name"] == SEED_DOC)
    d = f"/api/documents/{doc['id']}"
    full = mara.ok("GET", d)
    assert full["document"]["revision"] == 0 and mara.ok("GET", f"{d}/history")["entries"] == []
    assert [(t["name"], t["kind"]) for t in full["tables"]] == [("Products", "table"), ("Customers", "table"), ("Orders", "table"), ("Orders by Region", "summary")]
    ids = {t["name"]: t["id"] for t in full["tables"]}
    read = lambda api, name: api.ok("GET", f"{d}/tables/{ids[name]}")["table"]
    expected_cols = {
        "Products": [("Name", "text", None), ("SKU", "text", None), ("Price", "decimal", None), ("Stock", "decimal", None),
                     ("Units Ordered", "formula", UNITS_ORDERED), ("Stock Left", "formula", STOCK_LEFT)],
        "Customers": [("Name", "text", None), ("Region", "text", None), ("Phone", "text", None), ("Owner", "text", None)],
        "Orders": [("Order No", "text", None), ("Customer", "reference", None), ("Product", "reference", None), ("Qty", "decimal", None),
                   ("Owner", "text", None), ("Line Total", "formula", LINE_TOTAL), ("Region", "formula", REGION)],
    }
    displays = {
        "Products": [["Oak Shelf Bracket", "OSB-01", "12.5000", "40.0000", "10.0000", "30.0000"],
                     ["Walnut Floating Shelf", "WFS-02", "68.0000", "12.0000", "2.0000", "10.0000"],
                     ["Brass Hinge Pair", "BHP-03", "9.7500", "150.0000", "10.0000", "140.0000"],
                     ["Birch Ply Sheet", "BPS-04", "41.2000", "25.0000", "3.0000", "22.0000"]],
        "Customers": [[c["Name"], c["Region"], c["Phone"], c["Owner"]] for c in CUSTOMERS],
        "Orders": [[o["Order No"], o["Customer"], o["Product"], o["Qty"], o["Owner"], lt, rg] for o, lt, rg in
                   zip(ORDERS, ("50.0000", "136.0000", "97.5000", "75.0000", "123.6000"), ("North", "South", "North", "South", "North"))],
        "Orders by Region": [["North", "3.0000", "17.0000", "271.1000"], ["South", "2.0000", "8.0000", "211.0000"]],
    }
    for name, rows in displays.items():
        table = read(mara, name)
        cols = sorted(table["columns"], key=lambda c: c["position"])
        if name in expected_cols:
            assert [(c["name"], c["type"], c["formula"]) for c in cols] == expected_cols[name]
            assert all(c["revision"] == 1 for c in cols) and table["revision"] == 1
            assert all(r["revision"] == 1 and all(v["revision"] in (1, None) for v in r["cells"].values()) for r in table["rows"])
            owner = next((c["id"] for c in cols if c["name"] == "Owner"), None) if name != "Products" else None
            assert table["owner_column_id"] == owner
        else:
            assert [c["name"] for c in cols] == ["Region", "Count", "Sum of Qty", "Sum of Line Total"]
        assert [[r["cells"][c["id"]]["display"] for c in cols] for r in table["rows"]] == rows
    shares = {s["email"]: (s["role"], s["row_scope"], s["invite_status"]) for s in mara.ok("GET", f"{d}/shares")["shares"]}
    assert shares == {DEV: ("editor", "own", "sent"), PRIYA: ("editor", "all", "sent"), SAM: ("viewer", "all", "sent")}
    assert doc["id"] not in [x["id"] for x in Api(app_url, JONAH).ok("GET", "/api/documents")["documents"]]
    dev = Api(app_url, DEV)
    assert len(read(dev, "Orders")["rows"]) == 3 and len(read(dev, "Customers")["rows"]) == 2 and len(read(dev, "Orders by Region")["rows"]) == 1


def test_formula_functions(app_url: str) -> None:
    L = Ledger(app_url)
    L.add_column("Orders", "Bad", "formula", formula="1/0")
    L.add_column("Orders", "Spare", "decimal")
    L.add_column("Orders", "Due", "date")
    for key, due in (("ORD-1001", "2026-03-14"), ("ORD-1002", "9999-12-31"), ("ORD-1003", "0001-01-01")):
        L.put(L.mara, "Orders", key, "Due", due)
    cases = [
        (L.mara, "Products", "Oak Shelf Bracket", [("SUM(Orders.[Qty])", "25.0000"), ("COUNT(Orders)", "5.0000"), ("MAX(Orders.[Qty])", "10.0000"),
          ("MIN(Orders.[Qty])", "2.0000"), ("AVERAGE(Orders.[Qty])", "5.0000"), ("COUNTBY(Orders.[Product])", "2.0000"),
          ("SUMBY(Orders.[Qty], Orders.[Customer])", "#TYPE!"), ("SUM(Orders.[Owner])", "#TYPE!"), ("SUM(Orders.[Bad])", "#DIV/0!"),
          ("MIN(Orders.[Spare])", ""), ("AVERAGE(Orders.[Spare])", "#DIV/0!"), ("ROUND(2.345, 2)", "2.3500"), ("ROUND(-2.345, 2)", "-2.3500"),
          ("ROUND(10/3, 2)", "3.3300"), ("ROUND(1, 5)", "#TYPE!"), ("ROUND(1)", "#TYPE!"), ("IF(TRUE, 5, 1/0)", "5.0000"),
          ("IF(FALSE, 1/0, 4)", "4.0000"), ("IF(1, 5, 4)", "#TYPE!"), ("IFERROR(1/0, 5)", "5.0000"), ("IFERROR(4, 1/0)", "4.0000")]),
        (L.api(DEV), "Products", "Oak Shelf Bracket", [("MAX(Orders.[Qty])", "10.0000"), ("AVERAGE(Orders.[Qty])", "5.6667")]),
        (L.mara, "Orders", "ORD-1001", [("[Due] - [Due]", "0.0000"), ("[Due] + 0", "2026-03-14"), ("0 + [Due]", "2026-03-14"),
          ("[Due] + 1.5", "#TYPE!"), ("[Due] * 2", "#TYPE!"), ("-[Due]", "#TYPE!"), ("1 - [Due]", "#TYPE!"), ("[Due] + [Due]", "#TYPE!"),
          ("[Due] > [Due]", "FALSE")]),
        (L.mara, "Orders", "ORD-1002", [("[Due] + 1", "#TYPE!")]),
        (L.mara, "Orders", "ORD-1003", [("[Due] - 1", "#TYPE!")]),
    ]
    failures = []
    for api, table, key, pairs in cases:
        for formula, expected in pairs:
            got = L.preview(api, table, key, formula).json()["display"]
            if got != expected:
                failures.append((formula, expected, got))
    assert not failures


def test_column_rename_rewrites(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    api = L.mara
    L.add_column("Customers", "Price", "decimal")
    L.add_column("Orders", "Cust Price", "formula", formula="[Customer].[Price]")
    L.add_column("Products", "Spaced", "formula", formula=SPACED.format(SPACED_TOKEN))
    L.add_column("Products", "Lookup", "formula", formula="[Cost] + 1")
    r = L.patch_col(api, "Products", "Price", name="Unit Price").json()
    assert r["recalc"]["cells"] == [] and L.col(api, "Orders", "Line Total")["formula"] == "[Qty] * [Product].[Unit Price]"
    assert L.col(api, "Orders", "Line Total")["revision"] == 2 and L.col(api, "Products", "Price")["revision"] == 2
    assert L.col(api, "Orders", "Cust Price")["formula"] == "[Customer].[Price]"
    api.ok("POST", f"{L.d}/undo")
    assert L.col(api, "Orders", "Line Total")["formula"] == LINE_TOTAL
    L.patch_col(api, "Orders", "Qty", name="Quantity")
    assert L.col(api, "Products", "Units Ordered")["formula"] == "SUMBY(Orders.[Quantity], Orders.[Product])"
    assert L.col(api, "Orders", "Line Total")["formula"] == "[Quantity] * [Product].[Price]"
    assert L.col(api, "Products", "Spaced")["formula"] == SPACED.format("Quantity")
    assert "Sum of Quantity" in [c["name"] for c in L.columns(api, "Orders by Region")]
    api.ok("POST", f"{L.d}/undo")
    assert L.col(api, "Products", "Spaced")["formula"] == SPACED.format(SPACED_TOKEN)
    assert "Sum of Qty" in [c["name"] for c in L.columns(api, "Orders by Region")]
    area = "Area"
    L.patch_col(api, "Orders", "Region", name=area)
    assert api.ok("GET", L.tp("Orders by Region"))["table"]["name"] == summary_name("Orders", [area])
    api.ok("POST", f"{L.d}/undo")
    resolved = L.patch_col(api, "Products", "Stock", name="Cost").json()["recalc"]
    lookups = [e for e in L.describe(resolved) if e[2] == "Lookup"]
    assert len(lookups) == 4 and all(e[3] == "#NAME?" and e[4] != "#NAME?" and e[5] == 1 for e in lookups)
    api.ok("POST", f"{L.d}/undo")
    assert L.disp(api, "Products", "Oak Shelf Bracket", "Lookup") == "#NAME?"


def test_table_rename_rewrites(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    api = L.mara
    L.add_column("Products", "Tally", "formula", formula=TALLY.format(TALLY_TOKEN))
    r = api.request("PATCH", L.tp("Orders"), {"name": "Sales", "revision": 1})
    assert r.status_code == 200 and r.json()["table"]["revision"] == 2
    assert L.col(api, "Products", "Units Ordered")["formula"] == "SUMBY(Sales.[Qty], Sales.[Product])"
    assert L.col(api, "Products", "Units Ordered")["revision"] == 2
    assert L.col(api, "Products", "Tally")["formula"] == TALLY.format("Sales")
    assert api.ok("GET", L.tp("Orders by Region"))["table"]["name"] == "Sales by Region"
    assert L.export(api, "Orders").json()["export"]["file_name"] == csv_file("Sales")
    summary_rev = api.ok("GET", L.tp("Orders by Region"))["table"]["revision"]
    assert err(api.request("PATCH", L.tp("Orders by Region"), {"name": "X", "revision": summary_rev}), 422, "invalid")["fields"]["table"]
    api.ok("POST", f"{L.d}/undo")
    assert api.ok("GET", L.tp("Orders"))["table"]["name"] == "Orders"
    assert L.col(api, "Products", "Units Ordered")["formula"] == UNITS_ORDERED
    assert L.col(api, "Products", "Tally")["formula"] == TALLY.format(TALLY_TOKEN)
    assert api.ok("GET", L.tp("Orders by Region"))["table"]["name"] == "Orders by Region"


def test_paste_block(app_url: str) -> None:
    api = Api(app_url, MARA)
    m = Mini(api, [(f"C{i}", "text", {}) for i in range(6)] + [("Num", "decimal", {})])
    rows = [m.row() for _ in range(PASTE_MAX // 6 + 1)]
    cells = [(r["id"], m.c[f"C{i}"]) for r in rows for i in range(6)]
    write = lambda rc, v="x", rev=1: {"row_id": rc[0], "column_id": rc[1], "value": v, "revision": rev}
    paste = lambda writes: api.request("POST", f"{m.tp}/cells", {"writes": writes})
    for writes, message in (([write(c) for c in cells[:PASTE_MAX + 1]], PASTE_COUNT_MSG), ([], PASTE_COUNT_MSG),
                            ([write(cells[0]), write(cells[0])], PASTE_TWICE_MSG), ([{"column_id": cells[0][1], "value": "x", "revision": 1}], PASTE_COUNT_MSG)):
        assert err(paste(writes), 422, "invalid")["fields"]["writes"] == message
    bad = paste([write(cells[0]), write((rows[1]["id"], m.c["Num"]), "abc")])
    assert err(bad, 422, "invalid")["fields"][f"{rows[1]['id']}:{m.c['Num']}"] == DECIMAL_MSG
    assert m.cell(rows[0]["id"], "C0")["display"] == ""
    rev, history = m.revision(), len(api.ok("GET", f"{m.d}/history")["entries"])
    base = api.ok("GET", m.d)["document"]["undo_count"]
    ok = paste([write(c, "y") for c in cells[:PASTE_MAX]])
    assert ok.status_code == 200 and len(ok.json()["cells"]) == PASTE_MAX
    entries = api.ok("GET", f"{m.d}/history")["entries"]
    assert m.revision() == rev + 1 and len(entries) == history + 1 and entries[-1]["kind"] == "cell_batch"
    assert ok.json()["recalc"]["stacks"]["undo_count"] == min(base + 1, STACK_MAX)
    stale = err(paste([write(cells[0], "z", 2), write(cells[1], "z", 1), write(cells[2], "z", 1)]), 409, "stale_revision")
    assert [(c["row_id"], c["column_id"]) for c in stale["conflicts"]] == [cells[1], cells[2]]
    assert stale["current"]["display"] == "y" and m.cell(rows[0]["id"], "C0")["display"] == "y"
    api.ok("POST", f"{m.d}/undo")
    assert m.cell(rows[0]["id"], "C0")["display"] == "" and m.cell(rows[-2]["id"], "C1")["display"] == ""


def test_column_revisions(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    assert L.patch_col(priya, "Orders", "Line Total", formula="[Qty] * 2").status_code == 200
    e = err(L.patch_col(priya, "Orders", "Line Total", revision=1, formula="[Qty] * 3"), 409, "stale_revision")
    assert e["current"]["column"]["formula"] == "[Qty] * 2" and e["current"]["column"]["revision"] == 2
    results = parallel([lambda i=i: L.patch_col(priya, "Orders", "Line Total", revision=2, formula=f"[Qty] * {i + 3}") for i in range(PARALLEL)])
    winners = [r for r in results if r.status_code == 200]
    assert len(winners) == 1
    for r in results:
        if r is not winners[0]:
            assert err(r, 409, "stale_revision")["current"]["column"]["formula"] == winners[0].json()["column"]["formula"]


def test_linearisable_edits(app_url: str) -> None:
    L = Ledger(app_url)
    L.learn(L.mara)
    results = parallel([lambda k=k, v=v: L.put(L.mara, "Orders", k, "Qty", v) for k, v in (("ORD-1001", "5"), ("ORD-1003", "11"), ("ORD-1005", "4"))])
    entries = [e for r in results for e in L.describe(r.json()["recalc"]) if e[:3] == ("Orders by Region", "North", "Sum of Qty")]
    links = {old: new for *_, old, new, _d in entries}
    assert len(links) == len(entries) == 3
    value = "17.0000"
    for _ in entries:
        value = links[value]
    assert value == L.disp(L.mara, "Orders by Region", "North", "Sum of Qty")
    priya = L.api(PRIYA)
    adds = parallel([lambda: priya.request("POST", f"{L.tp('Orders')}/rows", {"cells": {}}) for _ in range(PARALLEL)])
    counts = sorted(r.json()["recalc"]["row_counts"][L.t["Orders"]] for r in adds)
    assert counts == list(range(6, 6 + PARALLEL))


def test_row_delete_races(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    for i in range(4):
        key = f"ORD-R{i}"
        L.add_row("Orders", {"Order No": key, "Qty": "1"})
        write, delete = parallel([lambda: L.put(L.mara, "Orders", key, "Qty", "2", revision=1),
                                  lambda: L.delete_row(L.mara, "Orders", key, revision=1)])
        assert sorted([write.status_code, delete.status_code]) in ([200, 404], [200, 409])
        if delete.status_code == 200:
            err(write, 404, "not_found")
        else:
            assert err(delete, 409, "stale_revision")["current"]["row"]["revision"] == 2
    L.add_row("Orders", {"Order No": "ORD-S1", "Qty": "1"})
    assert L.put(L.mara, "Orders", "ORD-S1", "Qty", "2", revision=1).status_code == 200
    err(L.delete_row(L.mara, "Orders", "ORD-S1", revision=1), 409, "stale_revision")


def test_schema_data_races(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    api = L.mara
    lt = L.col(api, "Orders", "Line Total")["revision"]
    L.patch_col(api, "Products", "Price", name="Unit Price")
    e = err(L.patch_col(api, "Orders", "Line Total", revision=lt, formula="[Product].[Price] * 2"), 409, "stale_revision")
    assert e["current"]["column"]["formula"] == "[Qty] * [Product].[Unit Price]"
    assert L.add_column("Orders", "Old", "formula", formula="[Product].[Price]") and L.disp(api, "Orders", "ORD-1001", "Old") == "#NAME?"
    api.ok("POST", f"{L.d}/undo")
    api.ok("POST", f"{L.d}/undo")
    L.patch_col(api, "Orders", "Line Total", formula="[Product].[Price] * 2")
    new_price = "Cost"
    assert L.patch_col(api, "Products", "Price", name=new_price).status_code == 200
    assert L.col(api, "Orders", "Line Total")["formula"] == f"[Product].[{new_price}] * 2"
    sku = L.cell(api, "Products", "Oak Shelf Bracket", "SKU")["revision"]
    L.patch_col(api, "Products", "SKU", type="decimal")
    e = err(L.put(api, "Products", "Oak Shelf Bracket", "SKU", "5", revision=sku), 409, "stale_revision")
    assert e["current"]["display"] == "" and e["current"]["revision"] == sku + 1
    L.add_column("Products", "Note", "text")
    assert L.put(api, "Products", "Oak Shelf Bracket", "Note", "12.5", revision=1).status_code == 200
    assert L.patch_col(api, "Products", "Note", type="decimal").status_code == 200
    assert L.disp(api, "Products", "Oak Shelf Bracket", "Note") == "12.5000"


def test_history(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    entries = L.history()
    assert [e["revision"] for e in entries] == list(range(1, L.revision() + 1))
    assert [e["kind"] for e in entries[:3]] == ["table_add"] * 3
    key = idempotency_key()
    L.put(priya, "Orders", "ORD-1001", "Qty", "5", revision=1, idem=key)
    L.put(priya, "Orders", "ORD-1001", "Qty", "5", revision=1, idem=key)
    L.put(priya, "Orders", "ORD-1001", "Qty", "6", revision=1)
    L.mara.request("POST", f"{L.d}/redo")
    priya.ok("POST", f"{L.d}/undo")
    after = L.history()
    assert len(after) == len(entries) + 2
    assert [(e["kind"], e["actor_id"], e["table_id"]) for e in after[-2:]] == [("cell_write", priya.user["id"], L.t["Orders"]), ("undo", priya.user["id"], L.t["Orders"])]
    assert [e["revision"] for e in after] == list(range(1, L.revision() + 1))
    assert L.api(SAM).ok("GET", f"{L.d}/history")["entries"] == after


def test_counts_after_rapid_changes(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    ops = [lambda: priya.request("POST", f"{L.tp('Orders')}/rows", {"cells": {L.c["Orders"]["Qty"]: "1"}}) for _ in range(3)]
    ops += [lambda: L.delete_row(priya, "Orders", "ORD-1002"), lambda: L.delete_row(priya, "Orders", "ORD-1004"),
            lambda: priya.request("POST", f"{L.d}/undo"), lambda: priya.request("POST", f"{L.d}/undo"), lambda: priya.request("POST", f"{L.d}/redo")]
    for op in ops:
        recalc = op().json()["recalc"]
        doc = priya.ok("GET", L.d)
        counts = {t["id"]: (t["row_count"], t["column_count"]) for t in doc["tables"]}
        for tid, n in recalc["row_counts"].items():
            assert counts[tid][0] == n
        for tid, n in recalc["column_counts"].items():
            assert counts[tid][1] == n
        assert recalc["stacks"] == {"undo_count": doc["document"]["undo_count"], "redo_count": doc["document"]["redo_count"]}
        assert counts[L.t["Orders by Region"]][0] == len(L.rows(priya, "Orders by Region"))
        L.check_list(priya, recalc)


def test_idempotent_commits(app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    key, rev = idempotency_key(), L.revision()
    first = L.put(priya, "Orders", "ORD-1001", "Qty", "5", revision=1, idem=key)
    assert first.status_code == 200 and "Idempotent-Replayed" not in first.headers
    again = L.put(priya, "Orders", "ORD-1001", "Qty", "5", revision=1, idem=key)
    assert again.content == first.content and again.headers["Idempotent-Replayed"] == "true" and L.revision() == rev + 1
    reused = err(L.put(priya, "Orders", "ORD-1001", "Qty", "6", revision=2, idem=key), 422, "idempotency_key")
    assert reused["fields"]["idempotency_key"] == KEY_REUSED_MSG
    for bad in ("bad key", "x" * (KEY_MAX + 1), "key.1"):
        assert err(L.put(priya, "Orders", "ORD-1003", "Qty", "1", idem=bad), 422, "idempotency_key")["fields"]["idempotency_key"] == KEY_FORMAT_MSG
    assert L.put(priya, "Orders", "ORD-1003", "Qty", "1", idem="k" * KEY_MAX).status_code == 200
    stacks = priya.ok("GET", L.d)["document"]["undo_count"]
    ukey = idempotency_key()
    assert [priya.request("POST", f"{L.d}/undo", key=ukey).status_code for _ in range(2)] == [200, 200]
    assert priya.ok("GET", L.d)["document"]["undo_count"] == stacks - 1
    empty, ekey = Api(app_url, SAM), idempotency_key()
    L.share(SAM, "editor", "all")
    err(empty.request("POST", f"{L.d}/undo", key=ekey), 409, "nothing_to_undo")
    L.put(empty, "Orders", "ORD-1002", "Qty", "3")
    assert empty.request("POST", f"{L.d}/undo", key=ekey).status_code == 200
    pkey = idempotency_key()
    rev = L.revision()
    burst = parallel([lambda: L.put(priya, "Orders", "ORD-1005", "Qty", "8", revision=1, idem=pkey) for _ in range(5)])
    assert all(r.status_code == 200 and r.content == burst[0].content for r in burst) and L.revision() == rev + 1


def test_idempotency_ttl(app_url: str) -> None:
    api = Api(outage("APP_SHORT_TTL_URL"), MARA)
    m = Mini(api, [("Qty", "decimal", {})])
    row = m.row({"Qty": "1"})
    key = idempotency_key()
    assert m.put(row["id"], "Qty", "2", 1, key=key).status_code == 200
    err(m.put(row["id"], "Qty", "3", 2, key=key), 422, "idempotency_key")
    poll(lambda: m.put(row["id"], "Qty", "3", 2, key=key).status_code == 200, SHORT_TTL_WAIT_S, "key expiry")
    assert m.cell(row["id"], "Qty")["display"] == "3.0000"


SETTLED_MS = 2 * ROLL_STEP_MS + ROLL_MS


@contextlib.contextmanager
def qty_example(browser: Browser, app_url: str) -> Iterator[tuple[Ledger, Page, Locator, Locator, int]]:
    L = Ledger(app_url)
    qi, lt = L.idx(L.mara, "Orders", "Qty"), L.idx(L.mara, "Orders", "Line Total")
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        qty, total = gcell(page, "Orders", "ORD-1001", qi), gcell(page, "Orders", "ORD-1001", lt)
        before = int(attr(main(page), "data-doc-revision") or "-1")
        record(status(page, "Recalculation announcements"), "polite")
        commit(page, qty, "4.16")
        wait(page, lambda: txt(qty) == "4.1600" and attr(qty, "aria-busy") != "true", "applied", step=0)
        yield L, page, qty, total, before


def test_wf_settle_roll_example(browser: Browser, app_url: str) -> None:
    with qty_example(browser, app_url) as (L, page, qty, total, _):
        assert txt(qty) == "4.1600"
        advance(page, ROLL_STEP_MS - 1)
        assert txt(total) == "50.0000"
        advance(page, ROLL_MS + 1)
        assert txt(total) == "52.0000"
        advance(page, TALLY_MAX_MS)
        assert txt(total) == "52.0000"
    assert L.disp(L.mara, "Orders", "ORD-1001", "Line Total") == "52.0000"


def test_wf_settle_roll_phases(browser: Browser, app_url: str) -> None:
    with qty_example(browser, app_url) as (_L, page, qty, total, _):
        assert attr(qty, "data-roll") is None and attr(total, "data-roll") == "waiting"
        advance(page, ROLL_STEP_MS - 1)
        assert attr(total, "data-roll") == "waiting"
        advance(page, ROLL_SAMPLE_MS - ROLL_STEP_MS + 1)
        assert attr(total, "data-roll") == "rolling"
        spans = total.evaluate("e => { const s = [...e.querySelectorAll('[data-char]')]; return {chars: s.map(x => x.getAttribute('data-char')), rolling: s.flatMap((x, i) => x.getAttribute('data-rolling') === 'true' ? [i] : [])}; }")
        point = (spans["chars"] or ["."]).index(".")
        assert spans["rolling"] == [point - 1]
        advance(page, ROLL_STEP_MS + ROLL_MS - ROLL_SAMPLE_MS)
        assert attr(total, "data-roll") == "settled"
        chars = total.evaluate("e => [...e.querySelectorAll('[data-char]')].map(x => x.getAttribute('data-char')).join('')")
        assert chars == "52.0000"


def test_wf_settle_roll_markers(browser: Browser, app_url: str) -> None:
    with qty_example(browser, app_url) as (L, page, qty, total, _):
        assert attr(total, "data-recalc-depth") == "1" and attr(qty, "data-recalc-depth") is None
        assert link(page, "Products, 4 rows, 2 changed").count() == 1 and link(page, "Orders by Region, 2 rows, 2 changed").count() == 1
        assert link(page, rail_name("Orders", 5)).count() == 1
        advance(page, TALLY_MAX_MS)
        assert attr(total, "data-recalc-depth") == "1"
        link(page, "Products, 4 rows, 2 changed").click()
        ready(page, "Products", "Walnut Floating Shelf")
        assert link(page, "Products, 4 rows").count() == 1 and link(page, "Orders by Region, 2 rows, 2 changed").count() == 1
        si, sl = L.idx(L.mara, "Products", "Stock"), L.idx(L.mara, "Products", "Stock Left")
        commit(page, gcell(page, "Products", "Walnut Floating Shelf", si), "13")
        left = gcell(page, "Products", "Walnut Floating Shelf", sl)
        wait(page, lambda: attr(left, "data-recalc-depth") == "1", "new marker")
        assert link(page, "Orders by Region, 2 rows").count() == 1


def test_wf_settle_roll_tally(browser: Browser, app_url: str) -> None:
    with qty_example(browser, app_url) as (_L, page, _qty, _total, _):
        samples = [max(tally(page), default=0)]
        assert samples[0] < 5
        elapsed = 0
        while elapsed < SETTLED_MS:
            step = min(ROLL_STEP_MS, SETTLED_MS - elapsed)
            advance(page, step)
            elapsed += step
            samples.append(max(tally(page), default=0))
        assert samples == sorted(samples) and samples[-1] == 5
        assert set(tally(page)) == {5} and "Recalculated 5 cells in 3 tables." in visible_text(page)
        advance(page, TALLY_MAX_MS)
        assert fills(page, "polite", "Recalculated 5 cells in 3 tables.") == 1


def test_wf_settle_roll_settled(browser: Browser, app_url: str) -> None:
    with qty_example(browser, app_url) as (L, page, _qty, _total, before):
        assert attr(main(page), "data-doc-revision") == str(before + 1)
        assert attr(main(page), "data-settled") == "false"
        advance(page, SETTLED_MS - 1)
        assert attr(main(page), "data-settled") == "false"
        advance(page, 1)
        assert attr(main(page), "data-settled") == "true"
    assert L.revision() == before + 1


def test_wf_settle_roll_new_commit(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    qi, lt = L.idx(L.mara, "Orders", "Qty"), L.idx(L.mara, "Orders", "Line Total")
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        first = gcell(page, "Orders", "ORD-1001", lt)
        commit(page, gcell(page, "Orders", "ORD-1001", qi), "4.16")
        wait(page, lambda: attr(first, "data-recalc-depth") == "1", "first roll", step=0)
        advance(page, ROLL_SAMPLE_MS - ROLL_STEP_MS)
        commit(page, gcell(page, "Orders", "ORD-1003", qi), "5")
        second = gcell(page, "Orders", "ORD-1003", lt)
        wait(page, lambda: attr(second, "data-recalc-depth") == "1", "second roll", step=0)
        assert txt(first) == "52.0000" and attr(first, "data-recalc-depth") is None and attr(first, "data-roll") is None
        advance(page, TALLY_MAX_MS * 2)
        assert txt(first) == "52.0000" and attr(first, "data-recalc-depth") is None
        assert [m.split("@")[1] for m in markers(grid(page, "Orders"))] == ["1"]
    L.check_totals(L.mara)


def test_wf_settle_roll_reduced_motion(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    qi, lt = L.idx(L.mara, "Orders", "Qty"), L.idx(L.mara, "Orders", "Line Total")
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        record(status(page, "Recalculation announcements"), "polite")
        total = gcell(page, "Orders", "ORD-1001", lt)
        commit(page, gcell(page, "Orders", "ORD-1001", qi), "4.16")
        wait(page, lambda: attr(total, "data-roll") in ("waiting", "rolling"), "roll started", step=0)
        page.emulate_media(reduced_motion="reduce")
        wait(page, lambda: attr(total, "data-roll") == "settled" and txt(total) == "52.0000", "roll jumps to end", step=0)
        advance(page, ANNOUNCE_FILL_MS * 2)
        commit(page, gcell(page, "Orders", "ORD-1003", qi), "5")
        other = gcell(page, "Orders", "ORD-1003", lt)
        wait(page, lambda: attr(other, "data-recalc-depth") == "1", "applied", step=0)
        assert attr(other, "data-roll") == "settled" and attr(main(page), "data-settled") == "true"
        assert animations(other) == []
        assert link(page, "Products, 4 rows, 2 changed").count() == 1
        advance(page, ANNOUNCE_FILL_MS * 2)
        assert fills(page, "polite", "Recalculated 5 cells in 3 tables.") == 2
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        wait(page, lambda: records(page).is_visible(), "cards")
        button(page, "Add column").click()
        sheet = page.get_by_role("dialog", name="Add column", exact=True)
        wait(page, lambda: sheet.is_visible(), "sheet", step=0)
        assert attr(sheet, "data-entering") != "true"
        page.keyboard.press("Escape")
        target = card(page, "ORD-1005")
        button(target, "Delete row").click()
        assert target.count() == 0 or attr(target, "data-leaving") != "true"
        wait(page, lambda: target.count() == 0, "card removed", step=0)
    assert L.row_of(L.mara, "Orders", "ORD-1005") is None


def test_live_announcements(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya, dev = L.api(PRIYA), L.api(DEV)
    qi, oi = L.idx(priya, "Orders", "Qty"), L.idx(priya, "Orders", "Order No")
    with workspace(browser, priya, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1005")
        record(status(page, "Recalculation announcements"), "polite")
        record(alerts(page), "alerts")
        for value, n in (("4.16", 1), ("4.17", 2)):
            commit(page, gcell(page, "Orders", "ORD-1001", qi), value)
            wait(page, lambda n=n: fills(page, "polite", "Recalculated 5 cells in 3 tables.") == n, "sentence announced")
        gate = Gate(page, CELL_RE)
        commit(page, gcell(page, "Orders", "ORD-1003", qi), "5")
        wait(page, lambda: gate.held, "first held", step=0)
        first_url = gate.seen[0]["url"]
        with page.expect_response(lambda r: r.request.method == "PUT" and CELL_RE.search(r.url) is not None and r.url != first_url):
            commit(page, gcell(page, "Orders", "ORD-1004", oi), "ORD-3004")
        wait(page, lambda: len(gate.seen) == 2, "second sent at once", step=0)
        gate.release()
        wait(page, lambda: fills(page, "polite", "Recalculated 0 cells in 0 tables.") == 1, "newest announced")
        advance(page, TALLY_MAX_MS * 2)
        assert fills(page, "polite", "Recalculated 5 cells in 3 tables.") == 2
        L.put(dev, "Orders", "ORD-1001", "Qty", "9")
        commit(page, gcell(page, "Orders", "ORD-1001", qi), "8")
        wait(page, lambda: fills(page, "alerts", cell_conflict("9.0000")) == 1, "conflict alert")


def test_wf_order_entry_optimistic(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    qi = L.idx(priya, "Orders", "Qty")
    with workspace(browser, priya, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1005")
        first, second = gcell(page, "Orders", "ORD-1001", qi), gcell(page, "Orders", "ORD-1005", qi)
        gate = Gate(page, CELL_RE)
        commit(page, first, "5")
        wait(page, lambda: gate.held, "held", step=0)
        assert attr(first, "aria-busy") == "true" and "5" in txt(first) and attr(main(page), "data-settled") == "false"
        assert page.get_by_text(SAVING, exact=True).count() >= 1
        commit(page, second, "10")
        wait(page, lambda: len(gate.seen) == 2, "second sent at once", step=0)
        gate.release()
        wait(page, lambda: txt(first) == "5.0000" and txt(second) == "10.0000" and attr(second, "aria-busy") != "true", "both applied")
        wait(page, lambda: attr(main(page), "data-settled") == "true", "settled")
        rev, before = attr(main(page), "data-doc-revision"), markers(grid(page, "Orders"))
        drop = Gate(page, CELL_RE, mode="abort", count=2)
        target = gcell(page, "Orders", "ORD-1002", qi)
        commit(page, target, "4")
        wait(page, lambda: txt(alerts(page)) == CONNECTION, "connection copy", step=1)
        assert txt(target) == "2.0000" and attr(target, "aria-busy") != "true" and markers(grid(page, "Orders")) == before
        assert len(drop.seen) == 2 and drop.seen[0]["key"] == drop.seen[1]["key"] and drop.seen[0]["body"] == drop.seen[1]["body"]
        wait(page, lambda: attr(main(page), "data-settled") == "true", "settled after failure", step=1)
        assert attr(main(page), "data-doc-revision") == rev
        fail = Gate(page, CELL_RE, mode="fail")
        commit(page, target, "4")
        wait(page, lambda: txt(target) == "2.0000" and attr(target, "aria-busy") != "true", "5xx reverted", step=1)
        advance(page, RESEND_MS + ROLL_STEP_MS)
        assert len(fail.seen) == 1
        rows_drop = Gate(page, ROWS_RE, method="POST", mode="abort", count=2)
        button(page, "Add row").click()
        wait(page, lambda: len(rows_drop.seen) == 2 and txt(alerts(page)) == CONNECTION, "add row failed", step=1)
        assert attr(grid(page, "Orders"), "aria-rowcount") == "6" and link(page, rail_name("Orders", 5)).count() == 1
        commit(page, target, "4")
        wait(page, lambda: txt(target) == "4.0000", "retry saves", step=1)
    assert L.disp(L.mara, "Orders", "ORD-1002", "Qty") == "4.0000" and len(L.rows(L.mara, "Orders")) == 5


def test_wf_order_entry_journey(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    cols = [c["name"] for c in L.columns(priya, "Orders")]
    with workspace(browser, priya, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1005")
        button(page, "Add row").focus()
        page.keyboard.press("Enter")
        new = at(page, "Orders", 5, 0)
        wait(page, lambda: focused(new), "new row active")
        page.keyboard.type("ORD-1006")
        page.keyboard.press("Tab")
        page.keyboard.type("Moss")
        page.keyboard.press("Enter")
        wait(page, lambda: txt(at(page, "Orders", 5, cols.index("Customer"))) == "Moss Street Bakery", "customer picked")
        page.keyboard.press("ArrowRight")
        page.keyboard.type("Birch")
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowRight")
        page.keyboard.type("2")
        page.keyboard.press("Enter")
        qty = at(page, "Orders", 5, cols.index("Qty"))
        wait(page, lambda: txt(qty) == "2.0000" and focused(qty), "qty saved, stays on last row")
        history = len(L.history())
        lose = Gate(page, CELL_RE, mode="lose")
        lost = gcell(page, "Orders", "ORD-1001", cols.index("Qty"))
        commit(page, lost, "5")
        wait(page, lambda: txt(lost) == "5.0000" and attr(lost, "aria-busy") != "true", "replayed", step=1)
        assert len(lose.seen) == 2 and lose.seen[0]["key"] == lose.seen[1]["key"]
        assert len(L.history()) == history + 1
        Gate(page, CELL_RE, mode="abort", count=2)
        drop = gcell(page, "Orders", "ORD-1003", cols.index("Qty"))
        commit(page, drop, "7")
        wait(page, lambda: txt(drop) == "10.0000" and txt(alerts(page)) == CONNECTION, "dropped", step=1)
        commit(page, drop, "7")
        wait(page, lambda: txt(drop) == "7.0000", "retyped", step=1)
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        wait(page, lambda: records(page).is_visible(), "cards")
        slow = Gate(page, CELL_RE)
        for key, value in (("ORD-1002", "3"), ("ORD-1004", "8")):
            c = card(page, key)
            button(c, edit_button("Qty")).click()
            c.get_by_role("textbox", name="Qty", exact=True).fill(value)
            button(c, "Save").click()
            if key == "ORD-1002":
                wait(page, lambda: slow.held, "slow save held", step=0)
        wait(page, lambda: len(slow.seen) == 2, "second save sent at once", step=0)
        slow.release()
        wait(page, lambda: "8.0000" in txt(card(page, "ORD-1004")), "card settled")
    assert [L.disp(L.mara, "Orders", k, "Qty") for k in ("ORD-1001", "ORD-1002", "ORD-1003", "ORD-1004")] == ["5.0000", "3.0000", "7.0000", "8.0000"]
    assert L.disp(L.mara, "Orders", "ORD-1006", "Product") == "Birch Ply Sheet"


def test_wf_order_entry_range(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    qi, oi = L.idx(priya, "Orders", "Qty"), L.idx(priya, "Orders", "Owner")
    keys = ("ORD-1001", "ORD-1002", "ORD-1003")
    with workspace(browser, priya, L.path("Orders")) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        ready(page, "Orders", "ORD-1005")
        g = grid(page, "Orders")
        record(status(page, "Workspace status"), "ws")
        anchor = gcell(page, "Orders", "ORD-1001", qi)
        anchor.click()
        page.keyboard.press("Shift+ArrowDown")
        page.keyboard.press("Shift+ArrowDown")
        wait(page, lambda: selected(g) == 3 and focused(anchor), "range of three")
        page.keyboard.press("Control+c")
        wait(page, lambda: page.evaluate("navigator.clipboard.readText()") == "4.0000\r\n2.0000\r\n10.0000", "clipboard")
        wait(page, lambda: fills(page, "ws", "Copied 3 cells.") == 1, "copy announced")
        page.keyboard.press("ArrowDown")
        wait(page, lambda: selected(g) == 1, "collapsed")
        anchor.click()
        gcell(page, "Orders", "ORD-1002", oi).click(modifiers=["Shift"])
        wait(page, lambda: selected(g) == 4, "shift-click range")
        page.keyboard.press("Control+c")
        wait(page, lambda: page.evaluate("navigator.clipboard.readText()") == f"4.0000\t{DEV}\r\n2.0000\t{PRIYA}", "block clipboard")
        anchor.click()
        page.keyboard.press("Shift+ArrowDown")
        page.keyboard.press("Shift+ArrowDown")
        sent = writes(page)
        page.keyboard.press("Delete")
        poll(lambda: [L.disp(priya, "Orders", k, "Qty") for k in keys] == ["", "", ""], WAIT_S, "cleared")
        assert len([u for m, u in sent if PASTE_RE.search(u)]) == 1 and selected(g) == 3
        assert L.history()[-1]["kind"] == "cell_batch"
        page.keyboard.press("Control+z")
        poll(lambda: [L.disp(priya, "Orders", k, "Qty") for k in keys] == ["4.0000", "2.0000", "10.0000"], WAIT_S, "undo restores three")
        anchor.click()
        page.keyboard.press("Shift+ArrowDown")
        page.keyboard.press("Shift+ArrowDown")
        paste(page, "7")
        poll(lambda: [L.disp(priya, "Orders", k, "Qty") for k in keys] == ["7.0000"] * 3, WAIT_S, "one-cell fill")


def test_grid_keyboard(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    cols = [c["name"] for c in L.columns(L.mara, "Orders")]
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1005")
        g = grid(page, "Orders")
        c = lambda key, col: gcell(page, "Orders", key, cols.index(col))
        formula = page.get_by_role("textbox", name="Formula", exact=True)
        formula.focus()
        page.keyboard.press("Tab")
        wait(page, lambda: focused(c("ORD-1001", "Order No")), "top-left active")
        assert (attr(g, "aria-rowcount"), attr(g, "aria-colcount"), attr(g, "aria-multiselectable")) == ("6", "7", "true")
        assert [attr(g.get_by_role("row").nth(i), "aria-rowindex") for i in range(6)] == ["1", "2", "3", "4", "5", "6"]
        single = lambda: g.evaluate("g => [g.querySelectorAll('[tabindex=\"0\"]').length, g.querySelectorAll('[role=gridcell][aria-selected=\"true\"]').length]") == [1, 1]
        for key, target in (("ArrowRight", ("ORD-1001", "Customer")), ("ArrowDown", ("ORD-1002", "Customer")), ("End", ("ORD-1002", "Region")),
                            ("Home", ("ORD-1002", "Order No")), ("ArrowLeft", ("ORD-1002", "Order No")), ("Control+End", ("ORD-1005", "Region")),
                            ("ArrowRight", ("ORD-1005", "Region")), ("ArrowDown", ("ORD-1005", "Region")), ("Control+Home", ("ORD-1001", "Order No"))):
            page.keyboard.press(key)
            wait(page, lambda t=target: focused(c(*t)) and single(), f"{key} moves")
        page.keyboard.press("ArrowUp")
        header = button(page, "Order No options")
        wait(page, lambda: focused(header) and attr(header, "tabindex") == "0", "header button")
        page.keyboard.press("ArrowRight")
        wait(page, lambda: focused(button(page, "Customer options")), "next header")
        page.keyboard.press("ArrowDown")
        wait(page, lambda: focused(c("ORD-1001", "Customer")), "back to data")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Enter")
        wait(page, lambda: page.evaluate("() => { const e = document.activeElement; return e.value === 'ORD-1001' && e.selectionStart === 8; }"), "editor opens")
        page.keyboard.press("Escape")
        wait(page, lambda: focused(c("ORD-1001", "Order No")) and txt(c("ORD-1001", "Order No")) == "ORD-1001", "cancel")
        page.keyboard.type("Z")
        wait(page, lambda: page.evaluate("document.activeElement.value") == "Z", "typing replaces")
        page.keyboard.press("Escape")
        sent = writes(page)
        page.keyboard.press("End")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Enter")
        wait(page, lambda: focused(formula) and formula.input_value() == f"={LINE_TOTAL}", "formula bar")
        page.keyboard.press("Escape")
        wait(page, lambda: focused(c("ORD-1001", "Line Total")), "back to cell")
        page.keyboard.press("Delete")
        page.keyboard.type("x")
        advance(page, ROLL_STEP_MS)
        assert sent == [] and focused(c("ORD-1001", "Line Total"))
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Delete")
        poll(lambda: L.disp(L.mara, "Orders", "ORD-1001", "Qty") == "", WAIT_S, "cleared to blank")
        page.keyboard.press("Control+z")
        poll(lambda: L.disp(L.mara, "Orders", "ORD-1001", "Qty") == "4.0000", WAIT_S, "undo shortcut")
        page.keyboard.press("Shift+Tab")
        wait(page, lambda: focused(formula), "shift+tab to formula bar")
        page.keyboard.press("Tab")
        page.keyboard.press("Tab")
        wait(page, lambda: not g.evaluate("g => g.contains(document.activeElement)"), "tab leaves grid")


def test_editing_keys_at_edges(browser: Browser, app_url: str) -> None:
    api = Api(app_url, MARA)
    m = Mini(api, [("A", "text", {}), ("B", "text", {}), ("C", "decimal", {})])
    r0, r1 = m.row({"A": "a1", "B": "b1"}), m.row({"A": "a2", "B": "b2"})
    with workspace(browser, api, m.path()) as page:
        wait(page, lambda: grid(page, "Items").is_visible() and txt(at(page, "Items", 1, 0)) == "a2", "grid")
        cell = lambda r, i: at(page, "Items", r, i)
        sent = writes(page)
        cell(1, 0).click()
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        wait(page, lambda: focused(cell(1, 0)), "unchanged enter stays")
        advance(page, ROLL_STEP_MS)
        assert sent == []
        page.keyboard.press("Enter")
        page.keyboard.type("x")
        page.keyboard.press("Enter")
        wait(page, lambda: focused(cell(1, 0)) and m.cell(r1["id"], "A")["display"] == "a2x", "last row stays")
        steps = [((0, 2), "5", "Tab", (1, 0)), ((1, 2), "4", "Tab", (1, 2)), ((1, 0), None, "Shift+Tab", (0, 2)),
                 ((0, 0), None, "Shift+Tab", (0, 0)), ((0, 0), None, "Tab", (0, 1))]
        for start, value, key, target in steps:
            cell(*start).click()
            if value:
                page.keyboard.type(value)
            else:
                page.keyboard.press("Enter")
            page.keyboard.press(key)
            wait(page, lambda t=target: focused(cell(*t)), f"{key} from {start}")
        poll(lambda: m.cell(r0["id"], "C")["display"] == "5.0000" and m.cell(r1["id"], "C")["display"] == "4.0000", WAIT_S, "both commits saved")
        page.keyboard.type("Q")
        page.keyboard.press("Escape")
        wait(page, lambda: focused(cell(0, 1)) and txt(cell(0, 1)) == "b1", "escape cancels")
        page.keyboard.type("bb")
        cell(1, 1).click()
        wait(page, lambda: focused(cell(1, 1)) and m.cell(r0["id"], "B")["display"] == "bb", "click commits and moves")
        cell(1, 2).click()
        page.keyboard.type("abc")
        page.keyboard.press("Enter")
        wait(page, lambda: txt(alerts(page)) == DECIMAL_MSG, "field message")
        wait(page, lambda: cell(1, 2).evaluate("e => e.contains(document.activeElement)") and page.evaluate("document.activeElement.value") == "abc", "editor reopens")


def test_wf_personal_undo_shortcuts(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    qi = L.idx(priya, "Orders", "Qty")
    with workspace(browser, priya, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        cell = gcell(page, "Orders", "ORD-1001", qi)
        commit(page, cell, "5")
        wait(page, lambda: txt(cell) == "5.0000", "saved")
        button(page, "Add row").focus()
        page.keyboard.press("Control+z")
        poll(lambda: L.disp(priya, "Orders", "ORD-1001", "Qty") == "4.0000", WAIT_S, "undo from toolbar")
        page.get_by_role("link", name=re.compile(r"^Products, 4 rows")).focus()
        page.keyboard.press("Control+Shift+z")
        poll(lambda: L.disp(priya, "Orders", "ORD-1001", "Qty") == "5.0000", WAIT_S, "redo from rail")
        cell.click()
        page.keyboard.press("Enter")
        sent = writes(page)
        page.keyboard.press("Control+z")
        advance(page, ROLL_STEP_MS)
        assert sent == []
        page.keyboard.press("Escape")
        undo = button(page, "Undo")
        undo.click()
        wait(page, lambda: undo.is_disabled() and focused(cell), "focus moves to the active cell")
    assert L.disp(priya, "Orders", "ORD-1001", "Qty") == "4.0000"


def test_wf_personal_undo_double_press(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    with workspace(browser, priya, L.path("Products")) as page:
        ready(page, "Products", "Oak Shelf Bracket")
        gcell(page, "Products", "Oak Shelf Bracket", 0).click()
        button(page, "Delete row").click()
        wait(page, lambda: data_row(page, "Products", "Oak Shelf Bracket").count() == 0 and status(page, "Deleted row").count() == 1, "deleted")
        poll(lambda: L.row_of(priya, "Products", "Oak Shelf Bracket") is None, WAIT_S, "server delete")
        gate = Gate(page, UNDO_RE, method="POST")
        undo = button(page, "Undo")
        undo.click()
        wait(page, lambda: gate.held, "first undo held", step=0)
        wait(page, lambda: status(page, "Deleted row").count() == 0 or txt(status(page, "Deleted row")) == "", "status closed after its fade")
        undo.click()
        wait(page, lambda: len(gate.seen) == 2, "second sent", step=0)
        gate.release()
        wait(page, lambda: txt(alerts(page)) == NOTHING_UNDO and data_row(page, "Products", "Oak Shelf Bracket").count() == 1, "settled")
        advance(page, TALLY_MAX_MS * 2)
        assert undo.is_disabled() and button(page, "Redo").is_enabled() and txt(alerts(page)) == NOTHING_UNDO
        assert "Recalculated 8 cells in 3 tables." in visible_text(page)
        ui, sl = L.idx(priya, "Products", "Units Ordered"), L.idx(priya, "Products", "Stock Left")
        assert attr(gcell(page, "Products", "Oak Shelf Bracket", ui), "data-recalc-depth") == "2"
        assert attr(gcell(page, "Products", "Oak Shelf Bracket", sl), "data-recalc-depth") == "3"
        assert link(page, rail_name("Orders", 5, 4)).count() == 1
    assert L.row_of(priya, "Products", "Oak Shelf Bracket")["id"] == L.r["Products"]["Oak Shelf Bracket"]


def test_wf_owner_setup_column_menu(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    for i in range(10):
        L.add_column("Orders", f"Wide note column number {i:02d}", "text")
    qi = L.idx(L.mara, "Orders", "Qty")
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        menu = page.get_by_role("menu", name=column_menu("Qty"), exact=True)
        header = button(page, opts("Qty"))
        gcell(page, "Orders", "ORD-1001", qi).click()
        page.keyboard.press("ArrowUp")
        wait(page, lambda: focused(header), "header")
        page.keyboard.press("Enter")
        first = menu.get_by_role("menuitemradio", name="Text", exact=True)
        wait(page, lambda: focused(first), "first item focused")
        page.keyboard.press("ArrowUp")
        wait(page, lambda: focused(menu.get_by_role("menuitem", name="Delete column", exact=True)), "wraps up")
        page.keyboard.press("Home")
        wait(page, lambda: focused(first), "home")
        page.keyboard.press("End")
        page.keyboard.press("ArrowDown")
        wait(page, lambda: focused(first), "wraps down")
        page.keyboard.press("Escape")
        wait(page, lambda: menu.count() == 0 and focused(header) and attr(header, "tabindex") == "0", "escape returns")
        page.keyboard.press("Alt+ArrowDown")
        wait(page, lambda: menu.is_visible(), "alt down opens")
        page.keyboard.press("Escape")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Shift+F10")
        wait(page, lambda: menu.is_visible(), "shift+f10 opens")
        assert menu.get_by_role("menuitemcheckbox", name="Use as row owner").count() == 0
        page.keyboard.press("Escape")
        wide = f"Wide note column number {9:02d}"
        last = button(page, opts(wide))
        last.click()
        far = page.get_by_role("menu", name=column_menu(wide), exact=True)
        wait(page, lambda: far.is_visible(), "last menu")
        box = far.bounding_box()
        assert box["x"] >= 0 and box["x"] + box["width"] <= DESKTOP[0] and box["y"] >= 0 and box["y"] + box["height"] <= DESKTOP[1]
        item = far.get_by_role("menuitem", name="Delete column", exact=True)
        x, y = center(item)
        assert item.evaluate("(e, p) => e.contains(document.elementFromPoint(p[0], p[1]))", [x, y])
        assert far.get_by_role("menuitemcheckbox", name="Use as row owner").count() == 1
        page.keyboard.press("Escape")
    with workspace(browser, L.api(PRIYA), L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        button(page, opts("Qty")).click()
        menu = page.get_by_role("menu", name=column_menu("Qty"), exact=True)
        wait(page, lambda: menu.is_visible(), "editor menu")
        assert attr(menu.get_by_role("menuitemradio", name="Decimal", exact=True), "aria-disabled") == "true"
        assert menu.get_by_role("menuitem", name="Rename column").count() == 0 and menu.get_by_role("menuitem", name="Delete column").count() == 0


def create_document_ui(page: Page, name: str) -> None:
    button(page, "New document").click()
    dialog = page.get_by_role("dialog", name="New document", exact=True)
    dialog.get_by_role("textbox", name="Document name", exact=True).fill(name)
    button(dialog, "Create document").click()


def create_table_ui(page: Page, opener: str, name: str) -> None:
    button(page, opener).click()
    dialog = page.get_by_role("dialog", name="New table", exact=True)
    dialog.get_by_role("textbox", name="Table name", exact=True).fill(name)
    button(dialog, "Create table").click()


def add_column_ui(page: Page, name: str, kind: str = "Text", formula: str | None = None, preview: str | None = None) -> None:
    button(page, "Add column").click()
    dialog = page.get_by_role("dialog", name="Add column", exact=True)
    dialog.get_by_role("textbox", name="Column name", exact=True).fill(name)
    dialog.get_by_role("radio", name=kind, exact=True).check()
    if formula is not None:
        dialog.get_by_role("textbox", name="Formula", exact=True).press_sequentially(formula)
        if preview is not None:
            wait(page, lambda: txt(dialog.get_by_role("status", name="Formula preview")) == preview, "dialog preview")
    button(dialog, "Create column").click()
    wait(page, lambda: dialog.count() == 0, "column added")


def test_wf_owner_setup_landing(browser: Browser, app_url: str) -> None:
    api = Api(app_url, MARA)
    token, _ = fresh("land")
    name = f"Landing {token}"
    with workspace(browser, api, "/") as page:
        wait(page, lambda: button(page, "New document").is_visible(), "documents")
        gate = Gate(page, DOCS_RE, method="POST")
        create_document_ui(page, name)
        wait(page, lambda: gate.held, "create held", step=0)
        create = button(page.get_by_role("dialog", name="New document"), "Create document")
        assert path_of(page) == "/" and create.is_disabled() and attr(create, "aria-busy") == "true"
        gate.release()
        doc = poll(lambda: next((d["id"] for d in api.ok("GET", "/api/documents")["documents"] if d["name"] == name), None), WAIT_S, "doc")
        wait(page, lambda: path_of(page) == f"/d/{doc}" and focused(button(page, "Create first table")), "landed")
        ws = status(page, "Workspace status")
        record(ws, "ws")
        assert page.get_by_text(EMPTY_DOC, exact=True).count() >= 1
        create_table_ui(page, "Create first table", "Items")
        tid = poll(lambda: next((t["id"] for t in api.ok("GET", f"/api/documents/{doc}")["tables"]), None), WAIT_S, "table")
        wait(page, lambda: path_of(page) == f"/d/{doc}/t/{tid}" and focused(button(page, "Add row")), "table landed")
        wait(page, lambda: fills(page, "ws", "Created table Items.") == 1, "table announced")
        assert page.get_by_role("heading", level=2, name="Items", exact=True).count() == 1
        advance(page, TALLY_MAX_MS)
        assert fills(page, "ws", f"Created document {name}.") <= 1 and fills(page, "ws", created_table_copy("Items")) == 1
        page.go_back()
        wait(page, lambda: path_of(page) == f"/d/{doc}" and page.get_by_role("dialog").count() == 0, "back")
        page.go_forward()
        wait(page, lambda: path_of(page) == f"/d/{doc}/t/{tid}", "forward")
        page.reload()
        wait(page, lambda: page.get_by_role("heading", level=2, name="Items", exact=True).count() == 1, "reload")


def test_wf_owner_setup_journey(browser: Browser, app_url: str) -> None:
    api = Api(app_url, MARA)
    token, _ = fresh("ledger")
    name = f"Owner {token}"
    with workspace(browser, api, "/") as page:
        wait(page, lambda: button(page, "New document").is_visible(), "documents")
        create_document_ui(page, name)
        wait(page, lambda: button(page, "Create first table").is_visible(), "empty document")
        doc = next(d["id"] for d in api.ok("GET", "/api/documents")["documents"] if d["name"] == name)
        d = f"/api/documents/{doc}"
        create_table_ui(page, "Create first table", "Items")
        wait(page, lambda: focused(button(page, "Add row")), "items table")
        add_column_ui(page, "Name")
        wait(page, lambda: focused(button(page, "Name options")), "name column")
        add_column_ui(page, "Cost", "Decimal")
        for label in ("Bolt", "Nut"):
            button(page, "Add row").focus()
            page.keyboard.press("Enter")
            wait(page, lambda: page.evaluate("document.activeElement.getAttribute('role')") == "gridcell", "new row active")
            page.keyboard.type(label)
            page.keyboard.press("Tab")
            page.keyboard.type("2")
            page.keyboard.press("Enter")
            wait(page, lambda l=label: data_row(page, "Items", l).count() == 1, "row saved")
        add_column_ui(page, DOUBLE, "Formula", JOURNEY_FORMULA.format("Cost"), result_copy("4.0000"))
        button(page, "New summary").click()
        dialog = page.get_by_role("dialog", name="New summary", exact=True)
        tick(dialog.get_by_role("checkbox", name="Cost", exact=True))
        button(dialog, "Create summary").click()
        tables = lambda: {t["name"]: t for t in api.ok("GET", d)["tables"]}
        summary = poll(lambda: tables().get(summary_name("Items", ["Name"])), WAIT_S, "summary")
        wait(page, lambda: path_of(page) == f"/d/{doc}/t/{summary['id']}" and grid(page, "Items by Name").evaluate("g => g.contains(document.activeElement)"), "summary landed")
        link(page, "Items, 2 rows").click()
        ready(page, "Items", "Bolt")
        gcell(page, "Items", "Bolt", 1).click()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        page.keyboard.press("Escape")
        wait(page, lambda: focused(button(page, "Cost options")), "menu escape")
        page.keyboard.press("Enter")
        rename_item = page.get_by_role("menuitem", name="Rename column", exact=True)
        for _ in range(12):
            if focused(rename_item):
                break
            page.keyboard.press("ArrowDown")
        assert focused(rename_item)
        page.keyboard.press("Enter")
        rename = page.get_by_role("dialog", name="Rename column", exact=True)
        rename.get_by_role("textbox", name="Column name", exact=True).fill("Unit Cost")
        button(rename, "Save name").click()
        wait(page, lambda: focused(button(page, "Unit Cost options")), "renamed column")
        items = lambda: api.ok("GET", f"{d}/tables/{tables()['Items']['id'] if 'Items' in tables() else tables()['Stock_Items']['id']}")["table"]
        assert next(c for c in items()["columns"] if c["name"] == DOUBLE)["formula"] == JOURNEY_FORMULA.format("Unit Cost")
        assert "Sum of " + "Unit Cost" in [c["name"] for c in api.ok("GET", f"{d}/tables/{summary['id']}")["table"]["columns"]]
        button(page, "Rename table").click()
        rt = page.get_by_role("dialog", name="Rename table", exact=True)
        rt.get_by_role("textbox", name="Table name", exact=True).fill("Stock_Items")
        button(rt, "Save name").click()
        wait(page, lambda: focused(button(page, "Rename table")) and page.get_by_role("heading", level=2, name="Stock_Items").count() == 1, "renamed table")
        assert summary_name("Stock_Items", ["Name"]) in tables()
        button(page, "Undo").click()
        wait(page, lambda: "Items" in tables(), "first undo")
        button(page, "Undo").click()
        poll(lambda: next(c for c in items()["columns"] if c["name"] == DOUBLE)["formula"] == JOURNEY_FORMULA.format("Cost"), WAIT_S, "second undo")
        assert set(tables()) == {"Items", summary_name("Items", ["Name"])}
        wait(page, lambda: link(page, "Items, 2 rows").count() == 1 and link(page, "Items by Name, 2 rows").count() == 1, "rail counts")
        groups = api.ok("GET", f"{d}/tables/{summary['id']}")["table"]
        cols = {c["name"]: c["id"] for c in groups["columns"]}
        assert [(r["cells"][cols["Count"]]["display"], r["cells"][cols["Sum of Cost"]]["display"]) for r in groups["rows"]] == [("1.0000", "2.0000")] * 2
        api.ok("POST", f"{d}/tables", {"name": OTHER})
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.goto(f"{app_url}/d/{doc}/t/{tables()['Items']['id']}")
        wait(page, lambda: records(page).is_visible(), "cards")
        record(status(page, "Workspace status"), "ws")
        button(page, "Add column").click()
        sheet = page.get_by_role("dialog", name="Add column", exact=True)
        wait(page, lambda: sheet.is_visible(), "sheet")
        wait(page, lambda: (lambda b: b is not None and (round(b["x"]), round(b["y"]), round(b["width"]), round(b["height"])) == (0, 0, PHONE[0], PHONE[1]))(sheet.bounding_box()), "sheet settled full screen")
        sheet.get_by_role("textbox", name="Column name", exact=True).fill("N" * LONG_NAME)
        layout(page)
        sheet.get_by_role("textbox", name="Column name", exact=True).fill("Notes")
        button(sheet, "Create column").click()
        wait(page, lambda: fills(page, "ws", "Added column Notes.") == 1, "first Notes")
        button(page, "Switch table").click()
        page.get_by_role("dialog", name="Tables", exact=True).get_by_role("link", name=rail_name(OTHER, 0), exact=True).click()
        wait(page, lambda: page.get_by_role("heading", level=2, name=OTHER).count() == 1, "other table")
        add_column_ui(page, "Notes")
        wait(page, lambda: fills(page, "ws", "Added column Notes.") == 2, "second Notes announced")
        page.emulate_media(reduced_motion="reduce")
        button(page, "Add column").click()
        sheet = page.get_by_role("dialog", name="Add column", exact=True)
        wait(page, lambda: sheet.is_visible(), "reduced sheet", step=0)
        assert attr(sheet, "data-entering") != "true"


def test_wf_cross_cutting_layouts(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    for i in range(12):
        L.add_column("Orders", f"Wide note column number {i:02d}", "text")
    for i in range(30):
        L.add_row("Orders", {"Order No": f"ORD-X{i:02d}"})
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        g = grid(page, "Orders")
        nav = page.get_by_role("navigation", name="Tables", exact=True)
        formula = page.get_by_role("textbox", name="Formula", exact=True)
        assert nav.is_visible() and formula.is_visible() and button(page, "Tables").count() == 0
        area = g.evaluate(GRID_AREA_JS)
        assert formula.bounding_box()["y"] < area["y"] and nav.bounding_box()["x"] < area["x"]
        layout(page)
        header, first = button(page, "Order No options"), gcell(page, "Orders", "ORD-1003", 0)
        hy, fx, qx = header.bounding_box()["y"], first.bounding_box()["x"], button(page, "Qty options").bounding_box()["x"]
        g.evaluate("""g => { const all = [g, ...g.querySelectorAll('*')]; for (let e = g.parentElement; e && e !== document.body; e = e.parentElement) all.push(e);
            const scrolls = all.filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowX + s.overflowY) && (e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight); });
            scrolls.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
            if (scrolls[0]) { scrolls[0].scrollTop = 300; scrolls[0].scrollLeft = 400; } }""")
        advance(page, ROLL_STEP_MS)
        assert abs(header.bounding_box()["y"] - hy) <= DRIFT_MS and abs(first.bounding_box()["x"] - fx) <= DRIFT_MS
        assert button(page, opts("Qty")).bounding_box()["x"] != qx
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_wf_cross_cutting_layout_768(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    for i in range(12):
        L.add_column("Orders", f"Wide note column number {i:02d}", "text")
    with workspace(browser, L.mara, L.path("Orders"), size=TABLET) as page:
        ready(page, "Orders", "ORD-1001")
        tables = button(page, "Tables")
        assert attr(tables, "aria-expanded") == "false" and page.get_by_role("navigation", name="Tables").count() == 0
        assert page.get_by_role("textbox", name="Formula", exact=True).count() == 0
        width = grid(page, "Orders").evaluate(GRID_AREA_JS)["width"]
        tables.click()
        wait(page, lambda: attr(tables, "aria-expanded") == "true" and page.get_by_role("navigation", name="Tables").is_visible(), "rail open")
        assert grid(page, "Orders").evaluate(GRID_AREA_JS)["width"] < width
        layout(page)


def test_wf_cross_cutting_dialogs(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        for opener, name, first, back in (("New table", "New table", "Table name", "New table"), ("Share", "Share document", "Email", "Share"),
                                          ("Rename table", "Rename table", "Table name", "Rename table")):
            button(page, opener).click()
            dialog = page.get_by_role("dialog", name=name, exact=True)
            field = dialog.get_by_role("textbox", name=first, exact=True)
            wait(page, lambda: focused(field), f"{name} first field")
            inside = lambda: dialog.evaluate("d => d.contains(document.activeElement)")
            for _ in range(8):
                page.keyboard.press("Tab")
                assert inside()
            for _ in range(8):
                page.keyboard.press("Shift+Tab")
                assert inside()
            page.keyboard.press("Escape")
            wait(page, lambda: dialog.count() == 0 and focused(button(page, back)), f"{name} closes")
        button(page, "Qty options").click()
        page.get_by_role("menuitem", name="Rename column", exact=True).click()
        dialog = page.get_by_role("dialog", name="Rename column", exact=True)
        wait(page, lambda: focused(dialog.get_by_role("textbox", name="Column name")), "rename field")
        page.keyboard.press("Escape")
        wait(page, lambda: focused(button(page, "Qty options")), "focus back on header button")


def test_published_copy(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    api = L.mara
    empty = Mini(api, [("A", "text", {})])
    with workspace(browser, api, empty.path()) as page:
        wait(page, lambda: page.get_by_text(EMPTY_TABLE, exact=True).count() >= 1, "empty table copy")
    doc = api.ok("POST", "/api/documents", {"name": f"Empty {fresh('e')[0]}"})["document"]["id"]
    with workspace(browser, api, f"/d/{doc}") as page:
        wait(page, lambda: page.get_by_text(EMPTY_DOC, exact=True).count() >= 1, "empty doc copy")
    with workspace(browser, api, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1005")
        gcell(page, "Orders", "ORD-1005", L.idx(api, "Orders", "Qty")).click()
        paste(page, "1\r\n2")
        wait(page, lambda: txt(alerts(page)) == NO_FIT, "no-fit copy")
        page.keyboard.press("Control+Shift+z")
        wait(page, lambda: txt(alerts(page)) == NOTHING_REDO, "nothing to redo")
        button(page, "Rename table").click()
        dialog = page.get_by_role("dialog", name="Rename table", exact=True)
        api.ok("PATCH", L.tp("Orders"), {"name": "Sales", "revision": 1})
        dialog.get_by_role("textbox", name="Table name", exact=True).fill("Deals")
        button(dialog, "Save name").click()
        wait(page, lambda: TABLE_CONFLICT in txt(dialog) and txt(alerts(page)) == TABLE_CONFLICT, "table conflict copy")
        assert dialog.get_by_role("textbox", name="Table name").input_value() == "Sales"


def test_wf_formula_authoring_live_preview(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    lt = L.idx(L.mara, "Orders", "Line Total")
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        bar = page.get_by_role("textbox", name="Formula", exact=True)
        preview = page.get_by_role("status", name="Formula preview", exact=True)
        record(page.get_by_role("status", name="Formula announcements", exact=True), "fa")
        reloads: list[str] = []
        page.on("request", lambda r: reloads.append(r.url) if r.method == "GET" and "/tables/" in r.url else None)
        gcell(page, "Orders", "ORD-1001", lt).click()
        page.keyboard.press("Enter")
        wait(page, lambda: focused(bar), "bar focused")
        page.keyboard.press("Control+a")
        page.keyboard.type("=")
        wait(page, lambda: txt(preview) == ENDED_EARLY, "ended early", step=1)
        slow = Gate(page, PREVIEW_RE, method="POST")
        page.keyboard.type("4")
        wait(page, lambda: slow.held, "reply for =4 held", step=0)
        page.keyboard.type("*")
        wait(page, lambda: len(slow.seen) == 2 and txt(preview) == ENDED_EARLY, "newer reply shown", step=1)
        slow.release()
        advance(page, 1)
        assert txt(preview) == ENDED_EARLY
        result = result_copy("4.0000")
        before = fills(page, "fa", result)
        page.keyboard.press("Backspace")
        t0 = page.evaluate("performance.now()")
        wait(page, lambda: txt(preview) == result, "newest reply", step=1)
        assert focused(bar) and reloads == []
        waited = page.evaluate("performance.now()") - t0
        if waited < PREVIEW_PAUSE_MS // 2:
            advance(page, PREVIEW_PAUSE_MS // 2 - waited)
            assert fills(page, "fa", result) == before
        advance(page, PREVIEW_PAUSE_MS + ANNOUNCE_FILL_MS + 2)
        assert fills(page, "fa", result) == before + 1
        advance(page, PREVIEW_PAUSE_MS * 2)
        assert fills(page, "fa", result) == before + 1
        page.keyboard.press("Escape")
    with workspace(browser, L.mara, L.path("Orders"), size=TABLET) as page:
        ready(page, "Orders", "ORD-1001")
        assert page.get_by_role("textbox", name="Formula").count() == 0
        gcell(page, "Orders", "ORD-1001", lt).click()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Edit formula", exact=True)
        box = dialog.get_by_role("textbox", name="Formula", exact=True)
        wait(page, lambda: box.input_value() == LINE_TOTAL, "dialog holds stored formula")
        box.fill("")
        box.press_sequentially("1/0")
        wait(page, lambda: txt(dialog.get_by_role("status", name="Formula preview")) == TOOLTIPS["#DIV/0!"], "error preview")
    assert L.col(L.mara, "Orders", "Line Total")["formula"] == LINE_TOTAL


def test_wf_formula_authoring_circular(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    sl = L.idx(L.mara, "Products", "Stock Left")
    with workspace(browser, L.mara, L.path("Products")) as page:
        ready(page, "Products", "Oak Shelf Bracket")
        record(status(page, "Recalculation announcements"), "polite")
        bar = page.get_by_role("textbox", name="Formula", exact=True)
        cell = gcell(page, "Products", "Oak Shelf Bracket", sl)
        cell.click()
        page.keyboard.press("Enter")
        bar.fill("=[Stock Left] + 1")
        page.keyboard.press("Enter")
        wait(page, lambda: txt(alerts(page)) == CIRCULAR and txt(cell) == "#CIRC!", "circular alert")
        wait(page, lambda: fills(page, "polite", "Recalculated 4 cells in 1 table.") == 1, "sentence announced politely")
        cell.click()
        wait(page, lambda: described(page, cell) == TOOLTIPS["#CIRC!"], "tooltip")
        page.keyboard.press("Enter")
        bar.fill(f"={STOCK_LEFT}")
        page.keyboard.press("Enter")
        wait(page, lambda: txt(cell) == "30.0000", "recovered")
    assert L.disp(L.mara, "Products", "Oak Shelf Bracket", "Stock Left") == "30.0000"


def test_wf_conflict_journey(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya, dev = L.api(PRIYA), L.api(DEV)
    si = L.idx(priya, "Products", "Stock")
    with workspace(browser, priya, L.path("Products")) as page:
        ready(page, "Products", "Oak Shelf Bracket")
        record(alerts(page), "alerts")
        stock = gcell(page, "Products", "Oak Shelf Bracket", si)
        L.put(dev, "Products", "Oak Shelf Bracket", "Stock", "41")
        commit(page, stock, "39")
        copy = cell_conflict("41.0000")
        wait(page, lambda: txt(stock) == "41.0000" and txt(alerts(page)) == copy and described(page, stock) == copy, "cell conflict")
        commit(page, stock, "39")
        wait(page, lambda: txt(stock) == "39.0000", "saved on top")
        link(page, "Orders, 5 rows").click()
        ready(page, "Orders", "ORD-1003")
        L.put(dev, "Orders", "ORD-1003", "Qty", "11")
        gcell(page, "Orders", "ORD-1003", 0).click()
        button(page, "Delete row").click()
        wait(page, lambda: txt(alerts(page)) == ROW_CONFLICT and data_row(page, "Orders", "ORD-1003").count() == 1, "row conflict")
        bar = page.get_by_role("textbox", name="Formula", exact=True)
        lt = gcell(page, "Orders", "ORD-1001", L.idx(priya, "Orders", "Line Total"))
        lt.click()
        page.keyboard.press("Enter")
        L.patch_col(dev, "Orders", "Line Total", formula="[Qty] * 2")
        bar.fill("=[Qty] * 3")
        page.keyboard.press("Enter")
        wait(page, lambda: fills(page, "alerts", COLUMN_CONFLICT) == 1 and bar.input_value() == "=[Qty] * 2", "formula conflict")
        bar.fill(f"={LINE_TOTAL}")
        page.keyboard.press("Enter")
        poll(lambda: L.col(L.mara, "Orders", "Line Total")["formula"] == LINE_TOTAL, WAIT_S, "formula saved on top")
        wait(page, lambda: attr(main(page), "data-settled") == "true", "settled")
        lt.click()
        page.keyboard.press("Enter")
        wait(page, lambda: focused(bar) and bar.input_value() == f"={LINE_TOTAL}", "bar holds the saved formula")
        L.patch_col(L.mara, "Products", "Price", name="Unit Price")
        bar.fill("=[Qty] * [Product].[Price] * 2")
        page.keyboard.press("Enter")
        wait(page, lambda: fills(page, "alerts", COLUMN_CONFLICT) == 2 and bar.input_value() == "=[Qty] * [Product].[Unit Price]", "rename race")
    assert L.col(L.mara, "Orders", "Line Total")["formula"] == "[Qty] * [Product].[Unit Price]"
    L.check_list(L.mara, L.put(L.mara, "Orders", "ORD-1002", "Qty", "2.5").json()["recalc"])
    L.check_totals(L.mara)
    kinds = [(e["kind"], e["actor_id"]) for e in L.history()[-7:]]
    assert kinds == [("cell_write", dev.user["id"]), ("cell_write", priya.user["id"]), ("cell_write", dev.user["id"]),
                     ("column_update", dev.user["id"]), ("column_update", priya.user["id"]), ("column_update", L.mara.user["id"]),
                     ("cell_write", L.mara.user["id"])]


def test_wf_conflict_formula_dialog(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya, dev = L.api(PRIYA), L.api(DEV)
    with workspace(browser, priya, L.path("Orders"), size=TABLET) as page:
        ready(page, "Orders", "ORD-1001")
        gcell(page, "Orders", "ORD-1001", L.idx(priya, "Orders", "Line Total")).click()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Edit formula", exact=True)
        box = dialog.get_by_role("textbox", name="Formula", exact=True)
        wait(page, lambda: box.input_value() == LINE_TOTAL, "dialog")
        L.patch_col(dev, "Orders", "Line Total", formula="[Qty] * 2")
        box.fill("[Qty] * 3")
        button(dialog, "Save formula").click()
        wait(page, lambda: box.input_value() == "[Qty] * 2" and COLUMN_CONFLICT in txt(dialog) and txt(alerts(page)) == COLUMN_CONFLICT, "refilled")
        box.fill("[Qty] * 3")
        button(dialog, "Save formula").click()
        wait(page, lambda: dialog.count() == 0, "saved on top")
    assert L.col(priya, "Orders", "Line Total")["formula"] == OTHER_FORMULA


def test_wf_delete_restore_picker(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    pi = L.idx(priya, "Orders", "Product")
    with workspace(browser, priya, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1002")
        cell = gcell(page, "Orders", "ORD-1002", pi)
        combo = page.get_by_role("combobox", name="Product", exact=True)
        listbox = page.get_by_role("listbox", name=choices("Product"), exact=True)
        names = lambda: [txt(o) for o in listbox.get_by_role("option").all()]
        active = lambda: page.evaluate("id => document.getElementById(id)?.textContent?.trim()", attr(combo, "aria-activedescendant") or "")
        cell.click()
        page.keyboard.type("o")
        wait(page, lambda: names() == ["Oak Shelf Bracket", "Walnut Floating Shelf"], "filtered")
        assert attr(combo, "aria-expanded") == "true" and attr(combo, "aria-controls") == attr(listbox, "id") and focused(combo)
        assert active() == "Walnut Floating Shelf"
        page.keyboard.press("ArrowDown")
        assert active() == "Walnut Floating Shelf"
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        assert active() == "Oak Shelf Bracket"
        page.keyboard.press("Escape")
        wait(page, lambda: focused(cell) and txt(cell) == "Walnut Floating Shelf" and combo.count() == 0, "cancelled")
        page.keyboard.press("Enter")
        wait(page, lambda: names() == ["Blank"] + PRODUCT_NAMES, "all choices")
        sent = writes(page)
        page.keyboard.type("zzz")
        wait(page, lambda: names() == [] and page.get_by_text(NO_MATCH, exact=True).count() == 1, "no match")
        page.keyboard.press("Enter")
        advance(page, ROLL_STEP_MS)
        assert sent == []
        page.keyboard.press("Escape")
        L.delete_row(L.mara, "Products", "Brass Hinge Pair")
        page.keyboard.press("Enter")
        wait(page, lambda: "Brass Hinge Pair" not in names() and len(names()) == 4, "read afresh")
        page.keyboard.type("birch")
        wait(page, lambda: names() == ["Birch Ply Sheet"], "birch")
        page.keyboard.press("Enter")
        wait(page, lambda: focused(gcell(page, "Orders", "ORD-1003", pi)), "moved down")
    assert L.disp(priya, "Orders", "ORD-1002", "Product") == "Birch Ply Sheet"
    with workspace(browser, L.api(DEV), L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        gcell(page, "Orders", "ORD-1001", L.idx(L.mara, "Orders", "Customer")).click()
        page.keyboard.press("Enter")
        options = page.get_by_role("listbox", name=choices("Customer"), exact=True).get_by_role("option")
        wait(page, lambda: [txt(o) for o in options.all()] == ["Blank", "Pell & Daughters Catering", "Moss Street Bakery"], "own rows only")


def test_wf_delete_restore_status(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    with workspace(browser, priya, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1005")
        gone = status(page, "Deleted row")
        record(status(page, "Workspace status"), "ws")
        gcell(page, "Orders", "ORD-1003", 0).click()
        button(page, "Delete row").click()
        wait(page, lambda: "Deleted row ORD-1003." in txt(gone) and button(gone, "Undo delete").count() == 1, "status", step=1)
        wait(page, lambda: focused(gcell(page, "Orders", "ORD-1004", 0)), "next row active", step=1)
        page.keyboard.press("Tab")
        assert focused(button(gone, "Undo delete"))
        page.keyboard.press("Shift+Tab")
        advance(page, DELETED_ROW_MS - ROLL_STEP_MS)
        assert deleted_copy("ORD-1003") in txt(gone)
        advance(page, ROLL_STEP_MS * 4)
        wait(page, lambda: gone.count() == 0 or "ORD-1003" not in txt(gone), "closed after 8 s", step=1)
        gcell(page, "Orders", "ORD-1004", 0).click()
        button(page, "Delete row").click()
        wait(page, lambda: "Deleted row ORD-1004." in txt(gone), "second status", step=1)
        button(gone, "Undo delete").focus()
        advance(page, DELETED_ROW_MS * 2)
        assert deleted_copy("ORD-1004") in txt(gone)
        page.keyboard.press("Enter")
        restored = gcell(page, "Orders", "ORD-1004", 0)
        wait(page, lambda: restored.count() == 1 and focused(restored), "restored and focused", step=1)
        wait(page, lambda: fills(page, "ws", "Restored row ORD-1004.") == 1, "restore announced", step=1)
        advance(page, TALLY_MAX_MS)
        assert fills(page, "ws", restored_copy("ORD-1004")) == 1
    assert L.row_of(priya, "Orders", "ORD-1004")["id"] == L.r["Orders"]["ORD-1004"] and L.row_of(priya, "Orders", "ORD-1003") is None


def test_wf_delete_restore_journey(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    pi = L.idx(priya, "Orders", "Product")
    picker = lambda page: [txt(o) for o in page.get_by_role("listbox", name=choices("Product")).get_by_role("option").all()]
    with workspace(browser, priya, L.path("Products")) as page:
        ready(page, "Products", "Oak Shelf Bracket")
        gcell(page, "Products", "Oak Shelf Bracket", 2).click()
        button(page, "Delete row").click()
        wait(page, lambda: deleted_copy("Oak Shelf Bracket") in txt(status(page, "Deleted row")), "status", step=1)
        page.get_by_role("link", name=re.compile(r"^Orders, 5 rows")).click()
        ready(page, "Orders", "ORD-1001")
        assert txt(gcell(page, "Orders", "ORD-1001", pi)) == "#REF!"
        assert link(page, rail_name("Products", 3)).count() == 1
        gcell(page, "Orders", "ORD-1002", pi).click()
        page.keyboard.type("o")
        wait(page, lambda: picker(page) == ["Walnut Floating Shelf"], "picker without oak")
        page.keyboard.press("Escape")
        slow = Gate(page, UNDO_RE, method="POST")
        button(page, "Undo").click()
        wait(page, lambda: slow.held, "first undo held", step=0)
        button(page, "Undo").click()
        wait(page, lambda: len(slow.seen) == 2, "second undo sent", step=0)
        slow.release()
        wait(page, lambda: txt(alerts(page)) == NOTHING_UNDO and txt(gcell(page, "Orders", "ORD-1001", pi)) == "Oak Shelf Bracket", "restored")
        assert button(page, "Undo").is_disabled()
        gcell(page, "Orders", "ORD-1002", pi).click()
        page.keyboard.type("o")
        wait(page, lambda: picker(page)[:1] == ["Oak Shelf Bracket"], "oak first again")
        page.keyboard.press("Escape")
    L.check_totals(priya)
    with workspace(browser, priya, L.path("Orders"), size=PHONE, reduced="reduce") as page:
        wait(page, lambda: card(page, "ORD-1003").count() == 1, "cards")
        heading = card(page, "ORD-1003").get_by_role("heading", level=3)
        x, y = center(heading)
        page.mouse.move(x, y)
        page.mouse.down()
        advance(page, LONG_PRESS_MS)
        page.mouse.up()
        sheet = page.get_by_role("dialog", name=row_actions("ORD-1003"), exact=True)
        wait(page, lambda: focused(button(sheet, "Delete row")), "row actions")
        record(status(page, "Workspace status"), "ws")
        page.keyboard.press("Enter")
        wait(page, lambda: card(page, "ORD-1003").count() == 0, "card gone at once", step=0)
        undo = button(status(page, "Deleted row"), "Undo delete")
        wait(page, lambda: undo.is_visible(), "status")
        ux, uy = center(undo)
        page.mouse.move(ux, uy)
        page.mouse.down()
        advance(page, DELETED_ROW_MS * 2)
        page.mouse.up()
        wait(page, lambda: card(page, "ORD-1003").count() == 1 and focused(card(page, "ORD-1003").get_by_role("heading", level=3)), "card back focused", step=1)
        wait(page, lambda: fills(page, "ws", "Restored row ORD-1003.") == 1, "announced once", step=1)
    assert [r["key"] for r in L.rows(priya, "Orders")] == ["ORD-1001", "ORD-1002", "ORD-1003", "ORD-1004", "ORD-1005"]


def test_wf_row_access_scope_change(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    with workspace(browser, dev, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        assert attr(grid(page, "Orders"), "aria-rowcount") == "4"
        L.share(DEV, "editor", "all")
        page.get_by_role("link", name=re.compile(r"^Orders, \d+ rows")).click()
        wait(page, lambda: data_row(page, "Orders", "ORD-1002").count() == 1, "all rows")
        record(alerts(page), "alerts")
        page.evaluate("window.__noReload = true")
        gcell(page, "Orders", "ORD-1002", L.idx(dev, "Orders", "Qty")).click()
        page.keyboard.type("3")
        L.share(DEV, "editor", "own")
        page.keyboard.press("Enter")
        wait(page, lambda: data_row(page, "Orders", "ORD-1002").count() == 0 and data_row(page, "Orders", "ORD-1004").count() == 0, "rows dropped")
        wait(page, lambda: focused(gcell(page, "Orders", "ORD-1001", 0)) and link(page, "Orders, 3 rows").count() == 1, "focus and rail")
        wait(page, lambda: fills(page, "alerts", rows_hidden(2)) == 1, "hidden-rows alert")
        assert page.evaluate("window.__noReload === true")
    assert L.disp(L.mara, "Orders", "ORD-1002", "Qty") == "2.0000"


def test_wf_row_access_restricted_summary(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    with workspace(browser, dev, L.path("Orders by Region")) as page:
        ready(page, "Orders by Region", "North")
        assert attr(grid(page, "Orders by Region"), "aria-rowcount") == "2"
        shown = [txt(c) for c in data_row(page, "Orders by Region", "North").get_by_role("gridcell").all()]
        assert shown == ["North", "3.0000", "17.0000", "271.1000"]
        button(page, "Export CSV").click()
        dl = link(page, "Download Orders by Region.csv").first
        wait(page, lambda: dl.is_visible(), "download link")
        with page.expect_download() as info:
            dl.click()
        rows = csv_rows(Path(info.value.path()).read_bytes())
    assert rows == [["Region", "Count", "Sum of Qty", "Sum of Line Total"], shown]


def test_wf_row_access_newest_response(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    si = L.idx(dev, "Products", "Stock")
    with workspace(browser, dev, L.path("Products")) as page:
        ready(page, "Products", "Walnut Floating Shelf")
        page.evaluate("window.__noReload = true")
        slow = Gate(page, CELL_RE)
        commit(page, gcell(page, "Products", "Oak Shelf Bracket", si), "44")
        wait(page, lambda: slow.held, "slow save at server", step=0)
        L.share(DEV, "viewer", "own")
        commit(page, gcell(page, "Products", "Walnut Floating Shelf", si), "13")
        wait(page, lambda: len(slow.seen) == 2, "second sent", step=0)
        slow.release()
        wait(page, lambda: txt(alerts(page)) == PERMISSION_LOST and button(page, "Add row").count() == 0, "read-only")
        wait(page, lambda: txt(gcell(page, "Products", "Oak Shelf Bracket", si)) == "44.0000", "late success applied")
        assert txt(gcell(page, "Products", "Walnut Floating Shelf", si)) == "12.0000"
        assert attr(grid(page, "Products"), "aria-readonly") == "true" and page.get_by_role("note").filter(has_text=READ_ONLY).count() == 1
        advance(page, RESEND_MS * 2)
        assert button(page, "Add row").count() == 0 and txt(alerts(page)) == PERMISSION_LOST
        L.share(DEV, "editor", "own")
        page.get_by_role("link", name=re.compile(r"^Orders, \d+ rows")).click()
        wait(page, lambda: button(page, "Add row").count() == 1 and attr(grid(page, "Orders"), "aria-readonly") != "true", "editing back")
        assert page.evaluate("window.__noReload === true")
    assert L.disp(L.mara, "Products", "Oak Shelf Bracket", "Stock") == q4(Decimal(44))


def test_permission_lost_read_only(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    with workspace(browser, dev, L.path("Products")) as page:
        ready(page, "Products", "Oak Shelf Bracket")
        page.evaluate("window.__noReload = true")
        L.share(DEV, "viewer", "own")
        cell = gcell(page, "Products", "Oak Shelf Bracket", L.idx(dev, "Products", "Stock"))
        commit(page, cell, "41")
        wait(page, lambda: txt(alerts(page)) == PERMISSION_LOST and txt(cell) == "40.0000", "reverted")
        assert markers(grid(page, "Products")) == []
        for name in ("Add row", "Delete row", "Undo", "Redo"):
            assert button(page, name).count() == 0
        assert attr(grid(page, "Products"), "aria-readonly") == "true" and page.get_by_text(READ_ONLY, exact=True).count() >= 1
        assert page.evaluate("window.__noReload === true")
    assert L.disp(L.mara, "Products", "Oak Shelf Bracket", "Stock") == "40.0000"


def test_wf_sharing_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    L = Ledger(app_url, shares=False)
    down = Api(outage("APP_MAILPIT_DOWN_URL"), MARA)
    token, email = fresh("journey")
    with workspace(browser, down, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        button(page, "Share").click()
        dialog = page.get_by_role("dialog", name="Share document", exact=True)
        field = dialog.get_by_role("textbox", name="Email", exact=True)
        field.fill(f"a {email}")
        button(dialog, "Send invite").click()
        wait(page, lambda: attr(field, "aria-invalid") == "true" and EMAIL_MSG in described(page, field) and focused(field), "field error")
        field.fill(email)
        dialog.get_by_role("radio", name="Viewer", exact=True).check()
        button(dialog, "Send invite").click()
        wait(page, lambda: txt(page.get_by_role("alert", name="Mail outage")) == MAIL_OUTAGE, "outage banner")
        person = dialog.get_by_role("list", name="People").get_by_role("listitem").filter(has_text=email)
        wait(page, lambda: "Not sent" in txt(person) and button(dialog, f"Resend invite to {email}").count() == 1, "not sent")
    share = next(s for s in L.mara.ok("GET", f"{L.d}/shares")["shares"] if s["email"] == email)
    err(L.mara.request("POST", f"{L.d}/shares/{share['id']}/resend", headers={"Origin": "http://other.example"}), 403, "cross_origin")
    assert inbox(mail, email) == [] and token
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        button(page, "Share").click()
        dialog = page.get_by_role("dialog", name="Share document", exact=True)
        button(dialog, f"Resend invite to {email}").click()
        wait(page, lambda: txt(status(page, "Share status")) == f"Invite sent to {email}.", "sent copy")
        wait(page, lambda: page.get_by_role("alert", name="Mail outage").count() == 0 or txt(page.get_by_role("alert", name="Mail outage")) == "", "banner gone")
        assert "Sent" in txt(dialog.get_by_role("list", name="People").get_by_role("listitem").filter(has_text=email))
    msgs = inbox(mail, email)
    assert len(msgs) == 1 and addresses(msgs[0].get("To")) == [email]


def test_wf_sharing_existing_account(browser: Browser, app_url: str, mail: Mailpit) -> None:
    L = Ledger(app_url, shares=False)
    with workspace(browser, L.mara, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        button(page, "Share").click()
        dialog = page.get_by_role("dialog", name="Share document", exact=True)
        field = dialog.get_by_role("textbox", name="Email", exact=True)
        field.fill(JONAH)
        dialog.get_by_role("radio", name="Only their own rows", exact=True).check()
        button(dialog, "Send invite").click()
        wait(page, lambda: txt(status(page, "Share status")) == f"Invite sent to {JONAH}." and field.input_value() == "" and focused(field), "sent")
    assert {d["id"]: d["role"] for d in Api(app_url, JONAH).ok("GET", "/api/documents")["documents"]}[L.doc] == "editor"
    assert any(L.name in m["Subject"] for m in inbox(mail, JONAH))


def test_wf_accountant_export_status(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    with workspace(browser, L.mara, L.path("Customers")) as page:
        ready(page, "Customers", "Moss Street Bakery")
        es = status(page, "Export status")
        record(es, "es")
        gate = Gate(page, EXPORT_RE, method="POST")
        button(page, "Export CSV").focus()
        page.keyboard.press("Enter")
        progress = page.get_by_role("progressbar", name="Export progress", exact=True)
        wait(page, lambda: gate.held and progress.is_visible(), "writing", step=0)
        wait(page, lambda: txt(es) == writing_copy(csv_file("Customers")) and attr(progress, "data-motion") == "sweep", "writing status filled")
        advance(page, SWEEP_MS)
        page.emulate_media(reduced_motion="reduce")
        wait(page, lambda: attr(progress, "data-motion") == "static", "static under reduced motion", step=0)
        gate.release()
        wait(page, lambda: txt(es) == ready_copy(csv_file("Customers")) and progress.count() == 0, "ready")
        commit(page, gcell(page, "Customers", "Moss Street Bakery", 2), "555-0199")
        advance(page, TALLY_MAX_MS * 2)
        page.get_by_role("link", name=re.compile(r"^Orders, 5 rows")).click()
        ready(page, "Orders", "ORD-1001")
        assert txt(es) == ""
        page.get_by_role("link", name=re.compile(r"^Customers, 3 rows")).click()
        ready(page, "Customers", "Moss Street Bakery")
        wait(page, lambda: txt(status(page, "Export status")) == ready_copy(csv_file("Customers")), "message back")
        assert fills(page, "es", writing_copy(csv_file("Customers"))) == 1 and fills(page, "es", ready_copy(csv_file("Customers"))) == 1
        count = len(L.mara.ok("GET", f"{L.d}/exports")["exports"])
        first = Gate(page, EXPORT_RE, method="POST")
        button(page, "Export CSV").click()
        wait(page, lambda: first.held, "first held", step=0)
        button(page, "Export CSV").click()
        wait(page, lambda: len(first.seen) == 2 and txt(status(page, "Export status")) == ready_copy(csv_file("Customers")), "second answered")
        first.release()
        advance(page, TALLY_MAX_MS)
        assert txt(status(page, "Export status")) == ready_copy(csv_file("Customers"))
    assert len(L.mara.ok("GET", f"{L.d}/exports")["exports"]) == count + 2


def test_wf_accountant_export_storage_down(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    L.export(L.mara, "Customers")
    down = Api(outage("APP_MINIO_DOWN_URL"), MARA)
    with workspace(browser, down, L.path("Customers")) as page:
        ready(page, "Customers", "Moss Street Bakery")
        dl = link(page, "Download Customers.csv")
        wait(page, lambda: dl.count() == 1, "ready export listed")
        dl.click()
        wait(page, lambda: txt(status(page, "Export status")) == DOWNLOAD_UNREACHABLE, "refusal copy")
        commit(page, gcell(page, "Customers", "Moss Street Bakery", 2), "555-0199")
        wait(page, lambda: txt(gcell(page, "Customers", "Moss Street Bakery", 2)) == "555-0199", "edit works")
        page.get_by_role("link", name=re.compile(r"^Orders, 5 rows")).click()
        ready(page, "Orders", "ORD-1001")
        page.get_by_role("link", name=re.compile(r"^Customers, 3 rows")).click()
        ready(page, "Customers", "Moss Street Bakery")
        wait(page, lambda: txt(status(page, "Export status")) == DOWNLOAD_UNREACHABLE, "refusal survives")
        button(page, "Export CSV").click()
        wait(page, lambda: txt(status(page, "Export status")) == EXPORT_FAILED, "failed copy")
        assert dl.count() == 1
    newest = L.mara.ok("GET", f"{L.d}/exports")["exports"][0]
    assert newest["status"] == "failed" and newest["download_url"] is None
    assert L.disp(L.mara, "Customers", "Moss Street Bakery", "Phone") == "555-0199"


def test_wf_accountant_export_journey(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    eq_name, phone = f"={CUSTOMERS[2]['Name']}", CUSTOMERS[0]["Phone"]
    customers_csv = csv_file("Customers")
    L.put(priya, "Customers", CUSTOMERS[2]["Name"], "Name", eq_name)
    err(L.export(L.mara, "Customers", Origin="http://other.example"), 403, "cross_origin")
    assert L.mara.ok("GET", f"{L.d}/exports")["exports"] == []
    with workspace(browser, L.mara, L.path("Customers")) as page:
        ready(page, "Customers", eq_name)
        es = status(page, "Export status")
        record(es, "es")
        button(page, "Export CSV").focus()
        page.keyboard.press("Enter")
        wait(page, lambda: txt(es) == ready_copy(customers_csv), "ready")
        assert fills(page, "es", writing_copy(customers_csv)) == 1 and fills(page, "es", ready_copy(customers_csv)) == 1
        export = L.mara.ok("GET", f"{L.d}/exports")["exports"][0]
        stored = S3().get(f"exports/{L.doc}/{export['id']}.csv")
        with page.expect_download() as info:
            link(page, download_link(customers_csv)).focus()
            page.keyboard.press("Enter")
        first = Path(info.value.path()).read_bytes()
        assert first == stored and info.value.suggested_filename == customers_csv
        assert f"'{phone}".encode() in first and f"'{eq_name}".encode() in first
        assert txt(gcell(page, "Customers", eq_name, 0)) == eq_name
        commit(page, gcell(page, "Customers", eq_name, 0), CUSTOMERS[2]["Name"])
        wait(page, lambda: data_row(page, "Customers", "Moss Street Bakery").count() == 1, "corrected")
        with page.expect_download() as info:
            link(page, download_link(customers_csv)).click()
        assert Path(info.value.path()).read_bytes() == stored
        wait(page, lambda: txt(es) == downloaded_copy(customers_csv), "downloaded copy")
    record_now = L.mara.ok("GET", f"/api/exports/{export['id']}")["export"]
    assert record_now == export and export["created_by"] == L.mara.user["id"] and export["document_revision"] < L.revision()
    with workspace(browser, L.mara, L.path("Customers"), size=PHONE, reduced="reduce") as page:
        wait(page, lambda: records(page).is_visible(), "cards")
        gate = Gate(page, EXPORT_RE, method="POST")
        button(page, "Export CSV").click()
        progress = page.get_by_role("progressbar", name="Export progress", exact=True)
        wait(page, lambda: gate.held and progress.is_visible(), "writing", step=0)
        assert attr(progress, "data-motion") == "static" and animations(progress) == []
        gate.release()
        wait(page, lambda: txt(status(page, "Export status")) == ready_copy(customers_csv), "ready on phone")
        button(page, "Exports").click()
        sheet = page.get_by_role("dialog", name="Exports", exact=True)
        newest = sheet.get_by_role("list", name="Exports").get_by_role("link", name=download_link(customers_csv)).first
        wait(page, lambda: newest.is_visible(), "exports sheet")
        layout(page)
        with page.expect_download() as info:
            newest.click()
        latest = L.mara.ok("GET", f"{L.d}/exports")["exports"][0]
        assert Path(info.value.path()).read_bytes() == S3().get(f"exports/{L.doc}/{latest['id']}.csv")


NEXT_CASES = ["workspace_path", "protocol_relative", "backslash", "absolute_url", "missing"]


@pytest.mark.parametrize("case", NEXT_CASES, ids=NEXT_CASES)
def test_wf_viewer_readonly_next(browser: Browser, app_url: str, case: str) -> None:
    target = "/"
    if case == "workspace_path":
        L = Ledger(app_url)
        target = L.path("Orders")
    nxt = {"workspace_path": target, "protocol_relative": "/" + "/other.example/d/x", "backslash": "/\\other.example",
           "absolute_url": "http://other.example/", "missing": None}[case]
    query = f"?next={urllib.parse.quote(nxt, safe='')}" if nxt else ""
    with open_app(browser, f"{app_url}/sign-in{query}") as page:
        page.get_by_role("textbox", name="Email", exact=True).fill(SAM)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Sign in").click()
        wait(page, lambda: urllib.parse.urlsplit(page.url).netloc == urllib.parse.urlsplit(app_url).netloc and path_of(page) == target and "sign-in" not in page.url, "landing")
        if case == "workspace_path":
            wait(page, lambda: focused(gcell(page, "Orders", "ORD-1001", 0)), "active cell focused")
        else:
            wait(page, lambda: page.get_by_role("heading", name="Documents").is_visible(), "documents")


def test_wf_viewer_readonly_names(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    for name, formula in (("Div", "1/0"), ("Typ", '"a" + 1'), ("Nam", "[Nope]"), ("Cir", "[Cir] + 1")):
        L.add_column("Orders", name, "formula", formula=formula)
    L.add_row("Products", {"Name": "Spare Part", "Price": "1"})
    L.put(L.mara, "Orders", "ORD-1005", "Product", L.r["Products"]["Spare Part"])
    L.delete_row(L.mara, "Products", "Spare Part")
    sam = L.api(SAM)
    with workspace(browser, sam, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        assert attr(grid(page, "Orders"), "aria-readonly") == "true"
        for name in ("Products, 4 rows", "Customers, 3 rows", "Orders, 5 rows", "Orders by Region, 2 rows"):
            assert link(page, name).count() == 1
        record(alerts(page), "alerts")
        qty = gcell(page, "Orders", "ORD-1001", L.idx(sam, "Orders", "Qty"))
        qty.click()
        page.keyboard.press("Enter")
        wait(page, lambda: fills(page, "alerts", READ_ONLY) == 1 and focused(qty), "first attempt")
        page.keyboard.type("5")
        wait(page, lambda: fills(page, "alerts", READ_ONLY) == 2 and focused(qty), "second attempt")
        for col, error in (("Div", "#DIV/0!"), ("Typ", "#TYPE!"), ("Nam", "#NAME?"), ("Cir", "#CIRC!"), ("Line Total", "#REF!")):
            key = "ORD-1005" if col == "Line Total" else "ORD-1001"
            cell = gcell(page, "Orders", key, L.idx(sam, "Orders", col))
            cell.click()
            wait(page, lambda c=cell, e=error: txt(c) == e and described(page, c) == TOOLTIPS[e], f"{error} tooltip")
        page.keyboard.press("Escape")
        assert focused(cell)
        link(page, "Orders by Region, 2 rows").click()
        ready(page, "Orders by Region", "North")
        button(page, "Export CSV").click()
        wait(page, lambda: link(page, "Download Orders by Region.csv").count() >= 1, "download link name")


def test_wf_viewer_readonly_sign_out(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    sam = Api(app_url, SAM)
    with workspace(browser, sam, L.path("Orders")) as page:
        ready(page, "Orders", "ORD-1001")
        button(page, "Sign out").click()
        wait(page, lambda: path_of(page) == "/sign-in" and "next=" not in page.url and focused(page.get_by_role("textbox", name="Email")), "signed out")
        page.go_back()
        wait(page, lambda: path_of(page) == "/sign-in" and urllib.parse.unquote(urllib.parse.parse_qs(urllib.parse.urlsplit(page.url).query).get("next", [""])[0]) == L.path("Orders"), "back to sign-in")
        assert page.get_by_role("gridcell").count() == 0 and page.get_by_text("ORD-1001").count() == 0
        page.get_by_role("textbox", name="Email", exact=True).fill(SAM)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.goto(f"{app_url}/sign-in")
        page.get_by_role("textbox", name="Email", exact=True).fill(SAM)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Sign in").click()
        wait(page, lambda: path_of(page) == "/" and page.evaluate("document.activeElement.getAttribute('role') || document.activeElement.tagName") in ("link", "A"), "first document link focused")
    err(httpx.get(f"{app_url}/api/me", cookies={"tf_session": sam.token}), 401, "unauthenticated")


def test_wf_viewer_readonly_journey(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    path = L.path("Orders")
    with open_app(browser, f"{app_url}{path}") as page:
        wait(page, lambda: path_of(page) == "/sign-in" and urllib.parse.parse_qs(urllib.parse.urlsplit(page.url).query).get("next") == [path], "sent to sign-in")
        page.get_by_role("textbox", name="Email", exact=True).fill(SAM)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Sign in").click()
        wait(page, lambda: path_of(page) == path and focused(gcell(page, "Orders", "ORD-1001", 0)), "returned")
        assert attr(grid(page, "Orders"), "aria-readonly") == "true" and button(page, "Add row").count() == 0
        link(page, "Orders by Region, 2 rows").click()
        ready(page, "Orders by Region", "South")
        screen = [[txt(c) for c in data_row(page, "Orders by Region", k).get_by_role("gridcell").all()] for k in ("North", "South")]
        button(page, "Export CSV").click()
        with page.expect_download() as info:
            dl = link(page, "Download Orders by Region.csv").first
            wait(page, lambda: dl.is_visible(), "link")
            dl.click()
        assert csv_rows(Path(info.value.path()).read_bytes())[1:] == screen
    sam = L.api(SAM)
    err(L.put(sam, "Orders", "ORD-1001", "Qty", "9"), 403, "forbidden")
    assert L.disp(L.mara, "Orders", "ORD-1001", "Qty") == "4.0000"


def big(loc: Locator) -> bool:
    return all(b["width"] >= TOUCH_PX and b["height"] >= TOUCH_PX for b in (e.bounding_box() for e in loc.all()) if b)


def big_targets(loc: Locator) -> bool:
    js = "e => { const t = e.closest('label') || (e.labels && e.labels[0]) || e; const r = t.getBoundingClientRect(); return [r.width, r.height]; }"
    return all(w >= TOUCH_PX and h >= TOUCH_PX for w, h in (e.evaluate(js) for e in loc.all()))


def test_wf_phone_stock_touch(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    with workspace(browser, L.mara, L.path("Orders"), size=PHONE) as page:
        wait(page, lambda: records(page).get_by_role("listitem").count() == 5, "cards")
        assert big(records(page).get_by_role("button"))
        assert all(big(button(page, n)) for n in ("Switch table", "Add row", "Export CSV", "Exports", "Add column"))
        button(card(page, "ORD-1005"), edit_button("Customer")).click()
        options = page.get_by_role("listbox", name=choices("Customer"), exact=True).get_by_role("option")
        wait(page, lambda: options.count() >= 3, "picker")
        assert big(options)
        page.keyboard.press("Escape")
        button(page, "Add column").click()
        sheet = page.get_by_role("dialog", name="Add column", exact=True)
        wait(page, lambda: sheet.is_visible(), "sheet")
        assert big(sheet.get_by_role("button")) and big_targets(sheet.get_by_role("radio"))


def test_wf_phone_stock_cards(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    with workspace(browser, priya, L.path("Orders"), size=PHONE) as page:
        wait(page, lambda: records(page).get_by_role("listitem").count() == 5, "cards")
        assert page.get_by_role("grid").count() == 0 and button(page, "Rename table").count() == 0
        first = card(page, "ORD-1001")
        for name in (edit_button("Qty"), edit_button("Customer"), edit_button("Line Total", formula=True), "Delete row"):
            assert button(first, name).count() == 1
        last = card(page, "ORD-1005")
        button(last, edit_button("Customer")).click()
        options = page.get_by_role("listbox", name=choices("Customer"), exact=True).get_by_role("option")
        wait(page, lambda: options.count() >= 3, "picker on last card")
        for opt in options.all():
            b = opt.bounding_box()
            assert b["y"] >= 0 and b["y"] + b["height"] <= PHONE[1] and b["x"] >= 0 and b["x"] + b["width"] <= PHONE[0]
            x, y = center(opt)
            assert opt.evaluate("(e, p) => e.contains(document.elementFromPoint(p[0], p[1]))", [x, y])
        page.keyboard.press("Escape")
        button(page, "Switch table").click()
        drawer = page.get_by_role("dialog", name="Tables", exact=True)
        drawer.get_by_role("link", name="Products, 4 rows", exact=True).click()
        wait(page, lambda: drawer.count() == 0 and focused(card(page, "Oak Shelf Bracket").get_by_role("heading", level=3)), "switched")
        layout(page)
    with workspace(browser, L.mara, L.path("Orders"), size=PHONE) as page:
        wait(page, lambda: records(page).is_visible(), "owner cards")
        button(page, "Add column").click()
        sheet = page.get_by_role("dialog", name="Add column", exact=True)
        wait(page, lambda: sheet.is_visible(), "sheet")
        box = sheet.bounding_box()
        assert (round(box["width"]), round(box["height"])) == PHONE


def test_wf_phone_stock_collapsed(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    rail_names = {rail_name("Products", 4), rail_name("Customers", 2), rail_name("Orders", 3), rail_name("Orders by Region", 1)}
    with workspace(browser, dev, L.path("Orders"), size=TABLET) as page:
        ready(page, "Orders", "ORD-1001")
        tables = button(page, "Tables")
        tables.click()
        nav = page.get_by_role("navigation", name="Tables")
        wait(page, lambda: nav.is_visible(), "open")
        x, y = center(link(page, "Products, 4 rows"))
        tables.click()
        wait(page, lambda: nav.count() == 0, "closed")
        assert not page.evaluate("p => (document.elementFromPoint(p[0], p[1])?.closest('a')?.textContent || '').includes('Products')", [x, y])
        tables.focus()
        assert not rail_names & set(tab_order(page, 12))
        layout(page)
    with workspace(browser, dev, L.path("Orders"), size=PHONE) as page:
        wait(page, lambda: records(page).is_visible(), "cards")
        assert page.get_by_role("navigation", name="Tables").count() == 0
        button(page, "Switch table").focus()
        assert not rail_names & set(tab_order(page, 12))
        button(page, "Switch table").click()
        drawer = page.get_by_role("dialog", name="Tables", exact=True)
        wait(page, lambda: drawer.get_by_role("navigation", name="Tables").is_visible(), "drawer open")
        for _ in range(6):
            page.keyboard.press("Tab")
            assert drawer.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        wait(page, lambda: page.get_by_role("navigation", name="Tables").count() == 0 and focused(button(page, "Switch table")), "drawer closed")
        layout(page)


def test_wf_phone_stock_contrast(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    priya = L.api(PRIYA)
    with workspace(browser, priya, L.path("Products"), size=PHONE) as page:
        wait(page, lambda: records(page).is_visible(), "cards")
        contrast_audit(page)
        oak = card(page, "Oak Shelf Bracket")
        gate = Gate(page, CELL_RE)
        button(oak, "Edit Stock").click()
        oak.get_by_role("textbox", name="Stock", exact=True).fill("41")
        button(oak, "Save").click()
        wait(page, lambda: gate.held, "pending", step=0)
        contrast_audit(page)
        gate.release()
        wait(page, lambda: "41.0000" in txt(oak), "saved")
        add = button(page, "Add row")
        add.focus()
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Tab")
        wait(page, lambda: focused(add), "Add row focused from the keyboard")
        width = add.evaluate(FOCUS_RING_JS)
        assert width >= FOCUS_OUTLINE_PX
        button(oak, "Edit Price").click()
        field = oak.get_by_role("textbox", name="Price", exact=True)
        field.fill("abc")
        button(oak, "Save").click()
        wait(page, lambda: attr(field, "aria-invalid") == "true" and txt(alerts(page)) == DECIMAL_MSG, "refused field")
        assert oak.get_by_text(DECIMAL_MSG, exact=True).count() >= 1
    assert L.disp(priya, "Products", "Oak Shelf Bracket", "Price") == "12.5000"


def test_wf_phone_stock_journey(browser: Browser, app_url: str) -> None:
    L = Ledger(app_url)
    dev = L.api(DEV)
    switch = lambda page, name: (button(page, "Switch table").click(),
                                 page.get_by_role("dialog", name="Tables").get_by_role("link", name=re.compile(rf"^{name}, ")).click())
    with workspace(browser, dev, L.path("Orders"), size=PHONE) as page:
        wait(page, lambda: records(page).is_visible(), "cards")
        switch(page, "Products")
        wait(page, lambda: card(page, "Oak Shelf Bracket").count() == 1 and page.get_by_role("navigation", name="Tables").count() == 0, "products")
        oak = card(page, "Oak Shelf Bracket")
        button(oak, "Edit Stock").click()
        oak.get_by_role("textbox", name="Stock", exact=True).fill("44")
        button(oak, "Save").click()
        wait(page, lambda: "40.0000" in txt(oak) and "Recalculated 1 cell in 1 table." in visible_text(page), "restricted settle")
        L.share(DEV, "editor", "all")
        switch(page, "Orders")
        wait(page, lambda: records(page).get_by_role("listitem").count() == 5, "all five orders")
        o2 = card(page, "ORD-1002")
        button(o2, edit_button("Qty")).click()
        o2.get_by_role("textbox", name="Qty", exact=True).fill("3")
        L.share(DEV, "editor", "own")
        record(alerts(page), "alerts")
        button(o2, "Save").click()
        wait(page, lambda: records(page).get_by_role("listitem").count() == 3 and fills(page, "alerts", rows_hidden(2)) == 1, "narrowed")
        wait(page, lambda: focused(card(page, "ORD-1001").get_by_role("heading", level=3)), "first heading focused")
        switch(page, "Products")
        wait(page, lambda: card(page, "Walnut Floating Shelf").count() == 1, "products again")
        slow = Gate(page, CELL_RE)
        oak, walnut = card(page, "Oak Shelf Bracket"), card(page, "Walnut Floating Shelf")
        button(oak, "Edit Stock").click()
        oak.get_by_role("textbox", name="Stock", exact=True).fill("45")
        button(oak, "Save").click()
        wait(page, lambda: slow.held, "slow save", step=0)
        button(walnut, "Edit Stock").click()
        walnut.get_by_role("textbox", name="Stock", exact=True).fill("13")
        L.share(DEV, "viewer", "own")
        button(walnut, "Save").click()
        wait(page, lambda: len(slow.seen) == 2, "second sent", step=0)
        slow.release()
        wait(page, lambda: txt(alerts(page)) == PERMISSION_LOST and records(page).get_by_role("button", name=re.compile("^Edit ")).count() == 0, "read-only cards")
        wait(page, lambda: "45.0000" in txt(oak) and "12.0000" in txt(walnut), "late success applied, refused reverted")
        wait(page, lambda: focused(walnut.get_by_role("heading", level=3)), "focus on the refused card")
        L.share(DEV, "editor", "own")
        switch(page, "Orders")
        wait(page, lambda: records(page).get_by_role("button", name=edit_button("Qty")).count() == 3, "controls back")
    assert L.disp(L.mara, "Products", "Oak Shelf Bracket", "Stock") == q4(Decimal(45))
    assert L.disp(L.mara, "Products", "Walnut Floating Shelf", "Stock") == "12.0000"


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def shipped() -> list[dict]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=DEPLOYED_APP, capture_output=True, text=True, timeout=600)
    found: dict[tuple[str, str], dict] = {}

    def walk(node: dict) -> None:
        for name, dep in (node.get("dependencies") or {}).items():
            if dep.get("version") and not dep.get("missing") and (name, dep["version"]) not in found:
                found[(name, dep["version"])] = {"name": name, **dep}
                walk(dep)

    walk(json.loads(out.stdout or "{}"))
    return list(found.values())


def licence_ok(value: Any) -> bool:
    spdx = value.get("type", "") if isinstance(value, dict) else str(value or "")
    return any(all(p.strip(" ()") in ALLOWED_LICENCES for p in alt.split(" AND ")) for alt in spdx.split(" OR ")) if spdx else False


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{p['name']}@{p['version']}" for p in shipped() if p["name"] not in notices or p["version"] not in notices]
    assert not missing
    for name in ("Instrument Serif", "IBM Plex Sans", "IBM Plex Mono", "Lucide"):
        assert name in notices


def test_if_licences() -> None:
    bad = []
    for p in shipped():
        lic = p.get("license")
        if lic is None and p.get("path"):
            lic = json.loads((Path(p["path"]) / "package.json").read_text()).get("license")
        if not licence_ok(lic):
            bad.append((p["name"], lic))
    assert not bad
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text().splitlines()
    def font_licensed(font: str) -> bool:
        for i, line in enumerate(notices):
            if font in line:
                block = " ".join(notices[i:i + 6])
                if "OFL" in block or "Open Font License" in block:
                    return True
        return False

    for font in ("Instrument Serif", "IBM Plex Sans", "IBM Plex Mono"):
        assert font_licensed(font), font


def test_if_no_extra_datastores() -> None:
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "level", "lmdb", "@libsql/client", "pglite", "@electric-sql/pglite"}
    assert not forbidden & {p["name"] for p in shipped()}
    stray = [p for p in Path("/app").rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not stray
    assert Postgres().tables()


def test_if_provided_services(app_url: str) -> None:
    L = Ledger(app_url, shares=False)
    e = L.export(L.mara, "Customers").json()["export"]
    assert S3().get(f"exports/{L.doc}/{e['id']}.csv")
    assert Postgres().tables()


def test_if_strict_typescript() -> None:
    configs = [p for p in Path("/app").rglob("tsconfig*.json") if "node_modules" not in p.parts]
    texts = [p.read_text() for p in configs]
    assert any(re.search(r'"strict"\s*:\s*true', t) for t in texts)
    assert not any(re.search(r'"strict"\s*:\s*false', t) for t in texts)
    sources = [p for p in Path("/app").rglob("*") if "node_modules" not in p.parts and "dist" not in p.parts and "build" not in p.parts]
    assert any(p.suffix in (".ts", ".tsx") for p in sources)


def test_if_own_origin_assets(browser: Browser, app_url: str) -> None:
    names = {p["name"] for p in shipped()}
    pkg = json.loads((DEPLOYED_APP / "package.json").read_text())
    declared = names | set(pkg.get("dependencies", {})) | set(pkg.get("devDependencies", {}))
    assert any(n.startswith("lucide") or n.startswith("@lucide") for n in declared)
    assert not names & {"react-icons", "@fortawesome/fontawesome-svg-core", "@heroicons/react", "@mui/icons-material", "@tabler/icons-react", "@phosphor-icons/react"}
    with open_app(browser, f"{app_url}/sign-in") as page:
        requests: list[str] = []
        page.on("request", lambda r: requests.append(r.url))
        page.reload()
        wait(page, lambda: page.get_by_role("heading", name="Sign in to Tallyframe").is_visible(), "sign-in")
        assert all(same_origin(u, app_url) for u in requests if u.startswith("http"))
