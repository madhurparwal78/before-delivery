from __future__ import annotations

import concurrent.futures
import json
import math
import os
import re
import signal
import socket
import string
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    center,
    check,
    click,
    fill,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    unique,
)
from conftest import text as mail_text

PASSWORD = "drafting-ada-01"
OTHER_PASSWORD = "drafting-bea-02"
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
LEFT_RAIL_PX = 248
INSPECTOR_RAIL_PX = 296
TARGET_MIN_PX = 44
STEP_MS = 50
GRID = 8
NUDGE = 8
FINE_NUDGE = 1
INSERT_W = 160
INSERT_H = 80
INSERT_STEP = 208
INSERT_GAP = 48
SIZE_MIN = 24
SIZE_MAX = 2000
COORD_MAX = 20000
CLEARANCE_MIN = 11
SEPARATION_MIN = 7
SHARED_PORT_RUN = 12
SPAN_OVERLAP = 1
PX_TOL = 1
AXIS_TOL = 0.5
EXPORT_PAD = 24
SETTLE_MS = 200
GLIDE_MS = 240
RAIL_MS = 200
LONG_PRESS_MS = 500
CURSOR_MS = 50
OFFLINE_MS = 3000
SAVED_MS = 3000
LIVE_S = 1
TWO_S = 2
VERSION_INTERVAL_S = 6
INVITE_TTL_S = 8
STORAGE_WAIT_S = 10
BODY_LIMIT = 1_000_000
OUTAGE_MAX_MS = 60000
DUPLICATE_OFFSET = 24
FOCUS_RING_PX = 2

SLACK_S = 0.75
BOOT_S = 30
HTTP_TIMEOUT_S = 30
WORK_S = 30
POLL_S = 0.2
FRAME_MS = 17
TAB_LIMIT = 80
COPY_BOOT_S = 120
MAIL_SETTLE_S = 1.5
OFFLINE_OUTAGE_MS = 25000
SHORT_OUTAGE_MS = 4000
DRAG_DX = 37
DRAG_DY = 21
RESIZE_DX = 29
RESIZE_DY = 13
ID_LEN = 12
ZOOM_AFTER_100 = 150
PROGRESS_TOL = 2 * FRAME_MS / RAIL_MS
FOREIGN_ORIGIN = "http://evil.example"
UNSAFE_NEXT = FOREIGN_ORIGIN.split(":", 1)[1]
SKEWED_CLOCK = datetime(2031, 3, 9, 4, 17, tzinfo=timezone.utc)
WAIT = threading.Event()


@dataclass
class Person:
    name: str
    email: str
    password: str = PASSWORD
    id: str = ""


def person(prefix: str) -> Person:
    first, second = unique(prefix)
    email, name = (first, second) if "@" in first else (second, first)
    return Person(name=name, email=email.lower())


def cast(*prefixes: str) -> list[Person]:
    return [person(p) for p in prefixes]


def fresh(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def op_id() -> str:
    return uuid.uuid4().hex


def S(label: str, x: int, y: int, w: int = 120, h: int = 64, layer: str = "Base", kind: str = "rectangle") -> dict:
    return {"kind": kind, "layer": layer, "x": x, "y": y, "w": w, "h": h, "label": label}


def C(src: str, sp: str, dst: str, dp: str, label: str = "") -> dict:
    return {"from": {"shape": src, "port": sp}, "to": {"shape": dst, "port": dp}, "label": label}


def L(name: str, visible: bool = True, locked: bool = False) -> dict:
    return {"name": name, "visible": visible, "locked": locked}


def P(name: str = "Main", layers: list | None = None, shapes=(), connectors=(), groups=(), comments=()) -> dict:
    return {
        "name": name,
        "layers": layers or [L("Base")],
        "shapes": list(shapes),
        "connectors": list(connectors),
        "groups": [{"members": list(g)} for g in groups],
        "comments": list(comments),
    }


def D(owner: Person, members=(), pages=(), title: str | None = None) -> dict:
    return {
        "title": title or fresh("Pipeline"),
        "owner": owner.email,
        "members": [{"email": p.email, "role": r} for p, r in members],
        "document": {"pages": list(pages) or [P()]},
    }


def note(label: str, author: Person, body: str) -> dict:
    return {"shape": label, "author": author.email, "text": body}


def pipeline(extra_shapes=(), extra_connectors=(), groups=(), comments=(), layers=None) -> dict:
    return P(
        layers=layers or [L("Base"), L("Notes"), L("Walls")],
        shapes=[S("Intake", 40, 120), S("Archive", 240, 120), S("Review", 440, 120), S("Log", 0, 400), S("Store", 440, 400), *extra_shapes],
        connectors=[C("Intake", "e", "Review", "w", "Pipeline"), C("Archive", "s", "Store", "n"), C("Log", "e", "Store", "w"), *extra_connectors],
        groups=groups,
        comments=comments,
    )


@dataclass
class Seeded:
    did: str
    pages: list[dict]
    title: str = ""

    def pid(self, i: int = 0) -> str:
        return self.pages[i]["id"]

    def sid(self, label: str, i: int = 0) -> str:
        return self.pages[i]["shapes"][label]

    def cid(self, src: str, dst: str, i: int = 0) -> str:
        return self.pages[i]["connectors"][f"{src}->{dst}"]

    def lid(self, name: str, i: int = 0) -> str:
        return self.pages[i]["layers"][name]

    def mid(self, label: str, i: int = 0, k: int = 0) -> str:
        return self.pages[i]["comments"][label][k]


def seed_request(users: list[Person], diagrams: list[dict]) -> dict:
    return {"users": [{"email": u.email, "name": u.name, "password": u.password} for u in users], "diagrams": diagrams}


def seed(base: str, users: list[Person], diagrams: list[dict]) -> list[Seeded]:
    r = post_json(base, "/api/grading/seed", seed_request(users, diagrams))
    assert r.status_code == 201, r.text
    body = r.json()
    ids = {u["email"].lower(): u["id"] for u in body["users"]}
    for u in users:
        u.id = ids[u.email]
    return [Seeded(d["id"], d["pages"], spec["title"]) for d, spec in zip(body["diagrams"], diagrams)]


def login(base: str, who: Person) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    r = c.post("/api/auth/signin", json={"email": who.email, "password": who.password})
    assert r.status_code == 200, r.text
    token = r.cookies.get("lw_session")
    assert token, "sign-in sets lw_session"
    c.cookies.clear()
    c.cookies.set("lw_session", token)
    return c


def send(c: httpx.Client, did: str, op: dict, oid: str | None = None, base_seq: int = 0) -> httpx.Response:
    return c.post(f"/api/diagrams/{did}/operations", json={"opId": oid or op_id(), "baseSeq": base_seq, "op": op})


def accept(c: httpx.Client, did: str, op: dict, oid: str | None = None) -> dict:
    r = send(c, did, op, oid)
    assert r.status_code == 200, r.text
    return r.json()


def move(sid: str, **fields: Any) -> dict:
    return {"kind": "update_shape", "shape": sid, "set": fields}


def get_doc(c: httpx.Client, did: str) -> dict:
    r = c.get(f"/api/diagrams/{did}/document")
    assert r.status_code == 200, r.text
    return r.json()


def page_doc(doc: dict, pid: str) -> dict:
    return next(p for p in doc["pages"] if p["id"] == pid)


def find(doc: dict, kind: str, oid: str) -> dict | None:
    for p in doc["pages"]:
        for item in p[kind]:
            if item["id"] == oid:
                return item
    return None


def shape(doc: dict, sid: str) -> dict:
    s = find(doc, "shapes", sid)
    assert s is not None, f"shape {sid} missing"
    return s


def routes(doc: dict) -> dict[str, list]:
    return {c["id"]: c["route"] for p in doc["pages"] for c in p["connectors"]}


def rerouted(before: dict, after: dict) -> list[str]:
    a, b = routes(before), routes(after)
    return sorted(cid for cid in a if cid in b and a[cid] != b[cid])


def assert_error(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.status_code} {r.text}"
    body = r.json()
    assert body["error"]["code"] == code, body
    assert isinstance(body["error"]["message"], str)
    return body


NOT_FOUND_BODY = {"error": {"code": "not_found", "message": "Diagram not found."}}


def until_http(predicate: Callable[[], Any], seconds: float, what: str) -> Any:
    return poll([], predicate, seconds, what)


def snap(v: float) -> int:
    return int(math.floor(v / GRID + 0.5)) * GRID


def port_at(s: dict, port: str) -> tuple[int, int]:
    x, y, w, h = s["x"], s["y"], s["w"], s["h"]
    return {
        "n": (math.floor(x + w / 2), y),
        "e": (x + w, math.floor(y + h / 2)),
        "s": (math.floor(x + w / 2), y + h),
        "w": (x, math.floor(y + h / 2)),
    }[port]


def norm(route) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for p in route:
        q = (float(p[0]), float(p[1]))
        if out and abs(out[-1][0] - q[0]) <= AXIS_TOL and abs(out[-1][1] - q[1]) <= AXIS_TOL:
            continue
        out.append(q)
    i = 1
    while i < len(out) - 1:
        a, b, c = out[i - 1], out[i], out[i + 1]
        same_x = abs(a[0] - b[0]) <= AXIS_TOL and abs(b[0] - c[0]) <= AXIS_TOL
        same_y = abs(a[1] - b[1]) <= AXIS_TOL and abs(b[1] - c[1]) <= AXIS_TOL
        if same_x or same_y:
            out.pop(i)
        else:
            i += 1
    return out


def bends(route) -> int:
    return len(norm(route)) - 2


def segs(route) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    pts = [(float(p[0]), float(p[1])) for p in route]
    return [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]


def is_h(a, b) -> bool:
    return abs(a[1] - b[1]) <= AXIS_TOL and abs(a[0] - b[0]) > AXIS_TOL


def is_v(a, b) -> bool:
    return abs(a[0] - b[0]) <= AXIS_TOL and abs(a[1] - b[1]) > AXIS_TOL


def gap_to_box(a, b, box: dict) -> float:
    minx, maxx = min(a[0], b[0]), max(a[0], b[0])
    miny, maxy = min(a[1], b[1]), max(a[1], b[1])
    dx = max(box["x"] - maxx, minx - (box["x"] + box["w"]), 0)
    dy = max(box["y"] - maxy, miny - (box["y"] + box["h"]), 0)
    return max(dx, dy)


def trim(route, length: float, at_start: bool) -> list[list[float]]:
    pts = [list(map(float, p)) for p in (route if at_start else list(route)[::-1])]
    left = length
    while len(pts) > 1 and left > 0:
        (ax, ay), (bx, by) = pts[0], pts[1]
        seg = abs(bx - ax) + abs(by - ay)
        if seg <= left:
            pts.pop(0)
            left -= seg
            continue
        f = left / seg
        pts[0] = [ax + (bx - ax) * f, ay + (by - ay) * f]
        left = 0
    return pts if at_start else pts[::-1]


def same_points(a, b, tol: float = PX_TOL) -> bool:
    a, b = list(a), list(b)
    return len(a) == len(b) and all(abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol for p, q in zip(a, b))


def same_route(a, b, tol: float = PX_TOL) -> bool:
    return same_points(a, b, tol) or same_points(norm(a), norm(b), tol)


def check_route_rules(page: dict, blocked: set[str] = frozenset(), minimum: int | None = None) -> None:
    by_id = {s["id"]: s for s in page["shapes"]}
    visible_layers = {l["id"] for l in page["layers"] if l["visible"]}
    shown = [c for c in page["connectors"] if c["layer"] in visible_layers
             and by_id[c["from"]["shape"]]["layer"] in visible_layers and by_id[c["to"]["shape"]]["layer"] in visible_layers]
    for c in shown:
        route = c["route"]
        src, dst = by_id[c["from"]["shape"]], by_id[c["to"]["shape"]]
        start, end = port_at(src, c["from"]["port"]), port_at(dst, c["to"]["port"])
        assert abs(route[0][0] - start[0]) <= PX_TOL and abs(route[0][1] - start[1]) <= PX_TOL, (c["id"], route, start)
        assert abs(route[-1][0] - end[0]) <= PX_TOL and abs(route[-1][1] - end[1]) <= PX_TOL, (c["id"], route, end)
        for a, b in segs(route):
            assert abs(a[0] - b[0]) <= AXIS_TOL or abs(a[1] - b[1]) <= AXIS_TOL, (c["id"], a, b)
        if c["id"] in blocked:
            continue
        for s in page["shapes"]:
            if s["id"] in (src["id"], dst["id"]) or s["layer"] not in visible_layers:
                continue
            for a, b in segs(route):
                assert gap_to_box(a, b, s) >= CLEARANCE_MIN, (c["id"], "too close to", s["label"], a, b)
        if minimum is not None:
            assert bends(route) == minimum, (c["id"], route, minimum)
    for i, a in enumerate(shown):
        for b in shown[i + 1:]:
            if a["id"] in blocked or b["id"] in blocked:
                continue
            ra, rb = [list(p) for p in a["route"]], [list(p) for p in b["route"]]
            for ea, sa in (("from", True), ("to", False)):
                for eb, sb in (("from", True), ("to", False)):
                    if a[ea] == b[eb]:
                        ra, rb = trim(ra, SHARED_PORT_RUN, sa), trim(rb, SHARED_PORT_RUN, sb)
            for p, q in segs(ra):
                for r, s in segs(rb):
                    if is_h(p, q) and is_h(r, s):
                        overlap = min(max(p[0], q[0]), max(r[0], s[0])) - max(min(p[0], q[0]), min(r[0], s[0]))
                        assert not (overlap > SPAN_OVERLAP and abs(p[1] - r[1]) < SEPARATION_MIN), (a["id"], b["id"], p, q, r, s)
                    if is_v(p, q) and is_v(r, s):
                        overlap = min(max(p[1], q[1]), max(r[1], s[1])) - max(min(p[1], q[1]), min(r[1], s[1]))
                        assert not (overlap > SPAN_OVERLAP and abs(p[0] - r[0]) < SEPARATION_MIN), (a["id"], b["id"], p, q, r, s)


def label_anchor(route) -> tuple[float, float]:
    best, mid = -1.0, (0.0, 0.0)
    for a, b in segs(route):
        length = abs(b[0] - a[0]) + abs(b[1] - a[1])
        if length > best:
            best, mid = length, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return mid


def unit_boxes(page: dict, sids: list[str]) -> list[dict]:
    by_id = {s["id"]: s for s in page["shapes"]}
    seen: set[str] = set()
    units = []
    for sid in sids:
        if sid in seen:
            continue
        gid = by_id[sid]["group"]
        members = next(g["members"] for g in page["groups"] if g["id"] == gid) if gid else [sid]
        seen.update(members)
        xs = [by_id[m]["x"] for m in members]
        ys = [by_id[m]["y"] for m in members]
        x2 = [by_id[m]["x"] + by_id[m]["w"] for m in members]
        y2 = [by_id[m]["y"] + by_id[m]["h"] for m in members]
        units.append({"members": members, "x": min(xs), "y": min(ys), "w": max(x2) - min(xs), "h": max(y2) - min(ys), "low": min(members)})
    return units


def apply_offsets(page: dict, offsets: list[tuple[dict, int, int]]) -> dict[str, tuple[int, int]]:
    by_id = {s["id"]: s for s in page["shapes"]}
    return {m: (by_id[m]["x"] + dx, by_id[m]["y"] + dy) for unit, dx, dy in offsets for m in unit["members"]}


def align_expected(page: dict, sids: list[str], side: str) -> dict[str, tuple[int, int]]:
    units = unit_boxes(page, sids)
    left = min(u["x"] for u in units)
    top = min(u["y"] for u in units)
    right = max(u["x"] + u["w"] for u in units)
    bottom = max(u["y"] + u["h"] for u in units)
    offsets = []
    for u in units:
        dx = dy = 0
        if side == "left":
            dx = left - u["x"]
        elif side == "centre":
            dx = math.floor((left + right) / 2 - u["w"] / 2) - u["x"]
        elif side == "right":
            dx = right - u["w"] - u["x"]
        elif side == "top":
            dy = top - u["y"]
        elif side == "middle":
            dy = math.floor((top + bottom) / 2 - u["h"] / 2) - u["y"]
        elif side == "bottom":
            dy = bottom - u["h"] - u["y"]
        offsets.append((u, dx, dy))
    return apply_offsets(page, offsets)


def distribute_expected(page: dict, sids: list[str], horizontal: bool) -> dict[str, tuple[int, int]]:
    units = unit_boxes(page, sids)
    pos, size = ("x", "w") if horizontal else ("y", "h")
    units.sort(key=lambda u: (u[pos] + u[size] / 2, u["low"]))
    first, last = units[0], units[-1]
    inner = sum(u[size] for u in units[1:-1])
    gap = (last[pos] - (first[pos] + first[size]) - inner) / (len(units) - 1)
    offsets = [(first, 0, 0), (last, 0, 0)]
    cursor = first[pos] + first[size]
    for u in units[1:-1]:
        target = math.floor(cursor + gap)
        offsets.append((u, target - u[pos], 0) if horizontal else (u, 0, target - u[pos]))
        cursor = target + u[size]
    return apply_offsets(page, offsets)


LOG_JS = r"""
(() => {
  if (window.__lwLog) return;
  window.__lwLog = true;
  const KEY = '__lw_heard';
  const push = (value) => {
    const t = (value || '').trim();
    if (!t) return;
    const list = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    list.push(t);
    sessionStorage.setItem(KEY, JSON.stringify(list));
  };
  window.__lwAttrs = [];
  const note = (el, name) => window.__lwAttrs.push({id: el.id, name, value: el.getAttribute(name)});
  const watched = ['data-settling', 'data-motion', 'data-progress'];
  const observer = new MutationObserver((records) => {
    const host = document.getElementById('announcer');
    for (const r of records) {
      if (r.type === 'attributes') { note(r.target, r.attributeName); continue; }
      if (r.type === 'childList') {
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          for (const el of [n, ...n.querySelectorAll('[data-settling]')]) {
            if (el.hasAttribute && el.hasAttribute('data-settling')) note(el, 'data-settling');
          }
        });
      }
      if (!host) continue;
      if (r.type === 'characterData' && host.contains(r.target)) push(r.target.data);
      if (r.type === 'childList' && host.contains(r.target)) r.addedNodes.forEach((n) => push(n.textContent));
    }
  });
  const start = () => observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: watched});
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, {once: true});
})();
"""

FOCUS_JS = """() => {
  const a = document.activeElement;
  if (!a || a === document.body) return {body: true, shape: null, inCanvas: false};
  let el = a;
  const ad = a.getAttribute && a.getAttribute('aria-activedescendant');
  if (ad && document.getElementById(ad)) el = document.getElementById(ad);
  const s = el.closest && el.closest('[id^="shape-"]');
  const canvas = document.getElementById('canvas');
  return {body: false, shape: s ? s.id.slice(6) : null, inCanvas: !!(canvas && (canvas === a || canvas.contains(a)))};
}"""

WS_JS = """(path) => new Promise((resolve) => {
  window.__lwClose = null;
  const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + path);
  window.__lwSocket = ws;
  ws.onopen = () => resolve('open');
  ws.onclose = (e) => { window.__lwClose = e.code; resolve('closed'); };
})"""


def poll(pages, predicate: Callable[[], Any], seconds: float, what: str) -> Any:
    if isinstance(pages, Page):
        pages = [pages]
    deadline = time.monotonic() + seconds
    error: Exception | None = None
    while True:
        try:
            value = predicate()
            if value:
                return value
        except Exception as exc:
            error = exc
        if time.monotonic() >= deadline:
            raise AssertionError(f"{what}: not observed within {seconds} s (last error: {error})")
        if pages:
            for p in pages:
                advance(p, STEP_MS)
        else:
            WAIT.wait(POLL_S)


def install_logs(pg: Page) -> None:
    pg.add_init_script(LOG_JS)
    pg.evaluate(LOG_JS)


def heard(pg: Page) -> list[str]:
    return pg.evaluate("() => JSON.parse(sessionStorage.getItem('__lw_heard') || '[]')")


def attr_log(pg: Page) -> list[dict]:
    return pg.evaluate("() => window.__lwAttrs || []")


def clear_attr_log(pg: Page) -> None:
    pg.evaluate("() => { if (window.__lwAttrs) window.__lwAttrs.length = 0; }")


def wait_heard(pg: Page, phrase: str, seconds: float = LIVE_S + SLACK_S) -> None:
    poll(pg, lambda: phrase in heard(pg), seconds, f"announcement {phrase!r}")


def key(pg: Page, combo: str, times: int = 1) -> None:
    for _ in range(times):
        pg.keyboard.press(combo)
        advance(pg, STEP_MS)


def visible(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def gone(loc: Locator) -> bool:
    return loc.count() == 0 or not loc.first.is_visible()


def sign_in_form(pg: Page, who: Person, password: str | None = None) -> None:
    email = pg.get_by_role("textbox", name="Email")
    poll(pg, lambda: visible(email), BOOT_S, "sign-in form")
    fill(email, who.email)
    fill(pg.get_by_label("Password", exact=True), password or who.password)
    click(pg.get_by_role("button", name="Sign in"))
    advance(pg, STEP_MS)


def wait_canvas(pg: Page, did: str) -> None:
    poll(pg, lambda: urlparse(pg.url).path == f"/d/{did}" and visible(published(pg, "canvas")), BOOT_S, "workspace canvas")


@contextmanager
def workspace(browser: Browser, base: str, who: Person, did: str, *, viewport: dict = DESKTOP, reduced: bool = False,
              page_id: str | None = None, touch: bool = False) -> Iterator[Page]:
    path = f"/d/{did}" + (f"?page={page_id}" if page_id else "")
    url = f"{base}/signin?next={quote(path, safe='')}"
    with open_app(browser, url, reduced_motion="reduce" if reduced else "no-preference") as pg:
        pg.set_viewport_size(viewport)
        install_logs(pg)
        if touch:
            enable_touch(pg)
        sign_in_form(pg, who)
        wait_canvas(pg, did)
        reset_view(pg)
        yield pg


def reload(pg: Page, did: str) -> None:
    pg.reload()
    pg.evaluate(LOG_JS)
    wait_canvas(pg, did)
    reset_view(pg)


def shape_el(pg: Page, sid: str) -> Locator:
    return pg.locator(f"#shape-{sid}")


def conn_el(pg: Page, cid: str) -> Locator:
    return pg.locator(f"#connector-{cid}")


def data_box(pg: Page, sid: str) -> dict[str, int]:
    return shape_el(pg, sid).evaluate(
        "el => ({x: +el.getAttribute('data-x'), y: +el.getAttribute('data-y'), w: +el.getAttribute('data-w'), h: +el.getAttribute('data-h')})")


def data_points(pg: Page, cid: str) -> list[tuple[float, float]]:
    raw = conn_el(pg, cid).get_attribute("data-points") or ""
    return [tuple(float(v) for v in pair.split(",")) for pair in raw.split()]


def canvas_box(pg: Page) -> dict:
    return published(pg, "canvas").bounding_box()


VIEW_ORIGIN_JS = """() => {
  const c = document.getElementById('canvas').getBoundingClientRect();
  const s = document.querySelector('#canvas [id^="shape-"]');
  if (!s) return [0, 0];
  const r = s.getBoundingClientRect();
  const cx = +s.getAttribute('data-x') + +s.getAttribute('data-w') / 2;
  const cy = +s.getAttribute('data-y') + +s.getAttribute('data-h') / 2;
  return [cx - (r.left + r.width / 2 - c.left), cy - (r.top + r.height / 2 - c.top)];
}"""


def reset_view(pg: Page) -> None:
    click(pg.get_by_role("group", name="View").get_by_role("button", name="Reset zoom"))
    advance(pg, STEP_MS)


def view_origin(pg: Page) -> tuple[float, float]:
    ox, oy = pg.evaluate(VIEW_ORIGIN_JS)
    return float(ox), float(oy)


def screen(pg: Page, x: float, y: float) -> tuple[float, float]:
    box = canvas_box(pg)
    ox, oy = view_origin(pg)
    return box["x"] + x - ox, box["y"] + y - oy


def outside_announcer(pg: Page, copy: str) -> int:
    loc = pg.get_by_text(copy, exact=True)
    return sum(1 for i in range(loc.count())
               if loc.nth(i).is_visible() and loc.nth(i).evaluate("el => !el.closest('#announcer')"))


def focus_state(pg: Page) -> dict:
    return pg.evaluate(FOCUS_JS)


def tab_to_canvas(pg: Page) -> dict:
    for _ in range(TAB_LIMIT):
        pg.keyboard.press("Tab")
        advance(pg, STEP_MS)
        state = focus_state(pg)
        if state["inCanvas"]:
            return state
    raise AssertionError("Tab never reached the canvas")


def type_into(pg: Page, loc: Locator, value: str) -> None:
    click(loc)
    pg.keyboard.press("Control+KeyA")
    pg.keyboard.type(value)
    advance(pg, STEP_MS)


def shift_click(pg: Page, loc: Locator) -> None:
    pg.keyboard.down("Shift")
    click(loc)
    pg.keyboard.up("Shift")
    advance(pg, STEP_MS)


def spin(pg: Page, name: str) -> Locator:
    return pg.get_by_role("spinbutton", name=name, exact=True)


def status_text(pg: Page) -> str:
    loc = pg.get_by_role("status", name="Connection")
    return loc.inner_text() if loc.count() else ""


def moved_notice(label: str, n: int) -> str:
    return f"Moved {label}. 1 connector rerouted." if n == 1 else f"Moved {label}. {n} connectors rerouted."


def waiting(n: int) -> str:
    return "1 change waiting to save." if n == 1 else f"{n} changes waiting to save."


def published(pg: Page, ident: str) -> Locator:
    return pg.locator(f"#{ident}")


def port_dots(pg: Page) -> Locator:
    cls = "port-dot"
    return pg.locator(f"circle.{cls}")


def connector_label(conn: Locator) -> Locator:
    cls = "connector-label"
    return conn.locator(f"text.{cls}")


def connector_path(conn: Locator) -> Locator:
    tag = "path"
    return conn.locator(tag)


def selected(n: int) -> str:
    return f"{n} selected"


def group_name(n: int) -> str:
    return f"Group of {n} shapes"


def reorder_notice(name: str, n: int, total: int) -> str:
    return f"Moved {name} to position {n} of {total}."


def strip_text(name: str, n: int, total: int) -> str:
    return f"{name} · {n} of {total}"


def connector_name(src: str, dst: str, blocked: bool = False) -> str:
    name = f"Connector from {src} to {dst}"
    return f"{name}, blocked" if blocked else name


def connected_notice(src: str, dst: str) -> str:
    return f"Connected {src} to {dst}."


def range_message(low: int, high: int) -> str:
    return f"Enter a whole number from {low} to {high}."


def hide_toggle(layer: str) -> str:
    return f"Hide layer {layer}"


def show_toggle(layer: str) -> str:
    return f"Show layer {layer}"


def lock_toggle(layer: str) -> str:
    return f"Lock layer {layer}"


def unlock_toggle(layer: str) -> str:
    return f"Unlock layer {layer}"


def counted(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def listed(labels: list[str]) -> str:
    return labels[0] if len(labels) == 1 else f"{', '.join(labels[:-1])} and {labels[-1]}"


def outline_page(name: str, shapes: int, connectors: int) -> str:
    return f"{name}, {counted(shapes, 'shape')}, {counted(connectors, 'connector')}"


def outline_layer(name: str, shapes: int, locked: bool = False) -> str:
    return f"{name} layer, locked, {counted(shapes, 'shape')}" if locked else f"{name} layer, {counted(shapes, 'shape')}"


def outline_shape(label: str, kind: str, targets=(), sources=()) -> str:
    parts = [label, kind]
    if targets:
        parts.append(f"connected to {listed(list(targets))}")
    if sources:
        parts.append(f"connected from {listed(list(sources))}")
    if not targets and not sources:
        parts.append("not connected")
    return ", ".join(parts)


def is_id(value: str, prefix: str) -> bool:
    rest = value[len(prefix):]
    return value.startswith(prefix) and len(rest) == ID_LEN and all(ch in string.ascii_lowercase + string.digits for ch in rest)


_cdp: dict[int, Any] = {}


def cdp(pg: Page):
    if id(pg) not in _cdp:
        _cdp[id(pg)] = session(pg)
    return _cdp[id(pg)]


def enable_touch(pg: Page) -> None:
    cdp(pg).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})


def touch(pg: Page, kind: str, points: list[tuple[float, float]]) -> None:
    cdp(pg).send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i + 1} for i, (x, y) in enumerate(points)]})


def touch_path(pg: Page, starts: list[tuple[float, float]], ends: list[tuple[float, float]], steps: int = 6) -> None:
    touch(pg, "touchStart", starts)
    advance(pg, FRAME_MS)
    for i in range(1, steps + 1):
        pts = [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for a, b in zip(starts, ends)]
        touch(pg, "touchMove", pts)
        advance(pg, FRAME_MS)
    touch(pg, "touchEnd", [])
    advance(pg, STEP_MS)


def rect(loc: Locator) -> dict:
    return loc.evaluate("el => { const r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }")


def overlaps(a: dict, b: dict) -> bool:
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def hit_testable(loc: Locator) -> bool:
    return loc.evaluate("el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === el || el.contains(h)); }")


def assert_menu_placement(pg: Page, menu: Locator) -> None:
    vp = pg.viewport_size
    box = rect(menu)
    assert box["x"] >= 0 and box["y"] >= 0, box
    assert box["x"] + box["w"] <= vp["width"] + PX_TOL and box["y"] + box["h"] <= vp["height"] + PX_TOL, box
    for cover in (published(pg, "bottom-toolbar"), published(pg, "page-strip"), pg.get_by_role("group", name="View")):
        if visible(cover):
            assert not overlaps(box, rect(cover.first)), "menu covered by a fixed bar"
    items = menu.get_by_role("menuitem")
    assert items.count() > 0
    for i in range(items.count()):
        assert hit_testable(items.nth(i)), f"menu item {i} is not hit-testable"


def assert_focus_wraps(pg: Page, container: Locator) -> None:
    mark = "() => { const a = document.activeElement; if (!a.__lwMark) a.__lwMark = (window.__lwN = (window.__lwN || 0) + 1); return a.__lwMark; }"
    inside = "el => el.contains(document.activeElement)"
    poll(pg, lambda: container.evaluate(inside), LIVE_S + SLACK_S, "focus moved inside")
    for combo in ("Tab", "Shift+Tab"):
        seen = [pg.evaluate(mark)]
        for _ in range(TAB_LIMIT):
            key(pg, combo)
            assert container.evaluate(inside), f"{combo} left the container"
            m = pg.evaluate(mark)
            if m in seen:
                break
            seen.append(m)
        else:
            raise AssertionError(f"{combo} never wrapped")


def request_export(c: httpx.Client, did: str, pid: str, fmt: str = "svg", scale: int = 1, background: str = "white") -> httpx.Response:
    return c.post(f"/api/diagrams/{did}/exports", json={"page": pid, "format": fmt, "scale": scale, "background": background})


def export_body(c: httpx.Client, xid: str) -> dict:
    r = c.get(f"/api/exports/{xid}")
    assert r.status_code == 200, r.text
    return r.json()


def wait_export(c: httpx.Client, xid: str, status: str, seconds: float = STORAGE_WAIT_S + WORK_S) -> dict:
    return until_http(lambda: (b := export_body(c, xid))["status"] == status and b, seconds, f"export {xid} {status}")


def ready_export(c: httpx.Client, did: str, pid: str, fmt: str = "svg", scale: int = 1, background: str = "white") -> tuple[dict, httpx.Response]:
    r = request_export(c, did, pid, fmt, scale, background)
    assert r.status_code in (200, 202), r.text
    body = wait_export(c, r.json()["id"], "ready")
    f = c.get(f"/api/exports/{body['id']}/file")
    assert f.status_code == 200, f.text
    return body, f


def path_points(d: str) -> list[tuple[float, float]]:
    toks = re.findall(r"[MLHVZmlhvz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", d)
    pts: list[tuple[float, float]] = []
    cmd, i, cx, cy = "M", 0, 0.0, 0.0
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            continue
        if cmd in "MLml":
            x, y = float(toks[i]), float(toks[i + 1])
            i += 2
            if cmd.islower():
                x, y = x + cx, y + cy
            cx, cy = x, y
        elif cmd in "Hh":
            cx = float(t) + (cx if cmd == "h" else 0)
            i += 1
        elif cmd in "Vv":
            cy = float(t) + (cy if cmd == "v" else 0)
            i += 1
        else:
            i += 1
            continue
        pts.append((cx, cy))
    return pts


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def svg_ids(root: ET.Element) -> dict[str, ET.Element]:
    return {el.get("id"): el for el in root.iter() if el.get("id")}


def svg_route(group: ET.Element) -> list[tuple[float, float]]:
    if group.get("data-points"):
        return [tuple(float(v) for v in p.split(",")) for p in group.get("data-points").split()]
    for el in group.iter():
        if local(el.tag) in ("polyline", "polygon") and el.get("points"):
            nums = [float(v) for v in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)", el.get("points"))]
            return list(zip(nums[::2], nums[1::2]))
        if local(el.tag) == "path" and el.get("d"):
            return path_points(el.get("d"))
    return []


def texts_in(el: ET.Element) -> list[str]:
    return ["".join(t.itertext()) for t in el.iter() if local(t.tag) == "text"]


def expected_view_box(page: dict) -> tuple[float, float, float, float]:
    visible_layers = {l["id"] for l in page["layers"] if l["visible"]}
    by_id = {s["id"]: s for s in page["shapes"]}
    xs, ys = [], []
    for s in page["shapes"]:
        if s["layer"] in visible_layers:
            xs += [s["x"], s["x"] + s["w"]]
            ys += [s["y"], s["y"] + s["h"]]
    for c in page["connectors"]:
        if c["layer"] in visible_layers and by_id[c["from"]["shape"]]["layer"] in visible_layers and by_id[c["to"]["shape"]]["layer"] in visible_layers:
            xs += [p[0] for p in c["route"]]
            ys += [p[1] for p in c["route"]]
    return min(xs) - EXPORT_PAD, min(ys) - EXPORT_PAD, max(xs) - min(xs) + 2 * EXPORT_PAD, max(ys) - min(ys) + 2 * EXPORT_PAD


def png_header(data: bytes) -> tuple[int, int, int, bytes]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "PNG signature"
    width, height = struct.unpack(">II", data[16:24])
    return width, height, data[25], data


def mail_for(mail, address: str, expected: int, seconds: float = WORK_S) -> list[dict]:
    def matching() -> list[dict]:
        return [m for m in mail.messages(settle=0) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
    if expected:
        poll([], lambda: len(matching()) >= expected, seconds, f"{expected} message(s) to {address}")
    mail.messages(settle=MAIL_SETTLE_S)
    return matching()


def sole_recipient(m: dict, address: str) -> None:
    assert [a.lower() for a in addresses(m.get("To"))] == [address.lower()]
    extra = [a for k in ("Cc", "Bcc") for a in addresses(m.get(k) or [])]
    assert not extra
    assert "\n" not in m.get("Subject", "") and "\r" not in m.get("Subject", "")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def app_copy(env: dict[str, str]) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    full = {**os.environ, "APP_PUBLIC_URL": base, **env, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+", prefix="linewell-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=full, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text()[-4000:]

    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while True:
            if proc.poll() is not None:
                raise AssertionError(f"copy exited with {proc.returncode}: {tail()}")
            try:
                if httpx.get(f"{base}/api/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if time.monotonic() > deadline:
                raise AssertionError(f"copy never became healthy: {tail()}")
            WAIT.wait(POLL_S)
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)


class Relay:

    def __init__(self, port: int, target: tuple[str, int]):
        self.port, self.target, self.sock = port, target, None

    def _pipe(self, a: socket.socket, b: socket.socket) -> None:
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def _serve(self) -> None:
        while True:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            upstream = socket.create_connection(self.target)
            threading.Thread(target=self._pipe, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pipe, args=(upstream, client), daemon=True).start()

    def start(self) -> None:
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen()
        threading.Thread(target=self._serve, daemon=True).start()

    def stop(self) -> None:
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.sock.close()


class BlackHole:

    def __init__(self, port: int):
        self.port, self.sock, self.held = port, None, []

    def _serve(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.held.append(conn)

    def start(self) -> None:
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen()
        threading.Thread(target=self._serve, daemon=True).start()

    def stop(self) -> None:
        for conn in self.held:
            try:
                conn.close()
            except OSError:
                pass
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.sock.close()


def together(jobs: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(jobs))

    def run(job):
        barrier.wait()
        return job()

    with concurrent.futures.ThreadPoolExecutor(len(jobs)) as pool:
        return list(pool.map(run, jobs))


def history_time(iso: str) -> str:
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    return f"{t.day} {t.strftime('%b')} {t.year}, {t:%H:%M} UTC"


def test_wf_drag_snap_align_select(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Intake", 40, 120), S("Review", 440, 120), S("Log", 40, 320), S("Skew", 301, 323, 160, 80)])])])
    intake_id, review_id, log_id = (d.sid(n) for n in ("Intake", "Review", "Log"))
    with workspace(browser, app_url, ada, d.did) as pg:
        heading = published(pg, "inspector-heading")
        intake, review = shape_el(pg, intake_id), shape_el(pg, review_id)
        click(intake)
        advance(pg, STEP_MS)
        assert heading.inner_text().strip() == "Intake"
        shift_click(pg, review)
        assert heading.inner_text().strip() == selected(2)
        shift_click(pg, review)
        assert heading.inner_text().strip() == "Intake"
        pg.mouse.click(*screen(pg, 300, 260))
        advance(pg, STEP_MS)
        assert heading.inner_text().strip() == "Nothing selected"
        pg.mouse.move(*screen(pg, 20, 100))
        pg.mouse.down()
        for i in range(1, 5):
            pg.mouse.move(*screen(pg, 20 + 560 * i / 4, 100 + 100 * i / 4))
            advance(pg, FRAME_MS)
        pg.mouse.up()
        advance(pg, STEP_MS)
        assert heading.inner_text().strip() == selected(2)
        assert intake.get_attribute("data-selected") == "true" and review.get_attribute("data-selected") == "true"
        assert shape_el(pg, log_id).get_attribute("data-selected") != "true"
        key(pg, "Control+KeyA")
        assert heading.inner_text().strip() == selected(4)


def test_wf_drag_snap_align_drag(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Intake", 40, 120), S("Review", 440, 120), S("Log", 40, 320), S("Skew", 301, 323, 160, 80)])])])
    api = login(app_url, ada)
    intake_id, log_id, skew_id = (d.sid(n) for n in ("Intake", "Log", "Skew"))
    with workspace(browser, app_url, ada, d.did) as pg:
        intake = shape_el(pg, intake_id)
        start = get_doc(api, d.did)
        intake0, log0, skew0 = (shape(start, s) for s in (intake_id, log_id, skew_id))

        click(intake)
        advance(pg, STEP_MS)
        cx, cy = center(intake)
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        for i in range(1, 5):
            pg.mouse.move(cx + DRAG_DX * i / 4, cy + DRAG_DY * i / 4)
            advance(pg, FRAME_MS)
            box = data_box(pg, intake_id)
            assert box["x"] % GRID == 0 and box["y"] % GRID == 0, box

        pg.mouse.up()
        advance(pg, STEP_MS)
        want = (snap(intake0["x"] + DRAG_DX), snap(intake0["y"] + DRAG_DY))
        poll(pg, lambda: (shape(get_doc(api, d.did), intake_id)["x"], shape(get_doc(api, d.did), intake_id)["y"]) == want, WORK_S, "snapped drop saved")
        assert (data_box(pg, intake_id)["x"], data_box(pg, intake_id)["y"]) == want

        log = shape_el(pg, log_id)
        click(log)
        advance(pg, STEP_MS)
        lx, ly = center(log)
        pg.keyboard.down("Alt")
        pg.mouse.move(lx, ly)
        pg.mouse.down()
        for i in range(1, 5):
            pg.mouse.move(lx + DRAG_DX * i / 4, ly + DRAG_DY * i / 4)
            advance(pg, FRAME_MS)

        pg.mouse.up()
        pg.keyboard.up("Alt")
        advance(pg, STEP_MS)
        poll(pg, lambda: (shape(get_doc(api, d.did), log_id)["x"], shape(get_doc(api, d.did), log_id)["y"]) == (log0["x"] + DRAG_DX, log0["y"] + DRAG_DY), WORK_S, "Alt drop saved unsnapped")

        click(shape_el(pg, skew_id))
        advance(pg, STEP_MS)
        right, bottom = skew0["x"] + skew0["w"], skew0["y"] + skew0["h"]
        corner = screen(pg, right, bottom)
        pg.mouse.move(*corner)
        pg.mouse.down()
        for i in range(1, 5):
            pg.mouse.move(corner[0] + RESIZE_DX * i / 4, corner[1] + RESIZE_DY * i / 4)
            advance(pg, FRAME_MS)

        pg.mouse.up()
        advance(pg, STEP_MS)
        want_box = {"x": skew0["x"], "y": skew0["y"], "w": snap(right + RESIZE_DX) - skew0["x"], "h": snap(bottom + RESIZE_DY) - skew0["y"]}
        poll(pg, lambda: {k: shape(get_doc(api, d.did), skew_id)[k] for k in "xywh"} == want_box, WORK_S, "resize saved")
        assert data_box(pg, skew_id) == want_box


def test_wf_drag_snap_align_live_inspector(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a = login(app_url, ada)
    intake = d.sid("Intake")
    with workspace(browser, app_url, bea, d.did) as pg:
        click(shape_el(pg, intake))
        advance(pg, STEP_MS)
        cx, cy = center(shape_el(pg, intake))
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        for i in range(1, 5):
            pg.mouse.move(cx + DRAG_DX * i / 4, cy + DRAG_DY * i / 4)
            advance(pg, FRAME_MS)
            box = data_box(pg, intake)
            assert (spin(pg, "X").input_value(), spin(pg, "Y").input_value()) == (str(box["x"]), str(box["y"])), box
        pg.mouse.up()
        advance(pg, STEP_MS)
        poll(pg, lambda: shape(get_doc(a, d.did), intake)["x"] == snap(40 + DRAG_DX), WORK_S, "Bea's drop saved")
        width = spin(pg, "Width")
        draft = str(INSERT_W)
        type_into(pg, width, draft[:-1])
        remote_x = 200
        accept(a, d.did, move(intake, x=remote_x, w=INSERT_H))
        poll(pg, lambda: spin(pg, "X").input_value() == str(remote_x), LIVE_S + SLACK_S, "remote X in inspector")
        assert width.input_value() == draft[:-1], "focused draft kept"
        pg.keyboard.type(draft[-1:])
        key(pg, "Enter")
        poll(pg, lambda: shape(get_doc(a, d.did), intake)["w"] == INSERT_W, WORK_S, "draft committed")
        doc = get_doc(a, d.did)
        assert shape(doc, intake)["x"] == remote_x, "field-level merge keeps Ada's x"
        height = spin(pg, "Height")
        type_into(pg, height, draft)
        accept(a, d.did, move(intake, h=INSERT_H))
        poll(pg, lambda: data_box(pg, intake)["h"] == INSERT_H, LIVE_S + SLACK_S, "remote height on canvas")
        assert height.input_value() == draft
        key(pg, "Escape")
        assert height.input_value() == str(INSERT_H), "Escape shows the latest value"
        assert shape(get_doc(a, d.did), intake)["h"] == INSERT_H


def test_wf_drag_snap_align_published_keys(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    intake, layer = d.sid("Intake"), d.lid("Base")
    cases = [
        ("op.set.route", {"kind": "update_shape", "shape": intake, "set": {"x": 64, "route": [[0, 0], [1, 1]]}}),
        ("op.set.z", {"kind": "update_shape", "shape": intake, "set": {"z": 9}}),
        ("op.set.group", {"kind": "update_shape", "shape": intake, "set": {"group": None}}),
        ("op.shape.id", {"kind": "add_shape", "page": d.pid(), "layer": layer, "clientRef": "probe-ref",
                         "shape": {"kind": "rectangle", "x": 0, "y": 0, "w": 40, "h": 40, "label": "", "id": "s_aaaaaaaaaaaa"}}),
        ("op.shapes.0.set.seq", {"kind": "update_shapes", "shapes": [{"shape": intake, "set": {"x": 64, "seq": 1}}]}),
    ]
    before = get_doc(a, d.did)
    for path, op in cases:
        body = assert_error(send(a, d.did, op), 422, "invalid")
        assert path in body["error"]["fields"], (path, body)
    assert get_doc(a, d.did) == before, "nothing changed and seq unchanged"
    with workspace(browser, app_url, ada, d.did) as pg:
        click(shape_el(pg, intake))
        advance(pg, STEP_MS)
        for field, value, message in (("Width", "10", range_message(SIZE_MIN, SIZE_MAX)),
                                      ("Height", str(SIZE_MAX + 1), range_message(SIZE_MIN, SIZE_MAX)),
                                      ("X", "12.5", range_message(-COORD_MAX, COORD_MAX))):
            loc = spin(pg, field)
            type_into(pg, loc, value)
            key(pg, "Enter")
            assert loc.get_attribute("aria-invalid") == "true"
            assert outside_announcer(pg, message) >= 1, "message shown under the field"
            assert message in heard(pg)
            assert loc.input_value() == value, "draft stays"
            key(pg, "Escape")
            assert loc.get_attribute("aria-invalid") != "true"
            assert outside_announcer(pg, message) == 0
        assert spin(pg, "X").input_value() == str(shape(before, intake)["x"])
        assert get_doc(a, d.did)["seq"] == before["seq"], "nothing sent"


def test_align_distribute(browser, app_url):
    ada, = cast("ada")
    shapes = [S("Alpha", 24, 140), S("Beta", 240, 300, 80, 48), S("Gamma", 440, 220), S("Delta", 480, 320, 64, 40)]
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=shapes, groups=[("Gamma", "Delta")])])])
    a = login(app_url, ada)
    ids = [d.sid(s["label"]) for s in shapes]
    with workspace(browser, app_url, ada, d.did) as pg:
        click(shape_el(pg, ids[0]))
        key(pg, "Control+KeyA")
        steps = [
            ("Alt+Shift+KeyH", None, lambda page: distribute_expected(page, ids, True), "Distributed 4 shapes."),
            ("Alt+Shift+KeyL", None, lambda page: align_expected(page, ids, "left"), "Aligned 4 shapes left."),
            (None, "Align bottom", lambda page: align_expected(page, ids, "bottom"), "Aligned 4 shapes bottom."),
        ]
        for combo, item, expected_of, notice in steps:
            before = get_doc(a, d.did)
            want = expected_of(page_doc(before, d.pid()))
            if combo:
                key(pg, combo)
            else:
                click(pg.get_by_role("toolbar", name="Tools").get_by_role("button", name="Align"))
                advance(pg, STEP_MS)
                click(pg.get_by_role("menu", name="Align").get_by_role("menuitem", name=item))
                advance(pg, STEP_MS)
            after = poll(pg, lambda: (doc := get_doc(a, d.did))["seq"] > before["seq"] and doc, WORK_S, notice)
            assert after["seq"] == before["seq"] + 1, "one operation"
            for sid, (x, y) in want.items():
                s = shape(after, sid)
                assert abs(s["x"] - x) <= PX_TOL and abs(s["y"] - y) <= PX_TOL, (notice, s, x, y)
            wait_heard(pg, notice)


def test_keyboard_nudge(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Alpha", 101, 141), S("Beta", 301, 141), S("Gamma", 101, 301)])])])
    a = login(app_url, ada)
    alpha, beta, gamma = d.sid("Alpha"), d.sid("Beta"), d.sid("Gamma")
    with workspace(browser, app_url, ada, d.did) as pg:
        state = tab_to_canvas(pg)
        assert state["shape"] == alpha
        d0 = get_doc(a, d.did)
        x0 = {s: shape(d0, s)["x"] for s in (alpha, beta, gamma)}
        y0 = shape(d0, alpha)["y"]
        key(pg, "ArrowRight")
        poll(pg, lambda: shape(get_doc(a, d.did), alpha)["x"] == x0[alpha] + NUDGE, WORK_S, "8-unit nudge")
        key(pg, "Shift+ArrowDown")
        poll(pg, lambda: shape(get_doc(a, d.did), alpha)["y"] == y0 + FINE_NUDGE, WORK_S, "1-unit nudge")
        key(pg, "Control+KeyA")
        seq = get_doc(a, d.did)["seq"]
        key(pg, "ArrowLeft")
        doc = poll(pg, lambda: (x := get_doc(a, d.did))["seq"] > seq and x, WORK_S, "selection nudge")
        assert doc["seq"] == seq + 1
        assert [shape(doc, s)["x"] for s in (alpha, beta, gamma)] == [x0[alpha], x0[beta] - NUDGE, x0[gamma] - NUDGE]
        reload(pg, d.did)
        assert data_box(pg, alpha)["x"] == x0[alpha] and data_box(pg, alpha)["y"] == y0 + FINE_NUDGE
        assert data_box(pg, beta)["x"] == x0[beta] - NUDGE


def test_port_bindings(app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(
        shapes=[S("A", 0, 0, 161, 81), S("B", 400, 0), S("Cc", 0, 400), S("Dd", 400, 400, 121, 65)],
        connectors=[C("A", "e", "B", "w"), C("A", "s", "Cc", "n"), C("Cc", "e", "Dd", "w"), C("B", "s", "Dd", "n")])])])
    a = login(app_url, ada)

    def check_ends(doc: dict) -> None:
        page = page_doc(doc, d.pid())
        by_id = {s["id"]: s for s in page["shapes"]}
        for c in page["connectors"]:
            start = port_at(by_id[c["from"]["shape"]], c["from"]["port"])
            end = port_at(by_id[c["to"]["shape"]], c["to"]["port"])
            assert abs(c["route"][0][0] - start[0]) <= PX_TOL and abs(c["route"][0][1] - start[1]) <= PX_TOL, c
            assert abs(c["route"][-1][0] - end[0]) <= PX_TOL and abs(c["route"][-1][1] - end[1]) <= PX_TOL, c

    before = get_doc(a, d.did)
    check_ends(before)
    accept(a, d.did, {"kind": "update_shapes", "shapes": [{"shape": d.sid("A"), "set": {"x": 40, "y": 24}}, {"shape": d.sid("Dd"), "set": {"x": 440, "y": 432}}]})
    after = get_doc(a, d.did)
    check_ends(after)
    for cid in (d.cid("A", "B"), d.cid("Cc", "Dd")):
        assert find(after, "connectors", cid)["from"] == find(before, "connectors", cid)["from"]
        assert find(after, "connectors", cid)["to"] == find(before, "connectors", cid)["to"]
    bad = {"kind": "add_connector", "page": d.pid(), "from": {"shape": d.sid("A"), "port": "ne"}, "to": {"shape": d.sid("B"), "port": "w"}, "label": "", "clientRef": "probe-ref"}
    assert_error(send(a, d.did, bad), 422, "invalid")


def test_orthogonal_routing(browser, app_url):
    ada, = cast("ada")
    walls = [S("WallTop", 392, 360, 176, 36, "Walls"), S("WallBottom", 392, 484, 176, 36, "Walls"),
             S("WallLeft", 360, 360, 36, 160, "Walls"), S("WallRight", 564, 360, 36, 160, "Walls")]
    pages = [
        P("Straight", shapes=[S("A", 0, 120), S("B", 400, 120)], connectors=[C("A", "e", "B", "w")]),
        P("Offset", shapes=[S("A", 0, 120), S("B", 400, 320)], connectors=[C("A", "e", "B", "w")]),
        P("Around", shapes=[S("A", 0, 200), S("O", 240, 200), S("B", 480, 200)], connectors=[C("A", "e", "B", "w")]),
        P("Pair", shapes=[S("S1", 0, 120), S("T1", 480, 240), S("S2", 0, 200), S("T2", 480, 320)],
          connectors=[C("S1", "e", "T1", "w"), C("S2", "e", "T2", "w")]),
        P("Blocked", layers=[L("Base"), L("Walls")], shapes=[S("Start", 0, 400), S("Check", 400, 400, 160, 80), *walls],
          connectors=[C("Start", "e", "Check", "w")]),
    ]
    d, = seed(app_url, [ada], [D(ada, pages=pages)])
    a = login(app_url, ada)
    doc = get_doc(a, d.did)
    for i, minimum in ((0, 0), (1, 2), (2, 4)):
        check_route_rules(page_doc(doc, d.pid(i)), minimum=minimum)
    assert len(norm(page_doc(doc, d.pid(0))["connectors"][0]["route"])) == 2
    assert len(norm(page_doc(doc, d.pid(1))["connectors"][0]["route"])) == 4
    check_route_rules(page_doc(doc, d.pid(3)))
    blocked = d.cid("Start", "Check", 4)
    check_route_rules(page_doc(doc, d.pid(4)), blocked={blocked})
    with workspace(browser, app_url, ada, d.did, page_id=d.pid(4)) as pg:
        poll(pg, lambda: conn_el(pg, blocked).get_attribute("data-blocked") == "true", LIVE_S + SLACK_S, "blocked flag")
        pg.goto(f"{app_url}/d/{d.did}?page={d.pid(2)}")
        wait_canvas(pg, d.did)
        around = d.cid("A", "B", 2)
        poll(pg, lambda: conn_el(pg, around).count() == 1, LIVE_S + SLACK_S, "Around connector drawn")
        assert conn_el(pg, around).get_attribute("data-blocked") is None


def test_server_derived_routes(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a = login(app_url, ada)
    intake = d.sid("Intake")
    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, bea, d.did) as other:
        doc = get_doc(a, d.did)
        for cid, route in routes(doc).items():
            assert same_points(data_points(pg, cid), route), (cid, "Ada")
            assert same_points(data_points(other, cid), route), (cid, "Bea")
        click(shape_el(pg, intake))
        advance(pg, STEP_MS)
        cx, cy = center(shape_el(pg, intake))
        pg.keyboard.down("Alt")
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        for i in range(1, 5):
            pg.mouse.move(cx + DRAG_DX * i / 4, cy + (160 + DRAG_DY) * i / 4)
            advance(pg, FRAME_MS)
        advance(pg, FRAME_MS)
        preview = {cid: data_points(pg, cid) for cid in routes(doc)}
        pg.mouse.up()
        pg.keyboard.up("Alt")
        advance(pg, STEP_MS)
        after = poll(pg, lambda: (x := get_doc(a, d.did))["seq"] > doc["seq"] and x, WORK_S, "Alt drop saved")
        for cid, route in routes(after).items():
            assert same_points(route, preview[cid]), (cid, route, preview[cid])
        poll(other, lambda: all(same_points(data_points(other, cid), r) for cid, r in routes(after).items()), LIVE_S + SLACK_S, "other session routes")
        reload(pg, d.did)
        for cid, route in routes(after).items():
            assert same_points(data_points(pg, cid), route), (cid, "after reload")
    body, f = ready_export(a, d.did, d.pid())
    ids = svg_ids(ET.fromstring(f.content))
    for cid, route in routes(get_doc(a, d.did)).items():
        assert same_route(svg_route(ids[f"connector-{cid}"]), route), (cid, "svg export")


def test_wf_tethered_reroute_drag(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    intake, archive = d.sid("Intake"), d.sid("Archive")
    feeds, log_store = d.cid("Intake", "Review"), d.cid("Log", "Store")
    with workspace(browser, app_url, ada, d.did) as pg:
        before = get_doc(a, d.did)
        click(shape_el(pg, intake))
        advance(pg, STEP_MS)
        cx, cy = center(shape_el(pg, intake))
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        frames = []
        for i in range(1, 5):
            pg.mouse.move(cx, cy + 160 * i / 4)
            advance(pg, FRAME_MS)
            assert port_dots(pg).count() >= 2, "port dots during drag"
            box = data_box(pg, intake)
            pts = data_points(pg, feeds)
            start = port_at(box, "e")
            assert abs(pts[0][0] - start[0]) <= PX_TOL and abs(pts[0][1] - start[1]) <= PX_TOL, (pts, box)
            frames.append(pts)
        assert len({tuple(f) for f in frames}) > 1, "preview redrew while dragging"
        advance(pg, FRAME_MS)
        preview = {cid: data_points(pg, cid) for cid in routes(before)}
        clear_attr_log(pg)
        pg.mouse.up()
        advance(pg, FRAME_MS)
        assert conn_el(pg, feeds).get_attribute("data-settling") == "true"
        assert same_points(data_points(pg, feeds), preview[feeds]), "data-points hold the committed route at once"
        advance(pg, SETTLE_MS + FRAME_MS)
        assert conn_el(pg, feeds).get_attribute("data-settling") is None
        after = poll(pg, lambda: (x := get_doc(a, d.did))["seq"] > before["seq"] and x, WORK_S, "drop saved")
        changed = rerouted(before, after)
        for cid in changed:
            assert same_points(routes(after)[cid], preview[cid]), cid
        wait_heard(pg, moved_notice("Intake", len(changed)))
        label = connector_label(conn_el(pg, feeds))
        assert label.inner_text() == "Pipeline"
        lr = rect(label)
        sx, sy = screen(pg, *label_anchor(routes(after)[feeds]))
        assert abs(lr["x"] + lr["w"] / 2 - sx) <= PX_TOL and abs(lr["y"] + lr["h"] / 2 - sy) <= PX_TOL

        click(shape_el(pg, archive))
        advance(pg, STEP_MS)
        ax, ay = center(shape_el(pg, archive))
        pg.mouse.move(ax, ay)
        pg.mouse.down()
        for i in range(1, 5):
            pg.mouse.move(ax, ay + 280 * i / 4)
            advance(pg, FRAME_MS)
        pg.mouse.up()
        advance(pg, STEP_MS)
        second = poll(pg, lambda: (x := get_doc(a, d.did))["seq"] > after["seq"] and x, WORK_S, "second drop saved")
        changed = rerouted(after, second)
        assert log_store in changed, "unbound connector whose clearance changed is counted"
        wait_heard(pg, moved_notice("Archive", len(changed)))


def test_reduced_motion_reroute(browser, app_url):
    ada, = cast("ada")
    full, calm = seed(app_url, [ada], [D(ada, pages=[pipeline()]), D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    results = []
    for seeded, reduced in ((full, False), (calm, True)):
        intake = seeded.sid("Intake")
        with workspace(browser, app_url, ada, seeded.did, reduced=reduced) as pg:
            before = get_doc(a, seeded.did)
            clear_attr_log(pg)
            click(shape_el(pg, intake))
            key(pg, "ArrowDown")
            after = poll(pg, lambda: (x := get_doc(a, seeded.did))["seq"] > before["seq"] and x, WORK_S, "nudge saved")
            notice = moved_notice("Intake", len(rerouted(before, after)))
            wait_heard(pg, notice)
            if reduced:
                cx, cy = center(shape_el(pg, intake))
                pg.mouse.move(cx, cy)
                pg.mouse.down()
                pg.mouse.move(cx + 40, cy)
                advance(pg, FRAME_MS)
                dot = port_dots(pg).first
                assert float(dot.evaluate("el => getComputedStyle(el).opacity")) == 1.0, "no fade under reduced motion"
                pg.mouse.up()
                advance(pg, STEP_MS)
                third = poll(pg, lambda: (x := get_doc(a, seeded.did))["seq"] > after["seq"] and x, WORK_S, "drop saved")
                for cid, route in routes(third).items():
                    assert same_points(data_points(pg, cid), route)
                assert not [e for e in attr_log(pg) if e["name"] == "data-settling" and e["value"] is not None], "data-settling appeared"
            results.append(([routes(after)[seeded.cid(s, t)] for s, t in (("Intake", "Review"), ("Archive", "Store"), ("Log", "Store"))], notice))
    assert results[0] == results[1], "reduced motion gives identical geometry and announcement"


def test_wf_tethered_reroute_delete(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline(
        extra_shapes=[S("Tag", 600, 120, 64, 40)], groups=[("Archive", "Tag")], comments=[note("Archive", ada, "Check retention")])])])
    a = login(app_url, ada)
    archive, tag, store = d.sid("Archive"), d.sid("Tag"), d.sid("Store")
    gone_cid, mid = d.cid("Archive", "Store"), d.mid("Archive")
    group_id = shape(get_doc(a, d.did), archive)["group"]
    with workspace(browser, app_url, ada, d.did) as ada_pg, workspace(browser, app_url, bea, d.did) as pg:
        key(ada_pg, "Control+Alt+KeyO")
        tree = ada_pg.get_by_role("tree", name="Diagram outline")
        archive_item = tree.get_by_role("treeitem", name=outline_shape("Archive", "rectangle", ["Store"]), exact=True)
        poll(ada_pg, lambda: visible(archive_item), LIVE_S + SLACK_S, "outline lists Archive")
        before = get_doc(a, d.did)
        click(shape_el(pg, archive))
        key(pg, "Enter")
        assert shape_el(pg, archive).get_attribute("data-selected") == "true" and shape_el(pg, tag).get_attribute("data-selected") != "true"
        key(pg, "Delete")
        after = poll([], lambda: find(x := get_doc(a, d.did), "shapes", archive) is None and x, WORK_S, "delete saved")
        poll(ada_pg, lambda: shape_el(ada_pg, archive).count() == 0 and conn_el(ada_pg, gone_cid).count() == 0
             and tree.get_by_role("treeitem", name=re.compile("Archive")).count() == 0, LIVE_S + SLACK_S, "delete reached Ada")
        changed = rerouted(before, after)
        assert d.cid("Intake", "Review") in changed, "the wrapped connector straightened"
        wait_heard(pg, moved_notice("Archive", len(changed)))
        assert find(after, "connectors", gone_cid) is None
        assert_error(send(a, d.did, move(archive, x=8)), 409, "shape_deleted")
        assert_error(send(a, d.did, {"kind": "update_shapes", "shapes": [{"shape": archive, "set": {"x": 8}}]}), 409, "shape_deleted")
        assert_error(send(a, d.did, {"kind": "add_connector", "page": d.pid(), "from": {"shape": archive, "port": "e"},
                                     "to": {"shape": store, "port": "w"}, "label": "", "clientRef": "probe-ref"}), 409, "shape_deleted")
        assert_error(send(a, d.did, {"kind": "delete_connector", "connector": gone_cid}), 409, "connector_deleted")
        assert_error(a.post(f"/api/diagrams/{d.did}/comments", json={"shape": archive, "text": "late"}), 409, "shape_deleted")
        comment = next(c for c in a.get(f"/api/diagrams/{d.did}/comments").json()["comments"] if c["id"] == mid)
        assert comment["anchored"] is False
        _, f = ready_export(a, d.did, d.pid())
        ids = svg_ids(ET.fromstring(f.content))
        assert f"shape-{archive}" not in ids and f"connector-{gone_cid}" not in ids
        key(pg, "Control+KeyZ")
        restored = poll([], lambda: find(x := get_doc(a, d.did), "shapes", archive) and x, WORK_S, "undo of delete")
        conn = find(restored, "connectors", gone_cid)
        assert conn and conn["from"] == {"shape": archive, "port": "s"} and conn["to"] == {"shape": store, "port": "n"}
        assert shape(restored, archive)["group"] == group_id and shape(restored, archive)["label"] == "Archive"
        assert next(c for c in a.get(f"/api/diagrams/{d.did}/comments").json()["comments"] if c["id"] == mid)["anchored"] is True
        poll(ada_pg, lambda: shape_el(ada_pg, archive).count() == 1 and visible(ada_pg.locator(f"#pin-{mid}")), LIVE_S + SLACK_S, "pin returns")


def test_wf_groups_layers_group(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(layers=[L("Base"), L("Notes")], shapes=[S("Alpha", 40, 160), S("Beta", 240, 160), S("Memo", 440, 160, layer="Notes")])])])
    a = login(app_url, ada)
    alpha, beta, memo = d.sid("Alpha"), d.sid("Beta"), d.sid("Memo")
    with workspace(browser, app_url, ada, d.did) as pg:
        click(shape_el(pg, alpha))
        shift_click(pg, shape_el(pg, beta))
        key(pg, "Control+KeyG")
        group_size = len((alpha, beta))
        wait_heard(pg, f"Grouped {group_size} shapes.")
        doc = poll(pg, lambda: (x := get_doc(a, d.did)) and shape(x, alpha)["group"] and x, WORK_S, "group saved")
        gid = shape(doc, alpha)["group"]
        assert shape(doc, beta)["group"] == gid
        grp = pg.locator(f"#group-{gid}")
        poll(pg, lambda: grp.count() == 1, LIVE_S + SLACK_S, "group element")
        assert grp.get_attribute("role") == "group" and grp.get_attribute("aria-label") == group_name(group_size)
        assert grp.locator(f"#shape-{alpha}").count() == 1 and grp.locator(f"#shape-{beta}").count() == 1
        pg.mouse.click(*screen(pg, 300, 400))
        advance(pg, STEP_MS)
        click(shape_el(pg, alpha))
        advance(pg, STEP_MS)
        assert shape_el(pg, beta).get_attribute("data-selected") == "true"
        assert published(pg, "inspector-heading").inner_text().strip() == selected(group_size)
        seq = get_doc(a, d.did)["seq"]
        key(pg, "ArrowRight")
        moved = poll(pg, lambda: (x := get_doc(a, d.did))["seq"] > seq and x, WORK_S, "group nudge")
        assert moved["seq"] == seq + 1
        assert shape(moved, alpha)["x"] == 40 + NUDGE and shape(moved, beta)["x"] == 240 + NUDGE
        key(pg, "Control+Shift+KeyG")
        wait_heard(pg, f"Ungrouped {group_size} shapes.")
        poll(pg, lambda: shape(get_doc(a, d.did), alpha)["group"] is None, WORK_S, "ungroup saved")
        pg.mouse.click(*screen(pg, 300, 400))
        advance(pg, STEP_MS)
        click(shape_el(pg, alpha))
        shift_click(pg, shape_el(pg, memo))
        before = get_doc(a, d.did)
        key(pg, "Control+KeyG")
        wait_heard(pg, "Shapes on different layers can't be grouped.")
        assert get_doc(a, d.did) == before


def test_wf_groups_layers_reorder(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [P(
        layers=[L("Base"), L("Notes"), L("Walls")],
        shapes=[S("Intake", 40, 160), S("Alpha", 240, 160), S("Beta", 440, 160)], groups=[("Alpha", "Beta")])])])
    a = login(app_url, ada)
    region = lambda p: p.get_by_role("region", name="Layers")

    def order(p: Page) -> list[str]:
        txt = region(p).inner_text()
        return sorted(("Base", "Notes", "Walls"), key=lambda n: txt.find(n))

    def focus_layer(p: Page, name: str) -> None:
        region(p).get_by_text(name, exact=True).first.evaluate("el => (el.closest('[tabindex], button, a') || el).focus()")
        advance(p, STEP_MS)

    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, bea, d.did) as other:
        assert order(pg) == ["Walls", "Notes", "Base"]
        focus_layer(pg, "Base")
        key(pg, "Alt+ArrowUp")
        wait_heard(pg, reorder_notice("Base", 2, 3))
        assert "Base" in pg.evaluate("() => document.activeElement.textContent")
        poll(other, lambda: order(other) == ["Walls", "Base", "Notes"], LIVE_S + SLACK_S, "reorder reached Bea")
        layers = {l["name"]: l["order"] for l in get_doc(a, d.did)["pages"][0]["layers"]}
        assert layers["Base"] == 1 and layers["Notes"] == 0
        before = {l["id"] for l in get_doc(a, d.did)["pages"][0]["layers"]}
        click(region(pg).get_by_role("button", name="Add layer"))
        added = poll(pg, lambda: [l for l in get_doc(a, d.did)["pages"][0]["layers"] if l["id"] not in before], WORK_S, "layer added")
        focus_layer(pg, added[0]["name"])
        key(pg, "F2")
        pg.keyboard.press("Control+KeyA")
        pg.keyboard.type("Floor plan")
        key(pg, "Enter")
        poll(pg, lambda: any(l["name"] == "Floor plan" for l in get_doc(a, d.did)["pages"][0]["layers"]), WORK_S, "layer renamed")
        click(shape_el(pg, d.sid("Intake")))
        select(pg.get_by_role("combobox", name="Layer"), "Notes")
        advance(pg, STEP_MS)
        poll(pg, lambda: shape(get_doc(a, d.did), d.sid("Intake"))["layer"] == d.lid("Notes"), WORK_S, "shape moved layer")
        click(shape_el(pg, d.sid("Alpha")))
        select(pg.get_by_role("combobox", name="Layer"), "Walls")
        advance(pg, STEP_MS)
        doc = poll(pg, lambda: (x := get_doc(a, d.did)) and shape(x, d.sid("Beta"))["layer"] == d.lid("Walls") and x, WORK_S, "group moved layer")
        assert shape(doc, d.sid("Alpha"))["layer"] == d.lid("Walls")


def test_hidden_layers(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(layers=[L("Base"), L("Notes")], shapes=[
        S("Start", 0, 200), S("End", 400, 200), S("Memo", 200, 192, 80, 80, "Notes"), S("Aside", 200, 400, layer="Notes")],
        connectors=[C("Start", "e", "End", "w"), C("Start", "s", "Aside", "w"), C("Memo", "s", "Aside", "n")])])])
    a = login(app_url, ada)
    main, cross, inner = d.cid("Start", "End"), d.cid("Start", "Aside"), d.cid("Memo", "Aside")
    before = get_doc(a, d.did)
    assert bends(routes(before)[main]) > 0, "Memo is an obstacle while visible"
    with workspace(browser, app_url, ada, d.did) as pg:
        click(pg.get_by_role("button", name=hide_toggle("Notes"), exact=True))
        advance(pg, STEP_MS)
        after = poll(pg, lambda: (x := get_doc(a, d.did)) and not next(l for l in x["pages"][0]["layers"] if l["name"] == "Notes")["visible"] and x, WORK_S, "hide saved")
        assert main in rerouted(before, after) and len(norm(routes(after)[main])) == 2
        poll(pg, lambda: all(pg.locator(f"#{k}").count() == 0 for k in (f"shape-{d.sid('Memo')}", f"shape-{d.sid('Aside')}", f"connector-{cross}", f"connector-{inner}")),
             LIVE_S + SLACK_S, "hidden layer left the DOM")
        assert visible(pg.get_by_role("button", name=show_toggle("Notes"), exact=True))
        key(pg, "Control+Alt+KeyO")
        tree = pg.get_by_role("tree", name="Diagram outline")
        start_item = tree.get_by_role("treeitem", name=outline_shape("Start", "rectangle", ["End"]), exact=True)
        poll(pg, lambda: visible(start_item), LIVE_S + SLACK_S, "outline open")
        hidden_words = ("Memo", "Aside", "Notes")
        for word in hidden_words:
            assert tree.get_by_role("treeitem", name=re.compile(re.escape(word))).count() == 0, word


def test_locked_layer_operations(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(layers=[L("Base"), L("Walls", locked=True)], shapes=[S("A", 0, 120), S("B", 400, 120), S("W", 200, 320, layer="Walls")],
                                              connectors=[C("A", "e", "B", "w"), C("A", "s", "W", "n")])])])
    a = login(app_url, ada)
    A, B, W, walls = d.sid("A"), d.sid("B"), d.sid("W"), d.lid("Walls")
    ops = [
        {"kind": "add_shape", "page": d.pid(), "layer": walls, "clientRef": "probe-ref", "shape": {"kind": "rectangle", "x": 0, "y": 600, "w": 40, "h": 40, "label": ""}},
        move(W, x=8),
        {"kind": "update_shapes", "shapes": [{"shape": A, "set": {"x": 8}}, {"shape": W, "set": {"x": 8}}]},
        move(A, layer=walls),
        {"kind": "delete_shape", "shape": W},
        {"kind": "add_connector", "page": d.pid(), "from": {"shape": B, "port": "s"}, "to": {"shape": W, "port": "e"}, "label": "", "clientRef": "probe-ref"},
        {"kind": "delete_connector", "connector": d.cid("A", "W")},
    ]
    before = get_doc(a, d.did)
    for op in ops:
        assert_error(send(a, d.did, op), 409, "layer_locked")
    assert get_doc(a, d.did) == before
    accept(a, d.did, {"kind": "delete_shape", "shape": A})
    after = get_doc(a, d.did)
    assert find(after, "connectors", d.cid("A", "W")) is None and find(after, "shapes", W)
    with workspace(browser, app_url, ada, d.did) as pg:
        wall = shape_el(pg, W)
        layer_name = "Walls"
        assert wall.get_attribute("aria-description") == f"On locked layer {layer_name}"
        click(wall)
        wait_heard(pg, f"Layer {layer_name} is locked.")
        assert wall.get_attribute("data-selected") != "true"
        seq = get_doc(a, d.did)["seq"]
        key(pg, "ArrowRight")
        key(pg, "Delete")
        doc = get_doc(a, d.did)
        assert doc["seq"] == seq and find(doc, "shapes", W) and shape(doc, W)["x"] == 200


def test_collapsed_layers_rail(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    toggles = [f(name) for name in ("Base", "Notes", "Walls") for f in (hide_toggle, lock_toggle)]

    def toggles_present(p: Page) -> int:
        return sum(p.get_by_role("button", name=t, exact=True).count() for t in toggles)

    with workspace(browser, app_url, ada, d.did, viewport=TABLET) as pg:
        layers = pg.get_by_role("button", name="Layers", exact=True)
        assert layers.get_attribute("aria-expanded") == "false"
        assert toggles_present(pg) == 0
        assert not set(tab_order(pg, TAB_LIMIT)) & set(toggles)
        click(layers)
        advance(pg, RAIL_MS)
        assert layers.get_attribute("aria-expanded") == "true"
        first_toggle = pg.get_by_role("button", name=hide_toggle("Base"), exact=True)
        assert visible(first_toggle)
        first_toggle.focus()
        key(pg, "Escape")
        assert toggles_present(pg) == 0, "unavailable from the moment it starts closing"
        advance(pg, RAIL_MS)
        assert layers.get_attribute("aria-expanded") == "false"
        assert not set(tab_order(pg, TAB_LIMIT)) & set(toggles)


def test_wf_pages_keyboard(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a = login(app_url, ada)
    pages = lambda p: p.get_by_role("region", name="Pages")
    with workspace(browser, app_url, bea, d.did) as pg, workspace(browser, app_url, ada, d.did) as other:
        click(shape_el(pg, d.sid("Intake")))
        key(pg, "Control+Alt+KeyN")
        added = pages(pg).get_by_role("button", name="Page 2", exact=True)
        poll(pg, lambda: visible(added) and added.get_attribute("aria-current") == "page", WORK_S, "Page 2 opened")
        new_id = poll([], lambda: len((x := get_doc(a, d.did))["pages"]) == 2 and x["pages"][1]["id"], WORK_S, "page saved")
        assert parse_qs(urlparse(pg.url).query)["page"] == [new_id]
        added.focus()
        key(pg, "F2")
        pg.keyboard.press("Control+KeyA")
        pg.keyboard.type("Floor plan")
        key(pg, "Enter")
        item = pages(pg).get_by_role("button", name="Floor plan", exact=True)
        poll(pg, lambda: visible(item), WORK_S, "renamed")
        item.focus()
        key(pg, "Alt+ArrowUp")
        wait_heard(pg, reorder_notice("Floor plan", 1, 2))
        assert item.evaluate("el => el === document.activeElement || el.contains(document.activeElement)")
        poll(other, lambda: pages(other).get_by_role("list").get_by_role("button").first.inner_text().strip() == "Floor plan", LIVE_S + SLACK_S, "order reached Ada")
        assert {p["name"]: p["order"] for p in get_doc(a, d.did)["pages"]} == {"Floor plan": 0, "Main": 1}
        key(pg, "Control+PageDown")
        assert pages(pg).get_by_role("button", name="Main", exact=True).get_attribute("aria-current") == "page"
        key(pg, "Control+PageUp")
        assert item.get_attribute("aria-current") == "page"
        item.focus()
        key(pg, "Delete")
        dlg = pg.get_by_role("alertdialog", name="Delete page")
        poll(pg, lambda: visible(dlg), LIVE_S + SLACK_S, "Delete page dialog")
        click(dlg.get_by_role("button", name="Delete page"))
        poll(pg, lambda: [p["name"] for p in get_doc(a, d.did)["pages"]] == ["Main"], WORK_S, "page deleted")
        main = pages(pg).get_by_role("button", name="Main", exact=True)
        main.focus()
        key(pg, "Delete")
        assert pg.get_by_role("alertdialog", name="Delete page").count() == 0, "last page cannot be deleted"


def test_page_addresses(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline(), P("Floor plan", shapes=[S("Lone", 40, 160)])])])
    with workspace(browser, app_url, ada, d.did) as pg:
        page_q = lambda: parse_qs(urlparse(pg.url).query).get("page")
        poll(pg, lambda: page_q() == [d.pid(0)], LIVE_S + SLACK_S, "first page in address")
        second = pg.get_by_role("region", name="Pages").get_by_role("button", name="Floor plan", exact=True)
        click(second)
        poll(pg, lambda: page_q() == [d.pid(1)] and shape_el(pg, d.sid("Lone", 1)).count() == 1, LIVE_S + SLACK_S, "second page")
        reload(pg, d.did)
        assert page_q() == [d.pid(1)] and second.get_attribute("aria-current") == "page"
        pg.go_back()
        poll(pg, lambda: page_q() == [d.pid(0)] and shape_el(pg, d.sid("Intake")).count() == 1, BOOT_S, "Back")
        pg.go_forward()
        poll(pg, lambda: page_q() == [d.pid(1)] and shape_el(pg, d.sid("Lone", 1)).count() == 1, BOOT_S, "Forward")


def test_empty_page_text(browser, app_url):
    ada, = cast("ada")
    text = "This page is empty. Add a shape from the toolbar or press R."
    d, = seed(app_url, [ada], [D(ada, pages=[P("Notes only", layers=[L("Base"), L("Notes")], shapes=[S("Memo", 40, 160, layer="Notes")]), P("Blank")])])
    with workspace(browser, app_url, ada, d.did, page_id=d.pid(1)) as pg:
        poll(pg, lambda: visible(pg.get_by_text(text, exact=True)), LIVE_S + SLACK_S, "empty text on blank page")
        pg.goto(f"{app_url}/d/{d.did}?page={d.pid(0)}")
        wait_canvas(pg, d.did)
        poll(pg, lambda: shape_el(pg, d.sid("Memo")).count() == 1, LIVE_S + SLACK_S, "Memo drawn")
        assert outside_announcer(pg, text) == 0
        click(pg.get_by_role("button", name=hide_toggle("Notes"), exact=True))
        poll(pg, lambda: visible(pg.get_by_text(text, exact=True)), LIVE_S + SLACK_S, "empty text once hidden")


def test_wf_pages_strip(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline(), P("Floor plan")])])
    with workspace(browser, app_url, ada, d.did, viewport=PHONE, touch=True) as pg:
        strip = published(pg, "page-strip")
        first, second = strip_text("Main", 1, 2), strip_text("Floor plan", 2, 2)
        assert first in strip.inner_text()
        tap(strip.get_by_role("button", name="Next page"))
        poll(pg, lambda: second in strip.inner_text(), LIVE_S + SLACK_S, "Next page")
        b = strip.bounding_box()
        y = b["y"] + b["height"] / 2
        touch_path(pg, [(b["x"] + b["width"] * 0.2, y)], [(b["x"] + b["width"] * 0.8, y)])
        poll(pg, lambda: first in strip.inner_text(), LIVE_S + SLACK_S, "swipe right opens previous")
        touch_path(pg, [(b["x"] + b["width"] * 0.8, y)], [(b["x"] + b["width"] * 0.2, y)])
        poll(pg, lambda: second in strip.inner_text(), LIVE_S + SLACK_S, "swipe left opens next")
        assert parse_qs(urlparse(pg.url).query)["page"] == [d.pid(1)]


def test_canvas_focus_order(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Alpha", 400, 140), S("Beta", 100, 140), S("Gamma", 0, 300)])])])
    alpha, beta, gamma = d.sid("Alpha"), d.sid("Beta"), d.sid("Gamma")
    with workspace(browser, app_url, ada, d.did) as pg:
        assert tab_to_canvas(pg)["shape"] == beta
        for combo, want in (("Alt+ArrowRight", alpha), ("Alt+ArrowDown", gamma), ("Alt+ArrowLeft", alpha)):
            key(pg, combo)
            assert focus_state(pg)["shape"] == want, combo
        for sid in (alpha, beta, gamma):
            assert shape_el(pg, sid).get_attribute("data-selected") != "true"
        key(pg, "Tab")
        assert not focus_state(pg)["inCanvas"], "the canvas is one tab stop"
        key(pg, "Shift+Tab")
        assert focus_state(pg)["shape"] == alpha


def test_wf_keyboard_build_insert(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Anchor", -4000, -4000)])])])
    a = login(app_url, ada)
    anchor = d.sid("Anchor")
    with workspace(browser, app_url, ada, d.did) as pg:
        box = canvas_box(pg)
        ox, oy = view_origin(pg)
        x0, y0 = math.floor(ox + box["width"] / 2 - INSERT_W / 2), math.floor(oy + box["height"] / 2 - INSERT_H / 2)
        tools = pg.get_by_role("toolbar", name="Tools")
        mine = lambda doc: [s for s in doc["pages"][0]["shapes"] if s["id"] != anchor]
        new = lambda n: poll([], lambda: len(mine(x := get_doc(a, d.did))) == n and x, WORK_S, f"{n} shapes")
        editing = "() => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); }"
        tools.get_by_role("button", name="Rectangle").focus()
        key(pg, "Enter")
        doc = new(1)
        assert pg.evaluate(editing), "label editor focused"
        pg.keyboard.type("Start")
        key(pg, "Enter")
        first = mine(doc)[0]
        assert (first["w"], first["h"], first["kind"]) == (INSERT_W, INSERT_H, "rectangle")
        assert abs(first["x"] - x0) <= PX_TOL and abs(first["y"] - y0) <= PX_TOL
        poll([], lambda: shape(get_doc(a, d.did), first["id"])["label"] == "Start", WORK_S, "label committed")
        click(tools.get_by_role("button", name="Ellipse"))
        doc = new(2)
        second = next(s for s in mine(doc) if s["id"] != first["id"])
        assert pg.evaluate(editing)
        pg.keyboard.type("Draft")
        key(pg, "Escape")
        assert second["x"] - (first["x"] + INSERT_W) == INSERT_GAP and second["y"] == first["y"]
        assert shape(get_doc(a, d.did), second["id"])["label"] == ""
        kind = "ellipse"
        assert second["kind"] == kind and shape_el(pg, second["id"]).get_attribute("aria-label") == f"Untitled {kind}"
        if not focus_state(pg)["inCanvas"]:
            tab_to_canvas(pg)
        key(pg, "r")
        doc = new(3)
        third = next(s for s in mine(doc) if s["id"] not in (first["id"], second["id"]))
        assert abs(third["x"] - (first["x"] + 2 * INSERT_STEP)) <= PX_TOL and data_box(pg, third["id"])["w"] == INSERT_W


def test_wf_keyboard_build_connect(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Start", 40, 200), S("Check", 400, 200)])])])
    a = login(app_url, ada)
    start, chk = d.sid("Start"), d.sid("Check")
    with workspace(browser, app_url, ada, d.did) as pg:
        assert tab_to_canvas(pg)["shape"] == start
        key(pg, "c")
        key(pg, "Escape")
        assert get_doc(a, d.did)["pages"][0]["connectors"] == []
        key(pg, "c")
        key(pg, "ArrowRight")
        key(pg, "4")
        key(pg, "Enter")
        wait_heard(pg, connected_notice("Start", "Check"))
        conn = poll([], lambda: (x := get_doc(a, d.did))["pages"][0]["connectors"] and x["pages"][0]["connectors"][0], WORK_S, "connector saved")
        assert conn["from"] == {"shape": start, "port": "e"} and conn["to"] == {"shape": chk, "port": "w"}
        assert focus_state(pg)["shape"] == start
        key(pg, "Alt+ArrowRight")
        key(pg, "Space")
        key(pg, "ArrowDown")
        doc = poll([], lambda: (x := get_doc(a, d.did)) and shape(x, chk)["y"] == 200 + NUDGE and x, WORK_S, "nudge saved")
        end = port_at(shape(doc, chk), "w")
        assert tuple(find(doc, "connectors", conn["id"])["route"][-1]) == end
        key(pg, "Control+KeyZ")
        doc = poll([], lambda: (x := get_doc(a, d.did)) and shape(x, chk)["y"] == 200 and x, WORK_S, "nudge undone")
        assert tuple(find(doc, "connectors", conn["id"])["route"][-1]) == port_at(shape(doc, chk), "w")


def test_visible_focus(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Alpha", 40, 160), S("Beta", 240, 160)])])])
    with workspace(browser, app_url, ada, d.did) as pg:
        props = ("outline-style", "outline-width", "outline-offset")
        share = pg.get_by_role("button", name="Share")
        share.focus()
        key(pg, "Shift+Tab")
        key(pg, "Tab")
        _, focused = state_styles(share, *props, state="focus")
        ring_style, ring_width, ring_gap = (focused[p] for p in props)
        width_px, gap_px = (float(v.rstrip("px")) for v in (ring_width, ring_gap))
        assert ring_style != "none"
        assert width_px == FOCUS_RING_PX and gap_px == FOCUS_RING_PX
        tab_to_canvas(pg)
        key(pg, "Space")
        key(pg, "Delete")
        assert not focus_state(pg)["body"]
        assert focus_state(pg)["inCanvas"]
        key(pg, "Control+KeyZ")
        assert not focus_state(pg)["body"]
        share = pg.get_by_role("button", name="Share")
        click(share)
        key(pg, "Escape")
        assert share.evaluate("el => el === document.activeElement")


def test_personal_undo(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a, b = login(app_url, ada), login(app_url, bea)
    trio = [d.sid(n) for n in ("Intake", "Review", "Log")]
    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, bea, d.did) as other:
        click(shape_el(pg, trio[0]))
        for sid in trio[1:]:
            shift_click(pg, shape_el(pg, sid))
        start = get_doc(a, d.did)
        key(pg, "ArrowRight")
        moved = poll([], lambda: (x := get_doc(a, d.did))["seq"] > start["seq"] and x, WORK_S, "nudge")
        assert moved["seq"] == start["seq"] + 1
        accept(b, d.did, move(d.sid("Store"), x=400))
        mark = get_doc(a, d.did)["seq"]
        key(pg, "Control+KeyZ")
        undone = poll([], lambda: (x := get_doc(a, d.did))["seq"] > mark and x, WORK_S, "undo")
        assert undone["seq"] == mark + 1
        assert [shape(undone, s)["x"] for s in trio] == [shape(start, s)["x"] for s in trio]
        assert shape(undone, d.sid("Store"))["x"] == 400
        poll(other, lambda: data_box(other, trio[0])["x"] == shape(start, trio[0])["x"], LIVE_S + SLACK_S, "undo broadcast")
        key(pg, "Control+KeyZ")
        assert shape(get_doc(a, d.did), d.sid("Store"))["x"] == 400, "only own operations are undone"
        key(pg, "Control+Shift+KeyZ")
        redone = poll([], lambda: (x := get_doc(a, d.did)) and shape(x, trio[1])["x"] == shape(moved, trio[1])["x"] and x, WORK_S, "redo")
        assert [shape(redone, s)["x"] for s in trio] == [shape(moved, s)["x"] for s in trio]


def test_wf_outline_reader_blocked(browser, app_url):
    ada, = cast("ada")
    walls = [S("WallTop", 392, 360, 176, 36, "Walls"), S("WallBottom", 392, 484, 176, 36, "Walls"),
             S("WallLeft", 360, 360, 36, 160, "Walls"), S("WallRight", 564, 360, 36, 160, "Walls")]
    d, = seed(app_url, [ada], [D(ada, pages=[P(layers=[L("Base"), L("Walls", locked=True)],
                                              shapes=[S("Start", 0, 400), S("Check", 400, 400, 160, 80), S("Pa", 40, 140), S("Pb", 240, 140), *walls],
                                              connectors=[C("Start", "e", "Check", "w")], groups=[("Pa", "Pb")])])])
    a = login(app_url, ada)
    cid, start, wall = d.cid("Start", "Check"), d.sid("Start"), d.sid("WallTop")
    with workspace(browser, app_url, ada, d.did) as pg:
        canvas = published(pg, "canvas")
        page_name = "Main"
        assert (canvas.get_attribute("role"), canvas.get_attribute("aria-roledescription"), canvas.get_attribute("aria-label")) == ("graphics-document", "diagram", f"{page_name} canvas")
        doc = get_doc(a, d.did)
        s = shape_el(pg, start)
        assert (s.get_attribute("role"), s.get_attribute("aria-roledescription"), s.get_attribute("aria-label")) == ("graphics-symbol", "rectangle", "Start")
        assert data_box(pg, start) == {k: shape(doc, start)[k] for k in "xywh"} and s.get_attribute("data-layer") == d.lid("Base")
        conn = conn_el(pg, cid)
        assert (conn.get_attribute("role"), conn.get_attribute("aria-roledescription")) == ("graphics-symbol", "connector")
        assert conn.get_attribute("data-from") == f"{start}:e" and conn.get_attribute("data-to") == f"{d.sid('Check')}:w"
        assert conn.get_attribute("data-blocked") == "true" and conn.get_attribute("aria-label") == connector_name("Start", "Check", True)
        assert connector_path(conn).evaluate("el => getComputedStyle(el).strokeDasharray") not in ("none", "")
        gid = shape(doc, d.sid("Pa"))["group"]
        g = pg.locator(f"#group-{gid}")
        assert g.get_attribute("role") == "group" and g.get_attribute("aria-label") == group_name(2) and g.locator(f"#shape-{d.sid('Pa')}").count() == 1
        click(pg.get_by_role("button", name=hide_toggle("Walls"), exact=True))
        poll(pg, lambda: conn.get_attribute("data-blocked") is None and conn.get_attribute("aria-label") == connector_name("Start", "Check"),
             LIVE_S + SLACK_S, "blocked wording gone")
        assert connector_path(conn).evaluate("el => getComputedStyle(el).strokeDasharray") in ("none", "")


def test_wf_outline_reader_tree(browser, app_url):
    walls = [S("WallTop", 392, 360, 176, 36, "Walls"), S("WallBottom", 392, 484, 176, 36, "Walls"),
             S("WallLeft", 360, 360, 36, 160, "Walls"), S("WallRight", 564, 360, 36, 160, "Walls")]
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [
        P(shapes=[S("Start", 40, 160), S("Check", 400, 160), S("Done", 400, 360)], connectors=[C("Start", "e", "Check", "w"), C("Check", "s", "Done", "n")]),
        P("Floor"),
        P("Walled", layers=[L("Base"), L("Walls", locked=True)], shapes=[S("Start", 0, 400), S("Check", 400, 400, 160, 80), *walls],
          connectors=[C("Start", "e", "Check", "w")])])])
    b = login(app_url, bea)
    with workspace(browser, app_url, ada, d.did) as pg:
        key(pg, "Control+Alt+KeyO")
        tree = pg.get_by_role("tree", name="Diagram outline")
        item = lambda name: tree.get_by_role("treeitem", name=name, exact=True)
        texts = [outline_page("Main", 3, 2), outline_layer("Base", 3), outline_shape("Start", "rectangle", ["Check"]),
                 outline_shape("Check", "rectangle", ["Done"], ["Start"]), outline_shape("Done", "rectangle", sources=["Check"]),
                 connector_name("Start", "Check"), connector_name("Check", "Done"), outline_page("Floor", 0, 0), outline_page("Walled", 6, 1)]
        poll(pg, lambda: all(visible(item(t)) for t in texts), LIVE_S + SLACK_S, "outline texts")
        current = lambda name: item(name).evaluate("el => el === document.activeElement || document.activeElement.getAttribute('aria-activedescendant') === el.id")
        key(pg, "Home")
        assert current(texts[0])
        key(pg, "ArrowDown")
        assert current(texts[1])
        key(pg, "ArrowRight")
        assert current(texts[2])
        key(pg, "ArrowLeft")
        assert current(texts[1])
        key(pg, "ArrowLeft")
        assert item(texts[1]).get_attribute("aria-expanded") == "false"
        key(pg, "ArrowRight")
        assert item(texts[1]).get_attribute("aria-expanded") == "true"
        key(pg, "End")
        assert current(texts[-1])
        key(pg, "Home")
        key(pg, "ArrowDown", 3)
        assert current(texts[3])
        key(pg, "Enter")
        assert shape_el(pg, d.sid("Check")).get_attribute("data-selected") == "true"
        assert focus_state(pg)["shape"] == d.sid("Check")
        before = get_doc(b, d.did)
        key(pg, "ArrowRight")
        after = poll([], lambda: (x := get_doc(b, d.did))["seq"] > before["seq"] and x, WORK_S, "nudge saved")
        wait_heard(pg, moved_notice("Check", len(rerouted(before, after))))
        accept(b, d.did, {"kind": "add_connector", "page": d.pid(), "from": {"shape": d.sid("Start"), "port": "s"},
                          "to": {"shape": d.sid("Done"), "port": "w"}, "label": "", "clientRef": "probe-ref"})
        key(pg, "Control+Alt+KeyO")
        poll(pg, lambda: visible(item(outline_shape("Start", "rectangle", ["Check", "Done"]))) and visible(item(outline_page("Main", 3, 3))),
             LIVE_S + SLACK_S, "outline update without reload")
        pg.goto(f"{app_url}/d/{d.did}?page={d.pid(2)}")
        wait_canvas(pg, d.did)
        key(pg, "Control+Alt+KeyO")

        def shown(name: str) -> bool:
            loc = item(name)
            return any(loc.nth(i).is_visible() for i in range(loc.count()))

        locked_item, blocked_item, clear_item = outline_layer("Walls", 4, True), connector_name("Start", "Check", True), connector_name("Start", "Check")
        poll(pg, lambda: shown(locked_item) and shown(blocked_item), LIVE_S + SLACK_S, "locked and blocked items")
        click(pg.get_by_role("button", name=hide_toggle("Walls"), exact=True))
        poll(pg, lambda: shown(clear_item) and not shown(blocked_item)
             and not shown(locked_item), LIVE_S + SLACK_S, "blocked wording gone after hide")


def test_wf_outline_reader_layer_toggles(browser, app_url):
    ada, = cast("ada")
    base, notes = "Base", "Notes"
    d, = seed(app_url, [ada], [D(ada, pages=[P(layers=[L(base), L(notes)], shapes=[S("Alpha", 40, 120), S("Beta", 240, 120, layer=notes)])])])
    tree = lambda pg: pg.get_by_role("tree", name="Diagram outline")
    item = lambda pg, name: tree(pg).get_by_role("treeitem", name=name, exact=True)
    with workspace(browser, app_url, ada, d.did) as pg:
        pg.get_by_role("button", name=hide_toggle(notes), exact=True).focus()
        key(pg, "Enter")
        key(pg, "Control+Alt+KeyO")
        poll(pg, lambda: item(pg, outline_page("Main", 1, 0)).count() == 1, LIVE_S + SLACK_S, "page count without Notes")
        assert item(pg, outline_layer(notes, 1)).count() == 0
        assert item(pg, outline_shape("Beta", "rectangle")).count() == 0
        key(pg, "Escape")
        pg.get_by_role("button", name=lock_toggle(base), exact=True).focus()
        key(pg, "Enter")
        key(pg, "Control+Alt+KeyO")
        poll(pg, lambda: item(pg, outline_layer(base, 1, locked=True)).count() == 1, LIVE_S + SLACK_S, "locked layer text")
        assert item(pg, outline_layer(base, 1)).count() == 0


def test_wf_outline_reader_second_page(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Alpha", 40, 120)]), P("Second", shapes=[S("Gamma", 40, 120)])])])
    tree = lambda pg: pg.get_by_role("tree", name="Diagram outline")
    item = lambda pg, name: tree(pg).get_by_role("treeitem", name=name, exact=True)
    current = lambda pg, name: item(pg, name).evaluate("e => e === document.activeElement || e.contains(document.activeElement)"
                                                       " || document.activeElement.getAttribute('aria-activedescendant') === e.id")
    second = outline_page("Second", 1, 0)
    with workspace(browser, app_url, ada, d.did) as pg:
        key(pg, "Control+Alt+KeyO")
        poll(pg, lambda: visible(tree(pg)), LIVE_S + SLACK_S, "outline open")
        assert item(pg, second).get_attribute("aria-expanded") == "false"
        key(pg, "End")
        poll(pg, lambda: current(pg, second), LIVE_S + SLACK_S, "End reaches the last page")
        key(pg, "ArrowRight")
        assert item(pg, second).get_attribute("aria-expanded") == "true"
        target = outline_shape("Gamma", "rectangle")
        for _ in range(4):
            if item(pg, target).count() and current(pg, target):
                break
            key(pg, "ArrowDown")
        assert current(pg, target), "Down reaches Gamma"
        key(pg, "Enter")
        poll(pg, lambda: parse_qs(urlparse(pg.url).query).get("page") == [d.pid(1)] and focus_state(pg).get("shape") == d.sid("Gamma", 1),
             LIVE_S + SLACK_S, "Enter opens the page and focuses Gamma")

def test_server_ordered_operations(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a, b = login(app_url, ada), login(app_url, bea)
    intake, review, log = d.sid("Intake"), d.sid("Review"), d.sid("Log")
    with workspace(browser, app_url, ada, d.did) as pg:
        before = get_doc(a, d.did)
        oid = op_id()
        first = accept(b, d.did, move(intake, y=280), oid)
        after = get_doc(a, d.did)
        assert first["seq"] == before["seq"] + 1 and first["ids"] == {} and first["opId"] == oid
        assert first["rerouted"] == sorted(first["rerouted"]) == rerouted(before, after)
        poll(pg, lambda: data_box(pg, intake)["y"] == 280, LIVE_S + SLACK_S, "broadcast")
        replay = send(b, d.did, move(intake, y=280), oid, base_seq=99)
        assert replay.status_code == 200 and replay.json() == first
        assert get_doc(a, d.did)["seq"] == after["seq"]
        assert_error(send(b, d.did, move(intake, y=296), oid), 409, "op_conflict")
        ref = op_id()
        added = accept(b, d.did, {"kind": "add_shape", "page": d.pid(), "layer": d.lid("Base"), "clientRef": ref,
                                  "shape": {"kind": "ellipse", "x": 600, "y": 600, "w": 40, "h": 40, "label": ""}})
        assert is_id(added["ids"][ref], "s_")
        accept(b, d.did, {"kind": "delete_shape", "shape": log})
        mark = get_doc(a, d.did)
        assert_error(send(b, d.did, {"kind": "update_shapes", "shapes": [{"shape": intake, "set": {"x": 8}}, {"shape": log, "set": {"x": 8}}]}), 409, "shape_deleted")
        assert get_doc(a, d.did) == mark
        both = accept(b, d.did, {"kind": "update_shapes", "shapes": [{"shape": intake, "set": {"y": 120}}, {"shape": review, "set": {"y": 280}}]})
        final = get_doc(a, d.did)
        assert both["seq"] == mark["seq"] + 1 and both["rerouted"] == rerouted(mark, final)


def test_presence(browser, app_url):
    ada, bea, cy = cast("ada", "bea", "cy")
    d, = seed(app_url, [ada, bea, cy], [D(ada, [(bea, "editor"), (cy, "viewer")], [pipeline()])])
    with workspace(browser, app_url, ada, d.did) as pg:
        with workspace(browser, app_url, bea, d.did) as other:
            tab = other.context.new_page()
            tab.goto(other.url)
            wait_canvas(tab, d.did)
            avatar = pg.get_by_role("button", name=f"{bea.name}, editing", exact=True)
            poll(pg, lambda: avatar.count() == 1, TWO_S + SLACK_S, "one Bea avatar")
            advance(pg, OFFLINE_MS)
            assert avatar.count() == 1 and heard(pg).count(f"{bea.name} joined.") == 1
            assert pg.get_by_role("button", name=f"{ada.name}, editing", exact=True).count() == 0
            with workspace(browser, app_url, cy, d.did):
                poll(pg, lambda: pg.get_by_role("button", name=f"{cy.name}, viewing", exact=True).count() == 1, TWO_S + SLACK_S, "viewer avatar")
            poll(pg, lambda: pg.get_by_role("button", name=f"{cy.name}, viewing", exact=True).count() == 0, TWO_S + SLACK_S, "Cy left")
        poll(pg, lambda: avatar.count() == 0, TWO_S + SLACK_S, "Bea left")


def test_wf_live_coedit_cursors(browser, app_url):
    ada, bea, cy = cast("ada", "bea", "cy")
    d, = seed(app_url, [ada, bea, cy], [D(ada, [(bea, "editor"), (cy, "viewer")], [pipeline()])])
    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, cy, d.did, reduced=True) as calm:
        with workspace(browser, app_url, bea, d.did) as other:
            cursor = lambda p: p.locator(f"#cursor-{bea.id}")
            other.mouse.move(*screen(other, 300, 300))
            advance(other, CURSOR_MS)
            poll([pg, calm], lambda: cursor(pg).count() == 1 and cursor(calm).count() == 1, LIVE_S + SLACK_S, "cursor appears")
            assert bea.name in (cursor(pg).text_content() or "") and cursor(pg).get_attribute("aria-hidden") == "true"
            x1, c1 = rect(cursor(pg))["x"], rect(cursor(calm))["x"]
            other.mouse.move(*screen(other, 500, 300))
            advance(other, CURSOR_MS)
            samples, started = [], None
            deadline = time.monotonic() + LIVE_S + SLACK_S + 1
            while time.monotonic() < deadline:
                advance(pg, FRAME_MS)
                x = rect(cursor(pg))["x"] - x1
                if started is None and abs(x) > PX_TOL:
                    started = 0
                if started is not None:
                    samples.append(x)
                    started += FRAME_MS
                    if abs(x - 200) <= PX_TOL:
                        break
            assert samples and abs(samples[-1] - 200) <= PX_TOL, samples
            assert any(GRID < s < 200 - GRID for s in samples), "glides through intermediate positions"
            assert started <= GLIDE_MS + 2 * FRAME_MS, started
            poll(calm, lambda: abs(rect(cursor(calm))["x"] - c1 - 200) <= PX_TOL, LIVE_S + SLACK_S, "reduced-motion cursor")
        poll(pg, lambda: cursor(pg).count() == 0, TWO_S + SLACK_S, "cursor removed on close")


def test_wf_live_coedit_conflict(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a, b = login(app_url, ada), login(app_url, bea)
    intake = d.sid("Intake")
    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, bea, d.did) as other:
        click(shape_el(pg, intake))
        type_into(pg, spin(pg, "X"), "200")
        key(pg, "Enter")
        mine = poll([], lambda: (x := get_doc(a, d.did)) and shape(x, intake)["x"] == 200 and x["seq"], WORK_S, "Ada's X saved")
        later_x = 240
        later = accept(b, d.did, move(intake, x=later_x))
        assert later["seq"] > mine
        poll([pg, other], lambda: data_box(pg, intake)["x"] == later_x and data_box(other, intake)["x"] == later_x, LIVE_S + SLACK_S, "later seq on both screens")
        wait_heard(pg, f"{bea.name} changed Intake at the same time. Their edit was kept.")
        assert spin(pg, "X").input_value() == str(later_x)
        assert not [t for t in heard(other) if "at the same time" in t]


def test_wf_live_coedit_undo_skip(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a, b = login(app_url, ada), login(app_url, bea)
    intake = d.sid("Intake")
    with workspace(browser, app_url, ada, d.did) as pg:
        click(shape_el(pg, intake))
        key(pg, "ArrowRight")
        poll([], lambda: shape(get_doc(a, d.did), intake)["x"] == 40 + NUDGE, WORK_S, "nudge saved")
        accept(b, d.did, move(intake, x=120))
        poll(pg, lambda: data_box(pg, intake)["x"] == 120, LIVE_S + SLACK_S, "Bea's change shown")
        seq = get_doc(a, d.did)["seq"]
        key(pg, "Control+KeyZ")
        wait_heard(pg, f"Can't undo: {bea.name} changed Intake after you.")
        doc = get_doc(a, d.did)
        assert doc["seq"] == seq and shape(doc, intake)["x"] == 120


def test_concurrent_operations(app_url):
    ada, bea, cy = cast("ada", "bea", "cy")
    d, = seed(app_url, [ada, bea, cy], [D(ada, [(bea, "editor"), (cy, "editor")], [pipeline()])])
    a = login(app_url, ada)
    people = [ada, bea, cy]
    sids = [d.sid(n) for n in ("Intake", "Archive", "Review", "Log", "Store")]
    seq0 = get_doc(a, d.did)["seq"]
    jobs = []
    for i in range(15):
        c = login(app_url, people[i % 3])
        jobs.append(lambda c=c, i=i: send(c, d.did, move(sids[i % 5], label=f"L{i}")))
    rs = together(jobs)
    assert all(r.status_code == 200 for r in rs)
    assert sorted(r.json()["seq"] for r in rs) == list(range(seq0 + 1, seq0 + 16))
    assert get_doc(a, d.did)["seq"] == seq0 + 15
    review = d.sid("Review")
    ca, cb = login(app_url, ada), login(app_url, bea)
    base = get_doc(a, d.did)["seq"]
    together([lambda: send(ca, d.did, move(review, x=400), base_seq=base), lambda: send(cb, d.did, move(review, label="Pipeline"), base_seq=base)])
    s = shape(get_doc(a, d.did), review)
    assert s["x"] == 400 and s["label"] == "Pipeline"
    store = d.sid("Store")
    ra, rb = together([lambda: send(ca, d.did, move(store, w=100)), lambda: send(cb, d.did, move(store, w=120))])
    assert shape(get_doc(a, d.did), store)["w"] == (100 if ra.json()["seq"] > rb.json()["seq"] else 120)
    oid, seq1 = op_id(), get_doc(a, d.did)["seq"]
    copies = [login(app_url, ada) for _ in range(5)]
    rs = together([lambda c=c: send(c, d.did, move(store, y=416), oid) for c in copies])
    assert all(r.status_code == 200 for r in rs) and len({json.dumps(r.json(), sort_keys=True) for r in rs}) == 1
    assert get_doc(a, d.did)["seq"] == seq1 + 1
    oid, seq2 = op_id(), seq1 + 1
    rs = together([lambda c=c, i=i: send(c, d.did, move(store, x=400 + i), oid) for i, c in enumerate(copies)])
    ok = [r for r in rs if r.status_code == 200]
    assert len(ok) == 1 and all(r.status_code == 409 and r.json()["error"]["code"] == "op_conflict" for r in rs if r not in ok)
    assert get_doc(a, d.did)["seq"] == seq2 + 1
    shared = op_id()
    r1, r2 = together([lambda: send(ca, d.did, move(store, h=72), shared), lambda: send(cb, d.did, move(store, h=88), shared)])
    assert r1.status_code == r2.status_code == 200 and r1.json()["seq"] != r2.json()["seq"]


def test_wf_offline_reconnect_queue(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a = login(app_url, ada)
    intake, archive = d.sid("Intake"), d.sid("Archive")
    with workspace(browser, app_url, bea, d.did) as pg:
        seq0 = get_doc(a, d.did)["seq"]
        r = post_json(app_url, "/api/grading/save-outage", {"diagramId": d.did, "ms": OFFLINE_OUTAGE_MS})
        assert r.status_code == 200, r.text
        advance(pg, OFFLINE_MS)
        poll(pg, lambda: "Offline." in status_text(pg), LIVE_S + SLACK_S, "offline banner")
        click(shape_el(pg, intake))
        key(pg, "ArrowRight")
        poll(pg, lambda: f"Offline. {waiting(1)}" in status_text(pg), LIVE_S + SLACK_S, "one waiting")
        click(shape_el(pg, archive))
        key(pg, "ArrowRight")
        poll(pg, lambda: f"Offline. {waiting(2)}" in status_text(pg), LIVE_S + SLACK_S, "two waiting")
        reload(pg, d.did)
        advance(pg, OFFLINE_MS)
        poll(pg, lambda: f"Offline. {waiting(2)}" in status_text(pg), LIVE_S + SLACK_S, "count survives reload")
        assert data_box(pg, intake)["x"] == 40 + NUDGE, "queued edit still drawn"
        assert get_doc(a, d.did)["seq"] == seq0, "queued edits are not saved yet"


def test_wf_offline_reconnect_phone(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a = login(app_url, ada)
    intake = d.sid("Intake")
    with workspace(browser, app_url, bea, d.did, viewport=PHONE, touch=True) as pg:
        before = len(get_doc(a, d.did)["pages"][0]["shapes"])
        r = post_json(app_url, "/api/grading/save-outage", {"diagramId": d.did, "ms": OFFLINE_OUTAGE_MS})
        assert r.status_code == 200, r.text
        advance(pg, OFFLINE_MS)
        poll(pg, lambda: "Offline." in status_text(pg), LIVE_S + SLACK_S, "offline banner")
        point = rect(shape_el(pg, intake))
        touch(pg, "touchStart", [(point["x"] + point["w"] / 2, point["y"] + point["h"] / 2)])
        advance(pg, STEP_MS)
        touch(pg, "touchEnd", [])
        advance(pg, STEP_MS)
        poll(pg, lambda: shape_el(pg, intake).get_attribute("data-selected") == "true", LIVE_S + SLACK_S, "tap selects")
        key(pg, "Shift+F10")
        menu = pg.get_by_role("menu", name="Shape actions")
        poll(pg, lambda: visible(menu), LIVE_S + SLACK_S, "Shape actions")
        click(menu.get_by_role("menuitem", name="Duplicate", exact=True))
        poll(pg, lambda: f"Offline. {waiting(1)}" in status_text(pg), LIVE_S + SLACK_S, "one change waiting")
        assert len(get_doc(a, d.did)["pages"][0]["shapes"]) == before, "nothing saved while offline"
        poll(pg, lambda: "All changes saved." in status_text(pg), OFFLINE_OUTAGE_MS / 1000 + WORK_S, "saved banner")
        assert len(get_doc(a, d.did)["pages"][0]["shapes"]) == before + 1, "the queued duplicate is saved exactly once"

def test_replay_on_reconnect(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a = login(app_url, ada)
    intake, archive = d.sid("Intake"), d.sid("Archive")
    with workspace(browser, app_url, bea, d.did) as pg:
        assert post_json(app_url, "/api/grading/save-outage", {"diagramId": d.did, "ms": OFFLINE_OUTAGE_MS}).status_code == 200
        advance(pg, OFFLINE_MS)
        poll(pg, lambda: "Offline." in status_text(pg), LIVE_S + SLACK_S, "offline banner")
        click(shape_el(pg, intake))
        key(pg, "ArrowRight")
        click(shape_el(pg, archive))
        key(pg, "ArrowRight")
        poll(pg, lambda: waiting(2) in status_text(pg), LIVE_S + SLACK_S, "two edits queued")
        oid = op_id()
        until_http(lambda: send(a, d.did, {"kind": "delete_shape", "shape": archive}, oid).status_code == 200, OFFLINE_OUTAGE_MS / 1000 + WORK_S, "Ada's delete after the outage")
        seq = get_doc(a, d.did)["seq"]
        poll(pg, lambda: "All changes saved." in status_text(pg), WORK_S, "saved banner")
        wait_heard(pg, f"Archive was deleted by {ada.name}. Your change was not saved.")
        doc = get_doc(a, d.did)
        assert doc["seq"] == seq + 1 and shape(doc, intake)["x"] == 40 + NUDGE
        assert shape_el(pg, archive).count() == 0
        advance(pg, SAVED_MS + STEP_MS)
        assert "All changes saved." not in status_text(pg)


def test_wf_offline_reconnect_session_end(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a = login(app_url, ada)
    intake = d.sid("Intake")
    with workspace(browser, app_url, bea, d.did) as pg:
        tab = pg.context.new_page()
        tab.goto(f"{app_url}/")
        assert tab.evaluate(WS_JS, f"/ws?diagram={d.did}") == "open"
        seq = get_doc(a, d.did)["seq"]
        assert tab.request.post(f"{app_url}/api/auth/signout").status == 204
        poll(tab, lambda: tab.evaluate("() => window.__lwClose") == 4401, LIVE_S + SLACK_S, "socket closed 4401")
        dlg = pg.get_by_role("dialog", name="Sign in to continue")
        poll(pg, lambda: visible(dlg), WORK_S, "Sign in to continue")
        assert "Your session ended. Sign in to keep your changes." in status_text(pg)
        email = dlg.get_by_role("textbox", name="Email")
        assert email.input_value() == bea.email and not email.is_editable()
        key(pg, "Escape")
        click(shape_el(pg, intake))
        key(pg, "ArrowRight", 2)
        poll(pg, lambda: f"Your session ended. Sign in to keep your changes. {waiting(2)}" in status_text(pg), LIVE_S + SLACK_S, "queued under session end")
        assert get_doc(a, d.did)["seq"] == seq
        click(pg.get_by_role("button", name="Sign in again"))
        fill(dlg.get_by_label("Password", exact=True), OTHER_PASSWORD)
        click(dlg.get_by_role("button", name="Sign in"))
        poll(pg, lambda: visible(dlg.get_by_text("Email or password is incorrect.", exact=True)), WORK_S, "sign-in error in dialog")
        fill(dlg.get_by_label("Password", exact=True), bea.password)
        click(dlg.get_by_role("button", name="Sign in"))
        poll(pg, lambda: gone(dlg) and "All changes saved." in status_text(pg), WORK_S, "replayed after sign-in")
        doc = get_doc(a, d.did)
        assert doc["seq"] == seq + 2 and shape(doc, intake)["x"] == 40 + 2 * NUDGE
        assert urlparse(pg.url).path == f"/d/{d.did}"


def test_wf_comments_phone(browser, app_url):
    ada, cy = cast("ada", "cy")
    d, = seed(app_url, [ada, cy], [D(ada, [(cy, "viewer")], [pipeline(extra_shapes=[S("Check", 200, 300, 120, 120)])])])
    a = login(app_url, ada)
    corner = d.sid("Check")
    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, cy, d.did, viewport=PHONE, touch=True) as phone:
        cb = canvas_box(phone)
        ox, oy = view_origin(phone)
        corner_x, corner_y = math.floor(ox) + int(cb["width"]) - 140, math.floor(oy) + int(cb["height"]) - 140
        accept(a, d.did, move(corner, x=corner_x, y=corner_y))
        poll(phone, lambda: data_box(phone, corner)["x"] == corner_x, LIVE_S + SLACK_S, "Corner moved on phone")
        point = shape_el(phone, corner).evaluate("""el => { const r = el.getBoundingClientRect();
            for (let dx = 4; dx < r.width; dx += 6) for (let dy = 4; dy < r.height; dy += 6) {
              const x = r.right - dx, y = r.bottom - dy, h = document.elementFromPoint(x, y);
              if (h && el.contains(h)) return [x, y]; }
            return null; }""")
        assert point, "a visible point on Corner"
        touch(phone, "touchStart", [tuple(point)])
        advance(phone, LONG_PRESS_MS - 100)
        menu = phone.get_by_role("menu", name="Shape actions")
        assert gone(menu), "not before 500 ms"
        advance(phone, 100)
        touch(phone, "touchEnd", [])
        advance(phone, STEP_MS)
        poll(phone, lambda: visible(menu), LIVE_S + SLACK_S, "Shape actions opened")
        assert_menu_placement(phone, menu)
        assert [menu.get_by_role("menuitem").nth(i).inner_text().strip() for i in range(menu.get_by_role("menuitem").count())] == ["Comment"]
        tap(menu.get_by_role("menuitem", name="Comment"))
        sheet = phone.get_by_role("dialog", name="Comments")
        poll(phone, lambda: visible(sheet), LIVE_S + SLACK_S, "Comments sheet")
        body = f"Please check @{ada.email} thanks"
        fill(sheet.get_by_role("textbox", name="Comment"), body)
        tap(sheet.get_by_role("button", name="Post comment"))
        corner_label = "Check"
        pin = pg.get_by_role("button", name=f"Comment by {cy.name} on {corner_label}", exact=True)
        poll(pg, lambda: visible(pin), LIVE_S + SLACK_S + 1, "pin on Ada's screen")
        comment = next(c for c in a.get(f"/api/diagrams/{d.did}/comments").json()["comments"] if c["text"] == body)
        assert comment["shape"] == corner and comment["anchored"] is True and comment["author"]["id"] == cy.id
        s, pr = rect(shape_el(pg, corner)), rect(pin)
        reach = max(pr["w"], pr["h"]) + PX_TOL
        assert abs(pr["x"] + pr["w"] / 2 - (s["x"] + s["w"])) <= reach and abs(pr["y"] + pr["h"] / 2 - s["y"]) <= reach
        click(shape_el(pg, corner))
        key(pg, "ArrowLeft", 3)
        poll(pg, lambda: abs(rect(pin)["x"] - (pr["x"] - 3 * NUDGE)) <= PX_TOL, LIVE_S + SLACK_S, "pin follows")


def test_wf_comments_keyboard(browser, app_url):
    ada, cy = cast("ada", "cy")
    d, = seed(app_url, [ada, cy], [D(ada, [(cy, "viewer")], [P(shapes=[S("Alpha", 40, 120)])])])
    a = login(app_url, ada)
    alpha = d.sid("Alpha")
    body = fresh("Keyboard note")
    with workspace(browser, app_url, cy, d.did) as viewer, workspace(browser, app_url, ada, d.did) as pg:
        tab_to_canvas(viewer)
        poll(viewer, lambda: focus_state(viewer).get("shape") == alpha, LIVE_S + SLACK_S, "focus on Alpha")
        key(viewer, "Space")
        poll(viewer, lambda: shape_el(viewer, alpha).get_attribute("data-selected") == "true", LIVE_S + SLACK_S, "selected")
        key(viewer, "KeyM")
        box = viewer.get_by_role("textbox", name="Comment")
        poll(viewer, lambda: box.first.evaluate("e => e === document.activeElement"), LIVE_S + SLACK_S, "composer focused by M")
        viewer.keyboard.type(body)
        viewer.get_by_role("button", name="Post comment").first.focus()
        key(viewer, "Enter")
        comment = until_http(lambda: next((c for c in a.get(f"/api/diagrams/{d.did}/comments").json()["comments"] if c["text"] == body), None),
                             WORK_S, "comment saved")
        pin = pg.get_by_role("button", name=f"Comment by {cy.name} on Alpha", exact=True)
        poll(pg, lambda: visible(pin), LIVE_S + SLACK_S, "pin on Ada's screen")
        assert pin.get_attribute("id") == f"pin-{comment['id']}"
        pin.focus()
        key(pg, "Enter")
        resolve = pg.get_by_role("button", name="Resolve")
        poll(pg, lambda: visible(resolve), LIVE_S + SLACK_S, "thread opened from the pin")
        resolve.first.focus()
        key(pg, "Enter")
        poll(pg, lambda: published(pg, f"pin-{comment['id']}").count() == 0, LIVE_S + SLACK_S, "pin leaves Ada")
        poll(viewer, lambda: published(viewer, f"pin-{comment['id']}").count() == 0, LIVE_S + SLACK_S, "pin leaves Cy")


def test_wf_comments_reduced_motion(browser, app_url):
    ada, cy = cast("ada", "cy")
    d, = seed(app_url, [ada, cy], [D(ada, [(cy, "viewer")], [P(shapes=[S("Alpha", 40, 120), S("Delta", 400, 120)],
                                                              comments=[note("Alpha", cy, "Move me")])])])
    a = login(app_url, ada)
    alpha, delta, mid = d.sid("Alpha"), d.sid("Delta"), d.mid("Alpha")
    low = 360
    def pin_at_corner(pg) -> bool:
        p, s = rect(published(pg, f"pin-{mid}")), rect(shape_el(pg, alpha))
        return math.dist((p["x"] + p["w"] / 2, p["y"] + p["h"] / 2), (s["x"] + s["w"], s["y"])) <= max(p["w"], p["h"])
    with workspace(browser, app_url, cy, d.did, reduced=True) as viewer:
        poll(viewer, lambda: visible(published(viewer, f"pin-{mid}")), LIVE_S + SLACK_S, "pin shown")
        assert pin_at_corner(viewer)
        accept(a, d.did, move(alpha, y=low))
        poll(viewer, lambda: data_box(viewer, alpha)["y"] == low, LIVE_S + SLACK_S, "move arrives")
        advance(viewer, STEP_MS)
        drawn = rect(shape_el(viewer, alpha))["y"] - rect(shape_el(viewer, delta))["y"]
        assert abs(drawn - (low - data_box(viewer, delta)["y"])) <= PX_TOL, "remote move glided under reduced motion"
        assert pin_at_corner(viewer), "pin follows at once"

def test_wf_comments_resolve(browser, app_url):
    ada, cy, dee = cast("ada", "cy", "dee")
    d, = seed(app_url, [ada, cy, dee], [D(ada, [(cy, "viewer"), (dee, "viewer")], [pipeline(comments=[note("Intake", cy, "Is this final?")])])])
    a = login(app_url, ada)
    mid = d.mid("Intake")
    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, cy, d.did, viewport=PHONE, touch=True) as phone:
        click(pg.locator(f"#pin-{mid}"))
        advance(pg, STEP_MS)
        click(pg.get_by_role("button", name="Resolve"))
        poll([pg, phone], lambda: pg.locator(f"#pin-{mid}").count() == 0 and phone.locator(f"#pin-{mid}").count() == 0, LIVE_S + SLACK_S, "pin removed everywhere")
        tap(published(phone, "bottom-toolbar").get_by_role("button", name="Comments"))
        resolved_count = 1
        poll(phone, lambda: visible(phone.get_by_role("heading", name=f"Resolved ({resolved_count})")), LIVE_S + SLACK_S, "resolved heading")
    assert next(c for c in a.get(f"/api/diagrams/{d.did}/comments").json()["comments"] if c["id"] == mid)["resolved"] is True
    assert_error(a.post(f"/api/diagrams/{d.did}/comments/{mid}/resolve"), 409, "already_resolved")
    other = a.post(f"/api/diagrams/{d.did}/comments", json={"shape": d.sid("Review"), "text": "Owner note"})
    assert other.status_code == 201
    assert_error(login(app_url, dee).post(f"/api/diagrams/{d.did}/comments/{other.json()['comment']['id']}/resolve"), 403, "forbidden_role")


def test_mentions(app_url, mail):
    ada, bea, cy, outsider = cast("ada", "bea", "cy", "out")
    d, = seed(app_url, [ada, bea, cy, outsider], [D(ada, [(bea, "editor"), (cy, "viewer")], [pipeline()])])
    c = login(app_url, cy)
    body = f"@{ada.email},{bea.email} hi @{outsider.email} and @{cy.email}."
    assert c.post(f"/api/diagrams/{d.did}/comments", json={"shape": d.sid("Intake"), "text": body}).status_code == 201
    assert c.post(f"/api/diagrams/{d.did}/comments", json={"shape": d.sid("Review"), "text": f"ping @{bea.email.upper()}."}).status_code == 201
    subject = f'{cy.name} mentioned you on "{d.title}"'
    for who in (ada, bea):
        msgs = mail_for(mail, who.email, 1)
        assert len(msgs) == 1, who.email
        sole_recipient(msgs[0], who.email)
        assert msgs[0]["Subject"] == subject
        assert f"/d/{d.did}" in mail_text(msgs[0])
    assert mail_for(mail, outsider.email, 0) == [] and mail_for(mail, cy.email, 0) == []


def test_version_history(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a, b = login(app_url, ada), login(app_url, bea)
    started = time.monotonic()
    accept(a, d.did, move(d.sid("Intake"), x=48))
    seq = get_doc(a, d.did)["seq"]
    versions = lambda: a.get(f"/api/diagrams/{d.did}/versions").json()["versions"]
    auto = until_http(lambda: versions(), VERSION_INTERVAL_S + LIVE_S + WORK_S, "automatic version")
    assert time.monotonic() - started >= VERSION_INTERVAL_S - SLACK_S
    v = auto[0]
    assert v["name"] is None and v["displayName"] == f"Version {v['number']}" and v["number"] == 1
    assert v["author"]["id"] == ada.id and v["seq"] == seq
    WAIT.wait(VERSION_INTERVAL_S + LIVE_S + SLACK_S)
    assert len(versions()) == 1
    with workspace(browser, app_url, ada, d.did) as pg:
        pg.clock.set_system_time(SKEWED_CLOCK)
        key(pg, "Control+Alt+KeyH")
        vname = fresh("Version")
        created = b.post(f"/api/diagrams/{d.did}/versions", json={"name": vname})
        assert created.status_code == 201
        saved = created.json()["version"]
        newest = f"{vname} · {bea.name} · {history_time(saved['createdAt'])}"
        oldest = f"{v['displayName']} · {ada.name} · {history_time(v['createdAt'])}"
        link = pg.get_by_role("link", name=newest, exact=True)
        poll(pg, lambda: visible(link), TWO_S + SLACK_S, "new version listed")
        links = pg.get_by_role("link")
        names = [t for t in (links.nth(i).inner_text().strip() for i in range(links.count())) if t.endswith(" UTC")]
        assert names.index(newest) < names.index(oldest)
    assert [x["id"] for x in versions()][0] == saved["id"]


def test_wf_versions_restore_preview(browser, app_url):
    ada, = cast("ada")
    d, other = seed(app_url, [ada], [D(ada, pages=[pipeline()]), D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    intake = d.sid("Intake")
    vname = fresh("Version")
    before_version = a.post(f"/api/diagrams/{d.did}/versions", json={"name": vname}).json()["version"]
    vid = before_version["id"]
    foreign = a.post(f"/api/diagrams/{other.did}/versions", json={"name": "Elsewhere"}).json()["version"]["id"]
    accept(a, d.did, move(intake, x=200))
    banner = f"Previewing {vname}. Restore it or go back to the latest."
    with workspace(browser, app_url, ada, d.did) as pg:
        key(pg, "Control+Alt+KeyH")
        click(pg.get_by_role("link", name=f"{vname} · {ada.name} · {history_time(before_version['createdAt'])}", exact=True))
        q = lambda: parse_qs(urlparse(pg.url).query)
        poll(pg, lambda: q().get("version") == [vid] and visible(pg.get_by_text(banner, exact=True)), WORK_S, "preview")
        tool_buttons = pg.get_by_role("toolbar", name="Tools").get_by_role("button")
        assert data_box(pg, intake)["x"] == 40 and not any(tool_buttons.nth(i).is_enabled() for i in range(tool_buttons.count()))
        reload(pg, d.did)
        poll(pg, lambda: visible(pg.get_by_text(banner, exact=True)) and data_box(pg, intake)["x"] == 40, WORK_S, "preview after reload")
        pg.go_back()
        poll(pg, lambda: "version" not in q() and data_box(pg, intake)["x"] == 200, BOOT_S, "Back to latest")
        assert outside_announcer(pg, banner) == 0
        pg.go_forward()
        poll(pg, lambda: q().get("version") == [vid] and visible(pg.get_by_text(banner, exact=True)), BOOT_S, "Forward to preview")
        back = pg.get_by_role("button", name="Back to latest")
        if not visible(back):
            key(pg, "Control+Alt+KeyH")
        click(back)
        poll(pg, lambda: "version" not in q(), LIVE_S + SLACK_S, "Back to latest button")
        pg.goto(f"{app_url}/d/{d.did}?page={d.pid()}&version={vid}")
        poll(pg, lambda: visible(pg.get_by_text(banner, exact=True)), BOOT_S, "direct visit")
        resp = pg.goto(f"{app_url}/d/{d.did}?page={d.pid()}&version={foreign}")
        assert resp.status == 404
        poll(pg, lambda: visible(pg.get_by_role("heading", name="Diagram not found")), BOOT_S, "not-found page")


def test_wf_versions_restore_keyboard(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    vname = fresh("Version")
    version = a.post(f"/api/diagrams/{d.did}/versions", json={"name": vname}).json()["version"]
    accept(a, d.did, move(d.sid("Intake"), x=200))
    banner = f"Previewing {vname}. Restore it or go back to the latest."
    q = lambda pg: parse_qs(urlparse(pg.url).query)
    with workspace(browser, app_url, ada, d.did) as pg:
        key(pg, "Control+Alt+KeyH")
        link_ = pg.get_by_role("link", name=f"{vname} · {ada.name} · {history_time(version['createdAt'])}", exact=True)
        poll(pg, lambda: visible(link_), WORK_S, "version listed")
        link_.focus()
        key(pg, "Enter")
        poll(pg, lambda: q(pg).get("version") == [version["id"]] and outside_announcer(pg, banner) >= 1, WORK_S, "preview banner")
        back = pg.get_by_role("button", name="Back to latest")
        back.first.focus()
        key(pg, "Enter")
        poll(pg, lambda: "version" not in q(pg) and outside_announcer(pg, banner) == 0, WORK_S, "back to latest")

def test_exact_restore(app_url):
    ada, bea = cast("ada", "bea")
    d, other = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [
        P(layers=[L("Base"), L("Notes")], shapes=[S("A", 0, 120), S("B", 200, 120), S("Cc", 400, 300)],
          connectors=[C("A", "e", "Cc", "w"), C("B", "s", "Cc", "n")], groups=[("A", "B")], comments=[note("Cc", ada, "keep")]),
        P("Second", shapes=[S("Z", 40, 160)])]), D(ada)])
    a = login(app_url, ada)
    mid = d.mid("Cc")
    vname = fresh("Version")
    v = a.post(f"/api/diagrams/{d.did}/versions", json={"name": vname}).json()["version"]
    snapshot = a.get(f"/api/diagrams/{d.did}/versions/{v['id']}").json()["document"]
    accept(a, d.did, move(d.sid("A"), layer=d.lid("Notes")))
    accept(a, d.did, {"kind": "delete_connector", "connector": d.cid("B", "Cc")})
    accept(a, d.did, {"kind": "delete_shape", "shape": d.sid("Cc")})
    comment = lambda: next(c for c in a.get(f"/api/diagrams/{d.did}/comments").json()["comments"] if c["id"] == mid)
    assert comment()["anchored"] is False
    assert_error(login(app_url, bea).post(f"/api/diagrams/{d.did}/versions/{v['id']}/restore"), 403, "forbidden_role")
    foreign = a.post(f"/api/diagrams/{other.did}/versions", json={}).json()["version"]["id"]
    assert a.post(f"/api/diagrams/{d.did}/versions/{foreign}/restore").json() == NOT_FOUND_BODY
    r = a.post(f"/api/diagrams/{d.did}/versions/{v['id']}/restore")
    assert r.status_code == 200 and r.json()["version"]["name"] == f"Restored {vname}"
    now = get_doc(a, d.did)
    assert r.json()["seq"] == now["seq"]
    strip = lambda x: {k: val for k, val in x.items() if k != "seq"}
    assert strip(now) == strip(snapshot)
    assert comment()["anchored"] is True
    assert a.get(f"/api/diagrams/{d.did}/versions").json()["versions"][0]["name"] == f"Restored {vname}"


def test_wf_versions_restore_everyone(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline(comments=[note("Archive", ada, "retention")])])])
    a, b = login(app_url, ada), login(app_url, bea)
    archive, mid = d.sid("Archive"), d.mid("Archive")
    vname = fresh("Version")
    before_version = a.post(f"/api/diagrams/{d.did}/versions", json={"name": vname}).json()["version"]
    accept(b, d.did, {"kind": "delete_shape", "shape": archive})
    removed = get_doc(a, d.did)
    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, bea, d.did) as other:
        key(pg, "Control+Alt+KeyH")
        click(pg.get_by_role("link", name=f"{vname} · {ada.name} · {history_time(before_version['createdAt'])}", exact=True))
        click(pg.get_by_role("button", name="Restore this version"))
        poll(other, lambda: shape_el(other, archive).count() == 1 and visible(other.locator(f"#pin-{mid}")), TWO_S + SLACK_S, "restore reached Bea")
        wait_heard(other, f"{ada.name} restored {vname}.", TWO_S + SLACK_S)
        restored = until_http(lambda: (x := a.get(f"/api/diagrams/{d.did}/versions").json()["versions"][0])["name"] == f"Restored {vname}" and x,
                              WORK_S, "restored version recorded")
        restored_text = f"{restored['displayName']} · {ada.name} · {history_time(restored['createdAt'])}"
        poll(pg, lambda: "version" not in parse_qs(urlparse(pg.url).query) and visible(pg.get_by_role("link", name=restored_text, exact=True)), TWO_S + SLACK_S, "restored version listed")
        tab_to_canvas(pg)
        key(pg, "Control+KeyZ")
        poll([pg, other], lambda: shape_el(other, archive).count() == 0 and pg.locator(f"#pin-{mid}").count() == 0 and other.locator(f"#pin-{mid}").count() == 0,
             TWO_S + SLACK_S, "undo of restore everywhere")
    strip = lambda x: {k: val for k, val in x.items() if k != "seq"}
    assert strip(get_doc(a, d.did)) == strip(removed)
    assert next(c for c in a.get(f"/api/diagrams/{d.did}/comments").json()["comments"] if c["id"] == mid)["anchored"] is False


def test_accounts(browser, app_url):
    ada, newbie = cast("ada", "new")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    r = httpx.post(f"{app_url}/api/auth/signup", json={"name": "", "email": "", "password": "short"})
    body = assert_error(r, 422, "invalid")
    assert set(body["error"]["fields"]) and set(body["error"]["fields"]) <= {"name", "email", "password"}
    for field, ask in (("name", {"name": "", "email": newbie.email, "password": PASSWORD}),
                       ("email", {"name": newbie.name, "email": "", "password": PASSWORD}),
                       ("password", {"name": newbie.name, "email": newbie.email, "password": "short"})):
        assert field in assert_error(httpx.post(f"{app_url}/api/auth/signup", json=ask), 422, "invalid")["error"]["fields"], field
    assert_error(httpx.post(f"{app_url}/api/auth/signup", json={"name": ada.name, "email": ada.email, "password": PASSWORD}), 409, "email_taken")
    assert_error(httpx.post(f"{app_url}/api/auth/signin", json={"email": ada.email, "password": OTHER_PASSWORD}), 401, "bad_credentials")
    ok = httpx.post(f"{app_url}/api/auth/signin", json={"email": ada.email, "password": ada.password})
    cookie = ok.headers.get("set-cookie", "")
    assert "lw_session" in cookie and "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    assert login(app_url, ada).get("/api/me").json()["user"]["email"] == ada.email
    path = f"/d/{d.did}?page={d.pid()}"
    with open_app(browser, f"{app_url}{path}") as pg:
        poll(pg, lambda: urlparse(pg.url).path == "/signin", BOOT_S, "redirect to sign-in")
        assert parse_qs(urlparse(pg.url).query)["next"] == [path]
        fill(pg.get_by_role("textbox", name="Email"), ada.email)
        fill(pg.get_by_label("Password", exact=True), OTHER_PASSWORD)
        click(pg.get_by_role("button", name="Sign in"))
        poll(pg, lambda: visible(pg.get_by_text("Email or password is incorrect.", exact=True).first), WORK_S, "sign-in error")
        click(pg.get_by_role("link", name="Create an account"))
        poll(pg, lambda: urlparse(pg.url).path == "/signup" and parse_qs(urlparse(pg.url).query)["next"] == [path], BOOT_S, "cross-link keeps next")
        click(pg.get_by_role("button", name="Create account"))
        for message in ("Enter your name.", "Enter an email address.", "Use at least 10 characters."):
            poll(pg, lambda m=message: visible(pg.get_by_text(m, exact=True).first), WORK_S, message)
        fill(pg.get_by_role("textbox", name="Name"), newbie.name)
        fill(pg.get_by_role("textbox", name="Email"), ada.email)
        fill(pg.get_by_label("Password", exact=True), PASSWORD)
        click(pg.get_by_role("button", name="Create account"))
        poll(pg, lambda: visible(pg.get_by_text("An account with this email already exists.", exact=True).first), WORK_S, "taken email")
        click(pg.get_by_role("link", name="Sign in instead"))
        poll(pg, lambda: urlparse(pg.url).path == "/signin" and parse_qs(urlparse(pg.url).query)["next"] == [path], BOOT_S, "back to sign-in keeps next")
        sign_in_form(pg, ada)
        poll(pg, lambda: urlparse(pg.url).path == f"/d/{d.did}" and parse_qs(urlparse(pg.url).query)["page"] == [d.pid()], BOOT_S, "returned to next")
    with open_app(browser, f"{app_url}/signup?next={quote(UNSAFE_NEXT, safe='')}") as pg:
        fill(pg.get_by_role("textbox", name="Name"), newbie.name)
        fill(pg.get_by_role("textbox", name="Email"), newbie.email)
        fill(pg.get_by_label("Password", exact=True), PASSWORD)
        click(pg.get_by_role("button", name="Create account"))
        poll(pg, lambda: urlparse(pg.url).path == "/" and urlparse(pg.url).netloc == urlparse(app_url).netloc, BOOT_S, "unsafe next falls back to /")
        poll(pg, lambda: visible(pg.get_by_role("heading", name="Your diagrams")), BOOT_S, "diagram list")


def test_wf_roles_invites_share(browser, app_url, mail):
    ada, bea, cy = cast("ada", "bea", "cy")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    with workspace(browser, app_url, ada, d.did) as pg:
        click(pg.get_by_role("button", name="Share"))
        dlg = pg.get_by_role("dialog", name="Share")
        poll(pg, lambda: visible(dlg), LIVE_S + SLACK_S, "Share dialog")
        for who, role in ((bea, "Editor"), (cy, "Viewer")):
            fill(dlg.get_by_role("textbox", name="Email"), who.email)
            select(dlg.get_by_role("combobox", name="Role", exact=True), role)
            click(dlg.get_by_role("button", name="Send invite"))
            wait_heard(pg, f"Invite emailed to {who.email}.", WORK_S)
            members = dlg.get_by_role("list", name="Members")
            poll(pg, lambda w=who: "Invited" in members.get_by_role("listitem").filter(has_text=w.email).inner_text(), WORK_S, "Invited row")
    for who, article, role in ((bea, "an", "editor"), (cy, "a", "viewer")):
        msgs = mail_for(mail, who.email, 1)
        assert len(msgs) == 1
        sole_recipient(msgs[0], who.email)
        assert msgs[0]["Subject"] == f'{ada.name} shared "{d.title}" with you as {article} {role}'
        body = mail_text(msgs[0])
        assert f"/d/{d.did}" in body and not any(label in body for label in ("Intake", "Archive", "Review", "Store"))
    with open_app(browser, f"{app_url}/d/{d.did}") as pg:
        poll(pg, lambda: urlparse(pg.url).path == "/signin", BOOT_S, "sent to sign-in")
        click(pg.get_by_role("link", name="Create an account"))
        poll(pg, lambda: visible(pg.get_by_role("textbox", name="Name")), BOOT_S, "sign-up form")
        fill(pg.get_by_role("textbox", name="Name"), bea.name)
        fill(pg.get_by_role("textbox", name="Email"), bea.email)
        fill(pg.get_by_label("Password", exact=True), bea.password)
        click(pg.get_by_role("button", name="Create account"))
        wait_canvas(pg, d.did)
        poll(pg, lambda: visible(pg.get_by_role("toolbar", name="Tools")), WORK_S, "editor tools")
    member = next(m for m in a.get(f"/api/diagrams/{d.did}/members").json()["members"] if m["email"] == bea.email)
    assert member["status"] == "active" and member["role"] == "editor"


def test_wf_roles_invites_expiry(browser, app_url):
    with app_copy({"INVITE_TTL_MS": str(INVITE_TTL_S * 1000), "GRADING_ROUTES": "on"}) as app_url:
        ada, cy = cast("ada", "cy")
        d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
        a = login(app_url, ada)
        with workspace(browser, app_url, ada, d.did) as pg:
            created = time.monotonic()
            inv = a.post(f"/api/diagrams/{d.did}/invites", json={"email": cy.email, "role": "viewer"})
            assert inv.status_code == 201
            first_expiry = inv.json()["invite"]["expiresAt"]
            assert_error(a.post(f"/api/diagrams/{d.did}/invites", json={"email": cy.email, "role": "viewer"}), 409, "already_invited")
            click(pg.get_by_role("button", name="Share"))
            dlg = pg.get_by_role("dialog", name="Share")
            row = lambda: dlg.get_by_role("list", name="Members").get_by_role("listitem").filter(has_text=cy.email)
            poll(pg, lambda: "Invited" in row().inner_text(), WORK_S, "Invited before expiry")
            poll(pg, lambda: "Expired" in row().inner_text(), INVITE_TTL_S - (time.monotonic() - created) + TWO_S + SLACK_S, "turns Expired")
            assert next(i for i in a.get(f"/api/diagrams/{d.did}/members").json()["invites"] if i["email"] == cy.email)["status"] == "expired"
            r = httpx.post(f"{app_url}/api/auth/signup", json={"name": cy.name, "email": cy.email, "password": cy.password})
            assert r.status_code == 201
            late = login(app_url, cy)
            assert late.get(f"/api/diagrams/{d.did}/document").json() == NOT_FOUND_BODY
            pg.clock.set_system_time(SKEWED_CLOCK)
            click(dlg.get_by_role("button", name=f"Resend invite to {cy.email}"))
            poll(pg, lambda: "Invited" in row().inner_text(), WORK_S, "reopened by resend")
        resent = next(i for i in a.get(f"/api/diagrams/{d.did}/members").json()["invites"] if i["email"] == cy.email)
        assert resent["status"] == "emailed" and resent["expiresAt"] > first_expiry
        with workspace(browser, app_url, cy, d.did) as pg:
            poll(pg, lambda: visible(pg.get_by_text(f"View only. Ask {ada.name} for edit access.", exact=True)), WORK_S, "viewer banner")
            assert pg.get_by_role("toolbar", name="Tools").count() == 0


def test_wf_roles_invites_downgrade(browser, app_url):
    ada, bea = cast("ada", "bea")
    d, = seed(app_url, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a, b = login(app_url, ada), login(app_url, bea)
    intake = d.sid("Intake")
    with workspace(browser, app_url, bea, d.did) as pg:
        tools = pg.get_by_role("toolbar", name="Tools")
        assert visible(tools)
        click(shape_el(pg, intake))
        cx, cy_ = center(shape_el(pg, intake))
        pg.mouse.move(cx, cy_)
        pg.mouse.down()
        pg.mouse.move(cx + 80, cy_)
        advance(pg, FRAME_MS)
        assert a.patch(f"/api/diagrams/{d.did}/members/{bea.id}", json={"role": "viewer"}).status_code == 200
        assert_error(send(b, d.did, move(intake, x=8)), 403, "forbidden_role")
        pg.mouse.up()
        advance(pg, STEP_MS)
        poll(pg, lambda: tools.count() == 0 and visible(pg.get_by_text(f"View only. Ask {ada.name} for edit access.", exact=True)), TWO_S + SLACK_S, "view-only within 2 s")
        assert focus_state(pg)["inCanvas"]
        assert shape(get_doc(a, d.did), intake)["x"] == 40
        poll(pg, lambda: data_box(pg, intake)["x"] == 40, TWO_S + SLACK_S, "in-flight change rolled back")
        assert a.patch(f"/api/diagrams/{d.did}/members/{bea.id}", json={"role": "editor"}).status_code == 200
        poll(pg, lambda: visible(tools), TWO_S + SLACK_S, "tools return")
        assert send(b, d.did, move(intake, x=48)).status_code == 200


def test_view_only(browser, app_url):
    ada, cy = cast("ada", "cy")
    d, = seed(app_url, [ada, cy], [D(ada, [(cy, "viewer")], [pipeline()])])
    c, a = login(app_url, cy), login(app_url, ada)
    intake = d.sid("Intake")
    edits = [move(intake, x=8), {"kind": "update_shapes", "shapes": [{"shape": intake, "set": {"x": 8}}]}, {"kind": "delete_shape", "shape": intake},
             {"kind": "add_shape", "page": d.pid(), "layer": d.lid("Base"), "clientRef": "probe-ref", "shape": {"kind": "text", "x": 0, "y": 0, "w": 40, "h": 40, "label": ""}},
             {"kind": "add_connector", "page": d.pid(), "from": {"shape": intake, "port": "s"}, "to": {"shape": d.sid("Log"), "port": "n"}, "label": "", "clientRef": "probe-ref"},
             {"kind": "delete_connector", "connector": d.cid("Log", "Store")}]
    before = get_doc(a, d.did)
    for op in edits:
        assert_error(send(c, d.did, op), 403, "forbidden_role")
    assert_error(c.post(f"/api/diagrams/{d.did}/versions", json={}), 403, "forbidden_role")
    assert_error(request_export(c, d.did, d.pid()), 403, "forbidden_role")
    assert get_doc(a, d.did) == before
    assert c.post(f"/api/diagrams/{d.did}/comments", json={"shape": intake, "text": "Viewer note"}).status_code == 201
    with workspace(browser, app_url, cy, d.did) as pg:
        assert visible(pg.get_by_text(f"View only. Ask {ada.name} for edit access.", exact=True))
        assert pg.get_by_role("toolbar", name="Tools").count() == 0
        assert pg.get_by_role("button", name="Share").count() == 0 and pg.get_by_role("button", name="Export").count() == 0
        layers = pg.get_by_role("region", name="Layers")
        forbidden = [f(n) for n in ("Base", "Notes", "Walls") for f in (hide_toggle, lock_toggle, show_toggle, unlock_toggle)] + ["Add layer"]
        assert visible(layers.get_by_text("Base", exact=True))
        assert sum(layers.get_by_role("button", name=n, exact=True).count() for n in forbidden) == 0
        click(shape_el(pg, intake))
        key(pg, "ArrowRight")
        key(pg, "Delete")
        key(pg, "Shift+F10")
        menu = pg.get_by_role("menu", name="Shape actions")
        poll(pg, lambda: visible(menu), LIVE_S + SLACK_S, "Shape actions")
        assert [menu.get_by_role("menuitem").nth(i).inner_text().strip() for i in range(menu.get_by_role("menuitem").count())] == ["Comment"]
    assert get_doc(a, d.did)["seq"] == before["seq"]


def test_uniform_not_found(browser, app_url):
    ada, mallory = cast("ada", "mal")
    d, other = seed(app_url, [ada, mallory], [D(ada, pages=[pipeline()]), D(ada, pages=[pipeline()])])
    a, m = login(app_url, ada), login(app_url, mallory)
    vid = a.post(f"/api/diagrams/{d.did}/versions", json={}).json()["version"]["id"]
    xid = request_export(a, d.did, d.pid()).json()["id"]
    missing = "d_" + uuid.uuid4().hex[:12]
    for did in (d.did, missing):
        calls = [("GET", f"/api/diagrams/{did}/document", None), ("GET", f"/api/diagrams/{did}/members", None),
                 ("GET", f"/api/diagrams/{did}/comments", None), ("GET", f"/api/diagrams/{did}/versions", None),
                 ("GET", f"/api/diagrams/{did}/versions/{vid}", None), ("GET", f"/api/diagrams/{did}/exports", None),
                 ("POST", f"/api/diagrams/{did}/operations", {"opId": op_id(), "baseSeq": 0, "op": move(d.sid("Intake"), x=8)}),
                 ("POST", f"/api/diagrams/{did}/comments", {"shape": d.sid("Intake"), "text": "x"}),
                 ("POST", f"/api/diagrams/{did}/invites", {"email": mallory.email, "role": "editor"}),
                 ("POST", f"/api/diagrams/{did}/versions", {}), ("POST", f"/api/diagrams/{did}/exports", {"page": d.pid(), "format": "svg", "scale": 1, "background": "white"})]
        for method, path, body in calls:
            r = m.request(method, path, json=body)
            assert r.status_code == 404 and r.json() == NOT_FOUND_BODY, (did, path, r.text)
        page = m.get(f"/d/{did}")
        assert page.status_code == 404
    for path in (f"/api/exports/{xid}", f"/api/exports/{xid}/file"):
        assert m.get(path).json() == NOT_FOUND_BODY
    foreign = a.post(f"/api/diagrams/{other.did}/versions", json={}).json()["version"]["id"]
    assert a.get(f"/api/diagrams/{d.did}/versions/{foreign}").json() == NOT_FOUND_BODY
    assert a.get(f"/d/{d.did}?page={d.pid()}&version={foreign}").status_code == 404
    r = send(a, d.did, move(other.sid("Intake"), x=8))
    assert r.status_code == 404 and r.json() == NOT_FOUND_BODY, "nested foreign id is not_found, not 422"
    with open_app(browser, f"{app_url}/signin") as pg:
        sign_in_form(pg, mallory)
        poll(pg, lambda: urlparse(pg.url).path == "/", BOOT_S, "signed in")
        for did in (d.did, missing):
            pg.evaluate(WS_JS, f"/ws?diagram={did}")
            poll(pg, lambda: pg.evaluate("() => window.__lwClose") == 4404, WORK_S, f"socket 4404 for {did}")
        resp = pg.goto(f"{app_url}/d/{d.did}")
        assert resp.status == 404
        poll(pg, lambda: visible(pg.get_by_role("heading", name="Diagram not found")) and visible(pg.get_by_text("This diagram doesn't exist or you don't have access to it.", exact=True)), BOOT_S, "not-found copy")


def test_mail_outage_invites(browser, mail):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    ada, bea, cy = cast("ada", "bea", "cy")
    d, = seed(base, [ada, bea], [D(ada, [(bea, "editor")], [pipeline()])])
    a = login(base, ada)
    inv = a.post(f"/api/diagrams/{d.did}/invites", json={"email": cy.email, "role": "viewer"})
    assert inv.status_code == 201 and inv.json()["invite"]["status"] == "email_not_sent"
    assert a.post(f"/api/diagrams/{d.did}/comments", json={"shape": d.sid("Intake"), "text": f"@{bea.email} look"}).status_code == 201
    banner = "Email is unavailable. The invite is saved; use Resend when email is back."
    with workspace(browser, base, ada, d.did) as pg:
        assert outside_announcer(pg, banner) == 0
        click(pg.get_by_role("button", name="Share"))
        dlg = pg.get_by_role("dialog", name="Share")
        row = dlg.get_by_role("list", name="Members").get_by_role("listitem").filter(has_text=cy.email)
        poll(pg, lambda: "Email not sent" in row.inner_text(), WORK_S, "Email not sent row")
        resend = dlg.get_by_role("button", name=f"Resend invite to {cy.email}")
        assert visible(resend)
        click(resend)
        poll(pg, lambda: visible(dlg.get_by_text(banner, exact=True)), WORK_S, "mail outage banner after a failed resend")
        in_share = dlg.get_by_text(banner, exact=True)
        assert outside_announcer(pg, banner) == sum(1 for i in range(in_share.count()) if in_share.nth(i).is_visible()), "banner only inside Share"
    assert mail_for(mail, cy.email, 0) == [] and mail_for(mail, bea.email, 0) == []
    port = free_port()
    relay = Relay(port, (os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])))
    owner, invitee = cast("ada", "dee")
    with app_copy({"SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(port), "GRADING_ROUTES": "on"}) as copy:
        e, = seed(copy, [owner], [D(owner, pages=[pipeline()])])
        o = login(copy, owner)
        first = o.post(f"/api/diagrams/{e.did}/invites", json={"email": invitee.email, "role": "editor"}).json()["invite"]
        assert first["status"] == "email_not_sent"
        relay.start()
        try:
            r = o.post(f"/api/diagrams/{e.did}/invites/{first['id']}/resend")
            assert r.status_code == 200 and r.json()["invite"]["status"] == "emailed"
            msgs = mail_for(mail, invitee.email, 1)
            assert len(msgs) == 1
            sole_recipient(msgs[0], invitee.email)
        finally:
            relay.stop()


TEXT_ROUTES = ["signup_name", "diagram_title", "seed_title", "seed_name"]


@pytest.mark.parametrize("route", TEXT_ROUTES, ids=TEXT_ROUTES)
def test_header_safe_titles(app_url, route):
    for ch in ("\n", "\r", "\x00", "\t", "\x1f", "\x7f"):
        who, = cast("bea")
        if route == "signup_name":
            r = httpx.post(f"{app_url}/api/auth/signup", json={"name": f"Bea{ch}Okafor", "email": who.email, "password": who.password})
            path = "name"
            created = httpx.post(f"{app_url}/api/auth/signin", json={"email": who.email, "password": who.password}).status_code != 401
        elif route == "diagram_title":
            seed(app_url, [who], [])
            c = login(app_url, who)
            title = fresh(f"Pipe{ch}line")
            r = c.post("/api/diagrams", json={"title": title})
            path = "title"
            created = any(x["title"] == title for x in c.get("/api/diagrams").json()["diagrams"])
        else:
            spec = D(who)
            if route == "seed_title":
                spec["title"], path = f"Pipe{ch}line", "diagrams.0.title"
            else:
                who.name, path = f"Bea{ch}Okafor", "users.0.name"
            r = post_json(app_url, "/api/grading/seed", seed_request([who], [spec]))
            created = httpx.post(f"{app_url}/api/auth/signin", json={"email": who.email, "password": who.password}).status_code != 401
        body = assert_error(r, 422, "invalid")
        assert path in body["error"]["fields"], (route, repr(ch), body)
        assert not created, (route, repr(ch))


def test_storage_confirmed_export(app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    s3 = S3()
    for fmt in ("svg", "png"):
        r = request_export(a, d.did, d.pid(), fmt)
        assert r.status_code == 202
        start = r.json()
        assert start["status"] == "rendering" and start["width"] is None and start["height"] is None
        ready = wait_export(a, start["id"], "ready")
        key_ = f"exports/{d.did}/{start['id']}.{fmt}"
        assert key_ in s3.keys(f"exports/{d.did}/")
        assert isinstance(ready["width"], int) and isinstance(ready["height"], int)
        assert a.get(f"/api/exports/{start['id']}/file").content == s3.get(key_)


def test_clean_svg_export(app_url):
    ada, = cast("ada")
    tricky = 'a<b>&"c"'
    d, = seed(app_url, [ada], [D(ada, pages=[P(layers=[L("Base"), L("Notes", visible=False)],
        shapes=[S(tricky, 40, 120), S("Plain", 400, 120), S("Archive", 200, 320, layer="Notes")],
        connectors=[C(tricky, "e", "Plain", "w", "x<y&z"), C("Plain", "s", "Archive", "e")],
        comments=[note("Plain", ada, "comment clutter")])])])
    a = login(app_url, ada)
    body, f = ready_export(a, d.did, d.pid())
    assert f.headers["content-type"].startswith("image/svg+xml")
    root = ET.fromstring(f.content)
    doc = get_doc(a, d.did)
    page = page_doc(doc, d.pid())
    assert local(root.tag) == "svg" and root.get("data-seq") == str(body["seq"])
    vb = [float(v) for v in root.get("viewBox").replace(",", " ").split()]
    assert all(abs(x - y) <= PX_TOL for x, y in zip(vb, expected_view_box(page)))
    ids = svg_ids(root)
    shape_groups = {k for k in ids if k.startswith("shape-")}
    assert shape_groups == {f"shape-{d.sid(tricky)}", f"shape-{d.sid('Plain')}"}
    assert {k for k in ids if k.startswith("connector-")} == {f"connector-{d.cid(tricky, 'Plain')}"}
    assert tricky in texts_in(ids[f"shape-{d.sid(tricky)}"])
    cg = ids[f"connector-{d.cid(tricky, 'Plain')}"]
    labels = [t for t in cg.iter() if local(t.tag) == "text" and "connector-label" in (t.get("class") or "").split()]
    assert ["".join(t.itertext()) for t in labels] == ["x<y&z"]
    assert same_route(svg_route(cg), find(doc, "connectors", d.cid(tricky, "Plain"))["route"])
    raw = f.content.decode()
    assert "Archive" not in raw and "comment clutter" not in raw
    assert not any(k.startswith(("pin-", "cursor-")) for k in ids)
    assert not any(local(el.tag) in ("script", "foreignObject") for el in root.iter())


def test_png_export_size(app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    body, f = ready_export(a, d.did, d.pid(), "png", 2, "transparent")
    assert f.headers["content-type"].startswith("image/png")
    width, height, colour, data = png_header(f.content)
    _, _, vw, vh = expected_view_box(page_doc(get_doc(a, d.did), d.pid()))
    assert abs(width - vw * 2) <= PX_TOL and abs(height - vh * 2) <= PX_TOL
    assert colour in (4, 6), "alpha channel"
    assert (body["width"], body["height"]) == (width, height)


def test_wf_export_storage_outage(browser):
    base = os.environ["APP_MINIO_DOWN_URL"]
    ada, = cast("ada")
    d, = seed(base, [ada], [D(ada, pages=[pipeline()])])
    a = login(base, ada)
    paused = "Exports are paused: storage is unavailable. Editing still works."
    with workspace(browser, base, ada, d.did) as pg:
        key(pg, "Control+Shift+KeyE")
        dlg = pg.get_by_role("dialog", name="Export")
        poll(pg, lambda: visible(dlg), LIVE_S + SLACK_S, "Export dialog")
        check(dlg.get_by_role("radio", name="SVG"))
        click(dlg.get_by_role("button", name="Export"))
        poll(pg, lambda: visible(dlg.get_by_text(paused, exact=True)) and visible(dlg.get_by_role("button", name="Try again")), STORAGE_WAIT_S + WORK_S, "paused in dialog")
        xid = a.get(f"/api/diagrams/{d.did}/exports").json()["exports"][0]["id"]
        assert export_body(a, xid)["status"] == "storage_unavailable"
        assert_error(a.get(f"/api/exports/{xid}/file"), 409, "export_not_ready")
        key(pg, "Escape")
        assert visible(pg.get_by_text(paused, exact=True))
        reload(pg, d.did)
        poll(pg, lambda: visible(pg.get_by_text(paused, exact=True)), WORK_S, "paused banner after reload")
        click(shape_el(pg, d.sid("Intake")))
        key(pg, "ArrowRight")
        poll([], lambda: shape(get_doc(a, d.did), d.sid("Intake"))["x"] == 40 + NUDGE, WORK_S, "editing still saves")
        key(pg, "Control+Shift+KeyE")
        retry = dlg.get_by_role("button", name="Try again")
        poll(pg, lambda: visible(retry), WORK_S, "Try again shown")
        c = center(retry)
        pg.mouse.click(*c)
        pg.mouse.click(*c)
        advance(pg, STEP_MS)
        pending = f"Exporting {page_doc(get_doc(a, d.did), d.pid())['name']}..."
        poll(pg, lambda: visible(dlg.get_by_text(pending, exact=True)) or visible(dlg.get_by_text(paused, exact=True)), WORK_S, "pending or paused after retry")
        assert len(a.get(f"/api/diagrams/{d.did}/exports").json()["exports"]) == 1
    h = httpx.get(f"{base}/api/health")
    assert h.status_code == 200 and h.json() == {"status": "ok"}


def test_wf_export_dialog(browser, app_url):
    ada, cy = cast("ada", "cy")
    d, = seed(app_url, [ada, cy], [D(ada, [(cy, "viewer")], [pipeline(extra_shapes=[S("Start", 600, 300, 80, 40, "Notes")])])])
    a = login(app_url, ada)
    with workspace(browser, app_url, ada, d.did) as pg, workspace(browser, app_url, cy, d.did) as viewer:
        posts = []
        pg.on("request", lambda r: posts.append(r.url) if r.method == "POST" and urlparse(r.url).path == f"/api/diagrams/{d.did}/exports" else None)
        click(pg.get_by_role("button", name=hide_toggle("Notes"), exact=True))
        poll([], lambda: not get_doc(a, d.did)["pages"][0]["layers"][1]["visible"], WORK_S, "Notes hidden")
        click(pg.get_by_role("button", name="Export"))
        dlg = pg.get_by_role("dialog", name="Export")
        check(dlg.get_by_role("radio", name="SVG"))
        c = center(dlg.get_by_role("button", name="Export"))
        pg.mouse.click(*c)
        pg.mouse.click(*c)
        advance(pg, STEP_MS)
        key(pg, "Escape")
        click(pg.get_by_role("toolbar", name="Tools").get_by_role("button", name="Rectangle"))
        pg.keyboard.type("Check")
        key(pg, "Enter")
        reload(pg, d.did)
        exports = until_http(lambda: (x := a.get(f"/api/diagrams/{d.did}/exports").json()["exports"]) and x[0]["status"] == "ready" and x, STORAGE_WAIT_S + WORK_S, "export ready")
        ready_at = time.monotonic()
        poll(viewer, lambda: visible(viewer.get_by_role("link", name="Download latest export")), TWO_S + SLACK_S, "Cy sees the link")
        assert time.monotonic() - ready_at <= TWO_S + SLACK_S
        wait_heard(pg, "Export ready.", TWO_S + SLACK_S)
        advance(pg, OFFLINE_MS)
        assert heard(pg).count("Export ready.") == 1 and len(posts) == 1 and len(exports) == 1
        assert S3().keys(f"exports/{d.did}/") == [f"exports/{d.did}/{exports[0]['id']}.svg"]
        key(pg, "Control+Shift+KeyE")
        poll(pg, lambda: visible(dlg.get_by_role("link", name="Download SVG")), LIVE_S + SLACK_S, "dialog shows ready state")
    raw = a.get(f"/api/exports/{exports[0]['id']}/file").content.decode()
    assert "Check" not in raw and "Start" not in raw and f"shape-{d.sid('Intake')}" in raw


def test_wf_export_keyboard(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    with workspace(browser, app_url, ada, d.did) as pg:
        opener = pg.get_by_role("group", name="View").get_by_role("button", name="Toggle inspector")
        opener.first.focus()
        advance(pg, STEP_MS)
        assert opener.first.evaluate("e => e === document.activeElement"), "opener holds focus"
        key(pg, "Control+Shift+KeyE")
        dlg = pg.get_by_role("dialog", name="Export")
        poll(pg, lambda: visible(dlg) and dlg.evaluate("e => e.contains(document.activeElement)"), LIVE_S + SLACK_S, "dialog focused")
        svg = dlg.get_by_role("radio", name="SVG")
        if not svg.is_checked():
            svg.focus()
            key(pg, "Space")
        assert svg.is_checked()
        dlg.get_by_role("button", name="Export").focus()
        key(pg, "Enter")
        wait_heard(pg, "Export ready.", STORAGE_WAIT_S + WORK_S)
        assert visible(dlg.get_by_role("link", name="Download SVG"))
        key(pg, "Escape")
        poll(pg, lambda: gone(dlg) and not focus_state(pg)["body"], LIVE_S + SLACK_S, "dialog closed, focus kept off the body")

def test_one_export_per_request(app_url):
    hole = BlackHole(free_port())
    hole.start()
    try:
        with app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{hole.port}", "GRADING_ROUTES": "on"}) as slow:
            ada, = cast("ada")
            d, = seed(slow, [ada], [D(ada, pages=[pipeline()])])
            a = login(slow, ada)
            first = request_export(a, d.did, d.pid())
            assert first.status_code == 202
            assert export_body(a, first.json()["id"])["status"] == "rendering"
            again = request_export(a, d.did, d.pid())
            assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
            png = request_export(a, d.did, d.pid(), "png")
            assert png.status_code == 202 and png.json()["id"] != first.json()["id"]
            assert len([x for x in a.get(f"/api/diagrams/{d.did}/exports").json()["exports"] if x["format"] == "svg"]) == 1
    finally:
        hole.stop()
    base = os.environ["APP_MINIO_DOWN_URL"]
    racer, = cast("ada")
    r_, = seed(base, [racer], [D(racer, pages=[pipeline()])])
    a = login(base, racer)
    first = request_export(a, r_.did, r_.pid())
    assert first.status_code == 202
    xid = first.json()["id"]
    wait_export(a, xid, "storage_unavailable")
    clients = [login(base, racer) for _ in range(5)]
    rs = together([lambda c=c: c.post(f"/api/exports/{xid}/retry") for c in clients])
    assert [r.status_code for r in rs].count(202) == 1
    assert all(r.json()["error"]["code"] == "export_not_retryable" for r in rs if r.status_code != 202)
    owner, = cast("ada")
    e, = seed(app_url, [owner], [D(owner, pages=[pipeline()])])
    o = login(app_url, owner)
    seq = get_doc(o, e.did)["seq"]
    req = request_export(o, e.did, e.pid())
    ref = op_id()
    later = accept(o, e.did, {"kind": "add_shape", "page": e.pid(), "layer": e.lid("Base"), "clientRef": ref,
                              "shape": {"kind": "rectangle", "x": 600, "y": 500, "w": 40, "h": 40, "label": "Check"}})
    body = wait_export(o, req.json()["id"], "ready")
    root = ET.fromstring(o.get(f"/api/exports/{body['id']}/file").content)
    assert body["seq"] == seq and root.get("data-seq") == str(seq)
    later_id = later["ids"][ref]
    assert f"shape-{later_id}" not in svg_ids(root) and "Check" not in "".join(root.itertext())


def test_published_layouts(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    with workspace(browser, app_url, ada, d.did) as pg:
        left, right, canvas = published(pg, "left-rail").bounding_box(), published(pg, "inspector-rail").bounding_box(), canvas_box(pg)
        assert abs(left["width"] - LEFT_RAIL_PX) <= PX_TOL and abs(right["width"] - INSPECTOR_RAIL_PX) <= PX_TOL
        assert left["x"] + left["width"] <= canvas["x"] + PX_TOL and canvas["x"] + canvas["width"] <= right["x"] + PX_TOL
        layout(pg)
        pg.set_viewport_size(TABLET)
        advance(pg, RAIL_MS)
        right, canvas = published(pg, "inspector-rail").bounding_box(), canvas_box(pg)
        assert abs(right["width"] - INSPECTOR_RAIL_PX) <= PX_TOL and canvas["x"] <= PX_TOL
        assert not published(pg, "left-rail").is_visible() and visible(pg.get_by_role("button", name="Layers", exact=True))
        layout(pg)
        pg.set_viewport_size(PHONE)
        advance(pg, RAIL_MS)
        assert pg.get_by_role("toolbar", name="Tools").count() == 0
        assert not published(pg, "inspector-rail").is_visible() and not published(pg, "left-rail").is_visible()
        bar = published(pg, "bottom-toolbar")
        for name in ("Layers", "Inspector", "Comments", "History", "Shape actions", "Insert"):
            assert visible(bar.get_by_role("button", name=name, exact=True)), name
        assert abs(canvas_box(pg)["width"] - PHONE["width"]) <= PX_TOL
        layout(pg)
        for role in ("button", "link", "tab"):
            items = pg.get_by_role(role)
            for i in range(items.count()):
                if items.nth(i).is_visible():
                    b = items.nth(i).bounding_box()
                    assert b["width"] >= TARGET_MIN_PX - PX_TOL and b["height"] >= TARGET_MIN_PX - PX_TOL, (role, i, b)
        tap(bar.get_by_role("button", name="Inspector"))
        poll(pg, lambda: visible(pg.get_by_role("dialog", name="Inspector")), LIVE_S + SLACK_S, "Inspector sheet")
        key(pg, "Escape")
        tap(bar.get_by_role("button", name="Comments"))
        poll(pg, lambda: visible(pg.get_by_role("dialog", name="Comments")) and gone(pg.get_by_role("dialog", name="Inspector")), LIVE_S + SLACK_S, "one sheet at a time")


def test_wf_phone_touch_motion_gestures(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Alpha", 40, 160), S("Beta", 200, 300)])])])
    a = login(app_url, ada)
    alpha = d.sid("Alpha")
    with workspace(browser, app_url, ada, d.did, viewport=PHONE, touch=True) as pg:
        readout = pg.get_by_role("status", name="Zoom")
        assert readout.inner_text().strip() == "100%"
        tap(shape_el(pg, alpha))
        assert shape_el(pg, alpha).get_attribute("data-selected") == "true"
        before = rect(shape_el(pg, alpha))
        empty = screen(pg, 300, 120)
        touch_path(pg, [empty], [(empty[0] - 60, empty[1])])
        poll(pg, lambda: abs(rect(shape_el(pg, alpha))["x"] - (before["x"] - 60)) <= PX_TOL + 1, LIVE_S + SLACK_S, "pan")
        assert shape(get_doc(a, d.did), alpha)["x"] == 40
        cx, cy = center(shape_el(pg, alpha))
        touch_path(pg, [(cx, cy)], [(cx + 40, cy)])
        poll([], lambda: shape(get_doc(a, d.did), alpha)["x"] != 40, WORK_S, "touch move saved")
        mid = screen(pg, 180, 260)
        touch_path(pg, [(mid[0] - 20, mid[1]), (mid[0] + 20, mid[1])], [(mid[0] - 90, mid[1]), (mid[0] + 90, mid[1])])
        poll(pg, lambda: readout.inner_text().strip() != "100%", LIVE_S + SLACK_S, "pinch zoom")
        key(pg, "Control+Digit0")
        assert readout.inner_text().strip() == "100%"
        tap(pg.get_by_role("group", name="View").get_by_role("button", name="Zoom in"))
        assert readout.inner_text().strip() == f"{ZOOM_AFTER_100}%"
        key(pg, "Control+Digit0")
        bx, by = center(shape_el(pg, d.sid("Beta")))
        touch(pg, "touchStart", [(bx, by)])
        advance(pg, LONG_PRESS_MS)
        touch(pg, "touchEnd", [])
        menu = pg.get_by_role("menu", name="Shape actions")
        poll(pg, lambda: visible(menu), LIVE_S + SLACK_S, "long press menu")
        assert shape_el(pg, d.sid("Beta")).get_attribute("data-selected") == "true"
        names = [menu.get_by_role("menuitem").nth(i).inner_text().strip() for i in range(menu.get_by_role("menuitem").count())]
        assert names == ["Comment", "Duplicate", "Delete", "Bring forward", "Send backward"]


def test_reversing_inspector_rail(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    for reduced in (False, True):
        with workspace(browser, app_url, ada, d.did, reduced=reduced) as pg:
            rail = published(pg, "inspector-rail")
            toggle = pg.get_by_role("button", name="Toggle inspector")
            state = lambda: (rail.get_attribute("data-motion"), rail.get_attribute("data-progress"))
            assert state() == ("open", "1.00")
            clear_attr_log(pg)
            click(toggle)
            if reduced:
                advance(pg, STEP_MS)
                assert state() == ("closed", "0.00")
                assert not [e for e in attr_log(pg) if e["name"] == "data-motion" and e["value"] in ("opening", "closing")]
                continue
            advance(pg, RAIL_MS / 2)
            motion_, progress = state()
            p = float(progress)
            two_decimals = len(progress) == len("1.00") and progress[1] == "."
            assert motion_ == "closing" and two_decimals and abs(p - 0.5) <= PROGRESS_TOL, state()
            click(toggle)
            advance(pg, FRAME_MS)
            assert rail.get_attribute("data-motion") == "opening" and p - PROGRESS_TOL <= float(rail.get_attribute("data-progress")) < 1.0
            advance(pg, (1 - p) * RAIL_MS / 2)
            assert rail.get_attribute("data-motion") == "opening", "reopen takes (1 - p) x 200 ms"
            advance(pg, (1 - p) * RAIL_MS / 2 + 2 * FRAME_MS)
            assert state() == ("open", "1.00")
            values = [float(e["value"]) for e in attr_log(pg) if e["name"] == "data-progress" and e["value"]]
            assert values and min(values) >= p - PROGRESS_TOL, "never jumped to the closed end mid-motion"
            click(toggle)
            advance(pg, RAIL_MS + 2 * FRAME_MS)
            assert state() == ("closed", "0.00") and toggle.get_attribute("aria-expanded") == "false"


def test_wf_phone_touch_motion_menus(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Alpha", 40, 160), S("Edge", 600, 480)])])])
    with workspace(browser, app_url, ada, d.did) as pg:
        share = pg.get_by_role("button", name="Share")
        click(share)
        dlg = pg.get_by_role("dialog", name="Share")
        assert_focus_wraps(pg, dlg)
        key(pg, "Escape")
        assert gone(dlg) and share.evaluate("el => el === document.activeElement")
        align = pg.get_by_role("toolbar", name="Tools").get_by_role("button", name="Align")
        click(shape_el(pg, d.sid("Alpha")))
        key(pg, "Control+KeyA")
        click(align)
        menu = pg.get_by_role("menu", name="Align")
        poll(pg, lambda: visible(menu), LIVE_S + SLACK_S, "Align menu")
        assert_menu_placement(pg, menu)
        key(pg, "Escape")
        assert align.evaluate("el => el === document.activeElement")
        pg.mouse.click(*screen(pg, 300, 120))
        click(shape_el(pg, d.sid("Edge")))
        key(pg, "Shift+F10")
        actions = pg.get_by_role("menu", name="Shape actions")
        poll(pg, lambda: visible(actions), LIVE_S + SLACK_S, "Shape actions")
        assert_menu_placement(pg, actions)
        key(pg, "Escape")
        pg.set_viewport_size(PHONE)
        advance(pg, RAIL_MS)
        button = published(pg, "bottom-toolbar").get_by_role("button", name="History")
        click(button)
        sheet = pg.get_by_role("dialog", name="History")
        assert_focus_wraps(pg, sheet)
        key(pg, "Escape")
        advance(pg, RAIL_MS)
        assert gone(sheet) and button.evaluate("el => el === document.activeElement")


def test_wf_cross_cutting_announcer(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[P(shapes=[S("Solo", 40, 360), S("Pa", 40, 160), S("Pb", 400, 160)], connectors=[C("Pa", "e", "Pb", "w")])])])
    a = login(app_url, ada)
    with workspace(browser, app_url, ada, d.did) as pg:
        assert published(pg, "announcer").get_attribute("aria-live") == "polite"
        click(shape_el(pg, d.sid("Solo")))
        key(pg, "ArrowRight")
        wait_heard(pg, moved_notice("Solo", 0))
        before = get_doc(a, d.did)
        click(shape_el(pg, d.sid("Pa")))
        key(pg, "ArrowDown")
        after = poll([], lambda: (x := get_doc(a, d.did))["seq"] > before["seq"] and x, WORK_S, "nudge saved")
        assert len(rerouted(before, after)) == 1
        notice = moved_notice("Pa", 1)
        wait_heard(pg, notice)
        assert notice in published(pg, "announcer").inner_text()


def test_api_error_contract(app_url):
    ada, bea, cy, mallory = cast("ada", "bea", "cy", "mal")
    d, = seed(app_url, [ada, bea, cy, mallory], [D(ada, [(bea, "editor"), (cy, "viewer")], [pipeline()])])
    b, c, m = login(app_url, bea), login(app_url, cy), login(app_url, mallory)
    junk = {"opId": op_id(), "baseSeq": 0, "op": {"kind": "update_shape", "shape": d.sid("Intake"), "set": {"route": []}}}
    missing = "d_" + uuid.uuid4().hex[:12]
    assert_error(httpx.get(f"{app_url}/api/diagrams/{missing}/document"), 401, "unauthenticated")
    assert_error(httpx.post(f"{app_url}/api/diagrams/{d.did}/operations", json=junk), 401, "unauthenticated")
    assert m.post(f"/api/diagrams/{d.did}/operations", json=junk).json() == NOT_FOUND_BODY
    assert_error(c.post(f"/api/diagrams/{d.did}/operations", json=junk), 403, "forbidden_role")
    oid = op_id()
    stored = accept(b, d.did, move(d.sid("Intake"), x=48), oid)
    accept(b, d.did, {"kind": "delete_shape", "shape": d.sid("Log")})
    assert post_json(app_url, "/api/grading/save-outage", {"diagramId": d.did, "ms": SHORT_OUTAGE_MS}).status_code == 200
    replay = send(b, d.did, move(d.sid("Intake"), x=48), oid)
    assert replay.status_code == 200 and replay.json() == stored
    late = {"kind": "update_shape", "shape": d.sid("Log"), "set": {"x": COORD_MAX + 1}}
    assert_error(send(b, d.did, late), 503, "save_unavailable")
    r = until_http(lambda: (x := send(b, d.did, late)).status_code != 503 and x, SHORT_OUTAGE_MS / 1000 + WORK_S, "outage over")
    assert_error(r, 409, "shape_deleted")
    v = assert_error(send(b, d.did, {"kind": "update_shape", "shape": d.sid("Intake"), "set": {"route": []}}), 422, "invalid")
    assert "op.set.route" in v["error"]["fields"]


INSTANCES = {"primary": "", "minio_down": "APP_MINIO_DOWN_URL", "mailpit_down": "APP_MAILPIT_DOWN_URL"}


@pytest.mark.parametrize("instance", list(INSTANCES), ids=list(INSTANCES))
def test_wf_cross_cutting_health(app_url, instance):
    base = os.environ[INSTANCES[instance]] if INSTANCES[instance] else app_url
    h = httpx.get(f"{base}/api/health")
    assert h.status_code == 200 and h.json() == {"status": "ok"}
    who, = cast("bea")
    assert httpx.post(f"{base}/api/auth/signup", json={"name": who.name, "email": who.email, "password": who.password}).status_code == 201
    c = login(base, who)
    r = c.post("/api/diagrams", json={"title": fresh("Pipeline")})
    assert r.status_code == 201
    doc = r.json()["document"]
    assert [p["name"] for p in doc["pages"]] == ["Page 1"] and [l["name"] for l in doc["pages"][0]["layers"]] == ["Layer 1"]
    page = doc["pages"][0]
    ref = op_id()
    out = accept(c, doc["id"], {"kind": "add_shape", "page": page["id"], "layer": page["layers"][0]["id"], "clientRef": ref,
                                "shape": {"kind": "rectangle", "x": 0, "y": 0, "w": 40, "h": 40, "label": "Intake"}})
    assert find(get_doc(c, doc["id"]), "shapes", out["ids"][ref])["label"] == "Intake"


def test_server_boundary(app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    a = login(app_url, ada)
    title = fresh("Cross")
    assert_error(a.post("/api/diagrams", json={"title": title}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    assert not any(x["title"] == title for x in a.get("/api/diagrams").json()["diagrams"])
    prefix, suffix = '{"email":"nobody@linewell.test","password":"', '"}'
    for size, status in ((BODY_LIMIT, None), (BODY_LIMIT + 1, 413)):
        payload = prefix + "x" * (size - len(prefix) - len(suffix)) + suffix
        r = httpx.post(f"{app_url}/api/auth/signin", content=payload.encode(), headers={"Content-Type": "application/json"})
        if status:
            assert_error(r, 413, "too_large")
        else:
            assert r.status_code != 413
    assert_error(httpx.post(f"{app_url}/api/auth/signin", content=b"not json", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    for path in ("/package.json", "/package-lock.json", "/.env", "/run.json", "/tsconfig.json", "/src/server/index.ts", "/server/index.ts", "/dist/server/index.js.map"):
        assert httpx.get(f"{app_url}{path}").status_code == 404, path
    u = urlparse(app_url)
    token = a.cookies.get("lw_session")

    def upgrade(origin: str) -> int:
        with socket.create_connection((u.hostname, u.port or 80), timeout=HTTP_TIMEOUT_S) as s:
            s.sendall((f"GET /ws?diagram={d.did} HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                       f"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n"
                       f"Cookie: lw_session={token}\r\n\r\n").encode())
            head = s.recv(64).decode(errors="replace").split()
            return int(head[1]) if len(head) > 1 else 0

    assert upgrade(FOREIGN_ORIGIN) != HTTPStatus.SWITCHING_PROTOCOLS
    assert upgrade(f"{u.scheme}://{u.netloc}") == HTTPStatus.SWITCHING_PROTOCOLS


def test_grading_routes(browser, app_url):
    ada, bea = cast("ada", "bea")
    spec = D(ada, [(bea, "viewer")], [P(layers=[L("Base"), L("Notes")], shapes=[S("Intake", 0, 120), S("Review", 400, 120), S("Log", 0, 300, layer="Notes"), S("Store", 200, 300, layer="Notes")],
                                        connectors=[C("Intake", "e", "Review", "w"), C("Log", "e", "Store", "w")], groups=[("Log", "Store")], comments=[note("Intake", bea, "hello")]), P("Floor plan")])
    r = post_json(app_url, "/api/grading/seed", seed_request([ada, bea], [spec]))
    assert r.status_code == 201, r.text
    body = r.json()
    assert all(is_id(u["id"], "u_") for u in body["users"])
    dg = body["diagrams"][0]
    assert is_id(dg["id"], "d_") and [p["name"] for p in dg["pages"]] == ["Main", "Floor plan"]
    p0 = dg["pages"][0]
    assert set(p0["layers"]) == {"Base", "Notes"} and set(p0["shapes"]) == {"Intake", "Review", "Log", "Store"}
    first_key, second_key = (f"{src}->{dst}" for src, dst in (("Intake", "Review"), ("Log", "Store")))
    assert set(p0["connectors"]) == {first_key, second_key} and p0["connectors"][first_key] < p0["connectors"][second_key]
    a = login(app_url, ada)
    doc = get_doc(a, dg["id"])
    page = doc["pages"][0]
    assert [l["name"] for l in sorted(page["layers"], key=lambda l: l["order"])] == ["Base", "Notes"]
    zs = {s["label"]: s["z"] for s in page["shapes"]}
    assert zs["Log"] < zs["Store"]
    assert all(c["route"] for c in page["connectors"]) and len(page["groups"]) == 1
    assert next(m for m in a.get(f"/api/diagrams/{dg['id']}/members").json()["members"] if m["email"] == bea.email)["status"] == "active"
    assert [c["id"] for c in a.get(f"/api/diagrams/{dg['id']}/comments").json()["comments"]] == p0["comments"]["Intake"]
    fresh_user, = cast("cy")
    assert_error(post_json(app_url, "/api/grading/seed", seed_request([fresh_user, ada], [])), 409, "email_taken")
    bad = D(fresh_user, pages=[P(shapes=[S("Tiny", 0, 0, 10, 10)])])
    assert_error(post_json(app_url, "/api/grading/seed", seed_request([fresh_user], [bad])), 422, "invalid")
    assert httpx.post(f"{app_url}/api/auth/signin", json={"email": fresh_user.email, "password": fresh_user.password}).status_code == 401
    for ms in (0, OUTAGE_MAX_MS + 1):
        assert_error(post_json(app_url, "/api/grading/save-outage", {"diagramId": dg["id"], "ms": ms}), 422, "invalid")
    with open_app(browser, f"{app_url}/signin") as pg:
        sign_in_form(pg, ada)
        poll(pg, lambda: urlparse(pg.url).path == "/", BOOT_S, "signed in")
        assert pg.evaluate(WS_JS, f"/ws?diagram={dg['id']}") == "open"
        out = post_json(app_url, "/api/grading/save-outage", {"diagramId": dg["id"], "ms": SHORT_OUTAGE_MS})
        assert out.status_code == 200
        datetime.fromisoformat(out.json()["until"].replace("Z", "+00:00"))
        poll(pg, lambda: pg.evaluate("() => window.__lwClose") == 4503, WORK_S, "socket closed 4503")
    assert_error(send(a, dg["id"], move(p0["shapes"]["Intake"], x=8)), 503, "save_unavailable")
    until_http(lambda: send(a, dg["id"], move(p0["shapes"]["Intake"], x=8)).status_code == 200, SHORT_OUTAGE_MS / 1000 + WORK_S, "outage ends")
    with app_copy({"GRADING_ROUTES": "off"}) as copy:
        assert httpx.post(f"{copy}/api/grading/seed", json=seed_request([], [])).status_code == 404
        assert httpx.post(f"{copy}/api/grading/save-outage", json={"diagramId": dg["id"], "ms": SHORT_OUTAGE_MS}).status_code == 404


APP = Path("/app")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    for font in ("Instrument Serif", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad
    assert "OFL-1.1" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_only_published_services():
    forbidden = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "memcached",
                 "amqplib", "kafkajs", "bull", "bullmq", "@sentry/node", "@sentry/browser", "posthog-node", "firebase"}
    assert not [p.name for p in shipped_packages() if p.name in forbidden]


def test_if_typescript_source():
    skip = {"node_modules", "dist", "build", ".git", "coverage", "out", "scripts"}
    found = [str(p) for p in APP.rglob("*") if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and not skip & set(p.parts) and ".config." not in p.name]
    assert not found, found
    assert any(APP.rglob("*.ts"))


def test_if_same_origin_assets(browser, app_url):
    ada, = cast("ada")
    d, = seed(app_url, [ada], [D(ada, pages=[pipeline()])])
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    with workspace(browser, app_url, ada, d.did) as pg:
        urls: list[str] = []
        pg.on("request", lambda r: urls.append(r.url))
        reload(pg, d.did)
        advance(pg, OFFLINE_MS)
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, origin)]
        assert not foreign, foreign
        assert pg.evaluate("async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0") == 0


def test_if_compose_untouched():
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return
    data = json.loads(trajectory.read_text())
    hits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or "").lower()
            args = node.get("input") or node.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {"command": args}
            if isinstance(args, dict):
                target = str(args.get("file_path") or args.get("path") or "")
                if any(w in name for w in ("write", "edit")) and "compose" in Path(target).name:
                    hits.append(target)
                command = str(args.get("command") or "")
                if re.search(r"(sed -i|>\s*|tee\s+)\S*compose[^\s]*\.ya?ml", command):
                    hits.append(command)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    assert not hits, hits
