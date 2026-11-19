from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, localcontext
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    Mailpit,
    Postgres,
    S3,
    addresses,
    eventually,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    ready,
    same_origin,
    shipped_packages,
    soon,
    tab_order,
    unique,
    until,
)
from conftest import advance as page_advance
from conftest import check as kit_check
from conftest import click as kit_click
from conftest import fill as kit_fill
from conftest import select as kit_select
from conftest import tap as kit_tap
from conftest import text as mail_text


def centre(locator: Locator) -> None:
    locator.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")


def click(locator: Locator) -> None:
    centre(locator)
    kit_click(locator)


def fill(locator: Locator, value: str) -> None:
    centre(locator)
    kit_fill(locator, value)


def tap(locator: Locator) -> None:
    centre(locator)
    kit_tap(locator)


def select(locator: Locator, choice: str) -> None:
    poll(lambda: locator.evaluate("(e, v) => e.tagName !== 'SELECT' || [...e.options].some(o => (o.label || o.text || '').trim() === v || o.value === v)", choice),
         UI_WAIT_S, f"option {choice!r} never appeared")
    kit_select(locator, choice)


def check(locator: Locator) -> None:
    centre(locator)
    kit_check(locator)

UFERN = 1_000_000
APP_START = datetime(2026, 11, 6, 9, 0, tzinfo=timezone.utc)
BLOCK_MS = 15_000
SAMPLE_SEED = 42
SAMPLES_PER_BLOCK = 16
SAMPLE_INTERVAL_MS = 1_000
FRAUD_DELAY_MS = 5_000
UNBONDING_MS = 120_000
MAX_UNBONDINGS = 7
MAX_REDELEGATIONS = 7
VOTING_PERIOD_MS = 600_000
VOTE_REMINDER_MS = 120_000
INVITE_TTL_HOURS = 72
ROW_REVEAL_MS = 100
MAX_BLOB = 3_452
BODY_LIMIT = 1_048_576
MAX_ADVANCE_MS = 86_400_000
STAKING_GAS = 80_000
STAKING_FEE = 8_000
MAIL_RETRY_S = 5
SNAPSHOT_RETRY_S = 10
STORAGE_RECHECK_S = 5
CONTROL_MIN_PX = 44
TOP_BAR_PX = 64
WALK_STAGGER_MS = 100
WALK_RISE_MS = 600
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
PHONE_CHECK = (390, 844)
DEPOSIT_END_4 = APP_START + timedelta(minutes=4, seconds=35)
VOTING_END_3 = APP_START + timedelta(minutes=6, seconds=15)
UNBONDING_END = APP_START + timedelta(minutes=5)

VIEWER_COPY = "Viewers can't make changes in this workspace."
OWNER_PRODUCER_COPY = "Only the owner can change producer behaviour."
OWNER_MEMBERS_COPY = "Only the owner can manage members."
TX_SENT = "Transaction sent. It takes effect when the next block is produced."
SUBMIT_DOWN = "Storage is unavailable, so blobs can't be submitted right now. The explorer still works."
SNAPSHOT_DOWN = "Storage is unavailable, so the snapshot can't be downloaded right now."
SIGNIN_ERROR = "Email or password is incorrect."
NOT_FOUND = {"error": "Not found"}

ORCHARD, HARBOR, LANTERN, QUARRY_MAIN = (
    "00000000000000a100",
    "00000000000000b200",
    "00000000000000c300",
    "00000000000000d400",
)
PADDING_NS = "fffffffffffffffffe"
PARITY_NS_HEX = "ffffffffffffffffff"

BLOCK3_SHARES = {
    (0, 0): "00000000000000c3000100000078426c6f6273206172652073706c697420696e746f207368617265732c206c61696420696e20612073717561726520616e6420",
    (0, 1): "00000000000000c30000657874656e6465642077697468207061726974792e20426c6f6273206172652073706c697420696e746f207368617265732c206c6169",
    (0, 2): "00000000000000c30003caf0e8421a7c7b6ed58e717e7f20755250697492e7f21869be515ee3544b5f3486547b694420696e887d2073435d475c4938e36a6eb2",
    (2, 0): "00000000000000c30003c840d2548676f140778a61726520574cb4bb9c60bbb29cb16095b8a396af957460b4a3bbac60bbb260a36095939fa396af60a3b2ac60",
    (3, 3): "242424242424240f210106cd4ec7acb322e72a8ca9c1a780b7ff9cd2e88b5d655cd4ff808a598eb89270b790ecd2a840d2dca5e640e6b492a896be6859d0d6eb",
}
BLOCK3_TEXT = b"Blobs are split into shares, laid in a square and extended with parity. Blobs are split into shares, laid in a square an"
BLOCK3_LEAF00 = "8ae44032ea24401cfbd4dd0a2d3bd02c316cbfe62602df791dae30495b4eb7a4"
BLOCK3_ROW0 = "fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f"
BLOCK3_COL0 = "0a81b3a2aaeeccd4dbd1cbe93e9fabc992d5a3bb56a0a14a107d43875367c996"
BLOCK3_DATA_ROOT = "917f4d16f69e876c76da0cdbc6f8935001e4628f279912d1cbdb1425885f23eb"
BLOCK2_ROW0 = "a0d9966f3fb0d09021d636825ee1e231dd1bdba95d2c27fe747d21f8a534f165"
BLOCK2_ROW1 = "06370d2ca07b9029694bfce8f2b0e32dbb1e8e904264e06d6b3fc61afb16249a"
BLOCK2_DATA_ROOT = "74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf"
HARBOR_ROW0_NODES = [
    "f88cc191e709c55fd17d251db310293382646b0209a4d19a4db97a9d59bb4889",
    "586695226acd1200025e9256e1b90a222099dabdc0141448c3b2d19a8aa695e2",
    "cd5b55a6080cfcc3dec12ea9cc751cb120867ea543c76a263976141f23b98b00",
]
ABSENT_NS = "00000000000000b100"
ABSENT_NEXT_LEAF = "0ddeab3716b07d5949f65557ec01cf5c07707c340db2636024b03e7530d0e78a"
FRAUD5_COMMITTED = "e192ae6614412c74a5c3172143235d152cdbf258ddd317c74d6acc0ec835defe"
FRAUD5_RECOMPUTED = "fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f"
FRAUD6_COMMITTED = "11ff6ecf60e7971fdd14b69761c46758fe74b59cf4cad36467f73b8334f999a5"
FRAUD6_RECOMPUTED = "285512c9cea4bb8c34ce7b2a1ce036f8e7087fa6e48cf2f7cb67dfb497d4672b"

WREN_6 = [(2, 5), (1, 5), (1, 3), (2, 0), (1, 7), (3, 4), (6, 4), (1, 4)]
KESTREL_2 = [(6, 2), (7, 7), (4, 0), (4, 5), (4, 6), (7, 1)]
WREN_4 = [(0, 3), (2, 0), (6, 5)]
CONF_K4 = ["39.0625", "62.8662", "77.3716", "86.2108", "91.5972", "94.8796"]
CONF_K2 = ["56.2500", "80.8594", "91.6260"]
CONF_K8 = ["31.6406", "53.2700", "68.0556"]

FEE_TABLE = {
    1: (1, 65_512, 6_552),
    120: (3, 66_536, 6_654),
    200: (4, 67_048, 6_705),
    300: (6, 68_072, 6_808),
    1000: (19, 74_728, 7_473),
}
PEOPLE = {
    "amara": ("Amara Osei", "amara.osei@fernhill.test"),
    "felix": ("Felix Navarro", "felix.navarro@fernhill.test"),
    "priya": ("Priya Raman", "priya.raman@fernhill.test"),
    "jonas": ("Jonas Weber", "jonas.weber@quarry.test"),
}
BALANCES = {"amara": 2_000, "felix": 5_000, "priya": 100, "jonas": 1_000}
VALIDATORS = {
    "alder": ("Alder", 4_000, "0.05", "41.67", 4_500),
    "birch": ("Birch", 3_000, "0.10", "30.56", 3_300),
    "cedar": ("Cedar", 2_000, "0", "18.52", 2_000),
    "dogwood": ("Dogwood", 1_000, "0.20", "9.26", 1_000),
}
PROPOSALS = {
    1: ("Raise the maximum square width to 16", "Passed"),
    2: ("Lower the block time to 10 seconds", "Rejected with veto"),
    3: ("Fund a public sampling dashboard", "Voting period"),
    4: ("Add a namespace directory", "Deposit period"),
    5: ("Rename the Dogwood validator", "Failed — deposit not met"),
    6: ("Halve the block reward", "Rejected — quorum not reached"),
    7: ("Add a second light node tier", "Rejected"),
}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}

HTTP_TIMEOUT = 120
UI_WAIT_S = 20
LIVE_DEADLINE_S = 8
POLL_INTERVAL_S = 0.25
COPY_BOOT_S = 180
DESCRIPTION_TIMEOUT_MS = 2_000
RELAY_MAX_CONNECTIONS = 100_000
RELAY_MAX_CHUNKS = 10_000_000
TIMING_TOLERANCE_MS = 20
SCROLL_STEPS = 16
WRONG_DEVICE_TIME = datetime(2026, 11, 9, 3, 0, tzinfo=timezone.utc)
_TICK = threading.Event()


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def at_block(h: int) -> datetime:
    return APP_START + timedelta(milliseconds=BLOCK_MS * h)


def fern(ufern: int) -> str:
    return f"{ufern // UFERN}.{ufern % UFERN:06d}"


def shown(ufern: int) -> str:
    return f"{ufern // UFERN:,}.{ufern % UFERN:06d}"


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def ufern_of(text: str) -> int:
    whole, frac = text.replace(",", "").split(".")
    return int(whole) * UFERN + int(frac)


def plain(text: str) -> int:
    return int(text.replace(",", ""))


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def fresh_hex() -> str:
    return "00e" + uuid.uuid4().hex[:15]


def poll(check_fn: Callable[[], Any], seconds: float, message: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = check_fn()
        if last:
            return last
        _TICK.wait(POLL_INTERVAL_S)
    pytest.fail(f"{message} (gave up after {seconds} s; last {last!r})")


def grading_key() -> str:
    return os.environ.get("GRADING_KEY", "gf-grading-7c19e4")


def grading(base: str, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
    headers = {"X-Grading-Key": key if key is not None else grading_key()}
    return httpx.post(base + path, json={} if body is None else body, headers=headers, timeout=HTTP_TIMEOUT)


def seed(base: str) -> dict[str, Any]:
    r = grading(base, "/api/grading/seed")
    assert r.status_code == 200, f"POST /api/grading/seed answered {r.status_code}: {r.text[:300]}"
    return r.json()


class Api:
    def __init__(self, base: str, session: str | None = None):
        cookies = {"fs_session": session} if session else None
        self.client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, cookies=cookies)

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.client.get(path, params=params or None)

    def post(self, path: str, body: Any, key: str | None = None) -> httpx.Response:
        return self.client.post(path, json=body, headers={"Idempotency-Key": key} if key else None)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.client.put(path, json=body)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.client.patch(path, json=body)

    def json(self, path: str, **params: Any) -> Any:
        r = self.get(path, **params)
        assert r.status_code == 200, f"GET {path} answered {r.status_code}: {r.text[:300]}"
        return r.json()


class World:
    def __init__(self, base: str, data: dict[str, Any]):
        self.base = base
        self.data = data
        self.fern = data["workspaces"]["fernhill"]["id"]
        self.quarry = data["workspaces"]["quarry"]["id"]

    def person(self, who: str) -> dict[str, Any]:
        return self.data["people"][who]

    def session(self, who: str) -> str:
        return self.person(who)["session"]

    def api(self, who: str | None = None) -> Api:
        return Api(self.base, self.session(who) if who else None)

    def validator(self, name: str, ws: str = "fernhill") -> str:
        return self.data["validators"][ws][name]["id"]

    def node(self, key: str) -> str:
        return self.data["lightNodes"][key]["id"]

    def w(self, path: str = "", ws: str | None = None) -> str:
        return f"/api/w/{ws or self.fern}{path}"

    def advance(self, ms: int) -> dict[str, Any]:
        r = grading(self.base, "/api/grading/clock", {"advanceMs": ms})
        assert r.status_code == 200, f"clock advance {ms} answered {r.status_code}: {r.text[:300]}"
        return r.json()

    def clock(self) -> datetime:
        return iso(self.advance(0)["clock"])

    def advance_to(self, when: datetime) -> dict[str, Any]:
        delta = when - self.clock()
        ms = delta // timedelta(milliseconds=1)
        assert 0 <= ms <= MAX_ADVANCE_MS, f"cannot advance the server clock by {ms} ms"
        return self.advance(ms)


@pytest.fixture
def world(app_url: str) -> World:
    return World(app_url, seed(app_url))


def expect_error(r: httpx.Response, status: int, body: dict[str, Any]) -> None:
    assert r.status_code == status, f"expected {status} {body}, got {r.status_code} {r.text[:300]}"
    assert r.json() == body, f"expected body {body}, got {r.text[:300]}"


def expect_field(r: httpx.Response, field: str, message: str) -> None:
    expect_error(r, 422, {"errors": {field: message}})


def staking_me(api: Api, w: World) -> dict[str, Any]:
    return api.json(w.w("/staking/me"))


def fee_for(api: Api, w: World, size: int, ws: str | None = None) -> int:
    return api.json(w.w("/fee-estimate", ws), bytes=size)["feeUfern"]


def submit_blob(api: Api, w: World, ns: str, data: bytes, fee: str | None = None, key: str | None = None) -> httpx.Response:
    if fee is None:
        fee = fern(fee_for(api, w, len(data)))
    return api.post(w.w("/blobs"), {"namespace": ns, "dataBase64": b64(data), "fee": fee}, key)


def created(r: httpx.Response) -> dict[str, Any]:
    assert r.status_code == 201, f"expected 201, got {r.status_code} {r.text[:300]}"
    return r.json()


def samples(api: Api, w: World, node: str, h: int) -> dict[str, Any]:
    return api.json(w.w(f"/light-nodes/{node}/samples"), height=h)


def take_sample(api: Api, w: World, node: str, h: int) -> httpx.Response:
    return api.post(w.w(f"/light-nodes/{node}/samples"), {"height": h})


def coords(items: list[dict[str, Any]]) -> list[tuple[int, int]]:
    return [(s["row"], s["col"]) for s in items]


def block(api: Api, w: World, h: int) -> dict[str, Any]:
    return api.json(w.w(f"/blocks/{h}"))


def share_grid(api: Api, w: World, h: int) -> tuple[int, list[list[bytes | None]]]:
    body = api.json(w.w(f"/blocks/{h}/shares"))
    k = body["k"]
    grid: list[list[bytes | None]] = [[None] * (2 * k) for _ in range(2 * k)]
    for row in body["rows"]:
        for cell in row:
            grid[cell["row"]][cell["col"]] = bytes.fromhex(cell["share"]) if cell["share"] else None
    return k, grid


def share_cells(api: Api, w: World, h: int) -> dict[tuple[int, int], dict[str, Any]]:
    body = api.json(w.w(f"/blocks/{h}/shares"))
    return {(c["row"], c["col"]): c for row in body["rows"] for c in row}


def ledger(api: Api, w: World, account: str | None = None) -> dict[str, Any]:
    return api.json(w.w("/ledger"), **({"account": account} if account else {}))


def assert_ledger_balanced(db: Postgres, ws: str) -> None:
    rows = db.rows(
        "SELECT pair_id::text AS pair, SUM(amount_ufern)::text AS total, COUNT(*)::int AS n "
        f"FROM ledger_entries WHERE workspace_id::text = '{ws}' GROUP BY pair_id"
    )
    assert rows, "ledger_entries holds no pairs for the workspace"
    unbalanced = [r for r in rows if int(r["total"]) != 0 or int(r["n"]) != 2]
    assert not unbalanced, f"pairs that are not two balancing entries: {unbalanced[:5]}"


def account_sum(db: Postgres, ws: str, account_like: str) -> int:
    rows = db.rows(
        "SELECT COALESCE(SUM(amount_ufern), 0)::text AS s FROM ledger_entries "
        f"WHERE workspace_id::text = '{ws}' AND account LIKE '{account_like}'"
    )
    return int(rows[0]["s"])


def outage_base(var: str) -> str:
    url = os.environ.get(var)
    if not url:
        pytest.fail(f"{var} is not set; the verifier needs that outage instance")
    return url.rstrip("/")


@contextlib.contextmanager
def scratch_database() -> Iterator[str]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.fail("DATABASE_URL is not set in the verifier; cannot start an app copy")
    name = f"scratch_{uuid.uuid4().hex[:12]}"
    parsed = urlparse(url)

    def run(sql: str) -> None:
        done = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
        assert done.returncode == 0, f"psql {sql!r} failed: {done.stderr[-500:]}"

    run(f'CREATE DATABASE "{name}"')
    try:
        yield parsed._replace(path="/" + name).geturl()
    finally:
        run(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def blob_shares(ns_hex: str, data: bytes) -> list[bytes]:
    ns = bytes.fromhex(ns_hex)
    out = [ns + b"\x01" + len(data).to_bytes(4, "big") + data[:50].ljust(50, b"\0")]
    rest = data[50:]
    for i in range(0, len(rest), 54):
        out.append(ns + b"\x00" + rest[i : i + 54].ljust(54, b"\0"))
    return out


PADDING_SHARE = bytes.fromhex(PADDING_NS) + b"\x01" + b"\0" * 54


def original_square(blobs: list[tuple[str, bytes]]) -> list[list[bytes]]:
    ordered = sorted(enumerate(blobs), key=lambda e: (bytes.fromhex(e[1][0]), e[0]))
    shares = [s for _, (ns, d) in ordered for s in blob_shares(ns, d)]
    k = 1
    for _ in range(8):
        if k * k >= len(shares):
            break
        k *= 2
    shares += [PADDING_SHARE] * (k * k - len(shares))
    return [shares[r * k : (r + 1) * k] for r in range(k)]


GF_EXP = [0] * 512
GF_LOG = [0] * 256
_x = 1
for _i in range(255):
    GF_EXP[_i] = _x
    GF_LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    GF_EXP[_i] = GF_EXP[_i - 255]


def gmul(a: int, b: int) -> int:
    return 0 if a == 0 or b == 0 else GF_EXP[GF_LOG[a] + GF_LOG[b]]


def ginv(a: int) -> int:
    return GF_EXP[255 - GF_LOG[a]]


def rs_extend(line: list[bytes]) -> list[bytes]:
    k = len(line)
    parity = []
    for x in range(k, 2 * k):
        coeffs = []
        for i in range(k):
            num, den = 1, 1
            for j in range(k):
                if j != i:
                    num = gmul(num, x ^ j)
                    den = gmul(den, i ^ j)
            coeffs.append(gmul(num, ginv(den)))
        out = bytearray(64)
        for i in range(k):
            for b in range(64):
                out[b] ^= gmul(coeffs[i], line[i][b])
        parity.append(bytes(out))
    return parity


def extend_square(q0: list[list[bytes]]) -> list[list[bytes]]:
    k = len(q0)
    top = [row + rs_extend(row) for row in q0]
    columns = [rs_extend([q0[r][c] for r in range(k)]) for c in range(k)]
    bottom = []
    for i in range(k):
        q2 = [columns[c][i] for c in range(k)]
        bottom.append(q2 + rs_extend(q2))
    return top + bottom


Node = tuple[bytes, bytes, bytes]
PARITY_NS = bytes.fromhex(PARITY_NS_HEX)


def sha(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def leaf_node(ns: bytes, share: bytes) -> Node:
    return (ns, ns, sha(b"\x00" + ns + share))


def nmt_parent(left: Node, right: Node) -> Node:
    return (min(left[0], right[0]), max(left[1], right[1]), sha(b"\x01" + left[0] + left[1] + left[2] + right[0] + right[1] + right[2]))


def nmt_root(nodes: list[Node]) -> Node:
    level = list(nodes)
    for _ in range(16):
        if len(level) == 1:
            break
        level = [nmt_parent(level[i], level[i + 1]) for i in range(0, len(level), 2)]
    return level[0]


def square_roots(ext: list[list[bytes]]) -> tuple[list[Node], list[Node]]:
    k = len(ext) // 2
    ns = lambda r, c: ext[r][c][:9] if r < k and c < k else PARITY_NS
    rows = [nmt_root([leaf_node(ns(r, c), ext[r][c]) for c in range(2 * k)]) for r in range(2 * k)]
    cols = [nmt_root([leaf_node(ns(r, c), ext[r][c]) for r in range(2 * k)]) for c in range(2 * k)]
    return rows, cols


def data_root(rows: list[Node], cols: list[Node]) -> bytes:
    level = [sha(b"\x00" + n[0] + n[1] + n[2]) for n in rows + cols]
    for _ in range(16):
        if len(level) == 1:
            break
        level = [sha(b"\x01" + level[i] + level[i + 1]) for i in range(0, len(level), 2)]
    return level[0]


def as_node(j: dict[str, str]) -> Node:
    return (bytes.fromhex(j["min"]), bytes.fromhex(j["max"]), bytes.fromhex(j["hash"]))


def node_json(n: Node) -> dict[str, str]:
    return {"min": n[0].hex(), "max": n[1].hex(), "hash": n[2].hex()}


def proof_root(width: int, start: int, end: int, leaves: list[Node], nodes: list[Node]) -> Node:
    leaf_it, node_it = iter(leaves), iter(nodes)

    def build(lo: int, hi: int) -> Node:
        if hi <= start or lo >= end:
            return next(node_it)
        if hi - lo == 1:
            return next(leaf_it)
        mid = (lo + hi) // 2
        return nmt_parent(build(lo, mid), build(mid, hi))

    root = build(0, width)
    assert next(node_it, None) is None, "proof carries more nodes than the published rule allows"
    return root


def mulberry32(seed_value: int) -> Callable[[], float]:
    mask = 0xFFFFFFFF
    state = [seed_value & mask]

    def imul(x: int, y: int) -> int:
        return (x * y) & mask

    def rng() -> float:
        a = (state[0] + 0x6D2B79F5) & mask
        state[0] = a
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & mask) ^ t
        return ((t ^ (t >> 14)) & mask) / 4294967296

    return rng


def sample_coords(node_number: int, height: int, k: int, count: int) -> list[tuple[int, int]]:
    rng = mulberry32((SAMPLE_SEED + 7919 * height + 104729 * node_number) % 2**32)
    out = []
    for _ in range(count):
        r = int(rng() * 2 * k)
        c = int(rng() * 2 * k)
        out.append((r, c))
    return out


def confidence(k: int, s: int) -> str:
    p = Fraction((k + 1) ** 2, (2 * k) ** 2)
    c = (1 - (1 - p) ** s) * 100
    with localcontext() as ctx:
        ctx.prec = 80
        ctx.rounding = ROUND_HALF_UP
        return str((Decimal(c.numerator) / Decimal(c.denominator)).quantize(Decimal("0.0001")))


@contextlib.contextmanager
def open_as(
    browser: Browser,
    base: str,
    session: str | None,
    path: str,
    *,
    size: tuple[int, int] = DESKTOP,
    reduced_motion: str = "no-preference",
    device_time: datetime | None = None,
    frozen: bool = False,
    init_script: str | None = None,
) -> Iterator[Page]:
    with open_app(browser, base + "/api/health", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if session:
            page.context.add_cookies([{"name": "fs_session", "value": session, "url": base}])
        if device_time is not None:
            page.clock.set_system_time(device_time)
        page.add_init_script(STATUS_LOGGER)
        if init_script:
            page.add_init_script(init_script)
        if not frozen:
            page.clock.resume()
        page.goto(base + path)
        yield page


STATUS_LOGGER = """
(() => {
  const label = el => el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '')
      .split(/\\s+/).filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
  window.__said = [];
  const record = () => {
    for (const el of document.querySelectorAll('[role="status"], output')) {
      const entry = {name: label(el), text: (el.textContent || '').replace(/\\s+/g, ' ').trim()};
      if (entry.text && !window.__said.some(e => e.name === entry.name && e.text === entry.text)) window.__said.push(entry);
    }
  };
  new MutationObserver(record).observe(document, {subtree: true, childList: true, characterData: true});
})();
"""


def said(target: Page | Locator, name: str, copy: str) -> None:
    page = target if isinstance(target, Page) else target.page
    poll(lambda: page.evaluate("([n, c]) => (window.__said || []).some(e => e.name === n && e.text.includes(c))", [name, copy]),
         UI_WAIT_S, f"status {name!r} never announced {copy!r}")


def open_frozen(*args: Any, **kwargs: Any) -> Any:
    return open_as(*args, frozen=True, **kwargs)


def wait_text(page: Page, needle: str, seconds: float = UI_WAIT_S) -> None:
    until(page, "n => document.body.innerText.replace(/\\s+/g, ' ').includes(n)", needle, seconds)


def page_text(page: Page) -> str:
    return norm(page.evaluate("() => document.body.innerText"))


def described(control: Locator, group: Locator | None, copy: str) -> None:
    try:
        soon(control, DESCRIPTION_TIMEOUT_MS).to_have_accessible_description(copy)
    except AssertionError:
        assert group is not None, f"control lacks the accessible description {copy!r}"
        soon(group).to_have_accessible_description(copy)


def at_least(locator: Locator, px: int = CONTROL_MIN_PX) -> None:
    box = locator.bounding_box()
    assert box is not None, "control has no box"
    assert box["width"] >= px and box["height"] >= px, f"control is {box['width']}x{box['height']} px, below {px} px"


STAGE_ATTRIBUTE = """
(card, attribute) => {
  const found = [card, ...card.getElementsByTagName('*')].find(n => n.hasAttribute(attribute));
  return found ? found.getAttribute(attribute) : null;
}
"""


def _stage_is(card: Locator, attribute: str, expected: str) -> None:
    got = card.evaluate(STAGE_ATTRIBUTE, attribute)
    assert got == expected, f"Square walk card carries {attribute}={got!r}, expected {expected} (L196)"


def stage_has(card: Locator, attribute: str, expected: str) -> None:
    poll(lambda: card.evaluate(STAGE_ATTRIBUTE, attribute) == expected, UI_WAIT_S,
         f"Square walk card never carried {attribute}={expected} (L196)")


def grid(page: Page, h: int) -> Locator:
    return page.get_by_role("grid", name=f"Data square, block {h}")


def cell(page: Page, r: int, c: int) -> Locator:
    return page.get_by_role("gridcell", name=re.compile(rf"^Share {r}, {c}: "))


REVEAL_LOGGER = """
target => {
  const label = el => el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '')
      .split(/\\s+/).filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
  window.__reveal = [];
  const record = () => {
    const g = [...document.querySelectorAll('[role="grid"]')].find(x => label(x) === target);
    if (!g) return;
    const rows = [...g.querySelectorAll('[data-revealed]')].filter(r => !r.hasAttribute('data-col'));
    const n = rows.filter(r => r.getAttribute('data-revealed') === 'true').length;
    window.__reveal.push({t: performance.now(), n, total: rows.length});
  };
  new MutationObserver(record).observe(document.body, {subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['data-revealed', 'aria-label', 'aria-labelledby']});
  record();
}
"""
def revealed_at_once(page: Page) -> None:
    until(page, "() => (window.__reveal || []).some(e => e.total === 8 && e.n === 8)", None, UI_WAIT_S)
    log = [e for e in page.evaluate("() => window.__reveal") if e["total"] == 8]
    full = next(e for e in log if e["n"] == 8)
    assert full["t"] - log[0]["t"] < ROW_REVEAL_MS, "reduced motion must reveal every row at once (L202), not row by row"


REVEAL_NOW = """
target => {
  const label = el => el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '')
      .split(/\\s+/).filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
  const g = [...document.querySelectorAll('[role="grid"]')].find(x => label(x) === target);
  if (!g) return null;
  const rows = [...g.querySelectorAll('[data-revealed]')].filter(r => !r.hasAttribute('data-col'));
  return {n: rows.filter(r => r.getAttribute('data-revealed') === 'true').length, total: rows.length, t: performance.now()};
}
"""
WALK_LOGGER = """
els => {
  window.__walk = [];
  const snap = () => window.__walk.push({t: performance.now(), states: els.map(e => e.getAttribute('data-state'))});
  const mo = new MutationObserver(snap);
  els.forEach(e => mo.observe(e, {attributes: true, attributeFilter: ['data-state']}));
  snap();
}
"""
WALK_FROM_LOAD = """
(() => {
  window.__walk = [];
  const NAMES = ['Lay out', 'Extend', 'Commit'];
  const name = el => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\\s+/)
      .filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ')
      || (el.querySelector('h1,h2,h3,h4') || {}).textContent || '').trim();
  let last = '';
  const snap = () => {
    const els = NAMES.map(n => [...document.querySelectorAll('article')].find(a => name(a) === n));
    if (els.some(e => !e)) return;
    const states = els.map(e => e.getAttribute('data-state'));
    if (states.join() === last) return;
    last = states.join();
    const list = els[0].closest('ul, ol, [role="list"]') || els[0].parentElement;
    window.__walk.push({t: performance.now(), states, top: list.getBoundingClientRect().top, vh: window.innerHeight});
  };
  new MutationObserver(snap).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-state']});
})();
"""
INFINITE_OUTSIDE = """
host => document.getAnimations().filter(a => a.playState === 'running' && a.effect
    && a.effect.getTiming().iterations === Infinity && !(host && a.effect.target && host.contains(a.effect.target))).length
"""


class Relay:

    def __init__(self, target: tuple[str, int]):
        self.target = target
        self.up = True
        self.lock = threading.Lock()
        self.conns: list[socket.socket] = []
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(64)
        self.port = self.server.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        for _ in range(RELAY_MAX_CONNECTIONS):
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            if not self.up:
                client.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=10)
            except OSError:
                client.close()
                continue
            upstream.settimeout(None)
            with self.lock:
                self.conns += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        for _ in range(RELAY_MAX_CHUNKS):
            try:
                chunk = src.recv(65536)
            except OSError:
                chunk = b""
            if not chunk:
                break
            try:
                dst.sendall(chunk)
            except OSError:
                break
        for s in (src, dst):
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)

    def set_up(self, up: bool) -> None:
        self.up = up
        if not up:
            with self.lock:
                conns, self.conns = self.conns, []
            for s in conns:
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)
                with contextlib.suppress(OSError):
                    s.close()

    def close(self) -> None:
        self.set_up(False)
        with contextlib.suppress(OSError):
            self.server.shutdown(socket.SHUT_RDWR)
        self.server.close()


def endpoint_of(url: str) -> tuple[str, int]:
    parsed = urlparse(url)
    return parsed.hostname or "127.0.0.1", parsed.port or (443 if parsed.scheme == "https" else 80)


@contextlib.contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    app_dir = Path(DEPLOYED_APP)
    manifest = app_dir / "run.json"
    if not manifest.exists():
        manifest = Path("/app/run.json")
    serve = json.loads(manifest.read_text())["serve"]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=app_dir, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-3000:]

    def healthy() -> bool:
        if proc.poll() is not None:
            pytest.fail(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            return httpx.get(base + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        try:
            poll(healthy, COPY_BOOT_S, "app copy never answered GET /api/health")
        except BaseException:
            print(tail())
            raise
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, 15)
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, 9)


def test_signin_lands_on_first_workspace_explorer(browser: Browser, world: World) -> None:
    felix = world.person("felix")
    anon = Api(world.base)
    expect_error(anon.post("/api/session", {"email": felix["email"], "password": felix["password"] + "x"}), 401, {"error": SIGNIN_ERROR})
    r = anon.post("/api/session", {"email": felix["email"], "password": felix["password"]})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["user"] == {"id": felix["id"], "name": "Felix Navarro", "email": "felix.navarro@fernhill.test"}
    assert [ws["id"] for ws in body["workspaces"]] == [world.fern]
    assert body["workspaces"][0]["name"] == "Fernhill Labs" and body["workspaces"][0]["role"].lower() == "developer"
    assert "fs_session" in r.cookies
    assert anon.json("/api/me")["user"] == body["user"]

    explorer = f"{world.base}/w/{world.fern}/explorer"
    with open_as(browser, world.base, None, "/") as page:
        soon(page).to_have_url(re.compile(r"/signin$"))
        form = page.get_by_role("form", name="Sign in")
        email = form.get_by_role("textbox", name="Email")
        password = form.get_by_label("Password")
        fill(email, felix["email"])
        fill(password, felix["password"] + "x")
        password.press("Enter")
        wait_text(page, SIGNIN_ERROR)
        soon(page).to_have_url(re.compile(r"/signin$"))
        ready(email).focus()
        assert tab_order(page, 2) == ["Password", "Sign in"]
        fill(password, felix["password"])
        email.press("Enter")
        soon(page).to_have_url(explorer)
        page.reload()
        soon(page).to_have_url(explorer)
        soon(page.get_by_role("table", name="Blocks")).to_be_visible()
        page.goto(world.base + "/")
        soon(page).to_have_url(explorer)


def test_member_invite_single_use_link(browser: Browser, world: World, mail: Mailpit) -> None:
    mail.clear()
    amara = world.api("amara")
    _, email = unique("invitee")
    now = world.clock()
    inv = created(amara.post(world.w("/invites"), {"email": email, "role": "developer"}))
    assert inv["email"] == email and inv["role"] == "developer"
    assert iso(inv["expiresAt"]) == now + timedelta(hours=INVITE_TTL_HOURS)

    msgs = [m for m in mail.messages(expected=1) if email in addresses(m["To"])]
    assert len(msgs) == 1, f"expected one invite mail to {email}, got {len(msgs)}"
    assert msgs[0]["Subject"] == "Join Fernhill Labs on Fernsquare"
    assert mail_from_address() in addresses(msgs[0]["From"])
    found = re.search(r"/invites/([^\s<>\"')]+)", mail_text(msgs[0]))
    assert found, "invite mail body holds no /invites/<token> link"
    token = found.group(1)

    anon = Api(world.base)
    info = anon.json(f"/api/invites/{token}")
    assert info == {"workspaceName": "Fernhill Labs", "email": email, "role": "developer", "existingAccount": False} or (
        info["workspaceName"] == "Fernhill Labs" and info["email"] == email and info["role"] == "developer" and info["existingAccount"] is False
    )
    expect_field(anon.post(f"/api/invites/{token}/accept", {"name": "", "password": "fern-long-pass"}), "name", "Enter your name.")
    expect_field(anon.post(f"/api/invites/{token}/accept", {"name": "Ines Probe", "password": "short1"}), "password", "Password must be at least 8 characters.")
    assert anon.get(f"/api/invites/{token}").status_code == 200, "a refused accept used up the invite"

    with open_as(browser, world.base, None, f"/invites/{token}") as page:
        soon(page.get_by_role("heading", name="Join Fernhill Labs on Fernsquare")).to_be_visible()
        form = page.get_by_role("form", name="Accept invite")
        fill(form.get_by_role("textbox", name="Your name"), "Ines Probe")
        fill(form.get_by_label("Password"), "fern-" + uuid.uuid4().hex[:12])
        click(form.get_by_role("button", name="Accept invite"))
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/explorer")

    gone = {"error": "This invite link has already been used or has expired."}
    expect_error(anon.get(f"/api/invites/{token}"), 410, gone)
    expect_error(anon.post(f"/api/invites/{token}/accept", {"name": "Again", "password": "fern-long-pass"}), 410, gone)
    members = amara.json(world.w("/members"))
    assert [m["role"].lower() for m in members if m["email"] == email] == ["developer"]

    jonas = world.person("jonas")
    created(amara.post(world.w("/invites"), {"email": jonas["email"], "role": "viewer"}))
    jmsgs = poll(lambda: [m for m in mail.messages() if jonas["email"] in addresses(m["To"])], 30, "no invite mail to the existing account")
    jtoken = re.search(r"/invites/([^\s<>\"')]+)", mail_text(jmsgs[0])).group(1)
    assert anon.json(f"/api/invites/{jtoken}")["existingAccount"] is True
    expect_error(anon.post(f"/api/invites/{jtoken}/accept", {"name": "", "password": jonas["password"] + "x"}), 401, {"error": SIGNIN_ERROR})
    ok = anon.post(f"/api/invites/{jtoken}/accept", {"name": "", "password": jonas["password"]})
    assert ok.status_code == 200 and ok.json() == {"workspaceId": world.fern}, ok.text[:300]

    felix_email = world.person("felix")["email"]
    expect_error(amara.post(world.w("/invites"), {"email": felix_email, "role": "viewer"}), 409, {"error": f"{felix_email} is already a member of this workspace."})
    expect_field(amara.post(world.w("/invites"), {"email": "not-an-email", "role": "viewer"}), "email", "Enter a valid email address.")
    expect_field(amara.post(world.w("/invites"), {"email": unique("x")[1], "role": "owner"}), "role", "Choose Developer or Viewer.")
    assert len([m for m in mail.messages() if email in addresses(m["To"])]) == 1, "the invitee received more than one mail"


def test_workspace_isolation_answers_not_found(browser: Browser, world: World) -> None:
    jonas, amara = world.api("jonas"), world.api("amara")
    blob = world.data["blobs"]["block2"][2]
    wren = world.node("wren")
    reads = ["", "/namespaces", f"/blobs/{blob['id']}", f"/transactions/{blob['txId']}", "/blocks", "/blocks/2",
             "/blocks/2/shares", "/blocks/5/fraud-proof", "/light-nodes", "/proposals", "/proposals/3", "/members", "/validators"]
    for path in reads:
        expect_error(jonas.get(world.w(path)), 404, NOT_FOUND)
    expect_error(jonas.get(world.w(f"/light-nodes/{wren}/samples"), height=2), 404, NOT_FOUND)
    expect_error(jonas.post(world.w("/namespaces"), {"name": "Steal", "hex": fresh_hex()}), 404, NOT_FOUND)
    expect_error(jonas.patch(world.w(f"/light-nodes/{wren}"), {"autoSample": False}), 404, NOT_FOUND)
    expect_error(jonas.post(world.w("/proposals/3/votes"), {"option": "yes"}), 404, NOT_FOUND)
    expect_error(jonas.put(world.w("/producer"), {"nextBlock": "withhold"}), 404, NOT_FOUND)
    expect_error(jonas.get(world.w(f"/blobs/{blob['id']}", world.quarry)), 404, NOT_FOUND)
    expect_error(jonas.get(world.w(f"/transactions/{blob['txId']}", world.quarry)), 404, NOT_FOUND)
    expect_error(jonas.get(world.w(f"/light-nodes/{wren}/samples", world.quarry), height=2), 404, NOT_FOUND)
    expect_error(amara.get(world.w("/namespaces", world.quarry)), 404, NOT_FOUND)
    expect_error(amara.get(world.w(f"/light-nodes/{world.node('heron')}/samples", world.quarry), height=2), 404, NOT_FOUND)
    assert world.api("felix").json(world.w())["nextBlock"] == "honest"

    with open_as(browser, world.base, world.session("jonas"), f"/w/{world.fern}/explorer") as page:
        soon(page.get_by_role("heading", name="Not found")).to_be_visible()
        soon(page.get_by_role("table", name="Blocks")).to_have_count(0)
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/2")
        soon(page.get_by_role("heading", name="Not found")).to_be_visible()
        soon(grid(page, 2)).to_have_count(0)


def test_write_error_order_and_idempotency(world: World) -> None:
    path = world.w("/namespaces")
    bad = {"name": "", "hex": "zz"}
    expect_error(world.api().post(path, bad), 401, {"error": "Sign in to continue."})
    expect_error(world.api().post(f"/api/w/{uuid.uuid4()}/namespaces", bad), 401, {"error": "Sign in to continue."})
    expect_error(world.api("jonas").post(path, bad), 404, NOT_FOUND)
    expect_error(world.api("priya").post(path, bad), 403, {"error": VIEWER_COPY})
    felix = world.api("felix")
    expect_field(felix.post(path, {"name": "", "hex": HARBOR}), "name", "Give the namespace a name.")
    expect_error(felix.post(path, {"name": "Harbor again", "hex": HARBOR}), 409, {"error": f"Namespace {HARBOR} is already registered."})

    r = felix.client.post(path, content=b'{"name":"x"}', headers={"Content-Type": "text/plain"})
    expect_error(r, 415, {"error": "Send JSON."})
    base_body = json.dumps({"name": "", "hex": "zz", "pad": ""})
    exact = json.dumps({"name": "", "hex": "zz", "pad": "a" * (BODY_LIMIT - len(base_body))})
    assert len(exact.encode()) == BODY_LIMIT
    r = felix.client.post(path, content=exact.encode(), headers={"Content-Type": "application/json"})
    assert r.status_code == 422 and "hex" in r.json()["errors"], f"a {BODY_LIMIT}-byte body must be read: {r.status_code} {r.text[:200]}"
    over = json.dumps({"name": "", "hex": "zz", "pad": "a" * (BODY_LIMIT - len(base_body) + 1)})
    r = felix.client.post(path, content=over.encode(), headers={"Content-Type": "application/json"})
    expect_error(r, 413, {"error": "Request body is too large."})

    cedar = world.validator("cedar")
    key = idempotency_key()
    first = felix.post(world.w("/staking/delegate"), {"validator": cedar, "amount": "100"}, key)
    tx = created(first)
    assert tx["status"] == "pending" and tx["feeUfern"] == STAKING_FEE and tx["gas"] == STAKING_GAS
    assert {"id", "kind", "status", "feeUfern", "gas", "submittedAt"} <= set(tx)
    replay = felix.post(world.w("/staking/delegate"), {"validator": cedar, "amount": "100"}, key)
    assert replay.status_code == 201 and replay.json() == tx
    expect_error(felix.post(world.w("/staking/delegate"), {"validator": cedar, "amount": "101"}, key), 409,
                 {"error": "This idempotency key was used for a different request."})
    assert staking_me(felix, world)["availableUfern"] == 5_000 * UFERN - 100 * UFERN - STAKING_FEE
    assert world.api("felix").get("/api/no-such-route").status_code == 404


def test_grading_routes_and_health(app_url: str) -> None:
    h = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert h.status_code == 200 and h.json() == {"status": "ok"}
    for route in ("/api/grading/seed", "/api/grading/reset", "/api/grading/clock"):
        assert httpx.post(app_url + route, json={"advanceMs": 0}, timeout=HTTP_TIMEOUT).status_code == 404
        assert grading(app_url, route, {"advanceMs": 0}, key="wrong-" + grading_key()).status_code == 404

    data = seed(app_url)
    assert iso(data["clock"]) == at_block(5)
    assert set(data["workspaces"]) == {"fernhill", "quarry"}
    assert set(data["people"]) == {"amara", "felix", "priya", "jonas"}
    for person in data["people"].values():
        assert set(person) >= {"id", "name", "email", "password", "session"} and isinstance(person["id"], str)
    assert set(data["namespaces"]) == {"orchard", "harbor", "lantern", "quarryMain"}
    assert set(data["lightNodes"]) == {"wren", "kestrel", "heron"}
    assert set(data["validators"]["fernhill"]) == set(data["validators"]["quarry"]) == {"alder", "birch", "cedar", "dogwood"}
    assert [(b["namespace"], b["size"]) for b in data["blobs"]["block2"]] == [(ORCHARD, 60), (ORCHARD, 10), (HARBOR, 120), (LANTERN, 20)]
    assert [len(data["blobs"][k]) for k in ("block3", "block4", "block5")] == [1, 1, 1]
    assert [(b["namespace"], b["size"]) for b in data["blobs"]["mempool"]] == [(ORCHARD, 300), (LANTERN, 200)]
    assert [data["proposals"][str(n)]["number"] for n in range(1, 8)] == list(range(1, 8))
    w = World(app_url, data)

    for value in (-1, MAX_ADVANCE_MS + 1, 1.5, "1000", None):
        expect_field(grading(app_url, "/api/grading/clock", {"advanceMs": value}), "advanceMs",
                     "Give a whole number of milliseconds from 0 to 86400000.")
    expect_field(grading(app_url, "/api/grading/clock", {}), "advanceMs", "Give a whole number of milliseconds from 0 to 86400000.")
    r = w.advance(0)
    assert iso(r["clock"]) == at_block(5) and r["heights"] == {w.fern: 5, w.quarry: 5}
    r = w.advance(BLOCK_MS)
    assert r["heights"] == {w.fern: 6, w.quarry: 6}

    reset = grading(app_url, "/api/grading/reset")
    assert reset.status_code == 200 and iso(reset.json()["clock"]) == APP_START
    expect_error(w.api("felix").get("/api/me"), 401, {"error": "Sign in to continue."})
    felix = data["people"]["felix"]
    expect_error(Api(app_url).post("/api/session", {"email": felix["email"], "password": felix["password"]}), 401, {"error": SIGNIN_ERROR})


def test_seeded_network_matches_brief(app_url: str, mail: Mailpit) -> None:
    seed(app_url)
    mail.clear()
    w = World(app_url, seed(app_url))
    d = w.data
    assert d["workspaces"]["fernhill"]["name"] == "Fernhill Labs" and d["workspaces"]["quarry"]["name"] == "Quarry Labs"
    roles = {"amara": (w.fern, "owner"), "felix": (w.fern, "developer"), "priya": (w.fern, "viewer"), "jonas": (w.quarry, "owner")}
    for key, (name, email) in PEOPLE.items():
        assert (d["people"][key]["name"], d["people"][key]["email"]) == (name, email)
        me = w.api(key).json("/api/me")
        assert [(ws["id"], ws["role"].lower()) for ws in me["workspaces"]] == [roles[key]]
        ws = roles[key][0]
        assert staking_me(w.api(key), w if ws == w.fern else w)["balanceUfern"] if ws == w.fern else True
        bal = w.api(key).json(w.w("/staking/me", ws))["balanceUfern"]
        assert bal == BALANCES[key] * UFERN, f"{key} liquid balance {bal}"
    assert staking_me(w.api("amara"), w)["availableUfern"] == ufern_of("1,999.986487")
    names = {(n["name"], n["hex"]) for n in d["namespaces"].values()}
    assert names == {("Orchard", ORCHARD), ("Harbor", HARBOR), ("Lantern", LANTERN), ("Quarry main", QUARRY_MAIN)}
    felix = w.api("felix")
    counts = {n["name"]: n["blobCount"] for n in felix.json(w.w("/namespaces"))}
    assert counts == {"Orchard": 2, "Harbor": 1, "Lantern": 2}
    assert [n["blobCount"] for n in w.api("jonas").json(w.w("/namespaces", w.quarry))] == [0]

    vals = {v["name"]: v for v in felix.json(w.w("/validators"))}
    for name, selfstake, commission, share, stake in VALIDATORS.values():
        v = vals[name]
        assert v["selfStakeUfern"] == selfstake * UFERN and v["stakeUfern"] == stake * UFERN
        assert Decimal(v["commission"]) == Decimal(commission) and v["shareOfBonded"] == share
    qvals = {v["name"]: v for v in w.api("jonas").json(w.w("/validators", w.quarry))}
    assert {n: v["stakeUfern"] for n, v in qvals.items()} == {v[0]: v[1] * UFERN for v in VALIDATORS.values()}
    delegs = {k: [(x["validatorName"], x["amountUfern"], x["pendingRewardsUfern"]) for x in w.api(k).json(w.w("/staking/me"))["delegations"]] for k in ("amara", "felix")}
    assert delegs == {"amara": [("Alder", 500 * UFERN, 0)], "felix": [("Birch", 300 * UFERN, 0)]}

    blocks = felix.json(w.w("/blocks"))
    assert [b["height"] for b in blocks] == [5, 4, 3, 2, 1]
    assert [b["squareWidth"] for b in blocks] == [2, 4, 2, 4, 1]
    assert [b["blobs"] for b in blocks] == [1, 1, 1, 4, 0]
    assert [b["status"] for b in blocks] == ["rejected", "rejected", "available", "available", "available"]
    assert [iso(b["producedAt"]) for b in blocks] == [at_block(h) for h in (5, 4, 3, 2, 1)]
    rej4 = block(felix, w, 4)["rejection"]
    assert (rej4["reason"], rej4["node"], rej4["nodeName"], rej4["row"], rej4["col"]) == ("withheld", w.node("wren"), "Wren", 6, 5)
    rej5 = block(felix, w, 5)["rejection"]
    assert (rej5["reason"], rej5["axis"], rej5["index"]) == ("bad-encoding", "row", 0)

    for item in d["blobs"]["block2"]:
        assert felix.json(w.w(f"/blobs/{item['id']}"))["statusText"] == "Included in block 2"
    assert felix.json(w.w(f"/blobs/{d['blobs']['block4'][0]['id']}"))["statusText"] == "Rejected — block 4 was rejected"
    mem = felix.json(w.w("/mempool"))
    assert mem["count"] == 2
    for item, body in zip(d["blobs"]["mempool"], (b"q" * 300, b"r" * 200)):
        assert felix.json(w.w(f"/blobs/{item['id']}"))["statusText"] == "Pending"
        assert S3().get(f"blobs/{item['id']}") == body
    keys = S3().keys(f"squares/{w.fern}/")
    assert {f"squares/{w.fern}/{h}.bin" for h in range(1, 6)} <= set(keys)

    nodes = {n["name"]: n for n in felix.json(w.w("/light-nodes"))}
    assert (nodes["Wren"]["number"], nodes["Wren"]["autoSample"]) == (1, True)
    assert (nodes["Kestrel"]["number"], nodes["Kestrel"]["autoSample"]) == (2, False)
    assert [n["name"] for n in w.api("jonas").json(w.w("/light-nodes", w.quarry))] == ["Heron"]
    assert samples(felix, w, w.node("kestrel"), 2)["samples"] == []

    for n, (title, status) in PROPOSALS.items():
        p = felix.json(w.w(f"/proposals/{n}"))
        assert (p["title"], p["statusText"]) == (title, status), f"proposal {n}"
    p3, p4 = felix.json(w.w("/proposals/3")), felix.json(w.w("/proposals/4"))
    assert iso(p3["votingEndsAt"]) == VOTING_END_3 and p3["myVote"] is None
    assert (p4["depositUfern"], p4["minDepositUfern"], iso(p4["depositEndsAt"])) == (40 * UFERN, 100 * UFERN, DEPOSIT_END_4)
    members = {m["email"]: m["role"].lower() for m in felix.json(w.w("/members"))}
    assert members == {PEOPLE["amara"][1]: "owner", PEOPLE["felix"][1]: "developer", PEOPLE["priya"][1]: "viewer"}
    seeded = {e for _, e in PEOPLE.values()}
    assert not [m for m in mail.messages() if set(addresses(m["To"])) & seeded], "the seed sent mail"


def test_block_clock_and_event_order(world: World) -> None:
    assert world.advance(BLOCK_MS - 1)["heights"] == {world.fern: 5, world.quarry: 5}
    assert world.advance(1)["heights"] == {world.fern: 6, world.quarry: 6}
    assert world.advance(2 * BLOCK_MS)["heights"] == {world.fern: 8, world.quarry: 8}
    felix = world.api("felix")
    blocks = felix.json(world.w("/blocks"))
    assert [b["height"] for b in blocks] == [8, 7, 6, 5, 4, 3, 2, 1]
    assert [iso(b["producedAt"]) for b in blocks[:3]] == [at_block(8), at_block(7), at_block(6)]
    qblocks = world.api("jonas").json(world.w("/blocks", world.quarry))
    assert [b["height"] for b in qblocks] == [8, 7, 6, 5, 4, 3, 2, 1]
    assert iso(qblocks[1]["producedAt"]) == at_block(7)

    amara = world.api("amara")
    assert amara.put(world.w("/producer"), {"nextBlock": "bad-encoding"}).status_code == 200
    world.advance_to(at_block(9))
    world.advance(FRAUD_DELAY_MS)
    wren9 = samples(felix, world, world.node("wren"), 9)["samples"]
    assert len(wren9) == FRAUD_DELAY_MS // SAMPLE_INTERVAL_MS, "Wren's sample due with the fraud check must run first (L382-L383)"
    assert block(felix, world, 9)["status"] == "rejected"
    world.advance(FRAUD_DELAY_MS)
    assert len(samples(felix, world, world.node("wren"), 9)["samples"]) == FRAUD_DELAY_MS // SAMPLE_INTERVAL_MS


def test_wf_submit_refusals_role_limits(browser: Browser, world: World) -> None:
    priya, felix = world.api("priya"), world.api("felix")
    hex_ = fresh_hex()
    _, invitee = unique("roles")
    expect_error(priya.post(world.w("/namespaces"), {"name": "Viewer try", "hex": hex_}), 403, {"error": VIEWER_COPY})
    expect_error(priya.post(world.w("/namespaces"), {"name": "", "hex": "zz"}), 403, {"error": VIEWER_COPY})
    expect_error(priya.put(world.w("/producer"), {"nextBlock": "withhold"}), 403, {"error": VIEWER_COPY})
    expect_error(priya.post(world.w("/invites"), {"email": invitee, "role": "viewer"}), 403, {"error": VIEWER_COPY})
    expect_error(priya.post(world.w("/staking/delegate"), {"validator": world.validator("cedar"), "amount": "1"}), 403, {"error": VIEWER_COPY})
    expect_error(take_sample(priya, world, world.node("kestrel"), 2), 403, {"error": VIEWER_COPY})
    expect_error(priya.patch(world.w(f"/light-nodes/{world.node('kestrel')}"), {"autoSample": True}), 403, {"error": VIEWER_COPY})
    expect_error(priya.post(world.w("/proposals/3/votes"), {"option": "yes"}), 403, {"error": VIEWER_COPY})
    expect_error(felix.put(world.w("/producer"), {"nextBlock": "withhold"}), 403, {"error": OWNER_PRODUCER_COPY})
    expect_error(felix.post(world.w("/invites"), {"email": invitee, "role": "viewer"}), 403, {"error": OWNER_MEMBERS_COPY})
    assert priya.get(world.w("/blocks/2/snapshot")).status_code == 200
    assert priya.get(world.w("/blocks/2/proofs"), namespace=HARBOR).status_code == 200
    assert hex_ not in [n["hex"] for n in felix.json(world.w("/namespaces"))]
    assert felix.json(world.w())["nextBlock"] == "honest"
    assert samples(felix, world, world.node("kestrel"), 2)["samples"] == []
    assert invitee not in [m["email"] for m in felix.json(world.w("/members"))]

    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer") as page:
        group = page.get_by_role("radiogroup", name="Next block")
        for label in ("Honest", "Withhold shares", "Bad encoding"):
            radio = group.get_by_role("radio", name=label)
            soon(radio).to_be_disabled()
            described(radio, group, OWNER_PRODUCER_COPY)
        page.goto(f"{world.base}/w/{world.fern}/members")
        send = page.get_by_role("form", name="Invite member").get_by_role("button", name="Send invite")
        soon(send).to_be_disabled()
        described(send, None, OWNER_MEMBERS_COPY)
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/submit") as page:
        for form_name, button in (("Submit blob", "Submit blob"), ("Register namespace", "Register namespace")):
            control = page.get_by_role("form", name=form_name).get_by_role("button", name=button)
            soon(control).to_be_disabled()
            described(control, None, VIEWER_COPY)
        page.goto(f"{world.base}/w/{world.fern}/explorer")
        group = page.get_by_role("radiogroup", name="Next block")
        radio = group.get_by_role("radio", name="Withhold shares")
        soon(radio).to_be_disabled()
        described(radio, group, VIEWER_COPY)


def test_namespace_registration_rules(world: World) -> None:
    felix, jonas, amara = world.api("felix"), world.api("jonas"), world.api("amara")
    path = world.w("/namespaces")
    cases = [
        ("zz", "hex", "Namespace must use only the characters 0-9 and a-f."),
        ("00000000000000a1", "hex", "Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has 16."),
        ("01000000000000a100", "hex", "Only namespace version 00 is open to users."),
        (PADDING_NS, "hex", "Only namespace version 00 is open to users."),
        ("000000000000000004", "hex", "Namespace 000000000000000004 is reserved."),
        ("0000000000000000FF", "hex", "Namespace 0000000000000000ff is reserved."),
        ("000000000000000001", "hex", "Namespace 000000000000000001 is reserved."),
    ]
    for hex_, field, message in cases:
        expect_field(felix.post(path, {"name": "", "hex": hex_}), field, message)
    hex_ = fresh_hex()
    expect_field(felix.post(path, {"name": "", "hex": hex_}), "name", "Give the namespace a name.")
    probe_name = "Probe space"
    made = created(felix.post(path, {"name": probe_name, "hex": hex_.upper()}))
    assert made["hex"] == hex_ and made["name"] == probe_name
    assert [n["hex"] for n in felix.json(path)].count(hex_) == 1
    expect_error(jonas.post(world.w("/namespaces", world.quarry), {"name": "Copy", "hex": hex_}), 409, {"error": f"Namespace {hex_} is already registered."})
    expect_error(jonas.post(world.w("/namespaces", world.quarry), {"name": "Harbor clone", "hex": HARBOR}), 409, {"error": f"Namespace {HARBOR} is already registered."})

    race = fresh_hex()
    racers = [(felix, world.fern), (amara, world.fern), (jonas, world.quarry)] * 3

    def register(i: int) -> httpx.Response:
        api, ws = racers[i]
        return api.post(world.w("/namespaces", ws), {"name": f"Race {i}", "hex": race})

    with ThreadPoolExecutor(len(racers)) as pool:
        results = list(pool.map(register, range(len(racers))))
    winners = [r for r in results if r.status_code == 201]
    assert len(winners) == 1, f"expected exactly one 201, got {[r.status_code for r in results]}"
    for r in results:
        if r.status_code != 201:
            expect_error(r, 409, {"error": f"Namespace {race} is already registered."})
    listed = [n["hex"] for n in felix.json(path)] + [n["hex"] for n in jonas.json(world.w("/namespaces", world.quarry))]
    assert listed.count(race) == 1


def test_wf_submit_refusals_namespace_form(browser: Browser, world: World) -> None:
    hex_ = fresh_hex()
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        form = page.get_by_role("form", name="Register namespace")
        name = form.get_by_role("textbox", name="Namespace name")
        hexbox = form.get_by_role("textbox", name="Namespace hex")
        form_name = "Form space"
        fill(name, form_name)
        fill(hexbox, "01" + hex_[2:])
        hexbox.press("Enter")
        soon(form.get_by_role("alert")).to_contain_text("Only namespace version 00 is open to users.")
        soon(hexbox).to_have_accessible_description(re.compile("Only namespace version 00 is open to users."))
        soon(hexbox).to_be_focused()
        assert hex_ not in [n["hex"] for n in world.api("felix").json(world.w("/namespaces"))]
        fill(hexbox, hex_)
        hexbox.press("Enter")
        said(form, "Register namespace status", f"Namespace {form_name} registered.")
    assert [(n["name"], n["hex"]) for n in world.api("amara").json(world.w("/namespaces")) if n["hex"] == hex_] == [("Form space", hex_)]


def test_blob_refusals_in_order(world: World) -> None:
    felix = world.api("felix")
    before_ids = sorted(b["id"] for b in felix.json(world.w("/blobs"), mine="true"))
    path = world.w("/blobs")
    expect_field(felix.post(path, {"namespace": "", "dataBase64": "", "fee": "x"}), "namespace", "Choose a namespace.")
    expect_field(felix.post(path, {"namespace": HARBOR, "dataBase64": "", "fee": "x"}), "data", "A blob must contain at least 1 byte.")
    big = b"z" * (MAX_BLOB + 1)
    expect_field(felix.post(path, {"namespace": HARBOR, "dataBase64": b64(big), "fee": "x"}), "data",
                 f"This blob is {MAX_BLOB + 1:,} bytes; a block holds at most 3,452 bytes of blob data.")
    expect_field(felix.post(path, {"namespace": HARBOR, "dataBase64": b64(b"z" * 200), "fee": "0.0000001"}), "fee",
                 "Fee must be an amount in FERN with at most 6 decimals.")
    expect_field(felix.post(path, {"namespace": HARBOR, "dataBase64": b64(b"z" * 200), "fee": "0.006704"}), "fee",
                 "Fee too low: this blob needs at least 0.006705 FERN.")
    expect_field(felix.post(path, {"namespace": HARBOR, "dataBase64": b64(b"z"), "fee": "5000.000001"}), "fee",
                 "Insufficient balance: available 5,000.000000 FERN, this blob needs 5,000.000001 FERN.")
    assert sorted(b["id"] for b in felix.json(world.w("/blobs"), mine="true")) == before_ids
    assert staking_me(felix, world)["availableUfern"] == 5_000 * UFERN

    fee = 1_500 * UFERN

    def send(i: int) -> httpx.Response:
        return felix.post(path, {"namespace": HARBOR, "dataBase64": b64(bytes([i + 1])), "fee": fern(fee)})

    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(send, range(5)))
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 201, 201, 422, 422], f"expected three 201 and two 422, got {codes}"
    for r in results:
        if r.status_code == 422:
            expect_field(r, "fee", f"Insufficient balance: available {shown(5_000 * UFERN - 3 * fee)} FERN, this blob needs {shown(fee)} FERN.")
    assert staking_me(felix, world)["availableUfern"] == 5_000 * UFERN - 3 * fee


def test_wf_submit_refusals_blob_form(browser: Browser, world: World) -> None:
    db = Postgres()
    felix_id = world.person("felix")["id"]
    entries_before = account_sum(db, world.fern, f"member:{felix_id}")
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        form = page.get_by_role("form", name="Submit blob")
        data = form.get_by_role("textbox", name="Data")
        fee = form.get_by_role("textbox", name="Fee (FERN)")
        fill(data, "refused blob")
        if not form.get_by_role("combobox", name="Namespace").input_value():
            ready(fee).focus()
            fee.press("Enter")
            soon(form.get_by_role("alert")).to_contain_text("Choose a namespace.")
            soon(form.get_by_role("combobox", name="Namespace")).to_be_focused()
        select(form.get_by_role("combobox", name="Namespace"), "Harbor")
        fill(fee, "0.0000001")
        fee.press("Enter")
        soon(form.get_by_role("alert")).to_contain_text("Fee must be an amount in FERN with at most 6 decimals.")
        soon(fee).to_be_focused()
        soon(fee).to_have_accessible_description(re.compile("Fee must be an amount in FERN with at most 6 decimals."))
        fill(fee, "0.000001")
        fee.press("Enter")
        soon(form.get_by_role("alert")).to_contain_text("Fee too low: this blob needs at least 0.006552 FERN.")
    felix = world.api("felix")
    assert not [b for b in felix.json(world.w("/blobs"), mine="true") if b["statusText"] == "Pending"]
    assert staking_me(felix, world)["availableUfern"] == 5_000 * UFERN
    assert account_sum(db, world.fern, f"member:{felix_id}") == entries_before


def test_wf_blob_submit_live_readouts(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        form = page.get_by_role("form", name="Submit blob")
        data = form.get_by_role("textbox", name="Data")
        estimate = form.get_by_role("region", name="Blob estimate")
        fee = form.get_by_role("textbox", name="Fee (FERN)")
        for size in (1, 120, 200):
            shares, gas, ufern = FEE_TABLE[size]
            if size > 1:
                fill(data, "h" * (size - 1))
            else:
                fill(data, "")
            ready(data).press_sequentially("h")
            soon(estimate).to_contain_text(f"Size {size} bytes")
            soon(estimate).to_contain_text(f"Shares {shares}")
            soon(estimate).to_contain_text(re.compile(rf"Gas {gas // 1000},?{gas % 1000:03d}"))
            soon(estimate).to_contain_text(f"Fee {shown(ufern)} FERN")
            soon(fee).to_have_value(re.compile(rf"^{re.escape(fern(ufern))}$|^{re.escape(fern(ufern).rstrip('0'))}$"))
        fill(fee, "1")
        data.press("Backspace")
        soon(estimate).to_contain_text(f"Size {size - 1} bytes")
        soon(fee).to_have_value("1")


def test_wf_blob_submit_live_fee_hold(browser: Browser, world: World) -> None:
    felix = world.api("felix")
    for size, (shares, gas, ufern) in FEE_TABLE.items():
        assert felix.json(world.w("/fee-estimate"), bytes=size) == {"size": size, "shares": shares, "gas": gas, "feeUfern": ufern}
    assert felix.json(world.w("/staking/fee")) == {"gas": STAKING_GAS, "feeUfern": STAKING_FEE}
    _, gas, ufern = FEE_TABLE[200]
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        wait_text(page, "Available 5,000.000000 FERN")
        form = page.get_by_role("form", name="Submit blob")
        select(form.get_by_role("combobox", name="Namespace"), "Harbor")
        fill(form.get_by_role("textbox", name="Data"), "k" * 200)
        form.get_by_role("textbox", name="Fee (FERN)").press("Enter")
        said(form, "Submit blob status", "Blob submitted. It is pending until a block includes it.")
        wait_text(page, f"Available {shown(5_000 * UFERN - ufern)} FERN")
    me = staking_me(felix, world)
    assert (me["balanceUfern"], me["availableUfern"]) == (5_000 * UFERN, 5_000 * UFERN - ufern)
    mine = [b for b in felix.json(world.w("/blobs"), mine="true") if b["status"] == "pending"]
    assert len(mine) == 1 and (mine[0]["size"], mine[0]["shares"], mine[0]["gas"], mine[0]["feeUfern"]) == (200, 4, gas, ufern)
    world.advance(BLOCK_MS)
    assert felix.json(world.w(f"/blobs/{mine[0]['id']}"))["statusText"] == "Included in block 6"
    me = staking_me(felix, world)
    assert (me["balanceUfern"], me["availableUfern"]) == (5_000 * UFERN - ufern, 5_000 * UFERN - ufern)
    entries = ledger(felix, world, f"member:{world.person('felix')['id']}")["entries"]
    fees = [e for e in entries if e["label"] == "Fee" and e["height"] == 6]
    assert [(e["amountUfern"], e["counterAccount"]) for e in fees] == [(-ufern, "burn")]
    assert_ledger_balanced(Postgres(), world.fern)


def test_blob_object_byte_exact(world: World) -> None:
    felix = world.api("felix")
    payload = bytes(range(256)) * 2
    tx = created(submit_blob(felix, world, ORCHARD, payload))
    assert tx["size"] == len(payload) and tx["shares"] == 1 + -(-(len(payload) - 50) // 54)
    assert S3().get(f"blobs/{tx['blobId']}") == payload
    got = felix.json(world.w(f"/blobs/{tx['blobId']}"))
    assert got["status"] == "pending" and got["txId"] == tx["id"]


@pytest.fixture
def storage_down() -> Iterator[World]:
    relay = Relay(endpoint_of(os.environ.get("S3_ENDPOINT") or pytest.fail("S3_ENDPOINT is not set in the verifier")))
    try:
        with scratch_database() as scratch, app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}", "DATABASE_URL": scratch}) as base:
            w = World(base, seed(base))
            relay.set_up(False)
            poll(lambda: httpx.get(base + "/api/health", timeout=10).json().get("status") == "unavailable",
                 STORAGE_RECHECK_S + 10, "health never reported unavailable")
            yield w
    finally:
        relay.close()


@pytest.mark.timeout(900)
def test_failed_storage_write_leaves_nothing(storage_down: World) -> None:
    w = storage_down
    felix = w.api("felix")
    blobs_before = sorted(b["id"] for b in felix.json(w.w("/blobs"), mine="true"))
    txs_before = sorted(t["id"] for t in felix.json(w.w("/transactions"), mine="true"))
    me_before = staking_me(felix, w)
    r = submit_blob(felix, w, HARBOR, b"never stored")
    expect_error(r, 503, {"error": SUBMIT_DOWN})
    assert sorted(b["id"] for b in felix.json(w.w("/blobs"), mine="true")) == blobs_before
    assert sorted(t["id"] for t in felix.json(w.w("/transactions"), mine="true")) == txs_before
    me_after = staking_me(felix, w)
    assert (me_after["availableUfern"], me_after["heldUfern"]) == (me_before["availableUfern"], me_before["heldUfern"])
    assert felix.json(w.w("/mempool"))["count"] == 2


def test_wf_blob_submit_live_happy(browser: Browser, world: World) -> None:
    payload = b"f" * 200
    with open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer", device_time=WRONG_DEVICE_TIME) as amara_page, \
            open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit", device_time=WRONG_DEVICE_TIME) as page:
        wait_text(amara_page, "Mempool 2 blobs")
        form = page.get_by_role("form", name="Submit blob")
        select(form.get_by_role("combobox", name="Namespace"), "Harbor")
        fill(form.get_by_role("textbox", name="Data"), payload.decode())
        form.get_by_role("textbox", name="Fee (FERN)").press("Enter")
        said(form, "Submit blob status", "Blob submitted. It is pending until a block includes it.")
        soon(page.get_by_role("table", name="Your blobs")).to_contain_text("Pending")
        wait_text(amara_page, "Mempool 3 blobs", LIVE_DEADLINE_S)
        felix = world.api("felix")
        mine = [b for b in felix.json(world.w("/blobs"), mine="true") if b["status"] == "pending"]
        assert len(mine) == 1
        assert S3().get(f"blobs/{mine[0]['id']}") == payload
        world.advance(BLOCK_MS)
        wait_text(amara_page, "Block 6 produced: 3 blobs, square 4 × 4.", LIVE_DEADLINE_S)
        expect(amara_page.get_by_role("status", name="Network updates")).to_contain_text("Block 6 produced: 3 blobs, square 4 × 4.")
        expect(amara_page.get_by_role("table", name="Blocks").get_by_role("link", name="6", exact=True)).to_be_visible()
        until(page, "() => document.body.innerText.includes('Included in block 6')", None, LIVE_DEADLINE_S)
        expect(page.get_by_role("table", name="Your blobs")).to_contain_text("Included in block 6")
    blob = world.api("felix").json(world.w(f"/blobs/{mine[0]['id']}"))
    assert (blob["status"], blob["statusText"], blob["height"]) == ("included", "Included in block 6", 6)
    assert [tuple(p) for p in blob["positions"]] == [(1, 2), (1, 3), (2, 0), (2, 1)]
    b6 = world.api("amara").json(world.w("/blocks"))[0]
    assert (b6["height"], b6["blobs"], b6["squareWidth"]) == (6, 3, 4)


def test_live_network_updates(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer") as page:
        stats = page.get_by_role("region", name="Network stats")
        soon(stats).to_contain_text("5 blocks")
        soon(stats).to_contain_text("Current height")
        soon(stats).to_contain_text("Latest square")
        soon(stats).to_contain_text("Included today")
        soon(stats).to_contain_text(re.compile(r"2\s*×\s*2 shares"))
        soon(stats).to_contain_text("5 blobs")
        wait_text(page, "Mempool 2 blobs")
        world.advance(BLOCK_MS)
        wait_text(page, "Block 6 produced: 2 blobs, square 4 × 4.", LIVE_DEADLINE_S)
        expect(page.get_by_role("status", name="Network updates")).to_contain_text("Block 6 produced: 2 blobs, square 4 × 4.")
        wait_text(page, "Mempool 0 blobs", LIVE_DEADLINE_S)
        expect(stats).to_contain_text("6 blocks")
        expect(stats).to_contain_text(re.compile(r"4\s*×\s*4 shares"))
        expect(page.get_by_role("table", name="Blocks").get_by_role("link", name="6", exact=True)).to_be_visible()


def test_share_encoding(world: World) -> None:
    felix = world.api("felix")
    k2, g2 = share_grid(felix, world, 2)
    assert k2 == 4
    assert g2[0][0].hex() == "00000000000000a100010000003c" + "6f" * 50
    assert g2[0][2].hex() == "00000000000000a100010000000a" + "70" * 10 + "00" * 40
    expected2 = original_square([(ORCHARD, b"o" * 60), (ORCHARD, b"p" * 10), (HARBOR, b"h" * 120), (LANTERN, b"l" * 20)])
    assert [row[:4] for row in g2[:4]] == expected2
    k1, g1 = share_grid(felix, world, 1)
    assert k1 == 1 and g1[0][0] == PADDING_SHARE
    _, g3 = share_grid(felix, world, 3)
    assert g3[0][0].hex() == BLOCK3_SHARES[(0, 0)] and g3[0][1].hex() == BLOCK3_SHARES[(0, 1)]
    assert [row[:2] for row in g3[:2]] == original_square([(LANTERN, BLOCK3_TEXT)])

    created(submit_blob(felix, world, LANTERN, b"\x07"))
    world.advance(BLOCK_MS)
    k6, g6 = share_grid(felix, world, 6)
    expected6 = original_square([(ORCHARD, b"q" * 300), (LANTERN, b"r" * 200), (LANTERN, b"\x07")])
    assert k6 == len(expected6) == 4
    assert [row[:4] for row in g6[:4]] == expected6
    assert g6[2][2].hex() == LANTERN + "01" + "00000001" + "07" + "00" * 49


def test_square_layout_stop_rule(world: World) -> None:
    felix = world.api("felix")
    big = created(submit_blob(felix, world, HARBOR, b"B" * MAX_BLOB))
    small = created(submit_blob(felix, world, ORCHARD, b"s"))
    world.advance(BLOCK_MS)
    b6 = block(felix, world, 6)
    assert b6["squareWidth"] == 4 and len(b6["blobs"]) == 2
    assert {b["id"] for b in b6["blobs"]} == {x["id"] for x in world.data["blobs"]["mempool"]}
    assert felix.json(world.w(f"/blobs/{big['blobId']}"))["status"] == "pending"
    assert felix.json(world.w(f"/blobs/{small['blobId']}"))["status"] == "pending"
    world.advance(BLOCK_MS)
    b7 = block(felix, world, 7)
    assert b7["squareWidth"] == 8 and [b["id"] for b in b7["blobs"]] == [big["blobId"]]
    assert [tuple(p) for p in felix.json(world.w(f"/blobs/{big['blobId']}"))["positions"]] == [(r, c) for r in range(8) for c in range(8)]
    world.advance(BLOCK_MS)
    assert [b["id"] for b in block(felix, world, 8)["blobs"]] == [small["blobId"]]
    assert felix.json(world.w(f"/blobs/{small['blobId']}"))["statusText"] == "Included in block 8"


def test_wf_square_layout_new_block(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        form = page.get_by_role("form", name="Submit blob")
        select(form.get_by_role("combobox", name="Namespace"), "Harbor")
        fill(form.get_by_role("textbox", name="Data"), "m" * 200)
        form.get_by_role("textbox", name="Fee (FERN)").press("Enter")
        said(form, "Submit blob status", "Blob submitted. It is pending until a block includes it.")
        world.advance(BLOCK_MS)
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/6")
        soon(grid(page, 6)).to_be_visible()
        for r, c in ((1, 2), (1, 3), (2, 0), (2, 1)):
            target = page.get_by_role("gridcell", name=f"Share {r}, {c}: Harbor", exact=True)
            soon(target).to_have_attribute("data-mine", "true")
            soon(target).to_have_attribute("data-kind", "blob")
        lantern = page.get_by_role("gridcell", name="Share 2, 2: Lantern", exact=True)
        soon(lantern).not_to_have_attribute("data-mine", "true")
        soon(page.get_by_role("gridcell", name="Share 3, 3: Padding", exact=True)).to_have_attribute("data-kind", "padding")
        soon(page.get_by_role("table", name="Blobs in this block").get_by_role("link")).to_have_count(3)
    felix = world.api("felix")
    k, g = share_grid(felix, world, 6)
    snap = S3().get(f"squares/{world.fern}/6.bin")
    assert len(snap) == (2 * k) ** 2 * 64
    for r in range(2 * k):
        for c in range(2 * k):
            off = (r * 2 * k + c) * 64
            assert snap[off : off + 64] == g[r][c], f"snapshot share ({r}, {c}) differs from the stored layout"


def test_wf_square_layout_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2") as page:
        g = grid(page, 2)
        soon(g.get_by_role("row")).to_have_count(8)
        soon(g.get_by_role("gridcell")).to_have_count(64)
        first = page.get_by_role("gridcell", name="Share 0, 0: Orchard", exact=True)
        attrs = {"data-row": "0", "data-col": "0", "data-quadrant": "Q0", "data-namespace": ORCHARD, "data-kind": "blob",
                 "data-share": "00000000000000a100010000003c" + "6f" * 50, "data-mine": "true"}
        for name, value in attrs.items():
            soon(first).to_have_attribute(name, value)
        pad = page.get_by_role("gridcell", name="Share 1, 3: Padding", exact=True)
        soon(pad).to_have_attribute("data-namespace", PADDING_NS)
        soon(pad).to_have_attribute("data-kind", "padding")
        q1 = page.get_by_role("gridcell", name="Share 0, 4: Parity", exact=True)
        soon(q1).to_have_attribute("data-quadrant", "Q1")
        soon(q1).to_have_attribute("data-namespace", PARITY_NS_HEX)
        soon(page.get_by_role("gridcell", name="Share 4, 0: Parity", exact=True)).to_have_attribute("data-quadrant", "Q2")
        soon(page.get_by_role("gridcell", name="Share 4, 4: Parity", exact=True)).to_have_attribute("data-quadrant", "Q3")
        assert g.evaluate("g => [...g.querySelectorAll('[data-col]')].filter(c => c.tabIndex === 0).length") == 1
        ready(first).focus()
        for key, (r, c) in (("ArrowRight", (0, 1)), ("ArrowDown", (1, 1)), ("End", (1, 7)), ("Home", (1, 0)),
                            ("Control+End", (7, 7)), ("ArrowRight", (7, 7)), ("ArrowDown", (7, 7)),
                            ("Control+Home", (0, 0)), ("ArrowUp", (0, 0)), ("ArrowLeft", (0, 0))):
            page.keyboard.press(key)
            soon(cell(page, r, c)).to_be_focused()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=f"Share {0}, {0}")
        soon(dialog).to_be_visible()
        body = norm(dialog.inner_text()).lower()
        for line in (f"namespace {ORCHARD}", "info byte 01", "sequence length 60 bytes", "data " + "6f" * 50):
            assert line in body, f"share panel lacks {line!r}"
        soon(dialog.get_by_role("button", name="Close")).to_be_visible()
        for _ in range(4):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)"), "Tab left the share panel"
        page.keyboard.press("Shift+Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)"), "Shift+Tab left the share panel"
        page.keyboard.press("Escape")
        soon(dialog).to_have_count(0)
        soon(first).to_be_focused()
        page.keyboard.press("Tab")
        assert not g.evaluate("g => g.contains(document.activeElement)"), "Tab must leave the grid"


def test_erasure_extension_matches_brief(world: World) -> None:
    assert gmul(2, 0x80) == 0x1D
    felix = world.api("felix")
    _, g3 = share_grid(felix, world, 3)
    for (r, c), hex_ in BLOCK3_SHARES.items():
        assert g3[r][c].hex() == hex_, f"block 3 share ({r}, {c})"
    assert g3[0][2][14] == 0x1A and g3[0][3][14] == 0x36
    assert (g3[0][2][9], g3[0][3][9]) == (0x03, 0x02)
    created(submit_blob(felix, world, HARBOR, bytes(range(1, 200))))
    world.advance(BLOCK_MS)
    for h in (2, 3, 6):
        k, g = share_grid(felix, world, h)
        q0 = [[g[r][c] for c in range(k)] for r in range(k)]
        assert g == extend_square(q0), f"block {h} extended square does not follow the published extension"


def test_wf_erasure_extension_share_panel(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/3") as page:
        start = page.get_by_role("gridcell", name="Share 0, 0: Lantern", exact=True)
        ready(start).focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        q1 = page.get_by_role("gridcell", name="Share 0, 2: Parity", exact=True)
        soon(q1).to_be_focused()
        soon(q1).to_have_attribute("data-share", BLOCK3_SHARES[(0, 2)])
        soon(q1).to_have_attribute("data-quadrant", "Q1")
        page.keyboard.press("Enter")
        share_r, share_c = 0, 2
        dialog = page.get_by_role("dialog", name=f"Share {share_r}, {share_c}")
        soon(dialog).to_contain_text(re.compile("Info byte 03", re.I))
        page.keyboard.press("Escape")
        soon(q1).to_be_focused()
        for key in ("ArrowLeft", "ArrowLeft", "ArrowDown", "ArrowDown"):
            page.keyboard.press(key)
        q2 = page.get_by_role("gridcell", name="Share 2, 0: Parity", exact=True)
        soon(q2).to_be_focused()
        soon(q2).to_have_attribute("data-share", BLOCK3_SHARES[(2, 0)])
        soon(q2).to_have_attribute("data-quadrant", "Q2")
        q3 = page.get_by_role("gridcell", name="Share 3, 3: Parity", exact=True)
        soon(q3).to_have_attribute("data-share", BLOCK3_SHARES[(3, 3)])
        soon(q3).to_have_attribute("data-quadrant", "Q3")


def test_snapshot_download_api(world: World) -> None:
    priya = world.api("priya")
    for h in (3, 4):
        r = priya.get(world.w(f"/blocks/{h}/snapshot"))
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/octet-stream")
        assert re.search(rf'attachment;\s*filename="block-{h}-square\.bin"', r.headers["content-disposition"])
        k, g = share_grid(priya, world, h)
        expected = b"".join((g[r_][c] or b"\0" * 64) for r_ in range(2 * k) for c in range(2 * k))
        assert r.content == expected and len(r.content) == (2 * k) ** 2 * 64
        assert S3().get(f"squares/{world.fern}/{h}.bin") == expected
    _, g4 = share_grid(priya, world, 4)
    assert g4[7][7] is None and g4[0][0] is not None
    world.advance(BLOCK_MS)
    assert S3().get(f"squares/{world.fern}/6.bin") == priya.get(world.w("/blocks/6/snapshot")).content


def test_wf_erasure_extension_snapshot_download(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2") as page:
        with page.expect_download() as info:
            click(page.get_by_role("button", name="Download square snapshot"))
        download = info.value
        assert download.suggested_filename == f"block-{2}-square.bin"
        content = Path(download.path()).read_bytes()
        said(page, "Snapshot status", "Snapshot ready.")
    assert content == S3().get(f"squares/{world.fern}/2.bin")
    assert len(content) == 64 * 64


def test_roots_match_worked_and_recompute(world: World) -> None:
    felix = world.api("felix")
    b3 = block(felix, world, 3)
    assert b3["rowRoots"][0] == {"min": LANTERN, "max": PARITY_NS_HEX, "hash": BLOCK3_ROW0}
    assert b3["columnRoots"][0]["hash"] == BLOCK3_COL0 and b3["dataRoot"] == BLOCK3_DATA_ROOT
    b2 = block(felix, world, 2)
    assert (b2["rowRoots"][0]["min"], b2["rowRoots"][0]["hash"]) == (ORCHARD, BLOCK2_ROW0)
    assert (b2["rowRoots"][1]["min"], b2["rowRoots"][1]["hash"]) == (HARBOR, BLOCK2_ROW1)
    assert [b2["rowRoots"][r]["min"] for r in (2, 3)] == [PADDING_NS, PADDING_NS]
    assert b2["dataRoot"] == BLOCK2_DATA_ROOT
    _, g3 = share_grid(felix, world, 3)
    assert leaf_node(g3[0][0][:9], g3[0][0])[2].hex() == BLOCK3_LEAF00
    created(submit_blob(felix, world, ORCHARD, b"root probe"))
    world.advance(BLOCK_MS)
    for h in (2, 3, 6):
        _, g = share_grid(felix, world, h)
        rows, cols = square_roots(g)
        b = block(felix, world, h)
        assert b["rowRoots"] == [node_json(n) for n in rows], f"block {h} row roots"
        assert b["columnRoots"] == [node_json(n) for n in cols], f"block {h} column roots"
        assert b["dataRoot"] == data_root(rows, cols).hex(), f"block {h} data root"


def test_wf_nmt_proofs_roots_view(browser: Browser, world: World) -> None:
    b2 = block(world.api("felix"), world, 2)
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2", device_time=WRONG_DEVICE_TIME) as page:
        soon(page.get_by_role("heading", name="Block 2")).to_be_visible()
        wait_text(page, f"Data root {BLOCK2_DATA_ROOT}")
        assert "Available" in page_text(page)
        for list_name, key, word in (("Row roots", "rowRoots", "Row"), ("Column roots", "columnRoots", "Column")):
            items = page.get_by_role("list", name=list_name).get_by_role("listitem")
            soon(items).to_have_count(8)
            for i, root in enumerate(b2[key]):
                soon(items.nth(i)).to_have_attribute("data-hash", root["hash"])
                soon(items.nth(i)).to_have_attribute("data-min", root["min"])
                soon(items.nth(i)).to_contain_text(f"{word} {i}")
                soon(items.nth(i)).to_contain_text(root["hash"])


def test_namespace_proofs_api(world: World) -> None:
    felix = world.api("felix")
    b2 = block(felix, world, 2)
    proof = felix.json(world.w("/blocks/2/proofs"), namespace=HARBOR)
    rows = proof["rows"]
    assert [r["kind"] for r in rows] == ["inclusion", "inclusion", "outside", "outside"]
    r0, r1 = rows[0], rows[1]
    assert (r0["start"], r0["end"], [n["hash"] for n in r0["nodes"]]) == (3, 4, HARBOR_ROW0_NODES)
    assert (r1["start"], r1["end"], len(r1["nodes"])) == (0, 2, 2)
    assert (r1["nodes"][0]["min"], r1["nodes"][0]["max"]) == (LANTERN, PADDING_NS)
    for r in (r0, r1):
        leaves = [leaf_node(bytes.fromhex(s)[:9], bytes.fromhex(s)) for s in r["shares"]]
        root = proof_root(8, r["start"], r["end"], leaves, [as_node(n) for n in r["nodes"]])
        assert node_json(root) == b2["rowRoots"][r["row"]]
        v = felix.post(world.w("/blocks/2/proofs/verify"), {"namespace": HARBOR, "proof": r})
        assert v.status_code == 200 and v.json() == {"verified": True, "root": b2["rowRoots"][r["row"]]}
    tampered = json.loads(json.dumps(r0))
    tampered["nodes"][0]["hash"] = "00" * 32
    v = felix.post(world.w("/blocks/2/proofs/verify"), {"namespace": HARBOR, "proof": tampered})
    assert v.status_code == 200 and v.json()["verified"] is False

    absent = felix.json(world.w("/blocks/2/proofs"), namespace=ABSENT_NS)["rows"]
    a0 = absent[0]
    assert a0["kind"] == "absence"
    assert a0["nextLeaf"] == {"col": 3, "namespace": HARBOR, "hash": ABSENT_NEXT_LEAF}
    assert [n["hash"] for n in a0["nodes"]] == HARBOR_ROW0_NODES
    root = proof_root(8, 3, 4, [(bytes.fromhex(HARBOR),) * 2 + (bytes.fromhex(ABSENT_NEXT_LEAF),)], [as_node(n) for n in a0["nodes"]])
    assert node_json(root) == b2["rowRoots"][0]
    assert [r["kind"] for r in absent[1:]] == ["outside", "outside", "outside"]
    assert felix.post(world.w("/blocks/2/proofs/verify"), {"namespace": ABSENT_NS, "proof": a0}).json()["verified"] is True
    expect_field(felix.get(world.w("/blocks/2/proofs"), namespace="zz"), "namespace", "Namespace must use only the characters 0-9 and a-f.")
    expect_field(felix.get(world.w("/blocks/2/proofs"), namespace="00000000000000b2"), "namespace",
                 "Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has 16.")


def test_wf_nmt_proofs_prove_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2") as page:
        page.route("**/proofs/verify**", lambda route: route.abort())

        def tamper(route: Any) -> None:
            response = route.fetch()
            body = response.json()
            body["rows"][0]["nodes"][0]["hash"] = "00" * 32
            route.fulfill(response=response, json=body)

        proofs_get = re.compile(r"/proofs\?")
        page.route(proofs_get, tamper)
        box = page.get_by_role("textbox", name="Namespace to prove")
        fill(box, HARBOR)
        box.press("Enter")
        region = page.get_by_role("region", name="Namespace proof")
        soon(region).to_contain_text("Row 0: inclusion, columns 3 to 3, 3 proof nodes")
        click(region.get_by_role("button", name="Verify row 0"))
        soon(region).to_contain_text("Proof does not match row 0 root.")
        page.unroute(proofs_get, tamper)
        page.reload()
        fill(box, HARBOR)
        box.press("Enter")
        for line in ("Row 0: inclusion, columns 3 to 3, 3 proof nodes", "Row 1: inclusion, columns 0 to 1, 2 proof nodes",
                     "Row 2: outside this row's namespace range", "Row 3: outside this row's namespace range"):
            soon(region).to_contain_text(line)
        nodes = region.get_by_role("list", name="Row 0 proof nodes").get_by_role("listitem")
        soon(nodes).to_have_count(3)
        for i, h in enumerate(HARBOR_ROW0_NODES):
            soon(nodes.nth(i)).to_have_attribute("data-hash", h)
        for r in (0, 1):
            button = region.get_by_role("button", name=f"Verify row {r}")
            ready(button).focus()
            page.keyboard.press("Enter")
            soon(region).to_contain_text(f"Verified against row {r} root.")
        fill(box, ABSENT_NS)
        box.press("Enter")
        soon(region).to_contain_text("Row 0: absence, next leaf at column 3")
        soon(region).to_contain_text(f"Next leaf hash {ABSENT_NEXT_LEAF}")


def test_sampling_confidence(world: World) -> None:
    felix, kestrel = world.api("felix"), world.node("kestrel")
    before = samples(felix, world, kestrel, 2)
    assert (before["confidence"], before["verdict"]) == ("0.0000", "sampling")
    got = [created(take_sample(felix, world, kestrel, 2))["confidence"] for _ in range(SAMPLES_PER_BLOCK)]
    assert got[:6] == CONF_K4
    assert got == [confidence(4, s) for s in range(1, SAMPLES_PER_BLOCK + 1)]
    k3 = [created(take_sample(felix, world, kestrel, 3))["confidence"] for _ in range(5)]
    assert k3[:3] == CONF_K2
    assert samples(felix, world, kestrel, 3)["verdict"] == "sampling"
    created(take_sample(felix, world, kestrel, 3))
    s3 = samples(felix, world, kestrel, 3)
    assert (s3["confidence"], s3["verdict"]) == (confidence(2, 6), "available")
    one = created(take_sample(felix, world, kestrel, 1))
    assert one["confidence"] == "100.0000" and samples(felix, world, kestrel, 1)["verdict"] == "available"
    created(submit_blob(felix, world, HARBOR, b"8" * MAX_BLOB))
    world.advance(2 * BLOCK_MS)
    assert block(felix, world, 7)["squareWidth"] == 8
    assert [created(take_sample(felix, world, kestrel, 7))["confidence"] for _ in range(3)] == CONF_K8


def test_sample_sequence_matches_generator(world: World) -> None:
    assert sample_coords(1, 6, 4, 8) == WREN_6 and sample_coords(2, 2, 4, 6) == KESTREL_2 and sample_coords(1, 4, 4, 3) == WREN_4
    felix, kestrel, wren = world.api("felix"), world.node("kestrel"), world.node("wren")
    assert [(s["row"], s["col"]) for s in (created(take_sample(felix, world, kestrel, 2)) for _ in range(6))] == KESTREL_2
    w4 = samples(felix, world, wren, 4)["samples"]
    assert coords(w4) == WREN_4 and [s["served"] for s in w4] == [True, True, False]
    assert [(s["row"], s["col"]) for s in (created(take_sample(felix, world, kestrel, 3)) for _ in range(5))] == sample_coords(2, 3, 2, 5)
    world.advance(BLOCK_MS + 8 * SAMPLE_INTERVAL_MS)
    assert coords(samples(felix, world, wren, 6)["samples"])[:8] == WREN_6


def test_auto_sampling_schedule_and_block_states(world: World) -> None:
    felix, wren, kestrel = world.api("felix"), world.node("wren"), world.node("kestrel")
    world.advance(BLOCK_MS)
    count = lambda node, h: len(samples(felix, world, node, h)["samples"])
    assert block(felix, world, 6)["status"] == "sampling" and count(wren, 6) == 0
    world.advance(SAMPLE_INTERVAL_MS - 1)
    assert count(wren, 6) == 0
    world.advance(1)
    assert count(wren, 6) == 1
    world.advance(SAMPLE_INTERVAL_MS)
    assert count(wren, 6) == 2 and count(kestrel, 6) == 0
    world.advance(7 * SAMPLE_INTERVAL_MS)
    s = samples(felix, world, wren, 6)
    assert len(s["samples"]) == 9 and s["verdict"] == "sampling" and block(felix, world, 6)["status"] == "sampling"
    world.advance(SAMPLE_INTERVAL_MS)
    s = samples(felix, world, wren, 6)
    assert len(s["samples"]) == 10 and s["verdict"] == "available" and block(felix, world, 6)["status"] == "available"
    world.advance(6 * SAMPLE_INTERVAL_MS)
    assert count(wren, 6) == SAMPLES_PER_BLOCK
    world.advance(2 * SAMPLE_INTERVAL_MS)
    assert count(wren, 6) == SAMPLES_PER_BLOCK
    expect_error(take_sample(felix, world, wren, 6), 409, {"error": "Light node Wren has already taken 16 samples of block 6."})
    expect_error(take_sample(felix, world, wren, 99), 404, NOT_FOUND)

    r = felix.patch(world.w(f"/light-nodes/{kestrel}"), {"autoSample": True})
    assert r.status_code == 200 and r.json()["autoSample"] is True
    created(submit_blob(felix, world, HARBOR, b"a" * 1000))
    world.advance_to(at_block(8) + timedelta(milliseconds=SAMPLE_INTERVAL_MS))
    k8 = block(felix, world, 8)["squareWidth"]
    expected = sample_coords(2, 8, k8, 3)
    assert coords(samples(felix, world, kestrel, 8)["samples"]) == expected[:1]
    manual = created(take_sample(felix, world, kestrel, 8))
    assert (manual["row"], manual["col"]) == expected[1]
    world.advance(SAMPLE_INTERVAL_MS)
    assert coords(samples(felix, world, kestrel, 8)["samples"]) == expected
    for _ in range(6):
        take_sample(felix, world, kestrel, 5)
    assert block(felix, world, 5)["status"] == "rejected"


def test_wf_light_sampling_take_sample_keyboard(browser: Browser, world: World) -> None:
    kestrel = world.node("kestrel")
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/nodes/{kestrel}", device_time=WRONG_DEVICE_TIME) as page:
        select(page.get_by_role("combobox", name="Block"), "Block 2")
        take = page.get_by_role("button", name="Take sample")
        for i, key in enumerate(("Enter", "Space", "Enter")):
            ready(take).focus()
            page.keyboard.press(key)
            r, c = KESTREL_2[i]
            wait_text(page, f"Sample {i + 1}: share ({r}, {c}) available. Confidence {CONF_K4[i]}%.")
        soon(page.get_by_role("status", name="Sampling updates")).to_contain_text(f"Confidence {CONF_K4[2]}%")
        wait_text(page, "Confidence 77.3716%")
        switch = page.get_by_role("switch", name="Auto-sample")
        soon(switch).not_to_be_checked()
        ready(switch).focus()
        page.keyboard.press("Space")
        soon(switch).to_be_checked()
    felix = world.api("felix")
    s = samples(felix, world, kestrel, 2)
    assert coords(s["samples"]) == KESTREL_2[:3] and s["confidence"] == "77.3716"
    poll(lambda: [n for n in felix.json(world.w("/light-nodes")) if n["id"] == kestrel and n["autoSample"]], 10, "Auto-sample switch did not turn Kestrel on")


def test_wf_light_sampling_auto_follow(browser: Browser, world: World) -> None:
    kestrel = world.node("kestrel")
    expected = sample_coords(2, 6, 4, 3)
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/nodes/{kestrel}") as page:
        switch = page.get_by_role("switch", name="Auto-sample")
        ready(switch).focus()
        page.keyboard.press("Space")
        soon(switch).to_be_checked()
        felix = world.api("felix")
        poll(lambda: [n for n in felix.json(world.w("/light-nodes")) if n["id"] == kestrel and n["autoSample"]], 10, "Kestrel auto-sample not saved")
        world.advance(BLOCK_MS + 3 * SAMPLE_INTERVAL_MS)
        r, c = expected[2]
        wait_text(page, f"Sample 3: share ({r}, {c}) available. Confidence {CONF_K4[2]}%.", LIVE_DEADLINE_S)
    assert coords(samples(world.api("felix"), world, kestrel, 6)["samples"]) == expected


def test_wf_withheld_block_returns_to_honest(browser: Browser, world: World) -> None:
    amara = world.api("amara")
    expect_field(amara.put(world.w("/producer"), {"nextBlock": "evil"}), "nextBlock", "Choose Honest, Withhold shares or Bad encoding.")
    with open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer") as page:
        group = page.get_by_role("radiogroup", name="Next block")
        honest = group.get_by_role("radio", name="Honest")
        soon(honest).to_be_checked()
        ready(honest).focus()
        page.keyboard.press("ArrowRight")
        soon(group.get_by_role("radio", name="Withhold shares")).to_be_checked()
        said(page, "Producer status", "Next block: Withhold shares.")
        poll(lambda: amara.json(world.w())["nextBlock"] == "withhold", 10, "Next block choice was not saved")
        world.advance(BLOCK_MS)
        assert amara.json(world.w())["nextBlock"] == "honest"
        page.reload()
        soon(page.get_by_role("radiogroup", name="Next block").get_by_role("radio", name="Honest")).to_be_checked()
    _, g6 = share_grid(amara, world, 6)
    assert sum(1 for row in g6 for s in row if s is None) == 25
    world.advance(BLOCK_MS)
    _, g7 = share_grid(amara, world, 7)
    assert all(s is not None for row in g7 for s in row), "block 7 must be honest again"


def test_withheld_block_rejection_api(world: World) -> None:
    amara, wren = world.api("amara"), world.node("wren")
    assert amara.put(world.w("/producer"), {"nextBlock": "withhold"}).json() == {"nextBlock": "withhold"}
    world.advance(BLOCK_MS)
    cells = share_cells(amara, world, 6)
    for (r, c), body in cells.items():
        withheld = 3 <= r <= 7 and 3 <= c <= 7
        assert (body["share"] is None) == withheld and (body["kind"] == "withheld") == withheld, f"share ({r}, {c})"
    world.advance(5 * SAMPLE_INTERVAL_MS)
    s = samples(amara, world, wren, 6)
    assert [x["confidence"] for x in s["samples"]] == CONF_K4[:5] and all(x["served"] for x in s["samples"])
    assert block(amara, world, 6)["status"] == "sampling"
    world.advance(SAMPLE_INTERVAL_MS)
    s = samples(amara, world, wren, 6)
    assert coords(s["samples"]) == WREN_6[:6] and s["samples"][5]["served"] is False and s["verdict"] == "unavailable"
    b6 = block(amara, world, 6)
    assert b6["status"] == "rejected"
    rej = b6["rejection"]
    assert (rej["reason"], rej["node"], rej["nodeName"], rej["row"], rej["col"]) == ("withheld", wren, "Wren", 3, 4)
    world.advance(4 * SAMPLE_INTERVAL_MS)
    assert len(samples(amara, world, wren, 6)["samples"]) == 6
    snap = S3().get(f"squares/{world.fern}/6.bin")
    assert snap[(7 * 8 + 7) * 64 : (7 * 8 + 8) * 64] == b"\0" * 64
    assert snap[:64] == bytes.fromhex(cells[(0, 0)]["share"])


def test_wf_withheld_block_rejection_live(browser: Browser, world: World, mail: Mailpit) -> None:
    mail.clear()
    amara = world.api("amara")
    node_name, row, col = "Wren", 3, 4
    copy = f"Block {6} was rejected: shares were withheld. Light node {node_name} could not fetch share ({row}, {col})."
    with open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer", device_time=WRONG_DEVICE_TIME) as owner, \
            open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer", device_time=WRONG_DEVICE_TIME) as dev:
        group = owner.get_by_role("radiogroup", name="Next block")
        ready(group.get_by_role("radio", name="Honest")).focus()
        owner.keyboard.press("ArrowRight")
        said(owner, "Producer status", "Next block: Withhold shares.")
        poll(lambda: amara.json(world.w())["nextBlock"] == "withhold", 10, "Withhold shares was not saved")
        world.advance(BLOCK_MS)
        for page in (owner, dev):
            wait_text(page, "Block 6 produced: 2 blobs, square 4 × 4.", LIVE_DEADLINE_S)
            expect(page.get_by_role("table", name="Blocks")).to_contain_text("Sampling")
        world.advance(6 * SAMPLE_INTERVAL_MS)
        for page in (owner, dev):
            wait_text(page, copy, LIVE_DEADLINE_S)
            expect(page.get_by_role("alert", name=f"Block {6} rejected")).to_contain_text(copy)
            expect(page.get_by_role("status", name="Network updates")).to_contain_text(copy)
        banners = [norm(a.inner_text()) for a in dev.get_by_role("alert", name=re.compile(r"^Block \d+ rejected$")).all()]
        assert [re.search(r"Block (\d+) was rejected", b).group(1) for b in banners] == ["6", "5", "4"]
    fees = {}
    for item in world.data["blobs"]["mempool"]:
        b = amara.json(world.w(f"/blobs/{item['id']}"))
        assert (b["status"], b["statusText"]) == ("rejected", "Rejected — block 6 was rejected")
        assert amara.json(world.w(f"/transactions/{item['txId']}"))["statusText"] == "Rejected — block 6 was rejected"
        fees[item["id"]] = b["feeUfern"]
    me = staking_me(amara, world)
    assert (me["balanceUfern"], me["availableUfern"]) == (2_000 * UFERN, 2_000 * UFERN)
    entries = [e for e in ledger(amara, world, f"member:{world.person('amara')['id']}")["entries"] if e["height"] == 6]
    assert sorted(e["amountUfern"] for e in entries if e["label"] == "Fee") == sorted(-f for f in fees.values())
    assert sorted(e["amountUfern"] for e in entries if e["label"] == "Fee refund") == sorted(fees.values())
    assert_ledger_balanced(Postgres(), world.fern)
    msgs = [m for m in mail.messages(expected=3) if m["Subject"] == f"Block {6} was rejected"]
    recipients = sorted(a for m in msgs for a in addresses(m["To"]))
    assert recipients == sorted(PEOPLE[k][1] for k in ("amara", "felix", "priya"))
    assert all("Fernhill Labs" in mail_text(m) for m in msgs)


def test_fraud_proof_api(world: World) -> None:
    felix, amara, kestrel = world.api("felix"), world.api("amara"), world.node("kestrel")
    fp5 = felix.json(world.w("/blocks/5/fraud-proof"))
    assert (fp5["axis"], fp5["index"], fp5["height"]) == ("row", 0, 5)
    assert (fp5["committedRoot"]["hash"], fp5["recomputedRoot"]["hash"]) == (FRAUD5_COMMITTED, FRAUD5_RECOMPUTED)
    assert len(fp5["shares"]) == 2 and all(s["verified"] for s in fp5["shares"])
    assert felix.get(world.w("/blocks/3/fraud-proof")).status_code == 404
    amara.put(world.w("/producer"), {"nextBlock": "bad-encoding"})
    world.advance(BLOCK_MS)
    cells = share_cells(felix, world, 6)
    assert bytes.fromhex(cells[(0, 4)]["share"])[14] == int("70", 16)
    for _ in range(10):
        created(take_sample(felix, world, kestrel, 6))
    assert block(felix, world, 6)["status"] == "available"
    world.advance(FRAUD_DELAY_MS - 1)
    assert felix.get(world.w("/blocks/6/fraud-proof")).status_code == 404
    world.advance(1)
    fp = felix.json(world.w("/blocks/6/fraud-proof"))
    assert (fp["axis"], fp["index"], iso(fp["publishedAt"])) == ("row", 0, at_block(6) + timedelta(milliseconds=FRAUD_DELAY_MS))
    assert (fp["committedRoot"]["hash"], fp["recomputedRoot"]["hash"]) == (FRAUD6_COMMITTED, FRAUD6_RECOMPUTED)
    assert len(fp["shares"]) == 4 and all(s["verified"] for s in fp["shares"])
    b6 = block(felix, world, 6)
    assert b6["rowRoots"][0]["hash"] == FRAUD6_COMMITTED
    assert b6["status"] == "rejected" and (b6["rejection"]["reason"], b6["rejection"]["axis"], b6["rejection"]["index"]) == ("bad-encoding", "row", 0)
    row0 = [bytes.fromhex(cells[(0, c)]["share"]) for c in range(4)]
    honest = row0 + rs_extend(row0)
    recomputed = nmt_root([leaf_node(s[:9] if c < 4 else PARITY_NS, s) for c, s in enumerate(honest)])
    assert recomputed[2].hex() == FRAUD6_RECOMPUTED
    world.advance(4 * BLOCK_MS)
    assert felix.json(world.w("/blocks/6/fraud-proof"))["publishedAt"] == fp["publishedAt"]
    assert block(felix, world, 6)["status"] == "rejected"


def test_wf_fraud_proof_panel_live(browser: Browser, world: World) -> None:
    amara = world.api("amara")
    lines = ["Row 0 of block 6", "4 of 4 shares verified against column roots", f"Committed row root {FRAUD6_COMMITTED}",
             f"Recomputed row root {FRAUD6_RECOMPUTED}", "Row 0 is not encoded correctly. Block 6 rejected."]
    with open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer") as owner:
        group = owner.get_by_role("radiogroup", name="Next block")
        ready(group.get_by_role("radio", name="Honest")).focus()
        owner.keyboard.press("ArrowRight")
        owner.keyboard.press("ArrowRight")
        said(owner, "Producer status", "Next block: Bad encoding.")
        poll(lambda: amara.json(world.w())["nextBlock"] == "bad-encoding", 10, "Bad encoding was not saved")
        world.advance(BLOCK_MS)
        owner.goto(f"{world.base}/w/{world.fern}/explorer/blocks/6")
        with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/6") as dev:
            for page in (owner, dev):
                soon(page.get_by_role("heading", name="Block 6")).to_be_visible()
                soon(page.get_by_role("region", name="Bad encoding fraud proof")).to_have_count(0)
            world.advance(FRAUD_DELAY_MS)
            for page in (owner, dev):
                wait_text(page, lines[-1], LIVE_DEADLINE_S)
                panel = page.get_by_role("region", name="Bad encoding fraud proof")
                text = norm(panel.inner_text())
                positions = [text.find(line) for line in lines]
                assert all(p >= 0 for p in positions) and positions == sorted(positions), f"panel lines out of order: {text[:400]}"
                expect(page.get_by_role("alert", name=f"Block {6} rejected")).to_contain_text(f"Block {6} was rejected: row {0} is not encoded correctly.")
    assert amara.json(world.w("/blocks/6/fraud-proof"))["committedRoot"]["hash"] == FRAUD6_COMMITTED
    assert staking_me(amara, world)["balanceUfern"] == 2_000 * UFERN
    assert_ledger_balanced(Postgres(), world.fern)


def test_wf_fraud_proof_seeded_panel(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer/blocks/5", device_time=WRONG_DEVICE_TIME) as page:
        panel = page.get_by_role("region", name="Bad encoding fraud proof")
        for line in ("Row 0 of block 5", "2 of 2 shares verified against column roots", f"Committed row root {FRAUD5_COMMITTED}",
                     f"Recomputed row root {FRAUD5_RECOMPUTED}", "Row 0 is not encoded correctly. Block 5 rejected."):
            soon(panel).to_contain_text(line)
        soon(page.get_by_role("alert", name=f"Block {5} rejected")).to_contain_text(f"Block {5} was rejected: row {0} is not encoded correctly.")
        assert "Rejected" in page_text(page)
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/3")
        soon(page.get_by_role("heading", name="Block 3")).to_be_visible()
        soon(page.get_by_role("region", name="Bad encoding fraud proof")).to_have_count(0)


def test_delegation_refusals_and_limits(world: World) -> None:
    felix = world.api("felix")
    cedar, birch, alder, dogwood = (world.validator(v) for v in ("cedar", "birch", "alder", "dogwood"))
    d = lambda body: felix.post(world.w("/staking/delegate"), body)
    u = lambda body: felix.post(world.w("/staking/undelegate"), body)
    rd = lambda body: felix.post(world.w("/staking/redelegate"), body)
    expect_field(d({"validator": "", "amount": "x"}), "validator", "Choose a validator.")
    expect_field(d({"validator": world.validator("cedar", "quarry"), "amount": "1"}), "validator", "Choose a validator.")
    expect_field(rd({"from": birch, "to": birch, "amount": "x"}), "to", "Choose a different validator.")
    expect_field(d({"validator": cedar, "amount": "1.0000001"}), "amount", "Amount must be an amount in FERN with at most 6 decimals.")
    expect_field(d({"validator": cedar, "amount": "0"}), "amount", "Amount must be more than 0.")
    expect_field(d({"validator": cedar, "amount": "5000"}), "amount", f"You can delegate at most {shown(5_000 * UFERN - STAKING_FEE)} FERN.")
    expect_field(u({"validator": alder, "amount": "1"}), "amount", f"You can undelegate at most {shown(0)} FERN.")
    expect_field(rd({"from": birch, "to": cedar, "amount": "300.000001"}), "amount", f"You can redelegate at most {shown(300 * UFERN)} FERN.")
    expect_error(felix.post(world.w("/staking/claim"), {}), 409, {"error": "There are no rewards to claim."})
    assert staking_me(felix, world)["availableUfern"] == 5_000 * UFERN

    created(d({"validator": cedar, "amount": "1000"}))
    for _ in range(MAX_UNBONDINGS):
        created(u({"validator": birch, "amount": "1"}))
    for _ in range(MAX_REDELEGATIONS):
        created(rd({"from": birch, "to": alder, "amount": "1"}))
    stake = lambda name: next(v["stakeUfern"] for v in felix.json(world.w("/validators")) if v["name"] == name)
    assert stake("Cedar") == 2_000 * UFERN
    world.advance(BLOCK_MS)
    assert stake("Cedar") == 3_000 * UFERN
    me = staking_me(felix, world)
    assert {(x["validatorName"], x["amountUfern"]) for x in me["delegations"]} >= {("Cedar", 1_000 * UFERN), ("Birch", 286 * UFERN), ("Alder", 7 * UFERN)}
    assert len(me["unbondings"]) == MAX_UNBONDINGS
    assert all(iso(x["completesAt"]) == at_block(6) + timedelta(milliseconds=UNBONDING_MS) and x["status"] == "unbonding" for x in me["unbondings"])
    assert len(me["redelegations"]) == MAX_REDELEGATIONS
    assert all(iso(x["arrivedAt"]) == at_block(6) and iso(x["movableAt"]) == at_block(6) + timedelta(milliseconds=UNBONDING_MS) for x in me["redelegations"])
    expect_field(u({"validator": birch, "amount": "1"}), "amount", "You already have 7 unbondings in progress from Birch.")
    expect_field(rd({"from": birch, "to": dogwood, "amount": "1"}), "amount", "You already have 7 redelegations in progress.")
    locked = rd({"from": alder, "to": dogwood, "amount": "7"})
    assert locked.status_code == 422
    msg = locked.json()["errors"].get("amount", "")
    assert msg == f"You can redelegate at most {shown(0)} FERN." or msg.startswith("This stake arrived from Birch at "), locked.text[:300]


def test_wf_delegation_refusal_ui(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/stake") as page:
        form = page.get_by_role("form", name="Delegate", exact=True)
        soon(form).to_contain_text("Fee 0.008000 FERN")
        select(form.get_by_role("combobox", name="Validator"), "Cedar")
        amount = form.get_by_role("textbox", name="Amount (FERN)")
        fill(amount, "5000")
        amount.press("Enter")
        soon(form.get_by_role("alert")).to_contain_text(f"You can delegate at most {shown(5_000 * UFERN - STAKING_FEE)} FERN.")
        soon(amount).to_be_focused()
        soon(amount).to_have_accessible_description(re.compile(re.escape(f"You can delegate at most {shown(5_000 * UFERN - STAKING_FEE)} FERN.")))
    assert staking_me(world.api("felix"), world)["availableUfern"] == 5_000 * UFERN


def test_reward_split(world: World) -> None:
    felix = world.api("felix")
    cedar, birch = world.validator("cedar"), world.validator("birch")
    created(felix.post(world.w("/staking/delegate"), {"validator": cedar, "amount": "1000"}))
    operator_before = ledger(felix, world, f"operator:{birch}")["balanceUfern"]
    world.advance(BLOCK_MS)
    me = staking_me(felix, world)
    assert me["balanceUfern"] == ufern_of("3,999.992000")
    pending = {x["validatorName"]: x["pendingRewardsUfern"] for x in me["delegations"]}
    assert pending["Birch"] == ufern_of("0.025000") and pending["Cedar"] == 0
    commission = plain("30,555")
    self_stake_reward = (plain("305,555") - commission) * 3_000 // 3_300
    assert ledger(felix, world, f"operator:{birch}")["balanceUfern"] - operator_before in (commission, commission + self_stake_reward)
    world.advance_to(at_block(11))
    pending = {x["validatorName"]: x["pendingRewardsUfern"] for x in staking_me(felix, world)["delegations"]}
    assert pending["Cedar"] == ufern_of("0.423725")
    created(felix.post(world.w("/staking/undelegate"), {"validator": cedar, "amount": "1000"}))
    world.advance_to(at_block(12))
    me = staking_me(felix, world)
    assert me["balanceUfern"] == ufern_of("4,000.492470")
    assert [(x["validatorName"], x["amountUfern"], iso(x["completesAt"]), x["status"]) for x in me["unbondings"]] == [
        ("Cedar", 1_000 * UFERN, UNBONDING_END, "unbonding")]
    assert not [x for x in me["delegations"] if x["validatorName"] == "Cedar" and x["amountUfern"] > 0]


def test_wf_delegation_unbonding_release_ui(browser: Browser, mail: Mailpit, world: World) -> None:
    felix = world.api("felix")
    cedar = world.validator("cedar")
    created(felix.post(world.w("/staking/delegate"), {"validator": cedar, "amount": "1000"}))
    world.advance_to(at_block(11))
    created(felix.post(world.w("/staking/undelegate"), {"validator": cedar, "amount": "1000"}))
    world.advance_to(at_block(12))
    mail.clear()
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/stake", device_time=WRONG_DEVICE_TIME) as page:
        table = page.get_by_role("table", name="Unbondings")
        soon(table).to_contain_text("Unbonding until 10:05:00")
        world.advance_to(UNBONDING_END - timedelta(milliseconds=1))
        me = staking_me(felix, world)
        assert me["unbondings"][0]["status"] == "unbonding" and me["balanceUfern"] == ufern_of("4,000.492470")
        assert not [m for m in mail.messages() if m["Subject"].startswith("Unbonding complete")]
        soon(table).to_contain_text("Unbonding until 10:05:00")
        soon(table).not_to_contain_text("Released")
        world.advance(1)
        me = staking_me(felix, world)
        assert me["unbondings"][0]["status"] == "released" and me["balanceUfern"] == ufern_of("5,000.492470")
        until(page, "() => document.body.innerText.includes('Released')", None, LIVE_DEADLINE_S)
        wait_text(page, "Balance 5,000.492470 FERN", LIVE_DEADLINE_S)
    released = [e for e in ledger(felix, world, f"member:{world.person('felix')['id']}")["entries"] if e["label"] == "Unbonding released from Cedar"]
    assert [(e["amountUfern"], iso(e["at"])) for e in released] == [(1_000 * UFERN, UNBONDING_END)]
    msgs = [m for m in mail.messages(expected=1) if m["Subject"] == "Unbonding complete: 1,000.000000 FERN from Cedar"]
    assert len(msgs) == 1 and addresses(msgs[0]["To"]) == [PEOPLE["felix"][1]]
    assert "Fernhill Labs" in mail_text(msgs[0])


def test_wf_delegation_delegate_ui(browser: Browser, world: World) -> None:
    felix = world.api("felix")
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/stake") as page:
        wait_text(page, "Balance 5,000.000000 FERN")
        form = page.get_by_role("form", name="Delegate", exact=True)
        select(form.get_by_role("combobox", name="Validator"), "Cedar")
        amount = form.get_by_role("textbox", name="Amount (FERN)")
        fill(amount, "1000")
        amount.press("Enter")
        said(page, "Stake status", TX_SENT)
        wait_text(page, "Available 3,999.992000 FERN")
        assert staking_me(felix, world)["balanceUfern"] == 5_000 * UFERN
        world.advance(BLOCK_MS)
        wait_text(page, "Balance 3,999.992000 FERN", LIVE_DEADLINE_S)
        expect(page.get_by_role("table", name="Validators").get_by_role("row").filter(has_text="Cedar")).to_contain_text(shown(3_000 * UFERN))
        expect(page.get_by_role("table", name="Your delegations").get_by_role("row").filter(has_text="Cedar")).to_contain_text("1,000.000000")
    db = Postgres()
    assert_ledger_balanced(db, world.fern)
    felix_id = world.person("felix")["id"]
    assert account_sum(db, world.fern, f"member:{felix_id}") == staking_me(felix, world)["balanceUfern"] == ufern_of("3,999.992000")
    assert ledger(felix, world, f"member:{felix_id}")["balanceUfern"] == ufern_of("3,999.992000")
    bonded = sum(v["stakeUfern"] for v in felix.json(world.w("/validators")))
    assert account_sum(db, world.fern, "bonded:%") == bonded == 11_800 * UFERN


def test_proposal_deposit_edges(world: World) -> None:
    felix, amara = world.api("felix"), world.api("amara")
    p = lambda n: felix.json(world.w(f"/proposals/{n}"))
    expect_error(felix.post(world.w("/proposals/3/deposits"), {"amount": "1"}), 409, {"error": "The deposit period for proposal 3 has ended."})
    expect_error(felix.post(world.w("/proposals/4/votes"), {"option": "yes"}), 409, {"error": "Proposal 4 is not open for voting yet."})
    expect_error(felix.post(world.w("/proposals/7/votes"), {"option": "yes"}), 409, {"error": "The voting period for proposal 7 has ended."})
    expect_field(felix.post(world.w("/proposals/3/votes"), {}), "option", "Choose an option.")
    expect_field(felix.post(world.w("/proposals"), {"title": "", "description": "", "initialDeposit": "0"}), "title", "Give the proposal a title.")
    expect_field(felix.post(world.w("/proposals"), {"title": "t" * 121, "description": "", "initialDeposit": "0"}), "title",
                 "Keep the title to 120 characters or fewer.")
    world.advance_to(DEPOSIT_END_4 - timedelta(milliseconds=1))
    late = created(felix.post(world.w("/proposals/4/deposits"), {"amount": "60"}))
    assert p(4)["statusText"] == "Deposit period"
    world.advance(1)
    assert p(4)["statusText"] == "Failed — deposit not met"
    expect_error(felix.post(world.w("/proposals/4/deposits"), {"amount": "60"}), 409, {"error": "The deposit period for proposal 4 has ended."})
    refunds = [e for e in ledger(amara, world, f"member:{world.person('amara')['id']}")["entries"] if e["label"] == "Deposit refund" and iso(e["at"]) == DEPOSIT_END_4]
    assert [(e["amountUfern"], iso(e["at"])) for e in refunds] == [(40 * UFERN, DEPOSIT_END_4)]
    world.advance_to(at_block(19))
    tx = felix.json(world.w(f"/transactions/{late['id']}"))
    assert tx["statusText"] == "Rejected — " + "The deposit period for proposal 4 has ended."
    me = staking_me(felix, world)
    assert me["balanceUfern"] == 5_000 * UFERN - STAKING_FEE and me["availableUfern"] == me["balanceUfern"]
    db = Postgres()
    assert_ledger_balanced(db, world.fern)
    assert account_sum(db, world.fern, "deposits:4") == 0


def test_wf_governance_deposit_ui(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/vote/4") as page, \
            open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/vote/4") as other:
        soon(page.get_by_role("heading", name="Proposal 4: Add a namespace directory")).to_be_visible()
        wait_text(page, "Deposit period")
        form = page.get_by_role("form", name="Deposit")
        box = form.get_by_role("textbox", name="Deposit (FERN)")
        fill(box, "60")
        box.press("Enter")
        said(page, "Vote status", TX_SENT)
        world.advance(BLOCK_MS)
        for pg in (page, other):
            wait_text(pg, "Voting period", LIVE_DEADLINE_S)
            wait_text(pg, "10:11:30", LIVE_DEADLINE_S)
    p4 = world.api("felix").json(world.w("/proposals/4"))
    assert (p4["statusText"], p4["depositUfern"]) == ("Voting period", 100 * UFERN)
    assert iso(p4["votingEndsAt"]) == at_block(6) + timedelta(milliseconds=VOTING_PERIOD_MS)
    deps = [e for e in ledger(world.api("felix"), world, f"member:{world.person('felix')['id']}")["entries"] if e["label"] == "Deposit on proposal 4"]
    assert [e["amountUfern"] for e in deps] == [-60 * UFERN]


def test_tally_worked_api(world: World) -> None:
    felix = world.api("felix")
    t = felix.json(world.w("/proposals/3"))["tally"]
    assert (t["votesUfern"], t["totalBondedUfern"], t["turnout"]) == (9_500 * UFERN, 10_800 * UFERN, "87.96")
    assert (t["yesUfern"], t["noUfern"], t["noWithVetoUfern"], t["abstainUfern"]) == (4_500 * UFERN, 2_000 * UFERN, 3_000 * UFERN, 0)
    assert (t["vetoShare"], t["yesShare"], t["result"]) == ("31.58", "47.37", "Rejected")
    created(felix.post(world.w("/proposals/3/votes"), {"option": "yes"}))
    world.advance(BLOCK_MS)
    t = felix.json(world.w("/proposals/3"))["tally"]
    assert (t["votesUfern"], t["yesShare"], t["result"]) == (9_800 * UFERN, "48.98", "Rejected")
    created(felix.post(world.w("/proposals/3/votes"), {"option": "no_with_veto"}))
    world.advance(BLOCK_MS)
    p = felix.json(world.w("/proposals/3"))
    assert (p["tally"]["turnout"], p["tally"]["vetoShare"], p["tally"]["result"], p["myVote"]) == ("90.74", "33.67", "Rejected with veto", "no_with_veto")
    world.advance_to(VOTING_END_3)
    assert felix.json(world.w("/proposals/3"))["statusText"] == "Rejected with veto"
    burned = [e for e in ledger(felix, world)["entries"] if e["label"] == "Deposit burned" and iso(e["at"]) == VOTING_END_3]
    assert burned, "proposal 3's deposits were not burned at the voting end"
    expect_error(felix.post(world.w("/proposals/3/votes"), {"option": "yes"}), 409, {"error": "The voting period for proposal 3 has ended."})


def test_wf_governance_vote_veto_ui(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/vote/3", device_time=WRONG_DEVICE_TIME) as page, \
            open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/vote/3", device_time=WRONG_DEVICE_TIME) as other:
        tally = page.get_by_role("region", name="Tally")
        for line in ("Votes 9,500.000000 of 10,800.000000 FERN (87.96%)", "Yes 4,500.000000 FERN", "No 2,000.000000 FERN",
                     "No with veto 3,000.000000 FERN (31.58%)", "Yes share 47.37%", "Projected result Rejected"):
            soon(tally).to_contain_text(line)
        wait_text(page, "Voting period")
        check(page.get_by_role("radiogroup", name="Your vote").get_by_role("radio", name="No with veto"))
        click(page.get_by_role("button", name="Cast vote"))
        said(page, "Vote status", TX_SENT)
        world.advance(BLOCK_MS)
        for pg in (page, other):
            wait_text(pg, "No with veto 3,300.000000 FERN (33.67%)", LIVE_DEADLINE_S)
            wait_text(pg, "Projected result Rejected with veto", LIVE_DEADLINE_S)
        world.advance_to(VOTING_END_3)
        for pg in (page, other):
            wait_text(pg, "Result Rejected with veto", LIVE_DEADLINE_S)
    assert world.api("amara").json(world.w("/proposals/3"))["statusText"] == "Rejected with veto"


def test_governance_mail(world: World, mail: Mailpit) -> None:
    mail.clear()
    felix = world.api("felix")
    created(felix.post(world.w("/proposals/4/deposits"), {"amount": "60"}))
    world.advance(BLOCK_MS)
    opened = [m for m in mail.messages(expected=3) if m["Subject"] == "Voting is open on proposal 4: Add a namespace directory"]
    assert sorted(a for m in opened for a in addresses(m["To"])) == sorted(PEOPLE[k][1] for k in ("amara", "felix", "priya"))
    assert all("Fernhill Labs" in mail_text(m) for m in opened)
    remind_at = VOTING_END_3 - timedelta(milliseconds=VOTE_REMINDER_MS)
    world.advance_to(remind_at - timedelta(milliseconds=1))
    assert not [m for m in mail.messages() if m["Subject"].startswith("Reminder: proposal 3")]
    world.advance(1)
    reminders = poll(lambda: [m for m in mail.messages() if m["Subject"] == "Reminder: proposal 3 closes at 10:06:15"], 30, "no proposal 3 reminder mail")
    assert [addresses(m["To"]) for m in reminders] == [[PEOPLE["felix"][1]]]


def test_wf_phone_blob_panels(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer", size=PHONE_CHECK) as page:
        tabs = page.get_by_role("tablist", name="Workspace panels")
        soon(tabs).to_be_visible()
        soon(page.get_by_role("navigation", name="Workspace")).to_be_hidden()
        soon(tabs.get_by_role("tab", name="Explorer")).to_have_attribute("aria-selected", "true")
        for name in ("Explorer", "Submit", "Nodes", "Stake", "Vote"):
            at_least(tabs.get_by_role("tab", name=name))
        for name, route in (("Stake", "stake"), ("Vote", "vote"), ("Nodes", "nodes")):
            tap(tabs.get_by_role("tab", name=name))
            soon(page).to_have_url(f"{world.base}/w/{world.fern}/{route}")
            soon(page.get_by_role("tablist", name="Workspace panels").get_by_role("tab", name=name)).to_have_attribute("aria-selected", "true")
        for loc in (page.get_by_role("link", name="Fernsquare home"), page.get_by_role("link", name="Submit blob"), page.get_by_role("button", name="Menu")):
            soon(loc).to_be_visible()
        at_least(page.get_by_role("button", name="Menu"))
        at_least(page.get_by_role("link", name="Submit blob"))
        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.goto(f"{world.base}/w/{world.fern}/explorer")
            soon(page.get_by_role("table", name="Blocks")).to_be_visible()
            layout(page)
            if size[0] >= TABLET[0]:
                soon(page.get_by_role("navigation", name="Workspace")).to_be_visible()
                soon(page.get_by_role("navigation", name="Workspace").get_by_role("link", name="Explorer")).to_have_attribute("aria-current", "page")
                soon(page.get_by_role("tablist", name="Workspace panels")).to_be_hidden()
        menu = page.get_by_role("button", name="Menu")
        top = menu.bounding_box()
        assert top is not None and top["y"] + top["height"] <= TOP_BAR_PX
        page.mouse.wheel(0, 900)
        page_advance(page, 200)
        moved = menu.bounding_box()
        assert moved is not None and abs(moved["y"] - top["y"]) < 1, "console top bar must stay fixed"
        click(menu)
        dialog = page.get_by_role("dialog", name="Menu")
        for role, name in (("link", "Members"), ("link", "Ledger"), ("button", "Sign out")):
            soon(dialog.get_by_role(role, name=name)).to_be_visible()
        for _ in range(5):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)"), "Tab left the Menu dialog"
        page.keyboard.press("Escape")
        soon(dialog).to_have_count(0)
        soon(menu).to_be_focused()


def test_wf_phone_blob_touch(browser: Browser, world: World) -> None:
    harbor = world.data["blobs"]["block2"][2]
    with open_frozen(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer", size=PHONE_CHECK,
                 reduced_motion="reduce", device_time=WRONG_DEVICE_TIME) as page:
        tap(page.get_by_role("table", name="Blocks").get_by_role("link", name="2", exact=True))
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/explorer/blocks/2")
        blobs = page.get_by_role("table", name="Blobs in this block")
        tap(blobs.get_by_role("row").filter(has_text=re.compile("Harbor|" + HARBOR)).get_by_role("link").first)
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/blobs/{harbor['id']}")
        soon(page.get_by_role("heading", name=f"Blob {harbor['id'][:8]}")).to_be_visible()
        facts = page.get_by_role("list", name="Blob facts")
        for text_ in ("Included in block 2", "Harbor", HARBOR, "Size 120 bytes", "Shares 3", "Fee 0.006654 FERN"):
            soon(facts).to_contain_text(text_)
        soon(page.get_by_role("link", name="Block 2")).to_be_visible()
        positions = page.get_by_role("list", name="Share positions").get_by_role("listitem")
        soon(positions).to_have_text(["(0, 3)", "(1, 0)", "(1, 1)"])
        g = grid(page, 2)
        fb, gb = facts.bounding_box(), g.bounding_box()
        assert fb and gb and fb["y"] + fb["height"] <= gb["y"] + 1, "phones stack the facts above the square"
        target = page.get_by_role("gridcell", name="Share 0, 3: Harbor", exact=True)
        at_least(target)
        tap(target)
        dialog = page.get_by_role("dialog", name=f"Share {0}, {3}")
        soon(dialog).to_be_visible()
        tap(dialog.get_by_role("button", name="Close"))
        soon(dialog).to_have_count(0)
        assert page.evaluate(REVEAL_NOW, "Data square, block 2") == {"n": 8, "total": 8, "t": page.evaluate("performance.now()")} or \
            page.evaluate(REVEAL_NOW, "Data square, block 2")["n"] == 8
        layout(page)


def test_square_reveal_and_motion_limits(browser: Browser, world: World) -> None:
    with open_frozen(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer") as page:
        soon(grid(page, 5)).to_be_attached()
        page.evaluate(REVEAL_LOGGER, "Data square, block 6")
        world.advance(BLOCK_MS)
        until(page, "() => (window.__reveal || []).some(e => e.total === 8)", None, UI_WAIT_S)
        log = [e for e in page.evaluate("() => window.__reveal") if e["total"] == 8]
        t0 = log[0]["t"]
        assert log[0]["n"] <= 1, "only row 0 may be revealed on arrival"
        now = page.evaluate(REVEAL_NOW, "Data square, block 6")
        expected = min(8, int((now["t"] - t0) // ROW_REVEAL_MS) + 1)
        assert abs(now["n"] - expected) <= 1 and now["n"] < 8, f"reveal count {now['n']} at {now['t'] - t0} ms"
        for _ in range(3):
            before = page.evaluate(REVEAL_NOW, "Data square, block 6")["n"]
            page_advance(page, ROW_REVEAL_MS)
            assert page.evaluate(REVEAL_NOW, "Data square, block 6")["n"] == min(8, before + 1)
        page_advance(page, 8 * ROW_REVEAL_MS)
        assert page.evaluate(REVEAL_NOW, "Data square, block 6")["n"] == 8

        marquee = page.get_by_role("region", name="Validators")
        marquee.scroll_into_view_if_needed()
        page_advance(page, 200)
        soon(marquee).to_have_attribute("data-motion", "running")
        assert page.evaluate(INFINITE_OUTSIDE, marquee.element_handle()) == 0, "something other than the marquee loops"
        ready(marquee).hover()
        page_advance(page, 200)
        soon(marquee).to_have_attribute("data-motion", "paused")
        page.mouse.move(5, 5)
        page.evaluate("() => window.scrollTo(0, 0)")
        page_advance(page, 200)
        soon(marquee).to_have_attribute("data-motion", "paused")


def test_wf_square_walk_motion_reduced(browser: Browser, world: World) -> None:
    with open_frozen(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer", reduced_motion="reduce") as page:
        marquee = page.get_by_role("region", name="Validators")
        soon(marquee).to_have_attribute("data-motion", "off")
        assert page.evaluate(INFINITE_OUTSIDE, None) == 0
        page.evaluate(REVEAL_LOGGER, "Data square, block 6")
        world.advance(BLOCK_MS)
        revealed_at_once(page)
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/2")
        walk = page.get_by_role("list", name="Square walk")
        cards = [walk.get_by_role("article", name=n) for n in ("Lay out", "Extend", "Commit")]
        for card in cards:
            soon(card).to_have_attribute("data-state", "shown")
        soon(cards[0]).to_have_attribute("aria-current", "step")
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        page_advance(page, 50)
        soon(cards[2]).to_have_attribute("aria-current", "step")
        stage_has(cards[2], "data-ticks", "16")
        soon(cards[2]).to_contain_text(f"Data root {BLOCK2_DATA_ROOT}")


def test_wf_square_walk_motion_scroll(browser: Browser, world: World) -> None:
    with open_frozen(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2",
                     init_script=WALK_FROM_LOAD) as page:
        page.mouse.move(DESKTOP[0] // 2, 10)
        walk = page.get_by_role("list", name="Square walk")
        cards = [walk.get_by_role("article", name=n) for n in ("Lay out", "Extend", "Commit")]
        wait_text(page, f"Data root {BLOCK2_DATA_ROOT}")
        soon(grid(page, 2)).to_be_visible()
        top = walk.evaluate("e => e.getBoundingClientRect().top + window.scrollY")
        early = next((e for e in page.evaluate("() => window.__walk") if e["states"][0] != "hidden"), None)
        if early is None:
            page.evaluate("y => window.scrollTo(0, y)", max(0, top - DESKTOP[1] // 2))
        else:
            assert early["top"] <= 0.8 * early["vh"] + 1, f"cards rose with the list top at {early['top']} px, below 80% of the viewport"
        until(page, "() => window.__walk.some(e => e.states[0] === 'rising')", None, UI_WAIT_S)
        page_advance(page, 1_000)
        log = page.evaluate("() => window.__walk")
        page_advance(page, 1_500)
        first_t = lambda i, s: next(e["t"] for e in log if e["states"][i] == s)
        t0 = first_t(0, "rising")
        for i in range(3):
            assert abs(first_t(i, "rising") - t0 - i * WALK_STAGGER_MS) <= TIMING_TOLERANCE_MS, f"card {i + 1} start"
            assert abs(first_t(i, "shown") - first_t(i, "rising") - WALK_RISE_MS) <= TIMING_TOLERANCE_MS, f"card {i + 1} rise"
        at150 = [next((e["states"] for e in reversed(log) if e["t"] <= t0 + 150), None)]
        assert at150[0] == ["rising", "rising", "hidden"]
        at700 = next(e["states"] for e in reversed(log) if e["t"] <= t0 + 700)
        assert at700 == ["shown", "shown", "rising"]

        end = page.evaluate("() => document.documentElement.scrollHeight - window.innerHeight")
        start = max(0, top - DESKTOP[1])
        positions = [round(start + (end - start) * i / SCROLL_STEPS) for i in range(SCROLL_STEPS + 1)]

        def active() -> int:
            marks = [c.get_attribute("aria-current") for c in cards]
            assert marks.count("step") == 1, f"exactly one active card, got {marks}"
            return marks.index("step") + 1

        forward, backward = [], []
        for y in positions:
            page.evaluate("y => window.scrollTo(0, y)", y)
            page_advance(page, 50)
            forward.append(active())
        for y in reversed(positions):
            page.evaluate("y => window.scrollTo(0, y)", y)
            page_advance(page, 50)
            backward.append(active())
        assert forward == sorted(forward) and forward[0] == 1 and forward[-1] == 3 and 2 in forward, f"forward {forward}"
        assert backward == sorted(backward, reverse=True) and backward[-1] == 1 and 2 in backward, f"backward {backward}"
        page_advance(page, 1_500)
        for card, attribute, value in ((cards[0], "data-cells", "16"), (cards[1], "data-cells", "64"), (cards[2], "data-ticks", "16")):
            eventually(page, lambda card=card, attribute=attribute, value=value: _stage_is(card, attribute, value))
        soon(cards[2]).to_contain_text(f"Data root {BLOCK2_DATA_ROOT}")
        def settles_on(n: int) -> None:
            eventually(page, lambda: _expect_active(n))

        def _expect_active(n: int) -> None:
            assert active() == n, f"active card {active()}, expected {n}"

        page.evaluate("y => window.scrollTo(0, y)", end)
        settles_on(3)
        ready(cards[0]).hover()
        settles_on(1)
        page.mouse.move(DESKTOP[0] // 2, 10)
        settles_on(3)
        ready(cards[0]).focus()
        for _ in range(6):
            if cards[1].evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        soon(cards[1]).to_be_focused()
        settles_on(2)


def test_wf_square_walk_motion_explorer_components(browser: Browser, world: World) -> None:
    showcase_cards = (("Orchard", ORCHARD, "2 blobs"), ("Harbor", HARBOR, "1 blob"), ("Lantern", LANTERN, "2 blobs"))
    with open_frozen(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer") as page:
        hero = grid(page, 5)
        soon(hero).to_be_visible()
        soon(hero.get_by_role("gridcell")).to_have_count(16)
        showcase = page.get_by_role("list", name="Namespace showcase")
        for name, hex_, blobs in showcase_cards:
            card = showcase.get_by_role("listitem").filter(has_text=name)
            soon(card).to_contain_text(hex_)
            soon(card).to_contain_text(blobs)
        marquee = page.get_by_role("region", name="Validators")
        marquee.scroll_into_view_if_needed()
        soon(marquee).to_have_attribute("data-motion", re.compile("^(running|paused|off)$"))
        pill = page.get_by_role("link", name="Register a namespace").or_(page.get_by_role("button", name="Register a namespace"))
        pill.scroll_into_view_if_needed()
        soon(pill).to_be_visible()
        at_least(pill)
        headings = page.get_by_role("heading").all()
        assert len(headings) > 1, "explorer shows no section headings"
        for heading in headings:
            soon(heading).not_to_have_accessible_name(re.compile(r"^(\S )+\S$"))
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        layout(page)
        spotlight = page.get_by_role("region", name="Light nodes")
        for node in ("Wren", "Kestrel"):
            link = spotlight.get_by_role("link", name=f"Open {node}")
            link.scroll_into_view_if_needed()
            soon(link).to_be_visible()
            at_least(link)
        click(spotlight.get_by_role("link", name="Open Kestrel"))
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/nodes/{world.node('kestrel')}")


@pytest.mark.timeout(900)
def test_storage_outage_refusals(storage_down: World) -> None:
    w = storage_down
    base = w.base
    h = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
    assert h.status_code == 200 and h.json() == {"status": "unavailable"}
    felix = w.api("felix")
    expect_error(submit_blob(felix, w, HARBOR, b"down"), 503, {"error": SUBMIT_DOWN})
    expect_field(felix.post(w.w("/blobs"), {"namespace": HARBOR, "dataBase64": b64(b"x"), "fee": "0.000001"}), "fee",
                 "Fee too low: this blob needs at least 0.006552 FERN.")
    expect_error(w.api("priya").get(w.w("/blocks/2/snapshot")), 503, {"error": SNAPSHOT_DOWN})
    assert block(felix, w, 2)["dataRoot"] == BLOCK2_DATA_ROOT
    assert share_cells(felix, w, 3)[(0, 2)]["share"] == BLOCK3_SHARES[(0, 2)]
    assert felix.json(w.w("/blocks/2/proofs"), namespace=HARBOR)["rows"][0]["kind"] == "inclusion"
    created(felix.post(w.w("/namespaces"), {"name": "Offline space", "hex": fresh_hex()}))
    created(felix.post(w.w("/staking/delegate"), {"validator": w.validator("cedar"), "amount": "1"}))
    created(felix.post(w.w("/proposals/3/votes"), {"option": "yes"}))


def _storage_ui(browser: Browser, w: World) -> None:
    with open_as(browser, w.base, w.session("felix"), f"/w/{w.fern}/submit") as page:
        form = page.get_by_role("form", name="Submit blob")
        select(form.get_by_role("combobox", name="Namespace"), "Harbor")
        fill(form.get_by_role("textbox", name="Data"), "offline blob")
        form.get_by_role("textbox", name="Fee (FERN)").press("Enter")
        wait_text(page, SUBMIT_DOWN)
        reg = page.get_by_role("form", name="Register namespace")
        outage_name = "Outage space"
        fill(reg.get_by_role("textbox", name="Namespace name"), outage_name)
        hexbox = reg.get_by_role("textbox", name="Namespace hex")
        fill(hexbox, fresh_hex())
        hexbox.press("Enter")
        said(reg, "Register namespace status", f"Namespace {outage_name} registered.")
        page.goto(f"{w.base}/w/{w.fern}/explorer/blocks/2")
        soon(grid(page, 2)).to_be_visible()
        wait_text(page, f"Data root {BLOCK2_DATA_ROOT}")
        click(page.get_by_role("button", name="Download square snapshot"))
        wait_text(page, SNAPSHOT_DOWN)
    assert not [b for b in w.api("felix").json(w.w("/blobs"), mine="true") if b["status"] == "pending"]


@pytest.mark.timeout(900)
def test_wf_storage_outage_recovers(browser: Browser) -> None:
    relay = Relay(endpoint_of(os.environ.get("S3_ENDPOINT") or pytest.fail("S3_ENDPOINT is not set in the verifier")))
    try:
        with scratch_database() as scratch, app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}", "DATABASE_URL": scratch}) as base:
            w = World(base, seed(base))
            felix = w.api("felix")
            relay.set_up(False)
            health = lambda want: httpx.get(base + "/api/health", timeout=10).json().get("status") == want
            poll(lambda: health("unavailable"), STORAGE_RECHECK_S + 10, "health never reported unavailable")
            expect_error(submit_blob(felix, w, HARBOR, b"waiting"), 503, {"error": SUBMIT_DOWN})
            _storage_ui(browser, w)
            w.advance(BLOCK_MS)
            with open_as(browser, base, w.session("felix"), f"/w/{w.fern}/explorer/blocks/2") as page:
                click(page.get_by_role("button", name="Download square snapshot"))
                wait_text(page, SNAPSHOT_DOWN)
                relay.set_up(True)
                poll(lambda: health("ok"), STORAGE_RECHECK_S + 10, "health never recovered")
                with page.expect_download() as info:
                    click(page.get_by_role("button", name="Download square snapshot"))
                assert Path(info.value.path()).read_bytes() == S3().get(f"squares/{w.fern}/2.bin")
                said(page, "Snapshot status", "Snapshot ready.")
            payload = b"after recovery"
            tx = created(submit_blob(felix, w, HARBOR, payload))
            assert S3().get(f"blobs/{tx['blobId']}") == payload
            key = f"squares/{w.fern}/6.bin"
            poll(lambda: key in S3().keys(f"squares/{w.fern}/"), SNAPSHOT_RETRY_S + 5, "block 6 snapshot was not written after storage returned")
            assert S3().get(key) == felix.get(w.w("/blocks/6/snapshot")).content
    finally:
        relay.close()


@pytest.mark.timeout(900)
def test_boots_and_serves_with_storage_unreachable() -> None:
    with scratch_database() as scratch, app_copy({"S3_ENDPOINT": "http://127.0.0.1:9", "DATABASE_URL": scratch}) as base:
        poll(lambda: httpx.get(base + "/api/health", timeout=10).json().get("status") == "unavailable",
             STORAGE_RECHECK_S + 10, "health never reported unavailable")
        assert httpx.get(base + "/", timeout=HTTP_TIMEOUT, follow_redirects=True).status_code == 200


@pytest.mark.timeout(900)
def test_mail_outbox_retries_until_smtp_accepts(mail: Mailpit) -> None:
    down = outage_base("APP_MAIL_DOWN_URL")
    dw = World(down, seed(down))
    _, early = unique("outbox")
    created(dw.api("amara").post(dw.w("/invites"), {"email": early, "role": "viewer"}))
    smtp_host, smtp_port = os.environ.get("SMTP_HOST"), os.environ.get("SMTP_PORT")
    if not smtp_host or not smtp_port:
        pytest.fail("SMTP_HOST and SMTP_PORT must be set in the verifier to relay Mailpit")
    relay = Relay((smtp_host, int(smtp_port)))
    relay.set_up(False)
    try:
        with scratch_database() as scratch, app_copy({"SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(relay.port), "DATABASE_URL": scratch}) as base:
            w = World(base, seed(base))
            mail.clear()
            _, email = unique("outbox")
            created(w.api("amara").post(w.w("/invites"), {"email": email, "role": "developer"}))
            held_back = mail.messages(expected=0, settle=MAIL_RETRY_S + 2)
            assert not [m for m in held_back if email in addresses(m["To"])], "mail arrived while SMTP was down"
            relay.set_up(True)
            poll(lambda: [m for m in mail.messages() if email in addresses(m["To"])], 3 * MAIL_RETRY_S + 15, "outbox never delivered after SMTP returned")
            final = [m for m in mail.messages(expected=1, settle=MAIL_RETRY_S + 2) if email in addresses(m["To"])]
            assert len(final) == 1 and final[0]["Subject"] == "Join Fernhill Labs on Fernsquare"
    finally:
        relay.close()


def test_if_run_manifest() -> None:
    run = json.loads(Path("/app/run.json").read_text())
    assert run.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(run.get(key), str) and run[key].strip(), f"run.json {key} must be a command string"


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"packages with disallowed licences: {bad[:20]}"


def test_if_no_extra_services() -> None:
    forbidden = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "amqplib",
                 "kafkajs", "memcached", "bull", "bullmq", "nats", "@elastic/elasticsearch"}
    found = sorted({p.name for p in shipped_packages()} & forbidden)
    assert not found, f"shipped clients for extra services: {found}"


def test_if_no_fonts_or_remote_assets(browser: Browser, app_url: str) -> None:
    fonts = [p for p in Path("/app").rglob("*") if p.suffix.lower() in {".woff", ".woff2", ".ttf", ".otf", ".eot"}
             and "node_modules" not in p.parts and ".git" not in p.parts]
    assert not fonts, f"font files shipped: {fonts[:5]}"
    w = World(app_url, seed(app_url))
    seen: list[tuple[str, str]] = []
    with open_as(browser, app_url, w.session("felix"), "/signin") as page:
        page.on("request", lambda req: seen.append((req.url, req.resource_type)))
        page.goto(f"{app_url}/w/{w.fern}/explorer")
        soon(page.get_by_role("table", name="Blocks")).to_be_visible()
    offsite = [u for u, _ in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not offsite, f"off-origin requests: {offsite[:5]}"
    assert not [u for u, t in seen if t == "font"], "the page fetched a font"


def test_if_lockfile_used() -> None:
    assert Path("/app/package-lock.json").is_file()
    assert "npm ci" in json.loads(Path("/app/run.json").read_text())["install"]


def test_if_service_config_unchanged() -> None:
    app = Path("/app")
    patterns = ("docker-compose*.yml", "docker-compose*.yaml", "compose*.yml", "compose*.yaml", ".env", ".env.*")
    candidates = sorted({p for pat in patterns for p in app.glob(pat) if p.is_file()})
    if (app / ".git").exists():
        roots = subprocess.run(["git", "-C", str(app), "rev-list", "--max-parents=0", "HEAD"], capture_output=True, text=True).stdout.split()
        assert roots, "/app has no root commit"
        for path in candidates:
            rel = path.relative_to(app).as_posix()
            original = subprocess.run(["git", "-C", str(app), "show", f"{roots[-1]}:{rel}"], capture_output=True)
            if original.returncode == 0:
                assert original.stdout == path.read_bytes(), f"{rel} was changed"
        return
    trajectory = Path("/logs/agent/trajectory.json")
    if trajectory.exists():
        raw = trajectory.read_text(errors="replace")
        for path in candidates:
            assert f'"file_path": "{path}"' not in raw, f"the agent wrote {path}"


def _form_says(form: Locator, copy: str) -> None:
    soon(form.get_by_role("alert").or_(form.get_by_role("status")).filter(has_text=copy).first).to_be_visible()


def test_wf_blob_submit_live_viewer_sees_inclusion(browser: Browser, world: World) -> None:
    _, _, ufern = FEE_TABLE[120]
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer") as viewer, \
            open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        wait_text(viewer, "Mempool 2 blobs")
        form = page.get_by_role("form", name="Submit blob")
        select(form.get_by_role("combobox", name="Namespace"), "Orchard")
        fill(form.get_by_role("textbox", name="Data"), "o" * 120)
        estimate = form.get_by_role("region", name="Blob estimate")
        soon(estimate).to_contain_text("Shares 3")
        soon(estimate).to_contain_text(f"Fee {shown(ufern)} FERN")
        fee = form.get_by_role("textbox", name="Fee (FERN)")
        ready(fee).focus()
        fee.press("Enter")
        said(form, "Submit blob status", "Blob submitted. It is pending until a block includes it.")
        yours = page.get_by_role("table", name="Your blobs")
        soon(yours).to_contain_text("Pending")
        wait_text(viewer, "Mempool 3 blobs", LIVE_DEADLINE_S)
        soon(yours).not_to_contain_text("Included in block 6")
        mine = [b for b in world.api("felix").json(world.w("/blobs"), mine="true") if b["status"] == "pending"]
        assert len(mine) == 1
        world.advance(BLOCK_MS)
        expect(viewer.get_by_role("status", name="Network updates")).to_contain_text("Block 6 produced: 3 blobs, square 4 × 4.", timeout=LIVE_DEADLINE_S * 1000)
        until(page, "() => document.body.innerText.includes('Included in block 6')", None, LIVE_DEADLINE_S)
        expect(yours).to_contain_text("Included in block 6")
        page.goto(f"{world.base}/w/{world.fern}/blobs/{mine[0]['id']}")
        facts = page.get_by_role("list", name="Blob facts")
        for line in ("Included in block 6", "Size 120 bytes", "Shares 3", f"Fee {shown(ufern)} FERN"):
            soon(facts).to_contain_text(line)
        soon(page.get_by_role("link", name="Block 6", exact=True)).to_be_visible()
        soon(page.get_by_role("list", name="Share positions").get_by_role("listitem")).to_have_text(["(1, 2)", "(1, 3)", "(2, 0)"])


def test_wf_submit_refusals_namespace_order_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        form = page.get_by_role("form", name="Register namespace")
        name = form.get_by_role("textbox", name="Namespace name")
        hexbox = form.get_by_role("textbox", name="Namespace hex")
        fill(name, "Order space")
        cases = (
            ("zz00000000000000a1", "Namespace must use only the characters 0-9 and a-f."),
            ("00000000000000a1", "Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has 16."),
            ("02000000000000c400", "Only namespace version 00 is open to users."),
            ("0000000000000000FE", "Namespace 0000000000000000fe is reserved."),
        )
        for value, message in cases:
            fill(hexbox, value)
            hexbox.press("Enter")
            soon(form.get_by_role("alert")).to_contain_text(message)
            soon(hexbox).to_have_accessible_description(re.compile(re.escape(message)))
            soon(hexbox).to_be_focused()
        hex_ = fresh_hex()
        fill(name, "")
        fill(hexbox, hex_)
        hexbox.press("Enter")
        soon(form.get_by_role("alert")).to_contain_text("Give the namespace a name.")
        soon(name).to_be_focused()
        soon(name).to_have_accessible_description(re.compile(re.escape("Give the namespace a name.")))
    assert hex_ not in [n["hex"] for n in world.api("felix").json(world.w("/namespaces"))]


def test_wf_submit_refusals_blob_size_and_balance(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        wait_text(page, "Available 5,000.000000 FERN")
        form = page.get_by_role("form", name="Submit blob")
        data = form.get_by_role("textbox", name="Data")
        fee = form.get_by_role("textbox", name="Fee (FERN)")
        select(form.get_by_role("combobox", name="Namespace"), "Lantern")
        ready(fee).focus()
        fee.press("Enter")
        soon(form.get_by_role("alert")).to_contain_text("A blob must contain at least 1 byte.")
        soon(data).to_be_focused()
        fill(data, "s" * (MAX_BLOB + 1))
        ready(fee).focus()
        fee.press("Enter")
        too_big = "This blob is 3,453 bytes; a block holds at most 3,452 bytes of blob data."
        soon(form.get_by_role("alert")).to_contain_text(too_big)
        soon(data).to_have_accessible_description(re.compile(re.escape(too_big)))
        soon(data).to_be_focused()
        fill(data, "s")
        fill(fee, "5000.000001")
        fee.press("Enter")
        broke = "Insufficient balance: available 5,000.000000 FERN, this blob needs 5,000.000001 FERN."
        soon(form.get_by_role("alert")).to_contain_text(broke)
        soon(fee).to_be_focused()
        soon(page.get_by_role("table", name="Your blobs")).not_to_contain_text("Pending")
        wait_text(page, "Available 5,000.000000 FERN")
    assert staking_me(world.api("felix"), world)["availableUfern"] == 5_000 * UFERN


@pytest.mark.timeout(900)
def test_wf_storage_outage_submit_keyboard(browser: Browser, storage_down: World) -> None:
    w = storage_down
    base = w.base
    with open_as(browser, base, w.session("felix"), f"/w/{w.fern}/submit") as page:
        wait_text(page, "Available 5,000.000000 FERN")
        form = page.get_by_role("form", name="Submit blob")
        select(form.get_by_role("combobox", name="Namespace"), "Harbor")
        fill(form.get_by_role("textbox", name="Data"), "x")
        fee = form.get_by_role("textbox", name="Fee (FERN)")
        fill(fee, "0.000001")
        fee.press("Enter")
        soon(form.get_by_role("alert")).to_contain_text("Fee too low: this blob needs at least 0.006552 FERN.")
        fill(form.get_by_role("textbox", name="Data"), "y" * 200)
        fill(fee, fern(FEE_TABLE[200][2]))
        fee.press("Enter")
        wait_text(page, SUBMIT_DOWN)
        _form_says(form, SUBMIT_DOWN)
        soon(page.get_by_role("table", name="Your blobs")).not_to_contain_text("Pending")
        wait_text(page, "Available 5,000.000000 FERN")
    assert w.api("felix").json(w.w("/mempool"))["count"] == 2


@pytest.mark.timeout(900)
def test_wf_storage_outage_snapshot_viewer_keyboard(browser: Browser, storage_down: World) -> None:
    w = storage_down
    base = w.base
    with open_as(browser, base, w.session("priya"), f"/w/{w.fern}/explorer/blocks/3") as page:
        soon(grid(page, 3)).to_be_visible()
        soon(page.get_by_role("gridcell", name="Share 0, 2: Parity", exact=True)).to_have_attribute("data-share", BLOCK3_SHARES[(0, 2)])
        soon(page.get_by_role("list", name="Row roots").get_by_role("listitem").filter(has_text="Row 0")).to_have_attribute("data-hash", BLOCK3_ROW0)
        wait_text(page, f"Data root {BLOCK3_DATA_ROOT}")
        button = page.get_by_role("button", name="Download square snapshot")
        soon(button).to_be_enabled()
        ready(button).focus()
        page.keyboard.press("Enter")
        wait_text(page, SNAPSHOT_DOWN)


@pytest.mark.timeout(900)
def test_wf_storage_outage_proofs_keyboard(browser: Browser, storage_down: World) -> None:
    w = storage_down
    base = w.base
    with open_as(browser, base, w.session("felix"), f"/w/{w.fern}/explorer/blocks/2") as page:
        box = page.get_by_role("textbox", name="Namespace to prove")
        fill(box, HARBOR)
        box.press("Enter")
        region = page.get_by_role("region", name="Namespace proof")
        soon(region).to_contain_text("Row 0: inclusion, columns 3 to 3, 3 proof nodes")
        soon(region).to_contain_text("Row 1: inclusion, columns 0 to 1, 2 proof nodes")
        nodes = region.get_by_role("list", name="Row 0 proof nodes").get_by_role("listitem")
        soon(nodes.first).to_have_attribute("data-hash", HARBOR_ROW0_NODES[0])
        verify = region.get_by_role("button", name="Verify row 0")
        ready(verify).focus()
        page.keyboard.press("Enter")
        soon(region).to_contain_text("Verified against row 0 root.")
        fill(box, ABSENT_NS)
        box.press("Enter")
        soon(region).to_contain_text("Row 0: absence, next leaf at column 3")


@pytest.mark.timeout(900)
def test_wf_storage_outage_explorer_register(browser: Browser, storage_down: World) -> None:
    w = storage_down
    base = w.base
    h = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
    assert h.status_code == 200 and h.json() == {"status": "unavailable"}
    with open_as(browser, base, w.session("amara"), f"/w/{w.fern}/explorer") as page:
        stats = page.get_by_role("region", name="Network stats")
        soon(stats).to_contain_text("5 blocks")
        wait_text(page, "Mempool 2 blobs")
        soon(page.get_by_role("table", name="Blocks").get_by_role("link", name="5", exact=True)).to_be_visible()
        page.goto(f"{base}/w/{w.fern}/submit")
        reg = page.get_by_role("form", name="Register namespace")
        fill(reg.get_by_role("textbox", name="Namespace name"), "Quiet space")
        hexbox = reg.get_by_role("textbox", name="Namespace hex")
        hex_ = fresh_hex()
        fill(hexbox, hex_)
        hexbox.press("Enter")
        said(reg, "Register namespace status", f"Namespace {'Quiet space'} registered.")
    assert hex_ in [n["hex"] for n in w.api("amara").json(w.w("/namespaces"))]


def test_wf_cross_cutting_keyboard_signin_deep_link(browser: Browser, world: World) -> None:
    amara, jonas = world.person("amara"), world.person("jonas")
    with open_as(browser, world.base, None, "/signin") as page:
        ready(page.get_by_role("form", name="Sign in").get_by_role("textbox", name="Email")).focus()
        page.keyboard.type(amara["email"])
        page.keyboard.press("Tab")
        page.keyboard.type(amara["password"])
        page.keyboard.press("Enter")
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/explorer")
        nav = page.get_by_role("navigation", name="Workspace")
        soon(nav.get_by_role("link", name="Explorer", exact=True)).to_have_attribute("aria-current", "page")
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/3")
        soon(page.get_by_role("heading", name="Block 3", exact=True)).to_be_visible()
        page.reload()
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/explorer/blocks/3")
        soon(page.get_by_role("heading", name="Block 3", exact=True)).to_be_visible()
    with open_as(browser, world.base, None, "/signin") as page:
        form = page.get_by_role("form", name="Sign in")
        fill(form.get_by_role("textbox", name="Email"), jonas["email"])
        password = form.get_by_label("Password")
        fill(password, jonas["password"])
        password.press("Enter")
        soon(page).to_have_url(f"{world.base}/w/{world.quarry}/explorer")


def test_wf_cross_cutting_other_workspace_pages_not_found(browser: Browser, world: World) -> None:
    blob = world.data["blobs"]["block2"][2]
    pages = [f"/w/{world.fern}/blobs/{blob['id']}", f"/w/{world.fern}/nodes/{world.node('wren')}",
             f"/w/{world.fern}/explorer/tx/{blob['txId']}", f"/w/{world.fern}/vote/3", f"/w/{world.fern}/members",
             f"/w/{world.quarry}/blobs/{blob['id']}"]
    with open_as(browser, world.base, world.session("jonas"), pages[0]) as page:
        for i, path in enumerate(pages):
            if i:
                page.goto(world.base + path)
            soon(page.get_by_role("heading", name="Not found", exact=True)).to_be_visible()
            text = page_text(page)
            for leak in ("Felix Navarro", "Fund a public sampling dashboard", HARBOR):
                assert leak not in text, f"{path} leaks {leak!r}"
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.quarry}/nodes/{world.node('heron')}") as page:
        soon(page.get_by_role("heading", name="Not found", exact=True)).to_be_visible()
        soon(page.get_by_role("button", name="Take sample")).to_have_count(0)


BLOCK2_BLOBS = [(ORCHARD, b"o" * 60), (ORCHARD, b"p" * 10), (HARBOR, b"h" * 120), (LANTERN, b"l" * 20)]
MEMPOOL_BLOBS = [(ORCHARD, b"q" * 300), (LANTERN, b"r" * 200)]


def _extended(blobs: list[tuple[str, bytes]]) -> list[list[bytes]]:
    return extend_square(original_square(blobs))


def _row_leaves(ext: list[list[bytes]], r: int) -> list[Node]:
    k = len(ext) // 2
    return [leaf_node(ext[r][c][:9] if r < k and c < k else PARITY_NS, ext[r][c]) for c in range(2 * k)]


def _cover(leaves: list[Node], lo: int, hi: int, start: int, end: int) -> list[Node]:
    if hi <= start or lo >= end:
        return [nmt_root(leaves[lo:hi])]
    if hi - lo == 1:
        return []
    mid = (lo + hi) // 2
    return _cover(leaves, lo, mid, start, end) + _cover(leaves, mid, hi, start, end)


def _submit_ui(page: Page, namespace_name: str, text: str) -> None:
    form = page.get_by_role("form", name="Submit blob")
    select(form.get_by_role("combobox", name="Namespace"), namespace_name)
    fill(form.get_by_role("textbox", name="Data"), text)
    form.get_by_role("textbox", name="Fee (FERN)").press("Enter")
    said(form, "Submit blob status", "Blob submitted. It is pending until a block includes it.")


def _panel_body(page: Page, r: int, c: int) -> str:
    dialog = page.get_by_role("dialog", name=f"Share {r}, {c}")
    soon(dialog).to_be_visible()
    return norm(dialog.inner_text()).lower()


def test_wf_square_layout_legend_and_continuation(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2") as page:
        legend = page.get_by_role("list", name="Namespace legend").get_by_role("listitem")
        soon(legend).to_have_count(4)
        for name, hex_, count in (("Orchard", ORCHARD, 3), ("Harbor", HARBOR, 3), ("Lantern", LANTERN, 1)):
            item = legend.filter(has_text=name)
            soon(item).to_have_attribute("data-namespace", hex_)
            soon(item).to_have_attribute("data-count", str(count))
            soon(item).to_contain_text(re.compile(rf"\b{count} shares?\b"))
        soon(legend.filter(has_text="Lantern")).to_contain_text(re.compile(r"\b1 share(?!s)"))
        padding = legend.filter(has_text="Padding")
        soon(padding).to_have_attribute("data-count", "9")
        soon(padding).to_contain_text("9 shares")
        ready(page.get_by_role("gridcell", name="Share 0, 0: Orchard", exact=True)).focus()
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        first = page.get_by_role("gridcell", name="Share 0, 3: Harbor", exact=True)
        soon(first).to_be_focused()
        page.keyboard.press("Enter")
        body = _panel_body(page, 0, 3)
        for line in (f"namespace {HARBOR}", "info byte 01", "sequence length 120 bytes", "data " + "68" * 50):
            assert line in body, f"share (0, 3) panel lacks {line!r}"
        page.keyboard.press("Escape")
        soon(first).to_be_focused()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Home")
        cont = page.get_by_role("gridcell", name="Share 1, 0: Harbor", exact=True)
        soon(cont).to_be_focused()
        page.keyboard.press("Enter")
        body = _panel_body(page, 1, 0)
        for line in (f"namespace {HARBOR}", "info byte 00", "data " + "68" * 54):
            assert line in body, f"share (1, 0) panel lacks {line!r}"
        assert "sequence length" not in body, "a continuation share has no sequence length (L168 first shares only)"
        page.keyboard.press("Escape")
        soon(cont).to_be_focused()


def test_wf_square_layout_second_lantern_live(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer") as amara_page, \
            open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        wait_text(amara_page, "Mempool 2 blobs")
        _submit_ui(page, "Lantern", "z" * 120)
        wait_text(amara_page, "Mempool 3 blobs", LIVE_DEADLINE_S)
        world.advance(BLOCK_MS)
        expect(amara_page.get_by_role("status", name="Network updates")).to_contain_text(
            "Block 6 produced: 3 blobs, square 4 × 4.", timeout=LIVE_DEADLINE_S * 1000)
        expect(grid(amara_page, 6)).to_be_visible(timeout=LIVE_DEADLINE_S * 1000)
        page_advance(amara_page, 8 * ROW_REVEAL_MS + 100)
        for r, c in ((1, 2), (1, 3), (2, 0), (2, 1)):
            expect(amara_page.get_by_role("gridcell", name=f"Share {r}, {c}: Lantern", exact=True)).to_have_attribute("data-mine", "true")
        for r, c in ((2, 2), (2, 3), (3, 0)):
            soon(amara_page.get_by_role("gridcell", name=f"Share {r}, {c}: Lantern", exact=True)).not_to_have_attribute("data-mine", "true")
        for c in (1, 2, 3):
            soon(amara_page.get_by_role("gridcell", name=f"Share 3, {c}: Padding", exact=True)).to_have_attribute("data-kind", "padding")
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/6")
        mine = page.get_by_role("gridcell", name="Share 2, 2: Lantern", exact=True)
        soon(mine).to_have_attribute("data-mine", "true")
        soon(mine).to_have_attribute("data-share", (LANTERN + "01" + f"{120:08x}") + "7a" * 50)
        soon(page.get_by_role("gridcell", name="Share 1, 2: Lantern", exact=True)).not_to_have_attribute("data-mine", "true")


def test_wf_square_layout_blob_waits_for_next_block(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        _submit_ui(page, "Harbor", "w" * MAX_BLOB)
        updates = page.get_by_role("status", name="Network updates")
        yours = page.get_by_role("table", name="Your blobs")
        world.advance(BLOCK_MS)
        expect(updates).to_contain_text("Block 6 produced: 2 blobs, square 4 × 4.", timeout=LIVE_DEADLINE_S * 1000)
        expect(yours.get_by_role("row").filter(has_text="Pending")).to_have_count(1)
        expect(yours).not_to_contain_text("Included in block 6")
        world.advance(BLOCK_MS)
        expect(updates).to_contain_text(f"Block {7} produced: {1} blob, square {8} × {8}.", timeout=LIVE_DEADLINE_S * 1000)
        expect(yours.get_by_role("row").filter(has_text="Included in block 7")).to_have_count(1, timeout=LIVE_DEADLINE_S * 1000)
        expect(yours.get_by_role("row").filter(has_text="Pending")).to_have_count(0)
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/7")
        g = grid(page, 7)
        soon(g.get_by_role("gridcell")).to_have_count(256)
        last = page.get_by_role("gridcell", name="Share 7, 7: Harbor", exact=True)
        ready(last).focus()
        page.keyboard.press("Control+Home")
        soon(page.get_by_role("gridcell", name="Share 0, 0: Harbor", exact=True)).to_be_focused()


def test_wf_erasure_extension_block2_parity_keyboard(browser: Browser, world: World) -> None:
    ext = _extended(BLOCK2_BLOBS)
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2") as page:
        ready(page.get_by_role("gridcell", name="Share 0, 0: Orchard", exact=True)).focus()
        steps = (("End", (0, 7), "Q1"), ("ArrowDown", (1, 7), "Q1"), ("ArrowDown", (2, 7), "Q1"), ("ArrowDown", (3, 7), "Q1"),
                 ("ArrowDown", (4, 7), "Q3"), ("Home", (4, 0), "Q2"), ("ArrowRight", (4, 1), "Q2"), ("Control+End", (7, 7), "Q3"))
        for key, (r, c), quadrant in steps:
            page.keyboard.press(key)
            target = page.get_by_role("gridcell", name=f"Share {r}, {c}: Parity", exact=True)
            soon(target).to_be_focused()
            soon(target).to_have_attribute("data-quadrant", quadrant)
            soon(target).to_have_attribute("data-kind", "parity")
            soon(target).to_have_attribute("data-share", ext[r][c].hex())
        page.keyboard.press("Enter")
        body = _panel_body(page, 7, 7)
        assert f"info byte {ext[7][7][9]:02x}" in body, f"share (7, 7) panel lacks info byte {ext[7][7][9]:02x}"
        page.keyboard.press("Escape")
        soon(page.get_by_role("gridcell", name="Share 7, 7: Parity", exact=True)).to_be_focused()
        soon(page.get_by_role("gridcell", name="Share 3, 3: Padding", exact=True)).to_have_attribute("data-quadrant", "Q0")


def test_wf_erasure_extension_new_block_viewer_live(browser: Browser, world: World) -> None:
    payload = b"Fern square parity"
    ext = _extended(MEMPOOL_BLOBS + [(HARBOR, payload)])
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer") as viewer, \
            open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        soon(grid(viewer, 5)).to_be_visible()
        _submit_ui(page, "Harbor", payload.decode())
        world.advance(BLOCK_MS)
        expect(viewer.get_by_role("status", name="Network updates")).to_contain_text(
            "Block 6 produced: 3 blobs, square 4 × 4.", timeout=LIVE_DEADLINE_S * 1000)
        expect(grid(viewer, 6)).to_be_visible(timeout=LIVE_DEADLINE_S * 1000)
        page_advance(viewer, 8 * ROW_REVEAL_MS + 100)
        harbor = viewer.get_by_role("gridcell", name="Share 1, 2: Harbor", exact=True)
        expect(harbor).to_have_attribute("data-share", ext[1][2].hex())
        viewer.get_by_role("gridcell", name="Share 0, 0: Orchard", exact=True).focus()
        for key, (r, c), quadrant in (("Control+End", (7, 7), "Q3"), ("Home", (7, 0), "Q2"), ("ArrowUp", (6, 0), "Q2"),
                                      ("End", (6, 7), "Q3"), ("Control+Home", (0, 0), "Q0"), ("End", (0, 7), "Q1")):
            viewer.keyboard.press(key)
            target = viewer.get_by_role("gridcell", name=re.compile(rf"^Share {r}, {c}: "))
            soon(target).to_be_focused()
            soon(target).to_have_attribute("data-quadrant", quadrant)
            soon(target).to_have_attribute("data-share", ext[r][c].hex())


def test_wf_erasure_extension_snapshots_by_keyboard(browser: Browser, world: World) -> None:
    ext3 = _extended([(LANTERN, BLOCK3_TEXT)])
    expected3 = b"".join(ext3[r][c] for r in range(4) for c in range(4))
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer/blocks/3") as page:
        button = page.get_by_role("button", name="Download square snapshot")
        soon(button).to_be_enabled()
        with page.expect_download() as info:
            ready(button).focus()
            page.keyboard.press("Enter")
        content3 = Path(info.value.path()).read_bytes()
        said(page, "Snapshot status", "Snapshot ready.")
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/5")
        button = page.get_by_role("button", name="Download square snapshot")
        with page.expect_download() as info:
            ready(button).focus()
            page.keyboard.press("Enter")
        content5 = Path(info.value.path()).read_bytes()
        said(page, "Snapshot status", "Snapshot ready.")
    assert content3 == expected3 and len(content3) == 16 * 64
    for (r, c), hex_ in BLOCK3_SHARES.items():
        off = (r * 4 + c) * 64
        assert content3[off : off + 64].hex() == hex_, f"block 3 snapshot share ({r}, {c})"
    off = 2 * 64
    assert content5[off + 14] == 0x1B, "block 5 share (0, 2) byte 14 must be flipped to 1b (L674)"
    flipped = bytearray(ext3[0][2])
    flipped[14] ^= 1
    assert content5[off : off + 64] == bytes(flipped)
    assert content5[:off] == expected3[:off], "block 5 shares before (0, 2) equal block 3's"


def test_wf_nmt_proofs_block3_and_committed_block5_roots(browser: Browser, world: World) -> None:
    ext3 = _extended([(LANTERN, BLOCK3_TEXT)])
    rows3, cols3 = square_roots(ext3)
    assert data_root(rows3, cols3).hex() == BLOCK3_DATA_ROOT and rows3[0][2].hex() == BLOCK3_ROW0
    bad = [list(row) for row in ext3]
    flipped = bytearray(bad[0][2])
    flipped[14] ^= 1
    bad[0][2] = bytes(flipped)
    rows5, cols5 = square_roots(bad)
    assert rows5[0][2].hex() == FRAUD5_COMMITTED
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer") as page:
        for h, rows, cols in ((3, rows3, cols3), (5, rows5, cols5)):
            if h == 5:
                page.goto(f"{world.base}/w/{world.fern}/explorer")
            link = page.get_by_role("table", name="Blocks").get_by_role("link", name=str(h), exact=True)
            ready(link).focus()
            page.keyboard.press("Enter")
            soon(page).to_have_url(re.compile(rf"/w/{world.fern}/explorer/blocks/{h}$"))
            soon(page.get_by_role("heading", name=f"Block {h}", exact=True)).to_be_visible()
            for list_name, nodes, word in (("Row roots", rows, "Row"), ("Column roots", cols, "Column")):
                items = page.get_by_role("list", name=list_name).get_by_role("listitem")
                soon(items).to_have_count(4)
                for i, n in enumerate(nodes):
                    soon(items.nth(i)).to_contain_text(f"{word} {i}")
                    soon(items.nth(i)).to_have_attribute("data-min", n[0].hex())
                    soon(items.nth(i)).to_have_attribute("data-max", n[1].hex())
                    soon(items.nth(i)).to_have_attribute("data-hash", n[2].hex())
            wait_text(page, f"Data root {data_root(rows, cols).hex()}")


def test_wf_nmt_proofs_lantern_absence_before_parity(browser: Browser, world: World) -> None:
    ext = _extended(BLOCK2_BLOBS)
    row0, row1 = _row_leaves(ext, 0), _row_leaves(ext, 1)
    next_leaf = row0[4]
    absence_nodes = _cover(row0, 0, 8, 4, 5)
    inclusion_nodes = _cover(row1, 0, 8, 2, 3)
    assert len(absence_nodes) == 3 and len(inclusion_nodes) == 3
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2") as page:
        box = page.get_by_role("textbox", name="Namespace to prove")
        fill(box, LANTERN)
        prove = page.get_by_role("button", name="Prove namespace")
        ready(prove).focus()
        page.keyboard.press("Space")
        region = page.get_by_role("region", name="Namespace proof")
        for line in ("Row 0: absence, next leaf at column 4", "Row 1: inclusion, columns 2 to 2, 3 proof nodes",
                     "Row 2: outside this row's namespace range", "Row 3: outside this row's namespace range"):
            soon(region).to_contain_text(line)
        soon(region).to_contain_text(f"Next leaf hash {next_leaf[2].hex()}")
        for r, nodes in ((0, absence_nodes), (1, inclusion_nodes)):
            items = region.get_by_role("list", name=f"Row {r} proof nodes").get_by_role("listitem")
            soon(items).to_have_count(len(nodes))
            for i, n in enumerate(nodes):
                soon(items.nth(i)).to_have_attribute("data-hash", n[2].hex())
                soon(items.nth(i)).to_have_attribute("data-min", n[0].hex())
                soon(items.nth(i)).to_have_attribute("data-max", n[1].hex())
        for r, key in ((1, "Enter"), (0, "Space")):
            ready(region.get_by_role("button", name=f"Verify row {r}")).focus()
            page.keyboard.press(key)
            soon(region).to_contain_text(f"Verified against row {r} root.")


def test_wf_nmt_proofs_new_block_viewer(browser: Browser, world: World) -> None:
    payload = b"y" * 200
    ext = _extended(MEMPOOL_BLOBS + [(HARBOR, payload)])
    row0, row1, row2 = (_row_leaves(ext, r) for r in range(3))
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer") as viewer, \
            open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        _submit_ui(page, "Harbor", payload.decode())
        world.advance(BLOCK_MS)
        expect(viewer.get_by_role("status", name="Network updates")).to_contain_text(
            "Block 6 produced: 3 blobs, square 4 × 4.", timeout=LIVE_DEADLINE_S * 1000)
        link = viewer.get_by_role("table", name="Blocks").get_by_role("link", name="6", exact=True)
        expect(link).to_be_visible(timeout=LIVE_DEADLINE_S * 1000)
        link.focus()
        viewer.keyboard.press("Enter")
        soon(viewer.get_by_role("heading", name="Block 6", exact=True)).to_be_visible()
        box = viewer.get_by_role("textbox", name="Namespace to prove")
        fill(box, HARBOR)
        box.press("Enter")
        region = viewer.get_by_role("region", name="Namespace proof")
        for line in ("Row 0: absence, next leaf at column 4", "Row 1: inclusion, columns 2 to 3, 2 proof nodes",
                     "Row 2: inclusion, columns 0 to 1, 2 proof nodes", "Row 3: outside this row's namespace range"):
            soon(region).to_contain_text(line)
        soon(region).to_contain_text(f"Next leaf hash {row0[4][2].hex()}")
        for r, leaves, start, end in ((1, row1, 2, 4), (2, row2, 0, 2)):
            nodes = _cover(leaves, 0, 8, start, end)
            items = region.get_by_role("list", name=f"Row {r} proof nodes").get_by_role("listitem")
            soon(items).to_have_count(2)
            for i, n in enumerate(nodes):
                soon(items.nth(i)).to_have_attribute("data-hash", n[2].hex())
            ready(region.get_by_role("button", name=f"Verify row {r}")).focus()
            viewer.keyboard.press("Enter")
            soon(region).to_contain_text(f"Verified against row {r} root.")


def _blocks_row(page: Page, h: int) -> Locator:
    table = page.get_by_role("table", name="Blocks")
    return table.get_by_role("row").filter(has=page.get_by_role("link", name=str(h), exact=True))


def _await_row_text(page: Page, h: int, needle: str, seconds: float = LIVE_DEADLINE_S) -> None:
    deadline = time.monotonic() + seconds
    last = ""
    while time.monotonic() < deadline:
        rows = _blocks_row(page, h)
        if rows.count() == 1:
            last = norm(rows.inner_text())
            if needle in last:
                return
        page_advance(page, 48)
    pytest.fail(f"Blocks row {h} never showed {needle!r} (last {last!r})")


def _pick_next_block(page: Page, presses: int) -> None:
    group = page.get_by_role("radiogroup", name="Next block")
    honest = group.get_by_role("radio", name="Honest", exact=True)
    soon(honest).to_be_checked()
    ready(honest).focus()
    for _ in range(presses):
        page.keyboard.press("ArrowDown")


def test_wf_light_sampling_block3_k2_keyboard(browser: Browser, world: World) -> None:
    kestrel = world.node("kestrel")
    expected = sample_coords(2, 3, 2, 6)
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/nodes/{kestrel}") as page:
        select(page.get_by_role("combobox", name="Block", exact=True), "Block 3")
        take = page.get_by_role("button", name="Take sample", exact=True)
        for i, key in enumerate(("Space", "Enter", "Space", "Enter", "Space", "Enter")):
            ready(take).focus()
            page.keyboard.press(key)
            r, c = expected[i]
            conf = confidence(2, i + 1)
            if i < 3:
                assert conf == CONF_K2[i]
            wait_text(page, f"Sample {i + 1}: share ({r}, {c}) available. Confidence {conf}%.")
        soon(page.get_by_role("status", name="Sampling updates")).to_contain_text(f"Confidence {confidence(2, 6)}%")
        wait_text(page, f"Confidence {confidence(2, 6)}%")
    s = samples(world.api("felix"), world, kestrel, 3)
    assert coords(s["samples"]) == expected
    assert (s["confidence"], s["verdict"]) == (confidence(2, 6), "available")


def test_wf_light_sampling_wren_reaches_available_live(browser: Browser, world: World) -> None:
    wren = world.node("wren")
    seq = sample_coords(1, 6, 4, 10)
    assert seq[:8] == WREN_6
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/nodes/{wren}") as node_page, \
            open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer") as explorer:
        world.advance(BLOCK_MS + 9 * SAMPLE_INTERVAL_MS)
        r, c = seq[8]
        wait_text(node_page, f"Sample 9: share ({r}, {c}) available. Confidence {confidence(4, 9)}%.", LIVE_DEADLINE_S)
        _await_row_text(explorer, 6, "Sampling")
        world.advance(SAMPLE_INTERVAL_MS)
        r, c = seq[9]
        wait_text(node_page, f"Sample 10: share ({r}, {c}) available. Confidence {confidence(4, 10)}%.", LIVE_DEADLINE_S)
        expect(node_page.get_by_role("status", name="Sampling updates")).to_contain_text(f"Confidence {confidence(4, 10)}%")
        _await_row_text(explorer, 6, "Available")
    assert block(world.api("amara"), world, 6)["status"] == "available"


def test_wf_light_sampling_shared_sequence_two_operators(browser: Browser, world: World) -> None:
    kestrel = world.node("kestrel")
    path = f"/w/{world.fern}/nodes/{kestrel}"
    with open_as(browser, world.base, world.session("felix"), path) as felix_page, \
            open_as(browser, world.base, world.session("amara"), path) as amara_page:
        for page in (felix_page, amara_page):
            select(page.get_by_role("combobox", name="Block", exact=True), "Block 2")
        take = felix_page.get_by_role("button", name="Take sample", exact=True)
        for i in range(2):
            ready(take).focus()
            felix_page.keyboard.press("Space")
            r, c = KESTREL_2[i]
            line = f"Sample {i + 1}: share ({r}, {c}) available. Confidence {CONF_K4[i]}%."
            wait_text(felix_page, line)
            wait_text(amara_page, line, LIVE_DEADLINE_S)
        amara_take = amara_page.get_by_role("button", name="Take sample", exact=True)
        ready(amara_take).focus()
        amara_page.keyboard.press("Enter")
        r, c = KESTREL_2[2]
        line = f"Sample 3: share ({r}, {c}) available. Confidence {CONF_K4[2]}%."
        wait_text(amara_page, line)
        wait_text(felix_page, line, LIVE_DEADLINE_S)
        soon(felix_page.get_by_role("status", name="Sampling updates")).to_contain_text("Confidence 77.3716%")
    with open_as(browser, world.base, world.session("priya"), path) as viewer:
        described(viewer.get_by_role("button", name="Take sample", exact=True), None, VIEWER_COPY)
        soon(viewer.get_by_role("button", name="Take sample", exact=True)).to_be_disabled()
        soon(viewer.get_by_role("switch", name="Auto-sample")).to_be_disabled()
    assert coords(samples(world.api("priya"), world, kestrel, 2)["samples"]) == KESTREL_2[:3]


def test_wf_withheld_block_node_page_announces_withheld_sample(browser: Browser, world: World) -> None:
    wren = world.node("wren")
    amara = world.api("amara")
    with open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer") as owner, \
            open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/nodes/{wren}") as node_page:
        _pick_next_block(owner, 1)
        said(owner, "Producer status", "Next block: Withhold shares.")
        poll(lambda: amara.json(world.w())["nextBlock"] == "withhold", 10, "Withhold shares was not saved")
        world.advance(BLOCK_MS + 5 * SAMPLE_INTERVAL_MS)
        r, c = WREN_6[4]
        wait_text(node_page, f"Sample 5: share ({r}, {c}) available. Confidence {CONF_K4[4]}%.", LIVE_DEADLINE_S)
        world.advance(SAMPLE_INTERVAL_MS)
        wait_text(node_page, f"Sample {6}: share ({3}, {4}) withheld. Block {6} is unavailable.", LIVE_DEADLINE_S)
        expect(node_page.get_by_role("status", name="Sampling updates")).to_contain_text(f"Block {6} is unavailable.")
        node_page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/6")
        soon(grid(node_page, 6)).to_be_visible()
        start = node_page.get_by_role("gridcell", name="Share 0, 0: Orchard", exact=True)
        ready(start).focus()
        for key in ("ArrowDown", "ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight"):
            node_page.keyboard.press(key)
        served = node_page.get_by_role("gridcell", name="Share 3, 2: Padding", exact=True)
        soon(served).to_be_focused()
        soon(served).to_have_attribute("data-kind", "padding")
        node_page.keyboard.press("ArrowRight")
        hidden = node_page.get_by_role("gridcell", name="Share 3, 3: Withheld", exact=True)
        soon(hidden).to_be_focused()
        soon(hidden).to_have_attribute("data-kind", "withheld")
        soon(hidden).to_have_attribute("data-share", "")
        node_page.keyboard.press("Control+End")
        soon(node_page.get_by_role("gridcell", name="Share 7, 7: Withheld", exact=True)).to_be_focused()
        soon(node_page.get_by_role("gridcell", name="Share 2, 7: Parity", exact=True)).to_have_attribute("data-kind", "parity")
    world.advance(3 * SAMPLE_INTERVAL_MS)
    assert len(samples(amara, world, wren, 6)["samples"]) == 6


def test_wf_withheld_block_seeded_block4_viewer(browser: Browser, world: World) -> None:
    copy = "Block 4 was rejected: shares were withheld. Light node Wren could not fetch share (6, 5)."
    blob_id = world.data["blobs"]["block4"][0]["id"]
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer/blocks/4", device_time=WRONG_DEVICE_TIME) as page:
        soon(page.get_by_role("alert", name=f"Block {4} rejected")).to_contain_text(copy)
        first = page.get_by_role("gridcell", name="Share 0, 0: Harbor", exact=True)
        soon(first).to_have_attribute("data-kind", "blob")
        ready(first).focus()
        for key in ("ArrowDown", "ArrowRight"):
            page.keyboard.press(key)
        soon(page.get_by_role("gridcell", name="Share 1, 1: Harbor", exact=True)).to_be_focused()
        for key in ("ArrowDown", "ArrowRight"):
            page.keyboard.press(key)
        soon(page.get_by_role("gridcell", name="Share 2, 2: Padding", exact=True)).to_be_focused()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowRight")
        withheld = page.get_by_role("gridcell", name="Share 3, 3: Withheld", exact=True)
        soon(withheld).to_be_focused()
        soon(withheld).to_have_attribute("data-share", "")
        target = page.get_by_role("gridcell", name="Share 6, 5: Withheld", exact=True)
        soon(target).to_have_attribute("data-kind", "withheld")
        soon(target).to_have_attribute("data-quadrant", "Q3")
        page.goto(f"{world.base}/w/{world.fern}/blobs/{blob_id}")
        facts = page.get_by_role("list", name="Blob facts")
        soon(facts).to_contain_text("Rejected — block 4 was rejected")
        soon(facts).to_contain_text("Size 300 bytes")
        soon(facts).to_contain_text("Shares 6")


def test_wf_withheld_block_your_blobs_rejected_refund(browser: Browser, world: World) -> None:
    amara = world.api("amara")
    assert amara.put(world.w("/producer"), {"nextBlock": "withhold"}).json() == {"nextBlock": "withhold"}
    _, _, ufern = FEE_TABLE[200]
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        wait_text(page, "Available 5,000.000000 FERN")
        form = page.get_by_role("form", name="Submit blob")
        select(form.get_by_role("combobox", name="Namespace"), "Harbor")
        fill(form.get_by_role("textbox", name="Data"), "w" * 200)
        form.get_by_role("textbox", name="Fee (FERN)").press("Enter")
        said(form, "Submit blob status", "Blob submitted. It is pending until a block includes it.")
        table = page.get_by_role("table", name="Your blobs")
        soon(table).to_contain_text("Pending")
        wait_text(page, f"Available {shown(5_000 * UFERN - ufern)} FERN")
        world.advance(BLOCK_MS)
        until(page, "() => document.body.innerText.includes('Included in block 6')", None, LIVE_DEADLINE_S)
        world.advance(6 * SAMPLE_INTERVAL_MS)
        until(page, "() => document.body.innerText.includes('Rejected — block 6 was rejected')", None, LIVE_DEADLINE_S)
        expect(table).to_contain_text("Rejected — block 6 was rejected")
        expect(table).not_to_contain_text("Included in block 6")
        page.reload()
        wait_text(page, "Available 5,000.000000 FERN")
    felix = world.api("felix")
    mine = [b for b in felix.json(world.w("/blobs"), mine="true") if b["size"] == 200]
    assert len(mine) == 1 and (mine[0]["status"], mine[0]["statusText"]) == ("rejected", "Rejected — block 6 was rejected")
    me = staking_me(felix, world)
    assert (me["balanceUfern"], me["availableUfern"]) == (5_000 * UFERN, 5_000 * UFERN)


def test_wf_fraud_proof_block5_cell_and_roots_keyboard(browser: Browser, world: World) -> None:
    flipped = BLOCK3_SHARES[(0, 2)][:28] + "1b" + BLOCK3_SHARES[(0, 2)][30:]
    assert BLOCK3_SHARES[(0, 2)][28:30] == "1a"
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/5") as page:
        start = page.get_by_role("gridcell", name="Share 0, 0: Lantern", exact=True)
        ready(start).focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        bad = page.get_by_role("gridcell", name="Share 0, 2: Parity", exact=True)
        soon(bad).to_be_focused()
        soon(bad).to_have_attribute("data-share", flipped)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=f"Share {0}, {2}")
        soon(dialog).to_contain_text(re.compile("Info byte 03", re.I))
        page.keyboard.press("Escape")
        soon(bad).to_be_focused()
        row0 = page.get_by_role("list", name="Row roots").get_by_role("listitem").filter(has_text="Row 0")
        soon(row0).to_have_attribute("data-hash", FRAUD5_COMMITTED)
        panel = page.get_by_role("region", name="Bad encoding fraud proof")
        soon(panel).to_contain_text(f"Committed row root {FRAUD5_COMMITTED}")
        soon(panel).to_contain_text(f"Recomputed row root {FRAUD5_RECOMPUTED}")
        page.goto(f"{world.base}/w/{world.fern}/explorer/blocks/3")
        honest = page.get_by_role("list", name="Row roots").get_by_role("listitem").filter(has_text="Row 0")
        soon(honest).to_have_attribute("data-hash", BLOCK3_ROW0)
    assert BLOCK3_ROW0 == FRAUD5_RECOMPUTED


def test_wf_fraud_proof_timing_live_with_sampling(browser: Browser, world: World) -> None:
    wren = world.node("wren")
    amara = world.api("amara")
    copy = "Block 6 was rejected: row 0 is not encoded correctly."
    with open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/explorer") as owner, \
            open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer") as dev:
        _pick_next_block(owner, 2)
        said(owner, "Producer status", "Next block: Bad encoding.")
        poll(lambda: amara.json(world.w())["nextBlock"] == "bad-encoding", 10, "Bad encoding was not saved")
        owner.goto(f"{world.base}/w/{world.fern}/nodes/{wren}")
        soon(owner.get_by_role("button", name="Take sample", exact=True)).to_be_visible()
        world.advance(BLOCK_MS)
        wait_text(dev, "Block 6 produced: 2 blobs, square 4 × 4.", LIVE_DEADLINE_S)
        world.advance(FRAUD_DELAY_MS - 1)
        r, c = WREN_6[3]
        wait_text(owner, f"Sample 4: share ({r}, {c}) available. Confidence {CONF_K4[3]}%.", LIVE_DEADLINE_S)
        _await_row_text(dev, 6, "Sampling")
        expect(dev.get_by_role("alert", name=f"Block {6} rejected")).to_have_count(0)
        world.advance(1)
        r, c = WREN_6[4]
        wait_text(owner, f"Sample 5: share ({r}, {c}) available. Confidence {CONF_K4[4]}%.", LIVE_DEADLINE_S)
        wait_text(dev, copy, LIVE_DEADLINE_S)
        expect(dev.get_by_role("status", name="Network updates")).to_contain_text(copy)
        expect(dev.get_by_role("alert", name=f"Block {6} rejected")).to_contain_text(copy)
        _await_row_text(dev, 6, "Rejected")
    world.advance(3 * SAMPLE_INTERVAL_MS)
    assert len(samples(amara, world, wren, 6)["samples"]) == 5


def test_wf_fraud_proof_viewer_panel_blob_and_mail(browser: Browser, world: World, mail: Mailpit) -> None:
    mail.clear()
    amara = world.api("amara")
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer") as page:
        group = page.get_by_role("radiogroup", name="Next block")
        described(group.get_by_role("radio", name="Bad encoding", exact=True), group, VIEWER_COPY)
        soon(group.get_by_role("radio", name="Bad encoding", exact=True)).to_be_disabled()
        assert amara.put(world.w("/producer"), {"nextBlock": "bad-encoding"}).json() == {"nextBlock": "bad-encoding"}
        world.advance(BLOCK_MS)
        link = page.get_by_role("table", name="Blocks").get_by_role("link", name="6", exact=True)
        until(page, "() => document.body.innerText.includes('Block 6 produced: 2 blobs, square 4 × 4.')", None, LIVE_DEADLINE_S)
        link.focus()
        page.keyboard.press("Enter")
        soon(page.get_by_role("heading", name="Block 6", exact=True)).to_be_visible()
        soon(page.get_by_role("region", name="Bad encoding fraud proof")).to_have_count(0)
        world.advance(FRAUD_DELAY_MS)
        wait_text(page, f"Row {0} is not encoded correctly. Block {6} rejected.", LIVE_DEADLINE_S)
        panel = page.get_by_role("region", name="Bad encoding fraud proof")
        for line in ("Row 0 of block 6", "4 of 4 shares verified against column roots",
                     f"Committed row root {FRAUD6_COMMITTED}", f"Recomputed row root {FRAUD6_RECOMPUTED}"):
            expect(panel).to_contain_text(line)
        lantern = world.data["blobs"]["mempool"][1]["id"]
        page.goto(f"{world.base}/w/{world.fern}/blobs/{lantern}")
        facts = page.get_by_role("list", name="Blob facts")
        soon(facts).to_contain_text("Rejected — block 6 was rejected")
        soon(facts).to_contain_text("Size 200 bytes")
    msgs = [m for m in mail.messages(expected=3) if m["Subject"] == "Block 6 was rejected"]
    assert sorted(a for m in msgs for a in addresses(m["To"])) == sorted(PEOPLE[k][1] for k in ("amara", "felix", "priya"))
    assert all("Fernhill Labs" in mail_text(m) for m in msgs)


def _active_card(cards: list[Locator]) -> int:
    marks = [c.get_attribute("aria-current") for c in cards]
    assert marks.count("step") == 1, f"exactly one active Square walk card, got {marks}"
    return marks.index("step") + 1


def test_wf_delegation_rewards_live(browser: Browser, world: World) -> None:
    felix = world.api("felix")
    created(felix.post(world.w("/staking/delegate"), {"validator": world.validator("cedar"), "amount": "1000"}))
    world.advance(BLOCK_MS)
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/stake") as page, \
            open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/stake") as other:
        mine = page.get_by_role("table", name="Your delegations")
        expect(mine.get_by_role("row").filter(has_text="Birch")).to_contain_text("0.025000")
        expect(mine.get_by_role("row").filter(has_text="Cedar")).to_contain_text("0.000000")
        validators = other.get_by_role("table", name="Validators")
        for name, stake, share in (("Alder", "4,500.000000", "38.14%"), ("Birch", "3,300.000000", "27.97%"),
                                   ("Cedar", "3,000.000000", "25.42%"), ("Dogwood", "1,000.000000", "8.47%")):
            row = validators.get_by_role("row").filter(has_text=name)
            expect(row).to_contain_text(stake)
            expect(row).to_contain_text(share)
        world.advance_to(at_block(11))
        soon(mine.get_by_role("row").filter(has_text="Cedar"), LIVE_DEADLINE_S * 1000).to_contain_text("0.423725")
        soon(mine.get_by_role("row").filter(has_text="Birch"), LIVE_DEADLINE_S * 1000).to_contain_text(shown(25_000 + 5 * 22_881))
        claim = page.get_by_role("button", name="Claim rewards")
        ready(claim).focus()
        page.keyboard.press("Enter")
        said(page, "Stake status", TX_SENT)
    assert {x["validatorName"]: x["pendingRewardsUfern"] for x in staking_me(felix, world)["delegations"]}["Cedar"] == ufern_of("0.423725")


def test_wf_delegation_ledger_keyboard(browser: Browser, world: World) -> None:
    felix = world.api("felix")
    created(felix.post(world.w("/staking/delegate"), {"validator": world.validator("cedar"), "amount": "1000"}))
    world.advance(BLOCK_MS)
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/stake") as page:
        menu = page.get_by_role("button", name="Menu")
        menu.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Menu")
        link = dialog.get_by_role("link", name="Ledger", exact=True)
        soon(link).to_be_visible()
        for _ in range(6):
            if link.evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        soon(link).to_be_focused()
        page.keyboard.press("Enter")
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/ledger")
        table = page.get_by_role("table", name="Ledger")
        soon(table.get_by_role("row").filter(has_text="Delegation to Cedar")).to_contain_text("1,000.000000")
        soon(table.get_by_role("row").filter(has=page.get_by_role("cell", name="Fee", exact=True)).filter(has_text="0.008000").first).to_be_visible()
        rows = table.get_by_role("row").filter(has=page.get_by_role("cell"))
        soon(rows.first).to_contain_text("3,999.992000")
        soon(table.get_by_role("row").filter(has_text="Genesis allocation").first).to_be_visible()
    felix_id = world.person("felix")["id"]
    entries = ledger(felix, world, f"member:{felix_id}")["entries"]
    assert sum(e["amountUfern"] for e in entries) == ufern_of("3,999.992000")
    assert {e["label"] for e in entries if e["height"] == 6} == {"Fee", "Delegation to Cedar"}


def test_wf_governance_yes_vote_live(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/vote/3") as page, \
            open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/vote/3") as other:
        soon(other.get_by_role("region", name="Tally")).to_contain_text("Yes share 47.37%")
        yes = page.get_by_role("radiogroup", name="Your vote").get_by_role("radio", name="Yes", exact=True)
        ready(yes).focus()
        page.keyboard.press("Space")
        soon(yes).to_be_checked()
        cast = page.get_by_role("button", name="Cast vote")
        ready(cast).focus()
        page.keyboard.press("Enter")
        said(page, "Vote status", TX_SENT)
        world.advance(BLOCK_MS)
        for line in ("Votes 9,800.000000 of 10,800.000000 FERN (90.74%)", "Yes 4,800.000000 FERN",
                     "No with veto 3,000.000000 FERN (30.61%)", "Yes share 48.98%", "Projected result Rejected"):
            for pg in (other, page):
                expect(pg.get_by_role("region", name="Tally")).to_contain_text(line, timeout=LIVE_DEADLINE_S * 1000)
        soon(other.get_by_role("region", name="Tally")).not_to_contain_text("Rejected with veto")
    assert world.api("felix").json(world.w("/proposals/3"))["myVote"] == "yes"


def test_wf_governance_deposit_end_live(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/vote/4", device_time=WRONG_DEVICE_TIME) as page, \
            open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/vote") as other:
        world.advance_to(DEPOSIT_END_4 - timedelta(milliseconds=4_000))
        wait_text(page, "Deposit period")
        wait_text(page, "10:04:35")
        box = page.get_by_role("form", name="Deposit").get_by_role("textbox", name="Deposit (FERN)")
        fill(box, "60")
        box.press("Enter")
        said(page, "Vote status", TX_SENT)
        world.advance(4_000)
        wait_text(page, "Failed — deposit not met", LIVE_DEADLINE_S)
        row = other.get_by_role("table", name="Proposals").get_by_role("row").filter(has_text="Add a namespace directory")
        expect(row).to_contain_text("Failed — deposit not met", timeout=LIVE_DEADLINE_S * 1000)
        expect(page.get_by_role("form", name="Deposit")).to_have_count(0)
        world.advance_to(at_block(19))
        felix = world.api("felix")
        rejected = [t for t in felix.json(world.w("/transactions"), mine="true")
                    if t["statusText"] == "Rejected — The deposit period for proposal 4 has ended."]
        assert len(rejected) == 1, "the late deposit was not rejected at inclusion"
        page.goto(f"{world.base}/w/{world.fern}/explorer/tx/{rejected[0]['id']}")
        wait_text(page, "Rejected — The deposit period for proposal 4 has ended.")
        wait_text(page, "0.008000")


def test_wf_governance_abstain_reminder(browser: Browser, world: World, mail: Mailpit) -> None:
    felix = world.api("felix")
    created(felix.post(world.w("/proposals/4/deposits"), {"amount": "60"}))
    world.advance(BLOCK_MS)
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/vote/4") as page, \
            open_as(browser, world.base, world.session("amara"), f"/w/{world.fern}/vote/4") as other:
        wait_text(page, "Voting period")
        abstain = page.get_by_role("radiogroup", name="Your vote").get_by_role("radio", name="Abstain", exact=True)
        abstain.focus()
        page.keyboard.press("Space")
        soon(abstain).to_be_checked()
        cast = page.get_by_role("button", name="Cast vote")
        ready(cast).focus()
        page.keyboard.press("Enter")
        said(page, "Vote status", TX_SENT)
        world.advance(BLOCK_MS)
        tally = other.get_by_role("region", name="Tally")
        for line in ("Votes 300.000000 of 10,800.000000 FERN (2.78%)", "Abstain 300.000000 FERN", "Yes share 0.00%",
                     "Projected result Rejected — quorum not reached"):
            expect(tally).to_contain_text(line, timeout=LIVE_DEADLINE_S * 1000)
    mail.clear()
    remind_at = APP_START + timedelta(minutes=9, seconds=30)
    world.advance_to(remind_at - timedelta(milliseconds=1))
    assert not [m for m in mail.messages() if m["Subject"].startswith("Reminder: proposal 4")]
    world.advance(1)
    reminders = poll(lambda: [m for m in mail.messages() if m["Subject"] == "Reminder: proposal 4 closes at 10:11:30"], 30,
                     "no proposal 4 reminder mail")
    assert [addresses(m["To"]) for m in reminders] == [[PEOPLE["amara"][1]]]


def test_wf_phone_blob_new_block_cells(browser: Browser, world: World) -> None:
    felix = world.api("felix")
    blob = created(submit_blob(felix, world, HARBOR, b"m" * 200))
    world.advance(BLOCK_MS)
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/blobs/{blob['blobId']}", size=PHONE_CHECK) as page:
        facts = page.get_by_role("list", name="Blob facts")
        for text_ in ("Included in block 6", "Harbor", HARBOR, "Size 200 bytes", "Shares 4", "Fee 0.006705 FERN"):
            expect(facts).to_contain_text(text_)
        soon(page.get_by_role("list", name="Share positions").get_by_role("listitem")).to_have_text(["(1, 2)", "(1, 3)", "(2, 0)", "(2, 1)"])
        target = page.get_by_role("gridcell", name="Share 2, 1: Harbor", exact=True)
        soon(target).to_have_attribute("data-mine", "true")
        target.scroll_into_view_if_needed()
        at_least(target)
        tap(target)
        dialog = page.get_by_role("dialog", name=f"Share {2}, {1}")
        soon(dialog).to_contain_text(re.compile("Info byte 00", re.I))
        soon(dialog).not_to_contain_text("Sequence length")
        tap(dialog.get_by_role("button", name="Close"))
        soon(dialog).to_have_count(0)
        link = page.get_by_role("link", name="Block 6")
        at_least(link)
        tap(link)
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/explorer/blocks/6")
        layout(page)


def test_wf_phone_blob_pending_to_included(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer", size=PHONE_CHECK) as page:
        tap(page.get_by_role("tablist", name="Workspace panels").get_by_role("tab", name="Submit"))
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/submit")
        form = page.get_by_role("form", name="Submit blob")
        select(form.get_by_role("combobox", name="Namespace"), "Harbor")
        fill(form.get_by_role("textbox", name="Data"), "s" * 120)
        estimate = form.get_by_role("region", name="Blob estimate")
        for line in ("Size 120 bytes", "Shares 3", "Fee 0.006654 FERN"):
            soon(estimate).to_contain_text(line)
        soon(estimate).to_contain_text(re.compile(r"Gas 66,?536"))
        button = form.get_by_role("button", name="Submit blob")
        at_least(button)
        tap(button)
        said(form, "Submit blob status", "Blob submitted. It is pending until a block includes it.")
        felix = world.api("felix")
        mine = poll(lambda: [b for b in felix.json(world.w("/blobs"), mine="true") if b["status"] == "pending"], 10, "no pending blob")
        page.goto(f"{world.base}/w/{world.fern}/blobs/{mine[0]['id']}")
        facts = page.get_by_role("list", name="Blob facts")
        soon(facts).to_contain_text("Pending")
        soon(facts).not_to_contain_text("Included")
        world.advance(BLOCK_MS)
        expect(facts).to_contain_text("Included in block 6", timeout=LIVE_DEADLINE_S * 1000)
        expect(page.get_by_role("list", name="Share positions").get_by_role("listitem")).to_have_text(
            ["(1, 2)", "(1, 3)", "(2, 0)"], timeout=LIVE_DEADLINE_S * 1000)
        layout(page)


def test_wf_phone_blob_stake_panel_touch(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer", size=PHONE) as page:
        tabs = page.get_by_role("tablist", name="Workspace panels")
        tap(tabs.get_by_role("tab", name="Stake"))
        soon(page).to_have_url(f"{world.base}/w/{world.fern}/stake")
        soon(page.get_by_role("tablist", name="Workspace panels").get_by_role("tab", name="Stake")).to_have_attribute("aria-selected", "true")
        form = page.get_by_role("form", name="Delegate", exact=True)
        validator = form.get_by_role("combobox", name="Validator")
        amount = form.get_by_role("textbox", name="Amount (FERN)")
        send = form.get_by_role("button", name="Delegate", exact=True)
        for control in (validator, amount, send):
            control.scroll_into_view_if_needed()
            at_least(control)
        soon(form).to_contain_text("Fee 0.008000 FERN")
        select(validator, "Cedar")
        fill(amount, "10")
        tap(send)
        said(page, "Stake status", TX_SENT)
        wait_text(page, "Available 4,989.992000 FERN")
        layout(page)
        world.advance(BLOCK_MS)
        wait_text(page, "Balance 4,989.992000 FERN", LIVE_DEADLINE_S)
        expect(page.get_by_role("table", name="Your delegations").get_by_role("row").filter(has_text="Cedar")).to_contain_text(
            shown(10 * UFERN), timeout=LIVE_DEADLINE_S * 1000)


def test_wf_square_walk_motion_block3_focus(browser: Browser, world: World) -> None:
    with open_frozen(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/3") as page:
        page.mouse.move(DESKTOP[0] // 2, 10)
        wait_text(page, f"Data root {BLOCK3_DATA_ROOT}")
        walk = page.get_by_role("list", name="Square walk")
        cards = [walk.get_by_role("article", name=n) for n in ("Lay out", "Extend", "Commit")]
        top = walk.evaluate("e => e.getBoundingClientRect().top + window.scrollY")
        page.evaluate("y => window.scrollTo(0, y)", max(0, top - DESKTOP[1] // 2))
        page_advance(page, 2_500)
        for card in cards:
            soon(card).to_have_attribute("data-state", "shown")
        ready(cards[2]).focus()
        page_advance(page, 50)
        soon(cards[2]).to_have_attribute("aria-current", "step")
        assert _active_card(cards) == 3
        for _ in range(6):
            if cards[1].evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Shift+Tab")
        soon(cards[1]).to_be_focused()
        page_advance(page, 50)
        assert _active_card(cards) == 2
        for _ in range(6):
            if cards[0].evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Shift+Tab")
        soon(cards[0]).to_be_focused()
        page_advance(page, 50)
        assert _active_card(cards) == 1
        page_advance(page, 1_500)
        for card, attribute, value in ((cards[0], "data-cells", "4"), (cards[1], "data-cells", "16"), (cards[2], "data-ticks", "8")):
            eventually(page, lambda card=card, attribute=attribute, value=value: _stage_is(card, attribute, value))
        soon(cards[2]).to_contain_text(f"Data root {BLOCK3_DATA_ROOT}")


def test_wf_square_walk_motion_phone_centre(browser: Browser, world: World) -> None:
    with open_frozen(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2", size=PHONE) as page:
        walk = page.get_by_role("list", name="Square walk")
        cards = [walk.get_by_role("article", name=n) for n in ("Lay out", "Extend", "Commit")]
        soon(cards[2]).to_be_attached()
        page.evaluate("() => { const s = document.createElement('div'); s.style.height = '100vh'; document.body.appendChild(s); }")
        box = walk.evaluate("e => { const r = e.getBoundingClientRect(); return {top: r.top + window.scrollY, bottom: r.bottom + window.scrollY}; }")
        start = max(0, round(box["top"] - PHONE[1]))
        end = min(page.evaluate("() => document.documentElement.scrollHeight - window.innerHeight"), round(box["bottom"]))
        centres = lambda: [c.evaluate("e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }") for c in cards]
        mid = PHONE[1] / 2
        page.evaluate("y => window.scrollTo(0, y)", start)
        page_advance(page, 50)
        previous = centres()
        expected, crossed = None, []
        for y in range(start, end + 1, 40):
            page.evaluate("y => window.scrollTo(0, y)", y)
            page_advance(page, 50)
            now = centres()
            hits = [i for i in range(3) if previous[i] > mid >= now[i]]
            if hits:
                expected = max(hits) + 1
                crossed.append(expected)
            if expected is not None:
                assert _active_card(cards) == expected, f"at scroll {y} the active card should be {expected}"
            previous = now
        assert 2 in crossed and 3 in crossed, f"cards 2 and 3 never crossed the viewport middle ({crossed})"


def test_wf_square_walk_motion_reveal_two_contexts(browser: Browser, world: World) -> None:
    with open_frozen(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer") as page, \
            open_frozen(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer", reduced_motion="reduce") as calm:
        for pg in (page, calm):
            soon(grid(pg, 5)).to_be_attached()
            pg.evaluate(REVEAL_LOGGER, "Data square, block 6")
        world.advance(BLOCK_MS)
        until(page, "() => (window.__reveal || []).some(e => e.total === 8)", None, UI_WAIT_S)
        revealed_at_once(calm)
        log = [e for e in page.evaluate("() => window.__reveal") if e["total"] == 8]
        assert log[0]["n"] <= 1, "full motion reveals row 0 first (L197)"
        t0 = log[0]["t"]
        now = page.evaluate(REVEAL_NOW, "Data square, block 6")
        assert now["n"] < 8 or now["t"] - t0 >= 7 * ROW_REVEAL_MS - TIMING_TOLERANCE_MS
        page_advance(page, 8 * ROW_REVEAL_MS)
        assert page.evaluate(REVEAL_NOW, "Data square, block 6")["n"] == 8
        for pg in (page, calm):
            soon(pg.get_by_role("status", name="Network updates"), LIVE_DEADLINE_S * 1000).to_contain_text("Block 6 produced: 2 blobs, square 4 × 4.")
        for r, c, label in ((1, 2, "Lantern"), (0, 0, "Orchard"), (2, 2, "Padding"), (5, 6, "Parity")):
            a = page.get_by_role("gridcell", name=f"Share {r}, {c}: {label}", exact=True)
            b = calm.get_by_role("gridcell", name=f"Share {r}, {c}: {label}", exact=True)
            soon(a).to_have_attribute("data-share", re.compile("^[0-9a-f]{128}$"))
            assert a.get_attribute("data-share") == b.get_attribute("data-share"), f"cell ({r}, {c}) differs under reduced motion (L202)"


def _panel_wraps(page: Page, target: Locator, r: int, c: int) -> None:
    soon(target).to_be_focused()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name=f"Share {r}, {c}")
    soon(dialog).to_be_visible()
    for key in ("Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
        page.keyboard.press(key)
        assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the share panel"
    page.keyboard.press("Escape")
    soon(dialog).to_have_count(0)
    soon(target).to_be_focused()


def _menu_wraps(page: Page) -> None:
    menu = page.get_by_role("button", name="Menu", exact=True)
    ready(menu).focus()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name="Menu")
    soon(dialog.get_by_role("link", name="Ledger", exact=True)).to_be_visible()
    for key in ("Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
        page.keyboard.press(key)
        assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the Menu dialog"
    page.keyboard.press("Escape")
    soon(dialog).to_have_count(0)
    soon(menu).to_be_focused()


def test_wf_erasure_extension_parity_panel_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2") as page:
        ready(page.get_by_role("gridcell", name="Share 0, 0: Orchard", exact=True)).focus()
        for _ in range(4):
            page.keyboard.press("ArrowRight")
        target = page.get_by_role("gridcell", name="Share 0, 4: Parity", exact=True)
        soon(target).to_have_attribute("data-quadrant", "Q1")
        soon(target).to_have_attribute("data-namespace", PARITY_NS_HEX)
        _panel_wraps(page, target, 0, 4)


def test_wf_nmt_proofs_panel_then_prove_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/explorer/blocks/2") as page:
        ready(page.get_by_role("gridcell", name="Share 0, 0: Orchard", exact=True)).focus()
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        target = page.get_by_role("gridcell", name="Share 0, 3: Harbor", exact=True)
        soon(target).to_have_attribute("data-namespace", HARBOR)
        _panel_wraps(page, target, 0, 3)
        box = page.get_by_role("textbox", name="Namespace to prove")
        fill(box, HARBOR)
        box.press("Enter")
        proof = page.get_by_role("region", name="Namespace proof")
        for row in (0, 1):
            soon(proof.get_by_role("button", name=f"Verify row {row}", exact=True)).to_be_visible()


def test_wf_fraud_proof_seeded_block_panel_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer/blocks/5") as page:
        soon(page.get_by_role("region", name="Bad encoding fraud proof")).to_contain_text("Row 0 of block 5")
        target = cell(page, 0, 0)
        ready(target).focus()
        _panel_wraps(page, target, 0, 0)


def test_wf_withheld_block_seeded_block_panel_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("priya"), f"/w/{world.fern}/explorer/blocks/4") as page:
        withheld = cell(page, 6, 5)
        soon(withheld).to_have_attribute("data-kind", "withheld")
        soon(withheld).to_have_attribute("data-share", "")
        target = cell(page, 0, 0)
        ready(target).focus()
        _panel_wraps(page, target, 0, 0)


def test_wf_delegation_menu_dialog_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/stake") as page:
        mine = page.get_by_role("table", name="Your delegations")
        soon(mine.get_by_role("row").filter(has_text="Birch")).to_contain_text(shown(300 * UFERN))
        _menu_wraps(page)


def test_wf_blob_submit_live_menu_keeps_draft_keyboard(browser: Browser, world: World) -> None:
    payload = "f" * 200
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/submit") as page:
        data = page.get_by_role("form", name="Submit blob").get_by_role("textbox", name="Data")
        fill(data, payload)
        _menu_wraps(page)
        soon(data).to_have_value(payload)


def test_wf_governance_menu_dialog_keyboard(browser: Browser, world: World) -> None:
    with open_as(browser, world.base, world.session("felix"), f"/w/{world.fern}/vote/3") as page:
        soon(page.get_by_role("region", name="Tally")).to_be_visible()
        wait_text(page, "Voting period")
        _menu_wraps(page)
