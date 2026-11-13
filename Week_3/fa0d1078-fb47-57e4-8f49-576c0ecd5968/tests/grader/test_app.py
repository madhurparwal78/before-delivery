from __future__ import annotations

import base64
import contextlib
import dataclasses
import hashlib
import json
import math
import os
import re
import socket
import subprocess
import threading
import time
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    Mailpit,
    Valkey,
    addresses,
    advance,
    center,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    shipped_packages,
    tap,
    text,
    unique,
)


MISTAKE_LIMIT = 3
HINT_LIMIT = 3
MOVE_LIMIT = 5000
LEADERBOARD_SIZE = 20
DUEL_COUNTDOWN_MS = 3000
COUNTDOWN_STEP_MS = 1000
SHORT_REJOIN_MS = 3000
SHORT_TIE_MS = 4000
ROOM_TTL_S = 600
JOIN_LIMIT = 5
JOIN_WINDOW_S = 60
VERIFY_TTL_MIN = 60
RESET_TTL_MIN = 30
BODY_LIMIT = 1_000_000
WS_NO_SESSION_CLOSE = 4401
LIVE_S = 2
PROGRESS_S = 1
BASE_SCORE = {"easy": 1500, "medium": 3000, "hard": 4500, "expert": 6000}
MISTAKE_COST = 150
HINT_COST = 300
SOLVED_CELL_MS = 300
SOLVED_STAGGER_MS = 40
SOLVED_SPAN_MS = 940
STITCH_MS = 240
COUNT_ROLL_MS = 320
BREAKPOINT = 768
PHONE_GUTTER = 32
BOARD_MAX = 480
TARGET_PX = 44
PHONE_WIDTH = 390
PHONE_HEIGHT = 844
MEDIUM3_EMPTY = 48
DAILY_EPOCH = date(2026, 1, 1)
DAILY_START = date(2026, 1, 1)
PASSWORD = "correct-horse-1"
NEW_PASSWORD = "stitched-anew-2026"
SHORT_PASSWORD = "short"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
VIEWPORTS = [(320, 800), (375, 812), (768, 1024), (1280, 800), (1440, 900)]
DEVICE_TIME = "2031-05-20T08:00:00Z"
OWN_DATE_SPAN = 290
OWN_DATE_FROM = date(2026, 1, 2)
DAILY_ELAPSED = 300000
WAIT_S = 30
HTTP_TIMEOUT = 30
STEP_MS = 50
TAB_LIMIT = 60
FONT_LICENCE = "SIL Open Font License"
EMBEDDED_SQL = "SQLite"
SESSION_FLAG = "HttpOnly"
STATE_WORDS = {"solved": "solved", "late": "solved late", "missed": "missed", "today": "today",
               "future": "not open yet", "closed": "not available"}
LEVEL_NAMES = {"easy": "Easy", "medium": "Medium", "hard": "Hard", "expert": "Expert"}

PUZZLES: dict[str, tuple[str, str]] = {
    "easy-1": ("000325070250900640000046523410500060002107400090003017739210000045008092020759000",
               "684325971253971648971846523417582369362197485598463217739214856145638792826759134"),
    "easy-2": ("004010590009007408076054001201000875000261000943000602400630750507100200032070100",
               "324816597159327468876954321261493875785261943943785612418632759597148236632579184"),
    "easy-3": ("432075109800010045005003726000057000050804070000320000719500800320090007508730961",
               "432675189867219345195483726283957614951864273674321598719546832326198457548732961"),
    "medium-1": ("010800000007000090859200604600082405080000030102570009908004156030000900000009080",
                 "416895723327461598859237614693182475785946231142573869978324156231658947564719382"),
    "medium-2": ("670100000409000000500004160090600084806947501140008090057400006000000805000005072",
                 "678153249419826753523794168795612384836947521142538697257481936364279815981365472"),
    "medium-3": ("000000905579200060300090004050007018103080402780100050800050006030002541405000000",
                 "241763985579248163368591724654927318193685472782134659817459236936872541425316897"),
    "hard-1": ("090006000004095603005080090100000200680000041002000006040020500507860100000900070",
               "298436715714295683365187492159648237683572941472319856941723568537864129826951374"),
    "hard-2": ("910406000000000009005007001003600007201080604400002300600300500300000000000809032",
               "912456873736218459845937261583694127271583694469172385697321548328745916154869732"),
    "hard-3": ("000065800000000001050240070005400010098030720070002400030097060600000000009520000",
               "927165834346789251851243679265478913498631725173952486534897162682314597719526348"),
    "expert-1": ("000000006006071000004800290030007450000080000047200080023009600000320800100000000",
                 "381592746296471538754863291938617452512984367647235189823159674479326815165748923"),
    "expert-2": ("004000010005109640000306008000000030000462000010000000300508000068901200050000700",
                 "684257319235189647197346528429715836873462195516893472342578961768931254951624783"),
    "expert-3": ("035020006001050009940008000000009000400080001000700000000200037500040900700090210",
                 "835921746671354829942678153357419682496582371218736594189265437523147968764893215"),
    "daily-1": ("031070005042506080000834000076000000100040009000000570000457000050601720900080150",
                "831279645742516983695834217576928431123745869489163572218457396354691728967382154"),
    "daily-2": ("049800000000009810120000009600930074030060090890027001200000087017300000000002960",
                "549871326376249815128653749651938274732164598894527631263495187917386452485712963"),
    "daily-3": ("800070000000006095009502308000230850031000270058097000607403500310900000000060003",
                "865379124123846795749512368976234851431658279258197436697483512314925687582761943"),
    "daily-4": ("063008200100600350000310000002000030581030642040000800000071000018003004007900510",
                "763458291124697358895312467672845139581739642349126875456271983918563724237984516"),
    "daily-5": ("700350210610007900005901000200500009050000040900008002000403800008600075069085004",
                "794356218612847953385921467271534689853269741946178532527413896438692175169785324"),
    "daily-6": ("409000706058007040010045000006000270900102004073000500000930020090700460504000907",
                "429318756358697142617245398146583279985172634273469581761934825892751463534826917"),
    "daily-7": ("070040009860105004040020071005006090000701000010300800150060030600204015900010040",
                "271643589869175324543829671725486193398751462416392857154967238687234915932518746"),
}


RECORDER_JS = r"""(() => {
  if (window.__seamRecorder) return;
  window.__seamRecorder = true;
  window.__said = []; window.__celebrated = false; window.__maxAnims = 0;
  window.__cellAnims = {}; window.__hemAnims = [];
  let last = null;
  const seen = new WeakSet();
  const snap = () => {
    const anims = document.getAnimations();
    if (anims.length > window.__maxAnims) window.__maxAnims = anims.length;
    const board = document.getElementById('board');
    const celebrating = !!board && board.getAttribute('data-celebrating') === 'true';
    if (celebrating) window.__celebrated = true;
    for (const a of anims) {
      if (seen.has(a)) continue;
      const t = a.effect && a.effect.target;
      if (!t || !t.closest) continue;
      const timing = a.effect.getTiming();
      const rec = {duration: Number(timing.duration), delay: Number(timing.delay || 0)};
      const c = t.closest('[data-cell]');
      if (c && celebrating) {
        seen.add(a);
        const k = c.getAttribute('data-cell');
        (window.__cellAnims[k] = window.__cellAnims[k] || []).push(rec);
        continue;
      }
      const where = t.closest('#hem-count') ? 'count' : t.closest('#hem-opponent') ? 'opponent' : t.closest('#hem') ? 'hem' : null;
      if (where) { seen.add(a); window.__hemAnims.push(Object.assign({where}, rec)); }
    }
  };
  const said = () => {
    const el = document.getElementById('announcer');
    if (!el) return;
    const t = el.textContent.replace(/\s+/g, ' ').trim();
    if (t !== last) { last = t; if (t) window.__said.push(t); }
  };
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); queueMicrotask(snap); return a; };
  new MutationObserver(() => { said(); snap(); }).observe(document, {subtree: true, childList: true, characterData: true, attributes: true});
})();"""

SNAP_JS = r"""() => {
  const b = document.getElementById('board');
  if (!b) return null;
  const cells = {};
  for (const c of b.querySelectorAll('[data-cell]')) {
    cells[c.getAttribute('data-cell')] = {
      value: c.getAttribute('data-value'), notes: c.getAttribute('data-notes'),
      wrong: c.getAttribute('data-wrong'), hinted: c.getAttribute('data-hinted'),
      given: c.getAttribute('data-given'), label: c.getAttribute('aria-label'),
      selected: c.getAttribute('aria-selected'), tabindex: c.getAttribute('tabindex'),
      highlight: c.getAttribute('data-highlight'), focused: c === document.activeElement,
    };
  }
  return {state: b.getAttribute('data-state'), hidden: b.getAttribute('aria-hidden'),
          celebrating: b.getAttribute('data-celebrating'), cells};
}"""

BOARD_ROWS_JS = r"""() => [...document.getElementById('board').children]
  .filter(e => e.getAttribute('role') === 'row')
  .map(r => [...r.children].filter(e => e.getAttribute('role') === 'gridcell').map(c => c.getAttribute('data-cell')))"""

ANNOUNCER_JS = r"""() => { const all = document.querySelectorAll('#announcer'); const a = all[0];
  return a ? {count: all.length, role: a.getAttribute('role'), live: a.getAttribute('aria-live')} : null; }"""
WS_CLOSE_JS = r"""() => new Promise(resolve => {
  const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws');
  ws.onclose = e => resolve(e.code);
})"""
TEXT_JS = r"""(s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }"""
ATTR_JS = r"""([s, a]) => { const e = document.querySelector(s); return e ? e.getAttribute(a) : null; }"""
FOCUS_AFTER_BOARD_JS = r"""() => { const b = document.getElementById('board'), a = document.activeElement; return !!b && !!a && a !== document.body && !b.contains(a) && !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); }"""
FOCUS_IN_BOARD_JS = r"""() => { const a = document.activeElement; return !!a && !!a.closest && !!a.closest('#board'); }"""
FOCUS_ON_SELECTED_JS = r"""() => { const a = document.activeElement; return !!a && !!a.closest && !!a.closest('#board') && a.getAttribute('aria-selected') === 'true'; }"""
PANEL_JS = r"""p => { const out = {}; for (const dt of p.querySelectorAll('dt')) { const dd = dt.nextElementSibling; out[dt.textContent.replace(/\s+/g, ' ').trim()] = dd ? dd.textContent.replace(/\s+/g, ' ').trim() : null; } return out; }"""
TABLE_ROWS_JS = r"""t => [...t.querySelectorAll('tr, [role="row"]')].map(r => [...r.querySelectorAll('td, [role="cell"]')].map(c => c.textContent.replace(/\s+/g, ' ').trim())).filter(r => r.length)"""
LB_ROWS_JS = r"""t => [...t.querySelectorAll('[data-player]')].map(r => ({player: r.getAttribute('data-player'), current: r.getAttribute('aria-current'), cells: [...r.querySelectorAll('td, th, [role="cell"], [role="rowheader"]')].map(c => c.textContent.replace(/\s+/g, ' ').trim())}))"""
CAL_JS = r"""() => [...document.querySelectorAll('#calendar [data-date]')].map(c => ({date: c.getAttribute('data-date'), state: c.getAttribute('data-state'), label: c.getAttribute('aria-label'), disabled: c.getAttribute('aria-disabled'), tabindex: c.getAttribute('tabindex'), focused: c === document.activeElement, col: [...c.parentElement.children].indexOf(c)}))"""
HIDE_PAGE_JS = r"""() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); Object.defineProperty(document, 'hidden', {configurable: true, get: () => true}); document.dispatchEvent(new Event('visibilitychange')); }"""
SHOW_PAGE_JS = r"""() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); Object.defineProperty(document, 'hidden', {configurable: true, get: () => false}); }"""


def origin(base: str) -> str:
    u = urlparse(base)
    return f"{u.scheme}://{u.netloc}"


def instance(env: str) -> str:
    url = os.environ.get(env)
    if not url:
        pytest.fail(f"{env} is not set; the outage instance must be reachable")
    return url.rstrip("/")


def api(base: str, method: str, path: str, body: Any = None, session: str | None = None,
        raw: bytes | str | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
    h = {"Origin": origin(base)}
    if session is not None:
        h["Cookie"] = f"seam_session={session}"
    content: bytes | str | None = None
    if raw is not None:
        content = raw
    elif body is not None:
        content = json.dumps(body)
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    return httpx.request(method, base.rstrip("/") + path, headers=h, content=content, timeout=HTTP_TIMEOUT)


def code_of(resp: httpx.Response) -> str | None:
    body = resp.json() if resp.content else None
    return body["error"]["code"] if isinstance(body, dict) and isinstance(body.get("error"), dict) else None


def ident(prefix: str) -> str:
    tag = hashlib.sha1("|".join(unique(prefix)).encode()).hexdigest()[:10]
    return f"{prefix[:6]}{tag}"


def own_date() -> date:
    n = int(hashlib.sha1("|".join(unique("date")).encode()).hexdigest(), 16)
    return OWN_DATE_FROM + timedelta(days=n % OWN_DATE_SPAN)


def absent_code() -> str:
    n = int(hashlib.sha1("|".join(unique("code")).encode()).hexdigest(), 16)
    return "".join(CODE_ALPHABET[(n >> (5 * i)) % len(CODE_ALPHABET)] for i in range(6))


def long_date(d: date) -> str:
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def month_title(d: date) -> str:
    return f"{d.strftime('%B')} {d.year}"


def noon_of(d: date) -> str:
    return f"{d.isoformat()}T00:00:00Z"


def clock(seconds: int) -> str:
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def parse_clock(value: str) -> int:
    parts = [int(x) for x in value.split(":")]
    total = 0
    for p in parts:
        total = total * 60 + p
    return total


def score(level: str, secs: int, mistakes: int, hints: int) -> int:
    base = BASE_SCORE[level]
    return max(base // 10, base - secs - MISTAKE_COST * mistakes - HINT_COST * hints)


def plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def stitches(n: int) -> str:
    return f"{n} stitch" if n == 1 else f"{n} stitches"


def solved_text(secs: int, m: int, h: int, sc: int) -> str:
    return f"Solved in {clock(secs)} with {plural(m, 'mistake')} and {plural(h, 'hint')}. Score {sc}."


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls), timeout=HTTP_TIMEOUT)
    out: list[httpx.Response | None] = [None] * len(calls)

    def run(i: int) -> None:
        barrier.wait()
        out[i] = calls[i]()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(calls))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT * 2)
    assert all(r is not None for r in out), "a concurrent request never answered"
    return [r for r in out if r is not None]


def rc(name: str) -> tuple[int, int]:
    m = re.fullmatch(r"r(\d)c(\d)", name)
    assert m, name
    return int(m[1]), int(m[2])


def cell(i: int) -> str:
    return f"r{i // 9 + 1}c{i % 9 + 1}"


def idx(name: str) -> int:
    r, c = rc(name)
    return (r - 1) * 9 + (c - 1)


def box_of(r: int, c: int) -> int:
    return (r - 1) // 3 * 3 + (c - 1) // 3


def peers(name: str) -> list[str]:
    r, c = rc(name)
    out = []
    for i in range(81):
        n = cell(i)
        r2, c2 = rc(n)
        if n != name and (r2 == r or c2 == c or box_of(r2, c2) == box_of(r, c)):
            out.append(n)
    return out


def solution(pid: str, name: str) -> int:
    return int(PUZZLES[pid][1][idx(name)])


def givens(pid: str) -> dict[str, int]:
    return {cell(i): int(ch) for i, ch in enumerate(PUZZLES[pid][0]) if ch != "0"}


def empties(pid: str) -> list[str]:
    return [cell(i) for i, ch in enumerate(PUZZLES[pid][0]) if ch == "0"]


def fill_except(pid: str, keep: set[str]) -> list[dict[str, Any]]:
    return [{"cell": c, "digit": solution(pid, c)} for c in empties(pid) if c not in keep]


def wrong_digit(pid: str, name: str) -> int:
    return solution(pid, name) % 9 + 1


def hint_pick(pid: str, filled: dict[str, int]) -> tuple[str, int]:
    best: tuple[int, str] | None = None
    for i in range(81):
        n = cell(i)
        if n in filled:
            continue
        cands = 9 - len({filled[p] for p in peers(n) if p in filled})
        if best is None or cands < best[0]:
            best = (cands, n)
    assert best is not None
    return best[1], solution(pid, best[1])


def daily_puzzle(d: date) -> str:
    return f"daily-{(d - DAILY_EPOCH).days % 7 + 1}"


def level_of(pid: str) -> str:
    return "medium" if pid.startswith("daily") else pid.split("-")[0]


def enter(n: int, t: int, c: str, d: int) -> dict[str, Any]:
    return {"n": n, "t": t, "op": "enter", "cell": c, "digit": d}


def expected_highlights(sel: str, values: dict[str, int]) -> dict[str, str]:
    r0, c0 = rc(sel)
    sv = values.get(sel)
    out = {}
    for i in range(81):
        n = cell(i)
        if n == sel:
            out[n] = "selected"
            continue
        r, c = rc(n)
        t = []
        if r == r0:
            t.append("row")
        if c == c0:
            t.append("column")
        if box_of(r, c) == box_of(r0, c0):
            t.append("box")
        if sv is not None and values.get(n) == sv:
            t.append("same-digit")
        out[n] = " ".join(t)
    return out


def label(name: str, rest: str) -> str:
    r, c = rc(name)
    return f"Row {r}, column {c}, {rest}"


def notes_label(name: str, digits: list[int]) -> str:
    return label(name, "empty, notes " + " ".join(str(d) for d in sorted(digits)))


def make_players(base: str, *prefixes: str, verified: bool = True) -> list[dict[str, Any]]:
    specs = []
    for p in prefixes:
        name = ident(p)
        specs.append({"key": name, "email": f"{name.lower()}@example.test", "display_name": name,
                      "password": PASSWORD, "verified": verified})
    r = api(base, "POST", "/api/grading/players", {"players": specs})
    assert r.status_code == 201, r.text
    made = {o["key"]: o for o in r.json()["players"]}
    return [{**s, **made[s["key"]]} for s in specs]


def make_player(base: str, prefix: str, verified: bool = True) -> dict[str, Any]:
    return make_players(base, prefix, verified=verified)[0]


def seed_body(player: dict[str, Any], pid: str, *, mode: str = "solo", day: str | None = None,
              entries: list[dict[str, Any]] | None = None, notes: list[dict[str, Any]] | None = None,
              mistakes: int = 0, hints: int = 0, elapsed_ms: int = 0, second_chance_used: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {"player_id": player["player_id"], "puzzle_id": pid, "mode": mode,
                            "entries": entries or [], "notes": notes or [], "mistakes": mistakes,
                            "hints": hints, "elapsed_ms": elapsed_ms, "second_chance_used": second_chance_used}
    if day is not None:
        body["date"] = day
    return body


def seed_game(base: str, player: dict[str, Any], pid: str, **kw: Any) -> str:
    r = api(base, "POST", "/api/grading/games", seed_body(player, pid, **kw))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["url"] == f"/play/{body['id']}"
    return body["id"]


def daily_result(base: str, player: dict[str, Any], day: str, finished_at: str, elapsed_ms: int = DAILY_ELAPSED,
                 mistakes: int = 0, hints: int = 0) -> str:
    r = api(base, "POST", "/api/grading/daily-results",
            {"player_id": player["player_id"], "date": day, "finished_at": finished_at,
             "elapsed_ms": elapsed_ms, "mistakes": mistakes, "hints": hints})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def finished_game(base: str, player: dict[str, Any], level: str, result: str, elapsed_ms: int,
                  mistakes: int, hints: int, finished_at: str) -> str:
    r = api(base, "POST", "/api/grading/finished-games",
            {"player_id": player["player_id"], "level": level, "result": result, "elapsed_ms": elapsed_ms,
             "mistakes": mistakes, "hints": hints, "finished_at": finished_at})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@contextlib.contextmanager
def server_clock(base: str, now: str) -> Iterator[None]:
    r = api(base, "POST", "/api/grading/clock", {"now": now})
    assert r.status_code == 200, r.text
    try:
        yield
    finally:
        api(base, "POST", "/api/grading/clock", {"now": None})


def set_clock(base: str, now: str) -> None:
    r = api(base, "POST", "/api/grading/clock", {"now": now})
    assert r.status_code == 200, r.text


def get_game(base: str, player: dict[str, Any], gid: str) -> dict[str, Any]:
    r = api(base, "GET", f"/api/games/{gid}", session=player["session"])
    assert r.status_code == 200, r.text
    return r.json()["game"]


def finish(base: str, player: dict[str, Any] | None, gid: str, body: Any) -> httpx.Response:
    return api(base, "POST", f"/api/games/{gid}/finish", body, session=player["session"] if player else None)


def get_profile(base: str, player: dict[str, Any]) -> dict[str, Any]:
    r = api(base, "GET", "/api/profile", session=player["session"])
    assert r.status_code == 200, r.text
    return r.json()


def get_daily(base: str, player: dict[str, Any], month: str | None = None) -> dict[str, Any]:
    r = api(base, "GET", "/api/daily" + (f"?month={month}" if month else ""), session=player["session"])
    assert r.status_code == 200, r.text
    return r.json()


def leaderboard(base: str, player: dict[str, Any], d: date) -> dict[str, Any]:
    r = api(base, "GET", f"/api/leaderboard/{d.isoformat()}", session=player["session"])
    assert r.status_code == 200, r.text
    return r.json()


def finish_daily(base: str, player: dict[str, Any], d: date) -> tuple[str, dict[str, Any]]:
    pid = daily_puzzle(d)
    last = empties(pid)[-1]
    gid = seed_game(base, player, pid, mode="daily", day=d.isoformat(), entries=fill_except(pid, {last}),
                    elapsed_ms=DAILY_ELAPSED)
    r = finish(base, player, gid, {"moves": [enter(1, DAILY_ELAPSED, last, solution(pid, last))]})
    assert r.status_code == 200, r.text
    return gid, r.json()["result"]


def wait_api(predicate: Callable[[], bool], what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
    pytest.fail(f"timed out waiting for {what}")


def wait_moves(base: str, player: dict[str, Any], gid: str, ops: list[str],
               skip: tuple[str, ...] = (), closed: bool = False) -> list[dict[str, Any]]:
    box: dict[str, Any] = {}

    def ok() -> bool:
        box["moves"] = get_game(base, player, gid)["moves"]
        seen = [m["op"] for m in box["moves"] if m["op"] not in skip]
        return seen == ops or (closed and seen == ops + ["pause"])

    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        if ok():
            return box["moves"]
    pytest.fail(f"stored move log ops were {[m['op'] for m in box.get('moves', [])]}; expected {ops}")


def mails_to(mail: Mailpit, email: str, subject: str | None = None) -> list[dict[str, Any]]:
    out = []
    for m in mail.messages():
        if email.lower() in [a.lower() for a in addresses(m.get("To"))] and (subject is None or m.get("Subject") == subject):
            out.append(m)
    return out


def wait_mail(mail: Mailpit, email: str, subject: str, count: int = 1) -> list[dict[str, Any]]:
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        found = mails_to(mail, email, subject)
        if len(found) >= count:
            return found
    pytest.fail(f'Mailpit never received {count} "{subject}" message(s) for {email}')


def link_token(base: str, message: dict[str, Any], kind: str) -> str:
    m = re.search(re.escape(origin(base)) + rf"/{kind}/([A-Za-z0-9_\-.~%]+)", text(message))
    assert m, f"message has no {origin(base)}/{kind}/<token> link"
    return m[1]


@contextlib.contextmanager
def visit(browser: Browser, base: str, path: str, player: dict[str, Any] | None = None, *,
          reduced_motion: str = "no-preference", viewport: tuple[int, int] | None = None,
          hook: Callable[[Page], None] | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion=reduced_motion) as page:
        page.context.add_init_script(script=RECORDER_JS)
        if player is not None:
            page.context.add_cookies([{"name": "seam_session", "value": player["session"], "url": origin(base)}])
        if viewport is not None:
            page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        if hook is not None:
            hook(page)
        page.goto(base + path)
        yield page


def wait_for(page: Page, predicate: Callable[[], bool], what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except PlaywrightError:
            pass
        advance(page, STEP_MS)
    pytest.fail(f"timed out: expected {what}")


def wait_live(page: Page, predicate: Callable[[], bool], what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except PlaywrightError:
            pass
        page.evaluate("() => 0")
    pytest.fail(f"timed out (page clock untouched): expected {what}")


def snap(page: Page) -> dict[str, Any] | None:
    return page.evaluate(SNAP_JS)


def cells(page: Page) -> dict[str, dict[str, Any]]:
    s = snap(page)
    return s["cells"] if s else {}


def selected_cell(page: Page) -> str | None:
    for k, v in cells(page).items():
        if v["selected"] == "true":
            return k
    return None


def board_state(page: Page) -> str | None:
    s = snap(page)
    return s["state"] if s else None


def wait_board(page: Page) -> None:
    wait_for(page, lambda: len(cells(page)) == 81 and selected_cell(page) is not None,
             "#board with 81 cells and one selected cell")


def wait_cell(page: Page, name: str, **want: Any) -> None:
    def ok() -> bool:
        c = cells(page).get(name)
        return c is not None and all(c[k] == v for k, v in want.items())
    wait_for(page, ok, f"{name} with {want}")


def text_of(page: Page, selector: str) -> str | None:
    return page.evaluate(TEXT_JS, selector)


def attr_of(page: Page, selector: str, name: str) -> str | None:
    return page.evaluate(ATTR_JS, [selector, name])


def wait_text(page: Page, selector: str, expected: str) -> None:
    wait_for(page, lambda: text_of(page, selector) == expected, f'{selector} reads "{expected}"')


def said(page: Page) -> list[str]:
    return page.evaluate("() => window.__said || []")


def wait_said(page: Page, sentence: str, times: int = 1) -> None:
    wait_for(page, lambda: said(page).count(sentence) >= times, f'#announcer said "{sentence}" {times} time(s)')


def button(scope: Page | Locator, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def dialog(page: Page, name: str, role: str = "dialog") -> Locator:
    return page.get_by_role(role, name=name, exact=True)


def board_grid(page: Page) -> Locator:
    return page.get_by_role("grid", name="Puzzle board", exact=True)


def timer_of(page: Page) -> Locator:
    return page.get_by_role("timer", name="Time", exact=True)


def shown(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def wait_shown(page: Page, loc: Locator, what: str) -> None:
    wait_for(page, lambda: shown(loc), what)


def focused(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("e => e === document.activeElement")


def wait_focused(page: Page, loc: Locator, what: str) -> None:
    wait_for(page, lambda: focused(loc), f"focus on {what}")


def is_disabled(loc: Locator) -> bool:
    return loc.first.evaluate("e => e.disabled === true || e.getAttribute('aria-disabled') === 'true'")


def focus_inside(loc: Locator) -> bool:
    return loc.first.evaluate("d => d.contains(document.activeElement)")


def tab_to_board(page: Page) -> None:
    if page.evaluate(FOCUS_ON_SELECTED_JS):
        return
    key = "Shift+Tab" if page.evaluate(FOCUS_AFTER_BOARD_JS) else "Tab"
    for _ in range(TAB_LIMIT):
        page.keyboard.press(key)
        if page.evaluate(FOCUS_ON_SELECTED_JS):
            return
    pytest.fail("Tab never reached the board's selected cell (one Tab stop on #board)")


def go(page: Page, target: str) -> None:
    cur = selected_cell(page)
    assert cur is not None
    r0, c0 = rc(cur)
    r1, c1 = rc(target)
    for _ in range(abs(r1 - r0)):
        page.keyboard.press("ArrowDown" if r1 > r0 else "ArrowUp")
    for _ in range(abs(c1 - c0)):
        page.keyboard.press("ArrowRight" if c1 > c0 else "ArrowLeft")
    wait_for(page, lambda: selected_cell(page) == target, f"selection moved to {target}")


def cell_loc(page: Page, name: str) -> Locator:
    r, c = rc(name)
    return board_grid(page).get_by_role("gridcell", name=re.compile(rf"^Row {r}, column {c}, "))


def headings(page: Page) -> list[str]:
    return [" ".join(t.split()) for t in page.get_by_role("heading", level=1).all_text_contents()]


def wait_heading(page: Page, expected: str) -> None:
    wait_for(page, lambda: headings(page) == [expected], f'one h1 "{expected}"')


def cookie_session(page: Page) -> str:
    for c in page.context.cookies():
        if c["name"] == "seam_session":
            return c["value"]
    pytest.fail("no seam_session cookie in the browser")


def panel_values(page: Page) -> dict[str, str]:
    panel = page.get_by_role("tabpanel")
    return panel.first.evaluate(PANEL_JS) if panel.count() else {}


def finished_rows(page: Page) -> list[list[str]]:
    t = page.get_by_role("table", name="Finished games", exact=True)
    return t.first.evaluate(TABLE_ROWS_JS) if t.count() else []


def listen(page: Page, sink: list[dict[str, Any]]) -> None:
    def on_ws(ws: Any) -> None:
        def on_frame(payload: Any) -> None:
            if isinstance(payload, str):
                with contextlib.suppress(ValueError):
                    msg = json.loads(payload)
                    if isinstance(msg, dict):
                        msg["_at"] = time.monotonic()
                        msg["_raw"] = payload
                        sink.append(msg)
        ws.on("framereceived", on_frame)
    page.on("websocket", on_ws)


def frames_of(frames: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [f for f in frames if f.get("type") == kind]


def public_keys(frame: dict[str, Any]) -> set[str]:
    return {k for k in frame if not k.startswith("_")}


def wait_frame(page: Page, frames: list[dict[str, Any]], kind: str, what: str,
               pred: Callable[[dict[str, Any]], bool] | None = None, seconds: float = WAIT_S) -> dict[str, Any]:
    wait_for(page, lambda: any(pred is None or pred(f) for f in frames_of(frames, kind)), what, seconds)
    return next(f for f in frames_of(frames, kind) if pred is None or pred(f))


@dataclasses.dataclass
class Duel:
    base: str
    a: dict[str, Any]
    b: dict[str, Any]
    code: str
    pa: Page
    pb: Page
    fa: list[dict[str, Any]]
    fb: list[dict[str, Any]]


def create_room(base: str, player: dict[str, Any], level: str) -> str:
    r = api(base, "POST", "/api/duels", {"level": level}, session=player["session"])
    assert r.status_code == 201, r.text
    return r.json()["room"]["code"]


@contextlib.contextmanager
def duel_pages(browser: Browser, base: str, level: str) -> Iterator[Duel]:
    a, b = make_players(base, "duA", "duB")
    code = create_room(base, a, level)
    r = api(base, "POST", "/api/duels/join", {"code": code}, session=b["session"])
    assert r.status_code == 200, r.text
    fa: list[dict[str, Any]] = []
    fb: list[dict[str, Any]] = []
    with visit(browser, base, f"/duel/{code}", a, hook=lambda pg: listen(pg, fa)) as pa, \
            visit(browser, base, f"/duel/{code}", b, hook=lambda pg: listen(pg, fb)) as pb:
        yield Duel(base, a, b, code, pa, pb, fa, fb)


def press_ready(page: Page) -> None:
    ready = button(page, "Ready")
    wait_shown(page, ready, "the Ready button")
    click(ready)


def start_duel(d: Duel) -> None:
    press_ready(d.pa)
    press_ready(d.pb)
    wait_frame(d.pa, d.fa, "start", "the server's start message to the first duelist")
    wait_frame(d.pb, d.fb, "start", "the server's start message to the second duelist")
    wait_board(d.pa)
    wait_board(d.pb)


def duel_enter(page: Page, entries: list[tuple[str, int]]) -> None:
    for name, digit in entries:
        click(cell_loc(page, name))
        page.keyboard.press(str(digit))


def solve_entries(pid: str, skip: set[str] = frozenset()) -> list[tuple[str, int]]:
    return [(c, solution(pid, c)) for c in empties(pid) if c not in skip]


def test_board_grid(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "grid")
    gid = seed_game(app_url, p, "easy-1", entries=[{"cell": "r1c3", "digit": 4}],
                    notes=[{"cell": "r1c2", "digits": [8, 1]}])
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        grid = board_grid(page)
        assert grid.count() == 1 and grid.get_attribute("id") == "board"
        assert page.evaluate(BOARD_ROWS_JS) == [[f"r{r}c{c}" for c in range(1, 10)] for r in range(1, 10)]
        s = snap(page)
        assert s is not None and s["state"] == "playing"
        for i in range(81):
            name = cell(i)
            c = s["cells"][name]
            g = int(PUZZLES["easy-1"][0][i])
            assert c["given"] == ("true" if g else "false"), name
            assert c["value"] == (str(g) if g else ("4" if name == "r1c3" else "")), name
            assert c["notes"] == ("1 8" if name == "r1c2" else ""), name
            assert c["wrong"] == "false" and c["hinted"] == "false", name
            assert c["highlight"] is not None, name
        assert [k for k, v in s["cells"].items() if v["selected"] == "true"] == ["r1c1"]
        assert all(v["selected"] == "false" for k, v in s["cells"].items() if k != "r1c1")
        assert [k for k, v in s["cells"].items() if v["tabindex"] == "0"] == ["r1c1"]
        assert all(v["tabindex"] == "-1" for k, v in s["cells"].items() if k != "r1c1")
        tab_to_board(page)
        page.keyboard.press("Tab")
        assert not page.evaluate(FOCUS_IN_BOARD_JS), "a second Tab press stayed inside the board"


KEY_MOVES = [("ArrowLeft", "r1c9"), ("ArrowUp", "r9c9"), ("ArrowRight", "r9c1"), ("ArrowDown", "r1c1"),
             ("End", "r1c9"), ("Home", "r1c1"), ("ArrowDown", "r2c1"), ("ArrowRight", "r2c2"), ("ArrowUp", "r1c2")]


def test_keyboard_movement(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "move")
    gid = seed_game(app_url, p, "easy-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        assert selected_cell(page) == "r1c1"
        tab_to_board(page)
        for key, target in KEY_MOVES:
            page.keyboard.press(key)

            def ok(t: str = target) -> bool:
                cs = cells(page)
                return ([k for k, v in cs.items() if v["selected"] == "true"] == [t]
                        and [k for k, v in cs.items() if v["tabindex"] == "0"] == [t]
                        and [k for k, v in cs.items() if v["focused"]] == [t])
            wait_for(page, ok, f"{key} selects and focuses {target} (the only tabindex=0 cell)")


def test_cell_labels(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "label")
    gid = seed_game(app_url, p, "easy-1", entries=[{"cell": "r1c3", "digit": 4}],
                    notes=[{"cell": "r1c2", "digits": [8, 1]}])
    g = givens("easy-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        cs = cells(page)
        for i in range(81):
            n = cell(i)
            if n in g:
                want = label(n, f"given {g[n]}")
            elif n == "r1c3":
                want = label(n, "4")
            elif n == "r1c2":
                want = notes_label(n, [1, 8])
            else:
                want = label(n, "empty")
            assert cs[n]["label"] == want
        tab_to_board(page)
        page.keyboard.press("5")
        wait_cell(page, "r1c1", label=label("r1c1", "5, wrong"))
        page.keyboard.press("h")
        wait_for(page, lambda: any(v["hinted"] == "true" for v in cells(page).values()), "a hinted cell")
        hinted = next(k for k, v in cells(page).items() if v["hinted"] == "true")
        wait_cell(page, hinted, label=label(hinted, f"{solution('easy-1', hinted)}, hint"))
        page.keyboard.press("p")
        wait_for(page, lambda: board_state(page) == "paused", "paused board")
        cs = cells(page)
        assert all(cs[cell(i)]["label"] == label(cell(i), "hidden") for i in range(81))


@pytest.mark.timeout(600)
def test_wf_keyboard_finish_happy(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "kbd")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        with held(page, "**/api/games/*/finish") as gate:
            page.keyboard.press("4")
            wait_cell(page, "r9c9", value="4", wrong="false")
            wait_said(page, "Checking your game.")
            assert page.get_by_text("Checking your game.", exact=True).count() >= 2, "M22 is not shown over the board"
            gate.release()
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "the Puzzle solved dialog")
        wait_focused(page, button(solved, "New game"), "New game")
        game = get_game(app_url, p, gid)
        assert game["status"] == "won"
        res = game["result"]
        expect(solved).to_contain_text(solved_text(res["seconds"], res["mistakes"], res["hints"], res["score"]))
        wait_said(page, f"Solved in {clock(res['seconds'])}. Score {res['score']}.")
    assert get_profile(app_url, p)["levels"]["easy"]["won"] == 1


def test_wf_keyboard_finish_focus_on_button(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "kbdbtn")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c8", "r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        assert selected_cell(page) == "r9c8"
        button(page, "Undo").focus()
        page.keyboard.press("3")
        wait_cell(page, "r9c8", value="3")
        button(page, "Erase").focus()
        page.keyboard.press("ArrowRight")
        wait_for(page, lambda: page.evaluate(FOCUS_ON_SELECTED_JS) and selected_cell(page) == "r9c9",
                 "ArrowRight from a button selects and focuses r9c9")
        button(page, "Redo").focus()
        page.keyboard.press("4")
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "the Puzzle solved dialog")
        wait_focused(page, button(solved, "New game"), "New game")
        for key in ["Tab"] * 4 + ["Shift+Tab"] * 4:
            page.keyboard.press(key)
            assert focus_inside(solved), f"{key} left the Puzzle solved dialog"
        page.keyboard.press("Escape")
        wait_for(page, lambda: not shown(solved) and page.evaluate(FOCUS_ON_SELECTED_JS),
                 "Escape closes Puzzle solved and focus returns to the selected cell")
    assert get_game(app_url, p, gid)["status"] == "won"


def test_entries_and_notes(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "notes")
    gid = seed_game(app_url, p, "easy-1", notes=[{"cell": "r1c2", "digits": [6, 8]}, {"cell": "r2c3", "digits": [1, 6]},
                                                {"cell": "r9c1", "digits": [6]}, {"cell": "r5c5", "digits": [6]}])
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("n")
        wait_for(page, lambda: button(page, "Notes").get_attribute("aria-pressed") == "true", "Notes pressed")
        wait_said(page, "Notes on.")
        page.keyboard.press("3")
        wait_cell(page, "r1c1", notes="3")
        wait_said(page, "Note 3 added to row 1, column 1.")
        page.keyboard.press("3")
        wait_cell(page, "r1c1", notes="")
        wait_said(page, "Note 3 removed from row 1, column 1.")
        page.keyboard.press("7")
        wait_cell(page, "r1c1", notes="7")
        page.keyboard.press("N")
        wait_said(page, "Notes off.")
        page.keyboard.press("5")
        wait_cell(page, "r1c1", value="5", wrong="true", notes="")
        wait_said(page, "Row 1, column 1, 5, wrong. Mistakes 1 of 3.")
        wait_text(page, "#mistakes", "Mistakes: 1/3")
        page.keyboard.press("5")
        page.keyboard.press("n")
        page.keyboard.press("2")
        page.keyboard.press("n")
        wait_said(page, "Notes off.", times=2)
        cs = cells(page)
        assert cs["r1c1"]["value"] == "5" and cs["r1c1"]["notes"] == "" and text_of(page, "#mistakes") == "Mistakes: 1/3"
        page.keyboard.press("6")
        wait_cell(page, "r1c1", value="6", wrong="false")
        wait_said(page, "Row 1, column 1, 6.")
        cs = cells(page)
        assert (cs["r1c2"]["notes"], cs["r2c3"]["notes"], cs["r9c1"]["notes"], cs["r5c5"]["notes"]) == ("8", "1", "", "6")
        page.keyboard.press("4")
        wait_said(page, "Correct entries can't be changed.")
        go(page, "r1c4")
        page.keyboard.press("1")
        wait_said(page, "Given cells can't be changed.")
        page.keyboard.press("n")
        page.keyboard.press("1")
        wait_said(page, "Given cells can't be changed.", times=2)
        cs = cells(page)
        assert cs["r1c1"]["value"] == "6" and cs["r1c4"]["value"] == "3" and cs["r1c4"]["notes"] == ""


def test_undo_redo(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "undo")
    gid = seed_game(app_url, p, "easy-1", notes=[{"cell": "r1c2", "digits": [6, 8]}, {"cell": "r9c1", "digits": [6]}])
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("Control+z")
        wait_said(page, "Nothing to undo.")
        page.keyboard.press("Control+y")
        wait_said(page, "Nothing to redo.")
        page.keyboard.press("6")
        wait_cell(page, "r1c1", value="6")
        wait_cell(page, "r1c2", notes="8")
        wait_cell(page, "r9c1", notes="")
        page.keyboard.press("Control+z")
        wait_cell(page, "r1c1", value="")
        wait_cell(page, "r1c2", notes="6 8")
        wait_cell(page, "r9c1", notes="6")
        wait_said(page, "Undone.")
        page.keyboard.press("Control+Shift+Z")
        wait_cell(page, "r1c1", value="6")
        wait_cell(page, "r1c2", notes="8")
        wait_cell(page, "r9c1", notes="")
        wait_said(page, "Redone.")
        go(page, "r1c2")
        page.keyboard.press("Delete")
        wait_cell(page, "r1c2", notes="")
        wait_said(page, "Row 1, column 2 erased.")
        page.keyboard.press("Control+z")
        wait_cell(page, "r1c2", notes="8")
        page.keyboard.press("Control+y")
        wait_cell(page, "r1c2", notes="")
        page.keyboard.press("9")
        wait_cell(page, "r1c2", value="9", wrong="true")
        wait_text(page, "#mistakes", "Mistakes: 1/3")
        page.keyboard.press("Control+z")
        wait_cell(page, "r1c2", value="", wrong="false", notes="")
        assert text_of(page, "#mistakes") == "Mistakes: 1/3"
        page.keyboard.press("Control+Shift+Z")
        wait_cell(page, "r1c2", value="9", wrong="true")
        assert text_of(page, "#mistakes") == "Mistakes: 1/3"
        page.keyboard.press("Backspace")
        wait_cell(page, "r1c2", value="", wrong="false")
        page.keyboard.press("Control+z")
        wait_cell(page, "r1c2", value="9", wrong="true")
        page.keyboard.press("8")
        wait_cell(page, "r1c2", value="8", wrong="false")
        page.keyboard.press("Control+Shift+Z")
        wait_said(page, "Nothing to redo.", times=2)
        assert cells(page)["r1c2"]["value"] == "8"


def test_erase_and_locked_cells(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "erase")
    gid = seed_game(app_url, p, "easy-1", entries=[{"cell": "r1c3", "digit": 4}], notes=[{"cell": "r1c2", "digits": [1, 8]}])
    filled = {**givens("easy-1"), "r1c3": 4}
    hint_cell, hint_digit = hint_pick("easy-1", filled)
    wrong_cell = next(c for c in empties("easy-1") if c not in {hint_cell, "r1c2", "r1c3"})
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("Delete")
        go(page, "r1c2")
        page.keyboard.press("Delete")
        wait_cell(page, "r1c2", notes="")
        wait_said(page, "Row 1, column 2 erased.")
        go(page, "r1c3")
        page.keyboard.press("Delete")
        wait_said(page, "Correct entries can't be changed.")
        go(page, "r1c4")
        page.keyboard.press("Delete")
        wait_said(page, "Given cells can't be changed.")
        page.keyboard.press("h")
        wait_cell(page, hint_cell, value=str(hint_digit), hinted="true", selected="true")
        page.keyboard.press("Delete")
        wait_said(page, "Hinted cells can't be changed.")
        page.keyboard.press(str(wrong_digit("easy-1", hint_cell)))
        wait_said(page, "Hinted cells can't be changed.", times=2)
        go(page, wrong_cell)
        page.keyboard.press(str(wrong_digit("easy-1", wrong_cell)))
        wait_cell(page, wrong_cell, wrong="true")
        page.keyboard.press("Delete")
        wait_cell(page, wrong_cell, value="", wrong="false")
        cs = cells(page)
        assert cs["r1c3"]["value"] == "4" and cs["r1c4"]["value"] == "3" and cs[hint_cell]["value"] == str(hint_digit)
    wait_moves(app_url, p, gid, ["erase", "hint", "enter", "erase"], closed=True)


def test_wf_notes_undo_worked_example(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "wex")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("n")
        wait_said(page, "Notes on.")
        for target, digits in (("r4c2", "37"), ("r5c3", "35"), ("r1c1", "3")):
            go(page, target)
            for d in digits:
                page.keyboard.press(d)
        wait_cell(page, "r1c1", notes="3")
        page.keyboard.press("n")
        go(page, "r4c3")
        page.keyboard.press("3")
        wait_cell(page, "r4c3", value="3", label=label("r4c3", "3"))
        wait_said(page, "Row 4, column 3, 3.")
        cs = cells(page)
        assert (cs["r4c2"]["notes"], cs["r5c3"]["notes"], cs["r1c1"]["notes"]) == ("7", "5", "3")
        assert cs["r4c2"]["label"] == notes_label("r4c2", [7])
        page.keyboard.press("Control+z")
        wait_cell(page, "r4c3", value="", label=label("r4c3", "empty"))
        wait_said(page, "Undone.")
        cs = cells(page)
        assert (cs["r4c2"]["notes"], cs["r5c3"]["notes"], cs["r1c1"]["notes"]) == ("3 7", "3 5", "3")
        assert cs["r4c2"]["label"] == notes_label("r4c2", [3, 7])
        assert cs["r5c3"]["label"] == notes_label("r5c3", [3, 5])
        page.keyboard.press("Control+Shift+Z")
        wait_cell(page, "r4c3", value="3")
        wait_said(page, "Redone.")
        cs = cells(page)
        assert (cs["r4c2"]["notes"], cs["r5c3"]["notes"], cs["r1c1"]["notes"]) == ("7", "5", "3")
    moves = wait_moves(app_url, p, gid, ["note"] * 5 + ["enter", "undo", "redo"], closed=True)
    assert [(m.get("cell"), m.get("digit")) for m in moves[:6]] == [
        ("r4c2", 3), ("r4c2", 7), ("r5c3", 3), ("r5c3", 5), ("r1c1", 3), ("r4c3", 3)]


def test_wf_notes_undo_buttons(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "wbtn")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        pad = page.get_by_role("group", name="Number pad", exact=True)
        click(button(page, "Notes"))
        wait_for(page, lambda: button(page, "Notes").get_attribute("aria-pressed") == "true", "Notes pressed")
        click(cell_loc(page, "r4c2"))
        click(button(pad, "Digit 3"))
        click(button(pad, "Digit 7"))
        wait_cell(page, "r4c2", notes="3 7")
        click(button(page, "Notes"))
        click(cell_loc(page, "r4c3"))
        click(button(pad, "Digit 3"))
        wait_cell(page, "r4c3", value="3")
        wait_cell(page, "r4c2", notes="7")
        click(button(page, "Undo"))
        wait_cell(page, "r4c3", value="")
        wait_cell(page, "r4c2", notes="3 7")
        click(button(page, "Redo"))
        wait_cell(page, "r4c2", notes="7")
        click(cell_loc(page, "r4c2"))
        click(button(page, "Erase"))
        wait_cell(page, "r4c2", notes="")
        click(button(page, "Undo"))
        wait_cell(page, "r4c2", notes="7")
    wait_moves(app_url, p, gid, ["note", "note", "enter", "undo", "redo", "erase", "undo"], closed=True)


def test_mistake_limit(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "limit")
    gid = seed_game(app_url, p, "easy-1", mistakes=1)
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        wait_text(page, "#mistakes", "Mistakes: 1/3")
        tab_to_board(page)
        page.keyboard.press("5")
        wait_text(page, "#mistakes", "Mistakes: 2/3")
        wait_said(page, "Row 1, column 1, 5, wrong. Mistakes 2 of 3.")
        page.keyboard.press("7")
        over = dialog(page, "Game over", "alertdialog")
        wait_shown(page, over, "the Game over alertdialog")
        expect(over).to_contain_text(f"You made {MISTAKE_LIMIT} mistakes.")
        expect(over).not_to_contain_text("Your second chance is used.")
        wait_focused(page, button(over, "Second chance"), "Second chance")
        wait_said(page, f"Game over. {MISTAKE_LIMIT} mistakes.")
        assert board_state(page) == "lost"
        before = text_of(page, "#timer")
        advance(page, 3000)
        assert text_of(page, "#timer") == before, "the clock kept running after game over"
        page.keyboard.press("Escape")
        assert shown(over), "Escape closed Game over"
    wait_api(lambda: get_game(app_url, p, gid)["status"] == "lost", "the stored game becomes lost")


def test_second_chance(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "chance")
    gid = seed_game(app_url, p, "easy-1", mistakes=2,
                    notes=[{"cell": "r1c2", "digits": [5, 8]}, {"cell": "r9c1", "digits": [5, 6]}])
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("5")
        over = dialog(page, "Game over", "alertdialog")
        wait_shown(page, over, "Game over")
        assert cells(page)["r1c2"]["notes"] == "8" and cells(page)["r9c1"]["notes"] == "6"
        wait_focused(page, button(over, "Second chance"), "Second chance")
        page.keyboard.press("Enter")
        wait_for(page, lambda: not shown(over), "Game over closes")
        wait_cell(page, "r1c1", value="", wrong="false", focused=True)
        cs = cells(page)
        assert cs["r1c2"]["notes"] == "5 8" and cs["r9c1"]["notes"] == "5 6"
        wait_text(page, "#mistakes", "Mistakes: 2/3")
        wait_said(page, "Second chance. Mistakes 2 of 3.")
        assert board_state(page) == "playing"
        page.keyboard.press("Control+z")
        wait_said(page, "Nothing to undo.")
        page.keyboard.press("7")
        wait_shown(page, over, "the final Game over")
        expect(over).to_contain_text(f"You made {MISTAKE_LIMIT} mistakes. Your second chance is used.")
        assert button(over, "Second chance").count() == 0
        wait_focused(page, button(over, "New game"), "New game")
    wait_api(lambda: get_game(app_url, p, gid)["status"] == "lost", "the stored game becomes lost")
    assert "second_chance" in [m["op"] for m in get_game(app_url, p, gid)["moves"]]


def test_wf_mistakes_second_chance_final_loss(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "loss")
    gid = seed_game(app_url, p, "easy-1", mistakes=2)
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("5")
        over = dialog(page, "Game over", "alertdialog")
        wait_shown(page, over, "Game over")
        expect(over).to_contain_text(f"You made {MISTAKE_LIMIT} mistakes.")
        wait_said(page, f"Game over. {MISTAKE_LIMIT} mistakes.")
        click(button(over, "Second chance"))
        wait_said(page, "Second chance. Mistakes 2 of 3.")
        page.keyboard.press("7")
        wait_shown(page, over, "the final Game over")
        wait_api(lambda: get_game(app_url, p, gid)["status"] == "lost", "lost is stored")
        page.reload()
        wait_board(page)
        wait_shown(page, over, "Game over after reload")
        assert board_state(page) == "lost"
        expect(over).to_contain_text(f"You made {MISTAKE_LIMIT} mistakes. Your second chance is used.")
        assert button(over, "Second chance").count() == 0
        wait_focused(page, button(over, "New game"), "New game")
        page.goto(app_url + "/profile")
        wait_for(page, lambda: any("Lost" in r for r in finished_rows(page)), "a Lost row in Finished games")
        click(page.get_by_role("tab", name="Easy", exact=True))
        wait_for(page, lambda: panel_values(page).get("Games started") == "1", "Easy Games started 1")
        vals = panel_values(page)
        assert vals["Games won"] == "0" and vals["Win rate"] == "0%"
        row = next(r for r in finished_rows(page) if "Lost" in r)
        assert "Easy" in row and row[-1] == "-"
    prof = get_profile(app_url, p)
    assert prof["levels"]["easy"]["started"] == 1 and prof["levels"]["easy"]["won"] == 0
    mine = [g for g in prof["finished_games"] if g["id"] == gid]
    assert len(mine) == 1 and mine[0]["result"] == "lost" and mine[0]["score"] is None


def test_wf_mistakes_second_chance_reopen(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "reopen")
    gid = seed_game(app_url, p, "easy-1", mistakes=2, elapsed_ms=61000)
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("5")
        over = dialog(page, "Game over", "alertdialog")
        wait_shown(page, over, "Game over")
        wait_api(lambda: get_game(app_url, p, gid)["status"] == "lost", "lost is stored")
        page.reload()
        wait_board(page)
        wait_shown(page, over, "Game over after reload")
        expect(over).to_contain_text(f"You made {MISTAKE_LIMIT} mistakes.")
        wait_focused(page, button(over, "Second chance"), "Second chance")
        assert board_state(page) == "lost"
        frozen = text_of(page, "#timer")
        advance(page, 2000)
        assert text_of(page, "#timer") == frozen
        assert gid not in [g["id"] for g in get_profile(app_url, p)["finished_games"]]
        page.goto(app_url + "/")
        new_easy = button(page, "New Easy game")
        wait_shown(page, new_easy, "the New Easy game button")
        click(new_easy)
        wait_for(page, lambda: re.search(r"/play/[^/]+$", page.url) is not None and gid not in page.url,
                 "a new Easy game opens at /play/<id>")
        page.goto(app_url + "/profile")
        wait_for(page, lambda: any("Lost" in r for r in finished_rows(page)), "the closed lost game listed as Lost")
    mine = [g for g in get_profile(app_url, p)["finished_games"] if g["id"] == gid]
    assert len(mine) == 1 and mine[0]["result"] == "lost"


HINT_CASES = ["wrong_first", "hard_2", "expert_3"]


@pytest.mark.parametrize("case", HINT_CASES, ids=HINT_CASES)
def test_hint_choice(browser: Browser, app_url: str, case: str) -> None:
    pid = {"wrong_first": "medium-1", "hard_2": "hard-2", "expert_3": "expert-3"}[case]
    p = make_player(app_url, "hint")
    notes = [{"cell": "r4c2", "digits": [3, 7]}] if case == "wrong_first" else []
    gid = seed_game(app_url, p, pid, notes=notes)
    filled = givens(pid)
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        presses = HINT_LIMIT
        if case == "wrong_first":
            go(page, "r4c3")
            page.keyboard.press("6")
            wait_cell(page, "r4c3", value="6", wrong="true")
            presses = 1
        for k in range(presses):
            target, digit = hint_pick(pid, filled)
            if case == "wrong_first":
                assert (target, digit) == ("r4c3", 3)
            page.keyboard.press("h")
            wait_cell(page, target, value=str(digit), hinted="true", wrong="false", notes="", selected="true")
            r, c = rc(target)
            wait_said(page, f"Hint: row {r}, column {c} is {digit}. Hints left {HINT_LIMIT - k - 1}.")
            filled[target] = digit
        if case == "wrong_first":
            assert cells(page)["r4c2"]["notes"] == "7"
            assert text_of(page, "#mistakes") == "Mistakes: 1/3"


def test_hint_limit_and_locks(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hlim")
    gid = seed_game(app_url, p, "easy-1", hints=HINT_LIMIT - 1)
    target, digit = hint_pick("easy-1", givens("easy-1"))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        wait_text(page, "#hints-left", "Hints left: 1")
        click(button(page, "Hint"))
        wait_cell(page, target, value=str(digit), hinted="true", selected="true")
        wait_text(page, "#hints-left", "Hints left: 0")
        wait_for(page, lambda: is_disabled(button(page, "Hint")), "the Hint button disabled")
        cell_loc(page, target).focus()
        page.keyboard.press("h")
        wait_said(page, "No hints left.")
        assert sum(v["hinted"] == "true" for v in cells(page).values()) == 1
        page.keyboard.press(str(wrong_digit("easy-1", target)))
        wait_said(page, "Hinted cells can't be changed.")
        page.keyboard.press("Delete")
        wait_said(page, "Hinted cells can't be changed.", times=2)
        assert cells(page)[target]["value"] == str(digit)
    wait_moves(app_url, p, gid, ["hint"], closed=True)


def test_wf_hint_order_all_hints(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hall")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        for left, (target, digit) in zip((2, 1, 0), (("r4c3", 3), ("r6c2", 4), ("r5c3", 5))):
            page.keyboard.press("h")
            wait_cell(page, target, value=str(digit), hinted="true", selected="true", focused=True)
            r, c = rc(target)
            wait_said(page, f"Hint: row {r}, column {c} is {digit}. Hints left {left}.")
            wait_text(page, "#hints-left", f"Hints left: {left}")
        page.keyboard.press("h")
        wait_said(page, "No hints left.")
        assert is_disabled(button(page, "Hint"))
    moves = wait_moves(app_url, p, gid, ["hint"] * 3, closed=True)
    assert [(m["cell"], m["digit"]) for m in moves] == [("r4c3", 3), ("r6c2", 4), ("r5c3", 5)]


def test_wf_hint_order_reload(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hrel")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        click(button(page, "Hint"))
        wait_cell(page, "r4c3", hinted="true")
        click(button(page, "Hint"))
        wait_cell(page, "r6c2", hinted="true")
        wait_moves(app_url, p, gid, ["hint", "hint"])
        page.reload()
        wait_board(page)
        wait_cell(page, "r4c3", value="3", hinted="true")
        wait_cell(page, "r6c2", value="4", hinted="true")
        wait_text(page, "#hints-left", "Hints left: 1")
        tab_to_board(page)
        page.keyboard.press("h")
        wait_cell(page, "r5c3", value="5", hinted="true", selected="true")
    wait_moves(app_url, p, gid, ["hint"] * 3, skip=("pause", "resume"), closed=True)


HIGHLIGHT_CASES = ["keyboard", "click", "tap"]


@pytest.mark.parametrize("how", HIGHLIGHT_CASES, ids=HIGHLIGHT_CASES)
def test_highlights(browser: Browser, app_url: str, how: str) -> None:
    p = make_player(app_url, "hl")
    gid = seed_game(app_url, p, "easy-1", entries=[{"cell": "r1c3", "digit": 4}])
    values = {**givens("easy-1"), "r1c3": 4}
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        if how == "keyboard":
            tab_to_board(page)

        def pick(target: str) -> None:
            if how == "keyboard":
                go(page, target)
            elif how == "click":
                click(cell_loc(page, target))
            else:
                tap(cell_loc(page, target))

        def check(sel: str) -> None:
            want = expected_highlights(sel, values)
            wait_for(page, lambda: {k: v["highlight"] for k, v in cells(page).items()} == want,
                     f"published highlight tokens around {sel}")

        for target in ("r1c4", "r1c3", "r5c5"):
            pick(target)
            check(target)
        page.keyboard.press("9")
        values["r5c5"] = 9
        check("r5c5")


def test_wf_highlight_selection_follow(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hlf")
    gid = seed_game(app_url, p, "easy-1")
    values = dict(givens("easy-1"))
    with visit(browser, app_url, f"/play/{gid}", p, viewport=(PHONE_WIDTH, PHONE_HEIGHT)) as page:
        wait_board(page)

        def check(sel: str) -> None:
            want = expected_highlights(sel, values)
            wait_for(page, lambda: {k: v["highlight"] for k, v in cells(page).items()} == want,
                     f"highlights follow {sel}")

        tab_to_board(page)
        go(page, "r2c3")
        check("r2c3")
        click(cell_loc(page, "r4c3"))
        check("r4c3")
        tap(cell_loc(page, "r6c3"))
        check("r6c3")
        page.keyboard.press("1")
        values["r6c3"] = 1
        check("r6c3")
        page.keyboard.press("Delete")
        del values["r6c3"]
        check("r6c3")
        page.keyboard.press("Control+z")
        values["r6c3"] = 1
        check("r6c3")
        page.keyboard.press("p")
        wait_for(page, lambda: all(v["highlight"] == "" for v in cells(page).values()), "no highlights while paused")
        page.keyboard.press("p")
        check("r6c3")
    wait_moves(app_url, p, gid, ["enter", "erase", "undo", "pause", "resume"], closed=True)


def test_wf_highlight_selection_paused_and_lost(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hll")
    gid = seed_game(app_url, p, "easy-1", mistakes=2)
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        click(cell_loc(page, "r1c4"))
        wait_cell(page, "r1c4", highlight="selected")
        click(cell_loc(page, "r1c1"))
        page.keyboard.press("5")
        wait_for(page, lambda: board_state(page) == "lost" and all(v["highlight"] == "" for v in cells(page).values()),
                 "no highlights on a lost board")
    wait_api(lambda: get_game(app_url, p, gid)["status"] == "lost", "lost stored")


def test_game_clock(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "clk")
    for elapsed, shown_at_start in ((581000, "09:41"), (3725000, "1:02:05")):
        gid = seed_game(app_url, p, "easy-1", elapsed_ms=elapsed)
        with visit(browser, app_url, f"/play/{gid}", p) as page:
            wait_board(page)
            timer = timer_of(page)
            assert timer.get_attribute("id") == "timer"
            wait_text(page, "#timer", shown_at_start)
            advance(page, 1500)
            assert text_of(page, "#timer") == clock(elapsed // 1000 + 1)
            page.keyboard.press("p")
            wait_for(page, lambda: board_state(page) == "paused", "paused")
            frozen = text_of(page, "#timer")
            advance(page, 5000)
            assert text_of(page, "#timer") == frozen
            page.keyboard.press("p")
            wait_for(page, lambda: board_state(page) == "playing", "playing")
            advance(page, 1000)
            assert parse_clock(text_of(page, "#timer") or "0") == parse_clock(frozen or "0") + 1


def test_pause_and_auto_pause(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "pause")
    gid = seed_game(app_url, p, "easy-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        paused = dialog(page, "Paused")

        def assert_paused() -> None:
            wait_shown(page, paused, "the Paused dialog")
            expect(paused).to_contain_text("Your game is paused.")
            wait_focused(page, button(paused, "Resume"), "Resume")
            s = snap(page)
            assert s is not None and s["state"] == "paused" and s["hidden"] == "true"
            assert all(c["value"] == "" and c["notes"] == "" and c["label"] == label(n, "hidden") for n, c in s["cells"].items())

        def assert_resumed(times: int) -> None:
            wait_for(page, lambda: not shown(paused) and board_state(page) == "playing", "play resumes")
            wait_for(page, lambda: page.evaluate(FOCUS_ON_SELECTED_JS), "focus on the selected cell")
            wait_said(page, "Resumed.", times)

        tab_to_board(page)
        page.keyboard.press("p")
        assert_paused()
        wait_said(page, "Paused.")
        page.keyboard.press("Escape")
        page.keyboard.press("6")
        assert shown(paused) and board_state(page) == "paused"
        page.keyboard.press("p")
        assert_resumed(1)
        assert cells(page)["r1c1"]["value"] == ""
        click(button(page, "Pause"))
        assert_paused()
        click(button(paused, "Resume"))
        assert_resumed(2)
        page.evaluate("() => window.dispatchEvent(new Event('blur'))")
        assert_paused()
        page.keyboard.press("P")
        assert_resumed(3)
        page.evaluate(HIDE_PAGE_JS)
        assert_paused()
        page.evaluate(SHOW_PAGE_JS)
        click(button(paused, "Resume"))
        assert_resumed(4)
    wait_moves(app_url, p, gid, ["pause", "resume"] * 4, closed=True)


SCORE_CASES = ["hard", "medium", "expert"]
SCORE_SEEDS = {"hard": ("hard-1", 581000, 1, 2, 3169), "medium": ("medium-1", 260000, 0, 1, 2440),
               "expert": ("expert-1", 6000000, 2, 3, 600)}


@pytest.mark.parametrize("case", SCORE_CASES, ids=SCORE_CASES)
def test_score(app_url: str, case: str) -> None:
    pid, elapsed, mistakes, hints, expected = SCORE_SEEDS[case]
    p = make_player(app_url, "score")
    last = empties(pid)[-1]
    gid = seed_game(app_url, p, pid, entries=fill_except(pid, {last}), mistakes=mistakes, hints=hints, elapsed_ms=elapsed)
    r = finish(app_url, p, gid, {"moves": [enter(1, elapsed, last, solution(pid, last))]})
    assert r.status_code == 200, r.text
    res = r.json()["result"]
    assert (res["level"], res["seconds"], res["mistakes"], res["hints"], res["score"]) == (
        case, elapsed // 1000, mistakes, hints, expected)
    assert res["daily_state"] is None
    assert get_profile(app_url, p)["levels"][case]["best_score"] == expected


MOTION_CASES = ["motion", "reduced"]


@pytest.mark.parametrize("mode", MOTION_CASES, ids=MOTION_CASES)
def test_solved_animation(browser: Browser, app_url: str, mode: str) -> None:
    p = make_player(app_url, "anim")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    rm = "reduce" if mode == "reduced" else "no-preference"
    with visit(browser, app_url, f"/play/{gid}", p, reduced_motion=rm) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("4")
        solved = dialog(page, "Puzzle solved")
        if mode == "motion":
            wait_for(page, lambda: len(page.evaluate("() => window.__cellAnims")) == 81, "an animation on all 81 cells")
            assert not shown(solved), "Puzzle solved opened before the sequence finished"
            anims = page.evaluate("() => window.__cellAnims")
            assert all(len(v) == 1 for v in anims.values()), "a cell ran more than one animation"
            first = min(v[0]["delay"] for v in anims.values())
            for name, (a,) in anims.items():
                r, c = rc(name)
                assert a["duration"] == SOLVED_CELL_MS, name
                assert a["delay"] - first == (r + c - 2) * SOLVED_STAGGER_MS, name
            assert max(v[0]["delay"] + v[0]["duration"] for v in anims.values()) - first == SOLVED_SPAN_MS
            wait_shown(page, solved, "Puzzle solved after the sequence")
            assert snap(page)["celebrating"] != "true"
        else:
            expect(solved).to_be_visible(timeout=WAIT_S * 1000)
            assert page.evaluate("() => window.__celebrated") is False
            assert page.evaluate("() => window.__maxAnims") == 0
    assert get_game(app_url, p, gid)["status"] == "won"


def timed_finish(browser: Browser, app_url: str, reduced: bool) -> None:
    p = make_player(app_url, "timed")
    last = empties("hard-1")[-1]
    gid = seed_game(app_url, p, "hard-1", entries=fill_except("hard-1", {last}), mistakes=1, hints=2, elapsed_ms=575000)
    with visit(browser, app_url, f"/play/{gid}", p, reduced_motion="reduce" if reduced else "no-preference") as page:
        wait_board(page)
        tab_to_board(page)
        paused = dialog(page, "Paused")
        page.keyboard.press("p")
        wait_shown(page, paused, "Paused")
        click(button(paused, "Resume"))
        wait_for(page, lambda: board_state(page) == "playing", "resumed")
        page.evaluate("() => window.dispatchEvent(new Event('blur'))")
        wait_shown(page, paused, "auto-paused on blur")
        page.keyboard.press("p")
        wait_for(page, lambda: board_state(page) == "playing" and page.evaluate(FOCUS_ON_SELECTED_JS), "resumed by P")
        advance(page, 6000)
        assert text_of(page, "#timer") == "09:41"
        page.keyboard.press(str(solution("hard-1", last)))
        solved = dialog(page, "Puzzle solved")
        if reduced:
            expect(solved).to_be_visible(timeout=WAIT_S * 1000)
            assert page.evaluate("() => window.__maxAnims") == 0 and page.evaluate("() => window.__celebrated") is False
        else:
            wait_for(page, lambda: page.evaluate("() => window.__celebrated"), "data-celebrating during the solved sequence")
            wait_shown(page, solved, "Puzzle solved")
        res = get_game(app_url, p, gid)["result"]
        assert res["seconds"] >= 581 and res["score"] == score("hard", res["seconds"], 1, 2)
        expect(solved).to_contain_text(solved_text(res["seconds"], 1, 2, res["score"]))
        wait_focused(page, button(solved, "New game"), "New game")
        wait_said(page, f"Solved in {clock(res['seconds'])}. Score {res['score']}.")
    assert [m["op"] for m in get_game(app_url, p, gid)["moves"]] == ["pause", "resume", "pause", "resume", "enter"]


def test_wf_clock_score_motion_timed_finish(browser: Browser, app_url: str) -> None:
    timed_finish(browser, app_url, reduced=False)


def test_wf_clock_score_motion_reduced_motion(browser: Browser, app_url: str) -> None:
    timed_finish(browser, app_url, reduced=True)


def test_number_pad(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "pad")
    gid = seed_game(app_url, p, "easy-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        pad = page.get_by_role("group", name="Number pad", exact=True)
        five = button(pad, "Digit 5")
        assert five.get_attribute("data-remaining") == "3"
        click(cell_loc(page, "r1c1"))
        click(five)
        wait_cell(page, "r1c1", value="5", wrong="true")
        assert five.get_attribute("data-remaining") == "3"
        click(cell_loc(page, "r5c9"))
        click(five)
        wait_cell(page, "r5c9", value="5", wrong="false")
        wait_for(page, lambda: five.get_attribute("data-remaining") == "2", "Digit 5 remaining 2")
        page.keyboard.press("p")
        wait_for(page, lambda: board_state(page) == "paused", "paused")
        assert five.get_attribute("data-remaining") == "2"
        page.keyboard.press("p")
        click(button(page, "Notes"))
        click(cell_loc(page, "r5c8"))
        click(button(pad, "Digit 1"))
        wait_cell(page, "r5c8", notes="1")
    fives = [{"cell": c, "digit": 5} for c in empties("easy-1") if solution("easy-1", c) == 5]
    gid2 = seed_game(app_url, p, "easy-1", entries=fives)
    with visit(browser, app_url, f"/play/{gid2}", p) as page:
        wait_board(page)
        five = button(page.get_by_role("group", name="Number pad", exact=True), "Digit 5")
        assert five.get_attribute("data-remaining") == "0" and five.is_disabled()
        tab_to_board(page)
        page.keyboard.press("5")
        wait_cell(page, "r1c1", value="5", wrong="true")


def test_phone_layout_and_targets(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "lay")
    gid = seed_game(app_url, p, "easy-1")
    with visit(browser, app_url, f"/play/{gid}", p, viewport=(375, 812)) as page:
        wait_board(page)
        for width, height in ((320, 800), (375, 812), (767, 1024), (768, 1024), (1280, 800)):
            page.set_viewport_size({"width": width, "height": height})
            advance(page, STEP_MS)
            layout(page)
            board = board_grid(page).bounding_box()
            pad = page.get_by_role("group", name="Number pad", exact=True).bounding_box()
            undo = button(page, "Undo").bounding_box()
            timer = timer_of(page).bounding_box()
            assert board and pad and undo and timer
            bottom = board["y"] + board["height"]
            if width < BREAKPOINT:
                assert round(board["width"]) == min(width - PHONE_GUTTER, BOARD_MAX), width
                assert round(timer["y"]) >= round(bottom) and timer["y"] < undo["y"] < pad["y"], width
            else:
                assert round(pad["x"]) >= round(board["x"] + board["width"]), width
            targets = [button(page, f"Digit {d}") for d in range(1, 10)] + [
                button(page, n) for n in ("Undo", "Redo", "Erase", "Notes", "Hint", "Pause")]
            for t in targets:
                box = t.bounding_box()
                assert box and round(box["width"]) >= TARGET_PX and round(box["height"]) >= TARGET_PX, width


def test_wf_phone_pad_touch_finish(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "touch")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c8", "r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p, viewport=(PHONE_WIDTH, PHONE_HEIGHT)) as page:
        wait_board(page)
        layout(page)
        pad = page.get_by_role("group", name="Number pad", exact=True)
        board = board_grid(page).bounding_box()
        assert board and pad.bounding_box()["y"] >= board["y"] + board["height"] - 1
        tap(cell_loc(page, "r9c8"))
        tap(button(pad, "Digit 3"))
        wait_cell(page, "r9c8", value="3")
        wait_said(page, "Row 9, column 8, 3.")
        tap(button(page, "Notes"))
        wait_said(page, "Notes on.")
        tap(cell_loc(page, "r9c9"))
        tap(button(pad, "Digit 4"))
        wait_cell(page, "r9c9", notes="4")
        tap(button(page, "Notes"))
        tap(button(pad, "Digit 4"))
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "Puzzle solved")
        res = get_game(app_url, p, gid)["result"]
        expect(solved).to_contain_text(solved_text(res["seconds"], 0, 0, res["score"]))
    assert get_game(app_url, p, gid)["status"] == "won"


def test_wf_phone_pad_touch_notes_undo(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "tnu")
    gid = seed_game(app_url, p, "easy-1")
    with visit(browser, app_url, f"/play/{gid}", p, viewport=(PHONE_WIDTH, PHONE_HEIGHT)) as page:
        wait_board(page)
        pad = page.get_by_role("group", name="Number pad", exact=True)
        tap(cell_loc(page, "r1c1"))
        tap(button(pad, "Digit 5"))
        wait_cell(page, "r1c1", value="5", wrong="true")
        tap(button(page, "Erase"))
        wait_cell(page, "r1c1", value="")
        tap(button(page, "Undo"))
        wait_cell(page, "r1c1", value="5")
        tap(button(page, "Redo"))
        wait_cell(page, "r1c1", value="")
        tap(button(page, "Pause"))
        wait_shown(page, dialog(page, "Paused"), "Paused")
        tap(button(dialog(page, "Paused"), "Resume"))
        wait_for(page, lambda: board_state(page) == "playing", "resumed")
    wait_moves(app_url, p, gid, ["enter", "erase", "undo", "redo", "pause", "resume"], closed=True)


def calendar(page: Page) -> dict[str, dict[str, Any]]:
    return {c["date"]: c for c in page.evaluate(CAL_JS)}


def test_daily_puzzle_and_calendar(browser: Browser, app_url: str) -> None:
    p, q, v = make_players(app_url, "dayP", "dayQ", "dayV")
    with server_clock(app_url, "2026-11-05T00:00:00Z"):
        for day, pid in (("2026-11-02", "daily-5"), ("2026-11-03", "daily-6"), ("2026-11-04", "daily-7"), ("2026-11-05", "daily-1")):
            r = api(app_url, "POST", f"/api/daily/{day}/game", session=p["session"])
            assert r.status_code == 201, r.text
            g = r.json()["game"]
            assert (g["puzzle_id"], g["mode"], g["level"], g["date"], g["puzzle"]) == (pid, "daily", "medium", day, PUZZLES[pid][0])
            again = api(app_url, "POST", f"/api/daily/{day}/game", session=p["session"])
            assert again.status_code == 200 and again.json()["game"]["id"] == g["id"]
            other = api(app_url, "POST", f"/api/daily/{day}/game", session=q["session"])
            assert other.status_code == 201 and other.json()["game"]["puzzle_id"] == pid
        r = api(app_url, "POST", "/api/daily/2026-11-06/game", session=p["session"])
        assert (r.status_code, code_of(r)) == (409, "DAILY_NOT_OPEN")
        for bad in ((DAILY_START - timedelta(days=1)).isoformat(), "2026-02-30"):
            r = api(app_url, "POST", f"/api/daily/{bad}/game", session=p["session"])
            assert (r.status_code, code_of(r)) == (404, "DAILY_NOT_FOUND")
        r = api(app_url, "GET", "/api/daily?month=november", session=p["session"])
        assert (r.status_code, code_of(r)) == (422, "VALIDATION")
        daily_result(app_url, v, "2026-11-02", "2026-11-02T12:00:00+13:00")
        daily_result(app_url, v, "2026-11-03", "2026-11-04T12:00:00+13:00")
        api_days = {d["date"]: d["state"] for d in get_daily(app_url, v, "2026-11")["days"]}
        want = {"2026-11-01": "missed", "2026-11-02": "solved", "2026-11-03": "late", "2026-11-04": "missed", "2026-11-05": "today"}
        want.update({f"2026-11-{d:02d}": "future" for d in range(6, 31)})
        assert {k: api_days.get(k) for k in want} == want
        with visit(browser, app_url, "/daily", v) as page:
            wait_heading(page, "Daily challenge")
            grid = page.get_by_role("grid", name=month_title(date(2026, 11, 1)), exact=True)
            wait_shown(page, grid, "the November 2026 calendar")
            assert grid.get_attribute("id") == "calendar"
            cal = calendar(page)
            for day, state in want.items():
                d = date.fromisoformat(day)
                assert cal[day]["state"] == state, day
                assert cal[day]["label"] == f"{long_date(d)}, {STATE_WORDS[state]}", day
                assert cal[day]["col"] == d.weekday(), f"{day} not under its weekday"
                if state == "future":
                    assert cal[day]["disabled"] == "true"
            wait_text(page, "#streak", "Current streak: 0 days")
            wait_text(page, "#best-streak", "Best streak: 1 day")


def test_streaks_by_server_date(browser: Browser, app_url: str) -> None:
    p, q = make_players(app_url, "strkP", "strkQ")
    with server_clock(app_url, "2026-11-04T01:00:00+13:00"):
        daily_result(app_url, p, "2026-11-01", "2026-11-01T20:00:00+13:00")
        daily_result(app_url, p, "2026-11-02", "2026-11-02T23:59:59+13:00")
        daily_result(app_url, p, "2026-11-03", "2026-11-03T11:00:00Z")
        daily_result(app_url, q, "2026-11-03", "2026-11-03T10:59:59Z")
        dp = get_daily(app_url, p, "2026-11")
        states = {d["date"]: d["state"] for d in dp["days"]}
        assert dp["today"] == "2026-11-04"
        assert (states["2026-11-01"], states["2026-11-02"], states["2026-11-03"]) == ("solved", "solved", "late")
        assert (dp["current_streak"], dp["best_streak"]) == (0, 2)
        assert {d["date"]: d["state"] for d in get_daily(app_url, q, "2026-11")["days"]}["2026-11-03"] == "solved"
        daily_result(app_url, p, "2026-11-04", "2026-11-04T00:30:00+13:00")
        dp = get_daily(app_url, p, "2026-11")
        assert (dp["current_streak"], dp["best_streak"]) == (1, 2)
        with visit(browser, app_url, "/daily", p, hook=lambda pg: pg.clock.set_fixed_time(DEVICE_TIME)) as page:
            grid = page.get_by_role("grid", name=month_title(date(2026, 11, 1)), exact=True)
            wait_for(page, lambda: shown(grid), "the server's month, not the device's")
            wait_for(page, lambda: text_of(page, "#streak") == "Current streak: 1 day", "Current streak: 1 day")
            assert text_of(page, "#best-streak") == "Best streak: 2 days"
            cal = calendar(page)
            assert cal["2026-11-04"]["state"] == "solved" and cal["2026-11-03"]["state"] == "late"
            assert cal["2026-11-05"]["state"] == "future"


def test_calendar_keyboard(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "calk")
    november, october = date(2026, 11, 1), date(2026, 10, 1)
    with server_clock(app_url, "2026-11-05T00:00:00Z"):
        with visit(browser, app_url, "/daily", p) as page:
            wait_for(page, lambda: calendar(page).get("2026-11-05", {}).get("focused") is True, "today's cell focused")
            assert [k for k, c in calendar(page).items() if c["tabindex"] == "0"] == ["2026-11-05"]

            def at(day: str) -> None:
                wait_for(page, lambda: [k for k, c in calendar(page).items() if c["focused"] and c["tabindex"] == "0"] == [day],
                         f"focus and tab stop on {day}")

            for key, day in (("ArrowLeft", "2026-11-04"), ("ArrowUp", "2026-11-04"), ("ArrowDown", "2026-11-11"),
                             ("ArrowRight", "2026-11-12"), ("ArrowUp", "2026-11-05"), ("ArrowLeft", "2026-11-04"),
                             ("ArrowLeft", "2026-11-03"), ("ArrowLeft", "2026-11-02"), ("ArrowLeft", "2026-11-01"),
                             ("ArrowLeft", "2026-11-01"), ("ArrowDown", "2026-11-08"), ("ArrowDown", "2026-11-15")):
                page.keyboard.press(key)
                at(day)
            for key in ("Enter", "Space"):
                page.keyboard.press(key)
                advance(page, STEP_MS)
                assert page.url.endswith("/daily"), f"{key} opened a future date"
            for _ in range(10):
                page.keyboard.press("ArrowUp")
            at("2026-11-01")
            for _ in range(3):
                page.keyboard.press("ArrowRight")
            at("2026-11-04")
            page.keyboard.press("Enter")
            wait_heading(page, f"Daily, {long_date(date(2026, 11, 4))}")
            page.goto(app_url + "/daily")
            wait_for(page, lambda: calendar(page).get("2026-11-05", {}).get("focused") is True, "today focused again")
            page.keyboard.press("Space")
            wait_heading(page, f"Daily, {long_date(date(2026, 11, 5))}")
            page.goto(app_url + "/daily")
            prev_b, next_b = button(page, "Previous month"), button(page, "Next month")
            wait_shown(page, next_b, "Next month")
            assert next_b.get_attribute("aria-disabled") == "true" and prev_b.get_attribute("aria-disabled") == "false"
            next_b.focus()
            page.keyboard.press("Enter")
            assert shown(page.get_by_role("grid", name=month_title(november), exact=True)) and focused(next_b)
            prev_b.focus()
            page.keyboard.press("Enter")
            wait_shown(page, page.get_by_role("grid", name=month_title(october), exact=True), "the previous month")
            assert focused(prev_b) and next_b.get_attribute("aria-disabled") == "false"
            assert calendar(page)["2026-10-01"]["tabindex"] == "0"
            first_month = page.get_by_role("grid", name=month_title(DAILY_START), exact=True)
            for _ in range(12):
                if shown(first_month):
                    break
                page.keyboard.press("Enter")
                advance(page, STEP_MS)
            wait_shown(page, first_month, "the DAILY_START month")
            assert prev_b.get_attribute("aria-disabled") == "true" and focused(prev_b)
            page.keyboard.press("Enter")
            advance(page, STEP_MS)
            assert shown(first_month) and focused(prev_b)
            assert prev_b.get_attribute("disabled") is None and next_b.get_attribute("disabled") is None
        days = {d["date"]: d for d in get_daily(app_url, p, "2026-11")["days"]}
        assert days["2026-11-04"]["id"] and days["2026-11-05"]["id"]


def daily_journey(browser: Browser, app_url: str, now: str, arrow: bool) -> tuple[dict[str, Any], dict[str, Any]]:
    p = make_player(app_url, "reg")
    with server_clock(app_url, now):
        daily_result(app_url, p, "2026-11-01", "2026-11-01T12:00:00+13:00")
        daily_result(app_url, p, "2026-11-02", "2026-11-02T12:00:00+13:00")
        pid = daily_puzzle(date(2026, 11, 3))
        last = empties(pid)[-1]
        gid = seed_game(app_url, p, pid, mode="daily", day="2026-11-03", entries=fill_except(pid, {last}))
        with visit(browser, app_url, "/daily", p, reduced_motion="reduce") as page:
            wait_for(page, lambda: any(c["focused"] for c in calendar(page).values()), "a focused calendar date")
            if arrow:
                page.keyboard.press("ArrowLeft")
            wait_for(page, lambda: calendar(page)["2026-11-03"]["focused"], "2026-11-03 focused")
            page.keyboard.press("Enter")
            wait_heading(page, f"Daily, {long_date(date(2026, 11, 3))}")
            wait_board(page)
            page.keyboard.press(str(solution(pid, last)))
            expect(dialog(page, "Puzzle solved")).to_be_visible(timeout=WAIT_S * 1000)
            page.goto(app_url + "/daily")
            wait_for(page, lambda: "2026-11-03" in calendar(page), "the calendar")
            page.reload()
            wait_for(page, lambda: "2026-11-03" in calendar(page), "the calendar after reload")
            cal = calendar(page)
            ui = {"state": cal["2026-11-03"]["state"], "label": cal["2026-11-03"]["label"],
                  "streak": text_of(page, "#streak"), "best": text_of(page, "#best-streak")}
        return {"api": get_daily(app_url, p, "2026-11"), "game": get_game(app_url, p, gid)}, ui


def test_wf_daily_streak_before_midnight(browser: Browser, app_url: str) -> None:
    out, ui = daily_journey(browser, app_url, "2026-11-03T23:58:00+13:00", arrow=False)
    assert out["game"]["result"]["daily_state"] == "solved"
    assert out["api"]["current_streak"] == 3
    assert ui == {"state": "solved", "label": f"{long_date(date(2026, 11, 3))}, {STATE_WORDS['solved']}",
                  "streak": "Current streak: 3 days", "best": "Best streak: 3 days"}


def test_wf_daily_streak_after_midnight(browser: Browser, app_url: str) -> None:
    out, ui = daily_journey(browser, app_url, "2026-11-04T00:01:00+13:00", arrow=True)
    assert out["game"]["result"]["daily_state"] == "late"
    assert (out["api"]["current_streak"], out["api"]["best_streak"]) == (0, 2)
    assert ui == {"state": "late", "label": f"{long_date(date(2026, 11, 3))}, {STATE_WORDS['late']}",
                  "streak": "Current streak: 0 days", "best": "Best streak: 2 days"}


ROW_FIELDS = {"rank", "display_name", "seconds", "score", "mistakes", "hints"}


def test_leaderboard_ranking(browser: Browser, app_url: str) -> None:
    d = own_date()
    ps = make_players(app_url, "lbA", "lbB", "lbC", "lbD", "lbE", "lbL")
    u = make_player(app_url, "lbU", verified=False)
    day = d.isoformat()
    seeds = [(ps[0], 100000, 0, "00:01"), (ps[1], 150000, 1, "00:02"), (ps[2], 300000, 0, "00:03"),
             (ps[3], 300000, 0, "00:04"), (ps[4], 400000, 0, "00:05")]
    for pl, ms, mis, hm in seeds:
        daily_result(app_url, pl, day, f"{day}T{hm}:00Z", elapsed_ms=ms, mistakes=mis)
    daily_result(app_url, u, day, f"{day}T00:06:00Z", elapsed_ms=50000)
    daily_result(app_url, ps[5], day, f"{(d + timedelta(days=1)).isoformat()}T00:00:00Z", elapsed_ms=50000)
    names = [pl["display_name"] for pl in ps[:5]]
    body = leaderboard(app_url, ps[0], d)
    assert body["date"] == day and len(body["rows"]) <= LEADERBOARD_SIZE
    mine = [r for r in body["rows"] if r["display_name"] in names]
    assert [r["display_name"] for r in mine] == names
    base = mine[0]["rank"]
    assert [r["rank"] - base for r in mine] == [0, 1, 2, 2, 4]
    assert [(r["seconds"], r["score"], r["mistakes"], r["hints"]) for r in mine] == [
        (100, 2900, 0, 0), (150, 2700, 1, 0), (300, 2700, 0, 0), (300, 2700, 0, 0), (400, 2600, 0, 0)]
    shown_names = {r["display_name"] for r in body["rows"]}
    assert u["display_name"] not in shown_names and ps[5]["display_name"] not in shown_names
    with visit(browser, app_url, f"/leaderboard/{day}", ps[0]) as page:
        wait_heading(page, "Daily leaderboard")
        table = page.get_by_role("table", name=f"Daily leaderboard, {long_date(d)}", exact=True)
        wait_for(page, lambda: table.count() == 1 and len(table.evaluate(LB_ROWS_JS)) > 0, "leaderboard rows")
        assert [" ".join(t.split()) for t in table.get_by_role("columnheader").all_text_contents()] == [
            "Rank", "Player", "Time", "Score", "Mistakes", "Hints"]
        rows = [r for r in table.evaluate(LB_ROWS_JS) if r["player"] in names]
        assert [r["player"] for r in rows] == names
        assert [int(r["cells"][0]) - base for r in rows] == [0, 1, 2, 2, 4]
        assert rows[0]["current"] == "true" and all(r["current"] != "true" for r in rows[1:])
        assert rows[1]["cells"][2:] == [clock(150), "2700", "1", "0"]


def test_leaderboard_privacy(browser: Browser, app_url: str) -> None:
    d = own_date()
    a, f, viewer = make_players(app_url, "prA", "prF", "prV")
    daily_result(app_url, a, d.isoformat(), noon_of(d))
    frames: list[dict[str, Any]] = []
    with server_clock(app_url, noon_of(d)):
        body = leaderboard(app_url, viewer, d)
        assert body["rows"] and all(set(r) == ROW_FIELDS for r in body["rows"])
        assert "@" not in json.dumps(body) and a["player_id"] not in json.dumps(body)
        with visit(browser, app_url, f"/leaderboard/{d.isoformat()}", viewer, hook=lambda pg: listen(pg, frames)) as page:
            wait_for(page, lambda: page.locator(f'[data-player="{a["display_name"]}"]').count() == 1, "A's row")
            finish_daily(app_url, f, d)
            wait_frame(page, frames, "leaderboard", "a live leaderboard message",
                       pred=lambda m: m.get("latest", {}).get("display_name") == f["display_name"])
            html = page.content()
        for m in frames_of(frames, "leaderboard"):
            assert public_keys(m) == {"type", "date", "rows", "latest"}
            assert all(set(r) == ROW_FIELDS for r in m["rows"]) and set(m["latest"]) == {"display_name", "rank"}
            assert "@" not in m["_raw"]
        for pl in (a, f):
            assert pl["email"] not in html and pl["player_id"] not in html
            assert all(pl["player_id"] not in m["_raw"] for m in frames)


def test_live_leaderboard(browser: Browser, app_url: str, valkey: Valkey) -> None:
    d = own_date()
    viewer, fin = make_players(app_url, "lvV", "lvF")
    unv = make_player(app_url, "lvU", verified=False)
    with server_clock(app_url, noon_of(d)):
        with visit(browser, app_url, f"/leaderboard/{d.isoformat()}", viewer) as page:
            wait_heading(page, "Daily leaderboard")
            wait_for(page, lambda: page.get_by_role("table").count() == 1 or text_of(page, "#leaderboard-notice") is not None,
                     "the leaderboard page")
            finish_daily(app_url, fin, d)
            row = page.locator(f'[data-player="{fin["display_name"]}"]')
            wait_for(page, lambda: row.count() == 1, "the new row within 2 seconds without reload", seconds=LIVE_S)
            rank = next(r["rank"] for r in leaderboard(app_url, viewer, d)["rows"] if r["display_name"] == fin["display_name"])
            wait_said(page, f"{fin['display_name']} finished at rank {rank}.")
            finish_daily(app_url, unv, d)
            ghost = page.locator(f'[data-player="{unv["display_name"]}"]')
            deadline = time.monotonic() + LIVE_S
            while time.monotonic() < deadline:
                assert ghost.count() == 0, "an unverified player appeared live"
                advance(page, STEP_MS)
    members = valkey.command("ZRANGE", f"seam:leaderboard:{d.isoformat()}", "0", "-1")
    assert fin["player_id"] in members and unv["player_id"] not in members
    assert unv["display_name"] not in {r["display_name"] for r in leaderboard(app_url, viewer, d)["rows"]}


def test_wf_leaderboard_live_two_browsers(browser: Browser, app_url: str) -> None:
    d = own_date()
    r1, r2 = make_players(app_url, "twoA", "twoB")
    pid = daily_puzzle(d)
    last = empties(pid)[-1]
    gid = seed_game(app_url, r1, pid, mode="daily", day=d.isoformat(), entries=fill_except(pid, {last}))
    title = f"Daily leaderboard, {long_date(d)}"
    with server_clock(app_url, noon_of(d)):
        with visit(browser, app_url, "/leaderboard", r1) as pa, visit(browser, app_url, "/leaderboard", r2) as pb:
            for pg in (pa, pb):
                wait_for(pg, lambda pg=pg: pg.get_by_role("table", name=title, exact=True).count() == 1 or
                         text_of(pg, "#leaderboard-notice") == "No one has finished this daily yet.", "today's board from the server")
            play = pa.context.new_page()
            play.goto(app_url + f"/play/{gid}")
            wait_board(play)
            with play.expect_response("**/api/games/*/finish") as info:
                play.keyboard.press(str(solution(pid, last)))
            assert info.value.status == 200
            row = pb.locator(f'[data-player="{r1["display_name"]}"]')
            wait_for(pb, lambda: row.count() == 1, "R1's row on R2's page within 2 seconds", seconds=LIVE_S)
            rows = leaderboard(app_url, r2, d)["rows"]
            rank = next(r["rank"] for r in rows if r["display_name"] == r1["display_name"])
            wait_said(pb, f"{r1['display_name']} finished at rank {rank}.")
            assert r1["email"] not in pb.content()
        game = get_game(app_url, r1, gid)
        again = finish(app_url, r1, gid, {"moves": game["moves"]})
        assert again.status_code == 200 and again.json()["result"] == game["result"]
        rows = leaderboard(app_url, r2, d)["rows"]
        assert [r["display_name"] for r in rows].count(r1["display_name"]) == 1
        assert all(set(r) == ROW_FIELDS for r in rows)


def test_wf_leaderboard_live_verify_later(browser: Browser, app_url: str, mail: Mailpit) -> None:
    d = own_date()
    name = ident("late")
    email = f"{name.lower()}@example.test"
    daily_result(app_url, make_player(app_url, "lvlO"), d.isoformat(), noon_of(d))
    with server_clock(app_url, noon_of(d)):
        with visit(browser, app_url, "/signup") as page:
            wait_heading(page, "Create your account")
            fill(page.get_by_label("Email", exact=True), email)
            fill(page.get_by_label("Display name", exact=True), name)
            fill(page.get_by_label("Password", exact=True), PASSWORD)
            click(button(page, "Create account"))
            region = page.get_by_role("region", name="Email confirmation", exact=True)
            wait_shown(page, region, "the Email confirmation region")
            expect(region).to_contain_text("Confirm your email to join duels and the leaderboard.")
            sess = cookie_session(page)
            me = api(app_url, "GET", "/api/me", session=sess).json()["player"]
            assert me["verified"] is False
            player = {**me, "session": sess}
            finish_daily(app_url, player, d)
            assert name not in {r["display_name"] for r in leaderboard(app_url, player, d)["rows"]}
            page.goto(app_url + f"/leaderboard/{d.isoformat()}")
            wait_for(page, lambda: "Confirm your email to appear on the leaderboard." in (text_of(page, "#leaderboard-notice") or ""),
                     "#leaderboard-notice contains M45")
            assert page.locator(f'[data-player="{name}"]').count() == 0
            token = link_token(app_url, wait_mail(mail, email, "Confirm your email for Seam")[0], "verify")
            page.goto(app_url + f"/verify/{token}")
            wait_said(page, "Your email is confirmed.")
            page.goto(app_url + f"/leaderboard/{d.isoformat()}")
            wait_for(page, lambda: page.locator(f'[data-player="{name}"]').count() == 1, "the confirmed player listed")
        assert name in {r["display_name"] for r in leaderboard(app_url, player, d)["rows"]}


def test_wf_leaderboard_live_outage(browser: Browser) -> None:
    base = instance("APP_VALKEY_DOWN_URL")
    d = own_date()
    a, b = make_players(base, "offA", "offB")
    daily_result(base, a, d.isoformat(), noon_of(d), elapsed_ms=100000)
    daily_result(base, b, d.isoformat(), noon_of(d), elapsed_ms=200000)
    body = leaderboard(base, a, d)
    assert body["live"] is False
    names = [r["display_name"] for r in body["rows"] if r["display_name"] in (a["display_name"], b["display_name"])]
    assert names == [a["display_name"], b["display_name"]]
    with visit(browser, base, f"/leaderboard/{d.isoformat()}", a) as page:
        wait_text(page, "#leaderboard-notice", "Live updates are paused. Reload to see new results.")
        wait_said(page, "Live updates are paused. Reload to see new results.")
        wait_for(page, lambda: page.locator(f'[data-player="{b["display_name"]}"]').count() == 1, "stored rows shown")


def test_duel_rooms(app_url: str, valkey: Valkey) -> None:
    a, other = make_players(app_url, "roomA", "roomO")
    unv = make_player(app_url, "roomU", verified=False)
    codes = []
    for level in ("easy", "medium", "hard", "expert"):
        r = api(app_url, "POST", "/api/duels", {"level": level}, session=a["session"])
        assert r.status_code == 201, r.text
        room = r.json()["room"]
        assert re.fullmatch(f"[{CODE_ALPHABET}]{{6}}", room["code"])
        assert room["level"] == level and room["state"] == "open"
        assert len(room["seats"]) >= 1 and room["seats"][0]["display_name"] == a["display_name"]
        h = valkey.hash(f"seam:room:{room['code']}")
        assert h["level"] == level and h["state"] == "open" and h["seat1"] == a["player_id"] and not h.get("seat2")
        assert 0 < valkey.ttl(f"seam:room:{room['code']}") <= ROOM_TTL_S
        codes.append(room["code"])
    assert len(set(codes)) == len(codes)
    r = api(app_url, "POST", "/api/duels", {"level": "easy"}, session=unv["session"])
    assert (r.status_code, code_of(r)) == (403, "NOT_VERIFIED")
    r = api(app_url, "POST", "/api/duels", {"level": "easy"})
    assert (r.status_code, code_of(r)) == (401, "UNAUTHENTICATED")
    r = api(app_url, "POST", "/api/duels", {"level": "legendary"}, session=a["session"])
    assert (r.status_code, code_of(r)) == (422, "VALIDATION")
    r = api(app_url, "GET", f"/api/duels/{codes[0]}", session=other["session"])
    assert (r.status_code, code_of(r)) == (404, "ROOM_NOT_FOUND")
    r = api(app_url, "GET", f"/api/duels/{codes[0]}", session=a["session"])
    assert r.status_code == 200 and r.json()["room"]["code"] == codes[0]


def test_duel_second_seat(app_url: str, valkey: Valkey) -> None:
    a, *joiners = make_players(app_url, "seatA", "seat1", "seat2", "seat3", "seat4", "seat5", "seat6")
    code = create_room(app_url, a, "easy")
    out = together([lambda j=j: api(app_url, "POST", "/api/duels/join", {"code": code}, session=j["session"]) for j in joiners])
    wins = [i for i, r in enumerate(out) if r.status_code == 200]
    assert len(wins) == 1, [r.status_code for r in out]
    assert all((r.status_code, code_of(r)) == (409, "ROOM_FULL") for i, r in enumerate(out) if i != wins[0])
    winner = joiners[wins[0]]
    h = valkey.hash(f"seam:room:{code}")
    assert h["seat1"] == a["player_id"] and h["seat2"] == winner["player_id"]
    room = api(app_url, "GET", f"/api/duels/{code}", session=a["session"]).json()["room"]
    assert [s["display_name"] for s in room["seats"]] == [a["display_name"], winner["display_name"]]
    assert room["state"] == "seated"
    assert api(app_url, "POST", "/api/duels/join", {"code": code}, session=winner["session"]).status_code == 200


def test_duel_join_limit(browser: Browser, app_url: str, valkey: Valkey) -> None:
    host, guesser, bystander = make_players(app_url, "rlH", "rlG", "rlB")
    code = create_room(app_url, host, "easy")
    for _ in range(JOIN_LIMIT):
        r = api(app_url, "POST", "/api/duels/join", {"code": absent_code()}, session=guesser["session"])
        assert (r.status_code, code_of(r)) == (404, "ROOM_NOT_FOUND")
    for attempt in (code, absent_code()):
        r = api(app_url, "POST", "/api/duels/join", {"code": attempt}, session=guesser["session"])
        assert (r.status_code, code_of(r)) == (429, "RATE_LIMITED")
        assert 1 <= int(r.headers["Retry-After"]) <= JOIN_WINDOW_S
    assert 0 < valkey.ttl(f"seam:joins:{guesser['player_id']}") <= JOIN_WINDOW_S
    assert not valkey.hash(f"seam:room:{code}").get("seat2")
    with visit(browser, app_url, "/duel", guesser) as page:
        box = page.get_by_role("textbox", name="Room code", exact=True)
        wait_shown(page, box, "the Room code field")
        fill(box, code)
        click(button(page, "Join room"))
        wait_said(page, "Too many tries. Wait a minute and try again.")
        assert page.get_by_text("Too many tries. Wait a minute and try again.", exact=True).count() >= 2
    assert api(app_url, "POST", "/api/duels/join", {"code": code}, session=bystander["session"]).status_code == 200


def test_server_countdown(browser: Browser, app_url: str, valkey: Valkey) -> None:
    with duel_pages(browser, app_url, "easy") as d:
        press_ready(d.pa)
        press_ready(d.pb)
        wait_frame(d.pa, d.fa, "countdown", "the first countdown message")
        wait_for(d.pa, lambda: is_disabled(button(d.pa, "Ready")), "Ready disabled during the countdown")
        sa = wait_frame(d.pa, d.fa, "start", "start to the first duelist")
        sb = wait_frame(d.pb, d.fb, "start", "start to the second duelist")
        expected = [math.ceil((DUEL_COUNTDOWN_MS - k * COUNTDOWN_STEP_MS) / COUNTDOWN_STEP_MS)
                    for k in range(DUEL_COUNTDOWN_MS // COUNTDOWN_STEP_MS)]
        for frames, start in ((d.fa, sa), (d.fb, sb)):
            cds = frames_of(frames, "countdown")
            assert [c["seconds_left"] for c in cds] == expected
            gap_ms = (start["_at"] - cds[0]["_at"]) * 1000
            assert DUEL_COUNTDOWN_MS - COUNTDOWN_STEP_MS < gap_ms < DUEL_COUNTDOWN_MS + COUNTDOWN_STEP_MS
        assert sa["started_at"] == sb["started_at"]
        assert sa["puzzle"] == sb["puzzle"] == PUZZLES["easy-3"][0]
        for pg in (d.pa, d.pb):
            for n in expected:
                wait_said(pg, f"Starting in {n}")
            wait_said(pg, "The duel has started.")
            wait_board(pg)
            assert headings(pg) == [f"Room {d.code}"]
        assert valkey.hash(f"seam:room:{d.code}")["state"] == "playing"


def test_opponent_progress(browser: Browser, app_url: str) -> None:
    sol = PUZZLES["medium-3"][1]
    with duel_pages(browser, app_url, "medium") as d:
        start_duel(d)
        an = d.a["display_name"]
        duel_enter(d.pa, [("r1c1", 2), ("r1c2", 9)])
        d.pa.keyboard.press("n")
        click(cell_loc(d.pa, "r1c3"))
        d.pa.keyboard.press("6")
        d.pa.keyboard.press("n")
        you = wait_frame(d.pa, d.fa, "you", "A's board after the moves",
                         pred=lambda f: f["correct"] == 1 and f["mistakes"] == 1 and f["notes"].get("r1c3") == [6])
        prog = wait_frame(d.pb, d.fb, "progress", "A's progress at B",
                          pred=lambda f: f["correct"] == 1 and f["mistakes"] == 1)
        first_you = next(f for f in frames_of(d.fa, "you") if f["correct"] == 1)
        first_prog = next(f for f in frames_of(d.fb, "progress") if f["correct"] == 1)
        assert first_prog["_at"] - first_you["_at"] < PROGRESS_S
        assert prog["display_name"] == an and you["values"][0] == "2"
        bar = d.pb.get_by_role("progressbar", name=f"{an}'s progress", exact=True)
        wait_for(d.pb, lambda: bar.count() == 1 and bar.get_attribute("aria-valuenow") == "1", "A's bar at 1")
        assert (bar.get_attribute("aria-valuemin"), bar.get_attribute("aria-valuemax")) == ("0", str(MEDIUM3_EMPTY))
        expect(bar).to_contain_text(f"{an}: 1 of {MEDIUM3_EMPTY}")
        wait_text(d.pb, "#opponent-mistakes", "Mistakes: 1/3")
        thread = d.pb.get_by_role("img", name=f"{an}'s thread: {stitches(1)}", exact=True)
        assert thread.count() == 1 and thread.get_attribute("id") == "hem-opponent"
        own = d.pa.get_by_role("progressbar", name="Your progress", exact=True)
        wait_for(d.pa, lambda: own.get_attribute("aria-valuenow") == "1", "Your progress at 1")
        expect(own).to_contain_text(f"You: 1 of {MEDIUM3_EMPTY}")
        b_cells = cells(d.pb)
        assert (b_cells["r1c1"]["value"], b_cells["r1c2"]["value"], b_cells["r1c3"]["notes"]) == ("", "", "")
        for f in frames_of(d.fb, "progress"):
            assert public_keys(f) == {"type", "display_name", "correct", "mistakes"}
        for f in frames_of(d.fb, "you"):
            assert f["values"][0] == "0" and "r1c3" not in f["notes"]
        for f in d.fb:
            for secret in (d.a["email"], d.a["player_id"], sol):
                assert secret not in f["_raw"]
        assert all(sol not in f["_raw"] for f in d.fa)


RESULT_CASES = ["finish", "out"]


@pytest.mark.parametrize("case", RESULT_CASES, ids=RESULT_CASES)
def test_duel_results(browser: Browser, app_url: str, case: str) -> None:
    with duel_pages(browser, app_url, "easy") as d:
        start_duel(d)
        an, bn = d.a["display_name"], d.b["display_name"]
        if case == "finish":
            duel_enter(d.pa, solve_entries("easy-3"))
            ra = wait_frame(d.pa, d.fa, "result", "A's result")
            rb = wait_frame(d.pb, d.fb, "result", "B's result")
            assert (ra["outcome"], ra["winner"], rb["outcome"], rb["winner"]) == ("win", an, "loss", an)
            t = clock(int(ra["seconds"]))
            want_a, want_b = f"You win! You finished first in {t}.", f"{an} wins. They finished first in {t}."
        else:
            duel_enter(d.pb, [("r1c4", 1), ("r1c4", 2), ("r1c4", 3)])
            ra = wait_frame(d.pa, d.fa, "result", "A's result")
            rb = wait_frame(d.pb, d.fb, "result", "B's result")
            assert (ra["outcome"], rb["outcome"], ra["winner"], rb["winner"]) == ("opponent_out", "out", an, an)
            want_a, want_b = f"{bn} is out. You win.", f"You're out: {MISTAKE_LIMIT} mistakes. {an} wins."
        for pg, want in ((d.pa, want_a), (d.pb, want_b)):
            wait_shown(pg, dialog(pg, "Duel over"), "Duel over")
            wait_text(pg, "#duel-result", want)
            wait_said(pg, want)
        room = api(app_url, "GET", f"/api/duels/{d.code}", session=d.a["session"]).json()["room"]
        assert room["state"] == "finished"


def test_wf_duel_play_happy(browser: Browser, app_url: str) -> None:
    a, b = make_players(app_url, "dhA", "dhB")
    fa: list[dict[str, Any]] = []
    fb: list[dict[str, Any]] = []
    with visit(browser, app_url, "/duel", a, hook=lambda pg: listen(pg, fa)) as pa:
        wait_heading(pa, "Duel")
        level = pa.get_by_role("radiogroup", name="Level", exact=True)
        wait_shown(pa, level, "the Level radiogroup")
        expect(level.get_by_role("radio", name="Easy", exact=True)).to_be_checked()
        click(button(pa, "Create room"))
        wait_for(pa, lambda: re.search(f"/duel/[{CODE_ALPHABET}]{{6}}$", pa.url) is not None, "Create room opens /duel/<CODE>")
        code = pa.url.rsplit("/", 1)[1]
        with visit(browser, app_url, "/duel", b, hook=lambda pg: listen(pg, fb)) as pb:
            box = pb.get_by_role("textbox", name="Room code", exact=True)
            wait_shown(pb, box, "Room code")
            fill(box, f"{code[:3].lower()}-{code[3:].lower()}")
            assert box.input_value().replace("-", "").replace(" ", "") == code
            box.press("Enter")
            wait_for(pb, lambda: pb.url.endswith(f"/duel/{code}"), "Enter in the field joins the room")
            seats = pa.get_by_role("list", name="Seats", exact=True)
            wait_for(pa, lambda: b["display_name"] in ((seats.first.text_content() or "") if seats.count() else ""), "both seats listed")
            d = Duel(app_url, a, b, code, pa, pb, fa, fb)
            start_duel(d)
            assert button(pa, "Hint").count() == 0 and button(pa, "Pause").count() == 0
            pa.keyboard.press("h")
            wait_said(pa, "Hints are off in duels.")
            pa.keyboard.press("p")
            wait_said(pa, "Duels can't be paused.")
            entries = solve_entries("easy-3")
            duel_enter(pa, entries[:1])
            bar = pb.get_by_role("progressbar", name=f"{a['display_name']}'s progress", exact=True)
            wait_for(pb, lambda: bar.count() == 1 and bar.get_attribute("aria-valuenow") == "1", "B watches A's progress")
            duel_enter(pa, entries[1:])
            ra = wait_frame(pa, fa, "result", "A's result")
            t = clock(int(ra["seconds"]))
            wait_text(pa, "#duel-result", f"You win! You finished first in {t}.")
            wait_text(pb, "#duel-result", f"{a['display_name']} wins. They finished first in {t}.")
            click(button(dialog(pb, "Duel over"), "Back to duels"))
            wait_for(pb, lambda: pb.url.endswith("/duel"), "Back to duels opens /duel")
    assert api(app_url, "GET", f"/api/duels/{code}", session=a["session"]).json()["room"]["state"] == "finished"


def test_wf_duel_play_join_errors(browser: Browser, app_url: str) -> None:
    host, second, late = make_players(app_url, "jeH", "jeS", "jeL")
    unv = make_player(app_url, "jeU", verified=False)
    code = create_room(app_url, host, "easy")
    for who, typed, sentence in ((unv, code, "Confirm your email to join duels."),
                                 (late, absent_code(), "No room has that code.")):
        with visit(browser, app_url, "/duel", who) as page:
            box = page.get_by_role("textbox", name="Room code", exact=True)
            wait_shown(page, box, "Room code")
            fill(box, typed)
            click(button(page, "Join room"))
            wait_said(page, sentence)
    assert api(app_url, "POST", "/api/duels/join", {"code": code}, session=second["session"]).status_code == 200
    with visit(browser, app_url, "/duel", late) as page:
        box = page.get_by_role("textbox", name="Room code", exact=True)
        wait_shown(page, box, "Room code")
        fill(box, code)
        box.press("Enter")
        wait_said(page, "This room already has two players.")
    room = api(app_url, "GET", f"/api/duels/{code}", session=host["session"]).json()["room"]
    assert [s["display_name"] for s in room["seats"]] == [host["display_name"], second["display_name"]]


def test_reload_window(browser: Browser, valkey: Valkey) -> None:
    base = instance("APP_DUEL_SHORT_URL")
    with duel_pages(browser, base, "easy") as d:
        start_duel(d)
        duel_enter(d.pa, [("r1c4", 6)])
        d.pa.keyboard.press("n")
        click(cell_loc(d.pa, "r1c8"))
        d.pa.keyboard.press("5")
        d.pa.keyboard.press("n")
        wait_frame(d.pa, d.fa, "you", "A's saved board", pred=lambda f: f["correct"] == 1 and f["notes"].get("r1c8") == [5])
        d.pa.reload()
        wait_board(d.pa)
        wait_cell(d.pa, "r1c4", value="6")
        wait_cell(d.pa, "r1c8", notes="5")
        assert attr_of(d.pa, "#hem", "data-stitches") == "1"
        an = d.a["display_name"]
        wait_frame(d.pb, d.fb, "presence", "reconnecting", pred=lambda f: f["display_name"] == an and f["state"] == "reconnecting")
        wait_frame(d.pb, d.fb, "presence", "back", pred=lambda f: f["display_name"] == an and f["state"] == "back")
        assert not frames_of(d.fb, "result")
        dropped = time.monotonic()
        d.pa.goto(base + "/")
        res = wait_frame(d.pb, d.fb, "result", "forfeit after the reload window")
        assert res["outcome"] == "forfeit_win" and res["winner"] == d.b["display_name"]
        assert res["_at"] - dropped >= SHORT_REJOIN_MS / 1000
        wait_api(lambda: not valkey.keys(f"seam:presence:{d.code}:{d.a['player_id']}"), "A's presence key removed")


def test_duel_outage(app_url: str) -> None:
    base = instance("APP_VALKEY_DOWN_URL")
    p = make_player(base, "vdP")
    unv = make_player(base, "vdU", verified=False)
    for method, path, body in (("POST", "/api/duels", {"level": "easy"}), ("POST", "/api/duels/join", {"code": absent_code()}),
                               ("GET", f"/api/duels/{absent_code()}", None)):
        r = api(base, method, path, body, session=p["session"])
        assert (r.status_code, code_of(r)) == (503, "LIVE_UNAVAILABLE"), path
    r = api(base, "POST", "/api/duels", {"level": "easy"}, session=unv["session"])
    assert (r.status_code, code_of(r)) == (403, "NOT_VERIFIED")
    r = api(base, "POST", "/api/games", {"level": "hard"}, session=p["session"])
    assert r.status_code == 201 and r.json()["game"]["level"] == "hard"
    gid = seed_game(base, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    r = finish(base, p, gid, {"moves": [enter(1, 1000, "r9c9", 4)]})
    assert r.status_code == 200 and r.json()["result"]["level"] == "easy"
    r = api(base, "POST", f"/api/daily/{DAILY_START.isoformat()}/game", session=p["session"])
    assert r.status_code == 201 and r.json()["game"]["puzzle_id"] == "daily-1"


def test_wf_duel_rejoin_reconnect_forfeit(browser: Browser) -> None:
    base = instance("APP_DUEL_SHORT_URL")
    with duel_pages(browser, base, "easy") as d:
        start_duel(d)
        an = d.a["display_name"]
        d.pa.reload()
        wait_said(d.pb, f"{an} is reconnecting.")
        wait_board(d.pa)
        wait_said(d.pb, f"{an} is back.")
        assert d.pb.get_by_text(f"{an} is back.", exact=True).count() >= 1
        d.pa.goto(base + "/")
        wait_for(d.pb, lambda: text_of(d.pb, "#duel-result") == f"{an} left the duel. You win.", "M38 in #duel-result")
        wait_said(d.pb, f"{an} left the duel. You win.")
        assert shown(dialog(d.pb, "Duel over"))
        assert frames_of(d.fb, "result")[0]["outcome"] == "forfeit_win"


def test_wf_duel_rejoin_tie(browser: Browser) -> None:
    base = instance("APP_DUEL_SHORT_URL")
    with duel_pages(browser, base, "easy") as d:
        start_duel(d)
        entries = solve_entries("easy-3")
        duel_enter(d.pa, entries[:-1])
        duel_enter(d.pb, entries[:-1])
        wait_frame(d.pb, d.fb, "you", "B one cell from done", pred=lambda f: f["correct"] == len(entries) - 1)
        duel_enter(d.pa, entries[-1:])
        duel_enter(d.pb, entries[-1:])
        for pg, frames in ((d.pa, d.fa), (d.pb, d.fb)):
            res = wait_frame(pg, frames, "result", "the tie result")
            assert res["outcome"] == "tie" and res["winner"] is None
            wait_text(pg, "#duel-result", "It's a tie.")
            wait_said(pg, "It's a tie.")
        room = api(base, "GET", f"/api/duels/{d.code}", session=d.a["session"]).json()["room"]
        assert room["state"] == "tie"


def test_wf_duel_rejoin_outage(browser: Browser) -> None:
    base = instance("APP_VALKEY_DOWN_URL")
    p = make_player(base, "dnP")
    notice = "Live duels are unavailable right now. Solo games and the daily challenge still work."
    with visit(browser, base, "/duel", p) as page:
        wait_text(page, "#duel-notice", notice)
        wait_said(page, notice)
        assert is_disabled(button(page, "Create room")) and is_disabled(button(page, "Join room"))
    r = api(base, "POST", "/api/duels", {"level": "easy"}, session=p["session"])
    assert (r.status_code, code_of(r)) == (503, "LIVE_UNAVAILABLE")


FINISH_CASES = ["unauthenticated", "closed", "malformed_body", "unknown_op", "bad_cell", "bad_digit", "missing_digit",
                "too_many_moves", "sequence", "time", "given", "locked_entry", "locked_note", "hint_mismatch",
                "hint_limit", "mistake_limit", "early_second_chance", "unsolved", "sequence_before_given"]
FINISH_EXPECT: dict[str, tuple[int, str, Any]] = {
    "unauthenticated": (401, "UNAUTHENTICATED", ...), "closed": (409, "CLOSED_GAME", ...),
    "malformed_body": (400, "LOG_MALFORMED", None), "unknown_op": (400, "LOG_MALFORMED", None),
    "bad_cell": (400, "LOG_MALFORMED", None), "bad_digit": (400, "LOG_MALFORMED", None),
    "missing_digit": (400, "LOG_MALFORMED", None), "too_many_moves": (400, "LOG_MALFORMED", None),
    "sequence": (422, "LOG_SEQUENCE", 3), "time": (422, "LOG_TIME", 2), "given": (422, "GIVEN_CELL", 1),
    "locked_entry": (422, "LOCKED_CELL", 1), "locked_note": (422, "LOCKED_CELL", 1),
    "hint_mismatch": (422, "HINT_MISMATCH", 1), "hint_limit": (422, "HINT_LIMIT", 1),
    "mistake_limit": (422, "MISTAKE_LIMIT", 2), "early_second_chance": (422, "MISTAKE_LIMIT", 1),
    "unsolved": (422, "BOARD_UNSOLVED", None), "sequence_before_given": (422, "LOG_SEQUENCE", 2),
}


@pytest.mark.parametrize("case", FINISH_CASES, ids=FINISH_CASES)
def test_move_log_replay(app_url: str, case: str) -> None:
    p = make_player(app_url, "replay")
    keep = {"r9c7", "r9c8", "r9c9"}
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", keep),
                    hints=HINT_LIMIT if case == "hint_limit" else 0, mistakes=2 if case == "mistake_limit" else 0)
    hc, hd = hint_pick("easy-1", {**givens("easy-1"), **{e["cell"]: e["digit"] for e in fill_except("easy-1", keep)}})
    honest = [enter(1, 0, "r9c7", 1), enter(2, 0, "r9c8", 3), enter(3, 0, "r9c9", 4)]
    bodies: dict[str, Any] = {
        "unauthenticated": {"moves": honest}, "closed": {"moves": honest}, "malformed_body": {"moves": "all"},
        "unknown_op": {"moves": [{"n": 1, "t": 0, "op": "teleport"}]},
        "bad_cell": {"moves": [enter(1, 0, "r0c1", 1)]}, "bad_digit": {"moves": [enter(1, 0, "r9c7", 10)]},
        "missing_digit": {"moves": [{"n": 1, "t": 0, "op": "enter", "cell": "r9c7"}]},
        "too_many_moves": {"moves": [{"n": i + 1, "t": 0, "op": "pause" if i % 2 == 0 else "resume"} for i in range(MOVE_LIMIT + 1)]},
        "sequence": {"moves": [enter(1, 0, "r9c7", 1), enter(3, 0, "r9c8", 3)]},
        "time": {"moves": [{"n": 1, "t": 1000, "op": "pause"}, {"n": 2, "t": 500, "op": "resume"}]},
        "given": {"moves": [enter(1, 0, "r1c4", 3)]},
        "locked_entry": {"moves": [{"n": 1, "t": 0, "op": "erase", "cell": "r1c1"}]},
        "locked_note": {"moves": [{"n": 1, "t": 0, "op": "note", "cell": "r1c1", "digit": 2}]},
        "hint_mismatch": {"moves": [{"n": 1, "t": 0, "op": "hint", "cell": "r9c9", "digit": 4}]},
        "hint_limit": {"moves": [{"n": 1, "t": 0, "op": "hint", "cell": hc, "digit": hd}]},
        "mistake_limit": {"moves": [enter(1, 0, "r9c7", 2), enter(2, 0, "r9c8", 3)]},
        "early_second_chance": {"moves": [{"n": 1, "t": 0, "op": "second_chance"}]},
        "unsolved": {"moves": [enter(1, 0, "r9c7", 1)]},
        "sequence_before_given": {"moves": [enter(2, 0, "r1c4", 3)]},
    }
    if case == "closed":
        assert api(app_url, "POST", "/api/games", {"level": "easy"}, session=p["session"]).status_code == 201
    r = finish(app_url, None if case == "unauthenticated" else p, gid, bodies[case])
    status, code, move = FINISH_EXPECT[case]
    assert (r.status_code, code_of(r)) == (status, code), r.text
    if move is not ...:
        assert r.json()["error"]["move"] == move
    game = get_game(app_url, p, gid)
    assert game["result"] is None and game["status"] == ("abandoned" if case == "closed" else "playing")
    assert get_profile(app_url, p)["levels"]["easy"]["won"] == 0


def test_finish_counts_once(app_url: str) -> None:
    p1, p2, p3 = make_players(app_url, "once1", "once2", "once3")
    gid = seed_game(app_url, p1, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    log = {"moves": [enter(1, 1000, "r9c9", 4)]}
    r1 = finish(app_url, p1, gid, log)
    assert r1.status_code == 200, r1.text
    res = r1.json()["result"]
    assert (res["level"], res["seconds"], res["mistakes"], res["hints"], res["score"], res["daily_state"]) == (
        "easy", 1, 0, 0, score("easy", 1, 0, 0), None)
    r2 = finish(app_url, p1, gid, log)
    assert r2.status_code == 200 and r2.json()["result"] == res
    r3 = finish(app_url, p1, gid, {"moves": [enter(1, 2000, "r9c9", 4)]})
    assert (r3.status_code, code_of(r3)) == (409, "ALREADY_FINISHED")
    prof = get_profile(app_url, p1)
    assert prof["levels"]["easy"]["won"] == 1 and [g["id"] for g in prof["finished_games"]].count(gid) == 1
    g2 = seed_game(app_url, p2, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    out = together([lambda: finish(app_url, p2, g2, log) for _ in range(5)])
    assert all(r.status_code == 200 for r in out) and len({json.dumps(r.json()["result"], sort_keys=True) for r in out}) == 1
    assert get_profile(app_url, p2)["levels"]["easy"]["won"] == 1
    g3 = seed_game(app_url, p3, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    out = together([lambda t=t: finish(app_url, p3, g3, {"moves": [enter(1, t, "r9c9", 4)]}) for t in (1000, 2000, 3000, 4000, 5000)])
    assert sum(r.status_code == 200 for r in out) == 1
    assert all(code_of(r) == "ALREADY_FINISHED" for r in out if r.status_code != 200)
    assert get_profile(app_url, p3)["levels"]["easy"]["won"] == 1


def test_progress_saving(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "save")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("4")
        go(page, "r1c3")
        page.keyboard.press("n")
        page.keyboard.press("5")
        page.keyboard.press("n")
        page.keyboard.press("p")
        page.keyboard.press("p")
        advance(page, 4000)
        page.keyboard.press("n")
        page.keyboard.press("6")
        moves = wait_moves(app_url, p, gid, ["enter", "note", "pause", "resume", "note"])
        game = get_game(app_url, p, gid)
        expected = max(game["elapsed_ms"], moves[-1]["t"]) // 1000
        page.reload()
        wait_board(page)
        secs = parse_clock(text_of(page, "#timer") or "0")
        assert expected <= secs <= expected + 1
        cs = cells(page)
        assert cs["r1c1"]["value"] == "4" and cs["r1c3"]["notes"] == "5 6" and selected_cell(page) == "r1c3"
        assert board_state(page) == "playing"
    g = seed_game(app_url, p, "easy-1", mistakes=2)
    put = lambda body: api(app_url, "PUT", f"/api/games/{g}/moves", body, session=p["session"])
    lost_log = [enter(1, 100, "r1c1", 5)]
    r = put({"moves": lost_log, "elapsed_ms": 100})
    assert r.status_code == 200 and r.json()["game"]["status"] == "lost"
    r = put({"moves": lost_log + [{"n": 2, "t": 200, "op": "second_chance"}], "elapsed_ms": 200})
    assert r.status_code == 200 and r.json()["game"]["status"] == "playing"
    r = put({"moves": "all", "elapsed_ms": 0})
    assert (r.status_code, code_of(r)) == (400, "LOG_MALFORMED")
    r = put({"moves": [enter(1, 0, "r1c4", 3)], "elapsed_ms": 0})
    assert (r.status_code, code_of(r), r.json()["error"]["move"]) == (422, "GIVEN_CELL", 1)
    assert api(app_url, "POST", "/api/games", {"level": "easy"}, session=p["session"]).status_code == 201
    r = put({"moves": [], "elapsed_ms": 0})
    assert (r.status_code, code_of(r)) == (409, "CLOSED_GAME")


def test_statistics_recount(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "stats")
    finished_game(app_url, p, "easy", "won", 300000, 0, 0, "2026-10-01T12:00:00+13:00")
    finished_game(app_url, p, "easy", "won", 200000, 1, 1, "2026-10-02T12:00:00+13:00")
    finished_game(app_url, p, "easy", "lost", 120000, 3, 0, "2026-10-03T12:00:00+13:00")
    finished_game(app_url, p, "medium", "won", 100000, 0, 0, "2026-10-04T12:00:00+13:00")
    seed_game(app_url, p, "easy-2")
    prof = get_profile(app_url, p)
    e, m, h = prof["levels"]["easy"], prof["levels"]["medium"], prof["levels"]["hard"]
    assert (e["started"], e["won"], e["best_seconds"], e["average_seconds"], e["best_score"]) == (4, 2, 200, 250, 1200)
    assert (m["started"], m["won"], m["best_seconds"], m["best_score"]) == (1, 1, 100, 2900)
    assert (h["started"], h["won"], h["win_rate"], h["best_seconds"], h["average_seconds"], h["best_score"]) == (0, 0, None, None, None, None)
    assert [(g["date"], g["level"], g["result"], g["seconds"], g["score"]) for g in prof["finished_games"]] == [
        ("2026-10-04", "medium", "won", 100, 2900), ("2026-10-03", "easy", "lost", 120, None),
        ("2026-10-02", "easy", "won", 200, 850), ("2026-10-01", "easy", "won", 300, 1200)]
    rows = [["2026-10-04", "Medium", "Won", clock(100), "2900"], ["2026-10-03", "Easy", "Lost", clock(120), "-"],
            ["2026-10-02", "Easy", "Won", clock(200), "850"], ["2026-10-01", "Easy", "Won", clock(300), "1200"]]
    with visit(browser, app_url, "/profile", p) as page:
        for _ in range(2):
            wait_heading(page, "Profile")
            wait_for(page, lambda: finished_rows(page) == rows, "the Finished games recount")
            easy = page.get_by_role("tab", name="Easy", exact=True)
            click(easy)
            wait_for(page, lambda: panel_values(page).get("Games started") == "4", "Easy stats")
            assert panel_values(page) == {"Games started": "4", "Games won": "2", "Win rate": "50%", "Best time": clock(200),
                                          "Average time": clock(250), "Best score": "1200"}
            page.keyboard.press("ArrowRight")
            med = page.get_by_role("tab", name="Medium", exact=True)
            wait_for(page, lambda: med.get_attribute("aria-selected") == "true" and focused(med), "Medium selected")
            wait_for(page, lambda: panel_values(page).get("Win rate") == "100%", "Medium stats")
            assert easy.get_attribute("tabindex") == "-1" and med.get_attribute("tabindex") == "0"
            page.keyboard.press("End")
            wait_for(page, lambda: page.get_by_role("tab", name="Expert", exact=True).get_attribute("aria-selected") == "true", "End selects Expert")
            assert panel_values(page) == {"Games started": "0", "Games won": "0", "Win rate": "-", "Best time": "-",
                                          "Average time": "-", "Best score": "-"}
            page.keyboard.press("Home")
            wait_for(page, lambda: easy.get_attribute("aria-selected") == "true", "Home selects Easy")
            page.reload()


def test_private_games(browser: Browser, app_url: str) -> None:
    owner, other = make_players(app_url, "own", "snoop")
    gid = seed_game(app_url, owner, "easy-1")
    ghost = str(uuid.uuid4())
    for method, suffix, body in (("GET", "", None), ("PUT", "/moves", {"moves": [], "elapsed_ms": 0}),
                                 ("POST", "/finish", {"moves": []})):
        theirs = api(app_url, method, f"/api/games/{gid}{suffix}", body, session=other["session"])
        none = api(app_url, method, f"/api/games/{ghost}{suffix}", body, session=other["session"])
        assert (theirs.status_code, code_of(theirs)) == (404, "UNKNOWN_GAME")
        assert theirs.json() == none.json()
    docs = [httpx.get(f"{app_url}/play/{x}", headers={"Accept": "text/html", "Cookie": f"seam_session={other['session']}"},
                      timeout=HTTP_TIMEOUT) for x in (gid, ghost)]
    assert [d.status_code for d in docs] == [404, 404] and docs[0].content == docs[1].content
    assert get_game(app_url, owner, gid)["id"] == gid
    with visit(browser, app_url, f"/play/{gid}", other) as page:
        wait_heading(page, "This game isn't in the collection.")
        page.goto(app_url + f"/nowhere-{ghost}")
        wait_heading(page, "This page isn't in the collection.")


def test_wf_verified_results_tampered(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "tamp")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        def tamper(route: Any) -> None:
            body = json.loads(route.request.post_data or "{}")
            body["moves"][-1]["t"] = -1
            route.continue_(post_data=json.dumps(body))
        page.route("**/api/games/*/finish", tamper)
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("4")
        refused = dialog(page, "Not counted", "alertdialog")
        wait_shown(page, refused, "the Not counted alertdialog")
        sentence = "This game could not be verified (LOG_TIME). It was not counted."
        expect(refused).to_contain_text(sentence)
        wait_said(page, sentence)
        click(button(refused, "Close"))
        wait_for(page, lambda: not shown(refused) and page.evaluate(FOCUS_ON_SELECTED_JS), "Close returns focus to the board")
        game = get_game(app_url, p, gid)
        assert game["status"] == "playing" and game["result"] is None
        assert get_profile(app_url, p)["levels"]["easy"]["won"] == 0
        r = finish(app_url, p, gid, {"moves": game["moves"]})
        assert r.status_code == 200, r.text
        page.goto(app_url + "/profile")
        click(page.get_by_role("tab", name="Easy", exact=True))
        wait_for(page, lambda: panel_values(page).get("Games won") == "1", "Easy Games won 1 after reload")
        page.reload()
        click(page.get_by_role("tab", name="Easy", exact=True))
        wait_for(page, lambda: panel_values(page).get("Games won") == "1", "the same recount after reload")
    prof = get_profile(app_url, p)
    assert prof["levels"]["easy"]["won"] == 1 and [g["id"] for g in prof["finished_games"]].count(gid) == 1


def test_wf_verified_results_honest_twice(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "twice")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        def duplicate(route: Any) -> None:
            route.fetch()
            route.fulfill(response=route.fetch())
        page.route("**/api/games/*/finish", duplicate)
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("4")
        wait_shown(page, dialog(page, "Puzzle solved"), "Puzzle solved")
        game = get_game(app_url, p, gid)
        again = finish(app_url, p, gid, {"moves": game["moves"]})
        assert again.status_code == 200 and again.json()["result"] == game["result"]
        prof = get_profile(app_url, p)
        assert prof["levels"]["easy"]["won"] == 1 and len(prof["finished_games"]) == 1
        page.goto(app_url + "/profile")
        page.reload()
        res = game["result"]
        wait_for(page, lambda: finished_rows(page) == [[prof["finished_games"][0]["date"], "Easy", "Won",
                                                        clock(res["seconds"]), str(res["score"])]], "one Won row")
        click(page.get_by_role("tab", name="Easy", exact=True))
        wait_for(page, lambda: panel_values(page).get("Games won") == "1" and panel_values(page).get("Games started") == "1",
                 "Easy started 1, won 1")


def test_signup_and_verification(browser: Browser, app_url: str, mail: Mailpit) -> None:
    name = ident("sign")
    email = f"{name.lower()}@example.test"
    r = api(app_url, "POST", "/api/auth/signup", {"email": email, "display_name": name, "password": PASSWORD})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["verification_sent"] is True and body["player"]["verified"] is False
    assert set(body["player"]) == {"player_id", "email", "display_name", "verified"}
    sess = r.cookies.get("seam_session")
    assert sess and SESSION_FLAG.lower() in r.headers.get("set-cookie", "").lower()
    assert api(app_url, "GET", "/api/me", session=sess).json()["player"]["verified"] is False
    msg = wait_mail(mail, email, "Confirm your email for Seam")[0]
    assert mail_from_address() in addresses(msg.get("From"))
    token = link_token(app_url, msg, "verify")
    r = api(app_url, "POST", "/api/auth/verify", {"token": f"x{uuid.uuid4().hex}"})
    assert (r.status_code, code_of(r)) == (404, "TOKEN_NOT_FOUND")
    r = api(app_url, "POST", "/api/auth/verify", {"token": token})
    assert r.status_code == 200 and r.json()["player"] == {"display_name": name, "verified": True}
    assert api(app_url, "GET", "/api/me", session=sess).json()["player"]["verified"] is True
    r = api(app_url, "POST", "/api/auth/verify", {"token": token})
    assert (r.status_code, code_of(r)) == (409, "TOKEN_USED")
    r = api(app_url, "POST", "/api/auth/verify/resend", session=sess)
    assert (r.status_code, code_of(r)) == (409, "ALREADY_VERIFIED")
    for field, value, message in (("email", "not-an-email", "Enter a valid email address."),
                                  ("email", email.upper(), "That email already has an account."),
                                  ("display_name", "ab", "Use 3 to 20 characters."),
                                  ("display_name", name.upper(), "That display name is taken."),
                                  ("password", SHORT_PASSWORD, "Use at least 10 characters.")):
        fresh = ident("bad")
        req = {"email": f"{fresh.lower()}@example.test", "display_name": fresh, "password": PASSWORD, field: value}
        r = api(app_url, "POST", "/api/auth/signup", req)
        assert (r.status_code, code_of(r)) == (422, "VALIDATION") and r.json()["error"]["fields"][field] == message
    twice = ident("again")
    r = api(app_url, "POST", "/api/auth/signup", {"email": f"{twice.lower()}@example.test", "display_name": twice, "password": PASSWORD})
    s2 = r.cookies.get("seam_session")
    first = link_token(app_url, wait_mail(mail, f"{twice.lower()}@example.test", "Confirm your email for Seam")[0], "verify")
    r = api(app_url, "POST", "/api/auth/verify/resend", session=s2)
    assert r.status_code == 202 and r.json() == {"sent": True}
    wait_mail(mail, f"{twice.lower()}@example.test", "Confirm your email for Seam", count=2)
    assert api(app_url, "POST", "/api/auth/verify", {"token": first}).status_code == 200
    old = ident("expire")
    with server_clock(app_url, "2026-11-03T10:00:00+13:00"):
        r = api(app_url, "POST", "/api/auth/signup", {"email": f"{old.lower()}@example.test", "display_name": old, "password": PASSWORD})
        s3 = r.cookies.get("seam_session")
        tok = link_token(app_url, wait_mail(mail, f"{old.lower()}@example.test", "Confirm your email for Seam")[0], "verify")
        set_clock(app_url, f"2026-11-03T{10 + (VERIFY_TTL_MIN + 1) // 60}:{(VERIFY_TTL_MIN + 1) % 60:02d}:00+13:00")
        r = api(app_url, "POST", "/api/auth/verify", {"token": tok})
        assert (r.status_code, code_of(r)) == (410, "TOKEN_EXPIRED")
    assert api(app_url, "GET", "/api/me", session=s3).json()["player"]["verified"] is False
    with visit(browser, app_url, "/signup") as page:
        wait_heading(page, "Create your account")
        fill(page.get_by_label("Email", exact=True), f"{ident('ui').lower()}@example.test")
        fill(page.get_by_label("Display name", exact=True), name)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(button(page, "Create account"))
        alert = page.get_by_role("alert").filter(has=page.get_by_role("heading", name="Check these details", exact=True))
        wait_shown(page, alert, "the Check these details alert")
        click(alert.get_by_role("link", name="That display name is taken.", exact=True))
        wait_focused(page, page.get_by_label("Display name", exact=True), "the Display name field")


def test_password_reset(browser: Browser, app_url: str, mail: Mailpit) -> None:
    p = make_player(app_url, "reset")
    r = api(app_url, "POST", "/api/auth/signin", {"email": p["email"], "password": PASSWORD})
    assert r.status_code == 200
    s2 = r.cookies.get("seam_session")
    r = api(app_url, "POST", "/api/auth/reset", {"email": p["email"]})
    assert r.status_code == 202 and r.json() == {"sent": True}
    msg = wait_mail(mail, p["email"], "Reset your Seam password")[0]
    assert mail_from_address() in addresses(msg.get("From"))
    token = link_token(app_url, msg, "reset")
    r = api(app_url, "POST", "/api/auth/reset/confirm", {"token": token, "password": SHORT_PASSWORD})
    assert (r.status_code, code_of(r)) == (422, "VALIDATION")
    assert r.json()["error"]["fields"]["password"] == "Use at least 10 characters."
    r = api(app_url, "POST", "/api/auth/reset/confirm", {"token": f"x{uuid.uuid4().hex}", "password": NEW_PASSWORD})
    assert (r.status_code, code_of(r)) == (404, "TOKEN_NOT_FOUND")
    with visit(browser, app_url, f"/reset/{token}") as page:
        wait_heading(page, "Choose a new password")
        fill(page.get_by_label("New password", exact=True), NEW_PASSWORD)
        click(button(page, "Save password"))
        wait_said(page, "Your password is saved.")
        fresh = cookie_session(page)
    assert api(app_url, "GET", "/api/me", session=fresh).status_code == 200
    for old in (p["session"], s2):
        r = api(app_url, "GET", "/api/me", session=old)
        assert (r.status_code, code_of(r)) == (401, "UNAUTHENTICATED")
    r = api(app_url, "POST", "/api/auth/signin", {"email": p["email"], "password": PASSWORD})
    assert (r.status_code, code_of(r)) == (401, "BAD_CREDENTIALS")
    assert api(app_url, "POST", "/api/auth/signin", {"email": p["email"], "password": NEW_PASSWORD}).status_code == 200
    r = api(app_url, "POST", "/api/auth/reset/confirm", {"token": token, "password": NEW_PASSWORD + "x"})
    assert (r.status_code, code_of(r)) == (409, "TOKEN_USED")
    nobody = f"nobody-{ident('nob').lower()}@example.test"
    assert api(app_url, "POST", "/api/auth/reset", {"email": nobody}).status_code == 202
    assert mails_to(mail, nobody) == []
    r = api(app_url, "POST", "/api/auth/reset", {"email": "not-an-email"})
    assert (r.status_code, code_of(r)) == (422, "VALIDATION")
    q = make_player(app_url, "rexp")
    with server_clock(app_url, "2026-11-03T10:00:00+13:00"):
        api(app_url, "POST", "/api/auth/reset", {"email": q["email"]})
        tok = link_token(app_url, wait_mail(mail, q["email"], "Reset your Seam password")[0], "reset")
        set_clock(app_url, f"2026-11-03T10:{RESET_TTL_MIN + 1}:00+13:00")
        r = api(app_url, "POST", "/api/auth/reset/confirm", {"token": tok, "password": NEW_PASSWORD})
        assert (r.status_code, code_of(r)) == (410, "TOKEN_EXPIRED")
    assert api(app_url, "GET", "/api/me", session=q["session"]).status_code == 200


def test_mail_outage(browser: Browser, mail: Mailpit) -> None:
    base = instance("APP_MAILPIT_DOWN_URL")
    name = ident("mdown")
    email = f"{name.lower()}@example.test"
    r = api(base, "POST", "/api/auth/signup", {"email": email, "display_name": name, "password": PASSWORD})
    assert r.status_code == 201 and r.json()["verification_sent"] is False
    sess = r.cookies.get("seam_session")
    r = api(base, "POST", "/api/auth/verify/resend", session=sess)
    assert (r.status_code, code_of(r)) == (503, "MAIL_UNAVAILABLE")
    for target in (email, f"nobody-{name.lower()}@example.test"):
        r = api(base, "POST", "/api/auth/reset", {"email": target})
        assert (r.status_code, code_of(r)) == (503, "MAIL_UNAVAILABLE")
    ui = ident("mdui")
    ui_email = f"{ui.lower()}@example.test"
    m49 = "Your account is ready, but we couldn't send the confirmation email. Use Send again in a minute."
    with visit(browser, base, "/signup") as page:
        fill(page.get_by_label("Email", exact=True), ui_email)
        fill(page.get_by_label("Display name", exact=True), ui)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(button(page, "Create account"))
        wait_said(page, m49)
        assert page.get_by_text(m49, exact=True).count() >= 2
        page.goto(base + "/reset")
        wait_heading(page, "Reset your password")
        fill(page.get_by_label("Email", exact=True), ui_email)
        click(button(page, "Send reset link"))
        wait_said(page, "We couldn't send email right now. Try again in a minute.")
    assert api(base, "GET", "/api/me", session=sess).json()["player"]["verified"] is False
    assert mails_to(mail, email) == [] and mails_to(mail, ui_email) == []


def test_hem_thread(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hem")
    gid = seed_game(app_url, p, "easy-1", entries=[{"cell": "r1c3", "digit": 4}])
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        hem = page.get_by_role("img", name=f"Your thread: {stitches(1)}", exact=True)
        assert hem.count() == 1 and hem.get_attribute("id") == "hem" and hem.get_attribute("data-stitches") == "1"
        tab_to_board(page)
        page.keyboard.press("6")
        wait_for(page, lambda: attr_of(page, "#hem", "data-stitches") == "2", "two stitches")
        assert page.get_by_role("img", name=f"Your thread: {stitches(2)}", exact=True).count() == 1
        anims = page.evaluate("() => window.__hemAnims")
        assert any(a["where"] == "hem" and a["duration"] == STITCH_MS for a in anims), anims
        assert any(a["where"] == "count" and a["duration"] == COUNT_ROLL_MS for a in anims), anims
        go(page, "r1c2")
        page.keyboard.press("9")
        wait_text(page, "#mistakes", "Mistakes: 1/3")
        assert attr_of(page, "#hem", "data-stitches") == "2"
        page.keyboard.press("Control+z")
        page.keyboard.press("Control+z")
        wait_for(page, lambda: attr_of(page, "#hem", "data-stitches") == "1", "the undone stitch taken back")
    gid2 = seed_game(app_url, p, "easy-1", entries=[{"cell": "r1c3", "digit": 4}])
    with visit(browser, app_url, f"/play/{gid2}", p, reduced_motion="reduce") as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("6")
        wait_live(page, lambda: attr_of(page, "#hem", "data-stitches") == "2" and text_of(page, "#hem-count") == "2",
                  "the stitch and count change at once")
        assert page.evaluate("() => window.__maxAnims") == 0


def test_announcements(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "say")
    gid = seed_game(app_url, p, "easy-1")
    for path, who in (("/", None), ("/signin", None), ("/daily", p), ("/profile", p), ("/duel", p), (f"/play/{gid}", p)):
        with visit(browser, app_url, path, who) as page:
            wait_for(page, lambda: (page.evaluate(ANNOUNCER_JS) or {}).get("count") == 1, f"one #announcer on {path}")
            ann = page.evaluate(ANNOUNCER_JS)
            assert (ann["role"], ann["live"]) == ("status", "polite")
            if path.startswith("/play"):
                wait_board(page)
                tab_to_board(page)
                page.keyboard.press("Control+z")
                wait_said(page, "Nothing to undo.")
                page.keyboard.press("Control+z")
                wait_said(page, "Nothing to undo.", times=2)
    with visit(browser, app_url, "/signin") as page:
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if r.url.endswith("/api/auth/signin") else None)
        fill(page.get_by_label("Email", exact=True), p["email"])
        fill(page.get_by_label("Password", exact=True), "wrong-password-1")
        sign_in = button(page, "Sign in")
        with held(page, "**/api/auth/signin") as gate:
            click(sign_in)
            wait_said(page, "Signing you in.")
            wait_for(page, lambda: sign_in.get_attribute("aria-disabled") == "true", "Sign in pending")
            sign_in.dispatch_event("click")
            gate.release()
        wait_said(page, "Email or password is incorrect.")
        assert len(sent) == 1
        click(sign_in)
        wait_said(page, "Email or password is incorrect.", times=2)


PAGE_CASES = ["home", "signin", "daily", "leaderboard", "duel", "profile", "play"]


@pytest.mark.parametrize("which", PAGE_CASES, ids=PAGE_CASES)
def test_pages_and_landmarks(browser: Browser, app_url: str, which: str) -> None:
    p = make_player(app_url, "page")
    gid = seed_game(app_url, p, "easy-1")
    path, heading = {"home": ("/", None), "signin": ("/signin", "Sign in"), "daily": ("/daily", "Daily challenge"),
                     "leaderboard": ("/leaderboard", "Daily leaderboard"), "duel": ("/duel", "Duel"),
                     "profile": ("/profile", "Profile"), "play": (f"/play/{gid}", "Easy game")}[which]
    who = None if which == "signin" else p
    with visit(browser, app_url, path, who) as page:
        wait_for(page, lambda: len(headings(page)) == 1 and (heading is None or headings(page) == [heading]), "one h1")
        assert page.get_by_role("main").count() == 1
        nav = page.get_by_role("navigation", name="Main", exact=True)
        assert nav.count() == 1
        links = ["Seam", "Daily", "Duel", "Leaderboard", "Profile"] + (["Sign in", "Create account"] if who is None else [])
        for name in links:
            assert nav.get_by_role("link", name=name, exact=True).count() == 1, name
        assert (button(nav, "Sign out").count() == 1) == (who is not None)
        for w, h in VIEWPORTS:
            page.set_viewport_size({"width": w, "height": h})
            advance(page, STEP_MS)
            layout(page)
        if which == "play":
            wait_board(page)
            page.keyboard.press("p")
            paused = dialog(page, "Paused")
            wait_shown(page, paused, "Paused")
            for key in ["Tab"] * 4 + ["Shift+Tab"] * 4:
                page.keyboard.press(key)
                assert focus_inside(paused), f"{key} escaped the Paused dialog"


HEALTH_CASES = ["primary", "valkey_down", "mailpit_down", "duel_short"]
HEALTH_ENV = {"valkey_down": "APP_VALKEY_DOWN_URL", "mailpit_down": "APP_MAILPIT_DOWN_URL", "duel_short": "APP_DUEL_SHORT_URL"}
HEALTH_DOWN = {"primary": [], "valkey_down": ["valkey"], "mailpit_down": ["mailpit"], "duel_short": []}


@pytest.mark.parametrize("which", HEALTH_CASES, ids=HEALTH_CASES)
def test_health_on_every_instance(app_url: str, which: str) -> None:
    base = app_url if which == "primary" else instance(HEALTH_ENV[which])
    r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    if HEALTH_DOWN[which]:
        assert body == {"status": "degraded", "down": HEALTH_DOWN[which]}
    else:
        assert body == {"status": "ok"}


def test_grading_routes(app_url: str) -> None:
    v, u = make_player(app_url, "grV"), make_player(app_url, "grU", verified=False)
    for pl, verified in ((v, True), (u, False)):
        me = api(app_url, "GET", "/api/me", session=pl["session"]).json()["player"]
        assert (me["player_id"], me["email"], me["display_name"], me["verified"]) == (
            pl["player_id"], pl["email"], pl["display_name"], verified)
    gid = seed_game(app_url, v, "easy-1", entries=[{"cell": "r1c3", "digit": 4}], notes=[{"cell": "r1c2", "digits": [1, 8]}],
                    mistakes=1, hints=1, elapsed_ms=61000)
    g = get_game(app_url, v, gid)
    assert (g["mode"], g["level"], g["puzzle_id"], g["status"], g["puzzle"], g["solution"]) == (
        "solo", "easy", "easy-1", "playing", PUZZLES["easy-1"][0], PUZZLES["easy-1"][1])
    assert (g["start"]["mistakes"], g["start"]["hints"], g["start"]["elapsed_ms"], g["start"]["second_chance_used"]) == (1, 1, 61000, False)
    assert get_profile(app_url, v)["levels"]["easy"]["started"] == 1
    seed_game(app_url, v, "daily-5", mode="daily", day="2026-11-02")
    for kw in ({"entries": [{"cell": "r1c1", "digit": 5}]}, {"entries": [{"cell": "r1c4", "digit": 3}]},
               {"notes": [{"cell": "r1c4", "digits": [1]}]}, {"mistakes": MISTAKE_LIMIT},
               {"pid": "daily-1", "mode": "daily", "day": "2026-11-03"}, {"pid": "daily-5", "mode": "daily", "day": "2026-11-02"}):
        pid = kw.pop("pid", "easy-1")
        r = api(app_url, "POST", "/api/grading/games", seed_body(v, pid, **kw))
        assert (r.status_code, code_of(r)) == (422, "SEED_INVALID"), kw
    with server_clock(app_url, "2026-11-03T23:58:00+13:00"):
        assert api(app_url, "POST", "/api/grading/clock", {"now": "2026-11-03T23:58:00+13:00"}).json()["now"]
        assert get_daily(app_url, v)["today"] == "2026-11-03"
        daily_result(app_url, v, "2026-11-03", "2026-11-03T12:00:00+13:00")
        assert {d["date"]: d["state"] for d in get_daily(app_url, v, "2026-11")["days"]}["2026-11-03"] == "solved"
        set_clock(app_url, "2026-11-04T00:01:00+13:00")
        assert get_daily(app_url, v)["today"] == "2026-11-04"
    assert api(app_url, "POST", "/api/grading/clock", {"now": None}).status_code == 200


def ws_status(base: str, origin_header: str) -> int:
    u = urlparse(base)
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f"GET /ws HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin_header}\r\n\r\n")
    data = b""
    with socket.create_connection((u.hostname, u.port or 80), timeout=HTTP_TIMEOUT) as s:
        s.sendall(req.encode())
        deadline = time.monotonic() + HTTP_TIMEOUT
        while time.monotonic() < deadline and b"\r\n\r\n" not in data:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
    return int(data.split(b"\r\n", 1)[0].split()[1])


def test_server_boundary(browser: Browser, app_url: str) -> None:
    o = origin(app_url)
    evil = "http://elsewhere.example"
    creds = {"email": "nobody@example.test", "password": "wrong-password-1"}
    r = api(app_url, "POST", "/api/auth/signin", creds, headers={"Origin": evil})
    assert (r.status_code, code_of(r)) == (403, "CROSS_ORIGIN")
    shell = json.dumps({**creds, "pad": ""})
    exact = shell.replace('"pad": ""', '"pad": "' + "a" * (BODY_LIMIT - len(shell.encode())) + '"')
    assert len(exact.encode()) == BODY_LIMIT
    r = api(app_url, "POST", "/api/auth/signin", raw=exact, headers={"Content-Type": "application/json"})
    assert (r.status_code, code_of(r)) == (401, "BAD_CREDENTIALS")
    r = api(app_url, "POST", "/api/auth/signin", raw=exact[:-2] + 'a"}', headers={"Content-Type": "application/json"})
    assert (r.status_code, code_of(r)) == (413, "PAYLOAD_TOO_LARGE")
    r = api(app_url, "POST", "/api/auth/signin", raw="email=x", headers={"Content-Type": "text/plain"})
    assert (r.status_code, code_of(r)) == (415, "UNSUPPORTED_MEDIA_TYPE")
    r = api(app_url, "GET", f"/api/nowhere-{uuid.uuid4().hex}")
    assert (r.status_code, code_of(r)) == (404, "NOT_FOUND")
    assert ws_status(app_url, evil) == 403
    index = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT).text
    for probe in ("/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/run.json"):
        r = httpx.get(app_url + probe, timeout=HTTP_TIMEOUT)
        assert r.status_code != 200 or r.text == index, probe
    assets = {a for a in re.findall(r'(?:src|href)="(/[^"/][^"]*)"', index)}
    secrets = [x for x in (urlparse(os.environ.get("DATABASE_URL", "")).password, os.environ.get("VALKEY_URL")) if x and len(x) >= 6]
    for a in assets:
        r = httpx.get(app_url + a, timeout=HTTP_TIMEOUT)
        assert all(s not in r.text for s in secrets), a
        if a.endswith(".js"):
            m = httpx.get(app_url + a + ".map", timeout=HTTP_TIMEOUT)
            assert m.status_code != 200 or m.text == index, f"{a}.map is served"
    assert all(s not in index for s in secrets)
    with visit(browser, app_url, "/signin") as page:
        assert page.evaluate(WS_CLOSE_JS) == WS_NO_SESSION_CLOSE
    p = make_player(app_url, "bound")
    gid = seed_game(app_url, p, "easy-1")
    urls: list[str] = []
    with visit(browser, app_url, "/", p, hook=lambda pg: pg.on("request", lambda req: urls.append(req.url))) as page:
        for path in ("/", f"/play/{gid}", "/daily", "/leaderboard"):
            page.goto(app_url + path)
            wait_for(page, lambda: len(headings(page)) == 1, f"{path} rendered")
    foreign = [u for u in urls if u.startswith("http") and not same_origin(u, o)]
    assert foreign == [], foreign


def test_wf_keyboard_finish_wrap_and_dialog(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "kwrap")
    keep = {"r1c1", "r1c9", "r9c1", "r9c9"}
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", keep))
    with visit(browser, app_url, f"/play/{gid}", p, reduced_motion="reduce") as page:
        wait_board(page)
        assert selected_cell(page) == "r1c1"
        tab_to_board(page)
        for key, target in ((None, "r1c1"), ("ArrowLeft", "r1c9"), ("ArrowUp", "r9c9"), ("Home", "r9c1")):
            if key:
                page.keyboard.press(key)
                wait_for(page, lambda: selected_cell(page) == target and page.evaluate(FOCUS_ON_SELECTED_JS),
                         f"{key} moves selection and focus to {target}")
            digit = solution("easy-1", target)
            page.keyboard.press(str(digit))
            r, c = rc(target)
            if target != "r9c1":
                wait_cell(page, target, value=str(digit), wrong="false", label=label(target, str(digit)))
                wait_said(page, f"Row {r}, column {c}, {digit}.")
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "Puzzle solved")
        wait_focused(page, button(solved, "New game"), "New game")
        res = get_game(app_url, p, gid)["result"]
        wait_said(page, f"Solved in {clock(res['seconds'])}. Score {res['score']}.")
        for key in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            page.keyboard.press(key)
            assert focus_inside(solved), f"{key} left the Puzzle solved dialog"
        page.keyboard.press("Escape")
        wait_for(page, lambda: not shown(solved), "Escape closes Puzzle solved")
        wait_for(page, lambda: page.evaluate(FOCUS_ON_SELECTED_JS), "focus back on the board's selected cell")
    assert [m["op"] for m in get_game(app_url, p, gid)["moves"]] == ["enter"] * 4


def test_wf_notes_undo_keyboard_variants(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "nkeys")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        notes = button(page, "Notes")
        page.keyboard.press("N")
        wait_for(page, lambda: notes.get_attribute("aria-pressed") == "true", "N turns notes mode on")
        wait_said(page, "Notes on.")
        page.keyboard.press("4")
        wait_cell(page, "r1c1", notes="4", value="")
        wait_said(page, "Note 4 added to row 1, column 1.")
        page.keyboard.press("2")
        wait_cell(page, "r1c1", notes="2 4", label=label("r1c1", "empty, notes 2 4"))
        page.keyboard.press("Backspace")
        wait_cell(page, "r1c1", notes="", label=label("r1c1", "empty"))
        wait_said(page, "Row 1, column 1 erased.")
        page.keyboard.press("Control+z")
        wait_cell(page, "r1c1", notes="2 4")
        wait_said(page, "Undone.")
        page.keyboard.press("Control+y")
        wait_cell(page, "r1c1", notes="")
        wait_said(page, "Redone.")
        page.keyboard.press("Control+Shift+z")
        wait_said(page, "Nothing to redo.")
        page.keyboard.press("n")
        wait_for(page, lambda: notes.get_attribute("aria-pressed") == "false", "n turns notes mode off")
        wait_said(page, "Notes off.")
    wait_moves(app_url, p, gid, ["note", "note", "erase", "undo", "redo"], closed=True)


def test_wf_mistakes_second_chance_touch(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "mtouch")
    gid = seed_game(app_url, p, "easy-1", mistakes=2, notes=[{"cell": "r1c2", "digits": [5, 8]}])
    with visit(browser, app_url, f"/play/{gid}", p, viewport=(PHONE_WIDTH, PHONE_HEIGHT)) as page:
        wait_board(page)
        pad = page.get_by_role("group", name="Number pad", exact=True)
        tap(cell_loc(page, "r1c1"))
        tap(button(pad, "Digit 5"))
        over = dialog(page, "Game over", "alertdialog")
        wait_shown(page, over, "Game over")
        wait_cell(page, "r1c1", value="5", wrong="true", label=label("r1c1", "5, wrong"))
        assert cells(page)["r1c2"]["notes"] == "8"
        wait_said(page, f"Game over. {MISTAKE_LIMIT} mistakes.")
        expect(over).to_contain_text(f"You made {MISTAKE_LIMIT} mistakes.")
        wait_focused(page, button(over, "Second chance"), "Second chance")
        tap(button(over, "Second chance"))
        wait_for(page, lambda: not shown(over) and board_state(page) == "playing", "play resumes")
        wait_cell(page, "r1c1", value="", wrong="false", selected="true")
        assert cells(page)["r1c2"]["notes"] == "5 8"
        wait_text(page, "#mistakes", "Mistakes: 2/3")
        tap(button(pad, "Digit 6"))
        wait_cell(page, "r1c1", value="6", wrong="false", label=label("r1c1", "6"))
        wait_said(page, "Row 1, column 1, 6.")
        assert text_of(page, "#mistakes") == "Mistakes: 2/3"
        assert cells(page)["r1c2"]["notes"] == "5 8"
    wait_moves(app_url, p, gid, ["enter", "second_chance", "enter"], closed=True)


def test_wf_mistakes_second_chance_dialog_keys(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "mkeys")
    gid = seed_game(app_url, p, "hard-1", mistakes=2)
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("5")
        over = dialog(page, "Game over", "alertdialog")
        wait_shown(page, over, "Game over")
        for key in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"):
            page.keyboard.press(key)
            assert focus_inside(over), f"{key} left the Game over dialog"
        page.keyboard.press("2")
        page.keyboard.press("Escape")
        advance(page, STEP_MS)
        assert shown(over) and cells(page)["r1c1"]["value"] == "5"
        assert text_of(page, "#mistakes") == f"Mistakes: {MISTAKE_LIMIT}/{MISTAKE_LIMIT}"
        chance = button(over, "Second chance")
        for _ in range(4):
            if focused(chance):
                break
            page.keyboard.press("Tab")
        wait_focused(page, chance, "Second chance")
        page.keyboard.press("Enter")
        wait_for(page, lambda: not shown(over) and selected_cell(page) == "r1c1" and page.evaluate(FOCUS_ON_SELECTED_JS),
                 "focus back on r1c1")
        page.keyboard.press("2")
        wait_cell(page, "r1c1", value="2", wrong="false")
        wait_said(page, "Row 1, column 1, 2.")
    wait_moves(app_url, p, gid, ["enter", "second_chance", "enter"], closed=True)


def test_wf_hint_order_wrong_cell_touch(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "htouch")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p, viewport=(PHONE_WIDTH, PHONE_HEIGHT)) as page:
        wait_board(page)
        pad = page.get_by_role("group", name="Number pad", exact=True)
        three = button(pad, "Digit 3")
        assert three.get_attribute("data-remaining") == "7"
        tap(cell_loc(page, "r4c3"))
        tap(button(pad, "Digit 6"))
        wait_cell(page, "r4c3", value="6", wrong="true")
        wait_text(page, "#mistakes", "Mistakes: 1/3")
        tap(button(page, "Hint"))
        wait_cell(page, "r4c3", value="3", hinted="true", wrong="false", selected="true", label=label("r4c3", "3, hint"))
        wait_said(page, f"Hint: row 4, column 3 is 3. Hints left {HINT_LIMIT - 1}.")
        wait_text(page, "#hints-left", f"Hints left: {HINT_LIMIT - 1}")
        assert text_of(page, "#mistakes") == "Mistakes: 1/3"
        wait_for(page, lambda: three.get_attribute("data-remaining") == "6", "Digit 3 remaining 6 after the hint")
        tap(button(pad, "Digit 5"))
        wait_said(page, "Hinted cells can't be changed.")
        tap(button(page, "Erase"))
        wait_said(page, "Hinted cells can't be changed.", times=2)
        assert cells(page)["r4c3"]["value"] == "3"
    moves = wait_moves(app_url, p, gid, ["enter", "hint"], closed=True)
    assert (moves[1]["cell"], moves[1]["digit"]) == ("r4c3", 3)


def test_wf_hint_order_finishing_hint(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hfin")
    last = empties("hard-1")[-1]
    gid = seed_game(app_url, p, "hard-1", entries=fill_except("hard-1", {last}), hints=1, elapsed_ms=600000)
    with visit(browser, app_url, f"/play/{gid}", p, reduced_motion="reduce") as page:
        wait_board(page)
        wait_text(page, "#hints-left", f"Hints left: {HINT_LIMIT - 1}")
        tab_to_board(page)
        page.keyboard.press("H")
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "Puzzle solved after the finishing hint")
        res = get_game(app_url, p, gid)["result"]
        assert (res["hints"], res["mistakes"]) == (2, 0)
        assert res["score"] == score("hard", res["seconds"], 0, 2)
        expect(solved).to_contain_text(solved_text(res["seconds"], 0, 2, res["score"]))
        wait_said(page, f"Solved in {clock(res['seconds'])}. Score {res['score']}.")
        assert cells(page)[last]["hinted"] == "true"
    assert [m["op"] for m in get_game(app_url, p, gid)["moves"]] == ["hint"]


def test_wf_highlight_selection_wrap_keys(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hwrap")
    gid = seed_game(app_url, p, "easy-2")
    values = dict(givens("easy-2"))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)

        def check(sel: str) -> None:
            want = expected_highlights(sel, values)
            wait_for(page, lambda: selected_cell(page) == sel and {k: v["highlight"] for k, v in cells(page).items()} == want,
                     f"highlights around {sel}")

        check("r1c1")
        for key, sel in (("End", "r1c9"), ("ArrowRight", "r1c1"), ("ArrowUp", "r9c1"), ("End", "r9c9"),
                         ("ArrowDown", "r1c9"), ("Home", "r1c1"), ("ArrowRight", "r1c2"), ("ArrowRight", "r1c3")):
            page.keyboard.press(key)
            check(sel)
        same = sorted(k for k, v in cells(page).items() if "same-digit" in (v["highlight"] or "").split())
        assert same == sorted(k for k, d in values.items() if d == 4 and k != "r1c3")


def test_wf_highlight_selection_hint_and_redo(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hredo")
    gid = seed_game(app_url, p, "medium-1")
    values = dict(givens("medium-1"))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)

        def check(sel: str) -> None:
            want = expected_highlights(sel, values)
            wait_for(page, lambda: selected_cell(page) == sel and {k: v["highlight"] for k, v in cells(page).items()} == want,
                     f"highlights around {sel}")

        go(page, "r4c3")
        check("r4c3")
        page.keyboard.press("3")
        values["r4c3"] = 3
        check("r4c3")
        page.keyboard.press("Control+z")
        del values["r4c3"]
        check("r4c3")
        page.keyboard.press("Control+y")
        values["r4c3"] = 3
        check("r4c3")
        target, digit = hint_pick("medium-1", values)
        page.keyboard.press("h")
        values[target] = digit
        check(target)
    wait_moves(app_url, p, gid, ["enter", "undo", "redo", "hint"], closed=True)


def test_wf_highlight_selection_won(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hwon")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p, reduced_motion="reduce") as page:
        wait_board(page)
        click(cell_loc(page, "r9c9"))
        wait_cell(page, "r9c9", highlight="selected")
        page.keyboard.press("4")
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "Puzzle solved")
        wait_for(page, lambda: board_state(page) == "won" and all(v["highlight"] == "" for v in cells(page).values()),
                 "no highlight tokens on a won board")
        page.keyboard.press("Escape")
        wait_for(page, lambda: not shown(solved), "Escape closes Puzzle solved")
        assert board_state(page) == "won" and all(v["highlight"] == "" for v in cells(page).values())


def test_wf_clock_score_motion_reload_time(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "creload")
    gid = seed_game(app_url, p, "easy-3", elapsed_ms=120000)
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        wait_text(page, "#timer", "02:00")
        tab_to_board(page)
        advance(page, 5000)
        assert parse_clock(text_of(page, "#timer") or "0") >= parse_clock("02:00") + 5
        page.keyboard.press(str(solution("easy-3", "r1c4")))
        wait_cell(page, "r1c4", value="6")
        page.keyboard.press("p")
        wait_for(page, lambda: board_state(page) == "paused", "paused")
        wait_api(lambda: [m["op"] for m in get_game(app_url, p, gid)["moves"]] == ["enter", "pause"], "the pause is saved")
        game = get_game(app_url, p, gid)
        saved = max(game["elapsed_ms"], game["moves"][-1]["t"]) // 1000
        page.reload()
        wait_board(page)
        wait_for(page, lambda: board_state(page) == "playing" and not shown(dialog(page, "Paused")), "opens playing")
        shown_at = parse_clock(text_of(page, "#timer") or "0")
        assert saved <= shown_at <= saved + 1, (shown_at, saved)
        advance(page, 3000)
        assert parse_clock(text_of(page, "#timer") or "0") == shown_at + 3


def test_wf_phone_pad_notes_worked_example(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "pnote")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p, viewport=(375, 812)) as page:
        wait_board(page)
        layout(page)
        pad = page.get_by_role("group", name="Number pad", exact=True)
        notes, three = button(page, "Notes"), button(pad, "Digit 3")
        tap(notes)
        wait_for(page, lambda: notes.get_attribute("aria-pressed") == "true", "Notes pressed")
        for name, digits in (("r4c2", (3, 7)), ("r5c3", (3, 5)), ("r1c1", (3,))):
            tap(cell_loc(page, name))
            for dgt in digits:
                tap(button(pad, f"Digit {dgt}"))
            wait_cell(page, name, notes=" ".join(map(str, digits)))
        tap(notes)
        wait_for(page, lambda: notes.get_attribute("aria-pressed") == "false", "Notes released")
        tap(cell_loc(page, "r4c3"))
        tap(three)
        wait_cell(page, "r4c3", value="3", wrong="false")
        cs = cells(page)
        assert (cs["r4c2"]["notes"], cs["r5c3"]["notes"], cs["r1c1"]["notes"]) == ("7", "5", "3")
        wait_for(page, lambda: three.get_attribute("data-remaining") == "6", "Digit 3 remaining 6")
        tap(button(page, "Undo"))
        wait_cell(page, "r4c3", value="")
        cs = cells(page)
        assert (cs["r4c2"]["notes"], cs["r5c3"]["notes"]) == ("3 7", "3 5")
        wait_for(page, lambda: three.get_attribute("data-remaining") == "7", "Digit 3 remaining 7 after Undo")
        tap(button(page, "Redo"))
        wait_cell(page, "r4c3", value="3")
        cs = cells(page)
        assert (cs["r4c2"]["notes"], cs["r5c3"]["notes"]) == ("7", "5")
        layout(page)
    wait_moves(app_url, p, gid, ["note"] * 5 + ["enter", "undo", "redo"], closed=True)


def test_wf_daily_streak_two_players(browser: Browser, app_url: str) -> None:
    a, b = make_players(app_url, "dayA", "dayB")
    today = date(2026, 11, 3)
    with server_clock(app_url, "2026-11-03T12:00:00+13:00"):
        daily_result(app_url, b, "2026-11-01", "2026-11-01T12:00:00+13:00")
        daily_result(app_url, b, "2026-11-02", "2026-11-02T12:00:00+13:00")
        boards = {}
        with visit(browser, app_url, "/daily", a) as pa, visit(browser, app_url, "/daily", b) as pb:
            for page, streak, best in ((pa, "Current streak: 0 days", "Best streak: 0 days"),
                                       (pb, "Current streak: 2 days", "Best streak: 2 days")):
                wait_for(page, lambda: calendar(page).get("2026-11-03", {}).get("focused") is True, "today focused")
                wait_text(page, "#streak", streak)
                wait_text(page, "#best-streak", best)
            pa.keyboard.press("ArrowRight")
            wait_for(pa, lambda: calendar(pa)["2026-11-04"]["focused"] is True, "the future date takes focus")
            assert calendar(pa)["2026-11-04"]["label"] == f"{long_date(date(2026, 11, 4))}, {STATE_WORDS['future']}"
            pa.keyboard.press("Enter")
            advance(pa, STEP_MS)
            assert pa.url.endswith("/daily")
            pa.keyboard.press("ArrowLeft")
            for page in (pa, pb):
                wait_for(page, lambda: calendar(page)["2026-11-03"]["focused"] is True, "today focused")
                page.keyboard.press("Enter")
                wait_heading(page, f"Daily, {long_date(today)}")
                wait_board(page)
                boards[page] = {k: v["value"] for k, v in cells(page).items() if v["given"] == "true"}
            want = {k: str(v) for k, v in givens(daily_puzzle(today)).items()}
            assert boards[pa] == want and boards[pb] == want
    assert daily_puzzle(today) == "daily-6"


def test_wf_duel_rejoin_before_start(browser: Browser, app_url: str) -> None:
    with duel_pages(browser, app_url, "easy") as d:
        ready = button(d.pa, "Ready")
        wait_shown(d.pa, ready, "Ready")
        ready.focus()
        d.pa.keyboard.press("Space")
        wait_for(d.pa, lambda: ready.get_attribute("aria-pressed") == "true", "Ready pressed")
        d.pa.reload()
        ready = button(d.pa, "Ready")
        wait_shown(d.pa, ready, "Ready after reload")
        wait_for(d.pa, lambda: ready.get_attribute("aria-pressed") == "false", "Ready reset by the reload")
        seats = d.pa.get_by_role("list", name="Seats", exact=True)
        wait_for(d.pa, lambda: seats.count() == 1 and all(n in (seats.text_content() or "") for n in (d.a["display_name"], d.b["display_name"])),
                 "both seats kept")
        room = api(app_url, "GET", f"/api/duels/{d.code}", session=d.a["session"]).json()["room"]
        assert room["state"] == "seated" and [s["ready"] for s in room["seats"]] == [False, False]
        press_ready(d.pb)
        ready.focus()
        d.pa.keyboard.press("Space")
        wait_frame(d.pa, d.fa, "countdown", "the countdown after both are ready")
        wait_said(d.pa, "Starting in 3")
        wait_frame(d.pb, d.fb, "start", "start for the second duelist")
        wait_said(d.pb, "The duel has started.")


def test_wf_duel_rejoin_phone(browser: Browser, app_url: str) -> None:
    a, b = make_players(app_url, "dpA", "dpB")
    code = create_room(app_url, a, "medium")
    assert api(app_url, "POST", "/api/duels/join", {"code": code}, session=b["session"]).status_code == 200
    fa: list[dict[str, Any]] = []
    fb: list[dict[str, Any]] = []
    with visit(browser, app_url, f"/duel/{code}", a, viewport=(PHONE_WIDTH, PHONE_HEIGHT), hook=lambda pg: listen(pg, fa)) as pa, \
            visit(browser, app_url, f"/duel/{code}", b, hook=lambda pg: listen(pg, fb)) as pb:
        d = Duel(app_url, a, b, code, pa, pb, fa, fb)
        start_duel(d)
        layout(pa)
        assert button(pa, "Hint").count() == 0 and button(pa, "Pause").count() == 0
        pad = pa.get_by_role("group", name="Number pad", exact=True)
        for name, digit in (("r1c1", 2), ("r1c2", 4)):
            tap(cell_loc(pa, name))
            tap(button(pad, f"Digit {digit}"))
            wait_cell(pa, name, value=str(digit))
        own = pa.get_by_role("progressbar", name="Your progress", exact=True)
        wait_for(pa, lambda: own.get_attribute("aria-valuenow") == "2", "Your progress at 2")
        expect(own).to_contain_text(f"You: 2 of {MEDIUM3_EMPTY}")
        board = board_grid(pa).bounding_box()
        mine = own.bounding_box()
        assert board and mine and mine["y"] >= board["y"] + board["height"] - 1, "progress not under the board on a phone"
        bar = pb.get_by_role("progressbar", name=f"{a['display_name']}'s progress", exact=True)
        wait_for(pb, lambda: bar.count() == 1 and bar.get_attribute("aria-valuenow") == "2", "B sees A at 2")
        pa.reload()
        wait_board(pa)
        wait_cell(pa, "r1c1", value="2")
        wait_cell(pa, "r1c2", value="4")
        own = pa.get_by_role("progressbar", name="Your progress", exact=True)
        wait_for(pa, lambda: own.get_attribute("aria-valuenow") == "2", "Your progress at 2 after reload")
        wait_said(pb, f"{a['display_name']} is back.")


def test_wf_verified_results_profile_keys(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "pkeys")
    finished_game(app_url, p, "easy", "won", 100000, 0, 0, "2026-11-01T01:00:00Z")
    finished_game(app_url, p, "easy", "won", 200000, 1, 1, "2026-11-02T01:00:00Z")
    finished_game(app_url, p, "easy", "lost", 50000, 3, 0, "2026-11-03T01:00:00Z")
    finished_game(app_url, p, "hard", "won", 581000, 1, 2, "2026-11-04T01:00:00Z")
    want = {
        "Easy": {"Games started": "3", "Games won": "2", "Win rate": "67%", "Best time": "01:40",
                 "Average time": "02:30", "Best score": str(score("easy", 100, 0, 0))},
        "Medium": {"Games started": "0", "Games won": "0", "Win rate": "-", "Best time": "-", "Average time": "-",
                   "Best score": "-"},
        "Hard": {"Games started": "1", "Games won": "1", "Win rate": "100%", "Best time": "09:41",
                 "Average time": "09:41", "Best score": "3169"},
    }
    rows = [["2026-11-04", "Hard", "Won", "09:41", "3169"], ["2026-11-03", "Easy", "Lost", "00:50", "-"],
            ["2026-11-02", "Easy", "Won", "03:20", str(score("easy", 200, 1, 1))],
            ["2026-11-01", "Easy", "Won", "01:40", str(score("easy", 100, 0, 0))]]
    with visit(browser, app_url, "/profile", p) as page:
        for attempt in ("first", "reload"):
            wait_heading(page, "Profile")
            tabs = page.get_by_role("tablist", name="Levels", exact=True)
            wait_shown(page, tabs, "the Levels tablist")
            easy = tabs.get_by_role("tab", name="Easy", exact=True)
            click(easy)
            for key, name in ((None, "Easy"), ("ArrowRight", "Medium"), ("End", "Expert"), ("Home", "Easy"),
                              ("ArrowRight", "Medium"), ("ArrowRight", "Hard")):
                if key:
                    page.keyboard.press(key)
                tab = tabs.get_by_role("tab", name=name, exact=True)
                wait_for(page, lambda: tab.get_attribute("aria-selected") == "true" and focused(tab), f"{name} tab selected")
                order = tabs.get_by_role("tab").evaluate_all("ts => ts.map(t => [t.textContent.trim(), t.tabIndex])")
                assert [n for n, i in order if i >= 0] == [name], f"Tab order holds {order} ({attempt})"
                if name in want:
                    wait_for(page, lambda: panel_values(page) == want[name], f"{name} statistics ({attempt})")
            assert finished_rows(page) == rows, attempt
            if attempt == "first":
                page.reload()


def new_game_posts(page: Page) -> list[str]:
    sink: list[str] = []

    def on_request(req: Any) -> None:
        if req.method == "POST" and urlparse(req.url).path == "/api/games":
            sink.append(req.url)
    page.on("request", on_request)
    return sink


def announcer_now(page: Page) -> str | None:
    return text_of(page, "#announcer")


def press_new_game_twice(page: Page, new_game: Locator, posts: list[str], by_touch: bool) -> None:
    point = center(new_game) if by_touch else None
    with held(page, "**/api/games") as gate:
        if point is not None:
            page.touchscreen.tap(*point)
        else:
            page.keyboard.press("Enter")
        wait_for(page, lambda: len(posts) == 1 and new_game.get_attribute("aria-disabled") == "true",
                 "New game sends one request and has aria-disabled=true while it is in flight")
        if point is not None:
            page.touchscreen.tap(*point)
        else:
            page.keyboard.press("Enter")
        advance(page, 500)
        assert len(posts) == 1, "a second press of a pending New game sent another request"
        gate.release()


@pytest.mark.timeout(600)
def test_wf_keyboard_finish_new_game_pending(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "kng")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        posts = new_game_posts(page)
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("4")
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "the Puzzle solved dialog")
        new_game = button(solved, "New game")
        wait_focused(page, new_game, "New game")

        def fail(route: Any) -> None:
            route.fulfill(status=500, content_type="application/json",
                          body=json.dumps({"error": {"code": "INTERNAL", "message": "x"}}))
        page.route("**/api/games", fail)
        page.keyboard.press("Enter")
        wait_said(page, "Something went wrong at the atelier. Try again.")
        assert page.url.endswith(f"/play/{gid}")
        page.unroute("**/api/games", fail)
        posts.clear()
        wait_shown(page, new_game, "New game after the failed request")
        new_game.focus()
        press_new_game_twice(page, new_game, posts, by_touch=False)
        wait_for(page, lambda: re.search(r"/play/[^/]+$", page.url) is not None and not page.url.endswith(f"/play/{gid}"),
                 "New game opens a new /play/<id>")
        wait_board(page)
        new_id = page.url.rsplit("/", 1)[1]
    assert get_game(app_url, p, new_id)["puzzle_id"].startswith("easy-")
    assert get_profile(app_url, p)["levels"]["easy"]["started"] == 2


@pytest.mark.timeout(600)
def test_wf_mistakes_second_chance_new_game_pending(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "mng")
    gid = seed_game(app_url, p, "easy-1", mistakes=2, second_chance_used=True)
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        posts = new_game_posts(page)
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("5")
        over = dialog(page, "Game over", "alertdialog")
        wait_shown(page, over, "the final Game over")
        expect(over).to_contain_text(f"You made {MISTAKE_LIMIT} mistakes. Your second chance is used.")
        wait_said(page, f"Game over. {MISTAKE_LIMIT} mistakes.")
        new_game = button(over, "New game")
        wait_focused(page, new_game, "New game")
        press_new_game_twice(page, new_game, posts, by_touch=False)
        wait_for(page, lambda: not page.url.endswith(f"/play/{gid}"), "New game opens a new game")
        wait_board(page)
        assert board_state(page) == "playing"
    wait_api(lambda: get_game(app_url, p, gid)["status"] == "lost", "the first game is stored lost")
    assert get_profile(app_url, p)["levels"]["easy"]["started"] == 2


@pytest.mark.timeout(600)
def test_wf_phone_pad_new_game_pending(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "png")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p, viewport=(PHONE_WIDTH, PHONE_HEIGHT)) as page:
        posts = new_game_posts(page)
        wait_board(page)
        pad = page.get_by_role("group", name="Number pad", exact=True)
        tap(cell_loc(page, "r9c9"))
        tap(button(pad, "Digit 4"))
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "Puzzle solved")
        new_game = button(solved, "New game")
        press_new_game_twice(page, new_game, posts, by_touch=True)
        wait_for(page, lambda: not page.url.endswith(f"/play/{gid}"), "New game opens a new game")
        wait_board(page)
    assert get_game(app_url, p, gid)["status"] == "won"
    assert get_profile(app_url, p)["levels"]["easy"]["started"] == 2


def test_wf_notes_undo_repeat_then_new_sentence(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "nrep")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("Control+z")
        wait_said(page, "Nothing to undo.")
        page.keyboard.press("Control+z")
        page.keyboard.press("n")
        notes = button(page, "Notes")
        advance(page, 200)
        assert notes.get_attribute("aria-pressed") == "true"
        assert announcer_now(page) == "Notes on.", f"#announcer reads {announcer_now(page)!r} after N"
        advance(page, 200)
        assert announcer_now(page) == "Notes on." and said(page)[-1] == "Notes on."
        page.keyboard.press("4")
        wait_said(page, "Note 4 added to row 1, column 1.")
        assert announcer_now(page) == "Note 4 added to row 1, column 1."


def test_wf_hint_order_no_hints_left_then_notes(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "hrep")
    gid = seed_game(app_url, p, "medium-1")
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        wait_board(page)
        tab_to_board(page)
        for name in ("r4c3", "r6c2", "r5c3"):
            page.keyboard.press("h")
            wait_cell(page, name, hinted="true", selected="true")
        hint = button(page, "Hint")
        wait_for(page, lambda: is_disabled(hint), "Hint disabled with no hints left")
        page.keyboard.press("h")
        wait_said(page, "No hints left.")
        page.keyboard.press("h")
        page.keyboard.press("n")
        advance(page, 200)
        assert announcer_now(page) == "Notes on.", f"#announcer reads {announcer_now(page)!r} after N"
        advance(page, 200)
        assert announcer_now(page) == "Notes on." and said(page)[-1] == "Notes on."


@pytest.mark.timeout(600)
def test_wf_clock_score_motion_clock_after_refusal(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "cref")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        def tamper(route: Any) -> None:
            body = json.loads(route.request.post_data or "{}")
            body["moves"][-1]["t"] = -1
            route.continue_(post_data=json.dumps(body))
        page.route("**/api/games/*/finish", tamper)
        wait_board(page)
        tab_to_board(page)
        advance(page, 3000)
        page.keyboard.press("4")
        refused = dialog(page, "Not counted", "alertdialog")
        wait_shown(page, refused, "the Not counted alertdialog")
        button(refused, "Close").focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: not shown(refused) and page.evaluate(FOCUS_ON_SELECTED_JS), "Close returns focus to the board")
        assert board_state(page) == "playing"
        before = parse_clock(timer_of(page).text_content() or "")
        advance(page, 5000)
        after = parse_clock(timer_of(page).text_content() or "")
        assert before + 4 <= after <= before + 6, f"#timer went from {before} s to {after} s over 5 s of play"
    assert get_game(app_url, p, gid)["status"] == "playing"


@pytest.mark.timeout(600)
def test_wf_verified_results_honest_after_refusal(browser: Browser, app_url: str) -> None:
    p = make_player(app_url, "vref")
    gid = seed_game(app_url, p, "easy-1", entries=fill_except("easy-1", {"r9c9"}))
    with visit(browser, app_url, f"/play/{gid}", p) as page:
        seen = {"n": 0}

        def tamper_first(route: Any) -> None:
            seen["n"] += 1
            if seen["n"] > 1:
                route.continue_()
                return
            body = json.loads(route.request.post_data or "{}")
            body["moves"][-1]["t"] = -1
            route.continue_(post_data=json.dumps(body))
        page.route("**/api/games/*/finish", tamper_first)
        wait_board(page)
        tab_to_board(page)
        page.keyboard.press("4")
        refused = dialog(page, "Not counted", "alertdialog")
        wait_shown(page, refused, "Not counted")
        wait_api(lambda: any(m["op"] == "enter" and m.get("cell") == "r9c9" for m in get_game(app_url, p, gid)["moves"]),
                 "the stored log holds the last entry")
        first_t = max(m["t"] for m in get_game(app_url, p, gid)["moves"])
        button(refused, "Close").focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: not shown(refused) and page.evaluate(FOCUS_ON_SELECTED_JS), "Close returns focus to the board")
        advance(page, 10000)
        page.keyboard.press("Control+z")
        wait_cell(page, "r9c9", value="")
        page.keyboard.press("4")
        solved = dialog(page, "Puzzle solved")
        wait_shown(page, solved, "Puzzle solved after the honest finish")
    game = get_game(app_url, p, gid)
    assert game["status"] == "won"
    assert game["result"]["seconds"] >= first_t // 1000 + 10, (game["result"], first_t)
    prof = get_profile(app_url, p)
    assert prof["levels"]["easy"]["won"] == 1 and [g["id"] for g in prof["finished_games"]].count(gid) == 1


def test_wf_duel_play_move_sentences(browser: Browser, app_url: str) -> None:
    pid = "easy-3"
    with duel_pages(browser, app_url, "easy") as d:
        start_duel(d)
        pa = d.pa
        tab_to_board(pa)
        given = next(iter(givens(pid)))
        go(pa, given)
        pa.keyboard.press(str(wrong_digit(pid, given)))
        wait_said(pa, "Given cells can't be changed.")
        open_cells = empties(pid)
        right, wrong = open_cells[0], open_cells[1]
        go(pa, right)
        pa.keyboard.press(str(solution(pid, right)))
        r, c = rc(right)
        wait_frame(pa, d.fa, "you", "the server's answer to the correct entry", pred=lambda f: f["correct"] == 1)
        wait_said(pa, f"Row {r}, column {c}, {solution(pid, right)}.")
        go(pa, wrong)
        bad = wrong_digit(pid, wrong)
        pa.keyboard.press(str(bad))
        r, c = rc(wrong)
        wait_frame(pa, d.fa, "you", "the server's answer to the mistake", pred=lambda f: f["mistakes"] == 1)
        wait_said(pa, f"Row {r}, column {c}, {bad}, wrong. Mistakes 1 of {MISTAKE_LIMIT}.")


def test_wf_duel_rejoin_selection_after_reload(browser: Browser, app_url: str) -> None:
    pid = "easy-3"
    with duel_pages(browser, app_url, "easy") as d:
        start_duel(d)
        pa = d.pa
        first, second = empties(pid)[0], empties(pid)[1]
        assert selected_cell(pa) == first
        tab_to_board(pa)
        pa.keyboard.press(str(solution(pid, first)))
        wait_frame(pa, d.fa, "you", "A's saved entry", pred=lambda f: f["correct"] == 1)
        pa.reload()
        wait_board(pa)
        wait_cell(pa, first, value=str(solution(pid, first)))
        wait_for(pa, lambda: selected_cell(pa) == second, f"the selection is {second}, the first empty cell after the reload")
        cs = cells(pa)
        assert [k for k, v in cs.items() if v["tabindex"] == "0"] == [second]
        tab_to_board(pa)
        pa.keyboard.press(str(solution(pid, second)))
        wait_cell(pa, second, value=str(solution(pid, second)))


SOURCE_ROOT = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")
SKIP_DIRS = {"node_modules", "dist", "build", ".git", "coverage", "public", "out", "static", ".next", ".output"}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}


def source_files(*suffixes: str) -> list[Path]:
    out = []
    for path in SOURCE_ROOT.rglob("*"):
        if path.is_file() and not (set(path.relative_to(SOURCE_ROOT).parts[:-1]) & SKIP_DIRS) and path.suffix in suffixes:
            out.append(path)
    return out


def test_if_run_manifest() -> None:
    data = json.loads((SOURCE_ROOT / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (SOURCE_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == [], missing
    assert "Gloock" in notices and "Rethink Sans" in notices


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert bad == [], bad
    assert FONT_LICENCE.lower() in (SOURCE_ROOT / "THIRD_PARTY_NOTICES.md").read_text().lower()


def test_if_no_extra_datastore() -> None:
    embedded = {"sqlite3", "better-sqlite3", "sql.js", "@electric-sql/pglite", "lowdb", "nedb", "@seald-io/nedb",
                "level", "leveldown", "classic-level", "lmdb", "pouchdb", "node-json-db", "pg-mem"}
    assert [p.name for p in shipped_packages() if p.name in embedded or EMBEDDED_SQL.lower() in p.name.lower()] == []
    assert source_files(".sqlite", ".sqlite3", ".db") == []


def test_if_typescript_and_lockfile() -> None:
    tracked = subprocess.run(["git", "-C", str(SOURCE_ROOT), "ls-files"], capture_output=True, text=True)
    if tracked.returncode == 0 and tracked.stdout.strip():
        stray = [f for f in tracked.stdout.splitlines()
                 if Path(f).suffix in {".js", ".jsx", ".mjs", ".cjs"} and Path(f).parent != Path(".")
                 and not (set(Path(f).parts[:-1]) & SKIP_DIRS)]
    else:
        stray = [str(p) for p in source_files(".js", ".jsx", ".mjs", ".cjs") if p.parent != SOURCE_ROOT]
    assert stray == [], stray
    assert (SOURCE_ROOT / "package-lock.json").is_file()


def test_if_puzzle_fixtures() -> None:
    corpus = "\n".join(p.read_text(errors="ignore") for p in source_files(".ts", ".tsx", ".json", ".sql"))
    missing = [pid for pid, (puz, sol) in PUZZLES.items() if puz not in corpus or sol not in corpus]
    assert missing == [], missing


def test_if_compose_untouched(app_url: str, mail: Mailpit) -> None:
    name = ident("svc")
    email = f"{name.lower()}@example.test"
    r = api(app_url, "POST", "/api/auth/signup", {"email": email, "display_name": name, "password": PASSWORD})
    assert r.status_code == 201, r.text
    wait_mail(mail, email, "Confirm your email for Seam")
    if not TRAJECTORY.is_file():
        return
    data = json.loads(TRAJECTORY.read_text())
    hits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = node.get("name")
            args = node.get("input") if isinstance(node.get("input"), dict) else node.get("arguments")
            if isinstance(args, str):
                with contextlib.suppress(ValueError):
                    args = json.loads(args)
            if name in {"Write", "Edit", "MultiEdit", "NotebookEdit"} and isinstance(args, dict):
                target = str(args.get("file_path") or args.get("path") or "")
                if "compose" in target.lower():
                    hits.append(target)
            if isinstance(args, dict) and isinstance(args.get("command"), str):
                cmd = args["command"]
                for seg in re.split(r"&&|\|\||;|\n|\|", cmd):
                    if (re.search(r"sed\s+-i\b.*compose", seg) or re.search(r">\s*\S*compose", seg)
                            or re.search(r"tee\s+(-a\s+)?\S*compose", seg)
                            or re.search(r"\b(mv|cp)\s+\S+\s+\S*compose", seg)):
                        hits.append(seg.strip())
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    assert hits == [], hits
