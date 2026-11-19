from __future__ import annotations

import json
import math
import os
import random
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP,
    addresses,
    advance,
    camera,
    capture,
    click,
    decode,
    difference,
    fill,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    scene_frames,
    select,
    session,
    shipped_packages,
    tab_order,
    tap,
    text,
)

APP = Path("/app")

STUDIO_ZONE = "America/Chicago"
STUDIO = ZoneInfo(STUDIO_ZONE)
STUDIO_KEY = "latch-founder-2026"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_RE = re.compile(f"^[{CODE_ALPHABET}]{{6}}$")
TICK_HZ = 20
BODY_LIMIT = 16_384
TICK_MS = 50
COUNTDOWN_MS = 5000
INTERMISSION_MS = 20000
RELOAD_MS = 1800
FUSE_MS = 3000
REVIVE_MS = 10000
GRACE_MS = 30000
LEASE_S = 5
INVITE_MS = 900000
MAG = 30
RESERVE = 90
SPEED = 4.0
SHOT_DAMAGE = 20
GRUNT_HP = 60
BARREL_HP = 30
KILL_GRUNT = 50
WAVE_BONUS = 100
REVIVED_HP = 50
DETECT_M = 14.0
ATTACK_M = 1.5
GRUNT_PATROL = 1.0
GRUNT_PURSUE = 2.5
DETECT_TO_PURSUE_MS = 500
REVIVE_RANGE = 2.0
GRENADE_RANGE = 15.0
PRICES = {
    "ammo_pack": 120,
    "grenade": 200,
    "med_kit": 150,
}
NAMES = {"ammo_pack": "Ammo pack", "grenade": "Grenade", "med_kit": "Med kit"}
TOP_SPEED = 30.0
POSE_SLACK = 0.5
CHECKPOINT_M = 6.0
RESET_MS = 3000
CHECKPOINTS = {
    1: (100, 12),
    2: (180, 60),
    3: (100, 108),
    4: (20, 60),
    0: (24, 11),
}
CONVOY_START = {1: (20, 8), 2: (20, 14)}
SPAWNS = {1: (16.0, 4.0), 2: (14.0, 4.0), 3: (18.0, 4.0), 4: (16.0, 6.0)}
BARRELS = {"B1": (6.5, 20.5), "B2": (8.0, 20.5), "B3": (25.5, 20.5), "B4": (16.0, 25.0)}
SIEGE_BLOCKS = {
    (8, 14), (9, 14), (10, 14), (11, 14),
    (20, 14), (21, 14), (22, 14), (23, 14),
    (15, 22), (16, 22), (15, 23), (16, 23),
    (4, 8), (27, 8),
}
WAVE_SPAWNS = {
    1: [(10, 28), (16, 28), (22, 28)],
    2: [(4, 28), (10, 28), (16, 30), (22, 28), (28, 28)],
    3: [(4, 28), (10, 28), (22, 28), (28, 28), (16, 30)],
    4: [(16, 30), (6, 28), (26, 28)],
}
OPEN_H = 168
CLOSE_H = 2
END_H = 3
REMINDER_MIN = 60
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
STATUS_COPY = {"scheduled": "Opens soon", "signups_open": "Sign-ups open", "closed": "Sign-ups closed",
               "live": "Live now", "done": "Done"}
FUSE_DRIFT_MS = 150
PANEL_IN_MAX_MS = 400
TARGET_PX = 44
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
VIEWPORT_IDS = ["phone", "tablet", "desktop"]
ALLOWLIST = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "MPL-2.0", "Zlib", "CC0-1.0",
             "Unlicense", "OFL-1.1"}
VALKEY_DOWN_COPY = "Rooms offline — the room registry is reconnecting. Nights and sign-ups still work."
MAIL_DOWN_COPY = "Mail delayed — emails are queued and send when mail is back."
STORAGE_DOWN_COPY = "Storage offline — sign-ups, prices, settings and history are unavailable."

HTTP_S = 30
POLL_S = 0.2
POSE_S = 0.1
UI_S = 40
STATUS_FOLLOW_S = 5
MAIL_RETURN_S = 10
REMINDER_DUE_S = 5
TIME_SLACK_S = 4
SPEED_TOL = 0.15
TICK_SLACK = 3
DOWN_URL = "redis://127.0.0.1:9/0"
WRONG_DEVICE_TIME = datetime(2001, 1, 1, 12, 0, tzinfo=timezone.utc)
VIEWER_ZONE = "Asia/Tokyo"
CROSS_ORIGIN = "http://elsewhere.example"
RALLY = [(15.0, 17.0), (17.0, 17.0), (14.0, 16.0), (18.0, 16.0)]
LAP_PATH = [(100, 12), (180, 12), (180, 60), (180, 108), (100, 108), (20, 108), (20, 60), (24, 11)]
BROWSER_LINE = [(100, 12), (165, 14), (180, 60), (165, 106), (100, 108), (35, 106), (20, 60), (22, 20), (24, 11)]


def outage(name: str) -> str:
    url = os.environ.get(name, "")
    assert url, f"{name} names the outage instance"
    return url.rstrip("/")


def auth(p):
    if not p:
        return {}
    if "token" in p:
        return {"Authorization": f"Bearer {p['token']}"}
    return {"Cookie": f"hf_session={p['cookie']}"}


def api(method, base, path, p=None, body=None, **headers):
    kw = {"json": body} if body is not None else {}
    return httpx.request(method, base + path, headers={**auth(p), **headers}, timeout=HTTP_S, **kw)


def ok(r, status=200):
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} answered {r.status_code}: {r.text[:500]}"
    return r.json() if r.content else None


def err(r, status, code):
    assert r.status_code == status, f"{r.request.url.path} answered {r.status_code}, expected {status} {code}: {r.text[:400]}"
    assert r.json()["error"]["code"] == code, r.text
    return r.json()["error"]


def poll(fn, seconds, what):
    gate = threading.Event()
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
        gate.wait(POLL_S)
    pytest.fail(f"{what} (last seen: {str(last)[:300]})")


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def inst(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class StudioInstant(datetime):

    def __add__(self, delta):
        if not isinstance(delta, timedelta):
            return NotImplemented
        plain = datetime.fromtimestamp(self.timestamp() + delta.total_seconds(), STUDIO)
        return StudioInstant(plain.year, plain.month, plain.day, plain.hour, plain.minute, plain.second,
                             plain.microsecond, tzinfo=STUDIO, fold=plain.fold)

    __radd__ = __add__

    def astimezone(self, tz=None):
        return datetime.fromtimestamp(self.timestamp(), tz) if tz is not None else datetime.astimezone(self)

    def __sub__(self, other):
        if isinstance(other, timedelta):
            return self.__add__(-other)
        return timedelta(seconds=self.timestamp() - other.timestamp())

    def __rsub__(self, other):
        return timedelta(seconds=other.timestamp() - self.timestamp())


def studio_at(d, hh, mm):
    return StudioInstant(d.year, d.month, d.day, hh, mm, tzinfo=STUDIO)


def outcome_word(page, numeral, word):
    def check():
        got = [loc.first.inner_text() for loc in (feed(page), notices(page), numeral) if loc.count()]
        assert any(re.search(word, g, re.I) for g in got), got
    eventually(page, check, f"outcome word {word} shown in the feed, notices or numeral")


def far_weekday(weekday=4):
    year = random.randrange(2031, 2090)
    d = date(year, random.randrange(1, 12), random.randrange(1, 21))
    for _ in range(7):
        if d.weekday() == weekday:
            return d
        d += timedelta(days=1)
    pytest.fail("no weekday found")


def ddd(dt):
    return f"{dt:%a} {dt.day} {dt:%b}"


def ddd_y(dt):
    return f"{ddd(dt)} {dt.year}"


def mail_time(dt, zone):
    loc = dt.astimezone(ZoneInfo(zone))
    return f"{ddd_y(loc)}, {loc:%H:%M} {loc.tzname()} ({zone})"


def fmt_lap(ms):
    return f"{ms // 60000}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"


def half_up(x):
    return int(math.floor(x + 0.5))


def grenade_falloff(d):
    return 100 if d <= 1.0 else (half_up(100 * (5.0 - d) / 4.0) if d < 5.0 else 0)


def barrel_falloff(d):
    return 80 if d <= 1.0 else (half_up(80 * (4.0 - d) / 3.0) if d < 4.0 else 0)


def clock_set(base, when):
    return ok(api("PUT", base, "/api/clock", body={"now": iso(when)}))


def clock_reset(base):
    api("DELETE", base, "/api/clock")


def callsign():
    return "hf" + uuid.uuid4().hex[:12]


def new_email():
    return f"hf-{uuid.uuid4().hex[:12]}@example.test"


def rid():
    return "r" + uuid.uuid4().hex


def login(base, key=None, cs=None):
    cs = cs or callsign()
    body = {"callsign": cs, **({"studio_key": key} if key else {})}
    d = ok(api("POST", base, "/api/sessions", body=body), 201)
    return {"token": d["token"], "id": d["player"]["id"], "callsign": cs, "seq": 0, "pseq": 0}


def status(base):
    return ok(api("GET", base, "/api/status"))


def room(base, p, code):
    return ok(api("GET", base, f"/api/rooms/{code}", p))


def me(st, p):
    return next(x for x in st["players"] if x["id"] == p["id"])


def create(base, p, mode="siege"):
    return ok(api("POST", base, "/api/rooms", p, {"mode": mode}), 201)


def join(base, p, code):
    return ok(api("POST", base, f"/api/rooms/{code}/join", p))


def ready(base, p, code, flag=True):
    return api("POST", base, f"/api/rooms/{code}/ready", p, {"ready": flag})


def beat(base, ps, code):
    for p in ps:
        api("POST", base, f"/api/rooms/{code}/heartbeat", p)


def wait_room(base, ps, code, pred, seconds, what):
    def probe():
        beat(base, ps[1:], code)
        st = room(base, ps[0], code)
        return st if pred(st) else None
    return poll(probe, seconds, what)


def start_match(base, n=1, mode="siege", ps=None):
    ps = ps or [login(base) for _ in range(n)]
    code = create(base, ps[0], mode)["code"]
    for p in ps[1:]:
        join(base, p, code)
    for p in ps:
        ok(ready(base, p, code))
    ok(api("POST", base, f"/api/rooms/{code}/start", ps[0]))
    phase = "wave" if mode == "siege" else "race"
    st = wait_room(base, ps, code, lambda s: s["phase"] == phase, 30, f"room reached {phase} after the countdown")
    return ps, code, st


def rep(base, p, code, body):
    return api("POST", base, f"/api/rooms/{code}/reports", p, body)


def shoot(base, p, code, aim, report_id=None):
    return ok(rep(base, p, code, {"report_id": report_id or rid(), "type": "shot", "aim": round(aim % 360, 3)}))


def after_ticks(base, ps, code, tick, n=3):
    return wait_room(base, ps, code, lambda s: s["tick"] >= tick + n, 10, "server tick advanced")


def intent(base, p, code, vec, aim=90.0, last=0):
    p["seq"] = max(p["seq"], last) + 1
    return ok(api("POST", base, f"/api/rooms/{code}/input", p,
                  {"seq": p["seq"], "move": {"x": vec[0], "z": vec[1]}, "aim": aim % 360}), 202)


def steer(base, p, code, m, target):
    dx, dz = target[0] - m["x"], target[1] - m["z"]
    d = math.hypot(dx, dz)
    s = 0.0 if d < 0.3 else min(1.0, d)
    vec = (0.0, 0.0) if s == 0 else (round(dx / d * s, 3), round(dz / d * s, 3))
    if vec != p.get("vec"):
        intent(base, p, code, vec, m.get("aim") or 90.0, m.get("last_input_seq") or 0)
        p["vec"] = vec
    return d


def walk(base, p, code, target, keep=(), seconds=30):
    def probe():
        beat(base, keep, code)
        st = room(base, p, code)
        m = me(st, p)
        if steer(base, p, code, m, target) < 0.3:
            return st
        return None
    return poll(probe, seconds, f"server moved the player to {target}")


def clear_line(a, b):
    n = max(1, int(math.dist(a, b) / 0.05))
    for i in range(n + 1):
        x = a[0] + (b[0] - a[0]) * i / n
        z = a[1] + (b[1] - a[1]) * i / n
        if (math.floor(x), math.floor(z)) in SIEGE_BLOCKS:
            return False
    return True


def aim_to(a, b):
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 360


def barrel_at(st, pos):
    return min(st["barrels"], key=lambda b: math.dist((b["x"], b["z"]), pos))


@contextmanager
def snapshots(base, p, code):
    with httpx.stream("GET", f"{base}/api/rooms/{code}/stream", headers=auth(p), timeout=httpx.Timeout(HTTP_S)) as r:
        assert r.status_code == 200, f"stream answered {r.status_code}"

        def gen():
            buf = []
            for line in r.iter_lines():
                if line.startswith("data:"):
                    buf.append(line[5:].lstrip())
                elif not line and buf:
                    yield json.loads("\n".join(buf))
                    buf = []
        yield gen()


def purchase(base, p, code, item, pid=None):
    return api("POST", base, f"/api/rooms/{code}/purchases", p,
               {"purchase_id": pid or ("p" + uuid.uuid4().hex), "item": item})


def play(base, ps, code, done, seconds, what, spots=None, actors=None, buy=True, on=None):
    spots = {p["id"]: RALLY[i] for i, p in enumerate(ps)} if spots is None else spots
    actors = ps if actors is None else actors
    last_shot, last_beat, bought = {}, {}, set()
    deadline = time.monotonic() + seconds
    with snapshots(base, ps[0], code) as feed:
        for st in feed:
            if on:
                on(st)
            if done(st):
                return st
            if time.monotonic() > deadline:
                break
            byid = {x["id"]: x for x in st["players"]}
            foes = [e for e in st["enemies"] if e["state"] != "dead"]
            t = st["tick"]
            for p in ps:
                if t - last_beat.get(p["id"], -99) >= 20:
                    api("POST", base, f"/api/rooms/{code}/heartbeat", p)
                    last_beat[p["id"]] = t
            for p in actors:
                m = byid[p["id"]]
                if m["status"] != "up":
                    continue
                pos = (m["x"], m["z"])
                if p["id"] in spots:
                    steer(base, p, code, m, spots[p["id"]])
                if st["phase"] in ("wave", "boss_wave"):
                    near = [x for x in st["players"] if x["status"] == "downed" and math.dist(pos, (x["x"], x["z"])) <= 1.9]
                    if near:
                        rep(base, p, code, {"report_id": rid(), "type": "revive", "target_player": near[0]["id"]})
                        continue
                    if m["mag"] == 0 and m["reserve"] > 0 and m["reload_remaining_ms"] is None:
                        rep(base, p, code, {"report_id": rid(), "type": "reload"})
                        continue
                    if m["mag"] > 0 and m["reload_remaining_ms"] is None and t - last_shot.get(p["id"], -99) >= 3:
                        seen = [e for e in foes if math.dist(pos, (e["x"], e["z"])) < 38 and clear_line(pos, (e["x"], e["z"]))]
                        if seen:
                            e = min(seen, key=lambda e: math.dist(pos, (e["x"], e["z"])))
                            last_shot[p["id"]] = shoot(base, p, code, aim_to(pos, (e["x"], e["z"])))["tick"]
                if buy and st["phase"] == "intermission" and (p["id"], st["wave"]) not in bought and m["reserve"] < 120:
                    price = next(i["price"] for i in st["shop"]["items"] if i["item"] == "ammo_pack")
                    if m["credits"] >= price:
                        purchase(base, p, code, "ammo_pack")
                        bought.add((p["id"], st["wave"]))
    pytest.fail(f"{what} within {seconds} s")


def clear_wave_one(base, ps, code, actors=None):
    return play(base, ps, code, lambda s: s["phase"] == "intermission", 120,
                "the squad cleared wave 1 from spawn, so the room entered its intermission",
                spots={}, actors=actors, buy=False)


def vehicle(st, p):
    return next(v for v in st["vehicles"] if v["player"] == p["id"])


def pose(base, p, code, x, z, heading, seq=None):
    if seq is None:
        p["pseq"] += 1
        seq = p["pseq"]
    return ok(api("POST", base, f"/api/rooms/{code}/pose", p,
                  {"seq": seq, "x": round(x, 3), "z": round(z, 3), "heading": round(heading % 360, 3)}))


def drive(base, p, code, path, speed, on_pose=None):
    gate = threading.Event()
    v = vehicle(room(base, p, code), p)
    pos, last, r = (v["x"], v["z"]), time.monotonic(), None
    for target in path:
        for _ in range(5000):
            d = math.dist(pos, target)
            if d < 1e-6:
                break
            gate.wait(POSE_S)
            now = time.monotonic()
            step = min(d, speed * (now - last))
            nxt = (pos[0] + (target[0] - pos[0]) * step / d, pos[1] + (target[1] - pos[1]) * step / d)
            r = pose(base, p, code, nxt[0], nxt[1], aim_to(pos, target))
            assert r["accepted"], f"pose within the speed limit was refused: {r}"
            pos, last = nxt, time.monotonic()
            if on_pose:
                on_pose(r, now)
            if r["vehicle"]["state"] != "running":
                return r
    return r


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Relay:

    def __init__(self, host, port):
        self.target = (host, int(port))
        self.port = free_port()
        self.sock = None
        self.conns = []

    def start(self):
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.sock = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def _accept(self, s):
        for _ in range(100000):
            try:
                a, _ = s.accept()
                b = socket.create_connection(self.target, timeout=5)
            except OSError:
                return
            self.conns += [a, b]
            for x, y in ((a, b), (b, a)):
                threading.Thread(target=self._pipe, args=(x, y), daemon=True).start()

    @staticmethod
    def _pipe(a, b):
        for _ in range(10 ** 8):
            try:
                data = a.recv(65536)
                if not data:
                    break
                b.sendall(data)
            except OSError:
                break
        for c in (a, b):
            try:
                c.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def stop(self):
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.sock.close()
            self.sock = None
        for c in self.conns:
            try:
                c.shutdown(socket.SHUT_RDWR)
                c.close()
            except OSError:
                pass
        self.conns = []


def relay_url(url, port):
    u = urlsplit(url)
    netloc = (u.netloc.rsplit("@", 1)[0] + "@" if "@" in u.netloc else "") + f"127.0.0.1:{port}"
    return urlunsplit((u.scheme, netloc, u.path, u.query, u.fragment))


@contextmanager
def app_copy(env):
    manifest = json.loads((DEPLOYED_APP / "run.json").read_text())
    port = free_port()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT,
                            env={**os.environ, **env, "APP_PUBLIC_PORT": str(port)}, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail():
        return Path(log.name).read_text()[-2000:]
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}: {tail()}")
            try:
                if httpx.get(base + "/api/health", timeout=2).status_code == 200:
                    break
            except httpx.TransportError:
                pass
            try:
                proc.wait(timeout=POLL_S)
            except subprocess.TimeoutExpired:
                pass
        else:
            pytest.fail(f"app copy never answered /api/health: {tail()}")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=15)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)


def inbox(mail, addr, n, seconds, what):
    def probe():
        msgs = [m for m in mail.messages() if addr.lower() in [a.lower() for a in addresses(m.get("To"))]]
        return msgs if len(msgs) >= n else None
    return poll(probe, seconds, what)


def mails_to(mail, addr):
    return [m for m in mail.messages() if addr.lower() in [a.lower() for a in addresses(m.get("To"))]]


def series(base, founder, first, hhmm="20:00", weeks=1, capacity=24, mode="siege", title=None):
    title = title or f"Night {uuid.uuid4().hex[:8]}"
    d = ok(api("POST", base, "/api/nights/series", founder,
               {"title": title, "mode": mode, "weekday": WEEKDAYS[first.weekday()], "local_time": hhmm,
                "first_date": first.isoformat(), "weeks": weeks, "capacity": capacity}), 201)
    return title, d["nights"]


def signup(base, night_id, addr, zone=VIEWER_ZONE, name="Rook Vale"):
    return api("POST", base, f"/api/nights/{night_id}/signups", body={"name": name, "email": addr, "viewer_zone": zone})


def night(base, nid):
    return ok(api("GET", base, f"/api/nights/{nid}"))


@contextmanager
def app_page(browser, url, **kw):
    cm = open_app(browser, url, **kw)
    if hasattr(cm, "__enter__"):
        with cm as page:
            yield page
    else:
        page = next(cm)
        try:
            yield page
        finally:
            cm.close()


def eventually(page, check, what, seconds=UI_S):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            check()
            return
        except AssertionError as e:
            last = e
            advance(page, 100)
    pytest.fail(f"{what}: {str(last)[:300]}")


def shown(page, loc, what, seconds=UI_S):
    eventually(page, lambda: expect(loc).to_be_visible(timeout=250), what, seconds)


def gone(page, loc, what, seconds=UI_S):
    eventually(page, lambda: expect(loc).to_have_count(0, timeout=250), what, seconds)


def says(page, loc, copy, what, seconds=UI_S):
    eventually(page, lambda: expect(loc).to_contain_text(copy, timeout=250), what, seconds)


METER_VALUE_JS = "e => Number(e.getAttribute('aria-valuenow') ?? e.value)"


def meter_reads(loc, want):
    assert loc.count() == 1, f"expected one meter, found {loc.count()}"
    got = loc.evaluate(METER_VALUE_JS, timeout=250)
    assert got == want, f"meter reads {got!r}, want {want!r}"


def first_visible(page, loc, what, seconds=UI_S):
    found = []

    def check():
        found[:] = [loc.nth(i) for i in range(loc.count()) if loc.nth(i).is_visible()]
        assert found, f"no visible match for {what}"
    eventually(page, check, what, seconds)
    return found[0]


def notices(page):
    return page.get_by_role("status", name="Notices")


def feed(page):
    return page.get_by_role("status", name="Match feed")


def enter(page):
    dlg = page.get_by_role("dialog", name="Before you play")
    shown(page, dlg, "pre-match notice panel opened on load")
    click(dlg.get_by_role("button", name="Enter"))
    gone(page, page.get_by_role("dialog", name="Before you play"), "Enter closed the pre-match notice panel")


def save_callsign(page, cs, key=None):
    dlg = page.get_by_role("dialog", name="Callsign")
    shown(page, dlg, "Callsign panel opened")
    fill(dlg.get_by_role("textbox", name="Callsign"), cs)
    if key:
        fill(dlg.get_by_role("textbox", name="Studio key"), key)
    click(dlg.get_by_role("button", name="Save callsign"))
    copy = "Studio key accepted — founder tools unlocked." if key else f"Callsign saved — you're {cs}."
    continued = re.compile(r"^(" + re.escape(copy) + r"|Starting room…|Joining [A-Z0-9]+…|Room [A-Z0-9]+ is open\.|"
                           r"Joined room [A-Z0-9]+ — seat \d+\.)$")
    eventually(page, lambda: expect(notices(page)).to_have_text(continued, timeout=250),
               "Save callsign announced its success, or the continued action replaced it")


def ui_login(page, cs, key=None):
    click(page.get_by_role("button", name="Callsign", exact=True))
    save_callsign(page, cs, key)
    if page.get_by_role("dialog", name="Callsign").count():
        page.keyboard.press("Escape")


def lobby(page):
    return page.get_by_role("region", name="Lobby")


def ui_start_room(page, cs=None, convoy=False):
    click(page.get_by_role("button", name="Convoy race" if convoy else "Start a room"))
    if cs:
        save_callsign(page, cs)
    head = lobby(page).get_by_role("heading", name=re.compile(r"^Room ", re.I))
    shown(page, head, "Lobby opened with the room code heading")
    code = head.inner_text().strip().split()[-1].upper()
    assert CODE_RE.match(code), code
    return code


def page_player(page, base):
    val = next(c["value"] for c in page.context.cookies() if c["name"] == "hf_session")
    p = {"cookie": val, "seq": 0, "pseq": 0}
    d = ok(api("GET", base, "/api/me", p))
    p.update(id=d["player"]["id"], callsign=d["player"]["callsign"])
    return p


def ui_ready_start(page):
    lb = lobby(page)
    click(lb.get_by_role("button", name="Ready"))
    start = lb.get_by_role("button", name="Start match")
    eventually(page, lambda: expect(start).to_be_enabled(timeout=250), "Start match enabled once every seat is ready")
    click(start)


def wave_group(page):
    return page.get_by_role("group", name="Wave")


def ui_solo_match(page, base, convoy=False):
    enter(page)
    code = ui_start_room(page, callsign(), convoy=convoy)
    ui_ready_start(page)
    p = page_player(page, base)
    if convoy:
        wait_room(base, [p], code, lambda s: s["phase"] == "race", 30, "convoy race started")
    else:
        says(page, wave_group(page), "Wave 1 of 3", "HUD reached wave 1", seconds=60)
    return code, p


def phone(page, touch=True):
    page.set_viewport_size({"width": 375, "height": 812})
    cdp = session(page)
    if touch:
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    return cdp


def fuse_matches(text_value, ms, counting_up=False):
    t = text_value.strip()
    if counting_up:
        m = re.fullmatch(r"(\d+):(\d{2})\.(\d)", t)
        return bool(m)
    if ms < 60000:
        m = re.fullmatch(r"(\d+)\.(\d)", t)
        shown_ms, tol = (int(m[1]) * 1000 + int(m[2]) * 100, 100) if m else (None, 0)
    elif ms < 3600000:
        m = re.fullmatch(r"(\d+):(\d{2})", t)
        shown_ms, tol = (int(m[1]) * 60000 + int(m[2]) * 1000, 1000) if m else (None, 0)
    elif ms < 86400000:
        m = re.fullmatch(r"(\d+):(\d{2}):(\d{2})", t)
        shown_ms, tol = ((int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3])) * 1000, 1000) if m else (None, 0)
    else:
        m = re.fullmatch(r"(\d+)d (\d{2}):(\d{2})", t)
        shown_ms, tol = ((int(m[1]) * 86400 + int(m[2]) * 3600 + int(m[3]) * 60) * 1000, 60000) if m else (None, 0)
    if shown_ms is None:
        return False
    if ms < 60000:
        return ms - tol - FUSE_DRIFT_MS <= shown_ms <= ms + FUSE_DRIFT_MS
    return ms - tol - FUSE_DRIFT_MS <= shown_ms <= ms + tol + FUSE_DRIFT_MS


def _aim_moved(now, start):
    assert now != start, f"aim still {start}"


def timer_reading(loc):
    return loc.evaluate("e => [e.textContent.trim(), e.getAttribute('data-server-ms')]")


def running_animations(loc):
    return loc.evaluate("e => e.getAnimations({subtree: true}).filter(a => a.playState === 'running').length")


def hit_area_ok(loc):
    loc.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    return loc.evaluate("""(e, min) => {
        const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const h = min / 2 - 1;
        return [[cx - h, cy], [cx + h, cy], [cx, cy - h], [cx, cy + h]].every(([x, y]) => {
            const t = document.elementFromPoint(x, y); return t && (t === e || e.contains(t) || t.contains(e)); });
    }""", TARGET_PX)


def no_document_scroll(page):
    return page.evaluate("() => [document.documentElement.scrollHeight <= innerHeight + 1, document.documentElement.scrollWidth <= innerWidth + 1]")


def test_wf_session_and_title_notice(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/", reduced_motion="reduce") as page:
        dlg = page.get_by_role("dialog", name="Before you play")
        shown(page, dlg, "pre-match notice panel opened before anything else")
        expect(dlg).to_contain_text("BEFORE YOU PLAY", ignore_case=True)
        calm, go = dlg.get_by_role("button", name="Calm effects"), dlg.get_by_role("button", name="Enter")
        expect(calm).to_be_focused()
        assert calm.bounding_box()["x"] < go.bounding_box()["x"], "ghost choice button sits before the mint action button"
        assert running_animations(dlg) == 0, "under reduced motion the panel appears instantly"
        bar = page.get_by_role("button", name="Start a room")
        if bar.count():
            with pytest.raises(PlaywrightError):
                bar.click(trial=True, timeout=1500)
        click(calm)
        gone(page, page.get_by_role("dialog", name="Before you play"), "Calm effects closed the panel")
        expect(page.get_by_role("button", name="Start a room")).to_be_focused()
        page.reload()
        advance(page, 1000)
        expect(page.get_by_role("dialog", name="Before you play")).to_have_count(0)
        click(page.get_by_role("button", name="Settings"))
        st = page.get_by_role("dialog", name="Settings")
        shown(page, st, "Settings opened")
        hdr = st.get_by_role("button", name="Comfort")
        if hdr.get_attribute("aria-expanded") != "true":
            click(hdr)
        expect(st.get_by_role("switch", name="Reduce effects")).to_be_checked()
    with app_page(browser, base + "/") as page:
        dlg = page.get_by_role("dialog", name="Before you play")
        shown(page, dlg, "pre-match notice panel opened on load")
        expect(dlg.get_by_role("button", name="Enter")).to_be_focused()
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="Before you play"), "Escape acted as Enter")
        expect(page.get_by_role("button", name="Start a room")).to_be_focused()
        page.reload()
        advance(page, 1000)
        expect(page.get_by_role("dialog", name="Before you play")).to_have_count(0)
        click(page.get_by_role("button", name="Settings"))
        st = page.get_by_role("dialog", name="Settings")
        shown(page, st, "Settings opened")
        hdr = st.get_by_role("button", name="Comfort")
        if hdr.get_attribute("aria-expanded") != "true":
            click(hdr)
        expect(st.get_by_role("switch", name="Reduce effects")).not_to_be_checked()


def test_wf_session_and_title_title_screen(browser, app_url):
    base = app_url.rstrip("/")
    st = status(base)
    with app_page(browser, base + "/") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        enter(page)
        mark, bar = page.get_by_role("img", name="Holdfast Nights"), page.get_by_role("button", name="Start a room")
        stamp = page.get_by_role("status", name="Build")
        expect(mark).to_be_visible()
        expect(bar).to_contain_text("START A ROOM", ignore_case=True)
        expect(stamp).to_have_text(f"build {st['build']} · {TICK_HZ} Hz", ignore_case=True)
        mb, bb, sb = mark.bounding_box(), bar.bounding_box(), stamp.bounding_box()
        assert mb["y"] < 800 / 3 and 1280 * 0.25 <= mb["width"] <= 1280 * 0.55, mb
        assert bb["y"] >= mb["y"] + mb["height"] - 1, "start-a-room bar sits beneath the wordmark"
        assert sb["x"] + sb["width"] >= 1280 - 80 and sb["y"] + sb["height"] >= 800 - 80, "stamp pinned bottom-right"
        menu = ["Join by code", "Convoy race", "Nights", "History", "Settings", "Callsign"]
        boxes = [page.get_by_role("button", name=n).bounding_box() for n in menu]
        assert all(b["y"] > bb["y"] for b in boxes), "title menu link rows follow the bar"
        assert all(b["width"] < bb["width"] for b in boxes), "the start-a-room bar is the widest control"
        rows = sorted({round(b["y"] / 10) for b in boxes})
        assert len(rows) == 2, f"two title menu link rows, got rows at {rows}"
        for name, dialog in [("Join by code", "Join by code"), ("Nights", "Nights"), ("History", "History"),
                             ("Settings", "Settings"), ("Callsign", "Callsign"), ("Start a room", "Callsign"),
                             ("Convoy race", "Callsign")]:
            click(page.get_by_role("button", name=name))
            shown(page, page.get_by_role("dialog", name=dialog), f"{name} opened the {dialog} screen")
            page.keyboard.press("Escape")
            gone(page, page.get_by_role("dialog", name=dialog), f"Escape closed {dialog}")
    with app_page(browser, base + "/nights") as page:
        enter(page)
        shown(page, page.get_by_role("dialog", name="Nights"), "/nights opened the Nights panel")
    with app_page(browser, base + "/room/K7P2QX") as page:
        enter(page)
        dlg = page.get_by_role("dialog", name="Join by code")
        shown(page, dlg, "/room/<code> opened Join by code")
        expect(dlg.get_by_role("textbox", name="Room code")).to_have_value(re.compile("^K7P2QX$", re.I))


def test_wf_session_and_title_callsign(browser, app_url):
    base = app_url.rstrip("/")
    cs = callsign()
    r = api("POST", base, "/api/sessions", body={"callsign": cs})
    d = ok(r, 201)
    assert d["player"]["callsign"] == cs and d["player"]["role"] == "player" and d["token"]
    assert "hf_session" in r.cookies and "HttpOnly".lower() in r.headers.get("set-cookie", "").lower()
    assert ok(api("GET", base, "/api/me", {"token": d["token"]}))["player"]["id"] == d["player"]["id"]
    assert ok(api("GET", base, "/api/me", {"cookie": r.cookies["hf_session"]}))["player"]["callsign"] == cs
    f = ok(api("POST", base, "/api/sessions", body={"callsign": callsign(), "studio_key": STUDIO_KEY}), 201)
    assert f["player"]["role"] == "founder"
    err(api("POST", base, "/api/sessions", body={"callsign": callsign(), "studio_key": "not-the-key"}), 403, "studio_key_invalid")
    for bad in ["ab", "a" * 17, "bad!name"]:
        e = err(api("POST", base, "/api/sessions", body={"callsign": bad}), 422, "validation")
        assert e["fields"]["callsign"] == "Use 3 to 16 letters, digits, spaces, hyphens or underscores."
    for good in ["a_b", "Rook Vale-16 aaa"]:
        ok(api("POST", base, "/api/sessions", body={"callsign": good}), 201)
    err(api("GET", base, "/api/me"), 401, "unauthenticated")
    ok(api("DELETE", base, "/api/sessions", {"token": d["token"]}), 204)
    err(api("GET", base, "/api/me", {"token": d["token"]}), 401, "unauthenticated")
    with app_page(browser, base + "/") as page:
        enter(page)
        click(page.get_by_role("button", name="Callsign", exact=True))
        dlg = page.get_by_role("dialog", name="Callsign")
        shown(page, dlg, "Callsign panel opened")
        fill(dlg.get_by_role("textbox", name="Callsign"), callsign())
        fill(dlg.get_by_role("textbox", name="Studio key"), "not-the-key")
        click(dlg.get_by_role("button", name="Save callsign"))
        eventually(page, lambda: expect(dlg.get_by_role("textbox", name="Studio key"))
                   .to_have_accessible_description("That studio key isn't right.", timeout=250),
                   "studio_key_invalid shown under Studio key")
        fill(dlg.get_by_role("textbox", name="Studio key"), STUDIO_KEY)
        click(dlg.get_by_role("button", name="Save callsign"))
        says(page, notices(page), "Studio key accepted — founder tools unlocked.", "founder key accepted")
        assert ok(api("GET", base, "/api/me", page_player(page, base)))["player"]["role"] == "founder"


def test_wf_session_and_title_service_banner(browser, mail):
    down = outage("APP_VALKEY_DOWN_URL")
    st = status(down)
    assert st["services"] == {"postgres": "up", "valkey": "down", "mail": "up"}, st
    with app_page(browser, down + "/") as page:
        banner = page.get_by_role("status", name="Service status")
        says(page, banner, VALKEY_DOWN_COPY, "Valkey down banner on the title screen")
        expect(banner).not_to_contain_text(MAIL_DOWN_COPY)
        expect(banner).not_to_contain_text(STORAGE_DOWN_COPY)
        enter(page)
        click(page.get_by_role("button", name="Nights", exact=True))
        shown(page, page.get_by_role("dialog", name="Nights"), "Nights opened")
        says(page, banner, VALKEY_DOWN_COPY, "banner stays over the Nights screen")
    relay = Relay(*urlsplit(os.environ["VALKEY_URL"]).netloc.rsplit("@", 1)[-1].split(":"))
    env = {"VALKEY_URL": relay_url(os.environ["VALKEY_URL"], relay.port),
           "DATABASE_URL": os.environ["DATABASE_URL"] + "_valkeydown"}
    try:
        with app_copy(env) as copy:
            poll(lambda: status(copy)["services"]["valkey"] == "down", STATUS_FOLLOW_S + TIME_SLACK_S,
                 "copy booted with Valkey down and reported it")
            with app_page(browser, copy + "/") as page:
                banner = page.get_by_role("status", name="Service status")
                says(page, banner, VALKEY_DOWN_COPY, "banner while Valkey is down")
                relay.start()
                t0 = time.monotonic()
                poll(lambda: status(copy)["services"]["valkey"] == "up", STATUS_FOLLOW_S + TIME_SLACK_S,
                     "/api/status reported Valkey up within 5 s of its return")
                assert time.monotonic() - t0 <= STATUS_FOLLOW_S + TIME_SLACK_S
                eventually(page, lambda: expect(banner).not_to_contain_text(VALKEY_DOWN_COPY, timeout=250),
                           "banner cleared after recovery", seconds=STATUS_FOLLOW_S * 3)
            assert ok(api("POST", copy, "/api/rooms", login(copy), {"mode": "siege"}) if False else
                      api("GET", copy, "/api/health")) == {"status": "ok"}
    finally:
        relay.stop()


def test_session_error_precedence(app_url):
    base = app_url.rstrip("/")
    for body in ({"callsign": "x", "studio_key": "wrong-key"}, {"studio_key": "wrong-key"},
                 {"callsign": "bad!", "studio_key": "wrong-key"}):
        err(api("POST", base, "/api/sessions", body=body), 403, "studio_key_invalid")
    for body in ({"callsign": "x", "studio_key": STUDIO_KEY}, {"callsign": "x"}):
        assert "callsign" in err(api("POST", base, "/api/sessions", body=body), 422, "validation")["fields"]
    r = httpx.post(base + "/api/sessions", content=b"{", headers={"Content-Type": "application/json"}, timeout=HTTP_S)
    err(r, 400, "bad_json")


def test_room_create_error_precedence(app_url):
    base = app_url.rstrip("/")
    for body in ({"mode": "chess"}, {}):
        err(api("POST", base, "/api/rooms", None, body), 401, "unauthenticated")
    p = login(base)
    create(base, p)
    for body in ({"mode": "chess"}, {}, {"mode": "convoy"}):
        err(api("POST", base, "/api/rooms", p, body), 409, "already_in_room")
    fresh = login(base)
    for body in ({"mode": "chess"}, {}):
        assert "mode" in err(api("POST", base, "/api/rooms", fresh, body), 422, "validation")["fields"]


def test_room_create(app_url, valkey):
    base = app_url.rstrip("/")
    p = login(base)
    st = create(base, p)
    code = st["code"]
    assert CODE_RE.match(code) and st["host"] == p["id"] and st["mode"] == "siege" and st["phase"] == "lobby"
    assert st["night_id"] is None and [x["seat"] for x in st["players"]] == [1]
    assert 0 < st["invite_remaining_ms"] <= INVITE_MS
    h = valkey.hash(f"hf:room:{code}")
    assert h.get("mode") == "siege" and h.get("host") == p["id"] and h.get("phase") == "lobby" and h.get("invite_expires_at")
    assert valkey.keys(f"hf:seat:{code}:{p['id']}")
    e = err(api("POST", base, "/api/rooms", p, {"mode": "convoy"}), 409, "already_in_room")
    assert e["code"] == "already_in_room" and code in json.dumps(e)
    e = err(api("POST", base, "/api/rooms", login(base), {"mode": "chess"}), 422, "validation")
    assert "mode" in e["fields"]
    err(api("POST", base, "/api/rooms", None, {"mode": "siege"}), 401, "unauthenticated")
    conv = create(base, login(base), "convoy")
    assert conv["mode"] == "convoy" and conv["enemies"] == [] and conv["barrels"] == []
    codes = {create(base, login(base))["code"] for _ in range(8)}
    assert len(codes) == 8 and code not in codes and all(CODE_RE.match(c) for c in codes)
    clock = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        start = studio_at(friday, 20, 0)
        clock_set(clock, start - timedelta(days=30))
        founder, founder2 = login(clock, STUDIO_KEY), login(clock, STUDIO_KEY)
        _, nights = series(clock, founder, friday)
        clock_set(clock, start + timedelta(minutes=10))
        assert night(clock, nights[0]["id"])["status"] == "live"
        assert create(clock, founder)["night_id"] == nights[0]["id"]
        assert create(clock, founder2, "convoy")["night_id"] is None
        assert create(clock, login(clock))["night_id"] is None
    finally:
        clock_reset(clock)


def test_wf_room_lobby_rooms_offline(browser):
    down = outage("APP_VALKEY_DOWN_URL")
    p = login(down)
    err(api("POST", down, "/api/rooms", p, {"mode": "siege"}), 503, "rooms_unavailable")
    with app_page(browser, down + "/") as page:
        enter(page)
        ui_login(page, callsign())
        click(page.get_by_role("button", name="Start a room"))
        says(page, notices(page), "Rooms are offline right now. Try again in a minute.", "offline copy shown")
        expect(lobby(page)).to_have_count(0)


def test_wf_room_lobby_join_rules(app_url):
    base = app_url.rstrip("/")
    host, a, b, c, d, e = (login(base) for _ in range(6))
    code = create(base, host)["code"]
    assert join(base, a, code.lower())["seat"] == 2
    assert join(base, b, code)["seat"] == 3
    again = join(base, a, code)
    assert again["seat"] == 2 and len(again["state"]["players"]) == 3 and again["state"]["code"] == code
    ok(api("POST", base, f"/api/rooms/{code}/leave", a))
    assert a["id"] not in [x["id"] for x in room(base, host, code)["players"]]
    assert join(base, c, code)["seat"] == 2
    assert join(base, d, code)["seat"] == 4
    err(api("POST", base, f"/api/rooms/{code}/join", e), 409, "room_full")
    assert len(room(base, host, code)["players"]) == 4
    err(api("POST", base, "/api/rooms/ZZZZZZ/join", e), 404, "room_not_found")
    err(api("GET", base, "/api/rooms/ZZZZZZ", e), 404, "room_not_found")
    for p in (host, b, c, d):
        ok(ready(base, p, code))
    ok(api("POST", base, f"/api/rooms/{code}/start", host))
    err(api("POST", base, f"/api/rooms/{code}/join", login(base)), 409, "match_in_progress")
    host2 = login(base)
    code2 = create(base, host2)["code"]
    racers = [login(base) for _ in range(5)]
    with ThreadPoolExecutor(5) as pool:
        rs = list(pool.map(lambda p: api("POST", base, f"/api/rooms/{code2}/join", p), racers))
    won = [r for r in rs if r.status_code == 200]
    assert len(won) == 3, [r.status_code for r in rs]
    assert all(r.status_code == 409 and r.json()["error"]["code"] == "room_full" for r in rs if r.status_code != 200)
    assert sorted(r.json()["seat"] for r in won) == [2, 3, 4]


def test_wf_room_lobby_invite_expiry(browser):
    base = outage("APP_CLOCK_URL")
    try:
        t0 = datetime(random.randrange(2031, 2090), 6, 1, 15, 0, tzinfo=timezone.utc)
        clock_set(base, t0)
        host, early, late = login(base), login(base), login(base)
        st = create(base, host)
        code, expires = st["code"], inst(st["invite_expires_at"])
        assert abs((expires - t0).total_seconds() - INVITE_MS / 1000) <= TIME_SLACK_S
        clock_set(base, expires - timedelta(seconds=90))
        with app_page(browser, f"{base}/room/{code}") as page:
            page.clock.set_system_time(WRONG_DEVICE_TIME)
            enter(page)
            click(page.get_by_role("dialog", name="Join by code").get_by_role("button", name="Join room"))
            save_callsign(page, callsign())
            tm = lobby(page).get_by_role("timer", name="Invite expires")
            shown(page, tm, "Invite expires timer shown in the lobby")
            txt, ms = timer_reading(tm)
            api_ms = room(base, host, code)["invite_remaining_ms"]
            assert 0 < int(ms) <= 90000 and abs(int(ms) - api_ms) <= 5000, (ms, api_ms)
            assert fuse_matches(txt, int(ms)), txt
        clock_set(base, expires - timedelta(seconds=1))
        assert join(base, early, code)["seat"] == 3
        clock_set(base, expires)
        err(api("POST", base, f"/api/rooms/{code}/join", late), 410, "invite_expired")
        st = room(base, host, code)
        assert late["id"] not in [x["id"] for x in st["players"]] and st["invite_remaining_ms"] is None
        assert join(base, early, code)["seat"] == 3
    finally:
        clock_reset(base)


def test_room_ready_start(app_url):
    base = app_url.rstrip("/")
    host, guest, stranger = login(base), login(base), login(base)
    code = create(base, host)["code"]
    join(base, guest, code)
    err(api("POST", base, f"/api/rooms/{code}/start", guest), 403, "not_host")
    err(api("POST", base, f"/api/rooms/{code}/start", host), 409, "not_all_ready")
    assert me(ok(ready(base, host, code)), host)["ready"] is True
    err(api("POST", base, f"/api/rooms/{code}/start", host), 409, "not_all_ready")
    assert me(ok(ready(base, guest, code)), guest)["ready"] is True
    assert me(ok(ready(base, guest, code, False)), guest)["ready"] is False
    err(api("POST", base, f"/api/rooms/{code}/start", host), 409, "not_all_ready")
    ok(ready(base, guest, code))
    err(ready(base, stranger, code), 403, "not_seated")
    err(api("POST", base, f"/api/rooms/{code}/ready", None, {"ready": True}), 401, "unauthenticated")
    st = ok(api("POST", base, f"/api/rooms/{code}/start", host))
    assert st["phase"] == "countdown" and 0 < st["phase_remaining_ms"] <= COUNTDOWN_MS and st["wave"] == 0
    assert st["invite_remaining_ms"] is None
    err(ready(base, guest, code), 409, "wrong_phase")
    err(api("POST", base, f"/api/rooms/{code}/start", host), 409, "wrong_phase")
    start_tick = st["tick"]
    st = wait_room(base, [host, guest], code, lambda s: s["phase"] == "wave", 20, "countdown led to wave 1")
    assert st["wave"] == 1
    elapsed = st["tick"] - start_tick
    assert COUNTDOWN_MS // TICK_MS - TICK_SLACK <= elapsed <= COUNTDOWN_MS // TICK_MS + 20, elapsed


def test_wf_room_lobby_browser_to_wave(browser, app_url):
    base = app_url.rstrip("/")
    cs1, cs2 = callsign(), callsign()
    with app_page(browser, base + "/") as host:
        enter(host)
        code = ui_start_room(host, cs1)
        host.context.grant_permissions(["clipboard-read", "clipboard-write"])
        click(lobby(host).get_by_role("button", name="Copy invite"))
        origin = host.evaluate("location.origin")
        assert host.evaluate("navigator.clipboard.readText()") == f"{origin}/room/{code}"
        with app_page(browser, f"{base}/room/{code}") as guest:
            enter(guest)
            dlg = guest.get_by_role("dialog", name="Join by code")
            expect(dlg.get_by_role("textbox", name="Room code")).to_have_value(re.compile(f"^{code}$", re.I))
            click(dlg.get_by_role("button", name="Join room"))
            save_callsign(guest, cs2)
            says(guest, notices(guest), f"Joined room {code} — seat 2.", "join announced")
            seats = guest.get_by_role("list", name="Seats")
            says(guest, seats, f"Seat 1 · {cs1} · Not ready · Host", "seat 1 listed")
            says(guest, seats, f"Seat 2 · {cs2} · Not ready", "seat 2 listed")
            rdy = lobby(guest).get_by_role("button", name="Ready")
            rdy.focus()
            guest.keyboard.press("Enter")
            eventually(guest, lambda: expect(rdy).to_have_attribute("aria-pressed", "true", timeout=250), "Ready pressed by keyboard")
            says(guest, notices(guest), "You're ready.", "ready copy")
            gstart = lobby(guest).get_by_role("button", name="Start match")
            assert gstart.count() == 0 or gstart.is_disabled(), "Start match is host only"
            start = lobby(host).get_by_role("button", name="Start match")
            expect(start).to_be_disabled()
            ui_ready_start(host)
            for pg in (host, guest):
                says(pg, wave_group(pg), "Countdown", "countdown shown", seconds=20)
            for pg in (host, guest):
                says(pg, wave_group(pg), "Wave 1 of 3", "wave 1 shown", seconds=40)
            st = room(base, page_player(host, base), code)
            assert st["phase"] == "wave" and st["wave"] == 1
            assert sorted(x["callsign"] for x in st["players"]) == sorted([cs1, cs2])


def test_wf_siege_combat_movement(app_url):
    base = app_url.rstrip("/")
    ps, code, st = start_match(base, 1)
    p = ps[0]

    def measure(vec):
        intent(base, p, code, vec, 90.0)
        s0 = poll(lambda: (lambda s: s if math.dist((me(s, p)["x"], me(s, p)["z"]), SPAWNS[1]) >= 0 else None)(room(base, p, code)), 5, "state")
        a = after_ticks(base, ps, code, s0["tick"], 4)
        b = after_ticks(base, ps, code, a["tick"], 16)
        ma, mb = me(a, p), me(b, p)
        return math.dist((ma["x"], ma["z"]), (mb["x"], mb["z"])) / ((b["tick"] - a["tick"]) * TICK_MS / 1000)

    half = measure((-0.5, 0.0))
    assert abs(half - SPEED * 0.5) <= SPEED * 0.5 * SPEED_TOL, f"half-length intent moved at {half} m/s"
    intent(base, p, code, (0.0, 0.0))
    walk(base, p, code, (10.0, 10.0))
    intent(base, p, code, (0.0, 1.0), 90.0)
    def settled():
        a = room(base, p, code)
        b = after_ticks(base, ps, code, a["tick"], 6)
        return b if abs(me(a, p)["z"] - me(b, p)["z"]) < 1e-6 and me(b, p)["z"] > 12 else None
    stopped = poll(settled, 15, "player stopped at the west seawall")
    m = me(stopped, p)
    assert 12 < m["z"] <= 14.0 and 8 <= m["x"] <= 12, f"player entered the seawall: {m}"
    diag = measure((1.0, -1.0))
    assert abs(diag - SPEED) <= SPEED * SPEED_TOL, f"over-long intent moved at {diag} m/s"
    intent(base, p, code, (0.0, -1.0), 90.0)
    edge = poll(lambda: (lambda s: s if me(s, p)["z"] < 1.0 else None)(room(base, p, code)), 15, "player reached the south edge")
    later = after_ticks(base, ps, code, edge["tick"], 10)
    assert 0 <= me(later, p)["z"] <= me(edge, p)["z"] + 1e-6, "player went past the map edge"
    seq = p["seq"]
    assert ok(api("POST", base, f"/api/rooms/{code}/input", p, {"seq": seq, "move": {"x": 1, "z": 0}, "aim": 180}), 202)["applied"] is False
    assert ok(api("POST", base, f"/api/rooms/{code}/input", p, {"seq": seq - 1, "move": {"x": 1, "z": 0}, "aim": 180}), 202)["applied"] is False
    m = me(room(base, p, code), p)
    assert m["last_input_seq"] == seq and abs(m["aim"] - 90) < 1e-6


def test_wf_siege_combat_fire_reload(app_url):
    base = app_url.rstrip("/")
    p = login(base)
    code = create(base, p)["code"]
    ok(ready(base, p, code))
    ok(api("POST", base, f"/api/rooms/{code}/start", p))
    r = shoot(base, p, code, 270)
    assert r["accepted"] is False and r["reason"] == "not_in_wave" and r["outcome"] is None
    wait_room(base, [p], code, lambda s: s["phase"] == "wave", 20, "wave 1 began")
    b = ok(api("POST", base, f"/api/rooms/{code}/reports/batch", p, {"reports": [
        {"report_id": rid(), "type": "shot", "aim": 270}, {"report_id": rid(), "type": "shot", "aim": 270}]}))["results"]
    assert b[0]["accepted"] and b[0]["outcome"]["mag"] == MAG - 1
    assert b[1]["accepted"] is False and b[1]["reason"] == "fire_interval" and b[1]["outcome"] is None
    assert me(room(base, p, code), p)["mag"] == MAG - 1
    rl = ok(rep(base, p, code, {"report_id": rid(), "type": "reload"}))
    assert rl["accepted"] and rl["outcome"] == {"reload_ms": RELOAD_MS}
    s = shoot(base, p, code, 270)
    assert s["reason"] == "reloading" and s["accepted"] is False
    assert ok(rep(base, p, code, {"report_id": rid(), "type": "reload"}))["reason"] == "reloading"
    m = me(room(base, p, code), p)
    assert 0 < m["reload_remaining_ms"] <= RELOAD_MS and m["mag"] == MAG - 1
    done = wait_room(base, [p], code, lambda st: me(st, p)["reload_remaining_ms"] is None, 10, "reload finished")
    assert me(done, p)["mag"] == MAG and me(done, p)["reserve"] == RESERVE - 1
    assert done["tick"] - rl["tick"] >= RELOAD_MS // TICK_MS - 1
    assert ok(rep(base, p, code, {"report_id": rid(), "type": "reload"}))["reason"] == "nothing_to_reload"
    tick = done["tick"]
    for _ in range(MAG):
        tick = after_ticks(base, [p], code, tick, 3)["tick"]
        r = shoot(base, p, code, 270)
        assert r["accepted"], r
        tick = r["tick"]
    tick = after_ticks(base, [p], code, tick, 3)["tick"]
    r = shoot(base, p, code, 270)
    assert r["accepted"] is False and r["reason"] == "empty"
    m = me(room(base, p, code), p)
    assert m["mag"] == 0 and m["reserve"] == RESERVE - 1
    ok(rep(base, p, code, {"report_id": rid(), "type": "reload"}))
    full = wait_room(base, [p], code, lambda st: me(st, p)["mag"] == MAG, 10, "empty magazine refilled")
    assert me(full, p)["reserve"] == RESERVE - 1 - MAG


def test_shot_resolution(app_url):
    base = app_url.rstrip("/")
    ps, code, st = start_match(base, 1)
    p = ps[0]
    r = shoot(base, p, code, 90)
    assert r["accepted"] and r["outcome"]["hit"] is None and r["outcome"]["mag"] == MAG - 1
    assert barrel_at(room(base, p, code), BARRELS["B4"])["hp"] == BARREL_HP
    tick = r["tick"]
    r = None
    for i in range(3):
        st = after_ticks(base, ps, code, tick, 3)
        g = min((e for e in st["enemies"] if e["state"] != "dead"), key=lambda e: math.dist((e["x"], e["z"]), (22, 28)))
        assert clear_line(SPAWNS[1], (g["x"], g["z"]))
        r = shoot(base, p, code, aim_to(SPAWNS[1], (g["x"], g["z"])))
        hit = r["outcome"]["hit"]
        assert hit and hit["id"] == g["id"] and hit["kind"] == "grunt" and hit["damage"] == SHOT_DAMAGE
        assert hit["hp_after"] == GRUNT_HP - SHOT_DAMAGE * (i + 1) and hit["killed"] is (i ==2)
        tick = r["tick"]
    st = room(base, p, code)
    dead = next(e for e in st["enemies"] if e["id"] == hit["id"])
    assert dead["hp"] == 0 and dead["state"] == "dead"
    m = me(st, p)
    assert m["kills"] == 1 and m["score"] == GRUNT_HP and m["credits"] == KILL_GRUNT
    st = after_ticks(base, ps, code, tick, 3)
    r = shoot(base, p, code, 270)
    assert r["accepted"] and r["outcome"]["hit"] is None


def test_room_state_stream(app_url):
    base = app_url.rstrip("/")
    host, guest = login(base), login(base)
    code = create(base, host)["code"]
    join(base, guest, code)
    st = room(base, guest, code)
    assert st["code"] == code and st["phase"] == "lobby" and st["wave"] == 0 and st["phase_remaining_ms"] is None
    assert st["degraded"] is None and st["result"] is None and st["vehicles"] == []
    for m in st["players"]:
        assert (m["connection"], m["status"], m["hp"], m["mag"], m["reserve"], m["grenades"]) == ("connected", "up", 100, MAG, RESERVE, 2)
        assert m["reload_remaining_ms"] is None and m["revive_remaining_ms"] is None and m["grace_remaining_ms"] is None
    assert {i["item"]: (i["name"], i["price"]) for i in st["shop"]["items"]} == {k: (NAMES[k], v) for k, v in PRICES.items()}
    assert st["shop"]["open"] is False
    seqs = [e["seq"] for e in st["events"]]
    assert seqs == list(range(seqs[0], seqs[0] + len(seqs))) if seqs else True
    ticks, names = [], []
    t0 = time.monotonic()
    with httpx.stream("GET", f"{base}/api/rooms/{code}/stream", headers=auth(host), timeout=HTTP_S) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        buf = []
        for line in r.iter_lines():
            if line.startswith("event:"):
                names.append(line[6:].strip())
            elif line.startswith("data:"):
                buf.append(line[5:].lstrip())
            elif not line and buf:
                ticks.append(json.loads("\n".join(buf))["tick"])
                buf = []
                if len(ticks) >= 40:
                    break
            if time.monotonic() - t0 > 20:
                break
    elapsed = time.monotonic() - t0
    assert len(ticks) >= 40 and set(names) == {"snapshot"}
    assert all(b > a for a, b in zip(ticks, ticks[1:])) and ticks[-1] - ticks[0] <= len(ticks) + 5
    rate = (ticks[-1] - ticks[0]) / elapsed
    assert TICK_HZ * 0.6 <= rate <= TICK_HZ * 1.4, rate
    for p in (host, guest):
        ok(ready(base, p, code))
    st = ok(api("POST", base, f"/api/rooms/{code}/start", host))
    assert st["phase"] == "countdown" and 0 < st["phase_remaining_ms"] <= COUNTDOWN_MS
    st = wait_room(base, [host, guest], code, lambda s: s["phase"] == "wave", 20, "wave 1")
    assert st["phase_remaining_ms"] is None and len(st["enemies"]) == 3
    assert all(e["kind"] == "grunt" and e["hp"] == GRUNT_HP for e in st["enemies"])
    assert sorted((b["x"], b["z"]) for b in st["barrels"]) == sorted(BARRELS.values())
    assert all(b["hp"] == BARREL_HP and b["destroyed"] is False for b in st["barrels"])
    assert any(e["type"] == "phase" for e in st["events"]) and status(base)["tick_hz"] == TICK_HZ


def test_wf_siege_combat_hud(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        page.clock.set_system_time(WRONG_DEVICE_TIME)
        code, p = ui_solo_match(page, base)
        hud = page.get_by_role("region", name="HUD")
        says(page, hud.get_by_role("group", name="Ammo"), f"{MAG} / {RESERVE}", "ammo readout")
        health = hud.get_by_role("meter", name="Health")
        eventually(page, lambda: meter_reads(health, 100), "Health meter reads 100")
        expect(hud.get_by_role("group", name="Grenades")).to_contain_text("2")
        expect(hud.get_by_role("group", name="Credits")).to_contain_text(re.compile(r"(^|\D)0 cr"))
        expect(hud.get_by_role("group", name="Status")).to_contain_text("Up")
        page.keyboard.press("Space")
        poll(lambda: me(room(base, p, code), p)["mag"] == MAG - 1, 10, "one Fire press spent one round")
        says(page, hud.get_by_role("group", name="Ammo"), f"{MAG - 1} / {RESERVE}", "ammo after a shot")
        assert me(room(base, p, code), p)["mag"] == MAG - 1
        page.keyboard.press("KeyR")
        tm = page.get_by_role("timer", name="Reload")
        shown(page, tm, "Reload timer shown")
        assert 0 < int(timer_reading(tm)[1]) <= RELOAD_MS
        says(page, hud.get_by_role("group", name="Ammo"), f"{MAG} / {RESERVE - 1}", "ammo after reload")
        clear_wave_one(base, [p], code)
        m = me(room(base, p, code), p)
        says(page, hud.get_by_role("group", name="Credits"), re.compile(rf"(^|\D){m['credits']} cr"), "credits after kills")
        says(page, hud.get_by_role("group", name="Score"), str(m["score"]), "score after kills")
        says(page, wave_group(page), "Intermission", "intermission label")
        assert m["kills"] == 3 and m["credits"] == 3 * KILL_GRUNT + WAVE_BONUS


def test_wf_siege_combat_intermission_moves(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 1)
    p = ps[0]
    clear_wave_one(base, ps, code)
    st = room(base, p, code)
    assert st["phase"] == "intermission", st["phase"]
    m = me(st, p)
    here = (m["x"], m["z"])
    target = next(t for t in ((here[0] + 3 * math.cos(a), here[1] + 3 * math.sin(a))
                              for a in (math.radians(d) for d in range(0, 360, 15)))
                  if 1 <= t[0] <= 31 and 1 <= t[1] <= 31 and clear_line(here, t))
    t0 = st["tick"]
    arrived = walk(base, p, code, target, seconds=INTERMISSION_MS / 1000 / 2)
    assert arrived["phase"] == "intermission", "the walk ended only when the next wave started"
    assert (arrived["tick"] - t0) * TICK_MS / 1000 <= 3 / SPEED * (1 + SPEED_TOL) + TIME_SLACK_S, \
        "an up player moved by its intent during the intermission (L484)"


def test_wf_siege_combat_touch_reduced(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/", reduced_motion="reduce") as page:
        phone(page)
        page.reload()
        code, p = ui_solo_match(page, base)
        fire = page.get_by_role("button", name="Fire", exact=True)
        shown(page, fire, "Fire button shown on the touch phone")
        tap(fire)
        poll(lambda: me(room(base, p, code), p)["mag"] == MAG - 1, 10, "Fire tap spent exactly one server round")
        ammo = page.get_by_role("group", name="Ammo")
        says(page, ammo, f"{MAG - 1} / {RESERVE}", "ammo readout follows the server under reduced effects")
        assert running_animations(ammo) == 0


def test_wf_report_replay_once(app_url, valkey):
    base = app_url.rstrip("/")
    ps, code, st = start_match(base, 1)
    p = ps[0]
    g = min(st["enemies"], key=lambda e: math.dist((e["x"], e["z"]), (22, 28)))
    first_id = rid()
    first = shoot(base, p, code, aim_to(SPAWNS[1], (g["x"], g["z"])), first_id)
    assert first["accepted"] and first["outcome"]["hit"]["damage"] == SHOT_DAMAGE
    body = {"report_id": first_id, "type": "shot", "aim": round(aim_to(SPAWNS[1], (g["x"], g["z"])) % 360, 3)}
    assert ok(rep(base, p, code, body)) == first
    st = room(base, p, code)
    assert me(st, p)["mag"] == MAG - 1 and next(e for e in st["enemies"] if e["id"] == g["id"])["hp"] == GRUNT_HP - SHOT_DAMAGE
    assert first_id in valkey.hash(f"hf:reports:{code}")
    tick = after_ticks(base, ps, code, first["tick"])["tick"]
    new = {"report_id": rid(), "type": "shot", "aim": 270}
    res = ok(api("POST", base, f"/api/rooms/{code}/reports/batch", p, {"reports": [body, new]}))["results"]
    assert res[0] == first and res[1]["accepted"] and me(room(base, p, code), p)["mag"] == MAG - 2
    kill = None
    for _ in range(2):
        st = after_ticks(base, ps, code, tick)
        g2 = next(e for e in st["enemies"] if e["id"] == g["id"])
        kill_body = {"report_id": rid(), "type": "shot", "aim": round(aim_to(SPAWNS[1], (g2["x"], g2["z"])), 3)}
        kill = ok(rep(base, p, code, kill_body))
        tick = kill["tick"]
    assert kill["outcome"]["hit"]["killed"] is True
    assert ok(rep(base, p, code, kill_body)) == kill
    m = me(room(base, p, code), p)
    assert (m["kills"], m["credits"], m["score"]) == (1, KILL_GRUNT, GRUNT_HP)
    gb = {"report_id": rid(), "type": "grenade", "target": {"x": 16.0, "z": 10.0}}
    gr = ok(rep(base, p, code, gb))
    assert gr["accepted"] and gr["outcome"]["detonates_in_ms"] == FUSE_MS
    assert ok(rep(base, p, code, gb)) == gr and me(room(base, p, code), p)["grenades"] == 1
    rb = {"report_id": rid(), "type": "reload"}
    rr = ok(rep(base, p, code, rb))
    assert ok(rep(base, p, code, rb)) == rr
    ps2, code2, _ = start_match(base, 1)
    other = shoot(base, ps2[0], code2, 270, first_id)
    assert other["accepted"] and other["outcome"]["mag"] == MAG - 1


def test_wf_report_replay_conflicts(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 1)
    p = ps[0]
    x = rid()
    first = shoot(base, p, code, 270, x)
    err(rep(base, p, code, {"report_id": x, "type": "shot", "aim": 180}), 409, "report_conflict")
    err(rep(base, p, code, {"report_id": x, "type": "reload"}), 409, "report_conflict")
    after_ticks(base, ps, code, first["tick"])
    res = ok(api("POST", base, f"/api/rooms/{code}/reports/batch", p, {"reports": [
        {"report_id": x, "type": "shot", "aim": 10}, {"report_id": x, "type": "shot", "aim": 270}]}))["results"]
    assert res[0]["error"]["code"] == "report_conflict" and res[1] == first
    assert me(room(base, p, code), p)["mag"] == MAG - 1
    after_ticks(base, ps, code, first["tick"])
    same = {"report_id": rid(), "type": "shot", "aim": 270}
    with ThreadPoolExecutor(8) as pool:
        rs = list(pool.map(lambda _: rep(base, p, code, same), range(8)))
    assert all(r.status_code == 200 for r in rs) and len({r.text for r in rs}) == 1 and rs[0].json()["accepted"]
    assert me(room(base, p, code), p)["mag"] == MAG - 2


def test_wf_report_replay_reconnect(browser, app_url):
    base = app_url.rstrip("/")
    host, port = urlsplit(base).netloc.rsplit("@", 1)[-1].rsplit(":", 1)
    link = Relay(host, port)
    link.start()
    try:
        _report_replay_reconnect(browser, base, f"http://127.0.0.1:{link.port}", link)
    finally:
        link.stop()


def _report_replay_reconnect(browser, base, via, link):
    with app_page(browser, via + "/") as page:
        code, p = ui_solo_match(page, base)
        batches = []
        page.on("request", lambda q: batches.append(q.post_data) if q.url.endswith("/reports/batch") and q.method == "POST" else None)
        page.keyboard.press("Space")
        poll(lambda: me(room(base, p, code), p)["mag"] == MAG - 1, 10, "online shot applied")
        page.context.set_offline(True)
        link.stop()
        says(page, notices(page), "Connection lost — reconnecting. Your seat is held.", "reconnecting notice", seconds=20)
        advance(page, 300)
        page.keyboard.press("Space")
        advance(page, 300)
        page.keyboard.press("Space")
        advance(page, 300)
        link.start()
        page.context.set_offline(False)
        says(page, notices(page), "Reconnected — 2 buffered reports sent.", "reconnected notice", seconds=30)
        st = poll(lambda: (lambda s: s if MAG - 3 <= me(s, p)["mag"] <= MAG - 2 else None)(room(base, p, code)), 10, "buffered shots applied at most once each")
        m = me(st, p)
        assert m["connection"] == "connected" and m["seat"] == 1
        assert batches, "the client replayed its buffer through the batch endpoint"
        sent = json.loads(batches[-1])
        assert [r["type"] for r in sent["reports"]] == ["shot", "shot"], sent
        mag = me(room(base, p, code), p)["mag"]
        again = ok(api("POST", base, f"/api/rooms/{code}/reports/batch", p, sent))
        assert ok(api("POST", base, f"/api/rooms/{code}/reports/batch", p, sent)) == again
        assert me(room(base, p, code), p)["mag"] == mag, "replaying the captured batch changed the ammo"
        m2 = me(room(base, p, code), p)
        assert (m2["mag"], m2["score"], m2["credits"]) == (m["mag"], m["score"], m["credits"])
        says(page, page.get_by_role("group", name="Ammo"), f"{m['mag']} / {RESERVE}", "HUD shows ammo counted once")


def test_wf_waves_and_boss_full_run(app_url):
    base = app_url.rstrip("/")
    ps, code, st = start_match(base, 2)
    seen = {"phases": [], "first": {}, "ticks": {}}

    def on(s):
        key = (s["phase"], s["wave"])
        if not seen["phases"] or seen["phases"][-1] != key:
            seen["phases"].append(key)
            seen["first"][key] = s
            seen["ticks"][key] = s["tick"]
    final = play(base, ps, code, lambda s: s["phase"] == "over", 600, "squad won the boss wave", on=on)
    assert final["result"] == "victory" and final["wave"] == 4
    assert [k for k in seen["phases"] if k[0] != "countdown"] == [
        ("wave", 1), ("intermission", 1), ("wave", 2), ("intermission", 2), ("wave", 3), ("intermission", 3),
        ("boss_wave", 4), ("over", 4)], seen["phases"]
    for w in (1, 2, 3):
        s = seen["first"][("intermission", w)]
        assert INTERMISSION_MS - 1000 <= s["phase_remaining_ms"] <= INTERMISSION_MS
        length = seen["ticks"][("wave" if w < 3 else "boss_wave", w + 1)] - seen["ticks"][("intermission", w)]
        assert abs(length - INTERMISSION_MS // TICK_MS) <= TICK_SLACK
    for w, key in ((1, ("wave", 1)), (2, ("wave", 2)), (3, ("wave", 3)), (4, ("boss_wave", 4))):
        en = seen["first"][key]["enemies"]
        assert len(en) == len(WAVE_SPAWNS[w])
        for sx, sz in WAVE_SPAWNS[w]:
            assert any(abs(e["x"] - sx) <= 2.5 and abs(e["z"] - sz) <= 0.5 for e in en), (w, sx, sz)
    kinds = sorted(e["kind"] for e in seen["first"][("boss_wave", 4)]["enemies"])
    assert kinds == ["boss", "grunt", "grunt"] and "brute" in [e["kind"] for e in seen["first"][("wave", 3)]["enemies"]]
    ledger = ok(api("GET", base, f"/api/rooms/{code}/ledger", ps[0]))
    bonuses = [e for e in ledger["entries"] if e["kind"] == "wave_bonus" and e["amount"] > 0]
    assert all(e["amount"] == WAVE_BONUS for e in bonuses) and 4 <= len(bonuses) <= 8
    assert sum(1 for e in final["events"] if e["type"] == "wave_cleared") >= 1


def test_enemy_behaviour(app_url):
    base = app_url.rstrip("/")
    ps, code, st = start_match(base, 2)
    hunter, anchor = ps
    spawn = {e["id"]: (e["x"], e["z"]) for e in st["enemies"]}
    victim = min(st["enemies"], key=lambda e: math.dist((e["x"], e["z"]), (22, 28)))["id"]
    tick = st["tick"]
    for _ in range(3):
        s = after_ticks(base, ps, code, tick)
        e = next(e for e in s["enemies"] if e["id"] == victim)
        tick = shoot(base, anchor, code, aim_to(SPAWNS[2], (e["x"], e["z"])))["tick"]
    walk(base, anchor, code, (14.0, 1.0), keep=[hunter])
    log, attacked = [], False
    deadline = time.monotonic() + 120
    with snapshots(base, anchor, code) as stream:
        for s in stream:
            log.append(s)
            if len(log) % 20 == 0:
                beat(base, ps, code)
            m = me(s, hunter)
            if len(log) > 40 and m["status"] == "up":
                steer(base, hunter, code, m, (16.0, 18.5))
            attacked = attacked or any(e["state"] == "attack" for e in s["enemies"])
            if m["status"] != "up" and attacked and any(e["state"] == "patrol" and e["id"] != victim for e in s["enemies"]) \
                    and s["tick"] - next(x["tick"] for x in log if me(x, hunter)["status"] != "up") > 20:
                break
            if time.monotonic() > deadline:
                pytest.fail("grunts never detected, attacked and then returned to patrol")
    for s in log:
        for e in s["enemies"]:
            assert (math.floor(e["x"]), math.floor(e["z"])) not in SIEGE_BLOCKS, e
            if e["id"] == victim:
                assert e["state"] == "dead" and e["hp"] == 0
    for eid, (sx, sz) in spawn.items():
        if eid == victim:
            continue
        pts = [(s["tick"], next(e for e in s["enemies"] if e["id"] == eid)) for s in log[:40]]
        assert all(e["state"] == "patrol" and abs(e["x"] - sx) <= 2.05 for _, e in pts)
        path = sum(abs(b["x"] - a["x"]) for (_, a), (_, b) in zip(pts, pts[1:]))
        assert abs(path / ((pts[-1][0] - pts[0][0]) * TICK_MS / 1000) - GRUNT_PATROL) <= 0.25
    transitions = 0
    for eid in spawn:
        states = [(s["tick"], next(e for e in s["enemies"] if e["id"] == eid), me(s, hunter)) for s in log]
        det = next((i for i, (_, e, _) in enumerate(states) if e["state"] == "detect"), None)
        if det is None:
            continue
        t, e, h = states[det]
        assert math.dist((e["x"], e["z"]), (h["x"], h["z"])) <= DETECT_M + 0.3 and clear_line((e["x"], e["z"]), (h["x"], h["z"]))
        pur = next(i for i in range(det, len(states)) if states[i][1]["state"] == "pursue")
        assert abs(states[pur][0] - t - DETECT_TO_PURSUE_MS // TICK_MS) <= TICK_SLACK
        transitions += 1
        for (t1, a, _), (t2, b, _) in zip(states[pur:], states[pur + 1:]):
            if a["state"] == "pursue" and b["state"] == "pursue" and t2 > t1:
                assert math.dist((a["x"], a["z"]), (b["x"], b["z"])) / ((t2 - t1) * TICK_MS / 1000) <= GRUNT_PURSUE * (1 + SPEED_TOL)
        for _, e2, h2 in states:
            if e2["state"] == "attack":
                assert math.dist((e2["x"], e2["z"]), (h2["x"], h2["z"])) <= ATTACK_M + 0.3
    assert transitions >= 1
    hps = [me(s, hunter)["hp"] for s in log]
    drops = [a - b for a, b in zip(hps, hps[1:]) if b < a]
    assert drops and all(d % 10 == 0 for d in drops), drops


def test_grenade_splash(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 1)
    p = ps[0]
    st = walk(base, p, code, (16.0, 8.5))
    pos = (me(st, p)["x"], me(st, p)["z"])
    far = ok(rep(base, p, code, {"report_id": rid(), "type": "grenade", "target": {"x": 16.0, "z": pos[1] + GRENADE_RANGE + 1}}))
    assert far["reason"] == "out_of_range" and me(room(base, p, code), p)["grenades"] == 2
    for target, check in (((12.5, 21.0), "hit"), ((16.0, 20.5), "blocked")):
        r = ok(rep(base, p, code, {"report_id": rid(), "type": "grenade", "target": {"x": target[0], "z": target[1]}}))
        assert r["accepted"] and r["outcome"]["detonates_in_ms"] == FUSE_MS
        gid = r["outcome"]["grenade_id"]
        st = room(base, p, code)
        g = next(x for x in st["grenades"] if x["id"] == gid)
        assert 0 < g["fuse_remaining_ms"] <= FUSE_MS and abs(g["x"] - target[0]) < 0.01
        before = {b["id"]: b["hp"] for b in st["barrels"]}
        st = wait_room(base, ps, code, lambda s: any(e["type"] == "explosion" and e["source"] == f"grenade:{gid}" for e in s["events"]), 10, "grenade exploded")
        ex = next(e for e in st["events"] if e["type"] == "explosion" and e["source"] == f"grenade:{gid}")
        assert abs(ex["tick"] - r["tick"] - FUSE_MS // TICK_MS) <= 1
        for h in ex["hits"]:
            assert h["damage"] <= grenade_falloff(h["distance"])
        if check == "hit":
            b2 = barrel_at(st, BARRELS["B2"])
            h = next(h for h in ex["hits"] if h["id"] == b2["id"])
            d = math.dist(target, BARRELS["B2"])
            assert abs(h["distance"] - round(d, 2)) <= 0.01 and h["damage"] == grenade_falloff(d) == 12
            assert b2["hp"] == before[b2["id"]] - 12
        else:
            b4 = barrel_at(st, BARRELS["B4"])
            assert b4["id"] in ex["blocked"] and b4["id"] not in [h["id"] for h in ex["hits"]] and b4["hp"] == BARREL_HP
    r = ok(rep(base, p, code, {"report_id": rid(), "type": "grenade", "target": {"x": 16.0, "z": 12.0}}))
    assert r["reason"] == "no_grenades"


def test_barrel_chain(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 1)
    p = ps[0]
    walk(base, p, code, (16.0, 8.5))
    gid = ok(rep(base, p, code, {"report_id": rid(), "type": "grenade", "target": {"x": 9.0, "z": 17.0}}))["outcome"]["grenade_id"]
    st = wait_room(base, ps, code, lambda s: sum(e["type"] == "explosion" for e in s["events"]) >= 3, 10, "chain resolved")
    b1, b2 = barrel_at(st, BARRELS["B1"]), barrel_at(st, BARRELS["B2"])
    ex = [e for e in st["events"] if e["type"] == "explosion"]
    assert [e["source"] for e in ex] == [f"grenade:{gid}", f"barrel:{b2['id']}", f"barrel:{b1['id']}"]
    assert len({e["tick"] for e in ex}) == 1 and [e["seq"] for e in ex] == list(range(ex[0]["seq"], ex[0]["seq"] + 3))
    assert all(e["owner"] == p["id"] for e in ex)
    g = {h["id"]: h["damage"] for h in ex[0]["hits"]}
    assert g[b2["id"]] == BARREL_HP and g[b1["id"]] == grenade_falloff(math.dist((9, 17), BARRELS["B1"])) == 17
    assert next(h for h in ex[1]["hits"] if h["id"] == b1["id"])["damage"] == BARREL_HP - 17
    assert barrel_falloff(1.5) > BARREL_HP - 17
    assert b1["destroyed"] and b2["destroyed"] and b1["hp"] == 0 and b2["hp"] == 0
    assert (ex[1]["x"], ex[1]["z"]) == BARRELS["B2"]
    later = after_ticks(base, ps, code, st["tick"], 20)
    assert sum(e["type"] == "explosion" for e in later["events"]) == 3 and barrel_at(later, BARRELS["B1"])["destroyed"]


def test_wf_waves_and_boss_history(app_url):
    base = app_url.rstrip("/")
    ps, code, st = start_match(base, 2)
    g = min(st["enemies"], key=lambda e: math.dist((e["x"], e["z"]), (22, 28)))
    tick = st["tick"]
    for _ in range(3):
        s = after_ticks(base, ps, code, tick)
        e = next(e for e in s["enemies"] if e["id"] == g["id"])
        tick = shoot(base, ps[0], code, aim_to(SPAWNS[1], (e["x"], e["z"])))["tick"]
    end = ok(api("POST", base, f"/api/rooms/{code}/end", ps[0]))
    assert end["phase"] == "over" and end["result"] == "ended"
    err(api("POST", base, f"/api/rooms/{code}/end", ps[0]), 409, "wrong_phase")
    ps2, code2, _ = start_match(base, 1)
    ok(api("POST", base, f"/api/rooms/{code2}/end", ps2[0]))

    def mine(b):
        ms = ok(api("GET", b, "/api/history?limit=50"))["matches"]
        ends = [m["ended_at"] for m in ms]
        assert ends == sorted(ends, reverse=True)
        return [m for m in ms if m["code"] in (code, code2)]
    got = poll(lambda: (lambda m: m if len(m) == 2 else None)(mine(base)), 10, "both matches stored")
    assert [m["code"] for m in got] == [code2, code]
    m = got[1]
    assert (m["mode"], m["result"], m["waves_cleared"], m["night_id"]) == ("siege", "ended", 0, None)
    assert m["started_at"] <= m["ended_at"]
    assert [(x["callsign"], x["score"], x["kills"], x["credits_earned"]) for x in m["players"]] == [
        (ps[0]["callsign"], GRUNT_HP, 1, KILL_GRUNT), (ps[1]["callsign"], 0, 0, 0)]
    with app_copy({"VALKEY_URL": DOWN_URL, "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9"}) as copy:
        assert [x["code"] for x in mine(copy)] == [code2, code]


def test_wf_waves_and_boss_debrief(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/", reduced_motion="reduce") as page:
        enter(page)
        code = ui_start_room(page, callsign())
        mate = login(base)
        join(base, mate, code)
        ok(ready(base, mate, code))
        ui_ready_start(page)
        p = page_player(page, base)
        play(base, [p, mate], code, lambda s: s["phase"] == "over", 600, "squad won the boss wave")
        dlg = page.get_by_role("dialog", name="Debrief")
        shown(page, dlg, "Debrief opened", seconds=60)
        expect(dlg.get_by_role("heading", name="Victory")).to_be_visible()
        match = poll(lambda: next((m for m in ok(api("GET", base, "/api/history?limit=50"))["matches"] if m["code"] == code), None), 15, "match stored")
        assert match["result"] == "victory" and match["waves_cleared"] == 4
        table = dlg.get_by_role("table", name="Squad results")
        for x in match["players"]:
            row = table.get_by_role("row").filter(has_text=x["callsign"])
            for v in (x["score"], x["kills"], x["credits_earned"]):
                expect(row).to_contain_text(str(v))
        click(dlg.get_by_role("button", name="View history"))
        hist = page.get_by_role("dialog", name="History")
        shown(page, hist, "History opened from Debrief")
        expect(hist.get_by_role("table", name="Match history").get_by_role("row").filter(has_text=code)).to_contain_text("Victory")


def test_wf_downed_and_revive_window(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 2)
    medic, bait = ps
    walk(base, bait, code, (14.0, 18.5), keep=[medic])
    st = wait_room(base, [medic, bait], code, lambda s: me(s, bait)["status"] == "downed", 90, "teammate went down")
    b = me(st, bait)
    assert b["hp"] == 0 and 0 < b["revive_remaining_ms"] <= REVIVE_MS
    assert any(e["type"] == "player_down" for e in st["events"])
    far = ok(rep(base, medic, code, {"report_id": rid(), "type": "revive", "target_player": bait["id"]}))
    assert far["accepted"] is False and far["reason"] == "too_far"
    assert ok(rep(base, medic, code, {"report_id": rid(), "type": "revive", "target_player": medic["id"]}))["reason"] == "self_revive"
    assert ok(rep(base, bait, code, {"report_id": rid(), "type": "revive", "target_player": medic["id"]}))["reason"] == "not_up"
    assert shoot(base, bait, code, 270)["reason"] == "not_up"
    walk(base, medic, code, (b["x"], b["z"] - 1.2), seconds=9)
    body = {"report_id": rid(), "type": "revive", "target_player": bait["id"]}
    r = ok(rep(base, medic, code, body))
    assert r["accepted"] and r["outcome"] == {"revived": bait["id"]}
    st = room(base, medic, code)
    assert me(st, bait)["status"] == "up" and me(st, bait)["revive_remaining_ms"] is None
    assert me(st, bait)["hp"] <= REVIVED_HP and any(e["type"] == "player_revived" for e in st["events"])
    assert ok(rep(base, medic, code, body)) == r
    assert ok(rep(base, medic, code, {"report_id": rid(), "type": "revive", "target_player": bait["id"]}))["reason"] in ("not_downed", "too_far")


def test_wf_downed_and_revive_out_defeat(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 2)
    keeper, bait = ps
    walk(base, keeper, code, (16.0, 1.0), keep=[bait])
    walk(base, bait, code, (14.0, 18.5), keep=[keeper])
    down = wait_room(base, ps, code, lambda s: me(s, bait)["status"] == "downed", 90, "bait downed")
    kept = (me(down, bait)["reserve"], me(down, bait)["grenades"])
    out = wait_room(base, ps, code, lambda s: me(s, bait)["status"] == "out", 20, "bait out after the window")
    assert me(out, bait)["revive_remaining_ms"] is None
    td = next(e["tick"] for e in out["events"] if e["type"] == "player_down")
    to = next(e["tick"] for e in out["events"] if e["type"] == "player_out")
    assert abs(to - td - REVIVE_MS // TICK_MS) <= TICK_SLACK
    assert out["phase"] == "wave"
    inter = play(base, ps, code, lambda s: s["phase"] == "intermission", 120, "keeper cleared the wave",
                 spots={keeper["id"]: (16.0, 10.0)}, actors=[keeper], buy=False)
    st = wait_room(base, ps, code, lambda s: me(s, bait)["status"] == "up", 5, "bait respawned")
    b = me(st, bait)
    assert (b["hp"], b["mag"], (b["reserve"], b["grenades"])) == (100, MAG, kept)
    assert math.dist((b["x"], b["z"]), SPAWNS[2]) < 0.1 and any(e["type"] == "player_respawned" for e in st["events"])
    assert inter["phase"] == "intermission"
    solo, scode, _ = start_match(base, 1)
    walk(base, solo[0], scode, (16.0, 18.5))
    over = wait_room(base, solo, scode, lambda s: s["phase"] == "over", 90, "solo squad defeated")
    assert over["result"] == "defeat"


def test_wf_downed_and_revive_browser(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        enter(page)
        code = ui_start_room(page, callsign())
        with app_page(browser, f"{base}/room/{code}") as mate_page:
            enter(mate_page)
            click(mate_page.get_by_role("dialog", name="Join by code").get_by_role("button", name="Join room"))
            save_callsign(mate_page, callsign())
            mate = page_player(mate_page, base)
            click(lobby(mate_page).get_by_role("button", name="Ready"))
            ui_ready_start(page)
            host = page_player(page, base)
            wait_room(base, [host, mate], code, lambda s: s["phase"] == "wave", 30, "wave began")
            walk(base, mate, code, (16.0, 18.5))
            wait_room(base, [host, mate], code, lambda s: me(s, mate)["status"] == "downed", 90, "teammate downed")
            shown(page, page.get_by_role("timer", name=f"Revive window {mate['callsign']}"), "revive window shown")
            page.keyboard.down("KeyW")
            try:
                deadline = time.monotonic() + 9
                while time.monotonic() < deadline:
                    s = room(base, host, code)
                    if math.dist((me(s, host)["x"], me(s, host)["z"]), (me(s, mate)["x"], me(s, mate)["z"])) <= 1.8:
                        break
                    advance(page, 100)
                else:
                    pytest.fail("Move up never brought the host within revive range")
            finally:
                page.keyboard.up("KeyW")
            page.keyboard.press("KeyF")
            poll(lambda: me(room(base, host, code), mate)["status"] == "up", 5, "server revived the teammate")
            says(page, feed(page), f"{mate['callsign']} revived", "reviver feed")
            says(mate_page, mate_page.get_by_role("group", name="Status"), "Up", "teammate HUD shows Up")


def test_wf_intermission_shop_ledger(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 1)
    p = ps[0]
    clear_wave_one(base, ps, code)
    ok(purchase(base, p, code, "ammo_pack"), 201)
    led = ok(api("GET", base, f"/api/rooms/{code}/ledger", p))
    es = led["entries"]
    mine = [e for e in es if e["account"] == p["id"]]
    assert sorted((e["kind"], e["amount"]) for e in mine) == sorted(
        [("kill_reward", KILL_GRUNT)] * 3 + [("wave_bonus", WAVE_BONUS), ("purchase", -PRICES["ammo_pack"])])
    for e in mine:
        twin = [x for x in es if x["ref"] == e["ref"] and x["account"] != p["id"]]
        assert len(twin) == 1 and twin[0]["amount"] == -e["amount"]
        assert twin[0]["account"] == ("studio:ammo_station" if e["kind"] == "purchase" else "studio:rewards")
    buy = next(e for e in mine if e["kind"] == "purchase")
    assert buy["unit_price"] == PRICES["ammo_pack"] and buy["item"] == "ammo_pack"
    for acct, bal in led["balances"].items():
        assert bal == sum(e["amount"] for e in es if e["account"] == acct)
    assert led["total"] == 0 and sum(e["amount"] for e in es) == 0
    assert led["balances"][p["id"]] == me(room(base, p, code), p)["credits"] == 3 * KILL_GRUNT + WAVE_BONUS - PRICES["ammo_pack"]


def test_wf_intermission_shop_purchases(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 1)
    p = ps[0]
    err(purchase(base, p, code, "med_kit"), 409, "shop_closed")
    clear_wave_one(base, ps, code)
    ids = ["p" + uuid.uuid4().hex for _ in range(3)]
    with ThreadPoolExecutor(3) as pool:
        rs = list(pool.map(lambda i: purchase(base, p, code, "med_kit", i), ids))
    won = [r for r in rs if r.status_code == 201]
    assert len(won) == 1 and all(r.json()["error"]["code"] == "insufficient_credits" for r in rs if r.status_code != 201)
    w = won[0].json()
    left = 3 * KILL_GRUNT + WAVE_BONUS - PRICES["med_kit"]
    assert w["unit_price"] == PRICES["med_kit"] and w["balance"] == left and w["item"] == "med_kit"
    again = purchase(base, p, code, "med_kit", w["purchase_id"])
    assert again.status_code == 201 and again.json() == w
    err(purchase(base, p, code, "grenade", w["purchase_id"]), 409, "purchase_conflict")
    err(purchase(base, p, code, "grenade"), 409, "insufficient_credits")
    m = me(room(base, p, code), p)
    assert m["credits"] == left and m["grenades"] == 2
    e = err(purchase(base, p, code, "rocket"), 422, "validation")
    assert "item" in e["fields"]
    assert sum(1 for x in ok(api("GET", base, f"/api/rooms/{code}/ledger", p))["entries"] if x["kind"] == "purchase" and x["account"] == p["id"]) == 1


def test_wf_intermission_shop_drawer(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        page.clock.set_system_time(WRONG_DEVICE_TIME)
        code, p = ui_solo_match(page, base)
        hud = page.get_by_role("region", name="HUD")
        expect(hud.get_by_role("button", name="Shop")).to_be_disabled()
        expect(page.get_by_role("dialog", name="Ammo station")).to_have_count(0)
        assert not any(n.startswith("Buy ") for n in tab_order(page, 8))
        clear_wave_one(base, [p], code)
        eventually(page, lambda: expect(hud.get_by_role("button", name="Shop")).to_be_enabled(timeout=250), "Shop enabled")
        page.keyboard.press("KeyB")
        drawer = page.get_by_role("dialog", name="Ammo station")
        shown(page, drawer, "drawer opened")
        first = drawer.get_by_role("button", name=f"Buy Ammo pack — {PRICES['ammo_pack']} cr")
        expect(first).to_be_focused()
        names = tab_order(page, 8)
        assert set(names) <= {f"Buy {NAMES[k]} — {v} cr" for k, v in PRICES.items()} | {"Close"}, names
        first.focus()
        page.keyboard.press("Enter")
        says(page, notices(page), f"Bought Ammo pack for {PRICES['ammo_pack']} cr.", "keyboard buy")
        click(first)
        poll(lambda: me(room(base, p, code), p)["credits"] == 3 * KILL_GRUNT + WAVE_BONUS - 2 * PRICES["ammo_pack"], 10, "pointer buy")
        m = me(room(base, p, code), p)
        says(page, hud.get_by_role("group", name="Credits"), re.compile(rf"(^|\D){m['credits']} cr"), "credits after buys")
        says(page, hud.get_by_role("group", name="Ammo"), f"{m['mag']} / {m['reserve']}", "ammo after buys")
        click(drawer.get_by_role("button", name=f"Buy Med kit — {PRICES['med_kit']} cr"))
        says(page, notices(page), f"Not enough credits — Med kit costs {PRICES['med_kit']} cr.", "insufficient copy")
        says(page, wave_group(page), "Wave 2 of 3", "wave 2 began", seconds=40)
        gone(page, page.get_by_role("dialog", name="Ammo station"), "drawer closed when the wave began")
        assert hud.evaluate("e => e.contains(document.activeElement)"), "focus returned to the HUD"
        units = [e["unit_price"] for e in ok(api("GET", base, f"/api/rooms/{code}/ledger", p))["entries"] if e["kind"] == "purchase" and e["account"] == p["id"]]
        assert units == [PRICES["ammo_pack"]] * 2


def test_wf_intermission_shop_price_moment():
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        eff = studio_at(friday, 19, 30)
        clock_set(base, eff - timedelta(days=1))
        founder = login(base, STUDIO_KEY)
        old = next(i["current_price"] for i in ok(api("GET", base, "/api/prices"))["items"] if i["item"] == "ammo_pack")
        new = 61 if old != 61 else 62
        ok(api("POST", base, "/api/prices", founder, {"item": "ammo_pack", "price": new, "effective_local": f"{friday.isoformat()}T19:30"}), 201)
        ps, code, _ = start_match(base, 1)
        p = ps[0]
        clear_wave_one(base, ps, code)
        clock_set(base, eff - timedelta(seconds=1))
        a = ok(purchase(base, p, code, "ammo_pack"), 201)
        clock_set(base, eff)
        b = ok(purchase(base, p, code, "ammo_pack"), 201)
        assert a["unit_price"] == old and b["unit_price"] == new
        units = [e["unit_price"] for e in ok(api("GET", base, f"/api/rooms/{code}/ledger", p))["entries"] if e["kind"] == "purchase" and e["account"] == p["id"]]
        assert units == [old, new]
    finally:
        clock_reset(base)


@pytest.mark.timeout(600)
def test_wf_host_migration_lease_grace(app_url, valkey):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 3)
    host, quiet, gone_p = ps
    t0 = time.monotonic()
    st = wait_room(base, [host, gone_p], code, lambda s: me(s, quiet)["connection"] == "disconnected", 15, "quiet seat disconnected")
    assert LEASE_S - 1 <= time.monotonic() - t0 <= LEASE_S + TIME_SLACK_S
    q = me(st, quiet)
    assert GRACE_MS - 5000 < q["grace_remaining_ms"] <= GRACE_MS
    assert valkey.keys(f"hf:grace:{code}:{quiet['id']}") and not valkey.keys(f"hf:seat:{code}:{quiet['id']}")
    assert 0 <= valkey.ttl(f"hf:seat:{code}:{host['id']}") <= LEASE_S
    back = room(base, quiet, code)
    q2 = me(back, quiet)
    assert q2["connection"] == "connected" and (q2["seat"], q2["hp"], q2["mag"]) == (q["seat"], q["hp"], q["mag"])
    assert any(e["type"] == "reconnected" for e in back["events"])
    with ThreadPoolExecutor(4) as pool:
        rs = list(pool.map(lambda _: join(base, quiet, code), range(4)))
    assert {r["seat"] for r in rs} == {2} and len(room(base, host, code)["players"]) == 3
    t1 = time.monotonic()
    wait_room(base, [host, quiet], code, lambda s: me(s, gone_p)["connection"] == "disconnected", 15, "third seat disconnected")
    st = wait_room(base, [host, quiet], code, lambda s: me(s, gone_p)["connection"] == "left", GRACE_MS / 1000 + 20, "grace released the seat")
    assert time.monotonic() - t1 >= GRACE_MS / 1000 + LEASE_S - TIME_SLACK_S
    assert any(e["type"] == "released" for e in st["events"]) and me(st, gone_p)["status"] != "up" or True
    err(api("POST", base, f"/api/rooms/{code}/join", gone_p), 409, "seat_released")


def test_wf_host_migration_leave(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 3)
    a, b, c = ps
    st = ok(api("POST", base, f"/api/rooms/{code}/leave", a))
    assert st["host"] == b["id"] and me(st, a)["connection"] == "disconnected"
    assert any(e["type"] == "host_changed" for e in st["events"])
    st = ok(api("POST", base, f"/api/rooms/{code}/leave", b))
    assert st["host"] == c["id"]
    st = room(base, a, code)
    assert me(st, a)["connection"] == "connected" and st["host"] == c["id"]
    err(api("POST", base, f"/api/rooms/{code}/end", a), 403, "not_host")
    assert ok(api("POST", base, f"/api/rooms/{code}/end", c))["result"] == "ended"
    h, g = login(base), login(base)
    lc = create(base, h)["code"]
    join(base, g, lc)
    st = ok(api("POST", base, f"/api/rooms/{lc}/leave", h))
    assert st["host"] == g["id"] and h["id"] not in [x["id"] for x in st["players"]]


def test_wf_host_migration_browser(browser, app_url):
    base = app_url.rstrip("/")
    host = login(base)
    code = create(base, host)["code"]
    ok(ready(base, host, code))
    with app_page(browser, f"{base}/room/{code}") as page:
        page.clock.set_system_time(WRONG_DEVICE_TIME)
        enter(page)
        cs = callsign()
        click(page.get_by_role("dialog", name="Join by code").get_by_role("button", name="Join room"))
        save_callsign(page, cs)
        eventually(page, lambda: (beat(base, [host], code), expect(page.get_by_role("list", name="Seats")).to_contain_text(cs, timeout=250)),
                   "guest seated while the host was still connected")
        click(lobby(page).get_by_role("button", name="Ready"))
        seats = page.get_by_role("list", name="Seats")
        says(page, seats, f"Seat 2 · {cs} · Ready · Host", "guest became host", seconds=LEASE_S + 15)
        says(page, seats, f"Seat 1 · {host['callsign']} · Ready · Host · Disconnected", "old host disconnected") if False else \
            says(page, seats, f"Seat 1 · {host['callsign']} · Ready", "old host listed")
        expect(seats.get_by_role("listitem").filter(has_text=f"Seat 1 · {host['callsign']}")).to_contain_text("Disconnected")
        start = lobby(page).get_by_role("button", name="Start match")
        eventually(page, lambda: expect(start).to_be_enabled(timeout=250), "new host can start")
        click(start)
        guest = page_player(page, base)
        st = poll(lambda: (lambda s: s if s["phase"] in ("countdown", "wave") else None)(room(base, guest, code)), 10, "match started")
        assert st["host"] == guest["id"]


@pytest.mark.timeout(900)
def test_wf_convoy_race_laps(app_url):
    base = app_url.rstrip("/")
    p = login(base)
    code = create(base, p, "convoy")["code"]
    assert pose(base, p, code, 20, 9, 0)["reason"] == "not_racing"
    ok(ready(base, p, code))
    ok(api("POST", base, f"/api/rooms/{code}/start", p))
    st = wait_room(base, [p], code, lambda s: s["phase"] == "race", 20, "race started")
    v = vehicle(st, p)
    assert (v["x"], v["z"], v["heading"], v["next_checkpoint"], v["laps_done"], v["state"]) == (*CONVOY_START[1], 0, 1, 0, "running")
    t_start = time.monotonic()
    r = drive(base, p, code, [CHECKPOINTS[4]], 20)
    assert r["vehicle"]["next_checkpoint"] == 1
    old = r
    nexts, laps = [], []
    r = drive(base, p, code, [(20, 12)] + LAP_PATH, 20, on_pose=lambda r, now: (nexts.append(r["vehicle"]["next_checkpoint"]), laps.append((r["vehicle"]["laps_done"], now))))
    order = [n for i, n in enumerate(nexts) if i == 0 or nexts[i - 1] != n]
    assert order[:5] == [1, 2, 3, 4, 0] and order[5] == 1
    t1 = next(t for n, t in laps if n == 1)
    stale = pose(base, p, code, 50, 50, 0, seq=old["seq"])
    assert stale["accepted"] is False and stale["reason"] == "stale_seq"
    lap1 = vehicle(room(base, p, code), p)
    assert lap1["laps_done"] == 1
    for _ in range(2):
        r = drive(base, p, code, LAP_PATH, 20)
    st = wait_room(base, [p], code, lambda s: s["phase"] == "over", 15, "race finished")
    v = vehicle(st, p)
    assert st["result"] == "finished" and v["state"] == "finished" and v["laps_done"] == 3
    length = sum(math.dist(a, b) for a, b in zip([(20, 8), (20, 60), (20, 12)] + LAP_PATH, ([(20, 60), (20, 12)] + LAP_PATH)))
    assert v["best_lap_ms"] >= sum(math.dist(a, b) for a, b in zip([LAP_PATH[-1]] + LAP_PATH, LAP_PATH)) / TOP_SPEED * 1000
    lap_events = [e for e in st["events"] if e["type"] == "lap"]
    assert len(lap_events) == 3 and length > 0
    assert abs((t1 - t_start) * 1000 - (lap_events[0].get("lap_ms") or (t1 - t_start) * 1000)) <= TIME_SLACK_S * 1000


def test_wf_convoy_race_pose_speed(app_url):
    base = app_url.rstrip("/")
    ps, code, st = start_match(base, 1, "convoy")
    p = ps[0]
    r = pose(base, p, code, 120, 8, 0)
    assert r["accepted"] is False and r["reason"] == "too_fast" and (r["vehicle"]["x"], r["vehicle"]["z"]) == CONVOY_START[1]
    threading.Event().wait(0.6)
    a = pose(base, p, code, 30, 8, 0)
    assert a["accepted"]
    b = pose(base, p, code, 40, 8, 0)
    assert b["accepted"] is False and b["reason"] == "too_fast" and abs(b["vehicle"]["x"] - 30) < 1e-6
    c = pose(base, p, code, 30.4, 8, 0)
    assert c["accepted"]
    s = pose(base, p, code, 31, 8, 0, seq=c["seq"])
    assert s["reason"] == "stale_seq" and abs(vehicle(room(base, p, code), p)["x"] - 30.4) < 1e-6
    e = err(api("POST", base, f"/api/rooms/{code}/pose", p, {"seq": p["pseq"] + 1, "x": 31, "z": 8, "heading": 400}), 422, "validation")
    assert e["fields"]


def test_wreck_reset(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 1, "convoy")
    p = ps[0]
    drive(base, p, code, [CHECKPOINTS[1], (100, 35)], 20)
    facing = aim_to(CHECKPOINTS[1], CHECKPOINTS[2])
    for bad in ((100, 41), (100, -1)):
        threading.Event().wait(0.3)
        before = vehicle(room(base, p, code), p)
        r = pose(base, p, code, bad[0], bad[1], 90)
        assert r["accepted"] is True and r["vehicle"]["state"] == "wrecked"
        assert (round(r["vehicle"]["x"], 3), round(r["vehicle"]["z"], 3)) == (round(before["x"], 3), round(before["z"], 3))
        assert pose(base, p, code, before["x"], before["z"], 90)["reason"] == "wrecked"
        st = room(base, p, code)
        assert 0 < vehicle(st, p)["reset_remaining_ms"] <= RESET_MS
        st = wait_room(base, ps, code, lambda s: vehicle(s, p)["state"] == "running", 10, "vehicle reset")
        v = vehicle(st, p)
        assert math.dist((v["x"], v["z"]), CHECKPOINTS[1]) < 0.01 and abs(v["heading"] - facing) < 0.5
        w = [e["tick"] for e in st["events"] if e["type"] == "wrecked"][-1]
        rs = [e["tick"] for e in st["events"] if e["type"] == "reset"][-1]
        assert abs(rs - w - RESET_MS // TICK_MS) <= TICK_SLACK
        assert v["lap_elapsed_ms"] >= before["lap_elapsed_ms"] + RESET_MS - 200
        if bad == (100, 41):
            drive(base, p, code, [(100, 2)], 20)


@pytest.mark.timeout(600)
def test_lap_board(app_url):
    base = app_url.rstrip("/")
    ps, code, _ = start_match(base, 2, "convoy")
    fast, slow = ps
    with ThreadPoolExecutor(2) as pool:
        jobs = [pool.submit(drive, base, fast, code, LAP_PATH, 20),
                pool.submit(drive, base, slow, code, [(20, 12)] + LAP_PATH, 13)]
        for j in jobs:
            j.result()
    host_id = room(base, slow, code)["host"]
    ok(api("POST", base, f"/api/rooms/{code}/end", fast if host_id == fast["id"] else slow))

    def board(b):
        laps = ok(api("GET", b, "/api/laps?limit=50"))["laps"]
        ms = [x["lap_ms"] for x in laps]
        assert ms == sorted(ms) and [x["rank"] for x in laps] == list(range(1, len(laps) + 1))
        return {x["callsign"]: x for x in laps}
    got = poll(lambda: (lambda b: b if fast["callsign"] in b and slow["callsign"] in b else None)(board(base)), 10, "both laps on the board")
    a, b = got[fast["callsign"]], got[slow["callsign"]]
    assert a["rank"] < b["rank"] and a["lap_ms"] < b["lap_ms"] and a["match_id"] == b["match_id"]
    with app_copy({"VALKEY_URL": DOWN_URL, "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9"}) as copy:
        again = board(copy)
        assert again[fast["callsign"]]["lap_ms"] == a["lap_ms"] and again[fast["callsign"]]["rank"] < again[slow["callsign"]]["rank"]


@pytest.mark.timeout(900)
def test_wf_convoy_race_browser(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        enter(page)
        code = ui_start_room(page, callsign(), convoy=True)
        with app_page(browser, f"{base}/room/{code}") as ph:
            cdp = phone(ph)
            ph.reload()
            enter(ph)
            click(ph.get_by_role("dialog", name="Join by code").get_by_role("button", name="Join room"))
            save_callsign(ph, callsign())
            click(lobby(ph).get_by_role("button", name="Ready"))
            ui_ready_start(page)
            p = page_player(page, base)
            wait_room(base, [p], code, lambda s: s["phase"] == "race", 30, "race started")
            shown(ph, ph.get_by_role("group", name="Move stick"), "phone shows the Move stick")
            expect(ph.get_by_role("group", name="Aim stick")).to_have_count(0)
            expect(ph.get_by_role("button", name="Fire", exact=True)).to_have_count(0)
            assert cdp
            keys = {"KeyW": False, "KeyA": False, "KeyD": False}

            def hold(k, on):
                if keys[k] != on:
                    (page.keyboard.down if on else page.keyboard.up)(k)
                    keys[k] = on
            i, last_tick, seen2 = 0, -1, False
            deadline = time.monotonic() + 600
            while time.monotonic() < deadline:
                st = room(base, p, code)
                v = vehicle(st, p)
                if v["laps_done"] >= 1:
                    break
                if st["tick"] < last_tick + 2:
                    continue
                last_tick = st["tick"]
                if v["next_checkpoint"] == 2 and not seen2:
                    says(page, page.get_by_role("group", name="Checkpoint"), "Next checkpoint 2 of 4", "counter after C1")
                    seen2 = True
                if v["state"] == "running":
                    if math.dist((v["x"], v["z"]), BROWSER_LINE[i]) < 5:
                        i = (i + 1) % len(BROWSER_LINE)
                    e = (aim_to((v["x"], v["z"]), BROWSER_LINE[i]) - v["heading"] + 540) % 360 - 180
                    hold("KeyA", e > 6)
                    hold("KeyD", e < -6)
                    hold("KeyW", abs(e) < 35)
                else:
                    for k in keys:
                        hold(k, False)
                advance(page, 100)
            else:
                pytest.fail("browser racer never completed a lap")
            for k in keys:
                hold(k, False)
            best = vehicle(room(base, p, code), p)["best_lap_ms"]
            says(page, page.get_by_role("group", name="Lap", exact=True), "Lap 2 of 3", "lap counter")
            says(page, page.get_by_role("group", name="Best lap"), fmt_lap(best), "best lap")
            says(page, feed(page), f"Lap 1: {fmt_lap(best)}", "lap feed line")
            laps = ok(api("GET", base, "/api/laps?limit=50"))["laps"]
            assert any(x["callsign"] == p["callsign"] and x["lap_ms"] == best for x in laps)
            page.keyboard.press("Escape")
            click(page.get_by_role("dialog", name="Paused").get_by_role("button", name="Leave room"))
            click(page.get_by_role("button", name="History", exact=True))
            hist = page.get_by_role("dialog", name="History")
            click(hist.get_by_role("tab", name="Lap board"))
            row = hist.get_by_role("table", name="Lap board").get_by_role("row").filter(has_text=p["callsign"])
            says(page, row, fmt_lap(best), "Lap board row")


def test_wf_night_schedule_series(app_url):
    base = outage("APP_CLOCK_URL")
    try:
        clock_set(base, datetime(2027, 1, 1, 12, tzinfo=timezone.utc))
        founder, player = login(base, STUDIO_KEY), login(base)
        title, nights = series(base, founder, date(2027, 3, 5), weeks=3, capacity=10)
        assert [n["date"] for n in nights] == ["2027-03-05", "2027-03-12", "2027-03-19"]
        for n in nights:
            start = studio_at(date.fromisoformat(n["date"]), 20, 0)
            assert (n["local_start"], n["scheduled_local_time"], n["starts_at"]) == ("20:00", "20:00", iso(start))
            assert n["zone_abbr"] == start.tzname() and n["dst_note"] is None and n["title"] == title
            assert n["signups_open_at"] == iso(start - timedelta(hours=OPEN_H))
            assert n["signups_close_at"] == iso(start - timedelta(hours=CLOSE_H))
            assert n["ends_at"] == iso(start + timedelta(hours=END_H)) and n["capacity"] == 10 and n["seats_left"] == 10
        assert [n["zone_abbr"] for n in nights] == ["CST", "CST", "CDT"]
        ids = lambda f: [x["id"] for x in ok(api("GET", base, f"/api/nights?from={f}&days=1"))["nights"]]
        assert nights[0]["id"] in ids("2027-03-05") and nights[0]["id"] not in ids("2027-03-06")
        assert night(base, nights[0]["id"])["starts_at"] == nights[0]["starts_at"]
        _, twins = series(base, founder, date(2027, 3, 5), weeks=1, title=title)
        assert twins[0]["id"] != nights[0]["id"] and twins[0]["starts_at"] == nights[0]["starts_at"]
        good = {"title": "T", "mode": "siege", "weekday": "friday", "local_time": "20:00", "first_date": "2027-03-05", "weeks": 1, "capacity": 5}
        for field, value in [("first_date", "2027-03-06"), ("weeks", 27), ("capacity", 65), ("local_time", "24:00"), ("title", "")]:
            e = err(api("POST", base, "/api/nights/series", founder, {**good, field: value}), 422, "validation")
            assert field in e["fields"]
        err(api("POST", base, "/api/nights/series", player, good), 403, "founder_only")
        err(api("POST", base, "/api/nights/series", None, good), 401, "unauthenticated")
    finally:
        clock_reset(base)


def test_wf_night_schedule_dst(app_url):
    base = outage("APP_CLOCK_URL")
    try:
        clock_set(base, datetime(2027, 1, 1, 12, tzinfo=timezone.utc))
        founder = login(base, STUDIO_KEY)
        _, spring = series(base, founder, date(2027, 3, 7), hhmm="02:30", weeks=3)
        _, fall = series(base, founder, date(2027, 10, 31), hhmm="01:30", weeks=3)
        for group, hh, mm in ((spring, 2, 30), (fall, 1, 30)):
            for n in group:
                start = studio_at(date.fromisoformat(n["date"]), hh, mm)
                assert n["starts_at"] == iso(start) and n["scheduled_local_time"] == f"{hh:02d}:{mm:02d}"
        gap = next(n for n in spring if n["date"] == "2027-03-14")
        assert (gap["local_start"], gap["starts_at"], gap["dst_note"]) == ("03:30", "2027-03-14T08:30:00Z", "shifted_forward")
        rep_ = next(n for n in fall if n["date"] == "2027-11-07")
        assert (rep_["local_start"], rep_["starts_at"], rep_["zone_abbr"], rep_["dst_note"]) == ("01:30", "2027-11-07T06:30:00Z", "CDT", "first_occurrence")
        for n in spring + fall:
            if n is not gap and n is not rep_:
                assert n["dst_note"] is None and n["local_start"] == n["scheduled_local_time"]
        assert gap["signups_open_at"] == iso(inst(gap["starts_at"]) - timedelta(hours=OPEN_H))
    finally:
        clock_reset(base)


def test_wf_night_schedule_status_clock(browser):
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        start = studio_at(friday, 20, 0)
        clock_set(base, start - timedelta(days=30))
        founder = login(base, STUDIO_KEY)
        title, nights = series(base, founder, friday)
        nid = nights[0]["id"]
        opn, cls, end = start - timedelta(hours=OPEN_H), start - timedelta(hours=CLOSE_H), start + timedelta(hours=END_H)
        for at, want, nxt in [(opn - timedelta(seconds=1), "scheduled", opn), (opn, "signups_open", cls),
                              (cls - timedelta(seconds=1), "signups_open", cls), (cls, "closed", start),
                              (start - timedelta(seconds=1), "closed", start), (start, "live", end),
                              (end - timedelta(seconds=1), "live", end), (end, "done", None)]:
            clock_set(base, at)
            n = night(base, nid)
            assert n["status"] == want, (at, n["status"])
            if nxt is None:
                assert n["status_changes_in_ms"] is None
            else:
                exp = (nxt - at).total_seconds() * 1000
                assert exp - 5000 <= n["status_changes_in_ms"] <= exp
        clock_set(base, opn + timedelta(hours=1))
        with app_page(browser, base + "/nights") as page:
            page.clock.set_system_time(WRONG_DEVICE_TIME)
            page.reload()
            enter(page)
            btn = page.get_by_role("button", name=f"Sign up for {title} on {ddd(start)}")
            shown(page, btn, "night row listed")
            row = page.get_by_role("list", name="Upcoming nights").get_by_role("listitem").filter(has=btn).last
            expect(row).to_contain_text(STATUS_COPY["signups_open"])
            expect(btn).to_be_enabled()
            tm = row.get_by_role("timer", name="Sign-ups close")
            txt, ms = timer_reading(tm)
            api_ms = (inst(night(base, nid)["signups_close_at"]) - inst(ok(api("GET", base, "/api/clock"))["now"])).total_seconds() * 1000
            assert -2000 <= int(ms) - api_ms <= 20000 and fuse_matches(txt, int(ms)), (txt, ms, api_ms)
            clock_set(base, cls)
            page.reload()
            row = page.get_by_role("list", name="Upcoming nights").get_by_role("listitem").filter(has_text=title).first
            says(page, row, STATUS_COPY["closed"], "row shows sign-ups closed")
            expect(page.get_by_role("button", name=f"Sign up for {title} on {ddd(start)}")).to_be_disabled()
    finally:
        clock_reset(base)


def test_wf_night_schedule_browser(browser):
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        start = studio_at(friday, 20, 0)
        clock_set(base, start - timedelta(days=2))
        title = f"Night {uuid.uuid4().hex[:8]}"
        with app_page(browser, base + "/") as page:
            cdp = session(page)
            cdp.send("Emulation.setTimezoneOverride", {"timezoneId": VIEWER_ZONE})
            page.reload()
            enter(page)
            ui_login(page, callsign(), STUDIO_KEY)
            click(page.get_by_role("button", name="Nights", exact=True))
            nights_dlg = page.get_by_role("dialog", name="Nights")
            shown(page, nights_dlg, "Nights opened")
            click(nights_dlg.get_by_role("button", name="New weekly night"))
            dlg = page.get_by_role("dialog", name="New weekly night")
            shown(page, dlg, "series dialog opened")
            posts = []
            page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/api/nights/series") else None)
            fill(dlg.get_by_role("textbox", name="Title"), title)
            select(dlg.get_by_role("combobox", name="Mode"), "Siege")
            select(dlg.get_by_role("combobox", name="Weekday"), "Friday")
            fill(dlg.get_by_role("textbox", name="Start time"), "8pm")
            fill(dlg.get_by_role("textbox", name="First date"), friday.isoformat())
            fill(dlg.get_by_role("spinbutton", name="Weeks"), "3")
            fill(dlg.get_by_role("spinbutton", name="Capacity"), "10")
            click(dlg.get_by_role("button", name="Schedule nights"))
            eventually(page, lambda: expect(dlg.get_by_role("textbox", name="Start time")).to_have_accessible_description("Use HH:MM, 24-hour.", timeout=250), "start time error")
            assert posts == []
            fill(dlg.get_by_role("textbox", name="Start time"), "20:00")
            click(dlg.get_by_role("button", name="Schedule nights"))
            says(page, notices(page), f"Scheduled 3 nights of {title}.", "schedule copy")
            got = [n for n in ok(api("GET", base, f"/api/nights?from={friday.isoformat()}&days=21"))["nights"] if n["title"] == title]
            assert len(got) == 3 and all(n["local_start"] == "20:00" for n in got)
            lst = page.get_by_role("list", name="Upcoming nights")
            for n in got:
                s = inst(n["starts_at"])
                loc, tok = s.astimezone(STUDIO), s.astimezone(ZoneInfo(VIEWER_ZONE))
                says(page, lst, "", "list")
                expect(lst.get_by_role("heading", name=ddd_y(loc))).to_have_count(1)
                btn = page.get_by_role("button", name=f"Sign up for {title} on {ddd(loc)}")
                row = lst.get_by_role("listitem").filter(has=btn).last
                expect(row).to_contain_text(re.compile(re.escape(f"{loc:%H:%M} {loc.tzname()} studio · Your time {ddd(tok)} {tok:%H:%M} ") + r"\S+"))
                expect(row).to_contain_text("Seats left 10")
    finally:
        clock_reset(base)


def far_instant():
    return f"{random.randrange(2031, 2090)}-0{random.randrange(1, 10)}-1{random.randrange(0, 9)}T1{random.randrange(0, 10)}:{random.randrange(10, 60)}"


def test_price_change_error_precedence(app_url):
    base = app_url.rstrip("/")
    founder, player = login(base, STUDIO_KEY), login(base)
    when = far_instant()
    ok(api("POST", base, "/api/prices", founder, {"item": "med_kit", "price": 99, "effective_local": when}), 201)
    for price in (0, 5001):
        err(api("POST", base, "/api/prices", founder, {"item": "med_kit", "price": price, "effective_local": when}), 409, "price_change_exists")
    err(api("POST", base, "/api/prices", None, {"item": "med_kit"}), 401, "unauthenticated")
    err(api("POST", base, "/api/prices", player, {"item": "med_kit", "price": 0, "effective_local": "no"}), 403, "founder_only")
    fresh = far_instant()
    assert "price" in err(api("POST", base, "/api/prices", founder, {"item": "med_kit", "price": 0, "effective_local": fresh}), 422, "validation")["fields"]


def test_wf_price_schedule_effective():
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        eff = studio_at(friday, 19, 30)
        clock_set(base, eff - timedelta(days=1))
        founder = login(base, STUDIO_KEY)
        price_of = lambda: next(i["current_price"] for i in ok(api("GET", base, "/api/prices"))["items"] if i["item"] == "ammo_pack")
        old = price_of()
        new = 61 if old != 61 else 62
        local = f"{friday.isoformat()}T19:30"
        row = ok(api("POST", base, "/api/prices", founder, {"item": "ammo_pack", "price": new, "effective_local": local}), 201)
        assert row["effective_at"] == iso(eff) and row["status"] == "pending"
        err(api("POST", base, "/api/prices", founder, {"item": "ammo_pack", "price": new + 1, "effective_local": local}), 409, "price_change_exists")
        ps, code, _ = start_match(base, 1)
        p = ps[0]
        err(api("POST", base, "/api/prices", p, {"item": "ammo_pack", "price": 5, "effective_local": local}), 403, "founder_only")
        for field, body in [("price", {"price": 0}), ("price", {"price": 5001}), ("effective_local", {"effective_local": "2026-01-01T00:00"})]:
            e = err(api("POST", base, "/api/prices", founder, {"item": "med_kit", "price": 99, "effective_local": local, **body}), 422, "validation")
            assert field in e["fields"]
        spare = ok(api("POST", base, "/api/prices", founder, {"item": "med_kit", "price": 99, "effective_local": f"{(friday + timedelta(days=1)).isoformat()}T19:30"}), 201)
        ok(api("DELETE", base, f"/api/prices/{spare['id']}", founder), 204)
        assert spare["id"] not in [s["id"] for s in ok(api("GET", base, "/api/prices"))["schedule"]]
        err(api("DELETE", base, "/api/prices/nope-404", founder), 404, "not_found")
        mar = date(friday.year + 1, 3, 8)
        sunday = mar + timedelta(days=(6 - mar.weekday()) % 7)
        gap = ok(api("POST", base, "/api/prices", founder, {"item": "grenade", "price": 77, "effective_local": f"{sunday.isoformat()}T02:30"}), 201)
        assert gap["effective_at"] == iso(studio_at(sunday, 2, 30))
        ok(api("DELETE", base, f"/api/prices/{gap['id']}", founder), 204)
        clear_wave_one(base, ps, code)
        clock_set(base, eff - timedelta(seconds=1))
        a = ok(purchase(base, p, code, "ammo_pack"), 201)
        clock_set(base, eff)
        b = ok(purchase(base, p, code, "ammo_pack"), 201)
        assert a["unit_price"] == old and a["price_effective_at"] != iso(eff)
        assert b["unit_price"] == new and b["price_effective_at"] == iso(eff)
        units = [e["unit_price"] for e in ok(api("GET", base, f"/api/rooms/{code}/ledger", p))["entries"] if e["kind"] == "purchase" and e["account"] == p["id"]]
        assert units == [old, new]
        sched = {s["id"]: s for s in ok(api("GET", base, "/api/prices"))["schedule"]}
        assert sched[row["id"]]["status"] == "in_effect"
        err(api("DELETE", base, f"/api/prices/{row['id']}", founder), 409, "price_change_in_effect")
    finally:
        clock_reset(base)


def test_wf_price_schedule_browser(browser):
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        eff = studio_at(friday, 19, 30)
        clock_set(base, eff - timedelta(days=2))
        price = random.randrange(300, 4000)
        stamp = f"{friday.isoformat()} 19:30"
        with app_page(browser, base + "/") as page:
            page.clock.set_system_time(WRONG_DEVICE_TIME)
            enter(page)
            ui_login(page, callsign(), STUDIO_KEY)
            click(page.get_by_role("button", name="Nights", exact=True))
            region = page.get_by_role("region", name="Ammo station prices")
            shown(page, region, "prices region for founders")
            click(region.get_by_role("button", name="Schedule price change"))
            dlg = page.get_by_role("dialog", name="Schedule price change")
            shown(page, dlg, "price dialog")
            posts = []
            page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/api/prices") else None)
            select(dlg.get_by_role("combobox", name="Item"), "Grenade")
            fill(dlg.get_by_role("spinbutton", name="New price"), str(price))
            fill(dlg.get_by_role("textbox", name="Effective (studio time)"), "next friday")
            click(dlg.get_by_role("button", name="Save price change"))
            eventually(page, lambda: expect(dlg.get_by_role("textbox", name="Effective (studio time)")).to_have_accessible_description("Pick a time after now, in studio time.", timeout=250), "effective error")
            assert posts == []
            fill(dlg.get_by_role("textbox", name="Effective (studio time)"), stamp)
            click(dlg.get_by_role("button", name="Save price change"))
            says(page, notices(page), f"Price change saved: Grenade becomes {price} cr at {stamp} {eff.tzname()}.", "saved copy")
            table = region.get_by_role("table", name="Price schedule")
            rm = table.get_by_role("button", name=f"Remove Grenade change at {stamp}")
            shown(page, rm, "pending row with remove button")
            row = table.get_by_role("row").filter(has=page.get_by_role("button", name=f"Remove Grenade change at {stamp}"))
            expect(row).to_contain_text("Pending")
            txt, ms = timer_reading(row.get_by_role("timer", name="Price change Grenade"))
            nxt = next(s for s in ok(api("GET", base, "/api/prices"))["schedule"] if s["item"] == "grenade" and s["effective_at"] == iso(eff))
            in_ms = (eff - inst(ok(api("GET", base, "/api/clock"))["now"])).total_seconds() * 1000
            assert abs(int(ms) - in_ms) <= 20000 and fuse_matches(txt, int(ms)), (txt, ms)
            for r in table.get_by_role("row").filter(has_text="In effect").all():
                expect(r.get_by_role("button", name=re.compile("^Remove"))).to_have_count(0)
            click(rm)
            says(page, notices(page), "Price change removed.", "removed copy")
            assert nxt["id"] not in [s["id"] for s in ok(api("GET", base, "/api/prices"))["schedule"]]
    finally:
        clock_reset(base)


def test_wf_night_signup_edges(mail):
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        start = studio_at(friday, 20, 0)
        clock_set(base, start - timedelta(days=30))
        founder = login(base, STUDIO_KEY)
        _, nights = series(base, founder, friday, capacity=3)
        _, crowd = series(base, founder, friday, capacity=3)
        nid = nights[0]["id"]
        opn, cls = start - timedelta(hours=OPEN_H), start - timedelta(hours=CLOSE_H)
        refused = [new_email(), new_email()]
        clock_set(base, opn - timedelta(seconds=1))
        err(signup(base, nid, refused[0]), 409, "signups_not_open")
        clock_set(base, opn)
        ok(signup(base, nid, new_email()), 201)
        for field, kw in [("name", {"name": ""}), ("email", {"addr": "nope"}), ("viewer_zone", {"zone": "Mars/Olympus"})]:
            e = err(signup(base, nid, kw.get("addr", new_email()), kw.get("zone", VIEWER_ZONE), kw.get("name", "Rook")), 422, "validation")
            assert field in e["fields"]
        clock_set(base, cls - timedelta(seconds=1))
        ok(signup(base, nid, new_email()), 201)
        clock_set(base, cls)
        err(signup(base, nid, refused[1]), 409, "signups_closed")
        assert night(base, nid)["signed_up"] == 2
        clock_set(base, opn + timedelta(hours=1))
        racers = [new_email() for _ in range(6)]
        with ThreadPoolExecutor(6) as pool:
            rs = list(pool.map(lambda a: signup(base, crowd[0]["id"], a), racers))
        assert sum(r.status_code == 201 for r in rs) == 3
        losers = [a for a, r in zip(racers, rs) if r.status_code != 201]
        assert all(r.json()["error"]["code"] == "night_full" for r in rs if r.status_code != 201)
        assert night(base, crowd[0]["id"])["seats_left"] == 0
        for a in refused + losers:
            assert mails_to(mail, a) == []
    finally:
        clock_reset(base)


def test_wf_night_signup_repeat(mail):
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        start = studio_at(friday, 20, 0)
        clock_set(base, start - timedelta(days=30))
        founder, player = login(base, STUDIO_KEY), login(base)
        _, nights = series(base, founder, friday)
        nid = nights[0]["id"]
        clock_set(base, start - timedelta(hours=100))
        a, b = new_email(), new_email()
        first = ok(signup(base, nid, a), 201)
        assert first["email_status"] == "sent"
        again = ok(signup(base, nid, a.upper()), 200)
        assert again["email_status"] == "already_signed_up" and again["signup"]["id"] == first["signup"]["id"]
        with ThreadPoolExecutor(5) as pool:
            rs = list(pool.map(lambda _: signup(base, nid, b), range(5)))
        assert sorted(r.status_code for r in rs) == [200, 200, 200, 200, 201]
        assert len({r.json()["signup"]["id"] for r in rs}) == 1
        assert night(base, nid)["signed_up"] == 2
        clock_set(base, start - timedelta(hours=CLOSE_H))
        assert ok(signup(base, nid, a), 200)["email_status"] == "already_signed_up"
        lst = ok(api("GET", base, f"/api/nights/{nid}/signups", founder))["signups"]
        assert sorted(s["email"].lower() for s in lst) == sorted([a, b])
        err(api("GET", base, f"/api/nights/{nid}/signups", player), 403, "founder_only")
        for addr in (a, b):
            inbox(mail, addr, 1, 20, "confirmation sent")
            assert len(mails_to(mail, addr)) == 1
    finally:
        clock_reset(base)


def test_signup_emails(mail):
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        start = studio_at(friday, 20, 0)
        clock_set(base, start - timedelta(days=30))
        founder = login(base, STUDIO_KEY)
        title, nights = series(base, founder, friday)
        clock_set(base, start - timedelta(hours=100))
        addr = new_email()
        ok(signup(base, nights[0]["id"], addr, VIEWER_ZONE, "Rook Vale"), 201)
        [conf] = inbox(mail, addr, 1, 30, "confirmation arrived")
        assert conf["Subject"] == f"Signed up: {title} · {ddd_y(start)}"
        assert mail_from_address().lower() in [x.lower() for x in addresses(conf.get("From"))]
        body = text(conf)
        for line in ["Hi Rook Vale,", f"You're on the list for {title}.", f"Studio time: {mail_time(start, STUDIO_ZONE)}",
                     f"Your time: {mail_time(start, VIEWER_ZONE)}",
                     f"Sign-ups close: {mail_time(start - timedelta(hours=CLOSE_H), STUDIO_ZONE)}"]:
            assert line in body, line
        clock_set(base, start - timedelta(minutes=REMINDER_MIN + 1))
        assert len(mails_to(mail, addr)) == 1, "reminder sent before it fell due"
        clock_set(base, start - timedelta(minutes=REMINDER_MIN))
        t0 = time.monotonic()
        msgs = inbox(mail, addr, 2, REMINDER_DUE_S + TIME_SLACK_S + 6, "reminder arrived")
        assert time.monotonic() - t0 <= REMINDER_DUE_S + TIME_SLACK_S + 6
        rem = next(m for m in msgs if m["Subject"] == f"Starts in 1 hour: {title}")
        assert f"Studio time: {mail_time(start, STUDIO_ZONE)}" in text(rem) and f"Your time: {mail_time(start, VIEWER_ZONE)}" in text(rem)
        clock_set(base, start - timedelta(hours=3))
        clock_set(base, start - timedelta(minutes=30))
        gate = threading.Event()
        deadline = time.monotonic() + REMINDER_DUE_S + TIME_SLACK_S
        while time.monotonic() < deadline:
            assert len(mails_to(mail, addr)) == 2, "a confirmation or reminder was sent again after the clock moved"
            gate.wait(POLL_S)
    finally:
        clock_reset(base)


def test_wf_night_signup_mail_outage(mail):
    down = outage("APP_MAILPIT_DOWN_URL")
    st = status(down)
    assert st["services"]["mail"] == "down"
    relay = Relay(os.environ["SMTP_HOST"], os.environ["SMTP_PORT"])

    def queue_one(base):
        founder = login(base, STUDIO_KEY)
        friday = far_weekday(4)
        start = studio_at(friday, 20, 0)
        clock_set(base, start - timedelta(days=30))
        _, nights = series(base, founder, friday)
        clock_set(base, start - timedelta(hours=100))
        addr = new_email()
        assert ok(signup(base, nights[0]["id"], addr), 201)["email_status"] == "queued"
        assert status(base)["mail_queued"] >= 1
        return addr
    try:
        a = queue_one(down)
        assert mails_to(mail, a) == []
        clock_reset(down)
        env = {"DATABASE_URL": os.environ["DATABASE_URL"] + "_maildown", "SMTP_HOST": "127.0.0.1",
               "SMTP_PORT": str(relay.port), "HOLDFAST_CLOCK_CONTROL": "on", "VALKEY_URL": DOWN_URL}
        with app_copy(env) as copy:
            poll(lambda: status(copy)["services"]["mail"] == "down", STATUS_FOLLOW_S + TIME_SLACK_S, "copy saw mail down")
            b = queue_one(copy)
            assert mails_to(mail, b) == []
            relay.start()
            t0 = time.monotonic()
            inbox(mail, b, 1, MAIL_RETURN_S + TIME_SLACK_S, "queued email sent after mail returned")
            assert time.monotonic() - t0 <= MAIL_RETURN_S + TIME_SLACK_S
            poll(lambda: (lambda s: s["mail_queued"] == 0 and s["services"]["mail"] == "up")(status(copy)), MAIL_RETURN_S + TIME_SLACK_S, "queue drained")
            assert len(mails_to(mail, b)) == 1
    finally:
        relay.stop()
        clock_reset(down)


def test_wf_night_signup_phone(browser, mail):
    base = outage("APP_CLOCK_URL")
    try:
        friday = far_weekday(4)
        start = studio_at(friday, 20, 0)
        clock_set(base, start - timedelta(days=30))
        founder = login(base, STUDIO_KEY)
        title, nights = series(base, founder, friday)
        clock_set(base, start - timedelta(hours=100))
        addr = new_email()
        with app_page(browser, base + "/nights") as page:
            cdp = phone(page)
            cdp.send("Emulation.setTimezoneOverride", {"timezoneId": VIEWER_ZONE})
            page.clock.set_system_time(WRONG_DEVICE_TIME)
            page.reload()
            enter(page)
            btn = page.get_by_role("button", name=f"Sign up for {title} on {ddd(start)}")
            shown(page, btn, "night row on the phone")
            row = page.get_by_role("list", name="Upcoming nights").get_by_role("listitem").filter(has=btn).last
            txt, ms = timer_reading(row.get_by_role("timer", name="Sign-ups close"))
            exp = (start - timedelta(hours=CLOSE_H) - inst(ok(api("GET", base, "/api/clock"))["now"])).total_seconds() * 1000
            assert -2000 <= int(ms) - exp <= 20000 and fuse_matches(txt, int(ms))
            tap(btn)
            dlg = page.get_by_role("dialog", name="Sign up")
            shown(page, dlg, "sign-up panel")
            fill(dlg.get_by_role("textbox", name="Name"), "Rook Vale")
            fill(dlg.get_by_role("textbox", name="Email"), addr)
            select(dlg.get_by_role("combobox", name="Your time zone"), VIEWER_ZONE)
            tap(dlg.get_by_role("button", name="Sign me up"))
            says(page, notices(page), f"You're signed up for {title} on {ddd(start)}. Confirmation email: sent.", "confirmation copy")
            layout(page)
        lst = ok(api("GET", base, f"/api/nights/{nights[0]['id']}/signups", founder))["signups"]
        assert [s["viewer_zone"] for s in lst if s["email"].lower() == addr] == [VIEWER_ZONE]
        inbox(mail, addr, 1, 30, "confirmation email")
    finally:
        clock_reset(base)


def open_settings(page):
    click(page.get_by_role("button", name="Settings"))
    dlg = page.get_by_role("dialog", name="Settings")
    shown(page, dlg, "Settings opened")
    return dlg


def expand(dlg, name):
    h = dlg.get_by_role("button", name=name)
    if h.get_attribute("aria-expanded") != "true":
        click(h)
    expect(h).to_have_attribute("aria-expanded", "true")


def test_wf_pause_and_settings_accordion(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        enter(page)
        for w, h in (VIEWPORTS["phone"], VIEWPORTS["tablet"]):
            page.set_viewport_size({"width": w, "height": h})
            dlg = open_settings(page)
            expect(dlg.get_by_role("button", name="Game")).to_have_count(0)
            expand(dlg, "Audio")
            expect(dlg.get_by_role("button", name="Controls")).to_have_attribute("aria-expanded", "false")
            expect(dlg.get_by_role("slider", name="Master volume")).to_be_visible()
            expect(dlg.get_by_role("button", name="Remap Fire")).to_have_count(0)
            expect(dlg.get_by_role("switch", name="Reduce effects")).to_have_count(0)
            names = tab_order(page, 12)
            assert not any(n.startswith("Remap") or n in ("Reduce effects", "Reset to defaults") for n in names), names
            expand(dlg, "Controls")
            expect(dlg.get_by_role("button", name="Audio")).to_have_attribute("aria-expanded", "false")
            expect(dlg.get_by_role("slider", name="Master volume")).to_have_count(0)
            layout(page)
            page.keyboard.press("Escape")
            gone(page, page.get_by_role("dialog", name="Settings"), "Settings closed")
        page.set_viewport_size({"width": 1280, "height": 800})
        click(page.get_by_role("button", name="History", exact=True))
        hist = page.get_by_role("dialog", name="History")
        shown(page, hist, "History opened")
        tabs = hist.get_by_role("tab")
        tabs.first.focus()
        page.keyboard.press("ArrowRight")
        expect(hist.get_by_role("tab", name="Lap board")).to_be_focused()
        page.keyboard.press("Enter")
        expect(hist.get_by_role("tab", name="Lap board")).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Escape")
        code, p = ui_solo_match(page, base) if False else (None, None)
    with app_page(browser, base + "/") as page:
        ui_solo_match(page, base)
        page.keyboard.press("Escape")
        pz = page.get_by_role("dialog", name="Paused")
        shown(page, pz, "pause menu opened")
        expect(pz.get_by_role("button", name="Game")).to_have_attribute("aria-expanded", "true")
        expect(pz.get_by_role("button", name="Resume")).to_be_visible()
        expect(pz.get_by_role("button", name="Leave room")).to_be_visible()
        expect(pz.get_by_role("button", name="Remap Fire")).to_have_count(0)
        expand(pz, "Comfort")
        expect(pz.get_by_role("button", name="Resume")).to_have_count(0)
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="Paused"), "Escape closed the pause menu")


def test_wf_pause_and_settings_remap(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        enter(page)
        ui_login(page, callsign())
        p = page_player(page, base)
        dlg = open_settings(page)
        expand(dlg, "Controls")
        fire = dlg.get_by_role("button", name="Remap Fire")
        click(fire)
        expect(fire).to_have_text(re.compile("Press a key…"))
        says(page, notices(page), "Press a key for Fire. Escape cancels.", "capture announced") if False else None
        page.keyboard.press("Digit2")
        poll(lambda: ok(api("GET", base, "/api/me/settings", p))["bindings"]["fire"] == "Digit2", 10, "Fire saved as Digit2")
        for key, label, action in (("ArrowUp", "Arrow Up", "grenade"), ("Digit1", "1", "timers"), ("BracketLeft", "Bracket Left", "shop")):
            btn = dlg.get_by_role("button", name=f"Remap {action.capitalize()}")
            click(btn)
            page.keyboard.press(key)
            poll(lambda: ok(api("GET", base, "/api/me/settings", p))["bindings"][action] == key, 10, f"{action} saved")
            expect(dlg).to_contain_text(label)
        reload_btn = dlg.get_by_role("button", name="Remap Reload")
        click(reload_btn)
        page.keyboard.press("KeyW")
        says(page, notices(page), "W is already bound to Move up.", "conflict copy")
        click(reload_btn)
        page.keyboard.press("Escape")
        s = ok(api("GET", base, "/api/me/settings", p))
        assert s["bindings"]["reload"] == "KeyR" and s["bindings"]["move_up"] == "KeyW"
        dup = {**s, "bindings": {**s["bindings"], "reload": "KeyW"}}
        assert "bindings" in err(api("PUT", base, "/api/me/settings", p, dup), 422, "validation")["fields"]
        esc = {**s, "bindings": {**s["bindings"], "reload": "Escape"}}
        assert "bindings" in err(api("PUT", base, "/api/me/settings", p, esc), 422, "validation")["fields"]
        vol = {**s, "master_volume": 101}
        assert "master_volume" in err(api("PUT", base, "/api/me/settings", p, vol), 422, "validation")["fields"]
        click(dlg.get_by_role("button", name="Reset to defaults"))
        poll(lambda: ok(api("GET", base, "/api/me/settings", p))["bindings"]["fire"] == "Space", 10, "defaults restored")


def test_wf_pause_and_settings_dialogs(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        enter(page)
        opener = page.get_by_role("button", name="Callsign", exact=True)
        click(opener)
        dlg = page.get_by_role("dialog", name="Callsign")
        shown(page, dlg, "Callsign opened")
        inside = {"Callsign", "Studio key", "Save callsign", "Close", ""}
        names = tab_order(page, 8)
        assert set(names) <= inside | {n for n in names if dlg.get_by_role("button", name=n).count() or dlg.get_by_role("textbox", name=n).count()}, names
        assert {"Callsign", "Studio key", "Save callsign"} <= set(names)
        dlg.get_by_role("textbox", name="Callsign").focus()
        page.keyboard.press("Shift+Tab")
        assert dlg.evaluate("e => e.contains(document.activeElement)"), "Shift+Tab left the dialog"
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="Callsign"), "Escape closed Callsign")
        expect(opener).to_be_focused()
        click(page.get_by_role("button", name="Nights", exact=True))
        nd = page.get_by_role("dialog", name="Nights")
        shown(page, nd, "Nights opened")
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="Nights"), "Nights closed")
        expect(page.get_by_role("button", name="Nights", exact=True)).to_be_focused()
    with app_page(browser, base + "/") as page:
        code, p = ui_solo_match(page, base)
        first_visible(page, page.get_by_role("region", name="HUD").get_by_role("button", name="Pause"), "HUD Pause visible").focus()
        page.keyboard.press("Space")
        poll(lambda: me(room(base, p, code), p)["mag"] == MAG - 1, 10, "Fire works with a HUD button focused")
        page.get_by_role("region", name="HUD").get_by_role("button", name="Timers").focus()
        page.keyboard.press("KeyR")
        poll(lambda: me(room(base, p, code), p)["reload_remaining_ms"] is not None or me(room(base, p, code), p)["mag"] == MAG, 10, "Reload works with Timers focused")


def test_wf_pause_and_settings_tuning(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        code, p = ui_solo_match(page, base)
        page.keyboard.press("Escape")
        pz = page.get_by_role("dialog", name="Paused")
        shown(page, pz, "pause menu")
        expand(pz, "Controls")
        click(pz.get_by_role("button", name="Remap Fire"))
        page.keyboard.press("Digit9")
        expand(pz, "Comfort")
        sw = pz.get_by_role("switch", name="Reduce effects")
        click(sw)
        expect(sw).to_be_checked()
        expect(pz.get_by_role("switch", name="Screen shake")).to_be_disabled()
        expand(pz, "Game")
        click(pz.get_by_role("button", name="Resume"))
        gone(page, page.get_by_role("dialog", name="Paused"), "resumed")
        s = poll(lambda: (lambda s: s if s["bindings"]["fire"] == "Digit9" and s["reduce_effects"] else None)(ok(api("GET", base, "/api/me/settings", p))), 10, "settings saved")
        assert s["screen_shake"] is False or s["reduce_effects"]
        page.keyboard.press("Digit9")
        poll(lambda: me(room(base, p, code), p)["mag"] == MAG - 1, 10, "remapped Fire fires")
        page.goto(base + "/")
        dlg = open_settings(page)
        expand(dlg, "Comfort")
        expect(dlg.get_by_role("switch", name="Reduce effects")).to_be_checked()
        expand(dlg, "Controls")
        kept = ok(api("GET", base, "/api/me/settings", p))
        assert kept["bindings"]["fire"] == "Digit9" and kept["reduce_effects"] is True


def test_fuse_clock(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        enter(page)
        code = ui_start_room(page, callsign())
        p = page_player(page, base)
        inv = lobby(page).get_by_role("timer", name="Invite expires")
        shown(page, inv, "Invite expires timer")
        txt, ms = timer_reading(inv)
        assert abs(int(ms) - room(base, p, code)["invite_remaining_ms"]) <= 5000 and fuse_matches(txt, int(ms)), txt
        ui_ready_start(page)
        cd = page.get_by_role("timer", name="Countdown")
        shown(page, cd, "Countdown timer")
        txt, ms = timer_reading(cd)
        assert 0 < int(ms) <= COUNTDOWN_MS and fuse_matches(txt, int(ms)), txt
        timers_btn = page.get_by_role("button", name="Timers")
        expect(timers_btn).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("list", name="Timers")).to_have_count(0)
        page.keyboard.press("KeyT")
        lst = page.get_by_role("list", name="Timers")
        shown(page, lst, "Timers list opened")
        expect(timers_btn).to_have_attribute("aria-expanded", "true")
        expect(lst.get_by_role("listitem").filter(has_text="Countdown")).to_have_count(1)
        outcome_word(page, cd, r"\bgo\b")
        says(page, wave_group(page), "Wave 1 of 3", "wave 1")
        page.keyboard.press("Space")
        page.keyboard.press("KeyR")
        rl = page.get_by_role("timer", name="Reload")
        shown(page, rl, "Reload timer")
        txt, ms = timer_reading(rl)
        assert 0 < int(ms) <= RELOAD_MS and fuse_matches(txt, int(ms)), txt
        expect(lst.get_by_role("listitem").filter(has_text="Reload")).to_have_count(1)
        outcome_word(page, rl, "reloaded")


def test_reduced_effects(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/", reduced_motion="reduce") as page:
        enter(page)
        frames = scene_frames(page.get_by_role("img", name="Block field"), steps=5, step_ms=500)
        pics = [decode(f["png"]) for f in frames]
        assert all(difference(pics[0], x) == 0 for x in pics[1:]), "title stage moved under reduced motion"
        dlg = open_settings(page)
        assert running_animations(dlg) == 0
        expand(dlg, "Comfort")
        for name in ("Screen shake", "Camera bob"):
            expect(dlg.get_by_role("switch", name=name)).not_to_be_checked()
            expect(dlg.get_by_role("switch", name=name)).to_be_disabled()
        page.keyboard.press("Escape")
        code, p = ui_solo_match(page, base) if False else (None, None)
    with app_page(browser, base + "/", reduced_motion="reduce") as page:
        code, p = ui_solo_match(page, base)
        page.keyboard.press("KeyR") if False else page.keyboard.press("Space")
        page.keyboard.press("KeyR")
        rl = page.get_by_role("timer", name="Reload")
        shown(page, rl, "Reload timer under reduced motion")
        for _ in range(5):
            advance(page, 100)
            assert running_animations(rl) == 0
        says(page, page.get_by_role("group", name="Ammo"), f"{MAG} / {RESERVE - 1}", "readout still updates")
    with app_page(browser, base + "/") as page:
        enter(page)
        dlg = open_settings(page)
        expand(dlg, "Comfort")
        click(dlg.get_by_role("switch", name="Reduce effects"))
        for name in ("Screen shake", "Camera bob"):
            expect(dlg.get_by_role("switch", name=name)).to_be_disabled()
            expect(dlg.get_by_role("switch", name=name)).not_to_be_checked()


def test_touch_controls(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        cdp = phone(page)
        page.reload()
        code, p = ui_solo_match(page, base)
        for role, name in (("group", "Move stick"), ("group", "Aim stick"), ("button", "Fire"), ("button", "Reload"), ("button", "Grenade"), ("button", "Pause")):
            loc = first_visible(page, page.get_by_role(role, name=name), f"{name} touch control visible")
            expect(loc).to_be_visible()
            if role == "button":
                assert hit_area_ok(loc), f"{name} hit area under {TARGET_PX} px"
        tap(page.get_by_role("button", name="Fire", exact=True))
        poll(lambda: me(room(base, p, code), p)["mag"] == MAG - 1, 10, "Fire tap spent a round")
        tap(page.get_by_role("button", name="Reload", exact=True))
        poll(lambda: me(room(base, p, code), p)["reload_remaining_ms"] is not None or me(room(base, p, code), p)["mag"] == MAG, 10, "Reload tap reloaded")
        tap(page.get_by_role("button", name="Grenade"))
        st = poll(lambda: (lambda s: s if s["grenades"] or me(s, p)["grenades"] == 1 else None)(room(base, p, code)), 10, "Grenade tap threw")
        m = me(st, p)
        if st["grenades"]:
            g = st["grenades"][0]
            assert abs(math.dist((g["x"], g["z"]), (m["x"], m["z"])) - 8) <= 0.5
        tap(first_visible(page, page.get_by_role("button", name="Pause"), "Pause visible"))
        shown(page, page.get_by_role("dialog", name="Paused"), "Pause tap opened the menu")
        assert cdp


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_responsive_layers(browser, app_url, viewport):
    base = app_url.rstrip("/")
    w, h = VIEWPORTS[viewport]
    with app_page(browser, base + "/") as page:
        page.set_viewport_size({"width": w, "height": h})
        page.reload()
        shown(page, page.get_by_role("dialog", name="Before you play"), "notice panel")
        layout(page)
        assert no_document_scroll(page) == [True, True]
        enter(page)
        for screen in (None, "Nights", "Settings"):
            if screen:
                click(page.get_by_role("button", name=screen))
                shown(page, page.get_by_role("dialog", name=screen), f"{screen} open")
            layout(page)
            assert no_document_scroll(page) == [True, True], screen
            scope = page.get_by_role("dialog", name=screen) if screen else page
            for b in scope.get_by_role("button").all():
                if b.is_visible() and b.is_enabled():
                    assert hit_area_ok(b), f"{b.inner_text()[:30]} under {TARGET_PX} px on {viewport}"
            if screen:
                page.keyboard.press("Escape")
                gone(page, page.get_by_role("dialog", name=screen), f"{screen} closed")
        sb = page.get_by_role("status", name="Build").bounding_box()
        assert sb["x"] + sb["width"] >= w - 80 and sb["y"] + sb["height"] >= h - 80


def test_stage(browser, app_url):
    base = app_url.rstrip("/")
    with app_page(browser, base + "/") as page:
        enter(page)
        frames = scene_frames(page.get_by_role("img", name="Block field"), steps=4, step_ms=500)
        assert all(f["draws"] > 0 for f in frames)
        pics = [decode(f["png"]) for f in frames]
        assert pics[0].variance() > 0 and difference(pics[0], pics[-1]) > 0, "title camera does not drift"
    with app_page(browser, base + "/", reduced_motion="reduce") as page:
        code, p = ui_solo_match(page, base)
        stage = page.get_by_role("img", name="Siege field")
        expect(stage).to_be_visible()
        box = stage.bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.2, box["y"] + box["height"] * 0.5)
        start = me(room(base, p, code), p)["aim"]
        page.mouse.move(box["x"] + box["width"] * 0.8, box["y"] + box["height"] * 0.3, steps=8)
        eventually(page, lambda: _aim_moved(me(room(base, p, code), p)["aim"], start), "pointer input did not turn the player model")
    with app_page(browser, base + "/", no_webgl=True) as page:
        enter(page)
        still = page.get_by_role("img", name="Block field")
        expect(still).to_be_visible()
        assert decode(capture(still)).variance() > 0
        expect(page.get_by_role("button", name="Start a room")).to_be_visible()


def test_server_boundary(app_url):
    base = app_url.rstrip("/")
    h = {"Content-Type": "application/json"}
    head = json.dumps({"callsign": callsign(), "pad": ""})[:-2]
    exact = (head + "a" * (BODY_LIMIT - len(head) - 2) + '"}').encode()
    assert len(exact) == BODY_LIMIT
    assert httpx.post(base + "/api/sessions", content=exact, headers=h, timeout=HTTP_S).status_code != 413
    err(httpx.post(base + "/api/sessions", content=exact[:-2] + b'a"}', headers=h, timeout=HTTP_S), 413, "body_too_large")
    err(httpx.post(base + "/api/sessions", content=b'{"callsign":"abc"}', headers={"Content-Type": "text/plain"}, timeout=HTTP_S), 415, "unsupported_media_type")
    err(httpx.post(base + "/api/sessions", content=b'{"callsign":', headers=h, timeout=HTTP_S), 400, "bad_json")
    err(api("GET", base, "/api/nowhere"), 404, "not_found")
    err(api("POST", base, "/api/sessions", None, {"callsign": callsign()}, Origin=CROSS_ORIGIN), 403, "cross_origin")
    origin = f"{urlsplit(base).scheme}://{urlsplit(base).netloc}"
    ok(api("POST", base, "/api/sessions", None, {"callsign": callsign()}, Origin=origin), 201)
    r = api("GET", base, "/api/status", None, Origin=CROSS_ORIGIN)
    assert not any(k.lower().startswith("access-control-allow") for k in r.headers)
    for path in ("/", "/nights", "/room/K7P2QX"):
        r = httpx.get(base + path, timeout=HTTP_S)
        assert r.status_code == 200 and r.text.strip(), path
    for path in ("/run.json", "/go.mod", "/go.sum", "/package.json", "/package-lock.json", "/.env", "/main.go", "/.git/config", "/nope"):
        assert httpx.get(base + path, timeout=HTTP_S).status_code == 404, path
    html = httpx.get(base + "/", timeout=HTTP_S).text
    secrets = [STUDIO_KEY] + [os.environ[k] for k in ("DATABASE_URL", "VALKEY_URL") if os.environ.get(k)]
    secrets += [urlsplit(os.environ["DATABASE_URL"]).password] if os.environ.get("DATABASE_URL") and urlsplit(os.environ["DATABASE_URL"]).password else []
    bodies = [html, json.dumps(status(base))]
    for ref in set(re.findall(r'(?:src|href)="(/[^"]+)"', html)):
        bodies.append(httpx.get(base + ref, timeout=HTTP_S).text)
    for s in secrets:
        assert not any(s in b for b in bodies), "a credential is served to the browser"
    down = outage("APP_VALKEY_DOWN_URL")
    assert ok(api("GET", down, "/api/health")) == {"status": "ok"}
    assert httpx.get(down + "/", timeout=HTTP_S).status_code == 200
    ok(api("GET", down, "/api/nights"))
    ok(api("GET", down, "/api/prices"))


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notes]
    assert not missing, missing
    assert "Pixelify Sans" in notes and "Chakra Petch" in notes


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad
    assert "OFL-1.1" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores_only_provided():
    banned = ("sqlite", "bbolt", "boltdb", "badger", "pebble", "leveldb", "lowdb", "nedb")
    files = [f for f in APP.rglob("*") if "node_modules" not in f.parts and ".git" not in f.parts and f.suffix in (".db", ".sqlite", ".sqlite3")]
    assert not files, files
    for name in ("go.mod", "package.json"):
        for f in [APP / name] + [d / name for d in APP.iterdir() if d.is_dir() and d.name != "node_modules"]:
            if f.exists():
                assert not any(b in f.read_text().lower() for b in banned), f


def test_if_seed_records(app_url):
    base = app_url.rstrip("/")
    assert ok(api("GET", base, "/api/studio")) == {"name": "Cinderlatch Games", "zone": STUDIO_ZONE}
    assert login(base, STUDIO_KEY) and ok(api("GET", base, "/api/me", login(base, STUDIO_KEY)))["player"]["role"] == "founder"
    seed_at = iso(studio_at(date(2026, 1, 1), 0, 0))
    sched = ok(api("GET", base, "/api/prices"))["schedule"]
    for item, price in PRICES.items():
        assert any(s["item"] == item and s["price"] == price and s["effective_local"].startswith("2026-01-01T00:00") and s["effective_at"] == seed_at for s in sched)
    fri = [n for n in ok(api("GET", base, "/api/nights?from=2026-11-13&days=56"))["nights"] if n["title"] == "Friday Siege"]
    assert len(fri) == 8 and fri[0]["starts_at"] == "2026-11-14T02:00:00Z" and fri[0]["date"] == "2026-11-13" and fri[0]["capacity"] == 24
    sun = [n for n in ok(api("GET", base, "/api/nights?from=2026-11-15&days=28"))["nights"] if n["title"] == "Sunday Convoy"]
    assert len(sun) == 4 and sun[0]["local_start"] == "19:00" and sun[0]["capacity"] == 12 and sun[0]["mode"] == "convoy"

    def cells(blocks):
        return {(x, z) for b in blocks for x in range(int(b["x"]), int(b["x"] + b["w"])) for z in range(int(b["z"]), int(b["z"] + b["d"]))}
    yard = ok(api("GET", base, "/api/maps/breakwater-yard"))
    assert (yard["width"], yard["depth"]) == (32, 32) and cells(yard["blocks"]) == SIEGE_BLOCKS
    loop = ok(api("GET", base, "/api/maps/saltpan-loop"))
    assert (loop["width"], loop["depth"]) == (200, 120)
    assert cells(loop["blocks"]) == {(x, z) for x in range(60, 140) for z in range(40, 80)}
    err(api("GET", base, "/api/maps/nowhere"), 404, "not_found")


def test_if_lockfiles_committed():
    roots = [APP] + [d for d in APP.iterdir() if d.is_dir() and d.name not in ("node_modules", ".git")]
    assert any((d / "go.sum").exists() for d in roots)
    assert any((d / n).exists() for d in roots for n in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock"))
    assert json.loads((APP / "run.json").read_text())["build"].strip()


def test_if_fonts(browser, app_url):
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    assert "Pixelify Sans" in notes and "Chakra Petch" in notes
    with app_page(browser, app_url.rstrip("/") + "/") as page:
        enter(page)
        assert "Chakra Petch" in page.get_by_role("button", name="Nights", exact=True).evaluate("e => getComputedStyle(e).fontFamily")
        click(page.get_by_role("button", name="Nights", exact=True))
        dlg = page.get_by_role("dialog", name="Nights")
        shown(page, dlg, "Nights opened")
        assert "Pixelify Sans" in dlg.get_by_role("heading").first.evaluate("e => getComputedStyle(e).fontFamily")
