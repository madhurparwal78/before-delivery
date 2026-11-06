from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import ROUND_FLOOR, ROUND_HALF_EVEN, Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

import conftest
from conftest import (
    advance,
    capture,
    center,
    changed,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    tap,
)

try:
    from conftest import S3, Mailpit, Postgres, addresses, mail_from_address, text
except ImportError:
    from mailpit import Mailpit, addresses, mail_from_address, text
    from minio import S3
    from postgres import Postgres

DEPLOYED_APP: Path = getattr(conftest, "DEPLOYED_APP", Path("/app"))
APP = Path("/app")

BM, SR, HW = "blackmere-moss", "saltings-reach", "hollin-wood"
BM_IDS = ["BM-S1", "BM-S2", "BM-S3", "BM-S4", "BM-T1", "BM-T2"]
SR_IDS = ["SR-S1", "SR-S2", "SR-T1"]
INES, PRIYA, TOMAS = "ines@levelmoor.example", "priya@levelmoor.example", "tomas@levelmoor.example"
HAL, ODILE, WREN = "hal@levelmoor.example", "odile@levelmoor.example", "wren@levelmoor.example"
PASSWORD = "moss-and-tower-26"

PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
SHEET_MAX_FRACTION = 3
SETTLE_MS = 500
REFRESH_MS = 15000
TOUCH_MIN_PX = 44
TIDE_EARLY_MS = 50
FRAME_MS = 32
TIDE_MAX_MS = 500
BODY_LIMIT = 65536
INGEST_LIMIT = 2000000
IDEMPOTENCY_KEY_MAX = 100
INGEST_MAX_READINGS = 5000
FC_MIN, FC_MAX = -100, 100
FCH4_MIN, FCH4_MAX = -1000, 5000
STORAGE_REFUSAL_S = 10
TOKEN_MIN_CHARS = 32
ALERT_WAIT_S = 60
LINK_TTL_DEFAULT_S = 2592000
SHORT_LINK_TTL_S = 5

POLL_MS = 400
STEP_MS = 100
WAIT_S = 30
MAIL_WAIT_S = 30
LINK_WAIT_S = 30
HTTP_TIMEOUT_S = 30
COPY_BOOT_S = 120
PREVIEW_STEPS = 30
FOREIGN_ORIGIN = "http://evil.example"
FAR_CLOCK = datetime(2031, 3, 1, 12, 0, tzinfo=UTC)
PAST_CLOCK = datetime(2024, 1, 1, tzinfo=UTC)
SHORT_FIRST_DAY = datetime(2029, 1, 1, tzinfo=UTC)

Q1, Q3, Q4 = Decimal("0.1"), Decimal("0.001"), Decimal("0.0001")
HALF, DAY = timedelta(minutes=30), timedelta(days=1)
CO2_FACTOR = Decimal("1800") * Decimal("0.00004401")
CH4_FACTOR = Decimal("1800") * Decimal("0.00000001604") * Decimal("27.0")
MILLION = Decimal("1000000")

TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
FIGURE_ID_RE = re.compile(r"^[A-Z]{2}-F\d{4}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]+$")
CHECKED_DISPLAY_RE = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC")

PROJECTS: dict[str, dict[str, Any]] = {
    BM: {"boundary": (0, 0, 1000, 600), "floor": "60.0", "buffer": "15.0", "sensors": {
        "BM-T1": ((100, 100, 500, 500), "tower"),
        "BM-T2": ((400, 200, 800, 500), "tower"),
        "BM-S1": ((0, 0, 500, 300), "satellite"),
        "BM-S2": ((500, 0, 1000, 300), "satellite"),
        "BM-S3": ((0, 300, 500, 600), "satellite"),
        "BM-S4": ((500, 300, 1000, 600), "satellite"),
    }},
    SR: {"boundary": (0, 0, 800, 500), "floor": "50.0", "buffer": "10.0", "sensors": {
        "SR-T1": ((200, 100, 600, 400), "tower"),
        "SR-S1": ((0, 0, 400, 500), "satellite"),
        "SR-S2": ((400, 0, 800, 500), "satellite"),
    }},
    HW: {"boundary": (0, 0, 400, 400), "floor": "70.0", "buffer": "20.0", "sensors": {
        "HW-T1": ((0, 0, 400, 300), "tower"),
        "HW-S1": ((0, 0, 400, 400), "satellite"),
    }},
}
TEMPLATE = {"BM-T1": ("-3.0", "15.0"), "BM-T2": ("-2.0", "30.0"), "BM-S1": ("-1.0", "10.0"),
            "BM-S2": ("-1.0", "10.0"), "BM-S3": ("-1.0", "10.0"), "BM-S4": ("-1.0", "10.0")}

WHOLE_BM_CONTRIBUTIONS = {
    "BM-S1": (70000, 576, "-3.194", "0.314", "-2.880"),
    "BM-S2": (120000, 576, "-5.475", "0.539", "-4.936"),
    "BM-S3": (70000, 576, "-3.194", "0.314", "-2.880"),
    "BM-T1": (160000, 672, "-6.388", "1.257", "-5.131"),
    "BM-T2": (90000, 672, "-2.396", "1.415", "-0.981"),
}
SEED_DAYS = ([(f"2026-06-0{d}", "-0.437", "41.7") for d in (1, 2)]
             + [(f"2026-06-0{d}", "-1.636", "100.0") for d in (3, 4, 5, 6, 7)]
             + [(f"2026-06-{d:02d}", "-1.328", "85.0") for d in range(8, 15)])

COPY_WRONG_CREDS = "That email and password do not match."
COPY_NO_READINGS = "No readings have been ingested for this project yet."
COPY_TO_BEFORE_FROM = "The To date must be on or after the From date."
COPY_ROLE_ANALYST = "Your role on this project can preview figures but not seal them."
COPY_ROLE_VIEWER = "Your role on this project can view sealed figures but not preview new ones."
COPY_LOST_ACCESS = "You no longer have access to this project."
COPY_SEALING_LABEL = "Sealing..."
COPY_SEALING_STATUS = "Sealing figure. Waiting for evidence storage to confirm."
COPY_STORAGE = "Evidence storage is unreachable, so nothing was sealed. Try again in a few minutes."
COPY_MAIL = "The seal notice could not be sent, so nothing was sealed. Try again in a few minutes."
COPY_NO_ANSWER = "No answer from the server yet. Confirm seal again to retry safely."
COPY_AUDIT_EMPTY = "No readings have moved since this figure was sealed."
COPY_LINK_REVOKED = "Link revoked."
COPY_LINK_ALREADY_EXPIRED = "This link has already expired."
COPY_REDERIVE_PENDING = "Re-deriving from the stored readings."
COPY_REDERIVE_FAILED = "Could not re-derive right now. Try again in a few minutes."
COPY_LINK_NOT_ISSUABLE = "Only an intact sealed figure can have a regulator link."
COPY_FILE_UNAVAILABLE = ("The readings file is unavailable while evidence storage is unreachable. "
                         "Try again in a few minutes.")
EXPIRED_PAGE = ("This link has expired", "Ask the project team for a new link.")
REVOKED_PAGE = ("This link was revoked", "The project team withdrew this link.")
UNKNOWN_PAGE = ("No sealed figure is published at this link", "Check the address you were given.")
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def at(month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=UTC)


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def stamp(t: datetime) -> str:
    return t.strftime("%Y%m%d%H%M")


def display(t: datetime) -> str:
    return t.strftime("%Y-%m-%d %H:%M UTC")


def t3(d: Decimal) -> str:
    q = d.quantize(Q3, rounding=ROUND_HALF_EVEN)
    return "0.000" if q == 0 else f"{q:f}"


def pct1(d: Decimal) -> str:
    return f"{d.quantize(Q1, rounding=ROUND_HALF_EVEN):f}"


def fmt4(v: str) -> str:
    d = Decimal(v).quantize(Q4)
    return "0.0000" if d == 0 else f"{d:f}"


def signed(tonnes: str) -> str:
    return f"+{tonnes}" if Decimal(tonnes) > 0 else tonnes


def ws_path(slug: str, frm: str, to: str, start: datetime, end: datetime, sensors: list[str]) -> str:
    ids = ",".join(sorted(sensors, key=lambda s: s.encode()))
    return f"/projects/{slug}?from={frm}&to={to}&start={stamp(start)}&end={stamp(end)}&sensors={ids}"


def copy_settled(cov: str, net: str, state: str, floor: str | None = None) -> str:
    head = f"Coverage {cov}%, net {signed(net)} tCO2e."
    if state == "sealable":
        return f"{head} Seal available."
    if state == "floor":
        return f"{head} Below the {floor}% floor."
    return f"{head} Seal unavailable."


def copy_below_floor(cov: str, floor: str) -> str:
    return f"Coverage {cov}% is below this project's {floor}% floor, so this figure cannot be sealed."


def copy_overlaps(fid: str) -> str:
    return f"This interval overlaps sealed figure {fid}. Choose an interval that does not overlap it."


def copy_already(fid: str) -> str:
    return f"This interval is already sealed as {fid}."


def copy_sealed(fid: str, net: str, cov: str, old: str | None = None) -> str:
    base = f"Sealed {fid}: {signed(net)} tCO2e at {cov}% coverage."
    return f"{base} Supersedes {old}." if old else base


def copy_broken(ids: list[str]) -> str:
    return " ".join(f"Seal broken on {i}. Its tonnes have been reversed in the ledger." for i in sorted(ids))


def copy_banner(moved: int) -> str:
    return f"Seal broken. Readings moved since sealing: {moved}. Its tonnes have been reversed in the ledger."


def copy_superseded(new_id: str) -> str:
    return f"Superseded by {new_id}."


def copy_link_issued(expires_at: str) -> str:
    return f"Regulator link issued. It expires {display(parse_ts(expires_at))}."


def grant_box(page: Page, person: str, project: str) -> Locator:
    return page.get_by_role("combobox", name=f"{person} on {project}")


def copy_grant_saved(person: str, project: str, role: str) -> str:
    return f"Saved access for {person} on {project}: {role}."


def _clip(r: tuple, b: tuple) -> tuple | None:
    x1, y1, x2, y2 = max(r[0], b[0]), max(r[1], b[1]), min(r[2], b[2]), min(r[3], b[3])
    return (x1, y1, x2, y2) if x1 < x2 and y1 < y2 else None


def _union_area(rects: list[tuple]) -> int:
    if not rects:
        return 0
    xs = sorted({x for r in rects for x in (r[0], r[2])})
    ys = sorted({y for r in rects for y in (r[1], r[3])})
    area = 0
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            if any(r[0] <= xs[i] and xs[i + 1] <= r[2] and r[1] <= ys[j] and ys[j + 1] <= r[3] for r in rects):
                area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
    return area


def allocate_areas(slug: str, sensors: list[str]) -> dict[str, int]:
    proj = PROJECTS[slug]
    kinds = proj["sensors"]
    order = sorted((s for s in sensors if kinds[s][1] == "tower"), key=str.encode) + \
        sorted((s for s in sensors if kinds[s][1] == "satellite"), key=str.encode)
    done: list[tuple] = []
    out: dict[str, int] = {}
    for s in order:
        before = _union_area(done)
        c = _clip(kinds[s][0], proj["boundary"])
        if c:
            done.append(c)
        out[s] = _union_area(done) - before
    return out


def boundary_area(slug: str) -> int:
    b = PROJECTS[slug]["boundary"]
    return (b[2] - b[0]) * (b[3] - b[1])


def _allocate(exact: dict[str, Decimal], total: str) -> dict[str, str]:
    floors = {s: v.quantize(Q3, rounding=ROUND_FLOOR) for s, v in exact.items()}
    r = int((Decimal(total) - sum(floors.values(), Decimal(0))) / Q3)
    order = sorted(exact, key=lambda s: (-(exact[s] - floors[s]), s.encode()))
    for s in order[:r]:
        floors[s] += Q3
    return {s: t3(v) for s, v in floors.items()}


def derive(slug: str, readings: list[dict], start: datetime, end: datetime, sensors: list[str]) -> dict[str, Any]:
    proj = PROJECTS[slug]
    sensors = sorted(sensors, key=str.encode)
    n = int((end - start) / HALF)
    inside = sorted((r for r in readings if r["sensor_id"] in sensors and start <= r["t"] < end),
                    key=lambda r: (r["sensor_id"].encode(), r["t"]))
    lines = ["sensor_id,interval_start,fc,fch4,qc"] + [
        f"{r['sensor_id']},{stamp(r['t'])},{fmt4(r['fc'])},{fmt4(r['fch4'])},{int(r['qc'])}" for r in inside]
    file = ("\n".join(lines) + "\n").encode()
    qual = {s: [r for r in inside if r["sensor_id"] == s and int(r["qc"]) in (0, 1)] for s in sensors}
    contributing = [s for s in sensors if 5 * len(qual[s]) >= 4 * n]
    areas = allocate_areas(slug, contributing)
    b = proj["boundary"]
    boundary_area = (b[2] - b[0]) * (b[3] - b[1])
    co2 = {s: sum((Decimal(r["fc"]) for r in qual[s]), Decimal(0)) * CO2_FACTOR * areas[s] / MILLION for s in contributing}
    ch4 = {s: sum((Decimal(r["fch4"]) for r in qual[s]), Decimal(0)) * CH4_FACTOR * areas[s] / MILLION for s in contributing}
    net = {s: co2[s] + ch4[s] for s in contributing}
    totals = {k: t3(sum(v.values(), Decimal(0))) for k, v in (("co2", co2), ("ch4", ch4), ("net", net))}
    alloc = {k: _allocate(v, totals[k]) for k, v in (("co2", co2), ("ch4", ch4), ("net", net))}
    coverage = pct1(Decimal(sum(areas.values())) * 100 / Decimal(boundary_area))
    n_net = Decimal(totals["net"])
    if n_net < 0:
        buffer = (abs(n_net) * Decimal(proj["buffer"]) / 100).quantize(Q3, rounding=ROUND_HALF_EVEN)
        credited = n_net + buffer
    else:
        buffer, credited = Decimal(0), n_net
    return {
        "coverage_pct": coverage, "floor_pct": proj["floor"], "buffer_pct": proj["buffer"],
        "net_tco2e": totals["net"], "co2_tco2e": totals["co2"], "ch4_tco2e": totals["ch4"],
        "buffer_tco2e": t3(buffer), "credited_tco2e": t3(credited),
        "readings_count": len(inside), "fingerprint": hashlib.sha256(file).hexdigest(), "file": file,
        "contributions": [{"sensor_id": s, "kind": proj["sensors"][s][1], "area_m2": areas[s],
                           "qualifying_half_hours": len(qual[s]), "half_hours": n,
                           "co2_tco2e": alloc["co2"][s], "ch4_tco2e": alloc["ch4"][s], "net_tco2e": alloc["net"][s]}
                          for s in contributing],
    }


def assert_derived(got: dict, exp: dict, what: str) -> None:
    for k in ("coverage_pct", "floor_pct", "buffer_pct", "net_tco2e", "co2_tco2e", "ch4_tco2e", "buffer_tco2e",
              "credited_tco2e", "readings_count", "fingerprint"):
        assert got[k] == exp[k], f"{what}: {k} {got[k]!r} != {exp[k]!r}"
    norm = [{**c, "area_m2": int(c["area_m2"])} for c in got["contributions"]]
    want = [dict(c) for c in exp["contributions"]]
    assert [{k: c[k] for k in want[0]} for c in norm] == want if want else norm == [], f"{what}: contributions {norm}"


def sr_seed(start: datetime, end: datetime) -> list[dict]:
    out, t = [], start
    while t < end:
        out.append({"sensor_id": "SR-T1", "t": t, "fc": "-1.5", "fch4": "40.0", "qc": 0})
        for s in ("SR-S1", "SR-S2"):
            out.append({"sensor_id": s, "t": t, "fc": "-0.5", "fch4": "25.0", "qc": 0})
        t += HALF
    return out


def block(d: datetime, sensors: list[str] | None = None, half_hours: int = 12,
          fc: Callable[[str, int], str] | None = None, fch4: Callable[[str, int], str] | None = None,
          qc: Callable[[str, int], int] | None = None, skip: set | frozenset = frozenset()) -> list[dict]:
    out = []
    for s in sensors or BM_IDS:
        for j in range(half_hours):
            if (s, j) in skip:
                continue
            out.append({"sensor_id": s, "t": d + HALF * j, "fc": fc(s, j) if fc else TEMPLATE[s][0],
                        "fch4": fch4(s, j) if fch4 else TEMPLATE[s][1], "qc": qc(s, j) if qc else 0})
    return out


def merge(readings: list[dict], updates: list[dict]) -> list[dict]:
    index = {(r["sensor_id"], r["t"]): r for r in readings}
    for u in updates:
        index[(u["sensor_id"], u["t"])] = dict(u)
    return list(index.values())


def api_reading(r: dict) -> dict:
    return {"sensor_id": r["sensor_id"], "interval_start": iso(r["t"]), "fc": float(Decimal(r["fc"])),
            "fch4": float(Decimal(r["fch4"])), "qc": int(r["qc"])}


_CLIENTS: dict[tuple[str, str], httpx.Client] = {}


def root(app_url: str) -> str:
    return app_url.rstrip("/")


def outage(env: str) -> str:
    return os.environ[env].rstrip("/")


def anon(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)


def login(base: str, email: str) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    r = c.post("/api/session", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, f"sign-in {email} on {base}: {r.status_code} {r.text}"
    return c


def api(base: str, email: str) -> httpx.Client:
    key = (base, email)
    if key not in _CLIENTS:
        _CLIENTS[key] = login(base, email)
    return _CLIENTS[key]


def cookie_header(c: httpx.Client) -> str:
    return "; ".join(f"{k.name}={k.value}" for k in c.cookies.jar)


def server_date(r: httpx.Response) -> datetime:
    return parsedate_to_datetime(r.headers["date"]).astimezone(UTC)


def preview(base: str, email: str, slug: str, start: datetime, end: datetime, sensors: list[str]) -> httpx.Response:
    return api(base, email).post(f"/api/projects/{slug}/preview",
                                 json={"start": iso(start), "end": iso(end), "sensor_ids": sensors})


def ledger(base: str, email: str, slug: str) -> dict:
    r = api(base, email).get(f"/api/projects/{slug}/ledger")
    assert r.status_code == 200, r.text
    return r.json()


def figure_get(base: str, email: str, fid: str) -> dict:
    r = api(base, email).get(f"/api/figures/{fid}")
    assert r.status_code == 200, r.text
    return r.json()


def figures_at(base: str, email: str, slug: str, start: datetime, end: datetime) -> list[dict]:
    figs = api(base, email).get(f"/api/projects/{slug}/figures").json()["figures"]
    return [f for f in figs if f["start"] == iso(start) and f["end"] == iso(end)]


def entries_for(led: dict, fid: str) -> list[dict]:
    return [e for e in led["entries"] if e["figure_id"] == fid]


def issue_link(base: str, email: str, fid: str) -> dict:
    r = api(base, email).post(f"/api/figures/{fid}/links", json={})
    assert r.status_code == 201, r.text
    return r.json()


def ingest(base: str, slug: str, readings: list[dict], client: httpx.Client) -> httpx.Response:
    return client.post(f"/api/projects/{slug}/readings", json={"readings": readings})


def s3_keys() -> set[str]:
    return set(S3().keys("figures/"))


def subject_of(m: dict) -> str:
    return m.get("Subject", "") or ""


def body_lines(m: dict) -> list[str]:
    return [line.strip() for line in text(m).replace("\r", "").split("\n")]


def next_second() -> None:
    mark = int(time.time())
    while int(time.time()) == mark:
        pass


def wait_mails(mail: Any, pred: Callable[[dict], bool], n: int, what: str, seconds: float = MAIL_WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if len([m for m in mail.messages(0, settle=0.5) if pred(m)]) >= n:
            return [m for m in mail.messages(0) if pred(m)]
    pytest.fail(f"Mailpit never received {n} {what} within {seconds} s")


def mails_now(mail: Any, pred: Callable[[dict], bool]) -> list[dict]:
    return [m for m in mail.messages(0) if pred(m)]


def _notice_pred(fig: dict) -> Callable[[dict], bool]:
    return lambda m: subject_of(m).startswith(f"Sealed {fig['id']}:") and \
        f"Fingerprint: {fig['fingerprint'][:12]}" in text(m)


class Slot:

    def __init__(self, base: str, day: datetime, readings: list[dict]):
        self.base, self.day, self.readings = base, day, readings
        self.date = day.strftime("%Y-%m-%d")

    def at(self, j: int) -> datetime:
        return self.day + HALF * j

    def expect(self, a: int, b: int, sensors: list[str] | None = None) -> dict:
        return derive(BM, self.readings, self.at(a), self.at(b), sensors or BM_IDS)

    def _changed(self, changes: list[tuple[str, int, dict]]) -> list[dict]:
        out = []
        for sid, j, over in changes:
            t = self.at(j)
            cur = next((r for r in self.readings if r["sensor_id"] == sid and r["t"] == t), None)
            row = dict(cur) if cur else {"sensor_id": sid, "t": t, "fc": TEMPLATE[sid][0], "fch4": TEMPLATE[sid][1], "qc": 0}
            row.update(over)
            out.append(row)
        return out

    def changed(self, changes: list[tuple[str, int, dict]]) -> list[dict]:
        return [api_reading(r) for r in self._changed(changes)]

    def revise(self, changes: list[tuple[str, int, dict]]) -> dict:
        rows = self._changed(changes)
        r = ingest(self.base, BM, [api_reading(x) for x in rows], api(self.base, PRIYA))
        assert r.status_code == 200, r.text
        self.readings = merge(self.readings, rows)
        return r.json()


def new_slot(base: str, builder: Callable[[datetime], list[dict]], days: int = 1) -> Slot:
    proj = api(base, HAL).get(f"/api/projects/{BM}").json()
    end = parse_ts(proj["record_end"])
    day = datetime(end.year, end.month, end.day, tzinfo=UTC) + 2 * DAY
    if base == os.environ.get("APP_SHORT_URL", "").rstrip("/"):
        day = max(day, SHORT_FIRST_DAY)
    readings = builder(day)
    steward = api(base, PRIYA)
    for i in range(0, len(readings), INGEST_MAX_READINGS):
        r = ingest(base, BM, [api_reading(x) for x in readings[i:i + INGEST_MAX_READINGS]], steward)
        assert r.status_code == 200, f"slot ingestion: {r.status_code} {r.text}"
    return Slot(base, day, readings)


def std_slot(base: str, sensors: list[str] | None = None) -> Slot:
    return new_slot(base, lambda d: block(d, sensors=sensors))


def seal(slot: Slot, a: int, b: int, email: str = TOMAS, *, key: str | None = None, base: str | None = None,
         sensors: list[str] | None = None, fingerprint: str | None = None) -> httpx.Response:
    sensors = sensors or BM_IDS
    fp = fingerprint or slot.expect(a, b, sensors)["fingerprint"]
    return api(base or slot.base, email).post(
        f"/api/projects/{BM}/figures", headers={"Idempotency-Key": key or idempotency_key()},
        json={"start": iso(slot.at(a)), "end": iso(slot.at(b)), "sensor_ids": sensors, "preview_fingerprint": fp})


def sealed(slot: Slot, a: int, b: int, email: str = TOMAS, key: str | None = None) -> dict:
    r = seal(slot, a, b, email, key=key)
    assert r.status_code == 201, f"seal {a}-{b}: {r.status_code} {r.text}"
    return r.json()


def _manifest() -> dict:
    path = DEPLOYED_APP / "run.json"
    return json.loads((path if path.exists() else APP / "run.json").read_text())


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-4000:]


@contextmanager


def start_copies(n: int) -> Iterator[list[str]]:
    serve = _manifest()["serve"]
    procs: list[tuple[subprocess.Popen, int, str]] = []
    try:
        for _ in range(n):
            port = _free_port()
            log = tempfile.NamedTemporaryFile(prefix="fluxseal-copy-", suffix=".log", delete=False)
            env = {**os.environ, "APP_PUBLIC_PORT": str(port)}
            proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                                    stderr=subprocess.STDOUT, start_new_session=True)
            procs.append((proc, port, log.name))
        urls = []
        for proc, port, logname in procs:
            url = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + COPY_BOOT_S
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    pytest.fail(f"app copy on {port} exited: {_tail(logname)}")
                try:
                    if httpx.get(f"{url}/api/health", timeout=2).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                try:
                    proc.wait(timeout=0.5)
                except subprocess.TimeoutExpired:
                    pass
            else:
                pytest.fail(f"app copy on {port} never answered GET /api/health: {_tail(logname)}")
            urls.append(url)
        yield urls
    finally:
        for proc, _, _ in procs:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=15)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


@pytest.fixture(scope="module")


def app_copies() -> Iterator[list[str]]:
    with start_copies(2) as urls:
        yield urls


def _assert_eq(actual: Any, wanted: Any) -> None:
    assert actual == wanted, f"{actual!r} != {wanted!r}"


def eventually(page: Page, check: Callable[[], Any], what: str, seconds: float = WAIT_S, step_ms: float = STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            check()
            return
        except (AssertionError, PlaywrightError) as e:
            last = e
        if step_ms:
            advance(page, step_ms)
    pytest.fail(f"{what}: {last}")


@contextmanager


def signed_in(browser: Browser, base: str, email: str | None, path: str, *, size: tuple[int, int] = DESKTOP,
              reduced_motion: str = "no-preference", hook: Callable[[Page], None] | None = None) -> Iterator[Page]:
    with open_app(browser, f"{base}/signin", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if hook:
            hook(page)
        if email:
            box = page.get_by_role("textbox", name="Email")
            eventually(page, lambda: expect(box).to_be_visible(timeout=POLL_MS), "Sign in form")
            box.fill(email)
            page.get_by_label("Password", exact=True).fill(PASSWORD)
            page.get_by_role("button", name="Sign in").click()
            eventually(page, lambda: _assert_eq(urlparse(page.url).path != "/signin", True), "signing in leaves /signin")
        if path != "/signin":
            page.goto(f"{base}{path}")
        yield page


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name)


def alert_with(page: Page, copy: str) -> Locator:
    return page.get_by_role("alert").filter(has_text=copy)


def wait_status(page: Page, name: str, copy: str) -> None:
    eventually(page, lambda: expect(status(page, name)).to_have_text(copy, timeout=POLL_MS), f"{name} says {copy!r}")


WATCH_JS = """(name) => {
  window.__said = window.__said || {};
  const log = window.__said[name] = [];
  const named = el => {
    if ((el.getAttribute('aria-label') || '').trim() === name) return true;
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
    return ids.map(id => ((document.getElementById(id) || {}).textContent || '')).join(' ').trim() === name;
  };
  const find = () => [...document.querySelectorAll('[role="status"], output')].find(named) || null;
  let last = '';
  const read = () => {
    const el = find();
    const t = el ? el.textContent.trim() : '';
    if (t !== last) { last = t; if (t) log.push(t); }
  };
  read();
  new MutationObserver(read).observe(document.documentElement, {subtree: true, childList: true, characterData: true});
}"""


def watch(page: Page, name: str) -> None:
    page.evaluate(WATCH_JS, name)


def times_announced(page: Page, name: str, copy: str) -> int:
    return page.evaluate("([n, c]) => ((window.__said || {})[n] || []).filter(t => t === c).length", [name, copy])


def figure_region(page: Page) -> Locator:
    return page.get_by_role("region", name="Figure")


def to_middle(loc: Locator) -> Locator:
    loc.evaluate("e => e.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'})")
    return loc


def sheet_bounds(page: Page, size: tuple[int, int]) -> None:
    region = figure_region(page)
    top = size[1] - size[1] / SHEET_MAX_FRACTION
    seal = region.get_by_role("button", name="Seal figure", exact=True)
    for what, loc in (("Seal figure", seal),
                      ("Figure details", region.get_by_role("button", name="Figure details")),
                      ("Coverage", region.get_by_role("meter", name="Coverage"))):
        box = loc.bounding_box()
        assert box is not None, f"collapsed sheet: {what} has no box"
        assert box["y"] >= top - 1, f"{what} sits above the bottom third: {box} (sheet top {top})"
        assert box["y"] + box["height"] <= size[1] + 1, f"{what} runs past the bottom of the screen: {box}"
    before = seal.bounding_box()
    page.evaluate("window.scrollBy(0, 400)")
    after = seal.bounding_box()
    page.evaluate("window.scrollBy(0, -400)")
    assert before is not None and after is not None
    assert abs(after["y"] - before["y"]) <= 1, f"the sheet is not fixed to the bottom: {before['y']} -> {after['y']}"


DEFINITION_JS = """(region, label) => {
  const terms = [...region.querySelectorAll('dt, [role="term"]')];
  const dt = terms.find(d => d.textContent.trim() === label);
  if (!dt) return null;
  let dd = dt.nextElementSibling;
  while (dd && !(dd.tagName === 'DD' || dd.getAttribute('role') === 'definition')) dd = dd.nextElementSibling;
  if (!dd) return null;
  const hidden = [...dd.querySelectorAll('[aria-hidden="true"]')];
  const clone = dd.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"]').forEach(n => n.remove());
  return {accessible: clone.textContent.replace(/\\s+/g, ' ').trim(),
          visible: hidden.length ? hidden[0].textContent.trim() : dd.textContent.trim(),
          hiddenCount: hidden.length};
}"""


def definition(page: Page, label: str) -> dict:
    got = figure_region(page).evaluate(DEFINITION_JS, label, timeout=POLL_MS)
    assert got, f"region Figure has no {label!r} term and definition"
    return got


def acc_has(page: Page, label: str, value: str) -> None:
    acc = definition(page, label)["accessible"]
    assert value in acc.split(" "), f"{label} reads {acc!r}, expected {value!r}"


def wait_figure(page: Page, cov: str, net: str) -> None:
    eventually(page, lambda: (acc_has(page, "Coverage", f"{cov}%"), acc_has(page, "Net tCO2e", signed(net))),
               f"region Figure shows {cov}% and {signed(net)}")


def slider(page: Page, name: str) -> Locator:
    return page.get_by_role("slider", name=name)


def brush(page: Page) -> tuple[datetime, datetime]:
    def read(name: str) -> datetime:
        return datetime.strptime(slider(page, name).get_attribute("aria-valuetext"), "%Y-%m-%d %H:%M UTC").replace(tzinfo=UTC)
    return read("Interval start"), read("Interval end")


def expect_brush(page: Page, s: datetime, e: datetime) -> None:
    eventually(page, lambda: (
        expect(slider(page, "Interval start")).to_have_attribute("aria-valuetext", display(s), timeout=POLL_MS),
        expect(slider(page, "Interval end")).to_have_attribute("aria-valuetext", display(e), timeout=POLL_MS),
        expect(slider(page, "Interval position")).to_have_attribute("aria-valuetext", f"{display(s)} to {display(e)}",
                                                                    timeout=POLL_MS)),
        f"brush {display(s)} to {display(e)}")


def mouse_drag(page: Page, loc: Locator, dx: float) -> None:
    x, y = center(loc)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx / 2, y, steps=4)
    page.mouse.move(x + dx, y, steps=4)
    page.mouse.up()


def touch_drag(page: Page, loc: Locator, dx: float) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    to_middle(loc)
    x, y = center(loc)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for k in range(1, 6):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * k / 5, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def open_seal_dialog(page: Page) -> Locator:
    button = figure_region(page).get_by_role("button", name="Seal figure", exact=True)
    eventually(page, lambda: expect(button).to_be_enabled(timeout=POLL_MS), "Seal figure armed")
    button.click()
    dialog = page.get_by_role("dialog", name="Seal figure")
    eventually(page, lambda: expect(dialog).to_be_visible(timeout=POLL_MS), "dialog Seal figure opens")
    return dialog


def wait_dialog_closed(page: Page, name: str) -> None:
    eventually(page, lambda: expect(page.get_by_role("dialog", name=name)).to_have_count(0, timeout=POLL_MS),
               f"dialog {name} closes")


def snapshot(page: Page) -> tuple[str, str, str]:
    return (page.get_by_role("table", name="Figures").inner_text(),
            page.get_by_role("table", name="Sealed-tonnes ledger").inner_text(),
            page.get_by_role("region", name="Project balance").inner_text())


def figure_row(page: Page, fid: str) -> Locator:
    return page.get_by_role("table", name="Figures").get_by_role("row").filter(
        has=page.get_by_role("link", name=fid, exact=True))


def figure_entry(page: Page, fid: str) -> str:
    return figure_row(page, fid).inner_text()


def wait_entry(page: Page, fid: str, word: str) -> None:
    eventually(page, lambda: expect(figure_row(page, fid)).to_contain_text(word, timeout=POLL_MS),
               f"Figures row {fid} reads {word}")


def has_text(body: str, value: str) -> bool:
    return value.casefold() in body.casefold()


def meter_now(page: Page, name: str) -> float:
    return page.get_by_role("meter", name=name).evaluate(
        "e => parseFloat(e.getAttribute('aria-valuenow') ?? e.value)")


def counts_beside(label: str, body: str) -> set[int]:
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    hit = next((i for i, line in enumerate(lines) if label.casefold() in line.casefold()), None)
    assert hit is not None, f"{label} not found in {body!r}"
    return {int(m) for line in lines[max(hit - 1, 0):hit + 2] for m in re.findall(r"-?\d+", line)}


HIDDEN_JS = """(region, labels) => labels.map(label => {
  const cands = [...region.querySelectorAll('dt, [role="term"], button, [role="button"]')]
    .filter(e => e.textContent.trim() === label || e.getAttribute('aria-label') === label);
  if (!cands.length) return true;
  const clipped = e => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return true;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return true;
    for (let p = e.parentElement; p; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (/hidden|clip|auto|scroll/.test(st.overflow + ' ' + st.overflowX + ' ' + st.overflowY)) {
        const pr = p.getBoundingClientRect();
        if (r.bottom <= pr.top || r.top >= pr.bottom || r.right <= pr.left || r.left >= pr.right) return true;
      }
    }
    return false;
  };
  return cands.every(e => {
    const invisible = !e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true});
    const inert = !!e.closest('[inert]') || !!e.closest('[aria-hidden="true"]');
    const gone = getComputedStyle(e).display === 'none' || e.getClientRects().length === 0;
    return gone || ((invisible || clipped(e)) && inert);
  });
})"""


@pytest.mark.timeout(900)


def test_run_manifest_health_and_idempotent_start(app_url):
    base = root(app_url)
    r = anon(base).get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    seeded = {"p-ines", "p-priya", "p-tomas", "p-hal", "p-odile", "p-wren"}
    with start_copies(2) as copies:
        for c in copies:
            h = anon(c).get("/api/health")
            assert h.status_code == 200 and h.json() == {"status": "ok"}
            access = api(c, INES).get("/api/access").json()
            ids = [p["id"] for p in access["people"]]
            for pid in seeded:
                assert ids.count(pid) == 1, f"{pid} appears {ids.count(pid)} times after restart"
            slugs = [p["slug"] for p in access["projects"]]
            assert sorted(slugs) == sorted([BM, SR, HW])
            hal = sorted((g["project"], g["role"]) for g in access["grants"] if g["person_id"] == "p-hal")
            assert hal == sorted([(BM, "sealer"), (SR, "sealer"), (HW, "sealer")])
            assert figure_get(c, TOMAS, fig["id"])["status"] == "sealed", "start-up keeps existing data"
            whole = preview(c, TOMAS, BM, at(6, 1), at(6, 15), BM_IDS).json()
            assert (whole["net_tco2e"], whole["readings_count"]) == ("-16.808", 3648)


def test_server_boundary(browser, app_url):
    base = root(app_url)
    pub = anon(base)
    parts = urlparse(base)
    origin = f"{parts.scheme}://{parts.netloc}"
    bad = {"email": TOMAS, "password": "wrong-password"}
    r = pub.post("/api/session", json=bad, headers={"Origin": FOREIGN_ORIGIN})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    r = pub.post("/api/session", json=bad, headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    r = pub.post("/api/session", json=bad, headers={"Origin": origin, "Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 401 and r.json() == {"error": "invalid_credentials"}
    r = pub.post("/api/session", json=bad)
    assert r.status_code == 401
    r = api(base, TOMAS).post(f"/api/projects/{BM}/preview", headers={"Origin": FOREIGN_ORIGIN},
                              json={"start": iso(at(6, 4)), "end": iso(at(6, 4, 6)), "sensor_ids": BM_IDS})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    r = api(base, PRIYA).post(f"/api/projects/{BM}/readings", headers={"Origin": FOREIGN_ORIGIN}, json={"readings": []})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}, "a steward's cross-site ingestion is refused"
    r = api(base, PRIYA).post(f"/api/projects/{BM}/readings", headers={"Sec-Fetch-Site": "cross-site"}, json={"readings": []})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    g = pub.get("/api/health", headers={"Origin": FOREIGN_ORIGIN})
    assert g.status_code == 200 and all(FOREIGN_ORIGIN not in v for v in g.headers.values()), "the request Origin was echoed"
    raw = json.dumps(bad).encode()
    exact = raw + b" " * (BODY_LIMIT - len(raw))
    r = pub.post("/api/session", content=exact, headers={"Content-Type": "application/json"})
    assert r.status_code == 401, "a body of exactly 65,536 bytes is allowed"
    r = pub.post("/api/session", content=exact + b" ", headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    r = pub.get("/api/no-such-endpoint-probe")
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    shell = pub.get("/no-such-screen-probe")
    assert shell.status_code == 200 and not shell.text.lstrip().startswith("{"), "unknown pages get the app shell"
    for path, marker in (("/run.json", "run-manifest-v1"), ("/package.json", '"dependencies"'),
                         ("/tsconfig.json", '"compilerOptions"'), ("/.env", "DATABASE_URL")):
        assert marker not in pub.get(path).text, f"{path} served its contents"
    secrets = [os.environ.get("S3_SECRET_ACCESS_KEY"), os.environ.get("S3_ACCESS_KEY_ID"),
               urlparse(os.environ.get("DATABASE_URL", "")).password]
    secrets = [s for s in secrets if s and len(s) >= 6]
    assets = [shell.text] + [pub.get(p).text for p in set(re.findall(r'(?:src|href)="(/[^"]*)"', shell.text))]
    for body in assets:
        for s in secrets:
            assert s not in body, "a credential reached the browser"
    for env in ("APP_MINIO_DOWN_URL", "APP_MAIL_DOWN_URL"):
        h = anon(outage(env)).get("/api/health")
        assert h.status_code == 200 and h.json() == {"status": "ok"}, f"{env} did not start"
    seen: list[str] = []
    with signed_in(browser, base, TOMAS, ws_path(BM, "2026-06-03", "2026-06-07", at(6, 4), at(6, 5), BM_IDS),
                   hook=lambda p: p.on("request", lambda req: seen.append(req.url))) as page:
        wait_figure(page, "100.0", "-1.636")
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, origin)]
    assert foreign == [], f"browser loaded from other origins: {foreign}"


def _error_shape(r: httpx.Response) -> None:
    body = r.json()
    assert (set(body) >= {"error"} and isinstance(body["error"], str)) or \
        (set(body) == {"errors"} and isinstance(body["errors"], dict)), r.text


def test_error_shapes_and_precedence(app_url):
    base = root(app_url)
    pub = anon(base)
    evil = {"Origin": FOREIGN_ORIGIN}
    checks: list[httpx.Response] = []
    r = pub.post("/api/session", content=b"{}", headers={"Content-Type": "text/plain", **evil})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    checks.append(r)
    r = pub.post("/api/session", content=b'{"email":', headers={"Content-Type": "application/json", **evil})
    assert r.status_code == 400 and r.json() == {"error": "invalid_json"}
    checks.append(r)
    r = pub.post("/api/session", content=b"{}" + b" " * BODY_LIMIT, headers={"Content-Type": "application/json", **evil})
    assert r.status_code == 413
    checks.append(r)
    r = pub.post(f"/api/projects/{BM}/preview", json={}, headers=evil)
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    r = pub.post(f"/api/projects/{BM}/preview", json={})
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    assert pub.get("/api/me").status_code == 401
    wren, odile, tomas = api(base, WREN), api(base, ODILE), api(base, TOMAS)
    r = wren.post(f"/api/projects/{SR}/preview", json={"start": "bad"})
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    r = wren.post(f"/api/projects/{BM}/preview", json={"start": "bad"})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    for body, keys in (
        ({"start": "2026-06-04T00:15:00Z", "end": "2026-06-04 06:00", "sensor_ids": []}, {"start", "end", "sensor_ids"}),
        ({"start": "2026-06-04T00:00:00.000Z", "end": iso(at(6, 4, 6)), "sensor_ids": BM_IDS}, {"start"}),
        ({"start": "2026-05-31T23:30:00Z", "end": iso(at(6, 4, 6)), "sensor_ids": BM_IDS}, {"start"}),
        ({"start": iso(at(6, 4)), "end": "2099-01-01T00:00:00Z", "sensor_ids": BM_IDS}, {"end"}),
        ({"start": iso(at(6, 4)), "end": iso(at(6, 4, 6)), "sensor_ids": ["BM-T1", "BM-T1"]}, {"sensor_ids"}),
        ({"start": iso(at(6, 4)), "end": iso(at(6, 4, 6)), "sensor_ids": ["SR-T1"]}, {"sensor_ids"}),
    ):
        r = odile.post(f"/api/projects/{BM}/preview", json=body)
        assert r.status_code == 422 and keys <= set(r.json()["errors"]), f"{body}: {r.text}"
        checks.append(r)
    r = odile.post(f"/api/projects/{BM}/preview", json={"start": iso(at(6, 4)), "end": iso(at(6, 4)), "sensor_ids": BM_IDS})
    assert r.status_code == 422
    good = json.dumps({"start": iso(at(6, 4)), "end": iso(at(6, 4, 6)), "sensor_ids": BM_IDS}).encode()
    r = odile.post(f"/api/projects/{BM}/preview", content=good, headers={"Content-Type": "application/json; charset=utf-8"})
    assert r.status_code == 200 and r.json()["net_tco2e"] == "0.061"
    slot = std_slot(base)
    key = idempotency_key()
    fig = sealed(slot, 0, 8, key=key)
    r = tomas.post(f"/api/projects/{BM}/figures", headers={"Idempotency-Key": key},
                   json={"start": iso(slot.at(0)), "end": iso(slot.at(8)), "sensor_ids": [], "preview_fingerprint": "x"})
    assert r.status_code == 409 and r.json() == {"error": "idempotency_key_conflict"}, "key conflict precedes 422"
    r = tomas.post(f"/api/projects/{BM}/figures", headers={"Idempotency-Key": idempotency_key()},
                   json={"start": iso(slot.at(2)), "end": iso(slot.at(10)), "sensor_ids": BM_IDS})
    assert r.status_code == 422 and "preview_fingerprint" in r.json()["errors"], "422 precedes the overlap 409"
    r = tomas.post(f"/api/figures/{fig['id']}/links", content=b"", headers={"Content-Type": "text/plain"})
    assert r.status_code == 201, "an empty body skips the media type check"
    for c in checks:
        _error_shape(c)


def test_sign_in_sessions(browser, app_url):
    base = root(app_url)
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    r = c.post("/api/session", json={"email": TOMAS, "password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["person"] == {"id": "p-tomas", "name": "Tomas Reyes", "email": TOMAS, "org_role": "member"}
    cookie = r.headers["set-cookie"]
    lowered = cookie.lower()
    assert "HttpOnly".lower() in lowered and "SameSite=Lax".lower() in lowered, cookie
    assert re.search(r"Path=/(;|$)", cookie, re.I), cookie
    assert c.get("/api/me").json()["person"]["id"] == "p-tomas"
    other = httpx.get(f"{outage('APP_MINIO_DOWN_URL')}/api/me", headers={"Cookie": cookie_header(c)}, timeout=HTTP_TIMEOUT_S)
    assert other.status_code == 200 and other.json()["person"]["id"] == "p-tomas", "session valid on every instance"
    for creds in ({"email": TOMAS, "password": "not-the-password"}, {"email": "nobody@levelmoor.example", "password": PASSWORD}):
        bad = anon(base).post("/api/session", json=creds)
        assert bad.status_code == 401 and bad.json() == {"error": "invalid_credentials"}
    assert c.delete("/api/session").status_code == 204
    assert c.get("/api/me").status_code == 401
    with open_app(browser, f"{base}/projects") as page:
        eventually(page, lambda: _assert_eq(urlparse(page.url).path, "/signin"), "signed-out screens redirect to /signin")
        page.get_by_role("textbox", name="Email").fill(TOMAS)
        page.get_by_label("Password", exact=True).fill("not-the-password")
        page.get_by_role("button", name="Sign in").click()
        eventually(page, lambda: expect(alert_with(page, COPY_WRONG_CREDS)).to_have_text(COPY_WRONG_CREDS, timeout=POLL_MS),
                   "wrong credentials copy")
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        nav = page.get_by_role("navigation", name="Main")
        eventually(page, lambda: expect(nav.get_by_role("button", name="Sign out")).to_be_visible(timeout=POLL_MS), "signed in")
        expect(nav.get_by_role("link", name="Projects")).to_be_visible()
        expect(nav.get_by_role("link", name="Access")).to_have_count(0)


VISIBLE = {
    INES: {BM: "viewer", SR: "viewer", HW: "viewer"},
    PRIYA: {BM: "viewer", SR: "viewer", HW: "viewer"},
    TOMAS: {BM: "sealer", SR: "analyst"},
    HAL: {BM: "sealer", SR: "sealer", HW: "sealer"},
    ODILE: {BM: "analyst"},
    WREN: {BM: "viewer"},
}


def test_project_visibility_from_grants(app_url):
    base = root(app_url)
    for email, roles in VISIBLE.items():
        c = api(base, email)
        got = {p["slug"]: p["role"] for p in c.get("/api/projects").json()["projects"]}
        assert got == roles, f"{email}: {got}"
        for slug in {BM, SR, HW} - set(roles):
            r = c.get(f"/api/projects/{slug}")
            assert r.status_code == 404 and r.json() == {"error": "not_found"}
    body = {"start": iso(at(6, 4)), "end": iso(at(6, 4, 6)), "sensor_ids": BM_IDS}
    assert api(base, WREN).post(f"/api/projects/{BM}/preview", json=body).status_code == 403
    assert api(base, ODILE).post(f"/api/projects/{BM}/preview", json=body).status_code == 200
    assert api(base, HAL).get("/api/access").status_code == 403
    assert api(base, INES).get("/api/access").status_code == 200
    slot = std_slot(base)
    r = seal(slot, 0, 6, ODILE)
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    admin = api(base, INES)
    try:
        assert admin.put(f"/api/projects/{BM}/grants/p-ines", json={"role": "sealer"}).status_code == 200
        roles = {p["slug"]: p["role"] for p in admin.get("/api/projects").json()["projects"]}
        assert roles[BM] == "sealer" and roles[SR] == "viewer"
        fig = sealed(slot, 0, 6, INES)
        assert fig["sealed_by"] == "p-ines"
    finally:
        admin.delete(f"/api/projects/{BM}/grants/p-ines")
    r = seal(slot, 6, 12, INES)
    assert r.status_code == 403
    assert admin.post(f"/api/projects/{BM}/preview", json=body).status_code == 403


def test_role_grant_management(app_url):
    base = root(app_url)
    admin, wren = api(base, INES), api(base, WREN)
    down = outage("APP_MINIO_DOWN_URL")
    try:
        assert wren.get(f"/api/projects/{HW}").status_code == 404
        r = admin.put(f"/api/projects/{HW}/grants/p-wren", json={"role": "viewer"})
        assert r.status_code == 200 and r.json() == {"person_id": "p-wren", "project": HW, "role": "viewer"}
        assert wren.get(f"/api/projects/{HW}").json()["role"] == "viewer"
        assert api(down, WREN).get(f"/api/projects/{HW}").json()["role"] == "viewer", "applies on every instance"
        assert admin.put(f"/api/projects/{HW}/grants/p-wren", json={"role": "sealer"}).json()["role"] == "sealer"
        assert wren.get(f"/api/projects/{HW}").json()["role"] == "sealer"
        grants = admin.get("/api/access").json()["grants"]
        assert [g["role"] for g in grants if g["person_id"] == "p-wren" and g["project"] == HW] == ["sealer"]
        assert admin.delete(f"/api/projects/{HW}/grants/p-wren").status_code == 204
        assert admin.delete(f"/api/projects/{HW}/grants/p-wren").status_code == 204, "204 also when no grant existed"
        assert wren.get(f"/api/projects/{HW}").status_code == 404
        r = api(base, HAL).put(f"/api/projects/{HW}/grants/p-wren", json={"role": "viewer"})
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}
        r = admin.put(f"/api/projects/{HW}/grants/p-nobody", json={"role": "viewer"})
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
        assert admin.delete(f"/api/projects/{HW}/grants/p-nobody").status_code == 404
        r = admin.put(f"/api/projects/{HW}/grants/p-wren", json={"role": "owner"})
        assert r.status_code == 422 and "role" in r.json()["errors"]
        assert admin.put(f"/api/projects/{BM}/grants/p-wren", json={"role": "sealer"}).status_code == 200
        slot = std_slot(base)
        fig = sealed(slot, 0, 6, WREN)
        link = issue_link(base, WREN, fig["id"])
        assert admin.put(f"/api/projects/{BM}/grants/p-wren", json={"role": "viewer"}).status_code == 200
        assert seal(slot, 6, 12, WREN).status_code == 403
        assert wren.get(f"/api/figures/{fig['id']}/links").status_code == 403
        pub = anon(base).get(f"/api/public/links/{link['token']}")
        assert pub.status_code == 200 and pub.json()["link"]["status"] == "live", "lowering a grant never revokes links"
    finally:
        admin.put(f"/api/projects/{BM}/grants/p-wren", json={"role": "viewer"})
        admin.delete(f"/api/projects/{HW}/grants/p-wren")


def test_wf_access_grants_remove_and_lower(browser, app_url):
    base = root(app_url)
    admin = api(base, INES)
    path = ws_path(SR, "2026-06-09", "2026-06-09", at(6, 9, 10), at(6, 9, 12), SR_IDS)
    try:
        assert admin.put(f"/api/projects/{SR}/grants/p-odile", json={"role": "sealer"}).status_code == 200
        assert admin.put(f"/api/projects/{SR}/grants/p-wren", json={"role": "viewer"}).status_code == 200
        with signed_in(browser, base, ODILE, path) as odile, signed_in(browser, base, WREN, path) as wren, \
                signed_in(browser, base, INES, "/admin/access") as ines:
            wait_figure(odile, "100.0", "-0.065")
            dialog = open_seal_dialog(odile)
            eventually(wren, lambda: expect(wren.get_by_text(COPY_ROLE_VIEWER)).to_be_visible(timeout=POLL_MS), "viewer copy")
            eventually(ines, lambda: expect(ines.get_by_role("table", name="Access")).to_be_visible(timeout=POLL_MS), "Access")
            select(grant_box(ines, "Odile Marsh", "Saltings Reach"), "Analyst")
            wait_status(ines, "Access status", copy_grant_saved("Odile Marsh", "Saltings Reach", "Analyst"))
            select(grant_box(ines, "Wren Adeyemi", "Saltings Reach"), "No access")
            wait_status(ines, "Access status", copy_grant_saved("Wren Adeyemi", "Saltings Reach", "No access"))
            grants = {(g["person_id"], g["project"]): g["role"] for g in admin.get("/api/access").json()["grants"]}
            assert grants.get(("p-odile", SR)) == "analyst" and ("p-wren", SR) not in grants
            dialog.get_by_role("button", name="Confirm seal").click()
            eventually(odile, lambda: expect(dialog.get_by_role("alert")).to_have_text(COPY_ROLE_ANALYST, timeout=POLL_MS),
                       "the dialog refuses with the role copy")
            advance(wren, REFRESH_MS)
            eventually(wren, lambda: _assert_eq(urlparse(wren.url).path, "/projects"), "lost access moves to /projects")
            eventually(wren, lambda: expect(alert_with(wren, COPY_LOST_ACCESS)).to_have_text(COPY_LOST_ACCESS, timeout=POLL_MS),
                       "lost-access copy")
            expect(wren.get_by_role("link", name="Saltings Reach")).to_have_count(0)
        assert figures_at(base, HAL, SR, at(6, 9, 10), at(6, 9, 12)) == [], "nothing was sealed"
    finally:
        admin.delete(f"/api/projects/{SR}/grants/p-odile")
        admin.delete(f"/api/projects/{SR}/grants/p-wren")


def test_wf_access_grants_grant_then_remove(browser, app_url):
    base = root(app_url)
    admin, wren = api(base, INES), api(base, WREN)
    body = {"start": iso(at(6, 5, 10)), "end": iso(at(6, 5, 12)), "sensor_ids": SR_IDS}
    try:
        assert wren.post(f"/api/projects/{SR}/preview", json=body).status_code == 404
        with signed_in(browser, base, INES, "/admin/access") as page:
            box = grant_box(page, "Wren Adeyemi", "Saltings Reach")
            eventually(page, lambda: expect(box).to_be_visible(timeout=POLL_MS), "Access grid")
            select(box, "Analyst")
            wait_status(page, "Access status", copy_grant_saved("Wren Adeyemi", "Saltings Reach", "Analyst"))
            r = wren.post(f"/api/projects/{SR}/preview", json=body)
            assert r.status_code == 200 and r.json()["net_tco2e"] == "-0.065"
            select(box, "No access")
            wait_status(page, "Access status", copy_grant_saved("Wren Adeyemi", "Saltings Reach", "No access"))
        assert wren.get(f"/api/projects/{SR}").status_code == 404
    finally:
        admin.delete(f"/api/projects/{SR}/grants/p-wren")


def _bounds(poly: list) -> tuple:
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    box = (min(xs), min(ys), max(xs), max(ys))
    corners = {(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])}
    assert {(p[0], p[1]) for p in poly} == corners, f"not the published rectangle: {poly}"
    return box


def test_project_workspace_data(app_url):
    base = root(app_url)
    p = api(base, TOMAS).get(f"/api/projects/{BM}").json()
    assert (p["slug"], p["name"], p["kind"], p["code"], p["floor_pct"], p["buffer_pct"], p["lead_person_id"], p["role"]) == \
        (BM, "Blackmere Moss", "peatland rewetting", "BM", "60.0", "15.0", "p-hal", "sealer")
    assert _bounds(p["boundary"]) == PROJECTS[BM]["boundary"] and p["boundary_area_m2"] == boundary_area(BM)
    assert {s["id"]: (_bounds(s["polygon"]), s["kind"]) for s in p["sensors"]} == PROJECTS[BM]["sensors"]
    assert p["record_start"] == "2026-06-01T00:00:00Z" and TS_RE.match(p["record_end"])
    assert {"sealed_net_tco2e", "buffer_tco2e", "intact_count", "broken_count", "superseded_count"} <= set(p["summary"])
    s = api(base, TOMAS).get(f"/api/projects/{SR}").json()
    assert (s["record_start"], s["record_end"], s["role"], s["floor_pct"], s["buffer_pct"]) == \
        ("2026-06-01T00:00:00Z", "2026-06-15T00:00:00Z", "analyst", "50.0", "10.0")
    h = api(base, HAL).get(f"/api/projects/{HW}").json()
    assert (h["record_start"], h["record_end"], h["code"], h["boundary_area_m2"]) == (None, None, "HW", 160000)
    assert api(base, HAL).get("/api/projects/no-such-project").status_code == 404


def test_daily_flux_timeline(browser, app_url):
    base = root(app_url)
    c = api(base, TOMAS)
    days = c.get(f"/api/projects/{BM}/timeline", params={"from": "2026-06-01", "to": "2026-06-14"}).json()["days"]
    assert [(d["date"], d["net_tco2e"], d["coverage_pct"]) for d in days] == SEED_DAYS
    r = c.get(f"/api/projects/{BM}/timeline", params={"from": "2026-6-1"})
    assert r.status_code == 422 and "from" in r.json()["errors"]
    emit = new_slot(base, lambda d: block(d, half_hours=48, fc=lambda s, j: "2.0"))
    exp = emit.expect(0, 48)
    assert Decimal(exp["net_tco2e"]) > 0
    got = c.get(f"/api/projects/{BM}/timeline", params={"from": emit.date, "to": emit.date}).json()["days"]
    assert [(d["date"], d["net_tco2e"], d["coverage_pct"]) for d in got] == [(emit.date, exp["net_tco2e"], exp["coverage_pct"])]
    with signed_in(browser, base, TOMAS, ws_path(BM, "2026-06-01", "2026-06-14", at(6, 1), at(6, 15), BM_IDS)) as page:
        group = page.get_by_role("group", name="Flux timeline")
        bars = group.get_by_role("list", name="Daily net CO2e").get_by_role("listitem")
        eventually(page, lambda: expect(bars).to_have_count(14, timeout=POLL_MS), "14 day bars")
        names = [f"{d} {signed(n)} tCO2e" for d, n, _ in SEED_DAYS]
        for i, name in enumerate(names):
            expect(bars.nth(i)).to_have_accessible_name(name)
        rule = group.get_by_role("separator", name="Zero rule").bounding_box()
        rule_y = rule["y"] + rule["height"] / 2
        boxes = [bars.nth(i).bounding_box() for i in range(14)]
        for name, box in zip(names, boxes):
            assert box["y"] >= rule_y - 1, f"{name} is not below the zero rule"
        assert boxes[2]["height"] > boxes[0]["height"], "a larger uptake draws a taller bar"
        page.goto(f"{base}{ws_path(BM, emit.date, emit.date, emit.at(0), emit.at(48), BM_IDS)}")
        eventually(page, lambda: expect(bars).to_have_count(1, timeout=POLL_MS), "one bar in the emission window")
        expect(bars.first).to_have_accessible_name(f"{emit.date} {signed(exp['net_tco2e'])} tCO2e")
        rule = group.get_by_role("separator", name="Zero rule").bounding_box()
        box = bars.first.bounding_box()
        assert box["y"] + box["height"] <= rule["y"] + rule["height"] / 2 + 1, "an emission bar sits above the zero rule"


def test_server_unit_chain_and_allocation(app_url):
    base = root(app_url)
    pv = preview(base, TOMAS, BM, at(6, 1), at(6, 15), BM_IDS).json()
    assert (pv["coverage_pct"], pv["net_tco2e"], pv["co2_tco2e"], pv["ch4_tco2e"],
            pv["readings_count"], pv["sealable"], pv["blocked_reason"]) == \
        ("85.0", "-16.808", "-20.647", "3.839", 3648, True, None)
    assert [c["sensor_id"] for c in pv["contributions"]] == list(WHOLE_BM_CONTRIBUTIONS)
    for c in pv["contributions"]:
        area, qual, co2, ch4, net = WHOLE_BM_CONTRIBUTIONS[c["sensor_id"]]
        assert (int(c["area_m2"]), c["qualifying_half_hours"], c["half_hours"], c["co2_tco2e"], c["ch4_tco2e"], c["net_tco2e"]) == \
            (area, qual, 672, co2, ch4, net), c
    sr = preview(base, TOMAS, SR, at(6, 5, 10), at(6, 5, 12), SR_IDS).json()
    assert (sr["coverage_pct"], sr["net_tco2e"], sr["co2_tco2e"], sr["ch4_tco2e"],
            sr["readings_count"]) == ("100.0", "-0.065", "-0.101", "0.037", 12)
    assert [(c["sensor_id"], c["co2_tco2e"], c["ch4_tco2e"], c["net_tco2e"]) for c in sr["contributions"]] == [
        ("SR-S1", "-0.022", "0.011", "-0.011"), ("SR-S2", "-0.022", "0.011", "-0.012"), ("SR-T1", "-0.057", "0.015", "-0.042")]
    night = preview(base, TOMAS, BM, at(6, 4), at(6, 4, 6), BM_IDS).json()
    assert (night["net_tco2e"], night["co2_tco2e"], night["ch4_tco2e"], night["readings_count"]) == ("0.061", "-0.019", "0.080", 72)

    def fc(s: str, j: int) -> str:
        return f"{(Decimal(-2) + Decimal((j * 37 + len(s) * 3) % 11) * Decimal('0.1234')).quantize(Q4):f}"

    def fch4(s: str, j: int) -> str:
        return f"{(Decimal(7) + Decimal((j * 13 + ord(s[-1])) % 17) * Decimal('1.0371')).quantize(Q4):f}"

    odd = new_slot(base, lambda d: block(d, fc=fc, fch4=fch4))
    for a, b, sensors in ((0, 12, BM_IDS), (1, 11, BM_IDS), (0, 7, ["BM-S2", "BM-S4", "BM-T2"])):
        exp = odd.expect(a, b, sensors)
        got = preview(base, TOMAS, BM, odd.at(a), odd.at(b), sensors).json()
        assert_derived(got, exp, f"uneven {a}-{b}")
        for col in ("co2_tco2e", "ch4_tco2e", "net_tco2e"):
            assert sum(Decimal(c[col]) for c in got["contributions"]) == Decimal(got[col]), f"{col} column sums to the total"


def test_coverage_against_boundary(app_url):
    base = root(app_url)
    pv = preview(base, TOMAS, BM, at(6, 3), at(6, 8), BM_IDS).json()
    assert pv["coverage_pct"] == "100.0"
    assert {c["sensor_id"]: int(c["area_m2"]) for c in pv["contributions"]} == {
        "BM-T1": 160000, "BM-T2": 90000, "BM-S1": 70000, "BM-S2": 120000, "BM-S3": 70000, "BM-S4": 90000}
    for subset in (["BM-S4", "BM-T2"], ["BM-S1", "BM-S2", "BM-S3", "BM-S4"], ["BM-T1"], ["BM-S2", "BM-T1", "BM-T2"]):
        areas = allocate_areas(BM, subset)
        got = preview(base, TOMAS, BM, at(6, 3), at(6, 8), subset).json()
        assert got["coverage_pct"] == pct1(Decimal(sum(areas.values())) * 100 / Decimal(boundary_area(BM))), subset
        assert {c["sensor_id"]: int(c["area_m2"]) for c in got["contributions"]} == areas
    sr = preview(base, TOMAS, SR, at(6, 1), at(6, 15), SR_IDS).json()
    assert {c["sensor_id"]: int(c["area_m2"]) for c in sr["contributions"]} == {"SR-T1": 120000, "SR-S1": 140000, "SR-S2": 140000}
    assert sr["coverage_pct"] == "100.0"


def test_buffer_withholding(app_url):
    base = root(app_url)
    cases = [
        (BM, at(6, 1), at(6, 15), BM_IDS, "-16.808", "2.521", "-14.287"),
        (BM, at(6, 3), at(6, 8), BM_IDS, "-8.182", "1.227", "-6.955"),
        (BM, at(6, 4), at(6, 4, 6), BM_IDS, "0.061", "0.000", "0.061"),
        (SR, at(6, 1), at(6, 15), SR_IDS, "-10.854", "1.085", "-9.769"),
        (SR, at(6, 5, 10), at(6, 5, 12), SR_IDS, "-0.065", "0.006", "-0.059"),
    ]
    for slug, a, b, sensors, net, buf, cred in cases:
        pv = preview(base, TOMAS, slug, a, b, sensors).json()
        assert (pv["net_tco2e"], pv["buffer_tco2e"], pv["credited_tco2e"]) == (net, buf, cred), f"{slug} {a}-{b}: {pv}"
        assert pv["buffer_pct"] == PROJECTS[slug]["buffer"]
    odd = new_slot(base, lambda d: block(d, fc=lambda s, j: f"{(Decimal('-2.0137') * (j + 1) / 3).quantize(Q4):f}"))
    exp = odd.expect(0, 12)
    n = Decimal(exp["net_tco2e"])
    assert n < 0
    want_buffer = t3((abs(n) * Decimal("15.0") / 100).quantize(Q3, rounding=ROUND_HALF_EVEN))
    fig = sealed(odd, 0, 12)
    assert (fig["buffer_pct"], fig["buffer_tco2e"], fig["credited_tco2e"]) == ("15.0", want_buffer, t3(n + Decimal(want_buffer)))
    assert figure_get(base, TOMAS, fig["id"])["buffer_tco2e"] == want_buffer
    emit = new_slot(base, lambda d: block(d, fc=lambda s, j: "2.0"))
    efig = sealed(emit, 0, 12)
    assert Decimal(efig["net_tco2e"]) > 0 and efig["buffer_tco2e"] == "0.000" and efig["credited_tco2e"] == efig["net_tco2e"]


def test_buffer_and_credited_in_the_figure_panel(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    exp = slot.expect(0, 12)
    with _seal_page(browser, base, slot, size=PHONE) as page:
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        details = figure_region(page).get_by_role("button", name="Figure details")
        details.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(details).to_have_attribute("aria-expanded", "true", timeout=POLL_MS),
                   "Figure details expands the sheet")
        for label, want in (("Buffer tCO2e", exp["buffer_tco2e"]), ("Credited tCO2e", exp["credited_tco2e"])):
            eventually(page, lambda label=label, want=want: _assert_eq(
                want in definition(page, label)["accessible"], True),
                f"L216 the panel states {label} as {want}")
        dialog = open_seal_dialog(page)
        for value in (exp["buffer_tco2e"], exp["credited_tco2e"]):
            expect(dialog).to_contain_text(value)


def test_contributing_sensors_eighty_percent(app_url):
    base = root(app_url)

    def qc(s: str, j: int) -> int:
        if s == "BM-S4" and j in (0, 1):
            return 3
        if s == "BM-S2" and j in (10, 11):
            return 2
        return 1 if s == "BM-S1" else 0

    slot = new_slot(base, lambda d: block(d, qc=qc))
    for a, b, coverage, out in ((0, 10, "100.0", None), (0, 9, "85.0", "BM-S4"), (2, 12, "100.0", None), (3, 12, "80.0", "BM-S2")):
        exp = slot.expect(a, b)
        got = preview(base, TOMAS, BM, slot.at(a), slot.at(b), BM_IDS).json()
        assert got["coverage_pct"] == exp["coverage_pct"] == coverage, f"{a}-{b}"
        ids = [c["sensor_id"] for c in got["contributions"]]
        assert ids == [c["sensor_id"] for c in exp["contributions"]]
        assert (out not in ids) if out else ids == BM_IDS
        assert got["net_tco2e"] == exp["net_tco2e"]
    edge = preview(base, TOMAS, BM, slot.at(0), slot.at(10), BM_IDS).json()
    s4 = next(c for c in edge["contributions"] if c["sensor_id"] == "BM-S4")
    assert (s4["qualifying_half_hours"], s4["half_hours"]) == (8, 10), "exactly 80 percent contributes"


def test_timeline_brush(browser, app_url):
    base = root(app_url)
    path = ws_path(SR, "2026-06-11", "2026-06-14", at(6, 12, 10), at(6, 12, 12), SR_IDS)
    with signed_in(browser, base, TOMAS, path) as page:
        expect_brush(page, at(6, 12, 10), at(6, 12, 12))
        start, end, body = slider(page, "Interval start"), slider(page, "Interval end"), slider(page, "Interval position")
        steps = [
            (start, "ArrowRight", at(6, 12, 10, 30), at(6, 12, 12)),
            (start, "ArrowLeft", at(6, 12, 10), at(6, 12, 12)),
            (start, "ArrowDown", at(6, 12, 9, 30), at(6, 12, 12)),
            (start, "ArrowUp", at(6, 12, 10), at(6, 12, 12)),
            (start, "PageDown", at(6, 11, 10), at(6, 12, 12)),
            (start, "PageUp", at(6, 12, 10), at(6, 12, 12)),
            (end, "PageUp", at(6, 12, 10), at(6, 13, 12)),
            (end, "PageDown", at(6, 12, 10), at(6, 12, 12)),
            (body, "ArrowRight", at(6, 12, 10, 30), at(6, 12, 12, 30)),
            (body, "ArrowLeft", at(6, 12, 10), at(6, 12, 12)),
            (body, "PageUp", at(6, 13, 10), at(6, 13, 12)),
            (body, "PageDown", at(6, 12, 10), at(6, 12, 12)),
            (body, "End", at(6, 14, 22), at(6, 15)),
            (body, "Home", at(6, 11), at(6, 11, 2)),
            (end, "End", at(6, 11), at(6, 15)),
            (start, "Home", at(6, 11), at(6, 15)),
        ]
        for loc, key, s, e in steps:
            loc.focus()
            loc.press(key)
            expect_brush(page, s, e)
        start.focus()
        start.press("PageUp")
        expect_brush(page, at(6, 12), at(6, 15))
        page.get_by_role("button", name="Next interval").click()
        expect_brush(page, at(6, 12), at(6, 15))
        body.focus()
        body.press("Home")
        expect_brush(page, at(6, 11), at(6, 14))
        page.get_by_role("button", name="Next interval").click()
        expect_brush(page, at(6, 12), at(6, 15))
        page.get_by_role("button", name="Previous interval").click()
        expect_brush(page, at(6, 11), at(6, 14))
        page.get_by_role("button", name="Previous interval").click()
        expect_brush(page, at(6, 11), at(6, 14))

        end.focus()
        end.press("Home")
        s0, e0 = brush(page)
        assert s0 < e0, "start always stays before end"
        end.press("PageUp")
        body.focus()
        body.press("PageUp")
        expect_brush(page, at(6, 12), at(6, 13, 0, 30))
        s1, e1 = brush(page)
        mouse_drag(page, body, -40)
        advance(page, SETTLE_MS)
        s2, e2 = brush(page)
        assert e2 - s2 == e1 - s1 and s2 < s1, "dragging the body keeps the span and moves both ends"
        mouse_drag(page, end, 30)
        advance(page, SETTLE_MS)
        s3, e3 = brush(page)
        assert s3 == s2 and e3 > e2, "dragging the end handle resizes that end only"
        for value in (s3, e3):
            assert value.minute in (0, 30) and value.second == 0, "the brush covers whole half-hours"
            assert at(6, 11) <= value <= at(6, 15)


def test_date_window_and_sensor_filters(browser, app_url):
    base = root(app_url)
    path = ws_path(BM, "2026-06-01", "2026-06-14", at(6, 1), at(6, 15), BM_IDS)
    with signed_in(browser, base, TOMAS, path) as page:
        bars = page.get_by_role("group", name="Flux timeline").get_by_role("list", name="Daily net CO2e").get_by_role("listitem")
        eventually(page, lambda: expect(bars).to_have_count(14, timeout=POLL_MS), "14 bars")
        page.get_by_label("From", exact=True).fill("2026-06-05")
        page.get_by_label("To", exact=True).fill("2026-06-07")
        page.get_by_role("button", name="Apply dates").click()
        eventually(page, lambda: expect(bars).to_have_count(3, timeout=POLL_MS), "Apply dates keeps only the window's days")
        first_day, first_net, _ = SEED_DAYS[4]
        expect(bars.first).to_have_accessible_name(f"{first_day} {signed(first_net)} tCO2e")
        expect_brush(page, at(6, 5), at(6, 8))
        page.get_by_label("From", exact=True).fill("2026-06-07")
        page.get_by_label("To", exact=True).fill("2026-06-05")
        page.get_by_role("button", name="Apply dates").click()
        eventually(page, lambda: expect(alert_with(page, COPY_TO_BEFORE_FROM)).to_have_text(COPY_TO_BEFORE_FROM, timeout=POLL_MS),
                   "To before From shows the window error")
        expect(bars).to_have_count(3)
        expect_brush(page, at(6, 5), at(6, 8))

    path = ws_path(BM, "2026-06-04", "2026-06-04", at(6, 4), at(6, 4, 6), BM_IDS)
    areas = allocate_areas(BM, [s for s in BM_IDS if s != "BM-S2"])
    coverage_wo = pct1(Decimal(sum(areas.values())) * 100 / Decimal(boundary_area(BM)))
    with signed_in(browser, base, TOMAS, path) as page:
        wait_figure(page, "100.0", "0.061")

        def cb(s: str) -> Locator:
            return page.get_by_role("group", name="Sensors").get_by_role("checkbox", name=s)

        def fp(s: str) -> Locator:
            return page.get_by_role("group", name="Coverage map").get_by_role("button", name=f"{s} footprint")

        def wait_cov(c: str) -> None:
            eventually(page, lambda: acc_has(page, "Coverage", f"{c}%"), f"coverage {c}%")

        cb("BM-S2").click()
        eventually(page, lambda: expect(fp("BM-S2")).to_have_attribute("aria-pressed", "false", timeout=POLL_MS),
                   "footprint mirrors the unticked checkbox")
        wait_cov(coverage_wo)
        fp("BM-S2").click()
        eventually(page, lambda: expect(cb("BM-S2")).to_be_checked(timeout=POLL_MS), "footprint click ticks the checkbox")
        wait_cov("100.0")
        fp("BM-S2").focus()
        fp("BM-S2").press("Enter")
        eventually(page, lambda: expect(cb("BM-S2")).not_to_be_checked(timeout=POLL_MS), "Enter on a footprint unticks")
        fp("BM-S2").press(" ")
        eventually(page, lambda: expect(cb("BM-S2")).to_be_checked(timeout=POLL_MS), "Space on a footprint ticks")
        for s in ["BM-S1", "BM-S2", "BM-S3", "BM-T1", "BM-T2"]:
            cb(s).click()
            eventually(page, lambda: expect(cb(s)).not_to_be_checked(timeout=POLL_MS), f"{s} unticked")
        eventually(page, lambda: expect(cb("BM-S4")).to_be_disabled(timeout=POLL_MS), "the last selected checkbox is disabled")
        expect(fp("BM-S4")).to_be_disabled()
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"sensors=BM-S4$"), timeout=POLL_MS),
                   "the address carries the chosen sensor")


def _release_previews(page: Page, routes: list, cov: str) -> None:
    for _ in range(PREVIEW_STEPS):
        if routes:
            break
        advance(page, STEP_MS)
    if not routes:
        pytest.fail("the workspace never asked POST /preview after the brush moved")
    advance(page, SETTLE_MS)

    def release_and_read() -> None:
        for held_route in list(routes):
            routes.remove(held_route)
            held_route.continue_()
        acc_has(page, "Coverage", f"{cov}%")

    eventually(page, release_and_read, f"preview answer {cov}% arrives", step_ms=0)


def test_coverage_tide_counts_to_server_values(browser, app_url):
    base = root(app_url)
    path = ws_path(BM, "2026-06-01", "2026-06-07", at(6, 2), at(6, 3), BM_IDS)
    with signed_in(browser, base, TOMAS, path) as page:
        wait_figure(page, "41.7", "-0.437")
        advance(page, 1000)
        assert definition(page, "Coverage")["visible"] == f"{SEED_DAYS[0][2]}%"
        assert definition(page, "Coverage")["hiddenCount"] == 1 and definition(page, "Net tCO2e")["hiddenCount"] == 1
        board = page.get_by_role("group", name="Coverage map")
        before = decode(capture(board))
        routes: list = []
        page.route(f"**/api/projects/{BM}/preview", lambda r: routes.append(r))
        pos = slider(page, "Interval position")
        for key, cov, net, prev_cov, prev_net in (("PageUp", "100.0", "-1.636", "41.7", "-0.437"),
                                                  ("PageDown", "41.7", "-0.437", "100.0", "-1.636")):
            pos.focus()
            pos.press(key)
            _release_previews(page, routes, cov)
            acc_has(page, "Net tCO2e", signed(net))
            assert meter_now(page, "Coverage") == float(cov)
            advance(page, TIDE_EARLY_MS)
            mid = definition(page, "Coverage")["visible"], definition(page, "Net tCO2e")["visible"]
            assert mid[0] not in (f"{cov}%", f"{prev_cov}%"), f"coverage numeral not counting at {TIDE_EARLY_MS} ms: {mid}"
            assert mid[1] not in (signed(net), signed(prev_net)), f"net numeral not counting at {TIDE_EARLY_MS} ms: {mid}"
            advance(page, TIDE_MAX_MS - TIDE_EARLY_MS)
            assert definition(page, "Coverage")["visible"] == f"{cov}%"
            assert definition(page, "Net tCO2e")["visible"] == signed(net)
            after = decode(capture(board))
            changed(before, after)
            before = after


def test_reduced_motion_jumps_to_final(browser, app_url):
    base = root(app_url)
    path = ws_path(BM, "2026-06-01", "2026-06-07", at(6, 2), at(6, 3), BM_IDS)
    with signed_in(browser, base, TOMAS, path, reduced_motion="reduce") as page:
        wait_figure(page, "41.7", "-0.437")
        advance(page, 1000)
        watch(page, "Workspace status")
        routes: list = []
        page.route(f"**/api/projects/{BM}/preview", lambda r: routes.append(r))
        pos = slider(page, "Interval position")
        pos.focus()
        pos.press("PageUp")
        _release_previews(page, routes, "100.0")
        advance(page, FRAME_MS)
        eventually(page, lambda: (_assert_eq(definition(page, "Coverage")["visible"], f"{SEED_DAYS[2][2]}%"),
                                  _assert_eq(definition(page, "Net tCO2e")["visible"], "-1.636")),
                   "visible numerals jump instead of counting", seconds=5, step_ms=0)
        copy = copy_settled("100.0", "-1.636", "sealable")
        wait_status(page, "Workspace status", copy)
        assert times_announced(page, "Workspace status", copy) == 1
        expect(figure_region(page).get_by_role("button", name="Seal figure", exact=True)).to_be_enabled()


def test_newest_brush_position_wins(browser, app_url):
    base = root(app_url)
    stale: list[Any] = []
    stale_end = iso(at(6, 5, 12, 30))

    def hold(route: Any) -> None:
        if (route.request.post_data_json or {}).get("end") == stale_end:
            stale.append(route)
            return
        route.continue_()

    newer = derive(SR, sr_seed(at(6, 5, 10), at(6, 5, 13)), at(6, 5, 10), at(6, 5, 13), SR_IDS)
    older = derive(SR, sr_seed(at(6, 5, 10), at(6, 5, 12, 30)), at(6, 5, 10), at(6, 5, 12, 30), SR_IDS)
    assert newer["net_tco2e"] != older["net_tco2e"]
    with signed_in(browser, base, TOMAS, ws_path(SR, "2026-06-05", "2026-06-05", at(6, 5, 10), at(6, 5, 12), SR_IDS)) as page:
        wait_figure(page, "100.0", "-0.065")
        page.route(f"**/api/projects/{SR}/preview", hold)
        end = slider(page, "Interval end")
        end.focus()
        end.press("ArrowRight")
        for _ in range(PREVIEW_STEPS):
            if stale:
                break
            advance(page, STEP_MS)
        assert stale, "the older position's preview was requested"
        end.press("ArrowRight")
        wait_figure(page, newer["coverage_pct"], newer["net_tco2e"])
        for route in stale:
            route.continue_()
        advance(page, 1000)
        acc_has(page, "Net tCO2e", signed(newer["net_tco2e"]))
        advance(page, 1000)
        assert definition(page, "Net tCO2e")["visible"] == signed(newer["net_tco2e"]), "the late answer was discarded"


def _settle_cases(base: str) -> list[tuple]:
    slot = std_slot(base)
    fig = sealed(slot, 0, 10)
    overlap = slot.expect(1, 10)
    cases = [
        (HAL, ws_path(SR, "2026-06-05", "2026-06-05", at(6, 5, 10), at(6, 5, 11, 30), SR_IDS), "Interval end", "ArrowRight",
         "100.0", "-0.065", "sealable", None, None),
        (HAL, ws_path(BM, "2026-06-01", "2026-06-02", at(6, 1), at(6, 2, 23, 30), BM_IDS), "Interval end", "ArrowRight",
         "41.7", "-0.873", "floor", "60.0", copy_below_floor("41.7", "60.0")),
        (ODILE, ws_path(BM, "2026-06-04", "2026-06-04", at(6, 4), at(6, 4, 5, 30), BM_IDS), "Interval end", "ArrowRight",
         "100.0", "0.061", "other", None, COPY_ROLE_ANALYST),
        (HAL, ws_path(BM, slot.date, slot.date, slot.at(1), slot.at(11), BM_IDS), "Interval end", "ArrowLeft",
         overlap["coverage_pct"], overlap["net_tco2e"], "other", None, copy_overlaps(fig["id"])),
        (HAL, ws_path(BM, slot.date, slot.date, slot.at(1), slot.at(10), BM_IDS), "Interval start", "ArrowLeft",
         fig["coverage_pct"], fig["net_tco2e"], "other", None, copy_already(fig["id"])),
    ]
    return cases


def _settle(browser: Browser, base: str, case: tuple, after: Callable[[Page], None]) -> None:
    email, path, handle, key, cov, net, _state, _floor, _reason = case
    with signed_in(browser, base, email, path) as page:
        eventually(page, lambda: expect(figure_region(page)).to_contain_text("%", timeout=POLL_MS), "figure loads")
        advance(page, 1000)
        watch(page, "Workspace status")
        slider(page, handle).focus()
        slider(page, handle).press(key)
        wait_figure(page, cov, net)
        after(page)


def test_seal_armed_state(browser, app_url):
    base = root(app_url)
    for case in _settle_cases(base):
        state, reason = case[6], case[8]

        def check(page: Page, state: str = state, reason: str | None = reason) -> None:
            button = figure_region(page).get_by_role("button", name="Seal figure", exact=True)
            if state == "sealable":
                eventually(page, lambda: expect(button).to_be_enabled(timeout=POLL_MS), "Seal figure armed")
            else:
                eventually(page, lambda: expect(button).to_be_disabled(timeout=POLL_MS), "Seal figure disabled")
                expect(figure_region(page)).to_contain_text(reason)

        _settle(browser, base, case, check)


def test_brush_settle_announcement(browser, app_url):
    base = root(app_url)
    for case in _settle_cases(base):
        cov, net, state, floor = case[4], case[5], case[6], case[7]
        copy = copy_settled(cov, net, state, floor)

        def check(page: Page, copy: str = copy) -> None:
            wait_status(page, "Workspace status", copy)
            advance(page, 2000)
            assert times_announced(page, "Workspace status", copy) == 1, f"{copy} announced once"

        _settle(browser, base, case, check)


def test_unit_breakdown_dialog(browser, app_url):
    base = root(app_url)
    with signed_in(browser, base, TOMAS, ws_path(BM, "2026-06-01", "2026-06-14", at(6, 1), at(6, 15), BM_IDS)) as page:
        wait_figure(page, "85.0", "-16.808")
        opener = figure_region(page).get_by_role("button", name="Unit breakdown")
        opener.click()
        dialog = page.get_by_role("dialog", name="Unit breakdown")
        close = dialog.get_by_role("button", name="Close")
        eventually(page, lambda: expect(close).to_be_focused(timeout=POLL_MS), "focus starts on Close")
        for factor in ("0.00004401", "0.00000001604", "27.0"):
            expect(dialog).to_contain_text(factor)
        table = dialog.get_by_role("table", name="Unit breakdown")
        for sid, (area, qual, co2, ch4, net) in WHOLE_BM_CONTRIBUTIONS.items():
            row = table.get_by_role("row").filter(has_text=sid)
            expect(row).to_have_count(1)
            row_text = re.sub(r"[,\s\u2009\u202f]", "", row.inner_text())
            for value in (str(area), str(qual), co2, ch4, net):
                assert value in row_text, f"{sid} row lacks {value}: {row.inner_text()}"
        expect(table.get_by_role("row").filter(has_text="BM-S4")).to_have_count(0)
        total = table.get_by_role("row").filter(has_text="Total")
        for value in ("-20.647", "3.839", "-16.808"):
            expect(total).to_contain_text(value)
        for key in ("Tab", "Shift+Tab", "Tab", "Tab"):
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the dialog"
        page.keyboard.press("Escape")
        wait_dialog_closed(page, "Unit breakdown")
        expect(opener).to_be_focused()
        opener.click()
        eventually(page, lambda: expect(close).to_be_focused(timeout=POLL_MS), "dialog reopens")
        close.click()
        wait_dialog_closed(page, "Unit breakdown")
        expect(opener).to_be_focused()


SR_ALL = "SR-S1,SR-S2,SR-T1"
SR_FALLBACKS = [
    ("", "from=2026-06-01&to=2026-06-14&start=202606010000&end=202606150000&sensors=" + SR_ALL),
    ("from=2026-06-07&to=2026-06-05&start=202606051000&end=202606051200&sensors=SR-T1",
     "from=2026-06-01&to=2026-06-14&start=202606051000&end=202606051200&sensors=SR-T1"),
    ("from=2026-05-20&to=2026-06-05&start=202606051000&end=202606051200&sensors=SR-T1",
     "from=2026-06-01&to=2026-06-14&start=202606051000&end=202606051200&sensors=SR-T1"),
    ("from=2026-06-05&to=2026-06-06&start=202606051015&end=202606051200&sensors=SR-T1",
     "from=2026-06-05&to=2026-06-06&start=202606050000&end=202606070000&sensors=SR-T1"),
    ("from=2026-06-05&to=2026-06-06&start=202606100000&end=202606101200&sensors=SR-T1",
     "from=2026-06-05&to=2026-06-06&start=202606050000&end=202606070000&sensors=SR-T1"),
    ("from=2026-06-05&to=2026-06-06&start=202606061200&end=202606051200&sensors=SR-T1",
     "from=2026-06-05&to=2026-06-06&start=202606050000&end=202606070000&sensors=SR-T1"),
    ("from=2026-06-05&to=2026-06-06&start=202606051000&end=202606051200&sensors=SR-T1,SR-T1",
     "from=2026-06-05&to=2026-06-06&start=202606051000&end=202606051200&sensors=" + SR_ALL),
    ("from=2026-06-05&to=2026-06-06&start=202606051000&end=202606051200&sensors=SR-T1,XX-T9",
     "from=2026-06-05&to=2026-06-06&start=202606051000&end=202606051200&sensors=" + SR_ALL),
    ("sensors=SR-T1,SR-S1&end=202606051200&start=202606051000&to=2026-06-06&from=2026-06-05",
     "from=2026-06-05&to=2026-06-06&start=202606051000&end=202606051200&sensors=SR-S1,SR-T1"),
]


def test_workspace_url_state(browser, app_url):
    base = root(app_url)
    first: list[dict] = []

    def hook(page: Page) -> None:
        page.on("request", lambda r: first.append(r.post_data_json) if r.method == "POST" and r.url.endswith("/preview") else None)

    subset = ["BM-S1", "BM-T1"]
    path = ws_path(BM, "2026-06-03", "2026-06-07", at(6, 4), at(6, 4, 6), subset)
    with signed_in(browser, base, TOMAS, path, hook=hook) as page:
        exp = preview(base, TOMAS, BM, at(6, 4), at(6, 4, 6), subset).json()
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        assert first and first[0]["start"] == iso(at(6, 4)) and first[0]["end"] == iso(at(6, 4, 6))
        assert sorted(first[0]["sensor_ids"]) == subset
        expect(page.get_by_label("From", exact=True)).to_have_value("2026-06-03")
        expect(page.get_by_label("To", exact=True)).to_have_value("2026-06-07")
        expect_brush(page, at(6, 4), at(6, 4, 6))
        for s in BM_IDS:
            box = page.get_by_role("group", name="Sensors").get_by_role("checkbox", name=s)
            if s in subset:
                expect(box).to_be_checked()
            else:
                expect(box).not_to_be_checked()
        assert page.url.endswith(path)
        length = page.evaluate("history.length")
        end = slider(page, "Interval end")
        end.focus()
        end.press("ArrowRight")
        moved = ws_path(BM, "2026-06-03", "2026-06-07", at(6, 4), at(6, 4, 6, 30), subset)
        eventually(page, lambda: _assert_eq(page.url.endswith(moved), True), "settle replaces the address")
        assert page.evaluate("history.length") == length
        page.get_by_label("From", exact=True).fill("2026-06-05")
        page.get_by_role("button", name="Apply dates").click()
        applied = ws_path(BM, "2026-06-05", "2026-06-07", at(6, 5), at(6, 8), subset)
        eventually(page, lambda: _assert_eq(page.url.endswith(applied), True), "Apply dates writes the address")
        assert page.evaluate("history.length") == length + 1
        page.go_back()
        eventually(page, lambda: expect(page.get_by_label("From", exact=True)).to_have_value("2026-06-03", timeout=POLL_MS), "Back restores")
        expect_brush(page, at(6, 4), at(6, 4, 6, 30))
        page.go_forward()
        expect_brush(page, at(6, 5), at(6, 8))
        for query, canonical in SR_FALLBACKS:
            page.goto(f"{base}/projects/{SR}" + (f"?{query}" if query else ""))
            eventually(page, lambda: _assert_eq(urlparse(page.url).query, canonical), f"{query!r} falls back to {canonical}")
            assert urlparse(page.url).path == f"/projects/{SR}"
    with signed_in(browser, base, HAL, f"/projects/{HW}") as page:
        eventually(page, lambda: expect(page.get_by_text(COPY_NO_READINGS)).to_be_visible(timeout=POLL_MS), "no readings copy")
        assert urlparse(page.url).query == "" and urlparse(page.url).path == f"/projects/{HW}"


def test_wf_workspace_preview_shared_url(browser, app_url):
    base = root(app_url)
    with signed_in(browser, base, TOMAS, ws_path(BM, "2026-06-01", "2026-06-14", at(6, 1), at(6, 15), BM_IDS)) as page:
        wait_figure(page, "85.0", "-16.808")
        page.get_by_label("From", exact=True).fill("2026-06-03")
        page.get_by_label("To", exact=True).fill("2026-06-07")
        page.get_by_role("button", name="Apply dates").click()
        expect_brush(page, at(6, 3), at(6, 8))
        end = slider(page, "Interval end")
        end.focus()
        end.press("PageDown")
        end.press("PageDown")
        mouse_drag(page, slider(page, "Interval start"), 25)
        slider(page, "Interval start").focus()
        slider(page, "Interval start").press("ArrowRight")
        advance(page, SETTLE_MS * 2)
        start, finish = brush(page)
        server = preview(base, TOMAS, BM, start, finish, BM_IDS).json()
        wait_figure(page, server["coverage_pct"], server["net_tco2e"])
        shared = ws_path(BM, "2026-06-03", "2026-06-07", start, finish, BM_IDS)
        eventually(page, lambda: _assert_eq(page.url.endswith(shared), True), "the address carries the settled brush")
        copied = urlparse(page.url)
    with signed_in(browser, base, HAL, f"{copied.path}?{copied.query}") as colleague:
        wait_figure(colleague, server["coverage_pct"], server["net_tco2e"])
        expect_brush(colleague, start, finish)
        expect(colleague.get_by_label("From", exact=True)).to_have_value("2026-06-03")
        region = figure_region(colleague)
        expect(region).to_contain_text(server["buffer_tco2e"])
        expect(region).to_contain_text(server["credited_tco2e"])
        button = region.get_by_role("button", name="Seal figure", exact=True)
        if server["sealable"]:
            expect(button).to_be_enabled()
        else:
            expect(button).to_be_disabled()


def test_wf_workspace_preview_viewports(browser, app_url):
    base = root(app_url)
    start, end = at(6, 5, 6), at(6, 6, 6)
    path = ws_path(SR, "2026-06-05", "2026-06-06", start, end, SR_IDS)
    server = preview(base, HAL, SR, start, end, SR_IDS).json()
    hidden_labels = ["Interval", "CO2 tCO2e", "CH4 tCO2e", "Buffer tCO2e", "Credited tCO2e", "Readings", "Unit breakdown"]
    for size in (DESKTOP, TABLET, PHONE):
        with signed_in(browser, base, HAL, path, size=size) as page:
            wait_figure(page, server["coverage_pct"], server["net_tco2e"])
            expect_brush(page, start, end)
            region = figure_region(page)
            button = region.get_by_role("button", name="Seal figure", exact=True)
            if server["sealable"]:
                eventually(page, lambda: expect(button).to_be_enabled(timeout=POLL_MS), "Seal figure armed")
            else:
                eventually(page, lambda: expect(button).to_be_disabled(timeout=POLL_MS), "Seal figure disabled")
            boxes = {n: page.get_by_role("group", name=n).bounding_box() for n in ("Coverage map", "Flux timeline", "Sensors")}
            fbox = region.bounding_box()
            if size == DESKTOP:
                assert boxes["Flux timeline"]["x"] + boxes["Flux timeline"]["width"] <= boxes["Coverage map"]["x"] + 1
                assert fbox["x"] >= boxes["Flux timeline"]["x"] + boxes["Flux timeline"]["width"] - 1
            elif size == TABLET:
                assert boxes["Coverage map"]["y"] < boxes["Flux timeline"]["y"] < boxes["Sensors"]["y"] < fbox["y"]
            else:
                assert boxes["Coverage map"]["y"] < boxes["Flux timeline"]["y"] < boxes["Sensors"]["y"]
                sheet_bounds(page, size)
                hidden = region.evaluate(HIDDEN_JS, hidden_labels)
                assert all(hidden), f"collapsed sheet exposes hidden content: {hidden}"
                page.evaluate("document.activeElement && document.activeElement.blur()")
                assert "Unit breakdown" not in tab_names(page, 40), "a collapsed sheet control took focus"
                details = page.get_by_role("button", name="Figure details")
                expect(details).to_have_attribute("aria-expanded", "false")
                details.click()
                eventually(page, lambda: expect(details).to_have_attribute("aria-expanded", "true", timeout=POLL_MS), "expand")
                shown = region.evaluate(HIDDEN_JS, ["Buffer tCO2e", "Credited tCO2e", "Unit breakdown"])
                assert not any(shown), "the expanded sheet shows the whole panel"
            expect(region).to_contain_text(server["buffer_tco2e"])
            expect(region).to_contain_text(server["credited_tco2e"])
            layout(page)


def test_wf_workspace_preview_below_floor(browser, app_url):
    base = root(app_url)
    with signed_in(browser, base, HAL, ws_path(BM, "2026-06-01", "2026-06-14", at(6, 1), at(6, 15), BM_IDS)) as page:
        page.get_by_label("From", exact=True).fill("2026-06-01")
        page.get_by_label("To", exact=True).fill("2026-06-02")
        page.get_by_role("button", name="Apply dates").click()
        wait_figure(page, "41.7", "-0.873")
        expect(figure_region(page).get_by_role("button", name="Seal figure", exact=True)).to_be_disabled()
        expect(figure_region(page)).to_contain_text(copy_below_floor("41.7", "60.0"))
    pv = preview(base, HAL, BM, at(6, 1), at(6, 3), BM_IDS).json()
    assert pv["blocked_reason"] == "below_coverage_floor" and pv["sealable"] is False


def _seal_fresh(base: str, builder: Callable[[datetime], list[dict]] | None = None) -> tuple[Slot, dict, dict]:
    slot = new_slot(base, builder or (lambda d: block(d)))
    exp = slot.expect(0, 12)
    resp = seal(slot, 0, 12)
    assert resp.status_code == 201, resp.text
    return slot, exp, resp.json()


def test_seal_stores_derived_figure(app_url):
    base = root(app_url)
    slot, exp, fig = _seal_fresh(base)
    assert FIGURE_ID_RE.match(fig["id"]) and fig["id"].startswith("BM-F")
    assert_derived(fig, exp, "sealed figure")
    assert (fig["status"], fig["supersedes"], fig["superseded_by"], fig["project"]) == ("sealed", None, None, BM)
    assert (fig["start"], fig["end"]) == (iso(slot.at(0)), iso(slot.at(12))) and sorted(fig["sensor_ids"]) == BM_IDS
    assert (fig["floor_pct"], fig["buffer_pct"], fig["sealed_by"]) == ("60.0", "15.0", "p-tomas")
    assert TS_RE.match(fig["sealed_at"]) and TS_RE.match(fig["checked_at"])
    read = figure_get(base, TOMAS, fig["id"])
    assert read["status"] == "sealed" and read["rederived"]["matches"] is True
    for k in ("start", "end", "coverage_pct", "net_tco2e", "co2_tco2e", "ch4_tco2e", "buffer_tco2e", "credited_tco2e",
              "readings_count", "fingerprint", "contributions"):
        assert read[k] == fig[k], f"stored {k} differs from the seal response"
    assert [f["id"] for f in figures_at(base, TOMAS, BM, slot.at(0), slot.at(12))] == [fig["id"]]


def test_canonical_readings_fingerprint(app_url):
    base = root(app_url)

    def fc(s: str, j: int) -> str:
        return "0.0" if j == 3 else ("-0.25" if s == "BM-S2" else TEMPLATE[s][0])

    def qc(s: str, j: int) -> int:
        return 2 if (s, j) == ("BM-S1", 5) else 0

    slot = new_slot(base, lambda d: block(d, fc=fc, qc=qc))
    exp = slot.expect(0, 12)
    pv = preview(base, TOMAS, BM, slot.at(0), slot.at(12), BM_IDS).json()
    assert (pv["fingerprint"], pv["readings_count"]) == (exp["fingerprint"], exp["readings_count"])
    subset = ["BM-T2", "BM-S1"]
    sub = slot.expect(2, 9, subset)
    got = preview(base, TOMAS, BM, slot.at(2), slot.at(9), subset).json()
    assert (got["fingerprint"], got["readings_count"]) == (sub["fingerprint"], sub["readings_count"])
    fig = sealed(slot, 0, 12)
    assert fig["fingerprint"] == exp["fingerprint"] and re.fullmatch(r"[0-9a-f]{64}", fig["fingerprint"])


def test_confirmed_evidence_bundle(app_url):
    base = root(app_url)
    slot, exp, fig = _seal_fresh(base)
    assert fig["evidence"] == {"readings_key": f"figures/{fig['id']}/readings.csv",
                               "derivation_key": f"figures/{fig['id']}/derivation.json"}
    store = S3()
    assert set(store.keys(f"figures/{fig['id']}/")) == set(fig["evidence"].values())
    stored = store.get(fig["evidence"]["readings_key"])
    assert stored == exp["file"] and hashlib.sha256(stored).hexdigest() == fig["fingerprint"]
    assert json.loads(store.get(fig["evidence"]["derivation_key"])) == fig
    slot.revise([("BM-T1", 0, {"fc": "-2.0"})])
    assert figure_get(base, TOMAS, fig["id"])["status"] == "broken"
    assert store.get(fig["evidence"]["readings_key"]) == stored, "readings object never rewritten"
    assert json.loads(store.get(fig["evidence"]["derivation_key"])) == fig, "derivation object never rewritten"


def test_seal_notice_email(app_url, mail):
    base = root(app_url)
    _, _, fig = _seal_fresh(base)
    notices = wait_mails(mail, _notice_pred(fig), 1, f"seal notice for {fig['id']}")
    assert len(notices) == 1
    note = notices[0]
    assert subject_of(note) == f"Sealed {fig['id']}: {fig['net_tco2e']} tCO2e at {fig['coverage_pct']}% coverage"
    assert addresses(note["To"]) == [HAL]
    assert addresses(note["From"]) == [mail_from_address()]
    lines = body_lines(note)
    for line in (f"Figure: {fig['id']}", "Project: Blackmere Moss", f"Interval: {fig['start']} to {fig['end']}",
                 f"Net: {fig['net_tco2e']} tCO2e", f"Buffer: {fig['buffer_tco2e']} tCO2e",
                 f"Credited: {fig['credited_tco2e']} tCO2e", f"Coverage: {fig['coverage_pct']}%",
                 f"Fingerprint: {fig['fingerprint'][:12]}"):
        assert line in lines, f"notice lacks {line!r}: {lines}"
    _, _, efig = _seal_fresh(base, lambda d: block(d, fc=lambda s, j: "2.0"))
    enotes = wait_mails(mail, _notice_pred(efig), 1, "emission notice")
    assert len(enotes) == 1
    elines = body_lines(enotes[0])
    for line in ("Buffer: 0.000 tCO2e", f"Credited: {efig['net_tco2e']} tCO2e", f"Net: {efig['net_tco2e']} tCO2e"):
        assert line in elines, f"emission notice lacks {line!r}: {elines}"


def test_issuance_and_buffer_entries(app_url):
    base = root(app_url)
    before = ledger(base, TOMAS, BM)
    _, _, fig = _seal_fresh(base)
    after = ledger(base, TOMAS, BM)
    mine = entries_for(after, fig["id"])
    assert sorted((e["kind"], e["tco2e"], e["reverses"]) for e in mine) == \
        sorted([("issuance", fig["net_tco2e"], None), ("buffer", fig["buffer_tco2e"], None)])
    assert all(TS_RE.match(e["recorded_at"]) for e in mine)
    assert Decimal(after["balance_tco2e"]) - Decimal(before["balance_tco2e"]) == Decimal(fig["credited_tco2e"])
    assert Decimal(after["buffer_tco2e"]) - Decimal(before["buffer_tco2e"]) == Decimal(fig["buffer_tco2e"])
    _, _, efig = _seal_fresh(base, lambda d: block(d, fc=lambda s, j: "2.0"))
    assert Decimal(efig["net_tco2e"]) > 0
    assert [(e["kind"], e["tco2e"]) for e in entries_for(ledger(base, TOMAS, BM), efig["id"])] == [("issuance", efig["net_tco2e"])]


def test_seal_refusals_in_published_order(app_url, mail):
    base = root(app_url)
    slot = std_slot(base)
    low = std_slot(base, sensors=["BM-T1", "BM-T2"])
    keys_before = s3_keys()
    r = seal(slot, 0, 8, fingerprint="0" * 64)
    assert r.status_code == 409 and r.json() == {"error": "readings_changed", "fingerprint": slot.expect(0, 8)["fingerprint"]}
    r = seal(low, 0, 12, sensors=BM_IDS, fingerprint="0" * 64)
    assert r.status_code == 409 and r.json()["error"] == "readings_changed", "readings_changed precedes the floor"
    r = seal(low, 0, 12, sensors=BM_IDS)
    assert r.status_code == 409 and r.json() == {"error": "below_coverage_floor", "coverage_pct": "41.7", "floor_pct": "60.0"}
    r = seal(low, 0, 12, sensors=BM_IDS, base=outage("APP_MINIO_DOWN_URL"))
    assert r.status_code == 409 and r.json()["error"] == "below_coverage_floor", "a 409 never yields a 503"
    r = seal(slot, 0, 8, ODILE)
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert s3_keys() == keys_before
    fig = sealed(slot, 0, 8)
    r = seal(slot, 4, 12)
    assert r.status_code == 409 and r.json() == {"error": "interval_overlaps_sealed", "figure_id": fig["id"]}
    r = seal(slot, 0, 8)
    assert r.status_code == 409 and r.json() == {"error": "already_sealed", "figure_id": fig["id"]}
    touching = sealed(slot, 8, 12)
    assert touching["status"] == "sealed", "intervals that only touch do not overlap"
    assert [f["id"] for f in figures_at(base, TOMAS, BM, slot.at(0), slot.at(8))] == [fig["id"]]
    assert figures_at(base, TOMAS, BM, low.at(0), low.at(12)) == []
    assert not mails_now(mail, lambda m: f"Fingerprint: {low.expect(0, 12)['fingerprint'][:12]}" in text(m))
    assert s3_keys() - keys_before == {f"figures/{fig['id']}/readings.csv", f"figures/{fig['id']}/derivation.json",
                                       f"figures/{touching['id']}/readings.csv", f"figures/{touching['id']}/derivation.json"}


def _seal_page(browser: Browser, base: str, slot: Slot, email: str = TOMAS, size: tuple[int, int] = DESKTOP):
    return signed_in(browser, base, email, ws_path(BM, slot.date, slot.date, slot.at(0), slot.at(12), BM_IDS), size=size)


def test_seal_dialog_contents_focus_and_pending(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    exp = slot.expect(0, 12)
    with _seal_page(browser, base, slot) as page:
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        dialog = open_seal_dialog(page)
        confirm = dialog.get_by_role("button", name="Confirm seal")
        eventually(page, lambda: expect(confirm).to_be_focused(timeout=POLL_MS), "focus starts on Confirm seal")
        for value in (exp["fingerprint"][:12], exp["net_tco2e"], exp["buffer_tco2e"], exp["credited_tco2e"], exp["coverage_pct"]):
            expect(dialog).to_contain_text(value)
        expect(dialog).not_to_contain_text(exp["fingerprint"][:13])
        for key in ("Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the dialog"
        page.keyboard.press("Escape")
        wait_dialog_closed(page, "Seal figure")
        seal_button = figure_region(page).get_by_role("button", name="Seal figure", exact=True)
        expect(seal_button).to_be_focused()
        dialog = open_seal_dialog(page)
        dialog.get_by_role("button", name="Cancel").click()
        wait_dialog_closed(page, "Seal figure")
        expect(seal_button).to_be_focused()
        dialog = open_seal_dialog(page)
        before = snapshot(page)
        with held(page, f"**/api/projects/{BM}/figures") as gate:
            dialog.get_by_role("button", name="Confirm seal").click()
            pending = dialog.get_by_role("button", name=COPY_SEALING_LABEL)
            expect(pending).to_be_visible()
            expect(pending).to_be_disabled()
            eventually(page, lambda: expect(status(page, "Workspace status")).to_have_text(
                COPY_SEALING_STATUS, timeout=POLL_MS), "pending seal status")
            assert snapshot(page) == before, "nothing changes while pending"
            gate.release()
        wait_dialog_closed(page, "Seal figure")
        figs = figures_at(base, TOMAS, BM, slot.at(0), slot.at(12))
        assert len(figs) == 1
        fid = figs[0]["id"]
        wait_status(page, "Workspace status", copy_sealed(fid, figs[0]["net_tco2e"], figs[0]["coverage_pct"]))
        eventually(page, lambda: expect(page.get_by_role("table", name="Figures").get_by_role("link", name=fid, exact=True))
                   .to_be_focused(timeout=POLL_MS), "focus moves to the new figure's link")


def test_seal_refusal_in_the_browser(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    exp = slot.expect(0, 12)
    with _seal_page(browser, base, slot) as page:
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        dialog = open_seal_dialog(page)
        confirm = dialog.get_by_role("button", name="Confirm seal")
        cancel = dialog.get_by_role("button", name="Cancel")
        watch(page, "Workspace status")
        other = sealed(slot, 0, 12, HAL)
        copy = copy_already(other["id"])
        confirm.click()
        eventually(page, lambda: expect(dialog.get_by_role("alert")).to_have_text(copy, timeout=POLL_MS),
                   "L309 the refusal copy sits in the dialog's alert")
        wait_status(page, "Workspace status", copy)
        assert times_announced(page, "Workspace status", copy) == 1, "L309 announces the same copy once"
        expect(dialog).to_be_visible()
        expect(cancel if confirm.is_disabled() else confirm).to_be_focused()
        assert len(figures_at(base, TOMAS, BM, slot.at(0), slot.at(12))) == 1, "the refusal sealed nothing"


def test_wf_seal_happy(browser, app_url, mail):
    base = root(app_url)
    slot = std_slot(base)
    exp = slot.expect(0, 12)
    before = ledger(base, TOMAS, BM)
    with _seal_page(browser, base, slot) as page:
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        dialog = open_seal_dialog(page)
        dialog.get_by_role("button", name="Confirm seal").click()
        wait_dialog_closed(page, "Seal figure")
        figs = figures_at(base, TOMAS, BM, slot.at(0), slot.at(12))
        assert len(figs) == 1
        fid = figs[0]["id"]
        wait_entry(page, fid, "Sealed")
        after = ledger(base, TOMAS, BM)
        assert Decimal(after["balance_tco2e"]) - Decimal(before["balance_tco2e"]) == Decimal(exp["credited_tco2e"])
        eventually(page, lambda: expect(page.get_by_role("region", name="Project balance"))
                   .to_contain_text(after["balance_tco2e"], timeout=POLL_MS), "balance strip shows the new balance")
        rows = page.get_by_role("table", name="Sealed-tonnes ledger").get_by_role("row").filter(has_text=fid)
        expect(rows.filter(has_text="Issuance")).to_have_count(1)
        expect(rows.filter(has_text="Buffer")).to_have_count(1)
    assert len(wait_mails(mail, _notice_pred(figs[0]), 1, "notice")) == 1
    assert set(S3().keys(f"figures/{fid}/")) == {f"figures/{fid}/readings.csv", f"figures/{fid}/derivation.json"}


def test_wf_seal_below_floor_blocked(browser, app_url, mail):
    base = root(app_url)
    low = std_slot(base, sensors=["BM-T1", "BM-T2"])
    exp = low.expect(0, 12)
    with _seal_page(browser, base, low) as page:
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        expect(figure_region(page).get_by_role("button", name="Seal figure", exact=True)).to_be_disabled()
        expect(figure_region(page)).to_contain_text(copy_below_floor(exp["coverage_pct"], "60.0"))
    r = seal(low, 0, 12)
    assert r.status_code == 409 and r.json()["error"] == "below_coverage_floor"
    assert figures_at(base, TOMAS, BM, low.at(0), low.at(12)) == []
    assert not mails_now(mail, lambda m: f"Fingerprint: {exp['fingerprint'][:12]}" in text(m))


def test_storage_outage_refuses_seal(app_url, mail):
    base = root(app_url)
    down = outage("APP_MINIO_DOWN_URL")
    slot = new_slot(down, lambda d: block(d))
    exp = slot.expect(0, 12)
    pv = preview(down, TOMAS, BM, slot.at(0), slot.at(12), BM_IDS)
    assert pv.status_code == 200 and pv.json()["fingerprint"] == exp["fingerprint"]
    assert api(down, TOMAS).get(f"/api/projects/{BM}/timeline", params={"from": slot.date, "to": slot.date}).status_code == 200
    before, keys_before = ledger(base, TOMAS, BM), s3_keys()
    key = idempotency_key()
    started = time.monotonic()
    r = seal(slot, 0, 12, key=key, base=down)
    assert time.monotonic() - started < STORAGE_REFUSAL_S
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}, r.text
    assert figures_at(base, TOMAS, BM, slot.at(0), slot.at(12)) == []
    assert ledger(base, TOMAS, BM)["entries"] == before["entries"]
    assert s3_keys() == keys_before
    assert not mails_now(mail, lambda m: f"Fingerprint: {exp['fingerprint'][:12]}" in text(m))
    other = std_slot(base)
    fig = sealed(other, 0, 12)
    assert figure_get(down, TOMAS, fig["id"])["status"] == "sealed", "figure reads keep working"
    retry = seal(slot, 0, 12, key=key, base=base)
    assert retry.status_code == 201 and "Idempotent-Replay" not in retry.headers, "a refused key is evaluated afresh"


def test_mail_outage_rolls_back_objects(app_url, mail):
    base = root(app_url)
    down = outage("APP_MAIL_DOWN_URL")
    slot = std_slot(base)
    exp = slot.expect(0, 12)
    before, keys_before = ledger(base, TOMAS, BM), s3_keys()
    key = idempotency_key()
    r = seal(slot, 0, 12, key=key, base=down)
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable"}, r.text
    assert s3_keys() == keys_before, "objects written before the mail refusal were deleted"
    assert figures_at(base, TOMAS, BM, slot.at(0), slot.at(12)) == []
    assert ledger(base, TOMAS, BM)["entries"] == before["entries"]
    assert not mails_now(mail, lambda m: f"Fingerprint: {exp['fingerprint'][:12]}" in text(m))
    fig = sealed(slot, 0, 12, key=key)
    assert fig["status"] == "sealed"
    assert set(S3().keys(f"figures/{fig['id']}/")) == set(fig["evidence"].values()), "the later seal stores both objects"


def _outage_journey(browser: Browser, base: str, down: str, copy: str, mail: Any) -> None:
    slot = std_slot(base)
    exp = slot.expect(0, 12)
    before, keys_before = ledger(base, TOMAS, BM), s3_keys()
    with signed_in(browser, down, TOMAS, ws_path(BM, slot.date, slot.date, slot.at(0), slot.at(12), BM_IDS)) as page:
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        dialog = open_seal_dialog(page)
        shown = snapshot(page)
        watch(page, "Workspace status")
        with held(page, f"**/api/projects/{BM}/figures") as gate:
            dialog.get_by_role("button", name="Confirm seal").click()
            expect(dialog.get_by_role("button", name=COPY_SEALING_LABEL)).to_be_disabled()
            assert snapshot(page) == shown, "pending changes nothing"
            gate.release()
        eventually(page, lambda: expect(dialog.get_by_role("alert")).to_have_text(copy, timeout=POLL_MS), "outage copy in the dialog")
        wait_status(page, "Workspace status", copy)
        assert times_announced(page, "Workspace status", copy) == 1
        assert snapshot(page) == shown, "refusal changes nothing"
        expect(dialog.get_by_role("button", name="Confirm seal")).to_be_focused()
    assert figures_at(base, TOMAS, BM, slot.at(0), slot.at(12)) == []
    assert ledger(base, TOMAS, BM)["entries"] == before["entries"]
    assert s3_keys() == keys_before
    assert not mails_now(mail, lambda m: f"Fingerprint: {exp['fingerprint'][:12]}" in text(m))


def test_wf_seal_outage_storage(browser, app_url, mail):
    _outage_journey(browser, root(app_url), outage("APP_MINIO_DOWN_URL"), COPY_STORAGE, mail)


def test_wf_seal_outage_mail(browser, app_url, mail):
    _outage_journey(browser, root(app_url), outage("APP_MAIL_DOWN_URL"), COPY_MAIL, mail)


def test_idempotent_replay_and_conflict(app_url):
    base = root(app_url)
    slot = std_slot(base)
    key = idempotency_key()
    first_fp = slot.expect(0, 12)["fingerprint"]
    first = seal(slot, 0, 12, key=key, fingerprint=first_fp)
    assert first.status_code == 201
    for target in (base, outage("APP_MINIO_DOWN_URL"), outage("APP_MAIL_DOWN_URL")):
        again = seal(slot, 0, 12, key=key, base=target, sensors=list(reversed(BM_IDS)))
        assert again.status_code == 201 and again.content == first.content, f"replay on {target}"
        assert again.headers.get("Idempotent-Replay") == "true"
    assert len(figures_at(base, TOMAS, BM, slot.at(0), slot.at(12))) == 1, "a replay changes nothing"
    r = seal(slot, 0, 10, key=key)
    assert r.status_code == 409 and r.json() == {"error": "idempotency_key_conflict"}
    hal = seal(slot, 10, 12, HAL, key=key)
    assert hal.status_code == 409 and hal.json()["error"] == "interval_overlaps_sealed", "Hal's key is independent"
    other = std_slot(base)
    assert seal(other, 0, 12, HAL, key=key).status_code == 201
    slot.revise([("BM-T1", 2, {"fc": "-2.5"})])
    late = seal(slot, 0, 12, key=key, fingerprint=first_fp)
    assert late.status_code == 201 and late.content == first.content and late.json()["status"] == "sealed"
    for bad in (None, "k" * (IDEMPOTENCY_KEY_MAX + 1), "has space"):
        headers = {} if bad is None else {"Idempotency-Key": bad}
        r = api(base, TOMAS).post(f"/api/projects/{BM}/figures", headers=headers, json={
            "start": iso(slot.at(0)), "end": iso(slot.at(12)), "sensor_ids": BM_IDS, "preview_fingerprint": "0" * 64})
        assert r.status_code == 422 and "Idempotency-Key" in r.json()["errors"], f"{bad!r}: {r.text}"


@pytest.mark.timeout(900)


def test_simultaneous_seals_one_winner(app_url, app_copies, mail):
    base = root(app_url)
    slot = std_slot(base)
    plan = [(base, 0, 8), (app_copies[0], 0, 8), (app_copies[1], 2, 10), (base, 4, 12), (base, 2, 10), (app_copies[0], 4, 12)]
    clients = [login(target, TOMAS) for target, _, _ in plan]
    barrier = threading.Barrier(len(plan))

    def go(i: int) -> tuple[int, int, httpx.Response]:
        _, a, b = plan[i]
        body = {"start": iso(slot.at(a)), "end": iso(slot.at(b)), "sensor_ids": BM_IDS,
                "preview_fingerprint": slot.expect(a, b)["fingerprint"]}
        barrier.wait()
        return a, b, clients[i].post(f"/api/projects/{BM}/figures", json=body, headers={"Idempotency-Key": idempotency_key()})

    with ThreadPoolExecutor(len(plan)) as pool:
        results = list(pool.map(go, range(len(plan))))
    winners = [(a, b, r) for a, b, r in results if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for *_, r in results]
    wa, wb, wr = winners[0]
    wid = wr.json()["id"]
    for a, b, r in results:
        if r is wr:
            continue
        error = "already_sealed" if (a, b) == (wa, wb) else "interval_overlaps_sealed"
        assert r.status_code == 409 and r.json() == {"error": error, "figure_id": wid}, r.text
    figs = [f for f in api(base, TOMAS).get(f"/api/projects/{BM}/figures").json()["figures"]
            if slot.at(0) <= parse_ts(f["start"]) < slot.at(12)]
    assert [f["id"] for f in figs] == [wid]
    assert len(wait_mails(mail, _notice_pred(wr.json()), 1, "winner notice")) == 1
    for a, b in {(0, 8), (2, 10), (4, 12)} - {(wa, wb)}:
        assert not mails_now(mail, lambda m: f"Fingerprint: {slot.expect(a, b)['fingerprint'][:12]}" in text(m))


def _assert_single(base: str, slot: Slot, mail: Any) -> None:
    figs = figures_at(base, TOMAS, BM, slot.at(0), slot.at(12))
    assert len(figs) == 1, figs
    fid = figs[0]["id"]
    assert set(S3().keys(f"figures/{fid}/")) == {f"figures/{fid}/readings.csv", f"figures/{fid}/derivation.json"}
    led = ledger(base, TOMAS, BM)
    mine = entries_for(led, fid)
    assert sorted(e["kind"] for e in mine) == ["buffer", "issuance"], mine
    assert Decimal(led["balance_tco2e"]) == sum((Decimal(e["tco2e"]) for e in led["entries"]), Decimal(0))
    assert len(wait_mails(mail, _notice_pred(figs[0]), 1, "notice")) == 1
    assert len(mails_now(mail, lambda m: f"Fingerprint: {slot.expect(0, 12)['fingerprint'][:12]}" in text(m))) == 1


def test_wf_seal_retry_double_click(browser, app_url, mail):
    base = root(app_url)
    slot = std_slot(base)
    exp = slot.expect(0, 12)
    with _seal_page(browser, base, slot) as page:
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        dialog = open_seal_dialog(page)
        dialog.get_by_role("button", name="Confirm seal").dblclick()
        wait_dialog_closed(page, "Seal figure")
    _assert_single(base, slot, mail)


def test_wf_seal_retry_no_answer(browser, app_url, mail):
    base = root(app_url)
    slot = std_slot(base)
    exp = slot.expect(0, 12)
    keys: list[str | None] = []
    replays: list[str | None] = []

    def drop_first(route: Any) -> None:
        if route.request.method != "POST":
            route.continue_()
            return
        keys.append(route.request.headers.get("idempotency-key"))
        if len(keys) == 1:
            route.fetch()
            route.abort("failed")
        else:
            route.continue_()

    with _seal_page(browser, base, slot) as page:
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        page.route(f"**/api/projects/{BM}/figures", drop_first)
        page.on("response", lambda r: replays.append(r.headers.get("Idempotent-Replay".lower()))
                if r.request.method == "POST" and r.url.endswith("/figures") else None)
        dialog = open_seal_dialog(page)
        dialog.get_by_role("button", name="Confirm seal").click()
        eventually(page, lambda: expect(dialog.get_by_role("alert")).to_have_text(COPY_NO_ANSWER, timeout=POLL_MS), "no-answer copy")
        dialog.get_by_role("button", name="Confirm seal").click()
        wait_dialog_closed(page, "Seal figure")
    assert len(keys) == 2 and keys[0] and keys[0] == keys[1], f"retry reuses the key: {keys}"
    assert "true" in replays
    _assert_single(base, slot, mail)


def test_ingestion_outcomes(app_url):
    base = root(app_url)
    slot = new_slot(base, lambda d: block(d, sensors=["BM-T1"], half_hours=4, fc=lambda s, j: "1.5"))
    steward = api(base, PRIYA)

    def raw(rows: list[tuple[int, str, str, int]]) -> bytes:
        items = ",".join(f'{{"sensor_id":"BM-T1","interval_start":"{iso(slot.at(j))}","fc":{fc},"fch4":{fch4},"qc":{qc}}}'
                         for j, fc, fch4, qc in rows)
        return f'{{"readings":[{items}]}}'.encode()

    r = steward.post(f"/api/projects/{BM}/readings", headers={"Content-Type": "application/json"}, content=raw([
        (0, "1.50", "15.0", 0), (1, "2.25", "15.0", 0), (2, "1.5", "15", 1), (3, "1.5000", "15.0000", 0), (4, "1.5", "15.0", 0)]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["inserted"], body["revised"], body["unchanged"], body["broken_figures"]) == (1, 2, 2, [])
    assert body["batch_id"]
    stored = merge(slot.readings, [
        {"sensor_id": "BM-T1", "t": slot.at(1), "fc": "2.25", "fch4": "15.0", "qc": 0},
        {"sensor_id": "BM-T1", "t": slot.at(2), "fc": "1.5", "fch4": "15.0", "qc": 1},
        {"sensor_id": "BM-T1", "t": slot.at(4), "fc": "1.5", "fch4": "15.0", "qc": 0}])
    pv = preview(base, TOMAS, BM, slot.at(0), slot.at(5), ["BM-T1"]).json()
    assert pv["fingerprint"] == derive(BM, stored, slot.at(0), slot.at(5), ["BM-T1"])["fingerprint"]
    again = steward.post(f"/api/projects/{BM}/readings", headers={"Content-Type": "application/json"},
                         content=raw([(0, "1.5", "15.0", 0)])).json()
    assert (again["inserted"], again["revised"], again["unchanged"]) == (0, 0, 1) and again["batch_id"] != body["batch_id"]


def test_ingestion_validation_refuses_whole_batch(app_url):
    base = root(app_url)
    steward = api(base, PRIYA)
    span = new_slot(base, lambda d: [])
    day = span.day
    good = {"sensor_id": "BM-T1", "interval_start": iso(day), "fc": 1.0, "fch4": 10.0, "qc": 0}
    t1 = iso(day + HALF)
    cases = [
        ({"sensor_id": "XX-T9", "interval_start": t1, "fc": 1.0, "fch4": 1.0, "qc": 0}, "readings[1].sensor_id"),
        ({"sensor_id": "BM-T1", "interval_start": iso(day + timedelta(minutes=15)), "fc": 1.0, "fch4": 1.0, "qc": 0}, "readings[1].interval_start"),
        ({"sensor_id": "BM-T1", "interval_start": t1.replace("Z", ".000Z"), "fc": 1.0, "fch4": 1.0, "qc": 0}, "readings[1].interval_start"),
        ({"sensor_id": "BM-T1", "interval_start": t1, "fc": 100.5, "fch4": 1.0, "qc": 0}, "readings[1].fc"),
        ({"sensor_id": "BM-T1", "interval_start": t1, "fc": 1.23456, "fch4": 1.0, "qc": 0}, "readings[1].fc"),
        ({"sensor_id": "BM-T1", "interval_start": t1, "fc": "1.0", "fch4": 1.0, "qc": 0}, "readings[1].fc"),
        ({"sensor_id": "BM-T1", "interval_start": t1, "fch4": 1.0, "qc": 0}, "readings[1].fc"),
        ({"sensor_id": "BM-T1", "interval_start": t1, "fc": 1.0, "fch4": -1000.5, "qc": 0}, "readings[1].fch4"),
        ({"sensor_id": "BM-T1", "interval_start": t1, "fc": 1.0, "fch4": 5000.1, "qc": 0}, "readings[1].fch4"),
        ({"sensor_id": "BM-T1", "interval_start": t1, "fc": 1.0, "fch4": 1.0, "qc": 4}, "readings[1].qc"),
        ({"sensor_id": "BM-T1", "interval_start": t1, "fc": 1.0, "fch4": 1.0, "qc": 1.5}, "readings[1].qc"),
        (dict(good), "readings[1]"),
    ]
    for bad, key in cases:
        r = steward.post(f"/api/projects/{BM}/readings", json={"readings": [good, bad]})
        assert r.status_code == 422 and set(r.json()) == {"errors"} and key in r.json()["errors"], f"{bad}: {r.text}"
    r = steward.post(f"/api/projects/{BM}/readings", json={"readings": []})
    assert r.status_code == 422 and "readings" in r.json()["errors"]
    edge = [{"sensor_id": "BM-T2", "interval_start": iso(day + HALF * j), "fc": fc, "fch4": fch4, "qc": qc}
            for j, (fc, fch4, qc) in enumerate([(FC_MIN, FCH4_MIN, 0), (FC_MAX, FCH4_MAX, 3), (1.2345, 0, 2)])]
    r = steward.post(f"/api/projects/{BM}/readings", json={"readings": edge})
    assert r.status_code == 200 and r.json()["inserted"] == 3, r.text
    many = [{"sensor_id": s, "interval_start": iso(day + DAY + HALF * j), "fc": 1.0, "fch4": 10.0, "qc": 0}
            for j in range(48 * 18) for s in BM_IDS][:INGEST_MAX_READINGS + 1]
    assert len(many) == INGEST_MAX_READINGS + 1
    r = steward.post(f"/api/projects/{BM}/readings", json={"readings": many})
    assert r.status_code == 422 and "readings" in r.json()["errors"]
    r = steward.post(f"/api/projects/{BM}/readings", json={"readings": many[:INGEST_MAX_READINGS]})
    assert r.status_code == 200 and r.json()["inserted"] == INGEST_MAX_READINGS
    head, tail = b'{"readings":[', b"]}"
    exact = head + b" " * (INGEST_LIMIT - len(head) - len(tail)) + tail
    r = steward.post(f"/api/projects/{BM}/readings", content=exact, headers={"Content-Type": "application/json"})
    assert r.status_code == 422 and "readings" in r.json()["errors"], "2,000,000 bytes is allowed"
    r = steward.post(f"/api/projects/{BM}/readings", content=exact + b" ", headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    r = api(base, TOMAS).post(f"/api/projects/{BM}/readings", json={"readings": [good]})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    r = steward.post(f"/api/projects/{BM}/readings", json={"readings": [good]}, headers={"Origin": FOREIGN_ORIGIN})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}, "a steward's cross-site batch is refused"
    r = steward.post(f"/api/projects/{BM}/readings", json={"readings": [good]}, headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    r = steward.post(f"/api/projects/{BM}/readings", json={"readings": [good]})
    assert r.status_code == 200 and (r.json()["inserted"], r.json()["unchanged"]) == (1, 0), "refused batches stored nothing"


def _num(v: Any) -> Decimal:
    return Decimal(str(v))


def test_revision_history_chains(app_url):
    base = root(app_url)
    slot = new_slot(base, lambda d: block(d, skip={("BM-S4", 5)}))
    fig = sealed(slot, 0, 12)
    a = slot.revise([("BM-T1", 2, {"fc": "-2.5"})])
    next_second()
    b = slot.revise([("BM-T1", 2, {"fc": "-2.25"}), ("BM-S4", 5, {})])
    moved = api(base, TOMAS).get(f"/api/figures/{fig['id']}/audit").json()
    assert moved["figure_id"] == fig["id"]
    rows = moved["moved"]
    t1 = [m for m in rows if m["sensor_id"] == "BM-T1"]
    assert [(m["batch_id"], _num(m["old"]["fc"]), _num(m["new"]["fc"])) for m in t1] == \
        [(a["batch_id"], Decimal("-3.0"), Decimal("-2.5")), (b["batch_id"], Decimal("-2.5"), Decimal("-2.25"))]
    assert all(m["interval_start"] == iso(slot.at(2)) and int(m["new"]["qc"]) == 0 for m in t1)
    inserted = [m for m in rows if m["sensor_id"] == "BM-S4"]
    assert len(inserted) == 1 and inserted[0]["old"] is None and inserted[0]["batch_id"] == b["batch_id"]
    assert _num(inserted[0]["new"]["fc"]) == Decimal("-1.0")
    stamps = [m["revised_at"] for m in rows]
    assert all(TS_RE.match(s) for s in stamps) and stamps == sorted(stamps)


def test_break_writes_paired_reversals_once(app_url):
    base = root(app_url)
    slot = std_slot(base)
    before = ledger(base, TOMAS, BM)
    fig = sealed(slot, 0, 12)
    out = slot.revise([("BM-T2", 4, {"fch4": "31.0"})])
    assert out["broken_figures"] == [fig["id"]] and out["revised"] == 1
    assert figure_get(base, TOMAS, fig["id"])["status"] == "broken"
    led = ledger(base, TOMAS, BM)
    mine = entries_for(led, fig["id"])
    originals = {e["id"]: e for e in mine if e["kind"] != "reversal"}
    reversals = [e for e in mine if e["kind"] == "reversal"]
    assert len(originals) == 2 and len(reversals) == 2
    assert sorted(e["reverses"] for e in reversals) == sorted(originals)
    for e in reversals:
        assert Decimal(e["tco2e"]) == -Decimal(originals[e["reverses"]]["tco2e"])
    assert led["balance_tco2e"] == before["balance_tco2e"] and led["buffer_tco2e"] == before["buffer_tco2e"]
    _agree(base, TOMAS, BM)
    again = slot.revise([("BM-T2", 5, {"fch4": "31.0"})])
    assert again["broken_figures"] == []
    assert len(entries_for(ledger(base, TOMAS, BM), fig["id"])) == 4


@pytest.mark.timeout(900)


def test_broken_seal_alert_email(app_url, mail):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 10)
    broke = time.monotonic()
    slot.revise([("BM-T1", 1, {"fc": "-2.0"}), ("BM-S1", 2, {"qc": 1}), ("BM-S2", 3, {"fch4": "11.0"}), ("BM-T1", 11, {"fc": "0.5"})])
    subject = f"Seal broken on {fig['id']} (readings moved: 3)"
    alerts = wait_mails(mail, lambda m: subject_of(m) == subject, 1, "broken-seal alert", ALERT_WAIT_S)
    assert time.monotonic() - broke <= ALERT_WAIT_S
    assert len(alerts) == 1
    assert sorted(addresses(alerts[0]["To"]) + addresses(alerts[0].get("Cc") or [])) == sorted([HAL, TOMAS])
    lines = body_lines(alerts[0])
    reversed_tonnes = t3(-Decimal(fig["credited_tco2e"]))
    for line in (f"Figure: {fig['id']}", "Readings moved: 3", f"Reversed: {reversed_tonnes} tCO2e"):
        assert line in lines, f"alert lacks {line!r}: {lines}"
    audit = [line for line in lines if line.startswith("Audit trail: ")]
    assert len(audit) == 1 and audit[0].endswith(f"/projects/{BM}/figures/{fig['id']}/audit")
    slot.revise([("BM-T1", 4, {"fc": "-2.0"})])
    assert len(mails_now(mail, lambda m: subject_of(m).startswith(f"Seal broken on {fig['id']} "))) == 1
    own = std_slot(base)
    hfig = sealed(own, 0, 12, HAL)
    own.revise([("BM-T1", 0, {"fc": "-2.0"})])
    halert = wait_mails(mail, lambda m: subject_of(m).startswith(f"Seal broken on {hfig['id']} "), 1, "lead-sealed alert", ALERT_WAIT_S)
    assert (addresses(halert[0]["To"]) + addresses(halert[0].get("Cc") or [])).count(HAL) == 1


def test_broken_banner_and_audit_trail_screens(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    intact = sealed(slot, 6, 12)
    fig = sealed(slot, 0, 6)
    slot.revise([("BM-T1", 1, {"fc": "-2.5"}), ("BM-S3", 4, {"fch4": "12.5"})])
    with signed_in(browser, base, TOMAS, f"/projects/{BM}/figures/{intact['id']}/audit") as page:
        eventually(page, lambda: expect(page.get_by_text(COPY_AUDIT_EMPTY)).to_be_visible(timeout=POLL_MS), "empty trail copy")
        page.goto(f"{base}/projects/{BM}/figures/{fig['id']}")
        eventually(page, lambda: expect(page.get_by_role("heading", name=f"Figure {fig['id']}", level=1)).to_be_visible(timeout=POLL_MS), "figure page")
        expect(alert_with(page, "Seal broken.")).to_have_text(copy_banner(2))
        expect(page.get_by_text("Broken", exact=True).first).to_be_visible()
        page.get_by_role("link", name="Readings audit trail").click()
        eventually(page, lambda: expect(page.get_by_role("heading", name=f"Readings audit trail for {fig['id']}", level=1))
                   .to_be_visible(timeout=POLL_MS), "audit trail")
        rows = page.get_by_role("table", name="Moved readings").get_by_role("row").filter(has=page.get_by_role("cell"))
        expect(rows).to_have_count(2)
        for sid, old, new in (("BM-T1", "-3.0", "-2.5"), ("BM-S3", "10.0", "12.5")):
            row = rows.filter(has_text=sid)
            nums = {Decimal(n) for n in re.findall(r"-?\d+(?:\.\d+)?", row.inner_text())}
            assert Decimal(old) in nums and Decimal(new) in nums, row.inner_text()


@pytest.mark.timeout(900)


def test_concurrent_batches_one_break(app_url, mail):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    values = ["-2.1", "-2.2", "-2.3", "-2.4", "-2.6"]
    batches = [slot.changed([("BM-T1", 5, {"fc": v}), ("BM-S1", i, {"fch4": "11.5"})]) for i, v in enumerate(values)]
    clients = [login(base, PRIYA) for _ in batches]
    barrier = threading.Barrier(len(batches))

    def go(i: int) -> dict:
        barrier.wait()
        r = ingest(base, BM, batches[i], clients[i])
        assert r.status_code == 200, r.text
        return r.json()

    with ThreadPoolExecutor(len(batches)) as pool:
        outs = list(pool.map(go, range(len(batches))))
    assert sum(fig["id"] in o["broken_figures"] for o in outs) == 1
    assert [e["kind"] for e in entries_for(ledger(base, TOMAS, BM), fig["id"])].count("reversal") == 2
    rows = [m for m in api(base, TOMAS).get(f"/api/figures/{fig['id']}/audit").json()["moved"] if m["sensor_id"] == "BM-T1"]
    assert len(rows) == len(values)
    chain = {_num(m["old"]["fc"]): _num(m["new"]["fc"]) for m in rows}
    seen, cur = [], Decimal("-3.0")
    for _ in values:
        assert cur in chain, f"lost update in the chain: {rows}"
        cur = chain[cur]
        seen.append(cur)
    assert sorted(seen) == sorted(Decimal(v) for v in values)
    assert len(wait_mails(mail, lambda m: subject_of(m).startswith(f"Seal broken on {fig['id']} "), 1, "alert", ALERT_WAIT_S)) == 1

    race = std_slot(base)
    fp = race.expect(0, 12)["fingerprint"]
    change = race.changed([("BM-T2", 3, {"fc": "-1.5"})])
    seal_client, steward = login(base, TOMAS), login(base, PRIYA)
    gate = threading.Barrier(2)

    def do_seal() -> httpx.Response:
        gate.wait()
        return seal_client.post(f"/api/projects/{BM}/figures", headers={"Idempotency-Key": idempotency_key()},
                                json={"start": iso(race.at(0)), "end": iso(race.at(12)), "sensor_ids": BM_IDS, "preview_fingerprint": fp})

    def do_batch() -> httpx.Response:
        gate.wait()
        return ingest(base, BM, change, steward)

    with ThreadPoolExecutor(2) as pool:
        sf, bf = pool.submit(do_seal), pool.submit(do_batch)
        sr, br = sf.result(), bf.result()
    assert br.status_code == 200
    if sr.status_code == 201:
        assert br.json()["broken_figures"] == [sr.json()["id"]]
        assert figure_get(base, TOMAS, sr.json()["id"])["status"] == "broken"
    else:
        assert sr.status_code == 409 and sr.json()["error"] == "readings_changed", sr.text
    for f in figures_at(base, TOMAS, BM, race.at(0), race.at(12)):
        got = figure_get(base, TOMAS, f["id"])
        assert got["status"] != "sealed" or got["rederived"]["matches"] is True


@pytest.mark.timeout(900)


def test_wf_reingest_break_lead_sees(browser, app_url, mail):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    with signed_in(browser, base, HAL, ws_path(BM, slot.date, slot.date, slot.at(0), slot.at(12), BM_IDS)) as page:
        wait_entry(page, fig["id"], "Sealed")
        watch(page, "Workspace status")
        batches = [slot.changed([("BM-T1", j, {"fc": "-2.0"})]) for j in (1, 2, 3)]
        with ThreadPoolExecutor(3) as pool:
            outs = list(pool.map(lambda b: ingest(base, BM, b, login(base, PRIYA)).json(), batches))
        assert sum(fig["id"] in o["broken_figures"] for o in outs) == 1
        advance(page, REFRESH_MS)
        wait_entry(page, fig["id"], "Broken")
        wait_status(page, "Workspace status", copy_broken([fig["id"]]))
        assert times_announced(page, "Workspace status", copy_broken([fig["id"]])) == 1
        balance = ledger(base, HAL, BM)["balance_tco2e"]
        expect(page.get_by_role("region", name="Project balance")).to_contain_text(balance)
        expect(page.get_by_role("table", name="Sealed-tonnes ledger").get_by_role("row")
               .filter(has_text=fig["id"]).filter(has_text="Reversal")).to_have_count(2)
        page.get_by_role("link", name=fig["id"], exact=True).first.click()
        eventually(page, lambda: expect(alert_with(page, "Seal broken.")).to_have_text(copy_banner(1), timeout=POLL_MS), "banner")
        page.get_by_role("link", name="Readings audit trail").click()
        rows = page.get_by_role("table", name="Moved readings").get_by_role("row").filter(has=page.get_by_role("cell"))
        eventually(page, lambda: expect(rows).to_have_count(3, timeout=POLL_MS), "three moved readings")
    assert len(wait_mails(mail, lambda m: subject_of(m) == f"Seal broken on {fig['id']} (readings moved: 1)", 1, "alert", ALERT_WAIT_S)) == 1


@pytest.mark.timeout(900)


def test_wf_reingest_break_scientist_figure_page(browser, app_url, mail):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    with signed_in(browser, base, TOMAS, f"/projects/{BM}/figures/{fig['id']}") as page:
        eventually(page, lambda: expect(page.get_by_role("heading", name=f"Figure {fig['id']}", level=1)).to_be_visible(timeout=POLL_MS), "figure")
        slot.revise([("BM-S2", 1, {"fc": "-0.5"}), ("BM-S4", 2, {"qc": 1})])
        advance(page, REFRESH_MS)
        eventually(page, lambda: expect(alert_with(page, "Seal broken.")).to_have_text(copy_banner(2), timeout=POLL_MS),
                   "refresh shows the broken banner")
        page.get_by_role("link", name="Readings audit trail").click()
        rows = page.get_by_role("table", name="Moved readings").get_by_role("row").filter(has=page.get_by_role("cell"))
        eventually(page, lambda: expect(rows).to_have_count(2, timeout=POLL_MS), "two moved readings")
    assert [e["kind"] for e in entries_for(ledger(base, TOMAS, BM), fig["id"])].count("reversal") == 2
    assert len(wait_mails(mail, lambda m: subject_of(m).startswith(f"Seal broken on {fig['id']} "), 1, "alert", ALERT_WAIT_S)) == 1


def test_figure_state_machine(app_url):
    base = root(app_url)
    slot = std_slot(base)
    f1 = sealed(slot, 0, 12)
    slot.revise([("BM-T1", 3, {"fc": "-2.5"})])
    assert figure_get(base, TOMAS, f1["id"])["status"] == "broken"
    r = api(base, TOMAS).post(f"/api/figures/{f1['id']}/links", json={})
    assert r.status_code == 409 and r.json() == {"error": "figure_not_sealed"}
    count = len(entries_for(ledger(base, TOMAS, BM), f1["id"]))
    f2 = sealed(slot, 0, 12)
    assert (f2["status"], f2["supersedes"]) == ("sealed", f1["id"])
    old = figure_get(base, TOMAS, f1["id"])
    assert (old["status"], old["superseded_by"]) == ("superseded", f2["id"])
    assert len(entries_for(ledger(base, TOMAS, BM), f1["id"])) == count
    _agree(base, TOMAS, BM)
    r = api(base, TOMAS).post(f"/api/figures/{f1['id']}/links", json={})
    assert r.status_code == 409 and r.json() == {"error": "figure_not_sealed"}
    slot.revise([("BM-T1", 3, {"fc": "-2.0"})])
    slot.revise([("BM-T1", 3, {"fc": "-2.5"})])
    back = figure_get(base, TOMAS, f2["id"])
    assert back["status"] == "broken" and back["rederived"]["matches"] is True, "broken never returns to sealed"
    f3 = sealed(slot, 0, 12)
    assert f3["supersedes"] == f2["id"]
    assert figure_get(base, TOMAS, f1["id"])["superseded_by"] == f2["id"], "a superseded figure never changes again"
    r = seal(slot, 0, 12)
    assert r.status_code == 409 and r.json() == {"error": "already_sealed", "figure_id": f3["id"]}


def test_wf_reseal_supersede_workspace(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    old = sealed(slot, 0, 12)
    slot.revise([("BM-T2", 6, {"fc": "-1.0"})])
    exp = slot.expect(0, 12)
    with signed_in(browser, base, TOMAS, f"/projects/{BM}/figures/{old['id']}") as page:
        link = page.get_by_role("link", name="Open interval in workspace")
        eventually(page, lambda: expect(link).to_be_visible(timeout=POLL_MS), "figure page")
        link.click()
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        q = parse_qs(urlparse(page.url).query)
        assert urlparse(page.url).path == f"/projects/{BM}"
        assert q["start"] == [stamp(slot.at(0))] and q["end"] == [stamp(slot.at(12))]
        assert q["sensors"] == [",".join(sorted(BM_IDS, key=lambda s: s.encode()))]
        dialog = open_seal_dialog(page)
        dialog.get_by_role("button", name="Confirm seal").click()
        wait_dialog_closed(page, "Seal figure")
        new = [f for f in figures_at(base, TOMAS, BM, slot.at(0), slot.at(12)) if f["status"] == "sealed"]
        assert len(new) == 1 and new[0]["supersedes"] == old["id"]
        wait_status(page, "Workspace status", copy_sealed(new[0]["id"], exp["net_tco2e"], exp["coverage_pct"], old["id"]))
        wait_entry(page, old["id"], "Superseded")
        led = ledger(base, TOMAS, BM)
        assert Decimal(led["balance_tco2e"]) == sum((Decimal(e["tco2e"]) for e in led["entries"]), Decimal(0))
        expect(page.get_by_role("region", name="Project balance")).to_contain_text(led["balance_tco2e"])


def test_wf_reseal_supersede_figure_page(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    old = sealed(slot, 0, 12)
    slot.revise([("BM-S1", 6, {"fc": "-0.5"})])
    with signed_in(browser, base, TOMAS, f"/projects/{BM}/figures/{old['id']}") as page:
        eventually(page, lambda: expect(page.get_by_role("heading", name=f"Figure {old['id']}", level=1)).to_be_visible(timeout=POLL_MS), "figure")
        watch(page, "Figure status")
        new = sealed(slot, 0, 12)
        advance(page, REFRESH_MS)
        wait_status(page, "Figure status", copy_superseded(new["id"]))
        assert times_announced(page, "Figure status", copy_superseded(new["id"])) == 1
        expect(page.get_by_role("link", name=new["id"], exact=True)).to_be_visible()
        expect(page.get_by_text("Superseded", exact=True).first).to_be_visible()


def _agree(base: str, email: str, project: str) -> dict:
    c = api(base, email)
    figs, led = c.get(f"/api/projects/{project}/figures").json(), c.get(f"/api/projects/{project}/ledger").json()
    proj = c.get(f"/api/projects/{project}").json()
    row = next(p for p in c.get("/api/projects").json()["projects"] if p["slug"] == project)
    entries = led["entries"]
    total = sum((Decimal(e["tco2e"]) for e in entries), Decimal(0))
    buffer_ids = {e["id"] for e in entries if e["kind"] == "buffer"}
    buf = sum((Decimal(e["tco2e"]) for e in entries if e["kind"] == "buffer" or e["reverses"] in buffer_ids), Decimal(0))
    sealed_figs = [f for f in figs["figures"] if f["status"] == "sealed"]
    assert led["balance_tco2e"] == t3(total) and led["buffer_tco2e"] == t3(buf)
    assert sum((Decimal(f["credited_tco2e"]) for f in sealed_figs), Decimal(0)) == total
    assert sum((Decimal(f["buffer_tco2e"]) for f in sealed_figs), Decimal(0)) == buf
    want = {"sealed_net_tco2e": t3(total), "buffer_tco2e": t3(buf), "intact_count": len(sealed_figs),
            "broken_count": sum(f["status"] == "broken" for f in figs["figures"]),
            "superseded_count": sum(f["status"] == "superseded" for f in figs["figures"])}
    for summary in (figs["summary"], proj["summary"], row["summary"]):
        assert {k: summary[k] for k in want} == want, summary
    return want


def test_balance_buffer_counts_agree(app_url):
    base = root(app_url)
    start = _agree(base, HAL, BM)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    after = _agree(base, HAL, BM)
    assert Decimal(after["sealed_net_tco2e"]) - Decimal(start["sealed_net_tco2e"]) == Decimal(fig["credited_tco2e"])
    assert after["intact_count"] == start["intact_count"] + 1
    slot.revise([("BM-T1", 0, {"fc": "-2.9"})])
    broke = _agree(base, HAL, BM)
    assert broke["sealed_net_tco2e"] == start["sealed_net_tco2e"] and broke["broken_count"] == start["broken_count"] + 1


def test_projects_list_and_balance_strip_match(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    want = _agree(base, HAL, BM)
    with signed_in(browser, base, HAL, "/projects") as page:
        row = page.get_by_role("table", name="Projects").get_by_role("row").filter(
            has=page.get_by_role("link", name="Blackmere Moss", exact=True))
        eventually(page, lambda: expect(row).to_have_count(1, timeout=POLL_MS), "Projects row")
        cells = row.get_by_role("cell").all_inner_texts()[-5:]
        assert want["sealed_net_tco2e"] in cells[0] and want["buffer_tco2e"] in cells[1], cells
        assert [int(c.strip()) for c in cells[2:]] == [want["intact_count"], want["broken_count"], want["superseded_count"]]
        page.goto(f"{base}{ws_path(BM, slot.date, slot.date, slot.at(0), slot.at(12), BM_IDS)}")
        strip = page.get_by_role("region", name="Project balance")
        eventually(page, lambda: expect(strip).to_contain_text(want["sealed_net_tco2e"], timeout=POLL_MS), "balance strip")
        body = strip.inner_text()
        assert want["buffer_tco2e"] in body
        for label, key in (("Intact figures", "intact_count"), ("Broken figures", "broken_count"), ("Superseded figures", "superseded_count")):
            assert want[key] in counts_beside(label, body), f"{label}: {body}"
        balance_row = page.get_by_role("table", name="Sealed-tonnes ledger").get_by_role("row").filter(has_text="Balance")
        expect(balance_row.last).to_contain_text(want["sealed_net_tco2e"])
        wait_entry(page, fig["id"], "Sealed")
        entry = figure_entry(page, fig["id"])
        for value in (fig["net_tco2e"], fig["buffer_tco2e"], fig["credited_tco2e"], fig["coverage_pct"], "Sealed"):
            assert has_text(entry, value), f"Figures row lacks {value}: {entry}"


def test_live_refresh_in_place(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    f_a, f_b = sealed(slot, 0, 6), sealed(slot, 6, 12)
    other = std_slot(base)
    f_c = sealed(other, 0, 12)
    with signed_in(browser, base, HAL, ws_path(BM, slot.date, slot.date, slot.at(1), slot.at(5), BM_IDS)) as page, \
            signed_in(browser, base, TOMAS, f"/projects/{BM}/figures/{f_c['id']}") as figpage, \
            signed_in(browser, base, HAL, "/projects") as listing:
        exp = slot.expect(1, 5)
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        wait_entry(page, f_a["id"], "Sealed")
        figure_region(page).get_by_role("button", name="Unit breakdown").click()
        close = page.get_by_role("dialog", name="Unit breakdown").get_by_role("button", name="Close")
        eventually(page, lambda: expect(close).to_be_focused(timeout=POLL_MS), "dialog open")
        brush_before = brush(page)
        watch(page, "Workspace status")
        eventually(figpage, lambda: expect(figpage.get_by_role("heading", name=f"Figure {f_c['id']}", level=1)).to_be_visible(timeout=POLL_MS), "fig")
        eventually(listing, lambda: expect(listing.get_by_role("link", name="Blackmere Moss")).to_be_visible(timeout=POLL_MS), "list")
        slot.revise([("BM-T1", 1, {"fc": "-2.0"}), ("BM-T1", 7, {"fc": "-2.0"})])
        advance(page, REFRESH_MS)
        wait_entry(page, f_a["id"], "Broken")
        wait_entry(page, f_b["id"], "Broken")
        both = copy_broken([f_a["id"], f_b["id"]])
        wait_status(page, "Workspace status", both)
        assert times_announced(page, "Workspace status", both) == 1
        expect(page.get_by_role("dialog", name="Unit breakdown")).to_be_visible()
        expect(close).to_be_focused()
        assert brush(page) == brush_before
        other.revise([("BM-T2", 2, {"fc": "-1.0"})])
        advance(figpage, REFRESH_MS)
        eventually(figpage, lambda: expect(alert_with(figpage, "Seal broken.")).to_have_text(copy_banner(1), timeout=POLL_MS),
                   "figure page shows the banner after refresh")
        want = _agree(base, HAL, BM)
        advance(listing, REFRESH_MS)
        row = listing.get_by_role("table", name="Projects").get_by_role("row").filter(
            has=listing.get_by_role("link", name="Blackmere Moss", exact=True))
        eventually(listing, lambda: expect(row).to_contain_text(want["sealed_net_tco2e"], timeout=POLL_MS), "Projects refresh")


def test_wf_lead_dashboard_phone_live_break(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    with signed_in(browser, base, HAL, "/projects", size=PHONE) as page:
        link = page.get_by_role("link", name="Blackmere Moss").first
        eventually(page, lambda: expect(link).to_be_visible(timeout=POLL_MS), "Projects list")
        tap(link)
        eventually(page, lambda: expect(page.get_by_role("heading", name="Blackmere Moss", level=1)).to_be_visible(timeout=POLL_MS), "workspace")
        page.goto(f"{base}{ws_path(BM, slot.date, slot.date, slot.at(0), slot.at(12), BM_IDS)}")
        exp = slot.expect(0, 12)
        wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
        expect(page.get_by_role("region", name="Project balance")).to_contain_text(ledger(base, HAL, BM)["balance_tco2e"])
        _, end_before = brush(page)
        touch_drag(page, slider(page, "Interval end"), -40)
        advance(page, SETTLE_MS * 2)
        _, end_after = brush(page)
        assert end_after < end_before, "touch drag resized the brush end"
        sid = "BM-S2"
        foot = page.get_by_role("button", name=f"{sid} footprint")
        box = foot.bounding_box()
        assert box["width"] >= TOUCH_MIN_PX and box["height"] >= TOUCH_MIN_PX
        tap(foot)
        eventually(page, lambda: expect(foot).to_have_attribute("aria-pressed", "false", timeout=POLL_MS), "tap toggles the footprint")
        sheet_bounds(page, PHONE)
        hidden = figure_region(page).evaluate(HIDDEN_JS, ["Interval", "CO2 tCO2e", "CH4 tCO2e", "Buffer tCO2e",
                                                          "Credited tCO2e", "Readings", "Unit breakdown"])
        assert all(hidden), f"collapsed sheet exposes hidden content: {hidden}"
        page.evaluate("document.activeElement && document.activeElement.blur()")
        assert "Unit breakdown" not in tab_names(page, 40), "a collapsed sheet control took focus"
        details = page.get_by_role("button", name="Figure details")
        tap(details)
        eventually(page, lambda: expect(details).to_have_attribute("aria-expanded", "true", timeout=POLL_MS), "sheet expands")
        details.focus()
        brush_now = brush(page)
        watch(page, "Workspace status")
        slot.revise([("BM-T1", 0, {"fc": "-2.0"})])
        advance(page, REFRESH_MS)
        wait_entry(page, fig["id"], "Broken")
        wait_status(page, "Workspace status", copy_broken([fig["id"]]))
        assert times_announced(page, "Workspace status", copy_broken([fig["id"]])) == 1
        expect(details).to_have_attribute("aria-expanded", "true")
        expect(details).to_be_focused()
        assert brush(page) == brush_now
        expect(page.get_by_role("region", name="Project balance")).to_contain_text(ledger(base, HAL, BM)["balance_tco2e"])
        layout(page)


def test_wf_lead_dashboard_phone_issue_link(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    with signed_in(browser, base, HAL, f"/projects/{BM}/figures/{fig['id']}", size=PHONE) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        button = page.get_by_role("button", name="Issue regulator link")
        eventually(page, lambda: expect(button).to_be_visible(timeout=POLL_MS), "Issue regulator link")
        tap(button)
        box = page.get_by_role("textbox", name="Regulator link")
        eventually(page, lambda: expect(box).to_have_value(re.compile(r"/r/[A-Za-z0-9_-]+$"), timeout=POLL_MS), "link shown")
        copy = page.get_by_role("button", name="Copy link")
        expect(copy).to_be_focused()
        tap(copy)
        url = box.input_value()
        eventually(page, lambda: _assert_eq(page.evaluate("navigator.clipboard.readText()"), url), "clipboard holds the link")
        layout(page)
    token = url.rsplit("/r/", 1)[1]
    r = anon(base).get(f"/api/public/links/{token}")
    assert r.status_code == 200 and r.json()["link"]["status"] == "live" and r.json()["figure"]["id"] == fig["id"]


def test_issue_regulator_links(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    assert len(link["token"]) >= TOKEN_MIN_CHARS and TOKEN_RE.match(link["token"])
    assert link["url"].endswith(f"/r/{link['token']}") and link["status"] == "live"
    assert (parse_ts(link["expires_at"]) - parse_ts(link["issued_at"])).total_seconds() == LINK_TTL_DEFAULT_S
    r = api(base, ODILE).post(f"/api/figures/{fig['id']}/links", json={})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert api(base, ODILE).get(f"/api/figures/{fig['id']}/links").status_code == 403
    listed = api(base, TOMAS).get(f"/api/figures/{fig['id']}/links").json()["links"]
    assert [(x["token"], x["status"], x["revoked_at"]) for x in listed if x["id"] == link["id"]] == [(link["token"], "live", None)]
    short = outage("APP_SHORT_URL")
    sslot = new_slot(short, lambda d: block(d))
    sfig = sealed(sslot, 0, 12)
    slink = issue_link(short, TOMAS, sfig["id"])
    assert (parse_ts(slink["expires_at"]) - parse_ts(slink["issued_at"])).total_seconds() == SHORT_LINK_TTL_S
    with signed_in(browser, base, TOMAS, f"/projects/{BM}/figures/{fig['id']}") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        button = page.get_by_role("button", name="Issue regulator link")
        eventually(page, lambda: expect(button).to_be_visible(timeout=POLL_MS), "button")
        button.click()
        box = page.get_by_role("textbox", name="Regulator link")
        eventually(page, lambda: expect(box).to_have_value(re.compile(r"/r/"), timeout=POLL_MS), "issued")
        token = box.input_value().rsplit("/r/", 1)[1]
        issued = next(x for x in api(base, TOMAS).get(f"/api/figures/{fig['id']}/links").json()["links"] if x["token"] == token)
        wait_status(page, "Figure status", copy_link_issued(issued["expires_at"]))
        expect(page.get_by_role("button", name="Copy link")).to_be_focused()
        page.get_by_role("button", name="Copy link").click()
        eventually(page, lambda: _assert_eq(page.evaluate("navigator.clipboard.readText()"), box.input_value()), "clipboard")
        expect(page.get_by_role("table", name="Regulator links").get_by_role("button", name=f"Revoke link ending {token[-6:]}")).to_be_visible()


def test_link_not_issuable_for_a_broken_figure(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    with signed_in(browser, base, TOMAS, f"/projects/{BM}/figures/{fig['id']}") as page:
        button = page.get_by_role("button", name="Issue regulator link")
        eventually(page, lambda: expect(button).to_be_visible(timeout=POLL_MS), "the Figure page")
        slot.revise([("BM-S3", 3, {"fc": "-0.5"})])
        button.click()
        wait_status(page, "Figure status", COPY_LINK_NOT_ISSUABLE)
        assert api(base, TOMAS).get(f"/api/figures/{fig['id']}/links").json()["links"] == [], "nothing was issued"

def test_public_link_server_decides(app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    pub = anon(base)
    first = pub.get(f"/api/public/links/{link['token']}")
    assert first.status_code == 200
    body = first.json()
    assert body["link"] == {"status": "live", "expires_at": link["expires_at"]}
    assert body["project"] == {"name": "Blackmere Moss", "kind": "peatland rewetting"}
    assert body["figure"]["id"] == fig["id"] and body["figure"]["status"] == "sealed"
    assert body["figure"]["rederived"]["matches"] is True and body["figure"]["fingerprint"] == fig["fingerprint"]
    deadline = time.monotonic() + LINK_WAIT_S
    while time.monotonic() < deadline:
        again = pub.post(f"/api/public/links/{link['token']}/rederive", json={})
        assert again.status_code == 200
        if again.json()["figure"]["checked_at"] > body["figure"]["checked_at"]:
            break
    else:
        pytest.fail("POST rederive never returned a fresh checked_at")
    checked = again.json()["figure"]["checked_at"]
    assert parse_ts(checked) - server_date(again) <= timedelta(seconds=1), \
        f"checked_at {checked} is more than a second past Date {iso(server_date(again))}"
    slot.revise([("BM-T1", 0, {"fc": "-2.0"})])
    later = pub.get(f"/api/public/links/{link['token']}").json()
    assert later["link"]["status"] == "live" and later["figure"]["status"] == "broken"
    assert later["figure"]["rederived"]["matches"] is False
    audit = pub.get(f"/api/public/links/{link['token']}/audit")
    assert audit.status_code == 200 and audit.json()["figure_id"] == fig["id"] and len(audit.json()["moved"]) == 1
    r = pub.get("/api/public/links/no-such-token-0123456789abcdef0123")
    assert r.status_code == 404 and r.json() == {"error": "not_found"}


def _regulator_checks(page: Page, fig: dict, link: dict, word: str) -> None:
    eventually(page, lambda: expect(page.get_by_role("heading", name=f"Sealed figure {fig['id']}", level=1)).to_be_visible(timeout=POLL_MS), "regulator page")
    expect(page.get_by_text(f"Status: {word}")).to_be_visible()
    expect(page.get_by_text(f"Link expires {display(parse_ts(link['expires_at']))}")).to_be_visible()
    body = page.inner_text("body")
    for value in (fig["fingerprint"], fig["coverage_pct"], fig["buffer_tco2e"], fig["credited_tco2e"], fig["net_tco2e"]):
        assert value in body, f"regulator page lacks {value}"
    for c in fig["contributions"]:
        assert c["sensor_id"] in body and c["net_tco2e"] in body
    assert re.search(r"Checked at " + CHECKED_DISPLAY_RE.pattern, body)
    expect(page.get_by_role("navigation", name="Main")).to_have_count(0)


def test_regulator_page(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    with open_app(browser, f"{base}/r/{link['token']}") as page:
        _regulator_checks(page, fig, link, "Intact")
        page.evaluate("document.activeElement && document.activeElement.blur()")
        names = [n for n in tab_names(page, 12) if n in ("Re-derive", "Readings audit trail", "Download readings file")]
        collapsed = [n for i, n in enumerate(names) if i == 0 or names[i - 1] != n]
        assert collapsed[:3] == ["Re-derive", "Readings audit trail", "Download readings file"], names
        rederive = page.get_by_role("button", name="Re-derive")
        rederive.focus()
        with held(page, "**/rederive") as gate:
            page.keyboard.press("Enter")
            eventually(page, lambda: expect(status(page, "Re-derivation status")).to_have_text(
                COPY_REDERIVE_PENDING, timeout=POLL_MS), "pending re-derivation status")
            gate.release()
        eventually(page, lambda: expect(status(page, "Re-derivation status")).to_have_text(
            re.compile(r"^Re-derived at " + CHECKED_DISPLAY_RE.pattern + r": Intact\.$"), timeout=POLL_MS), "re-derived")
        page.get_by_role("button", name="Download readings file").focus()
        with page.expect_download() as info:
            page.keyboard.press("Enter")
        download = info.value
        assert download.suggested_filename == f"{fig['id']}-readings.csv"
        assert hashlib.sha256(Path(download.path()).read_bytes()).hexdigest() == fig["fingerprint"]
        page.get_by_role("link", name="Readings audit trail").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(page.get_by_role("heading", name=f"Readings audit trail for {fig['id']}", level=1)).to_be_visible(timeout=POLL_MS), "audit")
        expect(page.get_by_text(COPY_AUDIT_EMPTY)).to_be_visible()
        assert urlparse(page.url).path == f"/r/{link['token']}/audit"


def test_regulator_rederive_failure_copy(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    with open_app(browser, f"{base}/r/{link['token']}") as page:
        rederive = page.get_by_role("button", name="Re-derive")
        eventually(page, lambda: expect(rederive).to_be_visible(timeout=POLL_MS), "the regulator page")
        page.route("**/rederive", lambda route: route.abort())
        rederive.press("Enter")
        eventually(page, lambda: expect(status(page, "Re-derivation status")).to_have_text(
            COPY_REDERIVE_FAILED, timeout=POLL_MS), "L448 the re-derivation failure copy")

def test_wf_regulator_view_wrong_clock(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    with open_app(browser, f"{base}/r/no-such-token-probe") as page:
        page.clock.set_system_time(FAR_CLOCK)
        page.goto(f"{base}/r/{link['token']}")
        _regulator_checks(page, fig, link, "Intact")
        now = server_date(anon(base).get(f"/api/public/links/{link['token']}"))
        shown = re.search(r"Checked at (" + CHECKED_DISPLAY_RE.pattern + ")", page.inner_text("body")).group(1)
        checked = datetime.strptime(shown, "%Y-%m-%d %H:%M:%S UTC").replace(tzinfo=UTC)
        assert abs((now - checked).total_seconds()) < 600, "the check time comes from the server, not the device clock"
        page.get_by_role("button", name="Re-derive").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(status(page, "Re-derivation status")).to_have_text(re.compile(r": Intact\.$"), timeout=POLL_MS), "re-derived")
        expect(page.get_by_role("heading", name=EXPIRED_PAGE[0])).to_have_count(0)
        with page.expect_download() as info:
            page.get_by_role("button", name="Download readings file").press("Enter")
        assert Path(info.value.path()).read_bytes() == S3().get(fig["evidence"]["readings_key"])


def test_wf_regulator_view_after_break(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    slot.revise([("BM-S3", 3, {"fc": "-0.5"})])
    with open_app(browser, f"{base}/r/{link['token']}") as page:
        _regulator_checks(page, fig, link, "Broken")
        page.get_by_role("button", name="Re-derive").press("Enter")
        eventually(page, lambda: expect(status(page, "Re-derivation status")).to_have_text(re.compile(r": Broken\.$"), timeout=POLL_MS), "verdict")
        with page.expect_download() as info:
            page.get_by_role("button", name="Download readings file").press("Enter")
        assert hashlib.sha256(Path(info.value.path()).read_bytes()).hexdigest() == fig["fingerprint"]
        page.get_by_role("link", name="Readings audit trail").press("Enter")
        rows = page.get_by_role("table", name="Moved readings").get_by_role("row").filter(has=page.get_by_role("cell"))
        eventually(page, lambda: expect(rows).to_have_count(1, timeout=POLL_MS), "one moved reading")


def test_regulator_rederive_says_superseded(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    old = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, old["id"])
    slot.revise([("BM-S3", 3, {"fc": "-0.5"})])
    new = sealed(slot, 0, 12)
    assert figure_get(base, TOMAS, old["id"])["superseded_by"] == new["id"]
    with open_app(browser, f"{base}/r/{link['token']}") as page:
        rederive = page.get_by_role("button", name="Re-derive")
        eventually(page, lambda: expect(rederive).to_be_visible(timeout=POLL_MS), "the regulator page")
        eventually(page, lambda: expect(page.get_by_text(f"Status: Superseded by {new['id']}")).to_be_visible(
            timeout=POLL_MS), "L444 the status line names the superseding figure")
        rederive.press("Enter")
        eventually(page, lambda: expect(status(page, "Re-derivation status")).to_have_text(
            re.compile(r"^Re-derived at " + CHECKED_DISPLAY_RE.pattern + r": Superseded\.$"), timeout=POLL_MS),
            "L447 the Superseded verdict")

def test_link_expiry_on_every_surface(app_url):
    short = outage("APP_SHORT_URL")
    slot = new_slot(short, lambda d: block(d))
    fig = sealed(slot, 0, 12)
    link = issue_link(short, TOMAS, fig["id"])
    expires = parse_ts(link["expires_at"])
    pub, sealer, tok = anon(short), api(short, TOMAS), link["token"]
    surfaces = {
        "get": lambda: pub.get(f"/api/public/links/{tok}"),
        "rederive": lambda: pub.post(f"/api/public/links/{tok}/rederive", json={}),
        "audit": lambda: pub.get(f"/api/public/links/{tok}/audit"),
        "evidence": lambda: pub.get(f"/api/public/links/{tok}/evidence"),
        "list": lambda: sealer.get(f"/api/figures/{fig['id']}/links"),
    }
    live_seen, expired_seen = set(), set()
    deadline = time.monotonic() + LINK_WAIT_S
    while time.monotonic() < deadline and len(expired_seen) < len(surfaces):
        for name, call in surfaces.items():
            r = call()
            when = server_date(r)
            if name == "list":
                state = next(x for x in r.json()["links"] if x["token"] == tok)["status"]
                assert state == ("live" if when < expires else "expired"), f"list at {when}: {state}"
            elif when < expires:
                assert r.status_code == 200, f"{name} before expiry: {r.status_code}"
            else:
                assert r.status_code == 410 and r.json() == {"error": "link_expired", "expires_at": link["expires_at"]}, f"{name}: {r.text}"
            (live_seen if when < expires else expired_seen).add(name)
    assert "get" in live_seen and expired_seen == set(surfaces), f"live {live_seen}, expired {expired_seen}"
    r = sealer.post(f"/api/figures/{fig['id']}/links/{link['id']}/revoke", json={})
    assert r.status_code == 409 and r.json() == {"error": "link_expired"} and server_date(r) >= expires


def test_regulator_links_table_turns_expired(browser, app_url):
    short = outage("APP_SHORT_URL")
    slot = new_slot(short, lambda d: block(d))
    fig = sealed(slot, 0, 12)
    with signed_in(browser, short, TOMAS, f"/projects/{BM}/figures/{fig['id']}") as page:
        issue = page.get_by_role("button", name="Issue regulator link")
        eventually(page, lambda: expect(issue).to_be_visible(timeout=POLL_MS), "the Figure page")
        issue.click()
        box = page.get_by_role("textbox", name="Regulator link")
        eventually(page, lambda: expect(box).to_have_value(re.compile(r"/r/"), timeout=POLL_MS), "a link")
        token = box.input_value().rsplit("/r/", 1)[1]
        table = page.get_by_role("table", name="Regulator links")
        revoke = page.get_by_role("button", name=f"Revoke link ending {token[-6:]}")
        live = table.get_by_role("row").filter(has=revoke)
        eventually(page, lambda: expect(live).to_have_count(1, timeout=POLL_MS), "L234 Revoke appears on a live link")
        assert has_text(live.inner_text(), "Live"), f"L234 Status reads Live: {live.inner_text()!r}"
        _wait_expired(short, token)
        page.reload()
        row = table.get_by_role("row").filter(has_text=token[-6:])
        eventually(page, lambda: _assert_eq(has_text(row.first.inner_text(), "Expired"), True),
                   "L234 the row's Status reads Expired once the expiry second has passed")
        expect(revoke).to_have_count(0)


def test_link_revocation(app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    path = f"/api/figures/{fig['id']}/links/{link['id']}/revoke"
    assert api(base, ODILE).post(path, json={}).status_code == 403
    r = api(base, TOMAS).post(path, json={})
    assert r.status_code == 200 and r.json()["status"] == "revoked" and r.json()["id"] == link["id"]
    revoked_at = r.json()["revoked_at"]
    assert TS_RE.match(revoked_at)
    pub = anon(base)
    for sub in ("", "/audit", "/evidence"):
        g = pub.get(f"/api/public/links/{link['token']}{sub}")
        assert g.status_code == 410 and g.json() == {"error": "link_revoked", "revoked_at": revoked_at}, sub
    g = pub.post(f"/api/public/links/{link['token']}/rederive", json={})
    assert g.status_code == 410 and g.json()["error"] == "link_revoked"
    listed = next(x for x in api(base, TOMAS).get(f"/api/figures/{fig['id']}/links").json()["links"] if x["id"] == link["id"])
    assert (listed["status"], listed["revoked_at"]) == ("revoked", revoked_at)
    r = api(base, TOMAS).post(path, json={})
    assert r.status_code == 409 and r.json() == {"error": "link_revoked"}
    short = outage("APP_SHORT_URL")
    sslot = new_slot(short, lambda d: block(d))
    sfig = sealed(sslot, 0, 12)
    slink = issue_link(short, TOMAS, sfig["id"])
    spath = f"/api/figures/{sfig['id']}/links/{slink['id']}/revoke"
    assert api(short, TOMAS).post(spath, json={}).status_code == 200
    deadline = time.monotonic() + LINK_WAIT_S
    while time.monotonic() < deadline:
        r = api(short, TOMAS).post(spath, json={})
        if server_date(r) >= parse_ts(slink["expires_at"]):
            assert r.status_code == 409 and r.json() == {"error": "link_expired"}
            break
        assert r.status_code == 409 and r.json() == {"error": "link_revoked"}
    else:
        pytest.fail("the revoked short link never reached its expiry")
    g = anon(short).get(f"/api/public/links/{slink['token']}")
    assert g.status_code == 410 and g.json()["error"] == "link_revoked", "revoked wins over expired"


def _wait_expired(base: str, token: str) -> None:
    deadline = time.monotonic() + LINK_WAIT_S
    while time.monotonic() < deadline:
        if anon(base).get(f"/api/public/links/{token}").status_code == 410:
            return
    pytest.fail("GET /api/public/links/<token> never answered 410 after the short link's expiry")


def _ended(page: Page, copy: tuple[str, str]) -> None:
    eventually(page, lambda: expect(page.get_by_role("heading", name=copy[0])).to_be_visible(timeout=POLL_MS), copy[0])
    expect(page.get_by_text(copy[1])).to_be_visible()


def test_ended_link_pages(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    assert api(base, TOMAS).post(f"/api/figures/{fig['id']}/links/{link['id']}/revoke", json={}).status_code == 200
    short = outage("APP_SHORT_URL")
    sslot = new_slot(short, lambda d: block(d))
    sfig = sealed(sslot, 0, 12)
    slink = issue_link(short, TOMAS, sfig["id"])
    _wait_expired(short, slink["token"])
    with open_app(browser, f"{base}/r/no-such-token-0123456789abcdef0123") as page:
        _ended(page, UNKNOWN_PAGE)
        page.goto(f"{base}/r/{link['token']}")
        _ended(page, REVOKED_PAGE)
        expect(page.get_by_role("button", name="Re-derive")).to_have_count(0)
        expect(page.get_by_text(fig["fingerprint"])).to_have_count(0)
        page.goto(f"{short}/r/{slink['token']}")
        _ended(page, EXPIRED_PAGE)
        expect(page.get_by_text(sfig["fingerprint"])).to_have_count(0)


LINK_TRIES = 3


def _reissue(lead: Page, issue: Locator, box: Locator, seen: str) -> str:
    issue.click()
    eventually(lead, lambda: expect(box).not_to_have_value(re.compile(re.escape(seen)), timeout=POLL_MS), "a fresh link")
    return box.input_value().rsplit("/r/", 1)[1]


def _opened_live(page: Page, fid: str, seconds: float = 3.0) -> bool:
    head = page.get_by_role("heading", name=f"Sealed figure {fid}", level=1)
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if head.is_visible():
            return True
    return False


def test_wf_link_lifecycle_revoke_and_expire(browser, app_url):
    short = outage("APP_SHORT_URL")
    slot = new_slot(short, lambda d: block(d))
    fig = sealed(slot, 0, 12)
    with signed_in(browser, short, HAL, f"/projects/{BM}/figures/{fig['id']}") as lead, \
            open_app(browser, f"{short}/r/no-such-token-probe") as reg:
        reg.clock.set_system_time(PAST_CLOCK)
        issue = lead.get_by_role("button", name="Issue regulator link")
        box = lead.get_by_role("textbox", name="Regulator link")
        eventually(lead, lambda: expect(issue).to_be_visible(timeout=POLL_MS), "figure page")
        issue.click()
        eventually(lead, lambda: expect(box).to_have_value(re.compile(r"/r/"), timeout=POLL_MS), "first link")
        first = box.input_value().rsplit("/r/", 1)[1]
        lead.get_by_role("button", name=f"Revoke link ending {first[-6:]}").click()
        wait_status(lead, "Figure status", COPY_LINK_REVOKED)
        second = _reissue(lead, issue, box, first)
        reg.goto(f"{short}/r/{second}")
        for _ in range(LINK_TRIES):
            if _opened_live(reg, fig["id"]):
                break
            second = _reissue(lead, issue, box, second)
            reg.goto(f"{short}/r/{second}")
        eventually(reg, lambda: expect(reg.get_by_role("heading", name=f"Sealed figure {fig['id']}", level=1)).to_be_visible(timeout=POLL_MS), "open while live")
        _wait_expired(short, second)
        reg.get_by_role("button", name="Re-derive").click()
        _ended(reg, EXPIRED_PAGE)
        lead.get_by_role("button", name=f"Revoke link ending {second[-6:]}").click()
        wait_status(lead, "Figure status", COPY_LINK_ALREADY_EXPIRED)
        reg.goto(f"{short}/r/{first}")
        _ended(reg, REVOKED_PAGE)
    states = {x["token"]: x["status"] for x in api(short, HAL).get(f"/api/figures/{fig['id']}/links").json()["links"]}
    assert states[first] == "revoked" and states[second] == "expired"


def test_wf_link_lifecycle_unknown_and_revoked_pages(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, HAL, fig["id"])
    with signed_in(browser, base, HAL, f"/projects/{BM}/figures/{fig['id']}") as lead:
        revoke = lead.get_by_role("button", name=f"Revoke link ending {link['token'][-6:]}")
        eventually(lead, lambda: expect(revoke).to_be_visible(timeout=POLL_MS), "links table")
        revoke.click()
        wait_status(lead, "Figure status", COPY_LINK_REVOKED)
        rows = lead.get_by_role("table", name="Regulator links").get_by_role("row").filter(has_text="Revoked")
        eventually(lead, lambda: expect(rows).not_to_have_count(0, timeout=POLL_MS), "table shows Revoked")
    with open_app(browser, f"{base}/r/{link['token']}") as reg:
        _ended(reg, REVOKED_PAGE)
        reg.goto(f"{base}/r/no-such-token-0123456789abcdef0123")
        _ended(reg, UNKNOWN_PAGE)
    assert anon(base).get(f"/api/public/links/{link['token']}").status_code == 410


def test_evidence_download_as_sealed(app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    stored = S3().get(fig["evidence"]["readings_key"])
    slot.revise([("BM-T1", 0, {"fc": "-2.0"})])
    assert slot.expect(0, 12)["fingerprint"] != fig["fingerprint"]
    r = anon(base).get(f"/api/public/links/{link['token']}/evidence")
    assert r.status_code == 200 and r.content == stored
    assert hashlib.sha256(r.content).hexdigest() == fig["fingerprint"]
    assert r.headers["content-type"].split(";")[0].strip() == "text/csv"
    assert r.headers["content-disposition"] == f'attachment; filename="{fig["id"]}-readings.csv"'
    assert r.headers["x-fluxseal-fingerprint"] == fig["fingerprint"]
    assert S3().get(fig["evidence"]["readings_key"]) == stored, "objects are never rewritten"
    down = anon(outage("APP_MINIO_DOWN_URL")).get(f"/api/public/links/{link['token']}/evidence")
    assert down.status_code == 503 and down.json() == {"error": "storage_unavailable"}


def test_evidence_download_after_readings_move(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    slot.revise([("BM-S1", 3, {"fc": "-0.75"})])
    assert slot.expect(0, 12)["fingerprint"] != fig["fingerprint"], "the readings moved behind the figure"
    with open_app(browser, f"{base}/r/{link['token']}") as page:
        button = page.get_by_role("button", name="Download readings file")
        eventually(page, lambda: expect(button).to_be_visible(timeout=POLL_MS), "the regulator page")
        button.focus()
        with page.expect_download() as info:
            page.keyboard.press("Enter")
        got = info.value
        assert got.suggested_filename == f"{fig['id']}-readings.csv"
        assert hashlib.sha256(Path(got.path()).read_bytes()).hexdigest() == fig["fingerprint"], \
            "DP-63 the download is the file as sealed, not a re-derivation"


def test_regulator_download_during_storage_outage(browser, app_url):
    base, down = root(app_url), outage("APP_MINIO_DOWN_URL")
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, TOMAS, fig["id"])
    with open_app(browser, f"{down}/r/{link['token']}") as page:
        button = page.get_by_role("button", name="Download readings file")
        eventually(page, lambda: expect(button).to_be_visible(timeout=POLL_MS), "the regulator page")
        button.press("Enter")
        eventually(page, lambda: expect(alert_with(page, COPY_FILE_UNAVAILABLE)).to_be_visible(timeout=POLL_MS),
                   "L449 the readings-file-unavailable alert")

def test_responsive_layouts(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    fig = sealed(slot, 0, 12)
    link = issue_link(base, HAL, fig["id"])
    ws = ws_path(BM, slot.date, slot.date, slot.at(0), slot.at(12), BM_IDS)
    exp = slot.expect(0, 12)
    for size in (PHONE, TABLET, DESKTOP):
        with signed_in(browser, base, HAL, ws, size=size) as page:
            wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
            boxes = {n: page.get_by_role("group", name=n).bounding_box() for n in ("Coverage map", "Flux timeline", "Sensors")}
            fbox = figure_region(page).bounding_box()
            if size == DESKTOP:
                assert boxes["Flux timeline"]["x"] + boxes["Flux timeline"]["width"] <= boxes["Coverage map"]["x"] + 1
                assert fbox["x"] >= boxes["Flux timeline"]["x"] + boxes["Flux timeline"]["width"] - 1
            elif size == TABLET:
                assert boxes["Coverage map"]["y"] < boxes["Flux timeline"]["y"] < boxes["Sensors"]["y"] < fbox["y"]
            else:
                assert boxes["Coverage map"]["y"] < boxes["Flux timeline"]["y"] < boxes["Sensors"]["y"]
                sheet_bounds(page, size)
            layout(page)
            screens = (("/projects", lambda: page.get_by_role("table", name="Projects")),
                       (f"/projects/{BM}/figures/{fig['id']}",
                        lambda: page.get_by_role("heading", name=f"Figure {fig['id']}", level=1)),
                       (f"/projects/{BM}/figures/{fig['id']}/audit",
                        lambda: page.get_by_role("heading", name=f"Readings audit trail for {fig['id']}", level=1)),
                       (f"/r/{link['token']}",
                        lambda: page.get_by_role("heading", name=f"Sealed figure {fig['id']}", level=1)))
            for path, anchor in screens:
                page.goto(f"{base}{path}")
                eventually(page, lambda anchor=anchor: expect(anchor()).to_be_visible(timeout=POLL_MS), path)
                layout(page)
        with signed_in(browser, base, INES, "/admin/access", size=size) as page:
            eventually(page, lambda: expect(page.get_by_role("table", name="Access")).to_be_visible(timeout=POLL_MS), "Access")
            layout(page)
        with signed_in(browser, base, None, "/signin", size=size) as page:
            eventually(page, lambda: expect(page.get_by_role("button", name="Sign in")).to_be_visible(timeout=POLL_MS), "Sign in")
            layout(page)


FOCUS_PROPS = ("outline-style", "outline-width", "outline-color", "box-shadow", "background-color", "color",
               "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "filter")


def assert_focus_ring(page: Page, loc: Locator) -> None:
    rest, focus = state_styles(loc, *FOCUS_PROPS, state="focus")
    if rest != focus:
        return
    page.evaluate("document.activeElement && document.activeElement.blur()")
    before = decode(capture(loc))
    loc.focus()
    assert difference(before, decode(capture(loc))) > 0, f"no visible focus ring: {rest}"


TAB_NAME_JS = """() => {
  const e = document.activeElement;
  if (!e || e === document.body) return '';
  const text = n => (n ? (n.innerText || n.textContent || '') : '');
  const byIds = ids => ids.split(/\\s+/).filter(Boolean).map(id => text(document.getElementById(id))).join(' ');
  const svgTitle = n => { const t = n.querySelector(':scope > title'); return t ? t.textContent : ''; };
  const name = e.getAttribute('aria-label') || byIds(e.getAttribute('aria-labelledby') || '')
    || text(e.labels && e.labels[0]) || svgTitle(e) || text(e) || e.title || '';
  return name.replace(/\\s+/g, ' ').trim();
}"""


def tab_names(page: Page, presses: int) -> list[str]:
    names = []
    for _ in range(presses):
        page.keyboard.press("Tab")
        names.append(page.evaluate(TAB_NAME_JS))
    return names


def _tokens(names: list[str]) -> list[str]:
    known = {"Projects", "Sign out", "From", "To", "Apply dates", "Interval start", "Interval position", "Interval end",
             "Previous interval", "Next interval", "Unit breakdown", "Seal figure", "Figure details"}
    folded = {k.casefold(): k for k in known}
    ids = {i.casefold() for i in BM_IDS}
    out: list[str] = []
    for raw in names:
        n = " ".join(raw.split())
        tok = ("fp" if n.endswith(" footprint") else "cb" if n.split(" ")[0].casefold() in ids else
               "figlink" if FIGURE_ID_RE.match(n) else folded.get(n.casefold()))
        if tok and (not out or out[-1] != tok):
            out.append(tok)
    return out


def test_keyboard_tab_order_focus_and_sheet(browser, app_url):
    base = root(app_url)
    slot = std_slot(base)
    sealed(slot, 0, 4)
    exp = slot.expect(6, 12)
    ws = ws_path(BM, slot.date, slot.date, slot.at(6), slot.at(12), BM_IDS)
    middle = ["Interval start", "Interval position", "Interval end", "Previous interval", "Next interval"]
    orders = {
        DESKTOP: ["Projects", "Sign out", "From", "To", "Apply dates", *middle, "fp", "cb", "Unit breakdown", "Seal figure", "figlink"],
        TABLET: ["Projects", "Sign out", "fp", "From", "To", "Apply dates", *middle, "cb", "Unit breakdown", "Seal figure", "figlink"],
        PHONE: ["Projects", "Sign out", "fp", "From", "To", "Apply dates", *middle, "cb", "Seal figure", "Figure details", "figlink"],
    }
    for size, wanted in orders.items():
        with signed_in(browser, base, TOMAS, ws, size=size) as page:
            wait_figure(page, exp["coverage_pct"], exp["net_tco2e"])
            seal_button = page.get_by_role("button", name="Seal figure", exact=True)
            eventually(page, lambda: expect(seal_button).to_be_enabled(timeout=POLL_MS), "armed")
            page.evaluate("document.activeElement && document.activeElement.blur()")
            names = tab_names(page, 60)
            tokens = _tokens(names)
            assert tokens[:len(wanted)] == wanted, f"{size}: {tokens}"
            assert len({n for n in names if n.endswith(" footprint")}) == len(BM_IDS)
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            for loc in (page.get_by_role("button", name="Apply dates"), slider(page, "Interval start"), seal_button):
                assert_focus_ring(page, loc)
            if size == PHONE:
                assert "Unit breakdown" not in names
                hidden = figure_region(page).evaluate(HIDDEN_JS, ["Interval", "CO2 tCO2e", "CH4 tCO2e", "Buffer tCO2e",
                                                                  "Credited tCO2e", "Readings", "Unit breakdown"])
                assert all(hidden), f"collapsed sheet exposes hidden content: {hidden}"
                details = page.get_by_role("button", name="Figure details")
                expect(details).to_have_attribute("aria-expanded", "false")
                details.click()
                eventually(page, lambda: expect(details).to_have_attribute("aria-expanded", "true", timeout=POLL_MS), "expand")
                shown = figure_region(page).evaluate(HIDDEN_JS, ["CO2 tCO2e", "Unit breakdown"])
                assert not any(shown), "the expanded sheet shows the whole panel"
                seal_button.focus()
                after = tab_names(page, 2)
                assert after == ["Unit breakdown", "Figure details"], after


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert all(isinstance(v, str) and v for v in manifest.values())
    assert manifest["_schema"] == "run-manifest-v1"


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == [], f"packages missing from the notices: {missing}"
    low = notices.lower()
    for asset, pkg in (("Instrument Serif", "instrument-serif"), ("Instrument Sans", "instrument-sans"),
                       ("IBM Plex Mono", "ibm-plex-mono"), ("Lucide", "lucide")):
        assert asset.lower() in low or pkg in low, f"{asset} missing from the notices"


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert bad == [], f"packages with disallowed licences: {bad}"


def test_if_no_extra_datastore():
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "lowdb", "nedb",
                 "pouchdb", "lokijs", "node-persist", "@libsql/client", "duckdb"}
    shipped = {p.name for p in shipped_packages()}
    assert shipped & forbidden == set(), f"extra datastore packages: {shipped & forbidden}"
    assert Postgres().tables(), "the app keeps no tables in the provided Postgres"


def test_if_service_config_unchanged():
    assert isinstance(Postgres().tables(), list)
    assert isinstance(S3().keys(""), list)
    if os.environ.get("MAIL_FROM"):
        assert os.environ["MAIL_FROM"] == "Fluxseal <seals@sedgemoor.example>"


def test_if_typescript_source():
    skip = {"node_modules", "dist", "build", "out", ".git", "coverage", ".next", ".svelte-kit", ".turbo", ".cache"}
    config = re.compile(r"(^\.|config\.(c|m)?js$|rc\.(c|m)?js$)")
    ts, js = 0, []
    for path in APP.rglob("*"):
        if any(part in skip for part in path.relative_to(APP).parts) or not path.is_file():
            continue
        if path.suffix in (".ts", ".tsx", ".mts", ".cts"):
            ts += 1
        elif path.suffix in (".js", ".jsx", ".mjs", ".cjs") and not config.search(path.name):
            js.append(str(path.relative_to(APP)))
    assert ts > 0, "no TypeScript source under /app"
    assert js == [], f"hand-written JavaScript outside build output and tool configuration: {js}"
