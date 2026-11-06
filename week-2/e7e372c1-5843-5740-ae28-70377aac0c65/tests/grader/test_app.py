from __future__ import annotations

import contextlib
import hashlib
import hmac
import http.server
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as dtime, timedelta, timezone
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal, getcontext
from pathlib import Path
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (DEPLOYED_APP, S3, Postgres, advance, check, click, fill, layout,
                      licence_allowed, open_app, select, shipped_packages, tap, until)

getcontext().prec = 80

NY = __import__("zoneinfo").ZoneInfo("America/New_York")
PASSWORD = "tracewell-rehearsal-26"
STAFF = {
    "tamsin": ("Tamsin Okafor", "tamsin.okafor@vellichor.example"),
    "imre": ("Imre Castellanos", "imre.castellanos@vellichor.example"),
    "rafe": ("Rafe Lindqvist", "rafe.lindqvist@vellichor.example"),
    "wren": ("Wren Adeyemi", "wren.adeyemi@vellichor.example"),
    "noor": ("Noor Halvorsen", "noor.halvorsen@vellichor.example"),
    "basil": ("Basil Ferreira", "basil.ferreira@vellichor.example"),
}
ROW_LABELS = {
    "beginning-balance": "Beginning ETH balance",
    "eth-acquired": "ETH acquired",
    "staking-rewards": "Staking rewards",
    "ending-balance": "Ending ETH balance",
    "cumulative-staking-rewards": "Cumulative staking rewards",
    "diluted-shares": "Assumed diluted shares",
}
ROW_KEYS = list(ROW_LABELS)
FIGURES = {
    "eth-held": "Total ETH held",
    "staking-rewards": "Cumulative staking rewards",
    "eth-per-1000-diluted": "ETH per 1,000 diluted shares",
    "mnav": "mNAV",
}
BADGES = {"holdings": "Holdings week", "equity": "Equity", "eth": "ETH live"}
EVENT_LABELS = {"atm_settlement": "ATM settlement", "warrant_exercise": "Warrant exercise", "buyback": "Buyback"}
OPEN_STATES = {"draft", "in_review", "returned", "cleared", "queued"}
SEED_REASON = "Staking rewards understated by 10 ETH; the validator reward export omitted epochs for 2026-10-17."
SEED = {
    "0002093117-26-000041": ("2026-10-11", "published", 7, "2026-10-12T17:30:05-04:00"),
    "0002093117-26-000044": ("2026-10-18", "superseded", 8, "2026-10-19T17:30:05-04:00"),
    "0002093117-26-000046": ("2026-10-18", "published", 7, "2026-10-21T18:00:05-04:00"),
    "0002093117-26-000049": ("2026-10-25", "published", 7, "2026-10-26T17:30:05-04:00"),
}
SEED_TRAIL = [("create", "Tamsin Okafor", None, "draft"), ("edit", "Tamsin Okafor", "draft", "draft"),
              ("exhibit_pending", "Tamsin Okafor", "draft", "draft"), ("exhibit_verified", "Tamsin Okafor", "draft", "draft"),
              ("submit", "Tamsin Okafor", "draft", "in_review"), ("clear", "Rafe Lindqvist", "in_review", "cleared"),
              ("publish", "Noor Halvorsen", "cleared", "published")]
TAPE_ETH = ["3418.27", "3419.05", "3417.62", "3420.88", "3421.40", "3419.96", "3418.73", "3417.15"]
TAPE_VLCH = ["14.81", "14.84", "14.79", "14.86"]
FOOTER = "Figures are preliminary and unaudited. Each figure links to the filing it comes from; where they differ, the filing controls."
VAULT_NOTICE = "Filing vault unavailable — exhibits are temporarily unavailable. Figures shown are unchanged."
VAULT_DOWNLOAD = "Filing vault unavailable — this exhibit cannot be downloaded right now. Figures shown are unchanged."
UNEXPECTED = "Something went wrong. Nothing was changed."
REFRESH_FAILED = "Figures could not be refreshed. Showing the last loaded figures."
VAULT_UPLOAD = "Filing vault unavailable — the exhibit was not stored. Try again when the vault is back."
NOT_CLEARED = "This restatement is no longer cleared. Refresh to see its current state."
TWO_PERSON = "You prepared or cleared this restatement, so another disclosure officer must release it."
UNCONFIRMED = "The release could not be confirmed. Press Release to try again; it will not be released twice."
CANNOT_CHANGE = "This field cannot be changed here."
VAULT_BODY = {"error": {"code": "vault_unavailable", "message": "Filing vault unavailable."}}
OPENING_SHARES = 148250000
DILUTED_TIE = 160000000
ATM_SHARES = 9850000
WARRANT_SHARES = 150000
BUYBACK_SHARES = 200000
JSON_LIMIT = 65536
EXHIBIT_LIMIT = 10000000
TICK_WINDOW_S = 300
STALE_SHORT_S = 10
IDLE_SHORT_S = 20
OPEN_MS = 600
REANCHOR_MS = 300
GONE_MS = 600
TOUCH_PX = 44
SHEET_SHARE = 0.85
CADENCE_S = 5
VAULT_RECOVER_S = 10
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
HTTP_TIMEOUT = 30
WAIT_S = 60
POLL_S = 0.5
MARGIN = timedelta(minutes=30)
REASON = "Probe correction re-filed by the verifier run."
NOTE = "Probe note written by the verifier run."
WRONG_DEVICE = timedelta(hours=6)
FOREIGN = "https://elsewhere.example"
Q18 = Decimal("1e-18")


def vault_down() -> str:
    return os.environ["APP_VAULT_DOWN_URL"].rstrip("/")


def short() -> str:
    return os.environ["APP_SHORT_URL"].rstrip("/")


def pg(base: str) -> Postgres:
    return Postgres("_short") if base.rstrip("/") == os.environ.get("APP_SHORT_URL", "").rstrip("/") else Postgres()


def poll(cond, what: str, seconds: float = WAIT_S):
    deadline, pace = time.monotonic() + seconds, threading.Event()
    while time.monotonic() < deadline:
        value = cond()
        if value:
            return value
        pace.wait(POLL_S)
    pytest.fail(f"timed out after {seconds}s waiting for: {what}")


def wait(page, fn, what: str, seconds: float = WAIT_S) -> None:
    deadline, last = time.monotonic() + seconds, None
    while time.monotonic() < deadline:
        try:
            fn()
            return
        except AssertionError as exc:
            last = exc
        advance(page, 500)
    pytest.fail(f"{what}: {last}")


def motion_done(page, ms: float, what: str) -> None:
    advance(page, ms)
    late = page.evaluate("ms => document.getAnimations().filter(a => a.playState === 'running')"
                         ".map(a => a.effect.getComputedTiming().endTime).filter(t => !(t <= ms))", ms)
    assert not late, f"{what}: animations timed past {ms} ms: {late}"
    until(page, "document.getAnimations().filter(a => a.playState === 'running' && a.effect.getComputedTiming().endTime !== Infinity).length === 0", seconds=WAIT_S)


def settle(page, ms: float) -> None:
    advance(page, ms)
    until(page, "document.getAnimations().filter(a => a.playState === 'running' && a.effect.getComputedTiming().endTime !== Infinity).length === 0", seconds=WAIT_S)


def iso(s):
    return datetime.fromisoformat(s) if s else None


def wall(s) -> str:
    return iso(s).astimezone(NY).strftime("%Y-%m-%d %H:%M:%S")


def hms(s) -> str:
    return iso(s).astimezone(NY).strftime("%H:%M:%S")


def hm(s) -> str:
    return iso(s).astimezone(NY).strftime("%H:%M")


def nyday(s) -> str:
    return iso(s).astimezone(NY).strftime("%Y-%m-%d")


def group(d: Decimal, places: int) -> str:
    return format(d.quantize(Decimal(1).scaleb(-places), ROUND_HALF_UP), f",.{places}f")


def show(fig: str, value: Decimal) -> str:
    if fig == "eth-per-1000-diluted":
        return group(value, 4)
    return group(value, 3) + ("×" if fig == "mnav" else " ETH")


def q18(x: Decimal) -> str:
    return format(x.quantize(Q18, ROUND_HALF_UP), "f")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def label() -> str:
    return uuid.uuid4().hex[:12]


def acc() -> str:
    return f"0002093117-26-{uuid.uuid4().int % 1000000:06d}"


def err(r: httpx.Response) -> dict:
    return r.json()["error"]


def make_pdf(mark: str, extra: bytes = b"", eof: bool = True) -> bytes:
    stream = b"BT /F1 12 Tf 72 720 Td (Tracewell exhibit " + mark.encode() + b") Tj ET"
    objs = [b"<< /Type /Catalog /Pages 2 0 R" + extra + b" >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for n, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n".encode()
    return bytes(out) + (b"%%EOF\n" if eof else b"")


def file_payload(pdf: bytes) -> dict:
    return {"name": f"exhibit-{label()}.pdf", "mimeType": "application/pdf", "buffer": pdf}


class Api:
    def __init__(self, base: str, who: str | None = None) -> None:
        self.base, self.who = base.rstrip("/"), who
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        if who:
            r = self.c.post("/api/session", json={"email": STAFF[who][1], "password": PASSWORD})
            assert r.status_code == 200, f"POST /api/session as {who}: {r.status_code} {r.text[:300]}"
            self.user = r.json()["user"]

    def clone(self) -> httpx.Client:
        return httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, cookies=self.c.cookies)

    def call(self, method: str, path: str, expect: int | None = None, **kw) -> httpx.Response:
        r = self.c.request(method, path, **kw)
        if expect is not None:
            assert r.status_code == expect, f"{method} {path}: expected {expect}, got {r.status_code} {r.text[:300]}"
        return r

    def json(self, method: str, path: str, expect: int = 200, **kw):
        return self.call(method, path, expect, **kw).json()


def rs(api: Api) -> list[dict]:
    return api.json("GET", "/api/restatements")["restatements"]


def one(api: Api, rid: str) -> dict:
    return api.json("GET", f"/api/restatements/{rid}")["restatement"]


def trail(api: Api, rid: str) -> list[dict]:
    return api.json("GET", f"/api/restatements/{rid}/audit")["entries"]


def latest(api: Api) -> dict:
    return max((r for r in rs(api) if r["state"] == "published"), key=lambda r: r["week_ending"])


def who_of(person: dict) -> str:
    return next(k for k, v in STAFF.items() if v[0] == person["name"])


def board(base: str) -> dict:
    r = httpx.get(f"{base}/api/board", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"GET /api/board: {r.status_code}"
    return r.json()


def figure(b: dict, fig: str) -> dict:
    return next(c for c in b["figures"] if c["figure"] == fig)


def filed(comp: dict) -> list[dict]:
    return [i for i in comp["inputs"] if i["source"]["kind"] == "exhibit"]


def exhibit_of(comp: dict) -> tuple[str, str, int]:
    s = filed(comp)[0]["source"]
    return s["accession"], s["sha256"], s["page"]


def citation(base: str, fig: str, day: str) -> httpx.Response:
    return httpx.get(f"{base}/api/citations/{fig}/{day}", timeout=HTTP_TIMEOUT)


def anon_exhibit(base: str, digest: str, **headers) -> httpx.Response:
    return httpx.get(f"{base}/api/exhibits/{digest}", headers=headers, timeout=HTTP_TIMEOUT)


def expected_value(comp: dict) -> Decimal:
    v = {i["key"]: Decimal(i["value"]) for i in comp["inputs"]}
    if comp["figure"] == "eth-held":
        return v["beginning-balance"] + v["eth-acquired"] + v["staking-rewards"]
    if comp["figure"] == "staking-rewards":
        return v["cumulative-staking-rewards"]
    if comp["figure"] == "eth-per-1000-diluted":
        return v["ending-balance"] / v["diluted-shares"] * 1000
    return v["share-price"] * v["diluted-shares"] / (v["ending-balance"] * v["eth-price"])


def market_now(base: str) -> datetime:
    return iso(httpx.get(f"{base}/api/clock", timeout=HTTP_TIMEOUT).json()["now"])


def high_water(base: str) -> datetime:
    rows = pg(base).rows("select extract(epoch from greatest((select max(computed_at) from computations), "
                         "(select max(at) from restatement_audit)))::float8 as e")
    e = rows[0]["e"] if rows else None
    return datetime.fromtimestamp(e or 0, timezone.utc)


def cal(base: str, d: date) -> dict:
    r = httpx.get(f"{base}/api/session-calendar", params={"date": d.isoformat()}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"session calendar for {d} (the suite stays inside 2026): {r.status_code}"
    return r.json()


def set_clock(base: str, at: datetime) -> datetime:
    return iso(Api(base, "basil").json("PUT", "/api/operator/clock", json={"at": at.isoformat()})["now"])


def floor_of(base: str, earliest: date | None) -> datetime:
    floor = max(market_now(base), high_water(base)) + timedelta(seconds=30)
    if earliest:
        floor = max(floor, datetime.combine(earliest, dtime(), NY))
    return floor.astimezone(NY)


def pick_instant(base: str, *, in_session: bool, earliest: date | None = None) -> datetime:
    floor = floor_of(base, earliest)
    d = floor.date()
    for _ in range(40):
        c = cal(base, d)
        o, e = iso(c["opens_at"]), iso(c["closes_at"])
        if in_session and o and max(floor, o + timedelta(minutes=1)) + MARGIN < e:
            return max(floor, o + timedelta(minutes=1))
        if not in_session:
            if not o or floor >= e or floor + MARGIN < o:
                return floor
            return e + timedelta(seconds=30)
        d += timedelta(days=1)
        floor = max(floor, datetime.combine(d, dtime(), NY))
    pytest.fail("no usable session instant found in the 2026 calendar")


def move_clock(base: str, *, in_session: bool, earliest: date | None = None) -> datetime:
    return set_clock(base, pick_instant(base, in_session=in_session, earliest=earliest))


def before_close(base: str, lead_s: int) -> datetime:
    floor = floor_of(base, None)
    d = floor.date()
    for _ in range(40):
        c = cal(base, d)
        if c["closes_at"] and iso(c["closes_at"]) - timedelta(seconds=lead_s) > max(floor, iso(c["opens_at"])):
            set_clock(base, iso(c["closes_at"]) - timedelta(seconds=lead_s))
            return iso(c["closes_at"])
        d += timedelta(days=1)
    pytest.fail("no session close found ahead of the market clock")


def before_midnight(base: str, lead_s: int) -> date:
    floor = floor_of(base, None)
    d = floor.date()
    while datetime.combine(d + timedelta(days=1), dtime(), NY) - timedelta(seconds=lead_s) <= floor:
        d += timedelta(days=1)
    set_clock(base, datetime.combine(d + timedelta(days=1), dtime(), NY) - timedelta(seconds=lead_s))
    return d


@contextlib.contextmanager
def tape_paused(base: str):
    op = Api(base, "basil")
    op.json("PUT", "/api/operator/tape", json={"state": "paused"})
    try:
        yield op
    finally:
        op.json("PUT", "/api/operator/tape", json={"state": "playing"})


def tick_key(base: str) -> str:
    return Api(base, "basil").json("GET", "/api/operator/tick-key")["key"]


def tick_id() -> str:
    return f"probe-{uuid.uuid4().hex[:16]}"


def tick(base: str, key: str, body: dict, t: int | None = None, header: str | None = None) -> httpx.Response:
    raw = json.dumps(body, separators=(",", ":")).encode()
    t = int(market_now(base).timestamp()) if t is None else t
    v1 = hmac.new(key.encode(), str(t).encode() + b"." + raw, hashlib.sha256).hexdigest()
    return httpx.post(f"{base}/api/internal/ticks", content=raw, timeout=HTTP_TIMEOUT,
                      headers={"Content-Type": "application/json", "X-Tick-Signature": header or f"t={t},v1={v1}"})


def mnav_at(base: str, at: str) -> int:
    return pg(base).rows(f"select count(*)::int as n from computations where figure = 'mnav' "
                         f"and computed_at = '{iso(at).isoformat()}'::timestamptz")[0]["n"]


def together(calls: list):
    barrier = threading.Barrier(len(calls))

    def run(f):
        barrier.wait()
        return f()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def week_rows(api: Api, r: dict) -> tuple[dict, list]:
    if r["supersedes"]:
        old = one(api, r["supersedes"])
        return dict(old["rows"]), [{k: e[k] for k in ("kind", "shares", "effective_date")} for e in old["share_events"]]
    p = latest(api)["rows"]
    return {"beginning-balance": p["ending-balance"], "eth-acquired": "0", "staking-rewards": "0",
            "ending-balance": p["ending-balance"], "cumulative-staking-rewards": p["cumulative-staking-rewards"],
            "diluted-shares": p["diluted-shares"]}, []


def save(api: Api, r: dict, **members) -> dict:
    return api.json("PATCH", f"/api/restatements/{r['id']}", json={"version": r["version"], **members})["restatement"]


def put_exhibit(client, r: dict, pdf: bytes, claimed: str | None = None) -> httpx.Response:
    c = client.c if isinstance(client, Api) else client
    return c.put(f"/api/restatements/{r['id']}/exhibit", content=pdf,
                 headers={"Content-Type": "application/pdf", "X-Exhibit-SHA256": claimed or sha(pdf)})


def make_ready(base: str, r: dict, rows=None, events=None, pdf=None, accession=None) -> tuple[dict, bytes]:
    an = Api(base, who_of(r["prepared_by"]))
    vr, ve = week_rows(an, r)
    members = {"rows": rows or vr, "share_events": ve if events is None else events,
               "accession": accession or acc(), "exhibit_page": 1}
    if r["supersedes"]:
        members["correction_reason"] = REASON
    r = save(an, one(an, r["id"]), **members)
    pdf = pdf or make_pdf(label())
    up = put_exhibit(an, r, pdf)
    assert up.status_code == 201, f"exhibit upload: {up.status_code} {up.text[:300]}"
    return up.json()["restatement"], pdf


def submit(base: str, r: dict) -> dict:
    an = Api(base, who_of(r["prepared_by"]))
    return an.json("POST", f"/api/restatements/{r['id']}/submit", json={})["restatement"]


def clear(base: str, r: dict, who: str = "rafe") -> dict:
    c = Api(base, who)
    return c.json("POST", f"/api/restatements/{r['id']}/clear",
                  json={"checked": ROW_KEYS, "version": one(c, r["id"])["version"]})["restatement"]


def release(base: str, r: dict, who: str = "noor", key: str | None = None) -> httpx.Response:
    return Api(base, who).call("POST", f"/api/restatements/{r['id']}/release", json={"confirm": True},
                               headers={"Idempotency-Key": key or uuid.uuid4().hex})


def publish_now(base: str, r: dict) -> dict:
    move_clock(base, in_session=False)
    out = release(base, r)
    assert out.status_code == 200 and out.json()["outcome"] == "published", f"release outside the session: {out.text[:300]}"
    return out.json()["restatement"]


def queue(base: str, r: dict, key: str | None = None) -> dict:
    move_clock(base, in_session=True)
    out = release(base, r, key=key)
    assert out.status_code == 202 and out.json()["outcome"] == "queued", f"release inside the session: {out.text[:300]}"
    return out.json()["restatement"]


def wait_state(api: Api, rid: str, state: str, seconds: float = WAIT_S) -> dict:
    return poll(lambda: (lambda r: r if r["state"] == state else None)(one(api, rid)), f"restatement {rid} reaches {state}", seconds)


def settle_open(base: str) -> None:
    api = Api(base, "rafe")
    for _ in range(4):
        pending = [r for r in rs(api) if r["state"] in OPEN_STATES]
        if not pending:
            return
        r = pending[0]
        if r["state"] in ("draft", "returned"):
            r, _ = make_ready(base, r)
            r = submit(base, r)
        if r["state"] == "in_review":
            r = clear(base, r)
        if r["state"] == "queued":
            w = Api(base, "noor").call("POST", f"/api/restatements/{r['id']}/withdraw", json={"version": r["version"], "note": NOTE})
            if w.status_code != 200:
                wait_state(api, r["id"], "published")
                continue
            r = w.json()["restatement"]
        if r["state"] == "cleared":
            publish_now(base, r)
    pytest.fail("could not settle the open restatement")


def new_week(base: str, who: str = "tamsin") -> dict:
    settle_open(base)
    api = Api(base, who)
    nxt = date.fromisoformat(latest(api)["week_ending"]) + timedelta(days=7)
    move_clock(base, in_session=False, earliest=nxt + timedelta(days=1))
    return api.json("POST", "/api/restatements", 201, json={})["restatement"]


def ensure_fresh_week(base: str) -> None:
    if latest(Api(base, "rafe"))["week_ending"] <= "2026-10-25":
        r, _ = make_ready(base, new_week(base))
        r = clear(base, submit(base, r))
        publish_now(base, r)


def new_correction(base: str, who: str = "tamsin") -> dict:
    settle_open(base)
    ensure_fresh_week(base)
    api = Api(base, who)
    return api.json("POST", "/api/restatements", 201, json={"supersedes": latest(api)["id"]})["restatement"]


def cleared_correction(base: str, **ready) -> tuple[dict, bytes]:
    r, pdf = make_ready(base, new_correction(base), **ready)
    return clear(base, submit(base, r)), pdf


def editable_draft(base: str, exhibit: bool = False) -> tuple[Api, dict]:
    an = Api(base, "tamsin")
    mine = [r for r in rs(an) if r["state"] == "draft" and r["supersedes"] and r["prepared_by"]["name"] == STAFF["tamsin"][0]]
    r = mine[0] if mine else new_correction(base)
    rows, events = week_rows(an, r)
    r = save(an, one(an, r["id"]), rows=rows, share_events=events, accession=acc(), exhibit_page=1, correction_reason=REASON)
    if exhibit:
        up = put_exhibit(an, r, make_pdf(label()))
        assert up.status_code == 201, f"exhibit upload: {up.status_code}"
        r = up.json()["restatement"]
    return an, r


def event_rows(api: Api, r: dict, extra: list[dict]) -> tuple[dict, list]:
    rows, events = week_rows(api, r)
    signed = sum(int(e["shares"]) * (-1 if e["kind"] == "buyback" else 1) for e in extra)
    rows["diluted-shares"] = str(int(rows["diluted-shares"]) + signed)
    return rows, events + extra


@contextlib.contextmanager
def board_page(browser, base: str, path: str = "/", viewport=DESKTOP, **kw):
    with open_app(browser, base + path, **kw) as page:
        page.set_viewport_size(viewport)
        yield page


def ui_sign_in(page, who: str, scope=None) -> None:
    s = scope or page
    fill(s.get_by_role("textbox", name="Email", exact=True), STAFF[who][1])
    fill(s.get_by_role("textbox", name="Password", exact=True), PASSWORD)
    click(s.get_by_role("button", name="Sign in", exact=True))
    if scope is None:
        wait(page, lambda: expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_visible(timeout=500), "Sign out after sign-in")


@contextlib.contextmanager
def staff_page(browser, base: str, who: str, path: str, viewport=DESKTOP, **kw):
    with open_app(browser, base + "/staff", **kw) as page:
        page.set_viewport_size(viewport)
        ui_sign_in(page, who)
        page.goto(base + path)
        yield page


def status(scope, name: str):
    return scope.get_by_role("status", name=name, exact=True)


def said(page, name: str, text: str, scope=None, seconds: float = WAIT_S) -> None:
    loc = status(scope or page, name)
    wait(page, lambda: expect(loc).to_have_text(text, timeout=500), f'status "{name}" reads {text!r}', seconds)


def tile(page, fig: str):
    return page.get_by_role("button", name=f"Unspool {FIGURES[fig]}", exact=True)


def trace(page, fig: str):
    return page.get_by_role("dialog", name=f"Trace: {FIGURES[fig]}", exact=True)


def input_button(dlg, text: str):
    return dlg.get_by_role("list", name="Inputs", exact=True).get_by_role("button", name=text, exact=True)


def chips(page):
    return page.locator("[data-unspool-chip]")


def threads(page):
    return page.locator("[data-unspool-thread]")


def history(page):
    return page.get_by_role("table", name="Weekly holdings restatements", exact=True)


def hrow(page, accession: str):
    return history(page).get_by_role("row").filter(has=page.get_by_role("link", name=f"Exhibit {accession}", exact=True))


def history_accessions(page) -> list[str]:
    return [t.strip() for t in history(page).get_by_role("link", name=re.compile(r"^Exhibit ")).all_text_contents()]


def ui_fill(page, rows: dict, accession: str, reason: str | None = None) -> None:
    for key, text in ROW_LABELS.items():
        fill(page.get_by_role("textbox", name=text, exact=True), rows[key])
    fill(page.get_by_role("textbox", name="Accession number", exact=True), accession)
    fill(page.get_by_role("spinbutton", name="Exhibit page", exact=True), "1")
    if reason:
        fill(page.get_by_role("textbox", name="Correction reason", exact=True), reason)


def editor_id(page) -> str:
    wait(page, lambda: expect(page).to_have_url(re.compile(r"/staff/restatements/[^/?#]+$"), timeout=500), "editor opens")
    return re.search(r"/staff/restatements/([^/?#]+)$", page.url).group(1)


def rail_lines(b: dict) -> dict:
    eq, eth, h = b["clocks"]["equity"], b["clocks"]["eth"], b["clocks"]["holdings"]
    e = (f"Session open — closes at {hm(eq['closes_at'])} ET" if eq["status"] == "open"
         else f"Market closed — share price is the {eq['official_close']['date']} official close")
    if eth["status"] == "live":
        t = f"Live — last tick {hms(eth['last_tick']['at'])} ET"
    else:
        t = f"Stale — no ETH tick since {hms(eth['last_tick']['at'])} ET" if eth["last_tick"] else "Stale — no ETH tick received"
    w = f"Week ending {h['week_ending']} — as of {h['week_ending']} 23:59:59 ET"
    return {"Equity session": e, "ETH price": t, "Holdings week": w}


def clock_group(page, name: str):
    return page.get_by_role("region", name="Clocks", exact=True).get_by_role("group", name=name, exact=True)


ENDS_JS = """(p) => { const L = p.getTotalLength(), m = p.getScreenCTM();
  const f = (q) => { const r = new DOMPoint(q.x, q.y).matrixTransform(m); return {x: r.x, y: r.y}; };
  return [f(p.getPointAtLength(0)), f(p.getPointAtLength(L))]; }"""


def inside(pt: dict, box: dict) -> bool:
    return box["x"] - 1 <= pt["x"] <= box["x"] + box["width"] + 1 and box["y"] - 1 <= pt["y"] <= box["y"] + box["height"] + 1


def assert_anchored(page, dlg, comp: dict) -> None:
    accession, _, pno = exhibit_of(comp)
    table = dlg.get_by_role("table", name=f"Exhibit {accession} page {pno}", exact=True)
    vp = page.viewport_size
    for i in filed(comp):
        chip = page.locator(f'[data-unspool-chip="{i["key"]}"]').bounding_box()
        row = table.get_by_role("row").filter(has_text=i["source"]["row"]).first.bounding_box()
        if not all(b and b["y"] >= 0 and b["y"] + b["height"] <= vp["height"] for b in (chip, row)):
            continue
        a, z = page.locator(f'[data-unspool-thread="{i["key"]}"]').evaluate(ENDS_JS)
        assert (inside(a, chip) and inside(z, row)) or (inside(z, chip) and inside(a, row)), \
            f"thread {i['key']} runs from its chip to its own exhibit row (L570): ends {a} {z}, chip {chip}, row {row}"


@contextlib.contextmanager
def foreign_site(html: bytes):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(html)

        def log_message(self, *args):
            return

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}/"
    finally:
        srv.shutdown()
        srv.socket.shutdown(socket.SHUT_RDWR)
        srv.server_close()


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@contextlib.contextmanager
def app_copy(**env: str):
    port = free_port()
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=str(DEPLOYED_APP), env={**os.environ, "APP_PUBLIC_PORT": str(port), **env},
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text()[-2000:]

    def up():
        if proc.poll() is not None:
            pytest.fail(f"app copy exited: {tail()}")
        try:
            return httpx.get(base + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(up, f"app copy answers /api/health; log: {tail()}", WAIT_S * 2)
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=HTTP_TIMEOUT)


class Relay:

    def __init__(self, port: int, target: tuple[str, int]) -> None:
        self.port, self.target, self.sock, self.conns = port, target, None, []

    def start(self) -> None:
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen(64)
        threading.Thread(target=self._accept, args=(self.sock,), daemon=True).start()

    def _accept(self, sock) -> None:
        while True:
            try:
                a, _ = sock.accept()
            except OSError:
                return
            try:
                b = socket.create_connection(self.target)
            except OSError:
                a.close()
                continue
            self.conns += [a, b]
            for x, y in ((a, b), (b, a)):
                threading.Thread(target=self._pipe, args=(x, y), daemon=True).start()

    @staticmethod
    def _pipe(x, y) -> None:
        try:
            while data := x.recv(65536):
                y.sendall(data)
        except OSError:
            pass
        finally:
            with contextlib.suppress(OSError):
                y.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()
        for c in self.conns:
            with contextlib.suppress(OSError):
                c.shutdown(socket.SHUT_RDWR)
            c.close()
        self.conns = []


def test_wf_cross_cutting_health(browser, app_url):
    for base in (app_url, vault_down()):
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, f"health on {base}: {r.status_code} {r.text}"
    disp = figure(board(vault_down()), "eth-held")["display"]
    with board_page(browser, vault_down()) as page:
        wait(page, lambda: expect(tile(page, "eth-held")).to_contain_text(disp, timeout=500), "board renders while the vault is down")


def test_wf_cross_cutting_boundary(browser, app_url):
    base_body = '{"email":"a","password":""}'
    exact = base_body.replace('""', '"' + "x" * (JSON_LIMIT - len(base_body)) + '"')
    assert len(exact.encode()) == JSON_LIMIT
    r = httpx.post(f"{app_url}/api/session", content=exact, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code in (401, 422), f"a body of exactly the limit is allowed: {r.status_code}"
    over = exact[:-2] + 'xx"}'
    r = httpx.post(f"{app_url}/api/session", content=over, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 413 and err(r)["code"] == "payload_too_large"
    r = httpx.post(f"{app_url}/api/session", content="email=a", headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 415 and err(r)["code"] == "unsupported_media_type"
    r = httpx.post(f"{app_url}/api/session", content="{not json", headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 422 and r.json() == {"error": {"code": "invalid_json", "message": "Request body is not valid JSON."}}
    probe_id = "probe-unknown-restatement"
    big = b"%PDF-" + b"0" * EXHIBIT_LIMIT + b"%%EOF"
    r = httpx.put(f"{app_url}/api/restatements/{probe_id}/exhibit", content=big, timeout=HTTP_TIMEOUT,
                  headers={"Content-Type": "application/pdf", "X-Exhibit-SHA256": sha(big)})
    assert r.status_code == 413 and err(r)["code"] == "payload_too_large"
    r = httpx.put(f"{app_url}/api/restatements/{probe_id}/exhibit", content=b"%PDF-%%EOF", timeout=HTTP_TIMEOUT,
                  headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 415 and err(r)["code"] == "unsupported_media_type"
    an, d = editable_draft(app_url)
    p = make_pdf(label())
    sized = p[:9] + b"%" + b"0" * (EXHIBIT_LIMIT - len(p) - 2) + b"\n" + p[9:]
    assert len(sized) == EXHIBIT_LIMIT
    assert put_exhibit(an, d, sized).status_code == 201, "an exhibit of exactly the limit is allowed"
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts",
                 "/dist/server.js.map"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404, f"{path} must answer 404, got {r.status_code}"
    r = httpx.get(f"{app_url}/api/board", headers={"Origin": FOREIGN}, timeout=HTTP_TIMEOUT)
    assert not any(k.lower().startswith("access-control-") for k in r.headers), "no CORS headers"
    with board_page(browser, app_url) as page:
        assert page.goto(app_url + "/run.json").status == 404


def test_wf_cross_cutting_layout(browser, app_url):
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(tile(page, "mnav")).to_be_visible(timeout=500), "tiles render")
        for vp, cols in ((PHONE, 1), (TABLET, 2), (DESKTOP, 4)):
            page.set_viewport_size(vp)
            advance(page, 500)
            layout(page)
            boxes = [tile(page, f).bounding_box() for f in FIGURES]
            lefts = sorted({round(b["x"]) for b in boxes})
            assert len(lefts) == cols, f"{vp['width']} px shows {cols} tile columns, saw lefts {lefts}"
            for a, z in zip(boxes, boxes[1:]):
                assert a["y"] < z["y"] - 5 or (abs(a["y"] - z["y"]) <= 5 and a["x"] < z["x"]), "tiles keep reading order"
            rail = page.get_by_role("region", name="Clocks", exact=True)
            rb, gb = rail.bounding_box(), page.get_by_role("region", name="Figures", exact=True).bounding_box()
            gs = [clock_group(page, n).bounding_box() for n in ("Equity session", "ETH price", "Holdings week")]
            if cols == 4:
                assert rb["x"] + rb["width"] <= gb["x"] + 1, "rail is a left column at 1280 px"
                page.evaluate("window.scrollTo(0, 400)")
                advance(page, 200)
                assert abs(rail.bounding_box()["y"] - rb["y"]) <= 1, "rail stays in view while the page scrolls"
                page.evaluate("window.scrollTo(0, 0)")
            else:
                assert rb["y"] + rb["height"] <= gb["y"] + 1, "rail is a strip above the grid below 1280 px"
                assert max(g["y"] for g in gs) - min(g["y"] for g in gs) <= 5, "three clock items side by side"


def test_wf_board_reading_desktop(browser, app_url):
    with tape_paused(app_url), board_page(browser, app_url) as page:
        figs = page.get_by_role("region", name="Figures", exact=True)
        wait(page, lambda: expect(figs.get_by_role("heading")).to_contain_text(list(FIGURES.values()), timeout=500), "tile headings in order")

        def matches():
            b = board(app_url)
            assert [c["figure"] for c in b["figures"]] == list(FIGURES)
            for c in b["figures"]:
                t = tile(page, c["figure"])
                badge = BADGES[next(i for i in c["inputs"] if i["sets_as_of"])["clock"]]
                expect(t).to_contain_text(c["display"], timeout=500)
                expect(t).to_contain_text(badge, timeout=500)
                expect(t).to_contain_text(f"As of {wall(c['as_of'])} ET", timeout=500)
                accession, _, pno = exhibit_of(c)
                expect(t).to_contain_text(f"Accession {accession} · p. {pno}", timeout=500)
            for name, line in rail_lines(b).items():
                expect(clock_group(page, name)).to_contain_text(line, timeout=500)

        wait(page, matches, "tiles and rail show the board API values")
        expect(page.get_by_role("region", name="Notices", exact=True)).to_have_text("")
        expect(page.get_by_text(FOOTER, exact=True)).to_be_visible()


def test_board_rail_server_decided(browser, app_url):
    move_clock(app_url, in_session=True)
    with board_page(browser, app_url) as page:
        page.clock.set_system_time(market_now(app_url) + WRONG_DEVICE)

        def rail_ok():
            for name, line in rail_lines(board(app_url)).items():
                expect(clock_group(page, name)).to_contain_text(line, timeout=500)

        wait(page, rail_ok, "rail shows the board API statuses")
        expect(clock_group(page, "Equity session")).to_contain_text("Session open — closes at")
        move_clock(app_url, in_session=False)
        wait(page, rail_ok, "rail picks up the server's market-closed status")
        expect(clock_group(page, "Equity session")).to_contain_text("Market closed — share price is the")
        page.route("**/api/board*", lambda route: route.abort())
        said(page, "Board updates", REFRESH_FAILED)
        rail = page.get_by_role("region", name="Clocks", exact=True)
        before = (rail.inner_text(), page.get_by_role("region", name="Figures", exact=True).inner_text())
        advance(page, CADENCE_S * 2000)
        assert (rail.inner_text(), page.get_by_role("region", name="Figures", exact=True).inner_text()) == before
        page.unroute("**/api/board*")
        wait(page, lambda: expect(status(page, "Board updates")).not_to_have_text(REFRESH_FAILED, timeout=500), "next success clears the copy")


def test_board_stale_and_closed_copy(browser):
    base = short()
    with tape_paused(base):
        move_clock(base, in_session=False)
        b = poll(lambda: (lambda x: x if x["clocks"]["eth"]["status"] == "stale" else None)(board(base)),
                 "ETH clock turns stale once ETH_STALE_SECONDS pass", STALE_SHORT_S + 6 * CADENCE_S)
        lt, oc = b["clocks"]["eth"]["last_tick"], b["clocks"]["equity"]["official_close"]
        stale = f"Stale — no ETH tick since {hms(lt['at'])} ET" if lt else "Stale — no ETH tick received"
        with board_page(browser, base) as page:
            wait(page, lambda: expect(clock_group(page, "ETH price")).to_contain_text(stale, timeout=500), "stale copy")
            wait(page, lambda: expect(clock_group(page, "Equity session")).to_contain_text(
                f"Market closed — share price is the {oc['date']} official close", timeout=500), "market-closed copy")


def test_board_history_restated(browser, app_url):
    b = board(app_url)
    weeks = [h["week_ending"] for h in b["history"] if h["state"] == "published"]
    assert weeks == sorted(weeks, reverse=True), "current rows newest week first"
    for i, h in enumerate(b["history"]):
        if h["state"] == "superseded":
            above = b["history"][i - 1]
            assert above["restatement_id"] == h["restated"]["superseded_by"] or above["state"] == "superseded", \
                "a superseded row sits directly beneath its superseder"
    listed = {r["id"] for r in rs(Api(app_url, "rafe")) if r["state"] in ("published", "superseded")}
    assert {h["restatement_id"] for h in b["history"]} == listed
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(history(page).get_by_role("link", name=re.compile(r"^Exhibit "))).to_have_count(len(b["history"]), timeout=500), "every history row")
        assert history_accessions(page) == [h["exhibit"]["accession"] for h in board(app_url)["history"]]
        old = hrow(page, "0002093117-26-000044")
        expect(old).to_contain_text("Restated")
        expect(old).to_contain_text(f"Restated on 2026-10-21: {SEED_REASON}")
        expect(old.get_by_role("link", name="View superseding entry", exact=True)).to_be_visible()


def test_wf_board_reading_phone(browser, app_url):
    b = board(app_url)
    lines, week = rail_lines(b), b["clocks"]["holdings"]["week_ending"]
    with board_page(browser, app_url, viewport=PHONE) as page:
        btn = page.get_by_role("button", name="Holdings week details", exact=True)
        wait(page, lambda: expect(btn).to_have_attribute("aria-expanded", "false", timeout=500), "collapsed details button")
        layout(page)
        for name in ("Equity session", "ETH price", "Holdings week"):
            d = page.get_by_role("button", name=f"{name} details", exact=True)
            box = d.bounding_box()
            assert box["width"] >= TOUCH_PX and box["height"] >= TOUCH_PX, f"{name} details is at least 44 px"
            assert lines[name] not in page.get_by_role("region", name="Clocks", exact=True).aria_snapshot()
        expect(clock_group(page, "Holdings week")).to_contain_text(f"Week {week}")
        boxes = [tile(page, f).bounding_box() for f in FIGURES]
        assert len({round(x["x"]) for x in boxes}) == 1 and [x["y"] for x in boxes] == sorted(x["y"] for x in boxes)
        click(btn)
        expect(btn).to_have_attribute("aria-expanded", "true")
        expect(btn).to_be_focused()
        expect(page.get_by_text(lines["Holdings week"], exact=True)).to_be_visible()
        for _ in range(3):
            advance(page, CADENCE_S * 1000)
            expect(btn).to_have_attribute("aria-expanded", "true")
            assert lines["Holdings week"] in page.get_by_role("region", name="Clocks", exact=True).aria_snapshot()
        page.keyboard.press("Enter")
        expect(btn).to_have_attribute("aria-expanded", "false")
        assert lines["Holdings week"] not in page.get_by_role("region", name="Clocks", exact=True).aria_snapshot()
        page.set_viewport_size(TABLET)
        advance(page, 500)
        expect(page.get_by_role("button", name=re.compile(r" details$"))).to_have_count(0)


def test_wf_board_reading_session_close(browser, app_url):
    Api(app_url, "basil").json("PUT", "/api/operator/tape", json={"state": "playing"})
    close = before_close(app_url, 45)
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(clock_group(page, "Equity session")).to_contain_text("Session open — closes at", timeout=500), "open before the close")
        status(page, "Board updates").evaluate("""(el) => { window.__said = 0; let had = false;
            new MutationObserver(() => { const has = el.textContent.includes('Equity session closed.');
              if (has && !had) window.__said++; had = has; }).observe(el, {subtree: true, childList: true, characterData: true}); }""")
        b = poll(lambda: (lambda x: x if x["clocks"]["equity"]["status"] == "closed" else None)(board(app_url)),
                 "server reports the session closed", WAIT_S)
        day = b["clocks"]["equity"]["official_close"]["date"]
        said(page, "Board updates", f"Equity session closed. Share price is now the {day} official close.")
        for _ in range(3):
            advance(page, CADENCE_S * 1000)
        assert page.evaluate("window.__said") == 1, "session-close copy announced exactly once"
        assert iso(b["server_time"]) >= close
        click(tile(page, "mnav"))
        settle(page, OPEN_MS)
        expect(input_button(trace(page, "mnav"), f"Official close {day}")).to_be_visible()


def test_wf_board_reading_new_week(browser, app_url):
    r, _ = cleared_correction(app_url)
    prior = one(Api(app_url, "rafe"), r["supersedes"])
    with board_page(browser, app_url) as page:
        seed_link = page.get_by_role("link", name="Exhibit 0002093117-26-000041", exact=True)
        wait(page, lambda: expect(seed_link).to_be_visible(timeout=500), "history renders")
        seed_link.focus()
        handle = hrow(page, "0002093117-26-000041").element_handle()
        published = publish_now(app_url, r)
        wait(page, lambda: expect(history(page).get_by_role("link", name=re.compile(r"^Exhibit ")).first).to_have_text(r["accession"], timeout=500),
             "new row at the top", CADENCE_S * 4)
        order = history_accessions(page)
        assert order.index(prior["accession"]) == order.index(r["accession"]) + 1, "superseded row directly beneath"
        expect(hrow(page, prior["accession"]).first).to_contain_text(f"Restated on {nyday(published['published_at'])}: {REASON}")
        expect(seed_link).to_be_focused()
        assert hrow(page, "0002093117-26-000041").evaluate("(el, h) => el === h", handle), "unchanged row is the same element"


def test_wf_figure_computation_tie_week(browser, app_url):
    r = new_correction(app_url)
    api = Api(app_url, "tamsin")
    o = one(api, r["supersedes"])["rows"]
    old = one(api, r["supersedes"])
    begin = Decimal(o["beginning-balance"])
    prior_cum = Decimal(o["cumulative-staking-rewards"]) - Decimal(o["staking-rewards"])
    signed = sum(int(e["shares"]) * (-1 if e["kind"] == "buyback" else 1) for e in old["share_events"])
    delta = DILUTED_TIE - (int(o["diluted-shares"]) - signed)
    monday = (date.fromisoformat(r["week_ending"]) - timedelta(days=6)).isoformat()
    events = [] if delta == 0 else [{"kind": "atm_settlement" if delta > 0 else "buyback", "shares": str(abs(delta)), "effective_date": monday}]
    i = int((begin - 8) // 16) + 2
    i += i % 2
    ending = Decimal(16 * i + 8)
    rows = {"beginning-balance": o["beginning-balance"], "eth-acquired": format(ending - begin, "f"), "staking-rewards": "0",
            "ending-balance": format(ending, "f"), "cumulative-staking-rewards": format(prior_cum, "f"), "diluted-shares": str(DILUTED_TIE)}
    r, _ = make_ready(app_url, r, rows=rows, events=events)
    publish_now(app_url, clear(app_url, submit(app_url, r)))
    q = ending * 1000 / DILUTED_TIE
    want = group(q, 4)
    assert want != format(q.quantize(Decimal("0.0001"), ROUND_HALF_EVEN), ",f"), "the probe is a tie where half-even differs"
    b = board(app_url)
    c = figure(b, "eth-per-1000-diluted")
    assert c["restatement_id"] == r["id"] and c["value"] == q18(q) and c["display"] == want
    assert figure(b, "eth-held")["display"] == group(ending, 3) + " ETH"
    row = next(h for h in b["history"] if h["restatement_id"] == r["id"])
    assert row["eth_per_1000_diluted"]["display"] == want
    cit = citation(app_url, "eth-per-1000-diluted", b["market_date"]).json()
    assert cit["computation"]["display"] == want
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(tile(page, "eth-per-1000-diluted")).to_contain_text(want, timeout=500), "tile shows the half-away display")
        expect(hrow(page, r["accession"]).first).to_contain_text(want)
        page.goto(f"{app_url}/cite/eth-per-1000-diluted/{b['market_date']}")
        wait(page, lambda: expect(tile(page, "eth-per-1000-diluted")).to_contain_text(want, timeout=500), "citation shows the same display")


def test_wf_figure_computation_dst_week(browser, app_url):
    ensure_fresh_week(app_url)
    b = board(app_url)
    rows = [h for h in b["history"] if h["week_ending"] == "2026-11-01"]
    assert rows, "the week ending 2026-11-01 is in the history"
    comp = httpx.get(f"{app_url}/api/computations/{rows[-1]['eth_per_1000_diluted']['computation_id']}", timeout=HTTP_TIMEOUT).json()["computation"]
    assert comp["as_of"] == "2026-11-01T23:59:59-05:00"
    assert all(i["as_of"] == "2026-11-01T23:59:59-05:00" for i in filed(comp))
    oct30, nov2 = cal(app_url, date(2026, 10, 30)), cal(app_url, date(2026, 11, 2))
    assert oct30["closes_at"] == "2026-10-30T16:00:00-04:00"
    assert nov2["opens_at"] == "2026-11-02T09:30:00-05:00" and nov2["closes_at"] == "2026-11-02T16:00:00-05:00"
    if market_now(app_url) >= iso("2026-11-03T00:00:00-05:00"):
        c = citation(app_url, "mnav", "2026-11-02").json()["computation"]
        assert iso(c["computed_at"]) < iso("2026-11-03T00:00:00-05:00")
        poll(lambda: mnav_at(app_url, "2026-11-02T16:00:00-05:00") >= 1, "a session-close mNAV at the -05:00 close", CADENCE_S * 3)
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(history(page).get_by_role("row").filter(has_text="2026-11-01").first).to_be_visible(timeout=500), "row for 2026-11-01")


def test_wf_figure_computation_seed(browser, app_url):
    api = Api(app_url, "rafe")
    seeded = {r["accession"]: r for r in rs(api) if r["accession"] in SEED}
    assert set(seeded) == set(SEED)
    for accession, (week, state, version, pub) in SEED.items():
        r = seeded[accession]
        assert (r["week_ending"], r["state"], r["version"]) == (week, state, version)
        assert iso(r["published_at"]) == iso(pub) and iso(r["created_at"]) == iso(pub) and r["release_at"] is None
        entries = trail(api, r["id"])
        assert [(e["action"], e["actor"]["name"] if e["actor"] else None, e["from_state"], e["to_state"]) for e in entries[:7]] == SEED_TRAIL
        assert all(iso(e["at"]) == iso(pub) and e["note"] is None for e in entries[:7]) and [e["version"] for e in entries] == list(range(1, version + 1))
    sup = trail(api, seeded["0002093117-26-000044"]["id"])[7]
    assert (sup["action"], sup["actor"], sup["from_state"], sup["to_state"], sup["note"]) == ("supersede", None, "published", "superseded", SEED_REASON)
    assert iso(sup["at"]) == iso("2026-10-21T18:00:05-04:00")
    c = citation(app_url, "mnav", "2026-10-27").json()["computation"]
    ins = {i["key"]: i for i in c["inputs"]}
    assert iso(c["computed_at"]) == iso("2026-10-27T16:00:00-04:00") and c["display"] == "1.566×"
    assert ins["share-price"]["source"] == {"kind": "official_close", "date": "2026-10-27"} and Decimal(ins["share-price"]["value"]) == Decimal("14.71")
    assert ins["eth-price"]["source"]["id"] == "seed-2026-10-26-eth" and Decimal(ins["eth-price"]["value"]) == Decimal("3410.05")
    assert Decimal(ins["ending-balance"]["value"]) == Decimal("413602.6875") and Decimal(ins["diluted-shares"]["value"]) == 150150000
    assert ins["ending-balance"]["sets_as_of"] and c["as_of"] == "2026-10-25T23:59:59-04:00"
    for fig in FIGURES:
        assert citation(app_url, fig, "2026-10-11").status_code == 404
    assert iso(citation(app_url, "mnav", "2026-10-12").json()["computation"]["computed_at"]) == iso("2026-10-12T17:30:05-04:00")
    window = ("select id, figure from computations where computed_at >= '2026-10-12T17:30:05-04:00' "
              "and computed_at < '2026-10-31T00:00:00-04:00' order by id")
    before = Postgres().rows(window)
    assert sum(1 for x in before if x["figure"] == "mnav") == 29 and sum(1 for x in before if x["figure"] == "eth-held") == 4
    with app_copy():
        pass
    assert Postgres().rows(window) == before, "a later start replays and duplicates nothing"
    assert {r["accession"]: r["version"] for r in rs(api) if r["accession"] in SEED} == {k: v[2] for k, v in SEED.items()}
    with board_page(browser, app_url, "/cite/mnav/2026-10-27") as page:
        wait(page, lambda: expect(page.get_by_role("heading", name="mNAV as of the end of 2026-10-27", exact=True)).to_be_visible(timeout=500), "citation heading")
        expect(tile(page, "mnav")).to_contain_text("1.566×")


def test_exact_amounts(app_url):
    r = new_correction(app_url)
    o = one(Api(app_url, "tamsin"), r["supersedes"])
    rows, events = week_rows(Api(app_url, "tamsin"), r)
    acq = Decimal(o["rows"]["eth-acquired"]) + Decimal("0.100000000000000001")
    rew = Decimal(o["rows"]["staking-rewards"]) + Decimal("0.2")
    rows.update({"eth-acquired": format(acq, "f"), "staking-rewards": format(rew, "f"),
                 "ending-balance": format(Decimal(rows["beginning-balance"]) + acq + rew, "f"),
                 "cumulative-staking-rewards": format(Decimal(o["rows"]["cumulative-staking-rewards"]) + Decimal("0.2"), "f")})
    r, _ = make_ready(app_url, r, rows=rows, events=events)
    publish_now(app_url, clear(app_url, submit(app_url, r)))
    for c in board(app_url)["figures"]:
        want = expected_value(c)
        assert re.fullmatch(r"-?\d+\.\d{18}", c["value"]), f"{c['figure']} value has exactly 18 fractional digits"
        assert c["value"] == q18(want), f"{c['figure']} stored {c['value']}, exact {q18(want)}"
        assert c["display"] == show(c["figure"], Decimal(c["value"]))
    held = figure(board(app_url), "eth-held")
    assert held["value"].endswith("300000000000000001"[-1]) and Decimal(held["value"]) == Decimal(rows["ending-balance"])


def test_one_stored_computation(browser, app_url):
    b = board(app_url)
    c = figure(b, "eth-per-1000-diluted")
    row = next(h for h in b["history"] if h["restatement_id"] == c["restatement_id"])
    assert row["eth_per_1000_diluted"] == {"computation_id": c["id"], "value": c["value"], "display": c["display"]}
    stored = httpx.get(f"{app_url}/api/computations/{c['id']}", timeout=HTTP_TIMEOUT).json()["computation"]
    assert (stored["value"], stored["display"], stored["as_of"]) == (c["value"], c["display"], c["as_of"])
    assert citation(app_url, "eth-per-1000-diluted", b["market_date"]).json()["computation"]["id"] == c["id"]
    assert Postgres().rows(f"select figure from computations where id::text = '{c['id']}'")[0]["figure"] == "eth-per-1000-diluted"
    assert figure(board(app_url), "eth-per-1000-diluted")["id"] == c["id"], "a reread does not recompute"
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(tile(page, "eth-per-1000-diluted")).to_contain_text(c["display"], timeout=500), "tile digits")
        expect(tile(page, "eth-per-1000-diluted")).to_contain_text(f"As of {wall(c['as_of'])} ET")
        expect(hrow(page, row["exhibit"]["accession"]).first).to_contain_text(c["display"])
        page.goto(f"{app_url}/cite/eth-per-1000-diluted/{b['market_date']}")
        wait(page, lambda: expect(tile(page, "eth-per-1000-diluted")).to_contain_text(f"As of {wall(c['as_of'])} ET", timeout=500), "citation as-of")


def test_as_of_oldest_input(app_url):
    comps = list(board(app_url)["figures"])
    for day in ("2026-10-13", "2026-10-20", "2026-10-27", "2026-10-30"):
        comps += [citation(app_url, f, day).json()["computation"] for f in FIGURES]
    for c in comps:
        oldest = min(iso(i["as_of"]) for i in c["inputs"])
        assert iso(c["as_of"]) == oldest, f"{c['figure']} {c['id']} as-of is its oldest input"
        flags = [i["sets_as_of"] for i in c["inputs"]]
        first = next(n for n, i in enumerate(c["inputs"]) if iso(i["as_of"]) == oldest)
        assert flags == [n == first for n in range(len(flags))], f"{c['figure']} flags only the first oldest input"


def test_wf_price_feed_operator_console(browser, app_url):
    op = Api(app_url, "basil")
    op.json("PUT", "/api/operator/tape", json={"state": "playing"})
    with staff_page(browser, app_url, "basil", "/operator") as page:
        def lines_follow(state):
            t = op.json("GET", "/api/operator/tape")
            expect(page.get_by_text(f"Tape {state} at position {t['position']}", exact=True)).to_be_visible(timeout=500)

        wait(page, lambda: lines_follow("playing"), "tape line follows the server")
        clock_line = page.get_by_text(re.compile(r"^Market clock \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ET$"))
        wait(page, lambda: expect(clock_line).to_be_visible(timeout=500), "market-clock line")
        shown = datetime.strptime(clock_line.inner_text()[13:32], "%Y-%m-%d %H:%M:%S").replace(tzinfo=NY)
        assert abs(shown - market_now(app_url)) < timedelta(seconds=CADENCE_S * 3)
        click(page.get_by_role("button", name="Pause tape", exact=True))
        said(page, "Operator status", "Tape paused.")
        assert op.json("GET", "/api/operator/tape")["state"] == "paused"
        wait(page, lambda: lines_follow("paused"), "tape line shows paused")
        invalid = "Enter a time as YYYY-MM-DD HH:MM:SS in New York time."
        sent = []
        page.on("request", lambda req: sent.append(req) if "/api/operator/clock" in req.url and req.method == "PUT" else None)
        for typed in ("2026-11-02 25:00:00", "2026-03-08 02:30:00", "tomorrow"):
            fill(page.get_by_role("textbox", name="Rehearsal clock", exact=True), typed)
            click(page.get_by_role("button", name="Set clock", exact=True))
            said(page, "Operator status", invalid)
        assert not sent, "an invalid rehearsal entry is never sent"
        op.json("PUT", "/api/operator/tape", json={"state": "playing"})
        wait(page, lambda: lines_follow("playing"), "another tab's resume shows on the tape line", CADENCE_S * 3)
        expect(status(page, "Operator status")).to_have_text(invalid)
        bodies = []
        page.route("**/api/operator/clock", lambda route: (bodies.append(route.request.post_data_json), route.abort()))
        fill(page.get_by_role("textbox", name="Rehearsal clock", exact=True), "2026-11-01 01:30:00")
        click(page.get_by_role("button", name="Set clock", exact=True))

        def clock_sent():
            assert bodies, "no clock request yet"
        wait(page, clock_sent, "the repeated wall time is sent")
        assert iso(bodies[0]["at"]) == datetime(2026, 11, 1, 1, 30, tzinfo=timezone(timedelta(hours=-4))), "earlier instant of a repeated time"
        page.unroute("**/api/operator/clock")
        page.route("**/api/operator/tape", lambda route: route.abort() if route.request.method == "GET" else route.continue_())
        page.route("**/api/clock", lambda route: route.abort())
        before = (page.get_by_text(re.compile(r"^Tape (playing|paused) at position")).inner_text(), clock_line.inner_text())
        advance(page, CADENCE_S * 2000)
        assert (page.get_by_text(re.compile(r"^Tape (playing|paused) at position")).inner_text(), clock_line.inner_text()) == before
        page.unroute("**/api/operator/tape")
        page.unroute("**/api/clock")
        click(page.get_by_role("button", name="Resume tape", exact=True))
        said(page, "Operator status", "Tape playing.")


def test_wf_price_feed_signed_ticks(browser, app_url):
    target = pick_instant(app_url, in_session=True).replace(microsecond=0)
    typed = target.strftime("%Y-%m-%d %H:%M:%S")
    with tape_paused(app_url), staff_page(browser, app_url, "basil", "/operator") as page:
        fill(page.get_by_role("textbox", name="Rehearsal clock", exact=True), typed)
        click(page.get_by_role("button", name="Set clock", exact=True))
        said(page, "Operator status", f"Clock set to {typed[:10]} {typed[11:]} ET.")
        key = tick_key(app_url)
        body = {"id": tick_id(), "instrument": "ETH-USD", "price": "3421.40"}
        assert err(tick(app_url, key, body, header="t=1,v1=" + "0" * 64))["code"] == "bad_signature"
        assert err(tick(app_url, key, body, header="garbage"))["code"] == "bad_signature"
        now = int(market_now(app_url).timestamp())
        r = tick(app_url, key, body, t=now - TICK_WINDOW_S - 10)
        assert r.status_code == 401 and err(r)["code"] == "stale_signature"
        r = tick(app_url, key, body, t=now + TICK_WINDOW_S + 10)
        assert r.status_code == 401 and err(r)["code"] == "stale_signature"
        lo = market_now(app_url)
        r = tick(app_url, key, {**body, "at": "2020-01-01T00:00:00Z"}, t=int(lo.timestamp()) + TICK_WINDOW_S)
        assert r.status_code == 201, f"a signature exactly 300 s ahead is accepted: {r.text}"
        at = iso(r.json()["tick"]["at"])
        assert lo - timedelta(seconds=1) <= at <= market_now(app_url) and at.date() == target.date()
        assert tick(app_url, key, {"id": tick_id(), "instrument": "VLCH", "price": "14.84"}).status_code == 201
        for bad in ({"id": tick_id(), "instrument": "BTC", "price": "1"}, {"id": tick_id(), "instrument": "VLCH", "price": "-1"},
                    {"id": "bad id!", "instrument": "VLCH", "price": "1"}):
            res = tick(app_url, key, bad)
            assert res.status_code == 422 and err(res)["code"] == "validation_failed"
        move_clock(app_url, in_session=False)
        res = tick(app_url, key, {"id": tick_id(), "instrument": "VLCH", "price": "14.79"})
        assert res.status_code == 409 and err(res)["code"] == "session_closed"
        last = tick(app_url, key, {"id": tick_id(), "instrument": "ETH-USD", "price": "3417.15"}).json()["tick"]
        page.goto(app_url + "/")
        wait(page, lambda: expect(clock_group(page, "ETH price")).to_contain_text(f"Live — last tick {hms(last['at'])} ET", timeout=500), "board shows the accepted tick")


def test_wf_price_feed_redelivery_race(browser, app_url):
    with tape_paused(app_url):
        move_clock(app_url, in_session=False)
        key = tick_key(app_url)
        body = {"id": tick_id(), "instrument": "ETH-USD", "price": "3419.96"}
        res = together([lambda: tick(app_url, key, body) for _ in range(8)])
        assert sorted(r.status_code for r in res) == [200] * 7 + [201]
        ticks = {json.dumps(r.json()["tick"], sort_keys=True) for r in res}
        assert len(ticks) == 1, "every delivery answers the identical stored tick"
        at = res[0].json()["tick"]["at"]
        assert mnav_at(app_url, at) == 1
        mixed_id = tick_id()
        res = together([lambda p=p: tick(app_url, key, {"id": mixed_id, "instrument": "ETH-USD", "price": p})
                        for p in ("3418.73", "3418.73", "3418.73", "3420.88", "3420.88", "3420.88")])
        codes = [r.status_code for r in res]
        assert 500 not in codes and codes.count(201) == 1
        win = next(r for r in res if r.status_code == 201).json()["tick"]["price"]
        for r in res:
            if r.status_code != 201:
                same = Decimal(json.loads(r.request.content)["price"]) == Decimal(win)
                assert r.status_code == (200 if same else 409)
        close = iso(cal(app_url, pick_instant(app_url, in_session=True).date())["closes_at"])
        set_clock(app_url, close + timedelta(seconds=5))
        together([lambda: board(app_url) for _ in range(10)])
        poll(lambda: mnav_at(app_url, close.isoformat()) == 1, "the passed close stores its mNAV", CADENCE_S * 3)
        for _ in range(5):
            board(app_url)
        assert mnav_at(app_url, close.isoformat()) == 1, "the close is processed exactly once"
        with board_page(browser, app_url) as page:
            wait(page, lambda: expect(clock_group(page, "ETH price")).to_contain_text(
                rail_lines(board(app_url))["ETH price"], timeout=500), "rail shows the stored tick state")


def test_mnav_ticks_and_closes(app_url):
    with tape_paused(app_url):
        move_clock(app_url, in_session=False)
        t = tick(app_url, tick_key(app_url), {"id": tick_id(), "instrument": "ETH-USD", "price": "3420.88"})
        assert t.status_code == 201
        at = t.json()["tick"]["at"]
        poll(lambda: mnav_at(app_url, at) == 1, "one mNAV at the tick time")
        cur = figure(board(app_url), "mnav")
        assert iso(cur["computed_at"]) == iso(at) and next(i for i in cur["inputs"] if i["key"] == "eth-price")["source"]["id"] == t.json()["tick"]["id"]
        d, closes = market_now(app_url).astimezone(NY).date(), []
        while len(closes) < 2:
            c = cal(app_url, d)
            if c["closes_at"] and iso(c["closes_at"]) > market_now(app_url):
                closes.append(iso(c["closes_at"]))
            d += timedelta(days=1)
        set_clock(app_url, closes[-1] + timedelta(minutes=1))
        for c in closes:
            poll(lambda c=c: mnav_at(app_url, c.isoformat()) == 1, f"one session-close mNAV at {c}", CADENCE_S * 3)
        assert iso(figure(board(app_url), "mnav")["computed_at"]) == closes[-1]


def test_tape_and_staleness():
    base = short()
    op = Api(base, "basil")
    op.json("PUT", "/api/operator/tape", json={"state": "playing"})
    p0 = op.json("GET", "/api/operator/tape")["position"]
    poll(lambda: op.json("GET", "/api/operator/tape")["position"] > p0, "tape position grows while playing", CADENCE_S * 4)
    b = poll(lambda: (lambda x: x if x["clocks"]["eth"]["status"] == "live" else None)(board(base)), "ETH live while playing")
    lt = b["clocks"]["eth"]["last_tick"]
    m = re.fullmatch(r"tape-(\d+)", lt["id"])
    assert m and Decimal(lt["price"]) == Decimal(TAPE_ETH[int(m.group(1)) % 8]), f"tape tick {lt}"
    assert iso(b["server_time"]) - iso(lt["at"]) <= timedelta(seconds=STALE_SHORT_S)
    trade = b["clocks"]["equity"]["last_trade"]
    if trade and trade["id"].startswith("tape-"):
        n = int(re.fullmatch(r"tape-(\d+)-vlch", trade["id"]).group(1))
        assert Decimal(trade["price"]) == Decimal(TAPE_VLCH[n % 4])
    with tape_paused(base):
        assert op.json("GET", "/api/operator/tape")["state"] == "paused"
        pos = op.json("GET", "/api/operator/tape")["position"]
        b = poll(lambda: (lambda x: x if x["clocks"]["eth"]["status"] == "stale" else None)(board(base)),
                 "ETH stale after the threshold", STALE_SHORT_S + 6 * CADENCE_S)
        assert iso(b["server_time"]) - iso(b["clocks"]["eth"]["last_tick"]["at"]) > timedelta(seconds=STALE_SHORT_S)
        assert op.json("GET", "/api/operator/tape")["position"] == pos
    poll(lambda: board(base)["clocks"]["eth"]["status"] == "live", "next tape tick returns the clock to live", CADENCE_S * 4)


def test_rehearsal_clock(app_url):
    op = Api(app_url, "basil")
    target = pick_instant(app_url, in_session=True)
    out = op.json("PUT", "/api/operator/clock", json={"at": target.isoformat()})
    assert out["rehearsal"] is True and abs(iso(out["now"]) - target) < timedelta(seconds=CADENCE_S)
    c = httpx.get(f"{app_url}/api/clock", timeout=HTTP_TIMEOUT).json()
    assert c["rehearsal"] is True and iso(c["now"]) >= iso(out["now"])
    assert iso(c["now"]).utcoffset() == iso(c["now"]).astimezone(NY).utcoffset()
    b = board(app_url)
    assert b["market_date"] == target.astimezone(NY).date().isoformat() and b["clocks"]["equity"]["status"] == "open"
    assert iso(b["clocks"]["equity"]["closes_at"]) == iso(cal(app_url, target.astimezone(NY).date())["closes_at"])
    other = httpx.get(f"{vault_down()}/api/clock", timeout=HTTP_TIMEOUT).json()
    assert other["rehearsal"] is True and abs(iso(other["now"]) - iso(c["now"])) < timedelta(seconds=CADENCE_S)
    assert op.call("PUT", "/api/operator/clock", json={"at": "not-an-instant"}).status_code == 422
    r = Api(app_url, "tamsin").call("PUT", "/api/operator/clock", json={"at": target.isoformat()})
    assert r.status_code == 403 and err(r)["code"] == "forbidden"
    try:
        assert op.json("PUT", "/api/operator/clock", json={"at": None})["rehearsal"] is False
        assert httpx.get(f"{app_url}/api/clock", timeout=HTTP_TIMEOUT).json()["rehearsal"] is False
    finally:
        move_clock(app_url, in_session=False)


def test_session_calendar(app_url):
    holidays = {"2026-01-01": "New Year's Day", "2026-01-19": "Martin Luther King Jr. Day", "2026-02-16": "Washington's Birthday",
                "2026-04-03": "Good Friday", "2026-05-25": "Memorial Day", "2026-06-19": "Juneteenth",
                "2026-07-03": "Independence Day (observed)", "2026-09-07": "Labor Day", "2026-11-26": "Thanksgiving Day",
                "2026-12-25": "Christmas Day"}
    for d, name in holidays.items():
        c = cal(app_url, date.fromisoformat(d))
        assert (c["trading_day"], c["holiday"], c["opens_at"], c["closes_at"]) == (False, name, None, None), d
    for d in ("2026-11-27", "2026-12-24"):
        c = cal(app_url, date.fromisoformat(d))
        assert c["trading_day"] and c["early_close"] and iso(c["closes_at"]) == datetime.combine(date.fromisoformat(d), dtime(13), NY)
    c = cal(app_url, date(2026, 11, 2))
    assert c == {"date": "2026-11-02", "trading_day": True, "holiday": None, "opens_at": "2026-11-02T09:30:00-05:00",
                 "closes_at": "2026-11-02T16:00:00-05:00", "early_close": False}
    weekend = cal(app_url, date(2026, 11, 1))
    assert weekend["trading_day"] is False and weekend["holiday"] is None
    for bad in ("2026-13-01", "02-11-2026", "2027-01-04"):
        assert httpx.get(f"{app_url}/api/session-calendar", params={"date": bad}, timeout=HTTP_TIMEOUT).status_code == 422


def test_tick_redelivery(app_url):
    with tape_paused(app_url):
        move_clock(app_url, in_session=True)
        key = tick_key(app_url)
        first = tick(app_url, key, {"id": tick_id(), "instrument": "VLCH", "price": "14.86"})
        assert first.status_code == 201
        stored = first.json()["tick"]
        again = tick(app_url, key, {"id": stored["id"], "instrument": "VLCH", "price": "14.860"})
        assert again.status_code == 200 and again.json() == {"tick": stored}
        for body in ({"id": stored["id"], "instrument": "VLCH", "price": "14.87"}, {"id": stored["id"], "instrument": "ETH-USD", "price": "14.86"}):
            res = tick(app_url, key, body)
            assert res.status_code == 409 and err(res)["code"] == "tick_id_conflict"
        assert tick(app_url, key, {"id": stored["id"], "instrument": "VLCH", "price": "14.86"}, header="t=1,v1=00").status_code == 401
        move_clock(app_url, in_session=False)
        late = tick(app_url, key, {"id": stored["id"], "instrument": "VLCH", "price": "14.86"})
        assert late.status_code == 200 and late.json() == {"tick": stored}, "redelivery after the close"
        assert mnav_at(app_url, stored["at"]) == 1, "no computation for redeliveries"


def test_staff_sign_in_and_roles(app_url):
    bad = httpx.post(f"{app_url}/api/session", json={"email": STAFF["tamsin"][1], "password": "wrong-password"}, timeout=HTTP_TIMEOUT)
    assert bad.status_code == 401 and err(bad)["code"] == "invalid_credentials"
    assert httpx.post(f"{app_url}/api/session", json={}, timeout=HTTP_TIMEOUT).status_code == 422
    r = httpx.post(f"{app_url}/api/session", json={"email": STAFF["imre"][1], "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and set(r.json()["user"]["roles"]) == {"treasury_analyst", "disclosure_counsel", "disclosure_officer"}
    cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith("tw_session="))
    low = cookie.lower()
    assert all(a.lower() in low for a in ("HttpOnly", "SameSite=Lax", "Path=/"))
    a = Api(app_url, "tamsin")
    twin = a.clone()
    assert twin.get("/api/session").json()["user"]["name"] == STAFF["tamsin"][0]
    assert a.call("DELETE", "/api/session").status_code == 204
    assert err(twin.get("/api/session"))["code"] == "unauthenticated"
    assert httpx.get(f"{app_url}/api/restatements", timeout=HTTP_TIMEOUT).status_code == 401
    forbidden = [(Api(app_url, "rafe"), "POST", "/api/restatements", {"json": {}}),
                 (Api(app_url, "tamsin"), "PUT", "/api/operator/tape", {"json": {"state": "paused"}}),
                 (Api(app_url, "noor"), "GET", "/api/operator/tape", {})]
    for who, method, path, kw in forbidden:
        res = who.call(method, path, **kw)
        assert res.status_code == 403 and err(res)["code"] == "forbidden", f"{method} {path}: {res.status_code}"
    s = Api(short(), "tamsin")
    deadline = time.monotonic() + IDLE_SHORT_S + 6
    while time.monotonic() < deadline:
        assert s.call("GET", "/api/session").status_code == 200, "each request restarts the idle period"
        poll(lambda: True, "pace")
        httpx.get(f"{short()}/api/health", timeout=HTTP_TIMEOUT)
        threading.Event().wait(2)
    last = time.monotonic()
    poll(lambda: time.monotonic() - last > IDLE_SHORT_S + 2 and httpx.get(f"{short()}/api/health", timeout=HTTP_TIMEOUT).status_code == 200,
         "idle limit passes", IDLE_SHORT_S + 10)
    res = s.call("GET", "/api/session")
    assert res.status_code == 401 and err(res)["code"] == "unauthenticated"


def test_draft_sequence_rules(app_url):
    settle_open(app_url)
    tam, imre = Api(app_url, "tamsin"), Api(app_url, "imre")
    prior = latest(tam)
    nxt = date.fromisoformat(prior["week_ending"]) + timedelta(days=7)
    end = datetime.combine(nxt, dtime(23, 59, 59), NY)
    if market_now(app_url) >= end:
        set_clock(app_url, end - timedelta(minutes=5))
    res = tam.call("POST", "/api/restatements", json={})
    assert res.status_code == 409 and err(res)["code"] == "week_not_ended"
    move_clock(app_url, in_session=False, earliest=nxt + timedelta(days=1))
    res = tam.call("POST", "/api/restatements", json={"week_ending": (nxt + timedelta(days=7)).isoformat()})
    assert res.status_code == 409 and err(res)["code"] == "week_out_of_sequence"
    r = tam.json("POST", "/api/restatements", 201, json={})["restatement"]
    assert (r["week_ending"], r["state"], r["version"], r["share_events"], r["exhibit_page"]) == (nxt.isoformat(), "draft", 1, [], None)
    assert all(v is None for v in r["rows"].values()) and r["prepared_by"]["name"] == STAFF["tamsin"][0]
    assert [(e["action"], e["from_state"], e["to_state"]) for e in trail(tam, r["id"])] == [("create", None, "draft")]
    for body in ({}, {"supersedes": prior["id"]}):
        res = imre.call("POST", "/api/restatements", json=body)
        assert res.status_code == 409 and err(res)["code"] == "restatement_open"
    stale = next(x for x in rs(tam) if x["state"] == "superseded")
    res = imre.call("POST", "/api/restatements", json={"supersedes": stale["id"]})
    assert res.status_code == 409 and err(res)["code"] == "not_latest_week"
    assert sum(1 for x in rs(tam) if x["state"] in OPEN_STATES) == 1


def test_holdings_arithmetic(app_url):
    an, r = editable_draft(app_url)
    o = one(an, r["supersedes"])["rows"]
    b1 = Decimal(o["beginning-balance"]) + 1
    bad = {"beginning-balance": format(b1, "f"), "eth-acquired": o["eth-acquired"], "staking-rewards": o["staking-rewards"],
           "ending-balance": format(b1 + Decimal(o["eth-acquired"]) + Decimal(o["staking-rewards"]), "f"),
           "cumulative-staking-rewards": format(Decimal(o["cumulative-staking-rewards"]) + 1, "f"),
           "diluted-shares": str(int(o["diluted-shares"]) + 1)}
    before = one(an, r["id"])
    res = an.call("PATCH", f"/api/restatements/{r['id']}", json={"version": before["version"], "rows": bad})
    assert res.status_code == 422 and err(res)["message"] == "Some fields need attention."
    assert set(err(res)["fields"]) == {"rows.beginning-balance", "rows.cumulative-staking-rewards", "rows.diluted-shares"}
    assert one(an, r["id"]) == before
    acq = Decimal(o["eth-acquired"]) + Decimal("0.100000000000000001")
    rew = Decimal(o["staking-rewards"]) + Decimal("0.2")
    good = dict(o, **{"eth-acquired": format(acq, "f"), "staking-rewards": format(rew, "f") + "0",
                      "cumulative-staking-rewards": format(Decimal(o["cumulative-staking-rewards"]) + Decimal("0.2"), "f")})
    near = format(Decimal(o["beginning-balance"]) + Decimal(o["eth-acquired"]) + Decimal(o["staking-rewards"]) + Decimal("0.3"), "f")
    res = an.call("PATCH", f"/api/restatements/{r['id']}", json={"version": before["version"], "rows": dict(good, **{"ending-balance": near})})
    assert res.status_code == 422 and set(err(res)["fields"]) == {"rows.ending-balance"}
    good["ending-balance"] = format(Decimal(o["beginning-balance"]) + acq + rew, "f")
    saved = save(an, before, rows=good)
    assert saved["rows"] == good and one(an, r["id"])["rows"]["staking-rewards"].endswith("0")
    res = an.call("PATCH", f"/api/restatements/{r['id']}", json={"version": saved["version"],
                                                                "rows": dict(good, **{"eth-acquired": "-1", "diluted-shares": "1.5"})})
    assert res.status_code == 422 and {"rows.eth-acquired", "rows.diluted-shares"} <= set(err(res)["fields"])


def test_wf_drafting_effective_dated(browser, app_url):
    r = new_correction(app_url)
    an = Api(app_url, "tamsin")
    week = date.fromisoformat(r["week_ending"])
    extra = [{"kind": "atm_settlement", "shares": str(ATM_SHARES), "effective_date": (week - timedelta(days=3)).isoformat()},
             {"kind": "warrant_exercise", "shares": str(WARRANT_SHARES), "effective_date": (week - timedelta(days=2)).isoformat()},
             {"kind": "buyback", "shares": str(BUYBACK_SHARES), "effective_date": (week - timedelta(days=1)).isoformat()}]
    rows, events = event_rows(an, r, extra)
    res = an.call("PATCH", f"/api/restatements/{r['id']}", json={"version": r["version"], "share_events": [
        {"kind": "buyback", "shares": str(int(rows["diluted-shares"]) * 2), "effective_date": extra[0]["effective_date"]}]})
    assert res.status_code == 422 and "share_events.0.shares" in err(res)["fields"]
    accession = acc()
    with staff_page(browser, app_url, "tamsin", f"/staff/restatements/{r['id']}") as page:
        ui_fill(page, rows, accession, REASON)
        for n, e in enumerate(events):
            click(page.get_by_role("button", name="Add share-count event", exact=True))
            select(page.get_by_role("combobox", name="Event type", exact=True).nth(n), EVENT_LABELS[e["kind"]])
            fill(page.get_by_role("textbox", name="Shares", exact=True).nth(n), e["shares"])
            fill(page.get_by_role("textbox", name="Effective date", exact=True).nth(n), e["effective_date"])
        click(page.get_by_role("button", name="Save draft", exact=True))
        said(page, "Staff updates", "Draft saved.")
    stored = one(an, r["id"])
    assert [{k: e[k] for k in ("kind", "shares", "effective_date")} for e in stored["share_events"]] == events
    up = put_exhibit(an, stored, make_pdf(label()))
    assert up.status_code == 201
    publish_now(app_url, clear(app_url, submit(app_url, up.json()["restatement"])))
    hist = board(app_url)["history"]
    new = next(h for h in hist if h["restatement_id"] == r["id"])
    old = next(h for h in hist if h["restatement_id"] == r["supersedes"])
    assert int(new["diluted_shares"]) == int(rows["diluted-shares"]) and int(old["diluted_shares"]) != int(new["diluted_shares"])
    oldc = httpx.get(f"{app_url}/api/computations/{old['eth_per_1000_diluted']['computation_id']}", timeout=HTTP_TIMEOUT).json()["computation"]
    assert int(next(i for i in oldc["inputs"] if i["key"] == "diluted-shares")["value"]) == int(old["diluted_shares"])
    seedc = citation(app_url, "eth-per-1000-diluted", "2026-10-20").json()["computation"]
    assert int(next(i for i in seedc["inputs"] if i["key"] == "diluted-shares")["value"]) == int("150,650,000".replace(",", ""))


def test_wf_drafting_mass_assignment(browser, app_url):
    settle_open(app_url)
    ensure_fresh_week(app_url)
    an = Api(app_url, "tamsin")
    lp = latest(an)
    count = len(rs(an))
    res = an.call("POST", "/api/restatements", json={"supersedes": lp["id"], "week_ending": lp["week_ending"], "state": "published", "version": 3})
    assert res.status_code == 422 and {k: err(res)["fields"].get(k) for k in ("week_ending", "state", "version")} == dict.fromkeys(("week_ending", "state", "version"), CANNOT_CHANGE)
    assert len(rs(an)) == count, "a refused create stores nothing"
    with staff_page(browser, app_url, "tamsin", "/staff/restatements") as page:
        click(page.get_by_role("button", name="Start correction", exact=True))
        rid = editor_id(page)
        for text in ROW_LABELS.values():
            expect(page.get_by_role("textbox", name=text, exact=True)).to_have_value("")
    r = one(an, rid)
    assert r["supersedes"] == lp["id"] and r["state"] == "draft"
    rows, _ = week_rows(an, r)
    body = {"version": r["version"], "state": "cleared", "prepared_by": {"id": "x"}, "exhibit": None, "week_ending": r["week_ending"],
            "rows": dict(rows, **{"ending-balance": "1", "bonus-row": "1"}),
            "share_events": [{"id": "ignored", "kind": "atm_settlement", "shares": "1", "effective_date": r["week_ending"], "colour": "red"}]}
    res = an.call("PATCH", f"/api/restatements/{rid}", json=body)
    fields = err(res)["fields"]
    assert res.status_code == 422
    for k in ("state", "prepared_by", "exhibit", "week_ending", "rows.bonus-row", "share_events.0.colour"):
        assert fields.get(k) == CANNOT_CHANGE, k
    assert "rows.ending-balance" in fields and "share_events.0.id" not in fields
    assert one(an, rid) == r, "byte-identical after a refused save"


def test_wf_drafting_session_resume(browser, app_url):
    an, r = editable_draft(app_url)
    rows, _ = week_rows(an, r)
    with staff_page(browser, app_url, "tamsin", f"/staff/restatements/{r['id']}") as page:
        patches = []
        page.on("request", lambda q: patches.append(q.post_data) if q.method == "PATCH" else None)
        accession = acc()
        ui_fill(page, rows, accession, REASON)
        page.request.delete(app_url + "/api/session")
        click(page.get_by_role("button", name="Save draft", exact=True))
        dlg = page.get_by_role("dialog", name="Sign in to continue", exact=True)
        wait(page, lambda: expect(dlg).to_be_visible(timeout=500), "sign-in dialog opens")
        expect(dlg).to_contain_text("Your session ended. Sign in again to finish this action.")
        expect(dlg.get_by_role("textbox", name="Email", exact=True)).to_be_focused()
        expect(page.get_by_role("textbox", name="Accession number", exact=True)).to_have_value(accession)
        ui_sign_in(page, "tamsin", scope=dlg)
        said(page, "Staff updates", "Draft saved.")
        assert len(patches) == 2 and patches[0] == patches[1], "the interrupted body is resent once, identical"
        saved = one(an, r["id"])
        assert saved["accession"] == accession and saved["rows"] == rows
        assert [e["action"] for e in trail(an, r["id"])].count("edit") == [e["action"] for e in trail(an, r["id"])].count("edit")
        page.request.delete(app_url + "/api/session")
        click(page.get_by_role("button", name="Save draft", exact=True))
        wait(page, lambda: expect(dlg).to_be_visible(timeout=500), "sign-in dialog reopens")
        ui_sign_in(page, "imre", scope=dlg)
        said(page, "Staff updates", "Signed in as Imre Castellanos. The interrupted action was not sent.")
        assert len(patches) == 3 and one(an, r["id"])["version"] == saved["version"]


def test_vault_confirmed_attachment(app_url):
    an = Api(app_url, "tamsin")
    r = new_correction(app_url)
    pdf = make_pdf(label(), extra=b" /JSON true /URIs true")
    res = put_exhibit(an, r, pdf)
    assert res.status_code == 422 and set(err(res)["fields"]) == {"accession"}
    rows, events = week_rows(an, r)
    r = save(an, one(an, r["id"]), rows=rows, share_events=events, accession=acc(), exhibit_page=1, correction_reason=REASON)
    res = an.c.put(f"/api/restatements/{r['id']}/exhibit", content=pdf, headers={"Content-Type": "application/pdf"})
    assert res.status_code == 422 and "sha256" in err(res)["fields"]
    res = put_exhibit(an, r, pdf, claimed="0" * 64)
    assert res.status_code == 422 and "sha256" in err(res)["fields"]
    rej = one(an, r["id"])
    assert rej["exhibit"]["status"] == "rejected" and rej["exhibit"]["key"] is None and rej["version"] == r["version"] + 2
    assert [e["action"] for e in trail(an, r["id"])[-2:]] == ["exhibit_pending", "exhibit_rejected"]
    assert len(S3().keys(f"incoming/{r['id']}/")) == 1 and S3().keys(f"exhibits/{r['accession']}/") == []
    res = an.call("POST", f"/api/restatements/{r['id']}/submit", json={})
    assert res.status_code == 409 and err(res)["code"] == "exhibit_not_verified"
    ok = put_exhibit(an, rej, pdf)
    assert ok.status_code == 201, "/JSON and /URIs are whole names that pass"
    ex = ok.json()["restatement"]["exhibit"]
    assert ex == {"status": "verified", "sha256": sha(pdf), "bytes": len(pdf), "key": f"exhibits/{r['accession']}/{sha(pdf)}.pdf"}
    assert S3().get(ex["key"]) == pdf and ok.json()["restatement"]["version"] == rej["version"] + 2
    assert an.call("POST", f"/api/restatements/{r['id']}/submit", json={}).status_code == 200


FORBIDDEN_IDS = ["javascript_escaped", "js", "launch", "embedded_file", "encrypt", "uri", "submit_form", "not_complete"]
FORBIDDEN = {"javascript_escaped": b" /J#61vaScript true", "js": b" /JS true", "launch": b" /Launch true",
             "embedded_file": b" /EmbeddedFile true", "encrypt": b" /Encrypt true", "uri": b" /URI(x)",
             "submit_form": b" /SubmitForm true", "not_complete": b""}


@pytest.mark.parametrize("case", FORBIDDEN_IDS, ids=FORBIDDEN_IDS)
def test_filing_safe_exhibits(app_url, case):
    an, r = editable_draft(app_url)
    pdf = make_pdf(label(), extra=FORBIDDEN[case], eof=case != "not_complete")
    message = ("The exhibit is not a complete PDF." if case == "not_complete"
               else "The exhibit contains active content, links, embedded files or encryption.")
    before, staged, entries = one(an, r["id"]), S3().keys(f"incoming/{r['id']}/"), len(trail(an, r["id"]))
    for client in (an, Api(vault_down(), "tamsin")):
        res = put_exhibit(client, before, pdf)
        assert res.status_code == 422 and err(res)["fields"] == {"file": message}, f"{client.base}: {res.text[:200]}"
    assert one(an, r["id"]) == before and S3().keys(f"incoming/{r['id']}/") == staged and len(trail(an, r["id"])) == entries


def test_wf_exhibit_vault_upload_ui(browser, app_url):
    an, r = editable_draft(app_url)
    with staff_page(browser, app_url, "tamsin", f"/staff/restatements/{r['id']}") as page:
        chooser = page.get_by_label("Exhibit PDF")
        expect(page.get_by_text("No exhibit attached", exact=True)).to_be_visible()
        cases = [(make_pdf(label(), extra=b" /URI(x)"), "This PDF contains active content, links, embedded files or encryption. Print it to a new PDF and try again."),
                 (make_pdf(label(), eof=False), "Choose a PDF file."),
                 (b"%PDF-" + b"0" * EXHIBIT_LIMIT + b"%%EOF", "The exhibit is larger than the size limit.")]
        for pdf, copy in cases:
            chooser.set_input_files(file_payload(pdf))
            said(page, "Exhibit upload", copy)
            expect(page.get_by_text("No exhibit attached", exact=True)).to_be_visible()
        assert S3().keys(f"incoming/{r['id']}/") == [], "refusals reach no vault object"
        page.route("**/api/restatements/*/exhibit", lambda route: route.continue_(headers={**route.request.headers, "x-exhibit-sha256": "0" * 64}))
        chooser.set_input_files(file_payload(make_pdf(label())))
        said(page, "Exhibit upload", "Exhibit rejected — the vault copy's SHA-256 does not match the file you chose.")
        wait(page, lambda: expect(page.get_by_text("Exhibit rejected — SHA-256 mismatch", exact=True)).to_be_visible(timeout=500), "rejected state")
        page.unroute("**/api/restatements/*/exhibit")
        pdf = make_pdf(label())
        with held(page, "**/api/restatements/*/exhibit") as gate:
            chooser.set_input_files(file_payload(pdf))
            said(page, "Exhibit upload", "Uploading exhibit and checking SHA-256...")
            expect(page.get_by_text("Exhibit pending verification", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="Send to disclosure counsel", exact=True)).to_be_disabled()
            gate.release()
        said(page, "Exhibit upload", f"Exhibit verified — SHA-256 {sha(pdf)} matches the vault copy.")
        wait(page, lambda: expect(page.get_by_text("Exhibit verified", exact=True)).to_be_visible(timeout=500), "verified state")
        expect(page.get_by_role("button", name="Send to disclosure counsel", exact=True)).to_be_enabled()
    stored = one(an, r["id"])["exhibit"]
    assert stored["status"] == "verified" and S3().get(stored["key"]) == pdf


from conftest import held


def test_wf_exhibit_vault_bytes(browser, app_url):
    c = figure(board(app_url), "eth-held")
    accession, digest, _ = exhibit_of(c)
    stored = S3().get(f"exhibits/{accession}/{digest}.pdf")
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(tile(page, "eth-held")).to_be_visible(timeout=500), "tile")
        click(tile(page, "eth-held"))
        dlg = trace(page, "eth-held")
        settle(page, OPEN_MS)
        expect(dlg).to_contain_text(f"SHA-256 {digest}")
        link = dlg.get_by_role("link", name=f"Open exhibit {accession}", exact=True)
        expect(link).to_have_attribute("href", f"/api/exhibits/{digest}")
        with page.expect_download() as info:
            click(link)
        dl = info.value
        assert dl.suggested_filename == f"{accession}.pdf" and Path(dl.path()).read_bytes() == stored and sha(stored) == digest
        expect(dlg).to_be_visible()
    size = len(stored)
    r = anon_exhibit(app_url, digest)
    h = r.headers
    assert r.status_code == 200 and r.content == stored and h["etag"] == f'"{digest}"' and h["accept-ranges"] == "bytes"
    assert h["x-content-type-options"] == "nosniff" and h["cache-control"] == "public, max-age=31536000, immutable"
    assert h["content-type"].startswith("application/pdf") and h["x-exhibit-sha256"] == digest
    assert h["content-disposition"] == f'attachment; filename="{accession}.pdf"'
    for rng, lo, hi in (("bytes=0-9", 0, 9), ("bytes=5-", 5, size - 1), ("bytes=-5", size - 5, size - 1), (f"bytes=0-{size + 100}", 0, size - 1)):
        p = anon_exhibit(app_url, digest, Range=rng)
        assert p.status_code == 206 and p.content == stored[lo:hi + 1] and p.headers["content-range"] == f"bytes {lo}-{hi}/{size}", rng
    for rng in (f"bytes={size}-", "bytes=-0"):
        p = anon_exhibit(app_url, digest, Range=rng)
        assert p.status_code == 416 and p.headers["content-range"] == f"bytes */{size}"
    for rng in ("bytes=0-1,3-4", "pages=1"):
        assert anon_exhibit(app_url, digest, Range=rng).content == stored
    for tag in (f'"{digest}"', "*"):
        n = anon_exhibit(app_url, digest, **{"If-None-Match": tag})
        assert n.status_code == 304 and n.content == b""
    seed_old = next(x for x in board(app_url)["history"] if x["exhibit"]["accession"] == "0002093117-26-000044")["exhibit"]["sha256"]
    assert anon_exhibit(app_url, seed_old).content == S3().get(f"exhibits/0002093117-26-000044/{seed_old}.pdf")
    an, d = editable_draft(app_url)
    d = save(an, d, accession=accession)
    again = put_exhibit(an, d, stored)
    assert again.status_code == 201 and again.json()["restatement"]["exhibit"]["key"] == f"exhibits/{accession}/{digest}.pdf"
    assert S3().keys(f"exhibits/{accession}/") == [f"exhibits/{accession}/{digest}.pdf"] and S3().get(f"exhibits/{accession}/{digest}.pdf") == stored


def test_wf_exhibit_vault_unreleased(browser, app_url):
    def shape(r):
        return r.status_code, r.content, {k for k in r.headers if k not in ("date", "x-request-id")}

    unknown = "f" * 64
    an, r = editable_draft(app_url, exhibit=True)
    digest = r["exhibit"]["sha256"]
    bad = put_exhibit(an, r, make_pdf(label()), claimed="e" * 64)
    assert bad.status_code == 422
    r, _ = make_ready(app_url, one(an, r["id"]))
    digest = r["exhibit"]["sha256"]
    for hdrs in ({}, {"If-None-Match": f'"{digest}"'}, {"Range": "bytes=0-9"}):
        assert shape(anon_exhibit(app_url, digest, **hdrs)) == shape(anon_exhibit(app_url, unknown, **hdrs))
        assert shape(anon_exhibit(vault_down(), digest, **hdrs))[0] == 404
    assert an.call("GET", f"/api/exhibits/{'e' * 64}").status_code == 404
    staff = an.call("GET", f"/api/exhibits/{digest}")
    assert staff.status_code == 200 and staff.headers["cache-control"] == "private, no-store"
    r = clear(app_url, submit(app_url, r))
    assert anon_exhibit(app_url, digest).status_code == 404
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(history(page)).to_be_visible(timeout=500), "history")
        expect(page.get_by_role("link", name=f"Exhibit {r['accession']}", exact=True)).to_have_count(0)
        publish_now(app_url, r)
        wait(page, lambda: expect(page.get_by_role("link", name=f"Exhibit {r['accession']}", exact=True)).to_be_visible(timeout=500), "published row", CADENCE_S * 4)
    pub = anon_exhibit(app_url, digest)
    assert pub.status_code == 200 and pub.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_wf_exhibit_vault_double_drop(browser, app_url):
    an, r = editable_draft(app_url)
    v = r["version"]
    pdf = make_pdf(label())
    with staff_page(browser, app_url, "tamsin", f"/staff/restatements/{r['id']}") as page:
        with held(page, "**/api/restatements/*/exhibit") as gate:
            page.get_by_label("Exhibit PDF").set_input_files(file_payload(pdf))
            page.get_by_label("Exhibit PDF").set_input_files(file_payload(pdf))
            gate.release()
        said(page, "Exhibit upload", f"Exhibit verified — SHA-256 {sha(pdf)} matches the vault copy.")

        def both_stored():
            assert one(an, r["id"])["version"] == v + 4, "second drop not stored yet"
        wait(page, both_stored, "both dropped uploads stored")
    pdf2 = make_pdf(label())
    res = together([lambda: put_exhibit(an.clone(), r, pdf2) for _ in range(4)])
    assert [x.status_code for x in res] == [201] * 4
    versions = sorted(x.json()["restatement"]["version"] for x in res)
    assert len(set(versions)) == 4
    final = one(an, r["id"])
    assert final["version"] == v + 12
    top = max(res, key=lambda x: x.json()["restatement"]["version"]).json()["restatement"]
    assert final["exhibit"] == top["exhibit"]
    entries = trail(an, r["id"])
    assert [e["version"] for e in entries] == list(range(1, v + 13))
    assert [e["action"] for e in entries[v:]] == ["exhibit_pending", "exhibit_verified"] * 6
    assert sorted(S3().keys(f"exhibits/{r['accession']}/")) == sorted(f"exhibits/{r['accession']}/{sha(p)}.pdf" for p in (pdf, pdf2))
    assert len(S3().keys(f"incoming/{r['id']}/")) >= 6 and S3().get(f"exhibits/{r['accession']}/{sha(pdf2)}.pdf") == pdf2


def test_counsel_review(app_url):
    r, _ = make_ready(app_url, new_correction(app_url))
    r = submit(app_url, r)
    rafe = Api(app_url, "rafe")
    res = rafe.call("POST", f"/api/restatements/{r['id']}/return", json={"note": "too short"})
    assert res.status_code == 422 and "note" in err(res)["fields"]
    back = rafe.json("POST", f"/api/restatements/{r['id']}/return", json={"note": NOTE})["restatement"]
    assert back["state"] == "returned" and back["return_note"] == NOTE and back["version"] == r["version"] + 1
    e = trail(rafe, r["id"])[-1]
    assert (e["action"], e["actor"]["name"], e["note"]) == ("return", STAFF["rafe"][0], NOTE)
    r = submit(app_url, back)
    for checked in (ROW_KEYS[:5], ROW_KEYS[:5] + ROW_KEYS[:1]):
        res = rafe.call("POST", f"/api/restatements/{r['id']}/clear", json={"checked": checked, "version": r["version"]})
        assert res.status_code == 422 and "checked" in err(res)["fields"]
    res = Api(app_url, "tamsin").call("POST", f"/api/restatements/{r['id']}/clear", json={"checked": ROW_KEYS, "version": r["version"]})
    assert res.status_code == 403 and err(res)["code"] == "forbidden"
    done = rafe.json("POST", f"/api/restatements/{r['id']}/clear", json={"checked": ROW_KEYS, "version": r["version"]})["restatement"]
    assert done["state"] == "cleared" and done["cleared_by"]["name"] == STAFF["rafe"][0] and done["version"] == r["version"] + 1


def test_wf_review_and_release_two_person(browser, app_url):
    settle_open(app_url)
    ensure_fresh_week(app_url)
    imre = Api(app_url, "imre")
    r = imre.json("POST", "/api/restatements", 201, json={"supersedes": latest(imre)["id"]})["restatement"]
    r, _ = make_ready(app_url, r)
    r = submit(app_url, r)
    for path, body in (("clear", {"checked": ROW_KEYS, "version": r["version"]}), ("return", {"note": NOTE})):
        res = imre.call("POST", f"/api/restatements/{r['id']}/{path}", json=body)
        assert res.status_code == 403 and err(res)["code"] == "preparer_cannot_clear"
    r = clear(app_url, r, who="wren")
    for who, code_ in (("imre", "preparer_cannot_release"), ("wren", "clearer_cannot_release"), ("tamsin", "forbidden"), ("rafe", "forbidden")):
        res = release(app_url, r, who=who)
        assert res.status_code == 403 and err(res)["code"] == code_, who
    with staff_page(browser, app_url, "wren", f"/staff/restatements/{r['id']}") as page:
        click(page.get_by_role("button", name="Release restatement", exact=True))
        dlg = page.get_by_role("dialog", name="Release restatement", exact=True)
        check(dlg.get_by_role("checkbox", name="I confirm this restatement is cleared for release", exact=True))
        click(dlg.get_by_role("button", name="Release", exact=True))
        said(page, "Release status", TWO_PERSON, scope=dlg)
    assert one(imre, r["id"])["state"] == "cleared"
    q = queue(app_url, r)
    res = imre.call("POST", f"/api/restatements/{r['id']}/withdraw", json={"version": q["version"], "note": NOTE})
    assert res.status_code == 403 and err(res)["code"] == "preparer_cannot_release"
    assert Api(app_url, "wren").call("POST", f"/api/restatements/{r['id']}/withdraw", json={"version": q["version"], "note": NOTE}).status_code == 200


def test_wf_review_and_release_cross_site(browser, app_url):
    r, _ = cleared_correction(app_url)
    noor = Api(app_url, "noor")
    before, entries = one(noor, r["id"]), len(trail(noor, r["id"]))
    path = f"/api/restatements/{r['id']}/release"
    for headers, body in (({"Origin": FOREIGN}, None), ({"Origin": "null"}, None), ({"Sec-Fetch-Site": "cross-site"}, None),
                          ({"Sec-Fetch-Site": "same-site"}, None),
                          ({"Origin": FOREIGN, "Content-Type": "application/x-www-form-urlencoded"}, "confirm=true"),
                          ({"Origin": FOREIGN, "Content-Type": "application/json"}, "x" * (JSON_LIMIT + 1))):
        kw = {"content": body} if body is not None else {"json": {"confirm": True}}
        res = noor.c.post(path, headers=headers, **kw)
        assert res.status_code == 403 and err(res)["code"] == "cross_origin", f"{headers}: {res.status_code}"
        assert not any(k.lower().startswith("access-control-") for k in res.headers)
    page_html = (f'<form method="post" action="{app_url}{path}"><input name="confirm" value="true"></form>'
                 '<script>document.forms[0].submit()</script>').encode()
    with foreign_site(page_html) as url, staff_page(browser, app_url, "noor", f"/staff/restatements/{r['id']}") as page:
        with page.expect_response(lambda x: path in x.url) as info:
            with contextlib.suppress(Exception):
                page.goto(url, wait_until="commit")
        assert info.value.status == 403
    assert one(noor, r["id"]) == before and len(trail(noor, r["id"])) == entries
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    move_clock(app_url, in_session=False)
    ok = noor.c.post(path, json={"confirm": True}, headers={"Origin": origin, "Idempotency-Key": uuid.uuid4().hex})
    assert ok.status_code == 200, "a same-origin release is judged by its other rules"


def test_wf_review_and_release_queued_close(browser, app_url):
    r, pdf = cleared_correction(app_url)
    prior = one(Api(app_url, "rafe"), r["supersedes"])
    q = queue(app_url, r)
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(history(page).get_by_role("link", name=re.compile(r"^Exhibit ")).first).to_have_text(prior["accession"], timeout=500), "board shows the prior week")
        advance(page, CADENCE_S * 2000)
        expect(page.get_by_role("link", name=f"Exhibit {r['accession']}", exact=True)).to_have_count(0)
        assert anon_exhibit(app_url, sha(pdf)).status_code == 404
        set_clock(app_url, iso(q["release_at"]) + timedelta(hours=2))
        pub = wait_state(Api(app_url, "rafe"), r["id"], "published", CADENCE_S * 3)
        assert iso(pub["published_at"]) == iso(q["release_at"])
        wait(page, lambda: expect(history(page).get_by_role("link", name=re.compile(r"^Exhibit ")).first).to_have_text(r["accession"], timeout=500), "board shows it once published", CADENCE_S * 4)
    publishes = [e for e in trail(Api(app_url, "rafe"), r["id"]) if e["action"] == "publish"]
    assert len(publishes) == 1 and publishes[0]["actor"] is None and iso(publishes[0]["at"]) == iso(q["release_at"])
    assert anon_exhibit(app_url, sha(pdf)).content == pdf
    assert iso(figure(board(app_url), "eth-held")["computed_at"]) == iso(q["release_at"])


def test_wf_review_and_release_weekly_journey(browser, app_url):
    settle_open(app_url)
    api = Api(app_url, "tamsin")
    p = latest(api)["rows"]
    nxt = date.fromisoformat(latest(api)["week_ending"]) + timedelta(days=7)
    move_clock(app_url, in_session=False, earliest=nxt + timedelta(days=1))
    rows = {"beginning-balance": p["ending-balance"], "eth-acquired": "1.5", "staking-rewards": "0.25",
            "ending-balance": format(Decimal(p["ending-balance"]) + Decimal("1.75"), "f"),
            "cumulative-staking-rewards": format(Decimal(p["cumulative-staking-rewards"]) + Decimal("0.25"), "f"),
            "diluted-shares": p["diluted-shares"]}
    accession, pdf = acc(), make_pdf(label())
    with staff_page(browser, app_url, "tamsin", "/staff/restatements") as page:
        click(page.get_by_role("button", name="New weekly draft", exact=True))
        rid = editor_id(page)
        ui_fill(page, rows, accession)
        click(page.get_by_role("button", name="Save draft", exact=True))
        said(page, "Staff updates", "Draft saved.")
        page.get_by_label("Exhibit PDF").set_input_files(file_payload(pdf))
        said(page, "Exhibit upload", f"Exhibit verified — SHA-256 {sha(pdf)} matches the vault copy.")
        click(page.get_by_role("button", name="Send to disclosure counsel", exact=True))
        said(page, "Staff updates", "Sent to disclosure counsel.")
    with staff_page(browser, app_url, "rafe", f"/staff/restatements/{rid}") as page:
        for text in ROW_LABELS.values():
            check(page.get_by_role("checkbox", name=f"Matches exhibit: {text}", exact=True))
        click(page.get_by_role("button", name="Clear for release", exact=True))
        said(page, "Staff updates", "Cleared for release.")
    move_clock(app_url, in_session=False)
    with staff_page(browser, app_url, "noor", f"/staff/restatements/{rid}") as page:
        click(page.get_by_role("button", name="Release restatement", exact=True))
        dlg = page.get_by_role("dialog", name="Release restatement", exact=True)
        check(dlg.get_by_role("checkbox", name="I confirm this restatement is cleared for release", exact=True))
        click(dlg.get_by_role("button", name="Release", exact=True))
        pub = wait_state(api, rid, "published")
        said(page, "Release status", f"Released — published at {hms(pub['published_at'])} ET on {nyday(pub['published_at'])}.", scope=dlg)
    assert (pub["week_ending"], pub["rows"], pub["prepared_by"]["name"], pub["cleared_by"]["name"], pub["released_by"]["name"]) == \
        (nxt.isoformat(), rows, STAFF["tamsin"][0], STAFF["rafe"][0], STAFF["noor"][0])
    held_ = figure(board(app_url), "eth-held")
    assert held_["restatement_id"] == rid
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(tile(page, "eth-held")).to_contain_text(held_["display"], timeout=500), "tile shows the new week")
        expect(clock_group(page, "Holdings week")).to_contain_text(f"Week ending {nxt.isoformat()}")
        click(tile(page, "eth-held"))
        settle(page, OPEN_MS)
        with page.expect_download() as info:
            click(trace(page, "eth-held").get_by_role("link", name=f"Open exhibit {accession}", exact=True))
        assert Path(info.value.path()).read_bytes() == pdf
    assert S3().get(f"exhibits/{accession}/{sha(pdf)}.pdf") == pdf and anon_exhibit(app_url, sha(pdf)).content == pdf


def test_release_timing_by_session(app_url):
    r, _ = cleared_correction(app_url)
    q = queue(app_url, r)
    assert iso(q["release_at"]) == iso(cal(app_url, market_now(app_url).astimezone(NY).date())["closes_at"])
    assert q["version"] == r["version"] + 1 and trail(Api(app_url, "rafe"), r["id"])[-1]["action"] == "release_queued"
    w = Api(app_url, "noor").json("POST", f"/api/restatements/{r['id']}/withdraw", json={"version": q["version"], "note": NOTE})["restatement"]
    lo = move_clock(app_url, in_session=False)
    out = release(app_url, w)
    pub = out.json()["restatement"]
    assert out.status_code == 200 and out.json()["outcome"] == "published" and pub["release_at"] is None
    assert lo <= iso(pub["published_at"]) <= market_now(app_url) and pub["version"] == w["version"] + 1
    e = trail(Api(app_url, "rafe"), r["id"])[-1]
    assert (e["action"], e["actor"]["name"], e["version"]) == ("publish", STAFF["noor"][0], pub["version"])
    assert one(Api(app_url, "rafe"), r["id"])["version"] == pub["version"]


def test_release_replay_and_races(app_url):
    r, _ = cleared_correction(app_url)
    move_clock(app_url, in_session=True)
    k = uuid.uuid4().hex
    first = release(app_url, r, key=k)
    assert first.status_code == 202
    entries = len(trail(Api(app_url, "rafe"), r["id"]))
    again = release(app_url, r, key=k)
    assert again.status_code == 202 and again.json() == first.json()
    assert release(app_url, r).status_code == 409
    w = Api(app_url, "noor").json("POST", f"/api/restatements/{r['id']}/withdraw", json={"version": first.json()["restatement"]["version"], "note": NOTE})["restatement"]
    replay = release(app_url, r, key=k)
    assert replay.status_code == 202 and replay.json() == first.json() and one(Api(app_url, "rafe"), r["id"])["state"] == "cleared"
    assert len(trail(Api(app_url, "rafe"), r["id"])) == entries + 1, "replays write no audit entry"
    seed = next(x for x in rs(Api(app_url, "rafe")) if x["accession"] == "0002093117-26-000041")
    res = release(app_url, seed, key=k)
    assert res.status_code == 409 and err(res)["code"] == "idempotency_conflict"
    res = together([lambda: release(app_url, w) for _ in range(6)])
    codes = sorted(x.status_code for x in res)
    assert codes.count(202) + codes.count(200) == 1 and codes.count(409) == 5
    assert all(err(x)["code"] == "invalid_transition" for x in res if x.status_code == 409)


def test_guarded_transitions(app_url):
    an, d = editable_draft(app_url)
    rafe, noor = Api(app_url, "rafe"), Api(app_url, "noor")
    calls = [(rafe, "return", {"note": NOTE}), (rafe, "clear", {"checked": ROW_KEYS, "version": d["version"]}),
             (noor, "release", {"confirm": True}), (noor, "withdraw", {"version": d["version"], "note": NOTE})]
    for who, path, body in calls:
        res = who.call("POST", f"/api/restatements/{d['id']}/{path}", json=body)
        assert res.status_code == 409 and err(res)["code"] == "invalid_transition", path
    assert one(an, d["id"]) == d
    seed = next(x for x in rs(an) if x["accession"] == "0002093117-26-000049")
    for res in (an.call("PATCH", f"/api/restatements/{seed['id']}", json={"version": 1, "accession": acc()}),
                put_exhibit(an, seed, make_pdf(label())),
                an.call("POST", f"/api/restatements/{seed['id']}/submit", json={})):
        assert res.status_code == 409 and err(res)["code"] == "invalid_transition"
    assert one(an, seed["id"]) == seed


def test_version_checked_edits(app_url):
    an, r = editable_draft(app_url)
    v = r["version"]
    res = an.call("PATCH", f"/api/restatements/{r['id']}", json={"version": v - 1, "exhibit_page": 2})
    assert res.status_code == 409 and err(res)["code"] == "version_conflict" and one(an, r["id"]) == r
    res = an.call("PATCH", f"/api/restatements/{r['id']}", json={"exhibit_page": 2})
    assert res.status_code == 422 and "version" in err(res)["fields"]
    s = save(an, r, exhibit_page=2)
    assert s["version"] == v + 1 and s["updated_at"] != r["updated_at"]
    up = put_exhibit(an, s, make_pdf(label())).json()["restatement"]
    assert up["version"] == v + 3
    res = an.call("PATCH", f"/api/restatements/{r['id']}", json={"version": v + 1, "exhibit_page": 3})
    assert res.status_code == 409 and err(res)["code"] == "version_conflict"
    res = together([lambda n=n: an.clone().patch(f"/api/restatements/{r['id']}", json={"version": v + 3, "exhibit_page": 4 + n}) for n in range(5)])
    assert sorted(x.status_code for x in res) == [200, 409, 409, 409, 409]
    cur = one(an, r["id"])
    assert cur["version"] == v + 4 and [e["version"] for e in trail(an, r["id"])] == list(range(1, v + 5))
    cur = submit(app_url, cur)
    res = Api(app_url, "rafe").call("POST", f"/api/restatements/{r['id']}/clear", json={"checked": ROW_KEYS, "version": cur["version"] - 1})
    assert res.status_code == 409 and err(res)["code"] == "version_conflict"
    q = queue(app_url, clear(app_url, cur))
    res = Api(app_url, "noor").call("POST", f"/api/restatements/{r['id']}/withdraw", json={"version": q["version"] - 1, "note": NOTE})
    assert res.status_code == 409 and err(res)["code"] == "version_conflict" and one(an, r["id"]) == q


def test_withdraw_queued(app_url):
    r, _ = cleared_correction(app_url)
    q = queue(app_url, r)
    path = f"/api/restatements/{r['id']}/withdraw"
    res = Api(app_url, "tamsin").call("POST", path, json={"version": q["version"], "note": NOTE})
    assert res.status_code == 403
    noor = Api(app_url, "noor")
    res = noor.call("POST", path, json={"version": q["version"], "note": "short"})
    assert res.status_code == 422 and "note" in err(res)["fields"]
    res = together([lambda: noor.clone().post(path, json={"version": q["version"], "note": NOTE}) for _ in range(5)])
    assert sorted(x.status_code for x in res) == [200, 409, 409, 409, 409]
    w = one(noor, r["id"])
    assert (w["state"], w["release_at"], w["released_by"], w["cleared_by"]["name"]) == ("cleared", None, None, STAFF["rafe"][0])
    e = trail(noor, r["id"])[-1]
    assert (e["action"], e["note"], e["actor"]["name"]) == ("withdraw", NOTE, STAFF["noor"][0])
    q2 = queue(app_url, w)
    set_clock(app_url, iso(q2["release_at"]) + timedelta(seconds=1))
    res = noor.call("POST", path, json={"version": q2["version"], "note": NOTE})
    assert res.status_code == 409 and err(res)["code"] == "invalid_transition"
    pub = wait_state(noor, r["id"], "published", CADENCE_S * 3)
    assert iso(pub["published_at"]) == iso(q2["release_at"])
    assert [x["action"] for x in trail(noor, r["id"])].count("publish") == 1


def open_release(page):
    click(page.get_by_role("button", name="Release restatement", exact=True))
    dlg = page.get_by_role("dialog", name="Release restatement", exact=True)
    wait(page, lambda: expect(dlg).to_be_visible(timeout=500), "release dialog opens")
    return dlg, dlg.get_by_role("checkbox", name="I confirm this restatement is cleared for release", exact=True), \
        dlg.get_by_role("button", name="Release", exact=True)


def test_release_confirmation_copy(browser, app_url):
    r, _ = cleared_correction(app_url)
    move_clock(app_url, in_session=True)
    with staff_page(browser, app_url, "noor", f"/staff/restatements/{r['id']}") as page:
        dlg, box, go = open_release(page)
        check(box)
        q = release(app_url, r, who="wren").json()["restatement"]
        click(go)
        said(page, "Release status", NOT_CLEARED, scope=dlg)
        w = Api(app_url, "noor").json("POST", f"/api/restatements/{r['id']}/withdraw", json={"version": q["version"], "note": NOTE})["restatement"]
        page.reload()
        dlg, box, go = open_release(page)
        check(box)
        click(go)
        q = wait_state(Api(app_url, "rafe"), r["id"], "queued")
        said(page, "Release status", f"Release queued — publishes at the {hm(q['release_at'])} ET session close on {nyday(q['release_at'])}.", scope=dlg)
        Api(app_url, "noor").json("POST", f"/api/restatements/{r['id']}/withdraw", json={"version": q["version"], "note": NOTE})
        move_clock(app_url, in_session=False)
        page.reload()
        dlg, box, go = open_release(page)
        check(box)
        click(go)
        pub = wait_state(Api(app_url, "rafe"), r["id"], "published")
        said(page, "Release status", f"Released — published at {hms(pub['published_at'])} ET on {nyday(pub['published_at'])}.", scope=dlg)
        assert w["state"] == "cleared"


def test_wf_release_dialog_keyboard(browser, app_url):
    r, _ = cleared_correction(app_url)
    move_clock(app_url, in_session=True)
    with staff_page(browser, app_url, "noor", f"/staff/restatements/{r['id']}") as page:
        opener = page.get_by_role("button", name="Release restatement", exact=True)
        dlg = page.get_by_role("dialog", name="Release restatement", exact=True)
        box = dlg.get_by_role("checkbox", name="I confirm this restatement is cleared for release", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        wait(page, lambda: expect(box).to_be_focused(timeout=500), "focus on the checkbox")
        expect(dlg.get_by_role("button", name="Release", exact=True)).to_be_disabled()
        page.keyboard.press("Space")
        seen = set()
        for _ in range(8):
            page.keyboard.press("Tab")
            assert dlg.evaluate("d => d.contains(document.activeElement)"), "Tab stays inside the dialog"
            seen.add(page.evaluate("document.activeElement.textContent || document.activeElement.getAttribute('aria-label') || ''"))
        page.keyboard.press("Shift+Tab")
        assert dlg.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        advance(page, 500)
        expect(dlg).to_have_count(0) if dlg.count() == 0 else expect(dlg).to_be_hidden()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        wait(page, lambda: expect(box).to_be_focused(timeout=500), "reopened with focus on the checkbox")
        page.keyboard.press("Space")
        go = dlg.get_by_role("button", name="Release", exact=True)
        for _ in range(6):
            page.keyboard.press("Tab")
            if go.evaluate("b => b === document.activeElement"):
                break
        page.keyboard.press("Enter")
        q = wait_state(Api(app_url, "rafe"), r["id"], "queued")
        said(page, "Release status", f"Release queued — publishes at the {hm(q['release_at'])} ET session close on {nyday(q['release_at'])}.", scope=dlg)
        page.reload()
        wopener = page.get_by_role("button", name="Withdraw release", exact=True)
        wdlg = page.get_by_role("dialog", name="Withdraw release", exact=True)
        note = wdlg.get_by_role("textbox", name="Withdraw note", exact=True)
        wopener.focus()
        page.keyboard.press("Enter")
        wait(page, lambda: expect(note).to_be_focused(timeout=500), "focus on the withdraw note")
        page.keyboard.press("Escape")
        advance(page, 500)
        expect(wopener).to_be_focused()
        page.keyboard.press("Enter")
        wait(page, lambda: expect(note).to_be_focused(timeout=500), "withdraw dialog reopens")
        page.keyboard.type(NOTE)
        for _ in range(6):
            page.keyboard.press("Tab")
            assert wdlg.evaluate("d => d.contains(document.activeElement)")
            if wdlg.get_by_role("button", name="Withdraw", exact=True).evaluate("b => b === document.activeElement"):
                break
        page.keyboard.press("Enter")
        said(page, "Staff updates", "Release withdrawn — the restatement is cleared again.")
    assert one(Api(app_url, "rafe"), r["id"])["state"] == "cleared"


def test_wf_release_dialog_retry(browser, app_url):
    r, _ = cleared_correction(app_url)
    move_clock(app_url, in_session=True)
    keys, n = [], {"i": 0}

    def handle(route):
        keys.append(route.request.headers.get("idempotency-key"))
        n["i"] += 1
        if n["i"] == 1:
            route.abort("failed")
        elif n["i"] == 2:
            route.fetch()
            route.abort("failed")
        else:
            route.continue_()

    with staff_page(browser, app_url, "noor", f"/staff/restatements/{r['id']}") as page:
        page.route("**/api/restatements/*/release", handle)
        dlg, box, go = open_release(page)
        check(box)
        click(go)
        said(page, "Release status", UNCONFIRMED, scope=dlg)
        expect(go).to_be_enabled()
        expect(box).to_be_checked()
        page.keyboard.press("Escape")
        advance(page, 500)
        dlg, box, go = open_release(page)
        check(box)
        click(go)
        said(page, "Release status", UNCONFIRMED, scope=dlg)
        click(go)
        q = wait_state(Api(app_url, "rafe"), r["id"], "queued")
        said(page, "Release status", f"Release queued — publishes at the {hm(q['release_at'])} ET session close on {nyday(q['release_at'])}.", scope=dlg)
    assert len(keys) == 3 and keys[0] != keys[1] and keys[1] == keys[2] and all(keys)
    assert [e["action"] for e in trail(Api(app_url, "rafe"), r["id"])].count("release_queued") == 1


def test_wf_release_dialog_late_response(browser, app_url):
    r, _ = cleared_correction(app_url)
    move_clock(app_url, in_session=True)
    with staff_page(browser, app_url, "noor", f"/staff/restatements/{r['id']}") as page:
        with held(page, "**/api/restatements/*/release") as gate:
            dlg, box, go = open_release(page)
            check(box)
            click(go)
            page.keyboard.press("Escape")
            click(page.get_by_role("button", name="Release restatement", exact=True))
            advance(page, 1000)
            expect(dlg).to_be_visible()
            expect(box).to_be_focused()
            expect(box).not_to_be_checked()
            expect(go).to_be_disabled()
            gate.release()
        q = wait_state(Api(app_url, "rafe"), r["id"], "queued")
        said(page, "Staff updates", f"Release queued — publishes at the {hm(q['release_at'])} ET session close on {nyday(q['release_at'])}.")
        expect(status(dlg, "Release status")).to_have_text("")
        expect(box).not_to_be_checked()
        expect(box).to_be_focused()
        expect(dlg).to_be_visible()
        check(box)
        click(go)
        said(page, "Release status", NOT_CLEARED, scope=dlg)


def test_wf_release_dialog_timing(browser, app_url):
    r, _ = cleared_correction(app_url)
    close = before_close(app_url, 45)
    with staff_page(browser, app_url, "noor", f"/staff/restatements/{r['id']}") as page:
        page.clock.set_system_time(close + WRONG_DEVICE)
        dlg, box, go = open_release(page)
        said(page, "Release timing", f"Releasing now queues it to the {hm(close.isoformat())} ET session close on {close.astimezone(NY).date()}.", scope=dlg)
        check(box)
        go.focus()
        said(page, "Release timing", "Releasing now publishes it at once.", scope=dlg, seconds=WAIT_S)
        expect(box).to_be_checked()
        expect(go).to_be_enabled()
        expect(go).to_be_focused()
        page.route("**/api/board*", lambda route: route.abort())
        advance(page, CADENCE_S * 2000)
        expect(status(dlg, "Release timing")).to_have_text("Releasing now publishes it at once.")
    assert one(Api(app_url, "rafe"), r["id"])["state"] == "cleared"


def test_corrections_supersede(app_url):
    c1, _ = cleared_correction(app_url)
    p0 = c1["supersedes"]
    c1 = publish_now(app_url, c1)
    c2 = new_correction(app_url)
    assert c2["supersedes"] == c1["id"]
    c2, _ = make_ready(app_url, c2)
    c2 = publish_now(app_url, clear(app_url, submit(app_url, c2)))
    api = Api(app_url, "rafe")
    assert one(api, p0)["superseded_by"] == c1["id"] and one(api, c1["id"])["superseded_by"] == c2["id"]
    hist = board(app_url)["history"]
    ids = [h["restatement_id"] for h in hist]
    i = ids.index(c2["id"])
    assert ids[i + 1:i + 3] == [c1["id"], p0]
    for row, by, when in ((hist[i + 1], c2, c2), (hist[i + 2], c1, c1)):
        assert row["state"] == "superseded" and row["restated"] == {"on": nyday(when["published_at"]), "reason": REASON, "superseded_by": by["id"]}
        comp = httpx.get(f"{app_url}/api/computations/{row['eth_per_1000_diluted']['computation_id']}", timeout=HTTP_TIMEOUT).json()["computation"]
        sup = figure(board(app_url), "eth-per-1000-diluted") if by is c2 else None
        assert comp["restated"]["superseded_by"] == by["id"] and comp["restated"]["reason"] == REASON
        if sup:
            assert comp["restated"]["superseding_computation_id"] == sup["id"]
    res = Api(app_url, "imre").call("POST", "/api/restatements", json={"supersedes": c1["id"]})
    assert res.status_code == 409 and err(res)["code"] == "not_latest_week"


def test_wf_corrections_journey(browser, app_url):
    settle_open(app_url)
    ensure_fresh_week(app_url)
    api = Api(app_url, "tamsin")
    prior = latest(api)
    accession, pdf = acc(), make_pdf(label())
    with staff_page(browser, app_url, "tamsin", "/staff/restatements") as page:
        click(page.get_by_role("button", name="Start correction", exact=True))
        rid = editor_id(page)
        ui_fill(page, prior["rows"], accession, REASON)
        click(page.get_by_role("button", name="Save draft", exact=True))
        said(page, "Staff updates", "Draft saved.")
        page.get_by_label("Exhibit PDF").set_input_files(file_payload(pdf))
        said(page, "Exhibit upload", f"Exhibit verified — SHA-256 {sha(pdf)} matches the vault copy.")
        click(page.get_by_role("button", name="Send to disclosure counsel", exact=True))
        said(page, "Staff updates", "Sent to disclosure counsel.")
    r = clear(app_url, one(api, rid))
    pub = publish_now(app_url, r)
    b = board(app_url)
    assert all(c["restatement_id"] == rid for c in b["figures"][:3])
    with board_page(browser, app_url) as page:
        for c in b["figures"][:3]:
            wait(page, lambda c=c: expect(tile(page, c["figure"])).to_contain_text(c["display"], timeout=500), "corrected figure")
        old = hrow(page, prior["accession"]).first
        expect(old).to_contain_text("Restated")
        expect(old).to_contain_text(f"Restated on {nyday(pub['published_at'])}: {REASON}")
        expect(old.get_by_role("link", name="View superseding entry", exact=True)).to_be_visible()
    old_sha = prior["exhibit"]["sha256"]
    assert anon_exhibit(app_url, old_sha).content == S3().get(prior["exhibit"]["key"])


def test_wf_corrections_chain_audit(browser, app_url):
    r, _ = cleared_correction(app_url)
    api = Api(app_url, "rafe")
    entries = len(trail(api, r["id"]))
    assert release(app_url, r, who="tamsin").status_code == 403
    assert len(trail(api, r["id"])) == entries
    pub = publish_now(app_url, r)
    mine, old = trail(api, r["id"]), trail(api, r["supersedes"])
    assert [e["version"] for e in mine] == list(range(1, pub["version"] + 1))
    assert [e["version"] for e in old] == list(range(1, one(api, r["supersedes"])["version"] + 1))
    sup = old[-1]
    assert (sup["action"], sup["actor"], sup["note"], sup["to_state"]) == ("supersede", None, REASON, "superseded")
    assert iso(sup["at"]) == iso(mine[-1]["at"]) and mine[-1]["action"] == "publish"
    db = pg(app_url).rows(f"select version, action, actor_id from restatement_audit where restatement_id::text = '{r['supersedes']}' order by version")
    assert [x["version"] for x in db] == [e["version"] for e in old] and db[-1]["actor_id"] is None
    with staff_page(browser, app_url, "rafe", f"/staff/restatements/{r['supersedes']}") as page:
        table = page.get_by_role("table", name="Audit trail", exact=True)
        wait(page, lambda: expect(table.get_by_role("row")).to_have_count(len(old) + 1, timeout=500), "one row per audit entry")
        last = table.get_by_role("row").last
        expect(last).to_contain_text("supersede")
        expect(last).to_contain_text("Tracewell")
        expect(last).to_contain_text(wall(sup["at"]))
        expect(last).to_contain_text(REASON)


def test_wf_corrections_simultaneous(browser, app_url):
    settle_open(app_url)
    ensure_fresh_week(app_url)
    tam, imre = Api(app_url, "tamsin"), Api(app_url, "imre")
    target = latest(tam)["id"]
    res = together([lambda c=c: c.clone().post("/api/restatements", json={"supersedes": target}) for c in (tam, imre) * 4])
    codes = sorted(x.status_code for x in res)
    assert codes == [201] + [409] * 7 and all(err(x)["code"] == "restatement_open" for x in res if x.status_code == 409)
    assert sum(1 for x in rs(tam) if x["state"] in OPEN_STATES) == 1
    with staff_page(browser, app_url, "imre", "/staff/restatements") as page:
        click(page.get_by_role("button", name="Start correction", exact=True))
        said(page, "Staff updates", UNEXPECTED)
        expect(page).to_have_url(re.compile(r"/staff/restatements$"))


def test_citation_permalinks(app_url):
    url = f"{app_url}/api/citations/eth-per-1000-diluted/2026-10-20"
    first = httpx.get(url, timeout=HTTP_TIMEOUT)
    assert first.status_code == 200 and first.json()["citation"]["provisional"] is False
    c = citation(app_url, "mnav", "2026-10-27").json()["computation"]
    later = Postgres().rows("select count(*)::int as n from computations where figure = 'mnav' and computed_at > "
                            f"'{iso(c['computed_at']).isoformat()}'::timestamptz and computed_at < '2026-10-28T00:00:00-04:00'")[0]["n"]
    assert later == 0 and iso(c["computed_at"]) < iso("2026-10-28T00:00:00-04:00")
    r = new_correction(app_url)
    rows, events = event_rows(Api(app_url, "tamsin"), r, [{"kind": "atm_settlement", "shares": str(ATM_SHARES),
                                                          "effective_date": (date.fromisoformat(r["week_ending"]) - timedelta(days=3)).isoformat()}])
    r, _ = make_ready(app_url, r, rows=rows, events=events)
    publish_now(app_url, clear(app_url, submit(app_url, r)))
    assert httpx.get(url, timeout=HTTP_TIMEOUT).content == first.content
    for bad in ("/api/citations/unknown-figure/2026-10-20", "/api/citations/mnav/2026-10-32", "/api/citations/mnav/2026-10-11"):
        res = httpx.get(app_url + bad, timeout=HTTP_TIMEOUT)
        assert res.status_code == 404 and err(res)["code"] == "not_found"


def test_citation_url_restores_trace(browser, app_url):
    path = "/cite/eth-per-1000-diluted/2026-10-20"
    with board_page(browser, app_url, path + "?step=diluted-shares") as page:
        dlg = trace(page, "eth-per-1000-diluted")
        btn = input_button(dlg, "Assumed diluted shares")
        wait(page, lambda: expect(btn).to_be_focused(timeout=500), "trace opens focused on the step")
        expect(btn).to_have_attribute("aria-pressed", "true")
        expect(dlg.get_by_role("row").filter(has_text="Assumed diluted shares")).to_have_attribute("aria-current", "true")
        depth = page.evaluate("history.length")
        click(input_button(dlg, "Ending ETH balance"))
        wait(page, lambda: expect(page).to_have_url(re.compile(r"step=ending-balance"), timeout=500), "URL carries the step")
        click(dlg.get_by_role("button", name="Close trace", exact=True))
        settle(page, GONE_MS)
        expect(page).to_have_url(re.compile(re.escape(path) + r"$"))
        assert page.evaluate("history.length") == depth
        page.goto(app_url + path + "?step=ending-balance")
        wait(page, lambda: expect(input_button(trace(page, "eth-per-1000-diluted"), "Ending ETH balance")).to_have_attribute("aria-pressed", "true", timeout=500), "reload restores")
        page.goto(app_url + path + "?step=no-such-step")
        advance(page, 1000)
        expect(trace(page, "eth-per-1000-diluted")).to_have_count(0)
        page.goto(app_url + "/cite/unknown-figure/2026-10-20")
        wait(page, lambda: expect(page.get_by_role("heading", name="No published figure for that date.", exact=True)).to_be_visible(timeout=500), "not-found heading")


def test_citation_day_boundary(browser, app_url):
    day = before_midnight(app_url, 45)
    tomorrow = (day + timedelta(days=1)).isoformat()
    assert citation(app_url, "mnav", day.isoformat()).json()["citation"]["provisional"] is True
    assert citation(app_url, "mnav", tomorrow).status_code == 404
    with board_page(browser, app_url, f"/cite/mnav/{day}") as page:
        marker = page.get_by_text(f"Provisional — {day} has not ended; this figure may still change.", exact=True)
        wait(page, lambda: expect(marker).to_be_visible(timeout=500), "Provisional marker")
        poll(lambda: citation(app_url, "mnav", day.isoformat()).json()["citation"]["provisional"] is False, "citation turns final after midnight")
        wait(page, lambda: expect(marker).to_have_count(0, timeout=500), "marker drops by itself", CADENCE_S * 4)
    assert citation(app_url, "mnav", tomorrow).json()["citation"]["provisional"] is True


def test_wf_citation_analyst(browser, app_url):
    path = "/cite/eth-per-1000-diluted/2026-10-20"
    comp = citation(app_url, "eth-per-1000-diluted", "2026-10-20").json()["computation"]
    accession, digest, _ = exhibit_of(comp)

    def view(page):
        wait(page, lambda: expect(page.get_by_role("heading", name="ETH per 1,000 diluted shares as of the end of 2026-10-20", exact=True)).to_be_visible(timeout=500), "heading")
        expect(page.get_by_text("Restated", exact=True).first).to_be_visible()
        expect(tile(page, "eth-per-1000-diluted")).to_contain_text(comp["display"])

    with board_page(browser, app_url, path) as page:
        view(page)
        click(tile(page, "eth-per-1000-diluted"))
        dlg = trace(page, "eth-per-1000-diluted")
        settle(page, OPEN_MS)
        page.keyboard.press("]")
        wait(page, lambda: expect(page).to_have_url(re.compile(r"step=diluted-shares"), timeout=500), "URL step")
        expect(dlg).to_contain_text(f"SHA-256 {digest}")
        with page.expect_download() as info:
            click(dlg.get_by_role("link", name=f"Open exhibit {accession}", exact=True))
        assert Path(info.value.path()).read_bytes() == S3().get(f"exhibits/{accession}/{digest}.pdf")
    r = new_correction(app_url)
    rows, events = event_rows(Api(app_url, "tamsin"), r, [{"kind": "atm_settlement", "shares": str(ATM_SHARES),
                                                          "effective_date": (date.fromisoformat(r["week_ending"]) - timedelta(days=3)).isoformat()}])
    r, _ = make_ready(app_url, r, rows=rows, events=events)
    publish_now(app_url, clear(app_url, submit(app_url, r)))
    assert citation(app_url, "eth-per-1000-diluted", "2026-10-20").json()["computation"]["display"] == comp["display"]
    with board_page(browser, app_url, path + "?step=diluted-shares") as page:
        view(page)
        expect(trace(page, "eth-per-1000-diluted")).to_contain_text(f"SHA-256 {digest}")


def test_wf_citation_provisional(browser, app_url):
    move_clock(app_url, in_session=False)
    with tape_paused(app_url):
        key, day = tick_key(app_url), board(app_url)["market_date"]
        with board_page(browser, app_url, f"/cite/mnav/{day}") as page:
            t = tile(page, "mnav")
            wait(page, lambda: expect(t).to_be_visible(timeout=500), "citation tile")
            handle = t.element_handle()
            t.focus()
            for price in ("2999.99", "4200.01"):
                assert tick(app_url, key, {"id": tick_id(), "instrument": "ETH-USD", "price": price}).status_code == 201
                want = citation(app_url, "mnav", day).json()["computation"]["display"]
                wait(page, lambda: expect(t).to_contain_text(want, timeout=500), "citation follows the new computation", CADENCE_S * 3)
                assert t.evaluate("(el, h) => el === h", handle) and t.evaluate("el => el === document.activeElement")
            click(t)
            settle(page, OPEN_MS)
            pinned = t.inner_text()
            tick(app_url, key, {"id": tick_id(), "instrument": "ETH-USD", "price": "3100.50"})
            advance(page, CADENCE_S * 3000)
            assert t.inner_text() == pinned
            click(trace(page, "mnav").get_by_role("button", name="Close trace", exact=True))
            want = citation(app_url, "mnav", day).json()["computation"]["display"]
            wait(page, lambda: expect(t).to_contain_text(want, timeout=500), "tile catches up after closing", CADENCE_S * 3)


def test_wf_citation_latest_wins(browser, app_url):
    with board_page(browser, app_url, "/cite/mnav/2026-10-27?step=ending-balance") as page:
        dlg = trace(page, "mnav")
        wait(page, lambda: expect(input_button(dlg, "Ending ETH balance")).to_be_focused(timeout=500), "trace open")
        for k in ("]", "]", "]", "[", "]", "]", "]"):
            page.keyboard.press(k)
        wait(page, lambda: expect(page).to_have_url(re.compile(r"step=diluted-shares"), timeout=500), "URL on the last input")
        expect(input_button(dlg, "Assumed diluted shares")).to_have_attribute("aria-pressed", "true")
        expect(dlg.get_by_role("row").filter(has_text="Assumed diluted shares")).to_have_attribute("aria-current", "true")
    day = before_midnight(app_url, 45)
    with board_page(browser, app_url, f"/cite/mnav/{day}") as page:
        marker = page.get_by_text(f"Provisional — {day} has not ended; this figure may still change.", exact=True)
        wait(page, lambda: expect(marker).to_be_visible(timeout=500), "provisional marker")
        late = []
        page.route("**/api/citations/**", lambda route: late.append((route, route.fetch())) if not late else route.continue_())
        wait(page, lambda: (_ for _ in ()).throw(AssertionError("no held request")) if not late else None, "a refresh is held")
        poll(lambda: citation(app_url, "mnav", day.isoformat()).json()["citation"]["provisional"] is False, "server reports final")
        wait(page, lambda: expect(marker).to_have_count(0, timeout=500), "final applied", CADENCE_S * 4)
        final_text = tile(page, "mnav").inner_text()
        route, resp = late[0]
        route.fulfill(response=resp)
        advance(page, CADENCE_S * 2000)
        expect(marker).to_have_count(0)
        assert tile(page, "mnav").inner_text() == final_text


def test_wf_vault_outage_board(browser, app_url):
    vd = vault_down()
    b = board(vd)
    assert b["vault"] == "unavailable" and board(app_url)["vault"] == "available"
    seed = next(h for h in b["history"] if h["exhibit"]["accession"] == "0002093117-26-000041")["exhibit"]["sha256"]
    r = anon_exhibit(vd, seed)
    assert r.status_code == 503 and r.json() == VAULT_BODY
    assert anon_exhibit(vd, seed, **{"If-None-Match": f'"{seed}"'}).status_code == 304
    assert anon_exhibit(vd, "f" * 64).status_code == 404
    an, d = editable_draft(app_url)
    res = put_exhibit(Api(vd, "tamsin"), d, make_pdf(label()))
    assert res.status_code == 503 and res.json() == VAULT_BODY
    with board_page(browser, vd) as page:
        wait(page, lambda: expect(page.get_by_role("region", name="Notices", exact=True)).to_have_text(VAULT_NOTICE, timeout=500), "vault notice")
        for c in b["figures"]:
            expect(tile(page, c["figure"])).to_contain_text(c["display"]) if c["figure"] != "mnav" else expect(tile(page, "mnav")).to_be_visible()


def test_wf_vault_outage_upload(browser, app_url):
    an, r = editable_draft(app_url, exhibit=True)
    before, staged = one(an, r["id"]), S3().keys(f"incoming/{r['id']}/")
    puts = []
    with staff_page(browser, vault_down(), "tamsin", f"/staff/restatements/{r['id']}") as page:
        page.on("request", lambda q: puts.append(q) if q.method == "PUT" and "/exhibit" in q.url else None)
        chooser = page.get_by_label("Exhibit PDF")
        wait(page, lambda: expect(page.get_by_text("Exhibit verified", exact=True)).to_be_visible(timeout=500), "verified before")
        pdf = make_pdf(label())
        chooser.set_input_files(file_payload(pdf))
        said(page, "Exhibit upload", VAULT_UPLOAD)
        expect(page.get_by_text("Exhibit verified", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="Send to disclosure counsel", exact=True)).to_be_enabled()
        assert chooser.input_value() == ""
        chooser.set_input_files(file_payload(pdf))
        said(page, "Exhibit upload", VAULT_UPLOAD)
    assert len(puts) == 2, "choosing the same file again starts a new upload"
    assert one(an, r["id"]) == before and S3().keys(f"incoming/{r['id']}/") == staged


def test_honest_exhibit_state(browser, app_url):
    an, r = editable_draft(app_url)
    with staff_page(browser, vault_down(), "tamsin", f"/staff/restatements/{r['id']}") as page:
        wait(page, lambda: expect(page.get_by_text("No exhibit attached", exact=True)).to_be_visible(timeout=500), "no exhibit")
        page.evaluate("""() => { window.__states = [];
          const names = ['No exhibit attached', 'Exhibit pending verification', 'Exhibit verified', 'Exhibit rejected — SHA-256 mismatch'];
          const rec = () => { const t = document.body.innerText; const k = names.filter(n => t.split('\\n').some(l => l.trim() === n)).join('|');
            if (window.__states[window.__states.length - 1] !== k) window.__states.push(k); };
          rec(); new MutationObserver(rec).observe(document.body, {subtree: true, childList: true, characterData: true}); }""")
        with held(page, "**/api/restatements/*/exhibit") as gate:
            page.get_by_label("Exhibit PDF").set_input_files(file_payload(make_pdf(label())))
            wait(page, lambda: expect(page.get_by_text("Exhibit pending verification", exact=True)).to_be_visible(timeout=500), "pending")
            expect(page.get_by_role("button", name="Send to disclosure counsel", exact=True)).to_be_disabled()
            gate.release()
        said(page, "Exhibit upload", VAULT_UPLOAD)
        assert page.evaluate("window.__states") == ["No exhibit attached", "Exhibit pending verification", "No exhibit attached"]
        click(page.get_by_role("button", name="Save draft", exact=True))
        said(page, "Staff updates", "Draft saved.")
        fill(page.get_by_role("textbox", name="Accession number", exact=True), acc())
        advance(page, CADENCE_S * 1000)
        expect(status(page, "Exhibit upload")).to_have_text(VAULT_UPLOAD)
        with held(page, "**/api/restatements/*/exhibit") as gate:
            page.get_by_label("Exhibit PDF").set_input_files(file_payload(make_pdf(label())))
            said(page, "Exhibit upload", "Uploading exhibit and checking SHA-256...")
            gate.release()


def test_wf_vault_outage_trace_download(browser, app_url):
    with board_page(browser, vault_down()) as page:
        wait(page, lambda: expect(tile(page, "eth-held")).to_be_visible(timeout=500), "tile")
        click(tile(page, "eth-held"))
        dlg = trace(page, "eth-held")
        settle(page, OPEN_MS)
        accession = exhibit_of(figure(board(vault_down()), "eth-held"))[0]
        link = dlg.get_by_role("link", name=f"Open exhibit {accession}", exact=True)
        url = page.url
        downloads = []
        page.on("download", lambda d: downloads.append(d))
        status(dlg, "Exhibit download").evaluate("(el) => { window.__dl = []; new MutationObserver(() => window.__dl.push(el.textContent)).observe(el, {subtree: true, childList: true, characterData: true}); }")
        click(link)
        said(page, "Exhibit download", VAULT_DOWNLOAD, scope=dlg)
        expect(link).to_be_focused()
        expect(input_button(dlg, "Beginning ETH balance")).to_have_attribute("aria-pressed", "true")
        assert page.url == url and not downloads
        advance(page, CADENCE_S * 2000)
        page.keyboard.press("]")
        expect(status(dlg, "Exhibit download")).to_have_text(VAULT_DOWNLOAD)
        click(link)
        said(page, "Exhibit download", VAULT_DOWNLOAD, scope=dlg)
        assert "" in [t.strip() for t in page.evaluate("window.__dl")], "activating again clears the copy first"
    with board_page(browser, app_url) as page:
        page.route("**/api/exhibits/*", lambda route: route.fulfill(status=500, body="{}"))
        wait(page, lambda: expect(tile(page, "eth-held")).to_be_visible(timeout=500), "tile")
        click(tile(page, "eth-held"))
        settle(page, OPEN_MS)
        dlg = trace(page, "eth-held")
        click(dlg.get_by_role("link", name=re.compile(r"^Open exhibit ")))
        said(page, "Exhibit download", UNEXPECTED, scope=dlg)


def test_vault_recovery(app_url):
    endpoint = urlparse(os.environ["S3_ENDPOINT"])
    target = (endpoint.hostname, endpoint.port or (443 if endpoint.scheme == "https" else 80))
    port = free_port()
    relay = Relay(port, target)
    seed = next(h for h in board(app_url)["history"] if h["exhibit"]["accession"] == "0002093117-26-000041")["exhibit"]["sha256"]
    with app_copy(S3_ENDPOINT=f"{endpoint.scheme}://127.0.0.1:{port}") as base:
        poll(lambda: board(base)["vault"] == "unavailable", "vault reported unavailable at boot", VAULT_RECOVER_S + CADENCE_S)
        assert anon_exhibit(base, seed).status_code == 503
        for _ in range(2):
            relay.start()
            poll(lambda: board(base)["vault"] == "available", "vault available again", VAULT_RECOVER_S + CADENCE_S)
            assert anon_exhibit(base, seed).content == S3().get(f"exhibits/0002093117-26-000041/{seed}.pdf")
            _, d = editable_draft(app_url)
            assert put_exhibit(Api(base, "tamsin"), d, make_pdf(label())).status_code == 201
            relay.stop()
            poll(lambda: board(base)["vault"] == "unavailable", "outage reported again", VAULT_RECOVER_S + CADENCE_S)
            relay = Relay(port, target)


def test_opaque_errors(browser, app_url):
    vd = vault_down()
    forbidden = ["ECONNREFUSED", "ENOTFOUND", "DATABASE_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", str(DEPLOYED_APP) + "/"]
    for name in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "S3_ENDPOINT"):
        value = os.environ.get(name, "")
        if len(value) > 3:
            forbidden.append(value)
            u = urlparse(value)
            if u.hostname and u.port:
                forbidden.append(f"{u.hostname}:{u.port}")
            if u.password:
                forbidden.append(u.password)
    an, d = editable_draft(app_url)
    seed = next(h for h in board(app_url)["history"] if h["exhibit"]["accession"] == "0002093117-26-000041")["exhibit"]["sha256"]
    responses = [httpx.post(f"{app_url}/api/session", content="{", headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT),
                 httpx.get(f"{app_url}/api/no-such-thing", timeout=HTTP_TIMEOUT),
                 anon_exhibit(vd, seed), put_exhibit(Api(vd, "tamsin"), d, make_pdf(label())),
                 tick(app_url, "0" * 64, {"id": tick_id(), "instrument": "ETH-USD", "price": "1"}),
                 httpx.get(f"{app_url}/api/session-calendar", params={"date": "x"}, timeout=HTTP_TIMEOUT)]
    assert responses[1].status_code == 404 and err(responses[1])["code"] == "not_found"
    assert responses[2].json() == VAULT_BODY and responses[3].json() == VAULT_BODY
    assert responses[0].json()["error"]["message"] == "Request body is not valid JSON."
    for r in responses:
        e = r.json()["error"]
        assert set(e) <= {"code", "message", "fields"} and isinstance(e["message"], str)
        blob = r.text + " ".join(f"{k}: {v}" for k, v in r.headers.items())
        assert not [f for f in forbidden if f in blob], f"{r.request.url} leaks {[f for f in forbidden if f in blob]}"
    with board_page(browser, vd) as page:
        wait(page, lambda: expect(page.get_by_role("region", name="Notices", exact=True)).to_have_text(VAULT_NOTICE, timeout=500), "notice")
        html = page.content()
        assert not [f for f in forbidden if f in html]


def test_unspool_threads(browser, app_url):
    c = figure(board(app_url), "eth-per-1000-diluted")
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(tile(page, "eth-per-1000-diluted")).to_be_visible(timeout=500), "tile")
        page.evaluate("""() => { window.__moved = false; const sel = '[role="dialog"], dialog, [data-unspool-chip], [data-unspool-thread]';
          for (const e of ['animationstart', 'transitionrun']) document.addEventListener(e, (ev) => {
            if (ev.target && ev.target.closest && ev.target.closest(sel)) window.__moved = true; }, true); }""")
        click(tile(page, "eth-per-1000-diluted"))
        dlg = trace(page, "eth-per-1000-diluted")
        running = page.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target
            && a.effect.target.closest && a.effect.target.closest('[role="dialog"], dialog, [data-unspool-chip], [data-unspool-thread]')).length""")
        first_box = dlg.bounding_box() if dlg.count() else None
        motion_done(page, OPEN_MS, "opening done within 600 ms")
        assert running > 0 or page.evaluate("window.__moved") or first_box != dlg.bounding_box(), "the opening moves: an animation runs or the panel travels (L560-569)"
        assert sorted(chips(page).evaluate_all("els => els.map(e => e.dataset.unspoolChip)")) == sorted(i["key"] for i in c["inputs"])
        assert sorted(threads(page).evaluate_all("els => els.map(e => e.dataset.unspoolThread)")) == sorted(i["key"] for i in filed(c))
        assert_anchored(page, dlg, c)
        page.mouse.wheel(0, 120)
        advance(page, REANCHOR_MS)
        assert_anchored(page, dlg, c)
        page.set_viewport_size({"width": 1100, "height": 800})
        advance(page, REANCHOR_MS)
        assert_anchored(page, dlg, c)
        focused = page.evaluate("document.activeElement.textContent")
        page.set_viewport_size({"width": 700, "height": 800})
        advance(page, REANCHOR_MS)
        expect(threads(page)).to_have_count(0)
        expect(dlg).to_be_visible()
        expect(input_button(dlg, "Ending ETH balance")).to_have_attribute("aria-pressed", "true")
        assert page.evaluate("document.activeElement.textContent") == focused
        page.set_viewport_size(DESKTOP)
        advance(page, REANCHOR_MS)
        expect(threads(page)).to_have_count(len(filed(c)))
        assert page.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target
            && a.effect.target.closest && a.effect.target.closest('[data-unspool-thread]')
            && ((a.transitionProperty || '').startsWith('stroke-dash')
                || a.effect.getKeyframes().some(k => 'strokeDashoffset' in k || 'strokeDasharray' in k))).length""") == 0, "no draw replay"
        assert_anchored(page, dlg, c)
        click(dlg.get_by_role("button", name="Close trace", exact=True))
        closing = page.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target
            && a.effect.target.closest && a.effect.target.closest('[role="dialog"], dialog, [data-unspool-chip], [data-unspool-thread]')).length""")
        assert closing > 0 or dlg.count() > 0, "closing runs the sequence in reverse instead of vanishing at once (L581)"
        motion_done(page, GONE_MS, "closing done within 600 ms")
        expect(dlg).to_have_count(0)
        click(tile(page, "mnav"))
        settle(page, OPEN_MS)
        expect(chips(page)).to_have_count(4)
        expect(threads(page)).to_have_count(2)


def test_unspool_reduced_motion(browser, app_url):
    c = figure(board(app_url), "eth-per-1000-diluted")
    accession, digest, pno = exhibit_of(c)
    with board_page(browser, app_url, reduced_motion="reduce") as page:
        wait(page, lambda: expect(tile(page, "eth-per-1000-diluted")).to_be_visible(timeout=500), "tile")
        click(tile(page, "eth-per-1000-diluted"))
        dlg = trace(page, "eth-per-1000-diluted")
        expect(dlg).to_be_visible(timeout=1000)
        expect(input_button(dlg, "Ending ETH balance")).to_be_focused()
        assert chips(page).evaluate_all("els => els.map(e => e.dataset.unspoolChip)") == [i["key"] for i in c["inputs"]]
        expect(threads(page)).to_have_count(0)
        assert page.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target
            && a.effect.target.closest && a.effect.target.closest('[role="dialog"], dialog, [data-unspool-chip], [data-unspool-thread]')).length""") == 0
        expect(dlg.get_by_role("table", name=f"Exhibit {accession} page {pno}", exact=True)).to_be_visible()
        expect(dlg).to_contain_text(f"SHA-256 {digest}")
        with page.expect_download() as info:
            click(dlg.get_by_role("link", name=f"Open exhibit {accession}", exact=True))
        assert sha(Path(info.value.path()).read_bytes()) == digest
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0, timeout=1000)
        expect(tile(page, "eth-per-1000-diluted")).to_be_focused()


def test_wf_unspool_trace_keyboard(browser, app_url):
    with board_page(browser, app_url) as page:
        wait(page, lambda: expect(tile(page, "mnav")).to_be_visible(timeout=500), "tiles")
        for fig in FIGURES:
            tile(page, fig).focus()
            page.keyboard.press("Enter")
            dlg = trace(page, fig)
            wait(page, lambda: expect(dlg).to_be_visible(timeout=500), f"trace for {fig}")
            first = dlg.get_by_role("list", name="Inputs", exact=True).get_by_role("button").first
            expect(first).to_be_focused()
            expect(first).to_have_attribute("aria-pressed", "true")
            if fig == "eth-held":
                page.keyboard.press("]")
                expect(input_button(dlg, "ETH acquired")).to_have_attribute("aria-pressed", "true")
                expect(first).to_be_focused()
                link = dlg.get_by_role("link", name=re.compile(r"^Open exhibit "))
                for _ in range(20):
                    page.keyboard.press("Tab")
                    assert dlg.evaluate("d => d.contains(document.activeElement)"), "Tab stays inside the trace"
                    if link.evaluate("l => l === document.activeElement"):
                        break
                with page.expect_download():
                    page.keyboard.press("Enter")
            page.keyboard.press("Escape")
            settle(page, GONE_MS)
            expect(dlg).to_have_count(0)
            expect(tile(page, fig)).to_be_focused()


def test_wf_unspool_trace_phone(browser, app_url):
    with board_page(browser, app_url, viewport=PHONE) as page:
        wait(page, lambda: expect(tile(page, "eth-per-1000-diluted")).to_be_visible(timeout=500), "tile")
        tile(page, "eth-per-1000-diluted").scroll_into_view_if_needed()
        tap(tile(page, "eth-per-1000-diluted"))
        dlg = trace(page, "eth-per-1000-diluted")
        motion_done(page, OPEN_MS, "sheet opening")
        box = dlg.bounding_box()
        assert abs(box["y"] + box["height"] - PHONE["height"]) <= 2 and box["height"] <= PHONE["height"] * SHEET_SHARE + 20, f"bottom sheet {box}"
        expect(threads(page)).to_have_count(0)
        for el in dlg.get_by_role("list", name="Inputs", exact=True).get_by_role("button").all() + chips(page).all():
            b = el.bounding_box()
            assert b["width"] >= TOUCH_PX and b["height"] >= TOUCH_PX
        y = page.evaluate("window.scrollY")
        page.mouse.wheel(0, 300)
        advance(page, 300)
        assert page.evaluate("window.scrollY") == y, "the page behind the sheet does not scroll"
        layout(page)
        tap(dlg.get_by_role("button", name="Close trace", exact=True))
        settle(page, GONE_MS)
        expect(dlg).to_have_count(0)


def test_wf_unspool_trace_refresh(browser, app_url):
    Api(app_url, "basil").json("PUT", "/api/operator/tape", json={"state": "playing"})
    with board_page(browser, app_url) as page:
        t = tile(page, "mnav")
        wait(page, lambda: expect(t).to_be_visible(timeout=500), "tile")
        start = figure(board(app_url), "mnav")["id"]
        click(t)
        dlg = trace(page, "mnav")
        settle(page, OPEN_MS)
        click(input_button(dlg, "Assumed diluted shares"))
        pinned = (t.inner_text(), dlg.inner_text().replace(status(dlg, "Exhibit download").inner_text(), ""), chips(page).count(), threads(page).count())
        poll(lambda: figure(board(app_url), "mnav")["id"] != start, "a newer mNAV computation is stored", CADENCE_S * 4)
        for _ in range(3):
            advance(page, CADENCE_S * 1000)
        assert (t.inner_text(), dlg.inner_text().replace(status(dlg, "Exhibit download").inner_text(), ""), chips(page).count(), threads(page).count()) == pinned
        expect(input_button(dlg, "Assumed diluted shares")).to_have_attribute("aria-pressed", "true")
        expect(input_button(dlg, "Assumed diluted shares")).to_be_focused()
        click(dlg.get_by_role("button", name="Close trace", exact=True))
        wait(page, lambda: expect(t).to_contain_text(figure(board(app_url), "mnav")["display"], timeout=500), "tile catches up", CADENCE_S * 3)


def test_wf_unspool_trace_close(browser, app_url):
    for vp, how, motion_ in ((DESKTOP, "outside", "no-preference"), (TABLET, "escape", "no-preference"),
                             (PHONE, "button", "no-preference"), (DESKTOP, "escape", "reduce")):
        with board_page(browser, app_url, viewport=vp, reduced_motion=motion_) as page:
            t = tile(page, "eth-held")
            wait(page, lambda: expect(t).to_be_visible(timeout=500), "tile")
            click(t)
            dlg = trace(page, "eth-held")
            settle(page, OPEN_MS)
            second = input_button(dlg, "ETH acquired").element_handle()
            if how == "outside":
                page.mouse.click(5, vp["height"] - 5)
            elif how == "escape":
                page.keyboard.press("Escape")
            else:
                click(dlg.get_by_role("button", name="Close trace", exact=True))
            assert not second.evaluate("b => { b.focus(); return document.activeElement === b; }"), "trace inert while closing"
            settle(page, GONE_MS)
            expect(dlg).to_have_count(0)
            assert chips(page).count() == 0 and threads(page).count() == 0
            expect(t).to_be_focused()


def test_if_run_manifest():
    m = json.loads(Path("/app/run.json").read_text())
    assert m.get("_schema") == "run-manifest-v1" and all(isinstance(m.get(k), str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    for font in ("Archivo", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices, font


def test_if_licences():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_single_datastore():
    names = [p.name.lower() for p in shipped_packages()]
    banned = [w.lower() for w in ("SQLite", "Redis")]
    assert not [n for n in names if any(b in n for b in banned)]


def test_if_no_third_party_origin(browser, app_url):
    with board_page(browser, app_url) as page:
        urls = []
        page.on("request", lambda q: urls.append(q.url))
        page.reload()
        wait(page, lambda: expect(tile(page, "mnav")).to_be_visible(timeout=500), "board loads")
    foreign = [u for u in urls if u.startswith("http") and urlparse(u).netloc != urlparse(app_url).netloc]
    assert not foreign, foreign[:10]


def test_if_typescript_source():
    skip = {"node_modules", "dist", "build", "out", "public", "static", "client-dist", "coverage", "assets",
            "scripts", "tools", "bin"}
    plain = [str(p) for p in Path("/app").rglob("*") if p.suffix in (".js", ".mjs", ".cjs", ".jsx")
             and not skip & set(p.parts) and not any(part.startswith(".") for part in p.parts)
             and "config" not in p.name]
    assert not plain, plain[:20]


def test_if_services_unchanged():
    assert {"restatement_audit", "computations"} <= {t.split(".")[-1] for t in Postgres().tables()}
    assert S3().keys("exhibits/0002093117-26-000041/")
