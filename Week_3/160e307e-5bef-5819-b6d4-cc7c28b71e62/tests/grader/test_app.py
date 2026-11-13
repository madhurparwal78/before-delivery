from __future__ import annotations

import contextlib
import json
import math
import os
import re
import socket
import threading
import time
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parseaddr
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    addresses,
    advance,
    axe,
    capture,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    motion,
    open_app,
    same_origin,
    session,
    shipped_packages,
    state_styles,
)
from conftest import text as mail_text


APP_DIR = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")
SHORT_ENV = "APP_SHORT_URL"
DB_DOWN_ENV = "APP_DB_DOWN_URL"
MAIL_DOWN_ENV = "APP_MAIL_DOWN_URL"
GRADING_KEY = os.environ.get("GRADING_KEY", "dc-grading-7f3a91c4")

HTTP_TIMEOUT = 30
POLL_MS = 250
STEP_MS = 100
FINE_STEP_MS = 16
WAIT_S = 30
LONG_WAIT_S = 90
MAIL_WAIT_S = 30
MAX_POLLS = 100000
TAB_LIMIT = 60
GEOMETRY_SLACK_PX = 2
COUNTDOWN_SLACK_S = 5

PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
SIZES = {"375x812": PHONE, "768x1024": TABLET, "1280x800": DESKTOP}
SIZE_IDS = ["375x812", "768x1024", "1280x800"]
TARGET_PX = 44
SLIDER_HANDLE_PX = 48
BOARD_MM = 740
MAX_PULL_SHARE = 0.4
CANCEL_PX = 8
STRIKER_Y = 252.1
COORD_TOL = 0.06
DRAG_TOL_MM = 2
SPIRAL_START_MM = 35
SPIRAL_STEP_MM = 5
SPIRAL_ANGLE_STEP = 30
SPIRAL_RINGS = 60
FREE_MM = 31.1
SHAKE_MS = 120
SHAKE_PX = 4
SHAKE_SAMPLES = 12
WIPE_MS = 520
WIPE_MIN_MS = 400
WIPE_MAX_MS = 650
ROTATE_MIN_MS = 300
ROTATE_MAX_MS = 800
ROTATE_SAMPLE_MS = 4000
VERDICT_WORD_MS = 250
BANNER_MARGIN_MS = 300
BANNER_EARLY_MS = 400
BANNER_HIDE_SLACK_MS = 1000
RADAR_MS = 1600
GHOST_MS = 1000
PREVIEW_LIMIT = 15
PREVIEW_BURST = 20
PLAYBACK_CAP_MS = 2400
SKIP_CHECK_MS = 50
DEFAULT_SHOT_SECONDS = 20
ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
BODY_LIMIT = 65536
LOCAL_BODY_LIMIT = 1000000
JOINERS = 5
SKEWED_CLOCK = datetime(2031, 3, 4, 5, 6, 7, tzinfo=timezone.utc)
EVIL_ORIGIN = "http://elsewhere.example.test"
TRIO_RATING = 2900
CANCEL_RATING = 2400
RADAR_RATING = 2000
LEADER_RATING = 3990
PHONE_QUEUE_RATING = 3400
PULSE_PERIOD_MS = 1000
PULSE_STEP_MS = 100
PULSE_MIN_SPREAD = 0.1
RAIL_IDS = ["name-0", "score-0", "coins-left-0", "dues-0", "name-1", "score-1", "coins-left-1", "dues-1", "queen-status"]
HERO_LINES_JS = """() => { const h = document.querySelector('h1'); if (!h) return null;
  const r = document.createRange(); r.selectNodeContents(h);
  const tops = [...new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)))];
  const b = h.getBoundingClientRect(); return {lines: tops.length, bottom: b.bottom}; }"""
PULSE_JS = """() => { const t = document.getElementById('shot-timer'); if (!t) return null;
  const related = [t, ...t.getElementsByTagName('*')]; let a = t.parentElement;
  for (let i = 0; a && i < 3; i++, a = a.parentElement) related.push(a);
  const anims = document.getAnimations().filter(x => x.playState === 'running' && x.effect && related.includes(x.effect.target)
    && x.effect.getKeyframes().some(k => 'opacity' in k)).length;
  let eff = 1; for (let e = t; e; e = e.parentElement) eff *= Number(getComputedStyle(e).opacity);
  let inner = 1; for (const e of t.getElementsByTagName('*')) inner = Math.min(inner, Number(getComputedStyle(e).opacity));
  return {anims, opacity: eff * inner}; }"""
PAIR_PUSH_S = 2

OPENING = {"queen": (0.0, 0.0), "w1": (31.2, 0.0), "b1": (15.6, 27.0), "w2": (-15.6, 27.0), "b2": (-31.2, 0.0), "w3": (-15.6, -27.0), "b3": (15.6, -27.0), "w4": (62.4, 0.0), "b4": (46.8, 27.0), "b5": (31.2, 54.0), "w5": (0.0, 54.0), "w6": (-31.2, 54.0), "b6": (-46.8, 27.0), "b7": (-62.4, 0.0), "w7": (-46.8, -27.0), "w8": (-31.2, -54.0), "b8": (0.0, -54.0), "b9": (31.2, -54.0), "w9": (46.8, -27.0)}
PIECE_IDS = ["striker", "queen"] + [f"w{i}" for i in range(1, 10)] + [f"b{i}" for i in range(1, 10)]
FAR_SPOTS = {"w1": (-150.0, -150.0), "w2": (-200.0, -100.0), "w3": (-250.0, 0.0), "w4": (-200.0, 100.0), "w5": (-150.0, 150.0), "b1": (100.0, -100.0), "b2": (150.0, -150.0), "b3": (200.0, -50.0), "b4": (150.0, 100.0)}
SHIFT_MM = 150.0
TIERS = [(1399, "Bronze"), (1400, "Silver"), (1599, "Silver"), (1600, "Gold"), (1799, "Gold"), (1800, "Platinum"), (1999, "Platinum"), (2000, "Diamond")]
DATASTORE_PACKAGES = {"redis", "ioredis", "mongodb", "mongoose", "sqlite3", "better-sqlite3", "mysql", "mysql2", "amqplib", "kafkajs", "nats", "@aws-sdk/client-s3", "minio", "firebase", "firebase-admin", "pusher", "ably", "lowdb", "nedb", "level", "lmdb", "memcached", "@upstash/redis", "bullmq", "bull"}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
VENV_MARKER = "pyvenv.cfg"
NOTICE_ASSETS = ("Chivo", "Lucide")
RADAR_QUARTER_DEG = 90
RADAR_TOL_DEG = 20
UPGRADED = 101
INBETWEEN_MIN_DEG = 10
INBETWEEN_MAX_DEG = 170


PIECES_JS = """ids => Object.fromEntries(ids.map(id => { const e = document.getElementById('piece-' + id);
  return [id, e ? {x: e.getAttribute('data-x'), y: e.getAttribute('data-y'), state: e.getAttribute('data-state')} : null]; }))"""

RECORDER_JS = """() => {
  if (window.__dcRec) return;
  const rec = window.__dcRec = {phases: [], wipes: [], wipeOn: false};
  const snap = () => {
    const root = document.getElementById('match-root');
    const ann = document.getElementById('announcer');
    if (root) {
      const entry = {phase: root.getAttribute('data-phase'), turn: root.getAttribute('data-turn'),
        field: root.getAttribute('data-field'), announcer: ann ? (ann.textContent || '') : ''};
      const last = rec.phases[rec.phases.length - 1];
      if (!last || last.phase !== entry.phase || last.turn !== entry.turn || last.field !== entry.field || last.announcer !== entry.announcer) rec.phases.push(entry);
    }
    const wipe = document.getElementById('field-wipe');
    if (wipe && !rec.wipeOn) rec.wipes.push({from: wipe.getAttribute('data-from'), turn: root && root.getAttribute('data-turn'), field: root && root.getAttribute('data-field')});
    rec.wipeOn = !!wipe;
  };
  new MutationObserver(snap).observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
  snap();
}"""

FREEZE_JS = """() => {
  const mine = n => !!(n && n.closest && n.closest('#piece-striker, #verdict-word'));
  const pause = el => { if (mine(el)) el.getAnimations().forEach(a => { if (a.playState === 'running') a.pause(); }); };
  document.addEventListener('animationstart', e => pause(e.target), true);
  document.addEventListener('transitionrun', e => pause(e.target), true);
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); if (mine(this)) a.pause(); return a; };
}"""

TIMER_RECORDER_INIT = """(() => { const rec = () => { const el = document.getElementById('shot-timer'); if (!el) return;
  const t = (el.textContent || '').trim(); if (!t) return; const seen = window.__dcTimer = window.__dcTimer || [];
  if (seen[seen.length - 1] !== t) seen.push(t); };
  new MutationObserver(rec).observe(document, {subtree: true, childList: true, characterData: true, attributes: true}); })();"""

SHAKE_JS = """() => { const root = document.getElementById('piece-striker'); if (!root) return [];
  const els = [root, ...root.getElementsByTagName('*')]; const out = [];
  for (const a of document.getAnimations()) {
    const target = a.effect && a.effect.target; if (!target || !els.includes(target)) continue;
    const end = a.effect.getComputedTiming().endTime; if (!isFinite(end) || end <= 0) continue;
    a.pause(); const xs = [];
    for (let i = 0; i <= 24; i++) { a.currentTime = end * i / 24; xs.push(target.getBoundingClientRect().left); }
    a.currentTime = end; out.push({end, xs});
  }
  return out; }"""

LEFTS_JS = """() => { const root = document.getElementById('piece-striker'); if (!root) return [];
  return [root, ...root.getElementsByTagName('*')].map(e => e.getBoundingClientRect().left); }"""

ROTATION_JS = """() => { const el = document.getElementById('board-rotator'); if (!el) return null;
  const cs = getComputedStyle(el); let deg = 0;
  if (cs.transform && cs.transform !== 'none') { const m = new DOMMatrixReadOnly(cs.transform); deg += Math.atan2(m.b, m.a) * 180 / Math.PI; }
  if (cs.rotate && cs.rotate !== 'none') { const v = parseFloat(cs.rotate.split(' ').pop()); if (!isNaN(v)) deg += v; }
  return {deg, rotation: el.getAttribute('data-rotation')}; }"""

ROTATOR_WATCH_JS = """() => { window.__dcRot = [];
  const keep = anims => { for (const a of anims) { const t = a.effect.getComputedTiming();
    const kf = a.effect.getKeyframes ? a.effect.getKeyframes() : [];
    window.__dcRot.push({duration: Number(t.duration) || 0, props: [...new Set(kf.flatMap(k => Object.keys(k)))].concat(a.transitionProperty ? [a.transitionProperty] : [])}); } };
  const watch = e => { const el = document.getElementById('board-rotator'); if (el && e.target === el) keep(el.getAnimations()); };
  document.addEventListener('transitionrun', watch, true); document.addEventListener('animationstart', watch, true);
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); if (this.id === 'board-rotator') keep([a]); return a; };
}"""

WIPE_ANIMS_JS = """() => { const w = document.getElementById('field-wipe'); if (!w) return [];
  const els = [w, ...w.getElementsByTagName('*')];
  return document.getAnimations().filter(a => a.effect && els.includes(a.effect.target)).map(a => Number(a.effect.getComputedTiming().duration) || 0); }"""

RADAR_JS = """() => { const r = document.getElementById('radar'); if (!r) return null;
  const els = [r, ...r.getElementsByTagName('*')];
  const anims = document.getAnimations().filter(a => a.effect && els.includes(a.effect.target)).map(a => { const t = a.effect.getComputedTiming();
    return {duration: Number(t.duration) || 0, infinite: t.iterations === Infinity, running: a.playState === 'running'}; });
  const angles = els.map(e => { const cs = getComputedStyle(e); let d = 0;
    if (cs.transform && cs.transform !== 'none') { const m = new DOMMatrixReadOnly(cs.transform); d += Math.atan2(m.b, m.a) * 180 / Math.PI; }
    if (cs.rotate && cs.rotate !== 'none') { const v = parseFloat(cs.rotate.split(' ').pop()); if (!isNaN(v)) d += v; }
    return d; });
  return {anims, angles}; }"""

SHOWN_JS = """id => { const el = document.getElementById(id); if (!el) return false;
  if (!(el.textContent || '').trim()) return false;
  const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.5) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }"""

PASTE_JS = """code => { const el = document.activeElement; const data = new DataTransfer(); data.setData('text/plain', code);
  el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true})); }"""

BAND_RECORDER_INIT = """(() => { const KEY = '__dcBands';
  const rec = () => { const el = document.getElementById('queue-band'); if (!el) return;
    const t = (el.textContent || '').trim(); const seen = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    if (t && seen[seen.length - 1] !== t) { seen.push(t); sessionStorage.setItem(KEY, JSON.stringify(seen)); } };
  new MutationObserver(rec).observe(document, {subtree: true, childList: true, characterData: true}); })();"""


def outage(env: str) -> str:
    url = os.environ.get(env, "")
    assert url, f"{env} is not set; the verifier must expose that app copy"
    return url.rstrip("/")


def fresh_name(prefix: str = "Q") -> str:
    return (prefix + uuid.uuid4().hex)[:12]


def near(a: float, b: float, tol: float = COORD_TOL) -> bool:
    return abs(float(a) - float(b)) <= tol


def home_re(base: str) -> str:
    return re.escape(base) + r"/?(?:[?#].*)?$"


def eventually(page: Page, probe: Callable[[], Any], what: str, seconds: float = WAIT_S, step_ms: float = STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    last = ""
    for _ in range(MAX_POLLS):
        try:
            probe()
            return
        except AssertionError as error:
            last = str(error)
        if time.monotonic() >= deadline:
            break
        advance(page, step_ms)
    pytest.fail(f"{what} (waited {seconds}s); last check: {last[:600]}")


def poll(fetch: Callable[[], Any], ok: Callable[[Any], bool], what: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    for _ in range(MAX_POLLS):
        last = fetch()
        if ok(last):
            return last
        if time.monotonic() >= deadline:
            break
    pytest.fail(f"{what} (waited {seconds}s); last value: {str(last)[:600]}")


def see(page: Page, locator: Locator, what: str, seconds: float = WAIT_S, step_ms: float = STEP_MS) -> None:
    eventually(page, lambda: expect(locator.first).to_be_visible(timeout=POLL_MS), f"{what} is visible", seconds, step_ms)


def see_text(page: Page, locator: Locator, value: Any, what: str = "", exact: bool = True, seconds: float = WAIT_S, step_ms: float = STEP_MS) -> None:
    def probe() -> None:
        if exact:
            expect(locator).to_have_text(value, timeout=POLL_MS)
        else:
            expect(locator).to_contain_text(value, timeout=POLL_MS)
    eventually(page, probe, what or f"text {value!r}", seconds, step_ms)


def see_attr(page: Page, locator: Locator, name: str, value: Any, what: str = "", seconds: float = WAIT_S, step_ms: float = STEP_MS) -> None:
    eventually(page, lambda: expect(locator).to_have_attribute(name, value, timeout=POLL_MS), what or f"{name}={value!r}", seconds, step_ms)


def see_url(page: Page, pattern: str, what: str, seconds: float = WAIT_S) -> None:
    eventually(page, lambda: expect(page).to_have_url(re.compile(pattern), timeout=POLL_MS), what, seconds)


def page_now(page: Page) -> float:
    return page.evaluate("() => Date.now()")


def shown(page: Page, element_id: str) -> bool:
    return page.evaluate(SHOWN_JS, element_id)


def is_focused(locator: Locator) -> bool:
    return locator.count() > 0 and locator.first.evaluate("el => el === document.activeElement || el.contains(document.activeElement)")


def tab_to(page: Page, locator: Locator, what: str, key: str = "Tab", presses: int = TAB_LIMIT) -> None:
    for _ in range(presses):
        if is_focused(locator):
            return
        page.keyboard.press(key)
    if not is_focused(locator):
        pytest.fail(f"keyboard focus never reached {what} within {presses} {key} presses")


def press(page: Page, key: str, times: int = 1) -> None:
    for _ in range(times):
        page.keyboard.press(key)


def assert_focus_trapped(page: Page, container: Locator, what: str, presses: int = 6) -> None:
    for key in ("Tab", "Shift+Tab"):
        for _ in range(presses):
            page.keyboard.press(key)
            inside = container.evaluate("el => el.contains(document.activeElement)")
            assert inside, f"{key} moved focus out of {what}; Tab and Shift+Tab must wrap inside it (L201)"


def el(page: Page, ident: str) -> Locator:
    return page.locator("#" + ident)


def ann_text(page: Page) -> str:
    return el(page, "announcer").text_content() or ""


_CDP: dict[int, Any] = {}


def cdp(page: Page) -> Any:
    if id(page) not in _CDP:
        _CDP[id(page)] = session(page)
    return _CDP[id(page)]


def touch_at(page: Page, kind: str, x: float = 0.0, y: float = 0.0) -> None:
    points = [] if kind in ("touchEnd", "touchCancel") else [{"x": x, "y": y, "id": 1}]
    cdp(page).send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def cdp_tap(page: Page, locator: Locator) -> None:
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    assert box, "control to tap has no box"
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    touch_at(page, "touchStart", x, y)
    touch_at(page, "touchEnd")


def touch_path(page: Page, start: tuple[float, float], end: tuple[float, float], steps: int = 12) -> None:
    for i in range(1, steps + 1):
        touch_at(page, "touchMove", start[0] + (end[0] - start[0]) * i / steps, start[1] + (end[1] - start[1]) * i / steps)


@contextlib.contextmanager
def visit(browser: Browser, base: str, path: str, player: "Player | None" = None, *, size: tuple[int, int] | None = None,
          touch: bool = False, reduced: bool = False, skew: bool = False, init: str | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/api/health", reduced_motion="reduce" if reduced else "no-preference") as page:
        if size:
            page.set_viewport_size({"width": size[0], "height": size[1]})
        if touch:
            cdp(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        if player:
            page.context.add_cookies([{"name": "dc_session", "value": player.cookie, "url": base}])
        if skew:
            page.clock.set_system_time(SKEWED_CLOCK)
        if init:
            page.add_init_script(init)
        page.goto(base + path)
        try:
            yield page
        finally:
            _CDP.pop(id(page), None)


@dataclass
class Player:
    id: str
    name: str
    cookie: str
    email: str | None


def client(base: str, player: Player | None = None) -> httpx.Client:
    headers = {"Cookie": f"dc_session={player.cookie}"} if player else {}
    return httpx.Client(base_url=base, headers=headers, timeout=HTTP_TIMEOUT)


def guest(base: str) -> tuple[httpx.Client, dict]:
    c = client(base)
    r = c.get("/api/me")
    assert r.status_code == 200, f"GET /api/me for a new visitor answered {r.status_code}: {r.text}"
    return c, r.json()


def grading(base: str, path: str, body: Any, key: str | None = GRADING_KEY) -> httpx.Response:
    headers = {"X-Grading-Key": key} if key is not None else {}
    return httpx.post(base + path, json=body, headers=headers, timeout=HTTP_TIMEOUT)


def new_player(base: str, **fields: Any) -> Player:
    name = fields.pop("name", None) or fresh_name("P")
    body = {"name": name, "avatar": fields.pop("avatar", 7), **fields}
    r = grading(base, "/api/grading/players", body)
    assert r.status_code == 201, f"POST /api/grading/players answered {r.status_code}: {r.text}"
    j = r.json()
    return Player(j["id"], j["name"], j["sessionCookie"], body.get("email"))


def linked_player(base: str, **fields: Any) -> Player:
    name = fresh_name("R")
    return new_player(base, name=name, email=f"{name.lower()}@example.test", **fields)


def new_match(base: str, players: list[Player], **fields: Any) -> str:
    body = {"mode": "casual", "format": "quick", "players": [p.id for p in players], "white": 0, "turn": 0, **fields}
    r = grading(base, "/api/grading/matches", body)
    assert r.status_code == 201, f"POST /api/grading/matches answered {r.status_code}: {r.text}"
    return r.json()["id"]


def grading_shot(base: str, mid: str, seat: int, pocketed: tuple[str, ...] = (), first: str | None = "w5",
                 striker: bool = False, final: list | None = None) -> dict:
    events = {"firstContact": first, "pocketed": [{"id": i, "pocket": "ne"} for i in pocketed], "strikerPocketed": striker}
    body: dict[str, Any] = {"seat": seat, "events": events}
    if final:
        body["final"] = final
    r = grading(base, f"/api/grading/matches/{mid}/shots", body)
    assert r.status_code == 200, f"grading shot answered {r.status_code}: {r.text}"
    return r.json()


def match_json(base: str, player: Player, mid: str) -> dict:
    r = client(base, player).get(f"/api/matches/{mid}")
    assert r.status_code == 200, f"GET /api/matches/{mid} answered {r.status_code}: {r.text}"
    return r.json()


def piece(match: dict, pid: str) -> dict:
    return next(p for p in match["pieces"] if p["id"] == pid)


def history(base: str, player: Player) -> list[dict]:
    r = client(base, player).get(f"/api/players/{player.id}/history")
    assert r.status_code == 200, r.text
    return r.json()["matches"]


def ledger(c: httpx.Client) -> list[dict]:
    r = c.get("/api/me/ledger")
    assert r.status_code == 200, r.text
    body = r.json()
    entries = body["entries"]
    moves: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        moves[e["movementId"]].append(e)
    for mid, pair in moves.items():
        assert len(pair) == 2 and sorted(e["account"] for e in pair) == ["house", "player"], f"movement {mid} is not one player and one house entry: {pair}"
        assert sum(e["delta"] for e in pair) == 0, f"movement {mid} entries do not sum to zero: {pair}"
    player_sum = sum(e["delta"] for e in entries if e["account"] == "player")
    assert body["sum"] == player_sum, f"ledger sum {body['sum']} differs from the player entries {player_sum}"
    assert c.get("/api/me").json()["chalk"] == player_sum, "chalk balance is not the sum of the player ledger entries"
    return [e for e in entries if e["account"] == "player"]


def layout_pieces(*, without: tuple[str, ...] = (), moved: dict[str, tuple[float, float]] | None = None) -> list[dict]:
    moved = moved or {}
    out = []
    for pid, (x, y) in OPENING.items():
        if pid in without:
            continue
        x, y = moved.get(pid, (x, y))
        out.append({"id": pid, "x": x, "y": y, "state": "board", "pocketedBy": None})
    return out


def far_pieces(ids: list[str], queen: str = "covered") -> list[dict]:
    out = [{"id": i, "x": FAR_SPOTS[i][0], "y": FAR_SPOTS[i][1], "state": "board", "pocketedBy": None} for i in ids]
    if queen == "covered":
        out.append({"id": "queen", "x": 0, "y": 0, "state": "pocketed", "pocketedBy": 0})
    else:
        out.append({"id": "queen", "x": 0.0, "y": 0.0, "state": "board", "pocketedBy": None})
    return out


def return_spot(occupied: list[tuple[float, float]]) -> tuple[float, float]:
    def free(pt: tuple[float, float]) -> bool:
        return all(math.dist(pt, o) >= FREE_MM for o in occupied)
    if free((0.0, 0.0)):
        return (0.0, 0.0)
    for ring in range(SPIRAL_RINGS):
        r = SPIRAL_START_MM + SPIRAL_STEP_MM * ring
        for k in range(360 // SPIRAL_ANGLE_STEP):
            a = math.radians(SPIRAL_ANGLE_STEP * k)
            pt = (r * math.cos(a), r * math.sin(a))
            if free(pt):
                return pt
    pytest.fail("no free spiral point found")


def spots_for(returned: list[str], on_board: dict[str, tuple[float, float]]) -> dict[str, tuple[float, float]]:
    occupied = list(on_board.values())
    out = {}
    for pid in returned:
        out[pid] = return_spot(occupied)
        occupied.append(out[pid])
    return out


def aiming(page: Page) -> None:
    see_attr(page, el(page, "match-root"), "data-phase", "aim", "match screen reached data-phase=aim")


def pieces_on(page: Page) -> dict:
    return page.evaluate(PIECES_JS, PIECE_IDS)


def assert_board_equals(vals: dict, api_pieces: list[dict], skip: tuple[str, ...] = ()) -> None:
    for p in api_pieces:
        if p["id"] in skip:
            continue
        v = vals.get(p["id"])
        assert v, f"#piece-{p['id']} missing from the page"
        assert v["state"] == p["state"], f"#piece-{p['id']} data-state {v['state']} but the server says {p['state']}"
        if p["state"] == "board":
            assert near(float(v["x"]), p["x"]) and near(float(v["y"]), p["y"]), f"#piece-{p['id']} at ({v['x']}, {v['y']}) but the server has ({p['x']}, {p['y']})"
        else:
            assert not (v["x"] or ""), f"pocketed #piece-{p['id']} still has data-x {v['x']}"


def wait_connected(page: Page, base: str, player: Player, mid: str, seats: tuple[int, ...] = (0, 1)) -> None:
    c = client(base, player)

    def probe() -> None:
        m = c.get(f"/api/matches/{mid}").json()
        assert all(m["seats"][s]["connected"] for s in seats), f"seats {seats} connected flags: {[s['connected'] for s in m['seats']]}"
    eventually(page, probe, "players' sockets joined the match")


def see_verdict(page: Page, word: str, line: str) -> None:
    see_text(page, el(page, "verdict-word"), word, f"#verdict-word {word}", step_ms=50)
    see_text(page, el(page, "verdict-line"), line, f"#verdict-line {line!r}", step_ms=50)


def see_announced(page: Page, phrase: str) -> None:
    eventually(page, lambda: expect(el(page, "announcer")).to_contain_text(phrase, timeout=POLL_MS), f"#announcer carries {phrase!r}")


@dataclass
class Duel:
    base: str
    a: Player
    b: Player
    mid: str
    pa: Page
    pb: Page

    def state(self) -> dict:
        return match_json(self.base, self.a, self.mid)


@contextlib.contextmanager
def duel(browser: Browser, base: str, *, players: tuple[Player, Player] | None = None, a_view: dict | None = None,
         b_view: dict | None = None, **match_fields: Any) -> Iterator[Duel]:
    a, b = players or (new_player(base), new_player(base))
    mid = new_match(base, [a, b], **match_fields)
    with visit(browser, base, f"/match/{mid}", a, **(a_view or {})) as pa, visit(browser, base, f"/match/{mid}", b, **(b_view or {})) as pb:
        aiming(pa)
        aiming(pb)
        wait_connected(pa, base, a, mid)
        yield Duel(base, a, b, mid, pa, pb)


@dataclass
class Solo:
    base: str
    a: Player
    b: Player
    mid: str
    page: Page

    def state(self) -> dict:
        return match_json(self.base, self.a, self.mid)


@contextlib.contextmanager
def solo(browser: Browser, base: str, *, view: dict | None = None, **match_fields: Any) -> Iterator[Solo]:
    a, b = new_player(base), new_player(base)
    mid = new_match(base, [a, b], **match_fields)
    with visit(browser, base, f"/match/{mid}", a, **(view or {})) as page:
        aiming(page)
        wait_connected(page, base, a, mid, seats=(0,))
        yield Solo(base, a, b, mid, page)


@contextlib.contextmanager
def local_match(browser: Browser, base: str, *, names: tuple[str, str] | None = None, classic: bool = False, **view: Any) -> Iterator[Page]:
    owner = view.pop("player", None) or new_player(base)
    with visit(browser, base, "/play/local", owner, **view) as page:
        start = page.get_by_role("button", name="Start", exact=True)
        see(page, start, 'button "Start"')
        if classic:
            click(page.get_by_role("radio", name="Classic", exact=True))
        if names:
            fill(page.get_by_role("textbox", name="Player 1 name"), names[0])
            fill(page.get_by_role("textbox", name="Player 2 name"), names[1])
        click(start)
        aiming(page)
        yield page


def board_geometry(page: Page) -> tuple[float, float, float]:
    box = el(page, "board").bounding_box()
    assert box, "#board has no box"
    side = min(box["width"], box["height"])
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, side / BOARD_MM


def board_point(page: Page, x_mm: float, y_mm: float) -> tuple[float, float]:
    cx, cy, s = board_geometry(page)
    return cx + x_mm * s, cy + y_mm * s


def assert_board_in_view(page: Page, size: tuple[int, int]) -> dict:
    box = el(page, "board").bounding_box()
    assert box, "#board has no box"
    assert abs(box["width"] - box["height"]) <= GEOMETRY_SLACK_PX, f"#board is not square: {box}"
    assert box["x"] >= -GEOMETRY_SLACK_PX and box["y"] >= -GEOMETRY_SLACK_PX, f"board corner outside the viewport: {box}"
    assert box["x"] + box["width"] <= size[0] + GEOMETRY_SLACK_PX and box["y"] + box["height"] <= size[1] + GEOMETRY_SLACK_PX, f"board pockets fall outside {size}: {box}"
    return box


def rail_box(page: Page) -> dict:
    box = page.get_by_role("region", name="Score rail").bounding_box()
    assert box, 'region "Score rail" has no box'
    return box


def power_value(page: Page) -> int:
    m = re.search(r"Power (\d+)%", el(page, "power-readout").text_content() or "")
    assert m, "power readout missing"
    return int(m.group(1))


def assert_rail_in_view(page: Page) -> None:
    for ident in RAIL_IDS:
        loc = el(page, ident)
        see(page, loc, f"#{ident}")
        b = loc.bounding_box()
        assert b and b["x"] >= 0 and b["y"] >= 0 and b["x"] + b["width"] <= PHONE[0] and b["y"] + b["height"] <= PHONE[1], f"#{ident} outside 375x812: {b}"


def sample_box(s: dict) -> dict:
    return {"top": s.get("top", s.get("y", 0.0)), "width": s.get("w", s.get("width", 0.0)), "height": s.get("h", s.get("height", 0.0))}


def reversals(xs: list[float]) -> int:
    moves = [b - a for a, b in zip(xs, xs[1:]) if abs(b - a) > 0.05]
    return sum(1 for a, b in zip(moves, moves[1:]) if (a > 0) != (b > 0))


def shake_profile(page: Page) -> tuple[list[tuple[float, float, int]], list[tuple[float, int]]]:
    anims = page.evaluate(SHAKE_JS)
    spans = [(max(a["xs"]) - min(a["xs"]), a["end"], reversals(a["xs"])) for a in anims]
    frames = []
    for _ in range(SHAKE_SAMPLES):
        frames.append(page.evaluate(LEFTS_JS))
        advance(page, SHAKE_MS / SHAKE_SAMPLES)
    per_element = []
    if frames and frames[0]:
        for i in range(len(frames[0])):
            xs = [f[i] for f in frames if len(f) > i]
            per_element.append((max(xs) - min(xs), reversals(xs)))
    return spans, per_element


def miss_break(page: Page, line: str, wait_aim: bool = True) -> None:
    el(page, "board").focus()
    page.keyboard.press("w")
    page.keyboard.press("Space")
    see_text(page, el(page, "verdict-line"), line, f"#verdict-line {line!r}", step_ms=50)
    if wait_aim:
        aiming(page)


def history_row(page: Page, *words: str) -> Locator:
    row = page.get_by_role("list", name="Match history").get_by_role("listitem")
    for w in words:
        row = row.filter(has_text=w)
    return row


def wait_mail(mail: Any, email: str) -> dict:
    deadline = time.monotonic() + MAIL_WAIT_S
    for _ in range(MAX_POLLS):
        for m in mail.messages():
            if email.lower() in [a.lower() for a in addresses(m.get("To"))]:
                return m
        if time.monotonic() >= deadline:
            break
    pytest.fail(f"Mailpit never received a sign-in link for {email}")


def link_path(message: dict) -> str:
    m = re.search(r"Open this link to sign in: (\S+)/auth/link/(\S+)", mail_text(message))
    assert m, f"mail body lacks the published sign-in line: {mail_text(message)[:300]}"
    return f"/auth/link/{m.group(2)}"


def shot(seq: int, seat: int = 0, **over: Any) -> dict:
    body = {"shotSeq": seq, "x": 0.0, "dx": 0.0, "dy": -1.0 if seat == 0 else 1.0, "p": 0.2, "modelVersion": "dc-model-1"}
    body.update(over)
    return body


def win_quick(base: str, players: list[Player], mode: str = "casual") -> str:
    mid = new_match(base, players, mode=mode, pieces=far_pieces(["w1", "b1"]), queen={"state": "covered", "seat": 0})
    grading_shot(base, mid, 0, pocketed=("w1",), first="w1")
    return mid


def test_wf_guest_onboarding_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    name = fresh_name("W")
    with open_app(browser, base + "/") as page:
        see_url(page, re.escape(base) + r"/welcome(?:[?#].*)?$", "first visit to / lands on /welcome")
        cookies = {c["name"]: c for c in page.context.cookies()}
        assert "dc_session" in cookies and cookies["dc_session"]["httpOnly"], "dc_session cookie missing or not HttpOnly"
        see(page, page.get_by_role("heading", name="Pick a name"), 'heading "Pick a name"')
        assert page.request.get(base + "/api/me").json()["chosen"] is False
        fill(page.get_by_role("textbox", name="Name", exact=True), name)
        click(page.get_by_role("radio", name="Avatar 7", exact=True))
        click(page.get_by_role("button", name="Continue", exact=True))
        see_url(page, home_re(base), "Continue lands on /")
        see(page, page.get_by_role("link", name=f"{name} profile"), "profile link with the chosen name")
        page.reload()
        see(page, page.get_by_role("link", name=f"{name} profile"), "profile link after reload")
        body = page.request.get(base + "/api/me").json()
        assert body["name"] == name and body["avatar"] == 7 and body["chosen"] is True, body


def test_welcome_keyboard_only(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    name = fresh_name("K")
    with open_app(browser, base + "/welcome") as page:
        box = page.get_by_role("textbox", name="Name", exact=True)
        see(page, box, 'textbox "Name"')
        tab_to(page, box, 'textbox "Name"')
        page.keyboard.type(name)
        tab_to(page, page.get_by_role("radiogroup", name="Avatar"), 'radiogroup "Avatar"')
        press(page, "ArrowRight", 6)
        expect(page.get_by_role("radio", name="Avatar 7", exact=True)).to_be_checked(timeout=POLL_MS * 8)
        tab_to(page, box, 'textbox "Name"', key="Shift+Tab")
        page.keyboard.press("Enter")
        see_url(page, home_re(base), "Enter submits and lands on /")
        h1 = page.get_by_role("heading", level=1)
        eventually(page, lambda: expect(h1).to_be_focused(timeout=POLL_MS), "focus moves to the h1")
        body = page.request.get(base + "/api/me").json()
        assert body["name"] == name and body["avatar"] == 7


def test_wf_guest_onboarding_taken_name(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = new_player(base)
    asked = owner.name.upper()
    expected = [f"{asked[:13]}_{n:02d}" for n in (1, 2, 3)]
    with open_app(browser, base + "/welcome") as page:
        box = page.get_by_role("textbox", name="Name", exact=True)
        see(page, box, 'textbox "Name"')
        fill(box, asked)
        click(page.get_by_role("button", name="Continue", exact=True))
        err = el(page, "name-error")
        see_text(page, err, "That name is taken. Try one of these:", exact=False)
        expect(page.get_by_role("alert").filter(has_text="That name is taken. Try one of these:")).to_have_count(1)
        expect(err.get_by_role("button")).to_have_count(3)
        for s in expected:
            expect(err.get_by_role("button", name=s, exact=True)).to_have_count(1)
        first = err.get_by_role("button", name=expected[0], exact=True)
        tab_to(page, first, "first suggestion button")
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(box).to_have_value(expected[0], timeout=POLL_MS), "suggestion fills the name field")
        expect(box).to_be_focused()
        click(page.get_by_role("button", name="Continue", exact=True))
        see_url(page, home_re(base), "Continue with the suggestion lands on /")
        assert page.request.get(base + "/api/me").json()["name"] == expected[0]


def test_name_error_aria(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/welcome") as page:
        box = page.get_by_role("textbox", name="Name", exact=True)
        see(page, box, 'textbox "Name"')
        cases = [("ab", "Use 3 to 16 letters, numbers or underscores."), ("the_admin_x", "That name isn't allowed. Try one of these:")]
        for value, copy in cases:
            fill(box, value)
            click(page.get_by_role("button", name="Continue", exact=True))
            see_text(page, el(page, "name-error"), copy, exact=False)
            expect(page.get_by_role("alert").filter(has_text=copy)).to_have_count(1)
            expect(box).to_have_attribute("aria-invalid", "true")
            assert "name-error" in (box.get_attribute("aria-describedby") or "").split()
        expect(el(page, "name-error").get_by_role("button")).to_have_count(3)
        assert page.request.get(base + "/api/me").json()["chosen"] is False


def test_wf_guest_onboarding_phone_skip(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with visit(browser, base, "/welcome", size=PHONE, touch=True) as page:
        radios = [page.get_by_role("radio", name=f"Avatar {n}", exact=True) for n in range(1, 25)]
        see(page, radios[0], "avatar radios")

        def columns() -> int:
            boxes = [r.bounding_box() for r in radios]
            return sum(1 for b in boxes if b and abs(b["y"] - boxes[0]["y"]) <= GEOMETRY_SLACK_PX)
        for r in radios:
            b = r.bounding_box()
            assert b and b["width"] >= TARGET_PX and b["height"] >= TARGET_PX, f"avatar radio smaller than 44 px: {b}"
        assert columns() == 4, "avatars are not a 4-column grid at 375 px"
        layout(page)
        for size, cols in ((TABLET, 6), (DESKTOP, 8)):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            advance(page, STEP_MS)
            assert columns() == cols, f"avatars are not {cols} columns at {size}"
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        advance(page, STEP_MS)
        cdp_tap(page, page.get_by_role("button", name="Skip", exact=True))
        see_url(page, home_re(base), "Skip lands on /")
        body = page.request.get(base + "/api/me").json()
        assert re.fullmatch(r"Guest-\d{4}", body["name"]) and body["chosen"] is True, body
        see(page, page.get_by_role("link", name=f"{body['name']} profile"), "profile link with the Guest name")


NAME_CASES = ["valid_16", "short_2", "long_17", "bad_char", "taken_ignoring_case", "blocked"]


@pytest.mark.parametrize("case", NAME_CASES, ids=NAME_CASES)
def test_name_rules(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    c, start = guest(base)
    if case == "valid_16":
        name = (fresh_name("V") + "abcdefgh")[:16]
        r = c.post("/api/me/name", json={"name": name})
        assert r.status_code == 200 and r.json()["name"] == name and r.json()["chosen"] is True, r.text
        found = c.get(f"/api/players/by-name/{name.upper()}")
        assert found.status_code == 200 and found.json()["id"] == start["id"]
        return
    if case in ("short_2", "long_17", "bad_char"):
        name = {"short_2": "ab", "long_17": fresh_name("L") + "abcde", "bad_char": "bad-name!"}[case]
        r = c.post("/api/me/name", json={"name": name})
        assert r.status_code == 422 and r.json()["error"] == "NAME_INVALID", r.text
    elif case == "taken_ignoring_case":
        owner = new_player(base)
        new_player(base, name=owner.name + "_01")
        asked = owner.name.upper()
        r = c.post("/api/me/name", json={"name": asked})
        assert r.status_code == 409 and r.json()["error"] == "NAME_TAKEN", r.text
        assert r.json()["suggestions"] == [f"{asked}_02", f"{asked}_03", f"{asked}_04"], r.json()
    else:
        r = c.post("/api/me/name", json={"name": "xMODERATORx"})
        assert r.status_code == 422 and r.json()["error"] == "NAME_BLOCKED", r.text
        sug = r.json()["suggestions"]
        assert len(sug) == 3 and all(re.fullmatch(r"Player_\d{2}", s) for s in sug) and sug == sorted(sug), sug
        for s in sug:
            assert c.get(f"/api/players/by-name/{s}").status_code == 404, f"suggestion {s} is not free"
    after = c.get("/api/me").json()
    assert after["chosen"] is False and after["name"] == start["name"], "a refused name changed the player"


def test_keyboard_striker_placement(browser: Browser, app_url: str) -> None:
    with local_match(browser, app_url.rstrip("/")) as page:
        el(page, "board").focus()
        press(page, "ArrowRight", 10)
        press(page, "Shift+ArrowLeft", 4)
        striker = el(page, "piece-striker")
        see_text(page, el(page, "striker-readout"), "Striker 8.0 mm")
        expect(page.get_by_role("slider", name="Striker position")).to_have_attribute("aria-valuetext", "8.0 mm")
        expect(striker).to_have_attribute("data-x", "8.0")
        expect(striker).to_have_attribute("data-y", str(STRIKER_Y))
        press(page, "ArrowRight", 200)
        see_text(page, el(page, "striker-readout"), "Striker 200.0 mm")
        expect(striker).to_have_attribute("data-x", "200.0")
        expect(page.get_by_role("slider", name="Striker position")).to_have_attribute("aria-valuetext", "200.0 mm")


def test_keyboard_aim_and_guide(browser: Browser, app_url: str) -> None:
    with local_match(browser, app_url.rstrip("/")) as page:
        el(page, "board").focus()
        guide = el(page, "aim-guide")
        see_attr(page, guide, "data-first-contact", "w5")
        press(page, "d", 5)
        press(page, "Shift+A", 3)
        see_text(page, el(page, "aim-readout"), "Aim 4.7 degrees")
        expect(page.get_by_role("slider", name="Aim angle")).to_have_attribute("aria-valuetext", "4.7 degrees")
        press(page, "a", 5)
        press(page, "Shift+D", 3)
        see_text(page, el(page, "aim-readout"), "Aim 0.0 degrees")
        press(page, "ArrowLeft", 200)
        see_text(page, el(page, "striker-readout"), "Striker -200.0 mm")
        see_attr(page, guide, "data-first-contact", "cushion")


def test_keyboard_power_and_reset(browser: Browser, app_url: str) -> None:
    with local_match(browser, app_url.rstrip("/")) as page:
        el(page, "board").focus()
        shoot = page.get_by_role("button", name="Shoot", exact=True)
        press(page, "d", 3)
        press(page, "w", 10)
        see_text(page, el(page, "power-readout"), "Power 20%")
        expect(page.get_by_role("slider", name="Power")).to_have_attribute("aria-valuetext", "20%")
        expect(shoot).to_be_enabled()
        press(page, "s", 10)
        see_text(page, el(page, "power-readout"), "Power 0%")
        expect(shoot).to_be_disabled()
        press(page, "w", 5)
        el(page, "menu").focus()
        page.keyboard.press("w")
        see_text(page, el(page, "power-readout"), "Power 12%")
        page.keyboard.press("Escape")
        see_text(page, el(page, "aim-readout"), "Aim 0.0 degrees")
        see_text(page, el(page, "power-readout"), "Power 0%")
        expect(page.get_by_role("dialog", name="Menu")).to_have_count(0)


def test_wf_keyboard_aim_ghost(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, b_view={"skew": True}) as d:
        see_text(d.pa, el(d.pa, "turn-text"), "Your turn")
        see_text(d.pb, el(d.pb, "turn-text"), f"{d.a.name}'s turn")
        timer = d.pb.get_by_role("timer", name="Shot clock")
        see_text(d.pb, timer, re.compile(r"^0:(0[1-9]|1\d|20)$"), "shot clock shows the server's remaining time")
        for name in ("Striker position", "Aim angle", "Power"):
            expect(d.pb.get_by_role("slider", name=name)).to_be_disabled()
        expect(d.pb.get_by_role("button", name="Shoot", exact=True)).to_be_disabled()
        el(d.pa, "board").focus()
        press(d.pa, "ArrowRight", 10)
        ghost = el(d.pb, "ghost-striker")
        seen = False
        for _ in range(GHOST_MS // STEP_MS):
            advance(d.pa, STEP_MS)
            advance(d.pb, STEP_MS)
            try:
                expect(ghost).to_have_attribute("data-x", re.compile(r"^10(\.0+)?$"), timeout=POLL_MS)
                seen = True
                break
            except AssertionError:
                pass
        assert seen, "ghost striker did not follow to x=10.0 within 1 second of page time"
        st = el(d.pb, "ghost-striker").evaluate("e => { const c = getComputedStyle(e); return [c.opacity, c.fillOpacity]; }")
        assert any(abs(float(v) - 0.4) <= 0.05 for v in st if v), f"ghost striker is not 40 percent opaque: {st}"
        assert d.state()["shotSeq"] == 0


def test_wf_keyboard_aim_shot_ruled(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base) as d:
        for p in (d.pa, d.pb):
            p.evaluate(RECORDER_JS)
        el(d.pa, "board").focus()
        press(d.pa, "w", 10)
        d.pa.keyboard.press("Space")
        settled = re.compile(r"^(aim|board-over|match-over)$")
        for p in (d.pa, d.pb):
            see_attr(p, el(p, "match-root"), "data-shot-seq", "1", step_ms=50)
            see_attr(p, el(p, "match-root"), "data-phase", settled, step_ms=50)
        stored = client(base, d.a).post(f"/api/matches/{d.mid}/shots", json=shot(1))
        assert stored.status_code == 200, stored.text
        line = stored.json()["verdict"]["line"]
        phases = [e["phase"] for e in d.pa.evaluate("() => window.__dcRec.phases")]
        assert "refereeing" in phases, f"#match-root never showed refereeing: {phases}"
        for p in (d.pa, d.pb):
            see_announced(p, line)
            for e in p.evaluate("() => window.__dcRec.phases"):
                assert not (e["phase"] == "refereeing" and line in e["announcer"]), "verdict announced before the ruling"
        va, vb = pieces_on(d.pa), pieces_on(d.pb)
        assert va == vb, "the two pages disagree about piece positions"
        assert_board_equals(va, d.state()["pieces"])


SHOT_CASES = ["replay", "not_your_turn", "stale_seq", "invalid_intent", "client_outdated", "turn_expired", "preview_rate"]
INVALID_INTENTS = [{"x": 0.3}, {"x": 200.5}, {"dy": -1.002}, {"p": 1.5}, {"p": 0.2005}]


@pytest.mark.timeout(300)
@pytest.mark.parametrize("case", SHOT_CASES, ids=SHOT_CASES)
def test_shot_submission_rules(browser: Browser, app_url: str, case: str) -> None:
    if case == "turn_expired":
        base = outage(SHORT_ENV)
        with duel(browser, base) as d:
            ca = client(base, d.a)
            eventually(d.pa, lambda: (_ for _ in ()).throw(AssertionError("turn not passed")) if ca.get(f"/api/matches/{d.mid}").json()["turn"] != 1 else None,
                       "short-timer server passed the turn after the shot clock", seconds=LONG_WAIT_S)
            m = ca.get(f"/api/matches/{d.mid}").json()
            r = ca.post(f"/api/matches/{d.mid}/shots", json=shot(m["shotSeq"] + 1))
            assert r.status_code == 409 and r.json()["error"] == "TURN_EXPIRED", r.text
        return
    base = app_url.rstrip("/")
    a, b = new_player(base), new_player(base)
    mid = new_match(base, [a, b])
    ca, cb = client(base, a), client(base, b)
    url = f"/api/matches/{mid}/shots"
    if case == "replay":
        first = ca.post(url, json=shot(1))
        assert first.status_code == 200, first.text
        body = first.json()
        for key in ("shotSeq", "seat", "events", "verdict", "frames", "final", "match"):
            assert key in body, f"shot result lacks {key}"
        again = ca.post(url, json=shot(1, p=0.5))
        assert again.status_code == 200 and again.json() == body, "resent shotSeq did not return the stored result unchanged"
        assert ca.get(f"/api/matches/{mid}").json()["shotSeq"] == 1
        return
    if case == "not_your_turn":
        r = cb.post(url, json=shot(1, seat=1))
        assert r.status_code == 409 and r.json()["error"] == "NOT_YOUR_TURN", r.text
    elif case == "stale_seq":
        r = ca.post(url, json=shot(3))
        assert r.status_code == 409 and r.json()["error"] == "STALE_SEQ", r.text
    elif case == "invalid_intent":
        for over in INVALID_INTENTS:
            r = ca.post(url, json=shot(1, **over))
            assert r.status_code == 422 and r.json()["error"] == "INVALID_INTENT", f"{over}: {r.text}"
    elif case == "client_outdated":
        for c, seat in ((ca, 0), (cb, 1)):
            r = c.post(url, json=shot(1, seat=seat, modelVersion="dc-model-0"))
            assert r.status_code == 409 and r.json()["error"] == "CLIENT_OUTDATED", r.text
    else:
        barrier = threading.Barrier(PREVIEW_BURST)

        def send(_: int) -> httpx.Response:
            barrier.wait()
            return ca.post(f"/api/matches/{mid}/preview", json={"x": 0.0, "dx": 0.0, "dy": -1.0, "p": 0.1})
        with ThreadPoolExecutor(PREVIEW_BURST) as pool:
            rs = list(pool.map(send, range(PREVIEW_BURST)))
        ok = [r for r in rs if r.status_code == 204]
        limited = [r for r in rs if r.status_code == 429]
        assert 1 <= len(ok) <= PREVIEW_LIMIT and limited and all(r.json()["error"] == "RATE_LIMITED" for r in limited), [r.status_code for r in rs]
        return
    assert ca.get(f"/api/matches/{mid}").json()["shotSeq"] == 0, "a refused shot changed the match"


PHONE_VIEW = {"size": PHONE, "touch": True}


def test_wf_phone_aim_layout(browser: Browser, app_url: str) -> None:
    with solo(browser, app_url.rstrip("/"), view=PHONE_VIEW) as s:
        board = assert_board_in_view(s.page, PHONE)
        rail = rail_box(s.page)
        assert rail["y"] + rail["height"] <= board["y"] + GEOMETRY_SLACK_PX and rail["width"] > rail["height"], f"score rail is not a strip above the board: {rail}"
        sb = s.page.get_by_role("button", name="Shoot", exact=True).bounding_box()
        assert sb and sb["width"] >= TARGET_PX and sb["height"] >= TARGET_PX, sb
        layout(s.page)
        assert s.state()["status"] == "active"


def test_touch_drag_striker(browser: Browser, app_url: str) -> None:
    with local_match(browser, app_url.rstrip("/"), **PHONE_VIEW) as page:
        _, _, s = board_geometry(page)
        start = board_point(page, 0.0, STRIKER_Y)
        end = (start[0] + 60 * s, start[1])
        touch_at(page, "touchStart", *start)
        touch_path(page, start, end)
        touch_at(page, "touchEnd")
        striker = el(page, "piece-striker")
        eventually(page, lambda: expect(striker).to_have_attribute("data-x", re.compile(r"^\d"), timeout=POLL_MS), "striker moved")
        assert abs(float(striker.get_attribute("data-x")) - 60) <= DRAG_TOL_MM, striker.get_attribute("data-x")
        expect(striker).to_have_attribute("data-y", str(STRIKER_Y))
        expect(el(page, "match-root")).to_have_attribute("data-shot-seq", "0")


def test_fine_striker_slider(browser: Browser, app_url: str) -> None:
    with local_match(browser, app_url.rstrip("/"), **PHONE_VIEW) as page:
        slider = page.get_by_role("slider", name="Striker position")
        box = slider.bounding_box()
        assert box and box["height"] >= SLIDER_HANDLE_PX, f"striker slider handle smaller than 48 px: {box}"
        slider.focus()
        page.keyboard.press("ArrowRight")
        see_attr(page, el(page, "piece-striker"), "data-x", "0.5")
        expect(slider).to_have_attribute("aria-valuetext", "0.5 mm")


def test_wf_phone_aim_pullback_shot(browser: Browser, app_url: str) -> None:
    with solo(browser, app_url.rstrip("/"), view=PHONE_VIEW) as s:
        page = s.page
        _, _, scale = board_geometry(page)
        start = board_point(page, 0.0, -150.0)
        end = (start[0], start[1] + 0.5 * MAX_PULL_SHARE * BOARD_MM * scale)
        touch_at(page, "touchStart", *start)
        touch_path(page, start, end)
        eventually(page, lambda: expect(el(page, "power-readout")).to_have_text(re.compile(r"Power 2[456]%"), timeout=POLL_MS), "Power 25% within 1 point")
        expect(el(page, "aim-readout")).to_have_text("Aim 0.0 degrees")
        assert el(page, "aim-guide").evaluate("e => { const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0 && !e.hasAttribute('hidden'); }"), "#aim-guide not shown during the pull-back"
        touch_at(page, "touchEnd")
        eventually(page, lambda: (_ for _ in ()).throw(AssertionError("no shot")) if s.state()["shotSeq"] != 1 else None, "release sent the shot")


def test_wf_phone_aim_cancel(browser: Browser, app_url: str) -> None:
    with solo(browser, app_url.rstrip("/"), view=PHONE_VIEW) as s:
        page = s.page
        start = board_point(page, 0.0, -150.0)
        touch_at(page, "touchStart", *start)
        touch_path(page, start, (start[0], start[1] + 100))
        touch_path(page, (start[0], start[1] + 100), (start[0], start[1] + CANCEL_PX / 2))
        see_text(page, el(page, "power-readout"), "Power 0%")
        touch_at(page, "touchEnd")
        advance(page, GHOST_MS)
        expect(el(page, "match-root")).to_have_attribute("data-shot-seq", "0")
        expect(page.get_by_role("button", name="Shoot", exact=True)).to_be_disabled()
        assert s.state()["shotSeq"] == 0, "a cancelled pull-back sent a shot"


ILLEGAL_LAYOUT = [{"id": "w1", "x": 40.0, "y": 252.1, "state": "board", "pocketedBy": None},
                  {"id": "w2", "x": -100.0, "y": -100.0, "state": "board", "pocketedBy": None},
                  {"id": "b1", "x": 100.0, "y": -100.0, "state": "board", "pocketedBy": None},
                  {"id": "queen", "x": 0.0, "y": 0.0, "state": "board", "pocketedBy": None}]


def test_wf_illegal_placement_shown(browser: Browser, app_url: str) -> None:
    with solo(browser, app_url.rstrip("/"), pieces=ILLEGAL_LAYOUT) as s:
        page = s.page
        slider = page.get_by_role("slider", name="Striker position")
        striker = el(page, "piece-striker")
        slider.focus()
        press(page, "ArrowRight", 6)
        see_attr(page, striker, "data-x", "3.0")
        at_3 = decode(capture(el(page, "board")))
        page.keyboard.press("ArrowRight")
        see_attr(page, striker, "data-legal", "true")
        at_35 = decode(capture(el(page, "board")))
        page.keyboard.press("ArrowRight")
        see_attr(page, striker, "data-legal", "false")
        at_4 = decode(capture(el(page, "board")))
        assert difference(at_35, at_4) > difference(at_3, at_35), "entering the illegal spot did not visibly redraw the striker ring"
        press(page, "ArrowRight", 12)
        see_text(page, el(page, "striker-readout"), "Striker 10.0 mm")
        expect(striker).to_have_attribute("data-legal", "false")
        see_text(page, el(page, "placement-message"), "Striker overlaps a coin.")
        expect(page.get_by_role("button", name="Shoot", exact=True)).to_be_disabled()
        el(page, "board").focus()
        page.keyboard.press("w")
        page.keyboard.press("Space")
        advance(page, GHOST_MS)
        assert s.state()["shotSeq"] == 0, "an illegal placement was shot"


def test_wf_illegal_placement_keyboard(browser: Browser, app_url: str) -> None:
    with solo(browser, app_url.rstrip("/"), pieces=ILLEGAL_LAYOUT) as s:
        page = s.page
        striker = el(page, "piece-striker")
        shoot = page.get_by_role("button", name="Shoot", exact=True)
        el(page, "board").focus()
        page.keyboard.press("w")
        for k in range(1, 8):
            page.keyboard.press("Shift+ArrowRight")
            see_attr(page, striker, "data-x", f"{k * 0.5:.1f}")
            expect(striker).to_have_attribute("data-legal", "true")
        page.keyboard.press("Shift+ArrowRight")
        see_attr(page, striker, "data-legal", "false")
        expect(shoot).to_be_disabled()
        page.keyboard.press("Shift+ArrowLeft")
        see_attr(page, striker, "data-legal", "true")
        expect(shoot).to_be_enabled()
        page.keyboard.press("Space")
        eventually(page, lambda: (_ for _ in ()).throw(AssertionError("no shot")) if s.state()["shotSeq"] != 1 else None, "legal 3.5 placement was shot")


def test_illegal_placement_shake(browser: Browser, app_url: str) -> None:
    with solo(browser, app_url.rstrip("/"), pieces=ILLEGAL_LAYOUT) as s:
        page = s.page
        page.evaluate(FREEZE_JS)
        el(page, "board").focus()
        press(page, "Shift+ArrowRight", 8)
        spans, frames = shake_profile(page)
        ok = any(SHAKE_PX * 0.75 <= sp <= SHAKE_PX * 2.25 and end <= SHAKE_MS and rev >= 2 for sp, end, rev in spans)
        ok = ok or any(SHAKE_PX * 0.75 <= sp <= SHAKE_PX * 2.25 and rev >= 2 for sp, rev in frames)
        if not ok:
            page.keyboard.press("Shift+ArrowLeft")
            see_attr(page, el(page, "piece-striker"), "data-legal", "true")
            prev = decode(capture(el(page, "board")))
            page.keyboard.press("Shift+ArrowRight")
            changes = []
            steps = SHAKE_SAMPLES // 2
            for _ in range(steps):
                advance(page, SHAKE_MS / steps)
                cur = decode(capture(el(page, "board")))
                changes.append(difference(prev, cur))
                prev = cur
            ok = sum(1 for c in changes if c > 0) >= 3
        assert ok, f"no 4 px two-way shake within 120 ms; animations {spans}, frame spans {frames}"


def test_wf_illegal_placement_reduced_motion(browser: Browser, app_url: str) -> None:
    phrase = "Striker overlaps a coin."
    with solo(browser, app_url.rstrip("/"), pieces=ILLEGAL_LAYOUT, view={"reduced": True}) as s:
        page = s.page
        page.evaluate(FREEZE_JS)
        el(page, "board").focus()
        press(page, "Shift+ArrowRight", 8)
        eventually(page, lambda: (_ for _ in ()).throw(AssertionError(ann_text(page))) if ann_text(page).count(phrase) != 1 else None, "announced once on entry")
        spans, frames = shake_profile(page)
        assert all(sp < 1 for sp, _, _ in spans) and all(sp < 1 for sp, _ in frames), f"outline moved under reduced motion: {spans} {frames}"
        page.keyboard.press("Shift+ArrowRight")
        advance(page, STEP_MS * 3)
        assert ann_text(page).count(phrase) == 1, "moving within the illegal area announced again"
        press(page, "Shift+ArrowLeft", 2)
        see_attr(page, el(page, "piece-striker"), "data-legal", "true")
        page.keyboard.press("Shift+ArrowRight")
        eventually(page, lambda: (_ for _ in ()).throw(AssertionError(ann_text(page))) if ann_text(page).count(phrase) != 2 else None, "announced again on re-entry")


def test_wf_illegal_placement_phone(browser: Browser, app_url: str) -> None:
    with solo(browser, app_url.rstrip("/"), pieces=ILLEGAL_LAYOUT, view=PHONE_VIEW) as s:
        page = s.page
        page.get_by_role("slider", name="Striker position").focus()
        press(page, "ArrowRight", 20)
        see_text(page, el(page, "placement-message"), "Striker overlaps a coin.")
        expect(el(page, "piece-striker")).to_have_attribute("data-legal", "false")
        shoot = page.get_by_role("button", name="Shoot", exact=True)
        expect(shoot).to_be_disabled()
        cdp_tap(page, shoot)
        advance(page, GHOST_MS)
        expect(el(page, "match-root")).to_have_attribute("data-shot-seq", "0")
        assert s.state()["shotSeq"] == 0


PLACEMENT_CASES = ["coin_at_exactly_36_15", "coin_at_36_1", "queen_at_36_0"]


@pytest.mark.parametrize("case", PLACEMENT_CASES, ids=PLACEMENT_CASES)
def test_placement_on_server(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    a, b = new_player(base), new_player(base)
    w1 = {"coin_at_exactly_36_15": (36.15, 252.1), "coin_at_36_1": (36.1, 252.1), "queen_at_36_0": (-100.0, -150.0)}[case]
    queen = (0.0, 216.1) if case == "queen_at_36_0" else (0.0, 0.0)
    pieces = [{"id": "w1", "x": w1[0], "y": w1[1], "state": "board", "pocketedBy": None},
              {"id": "b1", "x": 100.0, "y": -100.0, "state": "board", "pocketedBy": None},
              {"id": "queen", "x": queen[0], "y": queen[1], "state": "board", "pocketedBy": None}]
    mid = new_match(base, [a, b], pieces=pieces)
    r = client(base, a).post(f"/api/matches/{mid}/shots", json=shot(1, dx=-1.0, dy=0.0))
    if case == "coin_at_exactly_36_15":
        assert r.status_code == 200, f"exactly 36.15 mm must be legal: {r.text}"
    else:
        assert r.status_code == 422 and r.json()["error"] == "ILLEGAL_PLACEMENT", r.text
        assert match_json(base, a, mid)["shotSeq"] == 0


def test_local_setup_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p1, p2 = fresh_name("A"), fresh_name("B")
    with visit(browser, base, "/play/local", new_player(base)) as page:
        group = page.get_by_role("radiogroup", name="Format")
        see(page, group, 'radiogroup "Format"')
        tab_to(page, group, 'radiogroup "Format"')
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("radio", name="Classic", exact=True)).to_be_checked()
        for label, value in (("Player 1 name", p1), ("Player 2 name", p2)):
            tab_to(page, page.get_by_role("textbox", name=label), label)
            page.keyboard.press("ControlOrMeta+A")
            page.keyboard.type(value)
        switch = page.get_by_role("switch", name="Turn the board each turn")
        tab_to(page, switch, "board-turning switch")
        page.keyboard.press("Space")
        expect(switch).to_be_checked(checked=False)
        page.keyboard.press("Space")
        expect(switch).to_be_checked()
        tab_to(page, page.get_by_role("button", name="Start", exact=True), 'button "Start"')
        page.keyboard.press("Enter")
        see_text(page, el(page, "turn-text"), f"{p1}'s turn")
        expect(el(page, "board-rotator")).to_have_attribute("data-rotation", "0")
        expect(el(page, "board-label")).to_have_text("Board 1 of 8")


def test_wf_local_play_break_misses(browser: Browser, app_url: str) -> None:
    p1, p2 = fresh_name("A"), fresh_name("B")
    with local_match(browser, app_url.rstrip("/"), names=(p1, p2), size=PHONE) as page:
        expect(el(page, "break-label")).to_have_text("Break attempt 1 of 3")
        board = assert_board_in_view(page, PHONE)
        assert rail_box(page)["y"] + rail_box(page)["height"] <= board["y"] + GEOMETRY_SLACK_PX
        miss_break(page, "Break missed. Attempt 2 of 3.")
        expect(el(page, "break-label")).to_have_text("Break attempt 2 of 3")
        miss_break(page, "Break missed. Attempt 3 of 3.")
        miss_break(page, "Break missed 3 times. Turn passes.")
        see_text(page, el(page, "turn-text"), f"{p2}'s turn")
        expect(el(page, "break-label")).to_have_text("")


def rotation_samples(page: Page) -> list[dict]:
    out = []
    for _ in range(int(ROTATE_SAMPLE_MS / FINE_STEP_MS)):
        out.append(page.evaluate(ROTATION_JS))
        advance(page, FINE_STEP_MS)
    return out


def test_wf_local_play_board_turn(browser: Browser, app_url: str) -> None:
    with local_match(browser, app_url.rstrip("/")) as page:
        miss_break(page, "Break missed. Attempt 2 of 3.")
        miss_break(page, "Break missed. Attempt 3 of 3.")
        page.evaluate(ROTATOR_WATCH_JS)
        el(page, "board").focus()
        page.keyboard.press("w")
        page.keyboard.press("Space")
        samples = rotation_samples(page)
        records = page.evaluate("() => window.__dcRot")
        between = any(s and INBETWEEN_MIN_DEG < abs(s["deg"]) < INBETWEEN_MAX_DEG for s in samples)
        animated = any(any(p in ("transform", "rotate") for p in r["props"]) and ROTATE_MIN_MS <= r["duration"] <= ROTATE_MAX_MS for r in records)
        assert between or animated, f"board turned without in-between angles over about 500 ms; records {records}"
        see_attr(page, el(page, "board-rotator"), "data-rotation", "180")


def test_wf_local_play_reduced_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with local_match(browser, base, reduced=True) as page:
        miss_break(page, "Break missed. Attempt 2 of 3.")
        miss_break(page, "Break missed. Attempt 3 of 3.")
        el(page, "board").focus()
        page.keyboard.press("w")
        page.keyboard.press("Space")
        samples = rotation_samples(page)
        assert not any(s and INBETWEEN_MIN_DEG < abs(s["deg"]) < INBETWEEN_MAX_DEG for s in samples), "reduced motion showed an in-between board angle"
        see_attr(page, el(page, "board-rotator"), "data-rotation", "180")
    with solo(browser, base) as s:
        page = s.page
        el(page, "board").focus()
        press(page, "w", 50)
        page.keyboard.press("Space")
        see_attr(page, el(page, "match-root"), "data-phase", "moving", step_ms=FINE_STEP_MS)
        expect(page.get_by_role("button", name="Skip shot")).to_be_visible()
        page.keyboard.press("k")
        advance(page, SKIP_CHECK_MS)
        assert_board_equals(pieces_on(page), s.state()["pieces"], skip=("striker",))


def test_wf_local_play_resign_saved(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner = new_player(base)
    p1, p2 = fresh_name("A"), fresh_name("B")
    with local_match(browser, base, names=(p1, p2), player=owner) as page:
        menu = el(page, "menu")
        resign_dialog = page.get_by_role("dialog", name="Resign this match?")

        def open_resign() -> None:
            tab_to(page, menu, "Menu button")
            page.keyboard.press("Enter")
            dlg = page.get_by_role("dialog", name="Menu")
            see(page, dlg, 'dialog "Menu"')
            tab_to(page, dlg.get_by_role("button", name="Resign", exact=True), "Resign in the menu")
            page.keyboard.press("Enter")
            see(page, resign_dialog, 'dialog "Resign this match?"')
        open_resign()
        assert_focus_trapped(page, resign_dialog, 'dialog "Resign this match?"')
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(resign_dialog).to_have_count(0, timeout=POLL_MS), "Escape closes the resign dialog")
        eventually(page, lambda: expect(menu).to_be_focused(timeout=POLL_MS), "focus returns to Menu")
        expect(el(page, "match-root")).to_have_attribute("data-phase", "aim")
        open_resign()
        tab_to(page, resign_dialog.get_by_role("button", name="Resign", exact=True), "Resign confirm")
        page.keyboard.press("Enter")
        over = page.get_by_role("dialog", name="Match over")
        see(page, over, 'dialog "Match over"')
        expect(over.get_by_role("heading", name=f"{p2} wins")).to_be_visible()
        see_text(page, el(page, "save-status"), "Saved to your history.")
        expect(el(page, "end-reason")).to_have_text(f"{p1} resigned")
        rows = [m for m in history(base, owner) if m["mode"] == "local"]
        assert len(rows) == 1 and rows[0]["opponent"] == p2 and rows[0]["result"] == "lost" and rows[0]["endReason"] == "resigned", rows
        page.goto(f"{base}/profile/{owner.name}")
        page.reload()
        see(page, history_row(page, "Pass and play", f"vs {p2}"), "Pass and play history row")


LOCAL_CASES = ["resign_without_shots", "resign_after_breaks", "wrong_winner", "wrong_scores", "out_of_turn", "unfinished_log", "repeated_key", "key_conflict", "client_outdated"]
MISS = {"seat": 0, "x": 0.0, "dx": 0.0, "dy": -1.0, "p": 0.02}


@pytest.mark.parametrize("case", LOCAL_CASES, ids=LOCAL_CASES)
def test_local_match_replay(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    c, me = guest(base)
    p2 = fresh_name("M")
    body = {"format": "quick", "players": [{"name": fresh_name("L")}, {"name": p2}], "shots": [], "resignedSeat": 0,
            "claimed": {"winnerSeat": 1, "scores": [0, 0]}, "modelVersion": "dc-model-1", "idempotencyKey": idempotency_key()}
    misses = [dict(MISS) for _ in range(3)]
    variants = {
        "resign_after_breaks": {"shots": misses, "resignedSeat": 1, "claimed": {"winnerSeat": 0, "scores": [0, 0]}},
        "wrong_winner": {"claimed": {"winnerSeat": 0, "scores": [0, 0]}},
        "wrong_scores": {"claimed": {"winnerSeat": 1, "scores": [0, 5]}},
        "out_of_turn": {"shots": misses + [dict(MISS)], "resignedSeat": 1, "claimed": {"winnerSeat": 0, "scores": [0, 0]}},
        "unfinished_log": {"shots": [dict(MISS)], "resignedSeat": None, "claimed": {"winnerSeat": 0, "scores": [0, 0]}},
        "client_outdated": {"modelVersion": "dc-model-0"},
    }
    body.update(variants.get(case, {}))
    url = "/api/local-matches"
    r = c.post(url, json=body)
    if case in ("wrong_winner", "wrong_scores", "out_of_turn", "unfinished_log"):
        assert r.status_code == 422 and r.json()["error"] == "RESULT_MISMATCH", r.text
        assert not [m for m in c.get(f"/api/players/{me['id']}/history").json()["matches"]], "a mismatched result was recorded"
        return
    if case == "client_outdated":
        assert r.status_code == 409 and r.json()["error"] == "CLIENT_OUTDATED", r.text
        return
    assert r.status_code == 201, r.text
    mid = r.json()["matchId"]
    if case == "repeated_key":
        again = c.post(url, json=body)
        assert again.status_code == 201 and again.json() == r.json(), "repeated key did not return the stored response"
    if case == "key_conflict":
        other = dict(body, players=[{"name": fresh_name("L")}, {"name": fresh_name("M")}])
        clash = c.post(url, json=other)
        assert clash.status_code == 409 and clash.json()["error"] == "IDEMPOTENCY_CONFLICT", clash.text
    rows = [m for m in c.get(f"/api/players/{me['id']}/history").json()["matches"] if m["matchId"] == mid]
    assert len(rows) == 1 and rows[0]["mode"] == "local" and rows[0]["opponent"] == p2, rows
    assert rows[0]["result"] == ("won" if body["resignedSeat"] == 1 else "lost")


def test_wf_queen_rules_early_return(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, a_view={"skew": True}) as d:
        see_text(d.pa, d.pa.get_by_role("timer", name="Shot clock"), re.compile(r"^0:(0[1-9]|1\d|20)$"), "shot clock from server time")
        grading_shot(base, d.mid, 0, pocketed=("queen",), first="queen")
        for p in (d.pa, d.pb):
            see_verdict(p, "RETURNED", "Queen returned. Pocket one of your own coins first.")
            see_attr(p, el(p, "piece-queen"), "data-x", "0.0")
            expect(el(p, "piece-queen")).to_have_attribute("data-y", "0.0")
        see_text(d.pb, el(d.pb, "turn-text"), "Your turn")
        m = d.state()
        assert m["turn"] == 1 and m["queen"]["state"] == "board", m["queen"]


def test_wf_queen_rules_awaiting_cover(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, pieces=layout_pieces(without=("w1", "w2"))) as d:
        grading_shot(base, d.mid, 0, pocketed=("queen",), first="queen")
        for p in (d.pa, d.pb):
            see_verdict(p, "POCKETED", "Queen pocketed. Cover her with your next pocket.")
            see_text(p, el(p, "queen-status"), f"Awaiting cover by {d.a.name}")
        see_text(d.pa, el(d.pa, "turn-text"), "Your turn")
        m = d.state()
        assert m["turn"] == 0 and m["queen"] == {"state": "pending", "seat": 0}, m["queen"]


def test_wf_queen_rules_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, a_view=PHONE_VIEW, pieces=layout_pieces(without=("w1", "w2"))) as d:
        grading_shot(base, d.mid, 0, pocketed=("queen",), first="queen")
        see_verdict(d.pa, "POCKETED", "Queen pocketed. Cover her with your next pocket.")
        see_text(d.pa, el(d.pa, "queen-status"), f"Awaiting cover by {d.a.name}")
        for loc in (el(d.pa, "verdict"), el(d.pa, "queen-status")):
            b = loc.bounding_box()
            assert b and b["x"] >= 0 and b["y"] >= 0 and b["x"] + b["width"] <= PHONE[0] and b["y"] + b["height"] <= PHONE[1], b
        layout(d.pa)


def test_wf_queen_rules_not_covered(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    line = "Queen not covered. She returns to the centre."
    with duel(browser, base, pieces=layout_pieces(without=("w1", "w2"))) as d:
        grading_shot(base, d.mid, 0, pocketed=("queen",), first="queen")
        see_verdict(d.pa, "POCKETED", "Queen pocketed. Cover her with your next pocket.")
        aiming(d.pa)
        grading_shot(base, d.mid, 0, first="w5")
        see_verdict(d.pa, "RETURNED", line)
        see_announced(d.pb, line)
        for p in (d.pa, d.pb):
            see_attr(p, el(p, "piece-queen"), "data-x", "0.0")
            see_text(p, el(p, "queen-status"), "On the board")
        see_text(d.pb, el(d.pb, "turn-text"), "Your turn")
        m = d.state()
        assert m["turn"] == 1 and m["queen"]["state"] == "board"


COVER_CASES = ["cover_shot", "same_shot"]


@pytest.mark.parametrize("case", COVER_CASES, ids=COVER_CASES)
def test_queen_covered(browser: Browser, app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, pieces=layout_pieces(without=("w1", "w2"))) as d:
        if case == "cover_shot":
            grading_shot(base, d.mid, 0, pocketed=("queen",), first="queen")
            see_verdict(d.pa, "POCKETED", "Queen pocketed. Cover her with your next pocket.")
            aiming(d.pa)
            grading_shot(base, d.mid, 0, pocketed=("w5",))
        else:
            grading_shot(base, d.mid, 0, pocketed=("queen", "w5"), first="queen")
        for p in (d.pa, d.pb):
            see_verdict(p, "COVERED", "Queen covered.")
            see_text(p, el(p, "queen-status"), f"Covered by {d.a.name}")
        m = d.state()
        assert m["queen"] == {"state": "covered", "seat": 0} and m["turn"] == 0, m


def test_verdict_word_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, b_view={"reduced": True}) as d:
        word = el(d.pa, "verdict-word")
        assert word.count() == 0 or not (word.text_content() or "").strip(), "verdict word shown before any ruling"
        d.pa.evaluate(FREEZE_JS)
        grading_shot(base, d.mid, 0, first="w5")
        see_text(d.pa, word, "NO POCKET", step_ms=FINE_STEP_MS)
        see(d.pa, word, "verdict word shown once the pieces stop", step_ms=FINE_STEP_MS)
        path = motion(word, VERDICT_WORD_MS)
        widths = [sample_box(s)["width"] for s in path]
        assert widths and widths[0] < 0.9 * widths[-1], f"verdict word did not scale up into place: {widths}"
        rw = el(d.pb, "verdict-word")
        see_text(d.pb, rw, "NO POCKET", step_ms=FINE_STEP_MS)
        see(d.pb, rw, "reduced-motion verdict word shown", step_ms=FINE_STEP_MS)
        w0 = rw.bounding_box()["width"]
        advance(d.pb, VERDICT_WORD_MS + STEP_MS)
        assert abs(rw.bounding_box()["width"] - w0) <= 0.02 * w0, "reduced-motion verdict word was not at full size at once"
        for p in (d.pa, d.pb):
            see_announced(p, "Nothing pocketed. Turn passes.")


def test_wf_fouls_and_dues_owed(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    line = "Foul: striker pocketed. One due coin is owed."
    with duel(browser, base) as d:
        grading_shot(base, d.mid, 0, striker=True)
        for p in (d.pa, d.pb):
            see_verdict(p, "FOUL", line)
            see_text(p, el(p, "dues-0"), "Dues owed: 1")
            see_announced(p, line)
        see_text(d.pb, el(d.pb, "turn-text"), "Your turn")
        m = d.state()
        assert m["seats"][0]["dues"] == 1 and m["turn"] == 1


def test_wf_fouls_and_dues_paid(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    spot = spots_for(["w5"], {k: v for k, v in OPENING.items() if k != "w5"})["w5"]
    with duel(browser, base, dues=[1, 0]) as d:
        grading_shot(base, d.mid, 0, pocketed=("w5",))
        see_verdict(d.pa, "POCKETED", "Due paid: one coin returns to the centre. Shoot again.")
        see_text(d.pa, el(d.pa, "dues-0"), "Dues owed: 0")
        v = pieces_on(d.pa)["w5"]
        assert near(float(v["x"]), spot[0]) and near(float(v["y"]), spot[1]), f"w5 at {v}, expected {spot}"
        m = d.state()
        w5 = piece(m, "w5")
        assert m["seats"][0]["dues"] == 0 and m["turn"] == 0 and near(w5["x"], spot[0]) and near(w5["y"], spot[1])


def test_wf_fouls_and_dues_own_coins(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    board = {k: v for k, v in OPENING.items() if k not in ("w1", "w5")}
    spots = spots_for(["w1", "w5"], board)
    with duel(browser, base, pieces=layout_pieces(without=("w1",))) as d:
        grading_shot(base, d.mid, 0, pocketed=("w5",), striker=True)
        see_verdict(d.pa, "FOUL", "Foul: striker pocketed. Your pocketed coins return with one due coin. Shoot again.")
        see_text(d.pa, el(d.pa, "turn-text"), "Your turn")
        m = d.state()
        assert m["turn"] == 0
        vals = pieces_on(d.pa)
        for pid, (x, y) in spots.items():
            assert near(piece(m, pid)["x"], x) and near(piece(m, pid)["y"], y), f"{pid} not on its return spot"
            assert near(float(vals[pid]["x"]), x) and near(float(vals[pid]["y"]), y)


def test_verdict_banner_timing(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    banner_ms = httpx.get(base + "/api/config", timeout=HTTP_TIMEOUT).json()["verdictBannerMs"]
    with duel(browser, base) as d:
        pa = d.pa
        on = lambda: (_ for _ in ()).throw(AssertionError("banner hidden")) if not shown(pa, "verdict") else None
        off = lambda: (_ for _ in ()).throw(AssertionError("banner shown")) if shown(pa, "verdict") else None
        grading_shot(base, d.mid, 0, first="w5")
        see_text(pa, el(pa, "verdict-line"), "Nothing pocketed. Turn passes.", step_ms=FINE_STEP_MS)
        eventually(pa, on, "verdict banner slides in", step_ms=FINE_STEP_MS)
        t1 = page_now(pa)
        advance(pa, banner_ms - BANNER_MARGIN_MS)
        on()
        eventually(pa, off, "verdict banner leaves after the banner time")
        assert page_now(pa) - t1 <= banner_ms + BANNER_HIDE_SLACK_MS
        aiming(pa)
        grading_shot(base, d.mid, 1, pocketed=("b5",), first="b5")
        see_text(pa, el(pa, "verdict-line"), "1 coin pocketed. Shoot again.", step_ms=FINE_STEP_MS)
        t2 = page_now(pa)
        advance(pa, banner_ms - BANNER_EARLY_MS)
        grading_shot(base, d.mid, 1, pocketed=("b6", "b7"), first="b6")
        see_text(pa, el(pa, "verdict-line"), "2 coins pocketed. Shoot again.", step_ms=FINE_STEP_MS)
        t3 = page_now(pa)
        advance(pa, t3 + banner_ms - BANNER_MARGIN_MS - page_now(pa))
        assert page_now(pa) > t2 + banner_ms
        on()


def test_wf_fouls_and_dues_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    line = "Foul: striker pocketed. One due coin is owed."
    with duel(browser, base, a_view=PHONE_VIEW) as d:
        grading_shot(base, d.mid, 0, striker=True)
        see_verdict(d.pa, "FOUL", line)
        see_announced(d.pa, line)
        for loc in (el(d.pa, "verdict"), el(d.pa, "dues-0")):
            b = loc.bounding_box()
            assert b and b["x"] >= 0 and b["y"] >= 0 and b["x"] + b["width"] <= PHONE[0] and b["y"] + b["height"] <= PHONE[1], b
        expect(el(d.pa, "dues-0")).to_have_text("Dues owed: 1")
        assert d.state()["seats"][0]["dues"] == 1


RETURN_CASES = ["queen_first", "coins_in_id_order"]


@pytest.mark.parametrize("case", RETURN_CASES, ids=RETURN_CASES)
def test_return_spots(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    a, b = new_player(base), new_player(base)
    if case == "queen_first":
        moved = {k: (x + SHIFT_MM, y) for k, (x, y) in OPENING.items()}
        mid = new_match(base, [a, b], pieces=layout_pieces(without=("w1",), moved=moved))
        board = {k: v for k, v in moved.items() if k not in ("w1", "queen")}
        expected = spots_for(["queen", "w1"], board)
        res = grading_shot(base, mid, 0, pocketed=("queen",), first="queen", striker=True)
        assert res["verdict"]["line"] == "Foul: striker pocketed. One due coin returns to the centre."
    else:
        mid = new_match(base, [a, b], pieces=layout_pieces(without=("w1",)))
        board = {k: v for k, v in OPENING.items() if k not in ("w1", "w5", "w9")}
        expected = spots_for(["w1", "w5", "w9"], board)
        res = grading_shot(base, mid, 0, pocketed=("w5", "w9"), striker=True)
        assert res["verdict"]["line"] == "Foul: striker pocketed. Your pocketed coins return with one due coin. Shoot again."
    final = {p["id"]: p for p in res["final"]}
    m = match_json(base, a, mid)
    for pid, (x, y) in expected.items():
        for src in (final[pid], piece(m, pid)):
            assert src["state"] == "board" and near(src["x"], x) and near(src["y"], y), f"{pid} at {src}, expected ({x:.1f}, {y:.1f})"


def board_win(scores: list[int], board: int = 3) -> dict:
    return {"format": "classic", "board": board, "scores": scores, "white": 0, "turn": 0,
            "pieces": far_pieces(["w1", "b1", "b2", "b3", "b4"]), "queen": {"state": "covered", "seat": 0}}


def test_wf_classic_scoring_board_won(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, **board_win([10, 4])) as d:
        grading_shot(base, d.mid, 0, pocketed=("w1",), first="w1")
        sheet = d.pa.get_by_role("dialog", name="Board over")
        see(d.pa, sheet, 'dialog "Board over"')
        expect(sheet.get_by_role("heading", name=f"{d.a.name} wins board 3")).to_be_visible()
        expect(el(d.pa, "board-points")).to_have_text("7 points: 4 coins left + 3 for the queen")
        for p in (d.pa, d.pb):
            see_text(p, el(p, "score-0"), "17")
        see_announced(d.pa, f"{d.a.name} wins board 3. 7 points: 4 coins left + 3 for the queen")
        m = d.state()
        assert m["seats"][0]["score"] == 17 and m["board"] == 4


def test_queen_points_stop_at_22(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with solo(browser, base, **board_win([22, 4])) as s:
        grading_shot(base, s.mid, 0, pocketed=("w1",), first="w1")
        see_text(s.page, el(s.page, "board-points"), "4 points: 4 coins left")
        assert s.state()["seats"][0]["score"] == 26


def test_wf_classic_scoring_next_board(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, **board_win([10, 4])) as d:
        grading_shot(base, d.mid, 0, pocketed=("w1",), first="w1")
        sheet = d.pa.get_by_role("dialog", name="Board over")
        see(d.pa, sheet, 'dialog "Board over"')
        tab_to(d.pa, sheet.get_by_role("button", name="Next board"), 'button "Next board"')
        d.pa.keyboard.press("Enter")
        eventually(d.pa, lambda: expect(sheet).to_have_count(0, timeout=POLL_MS), "Board over sheet closes")
        eventually(d.pa, lambda: expect(el(d.pa, "board")).to_be_focused(timeout=POLL_MS), "focus returns to #board")
        see_text(d.pa, el(d.pa, "board-label"), "Board 4 of 8")
        see_text(d.pa, el(d.pa, "turn-text"), f"{d.b.name}'s turn")
        expect(el(d.pa, "break-label")).to_have_text("Break attempt 1 of 3")
        vals = pieces_on(d.pa)
        for pid, (x, y) in OPENING.items():
            assert near(float(vals[pid]["x"]), x) and near(float(vals[pid]["y"]), y), f"{pid} not at its opening spot"
        m = d.state()
        assert m["board"] == 4 and m["turn"] == 1 and m["seats"][1]["color"] == "white" and m["breakAttempt"] == 1


def test_wf_classic_scoring_match_over(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, **board_win([24, 4])) as d:
        d.pa.evaluate(RECORDER_JS)
        grading_shot(base, d.mid, 0, pocketed=("w1",), first="w1")
        over = d.pa.get_by_role("dialog", name="Match over")
        see(d.pa, over, 'dialog "Match over"')
        expect(el(d.pa, "match-root")).to_have_attribute("data-phase", "match-over")
        expect(over.get_by_role("heading", name="You won")).to_be_visible()
        expect(el(d.pa, "final-score")).to_have_text("Final score 28-4")
        expect(el(d.pa, "board-points")).to_have_text("4 points: 4 coins left")
        eventually(d.pa, lambda: (_ for _ in ()).throw(AssertionError("focus outside")) if not over.evaluate("e => e.contains(document.activeElement)") else None, "focus inside Match over")
        assert_focus_trapped(d.pa, over, 'dialog "Match over"')
        d.pa.keyboard.press("Escape")
        expect(over).to_be_visible()
        assert d.pa.get_by_role("dialog", name="Board over").count() == 0
        assert "board-over" not in [e["phase"] for e in d.pa.evaluate("() => window.__dcRec.phases")]
        m = d.state()
        assert m["status"] == "completed" and m["winnerSeat"] == 0 and m["endReason"] == "played"


def test_wf_classic_scoring_history(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    a, b = new_player(base), new_player(base)
    mid = new_match(base, [a, b], **board_win([24, 4]))
    grading_shot(base, mid, 0, pocketed=("w1",), first="w1")
    rows = [m for m in history(base, a) if m["matchId"] == mid]
    assert rows and rows[0]["result"] == "won" and rows[0]["format"] == "classic" and (rows[0]["yourScore"], rows[0]["theirScore"]) == (28, 4)
    live = new_match(base, [a, b])
    with visit(browser, base, f"/profile/{a.name}", a) as page:
        page.reload()
        see(page, history_row(page, "WON", "Classic", "28-4", f"vs {b.name}"), "WON Classic 28-4 row")
        for size in (TABLET, DESKTOP):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.goto(f"{base}/match/{live}")
            aiming(page)
            board, rail = el(page, "board").bounding_box(), rail_box(page)
            if size == TABLET:
                assert rail["y"] >= board["y"] + board["height"] - GEOMETRY_SLACK_PX, f"rail not below the board at 768: {rail} {board}"
            else:
                assert rail["x"] >= board["x"] + board["width"] - GEOMETRY_SLACK_PX, f"rail not right of the board at 1280: {rail} {board}"


LAST_COIN_CASES = ["opponent_last_coin", "own_last_uncovered", "extra_board"]


@pytest.mark.parametrize("case", LAST_COIN_CASES, ids=LAST_COIN_CASES)
def test_last_coin_rules(browser: Browser, app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    a, b = new_player(base), new_player(base)
    if case == "opponent_last_coin":
        mid = new_match(base, [a, b], format="classic", pieces=far_pieces(["w1", "w2", "w3", "w4", "w5", "b1"], queen="board"))
        grading_shot(base, mid, 0, pocketed=("b1",), first="b1")
        m = match_json(base, a, mid)
        assert (m["seats"][0]["score"], m["seats"][1]["score"]) == (0, 8), m["seats"]
    elif case == "own_last_uncovered":
        mid = new_match(base, [a, b], format="classic", pieces=far_pieces(["w1", "b1", "b2", "b3"], queen="board"))
        grading_shot(base, mid, 0, pocketed=("w1",), first="w1")
        m = match_json(base, a, mid)
        assert (m["seats"][0]["score"], m["seats"][1]["score"]) == (0, 3), m["seats"]
    else:
        mid = new_match(base, [a, b], format="classic", board=8, scores=[6, 10], pieces=far_pieces(["w1", "b1"]), queen={"state": "covered", "seat": 0})
        grading_shot(base, mid, 0, pocketed=("w1",), first="w1")
        m = match_json(base, a, mid)
        assert m["board"] == 9 and m["status"] == "active" and m["turn"] == 1 and m["seats"][1]["color"] == "white", m
        with visit(browser, base, f"/match/{mid}", a) as page:
            see_text(page, el(page, "board-label"), "Extra board")
        return
    assert m["board"] == 2 and m["turn"] == 0 and m["seats"][0]["color"] == "white"


def create_room(base: str, host: Player) -> str:
    r = client(base, host).post("/api/rooms", json={"format": "quick"})
    assert r.status_code == 201, r.text
    return r.json()["code"]


def enabled_ready(page: Page) -> Locator:
    for b in page.get_by_role("button", name="Ready", exact=True).all():
        if b.is_enabled():
            return b
    pytest.fail("no enabled Ready button for the viewer's seat")


def test_wf_private_room_create(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    host = new_player(base)
    with visit(browser, base, "/", host, size=PHONE, touch=True, skew=True) as page:
        create = page.get_by_role("button", name="Create a room", exact=True)
        see(page, create, 'button "Create a room"')
        cdp_tap(page, create)
        dlg = page.get_by_role("dialog", name="Create a room")
        see(page, dlg, 'dialog "Create a room"')
        expect(dlg.get_by_role("radio", name="Quick", exact=True)).to_be_checked()
        cdp_tap(page, dlg.get_by_role("button", name="Create", exact=True))
        see_url(page, re.escape(base) + rf"/room/[{ROOM_ALPHABET}]{{6}}$", "host reaches /room/<code>")
        code = page.url.rstrip("/").split("/")[-1]
        see_text(page, el(page, "room-code"), code)
        expect(page.get_by_role("heading", name=f"Room {code}")).to_be_visible()
        expect(el(page, "room-link")).to_have_text(re.compile(rf"^https?://\S+/join/{code}$"))
        expect(page.get_by_text("Waiting for opponent...")).to_be_visible()
        room = client(base, host).get(f"/api/rooms/{code}").json()
        assert room["status"] == "open" and room["host"]["id"] == host.id and room["format"] == "quick"

        def seconds() -> int:
            m = re.fullmatch(r"Closes in (\d+):(\d\d)", (el(page, "room-expiry").text_content() or "").strip())
            assert m, el(page, "room-expiry").text_content()
            return int(m.group(1)) * 60 + int(m.group(2))
        eventually(page, seconds, "#room-expiry shows Closes in m:ss")
        shown_s = seconds()
        assert abs(shown_s - math.ceil(room["expiresInMs"] / 1000)) <= COUNTDOWN_SLACK_S, f"countdown {shown_s}s ignores server time {room['expiresInMs']}ms"
        advance(page, 3000)
        assert 2 <= shown_s - seconds() <= 4, "room countdown does not run on browser timers"


def test_wf_private_room_join_ready(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    host, guest_p = new_player(base), new_player(base)
    code = create_room(base, host)
    with visit(browser, base, f"/room/{code}", host) as ph, visit(browser, base, f"/join/{code}", guest_p) as pg:
        name_box = pg.get_by_role("textbox", name="Your name")
        see(pg, name_box, 'textbox "Your name"')
        expect(name_box).to_have_value(guest_p.name)
        click(pg.get_by_role("button", name="Join", exact=True))
        see_url(pg, re.escape(base) + f"/room/{code}$", "guest reaches the room lobby")
        for p in (ph, pg):
            for n in (host.name, guest_p.name):
                see(p, p.get_by_text(n).first, f"{n} in the lobby")
        click(enabled_ready(ph))
        tab_to(pg, enabled_ready(pg), "guest Ready button")
        pg.keyboard.press("Enter")
        toss = f"{host.name} won the toss and breaks with white."
        for p in (ph, pg):
            see_text(p, el(p, "toss-result"), toss)
        mid = client(base, host).get(f"/api/rooms/{code}").json()["matchId"]
        for p in (ph, pg):
            see_url(p, re.escape(base) + f"/match/{re.escape(str(mid))}$", "both reach the same match")
        m = match_json(base, host, mid)
        assert m["status"] == "active" and m["turn"] == 0 and m["seats"][0]["playerId"] == host.id and m["seats"][0]["color"] == "white"


def test_wf_private_room_full(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    host, guest_p, third = new_player(base), new_player(base), new_player(base)
    code = create_room(base, host)
    assert client(base, guest_p).post(f"/api/rooms/{code}/join").status_code == 200
    with visit(browser, base, f"/join/{code}", third) as page:
        heading = page.get_by_role("heading", name="Room full")
        join = page.get_by_role("button", name="Join", exact=True)
        eventually(page, lambda: expect(heading.or_(join)).to_be_visible(timeout=POLL_MS), "join page settles")
        if join.count() and join.is_visible():
            click(join)
        see(page, heading, 'heading "Room full"')
        expect(page.get_by_text("This room already has two players.")).to_be_visible()
    r = client(base, third).post(f"/api/rooms/{code}/join")
    assert r.status_code == 409 and r.json()["error"] == "ROOM_FULL"
    assert client(base, host).get(f"/api/rooms/{code}").json()["guest"]["id"] == guest_p.id


def test_wf_private_room_join_code(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    host, guest_p = new_player(base), new_player(base)
    code = create_room(base, host)
    with visit(browser, base, "/join", guest_p) as page:
        boxes = [page.get_by_role("textbox", name=f"Character {n} of 6", exact=True) for n in range(1, 7)]
        see(page, boxes[0], "first code box")
        tab_to(page, boxes[0], "first code box")
        for i, ch in enumerate(code[:3].lower()):
            page.keyboard.type(ch)
            expect(boxes[i]).to_have_value(code[i])
            expect(boxes[i + 1]).to_be_focused()
        page.keyboard.press("Backspace")
        expect(boxes[2]).to_be_focused()
        expect(boxes[2]).to_have_value("")
        boxes[0].focus()
        page.evaluate(PASTE_JS, code.lower())
        for i in range(6):
            eventually(page, lambda i=i: expect(boxes[i]).to_have_value(code[i], timeout=POLL_MS), f"box {i + 1} filled by paste")
        page.keyboard.press("Enter")
        see_url(page, re.escape(base) + f"/room/{code}$", "Enter joins the room")
    assert client(base, host).get(f"/api/rooms/{code}").json()["guest"]["id"] == guest_p.id


def test_rematch_same_room(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    host, guest_p = new_player(base), new_player(base)
    r = grading(base, "/api/grading/matches", {"mode": "private", "format": "quick", "players": [host.id, guest_p.id], "white": 0, "turn": 0})
    assert r.status_code == 201, r.text
    mid, code = r.json()["id"], r.json()["code"]
    with visit(browser, base, f"/match/{mid}", host) as ph, visit(browser, base, f"/match/{mid}", guest_p) as pg:
        aiming(ph)
        aiming(pg)
        assert client(base, guest_p).post(f"/api/matches/{mid}/resign").status_code == 200
        over = ph.get_by_role("dialog", name="Match over")
        see(ph, over, 'dialog "Match over" for the host')
        click(over.get_by_role("button", name="Rematch", exact=True))
        see_text(ph, over, "Rematch offered", exact=False)
        offer = f"{host.name} wants a rematch."
        see(pg, pg.get_by_text(offer), "rematch offer on the guest page")
        see_announced(pg, offer)
        accept = pg.get_by_role("button", name="Accept rematch")
        tab_to(pg, accept, 'button "Accept rematch"')
        pg.keyboard.press("Enter")
        not_old = re.escape(base) + rf"/match/(?!{re.escape(str(mid))}$)[^/]+$"
        for p in (ph, pg):
            see_url(p, not_old, "both reach the new match")
        new_id = pg.url.rstrip("/").split("/")[-1]
    m = match_json(base, guest_p, new_id)
    seat = next(s for s in m["seats"] if s["playerId"] == guest_p.id)
    assert m["roomCode"] == code and all(s["score"] == 0 for s in m["seats"]), m
    assert seat["color"] == "white" and m["turn"] == seat["seat"], "breaker was not swapped"


ROOM_CASES = ["simultaneous_joins", "expiry_by_server_time"]


@pytest.mark.timeout(300)
@pytest.mark.parametrize("case", ROOM_CASES, ids=ROOM_CASES)
def test_room_one_joiner_and_expiry(app_url: str, case: str) -> None:
    if case == "simultaneous_joins":
        base = app_url.rstrip("/")
        host = new_player(base)
        guests = [new_player(base) for _ in range(JOINERS)]
        code = create_room(base, host)
        clients = [client(base, g) for g in guests]
        barrier = threading.Barrier(JOINERS)

        def join(c: httpx.Client) -> httpx.Response:
            barrier.wait()
            return c.post(f"/api/rooms/{code}/join")
        with ThreadPoolExecutor(JOINERS) as pool:
            rs = list(pool.map(join, clients))
        winners = [g for g, r in zip(guests, rs) if r.status_code == 200]
        losers = [r for r in rs if r.status_code != 200]
        assert len(winners) == 1, [r.status_code for r in rs]
        assert all(r.status_code == 409 and r.json()["error"] == "ROOM_FULL" for r in losers)
        assert client(base, host).get(f"/api/rooms/{code}").json()["guest"]["id"] == winners[0].id
        return
    base = outage(SHORT_ENV)
    host, early, late = new_player(base), new_player(base), new_player(base)
    first = create_room(base, host)
    assert client(base, early).post(f"/api/rooms/{first}/join").status_code == 200, "a fresh room refused its joiner"
    code = create_room(base, host)
    hc = client(base, host)
    poll(lambda: hc.get(f"/api/rooms/{code}").json(), lambda j: j["status"] == "closed", "room closed after ROOM_EXPIRY_SECONDS", LONG_WAIT_S)
    r = client(base, late).post(f"/api/rooms/{code}/join")
    assert r.status_code == 410 and r.json()["error"] == "ROOM_CLOSED", r.text
    assert hc.get(f"/api/rooms/{code}").json()["guest"] is None


def enter_ranked(page: Page) -> None:
    btn = page.get_by_role("button", name="Play ranked", exact=True)
    see(page, btn, 'button "Play ranked"')
    click(btn)
    see_url(page, r"/queue/ranked(?:[?#].*)?$", "Play ranked opens the ranked queue")


def test_wf_ranked_queue_link_email(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    p = new_player(base)
    email = f"{p.name.lower()}@example.test"
    with visit(browser, base, "/", p) as page:
        try:
            click(page.get_by_role("button", name="Play ranked", exact=True))
            dlg = page.get_by_role("dialog", name="Link your email")
            see(page, dlg, 'dialog "Link your email"')
            expect(dlg).to_contain_text("Link your email to play ranked.")
            fill(dlg.get_by_role("textbox", name="Email"), email)
            with held(page, "**/api/auth/link") as hold:
                click(dlg.get_by_role("button", name="Send link"))
                see(page, dlg.get_by_role("button", name="Sending..."), "Send link pending state")
                assert "Link sent" not in (dlg.text_content() or ""), "Link sent shown before the mail server accepted"
                hold.release()
            see_text(page, dlg.get_by_role("status"), f"Link sent to {email}. Open it on any device.", exact=False)
            message = wait_mail(mail, email)
            assert message.get("Subject") == "Your Due Coin sign-in link"
            sender = parseaddr(mail_from_address())[1] or mail_from_address()
            assert sender.lower() in [a.lower() for a in addresses(message.get("From"))]
            me = page.request.get(base + "/api/me").json()
            assert me["linked"] is False and me["email"] is None, "email linked before the link was opened"
            page.goto(base + link_path(message))
            see_text(page, el(page, "page-status"), f"Email linked: {email}", exact=False)
            me = page.request.get(base + "/api/me").json()
            assert me["linked"] is True and me["email"] == email
            enter_ranked(page)
            assert page.request.get(base + "/api/queue").json()["mode"] == "ranked"
        finally:
            page.request.delete(base + "/api/queue")


def test_wf_ranked_queue_readouts(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = linked_player(base, rating=1500)
    with visit(browser, base, "/", p) as page:
        try:
            enter_ranked(page)
            see(page, page.get_by_role("heading", name="Finding a match"), 'heading "Finding a match"')
            see_text(page, el(page, "queue-near"), "Looking for players near 1500")
            see_text(page, el(page, "queue-band"), "Rating band: 1400-1600")
            q = client(base, p).get("/api/queue").json()
            assert q["near"] == 1500 and q["band"] == {"low": 1400, "high": 1600}, q
        finally:
            client(base, p).delete("/api/queue")


@pytest.mark.timeout(300)
def test_wf_ranked_queue_band_widens(browser: Browser, app_url: str) -> None:
    base = outage(SHORT_ENV)
    a, b = linked_player(base, rating=1500), linked_player(base, rating=1700)
    try:
        with visit(browser, base, "/", a, skew=True, init=BAND_RECORDER_INIT) as pa:
            enter_ranked(pa)
            with visit(browser, base, "/", b) as pb:
                enter_ranked(pb)
                match_re = re.escape(base) + r"/match/[^/]+$"
                see_url(pa, match_re, "earlier joiner reaches the match", LONG_WAIT_S)
                see_url(pb, match_re, "later joiner reaches the match", LONG_WAIT_S)
                assert pa.url == pb.url
                bands = pa.evaluate("() => JSON.parse(sessionStorage.getItem('__dcBands') || '[]')")
                assert "Rating band: 1400-1600" in bands and "Rating band: 1350-1650" in bands and "Rating band: 1300-1700" in bands, bands
                m = match_json(base, a, pa.url.rstrip("/").split("/")[-1])
                assert m["mode"] == "ranked" and m["seats"][0]["playerId"] == a.id
    finally:
        client(base, a).delete("/api/queue")
        client(base, b).delete("/api/queue")


def test_wf_ranked_queue_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = linked_player(base, rating=PHONE_QUEUE_RATING)
    try:
        with visit(browser, base, "/", p, **PHONE_VIEW) as page:
            enter_ranked(page)
            see_text(page, el(page, "queue-near"), f"Looking for players near {PHONE_QUEUE_RATING}")
            cancel = page.get_by_role("button", name="Cancel", exact=True)
            see(page, cancel, 'button "Cancel"')
            b = cancel.bounding_box()
            assert b and b["width"] >= TARGET_PX and b["height"] >= TARGET_PX, f"Cancel smaller than 44 px: {b}"
            layout(page)
            page.request.delete(base + "/api/queue")
    finally:
        client(base, p).delete("/api/queue")


def test_wf_ranked_queue_cancel(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    x, y = linked_player(base, rating=CANCEL_RATING), linked_player(base, rating=CANCEL_RATING)
    try:
        with visit(browser, base, "/", x) as page:
            enter_ranked(page)
            see(page, page.get_by_role("heading", name="Finding a match"), "queue heading")
            page.keyboard.press("Escape")
            see_url(page, home_re(base), "Escape returns to /")
        assert client(base, x).get("/api/queue").status_code == 404
        cy = client(base, y)
        assert cy.post("/api/queue", json={"mode": "ranked"}).status_code == 202
        deadline = time.monotonic() + PAIR_PUSH_S
        for _ in range(MAX_POLLS):
            assert cy.get("/api/queue").json()["matchId"] is None, "a cancelled player was still paired"
            if time.monotonic() >= deadline:
                break
    finally:
        client(base, x).delete("/api/queue")
        client(base, y).delete("/api/queue")


def test_queue_radar_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = linked_player(base, rating=RADAR_RATING)
    try:
        for reduced in (False, True):
            with visit(browser, base, "/", p, reduced=reduced) as page:
                enter_ranked(page)
                eventually(page, lambda: (_ for _ in ()).throw(AssertionError("no radar")) if not page.evaluate(RADAR_JS) else None, "#radar present")
                first = page.evaluate(RADAR_JS)
                advance(page, RADAR_MS / 4)
                second = page.evaluate(RADAR_JS)
                deltas = [abs(((b2 - a2 + 180) % 360) - 180) for a2, b2 in zip(first["angles"], second["angles"])]
                looping = [a2 for a2 in first["anims"] if a2["infinite"] and a2["running"]]
                if reduced:
                    assert not looping and all(dl < 1 for dl in deltas), f"radar turns under reduced motion: {first['anims']} {deltas}"
                else:
                    css = any(RADAR_MS * 0.95 <= a2["duration"] <= RADAR_MS * 1.05 for a2 in looping)
                    assert css or any(abs(dl - RADAR_QUARTER_DEG) <= RADAR_TOL_DEG for dl in deltas), f"radar does not sweep every 1.6 s: {first['anims']} {deltas}"
                page.request.delete(base + "/api/queue")
    finally:
        client(base, p).delete("/api/queue")


PAIR_CASES = ["three_at_once", "link_required"]


@pytest.mark.parametrize("case", PAIR_CASES, ids=PAIR_CASES)
def test_queue_pairing_once(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    if case == "link_required":
        c, _ = guest(base)
        r = c.post("/api/queue", json={"mode": "ranked"})
        assert r.status_code == 403 and r.json()["error"] == "LINK_REQUIRED", r.text
        assert c.get("/api/queue").status_code == 404
        return
    players = [linked_player(base, rating=TRIO_RATING) for _ in range(3)]
    clients = [client(base, p) for p in players]
    barrier = threading.Barrier(3)

    def enter(c: httpx.Client) -> httpx.Response:
        barrier.wait()
        return c.post("/api/queue", json={"mode": "ranked"})
    try:
        with ThreadPoolExecutor(3) as pool:
            assert [r.status_code for r in pool.map(enter, clients)] == [202, 202, 202]
        rs = poll(lambda: [c.get("/api/queue") for c in clients],
                  lambda rs: sum(1 for r in rs if r.status_code == 200 and r.json().get("matchId")) >= 2, "two entrants paired")
        ids = [r.json().get("matchId") if r.status_code == 200 else None for r in rs]
        paired = [p for p, i in zip(players, ids) if i]
        assert len(paired) == 2 and len({i for i in ids if i}) == 1, ids
        assert sum(1 for r in rs if r.status_code == 200 and r.json()["matchId"] is None) == 1
        m = match_json(base, paired[0], next(i for i in ids if i))
        assert {s["playerId"] for s in m["seats"]} == {p.id for p in paired}
    finally:
        for c in clients:
            c.delete("/api/queue")


@pytest.mark.timeout(300)
def test_wf_timers_and_forfeits_shot_clock(browser: Browser, app_url: str) -> None:
    base = outage(SHORT_ENV)
    with duel(browser, base, a_view={"skew": True, "init": TIMER_RECORDER_INIT}) as d:
        seen = d.pa.evaluate("() => window.__dcTimer || []")
        assert "0:04" in seen, f"shot clock never rendered its full 0:04; rendered values {seen}"
        assert all(re.fullmatch(r"0:0[0-4]", v) for v in seen), seen
        line = "Time's up. The turn passes."
        see_verdict(d.pa, "TIME UP", line)
        see_announced(d.pb, line)
        m = d.state()
        assert m["seats"][0]["timeouts"] >= 1 and m["seats"][0]["dues"] == 0, m["seats"]


@pytest.mark.timeout(300)
def test_wf_timers_and_forfeits_three_timeouts(browser: Browser, app_url: str) -> None:
    base = outage(SHORT_ENV)
    with duel(browser, base) as d:
        over = d.pb.get_by_role("dialog", name="Match over")
        see(d.pb, over, 'dialog "Match over"', seconds=LONG_WAIT_S)
        expect(over.get_by_role("heading", name="You won")).to_be_visible()
        expect(el(d.pb, "end-reason")).to_have_text(f"{d.a.name} forfeited: 3 timeouts in a row")
        m = d.state()
        assert m["status"] == "forfeit" and m["endReason"] == "timeouts" and m["winnerSeat"] == 1


def test_shot_clock_pulse(browser: Browser, app_url: str) -> None:
    base = outage(SHORT_ENV)
    for reduced in (False, True):
        with duel(browser, base, a_view={"reduced": reduced}) as d:
            see(d.pa, el(d.pa, "shot-timer"), "#shot-timer")
            samples = []
            for _ in range(PULSE_PERIOD_MS // PULSE_STEP_MS + 1):
                samples.append(d.pa.evaluate(PULSE_JS))
                advance(d.pa, PULSE_STEP_MS)
            assert all(samples), "the shot clock left the page while 5 seconds or less remained"
            animated = any(x["anims"] for x in samples)
            spread = max(x["opacity"] for x in samples) - min(x["opacity"] for x in samples)
            if reduced:
                assert not animated and spread < PULSE_MIN_SPREAD / 2, f"shot clock pulses under reduced motion: {samples}"
            else:
                assert animated or spread >= PULSE_MIN_SPREAD, f"shot clock does not fade in and out with 5 s or less left: {samples}"


def test_wf_timers_and_forfeits_reconnect(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base) as d:
        d.pa.context.set_offline(True)
        see_text(d.pa, el(d.pa, "page-status"), "Connection lost. Reconnecting...", exact=False)
        phrase = f"{d.a.name} is reconnecting..."
        see_text(d.pb, el(d.pb, "reconnect-overlay"), re.compile(re.escape(phrase) + r" \d+:\d\d"), "reconnect overlay", exact=False)
        advance(d.pb, 3000)
        assert ann_text(d.pb).count(phrase) == 1, "reconnect overlay announced more than once"
        assert d.state()["seats"][0]["connected"] is False


def test_wf_timers_and_forfeits_reconnect_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, b_view=PHONE_VIEW) as d:
        d.pa.context.set_offline(True)
        see_text(d.pa, el(d.pa, "page-status"), "Connection lost. Reconnecting...", exact=False)
        phrase = f"{d.a.name} is reconnecting..."
        overlay = el(d.pb, "reconnect-overlay")
        see_text(d.pb, overlay, re.compile(re.escape(phrase) + r" \d+:\d\d"), "reconnect overlay", exact=False)
        see(d.pb, overlay, "reconnect overlay on the phone")
        layout(d.pb)
        d.pa.context.set_offline(False)


def test_rejoin_within_window(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base) as d:
        before = pieces_on(d.pa)
        scores = [el(d.pa, f"score-{s}").text_content() for s in (0, 1)]
        d.pa.context.set_offline(True)
        see_text(d.pa, el(d.pa, "page-status"), "Connection lost. Reconnecting...", exact=False)
        see(d.pb, el(d.pb, "reconnect-overlay"), "reconnect overlay")
        d.pa.context.set_offline(False)
        d.pa.reload()
        aiming(d.pa)
        after = pieces_on(d.pa)
        for pid in PIECE_IDS[1:]:
            assert after[pid] == before[pid], f"{pid} changed across the rejoin"
        assert [el(d.pa, f"score-{s}").text_content() for s in (0, 1)] == scores
        eventually(d.pb, lambda: (_ for _ in ()).throw(AssertionError("overlay")) if shown(d.pb, "reconnect-overlay") else None, "overlay goes away")
        m = d.state()
        assert m["status"] == "active" and m["seats"][0]["connected"] is True


@pytest.mark.timeout(300)
def test_wf_timers_and_forfeits_ranked_forfeit(browser: Browser, app_url: str) -> None:
    base = outage(SHORT_ENV)
    with duel(browser, base, mode="ranked") as d:
        d.pa.goto("about:blank")
        over = d.pb.get_by_role("dialog", name="Match over")
        see(d.pb, over, 'dialog "Match over"', seconds=LONG_WAIT_S)
        expect(over.get_by_role("heading", name="You won")).to_be_visible()
        expect(el(d.pb, "end-reason")).to_have_text(f"{d.a.name} forfeited: left the match")
        expect(el(d.pb, "rating-change")).to_have_text("Rating 1662 (+162)")
        hb = [m for m in history(base, d.b) if m["matchId"] == d.mid][0]
        ha = [m for m in history(base, d.a) if m["matchId"] == d.mid][0]
        assert near(hb["ratingDelta"], 162.31, 0.011) and near(ha["ratingDelta"], -162.31, 0.011)
        for who, sign in ((d.b, "+162"), (d.a, "-162")):
            d.pb.goto(f"{base}/profile/{who.name}")
            d.pb.reload()
            see(d.pb, history_row(d.pb, "Ranked", sign), f"{who.name} history shows {sign}")


def test_wf_shop_and_skins_buy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = new_player(base, chalk=300)
    with visit(browser, base, "/shop", p) as page:
        art = page.get_by_role("article", name="Cobalt Ring")
        see(page, art, 'article "Cobalt Ring"')
        expect(art).to_contain_text("250 chalk")
        click(page.get_by_role("button", name="Buy Cobalt Ring"))
        see(page, page.get_by_role("button", name="Equip Cobalt Ring"), "Equip after purchase")
        page.reload()
        see(page, page.get_by_role("button", name="Equip Cobalt Ring"), "Equip after reload")
        page.goto(base + "/")
        see_text(page, el(page, "chalk-balance"), "50 chalk")
    c = client(base, p)
    shop = c.get("/api/shop").json()
    assert shop["chalk"] == 50 and next(i for i in shop["items"] if i["id"] == "striker-cobalt")["owned"] is True
    buys = [e for e in ledger(c) if e["reason"] == "purchase"]
    assert len(buys) == 1 and buys[0]["delta"] == -250 and buys[0]["itemId"] == "striker-cobalt"


def test_wf_shop_and_skins_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = new_player(base, chalk=300)
    with visit(browser, base, "/shop", p) as page:
        tabs = {n: page.get_by_role("tab", name=n, exact=True) for n in ("Strikers", "Boards", "Coin sets")}
        see(page, tabs["Strikers"], "shop tabs")
        tab_to(page, page.get_by_role("tablist", name="Item kinds"), 'tablist "Item kinds"')
        for _ in range(3):
            if is_focused(tabs["Strikers"]):
                break
            page.keyboard.press("ArrowLeft")
        for key, name in (("ArrowRight", "Boards"), ("ArrowRight", "Coin sets"), ("ArrowLeft", "Boards")):
            page.keyboard.press(key)
            expect(tabs[name]).to_be_focused()
            expect(tabs[name]).to_have_attribute("aria-selected", "true")
        expect(tabs["Strikers"]).to_have_attribute("aria-selected", "false")
        buy = page.get_by_role("button", name="Buy Walnut Night")
        tab_to(page, buy, 'button "Buy Walnut Night"')
        page.keyboard.press("Enter")
        equip = page.get_by_role("button", name="Equip Walnut Night")
        see(page, equip, "Equip Walnut Night")
        tab_to(page, equip, 'button "Equip Walnut Night"')
        page.keyboard.press("Enter")
        equipped = page.get_by_role("article", name="Walnut Night").get_by_role("button", name="Equipped")
        see(page, equipped, "Equipped button")
        expect(equipped).to_have_attribute("aria-pressed", "true")
    me = client(base, p).get("/api/me").json()
    assert me["equipped"]["board"] == "board-walnut" and me["chalk"] == 100


def test_short_balance_disables_buy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = new_player(base, chalk=130)
    with visit(browser, base, "/shop", p) as page:
        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            buy = page.get_by_role("button", name="Buy Cobalt Ring")
            see(page, buy, 'button "Buy Cobalt Ring"')
            expect(buy).to_be_disabled()
            expect(buy).to_contain_text("Need 120 more")
            expect(page.get_by_role("button", name="Buy Tomato Lacquer")).to_be_enabled()
            box = buy.bounding_box()
            assert box and box["width"] >= TARGET_PX and box["height"] >= TARGET_PX, box
            layout(page)
    assert client(base, p).get("/api/me").json()["chalk"] == 130


def test_wf_shop_and_skins_double_tap(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = new_player(base, chalk=300)
    with visit(browser, base, "/shop", p, size=PHONE, touch=True) as page:
        buy = page.get_by_role("button", name="Buy Cobalt Ring")
        see(page, buy, 'button "Buy Cobalt Ring"')
        buy.scroll_into_view_if_needed()
        box = buy.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        for _ in range(2):
            touch_at(page, "touchStart", x, y)
            touch_at(page, "touchEnd")
        see(page, page.get_by_role("button", name="Equip Cobalt Ring"), "Equip after the taps")
    c = client(base, p)
    buys = [e for e in ledger(c) if e["reason"] == "purchase"]
    assert len(buys) == 1 and c.get("/api/me").json()["chalk"] == 50, buys


def test_wf_shop_and_skins_opponent_sees(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    a = new_player(base, chalk=500)
    ca = client(base, a)
    for item in ("striker-cobalt", "board-walnut"):
        assert ca.post("/api/shop/purchase", json={"itemId": item, "idempotencyKey": idempotency_key()}).status_code == 200
        assert ca.post("/api/shop/equip", json={"itemId": item}).status_code == 200
    with duel(browser, base, players=(a, new_player(base))) as d:
        see_attr(d.pb, el(d.pb, "piece-striker"), "data-skin", "striker-cobalt")
        expect(el(d.pa, "board")).to_have_attribute("data-theme", "board-walnut")
        expect(el(d.pb, "board")).to_have_attribute("data-theme", "board-ply")
        assert d.state()["seats"][0]["strikerSkin"] == "striker-cobalt"


PURCHASE_CASES = ["insufficient", "replay", "key_conflict", "already_owned", "unknown_item", "concurrent_affordable_one"]


@pytest.mark.parametrize("case", PURCHASE_CASES, ids=PURCHASE_CASES)
def test_purchase_rules(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    p = new_player(base, chalk={"insufficient": 130, "concurrent_affordable_one": 300}.get(case, 900))
    c = client(base, p)
    url = "/api/shop/purchase"
    key = idempotency_key()
    if case == "insufficient":
        r = c.post(url, json={"itemId": "striker-cobalt", "idempotencyKey": key})
        assert r.status_code == 402 and r.json()["error"] == "INSUFFICIENT_CHALK" and r.json()["needed"] == 120, r.text
        assert not [e for e in ledger(c) if e["reason"] == "purchase"]
        return
    if case == "unknown_item":
        r = c.post(url, json={"itemId": "striker-none", "idempotencyKey": key})
        assert r.status_code == 404 and r.json()["error"] == "ITEM_NOT_FOUND"
        return
    if case == "concurrent_affordable_one":
        barrier = threading.Barrier(2)

        def buy(item: str) -> httpx.Response:
            barrier.wait()
            return c.post(url, json={"itemId": item, "idempotencyKey": idempotency_key()})
        with ThreadPoolExecutor(2) as pool:
            rs = list(pool.map(buy, ["striker-cobalt", "board-walnut"]))
        codes = sorted(r.status_code for r in rs)
        assert codes == [200, 402], codes
        assert c.get("/api/me").json()["chalk"] >= 0 and len([e for e in ledger(c) if e["reason"] == "purchase"]) == 1
        return
    before = c.get("/api/me").json()["chalk"]
    after = before - 250
    first = c.post(url, json={"itemId": "striker-cobalt", "idempotencyKey": key})
    assert first.status_code == 200 and first.json()["chalk"] == after, first.text
    if case == "replay":
        again = c.post(url, json={"itemId": "striker-cobalt", "idempotencyKey": key})
        assert again.status_code == 200 and again.json() == first.json()
    elif case == "key_conflict":
        clash = c.post(url, json={"itemId": "striker-tomato", "idempotencyKey": key})
        assert clash.status_code == 409 and clash.json()["error"] == "IDEMPOTENCY_CONFLICT"
    else:
        dup = c.post(url, json={"itemId": "striker-cobalt", "idempotencyKey": idempotency_key()})
        assert dup.status_code == 409 and dup.json()["error"] == "ALREADY_OWNED"
    assert len([e for e in ledger(c) if e["reason"] == "purchase"]) == 1 and c.get("/api/me").json()["chalk"] == after


def test_run_manifest_and_health(app_url: str) -> None:
    for base, status in ((app_url.rstrip("/"), "ok"), (outage(DB_DOWN_ENV), "unavailable"), (outage(MAIL_DOWN_ENV), "ok")):
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": status}, f"{base}: {r.status_code} {r.text}"
        assert r.headers.get("content-type", "").startswith("application/json")


def upgrade_status(base: str, origin: str, cookie: str) -> int:
    u = urlparse(base)
    req = (f"GET /ws HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
           f"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n"
           f"Cookie: dc_session={cookie}\r\n\r\n")
    with socket.create_connection((u.hostname, u.port or 80), timeout=HTTP_TIMEOUT) as s:
        s.sendall(req.encode())
        data = s.recv(1024).decode("latin-1")
    return int(data.split(" ")[1]) if data.startswith("HTTP/") else 0


def padded(size: int, **fields: Any) -> bytes:
    empty = len(json.dumps({**fields, "pad": ""}).encode())
    out = json.dumps({**fields, "pad": "x" * (size - empty)}).encode()
    assert len(out) == size
    return out


BOUNDARY_CASES = ["cross_origin_write", "cross_origin_socket", "body_limits", "local_body_limits", "non_json", "malformed_json", "private_paths", "browser_same_origin"]
PRIVATE_PATHS = ["/.env", "/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/node_modules/.package-lock.json"]


@pytest.mark.parametrize("case", BOUNDARY_CASES, ids=BOUNDARY_CASES)
def test_server_boundary(browser: Browser, app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    p = new_player(base, avatar=3)
    c = client(base, p)
    json_ct = {"Content-Type": "application/json"}
    if case == "cross_origin_write":
        r = c.post("/api/me/avatar", json={"avatar": 9}, headers={"Origin": EVIL_ORIGIN})
        assert r.status_code == 403 and r.json()["error"] == "CROSS_ORIGIN", r.text
        assert c.get("/api/me").json()["avatar"] == 3
    elif case == "cross_origin_socket":
        origin = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
        assert upgrade_status(base, origin, p.cookie) == UPGRADED, "same-origin upgrade refused"
        assert upgrade_status(base, EVIL_ORIGIN, p.cookie) != UPGRADED, "cross-origin socket upgrade accepted"
    elif case == "body_limits":
        big = c.post("/api/me/avatar", content=padded(BODY_LIMIT + 1, avatar=4), headers=json_ct)
        assert big.status_code == 413 and big.json()["error"] == "PAYLOAD_TOO_LARGE", big.text
        assert c.post("/api/me/avatar", content=padded(BODY_LIMIT, avatar=4), headers=json_ct).status_code != 413
    elif case == "local_body_limits":
        big = c.post("/api/local-matches", content=padded(LOCAL_BODY_LIMIT + 1), headers=json_ct)
        assert big.status_code == 413 and big.json()["error"] == "PAYLOAD_TOO_LARGE", big.text
        assert c.post("/api/local-matches", content=padded(LOCAL_BODY_LIMIT), headers=json_ct).status_code != 413
    elif case == "non_json":
        r = c.post("/api/me/avatar", content=b"avatar=4", headers={"Content-Type": "text/plain"})
        assert r.status_code == 415 and r.json()["error"] == "UNSUPPORTED_MEDIA_TYPE", r.text
    elif case == "malformed_json":
        r = c.post("/api/me/avatar", content=b"{bad", headers=json_ct)
        assert r.status_code == 400 and r.json()["error"] == "INVALID_PAYLOAD", r.text
    elif case == "private_paths":
        for path in PRIVATE_PATHS:
            r = c.get(path)
            assert r.status_code == 404, f"{path} answered {r.status_code}"
            assert GRADING_KEY not in r.text
    else:
        with visit(browser, base, "/", p) as page:
            seen: list[str] = []
            bodies: list[str] = []
            page.on("request", lambda req: seen.append(req.url))
            page.on("response", lambda res: bodies.append(res.text()) if res.request.resource_type in ("script", "document") and res.ok else None)
            for path in ("/", "/play/local", "/shop", "/leaderboard", "/join"):
                page.goto(base + path)
                advance(page, 1000)
            foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, base)]
            assert not foreign, f"browser requested other origins: {foreign[:5]}"
            assert not any(GRADING_KEY in b for b in bodies), "grading key reached the browser"


def test_database_outage(browser: Browser) -> None:
    base = outage(DB_DOWN_ENV)
    banner = "Online play is unavailable right now. Pass and play still works."
    r = httpx.get(base + "/api/me", timeout=HTTP_TIMEOUT)
    assert r.status_code == 503 and r.json()["error"] == "DATABASE_UNAVAILABLE"
    with visit(browser, base, "/") as page:
        see_url(page, home_re(base), "no redirect to /welcome during the outage")
        for path in ("/", "/shop", "/leaderboard", "/join", "/play/local"):
            page.goto(base + path)
            see_text(page, el(page, "outage-banner"), banner, f"outage banner on {path}")
        page.goto(base + "/")
        see_text(page, el(page, "outage-banner"), banner)
        for name in ("Create a room", "Play casual", "Play ranked"):
            expect(page.get_by_role("button", name=name, exact=True)).to_be_disabled()
        expect(page.get_by_role("link", name="Join with a code")).to_be_disabled()
        page.goto(base + "/play/local")
        click(page.get_by_role("button", name="Start", exact=True))
        aiming(page)
        click(el(page, "menu"))
        click(page.get_by_role("dialog", name="Menu").get_by_role("button", name="Resign", exact=True))
        click(page.get_by_role("dialog", name="Resign this match?").get_by_role("button", name="Resign", exact=True))
        see_text(page, el(page, "save-status"), "Saved on this device. It will be added to your history when online.")


def test_mail_outage(browser: Browser, mail: Any) -> None:
    base = outage(MAIL_DOWN_ENV)
    p = new_player(base)
    email = f"{p.name.lower()}@example.test"
    with visit(browser, base, "/", p) as page:
        click(page.get_by_role("button", name="Play ranked", exact=True))
        dlg = page.get_by_role("dialog", name="Link your email")
        see(page, dlg, 'dialog "Link your email"')
        fill(dlg.get_by_role("textbox", name="Email"), email)
        click(dlg.get_by_role("button", name="Send link"))
        see_text(page, dlg.get_by_role("alert"), "We couldn't send the link. Try again in a minute.", exact=False)
        assert "Link sent" not in (dlg.text_content() or "")
        page.goto(base + "/play/local")
        click(page.get_by_role("button", name="Start", exact=True))
        aiming(page)
        expect(el(page, "turn-text")).to_have_text("Player 1's turn")
    c = client(base, p)
    r = c.post("/api/auth/link", json={"email": email})
    assert r.status_code == 503 and r.json()["error"] == "MAIL_UNAVAILABLE"
    me = c.get("/api/me").json()
    assert me["linked"] is False and me["email"] is None
    q = c.post("/api/queue", json={"mode": "ranked"})
    assert q.status_code == 403 and q.json()["error"] == "LINK_REQUIRED"
    room = c.post("/api/rooms", json={"format": "quick"})
    assert room.status_code == 201
    c.delete(f"/api/rooms/{room.json()['code']}")
    assert not [m for m in mail.messages() if email in [a.lower() for a in addresses(m.get("To"))]]


def test_magic_link_other_device(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    owner = linked_player(base)
    with visit(browser, base, "/") as page:
        r = page.request.post(base + "/api/auth/link", data={"email": owner.email})
        assert r.status == 202, r.text()
        path = link_path(wait_mail(mail, owner.email))
        page.goto(base + path)
        see_text(page, el(page, "page-status"), f"Signed in as {owner.name}", exact=False)
        assert page.request.get(base + "/api/me").json()["id"] == owner.id
        for again in (path, "/auth/link/not-a-real-token-123"):
            page.goto(base + again)
            see(page, page.get_by_role("heading", name="This link has expired"), f"expired page for {again}")
            expect(page.get_by_role("link", name="Home")).to_be_visible()


def test_field_wipe(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, b_view={"reduced": True}) as d:
        for p in (d.pa, d.pb):
            p.evaluate(RECORDER_JS)
        root = el(d.pa, "match-root")
        for seat, edge, turn, field in ((0, "top", "1", "cobalt"), (1, "bottom", "0", "tomato")):
            grading_shot(base, d.mid, seat, first="w5" if seat == 0 else "b5")
            wipe = el(d.pa, "field-wipe")
            eventually(d.pa, lambda: (_ for _ in ()).throw(AssertionError("no #field-wipe")) if not d.pa.evaluate("() => !!document.getElementById('field-wipe')") else None,
                       "field wipe appears", step_ms=50)
            durations = d.pa.evaluate(WIPE_ANIMS_JS)
            rec = d.pa.evaluate("() => window.__dcRec.wipes")[-1]
            assert rec["from"] == edge and rec["turn"] == str(seat), f"wipe {rec}; expected from {edge} before the turn changed"
            path = motion(wipe, WIPE_MS)
            fronts = [(sample_box(s)["top"] + sample_box(s)["height"]) if edge == "top" else sample_box(s)["top"] for s in path]
            moved = len(fronts) > 1 and (fronts[-1] - fronts[0] if edge == "top" else fronts[0] - fronts[-1]) > 0
            assert moved or any(WIPE_MIN_MS <= x <= WIPE_MAX_MS for x in durations), f"wipe did not cross in about 520 ms: {durations} {fronts}"
            see_attr(d.pa, root, "data-turn", turn)
            expect(root).to_have_attribute("data-field", field)
            see_attr(d.pb, el(d.pb, "match-root"), "data-turn", turn)
            aiming(d.pa)
            aiming(d.pb)
        assert d.pb.evaluate("() => window.__dcRec.wipes") == [], "reduced motion still ran a field wipe"


@pytest.mark.parametrize("size_id", SIZE_IDS, ids=SIZE_IDS)
def test_breakpoints(browser: Browser, app_url: str, size_id: str) -> None:
    size = SIZES[size_id]
    with solo(browser, app_url.rstrip("/"), view={"size": size}) as s:
        assert_board_in_view(s.page, size)
        layout(s.page)
        for loc in s.page.get_by_role("button").all() + s.page.get_by_role("slider").all():
            if loc.is_visible():
                b = loc.bounding_box()
                assert b and b["height"] >= TARGET_PX and (b["width"] >= TARGET_PX), f"control under 44 px at {size_id}: {b}"


def assert_focus_ring(locator: Locator, what: str) -> None:
    locator.evaluate("e => e.blur()")
    rest, focused = state_styles(locator, "outline-style", "outline-width", "box-shadow", state="focus")
    nums = re.findall(r"[\d.]+", focused.get("outline-width") or "0")
    width = float(nums[0]) if nums else 0.0
    ring = (focused.get("outline-style") not in (None, "", "none") and width >= 2) or (focused.get("box-shadow") not in (None, "", "none") and focused.get("box-shadow") != rest.get("box-shadow"))
    assert ring, f"{what} shows no visible focus ring: {focused}"


@pytest.mark.parametrize("size_id", SIZE_IDS, ids=SIZE_IDS)
def test_accessibility(browser: Browser, app_url: str, size_id: str) -> None:
    base = app_url.rstrip("/")
    size = SIZES[size_id]
    with solo(browser, base, view={"size": size}) as s:
        axe(s.page)
        assert_focus_ring(el(s.page, "board"), "#board")
        for path, target in (("/", s.page.get_by_role("link", name="Shop")), ("/shop", s.page.get_by_role("tab", name="Strikers")), (f"/profile/{s.a.name}", None)):
            s.page.goto(base + path)
            advance(s.page, 1000)
            axe(s.page)
            if target is not None:
                assert_focus_ring(target.first, path)


SIM_CASES = ["coin_into_se", "back_shot_stays_on_board", "break_first_contact"]


@pytest.mark.parametrize("case", SIM_CASES, ids=SIM_CASES)
def test_simulate(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    if case == "coin_into_se":
        body: dict = {"pieces": [{"id": "w1", "x": 330.0, "y": 330.0, "vx": 212.132, "vy": 212.132}]}
    elif case == "back_shot_stays_on_board":
        body = {"pieces": [], "intent": {"seat": 0, "x": 0.0, "dx": 0.0, "dy": 1.0, "p": 1.0}}
    else:
        body = {"pieces": [{"id": k, "x": x, "y": y, "vx": 0.0, "vy": 0.0} for k, (x, y) in OPENING.items()],
                "intent": {"seat": 0, "x": 0.0, "dx": 0.0, "dy": -1.0, "p": 0.2}}
    r1, r2 = grading(base, "/api/grading/simulate", body), grading(base, "/api/grading/simulate", body)
    assert r1.status_code == 200 and r2.status_code == 200, r1.text
    j1, j2 = r1.json(), r2.json()
    assert json.dumps(j1["events"], sort_keys=True) == json.dumps(j2["events"], sort_keys=True)
    assert json.dumps(j1["final"], sort_keys=True) == json.dumps(j2["final"], sort_keys=True)
    assert j1["maxSpeedAtRest"] < 0.5 and j1["durationSeconds"] <= 12
    if case == "coin_into_se":
        assert j1["events"] == {"firstContact": None, "pocketed": [{"id": "w1", "pocket": "se"}], "strikerPocketed": False}
        assert j1["final"] == [{"id": "w1", "x": None, "y": None, "state": "pocketed"}]
    elif case == "back_shot_stays_on_board":
        for f in j1["frames"]:
            for p in f["pieces"]:
                if p["x"] is not None:
                    assert abs(p["x"]) <= 349.35 and abs(p["y"]) <= 349.35, f"striker left the board: {p}"
        assert j1["events"]["strikerPocketed"] is False
        assert next(p for p in j1["final"] if p["id"] == "striker")["state"] == "board"
    else:
        assert j1["events"]["firstContact"] == "w5"


RATING_CASES = ["two_new_players", "worked_example_2", "tiers", "leaderboard"]


@pytest.mark.parametrize("case", RATING_CASES, ids=RATING_CASES)
def test_glicko_ratings(browser: Browser, app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    if case in ("two_new_players", "worked_example_2"):
        if case == "two_new_players":
            w, l = new_player(base), new_player(base)
            expect_w, expect_l = (1662.31, 290.32), (1337.69, 290.32)
        else:
            w = new_player(base, rating=1520, rd=120, volatility=0.06)
            l = new_player(base, rating=1600, rd=100, volatility=0.06)
            expect_w, expect_l = (1563.84, 114.63), (1569.20, 97.20)
        mid = new_match(base, [w, l], mode="ranked")
        assert client(base, l).post(f"/api/matches/{mid}/resign").status_code == 200
        for who, (rating, rd) in ((w, expect_w), (l, expect_l)):
            me = client(base, who).get("/api/me").json()
            assert near(me["rating"], rating, 0.011) and near(me["rd"], rd, 0.011), f"{who.name}: {me['rating']}/{me['rd']}"
            assert me["rankedGames"] == 1
        if case == "two_new_players":
            assert client(base, w).get("/api/me").json()["tier"] == "Gold" and client(base, l).get("/api/me").json()["tier"] == "Bronze"
        return
    if case == "tiers":
        for rating, tier in TIERS:
            p = new_player(base, rating=rating)
            assert client(base, p).get(f"/api/players/by-name/{p.name}").json()["tier"] == tier, (rating, tier)
        return
    elig = new_player(base, rating=LEADER_RATING, rd=100, rankedGames=10)
    few = new_player(base, rating=LEADER_RATING + 5, rd=100, rankedGames=9)
    wide = new_player(base, rating=LEADER_RATING + 6, rd=150, rankedGames=12)
    body = client(base, few).get("/api/leaderboard").json()
    ids = [r["playerId"] for r in body["rows"]]
    assert elig.id in ids and few.id not in ids and wide.id not in ids, "leaderboard eligibility wrong"
    ratings = [r["rating"] for r in body["rows"]]
    assert ratings == sorted(ratings, reverse=True) and len(ratings) <= 100
    assert body["you"] is not None and body["you"]["playerId"] == few.id
    with visit(browser, base, "/leaderboard", few) as page:
        table = page.get_by_role("table", name="Leaderboard")
        see_text(page, table, elig.name, exact=False)
        assert few.name not in (table.text_content() or "")


CHALK_CASES = ["completed", "resigned", "second_win_same_day", "local_daily_cap", "abandoned"]


@pytest.mark.timeout(300)
@pytest.mark.parametrize("case", CHALK_CASES, ids=CHALK_CASES)
def test_chalk_awards(browser: Browser, app_url: str, case: str) -> None:
    base = app_url.rstrip("/")

    def reasons(p: Player, b: str = base) -> list[tuple[str, int]]:
        return sorted((e["reason"], e["delta"]) for e in ledger(client(b, p)))
    if case in ("completed", "resigned", "second_win_same_day"):
        a, b = new_player(base), new_player(base)
        if case == "resigned":
            mid = new_match(base, [a, b])
            assert client(base, b).post(f"/api/matches/{mid}/resign").status_code == 200
            assert reasons(b) == [], "a resigner was awarded chalk"
        else:
            win_quick(base, [a, b])
            assert reasons(b) == [("match", 20)]
        expected = [("daily", 50), ("match", 20), ("win", 30)]
        if case == "second_win_same_day":
            win_quick(base, [a, new_player(base)])
            expected = sorted(expected + [("match", 20), ("win", 30)])
        assert reasons(a) == expected, reasons(a)
    elif case == "local_daily_cap":
        c, _ = guest(base)
        earned = []
        for _ in range(6):
            body = {"format": "quick", "players": [{"name": fresh_name("L")}, {"name": fresh_name("M")}], "shots": [], "resignedSeat": 0,
                    "claimed": {"winnerSeat": 1, "scores": [0, 0]}, "modelVersion": "dc-model-1", "idempotencyKey": idempotency_key()}
            r = c.post("/api/local-matches", json=body)
            assert r.status_code == 201, r.text
            earned.append(r.json()["chalkEarned"])
        assert earned == [10, 10, 10, 10, 10, 0], earned
        assert sorted((e["reason"], e["delta"]) for e in ledger(c)) == [("local", 10)] * 5
    else:
        sbase = outage(SHORT_ENV)
        a, b = new_player(sbase), new_player(sbase)
        mid = new_match(sbase, [a, b])
        with visit(browser, sbase, f"/match/{mid}", a) as pa, visit(browser, sbase, f"/match/{mid}", b) as pb:
            aiming(pa)
            aiming(pb)
            wait_connected(pa, sbase, a, mid)
            pa.goto("about:blank")
            pb.goto("about:blank")
        ca = client(sbase, a)
        poll(lambda: ca.get(f"/api/matches/{mid}").json(), lambda m: m["status"] == "abandoned", "match abandoned after both left", LONG_WAIT_S)
        assert reasons(a, sbase) == [] and reasons(b, sbase) == []
        assert not [m for m in history(sbase, a) if m["matchId"] == mid]


def test_emotes(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base) as d:
        click(d.pa.get_by_role("button", name="Emotes"))
        menu = d.pa.get_by_role("menu")
        see(d.pa, menu, "emote menu")
        labels = ["Nice shot", "Well played", "Oops", "Thinking", "Good game", "Hello"]
        expect(menu.get_by_role("menuitem")).to_have_count(6)
        for label in labels:
            expect(menu.get_by_role("menuitem", name=label)).to_have_count(1)
        click(menu.get_by_role("menuitem", name="Well played"))
        see_text(d.pb, el(d.pb, "emote-bubble"), "Well played", exact=False)
        see_announced(d.pb, f"{d.a.name}: Well played")
        cb = client(base, d.b)
        assert cb.post(f"/api/matches/{d.mid}/emotes", json={"emote": "hello"}).status_code == 204
        flood = cb.post(f"/api/matches/{d.mid}/emotes", json={"emote": "oops"})
        assert flood.status_code == 429 and flood.json()["error"] == "RATE_LIMITED"
    x, y = new_player(base), new_player(base)
    xm = new_match(base, [x, y])
    bad = client(base, x).post(f"/api/matches/{xm}/emotes", json={"emote": "wave"})
    assert bad.status_code == 422 and bad.json()["error"] == "INVALID_EMOTE", bad.text


GRADING_CASES = ["wrong_or_missing_key", "players", "matches", "shots"]


@pytest.mark.parametrize("case", GRADING_CASES, ids=GRADING_CASES)
def test_grading_routes(app_url: str, case: str) -> None:
    base = app_url.rstrip("/")
    if case == "wrong_or_missing_key":
        a, b = new_player(base), new_player(base)
        mid = new_match(base, [a, b])
        name = fresh_name("G")
        for key in (None, "not-the-key"):
            for path, body in (("/api/grading/players", {"name": name, "avatar": 7}), ("/api/grading/matches", {"mode": "casual", "format": "quick", "players": [a.id, b.id]}),
                               (f"/api/grading/matches/{mid}/shots", {"seat": 0, "events": {"firstContact": "w5", "pocketed": [], "strikerPocketed": False}}),
                               ("/api/grading/simulate", {"pieces": []})):
                assert grading(base, path, body, key=key).status_code == 404, f"{path} with key {key!r}"
        assert client(base, a).get(f"/api/players/by-name/{name}").status_code == 404
        assert match_json(base, a, mid)["shotSeq"] == 0
    elif case == "players":
        p = linked_player(base, chalk=300)
        me = client(base, p).get("/api/me").json()
        assert (me["name"], me["avatar"], me["email"], me["linked"], me["chosen"], me["chalk"]) == (p.name, 7, p.email, True, True, 300), me
        grants = [e for e in ledger(client(base, p)) if e["reason"] == "grant"]
        assert len(grants) == 1 and grants[0]["delta"] == 300
    elif case == "matches":
        a, b = new_player(base), new_player(base)
        r = grading(base, "/api/grading/matches", {"mode": "private", "format": "classic", "players": [a.id, b.id], "white": 0, "turn": 0, "board": 3, "scores": [10, 4],
                                                   "pieces": ILLEGAL_LAYOUT[:1] + [{"id": "queen", "x": 0, "y": 0, "state": "pocketed", "pocketedBy": 0}], "queen": {"state": "covered", "seat": 0}})
        assert r.status_code == 201 and r.json()["code"], r.text
        assert client(base, a).get(f"/api/rooms/{r.json()['code']}").status_code == 200
        m = match_json(base, a, r.json()["id"])
        assert (m["mode"], m["format"], m["status"], m["board"], m["turn"]) == ("private", "classic", "active", 3, 0)
        assert [s["score"] for s in m["seats"]] == [10, 4] and m["queen"] == {"state": "covered", "seat": 0}
        w1 = piece(m, "w1")
        assert near(w1["x"], 40.0) and near(w1["y"], STRIKER_Y) and w1["state"] == "board"
        assert piece(m, "w2")["state"] == "pocketed" and piece(m, "w2")["pocketedBy"] == 0 and piece(m, "b1")["pocketedBy"] == 1
        fresh = match_json(base, a, new_match(base, [a, b]))
        for pid, (x, y) in OPENING.items():
            assert near(piece(fresh, pid)["x"], x) and near(piece(fresh, pid)["y"], y)
    else:
        a, b = new_player(base), new_player(base)
        mid = new_match(base, [a, b])
        bad = grading(base, f"/api/grading/matches/{mid}/shots", {"seat": 1, "events": {"firstContact": "b5", "pocketed": [], "strikerPocketed": False}})
        assert bad.status_code == 409 and bad.json()["error"] == "NOT_YOUR_TURN"
        res = grading_shot(base, mid, 0, pocketed=("w5",), final=[{"id": "b2", "x": -60.0, "y": 10.0}])
        assert res["frames"] == [] and res["verdict"] == {"word": "POCKETED", "line": "1 coin pocketed. Shoot again."}
        m = match_json(base, a, mid)
        assert m["shotSeq"] == 1 and piece(m, "w5")["state"] == "pocketed" and near(piece(m, "b2")["x"], -60.0) and near(piece(m, "b2")["y"], 10.0)


def test_if_run_manifest() -> None:
    data = json.loads((APP_DIR / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text().lower()
    missing = [p.name for p in shipped_packages() if p.name.lower() not in notices]
    assert not missing, f"packages missing from the notices: {missing[:10]}"
    assert all(n.lower() in notices for n in NOTICE_ASSETS)


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence or "", ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad[:10]}"


def test_if_postgres_only() -> None:
    extra = [p.name for p in shipped_packages() if p.name in DATASTORE_PACKAGES]
    assert not extra, f"other datastore packages shipped: {extra}"


SKIP_DIRS = {"node_modules", "dist", "build", ".git", ".next", "coverage", "public", ".cache"}


def test_if_typescript_source() -> None:
    js, ts = [], 0
    for root, dirs, files in os.walk(APP_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith((".ts", ".tsx")):
                ts += 1
            elif f.endswith((".js", ".jsx", ".mjs", ".cjs")) and not (re.search(r"\.config\.[cm]?js$", f) or f.startswith(".") or Path(root) == APP_DIR):
                js.append(os.path.join(root, f))
    assert ts > 0 and not js, f"JavaScript source files: {js[:10]}"


def test_if_service_config_unchanged() -> None:
    fragments = [str(p) for p in APP_DIR.rglob("*compose*.y*ml") if "node_modules" not in p.parts]
    if not TRAJECTORY.exists() or not fragments:
        return
    edits = {"Edit", "Write", "MultiEdit", "str_replace_editor", "apply_patch", "create_file"}

    def walk(node: Any) -> Iterator[dict]:
        if isinstance(node, dict):
            yield node
            for v in node.values():
                yield from walk(v)
        elif isinstance(node, list):
            for v in node:
                yield from walk(v)
    data = json.loads(TRAJECTORY.read_text())
    for node in walk(data):
        if any(isinstance(v, str) and v in edits for v in node.values()):
            dumped = json.dumps(node)
            touched = [f for f in fragments if f in dumped or Path(f).name in dumped]
            assert not touched, f"compose fragment edited: {touched}"


def test_if_no_venv_or_absolute_symlinks() -> None:
    for root, dirs, files in os.walk(APP_DIR, followlinks=False):
        assert VENV_MARKER not in files, f"virtual environment at {root}"
        for name in dirs + files:
            path = os.path.join(root, name)
            if os.path.islink(path):
                assert not os.readlink(path).startswith("/"), f"absolute symlink {path}"


def test_wf_classic_scoring_announce_order(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, **board_win([24, 4])) as d:
        grading_shot(base, d.mid, 0, pocketed=("w1",), first="w1")
        board_line = f"{d.a.name} wins board 3. 4 points: 4 coins left"
        match_line = "You won. Final score 28-4."
        see_announced(d.pa, match_line)
        text = ann_text(d.pa)
        assert board_line in text, f"board line missing from the announcer: {text[-300:]}"
        assert text.rfind(board_line) < text.rfind(match_line), f"match line announced before the board line: {text[-300:]}"


def test_wf_phone_aim_rail_in_view(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with solo(browser, base, view=PHONE_VIEW) as s:
        assert_rail_in_view(s.page)


def test_wf_private_room_toss_announced(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    host, guest_p = new_player(base), new_player(base)
    code = create_room(base, host)
    with visit(browser, base, f"/room/{code}", host) as ph, visit(browser, base, f"/join/{code}", guest_p) as pg:
        see(pg, pg.get_by_role("textbox", name="Your name"), 'textbox "Your name"')
        click(pg.get_by_role("button", name="Join", exact=True))
        see_url(pg, re.escape(base) + f"/room/{code}$", "guest reaches the room lobby")
        see(ph, ph.get_by_text(guest_p.name).first, "guest seated")
        click(enabled_ready(ph))
        tab_to(pg, enabled_ready(pg), "guest Ready button")
        pg.keyboard.press("Enter")
        toss = f"{host.name} won the toss and breaks with white."
        for p in (ph, pg):
            see_url(p, re.escape(base) + r"/match/[^/]+$", "match screen")
            see_announced(p, toss)


def test_wf_illegal_placement_rail_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, a_view=PHONE_VIEW, pieces=layout_pieces(moved={"w1": (40.0, 252.1)})) as d:
        el(d.pa, "board").focus()
        press(d.pa, "Shift+ArrowRight", 8)
        see_attr(d.pa, el(d.pa, "piece-striker"), "data-legal", "false")
        assert_rail_in_view(d.pa)


def test_wf_queen_rules_rail_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, a_view=PHONE_VIEW, pieces=layout_pieces(without=("w1", "w2"))) as d:
        grading_shot(base, d.mid, 0, pocketed=("queen",), first="queen")
        see_text(d.pa, el(d.pa, "queen-status"), f"Awaiting cover by {d.a.name}")
        assert_rail_in_view(d.pa)


def test_wf_timers_and_forfeits_rail_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, b_view=PHONE_VIEW) as d:
        d.pa.context.set_offline(True)
        see_text(d.pa, el(d.pa, "page-status"), "Connection lost. Reconnecting...", exact=False)
        see_text(d.pb, el(d.pb, "reconnect-overlay"), re.compile(r"reconnecting\.\.\. \d+:\d\d"), "reconnect overlay", exact=False)
        assert_rail_in_view(d.pb)
        d.pa.context.set_offline(False)


def test_wf_keyboard_aim_rail_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with duel(browser, base, a_view=PHONE_VIEW) as d:
        el(d.pa, "board").focus()
        press(d.pa, "ArrowRight", 5)
        see_text(d.pa, el(d.pa, "striker-readout"), "Striker 5.0 mm")
        assert_rail_in_view(d.pa)


def test_wf_guest_onboarding_hero_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = new_player(base)
    with visit(browser, base, "/", p, **PHONE_VIEW) as page:
        see(page, page.get_by_role("heading", level=1), "DUE COIN heading")
        hero = page.evaluate(HERO_LINES_JS)
        assert hero and hero["lines"] >= 2, f"DUE COIN sits on {hero and hero['lines']} line(s) at 375 px"
        for loc, what in ((page.get_by_text("Carrom, refereed in the open.", exact=True), "the label"),
                          (page.get_by_role("link", name="Play now", exact=True), 'link "Play now"')):
            see(page, loc, what)
            b = loc.bounding_box()
            assert b and b["y"] >= hero["bottom"] - 1, f"{what} is not beneath the name: {b} vs bottom {hero['bottom']}"
