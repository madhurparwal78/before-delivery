from __future__ import annotations

import concurrent.futures
import contextlib
import hashlib
import json
import os
import random
import re
import socket
import string
import subprocess
import tempfile
import threading
import time
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect

import conftest
from conftest import advance, animations, held, open_app, same_origin

try:
    from conftest import PocketBase, S3
except ImportError:
    from clients import PocketBase, S3

COOKIE = "elevens_session"
OPERATOR_EMAIL = "operator@sideline.test"
OPERATOR_PASSWORD = "chalk-and-floodlights-26"
BUDGET_TENTHS = 1000
SQUAD_SHAPE = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
CLUB_LIMIT = 3
CLUB_LIMIT_MESSAGE = "no more than 3 players may come from {club}"
HIT_POINTS = 4
FREE_TRANSFER_CAP = 5
PRICE_RUN_CAP = 3
DEADLINE_LEAD = timedelta(minutes=90)
LOCK_S = 1
SYNC_S = 2
SNAPSHOT_RETRY_S = 5
NOTICE_CATCHUP_S = 10
MAX_BODY_BYTES = 65536
PASSWORD_MIN = 10
TEAM_NAME_MAX = 30
LEAGUE_NAME_MIN = 3
CODE_LENGTH = 6
CODE_ALPHABET = set(string.ascii_uppercase + string.digits) - set("O0I1")
FIRST_HALF_END = 18
LAST_GAMEWEEK = 36
PLAYER_COUNT = 90
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
TARGET_PX = 44
RELAY_MIN_MS = 1000
RELAY_MAX_MS = 2000
BADGE_MS = 4000

POSITION_WORD = {"GK": "goalkeeper", "DEF": "defender", "MID": "midfielder", "FWD": "forward"}
POSITION_FILTER = {"GK": "Goalkeepers", "DEF": "Defenders", "MID": "Midfielders", "FWD": "Forwards"}
GOAL = {"GK": 6, "DEF": 6, "MID": 5, "FWD": 4}
ASSIST = 3
CLEAN_SHEET = {"GK": 4, "DEF": 4, "MID": 1, "FWD": 0}
YELLOW, RED, OWN_GOAL = -1, -3, -2
SHORT_MINUTES, FULL_MINUTES = 1, 2

CLUBS = {
    "HAR": ("Harbour Rovers", "A"), "KIL": ("Kilbarrow Celtic", "A"), "DRU": ("Drumlin United", "A"),
    "LOU": ("Lough Athletic", "B"), "SAL": ("Saltmarsh Town", "B"), "FER": ("Ferrybank FC", "B"),
    "GLE": ("Glencarra Wanderers", "B"), "RAT": ("Rathmoyle Albion", "C"), "BRA": ("Brackenford City", "C"),
    "COR": ("Corrib Vale", "C"),
}
SLOTS = ("GK1", "DEF1", "DEF2", "DEF3", "MID1", "MID2", "MID3", "FWD1", "FWD2")
PRICES_M = {
    "A": (5.0, 6.0, 5.0, 4.5, 10.0, 7.0, 5.5, 10.5, 7.0),
    "B": (4.5, 5.0, 4.5, 4.0, 8.0, 6.0, 5.0, 8.0, 6.0),
    "C": (4.0, 4.5, 4.0, 4.0, 6.5, 5.0, 4.5, 6.5, 5.0),
}
NAMES = {
    "HAR": ("Ronan Tierney", "Cathal Brophy", "Eoin Madigan", "Shane Folan", "Ciaran Doyle", "Darragh Whelan", "Fiachra Nolan", "Oisin Rafferty", "Tadhg Lenihan"),
    "KIL": ("Padraig Hession", "Kevin Mulvey", "Liam Garvan", "Aaron Coyle", "Senan Gilroy", "Jamie Corcoran", "Niall Prendergast", "Conall Breen", "Mark Duignan"),
    "DRU": ("Alan Furlong", "Dylan Keaveney", "Robbie Tansey", "Cian Hegarty", "Evan Moriarty", "Luke Fahy", "Rory Geraghty", "Sean Kinsella", "Adam Mullery"),
    "LOU": ("Brian Cosgrave", "Paul Devane", "Owen Lally", "Ross Mannion", "Jack Treacy", "Killian Dolan", "Fionn Hughes", "Daniel Costigan", "Cormac Feeney"),
    "SAL": ("Gavin Harte", "Ethan Loughran", "Ben Mahony", "Colm Ruane", "Dara Kerins", "Eamon Sheridan", "Patrick Quill", "Josh Merrigan", "Tom Gaughan"),
    "FER": ("Declan Ormsby", "Conor Byrne", "Ryan Cuddihy", "Kyle Diskin", "Odhran Phelan", "Sam Fogarty", "Ultan Healy", "Noel Tuohy", "Jordan Kilkelly"),
    "GLE": ("Martin Scully", "Ian Rowley", "Fergal Daly", "Neil Corkery", "Diarmuid Quigley", "Alex Morrin", "Cillian Galvin", "Barry Hanrahan", "Matthew Joyce"),
    "RAT": ("Stephen Kearns", "Philip Nestor", "Gary Mulhern", "Lorcan Daws", "Hugh Barrett", "Nathan Clancy", "Peter Moran", "Chris Larkin", "Leon Coughlan"),
    "BRA": ("Eddie Walshe", "Kieran Brennock", "Joe Stapleton", "David Ferris", "Jake Holohan", "Tiernan Keogh", "Michael Rabbitte", "Aidan Cullinane", "Shay Delahunt"),
    "COR": ("Frank Gildea", "Tony Mulcahy", "Rob Kenneally", "Danny Spillane", "Gearoid Ward", "Lee Hennelly", "Mikey Grehan", "Callum Dineen", "Emmet Furey"),
}
SQUAD_RULE_ORDER = ["squad_size", "duplicate_player", "goalkeepers", "defenders", "midfielders", "forwards", "club_limit", "budget", "position_match"]
SQUAD_MESSAGES = {
    "squad_size": "the squad needs exactly 15 players",
    "duplicate_player": "a player can only be picked once",
    "goalkeepers": "the squad needs exactly 2 goalkeepers",
    "defenders": "the squad needs exactly 5 defenders",
    "midfielders": "the squad needs exactly 5 midfielders",
    "forwards": "the squad needs exactly 3 forwards",
    "budget": "the squad costs more than the money available",
    "position_match": "each player in must play the same position as the player out",
}
SHAPE_RULE_ORDER = ["eleven_size", "shape_goalkeeper", "shape_defenders", "shape_midfielders", "shape_forwards", "captain"]
SHAPE_MESSAGES = {
    "eleven_size": "the eleven needs exactly 11 players and the bench 4",
    "shape_goalkeeper": "the eleven needs exactly 1 goalkeeper",
    "shape_defenders": "the eleven needs at least 3 defenders",
    "shape_midfielders": "the eleven needs at least 2 midfielders",
    "shape_forwards": "the eleven needs at least 1 forward",
    "captain": "the captain and vice-captain must be two different starters",
}
CHIP_NAMES = {"wildcard": "Wildcard", "free_hit": "Free Hit", "bench_boost": "Bench Boost", "triple_captain": "Triple Captain"}
LOCKED_BANNER = "Gameweek {n} is locked. Pick Team and Transfers reopen when the next gameweek opens."
DEADLINE_COPY = "Deadline passed. Gameweek {n} is locked, so this change was not saved."
STORED = "Team locked, receipt stored"
PENDING = "Receipt pending. Your locked team is safe; the file will be stored when storage is back."

HTTP_TIMEOUT_S = 30
LOCK_LEAD_S = 8
SLACK_S = 3
UI_WAIT_S = 20
API_WAIT_S = 30
POLL_MS = 100
RELAY_STEP_MS = 50
BOOT_S = 120
TAB_LIMIT = 80
SEARCH_TRIES = 3000
FAR_ENOUGH = timedelta(minutes=10)
FAR_KICKOFF = datetime(2031, 11, 8, 15, 0, tzinfo=timezone.utc)
WRONG_FUTURE = datetime(2040, 1, 6, 12, 0, tzinfo=timezone.utc)
WRONG_PAST = datetime(2001, 1, 6, 12, 0, tzinfo=timezone.utc)
FOREIGN_ORIGIN = "http://elsewhere.invalid"
PAIRS = (("HAR", "KIL"), ("DRU", "LOU"), ("SAL", "FER"), ("GLE", "RAT"), ("BRA", "COR"))
RNG = random.Random(uuid.uuid4().int)


def seed_players() -> dict[str, dict]:
    out = {}
    for code, (_, tier) in CLUBS.items():
        for i, slot in enumerate(SLOTS):
            out[f"{code}-{slot}"] = {"name": NAMES[code][i], "club": code, "position": re.sub(r"\d", "", slot),
                                     "price_tenths": round(PRICES_M[tier][i] * 10)}
    return out


NAME_ORDERS = (lambda p: p["name"],)


def sorted_by_name(ids, players, key) -> bool:
    return any(ids == [p["id"] for p in sorted(players, key=lambda p: key(p, nm))] for nm in NAME_ORDERS)


def money(tenths: int) -> str:
    sign = "-" if tenths < 0 else ""
    t = abs(tenths)
    return f"{sign}{t // 10}.{t % 10}"


def tenths_of(millions: str) -> int:
    whole, _, frac = millions.partition(".")
    return int(whole) * 10 + int(frac or 0)


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def tag() -> str:
    return uuid.uuid4().hex[:8]


def new_run_date() -> str:
    return (date(2200, 1, 1) + timedelta(days=RNG.randrange(200000))).isoformat()


class Api:
    def __init__(self, base: str, token: str | None = None):
        self.base = base.rstrip("/")
        self.token = token
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        self.email = self.password = self.team = None

    def call(self, method: str, path: str, body=None, headers=None, params=None, content=None) -> httpx.Response:
        h = dict(headers or {})
        if self.token:
            h["Cookie"] = f"{COOKIE}={self.token}"
        kw = {"headers": h, "params": params}
        if content is not None:
            kw["content"] = content
        elif body is not None:
            kw["json"] = body
        r = self.http.request(method, path, **kw)
        self.http.cookies.clear()
        got = r.cookies.get(COOKIE)
        if got:
            self.token = got
        return r

    def get(self, path, **kw):
        return self.call("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.call("POST", path, body, **kw)

    def put(self, path, body=None, **kw):
        return self.call("PUT", path, body, **kw)

    def delete(self, path, **kw):
        return self.call("DELETE", path, **kw)


def err(r: httpx.Response, status: int, code: str | None = None) -> dict:
    assert r.status_code == status, f"{r.status_code} {r.text}"
    body = r.json()
    assert isinstance(body.get("error"), str) and isinstance(body.get("message"), str), body
    if code:
        assert body["error"] == code, body
    return body


def new_manager(base: str, team: str | None = None) -> Api:
    t = tag()
    api = Api(base)
    api.email, api.password, api.team = f"mgr-{t}@sideline.test", f"floodlit-{t}", team or f"Side {t}"
    r = api.post("/api/auth/signup", {"email": api.email, "password": api.password, "team_name": api.team})
    assert r.status_code == 201, r.text
    api.account = r.json()
    return api


def operator(base: str) -> Api:
    api = Api(base)
    r = api.post("/api/auth/signin", {"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD})
    assert r.status_code == 200 and r.json()["role"] == "operator", r.text
    return api


def catalogue(api: Api, **params) -> list[dict]:
    r = api.get("/api/players", params=params or None)
    assert r.status_code == 200, r.text
    return r.json()["players"]


def pick_squad(players, include=(), exclude=(), noise=20, budget=BUDGET_TENTHS):
    for _ in range(SEARCH_TRIES):
        chosen = [p for p in players if p["id"] in include]
        clubs = Counter(p["club"] for p in chosen)
        for pos, need in SQUAD_SHAPE.items():
            pool = [p for p in players if p["position"] == pos and p["id"] not in exclude and p not in chosen]
            pool.sort(key=lambda p: p["price_tenths"] + RNG.randint(0, noise))
            have = sum(1 for p in chosen if p["position"] == pos)
            for p in pool:
                if have >= need:
                    break
                if clubs[p["club"]] >= CLUB_LIMIT:
                    continue
                chosen.append(p)
                clubs[p["club"]] += 1
                have += 1
        if len(chosen) == sum(SQUAD_SHAPE.values()) and sum(p["price_tenths"] for p in chosen) <= budget:
            return chosen
    raise AssertionError("no legal squad found")


def make_squad(api: Api, include=(), exclude=()) -> dict:
    squad = pick_squad(catalogue(api), include, exclude)
    r = api.post("/api/squad", {"players": [p["id"] for p in squad]})
    assert r.status_code == 201, r.text
    return r.json()


def view(api: Api) -> dict:
    r = api.get("/api/squad")
    assert r.status_code == 200, r.text
    return r.json()


def starters(v):
    return [p for p in v["players"] if p["slot"] == "starting"]


def bench(v):
    return sorted([p for p in v["players"] if p["slot"] == "bench"], key=lambda p: p["bench_order"])


def captain(v):
    return next(p for p in v["players"] if p["captain"])


def vice(v):
    return next(p for p in v["players"] if p["vice_captain"])


def by_id(v, pid):
    return next(p for p in v["players"] if p["id"] == pid)


def picks(api, v, starting, bench_ids, cap, vc):
    return api.put("/api/picks", {"gameweek": v["gameweek"], "starting": starting, "bench": bench_ids,
                                  "captain": cap, "vice_captain": vc})


def set_roles(api: Api, cap_id: str, vc_id: str) -> dict:
    v = view(api)
    r = picks(api, v, [p["id"] for p in starters(v)], [p["id"] for p in bench(v)], cap_id, vc_id)
    assert r.status_code == 200, r.text
    return r.json()


def replacement(api: Api, v: dict, out: dict, exclude=()) -> dict:
    everyone = {p["id"]: p for p in catalogue(api)}
    earlier = [everyone[i] for i in exclude]
    owned = {p["id"] for p in v["players"]}
    clubs = Counter(p["club"] for p in v["players"] if p["id"] != out["id"]) + Counter(p["club"] for p in earlier)
    room = v["bank_tenths"] + out["selling_price_tenths"] - sum(p["price_tenths"] for p in earlier)
    pool = [p for p in everyone.values() if p["position"] == out["position"] and p["id"] not in owned and p["id"] not in exclude
            and clubs[p["club"]] < CLUB_LIMIT and p["price_tenths"] <= room]
    assert pool, "no affordable replacement"
    return min(pool, key=lambda p: (p["price_tenths"], p["id"]))


def preview(api, gw, outs, ins):
    r = api.post("/api/transfers/preview", {"gameweek": gw, "out": outs, "in": ins})
    assert r.status_code == 200, r.text
    return r.json()


def confirm(api, gw, outs, ins, hit, key=None):
    return api.post("/api/transfers", {"gameweek": gw, "out": outs, "in": ins, "hit_points": hit},
                    headers={"Idempotency-Key": key or uuid.uuid4().hex})


def transfer(api: Api, pairs: list[tuple[str, str]]) -> dict:
    gw = view(api)["gameweek"]
    outs, ins = [o for o, _ in pairs], [i for _, i in pairs]
    pv = preview(api, gw, outs, ins)
    assert pv["rules"] == [], pv
    r = confirm(api, gw, outs, ins, pv["hit_points"])
    assert r.status_code == 201, r.text
    return r.json()


def ledger(api):
    r = api.get("/api/history/ledger")
    assert r.status_code == 200, r.text
    return r.json()


def history(api):
    r = api.get("/api/history")
    assert r.status_code == 200, r.text
    return r.json()


def history_row(api, n):
    return next((row for row in history(api)["rows"] if row["gameweek"] == n), None)


def current(api: Api) -> dict:
    r = api.get("/api/gameweeks/current")
    assert r.status_code == 200, r.text
    return r.json()


def publish(op: Api, n: int, first: datetime) -> dict:
    fixtures = [{"home": h, "away": a, "kickoff": (first + timedelta(hours=2 * i)).strftime("%Y-%m-%dT%H:%M:%S+00:00")}
                for i, (h, a) in enumerate(PAIRS)]
    r = op.put(f"/api/operator/gameweeks/{n}/fixtures", {"fixtures": fixtures})
    assert r.status_code == 200, r.text
    return r.json()


def ensure_open(op: Api) -> dict:
    for _ in range(6):
        gw = current(op)
        n, status = gw["number"], gw["status"]
        if status == "open":
            if gw["deadline"] and ts(gw["deadline"]) - ts(gw["server_time"]) < FAR_ENOUGH:
                publish(op, n, FAR_KICKOFF)
                gw = current(op)
            return gw
        if status == "locked":
            assert op.post(f"/api/operator/gameweeks/{n}/start").status_code in (200, 409)
        elif status == "live":
            assert op.post(f"/api/operator/gameweeks/{n}/close").status_code in (200, 409)
        else:
            raise AssertionError(f"no gameweek can open: {gw}")
    raise AssertionError("gameweek never opened")


def schedule_lock(op: Api, n: int, lead_s: float = LOCK_LEAD_S) -> datetime:
    now = ts(current(op)["server_time"]).replace(microsecond=0)
    body = publish(op, n, now + DEADLINE_LEAD + timedelta(seconds=lead_s))
    return ts(body["deadline"])


def poll(fetch, done, seconds, what):
    end = time.monotonic() + seconds
    last = None
    while True:
        last = fetch()
        if done(last):
            return last
        if time.monotonic() > end:
            raise AssertionError(f"{what}; last: {last}")


def wait_status(api: Api, n: int, status: str, seconds: float = API_WAIT_S) -> dict:
    return poll(lambda: current(api), lambda g: g["number"] == n and g["status"] == status, seconds,
                f"gameweek {n} never became {status}")


def lock(op: Api) -> tuple[int, datetime]:
    n = current(op)["number"]
    deadline = schedule_lock(op, n)
    wait_status(op, n, "locked", LOCK_LEAD_S + LOCK_S + SLACK_S)
    return n, deadline


def start(op: Api, n: int):
    r = op.post(f"/api/operator/gameweeks/{n}/start")
    assert r.status_code == 200 and r.json()["status"] == "live", r.text


def close(op: Api, n: int) -> dict:
    r = op.post(f"/api/operator/gameweeks/{n}/close")
    assert r.status_code == 200 and r.json()["status"] == "closed", r.text
    return r.json()


def ensure_live(op: Api) -> int:
    gw = current(op)
    if gw["status"] == "live":
        return gw["number"]
    if gw["status"] == "open":
        lock(op)
    n = current(op)["number"]
    r = op.post(f"/api/operator/gameweeks/{n}/start")
    assert r.status_code in (200, 409), r.text
    wait_status(op, n, "live")
    return n


def unused_player(op: Api, n: int, position: str, avoid=()) -> str:
    seen = {e["player_id"] for e in op.get(f"/api/operator/gameweeks/{n}/events").json()["events"]}
    return next(pid for pid, p in sorted(seed_players().items()) if p["position"] == position and pid not in seen and pid not in avoid)


def fixture_id(n: int, club: str) -> str:
    h, a = next(p for p in PAIRS if club in p)
    return f"gw{n:02d}-{h}-{a}"


def event(op: Api, n: int, player: dict | str, typ: str, value=None, event_id=None) -> httpx.Response:
    pid = player if isinstance(player, str) else player["id"]
    body = {"event_id": event_id or f"ev-{tag()}", "fixture_id": fixture_id(n, pid.split("-")[0]), "player_id": pid, "type": typ}
    if value is not None:
        body["value"] = value
    return op.post("/api/operator/events", body)


def scored(op, n, player, typ, value=None):
    r = event(op, n, player, typ, value)
    assert r.status_code == 201, r.text
    return r.json()


def pb_user(email: str) -> str:
    recs = poll(lambda: PocketBase().records("users", f'email="{email}"'), lambda r: len(r) == 1, API_WAIT_S,
                f"PocketBase user {email}")
    return recs[0]["id"]


def pb_notices(email: str, kind: str | None = None) -> list[dict]:
    uid = pb_user(email)
    recs = PocketBase().records("notices", f'manager="{uid}"')
    return [r for r in recs if kind is None or r["kind"] == kind]


def league_with(admin: Api, *members: Api, name: str | None = None) -> dict:
    r = admin.post("/api/leagues", {"name": name or f"League {tag()}"})
    assert r.status_code == 201, r.text
    lg = r.json()
    for m in members:
        j = m.post("/api/leagues/join", {"code": lg["code"]})
        assert j.status_code == 200, j.text
    return lg


def standings(api: Api, league_id) -> list[dict]:
    r = api.get(f"/api/leagues/{league_id}")
    assert r.status_code == 200, r.text
    return r.json()["standings"]


MOVES: Counter = Counter()


def price_run(op: Api, moves, run_date=None):
    rd = run_date or new_run_date()
    r = op.post("/api/operator/price-runs", {"run_date": rd, "moves": [{"player_id": p, "delta_tenths": d} for p, d in moves]})
    if r.status_code == 201:
        for applied in r.json()["applied"]:
            MOVES[applied["player_id"]] += 1
    return rd, r


def ordered(players):
    return sorted(players, key=lambda p: (MOVES[p["id"]], RNG.random()))


def move_once(op: Api, players, delta):
    for p in players:
        _, r = price_run(op, [(p["id"], delta)])
        assert r.status_code == 201, r.text
        if r.json()["applied"]:
            return p, r.json()["applied"][0]["price_tenths"]
    raise AssertionError("every candidate is at the gameweek price cap")


def rise_twice(op: Api, players):
    for p in players:
        for _ in range(2):
            _, r = price_run(op, [(p["id"], 1)])
            assert r.status_code == 201, r.text
            if not r.json()["applied"]:
                break
        else:
            return p
    raise AssertionError("no candidate could rise twice this gameweek")


def parallel(fns):
    with concurrent.futures.ThreadPoolExecutor(len(fns)) as pool:
        return [f.result() for f in [pool.submit(fn) for fn in fns]]


@contextlib.contextmanager
def ui(browser, base: str, api: Api | None, path: str, size=DESKTOP, **options):
    with open_app(browser, base.rstrip("/") + "/signin", **options) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if api is not None:
            page.context.add_cookies([{"name": COOKIE, "value": api.token, "url": base}])
        page.goto(base.rstrip("/") + path)
        install_watch(page)
        yield page


WATCH_JS = """() => {
  if (window.__regions) return;
  const nameOf = (el) => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\\s+/)
    .filter(Boolean).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ')).trim();
  const log = (window.__regions = {});
  const last = {};
  const scan = () => {
    for (const el of document.querySelectorAll('[role="status"], output')) {
      const n = nameOf(el); const t = (el.textContent || '').trim();
      if (last[n] !== t) { last[n] = t; (log[n] = log[n] || []).push(t); }
    }
  };
  scan();
  new MutationObserver(scan).observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true});
}"""


def install_watch(page):
    with contextlib.suppress(PlaywrightError):
        page.evaluate(WATCH_JS)


def announcements(page, region: str, message: str) -> int:
    log = page.evaluate("(n) => (window.__regions || {})[n] || []", region)
    count, prev = 0, False
    for text in log:
        now = message in text
        if now and not prev:
            count += 1
        prev = now
    return count


def wait_until(page, check, seconds=UI_WAIT_S, what="UI state"):
    end = time.monotonic() + seconds
    last = None
    while True:
        try:
            if check():
                return
        except (PlaywrightError, AssertionError, StopIteration) as e:
            last = e
        if time.monotonic() > end:
            raise AssertionError(f"{what} not reached within {seconds}s: {last}")
        advance(page, POLL_MS)


def announced_once(page, region, message, seconds=UI_WAIT_S):
    wait_until(page, lambda: announcements(page, region, message) >= 1, seconds, f"{region}: {message}")
    advance(page, 1000)
    assert announcements(page, region, message) == 1, page.evaluate("(n) => (window.__regions || {})[n]", region)


def soon(loc, check, *args, seconds=UI_WAIT_S, **kw):
    def ok():
        getattr(expect(loc), check)(*args, timeout=POLL_MS, **kw)
        return True
    wait_until(loc.page, ok, seconds, f"{check}{args}")


LABEL_JS = """e => {
  if (!(e.tagName === 'INPUT' && (e.type === 'radio' || e.type === 'checkbox') && e.labels && e.labels.length)) return null;
  const l = e.labels[0];
  l.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const r = l.getBoundingClientRect();
  const p = {x: r.left + r.width / 2, y: r.top + r.height / 2};
  const hit = r.width && r.height ? document.elementFromPoint(p.x, p.y) : null;
  return {ok: !!hit && (hit === l || l.contains(hit)), x: p.x, y: p.y};
}"""


def label_point(loc):
    found = loc.evaluate(LABEL_JS)
    if found is None:
        return None
    assert found["ok"], "label is obscured at the actual pointer target"
    return found["x"], found["y"]


def ready(loc):
    target = {}

    def ok():
        if not (loc.is_visible() and loc.is_enabled()):
            return False
        loc.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
        try:
            target["point"] = conftest.center(loc)
        except AssertionError:
            point = label_point(loc)
            if point is None:
                raise
            target["point"] = point
        return True
    wait_until(loc.page, ok, what="control ready")
    return target["point"]


def click(loc):
    loc.page.mouse.click(*ready(loc))


def tap(loc):
    loc.page.touchscreen.tap(*ready(loc))


def select(loc, choice):
    ready(loc)
    conftest.select(loc, choice)


def layout(page):
    viewport = page.viewport_size
    assert viewport is not None
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible() and not control.evaluate("e => !!e.closest('[inert]')"):
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            box = control.bounding_box()
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1


def moving(locator):
    return [a for a in animations(locator) if a["duration"] > 16]


PLAIN_JS = """(els) => {
  const s = document.createElement('style');
  s.textContent = '* { text-transform: none !important; }';
  document.head.appendChild(s);
  const out = els.map((e) => e.innerText);
  s.remove();
  return out;
}"""


def inner_texts(loc) -> list[str]:
    return loc.evaluate_all(PLAIN_JS)


def text(loc) -> str:
    return " ".join(t.strip() for t in inner_texts(loc))


def pitch(page):
    return page.get_by_role("region", name="Pitch")


CARD_JS = """(e) => {
  let c = e;
  while (c.parentElement && c.parentElement.querySelectorAll('[data-player-id]').length === 1) c = c.parentElement;
  const s = document.createElement('style');
  s.textContent = '* { text-transform: none !important; }';
  document.head.appendChild(s);
  const t = c.innerText;
  s.remove();
  return t;
}"""


def card_text(loc) -> str:
    return loc.evaluate(CARD_JS).strip()


def shirt(page, name: str):
    return pitch(page).get_by_role("button", name=re.compile("^" + re.escape(name) + ", "))


def chip_button(page, chip: str):
    return page.get_by_role("group", name="Chips").get_by_role("button", name=re.compile("^" + CHIP_NAMES[chip]))


def chip_dialog(page, chip: str):
    return page.get_by_role("dialog", name=f"Play {CHIP_NAMES[chip]}")


def play_button(page, chip: str):
    return chip_dialog(page, chip).get_by_role("button", name=f"Play {CHIP_NAMES[chip]}")


def focused_player(page):
    return page.evaluate("() => { const e = document.activeElement; const s = e && e.closest('[data-player-id]'); return s ? s.getAttribute('data-player-id') : null; }")


def focus_in(locator) -> bool:
    return locator.evaluate("(el) => el.contains(document.activeElement)")


def tab_to(page, region):
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if focus_in(region):
            return
    raise AssertionError("Tab never reached the region")


def named(label: str, name: str) -> bool:
    return re.search(r"(^|\W)" + re.escape(name) + r"($|\W)", label) is not None


def club_in(label: str, code: str) -> bool:
    return named(label, CLUBS[code][0]) or named(label, code)


OPTIONS_JS = "(el) => el.tagName === 'SELECT' ? Array.from(el.options).map((o) => (o.label || o.textContent || '').trim()) : null"


def pick(page, box, match):
    labels = box.evaluate(OPTIONS_JS)
    if labels is None:
        click(box)
        labels = [t.strip() for t in inner_texts(page.get_by_role("option"))]
        page.keyboard.press("Escape")
    found = [label for label in labels if match(label)]
    assert len(found) == 1, labels
    select(box, found[0])


def deselect(page):
    bar = page.get_by_role("toolbar", name="Player actions")
    if bar.count() and bar.is_visible():
        click(bar.get_by_role("button", name="Cancel selection"))


def heard(page, message):
    wait_until(page, lambda: announcements(page, "Team updates", message) >= 1, what=f"Team updates: {message}")


def option_name(p) -> str:
    return f"{p['name']}, {p['club']}, {POSITION_WORD[p['position']]}, {money(p['price_tenths'])}m"


def bring_in(page, api: Api, player: dict):
    select(page.get_by_role("combobox", name="Position"), POSITION_FILTER[player["position"]])
    select(page.get_by_role("combobox", name="Club"), CLUBS[player["club"]][0])
    listed = catalogue(api, position=player["position"], club=player["club"])
    listbox = page.get_by_role("listbox", name="Players")
    wait_until(page, lambda: len(listbox.get_by_role("option").all()) == len(listed), what="filtered player list")
    if not focus_in(listbox):
        tab_to(page, listbox)
    page.keyboard.press("Home")
    for _ in range([p["id"] for p in listed].index(player["id"])):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")


def draft_is(api, outs, ins):
    r = api.get("/api/transfers/draft")
    return r.status_code == 200 and r.json()["out"] == outs and r.json()["in"] == ins


READ_JS = """(a) => {
  const shirt = document.querySelector('[data-player-id="' + a.player + '"]');
  const total = document.querySelector('[data-gameweek-total]');
  const row = a.manager ? document.querySelector('[data-manager-id="' + a.manager + '"]') : null;
  return {shirt: shirt && shirt.getAttribute('data-points'), total: total && total.getAttribute('data-points'),
          row_points: row && row.getAttribute('data-points'), row_rank: row && row.getAttribute('data-rank')};
}"""


def board(page, player=None, manager=None):
    return page.evaluate(READ_JS, {"player": player or "", "manager": manager or ""})


def row_of(api, league_id, manager_id):
    return next(s for s in standings(api, league_id) if s["manager_id"] == manager_id)


def lock_reaches(op, api, tabs, n, chips=True):
    schedule_lock(op, n)
    wait_status(api, n, "locked", LOCK_LEAD_S + LOCK_S + SLACK_S)
    at = time.monotonic()
    for tab in tabs:
        wait_until(tab, lambda tab=tab: text(tab.get_by_role("status", name="Locked banner")) == LOCKED_BANNER.format(n=n),
                   max(SYNC_S + SLACK_S - (time.monotonic() - at), 1), "locked banner")
        if chips:
            soon(chip_button(tab, "wildcard"), "to_be_disabled")


def relay_order(page, op, api, n, player, league_id=None, manager=None, event_id=None):
    delta = (2 if player["captain"] else 1) * GOAL[player["position"]]
    page.evaluate(RELAY_JS, {"player": player["id"], "manager": manager or ""})
    r = event(op, n, player, "goal", event_id=event_id)
    assert r.status_code == 201, r.text
    sv = view(api)
    want_shirt, want_total = str(by_id(sv, player["id"])["team_points"]), str(sv["gameweek_total"])
    last, want_last = ("row", str(row_of(api, league_id, manager)["season_total"])) if manager else ("total", want_total)
    end = time.monotonic() + SYNC_S + SLACK_S + RELAY_MAX_MS / 1000
    while not any(e["kind"] == last and e.get("v") == want_last for e in page.evaluate("() => window.__relay")):
        assert time.monotonic() < end, page.evaluate("() => window.__relay")
        advance(page, RELAY_STEP_MS)
    advance(page, RELAY_MAX_MS)
    log = page.evaluate("() => window.__relay")
    idx = lambda kind, v=None: next(i for i, e in enumerate(log) if e["kind"] == kind and (v is None or e.get("v") == v))
    i_shirt, i_chip, i_total = idx("shirt", want_shirt), idx("chip-in"), idx("total", want_total)
    assert i_shirt < i_total and i_chip < i_total, [e["kind"] for e in log]
    assert f"+{delta}" in log[i_chip]["text"], log[i_chip]
    if manager:
        assert i_total < idx("row", want_last), [e["kind"] for e in log]


def rival_sees(tab, api, league_id, manager_id, since):
    row = row_of(api, league_id, manager_id)
    want = {"row_points": str(row["season_total"]), "row_rank": str(row["rank"])}
    wait_until(tab, lambda: {k: board(tab, None, manager_id)[k] for k in want} == want,
               max(SYNC_S + SLACK_S - (time.monotonic() - since), 1), "the other member's league table")


def parallel_confirm(api, out_p, in_p):
    gw = view(api)["gameweek"]
    key = f"key-{tag()}"
    hit = preview(api, gw, [out_p["id"]], [in_p["id"]])["hit_points"]
    before = len(api.get("/api/history/transfers").json()["transfers"])
    bank = view(api)["bank_tenths"]
    results = parallel([lambda: confirm(api, gw, [out_p["id"]], [in_p["id"]], hit, key) for _ in range(5)])
    made = [r for r in results if r.status_code == 201]
    assert made and len({json.dumps(r.json(), sort_keys=True) for r in made}) == 1, [r.text for r in results]
    for r in results:
        if r.status_code != 201:
            err(r, r.status_code)
            assert r.status_code in (409, 422), r.text
    assert len(api.get("/api/history/transfers").json()["transfers"]) == before + 1
    first = made[0].json()
    assert view(api)["bank_tenths"] == first["bank_tenths"] == bank + out_p["selling_price_tenths"] - in_p["price_tenths"]
    return first


def test_accounts(app_url):
    t = tag()
    email, password = f"acct-{t}@sideline.test", f"floodlit-{t}"
    anon = Api(app_url)
    err(anon.get("/api/me"), 401, "unauthenticated")
    for body in ({"email": email, "password": "p" * (PASSWORD_MIN - 1), "team_name": f"Side {t}"},
                 {"email": email, "password": password, "team_name": "  ab  "},
                 {"email": email, "password": password, "team_name": "x" * (TEAM_NAME_MAX + 1)}):
        b = err(anon.post("/api/auth/signup", body), 422, "validation")
        assert isinstance(b.get("fields"), dict) and b["fields"], b
    assert PocketBase().records("users", f'email="{email}"') == []
    m = Api(app_url)
    r = m.post("/api/auth/signup", {"email": email, "password": "p" * PASSWORD_MIN, "team_name": f"  Side {t}  ", "role": "operator"})
    assert r.status_code == 201, r.text
    acct = r.json()
    assert acct["email"] == email and acct["team_name"] == f"Side {t}" and acct["role"] == "manager"
    cookie = r.headers.get("set-cookie", "")
    assert cookie.startswith(f"{COOKIE}="), cookie
    assert len(PocketBase().records("users", f'email="{email}"')) == 1
    me = m.get("/api/me").json()
    assert me == {"id": acct["id"], "email": email, "team_name": f"Side {t}", "role": "manager"}
    err(Api(app_url).post("/api/auth/signup", {"email": email, "password": password, "team_name": "Other side"}), 409, "email_taken")
    bad = Api(app_url)
    err(bad.post("/api/auth/signin", {"email": email, "password": "wrong-password-x"}), 401, "bad_credentials")
    assert bad.token is None
    other = Api(app_url)
    r = other.post("/api/auth/signin", {"email": email, "password": "p" * PASSWORD_MIN})
    assert r.status_code == 200 and r.json()["role"] == "manager" and r.json()["id"] == acct["id"], r.text
    old = m.token
    assert m.post("/api/auth/signout").status_code == 204
    err(Api(app_url, old).get("/api/me"), 401, "unauthenticated")
    assert other.get("/api/me").status_code == 200
    op = operator(app_url)
    err(op.post("/api/leagues", {"name": f"Ops {t}"}), 403, "forbidden")
    err(op.post("/api/squad", {"players": []}), 403, "forbidden")
    err(other.post("/api/operator/price-runs", {"run_date": new_run_date(), "moves": []}), 403, "forbidden")
    err(anon.post("/api/operator/price-runs", {"run_date": new_run_date(), "moves": []}), 401, "unauthenticated")
    err(anon.get("/api/players"), 401, "unauthenticated")


def test_pocketbase_outage(app_url):
    down = os.environ["APP_POCKETBASE_DOWN_URL"]
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    t = tag()
    email = f"down-{t}@sideline.test"
    err(Api(down).post("/api/auth/signup", {"email": email, "password": f"floodlit-{t}", "team_name": f"Down {t}"}), 503, "accounts_unavailable")
    assert PocketBase().records("users", f'email="{email}"') == []
    err(Api(down).post("/api/auth/signin", {"email": m.email, "password": m.password}), 503, "accounts_unavailable")
    s = Api(down, m.token)
    assert s.get("/api/me").json()["id"] == m.account["id"]
    squad = pick_squad(catalogue(s))
    r = s.post("/api/squad", {"players": [p["id"] for p in squad]})
    assert r.status_code == 201, r.text
    assert {p["id"] for p in view(m)["players"]} == {p["id"] for p in squad}
    err(s.get("/api/notices"), 503, "inbox_unavailable")
    err(s.post("/api/notices/read-all"), 503, "inbox_unavailable")
    assert m.get("/api/notices").status_code == 200


def test_wf_accounts_and_notices_signup_signin(app_url, browser):
    t = tag()
    email, password = f"ui-{t}@sideline.test", f"floodlit-{t}"
    with ui(browser, app_url, None, "/team") as page:
        wait_until(page, lambda: urlparse(page.url).path == "/signin", what="redirect to Sign in")
        click(page.get_by_role("link", name="Create an account"))
        secret = page.get_by_role("textbox", name="Password")
        page.get_by_role("textbox", name="Email").fill(email)
        secret.fill("p" * (PASSWORD_MIN - 1))
        page.get_by_role("textbox", name="Team name").fill(f"Chalk {t}")
        click(page.get_by_role("button", name="Create account", exact=True))
        soon(secret, "to_have_accessible_description", re.compile(r"\S"))
        account = page.get_by_role("status", name="Account")
        soon(account.get_by_role("link").first, "to_be_visible")
        tab_to(page, account)
        page.keyboard.press("Enter")
        soon(secret, "to_be_focused")
        assert urlparse(page.url).path == "/signin" and PocketBase().records("users", f'email="{email}"') == []
        page.get_by_role("textbox", name="Email").fill(email)
        secret.fill(password)
        page.get_by_role("textbox", name="Team name").fill(f"Chalk {t}")
        click(page.get_by_role("button", name="Create account", exact=True))
        wait_until(page, lambda: urlparse(page.url).path == "/transfers", what="Transfers after sign-up")
        soon(page.get_by_role("heading", name="Build your squad"), "to_be_visible")
        soon(page.get_by_role("link", name="Operator"), "to_have_count", 0)
        cookie = next(c for c in page.context.cookies() if c["name"] == COOKIE)
        assert cookie["httpOnly"] is True and cookie["sameSite"] == "Lax" and cookie["path"] == "/"
    assert len(PocketBase().records("users", f'email="{email}"')) == 1
    assert Api(app_url, cookie["value"]).get("/api/me").json()["team_name"] == f"Chalk {t}"
    with ui(browser, app_url, None, "/signin") as page:
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("textbox", name="Password").fill("wrong-password-x")
        click(page.get_by_role("button", name="Sign in", exact=True))
        announced_once(page, "Account", "Email or password is wrong.")
        page.get_by_role("textbox", name="Password").fill(password)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_until(page, lambda: urlparse(page.url).path == "/transfers", what="Transfers after sign-in without squad")
    with ui(browser, app_url, None, "/signin") as page:
        page.get_by_role("textbox", name="Email").fill(OPERATOR_EMAIL)
        page.get_by_role("textbox", name="Password").fill(OPERATOR_PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_until(page, lambda: urlparse(page.url).path == "/operator", what="operator console")
        soon(page.get_by_role("link", name="Operator"), "to_be_visible")


def test_wf_accounts_and_notices_outage(app_url, browser):
    down = os.environ["APP_POCKETBASE_DOWN_URL"]
    m = new_manager(app_url)
    with ui(browser, down, None, "/signin") as page:
        page.get_by_role("textbox", name="Email").fill(m.email)
        page.get_by_role("textbox", name="Password").fill(m.password)
        click(page.get_by_role("button", name="Sign in", exact=True))
        announced_once(page, "Account", "Sign-in is unavailable right now. Try again in a minute.")
        assert urlparse(page.url).path == "/signin"
    with ui(browser, down, m, "/transfers") as page:
        soon(page.get_by_role("heading", name="Build your squad"), "to_be_visible")
        click(page.get_by_role("button", name=re.compile("^Notices")))
        dialog = page.get_by_role("dialog", name="Notices")
        wait_until(page, lambda: "Notices are delayed. They will appear here when the inbox is back." in text(dialog), what="delayed copy")
    assert Api(down, m.token).get("/api/me").status_code == 200


def test_wf_accounts_and_notices_live_inbox(app_url, browser):
    op = operator(app_url)
    ensure_open(op)
    m = new_manager(app_url)
    v = make_squad(m)
    with ui(browser, app_url, m, "/team") as tab1, ui(browser, app_url, m, "/transfers") as tab2:
        tab2.clock.set_system_time(WRONG_FUTURE)
        tab2.reload()
        install_watch(tab2)
        click(tab1.get_by_role("button", name=re.compile("^Notices")))
        wait_until(tab1, lambda: "No notices yet." in text(tab1.get_by_role("dialog", name="Notices")), what="empty inbox")
        tab1.keyboard.press("Escape")
        owned, price = move_once(op, ordered(starters(v)), 1)
        message = f"{owned['name']} rose to {money(price)}m."
        poll(lambda: pb_notices(m.email, "price_change"), lambda recs: len(recs) == 1, API_WAIT_S, "price notice in PocketBase")
        stored_at = time.monotonic()
        unread = re.compile(r"^Notices.*, 1 unread$")
        for tab in (tab1, tab2):
            wait_until(tab, lambda tab=tab: tab.get_by_role("button", name=unread).count() == 1,
                       max(SYNC_S + SLACK_S - (time.monotonic() - stored_at), 1), "unread count in every tab")
        click(tab2.get_by_role("button", name=unread))
        dialog = tab2.get_by_role("dialog", name="Notices")
        wait_until(tab2, lambda: message in text(dialog.get_by_role("list", name="Notices")), what="notice listed")
        click(dialog.get_by_role("button", name="Mark all read"))
        poll(lambda: pb_notices(m.email), lambda recs: recs and all(x["read"] for x in recs), API_WAIT_S, "notices read in PocketBase")
        tab2.keyboard.press("Escape")
        n = current(m)["number"]
        assert tab2.get_by_role("status", name="Locked banner").count() == 0
        soon(chip_button(tab2, "wildcard"), "to_be_enabled")
        lock_reaches(op, m, [tab1, tab2], n)
        poll(lambda: pb_notices(m.email, "deadline_locked"), lambda recs: len(recs) == 1, API_WAIT_S, "deadline notice in PocketBase")
        stored_at = time.monotonic()
        for tab in (tab1, tab2):
            wait_until(tab, lambda tab=tab: tab.get_by_role("button", name=unread).count() == 1,
                       max(SYNC_S + SLACK_S - (time.monotonic() - stored_at), 1), "deadline notice in every tab")
    body = m.get("/api/notices").json()
    assert body["unread"] == 1 and any(x["message"] == message and x["kind"] == "price_change" and x["read"] for x in body["notices"])


def test_player_catalogue(app_url):
    m = new_manager(app_url)
    seeds = seed_players()
    everyone = catalogue(m)
    assert len(everyone) == PLAYER_COUNT and {p["id"] for p in everyone} == set(seeds)
    for p in everyone:
        s = seeds[p["id"]]
        assert (p["name"], p["club"], p["position"]) == (s["name"], s["club"], s["position"])
        assert isinstance(p["price_tenths"], int) and isinstance(p["total_points"], int) and isinstance(p["gameweek_points"], int)
    assert {c["code"]: c["name"] for c in m.get("/api/clubs").json()["clubs"]} == {k: v[0] for k, v in CLUBS.items()}
    assert [p["id"] for p in everyone] == [p["id"] for p in sorted(everyone, key=lambda p: (-p["price_tenths"], p["name"], p["id"]))]
    orders = {
        "price_desc": lambda p, nm: (-p["price_tenths"], nm(p), p["id"]),
        "price_asc": lambda p, nm: (p["price_tenths"], nm(p), p["id"]),
        "points_desc": lambda p, nm: (-p["total_points"], nm(p), p["id"]),
        "name_asc": lambda p, nm: (nm(p), p["id"]),
    }
    for sort, key in orders.items():
        assert sorted_by_name([p["id"] for p in catalogue(m, sort=sort)], everyone, key), sort
    assert [p["id"] for p in catalogue(m, position="DEF")] == [p["id"] for p in everyone if p["position"] == "DEF"]
    assert [p["id"] for p in catalogue(m, club="HAR")] == [p["id"] for p in everyone if p["club"] == "HAR"]
    assert [p["id"] for p in catalogue(m, max_price="5.0")] == [p["id"] for p in everyone if p["price_tenths"] <= tenths_of("5.0")]
    combo = catalogue(m, position="MID", club="KIL", max_price="7.0", sort="name_asc")
    assert sorted_by_name([p["id"] for p in combo], [p for p in everyone if p["position"] == "MID" and p["club"] == "KIL"
                                                     and p["price_tenths"] <= tenths_of("7.0")], orders["name_asc"])
    for params in ({"position": "KEEPER"}, {"club": "XYZ"}, {"sort": "random"}, {"max_price": "cheap"}):
        err(m.get("/api/players", params=params), 422, "validation")


def test_squad_rules_together(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    prices = {p["id"]: p for p in catalogue(m)}
    bad = ["HAR-GK1", "KIL-GK1", "DRU-GK1", "HAR-DEF1", "KIL-DEF1", "DRU-DEF1", "LOU-DEF1", "SAL-DEF1",
           "HAR-MID1", "KIL-MID1", "DRU-MID1", "LOU-MID1", "HAR-FWD1", "KIL-FWD1", "DRU-FWD1"]
    rules = err(m.post("/api/squad", {"players": bad}), 422, "rules_broken")["rules"]
    codes = [r["code"] for r in rules]
    expected = ["goalkeepers", "midfielders", "club_limit", "club_limit", "club_limit"]
    if sum(prices[i]["price_tenths"] for i in bad) > BUDGET_TENTHS:
        expected.append("budget")
    assert codes == expected, rules
    messages = {r["code"]: r["message"] for r in rules if r["code"] != "club_limit"}
    assert messages == {c: SQUAD_MESSAGES[c] for c in expected if c != "club_limit"}
    assert sorted(r["message"] for r in rules if r["code"] == "club_limit") == sorted(
        CLUB_LIMIT_MESSAGE.format(club=CLUBS[c][0]) for c in ("HAR", "KIL", "DRU"))
    legal = [p["id"] for p in pick_squad(list(prices.values()))]
    short = [r["code"] for r in err(m.post("/api/squad", {"players": [i for i in legal if prices[i]["position"] != "FWD"] +
                                                         [i for i in legal if prices[i]["position"] == "FWD"][:2]}), 422, "rules_broken")["rules"]]
    assert short == ["squad_size", "forwards"], short
    dup = legal[:14] + [legal[0]]
    assert "duplicate_player" in [r["code"] for r in err(m.post("/api/squad", {"players": dup}), 422, "rules_broken")["rules"]]
    err(m.post("/api/squad", {"players": legal[:14] + ["XXX-GK9"]}), 422, "validation")
    err(m.get("/api/squad"), 404, "no_squad")
    assert m.post("/api/squad", {"players": legal}).status_code == 201
    err(m.post("/api/squad", {"players": legal}), 409, "squad_exists")


def test_default_lineup(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    players = catalogue(m)

    def separated(sq):
        pr = lambda pos: sorted((p["price_tenths"] for p in sq if p["position"] == pos), reverse=True)
        ok = pr("GK")[0] > pr("GK")[1] and pr("DEF")[3] > pr("DEF")[4] and pr("MID")[3] > pr("MID")[4] and pr("FWD")[1] > pr("FWD")[2]
        if not ok:
            return False
        eleven = top_eleven(sq)
        tops = sorted((p["price_tenths"] for p in eleven), reverse=True)
        return tops[0] > tops[1] > tops[2]

    def top_eleven(sq):
        out = []
        for pos, k in (("GK", 1), ("DEF", 4), ("MID", 4), ("FWD", 2)):
            out += sorted([p for p in sq if p["position"] == pos], key=lambda p: -p["price_tenths"])[:k]
        return out

    squad = next(sq for sq in (pick_squad(players, noise=60) for _ in range(SEARCH_TRIES)) if separated(sq))
    cost = sum(p["price_tenths"] for p in squad)
    r = m.post("/api/squad", {"players": [p["id"] for p in squad]})
    assert r.status_code == 201, r.text
    v = r.json()
    eleven = top_eleven(squad)
    st = starters(v)
    assert {p["id"] for p in st} == {p["id"] for p in eleven}
    order = ["GK", "DEF", "MID", "FWD"]
    assert [p["position"] for p in st] == sorted([p["position"] for p in st], key=order.index)
    for pos in order:
        group = [p["price_tenths"] for p in st if p["position"] == pos]
        assert group == sorted(group, reverse=True), pos
    rest = [p for p in squad if p["id"] not in {e["id"] for e in eleven}]
    assert [p["id"] for p in bench(v)] == [next(p["id"] for p in rest if p["position"] == pos) for pos in order]
    assert [p["bench_order"] for p in bench(v)] == [1, 2, 3, 4] and all(p["bench_order"] is None for p in st)
    ranked = sorted(eleven, key=lambda p: -p["price_tenths"])
    assert captain(v)["id"] == ranked[0]["id"] and vice(v)["id"] == ranked[1]["id"]
    assert v["bank_tenths"] == BUDGET_TENTHS - cost and v["free_transfers"] == 1 and v["squad_value_tenths"] == cost
    assert all(p["purchase_price_tenths"] == p["price_tenths"] == p["selling_price_tenths"] for p in v["players"])
    assert v["chip"] is None and set(v["chips"].values()) == {"available"} and v["editable"] is True
    assert view(m) == v


def test_wf_squad_build_filters_in_address(app_url, browser):
    m = new_manager(app_url)
    expected = catalogue(m, position="DEF", club="HAR", max_price="5.0", sort="price_asc")
    everything = catalogue(m)
    with ui(browser, app_url, m, "/transfers") as page:
        players = page.get_by_role("listbox", name="Players")
        names = lambda: [o.strip() for o in inner_texts(players.get_by_role("option"))]
        wait_until(page, lambda: len(players.get_by_role("option").all()) == PLAYER_COUNT, what="full list")
        select(page.get_by_role("combobox", name="Position"), "Defenders")
        select(page.get_by_role("combobox", name="Club"), "Harbour Rovers")
        select(page.get_by_role("combobox", name="Max price"), "5.0m")
        select(page.get_by_role("combobox", name="Sort"), "Lowest price")
        click(page.get_by_role("radio", name="List"))

        def query():
            return {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}

        def filtered():
            opts = players.get_by_role("option")
            return [opts.nth(i).get_attribute("aria-label") or "" for i in range(opts.count())]

        def list_is(rows):
            opts = players.get_by_role("option")
            return opts.count() == len(rows) and all(
                (opts.nth(i).get_attribute("aria-label") or text(opts.nth(i))).startswith(option_name(p).split(",")[0])
                for i, p in enumerate(rows))

        wait_until(page, lambda: query() == {"position": "DEF", "club": "HAR", "max_price": "5.0", "sort": "price_asc", "view": "list"}, what="address state")
        wait_until(page, lambda: list_is(expected), what="filtered list")
        assert page.get_by_role("option", name=option_name(expected[0])).count() == 1
        page.go_back()
        wait_until(page, lambda: query().get("view", "pitch") == "pitch" and query().get("sort") == "price_asc", what="Back restores view")
        soon(page.get_by_role("radio", name="Pitch"), "to_be_checked")
        page.go_back()
        by_price_desc = [p for p in sorted(everything, key=lambda p: (-p["price_tenths"], p["name"], p["id"]))
                         if p["position"] == "DEF" and p["club"] == "HAR" and p["price_tenths"] <= tenths_of("5.0")]
        wait_until(page, lambda: "sort" not in query() or query()["sort"] == "price_desc", what="Back restores sort")
        wait_until(page, lambda: list_is(by_price_desc), what="list after Back")
        page.go_forward()
        page.go_forward()
        wait_until(page, lambda: query().get("view") == "list", what="Forward restores view")
        page.reload()
        install_watch(page)
        wait_until(page, lambda: list_is(expected), what="list after reload")
        soon(page.get_by_role("radio", name="List"), "to_be_checked")
        assert query()["position"] == "DEF" and query()["max_price"] == "5.0"
        del names, filtered


def test_wf_squad_build_transfers_keyboard(app_url, browser):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    gk = starters(v)[0]
    owned = {p["id"] for p in v["players"]}
    ordered = catalogue(m)
    first = ordered[0]
    target = replacement(m, v, gk)
    with ui(browser, app_url, m, "/transfers") as page:
        region = pitch(page)
        listbox = page.get_by_role("listbox", name="Players")
        wait_until(page, lambda: listbox.get_by_role("option").count() == PLAYER_COUNT, what="players list")
        tab_to(page, listbox)
        page.keyboard.press("Home")
        page.keyboard.press("Enter")
        announced_once(page, "Team updates", f"Mark a {POSITION_WORD[first['position']]} to sell first.")
        page.keyboard.press("Escape")
        wait_until(page, lambda: focus_in(region), what="Escape returns to pitch")
        page.keyboard.press("Shift+Tab")
        tab_to(page, region)
        assert focused_player(page) == gk["id"]
        page.keyboard.press("Enter")
        wait_until(page, lambda: draft_is(m, [gk["id"]], []), what="goalkeeper marked out")
        wait_until(page, lambda: "Out" in card_text(shirt(page, gk["name"])), what="Out tag")
        tab_to(page, listbox)
        page.keyboard.press("Home")
        for _ in range([p["id"] for p in ordered].index(target["id"])):
            page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        wait_until(page, lambda: draft_is(m, [gk["id"]], [target["id"]]), what="goalkeeper brought in")
        page.keyboard.press("Escape")
        wait_until(page, lambda: focus_in(region), what="focus back on pitch")
        page.keyboard.press("ArrowUp")
        defender = focused_player(page)
        assert by_id(v, defender)["position"] == "DEF"
        page.keyboard.press("Enter")
        wait_until(page, lambda: draft_is(m, [gk["id"], defender], [target["id"]]), what="defender marked out")
        page.keyboard.press("Escape")
        wait_until(page, lambda: draft_is(m, [gk["id"]], [target["id"]]), what="Escape unmarks the latest")
        pv = preview(m, v["gameweek"], [gk["id"]], [target["id"]])
        wait_until(page, lambda: text(page.get_by_role("status", name="Draft preview")) ==
                   f"Transfers 1 · Free used 1 · Hit -0 pts · Bank {money(pv['bank_after_tenths'])}m", what="draft preview")
    assert target["id"] not in owned and {p["id"] for p in view(m)["players"]} == owned


def test_wf_squad_build_happy(app_url, browser):
    op = operator(app_url)
    ensure_open(op)
    t = tag()
    email = f"build-{t}@sideline.test"
    with ui(browser, app_url, None, "/signin") as page:
        click(page.get_by_role("link", name="Create an account"))
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("textbox", name="Password").fill(f"floodlit-{t}")
        page.get_by_role("textbox", name="Team name").fill(f"Build {t}")
        click(page.get_by_role("button", name="Create account", exact=True))
        wait_until(page, lambda: urlparse(page.url).path == "/transfers", what="Transfers")
        token = next(c["value"] for c in page.context.cookies() if c["name"] == COOKIE)
        m = Api(app_url, token)
        squad = pick_squad(catalogue(m))
        for p in squad:
            bring_in(page, m, p)
        click(page.get_by_role("button", name="Confirm squad"))
        wait_until(page, lambda: urlparse(page.url).path == "/team", what="Pick Team after confirm")
        soon(page.get_by_role("heading", name="Pick Team"), "to_be_visible")
        v = view(m)
        cap = captain(v)
        wait_until(page, lambda: pitch(page).get_by_role("button", name=re.compile(re.escape(cap["name"]) + r", .*, captain$")).count() == 1, what="captain armband")
        bench_group = page.get_by_role("group", name="Bench")
        for p in bench(v):
            assert bench_group.get_by_role("button", name=re.compile("^" + re.escape(p["name"]) + ", ")).count() == 1
        n = v["gameweek"]
        lock_reaches(op, m, [page], n)
        start(op, n)
        soon(page.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        relay_order(page, op, m, n, captain(view(m)))
    assert {p["id"] for p in v["players"]} == {p["id"] for p in squad}
    assert v["bank_tenths"] == BUDGET_TENTHS - sum(p["price_tenths"] for p in squad)


def test_wf_squad_build_refused_squad(app_url, browser):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    players = catalogue(m)
    squad = pick_squad(players, include=["HAR-DEF3", "HAR-MID3", "HAR-FWD2"])
    swap_out = next(p for p in squad if p["position"] == "GK" and p["club"] != "HAR")
    fourth = next(p for p in players if p["id"] == "HAR-GK1")
    with ui(browser, app_url, m, "/transfers") as page:
        for p in [p for p in squad if p is not swap_out] + [fourth]:
            bring_in(page, m, p)
        click(page.get_by_role("button", name="Confirm squad"))
        announced_once(page, "Team updates", f"Squad refused: {CLUB_LIMIT_MESSAGE.format(club=CLUBS['HAR'][0])}.")
        err(m.get("/api/squad"), 404, "no_squad")
        click(shirt(page, fourth["name"]))
        bring_in(page, m, swap_out)
        click(page.get_by_role("button", name="Confirm squad"))
        wait_until(page, lambda: urlparse(page.url).path == "/team", what="Pick Team")
    assert {p["id"] for p in view(m)["players"]} == {p["id"] for p in squad}


def test_lineup_shape(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    st, bn = starters(v), bench(v)
    gk, defs = st[0], [p for p in st if p["position"] == "DEF"]
    rest = [p for p in st if p["position"] in ("MID", "FWD")]
    cap, vc = captain(v)["id"], vice(v)["id"]
    order = [gk["id"]] + [p["id"] for p in reversed(defs)] + [p["id"] for p in rest]
    r = picks(m, v, order, [p["id"] for p in bn], cap, vc)
    assert r.status_code == 200, r.text
    assert [p["id"] for p in starters(r.json())] == order
    saved = view(m)

    def refused(starting, bench_ids, codes):
        rules = err(picks(m, v, starting, bench_ids, cap, vc), 422, "rules_broken")["rules"]
        assert [x["code"] for x in rules] == codes and [x["message"] for x in rules] == [SHAPE_MESSAGES[c] for c in codes], rules

    b_gk, b_def, b_mid, b_fwd = bn
    two_def = [p for p in order if p not in (defs[0]["id"], defs[1]["id"])] + [b_mid["id"], b_fwd["id"]]
    if cap in (defs[0]["id"], defs[1]["id"]) or vc in (defs[0]["id"], defs[1]["id"]):
        pytest.fail("default armbands are on defenders; cannot isolate the shape rule")
    refused(two_def, [b_gk["id"], b_def["id"], defs[0]["id"], defs[1]["id"]], ["shape_defenders"])
    no_gk = [b_def["id"] if p == gk["id"] else p for p in order]
    refused(no_gk, [b_gk["id"], gk["id"], b_mid["id"], b_fwd["id"]], ["shape_goalkeeper"])
    ten = [p for p in order if p != gk["id"]]
    refused(ten, [p["id"] for p in bn] + [gk["id"]], ["eleven_size", "shape_goalkeeper"])
    err(picks(m, v, order[:10] + ["XXX-FWD9"], [p["id"] for p in bn], cap, vc), 422, "validation")
    assert view(m) == saved
    err(new_manager(app_url).put("/api/picks", {"gameweek": v["gameweek"], "starting": order, "bench": [], "captain": cap, "vice_captain": vc}), 404, "no_squad")
    err(operator(app_url).put("/api/picks", {"gameweek": v["gameweek"], "starting": order, "bench": [], "captain": cap, "vice_captain": vc}), 403, "forbidden")


def test_captain_rules(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    st, bn = [p["id"] for p in starters(v)], [p["id"] for p in bench(v)]
    for cap, vc in ((st[3], st[3]), (bn[1], st[2]), (st[2], bn[2])):
        rules = err(picks(m, v, st, bn, cap, vc), 422, "rules_broken")["rules"]
        assert rules == [{"code": "captain", "message": SHAPE_MESSAGES["captain"]}], rules
    assert captain(view(m))["id"] == captain(v)["id"]
    after = set_roles(m, st[4], st[5])
    assert captain(after)["id"] == st[4] and vice(after)["id"] == st[5]
    assert [p["id"] for p in after["players"] if p["captain"] or p["vice_captain"]] and sum(p["captain"] for p in after["players"]) == 1
    out = by_id(after, st[4])
    inn = replacement(m, after, out)
    transfer(m, [(out["id"], inn["id"])])
    v2 = view(m)
    assert captain(v2)["id"] == inn["id"] and vice(v2)["id"] == st[5]
    assert [p["id"] for p in starters(v2)].index(inn["id"]) == [p["id"] for p in starters(after)].index(out["id"])


def test_wf_pick_team_keyboard(app_url, browser):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    gk = starters(v)[0]
    b_gk, b_def = bench(v)[0], bench(v)[1]
    with ui(browser, app_url, m, "/team") as page:
        region = pitch(page)
        soon(region.get_by_role("button").first, "to_be_visible")
        tab_to(page, region)
        assert focused_player(page) == gk["id"]
        page.keyboard.press("ArrowUp")
        assert by_id(v, focused_player(page))["position"] == "DEF" and by_id(v, focused_player(page))["slot"] == "starting"
        page.keyboard.press("ArrowDown")
        assert focused_player(page) == gk["id"]
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Home")
        assert focused_player(page) == b_gk["id"]
        page.keyboard.press("End")
        assert focused_player(page) == bench(v)[3]["id"]
        page.keyboard.press("Home")
        page.keyboard.press("ArrowRight")
        assert focused_player(page) == b_def["id"]
        page.keyboard.press("Enter")
        soon(shirt(page, b_def["name"]), "to_have_attribute", "aria-pressed", "true")
        soon(page.get_by_role("toolbar", name="Player actions"), "to_be_visible")
        page.keyboard.press("Escape")
        soon(shirt(page, b_def["name"]), "to_have_attribute", "aria-pressed", "false")
        assert focused_player(page) == b_def["id"] and view(m) == v
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        out_id = focused_player(page)
        assert by_id(v, out_id)["position"] == "DEF"
        page.keyboard.press("Enter")
        wait_until(page, lambda: by_id(view(m), b_def["id"])["slot"] == "starting" and by_id(view(m), out_id)["bench_order"] == 2, what="keyboard swap saved")
        heard(page, f"{b_def['name']} moves into the eleven for {by_id(v, out_id)['name']}.")
        deselect(page)
        now = view(m)
        plain = next(p for p in starters(now) if not p["captain"] and not p["vice_captain"] and p["position"] == "MID")
        shirt(page, plain["name"]).focus()
        page.keyboard.press("c")
        wait_until(page, lambda: captain(view(m))["id"] == plain["id"], what="C makes captain")
        heard(page, f"{plain['name']} is now captain.")
        deselect(page)
        other = next(p for p in starters(view(m)) if not p["captain"] and not p["vice_captain"] and p["position"] == "FWD")
        shirt(page, other["name"]).focus()
        page.keyboard.press("Enter")
        page.get_by_role("toolbar", name="Player actions").get_by_role("button", name="Make vice-captain").focus()
        page.keyboard.press("v")
        wait_until(page, lambda: vice(view(m))["id"] == other["id"], what="V from a toolbar button")
        heard(page, f"{other['name']} is now vice-captain.")
        deselect(page)
        shirt(page, gk["name"]).focus()
        page.keyboard.press("Shift+Tab")
        assert not focus_in(region)
        page.keyboard.press("Tab")
        assert focused_player(page) == gk["id"]


def test_wf_pick_team_announcements(app_url, browser):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    gk = starters(v)[0]
    b_gk, b_def, b_mid, b_fwd = bench(v)
    st_def = [p for p in starters(v) if p["position"] == "DEF" and not p["captain"] and not p["vice_captain"]][0]
    with ui(browser, app_url, m, "/team") as page:
        soon(shirt(page, gk["name"]), "to_be_visible")
        click(shirt(page, b_def["name"]))
        click(shirt(page, st_def["name"]))
        announced_once(page, "Team updates", f"{b_def['name']} moves into the eleven for {st_def['name']}.")
        deselect(page)
        click(shirt(page, b_mid["name"]))
        click(shirt(page, b_fwd["name"]))
        announced_once(page, "Team updates", "Bench order saved.")
        deselect(page)
        click(shirt(page, b_fwd["name"]))
        click(shirt(page, gk["name"]))
        announced_once(page, "Team updates", f"Swap refused: {SHAPE_MESSAGES['shape_goalkeeper']}.")
        deselect(page)
        new_cap = next(p for p in starters(view(m)) if not p["captain"] and not p["vice_captain"] and p["position"] != "GK")
        shirt(page, new_cap["name"]).focus()
        page.keyboard.press("c")
        announced_once(page, "Team updates", f"{new_cap['name']} is now captain.")
        deselect(page)
        new_vc = next(p for p in starters(view(m)) if not p["captain"] and not p["vice_captain"] and p["position"] != "GK")
        shirt(page, new_vc["name"]).focus()
        page.keyboard.press("v")
        announced_once(page, "Team updates", f"{new_vc['name']} is now vice-captain.")
        deselect(page)
        shirt(page, b_gk["name"]).focus()
        page.keyboard.press("c")
        announced_once(page, "Team updates", f"Captain refused: {SHAPE_MESSAGES['captain']}.")
    final = view(m)
    assert captain(final)["id"] == new_cap["id"] and vice(final)["id"] == new_vc["id"] and by_id(final, b_def["id"])["slot"] == "starting"


def test_wf_pick_team_journey(app_url, browser):
    op = operator(app_url)
    ensure_open(op)
    m = new_manager(app_url)
    v = make_squad(m)
    b_mid, b_fwd = bench(v)[2], bench(v)[3]
    defs = [p for p in starters(v) if p["position"] == "DEF" and not p["captain"] and not p["vice_captain"]]
    with ui(browser, app_url, m, "/team", size=PHONE) as page:
        soon(page.get_by_role("heading", name="Pick Team"), "to_be_visible")
        tap(shirt(page, b_mid["name"]))
        tap(shirt(page, defs[0]["name"]))
        announced_once(page, "Team updates", f"{b_mid['name']} moves into the eleven for {defs[0]['name']}.")
        deselect(page)
        after_swap = view(m)
        new_cap = next(p for p in starters(after_swap) if p["position"] == "FWD" and not p["captain"])
        tap(shirt(page, new_cap["name"]))
        tap(page.get_by_role("toolbar", name="Player actions").get_by_role("button", name="Make captain"))
        wait_until(page, lambda: captain(view(m))["id"] == new_cap["id"], what="captain saved")
        heard(page, f"{new_cap['name']} is now captain.")
        deselect(page)
        new_vc = b_mid
        tap(shirt(page, new_vc["name"]))
        tap(page.get_by_role("toolbar", name="Player actions").get_by_role("button", name="Make vice-captain"))
        wait_until(page, lambda: vice(view(m))["id"] == new_vc["id"], what="vice saved")
        heard(page, f"{new_vc['name']} is now vice-captain.")
        deselect(page)
        saved = view(m)
        tap(shirt(page, b_fwd["name"]))
        tap(shirt(page, defs[1]["name"]))
        announced_once(page, "Team updates", f"Swap refused: {SHAPE_MESSAGES['shape_defenders']}.")
        assert view(m) == saved
        page.reload()
        bench_group = page.get_by_role("group", name="Bench")
        wait_until(page, lambda: pitch(page).get_by_role("button", name=re.compile(re.escape(new_cap["name"]) + r", .*, captain$")).count() == 1, what="captain after reload")
        assert pitch(page).get_by_role("button", name=re.compile(re.escape(new_vc["name"]) + r", .*, vice-captain$")).count() == 1
        assert bench_group.get_by_role("button", name=re.compile("^" + re.escape(defs[0]["name"]) + ", ")).count() == 1
        assert bench_group.get_by_role("button", name=re.compile("^" + re.escape(b_mid["name"]) + ", ")).count() == 0
        n = current(m)["number"]
        lock_reaches(op, m, [page], n, chips=False)
        start(op, n)
        soon(page.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        relay_order(page, op, m, n, captain(view(m)))
    assert by_id(view(m), b_mid["id"])["slot"] == "starting" and by_id(view(m), defs[1]["id"])["slot"] == "starting"


def test_wf_cross_cutting_phone_touch(app_url, browser):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    m = new_manager(app_url)
    v = make_squad(m)
    lg = league_with(m)
    b_def = bench(v)[1]
    st_def = [p for p in starters(v) if p["position"] == "DEF" and not p["captain"] and not p["vice_captain"]][0]
    with ui(browser, app_url, m, f"/team?league={lg['id']}", size=PHONE) as page:
        page.clock.set_system_time(WRONG_FUTURE)
        page.reload()
        install_watch(page)
        soon(shirt(page, b_def["name"]), "to_be_visible")
        layout(page)
        shirts = pitch(page).get_by_role("button")
        for i in range(shirts.count()):
            box = shirts.nth(i).bounding_box()
            if box is None:
                continue
            assert box["x"] >= 0 and box["x"] + box["width"] <= PHONE[0], box
            assert box["width"] >= TARGET_PX and box["height"] >= TARGET_PX, box
        strip = page.get_by_role("button", name="Ledger", exact=True)
        box = strip.bounding_box()
        assert box["width"] >= TARGET_PX and box["height"] >= TARGET_PX and box["y"] + box["height"] <= PHONE[1]
        page.mouse.wheel(0, PHONE[1] * 3)
        advance(page, 500)
        box = strip.bounding_box()
        assert 0 <= box["y"] and box["y"] + box["height"] <= PHONE[1], "Ledger strip is not sticky"
        tap(shirt(page, b_def["name"]))
        tap(shirt(page, st_def["name"]))
        wait_until(page, lambda: by_id(view(m), b_def["id"])["slot"] == "starting", what="tap swap saved")
        assert page.get_by_role("status", name="Locked banner").count() == 0
        lock_reaches(op, m, [page], n, chips=False)
        start(op, n)
        soon(page.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        relay_order(page, op, m, n, captain(view(m)))
        tap(strip)
        sheet = page.get_by_role("dialog", name="Ledger")
        soon(sheet, "to_be_visible")
        soon(sheet.get_by_role("group", name="Chips"), "to_be_visible")
        for chip in CHIP_NAMES:
            soon(sheet.get_by_role("group", name="Chips").get_by_role("button", name=re.compile("^" + CHIP_NAMES[chip])), "to_be_disabled")
        page.keyboard.press("Escape")
        wait_until(page, lambda: page.get_by_role("dialog", name="Ledger").count() == 0 or not page.get_by_role("dialog", name="Ledger").is_visible(), what="sheet closed")
        for path in ("/transfers", "/history", "/leagues", f"/leagues/{lg['id']}"):
            page.goto(app_url.rstrip("/") + path)
            advance(page, 1000)
            layout(page)
        for size in (TABLET, DESKTOP):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.goto(app_url.rstrip("/") + "/team")
            advance(page, 1000)
            layout(page)


def test_transfer_preview(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m, include=["HAR-DEF3", "HAR-MID3", "HAR-FWD2"])
    gw, bank = v["gameweek"], v["bank_tenths"]
    defs = [p for p in v["players"] if p["position"] == "DEF" and p["club"] != "HAR"]
    two = preview(m, gw, [defs[0]["id"], defs[1]["id"]], [])
    assert (two["count"], two["free_transfers_used"], two["hit_points"], two["rules"]) == (0, 0, 0, [])
    assert two["bank_after_tenths"] == bank + defs[0]["selling_price_tenths"] + defs[1]["selling_price_tenths"]
    r1 = replacement(m, v, defs[0])
    r2 = replacement(m, v, defs[1], exclude=[r1["id"]])
    pair = preview(m, gw, [defs[0]["id"], defs[1]["id"]], [r1["id"], r2["id"]])
    assert (pair["count"], pair["free_transfers_used"], pair["hit_points"], pair["rules"]) == (2, 1, HIT_POINTS, [])
    assert pair["bank_after_tenths"] == bank + defs[0]["selling_price_tenths"] + defs[1]["selling_price_tenths"] - r1["price_tenths"] - r2["price_tenths"]
    broken = preview(m, gw, [defs[0]["id"]], ["HAR-MID2"])
    assert [r["code"] for r in broken["rules"]] == ["defenders", "midfielders", "club_limit", "position_match"], broken
    assert broken["rules"][2]["message"] == CLUB_LIMIT_MESSAGE.format(club=CLUBS["HAR"][0])
    assert broken["rules"][3]["message"] == SQUAD_MESSAGES["position_match"] and broken["count"] == 1
    unowned = next(p for p in catalogue(m, position="DEF") if p["id"] not in {x["id"] for x in v["players"]})
    for outs, ins in (([unowned["id"]], []), ([defs[0]["id"]], [defs[1]["id"]]), ([defs[0]["id"]], [r1["id"], r2["id"]]), (["XXX-DEF9"], [])):
        err(m.post("/api/transfers/preview", {"gameweek": gw, "out": outs, "in": ins}), 422, "validation")
    assert view(m) == v and m.get("/api/history/transfers").json()["transfers"] == []


def test_hits_and_wildcard(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    gw = v["gameweek"]
    a, b, c = bench(v)[1], bench(v)[2], bench(v)[3]
    ra = replacement(m, v, a)
    first = transfer(m, [(a["id"], ra["id"])])
    assert first["hit_points"] == 0 and first["gameweek_hit_points"] == 0 and first["free_transfers"] == 0
    v = view(m)
    rb = replacement(m, v, by_id(v, b["id"]))
    rc = replacement(m, v, by_id(v, c["id"]), exclude=[rb["id"]])
    pv = preview(m, gw, [b["id"], c["id"]], [rb["id"], rc["id"]])
    assert pv["free_transfers_used"] == 0 and pv["hit_points"] == 2 * HIT_POINTS
    second = confirm(m, gw, [b["id"], c["id"]], [rb["id"], rc["id"]], 2 * HIT_POINTS)
    assert second.status_code == 201 and second.json()["gameweek_hit_points"] == 2 * HIT_POINTS, second.text
    after = view(m)
    assert after["hit_points"] == 2 * HIT_POINTS and after["transfers_made"] == 3
    assert after["gameweek_total"] == -2 * HIT_POINTS
    w = new_manager(app_url)
    wv = make_squad(w)
    assert w.post("/api/chips", {"gameweek": gw, "chip": "wildcard"}).status_code == 201
    x, y = bench(wv)[2], bench(wv)[3]
    rx = replacement(w, wv, x)
    ry = replacement(w, wv, y, exclude=[rx["id"]])
    wp = preview(w, gw, [x["id"], y["id"]], [rx["id"], ry["id"]])
    assert (wp["free_transfers_used"], wp["hit_points"]) == (0, 0)
    assert confirm(w, gw, [x["id"], y["id"]], [rx["id"], ry["id"]], 0).status_code == 201
    wa = view(w)
    assert wa["hit_points"] == 0 and wa["free_transfers"] == 1 and wa["chips"]["wildcard"] == "active"


def test_confirm_hit_changed(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    gw = v["gameweek"]
    a, b = bench(v)[2], bench(v)[3]
    ra = replacement(m, v, a)
    rb = replacement(m, v, b, exclude=[ra["id"]])
    before_ledger = ledger(m)
    body = err(confirm(m, gw, [a["id"], b["id"]], [ra["id"], rb["id"]], 0), 409, "hit_changed")
    assert body["hit_points"] == HIT_POINTS
    assert view(m) == v and ledger(m) == before_ledger and m.get("/api/history/transfers").json()["transfers"] == []
    rules = err(confirm(m, gw, [a["id"]], [rb["id"] if a["position"] != rb["position"] else "HAR-GK1"], 0), 422, "rules_broken")
    assert any(r["code"] == "position_match" for r in rules["rules"])
    ok = confirm(m, gw, [a["id"], b["id"]], [ra["id"], rb["id"]], HIT_POINTS)
    assert ok.status_code == 201 and ok.json()["gameweek_hit_points"] == HIT_POINTS, ok.text


def test_transfer_idempotency(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    gw = v["gameweek"]
    a, b = bench(v)[2], bench(v)[3]
    ra = replacement(m, v, a)
    key = f"key-{tag()}"
    first = confirm(m, gw, [a["id"]], [ra["id"]], 0, key)
    assert first.status_code == 201, first.text
    again = confirm(m, gw, [a["id"]], [ra["id"]], 0, key)
    assert again.status_code == 201 and again.json() == first.json() and again.headers.get("Idempotent-Replayed") == "true"
    err(confirm(m, gw, [b["id"]], [replacement(m, view(m), b)["id"]], 0, key), 422, "idempotency_key_reused")
    assert len(m.get("/api/history/transfers").json()["transfers"]) == 1
    v2 = view(m)
    rb = replacement(m, v2, by_id(v2, b["id"]))
    key2 = f"key-{tag()}"
    hit = preview(m, gw, [b["id"]], [rb["id"]])["hit_points"]
    results = parallel([lambda: confirm(m, gw, [b["id"]], [rb["id"]], hit, key2) for _ in range(5)])
    made = [r for r in results if r.status_code == 201]
    assert made and len({json.dumps(r.json(), sort_keys=True) for r in made}) == 1, [r.text for r in results]
    for r in results:
        if r.status_code != 201:
            err(r, r.status_code)
            assert r.status_code in (409, 422), r.text
    transfers = m.get("/api/history/transfers").json()["transfers"]
    assert len(transfers) == 2
    entries = ledger(m)["entries"]
    assert sum(e["kind"] == "sale" for e in entries) == 2 and sum(e["kind"] == "purchase" for e in entries) == 17
    other = new_manager(app_url)
    ov = make_squad(other)
    oo = bench(ov)[3]
    r = confirm(other, gw, [oo["id"]], [replacement(other, ov, oo)["id"]], 0, key)
    assert r.status_code == 201 and r.headers.get("Idempotent-Replayed") != "true", r.text


def test_transfer_draft_api(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    gw = v["gameweek"]
    a, b = bench(v)[2], bench(v)[3]
    ra = replacement(m, v, a)
    d = m.get("/api/transfers/draft").json()
    assert d["state"] == "clean"
    d = m.put("/api/transfers/draft", {"gameweek": gw, "out": [a["id"], b["id"]], "in": [ra["id"]]}).json()
    assert d["state"] == "drafting" and d["out"] == [a["id"], b["id"]] and d["in"] == [ra["id"]] and d["preview"]["count"] == 1
    assert Api(app_url, m.token).get("/api/transfers/draft").json() == d
    assert m.put("/api/transfers/draft", {"gameweek": gw, "out": [], "in": []}).json()["state"] == "clean"
    m.put("/api/transfers/draft", {"gameweek": gw, "out": [a["id"]], "in": [ra["id"]]})
    assert m.delete("/api/transfers/draft").json()["state"] == "clean"
    err(m.put("/api/transfers/draft", {"gameweek": gw, "out": ["XXX-MID9"], "in": []}), 422, "validation")
    m.put("/api/transfers/draft", {"gameweek": gw, "out": [a["id"]], "in": [ra["id"]]})
    refusal = err(confirm(m, gw, [a["id"]], [ra["id"]], HIT_POINTS), 409, "hit_changed")
    d = m.get("/api/transfers/draft").json()
    assert d["state"] == "refused" and d["refusal"] == refusal and d["out"] == [a["id"]]
    assert m.put("/api/transfers/draft", {"gameweek": gw, "out": [a["id"]], "in": [ra["id"]]}).json()["state"] == "drafting"
    assert confirm(m, gw, [a["id"]], [ra["id"]], 0).status_code == 201
    d = m.get("/api/transfers/draft").json()
    assert d["state"] == "confirmed" and d["out"] == [] and d["in"] == []


def test_wf_transfers_draft_survives(app_url, browser):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    out = bench(v)[2]
    expected = f"Transfers 0 · Free used 0 · Hit -0 pts · Bank {money(v['bank_tenths'] + out['selling_price_tenths'])}m"
    with ui(browser, app_url, m, "/transfers") as tab1:
        click(shirt(tab1, out["name"]))
        wait_until(tab1, lambda: draft_is(m, [out["id"]], []), what="server draft")
        preview_region = tab1.get_by_role("status", name="Draft preview")
        wait_until(tab1, lambda: text(preview_region) == expected, what="draft preview")
        click(tab1.get_by_role("link", name="Pick Team"))
        wait_until(tab1, lambda: urlparse(tab1.url).path == "/team", what="Pick Team")
        tab1.go_back()
        wait_until(tab1, lambda: "Out" in card_text(shirt(tab1, out["name"])), what="draft after Back")
        tab1.reload()
        wait_until(tab1, lambda: text(tab1.get_by_role("status", name="Draft preview")) == expected, what="draft after reload")
        with ui(browser, app_url, m, "/transfers") as tab2:
            wait_until(tab2, lambda: text(tab2.get_by_role("status", name="Draft preview")) == expected, what="draft in second tab")
            assert "Out" in card_text(shirt(tab2, out["name"]))
        click(tab1.get_by_role("button", name="Reset draft"))
        wait_until(tab1, lambda: m.get("/api/transfers/draft").json()["state"] == "clean", what="draft reset")
    assert view(m) == v


def test_wf_transfers_confirm_dialog(app_url, browser):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    out = bench(v)[3]
    inn = replacement(m, v, out)
    m.put("/api/transfers/draft", {"gameweek": v["gameweek"], "out": [out["id"]], "in": [inn["id"]]})
    with ui(browser, app_url, m, "/transfers") as page:
        review = page.get_by_role("button", name="Review transfers")
        soon(review, "to_be_enabled")
        region, listbox = pitch(page), page.get_by_role("listbox", name="Players")
        tab_to(page, region)
        wait_until(page, lambda: focused_player(page) == starters(v)[0]["id"], what="Tab lands on the goalkeeper the first time")
        tab_to(page, listbox)
        page.keyboard.press("Escape")
        wait_until(page, lambda: focus_in(region), what="Escape in the list returns to the pitch")
        page.keyboard.press("Shift+Tab")
        tab_to(page, region)
        wait_until(page, lambda: focused_player(page) == starters(v)[0]["id"], what="Tab lands on the last focused shirt")
        click(review)
        dialog = page.get_by_role("dialog", name="Confirm transfers")
        soon(dialog, "to_be_visible")
        assert f"{out['name']} → {inn['name']}" in text(dialog)
        soon(dialog.get_by_role("button", name="Keep editing"), "to_be_focused")
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert focus_in(dialog), f"focus left the dialog after {key}"
        page.keyboard.press("Escape")
        wait_until(page, lambda: dialog.count() == 0 or not dialog.is_visible(), what="dialog closed")
        soon(review, "to_be_focused")
        click(review)
        click(dialog.get_by_role("button", name="Keep editing"))
        soon(review, "to_be_focused")
        click(review)
        click(dialog.get_by_role("button", name="Confirm transfers"))
        wait_until(page, lambda: len(m.get("/api/history/transfers").json()["transfers"]) == 1, what="transfer confirmed")
    t = m.get("/api/history/transfers").json()["transfers"][0]
    assert t["out"]["player_id"] == out["id"] and t["in"]["player_id"] == inn["id"]


def test_wf_transfers_hit_journey(app_url, browser):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    a, b = bench(v)[2], bench(v)[3]
    ra = replacement(m, v, a)
    rb = replacement(m, v, b, exclude=[ra["id"]])
    with ui(browser, app_url, m, "/transfers") as tab:
        click(shirt(tab, a["name"]))
        click(shirt(tab, b["name"]))
        bring_in(tab, m, ra)
        bring_in(tab, m, rb)
        wait_until(tab, lambda: draft_is(m, [a["id"], b["id"]], [ra["id"], rb["id"]]), what="draft of two pairs")
    pv = preview(m, v["gameweek"], [a["id"], b["id"]], [ra["id"], rb["id"]])
    assert pv["hit_points"] == HIT_POINTS
    expected = f"Transfers 2 · Free used 1 · Hit -{HIT_POINTS} pts · Bank {money(pv['bank_after_tenths'])}m"
    with ui(browser, app_url, m, "/transfers") as tab:
        wait_until(tab, lambda: text(tab.get_by_role("status", name="Draft preview")) == expected, what="draft in a new tab")
        click(tab.get_by_role("button", name="Review transfers"))
        dialog = tab.get_by_role("dialog", name="Confirm transfers")
        wait_until(tab, lambda: f"{a['name']} → {ra['name']}" in text(dialog) and f"{b['name']} → {rb['name']}" in text(dialog), what="pairs in the dialog")
        click(dialog.get_by_role("button", name="Confirm transfers"))
        announced_once(tab, "Team updates", f"Transfers confirmed: 2 made, hit {HIT_POINTS} points, bank {money(pv['bank_after_tenths'])}m.")
        soon(chip_button(tab, "wildcard"), "to_be_enabled")
        click(chip_button(tab, "wildcard"))
        click(play_button(tab, "wildcard"))
        announced_once(tab, "Team updates", f"{CHIP_NAMES['wildcard']} must be played before making transfers this gameweek.")
    after = view(m)
    assert after["bank_tenths"] == pv["bank_after_tenths"] == v["bank_tenths"] + sum(by_id(v, x)["selling_price_tenths"] for x in (a["id"], b["id"])) - ra["price_tenths"] - rb["price_tenths"]
    assert after["free_transfers"] == v["free_transfers"] - 1 and after["hit_points"] == HIT_POINTS and after["chip"] is None
    hist = m.get("/api/history/transfers").json()["transfers"]
    assert sorted((t["out"]["player_id"], t["in"]["player_id"]) for t in hist) == sorted([(a["id"], ra["id"]), (b["id"], rb["id"])])
    lg = ledger(m)
    assert sum(e["amount_tenths"] for e in lg["entries"]) == lg["bank_tenths"] == after["bank_tenths"]


def test_selling_price(app_url):
    op = operator(app_url)
    ensure_open(op)
    m = new_manager(app_url)
    v = make_squad(m)
    candidates = ordered([p for p in v["players"] if not p["captain"]])
    b, _ = move_once(op, candidates[::-1], -1)
    pb = by_id(view(m), b["id"])
    assert pb["price_tenths"] == b["purchase_price_tenths"] - 1 and pb["selling_price_tenths"] == pb["price_tenths"]
    a = None
    for p in [c for c in candidates if c["id"] != b["id"]]:
        _, r1 = price_run(op, [(p["id"], 1)])
        assert r1.status_code == 201, r1.text
        if not r1.json()["applied"]:
            continue
        pa = by_id(view(m), p["id"])
        assert pa["price_tenths"] == p["purchase_price_tenths"] + 1 and pa["selling_price_tenths"] == p["purchase_price_tenths"]
        _, r2 = price_run(op, [(p["id"], 1)])
        assert r2.status_code == 201, r2.text
        if r2.json()["applied"]:
            assert r2.json()["applied"][0]["price_tenths"] == p["purchase_price_tenths"] + 2, r2.text
            a = p
            break
    assert a, "every owned player is at the gameweek price cap"
    v2 = view(m)
    pa = by_id(v2, a["id"])
    assert pa["selling_price_tenths"] == a["purchase_price_tenths"] + 1 and pa["purchase_price_tenths"] == a["purchase_price_tenths"]
    assert v2["squad_value_tenths"] == sum(p["selling_price_tenths"] for p in v2["players"])
    inn = replacement(m, v2, pa)
    sold = transfer(m, [(a["id"], inn["id"])])
    assert sold["transfers"][0]["sell_price_tenths"] == a["purchase_price_tenths"] + 1
    back = transfer(m, [(inn["id"], a["id"])]) if a["position"] == inn["position"] else None
    assert back is not None
    pa = by_id(view(m), a["id"])
    assert pa["purchase_price_tenths"] == pa["price_tenths"] == a["purchase_price_tenths"] + 2 == pa["selling_price_tenths"]


def test_paired_ledger(app_url):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    v = make_squad(m)
    lg = ledger(m)
    kinds = Counter(e["kind"] for e in lg["entries"])
    assert kinds == {"opening_budget": 1, "purchase": 15}
    assert next(e for e in lg["entries"] if e["kind"] == "opening_budget")["amount_tenths"] == BUDGET_TENTHS
    assert {e["player_id"]: e["amount_tenths"] for e in lg["entries"] if e["kind"] == "purchase"} == {p["id"]: -p["price_tenths"] for p in v["players"]}
    assert sum(e["amount_tenths"] for e in lg["entries"]) == lg["bank_tenths"] == v["bank_tenths"]
    a, b = bench(v)[2], bench(v)[3]
    ra = replacement(m, v, a)
    rb = replacement(m, v, b, exclude=[ra["id"]])
    done = transfer(m, [(a["id"], ra["id"]), (b["id"], rb["id"])])
    after = ledger(m)
    old = {e["id"]: e for e in lg["entries"]}
    assert all(old[e["id"]] == e for e in after["entries"] if e["id"] in old) and set(old) <= {e["id"] for e in after["entries"]}
    for t in done["transfers"]:
        pair = [e for e in after["entries"] if e["transfer_id"] == t["id"]]
        assert sorted((e["kind"], e["amount_tenths"]) for e in pair) == sorted([("sale", t["sell_price_tenths"]), ("purchase", -t["price_tenths"])])
    assert sum(e["amount_tenths"] for e in after["entries"]) == after["bank_tenths"] == done["bank_tenths"] == view(m)["bank_tenths"]
    assert after["squad_selling_value_tenths"] == view(m)["squad_value_tenths"]
    hist = m.get("/api/history/transfers").json()["transfers"]
    for t in hist:
        sale = [e for e in after["entries"] if e["transfer_id"] == t["id"] and e["kind"] == "sale"]
        buy = [e for e in after["entries"] if e["transfer_id"] == t["id"] and e["kind"] == "purchase"]
        assert len(sale) == 1 == len(buy) and sale[0]["amount_tenths"] == t["out"]["sell_price_tenths"] and buy[0]["amount_tenths"] == -t["in"]["price_tenths"]


def test_price_runs(app_url):
    op = operator(app_url)
    ensure_open(op)
    m = new_manager(app_url)
    prices = lambda: {p["id"]: p["price_tenths"] for p in catalogue(m)}
    p, q, r = RNG.sample(sorted(seed_players()), 3)
    for moves in ([{"player_id": p, "delta_tenths": 2}], [{"player_id": p, "delta_tenths": 1}, {"player_id": p, "delta_tenths": -1}], []):
        err(op.post("/api/operator/price-runs", {"run_date": new_run_date(), "moves": moves}), 422, "validation")
    err(op.post("/api/operator/price-runs", {"run_date": "2026-13-45", "moves": [{"player_id": p, "delta_tenths": 1}]}), 422, "validation")
    err(m.post("/api/operator/price-runs", {"run_date": new_run_date(), "moves": [{"player_id": p, "delta_tenths": 1}]}), 403, "forbidden")
    before = prices()
    rd, first = price_run(op, [(p, 1)])
    assert first.status_code == 201 and first.json()["run_date"] == rd, first.text
    moved = {a["player_id"]: a for a in first.json()["applied"]}
    _, again = price_run(op, [(p, 1)], rd)
    err(again, 409, "run_date_used")
    after = prices()
    if p in moved:
        assert after[p] == before[p] + 1 == moved[p]["price_tenths"]
    else:
        assert first.json()["skipped"] == [{"player_id": p, "reason": "gameweek_cap"}] and after[p] == before[p]
    rd2 = new_run_date()
    before_q = prices()[q]
    results = parallel([lambda: price_run(op, [(q, 1)], rd2)[1] for _ in range(4)])
    assert sorted(x.status_code for x in results) == [201, 409, 409, 409], [x.text for x in results]
    assert all(x.json()["error"] == "run_date_used" for x in results if x.status_code == 409)
    winner = next(x for x in results if x.status_code == 201).json()
    assert prices()[q] == before_q + len(winner["applied"])
    start_r, applied, skipped_seen = prices()[r], 0, False
    for i in range(PRICE_RUN_CAP + 1):
        _, run = price_run(op, [(r, 1 if i % 2 == 0 else -1)])
        assert run.status_code == 201, run.text
        body = run.json()
        if body["skipped"]:
            assert body["skipped"] == [{"player_id": r, "reason": "gameweek_cap"}] and body["applied"] == []
            skipped_seen = True
        else:
            assert not skipped_seen, "a capped player moved again"
            applied += body["applied"][0]["delta_tenths"]
    assert skipped_seen and prices()[r] == start_r + applied
    ensure_live(op)
    frozen = prices()
    err(price_run(op, [(p, 1)])[1], 409, "prices_frozen")
    assert prices() == frozen


def test_wf_money_and_prices_sell_after_rise(app_url, browser):
    op = operator(app_url)
    ensure_open(op)
    m = new_manager(app_url)
    v = make_squad(m)
    a = rise_twice(op, ordered(bench(v)[1:]) + ordered([p for p in starters(v) if not p["captain"]]))
    sell = a["purchase_price_tenths"] + 1
    v2 = view(m)
    assert by_id(v2, a["id"])["selling_price_tenths"] == sell
    inn = replacement(m, v2, by_id(v2, a["id"]))
    bank_after = v2["bank_tenths"] + sell - inn["price_tenths"]
    with ui(browser, app_url, m, "/transfers") as page:
        click(shirt(page, a["name"]))
        wait_until(page, lambda: "Out" in card_text(shirt(page, a["name"])) and money(sell) in card_text(shirt(page, a["name"])), what="Out tag with selling price")
        bring_in(page, m, inn)
        wait_until(page, lambda: text(page.get_by_role("status", name="Draft preview")) == f"Transfers 1 · Free used 1 · Hit -0 pts · Bank {money(bank_after)}m", what="preview")
        click(page.get_by_role("button", name="Review transfers"))
        click(page.get_by_role("dialog", name="Confirm transfers").get_by_role("button", name="Confirm transfers"))
        announced_once(page, "Team updates", f"Transfers confirmed: 1 made, hit 0 points, bank {money(bank_after)}m.")
        lg = ledger(m)
        page.goto(app_url.rstrip("/") + "/history")
        expected_line = f"Bank {money(lg['bank_tenths'])}m · Squad selling value {money(lg['squad_selling_value_tenths'])}m · Ledger balance {money(lg['bank_tenths'])}m"
        wait_until(page, lambda: expected_line in " ".join(inner_texts(page.locator("body"))), what="reconciliation line")
        rows = page.get_by_role("table", name="Bank ledger").get_by_role("row")
        last = rows.nth(rows.count() - 1)
        assert "Balance" in text(last) and money(lg["bank_tenths"]) in text(last)
        assert inn["name"] in text(page.get_by_role("table", name="Transfers"))
    t = m.get("/api/history/transfers").json()["transfers"][-1]
    assert t["out"]["sell_price_tenths"] == sell and lg["bank_tenths"] == bank_after == sum(e["amount_tenths"] for e in lg["entries"])
    sale = next(e for e in lg["entries"] if e["transfer_id"] == t["id"] and e["kind"] == "sale")
    assert sale["amount_tenths"] == sell
    n = v["gameweek"]
    v3 = view(m)
    second = next(p for p in reversed(bench(v3)) if p["id"] != inn["id"])
    parallel_confirm(m, second, replacement(m, v3, second))
    lock(op)
    start(op, n)
    with ui(browser, app_url, m, "/team") as team:
        soon(team.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        relay_order(team, op, m, n, captain(view(m)))


def test_wf_money_and_prices_operator_console(app_url, browser):
    op = operator(app_url)
    ensure_open(op)
    m = new_manager(app_url)
    player = ordered(catalogue(m))[0]
    run_date = new_run_date()
    moved = "Price change applied: 1 moved, 0 held at the cap."
    capped = "Price change applied: 0 moved, 1 held at the cap."
    with ui(browser, app_url, op, "/operator") as page:
        page.get_by_role("textbox", name="Run date").fill(run_date)
        pick(page, page.get_by_role("combobox", name="Move player"), lambda label: named(label, player["name"]))
        click(page.get_by_role("radio", name="Rise"))
        click(page.get_by_role("button", name="Add move"))
        listed = lambda: any(k in text(page.get_by_role("list", name="Moves")) for k in (player["name"], player["id"]))
        wait_until(page, listed, what="move listed")
        click(page.get_by_role("button", name="Run price change"))
        result = lambda: announcements(page, "Operator updates", moved) + announcements(page, "Operator updates", capped)
        wait_until(page, lambda: result() >= 1, what="price change result")
        advance(page, 1000)
        assert result() == 1, page.evaluate("(n) => (window.__regions || {})[n]", "Operator updates")
        rose = announcements(page, "Operator updates", moved) == 1
        date_box = page.get_by_role("textbox", name="Run date")
        if date_box.input_value() != run_date:
            date_box.fill(run_date)
        if not listed():
            pick(page, page.get_by_role("combobox", name="Move player"), lambda label: named(label, player["name"]))
            click(page.get_by_role("radio", name="Rise"))
            click(page.get_by_role("button", name="Add move"))
            wait_until(page, listed, what="move listed again")
        click(page.get_by_role("button", name="Run price change"))
        announced_once(page, "Operator updates", f"A price change already ran for {run_date}.")
    after = next(p for p in catalogue(m) if p["id"] == player["id"])["price_tenths"]
    if rose:
        MOVES[player["id"]] += 1
        assert after == player["price_tenths"] + 1
    else:
        assert after == player["price_tenths"]
        _, probe = price_run(op, [(player["id"], 1)])
        assert probe.status_code == 201 and probe.json()["skipped"] == [{"player_id": player["id"], "reason": "gameweek_cap"}], probe.text


def test_chip_rules(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    m1, m2, m3, m4 = (new_manager(app_url) for _ in range(4))
    for x in (m1, m2, m3, m4):
        make_squad(x)
    r = m1.post("/api/chips", {"gameweek": n, "chip": "bench_boost"})
    assert r.status_code == 201 and r.json()["chip"] == "bench_boost" and r.json()["chips"]["bench_boost"] == "active", r.text
    err(m1.post("/api/chips", {"gameweek": n, "chip": "triple_captain"}), 409, "chip_already_this_gameweek")
    r = m1.delete(f"/api/chips/{n}")
    assert r.status_code == 200 and r.json()["chip"] is None and r.json()["chips"]["bench_boost"] == "available", r.text
    results = parallel([lambda c=c: m1.post("/api/chips", {"gameweek": n, "chip": c}) for c in CHIP_NAMES])
    assert sorted(x.status_code for x in results) == [201, 409, 409, 409], [x.text for x in results]
    assert all(x.json()["error"] == "chip_already_this_gameweek" for x in results if x.status_code == 409)
    won = next(x for x in results if x.status_code == 201).json()["chip"]
    assert view(m1)["chip"] == won
    cancel = m1.delete(f"/api/chips/{n}")
    if won in ("wildcard", "free_hit"):
        err(cancel, 409, "chip_locked_in")
        assert view(m1)["chip"] == won
    else:
        assert cancel.status_code == 200 and view(m1)["chip"] is None
    v2 = view(m2)
    out = bench(v2)[3]
    transfer(m2, [(out["id"], replacement(m2, v2, out)["id"])])
    err(m2.post("/api/chips", {"gameweek": n, "chip": "wildcard"}), 409, "chip_after_transfers")
    err(m2.post("/api/chips", {"gameweek": n, "chip": "free_hit"}), 409, "chip_after_transfers")
    assert m2.post("/api/chips", {"gameweek": n, "chip": "triple_captain"}).status_code == 201
    err(m3.delete(f"/api/chips/{n}"), 404, "not_found")
    err(m3.post("/api/chips", {"gameweek": n, "chip": "super_sub"}), 422, "validation")
    assert view(m3)["chip"] is None
    err(op.post("/api/chips", {"gameweek": n, "chip": "wildcard"}), 403, "forbidden")
    assert m4.post("/api/chips", {"gameweek": n, "chip": "bench_boost"}).status_code == 201
    lock(op)
    start(op, n)
    close(op, n)
    nxt = n + 1
    replay = m4.post("/api/chips", {"gameweek": nxt, "chip": "bench_boost"})
    if (n <= FIRST_HALF_END) == (nxt <= FIRST_HALF_END):
        err(replay, 409, "chip_used")
        assert view(m4)["chips"]["bench_boost"] == "used"
        assert m4.post("/api/chips", {"gameweek": nxt, "chip": "triple_captain"}).status_code == 201
    else:
        assert replay.status_code == 201, replay.text


def test_free_hit_revert(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    m = new_manager(app_url)
    v = make_squad(m)
    before = view(m)
    assert m.post("/api/chips", {"gameweek": n, "chip": "free_hit"}).status_code == 201
    cap = captain(before)
    extra = bench(before)[3]
    rc = replacement(m, before, cap)
    rx = replacement(m, before, extra, exclude=[rc["id"]])
    done = transfer(m, [(cap["id"], rc["id"]), (extra["id"], rx["id"])])
    assert done["hit_points"] == 0 and done["free_transfers"] == before["free_transfers"]
    fh_ids = {e["id"] for e in ledger(m)["entries"] if e["transfer_id"] in {t["id"] for t in done["transfers"]}}
    assert len(fh_ids) == 4
    assert all(t["free_hit"] for t in m.get("/api/history/transfers").json()["transfers"])
    lock(op)
    start(op, n)
    close(op, n)
    after = view(m)
    keys = ("id", "purchase_price_tenths", "slot", "bench_order", "captain", "vice_captain")
    assert [tuple(p[k] for k in keys) for p in starters(after)] == [tuple(p[k] for k in keys) for p in starters(before)]
    assert [tuple(p[k] for k in keys) for p in bench(after)] == [tuple(p[k] for k in keys) for p in bench(before)]
    assert after["bank_tenths"] == before["bank_tenths"]
    lg = ledger(m)
    reversals = [e for e in lg["entries"] if e["kind"] == "reversal"]
    originals = {e["id"]: e for e in lg["entries"]}
    assert sorted(e["reverses"] for e in reversals) == sorted(fh_ids)
    assert all(e["amount_tenths"] == -originals[e["reverses"]]["amount_tenths"] for e in reversals)
    assert sum(e["amount_tenths"] for e in lg["entries"]) == lg["bank_tenths"] == after["bank_tenths"]


def test_wf_chips_wildcard(app_url, browser):
    op = operator(app_url)
    ensure_open(op)
    m = new_manager(app_url)
    v = make_squad(m)
    n = v["gameweek"]
    a, b = bench(v)[2], bench(v)[3]
    ra = replacement(m, v, a)
    rb = replacement(m, v, b, exclude=[ra["id"]])
    with ui(browser, app_url, m, "/transfers") as page:
        click(chip_button(page, "wildcard"))
        click(play_button(page, "wildcard"))
        announced_once(page, "Team updates", f"Wildcard played for gameweek {n}.")
        wait_until(page, lambda: chip_button(page, "wildcard").get_attribute("aria-pressed") == "true" and "Active" in text(chip_button(page, "wildcard")), what="Wildcard active")
        click(shirt(page, a["name"]))
        click(shirt(page, b["name"]))
        bring_in(page, m, ra)
        bring_in(page, m, rb)
        wait_until(page, lambda: "Hit -0 pts" in text(page.get_by_role("status", name="Draft preview")) and text(page.get_by_role("status", name="Draft preview")).startswith("Transfers 2"), what="no hit")
        click(page.get_by_role("button", name="Review transfers"))
        click(page.get_by_role("dialog", name="Confirm transfers").get_by_role("button", name="Confirm transfers"))
        wait_until(page, lambda: len(m.get("/api/history/transfers").json()["transfers"]) == 2, what="transfers saved")
        click(chip_button(page, "bench_boost"))
        click(play_button(page, "bench_boost"))
        announced_once(page, "Team updates", "Only one chip can be played in a gameweek.")
        third = bench(view(m))[1]
        assert parallel_confirm(m, third, replacement(m, view(m), third))["hit_points"] == 0
        after = view(m)
        lock_reaches(op, m, [page], n)
    assert after["chip"] == "wildcard" and after["hit_points"] == 0 and after["free_transfers"] == v["free_transfers"]
    assert after["chips"]["bench_boost"] == "available" and {ra["id"], rb["id"]} <= {p["id"] for p in after["players"]}


def test_wf_chips_cancel(app_url, browser):
    ensure_open(operator(app_url))
    m = new_manager(app_url)
    n = make_squad(m)["gameweek"]
    with ui(browser, app_url, m, "/team") as page:
        click(chip_button(page, "bench_boost"))
        click(chip_dialog(page, "bench_boost").get_by_role("button", name="Not now"))
        assert view(m)["chip"] is None
        click(chip_button(page, "bench_boost"))
        click(play_button(page, "bench_boost"))
        announced_once(page, "Team updates", f"Bench Boost played for gameweek {n}.")
        click(chip_button(page, "bench_boost"))
        announced_once(page, "Team updates", "Bench Boost cancelled.")
        assert view(m)["chip"] is None
        click(chip_button(page, "wildcard"))
        click(play_button(page, "wildcard"))
        wait_until(page, lambda: view(m)["chip"] == "wildcard", what="Wildcard played")
        click(chip_button(page, "wildcard"))
        announced_once(page, "Team updates", "Wildcard cannot be cancelled once played.")
    assert view(m)["chip"] == "wildcard"


def test_free_transfer_accrual(app_url):
    fresh = os.environ["APP_FRESH_URL"]
    op = operator(fresh)
    ensure_open(op)
    saver, spender = new_manager(fresh), new_manager(fresh)
    make_squad(saver)
    sv = make_squad(spender)
    out = bench(sv)[3]
    transfer(spender, [(out["id"], replacement(spender, sv, out)["id"])])
    assert view(spender)["free_transfers"] == 0
    saved, spent = 1, 0
    for _ in range(FREE_TRANSFER_CAP):
        n, _ = lock(op)
        start(op, n)
        close(op, n)
        saved, spent = min(FREE_TRANSFER_CAP, saved + 1), min(FREE_TRANSFER_CAP, spent + 1)
        assert (view(saver)["free_transfers"], view(spender)["free_transfers"]) == (saved, spent)
    assert saved == FREE_TRANSFER_CAP


def test_free_hit_back_to_back(app_url):
    fresh = os.environ["APP_FRESH_URL"]
    op = operator(fresh)
    gw = ensure_open(op)
    assert gw["number"] <= FIRST_HALF_END, f"fresh season already at gameweek {gw['number']}"
    m = new_manager(fresh)
    make_squad(m)
    while current(op)["number"] < FIRST_HALF_END:
        n, _ = lock(op)
        start(op, n)
        close(op, n)
    n = current(op)["number"]
    assert m.post("/api/chips", {"gameweek": n, "chip": "free_hit"}).status_code == 201
    lock(op)
    start(op, n)
    close(op, n)
    v = view(m)
    assert v["gameweek"] == n + 1 and v["chips"]["free_hit"] == "available"
    err(m.post("/api/chips", {"gameweek": n + 1, "chip": "free_hit"}), 409, "free_hit_back_to_back")
    assert view(m)["chip"] is None


def test_fixtures_deadline(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    body = publish(op, n, FAR_KICKOFF)
    assert ts(body["deadline"]) == FAR_KICKOFF - DEADLINE_LEAD and body["deadline"].endswith("Z")
    assert body["deadline_local"] == "Sat 8 Nov 13:30" and ts(body["first_kickoff"]) == FAR_KICKOFF
    assert sorted(f["id"] for f in body["fixtures"]) == sorted(f"gw{n:02d}-{h}-{a}" for h, a in PAIRS)
    assert {(f["home"], f["away"]) for f in body["fixtures"]} == set(PAIRS)
    summer = [{"home": h, "away": a, "kickoff": f"2031-07-05T{15 + i}:00:00+01:00"} for i, (h, a) in enumerate(PAIRS)]
    r = op.put(f"/api/operator/gameweeks/{n}/fixtures", {"fixtures": summer})
    assert r.status_code == 200, r.text
    dl = ts(r.json()["deadline"])
    assert dl == datetime(2031, 7, 5, 14, 0, tzinfo=timezone.utc) - DEADLINE_LEAD
    assert r.json()["deadline_local"] == dl.astimezone(ZoneInfo("Europe/Dublin")).strftime("%a %-d %b %H:%M")
    assert next(g for g in op.get("/api/gameweeks").json()["gameweeks"] if g["number"] == n)["deadline"] == r.json()["deadline"]
    bad = [
        summer[:4],
        summer[:4] + [{"home": "HAR", "away": "DRU", "kickoff": summer[4]["kickoff"]}],
        [dict(f, kickoff="2031-07-05T15:00:00") for f in summer],
    ]
    for fixtures in bad:
        err(op.put(f"/api/operator/gameweeks/{n}/fixtures", {"fixtures": fixtures}), 422, "validation")
    past = err(op.put(f"/api/operator/gameweeks/{n}/fixtures", {"fixtures": [dict(f, kickoff=f"2001-01-06T{15 + i}:00:00+00:00") for i, f in enumerate(summer)]}), 422, "validation")
    assert "fixtures" in past.get("fields", {})
    err(new_manager(app_url).put(f"/api/operator/gameweeks/{n}/fixtures", {"fixtures": summer}), 403, "forbidden")
    err(op.put(f"/api/operator/gameweeks/{LAST_GAMEWEEK + 1}/fixtures", {"fixtures": summer}), 404, "not_found")
    publish(op, n, FAR_KICKOFF)


def test_wf_deadline_lock_fixtures_console(app_url, browser):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    with ui(browser, app_url, op, "/operator") as page:
        for i, (h, a) in enumerate(PAIRS, start=1):
            pick(page, page.get_by_role("combobox", name=f"Home team {i}"), lambda label, c=h: club_in(label, c))
            pick(page, page.get_by_role("combobox", name=f"Away team {i}"), lambda label, c=a: club_in(label, c))
            page.get_by_role("textbox", name=f"Kickoff {i}").fill(f"2031-11-08 {13 + 2 * i}:00")
        click(page.get_by_role("button", name="Publish fixtures"))
        announced_once(page, "Operator updates", "Fixtures published. Deadline Sat 8 Nov 13:30.")
        wait_until(page, lambda: text(page.get_by_role("status", name="Gameweek status")) == f"Gameweek {n} · Open · Deadline Sat 8 Nov 13:30", what="status line")
    gw = current(op)
    assert gw["deadline_local"] == "Sat 8 Nov 13:30" and ts(gw["first_kickoff"]) == FAR_KICKOFF


def test_deadline_lock(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    a = new_manager(app_url)
    v = make_squad(a)
    st, bn = [p["id"] for p in starters(v)], [p["id"] for p in bench(v)]
    c1, c2, vc = st[5], st[6], st[7]
    out = bench(v)[3]
    a.put("/api/transfers/draft", {"gameweek": n, "out": [out["id"]], "in": []})
    deadline = schedule_lock(op, n)
    seen, last_ok, refused = [], None, 0
    end = time.monotonic() + LOCK_LEAD_S + LOCK_S + SLACK_S
    while time.monotonic() < end:
        cap = c1 if len(seen) % 2 == 0 else c2
        r = picks(a, v, st, bn, cap, vc)
        g = current(a)
        seen.append((ts(g["server_time"]), g["status"], r.status_code))
        if r.status_code == 200:
            assert refused == 0, "a change was accepted after a refusal"
            last_ok = cap
        else:
            err(r, 409, "gameweek_locked")
            refused += 1
            break
    assert last_ok and refused == 1
    wait_status(a, n, "locked", LOCK_S + SLACK_S)
    for when, status, _ in seen:
        if when < deadline:
            assert status == "open", seen
        if when >= deadline + timedelta(seconds=LOCK_S):
            assert status == "locked", seen
    locked = view(a)
    assert captain(locked)["id"] == last_ok and locked["editable"] is False and locked["gameweek_status"] == "locked"
    assert a.get("/api/transfers/draft").json()["state"] == "clean"
    del out
    mid = history(a)["manager_id"]
    poll(lambda: history_row(a, n), lambda row: row and row["receipt"] == "stored", API_WAIT_S, "receipt stored")
    snap = json.loads(S3().get(f"snapshots/gw-{n:02d}/{mid}.json"))
    assert snap["captain"] == last_ok and snap["vice_captain"] == vc


def test_late_changes_refused(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    a, b = new_manager(app_url), new_manager(app_url)
    v = make_squad(a)
    st, bn = [p["id"] for p in starters(v)], [p["id"] for p in bench(v)]
    out = bench(v)[3]
    inn = replacement(a, v, out)
    lock(op)
    locked = view(a)
    ledger_before = ledger(a)
    err(confirm(a, n, [out["id"]], [inn["id"]], 0), 409, "gameweek_locked")
    err(a.post("/api/chips", {"gameweek": n, "chip": "bench_boost"}), 409, "gameweek_locked")
    err(picks(a, v, st, bn, st[7], st[6]), 409, "gameweek_locked")
    err(b.post("/api/squad", {"players": [p["id"] for p in pick_squad(catalogue(b))]}), 409, "gameweek_locked")
    assert view(a) == locked and ledger(a) == ledger_before and a.get("/api/history/transfers").json()["transfers"] == []
    err(b.get("/api/squad"), 404, "no_squad")
    refusal = f"Your change for gameweek {n} arrived after the deadline and was not saved."
    got = poll(lambda: pb_notices(a.email, "transfer_refused"), lambda rs: len(rs) >= 3, NOTICE_CATCHUP_S + SLACK_S, "refusal notices")
    assert [r["message"] for r in got] == [refusal] * 3 and all(r["gameweek"] == n for r in got)
    got_b = poll(lambda: pb_notices(b.email, "transfer_refused"), lambda rs: len(rs) >= 1, NOTICE_CATCHUP_S + SLACK_S, "refusal for squadless manager")
    assert [r["message"] for r in got_b] == [refusal]


def test_wf_deadline_lock_journey(app_url, browser):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    m = new_manager(app_url)
    v = make_squad(m)
    out = bench(v)[2]
    inn = replacement(m, v, out)
    m.put("/api/transfers/draft", {"gameweek": n, "out": [out["id"]], "in": [inn["id"]]})
    with ui(browser, app_url, m, "/transfers") as tab:
        deadline = schedule_lock(op, n)
        click(tab.get_by_role("button", name="Review transfers"))
        dialog = tab.get_by_role("dialog", name="Confirm transfers")
        with held(tab, "**/api/transfers") as gate:
            click(dialog.get_by_role("button", name="Confirm transfers"))
            wait_until(tab, lambda: "Confirming…" in text(dialog), what="pending copy")
            wait_status(m, n, "locked", LOCK_LEAD_S + LOCK_S + SLACK_S)
            gate.release()
        announced_once(tab, "Team updates", DEADLINE_COPY.format(n=n))
        wait_until(tab, lambda: text(tab.get_by_role("status", name="Locked banner")) == LOCKED_BANNER.format(n=n), SYNC_S + SLACK_S, "locked banner")
        soon(tab.get_by_role("button", name="Review transfers"), "to_be_disabled")
        if dialog.is_visible():
            tab.keyboard.press("Escape")
            if dialog.is_visible() and not focus_in(dialog):
                dialog.dispatch_event("keydown", {"key": "Escape", "code": "Escape", "bubbles": True})
            soon(dialog, "to_be_hidden")
        click(tab.get_by_role("button", name=re.compile("^Notices")))
        inbox = tab.get_by_role("dialog", name="Notices").get_by_role("list", name="Notices")
        wait_until(tab, lambda: f"Gameweek {n} is locked. Your team is set." in text(inbox), NOTICE_CATCHUP_S + SLACK_S, "deadline notice")
    draft = m.get("/api/transfers/draft").json()
    assert m.get("/api/history/transfers").json()["transfers"] == [] and draft["state"] == "clean" and draft["refusal"] is None and draft["out"] == draft["in"] == []
    assert any(r["kind"] == "deadline_locked" for r in pb_notices(m.email))
    assert ts(current(m)["server_time"]) >= deadline


def test_wf_deadline_lock_device_clock(app_url, browser):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    m = new_manager(app_url)
    v = make_squad(m)
    with ui(browser, app_url, m, "/transfers") as tab1, ui(browser, app_url, m, "/team") as tab2:
        tab2.clock.set_system_time(WRONG_FUTURE)
        tab2.reload()
        install_watch(tab2)
        schedule_lock(op, n)
        open_line = f"Gameweek {n} · Open · Deadline {current(m)['deadline_local']}"
        for tab in (tab1, tab2):
            wait_until(tab, lambda tab=tab: text(tab.get_by_role("status", name="Gameweek status")) == open_line, SYNC_S + SLACK_S, "open status line")
        assert tab2.get_by_role("status", name="Locked banner").count() == 0
        soon(chip_button(tab2, "wildcard"), "to_be_enabled")
        wait_status(m, n, "locked", LOCK_LEAD_S + LOCK_S + SLACK_S)
        locked_at = time.monotonic()
        for tab in (tab1, tab2):
            wait_until(tab, lambda tab=tab: text(tab.get_by_role("status", name="Locked banner")) == LOCKED_BANNER.format(n=n),
                       max(SYNC_S + SLACK_S - (time.monotonic() - locked_at), 1), "locked banner")
            assert text(tab.get_by_role("status", name="Gameweek status")) == f"Gameweek {n} · Locked"
            soon(chip_button(tab, "wildcard"), "to_be_disabled")
        soon(tab1.get_by_role("button", name="Review transfers"), "to_be_disabled")
        before = view(m)
        shirt(tab2, captain(v)["name"]).focus()
        tab2.keyboard.press("Enter")
        tab2.keyboard.press("v")
        advance(tab2, 2000)
        assert view(m) == before
        with ui(browser, app_url, m, "/team") as tab3:
            tab3.clock.set_system_time(WRONG_PAST)
            tab3.reload()
            wait_until(tab3, lambda: text(tab3.get_by_role("status", name="Gameweek status")) == f"Gameweek {n} · Locked", what="past clock still locked")
            soon(tab3.get_by_role("status", name="Locked banner"), "to_have_count", 1)


def snapshot_matches(snap, v, n, mid, team):
    assert (snap["gameweek"], snap["manager_id"], snap["team_name"]) == (n, mid, team)
    assert snap["starting"] == [p["id"] for p in starters(v)] and snap["bench"] == [p["id"] for p in bench(v)]
    assert (snap["captain"], snap["vice_captain"], snap["chip"], snap["bank_tenths"]) == (captain(v)["id"], vice(v)["id"], v["chip"], v["bank_tenths"])
    assert sorted(snap["squad"], key=lambda s: s["player_id"]) == sorted(
        ({"player_id": p["id"], "position": p["position"], "club": p["club"], "purchase_price_tenths": p["purchase_price_tenths"],
          "selling_price_tenths": p["selling_price_tenths"]} for p in v["players"]), key=lambda s: s["player_id"])
    ts(snap["locked_at"])


def test_snapshot_store(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    a, b = new_manager(app_url), new_manager(app_url)
    make_squad(a)
    v = set_roles(a, starters(view(a))[6]["id"], starters(view(a))[7]["id"])
    _, deadline = lock(op)
    mid, bid = history(a)["manager_id"], history(b)["manager_id"]
    poll(lambda: history_row(a, n), lambda row: row and row["receipt"] == "stored", API_WAIT_S, "receipt stored")
    key = f"snapshots/gw-{n:02d}/{mid}.json"
    assert S3().keys(f"snapshots/gw-{n:02d}/{mid}") == [key] and S3().keys(f"snapshots/gw-{n:02d}/{bid}") == []
    snap = json.loads(S3().get(key).decode("utf-8"))
    snapshot_matches(snap, v, n, mid, a.team)
    assert deadline <= ts(snap["locked_at"]) <= deadline + timedelta(seconds=LOCK_S + SLACK_S)
    assert history_row(b, n) is None
    assert sum(1 for row in history(a)["rows"] if row["gameweek"] == n) == 1


def test_snapshot_download(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    a = new_manager(app_url)
    make_squad(a)
    lock(op)
    mid = history(a)["manager_id"]
    poll(lambda: history_row(a, n), lambda row: row and row["receipt"] == "stored", API_WAIT_S, "receipt stored")
    key = f"snapshots/gw-{n:02d}/{mid}.json"
    stored = S3().get(key)
    r = a.get(f"/api/history/{n}/snapshot")
    assert r.status_code == 200 and r.content == stored and r.headers["content-type"].startswith("application/json")
    disposition = r.headers["content-disposition"]
    assert disposition.startswith("attachment") and f'filename="elevens-gw{n:02d}-{mid}.json"' in disposition
    err(a.get(f"/api/history/{n + 1}/snapshot"), 404)
    start(op, n)
    close(op, n)
    now = view(a)
    out = bench(now)[3]
    transfer(a, [(out["id"], replacement(a, now, out)["id"])])
    set_roles(a, starters(view(a))[8]["id"], starters(view(a))[9]["id"])
    assert price_run(op, [(starters(view(a))[1]["id"], 1)])[1].status_code == 201
    assert a.get(f"/api/history/{n}/snapshot").content == stored == S3().get(key)


def test_member_history_snapshots(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    a, b, c = new_manager(app_url), new_manager(app_url), new_manager(app_url)
    make_squad(a)
    lg = league_with(a, b)
    lock(op)
    mid = history(a)["manager_id"]
    poll(lambda: history_row(a, n), lambda row: row and row["receipt"] == "stored", API_WAIT_S, "receipt stored")
    stored = S3().get(f"snapshots/gw-{n:02d}/{mid}.json")
    rb = b.get(f"/api/leagues/{lg['id']}/members/{mid}/snapshots/{n}")
    assert rb.status_code == 200 and rb.content == stored and rb.headers["content-type"].startswith("application/json")
    assert f'filename="elevens-gw{n:02d}-{mid}.json"' in rb.headers["content-disposition"]
    assert b.get(f"/api/leagues/{lg['id']}/members/{mid}/history").json()["rows"] == history(a)["rows"]
    err(c.get(f"/api/leagues/{lg['id']}/members/{mid}/history"), 404)
    err(c.get(f"/api/leagues/{lg['id']}/members/{mid}/snapshots/{n}"), 404)
    cid = history(c)["manager_id"]
    err(b.get(f"/api/leagues/{lg['id']}/members/{cid}/history"), 404)
    err(b.get(f"/api/leagues/{lg['id']}/members/{cid}/snapshots/{n}"), 404)


def test_wf_snapshots_receipt(app_url, browser):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    m = new_manager(app_url)
    make_squad(m)
    chosen = starters(view(m))[5]
    set_roles(m, chosen["id"], starters(view(m))[6]["id"])
    sold = bench(view(m))[3]
    bought = replacement(m, view(m), sold)
    parallel_confirm(m, sold, bought)
    with ui(browser, app_url, m, "/transfers") as tr:
        soon(chip_button(tr, "wildcard"), "to_be_enabled")
        lock_reaches(op, m, [tr], n)
    with ui(browser, app_url, m, "/history") as page:
        table = page.get_by_role("table", name="Gameweek history")
        wait_until(page, lambda: STORED in text(table), API_WAIT_S, "stored receipt")
        with page.expect_download() as info:
            click(page.get_by_role("link", name=f"Download gameweek {n} snapshot"))
        data = Path(info.value.path()).read_bytes()
    mid = history(m)["manager_id"]
    assert data == S3().get(f"snapshots/gw-{n:02d}/{mid}.json")
    assert json.loads(data)["captain"] == chosen["id"]
    assert bought["id"] in data.decode() and sold["id"] not in data.decode()


class Relay:

    def __init__(self, port, target):
        self.port, self.target, self.sock = port, target, None

    def open(self):
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen()
        threading.Thread(target=self.accept, daemon=True).start()

    def accept(self):
        while True:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            upstream = socket.create_connection(self.target)
            for src, dst in ((client, upstream), (upstream, client)):
                threading.Thread(target=self.pipe, args=(src, dst), daemon=True).start()

    @staticmethod
    def pipe(src, dst):
        with contextlib.suppress(OSError):
            while data := src.recv(65536):
                dst.sendall(data)
        with contextlib.suppress(OSError):
            dst.shutdown(socket.SHUT_WR)

    def close(self):
        if self.sock:
            with contextlib.suppress(OSError):
                self.sock.shutdown(socket.SHUT_RDWR)
            self.sock.close()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_wf_snapshots_pending_receipt(app_url, browser):
    down = os.environ["APP_MINIO_DOWN_URL"]
    op = operator(down)
    ensure_open(op)
    m = new_manager(down)
    make_squad(m)
    mid = history(m)["manager_id"]
    for _ in range(LAST_GAMEWEEK):
        n = current(op)["number"]
        if not S3().keys(f"snapshots/gw-{n:02d}/{mid}"):
            break
        lock(op); start(op, n); close(op, n)
    lock(op)
    key = f"snapshots/gw-{n:02d}/{mid}.json"
    assert history_row(m, n)["receipt"] == "pending"
    err(m.get(f"/api/history/{n}/snapshot"), 409, "receipt_pending")
    target = urlparse(os.environ["S3_ENDPOINT"])
    relay_port, app_port = free_port(), free_port()
    relay = Relay(relay_port, (target.hostname, target.port or 80))
    env = dict(os.environ, S3_ENDPOINT=f"http://127.0.0.1:{relay_port}", DATABASE_URL=os.environ["DATABASE_URL"] + "_minio_down", APP_PUBLIC_PORT=str(app_port))
    deployed = Path(conftest.DEPLOYED_APP)
    serve = json.loads((deployed / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=deployed, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    copy = f"http://127.0.0.1:{app_port}"
    try:
        def healthy():
            assert proc.poll() is None, Path(log.name).read_text()[-4000:]
            with contextlib.suppress(httpx.HTTPError):
                return httpx.get(copy + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200
            return False
        poll(healthy, bool, BOOT_S, "copy health")
        with ui(browser, copy, m, "/history") as page:
            table = page.get_by_role("table", name="Gameweek history")
            wait_until(page, lambda: PENDING in text(table), what="pending copy")
            assert page.get_by_role("link", name=f"Download gameweek {n} snapshot").count() == 0
            assert S3().keys(key) == []
            relay.open()
            poll(lambda: S3().keys(key), lambda k: k == [key], SNAPSHOT_RETRY_S + API_WAIT_S, "snapshot written after storage returns")
            stored_at = time.monotonic()
            wait_until(page, lambda: STORED in text(table), max(SYNC_S + SLACK_S - (time.monotonic() - stored_at), 1), "stored copy")
            soon(page.get_by_role("link", name=f"Download gameweek {n} snapshot"), "to_be_visible")
        stored = S3().get(key)
        snap = json.loads(stored)
        assert snap["manager_id"] == mid and snap["team_name"] == m.team and snap["gameweek"] == n
        assert Api(copy, m.token).get(f"/api/history/{n}/snapshot").content == stored
        body = err(m.get(f"/api/history/{n}/snapshot"), 503, "storage_unavailable")
        assert body["message"]
        with ui(browser, down, m, "/history", size=PHONE) as page:
            table = page.get_by_role("table", name="Gameweek history")
            wait_until(page, lambda: STORED in text(table), what="stored copy on the storage-down History")
            layout(page)
            link = page.get_by_role("link", name=f"Download gameweek {n} snapshot")
            soon(link, "to_be_visible")
            tab_to(page, link)
            page.keyboard.press("Enter")
            announced_once(page, "History updates", "Storage is unreachable. Try the download again in a minute.")
    finally:
        relay.close()
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, 15)
        proc.wait(timeout=HTTP_TIMEOUT_S)


def test_match_events(app_url):
    op = operator(app_url)
    n = ensure_live(op)
    m = new_manager(app_url)
    test_ids = {}
    for pos in ("GK", "DEF", "MID", "FWD"):
        test_ids[pos] = unused_player(op, n, pos, test_ids.values())
    cases = [("GK", "goal", None, GOAL["GK"]), ("DEF", "goal", None, GOAL["DEF"]), ("MID", "goal", None, GOAL["MID"]),
             ("FWD", "goal", None, GOAL["FWD"]), ("MID", "assist", None, ASSIST), ("GK", "clean_sheet", None, CLEAN_SHEET["GK"]),
             ("DEF", "clean_sheet", None, CLEAN_SHEET["DEF"]), ("MID", "clean_sheet", None, CLEAN_SHEET["MID"]),
             ("FWD", "clean_sheet", None, CLEAN_SHEET["FWD"]), ("DEF", "yellow_card", None, YELLOW), ("FWD", "red_card", None, RED),
             ("GK", "own_goal", None, OWN_GOAL), ("MID", "bonus", 2, 2), ("FWD", "minutes", 30, SHORT_MINUTES),
             ("FWD", "minutes", 75, FULL_MINUTES - SHORT_MINUTES), ("FWD", "minutes", 50, 0)]
    raw = Counter()
    for pos, typ, value, delta in cases:
        body = scored(op, n, test_ids[pos], typ, value)
        assert body["points_delta"] == delta and body["voided"] is False and body["gameweek"] == n, (pos, typ, body)
        assert (body["player_id"], body["type"]) == (test_ids[pos], typ)
        raw[pos] += delta
    points = lambda pid: next(p for p in catalogue(m) if p["id"] == pid)["gameweek_points"]
    for pos, pid in test_ids.items():
        assert points(pid) == raw[pos], pos
    for body in ({"type": "minutes"}, {"type": "goal", "value": 1}, {"type": "minutes", "value": 121}, {"type": "bonus", "value": 4}, {"type": "header"}):
        r = op.post("/api/operator/events", dict({"event_id": f"ev-{tag()}", "fixture_id": fixture_id(n, test_ids["GK"].split("-")[0]), "player_id": test_ids["GK"]}, **body))
        err(r, 422, "validation")
    other = next(c for c in CLUBS if fixture_id(n, c) != fixture_id(n, test_ids["GK"].split("-")[0]))
    err(op.post("/api/operator/events", {"event_id": f"ev-{tag()}", "fixture_id": fixture_id(n, other), "player_id": test_ids["GK"], "type": "goal"}), 422, "validation")
    err(op.post("/api/operator/events", {"event_id": f"ev-{tag()}", "fixture_id": "gw99-AAA-BBB", "player_id": test_ids["GK"], "type": "goal"}), 422, "validation")
    assert points(test_ids["GK"]) == raw["GK"]
    err(new_manager(app_url).post("/api/operator/events", {"event_id": f"ev-{tag()}", "fixture_id": fixture_id(n, "HAR"), "player_id": "HAR-GK1", "type": "goal"}), 403, "forbidden")


def test_event_replay(app_url):
    op = operator(app_url)
    n = ensure_live(op)
    m = new_manager(app_url)
    pid = RNG.choice(sorted(seed_players()))
    points = lambda: next(p for p in catalogue(m) if p["id"] == pid)["gameweek_points"]
    before = points()
    eid = f"ev-{tag()}"
    first = event(op, n, pid, "assist", event_id=eid)
    replay = event(op, n, pid, "assist", event_id=eid)
    assert first.status_code == replay.status_code == 201 and replay.json() == first.json() and replay.headers.get("Idempotent-Replayed") == "true"
    assert points() == before + ASSIST
    err(event(op, n, pid, "goal", event_id=eid), 409, "event_id_conflict")
    assert points() == before + ASSIST
    eid2 = f"ev-{tag()}"
    burst = parallel([lambda: event(op, n, pid, "assist", event_id=eid2) for _ in range(5)])
    assert all(r.status_code == 201 for r in burst) and len({json.dumps(r.json(), sort_keys=True) for r in burst}) == 1
    assert sum(r.headers.get("Idempotent-Replayed") == "true" for r in burst) == 4
    assert points() == before + 2 * ASSIST
    log = op.get(f"/api/operator/gameweeks/{n}/events").json()["events"]
    assert sorted(e["event_id"] for e in log if e["event_id"] in (eid, eid2)) == sorted([eid, eid2])


def test_event_void(app_url):
    op = operator(app_url)
    n = ensure_live(op)
    m = new_manager(app_url)
    pid = unused_player(op, n, "MID")
    row = lambda: next(p for p in catalogue(m) if p["id"] == pid)
    start_total = row()["total_points"]
    goal = scored(op, n, pid, "goal")
    assert (row()["gameweek_points"], row()["total_points"]) == (GOAL["MID"], start_total + GOAL["MID"])
    voided = op.post(f"/api/operator/events/{goal['event_id']}/void")
    assert voided.status_code == 200 and voided.json()["voided"] is True and voided.json()["event_id"] == goal["event_id"]
    assert (row()["gameweek_points"], row()["total_points"]) == (0, start_total)
    again = op.post(f"/api/operator/events/{goal['event_id']}/void")
    assert again.status_code == 200 and again.json()["voided"] is True
    assert (row()["gameweek_points"], row()["total_points"]) == (0, start_total)
    log = op.get(f"/api/operator/gameweeks/{n}/events").json()["events"]
    assert [e["voided"] for e in log if e["event_id"] == goal["event_id"]] == [True]
    err(op.post(f"/api/operator/events/ev-{tag()}/void"), 404, "not_found")


def test_gameweek_states(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    m = new_manager(app_url)
    make_squad(m)
    pid = "HAR-MID2"
    empty = {"starting": [], "bench": [], "captain": "", "vice_captain": ""}
    if not current(op)["deadline"]:
        publish(op, n, ts(current(op)["server_time"]).replace(microsecond=0) + DEADLINE_LEAD + timedelta(days=1))
    err(op.post(f"/api/operator/gameweeks/{n}/start"), 409, "gameweek_not_locked")
    err(op.post(f"/api/operator/gameweeks/{n}/close"), 409, "gameweek_not_live")
    err(event(op, n, pid, "goal"), 409, "gameweek_not_live")
    err(op.put(f"/api/operator/gameweeks/{n + 1}/fixtures", {"fixtures": []}), 409, "gameweek_not_open")
    err(op.post(f"/api/operator/gameweeks/{n + 1}/start"), 409, "gameweek_not_locked")
    err(m.put("/api/picks", dict(empty, gameweek=n + 1)), 409, "gameweek_not_open")
    lock(op)
    err(event(op, n, pid, "goal"), 409, "gameweek_not_live")
    err(op.post(f"/api/operator/gameweeks/{n}/close"), 409, "gameweek_not_live")
    starts = parallel([lambda: op.post(f"/api/operator/gameweeks/{n}/start") for _ in range(4)])
    assert sorted(r.status_code for r in starts) == [200, 409, 409, 409]
    assert current(op)["status"] == "live"
    err(op.post(f"/api/operator/gameweeks/{n}/start"), 409, "gameweek_not_locked")
    eid = scored(op, n, pid, "minutes", 60)["event_id"]
    closes = parallel([lambda: op.post(f"/api/operator/gameweeks/{n}/close") for _ in range(4)])
    assert sorted(r.status_code for r in closes) == [200, 409, 409, 409]
    assert sum(1 for row in history(m)["rows"] if row["gameweek"] == n) == 1
    err(event(op, n, pid, "goal"), 409, "gameweek_not_live")
    err(op.post(f"/api/operator/events/{eid}/void"), 409, "gameweek_not_live")
    err(op.post(f"/api/operator/gameweeks/{n}/start"), 409, "gameweek_not_locked")
    err(m.put("/api/picks", dict(empty, gameweek=n)), 409, "gameweek_locked")
    assert current(op)["number"] == n + 1 and current(op)["status"] == "open"


def live_pair(app_url, op):
    n = ensure_open(op)["number"]
    t = tag()
    viewer, rival = new_manager(app_url, team=f"Zed {t}"), new_manager(app_url, team=f"Abe {t}")
    v = make_squad(viewer)
    make_squad(rival, exclude=[p["id"] for p in v["players"]])
    lg = league_with(viewer, rival)
    lock(op)
    start(op, n)
    return n, viewer, rival, lg, view(viewer)


def test_wf_live_scoring_resend(app_url, browser):
    op = operator(app_url)
    n, viewer, rival, lg, v = live_pair(app_url, op)
    cap = captain(v)
    mid = history(viewer)["manager_id"]
    with ui(browser, app_url, viewer, f"/team?league={lg['id']}") as pa, ui(browser, app_url, rival, f"/team?league={lg['id']}") as pb:
        soon(pa.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")

        def settled(expect_points):
            sv, row = view(viewer), row_of(viewer, lg["id"], mid)
            want = {"shirt": str(by_id(sv, cap["id"])["team_points"]), "total": str(sv["gameweek_total"]),
                    "row_points": str(row["season_total"]), "row_rank": str(row["rank"])}
            assert sv["gameweek_total"] == expect_points
            began = time.monotonic()
            wait_until(pa, lambda: board(pa, cap["id"], mid) == want, SYNC_S + SLACK_S, "viewer board")
            wait_until(pb, lambda: {k: board(pb, None, mid)[k] for k in ("row_points", "row_rank")} == {k: want[k] for k in ("row_points", "row_rank")},
                       max(SYNC_S + SLACK_S - (time.monotonic() - began), 1), "rival's league table")
            return want

        eid = f"ev-{tag()}"
        relay_order(pa, op, viewer, n, cap, lg["id"], mid, event_id=eid)
        want = settled(2 * GOAL[cap["position"]])
        assert event(op, n, cap, "goal", event_id=eid).headers.get("Idempotent-Replayed") == "true"
        advance(pa, 3000)
        assert board(pa, cap["id"], mid) == want and view(viewer)["gameweek_total"] == 2 * GOAL[cap["position"]]
        assert op.post(f"/api/operator/events/{eid}/void").status_code == 200
        announced_once(pa, "Live points", f"{cap['name']}: goal removed, -{2 * GOAL[cap['position']]} for your team. Gameweek total 0.", SYNC_S + SLACK_S + UI_WAIT_S)
        settled(0)


def test_wf_live_scoring_console_goal(app_url, browser):
    op = operator(app_url)
    n, viewer, _, lg, v = live_pair(app_url, op)
    cap = captain(v)
    raw = GOAL[cap["position"]]
    fid = fixture_id(n, cap["club"])
    h, a = fid.split("-")[1:]
    with ui(browser, app_url, viewer, "/team") as team, ui(browser, app_url, op, "/operator") as console:
        soon(team.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        pick(console, console.get_by_role("combobox", name="Fixture"), lambda label: club_in(label, h) and club_in(label, a))
        pick(console, console.get_by_role("combobox", name="Player", exact=True), lambda label: named(label, cap["name"]))
        pick(console, console.get_by_role("combobox", name="Event"),
             lambda label: re.search(r"\bgoal\b", label, re.I) is not None and re.search("own", label, re.I) is None)
        click(console.get_by_role("button", name="Record event"))
        announced_once(console, "Operator updates", "Event recorded.")
        events_log = console.get_by_role("list", name="Event log")
        wait_until(console, lambda: cap["name"] in text(events_log) and str(raw) in text(events_log), what="event log points")
        soon(events_log.get_by_role("button", name="Void"), "to_have_count", 1)
        wait_until(team, lambda: shirt(team, cap["name"]).get_attribute("data-points") == str(2 * raw), SYNC_S + SLACK_S, "captain shirt")
        soon(shirt(team, cap["name"]), "to_have_accessible_name", re.compile(rf", {2 * raw} points, captain$"))
    log = op.get(f"/api/operator/gameweeks/{n}/events").json()["events"]
    assert [(e["player_id"], e["type"], e["points_delta"]) for e in log] == [(cap["id"], "goal", raw)]
    assert by_id(view(viewer), cap["id"])["team_points"] == 2 * raw


RELAY_JS = """(a) => {
  window.__relay = [];
  const now = () => ({fake: Date.now(), real: document.timeline.currentTime});
  const rec = (kind, extra) => window.__relay.push(Object.assign({kind}, now(), extra || {}));
  const center = (el) => { const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; };
  let lastTotal = null;
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') {
        const el = m.target;
        if (el.getAttribute('data-player-id') === a.player && m.attributeName === 'data-points') rec('shirt', {v: el.getAttribute('data-points')});
        else if (el.hasAttribute('data-gameweek-total') && m.attributeName === 'data-points') rec('total', {v: el.getAttribute('data-points')});
        else if (el.getAttribute('data-manager-id') === a.manager) rec('row', {v: el.getAttribute('data-points'), rank: el.getAttribute('data-rank')});
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const c = n.matches('[data-relay-chip]') ? n : n.querySelector('[data-relay-chip]');
        if (c) rec('chip-in', {text: c.textContent});
      }
    }
    const total = document.querySelector('[data-gameweek-total]');
    if (total && total.textContent !== lastTotal) { lastTotal = total.textContent; rec('total-text', {text: lastTotal}); }
  }).observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-points', 'data-rank']});
  const sample = () => {
    const c = document.querySelector('[data-relay-chip]');
    if (c) rec('chip', {at: center(c), shirt: center(document.querySelector('[data-player-id="' + a.player + '"]')), total: center(document.querySelector('[data-gameweek-total]'))});
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}"""


def test_wf_points_relay_motion(app_url, browser):
    op = operator(app_url)
    n, viewer, _, lg, v = live_pair(app_url, op)
    cap, bencher = captain(v), bench(v)[0]
    mid = history(viewer)["manager_id"]
    delta = 2 * GOAL[cap["position"]]
    with ui(browser, app_url, viewer, f"/team?league={lg['id']}") as page:
        soon(page.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        page.evaluate(RELAY_JS, {"player": cap["id"], "manager": mid})
        gid = scored(op, n, cap, "goal")["event_id"]
        end = time.monotonic() + SYNC_S + SLACK_S + RELAY_MAX_MS / 1000
        while not any(e["kind"] == "row" and e["v"] == str(delta) for e in page.evaluate("() => window.__relay")):
            assert time.monotonic() < end, page.evaluate("() => window.__relay")
            advance(page, RELAY_STEP_MS)
        advance(page, RELAY_MAX_MS)
        log = page.evaluate("() => window.__relay")
        idx = lambda kind, v=None: next(i for i, e in enumerate(log) if e["kind"] == kind and (v is None or e.get("v") == v))
        i_shirt, i_chip, i_total, i_row = idx("shirt", str(delta)), idx("chip-in"), idx("total", str(delta)), idx("row", str(delta))
        assert i_shirt < i_total and i_chip < i_total < i_row, [e["kind"] for e in log]
        chip_text = log[i_chip]["text"]
        assert f"+{delta}" in chip_text and "x2" in chip_text
        flight = [e for e in log[:i_total] if e["kind"] == "chip"]
        assert flight, "the chip never rendered before the roll"
        dist = lambda e, k: ((e["at"]["x"] - e[k]["x"]) ** 2 + (e["at"]["y"] - e[k]["y"]) ** 2) ** 0.5
        assert dist(flight[0], "shirt") < dist(flight[0], "total"), "the chip does not start on the shirt"
        span = {c: log[i_row][c] - log[i_shirt][c] for c in ("fake", "real")}
        assert min(span.values()) <= RELAY_MAX_MS and max(span.values()) >= RELAY_MIN_MS, span
        sv, row = view(viewer), row_of(viewer, lg["id"], mid)
        assert board(page, cap["id"], mid) == {"shirt": str(by_id(sv, cap["id"])["team_points"]), "total": str(sv["gameweek_total"]),
                                               "row_points": str(row["season_total"]), "row_rank": str(row["rank"])}
        assert row["rank"] == 1
        del bencher, gid


def test_wf_points_relay_announcements(app_url, browser):
    op = operator(app_url)
    n, viewer, _, lg, v = live_pair(app_url, op)
    cap, bencher = captain(v), bench(v)[0]
    delta = 2 * GOAL[cap["position"]]
    with ui(browser, app_url, viewer, f"/team?league={lg['id']}") as page:
        soon(page.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        gid = scored(op, n, cap, "goal")["event_id"]
        announced_once(page, "Live points", f"{cap['name']}: goal, +{delta} for your team. Gameweek total {delta}.", SYNC_S + SLACK_S + UI_WAIT_S)
        scored(op, n, bencher, "goal")
        announced_once(page, "Live points", f"{bencher['name']}: goal on your bench, not counted.", SYNC_S + SLACK_S + UI_WAIT_S)
        assert str(view(viewer)["gameweek_total"]) == str(delta)
        assert op.post(f"/api/operator/events/{gid}/void").status_code == 200
        announced_once(page, "Live points", f"{cap['name']}: goal removed, -{delta} for your team. Gameweek total 0.", SYNC_S + SLACK_S + UI_WAIT_S)
        scored(op, n, cap, "minutes", 30)
        announced_once(page, "Live points", f"{cap['name']}: minutes played, +{2 * SHORT_MINUTES} for your team. Gameweek total {2 * SHORT_MINUTES}.", SYNC_S + SLACK_S + UI_WAIT_S)
        mentions = lambda: sum(1 for t in page.evaluate("(n) => (window.__regions || {})[n] || []", "Live points")
                               if f"{cap['name']}:" in t)
        before = mentions()
        scored(op, n, cap, "minutes", 45)
        advance(page, (SYNC_S + SLACK_S) * 1000)
        assert mentions() == before, page.evaluate("(n) => (window.__regions || {})[n]", "Live points")


def test_wf_points_relay_reduced_motion(app_url, browser):
    op = operator(app_url)
    n, viewer, _, lg, v = live_pair(app_url, op)
    cap = captain(v)
    mid = history(viewer)["manager_id"]
    delta = 2 * GOAL[cap["position"]]
    with ui(browser, app_url, viewer, f"/team?league={lg['id']}", reduced_motion="reduce") as page:
        soon(page.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        page.evaluate(RELAY_JS, {"player": cap["id"], "manager": mid})
        scored(op, n, cap, "goal")
        wait_until(page, lambda: board(page, cap["id"], mid)["row_points"] == str(delta), SYNC_S + SLACK_S, "values at once")
        log = page.evaluate("() => window.__relay")
        changes = [e for e in log if e["kind"] in ("shirt", "total", "row")]
        assert {e["kind"] for e in changes} == {"shirt", "total", "row"}
        assert changes[-1]["fake"] - changes[0]["fake"] < RELAY_MIN_MS
        spots = [e["at"] for e in log if e["kind"] == "chip"]
        assert all(abs(c["x"] - spots[0]["x"]) <= 1 and abs(c["y"] - spots[0]["y"]) <= 1 for c in spots), spots
        for region in (pitch(page), page.get_by_role("complementary", name="Ledger"), page.get_by_role("table", name="League table")):
            assert moving(region) == [], animations(region)
        badge = shirt(page, cap["name"])
        assert f"+{delta}" in card_text(badge) and "x2" in card_text(badge)
        advance(page, BADGE_MS - 1000)
        assert f"+{delta}" in card_text(badge)
        advance(page, 2000)
        assert f"+{delta}" not in card_text(badge)
        sv, row = view(viewer), row_of(viewer, lg["id"], mid)
        assert board(page, cap["id"], mid) == {"shirt": str(by_id(sv, cap["id"])["team_points"]), "total": str(sv["gameweek_total"]),
                                               "row_points": str(row["season_total"]), "row_rank": str(row["rank"])} and row["rank"] == 1
        assert announcements(page, "Live points", f"{cap['name']}: goal, +{delta} for your team. Gameweek total {sv['gameweek_total']}.") == 1


def autosub_setup(app_url, op, a):
    n = current(op)["number"]
    v = view(a)
    fwd_cap = next(p for p in starters(v) if p["position"] == "FWD")
    mid_vc = next(p for p in starters(v) if p["position"] == "MID")
    set_roles(a, fwd_cap["id"], mid_vc["id"])
    lock(op)
    start(op, n)
    v = view(a)
    st, bn = starters(v), bench(v)
    d1 = next(p for p in st if p["position"] == "DEF")
    cap, vc = captain(v), vice(v)
    played = [p for p in st if p["id"] not in (d1["id"], cap["id"])] + [bn[0], bn[2], bn[3]]
    for p in played:
        scored(op, n, p, "minutes", 60)
    scored(op, n, vc, "goal")
    raw = {p["id"]: FULL_MINUTES for p in played}
    raw[vc["id"]] += GOAL[vc["position"]]
    return n, st, bn, d1, cap, vc, raw


def test_close_autosubs(app_url):
    op = operator(app_url)
    ensure_open(op)
    a = new_manager(app_url)
    make_squad(a)
    n, st, bn, d1, cap, vc, raw = autosub_setup(app_url, op, a)
    assert view(a)["gameweek_total"] == sum(raw.get(p["id"], 0) for p in st)
    final = [p for p in st if p["id"] not in (d1["id"], cap["id"])] + [bn[2], bn[3]]
    points = sum(raw[p["id"]] for p in final) + raw[vc["id"]]
    close(op, n)
    row = history_row(a, n)
    assert (row["points"], row["net_points"], row["status"]) == (points, points, "closed")


def test_season_totals(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    a = new_manager(app_url)
    v = make_squad(a)
    b3, b4 = bench(v)[2], bench(v)[3]
    r3 = replacement(a, v, b3)
    r4 = replacement(a, v, b4, exclude=[r3["id"]])
    assert transfer(a, [(b3["id"], r3["id"]), (b4["id"], r4["id"])])["gameweek_hit_points"] == HIT_POINTS
    lock(op)
    start(op, n)
    for p in starters(view(a)):
        scored(op, n, p, "minutes", 60)
    points = FULL_MINUTES * 11 + FULL_MINUTES
    assert view(a)["gameweek_total"] == points - HIT_POINTS
    live_row = history_row(a, n)
    assert live_row["running_total"] is None and history(a)["season_total"] == points - HIT_POINTS
    close(op, n)
    row = history_row(a, n)
    assert (row["points"], row["hit_points"], row["net_points"], row["status"]) == (points, HIT_POINTS, points - HIT_POINTS, "closed")
    ha = history(a)
    closed_rows = [r for r in ha["rows"] if r["status"] == "closed"]
    assert ha["season_total"] == sum(r["net_points"] for r in closed_rows) == points - HIT_POINTS
    assert [r["running_total"] for r in closed_rows] == [sum(x["net_points"] for x in closed_rows[: i + 1]) for i in range(len(closed_rows))]
    eid = op.get(f"/api/operator/gameweeks/{n}/events").json()["events"][0]["event_id"]
    err(op.post(f"/api/operator/events/{eid}/void"), 409, "gameweek_not_live")
    assert history_row(a, n) == row


def test_league_standings(app_url):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    t = tag()
    a, b, c = new_manager(app_url, team=f"Top {t}"), new_manager(app_url, team=f"Zed {t}"), new_manager(app_url, team=f"alpha {t}")
    v = make_squad(a)
    make_squad(c, exclude=[p["id"] for p in v["players"]])
    lg = league_with(a, b, c)
    lock(op)
    start(op, n)
    scored(op, n, captain(view(a)), "minutes", 60)
    live = view(a)["gameweek_total"]
    assert live == 2 * FULL_MINUTES
    table = standings(b, lg["id"])
    assert [s["team_name"] for s in table] == [a.team, c.team, b.team]
    assert [s["season_total"] for s in table] == [live, 0, 0] and table[0]["gameweek_points"] == live and table[0]["rank"] == 1
    close(op, n)
    table = standings(b, lg["id"])
    assert [s["team_name"] for s in table] == [a.team, c.team, b.team]
    assert [s["season_total"] for s in table] == [history(a)["season_total"], 0, 0] and table[0]["gameweek_points"] == live
    assert all(s["last_rank"] == s["rank"] for s in table) and standings(a, lg["id"]) == table


def test_notice_inbox(app_url):
    op = operator(app_url)
    ensure_open(op)
    a, c = new_manager(app_url), new_manager(app_url)
    v = make_squad(a)
    make_squad(c, exclude=[p["id"] for p in v["players"]])
    moved = price = None
    for p in RNG.sample(v["players"], len(v["players"])):
        _, r = price_run(op, [(p["id"], 1)])
        assert r.status_code == 201, r.text
        if r.json()["applied"]:
            moved, price = p, r.json()["applied"][0]["price_tenths"]
            break
    assert moved, "no owned player could move"
    n, st, bn, d1, cap, vc, _ = autosub_setup(app_url, op, a)
    close(op, n)
    got = poll(lambda: pb_notices(a.email), lambda rs: sum(r["kind"] == "auto_sub" for r in rs) >= 3, NOTICE_CATCHUP_S + SLACK_S, "notices")
    assert Counter(r["kind"] for r in got) == {"price_change": 1, "deadline_locked": 1, "auto_sub": 3}
    assert [r["message"] for r in got if r["kind"] == "price_change"] == [f"{moved['name']} rose to {money(price)}m."]
    assert [r["message"] for r in got if r["kind"] == "deadline_locked"] == [f"Gameweek {n} is locked. Your team is set."]
    expected = sorted([f"{bn[2]['name']} came on for {d1['name']} in gameweek {n}.", f"{bn[3]['name']} came on for {cap['name']} in gameweek {n}.",
                       f"{vc['name']} took the armband in gameweek {n}."])
    assert sorted(r["message"] for r in got if r["kind"] == "auto_sub") == expected
    assert all(r["gameweek"] == n for r in got if r["kind"] != "price_change") and not any(r["read"] for r in got)
    other = poll(lambda: pb_notices(c.email), lambda rs: len(rs) >= 1, NOTICE_CATCHUP_S + SLACK_S, "lock notice for the other manager")
    assert [r["kind"] for r in other] == ["deadline_locked"]


def test_wf_gameweek_close_console(app_url, browser):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    m = new_manager(app_url)
    v = make_squad(m)
    b3, b4 = bench(v)[2], bench(v)[3]
    r3 = replacement(m, v, b3)
    transfer(m, [(b3["id"], r3["id"]), (b4["id"], replacement(m, v, b4, exclude=[r3["id"]])["id"])])
    rival = new_manager(app_url)
    make_squad(rival, exclude=[p["id"] for p in view(m)["players"]])
    lg = league_with(m, rival)
    lock(op)
    start(op, n)
    v = view(m)
    st, bn = starters(v), bench(v)
    absent = next(p for p in st if p["position"] == "DEF" and not p["captain"] and not p["vice_captain"])
    for p in [p for p in st if p["id"] != absent["id"]] + [bn[1]]:
        scored(op, n, p, "minutes", 60)
    cap, mid = captain(v), history(m)["manager_id"]
    points = FULL_MINUTES * 11 + FULL_MINUTES + 2 * GOAL[cap["position"]]
    with ui(browser, app_url, op, "/operator") as console, ui(browser, app_url, m, "/history") as hist, \
            ui(browser, app_url, m, f"/team?league={lg['id']}") as team, ui(browser, app_url, rival, f"/team?league={lg['id']}") as other:
        soon(team.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        soon(other.get_by_role("table", name="League table"), "to_be_visible")
        since = time.monotonic()
        relay_order(team, op, m, n, cap, lg["id"], mid)
        rival_sees(other, m, lg["id"], mid, since)
        click(console.get_by_role("button", name="Close gameweek", exact=True))
        dialog = console.get_by_role("dialog", name="Close gameweek")
        click(dialog.get_by_role("button", name="Cancel"))
        assert current(op)["status"] == "live"
        click(console.get_by_role("button", name="Close gameweek", exact=True))
        click(dialog.get_by_role("button", name="Close gameweek"))
        announced_once(console, "Operator updates", f"Gameweek {n} closed. Final scores are in.")
        closed_at = time.monotonic()
        table = hist.get_by_role("table", name="Gameweek history")
        wait_until(hist, lambda: str(points - HIT_POINTS) in text(table), SYNC_S + SLACK_S + UI_WAIT_S, "final net in history")
        wait_until(team, lambda: team.get_by_role("status", name="Locked banner").count() == 0 and team.get_by_role("heading", name="Pick Team").count() == 1,
                   max(SYNC_S + SLACK_S - (time.monotonic() - closed_at), 1), "next gameweek editable")
    row = history_row(m, n)
    assert (row["points"], row["hit_points"], row["net_points"]) == (points, HIT_POINTS, points - HIT_POINTS)
    g = current(m)
    assert (g["number"], g["status"]) == (n + 1, "open") and view(m)["editable"] is True


def test_wf_gameweek_close_illegal_step(app_url, browser):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    with ui(browser, app_url, op, "/operator") as page:
        for name in ("Start gameweek", "Close gameweek"):
            button = page.get_by_role("button", name=name, exact=True)
            soon(button, "to_be_visible")
            if not button.is_enabled():
                continue
            click(button)
            if name == "Close gameweek":
                click(page.get_by_role("dialog", name="Close gameweek").get_by_role("button", name="Close gameweek"))
            announced_once(page, "Operator updates", f"Gameweek {n} cannot do that now.")
            page.reload()
            install_watch(page)
    g = current(op)
    assert (g["number"], g["status"]) == (n, "open")


def test_leagues(app_url):
    a, b, c = new_manager(app_url), new_manager(app_url), new_manager(app_url)
    err(a.post("/api/leagues", {"name": "  x" + " " * 5}), 422, "validation")
    name = f"Supporters {tag()}"
    r = a.post("/api/leagues", {"name": name})
    assert r.status_code == 201, r.text
    lg = r.json()
    assert lg["name"] == name and lg["is_admin"] is True and len(lg["code"]) == CODE_LENGTH and set(lg["code"]) <= CODE_ALPHABET
    assert lg["admin_manager_id"] == history(a)["manager_id"]
    j = b.post("/api/leagues/join", {"code": lg["code"].lower()})
    assert j.status_code == 200 and j.json()["code"] is None and j.json()["is_admin"] is False and j.json()["id"] == lg["id"]
    err(b.post("/api/leagues/join", {"code": lg["code"]}), 409, "already_member")
    err(c.post("/api/leagues/join", {"code": "ZZZZZZ" if lg["code"] != "ZZZZZZ" else "YYYYYY"}), 404, "league_not_found")
    assert a.get(f"/api/leagues/{lg['id']}").json()["code"] == lg["code"] and b.get(f"/api/leagues/{lg['id']}").json()["code"] is None
    err(c.get(f"/api/leagues/{lg['id']}"), 404)
    err(c.post(f"/api/leagues/{lg['id']}/code"), 404)
    err(b.post(f"/api/leagues/{lg['id']}/code"), 403, "forbidden")
    new = a.post(f"/api/leagues/{lg['id']}/code").json()["code"]
    assert new != lg["code"] and len(new) == CODE_LENGTH and set(new) <= CODE_ALPHABET
    err(c.post("/api/leagues/join", {"code": lg["code"]}), 404, "league_not_found")
    assert c.post("/api/leagues/join", {"code": new}).status_code == 200
    mine = next(x for x in b.get("/api/leagues").json()["leagues"] if x["id"] == lg["id"])
    assert mine["members"] == 3 and mine["is_admin"] is False and mine["name"] == name
    err(operator(app_url).post("/api/leagues", {"name": name}), 403, "forbidden")


def test_wf_mini_leagues_new_code(app_url, browser):
    a, b = new_manager(app_url), new_manager(app_url)
    name = f"Podcast {tag()}"
    with ui(browser, app_url, a, "/leagues") as page:
        page.get_by_role("textbox", name="League name").fill(name)
        click(page.get_by_role("button", name="Create league"))
        lg = poll(lambda: a.get("/api/leagues").json()["leagues"], lambda ls: any(x["name"] == name for x in ls), API_WAIT_S, "league created")
        lid = next(x["id"] for x in lg if x["name"] == name)
        code = a.get(f"/api/leagues/{lid}").json()["code"]
        announced_once(page, "League updates", f"League created. Share code {code}.")
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url.rstrip("/"))
        page.goto(f"{app_url.rstrip('/')}/leagues/{lid}")
        install_watch(page)
        click(page.get_by_role("button", name="Copy join code"))
        wait_until(page, lambda: page.evaluate("() => navigator.clipboard.readText()") == code, what="code on clipboard")
        click(page.get_by_role("button", name="New join code"))
        wait_until(page, lambda: a.get(f"/api/leagues/{lid}").json()["code"] != code, what="code replaced")
        new = a.get(f"/api/leagues/{lid}").json()["code"]
        wait_until(page, lambda: "".join(page.evaluate("(n) => (window.__regions || {})[n] || []", "League updates")).count(f"New join code {new}. The old code no longer works.") >= 1, what="new code announced")
    with ui(browser, app_url, b, "/leagues") as page:
        page.get_by_role("textbox", name="Join code").fill(code)
        click(page.get_by_role("button", name="Join league"))
        announced_once(page, "League updates", "No league uses that code.")
        page.get_by_role("textbox", name="Join code").fill(new.lower())
        click(page.get_by_role("button", name="Join league"))
        announced_once(page, "League updates", f"Joined {name}.")
        page.get_by_role("textbox", name="Join code").fill(new)
        click(page.get_by_role("button", name="Join league"))
        announced_once(page, "League updates", "You are already in this league.")
    assert any(x["id"] == lid for x in b.get("/api/leagues").json()["leagues"])


def test_wf_mini_leagues_journey(app_url, browser):
    op = operator(app_url)
    n = ensure_open(op)["number"]
    a, b = new_manager(app_url), new_manager(app_url)
    v = make_squad(a)
    make_squad(b, exclude=[p["id"] for p in v["players"]])
    name = f"Terrace {tag()}"
    with ui(browser, app_url, a, "/leagues") as page:
        page.get_by_role("textbox", name="League name").fill(name)
        click(page.get_by_role("button", name="Create league"))
        lid = poll(lambda: a.get("/api/leagues").json()["leagues"], lambda ls: any(x["name"] == name for x in ls), API_WAIT_S, "league")[0]["id"]
        lid = next(x["id"] for x in a.get("/api/leagues").json()["leagues"] if x["name"] == name)
    code = a.get(f"/api/leagues/{lid}").json()["code"]
    with ui(browser, app_url, b, "/leagues") as page:
        page.get_by_role("textbox", name="Join code").fill(code)
        click(page.get_by_role("button", name="Join league"))
        announced_once(page, "League updates", f"Joined {name}.")
    with ui(browser, app_url, a, f"/team?league={lid}") as ta:
        soon(ta.get_by_role("heading", name="Pick Team"), "to_be_visible")
        lock_reaches(op, a, [ta], n)
    start(op, n)
    amid, bmid = history(a)["manager_id"], history(b)["manager_id"]
    with ui(browser, app_url, a, f"/team?league={lid}") as pa, ui(browser, app_url, b, f"/team?league={lid}") as tb:
        soon(pa.get_by_role("heading", name=f"Gameweek {n} points"), "to_be_visible")
        soon(tb.get_by_role("table", name="League table"), "to_be_visible")
        scored(op, n, captain(view(a)), "minutes", 60)
        wait_until(pa, lambda: board(pa)["total"] == str(view(a)["gameweek_total"]), SYNC_S + SLACK_S + RELAY_MAX_MS / 1000, "minutes settled")
        advance(pa, RELAY_MAX_MS)
        since = time.monotonic()
        relay_order(pa, op, a, n, captain(view(a)), lid, amid)
        rival_sees(tb, a, lid, amid, since)
    with ui(browser, app_url, a, f"/leagues/{lid}") as pa, ui(browser, app_url, b, f"/leagues/{lid}") as pb:
        soon(pa.get_by_role("table", name="Standings"), "to_be_visible")
        close(op, n)
        table = standings(a, lid)
        want = {s["manager_id"]: (str(s["rank"]), str(s["season_total"])) for s in table}
        read = lambda p: {m: tuple(p.evaluate("(m) => { const r = document.querySelector('[data-manager-id=\"' + m + '\"]'); return r ? [r.getAttribute('data-rank'), r.getAttribute('data-points')] : null; }", m) or ()) for m in want}
        for p in (pa, pb):
            wait_until(p, lambda p=p: read(p) == want, SYNC_S + SLACK_S, "standings in place")
        click(pb.get_by_role("table", name="Standings").get_by_role("link", name=a.team))
        wait_until(pb, lambda: urlparse(pb.url).path == f"/leagues/{lid}/members/{amid}", what="member history")
        soon(pb.get_by_role("table", name="Gameweek history"), "to_be_visible")
    assert standings(b, lid) == table and {s["manager_id"] for s in table} == {amid, bmid}
    assert b.get(f"/api/leagues/{lid}/members/{amid}/history").json()["rows"] == history(a)["rows"]
    assert a.get(f"/api/leagues/{lid}/members/{bmid}/history").json()["rows"] == history(b)["rows"]
    assert history_row(a, n)["status"] == "closed"


def test_wf_cross_cutting_fresh_start(app_url):
    fresh = os.environ["APP_FRESH_URL"]
    for base in (app_url, fresh):
        r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"} and r.headers["content-type"].startswith("application/json")
    op = operator(fresh)
    m = new_manager(fresh)
    seeds = seed_players()
    got = {p["id"]: p for p in catalogue(m)}
    assert set(got) == set(seeds)
    assert all(got[i]["price_tenths"] == s["price_tenths"] and got[i]["name"] == s["name"] for i, s in seeds.items())
    gws = op.get("/api/gameweeks").json()["gameweeks"]
    assert [g["number"] for g in gws] == list(range(1, LAST_GAMEWEEK + 1))
    states = [g["status"] for g in gws]
    cur = next(i for i, s in enumerate(states) if s != "closed")
    assert states[cur] in ("open", "locked", "live") and set(states[:cur]) <= {"closed"} and set(states[cur + 1:]) <= {"upcoming"}
    if cur == 0 and states[0] == "open" and not S3("-fresh").keys("snapshots/"):
        assert gws[0]["deadline"] is None
    assert "notices" in PocketBase().collections()
    assert len(PocketBase().records("users", f'email="{OPERATOR_EMAIL}"')) == 1
    assert all(k.startswith("snapshots/gw-") for k in S3("-fresh").keys())
    err(op.get(f"/api/operator/gameweeks/{LAST_GAMEWEEK + 1}/events"), 404, "not_found")


def test_wf_cross_cutting_boundary(app_url):
    base = app_url.rstrip("/")
    signin = {"email": f"nobody-{tag()}@sideline.test", "password": "not-the-password"}
    raw = json.dumps(signin)
    pad = lambda size: (raw[:-1] + ', "pad": "' + "a" * (size - len(raw) - 11) + '"}').encode()
    exact = pad(MAX_BODY_BYTES)
    assert len(exact) == MAX_BODY_BYTES
    h = {"Content-Type": "application/json"}
    err(httpx.post(base + "/api/auth/signin", content=exact, headers=h, timeout=HTTP_TIMEOUT_S), 401, "bad_credentials")
    err(httpx.post(base + "/api/auth/signin", content=exact + b" ", headers=h, timeout=HTTP_TIMEOUT_S), 413, "payload_too_large")
    err(httpx.post(base + "/api/squad", content=exact + b" ", headers={**h, "Origin": FOREIGN_ORIGIN, "Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT_S), 413, "payload_too_large")
    err(httpx.post(base + "/api/auth/signin", content=raw, headers={"Content-Type": "text/plain", "Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S), 415, "unsupported_media_type")
    err(httpx.post(base + "/api/auth/signin", content=raw, headers={"Content-Type": "application/json; charset=utf-8"}, timeout=HTTP_TIMEOUT_S), 401, "bad_credentials")
    foreign = httpx.post(base + "/api/squad", content="{}", headers={**h, "Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S)
    err(foreign, 403, "cross_origin")
    assert not any(k.lower().startswith("access-control-") for k in foreign.headers)
    m = new_manager(app_url)
    err(m.post("/api/leagues", {"name": f"Far {tag()}"}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    assert m.post("/api/leagues", {"name": f"Near {tag()}"}, headers={"Origin": base}).status_code == 201
    err(httpx.post(base + "/api/squad", content="{}", headers=h, timeout=HTTP_TIMEOUT_S), 401, "unauthenticated")
    err(m.get("/api/no-such-endpoint"), 404, "not_found")
    for path in ("/.env", "/package-lock.json", "/package.json", "/node_modules/", "/run.json", "/tsconfig.json", "/src/server/index.ts", "/server/index.ts"):
        r = httpx.get(base + path, timeout=HTTP_TIMEOUT_S)
        err(r, 404, "not_found")
    secrets = [os.environ[k] for k in ("POCKETBASE_ADMIN_PASSWORD", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID") if os.environ.get(k)]
    secrets += [p for p in [urlparse(os.environ.get("DATABASE_URL", "")).password] if p]
    index = httpx.get(base + "/signin", timeout=HTTP_TIMEOUT_S).text
    assets = [index] + [httpx.get(base + src if src.startswith("/") else f"{base}/{src}", timeout=HTTP_TIMEOUT_S).text
                        for src in re.findall(r'(?:src|href)="([^"]+\.(?:js|css|map))"', index) if not src.startswith("http")]
    for body in assets:
        for s in secrets:
            assert s not in body, "a credential is served to the browser"
    op = operator(app_url)
    ensure_open(op)
    err(op.post("/api/operator/price-runs", {"run_date": "2026-13-45", "moves": [{"player_id": "HAR-MID2", "delta_tenths": 1}]}), 422, "validation")
    bm = new_manager(app_url)
    bv = make_squad(bm)
    parallel_confirm(bm, bench(bv)[3], replacement(bm, bv, bench(bv)[3]))


APP_DIR = Path("/app")
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "SIL OFL 1.1"}


def licence_key(name: str) -> str:
    return re.sub(r"^SIL\s+", "", name.strip(), flags=re.I).replace(" ", "-").upper()
FONTS = ("Big Shoulders Display", "IBM Plex Sans", "IBM Plex Mono")


def shipped() -> list[tuple[str, str]]:
    deployed = Path(conftest.DEPLOYED_APP)
    where = deployed if (deployed / "node_modules").is_dir() else APP_DIR
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=where, capture_output=True, text=True, timeout=BOOT_S)
    found = {}

    def walk(node):
        for name, dep in (node.get("dependencies") or {}).items():
            if dep.get("version"):
                lic = dep.get("license")
                if lic is None and dep.get("path"):
                    with contextlib.suppress(OSError, ValueError):
                        lic = json.loads((Path(dep["path"]) / "package.json").read_text()).get("license")
                found[name] = lic.get("type") if isinstance(lic, dict) else lic
            walk(dep)

    walk(json.loads(out.stdout or "{}"))
    return sorted(found.items())


def test_if_run_manifest():
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name, _ in shipped() if name not in notices] + [f for f in FONTS if f not in notices]
    assert not missing, missing


def test_if_licences():
    def ok(expr):
        if not expr:
            return False
        expr = expr.strip("() ")
        if " OR " in expr:
            return any(ok(x) for x in expr.split(" OR "))
        if " AND " in expr:
            return all(ok(x) for x in expr.split(" AND "))
        return licence_key(expr) in {licence_key(a) for a in ALLOWED}
    bad = [(n, lic) for n, lic in shipped() if not ok(lic)]
    assert not bad, bad
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    assert re.search(r"\bOFL\b|Open Font Licen[cs]e", notices, re.I), "the fonts' licence is not named"


def test_if_no_extra_datastore():
    forbidden = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "level", "lowdb", "nedb", "lokijs", "bullmq", "amqplib", "kafkajs", "memcached"}
    assert not forbidden & {n for n, _ in shipped()}


def test_if_no_external_hosts(app_url, browser):
    m = new_manager(app_url)
    with ui(browser, app_url, m, "/signin") as page:
        seen = []
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/transfers", "/team", "/leagues", "/history", "/signin"):
            page.goto(app_url.rstrip("/") + path)
            advance(page, 1000)
        outside = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert not outside, outside


def test_if_lockfile():
    assert (APP_DIR / "package-lock.json").is_file()
    assert "npm ci" in json.loads((APP_DIR / "run.json").read_text())["install"]


PROVIDED_SERVICE_CONFIG: dict[str, str] = {}


def test_if_service_config_untouched():
    deployed = Path(conftest.DEPLOYED_APP)
    for rel, digest in PROVIDED_SERVICE_CONFIG.items():
        assert hashlib.sha256((deployed / rel).read_bytes()).hexdigest() == digest, rel
    path = Path("/logs/agent/trajectory.json")
    blob = path.read_text() if path.is_file() else ""
    written = [rel for rel in PROVIDED_SERVICE_CONFIG
               if re.search(r'"(Write|Edit|MultiEdit|str_replace|create|insert)"[^{}]*"(/app/)?' + re.escape(rel) + '"', blob)]
    assert not written, written


def test_if_no_email():
    mailers = {"nodemailer", "@sendgrid/mail", "emailjs", "mailgun.js", "mailgun-js", "postmark", "@aws-sdk/client-ses", "smtp-server", "resend", "@mailchimp/mailchimp_transactional"}
    assert not mailers & {n for n, _ in shipped()}


def test_if_typescript_only():
    skip = {"node_modules", "dist", "build", ".git", "coverage", ".next", "out"}
    bad = []
    for p in APP_DIR.rglob("*"):
        if any(part in skip for part in p.relative_to(APP_DIR).parts) or not p.is_file():
            continue
        source_tree = {"src", "server", "client"} & set(p.relative_to(APP_DIR).parts[:-1])
        if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and source_tree and not re.search(r"(\.config\.[cm]?js$|^\.[\w-]+rc\.[cm]?js$)", p.name):
            bad.append(str(p))
    assert not bad, bad
