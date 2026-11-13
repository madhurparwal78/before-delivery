from __future__ import annotations

import json
import math
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    advance,
    animations,
    capture,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    settle,
    shipped_packages,
    state_styles,
    style,
    unique,
)

FOUNDER = ("ines@ostra-lighting.example", "lamp-founder-7341")
ENGINEER = ("teo@lindqvist-eng.example", "lamp-engineer-5826")
FOUNDER_NAME = "Ines Varga"
ENGINEER_NAME = "Teo Lindqvist"
WORKSPACE_NAME = "Ostra Lighting"
LAMP = "Ostra Desk Lamp"
ARM = "Arm Assembly"
HEAD = "Head Assembly"
ALU = "6061-T6 aluminium"
ACETAL = "Acetal (POM-C)"
PETG = "PETG"
DENSITY = {ALU: 2.70, ACETAL: 1.41, PETG: 1.27}
M4 = "M4 × 12 socket head cap screw"
M3 = "M3 brass heat-set insert"
M4_MASS_G = 2.10
M3_MASS_G = 0.40
SEED_PART_NAMES = ["Base Plate", "Arm Link", "Pivot Bracket", "Shade", "Switch Cover"]
SEED_ASSEMBLY_NAMES = [LAMP, ARM, HEAD]
SEED_PURCHASED_NAMES = [M4, M3]

SEED_PARTS = {
    "Base Plate": (ALU, 76800 - 800 * math.pi, 22400 - 40 * math.pi, (60, 40, 4), 200.5742),
    "Arm Link": (ALU, 15360, 7232, (80, 8, 3), 41.472),
    "Pivot Bracket": (ACETAL, 7200, 2400, (15, 10, 6), 10.152),
    "Shade": (PETG, 4640 * math.pi, 4872 * math.pi, (0, 0, 20), 18.5128),
}
SEED_FEATURES = {
    "Base Plate": [("Extrude 1", "Sketch 1", "new", 8, "normal"), ("Extrude 2", "Sketch 2", "cut", 20, "symmetric")],
    "Arm Link": [("Extrude 1", "Sketch 1", "new", 6, "normal")],
    "Pivot Bracket": [("Extrude 1", "Sketch 1", "new", 12, "normal")],
    "Shade": [("Extrude 1", "Sketch 1", "new", 40, "normal")],
}
SEED_INSTANCES = {
    LAMP: [("part", "Base Plate", 1), ("part", "Pivot Bracket", 1), ("purchased", M4, 2), ("assembly", ARM, 1)],
    ARM: [("part", "Arm Link", 2), ("part", "Pivot Bracket", 2), ("purchased", M4, 4), ("assembly", HEAD, 1)],
    HEAD: [("part", "Shade", 1), ("purchased", M3, 3)],
}
SEED_BOM = [
    ("Arm Link", "made", 2, 82.944),
    ("Base Plate", "made", 1, 200.5742),
    (M3, "purchased", 3, 1.20),
    (M4, "purchased", 6, 12.60),
    ("Pivot Bracket", "made", 3, 30.456),
    ("Shade", "made", 1, 18.5128),
]
SEED_LAMP_TOTAL = (346.2869, 16, 6)
SEED_ARM_TOTAL = (131.3608, 12)
SEED_HEAD_TOTAL = (19.7128, 4)
SWITCH_FREEDOM = {
    "Line 1 start": 0, "Line 4 end": 0,
    "Line 1 end": 1, "Line 2 start": 1,
    "Line 3 end": 1, "Line 4 start": 1,
    "Line 2 end": 2, "Line 3 start": 2,
}
RECT_LABELS = [
    "Coincident 1", "Coincident 2", "Coincident 3", "Coincident 4", "Horizontal 1",
    "Vertical 1", "Horizontal 2", "Vertical 2", "Coincident 5", "Distance 1", "Distance 2",
]

MSG_UNAUTH = "Sign in to continue."
MSG_BAD_CREDS = "Email or password is not right."
MSG_FORBIDDEN = "Only the founder can change this."
MSG_NOT_FOUND = "Not found."
MSG_IDEM_CONFLICT = "This Idempotency-Key was already used for a different request."
MSG_UNSOLVABLE = "No shape satisfies every constraint with this value. Nothing was changed."
MSG_INVALID = "Check the highlighted fields."
MSG_STORAGE = "Storage is unreachable."
F_GRAMMAR = "Enter a number, optionally followed by mm or in."
F_LENGTH_RANGE = "Enter a length greater than 0 and at most 10000 mm."
F_COORD_RANGE = "Enter a coordinate from −10000 mm to 10000 mm."
F_ANGLE = "Enter an angle in degrees."
F_TOLERANCE = "Enter a tolerance like ±0.05 or +0.1/−0.05."
F_BASE = "Send the revision you started from."
F_KEY = "Send an Idempotency-Key header of 1 to 100 visible characters."
F_NAME_LEN = "Enter a name of 1 to 80 characters."
F_NAME_USED = "That name is already used."
F_QTY = "Enter a whole number from 1 to 999."
F_MASS = "Enter a mass greater than 0 and at most 100000 g."
F_OPERATION = "The first extrude makes the body; later extrudes join, cut or intersect."
F_OPTION = "Choose one of the listed options."
F_COMPONENT = "Choose one of the listed components."
F_EMAIL = "Enter your email."
F_PASSWORD = "Enter your password."
OUTAGE_COPY = "Storage is unreachable. Changes are kept, but parts are marked Not stored until a save reaches storage."
NO_ANSWER_COPY = "No answer from the server. Your change was not confirmed."
BODY_UNAVAILABLE = "Body view unavailable while storage is unreachable."
NO_BODY_COPY = "No stored body yet"
CROSS_ORIGIN_MSG = "Requests from another site are refused."
UNSUPPORTED_MSG = "Send JSON with Content-Type application/json."
TOO_LARGE_MSG = "Request body is larger than 1,000,000 bytes."
BOM_COLUMNS = ["Item", "Kind", "Material", "Qty", "Unit mass", "Line mass"]
FONTS = ["Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"]
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
EXTRUDE_1 = "Extrude 1"
DISTANCE_1 = "Distance 1"
UNKNOWN_API_PATH = "/api/no-such-endpoint"

INCH_MM = 25.4
REL = 0.001
SOLVE_TOL_MM = 0.000001
MAX_LENGTH_MM = 10000
MAX_QTY = 999
MAX_DECLARED_G = 100000
BODY_LIMIT_BYTES = 1_000_000
NAME_MAX = 80
KEY_MAX = 100
PART_SAVE_MAX_S = 6
RING_PX = 6
RING_MIN_MS = 150
RING_MAX_MS = 300
COUNT_MIN_MS = 250
COUNT_MAX_MS = 400
TURN_MIN_MS = 120
TURN_MAX_MS = 220
SHEET_MAX_FRACTION = 0.7
FOCUS_RING_MIN_PX = 2
EDGE_MAX_PX = 24
DESKTOP_TREE_PX = (240, 280)
DESKTOP_PROPS_PX = (300, 340)
TABLET_TREE_PX = (200, 240)
TABLET_PROPS_PX = (260, 300)
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
JUST_BELOW_SHEETS = {"width": 767, "height": 1024}
STACK_EDGE = {"width": 600, "height": 1024}
JUST_BELOW_STACK = {"width": 599, "height": 1024}

WAIT_S = 30
STEP_MS = 50
SAMPLE_MS = 20
QUICK_STEPS = 10
HTTP_TIMEOUT_S = 30
BOOT_WAIT_S = 300
TEXT_TIMEOUT_MS = 2000
MAX_TABS = 60
ROUND_TRIP_SLACK_S = 2
PX_ROUNDING = 1
FLOAT_EQ = 1e-9
RELAY_MAX_CONNECTIONS = 100000
RELAY_MAX_CHUNKS = 10_000_000
PARALLEL = 6
LOG_TAIL = 4000

_UNSET: Any = object()


class Api:

    def __init__(self, base: str, who: tuple[str, str]) -> None:
        self.base = base.rstrip("/")
        self.who = who
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        response = self.http.post("/api/session", json={"email": who[0], "password": who[1]})
        if response.status_code != 200:
            pytest.fail(f"POST /api/session for {who[0]} answered {response.status_code}: {response.text[:300]}")
        self.member: dict[str, Any] = response.json()["member"]

    def clone(self) -> httpx.Client:
        return httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, cookies=self.http.cookies)

    def call(self, method: str, path: str, body: Any = _UNSET, *, key: str | None = None,
             params: dict | None = None, client: httpx.Client | None = None) -> httpx.Response:
        http = client or self.http
        headers = {"Idempotency-Key": key} if key is not None else {}
        if body is _UNSET:
            return http.request(method, path, headers=headers, params=params)
        return http.request(method, path, json=body, headers=headers, params=params)

    def ok(self, method: str, path: str, body: Any = _UNSET, *, key: str | None = None,
           params: dict | None = None, status: int | None = None) -> dict:
        expected = status if status is not None else {"GET": 200, "POST": 201, "PATCH": 200, "DELETE": 200}[method]
        response = self.call(method, path, body, key=key, params=params)
        if response.status_code != expected:
            pytest.fail(f"{method} {path}: expected {expected}, got {response.status_code}: {response.text[:500]}")
        return response.json() if response.content else {}


def err(response: httpx.Response, status: int, code: str) -> dict:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url.path}: expected {status} {code}, "
        f"got {response.status_code}: {response.text[:400]}")
    error = response.json()["error"]
    assert error["code"] == code, f"expected error code {code}, got {error}"
    return error


def field_error(response: httpx.Response, field: str, message: str) -> None:
    error = err(response, 422, "invalid")
    assert error["message"] == MSG_INVALID
    assert error.get("fields", {}).get(field) == message, f"fields.{field}: {error.get('fields')}"


def fresh(label: str) -> str:
    return f"{label} {unique('kb')[0]}"[:NAME_MAX]


def label(word: str, number: int) -> str:
    return f"{word} {number}"


def material_ids(api: Api) -> dict[str, str]:
    return {m["name"]: m["id"] for m in api.ok("GET", "/api/materials")["materials"]}


def get_part(api: Api, pid: str) -> dict:
    return api.ok("GET", f"/api/parts/{pid}")["part"]


def get_sketch(api: Api, sid: str) -> dict:
    return api.ok("GET", f"/api/sketches/{sid}")["sketch"]


def get_assembly(api: Api, aid: str) -> dict:
    return api.ok("GET", f"/api/assemblies/{aid}")["assembly"]


def named(items: list[dict], name: str) -> dict:
    found = [i for i in items if i["name"] == name]
    assert len(found) == 1, f"expected exactly one record named {name!r}, found {len(found)}"
    return found[0]


def part_named(api: Api, name: str) -> dict:
    return named(api.ok("GET", "/api/parts")["parts"], name)


def assembly_named(api: Api, name: str) -> dict:
    return named(api.ok("GET", "/api/assemblies")["assemblies"], name)


def purchased_named(api: Api, name: str) -> dict:
    return named(api.ok("GET", "/api/purchased")["purchased"], name)


def create_part(api: Api, label: str, material: str = ACETAL) -> dict:
    return api.ok("POST", "/api/parts", {"name": fresh(label), "material_id": material_ids(api)[material]})["part"]


def create_sketch(api: Api, pid: str, plane: str = "top", offset: Any = 0) -> dict:
    revision = get_part(api, pid)["revision"]
    return api.ok("POST", f"/api/parts/{pid}/sketches",
                  {"base_revision": revision, "plane": plane, "offset": offset})["sketch"]


def post_entity(api: Api, sid: str, entity: dict) -> httpx.Response:
    revision = get_sketch(api, sid)["revision"]
    return api.call("POST", f"/api/sketches/{sid}/entities", {"base_revision": revision, "entity": entity})


def add_entity(api: Api, sid: str, entity: dict) -> dict:
    response = post_entity(api, sid, entity)
    assert response.status_code == 201, f"add entity {entity}: {response.status_code} {response.text[:300]}"
    return response.json()["entity"]


def post_constraint(api: Api, sid: str, kind: str, refs: list[str], value: Any = None,
                    tolerance: Any = _UNSET) -> httpx.Response:
    body: dict[str, Any] = {"base_revision": get_sketch(api, sid)["revision"], "kind": kind, "refs": refs}
    if value is not None:
        body["value"] = value
    if tolerance is not _UNSET:
        body["tolerance"] = tolerance
    return api.call("POST", f"/api/sketches/{sid}/constraints", body)


def constrain(api: Api, sid: str, kind: str, refs: list[str], value: Any = None, tolerance: Any = _UNSET) -> dict:
    response = post_constraint(api, sid, kind, refs, value, tolerance)
    assert response.status_code == 201, f"{kind} {refs}: {response.status_code} {response.text[:300]}"
    return response.json()


def patch_constraint(api: Api, sid: str, cid: str, **fields: Any) -> httpx.Response:
    body = {"base_revision": get_sketch(api, sid)["revision"], **fields}
    return api.call("PATCH", f"/api/sketches/{sid}/constraints/{cid}", body)


def delete_constraint(api: Api, sid: str, cid: str) -> httpx.Response:
    revision = get_sketch(api, sid)["revision"]
    return api.call("DELETE", f"/api/sketches/{sid}/constraints/{cid}", params={"base_revision": revision})


def constraint_labelled(sketch: dict, label: str) -> dict:
    return named([{**c, "name": c["label"]} for c in sketch["constraints"]], label)


def freedoms(sketch: dict) -> dict[str, int]:
    return {p["name"]: p["freedom"] for p in sketch["points"]}


def line(x1: Any, y1: Any, x2: Any, y2: Any) -> dict:
    return {"type": "line", "start": {"x": x1, "y": y1}, "end": {"x": x2, "y": y2}}


def circle(cx: Any, cy: Any, radius: Any) -> dict:
    return {"type": "circle", "center": {"x": cx, "y": cy}, "radius": radius}


def draw_rectangle(api: Api, sid: str, w: float, h: float, x0: float = 0, y0: float = 0,
                   distances: int = 2) -> list[str]:
    l1 = add_entity(api, sid, line(x0, y0, x0 + w, y0))["id"]
    l2 = add_entity(api, sid, line(x0 + w, y0, x0 + w, y0 + h))["id"]
    l3 = add_entity(api, sid, line(x0 + w, y0 + h, x0, y0 + h))["id"]
    l4 = add_entity(api, sid, line(x0, y0 + h, x0, y0))["id"]
    for a, b in ((l1, l2), (l2, l3), (l3, l4), (l4, l1)):
        constrain(api, sid, "coincident", [f"{a}.end", f"{b}.start"])
    constrain(api, sid, "horizontal", [l1])
    constrain(api, sid, "vertical", [l2])
    constrain(api, sid, "horizontal", [l3])
    constrain(api, sid, "vertical", [l4])
    if x0 == 0 and y0 == 0:
        constrain(api, sid, "coincident", [f"{l1}.start", "origin"])
    else:
        constrain(api, sid, "horizontal_distance", ["origin", f"{l1}.start"], abs(x0))
        constrain(api, sid, "vertical_distance", ["origin", f"{l1}.start"], abs(y0))
    if distances >= 1:
        constrain(api, sid, "distance", [l1], w)
    if distances >= 2:
        constrain(api, sid, "distance", [l2], h)
    return [l1, l2, l3, l4]


def rect_sketch(api: Api, pid: str, w: float, h: float, *, x0: float = 0, y0: float = 0, distances: int = 2,
                plane: str = "top", offset: Any = 0) -> tuple[str, list[str]]:
    sid = create_sketch(api, pid, plane, offset)["id"]
    return sid, draw_rectangle(api, sid, w, h, x0, y0, distances)


def post_extrude(api: Api, pid: str, sid: str, depth: Any, operation: str | None = None,
                 direction: str = "normal", key: str | None = None) -> httpx.Response:
    part = get_part(api, pid)
    op = operation or ("new" if not part["features"] else "join")
    body = {"base_revision": part["revision"], "sketch_id": sid, "operation": op, "depth": depth, "direction": direction}
    return api.call("POST", f"/api/parts/{pid}/features", body, key=key or idempotency_key())


def extrude(api: Api, pid: str, sid: str, depth: Any, operation: str | None = None, direction: str = "normal") -> dict:
    response = post_extrude(api, pid, sid, depth, operation, direction)
    assert response.status_code == 201, f"extrude: {response.status_code} {response.text[:300]}"
    return response.json()["part"]


def patch_feature(api: Api, pid: str, fid: str, **fields: Any) -> httpx.Response:
    body = {"base_revision": get_part(api, pid)["revision"], **fields}
    return api.call("PATCH", f"/api/parts/{pid}/features/{fid}", body)


def made_part(api: Api, label: str, w: float, h: float, depth: Any, material: str = ACETAL) -> tuple[dict, str]:
    part = create_part(api, label, material)
    sid, _ = rect_sketch(api, part["id"], w, h)
    stored = extrude(api, part["id"], sid, depth)
    assert stored["body"]["status"] == "stored", f"made part not stored: {stored['body']}"
    return stored, sid


def create_assembly(api: Api, label: str) -> dict:
    return api.ok("POST", "/api/assemblies", {"name": fresh(label)})["assembly"]


def create_purchased(api: Api, label: str, mass: Any) -> dict:
    return api.ok("POST", "/api/purchased", {"name": fresh(label), "declared_mass_g": mass})["purchased"]


def post_instance(api: Api, aid: str, ctype: str, cid: str, quantity: Any, key: str | None = None,
                  base: int | None = None, client: httpx.Client | None = None) -> httpx.Response:
    revision = base if base is not None else get_assembly(api, aid)["revision"]
    body = {"base_revision": revision, "component": {"type": ctype, "id": cid}, "quantity": quantity}
    return api.call("POST", f"/api/assemblies/{aid}/instances", body, key=key or idempotency_key(), client=client)


def place(api: Api, aid: str, ctype: str, cid: str, quantity: int) -> dict:
    response = post_instance(api, aid, ctype, cid, quantity)
    assert response.status_code == 201, f"place {ctype} {cid}: {response.status_code} {response.text[:300]}"
    return response.json()["instance"]


def tree_rows(api: Api, aid: str) -> list[dict]:
    return api.ok("GET", f"/api/assemblies/{aid}/tree")["rows"]


def bom(api: Api, aid: str) -> dict:
    return api.ok("GET", f"/api/assemblies/{aid}/bom")


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=HTTP_TIMEOUT_S)
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def near(actual: float, expected: float, what: str, rel: float = REL) -> None:
    assert actual == pytest.approx(expected, rel=rel), f"{what}: {actual} vs {expected} (rel {rel})"


def same(actual: float, expected: float, what: str) -> None:
    assert actual == pytest.approx(expected, rel=FLOAT_EQ, abs=FLOAT_EQ), f"{what}: {actual} vs {expected}"


def fixed(value: float, decimals: int) -> str:
    return str(Decimal(repr(float(value))).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP))


def grams(value: float) -> str:
    return f"{fixed(value, 2)} g"


def mm3(value: float, decimals: int = 2) -> str:
    return f"{fixed(value, decimals)} mm³"


def material_option(name: str) -> str:
    return f"{name} · {fixed(DENSITY[name], 2)} g/cm³"


def prefs(api: Api, units: str, precision: int) -> None:
    api.call("PATCH", "/api/me", {"units": units, "precision": precision})


def body_key(pid: str, build: int) -> str:
    return f"bodies/{pid}/build-{build}.json"


def body_object(pid: str, build: int) -> dict:
    return json.loads(S3().get(body_key(pid, build)))


def mesh_figures(body: dict) -> dict[str, Any]:
    welded: dict[tuple, int] = {}
    index: list[int] = []
    points: list[tuple[float, float, float]] = []
    for x, y, z in body["vertices"]:
        key = (round(x, 6), round(y, 6), round(z, 6))
        if key not in welded:
            welded[key] = len(points)
            points.append((x, y, z))
        index.append(welded[key])
    volume = area = cx = cy = cz = 0.0
    directed: dict[tuple[int, int], int] = {}
    parent = list(range(len(points)))

    def root(i: int) -> int:
        for _ in range(len(parent)):
            if parent[i] == i:
                return i
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in body["triangles"]:
        ia, ib, ic = index[a], index[b], index[c]
        p, q, r = points[ia], points[ib], points[ic]
        u = (q[0] - p[0], q[1] - p[1], q[2] - p[2])
        v = (r[0] - p[0], r[1] - p[1], r[2] - p[2])
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        area += math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) / 2
        six = (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0])
               + p[2] * (q[0] * r[1] - q[1] * r[0]))
        volume += six / 6
        cx += six * (p[0] + q[0] + r[0]) / 24
        cy += six * (p[1] + q[1] + r[1]) / 24
        cz += six * (p[2] + q[2] + r[2]) / 24
        for s, t in ((ia, ib), (ib, ic), (ic, ia)):
            directed[(s, t)] = directed.get((s, t), 0) + 1
            parent[root(s)] = root(t)
    closed = all(count == 1 and directed.get((t, s)) == 1 for (s, t), count in directed.items())
    used = {i for edge in directed for i in edge}
    components = len({root(i) for i in used})
    sides = [max(p[k] for p in points) - min(p[k] for p in points) for k in range(3)]
    return {"volume": volume, "area": area, "centroid": (cx / volume, cy / volume, cz / volume),
            "closed": closed, "components": components, "side": max(sides),
            "max": [max(p[k] for p in points) for k in range(3)]}


def centroid_near(actual: dict, expected: tuple[float, float, float], side: float, what: str) -> None:
    for axis, value in zip("xyz", expected):
        assert abs(actual[axis] - value) <= REL * side, f"{what} centroid {axis}: {actual[axis]} vs {value}"


def assert_confirmed(confirmed: dict, volume: float, area: float, centroid: tuple, mass: float, side: float,
                     what: str) -> None:
    near(confirmed["volume_mm3"], volume, f"{what} volume")
    near(confirmed["area_mm2"], area, f"{what} area")
    near(confirmed["mass_g"], mass, f"{what} mass")
    centroid_near(confirmed["centroid_mm"], centroid, side, what)


class Copy:
    def __init__(self, proc: subprocess.Popen, url: str, log: Path) -> None:
        self.proc, self.url, self.log = proc, url, log

    def tail(self) -> str:
        return self.log.read_text(errors="replace")[-LOG_TAIL:]


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def manifest() -> dict:
    deployed = Path(DEPLOYED_APP) / "run.json"
    return json.loads((deployed if deployed.exists() else Path("/app/run.json")).read_text())


def start_copy(overrides: dict[str, str]) -> Copy:
    port = free_port()
    env = dict(os.environ)
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile(prefix="kerfline-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest()["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    return Copy(proc, f"http://127.0.0.1:{port}", Path(log.name))


def stop_copy(copy: Copy) -> None:
    if copy.proc.poll() is None:
        os.killpg(copy.proc.pid, signal.SIGTERM)
        try:
            copy.proc.wait(timeout=HTTP_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            os.killpg(copy.proc.pid, signal.SIGKILL)


def wait_health(copy: Copy, status: int = 200) -> httpx.Response:
    deadline = time.monotonic() + BOOT_WAIT_S
    last = "no answer"
    while time.monotonic() < deadline:
        if copy.proc.poll() is not None:
            pytest.fail(f"app copy exited with {copy.proc.returncode}; log tail:\n{copy.tail()}")
        try:
            response = httpx.get(f"{copy.url}/api/health", timeout=HTTP_TIMEOUT_S)
        except httpx.HTTPError as exc:
            last = repr(exc)
            continue
        if response.status_code == status:
            return response
        last = f"{response.status_code} {response.text[:200]}"
    pytest.fail(f"GET /api/health on the copy never answered {status} (last {last}); log tail:\n{copy.tail()}")


class StorageRelay:

    def __init__(self, target: tuple[str, int]) -> None:
        self.target = target
        self.mode = "up"
        self.lock = threading.Lock()
        self.open: list[socket.socket] = []
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(64)
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        for _ in range(RELAY_MAX_CONNECTIONS):
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            mode = self.mode
            if mode == "refuse":
                client.close()
                continue
            with self.lock:
                self.open.append(client)
            if mode == "silent":
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            except OSError:
                client.close()
                continue
            upstream.settimeout(None)
            with self.lock:
                self.open.append(upstream)
            threading.Thread(target=self._pipe, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pipe, args=(upstream, client), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        for _ in range(RELAY_MAX_CHUNKS):
            try:
                data = src.recv(65536)
            except OSError:
                break
            if not data:
                break
            try:
                dst.sendall(data)
            except OSError:
                break
        for sock in (src, dst):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def set_mode(self, mode: str) -> None:
        self.mode = mode
        with self.lock:
            conns, self.open = self.open, []
        for conn in conns:
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            conn.close()

    def close(self) -> None:
        self.set_mode("refuse")
        try:
            self.listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.listener.close()


def storage_target() -> tuple[str, int]:
    endpoint = urlsplit(os.environ["S3_ENDPOINT"])
    return endpoint.hostname or "127.0.0.1", endpoint.port or (443 if endpoint.scheme == "https" else 80)


def api_poll(probe: Callable[[], Any], what: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = probe()
        if last:
            return last
    pytest.fail(f"{what}; last observation {last!r}")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()


def text_of(loc: Locator) -> str:
    if loc.count() == 0:
        return ""
    return norm(loc.first.inner_text(timeout=TEXT_TIMEOUT_MS))


GENERATED_TEXT_JS = """root => {
  const part = (el, which) => {
    const c = getComputedStyle(el, which).content;
    if (!c || c === 'none' || c === 'normal') return '';
    let out = '';
    for (const m of c.matchAll(/"((?:[^"\\\\]|\\\\.)*)"|attr\\(\\s*([\\w-]+)\\s*\\)/g))
      out += m[1] !== undefined ? m[1] : (el.getAttribute(m[2]) || '');
    return out;
  };
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const s = getComputedStyle(node);
    if (s.display === 'none' || s.visibility === 'hidden') return '';
    let text = ' ' + part(node, '::before');
    for (const child of node.childNodes) text += walk(child);
    return text + part(node, '::after') + ' ';
  };
  return walk(root);
}"""


def rendered_text(loc: Locator) -> str:
    if loc.count() == 0:
        return ""
    return norm(loc.first.evaluate(GENERATED_TEXT_JS))


def poll(page: Page, probe: Callable[[], Any], what: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            last = probe()
        except PlaywrightError as exc:
            last = exc
        else:
            if last:
                return last
        advance(page, STEP_MS)
    pytest.fail(f"{what}; last observation {last!r}")


def quick(page: Page, probe: Callable[[], bool]) -> bool:
    for _ in range(QUICK_STEPS):
        if probe():
            return True
        advance(page, SAMPLE_MS)
    return probe()


def await_visible(page: Page, loc: Locator, what: str) -> Locator:
    poll(page, lambda: loc.count() > 0 and loc.first.is_visible(), f"{what} is visible")
    return loc.first


def await_gone(page: Page, loc: Locator, what: str) -> None:
    poll(page, lambda: loc.count() == 0 or not loc.first.is_visible(), f"{what} is gone")


def await_text(page: Page, loc: Locator, text: str, what: str = "") -> None:
    poll(page, lambda: text in text_of(loc), f"{what or loc} shows {text!r}")


def await_exact(page: Page, loc: Locator, text: str, what: str = "") -> None:
    poll(page, lambda: text_of(loc) == text, f"{what or loc} reads exactly {text!r}")


def is_focused(loc: Locator) -> bool:
    return bool(loc.evaluate("el => el === document.activeElement || el.contains(document.activeElement)"))


def ui_sign_in(page: Page, url: str, who: tuple[str, str]) -> None:
    page.goto(url)
    form = page.get_by_role("form", name="Sign in")
    await_visible(page, form, "form 'Sign in'")
    fill(form.get_by_role("textbox", name="Email"), who[0])
    fill(form.get_by_label("Password", exact=True), who[1])
    click(form.get_by_role("button", name="Sign in"))
    await_visible(page, page.get_by_role("button", name="Sign out"), "workspace after sign-in")


def tree(page: Page) -> Locator:
    return page.get_by_role("tree", name="Feature tree")


def tree_item(page: Page, name: str) -> Locator:
    return tree(page).get_by_role("treeitem", name=re.compile("^" + re.escape(name)))


def measurements(page: Page) -> Locator:
    return page.get_by_role("status", name="Measurements")


def save_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Save status")


def model_message(page: Page) -> Locator:
    return page.get_by_role("status", name="Model message")


def slack_readout(page: Page) -> Locator:
    return page.get_by_role("status", name="Slack")


def sketch_canvas(page: Page) -> Locator:
    return page.get_by_role("group", name="Sketch canvas")


def canvas_item(page: Page, name: str) -> Locator:
    return sketch_canvas(page).get_by_role("button", name=name, exact=True)


def ring_of(page: Page, point: str) -> Locator:
    return sketch_canvas(page).get_by_role("img", name=f"Slack ring at {point}", exact=True)


def glyph(page: Page, label: str) -> Locator:
    return sketch_canvas(page).get_by_role("img", name=label, exact=True)


def constrain_button(page: Page, name: str) -> Locator:
    return page.get_by_role("group", name="Constrain selection").get_by_role("button", name=name, exact=True)


def dimension_field(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Dimension value")


def constraint_item(page: Page, label: str) -> Locator:
    return page.get_by_role("list", name="Constraints").get_by_role("listitem").filter(
        has_text=re.compile(re.escape(label) + r"(?!\d)"))


def open_tree_item(page: Page, name: str) -> Locator:
    item = await_visible(page, tree_item(page, name), f"feature tree item {name!r}")
    click(item)
    return item


def open_part(page: Page, name: str) -> None:
    open_tree_item(page, name)
    await_visible(page, measurements(page), f"part mode for {name}")


BODY_UNAVAILABLE = "Body view unavailable while storage is unreachable."


def open_assembly(page: Page, name: str, storage_down: bool = False) -> None:
    open_tree_item(page, name)
    drawing = page.get_by_role("img", name=f"Assembly view: {name}", exact=True)
    if storage_down:
        unavailable = page.get_by_text(BODY_UNAVAILABLE)
        poll(page, lambda: (drawing.count() > 0 and drawing.first.is_visible())
             or (unavailable.count() > 0 and unavailable.first.is_visible()), f"assembly {name} or {BODY_UNAVAILABLE!r}")
    else:
        await_visible(page, drawing, f"assembly {name}")
    await_visible(page, page.get_by_role("table", name="Assembly tree"), "table 'Assembly tree'")


def open_child(page: Page, part_name: str, child: str) -> None:
    item = open_tree_item(page, part_name)
    await_visible(page, measurements(page), f"part mode for {part_name}")
    pattern = re.compile("^" + re.escape(child) + r"(?!\d)")

    def candidate() -> Locator | None:
        nested = item.get_by_role("treeitem", name=pattern)
        if nested.count() and nested.first.is_visible():
            return nested.first
        everywhere = tree(page).get_by_role("treeitem", name=pattern)
        for i in range(everywhere.count()):
            if everywhere.nth(i).is_visible():
                return everywhere.nth(i)
        return None

    found = candidate()
    if found is None:
        item.press("ArrowRight")
        found = poll(page, candidate, f"{child} under {part_name} after ArrowRight expands it (L193)")
    click(found)


def open_sketch(page: Page, part_name: str, sketch_name: str = "Sketch 1") -> None:
    open_child(page, part_name, sketch_name)
    await_visible(page, sketch_canvas(page), "group 'Sketch canvas'")


def pressed_count(page: Page) -> int:
    return sketch_canvas(page).get_by_role("button", pressed=True).count()


def is_pressed(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.get_attribute("aria-pressed") == "true"


def focus_canvas(page: Page) -> None:
    group = sketch_canvas(page)
    if is_focused(group):
        return
    page.get_by_role("button", name="Sign out").focus()
    for _ in range(MAX_TABS):
        page.keyboard.press("Tab")
        if is_focused(group):
            return
    pytest.fail("Tab never reached the Sketch canvas (one Tab stop in the workspace order, L185)")


def kb_toggle(page: Page, name: str) -> None:
    target = canvas_item(page, name)
    total = sketch_canvas(page).get_by_role("button").count()
    for direction in ("ArrowRight", "ArrowLeft"):
        for _ in range(2 * total + 2):
            if is_pressed(target):
                return
            before = pressed_count(page)
            page.keyboard.press("Space")
            moved = quick(page, lambda: pressed_count(page) != before)
            if is_pressed(target):
                return
            if moved:
                page.keyboard.press("Space")
                quick(page, lambda: pressed_count(page) == before)
            page.keyboard.press(direction)
    pytest.fail(f"arrow keys and Space never selected {name!r} on the Sketch canvas (L203-L204)")


def kb_select(page: Page, *names: str) -> None:
    focus_canvas(page)
    page.keyboard.press("Escape")
    poll(page, lambda: pressed_count(page) == 0, "Escape on the Sketch canvas clears the selection (L205)")
    for name in names:
        kb_toggle(page, name)


def back_to_canvas(page: Page) -> None:
    field = dimension_field(page)
    if field.count() and field.first.is_visible():
        field.first.press("Escape")
    focus_canvas(page)


def apply_dimension(page: Page, value: str, tolerance: str | None = None) -> None:
    field = await_visible(page, dimension_field(page), "textbox 'Dimension value'")
    fill(field, value)
    if tolerance is not None:
        fill(page.get_by_role("textbox", name="Tolerance"), tolerance)
    field.press("Enter")


def await_sketch_revision(page: Page, api: Api, sid: str, revision: int) -> dict:
    return poll(page, lambda: (lambda s: s if s["revision"] >= revision else None)(get_sketch(api, sid)),
                f"sketch {sid} reaches revision {revision}")


SEEK_JS = """(vt) => {
  for (const a of document.getAnimations()) {
    if (a.__kbStart === undefined) a.__kbStart = vt;
    try { a.currentTime = vt - a.__kbStart; } catch (e) {}
  }
}"""


def timeline(page: Page, probe: Callable[[], Any], total_ms: int) -> list[tuple[int, Any]]:
    samples: list[tuple[int, Any]] = []
    for i in range(total_ms // SAMPLE_MS + 1):
        vt = i * SAMPLE_MS
        page.evaluate(SEEK_JS, vt)
        samples.append((vt, probe()))
        advance(page, SAMPLE_MS)
    return samples


def width_of(loc: Locator) -> float | None:
    if loc.count() == 0:
        return None
    box = loc.first.bounding_box(timeout=TEXT_TIMEOUT_MS)
    return box["width"] if box else None


def test_sign_in_issues_session_cookie(app_url: str) -> None:
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S) as http:
        response = http.post("/api/session", json={"email": FOUNDER[0], "password": FOUNDER[1]})
        assert response.status_code == 200, response.text
        member = response.json()["member"]
        assert (member["name"], member["email"], member["role"]) == (FOUNDER_NAME, FOUNDER[0], "founder")
        assert member["units"] in ("mm", "in") and member["precision"] in range(5)
        cookies = [c for c in response.headers.get_list("set-cookie") if c.startswith("kerfline_session=")]
        assert cookies, f"no kerfline_session cookie in {response.headers.get_list('set-cookie')}"
        assert "HttpOnly".lower() in cookies[0].lower() and "SameSite=Lax".lower() in cookies[0].lower(), cookies[0]
        me = http.get("/api/me")
        assert me.status_code == 200 and me.json()["member"]["id"] == member["id"]
        assert http.delete("/api/session").status_code == 204
        after = err(http.get("/api/me"), 401, "unauthenticated")
        assert after["message"] == MSG_UNAUTH
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S) as http:
        for body in ({"email": FOUNDER[0], "password": "not-the-password"},
                     {"email": "nobody@ostra-lighting.example", "password": FOUNDER[1]}):
            wrong = err(http.post("/api/session", json=body), 401, "bad_credentials")
            assert wrong["message"] == MSG_BAD_CREDS
        assert "kerfline_session" not in http.cookies
        field_error(http.post("/api/session", json={"password": FOUNDER[1]}), "email", F_EMAIL)
        field_error(http.post("/api/session", json={"email": FOUNDER[0]}), "password", F_PASSWORD)
        assert http.get("/api/me").status_code == 401
        teo = http.post("/api/session", json={"email": ENGINEER[0], "password": ENGINEER[1]})
        assert teo.status_code == 200
        assert (teo.json()["member"]["name"], teo.json()["member"]["role"]) == (ENGINEER_NAME, "engineer")


def test_endpoints_refuse_without_session(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    lamp = assembly_named(api, LAMP)
    plate = part_named(api, "Base Plate")
    sid = plate["sketches"][0]["id"]
    probes: list[tuple[str, str, Any]] = [
        ("GET", "/api/me", None), ("PATCH", "/api/me", {"units": "in"}), ("GET", "/api/workspace", None),
        ("GET", "/api/materials", None), ("GET", "/api/status", None), ("GET", "/api/parts", None),
        ("GET", f"/api/parts/{plate['id']}", None), ("GET", f"/api/parts/{plate['id']}/body", None),
        ("POST", "/api/parts", {"name": "x", "material_id": "x"}), ("POST", f"/api/parts/{plate['id']}/save", {}),
        ("GET", f"/api/sketches/{sid}", None),
        ("POST", f"/api/sketches/{sid}/constraints", {"base_revision": 1, "kind": "fix", "refs": ["origin"]}),
        ("GET", "/api/assemblies", None), ("GET", f"/api/assemblies/{lamp['id']}/tree", None),
        ("GET", f"/api/assemblies/{lamp['id']}/bom", None),
        ("POST", f"/api/assemblies/{lamp['id']}/instances", {"base_revision": 1, "quantity": 1}),
        ("GET", "/api/purchased", None), ("POST", "/api/purchased", {"name": "x", "declared_mass_g": 1}),
        ("GET", "/api/parts/no-such-part", None),
    ]
    for cookies in ({}, {"kerfline_session": "not-a-session"}):
        with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, cookies=cookies) as http:
            for method, path, body in probes:
                response = http.request(method, path, json=body) if body is not None else http.request(method, path)
                assert err(response, 401, "unauthenticated")["message"] == MSG_UNAUTH, path
            health = http.get("/api/health")
            assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert get_assembly(api, lamp["id"])["revision"] == lamp["revision"]
    assert get_part(api, plate["id"])["body"]["build"] == plate["body"]["build"]


def test_seed_records_exact(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    teo = Api(app_url, ENGINEER)
    assert (api.member["units"], api.member["precision"]) == ("mm", 2)
    assert (teo.member["units"], teo.member["precision"]) == ("in", 3)
    workspace = api.ok("GET", "/api/workspace")
    assert workspace["name"] == WORKSPACE_NAME and workspace["product"]["name"] == LAMP
    assert sorted((m["name"], m["role"]) for m in workspace["members"]) == [
        (FOUNDER_NAME, "founder"), (ENGINEER_NAME, "engineer")]
    lamp = assembly_named(api, LAMP)
    assert workspace["product"]["assembly_id"] == lamp["id"]
    mats = api.ok("GET", "/api/materials")["materials"]
    assert [(m["name"], m["density_g_cm3"]) for m in mats] == [(n, DENSITY[n]) for n in (ALU, ACETAL, PETG)]

    parts = api.ok("GET", "/api/parts")["parts"]
    for name in SEED_PART_NAMES:
        part = named(parts, name)
        assert part["revision"] == 1, f"{name} revision"
    for name, (material, volume, area, centroid, mass) in SEED_PARTS.items():
        part = named(parts, name)
        assert part["material"]["name"] == material
        sketches = {s["name"]: s for s in part["sketches"]}
        features = [(f["name"], next(s["name"] for s in part["sketches"] if s["id"] == f["sketch_id"]),
                     f["operation"], f["depth_mm"], f["direction"]) for f in part["features"]]
        assert features == SEED_FEATURES[name], f"{name} extrudes {features}"
        for sketch in sketches.values():
            assert (sketch["plane"], sketch["offset_mm"], sketch["slack"], sketch["fully_held"], sketch["revision"]) == (
                "top", 0, 0, True, 1), f"{name} {sketch}"
        assert part["body"] == {"status": "stored", "build": 1}, f"{name} body {part['body']}"
        confirmed = part["confirmed"]
        assert confirmed["build"] == 1 and confirmed["object_key"] == body_key(part["id"], 1)
        side = max(abs(c) for c in centroid) * 2 or 1
        obj = body_object(part["id"], 1)
        assert (obj["part_id"], obj["build"], obj["units"]) == (part["id"], 1, "mm")
        figures = mesh_figures(obj)
        assert_confirmed(confirmed, volume, area, centroid, mass, figures["side"] or side, name)
        near(figures["volume"], confirmed["volume_mm3"], f"{name} stored mesh volume")
    plate = named(parts, "Base Plate")
    assert sorted(s["name"] for s in plate["sketches"]) == ["Sketch 1", "Sketch 2"]
    hole = get_sketch(api, next(s["id"] for s in plate["sketches"] if s["name"] == "Sketch 2"))
    assert [(e["label"], e["type"], e["center"], e["radius"]) for e in hole["entities"]] == [
        ("Circle 1", "circle", {"x": 60, "y": 40}, 10)]
    assert [(c["label"], c.get("value_mm")) for c in hole["constraints"]] == [
        ("Horizontal distance 1", 60), ("Vertical distance 1", 40), ("Diameter 1", 20)]

    switch = named(parts, "Switch Cover")
    assert switch["material"]["name"] == PETG
    assert switch["body"] == {"status": "none", "build": None} and switch["confirmed"] is None
    assert switch["features"] == [] and len(switch["sketches"]) == 1
    sketch = get_sketch(api, switch["sketches"][0]["id"])
    assert (sketch["name"], sketch["slack"], sketch["fully_held"], sketch["revision"]) == ("Sketch 1", 2, False, 1)
    assert [e["label"] for e in sketch["entities"]] == ["Line 1", "Line 2", "Line 3", "Line 4"]
    assert [c["label"] for c in sketch["constraints"]] == RECT_LABELS[:9]
    assert not any(c["redundant"] for c in sketch["constraints"])
    assert {k: v for k, v in freedoms(sketch).items() if k in SWITCH_FREEDOM} == SWITCH_FREEDOM
    assert S3().keys(f"bodies/{switch['id']}/") == []

    assemblies = api.ok("GET", "/api/assemblies")["assemblies"]
    for name, instances in SEED_INSTANCES.items():
        record = named(assemblies, name)
        assert record["revision"] == 1
        assert [(i["component"]["type"], i["component"]["name"], i["quantity"]) for i in record["instances"]] == instances
    rollup = lamp["rollup"]
    near(rollup["mass_g"], SEED_LAMP_TOTAL[0], "lamp total")
    assert (rollup["part_count"], rollup["line_count"]) == SEED_LAMP_TOTAL[1:]
    for name, (mass, pieces) in ((ARM, SEED_ARM_TOTAL), (HEAD, SEED_HEAD_TOTAL)):
        near(named(assemblies, name)["rollup"]["mass_g"], mass, f"{name} total")
        assert named(assemblies, name)["rollup"]["part_count"] == pieces
    lines = bom(api, lamp["id"])["lines"]
    assert [(l["item"]["name"], l["kind"], l["quantity"]) for l in lines] == [s[:3] for s in SEED_BOM]
    for line_, (_, _, _, line_mass) in zip(lines, SEED_BOM):
        near(line_["line_mass_g"], line_mass, f"BOM {line_['item']['name']}")
    purchased = api.ok("GET", "/api/purchased")["purchased"]
    for name, mass in ((M4, M4_MASS_G), (M3, M3_MASS_G)):
        record = named(purchased, name)
        assert (record["declared_mass_g"], record["revision"]) == (mass, 1)


def test_slack_and_point_freedom_from_solver(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Freedom probe")
    sid = create_sketch(api, part["id"])["id"]
    assert get_sketch(api, sid)["slack"] == 0
    l1 = add_entity(api, sid, line(0, 0, 20, 0))["id"]
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 4
    assert freedoms(sketch)["Line 1 start"] == 2 and freedoms(sketch)["Line 1 end"] == 2
    p1 = add_entity(api, sid, {"type": "point", "x": 5, "y": 5})["id"]
    assert get_sketch(api, sid)["slack"] == 6 and freedoms(get_sketch(api, sid))["Point 1"] == 2
    add_entity(api, sid, circle(40, 0, 5))
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 9 and freedoms(sketch)["Circle 1 centre"] == 2
    add_entity(api, sid, {"type": "arc", "center": {"x": 0, "y": 40}, "radius": 10,
                          "start_angle_deg": 0, "end_angle_deg": 90})
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 14
    assert all(freedoms(sketch)[f"Arc 1 {p}"] == 2 for p in ("centre", "start", "end"))
    constrain(api, sid, "fix", [f"{l1}.start"])
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 12 and freedoms(sketch)["Line 1 start"] == 0 and freedoms(sketch)["Line 1 end"] == 2
    constrain(api, sid, "horizontal", [l1])
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 11 and freedoms(sketch)["Line 1 end"] == 1
    constrain(api, sid, "coincident", [p1, f"{l1}.end"])
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 9 and freedoms(sketch)["Point 1"] == 1
    constrain(api, sid, "distance", [l1], 20)
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 8 and freedoms(sketch)["Line 1 end"] == 0 and freedoms(sketch)["Point 1"] == 0
    entities = {e["label"]: e for e in sketch["entities"]}
    seg = entities["Line 1"]
    assert abs(seg["end"]["y"] - seg["start"]["y"]) <= SOLVE_TOL_MM
    assert abs(math.dist((seg["start"]["x"], seg["start"]["y"]), (seg["end"]["x"], seg["end"]["y"])) - 20) <= SOLVE_TOL_MM
    assert abs(entities["Point 1"]["x"] - seg["end"]["x"]) <= SOLVE_TOL_MM
    rect_sid, _ = rect_sketch(api, part["id"], 24, 16, distances=0)
    rect = get_sketch(api, rect_sid)
    assert rect["slack"] == 2 and not rect["fully_held"]
    assert {k: v for k, v in freedoms(rect).items() if k in SWITCH_FREEDOM} == SWITCH_FREEDOM


def test_constraint_rank_and_redundancy(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Rank probe")
    sid = create_sketch(api, part["id"])["id"]
    l1 = add_entity(api, sid, line(0, 0, 24, 0))["id"]
    l2 = add_entity(api, sid, line(24, 0, 24, 16))["id"]
    l3 = add_entity(api, sid, line(24, 16, 0, 16))["id"]
    l4 = add_entity(api, sid, line(0, 16, 0, 0))["id"]
    assert get_sketch(api, sid)["slack"] == 16
    steps = [("coincident", [f"{l1}.end", f"{l2}.start"], 14), ("coincident", [f"{l2}.end", f"{l3}.start"], 12),
             ("coincident", [f"{l3}.end", f"{l4}.start"], 10), ("coincident", [f"{l4}.end", f"{l1}.start"], 8),
             ("horizontal", [l1], 7), ("vertical", [l2], 6), ("horizontal", [l3], 5), ("vertical", [l4], 4),
             ("coincident", [f"{l1}.start", "origin"], 2)]
    for (kind, refs, slack), expected_label in zip(steps, RECT_LABELS):
        result = constrain(api, sid, kind, refs)
        assert result["constraint"]["label"] == expected_label and result["constraint"]["redundant"] is False
        assert result["sketch"]["slack"] == slack, f"after {expected_label}: slack {result['sketch']['slack']}"
    revision = get_sketch(api, sid)["revision"]
    parallel = constrain(api, sid, "parallel", [l1, l3])
    assert parallel["constraint"]["label"] == label("Parallel", 1) and parallel["constraint"]["redundant"] is True
    assert parallel["sketch"]["slack"] == 2 and parallel["sketch"]["revision"] == revision + 1
    twin = constrain(api, sid, "coincident", [f"{l1}.start", f"{l4}.end"])
    assert twin["constraint"]["label"] == label("Coincident", 6) and twin["constraint"]["redundant"] is True
    assert twin["sketch"]["slack"] == 2
    field_error(post_constraint(api, sid, "diameter", [l1], 5), "refs",
                "These entities cannot take a Diameter constraint.")
    horizontal_2 = constraint_labelled(get_sketch(api, sid), "Horizontal 2")
    deleted = delete_constraint(api, sid, horizontal_2["id"])
    assert deleted.status_code == 200, deleted.text
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 2
    assert constraint_labelled(sketch, label("Parallel", 1))["redundant"] is False
    assert constraint_labelled(sketch, label("Coincident", 6))["redundant"] is True
    result = constrain(api, sid, "distance", [l1], 24)
    assert result["sketch"]["slack"] == 1 and result["constraint"]["redundant"] is False


def test_slack_rings_and_readout(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Ring cover", PETG)
    sid, _ = rect_sketch(api, part["id"], 24, 16, distances=0)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    await_visible(page, page.get_by_role("table", name="Assembly tree"), "lamp opens")
    assert text_of(slack_readout(page)) == "", "Slack readout is empty outside sketch mode (L171)"
    open_sketch(page, part["name"])
    await_exact(page, slack_readout(page), "Slack 2", "Slack readout")
    settle(sketch_canvas(page))
    for point, freedom in SWITCH_FREEDOM.items():
        if freedom:
            await_visible(page, ring_of(page, point), f"ring at {point}")
        else:
            assert ring_of(page, point).count() == 0, f"no ring at {point} with freedom 0"
    one, two = width_of(ring_of(page, "Line 1 end")), width_of(ring_of(page, "Line 2 end"))
    assert one and two and one >= 2 * RING_PX - 2 * PX_ROUNDING, (one, two)
    assert abs((two - one) - 2 * RING_PX) <= 2 * PX_ROUNDING, f"ring widths {one} and {two} differ by 2 × 6 px"
    focus_canvas(page)
    page.keyboard.press("+")
    advance(page, STEP_MS)
    settle(sketch_canvas(page))
    zoomed = width_of(ring_of(page, "Line 2 end"))
    assert zoomed is not None and abs(zoomed - two) <= 2 * PX_ROUNDING, f"ring changed with zoom: {two} -> {zoomed}"
    before = decode(capture(sketch_canvas(page)))
    revision = get_sketch(api, sid)["revision"]
    kb_select(page, "Line 1")
    click(constrain_button(page, "Dimension"))
    apply_dimension(page, "24")
    await_sketch_revision(page, api, sid, revision + 1)
    await_exact(page, slack_readout(page), "Slack 1", "Slack readout")
    back_to_canvas(page)
    kb_select(page, "Line 2")
    click(constrain_button(page, "Dimension"))
    apply_dimension(page, "16")
    await_sketch_revision(page, api, sid, revision + 2)
    await_exact(page, slack_readout(page), "Fully held", "Slack readout")
    poll(page, lambda: sketch_canvas(page).get_by_role("img", name=re.compile("^Slack ring at ")).count() == 0,
         "every slack ring disappears at Fully held")
    settle(sketch_canvas(page))
    after = decode(capture(sketch_canvas(page)))
    assert difference(before, after) > 0, "strokes did not change when the sketch became Fully held"
    assert get_sketch(api, sid)["fully_held"] is True


def test_ring_resize_before_readout_count(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Motion probe")
    sid = create_sketch(api, part["id"])["id"]
    add_entity(api, sid, line(0, 0, 20, 0))
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    await_exact(page, slack_readout(page), "Slack 4", "Slack readout")
    kb_select(page, "Line 1 start")
    ring = ring_of(page, "Line 1 start")
    await_visible(page, ring, "ring at Line 1 start")
    with page.expect_response(lambda r: "/constraints" in r.url and r.request.method == "POST",
                              timeout=HTTP_TIMEOUT_S * 1000):
        click(constrain_button(page, "Fix"))
    samples = timeline(page, lambda: (width_of(ring), text_of(slack_readout(page))), 1500)
    first_width = samples[0][1][0]
    assert first_width, "the ring was gone before any motion was sampled"
    change = next((t for t, (w, _) in samples if w is None or abs(w - first_width) > PX_ROUNDING), None)
    gone = next((t for t, (w, _) in samples if w is None), None)
    assert change is not None and gone is not None, f"ring never shrank away: {samples}"
    assert RING_MIN_MS - SAMPLE_MS <= gone - change + SAMPLE_MS and gone - change <= RING_MAX_MS + SAMPLE_MS, (
        f"ring resize took {gone - change} ms; expected 150–300 ms (L298)")
    texts: list[str] = []
    for _, (_, text) in samples:
        if not texts or texts[-1] != text:
            texts.append(text)
    assert texts == ["Slack 4", "Slack 3", "Slack 2"], f"readout sequence {texts} (L299)"
    count_start = next(t for t, (_, text) in samples if text != "Slack 4")
    count_end = next(t for t, (_, text) in samples if text == "Slack 2")
    assert count_start >= gone - SAMPLE_MS, f"readout counted at {count_start} ms before rings finished at {gone} ms"
    assert count_end - gone <= COUNT_MAX_MS + 2 * SAMPLE_MS, f"count ended {count_end - gone} ms after the rings"
    assert count_end - gone >= COUNT_MIN_MS / 2 - SAMPLE_MS, f"count too fast: {count_end - gone} ms"
    assert get_sketch(api, sid)["slack"] == 2


def reddish(pixels: Any) -> float:
    rgb, hits = pixels.rgb, 0
    for i in range(0, len(rgb), 3):
        r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
        hits += r >= 120 and r - g >= 50 and r - b >= 50
    return hits / max(1, len(rgb) // 3)


def test_conflict_flash_twice(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Flash cover", PETG)
    sid, _ = rect_sketch(api, part["id"], 24, 16, distances=1)
    before = get_sketch(api, sid)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    await_exact(page, slack_readout(page), "Slack 1", "Slack readout")
    named_glyph = await_visible(page, glyph(page, "Distance 1"), "glyph Distance 1")
    settle(sketch_canvas(page))
    rest = decode(capture(named_glyph))
    kb_select(page, "Line 1")
    page.keyboard.press("d")
    field = await_visible(page, dimension_field(page), "Dimension value")
    fill(field, "30")
    with page.expect_response(lambda r: "/constraints" in r.url and r.request.method == "POST",
                              timeout=HTTP_TIMEOUT_S * 1000):
        field.press("Enter")
    ghost = glyph(page, "Distance 2")
    base = reddish(rest)
    samples = timeline(page, lambda: (reddish(decode(capture(named_glyph))), ghost.count() > 0), 1200)
    peak = max(d for _, (d, _) in samples)
    assert peak > base, "the named glyph never turned conflict red"
    red = [d > (base + peak) / 2 for _, (d, _) in samples]
    rises = [samples[i][0] for i in range(len(red)) if red[i] and (i == 0 or not red[i - 1])]
    assert len(rises) == 2, f"named glyph turned red {len(rises)} times; expected twice (L305)"
    period = rises[1] - rises[0]
    assert TURN_MIN_MS - SAMPLE_MS <= period <= 2 * TURN_MAX_MS + SAMPLE_MS, f"flash period {period} ms"
    assert not red[-1], "the named glyph did not return to rest"
    assert any(present for _, (_, present) in samples), "no ghost glyph for the refused Distance 2"
    assert not samples[-1][1][1], "ghost glyph stayed after the flash (L306)"
    await_exact(page, model_message(page), "Distance 2 would conflict with Distance 1. Nothing was changed.")
    after = get_sketch(api, sid)
    assert after["revision"] == before["revision"] and after["entities"] == before["entities"]


def test_over_constraint_refused_names_conflict(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Conflict probe")
    sid, (l1, l2, l3, l4) = rect_sketch(api, part["id"], 24, 16)
    before = get_sketch(api, sid)
    cases = [("vertical", [l1], None, label("Vertical", 3), "Horizontal 1"),
             ("distance", [l1], 30, label("Distance", 3), DISTANCE_1),
             ("distance", [l3], 30, label("Distance", 3), "Horizontal 2"),
             ("perpendicular", [l1, l3], None, label("Perpendicular", 1), DISTANCE_1)]
    for kind, refs, value, refused, existing in cases:
        error = err(post_constraint(api, sid, kind, refs, value), 409, "over_constrained")
        assert error["refused_label"] == refused
        assert error["conflicts_with"] == {"id": constraint_labelled(before, existing)["id"], "label": existing}
        assert error["message"] == f"{refused} would conflict with {existing}. Nothing was changed."
        now = get_sketch(api, sid)
        assert now["revision"] == before["revision"] and now["constraints"] == before["constraints"]
        assert now["entities"] == before["entities"]
    p1 = add_entity(api, sid, {"type": "point", "x": -10, "y": 0})["id"]
    assert constrain(api, sid, "distance", ["origin", p1], 10)["constraint"]["label"] == label("Distance", 3)
    p2 = add_entity(api, sid, {"type": "point", "x": -10, "y": 10})["id"]
    constrain(api, sid, "distance", [p1, p2], 10)
    third = constrain(api, sid, "distance", ["origin", p2], 15)["constraint"]
    revision = get_sketch(api, sid)["revision"]
    error = err(patch_constraint(api, sid, third["id"], value=30), 409, "unsolvable")
    assert error["message"] == MSG_UNSOLVABLE
    after = get_sketch(api, sid)
    assert after["revision"] == revision and constraint_labelled(after, third["label"])["value_mm"] == 15


def test_lengths_stored_once_in_mm(app_url: str) -> None:
    founder, teo = Api(app_url, FOUNDER), Api(app_url, ENGINEER)
    part = create_part(founder, "Units probe")
    sid = create_sketch(founder, part["id"])["id"]
    try:
        prefs(teo, "in", 3)
        seg = add_entity(teo, sid, line("0", "0", "0.5 in", 0))
        same(seg["end"]["x"], 0.5 * INCH_MM, "0.5 in end x")
        third = constrain(teo, sid, "distance", [seg["id"]], "1/3")["constraint"]
        same(third["value_mm"], INCH_MM / 3, "1/3 with inch display")
        assert third["value_mm"] != round(third["value_mm"], 3), "value was rounded to the display precision"
        changed_prefs = teo.ok("PATCH", "/api/me", {"units": "mm", "precision": 0})["member"]
        assert (changed_prefs["units"], changed_prefs["precision"]) == ("mm", 0)
        for reader in (teo, founder):
            same(constraint_labelled(get_sketch(reader, sid), "Distance 1")["value_mm"], INCH_MM / 3, "after switch")
        field_error(teo.call("PATCH", "/api/me", {"units": "cm"}), "units", F_OPTION)
        field_error(teo.call("PATCH", "/api/me", {"precision": 5}), "precision", F_OPTION)
        teo.ok("PATCH", "/api/me", {"units": "in", "precision": 3})
        same(constraint_labelled(get_sketch(teo, sid), "Distance 1")["value_mm"], INCH_MM / 3, "after switch back")
    finally:
        prefs(teo, "in", 3)


def test_dimension_input_grammar(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Grammar probe")
    sid = create_sketch(api, part["id"])["id"]
    seg = add_entity(api, sid, line(0, 0, 20, 0))["id"]
    dim = constrain(api, sid, "distance", [seg], 20)["constraint"]
    valid = {"1/4in": 6.35, "0.25 in": 6.35, "6.35": 6.35, " .25 IN ": 6.35, " 6.35 mm ": 6.35,
             "1 in": INCH_MM, "1/2": 0.5, "10000": MAX_LENGTH_MM, "25.4 Mm": INCH_MM}
    for text, mm in valid.items():
        response = patch_constraint(api, sid, dim["id"], value=text)
        assert response.status_code == 200, f"{text!r}: {response.text[:200]}"
        same(response.json()["constraint"]["value_mm"], mm, f"value {text!r}")
    same(patch_constraint(api, sid, dim["id"], value=6.35).json()["constraint"]["value_mm"], 6.35, "number")
    revision = get_sketch(api, sid)["revision"]
    bad = {"abc": F_GRAMMAR, "6.35 cm": F_GRAMMAR, "1/0": F_GRAMMAR, "-5": F_GRAMMAR, "−5": F_GRAMMAR,
           "": F_GRAMMAR, "5 in in": F_GRAMMAR, "0": F_LENGTH_RANGE, "0 in": F_LENGTH_RANGE,
           "10000.5": F_LENGTH_RANGE}
    for text, message in bad.items():
        field_error(patch_constraint(api, sid, dim["id"], value=text), "value", message)
    sketch = get_sketch(api, sid)
    assert sketch["revision"] == revision and constraint_labelled(sketch, "Distance 1")["value_mm"] == 6.35
    neg = add_entity(api, sid, line("-5", "−0.5 in", "−10000", 0))
    assert (neg["start"]["x"], neg["end"]["x"]) == (-5, -MAX_LENGTH_MM)
    same(neg["start"]["y"], -0.5 * INCH_MM, "−0.5 in")
    field_error(post_entity(api, sid, line("abc", 0, 1, 1)), "entity.start.x", F_GRAMMAR)
    field_error(post_entity(api, sid, line(0, 0, 1, "10001")), "entity.end.y", F_COORD_RANGE)
    field_error(post_entity(api, sid, circle(0, 0, "-2")), "entity.radius", F_GRAMMAR)
    field_error(post_entity(api, sid, circle(0, 0, 0)), "entity.radius", F_LENGTH_RANGE)
    field_error(post_entity(api, sid, {"type": "arc", "center": {"x": 0, "y": 0}, "radius": 5,
                                       "start_angle_deg": "abc", "end_angle_deg": 90}), "entity.start_angle_deg", F_ANGLE)
    field_error(api.call("POST", f"/api/parts/{part['id']}/sketches", {
        "base_revision": get_part(api, part["id"])["revision"], "plane": "top", "offset": "abc"}), "offset", F_GRAMMAR)
    field_error(api.call("POST", f"/api/parts/{part['id']}/sketches", {
        "base_revision": get_part(api, part["id"])["revision"], "plane": "side", "offset": 0}), "plane", F_OPTION)


def test_tolerances_stored_in_mm(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Tolerance probe")
    sid = create_sketch(api, part["id"])["id"]
    seg = add_entity(api, sid, line(0, 0, 24, 0))["id"]
    dim = constrain(api, sid, "distance", [seg], 24, {"kind": "symmetric", "value": 0.05})["constraint"]
    assert dim["tolerance"]["kind"] == "symmetric"
    same(dim["tolerance"]["plus_mm"], 0.05, "plus")
    same(dim["tolerance"]["minus_mm"], 0.05, "minus")
    cases = {"±0.05": ("symmetric", 0.05, 0.05), "+-0.05": ("symmetric", 0.05, 0.05),
             " + 0.1 / − 0.05 ": ("asymmetric", 0.1, 0.05), "+0.1/-0.05": ("asymmetric", 0.1, 0.05),
             "±0.002 in": ("symmetric", 0.002 * INCH_MM, 0.002 * INCH_MM),
             "+0.004/-0.002 in": ("asymmetric", 0.004 * INCH_MM, 0.002 * INCH_MM)}
    for text, (kind, plus, minus) in cases.items():
        response = patch_constraint(api, sid, dim["id"], tolerance=text)
        assert response.status_code == 200, f"{text!r}: {response.text[:200]}"
        tol = response.json()["constraint"]["tolerance"]
        assert tol["kind"] == kind, text
        same(tol["plus_mm"], plus, f"{text} plus")
        same(tol["minus_mm"], minus, f"{text} minus")
        same(response.json()["constraint"]["value_mm"], 24, "nominal untouched by tolerance")
    obj = patch_constraint(api, sid, dim["id"], tolerance={"kind": "asymmetric", "plus": "0.1", "minus": 0.05})
    assert obj.status_code == 200 and obj.json()["constraint"]["tolerance"]["kind"] == "asymmetric"
    for clear in (None, ""):
        cleared = patch_constraint(api, sid, dim["id"], tolerance=clear)
        assert cleared.status_code == 200 and not cleared.json()["constraint"].get("tolerance")
    revision = get_sketch(api, sid)["revision"]
    for bad in ("0.05", "±abc", "+0.1", "±10001", {"kind": "symmetric", "value": -1}):
        field_error(patch_constraint(api, sid, dim["id"], tolerance=bad), "tolerance", F_TOLERANCE)
    assert get_sketch(api, sid)["revision"] == revision


def test_tolerance_display_formats(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part = create_part(api, "Tolerance view", PETG)
    sid, (l1, l2, _, _) = rect_sketch(api, part["id"], 24, 16, distances=0)
    constrain(api, sid, "distance", [l1], 24, "±0.05")
    constrain(api, sid, "distance", [l2], 16, "+0.1/−0.05")
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    await_text(page, constraint_item(page, "Distance 1"), "24.00 ± 0.05 mm")
    await_text(page, constraint_item(page, "Distance 2"), "16.00 +0.10 −0.05 mm")


def test_extrude_rules(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Extrude probe")
    pid = part["id"]
    s1, lines = rect_sketch(api, pid, 30, 20, distances=1)
    error = err(post_extrude(api, pid, s1, 12), 409, "profile_not_ready")
    s1_name = get_sketch(api, s1)["name"]
    assert error["message"] == f"{s1_name} needs a closed, fully held profile before it can be extruded."
    s2 = create_sketch(api, pid)["id"]
    seg = add_entity(api, s2, line(0, 0, 10, 0))["id"]
    constrain(api, s2, "fix", [f"{seg}.start"])
    constrain(api, s2, "fix", [f"{seg}.end"])
    assert get_sketch(api, s2)["fully_held"] is True
    error = err(post_extrude(api, pid, s2, 12), 409, "profile_not_ready")
    s2_name = get_sketch(api, s2)["name"]
    assert error["message"] == f"{s2_name} needs a closed, fully held profile before it can be extruded."
    constrain(api, s1, "distance", [lines[1]], 20)
    field_error(post_extrude(api, pid, s1, 12, "join"), "operation", F_OPERATION)
    field_error(post_extrude(api, pid, s1, "0"), "depth", F_LENGTH_RANGE)
    field_error(post_extrude(api, pid, s1, MAX_LENGTH_MM + 1), "depth", F_LENGTH_RANGE)
    field_error(post_extrude(api, pid, s1, "abc"), "depth", F_GRAMMAR)
    field_error(post_extrude(api, pid, s1, 12, direction="up"), "direction", F_OPTION)
    assert get_part(api, pid)["features"] == [] and get_part(api, pid)["body"]["status"] == "none"
    response = post_extrude(api, pid, s1, 12)
    assert response.status_code == 201, response.text
    feature = response.json()["feature"]
    assert (feature["name"], feature["operation"], feature["depth_mm"], feature["direction"]) == (
        "Extrude 1", "new", 12, "normal")
    assert response.json()["part"]["confirmed"]["centroid_mm"]["z"] == pytest.approx(6, abs=REL * 30)
    field_error(post_extrude(api, pid, s1, 12, "new"), "operation", F_OPERATION)
    for direction, z in (("reverse", -6), ("symmetric", 0)):
        moved = patch_feature(api, pid, feature["id"], direction=direction)
        assert moved.status_code == 200, moved.text
        assert moved.json()["part"]["confirmed"]["centroid_mm"]["z"] == pytest.approx(z, abs=REL * 30), direction
    inch = patch_feature(api, pid, feature["id"], depth="1/2 in", direction="normal")
    assert inch.status_code == 200
    near(inch.json()["part"]["confirmed"]["volume_mm3"], 600 * 0.5 * INCH_MM, "depth 1/2 in")
    revision = get_sketch(api, s1)["revision"]
    drives = err(post_entity(api, s1, line(50, 50, 60, 50)), 409, "sketch_drives_feature")
    assert drives["message"] == f"{s1_name} drives {feature['name']} and must stay fully held. Nothing was changed."
    dist1 = constraint_labelled(get_sketch(api, s1), "Distance 1")
    err(delete_constraint(api, s1, dist1["id"]), 409, "sketch_drives_feature")
    err(api.call("DELETE", f"/api/sketches/{s1}/entities/{lines[0]}", params={"base_revision": revision}),
        409, "sketch_drives_feature")
    assert get_sketch(api, s1)["revision"] == revision
    rebuilt = patch_constraint(api, s1, dist1["id"], value=40)
    assert rebuilt.status_code == 200, rebuilt.text
    near(get_part(api, pid)["confirmed"]["volume_mm3"], 40 * 20 * 0.5 * INCH_MM, "rebuild after value change")
    longest = patch_feature(api, pid, feature["id"], depth=MAX_LENGTH_MM)
    assert longest.status_code == 200, "10000 mm depth is allowed (L617)"


def test_extrude_idempotency(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Replay probe")
    pid = part["id"]
    sid, _ = rect_sketch(api, pid, 30, 20)
    body = {"base_revision": get_part(api, pid)["revision"], "sketch_id": sid, "operation": "new",
            "depth": 12, "direction": "normal"}
    path = f"/api/parts/{pid}/features"
    field_error(api.call("POST", path, body), "idempotency_key", F_KEY)
    field_error(api.call("POST", path, body, key="k" * (KEY_MAX + 1)), "idempotency_key", F_KEY)
    key = idempotency_key()
    first = api.call("POST", path, body, key=key)
    assert first.status_code == 201, first.text
    revision = get_part(api, pid)["revision"]
    replay = api.call("POST", path, body, key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replayed") == "true"
    assert len(get_part(api, pid)["features"]) == 1 and get_part(api, pid)["revision"] == revision
    error = err(api.call("POST", path, {**body, "base_revision": revision, "depth": 13}, key=key), 409,
                "idempotency_conflict")
    assert error["message"] == MSG_IDEM_CONFLICT
    patch_feature(api, pid, first.json()["feature"]["id"], depth=20)
    later = api.call("POST", path, body, key=key)
    assert later.status_code == 201 and later.json() == first.json()
    assert len(get_part(api, pid)["features"]) == 1
    other = create_part(api, "Replay race")
    osid, _ = rect_sketch(api, other["id"], 30, 20)
    race_body = {"base_revision": get_part(api, other["id"])["revision"], "sketch_id": osid, "operation": "new",
                 "depth": 12, "direction": "normal"}
    race_key = idempotency_key()
    results = together([lambda: api.call("POST", f"/api/parts/{other['id']}/features", race_body, key=race_key,
                                         client=api.clone()) for _ in range(PARALLEL)])
    assert all(r.status_code == 201 for r in results), [r.status_code for r in results]
    assert len({r.json()["feature"]["id"] for r in results}) == 1
    assert len(get_part(api, other["id"])["features"]) == 1


def test_depth_preview_updates_in_place(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part, _ = made_part(api, "Preview bracket", 30, 20, 12)
    start = part["confirmed"]["volume_mm3"]
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_child(page, part["name"], "Extrude 1")
    form = await_visible(page, page.get_by_role("form", name=f"Edit {EXTRUDE_1}"), "edit extrude form")
    depth = form.get_by_role("textbox", name="Depth")
    for typed in (20, 15):
        fill(depth, str(typed))
        preview = start + 600 * (typed - 12)
        await_text(page, measurements(page), "Preview")
        await_text(page, measurements(page), mm3(preview))
        await_text(page, measurements(page), grams(preview * DENSITY[ACETAL] / 1000))
    assert get_part(api, part["id"])["revision"] == part["revision"], "typing committed a change"
    slider = page.get_by_role("slider", name="Extrude depth")
    slider.press("ArrowUp")
    await_text(page, measurements(page), mm3(start + 600 * 4))
    slider.press("Enter")
    committed = poll(page, lambda: (lambda p: p if p["features"][0]["depth_mm"] == 16 and p["body"]["status"] == "stored"
                                    else None)(get_part(api, part["id"])), "slider Enter commits depth 16")
    await_text(page, measurements(page), "Confirmed")
    await_text(page, measurements(page), mm3(committed["confirmed"]["volume_mm3"]))
    assert "Preview" not in text_of(measurements(page))


def test_booleans_give_one_connected_body(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part, _ = made_part(api, "Boolean block", 30, 20, 12)
    pid = part["id"]
    tab, _ = rect_sketch(api, pid, 10, 10, x0=30, y0=5)
    joined = extrude(api, pid, tab, 12, "join")
    near(joined["confirmed"]["volume_mm3"], 8400, "touching join")
    mesh = mesh_figures(body_object(pid, joined["confirmed"]["build"]))
    assert mesh["closed"] and mesh["components"] == 1, "joined body is not one closed mesh"
    far, _ = rect_sketch(api, pid, 10, 10, x0=50, y0=5)
    slot, _ = rect_sketch(api, pid, 10, 30, x0=10, y0=-5)
    everything, _ = rect_sketch(api, pid, 50, 30, x0=-5, y0=-5)
    refusals = [(far, "intersect", "empty_body", "Intersect leaves no material. Nothing was changed."),
                (far, "join", "separate_bodies",
                 "Join would leave separate pieces; a part must be one connected body. Nothing was changed."),
                (slot, "cut", "separate_bodies",
                 "Cut would leave separate pieces; a part must be one connected body. Nothing was changed."),
                (everything, "cut", "empty_body", "Cut leaves no material. Nothing was changed.")]
    for sid, op, code, message in refusals:
        before = get_part(api, pid)
        keys = S3().keys(f"bodies/{pid}/")
        error = err(post_extrude(api, pid, sid, 40, op, "symmetric"), 409, code)
        assert error["message"] == message
        after = get_part(api, pid)
        assert (after["revision"], after["features"], after["confirmed"]) == (
            before["revision"], before["features"], before["confirmed"])
        assert S3().keys(f"bodies/{pid}/") == keys, f"{op} refusal wrote an object"
    window, _ = rect_sketch(api, pid, 30, 10, x0=5, y0=5)
    kept = extrude(api, pid, window, 40, "intersect", "symmetric")
    near(kept["confirmed"]["volume_mm3"], 3600, "overlapping intersect")
    mesh = mesh_figures(body_object(pid, kept["confirmed"]["build"]))
    assert mesh["closed"] and mesh["components"] == 1


def test_mass_properties_closed_form(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part, _ = made_part(api, "Mass block", 30, 20, 12)
    assert_confirmed(part["confirmed"], 7200, 2400, (15, 10, 6), 10.152, 30, "block")
    hole = create_sketch(api, part["id"])["id"]
    c = add_entity(api, hole, circle(15, 10, 5))["id"]
    constrain(api, hole, "horizontal_distance", ["origin", f"{c}.center"], 15)
    constrain(api, hole, "vertical_distance", ["origin", f"{c}.center"], 10)
    constrain(api, hole, "diameter", [c], 10)
    cut = extrude(api, part["id"], hole, 40, "cut", "symmetric")
    volume = 7200 - 300 * math.pi
    assert_confirmed(cut["confirmed"], volume, 2400 + 70 * math.pi, (15, 10, 6), volume * DENSITY[ACETAL] / 1000,
                     30, "block with hole")
    mesh = mesh_figures(body_object(part["id"], cut["confirmed"]["build"]))
    near(mesh["volume"], cut["confirmed"]["volume_mm3"], "mesh volume equals confirmed volume")
    near(mesh["area"], cut["confirmed"]["area_mm2"], "mesh area equals confirmed area")
    ring = create_part(api, "Mass ring", PETG)
    rsid = create_sketch(api, ring["id"])["id"]
    outer = add_entity(api, rsid, circle(0, 0, 30))["id"]
    inner = add_entity(api, rsid, circle(0, 0, 28))["id"]
    constrain(api, rsid, "coincident", [f"{outer}.center", "origin"])
    constrain(api, rsid, "diameter", [outer], 60)
    constrain(api, rsid, "coincident", [f"{inner}.center", "origin"])
    constrain(api, rsid, "diameter", [inner], 56)
    shade = extrude(api, ring["id"], rsid, 40)
    assert_confirmed(shade["confirmed"], 4640 * math.pi, 4872 * math.pi, (0, 0, 20), 18.5128, 60, "ring")
    for plane, centroid in (("front", (15, 11, 10)), ("right", (11, 15, 10))):
        planar = create_part(api, f"Mass {plane}")
        sid, _ = rect_sketch(api, planar["id"], 30, 20, plane=plane, offset=5)
        built = extrude(api, planar["id"], sid, 12)
        assert_confirmed(built["confirmed"], 7200, 2400, centroid, 10.152, 30, f"{plane} plane")


def test_part_stored_only_after_object_written(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Storage bracket")
    pid = part["id"]
    assert part["body"] == {"status": "none", "build": None} and part["confirmed"] is None
    idle = api.ok("POST", f"/api/parts/{pid}/save", {}, status=200)["part"]
    assert idle["body"]["status"] == "none" and S3().keys(f"bodies/{pid}/") == []
    err(api.call("GET", f"/api/parts/{pid}/body"), 404, "not_found")
    sid, _ = rect_sketch(api, pid, 30, 20)
    first = extrude(api, pid, sid, 12)
    assert first["body"] == {"status": "stored", "build": 1}
    assert (first["confirmed"]["build"], first["confirmed"]["object_key"]) == (1, body_key(pid, 1))
    obj = body_object(pid, 1)
    assert (obj["part_id"], obj["build"], obj["units"]) == (pid, 1, "mm")
    near(mesh_figures(obj)["volume"], first["confirmed"]["volume_mm3"], "mesh volume")
    served = api.call("GET", f"/api/parts/{pid}/body")
    assert served.status_code == 200 and served.headers["content-type"].startswith("application/json")
    assert served.json() == obj
    second = api.ok("POST", f"/api/parts/{pid}/save", {}, status=200)["part"]
    assert second["body"] == {"status": "stored", "build": 2} and second["confirmed"]["build"] == 2
    assert body_key(pid, 2) in S3().keys(f"bodies/{pid}/")
    renamed = api.ok("PATCH", f"/api/parts/{pid}", {
        "base_revision": second["revision"], "name": fresh("Storage renamed"),
        "body": {"status": "stored", "build": 99}, "confirmed": None})["part"]
    assert renamed["body"] == {"status": "stored", "build": 3}
    assert renamed["confirmed"]["build"] == 3 and body_key(pid, 3) in S3().keys(f"bodies/{pid}/")


@pytest.mark.timeout(1200)
def test_storage_refusal_keeps_confirmed_figures(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part, _ = made_part(api, "Outage bracket", 30, 20, 12)
    pid = part["id"]
    frame = create_assembly(api, "Outage frame")
    place(api, frame["id"], "part", pid, 2)
    rollup = get_assembly(api, frame["id"])["rollup"]
    relay = StorageRelay(storage_target())
    copy = start_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}"})
    try:
        wait_health(copy)
        remote = Api(copy.url, FOUNDER)
        relay.set_mode("refuse")
        api_poll(lambda: remote.ok("GET", "/api/status")["storage"] == "unreachable", "status reports unreachable")
        fid = part["features"][0]["id"]
        response = patch_feature(remote, pid, fid, depth=24)
        assert response.status_code == 200, response.text
        failed = response.json()["part"]
        assert failed["body"] == {"status": "not_stored", "build": 2}
        assert failed["confirmed"] == part["confirmed"] and failed["features"][0]["depth_mm"] == 24
        assert get_assembly(api, frame["id"])["rollup"] == rollup
        row = next(r for r in tree_rows(api, frame["id"]) if r["component"]["id"] == pid)
        assert row["body_status"] == "not_stored" and row["unit_mass_g"] == part["confirmed"]["mass_g"]
        assert err(remote.call("GET", f"/api/parts/{pid}/body"), 503, "storage_unavailable")["message"] == MSG_STORAGE
        assert get_sketch(remote, part["sketches"][0]["id"])["fully_held"] is True
        relay.set_mode("silent")
        started = time.monotonic()
        silent = remote.call("POST", f"/api/parts/{pid}/save", {})
        assert time.monotonic() - started <= PART_SAVE_MAX_S + ROUND_TRIP_SLACK_S, "save waited past the 5 s limit"
        assert silent.status_code == 200 and silent.json()["part"]["body"]["status"] == "not_stored"
        assert silent.json()["part"]["confirmed"] == part["confirmed"]
        assert S3().keys(f"bodies/{pid}/") == [body_key(pid, 1)]
        relay.set_mode("up")
        api_poll(lambda: remote.ok("GET", "/api/status")["storage"] == "ok", "status reports ok again")
        back = remote.ok("POST", f"/api/parts/{pid}/save", {}, status=200)["part"]
        assert back["body"]["status"] == "stored" and back["confirmed"]["build"] == back["body"]["build"]
        near(back["confirmed"]["volume_mm3"], 14400, "stored after recovery")
        assert body_key(pid, back["body"]["build"]) in S3().keys(f"bodies/{pid}/")
        same(get_assembly(api, frame["id"])["rollup"]["mass_g"], 2 * back["confirmed"]["mass_g"], "rollup follows")
    finally:
        stop_copy(copy)
        relay.close()


def test_bom_multi_level_rollup(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    a, _ = made_part(api, "bracket", 30, 20, 12)
    b, _ = made_part(api, "Arm", 160, 16, 6, ALU)
    p = create_purchased(api, "Screw", 0.75)
    top, sub, leaf = create_assembly(api, "Top"), create_assembly(api, "Sub"), create_assembly(api, "Leaf")
    place(api, leaf["id"], "purchased", p["id"], 1)
    place(api, leaf["id"], "part", a["id"], 1)
    place(api, sub["id"], "part", a["id"], 2)
    place(api, sub["id"], "part", b["id"], 1)
    place(api, sub["id"], "purchased", p["id"], 4)
    leaf_inst = place(api, sub["id"], "assembly", leaf["id"], 3)
    place(api, top["id"], "part", a["id"], 1)
    place(api, top["id"], "purchased", p["id"], 2)
    sub_inst = place(api, top["id"], "assembly", sub["id"], 2)
    ma, mb, mp = a["confirmed"]["mass_g"], b["confirmed"]["mass_g"], 0.75

    def expect(qa: int, qb: int, qp: int) -> None:
        report = bom(api, top["id"])
        lines = report["lines"]
        assert [l["item"]["name"] for l in lines] == [b["name"], a["name"], p["name"]], "sorted ignoring case"
        for line_, item, qty, unit in ((lines[0], b, qb, mb), (lines[1], a, qa, ma), (lines[2], p, qp, mp)):
            assert line_["quantity"] == qty, f"{item['name']} rolled-up quantity"
            same(line_["unit_mass_g"], unit, "unit mass")
            same(line_["line_mass_g"], qty * unit, "line mass")
        assert (lines[2]["kind"], lines[2]["material"]) == ("purchased", None)
        assert (lines[1]["kind"], lines[1]["material"]) == ("made", ACETAL)
        same(report["total_mass_g"], sum(l["line_mass_g"] for l in lines), "total")
        assert (report["part_count"], report["line_count"]) == (qa + qb + qp, 3)
        roll = get_assembly(api, top["id"])["rollup"]
        same(roll["mass_g"], report["total_mass_g"], "rollup mass")
        assert (roll["part_count"], roll["line_count"]) == (report["part_count"], 3)

    expect(11, 2, 16)
    rows = tree_rows(api, top["id"])
    sub_row = next(r for r in rows if r["component"]["id"] == sub["id"])
    sub_mass = 2 * ma + mb + 4 * mp + 3 * (mp + ma)
    same(sub_row["unit_mass_g"], sub_mass, "subassembly unit mass")
    same(sub_row["subtotal_mass_g"], 2 * sub_mass, "subassembly subtotal")
    assert sub_row["pieces"] == 2 * 13 and sub_row["body_status"] is None
    leaf_row = next(r for r in sub_row["children"] if r["component"]["id"] == leaf["id"])
    assert leaf_row["pieces"] == 3 * 2
    part_row = next(r for r in rows if r["component"]["id"] == a["id"])
    assert part_row["pieces"] == 1 and part_row["body_status"] == "stored"
    gone = api.call("DELETE", f"/api/assemblies/{sub['id']}/instances/{leaf_inst['id']}",
                    params={"base_revision": get_assembly(api, sub["id"])["revision"]})
    assert gone.status_code == 200
    expect(5, 2, 10)
    edited = api.call("PATCH", f"/api/assemblies/{top['id']}/instances/{sub_inst['id']}",
                      json_body := {"base_revision": get_assembly(api, top["id"])["revision"], "quantity": 1})
    assert edited.status_code == 200, (json_body, edited.text)
    expect(3, 1, 6)


def test_assembly_cycles_refused(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    x, y, z = create_assembly(api, "Cycle X"), create_assembly(api, "Cycle Y"), create_assembly(api, "Cycle Z")
    place(api, x["id"], "assembly", y["id"], 1)
    place(api, y["id"], "assembly", z["id"], 1)
    for target, component in ((x, x), (z, x), (z, y), (y, x)):
        before = get_assembly(api, target["id"])
        error = err(post_instance(api, target["id"], "assembly", component["id"], 1), 409, "assembly_cycle")
        assert error["message"] == f"{target['name']} cannot contain itself."
        after = get_assembly(api, target["id"])
        assert (after["revision"], after["instances"]) == (before["revision"], before["instances"])
    place(api, x["id"], "assembly", z["id"], 1)
    bare = create_part(api, "Bodiless")
    error = err(post_instance(api, x["id"], "part", bare["id"], 1), 409, "no_confirmed_body")
    assert error["message"] == f"{bare['name']} has no stored body yet, so it cannot be placed."


def test_add_instance_idempotent(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    frame = create_assembly(api, "Replay frame")
    washer = create_purchased(api, "Replay washer", 0.5)
    body = {"base_revision": frame["revision"], "component": {"type": "purchased", "id": washer["id"]}, "quantity": 2}
    path = f"/api/assemblies/{frame['id']}/instances"
    field_error(api.call("POST", path, body), "idempotency_key", F_KEY)
    for qty in (0, MAX_QTY + 1, 2.5):
        field_error(api.call("POST", path, {**body, "quantity": qty}, key=idempotency_key()), "quantity", F_QTY)
    field_error(api.call("POST", path, {**body, "component": {"type": "part", "id": "no-such-part"}},
                         key=idempotency_key()), "component", F_COMPONENT)
    key = idempotency_key()
    first = api.call("POST", path, body, key=key)
    assert first.status_code == 201, first.text
    revision = get_assembly(api, frame["id"])["revision"]
    replay = api.call("POST", path, body, key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replayed") == "true"
    assert len(get_assembly(api, frame["id"])["instances"]) == 1 and get_assembly(api, frame["id"])["revision"] == revision
    error = err(api.call("POST", path, {**body, "base_revision": revision, "quantity": 3}, key=key), 409,
                "idempotency_conflict")
    assert error["message"] == MSG_IDEM_CONFLICT
    place(api, frame["id"], "purchased", washer["id"], 1)
    assert api.call("POST", path, body, key=key).json() == first.json()
    assert len(get_assembly(api, frame["id"])["instances"]) == 2
    other = create_assembly(api, "Replay other")
    scoped = api.call("POST", f"/api/assemblies/{other['id']}/instances", {**body, "base_revision": other["revision"]},
                      key=key)
    assert scoped.status_code == 201 and len(get_assembly(api, other["id"])["instances"]) == 1
    race = create_assembly(api, "Replay race")
    race_body = {**body, "base_revision": race["revision"]}
    race_key = idempotency_key()
    results = together([lambda: api.call("POST", f"/api/assemblies/{race['id']}/instances", race_body,
                                         key=race_key, client=api.clone()) for _ in range(PARALLEL)])
    assert all(r.status_code == 201 for r in results), [r.status_code for r in results]
    assert len(get_assembly(api, race["id"])["instances"]) == 1


def test_purchased_parts_in_bill_of_materials(app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    washer = create_purchased(api, "Spring washer", 1.25)
    assert washer["declared_mass_g"] == 1.25 and washer["revision"] == 1
    assert any(p["id"] == washer["id"] for p in api.ok("GET", "/api/purchased")["purchased"])
    for mass in (0, MAX_DECLARED_G + 1, "abc", -1):
        field_error(api.call("POST", "/api/purchased", {"name": fresh("Bad mass"), "declared_mass_g": mass}),
                    "declared_mass_g", F_MASS)
    create_purchased(api, "Heavy plate", MAX_DECLARED_G)
    field_error(api.call("POST", "/api/purchased", {"name": "", "declared_mass_g": 1}), "name", F_NAME_LEN)
    field_error(api.call("POST", "/api/purchased", {"name": "n" * (NAME_MAX + 1), "declared_mass_g": 1}),
                "name", F_NAME_LEN)
    field_error(api.call("POST", "/api/purchased", {"name": "pivot BRACKET", "declared_mass_g": 1}), "name", F_NAME_USED)
    frame = create_assembly(api, "Washer frame")
    place(api, frame["id"], "purchased", washer["id"], 3)
    line_ = bom(api, frame["id"])["lines"][0]
    assert (line_["item"]["id"], line_["kind"], line_["material"], line_["quantity"]) == (washer["id"], "purchased", None, 3)
    same(line_["line_mass_g"], 3.75, "purchased line mass")
    patched = api.ok("PATCH", f"/api/purchased/{washer['id']}", {"base_revision": 1, "declared_mass_g": 2.5})["purchased"]
    assert patched["revision"] == 2
    same(bom(api, frame["id"])["total_mass_g"], 7.5, "BOM follows declared mass")
    row = tree_rows(api, frame["id"])[0]
    assert (row["pieces"], row["body_status"]) == (3, None)
    same(row["subtotal_mass_g"], 7.5, "tree subtotal")


def test_stale_revisions_refused(app_url: str) -> None:
    founder, teo = Api(app_url, FOUNDER), Api(app_url, ENGINEER)
    part = create_part(founder, "Stale bracket")
    sid, _ = rect_sketch(founder, part["id"], 30, 20, distances=1)
    sketch = get_sketch(founder, sid)
    base = sketch["revision"]
    dist = constraint_labelled(sketch, "Distance 1")
    path = f"/api/sketches/{sid}/constraints/{dist['id']}"
    assert teo.call("PATCH", path, {"base_revision": base, "value": 25}).status_code == 200
    error = err(founder.call("PATCH", path, {"base_revision": base, "value": 30}), 412, "stale_revision")
    assert error["message"] == (f"{ENGINEER_NAME} saved {sketch['name']} on {part['name']} at revision {base + 1} "
                                "after you opened it. Reload to see their changes.")
    assert error["current_revision"] == base + 1
    assert error["saved_by"] == {"id": teo.member["id"], "name": ENGINEER_NAME}
    err(founder.call("PATCH", path, {"base_revision": base, "value": "abc"}), 412, "stale_revision")
    err(founder.call("DELETE", path, params={"base_revision": base}), 412, "stale_revision")
    field_error(founder.call("PATCH", path, {"value": 30}), "base_revision", F_BASE)
    now = get_sketch(founder, sid)
    assert now["revision"] == base + 1 and constraint_labelled(now, "Distance 1")["value_mm"] == 25
    current = get_part(founder, part["id"])
    new_name = fresh("Stale renamed")
    founder.ok("PATCH", f"/api/parts/{part['id']}", {"base_revision": current["revision"], "name": new_name})
    error = err(founder.call("PATCH", f"/api/parts/{part['id']}", {"base_revision": current["revision"], "name": "x"}),
                412, "stale_revision")
    assert error["message"] == (f"{FOUNDER_NAME} saved {new_name} at revision {current['revision'] + 1} "
                                "after you opened it. Reload to see their changes.")
    washer = create_purchased(founder, "Stale washer", 0.5)
    frame = create_assembly(founder, "Stale frame")
    results = together([lambda: post_instance(founder, frame["id"], "purchased", washer["id"], 1, base=frame["revision"],
                                              client=founder.clone()) for _ in range(PARALLEL)])
    codes = sorted(r.status_code for r in results)
    assert codes == [201] + [412] * (PARALLEL - 1), codes
    assert len(get_assembly(founder, frame["id"])["instances"]) == 1
    free = create_sketch(founder, part["id"])["id"]
    sbase = get_sketch(founder, free)["revision"]
    results = together([lambda i=i: founder.call("POST", f"/api/sketches/{free}/entities",
                                                 {"base_revision": sbase, "entity": line(0, i, 10, i)},
                                                 client=founder.clone()) for i in range(PARALLEL)])
    assert sorted(r.status_code for r in results) == [201] + [412] * (PARALLEL - 1)
    assert len(get_sketch(founder, free)["entities"]) == 1


def test_engineer_refused_founder_actions(app_url: str) -> None:
    founder, teo = Api(app_url, FOUNDER), Api(app_url, ENGINEER)
    part, driving = made_part(founder, "Scope bracket", 30, 20, 12)
    pid = part["id"]
    free = create_sketch(founder, pid)["id"]
    seg = add_entity(teo, free, line(0, 0, 10, 0))
    con = constrain(teo, free, "horizontal", [seg["id"]])["constraint"]
    assert delete_constraint(teo, free, con["id"]).status_code == 200
    gone = teo.call("DELETE", f"/api/sketches/{free}/entities/{seg['id']}",
                    params={"base_revision": get_sketch(teo, free)["revision"]})
    assert gone.status_code == 200
    dim = constraint_labelled(get_sketch(teo, driving), "Distance 1")
    assert patch_constraint(teo, driving, dim["id"], value=32).status_code == 200
    saved = teo.ok("POST", f"/api/parts/{pid}/save", {}, status=200)["part"]
    assert saved["body"]["status"] == "stored"
    try:
        assert teo.call("PATCH", "/api/me", {"precision": 2}).status_code == 200
    finally:
        prefs(teo, "in", 3)
    frame = create_assembly(founder, "Scope frame")
    washer = create_purchased(founder, "Scope washer", 0.5)
    inst = place(founder, frame["id"], "purchased", washer["id"], 1)
    current = get_part(founder, pid)
    fid = current["features"][0]["id"]
    rev, arev = current["revision"], get_assembly(founder, frame["id"])["revision"]
    alu = material_ids(founder)[ALU]
    refused = [
        ("POST", "/api/parts", {"name": fresh("Engineer part"), "material_id": alu}, None),
        ("POST", f"/api/parts/{pid}/sketches", {"base_revision": rev, "plane": "top", "offset": 0}, None),
        ("POST", f"/api/parts/{pid}/features", {"base_revision": rev, "sketch_id": driving, "operation": "join",
                                                "depth": 5, "direction": "normal"}, idempotency_key()),
        ("PATCH", f"/api/parts/{pid}/features/{fid}", {"base_revision": rev, "depth": 30}, None),
        ("PATCH", f"/api/parts/{pid}", {"base_revision": rev, "name": fresh("Engineer name")}, None),
        ("PATCH", f"/api/parts/{pid}", {"base_revision": rev, "material_id": alu}, None),
        ("PATCH", f"/api/parts/{pid}", {"base_revision": rev - 1, "name": ""}, None),
        ("POST", "/api/assemblies", {"name": fresh("Engineer assembly")}, None),
        ("POST", f"/api/assemblies/{frame['id']}/instances",
         {"base_revision": arev, "component": {"type": "purchased", "id": washer["id"]}, "quantity": 1}, idempotency_key()),
        ("PATCH", f"/api/assemblies/{frame['id']}/instances/{inst['id']}", {"base_revision": arev, "quantity": 5}, None),
        ("POST", "/api/purchased", {"name": fresh("Engineer washer"), "declared_mass_g": 1}, None),
        ("PATCH", f"/api/purchased/{washer['id']}", {"base_revision": 1, "declared_mass_g": 9}, None),
    ]
    for method, path, body, key in refused:
        assert err(teo.call(method, path, body, key=key), 403, "forbidden")["message"] == MSG_FORBIDDEN, path
    assert err(teo.call("DELETE", f"/api/assemblies/{frame['id']}/instances/{inst['id']}",
                        params={"base_revision": arev}), 403, "forbidden")["message"] == MSG_FORBIDDEN
    err(teo.call("PATCH", "/api/parts/no-such-part", {"base_revision": 1, "name": "x"}), 404, "not_found")
    after = get_part(founder, pid)
    assert (after["revision"], after["name"], after["material"]["name"], after["features"]) == (
        rev, current["name"], ACETAL, current["features"])
    assert get_assembly(founder, frame["id"])["instances"] == get_assembly(founder, frame["id"])["instances"]
    assert get_assembly(founder, frame["id"])["revision"] == arev
    assert purchased_named(founder, washer["name"])["declared_mass_g"] == 0.5


def test_dialog_focus_trap_and_shortcuts(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Shortcut probe")
    sid = create_sketch(api, part["id"])["id"]
    add_entity(api, sid, line(0, 0, 20, 0))
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    opener = page.get_by_role("button", name="New part")
    click(opener)
    dialog = await_visible(page, page.get_by_role("dialog", name="New part"), "dialog 'New part'")
    name_box = dialog.get_by_role("textbox", name="Name")
    poll(page, lambda: is_focused(name_box), "New part opens with Name focused (L250)")
    wrapped = False
    for _ in range(MAX_TABS // 4):
        page.keyboard.press("Tab")
        assert is_focused(dialog), "Tab left the open dialog (L251)"
        if is_focused(name_box):
            wrapped = True
            break
    assert wrapped, "Tab never wrapped back to Name"
    page.keyboard.press("Shift+Tab")
    assert is_focused(dialog) and not is_focused(name_box), "Shift+Tab from the first field must wrap to the last"
    page.keyboard.press("Escape")
    await_gone(page, page.get_by_role("dialog", name="New part"), "New part dialog after Escape")
    poll(page, lambda: is_focused(opener), "focus returns to New part (L252)")
    open_sketch(page, part["name"])
    select_tool = page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Select")
    select_tool.focus()
    page.keyboard.press("l")
    line_tool = page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Line")
    poll(page, lambda: line_tool.get_attribute("aria-pressed") == "true", "L with focus on a toolbar button picks Line")
    start_x = await_visible(page, page.get_by_role("group", name="Line").get_by_role("textbox", name="Start X"), "Start X")
    start_x.focus()
    page.keyboard.press("o")
    circle_tool = page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Circle")
    assert circle_tool.get_attribute("aria-pressed") != "true", "O inside a text field must not switch tools (L210)"
    page.set_viewport_size(PHONE)
    page.reload()
    sheet_button = await_visible(page, page.get_by_role("button", name="Feature tree"), "Feature tree button")
    click(sheet_button)
    sheet = await_visible(page, page.get_by_role("dialog", name="Feature tree"), "Feature tree sheet")
    for _ in range(MAX_TABS // 4):
        page.keyboard.press("Tab")
        assert is_focused(sheet), "Tab left the Feature tree sheet"
    page.keyboard.press("Shift+Tab")
    assert is_focused(sheet)
    page.keyboard.press("Escape")
    await_gone(page, page.get_by_role("dialog", name="Feature tree"), "sheet after Escape")
    poll(page, lambda: is_focused(page.get_by_role("button", name="Feature tree")), "focus returns to Feature tree")


def test_feedback_copy_live_regions(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    frame = create_assembly(api, "Feedback frame")
    washer = create_purchased(api, "Feedback washer", 0.5)
    bare = create_part(api, "Feedback bare")
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_assembly(page, frame["name"])
    click(page.get_by_role("button", name="Add to assembly"))
    dialog = await_visible(page, page.get_by_role("dialog", name="Add to assembly"), "Add to assembly dialog")
    select(dialog.get_by_role("combobox", name="Component"), washer["name"])
    fill(dialog.get_by_role("spinbutton", name="Quantity"), "2")
    with held(page, "**/api/assemblies/*/instances") as gate:
        click(dialog.get_by_role("button", name="Add"))
        adding = await_visible(page, dialog.get_by_role("button", name="Adding…"), "Add reads Adding…")
        assert adding.is_disabled()
        gate.release()
    await_gone(page, page.get_by_role("dialog", name="Add to assembly"), "dialog closes on success")
    await_exact(page, model_message(page), f"{washer['name']} ×2 added to {frame['name']}.")
    click(page.get_by_role("button", name="Add to assembly"))
    dialog = await_visible(page, page.get_by_role("dialog", name="Add to assembly"), "dialog again")
    select(dialog.get_by_role("combobox", name="Component"), bare["name"])
    click(dialog.get_by_role("button", name="Add"))
    await_text(page, dialog, f"{bare['name']} has no stored body yet, so it cannot be placed.")
    click(dialog.get_by_role("button", name="Cancel"))
    assert len(get_assembly(api, frame["id"])["instances"]) == 1
    open_part(page, bare["name"])
    page.route("**/api/parts/*/save", lambda route: route.abort())
    try:
        click(page.get_by_role("button", name="Save part"))
        await_exact(page, model_message(page), NO_ANSWER_COPY)
        poll(page, lambda: text_of(save_status(page)) != "Saving…", "pending state ends after no answer")
    finally:
        page.unroute("**/api/parts/*/save")


def test_reduced_motion_substitutes(browser: Browser, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Calm probe")
    sid = create_sketch(api, part["id"])["id"]
    add_entity(api, sid, line(0, 0, 20, 0))
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        ui_sign_in(page, app_url, FOUNDER)
        open_sketch(page, part["name"])
        await_exact(page, slack_readout(page), "Slack 4")
        kb_select(page, "Line 1 start")
        ring = ring_of(page, "Line 1 start")
        with page.expect_response(lambda r: "/constraints" in r.url and r.request.method == "POST",
                                  timeout=HTTP_TIMEOUT_S * 1000):
            click(constrain_button(page, "Fix"))
        samples = timeline(page, lambda: (ring.count(), text_of(slack_readout(page))), 600)
        assert all(text != label("Slack", 3) for _, (_, text) in samples), "readout counted under reduced motion"
        first = next(((n, text) for _, (n, text) in samples if text != "Slack 4"), None)
        assert first == (0, "Slack 2"), f"ring and readout did not jump together: {first}"
        kb_select(page, "Line 1")
        page.keyboard.press("h")
        horizontal = await_visible(page, glyph(page, "Horizontal 1"), "glyph Horizontal 1")
        settle(sketch_canvas(page))
        rest = decode(capture(horizontal))
        page.keyboard.press("v")
        await_exact(page, model_message(page), "Vertical 1 would conflict with Horizontal 1. Nothing was changed.")
        outlined = decode(capture(horizontal))
        advance(page, 1000)
        later = decode(capture(horizontal))
        assert difference(rest, outlined) > 0, "no conflict outline on the named glyph"
        assert difference(outlined, later) < difference(rest, outlined), "outline was not steady"
        assert glyph(page, "Vertical 1").count() > 0, "ghost glyph left before the next sketch action"
        focus_canvas(page)
        page.keyboard.press("Escape")
        poll(page, lambda: glyph(page, "Vertical 1").count() == 0, "next canvas key clears the ghost (L317)")
        click(page.get_by_role("button", name="Close sketch"))
        click(page.get_by_role("button", name="New sketch"))
        dialog = await_visible(page, page.get_by_role("dialog", name="New sketch"), "New sketch dialog")
        start = dialog.bounding_box()
        settle(dialog)
        end = dialog.bounding_box()
        assert start and end and all(abs(start[k] - end[k]) <= PX_ROUNDING for k in ("x", "y", "width", "height")), (
            f"dialog moved or scaled under reduced motion: {start} -> {end}")


@pytest.mark.timeout(900)
def test_health_and_manifest(app_url: str) -> None:
    ready = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert ready.status_code == 200 and ready.json() == {"status": "ok"}
    run = manifest()
    assert all(isinstance(run[k], str) and run[k] for k in ("install", "build", "serve"))
    parsed = urlsplit(os.environ["DATABASE_URL"])
    userinfo = parsed.netloc.rsplit("@", 1)[0] + "@" if "@" in parsed.netloc else ""
    dead = urlunsplit(parsed._replace(netloc=f"{userinfo}127.0.0.1:{free_port()}"))
    copy = start_copy({"DATABASE_URL": dead})
    try:
        starting = wait_health(copy, 503)
        assert starting.json() == {"status": "starting"}
        again = httpx.get(f"{copy.url}/api/health", timeout=HTTP_TIMEOUT_S)
        assert again.status_code == 503, "health turned ok without a database"
    finally:
        stop_copy(copy)


def test_server_boundary(app_url: str) -> None:
    host = urlsplit(app_url).netloc
    foreign = {"Origin": "http://elsewhere.example"}
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S) as http:
        body = {"email": FOUNDER[0], "password": FOUNDER[1]}
        refused = http.post("/api/session", json=body, headers=foreign)
        assert err(refused, 403, "cross_origin")["message"] == CROSS_ORIGIN_MSG
        assert "kerfline_session" not in http.cookies
        assert http.post("/api/session", json=body, headers={"Origin": f"http://{host}"}).status_code == 200
        name = fresh("Foreign washer")
        err(http.post("/api/purchased", json={"name": name, "declared_mass_g": 1}, headers=foreign), 403, "cross_origin")
        assert all(p["name"] != name for p in http.get("/api/purchased").json()["purchased"])
        read = http.get("/api/me", headers=foreign)
        assert read.status_code == 200
        plain = http.post("/api/purchased", content=b"name=x", headers={"Content-Type": "text/plain"})
        assert err(plain, 415, "unsupported_media_type")["message"] == UNSUPPORTED_MSG
        payload = json.dumps({"precision": http.get("/api/me").json()["member"]["precision"]}).encode()
        exact = payload + b" " * (BODY_LIMIT_BYTES - len(payload))
        fits = http.patch("/api/me", content=exact, headers={"Content-Type": "application/json"})
        assert fits.status_code == 200, f"exactly 1,000,000 bytes must be allowed: {fits.status_code}"
        over = http.patch("/api/me", content=exact + b" ", headers={"Content-Type": "application/json"})
        assert err(over, 413, "payload_too_large")["message"] == TOO_LARGE_MSG
        assert err(http.get(UNKNOWN_API_PATH), 404, "not_found")["message"] == MSG_NOT_FOUND
        for path in ("/package.json", "/package-lock.json", "/run.json", "/.env"):
            assert http.get(path).status_code == 404, path
        html = http.get("/").text
        for src in re.findall(r'<script[^>]+src="([^"]+)"', html):
            full = urljoin(f"{app_url}/", src)
            if same_origin(full, app_url):
                asset = urlsplit(full).path
                assert http.get(asset).status_code == 200
                assert http.get(asset + ".map").status_code == 404, f"source map served for {asset}"
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S) as anon:
        err(anon.post("/api/parts", content=b"x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    outage = httpx.get(f"{os.environ['APP_MINIO_DOWN_URL']}/api/health", timeout=HTTP_TIMEOUT_S)
    assert outage.status_code == 200 and outage.json() == {"status": "ok"}, "server must start without storage"


@pytest.mark.timeout(1200)
def test_two_processes_boot_without_reseeding(app_url: str) -> None:
    api = Api(app_url, FOUNDER)

    def snapshot(client: Api) -> dict:
        parts = client.ok("GET", "/api/parts")["parts"]
        assemblies = client.ok("GET", "/api/assemblies")["assemblies"]
        purchased = client.ok("GET", "/api/purchased")["purchased"]
        return {"parts": [(n, named(parts, n)["revision"]) for n in SEED_PART_NAMES],
                "assemblies": [(n, named(assemblies, n)["revision"]) for n in SEED_ASSEMBLY_NAMES],
                "purchased": [(n, named(purchased, n)["revision"]) for n in SEED_PURCHASED_NAMES],
                "members": sorted(m["name"] for m in client.ok("GET", "/api/workspace")["members"]),
                "materials": [m["name"] for m in client.ok("GET", "/api/materials")["materials"]]}

    before = snapshot(api)
    copies = [start_copy({}), start_copy({})]
    try:
        for copy in copies:
            wait_health(copy)
        for copy in copies:
            assert snapshot(Api(copy.url, FOUNDER)) == before
    finally:
        for copy in copies:
            stop_copy(copy)


def assert_lamp_view(page: Page, api: Api) -> None:
    lamp = assembly_named(api, LAMP)
    rollup = lamp["rollup"]
    near(rollup["mass_g"], SEED_LAMP_TOTAL[0], "seed lamp total")
    assert (rollup["part_count"], rollup["line_count"]) == SEED_LAMP_TOTAL[1:]
    totals = page.get_by_role("region", name="Assembly totals")
    await_text(page, totals, f"Total mass {grams(rollup['mass_g'])}")
    await_text(page, totals, f"Pieces {rollup['part_count']}")
    await_text(page, totals, f"Lines {rollup['line_count']}")


def test_wf_first_run_open_lamp(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    await_visible(page, page.get_by_role("img", name=f"Assembly view: {LAMP}", exact=True), "lamp Assembly view")
    tab = page.get_by_role("tablist", name="Assembly view").get_by_role("tab", name="Model")
    assert tab.get_attribute("aria-selected") == "true"
    table = page.get_by_role("table", name="Assembly tree")
    for name in ("Base Plate", "Pivot Bracket", M4, ARM):
        await_visible(page, table.get_by_role("row", name=re.compile(re.escape(name))), f"row {name}")
    expand = table.get_by_role("button", name=f"Expand {ARM}")
    assert expand.get_attribute("aria-expanded") not in (None, "true"), "Arm Assembly starts collapsed (L246)"
    assert all(not r.is_visible() for r in table.get_by_role("row", name=re.compile(HEAD)).all())
    arm_row = next(r for r in tree_rows(api, assembly_named(api, LAMP)["id"]) if r["component"]["name"] == ARM)
    await_text(page, table.get_by_role("row", name=re.compile(re.escape(ARM))), grams(arm_row["unit_mass_g"]))
    assert_lamp_view(page, api)
    for name in SEED_ASSEMBLY_NAMES + SEED_PART_NAMES + SEED_PURCHASED_NAMES:
        await_visible(page, tree_item(page, name), f"feature tree lists {name}")


def test_wf_first_run_wrong_password(page: Page, app_url: str) -> None:
    page.set_viewport_size(DESKTOP)
    page.goto(app_url)
    form = await_visible(page, page.get_by_role("form", name="Sign in"), "form 'Sign in'")
    fill(form.get_by_role("textbox", name="Email"), FOUNDER[0])
    fill(form.get_by_label("Password", exact=True), "not-the-password")
    with held(page, "**/api/session") as gate:
        click(form.get_by_role("button", name="Sign in"))
        pending = await_visible(page, form.get_by_role("button", name="Signing in…"), "Signing in…")
        assert pending.is_disabled()
        gate.release()
    await_text(page, form.get_by_role("alert"), MSG_BAD_CREDS)
    assert page.get_by_role("button", name="Sign out").count() == 0
    fill(form.get_by_label("Password", exact=True), FOUNDER[1])
    click(form.get_by_role("button", name="Sign in"))
    await_visible(page, page.get_by_role("img", name=f"Assembly view: {LAMP}", exact=True), "lamp after retry")
    assert_lamp_view(page, Api(app_url, FOUNDER))


def test_wf_first_run_phone(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    page.set_viewport_size(PHONE)
    ui_sign_in(page, app_url, FOUNDER)
    layout(page)
    assert page.get_by_role("complementary", name="Properties").count() == 0 or not page.get_by_role(
        "complementary", name="Properties").first.is_visible()
    opener = await_visible(page, page.get_by_role("button", name="Properties"), "Properties button")
    click(opener)
    sheet = await_visible(page, page.get_by_role("dialog", name="Properties"), "Properties sheet")
    assert_lamp_view(page, api)
    click(sheet.get_by_role("button", name="Close"))
    poll(page, lambda: is_focused(page.get_by_role("button", name="Properties")), "focus back on Properties")


def test_wf_sketch_constrain_fully_held(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part = create_part(api, "Switch cover", PETG)
    sid, _ = rect_sketch(api, part["id"], 24, 16, distances=0)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    await_exact(page, slack_readout(page), "Slack 2")
    revision = get_sketch(api, sid)["revision"]
    kb_select(page, "Line 1")
    page.keyboard.press("d")
    field = await_visible(page, dimension_field(page), "Dimension value")
    poll(page, lambda: is_focused(field) and field.input_value(), "Dimension value opens prefilled and focused (L230)")
    fill(field, "24")
    field.press("Enter")
    await_sketch_revision(page, api, sid, revision + 1)
    await_exact(page, slack_readout(page), "Slack 1")
    await_exact(page, model_message(page), "Distance 1 added. Slack 1.")
    poll(page, lambda: is_focused(sketch_canvas(page)) and is_pressed(canvas_item(page, "Line 1")),
         "focus returns to the canvas with the same selection (L232)")
    kb_select(page, "Line 2")
    page.keyboard.press("d")
    apply_dimension(page, "0.63 in")
    await_sketch_revision(page, api, sid, revision + 2)
    await_exact(page, slack_readout(page), "Fully held")
    await_exact(page, model_message(page), "Distance 2 added. Fully held.")
    poll(page, lambda: sketch_canvas(page).get_by_role("img", name=re.compile("^Slack ring at ")).count() == 0,
         "no rings at Fully held")
    sketch = get_sketch(api, sid)
    assert sketch["slack"] == 0 and sketch["fully_held"] is True
    same(constraint_labelled(sketch, "Distance 2")["value_mm"], 0.63 * INCH_MM, "0.63 in stored")


def test_wf_sketch_constrain_redundant(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Redundant cover", PETG)
    sid, _ = rect_sketch(api, part["id"], 24, 16, distances=0)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    await_exact(page, slack_readout(page), "Slack 2")
    revision = get_sketch(api, sid)["revision"]
    kb_select(page, "Line 1", "Line 3")
    page.keyboard.press("p")
    await_sketch_revision(page, api, sid, revision + 1)
    await_exact(page, model_message(page), "Parallel 1 added and marked redundant.")
    await_text(page, constraint_item(page, "Parallel 1"), "redundant")
    await_exact(page, slack_readout(page), "Slack 2")
    assert constraint_labelled(get_sketch(api, sid), "Parallel 1")["redundant"] is True


def test_wf_over_constraint_resolve(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Conflict cover", PETG)
    sid, _ = rect_sketch(api, part["id"], 24, 16, distances=0)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    revision = get_sketch(api, sid)["revision"]
    kb_select(page, "Line 1")
    page.keyboard.press("d")
    apply_dimension(page, "24")
    await_sketch_revision(page, api, sid, revision + 1)
    await_exact(page, slack_readout(page), "Slack 1")
    back_to_canvas(page)
    kb_select(page, "Line 1")
    page.keyboard.press("d")
    apply_dimension(page, "30")
    await_exact(page, model_message(page), "Distance 2 would conflict with Distance 1. Nothing was changed.")
    assert get_sketch(api, sid)["revision"] == revision + 1
    await_exact(page, slack_readout(page), "Slack 1")
    back_to_canvas(page)
    click(page.get_by_role("button", name=f"Delete {DISTANCE_1}"))
    await_sketch_revision(page, api, sid, revision + 2)
    await_exact(page, slack_readout(page), "Slack 2")
    kb_select(page, "Line 1")
    page.keyboard.press("d")
    apply_dimension(page, "30")
    await_sketch_revision(page, api, sid, revision + 3)
    await_exact(page, slack_readout(page), "Slack 1")
    dims = [c for c in get_sketch(api, sid)["constraints"] if c["kind"] == "distance"]
    assert [(c["label"], c["value_mm"]) for c in dims] == [("Distance 2", 30)]


def test_wf_over_constraint_horizontal_vertical(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Upright cover", PETG)
    sid, _ = rect_sketch(api, part["id"], 24, 16)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    revision = get_sketch(api, sid)["revision"]
    kb_select(page, "Line 1")
    page.keyboard.press("v")
    await_exact(page, model_message(page), "Vertical 3 would conflict with Horizontal 1. Nothing was changed.")
    await_exact(page, slack_readout(page), "Fully held")
    assert get_sketch(api, sid)["revision"] == revision


def test_wf_units_inches_round_trip(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part = create_part(api, "Inch cover", PETG)
    sid, _ = rect_sketch(api, part["id"], 24, 16, distances=1)
    try:
        page.set_viewport_size(DESKTOP)
        ui_sign_in(page, app_url, FOUNDER)
        open_sketch(page, part["name"])
        await_text(page, constraint_item(page, "Distance 1"), "24.00 mm")
        check(page.get_by_role("radiogroup", name="Units").get_by_role("radio", name="in", exact=True))
        decimals = page.get_by_role("spinbutton", name="Decimals")
        fill(decimals, "3")
        decimals.press("Tab")
        poll(page, lambda: (lambda m: (m["units"], m["precision"]) == ("in", 3))(api.ok("GET", "/api/me")["member"]),
             "units and decimals saved")
        await_text(page, constraint_item(page, "Distance 1"), "0.945 in")
        revision = get_sketch(api, sid)["revision"]
        kb_select(page, "Line 2")
        page.keyboard.press("d")
        apply_dimension(page, "0.63", "±0.002")
        sketch = await_sketch_revision(page, api, sid, revision + 1)
        added = constraint_labelled(sketch, "Distance 2")
        same(added["value_mm"], 0.63 * INCH_MM, "0.63 in display unit")
        same(added["tolerance"]["plus_mm"], 0.002 * INCH_MM, "tolerance in mm")
        await_text(page, constraint_item(page, "Distance 2"), "0.630 ± 0.002 in")
        check(page.get_by_role("radiogroup", name="Units").get_by_role("radio", name="mm", exact=True))
        fill(decimals, "2")
        decimals.press("Tab")
        await_text(page, constraint_item(page, "Distance 1"), "24.00 mm")
        await_text(page, constraint_item(page, "Distance 2"), "16.00 ± 0.05 mm")
        final = get_sketch(api, sid)
        same(constraint_labelled(final, "Distance 1")["value_mm"], 24, "Distance 1 unchanged")
        assert final["revision"] == revision + 1
    finally:
        prefs(api, "mm", 2)


def test_wf_units_bad_input(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Bad unit cover", PETG)
    sid, _ = rect_sketch(api, part["id"], 24, 16, distances=1)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    revision = get_sketch(api, sid)["revision"]
    kb_select(page, "Line 2")
    page.keyboard.press("d")
    apply_dimension(page, "12 cm")
    field = dimension_field(page)
    poll(page, lambda: field.get_attribute("aria-invalid") == "true", "Dimension value marked invalid")
    await_text(page, page.get_by_role("complementary", name="Properties"), F_GRAMMAR)
    assert get_sketch(api, sid)["revision"] == revision
    fill(field, "12")
    field.press("Enter")
    assert constraint_labelled(await_sketch_revision(page, api, sid, revision + 1), "Distance 2")["value_mm"] == 12


def test_wf_units_preference_saved(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part = create_part(api, "Pref cover", PETG)
    rect_sketch(api, part["id"], 24, 16, distances=1)
    try:
        page.set_viewport_size(DESKTOP)
        ui_sign_in(page, app_url, FOUNDER)
        open_sketch(page, part["name"])
        check(page.get_by_role("radiogroup", name="Units").get_by_role("radio", name="in", exact=True))
        await_text(page, constraint_item(page, "Distance 1"), "0.94 in")
        poll(page, lambda: api.ok("GET", "/api/me")["member"]["units"] == "in", "preference saved")
        page.reload()
        open_sketch(page, part["name"])
        await_text(page, constraint_item(page, "Distance 1"), "0.94 in")
    finally:
        prefs(api, "mm", 2)


def test_wf_extrude_keyboard(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part = create_part(api, "Keyboard cover", PETG)
    rect_sketch(api, part["id"], 24, 16)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    focus_canvas(page)
    page.keyboard.press("x")
    form = await_visible(page, page.get_by_role("form", name="Extrude"), "form 'Extrude'")
    depth = form.get_by_role("textbox", name="Depth")
    poll(page, lambda: is_focused(depth), "Depth focused (L236)")
    assert form.get_by_role("radiogroup", name="Operation").get_by_role("radio", name="New body").is_checked()
    assert form.get_by_role("radiogroup", name="Direction").get_by_role("radio", name="Normal").is_checked()
    page.keyboard.press("ControlOrMeta+A")
    page.keyboard.type("5")
    with held(page, "**/api/parts/*/features") as gate:
        page.keyboard.press("Enter")
        await_exact(page, save_status(page), "Saving…")
        assert form.get_by_role("button", name="Extruding…").is_disabled()
        gate.release()
    await_exact(page, save_status(page), "Stored")
    await_exact(page, model_message(page), "Extrude 1 added.")
    stored = get_part(api, part["id"])
    assert stored["body"]["status"] == "stored" and len(stored["features"]) == 1
    near(stored["confirmed"]["volume_mm3"], 1920, "24 × 16 × 5")
    assert body_key(part["id"], stored["confirmed"]["build"]) in S3().keys(f"bodies/{part['id']}/")
    close = page.get_by_role("button", name="Close sketch")
    if close.count() and close.first.is_visible():
        close.first.focus()
        page.keyboard.press("Enter")
    await_text(page, measurements(page), "Confirmed")
    await_text(page, measurements(page), mm3(stored["confirmed"]["volume_mm3"]))
    await_text(page, measurements(page), grams(stored["confirmed"]["mass_g"]))
    await_text(page, tree_item(page, part["name"]), "Stored")


def test_wf_extrude_double_confirm(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Double cover", PETG)
    rect_sketch(api, part["id"], 24, 16)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    click(page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Extrude"))
    form = await_visible(page, page.get_by_role("form", name="Extrude"), "form 'Extrude'")
    fill(form.get_by_role("textbox", name="Depth"), "5")
    confirm = form.get_by_role("button", name="Confirm extrude")
    with held(page, "**/api/parts/*/features") as gate:
        click(confirm)
        pending = await_visible(page, form.get_by_role("button", name="Extruding…"), "Extruding…")
        assert pending.is_disabled()
        pending.click(force=True)
        gate.release()
    await_exact(page, save_status(page), "Stored")
    assert len(get_part(api, part["id"])["features"]) == 1


def test_wf_extrude_escape_cancels(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part = create_part(api, "Cancel cover", PETG)
    rect_sketch(api, part["id"], 24, 16)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    focus_canvas(page)
    page.keyboard.press("x")
    form = await_visible(page, page.get_by_role("form", name="Extrude"), "form 'Extrude'")
    form.get_by_role("textbox", name="Depth").press("Escape")
    await_gone(page, page.get_by_role("form", name="Extrude"), "Extrude form")
    poll(page, lambda: is_focused(sketch_canvas(page)), "focus returns to the canvas (L238)")
    assert get_part(api, part["id"])["features"] == []


def test_wf_booleans_cut_hole(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part, _ = made_part(api, "Hole cover", 30, 20, 12)
    pid = part["id"]
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_part(page, part["name"])
    click(page.get_by_role("button", name="New sketch"))
    dialog = await_visible(page, page.get_by_role("dialog", name="New sketch"), "New sketch dialog")
    check(dialog.get_by_role("radiogroup", name="Plane").get_by_role("radio", name="Top"))
    fill(dialog.get_by_role("textbox", name="Offset"), "0")
    click(dialog.get_by_role("button", name="Create sketch"))
    poll(page, lambda: len(get_part(api, pid)["sketches"]) == 2, "Sketch 2 created")
    sid = next(s["id"] for s in get_part(api, pid)["sketches"] if s["name"] == "Sketch 2")
    if not (sketch_canvas(page).count() and sketch_canvas(page).first.is_visible()):
        open_sketch(page, part["name"], "Sketch 2")
    click(page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Circle"))
    group = await_visible(page, page.get_by_role("group", name="Circle"), "Circle fields")
    for label, value in (("Centre X", "15"), ("Centre Y", "10"), ("Diameter", "10")):
        fill(group.get_by_role("textbox", name=label), value)
    click(group.get_by_role("button", name="Place circle"))
    poll(page, lambda: len(get_sketch(api, sid)["entities"]) == 1, "circle placed")
    for kind, value, selection in (("Horizontal distance", "15", ("Origin", "Circle 1 centre")),
                                   ("Vertical distance", "10", ("Origin", "Circle 1 centre")),
                                   ("Dimension", "10", ("Circle 1",))):
        count = len(get_sketch(api, sid)["constraints"])
        kb_select(page, *selection)
        click(constrain_button(page, kind))
        if quick(page, lambda: dimension_field(page).count() > 0 and dimension_field(page).first.is_visible()):
            apply_dimension(page, value)
        poll(page, lambda: len(get_sketch(api, sid)["constraints"]) == count + 1, f"{kind} accepted")
    await_exact(page, slack_readout(page), "Fully held")
    click(page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Extrude"))
    form = await_visible(page, page.get_by_role("form", name="Extrude"), "form 'Extrude'")
    check(form.get_by_role("radiogroup", name="Operation").get_by_role("radio", name="Cut"))
    check(form.get_by_role("radiogroup", name="Direction").get_by_role("radio", name="Symmetric"))
    fill(form.get_by_role("textbox", name="Depth"), "40")
    with held(page, "**/api/parts/*/features") as gate:
        click(form.get_by_role("button", name="Confirm extrude"))
        await_visible(page, form.get_by_role("button", name="Extruding…"), "Extruding…").click(force=True)
        gate.release()
    await_exact(page, save_status(page), "Stored")
    assert [f["operation"] for f in get_part(api, pid)["features"]] == ["new", "cut"]
    close = page.get_by_role("button", name="Close sketch")
    if close.count() and close.first.is_visible():
        click(close.first)
    await_visible(page, measurements(page), "part mode after the cut")
    select(page.get_by_role("combobox", name="Material"), material_option(ALU))
    poll(page, lambda: get_part(api, pid)["material"]["name"] == ALU and get_part(api, pid)["body"]["status"] == "stored",
         "material saved and stored")
    final = get_part(api, pid)
    volume = 7200 - 300 * math.pi
    near(final["confirmed"]["volume_mm3"], volume, "cut volume")
    near(final["confirmed"]["mass_g"], volume * DENSITY[ALU] / 1000, "aluminium mass")
    await_exact(page, save_status(page), "Stored")
    await_text(page, measurements(page), mm3(final["confirmed"]["volume_mm3"]))
    await_text(page, measurements(page), grams(final["confirmed"]["mass_g"]))
    near(mesh_figures(body_object(pid, final["confirmed"]["build"]))["volume"], volume, "stored mesh volume")


def test_wf_booleans_intersect_refused(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part, _ = made_part(api, "Intersect cover", 30, 20, 12)
    rect_sketch(api, part["id"], 10, 10, x0=50, y0=5)
    keys = S3().keys(f"bodies/{part['id']}/")
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"], "Sketch 2")
    click(page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Extrude"))
    form = await_visible(page, page.get_by_role("form", name="Extrude"), "form 'Extrude'")
    check(form.get_by_role("radiogroup", name="Operation").get_by_role("radio", name="Intersect"))
    fill(form.get_by_role("textbox", name="Depth"), "12")
    click(form.get_by_role("button", name="Confirm extrude"))
    await_exact(page, model_message(page), "Intersect leaves no material. Nothing was changed.")
    assert len(get_part(api, part["id"])["features"]) == 1 and S3().keys(f"bodies/{part['id']}/") == keys


def test_wf_part_storage_depth_change(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part, _ = made_part(api, "Depth bracket", 30, 20, 12)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_part(page, part["name"])
    view = page.get_by_role("img", name=f"Part view: {part['name']}", exact=True)
    await_visible(page, view, "Part view")
    before = decode(capture(view))
    open_child(page, part["name"], "Extrude 1")
    form = await_visible(page, page.get_by_role("form", name=f"Edit {EXTRUDE_1}"), "edit form")
    depth = form.get_by_role("textbox", name="Depth")
    fill(depth, "24")
    with held(page, "**/api/parts/*/features/*") as gate:
        depth.press("Enter")
        await_exact(page, save_status(page), "Saving…")
        await_text(page, tree_item(page, part["name"]), "Saving…")
        gate.release()
    await_exact(page, save_status(page), "Stored")
    stored = get_part(api, part["id"])
    assert stored["body"] == {"status": "stored", "build": 2}
    near(stored["confirmed"]["volume_mm3"], 14400, "depth 24")
    assert mesh_figures(body_object(part["id"], 2))["max"][2] == pytest.approx(24, abs=REL * 30)
    open_part(page, part["name"])
    await_text(page, measurements(page), mm3(stored["confirmed"]["volume_mm3"]))
    poll(page, lambda: difference(before, decode(capture(view))) > 0, "Part view redraws the new body")


def test_wf_part_storage_save_part(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part, _ = made_part(api, "Save bracket", 30, 20, 12)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_part(page, part["name"])
    with held(page, "**/api/parts/*/save") as gate:
        click(page.get_by_role("button", name="Save part"))
        await_exact(page, save_status(page), "Saving…")
        gate.release()
    await_exact(page, save_status(page), "Stored")
    assert get_part(api, part["id"])["body"]["build"] == 2 and body_key(part["id"], 2) in S3().keys(f"bodies/{part['id']}/")


def test_wf_storage_outage_edit_part(page: Page, browser: Browser, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part, _ = made_part(api, "Outage cover", 30, 20, 12)
    pid = part["id"]
    frame = create_assembly(api, "Outage lamp")
    place(api, frame["id"], "part", pid, 2)
    rollup = get_assembly(api, frame["id"])["rollup"]
    outage = os.environ["APP_MINIO_DOWN_URL"]
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, outage, FOUNDER)
    await_text(page, page.get_by_role("alert", name="Storage outage"), OUTAGE_COPY)
    open_part(page, part["name"])
    select(page.get_by_role("combobox", name="Material"), material_option(ALU))
    await_exact(page, save_status(page), "Not stored")
    await_text(page, tree_item(page, part["name"]), "Not stored")
    await_text(page, measurements(page), "Confirmed")
    await_text(page, measurements(page), mm3(part["confirmed"]["volume_mm3"]))
    await_text(page, measurements(page), grams(part["confirmed"]["mass_g"]))
    kept = get_part(api, pid)
    assert kept["material"]["name"] == ALU and kept["body"]["status"] == "not_stored"
    assert kept["confirmed"] == part["confirmed"] and S3().keys(f"bodies/{pid}/") == [body_key(pid, 1)]
    open_assembly(page, frame["name"], storage_down=True)
    await_text(page, page.get_by_role("region", name="Assembly totals"), f"Total mass {grams(rollup['mass_g'])}")
    assert get_assembly(api, frame["id"])["rollup"] == rollup
    with open_app(browser, app_url) as healthy:
        healthy.set_viewport_size(DESKTOP)
        ui_sign_in(healthy, app_url, FOUNDER)
        open_part(healthy, part["name"])
        click(healthy.get_by_role("button", name="Save part"))
        await_exact(healthy, save_status(healthy), "Stored")
        await_gone(healthy, healthy.get_by_role("alert", name="Storage outage"), "outage banner on the healthy instance")
        back = get_part(api, pid)
        assert back["body"]["status"] == "stored" and body_key(pid, back["body"]["build"]) in S3().keys(f"bodies/{pid}/")
        near(back["confirmed"]["mass_g"], 7200 * DENSITY[ALU] / 1000, "aluminium mass")
        await_text(healthy, measurements(healthy), grams(back["confirmed"]["mass_g"]))
    same(get_assembly(api, frame["id"])["rollup"]["mass_g"], 2 * back["confirmed"]["mass_g"], "rollup recomputed")


def test_wf_storage_outage_body_view(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    plate = part_named(api, "Base Plate")
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, os.environ["APP_MINIO_DOWN_URL"], FOUNDER)
    open_part(page, "Base Plate")
    await_text(page, page.get_by_role("main").or_(page.locator("body")), BODY_UNAVAILABLE)
    await_text(page, measurements(page), mm3(plate["confirmed"]["volume_mm3"]))


def nested_lamp(api: Api, label: str) -> dict[str, Any]:
    bracket, _ = made_part(api, f"{label} bracket", 30, 20, 12)
    top, arm, head = (create_assembly(api, f"{label} lamp"), create_assembly(api, f"{label} arm"),
                      create_assembly(api, f"{label} head"))
    m4, m3 = purchased_named(api, M4), purchased_named(api, M3)
    place(api, head["id"], "part", bracket["id"], 1)
    place(api, head["id"], "purchased", m3["id"], 3)
    place(api, arm["id"], "part", bracket["id"], 2)
    place(api, arm["id"], "assembly", head["id"], 1)
    place(api, top["id"], "part", bracket["id"], 1)
    arm_inst = place(api, top["id"], "assembly", arm["id"], 1)
    place(api, top["id"], "purchased", m4["id"], 2)
    return {"bracket": bracket, "top": top, "arm": arm, "head": head, "arm_inst": arm_inst}


def assert_tree_matches(page: Page, api: Api, top: dict, arm: dict) -> None:
    table = page.get_by_role("table", name="Assembly tree")
    rows = tree_rows(api, top["id"])
    arm_row = next(r for r in rows if r["component"]["id"] == arm["id"])
    loc = table.get_by_role("row", name=re.compile(re.escape(arm["name"])))
    await_text(page, loc, grams(arm_row["unit_mass_g"]))
    poll(page, lambda: re.search(rf"\b{arm_row['pieces']}\b", text_of(loc)), "arm row pieces")
    roll = get_assembly(api, top["id"])["rollup"]
    same(roll["mass_g"], sum(r["subtotal_mass_g"] for r in rows), "top total equals its row subtotals")
    await_text(page, page.get_by_role("region", name="Assembly totals"), f"Total mass {grams(roll['mass_g'])}")
    await_text(page, page.get_by_role("region", name="Assembly totals"), f"Pieces {roll['part_count']}")


def test_wf_bom_rollup_redesign(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    lamp = nested_lamp(api, "Ripple")
    bracket, top, arm = lamp["bracket"], lamp["top"], lamp["arm"]
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_child(page, bracket["name"], "Extrude 1")
    depth = await_visible(page, page.get_by_role("form", name=f"Edit {EXTRUDE_1}").get_by_role("textbox", name="Depth"),
                          "Depth")
    fill(depth, "24")
    depth.press("Enter")
    await_exact(page, save_status(page), "Stored")
    open_part(page, bracket["name"])
    select(page.get_by_role("combobox", name="Material"), material_option(ALU))
    poll(page, lambda: get_part(api, bracket["id"])["material"]["name"] == ALU, "material saved")
    await_exact(page, save_status(page), "Stored")
    mass = get_part(api, bracket["id"])["confirmed"]["mass_g"]
    near(mass, 30 * 20 * 24 * DENSITY[ALU] / 1000, "redesigned bracket mass")
    key = body_key(bracket["id"], get_part(api, bracket["id"])["confirmed"]["build"])
    assert key in S3().keys(f"bodies/{bracket['id']}/")
    report = bom(api, top["id"])
    line_ = next(l for l in report["lines"] if l["item"]["id"] == bracket["id"])
    assert line_["quantity"] == 4
    same(line_["line_mass_g"], 4 * mass, "rolled-up bracket mass")
    open_assembly(page, top["name"])
    assert page.get_by_role("button", name=f"Expand {arm['name']}").get_attribute("aria-expanded") not in (
        None, "true"), "subassembly row starts collapsed (L246)"
    assert_tree_matches(page, api, top, arm)
    click(page.get_by_role("button", name=f"Expand {arm['name']}"))
    await_text(page, page.get_by_role("table", name="Assembly tree").get_by_role(
        "row", name=re.compile(re.escape(lamp["head"]["name"]))),
        grams(get_assembly(api, lamp["head"]["id"])["rollup"]["mass_g"]))


def test_wf_bom_rollup_bom_tab(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    lamp = nested_lamp(api, "Tab")
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_assembly(page, lamp["top"]["name"])
    click(page.get_by_role("tablist", name="Assembly view").get_by_role("tab", name="Bill of materials"))
    table = await_visible(page, page.get_by_role("table", name="Bill of materials"), "BOM table")
    report = bom(api, lamp["top"]["id"])
    for line_ in report["lines"]:
        row = table.get_by_role("row").filter(has_text=line_["item"]["name"])
        text = text_of(row)
        assert ("Made" if line_["kind"] == "made" else "Purchased") in text
        assert (line_["material"] or "—") in text and grams(line_["line_mass_g"]) in text, text
    await_text(page, table.get_by_role("row").filter(has_text="Total"), grams(report["total_mass_g"]))


def test_wf_bom_rollup_quantity(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    lamp = nested_lamp(api, "Qty")
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_assembly(page, lamp["top"]["name"])
    spin = page.get_by_role("spinbutton", name=f"Quantity of {lamp['arm']['name']}")
    fill(spin, "2")
    spin.press("Enter")
    poll(page, lambda: next(i for i in get_assembly(api, lamp["top"]["id"])["instances"]
                            if i["id"] == lamp["arm_inst"]["id"])["quantity"] == 2, "quantity committed")
    assert_tree_matches(page, api, lamp["top"], lamp["arm"])


def add_via_dialog(page: Page, component: str, quantity: str, double: bool = False) -> Locator:
    click(page.get_by_role("button", name="Add to assembly"))
    dialog = await_visible(page, page.get_by_role("dialog", name="Add to assembly"), "Add to assembly dialog")
    combo = dialog.get_by_role("combobox", name="Component")
    poll(page, lambda: is_focused(combo), "Component focused (L244)")
    select(combo, component)
    fill(dialog.get_by_role("spinbutton", name="Quantity"), quantity)
    if double:
        with held(page, "**/api/assemblies/*/instances") as gate:
            click(dialog.get_by_role("button", name="Add"))
            await_visible(page, dialog.get_by_role("button", name="Adding…"), "Adding…").click(force=True)
            gate.release()
    else:
        click(dialog.get_by_role("button", name="Add"))
    return dialog


def test_wf_assembly_build_hinge(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    bracket, _ = made_part(api, "Hinge bracket", 30, 20, 12)
    lamp = create_assembly(api, "Hinge lamp")
    hinge_name = fresh("Hinge Assembly")
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    click(page.get_by_role("button", name="New assembly"))
    dialog = await_visible(page, page.get_by_role("dialog", name="New assembly"), "New assembly dialog")
    fill(dialog.get_by_role("textbox", name="Name"), hinge_name)
    click(dialog.get_by_role("button", name="Create assembly"))
    hinge = poll(page, lambda: next((a for a in api.ok("GET", "/api/assemblies")["assemblies"]
                                     if a["name"] == hinge_name), None), "Hinge Assembly created")
    open_assembly(page, hinge_name)
    add_via_dialog(page, bracket["name"], "1")
    await_exact(page, model_message(page), f"{bracket['name']} ×1 added to {hinge_name}.")
    add_via_dialog(page, M3, "2", double=True)
    await_exact(page, model_message(page), f"{M3} ×2 added to {hinge_name}.")
    open_assembly(page, lamp["name"])
    add_via_dialog(page, hinge_name, "1")
    await_exact(page, model_message(page), f"{hinge_name} ×1 added to {lamp['name']}.")
    open_assembly(page, hinge_name)
    dialog = add_via_dialog(page, lamp["name"], "1")
    await_text(page, dialog, f"{hinge_name} cannot contain itself.")
    click(dialog.get_by_role("button", name="Cancel"))
    hinge = get_assembly(api, hinge["id"])
    assert sorted((i["component"]["name"], i["quantity"]) for i in hinge["instances"]) == sorted(
        [(bracket["name"], 1), (M3, 2)])
    assert [i["component"]["id"] for i in get_assembly(api, lamp["id"])["instances"]] == [hinge["id"]]
    expected = bracket["confirmed"]["mass_g"] + 2 * M3_MASS_G
    same(get_assembly(api, lamp["id"])["rollup"]["mass_g"], expected, "lamp total recomputed")
    await_text(page, page.get_by_role("region", name="Assembly totals"), f"Total mass {grams(expected)}")


def test_wf_assembly_build_purchased(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    frame = create_assembly(api, "Purchased frame")
    name = fresh("Grommet")
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    click(page.get_by_role("button", name="New purchased part"))
    dialog = await_visible(page, page.get_by_role("dialog", name="New purchased part"), "dialog")
    fill(dialog.get_by_role("textbox", name="Name"), name)
    mass = dialog.get_by_role("textbox", name="Declared mass (g)")
    fill(mass, "0")
    click(dialog.get_by_role("button", name="Create purchased part"))
    await_text(page, dialog, F_MASS)
    poll(page, lambda: mass.get_attribute("aria-invalid") == "true", "mass field marked invalid")
    fill(mass, "1.50")
    click(dialog.get_by_role("button", name="Create purchased part"))
    poll(page, lambda: any(p["name"] == name for p in api.ok("GET", "/api/purchased")["purchased"]), "purchased created")
    open_assembly(page, frame["name"])
    add_via_dialog(page, name, "2")
    await_exact(page, model_message(page), f"{name} ×2 added to {frame['name']}.")
    click(page.get_by_role("tablist", name="Assembly view").get_by_role("tab", name="Bill of materials"))
    row = page.get_by_role("table", name="Bill of materials").get_by_role("row").filter(has_text=name)
    await_text(page, row, "Purchased")
    await_text(page, row, "—")
    await_text(page, row, grams(3.0))
    assert bom(api, frame["id"])["lines"][0]["kind"] == "purchased"


def test_wf_collaboration_stale_sketch(page: Page, browser: Browser, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part, sid = made_part(api, "Shared bracket", 30, 20, 12)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    await_visible(page, page.get_by_role("button", name=f"Edit {DISTANCE_1}"), "Ines's edit button")
    with open_app(browser, app_url) as teo_page:
        teo_page.set_viewport_size(DESKTOP)
        ui_sign_in(teo_page, app_url, ENGINEER)
        open_sketch(teo_page, part["name"])
        revision = get_sketch(api, sid)["revision"]
        click(teo_page.get_by_role("button", name=f"Edit {DISTANCE_1}"))
        apply_dimension(teo_page, "1.5 in")
        teo_sketch = await_sketch_revision(teo_page, api, sid, revision + 1)
    same(constraint_labelled(teo_sketch, "Distance 1")["value_mm"], 1.5 * INCH_MM, "Teo's value")
    api_poll(lambda: (lambda p: p["body"]["status"] == "stored" and (p["confirmed"] or {}).get("build") == 2)(
        get_part(api, part["id"])), "Teo's rebuild is stored as build 2")
    assert mesh_figures(body_object(part["id"], 2))["max"][0] == pytest.approx(1.5 * INCH_MM, abs=REL * 40)
    click(page.get_by_role("button", name=f"Edit {DISTANCE_1}"))
    apply_dimension(page, "30")
    notice = page.get_by_role("alert", name="Save conflict")
    await_text(page, notice, f"{ENGINEER_NAME} saved {teo_sketch['name']} on {part['name']} at revision "
                             f"{teo_sketch['revision']} after you opened it. Reload to see their changes.")
    click(notice.get_by_role("button", name="Reload"))
    await_gone(page, notice, "Save conflict notice after Reload")
    await_text(page, constraint_item(page, "Distance 1"), "38.10 mm")
    same(constraint_labelled(get_sketch(api, sid), "Distance 1")["value_mm"], 1.5 * INCH_MM, "Teo's change intact")


def test_wf_collaboration_engineer_controls(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    part, _ = made_part(api, "Teo view bracket", 30, 20, 12)
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, ENGINEER)
    await_visible(page, page.get_by_role("table", name="Assembly tree"), "lamp opens for Teo")
    for name in ("New part", "New assembly", "New purchased part", "Add to assembly"):
        assert page.get_by_role("button", name=name).count() == 0, f"engineer sees {name}"
    assert page.get_by_role("spinbutton", name=re.compile("^Quantity of ")).count() == 0
    assert page.get_by_role("button", name=re.compile("^Remove ")).count() == 0
    open_part(page, part["name"])
    await_visible(page, page.get_by_role("button", name="Save part"), "Save part for the engineer")
    assert page.get_by_role("combobox", name="Material").count() == 0
    assert page.get_by_role("button", name="New sketch").count() == 0
    open_sketch(page, part["name"])
    tools = page.get_by_role("toolbar", name="Tools")
    await_visible(page, tools.get_by_role("button", name="Line"), "Line tool")
    assert tools.get_by_role("button", name="Extrude").count() == 0
    await_visible(page, page.get_by_role("group", name="Constrain selection"), "Constrain selection")


def test_wf_bom_on_phone_stacked(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    report = bom(api, assembly_named(api, LAMP)["id"])
    page.set_viewport_size(PHONE)
    ui_sign_in(page, app_url, FOUNDER)
    click(await_visible(page, page.get_by_role("tablist", name="Assembly view").get_by_role(
        "tab", name="Bill of materials"), "BOM tab"))
    table = await_visible(page, page.get_by_role("table", name="Bill of materials"), "BOM table")
    layout(page)
    for line_ in report["lines"]:
        row = table.get_by_role("row").filter(has_text=line_["item"]["name"]).first
        text = rendered_text(row)
        kind = "Made" if line_["kind"] == "made" else "Purchased"
        for pattern in (r"Item\W*" + re.escape(line_["item"]["name"]), r"Kind\W*" + kind,
                        r"Qty\W*" + str(line_["quantity"]), r"Line mass\W*" + re.escape(grams(line_["line_mass_g"]))):
            assert re.search(pattern, text), f"{pattern!r} in stacked row {text!r}"
        boxes = [c.bounding_box() for c in row.get_by_role("cell").all()]
        boxes = [b for b in boxes if b]
        assert len(boxes) >= 2 and all(abs(b["x"] - boxes[0]["x"]) <= 2 * PX_ROUNDING for b in boxes)
        assert all(later["y"] > earlier["y"] for earlier, later in zip(boxes, boxes[1:])), "cells are not stacked"
    await_text(page, table.get_by_role("row").filter(has_text="Total"), grams(report["total_mass_g"]))
    click(page.get_by_role("button", name="Feature tree"))
    sheet = await_visible(page, page.get_by_role("dialog", name="Feature tree"), "Feature tree sheet")
    settle(sheet)
    box = sheet.bounding_box()
    assert box["y"] >= PHONE["height"] * (1 - SHEET_MAX_FRACTION) - PX_ROUNDING, f"sheet covers too much: {box}"
    assert abs(box["y"] + box["height"] - PHONE["height"]) <= 2 * PX_ROUNDING, "sheet is not at the bottom edge"
    await_visible(page, sheet.get_by_role("tree", name="Feature tree"), "tree inside the sheet")
    click(sheet.get_by_role("button", name="Close"))
    poll(page, lambda: is_focused(page.get_by_role("button", name="Feature tree")), "focus back on Feature tree")


def test_wf_bom_on_phone_properties(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    page.set_viewport_size(PHONE)
    ui_sign_in(page, app_url, FOUNDER)
    click(page.get_by_role("button", name="Feature tree"))
    sheet = await_visible(page, page.get_by_role("dialog", name="Feature tree"), "Feature tree sheet")
    click(sheet.get_by_role("treeitem", name=re.compile("^" + re.escape(LAMP))).first)
    await_gone(page, page.get_by_role("dialog", name="Feature tree"), "sheet closes on open")
    poll(page, lambda: is_focused(page.get_by_role("button", name="Feature tree")), "focus returns (L199)")
    click(page.get_by_role("button", name="Properties"))
    await_visible(page, page.get_by_role("dialog", name="Properties"), "Properties sheet")
    assert_lamp_view(page, api)


def test_wf_cross_cutting_keyboard_sketching(page: Page, app_url: str) -> None:
    api = Api(app_url, FOUNDER)
    prefs(api, "mm", 2)
    part = create_part(api, "Keys probe")
    sid = create_sketch(api, part["id"])["id"]
    add_entity(api, sid, line(0, 0, 20, 0))
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    open_sketch(page, part["name"])
    focus_canvas(page)
    before = decode(capture(sketch_canvas(page)))
    page.keyboard.press("ArrowRight")
    poll(page, lambda: difference(before, decode(capture(sketch_canvas(page)))) > 0, "keyboard highlight has no visible focus")
    page.keyboard.press("l")
    group = await_visible(page, page.get_by_role("group", name="Line"), "Line fields")
    start_x = group.get_by_role("textbox", name="Start X")
    poll(page, lambda: is_focused(start_x), "Start X focused (L220)")
    assert all(group.get_by_role("textbox", name=n).input_value() for n in ("Start X", "Start Y", "End X", "End Y"))
    for value in ("0", "30", "20", "30"):
        page.keyboard.press("ControlOrMeta+A")
        page.keyboard.type(value)
        page.keyboard.press("Tab")
    start_x.press("Enter")
    poll(page, lambda: len(get_sketch(api, sid)["entities"]) == 2, "line placed by Enter")
    placed = get_sketch(api, sid)["entities"][1]
    assert (placed["start"], placed["end"]) == ({"x": 0, "y": 30}, {"x": 20, "y": 30})
    poll(page, lambda: is_focused(sketch_canvas(page)), "focus returns to the canvas (L225)")
    kb_select(page, "Line 1", "Line 2")
    page.keyboard.press("p")
    sketch = poll(page, lambda: (lambda s: s if len(s["constraints"]) == 1 else None)(get_sketch(api, sid)), "Parallel")
    await_exact(page, model_message(page), f"Parallel 1 added. Slack {sketch['slack']}.")
    kb_select(page, "Line 2")
    page.keyboard.press("d")
    field = await_visible(page, dimension_field(page), "Dimension value")
    poll(page, lambda: is_focused(field), "Dimension value focused when D opens it (L230)")
    settle(field)
    focused = style(field, "outline-style", "outline-width", "box-shadow")
    field.evaluate("e => e.blur()")
    if quick(page, lambda: field.count() > 0 and field.first.is_visible()):
        rest, focused = state_styles(field, "outline-style", "outline-width", "box-shadow", state="focus")
        assert rest != focused, "Dimension value has no visible focus change"
    else:
        kb_select(page, "Line 2")
        page.keyboard.press("d")
        field = await_visible(page, dimension_field(page), "Dimension value")
        poll(page, lambda: is_focused(field), "Dimension value focused when D opens it (L230)")
    assert (focused["outline-style"] != "none" and float(focused["outline-width"].rstrip("px") or 0) >= FOCUS_RING_MIN_PX) \
        or focused["box-shadow"] != "none", f"focus ring under 2 px: {focused}"
    field.focus()
    page.keyboard.press("ControlOrMeta+A")
    page.keyboard.type("1/2 in")
    page.keyboard.press("Enter")
    sketch = poll(page, lambda: (lambda s: s if len(s["constraints"]) == 2 else None)(get_sketch(api, sid)), "Distance")
    same(constraint_labelled(sketch, "Distance 1")["value_mm"], 0.5 * INCH_MM, "1/2 in")
    await_exact(page, model_message(page), f"Distance 1 added. Slack {sketch['slack']}.")


def test_wf_cross_cutting_layouts(page: Page, app_url: str) -> None:
    page.set_viewport_size(DESKTOP)
    ui_sign_in(page, app_url, FOUNDER)
    nav = page.get_by_role("navigation", name="Workspace")
    props = page.get_by_role("complementary", name="Properties")
    for size, tree_px, props_px, edges in ((DESKTOP, DESKTOP_TREE_PX, DESKTOP_PROPS_PX, True),
                                           (TABLET, TABLET_TREE_PX, TABLET_PROPS_PX, False)):
        page.set_viewport_size(size)
        page.reload()
        await_visible(page, nav, "feature tree panel")
        await_visible(page, props, "Properties panel")
        settle(nav)
        settle(props)
        layout(page)
        nb, pb = nav.bounding_box(), props.bounding_box()
        assert tree_px[0] <= nb["width"] <= tree_px[1], f"{size} tree width {nb['width']}"
        assert props_px[0] <= pb["width"] <= props_px[1], f"{size} props width {pb['width']}"
        assert nb["x"] < pb["x"]
        tools = page.get_by_role("toolbar", name="Tools").bounding_box()
        assert tools["y"] > nb["y"] and tools["y"] > pb["y"], "command strip is below the panels"
        if edges:
            assert nb["x"] <= EDGE_MAX_PX and size["width"] - (pb["x"] + pb["width"]) <= EDGE_MAX_PX
        assert page.get_by_role("button", name="Feature tree").count() == 0 or not page.get_by_role(
            "button", name="Feature tree").first.is_visible()
        click(page.get_by_role("tablist", name="Assembly view").get_by_role("tab", name="Bill of materials"))
        table = await_visible(page, page.get_by_role("table", name="Bill of materials"), "BOM table")
        assert [norm(t) for t in table.get_by_role("columnheader").all_text_contents()] == BOM_COLUMNS
        if edges:
            await_gone(page, nav, "feature tree while BOM is active")
            await_gone(page, props, "Properties while BOM is active")
        layout(page)
    for size in (JUST_BELOW_SHEETS, PHONE):
        page.set_viewport_size(size)
        page.reload()
        await_visible(page, page.get_by_role("button", name="Feature tree"), f"Feature tree button at {size}")
        await_visible(page, page.get_by_role("button", name="Properties"), f"Properties button at {size}")
        assert not (nav.count() and nav.first.is_visible()), f"floating tree at {size}"
        layout(page)
    for size, stacked in ((STACK_EDGE, False), (JUST_BELOW_STACK, True)):
        page.set_viewport_size(size)
        page.reload()
        click(await_visible(page, page.get_by_role("tablist", name="Assembly view").get_by_role(
            "tab", name="Bill of materials"), "BOM tab"))
        table = await_visible(page, page.get_by_role("table", name="Bill of materials"), "BOM table")
        row = table.get_by_role("row").filter(has_text="Base Plate").first
        boxes = [b for b in (c.bounding_box() for c in row.get_by_role("cell").all()) if b]
        same_line = all(abs(b["y"] - boxes[0]["y"]) <= 2 * PX_ROUNDING for b in boxes)
        assert same_line is not stacked, f"BOM at {size['width']} px stacked={not same_line}"
        layout(page)


APP = Path("/app")
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".cache", "coverage", "out", "public", "server-dist",
             ".output", ".next", ".vite", ".turbo", "generated", "static", "lib-cjs", "target"}


def source_files() -> list[Path]:
    listed = subprocess.run(["git", "-C", str(APP), "ls-files", "--cached", "--others", "--exclude-standard"],
                            capture_output=True, text=True)
    if listed.returncode != 0:
        return app_files()
    return [APP / line for line in listed.stdout.splitlines()
            if line and not (set(Path(line).parts) & SKIP_DIRS)]


def app_files() -> list[Path]:
    found: list[Path] = []
    for root, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        found.extend(Path(root) / f for f in files)
    return found


def test_if_run_manifest() -> None:
    run = json.loads((APP / "run.json").read_text())
    assert set(run) == {"_schema", "install", "build", "serve"}
    assert run["_schema"] == "run-manifest-v1"
    assert all(isinstance(run[k], str) and run[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{p.name}@{p.version}" for p in shipped_packages() if p.name not in notices or p.version not in notices]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    assert all(font.lower() in notices.lower() for font in FONTS)


def test_if_licences_allowed() -> None:
    bad = [f"{p.name}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert not bad, f"disallowed licences: {bad}"
    assert "OFL-1.1" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "level", "lmdb", "nedb", "lowdb", "mongodb",
              "mysql", "mysql2", "@libsql/client", "memcached"}
    assert not [p.name for p in shipped_packages() if p.name in banned]
    assert not [f for f in app_files() if f.suffix in {".sqlite", ".sqlite3", ".db", ".ldb"}]


def test_if_lockfile_committed() -> None:
    lock = json.loads((APP / "package-lock.json").read_text())
    pkg = json.loads((APP / "package.json").read_text())
    root = lock["packages"][""]
    for group in ("dependencies", "devDependencies"):
        assert set(root.get(group, {})) == set(pkg.get(group, {})), group


def test_if_service_config_unchanged() -> None:
    assert S3().keys("bodies/"), "MinIO no longer answers with the provided credentials"
    secrets = [os.environ["S3_ACCESS_KEY_ID"], os.environ["S3_SECRET_ACCESS_KEY"]]
    password = urlsplit(os.environ["DATABASE_URL"]).password
    if password:
        secrets.append(password)
    for path in app_files():
        if re.search(r"(docker-)?compose.*\.ya?ml$", path.name) or ".devcontainer" in path.parts:
            text = path.read_text(errors="replace")
            if "MINIO_ROOT_PASSWORD" in text or "POSTGRES_PASSWORD" in text:
                assert any(s in text for s in secrets), f"{path} credentials differ from the provided ones"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    urls: list[str] = []
    with open_app(browser, app_url) as page:
        page.on("request", lambda r: urls.append(r.url))
        ui_sign_in(page, app_url, FOUNDER)
        await_visible(page, page.get_by_role("table", name="Assembly tree"), "workspace")
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, f"requests to other origins: {foreign[:10]}"


def test_if_typescript_only() -> None:
    files = source_files()
    assert any(f.suffix in {".ts", ".tsx"} for f in files)
    offenders = [str(f) for f in files if f.suffix in {".js", ".mjs", ".cjs", ".jsx"}
                 and not re.search(r"\.config\.[cm]?js$", f.name) and not f.name.startswith(".")]
    assert not offenders, f"hand-written JavaScript: {offenders[:10]}"
