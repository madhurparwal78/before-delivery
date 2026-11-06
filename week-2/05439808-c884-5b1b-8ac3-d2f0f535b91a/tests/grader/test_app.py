import functools
import json
import math
import os
import re
import struct
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import *

HTTP_TIMEOUT = 30
POLL_S = 0.25
POLL_MS = 250
MAIL_WAIT_S = 45
MAIL_SETTLE_S = 3
THROTTLE_WAIT_S = 75
UI_S = 20
UI_MS = 20000
JOB_WAIT_S = 40
LIVE_S = 3
OUTAGE_MAIL_S = 30 + 15
ID_MAX = 9007199254740991
BODY_LIMIT = 65536
CONFIRM_SUBJECT = "Confirm your Saltreach email"
RESET_SUBJECT = "Reset your Saltreach password"
OPS_EMAIL, OPS_PW = "ops@lowtide.test", "Tideline-Operator-27"
STARTER = {"brine": 1500, "peat": 1500, "copper": 100}
BASE_CAP = {"brine": 2000, "peat": 2000, "copper": 200}
STARTER_ARMY = 10
HOUSING_L1 = 20
SHORT_LINK_S = 20
SHORT_FINALIZE_S = 20
SHORT_SHIELD_S = 30
SHORT_DIVISOR = 10
SIGNIN_LIMIT, MAIL_LIMIT, CHAT_LIMIT = 5, 3, 5
LOOT_PCT = 20
RAID_TICKS = 1800
SPRING_TICK = 900
TOWER_RANGE = 7000
FNV_OFFSET, FNV_PRIME = 2166136261, 16777619
DAILY_REOPEN_MS = 20 * 3600 * 1000
WEEKLY_REOPEN_MS = 144 * 3600 * 1000
DAY_MS = 86400 * 1000
VAULT_COST = 1000
CLAN_MAX = 10
DONOR_DAY_CAP = 8
BONUS_MUDFLAT = {"brine": 1000, "peat": 1000, "copper": 0}
CHEST = {1: {"brine": 300, "peat": 300, "copper": 0}, 2: {"brine": 400, "peat": 400, "copper": 0}}
STAR_CAP = 5
DIAL_SLOW_TOLERANCE = 2
FLING_SETTLE_MS = 1500
ASSETS = ("brine", "peat", "copper")
FOOT = {"brine_pan": (3, 3), "peat_cutter": (2, 3), "copper_sluice": (2, 3)}
UNIT = {"saltjack": dict(hp=120, dmg=12, every=5, rng=800, speed=15),
        "peat_slinger": dict(hp=50, dmg=9, every=6, rng=3500, speed=18)}
TOWER_DMG = {1: 40, 2: 55, 3: 70}
LEAK = re.compile(r"(?i)traceback|\bat [\w.$<>]+ \(|node_modules|/app/|/src/|\.ts:\d|\.js:\d|\bselect\b.*\bfrom\b|insert into|express|fastify|prisma|knex|sequelize|typeorm|drizzle|DATABASE_URL|SMTP_")
ME_KEYS = {"id", "email", "displayName", "timeZone", "verified", "role", "villageId", "trophies", "league", "clanId"}


def url(name):
    return os.environ[name].rstrip("/")


PACE = threading.Event()


def poll(fn, seconds, what=""):
    end = time.monotonic() + seconds
    while True:
        v = fn()
        if v:
            return v
        assert time.monotonic() < end, f"timed out: {what}"
        PACE.wait(POLL_S)


def together(calls):
    gate = threading.Barrier(len(calls))

    def run(f):
        gate.wait()
        return f()
    with ThreadPoolExecutor(len(calls)) as ex:
        return list(ex.map(run, calls))


def err(r, status, code=None):
    assert r.status_code == status, f"{r.status_code} {r.text[:400]}"
    if code is None:
        return {}
    b = r.json()
    assert b["error"] == code and isinstance(b["message"], str) and b["message"], b
    allowed = {"validation_failed": {"errors"}, "already_claimed": {"nextClaimAt"},
               "donation_cap_reached": {"nextDonationAt"}}.get(code, set())
    assert set(b) - {"error", "message"} <= allowed, b
    assert not LEAK.search(r.text), r.text
    return b


def field(r, key, msg):
    b = err(r, 422, "validation_failed")
    assert b["errors"].get(key) == msg, b


def session_cookie(r):
    ck = r.headers.get("set-cookie", "")
    assert "saltreach_session" in r.cookies, ck
    for flag in ("HttpOnly", "SameSite=Lax", "Path=/"):
        assert flag.lower() in ck.lower(), (flag, ck)


def rule(k, amount, cap):
    return f"{k.capitalize()} {amount:,} / {cap:,}"


def progress(given, count, unit="Saltjack"):
    return f"{given} of {count} {unit}"


def upgrade_button(n):
    return f"Upgrade to level {n}"


def cancel_training(count, unit="Saltjack"):
    return f"Cancel training of {count} {unit}"


def job_done(building, n):
    return f"{building} reached level {n}."


def status_line(label, state):
    return f"{label}: {state}"


class Api:
    def __init__(self, base):
        self.base = base
        self.c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        r = self.c.get("/api/session")
        assert r.status_code == 200, r.text
        self.csrf = r.json()["csrfToken"]

    def get(self, path, **params):
        return self.c.get(path, params=params or None)

    def call(self, method, path, body=None, key=None, **headers):
        h = {"X-CSRF-Token": self.csrf, **headers}
        if key:
            h["Idempotency-Key"] = key
        return self.c.request(method, path, json=body, headers=h)

    def post(self, path, body=None, key=None, **h):
        return self.call("POST", path, {} if body is None else body, key, **h)

    def patch(self, path, body):
        return self.call("PATCH", path, body)

    def delete(self, path):
        return self.call("DELETE", path)

    def signin(self, email, pw):
        box = {}

        def go():
            box["r"] = self.post("/api/auth/signin", {"email": email, "password": pw})
            return box["r"].status_code != 429
        poll(go, THROTTLE_WAIT_S, "sign-in throttle")
        if box["r"].status_code == 200:
            self.csrf = box["r"].json()["csrfToken"]
        return box["r"]


class U:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def fresh(prefix="isl"):
    parts = [str(p) for p in unique(prefix)]
    email = next((p for p in parts if "@" in p), f"{parts[0]}@lowtide.test")
    return email.lower(), "I" + uuid.uuid4().hex[:12]


def inbox(mail, addr, subject, n=1, seconds=MAIL_WAIT_S):
    end = time.monotonic() + seconds
    while True:
        msgs = [m for m in mail.messages(settle=0.2)
                if addr.lower() in [a.lower() for a in addresses(m["To"])] and m["Subject"] == subject]
        if len(msgs) >= n or time.monotonic() > end:
            return msgs
        PACE.wait(POLL_S)


def exactly(mail, addr, subject, n):
    assert len(inbox(mail, addr, subject, n)) >= n, f"{n} x {subject!r} to {addr}"
    got = inbox(mail, addr, subject, n + 1, MAIL_SETTLE_S)
    assert len(got) == n, f"expected exactly {n} x {subject!r} to {addr}, got {len(got)}"
    return got


def link_tokens(msgs, path):
    out = []
    for m in msgs:
        hit = re.search(re.escape(path) + r"\?token=([^\s\"'<>&]+)", text(m))
        assert hit, text(m)
        out.append(hit.group(1))
    return out


def new_user(base, mail, verify=True, tz="UTC"):
    email, name = fresh()
    pw = "Tide-Pass-" + uuid.uuid4().hex[:8]
    a = Api(base)
    r = a.post("/api/auth/signup", {"email": email, "password": pw, "displayName": name, "timeZone": tz})
    assert r.status_code == 202, r.text
    if verify:
        tok = link_tokens(inbox(mail, email, CONFIRM_SUBJECT), "/verify")[0]
        assert a.post("/api/auth/verify", {"token": tok}).status_code == 200
    assert a.signin(email, pw).status_code == 200
    me = a.get("/api/me").json()
    return U(api=a, email=email, pw=pw, name=name, id=me["id"], vid=me["villageId"], base=base)


def users(base, mail, n, **kw):
    with ThreadPoolExecutor(min(n, 6)) as ex:
        return list(ex.map(lambda _: new_user(base, mail, **kw), range(n)))


@functools.lru_cache(maxsize=None)
def ops(base):
    a = Api(base)
    assert a.signin(OPS_EMAIL, OPS_PW).status_code == 200
    return a


def vil(u):
    r = u.api.get("/api/village")
    assert r.status_code == 200, r.text
    return r.json()


def amounts(v):
    return {k: v["resources"][k]["amount"] for k in ASSETS}


def bld(v, kind):
    return next(b for b in v["buildings"] if b["type"] == kind)


def ms(s):
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)


def ledger(u):
    out, before = [], None
    while True:
        q = {"limit": 100} if before is None else {"limit": 100, "before": before}
        es = u.api.get("/api/village/ledger", **q).json()["entries"]
        out += es
        if len(es) < 100:
            return out
        before = es[-1]["id"]


def builders_ok(v):
    saltmark = sum(b["level"] for b in v["buildings"])
    running = sum(1 for b in v["buildings"] if b["upgrade"])
    total = min(5, 2 + saltmark // 8)
    assert v["saltmark"] == saltmark and v["builders"] == {"total": total, "free": total - running}, v


def local_date(m, zone):
    return datetime.fromtimestamp(m / 1000, timezone.utc).astimezone(ZoneInfo(zone)).date()


def day_start(zone, d):
    lo = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000) - 2 * DAY_MS
    hi = lo + 4 * DAY_MS
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if local_date(mid, zone) >= d:
            hi = mid
        else:
            lo = mid
    return hi


def periods(zone, now):
    d = local_date(now, zone)
    monday = d - timedelta(days=d.weekday())
    return ((day_start(zone, d), day_start(zone, d + timedelta(days=1))),
            (day_start(zone, monday), day_start(zone, monday + timedelta(days=7))))


def hhmm(m, zone):
    return f"{datetime.fromtimestamp(m / 1000, timezone.utc).astimezone(ZoneInfo(zone)):%H:%M}"


def ldt(m, zone):
    d = datetime.fromtimestamp(m / 1000, timezone.utc).astimezone(ZoneInfo(zone))
    return re.escape(f"{d:%a} ") + f"0?{d.day}" + re.escape(f" {d:%b}, {d:%H:%M}")


def rect(b):
    w, d = FOOT.get(b["type"], (3, 3))
    if b["rotation"] in (90, 270):
        w, d = d, w
    return b["x"] * 1000, b["y"] * 1000, (b["x"] + w) * 1000, (b["y"] + d) * 1000


def tdiv(a, b):
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b > 0) else -q


def simulate(layout, deploys, seed, lootable):
    bs = [dict(hp=b["hp"], r=rect(b), tower=b["type"] == "kiln_tower", lvl=b["level"], cd=0) for b in layout]
    towers = [b for b in bs if b["tower"]]
    units, marks, frames, st = [], set(), [], [seed & 0xFFFFFFFF]

    def hit(base):
        s = st[0]
        s ^= (s << 13) & 0xFFFFFFFF
        s ^= s >> 17
        s ^= (s << 5) & 0xFFFFFFFF
        st[0] = s
        return base * (90 + s % 21) // 100

    def frame(tick):
        dest = 100 * sum(1 for b in bs if b["hp"] == 0) // len(bs)
        if dest >= 40:
            marks.add("ebb")
        if towers and all(b["hp"] == 0 for b in towers):
            marks.add("flood")
        if dest >= 80 and tick <= SPRING_TICK:
            marks.add("spring")
        loot = {k: lootable[k] * dest // 100 for k in ASSETS}
        ints = [tick, dest, len(marks), loot["brine"], loot["peat"], loot["copper"]] + [b["hp"] for b in bs]
        for u in units:
            ints += [u["x"], u["y"], u["hp"]]
        h = FNV_OFFSET
        for byte in b"".join(struct.pack("<i", v) for v in ints):
            h = ((h ^ byte) * FNV_PRIME) & 0xFFFFFFFF
        return dict(tick=tick, destruction=dest, stars=len(marks), loot=loot, hash=f"{h:08x}",
                    hps=[b["hp"] for b in bs])

    def near(u, r):
        return min(max(u["x"], r[0]), r[2]), min(max(u["y"], r[1]), r[3])

    frames.append(frame(0))
    tick = 0
    while tick < RAID_TICKS:
        if frames[-1]["destruction"] == 100 or (
                all(u["hp"] == 0 for u in units) and not any(d["tick"] >= tick for d in deploys)):
            break
        for d in deploys:
            if d["tick"] == tick:
                s = UNIT[d["unit"]]
                units.append(dict(x=d["x"] * 1000 + 500, y=d["y"] * 1000 + 500, hp=s["hp"], cd=0, t=None, s=s))
        for u in units:
            if u["hp"] == 0:
                continue
            s = u["s"]
            if u["t"] is None or bs[u["t"]]["hp"] == 0:
                best = None
                for i, b in enumerate(bs):
                    if b["hp"]:
                        qx, qy = near(u, b["r"])
                        d2 = (qx - u["x"]) ** 2 + (qy - u["y"]) ** 2
                        if best is None or d2 < best[0]:
                            best = (d2, i)
                u["t"] = best[1] if best else None
            if u["t"] is None:
                continue
            b = bs[u["t"]]
            qx, qy = near(u, b["r"])
            dx, dy = qx - u["x"], qy - u["y"]
            d2 = dx * dx + dy * dy
            inr = d2 <= s["rng"] ** 2
            if inr and u["cd"] == 0:
                b["hp"] = max(0, b["hp"] - hit(s["dmg"]))
                u["cd"] = s["every"] - 1
            else:
                if u["cd"] > 0:
                    u["cd"] -= 1
                if not inr:
                    dist = math.isqrt(d2)
                    step = min(s["speed"], dist)
                    u["x"] += tdiv(dx * step, dist)
                    u["y"] += tdiv(dy * step, dist)
        for b in towers:
            if b["hp"] == 0:
                continue
            cx, cy = (b["r"][0] + b["r"][2]) // 2, (b["r"][1] + b["r"][3]) // 2
            best = None
            for i, u in enumerate(units):
                if u["hp"]:
                    d2 = (u["x"] - cx) ** 2 + (u["y"] - cy) ** 2
                    if d2 <= TOWER_RANGE ** 2 and (best is None or d2 < best[0]):
                        best = (d2, i)
            if b["cd"] == 0:
                if best:
                    t = units[best[1]]
                    t["hp"] = max(0, t["hp"] - hit(TOWER_DMG[b["lvl"]]))
                    b["cd"] = 7
            else:
                b["cd"] -= 1
        tick += 1
        frames.append(frame(tick))
    return frames


PLAN_CELLS = [(19, 39), (19, 0), (0, 27), (39, 27), (39, 19), (0, 19), (39, 39), (0, 39), (39, 0), (0, 0)]


def plan(raid):
    n = raid["army"]["saltjack"]
    best = None
    for x, y in PLAN_CELLS:
        ds = [{"tick": 0, "unit": "saltjack", "x": x, "y": y} for _ in range(n)]
        f = simulate(raid["layout"], ds, raid["seed"], raid["lootable"])[-1]
        if best is None or (f["stars"], f["destruction"]) > best[0]:
            best = ((f["stars"], f["destruction"]), ds)
    return best[1], best[0][0]


def lock(att, dfn, key=None):
    return att.api.post("/api/raids", {"villageId": dfn.vid}, key=key or idempotency_key())


def deploy(att, rid, ds, key=None):
    return att.api.post(f"/api/raids/{rid}/deploys", {"deploys": ds}, key=key or idempotency_key())


def finalize(att, rid, key=None):
    return att.api.post(f"/api/raids/{rid}/finalize", {}, key=key or idempotency_key())


def run_raid(att, dfn, ds=None):
    r = lock(att, dfn)
    assert r.status_code == 201, r.text
    raid = r.json()
    assert deploy(att, raid["id"], ds or plan(raid)[0]).status_code == 200
    f = finalize(att, raid["id"])
    assert f.status_code == 200, f.text
    return f.json()


REPLAY_DEPLOYS = [{"tick": 0, "unit": "saltjack", "x": 0, "y": 19}, {"tick": 0, "unit": "saltjack", "x": 0, "y": 19}]


def snap(u, rid, t):
    r = u.api.get(f"/api/raids/{rid}/snapshot", tick=t)
    assert r.status_code == 200, r.text
    return r.json()


def fall_tick(u, rid, final):
    lo, hi = 0, final
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if snap(u, rid, mid)["destruction"] > 0:
            hi = mid
        else:
            lo = mid
    return hi


def body(page):
    return page.evaluate("() => document.body.innerText")


def watch(pages, pred, seconds=LIVE_S, what=""):
    pages = pages if isinstance(pages, list) else [pages]

    def step():
        if all(pred(p) for p in pages):
            return True
        for p in pages:
            advance(p, POLL_MS)
        return False
    poll(step, seconds, what)


def shows(t):
    return (lambda p: bool(t.search(body(p)))) if isinstance(t, re.Pattern) else (lambda p: t in body(p))


def notice(page, t, seconds=UI_S):
    watch(page, shows(t), seconds, f"notice {t}")
    expect(page.get_by_role("status", name="Tide notices")).to_contain_text(t, timeout=UI_MS)


def alert(page, t, seconds=UI_S):
    watch(page, shows(t), seconds, f"alert {t}")
    expect(page.get_by_role("alert", name="Tide alerts")).to_contain_text(t, timeout=UI_MS)


def ui_in(page, u):
    fill(page.get_by_role("textbox", name="Email"), u.email)
    fill(page.get_by_label("Password", exact=True), u.pw)
    click(page.get_by_role("button", name="Sign in", exact=True))
    expect(page.get_by_role("navigation", name="Main")).to_be_visible(timeout=UI_MS)


def island(page):
    v = page.get_by_role("application", name="Island view")
    expect(v).to_be_visible(timeout=UI_MS)
    return v


ARROWS = {"ArrowRight": "ArrowLeft", "ArrowLeft": "ArrowRight", "ArrowDown": "ArrowUp", "ArrowUp": "ArrowDown"}


def at(view, kind):
    return int(view.get_attribute(f"data-{kind}-x")), int(view.get_attribute(f"data-{kind}-y"))


def steer(page, view, kind, x, y):
    view.focus()
    for _ in range(200):
        cx, cy = at(view, kind)
        if (cx, cy) == (x, y):
            return
        for k, back in ARROWS.items():
            page.keyboard.press(k)
            nx, ny = at(view, kind)
            if abs(nx - x) + abs(ny - y) < abs(cx - x) + abs(cy - y):
                break
            if (nx, ny) != (cx, cy):
                page.keyboard.press(back)
    raise AssertionError(f"{kind} never reached {x},{y}")


def ring_ready(page, view):
    view.focus()
    page.keyboard.press("1")
    steer(page, view, "cursor", 0, 0)


def ghost(page, view, name, x, y):
    steer(page, view, "cursor", x, y)
    click(page.get_by_role("button", name="Build", exact=True))
    click(page.get_by_role("dialog", name="Build").get_by_role("button", name=re.compile("^Place " + name)))
    expect(view).to_have_attribute("data-ghost-x", str(x), timeout=UI_MS)


def details(page, view, x, y, heading):
    steer(page, view, "cursor", x, y)
    page.keyboard.press("Enter")
    panel = page.get_by_role("complementary", name="Building details")
    expect(panel.get_by_role("heading", name=heading)).to_be_visible(timeout=UI_MS)
    return panel


def top(v):
    return [rule(k, v["resources"][k]["amount"], v["resources"][k]["cap"]) for k in ASSETS]


def test_signup_same_answer_one_mail(app_url, mail):
    verified = new_user(app_url, mail)
    unver = new_user(app_url, mail, verify=False)
    newbie, _ = fresh()
    a = Api(app_url)
    bodies = []
    for email in (newbie, unver.email, verified.email.upper()):
        r = a.post("/api/auth/signup", {"email": email, "password": "Other-Pass-123", "displayName": "Someone Else", "timeZone": "UTC"})
        assert r.status_code == 202
        bodies.append(r.json())
    assert bodies == [{"status": "check_email"}] * 3
    for addr, n in ((newbie, 1), (unver.email, 2), (verified.email, 2)):
        for m in exactly(mail, addr, CONFIRM_SUBJECT, n):
            assert mail_from_address() in addresses(m["From"])
    assert Api(app_url).signin(verified.email, verified.pw).status_code == 200
    assert verified.api.get("/api/me").json()["displayName"] == verified.name
    odd, _ = fresh()
    for extra in ("constructor", "toString"):
        field(a.post("/api/auth/signup", {"email": odd, "password": "Other-Pass-123", "displayName": "Someone Odd", "timeZone": "UTC", extra: 1}), extra, "unknown field")
    exactly(mail, odd, CONFIRM_SUBJECT, 0)


def test_verification_link_lifetime(mail):
    base = url("APP_SHORT_URL")
    late = new_user(base, mail, verify=False)
    t0 = time.monotonic()
    late_tok = link_tokens(inbox(mail, late.email, CONFIRM_SUBJECT), "/verify")[0]
    u = new_user(base, mail, verify=False)
    first = link_tokens(inbox(mail, u.email, CONFIRM_SUBJECT), "/verify")[0]
    assert u.api.post("/api/auth/resend-verification", {"email": u.email}).status_code == 202
    second = [t for t in link_tokens(inbox(mail, u.email, CONFIRM_SUBJECT, 2), "/verify") if t != first][0]
    err(u.api.post("/api/auth/verify", {"token": first}), 400, "invalid_token")
    r = u.api.post("/api/auth/verify", {"token": second})
    assert r.status_code == 200 and r.json() == {"status": "verified"}
    err(u.api.post("/api/auth/verify", {"token": second}), 400, "invalid_token")
    assert u.api.get("/api/me").json()["verified"] is True
    poll(lambda: time.monotonic() > t0 + SHORT_LINK_S + 1, SHORT_LINK_S * 3, "link lifetime")
    err(late.api.post("/api/auth/verify", {"token": late_tok}), 400, "invalid_token")
    assert late.api.get("/api/me").json()["verified"] is False


def test_signin_and_signout(app_url, mail):
    u = new_user(app_url, mail)
    a = Api(app_url)
    unknown, _ = fresh()
    r1 = a.post("/api/auth/signin", {"email": u.email, "password": "Wrong-Pass-000"})
    r2 = a.post("/api/auth/signin", {"email": unknown, "password": "Wrong-Pass-000"})
    err(r1, 401, "invalid_credentials")
    assert (r1.status_code, r1.json()) == (r2.status_code, r2.json())
    before = a.csrf
    r = a.post("/api/auth/signin", {"email": u.email, "password": u.pw})
    assert r.status_code == 200
    session_cookie(r)
    assert r.json()["csrfToken"] and r.json()["csrfToken"] != before
    assert set(r.json()["user"]) == ME_KEYS and r.json()["user"]["email"] == u.email
    a.csrf = r.json()["csrfToken"]
    assert a.get("/api/me").status_code == 200
    assert a.post("/api/auth/signout").status_code == 204
    err(a.get("/api/me"), 401, "unauthenticated")


def test_password_reset(mail):
    base = url("APP_SHORT_URL")
    u = new_user(base, mail)
    other = Api(base)
    assert other.signin(u.email, u.pw).status_code == 200
    stranger, _ = fresh()
    a = Api(base)
    r1, r2 = a.post("/api/auth/forgot", {"email": u.email}), a.post("/api/auth/forgot", {"email": stranger})
    assert r1.status_code == r2.status_code == 202 and r1.json() == r2.json() == {"status": "check_email"}
    exactly(mail, stranger, RESET_SUBJECT, 1)
    tok = link_tokens(exactly(mail, u.email, RESET_SUBJECT, 1), "/reset")[0]
    new_pw = "Fresh-Pass-" + uuid.uuid4().hex[:6]
    r = a.post("/api/auth/reset", {"token": tok, "password": new_pw})
    assert r.status_code == 200 and r.json() == {"status": "password_reset"}
    for s in (u.api, other):
        err(s.get("/api/me"), 401, "unauthenticated")
    err(a.post("/api/auth/reset", {"token": tok, "password": "Again-Pass-123"}), 400, "invalid_token")
    err(Api(base).post("/api/auth/signin", {"email": u.email, "password": u.pw}), 401, "invalid_credentials")
    s = Api(base)
    assert s.signin(u.email, new_pw).status_code == 200
    t0 = time.monotonic()
    assert a.post("/api/auth/forgot", {"email": u.email}).status_code == 202
    late = [t for t in link_tokens(inbox(mail, u.email, RESET_SUBJECT, 2), "/reset") if t != tok][0]
    poll(lambda: time.monotonic() > t0 + SHORT_LINK_S + 1, SHORT_LINK_S * 3, "reset lifetime")
    err(a.post("/api/auth/reset", {"token": late, "password": "Late-Pass-1234"}), 400, "invalid_token")
    assert s.get("/api/me").status_code == 200


THROTTLES = {"signin": ("/api/auth/signin", SIGNIN_LIMIT, None),
             "forgot": ("/api/auth/forgot", MAIL_LIMIT, RESET_SUBJECT),
             "resend": ("/api/auth/resend-verification", MAIL_LIMIT, CONFIRM_SUBJECT)}


@pytest.mark.parametrize("case", ["signin", "forgot", "resend"], ids=["signin", "forgot", "resend"])
def test_auth_throttles(app_url, mail, case):
    path, limit, subject = THROTTLES[case]
    email, _ = fresh()
    body = {"email": email, "password": "Wrong-Pass-000"} if case == "signin" else {"email": email}
    clients = [Api(app_url) for _ in range(limit + 4)]
    rs = together([lambda c=c: c.post(path, body) for c in clients])
    ok = [r for r in rs if r.status_code != 429]
    assert len(ok) == limit, [r.status_code for r in rs]
    for r in ok:
        if case == "signin":
            err(r, 401, "invalid_credentials")
        else:
            assert r.status_code == 202
    for r in rs:
        if r.status_code == 429:
            err(r, 429, "rate_limited")
            assert int(r.headers["Retry-After"]) >= 1
    if subject:
        exactly(mail, email, subject, limit)


@pytest.mark.parametrize("kind", ["confirmation", "reset"], ids=["confirmation", "reset"])
def test_one_live_link(app_url, mail, kind):
    u = new_user(app_url, mail, verify=kind == "reset")
    path, subj, route = (("/api/auth/resend-verification", CONFIRM_SUBJECT, "/verify") if kind == "confirmation"
                         else ("/api/auth/forgot", RESET_SUBJECT, "/reset"))
    already = 1 if kind == "confirmation" else 0
    clients = [Api(app_url) for _ in range(MAIL_LIMIT)]
    assert all(r.status_code == 202 for r in together([lambda c=c: c.post(path, {"email": u.email}) for c in clients]))
    toks = link_tokens(exactly(mail, u.email, subj, MAIL_LIMIT + already), route)
    a, wins = Api(app_url), 0
    for t in toks:
        r = (a.post("/api/auth/verify", {"token": t}) if kind == "confirmation"
             else a.post("/api/auth/reset", {"token": t, "password": "Reset-Pass-" + t[:6]}))
        if r.status_code == 200:
            wins += 1
        else:
            err(r, 400, "invalid_token")
    assert wins == 1


def test_session_end_on_open_screens(browser, app_url, mail):
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        island(page)
        click(page.get_by_role("button", name="Sign out"))
        notice(page, "You signed out.")
        expect(page).to_have_url(re.compile(r"/signin"))
        page.go_back()
        expect(page).to_have_url(re.compile(r"/signin"), timeout=UI_MS)
        notice(page, "You signed out.")
        expect(page.get_by_role("application", name="Island view")).to_have_count(0)
        ui_in(page, u)
        island(page)
        assert u.api.post("/api/auth/forgot", {"email": u.email}).status_code == 202
        tok = link_tokens(inbox(mail, u.email, RESET_SUBJECT), "/reset")[0]
        assert Api(app_url).post("/api/auth/reset", {"token": tok, "password": "Ended-Pass-123"}).status_code == 200
        watch(page, shows("Your session ended. Sign in again."), LIVE_S, "session-ended alert")
        expect(page.get_by_role("alert", name="Tide alerts")).to_contain_text("Your session ended. Sign in again.")
        expect(page).to_have_url(re.compile(r"/signin"), timeout=UI_MS)
        err(u.api.get("/api/me"), 401, "unauthenticated")


def test_wf_onboarding_feedback(browser, app_url, mail):
    email, name = fresh()
    pw = "Tide-Pass-" + uuid.uuid4().hex[:8]
    with open_app(browser, app_url + "/signup") as page:
        expect(page.get_by_role("heading", name="Make your island")).to_be_visible(timeout=UI_MS)
        fill(page.get_by_role("textbox", name="Email"), "not-an-address")
        fill(page.get_by_label("Password", exact=True), pw)
        fill(page.get_by_role("textbox", name="Display name"), name)
        click(page.get_by_role("button", name="Create island"))
        alert(page, "Check the highlighted fields.")
        expect(page.get_by_role("textbox", name="Email")).to_have_accessible_description("Enter a valid email address.")
        fill(page.get_by_role("textbox", name="Email"), email)
        with held(page, "**/api/auth/signup") as hold:
            click(page.get_by_role("button", name="Create island"))
            notice(page, "Creating your island…")
            hold.release()
        notice(page, f"Check your inbox at {email}. Your confirmation link may take a few minutes to arrive.")
        exactly(mail, email, CONFIRM_SUBJECT, 1)
        page.goto(app_url + "/signin")
        fill(page.get_by_role("textbox", name="Email"), email)
        with held(page, "**/api/auth/resend-verification") as hold:
            click(page.get_by_role("button", name="Send a new confirmation link"))
            notice(page, "Sending…")
            hold.release()
        notice(page, f"A fresh confirmation link is on its way to {email}. It may take a few minutes.")
        exactly(mail, email, CONFIRM_SUBJECT, 2)
        fill(page.get_by_label("Password", exact=True), "Wrong-Pass-000")
        click(page.get_by_role("button", name="Sign in", exact=True))
        alert(page, "That email and password don't match an account.")
        fill(page.get_by_label("Password", exact=True), pw)
        with held(page, "**/api/auth/signin") as hold:
            click(page.get_by_role("button", name="Sign in", exact=True))
            notice(page, "Signing in…")
            hold.release()
        island(page)
        with held(page, "**/api/auth/signout") as hold:
            click(page.get_by_role("button", name="Sign out"))
            notice(page, "Signing out…")
            hold.release()
        notice(page, "You signed out.")
        page.goto(app_url + "/forgot")
        expect(page.get_by_role("heading", name="Reset your password")).to_be_visible(timeout=UI_MS)
        fill(page.get_by_role("textbox", name="Email"), email)
        with held(page, "**/api/auth/forgot") as hold:
            click(page.get_by_role("button", name="Send reset link"))
            notice(page, "Sending…")
            hold.release()
        notice(page, f"A reset link is on its way to {email}. It works once and expires soon.")
        exactly(mail, email, RESET_SUBJECT, 1)
        page.goto(app_url + "/reset?token=" + "x" * 40)
        fill(page.get_by_label("New password", exact=True), "Brand-New-Pass-1")
        with held(page, "**/api/auth/reset") as hold:
            click(page.get_by_role("button", name="Set new password"))
            notice(page, "Saving…")
            hold.release()
        alert(page, "This reset link has expired or was already used.")


def test_wf_onboarding_journey(browser, app_url, mail):
    email, name = fresh()
    pw = "Tide-Pass-" + uuid.uuid4().hex[:8]
    with open_app(browser, app_url + "/signup") as page:
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_label("Password", exact=True), pw)
        fill(page.get_by_role("textbox", name="Display name"), name)
        expect(page.get_by_role("combobox", name="Time zone")).to_be_visible()
        click(page.get_by_role("button", name="Create island"))
        notice(page, f"Check your inbox at {email}.")
        link = re.search(r"https?://\S+/verify\?token=[^\s\"'<>&]+", text(inbox(mail, email, CONFIRM_SUBJECT)[0])).group(0)
        page.goto(app_url + "/verify?token=" + link.split("token=", 1)[1])
        expect(page.get_by_role("heading", name="Confirming your email")).to_be_visible(timeout=UI_MS)
        notice(page, "Email confirmed. Your island is ready.")
        click(page.get_by_role("link", name="Go to sign in"))
        u = U(email=email, pw=pw)
        ui_in(page, u)
        island(page)
        res = page.get_by_role("group", name="Resources")
        for t in ("Brine 1,500 / 2,000", "Peat 1,500 / 2,000", "Copper 100 / 200"):
            expect(res).to_contain_text(t, timeout=UI_MS)
        for t in ("Builders 2/2", "Saltmark 5", "Army 10/20", "Trophies 0", "League Mudflat"):
            watch(page, shows(t), UI_S, t)
    a = Api(app_url)
    assert a.signin(email, pw).status_code == 200
    me = a.get("/api/me").json()
    assert me["verified"] is True and me["displayName"] == name and me["timeZone"]


EXTRA = {"level": 3, "finishesAt": "2027-03-15T04:00:00.000Z", "cost": 0, "ownerId": 1}


@pytest.mark.parametrize("extra", list(EXTRA), ids=list(EXTRA))
def test_building_intent_only(app_url, mail, extra):
    u = new_user(app_url, mail)
    v0 = vil(u)
    barracks = bld(v0, "tide_barracks")
    field(u.api.post("/api/village/buildings", {"type": "brine_pan", "x": 30, "y": 4, "rotation": 0, extra: EXTRA[extra]}), extra, "unknown field")
    field(u.api.patch(f"/api/village/buildings/{barracks['id']}", {"x": 30, "y": 4, "rotation": 0, extra: EXTRA[extra]}), extra, "unknown field")
    field(u.api.post(f"/api/village/buildings/{bld(v0, 'brine_pan')['id']}/upgrade", {extra: EXTRA[extra]}), extra, "unknown field")
    v1 = vil(u)
    assert len(v1["buildings"]) == len(v0["buildings"]) and amounts(v1)["peat"] == amounts(v0)["peat"]
    assert bld(v1, "tide_barracks")["x"] == barracks["x"] and all(b["upgrade"] is None for b in v1["buildings"])


def test_placement_rules(app_url, mail):
    u = new_user(app_url, mail)
    n0 = len(vil(u)["buildings"])
    place = lambda t, x, y, r=0: u.api.post("/api/village/buildings", {"type": t, "x": x, "y": y, "rotation": r})
    b = err(place("brine_pan", 36, 10), 422, "validation_failed")
    assert set(b["errors"]) & {"x", "y"} and "Keep the whole building inside the build area." in b["errors"].values()
    b = err(place("peat_cutter", 36, 10, 90), 422, "validation_failed")
    assert set(b["errors"]) & {"x", "y"}
    field(place("brine_pan", 30, 4, 45), "rotation", "Use 0, 90, 180 or 270.")
    field(place("sand_castle", 30, 4), "type", "Choose a building from the catalog.")
    err(place("brine_pan", 13, 19), 409, "cell_occupied")
    err(place("tide_barracks", 5, 5), 409, "building_limit_reached")
    assert len(vil(u)["buildings"]) == n0
    cutter = place("peat_cutter", 36, 10, 0)
    assert cutter.status_code == 201 and cutter.json()["level"] == 0
    assert u.api.post(f"/api/village/buildings/{cutter.json()['id']}/cancel").status_code == 200
    assert u.api.post("/api/army/train", {"unit": "saltjack", "count": 10}).status_code == 201
    assert place("copper_vault", 30, 4).status_code == 201
    v = vil(u)
    err(place("copper_sluice", 30, 10), 409, "insufficient_resources")
    assert vil(u)["buildings"] == v["buildings"] and amounts(vil(u)) == amounts(v)
    assert place("brine_pan", 22, 10).status_code == 201
    err(place("brine_pan", 30, 30), 409, "no_free_builder")


def test_upgrades_and_builders(mail):
    base = url("APP_SHORT_URL")
    u = new_user(base, mail)
    v = vil(u)
    pan, cutter, barracks = (bld(v, t) for t in ("brine_pan", "peat_cutter", "tide_barracks"))
    r = u.api.post(f"/api/village/buildings/{pan['id']}/upgrade")
    assert r.status_code == 200
    up = r.json()["upgrade"]
    assert up["toLevel"] == 2 and ms(up["finishesAt"]) - ms(up["startedAt"]) == math.ceil(60 / SHORT_DIVISOR) * 1000
    v1 = vil(u)
    assert amounts(v1)["peat"] == STARTER["peat"] - 600
    builders_ok(v1)
    err(u.api.post(f"/api/village/buildings/{pan['id']}/upgrade"), 409, "upgrade_in_progress")
    assert u.api.post(f"/api/village/buildings/{cutter['id']}/upgrade").status_code == 200
    builders_ok(vil(u))
    err(u.api.post(f"/api/village/buildings/{barracks['id']}/upgrade"), 409, "no_free_builder")
    done = poll(lambda: (lambda w: w if all(b["upgrade"] is None for b in w["buildings"]) else None)(vil(u)), JOB_WAIT_S, "upgrades finish")
    assert bld(done, "brine_pan")["level"] == 2 and done["saltmark"] == 7
    builders_ok(done)
    err(u.api.post(f"/api/village/buildings/{pan['id']}/upgrade"), 409, "saltmark_too_low")


def test_race_safe_spends(app_url, mail):
    u = new_user(app_url, mail)
    cells = [(22, 4), (26, 4), (30, 4), (22, 8)]
    rs = together([lambda c=c: u.api.post("/api/village/buildings", {"type": "brine_pan", "x": c[0], "y": c[1], "rotation": 0}) for c in cells])
    assert sorted(r.status_code for r in rs) == [201, 201, 409, 409]
    for r in rs:
        if r.status_code == 409:
            err(r, 409, "no_free_builder")
    assert vil(u)["builders"]["free"] == 0
    w = new_user(app_url, mail)
    pan = bld(vil(w), "brine_pan")
    rs = together([lambda: w.api.post(f"/api/village/buildings/{pan['id']}/upgrade"),
                   lambda: w.api.post("/api/village/buildings", {"type": "copper_vault", "x": 30, "y": 4, "rotation": 0})])
    assert sorted(r.status_code for r in rs) in ([200, 409], [201, 409])
    err(next(r for r in rs if r.status_code == 409), 409, "insufficient_resources")
    assert all(x >= 0 for x in amounts(vil(w)).values())


def test_cancel_and_move(mail):
    base = url("APP_SHORT_URL")
    u = new_user(base, mail)
    vault = u.api.post("/api/village/buildings", {"type": "copper_vault", "x": 30, "y": 4, "rotation": 0}).json()
    r = u.api.post(f"/api/village/buildings/{vault['id']}/cancel")
    assert r.status_code == 200 and r.json()["building"] is None
    assert r.json()["refunded"]["brine"] == 1000 and r.json()["refunded"]["peat"] == 1000
    v = vil(u)
    assert amounts(v) == STARTER and all(b["id"] != vault["id"] for b in v["buildings"])
    builders_ok(v)
    cist = u.api.post("/api/village/buildings", {"type": "brine_cistern", "x": 22, "y": 4, "rotation": 0}).json()
    poll(lambda: vil(u)["serverTime"] >= cist["upgrade"]["finishesAt"], JOB_WAIT_S, "cistern finish")
    err(u.api.post(f"/api/village/buildings/{cist['id']}/cancel"), 409, "job_already_finished")
    v = vil(u)
    assert next(b for b in v["buildings"] if b["id"] == cist["id"])["level"] == 1 and amounts(v)["peat"] == STARTER["peat"] - 300
    cutter = bld(v, "peat_cutter")
    job = u.api.post(f"/api/village/buildings/{cutter['id']}/upgrade").json()["upgrade"]
    moved = u.api.patch(f"/api/village/buildings/{cutter['id']}", {"x": 30, "y": 30, "rotation": 90})
    assert moved.status_code == 200
    m = moved.json()
    assert (m["x"], m["y"], m["rotation"], m["level"]) == (30, 30, 90, 1) and m["upgrade"]["finishesAt"] == job["finishesAt"]
    before = amounts(vil(u))["brine"]
    r = u.api.post(f"/api/village/buildings/{cutter['id']}/cancel")
    assert r.status_code == 200 and r.json()["building"]["level"] == 1 and r.json()["refunded"]["brine"] == 600
    v = vil(u)
    assert amounts(v)["brine"] == before + 600
    builders_ok(v)


def test_wf_village_building_feedback(browser, app_url, mail):
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        view = island(page)
        ghost(page, view, "Peat Rick", 30, 4)
        with held(page, "**/api/village/buildings") as hold:
            page.keyboard.press("Enter")
            notice(page, "Placing Peat Rick…")
            hold.release()
        notice(page, re.compile(r"Peat Rick placed\. Done at \d\d:\d\d\."))
        panel = details(page, view, 12, 24, "Brine Pan · level 1")
        with held(page, "**/upgrade") as hold:
            click(panel.get_by_role("button", name=upgrade_button(2)))
            notice(page, "Starting upgrade…")
            hold.release()
        notice(page, re.compile(r"Brine Pan upgrading to level 2\. Done at \d\d:\d\d\."))
        page.keyboard.press("Escape")
        panel = details(page, view, 12, 18, "Tide Barracks · level 1")
        click(panel.get_by_role("button", name="Move"))
        steer(page, view, "ghost", 5, 10)
        with held(page, "**/api/village/buildings/*") as hold:
            page.keyboard.press("Enter")
            notice(page, "Moving Tide Barracks…")
            hold.release()
        notice(page, "Tide Barracks moved.")
        poll(lambda: bld(vil(u), "peat_rick")["level"] == 1, JOB_WAIT_S, "peat rick finished")
        assert u.api.post(f"/api/village/buildings/{bld(vil(u), 'peat_cutter')['id']}/upgrade").status_code == 200
        assert vil(u)["builders"]["free"] == 0
        ghost(page, view, "Brine Cistern", 30, 10)
        page.keyboard.press("Enter")
        alert(page, "All builders are busy.")
    v = vil(u)
    assert bld(v, "tide_barracks")["x"] == 5 and bld(v, "brine_pan")["upgrade"]["toLevel"] == 2
    assert not any(b["type"] == "brine_cistern" for b in v["buildings"])


def test_wf_village_building_journey(browser, app_url, mail):
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        view = island(page)
        ghost(page, view, "Peat Rick", 30, 4)
        expect(view).to_have_attribute("data-ghost-type", "peat_rick")
        expect(view).to_have_attribute("data-ghost-rotation", "0")
        click(page.get_by_role("button", name="Rotate"))
        expect(view).to_have_attribute("data-ghost-rotation", "90")
        expect(view).to_have_attribute("data-ghost-valid", "true")
        count = int(view.get_attribute("data-building-count"))
        click(page.get_by_role("button", name="Confirm placement"))
        expect(page.get_by_role("list", name="Builder queue")).to_contain_text(re.compile(r"Peat Rick → level 1 · \d+:\d\d"), timeout=UI_MS)
        watch(page, shows("Builders 1/2"), UI_S)
        expect(view).to_have_attribute("data-building-count", str(count + 1), timeout=UI_MS)
        watch(page, shows("Peat 1,500 / 7,000"), 10 + LIVE_S + 2, "cap after job")
        notice(page, "Peat Rick reached level 1.", LIVE_S)
        watch(page, shows("Builders 2/2"), LIVE_S)
        watch(page, shows("Saltmark 6"), LIVE_S)
    rick = bld(vil(u), "peat_rick")
    assert (rick["x"], rick["y"], rick["rotation"], rick["level"]) == (30, 4, 90, 1)
    assert vil(u)["resources"]["peat"]["cap"] == BASE_CAP["peat"] + 5000


def test_producer_collection(app_url, mail):
    u = new_user(app_url, mail)
    start = ms(next(e for e in ledger(u) if e["kind"] == "starter")["createdAt"])
    pan = poll(lambda: (lambda b: b if b["uncollected"] >= 1 else None)(bld(vil(u), "brine_pan")), 30, "accrual")
    t0 = ms(vil(u)["serverTime"])
    brine0 = amounts(vil(u))["brine"]
    rs = together([lambda: u.api.post(f"/api/village/buildings/{pan['id']}/collect") for _ in range(4)])
    t1 = ms(vil(u)["serverTime"])
    assert all(r.status_code == 200 for r in rs)
    for r in rs:
        assert set(r.json()["collected"]) == set(ASSETS) and set(r.json()["lost"]) == set(ASSETS)
    got = [r.json()["collected"]["brine"] for r in rs]
    assert sum(1 for g in got if g) == 1
    c = sum(got)
    assert 600 * (t0 - start) // 3600000 <= c <= 600 * (t1 - start) // 3600000
    assert amounts(vil(u))["brine"] == brine0 + c
    prod = [e for e in ledger(u) if e["kind"] == "production" and e["asset"] == "brine"]
    assert len(prod) == 1 and prod[0]["amount"] == c
    err(u.api.post(f"/api/village/buildings/{bld(vil(u), 'tide_barracks')['id']}/collect"), 409, "not_a_producer")


def test_paired_resource_ledger(mail):
    base = url("APP_SHORT_URL")
    u = new_user(base, mail)
    rick = u.api.post("/api/village/buildings", {"type": "peat_rick", "x": 30, "y": 4, "rotation": 0}).json()
    vault = u.api.post("/api/village/buildings", {"type": "copper_vault", "x": 22, "y": 4, "rotation": 0}).json()
    u.api.post(f"/api/village/buildings/{vault['id']}/cancel")
    assert u.api.post("/api/army/train", {"unit": "saltjack", "count": 2}).status_code == 201
    poll(lambda: vil(u)["army"]["units"]["saltjack"] == STARTER_ARMY + 2, JOB_WAIT_S, "training")
    u.api.post(f"/api/village/buildings/{bld(vil(u), 'peat_cutter')['id']}/collect")
    v, es = vil(u), ledger(u)
    for k in ASSETS:
        assert v["resources"][k]["amount"] == sum(e["amount"] for e in es if e["asset"] == k) <= v["resources"][k]["cap"]
    assert v["army"]["units"]["saltjack"] == sum(e["amount"] for e in es if e["asset"] == "saltjack")
    assert len({e["pairId"] for e in es}) == len(es)
    starter = {e["asset"]: e["amount"] for e in es if e["kind"] == "starter"}
    assert starter == {**STARTER, "saltjack": STARTER_ARMY} and all(e["counterparty"] == "tide" for e in es)
    kinds = {e["kind"] for e in es}
    assert {"build_spend", "refund", "train_spend", "train_complete"} <= kinds and rick["level"] == 0
    err(u.api.get("/api/village/ledger", before=9007199254740991), 404, "not_found")


def test_training_and_housing(mail):
    base = url("APP_SHORT_URL")
    u = new_user(base, mail)
    r = u.api.post("/api/army/train", {"unit": "saltjack", "count": 4})
    assert r.status_code == 201
    army = r.json()["army"]
    batch = army["training"][-1]
    assert ms(batch["finishesAt"]) - ms(batch["startsAt"]) == 4 * math.ceil(5 / SHORT_DIVISOR) * 1000
    assert army["housing"] == {"used": STARTER_ARMY + 4, "capacity": HOUSING_L1} and army["units"]["saltjack"] == STARTER_ARMY
    assert amounts(vil(u))["brine"] == STARTER["brine"] - 4 * 25
    err(u.api.post("/api/army/train", {"unit": "saltjack", "count": 7}), 409, "housing_full")
    err(u.api.post("/api/army/train", {"unit": "peat_slinger", "count": 1}), 409, "barracks_level_too_low")
    field(u.api.post("/api/army/train", {"unit": "saltjack", "count": 21}), "count", "Choose 1 to 20.")
    field(u.api.post("/api/army/train", {"unit": "kraken", "count": 1}), "unit", "Choose Saltjack or Peat Slinger.")
    done = poll(lambda: (lambda a: a if not a["training"] else None)(u.api.get("/api/army").json()["army"]), JOB_WAIT_S, "batch")
    assert done["units"]["saltjack"] == STARTER_ARMY + 4 and done["housing"]["used"] == STARTER_ARMY + 4


def test_training_queue_order(app_url, mail):
    u = new_user(app_url, mail)
    for _ in range(3):
        assert u.api.post("/api/army/train", {"unit": "saltjack", "count": 2}).status_code == 201
    b1, b2, b3 = u.api.get("/api/army").json()["army"]["training"]
    dur = 2 * 5 * 1000
    assert b2["startsAt"] == b1["finishesAt"] and b3["startsAt"] == b2["finishesAt"]
    assert all(ms(b["finishesAt"]) - ms(b["startsAt"]) == dur for b in (b1, b2, b3))
    r = u.api.post(f"/api/army/training/{b2['id']}/cancel")
    assert r.status_code == 200 and r.json()["refunded"]["brine"] == 50
    n3 = next(b for b in r.json()["army"]["training"] if b["id"] == b3["id"])
    assert ms(n3["startsAt"]) == ms(b3["startsAt"]) - dur and ms(n3["finishesAt"]) == ms(b3["finishesAt"]) - dur
    t0 = ms(vil(u)["serverTime"])
    r = u.api.post(f"/api/army/training/{b1['id']}/cancel")
    t1 = ms(vil(u)["serverTime"])
    n3 = r.json()["army"]["training"][0]
    assert n3["id"] == b3["id"] and t0 <= ms(n3["startsAt"]) <= t1 and ms(n3["finishesAt"]) - ms(n3["startsAt"]) == dur
    err(u.api.post(f"/api/army/training/{b2['id']}/cancel"), 404, "not_found")
    poll(lambda: vil(u)["serverTime"] >= n3["finishesAt"], JOB_WAIT_S, "last batch")
    err(u.api.post(f"/api/army/training/{b3['id']}/cancel"), 409, "batch_already_finished")
    assert vil(u)["army"]["units"]["saltjack"] == STARTER_ARMY + 2


def test_wf_village_economy_live_tabs(browser, app_url, mail):
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin") as p1, open_app(browser, app_url + "/signin") as p2:
        for p in (p1, p2):
            ui_in(p, u)
            island(p)
        r = u.api.post("/api/village/buildings", {"type": "brine_cistern", "x": 30, "y": 4, "rotation": 0})
        assert r.status_code == 201
        watch([p1, p2], shows("Peat 1,200 / 2,000"), LIVE_S, "spend elsewhere")
        watch([p1, p2], shows("Brine Cistern → level 1"), LIVE_S, "queue row")
        poll(lambda: vil(u)["serverTime"] >= r.json()["upgrade"]["finishesAt"], JOB_WAIT_S, "job finish")
        watch([p1, p2], shows("Brine 1,500 / 7,000"), LIVE_S, "cap after job")
        for p in (p1, p2):
            expect(p.get_by_role("status", name="Tide notices")).to_contain_text(job_done("Brine Cistern", 1))


def test_wf_village_economy_journey(browser, app_url, mail):
    u = new_user(app_url, mail)
    poll(lambda: bld(vil(u), "brine_pan")["uncollected"] >= 1, 30, "first accrual")
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        view = island(page)
        pan = details(page, view, 12, 24, "Brine Pan · level 1")
        click(pan.get_by_role("button", name="Collect"))
        poll(lambda: any(e["kind"] == "production" for e in ledger(u)), UI_S, "collection stored")
        for t in top(vil(u)):
            watch(page, shows(t), UI_S, t)
        page.keyboard.press("Escape")
        click(page.get_by_role("button", name="Train", exact=True))
        army = page.get_by_role("complementary", name="Train army")
        check(army.get_by_role("radio", name="Saltjack"))
        fill(army.get_by_role("spinbutton", name="Count"), "3")
        click(army.get_by_role("button", name="Train", exact=True))
        poll(lambda: len(vil(u)["army"]["training"]) == 1, UI_S, "batch stored")
        watch(page, shows("Army 13/20"), UI_S, "army after train")
        for t in top(vil(u)):
            watch(page, shows(t), UI_S, t)
        click(page.get_by_role("button", name=cancel_training(3)))
        poll(lambda: vil(u)["army"]["training"] == [], UI_S, "batch cancelled")
        watch(page, shows("Army 10/20"), UI_S, "army after cancel")
        pan = details(page, view, 12, 24, "Brine Pan · level 1")
        click(pan.get_by_role("button", name=upgrade_button(2)))
        poll(lambda: vil(u)["builders"]["free"] == 1, UI_S, "job stored")
        watch(page, shows("Builders 1/2"), UI_S, "builder busy")
        click(pan.get_by_role("button", name="Cancel job"))
        poll(lambda: vil(u)["builders"]["free"] == 2, UI_S, "job cancelled")
        watch(page, shows("Builders 2/2"), UI_S, "builder free")
        final = vil(u)
        for t in top(final):
            watch(page, shows(t), UI_S, t)
    assert final["army"]["units"]["saltjack"] == STARTER_ARMY and amounts(final)["peat"] == STARTER["peat"]


def test_wf_village_economy_feedback(browser, app_url, mail):
    u = new_user(app_url, mail)
    poll(lambda: bld(vil(u), "brine_pan")["uncollected"] >= 1, 30, "accrual")
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        view = island(page)
        panel = details(page, view, 12, 24, "Brine Pan · level 1")
        expect(panel).to_contain_text("Uncollected")
        with held(page, "**/collect") as hold:
            click(panel.get_by_role("button", name="Collect"))
            notice(page, "Collecting…")
            hold.release()
        notice(page, re.compile(r"Collected \d[\d,]* brine\.|Nothing to collect yet\."))
        for t in top(vil(u)):
            watch(page, shows(t), UI_S, t)
        page.keyboard.press("Escape")
        click(page.get_by_role("button", name="Train", exact=True))
        train = page.get_by_role("complementary", name="Train army")
        check(train.get_by_role("radio", name="Saltjack"))
        fill(train.get_by_role("spinbutton", name="Count"), "3")
        with held(page, "**/api/army/train") as hold:
            click(train.get_by_role("button", name="Train", exact=True))
            notice(page, "Queuing training…")
            hold.release()
        notice(page, re.compile(r"Training 3 Saltjack\. Ready at \d\d:\d\d\."))
        watch(page, shows("Army 13/20"), UI_S)
        if not train.is_visible():
            click(page.get_by_role("button", name="Train", exact=True))
        fill(train.get_by_role("spinbutton", name="Count"), "8")
        click(train.get_by_role("button", name="Train", exact=True))
        alert(page, "Your camps are full.")
        with held(page, "**/cancel") as hold:
            click(page.get_by_role("button", name=cancel_training(3)))
            notice(page, "Cancelling training…")
            hold.release()
        notice(page, "Training of 3 Saltjack cancelled. Refunded 75 brine.")
        watch(page, shows("Army 10/20"), UI_S)
        panel = details(page, view, 12, 24, "Brine Pan · level 1")
        click(panel.get_by_role("button", name=upgrade_button(2)))
        watch(page, shows("Builders 1/2"), UI_S)
        with held(page, "**/cancel") as hold:
            click(panel.get_by_role("button", name="Cancel job"))
            notice(page, "Cancelling…")
            hold.release()
        notice(page, "Brine Pan job cancelled. Refunded 600 peat.")
        watch(page, shows("Builders 2/2"), UI_S)
        v = vil(u)
        for t in top(v):
            watch(page, shows(t), UI_S, t)
    assert v["army"]["training"] == [] and v["army"]["units"]["saltjack"] == STARTER_ARMY and v["builders"]["free"] == 2


def test_scout_projection(app_url, mail):
    att, dfn = users(app_url, mail, 2)
    r = att.api.get(f"/api/villages/{dfn.vid}/scout")
    assert r.status_code == 200
    s = r.json()
    assert set(s) == {"villageId", "displayName", "trophies", "league", "buildings", "lootable"}
    assert all(set(b) == {"id", "type", "x", "y", "rotation", "level"} for b in s["buildings"])
    bal = amounts(vil(dfn))
    assert s["lootable"] == {k: bal[k] * LOOT_PCT // 100 for k in ASSETS}
    assert (s["villageId"], s["displayName"], s["league"]) == (dfn.vid, dfn.name, "Mudflat")
    assert dfn.email not in r.text and "UTC" not in r.text and "shield" not in r.text and "training" not in r.text


def test_private_reads(app_url, mail):
    att, dfn, other = users(app_url, mail, 3)
    raid = run_raid(att, dfn, REPLAY_DEPLOYS)
    for path in (f"/api/villages/{dfn.vid}", f"/api/raids/{raid['id']}"):
        err(other.api.get(path), 404, "not_found")
    err(other.api.get(f"/api/raids/{raid['id']}/snapshot", tick=0), 404, "not_found")
    assert dfn.api.get(f"/api/raids/{raid['id']}").status_code == 200
    assert dfn.api.get(f"/api/villages/{dfn.vid}").json()["id"] == dfn.vid
    assert all(x["id"] != raid["id"] for x in other.api.get("/api/raids", role="attack").json()["raids"])
    assert all(e["raidId"] != raid["id"] for e in ledger(other))


def test_raid_eligibility(app_url, mail):
    att, dfn, third = users(app_url, mail, 3)
    unver = new_user(app_url, mail, verify=False)
    err(att.api.get(f"/api/villages/{att.vid}/scout"), 409, "cannot_raid_self")
    err(lock(att, att), 409, "cannot_raid_self")
    err(unver.api.get("/api/scout/next"), 403, "email_not_verified")
    err(lock(unver, dfn), 403, "email_not_verified")
    raid = lock(att, dfn).json()
    assert vil(dfn)["underAttack"] is True
    err(third.api.get(f"/api/villages/{dfn.vid}/scout"), 409, "already_under_attack")
    err(lock(third, dfn), 409, "already_under_attack")
    err(lock(att, third), 409, "raid_in_progress")
    deploy(att, raid["id"], [{"tick": 0, "unit": "saltjack", "x": 0, "y": 0} for _ in range(STARTER_ARMY)])
    assert finalize(att, raid["id"]).status_code == 200
    err(lock(att, third), 409, "no_army")


def test_single_raid_lock(app_url, mail):
    us = users(app_url, mail, 5)
    dfn, raiders = us[0], us[1:]
    rs = together([lambda a=a: lock(a, dfn) for a in raiders])
    assert sorted(r.status_code for r in rs) == [201, 409, 409, 409]
    for r in rs:
        if r.status_code == 409:
            err(r, 409, "already_under_attack")
    assert vil(dfn)["underAttack"] is True


def test_deploy_validation(app_url, mail):
    att, dfn = users(app_url, mail, 2)
    rid = lock(att, dfn).json()["id"]
    ok = {"tick": 5, "unit": "saltjack", "x": 0, "y": 5}
    b = err(deploy(att, rid, [ok, {**ok, "x": 10, "y": 10}]), 422, "validation_failed")
    assert set(b["errors"]) & {"deploys[1].x", "deploys[1].y"} and "Deploy on the tidal ring." in b["errors"].values()
    field(deploy(att, rid, [ok, {**ok, "tick": 4}]), "deploys[1].tick", "Use a tick from 0 to 1,799, never earlier than the one before.")
    field(deploy(att, rid, [{**ok, "tick": RAID_TICKS}]), "deploys[0].tick", "Use a tick from 0 to 1,799, never earlier than the one before.")
    field(deploy(att, rid, [ok] * 51), "deploys", "Send 1 to 50 deploys, and at most 200 in one raid.")
    field(deploy(att, rid, [{**ok, "unit": "kraken"}]), "deploys[0].unit", "Choose Saltjack or Peat Slinger.")
    err(deploy(att, rid, [{**ok, "unit": "peat_slinger"}]), 409, "units_unavailable")
    err(deploy(att, rid, [ok] * (STARTER_ARMY + 1)), 409, "units_unavailable")
    assert att.api.get(f"/api/raids/{rid}").json()["deploys"] == []
    r = deploy(att, rid, [ok, {**ok, "tick": 9, "x": 39, "y": 39}])
    assert r.status_code == 200 and r.json()["state"] == "deploying" and len(r.json()["deploys"]) == 2
    field(deploy(att, rid, [{**ok, "tick": 8}]), "deploys[0].tick", "Use a tick from 0 to 1,799, never earlier than the one before.")


def test_idempotent_raid_requests(app_url, mail):
    att, dfn, d2 = users(app_url, mail, 3)
    k = idempotency_key()
    r1, r2 = lock(att, dfn, k), lock(att, dfn, k)
    assert r1.status_code == r2.status_code == 201 and r1.json() == r2.json() and r2.headers.get("Idempotent-Replayed") == "true"
    err(lock(att, d2, k), 409, "idempotency_key_reused")
    field(att.api.post("/api/raids", {"villageId": d2.vid}), "Idempotency-Key", "Send an Idempotency-Key of 8 to 64 letters, digits, hyphens or underscores.")
    rid = r1.json()["id"]
    assert len([x for x in att.api.get("/api/raids", role="attack").json()["raids"] if x["opponent"]["villageId"] == dfn.vid]) == 1
    ds = [{"tick": 0, "unit": "saltjack", "x": 0, "y": 19}]
    kd = idempotency_key()
    a, b = deploy(att, rid, ds, kd), deploy(att, rid, ds, kd)
    assert a.json() == b.json() and len(b.json()["deploys"]) == 1
    err(deploy(att, rid, ds + ds, kd), 409, "idempotency_key_reused")
    kf = idempotency_key()
    f1 = finalize(att, rid, kf)
    after = amounts(vil(att)), amounts(vil(dfn))
    f2 = finalize(att, rid, kf)
    assert f1.status_code == f2.status_code == 200 and f1.json() == f2.json() and f2.headers.get("Idempotent-Replayed") == "true"
    assert (amounts(vil(att)), amounts(vil(dfn))) == after
    assert len([e for e in ledger(att) if e["kind"] == "raid_deploy" and e["raidId"] == rid]) == 1


def test_wf_scout_and_raid_feedback(browser, app_url, mail):
    att, d1, d2, rival = users(app_url, mail, 4)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, att)
        page.goto(f"{app_url}/scout/{d1.vid}")
        report = page.get_by_role("complementary", name="Scout report")
        expect(report.get_by_role("heading", name=d1.name)).to_be_visible(timeout=UI_MS)
        with held(page, "**/api/scout/next*") as hold:
            click(report.get_by_role("button", name="Next island"))
            notice(page, "Searching the tide for an island…")
            hold.release()
        watch(page, lambda p: "No island is in reach right now. Try again in a minute." in body(p)
              or p.get_by_role("complementary", name="Scout report").is_visible(), UI_S, "next island result")
        page.goto(f"{app_url}/scout/{d1.vid}")
        expect(report.get_by_role("heading", name=d1.name)).to_be_visible(timeout=UI_MS)
        assert lock(rival, d1).status_code == 201
        click(report.get_by_role("button", name="Start raid"))
        alert(page, "Another raider got there first.")
        page.goto(f"{app_url}/scout/{d2.vid}")
        expect(report.get_by_role("heading", name=d2.name)).to_be_visible(timeout=UI_MS)
        with held(page, "**/api/raids") as hold:
            click(report.get_by_role("button", name="Start raid"))
            notice(page, "Locking the island…")
            hold.release()
        notice(page, "Island locked. Deploy before the finalize countdown runs out.")
        expect(page).to_have_url(re.compile(r"/raids/\d+$"), timeout=UI_MS)
        rid = int(re.search(r"/raids/(\d+)", page.url).group(1))
        failed = []

        def flaky(route):
            if not failed:
                failed.append(1)
                route.abort()
            else:
                route.continue_()
        page.route("**/api/raids/*/deploys", flaky)
        view = island(page)
        ring_ready(page, view)
        page.keyboard.press("Space")
        alert(page, "Deploys didn't reach the tide. Retrying…")
        watch(page, lambda p: len(att.api.get(f"/api/raids/{rid}").json()["deploys"]) == 1, UI_S, "retried deploy")
    assert att.api.get(f"/api/raids/{rid}").json()["state"] == "deploying"


def test_wf_scout_and_raid_journey(browser, app_url, mail):
    att, dfn = users(app_url, mail, 2)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, att)
        page.goto(f"{app_url}/scout/{dfn.vid}")
        report = page.get_by_role("complementary", name="Scout report")
        expect(report).to_contain_text("League Mudflat", timeout=UI_MS)
        expect(report.get_by_role("list", name="Lootable")).to_contain_text(f"{STARTER['brine'] * LOOT_PCT // 100} brine")
        click(report.get_by_role("button", name="Start raid"))
        expect(page).to_have_url(re.compile(r"/raids/\d+$"), timeout=UI_MS)
        rid = int(re.search(r"/raids/(\d+)", page.url).group(1))
        expect(page.get_by_role("timer", name="Raid clock")).to_be_visible()
        expect(page.get_by_role("radio", name=f"Saltjack ({STARTER_ARMY} left)")).to_be_visible()
        view = island(page)
        view.focus()
        page.keyboard.press("1")
        page.keyboard.press("ArrowRight")
        for _ in range(3):
            page.keyboard.press("Space")
        expect(page.get_by_role("radio", name=f"Saltjack ({STARTER_ARMY - 3} left)")).to_be_visible(timeout=UI_MS)
        click(page.get_by_role("button", name="End raid"))
        result = page.get_by_role("complementary", name="Raid result")
        expect(result).to_be_visible(timeout=UI_MS)
        raid = att.api.get(f"/api/raids/{rid}").json()
        assert raid["state"] == "resolved" and len(raid["deploys"]) == 3
        assert all(min(d["x"], d["y"]) < 2 or max(d["x"], d["y"]) > 37 for d in raid["deploys"])
        res = raid["result"]
        expect(result).to_contain_text(f"{res['stars']} stars")
        expect(result).to_contain_text(f"{res['destruction']}% destroyed")
        expect(result).to_contain_text(re.compile(r"Trophies [+\-−]?" + str(abs(res["trophies"]["attacker"]))))
        click(result.get_by_role("link", name="Open replay"))
        expect(page).to_have_url(re.compile(rf"/raids/{rid}/replay"), timeout=UI_MS)


def test_finalize_deadline(mail):
    base = url("APP_SHORT_URL")
    att, dfn, other = users(base, mail, 3)
    rid = lock(att, dfn).json()["id"]
    assert deploy(att, rid, [{"tick": 0, "unit": "saltjack", "x": 0, "y": 19}]).status_code == 200
    before = amounts(vil(att)), amounts(vil(dfn))
    r = poll(lambda: (lambda x: x if x["state"] == "abandoned" else None)(att.api.get(f"/api/raids/{rid}").json()),
             SHORT_FINALIZE_S * 3, "abandonment")
    assert r["endReason"] == "deadline_passed" and r["result"] is None
    err(finalize(att, rid), 409, "raid_abandoned")
    va, vd = vil(att), vil(dfn)
    assert (amounts(va), amounts(vd)) == before and va["army"]["units"]["saltjack"] == STARTER_ARMY
    assert va["trophies"] == vd["trophies"] == 0 and vd["shield"] is None and vd["underAttack"] is False
    assert lock(other, dfn).status_code == 201


def test_deterministic_battle(app_url, mail):
    att, dfn = users(app_url, mail, 2)
    raid = run_raid(att, dfn)
    frames = simulate(raid["layout"], raid["deploys"], raid["seed"], raid["result"]["lootable"])
    res = raid["result"]
    assert res["finalTick"] == len(frames) - 1
    assert (res["destruction"], res["stars"], res["loot"]) == (frames[-1]["destruction"], frames[-1]["stars"], frames[-1]["loot"])
    for reader in (att, dfn):
        stored = reader.api.get(f"/api/raids/{raid['id']}").json()
        assert stored["result"] == res and stored["seed"] == raid["seed"] and stored["deploys"] == raid["deploys"]
        assert stored["layout"] == raid["layout"]


def test_raid_snapshots(app_url, mail):
    att, dfn, other = users(app_url, mail, 3)
    raid = run_raid(att, dfn)
    frames = simulate(raid["layout"], raid["deploys"], raid["seed"], raid["result"]["lootable"])
    res, final = raid["result"], len(frames) - 1
    assert res["finalTick"] == final
    for t in sorted({0, 1, final // 4, final // 2, final - 1, final}):
        s = snap(att if t % 2 else dfn, raid["id"], t)
        f = frames[t]
        assert (s["tick"], s["finalTick"], s["destruction"], s["stars"], s["loot"], s["hash"]) == (t, final, f["destruction"], f["stars"], f["loot"], f["hash"]), t
        assert [b["hp"] for b in sorted(s["buildings"], key=lambda b: b["index"])] == f["hps"]
        assert all(b["destroyed"] == (b["hp"] == 0) for b in s["buildings"])
    field(att.api.get(f"/api/raids/{raid['id']}/snapshot", tick=final + 1), "tick", "Use a tick from 0 to the raid's final tick.")
    missing = err(att.api.get(f"/api/raids/{raid['id']}/snapshot"), 422, "validation_failed")
    assert missing["errors"].get("tick") in ("Use a tick from 0 to the raid's final tick.", "This field is required."), missing
    err(other.api.get(f"/api/raids/{raid['id']}/snapshot", tick=0), 404, "not_found")
    assert ops(app_url).get(f"/api/raids/{raid['id']}/snapshot", tick=final).json()["hash"] == frames[-1]["hash"]
    locked = lock(other, att)
    assert locked.status_code == 201, locked.text
    open_raid = locked.json()
    err(att.api.get(f"/api/raids/{open_raid['id']}/snapshot", tick=RAID_TICKS * 2), 409, "raid_not_resolved")


def test_loot_at_resolution(app_url, mail):
    a1, d1, a2, d2 = users(app_url, mail, 4)
    r = lock(a1, d1).json()
    assert r["lootable"]["brine"] == STARTER["brine"] * LOOT_PCT // 100
    deploy(a1, r["id"], plan(r)[0])
    assert d1.api.post("/api/village/buildings", {"type": "peat_rick", "x": 30, "y": 4, "rotation": 0}).status_code == 201
    raid = finalize(a1, r["id"]).json()
    assert raid["result"]["lootable"] == {"brine": (STARTER["brine"] - 300) * LOOT_PCT // 100, "peat": STARTER["peat"] * LOOT_PCT // 100, "copper": STARTER["copper"] * LOOT_PCT // 100}
    tr = raid["result"]["transferred"]
    assert amounts(vil(d1)) == {"brine": STARTER["brine"] - 300 - tr["brine"], "peat": STARTER["peat"] - tr["peat"], "copper": STARTER["copper"] - tr["copper"]}
    aloot = {e["asset"]: e for e in ledger(a1) if e["kind"] == "raid_loot" and e["raidId"] == r["id"]}
    dloot = {e["asset"]: e for e in ledger(d1) if e["kind"] == "raid_loot" and e["raidId"] == r["id"]}
    for k in ASSETS:
        assert tr[k] == min(raid["result"]["loot"][k], BASE_CAP[k] - STARTER[k]) or tr[k] <= raid["result"]["loot"][k]
        if tr[k]:
            assert aloot[k]["amount"] == tr[k] == -dloot[k]["amount"] and aloot[k]["pairId"] == dloot[k]["pairId"]
    r2 = lock(a2, d2).json()
    deploy(a2, r2["id"], plan(r2)[0])
    fin, spend = together([lambda: finalize(a2, r2["id"]),
                           lambda: d2.api.post("/api/village/buildings", {"type": "peat_rick", "x": 30, "y": 4, "rotation": 0})])
    res = fin.json()["result"]
    spent = 300 if spend.status_code == 201 else 0
    if spend.status_code != 201:
        err(spend, 409, "insufficient_resources")
    assert res["lootable"]["brine"] in (STARTER["brine"] * LOOT_PCT // 100, (STARTER["brine"] - spent) * LOOT_PCT // 100)
    assert amounts(vil(d2))["brine"] == STARTER["brine"] - spent - res["transferred"]["brine"] >= 0


def test_trophies_leagues_star_bonus(app_url, mail):
    zone = "Asia/Kolkata"
    att = new_user(app_url, mail, tz=zone)
    dfn = new_user(app_url, mail)
    raid = run_raid(att, dfn)
    res = raid["result"]
    gain = res["destruction"] // 4 if res["stars"] else -3
    dloss = -(gain // 2) if res["stars"] else 3
    assert res["trophies"] == {"attacker": max(0, gain), "defender": max(dloss, 0) if dloss > 0 else 0}
    ma, md = att.api.get("/api/me").json(), dfn.api.get("/api/me").json()
    assert ma["trophies"] == res["trophies"]["attacker"] and md["trophies"] == res["trophies"]["defender"]
    assert ma["league"] == md["league"] == "Mudflat"
    rw = att.api.get("/api/me/rewards").json()
    assert rw["starBonus"]["cap"] == STAR_CAP and rw["starBonus"]["used"] == (1 if res["stars"] else 0)
    assert ms(rw["starBonus"]["periodEnd"]) == periods(zone, ms(rw["serverTime"]))[0][1]
    bonus = [e for e in ledger(att) if e["kind"] == "star_bonus"]
    assert sum(e["amount"] for e in bonus) <= 100 * res["stars"] and (bool(bonus) or not res["stars"] or amounts(vil(att))["brine"] == BASE_CAP["brine"])


def test_shield_and_cooldown(mail):
    base = url("APP_SHORT_URL")
    att, dfn, d2, third = users(base, mail, 4)
    assert att.api.post("/api/army/train", {"unit": "saltjack", "count": HOUSING_L1 - STARTER_ARMY}).status_code == 201
    poll(lambda: vil(att)["army"]["units"]["saltjack"] == HOUSING_L1, JOB_WAIT_S, "army trained")
    r = lock(att, dfn).json()
    ds, predicted = plan(r)
    assert predicted >= 2, "no two-star plan for the starter island"
    deploy(att, r["id"], ds)
    raid = finalize(att, r["id"]).json()
    assert raid["result"]["stars"] >= 2
    shield = vil(dfn)["shield"]
    assert ms(shield["endsAt"]) == ms(raid["resolvedAt"]) + SHORT_SHIELD_S * 1000
    err(third.api.get(f"/api/villages/{dfn.vid}/scout"), 409, "village_shielded")
    err(lock(third, dfn), 409, "village_shielded")
    weak = run_raid(third, d2, [{"tick": 0, "unit": "saltjack", "x": 0, "y": 0}])
    assert weak["result"]["stars"] == 0 and vil(d2)["shield"] is None
    err(third.api.get(f"/api/villages/{d2.vid}/scout"), 409, "target_cooldown")
    err(lock(third, d2), 409, "target_cooldown")
    assert att.api.get(f"/api/villages/{d2.vid}/scout").status_code == 200
    poll(lambda: ms(vil(third)["serverTime"]) >= ms(weak["resolvedAt"]) + SHORT_SHIELD_S * 1000, SHORT_SHIELD_S * 3, "cooldown end")
    assert third.api.get(f"/api/villages/{d2.vid}/scout").status_code == 200
    poll(lambda: ms(vil(third)["serverTime"]) >= ms(shield["endsAt"]), SHORT_SHIELD_S * 3, "shield end")
    assert lock(d2, dfn).status_code == 201


def test_wf_raid_resolution_defender_screen(browser, app_url, mail):
    att, dfn = users(app_url, mail, 2)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, dfn)
        island(page)
        click(page.get_by_role("link", name="Raid log"))
        log = page.get_by_role("complementary", name="Raid log")
        click(log.get_by_role("tab", name="Defences"))
        r = lock(att, dfn).json()
        notice(page, "Your island is under attack.", LIVE_S)
        deploy(att, r["id"], plan(r)[0])
        raid = finalize(att, r["id"]).json()
        res = raid["result"]
        notice(page, f"Your island was raided: {res['stars']} stars, {res['destruction']}% destroyed.", LIVE_S)
        v = vil(dfn)
        for t in top(v):
            watch(page, shows(t), LIVE_S, t)
        if v["shield"]:
            watch(page, shows(f"Shielded until {hhmm(ms(v['shield']['endsAt']), 'UTC')}"), LIVE_S, "shield")
        replay = log.get_by_role("button", name=f"Replay raid by {att.name}")
        expect(replay).to_be_visible(timeout=LIVE_S * 1000)
        expect(log).to_contain_text(f"{res['stars']} stars · {res['destruction']}%")
    rows = dfn.api.get("/api/raids", role="defence").json()["raids"]
    assert any(x["id"] == r["id"] and x["state"] == "resolved" and x["opponent"]["villageId"] == att.vid for x in rows)


def test_wf_raid_resolution_raid_log(browser, app_url, mail):
    att, dfn = users(app_url, mail, 2)
    raid = run_raid(att, dfn)
    res = raid["result"]
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, dfn)
        island(page)
        click(page.get_by_role("link", name="Raid log"))
        panel = page.get_by_role("complementary", name="Raid log")
        click(panel.get_by_role("tab", name="Defences"))
        expect(panel).to_contain_text(f"{res['stars']} stars · {res['destruction']}%", timeout=UI_MS)
        click(panel.get_by_role("button", name=f"Replay raid by {att.name}"))
        expect(page).to_have_url(re.compile(rf"/raids/{raid['id']}/replay"), timeout=UI_MS)
        expect(island(page)).to_have_attribute("data-view", "replay", timeout=UI_MS)
        expect(page.get_by_role("slider", name="Wake dial")).to_have_attribute("aria-valuemax", str(res["finalTick"]), timeout=UI_MS)
    listed = dfn.api.get("/api/raids", role="defence").json()["raids"]
    assert any(x["id"] == raid["id"] and x["stars"] == res["stars"] for x in listed)


def test_wf_raid_resolution_feedback(browser, mail):
    base = url("APP_SHORT_URL")
    att, d1, d2 = users(base, mail, 3)
    with open_app(browser, base + "/signin") as page:
        ui_in(page, att)
        for dfn in (d1, d2):
            page.goto(f"{base}/scout/{dfn.vid}")
            click(page.get_by_role("complementary", name="Scout report").get_by_role("button", name="Start raid"))
            expect(page).to_have_url(re.compile(r"/raids/\d+$"), timeout=UI_MS)
            rid = int(re.search(r"/raids/(\d+)", page.url).group(1))
            view = island(page)
            ring_ready(page, view)
            page.keyboard.press("Space")
            if dfn is d1:
                with held(page, "**/finalize") as hold:
                    click(page.get_by_role("button", name="End raid"))
                    notice(page, "Resolving the raid on the server…")
                    hold.release()
                res = poll(lambda: att.api.get(f"/api/raids/{rid}").json()["result"], UI_S, "raid resolved")
                notice(page, f"Raid resolved: {res['stars']} stars, {res['destruction']}% destroyed.")
            else:
                watch(page, lambda p: len(att.api.get(f"/api/raids/{rid}").json()["deploys"]) == 1, UI_S, "deploy stored")
                t0 = time.monotonic()
                poll(lambda: time.monotonic() > t0 + SHORT_FINALIZE_S + 1, SHORT_FINALIZE_S * 3, "finalize window")
                click(page.get_by_role("button", name="End raid"))
                alert(page, "The finalize window closed. The raid was abandoned and nothing moved.")
        with held(page, "**/api/raids?*") as hold:
            click(page.get_by_role("link", name="Raid log"))
            notice(page, "Loading raids…")
            hold.release()
        expect(page.get_by_role("complementary", name="Raid log")).to_contain_text("Abandoned · ", timeout=UI_MS)
    assert att.api.get(f"/api/raids/{rid}").json()["endReason"] == "deadline_passed"


@pytest.fixture
def replay_raid(app_url, mail):
    att, dfn = users(app_url, mail, 2)
    raid = run_raid(att, dfn, REPLAY_DEPLOYS)
    return att, raid, raid["result"]["finalTick"]


def assert_tick(view, u, rid, t):
    expect(view).to_have_attribute("data-tick", str(t), timeout=UI_MS)
    expect(view).to_have_attribute("data-settled", "true", timeout=UI_MS)
    s = snap(u, rid, t)
    for attr, val in (("data-state-hash", s["hash"]), ("data-destruction", s["destruction"]), ("data-stars", s["stars"]),
                      ("data-loot-brine", s["loot"]["brine"]), ("data-loot-peat", s["loot"]["peat"]),
                      ("data-loot-copper", s["loot"]["copper"]), ("data-drawn-tick", t)):
        expect(view).to_have_attribute(attr, str(val))
    return s


def dial_path(page, slider):
    boxes = """() => [...document.querySelectorAll('body *')].map(el => { const r = el.getBoundingClientRect();
        return r.width > 0 && r.width <= 60 && r.height > 0 && r.height <= 60 ? [r.x + r.width / 2, r.y + r.height / 2] : null; })"""
    pts, seen = [], []
    slider.focus()
    for keys in ((("Home", 1),), (("PageUp", 4), ("ArrowRight", 5)), (("PageUp", 4), ("ArrowRight", 5))):
        for key, n in keys:
            for _ in range(n):
                page.keyboard.press(key)
        advance(page, 300)
        b = slider.bounding_box()
        pts.append((b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, b))
        seen.append(page.evaluate(boxes))
    page.keyboard.press("Home")
    advance(page, 300)
    (x0, y0, box), (x1, y1, _), (x2, y2, _) = pts
    if math.dist((x0, y0), (x2, y2)) < 2:
        moving = [(a, b, c) for a, b, c in zip(*seen) if a and b and c and math.dist(a, b) > 2 and math.dist(b, c) > 2
                  and abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 4]
        if moving:
            (x0, y0), (x1, y1), (x2, y2) = moving[0]
        else:
            ring = slider.evaluate("""el => { for (let n = el; n; n = n.parentElement) { const r = n.getBoundingClientRect();
                if (r.width >= 120 && r.height >= 120) return {x: r.x, y: r.y, width: r.width, height: r.height}; } return null; }""") or box
            cx, cy, rad = ring["x"] + ring["width"] / 2, ring["y"] + ring["height"] / 2, min(ring["width"], ring["height"]) * 0.42
            return lambda d: (cx + rad * math.sin(math.radians(d)), cy - rad * math.cos(math.radians(d)))
    det = 2 * (x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1))
    cx = ((x0 ** 2 + y0 ** 2) * (y1 - y2) + (x1 ** 2 + y1 ** 2) * (y2 - y0) + (x2 ** 2 + y2 ** 2) * (y0 - y1)) / det
    cy = ((x0 ** 2 + y0 ** 2) * (x2 - x1) + (x1 ** 2 + y1 ** 2) * (x0 - x2) + (x2 ** 2 + y2 ** 2) * (x1 - x0)) / det
    rad, a0 = math.dist((cx, cy), (x0, y0)), math.atan2(y0 - cy, x0 - cx)
    turn = 1 if math.atan2(y1 - cy, x1 - cx) - a0 > 0 or math.atan2(y1 - cy, x1 - cx) - a0 < -math.pi else -1
    return lambda d: (cx + rad * math.cos(a0 + turn * math.radians(d)), cy + rad * math.sin(a0 + turn * math.radians(d)))


def test_wake_dial_drag(browser, app_url, replay_raid):
    att, raid, final = replay_raid
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, att)
        page.goto(f"{app_url}/raids/{raid['id']}/replay")
        view = island(page)
        assert_tick(view, att, raid["id"], 0)
        at_deg = dial_path(page, page.get_by_role("slider", name="Wake dial"))
        assert_tick(view, att, raid["id"], 0)
        view.evaluate("el => { window.__drawn = []; new MutationObserver(() => window.__drawn.push([el.dataset.drawnTick, el.dataset.settled, el.dataset.tick])).observe(el, {attributes: true}); }")
        page.mouse.move(*at_deg(0))
        page.mouse.down()
        for d in list(range(5, 86, 5)) + list(range(86, 91)):
            t0 = time.monotonic()
            page.mouse.move(*at_deg(d))
            advance(page, 100)
            poll(lambda: time.monotonic() >= t0 + 0.1, 2, "real time in step")
        t0 = time.monotonic()
        advance(page, 300)
        poll(lambda: time.monotonic() >= t0 + 0.3, 2, "real time in step")
        page.mouse.up()
        for _ in range(10):
            advance(page, 100)
        t = int(view.get_attribute("data-tick"))
        assert abs(t - 90) <= DIAL_SLOW_TOLERANCE
        assert_tick(view, att, raid["id"], t)
        drawn = {int(x[0]) for x in page.evaluate("window.__drawn") if x[0] is not None}
        assert {10, 20, 30, 40, 50, 60, 70, 80} <= drawn


def test_wake_dial_fling(browser, app_url, replay_raid):
    att, raid, final = replay_raid
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, att)
        page.goto(f"{app_url}/raids/{raid['id']}/replay")
        view = island(page)
        assert_tick(view, att, raid["id"], 0)
        view.evaluate("el => { window.__drawn = []; new MutationObserver(() => window.__drawn.push([el.dataset.drawnTick, el.dataset.settled, el.dataset.tick])).observe(el, {attributes: true}); }")
        ring_box = page.get_by_role("slider", name="Wake dial").bounding_box()
        cx, cy = ring_box["x"] + ring_box["width"] / 2, ring_box["y"] + ring_box["height"] / 2
        rad = min(ring_box["width"], ring_box["height"]) * 0.42
        at_deg = lambda d: (cx + rad * math.sin(math.radians(d)), cy - rad * math.cos(math.radians(d)))
        t = 0
        page.mouse.move(*at_deg(t))
        page.mouse.down()
        for d in (t + 30, t + 60, t + 90):
            page.mouse.move(*at_deg(d))
            advance(page, 16)
        page.mouse.up()
        elapsed, moving_seen = 0, False
        while view.get_attribute("data-settled") != "true" or elapsed == 0:
            moving_seen |= view.get_attribute("data-settled") == "false"
            advance(page, 100)
            elapsed += 100
            assert elapsed <= FLING_SETTLE_MS, "fling did not settle in time"
        t2 = int(view.get_attribute("data-tick"))
        assert t + 90 < t2 <= final
        assert_tick(view, att, raid["id"], t2)
        for d, settled, tick in page.evaluate("window.__drawn"):
            if settled == "true":
                assert d == tick and re.fullmatch(r"\d+", tick)


def test_wake_dial_keyboard(browser, app_url, replay_raid):
    att, raid, final = replay_raid
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, att)
        page.goto(f"{app_url}/raids/{raid['id']}/replay")
        view = island(page)
        dial = page.get_by_role("slider", name="Wake dial")
        dial.focus()
        for key, t in (("ArrowRight", 1), ("ArrowUp", 2), ("ArrowLeft", 1), ("ArrowDown", 0), ("PageUp", 10),
                       ("PageUp", 20), ("PageDown", 10), ("End", final), ("Home", 0)):
            page.keyboard.press(key)
            assert_tick(view, att, raid["id"], t)
            expect(dial).to_have_attribute("aria-valuenow", str(t))
            expect(dial).to_have_attribute("aria-valuetext", f"Tick {t} of {final}")


def test_wake_dial_reduced_motion(browser, app_url, replay_raid):
    att, raid, final = replay_raid
    with open_app(browser, app_url + "/signin", reduced_motion="reduce") as page:
        ui_in(page, att)
        page.goto(f"{app_url}/raids/{raid['id']}/replay")
        view = island(page)
        tick_box = page.get_by_role("spinbutton", name="Tick")
        fill(tick_box, "42")
        tick_box.press("Enter")
        assert_tick(view, att, raid["id"], 42)
        for name, t in (("Next tick", 43), ("Forward 10 ticks", 53), ("Back 10 ticks", 43), ("Previous tick", 42)):
            click(page.get_by_role("button", name=name))
            assert_tick(view, att, raid["id"], t)
            expect(view).to_have_attribute("data-animating", "false")
        fill(tick_box, str(final + 500))
        tick_box.press("Enter")
        assert_tick(view, att, raid["id"], final)


def test_wf_wake_dial_feedback(browser, app_url, mail, replay_raid):
    att, raid, final = replay_raid
    pending = lock(att, new_user(app_url, mail)).json()
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, att)
        with held(page, "**/api/raids/**") as hold:
            page.goto(f"{app_url}/raids/{raid['id']}/replay")
            notice(page, "Loading replay…")
            hold.release()
        notice(page, f"Replay ready: {final} ticks.")
        page.goto(f"{app_url}/raids/{pending['id']}/replay")
        alert(page, "This raid has no replay yet.")
        page.goto(f"{app_url}/raids/{ID_MAX}/replay")
        alert(page, "We couldn't find that. It may have moved, or it isn't yours to see.")


def test_wf_wake_dial_journey(browser, app_url, replay_raid):
    att, raid, final = replay_raid
    fall = fall_tick(att, raid["id"], final)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, att)
        page.goto(f"{app_url}/raids/{raid['id']}/replay?tick={fall - 1}")
        view = island(page)
        readout = page.get_by_role("group", name="Tick readout")
        s0 = assert_tick(view, att, raid["id"], fall - 1)
        expect(readout).to_contain_text(f"{s0['destruction']}%")
        page.get_by_role("slider", name="Wake dial").focus()
        page.keyboard.press("ArrowRight")
        s1 = assert_tick(view, att, raid["id"], fall)
        assert s1["destruction"] > s0["destruction"] and any(b["destroyed"] for b in s1["buildings"])
        watch(page, lambda p: f"{s1['destruction']}%" in readout.inner_text(), UI_S, "readout after fall")
        expect(readout).to_contain_text(f"{s1['stars']} stars")
        page.keyboard.press("ArrowLeft")
        assert_tick(view, att, raid["id"], fall - 1)
        watch(page, lambda p: f"{s0['destruction']}%" in readout.inner_text(), UI_S, "readout restored")


def test_daily_chest_streak(app_url, mail):
    zone = "Pacific/Kiritimati"
    u = new_user(app_url, mail, tz=zone)
    rw = u.api.get("/api/me/rewards").json()
    assert rw["daily"]["claimed"] is False and rw["daily"]["streak"] == 0 and rw["daily"]["chest"] == CHEST[1]
    day = periods(zone, ms(rw["serverTime"]))[0]
    assert (ms(rw["daily"]["periodStart"]), ms(rw["daily"]["periodEnd"])) == day
    rs = together([lambda: u.api.post("/api/me/rewards/daily") for _ in range(4)])
    ok = [r for r in rs if r.status_code == 200]
    assert len(ok) == 1
    b = ok[0].json()
    assert b["credited"] == CHEST[1] and b["streak"] == 1 and ms(b["nextClaimAt"]) == day[1]
    for r in rs:
        if r.status_code != 200:
            assert ms(err(r, 409, "already_claimed")["nextClaimAt"]) == day[1]
    rw = u.api.get("/api/me/rewards").json()
    assert rw["daily"]["claimed"] is True and rw["daily"]["streak"] == 1 and rw["daily"]["chest"] == CHEST[2]
    assert ms(rw["daily"]["streakEndsAt"]) == periods(zone, day[1])[0][1]
    assert amounts(vil(u)) == {"brine": STARTER["brine"] + 300, "peat": STARTER["peat"] + 300, "copper": STARTER["copper"]}
    assert len([e for e in ledger(u) if e["kind"] == "daily_chest"]) == 2


CLOCKS = {"havana": ("APP_CLOCK_HAVANA_URL", "America/Havana"),
          "santiago": ("APP_CLOCK_SANTIAGO_URL", "America/Santiago"),
          "kathmandu": ("APP_CLOCK_KATHMANDU_URL", "Asia/Kathmandu"),
          "lisbon": ("APP_CLOCK_LISBON_URL", "Europe/Lisbon"),
          "yearend": ("APP_CLOCK_YEAREND_URL", "Pacific/Kiritimati")}


@pytest.mark.parametrize("copy", list(CLOCKS), ids=list(CLOCKS))
def test_local_periods_on_clock_copies(mail, copy):
    env, zone = CLOCKS[copy]
    base = url(env)
    u = new_user(base, mail, tz=zone)
    rw = u.api.get("/api/me/rewards").json()
    day, week = periods(zone, ms(rw["serverTime"]))
    assert (ms(rw["daily"]["periodStart"]), ms(rw["daily"]["periodEnd"])) == day
    assert (ms(rw["weekly"]["periodStart"]), ms(rw["weekly"]["periodEnd"])) == week
    assert local_date(week[0], zone).weekday() == 0
    r = u.api.post("/api/me/rewards/weekly")
    assert r.status_code == 200 and r.json()["league"] == "Mudflat"
    assert {k: r.json()["credited"][k] + r.json()["lost"][k] for k in ASSETS} == BONUS_MUDFLAT
    assert ms(r.json()["nextClaimAt"]) == week[1]
    assert ms(err(u.api.post("/api/me/rewards/weekly"), 409, "already_claimed")["nextClaimAt"]) == week[1]
    d = u.api.post("/api/me/rewards/daily")
    assert d.status_code == 200 and ms(d.json()["nextClaimAt"]) == day[1]
    for kind, edge in (("daily", day[1]), ("weekly", week[1])):
        if edge - ms(u.api.get("/api/me/rewards").json()["serverTime"]) <= 120 * 1000:
            poll(lambda: u.api.get("/api/me/rewards").json()[kind]["claimed"] is False, 180, f"{kind} reopen")
            again = u.api.post(f"/api/me/rewards/{kind}")
            assert again.status_code == 200 and (kind == "weekly" or again.json()["streak"] == 2)


def test_time_zone_change_reward_clocks(app_url, mail):
    u = new_user(app_url, mail)
    t0 = ms(u.api.get("/api/me/rewards").json()["serverTime"])
    assert u.api.post("/api/me/rewards/daily").status_code == 200
    assert u.api.post("/api/me/rewards/weekly").status_code == 200
    t1 = ms(u.api.get("/api/me/rewards").json()["serverTime"])
    zone = "Pacific/Kiritimati"
    me = u.api.patch("/api/me", {"timeZone": zone})
    assert me.status_code == 200 and me.json()["timeZone"] == zone

    def nxt_day(t):
        d = local_date(t, zone)
        return max(day_start(zone, d + timedelta(days=1)), t + DAILY_REOPEN_MS)

    def nxt_week(t):
        d = local_date(t, zone)
        return max(day_start(zone, d - timedelta(days=d.weekday()) + timedelta(days=7)), t + WEEKLY_REOPEN_MS)
    rw = u.api.get("/api/me/rewards").json()
    assert rw["daily"]["claimed"] is True and nxt_day(t0) <= ms(rw["daily"]["nextClaimAt"]) <= nxt_day(t1)
    assert rw["weekly"]["claimed"] is True and nxt_week(t0) <= ms(rw["weekly"]["nextClaimAt"]) <= nxt_week(t1)
    assert err(u.api.post("/api/me/rewards/daily"), 409, "already_claimed")["nextClaimAt"] == rw["daily"]["nextClaimAt"]
    assert err(u.api.post("/api/me/rewards/weekly"), 409, "already_claimed")["nextClaimAt"] == rw["weekly"]["nextClaimAt"]


def test_wf_rewards_tz_live(browser, app_url, mail):
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        click(page.get_by_role("link", name="Rewards"))
        panel = page.get_by_role("complementary", name="Rewards")
        expect(panel).to_contain_text("Chest ready to open", timeout=UI_MS)
        with held(page, "**/api/me/rewards/daily") as hold:
            click(panel.get_by_role("button", name="Open daily chest"))
            notice(page, "Opening…")
            hold.release()
        notice(page, "Daily chest opened (day 1 of 7): 300 brine, 300 peat.")
        with held(page, "**/api/me/rewards/weekly") as hold:
            click(panel.get_by_role("button", name="Claim league bonus"))
            notice(page, "Claiming…")
            hold.release()
        rw = u.api.get("/api/me/rewards").json()
        nxt = ms(rw["daily"]["nextClaimAt"])
        watch(page, lambda p: bool(re.search("Next chest " + ldt(nxt, "UTC"), panel.inner_text())), UI_S, "next chest shown")
        chest = panel.get_by_role("button", name="Open daily chest")
        if chest.is_enabled():
            click(chest)
            alert(page, re.compile("Next chest at " + ldt(nxt, "UTC") + r"\."))
        zone = "Asia/Kolkata"
        assert u.api.patch("/api/me", {"timeZone": zone}).status_code == 200
        rw = u.api.get("/api/me/rewards").json()
        watch(page, shows(re.compile("Next chest " + ldt(ms(rw["daily"]["nextClaimAt"]), zone))), LIVE_S, "chest time in new zone")
        watch(page, shows(re.compile("Next league bonus " + ldt(ms(rw["weekly"]["nextClaimAt"]), zone))), LIVE_S, "bonus time in new zone")


def test_wf_rewards_journey(browser, app_url, mail):
    u = new_user(app_url, mail)
    assert u.api.post("/api/village/buildings", {"type": "copper_vault", "x": 30, "y": 4, "rotation": 0}).status_code == 201
    brine, peat = STARTER["brine"] - VAULT_COST, STARTER["peat"] - VAULT_COST
    chest, bonus = CHEST[1], BONUS_MUDFLAT
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        watch(page, shows(rule("brine", brine, BASE_CAP["brine"])), UI_S)
        click(page.get_by_role("link", name="Rewards"))
        panel = page.get_by_role("complementary", name="Rewards")
        expect(panel).to_contain_text(f"Next chest holds {chest['brine']} brine, {chest['peat']} peat", timeout=UI_MS)
        click(panel.get_by_role("button", name="Open daily chest"))
        notice(page, f"Daily chest opened (day 1 of 7): {chest['brine']} brine, {chest['peat']} peat.")
        brine, peat = brine + chest["brine"], peat + chest["peat"]
        watch(page, shows(rule("brine", brine, BASE_CAP["brine"])), UI_S)
        watch(page, shows("Streak day 1 of 7"), UI_S)
        click(panel.get_by_role("button", name="Claim league bonus"))
        notice(page, re.compile(r"Mudflat league bonus claimed: 1,?000 brine, 1,?000 peat\."))
        brine, peat = brine + bonus["brine"], peat + bonus["peat"]
        watch(page, shows(rule("brine", brine, BASE_CAP["brine"])), UI_S)
        watch(page, shows(rule("peat", peat, BASE_CAP["peat"])), UI_S)
        rw = u.api.get("/api/me/rewards").json()
        expect(panel).to_contain_text(re.compile("Next chest " + ldt(ms(rw["daily"]["nextClaimAt"]), "UTC")))
        expect(panel).to_contain_text(re.compile("Next league bonus " + ldt(ms(rw["weekly"]["nextClaimAt"]), "UTC")))
    assert rw["daily"]["claimed"] and rw["weekly"]["claimed"]
    assert amounts(vil(u)) == {"brine": brine, "peat": peat, "copper": STARTER["copper"]}


def make_clan(base, mail, n):
    us = users(base, mail, n)
    name = "Clan " + uuid.uuid4().hex[:10]
    assert us[0].api.post("/api/clans", {"name": name, "motto": "Hold the sluice"}).status_code == 201
    for u in us[1:]:
        join(us[0], u, name)
    return name, us


def join(inviter, u, name):
    assert inviter.api.post("/api/clan/invitations", {"email": u.email}).status_code == 202
    inv = poll(lambda: [i for i in u.api.get("/api/me/invitations").json()["invitations"] if i["clan"]["name"] == name], 10, "invitation")
    r = u.api.post(f"/api/invitations/{inv[0]['id']}/accept")
    assert r.status_code == 200, r.text
    return inv[0]["id"]


def members(u):
    return {m["accountId"]: m for m in u.api.get("/api/clan").json()["clan"]["members"]}


def test_clan_founding_and_invitations(app_url, mail):
    name, us = make_clan(app_url, mail, 8)
    sk = us[0]
    clan = sk.api.get("/api/clan").json()["clan"]
    assert clan["myRole"] == "skipper" and clan["name"] == name
    unver = new_user(app_url, mail, verify=False)
    err(unver.api.post("/api/clans", {"name": "Clan " + uuid.uuid4().hex[:8], "motto": ""}), 403, "email_not_verified")
    x, y1, y2 = users(app_url, mail, 3)
    stranger, _ = fresh()
    subject = f"{sk.name} invited you to {name} on Saltreach"
    r1, r2 = sk.api.post("/api/clan/invitations", {"email": stranger}), sk.api.post("/api/clan/invitations", {"email": x.email})
    assert r1.status_code == r2.status_code == 202 and r1.json() == r2.json() == {"status": "invited"}
    assert sk.api.post("/api/clan/invitations", {"email": x.email}).status_code == 202
    exactly(mail, stranger, subject, 1)
    exactly(mail, x.email, subject, 2)
    invs = [i for i in x.api.get("/api/me/invitations").json()["invitations"] if i["clan"]["name"] == name]
    assert len(invs) == 1 and invs[0]["invitedBy"]["displayName"] == sk.name
    assert x.api.post(f"/api/invitations/{invs[0]['id']}/decline").status_code == 204
    err(x.api.post(f"/api/invitations/{invs[0]['id']}/accept"), 404, "not_found")
    join(sk, x, name)
    ids = []
    for y in (y1, y2):
        assert sk.api.post("/api/clan/invitations", {"email": y.email}).status_code == 202
        ids.append(poll(lambda y=y: [i for i in y.api.get("/api/me/invitations").json()["invitations"] if i["clan"]["name"] == name], 10)[0]["id"])
    rs = together([lambda: y1.api.post(f"/api/invitations/{ids[0]}/accept"), lambda: y2.api.post(f"/api/invitations/{ids[1]}/accept")])
    assert sorted(r.status_code for r in rs) == [200, 409]
    err(next(r for r in rs if r.status_code == 409), 409, "clan_full")
    assert len(members(sk)) == CLAN_MAX


def test_warden_powers(app_url, mail):
    _, (sk, mate, d1, d2) = make_clan(app_url, mail, 4)
    assert sk.api.post(f"/api/clan/members/{mate.id}/promote").json()["role"] == "mate"
    msg = d1.api.post("/api/clan/messages", {"body": "first light"}).json()
    for r in (d1.api.post(f"/api/clan/members/{d2.id}/promote"), d1.api.delete(f"/api/clan/members/{d2.id}"),
              d1.api.delete(f"/api/clan/messages/{msg['id']}"), d1.api.post("/api/clan/invitations", {"email": "a@lowtide.test"}),
              mate.api.post(f"/api/clan/members/{d1.id}/promote"), mate.api.post(f"/api/clan/members/{sk.id}/demote"),
              mate.api.delete(f"/api/clan/members/{sk.id}")):
        err(r, 403, "forbidden")
    for r in (sk.api.post(f"/api/clan/members/{sk.id}/promote"), sk.api.post(f"/api/clan/members/{d1.id}/demote"),
              sk.api.delete(f"/api/clan/members/{sk.id}")):
        err(r, 409, "invalid_role_change")
    assert mate.api.delete(f"/api/clan/members/{d2.id}").status_code == 204
    assert mate.api.delete(f"/api/clan/messages/{msg['id']}").status_code == 204
    m = members(sk)
    assert d2.id not in m and m[d1.id]["role"] == "deckhand" and m[mate.id]["role"] == "mate"
    assert sk.api.post(f"/api/clan/members/{d1.id}/promote").json()["role"] == "mate"
    assert sk.api.post(f"/api/clan/members/{d1.id}/demote").json()["role"] == "deckhand"
    assert sk.api.post(f"/api/clan/members/{mate.id}/promote").json()["role"] == "skipper"
    m = members(sk)
    assert m[sk.id]["role"] == "mate" and m[sk.id]["mateSince"] and m[mate.id]["mateSince"] is None


def test_immediate_role_changes(app_url, mail):
    name, (sk, mate, d, d2) = make_clan(app_url, mail, 4)
    x = new_user(app_url, mail)
    sk.api.post(f"/api/clan/members/{mate.id}/promote")
    assert mate.api.post("/api/clan/invitations", {"email": x.email}).status_code == 202
    inv = poll(lambda: x.api.get("/api/me/invitations").json()["invitations"], 10, "invitation")[0]
    msg = d.api.post("/api/clan/messages", {"body": "hold fast"}).json()
    assert sk.api.post(f"/api/clan/members/{mate.id}/demote").status_code == 200
    err(mate.api.delete(f"/api/clan/messages/{msg['id']}"), 403, "forbidden")
    err(x.api.post(f"/api/invitations/{inv['id']}/accept"), 404, "not_found")
    assert sk.api.delete(f"/api/clan/members/{d.id}").status_code == 204
    err(d.api.get("/api/clan/messages"), 409, "not_in_clan")
    promote, remove = together([lambda: sk.api.post(f"/api/clan/members/{d2.id}/promote"), lambda: sk.api.delete(f"/api/clan/members/{d2.id}")])
    assert remove.status_code == 204 and promote.status_code in (200, 404)
    assert d2.id not in members(sk) and d2.api.get("/api/clan").json()["clan"] is None


def test_skipper_succession(app_url, mail):
    _, (sk, d1, m1, m2) = make_clan(app_url, mail, 4)
    sk.api.post(f"/api/clan/members/{m1.id}/promote")
    sk.api.post(f"/api/clan/members/{m2.id}/promote")
    r = sk.api.post("/api/clan/leave").json()
    assert r["newSkipper"]["accountId"] == m1.id and r["disbanded"] is False and r["clan"] is None
    m = members(m1)
    assert m[m1.id]["role"] == "skipper" and m[m1.id]["mateSince"] is None and sk.id not in m
    name, (s2, da, db) = make_clan(app_url, mail, 3)
    err(new_user(app_url, mail).api.post("/api/clans", {"name": name.lower(), "motto": ""}), 409, "clan_name_taken")
    assert s2.api.post("/api/clan/leave").json()["newSkipper"]["accountId"] == da.id
    assert da.api.post("/api/clan/leave").json()["newSkipper"]["accountId"] == db.id
    last = db.api.post("/api/clan/leave").json()
    assert last["disbanded"] is True and last["newSkipper"] is None
    assert new_user(app_url, mail).api.post("/api/clans", {"name": name.upper(), "motto": ""}).status_code == 201


def test_clan_chat(app_url, mail):
    _, (sk, d) = make_clan(app_url, mail, 2)
    typed = "<b>Low</b> & \"tide\" 'mark' " + uuid.uuid4().hex[:6]
    r = d.api.post("/api/clan/messages", {"body": typed})
    assert r.status_code == 201 and r.json()["body"] == typed and r.json()["removed"] is False
    seen = [m for m in sk.api.get("/api/clan/messages").json()["messages"] if m["id"] == r.json()["id"]]
    assert seen[0]["body"] == typed and seen[0]["author"]["displayName"] == d.name
    field(d.api.post("/api/clan/messages", {"body": "x" * 501}), "body", "Write 1 to 500 characters.")
    field(d.api.post("/api/clan/messages", {"body": "   "}), "body", "Write 1 to 500 characters.")
    assert sk.api.delete(f"/api/clan/messages/{r.json()['id']}").status_code == 204
    for u in (sk, d):
        m = next(m for m in u.api.get("/api/clan/messages").json()["messages"] if m["id"] == r.json()["id"])
        assert m["removed"] is True and m["body"] is None


def test_clan_chat_throttle(app_url, mail):
    _, (sk, d) = make_clan(app_url, mail, 2)
    tag = uuid.uuid4().hex[:8]
    rs = together([lambda i=i: d.api.post("/api/clan/messages", {"body": f"{tag} {i}"}) for i in range(CHAT_LIMIT + 3)])
    assert sum(r.status_code == 201 for r in rs) == CHAT_LIMIT
    for r in rs:
        if r.status_code != 201:
            err(r, 429, "rate_limited")
            assert int(r.headers["Retry-After"]) >= 1
    stored = [m for m in sk.api.get("/api/clan/messages").json()["messages"] if (m["body"] or "").startswith(tag)]
    assert len(stored) == CHAT_LIMIT


def test_wf_clan_live(browser, app_url, mail):
    name, (sk, a, b, c) = make_clan(app_url, mail, 4)
    with open_app(browser, app_url + "/signin") as pa, open_app(browser, app_url + "/signin") as pb:
        ui_in(pa, a)
        ui_in(pb, b)
        click(pa.get_by_role("link", name="Clan"))
        click(pa.get_by_role("complementary", name="Clan").get_by_role("tab", name="Chat"))
        chat = pa.get_by_role("log", name="Clan chat")
        expect(chat).to_be_visible(timeout=UI_MS)
        typed = "<i>wake</i> " + uuid.uuid4().hex[:6]
        msg = c.api.post("/api/clan/messages", {"body": typed}).json()
        watch(pa, lambda p: typed in chat.inner_text(), LIVE_S, "new message")
        unread = 1
        watch(pb, lambda p: p.get_by_role("link", name=f"Clan ({unread} unread)").count() == 1, LIVE_S, "unread count")
        assert sk.api.delete(f"/api/clan/messages/{msg['id']}").status_code == 204
        watch(pa, lambda p: "Message removed by a warden" in chat.inner_text() and typed not in chat.inner_text(), LIVE_S, "removal")
        click(pb.get_by_role("link", name=re.compile(r"^Clan")))
        click(pb.get_by_role("complementary", name="Clan").get_by_role("tab", name="Chat"))
        expect(pb.get_by_role("link", name="Clan", exact=True)).to_be_visible(timeout=UI_MS)
        assert sk.api.delete(f"/api/clan/members/{a.id}").status_code == 204
        watch(pa, shows(f"You are no longer in {name}."), LIVE_S, "removed view")
        expect(pa.get_by_role("button", name="Found clan")).to_be_visible()


def test_clan_league_standing(app_url, mail):
    name, us = make_clan(app_url, mail, 2)
    clan = us[0].api.get("/api/clan").json()["clan"]
    assert clan["trophies"] == sum(m["trophies"] for m in clan["members"]) and clan["rank"] >= 1
    table = httpx.get(app_url + "/api/league/clans", timeout=HTTP_TIMEOUT).json()["clans"]
    assert [c["rank"] for c in table] == list(range(1, len(table) + 1))
    assert all(a["trophies"] >= b["trophies"] for a, b in zip(table, table[1:]))
    seed = next(c for c in table if c["name"] == "Brackwater Kin")
    assert seed["trophies"] == 610 + 120 and seed["memberCount"] == 2
    mine = [c for c in table if c["id"] == clan["id"]]
    assert not mine or (mine[0]["rank"] == clan["rank"] and mine[0]["memberCount"] == 2)


def test_wf_clan_journey(browser, app_url, mail):
    sk, x = users(app_url, mail, 2)
    name = "Clan " + uuid.uuid4().hex[:10]
    with open_app(browser, app_url + "/signin") as ps, open_app(browser, app_url + "/signin") as px:
        ui_in(ps, sk)
        click(ps.get_by_role("link", name="Clan"))
        panel = ps.get_by_role("complementary", name="Clan")
        fill(panel.get_by_role("textbox", name="Clan name"), name)
        fill(panel.get_by_role("textbox", name="Motto"), "Keep the flats")
        click(panel.get_by_role("button", name="Found clan"))
        expect(panel.get_by_role("heading", name=name)).to_be_visible(timeout=UI_MS)
        assert sk.api.get("/api/clan").json()["clan"]["myRole"] == "skipper"
        click(panel.get_by_role("tab", name="Members"))
        fill(panel.get_by_role("textbox", name="Invite by email"), x.email)
        click(panel.get_by_role("button", name="Send invitation"))
        exactly(mail, x.email, f"{sk.name} invited you to {name} on Saltreach", 1)
        ui_in(px, x)
        click(px.get_by_role("link", name="Clan"))
        click(px.get_by_role("complementary", name="Clan").get_by_role("button", name=f"Accept invitation to {name}"))
        table = panel.get_by_role("table", name="Roster")
        watch(ps, lambda p: x.name in table.inner_text(), UI_S, "invitee joins")
        click(panel.get_by_role("button", name=f"Promote {x.name}"))
        poll(lambda: members(sk)[x.id]["role"] == "mate", UI_S, "promoted")
        watch(ps, lambda p: "Mate" in table.inner_text(), UI_S, "mate label")
        click(panel.get_by_role("button", name=f"Demote {x.name}"))
        poll(lambda: members(sk)[x.id]["role"] == "deckhand", UI_S, "demoted")
        msg = x.api.post("/api/clan/messages", {"body": "low water at noon"}).json()
        click(panel.get_by_role("tab", name="Chat"))
        delete = panel.get_by_role("button", name=f"Delete message from {x.name}")
        watch(ps, lambda p: delete.count() > 0, UI_S, "posted message appears live")
        click(delete)
        watch(ps, lambda p: "Message removed by a warden" in panel.get_by_role("log", name="Clan chat").inner_text(), UI_S, "removal copy")
    gone = next(m for m in x.api.get("/api/clan/messages").json()["messages"] if m["id"] == msg["id"])
    assert gone["removed"] is True and gone["body"] is None
    roles = members(sk)
    assert roles[x.id]["role"] == "deckhand" and roles[sk.id]["role"] == "skipper"


def test_wf_clan_feedback(browser, app_url, mail):
    sk, x = users(app_url, mail, 2)
    name = "Clan " + uuid.uuid4().hex[:10]
    with open_app(browser, app_url + "/signin") as ps, open_app(browser, app_url + "/signin") as px:
        ui_in(ps, sk)
        click(ps.get_by_role("link", name="Clan"))
        panel = ps.get_by_role("complementary", name="Clan")
        fill(panel.get_by_role("textbox", name="Clan name"), "ab")
        click(panel.get_by_role("button", name="Found clan"))
        alert(ps, "Check the highlighted fields.")
        expect(panel.get_by_role("textbox", name="Clan name")).to_have_accessible_description("Use 3 to 24 characters.")
        fill(panel.get_by_role("textbox", name="Clan name"), name)
        fill(panel.get_by_role("textbox", name="Motto"), "Tide waits")
        with held(ps, "**/api/clans") as hold:
            click(panel.get_by_role("button", name="Found clan"))
            notice(ps, "Founding…")
            hold.release()
        notice(ps, f"{name} founded. You lead it.")
        click(panel.get_by_role("tab", name="Members"))
        fill(panel.get_by_role("textbox", name="Invite by email"), x.email)
        with held(ps, "**/api/clan/invitations") as hold:
            click(panel.get_by_role("button", name="Send invitation"))
            notice(ps, "Inviting…")
            hold.release()
        notice(ps, f"Invitation recorded for {x.email}. The mail may take a few minutes.")
        exactly(mail, x.email, f"{sk.name} invited you to {name} on Saltreach", 1)
        ui_in(px, x)
        click(px.get_by_role("link", name="Clan"))
        xpanel = px.get_by_role("complementary", name="Clan")
        with held(px, "**/accept") as hold:
            click(xpanel.get_by_role("button", name=f"Accept invitation to {name}"))
            notice(px, "Joining…")
            hold.release()
        notice(px, f"You joined {name}.")
        roster = panel.get_by_role("table", name="Roster")
        watch(ps, lambda p: x.name in roster.inner_text(), LIVE_S, "invitee in roster")
        for button, label in (("Promote", "Mate"), ("Demote", "Deckhand")):
            with held(ps, f"**/{button.lower()}") as hold:
                click(panel.get_by_role("button", name=f"{button} {x.name}"))
                notice(ps, "Updating…")
                hold.release()
            notice(ps, f"{x.name} is now {label}.")
        y = new_user(app_url, mail)
        join(sk, y, name)
        watch(ps, lambda p: y.name in roster.inner_text(), UI_S, "third member")
        with held(ps, "**/api/clan/members/*") as hold:
            click(panel.get_by_role("button", name=f"Remove {y.name}"))
            notice(ps, "Removing…")
            hold.release()
        notice(ps, f"{y.name} was removed from the clan.")
        click(xpanel.get_by_role("tab", name="Chat"))
        said = "spare a jack " + uuid.uuid4().hex[:6]
        fill(xpanel.get_by_role("textbox", name="Message"), said)
        with held(px, "**/api/clan/messages") as hold:
            click(xpanel.get_by_role("button", name="Send"))
            notice(px, "Sending…")
            hold.release()
        expect(xpanel.get_by_role("log", name="Clan chat")).to_contain_text(said, timeout=UI_MS)
        click(panel.get_by_role("tab", name="Chat"))
        with held(ps, "**/api/clan/messages/*") as hold:
            click(panel.get_by_role("button", name=f"Delete message from {x.name}"))
            notice(ps, "Removing…")
            hold.release()
        expect(panel.get_by_role("log", name="Clan chat")).to_contain_text("Message removed by a warden", timeout=UI_MS)
        assert members(sk)[x.id]["role"] == "deckhand"
        assert all(m["removed"] for m in sk.api.get("/api/clan/messages").json()["messages"])
        with held(px, "**/api/clan/leave") as hold:
            click(xpanel.get_by_role("button", name="Leave clan"))
            notice(px, "Leaving…")
            hold.release()
        notice(px, f"You left {name}.")
    assert x.id not in members(sk)


def test_donation_pairs_and_counters(app_url, mail):
    _, (r, d1, d2) = make_clan(app_url, mail, 3)
    rid = r.api.post("/api/clan/requests", {"unit": "saltjack", "count": 5}).json()["id"]
    gifts = []
    for donor, n in ((d1, 3), (d2, 2)):
        resp = donor.api.post(f"/api/clan/requests/{rid}/donations", {"count": n})
        assert resp.status_code == 201 and resp.json()["donation"]["count"] == n
        gifts.append((donor, n, resp.json()["donation"]["pairId"]))
    credits = {e["pairId"]: e for e in ledger(r) if e["kind"] == "donation"}
    assert len(credits) == 2
    for donor, n, pair in gifts:
        debits = [e for e in ledger(donor) if e["kind"] == "donation"]
        assert len(debits) == 1 and debits[0]["amount"] == -n and debits[0]["pairId"] == pair and debits[0]["asset"] == "saltjack"
        assert debits[0]["counterparty"]["villageId"] == r.vid
        assert credits[pair]["amount"] == n and credits[pair]["asset"] == "saltjack"
        army = vil(donor)["army"]
        assert army["units"]["saltjack"] == STARTER_ARMY - n == army["housing"]["used"]
    army = vil(r)["army"]
    assert army["units"]["saltjack"] == STARTER_ARMY + 5 == army["housing"]["used"]
    assert army["units"]["saltjack"] == sum(e["amount"] for e in ledger(r) if e["asset"] == "saltjack")
    roster = members(r)
    assert roster[r.id]["received"] == 5 and roster[r.id]["donated"] == 0
    assert roster[d1.id]["donated"] == 3 and roster[d2.id]["donated"] == 2 and roster[d1.id]["received"] == 0


def test_donation_requests(app_url, mail):
    _, (r, d1, d2, d3, r2) = make_clan(app_url, mail, 5)
    req = r.api.post("/api/clan/requests", {"unit": "saltjack", "count": 6})
    assert req.status_code == 201 and req.json()["state"] == "open"
    rid = req.json()["id"]
    err(r.api.post("/api/clan/requests", {"unit": "saltjack", "count": 1}), 409, "request_open")
    field(r.api.post("/api/clan/requests", {"unit": "saltjack", "count": 7}), "count", "Choose 1 to 6.")
    err(r.api.post(f"/api/clan/requests/{rid}/donations", {"count": 1}), 409, "own_request")
    field(d1.api.post(f"/api/clan/requests/{rid}/donations", {"count": 4}), "count", "Choose 1 to 3.")
    rs = together([lambda u=u: u.api.post(f"/api/clan/requests/{rid}/donations", {"count": 3}) for u in (d1, d2, d3)])
    assert sorted(x.status_code for x in rs) == [201, 201, 409]
    loser = next(x for x in rs if x.status_code == 409)
    assert loser.json()["error"] in ("request_closed", "exceeds_request") and not LEAK.search(loser.text)
    mine = r.api.get("/api/clan/requests").json()["mine"]
    assert mine["given"] == 6 and mine["state"] == "filled"
    err(d3.api.post(f"/api/clan/requests/{rid}/donations", {"count": 1}), 409, "request_closed")
    assert vil(r)["army"]["units"]["saltjack"] == STARTER_ARMY + 6 and vil(r)["army"]["housing"]["used"] == STARTER_ARMY + 6
    donors = [u for u, x in zip((d1, d2, d3), rs) if x.status_code == 201]
    req2 = r2.api.post("/api/clan/requests", {"unit": "saltjack", "count": 6}).json()
    spare = next(u for u in (d1, d2, d3) if u not in donors)
    assert spare.api.post(f"/api/clan/requests/{req2['id']}/donations", {"count": 1}).status_code == 201
    assert r2.api.post("/api/army/train", {"unit": "saltjack", "count": HOUSING_L1 - STARTER_ARMY - 1}).status_code == 201
    err(spare.api.post(f"/api/clan/requests/{req2['id']}/donations", {"count": 1}), 409, "recipient_housing_full")
    c = r2.api.post(f"/api/clan/requests/{req2['id']}/cancel")
    assert c.status_code == 200 and c.json()["state"] == "closed"
    err(r2.api.post(f"/api/clan/requests/{req2['id']}/cancel"), 409, "request_closed")
    err(d1.api.post(f"/api/clan/requests/{req2['id']}/cancel"), 403, "forbidden")
    err(d2.api.post(f"/api/clan/requests/{req2['id']}/donations", {"count": 1}), 409, "request_closed")
    assert vil(r2)["army"]["units"]["saltjack"] == STARTER_ARMY + 1


def test_donor_daily_cap(app_url, mail):
    _, us = make_clan(app_url, mail, 5)
    donor = us[0]
    zone = "Pacific/Kiritimati"
    assert donor.api.patch("/api/me", {"timeZone": zone}).status_code == 200
    reqs = [u.api.post("/api/clan/requests", {"unit": "saltjack", "count": 3}).json()["id"] for u in us[1:]]
    for rid, n in zip(reqs, (3, 3, 2)):
        assert donor.api.post(f"/api/clan/requests/{rid}/donations", {"count": n}).status_code == 201
    now = ms(donor.api.get("/api/me/rewards").json()["serverTime"])
    b = err(donor.api.post(f"/api/clan/requests/{reqs[3]}/donations", {"count": 1}), 409, "donation_cap_reached")
    assert ms(b["nextDonationAt"]) == periods(zone, now)[0][1]
    assert vil(donor)["army"]["units"]["saltjack"] == STARTER_ARMY - DONOR_DAY_CAP
    assert members(donor)[donor.id]["donated"] == DONOR_DAY_CAP


def test_wf_clan_donations_live(browser, app_url, mail):
    _, (req, d1, d2) = make_clan(app_url, mail, 3)
    assert req.api.post("/api/clan/requests", {"unit": "saltjack", "count": 4}).status_code == 201
    rid = req.api.get("/api/clan/requests").json()["mine"]["id"]
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, req)
        click(page.get_by_role("link", name="Clan"))
        region = page.get_by_role("complementary", name="Clan").get_by_role("region", name="My request")
        expect(region).to_contain_text(progress(0, 4), timeout=UI_MS)
        for donor, n, given in ((d1, 1, 1), (d2, 3, 4)):
            assert donor.api.post(f"/api/clan/requests/{rid}/donations", {"count": n}).status_code == 201
            watch(page, lambda p, g=given: progress(g, 4) in region.inner_text(), LIVE_S, "live progress")
    assert req.api.get("/api/clan/requests").json()["mine"]["state"] == "filled"


def test_wf_clan_donations_journey(browser, app_url, mail):
    _, (req, don) = make_clan(app_url, mail, 2)
    with open_app(browser, app_url + "/signin") as pr, open_app(browser, app_url + "/signin") as pd:
        ui_in(pr, req)
        click(pr.get_by_role("link", name="Clan"))
        rp = pr.get_by_role("complementary", name="Clan")
        click(rp.get_by_role("tab", name="Requests"))
        check(rp.get_by_role("radio", name="Saltjack"))
        fill(rp.get_by_role("spinbutton", name="Count"), "2")
        click(rp.get_by_role("button", name="Request units"))
        mine = rp.get_by_role("region", name="My request")
        expect(mine).to_contain_text(progress(0, 2), timeout=UI_MS)
        ui_in(pd, don)
        click(pd.get_by_role("link", name="Clan"))
        dp = pd.get_by_role("complementary", name="Clan")
        click(dp.get_by_role("tab", name="Requests"))
        for n in (1, 2):
            click(dp.get_by_role("button", name=f"Donate to {req.name}"))
            dlg = pd.get_by_role("dialog", name="Donate")
            fill(dlg.get_by_role("spinbutton", name="Count"), "1")
            click(dlg.get_by_role("button", name="Donate", exact=True))
            notice(pd, f"You donated 1 Saltjack to {req.name}.")
            watch(pr, lambda p, n=n: progress(n, 2) in mine.inner_text(), UI_S, "request progress")
        watch(pr, shows("Army 12/20"), UI_S, "requester army")
        watch(pd, shows("Army 8/20"), UI_S, "donor army")
    assert vil(req)["army"]["units"]["saltjack"] == STARTER_ARMY + 2 and vil(don)["army"]["units"]["saltjack"] == STARTER_ARMY - 2
    m = members(req)
    assert m[req.id]["received"] == 2 and m[don.id]["donated"] == 2
    assert req.api.get("/api/clan/requests").json()["mine"]["state"] == "filled"


def test_wf_clan_donations_feedback(browser, app_url, mail):
    _, (req, don, other) = make_clan(app_url, mail, 3)
    big = other.api.post("/api/clan/requests", {"unit": "saltjack", "count": 6}).json()
    assert don.api.post(f"/api/clan/requests/{big['id']}/donations", {"count": 3}).status_code == 201
    with open_app(browser, app_url + "/signin") as pr, open_app(browser, app_url + "/signin") as pd:
        ui_in(pr, req)
        click(pr.get_by_role("link", name="Clan"))
        rp = pr.get_by_role("complementary", name="Clan")
        click(rp.get_by_role("tab", name="Requests"))
        check(rp.get_by_role("radio", name="Saltjack"))
        fill(rp.get_by_role("spinbutton", name="Count"), "1")
        with held(pr, "**/api/clan/requests") as hold:
            click(rp.get_by_role("button", name="Request units"))
            notice(pr, "Posting…")
            hold.release()
        notice(pr, "Request posted for 1 Saltjack.")
        ui_in(pd, don)
        click(pd.get_by_role("link", name="Clan"))
        dp = pd.get_by_role("complementary", name="Clan")
        click(dp.get_by_role("tab", name="Requests"))
        click(dp.get_by_role("button", name=f"Donate to {other.name}"))
        dlg = pd.get_by_role("dialog", name="Donate")
        expect(dlg.get_by_role("spinbutton", name="Count")).to_be_focused()
        fill(dlg.get_by_role("spinbutton", name="Count"), "1")
        with held(pd, "**/donations") as hold:
            click(dlg.get_by_role("button", name="Donate", exact=True))
            notice(pd, "Donating…")
            hold.release()
        alert(pd, "You've already given 3 units to this request.")
        with held(pr, "**/cancel") as hold:
            click(rp.get_by_role("button", name="Cancel my request"))
            notice(pr, "Cancelling…")
            hold.release()
        notice(pr, "Request cancelled.")
    assert req.api.get("/api/clan/requests").json()["mine"]["state"] == "closed"
    assert vil(don)["army"]["units"]["saltjack"] == STARTER_ARMY - 3


def test_operator_rerun(app_url, mail):
    att, dfn, other = users(app_url, mail, 3)
    raid = run_raid(att, dfn)
    o = ops(app_url)
    r = o.post(f"/api/ops/raids/{raid['id']}/rerun")
    assert r.status_code == 200
    b = r.json()
    assert (b["raidId"], b["seed"], b["finalTick"], b["match"], b["firstMismatchTick"]) == (raid["id"], raid["seed"], raid["result"]["finalTick"], True, None)
    assert b["result"]["destruction"] == raid["result"]["destruction"] and b["result"]["stars"] == raid["result"]["stars"]
    pending = lock(other, att).json()
    err(o.post(f"/api/ops/raids/{pending['id']}/rerun"), 409, "raid_not_resolved")
    err(o.post(f"/api/ops/raids/{ID_MAX}/rerun"), 404, "not_found")
    assert o.get(f"/api/raids/{raid['id']}").status_code == 200
    err(other.api.get(f"/api/raids/{raid['id']}"), 404, "not_found")
    for resp in (att.api.get("/api/ops/status"), att.api.post(f"/api/ops/raids/{raid['id']}/rerun"), att.api.get("/api/ops/ledger/check")):
        err(resp, 403, "forbidden")
    s = o.get("/api/ops/status").json()
    assert s["database"] == "up" and set(s) == {"database", "mail", "queuedMail"}
    lc = o.get("/api/ops/ledger/check").json()
    assert lc["unbalancedPairs"] == 0 and lc["overCap"] == 0 and lc["pairs"] > 0


def test_database_outage_and_recovery(mail):
    with httpx.Client(base_url=url("APP_POSTGRES_DOWN_URL"), timeout=HTTP_TIMEOUT) as c:
        h = c.get("/api/health")
        assert h.status_code == 200 and h.json() == {"status": "ok"}
        s = c.get("/api/status")
        assert s.status_code == 200 and s.json()["database"] == "down"
        for resp in (c.get("/api/session"), c.get("/api/catalog"), c.get("/api/village"),
                     c.post("/api/auth/signin", json={"email": OPS_EMAIL, "password": OPS_PW})):
            err(resp, 503, "database_unavailable")
        idx = c.get("/signin")
        assert idx.status_code == 200 and idx.text.strip()
    base = url("APP_DB_CUT_URL")
    box = {}

    def setup():
        try:
            att, dfn = new_user(base, mail), new_user(base, mail)
            rid = lock(att, dfn).json()["id"]
            assert deploy(att, rid, [{"tick": 0, "unit": "saltjack", "x": 0, "y": 19}]).status_code == 200
            box.update(att=att, dfn=dfn, rid=rid)
            return True
        except (AssertionError, KeyError, ValueError, httpx.HTTPError):
            return False
    poll(setup, 180, "setup on the cut copy")

    def abandoned():
        assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
        r = box["att"].api.get(f"/api/raids/{box['rid']}")
        if r.status_code == 503:
            err(r, 503, "database_unavailable")
            return False
        return r.json()["state"] == "abandoned" and r.json()
    raid = poll(abandoned, 120, "abandonment after outage")
    assert raid["endReason"] == "deadline_passed"
    fin = poll(lambda: (lambda r: r if r.status_code != 503 else None)(finalize(box["att"], box["rid"])), 60, "finalize after recovery")
    err(fin, 409, "raid_abandoned")
    for u in (box["att"], box["dfn"]):
        v, es = vil(u), ledger(u)
        for k in ASSETS:
            assert v["resources"][k]["amount"] == sum(e["amount"] for e in es if e["asset"] == k)
        assert v["army"]["units"]["saltjack"] == sum(e["amount"] for e in es if e["asset"] == "saltjack") == STARTER_ARMY


def test_wf_operator_outage(browser):
    base = url("APP_POSTGRES_DOWN_URL")
    with open_app(browser, base + "/signin") as page:
        expect(page.get_by_role("heading", name="Back to the flats")).to_be_visible(timeout=UI_MS)
        fill(page.get_by_role("textbox", name="Email"), OPS_EMAIL)
        fill(page.get_by_label("Password", exact=True), OPS_PW)
        click(page.get_by_role("button", name="Sign in", exact=True))
        alert(page, "The tide records are out of reach. Nothing was changed — try again in a moment.")
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_mail_outage_queue(mail):
    base = url("APP_MAILPIT_DOWN_URL")
    poll(lambda: httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT).json()["mail"] == "down", 30, "mail down")
    a = Api(base)
    email, name = fresh()
    r = a.post("/api/auth/signup", {"email": email, "password": "Queued-Pass-123", "displayName": name, "timeZone": "UTC"})
    assert r.status_code == 202 and r.json() == {"status": "check_email"}
    f = a.post("/api/auth/forgot", {"email": email})
    assert f.status_code == 202 and f.json() == {"status": "check_email"}
    assert len(inbox(mail, email, CONFIRM_SUBJECT, 1, OUTAGE_MAIL_S)) == 1
    exactly(mail, email, CONFIRM_SUBJECT, 1)
    assert len(inbox(mail, email, RESET_SUBJECT, 1, OUTAGE_MAIL_S)) == 1
    exactly(mail, email, RESET_SUBJECT, 1)


def test_opaque_errors(app_url, mail):
    u = new_user(app_url, mail)
    raw = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    err(raw.get("/api/me"), 401, "unauthenticated")
    err(u.api.c.post("/api/village/buildings", content=b'{"type":', headers={"X-CSRF-Token": u.api.csrf, "Content-Type": "application/json"}), 400, "malformed_json")
    err(u.api.c.post("/api/village/buildings", content=b"type=brine_pan", headers={"X-CSRF-Token": u.api.csrf, "Content-Type": "text/plain"}), 415, "unsupported_media_type")
    field(u.api.get("/api/raids", role="both"), "role", "Use attack or defence.")
    field(u.api.get("/api/village/ledger", limit=0), "limit", "Use 1 to 100.")
    field(u.api.patch("/api/me", {"timeZone": "Mars/Olympus"}), "timeZone", "Choose a time zone from the list.")
    err(u.api.get(f"/api/raids/{ID_MAX}"), 404, "not_found")
    err(u.api.post("/api/village/buildings", {"type": "brine_pan", "x": "x' OR 1=1 --", "y": 4, "rotation": 0}), 422, "validation_failed")
    r = u.api.post("/api/raids", {"villageId": "1; DROP TABLE x"}, key=idempotency_key())
    assert r.status_code in (403, 404, 422) and not LEAK.search(r.text)


MALFORMED = {"zero": "0", "negative": "-1", "beyond": "9007199254740992", "fraction": "1.5",
             "letters": "abc", "uuid": "123e4567-e89b-12d3-a456-426614174000", "leading-zero": "01"}


@pytest.mark.parametrize("case", list(MALFORMED), ids=list(MALFORMED))
def test_malformed_ids(app_url, mail, case):
    bad = MALFORMED[case]
    _, (u, _m) = make_clan(app_url, mail, 2)
    calls = [lambda: u.api.get(f"/api/villages/{bad}"), lambda: u.api.get(f"/api/villages/{bad}/scout"),
             lambda: u.api.get(f"/api/raids/{bad}"), lambda: u.api.get(f"/api/raids/{bad}/snapshot", tick=0),
             lambda: u.api.patch(f"/api/village/buildings/{bad}", {"x": 30, "y": 4, "rotation": 0}),
             lambda: u.api.post(f"/api/village/buildings/{bad}/upgrade"), lambda: u.api.post(f"/api/village/buildings/{bad}/cancel"),
             lambda: u.api.post(f"/api/village/buildings/{bad}/collect"), lambda: u.api.post(f"/api/army/training/{bad}/cancel"),
             lambda: u.api.post(f"/api/raids/{bad}/deploys", {"deploys": []}, key=idempotency_key()),
             lambda: u.api.post(f"/api/raids/{bad}/finalize", {}, key=idempotency_key()),
             lambda: u.api.post(f"/api/invitations/{bad}/accept"), lambda: u.api.post(f"/api/invitations/{bad}/decline"),
             lambda: u.api.post(f"/api/clan/members/{bad}/promote"), lambda: u.api.post(f"/api/clan/members/{bad}/demote"),
             lambda: u.api.delete(f"/api/clan/members/{bad}"), lambda: u.api.delete(f"/api/clan/messages/{bad}"),
             lambda: u.api.post(f"/api/clan/requests/{bad}/cancel"), lambda: u.api.post(f"/api/clan/requests/{bad}/donations", {"count": 1}),
             lambda: ops(app_url).post(f"/api/ops/raids/{bad}/rerun")]
    for call in calls:
        err(call(), 404, "not_found")


def test_wf_operator_journey(browser, app_url, mail):
    att, dfn = users(app_url, mail, 2)
    raid = run_raid(att, dfn, REPLAY_DEPLOYS)
    final = raid["result"]["finalTick"]
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, U(email=OPS_EMAIL, pw=OPS_PW))
        expect(page.get_by_role("link", name="Raid log")).to_have_count(0)
        click(page.get_by_role("link", name="Operations"))
        expect(page).to_have_url(re.compile(r"/ops$"), timeout=UI_MS)
        service = page.get_by_role("region", name="Service status")
        expect(service).to_contain_text(status_line("Database", "up"), timeout=UI_MS)
        expect(service).to_contain_text(re.compile(r"Queued mail: \d+"))
        fill(page.get_by_role("textbox", name="Raid ID"), str(raid["id"]))
        click(page.get_by_role("button", name="Re-run raid"))
        notice(page, f"Seed {raid['seed']} re-run matches every tick (0–{final}).")
        click(page.get_by_role("button", name="Check ledger"))
        notice(page, re.compile(r"Ledger balanced: [\d,]+ pairs\."))
    rerun = ops(app_url).post(f"/api/ops/raids/{raid['id']}/rerun").json()
    assert rerun["match"] is True and rerun["seed"] == raid["seed"] and rerun["finalTick"] == final
    assert ops(app_url).get("/api/ops/ledger/check").json()["unbalancedPairs"] == 0


def test_wf_operator_feedback(browser, app_url, mail):
    att, dfn = users(app_url, mail, 2)
    raid = run_raid(att, dfn, REPLAY_DEPLOYS)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, U(email=OPS_EMAIL, pw=OPS_PW))
        click(page.get_by_role("link", name="Operations"))
        expect(page.get_by_role("heading", name="Operations")).to_be_visible(timeout=UI_MS)
        status = page.get_by_role("region", name="Service status")
        expect(status).to_contain_text(status_line("Database", "up"))
        expect(status).to_contain_text("Mail: delivering")
        expect(status).to_contain_text(re.compile(r"Queued mail: \d+"))
        fill(page.get_by_role("textbox", name="Raid ID"), str(raid["id"]))
        with held(page, "**/rerun") as hold:
            click(page.get_by_role("button", name="Re-run raid"))
            notice(page, "Re-running seed…")
            hold.release()
        notice(page, f"Seed {raid['seed']} re-run matches every tick (0–{raid['result']['finalTick']}).")
        fill(page.get_by_role("textbox", name="Raid ID"), str(ID_MAX))
        click(page.get_by_role("button", name="Re-run raid"))
        alert(page, "No raid has that ID.")
        with held(page, "**/ledger/check") as hold:
            click(page.get_by_role("button", name="Check ledger"))
            notice(page, "Checking…")
            hold.release()
        notice(page, re.compile(r"Ledger balanced: [\d,]+ pairs\."))
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, att)
        page.goto(app_url + "/ops")
        expect(page).not_to_have_url(re.compile(r"/ops"), timeout=UI_MS)
        expect(page.get_by_role("link", name="Operations")).to_have_count(0)


def test_wf_grid_controls_feedback(browser, app_url, mail):
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        view = island(page)
        steer(page, view, "cursor", 26, 24)
        notice(page, "Cell 26, 24 — Peat Cutter level 1")
        steer(page, view, "cursor", 31, 5)
        notice(page, "Cell 31, 5 — open salt")
        ghost(page, view, "Brine Cistern", 31, 5)
        posted = []
        page.on("request", lambda rq: posted.append(rq.url) if rq.method == "POST" else None)
        steer(page, view, "ghost", 26, 24)
        expect(view).to_have_attribute("data-ghost-valid", "false")
        page.keyboard.press("Enter")
        alert(page, "That spot is taken or off the build area.")
        assert not [p for p in posted if "/api/village/buildings" in p], posted
    assert not any(b["type"] == "brine_cistern" for b in vil(u)["buildings"])


def test_wf_grid_controls_keyboard(browser, app_url, mail):
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        view = island(page)
        steer(page, view, "cursor", 30, 4)
        page.keyboard.press("b")
        dialog = page.get_by_role("dialog", name="Build")
        expect(dialog.get_by_role("button", name=re.compile(r"^Place ")).first).to_be_focused(timeout=UI_MS)
        for _ in range(12):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        watch(page, lambda p: dialog.is_hidden(), UI_S, "dialog closed")
        expect(page.get_by_role("button", name="Build", exact=True)).to_be_focused()
        view.focus()
        page.keyboard.press("b")
        rick = dialog.get_by_role("button", name=re.compile(r"^Place Peat Rick"))
        for _ in range(20):
            if rick.evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        watch(page, lambda p: dialog.is_hidden(), UI_S, "dialog closed")
        expect(view).to_be_focused()
        for attr, val in (("data-ghost-type", "peat_rick"), ("data-ghost-x", "30"), ("data-ghost-y", "4"), ("data-ghost-rotation", "0")):
            expect(view).to_have_attribute(attr, val)
        sent = []
        page.on("request", lambda rq: sent.append((rq.method, rq.url, rq.post_data)) if "/api/village/buildings" in rq.url and rq.method in ("POST", "PATCH") else None)
        page.keyboard.press("r")
        expect(view).to_have_attribute("data-ghost-rotation", "90")
        expect(view).to_have_attribute("data-ghost-valid", "true")
        page.keyboard.press("Enter")
        poll(lambda: any(b["type"] == "peat_rick" for b in vil(u)["buildings"]), UI_S, "placement stored")
        placed = [json.loads(d) for m, p, d in sent if m == "POST" and p.rstrip("/").endswith("/api/village/buildings")]
        assert placed and set(placed[-1]) == {"type", "x", "y", "rotation"}, placed
        assert (placed[-1]["type"], placed[-1]["x"], placed[-1]["y"], placed[-1]["rotation"]) == ("peat_rick", 30, 4, 90)
        panel = details(page, view, 12, 18, "Tide Barracks · level 1")
        watch(page, lambda p: panel.evaluate("p => p.contains(document.activeElement)"), UI_S, "focus in Building details")
        page.keyboard.press("Escape")
        expect(view).to_be_focused()
        panel = details(page, view, 12, 18, "Tide Barracks · level 1")
        move = panel.get_by_role("button", name="Move")
        for _ in range(20):
            if move.evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        expect(view).to_have_attribute("data-ghost-type", "tide_barracks", timeout=UI_MS)
        steer(page, view, "ghost", 5, 10)
        page.keyboard.press("Enter")
        poll(lambda: (bld(vil(u), "tide_barracks")["x"], bld(vil(u), "tide_barracks")["y"]) == (5, 10), UI_S, "move stored")
        moves = [json.loads(d) for m, p, d in sent if m == "PATCH"]
        assert moves and set(moves[-1]) == {"x", "y", "rotation"}, moves
        page.keyboard.press("b")
        click(dialog.get_by_role("button", name=re.compile(r"^Place Brine Cistern")))
        page.keyboard.press("Escape")
        assert view.get_attribute("data-ghost-type") is None
        expect(view).to_be_focused()
    rick = bld(vil(u), "peat_rick")
    assert (rick["x"], rick["y"], rick["rotation"]) == (30, 4, 90) and bld(vil(u), "tide_barracks")["level"] == 1


def test_wf_grid_controls_touch(browser, app_url, mail):
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        ui_in(page, u)
        view = island(page)
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        box = view.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.4

        def touch(kind, pts):
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
            advance(page, 16)

        def gesture(frames):
            touch("touchStart", frames[0])
            for f in frames[1:]:
                touch("touchMove", f)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            advance(page, 100)
        cam = lambda: {a: view.get_attribute(f"data-camera-{a}") for a in ("pan-x", "pan-y", "zoom", "azimuth")}
        c0 = cam()
        gesture([[(cx, cy + d)] for d in range(0, 90, 10)])
        c1 = cam()
        assert (c1["pan-x"], c1["pan-y"]) != (c0["pan-x"], c0["pan-y"])
        gesture([[(cx - 30 - d, cy), (cx + 30 + d, cy)] for d in range(0, 90, 10)])
        c2 = cam()
        assert float(c2["zoom"]) > float(c1["zoom"]) and 0.5 <= float(c2["zoom"]) <= 2.0
        gesture([[(cx - 60 * math.cos(a), cy - 60 * math.sin(a)), (cx + 60 * math.cos(a), cy + 60 * math.sin(a))]
                 for a in [math.radians(d) for d in range(0, 50, 5)]])
        assert cam()["azimuth"] != c2["azimuth"]
        assert page.evaluate("() => [window.scrollX, window.scrollY]") == [0, 0]
        view.evaluate("el => { window.__anim = []; new MutationObserver(() => window.__anim.push(el.dataset.animating)).observe(el, {attributes: true, attributeFilter: ['data-animating']}); }")
        ghost(page, view, "Peat Rick", 30, 4)
        page.keyboard.press("Enter")
        poll(lambda: any(b["type"] == "peat_rick" for b in vil(u)["buildings"]), UI_S, "placement")
        details(page, view, 12, 24, "Brine Pan · level 1")
        advance(page, 1000)
        assert "true" not in page.evaluate("window.__anim") and view.get_attribute("data-animating") == "false"


def test_run_manifest_and_health(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"} and "application/json" in r.headers["content-type"]


def test_session_and_request_boundary(app_url, mail):
    a = Api(app_url)
    body = {"email": OPS_EMAIL, "password": "x"}
    err(a.c.post("/api/auth/signin", json=body), 403, "csrf_failed")
    err(a.c.post("/api/auth/signin", json=body, headers={"X-CSRF-Token": "wrong-token"}), 403, "csrf_failed")
    err(a.c.post("/api/auth/signin", json=body, headers={"X-CSRF-Token": a.csrf, "Origin": "http://evil.example"}), 403, "csrf_failed")
    for forged in ({"Origin": "null"}, {"Origin": "http://evil.example", "Host": "evil.example"}):
        err(a.c.post("/api/auth/signin", json=body, headers={"X-CSRF-Token": a.csrf, **forged}), 403, "csrf_failed")
    pad = lambda n: ('{"email":"' + "a" * (n - len('{"email":""}')) + '"}').encode()
    h = {"X-CSRF-Token": a.csrf, "Content-Type": "application/json"}
    err(a.c.post("/api/auth/forgot", content=pad(BODY_LIMIT + 1), headers=h), 413, "payload_too_large")
    assert a.c.post("/api/auth/forgot", content=pad(BODY_LIMIT), headers=h).status_code == 422
    err(a.c.post("/api/auth/forgot", content=b"email=a", headers={**h, "Content-Type": "text/plain"}), 415, "unsupported_media_type")
    u = new_user(app_url, mail)
    r = Api(app_url).post("/api/auth/signin", {"email": u.email, "password": u.pw})
    session_cookie(r)
    for path in ("/api/health", "/signin"):
        resp = httpx.get(app_url + path, headers={"Origin": "http://evil.example"}, timeout=HTTP_TIMEOUT)
        assert resp.headers.get("x-content-type-options") == "nosniff" and resp.headers.get("content-security-policy")
    idx = httpx.get(app_url + "/raids/1/replay", timeout=HTTP_TIMEOUT)
    assert idx.status_code == 200 and idx.text.strip()
    for path in ("/run.json", "/.env", "/package.json", "/package-lock.json", "/node_modules/.package-lock.json", "/server/index.ts", "/server.js.map"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT).status_code == 404, path


VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "laptop": (1280, 800)}


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layout(browser, app_url, mail, size):
    w, h = VIEWPORTS[size]
    u = new_user(app_url, mail)
    with open_app(browser, app_url + "/signin") as page:
        page.set_viewport_size({"width": w, "height": h})

        def targets():
            for role in ("button", "link"):
                for el in page.get_by_role(role).all():
                    if el.is_visible():
                        b = el.bounding_box()
                        assert b["width"] >= 44 and b["height"] >= 44, f"{role} {el.inner_text()!r} {b}"
        layout(page)
        targets()
        ui_in(page, u)
        island(page)
        layout(page)
        targets()
        if size != "phone":
            bx = (w * 3 / 8, h * 3 / 8, w * 5 / 8, h * 5 / 8)
            for loc in (page.get_by_role("navigation", name="Main"), page.get_by_role("region", name="Queues"),
                        page.get_by_role("button", name="Build", exact=True), page.get_by_role("button", name="Train", exact=True),
                        page.get_by_role("status", name="Tide notices"), page.get_by_role("alert", name="Tide alerts")):
                if loc.count() and loc.is_visible():
                    b = loc.bounding_box()
                    if b["width"] > 1 and b["height"] > 1:
                        assert b["x"] + b["width"] <= bx[0] or b["x"] >= bx[2] or b["y"] + b["height"] <= bx[1] or b["y"] >= bx[3], b


def test_wf_cross_cutting_flat_plan(browser, app_url, mail, replay_raid):
    att, raid, final = replay_raid
    with open_app(browser, app_url + "/signin", no_webgl=True) as page:
        ui_in(page, att)
        view = island(page)
        expect(view).to_have_attribute("data-renderer", "flat")
        notice(page, "3D view unavailable — showing the flat plan.")
        view.focus()
        page.keyboard.press("e")
        expect(view).to_have_attribute("data-camera-azimuth", "0")
        steer(page, view, "cursor", 12, 18)
        notice(page, "Cell 12, 18 — Tide Barracks level 1")
        page.goto(f"{app_url}/raids/{raid['id']}/replay")
        view = island(page)
        expect(view).to_have_attribute("data-renderer", "flat")
        page.get_by_role("slider", name="Wake dial").focus()
        page.keyboard.press("End")
        assert_tick(view, att, raid["id"], final)
        page.keyboard.press("ArrowLeft")
        assert_tick(view, att, raid["id"], final - 1)


def test_wf_cross_cutting_profile(browser, app_url, mail):
    u = new_user(app_url, mail)
    new_name = "N" + uuid.uuid4().hex[:10]
    with open_app(browser, app_url + "/signin") as page:
        ui_in(page, u)
        click(page.get_by_role("link", name="Profile"))
        panel = page.get_by_role("complementary", name="Profile")
        name_box = panel.get_by_role("textbox", name="Display name")
        fill(name_box, "ab")
        click(panel.get_by_role("button", name="Save profile"))
        alert(page, "Check the highlighted fields.")
        expect(name_box).to_have_accessible_description("Use 3 to 20 letters, digits, spaces, hyphens or underscores.")
        assert u.api.get("/api/me").json()["displayName"] == u.name
        fill(name_box, new_name)
        with held(page, "**/api/me") as hold:
            click(panel.get_by_role("button", name="Save profile"))
            notice(page, "Saving…")
            hold.release()
        notice(page, "Profile saved.")
    assert u.api.get("/api/me").json()["displayName"] == new_name


APP = Path("/app")
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def shipped():
    found = {}
    for key, d in json.loads((APP / "package-lock.json").read_text()).get("packages", {}).items():
        if "node_modules/" in key and not d.get("dev") and not d.get("optional") and not d.get("link"):
            lic = d.get("license")
            found.setdefault(key.rsplit("node_modules/", 1)[-1], lic.get("type") if isinstance(lic, dict) else lic)
    return found


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1" and all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n in shipped() if n not in notes]
    assert not missing, missing
    for font in ("Fraunces", "Atkinson Hyperlegible", "JetBrains Mono"):
        assert font in notes
    assert "icon" in notes.lower()


def test_if_licences_allowlisted():
    bad = {}
    for name, lic in shipped().items():
        expr = (lic or "").replace("(", "").replace(")", "")
        ok = (any(p.strip() in ALLOWED for p in expr.split(" OR ")) if " OR " in expr
              else all(p.strip() in ALLOWED for p in expr.split(" AND ")) if expr else False)
        if not ok:
            bad[name] = lic
    assert not bad, bad


def test_if_postgres_only():
    lock_ = json.loads((APP / "package-lock.json").read_text())
    names = {p.rsplit("node_modules/", 1)[-1] for p in lock_.get("packages", {})}
    others = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "mongodb", "mongoose", "level", "lowdb", "nedb", "lmdb"}
    assert not names & others, names & others


def test_if_typescript_source():
    skip = {"node_modules", "dist", "build", "out", ".git", "coverage", ".vite"}
    offenders = [p for p in APP.rglob("*") if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and not skip & set(p.relative_to(APP).parts)
                 and not re.search(r"(config|rc)\.[cm]?js$|^\.", p.name)]
    assert not offenders, offenders


def test_if_same_origin_assets(browser, app_url, mail):
    att, dfn = users(app_url, mail, 2)
    raid = run_raid(att, dfn, REPLAY_DEPLOYS)
    with open_app(browser, app_url + "/signin") as page:
        seen = []
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        ui_in(page, att)
        island(page)
        page.goto(f"{app_url}/raids/{raid['id']}/replay")
        island(page)
    foreign = [s for s in seen if not s.startswith(("data:", "blob:")) and not same_origin(s, app_url)]
    assert not foreign, foreign


def test_if_lockfile_used():
    assert (APP / "package-lock.json").is_file()
    assert json.loads((APP / "run.json").read_text())["install"].strip().startswith("npm ci")


def test_if_compose_untouched():
    path = Path("/logs/agent/trajectory.json")
    if not path.is_file():
        return
    traj = path.read_text()
    edits = re.findall(r'"(?:file_path|path|filePath)"\s*:\s*"([^"]*compose[^"]*\.ya?ml)"', traj)
    writes = [p for p in edits if re.search(r'"(?:Edit|Write|MultiEdit|str_replace|create)"[^{}]{0,400}' + re.escape(p), traj)]
    assert not writes, writes
