import concurrent.futures as cf
import csv
import email.utils
import io
import json
import math
import os
import re
import struct
import subprocess
import threading
import time
import uuid
import zlib
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest

from conftest import (DEPLOYED_APP, S3, addresses, advance, capture, center, check, click, decode, difference, fill,
                      held, layout, mail_from_address, open_app, same_origin, state_styles, tab_order, text)

JUNO = ("juno@lanternfold.test", "fold-the-lantern-26")
ODILE = ("odile@lanternfold.test", "brack-the-room-27")
JUNO_NAME, ODILE_NAME = "Juno Marlowe", "Odile Brack"
JUNO_ZONE = "Europe/Lisbon"
ODILE_ZONE = "America/Toronto"
TITLE_BASE = "Ação às 9h – Zoë"
SEED_NAMES = ["Priya N.", "Tomás R.", "Ade K."]
SEED_NOTES = ["Weekly demo kept the clinic leads close", "Release notes are finally readable",
              "Intake forms change hands three times", "Nobody owns the Friday triage",
              "Night shift hears about changes last", "Two scheduling tools disagree",
              "Search in the records app times out", "Too many status meetings",
              "Pilot a single triage owner for April"]
PRIVATE_NOTE = "Sponsor bristles at any mention of the scheduling vendor"
CLUSTER_A, CLUSTER_B = "Handoffs", "Tooling"
CLUSTER_C = "Onboarding friction"
RECAP_FORMULAS = ["=SUM(A1:A3)", "+44 call me", "-dash first", "@channel ping"]
RECAP_PLAIN, RECAP_OPP = SEED_NOTES[7], SEED_NOTES[8]
RENAMED_FRAME, KEPT_FRAME = "Where we're going", "What's in the way"
OFFLINE = "you're offline"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")
STATUS_LABELS = {"draft": "Draft", "open": "Open", "silent_round": "Silent round", "revealed": "Revealed",
                 "voting": "Voting", "closed": "Closed", "archived": "Archived"}
TEMPLATE_LABELS = {"retrospective": "Retrospective", "discovery": "Discovery sprint",
                   "strategy": "Strategy offsite", "blank": "Blank"}
PRICES = {"Studio": {"Monthly": "24.00", "Annual": "230.40"},
          "Agency": {"Monthly": "59.00", "Annual": "566.40"}}
START = "2027-03-27T09:00"
END = "2027-03-27T12:00"
END_EXPIRY = "2027-03-28T12:00:00.000Z"
OVERLAP_END = "2027-10-31T01:30"
OVERLAP_EXPIRY = "2027-11-01T00:30:00.000Z"
GRACE_SECONDS = 86400
FEE = "1250.10"
FEE_SHOWN = "€" + f"{Decimal(FEE):,.2f}"
ROUND_SECONDS = 300
VOTE_SECONDS = 120
SHORT_SECONDS = 5
DOTS = 3
MAX_BATCH = 30
IMAGE_LIMIT = 5_000_000
IMAGE_SIDE = 8000
JSON_LIMIT = 65536
PURGE_SECONDS = 6
LIVE_SECONDS = 2
PRESENCE_SECONDS = 1
ENDED_SECONDS = 2
HEALTH_SECONDS = 10
MIN_TARGET_PX = 44
FRAME_W, FRAME_H, FRAME_STEP = 800, 600, 900
FLIP_MS = 420
RANK_GAP_MS = 24
LAST_RANK_MS = 480
WAVE_MS = 900
CROSSFADE_MS = 150
ENTRANCE_NOTE_MS = 240
ENTRANCE_LAST_START_MS = 560
ENTRANCE_TOTAL_MS = 800
SPRING_SETTLE_MS = 600
TICKER_MS = 400
METER_MS = 600
CURSOR_GLIDE_MS = 100
MESH_CYCLE_MS = 24000
PRICE_ROLL_MS = 400
HOVER_MS = 100
INK_PROP = re.compile(r"(^|-)color$|Color$|^fill$|^stroke$")
DEMO_START, DEMO_END = 0.9, 0.3
SIGNIN_LIMIT, SIGNIN_WINDOW = 5, 900
JOIN_LIMIT, JOIN_WINDOW = 30, 60
WRITE_LIMIT, WRITE_WINDOW = 120, 10
UPLOAD_LIMIT, UPLOAD_WINDOW = 10, 60
PRESENCE_LIMIT, PRESENCE_WINDOW = 40, 2
ROOM_VIEW = {"width": 1280, "height": 800}

HTTP_TIMEOUT = 30
POLL = 0.2
EVENT_WAIT = 20
MAIL_WAIT = 120
RECAP_WAIT = 240
REASON_SECONDS = 60
EXPIRY_WAIT = 180
RANK_SLACK_MS = 5
SNAP_PX = 2
MAX_PAGES = 50
OUTAGE_TRIES = 3

ENTITLEMENTS = {
    "free": {"activeWorkshops": 3, "participantsPerWorkshop": 8, "silentRoundsPerWorkshop": 1,
             "invitesPerDay": 20, "recapScale": 1},
    "studio": {"activeWorkshops": 20, "participantsPerWorkshop": 30, "silentRoundsPerWorkshop": None,
               "invitesPerDay": 200, "recapScale": 2},
    "agency": {"activeWorkshops": None, "participantsPerWorkshop": 50, "silentRoundsPerWorkshop": None,
               "invitesPerDay": 1000, "recapScale": 2},
}
TEMPLATES = {"retrospective": ["Went well", "To improve", "Actions"],
             "discovery": ["Problems", "Opportunities", "Questions"],
             "strategy": ["Where we are", "Where we're going", "What's in the way"],
             "blank": ["Ideas"]}
PLAN_LABELS = {"free": "Free", "studio": "Studio", "agency": "Agency"}
TERM_LABELS = {"monthly": "Monthly", "annual": "Annual"}
RANK = {"free": 0, "studio": 1, "agency": 2}
ORDER = ["draft", "open", "silent_round", "revealed", "voting", "closed", "archived"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

BOARD_P_KEYS = {"serverTime", "workshop", "viewer", "frames", "clusters", "notes", "connectors"}
P_WORKSHOP_KEYS = {"id", "title", "status", "round", "voting", "version"}
FAC_WORKSHOP_KEYS = {"id", "title", "template", "status", "scheduledStart", "scheduledEnd", "timeZone", "sponsorEmail",
                     "fee", "invites", "joinUrl", "joinLinkExpiresAt", "participantCount", "participantCap",
                     "roundsUsed", "round", "voting", "version", "recap"}
FRAME_KEYS = {"id", "title", "x", "y", "width", "height", "position", "noteCount", "hiddenCount"}
F_CLUSTER_KEYS = {"id", "frameId", "title", "x", "y", "noteIds", "noteCount", "dotTotal"}
P_CLUSTER_KEYS = {"id", "frameId", "title", "x", "y", "noteIds", "noteCount", "myDots"}
P_NOTE_KEYS = {"id", "frameId", "clusterId", "kind", "text", "imageUrl", "x", "y", "revealed", "mine"}
HIDDEN_P_KEYS = {"id", "frameId", "x", "y", "revealed", "mine"}
HIDDEN_F_KEYS = HIDDEN_P_KEYS | {"authorName"}
BILLING_KEYS = {"plan", "term", "state", "pastDueSince", "readOnlyAt", "renewsOn", "pendingChange", "entitlements",
                "usage", "invoices", "stale", "syncedAt"}

ISO_MS = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")

IS_FOCUSED_JS = "e => e === document.activeElement"
NO_TEXT_JS = "e => !document.createTreeWalker(e, NodeFilter.SHOW_TEXT).nextNode()"
TOP_ITEMS_JS = """el => [...el.querySelectorAll('li, [role="listitem"]')]
  .filter(li => li.parentElement.closest('ul, ol, [role="list"]') === el).map(li => li.innerText)"""
INFINITE_JS = """() => document.getAnimations()
  .filter(a => a.effect && a.effect.getTiming().iterations === Infinity)
  .map(a => {const t = a.effect.getTiming(); const d = Number(t.duration) || 0;
             return {duration: d, cycle: /alternate/.test(t.direction || '') ? 2 * d : d};})"""
HOOK_JS = """(() => {
  const rec = [];
  window.__anims = rec;
  const label = (el) => {
    let n = el;
    while (n && n.nodeType === 1) {
      if (n.tagName === 'BUTTON' || n.getAttribute('role') === 'button')
        return (n.getAttribute('aria-label') || '') + ' ' + (n.textContent || '');
      n = n.parentElement;
    }
    return '';
  };
  const propsOf = (frames) => {
    const s = new Set();
    for (const f of frames) for (const k of Object.keys(f))
      if (!['offset', 'easing', 'composite', 'computedOffset'].includes(k)) s.add(k);
    return [...s];
  };
  const push = (el, a, props, kf) => {
    const t = a.effect ? a.effect.getTiming() : {};
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : {left: 0, top: 0, width: 0, height: 0};
    const moves = ['transform', 'translate', 'rotate', 'scale'];
    rec.push({t: a.startTime != null ? Number(a.startTime) : Number(document.timeline.currentTime || 0),
              props, kf, duration: typeof t.duration === 'number' ? t.duration : 0, delay: t.delay || 0,
              x: r.left + r.width / 2, y: r.top + r.height / 2, label: label(el),
              move: props.some(p => moves.includes(p)), fade: props.includes('opacity'),
              turn: props.includes('rotate') || /rotate/i.test(kf || ''),
              allowed: props.every(p => moves.includes(p) || p === 'opacity')});
  };
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const a = orig.call(this, keyframes, options);
    try { const f = a.effect.getKeyframes(); push(this, a, propsOf(f), JSON.stringify(f)); } catch (e) {}
    return a;
  };
  const css = (ev) => {
    const el = ev.target;
    if (!el || !el.getAnimations) return;
    for (const a of el.getAnimations()) {
      if (a.__seen) continue;
      if (ev.type === 'transitionrun' && a.transitionProperty !== ev.propertyName) continue;
      if (ev.type === 'animationstart' && a.animationName !== ev.animationName) continue;
      a.__seen = true;
      const f = a.effect.getKeyframes();
      push(el, a, ev.type === 'transitionrun' ? [ev.propertyName] : propsOf(f), JSON.stringify(f));
    }
  };
  document.addEventListener('transitionrun', css, true);
  document.addEventListener('animationstart', css, true);
})();"""
RECORD_STATUS_JS = """el => {
  window.__said = [];
  const push = () => window.__said.push(el.textContent || '');
  new MutationObserver(push).observe(el, {childList: true, subtree: true, characterData: true});
}"""


def tag() -> str:
    return uuid.uuid4().hex[:8]


def seeded(i: int) -> str:
    return f"{SEED_NOTES[i % len(SEED_NOTES)]} {tag()}"


def gap_message(zone: str) -> str:
    return f"That time doesn't exist in {zone} because the clocks go forward"


def note_added(frame: str) -> str:
    return f"Note added to {frame}"


def revealed_msg(n: int, frame: str) -> str:
    count = "1 note" if n == 1 else f"{n} notes"
    return f"Round revealed: {count} in {frame} frame"


def price_text(plan: str, term: str) -> str:
    unit = "month" if term == "Monthly" else "year"
    return squash(f"€{PRICES[plan][term]} / {unit}")


def op() -> str:
    return "op-" + uuid.uuid4().hex


def address(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}@lanternfold.test"


def env_url(name: str) -> str:
    value = os.environ.get(name)
    assert value, f"{name} is not set"
    return value.rstrip("/")


def replica() -> str:
    return env_url("APP_REPLICA_URL")


def eventually(fn: Callable[[], Any], seconds: float) -> Any:
    end = time.monotonic() + seconds
    pause = threading.Event()
    while True:
        try:
            value = fn()
        except Exception:
            value = None
        if value:
            return value
        if time.monotonic() >= end:
            return None
        pause.wait(POLL)


def wait_seconds(seconds: float) -> None:
    end = time.monotonic() + seconds
    eventually(lambda: time.monotonic() >= end, seconds + 5)


def parallel(jobs: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(jobs))

    def run(job):
        barrier.wait()
        return job()

    with cf.ThreadPoolExecutor(len(jobs)) as ex:
        return list(ex.map(run, jobs))


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(dt: datetime) -> str:
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def squash(value: str) -> str:
    return re.sub(r"\s+", "", value)


def fmt_amount(amount: str) -> str:
    return f"{Decimal(amount):,.2f}"


def fmt_date(value: str) -> str:
    d = date.fromisoformat(value)
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def origin(base: str) -> str:
    parts = urlsplit(base)
    return f"{parts.scheme}://{parts.netloc}"


class Actor:

    def __init__(self):
        self.cookies: dict[str, str] = {}

    def headers_for(self, base: str, method: str, extra: dict | None = None) -> dict[str, str]:
        h: dict[str, str] = {}
        if self.cookies:
            h["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        if method not in ("GET", "HEAD"):
            h["Origin"] = origin(base)
        h.update(extra or {})
        return h

    def _store(self, r: httpx.Response) -> None:
        for sc in r.headers.get_list("set-cookie"):
            name, _, rest = sc.partition("=")
            value = rest.split(";", 1)[0]
            attrs = rest.lower()
            expired = "max-age=0" in attrs or value == ""
            m = re.search(r"expires=([^;]+)", attrs)
            if m:
                try:
                    expired = expired or email.utils.parsedate_to_datetime(m.group(1)) < datetime.now(timezone.utc)
                except (TypeError, ValueError):
                    pass
            if expired:
                self.cookies.pop(name.strip(), None)
            else:
                self.cookies[name.strip()] = value

    def req(self, method: str, base: str, path: str, body: Any = None, *, raw: bytes | None = None,
            ctype: str | None = None, headers: dict | None = None) -> httpx.Response:
        extra = dict(headers or {})
        content = None
        if raw is not None:
            content = raw
            if ctype:
                extra["Content-Type"] = ctype
        elif body is not None:
            content = json.dumps(body).encode()
            extra["Content-Type"] = "application/json"
        r = httpx.request(method, base + path, content=content, headers=self.headers_for(base, method, extra),
                          timeout=HTTP_TIMEOUT)
        self._store(r)
        return r


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.status_code} {r.text}"
    body = r.json()
    assert body["error"]["code"] == code, body
    return body["error"]


def patient(fn: Callable[[], httpx.Response]) -> httpx.Response:
    r = fn()
    for _ in range(5):
        if r.status_code != 429:
            break
        wait_seconds(int(r.headers.get("Retry-After", "1")))
        r = fn()
    return r


def sign_in(base: str, who: tuple[str, str] = JUNO) -> Actor:
    a = Actor()
    r = a.req("POST", base, "/api/session", {"email": who[0], "password": who[1]})
    assert r.status_code == 200, r.text
    return a


class Stream:

    def __init__(self, actor: Actor, base: str, wid: str, last_id: int | None = None):
        self.events: list[dict] = []
        self.status: int | None = None
        self._lock = threading.Lock()
        self._stop = False
        self._ready = threading.Event()
        headers = actor.headers_for(base, "GET", {"Accept": "text/event-stream"})
        if last_id is not None:
            headers["Last-Event-ID"] = str(last_id)
        self._client = httpx.Client(timeout=httpx.Timeout(HTTP_TIMEOUT, read=None))
        url = base + f"/api/workshops/{wid}/stream"
        threading.Thread(target=self._run, args=(url, headers), daemon=True).start()
        assert self._ready.wait(HTTP_TIMEOUT), "stream never opened"
        assert self.status == 200, self.status

    def _run(self, url: str, headers: dict) -> None:
        try:
            with self._client.stream("GET", url, headers=headers) as r:
                self.status = r.status_code
                self._ready.set()
                ev: dict[str, str] = {}
                for line in r.iter_lines():
                    if self._stop:
                        break
                    if line == "":
                        if ev:
                            with self._lock:
                                self.events.append({"event": ev.get("event", "message"), "id": ev.get("id"),
                                                    "data": ev.get("data", ""), "at": time.monotonic()})
                        ev = {}
                    elif line.startswith(":"):
                        continue
                    else:
                        key, _, value = line.partition(":")
                        value = value[1:] if value.startswith(" ") else value
                        ev[key] = ev.get(key, "") + ("\n" if key == "data" and key in ev else "") + value
        except Exception:
            pass
        finally:
            self._ready.set()

    def of(self, name: str) -> list[dict]:
        with self._lock:
            return [e for e in self.events if e["event"] == name]

    def wait(self, name: str, pred: Callable[[dict], bool] | None = None, seconds: float = EVENT_WAIT) -> list[dict]:
        return eventually(lambda: [e for e in self.of(name) if pred is None or pred(e)], seconds) or []

    def close(self) -> None:
        self._stop = True
        self._client.close()


def create_workshop(fac: Actor, base: str, title: str | None = None, start: str = START, end: str = END,
                    sponsor: str | None = None, fee: str | None = None, template: str = "discovery"):
    body = {"title": title if title is not None else f"Workshop {tag()}", "template": template,
            "scheduledStart": start, "scheduledEnd": end, "sponsorEmail": sponsor or address("sponsor")}
    if fee is not None:
        body["fee"] = fee
    return fac.req("POST", base, "/api/workshops", body)


def new_workshop(fac: Actor, base: str, **kw) -> dict:
    r = create_workshop(fac, base, **kw)
    assert r.status_code == 201, r.text
    return r.json()["workshop"]


def get_ws(fac: Actor, base: str, wid: str) -> dict:
    r = fac.req("GET", base, f"/api/workshops/{wid}")
    assert r.status_code == 200, r.text
    return r.json()["workshop"]


def move(fac: Actor, base: str, wid: str, to: str, seconds: int = ROUND_SECONDS, budget: int = DOTS):
    body: dict[str, Any] = {"clientOpId": op(), "to": to}
    if to in ("silent_round", "voting"):
        body["durationSeconds"] = seconds
    if to == "voting":
        body["dotBudget"] = budget
    return fac.req("POST", base, f"/api/workshops/{wid}/transitions", body)


def walk_to(fac: Actor, base: str, wid: str, target: str, seconds: int = ROUND_SECONDS, budget: int = DOTS) -> None:
    status = get_ws(fac, base, wid)["status"]
    for nxt in ORDER[ORDER.index(status) + 1: ORDER.index(target) + 1]:
        r = move(fac, base, wid, nxt, seconds, budget)
        assert r.status_code == 200, r.text


def retire(fac: Actor, base: str, wid: str) -> None:
    try:
        walk_to(fac, base, wid, "archived")
    except Exception:
        pass


@contextmanager
def workshop(base: str, fac: Actor, **kw):
    w = new_workshop(fac, base, **kw)
    try:
        yield w
    finally:
        retire(fac, base, w["id"])


def token_of(w: dict) -> str:
    return w["joinUrl"].rsplit("/join/", 1)[1]


def join(base: str, w: Any, name: str | None = None, actor: Actor | None = None) -> tuple[Actor, dict]:
    tok = w if isinstance(w, str) else token_of(w)
    actor = actor or Actor()
    name = name or f"Guest {tag()}"
    r = patient(lambda: actor.req("POST", base, f"/api/join/{tok}", {"displayName": name}))
    assert r.status_code in (200, 201), r.text
    return actor, r.json()["participant"]


def board(actor: Actor, base: str, wid: str) -> dict:
    r = actor.req("GET", base, f"/api/workshops/{wid}/board")
    assert r.status_code == 200, r.text
    return r.json()


def frame_of(b: dict, title: str) -> dict | None:
    return next((f for f in b["frames"] if f["title"] == title), None)


def fid(b: dict, title: str) -> str:
    return frame_of(b, title)["id"]


def frames_in_order(b: dict) -> list[dict]:
    return sorted(b["frames"], key=lambda f: f["position"])


def server_now(actor: Actor, base: str, wid: str) -> datetime:
    return parse_iso(board(actor, base, wid)["serverTime"])


def wait_server_past(actor: Actor, base: str, wid: str, instant: datetime, seconds: float = 60) -> None:
    assert eventually(lambda: server_now(actor, base, wid) >= instant, seconds), "server deadline never passed"


def note_req(actor: Actor, base: str, wid: str, frame_id: str, value: str, x: float = 10, y: float = 10,
             facilitatorOnly: bool | None = None):
    body: dict[str, Any] = {"clientOpId": op(), "frameId": frame_id, "kind": "text", "text": value, "x": x, "y": y}
    if facilitatorOnly is not None:
        body["facilitatorOnly"] = facilitatorOnly
    return actor.req("POST", base, f"/api/workshops/{wid}/notes", body)


def mk_note(actor: Actor, base: str, wid: str, frame_id: str, value: str, x: float = 10, y: float = 10,
            facilitatorOnly: bool | None = None) -> dict:
    r = patient(lambda: note_req(actor, base, wid, frame_id, value, x, y, facilitatorOnly))
    assert r.status_code == 201, r.text
    return r.json()["note"]


def patch_note(actor: Actor, base: str, nid: str, **fields):
    return actor.req("PATCH", base, f"/api/notes/{nid}", {"clientOpId": op(), **fields})


def place(actor: Actor, base: str, nid: str, frame_id: str, cluster_id: str | None, index: int | None = None):
    placement: dict[str, Any] = {"frameId": frame_id, "clusterId": cluster_id}
    if index is not None:
        placement["index"] = index
    return patch_note(actor, base, nid, placement=placement)


def mk_cluster(actor: Actor, base: str, wid: str, frame_id: str, title: str, x: float = 40, y: float = 300) -> dict:
    r = patient(lambda: actor.req("POST", base, f"/api/workshops/{wid}/clusters",
                                  {"clientOpId": op(), "frameId": frame_id, "title": title, "x": x, "y": y}))
    assert r.status_code == 201, r.text
    return r.json()["cluster"]


def connect(actor: Actor, base: str, wid: str, a: str, b: str):
    return actor.req("POST", base, f"/api/workshops/{wid}/connectors",
                     {"clientOpId": op(), "fromNoteId": a, "toNoteId": b})


def spend(actor: Actor, base: str, cid: str):
    return actor.req("POST", base, f"/api/clusters/{cid}/dots", {"clientOpId": op()})


def give_back(actor: Actor, base: str, cid: str):
    return actor.req("POST", base, f"/api/clusters/{cid}/dots/return", {"clientOpId": op()})


def search(actor: Actor, base: str, wid: str, q: str):
    return actor.req("GET", base, f"/api/workshops/{wid}/search?q={quote(q)}")


def billing(fac: Actor, base: str) -> dict:
    r = fac.req("GET", base, "/api/billing")
    assert r.status_code == 200, r.text
    return r.json()


def png(w: int = 2, h: int = 2, meta: bool = False) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes([200, 180, 60]) * w for _ in range(h))
    out = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    if meta:
        out += chunk(b"tEXt", b"Comment\x00GPS 38.7 -9.1") + chunk(b"eXIf", b"MM\x00*\x00\x00\x00\x08\x00\x00")
    return out + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def png_chunks(data: bytes) -> list[bytes]:
    kinds, i = [], 8
    while i + 8 <= len(data):
        length = struct.unpack(">I", data[i:i + 4])[0]
        kinds.append(data[i + 4:i + 8])
        i += 12 + length
    return kinds


def upload(actor: Actor, base: str, wid: str, data: bytes | None = None, ctype: str = "image/png"):
    return actor.req("POST", base, f"/api/workshops/{wid}/images", raw=png() if data is None else data, ctype=ctype)


def revealed_board(base: str, fac: Actor, w: dict, specs: tuple = None):
    specs = specs or (("Problems", f"idea {tag()}"),)
    walk_to(fac, base, w["id"], "open")
    p1, i1 = join(base, w)
    p2, i2 = join(base, w)
    assert move(fac, base, w["id"], "silent_round").status_code == 200
    b = board(fac, base, w["id"])
    made = [mk_note(p1, base, w["id"], fid(b, frame), value, 40 + 120 * (i % 5), 40 + 100 * (i // 5))
            for i, (frame, value) in enumerate(specs)]
    assert move(fac, base, w["id"], "revealed").status_code == 200
    return p1, i1, p2, i2, made


def drive_to_snapshot(fac: Actor, base: str, wid: str, frame_id: str) -> int:
    for _ in range(60):
        r = patient(lambda: fac.req("PATCH", base, f"/api/frames/{frame_id}", {"clientOpId": op(), "y": 0}))
        assert r.status_code == 200, r.text
        version = get_ws(fac, base, wid)["version"]
        if version % 50 == 0:
            return version
    raise AssertionError("version never reached a multiple of 50")


def recap_of(fac: Actor, base: str, wid: str) -> dict | None:
    r = fac.req("GET", base, f"/api/workshops/{wid}/recap")
    return r.json() if r.status_code == 200 else None


def wait_recap(fac: Actor, base: str, wid: str, pred: Callable[[dict], bool], seconds: float = RECAP_WAIT):
    return eventually(lambda: (lambda rc: rc if rc and pred(rc) else None)(recap_of(fac, base, wid)), seconds)


def recap_token(rc: dict) -> str:
    return rc["recapUrl"].rsplit("/recap/", 1)[1]


def build_recap_board(base: str, fac: Actor, w: dict) -> dict:
    walk_to(fac, base, w["id"], "open")
    names = [f"{SEED_NAMES[0]} {tag()}", f"{SEED_NAMES[1]} {tag()}"]
    p1, _ = join(base, w, names[0])
    p2, _ = join(base, w, names[1])
    assert move(fac, base, w["id"], "silent_round").status_code == 200
    b = board(fac, base, w["id"])
    prob, opp = fid(b, "Problems"), fid(b, "Opportunities")
    values = RECAP_FORMULAS + [RECAP_PLAIN]
    notes = [mk_note(p1, base, w["id"], prob, v, 40 + 120 * i, 40) for i, v in enumerate(values)]
    opp_note = mk_note(p2, base, w["id"], opp, RECAP_OPP)
    assert move(fac, base, w["id"], "revealed").status_code == 200
    private = f"{PRIVATE_NOTE} {tag()}"
    mk_note(fac, base, w["id"], prob, private, 600, 500, facilitatorOnly=True)
    formulas = mk_cluster(fac, base, w["id"], prob, CLUSTER_A, 40, 250)
    signals = mk_cluster(fac, base, w["id"], prob, CLUSTER_B, 400, 250)
    zeta = mk_cluster(fac, base, w["id"], opp, CLUSTER_C, 40, 250)
    for n, c in ((notes[0], formulas), (notes[1], formulas), (notes[2], signals), (notes[3], signals)):
        assert place(fac, base, n["id"], prob, c["id"]).status_code == 200
    assert place(fac, base, opp_note["id"], opp, zeta["id"]).status_code == 200
    assert move(fac, base, w["id"], "voting", VOTE_SECONDS, DOTS).status_code == 200
    for p, c in ((p1, formulas), (p1, formulas), (p2, signals), (p2, signals)):
        assert spend(p, base, c["id"]).status_code == 201
    return {"private": private, "names": names}


class Pdf:

    def __init__(self, data: bytes):
        self.data = data
        self.objs: dict[int, tuple[bytes, bytes | None]] = {}
        for m in re.finditer(rb"(\d+)\s+\d+\s+obj\b(.*?)endobj", data, re.S):
            self.objs[int(m.group(1))] = self._split(m.group(2))
        for head, stream in list(self.objs.values()):
            if stream is not None and re.search(rb"/Type\s*/ObjStm", head):
                n = int(re.search(rb"/N\s+(\d+)", head).group(1))
                first = int(re.search(rb"/First\s+(\d+)", head).group(1))
                nums = [int(x) for x in stream[:first].split()]
                pairs = list(zip(nums[0::2], nums[1::2]))[:n]
                for i, (num, off) in enumerate(pairs):
                    end = pairs[i + 1][1] if i + 1 < len(pairs) else len(stream) - first
                    self.objs.setdefault(num, (stream[first + off:first + end], None))

    @staticmethod
    def _split(body: bytes) -> tuple[bytes, bytes | None]:
        m = re.search(rb">>\s*stream\r?\n", body)
        if not m:
            return body, None
        head = body[:m.start() + 2]
        raw = body[m.end():]
        cut = raw.rfind(b"endstream")
        raw = raw[:cut] if cut >= 0 else raw
        if b"/FlateDecode" in head:
            try:
                raw = zlib.decompressobj().decompress(raw)
            except zlib.error:
                pass
        return head, raw

    def _ref(self, head: bytes, key: bytes) -> int | None:
        m = re.search(rb"/" + key + rb"(?![A-Za-z0-9])\s*(\d+)\s+\d+\s+R", head)
        return int(m.group(1)) if m else None

    @staticmethod
    def _cmap(data: bytes) -> tuple[int, dict[int, str]]:
        def u16(h: str) -> str:
            if len(h) % 2:
                h += "0"
            return bytes.fromhex(h).decode("utf-16-be", "replace")

        src = data.decode("latin-1")
        m = re.search(r"begincodespacerange\s*<([0-9A-Fa-f]+)>", src)
        codelen = len(m.group(1)) // 2 if m else 1
        mapping: dict[int, str] = {}
        for block in re.findall(r"beginbfchar(.*?)endbfchar", src, re.S):
            for s, d in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", block):
                mapping[int(s, 16)] = u16(d)
        for block in re.findall(r"beginbfrange(.*?)endbfrange", src, re.S):
            for lo, hi, rest in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])", block):
                lo_i, hi_i = int(lo, 16), int(hi, 16)
                if rest.startswith("["):
                    for k, d in enumerate(re.findall(r"<([0-9A-Fa-f]*)>", rest)):
                        mapping[lo_i + k] = u16(d)
                else:
                    base = bytes.fromhex(rest[1:-1] + ("0" if len(rest[1:-1]) % 2 else ""))
                    start = int.from_bytes(base, "big")
                    for k in range(hi_i - lo_i + 1):
                        mapping[lo_i + k] = (start + k).to_bytes(len(base), "big").decode("utf-16-be", "replace")
        return codelen, mapping

    def _fonts(self) -> dict[bytes, Any]:
        names: dict[bytes, int] = {}

        def scan(block: bytes) -> None:
            for nm in re.finditer(rb"/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R", block):
                names[nm.group(1)] = int(nm.group(2))

        for head, _ in self.objs.values():
            for fm in re.finditer(rb"/Font\s*<<(.*?)>>", head, re.S):
                scan(fm.group(1))
            ref = self._ref(head, b"Font")
            if ref is not None and ref in self.objs:
                scan(self.objs[ref][0])
        fonts: dict[bytes, Any] = {}
        for name, num in names.items():
            head = self.objs.get(num, (b"", None))[0]
            tu = self._ref(head, b"ToUnicode")
            stream = self.objs.get(tu, (b"", None))[1] if tu is not None else None
            fonts[name] = self._cmap(stream) if stream else None
        return fonts

    @staticmethod
    def _decode(raw: bytes, cmap: Any) -> str:
        if not cmap:
            return raw.decode("latin-1")
        codelen, mapping = cmap
        return "".join(mapping.get(int.from_bytes(raw[k:k + codelen], "big"), "")
                       for k in range(0, len(raw), codelen))

    def text(self) -> str:
        fonts = self._fonts()
        out: list[str] = []
        for num in sorted(self.objs):
            head = self.objs[num][0]
            if not re.search(rb"/Type\s*/Page(?![A-Za-z])", head):
                continue
            refs: list[int] = []
            single = self._ref(head, b"Contents")
            if single is not None:
                refs = [single]
            else:
                arr = re.search(rb"/Contents\s*\[(.*?)\]", head, re.S)
                if arr:
                    refs = [int(x) for x in re.findall(rb"(\d+)\s+\d+\s+R", arr.group(1))]
            for ref in refs:
                stream = self.objs.get(ref, (b"", None))[1]
                if stream:
                    out.append(self._show(stream, fonts))
        return "\n".join(out)

    def _show(self, content: bytes, fonts: dict[bytes, Any]) -> str:
        out: list[str] = []
        stack: list[Any] = []
        cmap = None
        for kind, val in _pdf_tokens(content):
            if kind == "op" and val == b"[":
                stack.append("[")
            elif kind == "op" and val == b"]":
                items = []
                while stack and stack[-1] != "[":
                    items.append(stack.pop())
                if stack:
                    stack.pop()
                stack.append(("arr", items[::-1]))
            elif kind == "op" and val not in (b"<<", b">>"):
                operands = [v for v in stack if isinstance(v, tuple)]
                if val == b"Tf":
                    names = [v for v in operands if v[0] == "name"]
                    if names:
                        cmap = fonts.get(names[-1][1])
                elif val in (b"Tj", b"'", b'"'):
                    strs = [v for v in operands if v[0] == "str"]
                    if strs:
                        out.append(self._decode(strs[-1][1], cmap))
                elif val == b"TJ":
                    arrs = [v for v in operands if v[0] == "arr"]
                    if arrs:
                        out.extend(self._decode(i[1], cmap) for i in arrs[-1][1] if i[0] == "str")
                elif val == b"ET":
                    out.append("\n")
                stack = []
            else:
                stack.append((kind, val))
        return "".join(out)

    def info(self) -> dict[str, str]:
        refs = re.findall(rb"/Info\s+(\d+)\s+\d+\s+R", self.data)
        if not refs:
            return {}
        head = self.objs.get(int(refs[-1]), (b"", None))[0]
        toks = [t for t in _pdf_tokens(head) if t not in (("op", b"<<"), ("op", b">>"))]
        result: dict[str, str] = {}
        for (k1, v1), (k2, v2) in zip(toks[0::2], toks[1::2]):
            if k1 == "name":
                if k2 == "str":
                    if v2.startswith(b"\xfe\xff"):
                        result[v1.decode()] = v2[2:].decode("utf-16-be", "replace")
                    else:
                        result[v1.decode()] = v2.decode("latin-1")
                else:
                    result[v1.decode()] = str(v2)
        return result


_WS = b" \t\r\n\x00\x0c"
_DELIMS = b"()<>[]{}/%"


def _pdf_tokens(s: bytes):
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in _WS:
            i += 1
        elif c == 0x25:
            while i < n and s[i] not in b"\r\n":
                i += 1
        elif c == 0x28:
            out, depth, i = bytearray(), 1, i + 1
            while i < n:
                ch = s[i]
                if ch == 0x5C:
                    i += 1
                    nx = s[i] if i < n else 0
                    if nx in b"01234567":
                        j = i
                        while j < n and j < i + 3 and s[j] in b"01234567":
                            j += 1
                        out.append(int(s[i:j], 8) & 0xFF)
                        i = j
                        continue
                    if nx == 0x0D:
                        i += 1
                        if i < n and s[i] == 0x0A:
                            i += 1
                        continue
                    if nx == 0x0A:
                        i += 1
                        continue
                    out.append({0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}.get(nx, nx))
                    i += 1
                    continue
                if ch == 0x28:
                    depth += 1
                elif ch == 0x29:
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                out.append(ch)
                i += 1
            yield ("str", bytes(out))
        elif c == 0x3C:
            if s[i + 1:i + 2] == b"<":
                yield ("op", b"<<")
                i += 2
            else:
                j = s.find(b">", i)
                j = n if j < 0 else j
                h = re.sub(rb"[^0-9A-Fa-f]", b"", s[i + 1:j])
                if len(h) % 2:
                    h += b"0"
                yield ("str", bytes.fromhex(h.decode()))
                i = j + 1
        elif c == 0x3E:
            yield ("op", b">>")
            i += 2
        elif c in b"[]":
            yield ("op", bytes([c]))
            i += 1
        elif c in b"{})":
            i += 1
        elif c == 0x2F:
            j = i + 1
            while j < n and s[j] not in _WS and s[j] not in _DELIMS:
                j += 1
            yield ("name", s[i + 1:j])
            i = j
        else:
            j = i
            while j < n and s[j] not in _WS and s[j] not in _DELIMS:
                j += 1
            if j == i:
                i += 1
                continue
            tok = s[i:j]
            i = j
            if re.fullmatch(rb"[+-]?(\d+\.?\d*|\.\d+)", tok):
                yield ("num", float(tok))
            else:
                yield ("op", tok)


def mails_for(mail, addr: str, prefix: str | None = None, settle: float = 0.5) -> list[dict]:
    found = []
    for m in mail.messages(settle=settle):
        to = [a.lower() for a in addresses(m.get("To") or [])]
        if addr.lower() in to and (prefix is None or (m.get("Subject") or "").startswith(prefix)):
            found.append(m)
    return found


def wait_mails(mail, addr: str, n: int, prefix: str | None = None) -> list[dict]:
    got = eventually(lambda: (lambda l: l if len(l) >= n else None)(mails_for(mail, addr, prefix)), MAIL_WAIT)
    return got or mails_for(mail, addr, prefix)


def single_recipient(m: dict, addr: str) -> None:
    assert [a.lower() for a in addresses(m.get("To") or [])] == [addr.lower()]
    assert not addresses(m.get("Cc") or []) and not addresses(m.get("Bcc") or [])


@contextmanager
def room(browser, base: str, actor: Actor | None, path: str, *, reduced: str = "no-preference", hook: bool = False,
         size: dict | None = None):
    with open_app(browser, base + "/", reduced_motion=reduced) as page:
        page.set_viewport_size(size or ROOM_VIEW)
        if actor is not None and actor.cookies:
            page.context.add_cookies([{"name": k, "value": v, "url": base} for k, v in actor.cookies.items()])
        if hook:
            page.add_init_script(HOOK_JS)
        page.goto(base + path)
        yield page


def ui(page, pred: Callable[[], Any], seconds: float = EVENT_WAIT, what: str = "condition") -> None:
    end = time.monotonic() + seconds
    while True:
        try:
            ok = bool(pred())
        except Exception:
            ok = False
        if ok:
            return
        if time.monotonic() >= end:
            raise AssertionError(f"{what} not reached within {seconds} s")
        advance(page, 50)


def shows(loc) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def says(loc, value: str) -> bool:
    return value in loc.inner_text()


def page_reads(page, value: str) -> bool:
    return " ".join(value.split()) in " ".join(page.locator("body").inner_text().split())


def motion_allowed(a: dict) -> bool:
    return a["allowed"] or (all(INK_PROP.search(p) for p in a["props"]) and a["duration"] < HOVER_MS)


def status_of(page):
    return page.get_by_role("status", name="Board activity")


def problems_of(page):
    return page.get_by_role("alert", name="Board problems")


def drawer(page):
    return page.get_by_role("complementary", name="Session")


def region(page, title: str):
    return page.get_by_role("main", name="Board").get_by_role("region", name=title, exact=True)


def rail_button(page, title: str):
    return page.get_by_role("navigation", name="Frames").get_by_role("button", name=title, exact=True)


def tool(page, name: str):
    return page.get_by_role("toolbar", name="Board tools").get_by_role("button", name=name, exact=True)


def wait_board(page) -> None:
    ui(page, lambda: shows(page.get_by_role("main", name="Board")), what="board")


def ui_add_note(page, frame: str, value: str) -> None:
    click(rail_button(page, frame))
    click(tool(page, "Add note"))
    box = page.get_by_role("textbox", name="Note text")
    ui(page, lambda: box.is_visible(), what="note editor")
    fill(box, value)
    click(page.get_by_role("button", name="Save note"))


def drag(page, loc, x: float, y: float, before_up: Callable[[], Any] | None = None) -> None:
    sx, sy = center(loc)
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + (x - sx) / 4, sy + (y - sy) / 4, steps=4)
    page.mouse.move(x, y, steps=8)
    if before_up:
        before_up()
    page.mouse.up()


def mark(page) -> float:
    return float(page.evaluate("Number(document.timeline.currentTime || 0)"))


def anims_since(page, start: float) -> list[dict]:
    return [a for a in page.evaluate("window.__anims || []") if a["t"] >= start - 1]


def start_of(a: dict) -> float:
    return a["t"] + a["delay"]


def inside(box: dict, a: dict) -> bool:
    return box["x"] <= a["x"] <= box["x"] + box["width"] and box["y"] <= a["y"] <= box["y"] + box["height"]


def moving(a: dict) -> bool:
    return bool(a.get("move"))


def flips(a: dict) -> bool:
    return bool(a.get("turn"))


def record_status(page) -> None:
    status_of(page).evaluate(RECORD_STATUS_JS)


def _said(page) -> list[str]:
    return page.evaluate("window.__said || []")


def announced(page, needle: str) -> int:
    said, count = _said(page), 0
    for i, value in enumerate(said):
        if needle in value and (i == 0 or needle not in said[i - 1]):
            count += 1
    return count


def first_announced(page, needle: str) -> tuple[int, int]:
    for i, value in enumerate(_said(page)):
        if needle in value:
            return (i, value.index(needle))
    return (10 ** 9, 0)


def test_signin_sessions(app_url):
    for (mail_addr, password), name, zone in ((JUNO, JUNO_NAME, JUNO_ZONE), (ODILE, ODILE_NAME, ODILE_ZONE)):
        a = Actor()
        r = a.req("POST", app_url, "/api/session", {"email": mail_addr, "password": password})
        assert r.status_code == 200, r.text
        assert r.json() == {"facilitator": {"name": name, "email": mail_addr, "timeZone": zone}}
        cookies = [c.lower() for c in r.headers.get_list("set-cookie")]
        assert any(all(f.lower() in c for f in COOKIE_FLAGS) for c in cookies)
        again = a.req("GET", replica(), "/api/session")
        assert again.status_code == 200 and again.json() == r.json()
    anon = Actor()
    for path in ("/api/session", "/api/workshops", "/api/billing", "/api/activity"):
        assert err(anon.req("GET", app_url, path), 401, "unauthenticated")["message"] == "Sign in to continue"
    err(anon.req("POST", app_url, "/api/workshops", {"title": "x"}), 401, "unauthenticated")
    bad = err(Actor().req("POST", app_url, "/api/session", {"email": address("nobody"), "password": "wrong"}),
              401, "invalid_credentials")
    assert bad["message"] == "Email or password is incorrect"
    err(Actor().req("POST", app_url, "/api/session", {"email": address("nobody")}), 422, "validation")
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p, _ = join(app_url, w)
        err(p.req("GET", app_url, "/api/session"), 401, "unauthenticated")
        err(p.req("GET", app_url, "/api/workshops"), 403, "forbidden")
        err(p.req("GET", app_url, "/api/billing"), 403, "forbidden")
    out = sign_in(app_url)
    assert out.req("DELETE", app_url, "/api/session").status_code == 204
    err(out.req("GET", replica(), "/api/workshops"), 401, "unauthenticated")
    for env in ("APP_MINIO_DOWN_URL", "APP_MAILPIT_DOWN_URL", "APP_KILLBILL_DOWN_URL"):
        outage = sign_in(env_url(env))
        assert outage.req("GET", env_url(env), "/api/workshops").status_code == 200


def test_wf_session_lifecycle_signin(browser, app_url):
    with room(browser, app_url, None, "/signin") as page:
        fill(page.get_by_role("textbox", name="Email"), address("nobody"))
        fill(page.get_by_label("Password", exact=True), "not-the-password")
        click(page.get_by_role("button", name="Sign in"))
        ui(page, lambda: "Email or password is incorrect" in page.get_by_role("alert").first.inner_text())
        assert page.request.get(app_url + "/api/session").status == 401
        fill(page.get_by_role("textbox", name="Email"), JUNO[0])
        fill(page.get_by_label("Password", exact=True), JUNO[1])
        click(page.get_by_role("button", name="Sign in"))
        ui(page, lambda: shows(page.get_by_role("heading", name="Your workshops")), what="workshop list")
        assert "/workshops" in page.url
        me = page.request.get(app_url + "/api/session")
        assert me.status == 200 and me.json()["facilitator"]["email"] == JUNO[0]
        click(page.get_by_role("button", name="Sign out"))
        ui(page, lambda: page.request.get(app_url + "/api/session").status == 401, what="signed out")


def test_workshop_templates_api(app_url):
    fac = sign_in(app_url)
    for template, titles in TEMPLATES.items():
        with workshop(app_url, fac, template=template, fee="1250.1") as w:
            assert w["status"] == "draft" and w["template"] == template
            assert w["fee"] == {"amount": FEE, "currency": "EUR"}
            assert re.fullmatch(r"[A-Za-z0-9_-]{32,}", token_of(w))
            frames = frames_in_order(board(fac, app_url, w["id"]))
            assert [f["title"] for f in frames] == titles
            for i, f in enumerate(frames):
                assert (f["x"], f["y"], f["width"], f["height"]) == (i * FRAME_STEP, 0, FRAME_W, FRAME_H)
                assert (f["noteCount"], f["hiddenCount"]) == (0, 0)
    with workshop(app_url, fac) as w:
        assert w["fee"] == {"amount": "0.00", "currency": "EUR"}
    r = fac.req("POST", app_url, "/api/workshops",
                {"title": "", "template": "kanban", "scheduledStart": START, "scheduledEnd": END,
                 "sponsorEmail": "Ada <ada@lanternfold.test>", "fee": 1250.1})
    fields = err(r, 422, "validation")["fields"]
    assert fields["title"] == "Enter a title of 1 to 120 characters"
    assert fields["template"] == "Choose a template"
    assert fields["sponsorEmail"] == "Enter an email address"
    assert fields["fee"] == "Enter an amount in euros with up to two decimals"
    for fee in ("100000.01", "12.345", "-5"):
        e = err(create_workshop(fac, app_url, fee=fee), 422, "validation")
        assert e["fields"]["fee"] == "Enter an amount in euros with up to two decimals"


def test_wf_session_lifecycle_create(browser, app_url):
    fac = sign_in(app_url)
    title = f"{TITLE_BASE} {tag()}"
    sponsor = address("sponsor")
    with room(browser, app_url, fac, "/workshops") as page:
        opener = page.get_by_role("button", name="New workshop")
        ui(page, lambda: shows(opener))
        click(opener)
        dlg = page.get_by_role("dialog", name="New workshop")
        fill(dlg.get_by_role("textbox", name="Title"), title)
        check(dlg.get_by_role("radiogroup", name="Template").get_by_role("radio", name="Discovery sprint"))
        fill(dlg.get_by_label("Starts", exact=True), START)
        fill(dlg.get_by_label("Ends", exact=True), END)
        fill(dlg.get_by_role("textbox", name="Sponsor email"), sponsor)
        fill(dlg.get_by_role("textbox", name="Client fee (EUR)"), FEE)
        click(dlg.get_by_role("button", name="Create workshop"))
        ui(page, lambda: "/w/" in page.url, what="board opened")
        wid = re.split(r"[?#/]", page.url.split("/w/", 1)[1])[0]
        try:
            wait_board(page)
            ui(page, lambda: "Draft" in page.get_by_role("banner").first.inner_text(), what="Draft label")
            ui(page, lambda: says(status_of(page), f"Workshop created from the {TEMPLATE_LABELS['discovery']} template"))
            rail = page.get_by_role("navigation", name="Frames").get_by_role("button").all_inner_texts()
            assert [t.strip() for t in rail if t.strip() in TEMPLATES["discovery"]] == TEMPLATES["discovery"]
            w = get_ws(fac, app_url, wid)
            assert (w["title"], w["template"], w["status"], w["sponsorEmail"]) == (title, "discovery", "draft", sponsor)
            assert w["fee"] == {"amount": FEE, "currency": "EUR"}
            assert (w["scheduledStart"], w["scheduledEnd"], w["joinLinkExpiresAt"]) == (START, END, END_EXPIRY)
            ui(page, lambda: w["joinUrl"] in drawer(page).inner_text(), what="join link in drawer")
        finally:
            retire(fac, app_url, wid)


def test_state_machine(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        wid = w["id"]
        e = err(move(fac, app_url, wid, "silent_round"), 409, "illegal_transition")
        assert e["message"] == (f"The workshop can't move from {STATUS_LABELS['draft']} to "
                                f"{STATUS_LABELS['silent_round']}")
        err(move(fac, app_url, wid, "draft"), 409, "illegal_transition")
        assert move(fac, app_url, wid, "open").status_code == 200
        p, _ = join(app_url, w)
        err(move(p, app_url, wid, "silent_round"), 403, "forbidden")
        err(move(fac, app_url, wid, "revealed"), 409, "illegal_transition")
        err(fac.req("POST", app_url, f"/api/workshops/{wid}/transitions", {"clientOpId": op(), "to": "silent_round"}),
            422, "validation")
        err(move(fac, app_url, wid, "silent_round", 4), 422, "validation")
        assert move(fac, app_url, wid, "silent_round").status_code == 200
        assert get_ws(fac, app_url, wid)["round"]["number"] == 1
        assert move(fac, app_url, wid, "revealed").status_code == 200
        err(move(fac, app_url, wid, "revealed"), 409, "illegal_transition")
        assert move(fac, app_url, wid, "silent_round").status_code == 200
        assert get_ws(fac, app_url, wid)["round"]["number"] == 2
        assert move(fac, app_url, wid, "revealed").status_code == 200
        err(move(fac, app_url, wid, "voting", ROUND_SECONDS, 21), 422, "validation")
        assert move(fac, app_url, wid, "voting").status_code == 200
        assert get_ws(fac, app_url, wid)["voting"]["dotBudget"] == DOTS
        err(move(fac, app_url, wid, "archived"), 409, "illegal_transition")
        assert move(fac, app_url, wid, "closed").status_code == 200
        for to in ("voting", "closed", "open"):
            assert err(move(fac, app_url, wid, to), 409, "workshop_closed")["message"] == "This workshop has ended"
        assert move(fac, app_url, wid, "archived").status_code == 200
        for to in ("closed", "archived"):
            err(move(fac, replica(), wid, to), 409, "workshop_closed")
        assert get_ws(fac, app_url, wid)["status"] == "archived"


def test_one_advance_wins(app_url):
    fac = sign_in(app_url)
    bases = [app_url, replica()]
    with workshop(app_url, fac) as w:
        v0 = get_ws(fac, app_url, w["id"])["version"]
        rs = parallel([lambda i=i: move(fac, bases[i % 2], w["id"], "open") for i in range(6)])
        assert sorted(r.status_code for r in rs) == [200] + [409] * 5
        for r in rs:
            if r.status_code == 409:
                err(r, 409, "illegal_transition")
        assert get_ws(fac, app_url, w["id"])["version"] == v0 + 1
        walk_to(fac, app_url, w["id"], "voting")
        rs = parallel([lambda i=i: move(fac, bases[i % 2], w["id"], "closed") for i in range(6)])
        assert sorted(r.status_code for r in rs) == [200] + [409] * 5
        for r in rs:
            if r.status_code == 409:
                err(r, 409, "workshop_closed")
        assert get_ws(fac, app_url, w["id"])["status"] == "closed"


def test_activity_log(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        assert move(fac, app_url, w["id"], "open").status_code == 200
        assert fac.req("POST", app_url, f"/api/workshops/{w['id']}/join-link/rotate").status_code == 200
        first = fac.req("GET", app_url, "/api/activity?limit=2")
        assert first.status_code == 200, first.text
        page1 = first.json()
        assert len(page1["entries"]) == 2 and isinstance(page1["nextCursor"], str)
        for e in page1["entries"]:
            assert set(e) == {"id", "seq", "at", "actor", "action", "workshopId"} and ISO_MS.match(e["at"])
        assert page1["entries"][0]["seq"] > page1["entries"][1]["seq"]
        assert fac.req("DELETE", app_url, f"/api/workshops/{w['id']}/join-link").status_code == 200
        collected, cursor = list(page1["entries"]), page1["nextCursor"]
        for _ in range(MAX_PAGES):
            if not cursor or any(e["workshopId"] == w["id"] and e["action"] == "workshop.created" for e in collected):
                break
            nxt = fac.req("GET", app_url, f"/api/activity?limit=2&cursor={quote(cursor)}").json()
            assert nxt["entries"] and nxt["entries"][0]["seq"] < collected[-1]["seq"]
            collected += nxt["entries"]
            cursor = nxt["nextCursor"]
        mine = [(e["action"], e["actor"]) for e in collected if e["workshopId"] == w["id"]]
        assert mine == [("join_link.rotated", "facilitator"), ("workshop.transitioned", "facilitator"),
                        ("workshop.created", "facilitator")]
        fresh = fac.req("GET", app_url, "/api/activity?limit=100").json()["entries"]
        assert [e["action"] for e in fresh if e["workshopId"] == w["id"]][0] == "join_link.turned_off"
        e = err(fac.req("GET", app_url, "/api/activity?cursor=not-a-cursor"), 422, "validation")
        assert e["fields"]["cursor"] == "That cursor isn't valid"
        for limit in ("0", "101"):
            assert "limit" in err(fac.req("GET", app_url, f"/api/activity?limit={limit}"), 422, "validation")["fields"]


def test_workspace_isolation(app_url):
    juno, odile = sign_in(app_url), sign_in(app_url, ODILE)
    with workshop(app_url, juno) as w, workshop(app_url, odile) as ow:
        p, _, _, _, made = revealed_board(app_url, juno, w, (("Problems", "iso a"), ("Problems", "iso b")))
        b = board(juno, app_url, w["id"])
        prob = fid(b, "Problems")
        cl = mk_cluster(juno, app_url, w["id"], prob, "Iso")
        con = connect(juno, app_url, w["id"], made[0]["id"], made[1]["id"]).json()["connector"]
        item = juno.req("POST", app_url, f"/api/frames/{fid(b, 'Questions')}/trash",
                        {"clientOpId": op()}).json()["trashItem"]
        walk_to(odile, app_url, ow["id"], "open")
        outsider, _ = join(app_url, ow)
        v0 = get_ws(juno, app_url, w["id"])["version"]
        hijack = seeded(3)
        probes = [
            ("GET", f"/api/workshops/{w['id']}", None),
            ("GET", f"/api/workshops/{w['id']}/board", None),
            ("GET", f"/api/workshops/{w['id']}/trash", None),
            ("GET", f"/api/workshops/{w['id']}/versions", None),
            ("GET", f"/api/workshops/{w['id']}/search?q=iso", None),
            ("POST", f"/api/workshops/{w['id']}/versions/{'v' * 12}/restore", {"clientOpId": op()}),
            ("PATCH", f"/api/frames/{prob}", {"clientOpId": op(), "title": hijack}),
            ("PATCH", f"/api/notes/{made[0]['id']}", {"clientOpId": op(), "text": hijack}),
            ("DELETE", f"/api/notes/{made[1]['id']}", None),
            ("PATCH", f"/api/clusters/{cl['id']}", {"clientOpId": op(), "title": hijack}),
            ("DELETE", f"/api/connectors/{con['id']}", None),
            ("POST", f"/api/trash/{item['id']}/restore", {"clientOpId": op()}),
            ("POST", f"/api/workshops/{w['id']}/notes",
             {"clientOpId": op(), "frameId": prob, "kind": "text", "text": hijack, "x": 1, "y": 1}),
        ]
        for who in (odile, outsider):
            for method, path, body in probes:
                err(who.req(method, app_url, path, body), 404, "not_found")
        err(juno.req("GET", app_url, f"/api/workshops/{ow['id']}"), 404, "not_found")
        err(p.req("GET", app_url, f"/api/workshops/{ow['id']}/board"), 404, "not_found")
        assert get_ws(juno, app_url, w["id"])["version"] == v0
        after = board(juno, app_url, w["id"])
        assert {n["id"] for n in after["notes"]} == {n["id"] for n in made}
        assert all(n["text"] != hijack for n in after["notes"]) and after["connectors"]
        assert all(f["title"] != hijack for f in after["frames"])
        theirs = odile.req("GET", app_url, "/api/activity?limit=100").json()["entries"]
        assert all(e["workshopId"] != w["id"] for e in theirs)


def test_join_link_api(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w, workshop(app_url, fac) as other:
        tok = token_of(w)
        assert re.fullmatch(r"[A-Za-z0-9_-]{32,}", tok) and token_of(other) != tok
        info = Actor().req("GET", app_url, f"/api/join/{tok}")
        assert info.status_code == 200
        assert info.json() == {"workshop": {"title": w["title"], "status": "draft", "scheduledStart": START,
                                            "scheduledEnd": END, "timeZone": JUNO_ZONE}}
        junk = "z" * 40
        err(Actor().req("GET", app_url, f"/api/join/{junk}"), 404, "not_found")
        err(Actor().req("POST", app_url, f"/api/join/{junk}", {"displayName": "Nobody"}), 404, "not_found")
        e = err(Actor().req("POST", app_url, f"/api/join/{tok}", {"displayName": "Early"}), 409, "workshop_not_open")
        assert e["message"] == "This workshop hasn't opened yet"
        walk_to(fac, app_url, w["id"], "open")
        for bad in ("", "   ", "x" * 41):
            e = err(Actor().req("POST", app_url, f"/api/join/{tok}", {"displayName": bad}), 422, "validation")
            assert e["fields"]["displayName"] == "Check this value"
        a = Actor()
        r = a.req("POST", app_url, f"/api/join/{tok}", {"displayName": f"  {SEED_NAMES[0]}  "})
        assert r.status_code == 201, r.text
        assert r.json()["participant"]["displayName"] == SEED_NAMES[0] and r.json()["workshopId"] == w["id"]
        again = a.req("POST", replica(), f"/api/join/{tok}", {"displayName": SEED_NAMES[1]})
        assert again.status_code == 200 and again.json()["participant"]["id"] == r.json()["participant"]["id"]
        assert get_ws(fac, app_url, w["id"])["participantCount"] == 1
        assert a.req("GET", replica(), f"/api/workshops/{w['id']}/board").status_code == 200
        err(a.req("GET", app_url, f"/api/workshops/{other['id']}/board"), 404, "not_found")
        err(a.req("GET", app_url, "/api/workshops"), 403, "forbidden")
        walk_to(fac, app_url, other["id"], "closed", SHORT_SECONDS, 1)
        err(Actor().req("POST", app_url, f"/api/join/{token_of(other)}", {"displayName": "Late"}),
            409, "workshop_closed")


def test_wf_join_link_pages(browser, app_url):
    fac = sign_in(app_url)
    junk = "z" * 40
    with room(browser, app_url, None, f"/join/{junk}") as page:
        ui(page, lambda: "We couldn't find that workshop link." in page.content())
    with workshop(app_url, fac) as w:
        with room(browser, app_url, None, f"/join/{token_of(w)}") as page:
            ui(page, lambda: shows(page.get_by_role("heading", level=1, name=w["title"])))
            fill(page.get_by_role("textbox", name="Your name"), "Early bird")
            click(page.get_by_role("button", name="Join workshop"))
            ui(page, lambda: "This workshop hasn't opened yet. Try again when your facilitator opens the room."
               in page.content())
            assert get_ws(fac, app_url, w["id"])["participantCount"] == 0
            walk_to(fac, app_url, w["id"], "open")
            click(page.get_by_role("button", name="Join workshop"))
            wait_board(page)
            assert f"/w/{w['id']}" in page.url
        assert get_ws(fac, app_url, w["id"])["participantCount"] == 1
        tok = token_of(w)
        assert fac.req("DELETE", app_url, f"/api/workshops/{w['id']}/join-link").status_code == 200
        with room(browser, app_url, None, f"/join/{tok}") as page:
            ui(page, lambda: "This join link has been turned off. Ask your facilitator for a new one." in page.content())
            assert page.get_by_role("button", name="Join workshop").count() == 0


def test_link_rotate_revoke(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p1, info1 = join(app_url, w)
        old_tok, old_expiry = token_of(w), w["joinLinkExpiresAt"]
        r = fac.req("POST", app_url, f"/api/workshops/{w['id']}/join-link/rotate")
        assert r.status_code == 200, r.text
        new_url = r.json()["joinUrl"]
        new_tok = new_url.rsplit("/join/", 1)[1]
        assert new_tok != old_tok and r.json()["joinLinkExpiresAt"] == old_expiry
        err(Actor().req("GET", app_url, f"/api/join/{old_tok}"), 410, "link_revoked")
        assert Actor().req("GET", app_url, f"/api/join/{new_tok}").status_code == 200
        for base in (app_url, replica()):
            err(p1.req("GET", base, f"/api/workshops/{w['id']}/board"), 401, "session_ended")
        rejoin, info_new = join(app_url, new_tok, actor=p1)
        assert info_new["id"] != info1["id"]
        stream = Stream(rejoin, replica(), w["id"])
        try:
            t0 = time.monotonic()
            assert fac.req("DELETE", app_url, f"/api/workshops/{w['id']}/join-link").json() == {"joinUrl": None}
            ended = stream.wait("ended")
            assert ended and ended[0]["at"] - t0 <= ENDED_SECONDS
        finally:
            stream.close()
        err(rejoin.req("GET", app_url, f"/api/workshops/{w['id']}/board"), 401, "session_ended")
        err(Actor().req("POST", app_url, f"/api/join/{new_tok}", {"displayName": "Late"}), 410, "link_revoked")
        ws_now = get_ws(fac, app_url, w["id"])
        assert ws_now["joinUrl"] is None and ws_now["participantCount"] == 0


def test_link_expiry_dst(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac, start=START, end=END) as w:
        assert w["joinLinkExpiresAt"] == END_EXPIRY
    with workshop(app_url, fac, start="2027-10-31T00:30", end=OVERLAP_END) as w:
        assert w["joinLinkExpiresAt"] == OVERLAP_EXPIRY
        r = fac.req("POST", app_url, f"/api/workshops/{w['id']}/join-link/rotate")
        assert r.json()["joinLinkExpiresAt"] == OVERLAP_EXPIRY
    gap = gap_message(JUNO_ZONE)
    cases = [("2027-03-28T01:30", "2027-03-28T03:00", "scheduledStart", gap),
             ("2027-03-28T00:30", "2027-03-28T01:15", "scheduledEnd", gap),
             (OVERLAP_END, OVERLAP_END, "scheduledEnd", "The end must be after the start"),
             ("2027-10-31T01:45", "2027-10-31T01:15", "scheduledEnd", "The end must be after the start"),
             ("2027-03-27 09:00", END, "scheduledStart", "Enter a date and time as YYYY-MM-DDTHH:MM")]
    for start, end, field, message in cases:
        e = err(create_workshop(fac, app_url, start=start, end=end), 422, "validation")
        assert e["fields"][field] == message
    e = err(create_workshop(sign_in(app_url, ODILE), app_url, start="2027-03-14T02:30", end="2027-03-14T04:00"),
            422, "validation")
    assert e["fields"]["scheduledStart"] == gap_message(ODILE_ZONE)
    with workshop(app_url, fac) as probe:
        now = server_now(fac, app_url, probe["id"])
    lisbon = ZoneInfo(JUNO_ZONE)
    local = (now - timedelta(seconds=GRACE_SECONDS - 15)).astimezone(lisbon)
    local = (local + timedelta(minutes=1)).replace(second=0, microsecond=0)
    end_wall = local.strftime("%Y-%m-%dT%H:%M")
    start_wall = (local - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
    expected = local.astimezone(timezone.utc) + timedelta(seconds=GRACE_SECONDS)
    with workshop(app_url, fac, start=start_wall, end=end_wall) as w:
        assert w["joinLinkExpiresAt"] == iso(expected)
        walk_to(fac, app_url, w["id"], "open")
        p, _ = join(app_url, w)
        assert Actor().req("GET", app_url, f"/api/join/{token_of(w)}").status_code == 200
        gone = eventually(lambda: Actor().req("GET", app_url, f"/api/join/{token_of(w)}").status_code == 410,
                          EXPIRY_WAIT)
        assert gone
        err(Actor().req("GET", app_url, f"/api/join/{token_of(w)}"), 410, "link_expired")
        assert server_now(fac, app_url, w["id"]) >= expected
        err(p.req("GET", replica(), f"/api/workshops/{w['id']}/board"), 401, "session_ended")


def test_wf_join_link_dst_schedule(browser, app_url):
    fac = sign_in(app_url)
    title = f"{TITLE_BASE} {tag()}"
    with room(browser, app_url, fac, "/workshops") as page:
        ui(page, lambda: shows(page.get_by_role("button", name="New workshop")))
        click(page.get_by_role("button", name="New workshop"))
        dlg = page.get_by_role("dialog", name="New workshop")
        fill(dlg.get_by_role("textbox", name="Title"), title)
        check(dlg.get_by_role("radio", name="Blank"))
        fill(dlg.get_by_label("Starts", exact=True), "2027-03-28T01:30")
        fill(dlg.get_by_label("Ends", exact=True), "2027-03-28T03:00")
        fill(dlg.get_by_role("textbox", name="Sponsor email"), address("sponsor"))
        click(dlg.get_by_role("button", name="Create workshop"))
        ui(page, lambda: gap_message(JUNO_ZONE) in dlg.inner_text())
        assert all(x["title"] != title for x in fac.req("GET", app_url, "/api/workshops").json()["workshops"])
        fill(dlg.get_by_label("Starts", exact=True), "2027-10-31T00:30")
        fill(dlg.get_by_label("Ends", exact=True), OVERLAP_END)
        click(dlg.get_by_role("button", name="Create workshop"))
        ui(page, lambda: "/w/" in page.url)
        wid = re.split(r"[?#/]", page.url.split("/w/", 1)[1])[0]
        try:
            w = get_ws(fac, app_url, wid)
            assert w["joinLinkExpiresAt"] == OVERLAP_EXPIRY
            ui(page, lambda: w["joinUrl"] in drawer(page).inner_text(), what="join link in drawer")
        finally:
            retire(fac, app_url, wid)


def test_room_capacity_concurrent(app_url):
    fac = sign_in(app_url, ODILE)
    b = billing(fac, app_url)
    assert b["plan"] == "free"
    cap = ENTITLEMENTS["free"]["participantsPerWorkshop"]
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        admitted = [join(app_url, w)[0] for _ in range(cap - 2)]
        tok = token_of(w)
        probe = patient(lambda: Actor().req("POST", app_url, f"/api/join/{tok}", {"displayName": "Counter"}))
        assert probe.status_code == 201
        if int(probe.headers["RateLimit-Remaining"]) < 6:
            wait_seconds(int(probe.headers["RateLimit-Reset"]))
        bases = [app_url, replica()]
        rs = parallel([lambda i=i: Actor().req("POST", bases[i % 2], f"/api/join/{tok}",
                                               {"displayName": f"Racer {i}"}) for i in range(6)])
        assert sorted(r.status_code for r in rs) == [201] + [409] * 5
        for r in rs:
            if r.status_code == 409:
                assert err(r, 409, "room_full")["message"] == "This room is full"
        assert get_ws(fac, app_url, w["id"])["participantCount"] == cap
        again = patient(lambda: admitted[0].req("POST", app_url, f"/api/join/{tok}", {"displayName": "Again"}))
        assert again.status_code == 200
        err(patient(lambda: Actor().req("POST", app_url, f"/api/join/{tok}", {"displayName": "Extra"})),
            409, "room_full")
        assert fac.req("POST", app_url, f"/api/workshops/{w['id']}/join-link/rotate").status_code == 200
        w = get_ws(fac, app_url, w["id"])
        assert w["participantCount"] == 0
        join(app_url, w)
        assert get_ws(fac, app_url, w["id"])["participantCount"] == 1


def test_invite_batches_headers(app_url, mail):
    fac = sign_in(app_url)
    title = f"{TITLE_BASE} {tag()}"
    e1, e2 = address("client"), address("client")
    with workshop(app_url, fac, title=title) as w:
        path = f"/api/workshops/{w['id']}/invites"
        used0 = billing(fac, app_url)["usage"]["invitesToday"]
        v0 = get_ws(fac, app_url, w["id"])["version"]
        for entry in (f'"Ada Client" <{e2}>', f"{e2}\r\nBcc: {address('smuggled')}", f"{e1}, {e2}", f"{e1};{e2}"):
            e = err(fac.req("POST", app_url, path, {"emails": [e1, entry]}), 422, "validation")
            assert e["fields"]["emails"] == "Every entry must be an email address"
        for batch in ([], [address("bulk") for _ in range(MAX_BATCH + 1)]):
            e = err(fac.req("POST", app_url, path, {"emails": batch}), 422, "validation")
            assert e["fields"]["emails"] == "Send between 1 and 30 addresses at a time"
        assert billing(fac, app_url)["usage"]["invitesToday"] == used0
        assert get_ws(fac, app_url, w["id"])["version"] == v0
        assert not mails_for(mail, e1) and not mails_for(mail, e2)
        rotated = fac.req("POST", app_url, f"/api/workshops/{w['id']}/join-link/rotate").json()["joinUrl"]
        r = fac.req("POST", app_url, path, {"emails": [e1.upper(), f"  {e1}  ", e2]})
        assert r.status_code == 202, r.text
        assert [i["email"] for i in r.json()["invites"]] == [e1, e2]
        for addr in (e1, e2):
            msgs = wait_mails(mail, addr, 1, "You're invited")
            assert len(msgs) == 1
            m = msgs[0]
            single_recipient(m, addr)
            assert m["Subject"] == f"You're invited: {title}"
            assert rotated in text(m) and w["joinUrl"] not in text(m) and JUNO_ZONE in text(m)
            assert rotated in m.get("HTML", "") and JUNO_ZONE in m.get("HTML", "")
        assert billing(fac, app_url)["usage"]["invitesToday"] == used0 + 2
        assert fac.req("POST", app_url, path, {"emails": [e1]}).status_code == 202
        assert len(wait_mails(mail, e1, 2, "You're invited")) == 2
        invites = get_ws(fac, app_url, w["id"])["invites"]
        assert sorted(i["email"] for i in invites) == sorted([e1, e2])
    for bad in ("Line\nbreak", "Tab\tinside", "Para\u2028graph"):
        e = err(create_workshop(fac, app_url, title=bad), 422, "validation")
        assert e["fields"]["title"] == "Titles can't contain line breaks or control characters"


def test_wf_invites_paste_and_send(browser, app_url, mail):
    fac = sign_in(app_url)
    title = f"{TITLE_BASE} {tag()}"
    e1, e2 = address("client"), address("client")
    with workshop(app_url, fac, title=title) as w:
        with room(browser, app_url, fac, f"/w/{w['id']}") as page:
            wait_board(page)
            box = drawer(page).get_by_role("textbox", name="Client emails")
            fill(box, f'{e1}\n"Bram Client" <{e2}>')
            click(drawer(page).get_by_role("button", name="Send invites"))
            ui(page, lambda: "Every entry must be an email address" in drawer(page).inner_text())
            assert not mails_for(mail, e1) and not mails_for(mail, e2)
            fill(box, f"{e1}\n{e1.upper()}\n{e2}")
            click(drawer(page).get_by_role("button", name="Send invites"))
            ui(page, lambda: says(status_of(page), f"Invites sent to {2} people"))
            invites = drawer(page).get_by_role("list", name="Invites")
            ui(page, lambda: f"{e1} — sent" in invites.inner_text(), seconds=MAIL_WAIT)
        for addr in (e1, e2):
            msgs = wait_mails(mail, addr, 1, "You're invited")
            assert len(msgs) == 1 and msgs[0]["Subject"] == f"You're invited: {title}"
            single_recipient(msgs[0], addr)


def test_wf_invites_mail_outage(browser, app_url, mail):
    down = env_url("APP_MAILPIT_DOWN_URL")
    fac = sign_in(down)
    made, observed = [], None
    try:
        for _ in range(OUTAGE_TRIES):
            e1 = address("client")
            w = new_workshop(fac, down)
            made.append(w)
            with room(browser, down, fac, f"/w/{w['id']}") as page:
                wait_board(page)
                fill(drawer(page).get_by_role("textbox", name="Client emails"), e1)
                click(drawer(page).get_by_role("button", name="Send invites"))
                ui(page, lambda: says(status_of(page),
                                      f"{0} sent, {1} queued — email is unavailable. "
                                      "Queued invites go out automatically."))
            still = get_ws(fac, down, w["id"])["invites"]
            if still != [{"email": e1, "status": "queued"}]:
                continue
            observed = (w, e1)
            break
        assert observed, "every invite was sent before its queued state could be observed"
        w, e1 = observed
        msgs = wait_mails(mail, e1, 1, "You're invited")
        assert len(msgs) == 1
        single_recipient(msgs[0], e1)
        assert eventually(lambda: get_ws(fac, app_url, w["id"])["invites"] == [{"email": e1, "status": "sent"}],
                          MAIL_WAIT)
    finally:
        for x in made:
            retire(fac, down, x["id"])


def test_invite_quota_local_day(app_url, mail):
    fac = sign_in(app_url, ODILE)
    limit = ENTITLEMENTS["free"]["invitesPerDay"]
    with workshop(app_url, fac) as w:
        path = f"/api/workshops/{w['id']}/invites"
        b = billing(fac, app_url)
        assert b["plan"] == "free" and b["entitlements"]["invitesPerDay"] == limit
        used = b["usage"]["invitesToday"]
        left = limit - used
        over = [address("quota") for _ in range(left + 1)]
        r = fac.req("POST", app_url, path, {"emails": over})
        e = err(r, 429, "quota_exceeded")
        assert (e["limit"], e["used"], e["plan"]) == (limit, used, "free")
        served = email.utils.parsedate_to_datetime(r.headers["date"])
        local = served.astimezone(ZoneInfo(ODILE_ZONE))
        midnight = datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), ZoneInfo(ODILE_ZONE))
        expected = math.ceil((midnight - served).total_seconds())
        assert abs(int(r.headers["Retry-After"]) - expected) <= 1
        assert billing(fac, app_url)["usage"]["invitesToday"] == used
        assert not mails_for(mail, over[0])
        if left > 0:
            batches = [[address("race") for _ in range(left)] for _ in range(2)]
            bases = [app_url, replica()]
            rs = parallel([lambda i=i: fac.req("POST", bases[i], path, {"emails": batches[i]}) for i in range(2)])
            assert sorted(x.status_code for x in rs) == [202, 429]
            winner = batches[[x.status_code for x in rs].index(202)]
            assert billing(fac, app_url)["usage"]["invitesToday"] == limit
            assert len(wait_mails(mail, winner[0], 1, "You're invited")) == 1
        err(fac.req("POST", app_url, path, {"emails": [address("quota")]}), 429, "quota_exceeded")


def test_silent_round_projection(app_url):
    fac = sign_in(app_url)
    secret = f"Secret idea {tag()}"
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p1, i1 = join(app_url, w, f"Author {tag()}")
        p2, _ = join(app_url, w)
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        b = board(fac, app_url, w["id"])
        mk_cluster(fac, app_url, w["id"], fid(b, "Problems"), "Early")
        f1 = mk_note(fac, app_url, w["id"], fid(b, "Questions"), "fac a")
        f2 = mk_note(fac, app_url, w["id"], fid(b, "Questions"), "fac b", 200, 40)
        assert connect(fac, app_url, w["id"], f1["id"], f2["id"]).status_code == 201
        s2 = Stream(p2, app_url, w["id"])
        try:
            n = mk_note(p1, app_url, w["id"], fid(b, "Problems"), secret)
            assert n["revealed"] is False
            events = s2.wait("board")
            assert events and all(set(json.loads(e["data"])) == {"version"} for e in s2.of("board"))
            assert all(secret not in e["data"] for e in s2.events)
        finally:
            s2.close()
        r2 = p2.req("GET", app_url, f"/api/workshops/{w['id']}/board")
        raw = r2.text
        for leak in (secret, i1["displayName"], w["sponsorEmail"], token_of(w)):
            assert leak not in raw
        pb = r2.json()
        assert set(pb) == BOARD_P_KEYS and set(pb["workshop"]) == P_WORKSHOP_KEYS
        assert set(pb["viewer"]) == {"role", "participantId", "displayName", "dotsRemaining"}
        assert pb["viewer"]["dotsRemaining"] is None
        assert all(set(f) == FRAME_KEYS for f in pb["frames"]) and all(set(c) == P_CLUSTER_KEYS for c in pb["clusters"])
        hidden = next(x for x in pb["notes"] if x["id"] == n["id"])
        assert set(hidden) == HIDDEN_P_KEYS and hidden["revealed"] is False and hidden["mine"] is False
        assert all(set(x) == P_NOTE_KEYS for x in pb["notes"] if x["id"] in (f1["id"], f2["id"]))
        assert all(set(c) == {"id", "fromNoteId", "toNoteId"} for c in pb["connectors"])
        own = next(x for x in board(p1, app_url, w["id"])["notes"] if x["id"] == n["id"])
        assert set(own) == P_NOTE_KEYS | {"authorName"} and own["text"] == secret
        fb = board(fac, app_url, w["id"])
        assert set(fb) == BOARD_P_KEYS | {"participants"} and set(fb["workshop"]) == FAC_WORKSHOP_KEYS
        assert set(fb["viewer"]) == {"role", "name"}
        fh = next(x for x in fb["notes"] if x["id"] == n["id"])
        assert set(fh) == HIDDEN_F_KEYS and fh["authorName"] == i1["displayName"]
        assert all(set(c) == F_CLUSTER_KEYS for c in fb["clusters"])
        row = next(x for x in fb["participants"] if x["id"] == i1["id"])
        assert set(row) == {"id", "displayName", "notesThisRound", "active"} and row["notesThisRound"] == 1
        assert secret not in json.dumps(fb)


def test_deadline_server_side(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p, _ = join(app_url, w)
        assert move(fac, app_url, w["id"], "silent_round", SHORT_SECONDS).status_code == 200
        ws_ = get_ws(fac, app_url, w["id"])
        b = board(p, app_url, w["id"])
        own = mk_note(p, app_url, w["id"], fid(b, "Problems"), "in time")
        wait_server_past(p, app_url, w["id"], parse_iso(ws_["round"]["endsAt"]))
        e = err(note_req(p, app_url, w["id"], fid(b, "Problems"), "too late"), 409, "deadline_passed")
        assert e["message"] == "Time is up for this round"
        err(patch_note(p, replica(), own["id"], text="edited late"), 409, "deadline_passed")
        assert get_ws(fac, app_url, w["id"])["status"] == "silent_round"
        assert move(fac, app_url, w["id"], "revealed").status_code == 200
        cl = mk_cluster(fac, app_url, w["id"], fid(b, "Problems"), "Vote")
        assert move(fac, app_url, w["id"], "voting", SHORT_SECONDS, DOTS).status_code == 200
        ends = parse_iso(get_ws(fac, app_url, w["id"])["voting"]["endsAt"])
        assert spend(p, app_url, cl["id"]).status_code == 201
        wait_server_past(p, app_url, w["id"], ends)
        err(spend(p, app_url, cl["id"]), 409, "deadline_passed")
        err(give_back(p, app_url, cl["id"]), 409, "deadline_passed")
        assert get_ws(fac, app_url, w["id"])["status"] == "voting"


def test_wf_silent_round_double_save(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p, _ = join(app_url, w)
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        prob = fid(board(p, app_url, w["id"]), "Problems")
        replayed = seeded(0)
        body = {"clientOpId": op(), "frameId": prob, "kind": "text", "text": replayed, "x": 10, "y": 10}
        r1 = p.req("POST", app_url, f"/api/workshops/{w['id']}/notes", body)
        r2 = p.req("POST", replica(), f"/api/workshops/{w['id']}/notes", body)
        assert r1.status_code == r2.status_code == 201 and r1.text == r2.text

        def count(value):
            return sum(n.get("text") == value for n in board(p, app_url, w["id"])["notes"])

        assert count(replayed) == 1
        with room(browser, app_url, p, f"/w/{w['id']}") as page:
            wait_board(page)
            double = f"double {tag()}"
            with held(page, "**/api/workshops/*/notes") as hold:
                ui_add_note(page, "Problems", double)
                ui(page, lambda: shows(page.get_by_text("Saving…")), what="saving tag")
                save = page.get_by_role("button", name="Save note")
                if shows(save):
                    click(save)
                hold.release()
            ui(page, lambda: shows(page.get_by_role("button", name=f"Your note: {double}")))
            assert eventually(lambda: count(double) == 1, EVENT_WAIT)
            retried, bodies = f"retried {tag()}", []

            def flaky(route):
                bodies.append(route.request.post_data_json)
                if len(bodies) == 1:
                    route.abort("internetdisconnected")
                else:
                    route.continue_()

            page.route("**/api/workshops/*/notes", flaky)
            ui_add_note(page, "Problems", retried)
            ui(page, lambda: says(problems_of(page), "Couldn't reach the board — retrying your note."))
            ui(page, lambda: count(retried) == 1, what="retried note stored")
            assert len(bodies) >= 2 and len({b["clientOpId"] for b in bodies}) == 1
            assert count(retried) == 1


def test_wf_silent_round_brainstorm(browser, app_url):
    fac = sign_in(app_url)
    name = f"Mira {tag()}"
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p2, i2 = join(app_url, w, f"Other {tag()}")
        with room(browser, app_url, fac, f"/w/{w['id']}") as fpage, \
                room(browser, app_url, None, f"/join/{token_of(w)}") as page:
            fill(page.get_by_role("textbox", name="Your name"), name)
            click(page.get_by_role("button", name="Join workshop"))
            wait_board(page)
            wait_board(fpage)
            fill(drawer(fpage).get_by_role("spinbutton", name="Round length in minutes"), "5")
            click(drawer(fpage).get_by_role("button", name="Start silent round"))
            ui(fpage, lambda: says(status_of(fpage), "Silent round started — ends at "))
            timer = page.get_by_role("timer", name="Session timer")
            ui(page, lambda: re.fullmatch(r"\d\d:\d\d", timer.inner_text().strip()) is not None)
            t1 = timer.inner_text().strip()
            assert t1 <= f"{ROUND_SECONDS // 60:02d}:00"
            advance(page, 2000)
            ui(page, lambda: timer.inner_text().strip() < t1, what="timer counts down")
            mine = [f"mine {i} {tag()}" for i in range(3)]
            for value in mine:
                ui_add_note(page, "Problems", value)
                ui(page, lambda v=value: shows(page.get_by_role("button", name=f"Your note: {v}")))
            ui(page, lambda: says(status_of(page), note_added("Problems")))
            prob = fid(board(p2, app_url, w["id"]), "Problems")
            theirs = [f"theirs {i} {tag()}" for i in range(2)]
            mk_note(p2, app_url, w["id"], prob, theirs[0], 60, 60)
            area = region(page, "Problems")
            ui(page, lambda: f"{frame_of(board(fac, app_url, w['id']), 'Problems')['hiddenCount']} hidden"
               in area.inner_text())
            before = frame_of(board(fac, app_url, w["id"]), "Problems")["hiddenCount"]
            mk_note(p2, app_url, w["id"], prob, theirs[1], 600, 400)
            ui(page, lambda: f"{before + 1} hidden" in area.inner_text(), what="hidden counter rises")
            backs = area.get_by_role("button", name="Hidden note", exact=True)
            ui(page, lambda: backs.count() == 2)
            box = area.bounding_box()
            xs = []
            for i in range(2):
                assert backs.nth(i).evaluate(NO_TEXT_JS)
                bb = backs.nth(i).bounding_box()
                assert box["x"] <= bb["x"] and bb["x"] + bb["width"] <= box["x"] + box["width"]
                xs.append(bb["x"])
            assert xs[0] != xs[1]
            assert all(t not in page.content() for t in theirs)
        pb = board(p2, app_url, w["id"])
        assert sum(1 for n in pb["notes"] if not n["mine"] and not n["revealed"]) == 3


def test_card_backs_dom(browser, app_url):
    fac = sign_in(app_url)
    secret = f"Secret back {tag()}"
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p1, _ = join(app_url, w)
        p2, i2 = join(app_url, w, f"Writer {tag()}")
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        mk_note(p2, app_url, w["id"], prob, secret + " a", 60, 60)
        mk_note(p2, app_url, w["id"], prob, secret + " b", 600, 400)
        with room(browser, app_url, p1, f"/w/{w['id']}") as page, \
                room(browser, app_url, fac, f"/w/{w['id']}") as fpage:
            wait_board(page)
            backs = region(page, "Problems").get_by_role("button", name="Hidden note", exact=True)
            ui(page, lambda: backs.count() == 2, what="two card backs")
            boxes = sorted((backs.nth(i).bounding_box() for i in range(2)), key=lambda bb: bb["x"])
            assert boxes[1]["x"] > boxes[0]["x"] and boxes[1]["y"] > boxes[0]["y"]
            assert all(backs.nth(i).evaluate(NO_TEXT_JS) for i in range(2))
            assert secret not in page.content() and i2["displayName"] not in page.content()
            wait_board(fpage)
            fbacks = region(fpage, "Problems").get_by_role("button", name=f"Hidden note by {i2['displayName']}")
            ui(fpage, lambda: fbacks.count() == 2, what="facilitator card backs")
            assert all(i2["displayName"] in fbacks.nth(i).inner_text() for i in range(2))
            assert secret not in fpage.content()


def test_presence_cursors(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p1, _ = join(app_url, w)
        p2, i2 = join(app_url, w, f"Cursor {tag()}")
        fs, s1, s2 = Stream(fac, replica(), w["id"]), Stream(p1, app_url, w["id"]), Stream(p2, app_url, w["id"])
        try:
            t0 = time.monotonic()
            assert p2.req("POST", app_url, f"/api/workshops/{w['id']}/presence", {"x": 10, "y": 20}).status_code == 204
            got_f, got_1 = fs.wait("presence"), s1.wait("presence")
            assert got_f and got_1 and got_1[0]["at"] - t0 <= PRESENCE_SECONDS + POLL
            df, d1 = json.loads(got_f[0]["data"]), json.loads(got_1[0]["data"])
            assert set(d1) == {"cursorId", "hue", "x", "y"} and set(df) == {"cursorId", "hue", "x", "y", "name"}
            assert df["name"] == i2["displayName"] and d1["cursorId"] != i2["id"]
            assert isinstance(d1["hue"], int) and 0 <= d1["hue"] <= 359 and (d1["x"], d1["y"]) == (10, 20)
            assert p2.req("POST", replica(), f"/api/workshops/{w['id']}/presence", {"x": 30, "y": 40}).status_code == 204
            again = s1.wait("presence", lambda e: json.loads(e["data"])["x"] == 30)
            assert again and json.loads(again[0]["data"])["cursorId"] == d1["cursorId"]
            assert not s2.of("presence")
            assert move(fac, app_url, w["id"], "silent_round").status_code == 200
            count_1 = len(s1.of("presence"))
            assert p2.req("POST", app_url, f"/api/workshops/{w['id']}/presence", {"x": 50, "y": 60}).status_code == 204
            assert fs.wait("presence", lambda e: json.loads(e["data"])["x"] == 50)
            assert not eventually(lambda: len(s1.of("presence")) > count_1, LIVE_SECONDS)
        finally:
            for s in (fs, s1, s2):
                s.close()


def test_reveal_releases_racing_notes(app_url):
    fac = sign_in(app_url)
    bases = [app_url, replica()]
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        (p1, i1), (p2, i2) = join(app_url, w), join(app_url, w)
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        for p in (p1, p2):
            mk_note(p, app_url, w["id"], prob, f"early {tag()}")
        jobs = [lambda i=i: note_req((p1, p2)[i % 2], bases[i % 2], w["id"], prob, f"race {i} {tag()}", 20 * i, 20)
                for i in range(10)]
        jobs.insert(5, lambda: move(fac, app_url, w["id"], "revealed"))
        rs = parallel(jobs)
        assert all(r.status_code in (200, 201) for r in rs), [r.text for r in rs if r.status_code >= 300]
        fb = board(fac, app_url, w["id"])
        assert fb["workshop"]["status"] == "revealed" and len(fb["notes"]) == 12
        assert all(n["revealed"] for n in fb["notes"]) and all(f["hiddenCount"] == 0 for f in fb["frames"])
        assert all(n["authorName"] in (i1["displayName"], i2["displayName"]) for n in fb["notes"])
        for viewer, me in ((p1, i1), (p2, i2)):
            vb = board(viewer, replica(), w["id"])
            assert all(f["hiddenCount"] == 0 for f in vb["frames"])
            for n in vb["notes"]:
                assert n["revealed"] and n["text"]
                if n["mine"]:
                    assert n["authorName"] == me["displayName"]
                else:
                    assert "authorName" not in n
        late = mk_note(p1, app_url, w["id"], prob, "after reveal")
        assert late["revealed"] is True


def reveal_scene(app_url, fac, w, positions):
    walk_to(fac, app_url, w["id"], "open")
    viewer, _ = join(app_url, w)
    writer, _ = join(app_url, w)
    assert move(fac, app_url, w["id"], "silent_round").status_code == 200
    b = board(fac, app_url, w["id"])
    texts = [f"wave {i} {tag()}" for i in range(len(positions))]
    for value, (x, y) in zip(texts, positions):
        mk_note(writer, app_url, w["id"], fid(b, "Problems"), value, x, y)
    return viewer, writer, texts, b


def test_wf_reveal_wave(browser, app_url):
    fac = sign_in(app_url)
    positions = [(40, 40), (380, 280), (700, 520), (200, 450), (600, 100)]
    with workshop(app_url, fac) as w:
        viewer, _, texts, _ = reveal_scene(app_url, fac, w, positions)
        with room(browser, app_url, viewer, f"/w/{w['id']}", hook=True) as page, \
                room(browser, app_url, fac, f"/w/{w['id']}") as fpage:
            wait_board(page)
            area = region(page, "Problems")
            backs = area.get_by_role("button", name="Hidden note", exact=True)
            ui(page, lambda: backs.count() == len(positions))
            rbox = area.bounding_box()
            cx, cy = rbox["x"] + rbox["width"] / 2, rbox["y"] + rbox["height"] / 2
            cards = [center(backs.nth(i)) for i in range(len(positions))]
            start = mark(page)
            wait_board(fpage)
            click(drawer(fpage).get_by_role("button", name="Reveal"))
            ui(page, lambda: backs.count() == 0 and f"{len(positions)} notes" in area.inner_text(), what="revealed")
            per: dict[int, list] = {}
            for a in anims_since(page, start):
                if not flips(a) or not inside(rbox, a):
                    continue
                k = min(range(len(cards)), key=lambda i: (cards[i][0] - a["x"]) ** 2 + (cards[i][1] - a["y"]) ** 2)
                per.setdefault(k, []).append(a)
            assert set(per) == set(range(len(cards))), "every card back flips"
            for group in per.values():
                assert all(0 < a["duration"] <= FLIP_MS for a in group)
            starts = {k: min(start_of(a) for a in g) for k, g in per.items()}
            ends = {k: max(start_of(a) + a["duration"] for a in g) for k, g in per.items()}
            dist = {k: math.hypot(cards[k][0] - cx, cards[k][1] - cy) for k in per}
            for i in per:
                for j in per:
                    if dist[j] - dist[i] > 1:
                        assert starts[i] <= starts[j] + RANK_SLACK_MS
            first = min(starts.values())
            assert RANK_GAP_MS - RANK_SLACK_MS <= max(starts.values()) - first <= LAST_RANK_MS + RANK_SLACK_MS
            assert max(ends.values()) - first <= WAVE_MS + RANK_SLACK_MS
            for value in texts:
                assert shows(area.get_by_role("button", name=f"Note: {value}"))
        assert all(n["text"] for n in board(viewer, app_url, w["id"])["notes"])


def test_wf_reveal_reduced_motion(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        viewer, _, texts, b = reveal_scene(app_url, fac, w, [(40, 40), (300, 200), (600, 400)])
        mk_note(viewer, app_url, w["id"], fid(b, "Questions"), f"own {tag()}")
        with room(browser, app_url, viewer, f"/w/{w['id']}", reduced="reduce", hook=True) as page, \
                room(browser, app_url, fac, f"/w/{w['id']}") as fpage:
            wait_board(page)
            area = region(page, "Problems")
            ui(page, lambda: area.get_by_role("button", name="Hidden note", exact=True).count() == 3)
            record_status(page)
            start = mark(page)
            wait_board(fpage)
            click(drawer(fpage).get_by_role("button", name="Reveal"))
            ui(page, lambda: announced(page, revealed_msg(1, "Questions")) == 1, what="announcements")
            advance(page, 2000)
            assert announced(page, revealed_msg(3, "Problems")) == 1
            assert announced(page, revealed_msg(1, "Questions")) == 1
            assert first_announced(page, f"in {'Problems'} frame") < first_announced(page, f"in {'Questions'} frame")
            assert announced(page, f"in {'Opportunities'} frame") == 0
            heading = area.get_by_role("heading", level=2, name="Problems")
            ui(page, lambda: heading.evaluate(IS_FOCUSED_JS), what="focus on Problems heading")
            rbox = area.bounding_box()
            fades = [a for a in anims_since(page, start) if inside(rbox, a)]
            assert not any(flips(a) for a in fades)
            assert any(a.get("fade") for a in fades)
            assert all(a["duration"] <= CROSSFADE_MS for a in fades if a.get("fade"))
            assert all(shows(area.get_by_role("button", name=f"Note: {v}")) for v in texts)


def test_wf_reveal_dropped_connection(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        viewer, _, texts, _ = reveal_scene(app_url, fac, w, [(40, 40), (400, 300), (700, 500)])
        with room(browser, app_url, viewer, f"/w/{w['id']}", hook=True) as page:
            wait_board(page)
            area = region(page, "Problems")
            ui(page, lambda: area.get_by_role("button", name="Hidden note", exact=True).count() == 3)
            record_status(page)
            page.context.set_offline(True)
            ui(page, lambda: "Reconnecting to the board…" in page.content(), what="drop noticed")
            assert move(fac, app_url, w["id"], "revealed").status_code == 200
            start = mark(page)
            page.context.set_offline(False)
            ui(page, lambda: announced(page, revealed_msg(3, "Problems")) >= 1, what="catch-up")
            advance(page, 2000)
            assert announced(page, "Back online") == 1
            assert announced(page, revealed_msg(3, "Problems")) == 1
            assert first_announced(page, "Back online") < first_announced(page, "Round revealed")
            assert any(flips(a) for a in anims_since(page, start))
        with room(browser, app_url, viewer, f"/w/{w['id']}", hook=True) as fresh:
            wait_board(fresh)
            record_status(fresh)
            ui(fresh, lambda: shows(region(fresh, "Problems").get_by_role("button", name=f"Note: {texts[0]}")))
            advance(fresh, 2000)
            assert "Round revealed" not in status_of(fresh).inner_text()
            assert announced(fresh, "Round revealed") == 0
            rbox = region(fresh, "Problems").bounding_box()
            assert not [a for a in anims_since(fresh, 0) if flips(a) and inside(rbox, a)]


def test_image_upload_validation(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        (p1, _), (p2, _) = join(app_url, w), join(app_url, w)
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        err(upload(p1, app_url, w["id"], b"\x89PNG\r\n\x1a\n" + b"\x00" * (IMAGE_LIMIT - 7)), 413, "too_large")
        err(upload(p1, app_url, w["id"], png(), "image/gif"), 415, "unsupported_media_type")
        err(upload(p1, app_url, w["id"], png(), "image/jpeg"), 415, "unsupported_media_type")
        err(upload(p1, app_url, w["id"], b"plain text, not an image", "image/png"), 415, "unsupported_media_type")
        e = err(upload(p1, app_url, w["id"], png(IMAGE_SIDE + 1, 1)), 422, "validation")
        assert e["fields"]["image"] == "Images must be at most 8,000 pixels on each side"
        big = upload(p1, app_url, w["id"], png(IMAGE_SIDE, 1))
        assert big.status_code == 201 and (big.json()["width"], big.json()["height"]) == (IMAGE_SIDE, 1)
        r = upload(p1, app_url, w["id"], png(3, 2, meta=True))
        assert r.status_code == 201 and (r.json()["width"], r.json()["height"]) == (3, 2)
        image_id = r.json()["imageId"]
        stored = S3().get(f"workshops/{w['id']}/images/{image_id}")
        assert stored.startswith(b"\x89PNG") and not {b"tEXt", b"eXIf", b"zTXt", b"iTXt"} & set(png_chunks(stored))
        prob = fid(board(p1, app_url, w["id"]), "Problems")
        e = err(p2.req("POST", app_url, f"/api/workshops/{w['id']}/notes",
                       {"clientOpId": op(), "frameId": prob, "kind": "image", "imageId": image_id, "x": 1, "y": 1}),
                422, "validation")
        assert e["fields"]["imageId"] == "Upload the image again"
        n = p1.req("POST", app_url, f"/api/workshops/{w['id']}/notes",
                   {"clientOpId": op(), "frameId": prob, "kind": "image", "imageId": image_id, "x": 1, "y": 1})
        assert n.status_code == 201, n.text
        note = n.json()["note"]
        assert note["imageUrl"] == f"/api/notes/{note['id']}/image" and note["text"] is None
        seen = next(x for x in board(p2, app_url, w["id"])["notes"] if x["id"] == note["id"])
        assert set(seen) == HIDDEN_P_KEYS
        err(p2.req("GET", app_url, note["imageUrl"]), 404, "not_found")
        own = p1.req("GET", app_url, note["imageUrl"])
        assert own.status_code == 200 and own.headers["content-type"].startswith("image/png")
        assert own.headers["x-content-type-options"] == "nosniff"
        assert own.headers["content-disposition"].startswith("inline")
        assert not {b"tEXt", b"eXIf"} & set(png_chunks(own.content))
        assert move(fac, app_url, w["id"], "revealed").status_code == 200
        assert p2.req("GET", replica(), note["imageUrl"]).content == own.content


def image_note(p, base, wid, frame_id):
    r = upload(p, base, wid)
    assert r.status_code == 201, r.text
    n = p.req("POST", base, f"/api/workshops/{wid}/notes",
              {"clientOpId": op(), "frameId": frame_id, "kind": "image", "imageId": r.json()["imageId"], "x": 5, "y": 5})
    assert n.status_code == 201, n.text
    return n.json()["note"], r.json()["imageId"]


def test_deleted_image_gone(app_url):
    fac = sign_in(app_url)
    down = env_url("APP_MINIO_DOWN_URL")
    with workshop(app_url, fac) as w:
        p, _, _, _, _ = revealed_board(app_url, fac, w)
        prob = fid(board(p, app_url, w["id"]), "Problems")
        for base in (app_url, down):
            note, image_id = image_note(p, app_url, w["id"], prob)
            key = f"workshops/{w['id']}/images/{image_id}"
            assert key in S3().keys(f"workshops/{w['id']}/images/")
            assert p.req("DELETE", base, f"/api/notes/{note['id']}").status_code == 204
            err(p.req("GET", base, note["imageUrl"]), 404, "not_found")
            seconds = EVENT_WAIT if base == app_url else MAIL_WAIT
            assert eventually(lambda: key not in S3().keys(f"workshops/{w['id']}/images/"), seconds)


def test_wf_image_notes_add_delete(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p, _, _, _, _ = revealed_board(app_url, fac, w)
        with room(browser, app_url, p, f"/w/{w['id']}") as page:
            wait_board(page)
            click(rail_button(page, "Problems"))
            with page.expect_file_chooser() as chooser:
                click(tool(page, "Add image"))
            chooser.value.set_files(files=[{"name": "whiteboard.png", "mimeType": "image/png",
                                            "buffer": png(4, 4, meta=True)}])
            note = page.get_by_role("button", name="Image note", exact=True)
            ui(page, lambda: shows(note), what="image note")
            images = eventually(lambda: [n for n in board(p, app_url, w["id"])["notes"] if n["kind"] == "image"],
                                EVENT_WAIT)
            assert images and len(images) == 1
            keys = S3().keys(f"workshops/{w['id']}/images/")
            assert len(keys) == 1
            assert not {b"tEXt", b"eXIf"} & set(png_chunks(S3().get(keys[0])))
            note.first.focus()
            page.keyboard.press("Delete")
            ui(page, lambda: note.count() == 0 and says(status_of(page), "Note deleted"))
        assert eventually(lambda: not [n for n in board(p, app_url, w["id"])["notes"] if n["kind"] == "image"],
                          EVENT_WAIT)
        err(p.req("GET", app_url, images[0]["imageUrl"]), 404, "not_found")
        assert eventually(lambda: not S3().keys(f"workshops/{w['id']}/images/"), EVENT_WAIT)


def test_wf_image_notes_storage_outage(browser, app_url):
    down = env_url("APP_MINIO_DOWN_URL")
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p, _, _, _, _ = revealed_board(app_url, fac, w)
        err(upload(p, down, w["id"]), 503, "storage_unavailable")
        with room(browser, down, p, f"/w/{w['id']}") as page:
            wait_board(page)
            click(rail_button(page, "Problems"))
            with page.expect_file_chooser() as chooser:
                click(tool(page, "Add image"))
            chooser.value.set_files(files=[{"name": "office.png", "mimeType": "image/png", "buffer": png()}])
            ui(page, lambda: says(problems_of(page),
                                  "Image storage is unavailable. Your image was not added — try again shortly."))
            value = f"still works {tag()}"
            ui_add_note(page, "Problems", value)
            ui(page, lambda: says(status_of(page), note_added("Problems")))
        notes = board(p, app_url, w["id"])["notes"]
        assert any(n["text"] == value for n in notes) and not any(n["kind"] == "image" for n in notes)
        assert not S3().keys(f"workshops/{w['id']}/images/")


def test_per_field_last_write_wins(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p1, _, p2, _, made = revealed_board(app_url, fac, w, (("Problems", "shared"), ("Problems", "two"),
                                                               ("Problems", "three")))
        nid = made[0]["id"]
        for i in range(3):
            retitle = seeded(i)
            rs = parallel([lambda i=i: patch_note(p1, app_url, nid, position={"x": 100 + i, "y": 200 + i}),
                           lambda t=retitle: patch_note(p2, replica(), nid, text=t)])
            assert [r.status_code for r in rs] == [200, 200]
            n = next(x for x in board(fac, app_url, w["id"])["notes"] if x["id"] == nid)
            assert (n["x"], n["y"], n["text"]) == (100 + i, 200 + i, retitle)
        earlier, later = seeded(5), seeded(6)
        assert patch_note(p1, app_url, nid, text=earlier).status_code == 200
        assert patch_note(p2, replica(), nid, text=later).status_code == 200
        assert next(x for x in board(p1, app_url, w["id"])["notes"] if x["id"] == nid)["text"] == later
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        c1, c2 = mk_cluster(fac, app_url, w["id"], prob, "One"), mk_cluster(fac, app_url, w["id"], prob, "Two", 600, 40)
        for n in made:
            assert place(fac, app_url, n["id"], prob, c1["id"]).status_code == 200
        rs = parallel([lambda: place(p1, app_url, nid, prob, c2["id"]),
                       lambda: place(p2, replica(), nid, prob, c1["id"], 2)])
        assert all(r.status_code == 200 for r in rs)
        fb = board(fac, app_url, w["id"])
        lists = [c["noteIds"] for c in fb["clusters"] if c["id"] in (c1["id"], c2["id"])]
        flat = [x for ids in lists for x in ids]
        assert sorted(flat) == sorted(n["id"] for n in made) and len(flat) == len(set(flat))


def test_live_updates_across_instances(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        p, _ = join(app_url, w)
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        fs, ps = Stream(fac, replica(), w["id"]), Stream(p, app_url, w["id"])
        try:
            for i, base in enumerate((app_url, replica(), app_url)):
                t0 = time.monotonic()
                mk_note(fac, base, w["id"], prob, f"live {i}", 20 * i, 20)
                version = get_ws(fac, app_url, w["id"])["version"]
                for s in (fs, ps):
                    got = s.wait("board", lambda e, v=version: int(e["id"]) == v)
                    assert got and got[0]["at"] - t0 <= LIVE_SECONDS + POLL
                    assert json.loads(got[0]["data"]) == {"version": version}
            for s in (fs, ps):
                ids = [int(e["id"]) for e in s.of("board")]
                assert ids == sorted(set(ids))
        finally:
            fs.close()
            ps.close()
        current = get_ws(fac, app_url, w["id"])["version"]
        behind = Stream(p, replica(), w["id"], last_id=current - 2)
        level = Stream(p, app_url, w["id"], last_id=current)
        try:
            first = behind.wait("board")
            assert first and int(first[0]["id"]) == current
            assert not eventually(lambda: level.of("board"), LIVE_SECONDS)
            mk_note(fac, app_url, w["id"], prob, "next")
            got = level.wait("board")
            assert got and int(got[0]["id"]) == current + 1
        finally:
            behind.close()
            level.close()


def test_wf_concurrent_edit_live_two_boards(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p1, _, p2, _, made = revealed_board(app_url, fac, w, (("Problems", f"drag me {tag()}"),))
        with room(browser, app_url, p1, f"/w/{w['id']}") as page, \
                room(browser, replica(), fac, f"/w/{w['id']}") as fpage:
            wait_board(page)
            wait_board(fpage)
            value = f"arrives live {tag()}"
            mk_note(p2, app_url, w["id"], fid(board(p2, app_url, w["id"]), "Problems"), value, 500, 300)
            for pg in (page, fpage):
                ui(pg, lambda pg=pg: shows(pg.get_by_role("button", name=f"Note: {value}")), what="live note")
            target = page.get_by_role("button", name=f"Note: {made[0]['text']}")
            far = fpage.get_by_role("button", name=f"Note: {made[0]['text']}")
            before = far.bounding_box()
            x, y = center(target)
            drag(page, target, x + 120, y + 80)
            ui(fpage, lambda: abs(far.bounding_box()["x"] - before["x"]) > 20, what="moved on the other board")
        n = next(x for x in board(fac, app_url, w["id"])["notes"] if x["id"] == made[0]["id"])
        assert (n["x"], n["y"]) != (made[0]["x"], made[0]["y"])


def test_wf_concurrent_edit_snap_back(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        value = f"anchored {tag()}"
        p, _, _, _, made = revealed_board(app_url, fac, w, (("Problems", value),))
        with room(browser, app_url, p, f"/w/{w['id']}") as page:
            wait_board(page)
            note = page.get_by_role("button", name=f"Note: {value}")
            ui(page, lambda: shows(note))
            rest = note.bounding_box()
            page.route("**/api/notes/*", lambda route: route.abort("internetdisconnected")
                       if route.request.method == "PATCH" else route.continue_())
            x, y = center(note)
            drag(page, note, x + 150, y + 90)
            ui(page, lambda: says(problems_of(page),
                                  f"Move not saved — {OFFLINE}. The note is back where everyone else sees it."))
            ui(page, lambda: abs(note.bounding_box()["x"] - rest["x"]) <= SNAP_PX
               and abs(note.bounding_box()["y"] - rest["y"]) <= SNAP_PX, what="snap back")
            note.focus()
            page.keyboard.press("Enter")
            box = page.get_by_role("textbox", name="Note text")
            ui(page, lambda: box.is_visible())
            fill(box, "never saved")
            click(page.get_by_role("button", name="Save note"))
            ui(page, lambda: says(problems_of(page), f"Edit not saved — {OFFLINE}. The note shows its saved text."))
            ui(page, lambda: shows(page.get_by_role("button", name=f"Note: {value}")))
        n = next(x for x in board(p, app_url, w["id"])["notes"] if x["id"] == made[0]["id"])
        assert (n["x"], n["y"], n["text"]) == (made[0]["x"], made[0]["y"], value)


def test_repeated_operations_across_instances(app_url):
    fac = sign_in(app_url)
    bases = [app_url, replica()]
    with workshop(app_url, fac) as w:
        p, _, _, _, _ = revealed_board(app_url, fac, w)
        prob = fid(board(p, app_url, w["id"]), "Problems")
        path = f"/api/workshops/{w['id']}/notes"
        key, t = op(), tag()
        once, other_text, text_a, text_b = seeded(0), seeded(1), seeded(2), seeded(3)
        body = {"clientOpId": key, "frameId": prob, "kind": "text", "text": once, "x": 1, "y": 1}
        v0 = get_ws(fac, app_url, w["id"])["version"]
        rs = parallel([lambda i=i: p.req("POST", bases[i % 2], path, body) for i in range(6)])
        assert {r.status_code for r in rs} == {201} and len({r.text for r in rs}) == 1
        assert get_ws(fac, app_url, w["id"])["version"] == v0 + 1
        assert sum(n["text"] == once for n in board(p, app_url, w["id"])["notes"]) == 1
        e = err(p.req("POST", app_url, path, {**body, "text": other_text}), 409, "op_conflict")
        assert e["message"] == "That operation id was already used for a different change"
        err(p.req("PATCH", replica(), f"/api/notes/{rs[0].json()['note']['id']}", {"clientOpId": key, "text": "x"}),
            409, "op_conflict")
        key2 = op()
        a = {**body, "clientOpId": key2, "text": text_a}
        b = {**body, "clientOpId": key2, "text": text_b}
        rs = parallel([lambda i=i: p.req("POST", bases[i % 2], path, a if i < 3 else b) for i in range(6)])
        groups = [rs[:3], rs[3:]]
        win = [g for g in groups if all(r.status_code == 201 for r in g)]
        lose = [g for g in groups if all(r.status_code == 409 for r in g)]
        assert len(win) == 1 and len(lose) == 1 and len({r.text for r in win[0]}) == 1
        texts = [n["text"] for n in board(p, app_url, w["id"])["notes"]]
        assert (text_a in texts) != (text_b in texts)
        assert other_text not in texts


def test_clusters_connectors_effects(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p1, _, p2, _, made = revealed_board(app_url, fac, w, (("Problems", "a"), ("Problems", "b"), ("Problems", "c")))
        b = board(p1, app_url, w["id"])
        prob, ques = fid(b, "Problems"), fid(b, "Questions")
        a_, b_, c_ = (n["id"] for n in made)
        alpha = mk_cluster(p1, app_url, w["id"], prob, CLUSTER_A)
        other = mk_cluster(p2, app_url, w["id"], ques, CLUSTER_B)
        assert p1.req("PATCH", app_url, f"/api/clusters/{alpha['id']}",
                      {"clientOpId": op(), "title": CLUSTER_C}).json()["cluster"]["title"] == CLUSTER_C
        assert next(c for c in board(p2, app_url, w["id"])["clusters"] if c["id"] == alpha["id"])["title"] == CLUSTER_C
        for n in (a_, b_):
            assert place(p1, app_url, n, prob, alpha["id"]).status_code == 200
        err(place(p1, app_url, c_, prob, other["id"]), 422, "validation")
        assert connect(p1, app_url, w["id"], a_, b_).status_code == 201
        for pair in ((a_, a_), (b_, a_)):
            assert "toNoteId" in err(connect(p2, app_url, w["id"], *pair), 422, "validation")["fields"]
        assert place(p1, app_url, a_, ques, None).status_code == 200
        pb = board(p1, app_url, w["id"])
        moved = next(n for n in pb["notes"] if n["id"] == a_)
        assert moved["frameId"] == ques and moved["clusterId"] is None
        assert next(c for c in pb["clusters"] if c["id"] == alpha["id"])["noteIds"] == [b_]
        err(p2.req("DELETE", app_url, f"/api/notes/{b_}"), 403, "forbidden")
        assert p1.req("DELETE", app_url, f"/api/notes/{b_}").status_code == 204
        pb = board(p2, app_url, w["id"])
        assert not pb["connectors"] and next(c for c in pb["clusters"] if c["id"] == alpha["id"])["noteIds"] == []
        assert place(p1, app_url, c_, prob, alpha["id"]).status_code == 200
        assert p2.req("DELETE", app_url, f"/api/clusters/{alpha['id']}").status_code == 204
        left = next(n for n in board(p1, app_url, w["id"])["notes"] if n["id"] == c_)
        assert left["frameId"] == prob and left["clusterId"] is None
        con = connect(p1, app_url, w["id"], a_, c_).json()["connector"]
        assert p2.req("DELETE", app_url, f"/api/connectors/{con['id']}").status_code == 204
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        err(p1.req("POST", app_url, f"/api/workshops/{w['id']}/clusters",
                   {"clientOpId": op(), "frameId": prob, "title": "Locked", "x": 0, "y": 0}), 409, "phase_locked")
        err(connect(p1, app_url, w["id"], a_, c_), 409, "phase_locked")


def assert_counts(b):
    for f in b["frames"]:
        mine = [n for n in b["notes"] if n["frameId"] == f["id"] and not n.get("facilitatorOnly")]
        assert f["noteCount"] == len(mine), f
        assert f["hiddenCount"] == sum(not n["revealed"] for n in mine), f
    for c in b["clusters"]:
        assert c["noteCount"] == len(c["noteIds"]) and len(set(c["noteIds"])) == len(c["noteIds"])
        assert set(c["noteIds"]) == {n["id"] for n in b["notes"] if n.get("clusterId") == c["id"]}


def test_counts_match_board(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        specs = tuple(("Problems", f"count {i}") for i in range(6))
        p, _, p2, _, made = revealed_board(app_url, fac, w, specs)
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        x, y = mk_cluster(fac, app_url, w["id"], prob, "X"), mk_cluster(fac, app_url, w["id"], prob, "Y", 600, 40)
        ids = [n["id"] for n in made]

        def check_all():
            for viewer in (fac, p, p2):
                assert_counts(board(viewer, app_url, w["id"]))

        for nid in ids[:3]:
            assert place(p, app_url, nid, prob, x["id"]).status_code == 200
        assert place(p, app_url, ids[3], prob, x["id"], 0).status_code == 200
        assert place(p, app_url, ids[4], prob, x["id"], 99).status_code == 200
        xs = next(c for c in board(fac, app_url, w["id"])["clusters"] if c["id"] == x["id"])["noteIds"]
        assert xs == [ids[3], ids[0], ids[1], ids[2], ids[4]]
        check_all()
        assert place(p, app_url, ids[1], prob, y["id"]).status_code == 200
        check_all()
        assert p.req("DELETE", app_url, f"/api/notes/{ids[0]}").status_code == 204
        check_all()
        assert patch_note(fac, app_url, ids[2], facilitatorOnly=True).status_code == 200
        check_all()
        assert fac.req("DELETE", app_url, f"/api/clusters/{y['id']}").status_code == 204
        check_all()
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        mk_note(p2, app_url, w["id"], prob, "round two")
        fb = board(fac, app_url, w["id"])
        assert frame_of(fb, "Problems")["hiddenCount"] == 1
        check_all()


def test_wf_clustering_keyboard_move(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        specs = tuple(("Problems", seeded(i)) for i in range(3))
        p, _, _, _, made = revealed_board(app_url, fac, w, specs)
        prob = fid(board(p, app_url, w["id"]), "Problems")
        c1 = mk_cluster(p, app_url, w["id"], prob, CLUSTER_A)
        c2 = mk_cluster(p, app_url, w["id"], prob, CLUSTER_B, 600, 40)
        frame = "Problems"
        for n in made:
            assert place(p, app_url, n["id"], prob, c1["id"]).status_code == 200
        first = made[0]

        def order(cid):
            return next(c for c in board(p, app_url, w["id"])["clusters"] if c["id"] == cid)["noteIds"]

        with room(browser, app_url, p, f"/w/{w['id']}") as page:
            wait_board(page)
            record_status(page)
            note = page.get_by_role("button", name=f"Note: {first['text']}")
            ui(page, lambda: shows(note))
            note.focus()
            page.keyboard.press("Space")
            ui(page, lambda: says(status_of(page), "Picked up. Up and down arrows reorder, M moves to another cluster or "
                                                   "frame, Space drops, Escape cancels."))
            page.keyboard.press("ArrowDown")
            ui(page, lambda: says(status_of(page), f"Position {2} of {3} in {CLUSTER_A}"))
            page.keyboard.press("Space")
            ui(page, lambda: says(status_of(page), f"Dropped. Position {2} of {3} in {CLUSTER_A}"))
            ui(page, lambda: order(c1["id"])[1] == first["id"], what="reorder saved")
            assert note.evaluate(IS_FOCUSED_JS)
            page.keyboard.press("Space")
            page.keyboard.press("ArrowUp")
            page.keyboard.press("Escape")
            ui(page, lambda: says(status_of(page), f"Move cancelled. Note returned to {CLUSTER_A}."))
            assert order(c1["id"])[1] == first["id"]
            page.keyboard.press("Space")
            page.keyboard.press("m")
            dlg = page.get_by_role("dialog", name="Move note")
            ui(page, lambda: shows(dlg))
            option = dlg.get_by_role("listbox", name="Destinations").get_by_role("option",
                                                                                 name=f"Cluster: {CLUSTER_B} ({frame})")
            for _ in range(10):
                if option.evaluate("o => o.getAttribute('aria-selected') === 'true' || o.selected === true"):
                    break
                page.keyboard.press("ArrowDown")
            page.keyboard.press("Enter")
            ui(page, lambda: says(status_of(page), f"Moved to {CLUSTER_B}, position {1} of {1}"))
            ui(page, lambda: note.evaluate(IS_FOCUSED_JS), what="focus stays on note")
        assert order(c2["id"]) == [first["id"]] and first["id"] not in order(c1["id"])


def test_wf_clustering_search_drag(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        t = tag()
        texts = [f"onboarding emails arrive late {t}", f"onboarding checklist missing {t}"]
        p, _, p2, _, made = revealed_board(app_url, fac, w, (("Problems", texts[0]), ("Problems", texts[1]),
                                                              ("Problems", f"payroll fine {t}")))
        cl = mk_cluster(p, app_url, w["id"], fid(board(p, app_url, w["id"]), "Problems"), CLUSTER_C,
                        500, 60)
        with room(browser, app_url, p, f"/w/{w['id']}") as page, room(browser, replica(), p2, f"/w/{w['id']}") as other:
            wait_board(page)
            wait_board(other)
            box = page.get_by_role("searchbox", name="Search notes")
            fill(box, "onboarding")
            box.press("Enter")
            results = page.get_by_role("list", name="Search results")
            ui(page, lambda: results.get_by_role("button").count() == 2, what="two results")
            click(results.get_by_role("button", name=texts[0]))
            note = page.get_by_role("button", name=f"Note: {texts[0]}")
            ui(page, lambda: note.evaluate(IS_FOCUSED_JS), what="focus on result")
            assert page.get_by_role("list", name="Search results").get_by_role("button").count() == 0
            group = page.get_by_role("group", name=f"Cluster: {CLUSTER_C}")
            for value in texts:
                gx, gy = center(group)
                drag(page, page.get_by_role("button", name=f"Note: {value}"), gx, gy)
                advance(page, 1000)
            far = other.get_by_role("group", name=f"Cluster: {CLUSTER_C}")
            ui(other, lambda: f"{2} notes" in far.inner_text(), what="count on other screen")
            page.reload()
            wait_board(page)
            ui(page, lambda: f"{2} notes" in group.inner_text())
            assert all(shows(group.get_by_role("button", name=f"Note: {v}")) for v in texts)
        ids = next(c for c in board(fac, app_url, w["id"])["clusters"] if c["id"] == cl["id"])["noteIds"]
        assert sorted(ids) == sorted(n["id"] for n in made[:2])


def test_search_rank_visibility(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        (p1, _), (p2, _) = join(app_url, w), join(app_url, w)
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        b = board(fac, app_url, w["id"])
        word = "zq" + "".join(chr(97 + int(c, 16) % 26) for c in tag())
        a = mk_note(p1, app_url, w["id"], fid(b, "Problems"), word)
        bb = mk_note(p1, app_url, w["id"], fid(b, "Problems"), f"{word} friction {word}")
        hidden = mk_note(p2, app_url, w["id"], fid(b, "Problems"), f"{word} plan")
        assert [x["noteId"] for x in search(p1, app_url, w["id"], word).json()["results"]] == [bb["id"], a["id"]]
        assert hidden["id"] not in [x["noteId"] for x in search(fac, app_url, w["id"], word).json()["results"]]
        assert move(fac, app_url, w["id"], "revealed").status_code == 200
        private = mk_note(fac, app_url, w["id"], fid(b, "Questions"), f"{word} private", facilitatorOnly=True)
        trashed = mk_note(p2, app_url, w["id"], fid(b, "Opportunities"), f"{word} trashed")
        r = search(p1, replica(), w["id"], word)
        assert r.status_code == 200
        res = r.json()["results"]
        assert [x["noteId"] for x in res] == [bb["id"], a["id"], hidden["id"], trashed["id"]]
        assert set(res[0]) == {"noteId", "frameId", "text"} and res[0]["text"] == bb["text"]
        assert private["id"] in [x["noteId"] for x in search(fac, app_url, w["id"], word).json()["results"]]
        assert fac.req("POST", app_url, f"/api/frames/{fid(b, 'Opportunities')}/trash",
                       {"clientOpId": op()}).status_code == 200
        ids = [x["noteId"] for x in search(p2, app_url, w["id"], word).json()["results"]]
        assert trashed["id"] not in ids and private["id"] not in ids
        for q in ("   ", "q" * 101):
            e = err(search(p1, app_url, w["id"], q), 422, "validation")
            assert e["fields"]["q"] == "Type between 1 and 100 characters"
        empty = search(p1, app_url, w["id"], "!!!")
        assert empty.status_code == 200 and empty.json()["results"] == []


def voting_scene(base, fac, w, clusters=("A",), budget=DOTS):
    p1, _, p2, _, _ = revealed_board(base, fac, w)
    prob = fid(board(fac, base, w["id"]), "Problems")
    cls = [mk_cluster(fac, base, w["id"], prob, title, 100 + 200 * i, 300) for i, title in enumerate(clusters)]
    assert move(fac, base, w["id"], "voting", VOTE_SECONDS, budget).status_code == 200
    return p1, p2, cls


def test_dot_budget_concurrent(app_url):
    fac = sign_in(app_url)
    bases = [app_url, replica()]
    with workshop(app_url, fac) as w:
        p1, _, _, _, _ = revealed_board(app_url, fac, w)
        cl = mk_cluster(fac, app_url, w["id"], fid(board(fac, app_url, w["id"]), "Problems"), "Budget")
        err(spend(p1, app_url, cl["id"]), 409, "phase_locked")
        assert move(fac, app_url, w["id"], "voting", VOTE_SECONDS, DOTS).status_code == 200
        rs = parallel([lambda i=i: spend(p1, bases[i % 2], cl["id"]) for i in range(6)])
        ok = [r for r in rs if r.status_code == 201]
        assert len(ok) == DOTS
        assert sorted(r.json()["dotsRemaining"] for r in ok) == list(range(DOTS))
        for r in rs:
            if r.status_code != 201:
                assert err(r, 409, "budget_exhausted")["message"] == "You have no dots left"
        assert board(p1, app_url, w["id"])["viewer"]["dotsRemaining"] == 0
        assert next(c for c in board(fac, app_url, w["id"])["clusters"] if c["id"] == cl["id"])["dotTotal"] == DOTS
        r = give_back(p1, app_url, cl["id"])
        assert r.status_code == 200 and r.json() == {"clusterId": cl["id"], "dotsRemaining": 1}
        err(spend(fac, app_url, cl["id"]), 403, "forbidden")


def test_vote_totals_from_ledger(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p1, _, p2, _, _ = revealed_board(app_url, fac, w)
        assert board(p1, app_url, w["id"])["viewer"]["dotsRemaining"] is None
        b = board(fac, app_url, w["id"])
        a = mk_cluster(fac, app_url, w["id"], fid(b, "Problems"), "A")
        z = mk_cluster(fac, app_url, w["id"], fid(b, "Opportunities"), "Z")
        assert move(fac, app_url, w["id"], "voting", VOTE_SECONDS, DOTS).status_code == 200
        for p, c in ((p1, a), (p1, a), (p1, z), (p2, z)):
            assert spend(p, app_url, c["id"]).status_code == 201
        assert give_back(p1, replica(), a["id"]).status_code == 200

        def cluster(bd, cid):
            return next(c for c in bd["clusters"] if c["id"] == cid)

        fb, b1, b2 = (board(x, app_url, w["id"]) for x in (fac, p1, p2))
        assert (cluster(fb, a["id"])["dotTotal"], cluster(fb, z["id"])["dotTotal"]) == (1, 2)
        assert all("dotTotal" not in c for c in b1["clusters"] + b2["clusters"])
        assert (cluster(b1, a["id"])["myDots"], cluster(b1, z["id"])["myDots"]) == (1, 1)
        assert (cluster(b2, a["id"])["myDots"], cluster(b2, z["id"])["myDots"]) == (0, 1)
        assert (b1["viewer"]["dotsRemaining"], b2["viewer"]["dotsRemaining"]) == (1, 2)
        assert fac.req("POST", app_url, f"/api/frames/{fid(b, 'Opportunities')}/trash",
                       {"clientOpId": op()}).status_code == 200
        assert board(p1, app_url, w["id"])["viewer"]["dotsRemaining"] == 1
        assert move(fac, app_url, w["id"], "closed").status_code == 200
        assert cluster(board(p1, app_url, w["id"]), a["id"])["dotTotal"] == 1


def test_wf_dot_voting_journey(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p1, _, p2, _, _ = revealed_board(app_url, fac, w)
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        mk_cluster(fac, app_url, w["id"], prob, CLUSTER_A, 100, 300)
        second = mk_cluster(fac, app_url, w["id"], prob, CLUSTER_B, 400, 300)
        ranked = re.escape(f"{CLUSTER_B} — {2} dots") + ".*" + re.escape(f"{CLUSTER_A} — {1} dot")
        with room(browser, app_url, fac, f"/w/{w['id']}") as fpage:
            wait_board(fpage)
            d = drawer(fpage)
            fill(d.get_by_role("spinbutton", name="Voting length in minutes"), str(VOTE_SECONDS // 60))
            fill(d.get_by_role("spinbutton", name="Dots per person"), str(DOTS))
            click(d.get_by_role("button", name="Start voting"))
            ui(fpage, lambda: says(status_of(fpage), f"Voting started — {DOTS} dots each"))
            with room(browser, replica(), p1, f"/w/{w['id']}") as page:
                wait_board(page)
                click(page.get_by_role("button", name=f"Add dot to {CLUSTER_A}"))
                ui(page, lambda: says(status_of(page), f"Dot placed on {CLUSTER_A}. {DOTS - 1} left."))
                ui(page, lambda: f"{DOTS - 1} of {DOTS} dots left" in drawer(page).inner_text())
                assert f"{1} of yours" in page.get_by_role("group", name=f"Cluster: {CLUSTER_A}").inner_text()
                for _ in range(2):
                    assert spend(p2, app_url, second["id"]).status_code == 201
                totals = d.get_by_role("list", name="Vote totals")
                ui(fpage, lambda: re.search(ranked, totals.inner_text(), re.S) is not None,
                   what="ranked totals")
                for _ in range(2):
                    assert spend(p1, app_url, second["id"]).status_code == 201
                click(page.get_by_role("button", name=f"Add dot to {CLUSTER_A}"))
                ui(page, lambda: says(problems_of(page), "You have no dots left"))
        clusters = board(fac, app_url, w["id"])["clusters"]
        assert sorted((c["title"], c["dotTotal"]) for c in clusters) == [(CLUSTER_A, 1), (CLUSTER_B, 4)]


def test_wf_dot_voting_session_ended(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p1, p2, (cl,) = voting_scene(app_url, fac, w)
        assert spend(p1, app_url, cl["id"]).status_code == 201
        with room(browser, app_url, fac, f"/w/{w['id']}") as fpage, room(browser, app_url, p1, f"/w/{w['id']}") as page:
            wait_board(fpage)
            wait_board(page)
            click(drawer(fpage).get_by_role("button", name="Turn off join link"))
            ui(fpage, lambda: says(status_of(fpage),
                                   "Join link turned off. Everyone who joined with it has been disconnected."))
            for base in (replica(), app_url):
                e = err(spend(p1, base, cl["id"]), 401, "session_ended")
                assert e["message"] == "This join link is no longer active"
            ui(page, lambda: shows(page.get_by_role(
                "heading", level=1, name="This join link is no longer active. Ask your facilitator for a new one.")))
        assert get_ws(fac, app_url, w["id"])["joinUrl"] is None
        assert next(c for c in board(fac, app_url, w["id"])["clusters"] if c["id"] == cl["id"])["dotTotal"] == 1


def test_paired_dot_returns(app_url):
    fac = sign_in(app_url)
    bases = [app_url, replica()]
    with workshop(app_url, fac) as w:
        p1, p2, (a, c) = voting_scene(app_url, fac, w, ("A", "C"))
        for _ in range(2):
            assert spend(p1, app_url, a["id"]).status_code == 201
        rs = parallel([lambda i=i: give_back(p1, bases[i % 2], a["id"]) for i in range(5)])
        assert sorted(r.status_code for r in rs) == [200, 200, 409, 409, 409]
        for r in rs:
            if r.status_code == 409:
                assert err(r, 409, "no_dot_to_return")["message"] == "You have no dot on that cluster"
        assert board(p1, app_url, w["id"])["viewer"]["dotsRemaining"] == DOTS
        assert next(x for x in board(fac, app_url, w["id"])["clusters"] if x["id"] == a["id"])["dotTotal"] == 0
        assert spend(p1, app_url, a["id"]).status_code == 201
        for _ in range(2):
            assert spend(p2, app_url, c["id"]).status_code == 201
        jobs = [lambda: fac.req("DELETE", app_url, f"/api/clusters/{c['id']}")]
        jobs += [lambda i=i: spend(p2, bases[i % 2], c["id"]) for i in range(3)]
        rs = parallel(jobs)
        assert rs[0].status_code == 204
        for r in rs[1:]:
            assert r.status_code in (201, 404, 409), r.text
            if r.status_code == 409:
                err(r, 409, "budget_exhausted")
            if r.status_code == 404:
                err(r, 404, "not_found")
        assert board(p2, app_url, w["id"])["viewer"]["dotsRemaining"] == DOTS
        assert board(p1, app_url, w["id"])["viewer"]["dotsRemaining"] == DOTS - 1
        assert all(x["id"] != c["id"] for x in board(fac, app_url, w["id"])["clusters"])


def test_trash_exact_restore(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        (p1, _), (p2, _) = join(app_url, w), join(app_url, w)
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        b = board(fac, app_url, w["id"])
        opp, prob = fid(b, "Opportunities"), fid(b, "Problems")
        n1, n2, n3 = (mk_note(p1, app_url, w["id"], opp, f"opp {i}", 40 + 100 * i, 40) for i in range(3))
        m1 = mk_note(p2, app_url, w["id"], prob, "outside")
        assert move(fac, app_url, w["id"], "revealed").status_code == 200
        bets = mk_cluster(fac, app_url, w["id"], opp, "Bets")
        for n, idx in ((n1, None), (n3, None), (n2, 1)):
            assert place(fac, app_url, n["id"], opp, bets["id"], idx).status_code == 200
        assert connect(fac, app_url, w["id"], n1["id"], n2["id"]).status_code == 201
        assert connect(fac, app_url, w["id"], n3["id"], m1["id"]).status_code == 201
        assert move(fac, app_url, w["id"], "voting", VOTE_SECONDS, DOTS).status_code == 200
        for p in (p1, p1, p2):
            assert spend(p, app_url, bets["id"]).status_code == 201
        opp_notes = {n1["id"], n2["id"], n3["id"]}

        def snapshot(bd):
            return (frame_of(bd, "Opportunities"),
                    sorted((n for n in bd["notes"] if n["id"] in opp_notes), key=lambda n: n["id"]),
                    [c for c in bd["clusters"] if c["frameId"] == opp],
                    sorted((c for c in bd["connectors"] if {c["fromNoteId"], c["toNoteId"]} & opp_notes),
                           key=lambda c: c["id"]))

        before = snapshot(board(fac, app_url, w["id"]))
        prob_before = frame_of(board(fac, app_url, w["id"]), "Problems")
        err(p1.req("POST", app_url, f"/api/frames/{opp}/trash", {"clientOpId": op()}), 403, "forbidden")
        item = fac.req("POST", app_url, f"/api/frames/{opp}/trash", {"clientOpId": op()}).json()["trashItem"]
        assert (item["kind"], item["title"], item["noteCount"]) == ("frame", "Opportunities", 3)
        mid = board(fac, app_url, w["id"])
        assert all(f["id"] != opp for f in mid["frames"]) and not {n["id"] for n in mid["notes"]} & opp_notes
        assert not mid["connectors"] and frame_of(mid, "Problems") == prob_before
        assert board(p1, app_url, w["id"])["viewer"]["dotsRemaining"] == 1
        err(p1.req("POST", app_url, f"/api/trash/{item['id']}/restore", {"clientOpId": op()}), 403, "forbidden")
        r = fac.req("POST", replica(), f"/api/trash/{item['id']}/restore", {"clientOpId": op()})
        assert r.status_code == 200, r.text
        assert r.json()["restored"] == {"notes": 3, "clusters": 1, "connectors": 2, "dots": 3}
        after = board(fac, app_url, w["id"])
        assert snapshot(after) == before
        assert next(c for c in after["clusters"] if c["id"] == bets["id"])["noteIds"] == [n1["id"], n2["id"], n3["id"]]
        err(fac.req("POST", app_url, f"/api/trash/{item['id']}/restore", {"clientOpId": op()}), 404, "not_found")


def test_wf_trash_restore_dialog(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        revealed_board(app_url, fac, w, (("Opportunities", "keep a"), ("Opportunities", "keep b")))
        opp = fid(board(fac, app_url, w["id"]), "Opportunities")
        cl = mk_cluster(fac, app_url, w["id"], opp, "Kept")
        for n in [x for x in board(fac, app_url, w["id"])["notes"] if x["frameId"] == opp]:
            assert place(fac, app_url, n["id"], opp, cl["id"]).status_code == 200
        before = board(fac, app_url, w["id"])
        with room(browser, app_url, fac, f"/w/{w['id']}") as page:
            wait_board(page)
            click(region(page, "Opportunities").get_by_role("button", name="Frame options"))
            click(page.get_by_role("menuitem", name="Move to trash"))
            ui(page, lambda: says(status_of(page), f"Frame {'Opportunities'} moved to trash"))
            ui(page, lambda: rail_button(page, "Opportunities").count() == 0)
            assert all(f["id"] != opp for f in board(fac, app_url, w["id"])["frames"])
            click(drawer(page).get_by_role("button", name="Trash"))
            dlg = page.get_by_role("dialog", name="Trash")
            ui(page, lambda: re.search(r"Deleted \d{1,2} \w{3} \d{4}, purged \d{1,2} \w{3} \d{4}", dlg.inner_text())
               is not None)
            click(dlg.get_by_role("button", name="Restore Opportunities"))
            ui(page, lambda: says(status_of(page), f"Frame {'Opportunities'} restored with {2} notes"))
            ui(page, lambda: shows(rail_button(page, "Opportunities"))
               and f"{2} notes" in region(page, "Opportunities").inner_text())
        after = board(fac, app_url, w["id"])
        assert frame_of(after, "Opportunities") == frame_of(before, "Opportunities")
        assert next(c for c in after["clusters"] if c["id"] == cl["id"])["noteIds"] == \
            next(c for c in before["clusters"] if c["id"] == cl["id"])["noteIds"]


def test_version_history_restore(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        v50 = drive_to_snapshot(fac, app_url, w["id"], prob)
        versions = fac.req("GET", app_url, f"/api/workshops/{w['id']}/versions").json()["versions"]
        auto = next(v for v in versions if v["version"] == v50)
        assert auto["reason"] == "auto" and ISO_MS.match(auto["createdAt"])
        snap_title = frame_of(board(fac, app_url, w["id"]), "Problems")["title"]
        later = mk_note(fac, app_url, w["id"], prob, "after the snapshot")
        assert fac.req("PATCH", app_url, f"/api/frames/{prob}",
                       {"clientOpId": op(), "title": RENAMED_FRAME}).status_code == 200
        pre = get_ws(fac, app_url, w["id"])["version"]
        s = Stream(fac, replica(), w["id"])
        try:
            r = fac.req("POST", app_url, f"/api/workshops/{w['id']}/versions/{auto['id']}/restore",
                        {"clientOpId": op()})
            assert r.status_code == 200, r.text
            assert r.json()["restoredFrom"] == v50 and set(r.json()["saved"]) == {"id", "version"}
            assert s.wait("board", lambda e: int(e["id"]) == pre + 1)
        finally:
            s.close()
        saved = r.json()["saved"]
        b = board(fac, app_url, w["id"])
        assert b["workshop"]["version"] == pre + 1 and frame_of(b, snap_title)
        assert all(n["id"] != later["id"] for n in b["notes"])
        listed = fac.req("GET", app_url, f"/api/workshops/{w['id']}/versions").json()["versions"]
        assert any(v["id"] == saved["id"] and v["reason"] == "before_restore" and v["version"] == saved["version"]
                   for v in listed)
        assert fac.req("POST", app_url, f"/api/workshops/{w['id']}/versions/{saved['id']}/restore",
                       {"clientOpId": op()}).status_code == 200
        b = board(fac, app_url, w["id"])
        assert frame_of(b, RENAMED_FRAME) and any(n["id"] == later["id"] for n in b["notes"])
        walk_to(fac, app_url, w["id"], "silent_round")
        err(fac.req("POST", app_url, f"/api/workshops/{w['id']}/versions/{auto['id']}/restore", {"clientOpId": op()}),
            409, "phase_locked")


def test_wf_trash_restore_versions(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        v50 = drive_to_snapshot(fac, app_url, w["id"], prob)
        assert fac.req("PATCH", app_url, f"/api/frames/{prob}",
                       {"clientOpId": op(), "title": KEPT_FRAME}).status_code == 200
        with room(browser, app_url, fac, f"/w/{w['id']}") as page:
            wait_board(page)
            click(drawer(page).get_by_role("button", name="Versions"))
            dlg = page.get_by_role("dialog", name="Versions")
            ui(page, lambda: re.search(rf"Version {v50} — Autosave — \d{{1,2}} \w{{3}} \d{{4}}, \d\d:\d\d",
                                       dlg.inner_text()) is not None)
            click(dlg.get_by_role("button", name=f"Restore version {v50}"))
            click(page.get_by_role("button", name="Restore", exact=True))
            ui(page, lambda: says(status_of(page),
                                  f"Board restored to version {v50}. The previous board is saved as version "))
            saved = int(re.search(r"saved as version (\d+)", status_of(page).inner_text()).group(1))
            ui(page, lambda: rail_button(page, KEPT_FRAME).count() == 0)
            if not shows(page.get_by_role("dialog", name="Versions")):
                click(drawer(page).get_by_role("button", name="Versions"))
            click(page.get_by_role("dialog", name="Versions").get_by_role("button", name=f"Restore version {saved}"))
            click(page.get_by_role("button", name="Restore", exact=True))
            ui(page, lambda: shows(rail_button(page, KEPT_FRAME)), what="undo restore")
        assert frame_of(board(fac, app_url, w["id"]), KEPT_FRAME)["id"] == prob


def test_purge_at_read(app_url):
    sp = env_url("APP_SHORT_PURGE_URL")
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        b = board(fac, app_url, w["id"])
        ques = fid(b, "Questions")
        word = "purgeprobe" + "".join(chr(97 + int(c, 16) % 26) for c in tag())
        probe = mk_note(fac, app_url, w["id"], ques, word)
        v50 = drive_to_snapshot(fac, app_url, w["id"], fid(b, "Problems"))
        auto = next(v for v in fac.req("GET", app_url, f"/api/workshops/{w['id']}/versions").json()["versions"]
                    if v["version"] == v50)
        assert [x["noteId"] for x in search(fac, sp, w["id"], word).json()["results"]] == [probe["id"]]
        item = fac.req("POST", sp, f"/api/frames/{ques}/trash", {"clientOpId": op()}).json()["trashItem"]
        purge_at = parse_iso(item["purgeAt"])
        assert purge_at - parse_iso(item["deletedAt"]) == timedelta(seconds=PURGE_SECONDS)
        assert any(i["id"] == item["id"] for i in fac.req("GET", sp, f"/api/workshops/{w['id']}/trash").json()["items"])
        wait_server_past(fac, sp, w["id"], purge_at, PURGE_SECONDS * 10)
        for base in (sp, app_url):
            items = fac.req("GET", base, f"/api/workshops/{w['id']}/trash").json()["items"]
            assert all(i["id"] != item["id"] for i in items)
        err(fac.req("POST", sp, f"/api/trash/{item['id']}/restore", {"clientOpId": op()}), 404, "not_found")
        assert search(fac, sp, w["id"], word).json()["results"] == []
        assert fac.req("POST", sp, f"/api/workshops/{w['id']}/versions/{auto['id']}/restore",
                       {"clientOpId": op()}).status_code == 200
        after = board(fac, sp, w["id"])
        assert all(f["id"] != ques for f in after["frames"]) and all(n["id"] != probe["id"] for n in after["notes"])


def test_facilitator_only_notes(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p1, _, p2, _, made = revealed_board(app_url, fac, w, (("Problems", "a"), ("Problems", "b"), ("Problems", "c"),
                                                               ("Questions", "d")))
        b = board(fac, app_url, w["id"])
        prob = fid(b, "Problems")
        a_, b_, c_, d_ = (n["id"] for n in made)
        k = mk_cluster(fac, app_url, w["id"], prob, "K")
        for n in (a_, b_, c_):
            assert place(fac, app_url, n, prob, k["id"]).status_code == 200
        assert connect(fac, app_url, w["id"], b_, d_).status_code == 201
        r = patch_note(fac, app_url, b_, facilitatorOnly=True)
        assert r.status_code == 200 and r.json()["note"]["facilitatorOnly"] is True
        for viewer in (fac, p1):
            vb = board(viewer, app_url, w["id"])
            assert next(c for c in vb["clusters"] if c["id"] == k["id"])["noteIds"] == [a_, c_]
            assert frame_of(vb, "Problems")["noteCount"] == 2
        pb = board(p1, app_url, w["id"])
        assert all(n["id"] != b_ for n in pb["notes"]) and not pb["connectors"]
        fn = next(n for n in board(fac, app_url, w["id"])["notes"] if n["id"] == b_)
        assert fn["clusterId"] is None and fn["facilitatorOnly"] is True
        err(patch_note(p1, app_url, b_, text="peek"), 404, "not_found")
        e_ = mk_note(fac, app_url, w["id"], prob, "fac only", facilitatorOnly=True)
        assert all(n["id"] != e_["id"] for n in board(p2, app_url, w["id"])["notes"])
        err(place(fac, app_url, e_["id"], prob, k["id"]), 422, "validation")
        err(note_req(p1, app_url, w["id"], prob, "sneaky", facilitatorOnly=True), 403, "forbidden")
        err(patch_note(p1, app_url, a_, facilitatorOnly=True), 403, "forbidden")
        assert patch_note(fac, app_url, b_, facilitatorOnly=False).status_code == 200
        pb = board(p1, app_url, w["id"])
        back = next(n for n in pb["notes"] if n["id"] == b_)
        assert back["clusterId"] is None and back["revealed"] and back["frameId"] == prob
        assert frame_of(pb, "Problems")["noteCount"] == 3


def test_wf_facilitator_only_mark(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p, _, _, _, _ = revealed_board(app_url, fac, w)
        secret = f"{PRIVATE_NOTE} {tag()}"
        with room(browser, app_url, fac, f"/w/{w['id']}") as fpage, room(browser, app_url, p, f"/w/{w['id']}") as page:
            wait_board(fpage)
            wait_board(page)
            click(rail_button(fpage, "Problems"))
            click(tool(fpage, "Add note"))
            box = fpage.get_by_role("textbox", name="Note text")
            ui(fpage, lambda: box.is_visible())
            fill(box, secret)
            check(fpage.get_by_role("checkbox", name="Facilitator only"))
            click(fpage.get_by_role("button", name="Save note"))
            ui(fpage, lambda: shows(fpage.get_by_role("button", name=f"Facilitator-only note: {secret}")))
            page.reload()
            wait_board(page)
            advance(page, 1000)
            assert secret not in page.content()
        assert all(n.get("text") != secret for n in board(p, app_url, w["id"])["notes"])
        assert any(n.get("text") == secret and n["facilitatorOnly"] for n in board(fac, app_url, w["id"])["notes"])


UNKNOWN_KEY_CASES = ["reveal_and_author", "position_z", "placement_extra", "kind_and_image", "create_with_ids"]


def test_unknown_keys_rejected(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        walk_to(fac, app_url, w["id"], "open")
        (p1, _), (p2, _) = join(app_url, w), join(app_url, w)
        assert move(fac, app_url, w["id"], "silent_round").status_code == 200
        prob = fid(board(fac, app_url, w["id"]), "Problems")
        own_text, forged = seeded(3), seeded(7)
        own = mk_note(p1, app_url, w["id"], prob, own_text)
        fown = mk_note(fac, app_url, w["id"], prob, "facilitator own")
        cases = {
            "reveal_and_author": (p1, "PATCH", f"/api/notes/{own['id']}",
                                  {"text": "changed", "revealed": True, "authorName": SEED_NAMES[0]},
                                  ["revealed", "authorName"]),
            "position_z": (p1, "PATCH", f"/api/notes/{own['id']}", {"position": {"x": 1, "y": 2, "z": 3}},
                           ["position.z"]),
            "placement_extra": (fac, "PATCH", f"/api/notes/{fown['id']}",
                                {"placement": {"frameId": prob, "clusterId": None, "extra": 1}}, ["placement.extra"]),
            "kind_and_image": (p1, "PATCH", f"/api/notes/{own['id']}", {"text": "x", "kind": "image", "imageId": "img"},
                               ["kind", "imageId"]),
            "create_with_ids": (p1, "POST", f"/api/workshops/{w['id']}/notes",
                                {"frameId": prob, "kind": "text", "text": forged, "x": 1, "y": 1, "id": op(),
                                 "createdAt": "2027-03-28T12:00:00.000Z", "mine": False}, ["id", "createdAt", "mine"]),
        }
        for case in UNKNOWN_KEY_CASES:
            who, method, path, fields, keys = cases[case]
            body = {"clientOpId": op(), **fields}
            v0 = get_ws(fac, app_url, w["id"])["version"]
            r = who.req(method, app_url, path, body)
            e = err(r, 422, "validation")
            assert all(e["fields"][k] == "This field can't be set" for k in keys), case
            again = who.req(method, replica(), path, body)
            assert again.status_code == 422 and again.text == r.text
            assert get_ws(fac, app_url, w["id"])["version"] == v0
        seen = next(n for n in board(p2, app_url, w["id"])["notes"] if n["id"] == own["id"])
        assert seen["revealed"] is False and "text" not in seen
        assert next(n for n in board(p1, app_url, w["id"])["notes"] if n["id"] == own["id"])["text"] == own_text
        assert all(n.get("text") != forged for n in board(p1, app_url, w["id"])["notes"])
        err(patch_note(p1, app_url, own["id"], facilitatorOnly=True, revealed=True), 403, "forbidden")


def recap_copies(base, w, rc):
    s3 = S3()
    prefix = f"workshops/{w['id']}/recap/"
    keys = s3.keys(prefix)
    pdf = s3.get(prefix + "board.pdf")
    csv_bytes = s3.get(prefix + "notes.csv")
    pngs = {k: s3.get(k) for k in keys if k.startswith(prefix + "frames/")}
    api = Actor().req("GET", base, f"/api/recaps/{recap_token(rc)}")
    assert api.status_code == 200
    return keys, pdf, csv_bytes, pngs, api


def test_wf_facilitator_only_recap_privacy(browser, app_url, mail):
    fac = sign_in(app_url)
    title = f"{TITLE_BASE} {tag()}"
    with workshop(app_url, fac, title=title) as w:
        data = build_recap_board(app_url, fac, w)
        assert move(fac, app_url, w["id"], "closed").status_code == 200
        rc = wait_recap(fac, app_url, w["id"], lambda x: x["status"] == "complete")
        assert rc, "recap never completed"
        _, pdf, csv_bytes, pngs, api = recap_copies(app_url, w, rc)
        doc = Pdf(pdf)
        extracted, info = doc.text(), doc.info()
        assert squash(RECAP_PLAIN) in squash(extracted)
        forbidden = [data["private"]] + data["names"]
        for secret in forbidden:
            assert squash(secret) not in squash(extracted)
            assert all(secret not in v for v in info.values())
            assert secret.encode() not in pdf and secret.encode() not in csv_bytes
            assert all(secret.encode() not in png_bytes for png_bytes in pngs.values())
            assert secret not in api.text
        msgs = wait_mails(mail, w["sponsorEmail"], 1, "Recap: ")
        assert msgs
        for m in msgs:
            for secret in forbidden:
                assert secret not in m["Subject"] and secret not in text(m) and secret not in m.get("HTML", "")
        with room(browser, app_url, None, "/recap/" + recap_token(rc)) as page:
            ui(page, lambda: shows(page.get_by_role("heading", level=1, name=f"Recap: {title}")))
            ui(page, lambda: CLUSTER_A in page.content())
            assert all(secret not in page.content() for secret in forbidden)


def test_recap_files_csv_pdf(app_url):
    fac = sign_in(app_url)
    title = f"{TITLE_BASE} {tag()}"
    with workshop(app_url, fac, title=title) as w:
        build_recap_board(app_url, fac, w)
        scale = billing(fac, app_url)["entitlements"]["recapScale"]
        frames = frames_in_order(board(fac, app_url, w["id"]))
        assert move(fac, app_url, w["id"], "closed").status_code == 200
        rc = wait_recap(fac, app_url, w["id"], lambda x: x["filesStoredAt"] is not None)
        assert rc and rc["scale"] == scale
        keys, pdf, csv_bytes, pngs, _ = recap_copies(app_url, w, rc)
        prefix = f"workshops/{w['id']}/recap/"
        assert {prefix + "board.pdf", prefix + "notes.csv"} <= set(keys)
        assert set(pngs) == {f"{prefix}frames/{f['id']}.png" for f in frames}
        for f in frames:
            data = pngs[f"{prefix}frames/{f['id']}.png"]
            assert data.startswith(b"\x89PNG")
            assert struct.unpack(">II", data[16:24]) == (f["width"] * scale, f["height"] * scale)
        assert pdf.startswith(b"%PDF")
        doc = Pdf(pdf)
        layer = squash(doc.text())
        for value in (*RECAP_FORMULAS, RECAP_PLAIN, RECAP_OPP, CLUSTER_A, CLUSTER_B):
            assert squash(value) in layer, value
        assert doc.info() == {"Title": f"Recap: {title}", "Author": "Lanternfold Rooms"}


def test_recap_csv_inert(app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        build_recap_board(app_url, fac, w)
        assert move(fac, app_url, w["id"], "closed").status_code == 200
        assert wait_recap(fac, app_url, w["id"], lambda x: x["filesStoredAt"] is not None), "files never stored"
        csv_bytes = S3().get(f"workshops/{w['id']}/recap/notes.csv")
        assert not csv_bytes.startswith(b"\xef\xbb\xbf")
        assert csv_bytes.count(b"\n") == csv_bytes.count(b"\r\n")
        rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8"), newline="")))
        inert = ["'" + v for v in RECAP_FORMULAS]
        assert rows == [["frame", "cluster", "note", "cluster_dots"],
                        ["Problems", CLUSTER_A, inert[0], str(2)],
                        ["Problems", CLUSTER_A, inert[1], str(2)],
                        ["Problems", CLUSTER_B, inert[2], str(2)],
                        ["Problems", CLUSTER_B, inert[3], str(2)],
                        ["Problems", "", RECAP_PLAIN, ""],
                        ["Opportunities", CLUSTER_C, RECAP_OPP, str(0)]]


def test_wf_recap_close_and_deliver(browser, app_url, mail):
    fac = sign_in(app_url)
    title = f"{TITLE_BASE} {tag()}"
    sponsor, client = address("sponsor"), address("client")
    with workshop(app_url, fac, title=title, sponsor=sponsor, fee=FEE) as w:
        data = build_recap_board(app_url, fac, w)
        assert fac.req("POST", app_url, f"/api/workshops/{w['id']}/invites", {"emails": [client]}).status_code == 202
        with room(browser, app_url, fac, f"/w/{w['id']}") as page:
            wait_board(page)
            click(drawer(page).get_by_role("button", name="Close workshop"))
            dlg = page.get_by_role("dialog", name="Close workshop")
            click(dlg.get_by_role("button", name="Close and send recap"))
            ui(page, lambda: says(status_of(page), "Workshop closed. Preparing the recap."))
            ui(page, lambda: f"Recap sent to {2} people" in drawer(page).inner_text(), seconds=RECAP_WAIT)
            assert shows(drawer(page).get_by_role("link", name="Open recap page"))
        rc = recap_of(fac, app_url, w["id"])
        public = Actor().req("GET", app_url, f"/api/recaps/{recap_token(rc)}").json()
        inv = public["invoice"]
        assert inv["amount"] == FEE and inv["currency"] == "EUR"
        line = f"Invoice {inv['number']} — {FEE_SHOWN}"

        for addr in (sponsor, client):
            msgs = wait_mails(mail, addr, 1, "Recap: ")
            assert len(msgs) == 1
            m = msgs[0]
            single_recipient(m, addr)
            assert m["Subject"] == f"Recap: {title}"
            body = text(m)
            assert rc["recapUrl"] in body and line in body and rc["recapUrl"] in m.get("HTML", "")
            assert body.index(CLUSTER_A) < body.index(CLUSTER_B) < body.index(CLUSTER_C)
            assert RECAP_OPP in body
            for secret in [data["private"]] + data["names"]:
                assert secret not in body and secret not in m.get("HTML", "")
        assert [c["title"] for c in public["clusters"]] == [CLUSTER_A, CLUSTER_B, CLUSTER_C]
        assert [c["dotTotal"] for c in public["clusters"]] == [2, 2, 0]
        assert {f["label"] for f in public["files"]} >= {"Board PDF", "Notes and votes CSV", "Frame image: Problems"}

        assert len(mails_for(mail, sponsor, "Recap: ")) == 1 and data["names"][0] not in json.dumps(public)


def test_wf_recap_sponsor_page(browser, app_url, mail):
    fac = sign_in(app_url)
    title = f"{TITLE_BASE} {tag()}"
    sponsor = address("sponsor")
    with workshop(app_url, fac, title=title, sponsor=sponsor, fee=FEE) as w:
        build_recap_board(app_url, fac, w)
        assert move(fac, app_url, w["id"], "closed").status_code == 200
        msgs = wait_mails(mail, sponsor, 1, "Recap: ")
        assert msgs, "no recap email"
        found = re.search(r"https?://\S+?/recap/[A-Za-z0-9_-]+", text(msgs[0]))
        assert found
        rc = wait_recap(fac, app_url, w["id"], lambda x: x["status"] == "complete")
        assert rc and found.group(0) == rc["recapUrl"]
        token = found.group(0).rsplit("/recap/", 1)[1]
        invoice_line = f"Invoice {rc['invoice']['number']} — {FEE_SHOWN}"
        with room(browser, app_url, None, f"/recap/{token}") as page:
            heading = page.get_by_role("heading", level=1, name=f"Recap: {title}")
            ui(page, lambda: shows(heading), what="recap heading")
            ui(page, lambda: page_reads(page, invoice_line), what="invoice line")
            listing = page.get_by_role("list", name="Recap files")
            for label in ("Board PDF", "Notes and votes CSV", "Frame image: Problems", "Frame image: Opportunities"):
                assert shows(listing.get_by_role("link", name=label)), label
            rows = page.get_by_role("list", name="Cluster ranking").evaluate(TOP_ITEMS_JS)
            assert CLUSTER_A in rows[0] and CLUSTER_B in rows[1] and CLUSTER_C in rows[2]
            assert RECAP_OPP in rows[2]
            pdf_href = listing.get_by_role("link", name="Board PDF").get_attribute("href")
            fetched = page.request.get(pdf_href if pdf_href.startswith("http") else app_url + pdf_href)
            assert fetched.status == 200 and fetched.headers["content-type"].startswith("application/pdf")
            assert fetched.body().startswith(b"%PDF")


def test_sponsor_invoice_once(app_url, killbill):
    fac = sign_in(app_url)
    sponsor, free_sponsor = address("sponsor"), address("sponsor")
    with workshop(app_url, fac, sponsor=sponsor, fee=FEE) as w, workshop(app_url, fac, sponsor=free_sponsor) as zero:
        for x in (w, zero):
            walk_to(fac, app_url, x["id"], "voting", SHORT_SECONDS, 1)
        bases = [app_url, replica()]
        rs = parallel([lambda i=i: move(fac, bases[i % 2], w["id"], "closed") for i in range(4)])
        assert sorted(r.status_code for r in rs) == [200, 409, 409, 409]
        assert move(fac, app_url, zero["id"], "closed").status_code == 200
        done = wait_recap(fac, app_url, w["id"], lambda x: x["status"] == "complete")
        assert done and done["invoice"]["amount"] == FEE and done["invoice"]["currency"] == "EUR"
        account = killbill.account_by_key("sponsor:" + sponsor.lower())
        assert account and account["currency"] == "EUR"
        if account.get("accountBalance") is not None:
            assert Decimal(str(account["accountBalance"])) == Decimal(FEE)
        zr = wait_recap(fac, app_url, zero["id"], lambda x: x["status"] == "complete")
        assert zr and zr["invoice"] is None
        assert killbill.account_by_key("sponsor:" + free_sponsor.lower()) is None


OUTAGE_CASES = ["storage", "billing", "mail"]
OUTAGE_ENV = {"storage": ("APP_MINIO_DOWN_URL", "storage_unavailable"),
              "billing": ("APP_KILLBILL_DOWN_URL", "billing_unavailable"),
              "mail": ("APP_MAILPIT_DOWN_URL", "mail_unavailable")}


@pytest.mark.parametrize("case", OUTAGE_CASES, ids=OUTAGE_CASES)
def test_recap_waits_out_outages(app_url, mail, killbill, case):
    env, reason = OUTAGE_ENV[case]
    down = env_url(env)
    fac = sign_in(down)
    made, observed = [], None
    try:
        for _ in range(OUTAGE_TRIES):
            sponsor = address("sponsor")
            w = new_workshop(fac, down, sponsor=sponsor, fee=FEE)
            made.append(w)
            revealed_board(down, fac, w, (("Problems", f"outage note {tag()}"),))
            walk_to(fac, down, w["id"], "voting", VOTE_SECONDS, DOTS)
            assert move(fac, down, w["id"], "closed").status_code == 200
            rc = wait_recap(fac, down, w["id"], lambda x: x["reason"] == reason or x["status"] == "complete",
                            REASON_SECONDS)
            assert rc, "recap never reported the outage reason"
            if rc["status"] == "complete":
                continue
            assert rc["status"] == "queued" and rc["attempts"] >= 1 and rc["emailSentAt"] is None, rc
            if case == "storage":
                assert rc["filesStoredAt"] is None, rc
            else:
                assert rc["filesStoredAt"] is not None, rc
            if case == "billing":
                assert rc["invoice"] is None, rc
            stored = S3().keys(f"workshops/{w['id']}/recap/")
            assert board(fac, down, w["id"])["workshop"]["status"] == "closed"
            assert fac.req("GET", down, "/api/workshops").status_code == 200
            still = recap_of(fac, down, w["id"])
            if not (still and still["status"] == "queued" and still["reason"] == reason
                    and still["attempts"] == rc["attempts"]):
                continue
            if case != "storage":
                assert stored
            observed = (w, sponsor, rc)
            break
        assert observed, "the recap completed before its queued state could be observed"
        w, sponsor, rc = observed
        done = wait_recap(fac, app_url, w["id"], lambda x: x["status"] == "complete")
        assert done and done["reason"] is None and done["attempts"] > rc["attempts"]
        assert done["invoice"]["amount"] == FEE and killbill.account_by_key(f"sponsor:{sponsor}")
        assert len(wait_mails(mail, sponsor, 1, "Recap: ")) == 1
    finally:
        for x in made:
            retire(fac, down, x["id"])


def test_wf_recap_queued_page(browser, app_url, mail):
    down = env_url("APP_MINIO_DOWN_URL")
    fac = sign_in(down)
    made, observed = [], False
    try:
        for _ in range(OUTAGE_TRIES):
            title = f"{TITLE_BASE} {tag()}"
            w = new_workshop(fac, down, title=title)
            made.append(w)
            walk_to(fac, down, w["id"], "voting", SHORT_SECONDS, 1)
            assert move(fac, down, w["id"], "closed").status_code == 200
            rc = wait_recap(fac, down, w["id"],
                            lambda x: x["reason"] == "storage_unavailable" or x["status"] == "complete",
                            REASON_SECONDS)
            assert rc, "recap never reported the storage outage"
            if rc["status"] == "complete":
                continue
            with room(browser, down, None, "/recap/" + recap_token(rc)) as page:
                ui(page, lambda: shows(page.get_by_role("heading", level=1, name=f"Recap: {title}")))
            api = Actor().req("GET", down, f"/api/recaps/{recap_token(rc)}").json()
            still = recap_of(fac, down, w["id"])
            if not (still and still["status"] == "queued" and still["reason"] == "storage_unavailable"):
                continue
            assert api["status"] == "queued" and api["files"] == []
            observed = True
            break
        assert observed, "the recap completed before its queued page could be observed"
    finally:
        for x in made:
            retire(fac, down, x["id"])


def test_billing_mirror(app_url, killbill):
    down = env_url("APP_KILLBILL_DOWN_URL")
    for who, zone in ((JUNO, JUNO_ZONE), (ODILE, ODILE_ZONE)):
        fac = sign_in(app_url, who)
        b = billing(fac, app_url)
        assert set(b) == BILLING_KEYS and b["stale"] is False
        assert b["entitlements"] == ENTITLEMENTS[b["plan"]] and b["term"] in TERM_LABELS
        assert re.fullmatch(r"\d{4}-\d\d-\d\d", b["renewsOn"])
        if who == ODILE:
            assert b["plan"] == "free"
        account = killbill.account_by_key(f"facilitator:{who[0]}")
        assert account and account["currency"] == "EUR" and account["timeZone"] == zone
        assert killbill.default_plugin(account["accountId"])
        dates = [i["date"] for i in b["invoices"]]
        assert dates == sorted(dates, reverse=True)
        paid = [i for i in b["invoices"] if i["status"] == "paid" and Decimal(i["amount"]) > 0]
        if paid:
            amounts = {Decimal(str(t["amount"])) for p in killbill.payments(account["accountId"])
                       for t in p.get("transactions", [])}
            assert Decimal(paid[0]["amount"]) in amounts
        stale = billing(sign_in(down, who), down)
        assert stale["stale"] is True and (stale["plan"], stale["term"]) == (b["plan"], b["term"])
        assert stale["syncedAt"] and stale["entitlements"] == b["entitlements"]


def upgrade_target(b):
    for plan, term in (("agency", "monthly"), ("agency", "annual"), ("studio", "annual")):
        if RANK[plan] > RANK[b["plan"]] or (plan == b["plan"] and b["term"] == "monthly" and term == "annual"):
            return plan, term
    return None


def downgrade_target(b):
    return ("studio", "monthly") if b["plan"] == "agency" else ("free", "monthly")


def choose(page, plan, term):
    check(page.get_by_role("radiogroup", name="Plan").get_by_role("radio", name=PLAN_LABELS[plan]))
    check(page.get_by_role("radiogroup", name="Billing term").get_by_role("radio", name=TERM_LABELS[term]))


def test_wf_billing_change_plan(browser, app_url, killbill):
    fac = sign_in(app_url)
    b0 = billing(fac, app_url)
    target = upgrade_target(b0)
    assert target, "the seeded account has no immediate upgrade left"
    with room(browser, app_url, fac, "/billing") as page:
        ui(page, lambda: shows(page.get_by_role("heading", level=1, name="Plan and billing")))
        choose(page, *target)
        with page.expect_response("**/api/billing/plan") as resp:
            click(page.get_by_role("button", name="Change plan"))
        body = resp.value.json()
        inv = body["invoice"]
        assert inv and set(inv) == {"id", "number", "date", "amount", "balance", "currency", "status"}
        message = (f"Plan changed to {PLAN_LABELS[target[0]]} ({TERM_LABELS[target[1]]}). "
                   f"Invoice {inv['number']} for €{fmt_amount(inv['amount'])}.")
        status = page.get_by_role("status", name="Billing activity")
        ui(page, lambda: says(status, message))
        cap = ENTITLEMENTS[target[0]]["activeWorkshops"]
        meter = page.get_by_role("meter", name="Active workshops")
        usage_list = page.get_by_role("list", name="Usage")
        row = usage_list.get_by_role("listitem").filter(has=meter)
        usage = r"unlimited" if cap is None else rf"of\s*{cap}(?!\d)"
        ui(page, lambda: re.search(usage, (row.first if row.count() else usage_list).aria_snapshot()) is not None,
           what="active workshops usage")
        sent = resp.value.request.post_data_json
        replay = fac.req("POST", app_url, "/api/billing/plan", sent)
        assert replay.status_code == 200 and replay.text == resp.value.text()
        b1 = billing(fac, app_url)
        assert (b1["plan"], b1["term"]) == target and b1["entitlements"] == ENTITLEMENTS[target[0]]
        assert [i for i in b1["invoices"] if i["id"] == inv["id"]] == [inv]
        assert len(b1["invoices"]) == len(b0["invoices"]) + 1
        account = killbill.account_by_key(f"facilitator:{JUNO[0]}")
        if Decimal(inv["amount"]) > 0:
            amounts = {Decimal(str(t["amount"])) for p in killbill.payments(account["accountId"])
                       for t in p.get("transactions", [])}
            assert Decimal(inv["amount"]) in amounts
        lower = downgrade_target(b1)
        choose(page, *lower)
        click(page.get_by_role("button", name="Change plan"))
        b2 = eventually(lambda: (lambda x: x if x["pendingChange"] else None)(billing(fac, app_url)), EVENT_WAIT)
        assert b2
        when = fmt_date(b2["pendingChange"]["effectiveDate"])
        ui(page, lambda: says(status, f"{PLAN_LABELS[lower[0]]} ({TERM_LABELS[lower[1]]}) starts on {when}."))
        ui(page, lambda: page_reads(page, f"Changes on {when} to {PLAN_LABELS[lower[0]]} ({TERM_LABELS[lower[1]]})"),
           what="pending change line")
        choose(page, *target)
        click(page.get_by_role("button", name="Change plan"))
        ui(page, lambda: says(status, f"Scheduled change cancelled. You stay on {PLAN_LABELS[target[0]]} "
                                      f"({TERM_LABELS[target[1]]})."))
    assert billing(fac, app_url)["pendingChange"] is None


def test_wf_billing_unavailable(browser, app_url):
    down = env_url("APP_KILLBILL_DOWN_URL")
    fac = sign_in(app_url)
    before = billing(fac, app_url)
    for plan, term in filter(None, (upgrade_target(before), downgrade_target(before))):
        err(fac.req("POST", down, "/api/billing/plan", {"clientOpId": op(), "plan": plan, "term": term}),
            503, "billing_unavailable")
    with room(browser, down, fac, "/billing") as page:
        ui(page, lambda: shows(page.get_by_role("heading", level=1, name="Plan and billing")))
        ui(page, lambda: "Showing your plan as of " in page.content())
        choose(page, *(upgrade_target(before) or downgrade_target(before)))
        click(page.get_by_role("button", name="Change plan"))
        ui(page, lambda: says(page.get_by_role("alert", name="Billing problems"),
                              "Billing is unavailable. Your plan hasn't changed — try again shortly."))
        page.reload()
        ui(page, lambda: shows(page.get_by_role("heading", level=1, name="Plan and billing")))
        current = page.get_by_role("radiogroup", name="Plan").get_by_role("radio", name=PLAN_LABELS[before["plan"]])
        ui(page, lambda: current.is_checked())
    after = billing(fac, app_url)
    for key in ("plan", "term", "pendingChange", "invoices", "entitlements"):
        assert after[key] == before[key], key


def test_downgrade_scheduled(app_url):
    fac = sign_in(app_url)
    before = billing(fac, app_url)
    e = err(fac.req("POST", app_url, "/api/billing/plan", {"clientOpId": op(), "plan": "free", "term": "annual"}),
            422, "validation")
    assert e["fields"]["term"] == "Free has no annual term"
    lower = downgrade_target(before)
    r = fac.req("POST", app_url, "/api/billing/plan", {"clientOpId": op(), "plan": lower[0], "term": lower[1]})
    assert r.status_code == 200 and r.json()["invoice"] is None
    b = billing(fac, app_url)
    assert b["pendingChange"] == {"plan": lower[0], "term": lower[1], "effectiveDate": b["renewsOn"]}
    assert (b["plan"], b["term"], b["entitlements"], b["invoices"]) == (before["plan"], before["term"],
                                                                        before["entitlements"], before["invoices"])
    err(fac.req("POST", env_url("APP_KILLBILL_DOWN_URL"), "/api/billing/plan",
                {"clientOpId": op(), "plan": before["plan"], "term": before["term"]}), 503, "billing_unavailable")
    assert billing(fac, app_url)["pendingChange"] == b["pendingChange"]
    r = fac.req("POST", app_url, "/api/billing/plan",
                {"clientOpId": op(), "plan": before["plan"], "term": before["term"]})
    assert r.status_code == 200 and r.json()["billing"]["pendingChange"] is None
    err(fac.req("POST", app_url, "/api/billing/plan",
                {"clientOpId": op(), "plan": before["plan"], "term": before["term"]}), 409, "plan_unchanged")


def test_plan_limits(app_url):
    fac = sign_in(app_url, ODILE)
    b = billing(fac, app_url)
    assert b["plan"] == "free"
    cap = ENTITLEMENTS["free"]["activeWorkshops"]
    free_slots = max(cap - b["usage"]["activeWorkshops"], 0)
    bases = [app_url, replica()]
    rs = parallel([lambda i=i: create_workshop(fac, bases[i % 2]) for i in range(free_slots + 3)])
    created = [r.json()["workshop"]["id"] for r in rs if r.status_code == 201]
    try:
        assert len(created) == free_slots
        for r in rs:
            if r.status_code != 201:
                e = err(r, 402, "plan_limit")
                assert (e["limit"], e["used"], e["plan"]) == (cap, cap, "free")
                assert e["message"] == f"Your {PLAN_LABELS['free']} plan allows {cap} active workshops"
        if created:
            wid = created[0]
            walk_to(fac, app_url, wid, "revealed", SHORT_SECONDS)
            e = err(move(fac, app_url, wid, "silent_round"), 402, "plan_limit")
            assert (e["limit"], e["used"], e["plan"]) == (1, 1, "free")
            assert get_ws(fac, app_url, wid)["status"] == "revealed"
    finally:
        for wid in created:
            retire(fac, app_url, wid)


AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001"
SHORT_GRACE_SECONDS = 5


def autopay_off(account_id: str, on: bool) -> None:
    kb = env_url("KILLBILL_URL")
    headers = {"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
               "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
               "X-Killbill-CreatedBy": "verifier"}
    auth = (os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"])
    path = f"{kb}/1.0/kb/accounts/{account_id}/tags"
    if on:
        r = httpx.post(path, json=[AUTO_PAY_OFF], headers=headers, auth=auth, timeout=HTTP_TIMEOUT)
        assert r.status_code < 300, r.text
    else:
        httpx.delete(path, params={"tagDef": AUTO_PAY_OFF}, headers=headers, auth=auth, timeout=HTTP_TIMEOUT)


def test_overdue_payment(app_url, killbill):
    sg = env_url("APP_SHORT_GRACE_URL")
    fac = sign_in(sg)
    b0 = billing(fac, sg)
    assert b0["state"] == "active" and b0["pastDueSince"] is None and b0["readOnlyAt"] is None
    target = upgrade_target(b0)
    assert target, "the seeded account has no immediate upgrade left"
    account = killbill.account_by_key(f"facilitator:{JUNO[0]}")
    assert account
    w = new_workshop(fac, sg)
    prob = fid(board(fac, sg, w["id"]), "Problems")
    blocked = seeded(4)
    autopay_off(account["accountId"], True)
    try:
        r = fac.req("POST", sg, "/api/billing/plan", {"clientOpId": op(), "plan": target[0], "term": target[1]})
        assert r.status_code == 200, r.text
        inv = r.json()["invoice"]
        assert inv and inv["status"] == "unpaid" and Decimal(inv["balance"]) > 0, inv
        due = eventually(lambda: (lambda x: x if x["pastDueSince"] else None)(billing(fac, sg)), EVENT_WAIT)
        assert due and due["state"] in ("past_due", "read_only"), due
        since = parse_iso(due["pastDueSince"])
        assert parse_iso(due["readOnlyAt"]) - since == timedelta(seconds=SHORT_GRACE_SECONDS)
        locked = eventually(lambda: (lambda x: x if x["state"] == "read_only" else None)(billing(fac, sg)),
                            EVENT_WAIT)
        assert locked and locked["pastDueSince"] == due["pastDueSince"]
        e = err(note_req(fac, sg, w["id"], prob, blocked), 402, "payment_required")
        assert e["message"] == "Your workspace is read-only until the overdue payment is settled"
        err(create_workshop(fac, sg), 402, "payment_required")
        assert all(n.get("text") != blocked for n in board(fac, sg, w["id"])["notes"])
        paid = fac.req("POST", sg, "/api/billing/payments", {"clientOpId": op()})
        assert paid.status_code == 200, paid.text
        after = paid.json()["billing"]
        assert after["state"] == "active" and after["pastDueSince"] is None
        assert [i["status"] for i in after["invoices"] if i["id"] == inv["id"]] == ["paid"]
        amounts = {Decimal(str(t["amount"])) for p in killbill.payments(account["accountId"])
                   for t in p.get("transactions", [])}
        assert Decimal(inv["balance"]) in amounts
        assert note_req(fac, sg, w["id"], prob, seeded(5)).status_code == 201
        err(fac.req("POST", sg, "/api/billing/payments", {"clientOpId": op()}), 409, "nothing_due")
    finally:
        autopay_off(account["accountId"], False)
        try:
            if billing(fac, sg)["state"] != "active":
                fac.req("POST", sg, "/api/billing/payments", {"clientOpId": op()})
        except Exception:
            pass
        retire(fac, sg, w["id"])


def test_health_and_manifest(app_url):
    instances = ((None, None), ("APP_REPLICA_URL", None), ("APP_MINIO_DOWN_URL", "minio"),
                 ("APP_MAILPIT_DOWN_URL", "mailpit"), ("APP_KILLBILL_DOWN_URL", "killbill"),
                 ("APP_SHORT_PURGE_URL", None), ("APP_SHORT_GRACE_URL", None))
    for env, down in instances:
        base = app_url if env is None else env_url(env)

        def healthy(base=base, down=down):
            r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
            j = r.json() if r.status_code == 200 else {}
            want = {s: ("down" if s == down else "up") for s in ("killbill", "minio", "mailpit")}
            return j if j and all(j.get(s) == v for s, v in want.items()) else None

        j = eventually(healthy, HEALTH_SECONDS * 2)
        assert j, f"{env or 'primary'} health never matched"
        assert set(j) == {"status", "instance", "db", "killbill", "minio", "mailpit"}
        assert j["status"] == "ok" and j["db"] == "up" and isinstance(j["instance"], str)
        if env == "APP_REPLICA_URL":
            assert j["instance"] == "b"


def test_server_boundary(app_url):
    evil = "http://evil.example"
    a = Actor()
    e = err(a.req("POST", app_url, "/api/session", {"email": JUNO[0], "password": JUNO[1]}, headers={"Origin": evil}),
            403, "cross_origin")
    assert e["message"] == "Cross-origin requests are not accepted" and not a.cookies
    h = httpx.get(app_url + "/api/health", headers={"Origin": evil}, timeout=HTTP_TIMEOUT)
    assert not any(k.lower().startswith("access-control-") for k in h.headers)
    shell = json.dumps({"email": "x@lanternfold.test", "password": ""})
    pad = JSON_LIMIT - len(shell)
    exact = json.dumps({"email": "x@lanternfold.test", "password": "p" * pad}).encode()
    assert len(exact) == JSON_LIMIT
    assert Actor().req("POST", app_url, "/api/session", raw=exact, ctype="application/json").status_code != 413
    err(Actor().req("POST", app_url, "/api/session", raw=exact + b" ", ctype="application/json"), 413, "too_large")
    err(Actor().req("POST", app_url, "/api/session", raw=b"email=x", ctype="text/plain"), 415, "unsupported_media_type")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json",
                 "/src/server.ts", "/server/index.ts"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT).status_code == 404, path
    html = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT).text
    scripts = re.findall(r'src="(/[^"]+\.js)"', html)
    bundles = [httpx.get(app_url + s, timeout=HTTP_TIMEOUT).text for s in scripts]
    for s in scripts:
        assert httpx.get(app_url + s + ".map", timeout=HTTP_TIMEOUT).status_code == 404
    for name in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "S3_BUCKET", "KILLBILL_PASSWORD",
                 "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "KILLBILL_URL", "S3_ENDPOINT"):
        value = os.environ.get(name, "")
        if len(value) >= 6:
            assert value not in html and all(value not in b for b in bundles), name


VIEWPORTS = ["375x812", "768x1024", "1280x800"]


@pytest.mark.parametrize("viewport", VIEWPORTS, ids=VIEWPORTS)
def test_wf_cross_cutting_responsive(browser, app_url, viewport):
    width, height = (int(x) for x in viewport.split("x"))
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w, workshop(app_url, fac) as done:
        walk_to(fac, app_url, done["id"], "closed", SHORT_SECONDS, 1)
        recap_path = "/recap/" + recap_token(recap_of(fac, app_url, done["id"]))
        paths = ["/", "/workshops", "/billing", "/activity", f"/join/{token_of(w)}", f"/w/{w['id']}", recap_path]
        with room(browser, app_url, fac, "/", size={"width": width, "height": height}) as page:
            for path in paths:
                page.goto(app_url + path)
                ui(page, lambda: shows(page.get_by_role("heading")), what=f"{path} heading")
                advance(page, 1000)
                layout(page)


def test_wf_cross_cutting_keyboard(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(ROOM_VIEW)
        ui(page, lambda: shows(page.get_by_role("heading", level=1)))
        names = tab_order(page, 15)
        for name in ("Sign in", "Start a workshop", "Play the reveal"):
            assert name in names
            loc = page.get_by_role("link" if name != "Play the reveal" else "button", name=name)
            _, focus = state_styles(loc, "outline-style", "outline-width", "box-shadow", state="focus")
            ring = float(re.sub(r"[^\d.]", "", focus["outline-width"]) or 0)
            assert (focus["outline-style"] != "none" and ring > 0) or focus["box-shadow"] != "none"
            box = loc.bounding_box()
            assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        with room(browser, app_url, fac, "/workshops") as page:
            opener = page.get_by_role("button", name="New workshop")
            ui(page, lambda: shows(opener))
            click(opener)
            ui(page, lambda: shows(page.get_by_role("dialog", name="New workshop")))
            page.keyboard.press("Escape")
            ui(page, lambda: page.get_by_role("dialog", name="New workshop").count() == 0
               and opener.evaluate(IS_FOCUSED_JS))
            page.goto(f"{app_url}/w/{w['id']}")
            wait_board(page)
            names = tab_order(page, 60)
            search_i = names.index("Search notes")
            rail_i = names.index("Problems", search_i)
            heading_i = names.index("Problems", rail_i + 1)
            tools_i = names.index("Add note")
            assert search_i < rail_i < names.index("Questions") < heading_i < tools_i < names.index("Fit board") \
                < names.index("Trash")
            for name in ("Add note", "Fit board", "Trash"):
                box = page.get_by_role("button", name=name, exact=True).bounding_box()
                assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX


def test_motion_discipline(browser, app_url):
    with room(browser, app_url, None, "/", hook=True) as page:
        ui(page, lambda: shows(page.get_by_role("heading", level=1)))
        check(page.get_by_role("radiogroup", name="Billing term").get_by_role("radio", name="Annual"))
        advance(page, 1000)
        for a in anims_since(page, 0):
            assert motion_allowed(a), a
        loops = page.evaluate(INFINITE_JS)
        assert loops and all(l["cycle"] == MESH_CYCLE_MS for l in loops), loops
        page.evaluate("document.getAnimations().forEach(a => a.pause())")
        hero = page.get_by_role("heading", level=1)
        first = decode(capture(hero))
        advance(page, 3000)
        assert difference(first, decode(capture(hero))) == 0
    with room(browser, app_url, None, "/", reduced="reduce") as page:
        ui(page, lambda: shows(page.get_by_role("heading", level=1)))
        assert page.evaluate(INFINITE_JS) == []
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p, _, _, _, _ = revealed_board(app_url, fac, w, (("Problems", "m1"), ("Problems", "m2")))
        with room(browser, app_url, p, f"/w/{w['id']}", hook=True) as page:
            wait_board(page)
            advance(page, 1000)
            assert all(motion_allowed(a) for a in anims_since(page, 0))


MOTION_CASES = ["hero_drift", "scroll_demo", "pricing_toggle", "card_entrance", "spring_drop", "number_ticker",
                "meter_fill", "cursor_glide"]


def _motion_board(browser, app_url, reduced, case):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        texts = [f"motion {i} {tag()}" for i in range(4)]
        p, _, p2, i2, _ = revealed_board(app_url, fac, w, tuple(("Problems", t) for t in texts))
        if case == "number_ticker":
            mk_cluster(fac, app_url, w["id"], fid(board(fac, app_url, w["id"]), "Problems"), CLUSTER_A, 500, 300)
            assert move(fac, app_url, w["id"], "voting", VOTE_SECONDS, DOTS).status_code == 200
        viewer = fac if case == "cursor_glide" else p
        with room(browser, app_url, viewer, f"/w/{w['id']}", reduced=reduced, hook=True) as page:
            wait_board(page)
            ui(page, lambda: shows(page.get_by_role("button", name=f"Note: {texts[0]}")))
            if case == "card_entrance":
                ours = [a for a in anims_since(page, 0) if any(t in a["label"] for t in texts) and a["duration"] > 0]
                if reduced == "reduce":
                    assert not ours
                    return
                assert ours, "no entrance animations"
                starts = {t: min(start_of(a) for a in ours if t in a["label"]) for t in texts
                          if any(t in a["label"] for a in ours)}
                assert len(starts) == len(texts)
                first = min(starts.values())
                assert max(starts.values()) - first <= ENTRANCE_LAST_START_MS + RANK_SLACK_MS
                assert all(a["duration"] <= ENTRANCE_NOTE_MS for a in ours)
                assert max(start_of(a) + a["duration"] for a in ours) - first <= ENTRANCE_TOTAL_MS + RANK_SLACK_MS
            elif case == "spring_drop":
                note = page.get_by_role("button", name=f"Note: {texts[0]}")
                x, y = center(note)
                holder: dict[str, float] = {}
                drag(page, note, x + 120, y + 60, before_up=lambda: holder.update(m=mark(page)))
                advance(page, 1000)
                springs = [a for a in anims_since(page, holder["m"]) if moving(a)]
                if reduced == "reduce":
                    assert not [a for a in springs if a["duration"] > 0]
                else:
                    assert springs and all(a["delay"] + a["duration"] <= SPRING_SETTLE_MS for a in springs)
            elif case == "number_ticker":
                start = mark(page)
                click(page.get_by_role("button", name=f"Add dot to {CLUSTER_A}"))
                ui(page, lambda: f"{1} of yours" in page.get_by_role("group",
                                                                    name=f"Cluster: {CLUSTER_A}").inner_text())
                advance(page, 1000)
                dbox = drawer(page).bounding_box()
                ticks = [a for a in anims_since(page, start) if moving(a) and inside(dbox, a)]
                if reduced == "reduce":
                    assert not [a for a in ticks if a["duration"] > 0]
                else:
                    assert ticks and all(a["duration"] <= TICKER_MS for a in ticks)
            else:
                path = f"/api/workshops/{w['id']}/presence"
                assert p2.req("POST", app_url, path, {"x": 100, "y": 100}).status_code == 204
                label = page.get_by_text(i2["displayName"], exact=True)
                ui(page, lambda: shows(label), what="cursor label")
                start = mark(page)
                assert p2.req("POST", app_url, path, {"x": 400, "y": 300}).status_code == 204
                ui(page, lambda: reduced == "reduce" or any(moving(a) for a in anims_since(page, start)),
                   what="cursor moved")
                advance(page, 1000)
                glides = [a for a in anims_since(page, start) if moving(a)]
                if reduced == "reduce":
                    assert not [a for a in glides if a["duration"] > 0]
                else:
                    assert glides and all(a["duration"] <= CURSOR_GLIDE_MS for a in glides)


def _motion_meter(browser, app_url, reduced):
    fac = sign_in(app_url)
    before = billing(fac, app_url)
    lower = downgrade_target(before)
    with room(browser, app_url, fac, "/billing", reduced=reduced, hook=True) as page:
        usage = page.get_by_role("list", name="Usage")
        ui(page, lambda: shows(usage.get_by_role("meter", name="Invites today")))
        advance(page, 1000)
        with workshop(app_url, fac) as w:
            r = fac.req("POST", app_url, f"/api/workshops/{w['id']}/invites", {"emails": [address("meter")]})
            assert r.status_code == 202
            status = page.get_by_role("status", name="Billing activity")
            start = mark(page)
            choose(page, *lower)
            click(page.get_by_role("button", name="Change plan"))
            ui(page, lambda: "starts on" in status.inner_text(), what="scheduled change")
            advance(page, 1000)
            box = usage.bounding_box()
            fills = [a for a in anims_since(page, start) if moving(a) and inside(box, a)]
            if reduced == "reduce":
                assert not [a for a in fills if a["duration"] > 0]
            else:
                assert fills and all(a["delay"] + a["duration"] <= METER_MS for a in fills)
            choose(page, before["plan"], before["term"])
            click(page.get_by_role("button", name="Change plan"))
            ui(page, lambda: "Scheduled change cancelled" in status.inner_text(), what="change cancelled")


@pytest.mark.parametrize("case", MOTION_CASES, ids=MOTION_CASES)
def test_motion_cases(browser, app_url, case):
    for reduced in ("no-preference", "reduce"):
        if case == "hero_drift":
            with room(browser, app_url, None, "/", reduced=reduced) as page:
                ui(page, lambda: shows(page.get_by_role("heading", level=1)))
                loops = page.evaluate(INFINITE_JS)
                if reduced == "reduce":
                    assert loops == []
                else:
                    assert any(l["cycle"] == MESH_CYCLE_MS for l in loops)
        elif case == "scroll_demo":
            with room(browser, app_url, None, "/", reduced=reduced, size={"width": 375, "height": 812}) as page:
                demo = page.get_by_role("region", name="Reveal demo")
                ui(page, lambda: shows(demo))
                page.evaluate("document.getAnimations().filter(a => a.effect && "
                              "a.effect.getTiming().iterations === Infinity).forEach(a => a.pause())")
                top = demo.evaluate("e => e.getBoundingClientRect().top + window.scrollY")
                lo, hi = max(top - DEMO_START * 812, 0), top - DEMO_END * 812
                assert hi > lo
                steps = [lo + (hi - lo) * i / 4 for i in range(5)]
                caps = []
                for y in steps + steps[::-1][1:]:
                    page.evaluate("y => window.scrollTo(0, y)", y)
                    advance(page, 100)
                    caps.append(decode(capture(demo)))
                diffs = [difference(caps[0], c) for c in caps]
                if reduced == "reduce":
                    assert max(diffs) == 0
                else:
                    assert diffs[:5] == sorted(diffs[:5]) and diffs[4] > 0
                    assert diffs[4:] == sorted(diffs[4:], reverse=True) and diffs[-1] == 0
        elif case == "pricing_toggle":
            with room(browser, app_url, None, "/", reduced=reduced, hook=True) as page:
                plans = page.get_by_role("region", name="Plans")
                term = plans.get_by_role("radiogroup", name="Billing term")
                ui(page, lambda: shows(term))
                assert term.get_by_role("radio", name="Monthly").is_checked()
                groups = {p: plans.get_by_role("group", name=f"{p} plan") for p in ("Free", "Studio", "Agency")}
                assert price_text("Studio", "Monthly") in squash(groups["Studio"].inner_text())
                boxes = {p: g.bounding_box() for p, g in groups.items()}
                start = mark(page)
                check(term.get_by_role("radio", name="Annual"))
                ui(page, lambda: price_text("Studio", "Annual") in squash(groups["Studio"].aria_snapshot()))
                advance(page, 1000)
                assert price_text("Agency", "Annual") in squash(groups["Agency"].inner_text())
                assert squash("€0.00 / month") in squash(groups["Free"].inner_text())
                new = [a for a in anims_since(page, start) if a["duration"] > 0]
                assert not [a for a in new if inside(boxes["Free"], a)]
                for p in ("Studio", "Agency"):
                    rolls = [a for a in new if inside(boxes[p], a)]
                    if reduced == "reduce":
                        assert not rolls
                    else:
                        assert rolls and all(a["duration"] <= PRICE_ROLL_MS for a in rolls)
        elif case == "meter_fill":
            _motion_meter(browser, app_url, reduced)
        else:
            _motion_board(browser, app_url, reduced, case)


RATE_CASES = ["signin", "join", "board_writes", "uploads", "presence"]


def _rate_check(responses, limit, window):
    limited = [r for r in responses if r.status_code == 429]
    assert limited, "limit never reached"
    r = limited[0]
    assert err(r, 429, "rate_limited")["message"] == "Too many requests — try again shortly"
    assert int(r.headers["RateLimit-Limit"]) == limit and int(r.headers["RateLimit-Remaining"]) == 0
    assert r.headers["Retry-After"] == r.headers["RateLimit-Reset"] and 1 <= int(r.headers["Retry-After"]) <= window
    assert all(int(x.headers["RateLimit-Limit"]) == limit for x in responses if x.status_code != 429)


@pytest.mark.parametrize("case", RATE_CASES, ids=RATE_CASES)
def test_rate_limits(app_url, case):
    if case == "signin":
        who = address("nobody")
        rs = [Actor().req("POST", app_url, "/api/session", {"email": who, "password": "wrong"})
              for _ in range(2 * SIGNIN_LIMIT + 1)]
        assert rs[0].status_code == 401
        _rate_check(rs, SIGNIN_LIMIT, SIGNIN_WINDOW)
        assert all(r.status_code == 429 for r in rs[SIGNIN_LIMIT:])
        return
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        p, _, _, _, made = revealed_board(app_url, fac, w)
        with cf.ThreadPoolExecutor(16) as ex:
            if case == "join":
                tok = token_of(w)
                rs = list(ex.map(lambda i: Actor().req("POST", app_url, f"/api/join/{tok}", {"displayName": f"R{i}"}),
                                 range(2 * JOIN_LIMIT + 1)))
                _rate_check(rs, JOIN_LIMIT, JOIN_WINDOW)
            elif case == "board_writes":
                rs = list(ex.map(lambda i: patch_note(p, app_url, made[0]["id"], position={"x": i, "y": i}),
                                 range(3 * WRITE_LIMIT + 1)))
                _rate_check(rs, WRITE_LIMIT, WRITE_WINDOW)
            elif case == "uploads":
                rs = list(ex.map(lambda i: upload(p, app_url, w["id"]), range(2 * UPLOAD_LIMIT + 1)))
                _rate_check(rs, UPLOAD_LIMIT, UPLOAD_WINDOW)
            else:
                path = f"/api/workshops/{w['id']}/presence"
                rs = list(ex.map(lambda i: p.req("POST", app_url, path, {"x": i, "y": 0}),
                                 range(3 * PRESENCE_LIMIT + 1)))
                _rate_check(rs, PRESENCE_LIMIT, PRESENCE_WINDOW)


def shipped_packages() -> list[dict]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=DEPLOYED_APP,
                         capture_output=True, text=True, timeout=600, check=False)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple, dict] = {}
    stack = list((tree.get("dependencies") or {}).items())
    while stack:
        name, node = stack.pop()
        if (name, node.get("version")) in found:
            continue
        lic = node.get("license")
        if lic is None and node.get("path"):
            pj = Path(node["path"]) / "package.json"
            if pj.exists():
                lic = json.loads(pj.read_text()).get("license")
        if isinstance(lic, dict):
            lic = lic.get("type")
        found[(name, node.get("version"))] = {"name": name, "version": node.get("version"), "license": lic}
        stack += list((node.get("dependencies") or {}).items())
    assert found, ("npm ls found no production packages", out.stderr[:300])
    return list(found.values())


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    assert packages
    assert [p["name"] for p in packages if p["name"] not in notices] == []
    for name in ("IBM Plex Sans", "IBM Plex Mono", "Instrument Serif", "Lucide"):
        assert name in notices


def test_if_licences():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
    bad = []
    for p in shipped_packages():
        parts = re.split(r"\s+OR\s+", str(p["license"] or "").strip("()"))
        if not any(part.strip("() ") in allowed for part in parts):
            bad.append(p)
    assert bad == []
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    banned = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "lowdb",
              "level", "nedb", "memcached", "lokijs", "@prisma/adapter-sqlite"}
    assert {p["name"] for p in shipped_packages()} & banned == set()


def test_if_services_unchanged(app_url, mail):
    j = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT).json()
    assert (j["db"], j["minio"], j["mailpit"], j["killbill"]) == ("up", "up", "up", "up")
    fac = sign_in(app_url)
    target = address("from")
    with workshop(app_url, fac) as w:
        assert fac.req("POST", app_url, f"/api/workshops/{w['id']}/invites", {"emails": [target]}).status_code == 202
        msgs = wait_mails(mail, target, 1, "You're invited")
        assert msgs
        sender = msgs[0]["From"]
        assert [a.lower() for a in addresses(sender if isinstance(sender, list) else [sender])] == \
            [mail_from_address().lower()]


def test_if_same_origin_assets(browser, app_url):
    fac = sign_in(app_url)
    with workshop(app_url, fac) as w:
        with room(browser, app_url, fac, "/") as page:
            urls: list[str] = []
            page.on("request", lambda r: urls.append(r.url))
            for path in ("/", "/signin", f"/w/{w['id']}"):
                page.goto(app_url + path)
                ui(page, lambda: shows(page.get_by_role("heading")))
            foreign = [u for u in urls if u.startswith("http") and not same_origin(u, app_url)]
            assert foreign == []


def test_if_typescript_only():
    offenders, ts = [], 0
    for root, dirs, files in os.walk("/app"):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist", "build", "out")]
        for f in files:
            if f.endswith((".ts", ".tsx")):
                ts += 1
            if f.endswith((".js", ".cjs", ".mjs", ".jsx")):
                ok = f.startswith(".") or re.search(r"(\.config|rc)\.(c|m)?js$", f)
                if not ok:
                    offenders.append(os.path.join(root, f))
    assert ts > 0 and offenders == []
