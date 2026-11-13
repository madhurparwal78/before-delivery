from __future__ import annotations

import concurrent.futures as cf
import contextlib
import hashlib
import json
import os
import re
import atexit
import signal
import socket
import struct
import subprocess
import tempfile
import time
import unicodedata
import zlib
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Mailpit,
    addresses,
    advance,
    AXE,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    session,
    shipped_packages,
    state_styles,
    tab_order,
    text,
    unique,
    until,
)

QM = "HOST-4417"
MK = "MARK-2093"
TEAMS = list(range(1, 13))
RATE_TEAM = 12
KEEP_TEXT = "keep me here"
LATE_TEXT = "Too late"
SUNDIAL = "Sundial"
DRAFT_TEXT = "typed draft"
REASON_TEXT = "Spelt as on the card"
ACCEPTED_REASON = "Accepted spelling"
UNKNOWN_CODE = "CAP-77"
UNKNOWN_ROUND = 99
RULE_PROP = "-".join(("border", "top", "width"))
FILL_TEAMS = list(range(1, 12))
NIGHT = 4
ROUND_COUNT = 8
QUESTIONS = list(range(1, 9))
POLL_MS = 3000
MSG_MS = 6000
REDUCED_MS = 120
PANE_MS = 600
FRAME_MS = 16
AXE_POLLS = 625
ENTER_FRAMES = 3
PRESS_MS = 80
FLIP_MS = 360
SLIDE_MS = 420
STAGGER_MS = 70
CASCADE_MS = 1600
MIN_TARGET = 44
PANE_MIN_W = 480
CARD_W = 420
CARD_GAP = 16
BP = (600, 768, 1024)
SHEET_MAX = 5_000_000
DIM_MIN = 200
DIM_MAX = 4000
JSON_MAX = 16384
LIMIT_DEFAULT = 25
LIMIT_CAP = 100
SEARCH_CAP = 100
RATE = 6
WINDOW_S = 60
NAME_MAX = 40
ANSWER_MAX = 120
QUERY_MAX = 80
REASON_MAX = 280
KEY_MAX = 64
DEPTH_MAX = 4
SEARCH_BUDGET_S = 1.5
HEADING_RATIO = 1.333
BODY_PX = 18
RADIUS_PX = 12
INK_RULE_PX = 2
HOVER_RULE_PX = 3
GROUND = "rgb(243, 237, 226)"
INK = "rgb(31, 26, 23)"
ACCENT = "rgb(181, 70, 43)"
SECONDARY = "rgb(47, 93, 80)"
MUTED = "rgb(201, 185, 154)"
WHITE = "rgb(255, 255, 255)"
PNG_SIG = bytes([137, 80, 78, 71, 13, 10, 26, 10])
JPEG_SOI = bytes([255, 216, 255])
SOF_PROGRESSIVE = 194
HTTP_S = 30
REAL_S = 45
STEP_MS = 250
SHORT_WAIT_S = 120
RATE_WAIT_S = 90
OPEN_MARGIN_S = 75
LONG_ROUND_S = 3600
NET_SLACK_S = 0.5
MSG_TOL_MS = 100
TIMING_TOL_MS = 50
PX_TOL = 1
MAX_TABS = 400
SKEW_TIME = "2026-11-05T03:07:00Z"
STATUS = {"drafted": "Drafted", "open": "Open", "closed": "Closed", "marked": "Marked", "published": "Published"}
LANDING = {"quizmaster": "/quizmaster", "marker": "/marker", "captain": "/captain"}
HEADINGS = {"quizmaster": "Quizmaster's desk", "marker": "Marking", "captain": "Answer desk"}
ARCHIVE_COLUMNS = ["Round", "Question", "Team", "Answer", "Time sent", "Mark"]
SEED = {
    1: ("Tequila Mockingbird", "captain01@snug-league.test", 152),
    2: ("Les Quizérables", "captain02@snug-league.test", 149),
    3: ("Sherlock Ohms", "captain03@snug-league.test", 145),
    4: ("The Quizzly Bears", "captain04@snug-league.test", 145),
    5: ("The Mitochondriacs", "captain05@snug-league.test", 138),
    6: ("Universally Challenged", "captain06@snug-league.test", 132),
    7: ("Spelling Bees", "captain07@snug-league.test", 128),
    8: ("Norfolk Enchants", "captain08@snug-league.test", 123),
    9: ("Half Past Pints", "captain09@snug-league.test", 119),
    10: ("The Lemon Tops", "captain10@snug-league.test", 115),
    11: ("Dot's Lot", "captain11@snug-league.test", 108),
    12: ("Bad Losers", "captain12@snug-league.test", 94),
}
ROUNDS = {
    1: ("General Knowledge", "standard"),
    2: ("History", "standard"),
    3: ("Picture Round: Doorways", "picture"),
    4: ("Music", "standard"),
    5: ("Science and Nature", "standard"),
    6: ("Picture Round: Shop Fronts", "picture"),
    7: ("Sport", "standard"),
    8: ("Final Round: Local Knowledge", "standard"),
}
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
COUNT_EXAMPLES = [("e\u0301", 1), ("\U0001F37A", 1), ("\U0001F1EC\U0001F1E7", 2),
                  ("\U0001F468\u200d\U0001F469\u200d\U0001F467", 5), ("q\u0307", 2), ("  bjork  ", 5)]
FAMILY = "\U0001F468\u200d\U0001F469\u200d\U0001F467"

SIGNED_OUT = "Your desk session has ended. Sign in again."
BAD_CODE = "That code does not open a desk."
ANSWER_OVER = "Answers can be up to 120 characters."
NAME_OVER = "Team names can be up to 40 characters."
NAME_SAVED = "Team name saved."
NAME_TAKEN = "Another team already has that name."
NO_FILE = "Choose a sheet image to upload."
OUTAGE = "Sheet not stored — storage is unreachable. This round cannot open yet."
NO_MATCH = 'No answers match "{q}".'
EMPTY_SEARCH = "Type something to search for."
QUERY_OVER = "Searches can be up to 80 characters."
DISPUTE_SENT = "Dispute sent to the quizmaster."
REASON_EMPTY = "Say what was wrong with the mark."
RULING_SAVED = "Ruling saved. The captain's note is on its way."
ALREADY_RULED = "This dispute was already ruled."
ANOTHER_OPEN = "Close the open round before opening another."
NO_NEWER = "No newer answers yet."
NOT_FOUND = "No such page in the quiz book."


def closed_copy(n: int) -> str: return f"Round {n} is closed. Answers are no longer taken."
def ruled_copy(r: str, n: int, q: int) -> str: return f"Dispute ruled: {r} for round {n}, question {q}."
def news_copy(n: int, name: str, total: int) -> str: return f"Round {n} published. Leader: {name} on {total} points."


_DESKS: dict[tuple[str, str], httpx.Client] = {}


def cap(team: int) -> str:
    return f"CAP-{team:02d}"


def role_of(code: str) -> str:
    return "quizmaster" if code == QM else "marker" if code == MK else "captain"


def client(base: str, code: str | None = None) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=HTTP_S)
    if code:
        r = c.post("/api/session", json={"code": code})
        assert r.status_code == 201, f"POST /api/session {code} expected 201, got {r.status_code} {r.text[:200]}"
    return c


def desk(base: str, code: str) -> httpx.Client:
    if (base, code) not in _DESKS:
        _DESKS[(base, code)] = client(base, code)
    return _DESKS[(base, code)]


def err(r: httpx.Response, status: int, code: str | None = None, **extra: Any) -> dict:
    assert r.status_code == status, (
        f"{r.request.method} {r.request.url.path}: expected {status} {code or ''}, got {r.status_code} {r.text[:300]}")
    body = r.json() if r.content else {}
    if code:
        assert body.get("error") == code, f"{r.request.url.path}: expected error {code!r}, got {body}"
    for k, v in extra.items():
        assert body.get(k) == v, f"{r.request.url.path}: expected {k}={v!r}, got {body}"
    return body


def fields(r: httpx.Response, status: int = 422) -> dict:
    body = err(r, status, "invalid")
    return body["fields"]


def env_url(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} is not set; the outage instance is part of the spec"
    return url.rstrip("/")


def rounds(base: str) -> list[dict]:
    return httpx.get(base + "/api/rounds", timeout=HTTP_S).json()["rounds"]


def round_of(base: str, n: int) -> dict:
    return httpx.get(f"{base}/api/rounds/{n}", timeout=HTTP_S).json()["round"]


def table(base: str) -> dict:
    return httpx.get(base + "/api/table", timeout=HTTP_S).json()


def team_name(base: str, team: int) -> str:
    return next(t["name"] for t in table(base)["teams"] if t["team_id"] == team)


def answers_of(base: str, n: int, code: str = MK) -> list[dict]:
    r = desk(base, code).get(f"/api/rounds/{n}/answers")
    assert r.status_code == 200, r.text
    return r.json()["answers"]


def archive_all(base: str, round_n: int | None = None) -> list[dict]:
    out: list[dict] = []
    cursor = None
    for _ in range(2000):
        params: dict[str, Any] = {"limit": LIMIT_CAP}
        if cursor:
            params["cursor"] = cursor
        if round_n:
            params["round"] = round_n
        page = desk(base, MK).get("/api/answers", params=params).json()
        if not page["answers"]:
            return out
        out += page["answers"]
        cursor = page["next_cursor"]
    pytest.fail("GET /api/answers never returned an empty page; expected paging to end")


def pace(base: str, seconds: float) -> None:
    end = time.monotonic() + seconds
    for _ in range(100000):
        if time.monotonic() >= end:
            return
        httpx.get(base + "/api/health", timeout=HTTP_S)


def submit(base: str, team: int, n: int, answers: dict[int, str], key: str | None = None) -> httpx.Response:
    body = {"answers": [{"question": q, "text": t} for q, t in answers.items()]}
    deadline = time.monotonic() + RATE_WAIT_S
    while time.monotonic() < deadline:
        r = desk(base, cap(team)).post(f"/api/rounds/{n}/answers", json=body,
                                       headers={"Idempotency-Key": key or idempotency_key()})
        if r.status_code != 429:
            return r
        pace(base, int(r.json()["retry_after"]))
    pytest.fail(f"team {team} stayed rate limited past {RATE_WAIT_S}s; expected the rolling window to free up")


class RetryClient:

    def __init__(self, base: str, team: int) -> None:
        self.base, self.c = base, desk(base, cap(team))

    def post(self, url: str, **kw: Any) -> httpx.Response:
        deadline = time.monotonic() + RATE_WAIT_S
        while time.monotonic() < deadline:
            r = self.c.post(url, **kw)
            if r.status_code != 429:
                return r
            pace(self.base, int(r.json()["retry_after"]))
        pytest.fail(f"stayed rate limited past {RATE_WAIT_S}s; expected the rolling window to free up")


def close(base: str, n: int) -> None:
    if round_of(base, n)["status"] == "open":
        r = desk(base, QM).post(f"/api/rounds/{n}/close")
        assert r.status_code in (200, 409), r.text


def wait_no_open(base: str) -> None:
    for r in rounds(base):
        if r["status"] == "open":
            close(base, r["number"])


_LONG: dict[str, str] = {}


def long_base(base: str) -> str:
    if base in _LONG:
        return _LONG[base]
    env = dict(os.environ, ROUND_SECONDS=str(LONG_ROUND_S))
    if base == os.environ.get("APP_ROUND_SHORT_URL", "").rstrip("/"):
        env["DATABASE_URL"] = os.environ["DATABASE_URL"] + "_round_short"
        env["S3_BUCKET"] = os.environ["S3_BUCKET"] + "-round-short"
    elif base == os.environ.get("APP_MAILPIT_DOWN_URL", "").rstrip("/"):
        env["DATABASE_URL"] = os.environ["DATABASE_URL"] + "_mailpit_down"
        env["SMTP_HOST"], env["SMTP_PORT"] = "127.0.0.1", "9"
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    env["APP_PUBLIC_PORT"] = str(port)
    serve = json.loads((DEPLOYED_APP / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile(delete=False, suffix=".log")
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    atexit.register(lambda: os.killpg(proc.pid, signal.SIGTERM) if proc.poll() is None else None)
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            if httpx.get(url + "/api/health", timeout=1).status_code == 200:
                _LONG[base] = url
                return url
        except httpx.HTTPError:
            pass
        try:
            proc.wait(timeout=0.5)
            break
        except subprocess.TimeoutExpired:
            continue
    tail = Path(log.name).read_text()[-1500:]
    pytest.fail(f"long-allowance copy of the app did not become healthy: {tail}")


def open_next(base: str, kind: str = "standard", ttl: bool = False) -> int:
    wait_no_open(base)
    src = base if ttl else long_base(base)
    for r in rounds(base):
        if r["status"] == "drafted" and r["kind"] == kind:
            res = desk(src, QM).post(f"/api/rounds/{r['number']}/open")
            assert res.status_code == 200, f"open round {r['number']}: {res.status_code} {res.text}"
            return r["number"]
    if kind == "standard":
        for r in rounds(base):
            if r["status"] == "drafted" and r["kind"] == "picture":
                n = r["number"]
                if r["sheet"]["status"] != "stored":
                    assert put_sheet(base, n, png(unique("pic")[0])).status_code == 201
                res = desk(src, QM).post(f"/api/rounds/{n}/open")
                assert res.status_code == 200, f"open round {n}: {res.status_code} {res.text}"
                return n
    pytest.fail(f"no drafted {kind} round left on {base}; the night has {ROUND_COUNT} rounds (L823)")


def open_round(base: str) -> int:
    for r in rounds(base):
        if r["status"] == "open" and (r["seconds_left"] or 0) > OPEN_MARGIN_S:
            return r["number"]
    return open_next(base)


def fill(base: str, n: int, tag: str | None = None) -> str:
    tag = tag or unique("fill")[0]
    for team in FILL_TEAMS:
        first = submit(base, team, n, {1: f"draft {tag} t{team}"})
        assert first.status_code == 201, first.text
        r = submit(base, team, n, {q: f"{tag} t{team} q{q}" for q in QUESTIONS})
        assert r.status_code == 201, f"fill round {n} team {team}: {r.status_code} {r.text}"
    return tag


def policy(question: int) -> int:
    return 0 if question <= 4 else 1


def closed_round(base: str, team: int | None = None, unmarked: int = 0) -> int:
    for r in rounds(base):
        if r["status"] != "closed":
            continue
        rows = answers_of(base, r["number"])
        if not rows or (team and not any(a["team_id"] == team for a in rows)):
            continue
        if sum(a["mark"] is None for a in rows) < unmarked:
            continue
        return r["number"]
    n = open_next(base)
    fill(base, n)
    close(base, n)
    return n


def mark_all(base: str, n: int) -> None:
    for a in answers_of(base, n):
        if a["mark"] is None:
            r = desk(base, MK).put(f"/api/rounds/{n}/marks", json={"answer_id": a["id"], "points": policy(a["question"])})
            assert r.status_code == 200, r.text


def free_zero(base: str, n: int, team: int) -> list[dict]:
    disputed = {d["answer_id"] for d in desk(base, cap(team)).get("/api/disputes").json()["disputes"]}
    return [a for a in answers_of(base, n, cap(team))
            if a["current"] and a["mark"] == 0 and a["id"] not in disputed]


def marked_round(base: str, team: int, zero: int = 1) -> int:
    for r in rounds(base):
        if r["status"] == "marked" and len(free_zero(base, r["number"], team)) >= zero:
            return r["number"]
    n = closed_round(base, team=team)
    mark_all(base, n)
    r = desk(base, MK).post(f"/api/rounds/{n}/marked")
    assert r.status_code == 200, r.text
    assert len(free_zero(base, n, team)) >= zero, f"round {n} lacks {zero} zero-marked answers for team {team}"
    return n


def raise_dispute(base: str, team: int, answer_id: int, reason: str = "Spelt right") -> dict:
    r = desk(base, cap(team)).post("/api/disputes", json={"answer_id": answer_id, "reason": reason})
    assert r.status_code == 201, r.text
    return r.json()["dispute"]


def clear_raised(base: str, n: int) -> None:
    for d in desk(base, QM).get("/api/disputes").json()["disputes"]:
        if d["status"] == "raised" and d["round"] == n:
            desk(base, QM).post(f"/api/disputes/{d['id']}/ruling", json={"ruling": "dismissed"})


def dispute_by_id(base: str, did: int) -> dict:
    return next(d for d in desk(base, QM).get("/api/disputes").json()["disputes"] if d["id"] == did)


def drafted_picture(base: str, not_stored: bool = False) -> int:
    for r in rounds(base):
        if r["kind"] == "picture" and r["status"] == "drafted" and (not not_stored or r["sheet"]["status"] == "not_stored"):
            return r["number"]
    pytest.fail("no drafted picture round left (rounds 3 and 6, L829 L832)")


def put_sheet(base: str, n: int, body: bytes, ctype: str = "image/png", code: str = QM) -> httpx.Response:
    return desk(base, code).put(f"/api/rounds/{n}/sheet", content=body, headers={"Content-Type": ctype})


def png(tag: str = "", w: int = DIM_MIN, h: int = DIM_MIN, pad_to: int = 0) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    head = PNG_SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
    mid = chunk(b"tEXt", b"Comment\x00" + tag.encode()) + chunk(
        b"IDAT", zlib.compress(b"".join(b"\x00" + bytes(w) for _ in range(h))))
    tail = chunk(b"IEND", b"")
    if pad_to:
        mid += chunk(b"ruNd", bytes(pad_to - len(head) - len(mid) - len(tail) - 12))
    return head + mid + tail


def jpeg(tag: str, w: int = DIM_MIN, h: int = DIM_MIN, sof: int = 192) -> bytes:
    app = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + tag.encode()
    sof_data = struct.pack(">BHHB", 8, h, w, 1) + b"\x01\x11\x00"
    return (b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", len(app) + 2) + app
            + bytes([255, sof]) + struct.pack(">H", len(sof_data) + 2) + sof_data + b"\xff\xd9")


def sheet_key(n: int, body: bytes, ext: str) -> str:
    return f"sheets/night-{NIGHT}/round-{n}/{hashlib.sha256(body).hexdigest()}.{ext}"


def cp(s: str) -> int:
    return len(unicodedata.normalize("NFC", s).strip())


def race(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    with cf.ThreadPoolExecutor(len(calls)) as ex:
        return list(ex.map(lambda f: f(), calls))


@contextlib.contextmanager
def signed(browser: Browser, base: str, code: str, path: str | None = None,
           size: tuple[int, int] | None = None, skew: bool = False, **opts: Any) -> Iterator[Page]:
    with open_app(browser, base + "/sign-in", **opts) as page:
        if size:
            page.set_viewport_size({"width": size[0], "height": size[1]})
        if skew:
            page.clock.set_system_time(SKEW_TIME)
        box = page.get_by_role("textbox", name="Desk code")
        box.fill(code)
        box.press("Enter")
        land = LANDING[role_of(code)]
        until(page, "(p) => location.pathname === p", land)
        if path and path != land:
            page.goto(base + path)
        yield page


@contextlib.contextmanager
def public(browser: Browser, base: str, path: str = "/", size: tuple[int, int] | None = None,
           skew: bool = False, **opts: Any) -> Iterator[Page]:
    with open_app(browser, base + path, **opts) as page:
        if size:
            page.set_viewport_size({"width": size[0], "height": size[1]})
        if skew:
            page.clock.set_system_time(SKEW_TIME)
            page.reload()
        yield page


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def msgs(page: Page) -> Locator:
    return page.get_by_role("status", name="Desk messages")


def news(page: Page) -> Locator:
    return page.get_by_role("status", name="Table news")


def chips(page: Page) -> Locator:
    return page.get_by_role("list", name="Rounds tonight").get_by_role("listitem")


def tiles(page: Page) -> Locator:
    return page.get_by_role("list", name="League table").get_by_role("article")


def tile(page: Page, name: str) -> Locator:
    return page.get_by_role("list", name="League table").get_by_role("article", name=name, exact=True)


def focused(loc: Locator) -> bool:
    return bool(loc.count()) and loc.first.evaluate("e => e === document.activeElement")


def holds_focus(loc: Locator) -> bool:
    return bool(loc.count()) and loc.first.evaluate("e => e.contains(document.activeElement)")


def safe(check: Callable[[], bool]) -> Callable[[], bool]:
    def run() -> bool:
        try:
            return bool(check())
        except Exception:
            return False
    return run


def eventually(pages: Page | list[Page], check: Callable[[], bool], what: str,
               within_ms: float = POLL_MS + STEP_MS, real_s: float = REAL_S) -> None:
    group = pages if isinstance(pages, list) else [pages]
    spent, deadline, probe = 0.0, time.monotonic() + real_s, safe(check)
    while time.monotonic() < deadline:
        if probe():
            return
        step = STEP_MS if spent < within_ms else 1
        for p in group:
            advance(p, step)
        spent += step
    pytest.fail(f"{what}: not seen within {within_ms:.0f} ms of page time")


def tab_to(page: Page, loc: Locator) -> None:
    for _ in range(MAX_TABS):
        if focused(loc):
            return
        page.keyboard.press("Tab")
    pytest.fail("control not reachable by Tab; expected every journey action to be keyboard-reachable (L434)")


def probe_el(loc: Locator) -> None:
    loc.evaluate("e => { e.__rkProbe = 1; }")


def kept(loc: Locator) -> bool:
    return loc.evaluate("e => e.__rkProbe === 1 && e.isConnected")


def box(loc: Locator) -> dict:
    b = loc.bounding_box()
    assert b, "element has no box; expected it rendered"
    return b


def timer_seconds(page: Page) -> int:
    m = re.search(r"(\d+):(\d\d) left", page.get_by_role("timer", name="Time left").inner_text())
    assert m, "timer does not read <m>:<ss> left (L396)"
    return int(m.group(1)) * 60 + int(m.group(2))


def chip_ok(page: Page, base: str) -> bool:
    texts = chips(page).all_inner_texts()
    want = [f"Round {r['number']} · {STATUS[r['status']]}" for r in rounds(base)]
    return len(texts) == ROUND_COUNT and all(w in t for w, t in zip(want, texts))


def form(page: Page, n: int) -> Locator:
    return page.get_by_role("form", name=f"Round {n} answers")


def field(page: Page, q: int) -> Locator:
    return page.get_by_role("textbox", name=f"Question {q}", exact=True)


SEEK_JS = """([el, f]) => { const all = document.getAnimations();
  for (const a of all) { const d = Number(a.effect.getComputedTiming().duration) || 0; a.pause(); a.currentTime = d * f; }
  const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height, all.length]; }"""
FINISH_JS = "() => document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} })"
DURATIONS_JS = "() => document.getAnimations().map(a => Number(a.effect.getComputedTiming().duration) || 0)"
MOVES_JS = """() => document.getAnimations().some(a => a.effect.getKeyframes().some(k =>
  ['transform','translate','rotate','scale','top','left','right','bottom','width','height','margin'].some(p => k[p] && k[p] !== 'none')))"""
LOOPS_JS = "() => document.getAnimations().some(a => !isFinite(a.effect.getComputedTiming().iterations))"
TRANSFORMS_JS = """(root) => [root, ...root.getElementsByTagName('*')].map(e => getComputedStyle(e).transform)
  .filter(t => t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)')"""
ANCESTRY_JS = """(el) => { const out = []; for (let e = el; e && e !== document.body; e = e.parentElement) {
  const r = e.getBoundingClientRect(); out.push([r.left, r.top, r.width, r.height]); } return out; }"""
CARD_JS = """([el, button]) => { for (let e = el.parentElement; e; e = e.parentElement) { const s = getComputedStyle(e);
  if (parseFloat(s.borderTopWidth) === 2 && parseFloat(s.borderTopLeftRadius) === 12 && e.contains(button)) {
    const r = e.getBoundingClientRect(); return [r.left, r.right]; } }
  return null; }"""


OWN_ANIM_JS = """(el) => { for (let e = el; e; e = e.parentElement) if (e.getAnimations().length) return true;
  return el.getAnimations({subtree: true}).length > 0; }"""


def settle_pane(page: Page) -> None:
    advance(page, PANE_MS)
    page.evaluate(FINISH_JS)


def enter_path(page: Page, loc: Locator, total_ms: float) -> tuple[list[list[float]], float]:
    running = loc.evaluate(OWN_ANIM_JS)
    before = None if running else loc.evaluate("e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
    for _ in range(ENTER_FRAMES):
        advance(page, FRAME_MS)
    rects, longest = path(page, loc, total_ms)
    return ([before, *rects] if before else rects), longest


def path(page: Page, loc: Locator, total_ms: float, points: int = 5) -> tuple[list[list[float]], float]:
    handle = loc.element_handle()
    anim = page.evaluate(DURATIONS_JS)
    longest = max(anim) if anim else 0.0
    out = []
    for i in range(points):
        f = i / (points - 1)
        if not anim and i:
            advance(page, total_ms / (points - 1))
        out.append(page.evaluate(SEEK_JS, [handle, f])[:4])
    page.evaluate(FINISH_JS)
    return out, longest


def still(rects: list[list[float]]) -> bool:
    return all(abs(a - b) <= 0.5 for r in rects for a, b in zip(r, rects[0]))


def touch_at(page: Page, x: float, y: float) -> None:
    cdp = session(page)
    pts = [{"x": x, "y": y, "id": 1}]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def tap_el(page: Page, loc: Locator) -> None:
    loc.scroll_into_view_if_needed()
    b = box(loc)
    touch_at(page, b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)


def rows_of(tbl: Locator) -> Locator:
    return tbl.get_by_role("row").filter(has_not=tbl.page.get_by_role("columnheader"))


def shown_text(loc: Locator) -> str:
    return loc.evaluate(r"""r => { const out = [];
        const gen = (e, p) => { const c = getComputedStyle(e, p).content; if (!c || c === 'none' || c === 'normal') return;
          out.push(c.replace(/attr\(([^)]+)\)/g, (_, a) => e.getAttribute(a.trim()) || '').replace(/["']/g, '')); };
        const w = e => { gen(e, '::before');
          for (const n of e.childNodes) { if (n.nodeType === 3) out.push(n.textContent); else if (n.nodeType === 1) w(n); }
          gen(e, '::after'); };
        w(r); return out.join(' '); }""")


def test_session_codes(app_url: str) -> None:
    names = {t["team_id"]: t["name"] for t in table(app_url)["teams"]}
    for code, role, team in [(QM, "quizmaster", None), (MK, "marker", None)] + [(cap(i), "captain", i) for i in TEAMS]:
        c = client(app_url)
        r = c.post("/api/session", json={"code": code, "next": "/archive"})
        assert r.status_code == 201, f"{code}: {r.text}"
        b = r.json()
        assert (b["role"], b["team_id"], b["team_name"]) == (role, team, names.get(team) if team else None)
        assert c.get("/api/session").json() == b
        assert c.delete("/api/session").status_code == 204
        err(c.get("/api/session"), 401, "signed_out")
    err(client(app_url).post("/api/session", json={"code": "CAP-99"}), 401, "bad_code")
    assert fields(client(app_url).post("/api/session", json={"code": "   "})) == {"code": "required"}
    assert fields(client(app_url).post("/api/session", json={})) == {"code": "required"}
    assert fields(client(app_url).post("/api/session", json={"code": 7})) == {"code": "invalid"}


def test_role_permissions(app_url: str) -> None:
    c1, mk, qm = desk(app_url, cap(1)), desk(app_url, MK), desk(app_url, QM)
    sent = submit(app_url, 1, open_round(app_url), {1: unique("perm")[0]})
    assert sent.status_code == 201, sent.text
    answer_id = sent.json()["accepted"][0]["id"]
    before_names, before = team_name(app_url, 2), [r["status"] for r in rounds(app_url)]
    calls = [
        lambda: c1.post("/api/rounds/1/open"), lambda: mk.post("/api/rounds/1/close"),
        lambda: c1.post("/api/rounds/1/publish"), lambda: c1.post("/api/rounds/1/marked"),
        lambda: qm.post("/api/rounds/1/answers", json={"answers": [{"question": 1, "text": "x"}]}),
        lambda: mk.post("/api/rounds/1/answers", json={"answers": [{"question": 1, "text": "x"}]}),
        lambda: c1.get("/api/answers"), lambda: c1.post("/api/answers/search", json={"query": "x"}),
        lambda: mk.get("/api/disputes"),
        lambda: c1.patch("/api/teams/2", json={"name": unique("nope")[0]}),
        lambda: qm.patch("/api/teams/2", json={"name": unique("nope")[0]}),
        lambda: mk.put("/api/rounds/3/sheet", content=png("x"), headers={"Content-Type": "image/png"}),
        lambda: qm.post("/api/disputes", json={"answer_id": answer_id, "reason": "x"}),
    ]
    for call in calls:
        err(call(), 403, "forbidden")
    assert team_name(app_url, 2) == before_names
    assert [r["status"] for r in rounds(app_url)] == before


def test_signed_out_desks(app_url: str, browser: Browser) -> None:
    anon = client(app_url)
    for method, url, body in [("GET", "/api/session", None), ("DELETE", "/api/session", None),
                              ("POST", "/api/rounds/1/open", None), ("GET", "/api/answers", None),
                              ("GET", "/api/disputes", None), ("POST", "/api/disputes", {"answer_id": 1, "reason": "x"}),
                              ("PATCH", "/api/teams/1", {"name": "x"}), ("GET", "/api/rounds/1/answers", None)]:
        err(anon.request(method, url, json=body), 401, "signed_out")
    with signed(browser, app_url, cap(2)) as page:
        page.context.clear_cookies()
        eventually(page, lambda: page.evaluate("() => location.pathname") == "/sign-in"
                   and SIGNED_OUT in msgs(page).inner_text(), "desk returns to /sign-in with the signed-out copy")


def test_sign_in_landing(app_url: str, browser: Browser) -> None:
    with public(browser, app_url, "/archive") as page:
        until(page, "() => location.pathname === '/sign-in'")
        assert page.url == app_url + "/sign-in"
    for code in (QM, MK, cap(4)):
        with public(browser, app_url, "/sign-in?next=/archive&return_to=https://evil.example/&redirect=/marker") as page:
            page.get_by_role("textbox", name="Desk code").fill(code)
            page.get_by_role("textbox", name="Desk code").press("Enter")
            role = role_of(code)
            until(page, "(p) => location.pathname === p", LANDING[role])
            assert page.url == app_url + LANDING[role]
            h1 = page.get_by_role("heading", level=1, name=HEADINGS[role])
            expect(h1).to_be_focused()
            assert page.evaluate("() => scrollY") == 0
            other = "/marker" if role != "marker" else "/quizmaster"
            page.goto(app_url + other)
            until(page, "(p) => location.pathname === p", LANDING[role])
            page.goto(app_url + "/sign-in")
            until(page, "(p) => location.pathname === p", LANDING[role])


@pytest.mark.parametrize("width", [599, 600], ids=["599", "600"])
def test_sign_in_card_and_signed_out_copy(app_url: str, browser: Browser, width: int) -> None:
    with signed(browser, app_url, cap(3), size=(width, 800)) as page:
        page.context.clear_cookies()
        eventually(page, lambda: SIGNED_OUT in msgs(page).inner_text(), "signed-out copy on /sign-in")
        code = page.get_by_role("textbox", name="Desk code")
        edges = page.evaluate(CARD_JS, [code.element_handle(), page.get_by_role("button", name="Sign in").element_handle()])
        assert edges, "sign-in card: no ancestor with the 2 px ink rule and 12 px corners (L311)"
        if width < BP[0]:
            assert abs(edges[0] - CARD_GAP) <= PX_TOL and abs(edges[1] - (width - CARD_GAP)) <= PX_TOL
        else:
            assert abs(edges[1] - edges[0] - CARD_W) <= PX_TOL and abs(edges[0] - (width - edges[1])) <= PX_TOL
        code.click()
        page.keyboard.type("CAP-0")
        code.evaluate("e => e.setSelectionRange(2, 2)")
        advance(page, MSG_MS + MSG_TOL_MS)
        assert SIGNED_OUT not in msgs(page).inner_text()
        assert code.input_value() == "CAP-0" and focused(code)
        assert code.evaluate("e => [e.selectionStart, e.selectionEnd]") == [2, 2]


@pytest.mark.parametrize("size", [(320, 568), (375, 812)], ids=["320x568", "375x812"])
def test_touch_sign_in_small_phone(app_url: str, browser: Browser, size: tuple[int, int]) -> None:
    with public(browser, app_url, "/sign-in", size=size) as page:
        code, go = page.get_by_role("textbox", name="Desk code"), page.get_by_role("button", name="Sign in")
        for loc in (code, go):
            b = box(loc)
            assert b["width"] >= MIN_TARGET and b["height"] >= MIN_TARGET
        layout(page)
        tap_el(page, code)
        expect(code).to_be_focused()
        page.keyboard.type(cap(5))
        tap_el(page, go)
        until(page, "() => location.pathname === '/captain'")
        layout(page)
        for i in range(ROUND_COUNT):
            chip = chips(page).nth(i)
            chip.evaluate("e => e.scrollIntoView({block: 'nearest', inline: 'nearest'})")
            b = box(chip)
            assert page.evaluate("() => scrollX") == 0, "page scrolled sideways to show a chip"
            assert b["x"] >= -PX_TOL and b["x"] + b["width"] <= size[0] + PX_TOL


def test_wf_desk_sign_in_keyboard(app_url: str, browser: Browser) -> None:
    for code in (QM, MK, cap(6)):
        with public(browser, app_url, "/sign-in", skew=True) as page:
            code_box = page.get_by_role("textbox", name="Desk code")
            expect(code_box).to_be_focused()
            page.keyboard.type(code)
            page.keyboard.press("Enter")
            role = role_of(code)
            until(page, "(p) => location.pathname === p", LANDING[role])
            expect(page.get_by_role("heading", level=1, name=HEADINGS[role])).to_be_focused()
            eventually(page, lambda: chip_ok(page, app_url), "round strip equals GET /api/rounds")
            who = page.request.get(app_url + "/api/session").json()
            assert who["role"] == role


def test_wf_desk_sign_in_bad_code(app_url: str, browser: Browser) -> None:
    with public(browser, app_url, "/sign-in") as page:
        code_box = page.get_by_role("textbox", name="Desk code")
        code_box.fill(UNKNOWN_CODE)
        code_box.press("Enter")
        expect(msgs(page)).to_have_text(BAD_CODE)
        assert code_box.input_value() == UNKNOWN_CODE and page.evaluate("() => location.pathname") == "/sign-in"
        code_box.fill(cap(7))
        code_box.press("Enter")
        until(page, "() => location.pathname === '/captain'")
        assert page.request.get(app_url + "/api/session").json()["team_id"] == 7


def test_sheet_confirmed_in_storage(app_url: str) -> None:
    n = drafted_picture(app_url)
    for body, ctype, ext in [(png(unique("s")[0]), "image/png", "png"), (jpeg(unique("s")[0]), "image/jpeg", "jpg")]:
        r = put_sheet(app_url, n, body, ctype)
        assert r.status_code == 201, r.text
        sha = hashlib.sha256(body).hexdigest()
        sheet = r.json()["round"]["sheet"]
        assert sheet == {"status": "stored", "key": sheet_key(n, body, ext), "size": len(body), "sha256": sha,
                         "width": DIM_MIN, "height": DIM_MIN}
        assert S3().get(sheet["key"]) == body
        got = desk(app_url, QM).get(f"/api/rounds/{n}/sheet")
        assert got.status_code == 200 and got.content == body and got.headers["content-type"].startswith(ctype)
        assert round_of(app_url, n)["sheet"]["sha256"] == sha


def test_sheet_type_and_size(app_url: str) -> None:
    n = drafted_picture(app_url)
    tag = unique("size")[0]
    big = png(tag, pad_to=SHEET_MAX)
    assert len(big) == SHEET_MAX
    ok = put_sheet(app_url, n, big)
    assert ok.status_code == 201 and ok.json()["round"]["sheet"]["size"] == SHEET_MAX
    prog = jpeg(tag, sof=SOF_PROGRESSIVE)
    assert put_sheet(app_url, n, prog, "image/jpeg").status_code == 201
    refused = [(png(tag, pad_to=SHEET_MAX + 1), "image/png", 413, "too_large"),
               (png(tag + "g"), "image/gif", 415, "unsupported_media_type"),
               (png(tag + "t"), "text/plain", 415, "unsupported_media_type")]
    for body, ctype, status, code in refused:
        err(put_sheet(app_url, n, body, ctype), status, code)
        assert not [k for k in S3().keys(f"sheets/night-{NIGHT}/round-{n}/") if hashlib.sha256(body).hexdigest() in k]
    assert fields(put_sheet(app_url, n, b"")) == {"body": "required"}
    assert round_of(app_url, n)["sheet"]["sha256"] == hashlib.sha256(prog).hexdigest()


def test_sheet_content_and_dimensions(app_url: str) -> None:
    n = drafted_picture(app_url)
    tag = unique("dim")[0]
    cases = [(png(tag + "a"), "image/jpeg", 415), (jpeg(tag + "b"), "image/png", 415),
             (b"not an image " + tag.encode(), "image/png", 415),
             (png(tag + "c", w=DIM_MIN - 1), "image/png", 422), (png(tag + "d", h=DIM_MAX + 1), "image/png", 422),
             (jpeg(tag + "e", w=DIM_MAX + 1), "image/jpeg", 422), (PNG_SIG + tag.encode(), "image/png", 422)]
    for body, ctype, status in cases:
        r = put_sheet(app_url, n, body, ctype)
        if status == 415:
            err(r, 415, "unsupported_media_type")
        else:
            assert fields(r) == {"body": "invalid"}
        assert not [k for k in S3().keys(f"sheets/night-{NIGHT}/round-{n}/") if hashlib.sha256(body).hexdigest() in k]
    edge = png(tag + "f", w=DIM_MAX, h=DIM_MIN)
    r = put_sheet(app_url, n, edge)
    assert r.status_code == 201 and (r.json()["round"]["sheet"]["width"], r.json()["round"]["sheet"]["height"]) == (DIM_MAX, DIM_MIN)
    assert S3().get(sheet_key(n, edge, "png")) == edge


def test_storage_outage_sheets(app_url: str) -> None:
    down = env_url("APP_MINIO_DOWN_URL")
    n = drafted_picture(app_url)
    good = png(unique("keep")[0])
    assert put_sheet(app_url, n, good).status_code == 201
    wait_no_open(app_url)
    lost = png(unique("lost")[0])
    started = time.monotonic()
    err(put_sheet(down, n, lost), 503, "storage_unavailable")
    assert not [k for k in S3().keys(f"sheets/night-{NIGHT}/round-{n}/") if hashlib.sha256(lost).hexdigest() in k]
    assert round_of(app_url, n)["sheet"]["sha256"] == hashlib.sha256(good).hexdigest()
    err(desk(down, QM).post(f"/api/rounds/{n}/open"), 503, "storage_unavailable")
    assert round_of(app_url, n)["status"] == "drafted"
    assert time.monotonic() - started < 2 * HTTP_S
    assert httpx.get(down + "/api/table", timeout=HTTP_S).status_code == 200


def test_round_cards_live(app_url: str, browser: Browser) -> None:
    n = drafted_picture(app_url)
    with signed(browser, app_url, QM) as page:
        field_loc = page.get_by_label(f"Picture sheet for round {n}")
        body = png(unique("live")[0])
        field_loc.set_input_files(files=[{"name": "sheet.png", "mimeType": "image/png", "buffer": body}])
        field_loc.focus()
        page.evaluate("() => scrollTo(0, 40)")
        y = page.evaluate("() => scrollY")
        card = page.get_by_role("article", name=f"Round {n}")
        probe_el(card)
        opened = [r["number"] for r in rounds(app_url) if r["status"] == "open"]
        if opened:
            close(app_url, opened[0])
            changed = lambda: page.get_by_role("button", name=f"Close round {opened[0]}").count() == 0
        else:
            changed = lambda: True
        eventually(page, changed, "round card changed in place after a server change")
        advance(page, 2 * POLL_MS)
        assert field_loc.evaluate("e => e.files.length") == 1 and focused(field_loc)
        assert page.evaluate("() => scrollY") == y and kept(card)
        upload = page.get_by_role("button", name=f"Upload sheet for round {n}")
        upload.focus()
        page.keyboard.press("Enter")
        digest = hashlib.sha256(body).hexdigest()
        eventually(page, lambda: round_of(app_url, n)["sheet"]["sha256"] == digest and "Sheet stored" in card.inner_text(),
                   "this upload confirmed and the card shows Sheet stored")
        assert focused(upload)
        assert S3().get(sheet_key(n, body, "png")) == body


def test_keyboard_sheet_upload(app_url: str, browser: Browser) -> None:
    n = drafted_picture(app_url)
    with signed(browser, app_url, QM) as page:
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.method) if r.url.endswith(f"/api/rounds/{n}/sheet") and r.method == "PUT" else None)
        page.get_by_role("button", name=f"Open round {n}").focus()
        page.keyboard.press("Tab")
        file_field = page.get_by_label(f"Picture sheet for round {n}")
        assert focused(file_field), "Tab from Open round did not reach the sheet file field"
        b = page.evaluate("() => { const r = document.activeElement.getBoundingClientRect(); const s = getComputedStyle(document.activeElement);"
                          " return [r.width, r.height, r.top, r.bottom, parseFloat(s.outlineWidth), s.outlineStyle, innerHeight]; }")
        assert b[0] >= MIN_TARGET and b[1] >= MIN_TARGET and b[2] >= 0 and b[3] <= b[6]
        assert b[4] >= INK_RULE_PX and b[5] == "solid"
        with page.expect_file_chooser() as chooser:
            page.keyboard.press("Enter")
        chooser.value.set_files([])
        expect(file_field).to_be_focused()
        page.keyboard.press("Tab")
        upload = page.get_by_role("button", name=f"Upload sheet for round {n}")
        expect(upload).to_be_focused()
        page.keyboard.press("Enter")
        expect(msgs(page)).to_have_text(NO_FILE)
        assert focused(upload) and sent == []


def test_wf_sheet_upload_keyboard(app_url: str, browser: Browser) -> None:
    n = drafted_picture(app_url)
    body = png(unique("wf")[0])
    with signed(browser, app_url, QM) as page, signed(browser, app_url, QM) as other:
        heading = other.get_by_role("heading", level=1, name="Quizmaster's desk")
        heading.focus()
        file_field = page.get_by_label(f"Picture sheet for round {n}")
        tab_to(page, file_field)
        with page.expect_file_chooser() as chooser:
            page.keyboard.press("Enter")
        chooser.value.set_files(files=[{"name": "door.png", "mimeType": "image/png", "buffer": body}])
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        card = page.get_by_role("article", name=f"Round {n}")
        digest = hashlib.sha256(body).hexdigest()
        eventually(page, lambda: round_of(app_url, n)["sheet"]["sha256"] == digest and "Sheet stored" in card.inner_text(),
                   "this upload confirmed and the card shows Sheet stored")
        assert S3().get(sheet_key(n, body, "png")) == body
        eventually(other, lambda: "Sheet stored" in other.get_by_role("article", name=f"Round {n}").inner_text(),
                   "second device shows Sheet stored")
        assert focused(heading)


def test_wf_sheet_upload_outage(browser: Browser, app_url: str) -> None:
    down = env_url("APP_MINIO_DOWN_URL")
    n = drafted_picture(app_url)
    body = png(unique("down")[0])
    with signed(browser, down, QM) as page:
        page.get_by_label(f"Picture sheet for round {n}").set_input_files(
            files=[{"name": "s.png", "mimeType": "image/png", "buffer": body}])
        page.get_by_role("button", name=f"Upload sheet for round {n}").click()
        card = page.get_by_role("article", name=f"Round {n}")
        eventually(page, lambda: OUTAGE in card.inner_text(), "card outage line")
        advance(page, MSG_MS + POLL_MS)
        assert OUTAGE in card.inner_text(), "outage line left the card before the next attempt answered"
        assert OUTAGE not in msgs(page).inner_text()
    assert not [k for k in S3().keys(f"sheets/night-{NIGHT}/round-{n}/") if hashlib.sha256(body).hexdigest() in k]


def test_round_machine(app_url: str) -> None:
    wait_no_open(app_url)
    drafted = [r["number"] for r in rounds(app_url) if r["status"] == "drafted" and r["kind"] == "standard"]
    assert len(drafted) >= 2, "need two drafted standard rounds for the open race"
    a, b = drafted[:2]
    qms = [client(app_url, QM), client(app_url, QM)]
    res = race([lambda: qms[0].post(f"/api/rounds/{a}/open"), lambda: qms[1].post(f"/api/rounds/{b}/open")])
    assert sorted(r.status_code for r in res) == [200, 409]
    err(next(r for r in res if r.status_code == 409), 409, "another_round_open")
    live = [r["number"] for r in rounds(app_url) if r["status"] == "open"]
    assert len(live) == 1
    o, d = live[0], (b if live[0] == a else a)
    qm, mk = desk(app_url, QM), desk(app_url, MK)
    err(qm.post(f"/api/rounds/{o}/open"), 409, "round_not_drafted")
    err(mk.post(f"/api/rounds/{o}/marked"), 409, "round_not_closed")
    err(qm.post(f"/api/rounds/{o}/publish"), 409, "round_not_marked")
    err(qm.post(f"/api/rounds/{d}/close"), 409, "round_not_open")
    err(mk.post(f"/api/rounds/{d}/marked"), 409, "round_not_closed")
    err(qm.post(f"/api/rounds/{d}/publish"), 409, "round_not_marked")
    err(qm.post(f"/api/rounds/{d}/open"), 409, "another_round_open")
    err(put_sheet(app_url, d, png("std")), 409, "not_picture_round")
    fill(app_url, o)
    assert qm.post(f"/api/rounds/{o}/close").json()["round"]["status"] == "closed"
    err(qm.post(f"/api/rounds/{o}/close"), 409, "round_not_open")
    err(qm.post(f"/api/rounds/{o}/open"), 409, "round_not_drafted")
    assert round_of(app_url, o)["status"] == "closed" and round_of(app_url, d)["status"] == "drafted"


def test_picture_open_guard(browser: Browser) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    wait_no_open(short)
    p = drafted_picture(short, not_stored=True)
    with signed(browser, short, QM) as page:
        page.get_by_role("button", name=f"Open round {p}").click()
        card = page.get_by_role("article", name=f"Round {p}")
        expect(card).to_contain_text(f"Upload and store the picture sheet before opening round {p}.")
    err(desk(short, QM).post(f"/api/rounds/{p}/open"), 409, "sheet_not_stored")
    assert round_of(short, p)["status"] == "drafted"
    body = png(unique("pic")[0])
    assert put_sheet(short, p, body).status_code == 201
    assert S3("-round-short").get(sheet_key(p, body, "png")) == body
    r = desk(short, QM).post(f"/api/rounds/{p}/open")
    assert r.status_code == 200 and r.json()["round"]["status"] == "open"
    close(short, p)


@pytest.mark.timeout(600)
def test_server_timed_close(app_url: str) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    n = open_next(short, ttl=True)
    assert submit(short, 1, n, {1: "on time"}).status_code == 201
    r = round_of(short, n)
    opened, closes = (datetime.fromisoformat(r[k].replace("Z", "+00:00")) for k in ("opened_at", "closes_at"))
    assert closes > opened and r["seconds_left"] is not None and r["closed_at"] is None
    deadline = time.monotonic() + SHORT_WAIT_S
    while round_of(short, n)["status"] == "open":
        if time.monotonic() > deadline:
            pytest.fail("round stayed open past its allowance; expected the server to close it at closes_at (L669)")
        httpx.get(short + "/api/health", timeout=HTTP_S)
    r = round_of(short, n)
    assert r["status"] == "closed" and r["seconds_left"] is None
    assert datetime.fromisoformat(r["closed_at"].replace("Z", "+00:00")) == closes
    err(submit(short, 1, n, {1: "late"}), 409, "round_closed")
    m = open_round(app_url)
    fill(app_url, m)
    res = desk(app_url, QM).post(f"/api/rounds/{m}/close").json()["round"]
    assert res["status"] == "closed"
    assert datetime.fromisoformat(res["closed_at"].replace("Z", "+00:00")) < datetime.fromisoformat(res["closes_at"].replace("Z", "+00:00"))


def test_round_strip_status(app_url: str, browser: Browser) -> None:
    with public(browser, app_url, "/", skew=True) as page:
        eventually(page, lambda: chip_ok(page, app_url), "strip matches GET /api/rounds")
        opened = [r["number"] for r in rounds(app_url) if r["status"] == "open"]
        n = opened[0] if opened else open_next(app_url)
        chip = chips(page).nth(n - 1)
        probe_el(chip)
        if opened:
            close(app_url, n)
        eventually(page, lambda: f"Round {n} · {STATUS[round_of(app_url, n)['status']]}" in chip.inner_text()
                   and chip_ok(page, app_url), "chip shows the new server status")
        assert kept(chip)


def test_strip_wrap_and_card_focus(app_url: str, browser: Browser) -> None:
    with public(browser, app_url, "/") as page:
        for width, rows_ in ((BP[0] - 1, 2), (BP[0], 1)):
            page.set_viewport_size({"width": width, "height": 800})
            tops = {round(box(chips(page).nth(i))["y"]) for i in range(ROUND_COUNT)}
            assert len(tops) == rows_, f"at {width}px the strip has {len(tops)} rows; expected {rows_}"


@pytest.mark.timeout(600)
def test_server_close_seen_live(browser: Browser) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    wait_no_open(short)
    with signed(browser, short, cap(1), skew=True) as cpage, signed(browser, short, QM, skew=True) as qpage:
        n = open_next(short, ttl=True)
        eventually([cpage, qpage], lambda: form(cpage, n).count() == 1 and form(cpage, n).is_visible(), "round n's answer form appears")
        q1 = form(cpage, n).get_by_role("textbox", name="Question 1", exact=True)
        q1.fill(SUNDIAL)
        probe_el(q1)
        probe_el(form(cpage, n))
        btn = qpage.get_by_role("button", name=f"Close round {n}")
        eventually(qpage, lambda: btn.count() == 1, "Close button appears")
        btn.focus()
        q1.focus()
        eventually([cpage, qpage], lambda: round_of(short, n)["status"] == "closed"
                   and q1.evaluate("e => e.readOnly || e.getAttribute('aria-readonly') === 'true'")
                   and f"Round {n} · Closed" in chips(qpage).nth(n - 1).inner_text(),
                   "server-timed close shown", within_ms=SHORT_WAIT_S * 1000, real_s=SHORT_WAIT_S)
        assert q1.input_value() == SUNDIAL and kept(q1) and kept(form(cpage, n)) and focused(q1)
        assert closed_copy(n) in body_text(cpage)
        eventually(qpage, lambda: focused(qpage.get_by_role("article", name=f"Round {n}")), "focus moves to card")
        advance(cpage, 2 * POLL_MS)
        assert kept(form(cpage, n)) and "0:00 left" in cpage.get_by_role("timer", name="Time left").inner_text()


def test_wf_round_control_keyboard(app_url: str, browser: Browser) -> None:
    wait_no_open(app_url)
    n = next(r["number"] for r in rounds(app_url) if r["status"] == "drafted" and r["kind"] == "standard")
    with signed(browser, app_url, QM) as page, public(browser, app_url, "/") as pub:
        tab_to(page, page.get_by_role("button", name=f"Open round {n}"))
        page.keyboard.press("Enter")
        eventually(pub, lambda: f"Round {n} · Open" in chips(pub).nth(n - 1).inner_text(), "public strip shows Open")
        assert round_of(app_url, n)["status"] == "open"
        fill(app_url, n)
        eventually(page, lambda: focused(page.get_by_role("button", name=f"Close round {n}")), "focus on Close")
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(page.get_by_role("article", name=f"Round {n}")), "focus on round card")
        eventually(pub, lambda: f"Round {n} · Closed" in chips(pub).nth(n - 1).inner_text(), "public strip shows Closed")
    assert round_of(app_url, n)["status"] == "closed"


def test_wf_round_control_another_open(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    drafted = sorted((r["kind"] != "standard", r["number"]) for r in rounds(app_url) if r["status"] == "drafted")
    assert drafted, "no drafted round left to try opening"
    m = drafted[0][1]
    with signed(browser, app_url, QM) as page:
        btn = page.get_by_role("button", name=f"Open round {m}")
        tab_to(page, btn)
        page.keyboard.press("Enter")
        expect(msgs(page)).to_contain_text(ANOTHER_OPEN)
        assert focused(btn)
    assert round_of(app_url, m)["status"] == "drafted" and round_of(app_url, n)["status"] == "open"


def test_answers_stored_as_typed(app_url: str) -> None:
    n = open_round(app_url)
    tok = unique("nfc")[0]
    r = submit(app_url, 5, n, {1: f"  bJo\u0308rk {tok}  ", 2: f"Q.E.D. {tok}"})
    assert r.status_code == 201, r.text
    acc = {a["question"]: a for a in r.json()["accepted"]}
    assert acc[1]["text"] == f"bJ\u00f6rk {tok}" and acc[2]["text"] == f"Q.E.D. {tok}"
    assert acc[1]["submitted_at"].endswith("Z") and acc[1]["current"] is True and acc[1]["team_id"] == 5
    r2 = submit(app_url, 5, n, {1: f"Second {tok}"})
    assert r2.status_code == 201
    mine = {a["question"]: a["text"] for a in answers_of(app_url, n, cap(5))}
    assert mine[1] == f"Second {tok}" and mine[2] == f"Q.E.D. {tok}"
    hist = [a for a in archive_all(app_url, n) if tok in a["text"] and a["question"] == 1]
    assert [(a["text"], a["current"]) for a in hist] == [(f"bJ\u00f6rk {tok}", False), (f"Second {tok}", True)]


def test_answer_length_limit(app_url: str) -> None:
    n = open_round(app_url)
    tok = unique("len")[0]
    beer = "\U0001F37A" * (ANSWER_MAX - len(tok)) + tok
    ok = submit(app_url, 6, n, {1: beer})
    assert ok.status_code == 201 and ok.json()["accepted"][0]["text"] == beer
    bad = submit(app_url, 6, n, {2: beer + "x", 3: "   ", 4: f"fine {tok}"})
    assert fields(bad) == {"question_2": "too_long", "question_3": "required"}
    assert f"fine {tok}" not in [a["text"] for a in answers_of(app_url, n, cap(6))]
    c = RetryClient(app_url, 6)
    for body, value in [({"answers": []}, "required"), ({}, "required"),
                        ({"answers": [{"question": q % 8 + 1, "text": "x"} for q in range(9)]}, "invalid"),
                        ({"answers": [{"question": 1, "text": "a"}, {"question": 1, "text": "b"}]}, "invalid"),
                        ({"answers": [{"question": 9, "text": "a"}]}, "invalid")]:
        assert fields(c.post(f"/api/rounds/{n}/answers", json=body)) == {"answers": value}


def test_live_counters(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    with signed(browser, app_url, cap(7)) as page:
        eventually(page, lambda: field(page, 1).is_visible(), "answer form")
        f = form(page, n)
        for value, count in COUNT_EXAMPLES:
            field(page, 1).fill(value)
            assert f"{count}/{ANSWER_MAX}" in f.inner_text(), f"counter for {value!r} should read {count}/{ANSWER_MAX}"
        field(page, 1).fill("a" * ANSWER_MAX)
        assert ANSWER_OVER not in body_text(page)
        field(page, 1).fill("a" * (ANSWER_MAX + 1))
        assert f"{ANSWER_MAX + 1}/{ANSWER_MAX}" in f.inner_text() and ANSWER_OVER in body_text(page)
        page.get_by_role("button", name="Rename team").click()
        dlg = page.get_by_role("dialog", name="Rename team")
        name = dlg.get_by_role("textbox", name="Team name")
        name.fill("\U0001F1EC\U0001F1E7")
        assert f"2/{NAME_MAX}" in dlg.inner_text()
        name.fill("n" * (NAME_MAX + 1))
        assert f"{NAME_MAX + 1}/{NAME_MAX}" in dlg.inner_text() and NAME_OVER in dlg.inner_text()


@pytest.mark.timeout(900)
def test_submit_rate_limit(app_url: str) -> None:
    c = desk(app_url, cap(RATE_TEAM))
    body = {"answers": [{"question": 1, "text": "rate"}]}
    post = lambda: c.post("/api/rounds/1/answers", json=body, headers={"Idempotency-Key": idempotency_key()})
    for _ in range(RATE + 1):
        if post().status_code == 429:
            break
    pace(app_url, WINDOW_S + 1)
    seen = [post() for _ in range(RATE)]
    assert all(r.status_code != 429 for r in seen), [r.status_code for r in seen]
    seventh = post()
    b = err(seventh, 429, "too_many_submits")
    assert isinstance(b["retry_after"], int) and 1 <= b["retry_after"] <= WINDOW_S
    assert seventh.headers["Retry-After"] == str(b["retry_after"])


def test_wait_copy_on_phone(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    with signed(browser, app_url, cap(11), size=(375, 812)) as page:
        eventually(page, lambda: field(page, 1).is_visible(), "answer form")
        c = desk(app_url, cap(11))
        for _ in range(RATE + 1):
            if c.post(f"/api/rounds/{n}/answers", json={"answers": [{"question": 2, "text": "burst"}]},
                      headers={"Idempotency-Key": idempotency_key()}).status_code == 429:
                break
        field(page, 1).fill("Paris")
        with page.expect_response(lambda r: r.url.endswith(f"/api/rounds/{n}/answers") and r.request.method == "POST") as resp:
            page.get_by_role("button", name="Submit answers").click()
        assert resp.value.status == 429
        secs = resp.value.headers["retry-after"]
        expect(msgs(page)).to_have_text(f"Too many submits. Please wait {secs} s and try again.")


@pytest.mark.timeout(600)
def test_closed_round_refusal(browser: Browser) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    with signed(browser, short, cap(2), skew=True) as page:
        n = open_round(short)
        eventually(page, lambda: form(page, n).count() == 1 and form(page, n).is_visible(), "round n's answer form")
        form(page, n).get_by_role("textbox", name="Question 1", exact=True).fill(LATE_TEXT)
        fill(short, n)
        close(short, n)
        with page.expect_response(lambda r: r.url.endswith(f"/api/rounds/{n}/answers") and r.request.method == "POST") as resp:
            form(page, n).get_by_role("button", name="Submit answers").click()
        assert resp.value.status == 409 and resp.value.json()["error"] == "round_closed"
        expect(msgs(page)).to_have_text(closed_copy(n))
    err(submit(short, 2, n, {1: "late"}), 409, "round_closed")
    assert LATE_TEXT not in [a["text"] for a in answers_of(short, n, cap(2))]
    assert round_of(short, n)["status"] == "closed"


@pytest.mark.timeout(600)
def test_countdown_synced(browser: Browser) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    with signed(browser, short, cap(3), skew=True) as page:
        n = open_round(short)
        eventually(page, lambda: page.get_by_role("timer", name="Time left").count() == 1, "countdown shown")
        before = round_of(short, n)["seconds_left"]
        advance(page, POLL_MS + STEP_MS)
        shown = timer_seconds(page)
        after = round_of(short, n)["seconds_left"]
        assert after - 1 <= shown <= before + 1, f"countdown {shown}s; server said {before}..{after}s"
        page.clock.set_system_time("2026-11-01T00:00:00Z")
        advance(page, POLL_MS + STEP_MS)
        before2, shown2, after2 = before, timer_seconds(page), round_of(short, n)["seconds_left"]
        assert (after2 or 0) - 1 <= shown2 <= before2 + 1
        fill(short, n)
    close(short, n)


def test_submit_replay(app_url: str) -> None:
    n = open_round(app_url)
    tok = unique("idem")[0]
    c = RetryClient(app_url, 10)
    key = idempotency_key()
    h = {"Content-Type": "application/json", "Idempotency-Key": key}
    one = c.post(f"/api/rounds/{n}/answers", content=f'{{"answers":[{{"question":1,"text":"A {tok}"}}]}}', headers=h)
    assert one.status_code == 201
    again = c.post(f"/api/rounds/{n}/answers", content=f'{{ "answers" : [ {{ "text" : "A {tok}", "question" : 1 }} ] }}', headers=h)
    assert again.status_code == 201 and again.json() == one.json() and again.headers["Idempotent-Replayed"] == "true"
    assert len([a for a in archive_all(app_url, n) if a["text"] == f"A {tok}"]) == 1
    err(c.post(f"/api/rounds/{n}/answers", json={"answers": [{"question": 1, "text": f"B {tok}"}]},
               headers={"Idempotency-Key": key}), 409, "idempotency_conflict")
    for bad in ["k" * (KEY_MAX + 1), "kéy", "a b"]:
        assert fields(c.post(f"/api/rounds/{n}/answers", json={"answers": [{"question": 1, "text": "x"}]},
                             headers={"Idempotency-Key": bad.encode()})) == {"idempotency_key": "invalid"}
    fresh = idempotency_key()
    fields(c.post(f"/api/rounds/{n}/answers", json={"answers": [{"question": 1, "text": " "}]}, headers={"Idempotency-Key": fresh}))
    later = c.post(f"/api/rounds/{n}/answers", json={"answers": [{"question": 2, "text": f"C {tok}"}]}, headers={"Idempotency-Key": fresh})
    assert later.status_code == 201 and "Idempotent-Replayed" not in later.headers


def test_answer_form_survives_timers(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    with signed(browser, app_url, cap(8), size=(375, 812), reduced_motion="reduce") as page:
        eventually(page, lambda: field(page, 3).is_visible(), "answer form")
        q3 = field(page, 3)
        q3.fill(KEEP_TEXT)
        q3.evaluate("e => e.setSelectionRange(1, 4)")
        probe_el(q3)
        probe_el(form(page, n))
        advance(page, 3 * POLL_MS + MSG_MS)
        assert q3.input_value() == KEEP_TEXT and focused(q3) and kept(q3) and kept(form(page, n))
        assert q3.evaluate("e => [e.selectionStart, e.selectionEnd]") == [1, 4]
        for q in QUESTIONS:
            assert box(field(page, q))["height"] >= MIN_TARGET
        sub = box(page.get_by_role("button", name="Submit answers"))
        assert sub["height"] >= MIN_TARGET and sub["width"] >= MIN_TARGET
        page.get_by_role("button", name="Submit answers").click()
        expect(page.get_by_role("list", name="Accepted answers")).to_contain_text(KEEP_TEXT)
        assert all(d <= REDUCED_MS for d in page.evaluate(DURATIONS_JS))
        assert not page.evaluate(MOVES_JS)
    assert KEEP_TEXT in [a["text"] for a in answers_of(app_url, n, cap(8))]


@pytest.mark.parametrize("width", [375, 767, 768], ids=["375", "767", "768"])
def test_answer_form_layout(app_url: str, browser: Browser, width: int) -> None:
    open_round(app_url)
    with signed(browser, app_url, cap(9), size=(width, 812)) as page:
        eventually(page, lambda: field(page, 1).is_visible(), "answer form")
        timer = page.get_by_role("timer", name="Time left")
        boxes = [box(field(page, q)) for q in QUESTIONS]
        assert box(timer)["y"] + box(timer)["height"] <= boxes[0]["y"] + PX_TOL
        if width < BP[1]:
            assert all(b["y"] > a["y"] for a, b in zip(boxes, boxes[1:]))
            assert all(abs(b["x"] - boxes[0]["x"]) <= PX_TOL and abs(b["width"] - boxes[0]["width"]) <= PX_TOL for b in boxes)
            for q in QUESTIONS:
                lbl = box(page.get_by_text(f"Question {q}", exact=True).first)
                assert lbl["y"] + lbl["height"] <= boxes[q - 1]["y"] + PX_TOL
            page.evaluate("(y) => scrollTo(0, y)", page.evaluate("() => scrollY") + boxes[2]["y"])
            t = box(timer)
            assert abs(t["y"]) <= PX_TOL, f"countdown top {t['y']}px; expected pinned at 0"
        else:
            for i in range(0, ROUND_COUNT, 2):
                left, right = boxes[i], boxes[i + 1]
                assert abs(left["y"] - right["y"]) <= PX_TOL and right["x"] > left["x"]
            assert boxes[2]["y"] > boxes[0]["y"] and abs(boxes[2]["x"] - boxes[0]["x"]) <= PX_TOL


def test_wf_captain_submit_phone(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    tok = unique("phone")[0]
    with public(browser, app_url, "/sign-in", size=(375, 812)) as page:
        tap_el(page, page.get_by_role("textbox", name="Desk code"))
        page.keyboard.type(cap(9))
        tap_el(page, page.get_by_role("button", name="Sign in"))
        until(page, "() => location.pathname === '/captain'")
        eventually(page, lambda: field(page, 1).is_visible(), "answer form")
        for q in QUESTIONS:
            field(page, q).fill(f"{tok} {q}")
        page.get_by_role("button", name="Submit answers").click()
        expect(msgs(page)).to_have_text(f"Answers in for round {n}.")
        accepted = page.get_by_role("list", name="Accepted answers")
        for q in QUESTIONS:
            expect(accepted).to_contain_text(f"{tok} {q}")
            assert field(page, q).input_value() == f"{tok} {q}"
        layout(page)
    mine = {a["question"]: a["text"] for a in answers_of(app_url, n, cap(9))}
    assert all(mine[q] == f"{tok} {q}" for q in QUESTIONS)


def test_wf_captain_submit_over_limit(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    tok = unique("over")[0]
    with signed(browser, app_url, cap(8), size=(375, 812)) as page:
        eventually(page, lambda: field(page, 1).is_visible(), "answer form")
        field(page, 1).fill("z" * (ANSWER_MAX + 1))
        with page.expect_response(lambda r: r.url.endswith(f"/api/rounds/{n}/answers") and r.request.method == "POST") as resp:
            page.get_by_role("button", name="Submit answers").click()
        assert resp.value.status == 422
        assert ANSWER_OVER in body_text(page)
        field(page, 1).fill(tok)
        page.get_by_role("button", name="Submit answers").click()
        expect(msgs(page)).to_have_text(f"Answers in for round {n}.")
    assert tok in [a["text"] for a in answers_of(app_url, n, cap(8))]


def test_team_name_rules(app_url: str) -> None:
    c = desk(app_url, cap(11))
    version = table(app_url)["version"]
    tok = unique("Lot")[0]
    name40 = tok + "\U0001F37A" * (NAME_MAX - len(tok))
    r = c.patch("/api/teams/11", json={"name": name40})
    assert r.status_code == 200 and r.json() == {"team": {"id": 11, "name": name40}}
    assert team_name(app_url, 11) == name40 and table(app_url)["version"] == version
    assert fields(c.patch("/api/teams/11", json={"name": name40 + "x"})) == {"name": "too_long"}
    assert fields(c.patch("/api/teams/11", json={"name": "  "})) == {"name": "required"}
    err(c.patch("/api/teams/11", json={"name": team_name(app_url, 1).upper()}), 409, "name_taken")
    err(c.patch("/api/teams/1", json={"name": unique("x")[0]}), 403, "forbidden")
    err(c.patch("/api/teams/999", json={"name": unique("x")[0]}), 404, "not_found")
    final = unique("Dots")[0]
    assert c.patch("/api/teams/11", json={"name": f"  {final}  "}).json()["team"]["name"] == final
    assert team_name(app_url, 11) == final


def test_rename_dialog_keyboard(app_url: str, browser: Browser) -> None:
    with signed(browser, app_url, cap(3)) as page:
        opener = page.get_by_role("button", name="Rename team")
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Rename team")
        name = dlg.get_by_role("textbox", name="Team name")
        expect(name).to_be_focused()
        assert name.input_value() == team_name(app_url, 3)
        assert tab_order(page, 3) == ["Save name", "Cancel", "Team name"]
        page.keyboard.press("Shift+Tab")
        expect(dlg.get_by_role("button", name="Cancel")).to_be_focused()
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(opener) and dlg.count() == 0, "Escape closes with focus on Rename team", within_ms=PANE_MS * 2)
        opener.press("Enter")
        dlg.get_by_role("button", name="Cancel").press("Enter")
        eventually(page, lambda: focused(opener) and dlg.count() == 0, "Cancel closes with focus on Rename team", within_ms=PANE_MS * 2)
        new = unique("Ohms")[0]
        opener.press("Enter")
        name.fill(new)
        name.press("Enter")
        expect(msgs(page)).to_have_text(NAME_SAVED)
        eventually(page, lambda: focused(opener) and dlg.count() == 0, "save closes with focus on Rename team", within_ms=PANE_MS * 2)
    assert team_name(app_url, 3) == new


@pytest.mark.parametrize("width", [767, 768], ids=["767", "768"])
def test_rename_sheet_and_live_name(app_url: str, browser: Browser, width: int) -> None:
    with signed(browser, app_url, cap(4), size=(width, 1024)) as page:
        page.get_by_role("button", name="Rename team").click()
        dlg = page.get_by_role("dialog", name="Rename team")
        name = dlg.get_by_role("textbox", name="Team name")
        settle_pane(page)
        b = box(dlg)
        if width < BP[1]:
            assert abs(b["x"]) <= PX_TOL and abs(b["y"]) <= PX_TOL and abs(b["width"] - width) <= PX_TOL and abs(b["height"] - 1024) <= PX_TOL
        else:
            assert abs(b["width"] - max(PANE_MIN_W, width / 2)) <= PX_TOL and abs(b["x"] + b["width"] - width) <= PX_TOL
            assert abs(b["height"] - 1024) <= PX_TOL
        name.fill(DRAFT_TEXT)
        name.evaluate("e => e.setSelectionRange(2, 5)")
        counter = dlg.inner_text()
        fresh = unique("Bears")[0]
        assert desk(app_url, cap(4)).patch("/api/teams/4", json={"name": fresh}).status_code == 200
        eventually(page, lambda: tile(page, fresh).count() == 1, "tile behind the dialog shows the new name")
        assert name.input_value() == DRAFT_TEXT and focused(name) and dlg.inner_text() == counter
        assert name.evaluate("e => [e.selectionStart, e.selectionEnd]") == [2, 5]


def test_rename_seen_live_everywhere(app_url: str, browser: Browser) -> None:
    old = team_name(app_url, 10)
    with public(browser, app_url, "/") as pub, signed(browser, app_url, cap(1)) as cp_, signed(browser, app_url, QM) as qm:
        pages = [pub, cp_, qm]
        for p in pages:
            probe_el(tile(p, old))
        tile(pub, old).focus()
        ys = [p.evaluate("() => scrollY") for p in pages]
        version = table(app_url)["version"]
        fresh = unique("Tops")[0]
        assert desk(app_url, cap(10)).patch("/api/teams/10", json={"name": fresh}).status_code == 200
        eventually(pages, lambda: all(tile(p, fresh).count() == 1 and kept(tile(p, fresh)) for p in pages),
                   "renamed tile is the same element on every table")
        assert focused(tile(pub, fresh)) and [p.evaluate("() => scrollY") for p in pages] == ys
    assert table(app_url)["version"] == version


def test_wf_team_rename_keyboard(app_url: str, browser: Browser) -> None:
    fresh = unique("Bees")[0]
    with signed(browser, app_url, cap(7)) as page:
        tab_to(page, page.get_by_role("button", name="Rename team"))
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Rename team")
        page.keyboard.press("Control+a")
        page.keyboard.type(fresh)
        assert f"{cp(fresh)}/{NAME_MAX}" in dlg.inner_text()
        page.keyboard.press("Enter")
        expect(msgs(page)).to_have_text(NAME_SAVED)
        eventually(page, lambda: tile(page, fresh).count() == 1, "own tile shows the new name")
    assert team_name(app_url, 7) == fresh


def test_wf_team_rename_taken(app_url: str, browser: Browser) -> None:
    before = team_name(app_url, 6)
    taken = team_name(app_url, 5).lower()
    with signed(browser, app_url, cap(6)) as page:
        page.get_by_role("button", name="Rename team").click()
        name = page.get_by_role("dialog", name="Rename team").get_by_role("textbox", name="Team name")
        name.fill(taken)
        name.press("Enter")
        expect(msgs(page)).to_have_text(NAME_TAKEN)
        assert page.get_by_role("dialog", name="Rename team").count() == 1 and focused(name)
    assert team_name(app_url, 6) == before


def test_marks_never_touch_answers(app_url: str) -> None:
    n = next((r["number"] for r in rounds(app_url) if r["status"] == "closed"
              and any(not x["current"] for x in archive_all(app_url, r["number"]))), None)
    if n is None:
        n = open_next(app_url)
        fill(app_url, n)
        close(app_url, n)
    rows = answers_of(app_url, n)
    a = rows[0]
    mk = desk(app_url, MK)
    r = mk.put(f"/api/rounds/{n}/marks", json={"answer_id": a["id"], "points": 1})
    assert r.status_code == 200 and r.json()["answer"]["mark"] == 1 and r.json()["answer"]["text"] == a["text"]
    r = mk.put(f"/api/rounds/{n}/marks", json={"answer_id": a["id"], "points": policy(a["question"])})
    assert r.json()["answer"]["mark"] == policy(a["question"])
    for bad in (2, -1, "1", 0.5, None):
        assert fields(mk.put(f"/api/rounds/{n}/marks", json={"answer_id": a["id"], "points": bad}))["points"] in ("invalid", "required")
    assert fields(mk.put(f"/api/rounds/{n}/marks", json={"answer_id": "x", "points": 1})) == {"answer_id": "invalid"}
    every = archive_all(app_url)
    old = next(x for x in every if x["round"] == n and not x["current"])
    err(mk.put(f"/api/rounds/{n}/marks", json={"answer_id": old["id"], "points": 1}), 409, "answer_superseded")
    m = open_round(app_url)
    sent = submit(app_url, 6, m, {8: unique("open")[0]}).json()["accepted"][0]
    err(mk.put(f"/api/rounds/{n}/marks", json={"answer_id": sent["id"], "points": 1}), 404, "not_found")
    err(mk.put(f"/api/rounds/{m}/marks", json={"answer_id": sent["id"], "points": 1}), 409, "round_not_closed")
    after = {x["id"]: x["text"] for x in archive_all(app_url, n)}
    assert all(after[x["id"]] == x["text"] for x in every if x["round"] == n)


def test_finish_marking_guard(app_url: str) -> None:
    n = closed_round(app_url, unmarked=1)
    left = sum(a["mark"] is None for a in answers_of(app_url, n))
    err(desk(app_url, MK).post(f"/api/rounds/{n}/marked"), 409, "unmarked_answers", count=left)
    assert round_of(app_url, n)["status"] == "closed"
    mark_all(app_url, n)
    r = desk(app_url, MK).post(f"/api/rounds/{n}/marked")
    assert r.status_code == 200 and r.json()["round"]["status"] == "marked"
    err(desk(app_url, MK).post(f"/api/rounds/{n}/marked"), 409, "round_not_closed")


def open_pane(page: Page, n: int) -> Locator:
    page.get_by_role("button", name=f"Mark round {n}").click()
    return page.get_by_role("dialog", name=f"Mark round {n}")


def group(pane: Locator, base: str, a: dict) -> Locator:
    return pane.get_by_role("radiogroup", name=f"{team_name(base, a['team_id'])}, question {a['question']}", exact=True)


def test_marking_pane_keyboard(app_url: str, browser: Browser) -> None:
    n = closed_round(app_url, unmarked=3)
    rows = answers_of(app_url, n)
    unmarked = [i for i, a in enumerate(rows) if a["mark"] is None]
    with signed(browser, app_url, MK) as page:
        puts: list[dict] = []
        page.on("request", lambda r: puts.append(json.loads(r.post_data or "{}")) if r.method == "PUT" and "/marks" in r.url else None)
        pane = open_pane(page, n)
        assert holds_focus(group(pane, app_url, rows[unmarked[0]]))
        pane.get_by_role("button", name="Close").focus()
        for combo in ("Control+c", "Meta+x", "Alt+j"):
            page.keyboard.press(combo)
        advance(page, STEP_MS)
        assert puts == []
        key0 = "x" if policy(rows[unmarked[0]]["question"]) == 0 else "c"
        with page.expect_response(lambda r: "/marks" in r.url):
            page.keyboard.press(key0)
        assert puts[-1]["answer_id"] == rows[unmarked[0]]["id"]
        pane.get_by_role("button", name="Finish marking").focus()
        key1 = "X" if policy(rows[unmarked[1]]["question"]) == 0 else "C"
        with page.expect_response(lambda r: "/marks" in r.url):
            page.keyboard.press(key1)
        assert puts[-1] == {"answer_id": rows[unmarked[1]]["id"], "points": policy(rows[unmarked[1]]["question"])}
        cur = unmarked[2]
        page.keyboard.press("k")
        prev = rows[cur - 1]
        with page.expect_response(lambda r: "/marks" in r.url):
            page.keyboard.press("x" if policy(prev["question"]) == 0 else "c")
        assert puts[-1]["answer_id"] == prev["id"]
        pane.get_by_role("button", name="Finish marking").focus()
        names = tab_order(page, 2)
        assert names[0] == "Close" and holds_focus(group(pane, app_url, rows[0]))
        page.keyboard.press("Shift+Tab")
        expect(pane.get_by_role("button", name="Close")).to_be_focused()
        group(pane, app_url, rows[0]).get_by_role("radio").first.focus()
        steps = tab_order(page, len(rows))
        assert steps[-1] == "Finish marking" and all(s in ("Correct", "Wrong") for s in steps[:-1])
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(page.get_by_role("button", name=f"Mark round {n}")), "Escape returns focus", within_ms=PANE_MS * 2)
    marks = {a["id"]: a["mark"] for a in answers_of(app_url, n)}
    assert marks[rows[unmarked[1]]["id"]] == policy(rows[unmarked[1]]["question"])


def test_marking_pane_live(app_url: str, browser: Browser) -> None:
    n = closed_round(app_url, unmarked=2)
    rows = answers_of(app_url, n)
    last = [a for a in rows if a["mark"] is None][-1]
    with signed(browser, app_url, MK) as page:
        pane = open_pane(page, n)
        start = page.evaluate("() => document.activeElement && document.activeElement.outerHTML")
        scroll = pane.evaluate("e => e.scrollTop")
        assert desk(app_url, MK).put(f"/api/rounds/{n}/marks", json={"answer_id": last["id"], "points": 1}).status_code == 200
        radio = group(pane, app_url, last).get_by_role("radio", name="Correct")
        eventually(page, lambda: radio.is_checked(), "other device's mark checks the radio")
        assert page.evaluate("() => document.activeElement && document.activeElement.outerHTML") == start
        assert pane.evaluate("e => e.scrollTop") == scroll
        left = sum(a["mark"] is None for a in answers_of(app_url, n))
        fin = pane.get_by_role("button", name="Finish marking")
        fin.focus()
        page.keyboard.press("Enter")
        expect(msgs(page)).to_have_text(f"Answers left to mark in round {n}: {left}.")
        advance(page, MSG_MS + MSG_TOL_MS)
        assert pane.count() == 1 and focused(fin)
    desk(app_url, MK).put(f"/api/rounds/{n}/marks", json={"answer_id": last["id"], "points": policy(last["question"])})


def test_touch_marking_reduced_motion(app_url: str, browser: Browser) -> None:
    n = closed_round(app_url, unmarked=1)
    a = next(x for x in answers_of(app_url, n) if x["mark"] is None)
    with signed(browser, app_url, MK, size=(768, 1024), reduced_motion="reduce") as page:
        page.get_by_role("button", name=f"Mark round {n}").click()
        pane = page.get_by_role("dialog", name=f"Mark round {n}")
        rects, longest = path(page, pane, PANE_MS)
        assert still(rects) and longest <= REDUCED_MS
        g = group(pane, app_url, a)
        want = "Wrong" if policy(a["question"]) == 0 else "Correct"
        cr, wr = box(g.get_by_role("radio", name="Correct")), box(g.get_by_role("radio", name="Wrong"))
        assert abs((cr["x"] + cr["width"] / 2) - (wr["x"] + wr["width"] / 2)) + abs((cr["y"] + cr["height"] / 2) - (wr["y"] + wr["height"] / 2)) >= MIN_TARGET
        t = wr if want == "Wrong" else cr
        with page.expect_response(lambda r: "/marks" in r.url) as resp:
            touch_at(page, t["x"] + t["width"] / 2 + MIN_TARGET / 2 - 3, t["y"] + t["height"] / 2 - MIN_TARGET / 2 + 3)
        assert json.loads(resp.value.request.post_data or "{}") == {"answer_id": a["id"], "points": policy(a["question"])}
        before = pane.evaluate(ANCESTRY_JS)
        page.keyboard.press("Escape")
        assert pane.evaluate(ANCESTRY_JS) == before or pane.count() == 0
        assert not page.evaluate(MOVES_JS)
    assert next(x for x in answers_of(app_url, n) if x["id"] == a["id"])["mark"] == policy(a["question"])


def test_wf_marking_keyboard(app_url: str, browser: Browser) -> None:
    n = closed_round(app_url, unmarked=1)
    rows = answers_of(app_url, n)
    with signed(browser, app_url, MK) as page:
        tab_to(page, page.get_by_role("button", name=f"Mark round {n}"))
        page.keyboard.press("Enter")
        pane = page.get_by_role("dialog", name=f"Mark round {n}")
        for a in [x for x in rows if x["mark"] is None]:
            with page.expect_response(lambda r: "/marks" in r.url) as resp:
                page.keyboard.press("x" if policy(a["question"]) == 0 else "c")
            assert json.loads(resp.value.request.post_data or "{}")["answer_id"] == a["id"]
        tab_to(page, pane.get_by_role("button", name="Finish marking"))
        page.keyboard.press("Enter")
        expect(msgs(page)).to_have_text(f"Round {n} is marked.")
        eventually(page, lambda: focused(page.get_by_role("heading", name="Marking", level=1)), "focus on Marking", within_ms=PANE_MS * 2)
        eventually(page, lambda: f"Round {n} · Marked" in chips(page).nth(n - 1).inner_text(), "strip shows Marked")
    assert round_of(app_url, n)["status"] == "marked"
    assert all(a["mark"] == policy(a["question"]) for a in answers_of(app_url, n) if a["id"] in {x["id"] for x in rows if x["mark"] is None})


def test_wf_marking_two_markers(app_url: str, browser: Browser) -> None:
    n = closed_round(app_url, unmarked=2)
    rows = [a for a in answers_of(app_url, n) if a["mark"] is None]
    with signed(browser, app_url, MK, size=(768, 1024)) as one, signed(browser, app_url, MK, size=(768, 1024)) as two:
        p1, p2 = open_pane(one, n), open_pane(two, n)
        a = rows[0]
        with one.expect_response(lambda r: "/marks" in r.url):
            one.keyboard.press("x" if policy(a["question"]) == 0 else "c")
        name = "Wrong" if policy(a["question"]) == 0 else "Correct"
        eventually(two, lambda: group(p2, app_url, a).get_by_role("radio", name=name).is_checked(), "mark appears on second tablet")
        b = rows[-1]
        r = group(p2, app_url, b).get_by_role("radio", name="Wrong" if policy(b["question"]) == 0 else "Correct")
        with two.expect_response(lambda r_: "/marks" in r_.url):
            r.click()
        eventually(one, lambda: group(p1, app_url, b).get_by_role("radio", name="Wrong" if policy(b["question"]) == 0 else "Correct").is_checked(),
                   "mark appears on first tablet")
    marks = {x["id"]: x["mark"] for x in answers_of(app_url, n)}
    assert marks[a["id"]] == policy(a["question"]) and marks[b["id"]] == policy(b["question"])


def test_archive_paging(app_url: str) -> None:
    mk = desk(app_url, MK)
    first = mk.get("/api/answers").json()
    assert first["limit"] == LIMIT_DEFAULT and len(first["answers"]) <= LIMIT_DEFAULT
    assert mk.get("/api/answers", params={"limit": 1000}).json()["limit"] == LIMIT_CAP
    for params, name in [({"limit": 0}, "limit"), ({"limit": "x"}, "limit"), ({"cursor": "%%junk%%"}, "cursor"),
                         ({"round": 9}, "round"), ({"round": "x"}, "round")]:
        assert fields(mk.get("/api/answers", params=params)) == {name: "invalid"}
    n = open_round(app_url)
    tok = unique("page")[0]
    inserted: list[int] = []
    seen: list[int] = []
    cursor = None
    for i in range(5000):
        params: dict[str, Any] = {"limit": LIMIT_CAP}
        if cursor:
            params["cursor"] = cursor
        page = mk.get("/api/answers", params=params).json()
        ids = [a["id"] for a in page["answers"]]
        seen += ids
        if not ids:
            assert page["next_cursor"] is None and page["has_more"] is False
            break
        cursor = page["next_cursor"]
        if i < 3:
            r = submit(app_url, 1 + i, n, {q: f"{tok} {i} {q}" for q in (1, 2)})
            inserted += [a["id"] for a in r.json()["accepted"]]
    else:
        pytest.fail("archive paging never reached an empty page")
    assert seen == sorted(set(seen)), "archive pages repeated or reordered an answer"
    assert set(inserted) <= set(seen), "answers accepted during paging were skipped"
    assert set(seen) <= {a["id"] for a in archive_all(app_url)}
    assert all(a["round"] == n for a in mk.get("/api/answers", params={"round": n}).json()["answers"])


def test_archive_append_in_place(app_url: str, browser: Browser) -> None:
    closed_round(app_url)
    with signed(browser, app_url, MK, path="/archive") as page:
        arch = page.get_by_role("table", name="Answer archive")
        rows = rows_of(arch)
        eventually(page, lambda: rows.count() > 0, "archive first page")
        k = rows.count()
        probe_el(rows.first)
        more = page.get_by_role("button", name="More answers")
        more.scroll_into_view_if_needed()
        top = box(rows.first)["y"]
        y = page.evaluate("() => scrollY")
        more.click()
        eventually(page, lambda: rows.count() > k, "rows appended")
        assert kept(rows.first) and abs(box(rows.first)["y"] - top) <= PX_TOL and page.evaluate("() => scrollY") == y
        new = rows.nth(k)
        assert focused(new)
        advance(page, 2 * POLL_MS + MSG_MS)
        assert focused(new) and kept(rows.first) and page.evaluate("() => scrollY") == y
        page.set_viewport_size({"width": BP[0] - 1, "height": 800})
        cells = rows.first.get_by_role("cell")
        assert len({round(box(cells.nth(i))["y"]) for i in range(cells.count())}) > 1, "rows are not stacked cards below 600 px"
        assert all(w in shown_text(rows.first) for w in ARCHIVE_COLUMNS)


def test_archive_times_utc(app_url: str, browser: Browser) -> None:
    closed_round(app_url)
    api = desk(app_url, MK).get("/api/answers").json()["answers"]
    with signed(browser, app_url, MK, path="/archive", skew=True) as page:
        arch = page.get_by_role("table", name="Answer archive")
        eventually(page, lambda: rows_of(arch).count() >= len(api), "archive first page")
        assert arch.get_by_role("columnheader").evaluate_all("els => els.map(e => e.textContent.trim())") == ARCHIVE_COLUMNS
        for i, a in enumerate(api):
            row = rows_of(arch).nth(i).inner_text()
            assert a["submitted_at"][11:19] in row and a["text"] in row


def test_archive_tablet_columns(app_url: str, browser: Browser) -> None:
    closed_round(app_url)
    first = desk(app_url, MK).get("/api/answers").json()["answers"][0]
    five = [c for c in ARCHIVE_COLUMNS if c != "Time sent"]
    with signed(browser, app_url, MK, path="/archive") as page:
        arch = page.get_by_role("table", name="Answer archive")
        eventually(page, lambda: rows_of(arch).count() > 0, "archive first page")
        for width, want in ((BP[0], five), (BP[1] - 1, five), (BP[1], five), (BP[2] - 1, five),
                            (BP[2], ARCHIVE_COLUMNS), (BP[2] + 1, ARCHIVE_COLUMNS)):
            page.set_viewport_size({"width": width, "height": 900})
            heads = arch.get_by_role("columnheader").evaluate_all("els => els.map(e => e.textContent.trim())")
            assert heads == want, f"{width} px: archive column headers {heads} (L168, L181)"
            if want is five:
                lines = rows_of(arch).first.get_by_role("cell").nth(heads.index("Answer")).evaluate(
                    """(cell, [answer, sent]) => { const where = t => { const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
                        let n; while ((n = w.nextNode())) { const i = n.textContent.indexOf(t); if (i >= 0) {
                          const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
                          const b = r.getBoundingClientRect(); return [b.top, b.bottom]; } } return null; };
                      const a = where(answer), s = where(sent); return a && s ? [a[1], s[0]] : null; }""",
                    [first["text"], first["submitted_at"][11:19]])
                assert lines, f"{width} px: the Answer cell lacks the answer text or its time sent (L168)"
                assert lines[1] >= lines[0] - PX_TOL, f"{width} px: time sent is not on its own line below the answer (L168)"


def test_wf_archive_live_paging(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    tok = unique("live")[0]
    texts: list[str] = []
    with signed(browser, app_url, QM, path="/archive") as page:
        arch = page.get_by_role("table", name="Answer archive")
        more = page.get_by_role("button", name="More answers")
        for i in range(5000):
            if i < 4:
                t = f"{tok} {i}"
                assert submit(app_url, 2 + i, n, {3: t}).status_code == 201
                texts.append(t)
            before = rows_of(arch).count()
            more.click()
            eventually(page, lambda: rows_of(arch).count() > before or NO_NEWER in msgs(page).inner_text(), "page appended")
            if NO_NEWER in msgs(page).inner_text() and i >= 4:
                break
        else:
            pytest.fail("More answers never reached the end of the archive")
        shown = rows_of(arch).all_inner_texts()
        for t in texts:
            assert sum(t in s for s in shown) == 1, f"{t!r} shown {sum(t in s for s in shown)} times; expected once"
    assert all(t in [a["text"] for a in archive_all(app_url, n)] for t in texts)


def test_wf_archive_phone_cards(app_url: str, browser: Browser) -> None:
    closed_round(app_url)
    first = desk(app_url, MK).get("/api/answers").json()
    second = desk(app_url, MK).get("/api/answers", params={"cursor": first["next_cursor"]}).json()["answers"]
    with signed(browser, app_url, MK, path="/archive", size=(375, 812)) as page:
        arch = page.get_by_role("table", name="Answer archive")
        eventually(page, lambda: rows_of(arch).count() == len(first["answers"]), "first page")
        page.get_by_role("button", name="More answers").click()
        eventually(page, lambda: rows_of(arch).count() >= len(first["answers"]) + len(second), "second page")
        row = shown_text(rows_of(arch).nth(len(first["answers"])))
        assert second[0]["text"] in row and all(w in row for w in ARCHIVE_COLUMNS)
        layout(page)


def search(base: str, body: Any) -> httpx.Response:
    return desk(base, MK).post("/api/answers/search", json=body)


def test_search_matching(app_url: str) -> None:
    n = open_round(app_url)
    tok = unique("bj")[0]
    texts = {1: f"Björk-{tok}", 2: f"BJORK-{tok}", 3: f"bjo\u0301rk-{tok}", 4: f"Bjrk-{tok}",
             5: f"50%_off-{tok}", 6: f"50x_off-{tok}", 7: f"a.b\\c(d*-{tok}", 8: f"axbxcd-{tok}"}
    assert submit(app_url, 1, n, texts).status_code == 201
    res = search(app_url, {"query": f"bjork-{tok}"}).json()
    assert [a["text"] for a in res["answers"]] == [texts[1], texts[2], unicodedata.normalize("NFC", texts[3])]
    assert res["count"] == 3 and res["truncated"] is False
    assert [a["text"] for a in search(app_url, {"query": f"%_off-{tok}"}).json()["answers"]] == [texts[5]]
    assert search(app_url, {"query": f"50__off-{tok}"}).json()["count"] == 0
    assert search(app_url, {"query": f"%-{tok}"}).json()["count"] == 0
    assert [a["text"] for a in search(app_url, {"query": f"a.b\\c(d*-{tok}"}).json()["answers"]] == [texts[7]]
    assert search(app_url, {"query": f"bjork-{tok}", "round": n}).json()["count"] == 3
    assert search(app_url, {"query": f"bjork-{tok}", "round": n % 8 + 1}).json()["count"] == 0
    for team in FILL_TEAMS + [1, 2]:
        assert submit(app_url, team, n, {q: f"bulk-{tok}-{team}-{q}" for q in QUESTIONS}).status_code == 201
    big = search(app_url, {"query": f"BULK-{tok}"}).json()
    ids = [a["id"] for a in big["answers"]]
    assert big["count"] == SEARCH_CAP == len(ids) and big["truncated"] is True and ids == sorted(ids)


def test_search_bounds(app_url: str) -> None:
    assert search(app_url, {"query": FAMILY * 16}).status_code == 200
    assert fields(search(app_url, {"query": FAMILY * 16 + "a"})) == {"query": "too_long"}
    assert fields(search(app_url, {"query": "   "})) == {"query": "required"}
    assert fields(search(app_url, {})) == {"query": "required"}
    assert fields(search(app_url, {"query": 5})) == {"query": "invalid"}
    assert fields(search(app_url, {"query": "x", "round": 9})) == {"round": "invalid"}
    deep = {"query": "x", "a": {"b": {"c": {"d": {}}}}}
    assert fields(search(app_url, deep)) == {"body": "too_deep"}
    deep_bad = {"query": "", "a": [[[[1]]]]}
    assert fields(search(app_url, deep_bad)) == {"body": "too_deep"}
    ok = search(app_url, {"query": "x", "a": {"b": {"c": {}}}})
    assert not (ok.status_code == 422 and ok.json().get("fields", {}).get("body") == "too_deep")


@pytest.mark.parametrize("query", ["a" * QUERY_MAX, "(a+)+$" * 13 + "aa", "%_" * 40, "\\" * QUERY_MAX, FAMILY * 16],
                         ids=["repeat", "regex", "wildcards", "backslashes", "emoji"])
def test_search_time_budget(app_url: str, query: str) -> None:
    closed_round(app_url)
    started = time.monotonic()
    r = search(app_url, {"query": query})
    elapsed = time.monotonic() - started
    assert elapsed <= SEARCH_BUDGET_S + NET_SLACK_S, f"search took {elapsed:.2f}s; budget is {SEARCH_BUDGET_S}s"
    if r.status_code == 503:
        err(r, 503, "search_timeout")
    else:
        assert r.status_code == 200 and r.json()["count"] == len(r.json()["answers"])


def test_search_counter(app_url: str, browser: Browser) -> None:
    with signed(browser, app_url, MK, path="/archive") as page:
        sb = page.get_by_role("searchbox", name="Search answers")
        for value, count in COUNT_EXAMPLES + [(FAMILY * 16, QUERY_MAX)]:
            sb.fill(value)
            assert f"{count}/{QUERY_MAX}" in body_text(page), f"search counter for {value!r} should read {count}/{QUERY_MAX}"
        assert QUERY_OVER not in body_text(page)
        sb.fill(FAMILY * 16 + "a")
        assert f"{QUERY_MAX + 1}/{QUERY_MAX}" in body_text(page) and QUERY_OVER in body_text(page)
        with page.expect_response(lambda r: r.url.endswith("/api/answers/search")) as resp:
            page.get_by_role("button", name="Search").click()
        assert resp.value.status == 422 and resp.value.json()["fields"] == {"query": "too_long"}
        assert QUERY_OVER in body_text(page)


@pytest.mark.parametrize("width", [599, 600], ids=["599", "600"])
def test_search_bar_survives_timers(app_url: str, browser: Browser, width: int) -> None:
    n = open_round(app_url)
    tok = unique("bar")[0]
    submit(app_url, 3, n, {4: f"Häagen {tok}"})
    with signed(browser, app_url, MK, path="/archive", size=(width, 900)) as page:
        arch = page.get_by_role("table", name="Answer archive")
        eventually(page, lambda: rows_of(arch).count() > 0, "archive rows")
        probe_el(rows_of(arch).first)
        url = page.url
        sb = page.get_by_role("searchbox", name="Search answers")
        rnd = page.get_by_role("combobox", name="Round")
        go = page.get_by_role("button", name="Search")
        s, r_, g = box(sb), box(rnd), box(go)
        if width < BP[0]:
            assert r_["y"] >= s["y"] + s["height"] - PX_TOL and r_["y"] < g["y"] + g["height"] and g["y"] < r_["y"] + r_["height"]
        else:
            assert abs(s["y"] - r_["y"]) <= s["height"] and abs(r_["y"] - g["y"]) <= s["height"]
        sb.fill(f"haagen {tok}")
        sb.press("Enter")
        res = page.get_by_role("table", name="Search results")
        eventually(page, lambda: f"Häagen {tok}" in res.inner_text(), "results fill in place")
        expect(msgs(page)).to_have_text("Answers matching: 1.")
        probe_el(res)
        sb.evaluate("e => e.setSelectionRange(3, 3)")
        assert focused(sb) and page.url == url and kept(rows_of(arch).first)
        advance(page, 2 * POLL_MS + MSG_MS)
        assert sb.input_value() == f"haagen {tok}" and focused(sb) and kept(res) and f"Häagen {tok}" in res.inner_text()
        assert sb.evaluate("e => e.selectionStart") == 3 and kept(rows_of(arch).first)


def test_search_results_keyboard(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    tok = unique("kb")[0]
    assert submit(app_url, 3, n, {q: f"Kb{q} {tok}" for q in (1, 2, 3)}).status_code == 201
    with signed(browser, app_url, MK, path="/archive") as page:
        sb = page.get_by_role("searchbox", name="Search answers")
        sb.fill(tok)
        sb.press("Enter")
        res = page.get_by_role("table", name="Search results")
        rows = rows_of(res)
        eventually(page, lambda: rows.count() == 3, "three search results")
        sb.evaluate("e => e.setSelectionRange(2, 2)")
        for key, row in (("ArrowDown", 0), ("ArrowDown", 1), ("ArrowDown", 2), ("ArrowDown", 2), ("Home", 0),
                         ("ArrowUp", 0), ("End", 2), ("ArrowUp", 1)):
            page.keyboard.press(key)
            expect(rows.nth(row)).to_be_focused()
        page.keyboard.press("Escape")
        expect(sb).to_be_focused()
        assert sb.input_value() == tok and sb.evaluate("e => [e.selectionStart, e.selectionEnd]") == [2, 2]
        assert all(rows.nth(i).evaluate("e => e.tabIndex") < 0 for i in range(3)), "a result row is a Tab stop (L285)"


def test_wf_spelling_search(app_url: str, browser: Browser) -> None:
    n = open_round(app_url)
    tok = unique("sp")[0]
    variants = {1: f"Tchaikovsky {tok}", 2: f"TCHAÏKOVSKY {tok}", 3: f"tchaikovsky {tok}!"}
    submit(app_url, 4, n, variants)
    api = search(app_url, {"query": f"tchaikovsky {tok}"}).json()
    with signed(browser, app_url, MK, path="/archive") as page:
        page.get_by_role("searchbox", name="Search answers").fill(f"tchaikovsky {tok}")
        page.get_by_role("button", name="Search").click()
        expect(msgs(page)).to_have_text(f"Answers matching: {api['count']}.")
        res = page.get_by_role("table", name="Search results")
        for v in variants.values():
            assert v in res.inner_text()
    assert api["count"] == len(variants)


def test_wf_spelling_search_empty(app_url: str, browser: Browser) -> None:
    tok = unique("none")[0]
    with signed(browser, app_url, MK, path="/archive") as page:
        page.get_by_role("button", name="Search").click()
        expect(msgs(page)).to_have_text(EMPTY_SEARCH)
        page.get_by_role("searchbox", name="Search answers").fill(f"zz {tok}")
        page.get_by_role("searchbox", name="Search answers").press("Enter")
        expect(msgs(page)).to_have_text(NO_MATCH.format(q=f"zz {tok}"))
    assert search(app_url, {"query": f"zz {tok}"}).json()["count"] == 0


def test_raise_dispute(app_url: str) -> None:
    n = marked_round(app_url, 1, zero=2)
    a, b = free_zero(app_url, n, 1)[:2]
    c = desk(app_url, cap(1))
    assert fields(c.post("/api/disputes", json={"answer_id": a["id"], "reason": " "})) == {"reason": "required"}
    assert fields(c.post("/api/disputes", json={"answer_id": a["id"], "reason": "r" * (REASON_MAX + 1)})) == {"reason": "too_long"}
    assert fields(c.post("/api/disputes", json={"answer_id": "x", "reason": "r"})) == {"answer_id": "invalid"}
    reason = "\U0001F37A" * REASON_MAX
    d = raise_dispute(app_url, 1, a["id"], reason)
    assert (d["answer_id"], d["team_id"], d["round"], d["question"], d["answer_text"], d["reason"], d["status"], d["ruled_at"]) == (
        a["id"], 1, n, a["question"], a["text"], reason, "raised", None)
    err(c.post("/api/disputes", json={"answer_id": a["id"], "reason": "again"}), 409, "dispute_exists")
    one = next(x for x in answers_of(app_url, n, cap(1)) if x["mark"] == 1)
    err(c.post("/api/disputes", json={"answer_id": one["id"], "reason": "r"}), 409, "answer_not_marked_wrong")
    old = next(x for x in archive_all(app_url, n) if x["team_id"] == 1 and not x["current"])
    err(c.post("/api/disputes", json={"answer_id": old["id"], "reason": "r"}), 409, "answer_superseded")
    theirs = free_zero(app_url, n, 2)[0]
    err(c.post("/api/disputes", json={"answer_id": theirs["id"], "reason": "r"}), 403, "forbidden")
    err(c.post("/api/disputes", json={"answer_id": 999999999, "reason": "r"}), 404, "not_found")
    racers = [client(app_url, cap(1)) for _ in range(5)]
    res = race([lambda c_=c_: c_.post("/api/disputes", json={"answer_id": b["id"], "reason": "race"}) for c_ in racers])
    assert sorted(r.status_code for r in res) == [201, 409, 409, 409, 409]
    assert all(r.json()["error"] == "dispute_exists" for r in res if r.status_code == 409)
    mine = [x for x in c.get("/api/disputes").json()["disputes"] if x["answer_id"] in (a["id"], b["id"])]
    assert len(mine) == 2


def test_dispute_window(app_url: str) -> None:
    n = closed_round(app_url, team=2)
    a = next(x for x in answers_of(app_url, n, cap(2)) if x["current"])
    err(desk(app_url, cap(2)).post("/api/disputes", json={"answer_id": a["id"], "reason": "early"}), 409, "dispute_window_closed")
    short = app_url
    m = marked_round(short, 2)
    z = free_zero(short, m, 2)[0]
    clear_raised(short, m)
    assert desk(short, QM).post(f"/api/rounds/{m}/publish").status_code == 200
    err(desk(short, cap(2)).post("/api/disputes", json={"answer_id": z["id"], "reason": "late"}), 409, "dispute_window_closed")
    assert not [d for d in desk(short, cap(2)).get("/api/disputes").json()["disputes"] if d["answer_id"] == z["id"]]
    assert not [d for d in desk(app_url, cap(2)).get("/api/disputes").json()["disputes"] if d["answer_id"] == a["id"]]


def your_marks(page: Page) -> Locator:
    return page.get_by_role("region", name="Your marks")


def test_dispute_sheet_focus(app_url: str, browser: Browser) -> None:
    n = marked_round(app_url, 4, zero=2)
    zs = free_zero(app_url, n, 4)
    with signed(browser, app_url, cap(4), size=(375, 812), reduced_motion="reduce") as page:
        grp = your_marks(page).get_by_role("group", name=f"Round {n}")
        btns = grp.get_by_role("button", name=re.compile(r"^Dispute question \d$"))
        eventually(page, lambda: btns.count() >= 2, "dispute buttons")
        names = btns.all_inner_texts()
        q = int(re.search(r"\d", btns.first.get_attribute("aria-label") or names[0]).group())
        nxt = btns.nth(1).get_attribute("aria-label") or names[1]
        btns.first.click()
        sheet = page.get_by_role("dialog", name="Raise a dispute")
        rects, longest = path(page, sheet, PANE_MS)
        assert still(rects) and longest <= REDUCED_MS and not page.evaluate(MOVES_JS)
        reason = sheet.get_by_role("textbox", name="Reason")
        expect(reason).to_be_focused()
        assert tab_order(page, 3) == ["Send dispute", "Cancel", "Reason"]
        reason.fill(REASON_TEXT)
        reason.evaluate("e => e.setSelectionRange(4, 4)")
        assert f"{len(REASON_TEXT)}/{REASON_MAX}" in sheet.inner_text()
        advance(page, 2 * POLL_MS + MSG_MS)
        assert reason.input_value() == REASON_TEXT and focused(reason) and reason.evaluate("e => e.selectionStart") == 4
        sheet.get_by_role("button", name="Send dispute").click()
        expect(msgs(page)).to_have_text(DISPUTE_SENT)
        eventually(page, lambda: focused(page.get_by_role("button", name=nxt.strip())), "focus on next Dispute button", within_ms=PANE_MS * 2)
        probe_el(grp)
        y, top = page.evaluate("() => scrollY"), box(grp)["y"]
        d = next(x for x in desk(app_url, cap(4)).get("/api/disputes").json()["disputes"] if x["round"] == n and x["question"] == q and x["status"] == "raised")
        desk(app_url, QM).post(f"/api/disputes/{d['id']}/ruling", json={"ruling": "upheld"})
        eventually(page, lambda: "Upheld" in grp.inner_text(), "ruling shows in the row")
        assert kept(grp) and (page.evaluate("() => scrollY") == y or abs(box(grp)["y"] - top) <= PX_TOL)
        assert focused(page.get_by_role("button", name=nxt.strip()))
    assert len(zs) >= 2


@pytest.mark.timeout(600)
def test_dispute_window_from_server(browser: Browser) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    n = marked_round(short, 5, zero=2)
    zero = free_zero(short, n, 5)
    with signed(browser, short, cap(5), skew=True) as one, signed(browser, short, cap(5), skew=True) as two:
        g1 = your_marks(one).get_by_role("group", name=f"Round {n}")
        b1 = g1.get_by_role("button", name=re.compile(r"^Dispute question \d$"))
        eventually([one, two], lambda: b1.count() == len(zero), "one Dispute button per zero-marked answer")
        b1.first.focus()
        b2 = your_marks(two).get_by_role("group", name=f"Round {n}").get_by_role("button", name=re.compile(r"^Dispute question \d$"))
        b2.first.click()
        sheet = two.get_by_role("dialog", name="Raise a dispute")
        sheet.get_by_role("textbox", name="Reason").fill("stale screen")
        clear_raised(short, n)
        assert desk(short, QM).post(f"/api/rounds/{n}/publish").status_code == 200
        eventually([one, two], lambda: b1.count() == 0, "publish removes Dispute buttons")
        assert focused(your_marks(one)) and g1.count() == 1
        send = sheet.get_by_role("button", name="Send dispute")
        send.click()
        expect(msgs(two)).to_have_text(f"Disputes for round {n} are closed.")
        assert sheet.count() == 1 and focused(send)
    assert not [d for d in desk(short, cap(5)).get("/api/disputes").json()["disputes"] if d["reason"] == "stale screen"]


def test_wf_disputes_phone(app_url: str, browser: Browser) -> None:
    n = marked_round(app_url, 3)
    with signed(browser, app_url, cap(3), size=(375, 812)) as page:
        grp = your_marks(page).get_by_role("group", name=f"Round {n}")
        btn = grp.get_by_role("button", name=re.compile(r"^Dispute question \d$")).first
        eventually(page, lambda: btn.count() == 1, "Dispute button")
        label = btn.get_attribute("aria-label") or btn.inner_text()
        q = int(re.search(r"\d", label).group())
        tap_el(page, btn)
        sheet = page.get_by_role("dialog", name="Raise a dispute")
        settle_pane(page)
        sheet.get_by_role("textbox", name="Reason").fill(ACCEPTED_REASON)
        tap_el(page, sheet.get_by_role("button", name="Send dispute"))
        expect(msgs(page)).to_have_text(DISPUTE_SENT)
        eventually(page, lambda: "Raised" in grp.inner_text() and grp.get_by_role("button", name=f"Dispute question {q}").count() == 0,
                   "row shows Raised without its Dispute button")
    assert any(d["round"] == n and d["question"] == q and d["status"] == "raised" and d["reason"] == ACCEPTED_REASON
               for d in desk(app_url, cap(3)).get("/api/disputes").json()["disputes"])


def test_wf_disputes_empty_reason(app_url: str, browser: Browser) -> None:
    n = marked_round(app_url, 3)
    before = len(desk(app_url, cap(3)).get("/api/disputes").json()["disputes"])
    with signed(browser, app_url, cap(3), size=(375, 812)) as page:
        btn = your_marks(page).get_by_role("group", name=f"Round {n}").get_by_role("button", name=re.compile(r"^Dispute question \d$")).first
        eventually(page, lambda: btn.count() == 1, "Dispute button")
        btn.click()
        sheet = page.get_by_role("dialog", name="Raise a dispute")
        settle_pane(page)
        send = sheet.get_by_role("button", name="Send dispute")
        send.click()
        expect(msgs(page)).to_have_text(REASON_EMPTY)
        assert sheet.count() == 1 and focused(send)
    assert len(desk(app_url, cap(3)).get("/api/disputes").json()["disputes"]) == before


def test_rulings(app_url: str) -> None:
    n = marked_round(app_url, 6, zero=3)
    a, b, c_ = free_zero(app_url, n, 6)[:3]
    qm = desk(app_url, QM)
    d = raise_dispute(app_url, 6, a["id"])
    assert fields(qm.post(f"/api/disputes/{d['id']}/ruling", json={"ruling": "maybe"})) == {"ruling": "invalid"}
    err(qm.post("/api/disputes/999999999/ruling", json={"ruling": "upheld"}), 404, "not_found")
    r = qm.post(f"/api/disputes/{d['id']}/ruling", json={"ruling": "upheld"})
    assert r.status_code == 200 and r.json()["dispute"]["status"] == "upheld" and r.json()["dispute"]["ruled_at"]
    row = next(x for x in answers_of(app_url, n) if x["id"] == a["id"])
    assert (row["ruled"], row["mark"], row["text"]) == (1, 0, a["text"])
    err(qm.post(f"/api/disputes/{d['id']}/ruling", json={"ruling": "dismissed"}), 409, "dispute_already_ruled")
    d2 = raise_dispute(app_url, 6, b["id"])
    assert qm.post(f"/api/disputes/{d2['id']}/ruling", json={"ruling": "dismissed"}).json()["dispute"]["status"] == "dismissed"
    assert next(x for x in answers_of(app_url, n) if x["id"] == b["id"])["ruled"] == 0
    d3 = raise_dispute(app_url, 6, c_["id"])
    racers = [client(app_url, QM) for _ in range(5)]
    res = race([lambda q_=q_: q_.post(f"/api/disputes/{d3['id']}/ruling", json={"ruling": "upheld"}) for q_ in racers])
    assert sorted(x.status_code for x in res) == [200, 409, 409, 409, 409]
    assert all(x.json()["error"] == "dispute_already_ruled" for x in res if x.status_code == 409)


def ruling_mail(mail: Mailpit, answer_text: str, expected: int = 1) -> list[dict]:
    return [m for m in mail.messages(expected=expected) if f"Your answer: {answer_text}" in text(m)]


def test_ruling_note_email(app_url: str, mail: Mailpit) -> None:
    n = marked_round(app_url, 7, zero=2)
    title = round_of(app_url, n)["title"]
    for a, ruling, word in zip(free_zero(app_url, n, 7)[:2], ("upheld", "dismissed"), ("Upheld", "Dismissed")):
        d = raise_dispute(app_url, 7, a["id"])
        assert desk(app_url, QM).post(f"/api/disputes/{d['id']}/ruling", json={"ruling": ruling}).status_code == 200
        deadline = time.monotonic() + REAL_S
        while dispute_by_id(app_url, d["id"])["note"] != "sent":
            if time.monotonic() > deadline:
                pytest.fail("dispute note never became sent; expected it once Mailpit accepted the message (L792)")
        got = ruling_mail(mail, a["text"])
        assert len(got) == 1, f"{len(got)} notes for one ruling; expected exactly one"
        m = got[0]
        assert addresses(m["To"]) == [SEED[7][1]] and addresses(m["From"]) == [mail_from_address()]
        assert "Roundkeeper" in json.dumps(m["From"]) and m["Subject"] == f"Ruling on round {n}, question {a['question']}"
        lines = [ln.strip() for ln in text(m).strip().splitlines() if ln.strip()]
        assert lines == [f"Round {n}: {title}", f"Question: {a['question']}", f"Your answer: {a['text']}", f"Ruling: {word}"]


@pytest.mark.timeout(600)
def test_note_queued_while_mail_down(mail: Mailpit) -> None:
    down = env_url("APP_MAILPIT_DOWN_URL")
    n = marked_round(down, 7)
    a = free_zero(down, n, 7)[0]
    d = raise_dispute(down, 7, a["id"])
    r = desk(down, QM).post(f"/api/disputes/{d['id']}/ruling", json={"ruling": "upheld"})
    assert r.status_code == 200 and r.json()["dispute"]["note"] == "queued"
    pace(down, 25)
    assert dispute_by_id(down, d["id"])["note"] == "queued"
    assert next(x for x in answers_of(down, n) if x["id"] == a["id"])["ruled"] == 1
    assert ruling_mail(mail, a["text"], expected=0) == []


def test_ruling_dialog_keyboard(app_url: str, browser: Browser) -> None:
    n = marked_round(app_url, 8)
    a = free_zero(app_url, n, 8)[0]
    d = raise_dispute(app_url, 8, a["id"])
    label = f"Rule on {team_name(app_url, 8)}, round {n}, question {a['question']}"
    with signed(browser, app_url, QM) as page:
        opener = page.get_by_role("button", name=label)
        eventually(page, lambda: opener.count() == 1, "dispute in queue")
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Rule on dispute")
        up, dis = dlg.get_by_role("radio", name="Uphold"), dlg.get_by_role("radio", name="Dismiss")
        expect(up).to_be_focused()
        assert a["text"] in dlg.inner_text()
        dlg.get_by_role("button", name="Save ruling").focus()
        page.keyboard.press("d")
        assert dis.is_checked()
        dlg.get_by_role("button", name="Cancel").focus()
        page.keyboard.press("U")
        assert up.is_checked()
        for combo in ("Control+d", "Meta+d", "Alt+d"):
            page.keyboard.press(combo)
        assert up.is_checked()
        up.focus()
        assert tab_order(page, 3)[:2] == ["Save ruling", "Cancel"] and holds_focus(dlg.get_by_role("radiogroup", name="Ruling"))
        page.keyboard.press("Shift+Tab")
        expect(dlg.get_by_role("button", name="Cancel")).to_be_focused()
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(opener), "Escape returns to Rule on button", within_ms=PANE_MS * 2)
        opener.press("Enter")
        dlg.get_by_role("button", name="Cancel").press("Enter")
        eventually(page, lambda: focused(opener), "Cancel returns to Rule on button", within_ms=PANE_MS * 2)
    assert dispute_by_id(app_url, d["id"])["status"] == "raised"


def test_ruling_focus_live_queue(app_url: str, browser: Browser) -> None:
    n = marked_round(app_url, 11, zero=2)
    a, b = free_zero(app_url, n, 11)[:2]
    d1, d2 = raise_dispute(app_url, 11, a["id"]), raise_dispute(app_url, 11, b["id"])
    name = team_name(app_url, 11)
    lab = lambda x: f"Rule on {name}, round {n}, question {x['question']}"
    queue = [x["id"] for x in desk(app_url, QM).get("/api/disputes").json()["disputes"] if x["status"] == "raised"]
    after = queue[(queue.index(d1["id"]) + 1) % len(queue)]
    with signed(browser, app_url, QM) as one, signed(browser, app_url, QM) as two:
        eventually([one, two], lambda: one.get_by_role("button", name=lab(a)).count() == 1, "queue shows dispute")
        two.get_by_role("button", name=lab(a)).click()
        one.get_by_role("button", name=lab(a)).focus()
        one.keyboard.press("Enter")
        one.keyboard.press("u")
        one.keyboard.press("Tab")
        one.keyboard.press("Enter")
        expect(msgs(one)).to_have_text(RULING_SAVED)
        nxt = dispute_by_id(app_url, after)
        want = f"Rule on {team_name(app_url, nxt['team_id'])}, round {nxt['round']}, question {nxt['question']}"
        eventually(one, lambda: focused(one.get_by_role("button", name=want)), "focus on following Rule on button", within_ms=PANE_MS * 2)
        dlg2 = two.get_by_role("dialog", name="Rule on dispute")
        eventually(two, lambda: two.get_by_role("button", name=lab(a)).count() == 0, "ruled dispute leaves queue on second device")
        assert dlg2.count() == 1
        dlg2.get_by_role("button", name="Save ruling").click()
        expect(msgs(two)).to_have_text(ALREADY_RULED)
    assert dispute_by_id(app_url, d1["id"])["status"] == "upheld" and dispute_by_id(app_url, d2["id"])["status"] == "raised"


def test_dispute_ruled_copy(app_url: str, browser: Browser) -> None:
    n = marked_round(app_url, 9)
    a = free_zero(app_url, n, 9)[0]
    d = raise_dispute(app_url, 9, a["id"])
    with signed(browser, app_url, cap(9)) as page:
        pub = page.context.new_page()
        pub.goto(app_url + "/")
        desk(app_url, QM).post(f"/api/disputes/{d['id']}/ruling", json={"ruling": "dismissed"})
        want = ruled_copy("dismissed", n, a["question"])
        eventually([page, pub], lambda: want in msgs(page).inner_text() and want in msgs(pub).inner_text(), "dispute-ruled copy")
        assert "Dismissed" in your_marks(page).get_by_role("group", name=f"Round {n}").inner_text()


def test_wf_rulings_keyboard_uphold(app_url: str, browser: Browser, mail: Mailpit) -> None:
    n = marked_round(app_url, 10)
    a = free_zero(app_url, n, 10)[0]
    d = raise_dispute(app_url, 10, a["id"])
    with signed(browser, app_url, QM) as page:
        btn = page.get_by_role("button", name=f"Rule on {team_name(app_url, 10)}, round {n}, question {a['question']}")
        eventually(page, lambda: btn.count() == 1, "queue shows dispute")
        tab_to(page, btn)
        page.keyboard.press("Enter")
        page.keyboard.press("u")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        expect(msgs(page)).to_have_text(RULING_SAVED)
    assert dispute_by_id(app_url, d["id"])["status"] == "upheld"
    assert next(x for x in answers_of(app_url, n) if x["id"] == a["id"])["ruled"] == 1
    got = ruling_mail(mail, a["text"])
    assert len(got) == 1 and addresses(got[0]["To"]) == [SEED[10][1]] and "Ruling: Upheld" in text(got[0])


def test_wf_rulings_keyboard_dismiss(app_url: str, browser: Browser, mail: Mailpit) -> None:
    n = marked_round(app_url, 10)
    a = free_zero(app_url, n, 10)[0]
    d = raise_dispute(app_url, 10, a["id"])
    with signed(browser, app_url, QM) as page:
        btn = page.get_by_role("button", name=f"Rule on {team_name(app_url, 10)}, round {n}, question {a['question']}")
        eventually(page, lambda: btn.count() == 1, "queue shows dispute")
        btn.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("D")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        expect(msgs(page)).to_have_text(RULING_SAVED)
    assert dispute_by_id(app_url, d["id"])["status"] == "dismissed"
    got = ruling_mail(mail, a["text"])
    assert len(got) == 1 and "Ruling: Dismissed" in text(got[0])


def test_publish_guard() -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    n = marked_round(short, 6)
    raise_dispute(short, 6, free_zero(short, n, 6)[0]["id"])
    raised = sum(1 for d in desk(short, QM).get("/api/disputes").json()["disputes"] if d["round"] == n and d["status"] == "raised")
    err(desk(short, QM).post(f"/api/rounds/{n}/publish"), 409, "disputes_pending", count=raised)
    assert round_of(short, n)["status"] == "marked"
    clear_raised(short, n)
    version = table(short)["version"]
    racers = [client(short, QM) for _ in range(5)]
    res = race([lambda q_=q_: q_.post(f"/api/rounds/{n}/publish") for q_ in racers])
    assert sorted(r.status_code for r in res) == [200, 409, 409, 409, 409]
    assert all(r.json()["error"] == "round_not_marked" for r in res if r.status_code == 409)
    win = next(r for r in res if r.status_code == 200).json()
    assert win["round"]["status"] == "published" and win["table"]["version"] == version + 1 == table(short)["version"]


def test_league_derivation(app_url: str) -> None:
    t = table(app_url)
    published = [r["number"] for r in rounds(app_url) if r["status"] == "published"]
    totals = {i: SEED[i][2] for i in TEAMS}
    scores: dict[int, dict[int, int]] = {}
    for n in published:
        scores[n] = {i: 0 for i in TEAMS}
        for a in answers_of(app_url, n, QM):
            scores[n][a["team_id"]] += a["ruled"] or 0
            totals[a["team_id"]] += a["ruled"] or 0
    names = {x["team_id"]: x["name"] for x in t["teams"]}
    order = sorted(TEAMS, key=lambda i: (-totals[i], names[i]))
    assert [x["team_id"] for x in t["teams"]] == order
    assert [x["position"] for x in t["teams"]] == list(range(1, len(TEAMS) + 1))
    assert all(x["total"] == totals[x["team_id"]] for x in t["teams"])
    assert t["night"] == NIGHT
    if published:
        assert t["last_published_round"] in published
        assert all(x["last_round"] == {"round": t["last_published_round"], "score": scores[t["last_published_round"]][x["team_id"]]} for x in t["teams"])
    else:
        assert t["last_published_round"] is None and all(x["last_round"] is None for x in t["teams"])


def tile_total(page: Page, name: str) -> int | None:
    m = re.search(r"(\d+) pts", tile(page, name).inner_text())
    return int(m.group(1)) if m else None


@pytest.mark.timeout(600)
def test_tally_cascade(browser: Browser) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    n = marked_round(short, 1)
    clear_raised(short, n)
    old = table(short)
    with public(browser, short, "/") as page:
        eventually(page, lambda: tiles(page).count() == len(TEAMS), "tiles")
        focus_name = old["teams"][4]["name"]
        tile(page, focus_name).focus()
        y = page.evaluate("() => scrollY")
        before_news = news(page).inner_text()
        new = desk(short, QM).post(f"/api/rounds/{n}/publish").json()["table"]
        gainer = max(new["teams"], key=lambda x: x["total"] - next(o["total"] for o in old["teams"] if o["team_id"] == x["team_id"]))
        old_total = next(o["total"] for o in old["teams"] if o["team_id"] == gainer["team_id"])
        eventually(page, lambda: page.evaluate(DURATIONS_JS) or f"Round {n}:" in tiles(page).first.inner_text()
                   or tile_total(page, gainer["name"]) != old_total, "cascade starts")
        assert news(page).inner_text() == before_news, "Table news changed before the cascade settled"
        moved, between, settled_at = False, False, None
        copy = news_copy(n, new["teams"][0]["name"], new["teams"][0]["total"])
        for step in range(int((CASCADE_MS + PANE_MS) / 50)):
            moved = moved or bool(page.evaluate(DURATIONS_JS)) or bool(tiles(page).first.evaluate(TRANSFORMS_JS))
            shown = tile_total(page, gainer["name"])
            between = between or (shown is not None and old_total < shown < gainer["total"])
            if copy in news(page).inner_text():
                settled_at = step * 50
                break
            advance(page, 50)
        assert settled_at is not None and settled_at <= CASCADE_MS, f"news announced at {settled_at} ms; expected after settling within {CASCADE_MS} ms"
        assert moved, "no tile turned or slid"
        assert between or gainer["total"] - old_total < 2, "totals did not count up"
        for t in new["teams"]:
            assert f"{t['total']} pts" in tile(page, t["name"]).inner_text() and f"Round {n}: {t['last_round']['score']}" in tile(page, t["name"]).inner_text()
        tops = [(round(box(tile(page, t["name"]))["y"]), box(tile(page, t["name"]))["x"]) for t in new["teams"]]
        assert tops == sorted(tops), "tile order does not match the server table"
        assert focused(tile(page, focus_name)) and page.evaluate("() => scrollY") == y


@pytest.mark.timeout(600)
def test_cascade_reduced_motion_first_frame(browser: Browser) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    n = marked_round(short, 2)
    clear_raised(short, n)
    with public(browser, short, "/", reduced_motion="reduce") as page:
        eventually(page, lambda: tiles(page).count() == len(TEAMS), "tiles")
        new = desk(short, QM).post(f"/api/rounds/{n}/publish").json()["table"]
        eventually(page, lambda: f"Round {n}:" in tiles(page).first.inner_text(), "publish reaches the table")
        assert news(page).inner_text().strip() == news_copy(n, new["teams"][0]["name"], new["teams"][0]["total"])
        for t in new["teams"]:
            assert f"{t['total']} pts" in tile(page, t["name"]).inner_text()
        tops = [(round(box(tile(page, t["name"]))["y"]), box(tile(page, t["name"]))["x"]) for t in new["teams"]]
        assert tops == sorted(tops)
        assert all(d <= REDUCED_MS for d in page.evaluate(DURATIONS_JS))


@pytest.mark.timeout(600)
def test_publish_still_every_layer(browser: Browser) -> None:
    short = env_url("APP_ROUND_SHORT_URL")
    n = marked_round(short, 3)
    clear_raised(short, n)
    with public(browser, short, "/", reduced_motion="reduce") as pub, \
            signed(browser, short, cap(3), reduced_motion="reduce") as cpg, \
            signed(browser, short, QM, reduced_motion="reduce") as qpg:
        pages = [pub, cpg, qpg]
        eventually(pages, lambda: all(tiles(p).count() == len(TEAMS) for p in pages), "tiles on every page")
        sizes = [[(box(tiles(p).nth(i))["width"], box(tiles(p).nth(i))["height"]) for i in range(len(TEAMS))] for p in pages]
        desk(short, QM).post(f"/api/rounds/{n}/publish")
        eventually(pages, lambda: all(f"Round {n}:" in tiles(p).first.inner_text() for p in pages), "publish on every page")
        for _ in range(int((FLIP_MS + SLIDE_MS) / 50)):
            for p, sz in zip(pages, sizes):
                grid = p.get_by_role("list", name="League table")
                strip = p.get_by_role("list", name="Rounds tonight")
                assert not grid.evaluate(TRANSFORMS_JS) and not strip.evaluate(TRANSFORMS_JS)
                assert all(d <= REDUCED_MS for d in p.evaluate(DURATIONS_JS)) and not p.evaluate(MOVES_JS)
                assert [(box(tiles(p).nth(i))["width"], box(tiles(p).nth(i))["height"]) for i in range(len(TEAMS))] == sz
                advance(p, 50)


def test_wf_publish_keyboard(app_url: str, browser: Browser) -> None:
    n = marked_round(app_url, 1)
    clear_raised(app_url, n)
    version = table(app_url)["version"]
    with signed(browser, app_url, QM) as page, public(browser, app_url, "/") as pub, signed(browser, app_url, cap(2)) as cpg:
        btn = page.get_by_role("button", name=f"Publish round {n}")
        eventually(page, lambda: btn.count() == 1, "Publish button on the marked card")
        tab_to(page, btn)
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(page.get_by_role("article", name=f"Round {n}")), "focus on the round card", within_ms=PANE_MS)
        t = table(app_url)
        copy = news_copy(n, t["teams"][0]["name"], t["teams"][0]["total"])
        for p in (pub, cpg):
            eventually(p, lambda p=p: copy in news(p).inner_text(), "Table news announces the publish",
                       within_ms=POLL_MS + CASCADE_MS + STEP_MS)
            for x in t["teams"]:
                assert f"{x['total']} pts" in tile(p, x["name"]).inner_text()
    assert round_of(app_url, n)["status"] == "published" and t["version"] == version + 1 and t["last_published_round"] == n


def test_wf_publish_disputes_open(app_url: str, browser: Browser) -> None:
    n = marked_round(app_url, 5)
    raise_dispute(app_url, 5, free_zero(app_url, n, 5)[0]["id"])
    count = sum(1 for d in desk(app_url, QM).get("/api/disputes").json()["disputes"] if d["round"] == n and d["status"] == "raised")
    with signed(browser, app_url, QM) as page:
        btn = page.get_by_role("button", name=f"Publish round {n}")
        eventually(page, lambda: btn.count() == 1, "Publish button")
        btn.focus()
        page.keyboard.press("Enter")
        expect(msgs(page)).to_have_text(f"Open disputes left on round {n}: {count}. Rule on them before publishing.")
        assert focused(btn)
    assert round_of(app_url, n)["status"] == "marked"


def test_api_surface(app_url: str) -> None:
    for p in ("/api/nope", "/api/debug", "/api/reset", "/api/seed", "/api/admin", "/api/rounds/1/reopen"):
        err(httpx.get(app_url + p, timeout=HTTP_S), 404, "not_found")
    for method, p, allow in [("DELETE", "/api/rounds", {"GET", "HEAD"}), ("PUT", "/api/session", {"POST", "GET", "DELETE", "HEAD"}),
                             ("GET", "/api/rounds/1/open", {"POST"}), ("POST", "/api/table", {"GET", "HEAD"}),
                             ("DELETE", "/api/rounds/1/sheet", {"PUT", "GET", "HEAD"}), ("GET", "/api/teams/1", {"PATCH"})]:
        r = httpx.request(method, app_url + p, timeout=HTTP_S)
        err(r, 405, "method_not_allowed")
        assert {m.strip() for m in r.headers["Allow"].split(",")} == allow
    assert httpx.head(app_url + "/api/rounds", timeout=HTTP_S).status_code == 200
    mk = desk(app_url, MK)
    err(mk.post("/api/answers/search", content=b"query=x", headers={"Content-Type": "application/x-www-form-urlencoded"}), 415, "unsupported_media_type")
    err(desk(app_url, cap(1)).patch("/api/teams/1", content=b"name", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    ok = mk.post("/api/answers/search", content=b'{"query":"x"}', headers={"Content-Type": "application/json; charset=utf-8"})
    assert ok.status_code == 200
    cors = httpx.get(app_url + "/api/table", headers={"Origin": "https://elsewhere.example"}, timeout=HTTP_S)
    assert not [h for h in cors.headers if h.lower().startswith("access-control-")]


def test_error_precedence(app_url: str) -> None:
    anon, c1, qm = client(app_url), desk(app_url, cap(1)), desk(app_url, QM)
    err(anon.post("/api/disputes", content=b"x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    err(anon.post("/api/session", content=b"{bad", headers={"Content-Type": "application/json"}), 400, "bad_json")
    big = json.dumps({"code": "nope", "pad": "p" * JSON_MAX})
    err(anon.post("/api/session", content=big.encode(), headers={"Content-Type": "application/json"}), 413, "too_large")
    edge = '{"code":"nope","pad":"' + "p" * (JSON_MAX - len('{"code":"nope","pad":""}')) + '"}'
    assert len(edge.encode()) == JSON_MAX
    err(anon.post("/api/session", content=edge.encode(), headers={"Content-Type": "application/json"}), 401, "bad_code")
    err(anon.post(f"/api/rounds/{UNKNOWN_ROUND}/open"), 401, "signed_out")
    err(c1.post(f"/api/rounds/{UNKNOWN_ROUND}/open"), 404, "not_found")
    err(c1.post("/api/rounds/1/open"), 403, "forbidden")
    err(qm.post("/api/rounds/1/answers", json={"answers": []}), 403, "forbidden")
    p = next((r["number"] for r in rounds(app_url) if r["status"] == "drafted"), None)
    assert p, "a drafted round is needed to probe state-before-validation"
    err(c1.post(f"/api/rounds/{p}/answers", json={"answers": []}, headers={"Idempotency-Key": "x" * (KEY_MAX + 1)}), 409, "round_not_open")
    body = fields(c1.patch("/api/teams/1", json={"name": ""}))
    assert body == {"name": "required"}
    for r in (anon.get("/api/session"), c1.get("/api/answers")):
        assert set(r.json()) == {"error"}


def test_health_and_manifest(app_url: str) -> None:
    r = httpx.get(app_url + "/api/health", timeout=HTTP_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"} and r.headers["content-type"].startswith("application/json")
    page = httpx.get(app_url + "/", timeout=HTTP_S)
    assert page.status_code == 200 and page.content
    manifest = json.loads((DEPLOYED_APP / "run.json").read_text())
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_seed_on_serve() -> None:
    fresh = env_url("APP_MAILPIT_DOWN_URL")
    t = table(fresh)
    assert t["night"] == NIGHT and t["version"] == 1
    assert sorted((x["team_id"], x["name"], x["total"]) for x in t["teams"]) == [(i, SEED[i][0], SEED[i][2]) for i in TEAMS]
    by_pos = {x["position"]: x["name"] for x in t["teams"]}
    assert by_pos[3] == SEED[3][0] and by_pos[4] == SEED[4][0]
    rs = rounds(fresh)
    assert [(r["number"], r["title"], r["kind"]) for r in rs] == [(n, *ROUNDS[n]) for n in range(1, ROUND_COUNT + 1)]
    assert all((r["sheet"] is None) == (r["kind"] == "standard") for r in rs)
    for code in [QM, MK] + [cap(i) for i in TEAMS]:
        r = client(fresh).post("/api/session", json={"code": code})
        assert r.status_code == 201 and r.json()["role"] == role_of(code)


@pytest.mark.parametrize("size", [(375, 812), (768, 1024), (1280, 800)], ids=["375x812", "768x1024", "1280x800"])
def test_responsive_layout(app_url: str, browser: Browser, size: tuple[int, int]) -> None:
    width = size[0]
    rows_, cols = (2, 2) if width < BP[0] else (1, 3) if width < BP[2] else (1, 4)
    with public(browser, app_url, "/", size=size) as page:
        layout(page)
        assert len({round(box(chips(page).nth(i))["y"]) for i in range(ROUND_COUNT)}) == rows_
        assert len({round(box(tiles(page).nth(i))["x"]) for i in range(len(TEAMS))}) == cols
        page.goto(app_url + "/sign-in")
        layout(page)
    for code, paths in ((QM, ["/quizmaster", "/archive"]), (MK, ["/marker"]), (cap(2), ["/captain"])):
        with signed(browser, app_url, code, size=size) as page:
            for p in paths:
                page.goto(app_url + p)
                layout(page)


def test_breakpoints_exact(app_url: str, browser: Browser) -> None:
    widths = [w + d for w in BP for d in (-1, 0, 1)]
    with public(browser, app_url, "/") as page:
        for w in widths:
            page.set_viewport_size({"width": w, "height": 900})
            layout(page)
            cols = 2 if w < BP[0] else 3 if w < BP[2] else 4
            assert len({round(box(tiles(page).nth(i))["x"]) for i in range(len(TEAMS))}) == cols, f"tile columns at {w}"
            assert len({round(box(chips(page).nth(i))["y"]) for i in range(ROUND_COUNT)}) == (2 if w < BP[0] else 1)
    with signed(browser, app_url, QM) as page:
        for w in widths:
            page.set_viewport_size({"width": w, "height": 900})
            layout(page)
            cards = [box(page.get_by_role("article", name=f"Round {n}")) for n in range(1, ROUND_COUNT + 1)]
            region = box(page.get_by_role("region", name="Disputes"))
            if w < BP[2]:
                assert len({round(c["x"]) for c in cards}) == (1 if w < BP[0] else 2), f"card columns at {w}"
            if w < BP[2]:
                assert region["y"] >= max(c["y"] + c["height"] for c in cards) - PX_TOL
            else:
                assert region["x"] >= max(c["x"] + c["width"] for c in cards) - PX_TOL and region["y"] < cards[-1]["y"]
        page.goto(app_url + "/archive")
        arch = page.get_by_role("table", name="Answer archive")
        eventually(page, lambda: rows_of(arch).count() > 0, "archive rows")
        for w in widths:
            page.set_viewport_size({"width": w, "height": 900})
            layout(page)
            cells = rows_of(arch).first.get_by_role("cell")
            stacked = len({round(box(cells.nth(i))["y"]) for i in range(cells.count())}) > 1
            assert stacked == (w < BP[0]), f"archive rows at {w}"
    with signed(browser, app_url, cap(2)) as page:
        for w in widths:
            page.set_viewport_size({"width": w, "height": 900})
            page.get_by_role("button", name="Rename team").click()
            dlg = page.get_by_role("dialog", name="Rename team")
            page.evaluate(FINISH_JS)
            want = w if w < BP[1] else max(PANE_MIN_W, w / 2)
            assert abs(box(dlg)["width"] - want) <= PX_TOL, f"rename width at {w}"
            page.keyboard.press("Escape")
            advance(page, PANE_MS * 2)
            page.evaluate(FINISH_JS)


def test_pane_and_press_motion(app_url: str, browser: Browser) -> None:
    with signed(browser, app_url, cap(3), size=(1280, 800)) as page:
        page.get_by_role("button", name="Rename team").click()
        rects, longest = enter_path(page, page.get_by_role("dialog", name="Rename team"), PANE_MS)
        assert rects[0][0] >= 1280 - PX_TOL and abs(rects[-1][0] + rects[-1][2] - 1280) <= PX_TOL
        assert all(b[0] <= a[0] + 0.5 for a, b in zip(rects, rects[1:]))
        assert longest == 0 or abs(longest - PANE_MS) <= TIMING_TOL_MS
        page.keyboard.press("Escape")
        advance(page, PANE_MS * 2)
        page.evaluate(FINISH_JS)
        t = tiles(page).first
        rest, hover = state_styles(t, RULE_PROP, state="hover")
        assert rest[RULE_PROP] == f"{INK_RULE_PX}px" and hover[RULE_PROP] == f"{HOVER_RULE_PX}px"
        b = box(page.get_by_role("button", name="Rename team"))
        page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        page.mouse.down()
        pressed, dur = path(page, page.get_by_role("button", name="Rename team"), PRESS_MS)
        assert abs(pressed[-1][1] - b["y"] - 1) <= 0.5 and (dur == 0 or abs(dur - PRESS_MS) <= TIMING_TOL_MS)
        page.mouse.up()
        assert not page.evaluate(LOOPS_JS)
    with signed(browser, app_url, cap(3), size=(375, 812)) as page:
        page.get_by_role("button", name="Rename team").click()
        rects, _ = enter_path(page, page.get_by_role("dialog", name="Rename team"), PANE_MS)
        assert rects[0][1] >= 812 - PX_TOL and abs(rects[-1][1]) <= PX_TOL
        assert all(b_[1] <= a_[1] + 0.5 for a_, b_ in zip(rects, rects[1:]))


def test_not_found_page(app_url: str, browser: Browser) -> None:
    for p in ("/no-such-page", "/run.json", "/package.json", "/package-lock.json", "/.env", "/src", "/tsconfig.json"):
        r = httpx.get(app_url + p, timeout=HTTP_S)
        assert r.status_code == 404, f"{p} answered {r.status_code}; expected 404"
    with public(browser, app_url, "/no-such-page") as page:
        expect(page.get_by_role("heading", level=1)).to_have_text(NOT_FOUND)
        expect(page.get_by_role("banner")).to_be_visible()


def axe_contrast(page: Page) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate("""options => { const result = {done: false, error: null, violations: []};
        Object.defineProperty(window, '__VERIFIER_CONTRAST__', {value: () => structuredClone(result), configurable: true});
        axe.run(document, options).then(v => { result.violations = v.violations.map(x => ({id: x.id, nodes: x.nodes.map(n => n.target)}));
          result.done = true; }, e => { result.error = String(e); result.done = true; }); }""",
                  {"runOnly": {"type": "rule", "values": ["color-contrast"]}})
    for _ in range(AXE_POLLS):
        status = page.evaluate("window.__VERIFIER_CONTRAST__()")
        if status["done"]:
            assert status["error"] is None, status["error"]
            assert not status["violations"], f"contrast violations (L319): {status['violations']}"
            return
        advance(page, FRAME_MS)
    raise AssertionError("axe contrast audit did not settle under controlled time")


@pytest.mark.parametrize("size", [(375, 812), (768, 1024), (1280, 800)], ids=["375x812", "768x1024", "1280x800"])
def test_contrast_targets_focus(app_url: str, browser: Browser, size: tuple[int, int]) -> None:
    with signed(browser, app_url, cap(4), size=size) as page:
        for p in ("/captain", "/"):
            page.goto(app_url + p)
            axe_contrast(page)
            for role in ("button", "link", "textbox", "searchbox", "combobox", "radio"):
                for el in page.get_by_role(role).all():
                    if el.is_visible():
                        b = box(el)
                        assert b["width"] >= MIN_TARGET - 0.5 and b["height"] >= MIN_TARGET - 0.5, f"{role} {el.inner_text()[:20]!r} is {b}"
            for _ in range(8):
                page.keyboard.press("Tab")
                o = page.evaluate("() => { const s = getComputedStyle(document.activeElement); return [parseFloat(s.outlineWidth), s.outlineStyle]; }")
                assert o[0] >= INK_RULE_PX and o[1] == "solid"


def test_desk_messages_lifetime(app_url: str, browser: Browser) -> None:
    with public(browser, app_url, "/sign-in") as page:
        code = page.get_by_role("textbox", name="Desk code")
        code.fill("CAP-88")
        code.press("Enter")
        expect(msgs(page)).to_have_text(BAD_CODE)
        advance(page, MSG_MS - MSG_TOL_MS)
        assert msgs(page).inner_text().strip() == BAD_CODE
        advance(page, 2 * MSG_TOL_MS)
        assert msgs(page).inner_text().strip() == ""
        code.press("Enter")
        expect(msgs(page)).to_have_text(BAD_CODE)
        advance(page, MSG_MS / 2)
        code.press("Enter")
        expect(msgs(page)).to_have_text(BAD_CODE)
        advance(page, MSG_MS / 2 + 2 * MSG_TOL_MS)
        assert msgs(page).inner_text().strip() == BAD_CODE, "a newer message did not restart the 6 seconds"
        advance(page, MSG_MS / 2)
        assert msgs(page).inner_text().strip() == ""


def test_published_tokens(app_url: str, browser: Browser) -> None:
    with public(browser, app_url, "/") as page:
        bg = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
        assert bg == GROUND or page.evaluate("() => getComputedStyle(document.documentElement).backgroundColor") == GROUND
        assert page.evaluate("() => getComputedStyle(document.body).color") == INK
        assert page.evaluate("() => parseFloat(getComputedStyle(document.body).fontSize)") == BODY_PX
        assert "Atkinson Hyperlegible".lower() in page.evaluate("() => getComputedStyle(document.body).fontFamily").lower()
        h = page.get_by_role("heading", name="League table")
        hs = h.evaluate("e => [e.tagName, parseFloat(getComputedStyle(e).fontSize), getComputedStyle(e).fontFamily]")
        level = int(hs[0][1]) if hs[0].startswith("H") else 2
        assert abs(hs[1] - BODY_PX * HEADING_RATIO ** (4 - level)) <= 0.5 and "Fraunces".lower() in hs[2].lower()
        leader, other = tiles(page).nth(0), tiles(page).nth(1)
        for t, fill_ in ((leader, ACCENT), (other, GROUND)):
            s = t.evaluate("""e => { const els = []; for (let x = e; x && x.tagName !== 'UL' && x.tagName !== 'BODY'; x = x.parentElement) els.push(x);
                els.push(...e.getElementsByTagName('*'));
                for (const x of els) { const s = getComputedStyle(x);
                  if (parseFloat(s.borderTopWidth) === 2 && parseFloat(s.borderTopLeftRadius) === 12)
                    return [s.backgroundColor, s.borderTopWidth, s.borderTopStyle, s.borderTopColor, s.borderTopLeftRadius]; }
                return null; }""")
            assert s == [fill_, f"{INK_RULE_PX}px", "solid", INK, f"{RADIUS_PX}px"]
        assert "tabular" in leader.evaluate("e => [...e.getElementsByTagName('*')].map(x => getComputedStyle(x).fontVariantNumeric).join(' ')")
        accents = page.evaluate("""(a) => [...document.body.getElementsByTagName('*')].filter(e => { const s = getComputedStyle(e);
            return s.backgroundColor === a || s.color === a || s.borderTopColor === a; }).map(e => e.textContent.slice(0, 40))""", ACCENT)
        open_n = [r["number"] for r in rounds(app_url) if r["status"] == "open"]
        allowed = 1 + len(open_n)
        assert 1 <= len(accents) <= allowed + 2 * allowed, f"accent used on {accents}"
        for i, r in enumerate(rounds(app_url)):
            fill_ = {"open": ACCENT, "drafted": MUTED, "closed": GROUND, "marked": SECONDARY, "published": INK}[r["status"]]
            assert chips(page).nth(i).evaluate("e => getComputedStyle(e).backgroundColor") == fill_


def test_reopen_during_exit(app_url: str, browser: Browser) -> None:
    with signed(browser, app_url, cap(2)) as page:
        opener = page.get_by_role("button", name="Rename team")
        opener.click()
        dlg = page.get_by_role("dialog", name="Rename team")
        expect(dlg).to_have_count(1)
        page.keyboard.press("Escape")
        advance(page, PANE_MS / 4)
        opener.click()
        advance(page, PANE_MS * 3)
        page.evaluate(FINISH_JS)
        assert dlg.count() == 1 and focused(dlg.get_by_role("textbox", name="Team name"))
        b = box(dlg)
        assert b["x"] + b["width"] <= page.viewport_size["width"] + PX_TOL and b["x"] >= -PX_TOL
        page.keyboard.press("Escape")
        advance(page, PANE_MS * 3)
        page.evaluate(FINISH_JS)
        advance(page, STEP_MS)
        assert dlg.count() == 0 and focused(opener)


def test_reduced_motion_panes(app_url: str, browser: Browser) -> None:
    for size in ((375, 812), (1280, 800)):
        with signed(browser, app_url, cap(2), size=size, reduced_motion="reduce") as page:
            opener = page.get_by_role("button", name="Rename team")
            b = box(opener)
            page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
            page.mouse.down()
            assert not page.evaluate(MOVES_JS) and all(d <= REDUCED_MS for d in page.evaluate(DURATIONS_JS))
            assert abs(box(opener)["y"] - b["y"]) <= 0.5
            page.mouse.up()
            dlg = page.get_by_role("dialog", name="Rename team")
            rects, longest = path(page, dlg, PANE_MS)
            assert still(rects) and longest <= REDUCED_MS and not page.evaluate(MOVES_JS)
            before = dlg.evaluate(ANCESTRY_JS)
            page.keyboard.press("Escape")
            assert (dlg.count() == 0 or dlg.evaluate(ANCESTRY_JS) == before) and not page.evaluate(MOVES_JS)
            assert all(d <= REDUCED_MS for d in page.evaluate(DURATIONS_JS))


def test_if_run_manifest() -> None:
    m = json.loads(Path("/app/run.json").read_text())
    assert set(m) == {"_schema", "install", "build", "serve"} and m["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) for v in m.values())


def test_if_third_party_notices() -> None:
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for pkg in shipped_packages():
        assert pkg.name in notes and str(pkg.version) in notes, f"{pkg.name}@{pkg.version} missing from notices"
    assert "Fraunces" in notes and "Atkinson Hyperlegible" in notes


def test_if_licences() -> None:
    bad = [f"{p.name}@{p.version}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for font in ("Fraunces", "Atkinson Hyperlegible"):
        assert font in notes, f"{font} missing from notices"
    assert "SIL Open Font License" in notes and "1.1" in notes


def test_if_lockfile_and_npm_ci() -> None:
    assert Path("/app/package-lock.json").is_file()
    assert json.loads(Path("/app/run.json").read_text())["install"] == "npm ci"


STORE_PACKAGES = {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level", "lmdb", "mongodb", "mongoose", "keyv"}


def test_if_no_other_datastore() -> None:
    names = {p.name for p in shipped_packages()}
    assert not names & STORE_PACKAGES, f"extra datastore packages shipped: {names & STORE_PACKAGES}"
    files = [p for p in DEPLOYED_APP.rglob("*") if "node_modules" not in p.parts and p.suffix in {".sqlite", ".sqlite3", ".db"}]
    assert not files, f"embedded database files: {files}"


def test_if_same_origin_only(app_url: str, browser: Browser) -> None:
    seen: list[str] = []
    with public(browser, app_url, "/sign-in") as page:
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        page.goto(app_url + "/")
        advance(page, POLL_MS + STEP_MS)
    with signed(browser, app_url, cap(1)) as page:
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        advance(page, POLL_MS + STEP_MS)
    foreign = [u for u in seen if not u.startswith("data:") and not same_origin(u, app_url)]
    assert seen and not foreign, f"cross-origin loads: {foreign[:5]}"


COMPOSE = re.compile(r"(docker-)?compose[^/\"']*\.ya?ml")


def test_if_service_config_unchanged() -> None:
    traj = Path("/logs/agent/trajectory.json")
    if not traj.is_file():
        return
    data = json.loads(traj.read_text())
    steps = data.get("steps", data) if isinstance(data, dict) else data
    edits = []
    for step in steps if isinstance(steps, list) else []:
        for call in (step.get("tool_calls") or []) if isinstance(step, dict) else []:
            blob = json.dumps(call)
            name = str(call.get("function_name") or call.get("name") or "").lower()
            if COMPOSE.search(blob) and any(w in name or w in blob.lower() for w in ("write", "edit", "sed -i", "> ")):
                if any(w in name for w in ("write", "edit")) or re.search(r"(sed -i|>\s*\S*compose)", blob):
                    edits.append(blob[:200])
    assert not edits, f"service configuration was modified: {edits[:3]}"
