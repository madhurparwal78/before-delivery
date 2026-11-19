from __future__ import annotations

import base64
import contextlib
import json
import math
import os
import random
import re
import selectors
import socket
import struct
import threading
import time
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    S3,
    Postgres,
    advance,
    check,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    motion,
    open_app,
    sample,
    scene_frames,
    select,
    shipped_packages,
    style,
    tab_order,
    tap,
    unique,
)


APP_DIR = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")
HTTP_TIMEOUT = 180
WAIT_S = 45
STEP_S = 0.1
SHORT_MS = 2000
LATENCY_SLACK_S = 0.5
PX = 1
FEED_STEP_S = 0.25
GROUND_DELTA = 24
TAB_PRESSES = 40
HERO_STEP_MS = 500
BIG_QUOTA = 600
MEMBER_PASSWORD = "fresh-member-pass-1"
DEVICE_CLOCK = datetime(2031, 3, 15, 4, 0, tzinfo=timezone.utc)
DOWN_PORT = 9999

_pause = threading.Event().wait


PASSWORD = "lowfield-demo-2026"
DEFAULT_PORT = 4173
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
BREAK_TWO = 768
BREAK_THREE = 1200
DEBOUNCE_MS = 250
TOUCH_PX = 44
BINS = 64
HISTORY_ROWS = 240
STRIP_PX = 48
BAR_TOLERANCE_PX = 2
SIGNAL_POSITIONS = [160, 480, 800, 1120, 1440]
STAGES = ["Capture", "Stream", "Recognise", "Review", "Meter"]
MORPH_MIN_MS = 300
MORPH_MAX_MS = 500
MORPH_START_S = 3
REDUCED_STEP_MS = 1000
JSON_LIMIT = 65536
MULTIPART_LIMIT = 50_400_000
SAMPLE_RATE = 16000
WS_MESSAGE_LIMIT = 64_000
QUOTA_EVERY_S = 2
HALT_S = 1
REVOKE_S = 2
RELEASE_S = 5
TONE_ROWS = 300
TONE_PEAK_BIN = 35
FLAG_BELOW = 0.85
MEDIUM_FROM = 0.60
AUDIO_LIMIT = 50_000_000
SIDECAR_LIMIT = 200_000
EVENT_S = 2
SCALE_MINIMUM_S = 15
PILOT_CENTS = 6
SCALE_CENTS = 3
DECISION_S = 10
WORD_MS = 300
WAV_HEADER = 44
BYTES_PER_MS = 32
PROBE_S = 5
RETRY_S = 5
RECOVER_S = 10
TONE_S = 10
QUOTA_MAX = 1_000_000
NAME_MAX = 60
LABEL_MAX = 80
CORRECTION_MAX = 500
SYNTH_MAX = 1000
QUERY_MAX = 100
TRIAL_MAX = 100
EMAIL_MAX = 200
IDEMPOTENCY_MAX = 100
PASSWORD_MIN = 12
CALC_MAX_S = 3600
SHORT_IDLE_S = 5
SHORT_CAP_S = 20
CLOSE_CODES = {"closed": 1000, "idle_closed": 4000, "quota_halted": 4002, "revoked": 4003}
OVERSIZE_CODE = 1009
FRAMING_CODE = 1007

BILLING_PREFIX = os.environ.get("LOWFIELD_BILLING_PREFIX", "lowfield")
SHORT_PREFIX = "lowfield-short"
KBDOWN_PREFIX = "lowfield-kbdown"
CATALOG_PLAN = {"pilot": "lowfield-pilot", "scale": "lowfield-scale"}
PLAN_LABEL = {"pilot": "Pilot", "scale": "Scale"}

INES = "ines.okafor@harbourline.example"
TEO = "teo.marlow@harbourline.example"
RHEA = "rhea.santos@harbourline.example"
ARI = "ari.lindqvist@harbourline.example"
JO = "jo.adeyemi@harbourline.example"
KIM = "kim.baptiste@harbourline.example"
NADIA = "nadia.voss@corvane.example"
WARD = "Ward Dictation"
CLINIC = "Clinic Intake"
SEED_WARD_KEY = "lf_live_00000000000000000000000000000a01"
SEED_DICTATION = "Seed dictation 01"
SEED_CUES = [
    (0, 3000, "patient@0.97 reports@0.95 dizziness@0.91"),
    (3000, 6000, "after@0.93 starting@0.88 lisinopril@0.52"),
    (6000, 9000, "fifteen@0.71 milligrams@0.90 daily@0.94"),
    (9000, 12000, "review@0.96 in@0.93 two@0.58 weeks@0.90"),
]
SEED_SECONDS = 12


def cue_text(index: int) -> str:
    return " ".join(w.split("@")[0] for w in SEED_CUES[index][2].split(" "))

SESSION_COPY = {
    "connecting": "Session connecting.",
    "live": "Session live.",
    "closed": "Session closed.",
    "cap": "Session closed: time limit reached.",
    "idle_closed": "Session closed: no audio received.",
    "quota_halted": "Session halted: project quota reached.",
    "revoked": "Session ended: API key revoked.",
}
BILLING_BANNER = "Billing is unreachable. Figures marked Pending will confirm automatically once it's back."
STORAGE_BANNER = "Audio storage is unreachable. Playback and uploads will resume once it's back, and nothing you've typed is lost."
PLAN_UNREACHABLE = "Billing is unreachable, so your plan hasn't changed. Try again in a minute."
TRIAL_OK = "Trial request received. We reply within two working days."
CALC_ERROR = "Enter a length from 0 to 3600 seconds."
SIGN_IN_ERROR = "That email and password don't match."
INVITE_USED = "This invitation has already been used."
PASSWORD_ERROR = "Use at least 12 characters."
PROJECT_CREATED = "Project created. Issue its first API key."
KEY_CREATED = "Key created. Copy it now; it won't be shown again."
KEY_NAME_ERROR = "Enter a key name of up to 60 characters."
PROJECT_NAME_ERROR = "Enter a project name of up to 60 characters."
NAME_TAKEN = "A project with this name already exists."
QUOTA_ERROR = "Enter a whole number of minutes from 1 to 1000000."
QUOTA_SAVED = "Quota saved."
AUDIO_ERROR = "Upload a 16 kHz, 16-bit PCM WAV file with one or two channels."
AUDIO_TOO_LARGE = "Audio files can be up to 50,000,000 bytes."
SIDECAR_ERROR = "The sidecar must be WebVTT with one confidence per word."
KEY_FIELD_ERROR = "Choose an active API key."
LABEL_ERROR = "Enter a label of up to 80 characters."
IDEMPOTENCY_ERROR = "Use an idempotency key of 1 to 100 characters."
SOURCE_ERROR = "Choose a source."
CORRECTION_ERROR = "Enter the corrected words."
NOTE_ERROR = "Add a note of up to 500 characters."
SYNTH_ERROR = "Enter 1 to 1000 characters."
VOICE_ERROR = "Choose a voice."
PLAN_ERROR = "Choose Pilot or Scale."
QUERY_ERROR = "Enter 1 to 100 characters."
SUBMITTED = "Correction submitted for approval."
APPROVED = "Correction approved. Reviewed transcript updated."
ALREADY_DECIDED = "This correction was already decided."
OWN_CORRECTION = "You can't approve your own correction."
OPEN_CONFLICT = "Another reviewer already has an open correction on this segment."
DRAFT_SAVED = "Draft saved."
EMPTY_PROMPT = "Select a flagged segment to review it."
CALC_TEMPLATE = "Pilot: <pilot> billed minutes. Scale: <scale> billed minutes."
PLAN_WAITING = "Waiting for billing to confirm the <plan> plan."
PLAN_ACTIVE = "<plan> plan is active."
L16_TYPE = "audio/L16;rate=16000;channels=<n>"

ENDED = {"closed", "idle_closed", "quota_halted", "revoked"}


def tok() -> str:
    return uuid.uuid4().hex[:10]


def identity(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    return (first, second) if "@" in second else (second, first)


def eventually(page: Page | None, check_fn: Callable[[], Any], seconds: float = WAIT_S, what: str = "condition") -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    expired = False
    while not expired:
        try:
            value = check_fn()
            if value:
                return value
            last = value
        except (AssertionError, PlaywrightError, KeyError, httpx.HTTPError) as error:
            last = error
        expired = time.monotonic() > deadline
        if not expired:
            _pause(STEP_S)
            if page is not None:
                advance(page, STEP_S * 1000)
    raise AssertionError(f"{what} not reached within {seconds} s; last: {last!r}")


def client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)


def signin(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    c = client(base)
    r = c.post("/api/auth/sign-in", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def me(c: httpx.Client) -> dict[str, Any]:
    r = c.get("/api/me")
    assert r.status_code == 200, r.text
    return r.json()


def projects(c: httpx.Client) -> list[dict[str, Any]]:
    r = c.get("/api/projects")
    assert r.status_code == 200, r.text
    return r.json()["projects"]


def project_named(c: httpx.Client, name: str) -> dict[str, Any]:
    return next(p for p in projects(c) if p["name"] == name)


def new_project(admin: httpx.Client, quota: int = BIG_QUOTA, name: str | None = None) -> dict[str, Any]:
    r = admin.post("/api/projects", json={"name": name or f"Proj {tok()}", "monthly_quota_minutes": quota})
    assert r.status_code == 201, r.text
    return r.json()["project"]


def new_key(c: httpx.Client, pid: str, name: str | None = None) -> tuple[str, str]:
    r = c.post(f"/api/projects/{pid}/keys", json={"name": name or f"Key {tok()}"})
    assert r.status_code == 201, r.text
    return r.json()["key"]["id"], r.json()["secret"]


class Member:
    def __init__(self, c: httpx.Client, user: dict[str, Any], name: str, email: str, member_id: str) -> None:
        self.client, self.user, self.name, self.email, self.member_id = c, user, name, email, member_id


def new_member(base: str, admin: httpx.Client, role: str, project_ids: list[str]) -> Member:
    name, email = identity(role)
    r = admin.post("/api/org/invitations", json={"name": name, "email": email, "role": role, "project_ids": project_ids})
    assert r.status_code == 201, r.text
    token = r.json()["invite_url"].rsplit("/", 1)[-1]
    c = client(base)
    accepted = c.post(f"/api/invitations/{token}/accept", json={"password": MEMBER_PASSWORD})
    assert accepted.status_code == 201, accepted.text
    members = admin.get("/api/org/members").json()["members"]
    member_id = next(m["id"] for m in members if m["email"].lower() == email.lower())
    return Member(c, accepted.json()["user"], name, email, member_id)


def multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes, str]] | None = None) -> tuple[bytes, str]:
    boundary = "lowfield" + uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode() + value.encode() + b"\r\n")
    for name, (filename, data, ctype) in (files or {}).items():
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'
        parts.append(head.encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def start(c: httpx.Client, pid: str, fields: dict[str, str], audio: bytes | None = None, sidecar: bytes | None = None, key: str | None = None) -> httpx.Response:
    files: dict[str, tuple[str, bytes, str]] = {}
    if audio is not None:
        files["audio"] = ("recording.wav", audio, "audio/wav")
    if sidecar is not None:
        files["sidecar"] = ("recording.vtt", sidecar, "text/vtt")
    body, ctype = multipart(fields, files)
    headers = {"Content-Type": ctype}
    if key is not None:
        headers["Idempotency-Key"] = key
    return c.post(f"/api/projects/{pid}/sessions", content=body, headers=headers)


def early_reply_status(c: httpx.Client, path: str, body: bytes, ctype: str) -> int:
    url = c.base_url.join(path)
    headers = {name.lower(): value for name, value in c.headers.items()}
    headers.update({"host": url.netloc.decode(), "content-type": ctype, "content-length": str(len(body)), "connection": "close"})
    if c.cookies:
        headers["cookie"] = "; ".join(f"{name}={value}" for name, value in c.cookies.items())
    head = f"POST {url.raw_path.decode()} HTTP/1.1\r\n" + "".join(f"{name}: {value}\r\n" for name, value in headers.items())
    view, sent, reply = memoryview(head.encode() + b"\r\n" + body), 0, b""
    deadline = time.monotonic() + HTTP_TIMEOUT
    with socket.create_connection((url.host, url.port or 80), timeout=HTTP_TIMEOUT) as sock, selectors.DefaultSelector() as ready:
        sock.setblocking(False)
        ready.register(sock, selectors.EVENT_READ | selectors.EVENT_WRITE)
        while sent < len(view) and time.monotonic() < deadline:
            events = 0
            for _, mask in ready.select(STEP_S):
                events |= mask
            if events & selectors.EVENT_READ:
                break
            if events & selectors.EVENT_WRITE:
                try:
                    sent += sock.send(view[sent : sent + 65536])
                except (BrokenPipeError, ConnectionResetError):
                    break
        ready.modify(sock, selectors.EVENT_READ)
        while b"\r\n" not in reply and time.monotonic() < deadline:
            if not ready.select(STEP_S):
                continue
            try:
                chunk = sock.recv(65536)
            except ConnectionResetError:
                break
            if not chunk:
                break
            reply += chunk
    status = re.match(rb"HTTP/1\.[01] (\d{3})", reply)
    assert status, f"no HTTP reply to a {len(body)}-byte body ({sent} bytes sent); got {reply[:80]!r}"
    return int(status.group(1))


def session_of(c: httpx.Client, sid: str) -> dict[str, Any]:
    r = c.get(f"/api/sessions/{sid}")
    assert r.status_code == 200, r.text
    return r.json()["session"]


def wait_session(c: httpx.Client, sid: str, predicate: Callable[[dict[str, Any]], bool], seconds: float = WAIT_S) -> dict[str, Any]:
    return eventually(None, lambda: (lambda s: s if predicate(s) else None)(session_of(c, sid)), seconds, f"session {sid}")


def transcript_of(c: httpx.Client, sid: str) -> dict[str, Any]:
    r = c.get(f"/api/sessions/{sid}/transcript")
    assert r.status_code == 200, r.text
    return r.json()


def sessions_labelled(c: httpx.Client, pid: str, label: str) -> list[dict[str, Any]]:
    r = c.get(f"/api/projects/{pid}/sessions")
    assert r.status_code == 200, r.text
    return [s for s in r.json()["sessions"] if s["label"] == label]


def iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


def half_up(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def billed(plan: str, audio_ms: int, channels: int) -> int:
    if audio_ms == 0:
        return 0
    if plan == "pilot":
        return channels * 60 * (-(-audio_ms // 60000))
    return channels * max(SCALE_MINIMUM_S, -(-audio_ms // 1000))


def minutes(seconds: int) -> str:
    return half_up(Decimal(seconds) / 60)


def money(cents: int) -> str:
    return f"${cents // 100}.{cents % 100:02d}"


def meter(used_seconds: int, limit: int) -> str:
    return f"{half_up(Decimal(used_seconds) / 60)} / {limit} min"


def percent(wer: float | None) -> str:
    return "n/a" if wer is None else f"{half_up(Decimal(str(wer)) * 100)}%"


def cost(plan: str, seconds: int) -> int:
    price = PILOT_CENTS if plan == "pilot" else SCALE_CENTS
    return -(-seconds * price // 60)


def halt_banner(quota: dict[str, Any]) -> str:
    month = iso(quota["period_start"])
    reset = iso(quota["resets_at"])
    return (
        f"Quota reached. This project's {quota['limit_minutes']} audio minutes for {month.strftime('%B %Y')} are used up. "
        f"New sessions are refused until {reset.day} {reset.strftime('%B %Y')} UTC or until an admin raises the quota."
    )


def other_plan(plan: str) -> str:
    return "scale" if plan == "pilot" else "pilot"


def short_url() -> str:
    return os.environ["APP_SHORT_URL"]


def kbdown_url() -> str:
    return os.environ["APP_KILLBILL_DOWN_URL"]


def s3down_url() -> str:
    return os.environ["APP_MINIO_DOWN_URL"]


def pcm(seconds: float, channels: int = 1, freq: int = 500, amp: int = 8000) -> bytes:
    period = SAMPLE_RATE // freq
    one = b"".join(struct.pack("<h", int(amp * math.sin(2 * math.pi * i / period))) * channels for i in range(period))
    frames = round(seconds * SAMPLE_RATE)
    whole, rest = divmod(frames, period)
    return one * whole + one[: rest * 2 * channels]


def pcm_ms(audio_ms: int, channels: int = 1) -> bytes:
    return pcm(audio_ms / 1000, channels)


def noise(seconds: float, channels: int = 1, seed: int = 7) -> bytes:
    return random.Random(seed).randbytes(round(seconds * SAMPLE_RATE) * 2 * channels)


def wav(samples: bytes, channels: int = 1, rate: int = SAMPLE_RATE, bits: int = 16, extra: bytes = b"") -> bytes:
    block = channels * bits // 8
    fmt = struct.pack("<HHIIHH", 1, channels, rate, rate * block, block, bits)
    chunks = b"fmt " + struct.pack("<I", len(fmt)) + fmt + extra + b"data" + struct.pack("<I", len(samples)) + samples
    return b"RIFF" + struct.pack("<I", 4 + len(chunks)) + b"WAVE" + chunks


def wav_format(data: bytes) -> tuple[int, int, int, bytes]:
    assert data[:4] == b"RIFF" and data[8:12] == b"WAVE", data[:16]
    offset, fmt, payload = 12, None, None
    while offset + 8 <= len(data):
        cid, size = data[offset : offset + 4], struct.unpack("<I", data[offset + 4 : offset + 8])[0]
        body = data[offset + 8 : offset + 8 + size]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        if cid == b"data":
            payload = body
        offset += 8 + size + (size & 1)
    assert fmt is not None and payload is not None
    return fmt[1], fmt[2], fmt[5], payload


def stamp(ms: int) -> str:
    return f"{ms // 60000:02d}:{(ms // 1000) % 60:02d}.{ms % 1000:03d}"


def vtt(cues: list[tuple[int, int, str]]) -> str:
    lines = ["WEBVTT", ""]
    for begin, end, words in cues:
        lines += [f"{stamp(begin)} --> {stamp(end)}", words, ""]
    return "\n".join(lines)


def cue_words(cues: list[tuple[int, int, str]]) -> list[tuple[str, float]]:
    return [(w.split("@")[0], float(w.split("@")[1])) for _, _, words in cues for w in words.split(" ")]


class Live:
    def __init__(self, base: str, secret: str | None, *, channels: int | None = None, label: str | None = None, sample_rate: int | None = None) -> None:
        parts = urlparse(base)
        params: dict[str, str] = {}
        if channels is not None:
            params["channels"] = str(channels)
        if sample_rate is not None:
            params["sample_rate"] = str(sample_rate)
        if label is not None:
            params["label"] = label
        target = "/v1/listen" + ("?" + urlencode(params) if params else "")
        self.channels = channels or 1
        self.messages: list[tuple[float, dict[str, Any]]] = []
        self.close_code: int | None = None
        self.closed_at: float | None = None
        self.ended = False
        self.cond = threading.Condition()
        self.send_lock = threading.Lock()
        self.sock = socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT)
        nonce = base64.b64encode(os.urandom(16)).decode()
        lines = [f"GET {target} HTTP/1.1", f"Host: {parts.netloc}", "Upgrade: websocket", "Connection: Upgrade", f"Sec-WebSocket-Key: {nonce}", "Sec-WebSocket-Version: 13"]
        if secret:
            lines.append(f"Authorization: Token {secret}")
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        buffer = b""
        while b"\r\n\r\n" not in buffer:
            chunk = self.sock.recv(65536)
            if not chunk:
                break
            buffer += chunk
        head, _, rest = buffer.partition(b"\r\n\r\n")
        status_line, *header_lines = head.decode("latin-1").split("\r\n")
        self.status = int(status_line.split(" ")[1])
        self.body: dict[str, Any] | None = None
        if self.status != 101:
            headers = {k.strip().lower(): v.strip() for k, _, v in (h.partition(":") for h in header_lines)}
            self.body = self._error_body(headers, rest)
            self.sock.close()
            self.ended = True
            return
        self.buffer = rest
        threading.Thread(target=self._read, daemon=True).start()

    def _error_body(self, headers: dict[str, str], body: bytes) -> dict[str, Any]:
        self.sock.settimeout(5)
        try:
            if "content-length" in headers:
                while len(body) < int(headers["content-length"]):
                    chunk = self.sock.recv(65536)
                    if not chunk:
                        break
                    body += chunk
            else:
                while b"0\r\n\r\n" not in body:
                    chunk = self.sock.recv(65536)
                    if not chunk:
                        break
                    body += chunk
                if headers.get("transfer-encoding", "").lower() == "chunked":
                    decoded, rest = b"", body
                    while rest:
                        size_line, _, rest = rest.partition(b"\r\n")
                        size = int(size_line.split(b";")[0] or b"0", 16)
                        if size == 0:
                            break
                        decoded, rest = decoded + rest[:size], rest[size + 2 :]
                    body = decoded
        except OSError:
            pass
        return json.loads(body) if body.strip() else {}

    def _exact(self, n: int) -> bytes:
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("socket closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def _read(self) -> None:
        self.sock.settimeout(None)
        fragments, first_opcode = b"", 0
        try:
            while True:
                b1, b2 = self._exact(2)
                fin, opcode, length = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
                if length == 126:
                    length = struct.unpack(">H", self._exact(2))[0]
                elif length == 127:
                    length = struct.unpack(">Q", self._exact(8))[0]
                mask = self._exact(4) if b2 & 0x80 else b""
                payload = self._exact(length)
                if mask:
                    payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                if opcode == 8:
                    with self.cond:
                        self.close_code = struct.unpack(">H", payload[:2])[0] if len(payload) >= 2 else 1005
                        self.closed_at = time.monotonic()
                        self.cond.notify_all()
                    with contextlib.suppress(OSError):
                        self._send(8, payload[:2])
                    break
                if opcode == 9:
                    self._send(10, payload)
                    continue
                if opcode == 10:
                    continue
                if opcode in (1, 2):
                    first_opcode, fragments = opcode, payload
                else:
                    fragments += payload
                if fin and first_opcode == 1:
                    message = json.loads(fragments.decode())
                    with self.cond:
                        self.messages.append((time.monotonic(), message))
                        self.cond.notify_all()
        except (OSError, ConnectionError, ValueError):
            pass
        finally:
            with self.cond:
                if self.closed_at is None:
                    self.closed_at = time.monotonic()
                self.ended = True
                self.cond.notify_all()

    def _send(self, opcode: int, payload: bytes) -> None:
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        head += mask
        masked = (int.from_bytes(payload, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big") if n else b""
        with self.send_lock:
            self.sock.sendall(bytes(head) + masked)

    def send_json(self, value: dict[str, Any]) -> None:
        self._send(1, json.dumps(value).encode())

    def send_raw(self, data: bytes) -> None:
        self._send(2, data)

    def send_audio(self, data: bytes) -> None:
        frame = 2 * self.channels
        size = WS_MESSAGE_LIMIT - WS_MESSAGE_LIMIT % frame
        for offset in range(0, len(data), size):
            self.send_raw(data[offset : offset + size])

    def finish(self) -> None:
        self.send_json({"type": "close"})

    def drop(self) -> None:
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()

    def wait(self, predicate: Callable[[dict[str, Any]], bool], seconds: float = WAIT_S) -> dict[str, Any]:
        deadline = time.monotonic() + seconds
        with self.cond:
            while True:
                for _, message in self.messages:
                    if predicate(message):
                        return message
                remaining = deadline - time.monotonic()
                if remaining <= 0 or self.ended:
                    raise AssertionError(f"no matching message; received {[m for _, m in self.messages][-8:]}")
                self.cond.wait(remaining)

    def arrival(self, predicate: Callable[[dict[str, Any]], bool]) -> float:
        self.wait(predicate)
        return next(t for t, m in self.messages if predicate(m))

    def session_id(self) -> str:
        return self.wait(lambda m: m.get("type") == "session")["session_id"]

    def wait_state(self, state: str, seconds: float = WAIT_S) -> dict[str, Any]:
        return self.wait(lambda m: m.get("type") == "state" and m.get("state") == state, seconds)

    def wait_closed(self, seconds: float = WAIT_S) -> int | None:
        deadline = time.monotonic() + seconds
        with self.cond:
            while not self.ended:
                remaining = deadline - time.monotonic()
                assert remaining > 0, "socket did not close"
                self.cond.wait(remaining)
            return self.close_code

    def __enter__(self) -> "Live":
        return self

    def __exit__(self, *_: Any) -> None:
        with contextlib.suppress(OSError):
            self.sock.close()


class Feeder:

    def __init__(self, live: Live, *, chunk_s: float = FEED_STEP_S, every_s: float = FEED_STEP_S, seconds: float | None = None) -> None:
        self.stop = threading.Event()
        self.sent = bytearray()
        chunk = pcm(chunk_s, live.channels)

        def run() -> None:
            count = 0
            while not self.stop.is_set() and (seconds is None or count * chunk_s < seconds):
                try:
                    live.send_raw(chunk)
                except OSError:
                    return
                self.sent += chunk
                count += 1
                self.stop.wait(every_s)

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def halt(self) -> bytes:
        self.stop.set()
        self.thread.join()
        return bytes(self.sent)


def recorded_session(base: str, secret: str, cues: list[tuple[int, int, str]] | None, seconds: float, channels: int = 1, label: str | None = None, samples: bytes | None = None) -> tuple[str, bytes]:
    data = samples if samples is not None else noise(seconds, channels)
    with Live(base, secret, channels=channels, label=label or f"Rec {tok()}") as live:
        assert live.status == 101, live.body
        sid = live.session_id()
        if cues is not None:
            live.send_json({"type": "sidecar", "vtt": vtt(cues)})
        live.send_audio(data)
        live.finish()
        assert live.wait_closed() == CLOSE_CODES["closed"]
    return sid, data


@contextlib.contextmanager
def console(browser: Browser, base: str, c: httpx.Client, path: str, *, width: int = 1280, height: int = 800, clock: datetime | None = None, **options: Any) -> Iterator[Page]:
    with open_app(browser, base + "/sign-in", **options) as page:
        page.set_viewport_size({"width": width, "height": height})
        page.context.add_cookies([{"name": ck.name, "value": ck.value or "", "url": base} for ck in c.cookies.jar])
        if clock is not None:
            page.clock.set_system_time(clock)
        page.goto(base + path)
        yield page


def text_of(locator: Locator) -> str:
    return (locator.inner_text(timeout=SHORT_MS) or "").strip()


ARIA_NAME = re.compile('-\\s*\'?[a-z]+(?:[ -][a-z]+)*\\s+"((?:[^"\\\\]|\\\\.)*)"')


def name_of(locator: Locator) -> str:
    snapshot = locator.aria_snapshot(timeout=SHORT_MS).lstrip()
    found = ARIA_NAME.match(snapshot)
    assert found is not None, snapshot
    return found.group(1)


def holding_still(canvas: Locator) -> bool:
    frames = scene_frames(canvas, steps=3, step_ms=HERO_STEP_MS)
    first, last = decode(frames[0]["png"]), decode(frames[-1]["png"])
    painted = len({first.rgb[i:i + 3] for i in range(0, len(first.rgb), 3)}) > 1
    return painted and difference(first, last) == 0


def settled_frame(canvas: Locator) -> int:
    readings: list[int] = []

    def rested() -> bool:
        readings.append(int(canvas.get_attribute("data-frame", timeout=SHORT_MS)))
        return len(readings) >= 3 and readings[-1] == readings[-2] == readings[-3]

    eventually(None, rested, what="data-frame to rest after the page-clock step")
    return readings[-1]


def tile_marks(tile: Locator) -> dict[str, bool]:
    return tile.evaluate(
        """e => { const marks = {dashed: false, hatched: false};
            const tiled = (sizes, rect) => sizes.split(',').some(layer => layer.trim().split(/\\s+/).some((t, i) => {
                const dim = i === 0 ? rect.width : rect.height;
                if (t.endsWith('px')) { const v = parseFloat(t); return v > 0 && v < dim - 0.5; }
                if (t.endsWith('%')) { const v = parseFloat(t); return v > 0 && v < 100; }
                return false; }));
            for (const node of [e, ...e.querySelectorAll('*')]) {
                if (node.tagName.toLowerCase() === 'svg') marks.hatched = true;
                const rect = node.getBoundingClientRect();
                for (const pseudo of [null, '::before', '::after']) {
                    const s = getComputedStyle(node, pseudo);
                    const edges = [s.outlineStyle, s.borderTopStyle, s.borderRightStyle,
                                   s.borderBottomStyle, s.borderLeftStyle];
                    if (edges.includes('dashed')) marks.dashed = true;
                    const layers = [[s.backgroundImage, s.backgroundSize],
                                    [s.maskImage, s.maskSize], [s.webkitMaskImage, s.webkitMaskSize]];
                    for (const [image, size] of layers) {
                        if (!image || image === 'none') continue;
                        if (/repeating-|url\\(/.test(image)) marks.hatched = true;
                        else if (/gradient\\(/.test(image) && size && tiled(size, rect)) marks.hatched = true;
                    }
                } }
            return marks; }""",
        timeout=SHORT_MS)


def box(locator: Locator) -> dict[str, float]:
    found = locator.bounding_box(timeout=SHORT_MS)
    assert found is not None, "element has no box"
    return found


def progress_percent(bar: Locator) -> float | None:
    return bar.evaluate(
        """e => { const now = e.getAttribute('aria-valuenow');
            if (now !== null && now.trim() !== '') {
              const lo = Number(e.getAttribute('aria-valuemin') ?? 0), hi = Number(e.getAttribute('aria-valuemax') ?? 100);
              return Math.round((Number(now) - lo) / ((hi - lo) || 100) * 100); }
            if (e.value !== undefined && e.value !== null && e.value !== '') {
              const value = Number(e.value), most = Number(e.max) || 1;
              if (Number.isFinite(value) && Number.isFinite(most)) return Math.round(value / most * 100); }
            return null; }""",
        timeout=SHORT_MS,
    )


def precedes(a: Locator, b: Locator) -> bool:
    return bool(a.evaluate("(x, y) => Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)", b.element_handle()))


def focused(locator: Locator) -> bool:
    return locator.count() == 1 and bool(locator.evaluate("e => e === document.activeElement"))


def contains_focus(locator: Locator) -> bool:
    return bool(locator.evaluate("e => e.contains(document.activeElement)"))


def tab_until(page: Page, target: str | re.Pattern[str]) -> None:
    for _ in range(TAB_PRESSES):
        name = tab_order(page, 1)[0]
        if (target.search(name) if isinstance(target, re.Pattern) else name == target):
            return
    raise AssertionError(f"Tab never reached {target!r}")


def rect(d: dict[str, float]) -> tuple[float, float, float, float]:
    return (d.get("x", d.get("left", 0.0)), d.get("y", d.get("top", 0.0)), d["width"], d["height"])


def near(a: dict[str, float], b: dict[str, float]) -> bool:
    return all(abs(p - q) <= PX for p, q in zip(rect(a), rect(b)))


READBACK = """(c) => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0); const rows = Math.min(%d, c.height);
  const d = x.getImageData(0, c.height - rows, c.width, rows).data;
  return {width: c.width, height: c.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight, rows, pixels: Array.from(d)}; }""" % STRIP_PX


def readback(canvas: Locator) -> dict[str, Any]:
    return canvas.evaluate(READBACK)


TERRAIN = """(c) => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0); const rows = Math.max(1, c.height - %d);
  const d = x.getImageData(0, 0, c.width, rows).data; let h = 0;
  for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) >>> 0; }
  return h; }""" % STRIP_PX
GL_KIND = "c => { const g = c.getContext('webgl2') || c.getContext('webgl'); return g ? g.constructor.name : null; }"
ROW_RATE = 30
RATE_WINDOW_S = 3
RATE_SLACK = 0.5
KB_USAGE_PATH = "/1.0/kb/usages/{}"


def terrain_hash(canvas: Locator) -> int:
    return canvas.evaluate(TERRAIN)


def bar_heights(shot: dict[str, Any]) -> list[int]:
    w, rows, px = shot["width"], shot["rows"], shot["pixels"]

    def at(x: int, y: int) -> tuple[int, int, int]:
        i = (y * w + x) * 4
        return (px[i], px[i + 1], px[i + 2])

    top = [at(x, 0) for x in range(w)]
    ground = max(set(top), key=top.count)
    heights = []
    for i in range(BINS):
        col = (i * w // BINS + (i + 1) * w // BINS - 1) // 2
        lit = 0
        for y in range(rows - 1, -1, -1):
            if sum(abs(a - b) for a, b in zip(at(col, y), ground)) > GROUND_DELTA:
                lit += 1
            else:
                break
        heights.append(lit)
    return heights


def bar_colour(shot: dict[str, Any], heights: list[int]) -> tuple[int, int, int]:
    w, rows, px = shot["width"], shot["rows"], shot["pixels"]
    i = max(range(BINS), key=lambda b: heights[b])
    col = (i * w // BINS + (i + 1) * w // BINS - 1) // 2
    j = ((rows - 1) * w + col) * 4
    return (px[j], px[j + 1], px[j + 2])


def strip_matches(canvas: Locator, values: list[float]) -> bool:
    heights = bar_heights(readback(canvas))
    return all(abs(h - math.floor(v * STRIP_PX + 0.5)) <= BAR_TOLERANCE_PX for h, v in zip(heights, values))


def db_rows_with(pg: Postgres, needle: str) -> dict[str, int]:
    columns = pg.rows(
        "SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS c FROM information_schema.columns c "
        "JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
        "WHERE t.table_type = 'BASE TABLE' AND c.table_schema NOT IN ('pg_catalog', 'information_schema') "
        "AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')"
    )

    def ident(value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

    literal = needle.replace("'", "''")
    selects = [
        f"SELECT '{(c['s'] + '.' + c['t'] + '.' + c['c']).replace(chr(39), chr(39) * 2)}' AS place, count(*) AS n "
        f"FROM {ident(c['s'])}.{ident(c['t'])} WHERE strpos({ident(c['c'])}::text, '{literal}') > 0"
        for c in columns
    ]
    counts: dict[str, int] = {}
    for i in range(0, len(selects), 40):
        for row in pg.rows(" UNION ALL ".join(selects[i : i + 40])):
            if int(row["n"]):
                counts[row["place"]] = int(row["n"])
    return counts


def stream_connections(pg: Postgres, sid: str) -> list[dict[str, Any]]:
    return pg.rows(f"SELECT state, (state <> 'active' AND xact_start IS NOT NULL) AS in_tx FROM pg_stat_activity WHERE application_name = 'lowfield-stream:{sid}'")


def app_connections(pg: Postgres) -> list[dict[str, Any]]:
    return pg.rows("SELECT state, application_name AS app, (state <> 'active' AND xact_start IS NOT NULL) AS in_tx FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user")


def sse_until(c: httpx.Client, sid: str, want: Callable[[str, Any], bool], seconds: float) -> list[tuple[str, Any]]:
    seen: list[tuple[str, Any]] = []
    deadline = time.monotonic() + seconds
    with c.stream("GET", f"/api/sessions/{sid}/events", timeout=httpx.Timeout(seconds, read=seconds)) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        event, data = "message", []
        for line in r.iter_lines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip())
            elif line == "" and data:
                payload = json.loads("\n".join(data))
                seen.append((event, payload))
                if want(event, payload):
                    return seen
                event, data = "message", []
            if time.monotonic() > deadline:
                break
    raise AssertionError(f"event not seen; got {seen[-6:]}")


@contextlib.contextmanager
def relay(target_url: str) -> Iterator[None]:
    parts = urlparse(target_url)
    target = (parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", DOWN_PORT))
    server.listen(64)
    open_sockets: list[socket.socket] = []
    closed = threading.Event()

    def pipe(a: socket.socket, b: socket.socket) -> None:
        try:
            while not closed.is_set():
                data = a.recv(65536)
                if not data:
                    break
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)

    def serve() -> None:
        while not closed.is_set():
            try:
                inbound, _ = server.accept()
            except OSError:
                return
            try:
                outbound = socket.create_connection(target, timeout=10)
                outbound.settimeout(None)
            except OSError:
                inbound.close()
                continue
            open_sockets.extend([inbound, outbound])
            threading.Thread(target=pipe, args=(inbound, outbound), daemon=True).start()
            threading.Thread(target=pipe, args=(outbound, inbound), daemon=True).start()

    threading.Thread(target=serve, daemon=True).start()
    try:
        yield
    finally:
        closed.set()
        with contextlib.suppress(OSError):
            server.shutdown(socket.SHUT_RDWR)
        server.close()
        for s in open_sockets:
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
            s.close()


def plan_settled(c: httpx.Client) -> dict[str, Any]:
    return eventually(None, lambda: (lambda p: p if (p["change"] or {}).get("state") != "requested" else None)(c.get("/api/org/plan").json()), DECISION_S + WAIT_S, "plan decision")


def catalog_plans(killbill: Any, external_key: str) -> set[str]:
    account = killbill.account_by_key(external_key)
    assert account is not None, external_key
    return {s.get("planName") for s in killbill.subscriptions(account["accountId"]) if s.get("state") in (None, "ACTIVE")}


def test_public_site_story(browser: Browser, app_url: str) -> None:
    for width, height in VIEWPORTS:
        with open_app(browser, app_url + "/") as page:
            page.set_viewport_size({"width": width, "height": height})
            hero = page.get_by_role("img", name="Session field").first
            signal = page.get_by_role("region", name="Signal path")
            plans = page.get_by_role("region", name="Plans")
            form = page.get_by_role("form", name="Request a trial workspace")
            for part in (hero, signal, plans, form):
                expect(part).to_be_attached()
            assert precedes(hero, signal) and precedes(signal, plans) and precedes(plans, form)
            expect(page.get_by_role("link", name="Sign in").first).to_be_visible()
            assert box(hero)["width"] >= width - PX
            assert hero.get_attribute("data-session-state") == "live"
            pilot = plans.get_by_role("article").filter(has=page.get_by_role("heading", name="Pilot"))
            scale = plans.get_by_role("article").filter(has=page.get_by_role("heading", name="Scale"))
            expect(pilot).to_have_count(1)
            expect(scale).to_have_count(1)
            pilot.scroll_into_view_if_needed()
            p, s = box(pilot), box(scale)
            if width < BREAK_TWO:
                assert s["y"] >= p["y"] + p["height"] - PX
            else:
                assert abs(p["y"] - s["y"]) < p["height"] / 2 and s["x"] >= p["x"] + p["width"] - PX
            layout(page)
            if width == VIEWPORTS[-1][0]:
                page.evaluate("window.scrollTo(0, 0)")
                frames = scene_frames(hero, steps=3, step_ms=HERO_STEP_MS)
                assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) > 0


def test_signal_path_scroll(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        region = page.get_by_role("region", name="Signal path")
        items = region.get_by_role("list").get_by_role("listitem")
        expect(items).to_have_count(len(STAGES))
        for index, name in enumerate(STAGES):
            expect(items.nth(index)).to_contain_text(name)
        forward = list(enumerate(SIGNAL_POSITIONS, start=1))
        for stage, offset in forward + list(reversed(forward))[1:]:
            page.evaluate("y => window.scrollTo(0, y)", offset)
            eventually(page, lambda: region.get_attribute("data-stage", timeout=SHORT_MS) == str(stage), what=f"stage {stage}")
            currents = items.evaluate_all("els => els.map(e => e.getAttribute('aria-current'))")
            assert [c == "step" for c in currents] == [i == stage - 1 for i in range(len(STAGES))], currents
            pinned = box(region)
            assert pinned["y"] < 800 and pinned["y"] + pinned["height"] > 0
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        region = page.get_by_role("region", name="Signal path")
        for offset in (0, SIGNAL_POSITIONS[2]):
            page.evaluate("y => window.scrollTo(0, y)", offset)
            eventually(page, lambda: region.get_attribute("data-stage", timeout=SHORT_MS) == "5")
        items = region.get_by_role("list").get_by_role("listitem")
        for index, name in enumerate(STAGES):
            expect(items.nth(index)).to_be_visible()
            expect(items.nth(index)).to_contain_text(name)


def calc_copy(value: str, channels: int) -> str:
    audio_ms = int(Decimal(value) * 1000)
    return CALC_TEMPLATE.replace("<pilot>", minutes(billed("pilot", audio_ms, channels))).replace("<scale>", minutes(billed("scale", audio_ms, channels)))


def test_rounding_calculator(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        page.evaluate("window.__lowfieldSamePage = true")
        start_url = page.url
        field = page.get_by_role("textbox", name="Session length in seconds")
        status = page.get_by_role("status", name="Billed minutes")
        mono = page.get_by_role("radiogroup", name="Channels").get_by_role("radio", name="Mono")
        stereo = page.get_by_role("radiogroup", name="Channels").get_by_role("radio", name="Stereo")
        field.scroll_into_view_if_needed()
        expect(field).to_have_value("")
        expect(mono).to_be_checked()
        assert text_of(status) == ""
        field.focus()
        typed = ""
        for ch in "61":
            page.keyboard.type(ch)
            typed += ch
            eventually(page, lambda: text_of(status) == calc_copy(typed, 1), what=f"copy for {typed}")
        assert text_of(status) == CALC_TEMPLATE.replace("<pilot>", "2.00").replace("<scale>", "1.02")
        check(stereo)
        eventually(page, lambda: text_of(status) == calc_copy("61", 2))
        field.fill("")
        eventually(page, lambda: text_of(status) == "")
        expect(page.get_by_text(CALC_ERROR, exact=True)).to_have_count(0)
        field.focus()
        page.keyboard.type("5")
        eventually(page, lambda: text_of(status) == CALC_TEMPLATE.replace("<pilot>", "2.00").replace("<scale>", "0.50"))
        check(mono)
        typed = ""
        field.fill("")
        field.focus()
        for ch in "59.999":
            page.keyboard.type(ch)
            typed += ch
            if not typed.endswith("."):
                eventually(page, lambda: text_of(status) == calc_copy(typed, 1), what=f"copy for {typed}")
        for valid in ("0", "0.001", "3600", "3600.000"):
            field.fill(valid)
            eventually(page, lambda: text_of(status) == calc_copy(valid, 1), what=valid)
            assert field.get_attribute("aria-invalid") != "true"
        for invalid in ("-1", "1e3", "abc", "3600.001", "3601", "1.2345", "+5"):
            field.fill(invalid)
            eventually(page, lambda: page.get_by_text(CALC_ERROR, exact=True).first.is_visible(), what=invalid)
            assert text_of(status) == ""
            assert field.get_attribute("aria-invalid") == "true"
        field.fill("61")
        eventually(page, lambda: text_of(status) == calc_copy("61", 1))
        expect(page.get_by_text(CALC_ERROR, exact=True)).to_have_count(0)
        assert page.url == start_url and page.evaluate("window.__lowfieldSamePage === true")


TRIAL_CASES = {
    "name-blank": ("name", "\u3000 \u00a0", "Enter your name."),
    "name-over": ("name", "\U0001fa7a" * (TRIAL_MAX + 1), "Enter your name."),
    "email-no-at": ("email", "nobody.example", "Enter a work email address."),
    "email-two-at": ("email", "a@b@example.test", "Enter a work email address."),
    "email-over": ("email", "x" * (EMAIL_MAX - len("@example.test") + 1) + "@example.test", "Enter a work email address."),
    "company-blank": ("company", "   ", "Enter your company."),
    "company-over": ("company", "c" * (TRIAL_MAX + 1), "Enter your company."),
    "team-other": ("team", "sales", "Choose a team."),
}


def test_trial_request_api(app_url: str) -> None:
    c = client(app_url)
    pg = Postgres()
    for case, (field, bad, message) in TRIAL_CASES.items():
        marker = f"Trial {tok()}"
        _, email = identity("trial")
        payload = {"name": marker, "email": email, "company": "Clinic Co", "team": "clinical_dictation"}
        payload[field] = bad
        r = c.post("/api/trial-requests", json=payload)
        assert r.status_code == 422, (case, r.text)
        assert r.json()["error"] == "validation_failed" and r.json()["fields"][field] == message, case
        assert db_rows_with(pg, marker) == {}, case
    t = tok()
    _, email = identity("trial")
    first = c.post("/api/trial-requests", json={"name": f"  Ine\u0301s {t}  ", "email": email, "company": "\U0001fa7a" * (TRIAL_MAX - 1) + "C", "team": "contact_centre"})
    assert first.status_code == 201, first.text
    body = first.json()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", body["received_at"])
    assert db_rows_with(pg, f"In\u00e9s {t}") and db_rows_with(pg, f"Ine\u0301s {t}") == {}
    repeat = c.post("/api/trial-requests", json={"name": f"Other {t}", "email": email, "company": "Else", "team": "clinical_dictation"})
    assert repeat.status_code == 200, repeat.text
    assert repeat.json()["id"] == body["id"] and repeat.json()["received_at"] == body["received_at"]
    stored = db_rows_with(pg, email)
    assert stored and max(stored.values()) == 1, stored
    assert db_rows_with(pg, f"Other {t}") == {}


def test_wf_public_site_buyer_journey(browser: Browser, app_url: str) -> None:
    name, email = identity("buyer")
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        for offset in SIGNAL_POSITIONS:
            page.evaluate("y => window.scrollTo(0, y)", offset)
            advance(page, DEBOUNCE_MS)
        field = page.get_by_role("textbox", name="Session length in seconds")
        field.scroll_into_view_if_needed()
        field.fill("61")
        eventually(page, lambda: text_of(page.get_by_role("status", name="Billed minutes")) == calc_copy("61", 1))
        form = page.get_by_role("form", name="Request a trial workspace")
        form.get_by_role("textbox", name="Name").fill(name)
        form.get_by_role("textbox", name="Work email").fill(email)
        form.get_by_role("textbox", name="Company").fill("Harbour Clinic Group")
        select(form.get_by_role("combobox", name="Team"), "Clinical dictation")
        button = form.get_by_role("button", name="Request trial")
        status = page.get_by_role("status", name="Trial status")
        with held(page, "**/api/trial-requests") as hold:
            button.click()
            eventually(page, lambda: button.is_disabled())
            hold.release()
        eventually(page, lambda: text_of(status) == TRIAL_OK)
        expect(page.get_by_role("button", name="Request trial")).to_have_count(0)
        expect(page.get_by_role("form", name="Request a trial workspace").get_by_role("textbox", name="Name")).to_have_count(0)
        expect(status).to_be_visible()
    stored = db_rows_with(Postgres(), email)
    assert stored and max(stored.values()) == 1, stored


def test_wf_public_site_trial_invalid(browser: Browser, app_url: str) -> None:
    name, email = identity("buyer")
    pg = Postgres()
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 768, "height": 1024})
        form = page.get_by_role("form", name="Request a trial workspace")
        name_box = form.get_by_role("textbox", name="Name")
        form.get_by_role("textbox", name="Work email").fill(email)
        form.get_by_role("textbox", name="Company").fill("Corvane Partner")
        select(form.get_by_role("combobox", name="Team"), "Contact centre")
        form.get_by_role("button", name="Request trial").click()
        eventually(page, lambda: page.get_by_text("Enter your name.", exact=True).first.is_visible())
        assert name_box.get_attribute("aria-invalid") == "true"
        linked = name_box.evaluate(
            "e => ['aria-describedby', 'aria-errormessage'].flatMap(a => (e.getAttribute(a) || '').split(/\\s+/))"
            ".map(id => id && document.getElementById(id) ? document.getElementById(id).textContent : '').join(' ')"
        )
        assert "Enter your name." in linked
        assert db_rows_with(pg, email) == {}
        name_box.fill(name)
        form.get_by_role("button", name="Request trial").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Trial status")) == TRIAL_OK)
    assert db_rows_with(pg, email)


LANDINGS = {INES: "/console/projects", TEO: "/console/projects", RHEA: "/console/projects", ARI: "/console/projects", KIM: "/console/usage"}


def test_sign_in_landing(browser: Browser, app_url: str) -> None:
    for email, landing in LANDINGS.items():
        r = client(app_url).post("/api/auth/sign-in", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200 and r.json()["landing"] == landing, r.text
    for bad in ({"email": INES, "password": "wrong-password-x"}, {}, {"email": INES}):
        r = client(app_url).post("/api/auth/sign-in", json=bad)
        assert r.status_code == 401 and r.json()["error"] == "invalid_credentials"
        assert not r.cookies
    anonymous = client(app_url).get("/api/me")
    assert anonymous.status_code == 401 and anonymous.json()["error"] == "unauthenticated"
    marks = {INES: ("table", "Projects"), KIM: ("table", "Usage by project")}
    for email, (role, name) in marks.items():
        with open_app(browser, app_url + "/sign-in") as page:
            page.set_viewport_size({"width": 1280, "height": 800})
            page.get_by_role("textbox", name="Email").fill(email)
            page.get_by_label("Password").fill("not-the-password")
            page.get_by_role("button", name="Sign in").click()
            eventually(page, lambda: text_of(page.get_by_role("status", name="Sign-in status")) == SIGN_IN_ERROR)
            page.get_by_label("Password").fill(PASSWORD)
            page.get_by_role("button", name="Sign in").click()
            eventually(page, lambda: urlparse(page.url).path == LANDINGS[email])
            eventually(page, lambda: page.get_by_role(role, name=name).is_visible())
            page.reload()
            eventually(page, lambda: urlparse(page.url).path == LANDINGS[email] and page.get_by_role(role, name=name).is_visible())
        with console(browser, app_url, signin(app_url, email), LANDINGS[email]) as page:
            eventually(page, lambda: urlparse(page.url).path == LANDINGS[email] and page.get_by_role(role, name=name).is_visible())


def test_role_permissions(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines)
    pid = project["id"]
    key_id, secret = new_key(ines, pid)
    roles = {"admin": ines}
    members = {}
    for role in ("developer", "reviewer", "approver", "billing"):
        members[role] = new_member(app_url, ines, role, [pid] if role in ("developer", "reviewer", "approver") else [])
        roles[role] = members[role].client
    sid, _ = recorded_session(app_url, secret, [(0, 1000, "one@0.50"), (1000, 2000, "two@0.50")], seconds=2)
    segments = transcript_of(ines, sid)["segments"]
    correction = roles["reviewer"].post(f"/api/sessions/{sid}/segments/{segments[0]['id']}/corrections", json={"text": "won"}).json()["correction"]
    assert roles["reviewer"].post(f"/api/corrections/{correction['id']}/submit").status_code == 200
    everyone = set(roles)
    viewers = {"admin", "developer", "reviewer", "approver"}
    builders = {"admin", "developer"}
    editors = {"reviewer", "approver"}
    rules: list[tuple[str, str, Any, set[str], int]] = [
        ("GET", "/api/me", None, everyone, 200),
        ("GET", "/api/projects", None, everyone, 200),
        ("GET", f"/api/projects/{pid}", None, everyone, 200),
        ("POST", "/api/projects", {"name": "", "monthly_quota_minutes": 0}, {"admin"}, 422),
        ("PATCH", f"/api/projects/{pid}/quota", {"monthly_quota_minutes": 0}, {"admin"}, 422),
        ("GET", "/api/org/members", None, {"admin"}, 200),
        ("POST", "/api/org/invitations", {"name": "", "email": "", "role": "x", "project_ids": "x"}, {"admin"}, 422),
        ("PATCH", f"/api/org/members/{members['developer'].member_id}", {"role": "x"}, {"admin"}, 422),
        ("GET", "/api/org/plan", None, {"admin"}, 200),
        ("POST", "/api/org/plan-changes", {"plan": "gold"}, {"admin"}, 422),
        ("GET", f"/api/projects/{pid}/keys", None, builders, 200),
        ("POST", f"/api/projects/{pid}/keys", {"name": ""}, builders, 422),
        ("POST", f"/api/projects/{pid}/synthesis", {"key_id": key_id, "text": "", "voice": "lumen"}, builders, 422),
        ("MULTIPART", f"/api/projects/{pid}/sessions", None, builders, 422),
        ("POST", f"/api/sessions/{sid}/close", None, builders, 409),
        ("GET", f"/api/projects/{pid}/sessions", None, viewers, 200),
        ("GET", "/api/sessions/search?q=Rec", None, viewers, 200),
        ("GET", f"/api/sessions/{sid}", None, viewers, 200),
        ("GET", f"/api/sessions/{sid}/spectrum", None, viewers, 200),
        ("GET", f"/api/sessions/{sid}/transcript", None, viewers, 200),
        ("GET", f"/api/sessions/{sid}/transcript/machine.json", None, viewers, 200),
        ("GET", f"/api/sessions/{sid}/audio", None, viewers, 200),
        ("GET", f"/api/sessions/{sid}/segments/{segments[0]['id']}/audio", None, viewers, 200),
        ("GET", f"/api/projects/{pid}/corrections", None, viewers, 200),
        ("POST", f"/api/sessions/{sid}/segments/{segments[1]['id']}/corrections", {"text": ""}, editors, 422),
        ("POST", f"/api/corrections/{correction['id']}/return", {"note": ""}, {"approver"}, 422),
        ("GET", "/api/usage", None, {"admin", "billing"}, 200),
    ]
    for method, path, body, allowed, ok in rules:
        for role, c in roles.items():
            if method == "MULTIPART":
                r = start(c, pid, {})
            elif body is None:
                r = c.request(method, path)
            else:
                r = c.request(method, path, json=body)
            if role in allowed:
                assert r.status_code == ok, (role, method, path, r.status_code, r.text[:200])
            else:
                assert r.status_code == 403 and r.json()["error"] == "forbidden", (role, method, path, r.status_code)
    for role in ("admin", "developer", "reviewer", "billing"):
        r = roles[role].post(f"/api/corrections/{correction['id']}/approve")
        assert r.status_code == 403 and r.json()["error"] == "forbidden", role
    assert roles["approver"].post(f"/api/corrections/{correction['id']}/approve").status_code == 200
    nav_expect = {"admin": {"Projects", "Usage", "Members", "Plan"}, "reviewer": {"Projects"}, "billing": {"Projects", "Usage"}}
    for role, links in nav_expect.items():
        with console(browser, app_url, roles[role], "/console/projects") as page:
            nav = page.get_by_role("navigation", name="Console")
            eventually(page, lambda: nav.is_visible())
            for name in ("Projects", "Usage", "Members", "Plan"):
                eventually(page, lambda: (nav.get_by_role("link", name=name, exact=True).count() == 1) == (name in links), what=f"{role} {name}")
    with console(browser, app_url, roles["billing"], f"/console/projects/{pid}/keys") as page:
        eventually(page, lambda: urlparse(page.url).path == "/console/usage")
    with console(browser, app_url, roles["reviewer"], "/console/org/plan") as page:
        eventually(page, lambda: urlparse(page.url).path == "/console/projects")
    with console(browser, app_url, roles["reviewer"], f"/console/projects/{pid}/sessions") as page:
        tabs = page.get_by_role("tablist", name="Project")
        eventually(page, lambda: tabs.get_by_role("tab", name="Sessions").is_visible())
        for name, shown in (("Keys", False), ("Review", True), ("Synthesis", False), ("Settings", False)):
            assert (tabs.get_by_role("tab", name=name).count() == 1) == shown, name
    for role, c in roles.items():
        if role != "admin":
            assert c.post("/api/auth/sign-out").status_code == 204
            assert c.get("/api/me").status_code == 401


def test_immediate_role_changes(app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines)
    pid = project["id"]
    dev = new_member(app_url, ines, "developer", [pid])
    path = f"/api/org/members/{dev.member_id}"
    assert dev.client.get(f"/api/projects/{pid}/keys").status_code == 200
    r = ines.patch(path, json={"role": "reviewer"})
    assert r.status_code == 200 and r.json()["member"]["role"] == "reviewer"
    denied = dev.client.get(f"/api/projects/{pid}/keys")
    assert denied.status_code == 403 and denied.json()["error"] == "forbidden"
    assert dev.client.get(f"/api/projects/{pid}/sessions").status_code == 200
    assert ines.patch(path, json={"project_ids": []}).status_code == 200
    gone = dev.client.get(f"/api/projects/{pid}")
    assert gone.status_code == 404 and gone.json()["error"] == "not_found"
    assert pid not in me(dev.client)["project_ids"]
    for body, field, message in (({"role": "owner"}, "role", "Choose a role."), ({"project_ids": "all"}, "project_ids", "Choose projects from the list.")):
        bad = ines.patch(path, json=body)
        assert bad.status_code == 422 and bad.json()["fields"][field] == message
    nadia = signin(app_url, NADIA)
    foreign = project_named(nadia, "Agent Assist EU")["id"]
    assert ines.patch(path, json={"project_ids": [foreign]}).status_code == 404
    own = me(ines)["user"]["id"]
    own_member = next(m["id"] for m in ines.get("/api/org/members").json()["members"] if m["email"] == INES)
    for request in (lambda: ines.patch(f"/api/org/members/{own_member}", json={"role": "developer"}), lambda: ines.delete(f"/api/org/members/{own_member}")):
        refused = request()
        assert refused.status_code == 409 and refused.json()["error"] == "self_change"
    assert me(ines)["user"]["role"] == "admin" and own
    assert ines.delete(path).status_code == 204
    removed = dev.client.get("/api/me")
    assert removed.status_code == 401 and removed.json()["error"] == "unauthenticated"


def test_project_scoped_access(app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines)
    pid = project["id"]
    key_id, secret = new_key(ines, pid)
    reviewer = new_member(app_url, ines, "reviewer", [pid])
    sid, _ = recorded_session(app_url, secret, [(0, 1000, "dose@0.50")], seconds=1)
    seg = transcript_of(ines, sid)["segments"][0]["id"]
    cid = reviewer.client.post(f"/api/sessions/{sid}/segments/{seg}/corrections", json={"text": "dosage"}).json()["correction"]["id"]
    job = ines.post(f"/api/projects/{pid}/synthesis", json={"key_id": key_id, "text": "check", "voice": "lumen"}).json()["job"]["id"]
    outsiders = {"jo": signin(app_url, JO), "teo": signin(app_url, TEO), "nadia": signin(app_url, NADIA)}
    probes = [
        ("GET", f"/api/projects/{pid}", None), ("GET", f"/api/projects/{pid}/keys", None), ("DELETE", f"/api/projects/{pid}/keys/{key_id}", None),
        ("GET", f"/api/projects/{pid}/sessions", None), ("GET", f"/api/projects/{pid}/corrections", None),
        ("GET", f"/api/sessions/{sid}", None), ("GET", f"/api/sessions/{sid}/spectrum", None), ("GET", f"/api/sessions/{sid}/audio", None),
        ("GET", f"/api/sessions/{sid}/transcript", None), ("GET", f"/api/sessions/{sid}/transcript/machine.json", None),
        ("GET", f"/api/sessions/{sid}/segments/{seg}/audio", None), ("POST", f"/api/sessions/{sid}/close", None),
        ("POST", f"/api/sessions/{sid}/segments/{seg}/corrections", {"text": "x"}), ("PATCH", f"/api/corrections/{cid}", {"text": "x"}),
        ("POST", f"/api/corrections/{cid}/submit", None), ("POST", f"/api/corrections/{cid}/approve", None),
        ("POST", f"/api/corrections/{cid}/return", {"note": "x"}), ("POST", f"/api/corrections/{cid}/reopen", None),
        ("GET", f"/api/projects/{pid}/synthesis/{job}/audio", None), ("GET", f"/api/sessions/{uuid.uuid4()}", None),
    ]
    for who, c in outsiders.items():
        for method, path, body in probes:
            r = c.request(method, path, json=body) if body is not None else c.request(method, path)
            assert r.status_code == 404 and r.json()["error"] == "not_found", (who, method, path, r.status_code)
    ward = project_named(outsiders["teo"], WARD)["id"]
    assert start(outsiders["teo"], ward, {"key_id": key_id, "source": "tone"}).status_code == 404
    assert outsiders["teo"].post(f"/api/projects/{ward}/synthesis", json={"key_id": key_id, "text": "hi", "voice": "lumen"}).status_code == 404
    nadia_invite = outsiders["nadia"].post("/api/org/invitations", json={"name": "Probe", "email": identity("probe")[1], "role": "reviewer", "project_ids": [pid]})
    assert nadia_invite.status_code == 404
    seed = next(s for s in ines.get(f"/api/projects/{project_named(ines, WARD)['id']}/sessions").json()["sessions"] if s["label"] == SEED_DICTATION)
    seed_seg = transcript_of(ines, seed["id"])["segments"][0]["id"]
    assert ines.get(f"/api/sessions/{sid}/segments/{seed_seg}/audio").status_code == 404
    assert session_of(ines, sid)["state"] == "closed"
    assert reviewer.client.get(f"/api/projects/{pid}/corrections").json()["corrections"][0]["state"] == "draft"


def test_wf_team_access_invite_join(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines)
    name, email = identity("invitee")
    with console(browser, app_url, ines, "/console/org/members") as page:
        page.get_by_role("button", name="Invite teammate").click()
        dialog = page.get_by_role("dialog", name="Invite teammate")
        eventually(page, lambda: dialog.is_visible())
        dialog.get_by_role("textbox", name="Name").fill(name)
        dialog.get_by_role("textbox", name="Email").fill(email)
        select(dialog.get_by_role("combobox", name="Role"), "Reviewer")
        check(dialog.get_by_role("checkbox", name=project["name"]))
        dialog.get_by_role("button", name="Create invitation").click()
        link_box = page.get_by_role("textbox", name="Invitation link")
        link = eventually(page, lambda: (v := link_box.input_value(timeout=SHORT_MS)) and "/join/" in v and v)
        eventually(page, lambda: text_of(page.get_by_role("status", name="Members status")) == f"Invitation created. Share the link below with {name}.")
    url = link if link.startswith("http") else app_url + link
    with open_app(browser, url) as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        page.get_by_label("Choose a password").fill(MEMBER_PASSWORD)
        page.get_by_role("button", name="Join workspace").click()
        eventually(page, lambda: urlparse(page.url).path == "/console/projects")
        table = page.get_by_role("table", name="Projects")
        eventually(page, lambda: table.get_by_role("row").filter(has_text=project["name"]).count() == 1)
        assert table.get_by_role("row").filter(has_text=WARD).count() == 0
        profile = page.request.get(app_url + "/api/me").json()
        assert profile["project_ids"] == [project["id"]] and profile["user"]["role"] == "reviewer"
    assert db_rows_with(Postgres(), email)


def test_wf_team_access_used_link(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines)
    name, email = identity("joiner")
    r = ines.post("/api/org/invitations", json={"name": name, "email": email, "role": "developer", "project_ids": [project["id"]]})
    assert r.status_code == 201
    invite = r.json()["invite_url"]
    taken = ines.post("/api/org/invitations", json={"name": name, "email": email, "role": "developer", "project_ids": []})
    assert taken.status_code == 409 and taken.json()["error"] == "email_taken"
    long_name = ines.post("/api/org/invitations", json={"name": "n" * (TRIAL_MAX + 1), "email": identity("j")[1], "role": "developer", "project_ids": []})
    assert long_name.status_code == 422 and long_name.json()["fields"]["name"] == "Enter a name of up to 100 characters."
    with open_app(browser, app_url + invite) as page:
        page.set_viewport_size({"width": 375, "height": 812})
        page.get_by_label("Choose a password").fill("x" * (PASSWORD_MIN - 1))
        page.get_by_role("button", name="Join workspace").click()
        eventually(page, lambda: page.get_by_text(PASSWORD_ERROR, exact=True).first.is_visible())
        page.get_by_label("Choose a password").fill("x" * PASSWORD_MIN)
        page.get_by_role("button", name="Join workspace").click()
        eventually(page, lambda: urlparse(page.url).path == "/console/projects")
    with open_app(browser, app_url + invite) as page:
        page.get_by_label("Choose a password").fill(MEMBER_PASSWORD)
        page.get_by_role("button", name="Join workspace").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Join status")) == INVITE_USED)
    again = client(app_url).post(f"/api/invitations/{invite.rsplit('/', 1)[-1]}/accept", json={"password": MEMBER_PASSWORD})
    assert again.status_code == 410 and again.json()["error"] == "invitation_used"
    assert client(app_url).post(f"/api/invitations/{uuid.uuid4().hex}/accept", json={"password": MEMBER_PASSWORD}).status_code == 404


def test_wf_project_quota_setup_create(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    name = f"Setup {tok()}"
    with console(browser, app_url, ines, "/console/projects") as page:
        page.get_by_role("button", name="New project").click()
        dialog = page.get_by_role("dialog", name="New project")
        eventually(page, lambda: focused(dialog.get_by_role("textbox", name="Project name")))
        dialog.get_by_role("textbox", name="Project name").fill(name)
        dialog.get_by_role("textbox", name="Monthly quota (minutes)").fill("250")
        dialog.get_by_role("button", name="Create project").click()
        match = eventually(page, lambda: re.fullmatch(r"/console/projects/([0-9a-f-]{36})/keys", urlparse(page.url).path))
        pid = match.group(1)
        eventually(page, lambda: text_of(page.get_by_role("status", name="Keys status")) == PROJECT_CREATED)
        page.reload()
        eventually(page, lambda: page.get_by_role("tab", name="Keys").get_attribute("aria-selected", timeout=SHORT_MS) == "true")
        expect(page.get_by_role("table", name="API keys")).to_be_visible()
        stored = ines.get(f"/api/projects/{pid}").json()["project"]
        assert stored["name"] == name and stored["quota"]["limit_minutes"] == 250
        page.get_by_role("tab", name="Settings").click()
        eventually(page, lambda: urlparse(page.url).path == f"/console/projects/{pid}/settings")
        page.get_by_role("textbox", name="Monthly quota (minutes)").fill("300")
        page.get_by_role("button", name="Save quota").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Settings status")) == QUOTA_SAVED)
        assert ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["limit_minutes"] == 300
        page.goto(app_url + "/console/projects")
        row = page.get_by_role("table", name="Projects").get_by_role("row").filter(has_text=name)
        eventually(page, lambda: meter(0, 300) in text_of(row))


def test_wf_project_quota_setup_invalid(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    existing = new_project(ines)
    with console(browser, app_url, ines, "/console/projects") as page:
        opener = page.get_by_role("button", name="New project")
        opener.click()
        dialog = page.get_by_role("dialog", name="New project")
        name_box = dialog.get_by_role("textbox", name="Project name")
        quota_box = dialog.get_by_role("textbox", name="Monthly quota (minutes)")
        name_box.fill("   ")
        quota_box.fill("0")
        dialog.get_by_role("button", name="Create project").click()
        eventually(page, lambda: dialog.get_by_text(PROJECT_NAME_ERROR, exact=True).is_visible() and dialog.get_by_text(QUOTA_ERROR, exact=True).is_visible())
        name_box.fill(existing["name"].upper())
        quota_box.fill("10")
        dialog.get_by_role("button", name="Create project").click()
        eventually(page, lambda: dialog.get_by_text(NAME_TAKEN, exact=True).is_visible())
        assert name_box.get_attribute("aria-invalid") == "true"
        dialog.get_by_role("button", name="Cancel").click()
        eventually(page, lambda: page.get_by_role("dialog", name="New project").count() == 0 and focused(opener))
    folded = [p for p in projects(ines) if p["name"].casefold() == existing["name"].casefold()]
    assert len(folded) == 1


def test_unique_project_names(app_url: str) -> None:
    ines = signin(app_url, INES)
    t = tok()
    variants = [f"  Caf\u00e9 {t} ", f"CAF\u00c9 {t.upper()}", f"cafe\u0301 {t}", f"\u3000Caf\u00e9 {t}", f"caf\u00e9 {t.upper()} ", f"Cafe\u0301 {t}"]
    gate = threading.Barrier(len(variants))

    def create(name: str) -> httpx.Response:
        gate.wait()
        return signin(app_url, INES).post("/api/projects", json={"name": name, "monthly_quota_minutes": 10})

    with ThreadPoolExecutor(len(variants)) as pool:
        replies = list(pool.map(create, variants))
    statuses = sorted(r.status_code for r in replies)
    assert statuses == [201] + [409] * (len(variants) - 1), statuses
    assert all(r.json()["error"] == "name_taken" for r in replies if r.status_code == 409)
    winner = next(variants[i] for i, r in enumerate(replies) if r.status_code == 201)
    created = next(r for r in replies if r.status_code == 201).json()["project"]
    assert created["name"] == unicodedata.normalize("NFC", winner).strip()
    matching = [p for p in projects(ines) if unicodedata.normalize("NFC", p["name"]).casefold() == f"caf\u00e9 {t}"]
    assert len(matching) == 1
    places = db_rows_with(Postgres(), t) | db_rows_with(Postgres(), t.upper())
    assert places and max(places.values()) == 1, places
    u = tok()
    at_limit = f"{u} " + "e\u0301" * (NAME_MAX - len(u) - 2) + "\U0001fa7a"
    ok = ines.post("/api/projects", json={"name": at_limit, "monthly_quota_minutes": 1})
    assert ok.status_code == 201, ok.text
    assert ok.json()["project"]["name"] == unicodedata.normalize("NFC", at_limit) and len(ok.json()["project"]["name"]) == NAME_MAX
    for bad in (at_limit + "x", "\u3000\u00a0 "):
        r = ines.post("/api/projects", json={"name": bad, "monthly_quota_minutes": 1})
        assert r.status_code == 422 and r.json()["fields"]["name"] == PROJECT_NAME_ERROR


def test_quota_rules(app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines, quota=5)
    pid = project["id"]
    for bad in (0, QUOTA_MAX + 1, 1.5, -1, "ten"):
        r = ines.patch(f"/api/projects/{pid}/quota", json={"monthly_quota_minutes": bad})
        assert r.status_code == 422 and r.json()["fields"]["monthly_quota_minutes"] == QUOTA_ERROR, bad
    for good in (QUOTA_MAX, 1, 5):
        r = ines.patch(f"/api/projects/{pid}/quota", json={"monthly_quota_minutes": good})
        assert r.status_code == 200 and r.json()["quota"]["limit_minutes"] == good
    quota = r.json()["quota"]
    now = iso(quota["server_time"])
    following = datetime(now.year + now.month // 12, now.month % 12 + 1, 1, tzinfo=timezone.utc)
    assert quota["period_start"] == f"{now.year:04d}-{now.month:02d}-01T00:00:00.000Z"
    assert quota["resets_at"] == following.strftime("%Y-%m-%dT00:00:00.000Z")
    assert set(quota) >= {"limit_minutes", "used_seconds", "period_start", "resets_at", "exhausted", "server_time"}
    dev = new_member(app_url, ines, "developer", [pid])
    denied = dev.client.patch(f"/api/projects/{pid}/quota", json={"monthly_quota_minutes": 9})
    assert denied.status_code == 403
    values = list(range(11, 19))
    gate = threading.Barrier(len(values))

    def save(value: int) -> httpx.Response:
        c = signin(app_url, INES)
        gate.wait()
        return c.patch(f"/api/projects/{pid}/quota", json={"monthly_quota_minutes": value})

    with ThreadPoolExecutor(len(values)) as pool:
        replies = list(pool.map(save, values))
    for value, reply in zip(values, replies):
        assert reply.status_code == 200 and reply.json()["quota"]["limit_minutes"] == value
    assert ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["limit_minutes"] in values
    _, secret = new_key(ines, pid)
    with Live(app_url, secret, channels=2) as live:
        sid = live.session_id()
        live.send_audio(pcm(31, 2))
        eventually(None, lambda: ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["used_seconds"] >= 62)
        lowered = ines.patch(f"/api/projects/{pid}/quota", json={"monthly_quota_minutes": 1})
        sent = time.monotonic()
        assert lowered.status_code == 200 and lowered.json()["quota"]["exhausted"] is True
        assert live.wait_closed() == CLOSE_CODES["quota_halted"]
        assert live.closed_at - sent <= HALT_S + LATENCY_SLACK_S
        assert live.wait_state("quota_halted")
    assert session_of(ines, sid)["state"] == "quota_halted"


def test_project_keys(app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    raw = f"  Cafe\u0301 \u2705 {tok()}  "
    r = ines.post(f"/api/projects/{pid}/keys", json={"name": raw})
    assert r.status_code == 201, r.text
    secret, key = r.json()["secret"], r.json()["key"]
    assert re.fullmatch(r"lf_live_[0-9a-f]{32}", secret)
    assert key["prefix"] == secret[:12] and key["revoked_at"] is None
    assert key["name"] == unicodedata.normalize("NFC", raw).strip()
    listing = ines.get(f"/api/projects/{pid}/keys")
    assert secret not in listing.text and secret[12:] not in listing.text
    listed = next(k for k in listing.json()["keys"] if k["id"] == key["id"])
    assert listed["name"] == key["name"] and listed["prefix"] == secret[:12]
    pg = Postgres()
    assert db_rows_with(pg, secret) == {} and db_rows_with(pg, secret[12:]) == {}
    spoken = httpx.post(app_url + "/v1/speak", json={"text": "ready", "voice": "lumen"}, headers={"Authorization": f"Token {secret}"}, timeout=HTTP_TIMEOUT)
    assert spoken.status_code == 201
    at_limit = "\U0001fa7a" * (NAME_MAX - 10) + tok()
    assert ines.post(f"/api/projects/{pid}/keys", json={"name": at_limit}).status_code == 201
    for bad in (at_limit + "x", " \u00a0 "):
        refused = ines.post(f"/api/projects/{pid}/keys", json={"name": bad})
        assert refused.status_code == 422 and refused.json()["fields"]["name"] == KEY_NAME_ERROR


def test_key_revocation(app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    key_id, secret = new_key(ines, pid)
    _, other = new_key(ines, pid)
    a, b, c = Live(app_url, secret), Live(app_url, secret), Live(app_url, other)
    ids = [s.session_id() for s in (a, b, c)]
    for s in (a, b, c):
        s.send_audio(pcm(1))
        s.wait_state("live")
    r = ines.delete(f"/api/projects/{pid}/keys/{key_id}")
    sent = time.monotonic()
    assert r.status_code == 200, r.text
    assert set(r.json()["closed_sessions"]) == set(ids[:2]) and r.json()["key"]["revoked_at"]
    for s in (a, b):
        assert s.wait_closed() == CLOSE_CODES["revoked"] and s.closed_at - sent <= REVOKE_S + LATENCY_SLACK_S
        assert s.wait_state("revoked")
    assert [session_of(ines, i)["state"] for i in ids] == ["revoked", "revoked", "live"]
    c.finish()
    c.wait_closed()
    late = Live(app_url, secret)
    assert late.status == 401 and late.body["error"] == "invalid_key"
    speak = httpx.post(app_url + "/v1/speak", json={"text": "x", "voice": "lumen"}, headers={"Authorization": f"Token {secret}"})
    assert speak.status_code == 401 and speak.json()["error"] == "invalid_key"
    console_start = start(ines, pid, {"key_id": key_id, "source": "tone"})
    assert console_start.status_code == 409 and console_start.json()["error"] == "key_revoked"
    synth = ines.post(f"/api/projects/{pid}/synthesis", json={"key_id": key_id, "text": "x", "voice": "lumen"})
    assert synth.status_code == 409 and synth.json()["error"] == "key_revoked"
    twice = ines.delete(f"/api/projects/{pid}/keys/{key_id}")
    assert twice.status_code == 409 and twice.json()["error"] == "already_revoked"


def test_synthesis_jobs(app_url: str) -> None:
    ines = signin(app_url, INES)
    org = me(ines)["org"]["id"]
    pid = new_project(ines)["id"]
    key_id, secret = new_key(ines, pid)
    auth = {"Authorization": f"Token {secret}"}
    text = "take\u00a0two\u3000tablets"
    r = httpx.post(app_url + "/v1/speak", json={"text": f"  {text} ", "voice": "lumen"}, headers=auth, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, r.text
    job = r.json()["job"]
    assert job["duration_ms"] == 3 * WORD_MS and job["characters"] == len(text) and job["voice"] == "lumen"
    assert job["audio_url"] == f"/v1/speak/{job['id']}/audio"
    assert job["console_audio_url"] == f"/api/projects/{pid}/synthesis/{job['id']}/audio"
    audio = httpx.get(app_url + job["audio_url"], headers=auth, timeout=HTTP_TIMEOUT)
    assert audio.status_code == 200 and audio.headers["content-type"].startswith("audio/wav")
    data = audio.content
    assert len(data) == WAV_HEADER + job["duration_ms"] * BYTES_PER_MS
    channels, rate, bits, payload = wav_format(data)
    assert (channels, rate, bits) == (1, SAMPLE_RATE, 16) and len(set(payload)) > 1
    assert ines.get(job["console_audio_url"]).content == data
    assert S3().get(f"orgs/{org}/projects/{pid}/synthesis/{job['id']}.wav") == data
    again = ines.post(f"/api/projects/{pid}/synthesis", json={"key_id": key_id, "text": text, "voice": "lumen"}).json()["job"]
    assert ines.get(again["console_audio_url"]).content == data
    five = ines.post(f"/api/projects/{pid}/synthesis", json={"key_id": key_id, "text": "one two three four five", "voice": "basalt"}).json()["job"]
    assert five["duration_ms"] == 5 * WORD_MS
    longest = ines.post(f"/api/projects/{pid}/synthesis", json={"key_id": key_id, "text": "\U0001fa7a" * SYNTH_MAX, "voice": "lumen"})
    assert longest.status_code == 201 and longest.json()["job"]["characters"] == SYNTH_MAX and longest.json()["job"]["duration_ms"] == WORD_MS
    for body, field, message in (
        ({"text": "\u3000", "voice": "lumen"}, "text", SYNTH_ERROR),
        ({"text": "x" * (SYNTH_MAX + 1), "voice": "lumen"}, "text", SYNTH_ERROR),
        ({"text": "hello", "voice": "tenor"}, "voice", VOICE_ERROR),
    ):
        bad = httpx.post(app_url + "/v1/speak", json=body, headers=auth)
        assert bad.status_code == 422 and bad.json()["fields"][field] == message
    missing = ines.post(f"/api/projects/{pid}/synthesis", json={"text": "x", "voice": "lumen"})
    assert missing.status_code == 422 and missing.json()["fields"]["key_id"] == KEY_FIELD_ERROR
    assert ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["used_seconds"] == 0


def test_wf_keys_and_synthesis_rotation(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    dev = new_member(app_url, ines, "developer", [pid])
    key_name = f"Ward \u2705 {tok()}"
    label = f"Rotate {tok()}"
    with console(browser, app_url, dev.client, f"/console/projects/{pid}/keys") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        page.get_by_role("button", name="Issue key").click()
        dialog = page.get_by_role("dialog", name="Issue key")
        dialog.get_by_role("textbox", name="Key name").fill(key_name)
        dialog.get_by_role("button", name="Create key").click()
        secret_box = page.get_by_role("textbox", name="New key")
        secret = eventually(page, lambda: (v := secret_box.input_value(timeout=SHORT_MS)) and re.fullmatch(r"lf_live_[0-9a-f]{32}", v) and v)
        eventually(page, lambda: page.get_by_text(KEY_CREATED, exact=True).first.is_visible())
        page.get_by_role("button", name="Copy key").click()
        assert page.evaluate("navigator.clipboard.readText()") == secret
        page.keyboard.press("Escape")
        eventually(page, lambda: page.get_by_role("dialog").count() == 0, what="the Issue key dialog to close")
        live = Live(app_url, secret, label=label)
        sid = live.session_id()
        feeder = Feeder(live)
        page.get_by_role("tab", name="Sessions").click()
        link = page.get_by_role("table", name="Sessions").get_by_role("link", name=label)
        eventually(page, lambda: link.is_visible())
        link.click()
        eventually(page, lambda: urlparse(page.url).path == f"/console/sessions/{sid}")
        eventually(page, lambda: text_of(page.get_by_role("status", name="Session status")) == SESSION_COPY["live"])
        page.goto(f"{app_url}/console/projects/{pid}/keys")
        page.get_by_role("button", name=f"Revoke {key_name}").click()
        confirm = page.get_by_role("dialog", name="Revoke key")
        confirm.get_by_role("button", name="Revoke key").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Keys status")) == "Key revoked. Live sessions closed: 1.")
        eventually(page, lambda: contains_focus(page.get_by_role("table", name="API keys")))
        assert live.wait_closed() == CLOSE_CODES["revoked"]
        feeder.halt()
    with console(browser, app_url, dev.client, f"/console/sessions/{sid}", clock=DEVICE_CLOCK) as page:
        canvas = page.get_by_role("img", name="Session field")
        for _ in range(2):
            eventually(page, lambda: canvas.get_attribute("data-end-state", timeout=SHORT_MS) == "revoked" and canvas.get_attribute("data-session-state") == "quota_halted")
            eventually(page, lambda: text_of(page.get_by_role("status", name="Session status")) == SESSION_COPY["revoked"])
            page.reload()
    assert session_of(dev.client, sid)["state"] == "revoked"
    assert db_rows_with(Postgres(), secret) == {}


def test_wf_keys_and_synthesis_render(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    org = me(ines)["org"]["id"]
    pid = new_project(ines)["id"]
    dev = new_member(app_url, ines, "developer", [pid])
    key_name = f"Synth {tok()}"
    _, secret = new_key(dev.client, pid, key_name)
    with console(browser, app_url, dev.client, f"/console/projects/{pid}/synthesis") as page:
        bodies: list[str] = []
        page.on("request", lambda req: bodies.append(req.post_data or "") if "/synthesis" in req.url and req.method == "POST" else None)
        select(page.get_by_role("combobox", name="API key"), key_name)
        text_box = page.get_by_role("textbox", name="Text to speak")
        text_box.fill("   ")
        page.get_by_role("button", name="Render").click()
        eventually(page, lambda: page.get_by_text(SYNTH_ERROR, exact=True).first.is_visible())
        text_box.fill("take\u00a0two\u3000tablets")
        check(page.get_by_role("radiogroup", name="Voice").get_by_role("radio", name="Basalt"))
        page.get_by_role("button", name="Render").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Synthesis status")) == "Rendered 0.900 seconds of audio.")
        player = page.get_by_label("Rendered audio")
        src = eventually(page, lambda: player.evaluate("e => e.currentSrc || e.src || (e.querySelector('source') || {}).src || ''"))
        job = re.search(rf"/api/projects/{pid}/synthesis/([0-9a-f-]{{36}})/audio", src).group(1)
        played = page.request.get(src).body()
        assert all(secret not in b for b in bodies) and bodies
    assert len(played) == WAV_HEADER + 3 * WORD_MS * BYTES_PER_MS
    assert S3().get(f"orgs/{org}/projects/{pid}/synthesis/{job}.wav") == played


def test_wf_keys_and_synthesis_invalid_name(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    good = "\u2705" * (NAME_MAX - 10) + tok()
    with console(browser, app_url, ines, f"/console/projects/{pid}/keys", width=375, height=812) as page:
        page.get_by_role("button", name="Issue key").click()
        dialog = page.get_by_role("dialog", name="Issue key")
        dialog.get_by_role("textbox", name="Key name").fill(good + "x")
        dialog.get_by_role("button", name="Create key").click()
        eventually(page, lambda: page.get_by_text(KEY_NAME_ERROR, exact=True).first.is_visible())
        assert [k for k in ines.get(f"/api/projects/{pid}/keys").json()["keys"]] == []
        dialog.get_by_role("textbox", name="Key name").fill(f"  {good}  ")
        dialog.get_by_role("button", name="Create key").click()
        eventually(page, lambda: page.get_by_text(KEY_CREATED, exact=True).first.is_visible())
    names = [k["name"] for k in ines.get(f"/api/projects/{pid}/keys").json()["keys"]]
    assert names == [good]


def test_live_endpoint(app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines, quota=50)["id"]
    _, secret = new_key(ines, pid)
    label = f"Live {tok()}"
    cues = [(0, 1000, "dose@0.90 ten@0.80"), (1000, 2000, "units@0.95")]
    with Live(app_url, secret, channels=2, label=label, sample_rate=SAMPLE_RATE) as live:
        assert live.status == 101
        sid = live.session_id()
        live.send_json({"type": "sidecar", "vtt": vtt(cues)})
        live.wait_state("live")
        live.send_audio(pcm(1.5, 2))
        first = live.wait(lambda m: m.get("type") == "segment" and m["segment"]["index"] == 0)["segment"]
        words = first["machine"]["words"]
        assert [(w["text"], w["confidence"], w["start_ms"]) for w in words] == [("dose", 0.9, 0), ("ten", 0.8, 500)]
        assert first["flagged"] is True and first["start_ms"] == 0 and first["end_ms"] == 1000
        live.send_json({"type": "sidecar", "vtt": vtt(cues)})
        assert live.wait(lambda m: m.get("type") == "error")["error"] == "sidecar_too_late"
        quota = [live.wait(lambda m: m.get("type") == "quota" and m["used_seconds"] == 3)]
        stamps = [t for t, m in live.messages if m.get("type") == "quota"]
        eventually(None, lambda: len([t for t, m in live.messages if m.get("type") == "quota"]) >= len(stamps) + 1, QUOTA_EVERY_S * 2 + 1)
        stamps = [t for t, m in live.messages if m.get("type") == "quota"]
        assert stamps[-1] - stamps[-2] <= QUOTA_EVERY_S + LATENCY_SLACK_S
        assert quota[0]["limit_seconds"] == 50 * 60 and "server_time" not in quota[0]
        assert not any(m.get("type") == "segment" and m["segment"]["index"] == 1 for _, m in live.messages)
        live.finish()
        assert live.wait_closed() == CLOSE_CODES["closed"]
        assert live.wait_state("closed")["close_reason"] == "client"
    s = session_of(ines, sid)
    assert (s["kind"], s["source"], s["channels"], s["sample_rate"], s["label"], s["audio_ms"], s["close_reason"]) == ("live", "live", 2, SAMPLE_RATE, label, 1500, "client")
    assert len(transcript_of(ines, sid)["segments"]) == 2
    for size, code in ((WS_MESSAGE_LIMIT + 2, OVERSIZE_CODE), (3, FRAMING_CODE)):
        with Live(app_url, secret) as live:
            other = live.session_id()
            if code == OVERSIZE_CODE:
                live.send_raw(b"\0" * WS_MESSAGE_LIMIT)
            live.send_raw(b"\0" * size)
            assert live.wait_closed() == code
        ended = wait_session(ines, other, lambda x: x["state"] in ENDED)
        assert (ended["state"], ended["close_reason"]) == ("closed", "client")
    for kwargs, field, message in (
        ({"channels": 3}, "channels", "Use 1 or 2 channels."),
        ({"sample_rate": 8000}, "sample_rate", "Use a sample rate of 16000."),
        ({"label": "l" * (LABEL_MAX + 1)}, "label", LABEL_ERROR),
    ):
        refused = Live(app_url, secret, **kwargs)
        assert refused.status == 422 and refused.body["fields"][field] == message
    for token in (None, "lf_live_" + "f" * 32):
        refused = Live(app_url, token)
        assert refused.status == 401 and refused.body["error"] == "invalid_key"


def test_server_decided_state() -> None:
    base = short_url()
    ines = signin(base, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    with Live(base, secret) as live:
        sid = live.session_id()
        live.send_audio(pcm(1))
        last = time.monotonic()
        assert live.wait_closed(SHORT_IDLE_S + WAIT_S) == CLOSE_CODES["idle_closed"]
        assert live.closed_at - last >= SHORT_IDLE_S - LATENCY_SLACK_S
        assert live.wait_state("idle_closed")
    assert session_of(ines, sid)["state"] == "idle_closed"
    with Live(base, secret) as live:
        sid = live.session_id()
        live.send_audio(pcm(SHORT_CAP_S + 1))
        assert live.wait_closed() == CLOSE_CODES["closed"]
        assert live.wait_state("closed")["close_reason"] == "cap"
    with Live(base, secret) as live:
        sid = live.session_id()
        began = live.arrival(lambda m: m.get("type") == "state" and m.get("state") == "live")
        feeder = Feeder(live, chunk_s=FEED_STEP_S, every_s=1)
        assert live.wait_closed(SHORT_CAP_S + WAIT_S) == CLOSE_CODES["closed"]
        feeder.halt()
        assert live.closed_at - began >= SHORT_CAP_S - LATENCY_SLACK_S
    capped = session_of(ines, sid)
    assert capped["close_reason"] == "cap" and capped["audio_ms"] < SHORT_CAP_S * 1000
    with Live(base, secret) as live:
        sid = live.session_id()
        live.send_audio(pcm(1))
        live.wait_state("live")
        r = ines.post(f"/api/sessions/{sid}/close")
        assert r.status_code == 200 and r.json()["session"]["state"] == "closed" and r.json()["session"]["close_reason"] == "client"
        assert live.wait_closed() == CLOSE_CODES["closed"]
    again = ines.post(f"/api/sessions/{sid}/close")
    assert again.status_code == 409 and again.json()["error"] == "session_ended"


def test_wf_live_streaming_idle(browser: Browser) -> None:
    base = short_url()
    ines = signin(base, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    with Live(base, secret) as capped:
        capped_id = capped.session_id()
        capped.send_audio(pcm(SHORT_CAP_S + 1))
        capped.wait_closed()
    live = Live(base, secret)
    sid = live.session_id()
    feeder = Feeder(live)
    with console(browser, base, ines, f"/console/sessions/{sid}", clock=DEVICE_CLOCK) as page:
        status = page.get_by_role("status", name="Session status")
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: text_of(status) == SESSION_COPY["live"] and canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "live")
        feeder.halt()
        eventually(page, lambda: text_of(status) == SESSION_COPY["idle_closed"], SHORT_IDLE_S + WAIT_S)
        page.reload()
        eventually(page, lambda: text_of(status) == SESSION_COPY["idle_closed"] and canvas.get_attribute("data-end-state", timeout=SHORT_MS) == "idle_closed" and canvas.get_attribute("data-session-state") == "closed")
        page.goto(f"{base}/console/sessions/{capped_id}")
        eventually(page, lambda: text_of(status) == SESSION_COPY["cap"])
    assert live.wait_closed() == CLOSE_CODES["idle_closed"]
    assert session_of(ines, sid)["state"] == "idle_closed"


def test_stream_connections_released(app_url: str) -> None:
    pg = Postgres()
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)

    def cycle() -> str:
        live = Live(app_url, secret)
        sid = live.session_id()
        live.send_audio(pcm(1))
        live.wait_state("live")
        eventually(None, lambda: len(stream_connections(pg, sid)) == 1, RELEASE_S)
        with ines.stream("GET", f"/api/sessions/{sid}/events") as events:
            assert events.status_code == 200
            eventually(None, lambda: len(stream_connections(pg, sid)) == 2, RELEASE_S)
            assert not any(r["in_tx"] for r in stream_connections(pg, sid))
        eventually(None, lambda: len(stream_connections(pg, sid)) == 1, RELEASE_S + LATENCY_SLACK_S)
        live.drop()
        dropped = time.monotonic()
        eventually(None, lambda: len(stream_connections(pg, sid)) == 0, RELEASE_S + LATENCY_SLACK_S)
        assert time.monotonic() - dropped <= RELEASE_S + LATENCY_SLACK_S
        ended = wait_session(ines, sid, lambda s: s["state"] in ENDED, RELEASE_S + LATENCY_SLACK_S)
        assert (ended["state"], ended["close_reason"]) == ("closed", "disconnect")
        return sid

    cycle()
    for _ in range(10):
        cycle()

    def settled() -> bool:
        rows = app_connections(pg)
        return all(r["state"] != "active" and not r["in_tx"] for r in rows) and not any((r["app"] or "").startswith("lowfield-stream:") for r in rows)

    eventually(None, settled, RELEASE_S * 2)
    assert client(app_url).get("/api/health").status_code == 200 and ines.get("/api/projects").status_code == 200


def test_announced_session_states(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    key_id, _ = new_key(ines, pid)
    sid = start(ines, pid, {"key_id": key_id, "source": "tone"}).json()["session"]["id"]
    with console(browser, app_url, ines, f"/console/sessions/{sid}") as page:
        status = page.get_by_role("status", name="Session status")
        eventually(page, lambda: text_of(status) in (SESSION_COPY["connecting"], SESSION_COPY["live"]))
        assert status.get_attribute("aria-live") in (None, "polite")
        status.evaluate("el => { window.__said = [el.textContent.trim()]; new MutationObserver(() => { const t = el.textContent.trim(); if (window.__said[window.__said.length - 1] !== t) window.__said.push(t); }).observe(el, {subtree: true, childList: true, characterData: true}); }")
        projects_link = page.get_by_role("navigation", name="Console").get_by_role("link", name="Projects")
        projects_link.focus()
        eventually(page, lambda: text_of(status) == SESSION_COPY["closed"], TONE_S + WAIT_S)
        said = [t for t in page.evaluate("window.__said")]
        spoken = [t for t in said if t]
        assert spoken[-1] == SESSION_COPY["closed"] and SESSION_COPY["live"] in spoken
        assert len(spoken) == len(set(spoken)), said
        assert set(spoken) <= {SESSION_COPY["connecting"], SESSION_COPY["live"], SESSION_COPY["closed"]}
        assert focused(projects_link)
    assert session_of(ines, sid)["close_reason"] == "end_of_audio"


def test_wf_live_streaming_watch(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    org = me(ines)["org"]["id"]
    pid = new_project(ines)["id"]
    dev = new_member(app_url, ines, "developer", [pid])
    _, secret = new_key(dev.client, pid)
    label = f"Watch {tok()}"
    live = Live(app_url, secret, label=label)
    sid = live.session_id()
    live.send_json({"type": "sidecar", "vtt": vtt([(i * 1000, (i + 1) * 1000, f"word{i}@0.90") for i in range(6)])})
    feeder = Feeder(live, seconds=8)
    with console(browser, app_url, dev.client, f"/console/projects/{pid}/sessions") as page:
        link = page.get_by_role("table", name="Sessions").get_by_role("link", name=label)
        eventually(page, lambda: link.is_visible())
        link.click()
        eventually(page, lambda: urlparse(page.url).path == f"/console/sessions/{sid}")
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: text_of(page.get_by_role("status", name="Session status")) == SESSION_COPY["live"] and canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "live")
        first = int(eventually(page, lambda: canvas.get_attribute("data-frame", timeout=SHORT_MS)))
        eventually(page, lambda: int(canvas.get_attribute("data-frame", timeout=SHORT_MS)) > first)
        transcript = page.get_by_role("region", name="Transcript")
        eventually(page, lambda: transcript.get_by_role("button", name=re.compile(r"^Segment 2: word1")).count() == 1)
        sent = feeder.halt()
        live.finish()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Session status")) == SESSION_COPY["closed"] and canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "closed")
    assert live.wait_closed() == CLOSE_CODES["closed"]
    assert session_of(dev.client, sid)["close_reason"] == "client"
    assert S3().get(f"orgs/{org}/projects/{pid}/sessions/{sid}/capture.pcm") == sent


def test_replay_real_time(app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    key_id, _ = new_key(ines, pid)
    tone = start(ines, pid, {"key_id": key_id, "source": "tone"})
    assert tone.status_code == 201 and tone.json()["session"]["state"] in ("connecting", "live")
    tid = tone.json()["session"]["id"]
    assert tone.json()["session"]["kind"] == "replay" and tone.json()["session"]["source"] == "tone"
    wait_session(ines, tid, lambda s: s["state"] == "live")
    seen_live = time.monotonic()
    eventually(None, lambda: time.monotonic() - seen_live >= TONE_S / 2 or None, TONE_S)
    assert session_of(ines, tid)["state"] == "live"
    cues = [(i * 1000, (i + 1) * 1000, f"w{i}@0.90") for i in range(4)]
    up = start(ines, pid, {"key_id": key_id, "source": "upload", "label": f"Rep {tok()}"}, wav(noise(4)), vtt(cues).encode())
    assert up.status_code == 201
    uid = up.json()["session"]["id"]
    wait_session(ines, uid, lambda s: s["state"] == "live" and s["audio_ms"] >= 1000)
    s = session_of(ines, uid)
    segments = transcript_of(ines, uid)["segments"]
    assert s["state"] == "live" and all(seg["end_ms"] <= s["audio_ms"] + 1000 // 30 + 1 for seg in segments) and len(segments) < 4
    done = wait_session(ines, tid, lambda x: x["state"] in ENDED, TONE_S + WAIT_S)
    assert (done["state"], done["close_reason"], done["audio_ms"]) == ("closed", "end_of_audio", TONE_S * 1000)
    assert iso(done["ended_at"]) >= iso(done["live_at"])
    ended = wait_session(ines, uid, lambda x: x["state"] in ENDED)
    assert ended["close_reason"] == "end_of_audio" and len(transcript_of(ines, uid)["segments"]) == 4


SIDECAR_CASES = {
    "no-header": "00:00.000 --> 00:01.000\nword@0.90\n",
    "overlap": vtt([(0, 1000, "a@0.90"), (500, 1500, "b@0.90")]),
    "backwards": vtt([(1000, 500, "a@0.90")]),
    "out-of-order": vtt([(1000, 1500, "a@0.90"), (0, 500, "b@0.90")]),
    "three-decimals": vtt([(0, 1000, "a@0.905")]),
    "no-confidence": vtt([(0, 1000, "word")]),
    "above-one": vtt([(0, 1000, "a@1.50")]),
}


def test_upload_validation_idempotency(app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    key_id, _ = new_key(ines, pid)
    good = wav(noise(0.5))
    sidecar = vtt([(0, 500, "ok@0.90")]).encode()
    label = f"Up {tok()}"
    fields = {"key_id": key_id, "source": "upload", "label": label}
    audio_cases = {
        "missing": None, "rate": wav(noise(0.5), rate=8000), "channels": wav(noise(0.5, 3), channels=3),
        "bits": wav(noise(0.25), bits=8), "not-riff": b"not a wav file at all",
    }
    for case, audio in audio_cases.items():
        r = start(ines, pid, fields, audio, sidecar)
        assert r.status_code == 422 and r.json()["fields"]["audio"] == AUDIO_ERROR, case
    for case, text in SIDECAR_CASES.items():
        r = start(ines, pid, fields, good, text.encode())
        assert r.status_code == 422 and r.json()["fields"]["sidecar"] == SIDECAR_ERROR, case
    r = start(ines, pid, fields, good, b"WEBVTT\n\n" + b"\n" * (SIDECAR_LIMIT + 1))
    assert r.status_code == 422 and r.json()["fields"]["sidecar"] == SIDECAR_ERROR
    for change, field, message in (
        ({"key_id": ""}, "key_id", KEY_FIELD_ERROR), ({"source": "file"}, "source", SOURCE_ERROR), ({"label": "l" * (LABEL_MAX + 1)}, "label", LABEL_ERROR),
    ):
        r = start(ines, pid, fields | change, good, sidecar)
        assert r.status_code == 422 and r.json()["fields"][field] == message, field
    r = start(ines, pid, fields, good, sidecar, key="k" * (IDEMPOTENCY_MAX + 1))
    assert r.status_code == 422 and r.json()["fields"]["idempotency_key"] == IDEMPOTENCY_ERROR
    assert start(ines, pid, fields | {"key_id": str(uuid.uuid4())}, good, sidecar).status_code == 404
    over = start(ines, pid, fields, wav(b"\0" * (AUDIO_LIMIT + 1 - WAV_HEADER)), sidecar)
    assert over.status_code == 422 and over.json()["fields"]["audio"] == AUDIO_TOO_LARGE
    oversized, ctype = multipart(fields, {"audio": ("recording.wav", wav(b"\0" * (MULTIPART_LIMIT + 1 - WAV_HEADER)), "audio/wav"), "sidecar": ("recording.vtt", sidecar, "text/vtt")})
    assert early_reply_status(ines, f"/api/projects/{pid}/sessions", oversized, ctype) == 413
    assert sessions_labelled(ines, pid, label) == []
    biggest = start(ines, pid, fields | {"label": f"Max {tok()}"}, wav(b"\0" * (AUDIO_LIMIT - WAV_HEADER)))
    assert biggest.status_code == 201, biggest.text
    ines.post(f"/api/sessions/{biggest.json()['session']['id']}/close")
    key = idempotency_key()
    assert start(ines, pid, fields | {"source": "nope"}, good, sidecar, key=key).status_code == 422
    first = start(ines, pid, fields, good, sidecar, key=key)
    assert first.status_code == 201, first.text
    replay = start(ines, pid, fields, good, sidecar, key=key)
    assert replay.status_code == 201 and replay.content == first.content
    conflict = start(ines, pid, fields | {"label": label + " other"}, good, sidecar, key=key)
    assert conflict.status_code == 409 and conflict.json()["error"] == "idempotency_conflict"
    assert len(sessions_labelled(ines, pid, label)) == 1
    dev = new_member(app_url, ines, "developer", [pid])
    theirs = start(dev.client, pid, fields, good, sidecar, key=key)
    assert theirs.status_code == 201 and theirs.json()["session"]["id"] != first.json()["session"]["id"]
    race_label = f"Race {tok()}"
    race_key = idempotency_key()
    gate = threading.Barrier(2)

    def press() -> httpx.Response:
        c = signin(app_url, INES)
        gate.wait()
        return start(c, pid, fields | {"label": race_label}, good, sidecar, key=race_key)

    with ThreadPoolExecutor(2) as pool:
        racing = list(pool.map(lambda _: press(), range(2)))
    created = [r for r in racing if r.status_code == 201]
    assert created and all(r.status_code == 201 or r.json()["error"] == "idempotency_in_progress" for r in racing)
    assert len({r.json()["session"]["id"] for r in created}) == 1
    assert len(sessions_labelled(ines, pid, race_label)) == 1


def test_originals_byte_for_byte(app_url: str) -> None:
    ines = signin(app_url, INES)
    org = me(ines)["org"]["id"]
    pid = new_project(ines)["id"]
    key_id, secret = new_key(ines, pid)
    reviewer = new_member(app_url, ines, "reviewer", [pid])
    approver = new_member(app_url, ines, "approver", [pid])
    audio = wav(noise(2, seed=11), extra=b"LIST" + struct.pack("<I", 16) + b"INFOICMT" + struct.pack("<I", 4) + b"tst\0")
    sidecar = (vtt([(0, 1000, "dose@0.62 ten@0.91"), (1000, 2000, "units@0.95")]) + "\n").encode()
    r = start(ines, pid, {"key_id": key_id, "source": "upload"}, audio, sidecar)
    assert r.status_code == 201
    sid = r.json()["session"]["id"]
    early = ines.get(f"/api/sessions/{sid}/transcript/machine.json")
    assert early.status_code == 409 and early.json()["error"] == "session_open"
    wait_session(ines, sid, lambda s: s["state"] in ENDED, WAIT_S)
    prefix = f"orgs/{org}/projects/{pid}/sessions/{sid}/"
    store = S3()
    assert store.get(prefix + "upload.wav") == audio and store.get(prefix + "sidecar.vtt") == sidecar
    served = ines.get(f"/api/sessions/{sid}/audio")
    assert served.headers["content-type"].startswith("audio/wav") and served.content == audio
    artifact = store.get(prefix + "machine-transcript.json")
    machine = ines.get(f"/api/sessions/{sid}/transcript/machine.json")
    assert machine.headers["content-type"].startswith("application/json") and machine.content == artifact
    parsed = json.loads(artifact.decode("utf-8"))
    assert parsed["session_id"] == sid and [s["index"] for s in parsed["segments"]] == [0, 1]
    assert [w["text"] for w in parsed["segments"][0]["words"]] == ["dose", "ten"] and parsed["segments"][0]["words"][0]["confidence"] == 0.62
    seg = transcript_of(ines, sid)["segments"][0]["id"]
    cid = reviewer.client.post(f"/api/sessions/{sid}/segments/{seg}/corrections", json={"text": "dose two"}).json()["correction"]["id"]
    reviewer.client.post(f"/api/corrections/{cid}/submit")
    assert approver.client.post(f"/api/corrections/{cid}/approve").status_code == 200
    assert store.get(prefix + "machine-transcript.json") == artifact and store.get(prefix + "upload.wav") == audio
    assert ines.get(f"/api/sessions/{sid}/transcript/machine.json").content == artifact
    lid, sent = recorded_session(app_url, secret, None, seconds=1.5)
    assert store.get(f"orgs/{org}/projects/{pid}/sessions/{lid}/capture.pcm") == sent
    capture = ines.get(f"/api/sessions/{lid}/audio")
    assert capture.headers["content-type"].replace(" ", "").lower() == L16_TYPE.replace("<n>", "1").lower() and capture.content == sent


def test_search_visible_projects_only(app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    t = tok()
    word = "lex" + tok()
    a, _ = recorded_session(app_url, secret, None, seconds=0.5, label=f"{t} alpha")
    b, _ = recorded_session(app_url, secret, [(0, 500, f"{word}@0.90")], seconds=0.5, label=f"{t} beta")
    dev = new_member(app_url, ines, "developer", [pid])
    for c in (ines, dev.client):
        r = c.get("/api/sessions/search", params={"q": t.upper()})
        assert r.status_code == 200 and r.json()["total"] == 2 and {s["id"] for s in r.json()["sessions"]} == {a, b}
        assert iso(r.json()["sessions"][0]["started_at"]) >= iso(r.json()["sessions"][1]["started_at"])
    by_word = ines.get("/api/sessions/search", params={"q": word.upper()}).json()
    assert by_word["total"] == 1 and by_word["sessions"][0]["id"] == b
    for outsider in (signin(app_url, NADIA), signin(app_url, JO)):
        r = outsider.get("/api/sessions/search", params={"q": t})
        assert r.status_code == 200 and r.json()["total"] == 0 and r.json()["sessions"] == []
    for bad in ("", "q" * (QUERY_MAX + 1), "\u3000"):
        r = ines.get("/api/sessions/search", params={"q": bad})
        assert r.status_code == 422 and r.json()["fields"]["q"] == QUERY_ERROR
    assert ines.get("/api/sessions/search", params={"q": "q" * QUERY_MAX}).status_code == 200


def test_search_latest_input_wins(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    t = tok()
    alpha, _ = recorded_session(app_url, secret, None, seconds=0.5, label=f"{t} alpha")
    recorded_session(app_url, secret, None, seconds=0.5, label=f"{t} beta")
    with console(browser, app_url, ines, "/console/projects") as page:
        parked: list[Any] = []
        sent: list[str] = []
        finished: list[str] = []

        def route_search(route: Any) -> None:
            q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
            sent.append(q)
            if q == t and not parked:
                parked.append(route)
                return
            route.fallback()

        page.route("**/api/sessions/search**", route_search)
        page.on("requestfinished", lambda req: finished.append(parse_qs(urlparse(req.url).query).get("q", [""])[0]) if "/api/sessions/search" in req.url else None)
        box_ = page.get_by_role("searchbox", name="Search sessions")
        status = page.get_by_role("status", name="Search results")
        results = page.get_by_role("list", name="Session results")
        box_.focus()
        page.keyboard.type(t)
        advance(page, DEBOUNCE_MS + 50)
        eventually(page, lambda: parked)
        page.keyboard.type(" alpha")
        eventually(page, lambda: text_of(status) == "1 session found." and results.get_by_role("listitem").count() == 1)
        parked[0].fallback()
        eventually(page, lambda: t in finished)
        advance(page, DEBOUNCE_MS * 4)
        assert text_of(status) == "1 session found." and results.get_by_role("listitem").count() == 1
        expect(results.get_by_role("listitem").first).to_contain_text(f"{t} alpha")
        box_.fill("x" * (QUERY_MAX + 1))
        advance(page, DEBOUNCE_MS + 50)
        eventually(page, lambda: "x" * (QUERY_MAX + 1) in finished)
        assert text_of(status) == "1 session found." and results.get_by_role("listitem").count() == 1
        box_.fill(t)
        eventually(page, lambda: text_of(status) == "2 sessions found.")
        before = len(sent)
        box_.fill("")
        advance(page, DEBOUNCE_MS * 4)
        assert len(sent) == before and text_of(status) == ""
        assert results.get_by_role("listitem").count() == 0
        box_.fill(f"{t} alpha")
        eventually(page, lambda: results.get_by_role("listitem").count() == 1)
        item = results.get_by_role("listitem").first
        target = item.get_by_role("link") if item.get_by_role("link").count() else item.get_by_role("button") if item.get_by_role("button").count() else item
        target.first.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: urlparse(page.url).path == f"/console/sessions/{alpha}")


def test_list_to_detail_morph(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    label = f"Morph {tok()}"
    sid, _ = recorded_session(app_url, secret, None, seconds=1, label=label)
    for reduced in ("no-preference", "reduce"):
        with console(browser, app_url, ines, f"/console/projects/{pid}/sessions", reduced_motion=reduced) as page:
            table = page.get_by_role("table", name="Sessions")
            thumb = table.get_by_role("img", name="Spectrum thumbnail")
            eventually(page, lambda: thumb.count() >= 1)
            assert thumb.first.get_attribute("data-morph") == sid
            morph = page.locator(f'[data-morph="{sid}"]').first
            start_rect = sample(morph)
            table.get_by_role("link", name=label).click()
            with contextlib.suppress(AssertionError):
                eventually(
                    None,
                    lambda: morph.count() == 1
                    and (
                        morph.evaluate("e => e.getAnimations({subtree: true}).length > 0", timeout=SHORT_MS)
                        or not near(sample(morph), start_rect)
                    ),
                    seconds=MORPH_START_S,
                    what="the morph element to mount",
                )
            path = motion(morph, MORPH_MAX_MS)
            eventually(page, lambda: urlparse(page.url).path == f"/console/sessions/{sid}")
            final = sample(page.locator(f'[data-morph="{sid}"]').first)
            if reduced == "reduce":
                assert all(near(p, start_rect) or near(p, final) for p in path), path
                painted = motion(page.locator(f'[data-morph="{sid}"]').first, MORPH_MAX_MS)
                assert all(near(p, final) for p in painted), painted
                continue
            assert near(path[-1], final)
            assert any(near(p, start_rect) for p in path[:2]), (start_rect, path[:2])
            assert any(not near(p, start_rect) and not near(p, final) for p in path)
            assert all(not near(p, final) for p in path if p.get("t", p.get("time", MORPH_MAX_MS)) < MORPH_MIN_MS)
            assert all(near(p, final) for p in path if p.get("t", p.get("time", 0)) >= MORPH_MAX_MS)


def upload_files(page: Page, audio: bytes, sidecar: bytes | None) -> None:
    page.get_by_label("Audio file").set_input_files({"name": "recording.wav", "mimeType": "audio/wav", "buffer": audio})
    if sidecar is not None:
        page.get_by_label("Sidecar (WebVTT)").set_input_files({"name": "recording.vtt", "mimeType": "text/vtt", "buffer": sidecar})


def test_wf_replay_and_search_upload_retry(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    org = me(ines)["org"]["id"]
    pid = new_project(ines)["id"]
    key_name = f"Replay {tok()}"
    new_key(ines, pid, key_name)
    label = f"Retry {tok()}"
    audio = wav(noise(3, seed=3))
    sidecar = vtt([(0, 1000, "a@0.90"), (1000, 2000, "b@0.70"), (2000, 3000, "c@0.95")]).encode()
    with console(browser, app_url, ines, f"/console/projects/{pid}/sessions") as page:
        keys_sent: list[str | None] = []

        def route_start(route: Any) -> None:
            if route.request.method != "POST":
                route.fallback()
                return
            keys_sent.append(route.request.headers.get("idempotency-key"))
            if len(keys_sent) == 1:
                route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": "storage_unavailable", "message": "storage"}))
            else:
                route.fallback()

        page.route(f"**/api/projects/{pid}/sessions", route_start)
        page.get_by_role("button", name="Start session").click()
        dialog = page.get_by_role("dialog", name="Start session")
        select(dialog.get_by_role("combobox", name="API key"), key_name)
        check(dialog.get_by_role("radio", name="Upload recording"))
        upload_files(page, audio, sidecar)
        dialog.get_by_role("textbox", name="Label").fill(label)
        dialog.get_by_role("button", name="Start").click()
        eventually(page, lambda: page.get_by_text(STORAGE_BANNER, exact=True).first.is_visible())
        dialog.get_by_role("button", name="Start").click()
        sid = eventually(page, lambda: (m := re.fullmatch(r"/console/sessions/([0-9a-f-]{36})", urlparse(page.url).path)) and m.group(1))
        assert len(keys_sent) == 2 and keys_sent[0] and keys_sent[0] == keys_sent[1]
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "live")
        page.reload()
        eventually(page, lambda: urlparse(page.url).path == f"/console/sessions/{sid}")
        eventually(page, lambda: text_of(page.get_by_role("status", name="Session status")) == SESSION_COPY["closed"], WAIT_S)
        expect(page.get_by_role("region", name="Transcript").get_by_role("button", name=re.compile(r"^Segment 3: c"))).to_have_count(1)
    assert [s["id"] for s in sessions_labelled(ines, pid, label)] == [sid]
    assert S3().get(f"orgs/{org}/projects/{pid}/sessions/{sid}/upload.wav") == audio


def test_wf_replay_and_search_tone(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    org = me(ines)["org"]["id"]
    pid = new_project(ines)["id"]
    key_name = f"Tone {tok()}"
    new_key(ines, pid, key_name)
    with console(browser, app_url, ines, f"/console/projects/{pid}/sessions") as page:
        page.get_by_role("button", name="Start session").click()
        dialog = page.get_by_role("dialog", name="Start session")
        select(dialog.get_by_role("combobox", name="API key"), key_name)
        check(dialog.get_by_role("radio", name="Test tone (1 kHz)"))
        dialog.get_by_role("button", name="Start").click()
        sid = eventually(page, lambda: (m := re.fullmatch(r"/console/sessions/([0-9a-f-]{36})", urlparse(page.url).path)) and m.group(1))
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "live")
        eventually(page, lambda: canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "closed", TONE_S + WAIT_S)
        eventually(page, lambda: canvas.get_attribute("data-peak-bin", timeout=SHORT_MS) == str(TONE_PEAK_BIN))
        eventually(page, lambda: text_of(page.get_by_role("status", name="Session status")) == SESSION_COPY["closed"])
    assert session_of(ines, sid)["close_reason"] == "end_of_audio"
    fixture = client(app_url).get("/fixtures/tone-1khz.wav").content
    assert S3().get(f"orgs/{org}/projects/{pid}/sessions/{sid}/upload.wav") == fixture


def test_wf_replay_and_search_invalid_upload(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    key_name = f"Bad {tok()}"
    new_key(ines, pid, key_name)
    label = f"Fix {tok()}"
    with console(browser, app_url, ines, f"/console/projects/{pid}/sessions", width=768, height=1024) as page:
        page.get_by_role("button", name="Start session").click()
        dialog = page.get_by_role("dialog", name="Start session")
        select(dialog.get_by_role("combobox", name="API key"), key_name)
        check(dialog.get_by_role("radio", name="Upload recording"))
        dialog.get_by_role("textbox", name="Label").fill(label)
        upload_files(page, wav(noise(0.5), rate=8000), None)
        dialog.get_by_role("button", name="Start").click()
        eventually(page, lambda: page.get_by_text(AUDIO_ERROR, exact=True).first.is_visible())
        assert sessions_labelled(ines, pid, label) == []
        upload_files(page, wav(noise(0.5)), None)
        dialog.get_by_role("button", name="Start").click()
        sid = eventually(page, lambda: (m := re.fullmatch(r"/console/sessions/([0-9a-f-]{36})", urlparse(page.url).path)) and m.group(1))
    assert [s["id"] for s in sessions_labelled(ines, pid, label)] == [sid]


def test_spectrum_readback(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    key_id, _ = new_key(ines, pid)
    sid = start(ines, pid, {"key_id": key_id, "source": "tone"}).json()["session"]["id"]
    with console(browser, app_url, ines, f"/console/sessions/{sid}") as page:
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "live")
        eventually(page, lambda: strip_matches(canvas, ines.get(f"/api/sessions/{sid}/spectrum").json()["rows"][-1]), what="live strip")
        wait_session(ines, sid, lambda s: s["state"] in ENDED, TONE_S + WAIT_S)
        spectrum = ines.get(f"/api/sessions/{sid}/spectrum").json()
        assert spectrum["frame"] == TONE_ROWS - 1 and spectrum["peak_bin"] == TONE_PEAK_BIN
        assert len(spectrum["rows"]) == HISTORY_ROWS and len(spectrum["mean"]) == BINS
        last = spectrum["rows"][-1]
        assert all(len(row) == BINS and all(0 <= v <= 1 and round(v, 3) == v for v in row) for row in spectrum["rows"])
        assert max(range(BINS), key=lambda i: (last[i], -i)) == TONE_PEAK_BIN
        eventually(page, lambda: canvas.get_attribute("data-frame", timeout=SHORT_MS) == str(spectrum["frame"]))
        assert canvas.get_attribute("data-session-state") == "closed" and canvas.get_attribute("data-end-state") == "closed"
        assert canvas.get_attribute("data-peak-bin") == str(TONE_PEAK_BIN)
        eventually(page, lambda: strip_matches(canvas, last), what="closed strip")
        shot = readback(canvas)
        assert abs(shot["width"] - shot["clientWidth"]) <= PX and abs(shot["height"] - shot["clientHeight"]) <= PX
        heights = bar_heights(shot)
        assert heights[TONE_PEAK_BIN] == max(heights)


def test_terrain_state_order(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines, quota=1)["id"]
    _, secret = new_key(ines, pid)
    live = Live(app_url, secret, channels=2)
    sid = live.session_id()
    feeder = Feeder(live)
    with console(browser, app_url, ines, f"/console/sessions/{sid}") as page:
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "live")
        assert canvas.evaluate(GL_KIND) in ("WebGLRenderingContext", "WebGL2RenderingContext")
        first = int(canvas.get_attribute("data-frame"))
        eventually(page, lambda: int(canvas.get_attribute("data-frame", timeout=SHORT_MS)) > first)
        f0, t0 = int(canvas.get_attribute("data-frame")), time.monotonic()
        eventually(page, lambda: time.monotonic() - t0 >= RATE_WINDOW_S or None, RATE_WINDOW_S + WAIT_S)
        f1, t1 = int(canvas.get_attribute("data-frame")), time.monotonic()
        rate = (f1 - f0) / (t1 - t0)
        assert ROW_RATE * (1 - RATE_SLACK) <= rate <= ROW_RATE * (1 + RATE_SLACK), rate
        frames = scene_frames(canvas, steps=3, step_ms=HERO_STEP_MS)
        assert any(f.get("draws") for f in frames), [f.get("draws") for f in frames]
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) > 0
        moving = []
        for _ in range(3):
            moving.append(terrain_hash(canvas))
            advance(page, HERO_STEP_MS)
        assert len(set(moving)) > 1, "terrain above the strip does not advance while live"
        shot = readback(canvas)
        live_colour = bar_colour(shot, bar_heights(shot))
        feeder.halt()
        live.send_audio(pcm(30, 2))
        assert live.wait_closed() == CLOSE_CODES["quota_halted"]
        eventually(page, lambda: canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "quota_halted" and canvas.get_attribute("data-end-state") == "quota_halted")
        advance(page, REDUCED_STEP_MS)
        frozen = canvas.get_attribute("data-frame")
        still = scene_frames(canvas, steps=3, step_ms=HERO_STEP_MS)
        assert difference(decode(still[0]["png"]), decode(still[-1]["png"])) == 0
        frozen_terrain = []
        for _ in range(3):
            frozen_terrain.append(terrain_hash(canvas))
            advance(page, HERO_STEP_MS)
        assert len(set(frozen_terrain)) == 1, "terrain keeps moving after the halt"
        assert canvas.get_attribute("data-frame") == frozen
        halted = readback(canvas)
        grey = bar_colour(halted, bar_heights(halted))
        assert grey != live_colour and max(grey) - min(grey) < max(live_colour) - min(live_colour)


def test_confidence_ribbon(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    sid, _ = recorded_session(app_url, secret, SEED_CUES, seconds=SEED_SECONDS)
    words = cue_words(SEED_CUES)
    with console(browser, app_url, ines, f"/console/sessions/{sid}") as page:
        tiles = page.get_by_role("list", name="Confidence ribbon").get_by_role("listitem")
        eventually(page, lambda: tiles.count() == len(words))
        for i, (word, conf) in enumerate(words):
            tile = tiles.nth(i)
            band = "high" if conf >= FLAG_BELOW else "medium" if conf >= MEDIUM_FROM else "low"
            assert tile.get_attribute("data-confidence") == f"{conf:.2f}" and tile.get_attribute("data-band") == band, word
            label = text_of(tile)
            assert label.startswith(word)
            assert label.endswith("low") == (band == "low"), label
            marks = tile_marks(tile)
            if band == "medium":
                assert marks["dashed"], (word, marks)
            elif band == "low":
                assert marks["hatched"], (word, marks)
            else:
                assert not marks["dashed"], (word, marks)


def test_reduced_motion_and_still(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    key_id, _ = new_key(ines, pid)
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        hero = page.get_by_role("img", name="Session field").first
        eventually(page, lambda: holding_still(hero), what="the hero to hold the demo's first frame")
        held_frames = scene_frames(hero, steps=3, step_ms=HERO_STEP_MS)
        assert difference(decode(held_frames[0]["png"]), decode(held_frames[-1]["png"])) == 0
    sid = start(ines, pid, {"key_id": key_id, "source": "tone"}).json()["session"]["id"]
    with console(browser, app_url, ines, f"/console/sessions/{sid}", reduced_motion="reduce") as page:
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: canvas.get_attribute("data-session-state", timeout=SHORT_MS) == "live" and canvas.get_attribute("data-frame"))
        advance(page, REDUCED_STEP_MS)
        before = settled_frame(canvas)
        eventually(None, lambda: ines.get(f"/api/sessions/{sid}/spectrum").json()["frame"] > before + 30, TONE_S)
        assert int(canvas.get_attribute("data-frame")) == before
        advance(page, REDUCED_STEP_MS)
        eventually(page, lambda: int(canvas.get_attribute("data-frame", timeout=SHORT_MS)) > before + 30, STEP_S * 10)
        stills = scene_frames(canvas, steps=2, step_ms=HERO_STEP_MS // 2)
        assert difference(decode(stills[0]["png"]), decode(stills[-1]["png"])) == 0
    fixture = client(app_url).get("/fixtures/tone-1khz.wav").content
    cues = [(0, 1000, "tone@0.90 check@0.55")]
    up = start(ines, pid, {"key_id": key_id, "source": "upload"}, fixture, vtt(cues).encode()).json()["session"]["id"]
    wait_session(ines, up, lambda s: s["state"] in ENDED, TONE_S + WAIT_S)
    spectrum = ines.get(f"/api/sessions/{up}/spectrum").json()
    with console(browser, app_url, ines, f"/console/sessions/{up}", no_webgl=True) as page:
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: canvas.get_attribute("data-frame", timeout=SHORT_MS) == str(spectrum["frame"]))
        assert canvas.get_attribute("data-session-state") == "closed" and canvas.get_attribute("data-end-state") == "closed"
        assert canvas.get_attribute("data-peak-bin") == str(TONE_PEAK_BIN)
        eventually(page, lambda: strip_matches(canvas, spectrum["mean"]))
        heights = bar_heights(readback(canvas))
        assert heights[TONE_PEAK_BIN] == max(heights)
        table = page.get_by_role("table", name="Segment confidence")
        for header in ("Word", "Start", "Confidence"):
            expect(table.get_by_role("columnheader", name=header)).to_have_count(1)
        expect(table.get_by_role("row").filter(has_text="check")).to_have_count(1)


WIDTHS = [(375, 812), (767, 1024), (768, 1024), (1199, 800), (1200, 800), (1280, 800)]


def workspace_layout(page: Page, width: int) -> None:
    ribbon = box(page.get_by_role("list", name="Confidence ribbon"))
    field = box(page.get_by_role("img", name="Session field"))
    stats = box(page.get_by_role("region", name="Session stats"))
    transcript_region = page.get_by_role("region", name="Transcript")
    transcript = box(transcript_region)
    assert abs(ribbon["y"] + ribbon["height"] - field["y"]) <= PX
    assert abs(field["height"] - field["width"] * 6 / 16) <= PX
    assert stats["y"] >= field["y"] + field["height"] - PX
    expect(transcript_region.get_by_role("status", name="Review status")).to_have_count(1)
    if width < BREAK_TWO:
        assert transcript["y"] >= stats["y"] + stats["height"] - PX
    else:
        assert transcript["x"] >= field["x"] + field["width"] - PX and transcript["y"] < field["y"] + field["height"]
    inspector = page.get_by_role("region", name="Segment inspector")
    if width >= BREAK_THREE:
        insp = box(inspector)
        assert insp["x"] >= transcript["x"] + transcript["width"] - PX
        expect(inspector).to_contain_text(EMPTY_PROMPT)
        expect(page.get_by_role("navigation", name="Console")).to_be_visible()
    else:
        assert inspector.count() == 0
        expect(page.get_by_role("button", name="Menu")).to_be_visible()
    layout(page)


def test_session_breakpoints(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    sid, _ = recorded_session(app_url, secret, SEED_CUES, seconds=SEED_SECONDS)
    for width, height in WIDTHS:
        with console(browser, app_url, ines, f"/console/sessions/{sid}", width=width, height=height) as page:
            eventually(page, lambda: page.get_by_role("list", name="Confidence ribbon").get_by_role("listitem").count() > 0)
            workspace_layout(page, width)


INTERACTIVE = ["button", "link", "textbox", "checkbox", "radio", "combobox", "searchbox", "tab"]


def assert_touch_size(scope: Locator | Page) -> None:
    for role in INTERACTIVE:
        for control in scope.get_by_role(role).all():
            if control.is_visible():
                b = box(control)
                assert b["width"] >= TOUCH_PX - PX and b["height"] >= TOUCH_PX - PX, (role, text_of(control)[:40], b)


def test_phone_touch_targets(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    reviewer = new_member(app_url, ines, "reviewer", [pid])
    sid, _ = recorded_session(app_url, secret, SEED_CUES, seconds=SEED_SECONDS)
    with console(browser, app_url, reviewer.client, f"/console/sessions/{sid}", width=375, height=812) as page:
        canvas = page.get_by_role("img", name="Session field")
        eventually(page, lambda: canvas.get_attribute("data-frame", timeout=SHORT_MS))
        b = box(canvas)
        assert b["y"] >= 0 and b["y"] + b["height"] <= 812 and b["x"] >= 0 and b["x"] + b["width"] <= 375
        assert_touch_size(page)
        layout(page)
        tap(page.get_by_role("button", name=re.compile(r"^Segment 2: ")))
        sheet = page.get_by_role("dialog", name="Segment inspector")
        eventually(page, lambda: sheet.is_visible())
        assert_touch_size(sheet)
        tap(sheet.get_by_role("button", name="Close inspector"))
        eventually(page, lambda: page.get_by_role("dialog", name="Segment inspector").count() == 0)


def test_inspector_keeps_draft(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    reviewer = new_member(app_url, ines, "reviewer", [pid])
    other = new_member(app_url, ines, "reviewer", [pid])
    approver = new_member(app_url, ines, "approver", [pid])
    live = Live(app_url, secret)
    sid = live.session_id()
    live.send_json({"type": "sidecar", "vtt": vtt([(i * 1000, (i + 1) * 1000, f"w{i}@0.50") for i in range(12)])})
    feeder = Feeder(live)
    with console(browser, app_url, reviewer.client, f"/console/sessions/{sid}") as page:
        seg2 = page.get_by_role("button", name=re.compile(r"^Segment 2: "))
        eventually(page, lambda: seg2.count() == 1)
        seg2.click()
        editor = page.get_by_role("textbox", name="Corrected text")
        eventually(page, lambda: editor.is_visible())
        editor.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("draft words here")
        for _ in range(3):
            page.keyboard.press("ArrowLeft")
        caret = len("draft words here") - 3

        def intact() -> bool:
            return editor.input_value() == "draft words here" and focused(editor) and editor.evaluate("e => e.selectionStart") == caret

        first_seg = eventually(None, lambda: next((s for s in transcript_of(other.client, sid)["segments"] if s["index"] == 0), None))
        cid = other.client.post(f"/api/sessions/{sid}/segments/{first_seg['id']}/corrections", json={"text": "fixed"}).json()["correction"]["id"]
        other.client.post(f"/api/corrections/{cid}/submit")
        assert approver.client.post(f"/api/corrections/{cid}/approve").status_code == 200
        tiles = page.get_by_role("list", name="Confidence ribbon").get_by_role("listitem")
        eventually(page, lambda: tiles.first.get_attribute("data-confidence", timeout=SHORT_MS) == "1.00")
        eventually(page, lambda: page.get_by_role("button", name=re.compile(r"^Segment 5: ")).count() == 1)
        assert intact()
        feeder.halt()
        assert ines.post(f"/api/sessions/{sid}/close").status_code == 200
        eventually(page, lambda: text_of(page.get_by_role("status", name="Session status")) == SESSION_COPY["closed"])
        advance(page, REDUCED_STEP_MS)
        assert intact()


def test_wf_session_workspace_desktop(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    reviewer = new_member(app_url, ines, "reviewer", [pid])
    sid, _ = recorded_session(app_url, secret, SEED_CUES, seconds=SEED_SECONDS)
    with console(browser, app_url, reviewer.client, f"/console/sessions/{sid}") as page:
        eventually(page, lambda: page.get_by_role("region", name="Segment inspector").is_visible())
        workspace_layout(page, 1280)
        page.get_by_role("button", name=re.compile(r"^Segment 2: ")).click()
        editor = page.get_by_role("region", name="Segment inspector").get_by_role("textbox", name="Corrected text")
        eventually(page, lambda: editor.input_value(timeout=SHORT_MS) == cue_text(1))
        drafted = f"{cue_text(1)} {tok()}"
        editor.fill(drafted)
        page.get_by_role("button", name="Save draft").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Review status")) == DRAFT_SAVED)
    drafts = reviewer.client.get(f"/api/projects/{pid}/corrections").json()["corrections"]
    assert [(c["state"], c["text"]) for c in drafts if c["session_id"] == sid] == [("draft", drafted)]


def test_wf_session_workspace_tablet(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    reviewer = new_member(app_url, ines, "reviewer", [pid])
    sid, _ = recorded_session(app_url, secret, SEED_CUES, seconds=SEED_SECONDS)
    with console(browser, app_url, reviewer.client, f"/console/sessions/{sid}", width=768, height=1024) as page:
        eventually(page, lambda: page.get_by_role("button", name=re.compile(r"^Segment 2: ")).count() == 1)
        workspace_layout(page, 768)
        names = tab_order(page, TAB_PRESSES)
        assert not {"Corrected text", "Submit for approval", "Save draft", "Search sessions"} & set(names), names
        expect(page.get_by_role("button", name="Submit for approval")).to_have_count(0)
        tap(page.get_by_role("button", name=re.compile(r"^Segment 2: ")))
        sheet = page.get_by_role("dialog", name="Segment inspector")
        eventually(page, lambda: sheet.is_visible())
        drafted = f"{cue_text(1)} {tok()}"
        sheet.get_by_role("textbox", name="Corrected text").fill(drafted)
        tap(sheet.get_by_role("button", name="Save draft"))
        eventually(page, lambda: page.get_by_text(DRAFT_SAVED, exact=True).first.is_visible())
        tap(sheet.get_by_role("button", name="Close inspector"))
        eventually(page, lambda: page.get_by_role("dialog", name="Segment inspector").count() == 0)
        assert "Corrected text" not in tab_order(page, TAB_PRESSES)
    drafts = reviewer.client.get(f"/api/projects/{pid}/corrections").json()["corrections"]
    assert [c["text"] for c in drafts if c["session_id"] == sid] == [drafted]


def exhaust(base: str, admin: httpx.Client) -> tuple[dict[str, Any], str, str, str]:
    project = new_project(admin, quota=1)
    key_id, secret = new_key(admin, project["id"])
    with Live(base, secret, channels=2) as live:
        sid = live.session_id()
        live.send_audio(pcm(30, 2))
        assert live.wait_closed() == CLOSE_CODES["quota_halted"]
    eventually(None, lambda: admin.get(f"/api/projects/{project['id']}").json()["project"]["quota"]["exhausted"])
    return project, key_id, secret, sid


def test_quota_one_figure_joint_halt(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines, quota=1)
    pid = project["id"]
    _, k1 = new_key(ines, pid)
    _, k2 = new_key(ines, pid)
    a, b = Live(app_url, k1, channels=2), Live(app_url, k2, channels=2)
    ids = [a.session_id(), b.session_id()]
    a.send_audio(pcm(10, 2))
    b.send_audio(pcm(10, 2))
    used = 40
    eventually(None, lambda: ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["used_seconds"] == used)
    keep = threading.Event()

    def keepalive() -> None:
        while not keep.wait(QUOTA_EVERY_S):
            for s in (a, b):
                with contextlib.suppress(OSError):
                    s.send_raw(b"\0" * 4)

    threading.Thread(target=keepalive, daemon=True).start()
    listed = next(p for p in projects(ines) if p["id"] == pid)
    assert listed["quota"]["used_seconds"] == used and "server_time" in listed["quota"]
    assert a.wait(lambda m: m.get("type") == "quota" and m["used_seconds"] == used)["limit_seconds"] == 60
    assert sse_until(ines, ids[0], lambda e, d: e == "quota" and d.get("used_seconds") == used, QUOTA_EVERY_S * 2 + 1)
    figure = meter(used, 1)
    with console(browser, app_url, ines, "/console/projects") as page:
        row = page.get_by_role("table", name="Projects").get_by_role("row").filter(has_text=project["name"])
        eventually(page, lambda: figure in text_of(row))
        page.goto(f"{app_url}/console/projects/{pid}/sessions")
        bar = page.get_by_role("progressbar", name="Quota used")
        eventually(page, lambda: progress_percent(bar) == 67 and page.get_by_text(figure).first.is_visible())
        page.goto(f"{app_url}/console/sessions/{ids[0]}")
        eventually(page, lambda: figure in text_of(page.get_by_role("region", name="Session stats")))
    keep.set()
    a.send_audio(pcm(5, 2))
    eventually(None, lambda: ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["used_seconds"] == used + 10)
    b.send_audio(pcm(5, 2))
    crossed = time.monotonic()
    for s in (a, b):
        assert s.wait_closed() == CLOSE_CODES["quota_halted"] and s.closed_at - crossed <= HALT_S + LATENCY_SLACK_S
    halted = [wait_session(ines, i, lambda s: s["billable_seconds"] is not None) for i in ids]
    assert [s["state"] for s in halted] == ["quota_halted", "quota_halted"]
    quota = ines.get(f"/api/projects/{pid}").json()["project"]["quota"]
    assert quota["used_seconds"] == sum(billed(s["plan"], s["audio_ms"], 2) for s in halted) and quota["exhausted"] is True


def test_quota_refusal(app_url: str) -> None:
    ines = signin(app_url, INES)
    project, key_id, secret, halted = exhaust(app_url, ines)
    pid = project["id"]
    before = len(ines.get(f"/api/projects/{pid}/sessions").json()["sessions"])
    refused = Live(app_url, secret)
    assert refused.status == 429 and refused.body["error"] == "quota_exhausted"
    for fields, audio in (({"key_id": key_id, "source": "tone"}, None), ({"key_id": key_id, "source": "upload"}, wav(noise(0.5)))):
        r = start(ines, pid, fields, audio)
        assert r.status_code == 429 and r.json()["error"] == "quota_exhausted"
    assert len(ines.get(f"/api/projects/{pid}/sessions").json()["sessions"]) == before
    used = ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["used_seconds"]
    raised = ines.patch(f"/api/projects/{pid}/quota", json={"monthly_quota_minutes": used // 60 + 1})
    assert raised.status_code == 200 and raised.json()["quota"]["exhausted"] is False
    ok = start(ines, pid, {"key_id": key_id, "source": "tone"})
    assert ok.status_code == 201
    assert ines.post(f"/api/sessions/{ok.json()['session']['id']}/close").status_code == 200
    assert session_of(ines, halted)["state"] == "quota_halted"


def test_quota_halt_banner(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project, _, _, sid = exhaust(app_url, ines)
    banner = halt_banner(ines.get(f"/api/projects/{project['id']}").json()["project"]["quota"])
    with console(browser, app_url, ines, f"/console/projects/{project['id']}/keys", clock=DEVICE_CLOCK) as page:
        for tab in ("keys", "sessions", "review", "synthesis", "settings"):
            page.goto(f"{app_url}/console/projects/{project['id']}/{tab}")
            eventually(page, lambda: text_of(page.get_by_role("status", name="Quota status")) == banner, what=tab)
        page.goto(f"{app_url}/console/sessions/{sid}")
        eventually(page, lambda: page.get_by_text(banner, exact=True).first.is_visible())


def test_wf_quota_halt_refused_start(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project, _, _, _ = exhaust(app_url, ines)
    pid = project["id"]
    key_name = f"Extra {tok()}"
    new_key(ines, pid, key_name)
    banner = halt_banner(ines.get(f"/api/projects/{pid}").json()["project"]["quota"])
    before = len(ines.get(f"/api/projects/{pid}/sessions").json()["sessions"])
    with console(browser, app_url, ines, f"/console/projects/{pid}/sessions") as page:
        page.get_by_role("button", name="Start session").click()
        dialog = page.get_by_role("dialog", name="Start session")
        select(dialog.get_by_role("combobox", name="API key"), key_name)
        check(dialog.get_by_role("radio", name="Test tone (1 kHz)"))
        with page.expect_response(lambda r: r.url.endswith(f"/api/projects/{pid}/sessions") and r.request.method == "POST") as reply:
            dialog.get_by_role("button", name="Start").click()
        assert reply.value.status == 429
        eventually(page, lambda: page.get_by_text(banner, exact=True).first.is_visible())
        assert urlparse(page.url).path == f"/console/projects/{pid}/sessions"
    assert len(ines.get(f"/api/projects/{pid}/sessions").json()["sessions"]) == before


def test_wf_quota_halt_raise(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project, _, _, _ = exhaust(app_url, ines)
    pid = project["id"]
    key_name = f"Raise {tok()}"
    new_key(ines, pid, key_name)
    used = ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["used_seconds"]
    with console(browser, app_url, ines, f"/console/projects/{pid}/settings") as page:
        page.get_by_role("textbox", name="Monthly quota (minutes)").fill(str(used // 60 + 1))
        page.get_by_role("button", name="Save quota").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Settings status")) == QUOTA_SAVED)
        eventually(page, lambda: text_of(page.get_by_role("status", name="Quota status")) == "")
        page.get_by_role("tab", name="Sessions").click()
        page.get_by_role("button", name="Start session").click()
        dialog = page.get_by_role("dialog", name="Start session")
        select(dialog.get_by_role("combobox", name="API key"), key_name)
        check(dialog.get_by_role("radio", name="Test tone (1 kHz)"))
        dialog.get_by_role("button", name="Start").click()
        sid = eventually(page, lambda: (m := re.fullmatch(r"/console/sessions/([0-9a-f-]{36})", urlparse(page.url).path)) and m.group(1))
    assert ines.get(f"/api/projects/{pid}").json()["project"]["quota"]["limit_minutes"] == used // 60 + 1
    assert ines.post(f"/api/sessions/{sid}/close").status_code == 200


def test_flagged_segments_playback(app_url: str) -> None:
    ines = signin(app_url, INES)
    ward = project_named(ines, WARD)["id"]
    seed = next(s for s in ines.get(f"/api/projects/{ward}/sessions").json()["sessions"] if s["label"] == SEED_DICTATION)
    assert [s["flagged"] for s in transcript_of(ines, seed["id"])["segments"]] == [False, True, True, True]
    jo = signin(app_url, JO)
    seed_segs = transcript_of(ines, seed["id"])["segments"]
    for path in (f"/api/sessions/{seed['id']}/audio", f"/api/sessions/{seed['id']}/segments/{seed_segs[1]['id']}/audio", f"/api/sessions/{seed['id']}/transcript"):
        denied = jo.get(path)
        assert denied.status_code == 404 and denied.json()["error"] == "not_found", path
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    cues = [(0, 1000, "a@0.85 b@0.99"), (1000, 2000, "c@0.84 d@0.99"), (2000, 3000, "e@1.00")]
    sid, samples = recorded_session(app_url, secret, cues, seconds=3)
    segments = transcript_of(ines, sid)["segments"]
    assert [s["flagged"] for s in segments] == [False, True, False]
    for seg in segments:
        r = ines.get(f"/api/sessions/{sid}/segments/{seg['id']}/audio")
        assert r.status_code == 200 and r.headers["content-type"].startswith("audio/wav")
        channels, rate, bits, payload = wav_format(r.content)
        assert (channels, rate, bits) == (1, SAMPLE_RATE, 16)
        assert payload == samples[seg["start_ms"] * BYTES_PER_MS : seg["end_ms"] * BYTES_PER_MS]


def test_keyboard_review_inert(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    reviewer = new_member(app_url, ines, "reviewer", [pid])
    cues = [(0, 1000, "alpha@0.95 beta@0.95"), (1000, 2000, "gamma@0.60 delta@0.95"), (2000, 3000, "eps@0.95"), (3000, 4000, "zeta@0.40"), (4000, 5000, "eta@0.70 theta@0.90")]
    sid, _ = recorded_session(app_url, secret, cues, seconds=5)
    segs = transcript_of(reviewer.client, sid)["segments"]
    second_text = " ".join(w for w, _ in cue_words(cues[1:2]))
    fourth_text = " ".join(w for w, _ in cue_words(cues[3:4]))
    corrected = f"{second_text} {tok()}"
    fourth_draft = f"{fourth_text} {tok()}"
    with console(browser, app_url, reviewer.client, f"/console/sessions/{sid}") as page:
        def seg(n: int) -> Locator:
            return page.get_by_role("button", name=re.compile(rf"^Segment {n}: "))
        eventually(page, lambda: seg(5).count() == 1)
        assert seg(2).get_attribute("data-flagged") == "true" and seg(1).get_attribute("data-flagged") != "true"
        expect(seg(2)).to_contain_text("Flagged")
        tab_until(page, re.compile(r"^Segment 1: "))
        for key, n in (("j", 2), ("j", 4), ("j", 5), ("j", 5), ("k", 4), ("k", 2)):
            page.keyboard.press(key)
            eventually(page, lambda: focused(seg(n)), what=f"{key} to {n}")
        page.keyboard.press("e")
        editor = page.get_by_role("textbox", name="Corrected text")
        eventually(page, lambda: focused(editor))
        assert editor.input_value() == second_text
        tab_until(page, "Play segment audio")
        with page.expect_response(lambda r: f"/segments/{segs[1]['id']}/audio" in r.url) as playback:
            page.keyboard.press("p")
        assert playback.value.status == 200
        page.keyboard.press("e")
        eventually(page, lambda: focused(editor))
        page.keyboard.press("Control+a")
        page.keyboard.type(corrected)
        page.keyboard.press("Control+Enter")
        eventually(page, lambda: text_of(page.get_by_role("status", name="Review status")) == SUBMITTED)
        eventually(page, lambda: focused(seg(4)))
        eventually(page, lambda: editor.input_value(timeout=SHORT_MS) == fourth_text)
    mine = [c for c in reviewer.client.get(f"/api/projects/{pid}/corrections").json()["corrections"] if c["segment_id"] == segs[1]["id"]]
    assert [(c["state"], c["text"]) for c in mine] == [("submitted", corrected)]
    with console(browser, app_url, reviewer.client, f"/console/sessions/{sid}", width=768, height=1024) as page:
        def seg(n: int) -> Locator:
            return page.get_by_role("button", name=re.compile(rf"^Segment {n}: "))
        eventually(page, lambda: seg(5).count() == 1)
        expect(page.get_by_role("searchbox", name="Search sessions")).to_have_count(0)
        names = tab_order(page, TAB_PRESSES)
        assert not {"Search sessions", "Corrected text", "Submit for approval"} & set(names), names
        menu = page.get_by_role("button", name="Menu")
        menu.focus()
        page.keyboard.press("Enter")
        nav = page.get_by_role("dialog", name="Navigation")
        eventually(page, lambda: nav.is_visible())
        for key in ["Tab"] * 12 + ["Shift+Tab"] * 4:
            page.keyboard.press(key)
            assert contains_focus(nav), key
        page.keyboard.press("Escape")
        eventually(page, lambda: page.get_by_role("dialog", name="Navigation").count() == 0 and focused(menu))
        tab_until(page, re.compile(r"^Segment 4: "))
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name="Segment inspector")
        editor = sheet.get_by_role("textbox", name="Corrected text")
        eventually(page, lambda: sheet.is_visible() and focused(editor))
        page.keyboard.press("Control+a")
        page.keyboard.type(fourth_draft)
        for key in ["Tab"] * 10 + ["Shift+Tab"] * 4:
            page.keyboard.press(key)
            assert contains_focus(sheet), key
        editor.focus()
        page.keyboard.press("Escape")
        eventually(page, lambda: page.get_by_role("dialog", name="Segment inspector").count() == 0 and focused(seg(4)))
        page.keyboard.press("e")
        eventually(page, lambda: sheet.is_visible() and editor.input_value(timeout=SHORT_MS) == fourth_draft)
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(seg(4)))
        page.keyboard.press("e")
        advance(page, REDUCED_STEP_MS)
        assert sheet.is_visible()
        page.keyboard.press("Escape")
        eventually(page, lambda: page.get_by_role("dialog", name="Segment inspector").count() == 0)
        expect(page.get_by_role("button", name="Submit for approval")).to_have_count(0)
        assert "Corrected text" not in tab_order(page, TAB_PRESSES)


def corrections_on(base: str) -> tuple[httpx.Client, str, list[dict[str, Any]], str]:
    ines = signin(base, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    sid, _ = recorded_session(base, secret, SEED_CUES, seconds=SEED_SECONDS)
    return ines, pid, transcript_of(ines, sid)["segments"], sid


def test_correction_drafting_rules(app_url: str) -> None:
    ines, pid, segs, sid = corrections_on(app_url)
    r1 = new_member(app_url, ines, "reviewer", [pid])
    r2 = new_member(app_url, ines, "reviewer", [pid])
    ap = new_member(app_url, ines, "approver", [pid])
    path = f"/api/sessions/{sid}/segments/{segs[0]['id']}/corrections"
    first = r1.client.post(path, json={"text": "draft one"})
    assert first.status_code == 201 and first.json()["correction"]["state"] == "draft"
    c = first.json()["correction"]
    assert c["author"]["id"] == r1.user["id"]
    taken = r2.client.post(path, json={"text": "mine"})
    assert taken.status_code == 409 and taken.json()["error"] == "correction_open"
    for method, suffix, body in (("PATCH", "", {"text": "x"}), ("POST", "/submit", None), ("POST", "/reopen", None)):
        r = r2.client.request(method, f"/api/corrections/{c['id']}{suffix}", **({"json": body} if body else {}))
        assert r.status_code == 403 and r.json()["error"] == "not_author", suffix
    for bad in ("", "\u3000 ", "x" * (CORRECTION_MAX + 1)):
        r = r1.client.patch(f"/api/corrections/{c['id']}", json={"text": bad})
        assert r.status_code == 422 and r.json()["fields"]["text"] == CORRECTION_ERROR
    assert r1.client.patch(f"/api/corrections/{c['id']}", json={"text": "\U0001fa7a" * CORRECTION_MAX}).status_code == 200
    trimmed = r1.client.patch(f"/api/corrections/{c['id']}", json={"text": f"  {cue_text(0)}  "})
    assert trimmed.json()["correction"]["text"] == cue_text(0)
    assert r1.client.post(f"/api/corrections/{c['id']}/submit").json()["correction"]["state"] == "submitted"
    for method, suffix in (("PATCH", ""), ("POST", "/submit"), ("POST", "/reopen")):
        r = r1.client.request(method, f"/api/corrections/{c['id']}{suffix}", **({"json": {"text": "y"}} if method == "PATCH" else {}))
        assert r.status_code == 409 and r.json()["error"] == "invalid_transition", suffix
    assert ap.client.post(f"/api/corrections/{c['id']}/return", json={"note": "check"}).status_code == 200
    assert r1.client.post(f"/api/corrections/{c['id']}/reopen").json()["correction"]["state"] == "draft"
    assert r1.client.patch(f"/api/corrections/{c['id']}", json={"text": "again"}).status_code == 200
    gate = threading.Barrier(6)
    contenders = [r1, r2] * 3

    def create(member: Member) -> int:
        gate.wait()
        return member.client.post(f"/api/sessions/{sid}/segments/{segs[1]['id']}/corrections", json={"text": "race"}).status_code

    with ThreadPoolExecutor(6) as pool:
        statuses = sorted(pool.map(create, contenders))
    assert statuses == [201] + [409] * 5, statuses


def test_wf_correction_review_reviewer_pass(browser: Browser, app_url: str) -> None:
    ines, pid, segs, sid = corrections_on(app_url)
    reviewer = new_member(app_url, ines, "reviewer", [pid])
    typed = f"{cue_text(1)} {tok()}"
    with console(browser, app_url, reviewer.client, f"/console/sessions/{sid}") as page:
        eventually(page, lambda: page.get_by_role("button", name=re.compile(r"^Segment 4: ")).count() == 1)
        tab_until(page, re.compile(r"^Segment 1: "))
        page.keyboard.press("j")
        eventually(page, lambda: focused(page.get_by_role("button", name=re.compile(r"^Segment 2: "))))
        page.keyboard.press("e")
        editor = page.get_by_role("textbox", name="Corrected text")
        eventually(page, lambda: focused(editor))
        page.keyboard.press("Control+a")
        page.keyboard.type(typed)
        page.keyboard.press("Control+Enter")
        eventually(page, lambda: text_of(page.get_by_role("status", name="Review status")) == SUBMITTED)
        eventually(page, lambda: focused(page.get_by_role("button", name=re.compile(r"^Segment 3: "))))
        page.goto(f"{app_url}/console/projects/{pid}/review")
        table = page.get_by_role("table", name="Awaiting approval")
        link = table.get_by_role("link", name="Open correction")
        eventually(page, lambda: link.count() >= 1)
        assert any(f"segment={segs[1]['id']}" in (l.get_attribute("href") or "") for l in link.all())
    corrections = reviewer.client.get(f"/api/projects/{pid}/corrections", params={"state": "submitted"}).json()["corrections"]
    assert [(c["segment_id"], c["text"]) for c in corrections] == [(segs[1]["id"], typed)]
    assert transcript_of(reviewer.client, sid)["segments"][1]["machine"]["text"] == cue_text(1)


def test_wf_correction_review_conflict(browser: Browser, app_url: str) -> None:
    ines, pid, segs, sid = corrections_on(app_url)
    first = new_member(app_url, ines, "reviewer", [pid])
    second = new_member(app_url, ines, "reviewer", [pid])
    theirs = f"{cue_text(1)} {tok()}"
    mine = f"{cue_text(1)} {tok()}"
    assert first.client.post(f"/api/sessions/{sid}/segments/{segs[1]['id']}/corrections", json={"text": theirs}).status_code == 201
    with console(browser, app_url, second.client, f"/console/sessions/{sid}?segment={segs[1]['id']}") as page:
        editor = page.get_by_role("textbox", name="Corrected text")
        eventually(page, lambda: editor.is_visible())
        editor.fill(mine)
        page.get_by_role("button", name="Submit for approval").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Review status")) == OPEN_CONFLICT)
        assert editor.input_value() == mine
    open_ones = [c for c in ines.get(f"/api/projects/{pid}/corrections").json()["corrections"] if c["segment_id"] == segs[1]["id"]]
    assert [c["text"] for c in open_ones] == [theirs]


def test_correction_approval_rules(app_url: str) -> None:
    ines, pid, segs, sid = corrections_on(app_url)
    rev = new_member(app_url, ines, "reviewer", [pid])
    a1, a2, a3 = (new_member(app_url, ines, "approver", [pid]) for _ in range(3))

    def make(member: Member, index: int, text: str, submit: bool = True) -> str:
        cid = member.client.post(f"/api/sessions/{sid}/segments/{segs[index]['id']}/corrections", json={"text": text}).json()["correction"]["id"]
        if submit:
            assert member.client.post(f"/api/corrections/{cid}/submit").status_code == 200
        return cid

    draft = make(rev, 0, f"{cue_text(0)} {tok()}", submit=False)
    early = a1.client.post(f"/api/corrections/{draft}/approve")
    assert early.status_code == 409 and early.json()["error"] == "invalid_transition"
    rev.client.post(f"/api/corrections/{draft}/submit")
    own = make(a3, 1, cue_text(1))
    for suffix, body in (("approve", None), ("return", {"note": "x"})):
        r = a3.client.post(f"/api/corrections/{own}/{suffix}", **({"json": body} if body else {}))
        assert r.status_code == 403 and r.json()["error"] == "own_correction"

    def race(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
        gate = threading.Barrier(len(calls))
        with ThreadPoolExecutor(len(calls)) as pool:
            return list(pool.map(lambda f: (gate.wait(), f())[1], calls))

    pair = race([lambda: a1.client.post(f"/api/corrections/{draft}/approve"), lambda: a2.client.post(f"/api/corrections/{draft}/approve")])
    assert sorted(r.status_code for r in pair) == [200, 409]
    win = next(r for r in pair if r.status_code == 200).json()
    assert next(r for r in pair if r.status_code == 409).json()["error"] == "invalid_transition"
    assert win["correction"]["state"] == "approved" and win["correction"]["decided_by"] in (a1.user["id"], a2.user["id"])
    assert win["segment"]["reviewed"]["source"] == "correction" and isinstance(win["wer"], (int, float))
    mixed = race([lambda: a1.client.post(f"/api/corrections/{own}/approve"), lambda: a2.client.post(f"/api/corrections/{own}/return", json={"note": "listen again"})])
    assert sorted(r.status_code for r in mixed) == [200, 409]
    final = next(c for c in ines.get(f"/api/projects/{pid}/corrections").json()["corrections"] if c["id"] == own)["state"]
    assert final == ("approved" if mixed[0].status_code == 200 else "returned")
    third = make(rev, 2, cue_text(2))
    for bad in ("", "n" * (CORRECTION_MAX + 1)):
        r = a1.client.post(f"/api/corrections/{third}/return", json={"note": bad})
        assert r.status_code == 422 and r.json()["fields"]["note"] == NOTE_ERROR
    returned = a1.client.post(f"/api/corrections/{third}/return", json={"note": "\U0001fa7a" * CORRECTION_MAX})
    assert returned.status_code == 200 and returned.json()["correction"]["state"] == "returned"
    assert a2.client.post(f"/api/corrections/{third}/approve").status_code == 409
    assert rev.client.post(f"/api/corrections/{third}/reopen").json()["correction"]["state"] == "draft"
    assert a1.client.post(f"/api/corrections/{third}/return", json={"note": "x"}).status_code == 409
    assert rev.client.post(f"/api/sessions/{sid}/segments/{segs[0]['id']}/corrections", json={"text": "again"}).status_code == 201


def test_reviewed_transcript_wer(app_url: str) -> None:
    ines, pid, segs, sid = corrections_on(app_url)
    rev = new_member(app_url, ines, "reviewer", [pid])
    ap = new_member(app_url, ines, "approver", [pid])
    machine_before = ines.get(f"/api/sessions/{sid}/transcript/machine.json").content
    assert transcript_of(ines, sid)["wer"] == 0

    def approve(index: int, text: str) -> dict[str, Any]:
        cid = rev.client.post(f"/api/sessions/{sid}/segments/{segs[index]['id']}/corrections", json={"text": text}).json()["correction"]["id"]
        rev.client.post(f"/api/corrections/{cid}/submit")
        r = ap.client.post(f"/api/corrections/{cid}/approve")
        assert r.status_code == 200
        return r.json()

    first = approve(2, "fifty milligrams twice daily")
    assert first["wer"] == round(2 / 14, 4)
    words = first["segment"]["reviewed"]["words"]
    assert [w["start_ms"] for w in words] == [6000, 6750, 7500, 8250] and all(w["confidence"] == 1 for w in words)
    pending = rev.client.post(f"/api/sessions/{sid}/segments/{segs[3]['id']}/corrections", json={"text": "different words entirely"}).json()["correction"]["id"]
    rev.client.post(f"/api/corrections/{pending}/submit")
    punctuated = "{}, {} {}!".format(*cue_text(2).capitalize().split(" "))
    second = approve(2, punctuated)
    assert second["wer"] == 0
    transcript = transcript_of(ines, sid)
    by_index = {s["index"]: s for s in transcript["segments"]}
    assert by_index[2]["reviewed"]["text"] == punctuated and by_index[2]["reviewed"]["source"] == "correction"
    assert [w["start_ms"] for w in by_index[2]["reviewed"]["words"]] == [6000, 7000, 8000]
    assert by_index[3]["reviewed"]["source"] == "machine" and by_index[3]["reviewed"]["text"] == cue_text(3)
    assert [s["machine"]["text"] for s in transcript["segments"]] == [cue_text(i) for i in range(len(SEED_CUES))]
    assert transcript["wer"] == 0 and session_of(ines, sid)["wer"] == 0
    assert ines.get(f"/api/sessions/{sid}/transcript/machine.json").content == machine_before
    _, secret = new_key(ines, pid)
    silent, _ = recorded_session(app_url, secret, None, seconds=0.5)
    assert transcript_of(ines, silent)["wer"] is None


def test_server_driven_retint(browser: Browser, app_url: str) -> None:
    ines, pid, segs, sid = corrections_on(app_url)
    rev = new_member(app_url, ines, "reviewer", [pid])
    a1, a2, a3 = (new_member(app_url, ines, "approver", [pid]) for _ in range(3))
    fixed = f"{cue_text(1)} {tok()}"
    cid = rev.client.post(f"/api/sessions/{sid}/segments/{segs[1]['id']}/corrections", json={"text": fixed}).json()["correction"]["id"]
    rev.client.post(f"/api/corrections/{cid}/submit")
    own = a3.client.post(f"/api/sessions/{sid}/segments/{segs[2]['id']}/corrections", json={"text": "fifty milligrams daily"}).json()["correction"]["id"]
    a3.client.post(f"/api/corrections/{own}/submit")
    confidences = "els => els.map(e => e.getAttribute('data-confidence'))"
    original = [f"{c:.2f}" for _, c in cue_words(SEED_CUES)]
    after = original[:3] + ["1.00"] * 4 + original[6:]

    def view_state(page: Page, n: int) -> tuple[list[str], str, str]:
        tiles = page.get_by_role("list", name="Confidence ribbon").get_by_role("listitem").evaluate_all(confidences)
        name = name_of(page.get_by_role("button", name=re.compile(rf"^Segment {n}: ")))
        return tiles, name, text_of(page.get_by_role("region", name="Session stats"))

    with console(browser, app_url, a3.client, f"/console/sessions/{sid}?segment={segs[2]['id']}") as page:
        eventually(page, lambda: page.get_by_role("button", name="Approve correction").is_visible())
        before = view_state(page, 3)
        page.get_by_role("button", name="Approve correction").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Review status")) == OWN_CORRECTION)
        advance(page, (EVENT_S + 1) * 1000)
        assert view_state(page, 3) == before and "0.00%" in before[2]
        assert contains_focus(page.get_by_role("region", name="Segment inspector"))
        expect(page.get_by_role("button", name="Approve correction")).to_be_enabled()
    with console(browser, app_url, a1.client, f"/console/sessions/{sid}?segment={segs[1]['id']}") as p1, console(browser, app_url, a2.client, f"/console/sessions/{sid}?segment={segs[1]['id']}") as p2:
        for p in (p1, p2):
            eventually(p, lambda: p.get_by_role("button", name="Approve correction").is_visible())
        start_view = view_state(p1, 2)
        assert start_view[0] == original
        with held(p1, "**/approve") as hold:
            button = p1.get_by_role("button", name="Approve correction")
            button.click()
            eventually(p1, lambda: text_of(button) == "Approving" and button.is_disabled())
            assert view_state(p1, 2) == start_view
            p2.get_by_role("button", name="Approve correction").click()
            eventually(p2, lambda: text_of(p2.get_by_role("status", name="Review status")) == APPROVED)
            hold.release()
        eventually(p1, lambda: text_of(p1.get_by_role("status", name="Review status")) == ALREADY_DECIDED)
        for p in (p1, p2):
            eventually(p, lambda: (lambda v: v[0] == after and v[1].startswith(f"Segment 2: {fixed}") and percent(round(1 / 14, 4)) in v[2])(view_state(p, 2)), EVENT_S + WAIT_S)
        assert text_of(p1.get_by_role("status", name="Review status")) == ALREADY_DECIDED
    assert transcript_of(ines, sid)["wer"] == round(1 / 14, 4)


def test_wf_correction_approval_queue(browser: Browser, app_url: str) -> None:
    ines, pid, segs, sid = corrections_on(app_url)
    rev = new_member(app_url, ines, "reviewer", [pid])
    ap = new_member(app_url, ines, "approver", [pid])
    fixed = f"{cue_text(3)} {tok()}"
    cid = rev.client.post(f"/api/sessions/{sid}/segments/{segs[3]['id']}/corrections", json={"text": fixed}).json()["correction"]["id"]
    rev.client.post(f"/api/corrections/{cid}/submit")
    with console(browser, app_url, ap.client, f"/console/projects/{pid}/review") as page:
        link = page.get_by_role("table", name="Awaiting approval").get_by_role("link", name="Open correction")
        eventually(page, lambda: link.count() == 1)
        link.click()
        eventually(page, lambda: urlparse(page.url).path == f"/console/sessions/{sid}" and f"segment={segs[3]['id']}" in page.url)
        page.get_by_role("button", name="Approve correction").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Review status")) == APPROVED)
        eventually(page, lambda: page.get_by_role("button", name=re.compile(rf"^Segment 4: {re.escape(fixed)}")).count() == 1)
        eventually(page, lambda: percent(round(1 / 14, 4)) in text_of(page.get_by_role("region", name="Session stats")))
    approved = next(c for c in ines.get(f"/api/projects/{pid}/corrections").json()["corrections"] if c["id"] == cid)
    assert approved["state"] == "approved" and approved["decided_by"] == ap.user["id"]
    assert transcript_of(ines, sid)["segments"][3]["reviewed"]["text"] == fixed


def test_wf_correction_approval_return(browser: Browser, app_url: str) -> None:
    ines, pid, segs, sid = corrections_on(app_url)
    rev = new_member(app_url, ines, "reviewer", [pid])
    ap = new_member(app_url, ines, "approver", [pid])
    cid = rev.client.post(f"/api/sessions/{sid}/segments/{segs[1]['id']}/corrections", json={"text": cue_text(1)}).json()["correction"]["id"]
    rev.client.post(f"/api/corrections/{cid}/submit")
    with console(browser, app_url, ap.client, f"/console/sessions/{sid}?segment={segs[1]['id']}") as page:
        note = page.get_by_role("textbox", name="Return note")
        eventually(page, lambda: note.is_visible())
        page.get_by_role("button", name="Return correction").click()
        eventually(page, lambda: page.get_by_text(NOTE_ERROR, exact=True).first.is_visible())
        note.fill("Listen to the dose again")
        page.get_by_role("button", name="Return correction").click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Review status")) == f"Correction returned to {rev.name}.")
    returned = next(c for c in ines.get(f"/api/projects/{pid}/corrections").json()["corrections"] if c["id"] == cid)
    assert (returned["state"], returned["note"]) == ("returned", "Listen to the dose again")


AUDIO_CASES = [(500, 1), (15000, 1), (60000, 1), (60001, 1), (14000, 2), (16001, 2), (0, 1)]


def test_billable_seconds(app_url: str) -> None:
    for email in (INES, NADIA):
        admin = signin(app_url, email)
        pid = new_project(admin)["id"]
        _, secret = new_key(admin, pid)
        for audio_ms, channels in AUDIO_CASES:
            sid, _ = recorded_session(app_url, secret, None, seconds=0, channels=channels, samples=pcm_ms(audio_ms, channels))
            s = wait_session(admin, sid, lambda x: x["billable_seconds"] is not None)
            assert s["audio_ms"] == audio_ms and s["channels"] == channels
            assert s["billable_seconds"] == billed(s["plan"], audio_ms, channels), (email, audio_ms, channels, s)
            assert (s["billing_state"] == "not_billable") == (audio_ms == 0)
            assert session_of(admin, sid)["billable_seconds"] == s["billable_seconds"]
        assert s["plan"] == me(admin)["org"]["plan"]


def kb_usage(killbill: Any, external_key: str, quota: dict[str, Any]) -> int:
    account = killbill.account_by_key(external_key)
    assert account is not None, external_key
    headers = {"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"], "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"]}
    params = {"startDate": quota["period_start"][:10], "endDate": quota["resets_at"][:10]}
    total = 0
    for sub in killbill.subscriptions(account["accountId"]):
        r = httpx.get(
            os.environ["KILLBILL_URL"].rstrip("/") + KB_USAGE_PATH.format(sub["subscriptionId"]),
            params=params, headers=headers, auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]), timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200, r.text[:200]
        total += sum(int(u["amount"]) for u in r.json().get("rolledUpUnits", []) if u.get("unitType") == "billable-second")
    return total


def billing_snapshot(c: httpx.Client, killbill: Any, external_key: str, quota: dict[str, Any]) -> tuple[int, int]:

    def read() -> tuple[int, int] | None:
        before = c.get("/api/usage").json()["projects"]
        if any(p["pending_sessions"] for p in before):
            return None
        units = kb_usage(killbill, external_key, quota)
        after = c.get("/api/usage").json()["projects"]
        seconds = sum(p["billable_seconds"] for p in before)
        if seconds != sum(p["billable_seconds"] for p in after) or any(p["pending_sessions"] for p in after):
            return None
        return seconds, units

    return eventually(None, read, RETRY_S + RECOVER_S + WAIT_S, "quiescent billing snapshot")


def test_usage_recorded_in_billing(app_url: str, killbill: Any) -> None:
    ines = signin(app_url, INES)
    org = me(ines)["org"]
    external = f"{BILLING_PREFIX}-{org['slug']}"
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    quota = ines.get(f"/api/projects/{pid}").json()["project"]["quota"]
    live = Live(app_url, secret, channels=2)
    sid = live.session_id()
    live.send_audio(pcm(61, 2))
    live.wait_state("live")
    app0, kb0 = billing_snapshot(ines, killbill, external, quota)
    live.finish()
    assert live.wait_closed() == CLOSE_CODES["closed"]
    s = wait_session(ines, sid, lambda x: x["billable_seconds"] is not None)
    assert s["billing_state"] in ("pending", "confirmed") and s["billable_seconds"] == billed(s["plan"], s["audio_ms"], 2) > 0
    wait_session(ines, sid, lambda x: x["billing_state"] == "confirmed", RETRY_S + RECOVER_S + WAIT_S)
    app1, kb1 = eventually(
        None,
        lambda: (lambda snap: snap if snap[1] - kb0 == snap[0] - app0 else None)(billing_snapshot(ines, killbill, external, quota)),
        RECOVER_S + WAIT_S,
        "Kill Bill usage matching the closed sessions exactly once",
    )
    assert app1 - app0 >= s["billable_seconds"] and kb1 - kb0 == app1 - app0
    account = killbill.account_by_key(external)
    assert account is not None and account.get("currency") == "USD" and account.get("name") == org["name"]
    assert CATALOG_PLAN[org["plan"]] in catalog_plans(killbill, f"{BILLING_PREFIX}-{org['slug']}")
    zero, _ = recorded_session(app_url, secret, None, seconds=0, samples=b"")
    assert wait_session(ines, zero, lambda x: x["billable_seconds"] is not None)["billing_state"] == "not_billable"
    usage = next(p for p in ines.get("/api/usage").json()["projects"] if p["project_id"] == pid)
    assert usage["sessions"] == 1 and usage["billing_state"] == "confirmed" and usage["pending_sessions"] == 0


def test_integer_cent_cost(app_url: str) -> None:
    nadia = signin(app_url, NADIA)
    pid = new_project(nadia)["id"]
    _, secret = new_key(nadia, pid)
    plans = []
    for _ in range(3):
        sid, _ = recorded_session(app_url, secret, None, seconds=21)
        plans.append(wait_session(nadia, sid, lambda s: s["billable_seconds"] is not None))
    open_live = Live(app_url, secret)
    open_live.send_audio(pcm(2))
    open_live.wait_state("live")
    usage = nadia.get("/api/usage").json()
    entry = next(p for p in usage["projects"] if p["project_id"] == pid)
    seconds = {}
    for s in plans:
        seconds[s["plan"]] = seconds.get(s["plan"], 0) + s["billable_seconds"]
    assert entry["sessions"] == 3 and entry["billable_seconds"] == sum(seconds.values())
    assert entry["cost_cents"] == sum(cost(plan, sec) for plan, sec in seconds.items())
    if seconds.get("scale") == 63:
        assert entry["cost_cents"] == 4
    assert {(b["plan"], b["billable_seconds"], b["cost_cents"]) for b in entry["by_plan"] if b["billable_seconds"]} == {(p, s, cost(p, s)) for p, s in seconds.items()}
    assert all(isinstance(p["cost_cents"], int) for p in usage["projects"]) and isinstance(usage["org_total_cents"], int)
    assert usage["org_total_cents"] == sum(p["cost_cents"] for p in usage["projects"])
    assert re.fullmatch(r"\d{4}-\d{2}", usage["month"])
    open_live.finish()
    open_live.wait_closed()


def test_usage_org_only(app_url: str) -> None:
    ines, nadia = signin(app_url, INES), signin(app_url, NADIA)
    harbour = new_project(ines)["id"]
    corvane = new_project(nadia)["id"]
    for viewer, own, foreign in ((signin(app_url, KIM), harbour, corvane), (nadia, corvane, harbour)):
        usage = viewer.get("/api/usage").json()
        ids = {p["project_id"] for p in usage["projects"]}
        assert own in ids and foreign not in ids
        assert ids == {p["id"] for p in projects(viewer)}
        assert usage["org_total_cents"] == sum(p["cost_cents"] for p in usage["projects"])


def test_wf_usage_billing_review(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines)
    _, secret = new_key(ines, project["id"])
    sid, _ = recorded_session(app_url, secret, None, seconds=30, channels=2)
    s = wait_session(ines, sid, lambda x: x["billing_state"] == "confirmed", RETRY_S + RECOVER_S + WAIT_S)
    kim = signin(app_url, KIM)
    with console(browser, app_url, kim, "/console/usage") as page:
        row = page.get_by_role("table", name="Usage by project").get_by_role("row").filter(has_text=project["name"])
        eventually(page, lambda: "Confirmed" in text_of(row))
        cells = text_of(row)
        assert minutes(s["billable_seconds"]) in cells and money(cost(s["plan"], s["billable_seconds"])) in cells
        total = kim.get("/api/usage").json()["org_total_cents"]
        eventually(page, lambda: money(total) in text_of(page.get_by_role("region", name="Organisation total")))


def test_wf_usage_billing_open_excluded(browser: Browser, app_url: str) -> None:
    ines = signin(app_url, INES)
    project = new_project(ines)
    _, secret = new_key(ines, project["id"])
    live = Live(app_url, secret)
    sid = live.session_id()
    live.send_audio(pcm(1))
    live.wait_state("live")
    with console(browser, app_url, signin(app_url, KIM), "/console/usage") as page:
        row = page.get_by_role("table", name="Usage by project").get_by_role("row").filter(has_text=project["name"])
        eventually(page, lambda: row.count() == 1)
        assert next(p for p in ines.get("/api/usage").json()["projects"] if p["project_id"] == project["id"])["sessions"] == 0
        live.finish()
        live.wait_closed()
        wait_session(ines, sid, lambda x: x["billing_state"] == "confirmed", RETRY_S + RECOVER_S + WAIT_S)
        page.reload()
        eventually(page, lambda: "Confirmed" in text_of(row) and money(cost("pilot" if session_of(ines, sid)["plan"] == "pilot" else "scale", session_of(ines, sid)["billable_seconds"])) in text_of(row))


def test_plan_change_rules(killbill: Any) -> None:
    base = short_url()
    nadia = signin(base, NADIA)
    current = plan_settled(nadia)["plan"]
    target = other_plan(current)
    key = idempotency_key()
    bad = nadia.post("/api/org/plan-changes", json={"plan": "gold"}, headers={"Idempotency-Key": key})
    assert bad.status_code == 422 and bad.json()["fields"]["plan"] == PLAN_ERROR
    long_key = nadia.post("/api/org/plan-changes", json={"plan": target}, headers={"Idempotency-Key": "k" * (IDEMPOTENCY_MAX + 1)})
    assert long_key.status_code == 422 and long_key.json()["fields"]["idempotency_key"] == IDEMPOTENCY_ERROR
    same = nadia.post("/api/org/plan-changes", json={"plan": current}, headers={"Idempotency-Key": idempotency_key()})
    assert same.status_code == 409 and same.json()["error"] == "plan_unchanged"
    first = nadia.post("/api/org/plan-changes", json={"plan": target}, headers={"Idempotency-Key": key})
    assert first.status_code == 202 and first.json()["change"]["state"] == "requested" and first.json()["change"]["target"] == target
    change_id = first.json()["change"]["id"]
    decided = plan_settled(nadia)
    assert decided["plan"] == target and decided["change"]["id"] == change_id and decided["change"]["state"] == "confirmed"
    assert CATALOG_PLAN[target] in catalog_plans(killbill, f"{SHORT_PREFIX}-corvane")
    replay = nadia.post("/api/org/plan-changes", json={"plan": target}, headers={"Idempotency-Key": key})
    assert replay.status_code == 202 and replay.content == first.content
    conflict = nadia.post("/api/org/plan-changes", json={"plan": current}, headers={"Idempotency-Key": key})
    assert conflict.status_code == 409 and conflict.json()["error"] == "idempotency_conflict"
    admin2 = new_member(base, nadia, "admin", [])
    theirs = admin2.client.post("/api/org/plan-changes", json={"plan": target}, headers={"Idempotency-Key": key})
    assert theirs.status_code == 409 and theirs.json()["error"] == "plan_unchanged"
    gate = threading.Barrier(2)

    def request() -> httpx.Response:
        c = signin(base, NADIA)
        gate.wait()
        return c.post("/api/org/plan-changes", json={"plan": current}, headers={"Idempotency-Key": idempotency_key()})

    with ThreadPoolExecutor(2) as pool:
        pair = list(pool.map(lambda _: request(), range(2)))
    assert sorted(r.status_code for r in pair) == [202, 409]
    assert next(r for r in pair if r.status_code == 409).json()["error"] == "change_pending"
    assert plan_settled(nadia)["plan"] == current
    assert CATALOG_PLAN[current] in catalog_plans(killbill, f"{SHORT_PREFIX}-corvane")


def test_plan_in_force_at_start(killbill: Any) -> None:
    base = short_url()
    nadia = signin(base, NADIA)
    before = plan_settled(nadia)["plan"]
    target = other_plan(before)
    pid = new_project(nadia)["id"]
    _, secret = new_key(nadia, pid)
    live = Live(base, secret)
    sid = live.session_id()
    live.wait_state("live")
    feeder = Feeder(live)
    assert nadia.post("/api/org/plan-changes", json={"plan": target}, headers={"Idempotency-Key": idempotency_key()}).status_code == 202
    assert plan_settled(nadia)["plan"] == target
    feeder.halt()
    live.finish()
    live.wait_closed()
    old = wait_session(nadia, sid, lambda s: s["billable_seconds"] is not None)
    assert old["plan"] == before and old["billable_seconds"] == billed(before, old["audio_ms"], 1)
    new_sid, _ = recorded_session(base, secret, None, seconds=2)
    new = wait_session(nadia, new_sid, lambda s: s["billable_seconds"] is not None)
    assert new["plan"] == target and new["billable_seconds"] == billed(target, 2000, 1)
    entry = next(p for p in nadia.get("/api/usage").json()["projects"] if p["project_id"] == pid)
    by_plan = {b["plan"]: b for b in entry["by_plan"]}
    assert by_plan[before]["billable_seconds"] == old["billable_seconds"] and by_plan[target]["billable_seconds"] == new["billable_seconds"]
    assert by_plan[before]["cost_cents"] == cost(before, old["billable_seconds"])
    assert CATALOG_PLAN[target] in catalog_plans(killbill, f"{SHORT_PREFIX}-corvane")


def test_wf_plan_change_upgrade(browser: Browser, killbill: Any) -> None:
    base = short_url()
    nadia = signin(base, NADIA)
    if plan_settled(nadia)["plan"] == "scale":
        assert nadia.post("/api/org/plan-changes", json={"plan": "pilot"}, headers={"Idempotency-Key": idempotency_key()}).status_code == 202
        assert plan_settled(nadia)["plan"] == "pilot"
    with console(browser, base, nadia, "/console/org/plan") as page:
        current = page.get_by_role("region", name="Current plan")
        status = page.get_by_role("status", name="Plan status")
        eventually(page, lambda: "Pilot" in text_of(current) and "Active" in text_of(current))
        status.evaluate("el => { window.__plan = []; new MutationObserver(() => window.__plan.push(el.textContent.trim())).observe(el, {subtree: true, childList: true, characterData: true}); }")
        button = page.get_by_role("button", name="Switch to Scale")
        with held(page, "**/api/org/plan-changes") as hold:
            button.click()
            eventually(page, lambda: button.is_disabled())
            assert "Pilot" in text_of(current)
            hold.release()
        eventually(page, lambda: text_of(status) == PLAN_ACTIVE.replace("<plan>", "Scale"), DECISION_S + WAIT_S)
        assert PLAN_WAITING.replace("<plan>", "Scale") in page.evaluate("window.__plan")
        eventually(page, lambda: "Scale" in text_of(current) and "Active" in text_of(current))
    assert nadia.get("/api/org/plan").json()["plan"] == "scale"
    assert CATALOG_PLAN["scale"] in catalog_plans(killbill, f"{SHORT_PREFIX}-corvane")


def test_wf_plan_change_retry(browser: Browser, killbill: Any) -> None:
    base = short_url()
    nadia = signin(base, NADIA)
    target = other_plan(plan_settled(nadia)["plan"])
    with console(browser, base, nadia, "/console/org/plan") as page:
        keys: list[str | None] = []

        def flaky(route: Any) -> None:
            keys.append(route.request.headers.get("idempotency-key"))
            if len(keys) == 1:
                route.abort()
            else:
                route.fallback()

        page.route("**/api/org/plan-changes", flaky)
        button = page.get_by_role("button", name=f"Switch to {PLAN_LABEL[target]}")
        button.click()
        eventually(page, lambda: keys and button.is_enabled())
        button.click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Plan status")) == PLAN_ACTIVE.replace("<plan>", PLAN_LABEL[target]), DECISION_S + WAIT_S)
    assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
    plan = nadia.get("/api/org/plan").json()
    assert plan["plan"] == target and plan["change"]["state"] == "confirmed"
    assert CATALOG_PLAN[target] in catalog_plans(killbill, f"{SHORT_PREFIX}-corvane")


def test_billing_outage(browser: Browser) -> None:
    base = kbdown_url()
    assert client(base).get("/api/health").status_code == 200
    ines = signin(base, INES)
    eventually(None, lambda: ines.get("/api/org/plan").json()["billing_reachable"] is False, PROBE_S + WAIT_S)
    before = ines.get("/api/org/plan").json()
    key = idempotency_key()
    for _ in range(2):
        r = ines.post("/api/org/plan-changes", json={"plan": other_plan(before["plan"])}, headers={"Idempotency-Key": key})
        assert r.status_code == 503 and r.json()["error"] == "billing_unavailable"
    after = ines.get("/api/org/plan").json()
    assert after["plan"] == before["plan"] and after["change"] == before["change"]
    project = new_project(ines)
    _, secret = new_key(ines, project["id"])
    sid, _ = recorded_session(base, secret, None, seconds=1)
    assert wait_session(ines, sid, lambda s: s["billable_seconds"] is not None)["billing_state"] == "pending"
    usage = ines.get("/api/usage").json()
    entry = next(p for p in usage["projects"] if p["project_id"] == project["id"])
    assert usage["billing_reachable"] is False and entry["billing_state"] == "pending" and entry["pending_sessions"] == 1
    with console(browser, base, ines, "/console/usage") as page:
        eventually(page, lambda: text_of(page.get_by_role("status", name="Service status")) == BILLING_BANNER)
        row = page.get_by_role("table", name="Usage by project").get_by_role("row").filter(has_text=project["name"])
        eventually(page, lambda: "Pending" in text_of(row))
        page.goto(base + "/console/org/plan")
        eventually(page, lambda: text_of(page.get_by_role("status", name="Service status")) == BILLING_BANNER)
        page.get_by_role("button", name=re.compile(r"^Switch to ")).click()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Plan status")) == PLAN_UNREACHABLE)
    assert session_of(ines, sid)["billing_state"] == "pending"


def test_storage_outage(browser: Browser) -> None:
    base = s3down_url()
    ines = signin(base, INES)
    ward = project_named(ines, WARD)["id"]
    seed = next(s for s in ines.get(f"/api/projects/{ward}/sessions").json()["sessions"] if s["label"] == SEED_DICTATION)
    segs = transcript_of(ines, seed["id"])["segments"]
    pid = new_project(ines)["id"]
    key_id, secret = new_key(ines, pid)
    label = f"Down {tok()}"
    for fields, audio in (({"key_id": key_id, "source": "tone", "label": label}, None), ({"key_id": key_id, "source": "upload", "label": label}, wav(noise(0.5)))):
        r = start(ines, pid, fields, audio, key=idempotency_key())
        assert r.status_code == 503 and r.json()["error"] == "storage_unavailable"
    refused = Live(base, secret, label=label)
    assert refused.status == 503 and refused.body["error"] == "storage_unavailable"
    synth = ines.post(f"/api/projects/{pid}/synthesis", json={"key_id": key_id, "text": "down", "voice": "lumen"})
    assert synth.status_code == 503 and synth.json()["error"] == "storage_unavailable"
    speak = httpx.post(base + "/v1/speak", json={"text": "down", "voice": "lumen"}, headers={"Authorization": f"Token {secret}"})
    assert speak.status_code == 503
    for path in (f"/api/sessions/{seed['id']}/audio", f"/api/sessions/{seed['id']}/segments/{segs[1]['id']}/audio", f"/api/sessions/{seed['id']}/transcript/machine.json"):
        r = ines.get(path)
        assert r.status_code == 503 and r.json()["error"] == "storage_unavailable", path
    assert sessions_labelled(ines, pid, label) == [] and db_rows_with(Postgres("_s3down"), label) == {}
    rhea = signin(base, RHEA)
    with console(browser, base, rhea, f"/console/sessions/{seed['id']}?segment={segs[1]['id']}") as page:
        editor = page.get_by_role("textbox", name="Corrected text")
        eventually(page, lambda: editor.is_visible())
        typed = f"{cue_text(1)} {tok()}"
        editor.fill(typed)
        page.get_by_role("button", name="Play segment audio").click()
        service = page.get_by_role("status", name="Service status")
        eventually(page, lambda: text_of(service) == STORAGE_BANNER)
        advance(page, RETRY_S * 1000)
        assert text_of(service) == STORAGE_BANNER and editor.input_value() == typed
        page.get_by_role("navigation", name="Console").get_by_role("link", name="Projects").click()
        eventually(page, lambda: urlparse(page.url).path == "/console/projects")
        assert text_of(page.get_by_role("status", name="Service status")) == STORAGE_BANNER


def test_recovery_without_restart(killbill: Any) -> None:
    kb = kbdown_url()
    ines = signin(kb, INES)
    pid = new_project(ines)["id"]
    _, secret = new_key(ines, pid)
    sid, _ = recorded_session(kb, secret, None, seconds=1)
    assert wait_session(ines, sid, lambda s: s["billable_seconds"] is not None)["billing_state"] == "pending"
    with relay(os.environ["KILLBILL_URL"]):
        wait_session(ines, sid, lambda s: s["billing_state"] == "confirmed", RECOVER_S + RETRY_S + WAIT_S)
        eventually(None, lambda: ines.get("/api/usage").json()["billing_reachable"] is True, RECOVER_S + PROBE_S)
        target = other_plan(plan_settled(ines)["plan"])
        assert ines.post("/api/org/plan-changes", json={"plan": target}, headers={"Idempotency-Key": idempotency_key()}).status_code == 202
        assert plan_settled(ines)["plan"] == target
        assert CATALOG_PLAN[target] in catalog_plans(killbill, f"{KBDOWN_PREFIX}-harbourline")
    s3 = s3down_url()
    admin = signin(s3, INES)
    org = me(admin)["org"]["id"]
    project = new_project(admin)["id"]
    key_id, _ = new_key(admin, project)
    key = idempotency_key()
    assert start(admin, project, {"key_id": key_id, "source": "tone"}, key=key).status_code == 503
    with relay(os.environ["S3_ENDPOINT"]):
        started = eventually(None, lambda: (lambda r: r if r.status_code == 201 else None)(start(admin, project, {"key_id": key_id, "source": "tone"}, key=key)), RECOVER_S + WAIT_S)
        tid = started.json()["session"]["id"]
        fixture = client(s3).get("/fixtures/tone-1khz.wav").content
        assert S3().get(f"orgs/{org}/projects/{project}/sessions/{tid}/upload.wav") == fixture
        assert admin.get(f"/api/sessions/{tid}/audio").content == fixture
        assert admin.post(f"/api/sessions/{tid}/close").status_code == 200


def test_wf_outage_recovery_billing(browser: Browser, killbill: Any) -> None:
    base = kbdown_url()
    ines = signin(base, INES)
    project = new_project(ines)
    _, secret = new_key(ines, project["id"])
    sid, _ = recorded_session(base, secret, None, seconds=1)
    kim = signin(base, KIM)
    eventually(None, lambda: kim.get("/api/usage").json()["billing_reachable"] is False, PROBE_S + WAIT_S)
    with console(browser, base, kim, "/console/usage") as page:
        row = page.get_by_role("table", name="Usage by project").get_by_role("row").filter(has_text=project["name"])
        eventually(page, lambda: text_of(page.get_by_role("status", name="Service status")) == BILLING_BANNER and "Pending" in text_of(row))
        with relay(os.environ["KILLBILL_URL"]):
            wait_session(ines, sid, lambda s: s["billing_state"] == "confirmed", RECOVER_S + RETRY_S + WAIT_S)
            eventually(None, lambda: kim.get("/api/usage").json()["billing_reachable"] is True, RECOVER_S + PROBE_S)
            page.reload()
            eventually(page, lambda: text_of(page.get_by_role("status", name="Service status")) == "" and "Confirmed" in text_of(row))
            assert killbill.account_by_key(f"{KBDOWN_PREFIX}-harbourline") is not None


def test_wf_outage_recovery_storage(browser: Browser) -> None:
    base = s3down_url()
    ines = signin(base, INES)
    org = me(ines)["org"]["id"]
    ward = project_named(ines, WARD)["id"]
    seed = next(s for s in ines.get(f"/api/projects/{ward}/sessions").json()["sessions"] if s["label"] == SEED_DICTATION)
    seg = transcript_of(ines, seed["id"])["segments"][1]["id"]
    with console(browser, base, signin(base, RHEA), f"/console/sessions/{seed['id']}?segment={seg}") as page:
        play = page.get_by_role("button", name="Play segment audio")
        service = page.get_by_role("status", name="Service status")
        eventually(page, lambda: play.is_visible())
        play.click()
        eventually(page, lambda: text_of(service) == STORAGE_BANNER)
        with relay(os.environ["S3_ENDPOINT"]):
            def played() -> bool:
                with page.expect_response(lambda r: f"/segments/{seg}/audio" in r.url) as reply:
                    play.click()
                return reply.value.status == 200
            eventually(page, played, RECOVER_S + WAIT_S)
            eventually(page, lambda: text_of(service) == "")
            eventually(None, lambda: f"orgs/{org}/projects/{ward}/sessions/{seed['id']}/upload.wav" in S3().keys(f"orgs/{org}/projects/{ward}/sessions/{seed['id']}/"), RECOVER_S + WAIT_S)


def test_run_manifest_health(app_url: str) -> None:
    assert urlparse(app_url).port == int(os.environ.get("APP_PUBLIC_PORT") or DEFAULT_PORT)
    for base in (app_url, kbdown_url(), s3down_url(), short_url()):
        r = client(base).get("/api/health")
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/json") and r.json() == {"status": "ok"}


def test_server_boundary(app_url: str) -> None:
    c = client(app_url)
    pg = Postgres()
    parts = urlparse(app_url)
    origin = f"{parts.scheme}://{parts.netloc}"

    def trial() -> dict[str, str]:
        name, email = identity("edge")
        return {"name": name, "email": email, "company": "Edge Co", "team": "contact_centre"}

    foreign = trial()
    r = c.post("/api/trial-requests", json=foreign, headers={"Origin": "http://elsewhere.example"})
    assert r.status_code == 403 and r.json()["error"] == "cross_origin"
    assert not any(h.lower().startswith("access-control-") for h in r.headers)
    assert db_rows_with(pg, foreign["email"]) == {}
    assert c.post("/api/trial-requests", json=trial(), headers={"Origin": origin}).status_code == 201
    assert c.post("/api/trial-requests", json=trial()).status_code == 201
    plain = c.post("/api/trial-requests", content=json.dumps(trial()), headers={"Content-Type": "text/plain"})
    assert plain.status_code == 415
    body = trial()
    body["pad"] = ""
    body["pad"] = "a" * (JSON_LIMIT - len(json.dumps(body).encode()))
    exact = json.dumps(body).encode()
    assert len(exact) == JSON_LIMIT
    assert c.post("/api/trial-requests", content=exact, headers={"Content-Type": "application/json"}).status_code != 413
    over = c.post("/api/trial-requests", content=exact[:-2] + b'a"}', headers={"Content-Type": "application/json"})
    assert over.status_code == 413
    for path in ("/package.json", "/run.json", "/.env", "/tsconfig.json", "/package-lock.json"):
        assert c.get(path).status_code == 404, path
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY")]
    secrets.append(urlparse(os.environ.get("DATABASE_URL", "")).password or "")
    secrets = [s for s in secrets if len(s) >= 6 and not s.isalpha()]
    pages = [c.get(p).text for p in ("/", "/sign-in", "/console/projects")]
    assets = {a for html in pages for a in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|mjs|css))"', html)}
    assert assets
    for asset in assets:
        served = c.get(asset)
        assert served.status_code == 200, asset
        for secret in secrets:
            assert secret not in served.text, asset
        assert c.get(asset + ".map").status_code == 404
    for html in pages:
        for secret in secrets:
            assert secret not in html
    signed = client(app_url).post("/api/auth/sign-in", json={"email": INES, "password": PASSWORD})
    cookie = signed.headers.get("set-cookie", "").lower()
    assert "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
SERVICE_ENV = ("DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID",
               "S3_SECRET_ACCESS_KEY", "KILLBILL_URL", "KILLBILL_USERNAME", "KILLBILL_PASSWORD", "KILLBILL_API_KEY",
               "KILLBILL_API_SECRET")
SERVICE_SECRET_ENV = ("DATABASE_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "KILLBILL_URL",
                      "KILLBILL_USERNAME", "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET")
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".sh", ".html", ".css"}
BUILT_DIRS = {"node_modules", "dist", "build", "coverage", ".git", ".venv"}


def app_sources() -> list[Path]:
    return [p for p in APP_DIR.rglob("*") if p.is_file() and not BUILT_DIRS & set(p.relative_to(APP_DIR).parts)
            and (p.suffix in SOURCE_SUFFIXES or p.name.startswith(".env"))]


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    assert packages, APP_DIR
    missing = [p.name for p in packages if p.name not in notices]
    assert not missing, missing


def test_if_licences() -> None:
    packages = shipped_packages()
    assert packages, APP_DIR
    bad = [(p.name, p.licence) for p in packages if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad


def test_if_no_extra_datastore() -> None:
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "lowdb", "nedb", "lokijs", "pouchdb", "mongodb"}
    packages = shipped_packages()
    assert packages, APP_DIR
    assert not forbidden & {p.name for p in packages}
    skip = {"node_modules", ".git"}
    files = [p for p in APP_DIR.rglob("*") if not skip & set(p.parts) and p.suffix in (".sqlite", ".sqlite3", ".db") or p.name == "dump.rdb"]
    assert not files, files
    for cmdline in Path("/proc").glob("[0-9]*/cmdline"):
        with contextlib.suppress(OSError):
            command = cmdline.read_bytes().replace(b"\0", b" ").decode(errors="ignore")
            assert not re.search(r"\b(redis-server|mongod|sqlite3)\b", command), command


def test_if_service_config_untouched() -> None:
    provided = {name: os.environ[name] for name in SERVICE_ENV if os.environ.get(name)}
    assert set(provided) == set(SERVICE_ENV), sorted(set(SERVICE_ENV) - set(provided))
    sources = app_sources()
    assert sources, APP_DIR
    values = {name: provided[name] for name in SERVICE_SECRET_ENV}
    values["DATABASE_PASSWORD"] = urlparse(provided["DATABASE_URL"]).password or ""
    values = {name: value for name, value in values.items() if len(value) >= 6 and not value.isalpha()}
    read: set[str] = set()
    pasted: list[tuple[str, str]] = []
    for path in sources:
        body = path.read_text(errors="replace")
        read |= {name for name in SERVICE_ENV if name in body}
        pasted += [(str(path.relative_to(APP_DIR)), name) for name, value in values.items() if value in body]
    assert not pasted, pasted
    assert read == set(SERVICE_ENV), sorted(set(SERVICE_ENV) - read)
    if not TRAJECTORY.exists():
        return
    trajectory = json.loads(TRAJECTORY.read_text())
    edits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            tool = next((str(node[k]) for k in ("name", "function_name", "tool", "tool_name") if isinstance(node.get(k), str)), "")
            if re.search(r"write|edit|patch|str_replace", tool, re.I):
                args = node.get("input") or node.get("arguments") or node.get("args") or {}
                if isinstance(args, str):
                    with contextlib.suppress(ValueError):
                        args = json.loads(args)
                if isinstance(args, dict):
                    edits.extend(str(args[k]) for k in ("file_path", "path", "filename") if args.get(k))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(trajectory)
    provided = re.compile(r"(^|/)(\.env($|\.)|docker-compose\.|compose\.)", re.I)
    outside = [p for p in edits if p.startswith("/") and not p.startswith(("/app", "/tmp")) and not p.startswith(str(Path.home())) and provided.search(p)]
    assert not outside, outside


def test_if_no_third_party_hosts(browser: Browser, app_url: str) -> None:
    host = urlparse(app_url).netloc
    with console(browser, app_url, signin(app_url, INES), "/console/projects") as page:
        urls: list[str] = []
        page.on("request", lambda req: urls.append(req.url))
        page.goto(app_url + "/")
        advance(page, REDUCED_STEP_MS)
        page.goto(app_url + "/console/projects")
        eventually(page, lambda: page.get_by_role("table", name="Projects").is_visible())
        foreign = [u for u in urls if urlparse(u).scheme in ("http", "https", "ws", "wss") and urlparse(u).netloc != host]
        assert not foreign, foreign


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", ".git", "coverage", ".next", "out"}
    authored = [p for p in APP_DIR.rglob("*") if p.is_file() and not skip & set(p.relative_to(APP_DIR).parts)]
    tooling = {"scripts", "tools", "bin"}
    sources = [p for p in authored if not tooling & set(p.relative_to(APP_DIR).parts[:-1])]
    scripts = [p for p in sources if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and ".config." not in p.name and not p.name.startswith(".")]
    assert not scripts, scripts
    assert any(p.suffix in (".ts", ".tsx") for p in authored)
