from __future__ import annotations

import json
import os
import re
import socket
import struct
import threading
import time
import zlib
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (DEPLOYED_APP, Mailpit, Postgres, S3, Valkey, addresses, advance, held, layout,
                      licence_allowed, mail_from_address, open_app, same_origin, select, shipped_packages,
                      tap, unique)
from conftest import text as mail_text


GRADING_KEY = os.environ.get("GRADING_KEY") or "gk-overcall-7f3a91c2"
PASSWORD = "long-password-1"
PEN_GRACE_MS = 2000
SUPER_OVER_MAX = 2
INVITE_TTL_HOURS = 48
INVITE_RATE_PER_HOUR = 20
LOGO_MAX_BYTES = 1048576
JSON_LIMIT = 65536
CONFIG = {"live_delay_ms": 3000, "tick_ms": 260, "tick_stagger_ms": 80}
VIEWER_CODE_MIN = 22
HTTP_TIMEOUT = 30
UI_WAIT_S = 30
WS_WAIT_MS = 15000
MAIL_WAIT_S = 30
SKEWED_CLOCK = "2031-01-01T03:00:00+05:30"
SERVER_NOW = "2026-11-06T15:30:00+05:30"
SENT_AT_EXPIRED = "2026-11-04T15:30:00+05:30"
SENT_AT_OPEN = "2026-11-04T15:31:00+05:30"
LATER_NOW = "2026-11-06T17:30:00+05:30"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}

PEOPLE = {"olga": "Olga Fernandes", "mira": "Mira Joshi", "sam": "Sam Kapoor"}
TEAM_NAMES = {"kes": "Kestrels", "her": "Herons", "fal": "Falcons", "osp": "Ospreys"}
PREFIX = {"kes": "k", "her": "h", "fal": "f", "osp": "o"}
TEAM_OF = {"k": "kes", "h": "her", "f": "fal", "o": "osp"}
KESTRELS = [("Arjun Rao", "Rao"), ("Kabir Iyer", "Iyer"), ("Dev Sen", "Sen"), ("Neel Bose", "Bose"),
            ("Omar Khan", "Khan"), ("Ravi Das", "Das"), ("Yash Pandey", "Pandey"), ("Ishan Roy", "Roy"),
            ("Manav Lal", "Lal"), ("Tarun Gupta", "Gupta"), ("Hari Menon", "Menon")]
HERONS = [("Vik Mehta", "Mehta"), ("Sam Pillai", "Pillai"), ("Jai Nair", "Nair"), ("Tom Gill", "Gill"),
          ("Ash Kurian", "Kurian"), ("Leo Varma", "Varma"), ("Zubin Shah", "Shah"), ("Pranav Dutta", "Dutta"),
          ("Kiran Bhat", "Bhat"), ("Raj Malik", "Malik"), ("Anil Joseph", "Joseph")]
FULL = dict((short, full) for full, short in KESTRELS + HERONS)
PAD = ["0", "1", "2", "3", "4", "5", "6", "Wide", "No-ball", "Bye", "Leg bye", "Wicket", "Undo"]
HOW_OUT = ["Bowled", "Caught", "LBW", "Stumped", "Hit wicket", "Run out"]

E1 = ["0", "D0", "1", "N4", "B2", "L1", "6", "D1", "2"]
E1_ROWS = [
    (1, "0.1", "0.1 Mehta to Rao, no run", 0, 0, "none", 0, False, "0"),
    (2, "0.2", "0.2 Mehta to Rao, 1 wide", 1, 0, "wide", 1, False, "1wd"),
    (3, "0.2", "0.2 Mehta to Rao, 1 run", 1, 1, "none", 0, False, "1"),
    (4, "0.3", "0.3 Mehta to Iyer, no-ball, FOUR", 5, 4, "no-ball", 1, False, "5nb"),
    (5, "0.3", "0.3 Mehta to Iyer, 2 byes (free hit)", 2, 0, "bye", 2, True, "2b"),
    (6, "0.4", "0.4 Mehta to Iyer, 1 leg bye", 1, 0, "leg-bye", 1, False, "1lb"),
    (7, "0.5", "0.5 Mehta to Rao, SIX", 6, 6, "none", 0, False, "6"),
    (8, "0.6", "0.6 Mehta to Rao, 2 wides", 2, 0, "wide", 2, False, "2wd"),
    (9, "0.6", "0.6 Mehta to Iyer, 2 runs", 2, 2, "none", 0, False, "2"),
]
E1_OVER_END = "End of over 1: 20 runs. Kestrels 20/0"
E1_SCOREBOARD = "Kestrels 20/0 (1 ov)"
E1_BATTERS = ["Rao* 7 (3)", "Iyer 6 (4)"]
E1_BOWLER = "Mehta 1-0-17-0"
E1_EXTRAS = "Extras 7 (b 2, lb 1, w 3, nb 1)"
E1_RUN_RATE = "Run rate 20.00"
E1_BATTING = [("Arjun Rao", "not out", 7, 3, 0, 1, "233.33"), ("Kabir Iyer", "not out", 6, 4, 1, 0, "150.00")]
E1_BOWLING = ("Vik Mehta", "1", 0, 17, 0, 2, 1, "17.00")
E1_SEQ4_ANNOUNCE = "0.3 Mehta to Iyer, no-ball, FOUR. Kestrels 7/0."

E2 = ["1", "2", "B1", "D1", "3", "4", "1", "0", "L3"]
E2_STRIKERS = ["Rao", "Iyer", "Iyer", "Rao", "Iyer", "Rao", "Rao", "Rao", "Rao"]
E2_LINES = ["0.1 Mehta to Rao, 1 run", "0.2 Mehta to Iyer, 2 runs", "0.3 Mehta to Iyer, 1 bye", "0.4 Mehta to Rao, 2 wides",
            "0.4 Mehta to Iyer, 3 runs", "0.5 Mehta to Rao, FOUR", "0.6 Mehta to Rao, 1 run",
            "End of over 1: 14 runs. Kestrels 14/0", "1.1 Pillai to Rao, no run", "1.2 Pillai to Rao, 3 leg byes"]
E2_SCOREBOARD = "Kestrels 17/0 (1.2 ov)"
E2_BATTERS = ["Iyer* 5 (3)", "Rao 6 (5)"]

E3 = ["1", {"ball": "0", "out": "caught", "fielder": "h3", "new_batter": "k3"},
      {"ball": "0", "out": "lbw", "new_batter": "k4"}, "2",
      {"ball": "1", "out": "run-out", "fielder": "h4", "batter_out": "non-striker", "new_batter": "k5"},
      {"ball": "0", "out": "bowled", "new_batter": "k6"}, {"ball": "D0", "out": "stumped", "fielder": "h5"}]
E3_LINES = ["0.1 Mehta to Rao, 1 run", "0.2 Mehta to Iyer, OUT! c Nair b Mehta", "0.3 Mehta to Sen, OUT! lbw b Mehta",
            "0.4 Mehta to Bose, 2 runs", "0.5 Mehta to Bose, 1 run, OUT! run out (Gill)", "0.6 Mehta to Khan, OUT! b Mehta",
            "End of over 1: 4 runs. Kestrels 4/4", "1.1 Pillai to Bose, 1 wide, OUT! st Kurian b Pillai"]
E3_TOTAL = "Total 5 all out (1 ov)"
E3_EXTRAS = "Extras 1 (b 0, lb 0, w 1, nb 0)"
E3_FOW = "Fall of wickets: 1-1 (Iyer, 0.2), 2-1 (Sen, 0.3), 3-4 (Rao, 0.5), 4-4 (Khan, 0.6), 5-5 (Bose, 1.1)"
E3_BATTING = [("Arjun Rao", "run out (Gill)", 1, 1, 0, 0, "100.00"), ("Kabir Iyer", "c Nair b Mehta", 0, 1, 0, 0, "0.00"),
              ("Dev Sen", "lbw b Mehta", 0, 1, 0, 0, "0.00"), ("Neel Bose", "st Kurian b Pillai", 3, 2, 0, 0, "150.00"),
              ("Omar Khan", "b Mehta", 0, 1, 0, 0, "0.00"), ("Ravi Das", "not out", 0, 0, 0, 0, "-")]
E3_BOWLING = [("Vik Mehta", "1", 0, 4, 3, 0, 0, "4.00"), ("Sam Pillai", "0", 0, 1, 1, 1, 0, "-")]

E4 = ["0", "N1", "D0", "6", "0"]
E4_LINES = ["0.1 Mehta to Rao, no run", "0.2 Mehta to Rao, no-ball, 1 run", "0.2 Mehta to Iyer, 1 wide (free hit)",
            "0.2 Mehta to Iyer, SIX (free hit)", "0.3 Mehta to Iyer, no run"]
FREE_HIT_COPY = "Free hit: only a run out can dismiss a batter."

E5 = ["0"] * 6 + ["1"] * 18
E5_BOWLING = [("Vik Mehta", "2", 1, 6, 0, 0, 0, "3.00"), ("Sam Pillai", "2", 0, 12, 0, 0, 0, "6.00")]

E6_LINES = ["0.1 Mehta to Rao, 1 run", "0.2 Mehta to Iyer, 1 run", "0.3 Mehta to Rao, 1 bye", "0.4 Mehta to Iyer, 2 wides",
            "0.4 Mehta to Rao, 3 runs", "0.5 Mehta to Iyer, FOUR", "0.6 Mehta to Iyer, 1 run",
            "End of over 1: 13 runs. Kestrels 13/0", "1.1 Pillai to Iyer, no run", "1.2 Pillai to Iyer, 3 leg byes"]
E6_SCOREBOARD = "Kestrels 16/0 (1.2 ov)"
E6_BATTERS = ["Rao* 4 (3)", "Iyer 6 (5)"]

E8_KESTRELS = (["6", "6", "6", "4", "2", "2"] + ["2"] * 6 + ["0", "0", "1", "2", "2", "2"]
               + ["1", "1", "0", "0", "0", "0"] + ["1", "1", "2", "0", "0", "1"])
E8_HERONS_24 = ["4", "4", "1", "0", "0", "0", "6", "6", "4", "0", "0", "0", "2", "2", "2", "0"]
E8_HERONS_REST = ["4", "2", "D0", "4", {"ball": "0", "out": "bowled", "new_batter": "h3"}, "6", "4", "1"]
E8_BREAK = "Kestrels 52/0 (5 ov). Herons need 53 runs from 30 balls."
E8_AT_24 = ("Herons 31/0 (2.4 ov)", "Run rate 11.63", "Need 22 from 14 balls. Required rate 9.43")
E8_TAIL = [("2.5 Sen to Pillai, FOUR", "Need 18 from 13 balls. Required rate 8.31"),
           ("2.6 Sen to Pillai, 2 runs", "Need 16 from 12 balls. Required rate 8.00"),
           ("3.1 Bose to Mehta, 1 wide", "Need 15 from 12 balls. Required rate 7.50"),
           ("3.1 Bose to Mehta, FOUR", "Need 11 from 11 balls. Required rate 6.00"),
           ("3.2 Bose to Mehta, OUT! b Bose", "Need 11 from 10 balls. Required rate 6.60"),
           ("3.3 Bose to Nair, SIX", "Need 5 from 9 balls. Required rate 3.33"),
           ("3.4 Bose to Nair, FOUR", "Need 1 from 8 balls. Required rate 0.75"),
           ("3.5 Bose to Nair, 1 run", None)]
E8_RESULT = "Herons won by 4 wickets (7 balls left)"
E8_HISTORY = "Kestrels v Herons, 4 Nov 2026: Herons won by 4 wickets (7 balls left)"
PLAYED_ON = "2026-11-04"

E9_HERONS = ["4", "1", {"ball": "0", "out": "caught", "fielder": "k3", "new_batter": "h3"}, "D0", "6", "2",
             {"ball": "0", "out": "bowled"}]
E9_KESTRELS = ["6", "1", "4", "N0", "2", "1"]
E9_KESTRELS_LINES = ["0.1 Mehta to Rao, SIX", "0.2 Mehta to Rao, 1 run", "0.3 Mehta to Iyer, FOUR",
                     "0.4 Mehta to Iyer, no-ball, no run", "0.4 Mehta to Iyer, 2 runs (free hit)",
                     "0.5 Mehta to Iyer, 1 run"]
SO_LEVEL_REPLY = ["6", "1", "4", "2", "1", "0"]

E10_GROUP = [
    ("kes", "her", "kes", (160, 4, 120, False), (150, 7, 120, False), "kes"),
    ("osp", "fal", "fal", (140, 10, 111, True), (141, 3, 105, False), "osp"),
    ("her", "fal", "her", (180, 5, 120, False), (120, 10, 96, True), "her"),
    ("kes", "osp", "osp", (155, 6, 120, False), (156, 2, 117, False), "kes"),
]
E10_TABLE = [("Kestrels", 2, 2, 0, 0, 4, "+0.375"), ("Herons", 2, 1, 1, 0, 2, "+1.250"),
             ("Ospreys", 2, 1, 1, 0, 2, "+0.400"), ("Falcons", 2, 0, 2, 0, 0, "-2.060")]
E10_TABLE_AFTER = [("Kestrels", 2, 2, 0, 0, 4, "+0.375"), ("Ospreys", 3, 2, 1, 0, 4, "+0.353"),
                   ("Herons", 3, 1, 2, 0, 2, "+0.747"), ("Falcons", 2, 0, 2, 0, 0, "-2.060")]
E10_LIVE_RESULT = "Ospreys won by 5 wickets (1 ball left)"


def new_email(prefix: str) -> str:
    first, second = unique(prefix)
    for value in (second, first):
        if "@" in value:
            return value.lower()
    return f"{first}-{second}@example.test".replace(" ", "").lower()


def grading(base: str, path: str, body: Any, key: str | None = GRADING_KEY) -> httpx.Response:
    headers = {"X-Grading-Key": key} if key else {}
    return httpx.post(base + path, json=body, headers=headers, timeout=HTTP_TIMEOUT)


def roster(team: str) -> list[tuple[str, str]]:
    if team == "kes":
        return KESTRELS
    if team == "her":
        return HERONS
    word = TEAM_NAMES[team][:-1]
    return [(f"{word} Batter{i}", f"Batter{i}") for i in range(1, len(KESTRELS) + 1)]


def team_spec(team: str, organiser: str = "olga") -> dict:
    return {"key": team, "organiser": organiser, "name": TEAM_NAMES[team],
            "players": [{"key": f"{PREFIX[team]}{i}", "name": n, "short_name": s} for i, (n, s) in enumerate(roster(team), 1)]}


def inn(striker: str, non_striker: str, bowlers, deliveries=(), retirements=()) -> dict:
    return {"striker": striker, "non_striker": non_striker, "bowlers": list(bowlers), "deliveries": list(deliveries),
            "retirements": list(retirements)}


def kinn(deliveries=(), bowlers=("h1",), retirements=()) -> dict:
    return inn("k1", "k2", bowlers, deliveries, retirements)


def summary(first, second, winner) -> dict:
    side = lambda s: {"runs": s[0], "wickets": s[1], "balls": s[2], "all_out": s[3]}
    return {"first": side(first), "second": side(second), "winner": winner}


def match_spec(key="m1", innings=(), *, home="kes", away="her", overs=5, pps=6, super_over=False, first="kes",
               tournament=None, scorers=(), summ=None, played_on=None, viewer_link=True) -> dict:
    spec = {"key": key, "organiser": "olga", "home": home, "away": away, "overs": overs, "players_per_side": pps,
            "super_over": super_over, "batting_first": first, "tournament": tournament,
            "xi": {t: [f"{PREFIX[t]}{i}" for i in range(1, pps + 1)] for t in (home, away)},
            "scorers": list(scorers), "viewer_link": viewer_link, "innings": list(innings), "summary": summ}
    if played_on:
        spec["played_on"] = played_on
    return spec


def tournament_spec(key, groups, *, overs=20, pps=11, super_over=False) -> dict:
    return {"key": key, "organiser": "olga", "name": "Autumn Cup", "overs": overs, "players_per_side": pps,
            "super_over": super_over, "groups": [{"name": name, "teams": list(teams)} for name, teams in groups]}


class W:

    def __init__(self, base: str, result: dict, emails: dict):
        self.base, self.result, self.emails = base, result, emails

    def mid(self, key="m1"):
        return self.result["matches"][key]["id"]

    def code(self, key="m1"):
        return self.result["matches"][key]["viewer_code"]

    def session(self, who="olga"):
        return self.result["users"][who]["session"]

    def uid(self, who="olga"):
        return self.result["users"][who]["id"]

    def tid(self, team="kes"):
        return self.result["teams"][team]["id"]

    def pid(self, key):
        return self.result["teams"][TEAM_OF[key[0]]]["players"][key]

    def tour(self, key="t1"):
        return self.result["tournaments"][key]["id"]

    def token(self, key="i1"):
        return self.result["invitations"][key]["token"]

    def state(self, key="m1", who="olga"):
        return get_json(self.base, f"/api/matches/{self.mid(key)}/state", self.session(who))

    def card(self, key="m1", who="olga"):
        return get_json(self.base, f"/api/matches/{self.mid(key)}/scorecard", self.session(who))


def build(base, matches=(), *, teams=("kes", "her"), tournaments=(), invitations=(), users=("olga", "mira", "sam")) -> W:
    emails = {who: new_email(who) for who in users}
    body = {"users": [{"key": who, "email": emails[who], "display_name": PEOPLE[who], "password": PASSWORD} for who in users],
            "teams": [team_spec(t) for t in teams], "tournaments": list(tournaments), "matches": list(matches),
            "invitations": list(invitations)}
    r = grading(base, "/api/grading/seed", body)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code}: {r.text[:500]}"
    return W(base, r.json(), emails)


def http(base: str, session: str | None = None, **headers: str) -> httpx.Client:
    if session:
        headers["Cookie"] = f"oc_session={session}"
    return httpx.Client(base_url=base, headers=headers, timeout=HTTP_TIMEOUT)


def get_json_status(base: str, path: str, session: str | None = None) -> int:
    with http(base, session) as client:
        return client.get(path).status_code


def get_json(base: str, path: str, session: str | None = None) -> Any:
    with http(base, session) as client:
        r = client.get(path)
    assert r.status_code == 200, f"GET {path} answered {r.status_code}: {r.text[:300]}"
    return r.json()


def error_of(r: httpx.Response) -> tuple[Any, Any]:
    try:
        err = r.json()["error"]
        return err.get("code"), err.get("message")
    except (ValueError, KeyError, TypeError, AttributeError):
        return None, None


def refused(r: httpx.Response, status: int, code: str, message: str | None = None, what: str = "") -> None:
    assert r.status_code == status, f"{what}: expected {status} {code}, got {r.status_code} {r.text[:300]}"
    got_code, got_message = error_of(r)
    assert got_code == code, f"{what}: expected error code {code}, got {r.text[:300]}"
    if message is not None:
        assert got_message == message, f"{what}: expected message {message!r}, got {got_message!r}"


def delivery_body(token: str) -> dict:
    extras = {"D": "wide", "N": "no-ball", "B": "bye", "L": "leg-bye"}
    if token[0] in extras:
        return {"extra": extras[token[0]], "runs": int(token[1:])}
    return {"extra": "none", "runs": int(token)}


def chrono(state: dict) -> list[str]:
    return [i["line"] for i in reversed(state["commentary"]) if i["kind"] in ("delivery", "over-end")]


def balls(state: dict) -> list[dict]:
    return sorted((i for i in state["commentary"] if i["kind"] == "delivery"), key=lambda i: i["seq"])


def batter_texts(state: dict) -> list[str]:
    return sorted(b["text"] for b in state["batters"])


def striker_of(state: dict):
    return next(b["player"] for b in state["batters"] if b["on_strike"])


def row(r: dict, keys) -> tuple:
    return tuple(str(r[k]) for k in keys)


BAT_KEYS = ("name", "dismissal", "runs", "balls", "fours", "sixes", "strike_rate")
BOWL_KEYS = ("name", "overs", "maidens", "runs", "wickets", "wides", "no_balls", "economy")


def strs(values) -> tuple:
    return tuple(str(v) for v in values)


class Scoring:

    def __init__(self, base: str, session: str, match: str, pen: str):
        self.base, self.session, self.match, self.pen = base, session, match, pen
        self.http = http(base, session, **{"X-Pen": pen})

    def state(self) -> dict:
        r = self.http.get(f"/api/matches/{self.match}/state")
        assert r.status_code == 200, r.text[:300]
        return r.json()

    def post_delivery(self, body: dict) -> httpx.Response:
        return self.http.post(f"/api/matches/{self.match}/deliveries", json=body)

    def deliver(self, token: str, wicket: dict | None = None, expected: int | None = None) -> httpx.Response:
        body = {**delivery_body(token), "wicket": wicket}
        body["expected_seq"] = expected if expected is not None else self.state()["last_seq"] + 1
        r = self.post_delivery(body)
        if expected is None and r.status_code == 409 and error_of(r)[0] == "STALE_DELIVERY":
            body["expected_seq"] = r.json()["error"]["seq"] + 1
            r = self.post_delivery(body)
        return r

    def ok(self, token: str, wicket: dict | None = None) -> dict:
        r = self.deliver(token, wicket)
        assert r.status_code == 201, f"delivery {token} {wicket} answered {r.status_code}: {r.text[:300]}"
        return r.json()

    def over(self, bowler) -> httpx.Response:
        return self.http.post(f"/api/matches/{self.match}/overs", json={"bowler": bowler})

    def start(self, striker, non_striker, bowler) -> httpx.Response:
        return self.http.post(f"/api/matches/{self.match}/innings",
                              json={"striker": striker, "non_striker": non_striker, "bowler": bowler})

    def change(self, seq: int, token: str) -> httpx.Response:
        return self.http.put(f"/api/matches/{self.match}/deliveries/{seq}", json=delivery_body(token))

    def undo(self) -> httpx.Response:
        return self.http.delete(f"/api/matches/{self.match}/deliveries/last")

    def retire(self, batter, new_batter) -> httpx.Response:
        return self.http.post(f"/api/matches/{self.match}/retirements", json={"batter": batter, "new_batter": new_batter})


def wicket(w: W, kind: str, *, fielder: str | None = None, out: str = "striker", new: str | None = None) -> dict:
    return {"kind": kind, "fielder": w.pid(fielder) if fielder else None, "batter_out": out,
            "new_batter": w.pid(new) if new else None}


SOCKET_OPEN = r"""() => new Promise((resolve, reject) => {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  window.__ws = ws; window.__msgs = []; window.__closed = false;
  ws.onmessage = (event) => { try { window.__msgs.push(JSON.parse(event.data)); } catch (error) { window.__msgs.push({type: 'unparsed'}); } };
  ws.onclose = () => { window.__closed = true; };
  ws.onopen = () => resolve(true);
  ws.onerror = () => reject(new Error('the /ws connection failed'));
  setTimeout(() => reject(new Error('the /ws connection did not open')), 15000);
})"""


class Sock:
    def __init__(self, page: Page):
        self.page = page

    def send(self, message: dict) -> None:
        self.page.evaluate("(m) => window.__ws.send(JSON.stringify(m))", message)

    def count(self) -> int:
        return self.page.evaluate("() => window.__msgs.length")

    def all(self) -> list:
        return self.page.evaluate("() => window.__msgs")

    def wait(self, predicate: str, what: str, start: int = 0, timeout_ms: float = WS_WAIT_MS) -> Any:
        try:
            handle = self.page.wait_for_function(f"(n) => window.__msgs.slice(n).find({predicate}) || null",
                                                 arg=start, timeout=timeout_ms)
        except PlaywrightError as error:
            pytest.fail(f"{what} (live connection): {error}")
        return handle.json_value()

    def closed(self) -> bool:
        return self.page.evaluate("() => window.__closed")

    def drop(self) -> None:
        self.page.evaluate("() => window.__ws.close()")


@contextmanager
def live(browser: Browser, base: str, session: str | None = None, message: dict | None = None) -> Iterator[Sock]:
    context = browser.new_context()
    try:
        page = context.new_page()
        page.goto(base + "/api/health")
        if session:
            context.add_cookies([{"name": "oc_session", "value": session, "url": base}])
        page.evaluate(SOCKET_OPEN)
        sock = Sock(page)
        if message:
            sock.send(message)
        yield sock
    finally:
        context.close()


@contextmanager
def scoring(browser: Browser, w: W, key: str = "m1", who: str = "olga") -> Iterator[Scoring]:
    with live(browser, w.base, w.session(who), {"type": "score", "match": w.mid(key)}) as sock:
        message = sock.wait("(m) => m.type === 'pen'", "a score request is answered with a pen message")
        assert message.get("pen"), f"the free pen of {key} was not granted: {message}"
        yield Scoring(w.base, w.session(who), w.mid(key), message["pen"])


@contextmanager
def entered(made: Any) -> Iterator[Any]:
    if hasattr(made, "__enter__"):
        with made as value:
            yield value
    else:
        value = next(made)
        try:
            yield value
        finally:
            made.close()


@contextmanager
def ui(browser: Browser, base: str, path: str, session: str | None = None, *, motion: str = "no-preference",
       size: tuple[int, int] | None = None, clock: str | None = None, init=()) -> Iterator[Page]:
    with entered(open_app(browser, base + "/api/health", reduced_motion=motion)) as page:
        if session:
            page.context.add_cookies([{"name": "oc_session", "value": session, "url": base}])
        if size:
            page.set_viewport_size({"width": size[0], "height": size[1]})
        if clock:
            page.clock.set_system_time(clock)
        for script in init:
            page.add_init_script(script)
        page.goto(base + path)
        yield page


def goto_settled(page: Page, url: str) -> None:
    last: Any = None
    for _ in range(5):
        try:
            page.wait_for_load_state()
            page.goto(url)
            return
        except PlaywrightError as error:
            last = error
    pytest.fail(f"could not open {url} after the app's own navigation: {last}")


def poll(page: Page, check, what: str, seconds: float = UI_WAIT_S, step_ms: float = 100) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        advance(page, step_ms)
    pytest.fail(what)


def poll_real(page: Page, check, what: str, seconds: float = UI_WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
    pytest.fail(what)


JS_TEXT = r"""(s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }"""
JS_ATTR = r"""([s, n]) => { const e = document.querySelector(s); return e ? e.getAttribute(n) : null; }"""
JS_ITEMS = r"""() => { const list = document.querySelector('#commentary'); if (!list) return [];
  return Array.from(list.children).map((e) => { const line = e.querySelector('.line'); const a = (n) => e.getAttribute(n);
    return {kind: a('data-kind'), seq: a('data-seq'), over: a('data-over'), ball: a('data-ball'), label: a('data-label'),
      runs: a('data-runs'), bat: a('data-bat-runs'), extra: a('data-extra'), extraRuns: a('data-extra-runs'),
      wicket: a('data-wicket'), freeHit: a('data-free-hit'), striker: a('data-striker'), bowler: a('data-bowler'),
      line: line ? line.textContent.replace(/\s+/g, ' ').trim() : null}; }); }"""
JS_BATTERS = r"""() => Array.from(document.querySelectorAll('#batters [data-player]')).map((e) => ({player: e.getAttribute('data-player'), strike: e.getAttribute('data-on-strike'), text: e.textContent.replace(/\s+/g, ' ').trim()}))"""
JS_CHIPS = r"""() => { const l = document.querySelector('#this-over'); return l ? Array.from(l.children).map((e) => e.textContent.replace(/\s+/g, ' ').trim()) : []; }"""
JS_DIGITS = r"""() => { const b = document.querySelector('#scoreboard'); return b ? Array.from(b.querySelectorAll('.digit')).map((d) => d.textContent.trim()) : []; }"""
JS_TABLE = r"""(t) => { const rows = Array.from(t.rows).map((r) => Array.from(r.cells).map((c) => ({th: c.tagName === 'TH', text: c.textContent.replace(/\s+/g, ' ').trim()})));
  const head = rows.find((r) => r.length && r.every((c) => c.th)) || [];
  return {head: head.map((c) => c.text), body: rows.filter((r) => r.length && !r.every((c) => c.th)).map((r) => r.map((c) => c.text))}; }"""
JS_IN_DIALOG = "(d) => d.contains(document.activeElement)"
JS_FOCUSED = "(e) => e === document.activeElement || e.contains(document.activeElement)"

WS_HOOK = r"""(() => {
  window.__live = []; window.__runs = []; window.__notices = [];
  const Native = window.WebSocket;
  window.WebSocket = class extends Native { constructor(...args) { super(...args);
    this.addEventListener('message', (event) => { try { window.__live.push(JSON.parse(event.data)); } catch (error) { window.__live.push({}); } }); } };
  new MutationObserver(() => {
    const b = document.querySelector('#scoreboard'); const r = b ? b.getAttribute('data-runs') : null;
    if (r !== null && window.__runs[window.__runs.length - 1] !== r) window.__runs.push(r);
    const n = document.querySelector('#notice'); const t = n ? n.textContent.trim() : '';
    if (t && window.__notices[window.__notices.length - 1] !== t) window.__notices.push(t);
  }).observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
})();"""

TICK_HOOK = r"""(() => {
  window.__ticks = [];
  const record = (animation, target, options) => {
    if (window.__ticks.some((t) => t.animation === animation)) return;
    const board = document.querySelector('#scoreboard');
    const digits = board ? Array.from(board.querySelectorAll('.digit')) : [];
    window.__ticks.push({animation, target, index: digits.indexOf(target), optionId: options && typeof options === 'object' ? (options.id || '') : ''});
    try { animation.pause(); } catch (error) {}
  };
  const nativeAnimate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) { const a = nativeAnimate.call(this, keyframes, options); record(a, this, options); return a; };
  const nativePlay = Animation.prototype.play;
  Animation.prototype.play = function () { const r = nativePlay.call(this); if (this.effect && this.effect.target) record(this, this.effect.target, null); return r; };
})();"""
READ_TICKS = r"""() => window.__ticks.map((t) => { const timing = t.animation.effect ? t.animation.effect.getTiming() : {};
  return {id: t.animation.id || t.optionId, index: t.index, delay: Number(timing.delay || 0), duration: Number(timing.duration), ticking: t.target.getAttribute('data-ticking')}; })"""
FLUSH_TICKS = "() => { window.__ticks.forEach((t) => { try { t.animation.finish(); } catch (e) {} }); window.__ticks = []; }"


def dom(page: Page, selector: str):
    return page.evaluate(JS_TEXT, selector)


def attr(page: Page, selector: str, name: str):
    return page.evaluate(JS_ATTR, [selector, name])


def items(page: Page) -> list[dict]:
    return page.evaluate(JS_ITEMS)


def batters(page: Page) -> list[dict]:
    return page.evaluate(JS_BATTERS)


def chips(page: Page) -> list[str]:
    return page.evaluate(JS_CHIPS)


def pad(page: Page) -> Locator:
    return page.get_by_role("group", name="Scoring pad")


def key(page: Page, name: str) -> Locator:
    return pad(page).get_by_role("button", name=name, exact=True)


def dialog(page: Page, name: str) -> Locator:
    return page.get_by_role("dialog", name=name)


def visible(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def enabled(loc: Locator) -> bool:
    return loc.count() == 1 and loc.is_enabled()


def focused(loc: Locator) -> bool:
    return loc.count() == 1 and loc.evaluate(JS_FOCUSED)


def blur(page: Page) -> None:
    page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")


def top_seq(page: Page) -> int:
    return max([int(i["seq"]) for i in items(page) if i["kind"] == "delivery" and i["seq"]] or [0])


def press_ball(page: Page, keys, what: str | None = None) -> None:
    before = top_seq(page)
    for k in keys:
        page.keyboard.press(k)
    poll(page, lambda: top_seq(page) > before, what or f"keys {keys} recorded a new delivery item in #commentary")


def holds_pen(page: Page) -> None:
    poll(page, lambda: enabled(key(page, "Undo")) and dom(page, "#pen-notice") == "",
         "the scoring page holds the pen: Undo enabled and #pen-notice empty (L135, L213)")


def choose(loc: Locator, *labels: str) -> None:
    last: Any = None
    for label in labels:
        try:
            select(loc, label)
            return
        except (Exception, pytest.fail.Exception) as error:
            last = error
    pytest.fail(f"could not choose any of {labels}: {last}")


def pick(loc: Locator, short: str) -> None:
    choose(loc, short, FULL.get(short, short))


def option(dlg: Locator, box: Locator, name: str) -> Locator:
    opt = dlg.get_by_role("option", name=name, exact=True, include_hidden=True)
    if opt.count() == 0:
        box.click()
        opt = dlg.page.get_by_role("option", name=name, exact=True, include_hidden=True)
    return opt.first


def table(page: Page, name: str) -> dict:
    loc = page.get_by_role("table", name=name)
    poll(page, lambda: loc.count() >= 1, f"a table captioned {name!r} is shown")
    return loc.first.evaluate(JS_TABLE)


@contextmanager
def open_scoring(browser, w: W, key_: str = "m1", who: str = "olga", **kw) -> Iterator[Page]:
    with ui(browser, w.base, f"/matches/{w.mid(key_)}/score", w.session(who), **kw) as page:
        holds_pen(page)
        yield page


def viewer(browser, w: W, key_: str = "m1", **kw):
    return ui(browser, w.base, f"/live/{w.code(key_)}", **kw)


def boxes_overlap(a: dict, b: dict) -> bool:
    return a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]


def png_bytes(size: int | None = None) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
    tail = chunk(b"IEND", b"")
    if size is None:
        return head + tail
    filler = size - len(head) - len(tail) - 12 - 8
    return head + chunk(b"tEXt", b"Comment\x00" + b"a" * filler) + tail


def jpeg_bytes() -> bytes:
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 64 + b"\xff\xd9"


def outage(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} names the outage instance"
    return url.rstrip("/")


def mails_for(mail: Mailpit, emails, seconds: float = MAIL_WAIT_S) -> dict:
    wanted = {e.lower() for e in emails}
    found: dict = {}
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        for m in mail.messages():
            for a in addresses(m.get("To")):
                if a.lower() in wanted:
                    found[a.lower()] = m
        if set(found) == wanted:
            return found
    pytest.fail(f"Mailpit received no invitation for {sorted(wanted - set(found))}")


def invite_link(message: dict) -> str:
    found = re.search(r"https?://[^\s\"'<>]+(/invitations/[A-Za-z0-9_\-]+)", mail_text(message))
    assert found, f"the invitation mail holds a link <APP_BASE_URL>/invitations/<token>: {mail_text(message)[:300]}"
    return found.group(1)


def stored_rows(pg: Postgres, needle: str) -> int:
    total = 0
    for name in pg.tables():
        quoted = ".".join(f'"{part}"' for part in name.split("."))
        total += int(pg.rows(f"SELECT count(*) AS n FROM {quoted} t WHERE t::text LIKE '%{needle}%'")[0]["n"])
    return total


def set_clock(base: str, now: str | None) -> dict:
    r = grading(base, "/api/grading/clock", {"now": now})
    assert r.status_code == 200, f"POST /api/grading/clock answered {r.status_code}: {r.text[:200]}"
    return r.json()


def e8(herons, bowlers=("k1", "k2", "k3", "k4")) -> list:
    return [inn("k1", "k2", ["h1", "h2", "h3", "h4", "h5"], E8_KESTRELS), inn("h1", "h2", bowlers, herons)]


def tied_main() -> list:
    return [kinn(["1"] * 6), inn("h1", "h2", ["k2"], ["1"] * 6)]


def test_wf_keyboard_over_extras_happy(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn([])])])
    with open_scoring(browser, w) as page:
        blur(page)
        press_ball(page, ["0"])
        wide = key(page, "Wide")
        page.keyboard.press("d")
        poll(page, lambda: wide.get_attribute("aria-pressed") == "true" and "armed" in wide.inner_text(), "D arms Wide (L198)")
        page.keyboard.press("Escape")
        poll(page, lambda: wide.get_attribute("aria-pressed") != "true", "Escape disarms the extra (L196)")
        press_ball(page, ["D", "0"])
        key(page, "Wicket").focus()
        press_ball(page, ["1"])
        press_ball(page, ["n", "4"])
        poll(page, lambda: dom(page, "#free-hit") == "FREE HIT", "FREE HIT shows after the no-ball (L128)")
        key(page, "Undo").focus()
        press_ball(page, ["B", "2"])
        poll(page, lambda: dom(page, "#free-hit") is None, "the free hit is used up by the legal bye")
        for keys in (["l", "1"], ["6"], ["d", "1"], ["2"]):
            press_ball(page, keys)
        poll(page, lambda: (items(page) or [{}])[0].get("line") == E1_OVER_END, "the over-end item tops #commentary")
        assert sorted(b["text"] for b in batters(page)) == sorted(E1_BATTERS)
        assert chips(page) == [r[8] for r in E1_ROWS]
        box = dialog(page, "Next bowler").get_by_role("combobox", name="Bowler")
        poll(page, lambda: focused(box), "the Next bowler dialog opens with focus on Bowler (L16)")
    st = w.state()
    assert [i["line"] for i in balls(st)] == [r[2] for r in E1_ROWS]
    assert (st["runs"], st["legal_balls"], st["next_bowler_needed"]) == (20, 6, True)


def test_wf_keyboard_over_extras_byes_zero(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn([])])])
    with open_scoring(browser, w) as page:
        blur(page)
        for extra in ("b", "l"):
            page.keyboard.press(extra)
            page.keyboard.press("0")
            poll(page, lambda: dom(page, "#alert") == "Byes need at least 1 run.", "B 0 shows the byes copy (L200, L286)")
        assert w.state()["last_seq"] == 0, "B 0 / L 0 sent nothing"
        page.keyboard.press("l")
        page.keyboard.press("b")
        poll(page, lambda: key(page, "Bye").get_attribute("aria-pressed") == "true"
             and key(page, "Leg bye").get_attribute("aria-pressed") != "true", "arming Bye replaces Leg bye (L198)")
        page.keyboard.press("b")
        poll(page, lambda: key(page, "Bye").get_attribute("aria-pressed") != "true", "pressing the armed key again disarms it")
        page.keyboard.press("r")
        retire = dialog(page, "Retire batter")
        first = retire.get_by_role("radiogroup", name="Batter").get_by_role("radio").first
        poll(page, lambda: visible(retire) and focused(first), "R opens Retire batter with focus on its first radio (L207)")
        page.keyboard.press("Escape")
        poll(page, lambda: not visible(retire), "Escape closes Retire batter")
        page.keyboard.press("W")
        poll(page, lambda: visible(dialog(page, "Wicket")), "W opens the Wicket dialog")
        page.keyboard.press("Escape")
        poll(page, lambda: not visible(dialog(page, "Wicket")), "Escape closes the Wicket dialog")
        blur(page)
        with entered(held(page, "**/api/matches/*/deliveries")) as gate:
            page.keyboard.press("2")
            poll(page, lambda: pad(page).get_attribute("aria-busy") == "true", "the pad is aria-busy while saving (L252)")
            page.keyboard.press("3")
            assert attr(page, "#scoreboard", "data-runs") == "0", "nothing changes before the server answers (L199)"
            gate.release()
            poll(page, lambda: top_seq(page) == 2, "the queued key is sent once the first delivery saves (L199)")
        page.keyboard.press("U")
        poll(page, lambda: top_seq(page) == 1, "U undoes the last delivery")
    st = w.state()
    assert [(b["seq"], b["bat_runs"]) for b in balls(st)] == [(1, 2)]


def test_delivery_accounting(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn([])])])
    with scoring(browser, w) as s:
        legal = 0
        for token, expected in zip(E1, E1_ROWS):
            st = s.ok(token)
            legal += 0 if token[0] in "DN" else 1
            assert st["legal_balls"] == legal, f"only legal deliveries count toward the over (L471) after {token}"
            item = next(i for i in st["commentary"] if i["kind"] == "delivery")
            assert (item["seq"], item["label"], item["line"], item["runs"], item["bat_runs"], item["extra"],
                    item["extra_runs"], item["free_hit"]) == expected[:8]
        assert (st["scoreboard"], batter_texts(st), st["bowler"]["text"], st["run_rate"]) == (
            E1_SCOREBOARD, sorted(E1_BATTERS), E1_BOWLER, E1_RUN_RATE)
        card = w.card()["innings"][0]
        assert card["extras"]["text"] == E1_EXTRAS
        assert [row(r, BAT_KEYS) for r in card["batting"][:2]] == [strs(r) for r in E1_BATTING]
        assert row(card["bowling"][0], BOWL_KEYS) == strs(E1_BOWLING)
        assert s.over(w.pid("h2")).status_code == 201
        body = {**delivery_body("1"), "wicket": None, "expected_seq": 10}
        barrier, answers = threading.Barrier(2), []

        def send() -> None:
            with http(app_url, w.session(), **{"X-Pen": s.pen}) as c:
                barrier.wait()
                answers.append(c.post(f"/api/matches/{w.mid()}/deliveries", json=body))
        threads = [threading.Thread(target=send) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(HTTP_TIMEOUT)
        assert sorted(a.status_code for a in answers) == [201, 409], [a.text for a in answers]
        loser = next(a for a in answers if a.status_code == 409)
        refused(loser, 409, "STALE_DELIVERY", what="simultaneous duplicate (L407)")
        assert loser.json()["error"]["seq"] == 10
        refused(s.post_delivery(body), 409, "STALE_DELIVERY", what="replayed delivery")
        assert s.state()["last_seq"] == 10


def test_commentary_items(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1)])])
    with ui(browser, app_url, f"/matches/{w.mid()}/score", w.session()) as page:
        poll(page, lambda: len(items(page)) == 10, "nine delivery items and one over-end item")
        got = items(page)
        assert (got[0]["kind"], got[0]["line"], got[0]["over"]) == ("over-end", E1_OVER_END, "1")
        for item, (seq, label, line, runs, bat, extra, extra_runs, free_hit, _) in zip(got[1:], reversed(E1_ROWS)):
            striker = line.split(" to ")[1].split(",")[0]
            assert (item["kind"], item["seq"], item["over"], item["ball"], item["label"], item["line"], item["runs"],
                    item["bat"], item["extra"], item["extraRuns"], item["wicket"], item["freeHit"], item["striker"],
                    item["bowler"]) == ("delivery", str(seq), "1", label[-1], label, line, str(runs), str(bat), extra,
                                        str(extra_runs), "none", str(free_hit).lower(),
                                        str(w.pid("k1" if striker == "Rao" else "k2")), str(w.pid("h1")))
        assert chips(page) == [r[8] for r in E1_ROWS]
        assert page.get_by_role("button", name="Change delivery 9").count() == 1


def test_ball_announcements(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0", "D0", "1"])])])
    over_end = f"0.6 Mehta to Iyer, 2 runs. Kestrels 20/0. End of over 1: 20 runs."
    with viewer(browser, w) as watch, open_scoring(browser, w) as page:
        poll(watch, lambda: attr(watch, "#scoreboard", "data-runs") == "2", "viewer loads the current state")
        blur(page)
        press_ball(page, ["n", "4"])
        poll(page, lambda: dom(page, "#announcer") == E1_SEQ4_ANNOUNCE, "the scorer hears the seq 4 announcement")
        poll(watch, lambda: dom(watch, "#announcer") == E1_SEQ4_ANNOUNCE, "the viewer hears it after the delay")
        for keys in (["b", "2"], ["l", "1"], ["6"], ["d", "1"], ["2"]):
            press_ball(page, keys)
        poll(page, lambda: dom(page, "#announcer") == over_end, "the over-ending announcement")
        poll(watch, lambda: dom(watch, "#announcer") == over_end, "the viewer's over-ending announcement")


def test_scoreboard_lines(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1)]), match_spec("m2")])
    with open_scoring(browser, w, clock=SKEWED_CLOCK) as page:
        poll(page, lambda: dom(page, "#scoreboard") == E1_SCOREBOARD, "#scoreboard reads E1's score")
        assert [attr(page, "#scoreboard", a) for a in ("data-runs", "data-wickets", "data-legal-balls", "data-innings")] == ["20", "0", "6", "1"]
        assert page.evaluate(JS_DIGITS) == ["2", "0", "0", "1"]
        got = {b["text"]: b["strike"] for b in batters(page)}
        assert got == {"Rao* 7 (3)": "true", "Iyer 6 (4)": "false"}
        assert (dom(page, "#bowler"), dom(page, "#run-rate")) == (E1_BOWLER, E1_RUN_RATE)
        poll(page, lambda: visible(dialog(page, "Next bowler")), "the server's next_bowler_needed opens Next bowler despite the page clock")
    with viewer(browser, w, "m2") as watch:
        poll(watch, lambda: dom(watch, "#scoreboard") == "Kestrels 0/0 (0 ov)", "before the first innings the side batting first shows 0/0 (L123)")
        assert dom(watch, "#run-rate") == "Run rate -"


def test_strike_rotation(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))])])
    st = w.state()
    ids = {"Rao": w.pid("k1"), "Iyer": w.pid("k2")}
    assert [b["striker"] for b in balls(st)] == [ids[n] for n in E2_STRIKERS]
    assert batter_texts(st) == sorted(E2_BATTERS) and striker_of(st) == ids["Iyer"]
    with viewer(browser, w) as watch:
        poll(watch, lambda: {b["text"]: b["strike"] for b in batters(watch)} == {"Iyer* 5 (3)": "true", "Rao 6 (5)": "false"},
             "the viewer marks the striker with * and data-on-strike")
        with scoring(browser, w) as s:
            assert s.undo().status_code == 200
            assert striker_of(s.state()) == ids["Rao"], "undoing 3 leg byes puts Rao back on strike"
        poll(watch, lambda: any(b["strike"] == "true" and b["player"] == str(ids["Rao"]) and b["text"].startswith("Rao*")
                                for b in batters(watch)), "the viewer shows the recomputed striker")


def test_wf_strike_phone_pad_touch(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1", "1", "1", "1"])])])
    with open_scoring(browser, w, size=(390, 844)) as page:
        tap(key(page, "2"))
        poll(page, lambda: top_seq(page) == 5, "a tapped 2 records a delivery")
        st = w.state()
        line = next(i["line"] for i in st["commentary"] if i["kind"] == "delivery")
        poll(page, lambda: dom(page, "#announcer") == f"{line}. Kestrels {st['runs']}/{st['wickets']}.", "the tap is announced (L274)")
        tap(key(page, "Wicket"))
        dlg = dialog(page, "Wicket")
        poll(page, lambda: visible(dlg), "tapping Wicket opens the dialog")
        tap(dlg.get_by_role("radio", name="Bowled"))
        pick(dlg.get_by_role("combobox", name="New batter"), "Sen")
        tap(dlg.get_by_role("button", name="Record wicket"))
        nxt = dialog(page, "Next bowler")
        poll(page, lambda: visible(nxt), "the over ends and Next bowler opens")
        pick(nxt.get_by_role("combobox", name="Bowler"), "Pillai")
        tap(nxt.get_by_role("button", name="Start over"))
        poll(page, lambda: not visible(nxt), "Start over closes the dialog")
    st = w.state()
    seq = {b["seq"]: b for b in balls(st)}
    assert (seq[5]["bat_runs"], seq[6]["wicket"], st["wickets"], st["bowler"]["player"]) == (2, "bowled", 1, w.pid("h2"))
    assert striker_of(st) == w.pid("k2"), "Sen came in at the striker's end, then the over-end swap"


def test_wf_strike_phone_pad_layout(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])])])
    with open_scoring(browser, w, size=(390, 844)) as page:
        for name in PAD:
            box = key(page, name).bounding_box()
            assert box and box["width"] >= 48 and box["height"] >= 48, f"pad key {name} is {box} (L137)"
        group = pad(page).bounding_box()
        for part in ("#scoreboard", "#this-over"):
            other = page.locator(part).bounding_box()
            assert other and not boxes_overlap(group, other), f"the pad overlaps {part} (L137)"
        layout(page)
        page.set_viewport_size({"width": 320, "height": 844})
        layout(page)
        page.set_viewport_size({"width": 768, "height": 1024})
        for name in PAD:
            box = key(page, name).bounding_box()
            assert box["width"] >= 44 and box["height"] >= 44, f"pad key {name} at 768 is {box}"


def test_wf_wickets_new_batter_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])])])
    with open_scoring(browser, w) as page:
        dlg = dialog(page, "Wicket")
        blur(page)
        page.keyboard.press("w")
        poll(page, lambda: focused(dlg.get_by_role("radio", name="Bowled")), "focus starts on Bowled (L205)")
        for _ in range(12):
            page.keyboard.press("Tab")
            assert dlg.evaluate(JS_IN_DIALOG), "Tab left the open Wicket dialog (L203)"
        page.keyboard.press("Shift+Tab")
        assert dlg.evaluate(JS_IN_DIALOG)
        page.keyboard.press("Escape")
        poll(page, lambda: not visible(dlg) and focused(key(page, "0")), "focus returns to the pad's 0 from the body (L203)")
        key(page, "4").focus()
        page.keyboard.press("w")
        poll(page, lambda: visible(dlg), "W opens the dialog with a pad button focused")
        page.keyboard.press("Escape")
        poll(page, lambda: focused(key(page, "4")), "focus returns to the opener")
        blur(page)
        page.keyboard.press("w")
        poll(page, lambda: focused(dlg.get_by_role("radio", name="Bowled")), "dialog reopened")
        page.keyboard.press("ArrowDown")
        poll(page, lambda: dlg.get_by_role("radio", name="Caught").is_checked(), "ArrowDown selects Caught")
        pick(dlg.get_by_role("combobox", name="Fielder"), "Nair")
        pick(dlg.get_by_role("combobox", name="New batter"), "Sen")
        dlg.get_by_role("button", name="Record wicket").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: top_seq(page) == 2, "Enter on Record wicket records the catch")
        blur(page)
        page.keyboard.press("w")
        poll(page, lambda: visible(dlg), "Wicket reopens")
        dlg.get_by_role("radio", name="Caught").check()
        pick(dlg.get_by_role("combobox", name="Fielder"), "Mehta")
        pick(dlg.get_by_role("combobox", name="New batter"), "Bose")
        dlg.get_by_role("button", name="Record wicket").click()
        poll(page, lambda: top_seq(page) == 3, "the caught-and-bowled wicket records")
    lines = [b["line"] for b in balls(w.state())]
    assert lines[1] == "0.2 Mehta to Iyer, OUT! c Nair b Mehta" and lines[2].endswith("OUT! c & b Mehta")


def test_wf_wickets_new_batter_touch_runout(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E3[:4])])])
    with open_scoring(browser, w, size=(390, 844)) as page:
        tap(key(page, "Wicket"))
        dlg = dialog(page, "Wicket")
        poll(page, lambda: visible(dlg), "Wicket dialog opens")
        tap(dlg.get_by_role("radio", name="Run out"))
        pick(dlg.get_by_role("combobox", name="Fielder"), "Gill")
        tap(dlg.get_by_role("radiogroup", name="Batter out").get_by_role("radio", name="Rao"))
        choose(dlg.get_by_role("combobox", name="Runs completed"), "1")
        pick(dlg.get_by_role("combobox", name="New batter"), "Khan")
        tap(dlg.get_by_role("button", name="Record wicket"))
        poll(page, lambda: sorted(b["text"] for b in batters(page)) == ["Bose 3 (2)", "Khan* 0 (0)"], "E3 batters after 0.5 (L602)")
    assert balls(w.state())[-1]["line"] == E3_LINES[4]


def test_wicket_kinds_per_delivery(browser, app_url):
    cases = [("0", k, True) for k in ("bowled", "caught", "lbw", "stumped", "hit-wicket", "run-out")] + [
        ("D0", "stumped", True), ("D0", "run-out", True), ("D0", "bowled", False), ("D0", "caught", False),
        ("D0", "lbw", False), ("D0", "hit-wicket", False), ("N0", "run-out", True), ("N0", "bowled", False),
        ("N0", "stumped", False), ("B1", "run-out", True), ("B1", "caught", False), ("L1", "run-out", True),
        ("L1", "lbw", False), ("L1", "stumped", False)]
    w = build(app_url, [match_spec(innings=[kinn(["0"])]), match_spec("m2", innings=[kinn(["0"])])])
    with open_scoring(browser, w) as page:
        dlg = dialog(page, "Wicket")
        for extra, allowed in (("d", {"Stumped", "Run out"}), ("n", {"Run out"})):
            blur(page)
            page.keyboard.press(extra)
            page.keyboard.press("w")
            poll(page, lambda: visible(dlg), "Wicket opens with an armed extra")
            for name in HOW_OUT:
                assert dlg.get_by_role("radio", name=name).is_enabled() == (name in allowed), f"{name} after {extra}"
            page.keyboard.press("Escape")
            page.keyboard.press("Escape")
            poll(page, lambda: not visible(dlg), "dialog closes")
    with scoring(browser, w, "m2") as s:
        for token, kind, ok in cases:
            before = s.state()["last_seq"]
            fielder = "h3" if kind in ("caught", "stumped", "run-out") else None
            r = s.deliver(token, wicket(w, kind, fielder=fielder, new="k3"))
            if ok:
                assert r.status_code == 201, f"{kind} on {token}: {r.text[:200]}"
                assert s.undo().status_code == 200
            else:
                refused(r, 422, "WICKET_NOT_ALLOWED", f"A {kind} cannot happen on this delivery.", f"{kind} on {token}")
                assert s.state()["last_seq"] == before, "a refused wicket stores nothing"


def test_new_batter_placement(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn([])])])
    with scoring(browser, w) as s:
        s.ok("1")
        st = s.ok("0", wicket(w, "caught", fielder="h3", new="k3"))
        assert striker_of(st) == w.pid("k3")
        st = s.ok("0", wicket(w, "lbw", new="k4"))
        assert striker_of(st) == w.pid("k4")
        s.ok("2")
        st = s.ok("1", wicket(w, "run-out", fielder="h4", out="non-striker", new="k5"))
        assert batter_texts(st) == ["Bose 3 (2)", "Khan* 0 (0)"]
        st = s.ok("0", wicket(w, "bowled", new="k6"))
        assert batter_texts(st) == ["Bose* 3 (2)", "Das 0 (0)"]


def test_dismissals_fow_all_out(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E3, ("h1", "h2"))]),
                        match_spec("m2", innings=[kinn([{"ball": "0", "out": "hit-wicket", "new_batter": "k3"}])])])
    st = w.state()
    assert chrono(st) == E3_LINES and st["match"]["status"] == "innings_break" and st["wickets"] == 5
    card = w.card()["innings"][0]
    assert (card["total_text"], card["extras"]["text"], card["fall_of_wickets"]) == (E3_TOTAL, E3_EXTRAS, E3_FOW)
    assert [row(r, BAT_KEYS) for r in card["batting"]] == [strs(r) for r in E3_BATTING]
    ex = card["extras"]
    assert sum(r["runs"] for r in card["batting"]) + ex["b"] + ex["lb"] + ex["w"] + ex["nb"] == 5
    assert sum(r["runs"] for r in card["bowling"]) + ex["b"] + ex["lb"] == 5
    assert balls(w.state("m2"))[0]["line"] == "0.1 Mehta to Rao, OUT! hit wicket b Mehta"
    with ui(browser, app_url, f"/matches/{w.mid()}/scorecard", w.session()) as page:
        poll(page, lambda: dom(page, ".fow") == E3_FOW and dom(page, ".total") == E3_TOTAL, "scorecard page fow and total")


def test_free_hit_rule(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0", "N1"])]), match_spec("m2", innings=[kinn(["0", "N1"])]),
                        match_spec("m3", innings=[kinn(["N0", "N0"])])])
    assert w.state()["free_hit"] is True
    with scoring(browser, w) as s:
        refused(s.deliver("0", wicket(w, "bowled", new="k3")), 422, "WICKET_NOT_ALLOWED", FREE_HIT_COPY, "bowled on a free hit")
        refused(s.deliver("D0", wicket(w, "stumped", fielder="h5", new="k3")), 422, "WICKET_NOT_ALLOWED", FREE_HIT_COPY, "stumped on a free-hit wide")
        assert s.ok("D0")["free_hit"] is True
        assert s.ok("6")["free_hit"] is False
        st = s.ok("0")
    assert chrono(st) == E4_LINES and st["scoreboard"] == "Kestrels 9/0 (0.3 ov)" and batter_texts(st) == ["Iyer* 6 (2)", "Rao 1 (2)"]
    with scoring(browser, w, "m2") as s:
        st = s.ok("1", wicket(w, "run-out", fielder="h4", new="k3"))
    assert balls(st)[-1]["line"] == "0.2 Mehta to Iyer, 1 run, OUT! run out (Gill) (free hit)"
    assert w.card("m2")["innings"][0]["fall_of_wickets"] == "Fall of wickets: 1-3 (Iyer, 0.2)"
    m3 = w.state("m3")
    assert m3["free_hit"] is True and balls(m3)[1]["free_hit"] is True


def test_wf_free_hit_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0"])])])
    with open_scoring(browser, w) as page:
        blur(page)
        press_ball(page, ["n", "1"])
        poll(page, lambda: dom(page, "#free-hit") == "FREE HIT" and dom(page, "#announcer") == "0.2 Mehta to Rao, no-ball, 1 run. Kestrels 2/0.",
             "FREE HIT and the no-ball announcement")
        page.keyboard.press("w")
        dlg = dialog(page, "Wicket")
        poll(page, lambda: focused(dlg.get_by_role("radio", name="Run out")), "focus on the only enabled kind")
        assert [n for n in HOW_OUT if dlg.get_by_role("radio", name=n).is_enabled()] == ["Run out"]
        assert FREE_HIT_COPY in dlg.inner_text()
        page.keyboard.press("Escape")
        blur(page)
        press_ball(page, ["d", "0"])
        assert dom(page, "#free-hit") == "FREE HIT" and items(page)[0]["line"] == "0.2 Mehta to Iyer, 1 wide (free hit)"
        press_ball(page, ["6"])
        poll(page, lambda: dom(page, "#free-hit") is None, "the badge leaves after the legal six")
        assert items(page)[0]["line"] == "0.2 Mehta to Iyer, SIX (free hit)"
    st = w.state()
    assert st["free_hit"] is False and st["last_seq"] == 4


def test_wf_free_hit_viewer(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0"])])])
    with viewer(browser, w) as watch, scoring(browser, w) as s:
        poll(watch, lambda: dom(watch, "#scoreboard") is not None, "viewer loads")
        assert dom(watch, "#free-hit") is None
        s.ok("N1")
        poll(watch, lambda: dom(watch, "#free-hit") == "FREE HIT", "viewer shows FREE HIT")
        s.ok("6")
        poll(watch, lambda: dom(watch, "#free-hit") is None and items(watch)[0]["line"] == "0.2 Mehta to Iyer, SIX (free hit)",
             "viewer badge gone and suffix shown")


def test_wf_bowler_limits_next_bowler(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1)])])
    with open_scoring(browser, w, clock=SKEWED_CLOCK) as page:
        dlg = dialog(page, "Next bowler")
        box = dlg.get_by_role("combobox", name="Bowler")
        poll(page, lambda: visible(dlg) and focused(box), "Next bowler opens with focus on Bowler")
        assert option(dlg, box, "Mehta").get_attribute("data-barred") == "consecutive"
        assert option(dlg, box, "Pillai").get_attribute("data-barred") == "none"
        page.keyboard.press("Escape")
        poll(page, lambda: not visible(dlg), "Escape closes it")
        blur(page)
        page.keyboard.press("1")
        poll(page, lambda: dom(page, "#alert") == "Choose the next bowler first." and visible(dlg), "a key reopens it with the copy")
        pick(box, "Mehta")
        dlg.get_by_role("button", name="Start over").click()
        poll(page, lambda: dom(page, "#alert") == "Mehta bowled the last over." and "Mehta bowled the last over." in dlg.inner_text(),
             "refusal in the dialog and #alert")
        pick(box, "Pillai")
        dlg.get_by_role("button", name="Start over").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: not visible(dlg), "Enter on Start over submits")
    st = w.state()
    assert (st["bowler"]["player"], st["next_bowler_needed"], st["last_seq"]) == (w.pid("h2"), False, 9)


def test_wf_bowler_limits_over_limit(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E5, ("h1", "h2", "h1", "h2"))], overs=6)])
    with open_scoring(browser, w) as page:
        dlg = dialog(page, "Next bowler")
        box = dlg.get_by_role("combobox", name="Bowler")
        poll(page, lambda: visible(dlg), "Next bowler opens")
        assert option(dlg, box, "Mehta").get_attribute("data-barred") == "limit"
        pick(box, "Mehta")
        dlg.get_by_role("button", name="Start over").click()
        poll(page, lambda: dom(page, "#alert") == "Mehta has bowled 2 of 2 overs.", "limit refusal (L623)")
        pick(box, "Nair")
        dlg.get_by_role("button", name="Start over").click()
        poll(page, lambda: not visible(dlg), "Nair's over starts")
    assert w.state()["bowler"]["player"] == w.pid("h3")


def test_bowler_limit_refusals(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E5, ("h1", "h2", "h1", "h2"))], overs=6)])
    with scoring(browser, w) as s:
        barred = {b["player"]: b["reason"] for b in s.state()["barred_bowlers"]}
        assert barred.get(w.pid("h2")) == "consecutive" and barred.get(w.pid("h1")) == "limit"
        refused(s.over(w.pid("h2")), 422, "BOWLER_CONSECUTIVE", "Pillai bowled the last over.", "Pillai")
        refused(s.over(w.pid("h1")), 422, "BOWLER_LIMIT", "Mehta has bowled 2 of 2 overs.", "Mehta")
        assert s.state()["next_bowler_needed"] is True, "refusals change nothing"
        assert s.over(w.pid("h3")).status_code == 201


def test_bowling_figures(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E5, ("h1", "h2", "h1", "h2"))], overs=6),
                        match_spec("m2", innings=[kinn(E3, ("h1", "h2"))]), match_spec("m3", innings=[kinn(E3[:3])]),
                        match_spec("m4", innings=[kinn(E1)])])
    assert [row(r, BOWL_KEYS) for r in w.card()["innings"][0]["bowling"]] == [strs(r) for r in E5_BOWLING]
    assert w.state()["bowler"]["figures"] == "2-0-12-0"
    assert [row(r, BOWL_KEYS) for r in w.card("m2")["innings"][0]["bowling"]] == [strs(r) for r in E3_BOWLING]
    assert w.state("m3")["bowler"]["figures"] == "0.3-0-1-2"
    with ui(browser, app_url, f"/matches/{w.mid('m4')}/score", w.session()) as page:
        poll(page, lambda: dom(page, "#bowler") == E1_BOWLER, "#bowler shows the last bowler between overs")


def test_wf_change_delivery_live_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))])])
    with open_scoring(browser, w) as page:
        page.get_by_role("button", name="Change delivery 2").focus()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Change delivery 2")
        change_pad = dlg.get_by_role("group", name="Change pad")
        poll(page, lambda: focused(change_pad.get_by_role("button", name="2", exact=True)), "focus on the current runs (L209)")
        page.keyboard.press("1")
        poll(page, lambda: dom(page, "#change-preview") == "New: 1 run", "the 1 key picks 1 run inside the dialog; the preview follows")
        assert w.state()["last_seq"] == 9, "keys in the dialog record nothing"
        save = dlg.get_by_role("button", name="Save change")
        with entered(held(page, "**/api/matches/*/deliveries/*")) as gate:
            save.click()
            poll(page, lambda: save.is_disabled(), "Save change is disabled while pending")
            gate.release()
        poll(page, lambda: dom(page, "#announcer") == "Delivery 2 changed. Innings recalculated." and not visible(dlg),
             "the changed copy and the dialog closes")
        poll(page, lambda: dom(page, "#scoreboard") == E6_SCOREBOARD and sorted(b["text"] for b in batters(page)) == sorted(E6_BATTERS),
             "the page shows the replayed innings")
    assert chrono(w.state()) == E6_LINES


def test_wf_change_delivery_live_touch_refused(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))])])
    before = w.state()
    with open_scoring(browser, w, size=(390, 844)) as page:
        tap(page.get_by_role("button", name="Change delivery 4"))
        dlg = dialog(page, "Change delivery 4")
        change_pad = dlg.get_by_role("group", name="Change pad")
        poll(page, lambda: visible(dlg), "the change dialog opens")
        tap(change_pad.get_by_role("button", name="Bye", exact=True))
        tap(change_pad.get_by_role("button", name="1", exact=True))
        poll(page, lambda: dom(page, "#change-preview") == "New: 1 bye", "bye preview")
        tap(dlg.get_by_role("button", name="Save change"))
        copy = "That change would move the overs. Undo back to this delivery instead."
        poll(page, lambda: dom(page, "#alert") == copy and copy in dlg.inner_text(), "refusal in dialog and #alert")
        assert w.state() == before
        tap(change_pad.get_by_role("button", name="No-ball", exact=True))
        tap(change_pad.get_by_role("button", name="1", exact=True))
        poll(page, lambda: dom(page, "#change-preview") == "New: no-ball, 1 run", "no-ball preview")
        tap(dlg.get_by_role("button", name="Save change"))
        poll(page, lambda: not visible(dlg), "the change saves")
    seq = {b["seq"]: b for b in balls(w.state())}
    assert (seq[4]["line"], seq[5]["line"]) == ("0.4 Mehta to Rao, no-ball, 1 run", "0.4 Mehta to Iyer, 3 runs (free hit)")


def test_innings_replay_after_change(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))]), match_spec("m2", innings=[kinn(E2, ("h1", "h2"))])])
    with scoring(browser, w) as s:
        r = s.change(2, "1")
        assert r.status_code == 200, r.text[:300]
    st = w.state()
    assert chrono(st) == E6_LINES and st["scoreboard"] == E6_SCOREBOARD and batter_texts(st) == sorted(E6_BATTERS)
    card = w.card()["innings"][0]
    assert [row(r, ("name", "runs", "balls", "fours", "sixes", "strike_rate")) for r in card["batting"][:2]] == [
        strs(("Arjun Rao", 4, 3, 0, 0, "133.33")), strs(("Kabir Iyer", 6, 5, 1, 0, "120.00"))]
    assert st["bowler"]["figures"] == "1-0-12-0" or card["bowling"][0]["economy"] == "12.00"
    assert str(card["bowling"][0]["economy"]) == "12.00"
    with scoring(browser, w, "m2") as s:
        assert s.change(4, "N1").status_code == 200
    st = w.state("m2")
    assert st["scoreboard"] == E2_SCOREBOARD
    card = w.card("m2")["innings"][0]
    assert row(card["batting"][0], ("runs", "balls", "fours", "sixes", "strike_rate")) == strs((7, 6, 1, 0, "116.67"))
    assert (str(card["bowling"][0]["wides"]), str(card["bowling"][0]["no_balls"])) == ("0", "1")


def test_change_refusals(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))]),
                        match_spec("m2", innings=[kinn([{"ball": "D0", "out": "stumped", "fielder": "h5", "new_batter": "k3"}])]),
                        match_spec("m3", innings=[kinn(["D0", {"ball": "0", "out": "bowled", "new_batter": "k3"}])])])
    later = "That change would make delivery <seq> a free hit, and its wicket (<kind>) cannot happen on a free hit."
    this = "That change would make its wicket (<kind>) impossible."
    cases = [("m1", 4, "1", "CHANGE_MOVES_OVERS", "That change would move the overs. Undo back to this delivery instead."),
             ("m1", 1, "B0", "BYES_NEED_RUNS", "Byes need at least 1 run."),
             ("m2", 1, "N0", "CHANGE_BREAKS_WICKET", this.replace("<kind>", "stumped")),
             ("m3", 1, "N0", "CHANGE_BREAKS_WICKET", later.replace("<seq>", "2").replace("<kind>", "bowled"))]
    for match in ("m1", "m2", "m3"):
        with scoring(browser, w, match) as s:
            for _, seq, token, code, copy in [c for c in cases if c[0] == match]:
                before = w.state(match)
                refused(s.change(seq, token), 422, code, copy, f"{match} delivery {seq} -> {token}")
                assert w.state(match) == before, f"{code} left the innings unchanged"


def test_corrections_shown_to_viewers(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))])])
    with viewer(browser, w, init=[WS_HOOK]) as watch, scoring(browser, w) as s:
        poll(watch, lambda: dom(watch, "#scoreboard") == E2_SCOREBOARD, "viewer loads E2")
        assert s.change(2, "1").status_code == 200
        poll(watch, lambda: dom(watch, "#notice") == "The scorer changed delivery 2." and dom(watch, "#scoreboard") == E6_SCOREBOARD,
             "the change notice and recomputed score")
        assert s.undo().status_code == 200
        after = s.state()
        poll(watch, lambda: dom(watch, "#notice") == "The scorer undid delivery 9." and dom(watch, "#scoreboard") == after["scoreboard"],
             "the undo notice and recomputed score")
        notices = watch.evaluate("() => window.__notices")
        assert notices[-2:] == ["The scorer changed delivery 2.", "The scorer undid delivery 9."], notices
        assert "The scorer undid delivery 9." in (dom(watch, "#announcer") or "")


def test_wf_undo_live_key(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E3[:3])])])
    with viewer(browser, w) as watch, open_scoring(browser, w) as page:
        poll(watch, lambda: dom(watch, "#scoreboard") == "Kestrels 1/2 (0.3 ov)", "viewer loads E7 start")
        blur(page)
        with entered(held(page, "**/api/matches/*/deliveries/last")) as gate:
            page.keyboard.press("u")
            poll(page, lambda: key(page, "Undo").is_disabled(), "Undo disabled while pending")
            gate.release()
        poll(page, lambda: dom(page, "#announcer") == "Undid delivery 3." and dom(page, "#scoreboard") == "Kestrels 1/1 (0.2 ov)",
             "the undo is announced and the score replayed")
        assert sorted(b["text"] for b in batters(page)) == ["Rao 1 (1)", "Sen* 0 (0)"] and dom(page, "#bowler") == "Mehta 0.2-0-1-1"
        poll(watch, lambda: dom(watch, "#scoreboard") == "Kestrels 1/1 (0.2 ov)" and dom(watch, "#notice") == "The scorer undid delivery 3.",
             "the viewer updates in place")
    st = w.state()
    assert w.pid("k4") in [p["player"] for p in st["yet_to_bat"]]
    assert w.card()["innings"][0]["fall_of_wickets"] == "Fall of wickets: 1-1 (Iyer, 0.2)"


def test_wf_undo_live_retirement(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])])])
    with open_scoring(browser, w) as page:
        key(page, "Undo").focus()
        page.keyboard.press("r")
        dlg = dialog(page, "Retire batter")
        poll(page, lambda: visible(dlg), "Retire batter opens")
        dlg.get_by_role("radiogroup", name="Batter").get_by_role("radio", name=re.compile(r"^Iyer\b")).check()
        pick(dlg.get_by_role("combobox", name="New batter"), "Sen")
        dlg.get_by_role("button", name="Retire").click()
        poll(page, lambda: dom(page, "#announcer") == "Iyer retired hurt. Kestrels 1/0.", "retirement announcement")
        assert (items(page)[0]["kind"], items(page)[0]["line"]) == ("retirement", "Iyer retired hurt")
        page.get_by_role("button", name="Undo").click()
        poll(page, lambda: dom(page, "#announcer") == "Undid the retirement of Iyer.", "undo of the retirement")
    assert striker_of(w.state()) == w.pid("k2")


def test_undo_across_over_and_innings(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1, ("h1", "h2"))]),
                        match_spec("m2", innings=[inn("k1", "k2", ["h1", "h2", "h3", "h4", "h5"], E8_KESTRELS)]),
                        match_spec("m3", innings=e8(E8_HERONS_24 + E8_HERONS_REST)),
                        match_spec("m4", innings=e8([], ("k1",))), match_spec("m5")])
    with scoring(browser, w) as s:
        st = s.undo().json()
        assert (st["last_seq"], st["legal_balls"], st["bowler"]["player"], st["next_bowler_needed"]) == (8, 5, w.pid("h1"), False)
    for match in ("m2", "m4"):
        with scoring(browser, w, match) as s:
            st = s.undo().json()
            assert (st["match"]["status"], st["runs"], st["legal_balls"], st["innings_break"]) == ("innings_1", 51, 29, None), match
    with scoring(browser, w, "m3") as s:
        st = s.undo().json()
        assert (st["match"]["status"], st["result"], st["runs"]) == ("innings_2", None, 52)
    assert all(m["id"] != w.mid("m3") for m in get_json(app_url, f"/api/teams/{w.tid()}", w.session())["matches"])
    with scoring(browser, w, "m5") as s:
        refused(s.undo(), 409, "NOTHING_TO_UNDO", "Nothing to undo in this innings.", "undo on a ready match")


def test_retired_hurt(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])], overs=1, pps=3),
                        match_spec("m2", innings=[kinn(["1", {"ball": "0", "out": "bowled", "new_batter": "k2"}],
                                                       retirements=[{"before_seq": 2, "batter": "k2", "new_batter": "k3"}])], overs=1, pps=3)])
    with scoring(browser, w) as s:
        r = s.retire(w.pid("k2"), w.pid("k3"))
        assert r.status_code == 201, r.text[:300]
        st = r.json()
        assert striker_of(st) == w.pid("k3") and (st["commentary"][0]["kind"], st["commentary"][0]["line"]) == ("retirement", "Iyer retired hurt")
        assert any(p["player"] == w.pid("k2") and p["retired_hurt"] for p in st["yet_to_bat"])
        assert striker_of(s.undo().json()) == w.pid("k2")
        refused(s.retire(w.pid("k2"), w.pid("k1")), 422, "NEW_BATTER_INVALID", "Choose a batter who is waiting to bat.", "batting new batter")
        assert s.retire(w.pid("k2"), w.pid("k3")).status_code == 201
        for _ in range(5):
            s.ok("0")
    card = w.card()["innings"][0]
    iyer = next(r for r in card["batting"] if r["name"] == "Kabir Iyer")
    assert iyer["dismissal"] == "retired hurt" and card["fall_of_wickets"] == "Fall of wickets: none"
    st = w.state("m2")
    assert striker_of(st) == w.pid("k2"), "the retired batter came back"
    assert [r["name"] for r in w.card("m2")["innings"][0]["batting"]].count("Kabir Iyer") == 1
    with scoring(browser, w, "m2") as s:
        r = s.retire(w.pid("k1"), None)
        assert r.status_code == 422 and error_of(r)[0] in ("NO_BATTER_LEFT", "NEW_BATTER_INVALID"), f"nobody left: {r.status_code} {r.text[:200]}"


def test_end_of_innings(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0"] * 5)], overs=1), match_spec("m2"),
                        match_spec("m3", innings=e8(E8_HERONS_24 + E8_HERONS_REST[:-1])),
                        match_spec("m4", innings=[kinn(["0"])]), match_spec("m5", innings=[kinn(E1)]),
                        match_spec("m6", innings=[kinn(E3[:-1], ("h1", "h2"))])])
    over = "This innings is over."
    with scoring(browser, w) as s:
        assert s.ok("0")["match"]["status"] == "innings_break", "the over quota ends the innings"
        refused(s.deliver("0"), 409, "INNINGS_OVER", over, "delivery at the break")
        refused(s.over(w.pid("h2")), 409, "INNINGS_OVER", over, "over at the break")
        refused(s.retire(w.pid("k1"), w.pid("k3")), 409, "INNINGS_OVER", over, "retirement at the break")
    with scoring(browser, w, "m2") as s:
        refused(s.deliver("0"), 409, "NEEDS_INNINGS", "Start the innings first.", "delivery before the innings")
    with scoring(browser, w, "m3") as s:
        assert s.ok("1")["match"]["status"] == "result", "reaching the target ends the match"
        refused(s.deliver("0"), 409, "MATCH_OVER", "This match is over.", "delivery after the result")
        refused(s.start(w.pid("h1"), w.pid("h2"), w.pid("k1")), 409, "MATCH_OVER", "This match is over.", "innings after the result")
    with scoring(browser, w, "m4") as s:
        refused(s.over(w.pid("h2")), 409, "OVER_IN_PROGRESS", "This over has already started.", "second over start")
        refused(s.start(w.pid("k1"), w.pid("k2"), w.pid("h2")), 409, "INNINGS_IN_PROGRESS", "This innings has already started.", "innings start")
    with scoring(browser, w, "m5") as s:
        refused(s.deliver("0"), 409, "NEEDS_BOWLER", "Choose the next bowler first.", "delivery with a bowler needed")
    with scoring(browser, w, "m6") as s:
        assert s.ok("D0", wicket(w, "stumped", fielder="h5"))["match"]["status"] == "innings_break", "the last wicket ends it all out"


def test_wf_innings_break_chase_start(browser, app_url):
    w = build(app_url, [match_spec(innings=[inn("k1", "k2", ["h1", "h2", "h3", "h4", "h5"], E8_KESTRELS)])])
    with viewer(browser, w, clock=SKEWED_CLOCK) as watch, open_scoring(browser, w, clock=SKEWED_CLOCK) as page:
        for p in (page, watch):
            poll(p, lambda p=p: p.evaluate("() => { const r = document.querySelector('#innings-break'); const h = r && r.querySelector('h2'); return h ? h.textContent.trim() : null; }") == "Innings break"
                 and E8_BREAK in (dom(p, "#innings-break") or ""), "the break heading and target sentence (L664)")
        assert key(page, "1").is_disabled() and key(page, "Undo").is_enabled()
        page.get_by_role("button", name="Start second innings").click()
        dlg = dialog(page, "Start innings")
        poll(page, lambda: focused(dlg.get_by_role("combobox", name="Striker", exact=True)), "focus starts on Striker")
        pick(dlg.get_by_role("combobox", name="Striker", exact=True), "Mehta")
        pick(dlg.get_by_role("combobox", name="Non-striker"), "Pillai")
        pick(dlg.get_by_role("combobox", name="Bowler"), "Rao")
        dlg.get_by_role("button", name="Start innings").click()
        poll(page, lambda: not visible(dlg), "the dialog closes")
    st = w.state()
    assert (st["match"]["status"], striker_of(st), st["bowler"]["player"]) == ("innings_2", w.pid("h1"), w.pid("k1"))


def test_chase_line(browser, app_url):
    w = build(app_url, [match_spec(innings=e8(E8_HERONS_24, ("k1", "k2", "k3")))])
    st = w.state()
    assert (st["scoreboard"], st["run_rate"], st["chase"]["text"]) == E8_AT_24
    with viewer(browser, w) as watch:
        poll(watch, lambda: dom(watch, "#chase") == E8_AT_24[2], "#chase on the viewer page")
    with scoring(browser, w) as s:
        for i, ((line, chase), token) in enumerate(zip(E8_TAIL, E8_HERONS_REST)):
            if i == 2:
                assert s.over(w.pid("k4")).status_code == 201
            ball = token if isinstance(token, str) else token["ball"]
            before = s.state()["chase"]["balls_left"]
            st = s.ok(ball, wicket(w, "bowled", new="h3") if isinstance(token, dict) else None)
            assert balls(st)[-1]["line"] == line
            if chase:
                assert st["chase"]["text"] == chase
            if ball.startswith("D"):
                assert st["chase"]["balls_left"] == before, "a wide never changes balls left"


def test_wf_innings_break_chase_finish(browser, app_url):
    w = build(app_url, [match_spec(innings=e8(E8_HERONS_24 + E8_HERONS_REST[:-1]), played_on=PLAYED_ON)])
    with viewer(browser, w) as watch, open_scoring(browser, w) as page:
        poll(page, lambda: dom(page, "#chase") == "Need 1 from 8 balls. Required rate 0.75", "chase line before the last ball")
        blur(page)
        press_ball(page, ["1"])
        poll(page, lambda: dom(page, "#result") == E8_RESULT
             and dom(page, "#announcer") == f"3.5 Bose to Nair, 1 run. Herons 53/1. {E8_RESULT}.", "result and announcement")
        poll(watch, lambda: dom(watch, "#result") == E8_RESULT, "viewer shows the result")
    with ui(browser, app_url, f"/matches/{w.mid()}/scorecard", w.session()) as card:
        poll(card, lambda: dom(card, "#result") == E8_RESULT, "scorecard result")
        for team in ("kes", "her"):
            card.goto(f"{app_url}/teams/{w.tid(team)}")
            card.reload()
            history = card.get_by_role("list", name="Matches")
            poll(card, lambda: history.count() == 1 and E8_HISTORY in history.inner_text(), f"{team} history keeps the result")
    for team in ("kes", "her"):
        lines = [m["line"] for m in get_json(app_url, f"/api/teams/{w.tid(team)}", w.session())["matches"]]
        assert E8_HISTORY in lines


def test_scorecard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1)]), match_spec("m2", innings=e8(E8_HERONS_24 + E8_HERONS_REST))])
    inn1 = w.card()["innings"][0]
    assert (inn1["heading"], inn1["extras"]["text"], inn1["total_text"], inn1["fall_of_wickets"]) == (
        "Kestrels innings", E1_EXTRAS, "Total 20/0 (1 ov)", "Fall of wickets: none")
    assert inn1["did_not_bat"] == ["Sen", "Bose", "Khan", "Das"]
    card = w.card("m2")
    assert [i["heading"] for i in card["innings"]] == ["Kestrels innings", "Herons innings"] and card["result"] == E8_RESULT
    assert [i["total_text"] for i in card["innings"]] == ["Total 52/0 (5 ov)", "Total 53/1 (3.5 ov)"]
    for i, total in zip(card["innings"], (52, 53)):
        ex = i["extras"]
        assert sum(r["runs"] for r in i["batting"]) + ex["b"] + ex["lb"] + ex["w"] + ex["nb"] == total
        assert sum(r["runs"] for r in i["bowling"]) + ex["b"] + ex["lb"] == total
    with ui(browser, app_url, f"/matches/{w.mid()}/scorecard", w.session()) as page:
        bat = table(page, "Batting")
        assert bat["head"] == ["Batter", "Dismissal", "R", "B", "4s", "6s", "SR"]
        assert [r for r in bat["body"]][:2] == [list(strs(r)) for r in E1_BATTING]
        bowl = table(page, "Bowling")
        assert bowl["head"] == ["Bowler", "O", "M", "R", "W", "Wd", "Nb", "Econ"] and bowl["body"][0] == list(strs(E1_BOWLING))
        assert (dom(page, ".extras"), dom(page, ".did-not-bat"), dom(page, ".fow")) == (
            E1_EXTRAS, "Did not bat: Sen, Bose, Khan, Das", "Fall of wickets: none")
        assert page.get_by_role("heading", name="Kestrels innings").count() == 1


def test_wf_super_over_start(browser, app_url):
    w = build(app_url, [match_spec(innings=tied_main(), overs=1, super_over=True)])
    start = "Scores level. Herons bat first in super over 1."
    with viewer(browser, w, clock=SKEWED_CLOCK) as watch, open_scoring(browser, w, clock=SKEWED_CLOCK) as page:
        for p in (page, watch):
            poll(p, lambda p=p: "Super over 1" in (dom(p, "#innings-break") or "") and start in (dom(p, "#innings-break") or ""),
                 "the super-over break heading and start text")
        page.get_by_role("button", name="Start super over").click()
        dlg = dialog(page, "Start innings")
        poll(page, lambda: visible(dlg), "Start innings opens")
        pick(dlg.get_by_role("combobox", name="Striker", exact=True), "Mehta")
        pick(dlg.get_by_role("combobox", name="Non-striker"), "Pillai")
        pick(dlg.get_by_role("combobox", name="Bowler"), "Rao")
        dlg.get_by_role("button", name="Start innings").click()
        poll(page, lambda: not visible(dlg) and enabled(key(page, "4")), "the super over starts")
        blur(page)
        press_ball(page, ["4"])
        poll(page, lambda: items(page)[0]["line"] == "0.1 Rao to Mehta, FOUR" and attr(page, "#scoreboard", "data-innings") == "so1-1",
             "the first super-over ball")
    st = w.state()
    assert (st["match"]["status"], st["innings"]) == ("super_over", "so1-1")


def test_wf_super_over_finish(browser, app_url):
    w = build(app_url, [match_spec(innings=tied_main() + [inn("h1", "h2", ["k1"], E9_HERONS)], overs=1, super_over=True)])
    with viewer(browser, w) as watch, open_scoring(browser, w) as page:
        poll(page, lambda: "Herons 14 all out (1 ov). Kestrels need 15 runs from 6 balls." in (dom(page, "#innings-break") or ""),
             "the break text between the halves")
        page.get_by_role("button", name="Start super over").click()
        dlg = dialog(page, "Start innings")
        poll(page, lambda: visible(dlg), "Start innings opens")
        pick(dlg.get_by_role("combobox", name="Striker", exact=True), "Rao")
        pick(dlg.get_by_role("combobox", name="Non-striker"), "Iyer")
        pick(dlg.get_by_role("combobox", name="Bowler"), "Mehta")
        dlg.get_by_role("button", name="Start innings").click()
        poll(page, lambda: not visible(dlg) and enabled(key(page, "6")), "the second half starts")
        blur(page)
        for keys in (["6"], ["1"], ["4"], ["n", "0"], ["2"], ["1"]):
            press_ball(page, keys)
        poll(page, lambda: dom(page, "#result") == "Kestrels won the super over", "scorer result")
        poll(watch, lambda: dom(watch, "#result") == "Kestrels won the super over", "viewer result")
    assert [b["line"] for b in balls(w.state())] == E9_KESTRELS_LINES
    headings = [i["heading"] for i in w.card()["innings"]]
    assert headings[-2:] == ["Super over 1: Herons", "Super over 1: Kestrels"]


def test_super_over_rules(browser, app_url):
    so1 = tied_main() + [inn("h1", "h2", ["k1"], E9_HERONS), inn("k1", "k2", ["h1"], SO_LEVEL_REPLY)]
    w = build(app_url, [match_spec(innings=tied_main(), overs=1, super_over=True),
                        match_spec("m2", innings=so1, overs=1, super_over=True),
                        match_spec("m3", innings=so1 + [kinn(["1"] * 6, ("h2",))], overs=1, super_over=True)])
    with scoring(browser, w) as s:
        assert s.start(w.pid("h1"), w.pid("h2"), w.pid("k1")).status_code == 201
        s.ok("0", wicket(w, "bowled", new="h3"))
        st = s.ok("0", wicket(w, "bowled"))
        assert (st["match"]["status"], st["wickets"], st["legal_balls"]) == ("super_over_break", 2, 2), "2 wickets end the half"
        assert s.start(w.pid("k1"), w.pid("k2"), w.pid("h1")).status_code == 201
        st = s.ok("1")
        assert (st["match"]["status"], st["result"]) == ("result", "Kestrels won the super over")
        st = s.undo().json()
        assert (st["match"]["status"], st["result"]) == ("super_over", None), "undo clears the super-over result"
    st = w.state("m2")
    assert st["innings_break"]["heading"] == "Super over 2" and st["innings_break"]["text"] == "Scores level. Kestrels bat first in super over 2."
    with scoring(browser, w, "m2") as s:
        refused(s.start(w.pid("k1"), w.pid("k2"), w.pid("h1")), 422, "BOWLER_BARRED", "Mehta bowled in the last super over.", "Mehta")
    with scoring(browser, w, "m3") as s:
        refused(s.start(w.pid("h1"), w.pid("h2"), w.pid("k1")), 422, "BOWLER_BARRED", "Rao bowled in the last super over.", "Rao")
        assert s.start(w.pid("h1"), w.pid("h2"), w.pid("k3")).status_code == 201
        for _ in range(6):
            st = s.ok("1")
    assert (st["match"]["status"], st["result"]) == ("tied", f"Match tied after {SUPER_OVER_MAX} super overs")


def test_wf_live_viewers_motion_follow(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])])])
    old = w.code()
    with ui(browser, app_url, "/follow") as watch:
        watch.get_by_role("textbox", name="Viewer code").fill(old)
        watch.get_by_role("button", name="Follow").click()
        poll(watch, lambda: urlsplit(watch.url).path == f"/live/{old}" and dom(watch, "#scoreboard") is not None, "Follow opens the viewer")
        assert pad(watch).count() == 0 and watch.get_by_role("button", name="Undo").count() == 0
        with http(app_url) as anon:
            refused(anon.post(f"/api/live/{old}/state", json={}), 404, "NOT_FOUND", what="POST through the viewer link")
        with ui(browser, app_url, f"/matches/{w.mid()}", w.session()) as org:
            switch = org.get_by_role("switch", name="Viewer link")
            poll(org, lambda: switch.get_attribute("aria-checked") == "true", "the link starts on")
            switch.click()
            poll_real(watch, lambda: dom(watch, "#live-status") == "This match is no longer shared.", "the open viewer page says so at once")
            assert httpx.get(f"{app_url}/api/live/{old}/state", timeout=HTTP_TIMEOUT).status_code == 404
            switch.click()
            poll(org, lambda: switch.get_attribute("aria-checked") == "true", "the link turns back on")
    new = get_json(app_url, f"/api/matches/{w.mid()}", w.session())["viewer_code"]
    assert new != old and httpx.get(f"{app_url}/api/live/{old}/state", timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.get(f"{app_url}/api/live/{new}/state", timeout=HTTP_TIMEOUT).status_code == 200


def test_live_viewer_delay(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])])])
    delay = get_json(app_url, "/api/config")["live_delay_ms"]
    with viewer(browser, w, init=[WS_HOOK]) as watch, scoring(browser, w) as s:
        poll_real(watch, lambda: attr(watch, "#scoreboard", "data-runs") == "1", "the first state shows at once (L686)")
        states = lambda: watch.evaluate("() => window.__live.filter((m) => m.type === 'state').length")
        before = states()
        s.ok("2")
        poll_real(watch, lambda: states() > before, "the live state arrives")
        advance(watch, delay - 1)
        assert attr(watch, "#scoreboard", "data-runs") == "1", "shown before LIVE_DELAY_MS"
        advance(watch, 1)
        poll(watch, lambda: attr(watch, "#scoreboard", "data-runs") == "3", "shown at LIVE_DELAY_MS", step_ms=1)
        before = states()
        s.ok("4")
        poll_real(watch, lambda: states() > before, "the second live state arrives")
        advance(watch, delay)
        poll(watch, lambda: attr(watch, "#scoreboard", "data-runs") == "7", "the second state shows")
        before = states()
        s.ok("6")
        poll_real(watch, lambda: states() > before, "the third live state arrives")
        advance(watch, delay)
        poll(watch, lambda: attr(watch, "#scoreboard", "data-runs") == "13", "the later state shows")
        runs = watch.evaluate("() => window.__runs")
        assert runs[-3:] == ["3", "7", "13"], f"states shown in arrival order: {runs}"


def test_viewer_data_fields(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])], scorers=["mira"])])
    state_keys = {"match", "innings", "batting_team", "bowling_team", "runs", "wickets", "legal_balls", "overs_text", "scoreboard",
                  "batters", "bowler", "next_bowler_needed", "barred_bowlers", "free_hit", "run_rate", "chase", "this_over",
                  "commentary", "yet_to_bat", "innings_break", "result", "last_seq"}
    match_keys = {"id", "title", "status", "overs", "players_per_side", "super_over", "home", "away", "played_on"}

    def clean(body: Any, what: str) -> None:
        text = json.dumps(body)
        assert "@" not in text, f"{what} carries an email"
        for who in ("olga", "mira"):
            assert PEOPLE[who] not in text, f"{what} names a scorer"
            if len(str(w.uid(who))) >= 8:
                assert str(w.uid(who)) not in text, f"{what} carries an account id"

    st = get_json(app_url, f"/api/live/{w.code()}/state")
    assert set(st) == state_keys and set(st["match"]) == match_keys and set(st["match"]["home"]) == {"id", "name", "logo_url"}
    assert set(st["commentary"][0]) == {"kind", "seq", "over", "ball", "label", "runs", "bat_runs", "extra", "extra_runs", "wicket",
                                        "free_hit", "striker", "bowler", "line"}
    clean(st, "viewer state")
    assert set(w.state()) == state_keys | {"viewer_link", "viewer_code"}
    card = get_json(app_url, f"/api/live/{w.code()}/scorecard")
    assert set(card) == {"match", "innings", "result"} and set(card["match"]) == match_keys
    assert set(card["innings"][0]) == {"innings", "heading", "batting", "extras", "total_text", "did_not_bat", "fall_of_wickets", "bowling"}
    clean(card, "viewer scorecard")
    with live(browser, app_url, None, {"type": "watch", "code": w.code()}) as sock, scoring(browser, w) as s:
        s.ok("2")
        message = sock.wait("(m) => m.type === 'state'", "the code watch receives the delivery")
        assert set(message["state"]) == state_keys
        clean(sock.all(), "live messages to a viewer")


def test_wf_live_viewers_motion_tick(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1, ("h1", "h2"))]),
                        match_spec("m2", innings=[kinn(E1 + ["6"] * 12 + ["6", "1"], ("h1", "h2", "h3", "h4"))])])
    cfg = get_json(app_url, "/api/config")
    tick, stagger = cfg["tick_ms"], cfg["tick_stagger_ms"]

    def ticks(page: Page) -> dict:
        return {t["index"]: t for t in page.evaluate(READ_TICKS) if t["id"] == "ball-tick"}

    with open_scoring(browser, w, init=[TICK_HOOK]) as page:
        page.evaluate(FLUSH_TICKS)
        blur(page)
        with entered(held(page, "**/api/matches/*/deliveries")) as gate:
            page.keyboard.press("d")
            page.keyboard.press("0")
            poll(page, lambda: pad(page).get_attribute("aria-busy") == "true", "the wide is pending")
            assert ticks(page) == {}, "nothing moves before the server's new state"
            gate.release()
        poll(page, lambda: attr(page, "#scoreboard", "data-runs") == "21", "21/0 shows")
        got = ticks(page)
        assert set(got) == {1}, f"20/0 to 21/0 rolls exactly the second runs digit, not overs: {got}"
        assert (got[1]["delay"], got[1]["duration"], got[1]["ticking"]) == (0, tick, "true")
    with open_scoring(browser, w, "m2", init=[TICK_HOOK]) as page:
        page.evaluate(FLUSH_TICKS)
        blur(page)
        press_ball(page, ["4"])
        poll(page, lambda: page.evaluate(JS_DIGITS) == ["1", "0", "3", "0", "3", "3"], "103/0 (3.3 ov)")
        got = ticks(page)
        assert set(got) == {0, 1, 2, 5}, f"99->103 rolls every runs digit and the changed overs digit: {got}"
        assert [got[i]["delay"] for i in (0, 1, 2, 5)] == [0, 0, 0, 2 * stagger]
        page.evaluate(FLUSH_TICKS)
        page.keyboard.press("w")
        dlg = dialog(page, "Wicket")
        poll(page, lambda: visible(dlg), "Wicket opens")
        dlg.get_by_role("radio", name="Bowled").check()
        pick(dlg.get_by_role("combobox", name="New batter"), "Sen")
        dlg.get_by_role("button", name="Record wicket").click()
        poll(page, lambda: attr(page, "#scoreboard", "data-wickets") == "1", "103/1 shows")
        got = ticks(page)
        assert set(got) == {3, 5} and (got[3]["delay"], got[5]["delay"]) == (stagger, 2 * stagger), got


def test_reduced_motion(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1, ("h1", "h2"))])])
    announce = "1.1 Pillai to Rao, 1 wide. Kestrels 21/0."
    with viewer(browser, w, motion="reduce", init=[TICK_HOOK]) as watch, open_scoring(browser, w, motion="reduce", init=[TICK_HOOK]) as page:
        poll(watch, lambda: attr(watch, "#scoreboard", "data-runs") == "20", "viewer loads")
        blur(page)
        press_ball(page, ["d", "0"])
        for p in (page, watch):
            poll(p, lambda p=p: p.evaluate(JS_DIGITS)[:2] == ["2", "1"] and dom(p, "#announcer") == announce, "digits and announcement")
            assert [t for t in p.evaluate(READ_TICKS) if t["id"] == "ball-tick"] == [], "no ball-tick under reduced motion"


def test_pinned_scoreboard(browser, app_url):
    bowlers = [f"h{(i % 5) + 1}" for i in range(19)]
    w = build(app_url, [match_spec(innings=[kinn(["1"] * 114, bowlers)], overs=20)])
    for size in ((1280, 800), (390, 844)):
        with viewer(browser, w, size=size) as watch:
            poll(watch, lambda: len(items(watch)) > 100, "the long commentary loads")
            first = watch.evaluate("() => document.querySelector('#commentary').getBoundingClientRect().top")
            watch.evaluate("() => window.scrollTo(0, 1000)")
            got = watch.evaluate("() => [window.scrollY, document.querySelector('#scoreboard').getBoundingClientRect().top, document.querySelector('#commentary').getBoundingClientRect().top]")
            assert got[0] >= 1000 and 0 <= got[1] <= 1 and got[2] < first, f"pinned scoreboard at {size}: {got}"


def test_wf_second_scorer_pen_handover(browser, app_url, mail):
    w = build(app_url, [match_spec(innings=[kinn([])])])
    with ui(browser, app_url, f"/matches/{w.mid()}", w.session()) as org:
        org.get_by_role("textbox", name="Scorer email").fill(w.emails["sam"])
        org.get_by_role("button", name="Send invitation").click()
        poll(org, lambda: dom(org, "#announcer") == f"Invitation sent to {w.emails['sam']}.", "the sent copy")
    path = invite_link(mails_for(mail, [w.emails["sam"]])[w.emails["sam"]])
    with live(browser, app_url, w.session(), {"type": "score", "match": w.mid()}) as holder:
        assert holder.wait("(m) => m.type === 'pen'", "organiser gets the pen").get("pen")
        with ui(browser, app_url, path, w.session("sam")) as page:
            poll(page, lambda: page.get_by_role("heading", level=1, name="Score Kestrels v Herons").count() == 1, "invitation heading")
            page.get_by_role("button", name="Accept invitation").click()
            poll(page, lambda: urlsplit(page.url).path == f"/matches/{w.mid()}/score", "lands on the scoring page")
            poll(page, lambda: dom(page, "#pen-notice") == "Olga Fernandes is scoring this match. You are viewing it read-only.", "names the holder")
            with http(app_url, w.session("sam")) as sam:
                refused(sam.patch(f"/api/matches/{w.mid()}/viewer-link", json={"on": False}), 404, "NOT_FOUND", what="scorer toggles the link")
                refused(sam.post(f"/api/matches/{w.mid()}/invitations", json={"email": new_email("x")}), 404, "NOT_FOUND", what="scorer invites")
            holder.drop()
            take = page.get_by_role("button", name="Take the pen")
            poll_real(page, lambda: visible(take), "Take the pen appears once the pen lapses")
            take.click()
            holds_pen(page)
            blur(page)
            press_ball(page, ["1"])
    assert w.state()["last_seq"] == 1
    assert {"display_name": "Sam Kapoor"} in get_json(app_url, f"/api/matches/{w.mid()}", w.session())["scorers"]


def test_invitation_mail_and_tokens(browser, app_url, mail):
    w = build(app_url, [match_spec()])
    stranger = new_email("stranger")
    with http(app_url, w.session()) as c:
        answers = {e: c.post(f"/api/matches/{w.mid()}/invitations", json={"email": e}) for e in (w.emails["sam"], stranger)}
    for e, r in answers.items():
        assert (r.status_code, r.json()) == (202, {"message": f"Invitation sent to {e}."})
    found = mails_for(mail, answers)
    for m in found.values():
        assert mail_from_address().lower() in [a.lower() for a in addresses(m.get("From"))]
        assert m.get("Subject") == "Score Kestrels v Herons on Overcall"
        assert f"This invitation works once and expires after {INVITE_TTL_HOURS} hours." in mail_text(m)
    path = invite_link(found[w.emails["sam"]])
    assert path != invite_link(found[stranger])
    with http(app_url, w.session("sam")) as sam:
        assert sam.get(f"/api{path}").json()["status"] == "open"
        r = sam.post(f"/api{path}/accept")
        assert r.status_code == 200 and r.json()["match_id"] == w.mid()
        refused(sam.post(f"/api{path}/accept"), 409, "INVITATION_USED", "This invitation has already been used.", "second accept")
        assert sam.get(f"/api{path}").json()["status"] == "used"
        assert sam.get("/api/invitations/not-a-real-token-0000").status_code == 404
    try:
        set_clock(app_url, SERVER_NOW)
        x = build(app_url, [match_spec()], invitations=[{"key": "i1", "match": "m1", "email": new_email("a"), "sent_at": SENT_AT_EXPIRED},
                                                        {"key": "i2", "match": "m1", "email": new_email("b"), "sent_at": SENT_AT_OPEN}])
        with http(app_url, x.session("sam")) as sam:
            assert sam.get(f"/api/invitations/{x.token('i1')}").json()["status"] == "expired"
            refused(sam.post(f"/api/invitations/{x.token('i1')}/accept"), 409, "INVITATION_EXPIRED", "This invitation has expired.", "at the TTL")
            assert sam.post(f"/api/invitations/{x.token('i2')}/accept").status_code == 200
    finally:
        set_clock(app_url, None)


def test_invitation_rate_limit(browser, app_url, mail):
    try:
        set_clock(app_url, SERVER_NOW)
        w = build(app_url, [match_spec()])
        emails = [new_email(f"r{i}") for i in range(INVITE_RATE_PER_HOUR + 1)]
        with http(app_url, w.session()) as c:
            for e in emails[:-1]:
                assert c.post(f"/api/matches/{w.mid()}/invitations", json={"email": e}).status_code == 202
            refused(c.post(f"/api/matches/{w.mid()}/invitations", json={"email": emails[-1]}), 429, "RATE_LIMITED",
                    "Too many invitations. Try again later.", "one past the limit")
            mails_for(mail, emails[:-1])
            assert all(emails[-1] not in [a.lower() for a in addresses(m.get("To"))] for m in mail.messages())
            set_clock(app_url, LATER_NOW)
            assert c.post(f"/api/matches/{w.mid()}/invitations", json={"email": new_email("late")}).status_code == 202
    finally:
        set_clock(app_url, None)


def test_one_pen_per_match(browser, app_url, valkey):
    w = build(app_url, [match_spec(innings=[kinn([])], scorers=["mira"])])
    msg = {"type": "score", "match": w.mid()}
    with live(browser, app_url, w.session("olga")) as a, live(browser, app_url, w.session("mira")) as b:
        a.send(msg)
        b.send(msg)
        got = [s.wait("(m) => m.type === 'pen'", "pen answer") for s in (a, b)]
        winners = [i for i, g in enumerate(got) if g.get("pen")]
        assert len(winners) == 1, f"exactly one page gets the pen: {got}"
        win, lose = (a, b) if winners[0] == 0 else (b, a)
        pen, holder = got[winners[0]]["pen"], PEOPLE["olga" if winners[0] == 0 else "mira"]
        assert got[1 - winners[0]]["holder"] == holder
        key_name = f"pen:{w.mid()}"
        assert valkey.command("GET", key_name) == pen and 0 <= valkey.ttl(key_name) <= -(-PEN_GRACE_MS // 1000)
        end = time.monotonic() + 3 * PEN_GRACE_MS / 1000
        while time.monotonic() < end:
            assert valkey.command("GET", key_name) == pen, "the pen is renewed while the connection is open"
        body = {"expected_seq": 1, "extra": "none", "runs": 1, "wicket": None}
        with http(app_url, w.session()) as c:
            r = c.post(f"/api/matches/{w.mid()}/deliveries", json=body)
            refused(r, 409, "PEN_HELD", what="no X-Pen")
            assert r.json()["error"]["holder"] == holder
            refused(c.post(f"/api/matches/{w.mid()}/deliveries", json=body, headers={"X-Pen": "not-the-pen"}), 409, "PEN_HELD", what="wrong pen")
            assert c.post(f"/api/matches/{w.mid()}/deliveries", json=body, headers={"X-Pen": pen}).status_code == 201
        start = lose.count()
        win.drop()
        assert valkey.command("GET", key_name) == pen, "the pen is not released at once"
        lose.wait("(m) => m.type === 'pen' && m.pen === null && m.holder === null", "pen-free message",
                  start, PEN_GRACE_MS + WS_WAIT_MS)
        assert valkey.command("GET", key_name) != pen
        start = lose.count()
        lose.send({"type": "take-pen", "match": w.mid()})
        taken = lose.wait("(m) => m.type === 'pen' && m.pen", "take-pen grants the free pen", start)
        assert valkey.command("GET", key_name) == taken["pen"]


def test_read_only_scoring_page(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])], scorers=["mira"])])
    with scoring(browser, w) as s, ui(browser, app_url, f"/matches/{w.mid()}/score", w.session("mira")) as page:
        poll(page, lambda: dom(page, "#pen-notice") == "Olga Fernandes is scoring this match. You are viewing it read-only.", "holder named")
        for name in PAD:
            assert key(page, name).is_disabled(), f"{name} disabled"
        assert page.get_by_role("button", name="Retire batter").is_disabled()
        assert page.get_by_role("button", name="Change delivery 1").is_disabled()
        sent: list = []
        page.on("request", lambda req: sent.append(req.url) if req.method != "GET" and "/deliveries" in req.url else None)
        blur(page)
        page.keyboard.press("2")
        advance(page, 500)
        assert sent == [] and s.state()["last_seq"] == 1, "scoring keys do nothing on a read-only page"
        s.ok("4")
        poll_real(page, lambda: attr(page, "#scoreboard", "data-runs") == "5", "the read-only page updates with no delay")


def test_wf_second_scorer_pen_take_race(browser, app_url, valkey):
    w = build(app_url, [match_spec(innings=[kinn([])], scorers=["mira", "sam"])])
    with live(browser, app_url, w.session(), {"type": "score", "match": w.mid()}) as holder:
        holder.wait("(m) => m.type === 'pen' && m.pen", "organiser holds the pen")
        with ui(browser, app_url, f"/matches/{w.mid()}/score", w.session("mira")) as p1, \
                ui(browser, app_url, f"/matches/{w.mid()}/score", w.session("sam")) as p2:
            for p in (p1, p2):
                poll(p, lambda p=p: dom(p, "#pen-notice", ) == "Olga Fernandes is scoring this match. You are viewing it read-only.", "read-only")
            holder.drop()
            for p in (p1, p2):
                poll_real(p, lambda p=p: dom(p, "#pen-notice") == "No one is scoring this match."
                          and visible(p.get_by_role("button", name="Take the pen")), "pen-free copy and Take the pen")
            for p in (p1, p2):
                p.evaluate("() => { const b = Array.from(document.querySelectorAll('button')).find((e) => e.textContent.trim() === 'Take the pen'); if (b) b.click(); return !!b; }")
            pages = {"mira": p1, "sam": p2}
            poll_real(p1, lambda: sum(enabled(key(p, "Undo")) and dom(p, "#pen-notice") == "" for p in pages.values()) == 1
                      and any(dom(p, "#pen-notice", ) and "is scoring this match" in dom(p, "#pen-notice") for p in pages.values()),
                      "exactly one page holds the pen and the other names it")
            winner = next(who for who, p in pages.items() if enabled(key(p, "Undo")))
            loser = pages["sam" if winner == "mira" else "mira"]
            assert dom(loser, "#pen-notice") == f"{PEOPLE[winner]} is scoring this match. You are viewing it read-only."
            assert valkey.command("GET", f"pen:{w.mid()}")


def test_wf_tournament_table_careers_create(browser, app_url):
    w = build(app_url, teams=("kes", "her", "fal"))
    with ui(browser, app_url, "/tournaments/new", w.session()) as page:
        page.get_by_role("textbox", name="Tournament name").fill("Autumn Cup")
        page.get_by_role("spinbutton", name="Overs per side").fill("5")
        page.get_by_role("spinbutton", name="Players per side").fill("2")
        page.get_by_role("textbox", name="Group name").fill("Group A")
        page.get_by_role("checkbox", name="Kestrels").check()
        page.get_by_role("checkbox", name="Herons").check()
        page.get_by_role("button", name="Add group").click()
        page.get_by_role("button", name="Create tournament").click()
        poll(page, lambda: any(t["name"] == "Autumn Cup" for t in get_json(app_url, "/api/tournaments", w.session())["tournaments"]), "created")
        tid = next(t["id"] for t in get_json(app_url, "/api/tournaments", w.session())["tournaments"] if t["name"] == "Autumn Cup")
        goto_settled(page, f"{app_url}/matches/new")
        choose(page.get_by_role("combobox", name="Home team"), "Kestrels")
        choose(page.get_by_role("combobox", name="Away team"), "Herons")
        choose(page.get_by_role("combobox", name="Tournament"), "Autumn Cup")
        choose(page.get_by_role("combobox", name="Batting first"), "Kestrels")
        for name in ("Kestrels: Arjun Rao", "Kestrels: Kabir Iyer", "Herons: Vik Mehta", "Herons: Sam Pillai"):
            page.get_by_role("checkbox", name=name).check()
        page.get_by_role("button", name="Create match").click()
        poll(page, lambda: len(get_json(app_url, f"/api/tournaments/{tid}", w.session())["groups"][0]["matches"]) == 1, "match in the group")
        goto_settled(page, f"{app_url}/tournaments/{tid}")
        tab = table(page, "Group A")
        assert tab["head"] == ["Team", "P", "W", "L", "T", "Pts", "NRR"]
        assert sorted(r[0] for r in tab["body"]) == ["Herons", "Kestrels"]
    t = get_json(app_url, f"/api/tournaments/{tid}", w.session())
    assert (t["overs"], t["players_per_side"], sorted(r["team"]["name"] for r in t["groups"][0]["table"])) == (5, 2, ["Herons", "Kestrels"])
    body = {"home": w.tid("kes"), "away": w.tid("fal"), "overs": 5, "players_per_side": 2, "super_over": False,
            "batting_first": w.tid("kes"), "tournament": tid,
            "xi": {w.tid("kes"): [w.pid("k1"), w.pid("k2")], w.tid("fal"): [w.pid("f1"), w.pid("f2")]}}
    with http(app_url, w.session()) as c:
        r = c.post("/api/matches", json=body)
    refused(r, 422, "VALIDATION", what="teams in different groups")
    assert r.json()["error"]["fields"]["tournament"] == "Both teams must be in the same group of this tournament."


def test_points_and_order(browser, app_url):
    full = lambda r: (r, 0, 120, False)
    w = build(app_url, [
        match_spec("a", home="osp", away="fal", first="osp", overs=20, pps=11, tournament="t4", summ=summary(full(100), full(90), "osp")),
        match_spec("b", home="kes", away="osp", first="kes", overs=20, pps=11, tournament="t4", summ=summary(full(110), full(100), "kes")),
        match_spec("c", home="fal", away="her", first="fal", overs=20, pps=11, tournament="t4", summ=summary(full(110), full(100), "fal")),
        match_spec("d", home="kes", away="her", first="kes", overs=20, pps=11, tournament="t5", summ=summary(full(100), full(100), None))],
        teams=("kes", "her", "fal", "osp"),
        tournaments=[tournament_spec("t4", [("Group A", ["osp", "fal", "kes", "her"])]),
                     tournament_spec("t5", [("Group A", ["kes", "her", "osp"])])])
    t4 = get_json(app_url, f"/api/tournaments/{w.tour('t4')}", w.session())["groups"][0]["table"]
    assert [(r["team"]["name"], r["pts"]) for r in t4] == [("Kestrels", 2), ("Ospreys", 2), ("Falcons", 2), ("Herons", 0)]
    t5 = get_json(app_url, f"/api/tournaments/{w.tour('t5')}", w.session())["groups"][0]["table"]
    assert [(r["team"]["name"], r["p"], r["t"], r["pts"], r["nrr"]) for r in t5] == [
        ("Herons", 1, 1, 1, "0.000"), ("Kestrels", 1, 1, 1, "0.000"), ("Ospreys", 0, 0, 0, "0.000")]
    with ui(browser, app_url, f"/tournaments/{w.tour('t4')}", w.session()) as page:
        assert [r[0] for r in table(page, "Group A")["body"]] == ["Kestrels", "Ospreys", "Falcons", "Herons"]


def test_net_run_rate(browser, app_url):
    def group_match(key, spec, tour):
        home, away, first, a, b, winner = spec
        return match_spec(key, home=home, away=away, first=first, overs=20, pps=11, tournament=tour, summ=summary(a, b, winner))
    so = [kinn(["1"] * 6), inn("h1", "h2", ["k2"], ["1"] * 6), inn("h1", "h2", ["k1"], ["6"] * 6), kinn(["0"] * 6)]
    w = build(app_url, [group_match(f"g{i}", s, "t1") for i, s in enumerate(E10_GROUP)] + [group_match("one", E10_GROUP[1], "t2"),
              match_spec("so", so, overs=1, super_over=True, tournament="t3")],
              teams=("kes", "her", "fal", "osp"),
              tournaments=[tournament_spec("t1", [("Group A", ["kes", "her", "fal", "osp"])]),
                           tournament_spec("t2", [("Group A", ["osp", "fal"])]),
                           tournament_spec("t3", [("Group A", ["kes", "her"])], overs=1, pps=6, super_over=True)])
    rows = lambda t: [(r["team"]["name"], r["p"], r["w"], r["l"], r["t"], r["pts"], r["nrr"])
                      for r in get_json(app_url, f"/api/tournaments/{w.tour(t)}", w.session())["groups"][0]["table"]]
    assert rows("t1") == E10_TABLE
    assert {r[0]: r[6] for r in rows("t2")} == {"Falcons": "-1.057", "Ospreys": "+1.057"}
    assert {r[0]: (r[5], r[6]) for r in rows("t3")} == {"Herons": (2, "0.000"), "Kestrels": (0, "0.000")}
    with ui(browser, app_url, f"/tournaments/{w.tour('t1')}", w.session()) as page:
        assert [[r[0], r[-1]] for r in table(page, "Group A")["body"]] == [[r[0], r[6]] for r in E10_TABLE]


def test_wf_tournament_table_careers_live_table(browser, app_url):
    herons = [{"ball": "0", "out": "bowled"}] * 8 + ["2"] * 38 + ["1"] * 74
    ospreys = [{"ball": "0", "out": "bowled"}] * 5 + ["2"] * 35 + ["1"] * 78
    live_match = match_spec("live", [inn("h1", "h2", [f"o{(i % 5) + 1}" for i in range(20)], herons),
                                     inn("o1", "o2", [f"h{(i % 5) + 1}" for i in range(20)], ospreys)],
                            home="her", away="osp", first="her", overs=20, pps=11, tournament="t1")
    groups = []
    for i, (home, away, first, a, b, winner) in enumerate(E10_GROUP):
        groups.append(match_spec(f"g{i}", home=home, away=away, first=first, overs=20, pps=11, tournament="t1", summ=summary(a, b, winner)))
    w = build(app_url, groups + [live_match], teams=("kes", "her", "fal", "osp"),
              tournaments=[tournament_spec("t1", [("Group A", ["kes", "her", "fal", "osp"])])])
    shown = lambda page: [[r[0], r[-1]] for r in table(page, "Group A")["body"]]
    expect_rows = lambda rows: [[r[0], r[6]] for r in rows]
    with ui(browser, app_url, f"/tournaments/{w.tour()}", w.session()) as page, scoring(browser, w, "live") as s:
        poll(page, lambda: shown(page) == expect_rows(E10_TABLE), "the table before the result")
        page.evaluate("() => { window.__stay = true; }")
        st = s.ok("6")
        assert st["result"] == E10_LIVE_RESULT
        poll_real(page, lambda: shown(page) == expect_rows(E10_TABLE_AFTER) and dom(page, "#announcer") == "Points table updated.",
                  "the table re-sorts in place with the announcement")
        assert page.evaluate("() => window.__stay === true"), "no reload"
        s.undo()
        poll_real(page, lambda: shown(page) == expect_rows(E10_TABLE), "losing the result restores the table")
    rows = get_json(app_url, f"/api/tournaments/{w.tour()}", w.session())["groups"][0]["table"]
    assert [r["team"]["name"] for r in rows] == [r[0] for r in E10_TABLE]


def test_careers(browser, app_url):
    w = build(app_url, [match_spec(innings=e8(E8_HERONS_24 + E8_HERONS_REST)),
                        match_spec("m2", innings=[kinn(E3, ("h1", "h2")), inn("h1", "h2", ["k2"], ["6"])]),
                        match_spec("m3", innings=[kinn(["6"])])])
    assert w.state("m2")["result"] == "Herons won by 5 wickets (29 balls left)"
    c = get_json(app_url, f"/api/players/{w.pid('k1')}", w.session())
    assert (c["player"]["name"], c["player"]["short_name"], c["player"]["team"]["name"]) == ("Arjun Rao", "Rao", "Kestrels")
    assert strs(c["batting"][k] for k in ("matches", "innings", "not_outs", "runs", "high_score", "average", "strike_rate", "fours", "sixes")) == \
        strs((2, 2, 1, 30, "29*", "30.00", "187.50", 1, 3))
    assert strs(c["bowling"][k] for k in ("overs", "runs", "wickets", "best", "economy")) == strs(("1", 9, 0, "-", "9.00"))
    with ui(browser, app_url, f"/players/{w.pid('k1')}", w.session()) as page:
        poll(page, lambda: page.get_by_role("heading", level=1, name="Arjun Rao").count() == 1, "career h1")
        bat, bowl = table(page, "Batting"), table(page, "Bowling")
        assert dict(zip(bat["head"], bat["body"][0])) == dict(zip(["Mat", "Inns", "NO", "Runs", "HS", "Avg", "SR", "4s", "6s"],
                                                                   strs((2, 2, 1, 30, "29*", "30.00", "187.50", 1, 3))))
        assert dict(zip(bowl["head"], bowl["body"][0])) == dict(zip(["Overs", "Runs", "Wkts", "Best", "Econ"], strs(("1", 9, 0, "-", "9.00"))))


def missing_like(real: Any) -> str:
    s = str(real)
    if s.isdigit():
        return str(int(s) + 987654321)
    return s[:-1] + ("0" if s[-1] != "0" else "1")


def test_private_records(browser, app_url):
    a = build(app_url, [match_spec(innings=[kinn(["1"])], tournament="t1")],
              tournaments=[tournament_spec("t1", [("Group A", ["kes", "her"])], overs=5, pps=6)])
    b = build(app_url, [match_spec(innings=[kinn(["0"])])])
    paths = [("GET", "/api/teams/{}", a.tid()), ("GET", "/api/players/{}", a.pid("k1")), ("GET", "/api/tournaments/{}", a.tour()),
             ("GET", "/api/matches/{}", a.mid()), ("GET", "/api/matches/{}/state", a.mid()), ("GET", "/api/matches/{}/scorecard", a.mid()),
             ("PUT", "/api/matches/{}/deliveries/1", a.mid()), ("POST", "/api/teams/{}/players", a.tid())]
    with http(app_url, b.session(), **{"X-Pen": "not-a-pen"}) as c:
        for method, template, real in paths:
            body = {"extra": "none", "runs": 1} if method == "PUT" else ({"name": "Dev Sen"} if method == "POST" else None)
            other = c.request(method, template.format(real), json=body)
            missing = c.request(method, template.format(missing_like(real)), json=body)
            refused(other, 404, "NOT_FOUND", what=f"{method} {template} as another organiser")
            assert other.json() == missing.json(), f"{template}: body differs from a missing id"
        assert a.tid() not in [t["id"] for t in c.get("/api/teams").json()["teams"]]
    with scoring(browser, b) as s:
        refused(s.change(2, "1"), 404, "NOT_FOUND", what="a seq not in the current innings")
    with ui(browser, app_url, f"/teams/{a.tid()}", b.session()) as page:
        for path in (f"/teams/{a.tid()}", f"/matches/{a.mid()}", f"/tournaments/{a.tour()}", f"/matches/{missing_like(a.mid())}"):
            assert page.goto(app_url + path).status == 404
            poll(page, lambda: page.get_by_role("heading", level=1, name="Not found.").count() == 1, f"{path} shows Not found.")
    with live(browser, app_url, b.session(), {"type": "watch", "match": a.mid()}) as sock:
        sock.wait("(m) => m.type === 'error' && m.code === 'NOT_FOUND'", "a private watch is refused")
        sock.page.wait_for_function("() => window.__closed", timeout=WS_WAIT_MS)


def test_wf_cross_cutting_accounts(browser, app_url):
    email = new_email("signup")
    with ui(browser, app_url, "/signup") as page:
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("textbox", name="Display name").fill("Mira Joshi")
        page.get_by_role("button", name="Create account").click()
        poll(page, lambda: urlsplit(page.url).path == "/matches", "sign-up lands on /matches")
        cookie = next(c["value"] for c in page.context.cookies() if c["name"] == "oc_session")
        assert get_json(app_url, "/api/me", cookie)["user"]["email"] == email
        page.get_by_role("button", name="Sign out").click()
        poll(page, lambda: get_json_status(app_url, "/api/me", cookie) == 401, "sign out ends the session")
        goto_settled(page, app_url + "/signin")
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_label("Password", exact=True).fill(PASSWORD + "x")
        page.get_by_role("button", name="Sign in").click()
        poll(page, lambda: "Email or password is wrong." in page.inner_text("main") if page.get_by_role("main").count() else False, "sign-in failure copy")
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        poll(page, lambda: urlsplit(page.url).path == "/matches", "sign-in lands on /matches")


def test_accounts_api(app_url):
    email = new_email("acct")
    with http(app_url) as c:
        r = c.post("/api/auth/signup", json={"email": email, "password": "x" * 10, "display_name": "Mira Joshi"})
        assert r.status_code == 201 and r.json()["user"]["email"] == email and "oc_session" in r.headers.get("set-cookie", "")
        assert "HttpOnly".lower() in r.headers.get("set-cookie", "").lower()
        r = c.post("/api/auth/signup", json={"email": email.upper(), "password": "x" * 10, "display_name": "Mira Joshi"})
        refused(r, 422, "VALIDATION", what="duplicate email")
        assert r.json()["error"]["fields"]["email"] == "An account with this email already exists."
        r = c.post("/api/auth/signup", json={"email": new_email("short"), "password": "x" * 9, "display_name": "Mira Joshi"})
        assert r.json()["error"]["fields"]["password"] == "Password must be at least 10 characters."
    wrong = httpx.post(app_url + "/api/auth/signin", json={"email": email, "password": "y" * 10}, timeout=HTTP_TIMEOUT)
    unknown = httpx.post(app_url + "/api/auth/signin", json={"email": new_email("nobody"), "password": "y" * 10}, timeout=HTTP_TIMEOUT)
    refused(wrong, 401, "SIGN_IN_FAILED", "Email or password is wrong.", "wrong password")
    assert (unknown.status_code, unknown.json()) == (wrong.status_code, wrong.json())
    ok = httpx.post(app_url + "/api/auth/signin", json={"email": email, "password": "x" * 10}, timeout=HTTP_TIMEOUT)
    session = ok.cookies.get("oc_session")
    assert ok.status_code == 200 and session
    with http(app_url, session) as c:
        assert c.post("/api/auth/signout").status_code == 204
        refused(c.get("/api/me"), 401, "SIGN_IN_REQUIRED", what="after sign-out")


def test_teams_and_players(browser, app_url):
    w = build(app_url)
    with http(app_url, w.session()) as c:
        r = c.post("/api/teams", json={"name": "Kestrels", "players": [{"name": "Arjun Rao"}, {"name": "Kabir Iyer", "short_name": "Iyer"}]})
        assert r.status_code == 201, r.text[:300]
        assert [(p["name"], p["short_name"]) for p in r.json()["players"]] == [("Arjun Rao", "Rao"), ("Kabir Iyer", "Iyer")]
        r = c.post("/api/teams", json={"name": "Herons", "players": [{"name": "Vik Mehta"}, {"name": "Raj Mehta"}]})
        refused(r, 422, "VALIDATION", what="duplicate short name")
        fields = r.json()["error"]["fields"]
        second = [fields.get(f"players[{i}].short_name") for i in (1, 2)]
        assert "Short names must be unique within a team." in second, fields
        r = c.post(f"/api/teams/{w.tid()}/players", json={"name": "Neel Rao", "short_name": "Rao"})
        refused(r, 422, "VALIDATION", what="duplicate short name on an added player")
    with ui(browser, app_url, "/teams/new", w.session()) as page:
        page.get_by_role("textbox", name="Player full name").fill("Dev Sen")
        short = page.get_by_role("textbox", name="Player short name")
        poll(page, lambda: short.input_value() == "Sen", "the short name fills with the last word")


def test_wf_cross_cutting_logo(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn([])])])
    data = png_bytes()
    with ui(browser, app_url, f"/teams/{w.tid()}", w.session()) as page:
        page.get_by_label("Team logo").set_input_files(files=[{"name": "logo.png", "mimeType": "image/png", "buffer": data}])
        button = page.get_by_role("button", name="Upload logo")
        with entered(held(page, "**/api/teams/*/logo")) as gate:
            button.click()
            poll(page, lambda: button.is_disabled() and page.get_by_text("Uploading logo").count() > 0, "pending state")
            assert page.get_by_role("img", name="Kestrels logo").count() == 0, "no logo before storage confirms"
            gate.release()
        poll(page, lambda: page.get_by_role("img", name="Kestrels logo").count() == 1 and dom(page, "#announcer") == "Logo updated.", "the logo shows")
    assert S3().get(f"logos/{w.tid()}/1.png") == data
    with viewer(browser, w) as watch:
        poll(watch, lambda: watch.get_by_role("img", name="Kestrels logo").count() >= 1, "the scoreboard shows the batting team's logo")


def test_logo_api(app_url):
    w = build(app_url, [match_spec()])
    with http(app_url, w.session()) as c:
        assert c.get(f"/api/teams/{w.tid()}/logo").status_code == 404
        up = lambda name, data, kind: c.post(f"/api/teams/{w.tid()}/logo", files={"logo": (name, data, kind)})
        r = up("notes.txt", png_bytes(), "text/plain")
        assert r.status_code == 201 and r.json()["logo_url"], "a PNG is accepted by content, whatever its name"
        got = c.get(f"/api/teams/{w.tid()}/logo")
        assert got.content == png_bytes() and got.headers["content-type"].startswith("image/png")
        assert up("logo.jpg", jpeg_bytes(), "image/jpeg").status_code == 201
        assert set(S3().keys(f"logos/{w.tid()}/")) >= {f"logos/{w.tid()}/1.png", f"logos/{w.tid()}/2.jpg"}
        r = up("logo.png", b"GIF89a not a png", "image/png")
        refused(r, 422, "VALIDATION", what="wrong type")
        assert r.json()["error"]["fields"]["logo"] == "Logo must be a PNG or JPEG image."
        r = up("big.png", png_bytes(LOGO_MAX_BYTES + 1), "image/png")
        assert r.json()["error"]["fields"]["logo"] == "Logo must be 1,048,576 bytes or smaller."
        assert up("max.png", png_bytes(LOGO_MAX_BYTES), "image/png").status_code == 201
    assert httpx.get(f"{app_url}/api/live/{w.code()}/teams/{w.tid()}/logo", timeout=HTTP_TIMEOUT).status_code == 200


def test_logo_storage_outage(browser):
    base = outage("APP_MINIO_DOWN_URL")
    w = build(base)
    copy = "Logo storage is unavailable. The team keeps its previous logo."
    with http(base, w.session()) as c:
        refused(c.post(f"/api/teams/{w.tid()}/logo", files={"logo": ("logo.png", png_bytes(), "image/png")}), 503, "STORAGE_UNAVAILABLE", copy, "upload")
        assert c.get(f"/api/teams/{w.tid()}").json()["logo_url"] is None
    assert S3().keys(f"logos/{w.tid()}/") == []
    with ui(browser, base, f"/teams/{w.tid()}", w.session()) as page:
        page.get_by_label("Team logo").set_input_files(files=[{"name": "logo.png", "mimeType": "image/png", "buffer": png_bytes()}])
        page.get_by_role("button", name="Upload logo").click()
        poll(page, lambda: dom(page, "#alert") == copy, "the outage copy in #alert")


def test_live_updates_outage(browser, valkey):
    base = outage("APP_VALKEY_DOWN_URL")
    w = build(base, [match_spec(innings=[kinn([])])])
    with open_scoring(browser, w) as page:
        poll(page, lambda: dom(page, "#live-status") == "Live updates are paused. Scoring still saves.", "scoring paused copy")
        blur(page)
        press_ball(page, ["1"])
    assert w.state()["last_seq"] == 1 and valkey.command("GET", f"pen:{w.mid()}") is None
    with viewer(browser, w) as watch:
        poll(watch, lambda: dom(watch, "#live-status") == "Live updates are paused. Reload for the latest score.", "viewer paused copy")


def test_invitation_mail_outage(browser, app_url):
    base = outage("APP_MAILPIT_DOWN_URL")
    w = build(base, [match_spec()])
    email, control = new_email("down"), new_email("control")
    copy = "The invitation could not be sent. Try again later."
    with http(base, w.session()) as c:
        refused(c.post(f"/api/matches/{w.mid()}/invitations", json={"email": email}), 503, "MAIL_UNAVAILABLE", copy, "invite")
    p = build(app_url, [match_spec()])
    with http(app_url, p.session()) as c:
        assert c.post(f"/api/matches/{p.mid()}/invitations", json={"email": control}).status_code == 202
    pg = Postgres()
    assert stored_rows(pg, control) >= 1, "control: a sent invitation is found by the scan"
    assert stored_rows(pg, email) == 0, "no invitation is stored on a mail outage"
    with ui(browser, base, f"/matches/{w.mid()}", w.session()) as page:
        page.get_by_role("textbox", name="Scorer email").fill(new_email("ui"))
        page.get_by_role("button", name="Send invitation").click()
        poll(page, lambda: dom(page, "#alert") == copy, "the mail outage copy in #alert")


def test_grading_routes(browser, app_url):
    for key_ in (None, "wrong-key"):
        refused(grading(app_url, "/api/grading/seed", {}, key_), 404, "NOT_FOUND", what="seed without the key")
        refused(grading(app_url, "/api/grading/clock", {"now": None}, key_), 404, "NOT_FOUND", what="clock without the key")
    bad_email = new_email("bad")
    r = grading(app_url, "/api/grading/seed", {"users": [{"key": "olga", "email": bad_email, "display_name": "Olga Fernandes", "password": PASSWORD}],
                                               "teams": [team_spec("kes"), team_spec("her")],
                                               "matches": [match_spec(innings=[kinn(["0", "N1", {"ball": "0", "out": "bowled"}])])]})
    refused(r, 422, "SEED_INVALID", what="bowled on a free hit")
    assert httpx.post(app_url + "/api/auth/signin", json={"email": bad_email, "password": PASSWORD}, timeout=HTTP_TIMEOUT).status_code == 401
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))]), match_spec("m2", innings=[kinn([])])])
    assert len(w.code()) >= VIEWER_CODE_MIN and w.code().isalnum()
    assert get_json(app_url, "/api/me", w.session())["user"]["display_name"] == "Olga Fernandes"
    with scoring(browser, w, "m2") as s:
        for i, token in enumerate(E2):
            if i == 7:
                assert s.over(w.pid("h2")).status_code == 201
            s.ok(token)
    seeded, played = w.state(), w.state("m2")
    for field in ("scoreboard", "run_rate", "this_over", "last_seq"):
        assert seeded[field] == played[field], field
    assert chrono(seeded) == chrono(played) == E2_LINES and batter_texts(seeded) == batter_texts(played)
    try:
        now = set_clock(app_url, SERVER_NOW)["now"]
        diff = (datetime.fromisoformat(now.replace("Z", "+00:00")) - datetime.fromisoformat(SERVER_NOW)).total_seconds()
        assert 0 <= diff < 60
    finally:
        set_clock(app_url, None)


def ws_status(base: str, origin: str) -> bytes:
    parts = urlsplit(base)
    with socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT) as sock:
        sock.sendall((f"GET /ws HTTP/1.1\r\nHost: {parts.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n\r\n").encode())
        return sock.recv(1024).split(b"\r\n", 1)[0]


def test_platform_boundary(app_url):
    instances = {"primary": (app_url, None), "valkey": (outage("APP_VALKEY_DOWN_URL"), "valkey"),
                 "minio": (outage("APP_MINIO_DOWN_URL"), "minio"), "mailpit": (outage("APP_MAILPIT_DOWN_URL"), "mailpit")}
    for name, (base, down) in instances.items():
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
        assert (r.status_code, r.json()) == (200, {"status": "ok"}), name
        services = httpx.get(base + "/api/services", timeout=HTTP_TIMEOUT).json()
        assert services == {s: ("down" if s == down else "up") for s in ("postgres", "valkey", "minio", "mailpit")}, name
    assert get_json(app_url, "/api/config") == CONFIG
    pad_to = lambda n: json.dumps({"email": "a@example.test", "password": "p" * (n - len(json.dumps({"email": "a@example.test", "password": ""})))})
    with http(app_url, **{"Content-Type": "application/json"}) as c:
        assert c.post("/api/auth/signin", content=pad_to(JSON_LIMIT)).status_code != 413
        big = c.post("/api/auth/signin", content=pad_to(JSON_LIMIT + 1))
        refused(big, 413, "PAYLOAD_TOO_LARGE", what="one byte over")
        assert set(big.json()) == {"error"} and set(big.json()["error"]) == {"code", "message"}
        refused(c.post("/api/auth/signin", content="{not json"), 400, "BAD_JSON", what="bad JSON")
    refused(httpx.post(app_url + "/api/auth/signin", content="x", headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT),
            415, "UNSUPPORTED_MEDIA_TYPE", what="text body")
    cors = httpx.get(app_url + "/api/health", headers={"Origin": "http://elsewhere.example"}, timeout=HTTP_TIMEOUT)
    assert not any(h.lower().startswith("access-control-") for h in cors.headers)
    origin = f"{urlsplit(app_url).scheme}://{urlsplit(app_url).netloc}"
    assert b" 101" in ws_status(app_url, origin) and b" 101" not in ws_status(app_url, "http://elsewhere.example")
    html = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT).text
    assets = [html, httpx.get(app_url + "/.env", timeout=HTTP_TIMEOUT).text]
    for src in re.findall(r"""(?:src|href)=["']([^"']+\.(?:js|css))["']""", html):
        if src.startswith("/") and not urlsplit(src).netloc:
            assets.append(httpx.get(app_url + src, timeout=HTTP_TIMEOUT).text)
    assert all(GRADING_KEY not in a for a in assets), "the grading key is served"


def test_page_structure(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])], tournament="t1")],
              tournaments=[tournament_spec("t1", [("Group A", ["kes", "her"])], overs=5, pps=6)],
              invitations=[{"key": "i1", "match": "m1", "email": new_email("inv"), "sent_at": SERVER_NOW}])
    widths = [(320, 800), (375, 812), (390, 844), (768, 1024), (1024, 800), (1280, 800), (1440, 900)]
    public = ["/", "/signin", "/signup", "/follow", f"/live/{w.code()}", f"/live/{w.code()}/scorecard"]
    private = ["/matches", "/matches/new", "/teams", "/teams/new", "/tournaments", "/tournaments/new", "/players",
               f"/matches/{w.mid()}", f"/matches/{w.mid()}/score", f"/matches/{w.mid()}/scorecard", f"/teams/{w.tid()}",
               f"/tournaments/{w.tour()}", f"/players/{w.pid('k1')}", f"/invitations/{w.token()}"]
    for session, paths in ((None, public), (w.session(), private)):
        with ui(browser, app_url, "/api/health", session) as page:
            for path in paths:
                page.goto(app_url + path)
                page.set_viewport_size({"width": 1280, "height": 800})
                poll(page, lambda: page.get_by_role("heading", level=1).count() == 1, f"{path} has exactly one h1")
                assert page.get_by_role("main").count() == 1, path
                assert page.evaluate("() => { const s = document.querySelector('#announcer'), a = document.querySelector('#alert'); return [s && s.getAttribute('role'), s && s.getAttribute('aria-live'), a && a.getAttribute('role')]; }") == ["status", "polite", "alert"], path
                nav = page.get_by_role("navigation", name="Main")
                assert visible(nav) and all(nav.get_by_role("link", name=n).count() == 1 for n in ("Matches", "Teams", "Tournaments")), path
                for width, height in widths:
                    page.set_viewport_size({"width": width, "height": height})
                    layout(page)
                page.set_viewport_size({"width": 375, "height": 812})
                assert visible(page.get_by_role("button", name="Menu")), f"{path} collapses the nav behind Menu"
            if session is None:
                page.goto(app_url + "/")
                page.get_by_role("button", name="Menu").click()
                poll(page, lambda: visible(page.get_by_role("link", name="Matches")), "Menu opens the Main navigation")
            else:
                assert page.goto(f"{app_url}/teams/{missing_like(w.tid())}").status == 404
                poll(page, lambda: page.get_by_role("heading", level=1, name="Not found.").count() == 1, "the not-found h1")


def tap_ball(page: Page, *names: str) -> None:
    before = top_seq(page)
    for name in names:
        tap(key(page, name))
    poll(page, lambda: top_seq(page) > before, f"tapping {names} records a new delivery item in #commentary")


def on_strike(page: Page) -> list:
    return [b["player"] for b in batters(page) if b["strike"] == "true"]


def test_wf_strike_phone_pad_e2_taps(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn([])])])
    ids = {"Rao": str(w.pid("k1")), "Iyer": str(w.pid("k2"))}
    taps = [("1",), ("2",), ("Bye", "1"), ("Wide", "1"), ("3",), ("4",), ("1",)]
    with open_scoring(browser, w, size=(390, 844)) as page:
        for i, names in enumerate(taps):
            tap_ball(page, *names)
            nxt = E2_STRIKERS[i + 1]
            poll(page, lambda nxt=nxt: on_strike(page) == [ids[nxt]], f"after delivery {i + 1} {nxt} is on strike (L586)")
        assert items(page)[0]["line"] == E2_LINES[7]
        dlg = dialog(page, "Next bowler")
        poll(page, lambda: visible(dlg), "Next bowler opens after the sixth legal ball")
        pick(dlg.get_by_role("combobox", name="Bowler"), "Pillai")
        tap(dlg.get_by_role("button", name="Start over"))
        poll(page, lambda: not visible(dlg), "Pillai's over starts")
        tap_ball(page, "0")
        tap_ball(page, "Leg bye", "3")
        poll(page, lambda: dom(page, "#scoreboard") == E2_SCOREBOARD and sorted(b["text"] for b in batters(page)) == sorted(E2_BATTERS),
             "E2's end state (L588)")
        assert chips(page) == ["0", "3lb"]
        poll(page, lambda: dom(page, "#announcer") == f"{E2_LINES[9]}. Kestrels 17/0.", "the last tap is announced (L274)")
    assert chrono(w.state()) == E2_LINES


def test_wf_strike_phone_pad_viewer_phone(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn([])])])
    rao, iyer = str(w.pid("k1")), str(w.pid("k2"))
    steps = [("1", iyer, "0.1 Mehta to Rao, 1 run", "Kestrels 1/0"), ("3", rao, "0.2 Mehta to Iyer, 3 runs", "Kestrels 4/0"),
             ("2", rao, "0.3 Mehta to Rao, 2 runs", "Kestrels 6/0")]
    with viewer(browser, w, size=(390, 844)) as watch, scoring(browser, w) as s:
        poll(watch, lambda: dom(watch, "#scoreboard") == "Kestrels 0/0 (0 ov)", "the viewer loads")
        for token, striker, line, score in steps:
            s.ok(token)
            poll(watch, lambda line=line, score=score: dom(watch, "#announcer") == f"{line}. {score}.", f"the viewer hears {line!r}")
            assert on_strike(watch) == [striker], batters(watch)
        assert sorted(b["text"] for b in batters(watch)) == ["Iyer 3 (1)", "Rao* 3 (2)"]
        layout(watch)
        watch.set_viewport_size({"width": 320, "height": 844})
        layout(watch)


def test_wf_wickets_new_batter_last_wicket_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E3[:6])])])
    brk = "Kestrels 5 all out (1 ov). Herons need 6 runs from 30 balls."
    with open_scoring(browser, w) as page:
        nxt = dialog(page, "Next bowler")
        box = nxt.get_by_role("combobox", name="Bowler")
        poll(page, lambda: visible(nxt) and focused(box), "Next bowler opens with focus on Bowler")
        pick(box, "Pillai")
        nxt.get_by_role("button", name="Start over").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: not visible(nxt), "Pillai's over starts")
        blur(page)
        page.keyboard.press("d")
        page.keyboard.press("w")
        dlg = dialog(page, "Wicket")
        poll(page, lambda: focused(dlg.get_by_role("radio", name="Stumped")), "focus on the first enabled kind, Stumped")
        assert [n for n in HOW_OUT if dlg.get_by_role("radio", name=n).is_enabled()] == ["Stumped", "Run out"]
        dlg.get_by_role("radio", name="Stumped").check()
        poll(page, lambda: dlg.get_by_role("radio", name="Stumped").is_checked(), "Stumped is chosen")
        pick(dlg.get_by_role("combobox", name="Fielder"), "Kurian")
        assert dlg.get_by_role("combobox", name="New batter").count() == 0, "no New batter when the wicket ends the innings"
        dlg.get_by_role("button", name="Record wicket").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: brk in (dom(page, "#innings-break") or ""), "the innings ends all out with the break text")
        poll(page, lambda: dom(page, "#announcer") == f"{E3_LINES[-1]}. Kestrels 5/5. {brk}", "the announcement carries the break text (L274)")
    st = w.state()
    assert (st["match"]["status"], balls(st)[-1]["line"], balls(st)[-1]["wicket"], balls(st)[-1]["extra"]) == (
        "innings_break", E3_LINES[-1], "stumped", "wide")


def test_wf_free_hit_run_out_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0", "N1"])])])
    line = "0.2 Mehta to Iyer, 1 run, OUT! run out (Gill) (free hit)"
    with open_scoring(browser, w) as page:
        poll(page, lambda: dom(page, "#free-hit") == "FREE HIT", "the seeded no-ball leaves a free hit")
        blur(page)
        page.keyboard.press("w")
        dlg = dialog(page, "Wicket")
        poll(page, lambda: focused(dlg.get_by_role("radio", name="Run out")), "focus on Run out, the only kind on a free hit")
        dlg.get_by_role("radio", name="Run out").check()
        pick(dlg.get_by_role("combobox", name="Fielder"), "Gill")
        out = dlg.get_by_role("radiogroup", name="Batter out").get_by_role("radio", name="Iyer")
        out.check()
        poll(page, lambda: out.is_checked(), "Iyer chosen as the batter out")
        choose(dlg.get_by_role("combobox", name="Runs completed"), "1")
        pick(dlg.get_by_role("combobox", name="New batter"), "Sen")
        dlg.get_by_role("button", name="Record wicket").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: items(page)[0]["line"] == line, "the free-hit run out line")
        assert (items(page)[0]["freeHit"], items(page)[0]["wicket"]) == ("true", "run-out")
        poll(page, lambda: dom(page, "#free-hit") is None and sorted(b["text"] for b in batters(page)) == ["Rao* 1 (2)", "Sen 0 (0)"],
             "badge gone; Sen at the non-striker's end and Rao on strike (L619)")
        poll(page, lambda: dom(page, "#announcer") == f"{line}. Kestrels 3/1.", "the run out is announced (L274)")
    assert w.card()["innings"][0]["fall_of_wickets"] == "Fall of wickets: 1-3 (Iyer, 0.2)"


def test_wf_free_hit_carry_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0"])])])
    expect = [(["n", "0"], "0.2 Mehta to Rao, no-ball, no run", "false", True),
              (["n", "0"], "0.2 Mehta to Rao, no-ball, no run (free hit)", "true", True),
              (["d", "0"], "0.2 Mehta to Rao, 1 wide (free hit)", "true", True),
              (["1"], "0.2 Mehta to Rao, 1 run (free hit)", "true", False),
              (["0"], "0.3 Mehta to Iyer, no run", "false", False)]
    with open_scoring(browser, w) as page:
        blur(page)
        for keys, line, flag, badge in expect:
            press_ball(page, keys)
            item = items(page)[0]
            assert (item["line"], item["freeHit"]) == (line, flag), item
            poll(page, lambda badge=badge: (dom(page, "#free-hit") == "FREE HIT") == badge, f"FREE HIT {'shown' if badge else 'gone'} after {line!r}")
        poll(page, lambda: dom(page, "#announcer") == "0.3 Mehta to Iyer, no run. Kestrels 4/0.", "the last ball is announced")
        assert chips(page) == ["0", "1nb", "1nb", "1wd", "1", "0"]
        assert sorted(b["text"] for b in batters(page)) == ["Iyer* 0 (1)", "Rao 1 (4)"]


def test_wf_free_hit_viewer_announcements(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0", "N1"])])])
    wide, four = "0.2 Mehta to Iyer, 1 wide (free hit)", "0.2 Mehta to Iyer, FOUR (free hit)"
    with viewer(browser, w) as watch, scoring(browser, w) as s:
        poll(watch, lambda: dom(watch, "#free-hit") == "FREE HIT", "the viewer loads with the free hit pending")
        s.ok("D0")
        poll(watch, lambda: dom(watch, "#announcer") == f"{wide}. Kestrels 3/0.", "the free-hit wide is announced")
        assert dom(watch, "#free-hit") == "FREE HIT" and items(watch)[0]["freeHit"] == "true"
        s.ok("4")
        poll(watch, lambda: dom(watch, "#announcer") == f"{four}. Kestrels 7/0.", "the free-hit four is announced")
        assert dom(watch, "#free-hit") is None
        assert [(i["line"], i["freeHit"]) for i in items(watch)[:2]] == [(four, "true"), (wide, "true")]
        assert chips(watch) == ["0", "2nb", "1wd", "4"]


def test_wf_bowler_limits_phone(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E5, ("h1", "h2", "h1", "h2"))], overs=6)])
    with open_scoring(browser, w, size=(390, 844)) as page:
        dlg = dialog(page, "Next bowler")
        box = dlg.get_by_role("combobox", name="Bowler")
        poll(page, lambda: visible(dlg), "Next bowler opens by itself")
        for short, copy in (("Pillai", "Pillai bowled the last over."), ("Mehta", "Mehta has bowled 2 of 2 overs.")):
            pick(box, short)
            tap(dlg.get_by_role("button", name="Start over"))
            poll(page, lambda copy=copy: dom(page, "#alert") == copy and copy in dlg.inner_text() and visible(dlg),
                 f"{copy!r} in the dialog and #alert, the dialog stays open")
        pick(box, "Nair")
        tap(dlg.get_by_role("button", name="Start over"))
        poll(page, lambda: not visible(dlg), "Nair's over starts")
        tap_ball(page, "1")
        poll(page, lambda: items(page)[0]["line"] == "4.1 Nair to Rao, 1 run" and dom(page, "#bowler") == "Nair 0.1-0-1-0",
             "Nair's first ball and figures")


def test_wf_bowler_limits_maiden_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E5, ("h1", "h2", "h1", "h2"))], overs=6)])
    with open_scoring(browser, w) as page:
        dlg = dialog(page, "Next bowler")
        box = dlg.get_by_role("combobox", name="Bowler")
        poll(page, lambda: visible(dlg) and focused(box), "Next bowler opens with focus on Bowler")
        pick(box, "Nair")
        dlg.get_by_role("button", name="Start over").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: not visible(dlg), "Nair's over starts")
        blur(page)
        for _ in range(6):
            press_ball(page, ["0"])
        over_end = "End of over 5: 0 runs. Kestrels 18/0"
        poll(page, lambda: dom(page, "#announcer") == "4.6 Nair to Rao, no run. Kestrels 18/0. End of over 5: 0 runs.",
             "the maiden's over-end announcement (L274)")
        figures = "-".join(("1", "1", "0", "0"))
        assert items(page)[0]["line"] == over_end and dom(page, "#bowler") == f"Nair {figures}"
        poll(page, lambda: visible(dlg), "Next bowler opens for over 6")
        assert [option(dlg, box, n).get_attribute("data-barred") for n in ("Mehta", "Pillai", "Nair", "Gill")] == [
            "limit", "limit", "consecutive", "none"]
    with ui(browser, app_url, f"/matches/{w.mid()}/scorecard", w.session()) as card:
        assert table(card, "Bowling")["body"] == [list(strs(r)) for r in E5_BOWLING] + [["Jai Nair", "1", "1", "0", "0", "0", "0", "0.00"]]


def test_wf_change_delivery_live_viewer_phone(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))])])
    with viewer(browser, w, size=(390, 844), init=[WS_HOOK]) as watch, scoring(browser, w) as s:
        poll(watch, lambda: dom(watch, "#scoreboard") == E2_SCOREBOARD, "the viewer loads E2")
        events = lambda: watch.evaluate("() => window.__live.filter((m) => m.type === 'state').length")
        before = events()
        assert s.change(4, "N1").status_code == 200
        poll_real(watch, lambda: events() > before, "the change arrives on the live connection")
        assert dom(watch, "#notice") != "The scorer changed delivery 4.", "nothing shows before LIVE_DELAY_MS (L685)"
        poll(watch, lambda: dom(watch, "#notice") == "The scorer changed delivery 4.", "the change notice after the delay")
        seq = {i["seq"]: i for i in items(watch) if i["kind"] == "delivery"}
        assert (seq["4"]["line"], seq["4"]["extra"], seq["5"]["line"], seq["5"]["freeHit"]) == (
            "0.4 Mehta to Rao, no-ball, 1 run", "no-ball", "0.4 Mehta to Iyer, 3 runs (free hit)", "true")
        assert dom(watch, "#scoreboard") == E2_SCOREBOARD
        assert "The scorer changed delivery 4." in (dom(watch, "#announcer") or "")
        layout(watch)


def test_wf_change_delivery_live_scorecard_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))])])
    with open_scoring(browser, w) as page:
        page.get_by_role("button", name="Change delivery 2").focus()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Change delivery 2")
        poll(page, lambda: visible(dlg), "the change dialog opens")
        page.keyboard.press("1")
        poll(page, lambda: dom(page, "#change-preview") == "New: 1 run", "1 picks 1 run")
        dlg.get_by_role("button", name="Save change").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: not visible(dlg) and dom(page, "#announcer") == "Delivery 2 changed. Innings recalculated.", "saved and announced")
        got = {i["seq"]: i for i in items(page) if i["kind"] == "delivery"}
        assert [got[str(n)]["line"] for n in (3, 5, 8, 9)] == [E6_LINES[2], E6_LINES[4], E6_LINES[8], E6_LINES[9]]
        assert got["9"]["striker"] == str(w.pid("k2")), "the later strike flipped to Iyer"
    with ui(browser, app_url, f"/matches/{w.mid()}/scorecard", w.session()) as card:
        assert table(card, "Batting")["body"][:2] == [["Arjun Rao", "not out", "4", "3", "0", "0", "133.33"],
                                                     ["Kabir Iyer", "not out", "6", "5", "1", "0", "120.00"]]
        assert table(card, "Bowling")["body"][0] == ["Vik Mehta", "1", "0", "12", "0", "1", "0", "12.00"]


def test_wf_undo_live_over_start_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1, ("h1", "h2"))])])
    with open_scoring(browser, w) as page:
        poll(page, lambda: attr(page, "#scoreboard", "data-runs") == "20", "the page loads E1")
        blur(page)
        page.keyboard.press("u")
        poll(page, lambda: dom(page, "#announcer") == "Undid delivery 9." and dom(page, "#scoreboard") == "Kestrels 18/0 (0.5 ov)",
             "the undo is announced and the innings replayed (L648)")
        assert (items(page)[0]["seq"], items(page)[0]["line"]) == ("8", E1_ROWS[7][2])
        figures = "-".join(("0.5", "0", "15", "0"))
        assert sorted(b["text"] for b in batters(page)) == ["Iyer* 4 (3)", "Rao 7 (3)"] and dom(page, "#bowler") == f"Mehta {figures}"
        assert chips(page) == [r[8] for r in E1_ROWS[:8]] and not visible(dialog(page, "Next bowler"))
    st = w.state()
    assert (st["last_seq"], st["bowler"]["player"], st["next_bowler_needed"]) == (8, w.pid("h1"), False)


def test_wf_undo_live_phone_run_out(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E3[:5])])])
    with viewer(browser, w) as watch, open_scoring(browser, w, size=(390, 844)) as page:
        poll(watch, lambda: dom(watch, "#scoreboard") == "Kestrels 4/3 (0.5 ov)", "the viewer loads after the run out")
        tap(key(page, "Undo"))
        poll(page, lambda: dom(page, "#announcer") == "Undid delivery 5." and sorted(b["text"] for b in batters(page)) == ["Bose* 2 (1)", "Rao 1 (1)"],
             "the run out is undone on the scorer page (L647)")
        poll(watch, lambda: dom(watch, "#notice") == "The scorer undid delivery 5." and dom(watch, "#scoreboard") == "Kestrels 3/2 (0.4 ov)",
             "the viewer shows the undo after the delay")
        assert sorted(b["text"] for b in batters(watch)) == ["Bose* 2 (1)", "Rao 1 (1)"]
    st = w.state()
    assert w.pid("k5") in [p["player"] for p in st["yet_to_bat"]]
    assert w.card()["innings"][0]["fall_of_wickets"] == "Fall of wickets: 1-1 (Iyer, 0.2), 2-1 (Sen, 0.3)"


def test_wf_undo_live_after_result(browser, app_url):
    w = build(app_url, [match_spec(innings=e8(E8_HERONS_24 + E8_HERONS_REST))])
    with viewer(browser, w) as watch, open_scoring(browser, w) as page:
        for p in (page, watch):
            poll(p, lambda p=p: dom(p, "#result") == E8_RESULT, "the result shows")
        assert key(page, "1").is_disabled() and key(page, "Undo").is_enabled(), "after the result only Undo works (L217)"
        blur(page)
        page.keyboard.press("u")
        poll(page, lambda: dom(page, "#result") is None and dom(page, "#chase") == "Need 1 from 8 balls. Required rate 0.75"
             and dom(page, "#announcer") == "Undid delivery 24.", "the result is cleared and the chase is back (L650)")
        assert enabled(key(page, "1"))
        poll(watch, lambda: dom(watch, "#result") is None and dom(watch, "#notice") == "The scorer undid delivery 24."
             and dom(watch, "#scoreboard") == "Herons 52/1 (3.4 ov)", "the viewer loses the result after the delay")


def test_wf_innings_break_chase_viewer_phone(browser, app_url):
    w = build(app_url, [match_spec(innings=e8(E8_HERONS_24, ("k1", "k2", "k3")))])
    steps = [("4", "2.5 Sen to Pillai, FOUR. Herons 35/0.", "Need 18 from 13 balls. Required rate 8.31", "Run rate 12.35"),
             ("2", "2.6 Sen to Pillai, 2 runs. Herons 37/0. End of over 3: 12 runs.", "Need 16 from 12 balls. Required rate 8.00",
              "Run rate 12.33"),
             ("D0", "3.1 Bose to Mehta, 1 wide. Herons 38/0.", "Need 15 from 12 balls. Required rate 7.50", "Run rate 12.67")]
    with viewer(browser, w, size=(390, 844)) as watch, scoring(browser, w) as s:
        poll(watch, lambda: dom(watch, "#chase") == E8_AT_24[2] and dom(watch, "#run-rate") == E8_AT_24[1], "the viewer loads at 2.4")
        for i, (token, announce, chase, rate) in enumerate(steps):
            if i == 2:
                assert s.over(w.pid("k4")).status_code == 201
            s.ok(token)
            poll(watch, lambda announce=announce: dom(watch, "#announcer") == announce, f"the viewer hears {announce!r}")
            assert (dom(watch, "#chase"), dom(watch, "#run-rate")) == (chase, rate)
        layout(watch)


def test_wf_super_over_viewer_phone(browser, app_url):
    w = build(app_url, [match_spec(innings=tied_main() + [inn("h1", "h2", ["k1"], E9_HERONS)], overs=1, super_over=True)])
    brk = "Herons 14 all out (1 ov). Kestrels need 15 runs from 6 balls."
    with viewer(browser, w, size=(390, 844)) as watch:
        poll(watch, lambda: brk in (dom(watch, "#innings-break") or "") and "Super over 1" in (dom(watch, "#innings-break") or ""),
             "the break between the super-over halves")
        with scoring(browser, w) as s:
            assert s.start(w.pid("k1"), w.pid("k2"), w.pid("h1")).status_code == 201
            s.ok("6")
            poll(watch, lambda: dom(watch, "#announcer") == f"{E9_KESTRELS_LINES[0]}. Kestrels 6/0.", "the first super-over ball is announced")
            assert (dom(watch, "#chase"), attr(watch, "#scoreboard", "data-innings"), dom(watch, "#innings-break")) == (
                "Need 9 from 5 balls. Required rate 10.80", "so1-2", None)
        layout(watch)


def test_wf_super_over_two_wickets_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=tied_main(), overs=1, super_over=True)])
    brk = "Herons 0 all out (0.2 ov). Kestrels need 1 run from 6 balls."
    with open_scoring(browser, w) as page:
        page.get_by_role("button", name="Start super over").focus()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Start innings")
        poll(page, lambda: focused(dlg.get_by_role("combobox", name="Striker", exact=True)), "focus starts on Striker")
        pick(dlg.get_by_role("combobox", name="Striker", exact=True), "Mehta")
        pick(dlg.get_by_role("combobox", name="Non-striker"), "Pillai")
        pick(dlg.get_by_role("combobox", name="Bowler"), "Rao")
        dlg.get_by_role("button", name="Start innings").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: not visible(dlg) and enabled(key(page, "0")), "the super over starts")
        wk = dialog(page, "Wicket")
        for n, new in ((1, "Nair"), (2, None)):
            blur(page)
            page.keyboard.press("w")
            poll(page, lambda: focused(wk.get_by_role("radio", name="Bowled")), "focus on Bowled")
            page.keyboard.press("ArrowDown")
            page.keyboard.press("ArrowUp")
            poll(page, lambda: wk.get_by_role("radio", name="Bowled").is_checked(), "the arrow keys select Bowled")
            box = wk.get_by_role("combobox", name="New batter")
            if new:
                pick(box, new)
            else:
                assert box.count() == 0, "the second wicket ends the half, so New batter is absent"
            wk.get_by_role("button", name="Record wicket").focus()
            page.keyboard.press("Enter")
            if n == 1:
                poll(page, lambda: not visible(wk) and attr(page, "#scoreboard", "data-wickets") == "1", "the first wicket is recorded")
        poll(page, lambda: brk in (dom(page, "#innings-break") or "") and "Super over 1" in (dom(page, "#innings-break") or ""),
             "the half ends at 2 wickets")
        poll(page, lambda: dom(page, "#announcer") == f"0.2 Rao to Nair, OUT! b Rao. Herons 0/2. {brk}", "the announcement carries the break text")
    assert w.state()["match"]["status"] == "super_over_break"


def test_wf_super_over_scorecard_and_careers(browser, app_url):
    w = build(app_url, [match_spec(innings=tied_main() + [inn("h1", "h2", ["k1"], E9_HERONS), inn("k1", "k2", ["h1"], E9_KESTRELS)],
                                   overs=1, super_over=True)])
    assert w.state()["result"] == "Kestrels won the super over"
    with ui(browser, app_url, f"/matches/{w.mid()}/scorecard", w.session()) as card:
        for name in ("Kestrels innings", "Herons innings", "Super over 1: Herons", "Super over 1: Kestrels"):
            poll(card, lambda name=name: card.get_by_role("heading", name=name).count() == 1, f"section {name!r}")
        totals = card.evaluate("() => Array.from(document.querySelectorAll('.total')).map((e) => e.textContent.replace(/\\s+/g, ' ').trim())")
        assert totals == ["Total 6/0 (1 ov)", "Total 6/0 (1 ov)", "Total 14 all out (1 ov)", "Total 15/0 (0.5 ov)"]
        assert dom(card, "#result") == "Kestrels won the super over"
        card.goto(f"{app_url}/players/{w.pid('k1')}")
        bat = table(card, "Batting")
        assert dict(zip(bat["head"], bat["body"][0])) == dict(zip(["Mat", "Inns", "NO", "Runs", "HS", "Avg", "SR", "4s", "6s"],
                                                                   strs((1, 1, 1, 3, "3*", "-", "100.00", 0, 0))))


def test_wf_second_scorer_pen_phone(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])], scorers=["mira"])])
    with live(browser, app_url, w.session(), {"type": "score", "match": w.mid()}) as holder:
        pen = holder.wait("(m) => m.type === 'pen' && m.pen", "the organiser holds the pen")["pen"]
        s = Scoring(app_url, w.session(), w.mid(), pen)
        with ui(browser, app_url, f"/matches/{w.mid()}/score", w.session("mira"), size=(390, 844)) as page:
            poll(page, lambda: dom(page, "#pen-notice") == "Olga Fernandes is scoring this match. You are viewing it read-only.", "the holder is named")
            assert all(key(page, n).is_disabled() for n in PAD)
            s.ok("2")
            poll_real(page, lambda: dom(page, "#scoreboard") == "Kestrels 3/0 (0.2 ov)", "the holder's ball shows with no delay (L213)")
            holder.drop()
            take = page.get_by_role("button", name="Take the pen")
            poll_real(page, lambda: dom(page, "#pen-notice") == "No one is scoring this match." and visible(take), "the pen is free")
            tap(take)
            holds_pen(page)
            tap_ball(page, "4")
            poll(page, lambda: dom(page, "#announcer") == "0.3 Mehta to Iyer, FOUR. Kestrels 7/0.", "Mira's tapped four is announced")
    assert w.state()["last_seq"] == 3


def test_wf_second_scorer_pen_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])], scorers=["mira"])])
    with live(browser, app_url, w.session(), {"type": "score", "match": w.mid()}) as holder:
        holder.wait("(m) => m.type === 'pen' && m.pen", "the organiser holds the pen")
        with ui(browser, app_url, f"/matches/{w.mid()}/score", w.session("mira")) as page:
            poll(page, lambda: dom(page, "#pen-notice") == "Olga Fernandes is scoring this match. You are viewing it read-only.", "read-only")
            blur(page)
            page.keyboard.press("4")
            advance(page, 500)
            assert w.state()["last_seq"] == 1, "scoring keys do nothing on a read-only page"
            holder.drop()
            take = page.get_by_role("button", name="Take the pen")
            poll_real(page, lambda: visible(take), "Take the pen appears once the pen lapses")
            take.focus()
            page.keyboard.press("Enter")
            holds_pen(page)
            blur(page)
            press_ball(page, ["6"])
            poll(page, lambda: dom(page, "#announcer") == "0.2 Mehta to Iyer, SIX. Kestrels 7/0.", "Mira's six by keyboard is announced")
            with ui(browser, app_url, f"/matches/{w.mid()}/score", w.session()) as org:
                poll(org, lambda: dom(org, "#pen-notice") == "Mira Joshi is scoring this match. You are viewing it read-only.",
                     "the organiser's page is read-only and names Mira")
                assert key(org, "Undo").is_disabled()


def test_wf_free_hit_dialog_focus_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["0", "N1"])])])
    with open_scoring(browser, w) as page:
        poll(page, lambda: dom(page, "#free-hit") == "FREE HIT", "the seeded no-ball leaves a free hit")
        blur(page)
        page.keyboard.press("w")
        dlg = dialog(page, "Wicket")
        poll(page, lambda: focused(dlg.get_by_role("radio", name="Run out")), "focus on Run out, the only kind on a free hit")
        assert FREE_HIT_COPY in dlg.inner_text()
        for name in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(name)
            assert dlg.evaluate(JS_IN_DIALOG), f"{name} left the open Wicket dialog (L203)"
        page.keyboard.press("Escape")
        poll(page, lambda: not visible(dlg) and focused(key(page, "0")),
             "Escape closes it and focus goes to the pad's 0, since the page body had focus (L203)")


def test_wf_bowler_limits_dialog_focus_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E1[:-1])])])
    with open_scoring(browser, w) as page:
        dlg = dialog(page, "Next bowler")
        box = dlg.get_by_role("combobox", name="Bowler")
        blur(page)
        press_ball(page, ["2"])
        poll(page, lambda: visible(dlg) and focused(box), "Next bowler opens by itself with focus on Bowler (L206)")
        for name in ["Tab"] * 4 + ["Shift+Tab"] * 4:
            page.keyboard.press(name)
            assert dlg.evaluate(JS_IN_DIALOG), f"{name} left the open Next bowler dialog (L203)"
        pick(box, "Pillai")
        dlg.get_by_role("button", name="Start over").focus()
        page.keyboard.press("Enter")
        poll(page, lambda: not visible(dlg) and focused(key(page, "0")),
             "Enter on Start over closes it and focus goes to the pad's 0, since the page body had focus (L203)")
    assert w.state()["bowler"]["player"] == w.pid("h2")


def test_wf_change_delivery_live_dialog_focus_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(E2, ("h1", "h2"))])])
    before = w.state()
    with open_scoring(browser, w) as page:
        opener = page.get_by_role("button", name="Change delivery 2")
        opener.focus()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Change delivery 2")
        poll(page, lambda: visible(dlg), "the change dialog opens")
        for name in ["Tab"] * 14 + ["Shift+Tab"] * 14:
            page.keyboard.press(name)
            assert dlg.evaluate(JS_IN_DIALOG), f"{name} left the open Change delivery dialog (L203)"
        page.keyboard.press("Escape")
        poll(page, lambda: not visible(dlg) and focused(opener), "Escape closes it and focus returns to Change delivery 2 (L203)")
    assert w.state() == before, "Escape saves nothing (L203)"


def test_wf_tournament_table_careers_unknown_ids(browser, app_url):
    w = build(app_url, tournaments=[tournament_spec("t1", [("Group A", ["kes", "her"])], overs=5, pps=6)])
    with ui(browser, app_url, f"/tournaments/{w.tour()}", w.session()) as page:
        table(page, "Group A")
        for path in ("/tournaments/nope", "/teams/nope", "/players/nope"):
            assert page.goto(app_url + path).status == 404, f"{path} (L119)"
            poll(page, lambda: page.get_by_role("heading", level=1, name="Not found.").count() == 1, f"{path} shows the not-found h1 (L119)")
    with http(app_url, w.session()) as c:
        for path in ("/api/tournaments/nope", "/api/teams/nope", "/api/players/nope"):
            refused(c.get(path), 404, "NOT_FOUND", what=f"{path} (L355)")


def test_wf_innings_break_chase_dialog_focus_keyboard(browser, app_url):
    w = build(app_url, [match_spec(innings=[inn("k1", "k2", ["h1", "h2", "h3", "h4", "h5"], E8_KESTRELS)])])
    with open_scoring(browser, w) as page:
        start = page.get_by_role("button", name="Start second innings")
        poll(page, lambda: visible(start), "Start second innings shows at the break (L217)")
        start.focus()
        page.keyboard.press("Enter")
        dlg = dialog(page, "Start innings")
        poll(page, lambda: focused(dlg.get_by_role("combobox", name="Striker", exact=True)), "focus starts on Striker (L208)")
        for name in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(name)
            assert dlg.evaluate(JS_IN_DIALOG), f"{name} left the open Start innings dialog (L203)"
        page.keyboard.press("Escape")
        poll(page, lambda: not visible(dlg) and focused(start), "Escape closes it and focus returns to Start second innings (L203)")
    assert w.state()["match"]["status"] == "innings_break", "Escape starts nothing"


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing[:20]}"
    assert "Dela Gothic One" in notices and "DM Sans" in notices


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"packages outside the allowlist: {bad[:20]}"


def test_if_services_only():
    other = {"sqlite3", "better-sqlite3", "sql.js", "nedb", "@seald-io/nedb", "lowdb", "level", "classic-level", "leveldown",
             "mongodb", "mongoose", "mysql", "mysql2", "tedious", "oracledb", "kafkajs", "amqplib", "pouchdb", "lmdb", "@libsql/client"}
    assert not [p.name for p in shipped_packages() if p.name in other]
    files = [f for f in Path(DEPLOYED_APP).rglob("*") if "node_modules" not in f.parts and f.suffix in {".sqlite", ".sqlite3", ".db"}]
    assert not files, f"embedded database files: {files[:5]}"


def test_if_typescript_lockfile():
    assert Path("/app/package-lock.json").is_file()
    ts = [f for f in Path("/app").rglob("*.ts") if "node_modules" not in f.parts and not f.name.endswith(".d.ts")]
    assert ts, "no TypeScript source under /app"
    assert Path("/app/package-lock.json").stat().st_size > 0


def test_if_no_remote_loads(browser, app_url):
    w = build(app_url, [match_spec(innings=[kinn(["1"])])])
    for path, session in (("/", None), (f"/matches/{w.mid()}/score", w.session()), (f"/live/{w.code()}", None)):
        with ui(browser, app_url, "/api/health", session) as page:
            urls: list = []
            page.on("request", lambda req: urls.append(req.url))
            page.goto(app_url + path)
            poll(page, lambda: page.get_by_role("heading", level=1).count() == 1, f"{path} renders")
            foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
            assert not foreign, f"{path} loaded {foreign[:5]}"
            assert page.evaluate("async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0") == 0
