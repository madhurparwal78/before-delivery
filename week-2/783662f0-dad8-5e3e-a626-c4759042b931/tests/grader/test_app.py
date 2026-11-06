from __future__ import annotations

import codecs
import concurrent.futures
import csv
import hashlib
import io
import json
import math
import os
import re
import subprocess
import tarfile
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    S3,
    addresses,
    advance,
    capture,
    changed,
    click,
    decode,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    same_origin,
    select,
    tab_order,
    tap,
)
from conftest import text as mail_text

HTTP_TIMEOUT = 40
STEP_MS = 250
UI_WAIT = 40
ACTIVE_WAIT = 120
MAIL_WAIT = 90
MAIL_SETTLE = 12
SETTLER_WAIT = 90
RETRY_WAIT = 45
GRACE_HOLD = 45

PAYMENT_HOLD = 7.0
SLOW_BILLING_PORT, STORAGE_PARTIAL_PORT = 4191, 4192
PAYMENT_PATH = re.compile(r"/payments(?=[/?]|$)")


def _relay(port: int, upstream: str, hold=None, refuse=None):
    import http.client
    import http.server

    target = urlparse(upstream)

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def _body(self) -> bytes | None:
            if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
                parts = []
                while (size := int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)):
                    parts.append(self.rfile.read(size))
                    self.rfile.readline()
                self.rfile.readline()
                return b"".join(parts)
            length = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(length) if length else None

        def _reply(self, status: int, headers, data: bytes) -> None:
            self.send_response(status)
            for k, v in headers:
                if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
            self.close_connection = True

        def _forward(self) -> None:
            body = self._body()
            if refuse is not None and refuse(self.command, self.path):
                self._reply(503, [("Content-Type", "application/xml")],
                            b"<Error><Code>ServiceUnavailable</Code><Message>relay refused the write</Message></Error>")
                return
            if hold is not None and hold(self.command, self.path):
                threading.Event().wait(PAYMENT_HOLD)
            headers = {k: v for k, v in self.headers.items()
                       if k.lower() not in ("connection", "transfer-encoding", "content-length")}
            if body is not None:
                headers["Content-Length"] = str(len(body))
            conn = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=120)
            try:
                conn.request(self.command, self.path, body=body, headers=headers)
                resp = conn.getresponse()
                self._reply(resp.status, resp.getheaders(), resp.read())
            except OSError:
                self._reply(502, [], b"")
            finally:
                conn.close()

        do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = do_PATCH = _forward

    class Server(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    server = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


@pytest.fixture(scope="session", autouse=True)
def outage_relays():
    relays = []
    if os.environ.get("KILLBILL_URL"):
        relays.append(_relay(SLOW_BILLING_PORT, os.environ["KILLBILL_URL"],
                             hold=lambda method, path: method == "POST" and bool(PAYMENT_PATH.search(path))))
    if os.environ.get("S3_ENDPOINT"):
        relays.append(_relay(STORAGE_PARTIAL_PORT, os.environ["S3_ENDPOINT"],
                             refuse=lambda method, path: method in ("PUT", "POST")
                             and path.split("?", 1)[0].endswith("manifest.json")))
    yield
    for relay in relays:
        relay.shutdown()
WEATHER_WAIT = 75
CALM_MIN_S = 10
LARK_SEED = 0
SHORT_GRACE = 20
GRACE_TOL = 2
LAPSE_WAIT = 75
LAPSE_MIN = 59
PUSH_TABLE_S = 1.0
PUSH_SERVER_S = 1.5
OFFLINE_S = 20
TOAST_MS = 5000
BODY_MAX = 16384
SPAWN = (16, 8)
DEFAULT_STAKE = 10
DEFAULT_TURN = 30
MIN_TURN = 5
HAMLET_MEMBERS = 6
HAMLET_CHARACTERS = 12
GRANT = 500
PIECE_BAND = (180, 260)
DISC_BASE, DISC_PER_ROW, DISC_TOL = 120, 40, 30
DEAL_FLIGHT = (150, 250)
DEAL_GAP = (45, 75)
FLIP_BAND = (200, 300)
DRIVE_BAND = (90, 130)
PLACE_BAND = (120, 180)
SHARDS = (6, 10)
SHARD_MAX_MS = 400
COIN_BAND = (400, 700)
TINT_BAND = (800, 1200)
DRAWIN_GROW_MAX_MS = 500
DRAWIN_MAX_MS = 1000
TOKEN_SLIDE = (200, 500)
ROSTER_SPLIT_MAX = 0.45
RAIL_ABOUT_320 = (280, 360)
RAIL_ABOUT_300 = (260, 340)
MAP_MIN_SHARE = 0.6
DRAWER_MAX_SHARE = 0.7
NIGHT_TOL = 0.05
DATE_TOL = 0.002
DEVICE_SKEW = "2031-03-01T00:00:00Z"
DAY_SECONDS = 86400
PERIOD_DEFAULT = 600

SEED_PASS = {"mara": "mara-plots-01", "tobias": "tobias-plots-02", "ines": "ines-plots-03",
             "kofi": "kofi-plots-04", "juno": "juno-plots-05", "oskar": "oskar-plots-06",
             "priya": "priya-plots-07", "rowan": "rowan-plots-08", "sefa": "sefa-plots-09",
             "dara": "dara-plots-10", "eli": "eli-plots-11"}
TABLES = {"Oak Chess Table": (12, 6), "Lantern Four Table": (16, 6),
          "Felt Card Table": (20, 6), "Birch Chess Table": (24, 6)}
ADJACENT = {"Oak Chess Table": (12, 7), "Lantern Four Table": (16, 7),
            "Felt Card Table": (20, 7), "Birch Chess Table": (24, 7)}
OLD_WELL, MILL_GATE = (8, 12), (24, 12)
DEMO = "a2a3 e7e5 b2b3 b8c6 h2h3 d7d6 a3a4 c8e6 f2f3 a7a6 g2g4 d8h4".split()
DEMO_PIECES = ["Pawn", "Pawn", "Pawn", "Knight", "Pawn", "Pawn", "Pawn", "Bishop", "Pawn", "Pawn", "Pawn", "Queen"]
DEMO_COPY = [f"{p} to {m[2:4]}" for p, m in zip(DEMO_PIECES, DEMO)][:-1] + ["Queen to h4, checkmate"]
SCHEDULE = ["clear", "rain", "clear", "storm"]
APPEARANCES = ["Surveyor", "Mason", "Pilot", "Gardener"]
RANKS = "23456789TJQKA"
RANK_NAMES = dict(zip(RANKS, ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
                              "Jack", "Queen", "King", "Ace"]))
SUIT_NAMES = {"C": "Clubs", "D": "Diamonds", "H": "Hearts", "S": "Spades"}
FILES = "abcdefgh"
ISO_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
OUTAGE_ENVS = ["APP_KILLBILL_DOWN_URL", "APP_STORAGE_DOWN_URL", "APP_MAIL_DOWN_URL",
               "APP_SLOW_BILLING_URL", "APP_STORAGE_PARTIAL_URL", "APP_SHORT_URL"]
SECRET_ENVS = ["DATABASE_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "KILLBILL_PASSWORD",
               "KILLBILL_API_KEY", "KILLBILL_API_SECRET"]
STALE = '"stale-etag"'
FOREIGN_HOST = "evil.example"
FOREIGN_ORIGIN = "http://" + FOREIGN_HOST
SEATS_GLOB = "**/api/tables/*/seats"
LARK, MEADOW, FENNEL = "larkspur-commons", "meadow", "fennel-reach"
THREEFOLD, DRAW = "Threefold repetition.", "Draw."
ABANDONED, STAKES_RETURNED = "Abandoned: the server was suspended.", "Stakes returned."
OLD_WELL_NAME, MILL_GATE_NAME = "Old Well", "Mill Gate"
STARTER_STACK = 16
MAP_W, MAP_H = 40, 24
CRLF, LF = b"\r\n", b"\n"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
OSC_COUNT_JS = "() => window.__osc"
TABBABLE_JS = "cs => cs.filter(c => c.tabIndex === 0).length"

ANIM_JS = r"""
(() => {
  window.__anims = []; window.__added = {};
  const seen = new WeakSet();
  const rec = (el, a) => {
    if (!el || !el.hasAttribute || !el.hasAttribute('data-anim') || seen.has(a)) return;
    seen.add(a);
    const t = a.effect ? a.effect.getComputedTiming() : {};
    window.__anims.push({name: el.getAttribute('data-anim'), duration: Number(t.duration) || 0,
                         delay: Number(t.delay) || 0, at: performance.now()});
  };
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); rec(this, a); return a; };
  for (const type of ['transitionrun', 'animationstart']) {
    document.addEventListener(type, e => { for (const a of e.target.getAnimations()) rec(e.target, a); }, true);
  }
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    for (const el of [n, ...n.querySelectorAll('[data-anim]')]) {
      const k = el.getAttribute('data-anim'); if (k) window.__added[k] = (window.__added[k] || 0) + 1;
    }
  } }).observe(document, {childList: true, subtree: true});
})();
"""
OSC_JS = r"""
(() => {
  window.__osc = 0;
  if (window.OscillatorNode) {
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) { window.__osc += 1; return start.apply(this, a); };
  }
})();
"""
COIN_JS = r"""g => { window.__coins = [];
  const push = () => window.__coins.push({t: performance.now(), v: g.textContent});
  new MutationObserver(push).observe(g, {subtree: true, childList: true, characterData: true}); }"""
MAP_RECT_JS = r"""g => { let e = g.parentElement;
  while (e && e !== document.body) { const s = getComputedStyle(e);
    if (/(auto|scroll|hidden)/.test(s.overflowX + s.overflowY)) { const r = e.getBoundingClientRect();
      return {x: r.x, y: r.y, width: r.width, height: r.height}; }
    e = e.parentElement; }
  const r = g.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }"""
ANIM_STATE_JS = r"""name => Array.from(document.getElementsByTagName('*'))
  .filter(e => e.getAttribute('data-anim') === name)
  .map(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return {phase: e.getAttribute('data-phase'), level: e.getAttribute('data-night-level'),
            visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'
                     && Number(s.opacity) > 0}; })"""


def tag() -> str:
    return uuid.uuid4().hex[:8]


def outage(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} is not set"
    return url.rstrip("/")


def public_base(app_url: str) -> str:
    return (os.environ.get("PUBLIC_BASE_URL") or os.environ.get("APP_PUBLIC_URL") or app_url).rstrip("/")


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)

    def get(self, path, **kw):
        return self.c.get(path, **kw)

    def post(self, path, body=None, key=None, **headers):
        h = dict(headers)
        if key:
            h["Idempotency-Key"] = key
        return self.c.post(path, json={} if body is None else body, headers=h)

    def patch(self, path, body, if_match=None):
        return self.c.patch(path, json=body, headers={} if if_match is None else {"If-Match": if_match})

    def delete(self, path):
        return self.c.delete(path)


def must(r, *codes):
    assert r.status_code in codes, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    if r.headers.get("content-type", "").startswith("application/json"):
        return r.json()
    return r


def err(r, status, code, message=None):
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    body = r.json()
    assert body["error"] == code, body
    if "message" in body:
        assert isinstance(body["message"], str)
    if message is not None:
        assert body["message"] == message, body
    return body


def field_error(r, message):
    b = err(r, 422, "validation")
    assert message in b["fields"].values(), b
    return b


def poll(fn, seconds, what="condition", every=0.25):
    deadline = time.monotonic() + seconds
    last = None
    while True:
        try:
            last = fn()
            if last:
                return last
        except (AssertionError, httpx.HTTPError, KeyError, StopIteration) as exc:
            last = exc
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}: {last!r}")
        threading.Event().wait(every)


def hold(fn, seconds, what="invariant", every=1.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert fn(), f"{what} broke"
        threading.Event().wait(every)


def sign_in(base, handle, passcode) -> Api:
    api = Api(base)
    must(api.post("/api/session", {"handle": handle, "passcode": passcode}), 200)
    return api


def mail_to(mail, email, subject=None, count=1, seconds=MAIL_WAIT):
    def found():
        msgs = [m for m in mail.messages(settle=0.2)
                if email in addresses(m.get("To")) and (subject is None or subject in m.get("Subject", ""))]
        return msgs if len(msgs) >= count else None
    return poll(found, seconds, f"mail to {email}")


def mail_exactly(mail, email, subject):
    return [m for m in mail.messages(settle=MAIL_SETTLE)
            if email in addresses(m.get("To")) and subject in m.get("Subject", "")]


def invite_token(mail, email):
    msg = mail_to(mail, email, "invited you to")[-1]
    m = re.search(r"/join/([A-Za-z0-9_\-]+)", mail_text(msg))
    assert m, mail_text(msg)
    return m.group(1)


class Player:
    def __init__(self, api, handle, passcode, email, display):
        self.api, self.handle, self.passcode, self.email, self.display = api, handle, passcode, email, display


class Realm:

    def __init__(self, base, mail, plan="borough", owner="eli", active=True):
        self.base, self.mail, self.owner_handle = base, mail, owner
        self.owner = sign_in(base, owner, SEED_PASS[owner])
        self.name = f"Realm {tag()}"
        body = must(self.owner.post("/api/checkout", {"server_name": self.name, "plan": plan},
                                    key=idempotency_key()), 201)
        self.server, self.slug, self.id = body["server"], body["server"]["slug"], body["server"]["id"]
        if active:
            self.activate()

    def activate(self, api=None):
        api = api or self.owner

        def done():
            s = must(api.get(f"/api/servers/{self.slug}"), 200)
            if s["status"] == "active":
                return s
            api.post(f"/api/servers/{self.slug}/billing/payments", {})
            return None
        self.server = poll(done, ACTIVE_WAIT, "server active")

    def player(self, inviter=None) -> Player:
        t = tag()
        email, handle, pw, display = f"pw{t}@example.com", f"p{t}", f"pass-{t}", f"Player {t}"
        must((inviter or self.owner).post(f"/api/servers/{self.slug}/invites", {"email": email},
                                          key=idempotency_key()), 201)
        token = invite_token(self.mail, email)
        api = Api(self.base)
        must(api.post(f"/api/invites/{token}/accept",
                      {"handle": handle, "display_name": display, "passcode": pw}), 201)
        return Player(api, handle, pw, email, display)


def make_char(api, slug, name=None, loadout=None, appearance="surveyor"):
    r = api.post(f"/api/servers/{slug}/characters",
                 {"name": name or f"C{tag()}", "appearance": appearance, "loadout": list(loadout or [])})
    return must(r, 201)["character"]


def walk_to(api, ch, target):
    x, y, (tx, ty) = ch["x"], ch["y"], target
    dirs = (["east"] if tx > x else ["west"]) * abs(tx - x) + (["south"] if ty > y else ["north"]) * abs(ty - y)
    out = None
    for d in dirs:
        out = must(api.post(f"/api/characters/{ch['id']}/walk", {"direction": d}), 200)
    ch["x"], ch["y"] = tx, ty
    return out


def world(api, slug, w="home"):
    return must(api.get(f"/api/servers/{slug}/worlds/{w}"), 200)


def table_of(api, slug, name, w="home"):
    return next(t for t in world(api, slug, w)["tables"] if t["name"] == name)


def set_table(owner, tid, stake, secs):
    etag = owner.get(f"/api/tables/{tid}").headers["ETag"]
    must(owner.patch(f"/api/tables/{tid}", {"stake": stake, "turn_seconds": secs}, etag), 200)


def inv(api, cid):
    return {s["slot"]: s for s in must(api.get(f"/api/characters/{cid}/inventory"), 200)["slots"]}


def count_of(slots, kind):
    return sum(s["count"] for s in slots.values() if s["kind"] == kind)


def ledger(realm):
    return must(realm.owner.get(f"/api/servers/{realm.slug}/ledger"), 200)["entries"]


def card_name(code):
    return f"{RANK_NAMES[code[0]]} of {SUIT_NAMES[code[1]]}"


class Table:
    def __init__(self, realm, name, stake=None, secs=None, n=None, names=None, people=None):
        self.realm, self.name = realm, name
        self.tid = table_of(realm.owner, realm.slug, name)["id"]
        if stake is not None or secs is not None:
            set_table(realm.owner, self.tid, DEFAULT_STAKE if stake is None else stake,
                      DEFAULT_TURN if secs is None else secs)
        n = n or (4 if name == "Felt Card Table" else 2)
        self.people = people or [realm.player() for _ in range(n)]
        self.chars = [make_char(p.api, realm.slug, name=(names[i] if names else None))
                      for i, p in enumerate(self.people)]
        for p, c in zip(self.people, self.chars):
            walk_to(p.api, c, ADJACENT[name])
        self.by_char = {c["id"]: (p, c) for p, c in zip(self.people, self.chars)}
        self.table, self.turn = None, 0
        self.route = f"/s/{realm.slug}/w/home/t/{self.tid}"

    def sit(self, i):
        p, c = self.people[i], self.chars[i]
        must(p.api.post(f"/api/tables/{self.tid}/seats", {"character_id": c["id"]}), 201)
        return self.refresh()

    def sit_all(self):
        for i in range(len(self.people)):
            self.sit(i)
        return self.table

    def refresh(self):
        self.table = must(self.people[0].api.get(f"/api/tables/{self.tid}"), 200)
        self.turn = self.table.get("turn") or 0
        return self.table

    def at_seat(self, n):
        cid = next(s["character"]["id"] for s in self.table["seats"] if s["seat"] == n)
        return self.by_char[cid]

    def start(self):
        p, c = self.at_seat(1)
        self.table = must(p.api.post(f"/api/tables/{self.tid}/start", {"character_id": c["id"]}), 200)
        self.turn = self.table["turn"]
        return self.table

    def move(self, mv, seat=None, turn=None):
        p, c = self.at_seat(seat or self.table["to_move_seat"])
        r = p.api.post(f"/api/tables/{self.tid}/moves",
                       {"character_id": c["id"], "turn": self.turn if turn is None else turn, "move": mv})
        if r.status_code == 200:
            self.table = r.json()["table"]
            self.turn += 1
        return r

    def play(self, moves):
        return [must(self.move(m), 200)["announcement"] for m in moves]

    def forfeit(self, seat):
        p, c = self.at_seat(seat)
        self.table = must(p.api.post(f"/api/tables/{self.tid}/forfeit", {"character_id": c["id"]}), 200)
        return self.table

    def settled(self):
        def done():
            t = self.refresh()
            return t if t["state"] == "settled" else None
        return poll(done, RETRY_WAIT, "settled")


class Stream(threading.Thread):

    def __init__(self, api, path, last_id=None):
        super().__init__(daemon=True)
        self.api, self.path, self.last_id = api, path, last_id
        self.events, self.lines, self.status = [], [], None
        self.stopped, self.ready, self.resp = threading.Event(), threading.Event(), None
        self.start()

    def run(self):
        headers = {"Accept": "text/event-stream"}
        if self.last_id is not None:
            headers["Last-Event-ID"] = str(self.last_id)
        try:
            with self.api.c.stream("GET", self.path, headers=headers,
                                   timeout=httpx.Timeout(HTTP_TIMEOUT, read=None)) as r:
                self.resp, self.status = r, r.status_code
                self.ready.set()
                cur = {}
                for line in r.iter_lines():
                    if self.stopped.is_set():
                        return
                    self.lines.append(line)
                    if line == "":
                        if "data" in cur:
                            self.events.append({"id": int(cur["id"]) if cur.get("id") else None,
                                                "event": cur.get("event", "message"),
                                                "data": json.loads(cur["data"]), "at": time.time()})
                        cur = {}
                    elif not line.startswith(":"):
                        k, _, v = line.partition(":")
                        cur[k] = cur.get(k, "") + (v[1:] if v.startswith(" ") else v)
        except (httpx.HTTPError, RuntimeError):
            self.ready.set()

    def wait(self, pred, seconds=30, what="event"):
        return poll(lambda: next((e for e in list(self.events) if pred(e)), None), seconds, what)

    def close(self):
        self.stopped.set()
        if self.resp is not None:
            self.resp.close()


def ui(pg, check, seconds=UI_WAIT):
    deadline = time.monotonic() + seconds
    while True:
        try:
            return check()
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(pg, STEP_MS)


def say(pg, name, copy, scope=None, seconds=UI_WAIT):
    region = (scope or pg).get_by_role("status", name=name)
    ui(pg, lambda: expect(region).to_have_text(copy, timeout=STEP_MS), seconds)


HEARD_JS = r"""el => { window.__heard = [];
  if (el.__heardObs) return;
  el.__heardObs = new MutationObserver(() => window.__heard.push(el.textContent.trim()));
  el.__heardObs.observe(el, {subtree: true, childList: true, characterData: true}); }"""


def listen(pg, name="World announcements"):
    pg.get_by_role("status", name=name).evaluate(HEARD_JS)


def heard(pg, copy, name="World announcements", seconds=UI_WAIT):
    region = pg.get_by_role("status", name=name)

    def check():
        history = pg.evaluate("() => window.__heard || []")
        assert copy in history or region.inner_text().strip() == copy, (copy, history)
    ui(pg, check, seconds)


def shows(pg, locator, content, seconds=UI_WAIT):
    ui(pg, lambda: expect(locator).to_contain_text(content, timeout=STEP_MS), seconds)


def at_url(pg, pattern, seconds=UI_WAIT):
    ui(pg, lambda: expect(pg).to_have_url(re.compile(pattern), timeout=STEP_MS), seconds)


@contextmanager
def signed_in(browser, base, path, handle, passcode, size=(1280, 800), reduced=False, init=None):
    with open_app(browser, f"{base}/sign-in?next={quote(path)}",
                  reduced_motion="reduce" if reduced else "no-preference") as pg:
        pg.set_viewport_size({"width": size[0], "height": size[1]})
        if init:
            pg.add_init_script(init)
        fill(pg.get_by_role("textbox", name="Handle"), handle)
        fill(pg.get_by_label("Passcode", exact=True), passcode)
        click(pg.get_by_role("button", name="Sign in"))
        at_url(pg, re.escape(path) + r"$")
        if init:
            pg.reload()
        yield pg


def recorded(pg, name):
    return [a for a in pg.evaluate("() => window.__anims || []") if a["name"] == name]


def cell(pg, x, y, label=""):
    return pg.get_by_role("gridcell", name=re.compile(rf"^{x}, {y}, {re.escape(label)}"))


def take(pg, table, button="Take seat"):
    x, y = TABLES[table]
    click(cell(pg, x, y, table))
    click(pg.get_by_role("region", name="Tile inspector").get_by_role("button", name=button))


def use_char(pg, name):
    select(pg.get_by_role("combobox", name="Character"), name)


def map_cursor(pg):
    cells = pg.get_by_role("grid", name="World map").get_by_role("gridcell")
    idx = cells.evaluate_all("cs => cs.findIndex(c => c.tabIndex === 0)")
    return cells.nth(idx)


def focused(pg, locator):
    ui(pg, lambda: expect(locator).to_be_focused(timeout=STEP_MS))


def kb_square(pg, sq, white):
    f, r = FILES.index(sq[0]), int(sq[1])
    rows, cols = (8 - r, f) if white else (r - 1, 7 - f)
    pg.get_by_role("grid", name="Chess board").get_by_role("gridcell").first.focus()
    pg.keyboard.press("Control+Home")
    for _ in range(rows):
        pg.keyboard.press("ArrowDown")
    for _ in range(cols):
        pg.keyboard.press("ArrowRight")
    expect(pg.get_by_role("gridcell", name=re.compile(rf"^{sq}, "))).to_be_focused()
    pg.keyboard.press("Enter")


def kb_move(pg, mv, white):
    colour = "White" if white else "Black"
    ui(pg, lambda: expect(pg.get_by_role("gridcell", name=re.compile(rf"^{mv[:2]}, {colour} "))).to_be_visible(
        timeout=STEP_MS))
    kb_square(pg, mv[:2], white)
    kb_square(pg, mv[2:4], white)


def box_bottom(b):
    return b["y"] + b["height"]


def assert_eq(a, b):
    assert a == b, (a, b)


def signed(n):
    return f"+{n}" if n > 0 else str(n)


def placed(material, x, y):
    return f"Placed {material} block at {x}, {y}"


def broke(material, x, y):
    return f"Broke {material} block at {x}, {y}"


def moved(x, y):
    return f"Moved to {x}, {y}"


def parked(name, surface, x, y):
    return f"{name} parked on {surface} at {x}, {y}"


def sq_name(square, colour, piece):
    return f"{square}, {colour} {piece}"


def disc_name(square, colour):
    return f"{square}, {colour} disc"


def slot_name(cell_name, item, count):
    return f"{cell_name}, {item}, {count}"


def expand(rank):
    return "".join(" " * int(ch) if ch.isdigit() else ch for ch in rank)


def piece_at(fen, square):
    rows = [expand(r) for r in fen.split()[0].split("/")]
    return rows[8 - int(square[1])][FILES.index(square[0])]


def anim_els(pg, name):
    return pg.evaluate(ANIM_STATE_JS, name)


def test_health_on_every_instance(app_url):
    for base in [app_url.rstrip("/")] + [outage(n) for n in OUTAGE_ENVS]:
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, (base, r.text)
        assert r.json()["status"] == "ok", (base, r.text)


def test_server_boundary(browser, app_url, mail):
    def body_of(n):
        head, tail = '{"handle":"zz","passcode":"', '"}'
        return (head + "a" * (n - len(head) - len(tail)) + tail).encode()
    url = f"{app_url}/api/session"
    jh = {"Content-Type": "application/json"}
    assert httpx.post(url, content=body_of(BODY_MAX), headers=jh, timeout=HTTP_TIMEOUT).status_code != 413
    err(httpx.post(url, content=body_of(BODY_MAX + 1), headers=jh, timeout=HTTP_TIMEOUT), 413, "payload_too_large")
    good = json.dumps({"handle": "mara", "passcode": SEED_PASS["mara"]}).encode()
    err(httpx.post(url, content=good, headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT),
        415, "unsupported_media_type")
    for origin, host in [(FOREIGN_ORIGIN, None), ("null", None), (FOREIGN_ORIGIN, FOREIGN_HOST)]:
        h = dict(jh, Origin=origin)
        if host:
            h["Host"] = host
        r = httpx.post(url, content=good, headers=h, timeout=HTTP_TIMEOUT)
        err(r, 403, "cross_origin")
        allowances = [k for k in r.headers if "allow" in k.lower() and "origin" in k.lower()]
        assert allowances == []
    realm = Realm(app_url, mail)
    email = f"pw{tag()}@example.com"
    must(realm.owner.c.post(f"/api/servers/{realm.slug}/invites", json={"email": email},
                            headers={"Host": FOREIGN_HOST, "Idempotency-Key": idempotency_key()}), 201)
    body = mail_text(mail_to(mail, email)[0])
    assert f"{public_base(app_url)}/join/" in body and FOREIGN_HOST not in body
    secrets = [os.environ[k] for k in SECRET_ENVS if len(os.environ.get(k, "")) >= 6]
    for path in ["/.env", "/.git/HEAD", "/.git/config", "/node_modules/.package-lock.json", "/run.json"]:
        r = httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT)
        assert "run-manifest-v1" not in r.text, path
        assert not any(s in r.text for s in secrets), path
    with open_app(browser, f"{app_url}/.env") as pg:
        ui(pg, lambda: expect(pg.get_by_role("heading", name="We couldn't find that page.")).to_be_visible(
            timeout=STEP_MS))


def test_error_shape_precedence_retry_after(app_url, mail):
    realm = Realm(app_url, mail)
    member = realm.player()
    err(member.api.post(f"/api/servers/{realm.slug}/members", {"handle": f"nob{tag()}"}), 403, "forbidden")
    field_error(realm.owner.post(f"/api/servers/{realm.slug}/members", {"handle": ""}), "Enter a handle.")
    err(httpx.get(f"{app_url}/api/me", timeout=HTTP_TIMEOUT), 401, "unauthenticated")
    pending = Realm(app_url, mail, active=False)
    r = pending.owner.post(f"/api/servers/{pending.slug}/characters",
                           {"name": f"C{tag()}", "appearance": "surveyor", "loadout": []})
    err(r, 423, "server_inactive", "This server is waiting for its first payment to be confirmed.")
    assert r.headers["Retry-After"] == "10"
    down = sign_in(outage("APP_KILLBILL_DOWN_URL"), "eli", SEED_PASS["eli"])
    r = down.post("/api/checkout", {"server_name": f"Down {tag()}", "plan": "hamlet"}, key=idempotency_key())
    err(r, 503, "billing_unavailable")
    assert r.headers["Retry-After"] == "30"
    store = sign_in(outage("APP_STORAGE_DOWN_URL"), "eli", SEED_PASS["eli"])
    r = store.post(f"/api/servers/{realm.slug}/worlds/home/saves", {})
    err(r, 503, "storage_unavailable")
    assert r.headers["Retry-After"] == "10"


def test_etags_conditional_writes(app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    tid = table_of(realm.owner, realm.slug, "Oak Chess Table")["id"]
    for r in [realm.owner.get(f"/api/servers/{realm.slug}"), realm.owner.get(f"/api/servers/{realm.slug}/worlds/home"),
              realm.owner.get(f"/api/tables/{tid}"), p.api.get(f"/api/characters/{ch['id']}")]:
        must(r, 200)
        etag = r.headers.get("ETag", "")
        assert etag.startswith('"') and etag.endswith('"') and not etag.startswith("W/"), etag
    path = f"/api/servers/{realm.slug}"
    first = realm.owner.get(path).headers["ETag"]
    err(realm.owner.patch(path, {"time_zone": "America/Chicago"}), 428, "precondition_required")
    b = err(realm.owner.patch(path, {"time_zone": "America/Chicago"}, STALE), 412, "precondition_failed",
            "This changed since you opened it. The latest version is now shown.")
    assert b["etag"] == first
    ok = realm.owner.patch(path, {"time_zone": "America/Chicago"}, first)
    assert must(ok, 200)["time_zone"] == "America/Chicago"
    assert ok.headers["ETag"] != first
    err(realm.owner.patch(path, {"time_zone": "UTC"}, first), 412, "precondition_failed")
    cpath = f"/api/characters/{ch['id']}"
    err(p.api.patch(cpath, {"appearance": "pilot"}), 428, "precondition_required")
    err(p.api.patch(cpath, {"appearance": "pilot"}, STALE), 412, "precondition_failed")
    assert must(p.api.patch(cpath, {"appearance": "pilot"}, p.api.get(cpath).headers["ETag"]), 200)["appearance"] == "pilot"


FIELD_CASES = ["character_name", "chat_text", "party_name", "world_name", "server_name", "display_name",
               "constructor", "__proto__", "toString", "hasOwnProperty"]


@pytest.mark.parametrize("case", FIELD_CASES, ids=FIELD_CASES)
def test_field_limits_and_unknown_fields(app_url, mail, case):
    if case in ("constructor", "__proto__", "toString", "hasOwnProperty"):
        api = sign_in(app_url, "oskar", SEED_PASS["oskar"])
        b = err(api.post("/api/me/preferences", {"sound": True, case: 1}), 422, "unknown_field",
                f"Unknown field: {case}")
        assert b["fields"] == {case: "Unknown field."}
        return
    if case == "server_name":
        api = sign_in(app_url, "eli", SEED_PASS["eli"])
        base = f"S {tag()} " + "x" * 40
        must(api.post("/api/checkout", {"server_name": base[:40], "plan": "hamlet"}, key=idempotency_key()), 201)
        field_error(api.post("/api/checkout", {"server_name": (base + "y")[:41], "plan": "hamlet"},
                             key=idempotency_key()), "Use at most 40 characters.")
        return
    realm = Realm(app_url, mail)
    if case == "display_name":
        for size, ok in ((40, True), (41, False)):
            t = tag()
            email = f"pw{t}@example.com"
            must(realm.owner.post(f"/api/servers/{realm.slug}/invites", {"email": email}, key=idempotency_key()), 201)
            r = Api(app_url).post(f"/api/invites/{invite_token(mail, email)}/accept",
                                  {"handle": f"p{t}", "display_name": "D" * size, "passcode": f"pass-{t}"})
            must(r, 201) if ok else field_error(r, "Use at most 40 characters.")
        return
    p = realm.player()
    if case == "character_name":
        name = (f"N{tag()}" + "x" * 20)[:20]
        assert make_char(p.api, realm.slug, name=name)["name"] == name
        field_error(p.api.post(f"/api/servers/{realm.slug}/characters",
                               {"name": (f"M{tag()}" + "x" * 21)[:21], "appearance": "mason", "loadout": []}),
                    "Use at most 20 characters.")
        return
    ch = make_char(p.api, realm.slug)
    if case == "chat_text":
        path = f"/api/servers/{realm.slug}/worlds/home/chat"
        msg = must(p.api.post(path, {"character_id": ch["id"], "text": "é" * 280}), 201)["message"]
        assert msg["text"] == "é" * 280
        field_error(p.api.post(path, {"character_id": ch["id"], "text": "é" * 281}), "Use at most 280 characters.")
    elif case == "party_name":
        party = must(p.api.post(f"/api/servers/{realm.slug}/parties", {"character_id": ch["id"], "name": "P" * 30}), 201)
        must(p.api.delete(f"/api/parties/{party['party']['id']}/members/{ch['id']}"), 200)
        field_error(p.api.post(f"/api/servers/{realm.slug}/parties", {"character_id": ch["id"], "name": "P" * 31}),
                    "Use at most 30 characters.")
    elif case == "world_name":
        path = f"/api/servers/{realm.slug}/worlds/home"
        r = realm.owner.patch(path, {"name": "W" * 40}, realm.owner.get(path).headers["ETag"])
        assert must(r, 200)["name"] == "W" * 40
        field_error(realm.owner.patch(path, {"name": "W" * 41}, realm.owner.get(path).headers["ETag"]),
                    "Use at most 40 characters.")


def test_game_reads_need_session_and_membership(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Oak Chess Table")
    t.sit_all()
    t.start()
    t.play(["e2e4"])
    watcher = realm.player()
    wc = make_char(watcher.api, realm.slug)
    walk_to(watcher.api, wc, ADJACENT["Oak Chess Table"])
    must(watcher.api.post(f"/api/tables/{t.tid}/spectators", {"character_id": wc["id"]}), 201)
    game = t.table["game_id"]
    reads = [f"/api/tables/{t.tid}", f"/api/games/{game}", f"/api/games/{game}/replay",
             f"/api/servers/{realm.slug}/games", f"/api/servers/{realm.slug}/leaderboards/chess"]
    streams = [f"/api/tables/{t.tid}/events", f"/api/servers/{realm.slug}/events",
               f"/api/servers/{realm.slug}/worlds/home/events"]
    outsider = sign_in(app_url, "sefa", SEED_PASS["sefa"])
    anon = Api(app_url)
    for path in reads + streams:
        for api, status, code in ((anon, 401, "unauthenticated"), (outsider, 404, "not_found")):
            with api.c.stream("GET", path, headers={"Accept": "text/event-stream"}) as r:
                assert r.status_code == status, (path, r.status_code)
                r.read()
                assert json.loads(r.text)["error"] == code, (path, r.text)
    white, black = t.at_seat(1), t.at_seat(2)
    legal = f"/api/tables/{t.tid}/legal-moves"
    assert "e7e5" in must(black[0].api.get(legal, params={"character_id": black[1]["id"]}), 200)["moves"]
    err(white[0].api.get(legal, params={"character_id": white[1]["id"]}), 403, "not_your_turn")
    err(watcher.api.get(legal, params={"character_id": wc["id"]}), 403, "not_your_turn")
    err(anon.get(legal, params={"character_id": black[1]["id"]}), 401, "unauthenticated")
    err(outsider.get(legal, params={"character_id": black[1]["id"]}), 404, "not_found")


def test_event_stream_resume_without_gaps(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit_all()
    t.start()
    api = t.people[0].api
    path = f"/api/tables/{t.tid}/events"
    first = Stream(api, path)
    snap = first.wait(lambda e: e["id"] is not None, what="snapshot")
    first.close()
    assert next(line for line in first.lines if line.strip()) == "retry: 2000"
    assert first.events[0]["event"] == "table"
    t.play(["1", "2", "1"])
    second = Stream(api, path, last_id=snap["id"])
    second.wait(lambda e: e["event"] == "table" and e["data"].get("turn") == 3, what="third drop")
    second.close()
    ids = [e["id"] for e in second.events]
    assert ids == sorted(set(ids)) and ids[0] > snap["id"], ids
    third = Stream(api, path, last_id=ids[0])
    third.wait(lambda e: e["id"] is not None and e["id"] >= ids[-1], what="resume tail")
    third.close()
    assert [e["id"] for e in third.events if e["id"] <= ids[-1]] == ids[1:]


def test_times_utc_and_server_zone(app_url, mail):
    realm = Realm(app_url, mail)
    path = f"/api/servers/{realm.slug}"
    must(realm.owner.patch(path, {"time_zone": "America/Chicago"}, realm.owner.get(path).headers["ETag"]), 200)
    email = f"pw{tag()}@example.com"
    inv_ = must(realm.owner.post(f"{path}/invites", {"email": email}, key=idempotency_key()), 201)["invite"]
    assert ISO_MS.match(inv_["expires_at"]), inv_
    local = datetime.strptime(inv_["expires_at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(
        tzinfo=timezone.utc).astimezone(ZoneInfo("America/Chicago"))
    lines = mail_text(mail_to(mail, email)[0]).splitlines()
    assert any(line.startswith(f"The link works once and expires at {local:%Y-%m-%d %H:%M} ") for line in lines), lines
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    msg = must(p.api.post(f"{path}/worlds/home/chat", {"character_id": ch["id"], "text": "hi"}), 201)["message"]
    assert ISO_MS.match(msg["created_at"])


def test_wf_cross_cutting_sign_in(browser, app_url):
    path = f"/s/{LARK}/roster"
    with open_app(browser, app_url + path) as pg:
        at_url(pg, r"/sign-in\?next=")
        assert parse_qs(urlparse(pg.url).query)["next"] == [path]
        fill(pg.get_by_role("textbox", name="Handle"), "ines")
        fill(pg.get_by_label("Passcode", exact=True), "wrong-passcode")
        click(pg.get_by_role("button", name="Sign in"))
        say(pg, "Sign-in status", "Handle or passcode is wrong.")
        fill(pg.get_by_label("Passcode", exact=True), SEED_PASS["ines"])
        click(pg.get_by_role("button", name="Sign in"))
        at_url(pg, re.escape(path) + "$")
        pg.reload()
        at_url(pg, re.escape(path) + "$")
        ui(pg, lambda: expect(pg.get_by_role("heading", name="Characters")).to_be_visible(timeout=STEP_MS))
    with open_app(browser, f"{app_url}/sign-in") as pg:
        fill(pg.get_by_role("textbox", name="Handle"), "oskar")
        fill(pg.get_by_label("Passcode", exact=True), SEED_PASS["oskar"])
        click(pg.get_by_role("button", name="Sign in"))
        at_url(pg, r"/servers$")
        pg.reload()
        at_url(pg, r"/servers$")
        ui(pg, lambda: expect(pg.get_by_role("list", name="Servers").get_by_role(
            "link", name="Larkspur Commons")).to_be_visible(timeout=STEP_MS))


def test_wf_cross_cutting_sound(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table", n=1)
    p, c = t.people[0], t.chars[0]
    must(p.api.post("/api/me/preferences", {"sound": False}), 200)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode, init=OSC_JS) as pg:
        media = []
        pg.on("request", lambda r: media.append(r.url) if re.search(r"\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)", r.url) else None)
        take(pg, "Lantern Four Table")
        ui(pg, lambda: expect(pg.get_by_role("dialog", name="Lantern Four Table")).to_be_visible(timeout=STEP_MS))
        advance(pg, 1000)
        assert pg.evaluate(OSC_COUNT_JS) == 0
        must(p.api.delete(f"/api/tables/{t.tid}/seats/{c['id']}"), 200)
        pg.goto(f"{app_url}/s/{realm.slug}/w/home")
        toggle = pg.get_by_role("button", name="Sound")
        ui(pg, lambda: expect(toggle).to_have_attribute("aria-pressed", "false", timeout=STEP_MS))
        click(toggle)
        ui(pg, lambda: expect(toggle).to_have_attribute("aria-pressed", "true", timeout=STEP_MS))
        poll(lambda: must(p.api.get("/api/me"), 200)["preferences"]["sound"] is True, 10, "sound saved")
        take(pg, "Lantern Four Table")
        ui(pg, lambda: expect(pg.get_by_role("dialog", name="Lantern Four Table")).to_be_visible(timeout=STEP_MS))
        ui(pg, lambda: assert_eq(pg.evaluate(OSC_COUNT_JS), 2))
        assert media == []


def test_character_roster_limits(app_url, mail):
    realm = Realm(app_url, mail, plan="hamlet")
    p1, p2, p3, p4 = (realm.player() for _ in range(4))
    first = make_char(p1.api, realm.slug, loadout=["rope", "compass"])
    assert (first["x"], first["y"]) == SPAWN and first["balance"] == GRANT
    slots = inv(p1.api, first["id"])
    assert [(slots[i]["kind"], slots[i]["count"]) for i in range(1, 7)] == [
        ("wood", 16), ("stone", 16), ("brick", 8), ("glass", 4), ("compass", 1), ("rope", 1)]
    field_error(p1.api.post(f"/api/servers/{realm.slug}/characters",
                            {"name": f"L{tag()}", "appearance": "pilot", "loadout": ["compass", "rope", "lantern", "trowel"]}),
                "Choose at most 3 items.")
    field_error(p2.api.post(f"/api/servers/{realm.slug}/characters",
                            {"name": first["name"].upper(), "appearance": "pilot", "loadout": []}),
                "That character name is taken on this server.")
    make_char(p1.api, realm.slug)
    make_char(p1.api, realm.slug)
    err(p1.api.post(f"/api/servers/{realm.slug}/characters", {"name": f"R{tag()}", "appearance": "mason", "loadout": []}),
        409, "roster_full", "You already have the most characters allowed on this server.")
    for who in (realm.owner, p2.api, p3.api):
        for _ in range(3):
            make_char(who, realm.slug)
    err(p4.api.post(f"/api/servers/{realm.slug}/characters", {"name": f"X{tag()}", "appearance": "mason", "loadout": []}),
        409, "character_limit", f"This server's plan allows {HAMLET_CHARACTERS} characters.")
    assert must(realm.owner.get(f"/api/servers/{realm.slug}"), 200)["character_count"] == HAMLET_CHARACTERS
    other = Realm(app_url, mail)
    must(other.owner.post(f"/api/servers/{other.slug}/members", {"handle": p4.handle}), 201)
    prefix = f"Q{tag()}"
    other_char = make_char(p4.api, other.slug, name=prefix + "b")
    res = must(p4.api.get(f"/api/servers/{other.slug}/characters", params={"q": prefix, "mine": "false"}), 200)
    assert res["total"] == 1 and [c["id"] for c in res["characters"]] == [other_char["id"]]
    res = must(p1.api.get(f"/api/servers/{realm.slug}/characters", params={"q": prefix, "mine": "false"}), 200)
    assert res["total"] == 0 and res["characters"] == []


def test_wf_player_roster_keyboard(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    other = make_char(p.api, realm.slug, name=f"Zx{tag()}")
    name = f"Kb{tag()}"
    with signed_in(browser, app_url, f"/s/{realm.slug}/roster", p.handle, p.passcode) as pg:
        opener = pg.get_by_role("button", name="New character")
        opener.focus()
        pg.keyboard.press("Enter")
        dlg = pg.get_by_role("dialog", name="New character")
        focused(pg, dlg.get_by_role("textbox", name="Name"))
        names = tab_order(pg, 4)
        assert names[0] in APPEARANCES and names[2] == "Create" and names[3] == "Name", names
        pg.keyboard.press("Shift+Tab")
        focused(pg, dlg.get_by_role("button", name="Create"))
        pg.keyboard.press("Enter")
        say(pg, "New character status", f"{'Enter a name.'} {'Choose an appearance.'}", scope=dlg)
        expect(dlg.get_by_role("link", name="Enter a name.")).to_be_visible()
        focused(pg, dlg.get_by_role("textbox", name="Name"))
        pg.keyboard.type(name)
        pg.keyboard.press("Tab")
        pg.keyboard.press("ArrowDown")
        expect(dlg.get_by_role("radio", checked=True)).to_have_count(1)
        chosen = dlg.get_by_role("radio", checked=True).get_attribute("aria-label") or \
            dlg.get_by_role("radio", checked=True).inner_text()
        pg.keyboard.press("Tab")
        for i in range(4):
            if i:
                pg.keyboard.press("ArrowDown")
            pg.keyboard.press("Space")
        selected = dlg.get_by_role("listbox", name="Loadout").get_by_role("option", selected=True)
        expect(selected).to_have_count(3)
        pg.keyboard.press("Tab")
        focused(pg, dlg.get_by_role("button", name="Create"))
        pg.keyboard.press("Enter")
        say(pg, "Roster status", f"Character created: {name}")
        focused(pg, opener)
        mine = must(p.api.get(f"/api/servers/{realm.slug}/characters", params={"q": name, "mine": "true"}), 200)
        made = next(c for c in mine["characters"] if c["name"] == name)
        assert made["loadout"] == ["compass", "rope", "lantern"]
        assert made["appearance"] == chosen.strip().lower()
        pg.keyboard.press("Enter")
        ui(pg, lambda: expect(dlg).to_be_visible(timeout=STEP_MS))
        pg.keyboard.press("Escape")
        ui(pg, lambda: expect(dlg).to_have_count(0, timeout=STEP_MS))
        focused(pg, opener)
        combo = pg.get_by_role("combobox", name="Character")
        combo.focus()
        pg.keyboard.type(other["name"][:3])
        pg.keyboard.press("ArrowDown")
        pg.keyboard.press("Enter")
        shows(pg, pg.get_by_role("region", name="Character details"), other["name"])
    total = must(p.api.get(f"/api/servers/{realm.slug}/characters", params={"mine": "true"}), 200)["total"]
    assert total == 2


def test_roster_layouts(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    for _ in range(3):
        make_char(p.api, realm.slug)
    with signed_in(browser, app_url, f"/s/{realm.slug}/roster", p.handle, p.passcode, size=(375, 812)) as pg:
        for w, h in ((375, 812), (768, 1024), (1280, 800)):
            pg.set_viewport_size({"width": w, "height": h})
            roster = pg.get_by_role("list", name="Roster")
            details = pg.get_by_role("region", name="Character details")
            ui(pg, lambda: expect(roster.get_by_role("listitem")).to_have_count(3, timeout=STEP_MS))
            layout(pg)
            rb, db = roster.bounding_box(), details.bounding_box()
            items = [roster.get_by_role("listitem").nth(i).bounding_box() for i in range(3)]
            if w == 375:
                assert box_bottom(rb) <= db["y"] + 1 and rb["width"] >= 0.8 * w, (rb, db)
                assert items[0]["y"] < items[1]["y"] < items[2]["y"]
            elif w == 768:
                assert rb["width"] <= ROSTER_SPLIT_MAX * w and db["x"] >= rb["x"] + rb["width"] - 1, (rb, db)
                assert abs(rb["y"] - db["y"]) <= 8, (rb, db)
                assert items[0]["y"] < items[1]["y"]
            else:
                assert abs(items[0]["y"] - items[1]["y"]) <= 2, items
                assert RAIL_ABOUT_320[0] <= db["width"] <= RAIL_ABOUT_320[1] and db["x"] > rb["x"], db


def test_wf_player_roster_add_member(browser, app_url, mail):
    realm = Realm(app_url, mail, plan="hamlet")
    with signed_in(browser, app_url, f"/s/{realm.slug}/admin", "eli", SEED_PASS["eli"]) as pg:
        fill(pg.get_by_role("textbox", name="Member handle"), "dara")
        click(pg.get_by_role("button", name="Add member"))
        say(pg, "Admin status", f"{'dara'} added to the server")
        shows(pg, pg.get_by_role("list", name="Members"), "dara")
        fill(pg.get_by_role("textbox", name="Member handle"), "dara")
        click(pg.get_by_role("button", name="Add member"))
        say(pg, "Admin status", f"{'dara'} is already a member.")
    handles = lambda: {f["handle"] for f in must(realm.owner.get(f"/api/servers/{realm.slug}/friends"), 200)["friends"]}
    assert "dara" in handles()
    path = f"/api/servers/{realm.slug}/members"
    err(realm.owner.post(path, {"handle": f"nob{tag()}"}), 404, "unknown_handle", "No player has that handle.")
    field_error(realm.owner.post(path, {"handle": "AB"}), "Use 3 to 24 lower-case letters, digits or hyphens.")
    field_error(realm.owner.post(path, {"handle": ""}), "Enter a handle.")
    field_error(realm.owner.post(path, {"handle": "a" * 25}), "Use at most 24 characters.")
    dara = sign_in(app_url, "dara", SEED_PASS["dara"])
    err(dara.post(path, {"handle": f"nob{tag()}"}), 403, "forbidden")
    for h in ("sefa", "rowan", "mara", "tobias"):
        must(realm.owner.post(path, {"handle": h}), 201)
    before = handles()
    assert len(before) == HAMLET_MEMBERS
    err(realm.owner.post(path, {"handle": "oskar"}), 409, "member_limit_reached",
        f"This server's plan allows {HAMLET_MEMBERS} members.")
    err(realm.owner.post(path, {"handle": "dara"}), 409, "already_member", f"{'dara'} is already a member.")
    assert handles() == before and "oskar" not in before


def test_wf_owner_checkout_rent(browser, app_url, killbill):
    name = f"Rent {tag()}"
    with signed_in(browser, app_url, "/servers/new", "rowan", SEED_PASS["rowan"]) as pg:
        heading = lambda n: pg.get_by_role("heading", name=n)
        focused(pg, heading("Step 1 of 3: Name"))
        click(pg.get_by_role("button", name="Next"))
        shows(pg, pg.get_by_role("status", name="Checkout status"), "Enter a server name.")
        expect(heading("Step 1 of 3: Name")).to_be_visible()
        fill(pg.get_by_role("textbox", name="Server name"), name)
        click(pg.get_by_role("button", name="Next"))
        focused(pg, heading("Step 2 of 3: Plan"))
        click(pg.get_by_role("button", name="Back"))
        expect(pg.get_by_role("textbox", name="Server name")).to_have_value(name)
        click(pg.get_by_role("button", name="Next"))
        click(pg.get_by_role("radio", name="Hamlet, 6.00 USD a month"))
        click(pg.get_by_role("button", name="Next"))
        focused(pg, heading("Step 3 of 3: Review"))
        click(pg.get_by_role("button", name="Back"))
        expect(pg.get_by_role("radio", name="Hamlet, 6.00 USD a month")).to_be_checked()
        click(pg.get_by_role("button", name="Next"))
        click(pg.get_by_role("button", name="Rent server"))
        slug = name.lower().replace(" ", "-")
        at_url(pg, rf"/s/{re.escape(slug)}/billing$")
        status = pg.get_by_role("status", name="Billing status")
        shows(pg, status, "PENDING")
        pg.reload()
        at_url(pg, rf"/s/{re.escape(slug)}/billing$")
        shows(pg, status, "PENDING")
    api = sign_in(app_url, "rowan", SEED_PASS["rowan"])
    srv = must(api.get(f"/api/servers/{slug}"), 200)
    assert srv["status"] == "pending_approval"
    acct = killbill.account_by_key(f"plotwright-{srv['id']}")
    assert acct is not None
    assert [s["planName"] for s in killbill.subscriptions(acct["accountId"])] == ["hamlet-monthly"]


def test_checkout_creates_provider_records_once(app_url, killbill):
    api = sign_in(app_url, "eli", SEED_PASS["eli"])
    key, body = idempotency_key(), {"server_name": f"Once {tag()}", "plan": "borough"}
    first = api.post("/api/checkout", body, key=key)
    b1 = must(first, 201)
    assert b1["server"]["status"] == "pending_approval"
    assert b1["billing_url"] == f"/s/{b1['server']['slug']}/billing"
    again = api.post("/api/checkout", body, key=key)
    assert again.status_code == 201 and again.json() == b1
    err(api.post("/api/checkout", {"server_name": f"Other {tag()}", "plan": "borough"}, key=key),
        409, "idempotency_key_reused")
    b = err(api.post("/api/checkout", {"server_name": f"Nokey {tag()}", "plan": "borough"}), 422, "validation")
    assert "idempotency_key" in b["fields"]
    acct = killbill.account_by_key(f"plotwright-{b1['server']['id']}")
    assert acct is not None
    subs = killbill.subscriptions(acct["accountId"])
    assert [s["planName"] for s in subs] == ["borough-monthly"]
    mine = [s for s in must(api.get("/api/me"), 200)["servers"] if s["name"] == body["server_name"]]
    assert len(mine) == 1


def test_approve_payment_activates_only_on_provider(app_url, mail, killbill):
    realm = Realm(app_url, mail, active=False)
    for path in [f"/api/servers/{realm.slug}?status=active", f"/api/servers/{realm.slug}/billing?paid=true"]:
        realm.owner.get(path)
    httpx.get(f"{app_url}/s/{realm.slug}/billing?payment=success&status=active", timeout=HTTP_TIMEOUT)
    assert must(realm.owner.get(f"/api/servers/{realm.slug}"), 200)["status"] == "pending_approval"
    realm.activate()
    acct = killbill.account_by_key(f"plotwright-{realm.id}")["accountId"]
    invoices = [i for i in killbill.invoices(acct) if Decimal(str(i["amount"])) > 0]
    assert invoices and all(Decimal(str(i["balance"])) == 0 for i in invoices)
    for i in invoices:
        assert killbill.payment_by_key(f"pw-pay-{i['invoiceId']}") is not None
    keys = [p["paymentExternalKey"] for p in killbill.payments(acct)]
    assert sorted(keys) == sorted(f"pw-pay-{i['invoiceId']}" for i in invoices)
    err(realm.owner.post(f"/api/servers/{realm.slug}/billing/payments", {}), 409, "nothing_due",
        "There is nothing to pay.")


def test_slow_provider_leaves_payment_pending(app_url, mail, killbill):
    slow = outage("APP_SLOW_BILLING_URL")
    realm = Realm(app_url, mail, active=False)
    api = sign_in(slow, "eli", SEED_PASS["eli"])
    r = api.post(f"/api/servers/{realm.slug}/billing/payments", {})
    b = must(r, 202)
    assert b["payment_pending"] is True and b["status_word"] == "PAYMENT PENDING"
    err(api.post(f"/api/servers/{realm.slug}/billing/payments", {}), 409, "payment_pending")
    poll(lambda: must(realm.owner.get(f"/api/servers/{realm.slug}"), 200)["status"] == "active", SETTLER_WAIT, "settled")
    acct = killbill.account_by_key(f"plotwright-{realm.id}")["accountId"]
    invoices = [i for i in killbill.invoices(acct) if Decimal(str(i["amount"])) > 0]
    keys = [p["paymentExternalKey"] for p in killbill.payments(acct)]
    assert sorted(keys) == sorted(f"pw-pay-{i['invoiceId']}" for i in invoices)


def test_parallel_approvals_one_payment(app_url, mail, killbill):
    realm = Realm(app_url, mail, active=False)
    apis = [sign_in(b, "eli", SEED_PASS["eli"]) for b in
            (app_url, outage("APP_STORAGE_DOWN_URL"), outage("APP_MAIL_DOWN_URL"))] * 2
    with concurrent.futures.ThreadPoolExecutor(len(apis)) as ex:
        results = list(ex.map(lambda a: a.post(f"/api/servers/{realm.slug}/billing/payments", {}), apis))
    codes = [r.status_code for r in results]
    assert any(c in (200, 202) for c in codes), codes
    for r in results:
        assert r.status_code in (200, 202, 409), r.text
        if r.status_code == 409:
            assert r.json()["error"] in ("payment_pending", "nothing_due")
    realm.activate()
    acct = killbill.account_by_key(f"plotwright-{realm.id}")["accountId"]
    invoices = [i for i in killbill.invoices(acct) if Decimal(str(i["amount"])) > 0]
    keys = [p["paymentExternalKey"] for p in killbill.payments(acct)]
    assert sorted(keys) == sorted(f"pw-pay-{i['invoiceId']}" for i in invoices), keys


def test_wf_owner_checkout_outage(browser, app_url, mail, killbill):
    down = outage("APP_KILLBILL_DOWN_URL")
    realm = Realm(app_url, mail)
    api = sign_in(down, "eli", SEED_PASS["eli"])
    name = f"Nope {tag()}"
    err(api.post("/api/checkout", {"server_name": name, "plan": "hamlet"}, key=idempotency_key()), 503, "billing_unavailable")
    assert name not in [s["name"] for s in must(realm.owner.get("/api/me"), 200)["servers"]]
    err(api.get(f"/api/servers/{name.lower().replace(' ', '-')}"), 404, "not_found")
    billing = must(api.get(f"/api/servers/{realm.slug}/billing"), 200)
    assert billing["provider_reachable"] is False and billing["status"] == "active"
    err(api.post(f"/api/servers/{realm.slug}/billing/payments", {}), 503, "billing_unavailable")
    err(api.post(f"/api/servers/{realm.slug}/plan", {"plan": "hamlet"}), 503, "billing_unavailable")
    err(api.get(f"/api/servers/{realm.slug}/billing/statement.csv"), 503, "billing_unavailable")
    srv = must(realm.owner.get(f"/api/servers/{realm.slug}"), 200)
    assert srv["plan"] == "borough"
    acct = killbill.account_by_key(f"plotwright-{realm.id}")["accountId"]
    assert [s["planName"] for s in killbill.subscriptions(acct)] == ["borough-monthly"]
    with signed_in(browser, down, f"/s/{realm.slug}/billing", "eli", SEED_PASS["eli"]) as pg:
        status = pg.get_by_role("status", name="Billing status")
        shows(pg, status, "The billing provider is unreachable. Nothing was charged or changed. Showing the last confirmed status.")
        expect(status).to_contain_text("PAID")
        expect(status).not_to_contain_text("Payment confirmed by the billing provider.")


def test_plan_change_pending_until_confirmed(app_url, mail, killbill):
    realm = Realm(app_url, mail, plan="hamlet")
    for h in ("dara", "sefa", "rowan", "mara", "tobias"):
        must(realm.owner.post(f"/api/servers/{realm.slug}/members", {"handle": h}), 201)
    b = must(realm.owner.post(f"/api/servers/{realm.slug}/plan", {"plan": "borough"}), 200)
    assert b["pending_plan"] == "borough" and b["plan"] == "hamlet"
    acct = killbill.account_by_key(f"plotwright-{realm.id}")["accountId"]
    assert [s["planName"] for s in killbill.subscriptions(acct)] == ["borough-monthly"]
    assert must(realm.owner.get(f"/api/servers/{realm.slug}"), 200)["plan"] == "hamlet"
    err(realm.owner.post(f"/api/servers/{realm.slug}/members", {"handle": "oskar"}), 409, "member_limit_reached")
    err(realm.owner.post(f"/api/servers/{realm.slug}/plan", {"plan": "hamlet"}), 409, "plan_change_pending")
    must(realm.owner.post(f"/api/servers/{realm.slug}/billing/payments", {}), 200, 202)
    poll(lambda: must(realm.owner.get(f"/api/servers/{realm.slug}/billing"), 200)["plan"] == "borough", ACTIVE_WAIT, "confirmed")
    assert must(realm.owner.get(f"/api/servers/{realm.slug}/billing"), 200)["pending_plan"] is None
    must(realm.owner.post(f"/api/servers/{realm.slug}/members", {"handle": "oskar"}), 201)
    err(realm.owner.post(f"/api/servers/{realm.slug}/plan", {"plan": "borough"}), 409, "same_plan",
        "The server is already on that plan.")


def test_wf_owner_plan_change_ui(browser, app_url, mail, killbill):
    realm = Realm(app_url, mail, plan="hamlet")
    path = f"/s/{realm.slug}/billing"
    with signed_in(browser, app_url, path, "eli", SEED_PASS["eli"]) as pg:
        pg.clock.set_system_time(DEVICE_SKEW)
        status = pg.get_by_role("status", name="Billing status")
        shows(pg, status, "PAID")
        click(pg.get_by_role("radio", name="Borough, 12.00 USD a month"))
        click(pg.get_by_role("button", name="Change plan"))
        shows(pg, status, f"Plan change to {'Borough'} is waiting for the billing provider to confirm payment.")
        at_url(pg, re.escape(path) + "$")
        click(pg.get_by_role("button", name="Approve payment"))
        shows(pg, status, f"Plan: {'Borough'}", seconds=ACTIVE_WAIT)
        shows(pg, status, "PAID")
        at_url(pg, re.escape(path) + "$")
        pg.reload()
        shows(pg, status, f"Plan: {'Borough'}")
        shows(pg, status, "Payment confirmed by the billing provider.")
    assert must(realm.owner.get(f"/api/servers/{realm.slug}/billing"), 200)["plan"] == "borough"
    acct = killbill.account_by_key(f"plotwright-{realm.id}")["accountId"]
    assert all(Decimal(str(i["balance"])) == 0 for i in killbill.invoices(acct))


def test_wf_owner_plan_change_statement(browser, app_url, mail, killbill):
    realm = Realm(app_url, mail, plan="hamlet")
    must(realm.owner.post(f"/api/servers/{realm.slug}/plan", {"plan": "borough"}), 200)
    must(realm.owner.post(f"/api/servers/{realm.slug}/billing/payments", {}), 200, 202)
    poll(lambda: must(realm.owner.get(f"/api/servers/{realm.slug}/billing"), 200)["plan"] == "borough", ACTIVE_WAIT, "confirmed")
    r = realm.owner.get(f"/api/servers/{realm.slug}/billing/statement.csv")
    must(r, 200)
    assert r.headers["content-type"].startswith("text/csv")
    assert f'filename="{realm.slug}-statement.csv"' in r.headers["content-disposition"]
    raw = r.content
    assert not raw.startswith(codecs.BOM_UTF8) and raw.endswith(CRLF)
    assert raw.count(LF) == raw.count(CRLF)
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8"), newline="")))
    assert rows[0] == ["date", "kind", "plan", "amount", "balance_after", "kb_id"]
    body = rows[1:]
    acct = killbill.account_by_key(f"plotwright-{realm.id}")["accountId"]
    invoices = sorted(killbill.invoices(acct), key=lambda i: i["invoiceNumber"])
    inv_rows = [row for row in body if row[1] == "invoice"]
    assert [row[5] for row in inv_rows] == [i["invoiceId"] for i in invoices]
    for row, i in zip(inv_rows, invoices):
        assert row[3] == f"{Decimal(str(i['amount'])):.2f}" and row[0] == str(i["invoiceDate"])[:10]
    payments = {p["paymentId"]: p for p in killbill.payments(acct)}
    pay_rows = [row for row in body if row[1] == "payment"]
    assert sorted(row[5] for row in pay_rows) == sorted(payments)
    assert all(Decimal(row[3]) < 0 for row in pay_rows)
    changes = [row for row in body if row[1] == "plan_change"]
    assert len(changes) == 1 and changes[0][3] == "0.00" and changes[0][2] == "Borough"
    running = Decimal("0")
    for row in body:
        assert DATE_RE.match(row[0]) and row[1] in ("plan_change", "invoice", "credit", "payment")
        running += Decimal(row[3])
        assert row[4] == f"{running:.2f}", row
    assert body[-1][4] == f"{sum(Decimal(str(i['balance'])) for i in invoices):.2f}"
    with signed_in(browser, app_url, f"/s/{realm.slug}/billing", "eli", SEED_PASS["eli"]) as pg:
        with pg.expect_download() as dl:
            click(pg.get_by_role("link", name="Download statement"))
        assert Path(dl.value.path()).read_bytes() == raw
    assert realm.owner.get(f"/api/servers/{realm.slug}/billing/statement.csv").content == raw


def short_active_server(handle):
    short = outage("APP_SHORT_URL")
    api = sign_in(short, handle, SEED_PASS[handle])
    srv = must(api.post("/api/checkout", {"server_name": f"Grace {tag()}", "plan": "hamlet"},
                        key=idempotency_key()), 201)["server"]
    slug = srv["slug"]

    def active():
        s = must(api.get(f"/api/servers/{slug}"), 200)
        if s["status"] != "active":
            api.post(f"/api/servers/{slug}/billing/payments", {})
        return s["status"] == "active"
    poll(active, ACTIVE_WAIT, "short server active")
    return short, api, srv


def billing_in(api, slug, status):
    def seen():
        b = must(api.get(f"/api/servers/{slug}/billing"), 200)
        return b if b["status"] == status else None
    return poll(seen, ACTIVE_WAIT, status)


def test_wf_owner_suspension_grace(app_url, killbill):
    short, api, srv = short_active_server("rowan")
    slug = srv["slug"]
    b = must(api.post(f"/api/servers/{slug}/plan", {"plan": "borough"}), 200)
    assert b["pending_plan"] == "borough"
    hold(lambda: must(api.get(f"/api/servers/{slug}"), 200)["status"] == "active", GRACE_HOLD, "still active")
    s = must(api.get(f"/api/servers/{slug}"), 200)
    assert s["suspends_at"] is None and s["suspends_at_label"] is None
    assert must(api.get(f"/api/servers/{slug}/billing"), 200)["past_due_since"] is None
    kb_overdue_charge(killbill.account_by_key(f"plotwright-{srv['id']}")["accountId"])
    billing = billing_in(api, slug, "past_due")
    assert billing["status_word"] == "PAST DUE"
    since, until = iso(billing["past_due_since"]), iso(billing["suspends_at"])
    assert abs((until - since) - SHORT_GRACE) <= DATE_TOL, (billing["past_due_since"], billing["suspends_at"])
    s = must(api.get(f"/api/servers/{slug}"), 200)
    assert s["status"] == "past_due" and s["suspends_at"] == billing["suspends_at"]
    hold(lambda: must(api.get(f"/api/servers/{slug}"), 200)["status"] == "past_due",
         max(0.0, until - GRACE_TOL - time.time()), "past due before suspends_at")
    billing_in(api, slug, "suspended")
    assert time.time() >= until - GRACE_TOL
    s = must(api.get(f"/api/servers/{slug}"), 200)
    assert s["status"] == "suspended" and s["status_word"] == "SUSPENDED"


def test_wf_owner_suspension_banner(browser, app_url, killbill):
    short, api, srv = short_active_server("dara")
    slug = srv["slug"]
    with signed_in(browser, short, f"/s/{slug}/roster", "dara", SEED_PASS["dara"]) as pg:
        pg.clock.set_system_time(DEVICE_SKEW)
        notice = pg.get_by_role("region", name="Server notice")
        ui(pg, lambda: expect(pg.get_by_role("heading", name="Characters")).to_be_visible(timeout=STEP_MS))
        expect(notice).to_have_count(0)
        kb_overdue_charge(killbill.account_by_key(f"plotwright-{srv['id']}")["accountId"])
        billing_in(api, slug, "past_due")
        s = must(api.get(f"/api/servers/{slug}"), 200)
        label = s["suspends_at_label"]
        local = datetime.fromtimestamp(iso(s["suspends_at"]), timezone.utc)
        assert label == f"{local:%Y-%m-%d %H:%M} UTC", label
        overdue = f"An invoice is overdue. This server will be suspended at {label} unless the payment is approved."
        pg.reload()
        ui(pg, lambda: expect(notice).to_have_text(overdue, timeout=STEP_MS))
        billing_in(api, slug, "suspended")
        suspended = ("This server is suspended because an invoice is unpaid. Play and saves are paused until the "
                     "billing provider confirms payment. Your worlds can still be exported.")
        ui(pg, lambda: expect(notice).to_have_text(suspended, timeout=STEP_MS))
        pg.goto(f"{short}/s/{slug}/leaderboards")
        ui(pg, lambda: expect(notice).to_have_text(suspended, timeout=STEP_MS))


def test_inactive_server_refuses_play(app_url, mail):
    realm = Realm(app_url, mail, active=False)
    body = {"name": f"C{tag()}", "appearance": "surveyor", "loadout": []}
    for path, payload in [(f"/api/servers/{realm.slug}/characters", body),
                          (f"/api/servers/{realm.slug}/worlds/home/saves", {})]:
        err(realm.owner.post(path, payload), 423, "server_inactive")
    must(realm.owner.post(f"/api/servers/{realm.slug}/members", {"handle": "sefa"}), 201)
    must(realm.owner.post(f"/api/servers/{realm.slug}/invites", {"email": f"pw{tag()}@example.com"}, key=idempotency_key()), 201)
    assert must(realm.owner.get(f"/api/servers/{realm.slug}/worlds/home/saves"), 200)["saves"] == []
    realm.activate()
    must(realm.owner.post(f"/api/servers/{realm.slug}/characters", body), 201)
    must(realm.owner.post(f"/api/servers/{realm.slug}/worlds/home/saves", {}), 201)


def test_wf_owner_suspension_receipt(browser, app_url, mail):
    realm = Realm(app_url, mail, active=False)
    with signed_in(browser, app_url, f"/s/{realm.slug}/billing", "eli", SEED_PASS["eli"]) as pg:
        click(pg.get_by_role("button", name="Approve payment"))
        status = pg.get_by_role("status", name="Billing status")
        shows(pg, status, "Payment confirmed by the billing provider.", seconds=ACTIVE_WAIT)
        advance(pg, 12000)
        expect(status).to_contain_text("Payment confirmed by the billing provider.")
        expect(status).to_contain_text("PAID")
    with concurrent.futures.ThreadPoolExecutor(3) as ex:
        rs = list(ex.map(lambda _: realm.owner.post(f"/api/servers/{realm.slug}/billing/payments", {}), range(3)))
    for r in rs:
        err(r, 409, "nothing_due")
    subject = f"Payment confirmed for {realm.name}"
    owner_email = f"{'eli'}@plotwright.test"
    mail_to(mail, owner_email, subject)
    msgs = mail_exactly(mail, owner_email, subject)
    assert len(msgs) == 1, len(msgs)
    receipt = f"The billing provider confirmed a payment of {'12.00'} USD for {realm.name}. Plan: {'Borough'}."
    assert receipt in mail_text(msgs[0])


def kb_overdue_charge(account_id):
    base = os.environ["KILLBILL_URL"].rstrip("/")
    r = httpx.post(f"{base}/1.0/kb/invoices/charges/{account_id}", params={"autoCommit": "true"},
                   json=[{"accountId": account_id, "amount": 1.0, "currency": "USD",
                          "description": f"overdue {tag()}"}],
                   auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
                   headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
                            "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
                            "X-Killbill-CreatedBy": "verifier"}, timeout=HTTP_TIMEOUT)
    assert r.status_code in (200, 201), r.text


RACE_MOVES = ["1", "2", "3", "4", "5", "6", "2", "1", "4", "3", "6", "5"]


def test_suspension_abandons_live_play(app_url, mail, killbill):
    short = outage("APP_SHORT_URL")
    realm = Realm(short, mail, owner="sefa")
    t = Table(realm, "Lantern Four Table", n=3)
    t.sit(0)
    t.sit(1)
    spec, sc = t.people[2], t.chars[2]
    must(spec.api.post(f"/api/tables/{t.tid}/spectators", {"character_id": sc["id"]}), 201)
    t.refresh()
    t.start()
    gid = t.table["game_id"]
    lead, lc = t.people[0], t.chars[0]
    pid = must(lead.api.post(f"/api/servers/{realm.slug}/parties", {"character_id": lc["id"], "name": f"P {tag()}"}), 201)["party"]["id"]
    run = must(lead.api.post(f"/api/parties/{pid}/chapter-runs", {"chapter_id": "surveyors-pegs"}), 201)["run"]
    acct = killbill.account_by_key(f"plotwright-{realm.id}")["accountId"]
    kb_overdue_charge(acct)
    poll(lambda: must(realm.owner.get(f"/api/servers/{realm.slug}"), 200)["status"] in ("past_due", "suspended"),
         ACTIVE_WAIT, "past due")
    accepted, refused, queue = [], [], list(RACE_MOVES)

    def suspended():
        if queue and not refused:
            r = t.move(queue[0])
            if r.status_code == 200:
                accepted.append(queue.pop(0))
            else:
                err(r, 423, "server_suspended",
                    "This server is suspended. Play and saves resume once the billing provider confirms payment.")
                refused.append(r)
        return must(realm.owner.get(f"/api/servers/{realm.slug}"), 200)["status"] == "suspended"
    poll(suspended, ACTIVE_WAIT, "suspended")
    info = must(realm.owner.get(f"/api/tables/{t.tid}"), 200)
    assert info["state"] == "open" and all(s["character"] is None for s in info["seats"]) and info["spectators"] == []
    game = must(realm.owner.get(f"/api/games/{gid}"), 200)
    res = game["result"]
    assert res["outcome"] == "abandoned" and res["reason"] == "server_suspended"
    assert res["text"] == f"{ABANDONED} {STAKES_RETURNED}"
    assert [x["amount"] for x in res["settlement"]] == [0, 0]
    assert len(game["moves"]) == len(accepted), (game["moves"], accepted)
    p0, c0 = t.people[0], t.chars[0]
    err(p0.api.post(f"/api/tables/{t.tid}/moves", {"character_id": c0["id"], "turn": len(accepted), "move": "7"}),
        423, "server_suspended")
    assert len(must(realm.owner.get(f"/api/games/{gid}"), 200)["moves"]) == len(accepted)
    for p, c in zip(t.people[:2], t.chars[:2]):
        assert must(p.api.get(f"/api/characters/{c['id']}/wallet"), 200)["balance"] == GRANT
    for e in ledger(realm):
        assert sum(line["amount"] for line in e["lines"]) == 0, e
    assert len([e for e in ledger(realm) if e["game_id"] == gid and e["kind"] == "settlement"]) == 1
    assert must(lead.api.get(f"/api/chapter-runs/{run['id']}"), 200)["run"]["state"] == "paused"


def save_keys(sid, save_id):
    prefix = f"servers/{sid}/worlds/home/saves/{save_id}/"
    return prefix + "snapshot.json", prefix + "manifest.json"


def test_world_save_all_or_nothing(app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    must(p.api.post(f"/api/servers/{realm.slug}/worlds/home/blocks", {"character_id": ch["id"], "x": 17, "y": 9, "material": "brick"}), 201)
    save = must(p.api.post(f"/api/servers/{realm.slug}/worlds/home/saves", {}), 201)["save"]
    assert save["number"] == 1
    s3 = S3()
    snap_key, man_key = save_keys(realm.id, save["id"])
    snap, manifest = s3.get(snap_key), json.loads(s3.get(man_key))
    assert manifest["sha256"] == hashlib.sha256(snap).hexdigest() and manifest["bytes"] == len(snap)
    assert manifest["server_id"] == realm.id
    data = json.loads(snap)
    assert {"x": 17, "y": 9, "material": "brick"} in data["blocks"]
    assert snap == json.dumps(data, separators=(",", ":")).encode()
    prefix = f"servers/{realm.id}/worlds/home/saves/"
    before = set(s3.keys(prefix))
    for env in ("APP_STORAGE_DOWN_URL", "APP_STORAGE_PARTIAL_URL"):
        api = sign_in(outage(env), p.handle, p.passcode)
        err(api.post(f"/api/servers/{realm.slug}/worlds/home/saves", {}), 503, "storage_unavailable")
        assert set(s3.keys(prefix)) == before, env
    saves = must(p.api.get(f"/api/servers/{realm.slug}/worlds/home/saves"), 200)["saves"]
    assert [s["number"] for s in saves] == [1]


def test_wf_owner_saves_export_outage(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    make_char(p.api, realm.slug)
    down = outage("APP_STORAGE_DOWN_URL")
    copy = "Save not written. Storage is unreachable, so nothing was saved and your world is unchanged. Try again in a minute."
    with signed_in(browser, down, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        click(pg.get_by_role("button", name="Save world"))
        say(pg, "World announcements", copy)
        advance(pg, 3000)
        say(pg, "World announcements", copy)
    assert must(p.api.get(f"/api/servers/{realm.slug}/worlds/home/saves"), 200)["saves"] == []
    assert S3().keys(f"servers/{realm.id}/worlds/home/saves/") == []


def test_restore_world_from_save(app_url, mail):
    realm = Realm(app_url, mail)
    ch = make_char(realm.owner, realm.slug)
    blocks = f"/api/servers/{realm.slug}/worlds/home/blocks"
    must(realm.owner.post(blocks, {"character_id": ch["id"], "x": 17, "y": 8, "material": "stone"}), 201)
    first = must(realm.owner.post(f"/api/servers/{realm.slug}/worlds/home/saves", {}), 201)["save"]
    must(realm.owner.post(blocks + "/break", {"character_id": ch["id"], "x": 17, "y": 8}), 200)
    must(realm.owner.post(blocks, {"character_id": ch["id"], "x": 15, "y": 9, "material": "glass"}), 201)
    p = realm.player()
    err(p.api.post(f"/api/servers/{realm.slug}/worlds/home/restore", {"save_id": first["id"]}), 403, "forbidden")
    down = sign_in(outage("APP_STORAGE_DOWN_URL"), "eli", SEED_PASS["eli"])
    err(down.post(f"/api/servers/{realm.slug}/worlds/home/restore", {"save_id": first["id"]}), 503, "storage_unavailable")
    assert {"x": 15, "y": 9, "material": "glass"} in world(realm.owner, realm.slug)["blocks"]
    b = must(realm.owner.post(f"/api/servers/{realm.slug}/worlds/home/restore", {"save_id": first["id"]}), 200)
    saves = must(realm.owner.get(f"/api/servers/{realm.slug}/worlds/home/saves"), 200)["saves"]
    assert [(s["number"], s["restored_from"]) for s in saves][:2] == [(2, 1), (1, None)]
    s3 = S3()
    assert s3.get(save_keys(realm.id, b["save"]["id"])[0]) == s3.get(save_keys(realm.id, first["id"])[0])
    blocks_now = sorted((k["y"], k["x"], k["material"]) for k in world(realm.owner, realm.slug)["blocks"])
    assert blocks_now == [(8, 17, "stone")]


def tar_entries(raw):
    with tarfile.open(fileobj=io.BytesIO(raw), format=tarfile.USTAR_FORMAT) as tf:
        return [(m, tf.extractfile(m).read()) for m in tf.getmembers()]


def test_export_reproducible(app_url, mail):
    realm, other = Realm(app_url, mail), Realm(app_url, mail)
    for r, mat in ((realm, "wood"), (other, "brick")):
        ch = make_char(r.owner, r.slug)
        must(r.owner.post(f"/api/servers/{r.slug}/worlds/home/blocks", {"character_id": ch["id"], "x": 17, "y": 8, "material": mat}), 201)
    save = must(realm.owner.post(f"/api/servers/{realm.slug}/worlds/home/saves", {}), 201)["save"]
    must(other.owner.post(f"/api/servers/{other.slug}/worlds/home/saves", {}), 201)
    raws = []
    for _ in range(2):
        e = must(realm.owner.post(f"/api/servers/{realm.slug}/exports", {}), 201)["export"]
        r = realm.owner.get(f"/api/servers/{realm.slug}/exports/{e['id']}")
        must(r, 200)
        assert r.headers["content-type"].startswith("application/x-tar")
        assert f'filename="{realm.slug}-worlds.tar"' in r.headers["content-disposition"]
        assert S3().get(f"servers/{realm.id}/exports/{e['id']}.tar") == r.content
        raws.append(r.content)
    assert raws[0] == raws[1]
    raw = raws[0]
    entries = tar_entries(raw)
    assert [m.name for m, _ in entries] == ["export.json", "home/snapshot.json"]
    meta = json.loads(entries[0][1])
    assert meta["server"]["id"] == realm.id and [w["slug"] for w in meta["worlds"]] == ["home"]
    snap = S3().get(save_keys(realm.id, save["id"])[0])
    assert entries[1][1] == snap and b"brick" not in snap
    created = int(datetime.strptime(save["created_at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp())
    mode, block = int("0644", 8), tarfile.BLOCKSIZE
    for m, data in entries:
        assert m.mode == mode and m.uid == 0 and m.gid == 0 and m.uname == "" and m.gname == "" and m.mtime == created
    size = sum(block + block * math.ceil(len(d) / block) for _, d in entries) + 2 * block
    assert len(raw) == size and raw[-2 * block:] == bytes(2 * block)
    pending = Realm(app_url, mail, active=False)
    must(pending.owner.post(f"/api/servers/{pending.slug}/exports", {}), 201)


def test_wf_owner_saves_export_partial(browser, app_url, mail):
    realm = Realm(app_url, mail)
    partial = outage("APP_STORAGE_PARTIAL_URL")
    api = sign_in(partial, "eli", SEED_PASS["eli"])
    err(api.post(f"/api/servers/{realm.slug}/exports", {}), 503, "storage_unavailable")
    prefix = f"servers/{realm.id}/exports/"
    assert S3().keys(prefix) == []
    with signed_in(browser, partial, f"/s/{realm.slug}/admin", "eli", SEED_PASS["eli"]) as pg:
        click(pg.get_by_role("button", name="Export worlds"))
        say(pg, "Admin status", "Export not written. Storage is unreachable. Try again in a minute.")
        expect(pg.get_by_role("link", name="Download export")).to_have_count(0)
    assert S3().keys(prefix) == []


def test_wf_player_build_keyboard(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    name = ch["name"]
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        grid = pg.get_by_role("grid", name="World map")
        cells = grid.get_by_role("gridcell")
        ui(pg, lambda: expect(cells).to_have_count(MAP_W * MAP_H, timeout=STEP_MS))
        assert cells.evaluate_all(TABBABLE_JS) == 1
        cur = map_cursor(pg)
        sx, sy = SPAWN
        expect(cur).to_have_accessible_name(f"{sx}, {sy}, {'Grass'}, {name}")
        cur.focus()
        for key, (kx, ky) in [("ArrowRight", (sx + 1, sy)), ("Home", (0, sy)), ("End", (MAP_W - 1, sy)),
                              ("Control+Home", (0, 0)), ("Control+End", (MAP_W - 1, MAP_H - 1)),
                              ("PageUp", (MAP_W - 1, MAP_H - 1 - 8))]:
            pg.keyboard.press(key)
            focused(pg, pg.get_by_role("gridcell", name=re.compile(f"^{kx}, {ky}, ")))
        assert cells.evaluate_all(TABBABLE_JS) == 1
        bx, by = sx + 1, sy
        click(cell(pg, bx, by, "Grass"))
        shows(pg, pg.get_by_role("region", name="Tile inspector"), "Grass")
        click(pg.get_by_role("region", name="Tile inspector").get_by_role("radio", name="Stone"))
        cell(pg, bx, by, "Grass").focus()
        pg.keyboard.press("b")
        say(pg, "World announcements", placed("stone", bx, by))
        ui(pg, lambda: expect(cell(pg, bx, by, f"Grass, {'stone'} block")).to_be_visible(timeout=STEP_MS))
        assert {"x": bx, "y": by, "material": "stone"} in world(p.api, realm.slug)["blocks"]
        assert count_of(inv(p.api, ch["id"]), "stone") == STARTER_STACK - 1
        pg.keyboard.press("x")
        say(pg, "World announcements", broke("stone", bx, by))
        assert count_of(inv(p.api, ch["id"]), "stone") == STARTER_STACK
        pg.keyboard.press("Shift+ArrowUp")
        say(pg, "World announcements", moved(sx, sy - 1))
        pg.keyboard.press("Shift+ArrowUp")
        say(pg, "World announcements", "You can't walk there.")
        cell(pg, 16, 10, "Road").focus()
        pg.keyboard.press("b")
        say(pg, "World announcements", "Too far away. Stand next to that tile first.")
    c = must(p.api.get(f"/api/characters/{ch['id']}"), 200)
    assert (c["x"], c["y"]) == (16, 7)


def test_walk_rules(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    walk = lambda d: p.api.post(f"/api/characters/{ch['id']}/walk", {"direction": d})
    b = must(walk("north"), 200)
    assert (b["character"]["x"], b["character"]["y"]) == (16, 7) and b["announcement"] == moved(16, 7)
    err(walk("north"), 422, "blocked", "You can't walk there.")
    must(p.api.post(f"/api/servers/{realm.slug}/worlds/home/blocks",
                    {"character_id": ch["id"], "x": 17, "y": 7, "material": "wood"}), 201)
    err(walk("east"), 422, "blocked")
    c = must(p.api.get(f"/api/characters/{ch['id']}"), 200)
    assert (c["x"], c["y"]) == (16, 7)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        click(cell(pg, 15, 7, "Grass"))
        click(pg.get_by_role("region", name="Tile inspector").get_by_role("button", name="Walk here"))
        say(pg, "World announcements", moved(15, 7))
    c = must(p.api.get(f"/api/characters/{ch['id']}"), 200)
    assert (c["x"], c["y"]) == (15, 7)


def test_block_rules(app_url, mail):
    realm = Realm(app_url, mail)
    p, q = realm.player(), realm.player()
    ch = make_char(p.api, realm.slug)
    make_char(q.api, realm.slug)
    walk = lambda d: p.api.post(f"/api/characters/{ch['id']}/walk", {"direction": d})
    must(walk("north"), 200)
    blocks = f"/api/servers/{realm.slug}/worlds/home/blocks"
    place = lambda x, y, m: p.api.post(blocks, {"character_id": ch["id"], "x": x, "y": y, "material": m})
    assert must(place(17, 8, "wood"), 201)["announcement"] == placed("wood", 17, 8)
    assert count_of(inv(p.api, ch["id"]), "wood") == STARTER_STACK - 1
    must(walk("east"), 200)
    err(place(17, 8, "stone"), 409, "tile_taken", "That tile is taken.")
    err(place(16, 8, "stone"), 409, "tile_taken")
    err(place(16, 6, "stone"), 422, "not_buildable", "You can only build on grass or sand.")
    err(place(20, 7, "stone"), 422, "too_far", "Too far away. Stand next to that tile first.")
    for x, y in [(18, 6), (18, 7), (18, 8)]:
        must(place(x, y, "glass"), 201)
    must(walk("west"), 200)
    must(place(15, 6, "glass"), 201)
    err(place(15, 7, "glass"), 422, "no_block_in_inventory", "You have no glass block in your inventory.")
    br = lambda x, y: p.api.post(blocks + "/break", {"character_id": ch["id"], "x": x, "y": y})
    err(br(15, 8), 422, "no_block", "There is no block there.")
    err(br(18, 8), 422, "too_far")
    assert must(br(17, 8), 200)["announcement"] == broke("wood", 17, 8)
    assert count_of(inv(p.api, ch["id"]), "wood") == STARTER_STACK
    assert count_of(inv(p.api, ch["id"]), "glass") == 0


def test_wf_player_build_announcements(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        insp = pg.get_by_role("region", name="Tile inspector")
        click(cell(pg, 17, 8, "Grass"))
        click(insp.get_by_role("radio", name="Brick"))
        click(insp.get_by_role("button", name="Place block"))
        say(pg, "World announcements", placed("brick", 17, 8))
        click(cell(pg, 17, 8, "Grass"))
        click(insp.get_by_role("button", name="Break block"))
        say(pg, "World announcements", broke("brick", 17, 8))
        click(cell(pg, 16, 7, "Grass"))
        click(insp.get_by_role("button", name="Walk here"))
        say(pg, "World announcements", moved(16, 7))
        cell(pg, 16, 6, "Lantern Four Table").focus()
        pg.keyboard.press("b")
        say(pg, "World announcements", "You can only build on grass or sand.")
        cell(pg, 15, 8, "Grass").focus()
        pg.keyboard.press("x")
        say(pg, "World announcements", "There is no block there.")
        click(insp.get_by_role("radio", name="Glass"))
        for x, y in ((15, 6), (17, 6), (15, 7), (17, 7)):
            cell(pg, x, y, "Grass").focus()
            pg.keyboard.press("b")
            say(pg, "World announcements", placed("glass", x, y))
        cell(pg, 15, 8, "Grass").focus()
        pg.keyboard.press("b")
        say(pg, "World announcements", "You have no glass block in your inventory.")
    glass = {(b["x"], b["y"]) for b in world(p.api, realm.slug)["blocks"] if b["material"] == "glass"}
    assert glass == {(15, 6), (17, 6), (15, 7), (17, 7)}
    assert count_of(inv(p.api, ch["id"]), "glass") == 0


def test_wf_player_build_chat(browser, app_url, mail):
    realm, other = Realm(app_url, mail), Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    o = other.player()
    oc = make_char(o.api, other.slug)
    secret = f"elsewhere {tag()}"
    must(o.api.post(f"/api/servers/{other.slug}/worlds/home/chat", {"character_id": oc["id"], "text": secret}), 201)
    first, second = f"first {tag()}", f"second {tag()}"
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        chat = pg.get_by_role("region", name="Chat")
        for t in (first, second):
            fill(chat.get_by_role("textbox", name="Message"), f"   {t}   ")
            click(chat.get_by_role("button", name="Send"))
            shows(pg, chat.get_by_role("log", name="Chat messages"), f"{ch['name']}: {t}")
        expect(chat.get_by_role("log", name="Chat messages")).not_to_contain_text(secret)
    msgs = must(p.api.get(f"/api/servers/{realm.slug}/worlds/home/chat"), 200)["messages"]
    assert [m["text"] for m in msgs] == [first, second]
    assert secret not in json.dumps(msgs)
    assert first not in json.dumps(must(o.api.get(f"/api/servers/{other.slug}/worlds/home/chat"), 200))


def test_world_breakpoints(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    make_char(p.api, realm.slug)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode, size=(375, 812)) as pg:
        rail = pg.get_by_role("complementary", name="World rail")
        grid = pg.get_by_role("grid", name="World map")
        for w, h in ((375, 812), (767, 1024), (768, 1024), (1279, 800), (1280, 800)):
            pg.set_viewport_size({"width": w, "height": h})
            advance(pg, 500)
            layout(pg)
            if w < 768:
                ui(pg, lambda: expect(pg.get_by_role("button", name="Open drawer")).to_be_visible(timeout=STEP_MS))
                expect(rail).not_to_be_visible()
                click(pg.get_by_role("button", name="Open drawer"))
                drawer = pg.get_by_role("region", name="Drawer")
                ui(pg, lambda: expect(drawer.get_by_role("region", name="Tile inspector")).to_be_visible(timeout=STEP_MS))
                for n in ("Party", "Chat"):
                    expect(drawer.get_by_role("region", name=n)).to_be_visible()
                assert drawer.bounding_box()["height"] <= DRAWER_MAX_SHARE * h + 1
                click(pg.get_by_role("button", name="Close drawer"))
            elif w < 1280:
                ui(pg, lambda: expect(rail).to_be_visible(timeout=STEP_MS))
                rb = rail.bounding_box()
                assert RAIL_ABOUT_300[0] <= rb["width"] <= RAIL_ABOUT_300[1], rb
                expect(pg.get_by_role("button", name="Show chat")).to_be_visible()
                before = grid.evaluate(MAP_RECT_JS)
                assert before["x"] + before["width"] <= rb["x"] + 1
                click(pg.get_by_role("button", name="Collapse rail"))
                ui(pg, lambda: expect(pg.get_by_role("button", name="Expand rail")).to_be_visible(timeout=STEP_MS))
                assert grid.evaluate(MAP_RECT_JS)["width"] > before["width"]
                click(pg.get_by_role("button", name="Expand rail"))
            else:
                ui(pg, lambda: expect(rail).to_be_visible(timeout=STEP_MS))
                rb, mb = rail.bounding_box(), grid.evaluate(MAP_RECT_JS)
                assert RAIL_ABOUT_320[0] <= rb["width"] <= RAIL_ABOUT_320[1], rb
                assert mb["width"] >= MAP_MIN_SHARE * w and mb["x"] + mb["width"] <= rb["x"] + 1
                expect(rail.get_by_role("region", name="Chat")).to_be_visible()
                expect(pg.get_by_role("button", name="Collapse rail")).to_have_count(0)


def test_world_full_screen(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    make_char(p.api, realm.slug)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        rail = pg.get_by_role("complementary", name="World rail")
        ui(pg, lambda: expect(rail).to_be_visible(timeout=STEP_MS))
        map_cursor(pg).focus()
        pg.keyboard.press("f")
        ui(pg, lambda: assert_eq(pg.evaluate("() => document.fullscreenElement && document.fullscreenElement.id"), "world-root"))
        exit_btn = pg.get_by_role("button", name="Exit full screen")
        ui(pg, lambda: expect(exit_btn).to_have_attribute("aria-pressed", "true", timeout=STEP_MS))
        ui(pg, lambda: expect(rail).not_to_be_visible(timeout=STEP_MS))
        pg.keyboard.press("r")
        ui(pg, lambda: expect(rail).to_be_visible(timeout=STEP_MS))
        pg.keyboard.press("r")
        ui(pg, lambda: expect(rail).not_to_be_visible(timeout=STEP_MS))
        chat = pg.get_by_role("region", name="Chat")
        pg.keyboard.press("c")
        ui(pg, lambda: expect(chat).to_be_visible(timeout=STEP_MS))
        pg.keyboard.press("c")
        ui(pg, lambda: expect(chat).not_to_be_visible(timeout=STEP_MS))
        pg.keyboard.press("f")
        ui(pg, lambda: assert_eq(pg.evaluate("() => document.fullscreenElement === null"), True))
        btn = pg.get_by_role("button", name="Full screen")
        focused(pg, btn)
        expect(btn).to_have_attribute("aria-pressed", "false")
        ui(pg, lambda: expect(rail).to_be_visible(timeout=STEP_MS))


def test_block_place_and_break_motion(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    make_char(p.api, realm.slug)
    for reduced in (False, True):
        with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode,
                       reduced=reduced, init=ANIM_JS) as pg:
            ui(pg, lambda: expect(cell(pg, 17, 8, "Grass")).to_be_visible(timeout=STEP_MS))
            cell(pg, 17, 8, "Grass").focus()
            pg.keyboard.press("b")
            say(pg, "World announcements", placed("wood", 17, 8))
            pg.keyboard.press("x")
            say(pg, "World announcements", broke("wood", 17, 8))
            advance(pg, 1000)
            places, shards = recorded(pg, "block-place"), recorded(pg, "block-shard")
            added = pg.evaluate("() => window.__added['block-shard'] || 0")
            if reduced:
                assert places == [] and shards == [] and added == 0
            else:
                assert places and all(PLACE_BAND[0] <= a["duration"] <= PLACE_BAND[1] for a in places), places
                assert SHARDS[0] <= added <= SHARDS[1], added
                assert all(a["duration"] + a["delay"] <= SHARD_MAX_MS for a in shards), shards
            ui(pg, lambda: assert_eq(anim_els(pg, "block-shard"), []))


def clear_skies(api, slug):
    def calm():
        r = api.get(f"/api/servers/{slug}/weather")
        w = must(r, 200)
        since, until = iso(w["since"]), iso(w["changes_at"])
        idx = (int(since // (until - since)) + LARK_SEED) % 4
        now = datetime.strptime(r.headers["Date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc).timestamp()
        return idx == 0 or (idx == 1 and until - now >= CALM_MIN_S)
    poll(calm, WEATHER_WAIT, "storm-free window")


def vehicle(api, slug, w, name):
    return next(v for v in world(api, slug, w)["vehicles"] if v["name"] == name)


def free_runway(api, slug, w, current):
    taken = {(v["x"], v["y"]) for v in world(api, slug, w)["vehicles"]}
    return next((x, 2) for x in range(30, 38) if (x, 2) not in taken and (x, 2) != current)


def road_path_len(tiles, start, end):
    seen, frontier, d = {start}, [start], 0
    while frontier:
        if end in frontier:
            return d
        nxt = []
        for x, y in frontier:
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < 40 and 0 <= ny < 24 and tiles[ny][nx] == "=" and (nx, ny) not in seen:
                    seen.add((nx, ny))
                    nxt.append((nx, ny))
        frontier, d = nxt, d + 1
    return None


def apply_steps(start, steps):
    x, y = start
    path = []
    for s in steps:
        x, y = {"N": (x, y - 1), "S": (x, y + 1), "E": (x + 1, y), "W": (x - 1, y)}[s]
        path.append((x, y))
    return path


def test_parking_cars_and_planes(app_url):
    kofi = sign_in(app_url, "kofi", SEED_PASS["kofi"])
    ines = sign_in(app_url, "ines", SEED_PASS["ines"])
    slug, w = "larkspur-commons", "meadow"
    car = vehicle(kofi, slug, w, "Blue Hatchback")
    start = (car["x"], car["y"])
    target = (8, 10) if start != (8, 10) else (25, 10)
    err(ines.post(f"/api/vehicles/{car['id']}/park", {"x": target[0], "y": target[1]}), 403, "not_your_character")
    err(kofi.post(f"/api/vehicles/{car['id']}/park", {"x": 5, "y": 9}), 422, "wrong_surface", "Cars park only on road tiles.")
    err(kofi.post(f"/api/vehicles/{car['id']}/park", {"x": start[0], "y": start[1]}), 422, "same_tile")
    b = must(kofi.post(f"/api/vehicles/{car['id']}/park", {"x": target[0], "y": target[1]}), 201)
    tiles = world(kofi, slug, w)["tiles"]
    path = apply_steps(start, b["trip"]["steps"])
    assert path[-1] == target and all(tiles[y][x] == "=" for x, y in path)
    assert len(path) == road_path_len(tiles, start, target)
    assert b["announcement"] == f"Blue Hatchback parked on road at {target[0]}, {target[1]}"
    assert (vehicle(kofi, slug, w, "Blue Hatchback")["x"], vehicle(kofi, slug, w, "Blue Hatchback")["y"]) == target
    juno = sign_in(outage("APP_SHORT_URL"), "juno", SEED_PASS["juno"])
    moth = vehicle(juno, LARK, MEADOW, "Moth")
    kite = vehicle(juno, LARK, MEADOW, "Paper Kite")
    clear_skies(juno, LARK)
    err(juno.post(f"/api/vehicles/{moth['id']}/park", {"x": moth["x"], "y": 3}), 422, "wrong_surface",
        "Planes park only on runway tiles.")
    err(juno.post(f"/api/vehicles/{moth['id']}/park", {"x": kite["x"], "y": kite["y"]}), 409, "tile_taken")


def test_wf_player_vehicles_keyboard(browser, app_url):
    short = outage("APP_SHORT_URL")
    ines = sign_in(short, "ines", SEED_PASS["ines"])
    slug, w = LARK, MEADOW
    kite = vehicle(ines, slug, w, "Paper Kite")
    target = free_runway(ines, slug, w, (kite["x"], kite["y"]))
    me = next(c for c in world(ines, slug, w)["characters"] if c["name"] == "Inkfinch")
    with signed_in(browser, short, f"/s/{slug}/w/{w}", "ines", SEED_PASS["ines"]) as pg:
        use_char(pg, "Inkfinch")
        sent = []
        pg.on("request", lambda r: sent.append(r.post_data_json) if r.method == "POST" and "/park" in r.url else None)
        ui(pg, lambda: expect(map_cursor(pg)).to_have_accessible_name(re.compile(rf"^{me['x']}, {me['y']}, "), timeout=STEP_MS))
        map_cursor(pg).focus()
        dx, dy = kite["x"] - me["x"], kite["y"] - me["y"]
        for _ in range(abs(dx)):
            pg.keyboard.press("ArrowRight" if dx > 0 else "ArrowLeft")
        for _ in range(abs(dy)):
            pg.keyboard.press("ArrowDown" if dy > 0 else "ArrowUp")
        focused(pg, cell(pg, kite["x"], kite["y"], "Runway"))
        pg.keyboard.press("Enter")
        menu = pg.get_by_role("menu", name="Paper Kite")
        focused(pg, menu.get_by_role("menuitem", name="Move"))
        listen(pg)
        pg.keyboard.press("Enter")
        heard(pg, "Parking Paper Kite. Choose a runway tile.")
        listen(pg)
        pg.keyboard.press("ArrowDown")
        heard(pg, "Not a runway")
        listen(pg)
        pg.keyboard.press("Escape")
        heard(pg, "Parking cancelled")
        focused(pg, cell(pg, kite["x"], kite["y"], "Runway"))
        assert sent == []
        clear_skies(ines, slug)
        pg.keyboard.press("Enter")
        focused(pg, menu.get_by_role("menuitem", name="Move"))
        listen(pg)
        pg.keyboard.press("Enter")
        heard(pg, "Parking Paper Kite. Choose a runway tile.")
        step = target[0] - kite["x"]
        for _ in range(abs(step)):
            pg.keyboard.press("ArrowRight" if step > 0 else "ArrowLeft")
        listen(pg)
        pg.keyboard.press("Enter")
        heard(pg, parked(kite["name"], "runway", target[0], target[1]))
    assert sent == [{"x": target[0], "y": target[1]}]
    v = vehicle(ines, slug, w, "Paper Kite")
    assert (v["x"], v["y"]) == target


def test_wf_player_vehicles_phone(browser, app_url):
    short = outage("APP_SHORT_URL")
    juno = sign_in(short, "juno", SEED_PASS["juno"])
    slug, w = LARK, MEADOW
    moth = vehicle(juno, slug, w, "Moth")
    target = free_runway(juno, slug, w, (moth["x"], moth["y"]))
    with signed_in(browser, short, f"/s/{slug}/w/{w}", "juno", SEED_PASS["juno"], size=(375, 812)) as pg:
        tap(cell(pg, moth["x"], moth["y"], "Runway"))
        expect(pg.get_by_role("region", name="Drawer")).not_to_be_visible()
        tap(pg.get_by_role("button", name="Open drawer"))
        clear_skies(juno, slug)
        listen(pg)
        tap(pg.get_by_role("region", name="Tile inspector").get_by_role("button", name=f"Move {moth['name']}"))
        heard(pg, f"Parking {moth['name']}. Choose a runway tile.")
        ui(pg, lambda: expect(pg.get_by_role("button", name="Open drawer")).to_be_visible(timeout=STEP_MS))
        listen(pg)
        tap(cell(pg, target[0], target[1], "Runway"))
        heard(pg, parked(moth["name"], "runway", target[0], target[1]))
        layout(pg)
    v = vehicle(juno, slug, w, "Moth")
    assert (v["x"], v["y"]) == target


def test_trip_replay_uses_stored_steps(app_url):
    priya = sign_in(app_url, "priya", SEED_PASS["priya"])
    slug, w = "fennel-reach", "saltmarsh"
    car = vehicle(priya, slug, w, "Rust Pickup")
    start = (car["x"], car["y"])
    target = (20, 15) if start != (20, 15) else (2, 10)
    trip = must(priya.post(f"/api/vehicles/{car['id']}/park", {"x": target[0], "y": target[1]}), 201)["trip"]
    tiles = world(priya, slug, w)["tiles"]
    path = apply_steps(start, trip["steps"])
    assert path[-1] == target and all(tiles[y][x] == "=" for x, y in path)
    rep = must(priya.get(f"/api/trips/{trip['id']}/replay"), 200)
    assert rep["match"] is True and rep["stored"] == rep["replayed"] == trip["to"]


def test_vehicle_drive_motion(browser, app_url):
    priya = sign_in(app_url, "priya", SEED_PASS["priya"])
    slug, w = "fennel-reach", "saltmarsh"
    for reduced in (False, True):
        car = vehicle(priya, slug, w, "Rust Pickup")
        target = (12, 10) if (car["x"], car["y"]) != (12, 10) else (30, 10)
        with signed_in(browser, app_url, f"/s/{slug}/w/{w}", "priya", SEED_PASS["priya"], reduced=reduced, init=ANIM_JS) as pg:
            use_char(pg, "Pennyroyal")
            click(cell(pg, car["x"], car["y"], "Road"))
            click(pg.get_by_role("region", name="Tile inspector").get_by_role("button", name=f"Move {car['name']}"))
            say(pg, "World announcements", f"Parking {car['name']}. Choose a road tile.")
            click(cell(pg, target[0], target[1], "Road"))
            say(pg, "World announcements", parked(car["name"], "road", target[0], target[1]))
            advance(pg, 6000)
            drives = recorded(pg, "vehicle-drive")
            steps = abs(target[0] - car["x"]) + abs(target[1] - car["y"])
            if reduced:
                assert drives == []
            else:
                per = [a["duration"] for a in drives] if len(drives) > 1 else [drives[0]["duration"] / steps]
                assert len(drives) in (1, steps) and all(DRIVE_BAND[0] <= d <= DRIVE_BAND[1] for d in per), drives
            ui(pg, lambda: assert_eq([e["phase"] for e in anim_els(pg, "vehicle-drive")][:1], ["end"]))


def test_wf_party_chapters_succession(browser, app_url, mail):
    realm = Realm(app_url, mail)
    a, b, c = (realm.player() for _ in range(3))
    ca, cb, cc = (make_char(x.api, realm.slug) for x in (a, b, c))
    pname = f"Crew {tag()}"
    party = must(a.api.post(f"/api/servers/{realm.slug}/parties", {"character_id": ca["id"], "name": pname}), 201)["party"]
    pid = party["id"]
    must(b.api.post(f"/api/parties/{pid}/members", {"character_id": cb["id"]}), 200)
    must(c.api.post(f"/api/parties/{pid}/members", {"character_id": cc["id"]}), 200)
    err(a.api.post(f"/api/servers/{realm.slug}/parties", {"character_id": ca["id"], "name": f"P {tag()}"}), 409, "already_in_party")
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", c.handle, c.passcode) as pg:
        pg.clock.set_system_time(DEVICE_SKEW)
        members = pg.get_by_role("region", name="Party").get_by_role("list", name="Party members")
        leader_item = lambda n: members.get_by_role("listitem").filter(has_text=n)
        shows(pg, leader_item(ca["name"]), "Leader")
        left = must(a.api.delete(f"/api/parties/{pid}/members/{ca['id']}"), 200)["party"]
        assert left["leader_id"] == cb["id"]
        say(pg, "World announcements", f"{cb['name']} now leads the party.")
        shows(pg, leader_item(cb["name"]), "Leader")
    assert must(b.api.delete(f"/api/parties/{pid}/members/{cb['id']}"), 200)["party"]["leader_id"] == cc["id"]
    closed = must(c.api.delete(f"/api/parties/{pid}/members/{cc['id']}"), 200)["party"]
    assert closed["state"] == "closed"
    assert pid not in [x["id"] for x in must(a.api.get(f"/api/servers/{realm.slug}/parties"), 200)["parties"]]
    err(a.api.post(f"/api/parties/{pid}/members", {"character_id": ca["id"]}), 409, "party_closed")


def chapter_party(realm):
    a, b = realm.player(), realm.player()
    ca, cb = make_char(a.api, realm.slug), make_char(b.api, realm.slug)
    pid = must(a.api.post(f"/api/servers/{realm.slug}/parties", {"character_id": ca["id"], "name": f"P {tag()}"}), 201)["party"]["id"]
    must(b.api.post(f"/api/parties/{pid}/members", {"character_id": cb["id"]}), 200)
    return a, b, ca, cb, pid


def test_chapter_checkpoints(app_url, mail):
    realm = Realm(app_url, mail)
    a, b, ca, cb, pid = chapter_party(realm)
    err(b.api.post(f"/api/parties/{pid}/chapter-runs", {"chapter_id": "surveyors-pegs"}), 403, "not_leader")
    run = must(a.api.post(f"/api/parties/{pid}/chapter-runs", {"chapter_id": "surveyors-pegs"}), 201)["run"]
    err(a.api.post(f"/api/parties/{pid}/chapter-runs", {"chapter_id": "surveyors-pegs"}), 409, "run_in_progress")
    out = walk_to(b.api, cb, OLD_WELL)
    assert out["checkpoint"]["n"] == 1 and out["checkpoint"]["name"] == OLD_WELL_NAME and out["checkpoint"]["stored"] is True
    assert out["announcement"] == f"Checkpoint reached: {OLD_WELL_NAME}"
    s3 = S3()
    base = f"servers/{realm.id}/chapter-runs/{run['id']}/checkpoints"
    snap, man = s3.get(f"{base}/1/snapshot.json"), json.loads(s3.get(f"{base}/1/manifest.json"))
    assert man["sha256"] == hashlib.sha256(snap).hexdigest()
    down = sign_in(outage("APP_STORAGE_DOWN_URL"), b.handle, b.passcode)
    out = walk_to(down, cb, MILL_GATE)
    assert out["checkpoint"]["stored"] is False
    assert out["announcement"] == f"Checkpoint reached: {MILL_GATE_NAME}. Not saved yet; it will be saved when storage is back."

    def stored():
        cps = must(a.api.get(f"/api/chapter-runs/{run['id']}"), 200)["run"]["checkpoints"]
        return next(c for c in cps if c["n"] == 2)["stored"]
    poll(stored, RETRY_WAIT, "checkpoint 2 stored")
    snap2, man2 = s3.get(f"{base}/2/snapshot.json"), json.loads(s3.get(f"{base}/2/manifest.json"))
    assert man2["sha256"] == hashlib.sha256(snap2).hexdigest()


def test_chapter_replay(app_url, mail):
    realm = Realm(app_url, mail)
    a, b, ca, cb, pid = chapter_party(realm)
    run = must(a.api.post(f"/api/parties/{pid}/chapter-runs", {"chapter_id": "surveyors-pegs"}), 201)["run"]
    walk_to(a.api, ca, (16, 10))
    walk_to(b.api, cb, OLD_WELL)
    rep = must(a.api.get(f"/api/chapter-runs/{run['id']}/replay"), 200)
    assert rep["match"] is True and rep["replayed"] == rep["stored"]
    assert rep["stored"]["checkpoints_reached"]


def test_wf_party_chapters_game_night(browser, app_url, mail):
    name = f"Night {tag()}"
    slug = name.lower().replace(" ", "-")
    with signed_in(browser, app_url, "/servers/new", "dara", SEED_PASS["dara"]) as owner:
        fill(owner.get_by_role("textbox", name="Server name"), name)
        click(owner.get_by_role("button", name="Next"))
        click(owner.get_by_role("radio", name="Borough, 12.00 USD a month"))
        click(owner.get_by_role("button", name="Next"))
        click(owner.get_by_role("button", name="Rent server"))
        at_url(owner, rf"/s/{slug}/billing$")
        click(owner.get_by_role("button", name="Approve payment"))
        shows(owner, owner.get_by_role("status", name="Billing status"), "PAID", seconds=ACTIVE_WAIT)
        click(owner.get_by_role("button", name="Friends"))
        dlg = owner.get_by_role("dialog", name="Friends")
        friends = []
        for _ in range(3):
            t = tag()
            friends.append({"email": f"pw{t}@example.com", "handle": f"f{t}", "pass": f"pass-{t}", "display": f"Friend {t}",
                            "chars": [f"A{t}", f"B{t}"]})
            fill(dlg.get_by_role("textbox", name="Friend's email"), friends[-1]["email"])
            click(dlg.get_by_role("button", name="Send invite"))
            say(owner, "Invite status", f"Invite sent to {friends[-1]['email']}", scope=dlg)
        pages, stack = [], []
        for f in friends:
            link = re.search(r"https?://\S+/join/\S+", mail_text(mail_to(mail, f["email"])[0])).group(0)
            cm = open_app(browser, link)
            pg = cm.__enter__()
            stack.append(cm)
            pg.set_viewport_size({"width": 1280, "height": 800})
            ui(pg, lambda: expect(pg.get_by_role("heading", name=f"Join {name}")).to_be_visible(timeout=STEP_MS))
            expect(pg.get_by_text(f"{'Dara Finch'} invited {f['email']}.")).to_be_visible()
            fill(pg.get_by_role("textbox", name="Handle"), f["handle"])
            fill(pg.get_by_role("textbox", name="Display name"), f["display"])
            fill(pg.get_by_label("Passcode", exact=True), f["pass"])
            click(pg.get_by_role("button", name="Join server"))
            at_url(pg, rf"/s/{slug}/roster$")
            for cname in f["chars"]:
                click(pg.get_by_role("button", name="New character"))
                nd = pg.get_by_role("dialog", name="New character")
                fill(nd.get_by_role("textbox", name="Name"), cname)
                click(nd.get_by_role("radio", name="Surveyor"))
                click(nd.get_by_role("button", name="Create"))
                say(pg, "Roster status", f"Character created: {cname}")
            f["api"] = sign_in(app_url, f["handle"], f["pass"])
            pg.goto(f"{app_url}/s/{slug}/w/home")
            use_char(pg, f["chars"][0])
            pages.append(pg)
        try:
            party = f"Crew {tag()}"
            lead = pages[0].get_by_role("region", name="Party")
            fill(lead.get_by_role("textbox", name="Party name"), party)
            click(lead.get_by_role("button", name="Start party"))
            for pg in pages[1:]:
                click(pg.get_by_role("region", name="Party").get_by_role("button", name=f"Join {party}"))
            for pg in pages:
                shows(pg, pg.get_by_role("list", name="Party members"), friends[2]["chars"][0])
            click(lead.get_by_role("button", name="Start chapter"))
            map_cursor(pages[0]).focus()
            for key, n in (("Shift+ArrowLeft", 8), ("Shift+ArrowDown", 4)):
                for _ in range(n):
                    pages[0].keyboard.press(key)
            for pg in pages:
                say(pg, "World announcements", f"Checkpoint reached: {OLD_WELL_NAME}")
            chars = {}
            for f in friends:
                mine = must(f["api"].get(f"/api/servers/{slug}/characters", params={"mine": "true"}), 200)["characters"]
                chars[f["handle"]] = next(c for c in mine if c["name"] == f["chars"][0])
            for f in friends:
                walk_to(f["api"], chars[f["handle"]], ADJACENT["Oak Chess Table"])
            for i, pg in enumerate(pages):
                pg.goto(f"{app_url}/s/{slug}/w/home")
                use_char(pg, friends[i]["chars"][0])
            take(pages[0], "Oak Chess Table")
            focused(pages[0], pages[0].get_by_role("gridcell", name=re.compile(r"^a8, ")))
            take(pages[1], "Oak Chess Table")
            focused(pages[1], pages[1].get_by_role("gridcell", name=re.compile(r"^h1, ")))
            take(pages[2], "Oak Chess Table", button="Watch")
            click(pages[0].get_by_role("button", name="Start game"))
            for i, mv in enumerate(DEMO):
                kb_move(pages[i % 2], mv, white=(i % 2 == 0))
            black = friends[1]["chars"][0]
            say(pages[2], "Game announcements", f"Checkmate. {black} wins.")
            for f, line in ((friends[0], f"Your coins: {signed(-DEFAULT_STAKE)}"),
                            (friends[1], f"Your coins: {signed(DEFAULT_STAKE)}")):
                body = mail_text(mail_to(mail, f["email"], f"Result: {'Oak Chess Table'}")[0])
                assert f"Checkmate. {black} wins." in body and line in body
            pages[2].goto(f"{app_url}/s/{slug}/games")
            click(pages[2].get_by_role("list", name="Games").get_by_role("link").first)
            ui(pages[2], lambda: expect(pages[2].get_by_text(f"Move {len(DEMO)} of {len(DEMO)}")).to_be_visible(timeout=STEP_MS))
        finally:
            for cm in stack:
                cm.__exit__(None, None, None)
        owner.goto(f"{app_url}/s/{slug}/admin")
        click(owner.get_by_role("button", name="Export worlds"))
        say(owner, "Admin status", "Export ready")
        expect(owner.get_by_role("link", name="Download export")).to_be_visible()
    sid = must(sign_in(app_url, "dara", SEED_PASS["dara"]).get(f"/api/servers/{slug}"), 200)["id"]
    assert any(k.endswith(".tar") for k in S3().keys(f"servers/{sid}/exports/"))


def test_table_settings_two_steps(browser, app_url, mail):
    realm = Realm(app_url, mail)
    with signed_in(browser, app_url, f"/s/{realm.slug}/admin", "eli", SEED_PASS["eli"]) as pg:
        click(pg.get_by_role("button", name=f"Settings for {'Lantern Four Table'}"))
        dlg = pg.get_by_role("dialog", name="Table settings")
        focused(pg, dlg.get_by_role("heading", name="Step 1 of 2: Stake"))
        fill(dlg.get_by_role("spinbutton", name="Stake"), "101")
        click(dlg.get_by_role("button", name="Next"))
        shows(pg, dlg, "Use a whole number of coins from 0 to 100.")
        fill(dlg.get_by_role("spinbutton", name="Stake"), "25")
        click(dlg.get_by_role("button", name="Next"))
        focused(pg, dlg.get_by_role("heading", name="Step 2 of 2: Turn clock"))
        click(dlg.get_by_role("button", name="Back"))
        expect(dlg.get_by_role("spinbutton", name="Stake")).to_have_value("25")
        click(dlg.get_by_role("button", name="Next"))
        fill(dlg.get_by_role("spinbutton", name="Turn clock seconds"), "4")
        click(dlg.get_by_role("button", name="Save settings"))
        shows(pg, dlg, "Use 5 to 120 seconds.")
        fill(dlg.get_by_role("spinbutton", name="Turn clock seconds"), "120")
        click(dlg.get_by_role("button", name="Save settings"))
        say(pg, "Admin status", f"Settings saved for {'Lantern Four Table'}")
    t = Table(realm, "Lantern Four Table", n=1)
    info = t.refresh()
    assert (info["stake"], info["turn_seconds"]) == (25, 120)
    err(realm.owner.patch(f"/api/tables/{t.tid}", {"stake": 5, "turn_seconds": 30}, STALE), 412, "precondition_failed")
    t.sit(0)
    err(realm.owner.patch(f"/api/tables/{t.tid}", {"stake": 5, "turn_seconds": 30},
                          realm.owner.get(f"/api/tables/{t.tid}").headers["ETag"]), 409, "table_in_use",
        "Settings can change only while no one is seated.")
    assert t.refresh()["stake"] == 25


def test_contested_last_seat(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Felt Card Table", n=7)
    for i in range(3):
        t.sit(i)
    claims = list(range(3, 7))
    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        rs = list(ex.map(lambda i: t.people[i].api.post(f"/api/tables/{t.tid}/seats", {"character_id": t.chars[i]["id"]}), claims))
    wins = [i for i, r in zip(claims, rs) if r.status_code == 201]
    assert len(wins) == 1, [r.status_code for r in rs]
    for r in rs:
        if r.status_code != 201:
            err(r, 409, "table_full")
    info = t.refresh()
    seated = [s["character"]["id"] for s in info["seats"] if s["character"]]
    assert info["state"] == "seated" and len(seated) == 4 == len(set(seated))
    assert t.chars[wins[0]]["id"] in seated


def test_wf_table_seating_full(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Felt Card Table", n=5)
    for i in range(4):
        t.sit(i)
    p = t.people[4]
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        take(pg, "Felt Card Table")
        copy = "This table is full. You can watch from the spectator ring."
        say(pg, "World announcements", copy)
        focused(pg, pg.get_by_role("region", name="Tile inspector").get_by_role("button", name="Watch"))
        advance(pg, 3000)
        say(pg, "World announcements", copy)
    assert t.chars[4]["id"] not in [s["character"]["id"] for s in t.refresh()["seats"] if s["character"]]


def test_wf_table_seating_route(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Oak Chess Table", n=3)
    route = re.escape(t.route) + "$"
    (a, b, c) = t.people
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", a.handle, a.passcode) as pg:
        with held(pg, SEATS_GLOB) as h:
            take(pg, "Oak Chess Table")
            btn = pg.get_by_role("button", name="Taking seat")
            ui(pg, lambda: expect(btn).to_be_disabled(timeout=STEP_MS))
            h.release()
        at_url(pg, route)
        ui(pg, lambda: expect(pg.get_by_role("dialog", name="Oak Chess Table")).to_be_visible(timeout=STEP_MS))
        focused(pg, pg.get_by_role("gridcell", name=re.compile(r"^a8, ")))
        pg.reload()
        focused(pg, pg.get_by_role("gridcell", name=re.compile(r"^a8, ")))
        click(pg.get_by_role("button", name="Close table"))
        at_url(pg, rf"/s/{realm.slug}/w/home$")
        focused(pg, cell(pg, 12, 6, "Oak Chess Table"))
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", b.handle, b.passcode) as pg:
        take(pg, "Oak Chess Table")
        at_url(pg, route)
        focused(pg, pg.get_by_role("gridcell", name=re.compile(r"^h1, ")))
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", c.handle, c.passcode) as pg:
        take(pg, "Oak Chess Table", button="Watch")
        at_url(pg, route)
        focused(pg, pg.get_by_role("gridcell", name=re.compile(r"^a8, ")))
    four = Table(realm, "Lantern Four Table", n=1)
    p = four.people[0]
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        take(pg, "Lantern Four Table")
        focused(pg, pg.get_by_role("button", name="Drop in column 1"))
    assert len([s for s in t.refresh()["seats"] if s["character"]]) == 2


def test_table_drawin_motion(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit(1)
    a = t.people[0]
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", a.handle, a.passcode, init=ANIM_JS) as pg:
        grid = pg.get_by_role("grid", name="World map")
        ui(pg, lambda: expect(grid).to_be_visible(timeout=STEP_MS))
        before = decode(capture(grid))
        take(pg, "Lantern Four Table")
        ui(pg, lambda: expect(pg.get_by_role("dialog", name="Lantern Four Table")).to_be_visible(timeout=STEP_MS))
        advance(pg, 1500)
        grow, tokens = recorded(pg, "table-drawin"), recorded(pg, "token-slide")
        assert grow and all(0 < g["duration"] < DRAWIN_GROW_MAX_MS for g in grow), grow
        assert tokens and all(TOKEN_SLIDE[0] <= x["duration"] <= TOKEN_SLIDE[1] for x in tokens), tokens
        changed(before, decode(capture(grid)))
        t.refresh()
        t.start()
        advance(pg, 500)
        fuse = recorded(pg, "turn-fuse")
        assert fuse and all((DEFAULT_TURN - 2) * 1000 <= f["duration"] <= DEFAULT_TURN * 1000 for f in fuse), fuse
        pg.evaluate("() => { window.__anims = []; }")
        click(pg.get_by_role("button", name="Close table"))
        advance(pg, 1500)
        assert all(g["duration"] < DRAWIN_MAX_MS for g in recorded(pg, "table-drawin"))
        assert recorded(pg, "table-drawin")
        focused(pg, cell(pg, 16, 6, "Lantern Four Table"))
        pg.goto(f"{app_url}{t.route}")
        ui(pg, lambda: expect(pg.get_by_role("dialog", name="Lantern Four Table")).to_be_visible(timeout=STEP_MS))
        advance(pg, 1000)
        assert recorded(pg, "table-drawin") == []


def test_reduced_motion_drawin(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    a = t.people[0]
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", a.handle, a.passcode, reduced=True, init=ANIM_JS) as pg:
        take(pg, "Lantern Four Table")
        ui(pg, lambda: expect(pg.get_by_role("dialog", name="Lantern Four Table")).to_be_visible(timeout=STEP_MS))
        t.sit(1)
        assert t.at_seat(1)[0] is a
        t.start()
        timer = pg.get_by_role("timer", name="Turn clock")
        ui(pg, lambda: expect(timer).to_have_text(re.compile(r"^Your turn: \d+ s$"), timeout=STEP_MS))
        n0 = int(re.search(r"\d+", timer.inner_text()).group(0))
        advance(pg, 1000)
        n1 = int(re.search(r"\d+", timer.inner_text()).group(0))
        assert n0 - 2 <= n1 <= n0 - 1, (n0, n1)
        names = {"table-drawin", "token-slide", "turn-fuse"}
        assert [x for x in pg.evaluate("() => window.__anims") if x["name"] in names] == []
        assert all(e["phase"] == "end" for e in anim_els(pg, "table-drawin"))
        assert not any(e["visible"] for e in anim_els(pg, "turn-fuse"))


def test_table_full_screen(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit_all()
    t.start()
    a = t.at_seat(1)[0]
    with signed_in(browser, app_url, t.route, a.handle, a.passcode) as pg:
        dlg = pg.get_by_role("dialog", name="Lantern Four Table")
        focused(pg, pg.get_by_role("button", name="Drop in column 1"))
        pg.keyboard.press("f")
        ui(pg, lambda: assert_eq(dlg.evaluate("el => document.fullscreenElement === el"), True))
        timer = dlg.get_by_role("timer", name="Turn clock")
        first = timer.inner_text()
        advance(pg, 2000)
        assert timer.inner_text() != first
        pg.keyboard.press("t")
        say(pg, "Game announcements", re.compile(r"^Your turn: \d+ s$"), scope=dlg)
        click(dlg.get_by_role("button", name="Forfeit"))
        fd = pg.get_by_role("dialog", name="Forfeit this game?")
        focused(pg, fd.get_by_role("button", name="Keep playing"))
        click(fd.get_by_role("button", name="Keep playing"))
        focused(pg, dlg.get_by_role("button", name="Forfeit"))
        pg.keyboard.press("f")
        ui(pg, lambda: assert_eq(pg.evaluate("() => document.fullscreenElement === null"), True))
        focused(pg, dlg.get_by_role("button", name="Full screen"))
    assert t.refresh()["state"] == "in_play"


PROMO_LINE = ["e2e4", "d7d5", "e4d5", "c7c6", "d5c6", "g8f6", "c6b7", "b8d7"]


def test_chess_rules_on_server(app_url, mail):
    realm = Realm(app_url, mail)
    oak = Table(realm, "Oak Chess Table")
    oak.sit_all()
    start = oak.start()["position"]["fen"]
    oak.play(PROMO_LINE)
    err(oak.move("b7a8"), 422, "illegal_move", "Illegal: choose a promotion piece")
    oak.play(["b7a8q", "e7e6"])
    err(oak.move("e1g1"), 422, "illegal_move")
    err(oak.move("e7e5", seat=2), 422, "illegal_move", "Illegal: it is not your turn")
    oak.play(["g1f3", "f8e7", "f1e2", "e8g8", "e1g1"])
    fen = oak.table["position"]["fen"]
    got = [piece_at(fen, s) for s in ("a8", "g1", "f1", "g8", "f8", "e1", "h1", "e8", "h8")]
    want = [piece_at(start, s) for s in ("d1", "e1", "h1", "e8", "h8")] + [" "] * 4
    assert got == want, (got, want)
    birch = Table(realm, "Birch Chess Table")
    birch.sit_all()
    birch_start = birch.start()["position"]["fen"]
    birch.play(["e2e4", "a7a6", "e4e5", "f7f5", "a2a3", "d7d5"])
    err(birch.move("e5f6"), 422, "illegal_move")
    birch.play(["e5d6"])
    fen = birch.table["position"]["fen"]
    got = [piece_at(fen, s) for s in ("d5", "e5", "d6")]
    want = [" ", " ", piece_at(birch_start, "e2")]
    assert got == want, (got, want)
    birch.forfeit(2)
    birch.settled()
    for i in (0, 1):
        p, c = birch.people[i], birch.chars[i]
        must(p.api.post(f"/api/tables/{birch.tid}/rematch", {"character_id": c["id"]}), 200)
    birch.refresh()
    assert birch.table["state"] == "in_play"
    birch.play(["e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "h2h4", "a6h6", "a5c7", "f7f6",
                "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6"])
    assert birch.table["result"]["reason"] == "stalemate" and birch.table["result"]["outcome"] == "draw"
    oak.forfeit(2)
    oak.settled()
    for i in (0, 1):
        must(oak.people[i].api.post(f"/api/tables/{oak.tid}/rematch", {"character_id": oak.chars[i]["id"]}), 200)
    oak.refresh()
    oak.play(DEMO)
    res = oak.table["result"]
    assert res["reason"] == "checkmate" and res["winners"] == [2]


def test_chess_threefold_repetition(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Oak Chess Table")
    t.sit_all()
    t.start()
    shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"]
    t.play(shuffle + shuffle[:3])
    assert t.table["state"] == "in_play"
    t.play(shuffle[3:])
    res = t.table["result"]
    assert res["outcome"] == "draw" and res["reason"] == "threefold_repetition"
    assert res["text"] == f"{THREEFOLD} {DRAW}"


def test_wf_chess_play_announcements(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Oak Chess Table", n=3)
    t.sit(0)
    t.sit(1)
    t.start()
    w, b, c = t.people
    cc = t.chars[2]
    must(c.api.post(f"/api/tables/{t.tid}/spectators", {"character_id": cc["id"]}), 201)
    with signed_in(browser, app_url, t.route, w.handle, w.passcode) as wp, \
            signed_in(browser, app_url, t.route, c.handle, c.passcode) as sp:
        kb_move(wp, "a2a3", white=True)
        say(wp, "Game announcements", DEMO_COPY[0])
        t.refresh()
        assert must(t.move("e7e5"), 200)["announcement"] == DEMO_COPY[1]
        ui(wp, lambda: expect(wp.get_by_role("gridcell", name=sq_name("e5", "Black", "Pawn"))).to_be_visible(timeout=STEP_MS))
        kb_square(wp, "a3", True)
        kb_square(wp, "a5", True)
        say(wp, "Game announcements", "Illegal: that piece cannot move there")
        err(t.move("e3e4"), 422, "illegal_move", f"Illegal: there is no piece of yours on {'e3'}")
        got = t.play(DEMO[2:])
        assert got == DEMO_COPY[2:]
        say(sp, "Game announcements", f"Checkmate. {t.chars[1]['name']} wins.")
        say(wp, "Game announcements", f"Coins settled: {signed(-DEFAULT_STAKE)} for you")


def test_wf_chess_play_keyboard(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Oak Chess Table", secs=120)
    w, b = t.people
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", w.handle, w.passcode) as pg:
        click(cell(pg, 12, 6, "Oak Chess Table"))
        seat = pg.get_by_role("region", name="Tile inspector").get_by_role("button", name="Take seat")
        seat.focus()
        pg.keyboard.press("Enter")
        focused(pg, pg.get_by_role("gridcell", name=re.compile(r"^a8, ")))
        t.sit(1)
        start = t.start()["position"]["fen"]
        black = iter(PROMO_LINE[1::2] + ["e7e6", "f8e7", "e8g8", "a7a6"])
        for mv in PROMO_LINE[0::2]:
            kb_move(pg, mv, True)
            poll(lambda: t.refresh()["to_move_seat"] == 2, 10, "white moved")
            must(t.move(next(black)), 200)
        kb_square(pg, "b7", True)
        kb_square(pg, "a8", True)
        picker = pg.get_by_role("dialog", name="Choose promotion piece")
        focused(pg, picker.get_by_role("button", name="Queen"))
        pg.keyboard.press("Escape")
        focused(pg, pg.get_by_role("gridcell", name=re.compile(r"^b7, ")))
        kb_square(pg, "b7", True)
        kb_square(pg, "a8", True)
        focused(pg, picker.get_by_role("button", name="Queen"))
        advance(pg, 3000)
        expect(picker.get_by_role("button", name="Queen")).to_be_focused()
        pg.keyboard.press("Enter")
        say(pg, "Game announcements", f"Pawn takes {'a8'}, promotes to {'Queen'}")
        poll(lambda: t.refresh()["to_move_seat"] == 2, 10, "promotion accepted")
        for wmv in ("g1f3", "f1e2"):
            must(t.move(next(black)), 200)
            kb_move(pg, wmv, True)
            poll(lambda: t.refresh()["to_move_seat"] == 2, 10, "white moved")
        must(t.move(next(black)), 200)
        kb_move(pg, "e1g1", True)
        say(pg, "Game announcements", "Castles kingside")
        fen = t.refresh()["position"]["fen"]
        got = [piece_at(fen, s) for s in ("g1", "f1")]
        want = [piece_at(start, s) for s in ("e1", "h1")]
        assert got == want, (got, want)
        forfeit = pg.get_by_role("button", name="Forfeit")
        forfeit.focus()
        pg.keyboard.press("Enter")
        fd = pg.get_by_role("dialog", name="Forfeit this game?")
        focused(pg, fd.get_by_role("button", name="Keep playing"))
        must(t.move(next(black)), 200)
        ui(pg, lambda: expect(pg.get_by_role("gridcell", name=sq_name("a6", "Black", "Pawn"))).to_be_visible(timeout=STEP_MS))
        advance(pg, 2000)
        expect(fd.get_by_role("button", name="Keep playing")).to_be_focused()
        pg.keyboard.press("Escape")
        focused(pg, forfeit)
        pg.keyboard.press("Enter")
        fd.get_by_role("button", name="Forfeit game").focus()
        pg.keyboard.press("Enter")
        t.settled()
        offer = pg.get_by_role("button", name="Offer rematch")
        ui(pg, lambda: expect(offer).to_be_enabled(timeout=STEP_MS))
        offer.focus()
        pg.keyboard.press("Enter")
        say(pg, "Game announcements", f"{t.chars[0]['name']} offers a rematch")
        pg.keyboard.press("Escape")
        focused(pg, cell(pg, 12, 6, "Oak Chess Table"))
    assert t.chars[0]["id"] in [o if isinstance(o, str) else o.get("character_id") for o in t.refresh()["rematch_offers"]]


def test_dialogs_survive_turn_clock(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table", secs=120)
    t.sit_all()
    t.start()
    gold = t.at_seat(2)[0]
    with signed_in(browser, app_url, t.route, gold.handle, gold.passcode) as pg:
        panel = pg.get_by_role("dialog", name="Lantern Four Table")
        forfeit = panel.get_by_role("button", name="Forfeit")
        ui(pg, lambda: expect(forfeit).to_be_visible(timeout=STEP_MS))
        forfeit.focus()
        pg.keyboard.press("Enter")
        fd = pg.get_by_role("dialog", name="Forfeit this game?")
        keep = fd.get_by_role("button", name="Keep playing")
        focused(pg, keep)
        must(t.move("4"), 200)
        ui(pg, lambda: expect(pg.get_by_role("gridcell", name=disc_name("d1", "Ink"))).to_be_visible(timeout=STEP_MS))
        advance(pg, 3000)
        expect(fd).to_be_visible()
        expect(keep).to_be_focused()
        t.forfeit(1)
        ui(pg, lambda: expect(fd).to_have_count(0, timeout=STEP_MS))
    res = t.settled()["result"]
    assert res["reason"] == "forfeit" and res["winners"] == [2]


def test_rematch(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Oak Chess Table")
    t.sit_all()
    t.start()
    first_game = t.table["game_id"]
    rm = lambda i: t.people[i].api.post(f"/api/tables/{t.tid}/rematch", {"character_id": t.chars[i]["id"]})
    err(rm(0), 409, "not_settled")
    t.forfeit(2)
    t.settled()
    must(rm(0), 200)
    assert t.refresh()["state"] == "settled"
    err(t.people[0].api.post(f"/api/tables/{t.tid}/start", {"character_id": t.chars[0]["id"]}), 409, "rematch_required")
    must(rm(1), 200)
    info = t.refresh()
    assert info["state"] == "in_play" and info["game_id"] != first_game and info["turn"] == 0
    assert info["seats"][0]["character"]["id"] == t.chars[1]["id"] and info["to_move_seat"] == 1


def test_chess_piece_slide(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Oak Chess Table", secs=120)
    t.sit_all()
    t.start()
    w, b = t.people
    with signed_in(browser, app_url, t.route, w.handle, w.passcode, init=ANIM_JS) as wp, \
            signed_in(browser, app_url, t.route, b.handle, b.passcode, reduced=True, init=ANIM_JS) as bp:
        kb_move(wp, "e2e4", True)
        poll(lambda: t.refresh()["to_move_seat"] == 2, 10, "moved")
        must(t.move("d7d5"), 200)
        kb_move(wp, "e4d5", True)
        ui(bp, lambda: expect(bp.get_by_role("gridcell", name=sq_name("d5", "White", "Pawn"))).to_be_visible(timeout=STEP_MS))
        advance(wp, 1000)
        advance(bp, 1000)
        slides, caps = recorded(wp, "piece-slide"), recorded(wp, "piece-capture")
        assert slides and all(PIECE_BAND[0] <= a["duration"] <= PIECE_BAND[1] for a in slides), slides
        assert caps and all(PIECE_BAND[0] <= a["duration"] <= PIECE_BAND[1] for a in caps), caps
        assert recorded(bp, "piece-slide") == [] and recorded(bp, "piece-capture") == []


def test_table_lifecycle(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit(0)
    p0, c0 = t.people[0], t.chars[0]
    start = lambda: p0.api.post(f"/api/tables/{t.tid}/start", {"character_id": c0["id"]})
    err(start(), 409, "table_not_full")
    t.sit(1)
    assert t.table["state"] == "seated"
    err(p0.api.post(f"/api/tables/{t.tid}/moves", {"character_id": c0["id"], "turn": 0, "move": "1"}), 409, "game_not_in_play")
    t.start()
    assert t.table["state"] == "in_play"
    err(start(), 409, "game_in_play")
    err(p0.api.delete(f"/api/tables/{t.tid}/seats/{c0['id']}"), 409, "game_in_play",
        "You can't stand up during a game. Forfeit first.")
    err(p0.api.post(f"/api/tables/{t.tid}/rematch", {"character_id": c0["id"]}), 409, "not_settled")
    down = sign_in(outage("APP_STORAGE_DOWN_URL"), p0.handle, p0.passcode)
    fin = must(down.post(f"/api/tables/{t.tid}/forfeit", {"character_id": c0["id"]}), 200)
    if fin["state"] == "finished":
        r = down.delete(f"/api/tables/{t.tid}/seats/{c0['id']}")
        if r.status_code == 409:
            err(r, 409, "not_settled", "You can stand up once the coins have settled.")
    t.settled()
    err(start(), 409, "rematch_required")
    must(p0.api.delete(f"/api/tables/{t.tid}/seats/{c0['id']}"), 200)
    assert t.refresh()["state"] == "open"


def test_turn_clock_forfeit(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table", secs=MIN_TURN)
    t.sit_all()
    t.start()
    info = t.settled()
    res = info["result"]
    assert res["reason"] == "timeout" and res["winners"] == [2]
    assert res["settlement"] == [{"character_id": t.chars[0]["id"], "amount": -DEFAULT_STAKE},
                                 {"character_id": t.chars[1]["id"], "amount": DEFAULT_STAKE}]
    g = must(t.people[0].api.get(f"/api/games/{info['game_id']}"), 200)
    ts = lambda s: datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%fZ").timestamp()
    assert abs((ts(g["finished_at"]) - ts(g["started_at"])) - MIN_TURN) <= 1
    bal = [must(p.api.get(f"/api/characters/{c['id']}/wallet"), 200)["balance"] for p, c in zip(t.people, t.chars)]
    assert bal == [GRANT - DEFAULT_STAKE, GRANT + DEFAULT_STAKE]


def test_wf_table_clock_settlement_clock(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table", secs=MIN_TURN, n=3)
    t.sit(0)
    t.sit(1)
    a, b, c = t.people
    must(c.api.post(f"/api/tables/{t.tid}/spectators", {"character_id": t.chars[2]["id"]}), 201)
    with signed_in(browser, app_url, t.route, a.handle, a.passcode) as ap, \
            signed_in(browser, app_url, t.route, c.handle, c.passcode) as sp:
        for pg in (ap, sp):
            pg.clock.set_system_time(DEVICE_SKEW)
        t.start()
        timer = ap.get_by_role("timer", name="Turn clock")
        ui(ap, lambda: expect(timer).to_have_text(re.compile(r"^Your turn: [1-5] s$"), timeout=STEP_MS))
        spt = sp.get_by_role("timer", name="Turn clock")
        ui(sp, lambda: expect(spt).to_have_text(re.compile(rf"^{re.escape(t.chars[0]['name'])}'s turn: [0-5] s$"), timeout=STEP_MS))
        say(sp, "Game announcements", f"{t.chars[0]['name']} ran out of time. {t.chars[1]['name']} wins.")
    assert t.settled()["result"]["reason"] == "timeout"


def four_win(realm, stake=None):
    t = Table(realm, "Lantern Four Table", stake=stake)
    t.sit_all()
    t.start()
    t.play(["1", "2", "1", "2", "1", "2", "1"])
    return t


def test_stakes_zero_sum_settlement(app_url, mail):
    realm = Realm(app_url, mail)
    t = four_win(realm)
    info = t.settled()
    gid = info["game_id"]
    entries = ledger(realm)
    for e in entries:
        assert sum(line["amount"] for line in e["lines"]) == 0, e
    mine = [e for e in entries if e["game_id"] == gid]
    stake = [e for e in mine if e["kind"] == "stake"]
    settle = [e for e in mine if e["kind"] == "settlement"]
    assert len(stake) == 1 and len(settle) == 1
    acct = lambda e, a: sum(line["amount"] for line in e["lines"] if line["account"] == a)
    assert acct(stake[0], f"escrow:{gid}") == 2 * DEFAULT_STAKE and acct(settle[0], f"escrow:{gid}") == -2 * DEFAULT_STAKE
    for p, c in zip(t.people, t.chars):
        w = must(p.api.get(f"/api/characters/{c['id']}/wallet"), 200)
        assert w["balance"] == sum(line["amount"] for e in entries for line in e["lines"] if line["account"] == c["id"])
    assert info["result"]["settlement"][0]["amount"] == DEFAULT_STAKE


def test_settlement_waits_for_stored_result(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit_all()
    t.start()
    p0, c0 = t.at_seat(1)
    down = sign_in(outage("APP_STORAGE_DOWN_URL"), p0.handle, p0.passcode)
    fin = must(down.post(f"/api/tables/{t.tid}/forfeit", {"character_id": c0["id"]}), 200)
    gid = fin["game_id"]
    assert fin["state"] == "finished" and fin["pending_store"] is True
    assert [e for e in ledger(realm) if e["game_id"] == gid and e["kind"] == "settlement"] == []
    t.settled()
    hold(lambda: len([e for e in ledger(realm) if e["game_id"] == gid and e["kind"] == "settlement"]) == 1, MAIL_SETTLE)
    keys = S3().keys(f"servers/{realm.id}/games/{gid}/")
    assert f"servers/{realm.id}/games/{gid}/result.json" in keys and f"servers/{realm.id}/games/{gid}/manifest.json" in keys


def test_wf_table_clock_settlement_coins(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit_all()
    a = t.people[0]
    for reduced in (False, True):
        with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", a.handle, a.passcode, reduced=reduced) as pg:
            coins = pg.get_by_role("group", name="Coin balance")
            if t.refresh()["state"] == "settled":
                for i in (0, 1):
                    must(t.people[i].api.post(f"/api/tables/{t.tid}/rematch", {"character_id": t.chars[i]["id"]}), 200)
                assert t.refresh()["state"] == "in_play"
            else:
                t.start()
            bal = must(a.api.get(f"/api/characters/{t.chars[0]['id']}/wallet"), 200)["balance"]
            shows(pg, coins, str(bal))
            coins.evaluate(COIN_JS)
            other_seat = next(s["seat"] for s in t.table["seats"]
                              if s["character"] and s["character"]["id"] == t.chars[1]["id"])
            t.forfeit(other_seat)
            t.settled()
            final = must(a.api.get(f"/api/characters/{t.chars[0]['id']}/wallet"), 200)["balance"]
            assert final != bal, (final, bal)
            ui(pg, lambda: expect(coins).to_contain_text(str(final), timeout=STEP_MS))
            for _ in range(10):
                advance(pg, 100)
            values = pg.evaluate("() => window.__coins")
            nums = [int(re.sub(r"\D", "", v["v"]) or 0) for v in values]
            distinct = list(dict.fromkeys(nums))
            assert distinct[-1] == final
            if reduced:
                assert distinct == [final], distinct
            else:
                assert len(distinct) >= 5, distinct
                span = values[-1]["t"] - values[0]["t"]
                assert COIN_BAND[0] - 100 <= span <= COIN_BAND[1] + 100, span


def test_game_result_mail(app_url, mail):
    realm = Realm(app_url, mail)
    t = four_win(realm)
    info = t.settled()
    winner, loser = t.at_seat(1), t.at_seat(2)
    subject = "Result: Lantern Four Table"
    base = public_base(realm.base)
    win_line, lose_line = f"Your coins: {signed(DEFAULT_STAKE)}", f"Your coins: {signed(-DEFAULT_STAKE)}"
    for (p, c), line, other in ((winner, win_line, lose_line), (loser, lose_line, win_line)):
        mail_to(mail, p.email, subject)
        msgs = mail_exactly(mail, p.email, subject)
        assert len(msgs) == 1
        body = mail_text(msgs[0]).splitlines()
        assert f"Four in a row. {winner[1]['name']} wins." in body and line in body and other not in body
        assert f"Replay: {base}/s/{realm.slug}/games/{info['game_id']}" in body
        assert addresses(msgs[0]["To"]) == [p.email]


def test_four_in_a_row_rules(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit_all()
    t.start()
    t.play(["1"])
    bottom = t.table["position"]["rows"][5]
    assert bottom[0] == "I" and set(bottom[1:]) == {"."}, bottom
    err(t.move("2", seat=1), 422, "illegal_move", "Illegal: it is not your turn")
    t.play(["1", "1", "1", "1", "1"])
    assert [r[0] for r in t.table["position"]["rows"]] == ["G", "I", "G", "I", "G", "I"]
    err(t.move("1"), 422, "illegal_move", "Illegal: that column is full")
    p, c = t.at_seat(1)
    turn = t.turn
    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(lambda mv: p.api.post(f"/api/tables/{t.tid}/moves", {"character_id": c["id"], "turn": turn, "move": mv}), ["2", "3"]))
    ok = [r for r in rs if r.status_code == 200]
    assert len(ok) == 1, [r.text for r in rs]
    lost = next(r for r in rs if r.status_code != 200)
    assert lost.status_code in (409, 422) and lost.json()["error"] in ("stale_turn", "illegal_move")
    col = "2" if rs[0].status_code == 200 else "3"
    t.refresh()
    t.play(["6", col, "6", col, "6", col])
    res = t.table["result"]
    assert res["reason"] == "four_in_a_row" and res["winners"] == [1] and res["text"] == f"Four in a row. {t.chars[0]['name']} wins."


def play_hand(t, probe_rules=True):
    tricks = {1: 0, 2: 0, 3: 0, 4: 0}
    trick, checked = [], False
    while t.table["state"] == "in_play":
        seat = t.table["to_move_seat"]
        p, c = t.at_seat(seat)
        hand = must(p.api.get(f"/api/tables/{t.tid}"), 200)["hand"]
        legal = must(p.api.get(f"/api/tables/{t.tid}/legal-moves", params={"character_id": c["id"]}), 200)["moves"]
        assert set(legal) <= set(hand)
        if trick:
            led = trick[0][1][1]
            follow = [x for x in hand if x[1] == led]
            assert set(legal) == set(follow or hand)
            off = [x for x in hand if x[1] != led]
            if probe_rules and follow and off and not checked:
                err(t.move(off[0]), 422, "illegal_move", "Illegal: you must follow suit")
                checked = True
        must(t.move(legal[0]), 200)
        trick.append((seat, legal[0]))
        if len(trick) == 4:
            led = trick[0][1][1]
            win = max((s for s in trick if s[1][1] == led), key=lambda s: RANKS.index(s[1][0]))[0]
            tricks[win] += 1
            if t.table["state"] == "in_play":
                assert t.table["to_move_seat"] == win
            trick = []
    return tricks


def test_trick_game_rules(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Felt Card Table")
    t.sit_all()
    t.start()
    p, c = t.at_seat(1)
    hand = must(p.api.get(f"/api/tables/{t.tid}"), 200)["hand"]
    assert len(hand) == 13 and t.table["to_move_seat"] == 1
    foreign = next(x for x in (r + s for r in RANKS for s in "CDHS") if x not in hand)
    err(t.move(foreign), 422, "illegal_move", "Illegal: that card is not in your hand")
    tricks = play_hand(t)
    assert sum(tricks.values()) == 13
    info = t.settled()
    res = info["result"]
    assert res["reason"] == "hand_over"
    top = max(tricks.values())
    tops = [s for s in (1, 2, 3, 4) if tricks[s] == top]
    pool = DEFAULT_STAKE * (4 - len(tops))
    share, rem = divmod(pool, len(tops))
    expected = []
    for s in (1, 2, 3, 4):
        payout = DEFAULT_STAKE + share + (1 if s in tops[:rem] else 0) if s in tops else 0
        expected.append(payout - DEFAULT_STAKE)
    assert [x["amount"] for x in res["settlement"]] == expected
    g = must(p.api.get(f"/api/games/{info['game_id']}"), 200)
    assert g["seed"] is not None
    dealt = [card for h in (g["hands"].values() if isinstance(g["hands"], dict) else g["hands"]) for card in (h if isinstance(h, list) else h["cards"])]
    assert len(dealt) == 52 == len(set(dealt))


def test_hidden_hands_every_read_path(app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Felt Card Table", n=5)
    for i in range(4):
        t.sit(i)
    spec, sc = t.people[4], t.chars[4]
    must(spec.api.post(f"/api/tables/{t.tid}/spectators", {"character_id": sc["id"]}), 201)
    t.refresh()
    t.start()
    hands = {i: must(t.people[i].api.get(f"/api/tables/{t.tid}"), 200)["hand"] for i in range(4)}
    gid = t.table["game_id"]
    leaks = lambda txt, cards: [x for x in cards if f'"{x}"' in txt]
    for i in range(4):
        others = [x for j in range(4) if j != i for x in hands[j]]
        assert len(hands[i]) == 13
        for path in (f"/api/tables/{t.tid}", f"/api/games/{gid}", f"/api/games/{gid}/replay"):
            r = must(t.people[i].api.get(path), 200)
            assert leaks(json.dumps(r), others) == [], (i, path)
        g = must(t.people[i].api.get(f"/api/games/{gid}"), 200)
        assert g["seed"] is None
    every = [x for h in hands.values() for x in h]
    for path in (f"/api/tables/{t.tid}", f"/api/games/{gid}", f"/api/games/{gid}/replay", f"/api/servers/{realm.slug}/games?q=Felt"):
        assert leaks(json.dumps(must(spec.api.get(path), 200)), every) == [], path
    assert must(spec.api.get(f"/api/tables/{t.tid}"), 200)["hand"] is None
    assert must(spec.api.get(f"/api/games/{gid}"), 200)["hands"] is None
    s = Stream(spec.api, f"/api/tables/{t.tid}/events")
    s.wait(lambda e: e["event"] == "table")
    s.close()
    assert leaks(json.dumps([e["data"] for e in s.events]), every) == []
    err(spec.api.get(f"/api/tables/{t.tid}/legal-moves", params={"character_id": sc["id"]}), 403, "not_your_turn")
    must(realm.owner.post(f"/api/servers/{realm.slug}/worlds/home/saves", {}), 201)
    e = must(realm.owner.post(f"/api/servers/{realm.slug}/exports", {}), 201)["export"]
    raw = realm.owner.get(f"/api/servers/{realm.slug}/exports/{e['id']}").content
    assert leaks(raw.decode("utf-8", "replace"), every) == []


def test_disc_and_card_motion(browser, app_url, mail):
    realm = Realm(app_url, mail)
    four = Table(realm, "Lantern Four Table")
    four.sit_all()
    cards = Table(realm, "Felt Card Table")
    cards.sit_all()
    a, ca = four.people[0], cards.people[0]
    with signed_in(browser, app_url, four.route, a.handle, a.passcode, init=ANIM_JS) as fp, \
            signed_in(browser, app_url, four.route, four.people[1].handle, four.people[1].passcode, reduced=True, init=ANIM_JS) as fr:
        four.start()
        four.play(["4"])
        for pg in (fp, fr):
            ui(pg, lambda: expect(pg.get_by_role("gridcell", name=disc_name("d1", "Ink"))).to_be_visible(timeout=STEP_MS))
            advance(pg, 1000)
        drops = recorded(fp, "disc-drop")
        expect_ms = DISC_BASE + DISC_PER_ROW * 6
        assert drops and any(abs(d["duration"] - expect_ms) <= DISC_TOL for d in drops), drops
        assert recorded(fr, "disc-drop") == []
    with signed_in(browser, app_url, cards.route, ca.handle, ca.passcode, init=ANIM_JS) as cp, \
            signed_in(browser, app_url, cards.route, cards.people[1].handle, cards.people[1].passcode, reduced=True, init=ANIM_JS) as cr:
        cards.start()
        for _ in range(200):
            if len(recorded(cp, "card-deal")) >= 13:
                break
            advance(cp, 20)
        deal = recorded(cp, "card-deal")
        assert len(deal) >= 13 and all(DEAL_FLIGHT[0] <= d["duration"] <= DEAL_FLIGHT[1] for d in deal), deal
        starts = sorted(d["at"] + d["delay"] for d in deal)
        gaps = [b - a for a, b in zip(starts, starts[1:])][:8]
        assert all(DEAL_GAP[0] <= g <= DEAL_GAP[1] for g in gaps), gaps
        p, c = cards.at_seat(1)
        legal = must(p.api.get(f"/api/tables/{cards.tid}/legal-moves", params={"character_id": c["id"]}), 200)["moves"]
        must(cards.move(legal[0]), 200)
        for pg in (cp, cr):
            shows(pg, pg.get_by_role("region", name="Current trick"), card_name(legal[0]))
            advance(pg, 1000)
        flips = recorded(cp, "card-flip")
        assert flips and all(FLIP_BAND[0] <= f["duration"] <= FLIP_BAND[1] for f in flips), flips
        assert recorded(cr, "card-deal") == [] and recorded(cr, "card-flip") == []


def test_wf_cards_and_four_ui(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit_all()
    t.start()
    a = t.at_seat(1)[0]
    with signed_in(browser, app_url, t.route, a.handle, a.passcode) as pg:
        drop = pg.get_by_role("button", name="Drop in column 1")
        focused(pg, drop)
        for i in range(3):
            pg.keyboard.press("Enter")
            if i == 0:
                say(pg, "Game announcements", f"{'Ink'} drops in column {1}")
            poll(lambda: t.refresh()["to_move_seat"] == 2, 10, "ink dropped")
            must(t.move("1"), 200)
            ui(pg, lambda: expect(pg.get_by_role("gridcell", name=f"a{2 * i + 2}, Gold disc")).to_be_visible(timeout=STEP_MS))
        drop.focus()
        pg.keyboard.press("Enter")
        say(pg, "Game announcements", "Illegal: that column is full")
    assert [r[0] for r in t.refresh()["position"]["rows"]] == ["G", "I", "G", "I", "G", "I"]


def test_wf_cards_and_four_hidden_hands(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Felt Card Table", n=5)
    for i in range(4):
        t.sit(i)
    spec = t.people[4]
    must(spec.api.post(f"/api/tables/{t.tid}/spectators", {"character_id": t.chars[4]["id"]}), 201)
    t.refresh()
    t.start()
    p, c = t.at_seat(1)
    hand = must(p.api.get(f"/api/tables/{t.tid}"), 200)["hand"]
    with signed_in(browser, app_url, t.route, p.handle, p.passcode) as pg, \
            signed_in(browser, app_url, t.route, spec.handle, spec.passcode) as sp:
        lb = pg.get_by_role("listbox", name="Your hand")
        focused(pg, lb)
        options = lb.get_by_role("option")
        ui(pg, lambda: expect(options).to_have_count(13, timeout=STEP_MS))
        assert sorted(o.inner_text().strip() for o in options.all()) == sorted(card_name(x) for x in hand)
        expect(sp.get_by_role("listbox", name="Your hand")).to_have_count(0)
        focused(sp, sp.get_by_role("region", name="Current trick"))
        first = options.first.inner_text().strip()
        pg.keyboard.press("Enter")
        say(pg, "Game announcements", f"{c['name']} plays {first}")
        shows(sp, sp.get_by_role("region", name="Current trick"), first)
    trick = t.refresh()["position"]["trick"]
    assert [card_name(x["card"]) for x in trick] == [first]


def test_wf_spectate_history_live(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table", n=3)
    t.sit(0)
    t.sit(1)
    s, sc = t.people[2], t.chars[2]
    far = make_char(realm.owner, realm.slug)
    err(realm.owner.post(f"/api/tables/{t.tid}/spectators", {"character_id": far["id"]}), 422, "too_far")
    info = must(s.api.post(f"/api/tables/{t.tid}/spectators", {"character_id": sc["id"]}), 201)
    assert sc["id"] in json.dumps(info)
    t.start()
    stream = Stream(s.api, f"/api/tables/{t.tid}/events")
    stream.wait(lambda e: e["event"] == "table")
    with signed_in(browser, app_url, t.route, s.handle, s.passcode) as pg:
        pg.clock.set_system_time(DEVICE_SKEW)
        shows(pg, pg.get_by_role("list", name="Spectators"), sc["name"])
        for i, mv in enumerate(["3", "5"]):
            sent = time.time()
            must(t.move(mv), 200)
            ev = stream.wait(lambda e: e["event"] == "table" and e["data"].get("turn") == i + 1)
            assert ev["at"] - sent <= PUSH_TABLE_S, ev["at"] - sent
            name = disc_name("c1", "Ink") if i == 0 else disc_name("e1", "Gold")
            ui(pg, lambda: expect(pg.get_by_role("gridcell", name=name)).to_be_visible(timeout=STEP_MS), seconds=PUSH_TABLE_S + 1)
    stream.close()


def test_game_replay_reproduces_result(app_url, mail):
    realm = Realm(app_url, mail)
    t = four_win(realm)
    info = t.settled()
    rep = must(t.people[0].api.get(f"/api/games/{info['game_id']}/replay"), 200)
    assert rep["match"] is True and rep["replayed"] == rep["stored"]
    assert rep["stored"]["position"] == info["position"] and rep["stored"]["result"]["settlement"] == info["result"]["settlement"]
    for i in (0, 1):
        must(t.people[i].api.post(f"/api/tables/{t.tid}/rematch", {"character_id": t.chars[i]["id"]}), 200)
    t.refresh()
    t.play(["4", "4", "5"])
    rep = must(t.people[0].api.get(f"/api/games/{t.table['game_id']}/replay"), 200)
    assert rep["replayed"]["position"] == t.table["position"]


def test_history_search_per_server(browser, app_url, mail):
    shared = tag()
    realm, other = Realm(app_url, mail), Realm(app_url, mail)
    names = [f"Al{shared}", f"Bo{shared}"]
    t = Table(realm, "Lantern Four Table", names=names)
    u = Table(other, "Lantern Four Table", names=[f"Cy{shared}", f"Di{shared}"])
    for tb in (t, u):
        tb.sit_all()
        tb.start()
        tb.forfeit(2)
        tb.settled()
    res = must(t.people[0].api.get(f"/api/servers/{realm.slug}/games", params={"q": shared}), 200)
    assert res["total"] == 1 and len(res["games"]) == 1
    assert f"Cy{shared}" not in json.dumps(res)
    assert must(t.people[0].api.get(f"/api/servers/{realm.slug}/games", params={"q": f"Cy{shared}"}), 200)["total"] == 0
    with signed_in(browser, app_url, f"/s/{realm.slug}/games", t.people[0].handle, t.people[0].passcode) as pg:
        fill(pg.get_by_role("searchbox", name="Search games"), shared)
        say(pg, "Search results", "1 game found")
        expect(pg.get_by_role("list", name="Games").get_by_role("link", name=f"Lantern Four Table: {names[0]} vs {names[1]}")).to_be_visible()
        fill(pg.get_by_role("searchbox", name="Search games"), f"Cy{shared}")
        say(pg, "Search results", "No games found")


def test_wf_spectate_history_replay_viewer(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Oak Chess Table", n=3)
    t.sit(0)
    t.sit(1)
    t.start()
    t.play(DEMO)
    t.settled()
    w, b = t.chars[0]["name"], t.chars[1]["name"]
    s = t.people[2]
    with signed_in(browser, app_url, f"/s/{realm.slug}/games", s.handle, s.passcode) as pg:
        fill(pg.get_by_role("searchbox", name="Search games"), w)
        say(pg, "Search results", "1 game found")
        click(pg.get_by_role("link", name=f"Oak Chess Table: {w} vs {b}"))
        at_url(pg, rf"/s/{realm.slug}/games/{t.table['game_id']}$")
        total = len(DEMO)
        step = lambda n: f"Move {n} of {total}: {DEMO_COPY[n - 1]}"
        ui(pg, lambda: expect(pg.get_by_text(f"Move {total} of {total}")).to_be_visible(timeout=STEP_MS))
        result = pg.get_by_role("region", name="Result")
        for line in (f"Checkmate. {b} wins.", f"{w}: {signed(-DEFAULT_STAKE)}", f"{b}: {signed(DEFAULT_STAKE)}"):
            shows(pg, result, line)
        board = pg.get_by_role("region", name="Replay board")
        board.focus()
        pg.keyboard.press("Home")
        say(pg, "Replay announcements", step(1))
        expect(pg.get_by_text(f"Move {1} of {total}")).to_be_visible()
        pg.keyboard.press("ArrowRight")
        say(pg, "Replay announcements", step(2))
        pg.keyboard.press("ArrowLeft")
        say(pg, "Replay announcements", step(1))
        pg.keyboard.press("End")
        say(pg, "Replay announcements", step(total))
        expect(board.get_by_role("gridcell", name=sq_name("h4", "Black", "Queen"))).to_be_visible()


def test_wf_friends_invites_join(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = tag()
    email = f"pw{t}@example.com"
    must(realm.owner.post(f"/api/servers/{realm.slug}/invites", {"email": email}, key=idempotency_key()), 201)
    msg = mail_to(mail, email)[0]
    inviter = "Eli Brandt"
    assert msg["Subject"] == f"{inviter} invited you to {realm.name}"
    link = re.search(r"https?://\S+/join/(\S+)", mail_text(msg))
    token = link.group(1)
    info = must(Api(app_url).get(f"/api/invites/{token}"), 200)
    assert info["server_name"] == realm.name and info["email"] == email
    with open_app(browser, link.group(0)) as pg:
        ui(pg, lambda: expect(pg.get_by_role("heading", name=f"Join {realm.name}")).to_be_visible(timeout=STEP_MS))
        expect(pg.get_by_text(f"{inviter} invited {email}.")).to_be_visible()
        fill(pg.get_by_role("textbox", name="Handle"), f"j{t}")
        fill(pg.get_by_role("textbox", name="Display name"), f"Joiner {t}")
        fill(pg.get_by_label("Passcode", exact=True), f"pass-{t}")
        click(pg.get_by_role("button", name="Join server"))
        at_url(pg, rf"/s/{realm.slug}/roster$")
        pg.reload()
        at_url(pg, rf"/s/{realm.slug}/roster$")
    me = sign_in(app_url, f"j{t}", f"pass-{t}")
    assert realm.slug in [s["slug"] for s in must(me.get("/api/me"), 200)["servers"]]
    err(Api(app_url).get(f"/api/invites/{token}"), 410, "invite_used")
    with open_app(browser, link.group(0)) as pg:
        fill(pg.get_by_role("textbox", name="Handle"), f"k{t}")
        fill(pg.get_by_role("textbox", name="Display name"), "Again")
        fill(pg.get_by_label("Passcode", exact=True), f"pass-{t}")
        click(pg.get_by_role("button", name="Join server"))
        say(pg, "Join status", "This invite link has already been used.")
    must(realm.owner.post(f"/api/servers/{realm.slug}/invites", {"email": "sefa@plotwright.test"}, key=idempotency_key()), 201)
    tok = invite_token(mail, "sefa@plotwright.test")
    err(Api(app_url).post(f"/api/invites/{tok}/accept", {"handle": f"s{t}", "display_name": "S", "passcode": f"pass-{t}"}),
        409, "email_in_use")
    short = outage("APP_SHORT_URL")
    api = sign_in(short, "rowan", SEED_PASS["rowan"])
    srv = must(api.post("/api/checkout", {"server_name": f"Ttl {t}", "plan": "hamlet"}, key=idempotency_key()), 201)["server"]
    late = f"late{t}@example.com"
    must(api.post(f"/api/servers/{srv['slug']}/invites", {"email": late}, key=idempotency_key()), 201)
    ltok = invite_token(mail, late)
    poll(lambda: Api(short).get(f"/api/invites/{ltok}").status_code == 410, ACTIVE_WAIT, "invite expired")
    err(Api(short).get(f"/api/invites/{ltok}"), 410, "invite_expired")


def test_invite_supersede_and_parallel(app_url, mail):
    realm = Realm(app_url, mail)
    email = f"pw{tag()}@example.com"
    path = f"/api/servers/{realm.slug}/invites"
    must(realm.owner.post(path, {"email": email}, key=idempotency_key()), 201)
    old = invite_token(mail, email)
    must(realm.owner.post(path, {"email": email}, key=idempotency_key()), 201)
    newest = max(mail_to(mail, email, count=2), key=lambda m: m.get("Date", ""))
    new = re.search(r"/join/(\S+)", mail_text(newest)).group(1)
    assert new != old
    err(Api(app_url).get(f"/api/invites/{old}"), 410, "invite_superseded")
    must(Api(app_url).get(f"/api/invites/{new}"), 200)
    states = sorted(i["state"] for i in must(realm.owner.get(path), 200)["invites"] if i["email"] == email)
    assert states == ["pending", "superseded"], states
    key, same = idempotency_key(), f"pw{tag()}@example.com"
    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        rs = list(ex.map(lambda _: realm.owner.post(path, {"email": same}, key=key), range(4)))
    ids = {r.json()["invite"]["id"] for r in rs if r.status_code == 201}
    assert len(ids) == 1, [r.text for r in rs]
    distinct = [f"pw{tag()}@example.com" for _ in range(3)]
    with concurrent.futures.ThreadPoolExecutor(3) as ex:
        for r in ex.map(lambda e: realm.owner.post(path, {"email": e}, key=idempotency_key()), distinct):
            must(r, 201)
    for e in [same] + distinct:
        mail_to(mail, e)
        assert len(mail_exactly(mail, e, "invited you to")) == 1, e


def test_wf_friends_invites_held(browser, app_url, mail):
    realm = Realm(app_url, mail)
    down = outage("APP_MAIL_DOWN_URL")
    email = f"pw{tag()}@example.com"
    with signed_in(browser, down, f"/s/{realm.slug}/roster", "eli", SEED_PASS["eli"]) as pg:
        click(pg.get_by_role("button", name="Friends"))
        dlg = pg.get_by_role("dialog", name="Friends")
        fill(dlg.get_by_role("textbox", name="Friend's email"), email)
        click(dlg.get_by_role("button", name="Send invite"))
        say(pg, "Invite status", "Invite held: mail is down", scope=dlg)
    second = f"pw{tag()}@example.com"
    api = sign_in(down, "eli", SEED_PASS["eli"])
    assert must(api.post(f"/api/servers/{realm.slug}/invites", {"email": second}, key=idempotency_key()), 201)["invite"]["mail"] == "held"
    for e in (email, second):
        mail_to(mail, e)
        assert len(mail_exactly(mail, e, "invited you to")) == 1
    invites = {i["email"]: i["mail"] for i in must(realm.owner.get(f"/api/servers/{realm.slug}/invites"), 200)["invites"]}
    assert invites[email] == invites[second] == "sent"


def test_wf_friends_invites_presence(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    with signed_in(browser, app_url, f"/s/{realm.slug}/roster", "eli", SEED_PASS["eli"]) as pg:
        click(pg.get_by_role("button", name="Friends"))
        lst = pg.get_by_role("dialog", name="Friends").get_by_role("list", name="Friends")
        shows(pg, lst, f"{p.display} ({p.handle}): {'OFFLINE'}")
        s = Stream(p.api, f"/api/servers/{realm.slug}/events")
        s.wait(lambda e: e["event"] == "snapshot")
        shows(pg, lst, f"{p.display} ({p.handle}): {'ONLINE'}", seconds=PUSH_SERVER_S + 2 * STEP_MS / 1000)
        s.close()
        shows(pg, lst, f"{p.display} ({p.handle}): {'OFFLINE'}", seconds=OFFLINE_S + 1)


def test_wf_coin_top_up_checkout(browser, app_url, mail, killbill):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    with signed_in(browser, app_url, f"/s/{realm.slug}/coins", p.handle, p.passcode) as pg:
        focused(pg, pg.get_by_role("heading", name="Step 1 of 3: Pack"))
        click(pg.get_by_role("button", name="Next"))
        shows(pg, pg.get_by_role("status", name="Purchase status"), "Choose a coin pack.")
        pack = pg.get_by_role("radiogroup", name="Coin pack").get_by_role("radio", name="Satchel, 550 coins, 5.00 USD")
        click(pack)
        click(pg.get_by_role("radiogroup", name="Character").get_by_role("radio", name=ch["name"]))
        click(pg.get_by_role("button", name="Next"))
        focused(pg, pg.get_by_role("heading", name="Step 2 of 3: Review"))
        click(pg.get_by_role("button", name="Back"))
        expect(pack).to_be_checked()
        click(pg.get_by_role("button", name="Next"))
        click(pg.get_by_role("button", name="Next"))
        focused(pg, pg.get_by_role("heading", name="Step 3 of 3: Pay"))
        click(pg.get_by_role("button", name=f"Pay {'5.00'} USD"))
        at_url(pg, rf"/s/{realm.slug}/coins/[^/]+$", seconds=ACTIVE_WAIT)
        pid = pg.url.rstrip("/").split("/")[-1]
        shows(pg, pg.get_by_role("status", name="Purchase status"), f"{550} coins added to {ch['name']}.", seconds=ACTIVE_WAIT)
        pg.reload()
        shows(pg, pg.get_by_role("status", name="Purchase status"), f"{550} coins added to {ch['name']}.")
    assert must(p.api.get(f"/api/coin-purchases/{pid}"), 200)["state"] == "paid"
    assert killbill.payment_by_key(f"pw-coins-{pid}") is not None
    tops = [e for e in ledger(realm) if e["purchase_id"] == pid and e["kind"] == "top_up"]
    assert len(tops) == 1 and sorted(l["amount"] for l in tops[0]["lines"]) == [-550, 550]


def test_coins_only_on_confirmed_payment(app_url, mail, killbill):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    slow = sign_in(outage("APP_SLOW_BILLING_URL"), p.handle, p.passcode)
    b = must(slow.post(f"/api/servers/{realm.slug}/coin-purchases", {"character_id": ch["id"], "pack": "satchel"}, key=idempotency_key()), 202)
    pid = b["id"]
    assert b["state"] == "pending"
    assert must(p.api.get(f"/api/characters/{ch['id']}/wallet"), 200)["balance"] == GRANT
    poll(lambda: must(p.api.get(f"/api/coin-purchases/{pid}"), 200)["state"] == "paid", SETTLER_WAIT, "paid")
    assert must(p.api.get(f"/api/characters/{ch['id']}/wallet"), 200)["balance"] == GRANT + 550
    assert len([e for e in ledger(realm) if e["purchase_id"] == pid and e["kind"] == "top_up"]) == 1
    subject = f"Coins added on {realm.name}"
    mail_to(mail, p.email, subject)
    msgs = mail_exactly(mail, p.email, subject)
    assert len(msgs) == 1 and f"{ch['name']} received 550 coins for 5.00 USD." in mail_text(msgs[0])
    acct = killbill.account_by_key(f"plotwright-{realm.id}-{p.handle}")["accountId"]
    assert [x["paymentExternalKey"] for x in killbill.payments(acct)].count(f"pw-coins-{pid}") == 1
    key, body = idempotency_key(), {"character_id": ch["id"], "pack": "pouch"}
    first = p.api.post(f"/api/servers/{realm.slug}/coin-purchases", body, key=key)
    again = p.api.post(f"/api/servers/{realm.slug}/coin-purchases", body, key=key)
    assert first.status_code == again.status_code and first.json()["id"] == again.json()["id"]
    before = len(must(p.api.get(f"/api/servers/{realm.slug}/coin-purchases"), 200)["purchases"])
    down = sign_in(outage("APP_KILLBILL_DOWN_URL"), p.handle, p.passcode)
    err(down.post(f"/api/servers/{realm.slug}/coin-purchases", body, key=idempotency_key()), 503, "billing_unavailable")
    assert len(must(p.api.get(f"/api/servers/{realm.slug}/coin-purchases"), 200)["purchases"]) == before


def test_daily_purchase_limit(app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    with concurrent.futures.ThreadPoolExecutor(7) as ex:
        rs = list(ex.map(lambda _: p.api.post(f"/api/servers/{realm.slug}/coin-purchases",
                                              {"character_id": ch["id"], "pack": "pouch"}, key=idempotency_key()), range(7)))
    assert sum(r.status_code in (201, 202) for r in rs) == 5, [r.status_code for r in rs]
    for r in rs:
        if r.status_code not in (201, 202):
            err(r, 429, "daily_limit_reached", "You've made 5 purchases today. Try again after midnight server time.")
            assert 1 <= int(r.headers["Retry-After"]) <= DAY_SECONDS
    assert len(must(p.api.get(f"/api/servers/{realm.slug}/coin-purchases"), 200)["purchases"]) == 5


def test_wf_coin_top_up_refund(browser, app_url, mail, killbill):
    realm = Realm(app_url, mail)
    p, q = realm.player(), realm.player()
    ch, qc = make_char(p.api, realm.slug), make_char(q.api, realm.slug)
    buy = lambda: must(p.api.post(f"/api/servers/{realm.slug}/coin-purchases", {"character_id": ch["id"], "pack": "pouch"}, key=idempotency_key()), 201)["id"]
    pid = buy()
    err(p.api.post(f"/api/coin-purchases/{pid}/refund", {}), 403, "forbidden")
    with signed_in(browser, app_url, f"/s/{realm.slug}/coins/{pid}", "eli", SEED_PASS["eli"]) as pg:
        click(pg.get_by_role("button", name="Refund"))
        shows(pg, pg.get_by_role("status", name="Purchase status"), f"Refunded. {100} coins were removed from {ch['name']}.")
    assert must(realm.owner.get(f"/api/coin-purchases/{pid}"), 200)["state"] == "refunded"
    refunds = [e for e in ledger(realm) if e["purchase_id"] == pid and e["kind"] == "refund"]
    assert len(refunds) == 1 and {l["account"]: l["amount"] for l in refunds[0]["lines"]} == {ch["id"]: -100, "house": 100}
    pay = killbill.payment_by_key(f"pw-coins-{pid}")
    refund_keys = [x.get("transactionExternalKey") for x in pay["transactions"]]
    assert f"pw-refund-{pid}" in refund_keys
    mail_to(mail, p.email, f"Coin purchase refunded on {realm.name}")
    err(realm.owner.post(f"/api/coin-purchases/{pid}/refund", {}), 409, "already_refunded")
    pid2 = buy()
    must(p.api.post(f"/api/servers/{realm.slug}/trades", {"character_id": ch["id"], "partner_id": qc["id"], "coins": 550, "items": []}), 201)
    err(realm.owner.post(f"/api/coin-purchases/{pid2}/refund", {}), 409, "coins_spent",
        "Some of these coins are spent, so this purchase can't be refunded.")


def trade_pair(realm):
    a, b = realm.player(), realm.player()
    return a, b, make_char(a.api, realm.slug), make_char(b.api, realm.slug)


def test_trade_escrow(app_url, mail):
    realm = Realm(app_url, mail)
    a, b, ca, cb = trade_pair(realm)
    c = realm.player()
    cc = make_char(c.api, realm.slug)
    walk_to(c.api, cc, (16, 11))
    err(c.api.post(f"/api/servers/{realm.slug}/trades", {"character_id": cc["id"], "partner_id": ca["id"], "coins": 0, "items": []}), 422, "too_far")
    tr = must(a.api.post(f"/api/servers/{realm.slug}/trades", {"character_id": ca["id"], "partner_id": cb["id"], "coins": 30, "items": []}), 201)
    tid = tr["id"]
    tr = must(b.api.post(f"/api/trades/{tid}/offer", {"character_id": cb["id"], "version": tr["version"], "coins": 0,
                                                      "items": [{"kind": "wood", "count": 4}]}), 200)
    assert must(a.api.get(f"/api/characters/{ca['id']}"), 200)["available"] == GRANT - 30
    wood = next(s for s in inv(b.api, cb["id"]).values() if s["kind"] == "wood")
    assert wood["held"] == 4
    err(b.api.post(f"/api/characters/{cb['id']}/inventory/moves", {"from": wood["slot"], "to": 10}), 409, "slot_held")
    walk_to(c.api, cc, (16, 7))
    err(c.api.post(f"/api/servers/{realm.slug}/trades", {"character_id": cc["id"], "partner_id": ca["id"], "coins": 0, "items": []}), 409, "trade_open")
    must(b.api.post(f"/api/trades/{tid}/accept", {"character_id": cb["id"], "version": tr["version"]}), 200)
    given = time.monotonic()
    side = lambda: next(s for s in must(a.api.get(f"/api/trades/{tid}"), 200)["sides"] if s["character_id"] == cb["id"])
    poll(lambda: side()["accepted"] is False, LAPSE_WAIT, "accept lapsed")
    assert time.monotonic() - given >= LAPSE_MIN
    v = must(a.api.get(f"/api/trades/{tid}"), 200)["version"]
    must(a.api.post(f"/api/trades/{tid}/accept", {"character_id": ca["id"], "version": v}), 200)
    done = must(b.api.post(f"/api/trades/{tid}/accept", {"character_id": cb["id"], "version": v}), 200)
    assert done["state"] == "completed"
    entries = [e for e in ledger(realm) if e["trade_id"] == tid]
    assert len(entries) == 1 and sum(l["amount"] for l in entries[0]["lines"]) == 0
    assert must(a.api.get(f"/api/characters/{ca['id']}/wallet"), 200)["balance"] == GRANT - 30
    assert must(b.api.get(f"/api/characters/{cb['id']}/wallet"), 200)["balance"] == GRANT + 30
    assert count_of(inv(a.api, ca["id"]), "wood") == 20 and count_of(inv(b.api, cb["id"]), "wood") == 12


def test_trade_accept_race(app_url, mail):
    realm = Realm(app_url, mail)
    a, b, ca, cb = trade_pair(realm)
    tr = must(a.api.post(f"/api/servers/{realm.slug}/trades", {"character_id": ca["id"], "partner_id": cb["id"], "coins": 10, "items": []}), 201)
    tid, v = tr["id"], tr["version"]
    err(b.api.post(f"/api/trades/{tid}/accept", {"character_id": cb["id"], "version": v - 1}), 409, "trade_changed",
        "Trade changed. Both players must accept again.")
    for amount in range(10, 14):
        v = must(a.api.get(f"/api/trades/{tid}"), 200)["version"]
        must(a.api.post(f"/api/trades/{tid}/accept", {"character_id": ca["id"], "version": v}), 200)
        with concurrent.futures.ThreadPoolExecutor(2) as ex:
            acc = ex.submit(b.api.post, f"/api/trades/{tid}/accept", {"character_id": cb["id"], "version": v})
            chg = ex.submit(a.api.post, f"/api/trades/{tid}/offer", {"character_id": ca["id"], "version": v, "coins": amount + 1, "items": []})
            ra, rc = acc.result(), chg.result()
        state = must(a.api.get(f"/api/trades/{tid}"), 200)
        if state["state"] == "completed":
            assert ra.status_code == 200 and rc.status_code == 409
            entry = next(e for e in ledger(realm) if e["trade_id"] == tid)
            assert {l["account"]: l["amount"] for l in entry["lines"]}[cb["id"]] == amount
            return
        assert rc.status_code == 200 and ra.status_code == 409 and ra.json()["error"] == "trade_changed"
        assert [s["accepted"] for s in state["sides"]] == [False, False]


def test_wf_trading_live(browser, app_url, mail):
    realm = Realm(app_url, mail)
    a, b, ca, cb = trade_pair(realm)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", a.handle, a.passcode) as ap, \
            signed_in(browser, app_url, f"/s/{realm.slug}/w/home", b.handle, b.passcode) as bp:
        click(ap.get_by_role("button", name="Offer a trade"))
        od = ap.get_by_role("dialog", name="Offer a trade")
        focused(ap, od.get_by_role("heading", name="Step 1 of 3: Partner"))
        select(od.get_by_role("combobox", name="Partner"), cb["name"])
        click(od.get_by_role("button", name="Next"))
        fill(od.get_by_role("spinbutton", name="Coins to offer"), "10")
        click(od.get_by_role("button", name="Next"))
        focused(ap, od.get_by_role("heading", name="Step 3 of 3: Review"))
        click(od.get_by_role("button", name="Open trade"))
        aw = ap.get_by_role("dialog", name=f"Trade with {cb['name']}")
        say(ap, "Trade status", f"Trade opened with {cb['name']}", scope=aw)
        say(bp, "World announcements", f"{ca['name']} offers a trade.")
        click(bp.get_by_role("button", name=f"Open trade with {ca['name']}"))
        bw = bp.get_by_role("dialog", name=f"Trade with {ca['name']}")
        aw.get_by_role("button", name="Accept").focus()
        fill(bw.get_by_role("spinbutton", name="Coins to offer"), "5")
        click(bw.get_by_role("button", name="Update offer"))
        say(bp, "Trade status", "Offer updated", scope=bw)
        shows(ap, aw.get_by_role("region", name=f"{cb['name']}'s offer"), "5", seconds=PUSH_SERVER_S + 1)
        expect(aw.get_by_role("button", name="Accept")).to_be_focused()
        click(bw.get_by_role("button", name="Accept"))
        say(bp, "Trade status", f"You accepted. Waiting for {ca['name']}.", scope=bw)
        accepted = re.compile(r"(?<!NOT )ACCEPTED")
        shows(ap, aw.get_by_role("region", name=f"{cb['name']}'s offer"), accepted, seconds=PUSH_SERVER_S + 1)
        fill(aw.get_by_role("spinbutton", name="Coins to offer"), "12")
        click(aw.get_by_role("button", name="Update offer"))
        for pg, w in ((ap, aw), (bp, bw)):
            say(pg, "Trade status", "Trade changed. Both players must accept again.", scope=w)
            shows(pg, w.get_by_role("region", name="Your offer"), "NOT ACCEPTED")
        click(bw.get_by_role("button", name="Accept"))
        shows(ap, aw.get_by_role("region", name=f"{cb['name']}'s offer"), accepted, seconds=PUSH_SERVER_S + 1)
        click(aw.get_by_role("button", name="Accept"))
        say(ap, "Trade status", "Trade complete", scope=aw)
    entry = next(e for e in ledger(realm) if e["kind"] == "trade" and ca["id"] in json.dumps(e["lines"]))
    assert {l["account"]: l["amount"] for l in entry["lines"]}[ca["id"]] == -7


def test_wf_trading_cancel(browser, app_url, mail):
    realm = Realm(app_url, mail)
    a, b, ca, cb = trade_pair(realm)
    tr = must(a.api.post(f"/api/servers/{realm.slug}/trades", {"character_id": ca["id"], "partner_id": cb["id"], "coins": 40, "items": []}), 201)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", b.handle, b.passcode) as pg:
        click(pg.get_by_role("button", name=f"Open trade with {ca['name']}"))
        w = pg.get_by_role("dialog", name=f"Trade with {ca['name']}")
        click(w.get_by_role("button", name="Cancel trade"))
        say(pg, "Trade status", "Trade cancelled", scope=w)
    assert must(a.api.get(f"/api/trades/{tr['id']}"), 200)["state"] == "cancelled"
    assert must(a.api.get(f"/api/characters/{ca['id']}"), 200)["available"] == GRANT


def four_forfeit(realm, people, chars, loser):
    t = Table.__new__(Table)
    t.realm, t.name = realm, "Lantern Four Table"
    t.tid = table_of(realm.owner, realm.slug, t.name)["id"]
    t.people, t.chars = people, chars
    t.by_char = {c["id"]: (p, c) for p, c in zip(people, chars)}
    t.sit_all()
    t.start()
    seat = next(s["seat"] for s in t.table["seats"] if s["character"]["id"] == loser["id"])
    t.forfeit(seat)
    t.settled()
    for p, c in zip(people, chars):
        must(p.api.delete(f"/api/tables/{t.tid}/seats/{c['id']}"), 200)


def test_leaderboards_and_seasons(app_url, mail):
    realm = Realm(app_url, mail)
    ps = [realm.player() for _ in range(4)]
    cs = [make_char(p.api, realm.slug) for p in ps]
    for p, c in zip(ps, cs):
        walk_to(p.api, c, ADJACENT["Lantern Four Table"])
    A, B, C, D = range(4)
    stream = Stream(ps[0].api, f"/api/servers/{realm.slug}/events")
    for w, l in ((A, B), (B, D), (C, D), (A, C)):
        four_forfeit(realm, [ps[w], ps[l]], [cs[w], cs[l]], cs[l])
    stream.wait(lambda e: e["event"] == "leaderboard" and any(x["wins"] == 2 for x in e["data"]["entries"]), 10, "leaderboard push")
    stream.close()
    board = must(ps[0].api.get(f"/api/servers/{realm.slug}/leaderboards/four"), 200)
    assert [(e["rank"], e["character_id"], e["wins"]) for e in board["entries"]] == [
        (1, cs[A]["id"], 2), (2, cs[B]["id"], 1), (2, cs[C]["id"], 1)]
    other = Realm(app_url, mail)
    assert must(other.owner.get(f"/api/servers/{other.slug}/leaderboards/four"), 200)["entries"] == []
    err(ps[0].api.post(f"/api/servers/{realm.slug}/seasons", {}), 403, "forbidden")
    must(realm.owner.post(f"/api/servers/{realm.slug}/seasons", {}), 201)
    board = must(ps[0].api.get(f"/api/servers/{realm.slug}/leaderboards/four"), 200)
    assert board["season"] == 2 and board["entries"] == []
    assert must(realm.owner.get(f"/api/servers/{realm.slug}"), 200)["season"] == 2


def test_wf_leaderboards_achievements_season(browser, app_url, mail):
    realm = Realm(app_url, mail)
    t = Table(realm, "Lantern Four Table")
    t.sit_all()
    t.start()
    t.forfeit(2)
    t.settled()
    with signed_in(browser, app_url, f"/s/{realm.slug}/leaderboards", "eli", SEED_PASS["eli"]) as pg:
        season = lambda n: f"Season {n}"
        expect(pg.get_by_role("heading", name=season(1))).to_be_visible()
        click(pg.get_by_role("tablist", name="Game").get_by_role("tab", name="Four in a row"))
        shows(pg, pg.get_by_role("table", name="Leaderboard"), t.chars[0]["name"])
        click(pg.get_by_role("button", name="Start new season"))
        dlg = pg.get_by_role("dialog", name="Start a new season?")
        click(dlg.get_by_role("button", name="Keep season"))
        expect(pg.get_by_role("heading", name=season(1))).to_be_visible()
        click(pg.get_by_role("button", name="Start new season"))
        click(dlg.get_by_role("button", name="Start season"))
        say(pg, "Leaderboard status", f"{season(2)} started")
        expect(pg.get_by_role("heading", name=season(2))).to_be_visible()
        shows(pg, pg.get_by_role("table", name="Leaderboard"), "No wins yet this season.")
    assert must(realm.owner.get(f"/api/servers/{realm.slug}/leaderboards/four"), 200)["entries"] == []


def test_achievements_unlock_once(app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    blocks = f"/api/servers/{realm.slug}/worlds/home/blocks"
    for _ in range(10):
        must(p.api.post(blocks, {"character_id": ch["id"], "x": 17, "y": 9, "material": "wood"}), 201)
        must(p.api.post(blocks + "/break", {"character_id": ch["id"], "x": 17, "y": 9}), 200)
    must(p.api.post(f"/api/characters/{ch['id']}/crafts", {"recipe": "fence"}), 201)
    must(p.api.post(f"/api/characters/{ch['id']}/crafts", {"recipe": "fence"}), 201)
    names = [a["name"] for a in must(p.api.get(f"/api/characters/{ch['id']}/achievements"), 200)["achievements"]]
    assert sorted(names) == ["First Stone", "Groundbreaker", "Maker"]


def test_wf_leaderboards_achievements_toast(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    make_char(p.api, realm.slug)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        click(pg.get_by_role("button", name="Inventory"))
        dlg = pg.get_by_role("dialog", name="Inventory")
        craft = dlg.get_by_role("region", name="Crafting").get_by_role("button", name=f"Craft {'Fence'}")
        craft.focus()
        pg.keyboard.press("Enter")
        toast = pg.get_by_role("status", name="Achievements")
        unlocked = f"Achievement unlocked: {'Maker'}"
        ui(pg, lambda: expect(toast).to_have_text(unlocked, timeout=STEP_MS))
        expect(craft).to_be_focused()
        advance(pg, TOAST_MS - 1000)
        expect(toast).to_have_text(unlocked)
        advance(pg, 1500)
        ui(pg, lambda: expect(toast).to_have_text("", timeout=STEP_MS))
        expect(craft).to_be_focused()


def test_wf_inventory_crafting_keyboard(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode) as pg:
        moves = []
        pg.on("request", lambda r: moves.append(r.post_data_json) if r.method == "POST" and "/inventory/moves" in r.url else None)
        map_cursor(pg).focus()
        pg.keyboard.press("i")
        dlg = pg.get_by_role("dialog", name="Inventory")
        wood, n, home_cell, far_cell = "wood block", STARTER_STACK, "a1", "e1"
        focused(pg, dlg.get_by_role("gridcell", name=slot_name(home_cell, wood, n)))
        grid = dlg.get_by_role("grid", name="Inventory")
        assert grid.get_by_role("gridcell").evaluate_all(TABBABLE_JS) == 1
        pg.keyboard.press("Space")
        say(pg, "Inventory announcements", f"Picked up {wood} from {home_cell}", scope=dlg)
        pg.keyboard.press("ArrowRight")
        pg.keyboard.press("Escape")
        say(pg, "Inventory announcements", "Move cancelled", scope=dlg)
        assert moves == []
        dlg.get_by_role("gridcell", name=slot_name(home_cell, wood, n)).focus()
        pg.keyboard.press("Space")
        for _ in range(4):
            pg.keyboard.press("ArrowRight")
        pg.keyboard.press("Space")
        say(pg, "Inventory announcements", f"Moved {wood} to {far_cell}", scope=dlg)
        ui(pg, lambda: expect(dlg.get_by_role("gridcell", name=slot_name(far_cell, wood, n))).to_be_visible(timeout=STEP_MS))
        dlg.get_by_role("gridcell", name=slot_name(far_cell, wood, n)).drag_to(
            dlg.get_by_role("gridcell", name=f"{home_cell}, empty"))
        ui(pg, lambda: expect(dlg.get_by_role("gridcell", name=slot_name(home_cell, wood, n))).to_be_visible(timeout=STEP_MS))
        click(dlg.get_by_role("button", name=f"Craft {'Fence'}"))
        say(pg, "Inventory announcements", f"Crafted {'fence'}", scope=dlg)
    assert len(moves) == 2 and moves[1] == {"from": moves[0]["to"], "to": moves[0]["from"]}
    slots = inv(p.api, ch["id"])
    assert slots[1]["kind"] == "wood" and count_of(slots, "fence") == 1


def test_inventory_stack_rules(app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    mv = lambda a, b: p.api.post(f"/api/characters/{ch['id']}/inventory/moves", {"from": a, "to": b})
    slots = {s["slot"]: s for s in must(mv(1, 6), 200)["slots"]}
    assert slots[1]["kind"] is None and (slots[6]["kind"], slots[6]["count"]) == ("wood", 16)
    slots = {s["slot"]: s for s in must(mv(2, 6), 200)["slots"]}
    assert (slots[2]["kind"], slots[2]["count"], slots[6]["kind"], slots[6]["count"]) == ("wood", 16, "stone", 16)
    err(mv(1, 7), 422, "empty_slot")
    err(mv(2, 25), 422, "validation")


def test_crafting(app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    craft = lambda r: p.api.post(f"/api/characters/{ch['id']}/crafts", {"recipe": r})
    before = inv(p.api, ch["id"])
    err(craft("signpost"), 422, "missing_ingredients", "Missing ingredients for Signpost.")
    assert inv(p.api, ch["id"]) == before
    b = must(craft("fence"), 201)
    assert b["crafted"] == {"kind": "fence", "count": 1}
    must(craft("signpost"), 201)
    must(craft("lantern"), 201)
    must(craft("window"), 201)
    must(craft("milestone"), 201)
    s = inv(p.api, ch["id"])
    assert (count_of(s, "wood"), count_of(s, "stone"), count_of(s, "brick"), count_of(s, "glass")) == (11, 13, 7, 2)
    assert [count_of(s, k) for k in ("fence", "signpost", "lantern", "window", "milestone")] == [0, 1, 1, 1, 1]


def test_wf_inventory_crafting_phone(browser, app_url, mail):
    realm = Realm(app_url, mail)
    p = realm.player()
    ch = make_char(p.api, realm.slug)
    with signed_in(browser, app_url, f"/s/{realm.slug}/w/home", p.handle, p.passcode, size=(375, 812)) as pg:
        tap(pg.get_by_role("button", name="Inventory"))
        dlg = pg.get_by_role("dialog", name="Inventory")
        ui(pg, lambda: expect(dlg).to_be_visible(timeout=STEP_MS))
        box = dlg.bounding_box()
        assert box["width"] >= 0.95 * 375 and abs(box_bottom(box) - 812) <= 2
        tap(dlg.get_by_role("button", name=f"Craft {'Fence'}"))
        say(pg, "Inventory announcements", f"Crafted {'fence'}", scope=dlg)
        layout(pg)
    assert count_of(inv(p.api, ch["id"]), "fence") == 1


def iso(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp()


def night(phase):
    pts = [(0, 0.45), (0.25, 0.15), (0.5, 0), (0.75, 0.15), (1, 0.45)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= phase <= x1:
            return y0 + (y1 - y0) * (phase - x0) / (x1 - x0)
    return 0.45


def test_weather_schedule_and_storm(app_url):
    api = sign_in(app_url, "tobias", SEED_PASS["tobias"])
    r = api.get(f"/api/servers/{FENNEL}/weather")
    w = must(r, 200)
    since, changes = iso(w["since"]), iso(w["changes_at"])
    assert changes - since == PERIOD_DEFAULT
    k = int(since // PERIOD_DEFAULT)
    assert since == k * PERIOD_DEFAULT and w["weather"] == SCHEDULE[(k + 2) % 4]
    now = datetime.strptime(r.headers["Date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc).timestamp()
    assert abs(w["night_level"] - round(night((now % DAY_SECONDS) / DAY_SECONDS), 3)) <= DATE_TOL
    short = outage("APP_SHORT_URL")
    ines = sign_in(short, "ines", SEED_PASS["ines"])
    s = Stream(ines, f"/api/servers/{LARK}/events")
    snap = s.wait(lambda e: e["event"] == "snapshot")
    due = iso(snap["data"]["weather"]["changes_at"])
    ev = s.wait(lambda e: e["event"] == "weather", ACTIVE_WAIT, "weather push")
    s.close()
    assert ev["at"] <= due + PUSH_SERVER_S, (ev["at"], due)
    poll(lambda: must(ines.get(f"/api/servers/{LARK}/weather"), 200)["weather"] == "storm", ACTIVE_WAIT, "storm")
    kite = vehicle(ines, LARK, MEADOW, "Paper Kite")
    target = free_runway(ines, LARK, MEADOW, (kite["x"], kite["y"]))
    err(ines.post(f"/api/vehicles/{kite['id']}/park", {"x": target[0], "y": target[1]}), 409, "weather_grounded",
        "Planes are grounded during the storm.")
    after = vehicle(ines, LARK, MEADOW, "Paper Kite")
    assert (after["x"], after["y"]) == (kite["x"], kite["y"])


WEATHER_COPY = {"clear": "Weather: clear", "rain": "Weather: rain", "storm": "Weather: storm. Planes are grounded."}


def weather_page(browser, reduced):
    short = outage("APP_SHORT_URL")
    return short, signed_in(browser, short, f"/s/{LARK}/w/{MEADOW}", "ines", SEED_PASS["ines"],
                            reduced=reduced, init=ANIM_JS)


def test_wf_weather_badge(browser, app_url):
    short, cm = weather_page(browser, False)
    api = sign_in(short, "ines", SEED_PASS["ines"])
    wpath = f"/api/servers/{LARK}/weather"
    with cm as pg:
        badge = pg.get_by_role("status", name="Weather")
        w0 = must(api.get(wpath), 200)
        ui(pg, lambda: expect(badge).to_have_text(w0["weather"].upper(), timeout=STEP_MS))

        def changed_weather():
            w = must(api.get(wpath), 200)
            return w if w["since"] != w0["since"] and w["weather"] != w0["weather"] else None
        w1 = poll(changed_weather, ACTIVE_WAIT, "weather change")
        say(pg, "World announcements", WEATHER_COPY[w1["weather"]])
        ui(pg, lambda: expect(badge).to_have_text(w1["weather"].upper(), timeout=STEP_MS))
        advance(pg, 2000)
        overlays = anim_els(pg, "night-tint")
        assert len(overlays) == 1, overlays
        level = float(overlays[0]["level"])
        assert abs(level - must(api.get(wpath), 200)["night_level"]) <= NIGHT_TOL
        tints = recorded(pg, "night-tint")
        assert tints and all(TINT_BAND[0] <= t["duration"] <= TINT_BAND[1] for t in tints), tints


def test_wf_weather_reduced(browser, app_url):
    short, cm = weather_page(browser, True)
    api = sign_in(short, "ines", SEED_PASS["ines"])
    wpath = f"/api/servers/{LARK}/weather"
    with cm as pg:
        w0 = must(api.get(wpath), 200)
        poll(lambda: must(api.get(wpath), 200)["since"] != w0["since"], ACTIVE_WAIT, "weather change")
        advance(pg, 2000)
        ui(pg, lambda: assert_eq([e["phase"] for e in anim_els(pg, "night-tint")], ["end"]))
        level = float(anim_els(pg, "night-tint")[0]["level"])
        assert abs(level - must(api.get(wpath), 200)["night_level"]) <= NIGHT_TOL
        assert recorded(pg, "night-tint") == []


APP = Path("/app")
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}


def shipped():
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=APP,
                         capture_output=True, text=True, timeout=600)
    data = json.loads(out.stdout or "{}")
    pkgs = {}

    def walk(deps):
        for name, info in (deps or {}).items():
            if not info.get("version"):
                continue
            pkgs[(name, info["version"])] = info
            walk(info.get("dependencies"))
    walk(data.get("dependencies"))
    return pkgs


def test_if_run_manifest():
    run = json.loads((APP / "run.json").read_text())
    assert run["_schema"] == "run-manifest-v1"
    assert all(isinstance(run[k], str) and run[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n, _ in shipped() if n not in notes]
    assert missing == [], missing
    for name in ("Pixelify Sans", "Atkinson Hyperlegible", "JetBrains Mono", "Lucide"):
        assert name in notes


def test_if_licences():
    bad = []
    for (name, version), info in shipped().items():
        lic = info.get("license")
        if lic is None and info.get("path"):
            lic = json.loads((Path(info["path"]) / "package.json").read_text()).get("license")
        if lic not in ALLOWED:
            bad.append((name, version, lic))
    assert bad == [], bad
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    assert "OFL-1.1" in notes and "ISC" in notes


def test_if_datastores():
    pkg = json.loads((APP / "package.json").read_text())
    deps = set(pkg.get("dependencies", {})) | set(pkg.get("devDependencies", {}))
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "level", "lmdb", "pouchdb"}
    assert deps & forbidden == set()
    files = [p for p in APP.rglob("*") if "node_modules" not in p.parts and ".git" not in p.parts
             and p.suffix in (".sqlite", ".sqlite3", ".db", ".rdb")]
    assert files == [], files


def test_if_same_origin_assets(browser, app_url):
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    with signed_in(browser, app_url, "/s/larkspur-commons/w/meadow", "ines", SEED_PASS["ines"]) as pg:
        urls = []
        pg.on("request", lambda r: urls.append(r.url))
        pg.reload()
        advance(pg, 3000)
        pg.goto(f"{app_url}/help")
        advance(pg, 1000)
    foreign = [u for u in urls if u.startswith("http") and not same_origin(u, origin)]
    assert foreign == [], foreign


def test_if_service_config_unchanged():
    if not (APP / ".git").exists():
        return
    first = subprocess.run(["git", "-C", str(APP), "rev-list", "--max-parents=0", "HEAD"], capture_output=True, text=True).stdout.split()
    assert first, "no git history"
    files = subprocess.run(["git", "-C", str(APP), "ls-tree", "-r", "--name-only", first[-1]], capture_output=True, text=True).stdout.split()
    watched = [f for f in files if re.search(r"(^|/)(docker-)?compose[^/]*\.ya?ml$", f) or re.search(r"(^|/)seed", f)]
    if watched:
        rc = subprocess.run(["git", "-C", str(APP), "diff", "--quiet", first[-1], "--", *watched]).returncode
        assert rc == 0, watched


def test_if_typescript_and_lockfile():
    lock = json.loads((APP / "package-lock.json").read_text())
    assert lock.get("lockfileVersion"), "package-lock.json has no lockfileVersion"
    assert lock.get("packages", {}).get("", {}).get("name") == json.loads((APP / "package.json").read_text()).get("name")
    if (APP / ".git").exists():
        rc = subprocess.run(["git", "-C", str(APP), "ls-files", "--error-unmatch", "package-lock.json"], capture_output=True).returncode
        assert rc == 0
    ts = [p for p in APP.rglob("*.ts") if "node_modules" not in p.parts and not p.name.endswith(".d.ts")]
    assert ts
