from __future__ import annotations

import concurrent.futures as cf
import contextlib
import hashlib
import json
import math
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
import base64
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse, urlunparse

import httpx
import pytest
from playwright.sync_api import Page, expect

from conftest import (
    DEPLOYED_APP,
    Postgres,
    S3,
    advance,
    animations,
    camera,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    shipped_packages,
    tap,
    unique,
)

UI_MS = 20_000
UI_STEP_MS = 250
HTTP_TIMEOUT_S = 60
SSE_READ_S = 40
WAIT_S = 30
POLL_S = 0.2
SLACK_S = 4
POOL = 16
RACERS = 8
TAB_LIMIT = 40
SKEW_S = 5 * 3600
expect.set_options(timeout=UI_MS)

PHONE_W = 375
PHONE_H = 812
TABLET_W = 768
TABLET_H = 1024
DESK_W = 1280
DESK_H = 800
THUMB_LINE = 0.4
PHONE_TOUCH_PX = 48
SHORT_LIMIT_S = 5
LONG_LIMIT_S = 120
PROMPT_MAX = 200
OPTION_MAX = 80
UNIT_MAX = 20
TITLE_MAX = 80
DECK_MAX = 50
NICK_MAX = 20
SEATS_MAX = 200
PIC_LIMIT = 2_000_000
UPLOAD_BODY_LIMIT = 2_100_000
JSON_LIMIT = 64_000
TOKEN_MIN = 32
PASSWORD_MIN = 10
DISPLAY_MAX = 60
MAX_POINTS = 1000
DECAY_POINTS = 500
LOCK_GRACE_S = 1
PRESENCE_S = 2
SESSION_CHECK_S = 5
ABORTED_STREAMS = 10
RECOVER_S = 10
STREAM_RETRY_S = 5
IDLE_END_GRACE_S = 2
KEY_TTL_S = 3600
SESSION_S = 30 * 24 * 3600
DAY_S = 24 * 3600
SHORT_IDLE_S = 5
SHORT_TTL_S = 3
PILLAR_GAP_MS = 90
PILLAR_SETTLE_MS = 600
PODIUM_MS = 1400
FRAME_MS = 30
LEADERBOARD_TOP = 10
BINS = 8

INES_EMAIL = "ines@corkline.example"
INES_PASSWORD = "tally-pour-2026"
ROWAN_EMAIL = "rowan@corkline.example"
ROWAN_PASSWORD = "second-round-77"
SEED_DECK = "Tuesday at The Gilded Tap"
SEED_PRACTICE = "Practice deck"
SEED_ROWAN_DECK = "Thursday Mix"
SEED_MC_PROMPT = "Which planet has the shortest day?"
SEED_MC_OPTIONS = ("Jupiter", "Mars", "Earth", "Venus")
SEED_GOLD_PROMPT = "What is the chemical symbol for gold?"
SEED_GOLD_OPTIONS = ("Ag", "Au", "Gd", "Go")
SEED_EST_PROMPT = "How many keys does a standard piano have?"
EST_MIN = 40
EST_MAX = 120
EST_ANSWER = 88
EST_TOL = 4
EST_UNIT = "keys"
SEED_SEQ_PROMPT = "Put these inventions in order, earliest first."
SEED_SEQ = ("Printing press", "Steam engine", "Telephone", "World Wide Web")
SEED_STANDINGS = [
    (1, "Quizzly Bears", 3120),
    (2, "Les Quizerables", 2980),
    (3, "Pint Sized", 2410),
    (4, "Agatha Quiztie", 1875),
    (5, "The Lone Ranger", 920),
]
SEED_NIGHT_END_MS = int(datetime(2026, 10, 27, 21, 40, tzinfo=timezone.utc).timestamp() * 1000)
NEW_PASSWORD = "chalk-and-brass-10"
EVIL_ORIGIN = "http://evil.example"

BACKUP_COPY = "Backup link: live updates are down. Answers still count."
RETURN_COPY = "Back on the live link"
FULL_NIGHT = ("open_question", "lock", "reveal", "show_leaderboard", "show_podium", "end")
SHORTCUTS = {"Open question": "O", "Lock": "L", "Reveal": "R", "Leaderboard": "B", "Podium": "P", "End night": "E"}

PQ_BASE = {"index", "type", "prompt", "timeLimitMs", "opensAt", "deadlineAt", "imageUrl"}
PQ_EXTRA = {"mc": {"options"}, "est": {"min", "max", "step", "unit"}, "seq": {"items"}}
VIEW_KEYS = {"state", "questionCount", "questionIndex", "question", "reveal", "standings", "you", "lastEventId"}
YOU_KEYS = {"seatId", "nickname", "score", "streak", "rank", "answeredCurrent"}
STANDING_KEYS = {"rank", "seatId", "nickname", "score", "streak"}
REVEAL_BASE = {"questionIndex", "type", "answered", "seated", "results"}
REVEAL_EXTRA = {"mc": {"counts", "correctIndex"}, "est": {"bins", "answer", "tolerance", "inBandBins"},
                "seq": {"buckets", "correctOrder"}}
RESULT_KEYS = {"seatId", "points", "outcome", "streak"}
SECRET_KEYS = {"correctIndex", "answer", "tolerance", "correctOrder"}

APP_DIR = Path("/app")


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(total: int | None = None) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = _chunk(b"IDAT", zlib.compress(b"\x00\xf4\xf1\xe8"))
    iend = _chunk(b"IEND", b"")
    if total is None:
        return sig + ihdr + idat + iend
    pad = total - len(sig + ihdr + idat + iend) - 12
    return sig + ihdr + _chunk(b"prVt", b"\x00" * pad) + idat + iend


PNG = png_bytes()
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
WEBP = base64.b64decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
GIF = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"
HTML = b"<!doctype html><title>x</title>"
TEXT = b"Quizzly Bears 3120\n"


def nap(seconds: float = POLL_S) -> None:
    threading.Event().wait(seconds)


@contextlib.contextmanager
def ctx(obj: Any) -> Iterator[Any]:
    if hasattr(obj, "__enter__"):
        with obj as value:
            yield value
        return
    value = next(obj)
    try:
        yield value
    finally:
        with contextlib.suppress(StopIteration):
            next(obj)


def slug(prefix: str) -> str:
    return hashlib.sha256("|".join(unique(prefix)).encode()).hexdigest()[:10]


def nick(prefix: str = "P") -> str:
    return f"{prefix}{slug(prefix)[:8]}"


def race(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with cf.ThreadPoolExecutor(len(calls)) as ex:
        return list(ex.map(run, calls))


def mc(t: int = SHORT_LIMIT_S, options=SEED_MC_OPTIONS, correct: int = 0, prompt: str = SEED_MC_PROMPT) -> dict:
    return {"type": "mc", "prompt": prompt, "timeLimitSeconds": t, "options": list(options), "correctIndex": correct}


def est(t: int = SHORT_LIMIT_S, mn: float = EST_MIN, mx: float = EST_MAX, step: float = 1, answer: float = EST_ANSWER,
        tol: float = EST_TOL, unit: str = EST_UNIT, prompt: str = SEED_EST_PROMPT) -> dict:
    return {"type": "est", "prompt": prompt, "timeLimitSeconds": t, "min": mn, "max": mx, "step": step,
            "answer": answer, "tolerance": tol, "unit": unit}


def seq(t: int = SHORT_LIMIT_S, items=SEED_SEQ, prompt: str = SEED_SEQ_PROMPT) -> dict:
    return {"type": "seq", "prompt": prompt, "timeLimitSeconds": t, "items": list(items)}


@lru_cache(maxsize=None)
def type_names(base: str) -> dict[str, str]:
    with httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S) as c:
        r = c.post("/api/auth/login", json={"email": INES_EMAIL, "password": INES_PASSWORD})
        assert r.status_code == 200, f"seeded quizmaster cannot sign in: {r.status_code} {r.text}"
        deck = next((d for d in c.get("/api/decks").json()["decks"] if d["title"] == SEED_DECK), None)
        assert deck, "seeded deck missing"
        qs = sorted(c.get(f"/api/decks/{deck['id']}").json()["deck"]["questions"], key=lambda q: q["position"])
        return {"mc": qs[0]["type"], "est": qs[1]["type"], "seq": qs[2]["type"]}


def typed(base: str, q: dict) -> dict:
    body = dict(q)
    body["type"] = type_names(base)[q["type"]]
    return body


class Host:

    def __init__(self, base: str, email: str | None = None, password: str | None = None):
        self.base = base
        self.c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        if email is None:
            s = slug("qm")
            email, password = f"qm-{s}@corkline.example", NEW_PASSWORD
            r = self.c.post("/api/auth/signup", json={"email": email, "password": password, "displayName": f"Host {s}"})
            assert r.status_code == 201, r.text
        else:
            r = self.c.post("/api/auth/login", json={"email": email, "password": password})
            assert r.status_code == 200, r.text
        self.email, self.password = email, password

    @property
    def cookie(self) -> str:
        return self.c.cookies.get("lastbell_session")

    @property
    def cookies(self) -> dict[str, str]:
        return {"lastbell_session": self.cookie}

    def deck(self, title: str | None = None, questions=()) -> tuple[str, list[dict]]:
        r = self.c.post("/api/decks", json={"title": title or f"Deck {slug('deck')}"})
        assert r.status_code == 201, r.text
        deck_id = r.json()["deck"]["id"]
        return deck_id, [self.add(deck_id, q) for q in questions]

    def add(self, deck_id: str, q: dict) -> dict:
        r = self.c.post(f"/api/decks/{deck_id}/questions", json=typed(self.base, q))
        assert r.status_code == 201, r.text
        return r.json()["question"]

    def get_deck(self, deck_id: str) -> dict:
        r = self.c.get(f"/api/decks/{deck_id}")
        assert r.status_code == 200, r.text
        return r.json()["deck"]

    def room(self, deck_id: str) -> dict:
        r = self.c.post("/api/rooms", json={"deckId": deck_id})
        assert r.status_code == 201, r.text
        return r.json()["room"]

    def cmd(self, room_id: str, command: str) -> httpx.Response:
        return self.c.post(f"/api/rooms/{room_id}/commands", json={"command": command})

    def go(self, room_id: str, *commands: str) -> dict:
        room: dict = {}
        for command in commands:
            r = self.cmd(room_id, command)
            assert r.status_code == 200, (command, r.status_code, r.text)
            room = r.json()["room"]
        return room

    def get_room(self, room_id: str) -> dict:
        r = self.c.get(f"/api/rooms/{room_id}/host")
        assert r.status_code == 200, r.text
        return r.json()["room"]


def upload(h: Host, deck_id: str, qid: str, data: bytes, name: str = "picture.png",
           ctype: str = "image/png", field: str = "image") -> httpx.Response:
    return h.c.post(f"/api/decks/{deck_id}/questions/{qid}/image", files={field: (name, data, ctype)})


def join(base: str, pin: str, nickname: str) -> httpx.Response:
    return httpx.post(f"{base}/api/rooms/join", json={"pin": pin, "nickname": nickname}, timeout=HTTP_TIMEOUT_S)


def seat(base: str, pin: str, nickname: str | None = None) -> dict:
    r = join(base, pin, nickname or nick("S"))
    assert r.status_code == 201, r.text
    return r.json()


def rejoin(base: str, token: str) -> httpx.Response:
    return httpx.post(f"{base}/api/rooms/rejoin", json={"rejoinToken": token}, timeout=HTTP_TIMEOUT_S)


def answer(base: str, room_id: str, client_id: str, index: int, **field: Any) -> httpx.Response:
    return httpx.post(f"{base}/api/rooms/{room_id}/answers",
                      json={"clientId": client_id, "questionIndex": index, **field}, timeout=HTTP_TIMEOUT_S)


def view(base: str, room_id: str, client_id: str) -> httpx.Response:
    return httpx.get(f"{base}/api/rooms/{room_id}/state", params={"clientId": client_id}, timeout=HTTP_TIMEOUT_S)


def server_now(base: str) -> int:
    r = httpx.get(f"{base}/api/time", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    return int(r.json()["serverNow"])


def wait_server_time(base: str, t_ms: int, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if server_now(base) >= t_ms:
            return
        nap(0.05)
    pytest.fail(f"GET /api/time never reached {t_ms}")


def events_until(base: str, room_id: str, params: dict, cookies: dict | None = None, after: int = 0,
                 target: int | None = None, want: Callable[[dict], bool] | None = None,
                 seconds: float = WAIT_S) -> list[dict]:
    got: list[dict] = []
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        r = httpx.get(f"{base}/api/rooms/{room_id}/poll", params={**params, "after": after},
                      cookies=cookies, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, r.text
        for e in r.json()["events"]:
            got.append(e)
            after = max(after, int(e["id"]))
        if target is not None and after >= target:
            return got
        if want is not None and any(want(e) for e in got):
            return got
        if target is None and want is None:
            return got
    pytest.fail(f"GET /api/rooms/{room_id}/poll never delivered the expected event (target={target})")


def wait_room(h: Host, room_id: str, pred: Callable[[dict], bool], what: str, seconds: float = WAIT_S) -> dict:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        room = h.get_room(room_id)
        if pred(room):
            return room
        nap()
    pytest.fail(f"GET /api/rooms/{room_id}/host never showed {what}")


def base_points(latency: int, window_ms: int) -> int:
    return MAX_POINTS - (DECAY_POINTS * latency) // window_ms


def correct_points(latency: int, window_ms: int, streak: int) -> int:
    return base_points(latency, window_ms) * (10 + min(streak - 1, 5)) // 10


def lis(seq_: list[int]) -> int:
    best: list[int] = []
    for x in seq_:
        i = next((k for k, v in enumerate(best) if v >= x), len(best))
        best[i:i + 1] = [x]
    return len(best)


def share(count: int, total: int) -> int:
    return 0 if total == 0 else (count * 200 + total) // (2 * total)


def order_ids(question: dict, labels) -> list[str]:
    by = {i["label"]: i["id"] for i in question["items"]}
    return [by[label] for label in labels]


def results_by_seat(reveal: dict) -> dict[str, dict]:
    return {r["seatId"]: r for r in reveal["results"]}


def all_keys(obj: Any) -> set[str]:
    if isinstance(obj, dict):
        return set(obj) | set().union(*(all_keys(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(all_keys(v) for v in obj)) if obj else set()
    return set()


def leaderboard_key(room_id: str) -> str:
    return f"lastbell:room:{room_id}:leaderboard"


def clients_key(room_id: str) -> str:
    return f"lastbell:room:{room_id}:clients"


def zscore(valkey: Any, room_id: str, seat_id: str) -> float | None:
    raw = valkey.command("ZSCORE", leaderboard_key(room_id), seat_id)
    if raw is None:
        return None
    return float(raw.decode() if isinstance(raw, bytes) else raw)


def wait_members(valkey: Any, room_id: str, pred: Callable[[set], bool], what: str, seconds: float = WAIT_S) -> float:
    start = time.monotonic()
    while time.monotonic() < start + seconds:
        if pred(set(valkey.members(clients_key(room_id)))):
            return time.monotonic() - start
        nap(0.1)
    pytest.fail(f"Valkey {clients_key(room_id)} never showed {what}")


def busy_sessions(pg: Any) -> int:
    rows = pg.rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() "
                   "AND usename <> current_user AND state IN ('active', 'idle in transaction')")
    return int(rows[0]["n"])


def wait_no_busy_sessions(pg: Any, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if busy_sessions(pg) == 0:
            return
        nap(0.1)
    pytest.fail("an app database session stayed active or idle in transaction after streams closed (L440)")


class Stream:

    def __init__(self, base: str, room_id: str, params: dict, cookies: dict | None = None,
                 last_event_id: int | None = None):
        self.events: list[dict] = []
        self.status: int | None = None
        self.body = b""
        self.opened = threading.Event()
        self.ended = threading.Event()
        self._resp: httpx.Response | None = None
        self._client = httpx.Client(base_url=base, cookies=cookies,
                                    timeout=httpx.Timeout(HTTP_TIMEOUT_S, read=SSE_READ_S))
        headers = {"Last-Event-ID": str(last_event_id)} if last_event_id is not None else {}
        self._args = (f"/api/rooms/{room_id}/stream", params, headers)
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        path, params, headers = self._args
        try:
            with self._client.stream("GET", path, params=params, headers=headers) as resp:
                self._resp = resp
                self.status = resp.status_code
                self.opened.set()
                if resp.status_code != 200:
                    self.body = resp.read()
                    return
                current: dict[str, str] = {}
                for line in resp.iter_lines():
                    if line == "":
                        if current:
                            self.events.append(current)
                            current = {}
                        continue
                    if line.startswith(":"):
                        continue
                    name, _, value = line.partition(":")
                    value = value[1:] if value.startswith(" ") else value
                    if name == "data" and "data" in current:
                        current["data"] += "\n" + value
                    else:
                        current[name] = value
        except (httpx.HTTPError, RuntimeError, OSError, ValueError):
            pass
        finally:
            self.opened.set()
            self.ended.set()

    def wait_open(self) -> int:
        assert self.opened.wait(HTTP_TIMEOUT_S), "stream never answered"
        assert self.status is not None, "stream failed before headers"
        return self.status

    def wait_for(self, pred: Callable[[dict], bool], what: str, seconds: float = WAIT_S) -> dict:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            hit = next((e for e in list(self.events) if pred(e)), None)
            if hit:
                return hit
            if self.ended.is_set():
                break
            nap(0.1)
        hit = next((e for e in list(self.events) if pred(e)), None)
        if hit:
            return hit
        pytest.fail(f"stream never carried {what}; got {[e.get('event') for e in self.events]}")

    def close(self) -> None:
        if self._resp is not None:
            with contextlib.suppress(Exception):
                self._resp.close()
        with contextlib.suppress(Exception):
            self._client.close()
        self.ended.wait(HTTP_TIMEOUT_S)


def stream_status(base: str, room_id: str, params: dict, cookies: dict | None = None) -> tuple[int, Any]:
    with httpx.Client(base_url=base, cookies=cookies, timeout=HTTP_TIMEOUT_S) as c:
        with c.stream("GET", f"/api/rooms/{room_id}/stream", params=params) as r:
            if r.status_code == 200:
                return 200, None
            return r.status_code, json.loads(r.read() or b"{}")


@contextlib.contextmanager
def signed_in(browser: Any, h: Host, path: str, live: bool = True, size=(DESK_W, DESK_H),
              skew_s: float = 0, **options: Any) -> Iterator[Page]:
    with ctx(open_app(browser, h.base + "/", **options)) as page:
        page.context.add_cookies([{"name": "lastbell_session", "value": h.cookie, "url": h.base}])
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if skew_s:
            page.clock.set_system_time(datetime.now(timezone.utc) + timedelta(seconds=skew_s))
        if live:
            page.clock.resume()
        page.goto(h.base + path)
        yield page


@contextlib.contextmanager
def phone(browser: Any, base: str, pin: str, nickname: str, skew_s: float = 0, size=(PHONE_W, PHONE_H),
          **options: Any) -> Iterator[tuple[Page, dict]]:
    with ctx(open_app(browser, base + "/", **options)) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if skew_s:
            page.clock.set_system_time(datetime.now(timezone.utc) + timedelta(seconds=skew_s))
        page.clock.resume()
        with page.expect_response(lambda r: "/api/rooms/join" in r.url and r.request.method == "POST") as info:
            page.get_by_role("textbox", name="Room PIN").fill(pin)
            page.get_by_role("textbox", name="Nickname").fill(nickname)
            page.get_by_role("button", name="Join the night").click()
        assert info.value.status == 201, info.value.text()
        joined = info.value.json()
        expect(page).to_have_url(re.compile(r"/play/"))
        yield page, joined


def wait_ui(page: Page, check: Callable[[], None], what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            check()
            return
        except AssertionError:
            advance(page, UI_STEP_MS)
    pytest.fail(f"{what} never appeared")


def tab_to(page: Page, locator: Any) -> None:
    for _ in range(TAB_LIMIT):
        if locator.evaluate("el => el === document.activeElement"):
            return
        page.keyboard.press("Tab")
    pytest.fail(f"Tab never reached {locator}")


def type_in(locator: Any, value: Any) -> None:
    locator.focus()
    locator.press("Control+a")
    locator.press_sequentially(str(value))


def press(locator: Any) -> None:
    locator.focus()
    locator.press("Enter")


def norm(text: str) -> str:
    return " ".join(text.split())


def question_group(n: int) -> str:
    return f"Question {n}"


def question_open_copy(n: int) -> str:
    return f"Question {n} is open"


def stage_open_copy(n: int) -> str:
    return f"Question {n} open"


def item_texts(lst: Any) -> list[str]:
    return [norm(t) for t in lst.get_by_role("listitem").all_inner_texts()]


def count_of(text: str) -> int:
    m = re.search(r"—\s*(\d+)", text)
    assert m, f"no count in {text!r}"
    return int(m.group(1))


def shown_seconds(timer: Any) -> int:
    m = re.search(r"\d+", timer.inner_text())
    assert m, "timer shows no number"
    return int(m.group())


def fmt_num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


class Relay:

    def __init__(self, host: str, port: int):
        self.target = (host, port)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        self.enabled = threading.Event()
        self.enabled.set()
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.conns: list[socket.socket] = []
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.stopped.is_set():
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            if not self.enabled.is_set():
                client.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=5)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.conns += [client, upstream]
            threading.Thread(target=self._pipe, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pipe, args=(upstream, client), daemon=True).start()

    def _pipe(self, src: socket.socket, dst: socket.socket) -> None:
        try:
            while not self.stopped.is_set():
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)

    def cut(self) -> None:
        self.enabled.clear()
        with self.lock:
            for s in self.conns:
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)
                with contextlib.suppress(OSError):
                    s.close()
            self.conns.clear()

    def restore(self) -> None:
        self.enabled.set()

    def stop(self) -> None:
        self.stopped.set()
        self.cut()
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def short_link_app() -> Iterator[str]:
    if not os.environ.get("DATABASE_URL"):
        pytest.fail("DATABASE_URL must be set in the verifier to start an app copy")
    port = free_port()
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    env = {**os.environ, "IMAGE_URL_TTL_SECONDS": str(SHORT_TTL_S), "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text()[-4000:]

    try:
        deadline = time.monotonic() + WAIT_S * 4
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited: {tail()}")
            with contextlib.suppress(httpx.TransportError):
                if httpx.get(f"{base}/api/health", timeout=5).status_code == 200:
                    break
            nap(0.25)
        else:
            pytest.fail(f"app copy never answered health: {tail()}")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=WAIT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


@contextlib.contextmanager
def relayed_app() -> Iterator[tuple[str, Relay, subprocess.Popen]]:
    valkey_url = os.environ.get("VALKEY_URL")
    if not valkey_url or not os.environ.get("DATABASE_URL"):
        pytest.fail("VALKEY_URL and DATABASE_URL must be set in the verifier to start an app copy")
    parsed = urlparse(valkey_url)
    relay = Relay(parsed.hostname or "127.0.0.1", parsed.port or 6379)
    auth = f"{parsed.username or ''}{':' + parsed.password if parsed.password else ''}@" if (parsed.username or parsed.password) else ""
    relayed = urlunparse(parsed._replace(netloc=f"{auth}127.0.0.1:{relay.port}"))
    port = free_port()
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    env = {**os.environ, "VALKEY_URL": relayed, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text()[-4000:]

    try:
        deadline = time.monotonic() + WAIT_S * 4
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited: {tail()}")
            with contextlib.suppress(httpx.TransportError):
                if httpx.get(f"{base}/api/health", timeout=5).status_code == 200:
                    break
            nap(0.25)
        else:
            pytest.fail(f"app copy never answered health: {tail()}")
        yield base, relay, proc
        assert proc.poll() is None, f"app copy restarted or exited: {tail()}"
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=WAIT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        relay.stop()


def test_wf_deck_authoring_accounts(app_url, browser):
    s = slug("acct")
    email = f"acct-{s}@corkline.example"
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    r = c.post("/api/auth/signup", json={"email": email, "password": NEW_PASSWORD, "displayName": f"Host {s}"})
    assert r.status_code == 201, r.text
    qm = r.json()["quizmaster"]
    assert set(qm) == {"id", "email", "displayName"}
    assert qm["id"] not in (None, "")
    cookie = r.headers.get("set-cookie", "").lower()
    assert "lastbell_session" in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
    stored = next(ck for ck in c.cookies.jar if ck.name == "lastbell_session")
    assert stored.expires is not None and abs(stored.expires - server_now(app_url) / 1000 - SESSION_S) <= DAY_S
    me = c.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["quizmaster"]["id"] == qm["id"]

    dup = httpx.post(f"{app_url}/api/auth/signup", timeout=HTTP_TIMEOUT_S,
                     json={"email": email.upper(), "password": NEW_PASSWORD, "displayName": "Twin"})
    assert dup.status_code == 409 and dup.json()["error"] == "email_taken"
    for body, field in (
        ({"email": "not-an-address", "password": NEW_PASSWORD, "displayName": "A"}, "email"),
        ({"email": f"p-{s}@corkline.example", "password": "x" * (PASSWORD_MIN - 1), "displayName": "A"}, "password"),
        ({"email": f"d-{s}@corkline.example", "password": NEW_PASSWORD, "displayName": "   "}, "displayName"),
        ({"email": f"e-{s}@corkline.example", "password": NEW_PASSWORD, "displayName": "d" * (DISPLAY_MAX + 1)}, "displayName"),
    ):
        bad = httpx.post(f"{app_url}/api/auth/signup", json=body, timeout=HTTP_TIMEOUT_S)
        assert bad.status_code == 422, (field, bad.text)
        assert bad.json()["error"] == "validation_failed" and field in bad.json()["fields"]

    old = c.cookies.get("lastbell_session")
    assert c.post("/api/auth/logout").status_code == 204
    gone = httpx.get(f"{app_url}/api/auth/me", cookies={"lastbell_session": old}, timeout=HTTP_TIMEOUT_S)
    assert gone.status_code == 401 and gone.json()["error"] == "not_signed_in"
    wrong = httpx.post(f"{app_url}/api/auth/login", json={"email": email, "password": NEW_PASSWORD + "x"},
                       timeout=HTTP_TIMEOUT_S)
    assert wrong.status_code == 401 and wrong.json()["error"] == "invalid_credentials"
    ok = httpx.post(f"{app_url}/api/auth/login", json={"email": email, "password": NEW_PASSWORD}, timeout=HTTP_TIMEOUT_S)
    assert ok.status_code == 200 and ok.json()["quizmaster"]["id"] == qm["id"]
    for method, path in (("GET", "/api/decks"), ("POST", "/api/decks"), ("GET", "/api/nights"),
                         ("POST", "/api/rooms"), ("GET", "/api/auth/me"), ("GET", f"/api/decks/{uuid.uuid4()}")):
        r = httpx.request(method, app_url + path, json={} if method == "POST" else None, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 401 and r.json()["error"] == "not_signed_in", (method, path, r.text)

    with ctx(open_app(browser, app_url + "/")) as page:
        page.clock.resume()
        for path in ("/host", "/host/nights", f"/host/decks/{uuid.uuid4()}", f"/host/nights/{uuid.uuid4()}",
                     f"/stage/{uuid.uuid4()}"):
            page.goto(app_url + path)
            expect(page).to_have_url(re.compile(r"/host/login(\?.*)?$"))
        page.get_by_label("Email", exact=True).fill(email)
        page.get_by_label("Password", exact=True).fill(NEW_PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(page.get_by_role("heading", name="Your decks")).to_be_visible()
        expect(page).to_have_url(re.compile(r"/host/?(\?.*)?$"))
        page.goto(app_url + "/host/login")
        expect(page).to_have_url(re.compile(r"/host/?(\?.*)?$"))
        page.get_by_role("button", name="Sign out").click()
        expect(page).to_have_url(re.compile(r"/host/login(\?.*)?$"))
        page.goto(app_url + "/host")
        expect(page).to_have_url(re.compile(r"/host/login(\?.*)?$"))


def test_decks_isolated_by_owner(app_url):
    a, b = Host(app_url), Host(app_url)
    deck_id, (q,) = a.deck(questions=[mc()])
    room = a.room(deck_id)
    night = a.room(deck_id)
    a.go(night["id"], *FULL_NIGHT)
    unknown = httpx.get(f"{app_url}/api/decks/{uuid.uuid4()}", cookies=b.cookies, timeout=HTTP_TIMEOUT_S)
    assert unknown.status_code == 404 and unknown.json()["error"] == "not_found"
    put_body = {**typed(app_url, mc(prompt="Taken over?")), "version": 1}
    for method, path, body in (
        ("GET", f"/api/decks/{deck_id}", None),
        ("PATCH", f"/api/decks/{deck_id}", {"title": "Taken over", "version": 1}),
        ("POST", f"/api/decks/{deck_id}/questions", typed(app_url, mc())),
        ("PUT", f"/api/decks/{deck_id}/questions/{q['id']}", put_body),
        ("DELETE", f"/api/decks/{deck_id}/questions/{q['id']}/image", None),
        ("DELETE", f"/api/decks/{deck_id}/questions/{q['id']}", None),
        ("POST", "/api/rooms", {"deckId": deck_id}),
        ("GET", f"/api/rooms/{room['id']}/host", None),
        ("POST", f"/api/rooms/{room['id']}/commands", {"command": "open_question"}),
        ("GET", f"/api/nights/{night['id']}", None),
    ):
        r = b.c.request(method, path, json=body)
        assert r.status_code == 404 and r.json() == unknown.json(), (method, path, r.status_code, r.text)
    pic = upload(b, deck_id, q["id"], PNG)
    assert pic.status_code == 404 and pic.json()["error"] == "not_found"
    assert deck_id not in {d["id"] for d in b.c.get("/api/decks").json()["decks"]}
    assert night["id"] not in {n["roomId"] for n in b.c.get("/api/nights").json()["nights"]}
    deck = a.get_deck(deck_id)
    assert deck["version"] == 1 and deck["questions"][0]["prompt"] == SEED_MC_PROMPT and deck["questions"][0]["image"] is None
    assert a.get_room(room["id"])["state"] == "lobby"
    assert night["id"] in {n["roomId"] for n in a.c.get("/api/nights").json()["nights"]}

    ines, rowan = Host(app_url, INES_EMAIL, INES_PASSWORD), Host(app_url, ROWAN_EMAIL, ROWAN_PASSWORD)
    ines_decks = {d["title"]: d for d in ines.c.get("/api/decks").json()["decks"]}
    rowan_decks = {d["title"]: d for d in rowan.c.get("/api/decks").json()["decks"]}
    assert ines_decks[SEED_DECK]["questionCount"] == 4 and ines_decks[SEED_PRACTICE]["questionCount"] == 0
    assert rowan_decks[SEED_ROWAN_DECK]["questionCount"] == 1
    assert SEED_DECK not in rowan_decks and SEED_ROWAN_DECK not in ines_decks
    seed_night = next(n for n in ines.c.get("/api/nights").json()["nights"] if n["deckTitle"] == SEED_DECK)
    assert rowan.c.get(f"/api/nights/{seed_night['roomId']}").status_code == 404
    assert rowan.c.get(f"/api/decks/{ines_decks[SEED_DECK]['id']}").status_code == 404


QUESTION_CASES = {
    "mc_two_options": ("question", mc(options=("Ag", "Au"), correct=1), 201),
    "mc_one_option": ("question", mc(options=("Au",)), 422),
    "mc_five_options": ("question", mc(options=("Ag", "Au", "Gd", "Go", "Mars")), 422),
    "mc_correct_index_outside": ("question", mc(correct=4), 422),
    "mc_option_at_limit": ("question", mc(options=("x" * OPTION_MAX, "Au")), 201),
    "mc_option_too_long": ("question", mc(options=("x" * (OPTION_MAX + 1), "Au")), 422),
    "prompt_empty": ("question", mc(prompt=""), 422),
    "prompt_at_limit": ("question", mc(prompt="p" * PROMPT_MAX), 201),
    "prompt_too_long": ("question", mc(prompt="p" * (PROMPT_MAX + 1)), 422),
    "time_below_min": ("question", mc(t=SHORT_LIMIT_S - 1), 422),
    "time_at_min": ("question", mc(t=SHORT_LIMIT_S), 201),
    "time_at_max": ("question", mc(t=LONG_LIMIT_S), 201),
    "time_above_max": ("question", mc(t=LONG_LIMIT_S + 1), 422),
    "time_fractional": ("question", mc(t=7.5), 422),
    "est_min_not_below_max": ("question", est(mn=EST_ANSWER, mx=EST_ANSWER, tol=0), 422),
    "est_step_zero": ("question", est(step=0), 422),
    "est_answer_outside": ("question", est(answer=EST_MAX + 1), 422),
    "est_tolerance_negative": ("question", est(tol=-1), 422),
    "est_tolerance_full_range": ("question", est(tol=EST_MAX - EST_MIN), 201),
    "est_tolerance_beyond_range": ("question", est(tol=EST_MAX - EST_MIN + 1), 422),
    "est_unit_at_limit": ("question", est(unit="u" * UNIT_MAX), 201),
    "est_unit_too_long": ("question", est(unit="u" * (UNIT_MAX + 1)), 422),
    "seq_two_items": ("question", seq(items=SEED_SEQ[:2]), 422),
    "seq_six_items": ("question", seq(items=SEED_SEQ + ("Radio", "Television")), 201),
    "seq_seven_items": ("question", seq(items=SEED_SEQ + ("Radio", "Television", "Laser")), 422),
    "seq_duplicate_ignoring_case": ("question", seq(items=("Telephone", "TELEPHONE", "Steam engine")), 422),
    "deck_title_blank": ("title", "   ", 422),
    "deck_title_at_limit": ("title", "t" * TITLE_MAX, 200),
    "deck_title_too_long": ("title", "t" * (TITLE_MAX + 1), 422),
    "deck_full": ("full", None, 409),
}


QUESTION_CASE_IDS = [
    "mc_two_options", "mc_one_option", "mc_five_options", "mc_correct_index_outside", "mc_option_at_limit",
    "mc_option_too_long", "prompt_empty", "prompt_at_limit", "prompt_too_long", "time_below_min", "time_at_min",
    "time_at_max", "time_above_max", "time_fractional", "est_min_not_below_max", "est_step_zero",
    "est_answer_outside", "est_tolerance_negative", "est_tolerance_full_range", "est_tolerance_beyond_range",
    "est_unit_at_limit", "est_unit_too_long", "seq_two_items", "seq_six_items", "seq_seven_items",
    "seq_duplicate_ignoring_case", "deck_title_blank", "deck_title_at_limit", "deck_title_too_long", "deck_full",
]


@pytest.mark.parametrize("case_id", QUESTION_CASE_IDS, ids=QUESTION_CASE_IDS)
def test_question_rules(app_url, case_id):
    kind, body, status = QUESTION_CASES[case_id]
    h = Host(app_url)
    deck_id, _ = h.deck()
    if kind == "question":
        r = h.c.post(f"/api/decks/{deck_id}/questions", json=typed(app_url, body))
        assert r.status_code == status, r.text
        questions = h.get_deck(deck_id)["questions"]
        if status == 201:
            q = r.json()["question"]
            assert (q["position"], q["version"], q["prompt"], q["timeLimitSeconds"]) == (1, 1, body["prompt"], body["timeLimitSeconds"])
            assert [x["id"] for x in questions] == [q["id"]]
        else:
            assert r.json()["error"] == "validation_failed" and r.json()["fields"]
            assert questions == []
    elif kind == "title":
        r = h.c.patch(f"/api/decks/{deck_id}", json={"title": body, "version": 1})
        assert r.status_code == status, r.text
        deck = h.get_deck(deck_id)
        if status == 200:
            assert deck["title"] == body and deck["version"] == 2
        else:
            assert r.json()["error"] == "validation_failed" and deck["version"] == 1
    else:
        for _ in range(DECK_MAX):
            h.add(deck_id, mc())
        r = h.c.post(f"/api/decks/{deck_id}/questions", json=typed(app_url, mc()))
        assert r.status_code == 409 and r.json()["error"] == "deck_full"
        assert len(h.get_deck(deck_id)["questions"]) == DECK_MAX


def test_wf_deck_authoring_conflict(app_url):
    h = Host(app_url)
    deck_id, (q,) = h.deck(questions=[mc()])
    t1, t2 = f"First {slug('t')}", f"Second {slug('t')}"
    r = h.c.patch(f"/api/decks/{deck_id}", json={"title": t1, "version": 1})
    assert r.status_code == 200 and r.json()["deck"]["version"] == 2
    r = h.c.patch(f"/api/decks/{deck_id}", json={"title": t2, "version": 1})
    assert r.status_code == 412 and r.json()["error"] == "version_conflict" and r.json()["currentVersion"] == 2
    deck = h.get_deck(deck_id)
    assert (deck["title"], deck["version"]) == (t1, 2)
    path = f"/api/decks/{deck_id}/questions/{q['id']}"
    edited = f"Edited {slug('p')}"
    r = h.c.put(path, json={**typed(app_url, mc(prompt=edited)), "version": 1})
    assert r.status_code == 200 and r.json()["question"]["version"] == 2
    r = h.c.put(path, json={**typed(app_url, mc(prompt="Edited from stale?")), "version": 1})
    assert r.status_code == 412 and r.json()["currentVersion"] == 2
    assert h.get_deck(deck_id)["questions"][0]["prompt"] == edited
    pic = upload(h, deck_id, q["id"], PNG)
    assert pic.status_code == 201 and pic.json()["question"]["version"] == 3
    r = h.c.put(path, json={**typed(app_url, mc(prompt="Edited before picture?")), "version": 2})
    assert r.status_code == 412 and r.json()["currentVersion"] == 3
    after = h.get_deck(deck_id)["questions"][0]
    assert after["prompt"] == edited and after["image"]["status"] == "attached"

    titles = [f"Race {i} {slug('r')}" for i in range(RACERS)]
    results = race([lambda t=t: httpx.patch(f"{app_url}/api/decks/{deck_id}", json={"title": t, "version": 2},
                                            cookies=h.cookies, timeout=HTTP_TIMEOUT_S) for t in titles])
    winners = [t for t, r in zip(titles, results) if r.status_code == 200]
    assert len(winners) == 1, [r.status_code for r in results]
    assert all(r.status_code == 412 and r.json()["error"] == "version_conflict" for r in results if r.status_code != 200)
    deck = h.get_deck(deck_id)
    assert (deck["title"], deck["version"]) == (winners[0], 3)


def test_wf_deck_authoring_happy(app_url, browser):
    h = Host(app_url)
    title = f"Deck {slug('ui')}"
    with ctx(open_app(browser, app_url + "/host/login")) as page:
        page.set_viewport_size({"width": DESK_W, "height": DESK_H})
        page.clock.resume()
        type_in(page.get_by_label("Email", exact=True), h.email)
        type_in(page.get_by_label("Password", exact=True), h.password)
        press(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("heading", name="Your decks")).to_be_visible()
        type_in(page.get_by_role("textbox", name="New deck title"), title)
        press(page.get_by_role("button", name="Create deck"))
        expect(page.get_by_role("status", name="Decks status")).to_contain_text("Deck created")
        row = page.get_by_role("list", name="Decks").get_by_role("listitem").filter(has_text=title)
        press(row.get_by_role("link", name=title))
        expect(page).to_have_url(re.compile(r"/host/decks/"))
        deck_id = page.url.split("?")[0].rstrip("/").split("/")[-1]
        status = page.get_by_role("status", name="Editor status")

        def new_question(n: int, label: str):
            press(page.get_by_role("button", name="Add question"))
            group = page.get_by_role("group", name=f"Question {n}")
            expect(group).to_be_visible()
            select(group.get_by_role("combobox", name="Question type"), label)
            return group

        def save(group, count: int) -> None:
            press(group.get_by_role("button", name="Save question"))
            expect(status).to_contain_text("Saved")
            deadline = time.monotonic() + WAIT_S
            while time.monotonic() < deadline and len(h.get_deck(deck_id)["questions"]) < count:
                nap()
            assert len(h.get_deck(deck_id)["questions"]) >= count, "Save question did not store the question"

        g1 = new_question(1, "Multiple choice")
        type_in(g1.get_by_role("textbox", name="Prompt"), SEED_MC_PROMPT)
        type_in(g1.get_by_role("spinbutton", name="Time limit (seconds)"), 20)
        for letter, option in zip("ABCD", SEED_MC_OPTIONS):
            type_in(g1.get_by_role("textbox", name=f"Option {letter}"), option)
        g1.get_by_role("radio", name="Correct: A").focus()
        page.keyboard.press("Space")
        save(g1, 1)
        g2 = new_question(2, "Estimate")
        type_in(g2.get_by_role("textbox", name="Prompt"), SEED_EST_PROMPT)
        type_in(g2.get_by_role("spinbutton", name="Time limit (seconds)"), 25)
        for name, value in (("Minimum", EST_MIN), ("Maximum", EST_MAX), ("Step", 1), ("Correct value", EST_ANSWER),
                            ("Tolerance", EST_TOL)):
            type_in(g2.get_by_role("spinbutton", name=name), value)
        type_in(g2.get_by_role("textbox", name="Unit"), EST_UNIT)
        save(g2, 2)
        g3 = new_question(3, "Sequence")
        type_in(g3.get_by_role("textbox", name="Prompt"), SEED_SEQ_PROMPT)
        type_in(g3.get_by_role("spinbutton", name="Time limit (seconds)"), 30)
        for i, item in enumerate(SEED_SEQ, start=1):
            type_in(g3.get_by_role("textbox", name=f"Item {i}"), item)
        save(g3, 3)
        g1.get_by_label("Picture for question 1").set_input_files(
            files=[{"name": "chalk.png", "mimeType": "image/png", "buffer": PNG}])
        expect(status).to_contain_text("Picture attached")
        expect(g1.get_by_role("img", name="Picture for question 1")).to_be_visible()
        page.goto(app_url + "/host")
        page.reload()
        row = page.get_by_role("list", name="Decks").get_by_role("listitem").filter(has_text=title)
        expect(row).to_contain_text("3 questions")
        expect(row.get_by_role("button", name=f"Open room for {title}")).to_be_visible()
    deck = h.get_deck(deck_id)
    qs = sorted(deck["questions"], key=lambda q: q["position"])
    names = type_names(app_url)
    assert [q["type"] for q in qs] == [names["mc"], names["est"], names["seq"]]
    assert qs[0]["options"] == list(SEED_MC_OPTIONS) and qs[0]["correctIndex"] == 0
    assert (qs[1]["min"], qs[1]["max"], qs[1]["answer"], qs[1]["tolerance"], qs[1]["unit"]) == (EST_MIN, EST_MAX, EST_ANSWER, EST_TOL, EST_UNIT)
    assert qs[2]["items"] == list(SEED_SEQ)
    assert qs[0]["image"]["status"] == "attached"
    key = f"questions/{qs[0]['id']}/{hashlib.sha256(PNG).hexdigest()}.png"
    assert S3().get(key) == PNG
    assert any(d["id"] == deck_id and d["questionCount"] == 3 for d in h.c.get("/api/decks").json()["decks"])


PIC_CASES = {
    "png_named_as_text": ("notes.txt", PNG, "text/plain", "png"),
    "jpeg_declared_as_text": ("photo", JPEG, "text/plain", "jpg"),
    "webp_declared_as_png": ("pic.png", WEBP, "image/png", "webp"),
    "svg_with_script": ("pic.png", SVG, "image/png", None),
    "gif": ("pic.gif", GIF, "image/gif", None),
    "html_declared_jpeg": ("pic.jpg", HTML, "image/jpeg", None),
    "plain_text_named_webp": ("pic.webp", TEXT, "image/webp", None),
}


PIC_CASE_IDS = ["png_named_as_text", "jpeg_declared_as_text", "webp_declared_as_png", "svg_with_script", "gif",
                "html_declared_jpeg", "plain_text_named_webp"]


@pytest.mark.parametrize("case", list(PIC_CASES.values()), ids=PIC_CASE_IDS)
def test_wf_question_images_sniffing(app_url, case):
    name, data, declared, ext = case
    h = Host(app_url)
    deck_id, (q,) = h.deck(questions=[mc()])
    r = upload(h, deck_id, q["id"], data, name=name, ctype=declared)
    keys = S3().keys(f"questions/{q['id']}/")
    stored = h.get_deck(deck_id)["questions"][0]
    if ext:
        assert r.status_code == 201, r.text
        assert r.json()["question"]["image"]["status"] == "attached"
        assert keys == [f"questions/{q['id']}/{hashlib.sha256(data).hexdigest()}.{ext}"]
        assert name not in keys[0]
    else:
        assert r.status_code == 415 and r.json()["error"] == "unsupported_type", r.text
        assert keys == [] and stored["image"] is None and stored["version"] == 1


def test_picture_size_limits(app_url):
    h = Host(app_url)
    deck_id, qs = h.deck(questions=[mc(), mc(), mc(), mc(), mc()])
    exact = png_bytes(PIC_LIMIT)
    assert len(exact) == PIC_LIMIT
    r = upload(h, deck_id, qs[0]["id"], exact)
    assert r.status_code == 201, r.text
    assert r.json()["question"]["image"]["bytes"] == PIC_LIMIT
    assert len(S3().get(f"questions/{qs[0]['id']}/{hashlib.sha256(exact).hexdigest()}.png")) == PIC_LIMIT
    refusals = (
        (qs[1], png_bytes(PIC_LIMIT + 1), "image", 413, "image_too_large"),
        (qs[2], b"", "image", 422, "empty_file"),
        (qs[3], PNG, "picture", 422, "empty_file"),
        (qs[4], b"t" * (PIC_LIMIT + 1), "image", 413, "image_too_large"),
    )
    for q, data, field, status, code in refusals:
        r = upload(h, deck_id, q["id"], data, field=field)
        assert r.status_code == status and r.json()["error"] == code, (code, r.status_code, r.text)
        assert S3().keys(f"questions/{q['id']}/") == []
    stored = {x["id"]: x for x in h.get_deck(deck_id)["questions"]}
    for q, *_ in refusals:
        assert stored[q["id"]]["image"] is None and stored[q["id"]]["version"] == 1


def test_wf_question_images_stored(app_url):
    h = Host(app_url)
    bucket = os.environ.get("S3_BUCKET")
    for ext, data, word in (("png", PNG, "png"), ("jpg", JPEG, "jpeg"), ("webp", WEBP, "webp")):
        deck_id, (q,) = h.deck(questions=[mc()])
        r = upload(h, deck_id, q["id"], data, name="upload.bin", ctype="application/octet-stream")
        assert r.status_code == 201, r.text
        image = r.json()["question"]["image"]
        assert image["status"] == "attached" and image["bytes"] == len(data)
        key = f"questions/{q['id']}/{hashlib.sha256(data).hexdigest()}.{ext}"
        assert S3().keys(f"questions/{q['id']}/") == [key]
        assert S3().get(key) == data
        assert word in image["contentType"].lower()
        link = urlparse(image["previewUrl"])
        assert link.path.endswith(f"/{key}")
        if bucket:
            assert link.path == f"/{bucket}/{key}"
        got = httpx.get(image["previewUrl"], timeout=HTTP_TIMEOUT_S)
        assert got.status_code == 200 and got.content == data
        assert got.headers["content-type"].split(";")[0].strip().lower() == image["contentType"].lower()
        assert h.get_deck(deck_id)["questions"][0]["image"]["status"] == "attached"


def test_editor_upload_states(app_url, browser):
    h = Host(app_url)
    deck_id, (q,) = h.deck(questions=[mc()])
    with signed_in(browser, h, f"/host/decks/{deck_id}") as page:
        group = page.get_by_role("group", name=question_group(1))
        status = page.get_by_role("status", name="Editor status")
        expect(group).to_contain_text("No picture")
        with ctx(held(page, "**/questions/*/image")) as hold:
            group.get_by_label("Picture for question 1").set_input_files(
                files=[{"name": "chalk.png", "mimeType": "image/png", "buffer": PNG}])
            expect(status).to_contain_text("Uploading picture…")
            expect(group.get_by_role("img")).to_have_count(0)
            assert h.get_deck(deck_id)["questions"][0]["image"] is None
            hold.release()
        expect(status).to_contain_text("Picture attached")
        thumb = group.get_by_role("img", name="Picture for question 1")
        expect(thumb).to_be_visible()
        expect(group).to_contain_text("Picture attached")
        image = h.get_deck(deck_id)["questions"][0]["image"]
        assert urlparse(thumb.get_attribute("src") or "").path == urlparse(image["previewUrl"]).path
        page.wait_for_function("el => el.complete && el.naturalWidth > 0", arg=thumb.element_handle())
        group.get_by_role("button", name="Remove picture").click()
        expect(status).to_contain_text("Picture removed")
        expect(group.get_by_role("img")).to_have_count(0)
    assert h.get_deck(deck_id)["questions"][0]["image"] is None


def test_wf_question_images_outage(browser):
    base = os.environ["APP_MINIO_DOWN_URL"]
    h = Host(base)
    deck_id, (q,) = h.deck(questions=[mc()])
    r = upload(h, deck_id, q["id"], PNG)
    assert r.status_code == 503 and r.json()["error"] == "image_store_unavailable", r.text
    r = h.c.delete(f"/api/decks/{deck_id}/questions/{q['id']}/image")
    assert r.status_code == 204 or (r.status_code == 503 and r.json()["error"] == "image_store_unavailable"), r.text
    stored = h.get_deck(deck_id)["questions"][0]
    assert stored["image"] is None and stored["version"] == 1
    assert S3().keys(f"questions/{q['id']}/") == []
    with signed_in(browser, h, f"/host/decks/{deck_id}") as page:
        group = page.get_by_role("group", name=question_group(1))
        group.get_by_label("Picture for question 1").set_input_files(
            files=[{"name": "chalk.png", "mimeType": "image/png", "buffer": PNG}])
        expect(page.get_by_role("status", name="Editor status")).to_contain_text(
            "Picture storage is down. The question is saved without a picture.")
        expect(group).to_contain_text("No picture")
        expect(group.get_by_role("img")).to_have_count(0)
    assert any(d["id"] == deck_id for d in h.c.get("/api/decks").json()["decks"])
    room = h.room(deck_id)
    s = seat(base, room["pin"])
    opened = h.go(room["id"], "open_question")
    assert opened["question"]["imageUrl"] is None
    assert answer(base, room["id"], s["clientId"], 1, choice=0).status_code == 201
    h.go(room["id"], "lock", "reveal", "show_leaderboard", "show_podium", "end")
    nights = h.c.get("/api/nights")
    assert nights.status_code == 200 and room["id"] in {n["roomId"] for n in nights.json()["nights"]}


@pytest.mark.timeout(900)
def test_wf_question_images_link_expiry():
    with short_link_app() as base:
        _link_expiry(base)


def _link_expiry(base: str) -> None:
    h = Host(base)
    deck_id, (q,) = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    r = upload(h, deck_id, q["id"], PNG)
    assert r.status_code == 201, r.text
    preview = r.json()["question"]["image"]["previewUrl"]
    room = h.room(deck_id)
    issued = time.monotonic()
    first = h.go(room["id"], "open_question")["question"]["imageUrl"]
    assert first
    got = httpx.get(first, timeout=HTTP_TIMEOUT_S)
    assert got.status_code == 200 and got.content == PNG
    assert time.monotonic() - issued < SHORT_TTL_S, "first fetch was too slow to prove the link works within its lifetime"
    deadline = issued + SHORT_TTL_S + SLACK_S + 2
    while time.monotonic() < deadline:
        if httpx.get(first, timeout=HTTP_TIMEOUT_S).status_code != 200:
            break
        nap()
    else:
        pytest.fail("the question link still worked well past IMAGE_URL_TTL_SECONDS")
    assert httpx.get(preview, timeout=HTTP_TIMEOUT_S).status_code != 200
    fresh = h.get_room(room["id"])["question"]["imageUrl"]
    assert fresh
    again = httpx.get(fresh, timeout=HTTP_TIMEOUT_S)
    assert again.status_code == 200 and again.content == PNG


def test_room_open_snapshot(app_url):
    h = Host(app_url)
    title = f"Deck {slug('snap')}"
    deck_id, (q1, q2) = h.deck(title=title, questions=[mc(), est()])
    room = h.room(deck_id)
    assert room["state"] == "lobby" and re.fullmatch(r"\d{6}", room["pin"])
    assert room["questionIndex"] is None and room["question"] is None and room["reveal"] is None
    assert (room["questionCount"], room["deckTitle"], room["seated"], room["players"]) == (2, title, 0, [])
    assert h.room(deck_id)["pin"] != room["pin"]
    r = h.c.put(f"/api/decks/{deck_id}/questions/{q1['id']}",
                json={**typed(app_url, mc(prompt="Edited after opening?", options=("Ag", "Au"), correct=1)), "version": 1})
    assert r.status_code == 200
    assert h.c.delete(f"/api/decks/{deck_id}/questions/{q2['id']}").status_code == 204
    opened = h.go(room["id"], "open_question")
    assert opened["question"]["prompt"] == SEED_MC_PROMPT and opened["question"]["options"] == list(SEED_MC_OPTIONS)
    assert opened["questionCount"] == 2
    assert h.go(room["id"], "lock", "reveal")["reveal"]["correctIndex"] == 0
    second = h.go(room["id"], "show_leaderboard", "open_question")
    assert second["questionIndex"] == 2 and second["question"]["prompt"] == SEED_EST_PROMPT
    empty_id, _ = h.deck()
    r = h.c.post("/api/rooms", json={"deckId": empty_id})
    assert r.status_code == 422 and r.json() == {"error": "validation_failed", "fields": {"deckId": "Deck has no questions"}}


def test_live_pins_unique(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    rooms = [h.room(deck_id) for _ in range(25)]
    pins = [r["pin"] for r in rooms]
    assert all(re.fullmatch(r"\d{6}", p) for p in pins)
    assert len(set(pins)) == len(pins)
    ended = rooms[0]
    assert join(app_url, ended["pin"], nick("Live")).status_code == 201
    h.go(ended["id"], *FULL_NIGHT)
    r = join(app_url, ended["pin"], nick("After"))
    assert r.status_code == 404 and r.json()["error"] == "room_not_found"


def test_join_room(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    pin, rid = room["pin"], room["id"]
    name = nick("J")
    r = join(app_url, pin, name)
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body) >= {"roomId", "seatId", "nickname", "rejoinToken", "clientId"}
    assert body["roomId"] == rid and body["nickname"] == name
    uuid.UUID(body["seatId"])
    assert len(body["rejoinToken"]) >= TOKEN_MIN and len(body["clientId"]) >= TOKEN_MIN
    assert body["rejoinToken"] != body["clientId"]
    players = h.get_room(rid)["players"]
    assert [(p["seatId"], p["nickname"]) for p in players] == [(body["seatId"], name)]
    for bad_pin in ("12345", "1234567", "12a456"):
        r = join(app_url, bad_pin, nick("F"))
        assert r.status_code == 422 and r.json()["error"] == "validation_failed", bad_pin
    for bad_nick in ("", "   ", "n" * (NICK_MAX + 1), "bad\u0007nick"):
        r = join(app_url, pin, bad_nick)
        assert r.status_code == 422 and r.json()["error"] == "validation_failed", repr(bad_nick)
    r = join(app_url, f"{(int(pin) + 500000) % 1000000:06d}", nick("U"))
    assert r.status_code == 404 and r.json()["error"] == "room_not_found"
    assert join(app_url, pin, "  " + "w" * NICK_MAX + "  ").status_code == 201
    h.go(rid, "open_question")
    late = seat(app_url, pin)
    assert answer(app_url, rid, late["clientId"], 1, choice=0).status_code == 201
    for command in ("lock", "reveal", "show_leaderboard"):
        h.go(rid, command)
        assert join(app_url, pin, nick("L")).status_code == 201, command
    h.go(rid, "show_podium")
    r = join(app_url, pin, nick("Pod"))
    assert r.status_code == 409 and r.json()["error"] == "room_closed"

    full = h.room(deck_id)
    with cf.ThreadPoolExecutor(POOL) as ex:
        codes = list(ex.map(lambda i: join(app_url, full["pin"], f"Seat {i:03d}").status_code, range(SEATS_MAX)))
    assert codes.count(201) == SEATS_MAX
    r = join(app_url, full["pin"], "One too many")
    assert r.status_code == 409 and r.json()["error"] == "room_full"
    assert h.get_room(full["id"])["seated"] == SEATS_MAX


def test_wf_room_opening_nickname_race(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    assert join(app_url, room["pin"], "Pint Sized").status_code == 201
    for clash in ("PINT SIZED", " pint sized "):
        r = join(app_url, room["pin"], clash)
        assert r.status_code == 409 and r.json()["error"] == "nickname_taken", clash
    variants = ["Quizzly Bears", "quizzly bears", "QUIZZLY BEARS", "Quizzly bears",
                "quizzly Bears", "QUIZZLY bears", "Quizzly BEARS", "qUIZZLY bEARS"][:RACERS]
    results = race([lambda v=v: join(app_url, room["pin"], v) for v in variants])
    assert [r.status_code for r in results].count(201) == 1
    assert all(r.json()["error"] == "nickname_taken" for r in results if r.status_code != 201)
    players = h.get_room(room["id"])["players"]
    assert sum(p["nickname"].lower() == "Quizzly Bears".lower() for p in players) == 1
    assert len(players) == 2


def test_wf_room_opening_lobby(app_url, browser, valkey):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    rid, pin = room["id"], room["pin"]
    n1, n2 = nick("Lob"), nick("Lob")
    with contextlib.ExitStack() as stack:
        st = stack.enter_context(signed_in(browser, h, f"/stage/{rid}"))
        details = st.get_by_role("region", name="Join details")
        expect(details).to_contain_text(pin)
        origin = st.evaluate("location.origin")
        expect(details).to_contain_text(f"Join at {origin}")
        p1, s1 = stack.enter_context(phone(browser, app_url, pin, n1, skew_s=SKEW_S))
        second = contextlib.ExitStack()
        p2, s2 = second.enter_context(phone(browser, app_url, pin, n2, skew_s=-SKEW_S))
        players = st.get_by_role("list", name="Players")
        expect(players.get_by_role("listitem").filter(has_text=n1)).to_have_count(1)
        expect(players.get_by_role("listitem").filter(has_text=n2)).to_have_count(1)
        expect(details).to_contain_text("2 of 2 phones connected")
        for page, name in ((p1, n1), (p2, n2)):
            expect(page.get_by_role("status", name="Answer status")).to_contain_text(
                f"You're in, {name}. Watch the big screen.")
        wait_members(valkey, rid, lambda m: len(m) == 3, "stage and both phone clients")
        second.close()
        expect(details).to_contain_text("1 of 2 phones connected", timeout=(PRESENCE_S + SLACK_S) * 1000)
        wait_members(valkey, rid, lambda m: len(m) == 2, "the closed phone leaving")
        hr = h.get_room(rid)
        assert hr["seated"] == 2
        assert {p["seatId"]: p["connected"] for p in hr["players"]} == {s1["seatId"]: True, s2["seatId"]: False}


def test_room_state_machine(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(), mc()])
    rid = h.room(deck_id)["id"]

    def refuse_all(state: str, allowed: set[str]) -> None:
        for command in FULL_NIGHT:
            if command in allowed:
                continue
            before = h.get_room(rid)
            r = h.cmd(rid, command)
            assert r.status_code == 409, (state, command, r.text)
            assert (r.json()["error"], r.json()["state"], r.json()["command"]) == ("illegal_transition", state, command)
            after = h.get_room(rid)
            assert (after["state"], after["questionIndex"], after["lastEventId"]) == (
                before["state"], before["questionIndex"], before["lastEventId"])

    refuse_all("lobby", {"open_question"})
    h.go(rid, "open_question")
    refuse_all("question_open", {"lock"})
    h.go(rid, "lock")
    refuse_all("locked", {"reveal"})
    h.go(rid, "reveal")
    refuse_all("reveal", {"show_leaderboard"})
    h.go(rid, "show_leaderboard")
    refuse_all("leaderboard", {"open_question", "show_podium"})
    second = h.go(rid, "open_question")
    assert (second["state"], second["questionIndex"]) == ("question_open", 2)
    h.go(rid, "lock", "reveal", "show_leaderboard")
    before = h.get_room(rid)
    r = h.cmd(rid, "open_question")
    assert r.status_code == 409 and r.json()["error"] == "no_more_questions"
    assert h.get_room(rid)["lastEventId"] == before["lastEventId"]
    h.go(rid, "show_podium")
    refuse_all("podium", {"end"})
    h.go(rid, "end")
    refuse_all("ended", set())
    r = h.cmd(rid, "rewind")
    assert r.status_code == 422
    early = h.room(deck_id)["id"]
    h.go(early, "open_question", "lock", "reveal", "show_leaderboard")
    assert h.go(early, "show_podium")["state"] == "podium"


def test_wf_run_the_night_command_race(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    rid = h.room(deck_id)["id"]
    s = seat(app_url, h.get_room(rid)["pin"])
    for command, state in (("open_question", "question_open"), ("lock", "locked")):
        before = h.get_room(rid)["lastEventId"]
        results = race([lambda c=command: httpx.post(f"{app_url}/api/rooms/{rid}/commands", json={"command": c},
                                                     cookies=h.cookies, timeout=HTTP_TIMEOUT_S)] * RACERS)
        codes = [r.status_code for r in results]
        assert codes.count(200) == 1, codes
        assert all(r.json()["error"] == "illegal_transition" for r in results if r.status_code != 200)
        room = h.get_room(rid)
        assert room["state"] == state and room["questionIndex"] == 1
        evs = events_until(app_url, rid, {"clientId": s["clientId"]}, after=before, target=room["lastEventId"])
        assert [e["type"] for e in evs].count(state) == 1


def test_wf_run_the_night_autolock(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    rid = room["id"]
    s = seat(app_url, room["pin"])
    started = time.monotonic()
    opened = h.go(rid, "open_question")
    q = opened["question"]
    assert q["deadlineAt"] - q["opensAt"] == SHORT_LIMIT_S * 1000 and q["timeLimitMs"] == SHORT_LIMIT_S * 1000
    evs = events_until(app_url, rid, {"clientId": s["clientId"]}, after=opened["lastEventId"],
                       want=lambda e: e["type"] == "locked", seconds=SHORT_LIMIT_S + LOCK_GRACE_S + SLACK_S * 3)
    locked = next(e for e in evs if e["type"] == "locked")
    assert locked["data"] == {"questionIndex": 1, "reason": "deadline"}
    assert server_now(app_url) >= q["deadlineAt"]
    assert time.monotonic() - started <= SHORT_LIMIT_S + LOCK_GRACE_S + SLACK_S
    assert h.get_room(rid)["state"] == "locked"
    with signed_in(browser, h, f"/stage/{rid}") as st:
        expect(st.get_by_role("region", name="Question")).to_contain_text("Question 1 of 1")
        expect(st.get_by_role("button", name="Reveal")).to_be_enabled()
        expect(st.get_by_role("button", name="Lock")).to_be_disabled()
        st.keyboard.press("r")
        expect(st.get_by_role("status", name="Stage status")).to_contain_text("Revealed")
    assert h.get_room(rid)["state"] == "reveal"


def test_stage_shortcuts(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), mc(t=LONG_LIMIT_S)])
    rid = h.room(deck_id)["id"]
    with signed_in(browser, h, f"/stage/{rid}") as st:
        status = st.get_by_role("status", name="Stage status")
        buttons = {label: st.get_by_role("button", name=label, exact=True) for label in SHORTCUTS}
        for label, key in SHORTCUTS.items():
            expect(buttons[label]).to_have_attribute("aria-keyshortcuts", re.compile(key, re.I))
        expect(buttons["Open question"]).to_be_enabled()
        for label in ("Lock", "Reveal", "Leaderboard", "Podium", "End night"):
            expect(buttons[label]).to_be_disabled()
        buttons["Open question"].focus()
        st.keyboard.press("o")
        expect(status).to_contain_text(stage_open_copy(1))
        assert h.get_room(rid)["state"] == "question_open"
        last = h.get_room(rid)["lastEventId"]
        st.evaluate("document.activeElement && document.activeElement.blur()")
        for combo in ("Control+l", "Alt+l", "Meta+l", "b", "p"):
            st.keyboard.press(combo)
        deadline = time.monotonic() + 25
        seen: list[str] = []
        while time.monotonic() < deadline:
            r = httpx.get(f"{app_url}/api/rooms/{rid}/poll", params={"after": last, "role": "stage"},
                          cookies=h.cookies, timeout=HTTP_TIMEOUT_S)
            for e in r.json()["events"]:
                seen.append(e["type"])
                last = max(last, e["id"])
        assert not {"locked", "leaderboard", "podium"} & set(seen), seen
        assert h.get_room(rid)["state"] == "question_open"
        st.keyboard.press("l")
        expect(status).to_contain_text("Locked")
        buttons["Reveal"].focus()
        st.keyboard.press("r")
        expect(status).to_contain_text("Revealed")
        buttons["Leaderboard"].focus()
        st.keyboard.press("b")
        expect(status).to_contain_text("Leaderboard")
        buttons["Podium"].focus()
        st.keyboard.press("p")
        expect(status).to_contain_text("Podium")
        assert h.get_room(rid)["state"] == "podium"
        st.keyboard.press("e")
        expect(st.get_by_role("dialog", name="End the night?")).to_be_visible()


def test_end_night_dialog(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    rid = h.room(deck_id)["id"]
    h.go(rid, "open_question", "lock", "reveal", "show_leaderboard", "show_podium")
    with signed_in(browser, h, f"/stage/{rid}") as st:
        opener = st.get_by_role("button", name="End night", exact=True)
        expect(opener).to_be_enabled()
        opener.focus()
        st.keyboard.press("e")
        dialog = st.get_by_role("dialog", name="End the night?")
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text("Everyone's seat closes and the night moves to Past nights.")
        keep, end = dialog.get_by_role("button", name="Keep going"), dialog.get_by_role("button", name="End night")
        expect(keep).to_be_focused()
        st.keyboard.press("Tab")
        expect(end).to_be_focused()
        st.keyboard.press("Tab")
        expect(keep).to_be_focused()
        st.keyboard.press("Shift+Tab")
        expect(end).to_be_focused()
        st.keyboard.press("Escape")
        expect(dialog).not_to_be_visible()
        expect(st.get_by_role("button", name="End night", exact=True)).to_be_focused()
        assert h.get_room(rid)["state"] == "podium"
        st.keyboard.press("e")
        expect(dialog).to_be_visible()
        keep.click()
        expect(dialog).not_to_be_visible()
        assert h.get_room(rid)["state"] == "podium"
        st.keyboard.press("e")
        expect(keep).to_be_focused()
        st.keyboard.press("Shift+Tab")
        st.keyboard.press("Enter")
        expect(st.get_by_role("status", name="Stage status")).to_contain_text("Night ended")
    assert h.get_room(rid)["state"] == "ended"


def test_wf_run_the_night_keyboard(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), mc(t=LONG_LIMIT_S, options=SEED_GOLD_OPTIONS, correct=1,
                                                          prompt=SEED_GOLD_PROMPT)])
    room = h.room(deck_id)
    rid = room["id"]
    name = nick("Key")
    with signed_in(browser, h, f"/stage/{rid}") as st, phone(browser, app_url, room["pin"], name) as (p, s):
        status = st.get_by_role("status", name="Stage status")
        p_status = p.get_by_role("status", name="Answer status")
        expect(st.get_by_role("list", name="Players")).to_contain_text(name)
        for index, tile in ((1, "A: Jupiter"), (2, "B: Au")):
            st.keyboard.press("o")
            expect(status).to_contain_text(f"Question {index} open")
            expect(st.get_by_role("region", name="Question")).to_contain_text(f"Question {index} of 2")
            expect(p.get_by_role("region", name="Question echo")).to_contain_text(f"Question {index} of 2")
            expect(p.get_by_role("timer", name="Time left")).to_be_visible()
            tap(p.get_by_role("button", name=tile))
            expect(p_status).to_contain_text("Locked in")
            expect(st.get_by_role("region", name="Question")).to_contain_text("1 of 1 answered")
            st.keyboard.press("l")
            expect(status).to_contain_text("Locked")
            expect(p_status).to_contain_text("Time's up")
            st.keyboard.press("r")
            expect(status).to_contain_text("Revealed")
            expect(st.get_by_role("list", name="Answer split")).to_be_visible()
            st.keyboard.press("b")
            expect(st.get_by_role("list", name="Leaderboard")).to_contain_text(name)
        st.keyboard.press("p")
        expect(st.get_by_role("list", name="Podium")).to_contain_text(name, timeout=UI_MS)
        st.keyboard.press("e")
        dialog = st.get_by_role("dialog", name="End the night?")
        expect(dialog.get_by_role("button", name="Keep going")).to_be_focused()
        st.keyboard.press("Tab")
        expect(dialog.get_by_role("button", name="End night")).to_be_focused()
        st.keyboard.press("Enter")
        expect(status).to_contain_text("Night ended")
        expect(p_status).to_contain_text("The night is over. Thanks for playing.")
    night = next(n for n in h.c.get("/api/nights").json()["nights"] if n["roomId"] == rid)
    assert night["seated"] == 1 and night["podium"][0]["nickname"] == name
    rows = Postgres().rows(f"SELECT question_index, points FROM answers WHERE room_id::text = '{rid}' "
                           f"AND seat_id::text = '{s['seatId']}' ORDER BY question_index")
    assert [r["question_index"] for r in rows] == [1, 2] and all(r["points"] > 0 for r in rows)


def test_wf_answering_window(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(), mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    a, b, c = (seat(app_url, room["pin"]) for _ in range(3))
    opened = h.go(rid, "open_question")
    r = answer(app_url, rid, a["clientId"], 1, choice=0)
    assert r.status_code == 201, r.text
    ans = r.json()["answer"]
    assert ans["questionIndex"] == 1 and ans["latencyMs"] >= 0 and ans["remainingMs"] > 0
    assert abs(ans["latencyMs"] + ans["remainingMs"] - SHORT_LIMIT_S * 1000) <= 1
    r = answer(app_url, rid, b["clientId"], 2, choice=0)
    assert r.status_code == 409 and r.json()["error"] == "question_not_open" and r.json()["state"] == "question_open"
    for bad in ({"choice": 4}, {"estimate": EST_ANSWER}, {"choice": 0, "estimate": EST_ANSWER}, {}):
        r = answer(app_url, rid, b["clientId"], 1, **bad)
        assert r.status_code == 422, (bad, r.text)
    events_until(app_url, rid, {"clientId": c["clientId"]}, after=opened["lastEventId"],
                 want=lambda e: e["type"] == "locked", seconds=SHORT_LIMIT_S + LOCK_GRACE_S + SLACK_S * 3)
    r = answer(app_url, rid, c["clientId"], 1, choice=0)
    assert r.status_code == 409 and r.json()["error"] == "window_closed"
    assert isinstance(r.json()["remainingMs"], int) and r.json()["remainingMs"] < 0
    h.go(rid, "reveal", "show_leaderboard", "open_question", "lock")
    r = answer(app_url, rid, c["clientId"], 2, choice=0)
    assert r.status_code == 409 and r.json()["error"] == "window_closed" and r.json()["remainingMs"] >= 0
    r = answer(app_url, rid, b["clientId"], 1, choice=0)
    assert r.status_code == 409 and r.json()["error"] == "question_not_open"
    rows = Postgres().rows(f"SELECT seat_id::text AS seat_id FROM answers WHERE room_id::text = '{rid}'")
    assert [row["seat_id"] for row in rows] == [a["seatId"]]


def test_wf_answering_double(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    a, b = seat(app_url, room["pin"]), seat(app_url, room["pin"])
    opened = h.go(rid, "open_question")
    results = race([lambda i=i: answer(app_url, rid, a["clientId"], 1, choice=i % 4) for i in range(RACERS)])
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1, codes
    assert all(r.json()["error"] == "already_answered" for r in results if r.status_code != 201)
    r = answer(app_url, rid, a["clientId"], 1, choice=0)
    assert r.status_code == 409 and r.json()["error"] == "already_answered"
    rows = Postgres().rows(f"SELECT count(*)::int AS n FROM answers WHERE room_id::text = '{rid}' "
                           f"AND seat_id::text = '{a['seatId']}' AND question_index = 1")
    assert rows[0]["n"] == 1
    assert h.get_room(rid)["answered"] == 1
    evs = events_until(app_url, rid, {"clientId": b["clientId"]}, after=opened["lastEventId"],
                       target=h.get_room(rid)["lastEventId"])
    counts = [e for e in evs if e["type"] == "answer_count"]
    assert len(counts) == 1 and counts[0]["data"]["answered"] == 1
    assert answer(app_url, rid, b["clientId"], 1, choice=1).status_code == 201
    assert h.get_room(rid)["answered"] == 2


def test_answers_stored(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    right, wrong = seat(app_url, room["pin"]), seat(app_url, room["pin"])
    h.go(rid, "open_question")
    latency = {right["seatId"]: answer(app_url, rid, right["clientId"], 1, choice=0).json()["answer"]["latencyMs"],
               wrong["seatId"]: answer(app_url, rid, wrong["clientId"], 1, choice=2).json()["answer"]["latencyMs"]}
    sql = (f"SELECT seat_id::text AS seat_id, question_index, latency_ms, points, received_at IS NOT NULL AS has_time "
           f"FROM answers WHERE room_id::text = '{rid}'")
    rows = {r["seat_id"]: r for r in Postgres().rows(sql)}
    assert set(rows) == set(latency)
    for sid, row in rows.items():
        assert (row["question_index"], row["latency_ms"], row["points"], row["has_time"]) == (1, latency[sid], None, True)
    h.go(rid, "lock")
    assert all(r["points"] is None for r in Postgres().rows(sql))
    reveal = h.go(rid, "reveal")["reveal"]
    awarded = results_by_seat(reveal)
    rows = {r["seat_id"]: r for r in Postgres().rows(sql)}
    for sid, row in rows.items():
        assert row["points"] == awarded[sid]["points"]
    assert rows[right["seatId"]]["points"] > 0 and rows[wrong["seatId"]]["points"] == 0


def test_wf_answering_clock_skew(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    with signed_in(browser, h, f"/stage/{rid}", skew_s=SKEW_S) as st, \
            phone(browser, app_url, room["pin"], nick("Skew"), skew_s=-SKEW_S) as (p, s):
        deadline = h.go(rid, "open_question")["question"]["deadlineAt"]
        for page in (p, st):
            timer = page.get_by_role("timer", name="Time left")
            expect(timer).to_be_visible()
            page.clock.run_for(UI_STEP_MS)
            before = server_now(app_url)
            shown = shown_seconds(timer)
            after = server_now(app_url)
            low = math.ceil((deadline - after) / 1000) - 1
            high = math.ceil((deadline - before) / 1000) + 1
            assert low <= shown <= high, (shown, low, high)
        p.clock.set_system_time(datetime.now(timezone.utc) + timedelta(seconds=SKEW_S + LONG_LIMIT_S))
        p.clock.run_for(1000)
        tile = p.get_by_role("button", name="A: Jupiter")
        expect(tile).to_be_enabled()
        expect(p.get_by_role("status", name="Answer status")).not_to_contain_text("Time's up")
        assert h.get_room(rid)["state"] == "question_open"
        h.go(rid, "lock")
        expect(p.get_by_role("status", name="Answer status")).to_contain_text("Time's up")


def test_wf_player_controller_projection(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), est(t=LONG_LIMIT_S), seq(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    s = seat(app_url, room["pin"])
    names = {v: k for k, v in type_names(app_url).items()}
    last = 0
    for index, kind in ((1, "mc"), (2, "est"), (3, "seq")):
        command = "open_question"
        hosted = h.go(rid, command)
        for phase in ("open", "locked"):
            pv = view(app_url, rid, s["clientId"]).json()
            assert set(pv) == VIEW_KEYS and set(pv["you"]) == YOU_KEYS and pv["reveal"] is None
            assert all(set(x) == STANDING_KEYS for x in pv["standings"])
            for q in (pv["question"], hosted["question"]):
                assert names[q["type"]] == kind and q["index"] == index
                assert set(q) == PQ_BASE | PQ_EXTRA[kind], set(q)
            assert not SECRET_KEYS & all_keys(pv) and not SECRET_KEYS & all_keys(hosted)
            if phase == "open":
                hosted = h.go(rid, "lock")
        evs = events_until(app_url, rid, {"clientId": s["clientId"]}, after=last, target=hosted["lastEventId"])
        last = hosted["lastEventId"]
        opened = [e for e in evs if e["type"] == "question_open"]
        assert len(opened) == 1 and set(opened[0]["data"]) == PQ_BASE | PQ_EXTRA[kind]
        if kind == "seq":
            items = opened[0]["data"]["items"]
            assert all(set(i) == {"id", "label"} for i in items)
            assert sorted(i["label"] for i in items) == sorted(SEED_SEQ)
            ids = [i["id"] for i in items]
            assert len(set(ids)) == len(ids)
            assert not set(ids) & {str(n) for n in range(len(ids) + 1)}
            assert all(i["label"].lower() not in i["id"].lower() for i in items)
        h.go(rid, "reveal", "show_leaderboard")


def test_wf_player_controller_thumb_zone(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), est(t=LONG_LIMIT_S), seq(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    line = PHONE_H * THUMB_LINE
    with phone(browser, app_url, room["pin"], nick("Thumb")) as (p, s):
        def in_zone(loc) -> None:
            expect(loc).to_be_visible()
            box = loc.bounding_box()
            assert box["y"] >= line - 0.5 and box["y"] + box["height"] <= PHONE_H + 0.5, box
            assert box["x"] >= -0.5 and box["x"] + box["width"] <= PHONE_W + 0.5, box
            assert box["width"] >= PHONE_TOUCH_PX - 0.5 and box["height"] >= PHONE_TOUCH_PX - 0.5, box

        def above(loc) -> None:
            box = loc.bounding_box()
            assert box["y"] + box["height"] <= line + 0.5, box

        h.go(rid, "open_question")
        for letter, option in zip("ABCD", SEED_MC_OPTIONS):
            in_zone(p.get_by_role("button", name=f"{letter}: {option}"))
        assert p.evaluate("window.scrollY") == 0
        above(p.get_by_role("region", name="Question echo"))
        above(p.get_by_role("timer", name="Time left"))
        above(p.get_by_role("region", name="Your standing"))
        h.go(rid, "lock", "reveal", "show_leaderboard", "open_question")
        in_zone(p.get_by_role("slider", name="Your estimate"))
        in_zone(p.get_by_role("button", name="Lock in estimate"))
        h.go(rid, "lock", "reveal", "show_leaderboard", "open_question")
        order = p.get_by_role("list", name="Your order")
        expect(order.get_by_role("listitem")).to_have_count(len(SEED_SEQ))
        for label in SEED_SEQ:
            item = order.get_by_role("listitem").filter(has_text=label)
            box = item.bounding_box()
            assert box["y"] >= line - 0.5 and box["y"] + box["height"] <= PHONE_H + 0.5, (label, box)
            in_zone(p.get_by_role("button", name=f"Move {label} up"))
            in_zone(p.get_by_role("button", name=f"Move {label} down"))
        in_zone(p.get_by_role("button", name="Lock in order"))
        assert p.evaluate("window.scrollY") == 0


def test_wf_player_controller_keyboard(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), est(t=LONG_LIMIT_S, step=2), seq(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    with phone(browser, app_url, room["pin"], nick("Kbd")) as (p, s), \
            phone(browser, app_url, room["pin"], nick("Tap")) as (t, s2):
        status = p.get_by_role("status", name="Answer status")
        h.go(rid, "open_question")
        tile = p.get_by_role("button", name="B: Mars")
        expect(tile).to_be_visible()
        tab_to(p, tile)
        p.keyboard.press("Enter")
        expect(status).to_contain_text("Locked in")
        tap(t.get_by_role("button", name="A: Jupiter"))
        expect(t.get_by_role("status", name="Answer status")).to_contain_text("Locked in")
        reveal = h.go(rid, "lock", "reveal")["reveal"]
        assert reveal["counts"] == [1, 1, 0, 0]
        h.go(rid, "show_leaderboard", "open_question")
        slider = p.get_by_role("slider", name="Your estimate")
        expect(slider).to_be_visible()
        value = "el => Number(el.value ?? el.getAttribute('aria-valuenow'))"
        tab_to(p, slider)
        p.keyboard.press("End")
        assert slider.evaluate(value) == EST_MAX
        p.keyboard.press("Home")
        assert slider.evaluate(value) == EST_MIN
        p.keyboard.press("ArrowRight")
        assert slider.evaluate(value) == EST_MIN + 2
        p.keyboard.press("PageUp")
        assert slider.evaluate(value) == EST_MIN + 2 + 20
        tab_to(p, p.get_by_role("button", name="Lock in estimate"))
        p.keyboard.press("Enter")
        expect(status).to_contain_text("Locked in")
        tap(t.get_by_role("button", name="Lock in estimate"))
        expect(t.get_by_role("status", name="Answer status")).to_contain_text("Locked in")
        reveal = h.go(rid, "lock", "reveal")["reveal"]
        assert reveal["bins"][2]["count"] >= 1 and sum(b["count"] for b in reveal["bins"]) == 2
        h.go(rid, "show_leaderboard", "open_question")
        order = p.get_by_role("list", name="Your order")
        expect(order.get_by_role("listitem")).to_have_count(len(SEED_SEQ))

        def current() -> list[str]:
            return [next(label for label in SEED_SEQ if label in text) for text in item_texts(order)]

        for target, label in enumerate(SEED_SEQ):
            moves = current().index(label) - target
            if moves <= 0:
                continue
            up = p.get_by_role("button", name=f"Move {label} up")
            tab_to(p, up)
            for _ in range(moves):
                p.keyboard.press("Enter")
            if target == 0:
                expect(p.get_by_role("button", name=f"Move {label} down")).to_be_focused()
            else:
                expect(up).to_be_focused()
            assert current().index(label) == target
        assert current() == list(SEED_SEQ)
        tab_to(p, p.get_by_role("button", name="Lock in order"))
        p.keyboard.press("Enter")
        expect(status).to_contain_text("Locked in")
        tap(t.get_by_role("button", name="Lock in order"))
        reveal = h.go(rid, "lock", "reveal")["reveal"]
        assert results_by_seat(reveal)[s["seatId"]]["outcome"] == "correct"


def test_phone_answer_feedback(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), mc(t=LONG_LIMIT_S), mc()])
    room = h.room(deck_id)
    rid = room["id"]
    name = nick("Fb")
    with phone(browser, app_url, room["pin"], name) as (p, s):
        status = p.get_by_role("status", name="Answer status")
        expect(status).to_contain_text(f"You're in, {name}. Watch the big screen.")
        with p.expect_response(lambda r: "/api/rooms/rejoin" in r.url) as rejoined:
            p.reload()
        live_client = rejoined.value.json()["clientId"]
        expect(status).to_contain_text(f"You're in, {name}. Watch the big screen.")
        h.go(rid, "open_question")
        expect(status).to_contain_text(question_open_copy(1))
        with ctx(held(p, "**/answers")) as hold:
            tap(p.get_by_role("button", name="A: Jupiter"))
            expect(status).to_contain_text("Sending…")
            hold.release()
        expect(status).to_contain_text("Locked in")
        for command, copy in (("lock", "Time's up"), ("reveal", "Answers are in"),
                              ("show_leaderboard", "Leaderboard is on the big screen"),
                              ("open_question", question_open_copy(2))):
            h.go(rid, command)
            expect(status).to_contain_text(copy)
        with ctx(held(p, "**/answers")) as hold:
            tap(p.get_by_role("button", name="B: Mars"))
            expect(status).to_contain_text("Sending…")
            assert answer(app_url, rid, live_client, 2, choice=0).status_code == 201
            hold.release()
        expect(status).to_contain_text("Already answered — your first answer stands.")
        opened = h.go(rid, "lock", "reveal", "show_leaderboard", "open_question")
        expect(status).to_contain_text(question_open_copy(3))
        with ctx(held(p, "**/answers")) as hold:
            with p.expect_response(lambda r: "/answers" in r.url,
                                   timeout=(SHORT_LIMIT_S + LOCK_GRACE_S + SLACK_S * 3 + WAIT_S) * 1000) as late_info:
                tap(p.get_by_role("button", name="A: Jupiter"))
                events_until(app_url, rid, {"role": "stage"}, cookies=h.cookies, after=opened["lastEventId"],
                             want=lambda e: e["type"] == "locked", seconds=SHORT_LIMIT_S + LOCK_GRACE_S + SLACK_S * 3)
                expect(status).to_contain_text("Time's up")
                hold.release()
        late = late_info.value.json()
        assert late["error"] == "window_closed" and late["remainingMs"] < 0
        expect(status).to_contain_text(f"Too late — the server got it {abs(late['remainingMs'])} ms after the bell.")
        assert rejoin(app_url, s["rejoinToken"]).status_code == 200
        expect(status).to_contain_text("This seat is now open on another screen.")


def test_wf_scoring_decay(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    rid = room["id"]
    window = SHORT_LIMIT_S * 1000
    seats = [seat(app_url, room["pin"]) for _ in range(3)]
    opens = h.go(rid, "open_question")["question"]["opensAt"]
    latency = {}
    for s, fraction in zip(seats, (0, 0.5, 0.8)):
        wait_server_time(app_url, opens + int(window * fraction))
        r = answer(app_url, rid, s["clientId"], 1, choice=0)
        assert r.status_code == 201, r.text
        latency[s["seatId"]] = r.json()["answer"]["latencyMs"]
    reveal = h.go(rid, "lock", "reveal")["reveal"]
    got = results_by_seat(reveal)
    points = []
    for s in seats:
        res = got[s["seatId"]]
        expected = correct_points(latency[s["seatId"]], window, 1)
        assert (res["outcome"], res["points"], res["streak"]) == ("correct", expected, 1)
        assert isinstance(res["points"], int) and DECAY_POINTS <= res["points"] <= MAX_POINTS
        points.append(res["points"])
    assert points[0] > points[1] > points[2]
    standings = {x["seatId"]: x["score"] for x in h.get_room(rid)["standings"]}
    assert all(standings[s["seatId"]] == got[s["seatId"]]["points"] for s in seats)


def test_streak_multiplier(app_url):
    h = Host(app_url)
    plan = ["c"] * 7 + ["w", "c", "n"]
    deck_id, _ = h.deck(questions=[mc() for _ in plan])
    room = h.room(deck_id)
    rid = room["id"]
    s = seat(app_url, room["pin"])
    window, streak, total = SHORT_LIMIT_S * 1000, 0, 0
    for index, step in enumerate(plan, start=1):
        h.go(rid, "open_question")
        latency = None
        if step != "n":
            r = answer(app_url, rid, s["clientId"], index, choice=0 if step == "c" else 1)
            assert r.status_code == 201, r.text
            latency = r.json()["answer"]["latencyMs"]
        res = results_by_seat(h.go(rid, "lock", "reveal")["reveal"])[s["seatId"]]
        if step == "c":
            streak += 1
            expected = correct_points(latency, window, streak)
            assert (res["outcome"], res["points"], res["streak"]) == ("correct", expected, streak), index
            if streak >= 6:
                assert res["points"] == base_points(latency, window) * 15 // 10
        else:
            streak = 0
            outcome = "wrong" if step == "w" else "none"
            assert (res["outcome"], res["points"], res["streak"]) == (outcome, 0, 0), index
        total += res["points"]
        mine = next(x for x in h.get_room(rid)["standings"] if x["seatId"] == s["seatId"])
        assert (mine["score"], mine["streak"]) == (total, streak)
        if index < len(plan):
            h.go(rid, "show_leaderboard")


def test_sequence_partial_credit(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[seq()])
    room = h.room(deck_id)
    rid = room["id"]
    window, n = SHORT_LIMIT_S * 1000, len(SEED_SEQ)
    full, three, rev, none = (seat(app_url, room["pin"]) for _ in range(4))
    q = h.go(rid, "open_question")["question"]
    plans = {full["seatId"]: list(SEED_SEQ),
             three["seatId"]: [SEED_SEQ[0], SEED_SEQ[1], SEED_SEQ[3], SEED_SEQ[2]],
             rev["seatId"]: list(reversed(SEED_SEQ))}
    latency = {}
    for s in (full, three, rev):
        r = answer(app_url, rid, s["clientId"], 1, order=order_ids(q, plans[s["seatId"]]))
        assert r.status_code == 201, r.text
        latency[s["seatId"]] = r.json()["answer"]["latencyMs"]
    r = answer(app_url, rid, none["clientId"], 1, order=order_ids(q, SEED_SEQ[:3]))
    assert r.status_code == 422
    got = results_by_seat(h.go(rid, "lock", "reveal")["reveal"])
    res = got[full["seatId"]]
    assert (res["outcome"], res["points"], res["streak"]) == ("correct", base_points(latency[full["seatId"]], window), 1)
    for s in (three, rev):
        k = lis([SEED_SEQ.index(label) for label in plans[s["seatId"]]])
        assert k == (3 if s is three else 1)
        res = got[s["seatId"]]
        assert (res["outcome"], res["points"], res["streak"]) == (
            "partial", base_points(latency[s["seatId"]], window) * k // n, 0)
    assert (got[none["seatId"]]["outcome"], got[none["seatId"]]["points"]) == ("none", 0)


def test_estimate_tolerance(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[est()])
    room = h.room(deck_id)
    rid = room["id"]
    values = (EST_ANSWER - EST_TOL, EST_ANSWER + EST_TOL, EST_ANSWER - EST_TOL - 1, EST_ANSWER + EST_TOL + 1)
    seats = [seat(app_url, room["pin"]) for _ in values]
    h.go(rid, "open_question")
    for s, v in zip(seats, values):
        assert answer(app_url, rid, s["clientId"], 1, estimate=v).status_code == 201
    r = answer(app_url, rid, seat(app_url, room["pin"])["clientId"], 1, estimate=EST_MAX + 1)
    assert r.status_code == 422
    got = results_by_seat(h.go(rid, "lock", "reveal")["reveal"])
    for s, v in zip(seats, values):
        res = got[s["seatId"]]
        if abs(v - EST_ANSWER) <= EST_TOL:
            assert res["outcome"] == "correct" and res["points"] >= DECAY_POINTS and res["streak"] == 1, v
        else:
            assert (res["outcome"], res["points"], res["streak"]) == ("wrong", 0, 0), v


def test_wf_scoring_ranking(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    rid = room["id"]
    window = SHORT_LIMIT_S * 1000
    joined = [seat(app_url, room["pin"], nick(f"R{i}")) for i in range(5)]
    h.go(rid, "open_question")
    cum = {s["seatId"]: window for s in joined}
    for s, choice in ((joined[0], 0), (joined[3], 1), (joined[1], 2)):
        r = answer(app_url, rid, s["clientId"], 1, choice=choice)
        assert r.status_code == 201
        cum[s["seatId"]] = r.json()["answer"]["latencyMs"]
    late = seat(app_url, room["pin"], nick("Late"))
    joined.append(late)
    cum[late["seatId"]] = 0
    reveal = h.go(rid, "lock", "reveal")["reveal"]
    score = {r["seatId"]: r["points"] for r in reveal["results"]}
    expected = sorted((s["seatId"] for s in joined),
                      key=lambda sid: (-score[sid], cum[sid], [x["seatId"] for x in joined].index(sid)))
    standings = h.get_room(rid)["standings"]
    assert all(set(x) == STANDING_KEYS for x in standings)
    assert [x["seatId"] for x in standings] == expected
    assert [x["rank"] for x in standings] == list(range(1, len(joined) + 1))
    rows = Postgres().rows(f"SELECT seat_id::text AS seat_id, rank, cumulative_ms, score FROM standings "
                           f"WHERE room_id::text = '{rid}'")
    by = {r["seat_id"]: r for r in rows}
    for rank, sid in enumerate(expected, start=1):
        assert (by[sid]["rank"], by[sid]["cumulative_ms"], by[sid]["score"]) == (rank, cum[sid], score[sid])


def test_wf_scoring_reconcile(app_url, valkey):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(), mc()])
    room = h.room(deck_id)
    rid = room["id"]
    seats = [seat(app_url, room["pin"]) for _ in range(6)]
    for index in (1, 2):
        h.go(rid, "open_question")
        results = race([lambda s=s, i=i: answer(app_url, rid, s["clientId"], index, choice=0 if i % 2 == 0 else 1)
                        for i, s in enumerate(seats)])
        assert all(r.status_code == 201 for r in results)
        h.go(rid, "lock", "reveal")
        api = {x["seatId"]: x["score"] for x in h.get_room(rid)["standings"]}
        pg = {r["seat_id"]: r["score"] for r in Postgres().rows(
            f"SELECT seat_id::text AS seat_id, score FROM standings WHERE room_id::text = '{rid}'")}
        assert set(api) == set(pg) == {s["seatId"] for s in seats}
        for sid in api:
            assert api[sid] == pg[sid] == zscore(valkey, rid, sid), sid
        assert any(v > 0 for v in api.values())
        h.go(rid, "show_leaderboard")


def test_leaderboard_on_screen(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    with signed_in(browser, h, f"/stage/{rid}") as st, phone(browser, app_url, room["pin"], nick("Me")) as (p, s):
        strip = p.get_by_role("region", name="Your standing")
        others = [seat(app_url, room["pin"]) for _ in range(11)]
        expect(strip).to_contain_text(re.compile(r"Rank \d+ of 12 · 0 pts"))
        h.go(rid, "open_question")
        tap(p.get_by_role("button", name="A: Jupiter"))
        expect(p.get_by_role("status", name="Answer status")).to_contain_text("Locked in")
        for i, o in enumerate(others):
            answer(app_url, rid, o["clientId"], 1, choice=0 if i % 3 else 1)
        h.go(rid, "lock", "reveal")
        standings = h.get_room(rid)["standings"]
        mine = next(x for x in standings if x["seatId"] == s["seatId"])
        expect(strip).to_contain_text(f"Rank {mine['rank']} of 12 · {mine['score']} pts")
        h.go(rid, "show_leaderboard")
        board = st.get_by_role("list", name="Leaderboard")
        expect(board.get_by_role("listitem")).to_have_count(LEADERBOARD_TOP)
        texts = item_texts(board)
        for text, x in zip(texts, standings[:LEADERBOARD_TOP]):
            assert f"{x['rank']}. {x['nickname']} — {x['score']}" in text, (text, x)


def test_wf_reveal_numbers(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), est(t=LONG_LIMIT_S), seq(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    seats = [seat(app_url, room["pin"]) for _ in range(5)]

    def reveal_everywhere(after: int) -> dict:
        resp = h.go(rid, "lock", "reveal")
        copies = [resp["reveal"]]
        for params, cookies in (({"clientId": seats[0]["clientId"]}, None), ({"clientId": seats[1]["clientId"]}, None),
                                ({"role": "stage"}, h.cookies)):
            evs = events_until(app_url, rid, params, cookies=cookies, after=after, target=resp["lastEventId"])
            copies += [e["data"] for e in evs if e["type"] == "reveal"]
        assert len(copies) == 4 and all(c == copies[0] for c in copies)
        assert all(set(r) == RESULT_KEYS for r in copies[0]["results"])
        assert {r["seatId"] for r in copies[0]["results"]} == {s["seatId"] for s in seats}
        assert (copies[0]["answered"], copies[0]["seated"]) == (4, 5) or copies[0]["answered"] <= 5
        return copies[0]

    last = h.go(rid, "open_question")["lastEventId"]
    for s, choice in zip(seats, (0, 0, 1, 3)):
        assert answer(app_url, rid, s["clientId"], 1, choice=choice).status_code == 201
    rv = reveal_everywhere(last)
    assert set(rv) == REVEAL_BASE | REVEAL_EXTRA["mc"]
    assert (rv["counts"], rv["correctIndex"], rv["answered"], rv["seated"]) == ([2, 1, 0, 1], 0, 4, 5)

    last = h.go(rid, "show_leaderboard", "open_question")["lastEventId"]
    for s, v in zip(seats, (EST_MIN, 90, EST_MAX, 85)):
        assert answer(app_url, rid, s["clientId"], 2, estimate=v).status_code == 201
    rv = reveal_everywhere(last)
    assert set(rv) == REVEAL_BASE | REVEAL_EXTRA["est"]
    width = (EST_MAX - EST_MIN) / BINS
    assert [(b["from"], b["to"]) for b in rv["bins"]] == [(EST_MIN + k * width, EST_MIN + (k + 1) * width) for k in range(BINS)]
    assert [b["count"] for b in rv["bins"]] == [1, 0, 0, 0, 1, 1, 0, 1]
    assert (rv["answer"], rv["tolerance"], sorted(rv["inBandBins"])) == (EST_ANSWER, EST_TOL, [4, 5])

    opened = h.go(rid, "show_leaderboard", "open_question")
    q = opened["question"]
    plans = (list(SEED_SEQ), [SEED_SEQ[0], SEED_SEQ[1], SEED_SEQ[3], SEED_SEQ[2]], list(reversed(SEED_SEQ)))
    for s, plan in zip(seats, plans):
        assert answer(app_url, rid, s["clientId"], 3, order=order_ids(q, plan)).status_code == 201
    rv = reveal_everywhere(opened["lastEventId"])
    assert set(rv) == REVEAL_BASE | REVEAL_EXTRA["seq"]
    assert rv["buckets"] == [2, 1, 0, 1, 1]
    assert rv["correctOrder"] == order_ids(q, SEED_SEQ)


def _locked_stage_room(h: Host, base: str, picks: list[int]) -> tuple[str, list[int]]:
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    seats = [seat(base, room["pin"]) for _ in picks]
    h.go(rid, "open_question")
    for s, choice in zip(seats, picks):
        assert answer(base, rid, s["clientId"], 1, choice=choice).status_code == 201
    h.go(rid, "lock")
    counts = [picks.count(i) for i in range(len(SEED_MC_OPTIONS))]
    return rid, counts


def test_wf_reveal_tally_pour(app_url, browser):
    h = Host(app_url)
    rid, counts = _locked_stage_room(h, app_url, [0, 0, 0, 1, 3, 3])
    with signed_in(browser, h, f"/stage/{rid}", live=False) as st:
        reveal_btn = st.get_by_role("button", name="Reveal")
        wait_ui(st, lambda: expect(reveal_btn).to_be_enabled(timeout=UI_STEP_MS), "an enabled Reveal button")
        before_cam = camera(st)
        reveal_btn.focus()
        st.keyboard.press("r")
        split = st.get_by_role("list", name="Answer split")
        expect(split.get_by_role("listitem")).to_have_count(len(counts))
        samples: list[tuple[int, list[int], list[bool]]] = []
        last_start = PILLAR_GAP_MS * (len(counts) - 1)
        end = last_start + PILLAR_SETTLE_MS + 400
        t = 0
        while t <= end:
            texts = item_texts(split)
            samples.append((t, [count_of(x) for x in texts], [x.endswith("✓ Correct answer") for x in texts]))
            assert all("%" not in x for x in texts)
            advance(st, FRAME_MS)
            t += FRAME_MS
        assert camera(st) != before_cam, "the 3D scene geometry did not change during the reveal"
    for prev, cur in zip(samples, samples[1:]):
        assert all(b >= a for a, b in zip(prev[1], cur[1])), "a count label went down"
    for t, values, marks in samples:
        assert all(v <= c for v, c in zip(values, counts)), f"count overshoot at {t} ms"
        if t < last_start:
            assert values[3] == 0, f"pillar D counted before its start at {t} ms"
            assert not any(marks), f"correct mark before the last pillar settled at {t} ms"
    assert any(v[0] > 0 and v[3] == 0 for _, v, _ in samples), "pillars did not start staggered"
    final = [s for s in samples if s[0] >= last_start + PILLAR_SETTLE_MS + FRAME_MS]
    assert final and all(v == counts for _, v, _ in final)
    assert final[-1][2] == [True, False, False, False]


def test_replayed_reveal(app_url, browser):
    h = Host(app_url)
    rid, counts = _locked_stage_room(h, app_url, [0, 0, 1, 3])
    h.go(rid, "reveal")
    with signed_in(browser, h, f"/stage/{rid}", live=False) as st:
        split = st.get_by_role("list", name="Answer split")
        expect(split.get_by_role("listitem")).to_have_count(len(counts))
        expect(split.get_by_role("listitem").first).to_contain_text("✓ Correct answer")
        texts = item_texts(split)
        assert [count_of(x) for x in texts] == counts
        assert [x.endswith("✓ Correct answer") for x in texts] == [True, False, False, False]


STILL_MODES = {"reduced_motion": {"reduced_motion": "reduce"}, "no_webgl": {"no_webgl": True}}


@pytest.mark.parametrize("mode", list(STILL_MODES.values()), ids=list(STILL_MODES))
def test_wf_reveal_still_list(app_url, browser, mode):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), est(t=LONG_LIMIT_S), seq(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    seats = [seat(app_url, room["pin"]) for _ in range(8)]
    with signed_in(browser, h, f"/stage/{rid}", live=False, **mode) as st:
        split = st.get_by_role("list", name="Answer split")

        def check(expected: list[tuple[str, bool]]) -> None:
            expect(split.get_by_role("listitem")).to_have_count(len(expected))
            texts = item_texts(split)
            for text, (prefix, correct) in zip(texts, expected):
                assert text.startswith(prefix), (text, prefix)
                assert text.endswith("✓ Correct answer") == correct, text
            assert animations(split) == []

        h.go(rid, "open_question")
        for s, c in zip(seats, (0, 0, 0, 1, 3, 3, 3, 3)):
            answer(app_url, rid, s["clientId"], 1, choice=c)
        rv = h.go(rid, "lock", "reveal")["reveal"]
        total = sum(rv["counts"])
        check([(f"{L}: {o} — {c} ({share(c, total)}%)", i == rv["correctIndex"])
               for i, (L, o, c) in enumerate(zip("ABCD", SEED_MC_OPTIONS, rv["counts"]))])
        assert rv["counts"] == [3, 1, 0, 4]
        h.go(rid, "show_leaderboard", "open_question")
        for s, v in zip(seats, (84, EST_ANSWER, 100, EST_MIN)):
            answer(app_url, rid, s["clientId"], 2, estimate=v)
        rv = h.go(rid, "lock", "reveal")["reveal"]
        total = sum(b["count"] for b in rv["bins"])
        check([(f"{fmt_num(b['from'])} to {fmt_num(b['to'])} — {b['count']} ({share(b['count'], total)}%)",
                k in rv["inBandBins"]) for k, b in enumerate(rv["bins"])])
        expect(st.get_by_role("region", name="Question")).to_contain_text(f"Answer: {EST_ANSWER} {EST_UNIT} ± {EST_TOL}")
        q = h.go(rid, "show_leaderboard", "open_question")["question"]
        for s, plan in zip(seats, (SEED_SEQ, SEED_SEQ, (SEED_SEQ[0], SEED_SEQ[1], SEED_SEQ[3], SEED_SEQ[2]))):
            answer(app_url, rid, s["clientId"], 3, order=order_ids(q, plan))
        rv = h.go(rid, "lock", "reveal")["reveal"]
        assert rv["buckets"] == [5, 0, 0, 1, 2] and sum(rv["buckets"]) == len(seats)
        n = len(SEED_SEQ)
        check([(f"{k} in place — {c} ({share(c, len(seats))}%)", k == n) for k, c in enumerate(rv["buckets"])])
        assert share(5, len(seats)) == (5 * 200 + len(seats)) // (2 * len(seats))
        shown = item_texts(st.get_by_role("list", name="Correct order"))
        assert len(shown) == len(SEED_SEQ) and all(label in text for label, text in zip(SEED_SEQ, shown)), shown


PODIUM_MODES = {"webgl": {}, "reduced_motion": {"reduced_motion": "reduce"}, "no_webgl": {"no_webgl": True}}


@pytest.mark.parametrize("mode", list(PODIUM_MODES.values()), ids=list(PODIUM_MODES))
def test_podium(app_url, browser, mode):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    seats = [seat(app_url, room["pin"]) for _ in range(4)]
    h.go(rid, "open_question")
    for s in seats:
        answer(app_url, rid, s["clientId"], 1, choice=0)
    h.go(rid, "lock", "reveal", "show_leaderboard")
    top = h.get_room(rid)["standings"][:3]
    expected = [f"{x['rank']}. {x['nickname']} — {x['score']}" for x in top]
    with signed_in(browser, h, f"/stage/{rid}", live=False, **mode) as st:
        board = st.get_by_role("list", name="Leaderboard")
        wait_ui(st, lambda: expect(board).to_be_visible(timeout=UI_STEP_MS), "the leaderboard")
        podium = st.get_by_role("list", name="Podium")
        if not mode:
            advance(st, 100)
            before = camera(st)
            st.keyboard.press("p")
            expect(st.get_by_role("status", name="Stage status")).to_contain_text("Podium")
            advance(st, PODIUM_MS / 2)
            mid = camera(st)
            assert mid != before, "the camera did not move at the podium step"
            early = "".join(item_texts(podium)) if podium.count() else ""
            assert top[0]["nickname"] not in early or podium.evaluate("el => +getComputedStyle(el).opacity") == 0
            advance(st, PODIUM_MS / 2 + 200)
            end = camera(st)
            advance(st, 300)
            assert camera(st) == end, "the camera kept moving after 1.4 s"
            assert end != before
        else:
            st.keyboard.press("p")
            expect(podium.get_by_role("listitem")).to_have_count(3)
            assert animations(podium) == []
        expect(podium.get_by_role("listitem")).to_have_count(3)
        for text, line in zip(item_texts(podium), expected):
            assert line in text, (text, line)


def test_event_replay(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    with cf.ThreadPoolExecutor(POOL) as ex:
        seats = list(ex.map(lambda i: seat(app_url, room["pin"], f"Ev {i:03d}"), range(SEATS_MAX)))
        h.go(rid, "open_question")
        assert all(c == 201 for c in ex.map(lambda s: answer(app_url, rid, s["clientId"], 1, choice=0).status_code, seats))
        h.go(rid, "lock", "reveal", "show_leaderboard", "open_question")
        assert all(c == 201 for c in ex.map(lambda s: answer(app_url, rid, s["clientId"], 2, choice=1).status_code, seats))
    last = h.go(rid, "lock")["lastEventId"]
    params = {"clientId": seats[0]["clientId"]}
    evs = [e for e in events_until(app_url, rid, params, after=0, target=last) if e["id"] <= last]
    ids = [e["id"] for e in evs]
    assert ids[0] == 1 and ids[-1] == last and all(b > a for a, b in zip(ids, ids[1:]))
    assert len(ids) > 500
    types = [e["type"] for e in evs]
    assert types.count("player_joined") == SEATS_MAX and types.count("answer_count") == 2 * SEATS_MAX
    assert (types.count("question_open"), types.count("locked"), types.count("reveal")) == (2, 2, 1)
    for start in (evs[10]["id"], evs[-5]["id"]):
        tail = [e for e in evs if e["id"] > start]
        assert [e["id"] for e in events_until(app_url, rid, params, after=start, target=last) if e["id"] <= last] == \
            [e["id"] for e in tail]
        stream = Stream(app_url, rid, params, last_event_id=start)
        try:
            assert stream.wait_open() == 200
            stream.wait_for(lambda e: e.get("id") == str(last), f"replay up to id {last}", seconds=WAIT_S * 2)
            got = [e for e in stream.events if "id" in e and int(e["id"]) <= last]
            assert [int(e["id"]) for e in got] == [e["id"] for e in tail]
            assert [e["event"] for e in got] == [e["type"] for e in tail]
        finally:
            stream.close()


def test_wf_reconnect_rejoin_after_end(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    rid = room["id"]
    a, b = seat(app_url, room["pin"]), seat(app_url, room["pin"])
    h.go(rid, "open_question")
    answer(app_url, rid, a["clientId"], 1, choice=0)
    answer(app_url, rid, b["clientId"], 1, choice=1)
    standings = {x["seatId"]: x for x in h.go(rid, "lock", "reveal")["standings"]}
    for s in (a, b):
        r = rejoin(app_url, s["rejoinToken"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) >= {"roomId", "seatId", "nickname", "score", "streak", "clientId"}
        mine = standings[s["seatId"]]
        assert (body["roomId"], body["seatId"], body["nickname"], body["score"], body["streak"]) == (
            rid, s["seatId"], s["nickname"], mine["score"], mine["streak"])
        assert body["clientId"] != s["clientId"] and len(body["clientId"]) >= TOKEN_MIN
        old = view(app_url, rid, s["clientId"])
        assert old.status_code == 409 and old.json()["error"] == "client_superseded"
        new = view(app_url, rid, body["clientId"])
        assert new.status_code == 200 and new.json()["you"]["seatId"] == s["seatId"]
        s["clientId"] = body["clientId"]
    assert standings[a["seatId"]]["streak"] == 1 and standings[a["seatId"]]["score"] > 0
    bad = rejoin(app_url, "z" * 40)
    assert bad.status_code == 401 and bad.json()["error"] == "invalid_rejoin_token"
    assert h.get_room(rid)["seated"] == 2
    h.go(rid, "show_leaderboard", "show_podium", "end")
    r = rejoin(app_url, a["rejoinToken"])
    assert r.status_code == 410 and r.json()["error"] == "room_ended"
    r = view(app_url, rid, a["clientId"])
    assert r.status_code == 410 and r.json()["error"] == "room_ended"


def test_wf_reconnect_racing_tabs(app_url, valkey):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    s = seat(app_url, room["pin"])
    first = Stream(app_url, rid, {"clientId": s["clientId"]})
    try:
        assert first.wait_open() == 200
        wait_members(valkey, rid, lambda m: s["clientId"] in m, "the first stream")
        results = race([lambda: rejoin(app_url, s["rejoinToken"])] * 4)
        assert all(r.status_code == 200 for r in results)
        ids = [r.json()["clientId"] for r in results]
        assert len(set(ids)) == len(ids)
        states = {cid: view(app_url, rid, cid) for cid in ids + [s["clientId"]]}
        valid = [cid for cid, r in states.items() if r.status_code == 200]
        assert len(valid) == 1, {c: r.status_code for c, r in states.items()}
        assert all(r.status_code == 409 and r.json()["error"] == "client_superseded"
                   for cid, r in states.items() if cid not in valid)
        sup = first.wait_for(lambda e: e.get("event") == "superseded", "superseded")
        assert "id" not in sup
        assert first.ended.wait(WAIT_S), "the retired stream stayed open"
    finally:
        first.close()
    code, body = stream_status(app_url, rid, {"clientId": s["clientId"]})
    assert code == 409 and body["error"] == "client_superseded"
    live = Stream(app_url, rid, {"clientId": valid[0]})
    try:
        assert live.wait_open() == 200
        wait_members(valkey, rid, lambda m: valid[0] in m and not (set(ids + [s["clientId"]]) - {valid[0]}) & m,
                     "only the surviving client")
    finally:
        live.close()


def test_wf_reconnect_stream_release(app_url, valkey):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    rid = room["id"]
    s = seat(app_url, room["pin"])
    ph = Stream(app_url, rid, {"clientId": s["clientId"]})
    assert ph.wait_open() == 200
    wait_members(valkey, rid, lambda m: s["clientId"] in m, "the phone stream")
    stage = Stream(app_url, rid, {"role": "stage"}, cookies=h.cookies)
    assert stage.wait_open() == 200
    wait_members(valkey, rid, lambda m: len(m) == 2, "the stage stream")
    stage.close()
    assert wait_members(valkey, rid, lambda m: m == {s["clientId"]}, "the stage leaving") <= PRESENCE_S + SLACK_S / 2
    ph.close()
    assert wait_members(valkey, rid, lambda m: s["clientId"] not in m, "the phone leaving") <= PRESENCE_S + SLACK_S / 2
    assert not any(p["connected"] for p in h.get_room(rid)["players"])
    for _ in range(ABORTED_STREAMS):
        st = Stream(app_url, rid, {"clientId": s["clientId"]})
        assert st.wait_open() == 200
        st.close()
    wait_no_busy_sessions(Postgres(), SESSION_CHECK_S + 1)
    assert httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_reconnect_reload(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S), mc(t=LONG_LIMIT_S)])
    room = h.room(deck_id)
    rid = room["id"]
    with phone(browser, app_url, room["pin"], nick("Rel")) as (p, s):
        h.go(rid, "open_question")
        tap(p.get_by_role("button", name="A: Jupiter"))
        expect(p.get_by_role("status", name="Answer status")).to_contain_text("Locked in")
        mine = next(x for x in h.go(rid, "lock", "reveal")["standings"] if x["seatId"] == s["seatId"])
        strip = p.get_by_role("region", name="Your standing")
        expect(strip).to_contain_text(f"Rank 1 of 1 · {mine['score']} pts")
        h.go(rid, "show_leaderboard", "open_question")
        p.reload()
        expect(p.get_by_role("region", name="Question echo")).to_contain_text("Question 2 of 2")
        expect(strip).to_contain_text(f"Rank 1 of 1 · {mine['score']} pts")
        expect(p.get_by_role("button", name="A: Jupiter")).to_be_enabled()
        hr = h.get_room(rid)
        assert [x["seatId"] for x in hr["players"]] == [s["seatId"]]
        assert hr["standings"][0]["streak"] == 1
        assert view(app_url, rid, s["clientId"]).status_code == 409
        p.context.set_offline(True)
        h.go(rid, "lock", "reveal")
        p.context.set_offline(False)
        p.reload()
        expect(p.get_by_role("status", name="Answer status")).to_contain_text("Answers are in")
        expect(strip).to_contain_text(f"Rank 1 of 1 · {mine['score']} pts")


def test_wf_valkey_fallback_backup():
    base = os.environ["APP_VALKEY_DOWN_URL"]
    h = Host(base)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    rid = room["id"]
    s = seat(base, room["pin"])
    for params, cookies in (({"clientId": s["clientId"]}, None), ({"role": "stage"}, h.cookies)):
        code, body = stream_status(base, rid, params, cookies)
        assert code == 503 and body["error"] == "live_unavailable"
    assert h.get_room(rid)["transport"] == "backup"
    opened = h.go(rid, "open_question")
    assert answer(base, rid, s["clientId"], 1, choice=0).status_code == 201
    evs = events_until(base, rid, {"clientId": s["clientId"]}, after=0, want=lambda e: e["type"] == "locked",
                       seconds=SHORT_LIMIT_S + LOCK_GRACE_S + SLACK_S * 3)
    types = [e["type"] for e in evs]
    assert types.index("player_joined") < types.index("question_open") < types.index("answer_count") < types.index("locked")
    assert next(e for e in evs if e["type"] == "locked")["data"]["reason"] == "deadline"
    assert all(b["id"] > a["id"] for a, b in zip(evs, evs[1:]))
    room = h.go(rid, "reveal", "show_leaderboard")
    evs = events_until(base, rid, {"role": "stage"}, cookies=h.cookies, after=opened["lastEventId"], target=room["lastEventId"])
    assert {"reveal", "leaderboard"} <= {e["type"] for e in evs}
    score = room["standings"][0]["score"]
    assert score > 0
    pg = Postgres("_valkeydown")
    assert pg.rows(f"SELECT score FROM standings WHERE room_id::text = '{rid}'")[0]["score"] == score
    assert pg.rows(f"SELECT points FROM answers WHERE room_id::text = '{rid}'")[0]["points"] == score
    for _ in range(ABORTED_STREAMS):
        assert stream_status(base, rid, {"clientId": s["clientId"]})[0] == 503
    wait_no_busy_sessions(pg, SESSION_CHECK_S + 1)
    assert httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200


@pytest.mark.timeout(900)
def test_wf_valkey_fallback_recover(valkey):
    with relayed_app() as (base, relay, proc):
        h = Host(base)
        deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
        room = h.room(deck_id)
        rid = room["id"]
        s = seat(base, room["pin"])
        st = Stream(base, rid, {"clientId": s["clientId"]})
        assert st.wait_open() == 200
        relay.cut()
        deadline = time.monotonic() + WAIT_S
        while time.monotonic() < deadline and stream_status(base, rid, {"clientId": s["clientId"]})[0] != 503:
            nap(0.5)
        code, body = stream_status(base, rid, {"clientId": s["clientId"]})
        assert code == 503 and body["error"] == "live_unavailable"
        assert st.ended.wait(WAIT_S), "the open stream stayed open during the outage"
        st.close()
        wait_room(h, rid, lambda r: r["transport"] == "backup", "transport backup")
        h.go(rid, "open_question")
        assert answer(base, rid, s["clientId"], 1, choice=0).status_code == 201
        score = h.go(rid, "lock", "reveal")["standings"][0]["score"]
        assert score > 0 and zscore(valkey, rid, s["seatId"]) != score
        relay.restore()
        limit = RECOVER_S + STREAM_RETRY_S + SLACK_S
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline and stream_status(base, rid, {"clientId": s["clientId"]})[0] != 200:
            nap(0.5)
        assert stream_status(base, rid, {"clientId": s["clientId"]})[0] == 200
        wait_room(h, rid, lambda r: r["transport"] == "live", "transport live", seconds=limit)
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline and zscore(valkey, rid, s["seatId"]) != score:
            nap(0.5)
        assert zscore(valkey, rid, s["seatId"]) == score
        assert proc.poll() is None


@pytest.mark.timeout(900)
def test_wf_valkey_fallback_copy(browser):
    with relayed_app() as (base, relay, _proc):
        h = Host(base)
        deck_id, _ = h.deck(questions=[mc(t=LONG_LIMIT_S)])
        room = h.room(deck_id)
        rid = room["id"]
        with signed_in(browser, h, f"/stage/{rid}") as st, phone(browser, base, room["pin"], nick("Bk")) as (p, s):
            conns = [pg.get_by_role("status", name="Connection status") for pg in (st, p)]
            relay.cut()
            for c in conns:
                expect(c).to_contain_text(BACKUP_COPY, timeout=WAIT_S * 1000)
            h.go(rid, "open_question")
            tap(p.get_by_role("button", name="A: Jupiter"))
            expect(p.get_by_role("status", name="Answer status")).to_contain_text("Locked in")
            expect(st.get_by_role("region", name="Question")).to_contain_text("1 of 1 answered")
            relay.restore()
            for c in conns:
                expect(c).to_contain_text(RETURN_COPY, timeout=(RECOVER_S + STREAM_RETRY_S + SLACK_S) * 1000)
                expect(c).not_to_contain_text(BACKUP_COPY)


def test_wf_night_end_close(app_url, valkey):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    room = h.room(deck_id)
    rid = room["id"]
    a = seat(app_url, room["pin"])
    h.go(rid, "open_question")
    answer(app_url, rid, a["clientId"], 1, choice=0)
    h.go(rid, "lock", "reveal", "show_leaderboard", "show_podium")
    streams = [Stream(app_url, rid, {"clientId": a["clientId"]}), Stream(app_url, rid, {"role": "stage"}, cookies=h.cookies)]
    try:
        for st in streams:
            assert st.wait_open() == 200
        wait_members(valkey, rid, lambda m: len(m) == 2, "both streams")
        h.go(rid, "end")
        for st in streams:
            ended = st.wait_for(lambda e: e.get("event") == "ended", "ended")
            assert json.loads(ended["data"]) == {"reason": "host"}
            assert st.ended.wait(WAIT_S), "a stream stayed open after the end"
    finally:
        for st in streams:
            st.close()
    for r in (rejoin(app_url, a["rejoinToken"]), view(app_url, rid, a["clientId"]),
              answer(app_url, rid, a["clientId"], 1, choice=0)):
        assert r.status_code == 410 and r.json()["error"] == "room_ended"
    assert stream_status(app_url, rid, {"clientId": a["clientId"]})[0] == 410
    assert h.get_room(rid)["state"] == "ended"
    keys = valkey.keys(f"lastbell:room:{rid}:*")
    assert leaderboard_key(rid) in keys
    for key in keys:
        assert 0 < valkey.ttl(key) <= KEY_TTL_S, key


def test_wf_night_end_idle():
    base = os.environ["APP_SHORT_URL"]
    h = Host(base)
    deck_id, _ = h.deck(questions=[mc()])
    sent = time.monotonic()
    rid = h.room(deck_id)["id"]
    got = time.monotonic()
    wait_room(h, rid, lambda r: r["state"] == "ended", "the idle end", seconds=SHORT_IDLE_S + IDLE_END_GRACE_S + SLACK_S)
    seen = time.monotonic()
    assert seen - sent >= SHORT_IDLE_S
    assert seen - got <= SHORT_IDLE_S + IDLE_END_GRACE_S + 1.5
    evs = events_until(base, rid, {"role": "stage"}, cookies=h.cookies, want=lambda e: e["type"] == "ended")
    assert next(e for e in evs if e["type"] == "ended")["data"] == {"reason": "idle"}
    assert rid in {n["roomId"] for n in h.c.get("/api/nights").json()["nights"]}

    room = h.room(deck_id)
    s = seat(base, room["pin"])
    st = Stream(base, room["id"], {"clientId": s["clientId"]})
    try:
        assert st.wait_open() == 200
        hold_until = time.monotonic() + SHORT_IDLE_S * 2
        while time.monotonic() < hold_until:
            assert h.get_room(room["id"])["state"] == "lobby", "a room with a connected client ended as idle"
            nap(0.5)
    finally:
        st.close()
    wait_room(h, room["id"], lambda r: r["state"] == "ended", "the idle end after the stream closed",
              seconds=SHORT_IDLE_S + IDLE_END_GRACE_S + PRESENCE_S + SLACK_S)


def test_night_results(app_url):
    h = Host(app_url)
    title = f"Night {slug('n')}"
    deck_id, _ = h.deck(title=title, questions=[mc()])
    rooms = []
    for _ in range(2):
        room = h.room(deck_id)
        seats = [seat(app_url, room["pin"]) for _ in range(4)]
        h.go(room["id"], "open_question")
        for i, s in enumerate(seats):
            answer(app_url, room["id"], s["clientId"], 1, choice=0 if i < 3 else 1)
        before = server_now(app_url)
        standings = h.go(room["id"], "lock", "reveal", "show_leaderboard", "show_podium", "end")["standings"]
        rooms.append((room["id"], before, server_now(app_url), standings))
    assert h.c.patch(f"/api/decks/{deck_id}", json={"title": f"Renamed {slug('n')}", "version": 1}).status_code == 200
    nights = h.c.get("/api/nights").json()["nights"]
    ended = [n["endedAt"] for n in nights]
    assert ended == sorted(ended, reverse=True)
    order = [n["roomId"] for n in nights]
    assert order.index(rooms[1][0]) < order.index(rooms[0][0])
    for rid, before, after, standings in rooms:
        n = next(x for x in nights if x["roomId"] == rid)
        assert n["deckTitle"] == title and before <= n["endedAt"] <= after and n["seated"] == 4
        top = [{"rank": x["rank"], "nickname": x["nickname"], "score": x["score"]} for x in standings]
        assert n["podium"] == top[:3]
        detail = h.c.get(f"/api/nights/{rid}").json()["night"]
        assert (detail["roomId"], detail["deckTitle"], detail["endedAt"], detail["standings"]) == (rid, title, n["endedAt"], top)
    live = h.room(deck_id)
    r = h.c.get(f"/api/nights/{live['id']}")
    assert r.status_code == 404 and r.json()["error"] == "not_found"
    assert live["id"] not in order
    ines = Host(app_url, INES_EMAIL, INES_PASSWORD)
    seed = next(n for n in ines.c.get("/api/nights").json()["nights"] if n["deckTitle"] == SEED_DECK)
    assert seed["endedAt"] == SEED_NIGHT_END_MS and seed["seated"] == 5
    want = [{"rank": r_, "nickname": n_, "score": s_} for r_, n_, s_ in SEED_STANDINGS]
    assert seed["podium"] == want[:3]
    assert ines.c.get(f"/api/nights/{seed['roomId']}").json()["night"]["standings"] == want


def test_wf_night_end_past_nights(app_url, browser):
    with ctx(open_app(browser, app_url + "/host/login")) as page:
        page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
        page.clock.resume()
        page.get_by_label("Email", exact=True).fill(INES_EMAIL)
        page.get_by_label("Password", exact=True).fill(INES_PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(page.get_by_role("heading", name="Your decks")).to_be_visible()
        page.get_by_role("link", name="Past nights").click()
        day = page.evaluate("ms => new Date(ms).getDate()", SEED_NIGHT_END_MS)
        nights = page.get_by_role("list", name="Past nights")
        link = nights.get_by_role("link", name=f"{SEED_DECK} — {day} Oct 2026")
        item = nights.get_by_role("listitem").filter(has=page.get_by_role("link", name=f"{SEED_DECK} — {day} Oct 2026"))
        for _, name, _ in SEED_STANDINGS[:3]:
            expect(item).to_contain_text(name)
        link.click()
        table = page.get_by_role("table", name="Final standings")
        for header in ("Rank", "Nickname", "Score"):
            expect(table.get_by_role("columnheader", name=header)).to_be_visible()
        rows = table.get_by_role("row")
        expect(rows).to_have_count(len(SEED_STANDINGS) + 1)
        for i, (rank, name, score) in enumerate(SEED_STANDINGS, start=1):
            cells = [norm(c) for c in rows.nth(i).get_by_role("cell").all_inner_texts()]
            assert cells == [str(rank), name, str(score)], cells
        layout(page)


def test_wf_cross_cutting_health(app_url):
    for base in (app_url, os.environ["APP_VALKEY_DOWN_URL"], os.environ["APP_MINIO_DOWN_URL"], os.environ["APP_SHORT_URL"]):
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, base
    page = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S)
    assert page.status_code == 200 and page.text.strip()
    me = httpx.get(f"{app_url}/api/auth/me", timeout=HTTP_TIMEOUT_S)
    assert me.status_code == 401 and me.json()["error"] == "not_signed_in"
    assert server_now(app_url) > SEED_NIGHT_END_MS


def test_wf_cross_cutting_boundary(app_url):
    h = Host(app_url)
    title = f"Foreign {slug('o')}"
    r = h.c.post("/api/decks", json={"title": title}, headers={"Origin": EVIL_ORIGIN})
    assert r.status_code == 403 and r.json()["error"] == "cross_origin"
    assert title not in {d["title"] for d in h.c.get("/api/decks").json()["decks"]}
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    assert h.c.post("/api/decks", json={"title": title}, headers={"Origin": origin}).status_code == 201
    assert r.json()["error"] == "cross_origin"
    skeleton = json.dumps({"email": "pad@corkline.example", "password": ""}, separators=(",", ":"))
    exact = skeleton.replace('"password":""', '"password":"' + "x" * (JSON_LIMIT - len(skeleton)) + '"').encode()
    assert len(exact) == JSON_LIMIT
    hdr = {"content-type": "application/json; charset=utf-8"}
    ok = httpx.post(f"{app_url}/api/auth/login", content=exact, headers=hdr, timeout=HTTP_TIMEOUT_S)
    assert ok.status_code == 401 and ok.json()["error"] == "invalid_credentials"
    over = httpx.post(f"{app_url}/api/auth/login", content=exact[:-2] + b'x"}', headers=hdr, timeout=HTTP_TIMEOUT_S)
    assert len(exact[:-2] + b'x"}') == JSON_LIMIT + 1
    assert over.status_code == 413 and over.json()["error"] == "payload_too_large"
    deck_id, (q,) = h.deck(questions=[mc()])
    big = upload(h, deck_id, q["id"], png_bytes(UPLOAD_BODY_LIMIT + 1000))
    assert big.status_code == 413 and big.json()["error"] == "payload_too_large"
    assert S3().keys(f"questions/{q['id']}/") == []
    for path in ("/.env", "/run.json", "/package.json", "/package-lock.json", "/node_modules/.package-lock.json",
                 "/src/server.ts", "/tsconfig.json"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    html = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S).text
    bodies = [html, h.c.get("/api/decks").text, h.c.get(f"/api/decks/{deck_id}").text, h.c.get("/api/auth/me").text]
    for ref in set(re.findall(r'(?:src|href)="([^"]+)"', html)):
        url = httpx.URL(app_url + "/").join(ref)
        if same_origin(str(url), origin):
            bodies.append(httpx.get(str(url), timeout=HTTP_TIMEOUT_S).text)
    secrets = [os.environ.get(k) for k in ("DATABASE_URL", "VALKEY_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    for url_var in ("DATABASE_URL", "VALKEY_URL", "S3_ENDPOINT"):
        parsed = urlparse(os.environ.get(url_var) or "")
        if parsed.hostname and parsed.port:
            secrets.append(f"{parsed.hostname}:{parsed.port}")
    secrets += [INES_PASSWORD, ROWAN_PASSWORD, NEW_PASSWORD]
    for body in bodies:
        for secret in filter(None, secrets):
            assert secret not in body, "a credential or service address was served"


SIZES = {
    "375x812": (PHONE_W, PHONE_H),
    "768x1024": (TABLET_W, TABLET_H),
    "1280x800": (DESK_W, DESK_H),
}


@pytest.mark.parametrize("size", list(SIZES.values()), ids=["375x812", "768x1024", "1280x800"])
def test_layout_every_screen(app_url, browser, size):
    h = Host(app_url)
    long_title = ("Tuesday Gilded Tap " * 5)[:TITLE_MAX]
    long_nick = "W" * NICK_MAX
    long_prompt = ("Which of these long-winded answers is right " * 5)[:PROMPT_MAX]
    deck_id, _ = h.deck(title=long_title, questions=[mc(t=LONG_LIMIT_S, prompt=long_prompt,
                                                        options=("W" * OPTION_MAX, "Au", "Gd", "Go"))])
    done = h.room(deck_id)
    seat(app_url, done["pin"], long_nick)
    h.go(done["id"], *FULL_NIGHT)
    room = h.room(deck_id)
    with ctx(open_app(browser, app_url + "/")) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.clock.resume()
        for path, ready in (("/", ("button", "Join the night")), ("/host/login", ("button", "Sign in")),
                            ("/host/signup", ("button", "Create account"))):
            page.goto(app_url + path)
            expect(page.get_by_role(ready[0], name=ready[1])).to_be_visible()
            layout(page)
    with phone(browser, app_url, room["pin"], long_nick, size=size) as (p, _s), \
            signed_in(browser, h, "/host", size=size) as st:
        expect(st.get_by_role("heading", name="Your decks")).to_be_visible()
        layout(st)
        for path, ready in ((f"/host/decks/{deck_id}", ("group", question_group(1))),
                            ("/host/nights", ("list", "Past nights")),
                            (f"/host/nights/{done['id']}", ("table", "Final standings")),
                            (f"/stage/{room['id']}", ("region", "Join details"))):
            st.goto(app_url + path)
            expect(st.get_by_role(ready[0], name=ready[1])).to_be_visible()
            layout(st)
        expect(st.get_by_role("list", name="Players")).to_contain_text(long_nick)
        h.go(room["id"], "open_question")
        expect(st.get_by_role("region", name="Question")).to_contain_text("Question 1 of 1")
        layout(st)
        expect(p.get_by_role("region", name="Question echo")).to_be_visible()
        layout(p)


def test_if_run_manifest():
    data = json.loads((APP_DIR / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices():
    text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    for pkg in shipped_packages():
        assert pkg.name in text, pkg.name
        assert str(pkg.version) in text, (pkg.name, pkg.version)
    assert "Fraunces" in text and "Atkinson Hyperlegible" in text


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad
    assert "Open Font License" in (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores():
    embedded = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "level", "lmdb", "pouchdb", "@duckdb/node-api",
                "duckdb", "redis-memory-server", "lokijs"}
    assert not embedded & {p.name for p in shipped_packages()}
    root = Path(DEPLOYED_APP)
    files = [f for f in root.rglob("*") if "node_modules" not in f.parts and f.suffix in {".sqlite", ".sqlite3", ".db"}]
    assert not files, files
    assert {"answers", "standings"} <= {name.split(".")[-1] for name in Postgres().tables()}


def test_if_self_hosted_assets(app_url, browser):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    rid = h.room(deck_id)["id"]
    families: set[str] = set()
    for path in ("/", f"/stage/{rid}"):
        with signed_in(browser, h, "/") as page:
            urls: list[str] = []
            page.on("request", lambda req: urls.append(req.url))
            page.goto(app_url + path)
            page.wait_for_load_state("load")
            families |= set(page.evaluate("async () => { await document.fonts.ready; return [...document.fonts]"
                                          ".filter(f => f.status === 'loaded').map(f => f.family.replace(/[\"']/g, '')) }"))
            assert all(same_origin(u, app_url) or u.startswith(("data:", "blob:")) for u in urls), urls
    assert any("Fraunces" in f for f in families) and any("Atkinson Hyperlegible" in f for f in families), families


def test_if_lockfile():
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    pkg = json.loads((APP_DIR / "package.json").read_text())
    assert lock.get("lockfileVersion") and lock.get("name") == pkg.get("name")
    root = lock.get("packages", {}).get("", {})
    assert set(pkg.get("dependencies", {})) <= set(root.get("dependencies", {}))
    install = json.loads((APP_DIR / "run.json").read_text())["install"]
    assert install.strip().startswith("npm ")


def test_if_service_config_untouched():
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    writes = {"Write", "Edit", "MultiEdit", "NotebookEdit", "str_replace_editor", "create_file", "write_file"}

    def walk(node: Any) -> Iterator[dict]:
        if isinstance(node, dict):
            yield node
            for v in node.values():
                yield from walk(v)
        elif isinstance(node, list):
            for v in node:
                yield from walk(v)

    hits = []
    for node in walk(json.loads(path.read_text())):
        if node.get("name") in writes:
            blob = json.dumps(node.get("input", node.get("arguments", "")))
            if re.search(r"compose[^\"]*\.ya?ml", blob):
                hits.append(blob[:200])
    assert not hits, hits


def test_wf_deck_authoring_stale_invalid(app_url):
    h = Host(app_url)
    deck_id, (q,) = h.deck(questions=[mc()])
    title = f"Kept {slug('t')}"
    r = h.c.patch(f"/api/decks/{deck_id}", json={"title": title, "version": 1})
    assert r.status_code == 200 and r.json()["deck"]["version"] == 2, r.text
    r = h.c.patch(f"/api/decks/{deck_id}", json={"title": "   ", "version": 1})
    assert r.status_code == 412 and r.json() == {"error": "version_conflict", "currentVersion": 2}, r.text
    path = f"/api/decks/{deck_id}/questions/{q['id']}"
    kept = f"Kept {slug('p')}"
    r = h.c.put(path, json={**typed(app_url, mc(prompt=kept)), "version": 1})
    assert r.status_code == 200 and r.json()["question"]["version"] == 2, r.text
    r = h.c.put(path, json={**typed(app_url, mc(prompt="", t=LONG_LIMIT_S + 1)), "version": 1})
    assert r.status_code == 412 and r.json() == {"error": "version_conflict", "currentVersion": 2}, r.text
    deck = h.get_deck(deck_id)
    assert (deck["title"], deck["version"]) == (title, 2)
    assert (deck["questions"][0]["prompt"], deck["questions"][0]["version"]) == (kept, 2)


def test_wf_deck_authoring_foreign_invalid(app_url):
    owner, other = Host(app_url), Host(app_url)
    deck_id, (q,) = owner.deck(questions=[mc()])
    unknown = other.c.get(f"/api/decks/{uuid.uuid4()}")
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
    for method, path, body in (
        ("PATCH", f"/api/decks/{deck_id}", {"title": "   ", "version": 1}),
        ("POST", f"/api/decks/{deck_id}/questions", typed(app_url, mc(prompt=""))),
        ("PUT", f"/api/decks/{deck_id}/questions/{q['id']}", {**typed(app_url, mc(prompt="")), "version": 1}),
    ):
        r = other.c.request(method, path, json=body)
        assert r.status_code == 404 and r.json() == unknown.json(), (method, path, r.status_code, r.text)
    deck = owner.get_deck(deck_id)
    assert (deck["version"], len(deck["questions"]), deck["questions"][0]["version"]) == (1, 1, 1)


def test_wf_deck_authoring_malformed_id(app_url):
    h = Host(app_url)
    deck_id, _ = h.deck(questions=[mc()])
    unknown = h.c.get(f"/api/decks/{uuid.uuid4()}")
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
    bad = f"deck-{slug('bad')}"
    for method, path, body in (
        ("GET", f"/api/decks/{bad}", None),
        ("PATCH", f"/api/decks/{bad}", {"title": f"Renamed {slug('t')}", "version": 1}),
        ("POST", f"/api/decks/{bad}/questions", typed(app_url, mc())),
        ("PUT", f"/api/decks/{deck_id}/questions/{bad}", {**typed(app_url, mc()), "version": 1}),
        ("DELETE", f"/api/decks/{deck_id}/questions/{bad}", None),
    ):
        r = h.c.request(method, path, json=body)
        assert r.status_code == 404 and r.json() == unknown.json(), (method, path, r.status_code, r.text)
    assert len(h.get_deck(deck_id)["questions"]) == 1


def test_wf_room_opening_unknown_ids(app_url):
    h = Host(app_url)
    for bad in ("not-a-deck", f"{uuid.uuid4()}x", "0"):
        r = h.c.post("/api/rooms", json={"deckId": bad})
        assert (r.status_code, r.json().get("error")) in {(404, "not_found"), (422, "validation_failed")}, (bad, r.status_code, r.text)
        r = h.c.get(f"/api/rooms/{bad}/host")
        assert (r.status_code, r.json().get("error")) in {(404, "not_found"), (422, "validation_failed")}, (bad, r.status_code, r.text)


def test_wf_cross_cutting_size_before_session(app_url):
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    hdr = {"content-type": "application/json; charset=utf-8", "Origin": origin}
    skeleton = json.dumps({"title": ""}, separators=(",", ":"))
    body = skeleton.replace('""', '"' + "x" * (JSON_LIMIT + 1 - len(skeleton)) + '"').encode()
    assert len(body) == JSON_LIMIT + 1
    for path in ("/api/decks", "/api/rooms", f"/api/rooms/{uuid.uuid4()}/commands"):
        r = httpx.post(app_url + path, content=body, headers=hdr, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}, (path, r.status_code, r.text)


def test_wf_run_the_night_foreign_unknown_command(app_url):
    owner, other = Host(app_url), Host(app_url)
    deck_id, _ = owner.deck(questions=[mc()])
    rid = owner.room(deck_id)["id"]
    before = owner.get_room(rid)
    unknown = other.cmd(str(uuid.uuid4()), "open_question")
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}, unknown.text
    for room_id in (str(uuid.uuid4()), rid):
        r = other.cmd(room_id, "skip_ahead")
        assert r.status_code == 404 and r.json() == unknown.json(), (room_id, r.status_code, r.text)
    after = owner.get_room(rid)
    assert (after["state"], after["questionIndex"]) == (before["state"], before["questionIndex"])


def test_wf_run_the_night_malformed_room_id(app_url):
    h = Host(app_url)
    for bad in (f"room-{slug('bad')}", f"{uuid.uuid4()}x", "0"):
        for command in ("open_question", "end"):
            r = h.cmd(bad, command)
            assert (r.status_code, r.json().get("error")) in {(404, "not_found"), (422, "validation_failed")}, (
                bad, command, r.status_code, r.text)


def test_wf_night_end_malformed_night_id(app_url):
    h = Host(app_url)
    unknown = h.c.get(f"/api/nights/{uuid.uuid4()}")
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}, unknown.text
    for bad in (f"night-{slug('bad')}", f"{uuid.uuid4()}x", "0"):
        r = h.c.get(f"/api/nights/{bad}")
        assert (r.status_code, r.json().get("error")) in {(404, "not_found"), (422, "validation_failed")}, (
            bad, r.status_code, r.text)
        r = httpx.get(f"{app_url}/api/nights/{bad}", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 401 and r.json() == {"error": "not_signed_in"}, (bad, r.status_code, r.text)


def test_wf_question_images_malformed_id(app_url):
    h = Host(app_url)
    deck_id, (q,) = h.deck(questions=[mc()])
    for bad in (f"deck-{slug('bad')}", f"{uuid.uuid4()}x", "0"):
        for d, qid in ((bad, q["id"]), (deck_id, bad)):
            path = f"/api/decks/{d}/questions/{qid}/image"
            for r in (upload(h, d, qid, PNG), h.c.delete(path)):
                assert (r.status_code, r.json().get("error")) in {(404, "not_found"), (422, "validation_failed")}, (
                    r.request.method, path, r.status_code, r.text)
    stored = h.get_deck(deck_id)["questions"][0]
    assert stored["image"] is None and stored["version"] == 1
    assert S3().keys(f"questions/{q['id']}/") == []
