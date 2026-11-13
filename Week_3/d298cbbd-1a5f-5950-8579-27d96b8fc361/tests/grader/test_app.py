from __future__ import annotations

import concurrent.futures
import hashlib
import json
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
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    Postgres,
    addresses,
    advance,
    animations,
    axe,
    click,
    fill,
    layout,
    licence_allowed,
    mail_from_address,
    motion,
    open_app,
    sample,
    select,
    session,
    settle,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    text as mail_text,
    unique,
    until,
)

GRADING_KEY = os.environ.get("GRADING_KEY", "holloway-grading-key")
TEXT_SEED = 4242
SHORT_TEXT_SEED = 777
MAIN_TICKET_TTL_S = 1800
SHORT_TICKET_TTL_S = 8
SHORT_VERIFY_TTL_S = 8
SHORT_REJOIN_S = 4
SHORT_RACE_LIMIT_S = 20
MAIN_COUNTDOWN_S = 3
MAIN_REJOIN_S = 30
MAX_LOG_EVENTS = 12000
MAX_TEST_MS = 125000
FAST_INTERVAL_MS = 10
MAX_EXTRA_LETTERS = 10
FOCUS_WARNING_MS = 1000
RACE_WORDS = 15
BODY_LIMIT = 1000000
HISTORY_PAGE = 20
BOARD_ROWS = 50
RESEND_MS = 5000
LIVE_BOARD_S = 3
RACE_PROGRESS_S = 1
SESSION_CLOSE_S = 5
REFUSE_LOG_S = 1
ROOM_SEATS = 8
CARET_GLIDE_MS = 100
CARET_SETTLE_MAX_MS = 200
CERT_RISE_PX = 24
CERT_MAX_MS = 500
SEAL_MAX_MS = 300
SEAL_SCALE = 1.2
FONT_PX = 24
LINE_FACTOR = 1.5
FONT_SIZES = [1, 1.5, 2, 3]
CUSTOM_MAX_CHARS = 2000
CUSTOM_MAX_WORDS = 400
TARGET_PX = 44
FOCUS_RING_PX = 2
TEXT_CONTRAST = 4.5
CARET_CONTRAST = 3
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
STEP_MS = 200
DEFAULT_SETTINGS = {"theme": "sand", "caret": "line", "smoothCaret": True, "fontSize": 1.5, "blindMode": False, "quickRestart": "tab"}
ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ROOM_CODE_RE = re.compile(rf"^[{ROOM_ALPHABET}]{{3}}-[{ROOM_ALPHABET}]{{3}}$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}

HTTP_TIMEOUT_S = 60
WAIT_S = 30
WAIT_MS = 30000
POLL_MS = 250
POLL_MARGIN_S = 1
MAIL_WAIT_S = 90
MAIL_SETTLE_S = 0.5
BOOT_WAIT_S = 180
TICK_MS = 16

PASSWORD = "plain-sand-cobalt-7"
NEW_PASSWORD = "cobalt-sand-plain-8"
SHORT_PASSWORD = "short"
BAD_TIME_LENGTH = 7
FOREIGN_ORIGIN = "https://elsewhere.example"
KIRITIMATI = "Pacific/Kiritimati"
PAGO_PAGO = "Pacific/Pago_Pago"
FAR_PAST = datetime(2020, 1, 1, tzinfo=timezone.utc)
FAR_FUTURE = datetime(2031, 6, 1, tzinfo=timezone.utc)
FORBIDDEN_DATASTORES = {"redis", "ioredis", "sqlite3", "better-sqlite3", "sqlite", "amqplib", "kafkajs", "bullmq", "bull", "mongodb", "mongoose", "memcached", "level", "lowdb", "nedb"}
PROVIDED_CONFIG_NAMES = {"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}

WORD_LIST = (
    "amber anchor apple arch ash attic badge barley basin beacon bell bench birch blade bloom bolt bramble brick bridge brook "
    "cabin candle canal cedar chalk cider cliff clover cobble comet copper coral cotton crane crest dawn delta ditch dove drift "
    "dune ember fable fern ferry field flint forge frost garden glade gravel harbor hazel heath hedge hollow honey inlet island "
    "ivory jetty kettle lantern larch ledge linen lodge maple marsh meadow mill mist moss nectar oak orchard otter paddle pebble "
    "pine plume quarry quill rain reed ridge river robin saddle sail shore slate spruce stone stream thistle timber tide trail "
    "valley velvet willow wren yarrow acorn barrow canopy dusk elm fjord grove hamlet iris juniper kiln lark moor nook pond"
).split()

QUOTES = {
    "q1": ("short", "Brevity is the soul of wit.", "William Shakespeare, Hamlet (1603)"),
    "q2": ("short", "Beware; for I am fearless, and therefore powerful.", "Mary Shelley, Frankenstein (1818)"),
    "q3": ("medium", "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", "Jane Austen, Pride and Prejudice (1813)"),
    "q4": ("medium", "I went to the woods because I wished to live deliberately, to front only the essential facts of life.", "Henry David Thoreau, Walden (1854)"),
    "q5": ("long", "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.", "Charles Dickens, A Tale of Two Cities (1859)"),
    "q6": ("long", "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it.", "Lewis Carroll, Alice's Adventures in Wonderland (1865)"),
}

COMMANDS = [
    "Mode: time", "Mode: words", "Mode: quote", "Mode: custom", "Time: 15", "Time: 30", "Time: 60", "Time: 120",
    "Words: 10", "Words: 25", "Words: 50", "Words: 100", "Quote length: short", "Quote length: medium",
    "Quote length: long", "Quote length: all", "Punctuation: on", "Punctuation: off", "Numbers: on", "Numbers: off",
    "Theme: sand", "Theme: cobalt", "Theme: carbon", "Theme: ledger", "Caret: line", "Caret: block",
    "Caret: underline", "Caret: off", "Smooth caret: on", "Smooth caret: off", "Font size: 1", "Font size: 1.5",
    "Font size: 2", "Font size: 3", "Blind mode: on", "Blind mode: off", "Quick restart: tab", "Quick restart: enter",
]

THEMES = {
    "sand": ((230, 219, 199), (6, 43, 138), (58, 90, 168)),
    "cobalt": ((6, 43, 138), (230, 219, 199), (170, 184, 214)),
    "carbon": ((31, 29, 26), (232, 225, 211), (168, 160, 146)),
    "ledger": ((244, 241, 232), (29, 59, 42), (74, 110, 88)),
}

REASONS = {
    "wrong_text": "the text does not match this test.",
    "impossible_interval": "keystrokes arrived faster than a person can type.",
    "duration_mismatch": "the test length does not match its mode.",
    "replay_mismatch": "the replay does not match the submitted result.",
    "ticket_expired": "this test expired before it was submitted.",
    "invalid_log": "the keystroke log is malformed.",
    "log_too_long": "the keystroke log is too long.",
    "ticket_not_found": "this test was not issued to you.",
}

SEAL_HELD = "Held: replay in progress"
SEAL_GUEST = "Not filed: sign in to keep your runs."
SEAL_UNVERIFIED = "Not filed: verify your email to keep your runs."

SP, BS, CBS, ABS = "Space", "Backspace", "CtrlBackspace", "AltBackspace"
KEYMAP = {SP: "Space", BS: "Backspace", CBS: "Control+Backspace", ABS: "Alt+Backspace"}

WORKED_WORDS = ["the", "cat", "sat"]
SECOND_WORDS = ["sun", "map", "red", "ink", "toy"]
TIME_WORDS = ["amber", "anchor", "apple", "arch", "ash", "attic", "badge", "barley"]
TEN_WORDS = ["amber", "anchor", "apple", "arch", "ash", "attic", "badge", "barley", "basin", "beacon"]


def seq(*parts: str) -> list[str]:
    out: list[str] = []
    for p in parts:
        if p in (SP, BS, CBS, ABS):
            out.append(p)
        else:
            out.extend(SP if ch == " " else ch for ch in p)
    return out


def log_of(keys: list[str], gap: int, start: int = 0) -> list[dict[str, Any]]:
    return [{"k": CBS if k == ABS else k, "t": start + i * gap} for i, k in enumerate(keys)]


WORKED_KEYS = seq("the cx", BS, "at sat")
WORKED_LOG = log_of(WORKED_KEYS, STEP_MS)
SECOND_KEYS = seq("sun mop redd i")


def r2(x: Any) -> float:
    d = Decimal(x.numerator) / Decimal(x.denominator) if isinstance(x, Fraction) else Decimal(repr(float(x)))
    return float(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def f2(x: Any) -> str:
    return f"{r2(x):.2f}"


def half_up_int(x: Any) -> int:
    d = Decimal(x.numerator) / Decimal(x.denominator) if isinstance(x, Fraction) else Decimal(repr(float(x)))
    return int(d.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@dataclass
class Strike:
    t: int
    correct: bool
    key: str | None


class Engine:
    def __init__(self, words: list[str], time_ms: int | None = None) -> None:
        self.words = list(words)
        self.time_ms = time_ms
        self.typed: list[list[str]] = [[] for _ in words]
        self.cur = 0
        self.ended = False
        self.end_by_space = False
        self.end_t: int | None = None
        self.strikes: list[Strike] = []
        self.logged: list[dict[str, Any]] = []

    def _err(self, i: int) -> bool:
        return "".join(self.typed[i]) != self.words[i]

    def key(self, k: str, t: int) -> bool:
        if self.ended or (self.time_ms is not None and t >= self.time_ms):
            return False
        self.logged.append({"k": k, "t": t})
        w = self.words[self.cur]
        typed = self.typed[self.cur]
        if k == SP:
            if not typed:
                return True
            exact = "".join(typed) == w
            if self.cur == len(self.words) - 1:
                if self.time_ms is not None:
                    return True
                self.strikes.append(Strike(t, exact, None if exact else "space"))
                self.ended, self.end_by_space, self.end_t = True, True, t
                return True
            self.strikes.append(Strike(t, exact, None if exact else "space"))
            self.cur += 1
            return True
        if k == BS:
            if typed:
                typed.pop()
            elif self.cur > 0 and self._err(self.cur - 1):
                self.cur -= 1
            return True
        if k == CBS:
            if typed:
                typed.clear()
            elif self.cur > 0 and self._err(self.cur - 1):
                self.cur -= 1
                self.typed[self.cur].clear()
            return True
        if len(typed) >= len(w) + MAX_EXTRA_LETTERS:
            return True
        i = len(typed)
        typed.append(k)
        ok = i < len(w) and w[i] == k
        self.strikes.append(Strike(t, ok, None if ok else (w[i] if i < len(w) else "extra")))
        if self.time_ms is None and self.cur == len(self.words) - 1 and "".join(typed) == w:
            self.ended, self.end_t = True, t
        return True

    def word_chars(self, final: bool) -> int:
        n = sum(len(self.words[i]) + 1 for i in range(self.cur) if "".join(self.typed[i]) == self.words[i])
        cur, w = "".join(self.typed[self.cur]), self.words[self.cur]
        if final and self.ended:
            return n + (len(w) if cur == w else 0)
        return n + (len(cur) if w.startswith(cur) else 0)

    def left(self, i: int) -> bool:
        return i < self.cur or (i == self.cur and self.end_by_space)

    def states(self, blind: bool = False) -> list[list[str]]:
        out = []
        for i, w in enumerate(self.words):
            typed = self.typed[i]
            st = []
            for j, ch in enumerate(w):
                if j < len(typed):
                    st.append("typed" if blind else ("correct" if typed[j] == ch else "incorrect"))
                else:
                    st.append("missed" if self.left(i) and not blind else "untyped")
            if not blind:
                st += ["extra"] * max(0, len(typed) - len(w))
            out.append(st)
        return out

    def caret(self) -> tuple[int, int]:
        return self.cur, len(self.typed[self.cur])

    def characters(self) -> tuple[int, int, int, int]:
        c = inc = ext = mis = 0
        for idx in range(self.cur + 1):
            w, typed = self.words[idx], self.typed[idx]
            for j, ch in enumerate(typed):
                if j < len(w):
                    c += ch == w[j]
                    inc += ch != w[j]
                else:
                    ext += 1
            if self.left(idx):
                mis += max(0, len(w) - len(typed))
        return c, inc, ext, mis


@dataclass
class Result:
    duration: int
    speed: Fraction
    raw: Fraction
    accuracy: Fraction
    consistency: float
    characters: tuple[int, int, int, int]
    per_second: list[tuple[Fraction, Fraction, int]]
    errors: list[tuple[str, int]]
    engine: Engine


def feed(words: list[str], log: list[dict[str, Any]], time_ms: int | None, below: int | None = None) -> Engine:
    eng = Engine(words, time_ms)
    for e in log:
        if below is None or e["t"] < below:
            eng.key(e["k"], e["t"])
    return eng


def replay(words: list[str], log: list[dict[str, Any]], time_ms: int | None = None) -> Result:
    eng = feed(words, log, time_ms)
    duration = time_ms if time_ms is not None else eng.end_t
    assert duration is not None, "oracle: the log never ends the test"
    strikes = eng.strikes
    zero = Fraction(0)
    speed = Fraction(eng.word_chars(True) * 12000, duration) if duration else zero
    raw = Fraction(len(strikes) * 12000, duration) if duration else zero
    acc = Fraction(100 * sum(s.correct for s in strikes), len(strikes)) if strikes else Fraction(100)
    n = math.ceil(duration / 1000)
    per: list[tuple[Fraction, Fraction, int]] = []
    for k in range(1, n + 1):
        lo, hi = (k - 1) * 1000, min(k * 1000, duration)
        inside = [s for s in strikes if lo <= s.t < hi or (k == n and s.t == duration)]
        rv = Fraction(len(inside) * 12000, hi - lo)
        sp = speed if k * 1000 >= duration else Fraction(feed(words, log, time_ms, k * 1000).word_chars(False) * 12, k)
        per.append((sp, rv, sum(1 for s in inside if not s.correct)))
    raws = [float(p[1]) for p in per]
    mean = sum(raws) / len(raws) if raws else 0.0
    cons = 0.0 if mean == 0 else max(0.0, 100 - 100 * math.sqrt(sum((r - mean) ** 2 for r in raws) / len(raws)) / mean)
    counts = Counter(s.key for s in strikes if not s.correct)
    errors = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].encode("utf-16-be")))
    return Result(duration, speed, raw, acc, cons, eng.characters(), per, errors, eng)


def live_readout(words: list[str], log: list[dict[str, Any]], time_ms: int, k: int) -> tuple[str, str]:
    part = feed(words, log, time_ms, k * 1000)
    st = part.strikes
    acc = Fraction(100 * sum(s.correct for s in st), len(st)) if st else Fraction(100)
    return str(half_up_int(Fraction(part.word_chars(False) * 12, k))), f"{half_up_int(acc)}%"


def run_body(ticket_id: str | None, words: list[str], log: list[dict[str, Any]], time_ms: int | None = None) -> tuple[dict[str, Any], Result]:
    res = replay(words, log, time_ms)
    c = res.characters
    body: dict[str, Any] = {
        "ticketId": ticket_id, "text": list(words), "log": log, "duration": res.duration,
        "speed": r2(res.speed), "raw": r2(res.raw), "accuracy": r2(res.accuracy), "consistency": r2(res.consistency),
        "characters": {"correct": c[0], "incorrect": c[1], "extra": c[2], "missed": c[3]},
    }
    if ticket_id is None:
        body.pop("ticketId")
    return body, res


def result_line(res: Result) -> str:
    return f"Speed {f2(res.speed)}, accuracy {f2(res.accuracy)}%, raw {f2(res.raw)}, consistency {f2(res.consistency)}%."


def mulberry32(a: int) -> Callable[[], float]:
    state = [a & 0xFFFFFFFF]

    def imul(x: int, y: int) -> int:
        return (x * y) & 0xFFFFFFFF

    def r() -> float:
        s = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        state[0] = s
        t = imul(s ^ (s >> 15), 1 | s)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return r


def generate(seed: int, count: int, punctuation: bool, numbers: bool) -> list[str]:
    r = mulberry32(seed)
    out: list[str] = []
    prev = None
    for i in range(count):
        for _ in range(1000):
            w = WORD_LIST[int(r() * 120)]
            if w != prev:
                break
        prev = w
        if numbers and r() < 0.15:
            w = str(int(r() * 1000))
        if punctuation:
            y = r()
            if y < 0.1:
                w += ","
            elif y < 0.2:
                w += "."
            if i == 0 or out[-1].endswith("."):
                w = w[0].upper() + w[1:]
        out.append(w)
    return out


def origin(base: str) -> str:
    p = urlparse(base)
    return f"{p.scheme}://{p.netloc}"


def client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, headers={"Origin": origin(base)}, timeout=HTTP_TIMEOUT_S)


def short_url() -> str:
    return os.environ["APP_SHORT_URL"].rstrip("/")


def mail_down_url() -> str:
    return os.environ["APP_MAIL_DOWN_URL"].rstrip("/")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


TIME15_MS = 15 * 1000
HIST_BACK = 43200
HIST_WORDS_AT = 600
API_TIME_EXAMPLE = "2026-11-03T09:15:00.000Z"
CUSTOM_SAMPLE = f"{WORD_LIST[43]} {WORD_LIST[73]}"


def stamp(minutes: int) -> str:
    return (parse_iso(API_TIME_EXAMPLE) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def stamp_minute(minutes: int) -> str:
    return (parse_iso(API_TIME_EXAMPLE) + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M")


def words_area(page: Page):
    return page.locator('[id="words"]')


def timer_el(page: Page):
    return page.locator('[id="timer"]')


def live_speed_el(page: Page):
    return page.locator('[id="live-speed"]')


def live_accuracy_el(page: Page):
    return page.locator('[id="live-accuracy"]')


def el(page: Page, ident: str):
    return page.locator(f'[id="{ident}"]')


def grading_setup(base: str, typists: list[dict[str, Any]], runs: list[dict[str, Any]] = ()) -> dict[str, str]:
    with client(base) as c:
        r = c.post("/api/grading/setup", json={"typists": typists, "runs": list(runs)}, headers={"X-Grading-Key": GRADING_KEY})
    assert r.status_code == 201, f"POST /api/grading/setup answered {r.status_code} {r.text}"
    return {row["email"].lower(): row["id"] for row in r.json()["typists"]}


@dataclass
class Typist:
    base: str
    name: str
    email: str
    password: str
    id: str
    http: httpx.Client


def fresh_identity(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    email = a if "@" in a else b if "@" in b else f"{a}@strikeproof.test"
    tag = hashlib.sha1(email.lower().encode()).hexdigest()[:10]
    return f"{prefix[:8].capitalize()}{tag}", email


def sign_in_client(base: str, email: str, password: str) -> httpx.Client:
    http = client(base)
    r = http.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, f"POST /api/session answered {r.status_code} {r.text}"
    return http


def make_typists(base: str, prefix: str, n: int, verified: bool = True, runs: list[dict[str, Any]] = ()) -> list[Typist]:
    idents = [fresh_identity(f"{prefix}{i}") for i in range(n)]
    ids = grading_setup(base, [{"email": e, "name": nm, "password": PASSWORD, "verified": verified} for nm, e in idents],
                        [dict(r, email=idents[0][1]) for r in runs])
    return [Typist(base, nm, e, PASSWORD, ids[e.lower()], sign_in_client(base, e, PASSWORD)) for nm, e in idents]


def make_typist(base: str, prefix: str = "typist", verified: bool = True, runs: list[dict[str, Any]] = ()) -> Typist:
    return make_typists(base, prefix, 1, verified, runs)[0]


def next_text(base: str, target: str, words: list[str] | None = None, quote_id: str | None = None) -> None:
    body: dict[str, Any] = {"target": target}
    body.update({"words": words} if words is not None else {"quoteId": quote_id})
    with client(base) as c:
        r = c.post("/api/grading/next-text", json=body, headers={"X-Grading-Key": GRADING_KEY})
    assert r.status_code == 200 and r.json() == {"queued": True}, r.text


def ticket_body(mode: str, length: Any, punctuation: bool = False, numbers: bool = False, text: str | None = None) -> dict[str, Any]:
    return {"mode": mode, "length": length, "punctuation": punctuation, "numbers": numbers, "text": text}


def issue(http: httpx.Client, mode: str, length: Any, punctuation: bool = False, numbers: bool = False, text: str | None = None) -> dict[str, Any]:
    r = http.post("/api/tickets", json=ticket_body(mode, length, punctuation, numbers, text))
    assert r.status_code == 201, f"POST /api/tickets answered {r.status_code} {r.text}"
    return r.json()


def fixed_ticket(t: Typist, mode: str, length: Any, words: list[str] | None = None, quote_id: str | None = None) -> dict[str, Any]:
    next_text(t.base, f"typist:{t.email}", words, quote_id)
    return issue(t.http, mode, length)


def submit(http: httpx.Client, body: Any = None, content: bytes | None = None, content_type: str = "application/json") -> httpx.Response:
    data = content if content is not None else json.dumps(body).encode()
    return http.post("/api/runs", content=data, headers={"Content-Type": content_type})


def counted_run(t: Typist, words: list[str], keys: list[str], mode: str = "words", length: Any = 10, gap: int = STEP_MS) -> tuple[dict[str, Any], dict[str, Any], Result]:
    tk = fixed_ticket(t, mode, length, words)
    body, res = run_body(tk["ticketId"], words, log_of(keys, gap), 15000 if mode == "time" and length == 15 else None)
    r = submit(t.http, body)
    assert r.status_code == 201, f"POST /api/runs answered {r.status_code} {r.text}"
    return tk, r.json(), res


def server_now(base: str) -> datetime:
    with client(base) as c:
        tk = issue(c, "words", 10)
    return parse_iso(tk["expiresAt"]) - timedelta(seconds=MAIN_TICKET_TTL_S)


def history_runs(t: Typist, query: str = "") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for page_no in range(1, 50):
        r = t.http.get(f"/api/history?page={page_no}{query}")
        assert r.status_code == 200, r.text
        out += r.json()["runs"]
        if not r.json()["more"]:
            return out
    pytest.fail("GET /api/history kept answering more:true")


def board(base: str, which: str, length: int) -> list[dict[str, Any]]:
    with client(base) as c:
        r = c.get(f"/api/boards?board={which}&length={length}")
    assert r.status_code == 200, r.text
    return r.json()["rows"]


def put_settings(t: Typist, **changes: Any) -> None:
    r = t.http.put("/api/settings", json=dict(DEFAULT_SETTINGS, **changes))
    assert r.status_code == 200, r.text


def elapse(base: str, seconds: float) -> None:
    end = time.monotonic() + seconds
    with client(base) as c:
        while time.monotonic() < end:
            c.get("/api/health")


def parallel(n: int, fn: Callable[[int], Any]) -> list[Any]:
    barrier = threading.Barrier(n)

    def run(i: int) -> Any:
        barrier.wait(timeout=HTTP_TIMEOUT_S)
        return fn(i)

    with concurrent.futures.ThreadPoolExecutor(n) as ex:
        return list(ex.map(run, range(n)))


def poll(fn: Callable[[], Any], contract: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
    pytest.fail(f"{contract}; last observation: {last!r}")


def mails_to(mail: Any, email: str, subject: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages(0, settle=MAIL_SETTLE_S)
            if email.lower() in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject]


def wait_mail(mail: Any, email: str, subject: str, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    return poll(lambda: mails_to(mail, email, subject), f"Mailpit received a '{subject}' mail to {email}", seconds)


def mailed_token(message: dict[str, Any], label: str, path: str, base: str | None = None) -> str:
    m = re.search(rf"^{label}: (\S+)$", mail_text(message), re.M)
    assert m, f"mail body has a '{label}: <link>' line on its own"
    link = m.group(1)
    assert link.startswith("http") and f"/{path}/" in link, link
    public = None if base else os.environ.get("APP_PUBLIC_URL")
    if public:
        assert link.startswith(public.rstrip("/") + f"/{path}/"), link
    return link.rsplit("/", 1)[1]


def typing_input(page: Page):
    return page.get_by_role("textbox", name="Typing input")


def seal(page: Page):
    return page.get_by_role("status", name="Seal")


def is_post(path: str) -> Callable[[Any], bool]:
    return lambda r: r.request.method == "POST" and urlparse(r.url).path == path


def record_requests(page: Page, path: str, method: str = "POST") -> list[Any]:
    seen: list[Any] = []
    page.on("request", lambda r: seen.append(r) if r.method == method and urlparse(r.url).path == path else None)
    return seen


def eventually(page: Page | None, check: Callable[[], None], contract: str, seconds: float = WAIT_S, tick: bool = True) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            check()
            return
        except AssertionError as e:
            last = e
            if tick and page is not None:
                advance(page, TICK_MS)
    pytest.fail(f"{contract}: {last}")


WORDS_JS = """(id) => { const a = document.getElementById(id); if (!a) return null;
 return [...a.querySelectorAll('[data-index]')].map(w => { const ls = [...w.querySelectorAll('[data-state]')];
  return {i: Number(w.getAttribute('data-index')), line: w.hasAttribute('data-line') ? Number(w.getAttribute('data-line')) : null,
   states: ls.map(l => l.getAttribute('data-state')),
   visible: ls.filter(l => l.getClientRects().length > 0 && getComputedStyle(l).visibility !== 'hidden').map(l => l.getAttribute('data-state')),
   text: ls.filter(l => l.getAttribute('data-state') !== 'extra').map(l => l.textContent).join('')}; }); }"""


def words_state(page: Page, area: str = "words") -> list[dict[str, Any]]:
    return page.evaluate(WORDS_JS, area) or []


def caret_of(page: Page, cid: str = "caret") -> tuple[int, int]:
    v = page.evaluate("(id) => { const c = document.getElementById(id); return c ? [c.getAttribute('data-word'), c.getAttribute('data-letter')] : null; }", cid)
    assert v and v[0] is not None, f"#{cid} carries data-word and data-letter"
    return int(v[0]), int(v[1])


def assert_state(page: Page, eng: Engine, blind: bool = False, area: str = "words", caret: str = "caret") -> None:
    dom = words_state(page, area)
    exp = eng.states(blind)
    got = [w["visible"] if blind else w["states"] for w in dom]
    assert got == exp[: len(got)] and len(got) >= eng.cur + 1, f"letter states {got} != {exp}"
    assert caret_of(page, caret) == eng.caret(), f"caret {caret_of(page, caret)} != {eng.caret()}"


def wait_sheet(page: Page, words: list[str] | None = None, seconds: float = WAIT_S) -> None:
    def check() -> None:
        expect(words_area(page)).not_to_have_attribute("aria-busy", "true", timeout=POLL_MS)
        st = words_state(page)
        assert st, "the words area shows words"
        if words is not None:
            assert [w["text"] for w in st[: len(words)]] == words, [w["text"] for w in st[: len(words)]]
    eventually(page, check, "the words area shows the issued ticket's words", seconds)


def prepare(page: Page, base: str, mode: str, length: Any, words: list[str] | None = None, quote_id: str | None = None,
            typist: Typist | None = None, punctuation: bool = False, numbers: bool = False) -> dict[str, Any]:
    wait_sheet(page)
    radio = page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name=mode, exact=True)
    if not radio.is_checked():
        click(radio)
        wait_sheet(page)
    if length is not None:
        lr = page.get_by_role("radiogroup", name="Length").get_by_role("radio", name=str(length), exact=True)
        if not lr.is_checked():
            click(lr)
            wait_sheet(page)
    if mode in ("time", "words"):
        for name, want in (("Punctuation", punctuation), ("Numbers", numbers)):
            box = page.get_by_role("checkbox", name=name)
            if box.is_checked() != want:
                click(box)
                wait_sheet(page)
    if words is not None or quote_id is not None:
        next_text(base, f"typist:{typist.email}" if typist else "guest", words, quote_id)
    with page.expect_response(is_post("/api/tickets"), timeout=WAIT_MS) as info:
        click_clear(page.get_by_role("button", name="Restart test"))
    assert info.value.status == 201
    tk = info.value.json()
    wait_sheet(page, tk["words"][:12])
    eventually(page, lambda: expect(typing_input(page)).to_be_focused(timeout=POLL_MS), "restart returns focus to the typing input")
    return tk


def click_clear(locator: Any) -> None:
    locator.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
    click(locator)


def alert_says(page: Page, text: str | re.Pattern[str]) -> None:
    pattern = text if isinstance(text, re.Pattern) else re.compile(rf"^\s*{re.escape(text)}\s*$")
    expect(page.get_by_role("alert").filter(has_text=pattern)).to_have_count(1, timeout=WAIT_MS)
    expect(page.get_by_role("alert").filter(has_text=pattern)).to_be_visible()


def press_key(page: Page, k: str) -> None:
    page.keyboard.press(KEYMAP.get(k, k))


class Clock:

    def __init__(self, page: Page) -> None:
        self.page = page
        self.now: int | None = None

    def press(self, k: str, at: int) -> None:
        if self.now is not None and at > self.now:
            advance(self.page, at - self.now)
        press_key(self.page, k)
        self.now = at

    def to(self, at: int) -> None:
        assert self.now is not None
        if at > self.now:
            advance(self.page, at - self.now)
            self.now = at


def eventually_clocked(clock: Clock, check: Callable[[], None], contract: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            check()
            return
        except AssertionError as e:
            last = e
            clock.to(clock.now + TICK_MS)
    pytest.fail(f"{contract}: {last}")


def check_readouts(page: Page, words: list[str], log: list[dict[str, Any]], time_ms: int, k: int) -> None:
    sp, acc = live_readout(words, log, time_ms, k)
    expect(timer_el(page)).to_have_text(str(time_ms // 1000 - k), timeout=POLL_MS * 4)
    expect(live_speed_el(page)).to_have_text(sp, timeout=POLL_MS * 4)
    expect(live_accuracy_el(page)).to_have_text(acc, timeout=POLL_MS * 4)


def step_to(clock: Clock, target: int, on_second: Callable[[int], None] | None = None) -> None:
    assert clock.now is not None
    for _ in range(target // 1000 + 2):
        b = (clock.now // 1000 + 1) * 1000
        if b > target:
            break
        clock.to(b)
        if on_second:
            on_second(b // 1000)
    clock.to(target)


def type_and_check(page: Page, words: list[str], keys: list[str], gap: int = STEP_MS, time_ms: int | None = None,
                   blind: bool = False, readouts: bool = False, check: bool = True) -> tuple[Clock, list[dict[str, Any]]]:
    log = log_of(keys, gap)
    eng = Engine(words, time_ms)
    if check:
        assert_state(page, eng, blind)
    clock = Clock(page)

    def second(k: int) -> None:
        if readouts and time_ms is not None and k * 1000 < time_ms:
            check_readouts(page, words, log, time_ms, k)

    for i, (k, e) in enumerate(zip(keys, log)):
        if clock.now is not None:
            step_to(clock, e["t"], second)
        clock.press(k, e["t"])
        eng.key(e["k"], e["t"])
        nxt = log[i + 1]["t"] if i + 1 < len(log) else e["t"] + gap
        if time_ms is not None:
            nxt = min(nxt, time_ms - 1)
        step_to(clock, nxt, second)
        if check and not eng.ended:
            assert_state(page, eng, blind)
            if readouts and time_ms is None:
                expect(timer_el(page)).to_have_text(f"{eng.cur}/{len(words)}")
    return clock, log


def finish_time(page: Page, clock: Clock, words: list[str], log: list[dict[str, Any]], time_ms: int, readouts: bool = False) -> None:
    step_to(clock, time_ms, lambda k: check_readouts(page, words, log, time_ms, k) if readouts and k * 1000 < time_ms else None)


def assert_certificate(page: Page, res: Result) -> None:
    expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)
    for loc, val in ((page.locator('[id="result-speed"]'), f2(res.speed)),
                     (page.locator('[id="result-raw"]'), f2(res.raw)),
                     (page.locator('[id="result-accuracy"]'), f"{f2(res.accuracy)}%"),
                     (page.locator('[id="result-consistency"]'), f"{f2(res.consistency)}%"),
                     (page.locator('[id="result-characters"]'), "/".join(map(str, res.characters))),
                     (page.locator('[id="result-duration"]'), f"{f2(Fraction(res.duration, 1000))} s")):
        expect(loc).to_have_text(val)


def table_rows(table: Any) -> list[list[str]]:
    rows = []
    for row in table.get_by_role("row").all():
        if row.get_by_role("columnheader").count():
            continue
        cells = [x.strip() for x in row.get_by_role("rowheader").all_inner_texts() + row.get_by_role("cell").all_inner_texts()]
        if cells:
            rows.append(cells)
    return rows


def assert_tables(page: Page, res: Result) -> None:
    speed_rows = [[str(k + 1), f2(sp), f2(rv), str(er)] for k, (sp, rv, er) in enumerate(res.per_second)]
    assert table_rows(page.get_by_role("table", name="Speed over time")) == speed_rows
    expect(page.get_by_role("img", name="Speed over time").locator("[data-second]")).to_have_count(len(res.per_second))
    if res.errors:
        assert table_rows(page.get_by_role("table", name="Errors by key")) == [[k, str(n)] for k, n in res.errors]
    else:
        expect(page.get_by_role("table", name="Errors by key")).to_have_count(0)
        expect(page.get_by_text("No errors.", exact=True)).to_be_visible()


RECORD_JS = """(el) => { if (el.__log) return; el.__log = [el.textContent.trim()];
 new MutationObserver(() => el.__log.push(el.textContent.trim())).observe(el, {childList: true, subtree: true, characterData: true}); }"""
BAR_NAME_JS = """const nameOf = (e) => { const l = e.getAttribute('aria-label'); if (l) return l.trim();
 const ids = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
 if (ids.length) return ids.map((i) => (document.getElementById(i)?.textContent || '').trim()).join(' ').trim();
 return [...(e.labels || [])].map((x) => x.textContent.trim()).join(' ').trim(); };"""
VALUES_JS = "(el) => { " + BAR_NAME_JS + """ const name = nameOf(el); window.__bars = window.__bars || {}; if (window.__bars[name]) return;
 const rec = window.__bars[name] = [];
 const read = () => { for (const e of document.querySelectorAll('[role=progressbar],progress')) { if (nameOf(e) !== name || !e.hasAttribute('aria-valuenow')) continue;
  const v = Number(e.getAttribute('aria-valuenow')); if (rec[rec.length - 1] !== v) rec.push(v); } };
 read(); new MutationObserver(read).observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true}); }"""
VALUES_READ_JS = "(el) => { " + BAR_NAME_JS + " return (window.__bars || {})[nameOf(el)] || null; }"


def record_region(locator: Any) -> Any:
    h = locator.element_handle(timeout=WAIT_MS)
    h.evaluate(RECORD_JS)
    return h


def times_announced(handle: Any, line: str) -> int:
    log = handle.evaluate("(el) => el.__log")
    return sum(1 for i, x in enumerate(log) if x == line and (i == 0 or log[i - 1] != line))


@contextmanager
def signed_in(browser: Browser, base: str, t: Typist, path: str = "/", **options: Any) -> Iterator[Page]:
    with open_app(browser, base + "/signin", **options) as page:
        r = page.request.post(base + "/api/session", data=json.dumps({"email": t.email, "password": t.password}),
                              headers={"Content-Type": "application/json", "Origin": origin(base)})
        assert r.status == 200, f"POST /api/session answered {r.status}"
        page.goto(base + path)
        yield page


def zone(page: Page, tz: str) -> None:
    session(page).send("Emulation.setTimezoneOverride", {"timezoneId": tz})
    page.reload()


def open_command(page: Page, query: str) -> None:
    page.keyboard.press("Escape")
    box = page.get_by_role("combobox", name="Command")
    expect(box).to_be_focused(timeout=WAIT_MS)
    page.keyboard.type(query)


def apply_command(page: Page, query: str) -> None:
    open_command(page, query)
    page.keyboard.press("Enter")
    expect(page.get_by_role("dialog", name="Command line")).to_have_count(0, timeout=WAIT_MS)


def contrast(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    def lum(c: tuple[float, ...]) -> float:
        ch = [v / 255 for v in c[:3]]
        ch = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in ch]
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


LETTER_COLOURS_JS = """(id) => { const area = document.getElementById(id); const parse = s => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
 return [...area.querySelectorAll('[data-state]')].filter(l => l.getClientRects().length > 0).map(l => { const cs = getComputedStyle(l); let alpha = 1; for (let e = l; e && e !== area.parentElement; e = e.parentElement) alpha *= Number(getComputedStyle(e).opacity);
  const c = parse(cs.color); return {state: l.getAttribute('data-state'), color: c, alpha: alpha * (c ? c[3] : 1), line: cs.textDecorationLine, style: cs.textDecorationStyle}; }); }"""

CARET_COLOUR_JS = """() => { const c = document.getElementById('caret'); const cs = getComputedStyle(c); const parse = s => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
 for (const [v, w] of [[cs.backgroundColor, 1], [cs.borderBottomColor, parseFloat(cs.borderBottomWidth)], [cs.borderLeftColor, parseFloat(cs.borderLeftWidth)], [cs.color, 1]]) { const p = parse(v); if (p && p[3] > 0 && w > 0) return p; } return null; }"""


def blended(c: list[float], alpha: float, sheet: tuple[int, int, int]) -> tuple[float, float, float]:
    return tuple(c[i] * alpha + sheet[i] * (1 - alpha) for i in range(3))


def assert_marks(page: Page, theme: str, area: str = "words") -> set[str]:
    sheet = THEMES[theme][0]
    seen: set[str] = set()
    for l in page.evaluate(LETTER_COLOURS_JS, area):
        st = l["state"]
        seen.add(st)
        assert l["color"], f"{st} letter has an rgb colour"
        ratio = contrast(blended(l["color"], l["alpha"], sheet), sheet)
        assert ratio >= TEXT_CONTRAST, f"{theme} {st} letter contrast {ratio:.2f}"
        if st in ("incorrect", "extra"):
            assert "line-through" in l["line"], f"{st} letters are struck through"
        elif st == "missed":
            assert "underline" in l["line"] and l["style"] == "dotted", "missed letters have a dotted underline"
        else:
            assert "line-through" not in l["line"] and "underline" not in l["line"], f"{st} letters carry no decoration"
    return seen


def rect(page: Page, locator: Any) -> dict[str, float]:
    b = locator.bounding_box()
    assert b, "element is laid out"
    return b


def motion_times(path: list[dict[str, Any]], window_ms: float) -> list[float]:
    if path and "dt" in path[0]:
        return [(s["dt"] - path[0]["dt"]) * 1000 for s in path]
    return [s.get("t", i * window_ms / max(1, len(path) - 1)) for i, s in enumerate(path)]


def _num(d: dict[str, float], *names: str) -> float:
    for n in names:
        if n in d:
            return float(d[n])
    raise AssertionError(f"sample has none of {names}: {sorted(d)}")


def test_tickets_endpoint(app_url, browser):
    base = app_url.rstrip("/")
    with client(base) as c:
        a = issue(c, "time", 15)
        uuid.UUID(a["ticketId"])
        assert isinstance(a["seed"], int) and len(a["words"]) == 15 * 4 and a["quoteId"] is None
        assert ISO_RE.match(a["expiresAt"]), a["expiresAt"]
        b = issue(c, "time", 15)
        assert b["ticketId"] != a["ticketId"] and b["seed"] != a["seed"]
        w = issue(c, "words", 25)
        assert len(w["words"]) == 25 and w["quoteId"] is None
        q = issue(c, "quote", "long")
        assert q["quoteId"] in ("q5", "q6") and q["words"] == QUOTES[q["quoteId"]][1].split(" ")
        cu = issue(c, "custom", None, text="fern  moss")
        assert cu["words"] == ["fern", "moss"] and cu["quoteId"] is None
        for bad in (ticket_body("time", BAD_TIME_LENGTH), ticket_body("words", 15), ticket_body("quote", 15), ticket_body("custom", 10, text="fern")):
            r = c.post("/api/tickets", json=bad)
            assert (r.status_code, r.json()) == (422, {"error": "invalid_ticket_request"}), bad
        r = c.post("/api/tickets", json=ticket_body("custom", None, text="   "))
        assert (r.status_code, r.json()) == (422, {"error": "custom_text_empty"})
    with client(short_url()) as c:
        first = issue(c, "words", 10)
        after = issue(c, "words", 10)
        span = parse_iso(after["expiresAt"]) - parse_iso(first["expiresAt"])
        assert timedelta(0) <= span < timedelta(seconds=SHORT_TICKET_TTL_S)
    with open_app(browser, base + "/") as page:
        wait_sheet(page)
        with page.expect_response(is_post("/api/tickets"), timeout=WAIT_MS) as info:
            click_clear(page.get_by_role("button", name="Restart test"))
        assert info.value.status == 201
        wait_sheet(page, info.value.json()["words"][:10])


def test_letter_states_and_caret(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "states")
    words = ["amber", "anchor", "apple", "arch"]
    keys = seq("amber ", "ancx", BS, "horr ", "ap ", "arch")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=words, typist=t)
        expect(timer_el(page)).to_have_text(f"0/{len(words)}")
        type_and_check(page, words, keys, readouts=True)
        dom = words_state(page) if words_area(page).count() else []
        assert_certificate(page, replay(words, log_of(keys, STEP_MS)))
        assert not dom or dom[1]["states"][-1] == "extra"


def test_time_test_clock(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "clock")
    words = SECOND_WORDS + ["oak", "elm", "fern"]
    with signed_in(browser, base, t) as page:
        prepare(page, base, "time", 15, words=words, typist=t)
        expect(timer_el(page)).to_have_text("15")
        expect(live_speed_el(page)).to_have_text("0")
        expect(live_accuracy_el(page)).to_have_text("100%")
        log = log_of(seq("sun mop"), 150) + log_of(seq(" red "), 150, 1050) + [{"k": "i", "t": 14999}]
        clock = Clock(page)
        for e in log[:7]:
            clock.press(e["k"], e["t"])
        clock.to(999)
        expect(timer_el(page)).to_have_text("15")
        clock.to(1000)
        check_readouts(page, words, log, TIME15_MS, 1)
        sp1, acc1 = live_readout(words, log, TIME15_MS, 1)
        for e in log[7:12]:
            clock.press(e["k"], e["t"])
        clock.to(1999)
        expect(live_speed_el(page)).to_have_text(sp1)
        expect(live_accuracy_el(page)).to_have_text(acc1)
        clock.to(2000)
        check_readouts(page, words, log, TIME15_MS, 2)
        clock.to(14999)
        expect(timer_el(page)).to_have_text("1")
        expect(page.get_by_role("region", name="Certificate")).to_have_count(0)
        clock.press("i", 14999)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            clock.to(TIME15_MS)
            res = replay(words, log, TIME15_MS)
            assert_certificate(page, res)
            press_key(page, "n")
            advance(page, STEP_MS)
            press_key(page, "k")
        assert_certificate(page, res)
        sent = json.loads(info.value.request.post_data_buffer)
        assert sent["log"] == log and sent["duration"] == TIME15_MS
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert stored["log"] == log and all(e["t"] < TIME15_MS for e in stored["log"])


def test_certificate_figures(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "figures")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            type_and_check(page, WORKED_WORDS, WORKED_KEYS, check=False)
        res = replay(WORKED_WORDS, WORKED_LOG)
        assert_certificate(page, res)
        for id_, val in (("result-speed", "55.00"), ("result-raw", "60.00"), ("result-accuracy", "91.67%"),
                         ("result-consistency", "73.24%"), ("result-characters", "9/0/0/0"), ("result-duration", "2.40 s")):
            expect(el(page, id_)).to_have_text(val)
        data = info.value.json()
        assert info.value.status == 201 and (data["speed"], data["raw"], data["accuracy"], data["consistency"]) == (55, 60, 91.67, 73.24)
        page.goto(base + "/")
        prepare(page, base, "time", 15, words=SECOND_WORDS, typist=t)
        clock, log = type_and_check(page, SECOND_WORDS, SECOND_KEYS, gap=150, time_ms=15000, check=False)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info2:
            finish_time(page, clock, SECOND_WORDS, log, 15000)
        res2 = replay(SECOND_WORDS, log, 15000)
        assert_certificate(page, res2)
        assert info2.value.status == 201 and info2.value.json()["speed"] == r2(res2.speed)


def test_certificate_tables(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "tables")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        type_and_check(page, WORKED_WORDS, WORKED_KEYS, check=False)
        res = replay(WORKED_WORDS, WORKED_LOG)
        assert_certificate(page, res)
        assert table_rows(page.get_by_role("table", name="Speed over time")) == [["1", "60.00", "60.00", "0"], ["2", "48.00", "48.00", "1"], ["3", "55.00", "90.00", "0"]]
        assert table_rows(page.get_by_role("table", name="Errors by key")) == [["a", "1"]]
        assert_tables(page, res)
        page.goto(base + "/")
        prepare(page, base, "time", 15, words=SECOND_WORDS, typist=t)
        clock, log = type_and_check(page, SECOND_WORDS, SECOND_KEYS, gap=150, time_ms=15000, check=False)
        finish_time(page, clock, SECOND_WORDS, log, 15000)
        res2 = replay(SECOND_WORDS, log, 15000)
        assert_certificate(page, res2)
        assert table_rows(page.get_by_role("table", name="Errors by key")) == [["space", "2"], ["a", "1"], ["extra", "1"]]
        assert_tables(page, res2)
        page.goto(base + "/")
        prepare(page, base, "words", 10, words=["ash"], typist=t)
        type_and_check(page, ["ash"], seq("ash"), check=False)
        assert_tables(page, replay(["ash"], log_of(seq("ash"), STEP_MS)))


def test_result_announcement(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "announce")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        region = record_region(page.get_by_role("status", name="Test result"))
        type_and_check(page, WORKED_WORDS, WORKED_KEYS, check=False)
        line = "Speed 55.00, accuracy 91.67%, raw 60.00, consistency 73.24%."
        assert line == result_line(replay(WORKED_WORDS, WORKED_LOG))
        expect(page.get_by_role("status", name="Test result")).to_have_text(line, timeout=WAIT_MS)
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        advance(page, RESEND_MS)
        slider = page.get_by_role("slider", name="Replay position")
        slider.focus()
        for key in ("Home", "ArrowRight", "End"):
            page.keyboard.press(key)
            advance(page, STEP_MS)
        expect(page.get_by_role("status", name="Test result")).to_have_text(line)
        assert times_announced(region, line) == 1


def test_wf_timed_test_happy(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "timedhappy")
    words = TIME_WORDS
    keys = seq("amber ", "ancx", BS, "horss ", "aqple ", "ar")
    with signed_in(browser, base, t) as page:
        tk = prepare(page, base, "time", 15, words=words, typist=t)
        held: list[Any] = []
        page.route("**/api/runs", lambda route: held.append(route))
        clock, log = type_and_check(page, words, keys, gap=300, time_ms=15000, readouts=True)
        finish_time(page, clock, words, log, 15000, readouts=True)
        res = replay(words, log, 15000)
        assert_certificate(page, res)
        assert_tables(page, res)
        expect(page.get_by_role("status", name="Test result")).to_have_text(result_line(res))
        eventually(None, lambda: (assert_len(held, 1), expect(seal(page)).to_have_text(SEAL_HELD, timeout=POLL_MS)), "seal is held while the run is submitted")
        raw_body = held[0].request.post_data_buffer
        sent = json.loads(raw_body)
        assert sent["ticketId"] == tk["ticketId"] and sent["text"] == words and sent["log"] == log
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            held[0].continue_()
        data = info.value.json()
        assert info.value.status == 201 and data["verdict"] == "counted" and data["personalBest"] is True
        assert data["proofKey"] == hashlib.sha256(raw_body).hexdigest()
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        expect(seal(page)).to_contain_text("New personal best")
        expect(el(page, "proof-key")).to_have_text(f"Proof {data['proofKey'][:16]}")
        page.unroute("**/api/runs")
        nxt = page.get_by_role("button", name="Next test")
        for _ in range(60):
            page.keyboard.press("Tab")
            if nxt.evaluate("(el) => el === document.activeElement"):
                break
        else:
            pytest.fail("Next test is reachable by Tab on the certificate")
        with page.expect_response(is_post("/api/tickets"), timeout=WAIT_MS):
            page.keyboard.press("Enter")
        eventually(page, lambda: expect(typing_input(page)).to_be_focused(timeout=POLL_MS), "Next test focuses the typing input")
    stored = t.http.get(f"/api/runs/{data['runId']}").json()
    assert stored["verdict"] == "counted" and stored["log"] == log and stored["speed"] == r2(res.speed)
    assert stored["characters"] == dict(zip(("correct", "incorrect", "extra", "missed"), res.characters))
    assert stored["errorsByKey"] == dict(res.errors)
    assert [(p["second"], p["speed"], p["raw"], p["errors"]) for p in stored["perSecond"]] == [(k + 1, r2(s), r2(r), e) for k, (s, r, e) in enumerate(res.per_second)]


def assert_len(items: list[Any], n: int) -> None:
    assert len(items) == n, f"expected {n} requests, saw {len(items)}"


def test_wf_timed_test_restart(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "timers")
    with signed_in(browser, base, t) as page:
        runs = record_requests(page, "/api/runs")
        first = prepare(page, base, "time", 15, words=TIME_WORDS, typist=t)
        clock = Clock(page)
        clock.press("a", 0)
        clock.to(10000)
        next_text(base, f"typist:{t.email}", SECOND_WORDS)
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Restart test")).to_be_focused()
        with page.expect_response(is_post("/api/tickets"), timeout=WAIT_MS) as info:
            page.keyboard.press("Enter")
        second = info.value.json()
        wait_sheet(page, SECOND_WORDS)
        expect(el(page, "timer")).to_have_text("15")
        c2 = Clock(page)
        c2.press("s", 0)
        c2.to(5000)
        expect(page.get_by_role("region", name="Certificate")).to_have_count(0)
        c2.to(14999)
        expect(page.get_by_role("region", name="Certificate")).to_have_count(0)
        calls: list[bytes] = []

        def fail_first(route: Any) -> None:
            calls.append(route.request.post_data_buffer)
            if len(calls) == 1:
                route.fulfill(status=503, content_type="application/json", body='{"error":"unavailable"}')
            else:
                route.continue_()
        page.route("**/api/runs", fail_first)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS):
            c2.to(15000)
        expect(page.get_by_role("region", name="Certificate")).to_be_visible()
        assert [json.loads(r.post_data_buffer)["ticketId"] for r in runs] == [second["ticketId"]]
        expect(seal(page)).to_have_text(SEAL_HELD)
        next_text(base, f"typist:{t.email}", ["ash"])
        click(page.get_by_role("button", name="Next test"))
        wait_sheet(page)
        prepare(page, base, "words", 10, words=["ash"], typist=t)
        advance(page, RESEND_MS * 3)
        assert len(calls) == 1, "the old test's resend loop stopped when the next test began"
        type_and_check(page, ["ash"], seq("ash"), check=False)
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        assert first["ticketId"] not in [json.loads(r.post_data_buffer)["ticketId"] for r in runs]


def test_backspace_rules(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "backspace")
    words = ["amber", "anchor", "apple", "arch"]
    keys = seq("amber ", BS, "anchx ", BS, BS, "or ", "app ", BS, "le ", "arch")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=words, typist=t)
        clock = Clock(page)
        log = log_of(keys, STEP_MS)
        eng = Engine(words)
        for i, (k, e) in enumerate(zip(keys, log)):
            clock.press(k, e["t"])
            eng.key(e["k"], e["t"])
            clock.to(e["t"] + STEP_MS)
            if eng.ended:
                break
            assert_state(page, eng)
            if i == 6:
                assert caret_of(page) == (1, 0)
            if i == 13:
                assert caret_of(page) == (1, 5)
                assert words_state(page)[1]["states"] == ["correct", "correct", "correct", "correct", "incorrect", "untyped"]
    hist = poll(lambda: history_runs(t), "history lists the filed run")
    stored = t.http.get(f"/api/runs/{hist[0]['runId']}").json()
    assert [e["k"] for e in stored["log"]].count(BS) == keys.count(BS)


def test_wf_correction_rules_ctrl_backspace(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "ctrlbs")
    words = ["amber", "anchor", "apple"]
    keys = seq("amx", CBS, "amber ", CBS, "ancz ", ABS, "anchor ", "apple")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=words, typist=t)
        clock = Clock(page)
        log = log_of(keys, STEP_MS)
        eng = Engine(words)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            for i, (k, e) in enumerate(zip(keys, log)):
                clock.press(k, e["t"])
                eng.key(e["k"], e["t"])
                clock.to(e["t"] + STEP_MS)
                if eng.ended:
                    break
                assert_state(page, eng)
                if k == ABS:
                    assert caret_of(page) == (1, 0) and set(words_state(page)[1]["states"]) == {"untyped"}
        res = replay(words, log)
        assert_certificate(page, res)
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert stored["verdict"] == "counted" and [e["k"] for e in stored["log"]].count(CBS) == 3


def test_space_extra_and_end(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "spacing")
    words = ["oak", "elm", "ash"]
    keys = seq(SP, "oak" + "z" * (MAX_EXTRA_LETTERS + 2), " e ", "ash")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=words, typist=t)
        press_key(page, SP)
        advance(page, STEP_MS)
        assert caret_of(page) == (0, 0)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            type_and_check(page, words, keys[1:], check=True)
        assert info.value.status == 201
        info_body = info.value.json()
        page.goto(base + "/")
        prepare(page, base, "words", 10, words=["oak"], typist=t)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info2:
            type_and_check(page, ["oak"], seq("oa "), check=False)
        assert_certificate(page, replay(["oak"], log_of(seq("oa "), STEP_MS)))
        expect(el(page, "result-characters")).to_have_text("2/0/0/1")
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert len(stored["log"]) == len(keys) and stored["characters"]["extra"] == MAX_EXTRA_LETTERS
    assert info2.value.status == 201


def test_wf_correction_rules_ten_words(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "tenwords")
    keys = seq(SP, "amber ", BS, "anchxr ", BS, BS, BS, "or ", "app ", BS, "le ", "archzz ", "as", CBS, "ash ",
               "atic ", CBS, "attic ", "badge ", "barley ", "basin ", "beacon")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=TEN_WORDS, typist=t)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            _, log = type_and_check(page, TEN_WORDS, keys, gap=150)
        res = replay(TEN_WORDS, log)
        assert_certificate(page, res)
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert stored["verdict"] == "counted" and stored["accuracy"] == r2(res.accuracy) and stored["speed"] == r2(res.speed)
    assert stored["characters"] == dict(zip(("correct", "incorrect", "extra", "missed"), res.characters))


def test_letter_marks_contrast(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "contrast")
    words = ["amber", "anchor", "ash"]
    for theme in THEMES:
        put_settings(t, theme=theme)
        with signed_in(browser, base, t) as page:
            expect(page.locator("html")).to_have_attribute("data-theme", theme)
            prepare(page, base, "words", 10, words=words, typist=t)
            type_and_check(page, words, seq("ambxrq a "), check=False)
            assert {"correct", "incorrect", "extra", "missed", "untyped"} <= assert_marks(page, theme)
            for caret in ("line", "block", "underline"):
                put_settings(t, theme=theme, caret=caret)
                page.reload()
                wait_sheet(page)
                expect(el(page, "caret")).to_have_attribute("data-style", caret)
                fill_colour = page.evaluate(CARET_COLOUR_JS)
                assert fill_colour, f"{caret} caret is drawn"
                ratio = contrast(blended(fill_colour, fill_colour[3], THEMES[theme][0]), THEMES[theme][0])
                assert ratio >= CARET_CONTRAST, f"{theme} {caret} caret contrast {ratio:.2f}"
            if theme == "sand":
                prepare(page, base, "words", 10, words=words, typist=t)
                type_and_check(page, words, seq("ambxrq a ", BS, "nchor ash"), check=False)
                expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)
                settle(el(page, "carbon"))
                assert_marks(page, theme, "carbon")
                page.get_by_role("slider", name="Replay position").focus()
                page.keyboard.press("Home")
                advance(page, STEP_MS)
                settle(el(page, "carbon"))
                assert "untyped" in assert_marks(page, theme, "carbon")


def test_text_generator(app_url):
    assert generate(4243, 12, False, False) == "apple cotton bloom valley crane yarrow stone slate stone maple copper willow".split()
    assert generate(4243, 12, True, True) == "Apple. Valley stone maple arch fable 455 sail otter pebble dove canal".split()
    for base, seed0 in ((app_url.rstrip("/"), TEXT_SEED), (short_url(), SHORT_TEXT_SEED)):
        with client(base) as c:
            seeds = []
            for p in (False, True):
                for n in (False, True):
                    tk = issue(c, "time", 15, p, n)
                    assert tk["words"] == generate(tk["seed"], 60, p, n), (p, n)
                    assert tk["seed"] - seed0 >= 1
                    seeds.append(tk["seed"])
                    wk = issue(c, "words", 50, p, n)
                    assert wk["words"] == generate(wk["seed"], 50, p, n)
            assert seeds == sorted(seeds) and len(set(seeds)) == len(seeds)


def test_quick_restart(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "restart")
    with signed_in(browser, base, t) as page:
        tickets = record_requests(page, "/api/tickets")
        runs = record_requests(page, "/api/runs")
        prepare(page, base, "words", 10)
        first = words_state(page)[0]["text"]
        for ch in first[:2]:
            press_key(page, ch)
            advance(page, STEP_MS)
        n = len(tickets)
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Restart test")).to_be_focused()
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_len(tickets, n + 1), "Enter on Restart test requests a ticket")
        assert {k: tickets[-1].post_data_json[k] for k in ("mode", "length")} == {"mode": "words", "length": 10}
        wait_sheet(page)
        expect(el(page, "timer")).to_have_text("0/10")
        eventually(page, lambda: expect(typing_input(page)).to_be_focused(timeout=POLL_MS), "focus returns to the typing input")
        page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="words", exact=True).focus()
        n = len(tickets)
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        assert len(tickets) == n, "with tab, Enter on a radio does nothing"
        put_settings(t, quickRestart="enter")
        page.reload()
        wait_sheet(page)
        press_key(page, words_state(page)[0]["text"][0])
        advance(page, STEP_MS)
        n = len(tickets)
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_len(tickets, n + 1), "Enter restarts with quick restart enter")
        wait_sheet(page)
        page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="words", exact=True).focus()
        n = len(tickets)
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_len(tickets, n + 1), "Enter on a Mode radio restarts")
        expect(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="words", exact=True)).to_be_checked()
        wait_sheet(page)
        open_command(page, "zzzz")
        n = len(tickets)
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        assert len(tickets) == n, "Enter inside the command line never restarts"
        if page.get_by_role("dialog", name="Command line").count():
            page.keyboard.press("Escape")
        click(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="custom", exact=True))
        fill(page.get_by_role("textbox", name="Custom text"), CUSTOM_SAMPLE)
        click(page.get_by_role("button", name="Use text"))
        wait_sheet(page, ["fern", "moss"])
        click(page.get_by_role("button", name="Begin test"))
        press_key(page, "f")
        advance(page, STEP_MS)
        n = len(tickets)
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_len(tickets, n + 1), "Enter restarts the custom test")
        body = tickets[-1].post_data_json
        assert body == {"mode": "custom", "length": None, "punctuation": False, "numbers": False, "text": CUSTOM_SAMPLE}
        assert runs == [], "restarts submit nothing"
        wait_sheet(page, ["fern", "moss"])
        type_and_check(page, ["fern", "moss"], seq(CUSTOM_SAMPLE), check=False)
        expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)
        n = len(tickets)
        click(page.get_by_role("button", name="Next test"))
        eventually(page, lambda: assert_len(tickets, n + 1), "Next test requests a ticket")
        assert tickets[-1].post_data_json["text"] == CUSTOM_SAMPLE
        eventually(page, lambda: expect(typing_input(page)).to_be_focused(timeout=POLL_MS), "Next test focuses the input")


def test_command_line(app_url, browser):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        wait_sheet(page)
        tickets = record_requests(page, "/api/tickets")
        page.get_by_role("button", name="Begin test").focus()
        page.keyboard.press("Escape")
        dialog = page.get_by_role("dialog", name="Command line")
        box = page.get_by_role("combobox", name="Command")
        expect(box).to_be_focused()
        options = page.get_by_role("listbox", name="Commands").get_by_role("option")
        assert [x.strip() for x in options.all_inner_texts()] == COMMANDS
        expect(options.first).to_have_attribute("aria-selected", "true")
        assert box.get_attribute("aria-activedescendant") == options.first.get_attribute("id")
        page.keyboard.press("ArrowUp")
        last = options.nth(len(COMMANDS) - 1)
        expect(last).to_have_attribute("aria-selected", "true")
        lb, ob = rect(page, page.get_by_role("listbox", name="Commands")), rect(page, last)
        assert lb["y"] - 1 <= ob["y"] and ob["y"] + ob["height"] <= lb["y"] + lb["height"] + 1, "active option fully visible"
        page.keyboard.press("ArrowDown")
        expect(options.first).to_have_attribute("aria-selected", "true")
        handle = dialog.element_handle()
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert handle.evaluate("(d) => d.contains(document.activeElement)"), "focus stays inside the dialog"
        box.focus()
        page.keyboard.type("time 60")
        assert [x.strip() for x in options.all_inner_texts()] == ["Time: 60"]
        page.keyboard.press("Enter")
        expect(dialog).to_have_count(0)
        expect(page.get_by_role("status", name="Settings updates")).to_have_text("Time: 60 applied.")
        expect(page.get_by_role("radiogroup", name="Length").get_by_role("radio", name="60", exact=True)).to_be_checked(timeout=WAIT_MS)
        eventually(page, lambda: expect(typing_input(page)).to_be_focused(timeout=POLL_MS), "focus returns to the typing input")
        before = page.locator("html").get_attribute("data-theme")
        open_command(page, "theme carbon")
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        assert page.locator("html").get_attribute("data-theme") == before != "carbon"
        expect(typing_input(page)).to_be_focused()
        wait_sheet(page)
        press_key(page, words_state(page)[0]["text"][0])
        advance(page, STEP_MS)
        n = len(tickets)
        page.keyboard.press("Escape")
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        eventually(page, lambda: assert_len(tickets, n + 1), "a test abandoned by the command line gets a new ticket on close")


def test_typist_settings(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "settings")
    assert t.http.get("/api/settings").json() == DEFAULT_SETTINGS
    with signed_in(browser, base, t, path="/settings") as page:
        for group, choice in (("Theme", "carbon"), ("Caret", "block"), ("Font size", "2"), ("Quick restart", "enter")):
            click(page.get_by_role("radiogroup", name=group).get_by_role("radio", name=choice, exact=True))
        expect(page.locator("html")).to_have_attribute("data-theme", "carbon")
        bg = page.evaluate("() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]")
        assert "rgb({}, {}, {})".format(*THEMES["carbon"][0]) in bg, bg
        click(page.get_by_role("checkbox", name="Smooth caret"))
        click(page.get_by_role("checkbox", name="Blind mode"))
        want = {"theme": "carbon", "caret": "block", "smoothCaret": False, "fontSize": 2, "blindMode": True, "quickRestart": "enter"}
        poll(lambda: t.http.get("/api/settings").json() == want, "GET /api/settings holds the chosen settings")
        page.reload()
        expect(page.get_by_role("radiogroup", name="Theme").get_by_role("radio", name="carbon", exact=True)).to_be_checked()
        expect(page.get_by_role("checkbox", name="Blind mode")).to_be_checked()
        page.goto(base + "/")
        wait_sheet(page)
        expect(el(page, "caret")).to_have_attribute("data-style", "block")
        fs = page.evaluate("() => parseFloat(getComputedStyle(document.querySelector('#words [data-index]')).fontSize)")
        assert abs(fs - 2 * FONT_PX) < 0.5
    with open_app(browser, base + "/") as page:
        wait_sheet(page)
        apply_command(page, "theme ledger")
        expect(page.locator("html")).to_have_attribute("data-theme", "ledger")
        apply_command(page, "caret underline")
        page.reload()
        wait_sheet(page)
        expect(page.locator("html")).to_have_attribute("data-theme", "ledger")
        expect(el(page, "caret")).to_have_attribute("data-style", "underline")
        assert page.request.get(base + "/api/settings").status == 401


def test_wf_restart_and_command_line_journey(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "cmdjourney")
    with signed_in(browser, base, t) as page:
        tickets = record_requests(page, "/api/tickets")
        prepare(page, base, "words", 10)
        press_key(page, words_state(page)[0]["text"][0])
        advance(page, STEP_MS)
        n = len(tickets)
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_len(tickets, n + 1), "Tab then Enter restarts")
        wait_sheet(page)
        for q in ("Time: 60", "Theme: carbon", "Caret: block", "Quick restart: enter"):
            apply_command(page, q)
        expect(page.locator("html")).to_have_attribute("data-theme", "carbon")
        poll(lambda: {k: v for k, v in t.http.get("/api/settings").json().items() if k in ("theme", "caret", "quickRestart")} == {"theme": "carbon", "caret": "block", "quickRestart": "enter"}, "server keeps the command line settings")
        page.reload()
        wait_sheet(page)
        expect(page.locator("html")).to_have_attribute("data-theme", "carbon")
        expect(el(page, "caret")).to_have_attribute("data-style", "block")
        expect(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="time", exact=True)).to_be_checked()
        expect(page.get_by_role("radiogroup", name="Length").get_by_role("radio", name="60", exact=True)).to_be_checked()
        expect(el(page, "timer")).to_have_text("60")
        n = len(tickets)
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_len(tickets, n + 1), "Enter restarts after reload")


def test_wf_restart_and_command_line_latest(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "latest")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "time", 15)
        held: list[Any] = []
        page.route("**/api/tickets", lambda route: held.append(route) if not held else route.continue_())
        click(page.get_by_role("radiogroup", name="Length").get_by_role("radio", name="30", exact=True))
        eventually(page, lambda: assert_len(held, 1), "the first ticket request is held")
        with page.expect_response(lambda r: is_post("/api/tickets")(r) and json.loads(r.request.post_data or "{}").get("length") == 60, timeout=WAIT_MS) as info:
            click(page.get_by_role("radiogroup", name="Length").get_by_role("radio", name="60", exact=True))
        latest = info.value.json()
        wait_sheet(page, latest["words"][:10])
        with page.expect_response(is_post("/api/tickets"), timeout=WAIT_MS):
            held[0].continue_()
        advance(page, STEP_MS)
        wait_sheet(page, latest["words"][:10])
        expect(el(page, "timer")).to_have_text("60")
        page.unroute("**/api/tickets")
        press_key(page, latest["words"][0][0])
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as run_info:
            advance(page, 60000)
        assert json.loads(run_info.value.request.post_data_buffer)["ticketId"] == latest["ticketId"]
        saves: list[Any] = []
        page.route("**/api/settings", lambda route: saves.append(route) if route.request.method == "PUT" and not saves else route.continue_())
        page.goto(base + "/")
        wait_sheet(page)
        apply_command(page, "Theme: cobalt")
        apply_command(page, "Theme: ledger")
        expect(page.locator("html")).to_have_attribute("data-theme", "ledger")
        eventually(page, lambda: assert_len(saves, 1), "the first settings save is held")
        with page.expect_response(lambda r: r.request.method == "PUT" and urlparse(r.url).path == "/api/settings", timeout=WAIT_MS):
            saves[0].continue_()
        expect(page.locator("html")).to_have_attribute("data-theme", "ledger")
        poll(lambda: t.http.get("/api/settings").json()["theme"] == "ledger", "the server ends with the last chosen theme")
        page.unroute("**/api/settings")
        page.reload()
        expect(page.locator("html")).to_have_attribute("data-theme", "ledger")


GEOM_JS = """() => { const a = document.getElementById('words'); const ar = a.getBoundingClientRect();
 const ws = [...a.querySelectorAll('[data-index]')].map(w => { const r = w.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; let hit = false;
  if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) { const e = document.elementFromPoint(cx, cy); hit = !!e && w.contains(e); }
  return {i: Number(w.getAttribute('data-index')), line: Number(w.getAttribute('data-line')), top: r.top, bottom: r.bottom, left: r.left, right: r.right, hit}; });
 return {top: ar.top, bottom: ar.bottom, left: ar.left, right: ar.right, height: ar.height, font: parseFloat(getComputedStyle(a.querySelector('[data-index]')).fontSize), words: ws}; }"""


def assert_three_lines(page: Page, size: float) -> dict[str, Any]:
    g = page.evaluate(GEOM_JS)
    line_px = LINE_FACTOR * size * FONT_PX
    assert abs(g["font"] - size * FONT_PX) < 0.5, g["font"]
    assert abs(g["height"] - 3 * line_px) <= 1, (g["height"], 3 * line_px)
    tops: dict[int, float] = {}
    for w in g["words"]:
        if 1 <= w["line"] <= 3:
            tops.setdefault(w["line"], w["top"])
            assert abs(tops[w["line"]] - w["top"]) <= 1, f"word {w['i']} shares its line's top"
            assert w["top"] >= g["top"] - 1 and w["bottom"] <= g["bottom"] + 1, f"word {w['i']} inside the area"
            assert w["left"] >= g["left"] - 1 and w["right"] <= g["right"] + 1, f"word {w['i']} within the sheet sideways"
        else:
            assert not (w["top"] < g["bottom"] - 1 and w["bottom"] > g["top"] + 1) and not w["hit"], f"word {w['i']} (line {w['line']}) is cut off"
    assert {1, 2, 3} <= set(tops), "three visible lines"
    return g


def test_three_line_view(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "lines")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "time", 60)
        for size in FONT_SIZES:
            put_settings(t, fontSize=size)
            for w, h in VIEWPORTS.values():
                page.set_viewport_size({"width": w, "height": h})
                page.goto(base + "/")
                wait_sheet(page)
                assert_three_lines(page, size)
        put_settings(t, fontSize=1.5)
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(base + "/")
        tk = prepare(page, base, "time", 60)
        st = words_state(page)
        third = min(w["i"] for w in st if w["line"] == 3)
        line1 = [w["i"] for w in st if w["line"] == 1]
        keys = seq(" ".join(tk["words"][:third]) + " ")
        clock = Clock(page)
        for i, k in enumerate(keys):
            clock.press(k, i * 50)
        clock.to(len(keys) * 50)
        st = words_state(page)
        assert caret_of(page) == (third, 0)
        assert st[third]["line"] == 2 and all(st[i]["line"] == 0 for i in line1)
        before_states, before_caret = [w["states"] for w in st], caret_of(page)
        page.set_viewport_size({"width": 768, "height": 1024})
        eventually(page, lambda: assert_three_lines(page, 1.5), "lines are recomputed after the resize")
        st = words_state(page)
        assert st[third]["line"] == 2
        assert [w["states"] for w in st] == before_states and caret_of(page) == before_caret


def test_wf_text_view_warnings_focus(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "focus")
    assert t.http.get("/api/config").json()["focusWarningMs"] == FOCUS_WARNING_MS
    focus_button = lambda p: p.get_by_role("button", name="Click or press any key to focus")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "time", 15, words=SECOND_WORDS, typist=t)
        clock = Clock(page)
        for i, k in enumerate(seq("sun ")):
            clock.press(k, i * STEP_MS)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        clock.to(clock.now + FOCUS_WARNING_MS - 1)
        expect(words_area(page)).not_to_have_attribute("data-blurred", "true")
        expect(focus_button(page)).to_have_count(0)
        clock.to(clock.now + 1)
        expect(words_area(page)).to_have_attribute("data-blurred", "true")
        expect(focus_button(page)).to_be_visible()
        clock.to(4000)
        expect(el(page, "timer")).to_have_text("11")
        states = [w["states"] for w in words_state(page)]
        page.keyboard.press("q")
        expect(typing_input(page)).to_be_focused()
        clock.to(4000 + STEP_MS)
        assert [w["states"] for w in words_state(page)] == states and caret_of(page) == (1, 0)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            clock.to(15000)
        expect(page.get_by_role("region", name="Certificate")).to_be_visible()
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        advance(page, FOCUS_WARNING_MS * 3)
        expect(focus_button(page)).to_have_count(0)
        if words_area(page).count():
            expect(words_area(page)).not_to_have_attribute("data-blurred", "true")
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert [e["k"] for e in stored["log"]] == seq("sun ")


def test_caps_lock_warning(app_url, browser):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        wait_sheet(page)
        region = page.get_by_role("status", name="Caps Lock")
        h = record_region(region)
        page.keyboard.press("CapsLock")
        expect(region).to_have_text("Caps Lock is on")
        page.keyboard.press("CapsLock")
        expect(region).to_have_text("")
        typing_input(page).dispatch_event("keydown", {"key": "Shift", "modifierCapsLock": True})
        expect(region).to_have_text("Caps Lock is on")
        assert times_announced(h, "Caps Lock is on") == 2
        first = words_state(page)[0]["text"]
        press_key(page, first[0])
        advance(page, STEP_MS)
        assert words_state(page)[0]["states"][0] == "correct"
        typing_input(page).dispatch_event("keydown", {"key": "Shift", "modifierCapsLock": False})
        expect(region).to_have_text("")


def test_blind_mode(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "blind")
    put_settings(t, blindMode=True)
    words = ["amber", "anchor", "apple"]
    keys = seq("ambxrqq an ", "apple")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=words, typist=t)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            _, log = type_and_check(page, words, keys, blind=True)
        res = replay(words, log)
        assert_certificate(page, res)
        info_body = info.value.json()
    assert info.value.status == 201 and info_body["speed"] == r2(res.speed)


def test_wf_text_view_warnings_journey(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "viewjourney")
    put_settings(t, fontSize=3, blindMode=True)
    with signed_in(browser, base, t) as page:
        tk = prepare(page, base, "time", 30)
        st = words_state(page)
        third = min(w["i"] for w in st if w["line"] == 3)
        keys = seq(" ".join(tk["words"][:third]) + " ")
        clock = Clock(page)
        for i, k in enumerate(keys):
            clock.press(k, i * 60)
        clock.to(len(keys) * 60)
        assert words_state(page)[third]["line"] == 2
        page.set_viewport_size({"width": 375, "height": 812})
        eventually_clocked(clock, lambda: assert_three_lines(page, 3), "lines recompute after the resize")
        assert words_state(page)[third]["line"] == 2 and caret_of(page) == (third, 0)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        clock.to(clock.now + FOCUS_WARNING_MS)
        button = page.get_by_role("button", name="Click or press any key to focus")
        expect(button).to_be_visible()
        click(button)
        expect(typing_input(page)).to_be_focused()
        page.keyboard.press("CapsLock")
        expect(page.get_by_role("status", name="Caps Lock")).to_have_text("Caps Lock is on")
        page.keyboard.press("CapsLock")
        expect(page.get_by_role("status", name="Caps Lock")).to_have_text("")
        at = clock.now + STEP_MS
        clock.press("q", at)
        clock.to(at + STEP_MS)
        assert words_state(page)[third]["visible"][0] == "typed"
        log = log_of(keys, 60) + [{"k": "q", "t": at}]
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            clock.to(30000)
        res = replay(tk["words"], log, 30000)
        assert_certificate(page, res)
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert stored["verdict"] == "counted" and stored["log"] == log


DELETE_JS = """(args) => { const [el, inputType] = args; el.focus(); const bi = new InputEvent('beforeinput', {inputType, bubbles: true, cancelable: true});
 if (el.dispatchEvent(bi)) { el.value = inputType === 'deleteWordBackward' ? el.value.replace(/\\S*\\s*$/, '') : el.value.slice(0, -1); el.dispatchEvent(new InputEvent('input', {inputType, bubbles: true})); } }"""


def soft_key(page: Page, k: str) -> None:
    if k == BS or k == CBS:
        handle = typing_input(page).element_handle()
        page.evaluate(DELETE_JS, [handle, "deleteContentBackward" if k == BS else "deleteWordBackward"])
    else:
        page.keyboard.insert_text(" " if k == SP else k)


def test_onscreen_keyboard_input(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "softkeys")
    words = ["ash", "elm", "fern"]
    keys = seq("asx", BS, "h ", "e", "lq", CBS, "elm fern")
    with signed_in(browser, base, t) as page:
        page.set_viewport_size({"width": 375, "height": 812})
        prepare(page, base, "words", 10, words=words, typist=t)
        y0, top0 = page.evaluate("() => scrollY"), rect(page, words_area(page))["y"]
        eng = Engine(words)
        cdp = session(page)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            for i, k in enumerate(keys):
                if i:
                    advance(page, STEP_MS)
                if i == 6:
                    cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Unidentified", "windowsVirtualKeyCode": 229})
                    soft_key(page, k)
                    cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Unidentified", "windowsVirtualKeyCode": 229})
                else:
                    soft_key(page, k)
                eng.key(k, i * STEP_MS)
                if not eng.ended:
                    advance(page, 1)
                    assert_state(page, eng)
                    assert page.evaluate("() => scrollY") == y0 and abs(rect(page, words_area(page))["y"] - top0) <= 1
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert [e["k"] for e in stored["log"]] == keys


def test_published_breakpoints(app_url, browser):
    base = app_url.rstrip("/")
    runs = [{"mode": "time", "length": 15, "punctuation": False, "numbers": False, "speed": 40, "raw": 42, "accuracy": 95, "consistency": 80, "finishedAt": "2026-03-01T10:00:00.000Z"}]
    t = make_typist(base, "layout", runs=runs)
    _, run, _ = counted_run(t, WORKED_WORDS, WORKED_KEYS)
    with signed_in(browser, base, t) as page:
        for name, (w, h) in VIEWPORTS.items():
            page.set_viewport_size({"width": w, "height": h})
            page.goto(base + "/")
            wait_sheet(page)
            layout(page)
            nav = page.get_by_role("navigation", name="Folders")
            nb, wb = rect(page, nav), rect(page, words_area(page))
            if name == "phone":
                assert abs(nb["y"] + nb["height"] - h) <= 1, "phone navigation is fixed to the bottom"
                for link in nav.get_by_role("link").all():
                    assert rect(page, link)["height"] >= TARGET_PX
            else:
                assert nb["y"] + nb["height"] <= wb["y"], "folder tabs sit above the open folder"
            page.goto(base + f"/runs/{run['runId']}")
            expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)
            layout(page)
            cb, sb = rect(page, el(page, "carbon")), rect(page, el(page, "seal"))
            if name == "desktop":
                assert cb["x"] >= sb["x"] + sb["width"], "carbon panel beside the card"
            else:
                assert cb["y"] >= sb["y"] + sb["height"], "carbon panel below the card"
            page.goto(base + "/history")
            if name == "phone":
                expect(page.get_by_role("list", name="History")).to_be_visible(timeout=WAIT_MS)
                expect(page.get_by_role("table", name="History")).to_have_count(0)
            else:
                expect(page.get_by_role("table", name="History")).to_be_visible(timeout=WAIT_MS)
                expect(page.get_by_role("list", name="History")).to_have_count(0)
            layout(page)
            page.goto(base + "/boards")
            expect(page.get_by_role("table", name="Leaderboard")).to_be_visible(timeout=WAIT_MS)
            layout(page)


def touch_drag(page: Page, x0: float, y0: float, x1: float, y1: float, steps: int = 8) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def scrub_by_touch(page: Page, maximum: int) -> None:
    slider = page.get_by_role("slider", name="Replay position")
    slider.scroll_into_view_if_needed()
    y0 = page.evaluate("() => scrollY")
    b = rect(page, slider)
    cy = b["y"] + b["height"] / 2
    touch_drag(page, b["x"] + b["width"] - 2, cy, b["x"] + b["width"] * 0.4, cy + 40)
    advance(page, STEP_MS)
    value = slider.get_attribute("aria-valuenow")
    assert value is not None and re.fullmatch(r"\d+", value) and 0 <= int(value) < maximum, value
    assert page.evaluate("() => scrollY") == y0, "touch scrubbing never scrolls the page"
    touch_drag(page, b["x"] + b["width"] * 0.4, cy, b["x"] + b["width"] * 0.7, cy - 40)
    advance(page, STEP_MS)
    assert re.fullmatch(r"\d+", slider.get_attribute("aria-valuenow") or "") and page.evaluate("() => scrollY") == y0


def test_wf_phone_typing_scrub(app_url, browser):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        tk = prepare(page, base, "time", 15)
        clock = Clock(page)
        for i, k in enumerate(seq(tk["words"][0] + " " + tk["words"][1])):
            clock.press(k, i * 400)
        clock.to(15000)
        expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)
        expect(page.get_by_role("slider", name="Replay position")).to_have_attribute("aria-valuemax", "15")
        scrub_by_touch(page, 15)


def test_wf_phone_typing_journey(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "phone")
    with signed_in(browser, base, t) as page:
        page.set_viewport_size({"width": 375, "height": 812})
        wait_sheet(page)
        tap(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="words", exact=True))
        wait_sheet(page)
        tap(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="custom", exact=True))
        dialog = page.get_by_role("dialog", name="Custom text")
        db = rect(page, dialog)
        assert db["x"] >= 0 and db["y"] >= 0 and db["x"] + db["width"] <= 375 and db["y"] + db["height"] <= 812
        tap(page.get_by_role("textbox", name="Custom text"))
        fill(page.get_by_role("textbox", name="Custom text"), "fern moss reed")
        tap(page.get_by_role("button", name="Use text"))
        wait_sheet(page, ["fern", "moss", "reed"])
        page.keyboard.press("Escape")
        cl = page.get_by_role("dialog", name="Command line")
        cb = rect(page, cl)
        assert cb["x"] >= 0 and cb["y"] >= 0 and cb["x"] + cb["width"] <= 375 and cb["y"] + cb["height"] <= 812
        last = page.get_by_role("option", name="Quick restart: enter", exact=True)
        last.scroll_into_view_if_needed()
        ob = rect(page, last)
        hit = last.evaluate("(el, p) => { const e = document.elementFromPoint(p[0], p[1]); return !!e && el.contains(e); }", [ob["x"] + ob["width"] / 2, ob["y"] + ob["height"] / 2])
        assert hit, "the last command option is hit-testable"
        tap(last)
        expect(cl).to_have_count(0)
        expect(page.get_by_role("status", name="Settings updates")).to_have_text("Quick restart: enter applied.")
        click(page.get_by_role("button", name="Begin test"))
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            for i, k in enumerate(seq("fern moss reed")):
                if i:
                    advance(page, 300)
                soft_key(page, k)
        expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)
        layout(page)
        scrub_by_touch(page, math.ceil(replay(["fern", "moss", "reed"], log_of(seq("fern moss reed"), 300)).duration / 1000))
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert stored["verdict"] == "counted" and stored["mode"] == "custom" and stored["words"] == ["fern", "moss", "reed"]


def test_quote_tests_and_controls(app_url, browser):
    base = app_url.rstrip("/")
    groups = {"short": ["q1", "q2"], "medium": ["q3", "q4"], "long": ["q5", "q6"], "all": list(QUOTES)}
    with client(base) as c:
        for g, ids in groups.items():
            tk = issue(c, "quote", g)
            assert tk["quoteId"] == ids[int(mulberry32(tk["seed"])() * len(ids))]
            assert tk["words"] == QUOTES[tk["quoteId"]][1].split(" ")
    t = make_typist(base, "quotes")
    with signed_in(browser, base, t) as page:
        tickets = record_requests(page, "/api/tickets")
        prepare(page, base, "time", 15, punctuation=True)
        next_text(base, f"typist:{t.email}", quote_id="q1")
        click(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="quote", exact=True))
        wait_sheet(page, QUOTES["q1"][1].split(" "))
        body = tickets[-1].post_data_json
        assert body["mode"] == "quote" and body["punctuation"] is False and body["numbers"] is False
        expect(el(page, "quote-source")).to_have_text(QUOTES["q1"][2])
        expect(page.get_by_role("checkbox", name="Punctuation")).to_have_count(0)
        expect(page.get_by_role("checkbox", name="Numbers")).to_have_count(0)
        assert [x.strip() for x in page.get_by_role("radiogroup", name="Length").get_by_role("radio").all_inner_texts()] in (["short", "medium", "long", "all"], ["", "", "", ""])
        page.get_by_role("navigation", name="Folders").get_by_role("link", name="Test").focus()
        names = tab_order(page, 10)
        assert "Punctuation" not in names and "Numbers" not in names
        page.get_by_role("button", name="Begin test").focus()
        click(page.get_by_role("button", name="Begin test"))
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            type_and_check(page, QUOTES["q1"][1].split(" "), seq(QUOTES["q1"][1]), gap=100, check=False)
        expect(page.get_by_role("region", name="Certificate")).to_be_visible()
        assert info.value.status == 201
        page.goto(base + "/")
        wait_sheet(page)
        click(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="custom", exact=True))
        fill(page.get_by_role("textbox", name="Custom text"), "fern moss")
        click(page.get_by_role("button", name="Use text"))
        wait_sheet(page, ["fern", "moss"])
        assert tickets[-1].post_data_json == {"mode": "custom", "length": None, "punctuation": False, "numbers": False, "text": "fern moss"}
        expect(page.get_by_role("radiogroup", name="Length")).to_have_count(0)
        expect(page.get_by_role("checkbox", name="Punctuation")).to_have_count(0)
        page.get_by_role("navigation", name="Folders").get_by_role("link", name="Test").focus()
        names = tab_order(page, 10)
        assert not {"Punctuation", "Numbers", "15", "short"} & set(names)


def custom_count(chars: int, words: int) -> str:
    return f"{chars} of 2000 characters, {words} of 400 words"


def test_wf_quote_and_custom_limit(app_url, browser):
    base = app_url.rstrip("/")
    emoji_words = " ".join(["\U0001F600" * 4] * CUSTOM_MAX_WORDS)
    with client(base) as c:
        assert issue(c, "custom", None, text="  fern \n\t moss  ")["words"] == ["fern", "moss"]
        for text_, ok in (("a" * CUSTOM_MAX_CHARS, True), ("a" * (CUSTOM_MAX_CHARS + 1), False),
                          (" ".join(["a"] * CUSTOM_MAX_WORDS), True), (" ".join(["a"] * (CUSTOM_MAX_WORDS + 1)), False),
                          ("\U0001F600" * CUSTOM_MAX_CHARS, True), ("\U0001F600" * (CUSTOM_MAX_CHARS + 1), False), (emoji_words, True)):
            r = c.post("/api/tickets", json=ticket_body("custom", None, text=text_))
            if ok:
                assert r.status_code == 201, r.text
            else:
                assert (r.status_code, r.json()) == (422, {"error": "custom_text_too_long"})
    t = make_typist(base, "customlim")
    with signed_in(browser, base, t) as page:
        tickets = record_requests(page, "/api/tickets")
        wait_sheet(page)
        click(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="custom", exact=True))
        box, use, count = page.get_by_role("textbox", name="Custom text"), page.get_by_role("button", name="Use text"), el(page, "custom-count")
        fill(box, "  fern \n  moss  ")
        expect(count).to_have_text(custom_count(9, 2))
        fill(box, emoji_words)
        expect(count).to_have_text(custom_count(1999, CUSTOM_MAX_WORDS))
        expect(use).to_be_enabled()
        fill(box, "a" * (CUSTOM_MAX_CHARS + 1))
        expect(page.get_by_text("Custom text can have at most 2000 characters and 400 words.", exact=True)).to_be_visible()
        expect(use).to_be_disabled()
        n = len(tickets)
        box.focus()
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        assert len(tickets) == n, "Enter does nothing while Use text is disabled"
        fill(box, " ".join(["a"] * (CUSTOM_MAX_WORDS + 1)))
        expect(use).to_be_disabled()
        fill(box, "fern moss")
        expect(use).to_be_enabled()
        click(use)
        wait_sheet(page, ["fern", "moss"])
        click(page.get_by_role("button", name="Begin test"))
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            type_and_check(page, ["fern", "moss"], seq("fern moss"), check=False)
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert stored["mode"] == "custom" and stored["words"] == ["fern", "moss"] and stored["verdict"] == "counted"


def test_custom_text_dialog(app_url, browser):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        tickets = record_requests(page, "/api/tickets")
        prepare(page, base, "time", 15)
        dialog = page.get_by_role("dialog", name="Custom text")
        expect(dialog).to_have_count(0)
        assert page.evaluate("() => { const c = document.getElementById('custom-count'); return !c || c.getClientRects().length === 0 || getComputedStyle(c).visibility === 'hidden'; }")
        click(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="custom", exact=True))
        expect(dialog).to_be_visible()
        expect(page.get_by_role("textbox", name="Custom text")).to_be_focused()
        expect(page.get_by_role("textbox", name="Custom text")).to_have_value("")
        db = rect(page, dialog)
        assert db["x"] >= 0 and db["y"] >= 0 and db["x"] + db["width"] <= page.viewport_size["width"] and db["y"] + db["height"] <= page.viewport_size["height"]
        assert dialog.evaluate("(d, p) => d.contains(document.elementFromPoint(p[0], p[1]))", [db["x"] + db["width"] / 2, db["y"] + db["height"] / 2])
        h = dialog.element_handle()
        for key in ["Tab"] * 5 + ["Shift+Tab"] * 5:
            page.keyboard.press(key)
            assert h.evaluate("(d) => d.contains(document.activeElement)")
        n = len(tickets)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        time_radio = page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="time", exact=True)
        expect(time_radio).to_be_checked()
        eventually(page, lambda: assert_len(tickets, n + 1), "Escape with no remembered text requests the previous mode's ticket")
        assert tickets[-1].post_data_json["mode"] == "time"
        wait_sheet(page)
        expect(time_radio).to_be_focused()
        click(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="custom", exact=True))
        fill(page.get_by_role("textbox", name="Custom text"), CUSTOM_SAMPLE)
        click(page.get_by_role("button", name="Use text"))
        wait_sheet(page, ["fern", "moss"])
        expect(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="custom", exact=True)).to_be_focused()
        open_command(page, "mode custom")
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        expect(page.get_by_role("status", name="Settings updates")).to_have_text("Mode: custom applied.")
        expect(page.get_by_role("textbox", name="Custom text")).to_have_value(CUSTOM_SAMPLE)
        n = len(tickets)
        page.keyboard.press("Escape")
        eventually(page, lambda: assert_len(tickets, n + 1), "Escape with remembered text requests a custom ticket")
        assert tickets[-1].post_data_json["text"] == CUSTOM_SAMPLE
        wait_sheet(page, ["fern", "moss"])
        expect(typing_input(page)).to_be_focused()
        page.set_viewport_size({"width": 375, "height": 812})
        open_command(page, "mode custom")
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        db = rect(page, dialog)
        assert db["x"] >= 0 and db["y"] >= 0 and db["x"] + db["width"] <= 375 and db["y"] + db["height"] <= 812


def test_wf_quote_and_custom_journey(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "qcjourney")
    with signed_in(browser, base, t) as page:
        wait_sheet(page)
        next_text(base, f"typist:{t.email}", quote_id="q2")
        click(page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="quote", exact=True))
        words = QUOTES["q2"][1].split(" ")
        wait_sheet(page, words)
        expect(el(page, "quote-source")).to_have_text(QUOTES["q2"][2])
        click(page.get_by_role("button", name="Begin test"))
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as q_info:
            type_and_check(page, words, seq(QUOTES["q2"][1]), gap=100, check=False)
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        q_info_body = q_info.value.json()
        page.goto(base + "/")
        wait_sheet(page)
        apply_command(page, "Quote length: short")
        expect(page.get_by_role("radiogroup", name="Length").get_by_role("radio", name="short", exact=True)).to_be_checked(timeout=WAIT_MS)
        wait_sheet(page)
        assert " ".join(w["text"] for w in words_state(page)) in (QUOTES["q1"][1], QUOTES["q2"][1])
        open_command(page, "mode custom")
        page.keyboard.press("Enter")
        expect(page.get_by_role("textbox", name="Custom text")).to_be_focused()
        page.keyboard.press("Control+A")
        page.keyboard.type("fern moss reed")
        page.keyboard.press("Enter")
        wait_sheet(page, ["fern", "moss", "reed"])
        expect(typing_input(page)).to_be_focused()
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as c_info:
            type_and_check(page, ["fern", "moss", "reed"], seq("fern moss reed"), check=False)
        c_info_body = c_info.value.json()
    q = t.http.get(f"/api/runs/{q_info_body['runId']}").json()
    c = t.http.get(f"/api/runs/{c_info_body['runId']}").json()
    assert q["mode"] == "quote" and q["quoteId"] == "q2" and q["verdict"] == "counted"
    assert c["mode"] == "custom" and c["words"] == ["fern", "moss", "reed"] and c["verdict"] == "counted"


def assert_carbon(page: Page, words: list[str], log: list[dict[str, Any]], s: int, maximum: int) -> None:
    eng = feed(words, log, None, None if s == maximum else s * 1000)
    full = feed(words, log, None)
    dom = words_state(page, "carbon")
    assert len(dom) == full.cur + 1, "carbon shows every word the run reached"
    assert all(w["line"] is None for w in dom), "carbon words carry no data-line"
    assert [w["states"] for w in dom] == eng.states()[: full.cur + 1], f"carbon states at {s}"
    assert caret_of(page, "carbon-caret") == eng.caret()
    res = replay(words, log)
    speed = "0.00" if s == 0 else f2(res.per_second[s - 1][0])
    expect(el(page, "replay-speed")).to_have_text(speed)
    slider = page.get_by_role("slider", name="Replay position")
    expect(slider).to_have_attribute("aria-valuenow", str(s))
    expect(slider).to_have_attribute("aria-valuetext", f"{s} seconds, speed {speed}")
    points = page.get_by_role("img", name="Speed over time")
    rows = page.get_by_role("table", name="Speed over time").get_by_role("row")
    for k in range(1, maximum + 1):
        cur_point = points.locator(f'[data-second="{k}"]').get_attribute("aria-current")
        cur_row = rows.nth(k).get_attribute("aria-current")
        assert (cur_point == "true") == (k == s) and (cur_row == "true") == (k == s), f"second {k} current at {s}"


def test_wf_carbon_replay_address(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "address", runs=[{"mode": "words", "length": 10, "punctuation": False, "numbers": False, "speed": 40, "raw": 42, "accuracy": 95, "consistency": 80, "finishedAt": "2026-03-02T10:00:00.000Z"}])
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            type_and_check(page, WORKED_WORDS, WORKED_KEYS, check=False)
        slider = page.get_by_role("slider", name="Replay position")
        expect(slider).to_have_attribute("aria-valuemin", "0")
        expect(slider).to_have_attribute("aria-valuemax", "3")
        expect(slider).to_have_attribute("aria-valuenow", "3")
        expect(slider).to_have_attribute("aria-valuetext", "3 seconds, speed 55.00")
        url0 = page.url
        slider.focus()
        for key, want in (("Home", 0), ("ArrowRight", 1), ("PageUp", 3), ("PageDown", 0), ("ArrowLeft", 0), ("End", 3), ("ArrowLeft", 2), ("ArrowDown", 1), ("ArrowUp", 2), ("ArrowRight", 3), ("ArrowRight", 3)):
            page.keyboard.press(key)
            expect(slider).to_have_attribute("aria-valuenow", str(want))
        assert page.url == url0
        run_id = info.value.json()["runId"]
        page.goto(base + "/")
        page.goto(base + f"/runs/{run_id}?at=1")
        expect(slider).to_have_attribute("aria-valuenow", "1", timeout=WAIT_MS)
        expect(slider).to_have_attribute("aria-valuetext", "1 seconds, speed 60.00")
        depth = page.evaluate("() => history.length")
        slider.focus()
        page.keyboard.press("ArrowRight")
        expect(page).to_have_url(re.compile(rf"/runs/{run_id}\?at=2$"))
        page.keyboard.press("ArrowRight")
        expect(page).to_have_url(re.compile(r"\?at=3$"))
        assert page.evaluate("() => history.length") == depth
        page.reload()
        expect(slider).to_have_attribute("aria-valuenow", "3", timeout=WAIT_MS)
        page.go_back()
        expect(page).not_to_have_url(re.compile(rf"/runs/{run_id}"))
        for at, want in (("-3", "0"), ("99", "3"), ("1.5", "3")):
            page.goto(base + f"/runs/{run_id}?at={at}")
            expect(slider).to_have_attribute("aria-valuenow", want, timeout=WAIT_MS)
            expect(page).to_have_url(re.compile(rf"\?at={want}$"))
        page.goto(base + f"/runs/{run_id}")
        expect(slider).to_have_attribute("aria-valuenow", "3", timeout=WAIT_MS)
        assert urlparse(page.url).query == ""
        grading_id = history_runs(t, "&mode=words")[-1]["runId"]
        page.goto(base + f"/runs/{grading_id}?at=1")
        expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)
        expect(slider).to_have_count(0)
        assert page.url.endswith(f"/runs/{grading_id}?at=1")


def test_carbon_strike_state(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "carbon")
    words = ["amber", "anchor", "ash"]
    keys = seq("amb", "x", BS, "err an ", BS, "chor ash")
    _, run, res = counted_run(t, words, keys, gap=250)
    log = log_of(keys, 250)
    maximum = math.ceil(res.duration / 1000)
    with signed_in(browser, base, t, path=f"/runs/{run['runId']}?at=0", reduced_motion="reduce") as page:
        slider = page.get_by_role("slider", name="Replay position")
        expect(slider).to_have_attribute("aria-valuenow", "0", timeout=WAIT_MS)
        expect(slider).to_have_attribute("aria-valuemax", str(maximum))
        assert_carbon(page, words, log, 0, maximum)
        slider.focus()
        for s in list(range(1, maximum + 1)) + list(range(maximum - 1, -1, -1)):
            page.keyboard.press("ArrowRight" if s > int(slider.get_attribute("aria-valuenow")) else "ArrowLeft")
            assert animations(el(page, "carbon")) == [], "no ink-in frames under reduced motion"
            assert_carbon(page, words, log, s, maximum)


def test_stored_run_replay(app_url, browser):
    base = app_url.rstrip("/")
    runs = [{"mode": "time", "length": 60, "punctuation": True, "numbers": False, "speed": 77.5, "raw": 80.25, "accuracy": 96.5, "consistency": 81, "finishedAt": stamp(-HIST_BACK)}]
    t = make_typist(base, "stored", runs=runs)
    _, run, res = counted_run(t, WORKED_WORDS, WORKED_KEYS)
    tk = fixed_ticket(t, "words", 10, WORKED_WORDS)
    body, _ = run_body(tk["ticketId"], WORKED_WORDS, WORKED_LOG)
    body["speed"] = 70.125
    refused = submit(t.http, body).json()
    stored = t.http.get(f"/api/runs/{run['runId']}").json()
    grading_id = [r for r in history_runs(t) if r["mode"] == "time"][0]["runId"]
    with signed_in(browser, base, t, path=f"/runs/{run['runId']}") as page:
        zone(page, KIRITIMATI)
        assert_certificate(page, res)
        finished = parse_iso(stored["finishedAt"]).strftime("%Y-%m-%d %H:%M UTC")
        expect(el(page, "result-finished")).to_have_text(finished)
        expect(seal(page)).to_contain_text("Counted")
        expect(el(page, "proof-key")).to_have_text(f"Proof {stored['proofKey'][:16]}")
        assert [w["states"] for w in words_state(page, "carbon")] == replay(WORKED_WORDS, WORKED_LOG).engine.states()
        assert_tables(page, res)
        page.goto(base + f"/runs/{grading_id}")
        expect(el(page, "result-speed")).to_have_text(f2(runs[0]["speed"]), timeout=WAIT_MS)
        expect(el(page, "result-raw")).to_have_text(f2(runs[0]["raw"]))
        expect(el(page, "result-finished")).to_have_text(parse_iso(runs[0]["finishedAt"]).strftime("%Y-%m-%d %H:%M UTC"))
        expect(seal(page)).to_contain_text("Counted")
        for gone in (el(page, "carbon"), page.get_by_role("slider", name="Replay position"), page.get_by_role("table", name="Speed over time")):
            expect(gone).to_have_count(0)
        page.goto(base + f"/runs/{refused['runId']}")
        expect(el(page, "result-speed")).to_have_text(f2(body["speed"]), timeout=WAIT_MS)
        expect(seal(page)).to_have_text(f"Not counted: {REASONS['replay_mismatch']}")
        expect(el(page, "carbon")).to_have_count(0)


def test_wf_carbon_replay_journey(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "carbonjny")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            type_and_check(page, WORKED_WORDS, WORKED_KEYS, check=False)
        slider = page.get_by_role("slider", name="Replay position")
        slider.focus()
        page.keyboard.press("Home")
        speeds = []
        for s in range(0, 4):
            if s:
                page.keyboard.press("ArrowRight")
            advance(page, STEP_MS)
            assert_carbon(page, WORKED_WORDS, WORKED_LOG, s, 3)
            speeds.append(el(page, "replay-speed").inner_text().strip())
        assert speeds == ["0.00", "60.00", "48.00", "55.00"]
        info_body = info.value.json()
    stored = t.http.get(f"/api/runs/{info_body['runId']}").json()
    assert [p["speed"] for p in stored["perSecond"]] == [60, 48, 55] and [p["errors"] for p in stored["perSecond"]] == [0, 1, 0]


def ui_signup(page: Page, name: str, email: str, password: str = PASSWORD) -> None:
    fill(page.get_by_role("textbox", name="Display name"), name)
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), password)
    click(page.get_by_role("button", name="Create account"))


def test_signup_and_verification(app_url, browser, mail):
    base = app_url.rstrip("/")
    name, email = fresh_identity("signup")
    with open_app(browser, base + "/signup") as page:
        ui_signup(page, name, email)
        expect(page.get_by_role("heading", name="Check your email")).to_be_visible(timeout=WAIT_MS)
        expect(page.get_by_text(f"We sent a verification link to {email}.", exact=True)).to_be_visible()
        me = page.request.get(base + "/api/me").json()
        assert me["name"] == name and me["verified"] is False
        msgs = wait_mail(mail, email, "Verify your Strikeproof account")
        assert addresses(msgs[0].get("From")) == [mail_from_address()]
        token = mailed_token(msgs[0], "Verify", "verify")
        page.goto(base + f"/verify/{token}")
        expect(page.get_by_role("heading", name="Email verified")).to_be_visible(timeout=WAIT_MS)
        expect(page.get_by_text("Your runs will now be filed.", exact=True)).to_be_visible()
        assert page.request.get(base + "/api/me").json()["verified"] is True
        page.goto(base + f"/verify/{token}")
        expect(page.get_by_role("heading", name="Link expired")).to_be_visible(timeout=WAIT_MS)
        expect(page.get_by_text("This link has expired or was already used.", exact=True)).to_be_visible()
        page.goto(base + "/signup")
        ui_signup(page, name, email.upper())
        expect(page.get_by_text("An account with that email already exists.", exact=True)).to_be_visible(timeout=WAIT_MS)
    assert len(mails_to(mail, email, "Verify your Strikeproof account")) == 1
    with client(base) as c:
        assert (lambda r: (r.status_code, r.json()))(c.post("/api/verify", json={"token": token})) == (410, {"error": "link_expired"})
        r = c.post("/api/signup", json={"name": "x" * 25, "email": "nope", "password": SHORT_PASSWORD})
        assert r.status_code == 422 and r.json()["error"] == "invalid_fields"
        assert set(r.json()["errors"].values()) == {"Display name must be 1 to 24 characters.", "Enter a valid email address.", "Password must be at least 10 characters."}
    sname, semail = fresh_identity("expire")
    with client(short_url()) as c:
        r = c.post("/api/signup", json={"name": sname, "email": semail, "password": PASSWORD})
        assert r.status_code == 201 and r.json()["verified"] is False and r.json()["mail"] == "sent"
        token2 = mailed_token(wait_mail(mail, semail, "Verify your Strikeproof account")[0], "Verify", "verify", base=short_url())
        elapse(short_url(), SHORT_VERIFY_TTL_S + 1)
        r = c.post("/api/verify", json={"token": token2})
        assert (r.status_code, r.json()) == (410, {"error": "link_expired"})
        assert c.get("/api/me").json()["verified"] is False


def test_signin_and_reset(app_url, browser, mail):
    base = app_url.rstrip("/")
    t, limited = make_typists(base, "signin", 2)
    with client(base) as c:
        r = c.post("/api/session", json={"email": t.email.upper(), "password": PASSWORD})
        assert r.status_code == 200 and r.json()["name"] == t.name and r.json()["verified"] is True
        r = c.post("/api/session", json={"email": t.email, "password": NEW_PASSWORD})
        assert (r.status_code, r.json()) == (401, {"error": "invalid_credentials"})
    answers = parallel(12, lambda i: httpx.post(base + "/api/session", json={"email": limited.email, "password": NEW_PASSWORD}, headers={"Origin": origin(base)}, timeout=HTTP_TIMEOUT_S))
    codes = Counter(a.status_code for a in answers)
    assert codes == {401: 5, 429: 7}, codes
    for a in answers:
        if a.status_code == 429:
            assert a.json()["error"] == "too_many_attempts" and 1 <= a.json()["retryAfter"] <= 60
    r = httpx.post(base + "/api/session", json={"email": limited.email, "password": PASSWORD}, headers={"Origin": origin(base)})
    assert r.status_code == 429, "the right password is refused while limited"
    _, ghost = fresh_identity("ghost")
    seen = [httpx.post(base + "/api/session", json={"email": ghost, "password": PASSWORD}, headers={"Origin": origin(base)}).status_code for _ in range(6)]
    assert seen == [401] * 5 + [429]
    with open_app(browser, base + "/signin") as page:
        fill(page.get_by_role("textbox", name="Email"), t.email)
        fill(page.get_by_label("Password", exact=True), NEW_PASSWORD)
        page.keyboard.press("Enter")
        alert_says(page, "Email or password is incorrect.")
        fill(page.get_by_role("textbox", name="Email"), limited.email)
        page.keyboard.press("Enter")
        alert_says(page, re.compile(r"^Too many attempts\. Try again in \d+ seconds\.$"))
        for who in (t.email, ghost):
            page.goto(base + "/reset")
            fill(page.get_by_role("textbox", name="Email"), who)
            click(page.get_by_role("button", name="Send reset link"))
            expect(page.get_by_text("If that email has an account, a reset link is on its way.", exact=True)).to_be_visible(timeout=WAIT_MS)
    with client(base) as c:
        r = c.post("/api/password-reset", json={"email": ghost})
        assert (r.status_code, r.json()) == (202, {"status": "accepted"})
    token = mailed_token(wait_mail(mail, t.email, "Reset your Strikeproof password")[0], "Reset", "reset")
    assert mails_to(mail, ghost, "Reset your Strikeproof password") == []
    with client(base) as c:
        r = c.post("/api/password-reset/confirm", json={"token": token, "password": SHORT_PASSWORD})
        assert r.status_code == 422 and r.json()["error"] == "invalid_fields"
        r = c.post("/api/password-reset/confirm", json={"token": token, "password": NEW_PASSWORD})
        assert (r.status_code, r.json()) == (200, {"status": "changed"})
        r = c.post("/api/password-reset/confirm", json={"token": token, "password": NEW_PASSWORD})
        assert (r.status_code, r.json()) == (410, {"error": "link_expired"})
        assert c.post("/api/session", json={"email": t.email, "password": PASSWORD}).status_code == 401
        assert c.post("/api/session", json={"email": t.email, "password": NEW_PASSWORD}).status_code == 200


class Relay:

    def __init__(self, port: int, target: tuple[str, int]) -> None:
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen()
        self.target = target
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            up = socket.create_connection(self.target)
            for a, b in ((conn, up), (up, conn)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(a: socket.socket, b: socket.socket) -> None:
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

    def close(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@contextmanager
def app_copy(env: dict[str, str]) -> Iterator[str]:
    port = free_port()
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env={**os.environ, **env, "APP_PUBLIC_PORT": str(port)}, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    try:
        def up() -> bool:
            if proc.poll() is not None:
                log.seek(0)
                pytest.fail(f"app copy exited: {log.read()[-2000:]}")
            try:
                return httpx.get(base + "/api/health", timeout=2).status_code == 200
            except httpx.HTTPError:
                return False
        poll(up, "the started copy answers GET /api/health 200", BOOT_WAIT_S)
        yield base
    finally:
        os.killpg(proc.pid, 15)
        proc.wait(timeout=HTTP_TIMEOUT_S)


def scratch_database_url() -> str:
    base_url = os.environ["DATABASE_URL"]
    name = "scratch_" + uuid.uuid4().hex[:10]
    subprocess.run(["psql", base_url, "-v", "ON_ERROR_STOP=1", "-c", f"CREATE DATABASE {name}"], check=True, capture_output=True, timeout=HTTP_TIMEOUT_S)
    return urlparse(base_url)._replace(path="/" + name).geturl()


@pytest.mark.timeout(900)
def test_mail_outage(browser, mail):
    down = mail_down_url()
    with client(down) as c:
        assert c.get("/api/health").json() == {"status": "ok"}
    name, email = fresh_identity("maildown")
    with open_app(browser, down + "/signup") as page:
        ui_signup(page, name, email)
        expect(page.get_by_role("heading", name="Check your email")).to_be_visible(timeout=WAIT_MS)
        expect(page.get_by_role("status", name="Mail status")).to_have_text("Email is unavailable. Your verification email will be sent when it recovers.")
        expect(page.get_by_text(f"We sent a verification link to {email}.", exact=True)).to_have_count(0)
        assert page.request.get(down + "/api/me").json()["verified"] is False
    with client(down) as c:
        assert c.get("/api/health").status_code == 200
    smtp_port = free_port()
    with app_copy({"SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(smtp_port), "MAIL_RETRY_SECONDS": "2", "DATABASE_URL": scratch_database_url()}) as copy:
        cname, cemail = fresh_identity("recover")
        with client(copy) as c:
            r = c.post("/api/signup", json={"name": cname, "email": cemail, "password": PASSWORD})
            assert r.status_code == 201 and r.json()["mail"] == "retrying"
        relay = Relay(smtp_port, (os.environ.get("SMTP_HOST", "mailpit"), int(os.environ.get("SMTP_PORT", "1025"))))
        try:
            wait_mail(mail, cemail, "Verify your Strikeproof account", MAIL_WAIT_S)
            assert len(mails_to(mail, cemail, "Verify your Strikeproof account")) == 1
        finally:
            relay.close()


def finish_quick(page: Page, base: str, t: Typist | None) -> None:
    prepare(page, base, "time", 15)
    press_key(page, words_state(page)[0]["text"][0])
    advance(page, 15000)
    expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)


def test_filing_seal(app_url, browser):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        runs = record_requests(page, "/api/runs")
        finish_quick(page, base, None)
        expect(seal(page)).to_have_text(SEAL_GUEST)
        advance(page, RESEND_MS * 2)
        assert runs == []
    unverified = make_typist(base, "unverified", verified=False)
    with signed_in(browser, base, unverified) as page:
        runs = record_requests(page, "/api/runs")
        finish_quick(page, base, unverified)
        expect(seal(page)).to_have_text(SEAL_UNVERIFIED)
        advance(page, RESEND_MS * 2)
        assert runs == []
    t = make_typist(base, "resend")
    with signed_in(browser, base, t) as page:
        calls: list[bytes] = []

        def first_fails(route: Any) -> None:
            calls.append(route.request.post_data_buffer)
            if len(calls) == 1:
                route.fulfill(status=503, content_type="application/json", body='{"error":"unavailable"}')
            else:
                route.continue_()
        page.route("**/api/runs", first_fails)
        prepare(page, base, "time", 15)
        press_key(page, words_state(page)[0]["text"][0])
        h = None
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS):
            advance(page, 15000)
        h = record_region(seal(page))
        expect(seal(page)).to_have_text(SEAL_HELD)
        advance(page, RESEND_MS - 1)
        assert len(calls) == 1
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            advance(page, 1)
        assert len(calls) == 2 and calls[1] == calls[0], "the resend carries the identical body"
        assert info.value.status == 201
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        expect(seal(page)).to_contain_text("New personal best")
        advance(page, RESEND_MS * 3)
        assert len(calls) == 2, "nothing more is sent after the verdict"
        log = h.evaluate("(el) => el.__log")
        assert any("Counted" in x for x in log)


def test_history_ledger(app_url, browser):
    base = app_url.rstrip("/")
    runs = [{"mode": "time", "length": 15, "punctuation": False, "numbers": False, "speed": 40 + i, "raw": 45, "accuracy": 95, "consistency": 80, "finishedAt": stamp(-HIST_BACK + i)} for i in range(21)]
    runs.append({"mode": "words", "length": 10, "punctuation": False, "numbers": False, "speed": 33, "raw": 35, "accuracy": 97, "consistency": 82, "finishedAt": stamp(-HIST_BACK + HIST_WORDS_AT)})
    t, other = make_typists(base, "ledger", 2, runs=runs)
    tk = fixed_ticket(t, "words", 10, WORKED_WORDS)
    body, _ = run_body(tk["ticketId"], WORKED_WORDS, WORKED_LOG)
    body["speed"] += 1
    del body["consistency"]
    refused = submit(t.http, body).json()
    first = t.http.get("/api/history", params={"page": 1}).json()
    assert len(first["runs"]) == HISTORY_PAGE and first["more"] is True
    assert first["runs"][0]["runId"] == refused["runId"] and first["runs"][0]["verdict"] == "not_counted"
    assert first["runs"][1]["finishedAt"] == stamp(-HIST_BACK + HIST_WORDS_AT)
    every = history_runs(t)
    assert len(every) == 23 and [r["finishedAt"] for r in every] == sorted((r["finishedAt"] for r in every), reverse=True)
    assert len(history_runs(t, "&mode=time&length=15&verdict=counted")) == 21
    with signed_in(browser, base, t, path="/history") as page:
        zone(page, KIRITIMATI)
        table = page.get_by_role("table", name="History")
        expect(table).to_be_visible(timeout=WAIT_MS)
        rows = table_rows(table)
        assert len(rows) == HISTORY_PAGE
        assert rows[0][1:4] == ["words", "10", "56.00"] and rows[0][6] == "-" and rows[0][7] == "Not counted"
        assert rows[1][:4] == [stamp_minute(-HIST_BACK + HIST_WORDS_AT), "words", "10", "33.00"] and rows[1][7] == "Counted"
        click(page.get_by_role("button", name="Older runs"))
        eventually(page, lambda: assert_len(table_rows(table), 23), "Older runs appends the next runs")
        expect(page.get_by_role("button", name="Older runs")).to_have_count(0)
        select(page.get_by_role("combobox", name="Mode"), "time")
        select(page.get_by_role("combobox", name="Length"), "15")
        select(page.get_by_role("combobox", name="Verdict"), "Counted")
        eventually(page, lambda: assert_query(page, {"mode": "time", "length": "15", "verdict": "counted"}), "filters are written to the URL")
        page.reload()
        eventually(page, lambda: (assert_query(page, {"mode": "time", "length": "15", "verdict": "counted"}), assert_first_row(table, stamp_minute(-HIST_BACK + 20))), "filters survive reload")
        assert all(r[1] == "time" for r in table_rows(table))
        page.goto(base + "/history?verdict=not_counted")
        eventually(page, lambda: assert_len(table_rows(table), 1), "the Not counted filter lists only refused runs")
        assert other.http.get("/api/history").json()["runs"] == []
    with signed_in(browser, base, other, path="/history") as page:
        expect(page.get_by_text("Nothing filed yet. Your first counted run will be filed here.", exact=True)).to_be_visible(timeout=WAIT_MS)


def assert_query(page: Page, want: dict[str, str]) -> None:
    q = {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}
    assert {k: q.get(k) for k in want} == want, q


def assert_first_row(table: Any, date: str) -> None:
    rows = table_rows(table)
    assert rows and rows[0][0] == date, rows[:1]


def test_counted_totals_and_bests(browser):
    base = short_url()
    t = make_typist(base, "bests", runs=[{"mode": "words", "length": 10, "punctuation": False, "numbers": False, "speed": 40, "raw": 42, "accuracy": 96, "consistency": 80, "finishedAt": "2026-01-05T09:00:00.000Z"}])
    words = ["amber", "anchor", "apple", "arch"]
    _, a, _ = counted_run(t, words, seq("amber "), "time", 15)
    _, b, _ = counted_run(t, words, seq("amb"), "time", 15)
    _, c, rc = counted_run(t, words, seq("amber anchor "), "time", 15)
    assert (a["personalBest"], b["personalBest"], c["personalBest"]) == (True, False, True)
    tk = fixed_ticket(t, "time", 15, words)
    body, _ = run_body(tk["ticketId"], words, log_of(seq("amber anchor apple "), STEP_MS), 15000)
    body["speed"] = 999
    assert submit(t.http, body).status_code == 422
    acct = t.http.get("/api/account").json()
    assert acct["testsCounted"] == 4
    pbs = acct["personalBests"]
    assert [(p["mode"], p["length"], p["punctuation"], p["numbers"]) for p in pbs] == [("time", 15, False, False), ("words", 10, False, False)]
    assert pbs[0]["speed"] == r2(rc.speed) and pbs[0]["runId"] == c["runId"] and pbs[1]["speed"] == 40
    mine = [r for r in board(base, "daily", 15) if r["name"] == t.name]
    assert len(mine) == 1 and mine[0]["speed"] == r2(rc.speed)
    with signed_in(browser, base, t, path="/account") as page:
        for _ in range(2):
            expect(el(page, "tests-counted")).to_have_text("Tests counted 4", timeout=WAIT_MS)
            rows = table_rows(page.get_by_role("table", name="Personal bests"))
            assert [r[:5] for r in rows] == [["time", "15", "off", "off", f2(rc.speed)], ["words", "10", "off", "off", "40.00"]]
            page.reload()
        page.goto(base + "/boards?board=daily&length=15")
        row = page.get_by_role("table", name="Leaderboard").get_by_role("row").filter(has_text=t.name)
        expect(row).to_contain_text(f2(rc.speed), timeout=WAIT_MS)


def test_private_runs(app_url, browser):
    base = app_url.rstrip("/")
    owner, other = make_typists(base, "private", 2)
    _, run, _ = counted_run(owner, WORKED_WORDS, WORKED_KEYS)
    assert owner.http.get(f"/api/runs/{run['runId']}").json()["log"] == WORKED_LOG
    for rid in (run["runId"], str(uuid.uuid4())):
        r = other.http.get(f"/api/runs/{rid}")
        assert (r.status_code, r.json()) == (404, {"error": "not_found"})
    with signed_in(browser, base, other, path=f"/runs/{run['runId']}") as page:
        expect(page.get_by_role("heading", name="No such run.")).to_be_visible(timeout=WAIT_MS)
        expect(el(page, "result-speed")).to_have_count(0)
        expect(el(page, "carbon")).to_have_count(0)


def test_wf_signup_to_history_journey(app_url, browser, mail):
    base = app_url.rstrip("/")
    name, email = fresh_identity("journey")
    other = make_typist(base, "outsider")
    with open_app(browser, base + "/signup") as page:
        ui_signup(page, name, email)
        expect(page.get_by_role("heading", name="Check your email")).to_be_visible(timeout=WAIT_MS)
        page.goto(base + "/")
        finish_quick(page, base, None)
        expect(seal(page)).to_have_text(SEAL_UNVERIFIED)
        token = mailed_token(wait_mail(mail, email, "Verify your Strikeproof account")[0], "Verify", "verify")
        page.goto(base + f"/verify/{token}")
        expect(page.get_by_role("heading", name="Email verified")).to_be_visible(timeout=WAIT_MS)
        page.goto(base + "/")
        prepare(page, base, "words", 10)
        next_text(base, f"typist:{email}", WORKED_WORDS)
        with page.expect_response(is_post("/api/tickets"), timeout=WAIT_MS):
            click_clear(page.get_by_role("button", name="Restart test"))
        wait_sheet(page, WORKED_WORDS)
        eventually(page, lambda: expect(typing_input(page)).to_be_focused(timeout=POLL_MS), "restart returns focus to the typing input")
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            type_and_check(page, WORKED_WORDS, WORKED_KEYS, check=False)
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        expect(seal(page)).to_contain_text("New personal best")
        run_id = info.value.json()["runId"]
        page.goto(base + "/history")
        table = page.get_by_role("table", name="History")
        expect(table).to_be_visible(timeout=WAIT_MS)
        assert table_rows(table)[0][1:4] == ["words", "10", "55.00"]
        click(page.get_by_role("link", name="Open run").first)
        expect(page).to_have_url(re.compile(rf"/runs/{run_id}"), timeout=WAIT_MS)
        page.goto(base + "/account")
        expect(el(page, "tests-counted")).to_have_text("Tests counted 1", timeout=WAIT_MS)
        hist = page.request.get(base + "/api/history").json()["runs"]
        assert [(r["runId"], r["verdict"]) for r in hist] == [(run_id, "counted")]
    with signed_in(browser, base, other, path=f"/runs/{run_id}") as page:
        expect(page.get_by_role("heading", name="No such run.")).to_be_visible(timeout=WAIT_MS)


LIVE_JS = """(() => { window.__live = []; const W = window.WebSocket; if (W) { window.WebSocket = class extends W { constructor(...a) { super(...a); const rec = {kind: 'ws', closed: false}; window.__live.push(rec); this.addEventListener('close', () => { rec.closed = true; }); } }; }
 const E = window.EventSource; if (E) { window.EventSource = class extends E { constructor(...a) { super(...a); const rec = {kind: 'sse', closed: false}; window.__live.push(rec); this.addEventListener('error', () => { rec.closed = true; }); } }; } })()"""


def test_wf_signup_to_history_reset(app_url, browser, mail):
    base = app_url.rstrip("/")
    t = make_typist(base, "reset")
    with signed_in(browser, base, t, path="/boards") as watcher, signed_in(browser, base, t, path="/reset") as confirmer:
        watcher.add_init_script(LIVE_JS)
        watcher.reload()
        expect(watcher.get_by_role("table", name="Leaderboard")).to_be_visible(timeout=WAIT_MS)
        open_before = poll(lambda: watcher.evaluate("() => window.__live.filter(r => !r.closed).length"), "the board opens a live connection")
        fill(confirmer.get_by_role("textbox", name="Email"), t.email)
        click(confirmer.get_by_role("button", name="Send reset link"))
        expect(confirmer.get_by_text("If that email has an account, a reset link is on its way.", exact=True)).to_be_visible(timeout=WAIT_MS)
        token = mailed_token(wait_mail(mail, t.email, "Reset your Strikeproof password")[0], "Reset", "reset")
        confirmer.goto(base + f"/reset/{token}")
        fill(confirmer.get_by_label("New password", exact=True), NEW_PASSWORD)
        with confirmer.expect_response(lambda r: urlparse(r.url).path == "/api/password-reset/confirm", timeout=WAIT_MS):
            click(confirmer.get_by_role("button", name="Set password"))
        poll(lambda: watcher.evaluate("(n) => window.__live.slice(0, n).every(r => r.closed)", open_before), "live connections close after the reset", SESSION_CLOSE_S + POLL_MARGIN_S)
        expect(confirmer.get_by_role("heading", name="Password changed")).to_be_visible(timeout=WAIT_MS)
        expect(confirmer.get_by_text("Sign in with your new password.", exact=True)).to_be_visible()
        expect(confirmer.get_by_role("link", name="Sign in").first).to_be_visible()
        for p in (watcher, confirmer):
            r = p.request.get(base + "/api/me")
            assert (r.status, r.json()) == (401, {"error": "unauthenticated"})
    r = t.http.get("/api/me")
    assert (r.status_code, r.json()) == (401, {"error": "unauthenticated"})
    sign_in_client(base, t.email, NEW_PASSWORD)


CHECK_CASES = ["invalid_log_string", "invalid_log_null", "invalid_log_nested", "invalid_log_extra_key", "invalid_log_first_t",
               "wrong_text", "impossible_interval_order", "impossible_interval_fast", "duration_mismatch", "replay_mismatch",
               "replay_mismatch_missing_value", "invalid_log_before_wrong_text", "wrong_text_before_interval", "unauthenticated",
               "email_unverified", "unsupported_media_type", "invalid_json", "ticket_not_found_unknown", "ticket_not_found_other",
               "ticket_not_found_guest"]


@pytest.mark.parametrize("case", CHECK_CASES, ids=CHECK_CASES)
def test_run_checks_order(app_url, case):
    base = app_url.rstrip("/")
    t = make_typist(base, "checks")
    tk = fixed_ticket(t, "words", 10, WORKED_WORDS)
    body, _ = run_body(tk["ticketId"], WORKED_WORDS, WORKED_LOG)
    swapped = [dict(e) for e in WORKED_LOG]
    swapped[3]["t"], swapped[4]["t"] = swapped[4]["t"], swapped[3]["t"]
    sender, content, ctype = t.http, None, "application/json"
    if case == "invalid_log_string":
        body["log"] = "nope"
    elif case == "invalid_log_null":
        body["log"] = None
    elif case == "invalid_log_nested":
        body["log"] = [WORKED_LOG]
    elif case == "invalid_log_extra_key":
        body["log"] = [dict(WORKED_LOG[0], x=1)] + WORKED_LOG[1:]
    elif case == "invalid_log_first_t":
        body = run_body(tk["ticketId"], WORKED_WORDS, [dict(e, t=e["t"] + 100) for e in WORKED_LOG])[0]
    elif case == "wrong_text":
        body["text"] = ["the", "cat", "mat"]
    elif case == "impossible_interval_order":
        body = run_body(tk["ticketId"], WORKED_WORDS, swapped)[0]
    elif case == "impossible_interval_fast":
        body = run_body(tk["ticketId"], WORKED_WORDS, log_of(WORKED_KEYS, FAST_INTERVAL_MS // 2))[0]
    elif case == "duration_mismatch":
        body["duration"] += 100
    elif case == "replay_mismatch":
        body["speed"] = 70.125
    elif case == "replay_mismatch_missing_value":
        del body["consistency"]
    elif case == "invalid_log_before_wrong_text":
        body["log"], body["text"] = "nope", ["the", "cat", "mat"]
    elif case == "wrong_text_before_interval":
        body = run_body(tk["ticketId"], WORKED_WORDS, swapped)[0]
        body["text"] = ["the", "cat", "mat"]
    elif case == "unauthenticated":
        sender = client(base)
    elif case == "email_unverified":
        sender = make_typist(base, "unverif", verified=False).http
    elif case == "unsupported_media_type":
        ctype = "text/plain"
    elif case == "invalid_json":
        content = b'{"ticketId": '
    elif case == "ticket_not_found_unknown":
        body["ticketId"] = str(uuid.uuid4())
    elif case == "ticket_not_found_other":
        body["ticketId"] = fixed_ticket(make_typist(base, "otherowner"), "words", 10, WORKED_WORDS)["ticketId"]
    elif case == "ticket_not_found_guest":
        with client(base) as c:
            body["ticketId"] = issue(c, "words", 10)["ticketId"]
    expected = {
        "unauthenticated": (401, "unauthenticated"), "email_unverified": (403, "email_unverified"),
        "unsupported_media_type": (415, "unsupported_media_type"), "invalid_json": (400, "invalid_json"),
        "ticket_not_found_unknown": (404, "ticket_not_found"), "ticket_not_found_other": (404, "ticket_not_found"),
        "ticket_not_found_guest": (404, "ticket_not_found"), "wrong_text_before_interval": (422, "wrong_text"),
        "invalid_log_before_wrong_text": (422, "invalid_log"),
    }.get(case) or (422, next(code for code in REASONS if case.startswith(code)))
    data = content if content is not None else json.dumps(body).encode()
    r = submit(sender, content=data, content_type=ctype)
    assert r.status_code == expected[0], f"{case}: {r.status_code} {r.text}"
    if expected[0] != 422:
        assert r.json() == {"error": expected[1]}
        assert history_runs(t) == []
        return
    out = r.json()
    assert out["error"] == expected[1] and out["verdict"] == "not_counted"
    assert out["proofKey"] == hashlib.sha256(data).hexdigest()
    stored = t.http.get(f"/api/runs/{out['runId']}").json()
    assert stored["verdict"] == "not_counted" and stored["reason"] == expected[1]
    assert stored["log"] == body["log"] and stored["words"] == WORKED_WORDS
    assert stored["errorsByKey"] is None and stored["perSecond"] is None
    for k in ("speed", "raw", "accuracy", "consistency"):
        assert stored[k] == (r2(body[k]) if isinstance(body.get(k), (int, float)) else None), k
    assert [x["runId"] for x in history_runs(t, "&verdict=not_counted")] == [out["runId"]]


def test_bounded_logs(app_url):
    base = app_url.rstrip("/")
    t = make_typist(base, "bounded")
    tk = fixed_ticket(t, "words", 10, WORKED_WORDS)
    body, _ = run_body(tk["ticketId"], WORKED_WORDS, WORKED_LOG)
    big = [{"k": "a", "t": i} for i in range(45000)]
    for log, ticket in ((big, tk["ticketId"]), ([{"k": "a", "t": 0}] * (MAX_LOG_EVENTS + 1), tk["ticketId"]),
                        (WORKED_LOG + [{"k": "a", "t": MAX_TEST_MS + 1}], tk["ticketId"]),
                        ([{"k": "a", "t": 0}] * (MAX_LOG_EVENTS + 1), str(uuid.uuid4()))):
        data = json.dumps(dict(body, log=log, ticketId=ticket), separators=(",", ":")).encode()
        assert len(data) <= BODY_LIMIT
        start = time.monotonic()
        r = submit(t.http, content=data)
        assert time.monotonic() - start < REFUSE_LOG_S
        assert (r.status_code, r.json()) == (413, {"error": "log_too_long", "limit": MAX_LOG_EVENTS})
    assert history_runs(t) == []
    for log in ([{"k": "a", "t": 0}] * MAX_LOG_EVENTS, WORKED_LOG + [{"k": "a", "t": MAX_TEST_MS}]):
        tk2 = fixed_ticket(t, "words", 10, WORKED_WORDS)
        assert submit(t.http, dict(body, log=log, ticketId=tk2["ticketId"])).status_code != 413


def test_one_ticket_one_run(browser):
    base = short_url()
    t = make_typist(base, "oneticket")
    tk = fixed_ticket(t, "time", 15, TIME_WORDS)
    body, _ = run_body(tk["ticketId"], TIME_WORDS, log_of(seq("amber anchor "), STEP_MS), 15000)
    variants = [body, dict(body, speed=body["speed"] + 1), dict(body, text=["x"]), dict(body, log="nope"), body, dict(body, raw=1)]
    answers = parallel(len(variants), lambda i: submit(t.http, variants[i]))
    assert len({(a.status_code, a.content) for a in answers}) == 1, [a.status_code for a in answers]
    again = submit(t.http, dict(body, accuracy=1))
    assert (again.status_code, again.content) == (answers[0].status_code, answers[0].content)
    run_id = answers[0].json()["runId"]
    assert [r["runId"] for r in history_runs(t)] == [run_id]
    rows = [r for r in board(base, "daily", 15) if r["name"] == t.name]
    assert len(rows) == (1 if answers[0].status_code == 201 else 0)


def test_wf_tampered_log_expiry(browser):
    base = short_url()
    t = make_typist(base, "expiry")
    tk = fixed_ticket(t, "words", 10, WORKED_WORDS)
    body, _ = run_body(tk["ticketId"], WORKED_WORDS, WORKED_LOG)
    with signed_in(browser, base, t) as page:
        page.clock.set_system_time(FAR_PAST)
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        clock, _ = type_and_check(page, WORKED_WORDS, WORKED_KEYS[:-1], check=False)
        elapse(base, SHORT_TICKET_TTL_S + 1)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            clock.press(WORKED_KEYS[-1], clock.now + STEP_MS)
        assert (info.value.status, info.value.json()) == (410, {"error": "ticket_expired"})
        expect(seal(page)).to_have_text(f"Not counted: {REASONS['ticket_expired']}", timeout=WAIT_MS)
    for _ in range(2):
        r = submit(t.http, body)
        assert (r.status_code, r.json()) == (410, {"error": "ticket_expired"})
    assert history_runs(t) == []
    fresh = fixed_ticket(t, "words", 10, WORKED_WORDS)
    assert submit(t.http, dict(body, ticketId=fresh["ticketId"])).status_code == 201


def tamper(route: Any, mutate: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    route.continue_(post_data=json.dumps(mutate(route.request.post_data_json)))


TAMPERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "wrong_text": lambda b: dict(b, text=["ask"]),
    "impossible_interval": lambda b: dict(b, log=[dict(e, t=i) for i, e in enumerate(b["log"])], duration=len(b["log"]) - 1),
    "duration_mismatch": lambda b: dict(b, duration=b["duration"] + 1),
    "replay_mismatch": lambda b: dict(b, speed=b["speed"] + 1),
    "invalid_log": lambda b: dict(b, log="nope"),
    "ticket_not_found": lambda b: dict(b, ticketId=str(uuid.uuid4())),
    "log_too_long": lambda b: dict(b, log=[{"k": "a", "t": 0}] * (MAX_LOG_EVENTS + 1)),
}


def test_not_counted_seal(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "notcounted")
    with signed_in(browser, base, t) as page:
        for code, mutate in TAMPERS.items():
            page.goto(base + "/")
            prepare(page, base, "words", 10, words=["ash"], typist=t)
            page.route("**/api/runs", (lambda m: lambda route: tamper(route, m))(mutate))
            with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
                type_and_check(page, ["ash"], seq("ash"), check=False)
            assert info.value.json()["error"] == code
            expect(seal(page)).to_have_text(f"Not counted: {REASONS[code]}", timeout=WAIT_MS)
            page.unroute("**/api/runs")


@pytest.mark.timeout(600)
def test_wf_tampered_log_journey(browser):
    base = short_url()
    a, reader = make_typists(base, "tampered", 2)
    stale = issue(a.http, "time", 15)
    started = time.monotonic()
    words = ["ash", "elm"]
    with signed_in(browser, base, reader, path="/boards?board=daily&length=15") as board_page, signed_in(browser, base, a) as page:
        expect(board_page.get_by_role("table", name="Leaderboard")).to_be_visible(timeout=WAIT_MS)
        cases = dict(TAMPERS)
        cases["ticket_expired"] = lambda b: dict(b, ticketId=stale["ticketId"])
        for code, mutate in cases.items():
            if code == "ticket_expired":
                elapse(base, max(0.0, SHORT_TICKET_TTL_S + 1 - (time.monotonic() - started)))
            page.goto(base + "/")
            prepare(page, base, "time", 15, words=words, typist=a)
            page.route("**/api/runs", (lambda m: lambda route: tamper(route, m))(mutate))
            clock, _ = type_and_check(page, words, seq("ash elm"), time_ms=15000, check=False)
            with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
                clock.to(15000)
            assert info.value.json()["error"] == code
            expect(seal(page)).to_have_text(f"Not counted: {REASONS[code]}", timeout=WAIT_MS)
            page.unroute("**/api/runs")
        page.goto(base + "/history")
        select(page.get_by_role("combobox", name="Verdict"), "Not counted")
        eventually(page, lambda: assert_len(table_rows(page.get_by_role("table", name="History")), 5), "the five 422 refusals are filed as Not counted")
        elapse(base, LIVE_BOARD_S)
        assert a.name not in board_page.evaluate("() => document.body.innerText")
    filed = history_runs(a)
    assert len(filed) == 5 and all(r["verdict"] == "not_counted" for r in filed)
    assert all(r["name"] != a.name for r in board(base, "daily", 15))


def test_proof_key(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "proof", runs=[{"mode": "words", "length": 10, "punctuation": False, "numbers": False, "speed": 40, "raw": 42, "accuracy": 95, "consistency": 80, "finishedAt": "2026-03-04T10:00:00.000Z"}])
    tk = fixed_ticket(t, "words", 10, WORKED_WORDS)
    body, _ = run_body(tk["ticketId"], WORKED_WORDS, WORKED_LOG)
    data = ("{\n   " + json.dumps(dict(reversed(list(body.items()))), indent=3)[1:]).encode()
    r = submit(t.http, content=data)
    assert r.status_code == 201 and r.json()["proofKey"] == hashlib.sha256(data).hexdigest()
    again = submit(t.http, content=json.dumps(body).encode())
    assert again.content == r.content
    assert t.http.get(f"/api/runs/{r.json()['runId']}").json()["proofKey"] == hashlib.sha256(data).hexdigest()
    tk2 = fixed_ticket(t, "words", 10, WORKED_WORDS)
    bad = json.dumps(dict(body, ticketId=tk2["ticketId"], speed=1), separators=(",", ":")).encode()
    r2_ = submit(t.http, content=bad)
    assert r2_.status_code == 422 and r2_.json()["proofKey"] == hashlib.sha256(bad).hexdigest()
    grading = [x for x in history_runs(t) if x["finishedAt"] == "2026-03-04T10:00:00.000Z"][0]
    assert t.http.get(f"/api/runs/{grading['runId']}").json()["proofKey"] is None
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            type_and_check(page, WORKED_WORDS, WORKED_KEYS, check=False)
        proof = hashlib.sha256(info.value.request.post_data_buffer).hexdigest()
        assert info.value.json()["proofKey"] == proof
        expect(el(page, "proof-key")).to_have_text(f"Proof {proof[:16]}", timeout=WAIT_MS)


BOARD_TOP = 900
_board_tops = iter(range(10 ** 6))


def board_top() -> float:
    return float(BOARD_TOP + next(_board_tops))


def board_run(speed: float, accuracy: float, finished: str, length: int = 15, **over: Any) -> dict[str, Any]:
    return dict({"mode": "time", "length": length, "punctuation": False, "numbers": False, "speed": speed, "raw": speed, "accuracy": accuracy, "consistency": 80, "finishedAt": finished}, **over)


def test_board_ranking(app_url, browser):
    base = app_url.rstrip("/")
    now = server_now(base)
    today, yday = now.strftime("%Y-%m-%d"), (now - timedelta(days=1)).strftime("%Y-%m-%d")
    top = board_top()
    plan = {
        "p1": [board_run(top + 0.05, 90, f"{today}T00:00:00.000Z"), board_run(top + 0.01, 99, f"{today}T00:00:02.000Z")],
        "p2": [board_run(top + 0.04, 95, f"{today}T00:00:05.000Z")],
        "p3": [board_run(top + 0.04, 95, f"{today}T00:00:01.000Z")],
        "p4": [board_run(top + 0.04, 97, f"{today}T00:00:09.000Z")],
        "p5": [board_run(top + 0.09, 90, f"{yday}T23:59:59.999Z")],
        "p7": [board_run(top + 0.07, 99, f"{today}T00:00:03.000Z", punctuation=True), board_run(top + 0.08, 99, f"{today}T00:00:03.000Z", mode="words", length=10), board_run(top + 0.08, 99, f"{today}T00:00:03.000Z", length=30)],
    }
    names = {}
    for key, runs in plan.items():
        names[key] = make_typist(base, f"rank{key}", runs=runs).name
    names["p6"] = make_typist(base, "rankp6", verified=False, runs=[board_run(top + 0.08, 99, f"{today}T00:00:04.000Z")]).name
    for which, order in (("daily", ["p1", "p4", "p3", "p2"]), ("alltime", ["p5", "p1", "p4", "p3", "p2"])):
        rows = board(base, which, 15)
        assert len(rows) <= BOARD_ROWS and [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
        mine = [r for r in rows if r["name"] in names.values()]
        assert [r["name"] for r in mine] == [names[k] for k in order], which
    assert [r for r in board(base, "daily", 15) if r["name"] == names["p1"]][0]["speed"] == r2(top + 0.05)
    with open_app(browser, base + "/boards?board=daily&length=15") as page:
        zone(page, KIRITIMATI)
        table = page.get_by_role("table", name="Leaderboard")
        expect(table.get_by_role("row").filter(has_text=names["p1"])).to_contain_text(today, timeout=WAIT_MS)
        expect(table.get_by_role("row").filter(has_text=names["p5"])).to_have_count(0)
        page.goto(base + "/boards?board=alltime&length=15")
        zone(page, PAGO_PAGO)
        expect(table.get_by_role("row").filter(has_text=names["p5"])).to_contain_text(yday, timeout=WAIT_MS)
        expect(table.get_by_role("row").filter(has_text=names["p6"])).to_have_count(0)


def test_board_row_fields(app_url, browser):
    base = app_url.rstrip("/")
    now = server_now(base)
    top = board_top()
    stamp = now.strftime("%Y-%m-%dT00:00:00.000Z")
    t = make_typist(base, "fields", runs=[board_run(top + 0.03, 98, stamp), board_run(top + 0.03, 98, stamp, length=60)])
    for which in ("daily", "alltime"):
        for length in (15, 60):
            with client(base) as c:
                r = c.get(f"/api/boards?board={which}&length={length}")
            assert r.status_code == 200
            assert all(set(row) == {"rank", "name", "speed", "accuracy", "finishedAt"} for row in r.json()["rows"])
            assert t.email.lower() not in r.text.lower() and t.id not in r.text
            assert any(row["name"] == t.name for row in r.json()["rows"])
    with client(base) as c:
        for q in ("board=weekly&length=15", "board=daily&length=30"):
            r = c.get(f"/api/boards?{q}")
            assert (r.status_code, r.json()) == (422, {"error": "invalid_board"})
    with open_app(browser, base + "/boards?board=alltime&length=60") as page:
        row = page.get_by_role("table", name="Leaderboard").get_by_role("row").filter(has_text=t.name)
        expect(row).to_be_visible(timeout=WAIT_MS)
        cells = row.get_by_role("cell").all_inner_texts() + row.get_by_role("rowheader").all_inner_texts()
        assert len(cells) == 5 and t.email.lower() not in row.inner_text().lower()


def test_live_board(browser):
    base = short_url()
    reader, a = make_typists(base, "live", 2)
    with signed_in(browser, base, reader, path="/boards?board=daily&length=15") as page:
        expect(page.get_by_role("table", name="Leaderboard")).to_be_visible(timeout=WAIT_MS)
        updates = record_region(page.get_by_role("status", name="Board updates"))
        _, run, res = counted_run(a, TIME_WORDS, seq("amber anchor apple arch ash "), "time", 15, gap=100)
        until(page, "(n) => document.body.innerText.includes(n)", a.name, seconds=LIVE_BOARD_S)
        rank = [r for r in board(base, "daily", 15) if r["name"] == a.name][0]["rank"]
        row = page.get_by_role("table", name="Leaderboard").get_by_role("row").filter(has_text=a.name)
        expect(row).to_contain_text(f2(res.speed))
        expect(row).to_contain_text(str(rank))
        line = f"{a.name} is now #{rank} with {f2(res.speed)} wpm."
        eventually(page, lambda: assert_len([1] * times_announced(updates, line), 1), "the change is announced once in Board updates")


def test_wf_live_board_tabs(app_url, browser):
    base = app_url.rstrip("/")
    now = server_now(base)
    top = board_top()
    stamp = now.strftime("%Y-%m-%dT00:00:00.000Z")
    t, other = make_typists(base, "tabs", 2, runs=[board_run(top + 0.02, 97, stamp), board_run(top + 0.02, 97, stamp, length=60)])
    grading_setup(base, [{"email": other.email, "name": other.name, "password": PASSWORD, "verified": True}], [dict(board_run(top + 0.01, 97, stamp, length=60), email=other.email)])
    with signed_in(browser, base, t, path="/boards?board=daily&length=15") as page:
        daily, alltime = page.get_by_role("tab", name="Daily"), page.get_by_role("tab", name="All-time")
        s15, s60 = page.get_by_role("tab", name="15 seconds"), page.get_by_role("tab", name="60 seconds")
        expect(daily).to_have_attribute("aria-selected", "true", timeout=WAIT_MS)
        daily.focus()
        page.keyboard.press("ArrowRight")
        expect(alltime).to_be_focused()
        expect(alltime).to_have_attribute("aria-selected", "true")
        expect(daily).to_have_attribute("tabindex", "-1")
        eventually(page, lambda: assert_query(page, {"board": "alltime"}), "the board is kept in the URL")
        page.keyboard.press("ArrowRight")
        expect(daily).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(alltime).to_have_attribute("aria-selected", "true")
        s15.focus()
        page.keyboard.press("ArrowRight")
        expect(s60).to_have_attribute("aria-selected", "true")
        eventually(page, lambda: assert_query(page, {"board": "alltime", "length": "60"}), "the length is kept in the URL")
        table = page.get_by_role("table", name="Leaderboard")
        expect(table.get_by_role("row").filter(has_text=t.name)).to_have_attribute("aria-current", "true", timeout=WAIT_MS)
        assert table.get_by_role("row").filter(has_text=other.name).get_attribute("aria-current") != "true"
        for w, h in VIEWPORTS.values():
            page.set_viewport_size({"width": w, "height": h})
            layout(page)


def test_wf_live_board_journey(browser):
    base = short_url()
    reader, a = make_typists(base, "livejny", 2)
    with signed_in(browser, base, reader, path="/boards?board=daily&length=15") as rpage, signed_in(browser, base, a) as apage:
        expect(rpage.get_by_role("table", name="Leaderboard")).to_be_visible(timeout=WAIT_MS)
        prepare(apage, base, "time", 15, words=TIME_WORDS, typist=a)
        clock, log = type_and_check(apage, TIME_WORDS, seq("amber anchor apple arch "), gap=100, time_ms=15000, check=False)
        with apage.expect_response(is_post("/api/runs"), timeout=WAIT_MS):
            clock.to(15000)
        res = replay(TIME_WORDS, log, 15000)
        until(rpage, "(n) => document.body.innerText.includes(n)", a.name, seconds=LIVE_BOARD_S)
        expect(rpage.get_by_role("status", name="Board updates")).to_contain_text(f"{a.name} is now #")
        _, _, fast = counted_run(a, TEN_WORDS, seq(" ".join(TEN_WORDS)), "words", 10, gap=60)
        elapse(base, LIVE_BOARD_S)
        row = rpage.get_by_role("table", name="Leaderboard").get_by_role("row").filter(has_text=a.name)
        expect(row).to_contain_text(f2(res.speed))
        assert f2(fast.speed) not in row.inner_text()
        rpage.get_by_role("tab", name="Daily").focus()
        rpage.keyboard.press("ArrowRight")
        expect(rpage.get_by_role("tab", name="All-time")).to_have_attribute("aria-selected", "true")
        expect(rpage.get_by_role("table", name="Leaderboard").get_by_role("row").filter(has_text=a.name)).to_contain_text(f2(res.speed), timeout=WAIT_MS)
    mine = [r for r in board(base, "daily", 15) if r["name"] == a.name]
    assert len(mine) == 1 and mine[0]["speed"] == r2(res.speed)


def room(t: Typist, code: str) -> dict[str, Any]:
    r = t.http.get(f"/api/rooms/{code}")
    assert r.status_code == 200, r.text
    return r.json()


def create_room_ui(page: Page) -> str:
    click(page.get_by_role("button", name="Create room"))
    expect(el(page, "room-code")).to_have_text(ROOM_CODE_RE, timeout=WAIT_MS)
    return el(page, "room-code").inner_text().strip()


def racers_list(page: Page) -> list[str]:
    return [x.strip() for x in page.get_by_role("list", name="Racers").get_by_role("listitem").all_inner_texts()]


def join_ui(page: Page, code: str) -> None:
    fill(page.get_by_role("textbox", name="Room code"), code)
    page.get_by_role("textbox", name="Room code").press("Enter")


def wait_go(page: Page, tick: bool = True) -> None:
    eventually(page, lambda: expect(page.get_by_role("status", name="Race countdown")).to_have_text("Go", timeout=POLL_MS), "the server pushes Go", tick=tick)


def type_race(page: Page, words: list[str], gap: int) -> list[dict[str, Any]]:
    keys = seq(" ".join(words))
    log = log_of(keys, gap)
    clock = Clock(page)
    clock.now = 0
    for k, e in zip(keys, log):
        clock.press(k, e["t"])
    clock.to(log[-1]["t"] + gap)
    return log


def test_race_rooms(app_url, browser):
    base = app_url.rstrip("/")
    host, b, c = make_typists(base, "rooms", 3)
    with signed_in(browser, base, host, path="/race") as hp, signed_in(browser, base, b, path="/race") as bp:
        code = create_room_ui(hp)
        eventually(hp, lambda: assert_racers(hp, [f"{host.name} (host)"]), "the new room lists its host")
        joins = record_region(hp.get_by_role("status", name="Race updates"))
        join_ui(bp, code.lower().replace("-", ""))
        expect(bp).to_have_url(re.compile(r"/race/"), timeout=WAIT_MS)
        eventually(hp, lambda: assert_racers(hp, [f"{host.name} (host)", b.name]), "the host sees the new racer live")
        r = c.http.post(f"/api/rooms/{code.lower()}/join", json={})
        assert (r.status_code, r.json()["rejoined"]) == (200, False)
        assert c.http.post(f"/api/rooms/ {code} /join".replace(" ", ""), json={}).json()["rejoined"] is True
        eventually(hp, lambda: assert_racers(hp, [f"{host.name} (host)", b.name, c.name]), "a third join appears live")
        expect(bp.get_by_role("status", name="Race updates")).to_have_text(f"{c.name} joined.", timeout=WAIT_MS)
        assert times_announced(joins, f"{b.name} joined.") == 1 and times_announced(joins, f"{c.name} joined.") == 1
        assert times_announced(record_region(bp.get_by_role("status", name="Race updates")), f"{b.name} joined.") == 0
        r = host.http.post("/api/rooms/ZZZZZZ/join", json={})
        assert (r.status_code, r.json()) == (404, {"error": "room_not_found"})
        bp.goto(base + "/race")
        join_ui(bp, "ZZZZZZ")
        alert_says(bp, "No room with that code.")
    with open_app(browser, base + "/race") as page:
        links = page.get_by_role("link", name="Sign in")
        expect(links).to_have_count(2, timeout=WAIT_MS)
        for i in range(2):
            expect(links.nth(i)).to_be_visible()
        expect(page.get_by_text("Sign in to race.", exact=True)).to_be_visible()


def assert_racers(page: Page, want: list[str]) -> None:
    assert racers_list(page) == want, racers_list(page)


def test_wf_private_race_last_seat(app_url, browser):
    base = app_url.rstrip("/")
    racers = make_typists(base, "seats", ROOM_SEATS + 4)
    host = racers[0]
    r = host.http.post("/api/rooms", json={})
    assert r.status_code == 201 and re.fullmatch(rf"[{ROOM_ALPHABET}]{{6}}", r.json()["code"])
    code = r.json()["code"]
    for t in racers[1:ROOM_SEATS - 1]:
        assert t.http.post(f"/api/rooms/{code}/join", json={}).status_code == 200
    claimants = racers[ROOM_SEATS - 1:ROOM_SEATS + 3]
    answers = parallel(len(claimants), lambda i: claimants[i].http.post(f"/api/rooms/{code}/join", json={}))
    assert sorted(a.status_code for a in answers) == [200, 409, 409, 409]
    assert all(a.json() == {"error": "room_full"} for a in answers if a.status_code == 409)
    again = parallel(3, lambda i: racers[1].http.post(f"/api/rooms/{code}/join", json={}))
    assert all(a.status_code == 200 and a.json()["rejoined"] is True for a in again)
    assert len(room(host, code)["racers"]) == ROOM_SEATS
    loser = next(c for c, a in zip(claimants, answers) if a.status_code == 409)
    with signed_in(browser, base, loser, path="/race") as page:
        join_ui(page, code[:3] + "-" + code[3:])
        alert_says(page, "This room is full.")
    assert len(room(host, code)["racers"]) == ROOM_SEATS


def test_server_countdown(app_url, browser):
    base = app_url.rstrip("/")
    host, b = make_typists(base, "countdown", 2)
    with signed_in(browser, base, host, path="/race") as hp, signed_in(browser, base, b, path="/race") as bp:
        code = create_room_ui(hp)
        expect(hp.get_by_role("button", name="Start race")).to_be_disabled()
        r = host.http.post(f"/api/rooms/{code}/start", json={})
        assert (r.status_code, r.json()) == (409, {"error": "not_enough_racers"})
        join_ui(bp, code.lower())
        expect(hp.get_by_role("button", name="Start race")).to_be_enabled(timeout=WAIT_MS)
        r = b.http.post(f"/api/rooms/{code}/start", json={})
        assert (r.status_code, r.json()) == (403, {"error": "not_host"})
        bp.clock.set_system_time(FAR_FUTURE)
        logs = [record_region(p.get_by_role("status", name="Race countdown")) for p in (hp, bp)]
        click(hp.get_by_role("button", name="Start race"))
        eventually(bp, lambda: expect(bp.get_by_role("status", name="Race countdown")).to_have_text(str(MAIN_COUNTDOWN_S), timeout=POLL_MS), "the first step arrives", tick=False)
        for p in (hp, bp):
            press_key(p, "a")
        advance(bp, 10000)
        assert all(s == "untyped" for w in words_state(bp)[:1] for s in w["states"])
        r = host.http.post(f"/api/rooms/{code}/start", json={})
        assert (r.status_code, r.json()) == (409, {"error": "race_started"})
        for p in (hp, bp):
            wait_go(p, tick=False)
        for h in logs:
            steps = [x for x in h.evaluate("(el) => el.__log") if x]
            assert steps == [str(n) for n in range(MAIN_COUNTDOWN_S, 0, -1)] + ["Go"], steps
        words = room(b, code)["words"]
        press_key(bp, words[0][0])
        advance(bp, STEP_MS)
        assert words_state(bp)[0]["states"][0] == "correct"


def test_live_race_progress(app_url, browser):
    base = app_url.rstrip("/")
    a, b = make_typists(base, "progress", 2)
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp:
        code = create_room_ui(ap)
        join_ui(bp, code)
        expect(ap.get_by_role("button", name="Start race")).to_be_enabled(timeout=WAIT_MS)
        click(ap.get_by_role("button", name="Start race"))
        for p in (ap, bp):
            wait_go(p)
        words = room(a, code)["words"]
        bar = bp.get_by_role("progressbar", name=f"{a.name} progress")
        bar.element_handle().evaluate(VALUES_JS)
        clock = Clock(ap)
        clock.now = 0
        keys = seq(" ".join(words[:3]) + " ")
        for i, k in enumerate(keys):
            clock.press(k, (i + 1) * 100)
        clock.to(clock.now + 1000)
        want = str(100 * 3 // RACE_WORDS)
        until(bp, "(v) => [...document.querySelectorAll('[role=progressbar],progress')].some(e => e.getAttribute('aria-valuenow') === v)", want, seconds=RACE_PROGRESS_S + POLL_MARGIN_S)
        expect(bar).to_have_attribute("aria-valuenow", want)
        expect(ap.get_by_role("progressbar", name=f"{a.name} progress")).to_have_attribute("aria-valuenow", want)
        for i, k in enumerate(seq("zzz ")):
            clock.press(k, clock.now + 100)
        clock.to(clock.now + 1000)
        advance(bp, 1000)
        expect(bar).to_have_attribute("aria-valuenow", want)
        values = bar.element_handle().evaluate(VALUES_READ_JS)
        assert values == sorted(values), values
        assert [r["progress"] for r in room(b, code)["racers"] if r["name"] == a.name] == [int(want)]


def test_race_places(app_url, browser):
    base = app_url.rstrip("/")
    a, b, c = make_typists(base, "places", 3)
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp, signed_in(browser, base, c, path="/race") as cp:
        code = create_room_ui(ap)
        join_ui(bp, code)
        join_ui(cp, code)
        expect(ap.get_by_role("button", name="Start race")).to_be_enabled(timeout=WAIT_MS)
        click(ap.get_by_role("button", name="Start race"))
        for p in (ap, bp, cp):
            wait_go(p)
        c_updates = record_region(cp.get_by_role("status", name="Race updates"))
        a_updates = record_region(ap.get_by_role("status", name="Race updates"))
        words = room(a, code)["words"]
        keys = seq(" ".join(words))
        fast, _ = run_body(None, words, log_of(keys, 20))
        slow, slow_res = run_body(None, words, log_of(keys, 30))
        places = [x.http.post(f"/api/rooms/{code}/finish", json=bd) for x, bd in ((a, fast), (b, fast), (c, slow))]
        assert [p.json()["place"] for p in places] == [1, 1, 3]
        assert places[2].json()["speed"] == r2(slow_res.speed) and places[2].json()["verdict"] == "counted"
        state = room(a, code)
        assert state["state"] == "finished" and sorted((r["name"], r["place"]) for r in state["racers"]) == sorted([(a.name, 1), (b.name, 1), (c.name, 3)])
        expect(cp.get_by_role("heading", name="Race finished")).to_be_visible(timeout=WAIT_MS)
        line_a = f"{a.name} finished 1st with {f2(fast['speed'])} wpm."
        eventually(cp, lambda: assert_len([1] * times_announced(c_updates, "Race finished."), 1), "Race finished is announced once")
        assert times_announced(c_updates, line_a) == 1
        assert times_announced(c_updates, f"{b.name} finished 1st with {f2(fast['speed'])} wpm.") == 1
        assert times_announced(a_updates, line_a) == 0
        rows = table_rows(cp.get_by_role("table", name="Race results"))
        assert [r[1] for r in rows][-1] == c.name and "3" in rows[-1][0] and "1" in rows[0][0] and "1" in rows[1][0]


def test_wf_private_race_journey(app_url, browser):
    base = app_url.rstrip("/")
    a, b, c = make_typists(base, "racejny", 3)
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp, signed_in(browser, base, c, path="/race") as cp:
        code = create_room_ui(ap)
        for p in (bp, cp):
            join_ui(p, code.lower())
        eventually(ap, lambda: assert_racers(ap, [f"{a.name} (host)", b.name, c.name]), "the lobby fills live")
        click(ap.get_by_role("button", name="Start race"))
        for p in (ap, bp, cp):
            wait_go(p, tick=False)
        words = room(a, code)["words"]
        assert words_state(bp)[0]["text"] == words[0]
        with ap.expect_response(is_post(f"/api/rooms/{code}/finish"), timeout=WAIT_MS) as fa:
            type_race(ap, words, 50)
        expect(bp.get_by_role("progressbar", name=f"{a.name} progress")).to_have_attribute("aria-valuenow", "100", timeout=WAIT_MS)
        with bp.expect_response(is_post(f"/api/rooms/{code}/finish"), timeout=WAIT_MS) as fb:
            type_race(bp, words, 50)
        with cp.expect_response(is_post(f"/api/rooms/{code}/finish"), timeout=WAIT_MS):
            type_race(cp, words, 80)
        assert fa.value.json()["place"] == fb.value.json()["place"] == 1
        expect(cp.get_by_role("heading", name="Race finished")).to_be_visible(timeout=WAIT_MS)
    state = room(a, code)
    assert state["state"] == "finished" and sorted(r["place"] for r in state["racers"]) == [1, 1, 3]


@pytest.mark.timeout(300)
def test_race_rejoin(browser):
    base = short_url()
    a, b = make_typists(base, "rejoin", 2)
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp:
        code = create_room_ui(ap)
        join_ui(bp, code)
        expect(ap.get_by_role("button", name="Start race")).to_be_enabled(timeout=WAIT_MS)
        click(ap.get_by_role("button", name="Start race"))
        for p in (ap, bp):
            wait_go(p)
        words = room(a, code)["words"]
        bar = bp.get_by_role("progressbar", name=f"{a.name} progress")
        bar.element_handle().evaluate(VALUES_JS)
        clock = Clock(ap)
        clock.now = 0
        for i, k in enumerate(seq(" ".join(words[:2]) + " ")):
            clock.press(k, (i + 1) * 20)
        clock.to(clock.now + 500)
        expect(bar).to_have_attribute("aria-valuenow", str(100 * 2 // RACE_WORDS), timeout=WAIT_MS)
        ap.reload()
        expect(ap.get_by_role("status", name="Race updates")).to_have_text(f"Rejoined race {code}.", timeout=WAIT_MS)
        eventually(ap, lambda: (assert_len([w for w in words_state(ap)[:2] if set(w["states"]) == {"correct"}], 2), None)[1], "typed words come back")
        assert caret_of(ap) == (2, 0)
        with ap.expect_response(is_post(f"/api/rooms/{code}/finish"), timeout=WAIT_MS) as info:
            clock = Clock(ap)
            clock.now = 0
            for i, k in enumerate(seq(" ".join(words[2:]))):
                clock.press(k, (i + 1) * 20)
            clock.to(clock.now + 100)
        assert info.value.status == 200 and info.value.json()["place"] == 1
        values = bar.element_handle().evaluate(VALUES_READ_JS)
        assert values == sorted(values), values


@pytest.mark.timeout(300)
def test_leaving_and_cutoff(browser):
    base = short_url()
    a, b, c, d = make_typists(base, "cutoff", 4)
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp, signed_in(browser, base, d, path="/race") as dp:
        code = create_room_ui(ap)
        join_ui(bp, code)
        with signed_in(browser, base, c, path=f"/race/{code}") as cp:
            eventually(ap, lambda: assert_racers(ap, [f"{a.name} (host)", b.name, c.name]), "three racers seated")
            click(ap.get_by_role("button", name="Start race"))
            wait_go(cp)
        updates = record_region(ap.get_by_role("status", name="Race updates"))
        wait_go(ap)
        poll(lambda: [r for r in room(a, code)["racers"] if r["name"] == c.name and r["left"]], "the absent racer is marked left", SHORT_REJOIN_S + WAIT_S)
        eventually(ap, lambda: assert_racers(ap, [f"{a.name} (host)", b.name, f"{c.name} (Left)"]), "Left shows live")
        assert times_announced(updates, f"{c.name} left.") == 1
        r = d.http.post(f"/api/rooms/{code}/join", json={})
        assert (r.status_code, r.json()) == (409, {"error": "race_started"})
        join_ui(dp, code)
        alert_says(dp, "This race has already started.")
        words = room(a, code)["words"]
        with ap.expect_response(is_post(f"/api/rooms/{code}/finish"), timeout=WAIT_MS):
            type_race(ap, words, 20)
        poll(lambda: room(a, code)["state"] == "finished", "the race ends at the time limit", SHORT_RACE_LIMIT_S + WAIT_S)
        body, _ = run_body(None, words, log_of(seq(" ".join(words)), 20))
        r = b.http.post(f"/api/rooms/{code}/finish", json=body)
        assert (r.status_code, r.json()) == (409, {"error": "race_over"})
        expect(ap.get_by_role("table", name="Race results")).to_contain_text("DNF", timeout=WAIT_MS)
        rows = {row[1]: row for row in table_rows(ap.get_by_role("table", name="Race results"))}
        assert rows[b.name][0] == "DNF" and rows[b.name][2:] == ["-", "-"]
        assert rows[c.name][0] == "Left" and rows[c.name][2:] == ["-", "-"]


@pytest.mark.timeout(300)
def test_wf_race_rejoin_journey(browser):
    base = short_url()
    a, b, late = make_typists(base, "rejoinjny", 3)
    fillers = make_typists(base, "filler", ROOM_SEATS)
    full = fillers[0].http.post("/api/rooms", json={}).json()["code"]
    for f in fillers[1:]:
        assert f.http.post(f"/api/rooms/{full}/join", json={}).status_code == 200
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp, signed_in(browser, base, late, path="/race") as lp:
        code = create_room_ui(ap)
        join_ui(bp, code)
        expect(ap.get_by_role("button", name="Start race")).to_be_enabled(timeout=WAIT_MS)
        click(ap.get_by_role("button", name="Start race"))
        wait_go(ap)
        words = room(a, code)["words"]
        clock = Clock(ap)
        clock.now = 0
        for i, k in enumerate(seq(words[0] + " ")):
            clock.press(k, (i + 1) * 20)
        clock.to(clock.now + RACE_PROGRESS_S * 1000)
        poll(lambda: [r["progress"] for r in room(a, code)["racers"] if r["name"] == a.name] == [100 // len(words)], "the server has the first word")
        ap.reload()
        expect(ap.get_by_role("status", name="Race updates")).to_have_text(f"Rejoined race {code}.", timeout=WAIT_MS)

        def restored() -> None:
            assert [set(w["states"]) for w in words_state(ap)[:1]] == [{"correct"}], "typed words come back"
            assert caret_of(ap) == (1, 0), "the caret comes back"
        eventually(ap, restored, "typed words and caret come back before typing on")
        with ap.expect_response(is_post(f"/api/rooms/{code}/finish"), timeout=WAIT_MS) as info:
            type_race(ap, words[1:], 20)
        assert info.value.json()["place"] == 1
        for typed, alert in ((code.lower(), "This race has already started."), ("ZZZZZZ", "No room with that code."), (full.lower(), "This room is full.")):
            lp.goto(base + "/race")
            box = lp.get_by_role("textbox", name="Room code")
            box.focus()
            lp.keyboard.type(typed)
            lp.keyboard.press("Enter")
            alert_says(lp, alert)
    assert [r["place"] for r in room(a, code)["racers"] if r["name"] == a.name] == [1]


@pytest.mark.timeout(300)
def test_wf_race_rejoin_lobby(browser):
    base = short_url()
    host, second, *rest = make_typists(base, "lobby", ROOM_SEATS + 2)
    api_racers, leaver, extra = rest[:ROOM_SEATS - 3], rest[ROOM_SEATS - 3], rest[ROOM_SEATS - 2:]
    with ExitStack() as stack:
        hp = stack.enter_context(signed_in(browser, base, host, path="/race"))
        code = create_room_ui(hp)
        sp = stack.enter_context(signed_in(browser, base, second, path=f"/race/{code}"))
        eventually(hp, lambda: assert_racers(hp, [f"{host.name} (host)", second.name]), "the second racer is seated")
        for t in api_racers:
            assert t.http.post(f"/api/rooms/{code}/join", json={}).status_code == 200
        lp = stack.enter_context(signed_in(browser, base, leaver, path=f"/race/{code}"))
        poll(lambda: len(room(host, code)["racers"]) == ROOM_SEATS, "the room is full")
        updates = record_region(sp.get_by_role("status", name="Race updates"))
        lp.close()
        r = extra[0].http.post(f"/api/rooms/{code}/join", json={})
        assert (r.status_code, r.json()) == (409, {"error": "room_full"})
        poll(lambda: all(x["name"] != leaver.name for x in room(host, code)["racers"]), "the closed racer loses the seat", SHORT_REJOIN_S + WAIT_S)
        answers = parallel(len(extra), lambda i: extra[i].http.post(f"/api/rooms/{code}/join", json={}))
        assert sorted(a.status_code for a in answers) == [200, 409]
        hp.close()
        poll(lambda: [x for x in room(second, code)["racers"] if x["name"] == second.name and x["host"]], "the earliest-seated racer becomes host", SHORT_REJOIN_S + WAIT_S)
        eventually(sp, lambda: expect(sp.get_by_role("button", name="Start race")).to_be_visible(timeout=POLL_MS), "the new host gets Start race")
        assert f"{second.name} (host)" in racers_list(sp)
        assert times_announced(updates, f"{host.name} left.") == 1
    solo = make_typist(base, "solo")
    with signed_in(browser, base, solo, path="/race") as page:
        solo_code = create_room_ui(page)
        for _ in range(10):
            extra_page = page.context.new_page()
            extra_page.goto(base + f"/race/{solo_code}")
            expect(extra_page.get_by_role("list", name="Racers")).to_be_visible(timeout=WAIT_MS)
            extra_page.close()
    pg = Postgres("_short")
    poll(lambda: pg.rows("SELECT count(*) AS busy FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')")[0]["busy"] == 0,
         "no app database session stays busy after closed live connections")
    poll(lambda: solo.http.get(f"/api/rooms/{solo_code}").status_code == 404, "an emptied room is deleted", SHORT_REJOIN_S + WAIT_S)
    with signed_in(browser, base, solo, path="/race") as page:
        expect(page.get_by_role("button", name="Create room")).to_be_visible(timeout=WAIT_MS)


def test_smooth_caret(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "caret")

    def glide(page: Page) -> tuple[float, float, list[float], list[float]]:
        prepare(page, base, "words", 10, words=TEN_WORDS, typist=t)
        caret = el(page, "caret")
        old = _num(sample(caret), "x", "left")
        press_key(page, "a")
        path = motion(caret, CARET_SETTLE_MAX_MS * 2)
        xs = [_num(s, "x", "left") for s in path]
        ts = motion_times(path, CARET_SETTLE_MAX_MS * 2)
        return old, xs[-1], xs, ts

    with signed_in(browser, base, t) as page:
        old, new, xs, ts = glide(page)
        assert new > old + 1
        assert any(old + 0.5 < x < new - 0.5 for x in xs), "a sample falls between the two places"
        assert all(abs(x - new) <= 0.5 for x, tt in zip(xs, ts) if tt >= CARET_SETTLE_MAX_MS), "the glide settles"
        put_settings(t, smoothCaret=False)
        page.reload()
        old, new, xs, _ = glide(page)
        assert not any(old + 0.5 < x < new - 0.5 for x in xs), "smooth caret off jumps"
    put_settings(t, smoothCaret=True)
    with signed_in(browser, base, t, reduced_motion="reduce") as page:
        old, new, xs, _ = glide(page)
        assert not any(old + 0.5 < x < new - 0.5 for x in xs), "reduced motion jumps"


def test_wf_cross_cutting_motion(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "motion")
    line = "Speed 55.00, accuracy 91.67%, raw 60.00, consistency 73.24%."
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        type_and_check(page, WORKED_WORDS, WORKED_KEYS[:-1], check=False)
        press_key(page, WORKED_KEYS[-1])
        path = motion(page.get_by_role("region", name="Certificate"), CERT_MAX_MS + 100)
        ys = [_num(s, "y", "top") for s in path]
        assert abs((ys[0] - ys[-1]) - CERT_RISE_PX) <= 2, ys
        if "opacity" in path[0]:
            assert path[0]["opacity"] < path[-1]["opacity"]
        ts = motion_times(path, CERT_MAX_MS + 100)
        assert all(abs(y - ys[-1]) <= 0.5 for y, tt in zip(ys, ts) if tt >= CERT_MAX_MS)
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        stamp = motion(el(page, "seal"), SEAL_MAX_MS + 100)
        ws = [_num(s, "width", "w") for s in stamp]
        assert abs(ws[0] / ws[-1] - SEAL_SCALE) <= 0.05, ws
        sts = motion_times(stamp, SEAL_MAX_MS + 100)
        assert all(abs(w - ws[-1]) <= 0.5 for w, tt in zip(ws, sts) if tt >= SEAL_MAX_MS)
        slider = page.get_by_role("slider", name="Replay position")
        slider.focus()
        page.keyboard.press("Home")
        page.keyboard.press("ArrowRight")
        assert animations(el(page, "carbon")), "newly struck letters ink in"
        advance(page, CERT_MAX_MS)
        page.keyboard.press("ArrowLeft")
        assert animations(el(page, "carbon")) == [], "moving back is instant"
    with signed_in(browser, base, t, reduced_motion="reduce") as page:
        prepare(page, base, "words", 10, words=WORKED_WORDS, typist=t)
        type_and_check(page, WORKED_WORDS, WORKED_KEYS, check=False)
        cert = page.get_by_role("region", name="Certificate")
        path = motion(cert, CERT_MAX_MS)
        assert max(_num(s, "y", "top") for s in path) - min(_num(s, "y", "top") for s in path) <= 0.5
        expect(page.get_by_role("status", name="Test result")).to_have_text(line)
        expect(seal(page)).to_contain_text("Counted", timeout=WAIT_MS)
        assert animations(el(page, "seal")) == []
        page.get_by_role("slider", name="Replay position").focus()
        page.keyboard.press("Home")
        page.keyboard.press("ArrowRight")
        assert animations(el(page, "carbon")) == []
        expect(el(page, "replay-speed")).to_have_text("60.00")


def ring_ok(styles: dict[str, str]) -> bool:
    width = float(re.sub(r"[^0-9.]", "", styles.get("outline-width", "0")) or 0)
    if styles.get("outline-style", "none") not in ("none", "") and width >= FOCUS_RING_PX:
        return True
    return styles.get("box-shadow", "none") not in ("none", "")


def test_wf_cross_cutting_keyboard(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "access")
    _, run, _ = counted_run(t, WORKED_WORDS, WORKED_KEYS)
    with signed_in(browser, base, t) as page:
        prepare(page, base, "time", 15)
        page.get_by_role("navigation", name="Folders").get_by_role("link", name="Test").focus()
        assert tab_order(page, 11) == ["History", "Boards", "Race rooms", "Settings", "time", "15", "Punctuation", "Numbers", "Begin test", "Typing input", "Restart test"]
        for loc in (page.get_by_role("button", name="Begin test"), page.get_by_role("button", name="Restart test"),
                    page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="time", exact=True),
                    page.get_by_role("navigation", name="Folders").get_by_role("link", name="History")):
            _, focused = state_styles(loc, "outline-style", "outline-width", "box-shadow", state="focus")
            assert ring_ok(focused), focused
        for loc in (page.get_by_role("button", name="Begin test"), page.get_by_role("button", name="Restart test")):
            b = rect(page, loc)
            assert b["height"] >= TARGET_PX and b["width"] >= TARGET_PX
        for w, h in VIEWPORTS.values():
            page.set_viewport_size({"width": w, "height": h})
            for path, ready in (("/", lambda: wait_sheet(page)), (f"/runs/{run['runId']}", lambda: expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)),
                                ("/history", lambda: expect(page.get_by_role("link", name="Open run").first).to_be_visible(timeout=WAIT_MS)),
                                ("/boards", lambda: expect(page.get_by_role("table", name="Leaderboard")).to_be_visible(timeout=WAIT_MS))):
                page.goto(base + path)
                ready()
                axe(page)
        page.goto(base + "/boards")
        _, focused = state_styles(page.get_by_role("tab", name="Daily"), "outline-style", "outline-width", "box-shadow", state="focus")
        assert ring_ok(focused)


def test_health_and_config(app_url):
    for base, countdown, rejoin in ((app_url.rstrip("/"), MAIN_COUNTDOWN_S, MAIN_REJOIN_S), (mail_down_url(), MAIN_COUNTDOWN_S, MAIN_REJOIN_S), (short_url(), 1, SHORT_REJOIN_S)):
        with client(base) as c:
            r = c.get("/api/health")
            assert (r.status_code, r.json()) == (200, {"status": "ok"})
            cfg = c.get("/api/config").json()
        assert cfg == {"focusWarningMs": FOCUS_WARNING_MS, "maxExtraLetters": MAX_EXTRA_LETTERS, "raceCountdownSeconds": countdown, "raceRejoinSeconds": rejoin}


def test_server_boundary(app_url):
    base = app_url.rstrip("/")
    with client(base) as c:
        r = c.get("/api/definitely-not-a-route")
        assert (r.status_code, r.json()) == (404, {"error": "not_found"})
        valid = json.dumps(ticket_body("words", 10)).encode()
        exact = valid + b" " * (BODY_LIMIT - len(valid))
        assert c.post("/api/tickets", content=exact, headers={"Content-Type": "application/json"}).status_code == 201
        r = c.post("/api/tickets", content=exact + b" ", headers={"Content-Type": "application/json"})
        assert (r.status_code, r.json()) == (413, {"error": "body_too_large", "limit": BODY_LIMIT})
        r = c.post("/api/tickets", content=valid, headers={"Content-Type": "text/plain"})
        assert (r.status_code, r.json()) == (415, {"error": "unsupported_media_type"})
        r = c.post("/api/tickets", content=b'{"mode":', headers={"Content-Type": "application/json"})
        assert (r.status_code, r.json()) == (400, {"error": "invalid_json"})
        r = c.post("/api/tickets", content=valid, headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN})
        assert (r.status_code, r.json()) == (403, {"error": "cross_origin"})
        page = c.get("/no-such-page")
        assert page.status_code == 404
        html = c.get("/").text
        secrets_ = [GRADING_KEY] + [os.environ[k] for k in ("DATABASE_URL",) if os.environ.get(k)]
        assets = set(re.findall(r'(?:src|href)="(/[^"]+)"', html))
        for path in assets | {"/package.json", "/package-lock.json", "/.env", "/run.json", "/tsconfig.json"}:
            resp = c.get(path)
            body = resp.text
            assert path in assets or "json" not in resp.headers.get("content-type", ""), path
            assert "run-manifest-v1" not in body, path
            assert not any(s in body for s in secrets_), f"{path} leaks a configured secret"
        t = make_typist(base, "cookie")
        r = c.post("/api/session", json={"email": t.email, "password": PASSWORD})
        cookie = r.headers.get("set-cookie", "").lower()
        norm = cookie.replace("-", "")
        assert "HTTP-only".lower().replace("-", "") in norm and "same-site".replace("-", "") in norm


def test_unknown_page_sheet(app_url, browser):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/no-such-page") as page:
        expect(page.get_by_role("heading", name="Page not found")).to_be_visible(timeout=WAIT_MS)


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing}"
    assert "Bodoni Moda" in notices and "Jost" in notices


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad
    assert re.search(r"OFL[- ]?1\.1|Open Font Licen[cs]e[ ,]*(version |v)?1\.1", Path("/app/THIRD_PARTY_NOTICES.md").read_text(), re.I), "the fonts are named with their licence"


def test_if_postgres_only():
    found = sorted({p.name for p in shipped_packages()} & FORBIDDEN_DATASTORES)
    assert not found, found


def test_if_typescript_and_lockfile():
    app = Path("/app")
    assert (app / "package-lock.json").is_file()
    ts = [p for p in app.rglob("*.ts*") if "node_modules" not in p.parts and p.suffix in (".ts", ".tsx")]
    assert len(ts) >= 2, "server and client sources are TypeScript"


def same_origin(url: str, base: str) -> bool:
    return origin(url) == origin(base)


def test_if_same_origin_assets(app_url, browser):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", "/history", "/boards", "/race", "/settings", "/signin"):
            page.goto(base + path)
        page.goto(base + "/")
        wait_sheet(page)
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, base)]
        assert not foreign, foreign


def test_if_texts_exact(app_url):
    base = app_url.rstrip("/")
    with client(base) as c:
        for _ in range(20):
            assert set(issue(c, "time", 120)["words"]) <= set(WORD_LIST)
    t = make_typist(base, "texts")
    for qid, (_, text_, _) in QUOTES.items():
        tk = fixed_ticket(t, "quote", "all", quote_id=qid)
        assert tk["quoteId"] == qid and tk["words"] == text_.split(" ")


def test_if_service_config_unchanged():
    path = Path("/logs/agent/trajectory.json")
    if not path.is_file():
        return
    blob = json.loads(path.read_text())
    touched: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key in ("file_path", "path"):
                v = node.get(key)
                if isinstance(v, str) and Path(v).name in PROVIDED_CONFIG_NAMES and any(w in json.dumps(node) for w in ("Write", "Edit", "write", "edit")):
                    touched.append(v)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(blob)
    assert not touched, touched


def test_wf_phone_typing_bottom_bar(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "bottombar")
    counted_run(t, ["ash", "elm"], seq("ash elm"))
    with signed_in(browser, base, t) as page:
        pw, ph = VIEWPORTS["phone"]
        page.set_viewport_size({"width": pw, "height": ph})
        wait_sheet(page)
        nav = page.get_by_role("navigation", name="Folders")
        for _ in range(2):
            nb = rect(page, nav)
            assert abs(nb["y"] + nb["height"] - ph) <= 1, f"the Folders bar is fixed to the bottom: {nb}"
            for name in ("Test", "History", "Boards", "Race rooms", "Settings"):
                box = rect(page, nav.get_by_role("link", name=name, exact=True))
                assert box["height"] >= TARGET_PX, f"{name} link is {box['height']} px tall"
                assert box["x"] >= -1 and box["x"] + box["width"] <= pw + 1 and box["y"] + box["height"] <= ph + 1, f"{name} link is on screen: {box}"
            page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            advance(page, TICK_MS)
        tap(nav.get_by_role("link", name="History", exact=True))
        expect(page).to_have_url(re.compile(r"/history(\?.*)?$"), timeout=WAIT_MS)
        cards = page.get_by_role("list", name="History").get_by_role("listitem")
        expect(cards).to_have_count(1, timeout=WAIT_MS)
        expect(cards.first).to_contain_text("Counted")
        expect(cards.first.get_by_role("link", name="Open run")).to_be_visible()
        expect(page.get_by_role("table", name="History")).to_have_count(0)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "no sideways scrolling"


def test_wf_quote_and_custom_punctuation_errors(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "quotekeys")
    words = QUOTES["q2"][1].split(" ")
    keys = seq("Beware: for I am fearless and therefore powerful.")
    with signed_in(browser, base, t) as page:
        tk = prepare(page, base, "quote", "short", quote_id="q2", typist=t)
        assert tk["words"] == words and tk["quoteId"] == "q2"
        _, log = type_and_check(page, words, keys)
        res = replay(words, log)
        assert [k for k, _ in res.errors] == ["space", ";"] and res.characters[3] == 1, "oracle: the planned mistakes"
        assert_certificate(page, res)
        assert_tables(page, res)


def assert_time_carbon(page: Page, words: list[str], log: list[dict[str, Any]], s: int, time_ms: int) -> None:
    maximum = time_ms // 1000
    eng = feed(words, log, time_ms, None if s == maximum else s * 1000)
    full = feed(words, log, time_ms)
    dom = words_state(page, "carbon")
    assert len(dom) == full.cur + 1, "carbon shows every word the run reached"
    assert [w["states"] for w in dom] == eng.states()[: full.cur + 1], f"carbon states at {s}"
    assert caret_of(page, "carbon-caret") == eng.caret(), f"carbon caret at {s}"
    res = replay(words, log, time_ms)
    speed = "0.00" if s == 0 else f2(res.per_second[s - 1][0])
    expect(el(page, "replay-speed")).to_have_text(speed)
    slider = page.get_by_role("slider", name="Replay position")
    expect(slider).to_have_attribute("aria-valuenow", str(s))
    expect(slider).to_have_attribute("aria-valuetext", f"{s} seconds, speed {speed}")


def test_wf_carbon_replay_time_test(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "carbontime")
    words = TIME_WORDS
    keys = seq("amberrr ", "anx", CBS, "anchor apple ar", BS, "rch ash")
    with signed_in(browser, base, t, reduced_motion="reduce") as page:
        prepare(page, base, "time", 15, words=words, typist=t)
        clock, log = type_and_check(page, words, keys, gap=400, time_ms=15000, check=False)
        finish_time(page, clock, words, log, 15000)
        assert_certificate(page, replay(words, log, 15000))
        slider = page.get_by_role("slider", name="Replay position")
        expect(slider).to_have_attribute("aria-valuemax", "15")
        slider.focus()
        assert_time_carbon(page, words, log, 15, 15000)
        for key, s in (("PageDown", 10), ("PageDown", 5), ("ArrowLeft", 4), ("ArrowDown", 3), ("Home", 0),
                       ("PageUp", 5), ("ArrowRight", 6), ("ArrowUp", 7), ("End", 15)):
            page.keyboard.press(key)
            advance(page, TICK_MS * 2)
            eventually(page, lambda s=s: assert_time_carbon(page, words, log, s, 15000), f"{key} moves the playhead to {s}")


def test_wf_tampered_log_phone(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "tamperphone")
    words = ["ash", "elm"]
    with signed_in(browser, base, t) as page:
        pw, ph = VIEWPORTS["phone"]
        page.set_viewport_size({"width": pw, "height": ph})
        prepare(page, base, "words", 10, words=words, typist=t)
        page.route("**/api/runs", lambda route: tamper(route, TAMPERS["replay_mismatch"]))
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS) as info:
            for i, k in enumerate(seq("ash elm")):
                if i:
                    advance(page, STEP_MS)
                soft_key(page, k)
        assert info.value.status == 422 and info.value.json()["error"] == "replay_mismatch"
        expect(seal(page)).to_have_text(f"Not counted: {REASONS['replay_mismatch']}", timeout=WAIT_MS)
        page.unroute("**/api/runs")
        sb = rect(page, seal(page))
        assert sb["x"] >= -1 and sb["x"] + sb["width"] <= pw + 1, f"the seal fits the screen width: {sb}"
        layout(page)
        tap(page.get_by_role("navigation", name="Folders").get_by_role("link", name="History", exact=True))
        cards = page.get_by_role("list", name="History").get_by_role("listitem")
        expect(cards).to_have_count(1, timeout=WAIT_MS)
        expect(cards.first).to_contain_text("Not counted")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "no sideways scrolling"


def test_wf_race_rejoin_phone(app_url, browser):
    base = app_url.rstrip("/")
    a, b = make_typists(base, "rejoinphone", 2)
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp:
        ap.set_viewport_size(dict(zip(("width", "height"), VIEWPORTS["phone"])))
        code = create_room_ui(ap)
        join_ui(bp, code)
        expect(ap.get_by_role("button", name="Start race")).to_be_enabled(timeout=WAIT_MS)
        tap(ap.get_by_role("button", name="Start race"))
        for p in (ap, bp):
            wait_go(p)
        words = room(a, code)["words"]
        for k in seq(" ".join(words[:2]) + " "):
            advance(ap, 20)
            soft_key(ap, k)
        advance(ap, 500)
        bar = bp.get_by_role("progressbar", name=f"{a.name} progress")
        expect(bar).to_have_attribute("aria-valuenow", str(100 * 2 // len(words)), timeout=WAIT_MS)
        bar.element_handle().evaluate(VALUES_JS)
        ap.reload()
        expect(ap.get_by_role("status", name="Race updates")).to_have_text(f"Rejoined race {code}.", timeout=WAIT_MS)
        eventually(ap, lambda: assert_len([w for w in words_state(ap)[:2] if set(w["states"]) == {"correct"}], 2), "typed words come back")
        assert caret_of(ap) == (2, 0)
        layout(ap)
        with ap.expect_response(is_post(f"/api/rooms/{code}/finish"), timeout=WAIT_MS) as info:
            for k in seq(" ".join(words[2:])):
                advance(ap, 20)
                soft_key(ap, k)
            advance(ap, 100)
        assert info.value.status == 200 and info.value.json()["place"] == 1
        values = bar.element_handle().evaluate(VALUES_READ_JS)
        assert values == sorted(values), values


def test_wf_race_rejoin_bars_restored(app_url, browser):
    base = app_url.rstrip("/")
    a, b = make_typists(base, "rejoinbars", 2)
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp:
        code = create_room_ui(ap)
        join_ui(bp, code)
        expect(ap.get_by_role("button", name="Start race")).to_be_enabled(timeout=WAIT_MS)
        click(ap.get_by_role("button", name="Start race"))
        for p in (ap, bp):
            wait_go(p)
        words = room(a, code)["words"]
        n = len(words)
        bc = Clock(bp)
        bc.now = 0
        for i, k in enumerate(seq(" ".join(words[:3]) + " ")):
            bc.press(k, (i + 1) * 20)
        bc.to(bc.now + 500)
        ac = Clock(ap)
        ac.now = 0
        for i, k in enumerate(seq(words[0] + " ")):
            ac.press(k, (i + 1) * 20)
        ac.to(ac.now + 500)
        poll(lambda: {x["name"]: x["progress"] for x in room(a, code)["racers"]} == {a.name: 100 // n, b.name: 300 // n}, "the server holds both racers' progress")
        theirs = bp.get_by_role("progressbar", name=f"{a.name} progress")
        expect(theirs).to_have_attribute("aria-valuenow", str(100 // n), timeout=WAIT_MS)
        theirs.element_handle().evaluate(VALUES_JS)
        ap.reload()
        expect(ap.get_by_role("status", name="Race updates")).to_have_text(f"Rejoined race {code}.", timeout=WAIT_MS)
        expect(ap.get_by_role("progressbar", name=f"{b.name} progress")).to_have_attribute("aria-valuenow", str(300 // n), timeout=WAIT_MS)
        expect(ap.get_by_role("progressbar", name=f"{a.name} progress")).to_have_attribute("aria-valuenow", str(100 // n), timeout=WAIT_MS)
        ac = Clock(ap)
        ac.now = 0
        for i, k in enumerate(seq(" ".join(words[1:3]) + " ")):
            ac.press(k, (i + 1) * 20)
        ac.to(ac.now + 500)
        expect(theirs).to_have_attribute("aria-valuenow", str(300 // n), timeout=WAIT_MS)
        values = theirs.element_handle().evaluate(VALUES_READ_JS)
        assert values == sorted(values) and values[0] == 100 // n, values


def test_wf_live_board_best_in_place(browser):
    base = short_url()
    reader, a = make_typists(base, "inplace", 2)
    _, _, slow = counted_run(a, TIME_WORDS, seq("amber anchor "), "time", 15, gap=150)
    with signed_in(browser, base, reader, path="/boards?board=daily&length=15") as page:
        table = page.get_by_role("table", name="Leaderboard")
        expect(table.get_by_role("row").filter(has_text=a.name)).to_contain_text(f2(slow.speed), timeout=WAIT_MS)
        updates = record_region(page.get_by_role("status", name="Board updates"))
        _, _, fast = counted_run(a, TIME_WORDS, seq("amber anchor apple arch ash attic "), "time", 15, gap=100)
        until(page, "(s) => document.body.innerText.includes(s)", f2(fast.speed), seconds=LIVE_BOARD_S)
        expect(table.get_by_role("row").filter(has_text=a.name)).to_have_count(1)
        rank = [r for r in board(base, "daily", 15) if r["name"] == a.name][0]["rank"]
        line = f"{a.name} is now #{rank} with {f2(fast.speed)} wpm."
        eventually(page, lambda: assert_len([1] * times_announced(updates, line), 1), "the new best is announced once")
        n = len(updates.evaluate("(el) => el.__log"))
        counted_run(a, TIME_WORDS, seq("amber "), "time", 15, gap=STEP_MS)
        elapse(base, LIVE_BOARD_S)
        advance(page, LIVE_BOARD_S * 1000)
        row = table.get_by_role("row").filter(has_text=a.name)
        expect(row).to_have_count(1)
        expect(row).to_contain_text(f2(fast.speed))
        later = [x for x in updates.evaluate("(el) => el.__log")[n:] if x and x != line]
        assert later == [], f"a slower run is never announced: {later}"


def test_wf_correction_rules_carbon_final_mark(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "carbonmark")
    words = ["oak", "as"]
    keys = seq("oax as")
    log = log_of(keys, STEP_MS)
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10, words=words, typist=t)
        type_and_check(page, words, keys, check=False)
        expect(page.get_by_role("region", name="Certificate")).to_be_visible(timeout=WAIT_MS)
        settle(el(page, "carbon"))
        eng = feed(words, log, None)
        assert [w["states"] for w in words_state(page, "carbon")] == eng.states()[: eng.cur + 1], "the carbon shows every entry at the maximum position"
        assert_marks(page, "sand", "carbon")


def test_wf_restart_and_command_line_custom_mode(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "cmdcustom")
    with signed_in(browser, base, t) as page:
        prepare(page, base, "words", 10)
        open_command(page, "mode custom")
        page.keyboard.press("Enter")
        expect(page.get_by_role("textbox", name="Custom text")).to_be_focused(timeout=WAIT_MS)
        page.keyboard.type("fern moss")
        page.keyboard.press("Enter")
        wait_sheet(page, ["fern", "moss"])
        eventually(page, lambda: expect(typing_input(page)).to_be_focused(timeout=POLL_MS), "focus stays in the typing input when the ticket arrives")


def test_wf_phone_typing_command_custom(app_url, browser):
    base = app_url.rstrip("/")
    t = make_typist(base, "phonecmd")
    with signed_in(browser, base, t) as page:
        page.set_viewport_size({"width": 375, "height": 812})
        wait_sheet(page)
        page.keyboard.press("Escape")
        tap(page.get_by_role("option", name="Mode: custom", exact=True))
        fill(page.get_by_role("textbox", name="Custom text"), "fern moss")
        tap(page.get_by_role("button", name="Use text"))
        wait_sheet(page, ["fern", "moss"])
        eventually(page, lambda: expect(typing_input(page)).to_be_focused(timeout=POLL_MS), "focus stays in the typing input when the ticket arrives")
        with page.expect_response(is_post("/api/runs"), timeout=WAIT_MS):
            for i, k in enumerate(seq("fern moss")):
                if i:
                    advance(page, STEP_MS)
                soft_key(page, k)


def test_wf_private_race_phone_typing(app_url, browser):
    base = app_url.rstrip("/")
    a, b = make_typists(base, "racephone", 2)
    with signed_in(browser, base, a, path="/race") as ap, signed_in(browser, base, b, path="/race") as bp:
        ap.set_viewport_size({"width": 375, "height": 812})
        code = create_room_ui(ap)
        join_ui(bp, code)
        expect(ap.get_by_role("button", name="Start race")).to_be_enabled(timeout=WAIT_MS)
        tap(ap.get_by_role("button", name="Start race"))
        for p in (ap, bp):
            wait_go(p)
        words = room(a, code)["words"]
        for k in seq(" ".join(words[:2]) + " "):
            advance(ap, STEP_MS)
            soft_key(ap, k)
        advance(ap, RACE_PROGRESS_S * 1000)
        expect(bp.get_by_role("progressbar", name=f"{a.name} progress")).to_have_attribute("aria-valuenow", str(100 * 2 // len(words)), timeout=WAIT_MS)
