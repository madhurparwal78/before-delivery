from __future__ import annotations

import base64
import contextlib
import html
import json
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
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import count
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Page
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    Valkey,
    advance,
    animations,
    camera,
    changed,
    decode,
    difference,
    held,
    layout,
    licence_allowed,
    motion,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    scene_frames,
    select,
    shipped_packages,
    state_styles,
    style,
    tap,
)


SCORE = "sc-tidewater"
TITLE = "Tidewater Nocturne"
COMPOSER = "seat-composer-7f3a"
COPYIST = "seat-copyist-2c9e"
OBOIST = "seat-oboe-5b1d"
VIOLINIST = "seat-violin1-8e4f"
COMPOSER_NAME = "Mara Lindqvist"
COPYIST_NAME = "Jun Okafor"
SEED_SEATS = {"c-mara": COMPOSER, "c-jun": COPYIST, "c-ines": OBOIST, "c-theo": VIOLINIST}
ROLE_WORD = {"composer": "Composer", "copyist": "Copyist", "player": "Section player"}

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
TOUCH_TARGET = 44

JSON_LIMIT = 262144
BANK_LIMIT = 8000000
FILE_NAME_MAX = 120
STAFF_CAP = 64
MEASURE_CAP = 2000
STAFF_NAME_MAX = 40
INVITE_NAME_MAX = 60
TEXT_MAX = 200
OPS_PER_WINDOW = 120
WINDOW_S = 10
BATCH_MAX = 50
HISTORY_LIMIT_MAX = 100
SYSTEMS_DEFAULT = 8
SYSTEMS_MAX = 16
ENGRAVE_BUDGET_S = 3
REMOVAL_S = 2
SOCKET_CLOSE_S = 2
PING_S = 10
PONG_GRACE_S = 10
PRESENCE_PUSH_S = 1
CATCH_UP_MS = 10000
RESTORED_S = 3
VALKEY_RETRY_S = 5
SNAPSHOT_EVERY = 100
ONE_STAFF_PAGE_SYSTEMS = 10
IDLE_RATE = 0.05
CROSSFADE_MS = 200
QUARTERS_PER_WHOLE = 4
WHOLE = 1920
TICKS = {"whole": 1920, "half": 960, "quarter": 480, "eighth": 240, "16th": 120, "32nd": 60}
DURATION_WORD = {"whole": "whole", "half": "half", "quarter": "quarter", "eighth": "eighth", "16th": "sixteenth", "32nd": "thirty-second"}
DOT_WORD = {0: "", 1: "dotted ", 2: "double-dotted "}
ACCIDENTAL = {0: "", 1: "♯", -1: "♭", 2: "𝄪", -2: "𝄫"}
MIDDLE_LINE = {"treble": ("B", 4), "percussion": ("B", 4), "alto": ("C", 4), "tenor": ("A", 3), "bass": ("D", 3)}
PART_ALLOWED = {
    ("draft", "engraving"), ("engraving", "rendering"), ("engraving", "draft"), ("rendering", "ready"),
    ("rendering", "pdf_pending"), ("pdf_pending", "ready"), ("ready", "engraving"), ("pdf_pending", "engraving"),
}
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0"}
FONTS = ["Bravura", "Fraunces", "IBM Plex Sans", "IBM Plex Mono"]

PAUSED_COPY = "Live sync paused. Your edits are saved and reach others within 10 seconds."
ERR_UNAUTHORIZED = "Open your seat link again."
ERR_NOT_FOUND = "Not found."
ERR_ROLE = "Your role cannot do this."
ERR_OWN_STAVES = "You can edit only your own staves."
ERR_VALIDATION = "Check the highlighted fields."
ERR_STORAGE = "Storage is unavailable. Nothing was saved."
ERR_BAD_TYPE = "Upload a WAV (RIFF/WAVE) or SFZ file."


HTTP_TIMEOUT = 30
UI_WAIT = 60
POLL_S = 0.2
STEP_MS = 250
COPY_BOOT_S = 240
SLACK_S = 30
PDF_WAIT_S = 180
HANDSHAKE_READS = 64
ENGRAVE_PAGES_MAX = 4000
LOAD_OLDER_MAX = 60
KEY_SETTLE_MS = 50
PDF_RETRY_COPY = "3"
SKEWED = datetime(2031, 3, 1, 3, 0, tzinfo=timezone.utc)
SKEWED_LATER = datetime(2031, 3, 2, 9, 0, tzinfo=timezone.utc)
FOREIGN = "http://elsewhere.example"
JUNK_TOKEN = "seat-not-issued-0000"

_IDLE = threading.Event()

OBOE = "Oboe"
FADE_MAX_MS = 400
OPACITY_CHAIN = "r => { let o = 1; for (let e = r; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; }"
FADE_PROBE = """() => {
  window.__fades = [];
  const note = a => {
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
    const kf = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes().flatMap(k => Object.keys(k)) : [];
    window.__fades.push({ms: t ? Number(t.duration) + Number(t.delay || 0) : 0, prop: a.transitionProperty || '', kf, el: (a.effect && a.effect.target) || null});
  };
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); note(a); return a; };
  for (const ev of ['transitionrun', 'animationstart']) {
    document.addEventListener(ev, () => document.getAnimations().forEach(note), true);
  }
}"""
VIOLA = "Viola"
FLUTE = "Flute"
TIMPANI = "Timpani"
VIOLIN_ONE = "Violin I"
PHRASE = "dolce, sempre legato"
SCRIPT_BODY = "alert(1)"
STYLE_BODY = "p{}"
SYMBOLS = "3 < 4 & 5 > 2"
LOUD = "forte"
MARK = "marcato"
LATE = "late"
OTHER_TAG = "u"
NEVER_SERVED = ["/run.json", "/package-lock.json", "/package.json", "/.env", "/tsconfig.json", "/src/index.ts", "/src/server.ts", "/server/index.ts"]


def part_region(page: Page, part_name: str) -> Any:
    return page.get_by_role("region", name=f"{part_name} part", exact=True)


def tag_names(markup: str) -> set[str]:
    return {m.lower() for m in re.findall(r"</?\s*([A-Za-z][A-Za-z0-9]*)", markup)}


def call(base: str, method: str, path: str, token: str | None = None, body: Any = None, **kw: Any) -> httpx.Response:
    headers = dict(kw.pop("headers", None) or {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        kw["json"] = body
    return httpx.request(method, base + path, headers=headers, timeout=HTTP_TIMEOUT, **kw)


def ok(r: httpx.Response, status: int = 200) -> Any:
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} answered {r.status_code}: {r.text[:400]}; expected {status}"
    return r.json() if r.content else None


def err(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} answered {r.status_code}: {r.text[:400]}; expected {status} {code}"
    body = r.json()
    assert body.get("error") == code, f"error code {body!r}; expected {code}"
    assert isinstance(body.get("message"), str) and body["message"], f"error without message: {body!r}"
    if message is not None:
        assert body["message"] == message, f"message {body['message']!r}; expected {message!r}"
    return body


def field_err(r: httpx.Response, key: str, message: str | None = None) -> dict:
    body = err(r, 422, "validation", ERR_VALIDATION)
    errors = body.get("errors") or {}
    assert key in errors, f"422 errors {errors!r} lacks key {key!r}"
    if message is not None:
        assert errors[key] == message, f"errors[{key!r}] = {errors[key]!r}; expected {message!r}"
    return body


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            value = fn()
            if value:
                return value
        except (AssertionError, KeyError, IndexError, httpx.HTTPError) as exc:
            last = exc
        _IDLE.wait(POLL_S)
    pytest.fail(f"{what} (within {seconds} s; last: {last})")


def outage(var: str) -> str:
    url = os.environ.get(var)
    assert url, f"{var} names the outage instance"
    return url.rstrip("/")


def fresh(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def race(n: int, fn: Callable[[int], Any]) -> list[Any]:
    barrier = threading.Barrier(n)

    def run(i: int) -> Any:
        barrier.wait(timeout=HTTP_TIMEOUT)
        return fn(i)

    with ThreadPoolExecutor(n) as pool:
        return list(pool.map(run, range(n)))


def score(base: str, token: str = COMPOSER) -> dict:
    return ok(call(base, "GET", f"/api/scores/{SCORE}", token))["score"]


def voice(base: str, staff: str, v: int, token: str = COMPOSER, pitch: str | None = None) -> list[dict]:
    params = {"pitch": pitch} if pitch else None
    return ok(call(base, "GET", f"/api/scores/{SCORE}/staves/{staff}/voices/{v}", token, params=params))["events"]


def sync(base: str) -> dict:
    return ok(call(base, "GET", f"/api/scores/{SCORE}/sync", COMPOSER))


def ops_after(base: str, after_seq: int) -> list[dict]:
    out: list[dict] = []
    cursor = max(0, after_seq)
    for _ in range(ENGRAVE_PAGES_MAX):
        body = ok(call(base, "GET", f"/api/scores/{SCORE}/ops", COMPOSER, params={"afterSeq": cursor, "limit": 500}))
        out += body["ops"]
        if not body["ops"]:
            return out
        cursor = body["ops"][-1]["seq"]
    pytest.fail("GET /ops kept returning entries")


def part(base: str, part_id: str, token: str = COMPOSER) -> dict:
    found = [p for p in ok(call(base, "GET", f"/api/scores/{SCORE}/parts", token))["parts"] if p["id"] == part_id]
    assert found, f"GET /parts lists {part_id}"
    return found[0]


def settle_part(base: str, part_id: str) -> dict:
    return poll(lambda: (p := part(base, part_id))["status"] not in ("engraving", "rendering") and p, PDF_WAIT_S, f"{part_id} left engraving and rendering")


def extract(base: str, part_id: str, token: str = COPYIST) -> httpx.Response:
    return call(base, "POST", f"/api/scores/{SCORE}/parts/{part_id}/extract", token, {})


def engraving(base: str, view: str = "score", part_id: str | None = None, limit: int | None = None, token: str = COMPOSER, pages: int = ENGRAVE_PAGES_MAX) -> tuple[list[dict], list[float]]:
    systems: list[dict] = []
    times: list[float] = []
    cursor = None
    for _ in range(pages):
        params: dict[str, Any] = {"view": view}
        if part_id:
            params["partId"] = part_id
        if limit:
            params["limit"] = limit
        if cursor:
            params["cursor"] = cursor
        t0 = time.monotonic()
        body = ok(call(base, "GET", f"/api/scores/{SCORE}/engraving", token, params=params))
        times.append(time.monotonic() - t0)
        systems += body["systems"]
        cursor = body["nextCursor"]
        if cursor is None:
            return systems, times
    return systems, times


def svg_text(svg: str) -> str:
    return re.sub(r"\s+", "", html.unescape(re.sub(r"<[^>]+>", "", svg)))


def eid(lamport: int, site: str) -> dict:
    return {"lamport": lamport, "site": site}


def key(element_id: dict) -> tuple[int, str]:
    return (element_id["lamport"], element_id["site"])


def note(step: str, octave: int, alter: int = 0, duration: str = "quarter", dots: int = 0) -> dict:
    return {"kind": "note", "pitch": {"step": step, "alter": alter, "octave": octave}, "duration": duration, "dots": dots}


def rest(duration: str = "quarter", dots: int = 0) -> dict:
    return {"kind": "rest", "duration": duration, "dots": dots}


def insert(lam: int, site: str, staff: str, v: int, after: dict | None, event: dict) -> dict:
    return {"id": eid(lam, site), "type": "insert", "staffId": staff, "voice": v, "after": after, "event": event}


def set_op(lam: int, site: str, staff: str, v: int, target: dict, field: str, value: Any) -> dict:
    return {"id": eid(lam, site), "type": "set", "staffId": staff, "voice": v, "target": target, "field": field, "value": value}


def delete_op(lam: int, site: str, staff: str, v: int, target: dict) -> dict:
    return {"id": eid(lam, site), "type": "delete", "staffId": staff, "voice": v, "target": target}


def post_ops(base: str, token: str, ops: list[dict], seen: int | None = None) -> httpx.Response:
    body: dict[str, Any] = {"ops": ops}
    if seen is not None:
        body["seen"] = seen
    return call(base, "POST", f"/api/scores/{SCORE}/ops", token, body)


def stamps(base: str) -> Iterator[int]:
    return count(score(base)["lamport"] + 1)


def tail(base: str, staff: str, v: int) -> dict | None:
    events = voice(base, staff, v)
    return events[-1]["id"] if events else None


def append(base: str, person: dict, staff: str, v: int, events: list[dict], stamp: Iterator[int]) -> list[dict]:
    after = tail(base, staff, v)
    ops = []
    for ev in events:
        op = insert(next(stamp), person["id"], staff, v, after, ev)
        ops.append(op)
        after = op["id"]
    for i in range(0, len(ops), BATCH_MAX):
        ok(post_ops(base, person["token"], ops[i:i + BATCH_MAX]))
    return ops


def ticks(duration: str, dots: int) -> int:
    t = TICKS[duration]
    return t + (t // 2 if dots >= 1 else 0) + (t // 4 if dots >= 2 else 0)


def measure_info(s: dict) -> Callable[[int], tuple[int, int]]:
    sigs = sorted(s["timeSignatures"], key=lambda t: t["measure"])

    def info(m: int) -> tuple[int, int]:
        cur = sigs[0]
        for t in sigs:
            if t["measure"] <= m:
                cur = t
        return cur["beats"] * WHOLE // cur["beatType"], cur["beatType"]

    return info


def score_ticks(s: dict) -> int:
    info = measure_info(s)
    return sum(info(m)[0] for m in range(1, s["measureCount"] + 1))


def split(start: int, length: int, info: Callable[[int], tuple[int, int]]) -> list[tuple[int, float, int]]:
    measure, acc = 1, 0
    for _ in range(MEASURE_CAP * 2):
        if acc + info(measure)[0] > start:
            break
        acc += info(measure)[0]
        measure += 1
    pieces = []
    pos, end = start, start + length
    for _ in range(MEASURE_CAP * 2):
        if pos >= end:
            break
        size, beat_type = info(measure)
        take = min(end, acc + size) - pos
        pieces.append((measure, 1 + (pos - acc) / (WHOLE / beat_type), take))
        pos += take
        if pos == acc + size:
            acc += size
            measure += 1
    return pieces


def fill_events(remaining: int) -> list[dict]:
    out = []
    for duration, dots in (("whole", 2), ("whole", 0), ("half", 0), ("quarter", 0), ("eighth", 0), ("16th", 0), ("32nd", 0)):
        t = ticks(duration, dots)
        for _ in range(remaining // t):
            out.append(rest(duration, dots))
        remaining %= t
    assert remaining == 0, "voice end is not on a 32nd grid"
    return out


def send_chain(base: str, make: Callable[[], dict], staff: str, v: int, events: list[dict], stamp: Iterator[int]) -> None:
    after = tail(base, staff, v)
    person = make()
    for i in range(0, len(events), BATCH_MAX):
        if i and i % (2 * BATCH_MAX) == 0:
            person = make()
        ops = []
        for ev in events[i:i + BATCH_MAX]:
            op = insert(next(stamp), person["id"], staff, v, after, ev)
            ops.append(op)
            after = op["id"]
        ok(post_ops(base, person["token"], ops))


PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
LETTERS = "CDEFGAB"


def midi(p: dict) -> int:
    return (p["octave"] + 1) * 12 + PC[p["step"]] + p["alter"]


def staff_step(step: str, octave: int) -> int:
    return octave * 7 + LETTERS.index(step)


def pitch_text(p: dict) -> str:
    return f"{p['step']}{ACCIDENTAL[p['alter']]} {p['octave']}"


def dur_text(duration: str, dots: int) -> str:
    return DOT_WORD[dots] + DURATION_WORD[duration]


def beat_text(b: float) -> str:
    return str(int(b)) if float(b).is_integer() else f"{b:.3f}".rstrip("0").rstrip(".")


def nearest_octave(letter: str, prev: tuple[str, int]) -> int:
    target = staff_step(*prev)
    return min(range(prev[1] - 1, prev[1] + 2), key=lambda o: abs(staff_step(letter, o) - target))


def previous_note(events: list[dict], clef: str) -> tuple[str, int]:
    notes = [e for e in events if e["kind"] == "note"]
    return (notes[-1]["pitch"]["step"], notes[-1]["pitch"]["octave"]) if notes else MIDDLE_LINE[clef]


def semitone(p: dict, up: bool) -> dict:
    m = midi(p) + (1 if up else -1)
    octave, pc = divmod(m, 12)
    octave -= 1
    for step, value in PC.items():
        if value == pc:
            return {"step": step, "alter": 0, "octave": octave}
    if up:
        step = next(s for s, v in PC.items() if v == pc - 1)
        return {"step": step, "alter": 1, "octave": octave}
    step = next(s for s, v in PC.items() if v == pc + 1)
    return {"step": step, "alter": -1, "octave": octave}


def respell(p: dict) -> dict:
    m = midi(p)
    cands = []
    for octave in range(p["octave"] - 1, p["octave"] + 2):
        for step in LETTERS:
            alter = m - ((octave + 1) * 12 + PC[step])
            if -2 <= alter <= 2:
                cands.append({"step": step, "alter": alter, "octave": octave})
    cands.sort(key=lambda c: staff_step(c["step"], c["octave"]))
    return cands[(cands.index(p) + 1) % len(cands)]


def entry_copy(ev: dict) -> str:
    d = dur_text(ev["duration"], ev["dots"])
    pos = f"measure {ev['measure']}, beat {beat_text(ev['beat'])}."
    s = f"{pitch_text(ev['pitch'])} {d}, {pos}" if ev["kind"] == "note" else f"{d[0].upper()}{d[1:]} rest, {pos}"
    if len(ev["pieces"]) > 1:
        s += f" Tied across the barline into measure {ev['pieces'][-1]['measure']}."
    return s


def hhmmss(at: str) -> str:
    return datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%H:%M:%S")


def wav_bytes(total: int | None = None) -> bytes:
    rate = 8000
    data = bytes((total - 44) if total else 1600)
    fmt = struct.pack("<4sIHHIIHH", b"fmt ", 16, 1, 1, rate, rate * 2, 2, 16)
    body = b"WAVE" + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


SFZ_TEXT = b"// strings for the oboe line\n/* block comment */\n  <region> sample=missing.wav\n"


def bank_name(ext: str) -> str:
    return f"bank-{uuid.uuid4().hex[:10]}.{ext}"


def upload(base: str, name: str, data: bytes, staff: str = "st-ob", root: str | None = None, token: str = COMPOSER) -> httpx.Response:
    params = {"fileName": name, "staffId": staff}
    if root:
        params["root"] = root
    return httpx.post(f"{base}/api/scores/{SCORE}/banks", params=params, content=data,
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"}, timeout=HTTP_TIMEOUT)


def bank_keys(name: str, bucket: S3 | None = None) -> list[str]:
    return [k for k in (bucket or S3()).keys(f"scores/{SCORE}/banks/") if k.endswith("/" + name)]


def banks_named(base: str, name: str) -> list[dict]:
    return [b for b in ok(call(base, "GET", f"/api/scores/{SCORE}/banks", COMPOSER))["banks"] if b["fileName"] == name]


class Live:
    def __init__(self, base: str, token: str, *, origin: str | None = None, answer_pings: bool = True) -> None:
        parts = urlsplit(base)
        self.host = parts.hostname or "127.0.0.1"
        self.port = parts.port or 80
        self.messages: list[dict] = []
        self.closed = False
        self.answer_pings = answer_pings
        self.cond = threading.Condition()
        self.wlock = threading.Lock()
        self.connection_id: str | None = None
        self.sock = socket.create_connection((self.host, self.port), timeout=HTTP_TIMEOUT)
        nonce = base64.b64encode(os.urandom(16)).decode()
        lines = [f"GET /api/scores/{SCORE}/live?token={token} HTTP/1.1", f"Host: {self.host}:{self.port}", "Upgrade: websocket",
                 "Connection: Upgrade", f"Sec-WebSocket-Key: {nonce}", "Sec-WebSocket-Version: 13"]
        if origin:
            lines.append(f"Origin: {origin}")
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        head = b""
        for _ in range(HANDSHAKE_READS):
            if b"\r\n\r\n" in head:
                break
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            head += chunk
        fields = head.split(b"\r\n", 1)[0].decode(errors="replace").split()
        self.status = int(fields[1]) if len(fields) > 1 and fields[1].isdigit() else 0
        self.buffer = head.split(b"\r\n\r\n", 1)[1] if b"\r\n\r\n" in head else b""
        if self.status == 101:
            self.sock.settimeout(None)
            threading.Thread(target=self._reader, daemon=True).start()
        else:
            self.closed = True
            self.sock.close()

    def _exact(self, n: int) -> bytes:
        for _ in range(n + 1):
            if len(self.buffer) >= n:
                break
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError
            self.buffer += chunk
        if len(self.buffer) < n:
            raise EOFError
        out, self.buffer = self.buffer[:n], self.buffer[n:]
        return out

    def _reader(self) -> None:
        fragments = b""
        try:
            while not self.closed:
                b0, b1 = self._exact(2)
                n = b1 & 0x7F
                if n == 126:
                    n = int.from_bytes(self._exact(2), "big")
                elif n == 127:
                    n = int.from_bytes(self._exact(8), "big")
                mask = self._exact(4) if b1 & 0x80 else b""
                payload = self._exact(n)
                if mask:
                    payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                opcode = b0 & 0x0F
                if opcode == 9:
                    if self.answer_pings:
                        self._frame(10, payload)
                elif opcode == 8:
                    self.closed = True
                elif opcode in (0, 1, 2):
                    fragments += payload
                    if b0 & 0x80:
                        with contextlib.suppress(ValueError):
                            msg = json.loads(fragments.decode())
                            with self.cond:
                                self.messages.append(msg)
                                self.cond.notify_all()
                        fragments = b""
        except (OSError, EOFError, ValueError):
            pass
        with self.cond:
            self.closed = True
            self.cond.notify_all()

    def _frame(self, opcode: int, payload: bytes) -> None:
        mask = os.urandom(4)
        n = len(payload)
        head = bytes([0x80 | opcode])
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + n.to_bytes(2, "big")
        else:
            head += bytes([0x80 | 127]) + n.to_bytes(8, "big")
        with self.wlock:
            self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send(self, obj: dict) -> None:
        self._frame(1, json.dumps(obj).encode())

    def heartbeat(self, cursor: dict | None = None, seen: int | None = None) -> None:
        msg: dict[str, Any] = {"type": "heartbeat", "cursor": cursor}
        if seen is not None:
            msg["seen"] = seen
        self.send(msg)

    def wait(self, pred: Callable[[dict], bool], seconds: float, what: str) -> dict:
        deadline = time.monotonic() + seconds
        with self.cond:
            while time.monotonic() < deadline:
                for m in self.messages:
                    if pred(m):
                        return m
                self.cond.wait(max(0.0, deadline - time.monotonic()))
        pytest.fail(f"live socket: {what} within {seconds} s")

    def welcome(self) -> dict:
        m = self.wait(lambda m: m.get("type") == "welcome", HTTP_TIMEOUT, "welcome message")
        self.connection_id = m["connectionId"]
        return m

    def wait_closed(self, seconds: float, what: str) -> None:
        deadline = time.monotonic() + seconds
        with self.cond:
            while not self.closed and time.monotonic() < deadline:
                self.cond.wait(max(0.0, deadline - time.monotonic()))
        assert self.closed, f"live socket {what} within {seconds} s"

    def close(self) -> None:
        with contextlib.suppress(OSError):
            self._frame(8, (1000).to_bytes(2, "big"))
        self.drop()

    def drop(self) -> None:
        self.closed = True
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        with contextlib.suppress(OSError):
            self.sock.close()


def live(base: str, token: str, **kw: Any) -> Live:
    sock = Live(base, token, **kw)
    assert sock.status == 101, f"live session upgrade answered {sock.status}; expected 101"
    sock.welcome()
    return sock


def hold(base: str, token: str, conn: str | None, staff_ids: list[str]) -> httpx.Response:
    return call(base, "POST", f"/api/scores/{SCORE}/holds", token, {"staffIds": staff_ids, "connectionId": conn})


def holds(base: str) -> dict[str, str]:
    return {h["staffId"]: h["holder"]["id"] for h in ok(call(base, "GET", f"/api/scores/{SCORE}/holds", COMPOSER))["holds"]}


def presence_ids(base: str) -> set[str]:
    return {e["collaboratorId"] for e in ok(call(base, "GET", f"/api/scores/{SCORE}/presence", COMPOSER))["entries"]}


def no_open_app_sessions() -> bool:
    rows = Postgres().rows(
        "SELECT state FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user "
        "AND state IN ('active', 'idle in transaction')")
    return len(rows) == 0


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Relay:

    def __init__(self, target: tuple[str, int]) -> None:
        self.target = target
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()

    def up(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(128)
        self.listener = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def _accept(self, s: socket.socket) -> None:
        accepting = True
        while accepting:
            try:
                client, _ = s.accept()
            except OSError:
                accepting = False
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                client.close()
                continue
            upstream.settimeout(None)
            with self.lock:
                self.conns += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        flowing = True
        while flowing:
            try:
                data = src.recv(65536)
            except OSError:
                data = b""
            if not data:
                flowing = False
                with contextlib.suppress(OSError):
                    dst.shutdown(socket.SHUT_WR)
                continue
            try:
                dst.sendall(data)
            except OSError:
                flowing = False

    def down(self) -> None:
        if self.listener:
            with contextlib.suppress(OSError):
                self.listener.shutdown(socket.SHUT_RDWR)
            self.listener.close()
            self.listener = None
        with self.lock:
            for c in self.conns:
                with contextlib.suppress(OSError):
                    c.shutdown(socket.SHUT_RDWR)
                c.close()
            self.conns.clear()


def routed(var: str, relay_port: int | None = None) -> tuple[tuple[str, int], str]:
    url = os.environ.get(var)
    assert url, f"{var} is set for the verifier"
    u = urlsplit(url)
    default = {"http": 80, "https": 443, "redis": 6379, "rediss": 6379}.get(u.scheme, 80)
    userinfo = u.netloc.rsplit("@", 1)[0] + "@" if "@" in u.netloc else ""
    new = urlunsplit((u.scheme, f"{userinfo}127.0.0.1:{relay_port}", u.path, u.query, u.fragment)) if relay_port else url
    return (u.hostname or "127.0.0.1", u.port or default), new


@contextlib.contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    port = free_port()
    manifest_path = Path(DEPLOYED_APP) / "run.json"
    manifest = json.loads((manifest_path if manifest_path.exists() else Path("/app/run.json")).read_text())
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log_path = Path(tempfile.mkdtemp()) / "copy.log"
    with open(log_path, "wb") as log:
        proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail_log() -> str:
        return log_path.read_text(errors="replace")[-3000:]

    try:
        deadline = time.monotonic() + COPY_BOOT_S
        up = False
        while time.monotonic() < deadline and not up:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}: {tail_log()}")
            with contextlib.suppress(httpx.HTTPError):
                up = httpx.get(base + "/api/health", timeout=2).status_code == 200
            if not up:
                with contextlib.suppress(subprocess.TimeoutExpired):
                    proc.wait(timeout=POLL_S)
        assert up, f"app copy never answered /api/health: {tail_log()}"
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=HTTP_TIMEOUT)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)


DEAD_RENDERER = "http://127.0.0.1:9"


@contextlib.contextmanager
def scratch_app(overrides: dict[str, str], isolated: bool) -> Iterator[tuple[str, S3]]:
    if not isolated:
        with app_copy(overrides) as plain:
            yield plain, S3()
        return
    suffix = "x" + uuid.uuid4().hex[:8]
    admin = os.environ["DATABASE_URL"]
    u = urlsplit(admin)
    name = f"{u.path.lstrip('/')}_{suffix}"

    def sql(statement: str) -> None:
        subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", statement], check=True, capture_output=True, timeout=HTTP_TIMEOUT)

    sql(f'CREATE DATABASE "{name}"')
    scratch_url = urlunsplit(u._replace(path=f"{u.path}_{suffix}"))
    try:
        with app_copy({**overrides, "DATABASE_URL": scratch_url, "S3_BUCKET": f"{os.environ['S3_BUCKET']}-{suffix}"}) as base:
            yield base, S3(f"-{suffix}")
    finally:
        with contextlib.suppress(subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def renderer_down_copy(request: pytest.FixtureRequest) -> tuple[str, S3]:
    stack = contextlib.ExitStack()
    request.addfinalizer(stack.close)
    return stack.enter_context(scratch_app({"GOTENBERG_URL": DEAD_RENDERER}, True))


def eventually(page: Page, check: Callable[[], Any], what: str, seconds: float = UI_WAIT) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                return value
        except (AssertionError, KeyError, IndexError, PlaywrightError, httpx.HTTPError) as exc:
            last = exc
        advance(page, STEP_MS)
    pytest.fail(f"{what} (within {seconds} s; last: {last})")


def text(loc: Any) -> str:
    return " ".join((loc.text_content() or "").split())


def status(page: Page, name: str) -> Any:
    return page.get_by_role("status", name=name, exact=True)


def btn(page: Page, name: str) -> Any:
    return page.get_by_role("button", name=name, exact=True)


def open_tab(page: Page, name: str) -> None:
    page.get_by_role("tab", name=name, exact=True).click()


def chip(page: Page, part_name: str) -> Any:
    return page.get_by_role("status", name=f"{part_name} PDF status", exact=True).first


def wait_workspace(page: Page, live_copy: str | None = "Live") -> None:
    heading = page.get_by_role("heading", level=1, name=TITLE, exact=True)
    eventually(page, heading.is_visible, "workspace heading level 1 shows the score title")
    if live_copy:
        eventually(page, lambda: text(status(page, "Live sync")) == live_copy, f"Live sync reads {live_copy!r}")


def editor(page: Page) -> Any:
    return page.get_by_role("application", name="Score editor", exact=True)


def press(page: Page, keys: str) -> None:
    page.keyboard.press(keys)
    advance(page, KEY_SETTLE_MS)


def expect_entry(page: Page, expected: str) -> None:
    eventually(page, lambda: text(status(page, "Entry")) == expected, f'Entry announces "{expected}"')


def choose_entry(page: Page, staff_name: str, v: int) -> None:
    editor(page).focus()
    entry = status(page, "Entry")
    want = f"Entering on {staff_name}, voice "
    for keys in ("Alt+ArrowUp", "Alt+ArrowDown"):
        for _ in range(STAFF_CAP + 1):
            if text(entry).startswith(want):
                break
            press(page, keys)
        if text(entry).startswith(want):
            break
    for _ in range(2):
        if text(entry) == f"{want}{v}.":
            break
        press(page, "v")
    expect_entry(page, f"{want}{v}.")


def new_events(page: Page, base: str, staff: str, v: int, before: list[dict], n: int) -> list[dict]:
    seen = {key(e["id"]) for e in before}
    return eventually(page, lambda: (evs := [e for e in voice(base, staff, v) if key(e["id"]) not in seen]) and len(evs) >= n and evs,
                      f"{n} new events saved in {staff} voice {v}")


def on_option(opt: Any) -> bool:
    return opt.evaluate("o => o === document.activeElement || (!!o.id && o.closest('[role=listbox]').getAttribute('aria-activedescendant') === o.id)")


def select_only(page: Page, names: list[str]) -> None:
    lb = page.get_by_role("listbox", name="Staves", exact=True)
    lb.evaluate("l => (l.tabIndex >= 0 ? l : (l.querySelector('[tabindex=\"0\"]') || l)).focus()")
    for i in range(lb.get_by_role("option").count()):
        opt = lb.get_by_role("option").nth(i)
        want = text(opt) in names
        if (opt.get_attribute("aria-selected") == "true") == want:
            continue
        for keys in ("ArrowDown", "ArrowUp"):
            for _ in range(STAFF_CAP + 1):
                if on_option(opt):
                    break
                press(page, keys)
            if on_option(opt):
                break
        assert on_option(opt), f"arrow keys never reach {text(opt)} in Staves"
        press(page, "Space")
        eventually(page, lambda: (opt.get_attribute("aria-selected") == "true") == want, f"Space toggles {text(opt)}")
    chosen = sorted(text(o) for o in lb.get_by_role("option", selected=True).all())
    assert chosen == sorted(names), f"Staves selection {chosen}; expected {sorted(names)}"


def open_seat(browser: Browser, base: str, token: str, size: dict = DESKTOP, **kw: Any) -> Any:
    return open_app(browser, f"{base}/s/{token}", **kw)


def rotation(m1: list[float], m2: list[float]) -> float:
    import math

    def basis(m: list[float]) -> list[list[float]]:
        cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]]
        return [[x / (math.sqrt(sum(y * y for y in c)) or 1) for x in c] for c in cols]

    a, b = basis(m1), basis(m2)
    trace = sum(a[i][j] * b[i][j] for i in range(3) for j in range(3))
    return math.acos(max(-1.0, min(1.0, (trace - 1) / 2)))


def max_rotation(before: list[list[float]], after: list[list[float]]) -> float:
    return max((rotation(x, y) for x, y in zip(before, after) if len(x) >= 16 and len(y) >= 16), default=0.0)


@pytest.fixture
def team(app_url: str) -> Iterator[Callable[..., dict]]:
    made: list[dict] = []

    def make(role: str = "copyist", staff_ids: list[str] | None = None, base: str | None = None) -> dict:
        b = base or app_url
        if staff_ids is None:
            staff_ids = [s["id"] for s in score(b)["staves"]] if role == "copyist" else []
        name = fresh("Copyist" if role == "copyist" else "Player")
        inv = ok(call(b, "POST", f"/api/scores/{SCORE}/invites", COMPOSER, {"name": name, "role": role, "staffIds": staff_ids}), 201)
        acc = ok(call(b, "POST", f"/api/invites/{inv['inviteToken']}/accept", None, {}))
        person = {"base": b, "id": acc["collaborator"]["id"], "name": name, "token": acc["seatToken"], "role": role}
        made.append(person)
        return person

    yield make
    for p in made:
        with contextlib.suppress(httpx.HTTPError):
            call(p["base"], "DELETE", f"/api/scores/{SCORE}/collaborators/{p['id']}", COMPOSER)


INSTANCES = {"primary": "", "minio-down": "APP_MINIO_DOWN_URL", "valkey-down": "APP_VALKEY_DOWN_URL", "gotenberg-down": "APP_GOTENBERG_DOWN_URL"}


@pytest.mark.parametrize("instance", list(INSTANCES), ids=list(INSTANCES))
def test_health_on_every_instance(app_url: str, instance: str) -> None:
    base = outage(INSTANCES[instance]) if INSTANCES[instance] else app_url
    r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    root = httpx.get(f"{base}/", timeout=HTTP_TIMEOUT)
    assert root.status_code == 200 and root.text.lstrip().startswith("<"), "GET / did not serve the browser app"


def test_cross_origin_refused(app_url: str) -> None:
    r = call(app_url, "GET", f"/api/scores/{SCORE}", COMPOSER, headers={"Origin": FOREIGN})
    err(r, 403, "cross_origin", "Requests must come from Fairline itself.")
    assert FOREIGN not in r.headers.values() and "*" not in r.headers.values(), "a cross-origin header was sent"
    assert call(app_url, "GET", f"/api/scores/{SCORE}", COMPOSER, headers={"Origin": app_url}).status_code == 200
    name = fresh("Foreign")
    r = call(app_url, "POST", f"/api/scores/{SCORE}/invites", COMPOSER, {"name": name, "role": "copyist", "staffIds": []}, headers={"Origin": FOREIGN})
    err(r, 403, "cross_origin")
    people = ok(call(app_url, "GET", f"/api/scores/{SCORE}/collaborators", COMPOSER))["collaborators"]
    assert all(p["name"] != name for p in people), "a cross-origin invite created a collaborator"
    sock = Live(app_url, COMPOSER, origin=FOREIGN)
    assert sock.status == 403, f"live upgrade from a foreign origin answered {sock.status}; expected 403"


def padded_json(size: int, payload: dict) -> bytes:
    stub = json.dumps({**payload, "pad": ""}, separators=(",", ":")).encode()
    body = json.dumps({**payload, "pad": "x" * (size - len(stub))}, separators=(",", ":")).encode()
    assert len(body) == size
    return body


def test_json_body_limit(app_url: str) -> None:
    path = f"{app_url}/api/scores/{SCORE}/invites"
    payload = {"name": "", "role": "copyist", "staffIds": []}
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {COMPOSER}"}
    r = httpx.post(path, content=padded_json(JSON_LIMIT, payload), headers=headers, timeout=HTTP_TIMEOUT)
    assert r.status_code == 422, f"body at the limit answered {r.status_code}; expected the 422 for the empty name"
    over = padded_json(JSON_LIMIT + 1, payload)
    msg = "Request bodies are limited to 262,144 bytes."
    err(httpx.post(path, content=over, headers=headers, timeout=HTTP_TIMEOUT), 413, "payload_too_large", msg)
    err(httpx.post(path, content=over, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT), 413, "payload_too_large", msg)


def app_files(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist", "build", ".next", "out")]
        out += [Path(dirpath) / f for f in filenames if f.endswith(suffixes)]
    return sorted(out)


def test_never_served_files(app_url: str) -> None:
    probes = NEVER_SERVED
    served = [(p, r.status_code) for p in probes if (r := httpx.get(app_url + p, timeout=HTTP_TIMEOUT)).status_code != 404]
    assert not served, f"files answered other than 404: {served}"


def test_error_shape_and_precedence(app_url: str) -> None:
    err(call(app_url, "GET", "/api/scores/sc-nowhere"), 401, "unauthorized", ERR_UNAUTHORIZED)
    err(call(app_url, "POST", f"/api/scores/{SCORE}/measures", JUNK_TOKEN, {"count": 0}), 401, "unauthorized", ERR_UNAUTHORIZED)
    err(call(app_url, "GET", "/api/me", JUNK_TOKEN), 401, "unauthorized", ERR_UNAUTHORIZED)
    err(call(app_url, "PATCH", "/api/scores/sc-nowhere/staves/st-ob", OBOIST, {"name": "x"}), 404, "not_found", ERR_NOT_FOUND)
    err(call(app_url, "PATCH", f"/api/scores/{SCORE}/staves/st-nowhere", OBOIST, {"name": "x"}), 404, "not_found", ERR_NOT_FOUND)
    err(call(app_url, "GET", f"/api/scores/{SCORE}/parts/p-nowhere/pdf", COMPOSER), 404, "not_found", ERR_NOT_FOUND)
    err(call(app_url, "POST", f"/api/scores/{SCORE}/measures", COPYIST, {"count": 0}), 403, "forbidden", ERR_ROLE)
    field_err(call(app_url, "POST", f"/api/scores/{SCORE}/measures", COMPOSER, {"count": 0}), "count")
    field_err(upload(app_url, "not allowed.mp3", b"plain text"), "fileName", "Use a plain file name ending in .wav or .sfz.")
    field_err(call(app_url, "GET", f"/api/scores/{SCORE}/history", COMPOSER, params={"staffId": "st-nowhere"}), "staffId", "Unknown staff.")
    r = call(app_url, "GET", f"/api/scores/{SCORE}/holds", None)
    assert r.headers.get("content-type", "").startswith("application/json")


SERVICES = {"storage": "S3_ENDPOINT", "broadcast": "VALKEY_URL", "renderer": "GOTENBERG_URL"}


@pytest.mark.timeout(1200)
@pytest.mark.parametrize("service", list(SERVICES), ids=list(SERVICES))
def test_boots_degrades_and_recovers(app_url: str, service: str, team: Callable[..., dict]) -> None:
    target, _ = routed(SERVICES[service])
    relay = Relay(target)
    _, url = routed(SERVICES[service], relay.port)
    overrides = {SERVICES[service]: url}
    if service == "renderer":
        overrides["PDF_RETRY_SECONDS"] = PDF_RETRY_COPY
    try:
        with scratch_app(overrides, service == "renderer") as (base, bucket):
            assert httpx.get(f"{base}/s/{COMPOSER}", timeout=HTTP_TIMEOUT).status_code == 200
            assert score(base)["title"] == TITLE
            if service == "storage":
                name = bank_name("wav")
                err(upload(base, name, wav_bytes()), 503, "storage_unavailable", ERR_STORAGE)
                assert not bank_keys(name) and not banks_named(app_url, name)
                relay.up()
                again = bank_name("wav")
                poll(lambda: upload(base, again, wav_bytes()).status_code == 201, SLACK_S, "bank upload succeeds once storage returns")
                assert bank_keys(again), "recovered upload has no MinIO object"
            elif service == "broadcast":
                assert sync(base)["live"] is False
                p = team(base=base)
                stamp = stamps(base)
                op = append(base, p, "st-vn2", 2, [note("A", 4)], stamp)[0]
                assert any(key(e["op"]["id"]) == key(op["id"]) for e in ops_after(app_url, score(app_url)["lastSeq"] - 5)), "op not persisted"
                relay.up()
                poll(lambda: sync(base)["live"] is True, VALKEY_RETRY_S + SLACK_S, "/sync reports live true after Valkey returns")
            else:
                ok(extract(base, "p-cl"), 202)
                first = poll(lambda: (p := part(base, "p-cl"))["status"] not in ("engraving", "rendering") and p, PDF_WAIT_S, "p-cl leaves rendering")
                assert first["status"] == "pdf_pending" and first["lastError"] == "renderer_unavailable", f"renderer down but part is {first['status']}"
                time_left = int(PDF_RETRY_COPY) + 1
                assert err(call(base, "GET", f"/api/scores/{SCORE}/parts/p-cl/pdf", COPYIST), 409, "pdf_not_ready")["status"] == "pdf_pending", time_left
                relay.up()
                done = poll(lambda: (p := part(base, "p-cl"))["status"] == "ready" and p, int(PDF_RETRY_COPY) + PDF_WAIT_S, "part ready after the renderer returns")
                assert f"scores/{SCORE}/parts/p-cl/r{done['revision']}/part.pdf" in bucket.keys(f"scores/{SCORE}/parts/p-cl/")
    finally:
        relay.down()


VIEWPORTS = {"desktop": "1280x800", "tablet": "768x1024", "phone": "375x812"}


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_three_viewport_layout(browser: Browser, app_url: str, viewport: str) -> None:
    size = {"desktop": DESKTOP, "tablet": TABLET, "phone": PHONE}[viewport]
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(size)
        wait_workspace(page)
        layout(page)
        for name in ("Extract part…", "Add staff", "Add measures"):
            assert btn(page, name).count() == 1, f"top rail lacks {name}"
        helix = page.get_by_role("radio", name="Helix", exact=True)
        strip = page.get_by_role("region", name="System strip", exact=True)
        if viewport == "phone":
            assert helix.count() == 0, "Helix offered below 768 px"
            eventually(page, strip.is_visible, "System strip shown at 375 px")
            assert style(strip, "overflow-x")["overflow-x"] in ("auto", "scroll")
            pad = page.get_by_role("toolbar", name="Note pad", exact=True)
            for name in ("C", "D", "E", "F", "G", "A", "B", "Rest", "Shorter", "Longer", "Delete", "Add text"):
                box = pad.get_by_role("button", name=name, exact=True).bounding_box()
                assert box and box["width"] >= TOUCH_TARGET - 0.5 and box["height"] >= TOUCH_TARGET - 0.5, f"{name} below 44 px"
        else:
            assert helix.count() == 1 and strip.count() == 0
        if viewport == "desktop":
            tools = page.get_by_role("complementary", name="Score tools", exact=True)
            box = tools.bounding_box()
            assert box and box["x"] > size["width"] / 2, "tools rail is not on the right"
            btn(page, "Hide tools").click()
            eventually(page, lambda: btn(page, "Show tools").count() == 1 and (tools.bounding_box() or {"width": 0})["width"] < box["width"], "Hide tools collapses the rail")
            layout(page)


DIALOGS = [("Add measures", "Add measures", "spinbutton", "Measures to add"), ("Add staff", "Add staff", "textbox", "Staff name"), ("Extract part…", "Extract part", "combobox", "Part")]


def test_dialog_focus_wrap_escape_return(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        for opener_name, dialog_name, role, first in DIALOGS:
            opener = btn(page, opener_name)
            opener.focus()
            press(page, "Enter")
            dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
            field = dialog.get_by_role(role, name=first, exact=True)
            eventually(page, lambda: field.evaluate("e => e === document.activeElement"), f"{dialog_name} opens on {first}")
            for keys in ["Tab"] * 9 + ["Shift+Tab"] * 9:
                press(page, keys)
                assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{keys} left the {dialog_name} dialog"
            press(page, "Escape")
            eventually(page, lambda: dialog.count() == 0 or not dialog.is_visible(), f"Escape closes {dialog_name}")
            eventually(page, lambda: opener.evaluate("e => e === document.activeElement"), f"focus returns to {opener_name}")
        rest_style, focus_style = state_styles(btn(page, "Add staff"), "outline-style", "outline-width", "box-shadow", state="focus")
        assert rest_style != focus_style, "keyboard focus shows no ring"
        btn(page, "Hide tools").focus()
        press(page, "Shift+E")
        eventually(page, page.get_by_role("dialog", name="Extract part", exact=True).is_visible, "Shift+E with focus on a button opens Extract part")


def open_helix(page: Page) -> Any:
    page.set_viewport_size(DESKTOP)
    wait_workspace(page)
    page.get_by_role("radio", name="Helix", exact=True).click()
    canvas = page.get_by_role("img", name=f"Helix view of {TITLE}", exact=True)
    eventually(page, canvas.is_visible, "Helix canvas shown")
    return canvas


def test_helix_idle_turn(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        canvas = open_helix(page)
        assert page.get_by_role("group", name=re.compile(r"^System 1, measures 1–\d+$")).count() == 1
        frames = scene_frames(canvas, steps=6, step_ms=500)
        assert all(f["draws"] > 0 for f in frames), "Helix frames issued no draws"
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) > 0, "Helix did not turn"
        seconds = (frames[-1]["t"] - frames[0]["t"]) / 1000
        assert seconds > 0
        rate = max_rotation(frames[0]["matrices"], frames[-1]["matrices"]) / seconds
        assert round(rate, 2) == IDLE_RATE, f"idle turn {rate:.4f} rad/s; expected {IDLE_RATE}"


def test_helix_drag_and_reduced_motion(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER, reduced_motion="reduce") as page:
        canvas = open_helix(page)
        frames = scene_frames(canvas, steps=4, step_ms=500)
        assert round(max_rotation(frames[0]["matrices"], frames[-1]["matrices"]), 2) == 0, "Helix turns under reduced motion"
        before = camera(page)
        box = canvas.bounding_box()
        assert box
        y = box["y"] + box["height"] / 2
        page.mouse.move(box["x"] + box["width"] / 3, y)
        page.mouse.down()
        page.mouse.move(box["x"] + 2 * box["width"] / 3, y, steps=8)
        page.mouse.up()
        advance(page, STEP_MS)
        assert max_rotation(before, camera(page)) > 0, "dragging did not turn the Helix"


def test_helix_without_webgl(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER, no_webgl=True) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        expect_text = "3D view unavailable — showing pages."
        eventually(page, lambda: text(status(page, "View")) == expect_text, "View notice")
        helix = page.get_by_role("radio", name="Helix", exact=True)
        assert helix.is_disabled() or helix.get_attribute("aria-disabled") == "true"
        assert page.get_by_role("radio", name="Pages", exact=True).is_checked()
        eventually(page, page.get_by_role("group", name=re.compile(r"^System 1, measures 1–\d+$")).is_visible, "pages show systems")


def test_seat_links(browser: Browser, app_url: str, team: Callable[..., dict]) -> None:
    for token, role in ((COMPOSER, "composer"), (COPYIST, "copyist"), (OBOIST, "player")):
        me = ok(call(app_url, "GET", "/api/me", token))
        assert me["collaborator"]["role"] == role and me["score"]["id"] == SCORE and me["score"]["title"] == TITLE
    err(call(app_url, "GET", "/api/me", JUNK_TOKEN), 401, "unauthorized", ERR_UNAUTHORIZED)
    with open_seat(browser, app_url, COMPOSER) as page:
        wait_workspace(page)
        assert f"/score/{SCORE}" in page.url
    with open_seat(browser, app_url, OBOIST) as page:
        eventually(page, part_region(page, OBOE).is_visible, "section player lands on their part")
        assert f"/score/{SCORE}" in page.url
    gone = team()
    ok(call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/{gone['id']}", COMPOSER))
    for token in (JUNK_TOKEN, gone["token"]):
        with open_seat(browser, app_url, token) as page:
            heading = page.get_by_role("heading", name="Seat link not valid", exact=True)
            eventually(page, heading.is_visible, "Seat link not valid heading")
            eventually(page, lambda: "This seat link is not valid. Ask the composer for a new one." in (page.content() or ""), "Seat link not valid line")


def test_invite_collaborator(app_url: str) -> None:
    created: list[str] = []
    path = f"/api/scores/{SCORE}/invites"
    try:
        name = fresh("Copyist")
        body = ok(call(app_url, "POST", path, COMPOSER, {"name": name, "role": "copyist", "staffIds": []}), 201)
        created.append(body["collaborator"]["id"])
        assert body["collaborator"]["status"] == "invited" and body["collaborator"]["role"] == "copyist"
        assert body["inviteUrl"] == f"/i/{body['inviteToken']}"
        inv = ok(call(app_url, "GET", f"/api/invites/{body['inviteToken']}"))["invite"]
        assert inv == {**inv, "name": name, "role": "copyist", "status": "invited", "scoreTitle": TITLE}
        player = ok(call(app_url, "POST", path, COMPOSER, {"name": fresh("Player"), "role": "player", "staffIds": ["st-va"]}), 201)
        created.append(player["collaborator"]["id"])
        assert player["collaborator"]["staffIds"] == ["st-va"]
        family = "👨‍👩‍👧"
        emoji = ok(call(app_url, "POST", path, COMPOSER, {"name": family * INVITE_NAME_MAX, "role": "player", "staffIds": ["st-va"]}), 201)
        created.append(emoji["collaborator"]["id"])
        refused = fresh("Refused")
        field_err(call(app_url, "POST", path, COMPOSER, {"name": family * (INVITE_NAME_MAX + 1), "role": "player", "staffIds": []}), "name")
        field_err(call(app_url, "POST", path, COMPOSER, {"name": "   ", "role": "player", "staffIds": []}), "name")
        field_err(call(app_url, "POST", path, COMPOSER, {"name": refused, "role": "composer", "staffIds": []}), "role")
        field_err(call(app_url, "POST", path, COMPOSER, {"name": refused, "role": "player", "staffIds": ["st-nowhere"]}), "staffIds", "Unknown staff.")
        err(call(app_url, "POST", path, COPYIST, {"name": refused, "role": "player", "staffIds": []}), 403, "forbidden", ERR_ROLE)
        err(call(app_url, "POST", path, OBOIST, {"name": refused, "role": "player", "staffIds": []}), 403, "forbidden", ERR_ROLE)
        people = ok(call(app_url, "GET", f"/api/scores/{SCORE}/collaborators", COMPOSER))["collaborators"]
        assert all(p["name"] != refused for p in people), "a refused invite created a collaborator"
    finally:
        for cid in created:
            call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/{cid}", COMPOSER)


def test_accept_exactly_once(app_url: str) -> None:
    name = fresh("Racer")
    inv = ok(call(app_url, "POST", f"/api/scores/{SCORE}/invites", COMPOSER, {"name": name, "role": "player", "staffIds": ["st-va"]}), 201)
    cid = inv["collaborator"]["id"]
    try:
        results = race(6, lambda _: call(app_url, "POST", f"/api/invites/{inv['inviteToken']}/accept", None, {}))
        winners = [r for r in results if r.status_code == 200]
        assert len(winners) == 1, f"accept statuses {[r.status_code for r in results]}; expected exactly one 200"
        for r in results:
            if r.status_code != 200:
                err(r, 409, "invite_used", "This invite has already been used.")
        token = winners[0].json()["seatToken"]
        me = ok(call(app_url, "GET", "/api/me", token))["collaborator"]
        assert me["id"] == cid and me["status"] == "active"
        err(call(app_url, "POST", f"/api/invites/{inv['inviteToken']}/accept", None, {}), 409, "invite_used")
        people = [p for p in ok(call(app_url, "GET", f"/api/scores/{SCORE}/collaborators", COMPOSER))["collaborators"] if p["name"] == name]
        assert len(people) == 1 and people[0]["status"] == "active"
    finally:
        call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/{cid}", COMPOSER)
    gone = ok(call(app_url, "POST", f"/api/scores/{SCORE}/invites", COMPOSER, {"name": fresh("Withdrawn"), "role": "player", "staffIds": []}), 201)
    ok(call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/{gone['collaborator']['id']}", COMPOSER))
    err(call(app_url, "POST", f"/api/invites/{gone['inviteToken']}/accept", None, {}), 410, "invite_revoked", "This invite was withdrawn.")


def test_remove_collaborator(app_url: str, team: Callable[..., dict], valkey: Valkey) -> None:
    p = team()
    sock = live(app_url, p["token"])
    sock.heartbeat({"staffId": "st-tp", "measure": 1, "beat": 1}, 0)
    ok(hold(app_url, p["token"], sock.connection_id, ["st-tp"]), 201)
    poll(lambda: p["id"] in presence_ids(app_url), SLACK_S, "presence lists the collaborator")
    err(call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/{p['id']}", COPYIST), 403, "forbidden", ERR_ROLE)
    body = ok(call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/{p['id']}", COMPOSER))
    assert body["collaborator"]["status"] == "removed"
    sock.wait(lambda m: m.get("type") == "removed", REMOVAL_S + 1, "removed message")
    sock.wait_closed(REMOVAL_S + 1, "closed after removal")
    poll(lambda: call(app_url, "GET", "/api/me", p["token"]).status_code == 401, REMOVAL_S + 1, "removed seat token answers 401")
    poll(lambda: holds(app_url).get("st-tp") != p["id"], REMOVAL_S + 1, "removed collaborator's hold released")
    poll(lambda: p["id"] not in presence_ids(app_url), REMOVAL_S + 1, "presence entry dropped")
    assert p["id"] not in valkey.hash(f"fairline:presence:{SCORE}")
    assert Live(app_url, p["token"]).status == 401
    err(call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/{p['id']}", COMPOSER), 409, "already_removed", f"{p['name']} was already removed.")
    err(call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/c-mara", COMPOSER), 409, "cannot_remove_composer", "The composer cannot be removed.")
    poll(no_open_app_sessions, SLACK_S, "no app session active or idle in transaction")
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).status_code == 200


def test_role_permissions(app_url: str, team: Callable[..., dict]) -> None:
    player = team("player", ["st-hp-r"])
    stamp = stamps(app_url)
    append(app_url, player, "st-hp-r", 1, [note("C", 5)], stamp)
    foreign = insert(next(stamp), player["id"], "st-fl", 1, tail(app_url, "st-fl", 1), note("D", 5))
    err(post_ops(app_url, player["token"], [foreign]), 403, "forbidden", ERR_OWN_STAVES)
    assert not any(key(e["op"]["id"]) == key(foreign["id"]) for e in ops_after(app_url, score(app_url)["lastSeq"] - 5))
    sock = live(app_url, player["token"])
    try:
        err(hold(app_url, player["token"], sock.connection_id, ["st-fl"]), 403, "forbidden", ERR_OWN_STAVES)
        ok(hold(app_url, player["token"], sock.connection_id, ["st-hp-r"]), 201)
        refusals = [
            (player, "PATCH", "/staves/st-hp-r", {"name": "x"}),
            (player, "PUT", "/parts/p-hp/layout", {"systemBreaks": [], "pageBreaks": []}),
            (player, "POST", "/parts/p-fl/extract", {}),
            (player, "POST", "/parts/p-hp/extract", {}),
            (player, "POST", "/staves", {"name": "x", "clef": "treble", "transpose": {"diatonic": 0, "chromatic": 0}, "partId": None, "afterStaffId": None}),
            (player, "POST", "/measures", {"count": 1}),
            (player, "DELETE", "/collaborators/c-jun", None),
            ({"token": COPYIST}, "POST", "/staves", {"name": "x", "clef": "treble", "transpose": {"diatonic": 0, "chromatic": 0}, "partId": None, "afterStaffId": None}),
            ({"token": COPYIST}, "POST", "/measures", {"count": 1}),
            ({"token": COPYIST}, "PATCH", f"/collaborators/{player['id']}", {"staffIds": ["st-fl"]}),
        ]
        for who, method, path, body in refusals:
            r = call(app_url, method, f"/api/scores/{SCORE}{path}", who["token"], body)
            assert r.status_code == 403, f"{method} {path} as {who.get('role', 'copyist')} answered {r.status_code}; expected 403"
            assert r.json().get("error") == "forbidden"
        for token in (player["token"], COPYIST):
            err(upload(app_url, bank_name("wav"), wav_bytes(), token=token), 403, "forbidden")
        for path in ("", "/history", "/parts", "/banks", "/presence", "/holds"):
            assert call(app_url, "GET", f"/api/scores/{SCORE}{path}", player["token"]).status_code == 200, f"player cannot read {path}"
        pending = ok(call(app_url, "POST", f"/api/scores/{SCORE}/invites", COMPOSER, {"name": fresh("Pending"), "role": "player", "staffIds": []}), 201)
        try:
            seen_by = lambda tok: {c["id"] for c in ok(call(app_url, "GET", f"/api/scores/{SCORE}/collaborators", tok))["collaborators"]}
            assert pending["collaborator"]["id"] not in seen_by(player["token"]), "players see invited collaborators"
            assert pending["collaborator"]["id"] in seen_by(COPYIST)
        finally:
            call(app_url, "DELETE", f"/api/scores/{SCORE}/collaborators/{pending['collaborator']['id']}", COMPOSER)
    finally:
        sock.close()


@pytest.mark.timeout(600)
def test_wf_team_violist(browser: Browser, app_url: str) -> None:
    name = fresh("Violist")
    with open_seat(browser, app_url, COMPOSER) as pc:
        pc.set_viewport_size(DESKTOP)
        wait_workspace(pc)
        open_tab(pc, "People")
        btn(pc, "Invite collaborator").click()
        dialog = pc.get_by_role("dialog", name="Invite collaborator", exact=True)
        dialog.get_by_role("textbox", name="Name", exact=True).fill(name)
        select(dialog.get_by_role("combobox", name="Role", exact=True), "Section player")
        dialog.get_by_role("listbox", name="Staves they can edit", exact=True).get_by_role("option", name="Viola", exact=True).click()
        dialog.get_by_role("button", name="Create invite", exact=True).click()
        link = dialog.get_by_role("textbox", name="Invite link", exact=True)
        eventually(pc, lambda: "/i/" in link.input_value(), "Invite link shown")
        path = urlsplit(link.input_value()).path
        eventually(pc, lambda: text(status(pc, "Team")) == f"Invite created for {name}.", "Team announces the invite")
        dialog.get_by_role("button", name="Done", exact=True).click()
        tokens: list[str] = []
        with open_app(browser, app_url + path) as pv:
            pv.on("request", lambda req: tokens.append(req.headers["authorization"][7:]) if req.headers.get("authorization", "").startswith("Bearer ") else None)
            eventually(pv, pv.get_by_role("heading", name=f"Join {TITLE}", exact=True).is_visible, "Join heading")
            btn(pv, f"Join as {name}").click()
            eventually(pv, lambda: part_region(pv, VIOLA).is_visible() or pv.get_by_role("heading", level=1, name=TITLE, exact=True).is_visible(), "violist lands in their score")
            eventually(pc, lambda: text(status(pc, "Team")) == f"{name} joined.", "Team announces the join")
            people = pc.get_by_role("list", name="People", exact=True)
            eventually(pc, lambda: any(f"{name} · Section player · Active" in text(i) for i in people.get_by_role("listitem").all()), "People lists the violist as Active")
            token = eventually(pv, lambda: tokens and tokens[-1], "violist API calls carry a seat token")
            if btn(pv, "Back to score").count():
                btn(pv, "Back to score").click()
            wait_workspace(pv)
            choose_entry(pv, "Viola", 1)
            press(pv, "End")
            before = voice(app_url, "st-va", 1)
            press(pv, "c")
            new_events(pv, app_url, "st-va", 1, before, 1)
            stamp = stamps(app_url)
            me = ok(call(app_url, "GET", "/api/me", token))["collaborator"]
            err(post_ops(app_url, token, [insert(next(stamp), me["id"], "st-vc", 1, tail(app_url, "st-vc", 1), note("C", 3))]), 403, "forbidden", ERR_OWN_STAVES)
            btn(pc, f"Remove {name}").click()
            alert = pc.get_by_role("alertdialog", name=f"Remove {name}?", exact=True)
            assert "They lose access at once and their holds are released." in text(alert)
            alert.get_by_role("button", name="Remove", exact=True).click()
            eventually(pc, lambda: text(status(pc, "Team")) == f"{name} removed.", "Team announces the removal")
            poll(lambda: call(app_url, "GET", "/api/me", token).status_code == 401, REMOVAL_S + 1, "violist link stops working")
            gone = [c for c in ok(call(app_url, "GET", f"/api/scores/{SCORE}/collaborators", COMPOSER))["collaborators"] if c["id"] == me["id"]]
            assert gone and gone[0]["status"] == "removed"


def test_wf_team_withdrawn_invite(browser: Browser, app_url: str) -> None:
    name = fresh("Withdrawn")
    with open_seat(browser, app_url, COMPOSER) as pc:
        pc.set_viewport_size(DESKTOP)
        wait_workspace(pc)
        open_tab(pc, "People")
        btn(pc, "Invite collaborator").click()
        dialog = pc.get_by_role("dialog", name="Invite collaborator", exact=True)
        select(dialog.get_by_role("combobox", name="Role", exact=True), "Copyist")
        dialog.get_by_role("button", name="Create invite", exact=True).click()
        summary = dialog.get_by_role("alert")
        eventually(pc, lambda: "There is a problem" in text(summary), "error summary shown")
        summary.get_by_role("link").first.click()
        field = dialog.get_by_role("textbox", name="Name", exact=True)
        eventually(pc, lambda: field.evaluate("e => e === document.activeElement"), "summary link focuses Name")
        field.fill(name)
        dialog.get_by_role("button", name="Create invite", exact=True).click()
        link = dialog.get_by_role("textbox", name="Invite link", exact=True)
        eventually(pc, lambda: "/i/" in link.input_value(), "invite created")
        path = urlsplit(link.input_value()).path
        dialog.get_by_role("button", name="Done", exact=True).click()
        btn(pc, f"Remove {name}").click()
        pc.get_by_role("alertdialog", name=f"Remove {name}?", exact=True).get_by_role("button", name="Remove", exact=True).click()
        eventually(pc, lambda: text(status(pc, "Team")) == f"{name} removed.", "removal announced")
    err(call(app_url, "POST", f"/api/invites/{path.rsplit('/', 1)[-1]}/accept", None, {}), 410, "invite_revoked")
    with open_app(browser, app_url + path) as pv:
        pv.clock.set_system_time(SKEWED)
        eventually(pv, lambda: "This invite was withdrawn." in (pv.content() or ""), "Join page shows the API message")
        assert btn(pv, f"Join as {name}").count() == 0


def short_url() -> str:
    return outage("APP_SHORT_URL")


def new_staff(name: str, part_id: str | None = None, after: str | None = None, clef: str = "treble") -> dict:
    return {"name": name, "clef": clef, "transpose": {"diatonic": 0, "chromatic": 0}, "partId": part_id, "afterStaffId": after}


def fill_staves(base: str) -> None:
    for _ in range(STAFF_CAP):
        if len(score(base)["staves"]) >= STAFF_CAP:
            return
        ok(call(base, "POST", f"/api/scores/{SCORE}/staves", COMPOSER, new_staff(fresh("Cap"))), 201)


def fill_measures(base: str) -> None:
    m = score(base)["measureCount"]
    if m < MEASURE_CAP:
        ok(call(base, "POST", f"/api/scores/{SCORE}/measures", COMPOSER, {"count": MEASURE_CAP - m, "timeSignature": {"beats": 1, "beatType": 16}}))


def test_staff_cap() -> None:
    base = short_url()
    path = f"/api/scores/{SCORE}/staves"
    if len(score(base)["staves"]) <= STAFF_CAP - 2:
        field_err(call(base, "POST", path, COMPOSER, new_staff("x" * (STAFF_NAME_MAX + 1))), "name")
        field_err(call(base, "POST", path, COMPOSER, {**new_staff("ok"), "clef": "soprano"}), "clef")
        field_err(call(base, "POST", path, COMPOSER, new_staff("ok", part_id="p-nowhere")), "partId", "Unknown part.")
        field_err(call(base, "POST", path, COMPOSER, new_staff("ok", after="st-nowhere")), "afterStaffId", "Unknown staff.")
        body = ok(call(base, "POST", path, COMPOSER, {**new_staff("🎻" * STAFF_NAME_MAX), "transpose": {"diatonic": -1, "chromatic": -2}}), 201)
        assert body["part"]["name"] == body["staff"]["name"] and body["part"]["staffIds"] == [body["staff"]["id"]]
        assert body["staff"]["transpose"] == {"diatonic": -1, "chromatic": -2}
        second = ok(call(base, "POST", path, COMPOSER, new_staff(fresh("Second"), part_id=body["part"]["id"], after="st-fl", clef="bass")), 201)
        assert set(second["part"]["staffIds"]) == {body["staff"]["id"], second["staff"]["id"]}
        order = [s["id"] for s in sorted(score(base)["staves"], key=lambda s: s["order"])]
        assert order[order.index("st-fl") + 1] == second["staff"]["id"], "afterStaffId placement ignored"
    for _ in range(STAFF_CAP):
        n = len(score(base)["staves"])
        if n >= STAFF_CAP:
            break
        ok(call(base, "POST", path, COMPOSER, new_staff(fresh("Cap"))), 201)
    before = score(base)
    assert len(before["staves"]) == STAFF_CAP
    refused = fresh("Over")
    field_err(call(base, "POST", path, COMPOSER, new_staff(refused)), "staves", "A score holds at most 64 staves.")
    after = score(base)
    assert [s["id"] for s in after["staves"]] == [s["id"] for s in before["staves"]] and after["parts"] == before["parts"]


def test_measure_cap_append() -> None:
    base = short_url()
    path = f"/api/scores/{SCORE}/measures"
    field_err(call(base, "POST", path, COMPOSER, {"count": 0}), "count")
    field_err(call(base, "POST", path, COMPOSER, {"count": MEASURE_CAP + 1}), "count")
    field_err(call(base, "POST", path, COMPOSER, {"count": 1, "timeSignature": {"beats": 3, "beatType": 3}}), "timeSignature")
    m = score(base)["measureCount"]
    if m <= MEASURE_CAP - 2:
        body = ok(call(base, "POST", path, COMPOSER, {"count": 2, "timeSignature": {"beats": 2, "beatType": 4}}))
        assert body["measureCount"] == m + 2
        assert {"measure": m + 1, "beats": 2, "beatType": 4} in body["timeSignatures"]
    fill_measures(base)
    before = score(base)
    assert before["measureCount"] == MEASURE_CAP
    for n in (1, 5):
        field_err(call(base, "POST", path, COMPOSER, {"count": n}), "measures", "A score holds at most 2,000 measures.")
    after = score(base)
    assert after["measureCount"] == MEASURE_CAP and after["timeSignatures"] == before["timeSignatures"]


@pytest.mark.timeout(900)
def test_note_entry_extends_score(app_url: str, team: Callable[..., dict]) -> None:
    s = score(app_url)
    stamp = stamps(app_url)
    remaining = score_ticks(s) - sum(e["ticks"] for e in voice(app_url, "st-timp", 2))
    send_chain(app_url, team, "st-timp", 2, fill_events(remaining), stamp)
    assert score(app_url)["measureCount"] == s["measureCount"], "filling exactly to the end grew the score"
    send_chain(app_url, team, "st-timp", 2, [rest("quarter")], stamp)
    last = measure_info(s)(s["measureCount"])[0]
    grown = score(app_url)
    assert grown["measureCount"] == s["measureCount"] + -(-TICKS["quarter"] // last)
    assert grown["timeSignatures"] == s["timeSignatures"]
    overflow = voice(app_url, "st-timp", 2)[-1]
    assert sum(pc["ticks"] for pc in overflow["pieces"]) == overflow["ticks"]
    assert overflow["pieces"][-1]["measure"] == grown["measureCount"]
    base = short_url()
    fill_measures(base)
    cap = score(base)
    stamp = stamps(base)
    make = lambda: team(base=base)
    remaining = score_ticks(cap) - sum(e["ticks"] for e in voice(base, "st-timp", 2))
    send_chain(base, make, "st-timp", 2, fill_events(remaining), stamp)
    assert score(base)["measureCount"] == MEASURE_CAP
    before = voice(base, "st-timp", 2)
    p = make()
    over = insert(next(stamp), p["id"], "st-timp", 2, before[-1]["id"], rest("32nd"))
    field_err(post_ops(base, p["token"], [over]), "measures", "A score holds at most 2,000 measures.")
    assert len(voice(base, "st-timp", 2)) == len(before) and score(base)["measureCount"] == MEASURE_CAP


def test_staff_settings_need_hold(app_url: str, team: Callable[..., dict]) -> None:
    a, b = team(), team()
    la, lb = live(app_url, a["token"]), live(app_url, b["token"])
    path = f"/api/scores/{SCORE}/staves/st-hn"
    try:
        err(call(app_url, "PATCH", path, a["token"], {"name": "Horn x"}), 409, "hold_required", "Hold this staff before changing it.")
        results = race(2, lambda i: hold(app_url, (a, b)[i]["token"], (la, lb)[i].connection_id, ["st-hn"]))
        assert sorted(r.status_code for r in results) == [201, 423], f"hold race {[r.status_code for r in results]}"
        win, lose = (a, b) if results[0].status_code == 201 else (b, a)
        body = err(results[[a, b].index(lose)], 423, "staff_held", f"{win['name']} is holding Horn in F.")
        assert body["heldBy"]["id"] == win["id"] and body["staffIds"] == ["st-hn"]
        err(call(app_url, "PATCH", path, lose["token"], {"name": "Horn x"}), 423, "staff_held")
        err(call(app_url, "PATCH", path, COMPOSER, {"name": "Horn x"}), 423, "staff_held")
        field_err(call(app_url, "PATCH", path, win["token"], {"clef": "soprano"}), "clef")
        renamed = fresh("Horn")
        assert ok(call(app_url, "PATCH", path, win["token"], {"name": renamed}))["staff"]["name"] == renamed
        assert next(s for s in score(app_url)["staves"] if s["id"] == "st-hn")["name"] == renamed
    finally:
        for person in (a, b):
            call(app_url, "PATCH", path, person["token"], {"name": "Horn in F"})
        la.close()
        lb.close()
    assert next(s for s in score(app_url)["staves"] if s["id"] == "st-hn")["name"] == "Horn in F"


@pytest.mark.timeout(600)
def test_wf_score_growth_add_staff(browser: Browser, app_url: str) -> None:
    name, renamed = fresh("Clarinet 2"), fresh("Clarinet II")
    with open_seat(browser, app_url, COMPOSER) as pc, open_seat(browser, app_url, COPYIST) as pj:
        for page in (pc, pj):
            page.set_viewport_size(DESKTOP)
            wait_workspace(page)
        pj.get_by_role("radio", name="Pages", exact=True).click()
        btn(pc, "Add staff").focus()
        press(pc, "Enter")
        dialog = pc.get_by_role("dialog", name="Add staff", exact=True)
        dialog.get_by_role("textbox", name="Staff name", exact=True).fill(name)
        select(dialog.get_by_role("combobox", name="Clef", exact=True), "Treble")
        select(dialog.get_by_role("combobox", name="Transposition", exact=True), "B♭ (sounds a major second lower)")
        select(dialog.get_by_role("combobox", name="Part", exact=True), "New part")
        dialog.get_by_role("button", name="Create staff", exact=True).focus()
        press(pc, "Enter")
        eventually(pc, lambda: text(status(pc, "Score changes")) == f"{name} added.", "Score changes announces the staff")
        staff = next(s for s in score(app_url)["staves"] if s["name"] == name)
        assert staff["clef"] == "treble" and staff["transpose"] == {"diatonic": -1, "chromatic": -2}
        assert any(p["name"] == name and p["staffIds"] == [staff["id"]] for p in score(app_url)["parts"])
        eventually(pj, pj.get_by_role("listbox", name="Staves", exact=True).get_by_role("option", name=name, exact=True).is_visible, "copyist sees the new staff")
        select_only(pc, [name])
        press(pc, "Shift+H")
        eventually(pc, lambda: text(status(pc, "Holds")) == f"Holding {name}.", "Holds announces the hold")
        open_tab(pc, "Holds")
        btn(pc, "Staff settings").focus()
        press(pc, "Enter")
        settings = pc.get_by_role("dialog", name="Staff settings", exact=True)
        settings.get_by_role("textbox", name="Staff name", exact=True).fill(renamed)
        settings.get_by_role("button", name="Save staff", exact=True).focus()
        press(pc, "Enter")
        eventually(pc, lambda: text(status(pc, "Score changes")) == f"{renamed} saved.", "staff saved")
        n = score(app_url)["measureCount"] + 8
        btn(pc, "Add measures").focus()
        press(pc, "Enter")
        add = pc.get_by_role("dialog", name="Add measures", exact=True)
        add.get_by_role("spinbutton", name="Measures to add", exact=True).fill("8")
        select(add.get_by_role("combobox", name="Time signature", exact=True), "3/4")
        add.get_by_role("button", name="Append", exact=True).focus()
        press(pc, "Enter")
        eventually(pc, lambda: text(status(pc, "Score changes")) == f"8 measures added. The score now has {n} measures.", "append announced")
        s = score(app_url)
        assert s["measureCount"] == n and measure_info(s)(n) == (3 * WHOLE // 4, 4)
        assert next(x for x in s["staves"] if x["id"] == staff["id"])["name"] == renamed
        eventually(pj, pj.get_by_role("listbox", name="Staves", exact=True).get_by_role("option", name=renamed, exact=True).is_visible, "copyist sees the rename")
        eventually(pj, lambda: pj.get_by_role("group", name=re.compile(rf"^System \d+, measures \d+–{n}$")).count() == 1, "copyist's pages end at the new measure count")


def test_wf_score_growth_invalid_staff_name(browser: Browser, app_url: str) -> None:
    before = [s["id"] for s in score(app_url)["staves"]]
    with open_seat(browser, app_url, COMPOSER) as pc:
        pc.set_viewport_size(DESKTOP)
        wait_workspace(pc)
        btn(pc, "Add staff").click()
        dialog = pc.get_by_role("dialog", name="Add staff", exact=True)
        field = dialog.get_by_role("textbox", name="Staff name", exact=True)
        field.fill("x" * (STAFF_NAME_MAX + 1))
        dialog.get_by_role("button", name="Create staff", exact=True).click()
        summary = dialog.get_by_role("alert")
        eventually(pc, lambda: "There is a problem" in text(summary), "error summary shown")
        summary.get_by_role("link").first.click()
        eventually(pc, lambda: field.evaluate("e => e === document.activeElement"), "summary link focuses Staff name")
        dialog.get_by_role("button", name="Cancel", exact=True).click()
    assert [s["id"] for s in score(app_url)["staves"]] == before


def test_pitch_and_duration_keys(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        choose_entry(page, "Flute", 2)
        press(page, "End")
        before = voice(app_url, "st-fl", 2)
        c_oct = nearest_octave("C", previous_note(before, "treble"))
        e_oct = nearest_octave("E", ("C", c_oct))
        d_oct = nearest_octave("D", ("E", e_oct))
        for k in ("5", "c", "4", ".", "e", ".", "r", "Shift+C", "D"):
            press(page, k)
        new = new_events(page, app_url, "st-fl", 2, before, 4)
        advance(page, 1000)
        new = [e for e in voice(app_url, "st-fl", 2) if key(e["id"]) not in {key(b["id"]) for b in before}]
        got = [(e["kind"], e["pitch"] and (e["pitch"]["step"], e["pitch"]["alter"], e["pitch"]["octave"]), e["duration"], e["dots"]) for e in new]
        assert got == [("note", ("C", 0, c_oct), "quarter", 0), ("note", ("E", 0, e_oct), "eighth", 1), ("rest", None, "eighth", 0), ("note", ("D", 0, d_oct), "eighth", 0)], got


def test_transpose_and_respell_keys(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        choose_entry(page, "Cello", 2)
        press(page, "End")
        before = voice(app_url, "st-vc", 2)
        start_seq = score(app_url)["lastSeq"]
        press(page, "b")
        ev = new_events(page, app_url, "st-vc", 2, before, 1)[0]
        assert ev["pitch"]["octave"] == nearest_octave("B", previous_note(before, "bass"))
        current = ev["pitch"]
        expected = []
        for k in ("ArrowUp", "ArrowUp", "j", "j", "j", "Control+ArrowUp", "ArrowDown", "Control+ArrowDown"):
            if k in ("ArrowUp", "ArrowDown"):
                current = semitone(current, k == "ArrowUp")
            elif k == "j":
                current = respell(current)
            else:
                current = {**current, "octave": current["octave"] + (1 if k.endswith("Up") else -1)}
            expected.append(current)
            press(page, k)
            want = dict(current)
            eventually(page, lambda: next(e for e in voice(app_url, "st-vc", 2) if key(e["id"]) == key(ev["id"]))["pitch"] == want, f"{k} saves {pitch_text(want)}")
        sets = [e["op"]["value"] for e in ops_after(app_url, start_seq)
                if e["op"]["type"] == "set" and e["op"]["field"] == "pitch" and key(e["op"]["target"]) == key(ev["id"])]
        assert sets == expected, f"pitch sets {sets}; expected {expected}"


def test_barline_split_pieces(app_url: str, team: Callable[..., dict]) -> None:
    p = team()
    stamp = stamps(app_url)
    start = sum(e["ticks"] for e in voice(app_url, "st-db", 2))
    before = voice(app_url, "st-db", 2)
    append(app_url, p, "st-db", 2, [note("E", 2, duration="whole", dots=2), rest("half", 1)], stamp)
    info = measure_info(score(app_url))
    events = voice(app_url, "st-db", 2)
    new = events[len(before):]
    assert len(new) == 2
    pos = start
    for ev, length in zip(new, (ticks("whole", 2), ticks("half", 1))):
        exp = split(pos, length, info)
        assert ev["ticks"] == length
        assert [(pc["measure"], pc["ticks"]) for pc in ev["pieces"]] == [(m, t) for m, _, t in exp]
        assert all(abs(pc["beat"] - b) < 1e-6 for pc, (_, b, _) in zip(ev["pieces"], exp))
        assert ev["measure"] == exp[0][0] and abs(ev["beat"] - exp[0][1]) < 1e-6
        pos += length
    assert len(new[0]["pieces"]) >= 2, "a 3,360-tick note crossed no barline"
    per: dict[int, int] = defaultdict(int)
    for e in events:
        for pc in e["pieces"]:
            per[pc["measure"]] += pc["ticks"]
    over = {m: t for m, t in per.items() if t > info(m)[0]}
    assert not over, f"measures over their time signature: {over}"
    written = voice(app_url, "st-db", 2, pitch="written")[len(before)]
    assert written["pitch"] == {"step": "E", "alter": 0, "octave": 3}


def test_entry_announcements(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        choose_entry(page, "Harp (right hand)", 2)
        press(page, "End")
        for k, copy in (("6", "Half selected."), (".", "Dot on."), (".", "Dot off."), ("7", "Whole selected."), (".", "Dot on.")):
            press(page, k)
            expect_entry(page, copy)
        before = voice(app_url, "st-hp-r", 2)
        press(page, "e")
        ev = new_events(page, app_url, "st-hp-r", 2, before, 1)[0]
        assert len(ev["pieces"]) > 1
        expect_entry(page, entry_copy(ev))
        up = semitone(ev["pitch"], True)
        press(page, "ArrowUp")
        expect_entry(page, f"Now {pitch_text(up)}.")
        press(page, "j")
        expect_entry(page, f"Respelled as {pitch_text(respell(up))}.")
        for k, copy in (("t", "Tie added."), ("t", "Tie removed."), ("Shift+D", "Dynamic pp."), ("Shift+F", "Dynamic above the staff.")):
            press(page, k)
            expect_entry(page, copy)
        mid = voice(app_url, "st-hp-r", 2)
        press(page, "r")
        r = new_events(page, app_url, "st-hp-r", 2, mid, 1)[0]
        expect_entry(page, entry_copy(r))
        press(page, "Backspace")
        expect_entry(page, "Deleted dotted whole rest.")


@pytest.mark.timeout(600)
def test_wf_note_entry_keyboard_phrase(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        choose_entry(page, "Oboe", 2)
        press(page, "End")
        press(page, "5")
        for letter in ("e", "f", "g"):
            before = voice(app_url, "st-ob", 2)
            press(page, letter)
            expect_entry(page, entry_copy(new_events(page, app_url, "st-ob", 2, before, 1)[0]))
        press(page, "7")
        press(page, ".")
        before = voice(app_url, "st-ob", 2)
        press(page, "a")
        last = new_events(page, app_url, "st-ob", 2, before, 1)[0]
        assert len(last["pieces"]) > 1
        expect_entry(page, entry_copy(last))
        assert text(status(page, "Entry")).endswith(f" Tied across the barline into measure {last['pieces'][-1]['measure']}.")
        up = semitone(last["pitch"], True)
        press(page, "ArrowUp")
        expect_entry(page, f"Now {pitch_text(up)}.")
        spelled = respell(up)
        press(page, "j")
        expect_entry(page, f"Respelled as {pitch_text(spelled)}.")
        eventually(page, lambda: voice(app_url, "st-ob", 2)[-1]["pitch"] == spelled, "respelling saved")


def test_wf_note_entry_note_pad(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(PHONE)
        wait_workspace(page)
        choose_entry(page, "Viola", 2)
        press(page, "End")
        pad = page.get_by_role("toolbar", name="Note pad", exact=True)
        before = voice(app_url, "st-va", 2)
        tap(pad.get_by_role("button", name="Shorter", exact=True))
        tap(pad.get_by_role("button", name="C", exact=True))
        tap(pad.get_by_role("button", name="Longer", exact=True))
        tap(pad.get_by_role("button", name="E", exact=True))
        tap(pad.get_by_role("button", name="Rest", exact=True))
        new_events(page, app_url, "st-va", 2, before, 3)
        tap(pad.get_by_role("button", name="Delete", exact=True))
        order = ["32nd", "16th", "eighth", "quarter", "half", "whole"]
        new = eventually(page, lambda: (n := voice(app_url, "st-va", 2)[len(before):]) and len(n) == 2 and n, "Delete removed the rest")
        assert [e["kind"] for e in new] == ["note", "note"] and [e["pitch"]["step"] for e in new] == ["C", "E"]
        assert order.index(new[1]["duration"]) == min(order.index(new[0]["duration"]) + 1, len(order) - 1)


def test_operation_batches_and_replay(app_url: str, team: Callable[..., dict]) -> None:
    p = team()
    stamp = stamps(app_url)
    staff = "st-hp-l"
    start = voice(app_url, staff, 2)
    a = insert(next(stamp), p["id"], staff, 2, start[-1]["id"] if start else None, note("G", 4))
    b = insert(next(stamp), p["id"], staff, 2, a["id"], note("A", 4))
    bad = insert(next(stamp), p["id"], staff, 2, eid(10 ** 9, p["id"]), note("B", 4))
    field_err(post_ops(app_url, p["token"], [a, b, bad]), "ops[2].after", "Unknown element.")
    assert len(voice(app_url, staff, 2)) == len(start), "a refused batch was partly applied"
    body = ok(post_ops(app_url, p["token"], [a, b]))
    assert {key(i) for i in body["applied"]} == {key(a["id"]), key(b["id"])} and body["duplicates"] == []
    again = ok(post_ops(app_url, p["token"], [a, b]))
    assert again["applied"] == [] and {key(i) for i in again["duplicates"]} == {key(a["id"]), key(b["id"])}
    assert len(voice(app_url, staff, 2)) == len(start) + 2
    clash = {**a, "event": note("C", 5)}
    msg = f"Operation {a['id']['lamport']}@{p['id']} was already recorded with different content."
    err(post_ops(app_url, p["token"], [clash]), 409, "op_conflict", msg)
    c = insert(next(stamp), p["id"], staff, 2, b["id"], note("C", 5))
    err(post_ops(app_url, p["token"], [c, clash]), 409, "op_conflict")
    assert len(voice(app_url, staff, 2)) == len(start) + 2
    assert ok(post_ops(app_url, p["token"], [c]))["duplicates"] == []
    field_err(post_ops(app_url, p["token"], [insert(next(stamp), "c-mara", staff, 2, c["id"], note("D", 5))]), "ops[0].id", "Site must be your collaborator id.")
    field_err(post_ops(app_url, p["token"], [set_op(1, p["id"], staff, 2, a["id"], "tie", True)]), "ops[0].id", "Stamp must be later than the element it refers to.")
    resting = {"kind": "rest", "pitch": {"step": "C", "alter": 0, "octave": 4}, "duration": "quarter", "dots": 0}
    body = err(post_ops(app_url, p["token"], [insert(next(stamp), p["id"], staff, 2, c["id"], resting)]), 422, "validation")
    assert "Rests have no pitch." in body["errors"].values()
    field_err(post_ops(app_url, p["token"], [insert(next(stamp), p["id"], "st-nowhere", 2, None, note("C", 4))]), "ops[0].staffId", "Unknown staff.")
    field_err(post_ops(app_url, p["token"], []), "ops")
    many = [set_op(next(stamp), p["id"], staff, 2, c["id"], "dynamic", "p") for _ in range(BATCH_MAX + 1)]
    field_err(post_ops(app_url, p["token"], many), "ops")


def test_concurrent_inserts_converge(app_url: str, team: Callable[..., dict]) -> None:
    a, b = team(), team()
    la, lb = live(app_url, a["token"]), live(app_url, b["token"])
    try:
        ok(hold(app_url, a["token"], la.connection_id, ["st-vc"]), 201)
        stamp = stamps(app_url)
        anchor = append(app_url, a, "st-vc", 1, [note("C", 3)], stamp)[0]
        base_l = next(stamp)
        mk = lambda who, l, step: insert(base_l + l, who["id"], "st-vc", 1, anchor["id"], note(step, 3))
        a_hi, a_lo, b_hi, b_mid = mk(a, 5, "D"), mk(a, 3, "E"), mk(b, 5, "F"), mk(b, 4, "G")
        for who, op in ((b, b_mid), (a, a_lo), (b, b_hi), (a, a_hi)):
            ok(post_ops(app_url, who["token"], [op]))
        expected = [key(o["id"]) for o in sorted((a_hi, a_lo, b_hi, b_mid), key=lambda o: (o["id"]["lamport"], o["id"]["site"]), reverse=True)]
        events = voice(app_url, "st-vc", 1)
        idx = [key(e["id"]) for e in events].index(key(anchor["id"]))
        assert [key(e["id"]) for e in events[idx + 1:idx + 5]] == expected
        wanted = {key(o["id"]) for o in (a_hi, a_lo)}
        lb.wait(lambda m: m.get("type") == "ops" and wanted & {key(e["op"]["id"]) for e in m["entries"]}, SLACK_S, "ops broadcast reaches the other client")
    finally:
        la.close()
        lb.close()


LWW_CASES = [("dynamic", "f", "pp"), ("dynamicPlacement", "above", "below"), ("tie", True, False), ("text", "alpha", "beta"),
             ("pitch", {"step": "D", "alter": 0, "octave": 4}, {"step": "F", "alter": 1, "octave": 4}), ("duration", "half", "eighth"), ("dots", 1, 0)]


def test_latest_stamp_wins(app_url: str, team: Callable[..., dict]) -> None:
    a, b = team(), team()
    stamp = stamps(app_url)
    target = append(app_url, a, "st-hn", 1, [note("C", 4)], stamp)[0]["id"]
    current = lambda: next(e for e in voice(app_url, "st-hn", 1) if key(e["id"]) == key(target))
    for field, va, vb in LWW_CASES:
        high, low = next(stamp), next(stamp)
        high, low = max(high, low) + 1, min(high, low)
        ok(post_ops(app_url, a["token"], [set_op(high, a["id"], "st-hn", 1, target, field, va)]))
        ok(post_ops(app_url, b["token"], [set_op(low, b["id"], "st-hn", 1, target, field, vb)]))
        assert current()[field] == va, f"{field}: older stamp overwrote newer"
        same = next(stamp) + 1
        ok(post_ops(app_url, a["token"], [set_op(same, a["id"], "st-hn", 1, target, field, vb)]))
        ok(post_ops(app_url, b["token"], [set_op(same, b["id"], "st-hn", 1, target, field, va)]))
        winner = va if b["id"] > a["id"] else vb
        assert current()[field] == winner, f"{field}: equal stamps not won by the greater site"
        for _ in range(3):
            next(stamp)


def make_sets(person: dict, target: dict, staff: str, v: int, stamp: Iterator[int]) -> Callable[[int], list[dict]]:
    return lambda n: [set_op(next(stamp), person["id"], staff, v, target, "dynamic", "mf") for _ in range(n)]


def open_window(base: str, person: dict, sets: Callable[[int], list[dict]]) -> None:
    for _ in range(4 * (OPS_PER_WINDOW // BATCH_MAX + 2)):
        r = post_ops(base, person["token"], sets(BATCH_MAX))
        if r.status_code == 429:
            break
        ok(r)
    else:
        pytest.fail("more than 120 operations were accepted without a 429")
    for size in (BATCH_MAX // 5, 1):
        for _ in range(OPS_PER_WINDOW * 2):
            r = post_ops(base, person["token"], sets(size))
            if r.status_code == 429:
                break
            ok(r)
        else:
            pytest.fail(f"batches of {size} were never refused")
    single = sets(1)
    poll(lambda: post_ops(base, person["token"], single).status_code == 200, WINDOW_S + SLACK_S, "a new throttle window accepts operations")


def test_operation_throttle(app_url: str, team: Callable[..., dict]) -> None:
    p = team()
    stamp = stamps(app_url)
    target = append(app_url, p, "st-tp", 2, [note("C", 5)], stamp)[0]
    sets = make_sets(p, target["id"], "st-tp", 2, stamp)
    open_window(app_url, p, sets)
    ok(post_ops(app_url, p["token"], sets(BATCH_MAX)))
    ok(post_ops(app_url, p["token"], sets(BATCH_MAX - 1)))
    seq = score(app_url)["lastSeq"]
    over = sets(21)
    r = post_ops(app_url, p["token"], over)
    body = err(r, 429, "rate_limited", "Too many edits at once. Waiting to send the rest.")
    retry = int(r.headers["Retry-After"])
    assert 1 <= retry <= WINDOW_S and body["retryAfterSeconds"] == retry
    assert not ({key(o["id"]) for o in over} & {key(e["op"]["id"]) for e in ops_after(app_url, seq)}), "a refused batch was partly recorded"
    ok(post_ops(app_url, p["token"], sets(20)))
    err(post_ops(app_url, p["token"], sets(1)), 429, "rate_limited")
    err(post_ops(app_url, p["token"], [set_op(next(stamp), p["id"], "st-nowhere", 2, target["id"], "dynamic", "p")]), 429, "rate_limited")


def test_queued_edits_wait_visibly(browser: Browser, app_url: str, team: Callable[..., dict]) -> None:
    p = team()
    stamp = stamps(app_url)
    target = append(app_url, p, "st-tp", 1, [note("C", 5)], stamp)[0]
    with open_seat(browser, app_url, p["token"]) as page:
        page.clock.set_system_time(SKEWED)
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        choose_entry(page, "Trumpet in B♭", 1)
        press(page, "End")
        press(page, "5")
        before = voice(app_url, "st-tp", 1)
        sets = make_sets(p, target["id"], "st-tp", 1, stamp)
        open_window(app_url, p, sets)
        for n in (BATCH_MAX, BATCH_MAX, OPS_PER_WINDOW - 2 * BATCH_MAX - 1):
            ok(post_ops(app_url, p["token"], sets(n)))
        for k in ("c", "d", "e"):
            page.keyboard.press(k)
        queue = status(page, "Sync queue")
        pattern = re.compile(r"^Waiting (\d+) s to send 3 queued edits\.$")
        first = eventually(page, lambda: pattern.match(text(queue)), "Sync queue shows the wait for 3 queued edits")
        s1 = int(first.group(1))
        if s1 > 1:
            advance(page, 1000)
            m = re.match(r"^Waiting (\d+) s to send \d+ queued edits\.$", text(queue))
            assert m and int(m.group(1)) == s1 - 1, f"countdown {text(queue)!r} after {s1}"
        page.keyboard.press("f")
        eventually(page, lambda: text(queue) == "All queued edits sent.", "queue flushed", seconds=UI_WAIT * 2)
        new = new_events(page, app_url, "st-tp", 1, before, 4)
        advance(page, 1000)
        new = [e for e in voice(app_url, "st-tp", 1) if key(e["id"]) not in {key(b["id"]) for b in before}]
        assert [e["pitch"]["step"] for e in new] == ["C", "D", "E", "F"], "queued notes dropped, duplicated or reordered"


@pytest.mark.timeout(900)
def test_tombstone_compaction(app_url: str, team: Callable[..., dict]) -> None:
    base = short_url()
    a, b = team(base=base), team(base=base)
    stamp = stamps(base)
    x = append(base, a, "st-fl", 1, [note("C", 5)], stamp)[0]
    d = delete_op(next(stamp), a["id"], "st-fl", 1, x["id"])
    ok(post_ops(base, a["token"], [d]))
    keeper = append(base, a, "st-fl", 1, [note("D", 5)], stamp)[0]

    def to_snapshot(person: dict, seen: int | None) -> None:
        n = SNAPSHOT_EVERY - score(base)["lastSeq"] % SNAPSHOT_EVERY
        ops = make_sets(person, keeper["id"], "st-fl", 1, stamp)(n)
        for i in range(0, n, BATCH_MAX):
            ok(post_ops(base, person["token"], ops[i:i + BATCH_MAX], seen))

    first = sync(base)
    assert first["stableLamport"] < d["id"]["lamport"] and first["tombstones"] >= 1
    to_snapshot(a, None)
    phase1 = sync(base)
    assert phase1["tombstones"] >= 1 and phase1["stableLamport"] < d["id"]["lamport"]
    for c in ok(call(base, "GET", f"/api/scores/{SCORE}/collaborators", COMPOSER))["collaborators"]:
        if c["status"] == "active" and c["id"] not in SEED_SEATS and c["id"] not in (a["id"], b["id"]):
            call(base, "DELETE", f"/api/scores/{SCORE}/collaborators/{c['id']}", COMPOSER)
    lam = score(base)["lamport"]
    sockets = [live(base, tok) for tok in (*SEED_SEATS.values(), a["token"], b["token"])]
    try:
        for s in sockets:
            s.heartbeat(None, lam)
        poll(lambda: sync(base)["stableLamport"] >= d["id"]["lamport"], SLACK_S, "stableLamport reaches the delete stamp")
        to_snapshot(b, lam)
        poll(lambda: sync(base)["tombstones"] <= phase1["tombstones"] - 1, SLACK_S, "snapshot drops the acknowledged tombstone")
    finally:
        for s in sockets:
            s.close()


def test_compaction_keeps_notes_after_dropped_tombstone(app_url: str, team: Callable[..., dict]) -> None:
    base = short_url()
    a, b = team(base=base), team(base=base)
    stamp = stamps(base)
    before = tail(base, "st-fl", 2)
    x = append(base, a, "st-fl", 2, [note("C", 5)], stamp)[0]
    keeper = insert(next(stamp), a["id"], "st-fl", 2, x["id"], note("D", 5))
    ok(post_ops(base, a["token"], [keeper]))
    d = delete_op(next(stamp), a["id"], "st-fl", 2, x["id"])
    ok(post_ops(base, a["token"], [d]))

    def to_snapshot(person: dict, seen: int | None) -> None:
        n = SNAPSHOT_EVERY - score(base)["lastSeq"] % SNAPSHOT_EVERY
        ops = make_sets(person, keeper["id"], "st-fl", 2, stamp)(n)
        for i in range(0, n, BATCH_MAX):
            ok(post_ops(base, person["token"], ops[i:i + BATCH_MAX], seen))

    to_snapshot(a, None)
    kept = sync(base)["tombstones"]
    for c in ok(call(base, "GET", f"/api/scores/{SCORE}/collaborators", COMPOSER))["collaborators"]:
        if c["status"] == "active" and c["id"] not in SEED_SEATS and c["id"] not in (a["id"], b["id"]):
            call(base, "DELETE", f"/api/scores/{SCORE}/collaborators/{c['id']}", COMPOSER)
    lam = score(base)["lamport"]
    sockets = [live(base, tok) for tok in (*SEED_SEATS.values(), a["token"], b["token"])]
    try:
        for sock in sockets:
            sock.heartbeat(None, lam)
        poll(lambda: sync(base)["stableLamport"] >= d["id"]["lamport"], SLACK_S, "stableLamport reaches the delete stamp")
        to_snapshot(b, lam)
        poll(lambda: sync(base)["tombstones"] <= kept - 1, SLACK_S, "snapshot drops the acknowledged tombstone")
    finally:
        for sock in sockets:
            sock.close()
    ids = [key(e["id"]) for e in voice(base, "st-fl", 2)]
    assert key(keeper["id"]) in ids, "a note that was never deleted vanished when the tombstone before it was dropped"
    assert key(x["id"]) not in ids
    if before:
        assert ids[ids.index(key(before["id"])) + 1] == key(keeper["id"]), "the kept note moved"


@pytest.mark.timeout(600)
def test_wf_concurrent_editing_same_bars(browser: Browser, app_url: str) -> None:
    events = voice(app_url, "st-ob", 1)
    seed8 = next(e for e in events if key(e["id"]) == (8, "seed"))
    idx = events.index(seed8)
    start_seq = score(app_url)["lastSeq"]
    with open_seat(browser, app_url, COMPOSER) as pc, open_seat(browser, app_url, COPYIST) as pj, open_seat(browser, app_url, OBOIST) as po:
        pages = (pc, pj, po)
        for page in pages:
            page.set_viewport_size(DESKTOP)
        eventually(po, part_region(po, OBOE).is_visible, "oboist on their part")
        btn(po, "Back to score").click()
        for page in pages:
            wait_workspace(page)
            page.get_by_role("radio", name="Pages", exact=True).click()
            choose_entry(page, "Oboe", 1)
            press(page, "Home")
            for _ in range(idx + 1):
                press(page, "ArrowRight")
        for rnd in range(2):
            for page, letters in zip(pages, (("c", "d"), ("e", "f"), ("g", "a"))):
                page.keyboard.press(letters[rnd])
        for page in pages:
            advance(page, 500)
        mine = poll(lambda: (o := [e["op"] for e in ops_after(app_url, start_seq) if e["op"]["type"] == "insert" and e["op"]["staffId"] == "st-ob"]) and len(o) >= 6 and o, SLACK_S, "six inserts recorded")
        firsts = sorted((o for o in mine if o["after"] and key(o["after"]) == (8, "seed")), key=lambda o: (o["id"]["lamport"], o["id"]["site"]), reverse=True)
        assert len(firsts) == 3, "each typist's first note follows measure 5's last note"
        expected = []
        for f in firsts:
            expected += [key(f["id"]), key(next(o for o in mine if o["after"] and key(o["after"]) == key(f["id"]))["id"])]
        now = voice(app_url, "st-ob", 1)
        i8 = [key(e["id"]) for e in now].index((8, "seed"))
        assert [key(e["id"]) for e in now[i8 + 1:i8 + 7]] == expected
        assert all(e["measure"] >= 6 for e in now[i8 + 1:i8 + 7])
        for page in pages:
            assert not text(status(page, "Entry")).startswith("That edit was refused")
        systems, _ = engraving(app_url)
        sys6 = next(s for s in systems if s["firstMeasure"] <= 6 <= s["lastMeasure"])
        name = f"System {sys6['index']}, measures {sys6['firstMeasure']}–{sys6['lastMeasure']}"
        glyphs = svg_text(sys6["svg"])
        for page in pages:
            group = page.get_by_role("group", name=name, exact=True)
            eventually(page, lambda: group.count() == 1 and glyphs in re.sub(r"\s+", "", group.text_content() or ""), f"screen shows the server's {name}")


def test_wf_concurrent_editing_offline_queue(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COPYIST) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        choose_entry(page, "Bassoon", 2)
        press(page, "End")
        before = voice(app_url, "st-bn", 2)
        page.context.set_offline(True)
        page.keyboard.press("c")
        page.keyboard.press("e")
        queue = status(page, "Sync queue")
        eventually(page, lambda: text(queue) == "Offline — 2 edits queued. Retrying.", "offline queue announced")
        page.context.set_offline(False)
        new_events(page, app_url, "st-bn", 2, before, 2)
        advance(page, 1000)
        new = voice(app_url, "st-bn", 2)[len(before):]
        assert [e["pitch"]["step"] for e in new] == ["C", "E"]


def test_one_hold_per_staff(app_url: str, team: Callable[..., dict]) -> None:
    people = [team() for _ in range(4)]
    sockets = [live(app_url, p["token"]) for p in people]
    asks = [["st-vn1", "st-vn2"], ["st-vn2", "st-va"], ["st-vn2"], ["st-vn2", "st-vn1", "st-va"]]
    try:
        results = race(4, lambda i: hold(app_url, people[i]["token"], sockets[i].connection_id, asks[i]))
        winners = [i for i, r in enumerate(results) if r.status_code == 201]
        assert len(winners) == 1, f"hold statuses {[r.status_code for r in results]}; expected one 201"
        w = winners[0]
        held_now = holds(app_url)
        assert all(held_now.get(s) == people[w]["id"] for s in asks[w])
        for i, r in enumerate(results):
            if i == w:
                continue
            body = err(r, 423, "staff_held")
            assert body["heldBy"]["id"] == people[w]["id"] and body["message"].startswith(f"{people[w]['name']} is holding ")
            assert set(body["staffIds"]) <= set(asks[i]) & set(asks[w]) and "st-vn2" in body["staffIds"]
            assert not any(held_now.get(s) == people[i]["id"] for s in asks[i]), "a loser holds part of its request"
        ok(hold(app_url, people[w]["token"], sockets[w].connection_id, asks[w]), 201)
    finally:
        for s in sockets:
            s.close()


@pytest.mark.timeout(300)
def test_holds_end_when_session_closes(app_url: str, team: Callable[..., dict]) -> None:
    p = team()
    err(hold(app_url, team()["token"], None, ["st-cl"]), 409, "not_connected", "Open the live session before holding staves.")
    watcher = live(app_url, COMPOSER)
    try:
        for _ in range(10):
            sock = live(app_url, p["token"])
            ok(hold(app_url, p["token"], sock.connection_id, ["st-cl"]), 201)
            sock.drop()
            poll(lambda: holds(app_url).get("st-cl") != p["id"], SOCKET_CLOSE_S + 1, "hold released when the socket closes")
            stale = sock.connection_id
        field_err(hold(app_url, p["token"], stale, ["st-cl"]) if live(app_url, p["token"]) else None, "connectionId", "Unknown connection.")
        ok(hold(app_url, COMPOSER, watcher.connection_id, ["st-cl"]), 201)
        call(app_url, "DELETE", f"/api/scores/{SCORE}/holds", COMPOSER, params={"staffIds": "st-cl"})
        silent = live(app_url, p["token"], answer_pings=False)
        ok(hold(app_url, p["token"], silent.connection_id, ["st-cl"]), 201)
        poll(lambda: holds(app_url).get("st-cl") != p["id"], PING_S + PONG_GRACE_S + SOCKET_CLOSE_S + SLACK_S, "hold released after missed pongs")
        poll(no_open_app_sessions, SLACK_S, "no app session active or idle in transaction")
        assert httpx.get(f"{app_url}/s/{COMPOSER}", timeout=HTTP_TIMEOUT).status_code == 200
    finally:
        watcher.close()


@pytest.mark.timeout(600)
def test_wf_staff_holds_race(browser: Browser, app_url: str) -> None:
    names = {"c-mara": COMPOSER_NAME, "c-jun": COPYIST_NAME}
    with open_seat(browser, app_url, COMPOSER) as pc, open_seat(browser, app_url, COPYIST) as pj:
        pages = {"c-mara": pc, "c-jun": pj}
        for page in pages.values():
            page.clock.set_system_time(SKEWED)
            page.set_viewport_size(DESKTOP)
            wait_workspace(page)
            select_only(page, ["Violin I", "Violin II"])
            open_tab(page, "Holds")
        b1, b2 = btn(pc, "Hold selected staves"), btn(pj, "Hold selected staves")
        b1.click()
        b2.click()
        winner = poll(lambda: (h := holds(app_url)).get("st-vn1") in names and h["st-vn1"] == h.get("st-vn2") and h["st-vn1"], SLACK_S, "one collaborator holds both violins")
        loser = next(c for c in names if c != winner)
        win_text = eventually(pages[winner], lambda: (t := text(status(pages[winner], "Holds"))).startswith("Holding ") and t, "winner told")
        assert "Violin I" in win_text and "Violin II" in win_text
        lose_text = eventually(pages[loser], lambda: (t := text(status(pages[loser], "Holds"))).startswith(f"{names[winner]} is holding ") and t, "loser told who holds")
        assert lose_text.endswith(". Your notes still save.")
        start = score(app_url)["lastSeq"]
        for page in pages.values():
            choose_entry(page, "Violin I", 2)
            press(page, "End")
            press(page, "c")
            advance(page, 500)
        poll(lambda: {e["author"]["id"] for e in ops_after(app_url, start) if e["op"]["staffId"] == "st-vn1"} >= set(names), SLACK_S, "both collaborators' notes saved")
        pages[winner].context.close()
        poll(lambda: "st-vn1" not in holds(app_url), SOCKET_CLOSE_S + 1, "winner's holds released when the tab closes")
        lp = pages[loser]
        btn(lp, "Hold selected staves").click()
        current = lp.get_by_role("list", name="Current holds", exact=True)
        want = {f"Violin I — {names[loser]}", f"Violin II — {names[loser]}"}
        eventually(lp, lambda: want <= {text(i) for i in current.get_by_role("listitem").all()}, "Holds tab lists the new holder")
        assert holds(app_url).get("st-vn2") == loser


def test_wf_staff_holds_release(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COPYIST) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        select_only(page, ["Violin I", "Violin II"])
        open_tab(page, "Holds")
        btn(page, "Hold selected staves").click()
        eventually(page, lambda: text(status(page, "Holds")).startswith("Holding "), "hold won")
        btn(page, "Release my holds").click()
        released = eventually(page, lambda: (t := text(status(page, "Holds"))).startswith("Released ") and t, "release announced")
        assert "Violin I" in released and "Violin II" in released
        poll(lambda: not {"st-vn1", "st-vn2"} & set(holds(app_url)), SLACK_S, "violins free")


@pytest.mark.timeout(300)
def test_presence_server_decided(browser: Browser, app_url: str, team: Callable[..., dict], valkey: Valkey) -> None:
    x = team()
    ttl = ok(call(app_url, "GET", f"/api/scores/{SCORE}/presence", COMPOSER))["ttlSeconds"]
    with open_seat(browser, app_url, COPYIST) as page:
        page.clock.set_system_time(SKEWED)
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        sock = live(app_url, x["token"])
        try:
            items = page.get_by_role("list", name="Collaborators here", exact=True).get_by_role("listitem")
            here = lambda: any(text(i) == f"{x['name']} · Copyist" for i in items.all())
            sock.heartbeat({"staffId": "st-ob", "measure": 1, "beat": 1})
            eventually(page, here, "presence chip appears")
            assert json.loads(valkey.hash(f"fairline:presence:{SCORE}")[x["id"]])["name"] == x["name"]
            sock.heartbeat({"staffId": "st-ob", "measure": 1, "beat": 1})
            t0 = time.monotonic()
            page.clock.set_system_time(SKEWED_LATER)
            advance(page, 1000)
            assert here(), "chip removed by the device clock"
            eventually(page, lambda: not here(), "chip leaves when the server expires the entry", seconds=ttl + PRESENCE_PUSH_S + SLACK_S)
            assert time.monotonic() - t0 >= ttl - PRESENCE_PUSH_S, "chip left before the server's presence window"
            eventually(page, lambda: x["id"] not in presence_ids(app_url) and x["id"] not in valkey.hash(f"fairline:presence:{SCORE}"),
                       "server drops the expired presence entry", seconds=PRESENCE_PUSH_S * 5)
            sock.heartbeat({"staffId": "st-ob", "measure": 2, "beat": 1})
            eventually(page, here, "next heartbeat restores the chip")
        finally:
            sock.close()


SUMMARY_OPS = ["insert-note", "insert-rest", "pitch", "duration", "dots", "tie-on", "tie-off", "dynamic", "dynamic-off", "placement", "text", "delete-note", "delete-rest"]


def test_history_paging_and_summaries(app_url: str, team: Callable[..., dict]) -> None:
    a, b = team(), team()
    stamp = stamps(app_url)
    seq0 = score(app_url)["lastSeq"]
    n, r = append(app_url, a, "st-bn", 1, [note("E", 4), rest("eighth")], stamp)
    t = n["id"]
    sets = [("pitch", {"step": "F", "alter": 1, "octave": 4}), ("duration", "16th"), ("dots", 1), ("tie", True), ("tie", False),
            ("dynamic", "mf"), ("dynamic", None), ("dynamicPlacement", "above"), ("text", "<b>con brio</b>")]
    ok(post_ops(app_url, a["token"], [set_op(next(stamp), a["id"], "st-bn", 1, t, f, v) for f, v in sets]))
    ok(post_ops(app_url, a["token"], [delete_op(next(stamp), a["id"], "st-bn", 1, t), delete_op(next(stamp), a["id"], "st-bn", 1, r["id"])]))
    by_seq = {e["seq"]: e for e in ops_after(app_url, seq0) if e["author"]["id"] == a["id"]}
    entries = ok(call(app_url, "GET", f"/api/scores/{SCORE}/history", COMPOSER, params={"staffId": "st-bn", "limit": HISTORY_LIMIT_MAX}))["entries"]
    ours = sorted((e for e in entries if e["seq"] in by_seq), key=lambda e: e["seq"])
    expected = ["Added E 4 quarter", "Added eighth rest", "Pitch set to F♯ 4", "Duration set to sixteenth", "Dots set to 1", "Tie added", "Tie removed",
                "Dynamic set to mf", "Dynamic removed", "Dynamic moved above the staff", "Text changed", "Deleted F♯ 4 dotted sixteenth", "Deleted eighth rest"]
    assert [e["summary"] for e in ours] == expected
    assert all(e["author"]["name"] == a["name"] and e["staffName"] == "Bassoon" and e["staffId"] == "st-bn" for e in ours)
    hp = f"/api/scores/{SCORE}/history"
    for limit in (0, HISTORY_LIMIT_MAX + 1):
        field_err(call(app_url, "GET", hp, COMPOSER, params={"limit": limit}), "limit", "Ask for 1 to 100 entries.")
    field_err(call(app_url, "GET", hp, COMPOSER, params={"before": "not-a-cursor"}), "before", "Unknown cursor.")
    field_err(call(app_url, "GET", hp, COMPOSER, params={"type": "bogus"}), "type", "Unknown filter.")
    field_err(call(app_url, "GET", hp, COMPOSER, params={"field": "bogus"}), "field", "Unknown filter.")
    deletes = ok(call(app_url, "GET", hp, COMPOSER, params={"staffId": "st-bn", "type": "delete", "limit": 5}))["entries"]
    assert deletes and all(e["type"] == "delete" for e in deletes)
    dyn = ok(call(app_url, "GET", hp, COMPOSER, params={"field": "dynamic,dynamicPlacement", "limit": 20}))["entries"]
    assert dyn and all(e["field"] in ("dynamic", "dynamicPlacement") for e in dyn)
    texts = [set_op(next(stamp), a["id"], "st-bn", 1, r["id"], "text", f"take {i}") for i in range(7)]
    keep = append(app_url, a, "st-bn", 1, [note("G", 3)], stamp)[0]
    texts = [set_op(next(stamp), a["id"], "st-bn", 1, keep["id"], "text", f"take {i}") for i in range(7)]
    ok(post_ops(app_url, a["token"], texts))
    params = {"staffId": "st-bn", "field": "text", "limit": 3}
    page1 = ok(call(app_url, "GET", hp, COMPOSER, params=params))
    collected = list(page1["entries"])
    top = collected[0]["seq"]
    cursor = page1["nextCursor"]
    for i in range(ENGRAVE_PAGES_MAX):
        if cursor is None:
            break
        if i < 2:
            ok(post_ops(app_url, b["token"], [set_op(next(stamp), b["id"], "st-bn", 1, keep["id"], "text", f"late {i}")]))
        body = ok(call(app_url, "GET", hp, COMPOSER, params={**params, "before": cursor}))
        assert len(body["entries"]) <= 3
        collected += body["entries"]
        cursor = body["nextCursor"]
    seqs = [e["seq"] for e in collected]
    assert seqs == sorted(seqs, reverse=True) and len(seqs) == len(set(seqs)), "pages repeat or are not newest first"
    assert all(s <= top for s in seqs), "entries recorded after the first page appeared"
    logged = {e["seq"] for e in ops_after(app_url, min(seqs) - 1)
              if e["seq"] <= top and e["op"]["type"] == "set" and e["op"]["field"] == "text" and e["op"]["staffId"] == "st-bn"}
    assert logged == set(seqs), f"history skipped {sorted(logged - set(seqs))}"


def test_engraving_bounded_and_paged(browser: Browser, app_url: str) -> None:
    ep = f"/api/scores/{SCORE}/engraving"
    for limit in (0, SYSTEMS_MAX + 1):
        field_err(call(app_url, "GET", ep, COMPOSER, params={"view": "score", "limit": limit}), "limit", "Ask for 1 to 16 systems.")
    field_err(call(app_url, "GET", ep, COMPOSER, params={"view": "part"}), "partId", "Choose a part.")
    field_err(call(app_url, "GET", ep, COMPOSER, params={"view": "score", "cursor": "not-a-cursor"}), "cursor", "Unknown cursor.")
    assert len(ok(call(app_url, "GET", ep, COMPOSER, params={"view": "score"}))["systems"]) <= SYSTEMS_DEFAULT
    systems, times = engraving(app_url, limit=3)
    assert max(times) < ENGRAVE_BUDGET_S
    assert [s["index"] for s in systems] == list(range(1, len(systems) + 1))
    assert systems[0]["firstMeasure"] == 1 and systems[-1]["lastMeasure"] == score(app_url)["measureCount"]
    assert all(b["firstMeasure"] == a["lastMeasure"] + 1 and b["page"] >= a["page"] for a, b in zip(systems, systems[1:]))
    assert all("svg" in s["svg"] for s in systems)
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        page.get_by_role("radio", name="Pages", exact=True).click()
        for s in systems:
            g = page.get_by_role("group", name=f"System {s['index']}, measures {s['firstMeasure']}–{s['lastMeasure']}", exact=True)
            eventually(page, lambda: g.count() == 1, f"editor shows server system {s['index']}")
    base = short_url()
    fill_staves(base)
    fill_measures(base)
    capped, capped_times = engraving(base, limit=SYSTEMS_MAX, pages=3)
    assert capped and len(capped) <= 3 * SYSTEMS_MAX
    assert max(capped_times) < ENGRAVE_BUDGET_S, f"engraving at both caps took {max(capped_times):.2f} s"


@pytest.mark.timeout(600)
def test_wf_proofread_history_trace_tie(browser: Browser, app_url: str, team: Callable[..., dict]) -> None:
    writer = team()
    with open_seat(browser, app_url, COPYIST) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        choose_entry(page, "Clarinet in B♭", 2)
        press(page, "End")
        press(page, "5")
        before = voice(app_url, "st-cl", 2)
        press(page, "c")
        mine = new_events(page, app_url, "st-cl", 2, before, 1)[0]
        for k, copy in (("j", None), ("Shift+D", "Dynamic pp."), ("Shift+F", "Dynamic above the staff."), ("t", "Tie added.")):
            press(page, k)
            if copy:
                expect_entry(page, copy)
        tie_entry = eventually(page, lambda: next((e for e in ok(call(app_url, "GET", f"/api/scores/{SCORE}/history", COMPOSER, params={"field": "tie", "staffId": "st-cl", "limit": 20}))["entries"]
                                                   if e["author"]["id"] == "c-jun" and e["summary"] == "Tie added"), None), "tie recorded", SLACK_S)
        stamp = stamps(app_url)
        anchors = append(app_url, writer, "st-cl", 1, [note("D", 5, duration="32nd") for _ in range(55)], stamp)
        ok(post_ops(app_url, writer["token"], [set_op(next(stamp), writer["id"], "st-cl", 1, o["id"], "tie", True) for o in anchors[:BATCH_MAX]]))
        ok(post_ops(app_url, writer["token"], [set_op(next(stamp), writer["id"], "st-cl", 1, o["id"], "tie", True) for o in anchors[BATCH_MAX:]]))
        open_tab(page, "History")
        select(page.get_by_role("combobox", name="Show", exact=True), "Ties")
        feed = page.get_by_role("feed", name="Operation history", exact=True)
        eventually(page, lambda: feed.get_by_role("article").count() > 0, "Ties history loaded")
        ok(post_ops(app_url, writer["token"], [set_op(next(stamp), writer["id"], "st-cl", 1, o["id"], "tie", False) for o in anchors[:3]]))
        eventually(page, lambda: page.get_by_role("button", name=re.compile(r"^Show \d+ new changes$")).count() == 1, "new changes offered without moving the list")
        want = f"{COPYIST_NAME} · Tie added · {tie_entry['staffName']}, measure {tie_entry['measure']}, beat {beat_text(tie_entry['beat'])} · {hhmmss(tie_entry['at'])}"
        articles = lambda: [text(a) for a in feed.get_by_role("article").all()]
        for _ in range(LOAD_OLDER_MAX):
            if want in articles():
                break
            btn(page, "Load older changes").click()
            advance(page, 500)
        texts = articles()
        assert texts.count(want) == 1, f"copyist's tie entry shown {texts.count(want)} times"
        assert len(texts) == len(set(texts)), "an entry repeated across pages"
        assert not any("Pitch set to" in t or "Dynamic" in t for t in texts), "Ties filter shows other fields"
        assert key(mine["id"])


def test_wf_proofread_history_server_time(browser: Browser, app_url: str, team: Callable[..., dict]) -> None:
    writer = team()
    with open_seat(browser, app_url, COPYIST) as page:
        page.clock.set_system_time(SKEWED)
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        stamp = stamps(app_url)
        op = append(app_url, writer, "st-cl", 1, [note("F", 5, duration="32nd")], stamp)[0]
        entry = next(e for e in ok(call(app_url, "GET", f"/api/scores/{SCORE}/history", COMPOSER, params={"staffId": "st-cl", "limit": 10}))["entries"] if e["author"]["id"] == writer["id"])
        open_tab(page, "History")
        want = f"{writer['name']} · Added F 5 thirty-second · {entry['staffName']}, measure {entry['measure']}, beat {beat_text(entry['beat'])} · {hhmmss(entry['at'])}"
        feed = page.get_by_role("feed", name="Operation history", exact=True)
        eventually(page, lambda: want in [text(a) for a in feed.get_by_role("article").all()], "article shows server time")
        assert key(op["id"])


def breaks_honoured(systems: list[dict], system_breaks: list[int], page_breaks: list[int], max_per_page: int) -> None:
    ends = {s["lastMeasure"] for s in systems}
    for m in system_breaks + page_breaks:
        assert m in ends, f"no system ends after measure {m}"
    for m in page_breaks:
        before = next(s for s in systems if s["lastMeasure"] == m)
        after = next(s for s in systems if s["firstMeasure"] == m + 1)
        assert after["page"] == before["page"] + 1, f"page turn after {m} did not start a page"
    per_page: dict[int, int] = defaultdict(int)
    for s in systems:
        per_page[s["page"]] += 1
    assert max(per_page.values()) <= max_per_page


def test_part_breaks_honoured(app_url: str, team: Callable[..., dict]) -> None:
    p, q = team(), team()
    lp, lq = live(app_url, p["token"]), live(app_url, q["token"])
    url = f"/api/scores/{SCORE}/parts/p-bn/layout"
    good = {"systemBreaks": [4, 12], "pageBreaks": [8]}
    try:
        err(call(app_url, "PUT", url, p["token"], good), 409, "hold_required")
        ok(hold(app_url, q["token"], lq.connection_id, ["st-bn"]), 201)
        assert err(call(app_url, "PUT", url, p["token"], good), 423, "staff_held")["heldBy"]["id"] == q["id"]
        assert call(app_url, "DELETE", f"/api/scores/{SCORE}/holds", q["token"], params={"staffIds": "st-bn"}).status_code == 204
        ok(hold(app_url, p["token"], lp.connection_id, ["st-bn"]), 201)
        m = score(app_url)["measureCount"]
        msg = f"Use measures from 1 to {m - 1}, each once."
        for bad, k in (({"systemBreaks": [0], "pageBreaks": []}, "systemBreaks"), ({"systemBreaks": [m], "pageBreaks": []}, "systemBreaks"),
                       ({"systemBreaks": [4, 4], "pageBreaks": []}, "systemBreaks"), ({"systemBreaks": [], "pageBreaks": [m]}, "pageBreaks")):
            field_err(call(app_url, "PUT", url, p["token"], bad), k, msg)
        layout_body = ok(call(app_url, "PUT", url, p["token"], good))["part"]["layout"]
        assert sorted(layout_body["systemBreaks"]) == [4, 12] and layout_body["pageBreaks"] == [8]
        breaks_honoured(engraving(app_url, "part", "p-bn")[0], [4, 12], [8], ONE_STAFF_PAGE_SYSTEMS)
        stamp = stamps(app_url)
        ops, after = [], None
        for _ in range(9):
            op = insert(next(stamp), p["id"], "st-bn", 1, after, note("F", 3, duration="16th"))
            ops.append(op)
            after = op["id"]
        ok(post_ops(app_url, p["token"], ops + [insert(next(stamp), p["id"], "st-bn", 1, after, note("G", 3, duration="whole", dots=2))]))
        breaks_honoured(engraving(app_url, "part", "p-bn")[0], [4, 12], [8], ONE_STAFF_PAGE_SYSTEMS)
    finally:
        lp.close()
        lq.close()


LIFECYCLE = ["primary", "storage-down"]


@pytest.mark.parametrize("instance", LIFECYCLE, ids=LIFECYCLE)
def test_part_lifecycle(app_url: str, instance: str) -> None:
    base = app_url if instance == "primary" else outage("APP_MINIO_DOWN_URL")
    settle_part(app_url, "p-vc")
    rev = part(base, "p-vc")["revision"]
    sock = live(base, COMPOSER)
    try:
        if instance == "primary":
            results = race(5, lambda _: extract(base, "p-vc"))
            accepted = [r for r in results if r.status_code == 202]
            assert len(accepted) == 1, f"extract statuses {[r.status_code for r in results]}"
            assert accepted[0].json()["part"]["status"] == "engraving" and accepted[0].json()["part"]["revision"] == rev + 1
            for r in results:
                if r.status_code != 202:
                    assert err(r, 409, "part_busy", "Cello is already being extracted.")["status"] in ("engraving", "rendering")
            final = poll(lambda: (p := part(base, "p-vc"))["status"] in ("ready", "pdf_pending") and p, PDF_WAIT_S, "Cello rendered")
            again = ok(extract(base, "p-vc"), 202)["part"]
            assert again["status"] == "engraving" and again["revision"] == final["revision"] + 1
            settle_part(base, "p-vc")
        else:
            body = ok(extract(base, "p-vc"), 202)["part"]
            assert body["status"] == "engraving"
            back = poll(lambda: (p := part(base, "p-vc"))["status"] == "draft" and p, PDF_WAIT_S, "storage refusal returns Cello to draft")
            assert back["lastError"] == "storage_unavailable" and back["revision"] == rev + 1
        statuses = [m["part"]["status"] for m in list(sock.messages) if m.get("type") == "part" and m["part"]["id"] == "p-vc"]
        steps = [(a, b) for a, b in zip(statuses, statuses[1:]) if a != b]
        assert statuses and all(step in PART_ALLOWED for step in steps), f"unpublished transitions in {statuses}"
    finally:
        sock.close()


def test_ready_only_after_pdf_stored(app_url: str) -> None:
    settle_part(app_url, "p-hn")
    sock = live(app_url, COMPOSER)
    try:
        rev = ok(extract(app_url, "p-hn"), 202)["part"]["revision"]
        early = call(app_url, "GET", f"/api/scores/{SCORE}/parts/p-hn/pdf", COPYIST)
        if early.status_code != 200:
            assert err(early, 409, "pdf_not_ready", "The PDF for Horn in F is not ready.")["status"] in ("engraving", "rendering")
        sock.wait(lambda m: m.get("type") == "part" and m["part"]["id"] == "p-hn" and m["part"]["status"] == "ready", PDF_WAIT_S, "Horn part ready")
        prefix = f"scores/{SCORE}/parts/p-hn/r{rev}/"
        keys = S3().keys(prefix)
        assert prefix + "part.pdf" in keys, "Ready announced before MinIO held the PDF"
    finally:
        sock.close()
    p = part(app_url, "p-hn")
    pages = sorted(k for k in keys if re.search(r"/page-\d+\.svg$", k))
    assert p["pageCount"] == len(pages) == len({s["page"] for s in engraving(app_url, "part", "p-hn")[0]})
    r = call(app_url, "GET", f"/api/scores/{SCORE}/parts/p-hn/pdf", COPYIST)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf")
    disposition = r.headers.get("content-disposition", "")
    assert disposition.startswith("attachment") and f'filename="{TITLE} - Horn in F.pdf"' in disposition
    assert r.content == S3().get(prefix + "part.pdf") and pdf_pages(r.content) == p["pageCount"]
    assert pdf_text(r.content).count(f"{TITLE} — Horn in F") >= p["pageCount"]
    svg = call(app_url, "GET", f"/api/scores/{SCORE}/parts/p-hn/pages/1.svg", COPYIST)
    assert svg.status_code == 200 and svg.headers["content-type"].startswith("image/svg+xml") and svg.content == S3().get(prefix + "page-1.svg")
    assert call(app_url, "GET", f"/api/scores/{SCORE}/parts/p-hn/pages/{p['pageCount'] + 1}.svg", COPYIST).status_code == 404


def part_pages_shown(page: Page, base: str, part_id: str, part_name: str) -> None:
    region = page.get_by_role("region", name=f"{part_name} part", exact=True)
    want = len({s["page"] for s in engraving(base, "part", part_id)[0]})
    eventually(page, lambda: region.get_by_role("group", name=re.compile(r"^Page \d+$")).count() == want, f"{part_name} part shows the server's {want} pages")


def chip_ready(page: Page, base: str, part_id: str, part_name: str) -> None:
    eventually(page, lambda: text(chip(page, part_name)).startswith("Ready"), f"{part_name} chip reads Ready", seconds=PDF_WAIT_S)
    assert part(base, part_id)["status"] == "ready", "chip showed Ready before the API"


def extract_via_dialog(page: Page, part_name: str) -> None:
    btn(page, "Extract part…").click()
    dialog = page.get_by_role("dialog", name="Extract part", exact=True)
    select(dialog.get_by_role("combobox", name="Part", exact=True), part_name)
    dialog.get_by_role("button", name="Extract", exact=True).click()


def test_helix_peel_extraction(browser: Browser, app_url: str) -> None:
    settle_part(app_url, "p-fl")
    with open_seat(browser, app_url, COMPOSER) as page:
        canvas = open_helix(page)
        extract_via_dialog(page, "Flute")
        frames = scene_frames(canvas, steps=8, step_ms=250)
        assert all(f["draws"] > 0 for f in frames)
        changed(decode(frames[0]["png"]), decode(frames[-1]["png"]))

        def places(frame: dict) -> list[tuple[float, ...]]:
            return [tuple(round(v, 3) for v in m[12:15]) for m in frame["matrices"] if len(m) >= 16]

        moved = sum(a != b for a, b in zip(places(frames[0]), places(frames[-1])))
        assert moved >= 2, f"only {moved} scene objects moved during the peel; the cylinder's idle turn alone moves one"
        assert places(frames[-1]) == places(frames[-2]), "peel strips had not come to rest within the sampled two seconds"
        part_pages_shown(page, app_url, "p-fl", "Flute")
        chip_ready(page, app_url, "p-fl", "Flute")
        btn(page, "Back to score").click()
        region = part_region(page, FLUTE)
        eventually(page, lambda: region.count() == 0 or not region.is_visible(), "Back to score leaves the part page")
        assert canvas.is_visible()


MOTION_MODES = ["reduced-motion", "phone"]


@pytest.mark.parametrize("mode", MOTION_MODES, ids=MOTION_MODES)
def test_extraction_reduced_motion_and_phone(browser: Browser, app_url: str, mode: str) -> None:
    settle_part(app_url, "p-timp")
    kw = {"reduced_motion": "reduce"} if mode == "reduced-motion" else {}
    with open_seat(browser, app_url, COMPOSER, **kw) as page:
        if mode == "reduced-motion":
            open_helix(page)
        else:
            page.set_viewport_size(PHONE)
            wait_workspace(page)
            eventually(page, page.get_by_role("region", name="System strip", exact=True).is_visible, "System strip at 375 px")
        page.evaluate(FADE_PROBE)
        extract_via_dialog(page, "Timpani")
        region = part_region(page, TIMPANI)
        lows: list[float] = []
        for _ in range(10):
            advance(page, 20)
            if region.count() == 1:
                lows.append(float(region.evaluate(OPACITY_CHAIN)))
        eventually(page, lambda: region.count() == 1, "Timpani part page opened")
        if mode == "reduced-motion":
            fades = region.evaluate("(r) => window.__fades.filter(f => f.el && (f.el.contains(r) || r.contains(f.el))).map(f => ({ms: f.ms, prop: f.prop, kf: f.kf}))")
            fading = [f for f in fades if "opacity" in f["kf"] or f["prop"] == "opacity"]
            animated = any(0 < f["ms"] <= FADE_MAX_MS for f in fading)
            assert animated or (lows and min(lows) < 1), f"no short crossfade of the part page on Extract under reduced motion: animations {fades}, opacity samples {lows}"
            path = motion(region, CROSSFADE_MS)
            coords = [k for k in ("x", "y", "left", "top") if k in path[0]]
            assert coords and all(abs(pt[k] - path[0][k]) < 1 for pt in path for k in coords), "part page moves under reduced motion"
        part_pages_shown(page, app_url, "p-timp", "Timpani")
        chip_ready(page, app_url, "p-timp", "Timpani")
        if mode == "phone":
            layout(page)
        else:
            btn(page, "Back to score").click()
            wait_workspace(page)
            btn(page, "Play").click()
            eventually(page, btn(page, "Stop").is_visible, "playback started")
            advance(page, 1000)
            assert animations(editor(page)) == [], "playhead animates under reduced motion"
            btn(page, "Stop").click()


@pytest.mark.timeout(600)
def test_wf_part_extraction_deliver_oboe(browser: Browser, app_url: str) -> None:
    settle_part(app_url, "p-ob")
    with open_seat(browser, app_url, COPYIST) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        select_only(page, ["Oboe"])
        press(page, "Shift+H")
        eventually(page, lambda: text(status(page, "Holds")) == "Holding Oboe.", "Oboe held")
        open_tab(page, "Parts")
        btn(page, "Open Oboe").click()
        eventually(page, part_region(page, OBOE).is_visible, "Oboe part page")
        if btn(page, "Remove break after measure 24").count():
            btn(page, "Remove break after measure 24").click()
            eventually(page, lambda: text(status(page, "Layout")) == "Removed break after measure 24.", "old turn removed")
        page.get_by_role("spinbutton", name="After measure", exact=True).fill("24")
        btn(page, "Add page turn").click()
        eventually(page, lambda: text(status(page, "Layout")) == "Page turn after measure 24 added.", "page turn announced")
        items = page.get_by_role("list", name="Breaks", exact=True).get_by_role("listitem")
        assert any(text(i).startswith("Page turn after measure 24") for i in items.all())
        assert 24 in part(app_url, "p-ob")["layout"]["pageBreaks"]
        btn(page, "Back to score").click()
        wait_workspace(page)
        btn(page, "Hide tools").focus()
        press(page, "Shift+E")
        dialog = page.get_by_role("dialog", name="Extract part", exact=True)
        eventually(page, dialog.is_visible, "Shift+E opens Extract part")
        select(dialog.get_by_role("combobox", name="Part", exact=True), "Oboe")
        dialog.get_by_role("button", name="Extract", exact=True).focus()
        press(page, "Enter")
        if btn(page, "Back to score").count() == 0:
            open_tab(page, "Parts")
        chip_ready(page, app_url, "p-ob", "Oboe")
        p = part(app_url, "p-ob")
        if part_region(page, OBOE).count() == 0:
            open_tab(page, "Parts")
            btn(page, "Open Oboe").click()
        part_pages_shown(page, app_url, "p-ob", "Oboe")
        shown = part_region(page, OBOE).get_by_role("group", name=re.compile(r"^Page \d+$")).count()
        btn(page, "Back to score").click()
        open_tab(page, "Parts")
        with page.expect_download() as dl:
            page.get_by_role("link", name=f"Download {OBOE} PDF", exact=True).click()
        data = Path(dl.value.path()).read_bytes()
        assert pdf_pages(data) == p["pageCount"] == shown
        assert f"scores/{SCORE}/parts/p-ob/r{p['revision']}/part.pdf" in S3().keys(f"scores/{SCORE}/parts/p-ob/")
        breaks_honoured(engraving(app_url, "part", "p-ob")[0], [], [24], ONE_STAFF_PAGE_SYSTEMS)


def test_wf_part_extraction_stale_chip(browser: Browser, app_url: str, team: Callable[..., dict]) -> None:
    settle_part(app_url, "p-ob")
    ok(extract(app_url, "p-ob"), 202)
    poll(lambda: part(app_url, "p-ob")["status"] in ("ready", "pdf_pending"), PDF_WAIT_S, "Oboe extracted")
    poll(lambda: part(app_url, "p-ob")["status"] == "ready", PDF_WAIT_S, "Oboe ready")
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        open_tab(page, "Parts")
        eventually(page, lambda: text(chip(page, "Oboe")).startswith("Ready"), "chip Ready")
        p = team()
        append(app_url, p, "st-ob", 2, [note("B", 4)], stamps(app_url))
        eventually(page, lambda: text(chip(page, "Oboe")) == "Ready · Score changed since this PDF", "stale suffix shown")
        assert part(app_url, "p-ob")["stale"] is True


def test_pdf_pending_while_renderer_down(app_url: str, request: pytest.FixtureRequest) -> None:
    base, bucket = renderer_down_copy(request)
    sock = live(base, COMPOSER)
    try:
        rev = ok(extract(base, "p-hp"), 202)["part"]["revision"]
        pending = sock.wait(lambda m: m.get("type") == "part" and m["part"]["id"] == "p-hp" and m["part"]["status"] in ("pdf_pending", "ready"), PDF_WAIT_S, "Harp part leaves rendering")
        time_check = rev
    finally:
        sock.close()
    assert pending["part"]["status"] == "pdf_pending" and pending["part"]["lastError"] == "renderer_unavailable"
    r = call(base, "GET", f"/api/scores/{SCORE}/parts/p-hp/pdf", COPYIST)
    assert err(r, 409, "pdf_not_ready", "The PDF for Harp is not ready.")["status"] == "pdf_pending"
    svg = call(base, "GET", f"/api/scores/{SCORE}/parts/p-hp/pages/1.svg", COPYIST)
    assert svg.status_code == 200 and b"<svg" in svg.content
    assert f"scores/{SCORE}/parts/p-hp/r{rev}/page-1.svg" in bucket.keys(f"scores/{SCORE}/parts/p-hp/")
    assert f"scores/{SCORE}/parts/p-hp/r{rev}/part.pdf" not in bucket.keys(f"scores/{SCORE}/parts/p-hp/"), "a PDF was stored while the renderer is down"


@pytest.mark.timeout(900)
def test_renderer_down_boot_recovers(app_url: str) -> None:
    target, _ = routed("GOTENBERG_URL")
    relay = Relay(target)
    _, url = routed("GOTENBERG_URL", relay.port)
    try:
        with scratch_app({"GOTENBERG_URL": url, "PDF_RETRY_SECONDS": PDF_RETRY_COPY}, True) as (base, bucket):
            sock = poll(lambda: live(base, COMPOSER), SLACK_S, "live session opens on the freshly booted copy")
            try:
                ok(extract(base, "p-va"), 202)
                pending = sock.wait(lambda m: m.get("type") == "part" and m["part"]["id"] == "p-va" and m["part"]["status"] in ("pdf_pending", "ready"), PDF_WAIT_S, "Viola part leaves rendering")
            finally:
                sock.close()
            assert pending["part"]["status"] == "pdf_pending" and pending["part"]["lastError"] == "renderer_unavailable"
            early = call(base, "GET", f"/api/scores/{SCORE}/parts/p-va/pdf", COPYIST)
            assert err(early, 409, "pdf_not_ready")["status"] == "pdf_pending"
            svg = call(base, "GET", f"/api/scores/{SCORE}/parts/p-va/pages/1.svg", COPYIST)
            assert svg.status_code == 200 and b"<svg" in svg.content
            relay.up()
            done = poll(lambda: (x := part(base, "p-va"))["status"] == "ready" and x, int(PDF_RETRY_COPY) + PDF_WAIT_S, "Viola ready after the renderer returns")
            pdf = call(base, "GET", f"/api/scores/{SCORE}/parts/p-va/pdf", COPYIST)
            assert pdf.status_code == 200 and pdf_pages(pdf.content) == done["pageCount"]
    finally:
        relay.down()


def test_renderer_down_engraving_bounded(app_url: str) -> None:
    base = outage("APP_GOTENBERG_DOWN_URL")
    ep = f"/api/scores/{SCORE}/engraving"
    field_err(call(base, "GET", ep, COMPOSER, params={"view": "part", "partId": "p-ob", "limit": SYSTEMS_MAX + 1}), "limit", "Ask for 1 to 16 systems.")
    one = ok(call(base, "GET", ep, COMPOSER, params={"view": "part", "partId": "p-ob", "limit": SYSTEMS_MAX}))
    assert 1 <= len(one["systems"]) <= SYSTEMS_MAX
    systems, times = engraving(base, "part", "p-ob", limit=2)
    assert max(times) < ENGRAVE_BUDGET_S and systems and all("svg" in s["svg"] for s in systems)
    assert [s["index"] for s in systems] == list(range(1, len(systems) + 1))


def test_wf_pdf_outage_renderer_down(browser: Browser, app_url: str, request: pytest.FixtureRequest) -> None:
    base, _ = renderer_down_copy(request)
    with open_seat(browser, base, COPYIST) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        extract_via_dialog(page, "Oboe")
        notice = "Oboe PDF pending: the renderer is unavailable. The preview pages are ready."
        eventually(page, lambda: text(status(page, "Parts")) == notice, "renderer notice", seconds=PDF_WAIT_S)
        eventually(page, lambda: text(chip(page, "Oboe")).startswith("PDF pending"), "chip PDF pending")
        has_link = page.get_by_role("link", name=f"Download {OBOE} PDF", exact=True).count() > 0
        chip_text = text(chip(page, "Oboe"))
        assert not has_link, f"download offered while chip reads {chip_text!r}"
        assert part(base, "p-ob")["status"] == "pdf_pending"
        if part_region(page, OBOE).count() == 0:
            open_tab(page, "Parts")
            btn(page, "Open Oboe").click()
        part_pages_shown(page, base, "p-ob", "Oboe")


def test_wf_pdf_outage_storage_down(browser: Browser, app_url: str) -> None:
    base = outage("APP_MINIO_DOWN_URL")
    settle_part(app_url, "p-ob")
    with open_seat(browser, base, COPYIST) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        extract_via_dialog(page, "Oboe")
        notice = "Oboe could not be engraved: storage is unavailable. Try again later."
        eventually(page, lambda: text(status(page, "Parts")) == notice, "storage notice", seconds=PDF_WAIT_S)
        eventually(page, lambda: text(chip(page, "Oboe")).startswith("Draft"), "chip Draft")
        p = part(base, "p-ob")
        assert p["status"] == "draft" and p["lastError"] == "storage_unavailable"


def test_expression_text_allowlist(app_url: str, team: Callable[..., dict]) -> None:
    p = team()
    stamp = stamps(app_url)
    target = append(app_url, p, "st-tp", 2, [note("G", 4)], stamp)[0]["id"]
    raw = ('<i class="x" onclick="steal()">dolce</i>, <b style="color:red">sempre</b><br/>'
           f"<script>{SCRIPT_BODY}</script><style>{STYLE_BODY}</style>"
           '<span title="t">legato</span> '
           f"{SYMBOLS} <b>open")
    ok(post_ops(app_url, p["token"], [set_op(next(stamp), p["id"], "st-tp", 2, target, "text", raw)]))
    stored = next(e for e in voice(app_url, "st-tp", 2) if key(e["id"]) == key(target))["text"]
    tags = re.findall(r"<\s*(/?)\s*([A-Za-z][A-Za-z0-9]*)([^>]*)>", stored)
    assert {t[1].lower() for t in tags} <= {"i", "b", "br"} and all(t[2].strip() in ("", "/") for t in tags), stored
    assert SCRIPT_BODY not in stored and STYLE_BODY not in stored and all(w in stored for w in ("dolce", "sempre", "legato"))
    plain = re.sub(r"</?(?:i|b|br)\s*/?>", "", stored)
    assert "<" not in plain and ">" not in plain and not re.search(r"&(?![#A-Za-z0-9]+;)", plain), f"unescaped characters in {plain!r}"
    assert SYMBOLS in html.unescape(plain) and stored.endswith("</b>")
    for tag in ("i", "b"):
        assert len(re.findall(rf"<{tag}>", stored)) == len(re.findall(rf"</{tag}>", stored))
    ok(post_ops(app_url, p["token"], [set_op(next(stamp), p["id"], "st-tp", 2, target, "text", "😀" * TEXT_MAX)]))
    ok(post_ops(app_url, p["token"], [set_op(next(stamp), p["id"], "st-tp", 2, target, "text", "<i>" + "a" * TEXT_MAX + "</i>")]))
    field_err(post_ops(app_url, p["token"], [set_op(next(stamp), p["id"], "st-tp", 2, target, "text", "😀" * (TEXT_MAX + 1))]),
              "ops[0].value", "Expression text is limited to 200 characters.")
    ok(post_ops(app_url, p["token"], [set_op(next(stamp), p["id"], "st-tp", 2, target, "text", raw)]))
    svgs = "".join(s["svg"] for s in engraving(app_url)[0])
    assert "legato" in svgs and SCRIPT_BODY not in svgs and "<script" not in svgs
    settle_part(app_url, "p-tp")
    ok(extract(app_url, "p-tp"), 202)
    poll(lambda: part(app_url, "p-tp")["status"] == "ready", PDF_WAIT_S, "Trumpet part ready")
    words = pdf_text(call(app_url, "GET", f"/api/scores/{SCORE}/parts/p-tp/pdf", COPYIST).content)
    assert "legato" in words and "dolce" in words and SCRIPT_BODY not in words


def test_player_annotation_flood_throttled(app_url: str, team: Callable[..., dict]) -> None:
    p = team("player", ["st-hp-r"])
    stamp = stamps(app_url)
    target = append(app_url, p, "st-hp-r", 2, [note("C", 4)], stamp)[0]
    mk = lambda n, value="<i>dolce</i>": [set_op(next(stamp), p["id"], "st-hp-r", 2, target["id"], "text", value) for _ in range(n)]
    stored = lambda: next(e for e in voice(app_url, "st-hp-r", 2) if key(e["id"]) == key(target["id"]))["text"]
    open_window(app_url, p, mk)
    ok(post_ops(app_url, p["token"], mk(BATCH_MAX)))
    ok(post_ops(app_url, p["token"], mk(BATCH_MAX - 1)))
    r = post_ops(app_url, p["token"], mk(21, "refused"))
    err(r, 429, "rate_limited", "Too many edits at once. Waiting to send the rest.")
    assert int(r.headers["Retry-After"]) >= 1
    assert stored() == "<i>dolce</i>", "a refused batch changed the text"
    late = mk(1, f"<b>{LATE}</b><script>x()</script>")
    poll(lambda: post_ops(app_url, p["token"], late).status_code == 200, WINDOW_S + SLACK_S, "text edit accepted after the wait")
    assert stored() == f"<b>{LATE}</b>"


@pytest.mark.timeout(600)
def test_wf_player_part_phone(browser: Browser, app_url: str) -> None:
    settle_part(app_url, "p-ob")
    with open_seat(browser, app_url, OBOIST) as page:
        page.set_viewport_size(PHONE)
        eventually(page, part_region(page, OBOE).is_visible, "oboist on Oboe part")
        eventually(page, page.get_by_role("region", name="System strip", exact=True).is_visible, "part shown as a strip")
        layout(page)
        btn(page, "Back to score").click()
        wait_workspace(page)
        choose_entry(page, "Oboe", 1)
        press(page, "End")
        target = voice(app_url, "st-ob", 1)[-1]["id"]
        tap(page.get_by_role("toolbar", name="Note pad", exact=True).get_by_role("button", name="Add text", exact=True))
        dialog = page.get_by_role("dialog", name="Expression text", exact=True)
        dialog.get_by_role("textbox", name="Text", exact=True).fill(f"<i>{PHRASE}</i>")
        preview = dialog.get_by_role("region", name="Preview", exact=True)
        eventually(page, lambda: preview.evaluate("r => Array.from(r.getElementsByTagName('*')).concat([r]).some(e => getComputedStyle(e).fontStyle === 'italic' && e.textContent.includes('dolce'))"), "preview italic")
        dialog.get_by_role("button", name="Save text", exact=True).click()
        eventually(page, lambda: text(status(page, "Text")) == "Text saved.", "Text saved")
        eventually(page, lambda: next((e for e in voice(app_url, "st-ob", 1) if key(e["id"]) == key(target)), {}).get("text") == f"<i>{PHRASE}</i>", "oboe expression text stored")
        btn(page, "Play").click()
        timer = page.get_by_role("timer", name="Playback position", exact=True)
        eventually(page, lambda: btn(page, "Stop").is_visible() and re.match(r"^Measure \d+ · Beat \d+(\.\d{1,3})?$", text(timer)), "playing")
        btn(page, "Stop").click()
        extract_via_dialog(page, "Oboe")
        chip_ready(page, app_url, "p-ob", "Oboe")


def test_wf_player_part_markup_preview(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, VIOLINIST) as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, part_region(page, VIOLIN_ONE).is_visible, "violinist on their part")
        btn(page, "Back to score").click()
        wait_workspace(page)
        choose_entry(page, "Violin I", 1)
        press(page, "End")
        target = voice(app_url, "st-vn1", 1)[-1]["id"]
        press(page, "x")
        dialog = page.get_by_role("dialog", name="Expression text", exact=True)
        dialog.get_by_role("textbox", name="Text", exact=True).fill(f"<b>{LOUD}</b> <{OTHER_TAG}>{MARK}</{OTHER_TAG}><script>{SCRIPT_BODY}</script>")
        preview = dialog.get_by_role("region", name="Preview", exact=True)
        eventually(page, lambda: LOUD in text(preview) and SCRIPT_BODY not in text(preview), "preview filtered")
        dialog.get_by_role("button", name="Save text", exact=True).click()
        eventually(page, lambda: text(status(page, "Text")) == "Text saved.", "Text saved")
        stored = eventually(page, lambda: next((e for e in voice(app_url, "st-vn1", 1) if key(e["id"]) == key(target)), {}).get("text"), "violin expression text stored")
        assert f"<b>{LOUD}</b>" in stored and MARK in stored and OTHER_TAG not in tag_names(stored) and SCRIPT_BODY not in stored


BANK_CASES = {"limit-wav": "accept", "max-name": "accept", "sfz-comments": "accept", "too-large": "413", "path-name": "fileName",
              "bad-extension": "fileName", "long-name": "fileName", "unknown-staff": "staffId", "bad-root": "root",
              "disguised-wav": "415", "disguised-sfz": "415"}


@pytest.mark.parametrize("case", list(BANK_CASES), ids=list(BANK_CASES))
def test_sample_bank_checks(app_url: str, case: str) -> None:
    stem = uuid.uuid4().hex[:10]
    name, data, staff, root = f"{stem}.wav", wav_bytes(), "st-ob", None
    if case == "limit-wav":
        data = wav_bytes(BANK_LIMIT)
    elif case == "max-name":
        name = stem + "a" * (FILE_NAME_MAX - len(stem) - 4) + ".WAV"
    elif case == "sfz-comments":
        name, data = f"{stem}.sfz", SFZ_TEXT
    elif case == "too-large":
        data = wav_bytes(BANK_LIMIT + 1)
    elif case == "path-name":
        name = f"../{stem}.wav"
    elif case == "bad-extension":
        name = f"{stem}.mp3"
    elif case == "long-name":
        name = stem + "a" * (FILE_NAME_MAX - len(stem) - 3) + ".wav"
    elif case == "unknown-staff":
        staff = "st-nowhere"
    elif case == "bad-root":
        root = "H9"
    elif case == "disguised-wav":
        data = SFZ_TEXT
    elif case == "disguised-sfz":
        name = f"{stem}.sfz"
    r = upload(app_url, name, data, staff, root)
    outcome = BANK_CASES[case]
    if outcome == "accept":
        bank = ok(r, 201)["bank"]
        assert bank["status"] == "loaded" and bank["bytes"] == len(data) and bank["kind"] == ("sfz" if name.endswith(".sfz") else "wav")
        stored = bank_keys(name)
        assert stored == [f"scores/{SCORE}/banks/{bank['id']}/{name}"] and S3().get(stored[0]) == data
        return
    if outcome == "413":
        err(r, 413, "too_large", "Sample banks are limited to 8,000,000 bytes.")
    elif outcome == "415":
        err(r, 415, "unsupported_type", ERR_BAD_TYPE)
    else:
        msgs = {"fileName": "Use a plain file name ending in .wav or .sfz.", "staffId": "Choose a staff.", "root": "Use a pitch like A4, C#5 or Bb3."}
        field_err(r, outcome, msgs[outcome])
    tail_name = name.rsplit("/", 1)[-1]
    assert not bank_keys(tail_name) and not banks_named(app_url, name) and not banks_named(app_url, tail_name)


def test_bank_loaded_only_after_storage(browser: Browser, app_url: str) -> None:
    name, data = bank_name("wav"), wav_bytes()
    bank = ok(upload(app_url, name, data, root="C#5"), 201)["bank"]
    assert bank["status"] == "loaded" and S3().get(f"scores/{SCORE}/banks/{bank['id']}/{name}") == data
    content = call(app_url, "GET", f"/api/scores/{SCORE}/banks/{bank['id']}/content", OBOIST)
    assert content.status_code == 200 and content.headers["content-type"].startswith("audio/wav") and content.content == data
    assert banks_named(app_url, name)
    down = outage("APP_MINIO_DOWN_URL")
    lost = bank_name("wav")
    err(upload(down, lost, data), 503, "storage_unavailable", ERR_STORAGE)
    assert not bank_keys(lost) and not banks_named(app_url, lost)
    ui = bank_name("wav")
    with open_seat(browser, down, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        open_tab(page, "Sample banks")
        select(page.get_by_role("combobox", name="Staff for bank", exact=True), "Oboe")
        page.get_by_role("textbox", name="Root pitch", exact=True).fill("A4")
        page.get_by_label("Sample bank file").set_input_files({"name": ui, "mimeType": "audio/wav", "buffer": data})
        btn(page, "Upload sample bank").click()
        eventually(page, lambda: text(status(page, "Sample banks")) == f"{ui} was refused: {ERR_STORAGE}", "storage error shown")
        items = page.get_by_role("list", name="Sample banks", exact=True).get_by_role("listitem")
        assert not any(ui in text(i) and "Loaded" in text(i) for i in items.all())
    assert not bank_keys(ui) and not banks_named(app_url, ui)


@pytest.mark.timeout(900)
def test_bank_upload_recovers_with_storage(app_url: str) -> None:
    target, _ = routed("S3_ENDPOINT")
    relay = Relay(target)
    _, url = routed("S3_ENDPOINT", relay.port)
    try:
        with app_copy({"S3_ENDPOINT": url}) as base:
            lost = bank_name("wav")
            err(upload(base, lost, wav_bytes()), 503, "storage_unavailable", ERR_STORAGE)
            assert not bank_keys(lost) and not banks_named(app_url, lost)
            relay.up()
            back = bank_name("wav")
            poll(lambda: upload(base, back, wav_bytes()).status_code == 201, SLACK_S, "upload succeeds once storage returns")
            assert bank_keys(back) and banks_named(app_url, back)
            assert not banks_named(app_url, lost)
    finally:
        relay.down()


def test_wf_sample_banks_upload_wav(browser: Browser, app_url: str) -> None:
    name, data = bank_name("wav"), wav_bytes()
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        fetched: list[str] = []
        page.on("request", lambda req: fetched.append(urlsplit(req.url).path))
        open_tab(page, "Sample banks")
        select(page.get_by_role("combobox", name="Staff for bank", exact=True), "Oboe")
        page.get_by_role("textbox", name="Root pitch", exact=True).fill("A4")
        page.get_by_label("Sample bank file").set_input_files({"name": name, "mimeType": "audio/wav", "buffer": data})
        items = page.get_by_role("list", name="Sample banks", exact=True).get_by_role("listitem")
        with held(page, f"**/api/scores/{SCORE}/banks?*") as pending:
            btn(page, "Upload sample bank").click()
            eventually(page, lambda: text(status(page, "Sample banks")) == f"Uploading {name}…", "Uploading announced")
            eventually(page, lambda: any(text(i) == f"{name} · Oboe · Uploading…" for i in items.all()), "Uploading item")
            assert not any(text(i) == f"{name} · Oboe · Loaded" for i in items.all()) and not bank_keys(name)
            pending.release()
        eventually(page, lambda: any(text(i) == f"{name} · Oboe · Loaded" for i in items.all()), "Loaded item")
        eventually(page, lambda: text(status(page, "Sample banks")) == f"{name} loaded.", "loaded announced")
        bank = banks_named(app_url, name)[0]
        assert bank_keys(name)
        btn(page, "Play").click()
        eventually(page, lambda: f"/api/scores/{SCORE}/banks/{bank['id']}/content" in fetched, "playback fetches the Oboe bank")
        btn(page, "Stop").click()


def test_wf_sample_banks_newest_bank_plays(browser: Browser, app_url: str) -> None:
    ok(upload(app_url, bank_name("wav"), wav_bytes()), 201)
    name, data = bank_name("wav"), wav_bytes()
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        btn(page, "Play").click()
        eventually(page, btn(page, "Stop").is_visible, "playing with the current Oboe bank")
        btn(page, "Stop").click()
        eventually(page, btn(page, "Play").is_visible, "stopped")
        fetched: list[str] = []
        page.on("request", lambda req: fetched.append(urlsplit(req.url).path))
        open_tab(page, "Sample banks")
        select(page.get_by_role("combobox", name="Staff for bank", exact=True), "Oboe")
        page.get_by_role("textbox", name="Root pitch", exact=True).fill("A4")
        page.get_by_label("Sample bank file").set_input_files({"name": name, "mimeType": "audio/wav", "buffer": data})
        btn(page, "Upload sample bank").click()
        eventually(page, lambda: text(status(page, "Sample banks")) == f"{name} loaded.", "loaded announced")
        new = banks_named(app_url, name)[0]
        btn(page, "Play").click()
        eventually(page, lambda: f"/api/scores/{SCORE}/banks/{new['id']}/content" in fetched, "the next Play fetches the newest Oboe bank")
        btn(page, "Stop").click()


def test_wf_sample_banks_disguised_file(browser: Browser, app_url: str) -> None:
    name = bank_name("wav")
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        open_tab(page, "Sample banks")
        select(page.get_by_role("combobox", name="Staff for bank", exact=True), "Oboe")
        page.get_by_label("Sample bank file").set_input_files({"name": name, "mimeType": "audio/wav", "buffer": SFZ_TEXT})
        btn(page, "Upload sample bank").click()
        eventually(page, lambda: text(status(page, "Sample banks")) == f"{name} was refused: {ERR_BAD_TYPE}", "refusal shown")
    assert not bank_keys(name) and not banks_named(app_url, name)


POSITION = re.compile(r"^Measure (\d+) · Beat (\d+(?:\.\d{1,3})?)$")


def test_playback_follows_audio_clock(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        timer = page.get_by_role("timer", name="Playback position", exact=True)
        btn(page, "Play").click()
        first = eventually(page, lambda: btn(page, "Stop").is_visible() and POSITION.match(text(timer)), "playback position shown")
        assert int(first.group(1)) == 1
        seen: list[tuple[int, float]] = []

        def progressed() -> bool:
            m = POSITION.match(text(timer))
            if m:
                seen.append((int(m.group(1)), float(m.group(2))))
            return bool(m) and int(m.group(1)) >= 2

        eventually(page, progressed, "playhead reaches measure 2")
        assert seen == sorted(seen), f"position went backwards: {seen}"
        btn(page, "Stop").click()
        eventually(page, btn(page, "Play").is_visible, "stopped")
        events = voice(app_url, "st-ob", 1)
        idx = [key(e["id"]) for e in events].index((4, "seed"))
        choose_entry(page, "Oboe", 1)
        press(page, "Home")
        for _ in range(idx + 1):
            press(page, "ArrowRight")
        stale = text(timer)
        press(page, "Space")
        start = eventually(page, lambda: btn(page, "Stop").is_visible() and text(timer) != stale and POSITION.match(text(timer)), "Space plays from the caret")
        assert int(start.group(1)) == events[idx]["measure"]
        press(page, "Space")
        eventually(page, btn(page, "Play").is_visible, "Space stops")


def test_playback_reduced_motion(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER, reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        timer = page.get_by_role("timer", name="Playback position", exact=True)
        btn(page, "Play").click()
        eventually(page, lambda: btn(page, "Stop").is_visible() and POSITION.match(text(timer)), "playing")
        advance(page, 1000)
        assert animations(editor(page)) == [], "playhead animates under reduced motion"
        eventually(page, lambda: (m := POSITION.match(text(timer))) and int(m.group(1)) >= 2, "readout reaches measure 2")
        btn(page, "Stop").click()


def test_bank_fetch_unreachable(browser: Browser, app_url: str) -> None:
    bank = ok(upload(app_url, bank_name("wav"), wav_bytes()), 201)["bank"]
    base = outage("APP_MINIO_DOWN_URL")
    err(call(base, "GET", f"/api/scores/{SCORE}/banks/{bank['id']}/content", OBOIST), 503, "storage_unavailable", ERR_STORAGE)
    with open_seat(browser, base, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        btn(page, "Play").click()
        notice = eventually(page, lambda: (t := text(status(page, "Playback"))).startswith("Sample bank unavailable — playing ") and t, "synth fallback notice")
        assert "Oboe" in notice and notice.endswith(" with the built-in synth.")
        btn(page, "Stop").click()


@pytest.mark.timeout(900)
def test_synth_fallback_and_recovery(browser: Browser, app_url: str, team: Callable[..., dict]) -> None:
    ok(upload(app_url, bank_name("wav"), wav_bytes()), 201)
    writer = team()
    lead_in = 19 * WHOLE
    have = sum(e["ticks"] for e in voice(app_url, "st-ob", 1))
    late_notes = [note("E", 5, duration="whole") for _ in range(5)]
    send_chain(app_url, lambda: writer, "st-ob", 1, (fill_events(lead_in - have) if lead_in > have else []) + late_notes, stamps(app_url))
    target, _ = routed("S3_ENDPOINT")
    relay = Relay(target)
    _, url = routed("S3_ENDPOINT", relay.port)
    try:
        with app_copy({"S3_ENDPOINT": url}) as base:
            with open_seat(browser, base, COMPOSER) as page:
                page.set_viewport_size(DESKTOP)
                wait_workspace(page)
                btn(page, "Play").click()
                notice = eventually(page, lambda: (t := text(status(page, "Playback"))).startswith("Sample bank unavailable — playing ") and t, "synth fallback notice")
                assert notice.endswith(" with the built-in synth.") and "Oboe" in notice
                relay.up()
                restored = eventually(page, lambda: (t := text(status(page, "Playback"))).startswith("Samples restored for ") and t, "samples restored", seconds=UI_WAIT * 2)
                assert "Oboe" in restored
                btn(page, "Stop").click()
    finally:
        relay.down()


def playback_seconds(s: dict) -> float:
    info = measure_info(s)
    tempos = sorted(s["tempos"], key=lambda t: t["measure"])
    total = 0.0
    for m in range(1, s["measureCount"] + 1):
        bpm = [t for t in tempos if t["measure"] <= m][-1]["bpm"]
        total += info(m)[0] / (WHOLE / QUARTERS_PER_WHOLE) * 60 / bpm
    return total


@pytest.mark.timeout(1800)
def test_wf_playback_storage_outage(browser: Browser, app_url: str) -> None:
    ok(upload(app_url, bank_name("wav"), wav_bytes()), 201)
    base = outage("APP_MINIO_DOWN_URL")
    s = score(base)
    with open_seat(browser, base, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        timer = page.get_by_role("timer", name="Playback position", exact=True)
        btn(page, "Play").click()
        began = time.monotonic()
        eventually(page, lambda: text(status(page, "Playback")).startswith("Sample bank unavailable — playing "), "fallback notice")
        reached: list[int] = []
        started: list[bool] = []

        def finished() -> bool:
            m = POSITION.match(text(timer))
            if m:
                reached.append(int(m.group(1)))
            if btn(page, "Stop").is_visible():
                started.append(True)
                return False
            return bool(started) and btn(page, "Play").is_visible()

        eventually(page, finished, "playback reaches the end", seconds=playback_seconds(s) + SLACK_S * 4)
        played = time.monotonic() - began
        assert reached and (max(reached) == s["measureCount"] or played >= playback_seconds(s) * 0.9), \
            f"playback stopped at measure {max(reached or [0])} after {played:.0f} s of {playback_seconds(s):.0f} s"


def test_wf_playback_shortcuts(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        btn(page, "Hide tools").focus()
        press(page, "Shift+P")
        eventually(page, btn(page, "Stop").is_visible, "Shift+P plays")
        press(page, "Shift+P")
        eventually(page, btn(page, "Play").is_visible, "Shift+P stops")
        btn(page, "Add staff").click()
        field = page.get_by_role("dialog", name="Add staff", exact=True).get_by_role("textbox", name="Staff name", exact=True)
        eventually(page, lambda: field.evaluate("e => e === document.activeElement"), "Staff name focused")
        press(page, "Shift+P")
        assert "P" in field.input_value() and btn(page, "Play").count() == 1
        press(page, "Escape")


@pytest.mark.timeout(900)
def test_live_sync_paused_and_restored(browser: Browser, app_url: str, team: Callable[..., dict]) -> None:
    target, _ = routed("VALKEY_URL")
    relay = Relay(target)
    _, url = routed("VALKEY_URL", relay.port)
    try:
        with app_copy({"VALKEY_URL": url}) as base:
            sock = live(base, COMPOSER)
            assert sock.wait(lambda m: m.get("type") == "welcome", HTTP_TIMEOUT, "welcome")["live"] is False
            sock.close()
            p = team(base=base)
            with open_seat(browser, base, COMPOSER) as pc, open_seat(browser, base, COPYIST) as pj:
                for page in (pc, pj):
                    page.set_viewport_size(DESKTOP)
                    wait_workspace(page, PAUSED_COPY)
                open_tab(pj, "History")
                feed = pj.get_by_role("feed", name="Operation history", exact=True)
                eventually(pj, lambda: feed.get_by_role("article").count() > 0, "history loaded")
                op = append(base, p, "st-vn2", 1, [note("E", 5)], stamps(base))[0]
                assert any(key(e["op"]["id"]) == key(op["id"]) for e in ops_after(app_url, score(app_url)["lastSeq"] - 5)), "edit not in Postgres"
                waited = 0
                arrived = lambda: pj.get_by_role("button", name=re.compile(r"^Show \d+ new changes$")).count() == 1 or any(text(a).startswith(f"{p['name']} · ") for a in feed.get_by_role("article").all())
                for _ in range(CATCH_UP_MS // STEP_MS + 1):
                    if arrived():
                        break
                    advance(pj, STEP_MS)
                    waited += STEP_MS
                assert arrived(), f"edit did not reach the other editor within {CATCH_UP_MS} ms of page time"
                relay.up()
                eventually(pc, lambda: text(status(pc, "Live sync")) in ("Live sync restored.", "Live"), "banner clears", seconds=VALKEY_RETRY_S + SLACK_S)
                eventually(pj, lambda: text(status(pj, "Live sync")) == "Live", "banner returns to Live", seconds=VALKEY_RETRY_S + SLACK_S)
    finally:
        relay.down()


@pytest.mark.timeout(900)
def test_paused_banner_survives_restored_timer(browser: Browser, app_url: str) -> None:
    target, _ = routed("VALKEY_URL")
    relay = Relay(target)
    _, url = routed("VALKEY_URL", relay.port)
    try:
        with app_copy({"VALKEY_URL": url}) as base, open_seat(browser, base, COMPOSER) as page:
            page.set_viewport_size(DESKTOP)
            wait_workspace(page, PAUSED_COPY)
            relay.up()
            eventually(page, lambda: text(status(page, "Live sync")) == "Live sync restored.", "restored notice shown",
                       seconds=VALKEY_RETRY_S + SLACK_S)
            relay.down()
            poll(lambda: sync(base)["live"] is False, VALKEY_RETRY_S + SLACK_S, "the server reports live sync paused again")
            eventually(page, lambda: text(status(page, "Live sync")) == PAUSED_COPY, "paused banner back")
            advance(page, (RESTORED_S + 1) * 1000)
            assert text(status(page, "Live sync")) == PAUSED_COPY, "the restored notice's timer replaced the paused banner while sync is paused"
    finally:
        relay.down()


def test_catch_up_pages_stable_while_paused(app_url: str, team: Callable[..., dict]) -> None:
    base = outage("APP_VALKEY_DOWN_URL")
    p = team(base=base)
    start = score(base)["lastSeq"]
    stamp = stamps(base)
    first = append(base, p, "st-vn2", 2, [note("C", 4), note("D", 4), note("E", 4), note("F", 4), note("G", 4)], stamp)
    late: list[dict] = []
    seqs: list[int] = []
    ids: set[tuple[int, str]] = set()
    cursor = start
    for i in range(ENGRAVE_PAGES_MAX):
        body = ok(call(base, "GET", f"/api/scores/{SCORE}/ops", COMPOSER, params={"afterSeq": cursor, "limit": 2}))
        if not body["ops"]:
            break
        assert len(body["ops"]) <= 2
        seqs += [e["seq"] for e in body["ops"]]
        ids |= {key(e["op"]["id"]) for e in body["ops"]}
        cursor = body["ops"][-1]["seq"]
        if i == 0:
            late = append(base, p, "st-vn2", 2, [note("A", 4)], stamp)
    assert seqs == sorted(set(seqs)), "catch-up pages repeat or are out of order"
    assert {key(o["id"]) for o in first + late} <= ids, "catch-up skipped an operation"


def test_paused_banner_server_decided(browser: Browser, app_url: str) -> None:
    base = outage("APP_VALKEY_DOWN_URL")
    assert sync(base)["live"] is False
    with open_seat(browser, base, COMPOSER) as page:
        page.clock.set_system_time(SKEWED)
        page.set_viewport_size(DESKTOP)
        wait_workspace(page, PAUSED_COPY)
        page.clock.set_system_time(SKEWED_LATER)
        advance(page, CATCH_UP_MS)
        assert text(status(page, "Live sync")) == PAUSED_COPY
    with open_seat(browser, app_url, COMPOSER) as page:
        page.clock.set_system_time(SKEWED)
        page.set_viewport_size(DESKTOP)
        wait_workspace(page, "Live")


def test_wf_live_sync_paused_editing(browser: Browser, app_url: str) -> None:
    base = outage("APP_VALKEY_DOWN_URL")
    start = score(app_url)["lastSeq"]
    with open_seat(browser, base, COMPOSER) as pc, open_seat(browser, base, COPYIST) as pj:
        for page in (pc, pj):
            page.set_viewport_size(DESKTOP)
            wait_workspace(page, PAUSED_COPY)
            open_tab(page, "History")
        for page, staff in ((pc, "Bassoon"), (pj, "Double Bass")):
            choose_entry(page, staff, 1)
            press(page, "End")
            press(page, "c")
            advance(page, 500)
        recorded: dict[str, dict] = {}
        for who, sid in (("c-mara", "st-bn"), ("c-jun", "st-db")):
            recorded[who] = poll(lambda: next((e for e in ok(call(app_url, "GET", f"/api/scores/{SCORE}/history", COMPOSER, params={"staffId": sid, "limit": 10}))["entries"]
                                               if e["author"]["id"] == who and e["seq"] > start), None), SLACK_S, f"{who}'s note recorded")
        for page, who in ((pc, "c-jun"), (pj, "c-mara")):
            e = recorded[who]
            want = f"{e['author']['name']} · {e['summary']} · {e['staffName']}, measure {e['measure']}, beat {beat_text(e['beat'])} · {hhmmss(e['at'])}"
            feed = page.get_by_role("feed", name="Operation history", exact=True)
            show = page.get_by_role("button", name=re.compile(r"^Show \d+ new changes$"))

            def listed() -> bool:
                if want in [text(a) for a in feed.get_by_role("article").all()]:
                    return True
                if show.count():
                    show.click()
                return False

            eventually(page, listed, f"{who}'s own note listed on the other editor", seconds=UI_WAIT)
    authors = {(e["author"]["id"], e["op"]["staffId"]) for e in ops_after(app_url, start) if e["op"]["type"] == "insert"}
    assert ("c-mara", "st-bn") in authors and ("c-jun", "st-db") in authors


def test_wf_live_sync_reload_keeps_edits(browser: Browser, app_url: str) -> None:
    base = outage("APP_VALKEY_DOWN_URL")
    with open_seat(browser, base, COMPOSER) as page:
        page.set_viewport_size(DESKTOP)
        wait_workspace(page, PAUSED_COPY)
        choose_entry(page, "Bassoon", 2)
        press(page, "End")
        before = voice(app_url, "st-bn", 2)
        press(page, "g")
        new_events(page, app_url, "st-bn", 2, before, 1)
        page.reload()
        wait_workspace(page, PAUSED_COPY)
        assert len(voice(app_url, "st-bn", 2)) == len(before) + 1


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"} and data["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in data.values())


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"notices omit {missing}"
    assert all(f in notices for f in FONTS)


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert not bad, f"disallowed licences {bad}"
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_persistence_only_in_services() -> None:
    banned = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "@seald-io/nedb", "level", "lmdb", "mongodb", "mysql", "mysql2", "pouchdb"}
    assert not banned & {p.name for p in shipped_packages()}
    files = app_files(Path(DEPLOYED_APP), (".sqlite", ".sqlite3", ".db")) + app_files(Path("/app"), (".sqlite", ".sqlite3", ".db"))
    assert not files, f"database files on disk: {files}"
    assert Postgres().tables()


def test_if_services_untouched(app_url: str, valkey: Valkey) -> None:
    assert Postgres().tables()
    assert S3().keys(f"scores/{SCORE}/") is not None
    valkey.keys("fairline:*")
    assert sync(app_url)["live"] is True


def test_if_lockfile() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    assert lock["packages"], "package-lock.json lists no packages"
    assert json.loads(Path("/app/run.json").read_text())["install"].strip().startswith("npm ci")


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    with open_seat(browser, app_url, COMPOSER) as page:
        urls: list[str] = []
        page.on("request", lambda req: urls.append(req.url))
        page.reload()
        page.set_viewport_size(DESKTOP)
        wait_workspace(page)
        advance(page, 2000)
    foreign = [u for u in urls if u.startswith(("http:", "https:", "ws:", "wss:")) and not same_origin(u.replace("ws", "http", 1) if u.startswith("ws") else u, app_url)]
    assert not foreign, f"third-party requests: {foreign}"


def test_if_typescript_only() -> None:
    config = re.compile(r"(^|[./])(config|rc)\.(c|m)?js$|^\.[a-z]+rc\.(c|m)?js$")
    tooling = {"scripts", "tools", "public", "static", "vendor"}
    js = [p for p in app_files(Path("/app"), (".js", ".jsx", ".mjs", ".cjs"))
          if not config.search(p.name) and not tooling & set(p.relative_to("/app").parts[:-1])]
    assert not js, f"JavaScript application files: {[str(p) for p in js]}"
