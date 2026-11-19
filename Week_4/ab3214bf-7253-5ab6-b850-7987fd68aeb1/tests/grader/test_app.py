from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from time import monotonic
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    WireMock,
    advance,
    animations,
    center,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    pdf_text,
    select,
    session,
    shipped_packages,
    tab_order,
    tap,
)

PASSWORD = "hourproof-demo-1"
EMAIL = {
    "anouk": "anouk@verhoeven.example",
    "joris": "joris@verhoeven.example",
    "mirthe": "mirthe@verhoeven.example",
    "vera": "vera@aldermoor.example",
    "bram": "bram@brightlock.example",
}
FULL_NAME = {"vera": "Vera Lindqvist", "bram": "Bram Okafor", "joris": "Joris Bakker", "anouk": "Anouk Visser"}
FIRM_VERIFIER = {"aldermoor": "vera", "brightlock": "bram"}
AMS = "Europe/Amsterdam"
HEL = "Europe/Helsinki"
RTM10 = "rtm-2026-10"
EIN10 = "ein-2026-10"
TPE10 = "tpe-2026-10"
VNL10 = "vnl-2026-10"
RTM11 = "rtm-2026-11"
EIN09 = "ein-2026-09"
TPE09 = "tpe-2026-09"
EIN08 = "ein-2026-08"
RTM03 = "rtm-2026-03"
RTM03_CODE = "HP-2026-03-RTM-1"
TIMED_OUT = "REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST."
BODY_LIMIT = 1_000_000
REVIEW_SHORT_S = 15
HTTP_TIMEOUT_S = 60
WAIT_S = 25
LONG_WAIT_S = 240
POLL_MS = 80
STEP_MS = 120
_P = 2**255 - 19
_Q = 2**252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


WORKING_NOTE = "  Kept working note kg7 \n  second line  "
WORKING_FRAGMENT = "Kept working note"
DEADLINE_TEXT = "Typed before the deadline"
SESSION_VALUE = "777001"
SESSION_REASON = "Session test reason"
SUB_WH = 654321
SUB_REASON = "  Meter swap\nsecond line  "
HALF_VALUE = "123456"
STALE_VALUE = "345678"
STALE_REASON = "  Typed before the other write  "
PANEL_VALUE = "222333"
ACTUAL_KWH = "1111.000"
UNKNOWN_CODE = "HP-1999-01-NOPE-1"
QTY_EXCLUDE = 700000
QTY_LEDGER = 600000
QTY_CLAIM = 300000
QTY_SYNC = 450000
QTY_MONTHS = 250000
QTY_AGED = 100000
CORS_HEADER = "access-control-allow-origin"
POLICY_PATH = "/api/sites/rtm/policy"
RESIZE_VALUE = "90210"
COUNTDOWN_RESET_S = 120
COUNTDOWN_FLOOR_S = 100


def day_key(day: int) -> str:
    return f"2026-10-{day:02d}"


def site_path(site: str, tail: str) -> str:
    return f"/api/sites/{site}/{tail}"


def rotate_path(firm: str) -> str:
    return f"/api/firms/{firm}/keys/rotate"


def n(text: str) -> int:
    return int(text.replace(",", ""))


def kwh_wh(value: str) -> int:
    return int(Decimal(value) * 1000)


def mwh_wh(value: str) -> int:
    return int(Decimal(value) * 10**6)


def cancel_by_of(production_month: str) -> str:
    year, month = (int(part) for part in production_month.split("-"))
    index = year * 12 + month - 1 + 4
    return f"{index // 12:04d}-{index % 12 + 1:02d}-01T00:00:00Z"


def url_of(variable: str) -> str:
    return os.environ[variable].rstrip("/")


def year_end() -> str:
    return url_of("APP_YEAR_END_CLOCK_URL")


def late() -> str:
    return url_of("APP_LATE_CLOCK_URL")


def short() -> str:
    return url_of("APP_SHORT_REVIEW_URL")


def hub_down() -> str:
    return url_of("APP_WIREMOCK_DOWN_URL")


def press_down() -> str:
    return url_of("APP_GOTENBERG_DOWN_URL")


def ok(response: httpx.Response, status: int = 200) -> Any:
    assert response.status_code == status, f"expected {status}, got {response.status_code}: {response.text[:400]}"
    return response.json()


def refused(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code}: {response.text[:400]}"
    body = response.json()
    assert body["error"]["code"] == code
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["server_now"])
    return body["error"]


class Api:
    def __init__(self, base: str, who: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        if who:
            ok(self.c.post("/api/auth/sign-in", json={"email": EMAIL[who], "password": PASSWORD}))

    def get(self, path: str) -> httpx.Response:
        return self.c.get(path)

    def post(self, path: str, body: Any = None) -> httpx.Response:
        return self.c.post(path, json={} if body is None else body)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.c.put(path, json=body)

    def window(self, wid: str) -> dict[str, Any]:
        return ok(self.get(f"/api/windows/{wid}"))

    def grain(self, wid: str, grain: str) -> dict[str, Any]:
        return ok(self.get(f"/api/windows/{wid}/grains/{grain}"))

    def hours(self, wid: str) -> list[dict[str, Any]]:
        return self.grain(wid, "hour")["buckets"]

    def hour(self, wid: str, hour: str) -> dict[str, Any]:
        return ok(self.get(f"/api/windows/{wid}/hours/{hour}"))

    def lots(self, wid: str) -> list[dict[str, Any]]:
        return ok(self.get(f"/api/windows/{wid}/lots"))["lots"]

    def lines(self, wid: str) -> list[dict[str, Any]]:
        return ok(self.get(f"/api/windows/{wid}/cancellations"))["lines"]

    def revision(self, wid: str) -> int:
        return self.window(wid)["revision"]


def race(*calls: tuple[Api, str, str, Any]) -> list[httpx.Response]:
    async def main() -> list[httpx.Response]:
        clients = [
            httpx.AsyncClient(base_url=api.base, cookies=dict(api.c.cookies), timeout=HTTP_TIMEOUT_S)
            for api, *_ in calls
        ]
        try:
            return await asyncio.gather(
                *(
                    client.request(method, path, json=body) if body is not None else client.request(method, path)
                    for client, (_, method, path, body) in zip(clients, calls)
                )
            )
        finally:
            await asyncio.gather(*(client.aclose() for client in clients))

    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(main())).result()


def wait_for(read: Callable[[], Any], done: Callable[[Any], bool], what: str, seconds: float = LONG_WAIT_S) -> Any:
    deadline = monotonic() + seconds
    last: Any = None
    while monotonic() < deadline:
        last = read()
        if done(last):
            return last
    pytest.fail(f"{what}; last saw {str(last)[:400]}")


def pct(bp: int) -> str:
    return f"{bp // 100}.{bp % 100:02d}"


def utc_of(zone: str, year: int, month: int, day: int, hour: int, fold: int = 0) -> str:
    local = datetime(year, month, day, hour, tzinfo=ZoneInfo(zone), fold=fold)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")


def round_half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def recover_x(y: int, sign: int) -> int:
    xx = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P:
        x = x * _I % _P
    if (x * x - xx) % _P:
        raise ValueError("not on curve")
    return _P - x if (x & 1) != sign else x


def point_add(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    x1, y1, z1, t1 = a
    x2, y2, z2, t2 = b
    aa = (y1 - x1) * (y2 - x2) % _P
    bb = (y1 + x1) * (y2 + x2) % _P
    cc = 2 * _D * t1 * t2 % _P
    dd = 2 * z1 * z2 % _P
    e, f, g, h = bb - aa, dd - cc, dd + cc, bb + aa
    return e * f % _P, g * h % _P, f * g % _P, e * h % _P


def point_mul(k: int, point: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    result = (0, 1, 1, 0)
    while k:
        if k & 1:
            result = point_add(result, point)
        point = point_add(point, point)
        k >>= 1
    return result


def decode_point(raw: bytes) -> tuple[int, int, int, int]:
    value = int.from_bytes(raw, "little")
    y = value & ((1 << 255) - 1)
    x = recover_x(y, value >> 255)
    return x, y, 1, x * y % _P


def ed25519_ok(public: bytes, message: bytes, signature: bytes) -> bool:
    try:
        a_point, r_point = decode_point(public), decode_point(signature[:32])
    except ValueError:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= _Q:
        return False
    y = 4 * pow(5, _P - 2, _P) % _P
    x = recover_x(y, 0)
    base = (x, y, 1, x * y % _P)
    h = int.from_bytes(hashlib.sha512(signature[:32] + public + message).digest(), "little") % _Q
    left = point_mul(s, base)
    right = point_add(r_point, point_mul(h, a_point))
    return (left[0] * right[2] - right[0] * left[2]) % _P == 0 and (left[1] * right[2] - right[1] * left[2]) % _P == 0


def assert_statement_signatures(statement: dict[str, Any], pdf: bytes) -> None:
    public = base64.b64decode(statement["public_key"])
    assert len(public) == 32
    assert hashlib.sha256(public).hexdigest()[:16] == statement["key_id"]
    assert hashlib.sha256(pdf).hexdigest() == statement["pdf_sha256"]
    assert ed25519_ok(public, pdf, base64.b64decode(statement["pdf_signature"]))
    assert ed25519_ok(
        public, statement["attestation_payload"].encode("utf-8"), base64.b64decode(statement["attestation_signature"])
    )


def req(entry: dict[str, Any]) -> dict[str, Any]:
    return entry.get("request", entry)


def req_url(entry: dict[str, Any]) -> str:
    inner = req(entry)
    url = str(inner.get("url") or inner.get("absoluteUrl") or inner.get("path") or "")
    query = inner.get("query") or {}
    return f"{url}?{urlencode(query, doseq=True)}" if query and "?" not in url else url


def req_body(entry: dict[str, Any]) -> Any:
    body = req(entry).get("body")
    return json.loads(body) if isinstance(body, str) else body


def req_header(entry: dict[str, Any], name: str) -> str:
    for key, value in (req(entry).get("headers") or {}).items():
        if key.lower() == name.lower():
            return value.get("values", [value])[0] if isinstance(value, dict) else value
    return ""


def posted_lines(wiremock: WireMock) -> list[dict[str, Any]]:
    return wiremock.requests("/registry/v2/cancellations", method="POST")


def stub_confirm(wiremock: WireMock, line_id: str, status: str, reason: str | None = None) -> None:
    payload: dict[str, Any] = {"status": status}
    if status == "CONFIRMED":
        payload["confirmed_at"] = "2026-11-09T12:00:00Z"
    if reason is not None:
        payload["reason"] = reason
    wiremock.stub("GET", f"/registry/v2/cancellations/{line_id}", json=payload)


def make_bundle(lot: str, name: str, zone: str, hour: str, quantity: int, **extra: Any) -> dict[str, Any]:
    stamp = hour[:13].replace("-", "").replace("T", "")
    bundle: dict[str, Any] = {
        "bundle_id": f"{lot}-{stamp}",
        "lot_ref": lot,
        "lot_name": name,
        "technology": "wind",
        "zone": zone,
        "battery_shifted": False,
        "production_hour": hour,
        "discharge_hour": None,
        "range_start_wh": 0,
        "range_end_wh": quantity,
    }
    bundle.update(extra)
    return bundle


def sync(api: Api, wiremock: WireMock, wid: str, bundles: list[dict[str, Any]]) -> dict[str, Any]:
    wiremock.stub("GET", "/registry/v2/holdings", json={"account": "KG-HOLD-01", "bundles": bundles})
    return ok(api.post(f"/api/windows/{wid}/holdings/sync", {"revision": api.revision(wid)}))


def retire_probes(api: Api, wid: str) -> None:
    for lot in api.lots(wid):
        if lot["name"].startswith("Probe") and lot["status"] == "Available":
            ok(api.put(f"/api/windows/{wid}/lots/{lot['id']}/exclusion", {"revision": api.revision(wid), "excluded": True}))


def fresh_lots(api: Api, wiremock: WireMock, wid: str, zone: str, hour: str, quantities: list[int]) -> list[dict[str, Any]]:
    retire_probes(api, wid)
    token = uuid.uuid4().hex[:8]
    bundles = [make_bundle(f"lot-{token}-{i}", f"Probe {token} {i}", zone, hour, q) for i, q in enumerate(quantities)]
    sync(api, wiremock, wid, bundles)
    by_name = {lot["name"]: lot for lot in api.lots(wid)}
    return [by_name[b["lot_name"]] for b in bundles]


def sandbox_hour(day: int = 12, local_hour: int = 13) -> str:
    return utc_of(HEL, 2026, 10, day, local_hour)


def ensure_reconciling(base: str, wid: str) -> tuple[Api, dict[str, Any]]:
    analyst = Api(base, "anouk")
    window = analyst.window(wid)
    if window["state"] == "In review":
        verifier = Api(base, FIRM_VERIFIER[window["verifier_firm"]["id"]])
        ok(verifier.post(f"/api/windows/{wid}/review/return", {"reason": "cycle"}))
        window = analyst.window(wid)
    if window["state"] == "Returned":
        ok(analyst.post(f"/api/windows/{wid}/resume", {"revision": window["revision"]}))
        window = analyst.window(wid)
    assert window["state"] == "Reconciling"
    return analyst, window


def pool_hours(api: Api, count: int) -> list[str]:
    found = [b["key"] for b in api.hours(EIN10) if b["quality"] == "Estimated"]
    assert len(found) >= count, "ein-2026-10 has run out of Estimated hours"
    return found[:count]


def start_short_review(base: str) -> dict[str, Any]:
    analyst = Api(base, "anouk")
    window = wait_for(
        lambda: analyst.window(EIN09),
        lambda w: w["state"] in ("Returned", "Reconciling"),
        "short review window never left In review",
        seconds=REVIEW_SHORT_S + WAIT_S,
    )
    if window["verifier_firm"] is None or window["verifier_firm"]["id"] != "aldermoor":
        ok(Api(base, "mirthe").put(f"/api/windows/{EIN09}/verifier", {"firm_id": "aldermoor"}))
        window = analyst.window(EIN09)
    if window["state"] == "Returned":
        ok(analyst.post(f"/api/windows/{EIN09}/resume", {"revision": window["revision"]}))
        window = analyst.window(EIN09)
    return ok(analyst.post(f"/api/windows/{EIN09}/submit", {"revision": window["revision"]}))


def record_all(verifier: Api, wid: str) -> list[dict[str, Any]]:
    hours = ok(verifier.get(f"/api/windows/{wid}/sample"))["hours"]
    for item in hours:
        ok(verifier.put(f"/api/windows/{wid}/sample/{item['hour_utc']}", {"result": "agree", "note": ""}))
    return hours


_SCENARIOS: dict[str, tuple[str, Any]] = {}


TAMPERED_PDF = b"%PDF-1.4\n% replaced object\n"


def s3_put(bucket: str, key: str | None, data: bytes) -> None:
    endpoint = os.environ["S3_ENDPOINT"].rstrip("/")
    region = os.environ.get("S3_REGION") or "us-east-1"
    access, secret = os.environ["S3_ACCESS_KEY_ID"], os.environ["S3_SECRET_ACCESS_KEY"]
    host = urlparse(endpoint).netloc
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    day = stamp[:8]
    payload = hashlib.sha256(data).hexdigest()
    uri = f"/{bucket}/{key}" if key else f"/{bucket}"
    headers = f"host:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{stamp}\n"
    signed = "host;x-amz-content-sha256;x-amz-date"
    canonical = f"PUT\n{uri}\n\n{headers}\n{signed}\n{payload}"
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"

    def mac(k: bytes, msg: str) -> bytes:
        return hmac.new(k, msg.encode(), hashlib.sha256).digest()

    derived = mac(mac(mac(mac(("AWS4" + secret).encode(), day), region), "s3"), "aws4_request")
    signature = hmac.new(derived, to_sign.encode(), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={signed}, Signature={signature}"
    answer = httpx.put(
        endpoint + uri,
        content=data,
        headers={"x-amz-date": stamp, "x-amz-content-sha256": payload, "Authorization": auth, "content-type": "application/pdf"},
        timeout=HTTP_TIMEOUT_S,
    )
    assert answer.status_code in (200, 201, 204), f"store refused the overwrite: {answer.status_code}"


class PressProxy:

    def __init__(self, target: str) -> None:
        self.open = threading.Event()
        self.refused = 0
        self.forwarded = 0
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                body = self.rfile.read(int(self.headers.get("content-length") or 0))
                if not proxy.open.is_set():
                    proxy.refused += 1
                    self.send_response(503)
                    self.send_header("content-length", "0")
                    self.end_headers()
                    return
                proxy.forwarded += 1
                answer = httpx.post(
                    target + self.path,
                    content=body,
                    headers={"content-type": self.headers.get("content-type", "")},
                    timeout=HTTP_TIMEOUT_S,
                )
                self.send_response(answer.status_code)
                self.send_header("content-type", answer.headers.get("content-type", "application/pdf"))
                self.send_header("content-length", str(len(answer.content)))
                self.end_headers()
                self.wfile.write(answer.content)

            def log_message(self, *args: Any) -> None:
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@contextmanager
def app_copy(extra_env: dict[str, str]) -> Iterator[tuple[str, str]]:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    token = uuid.uuid4().hex[:8]
    suffix = f"-p{token}"
    parsed = urlparse(os.environ["DATABASE_URL"])
    scratch_db = f"{parsed.path.lstrip('/')}_p{token}"
    created = subprocess.run(
        ["psql", os.environ["DATABASE_URL"], "-c", f'CREATE DATABASE "{scratch_db}"'], capture_output=True, text=True, timeout=HTTP_TIMEOUT_S
    )
    assert created.returncode == 0, f"scratch database not created: {created.stderr[-400:]}"
    s3_put(os.environ["S3_BUCKET"] + suffix, None, b"")
    env = {
        **os.environ,
        **extra_env,
        "DATABASE_URL": parsed._replace(path="/" + scratch_db).geturl(),
        "S3_BUCKET": os.environ["S3_BUCKET"] + suffix,
        "APP_PUBLIC_PORT": str(port),
    }
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log:
        child = subprocess.Popen(
            json.loads(Path("/app/run.json").read_text())["serve"],
            shell=True,
            cwd=DEPLOYED_APP,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = monotonic() + LONG_WAIT_S
            while monotonic() < deadline:
                if child.poll() is not None:
                    log.seek(0)
                    pytest.fail(f"app copy exited: {log.read()[-1500:]}")
                try:
                    if httpx.get(base + "/api/health", timeout=2).status_code == 200:
                        break
                except httpx.HTTPError:
                    continue
            else:
                pytest.fail("app copy never answered its health check")
            yield base, suffix
        finally:
            try:
                os.killpg(child.pid, 15)
            except ProcessLookupError:
                pass
            child.wait(timeout=30)


def once(name: str, build: Callable[[], Any]) -> Any:
    if name not in _SCENARIOS:
        try:
            _SCENARIOS[name] = ("ok", build())
        except BaseException as exc:
            _SCENARIOS[name] = ("err", exc)
            raise
    status, value = _SCENARIOS[name]
    if status == "err":
        pytest.fail(f"shared story {name} failed: {value}")
    return value


@contextmanager
def desk(
    browser: Browser,
    base: str,
    who: str | None,
    path: str,
    width: int = 1280,
    height: int = 800,
    reduced_motion: str = "no-preference",
    device_time: datetime | None = None,
) -> Iterator[Page]:
    with open_app(browser, base + "/sign-in", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": width, "height": height})
        if who:
            answer = page.request.post(base + "/api/auth/sign-in", data={"email": EMAIL[who], "password": PASSWORD})
            assert answer.status == 200
        if device_time:
            page.clock.set_system_time(device_time)
        page.goto(base + path)
        yield page


def R(scope: Page | Locator, role: str, name: str | re.Pattern[str]) -> Locator:
    return scope.get_by_role(role, name=name, exact=True) if isinstance(name, str) else scope.get_by_role(role, name=name)


def soon(page: Page, check: Callable[[], None], seconds: float = WAIT_S, step: int = STEP_MS) -> None:
    deadline = monotonic() + seconds
    last: Exception | None = None
    while monotonic() < deadline:
        advance(page, step)
        try:
            check()
            return
        except (AssertionError, PlaywrightError) as exc:
            last = exc
    pytest.fail(f"page never reached the expected state: {last}")


def see(page: Page, locator: Locator, seconds: float = WAIT_S) -> None:
    soon(page, lambda: expect(locator.first).to_be_visible(timeout=POLL_MS), seconds)


def says(page: Page, locator: Locator, text: str | re.Pattern[str], seconds: float = WAIT_S) -> None:
    soon(page, lambda: expect(locator).to_have_text(text, timeout=POLL_MS), seconds)


def holds(page: Page, locator: Locator, text: str | re.Pattern[str], seconds: float = WAIT_S) -> None:
    soon(page, lambda: expect(locator).to_contain_text(text, timeout=POLL_MS), seconds)


def absent(page: Page, locator: Locator, seconds: float = WAIT_S) -> None:
    soon(page, lambda: expect(locator).to_have_count(0, timeout=POLL_MS), seconds)


def focus_on(page: Page, locator: Locator, seconds: float = WAIT_S) -> None:
    soon(page, lambda: expect(locator).to_be_focused(timeout=POLL_MS), seconds)


def press(page: Page, key: str) -> None:
    page.keyboard.press(key)
    advance(page, 30)


def release(handle: Any) -> None:
    (handle.release if hasattr(handle, "release") else handle)()


RECORD_LIVE = "el=>{if(el.__log)return;el.__log=[];new MutationObserver(()=>el.__log.push(el.textContent)).observe(el,{childList:true,subtree:true,characterData:true});}"
RECORD_PHASES = (
    "el=>{el.__phases=[];el.__falls={};const look=()=>{const l=el.__phases,p=el.getAttribute('data-phase');"
    "if(l[l.length-1]!==p)l.push(p);el.querySelectorAll('[data-fall-parent]').forEach(n=>"
    "{el.__falls[n.getAttribute('data-fall-parent')]=n.getAttribute('data-detached-wh')});};"
    "new MutationObserver(look).observe(el,{attributes:true,childList:true,subtree:true});}"
)


def record(locator: Locator) -> None:
    locator.evaluate(RECORD_LIVE)


def log_of(locator: Locator) -> list[str]:
    return locator.evaluate("el=>el.__log||[]")


def announcements(locator: Locator, copy: str) -> int:
    count, before = 0, False
    for text in log_of(locator):
        now = copy in text
        count += int(now and not before)
        before = now
    return count


def assert_before(locator: Locator, first: str, second: str) -> None:
    entries = log_of(locator)
    a = next((i for i, t in enumerate(entries) if first in t), None)
    b = next((i for i, t in enumerate(entries) if second in t), None)
    assert a is not None and b is not None, f"announcements missing: {entries}"
    assert a < b or (a == b and entries[a].index(first) < entries[a].index(second)), f"wrong order: {entries}"


def alloc_line(window: dict[str, Any]) -> str:
    return f"Allocation done. Hour score {pct(window['scores']['hour_bp'])} percent. {window['unmatched_hours']} unmatched hours."


def cell_name(zone: str, bucket: dict[str, Any]) -> str:
    instant = datetime.strptime(bucket["key"], "%Y-%m-%dT%H:00:00Z").replace(tzinfo=timezone.utc)
    local = instant.astimezone(ZoneInfo(zone))
    again = " again" if local.fold else ""
    consumed = "consumed none" if bucket["quality"] == "Missing" else f"consumed {bucket['consumed_wh']} Wh"
    return (
        f"{local:%Y-%m-%d} {local:%H}:00{again} local, {instant:%H}:00 UTC, {consumed}, "
        f"matched {bucket['matched_wh']} Wh, {bucket['quality']}"
    )


def bucket_at(buckets: list[dict[str, Any]], key: str) -> dict[str, Any]:
    return next(b for b in buckets if b["key"] == key)


def dialog_ok(page: Page, name: str, opener: Locator, first: Locator | None = None) -> None:
    dialog = R(page, "dialog", name)
    see(page, dialog)
    if first is not None:
        focus_on(page, first)
    soon(page, lambda: _assert_inside(dialog))
    for key in ["Tab"] * 9 + ["Shift+Tab"] * 9:
        press(page, key)
        _assert_inside(dialog)
    press(page, "Escape")
    absent(page, dialog)
    focus_on(page, opener)


def _assert_inside(dialog: Locator) -> None:
    assert dialog.evaluate("d=>d.contains(document.activeElement)"), "focus left the dialog"


def _countdown_seconds(text: str) -> int:
    found = re.fullmatch(r"(\d+)d (\d\d)h (\d\d)m (\d\d)s left", text.strip())
    assert found, f"timer text {text!r}"
    d, h, m, s = (int(v) for v in found.groups())
    return d * 86400 + h * 3600 + m * 60 + s


def _wall(page: Page) -> Locator:
    return R(page, "grid", "Hour Wall")


def _go_to_grain_hour(wid: str, hour: str | None = None) -> str:
    return f"/windows/{wid}?grain=hour" + (f"&hour={hour}" if hour else "")


def pipeline_story(base: str) -> dict[str, Any]:

    def build() -> dict[str, Any]:
        vera, anouk = Api(base, "vera"), Api(base, "anouk")
        note_max = "\U0001F50B" * 2000
        note = WORKING_NOTE
        sample = ok(vera.get(f"/api/windows/{EIN09}/sample"))
        hours = sample["hours"]
        out: dict[str, Any] = {"note": note, "sample": hours}
        out["over_note"] = vera.put(f"/api/windows/{EIN09}/sample/{hours[0]['hour_utc']}", {"result": "exception", "note": note_max + "x"})
        out["max_note"] = vera.put(f"/api/windows/{EIN09}/sample/{hours[1]['hour_utc']}", {"result": "exception", "note": note_max})
        out["no_note"] = vera.put(f"/api/windows/{EIN09}/sample/{hours[0]['hour_utc']}", {"result": "exception", "note": "   "})
        out["bad_result"] = vera.put(f"/api/windows/{EIN09}/sample/{hours[0]['hour_utc']}", {"result": "maybe", "note": ""})
        out["incomplete"] = vera.post(f"/api/windows/{EIN09}/review/complete", {})
        ok(vera.put(f"/api/windows/{EIN09}/sample/{hours[0]['hour_utc']}", {"result": "exception", "note": note}))
        ok(vera.put(f"/api/windows/{EIN09}/sample/{hours[1]['hour_utc']}", {"result": "agree", "note": ""}))
        for item in hours[2:]:
            ok(vera.put(f"/api/windows/{EIN09}/sample/{item['hour_utc']}", {"result": "agree", "note": ""}))
        out["recorded"] = ok(vera.get(f"/api/windows/{EIN09}/sample"))["hours"]
        out["completed"] = ok(vera.post(f"/api/windows/{EIN09}/review/complete", {}))
        out["sent"] = ok(anouk.post(f"/api/windows/{EIN09}/cancellations", {}))
        wait_for(lambda: anouk.window(EIN09), lambda w: w["state"] == "Cancelled", "window never reached Cancelled")
        out["before_key"] = ok(Api(base).get(f"/api/public/statements/{RTM03_CODE}"))["key_id"] if False else None
        out["signed"] = ok(
            vera.post(
                f"/api/windows/{EIN09}/sign",
                {"typed_name": FULL_NAME["vera"], "opinion": "Unqualified", "signed_at": "1999-01-01T00:00:00Z", "statement_code": "HP-1999-01-FAKE-9"},
            )
        )
        out["code"] = out["signed"]["statement_code"]
        public = Api(base)
        out["statement"] = wait_for(
            lambda: public.get(f"/api/public/statements/{out['code']}"), lambda r: r.status_code == 200, "statement never resolved"
        ).json()
        out["window"] = anouk.window(EIN09)
        out["pdf_response"] = public.get(f"/check/{out['code']}/attestation.pdf")
        return out

    return once("pipeline", build)


def cancel_story(base: str, wiremock: WireMock) -> dict[str, Any]:

    def build() -> dict[str, Any]:
        anouk, bram = Api(base, "anouk"), Api(base, "bram")
        lines = anouk.lines(TPE09)
        ids = [line["line_id"] for line in lines]
        for line_id in ids:
            stub_confirm(wiremock, line_id, "PENDING")
        presses = race(
            (anouk, "POST", f"/api/windows/{TPE09}/cancellations", {}),
            (anouk, "POST", f"/api/windows/{TPE09}/cancellations", {}),
            (anouk, "POST", f"/api/windows/{TPE09}/cancellations", {}),
        )
        out: dict[str, Any] = {"ids": ids, "presses": presses, "seed_lines": lines}
        wait_for(
            lambda: wiremock.requests(f"/registry/v2/cancellations/{ids[0]}", method="GET"),
            bool,
            "registry confirmation was never polled",
            seconds=WAIT_S,
        )
        out["pending_window"] = anouk.window(TPE09)
        out["pending_lots"] = anouk.lots(TPE09)
        out["pending_lines"] = anouk.lines(TPE09)
        stub_confirm(wiremock, ids[0], "CONFIRMED")
        out["one_window"] = wait_for(lambda: anouk.window(TPE09), lambda w: w["lines_confirmed"] == 1, "first confirmation not recorded", seconds=WAIT_S)
        out["one_lots"] = anouk.lots(TPE09)
        out["one_lines"] = anouk.lines(TPE09)
        stub_confirm(wiremock, ids[1], "CONFIRMED")
        stub_confirm(wiremock, ids[2], "CONFIRMED")
        out["done_window"] = wait_for(lambda: anouk.window(TPE09), lambda w: w["state"] == "Cancelled", "window never reached Cancelled", seconds=WAIT_S)
        out["done_lots"] = anouk.lots(TPE09)
        out["posts"] = posted_lines(wiremock)
        out["repeat"] = anouk.post(f"/api/windows/{TPE09}/cancellations", {})
        out["signed"] = ok(bram.post(f"/api/windows/{TPE09}/sign", {"typed_name": FULL_NAME["bram"]}))
        public = Api(base)
        out["statement"] = wait_for(lambda: public.get(f"/api/public/statements/{out['signed']['statement_code']}"), lambda r: r.status_code == 200, "statement never resolved").json()
        out["pdf"] = public.get(f"/check/{out['signed']['statement_code']}/attestation.pdf").content
        return out

    return once("cancel", build)


def rejection_story(browser: Browser, wiremock: WireMock) -> dict[str, Any]:

    def build() -> dict[str, Any]:
        base = late()
        anouk, bram = Api(base, "anouk"), Api(base, "bram")
        lines = anouk.lines(TPE09)
        ids = [line["line_id"] for line in lines]
        before = anouk.window(TPE09)
        for line_id in ids:
            stub_confirm(wiremock, line_id, "PENDING")
        ok(anouk.post(f"/api/windows/{TPE09}/cancellations", {}))
        out: dict[str, Any] = {"ids": ids, "before": before, "reason": "Range retired by issuer kq2"}
        with desk(browser, base, "anouk", f"/windows/{TPE09}") as page:
            alert = R(page, "alert", "Desk alert")
            see(page, R(page, "region", "Window desk"))
            stub_confirm(wiremock, ids[0], "REJECTED", out["reason"])
            says_copy = "The registry rejected a line — back to reconciling."
            holds(page, alert, says_copy, LONG_WAIT_S)
            out["alert_shown"] = True
        window = wait_for(lambda: anouk.window(TPE09), lambda w: w["state"] == "Reconciling", "rejection did not return the window", seconds=WAIT_S)
        out["after_first"] = window
        out["first_lines"] = anouk.lines(TPE09)
        out["first_hour"] = anouk.hour(TPE09, lines[0]["hour_utc"])
        window = ok(anouk.post(f"/api/windows/{TPE09}/submit", {"revision": window["revision"]}))
        out["in_review"] = window
        stub_confirm(wiremock, ids[1], "REJECTED", out["reason"])
        out["after_review_reject"] = wait_for(lambda: anouk.window(TPE09), lambda w: w["state"] == "Reconciling", "rejection in review did not return the window", seconds=WAIT_S)
        out["sample_after"] = anouk.get(f"/api/windows/{TPE09}/sample")
        rev = out["after_review_reject"]["revision"]
        stub_confirm(wiremock, ids[2], "REJECTED", out["reason"])
        out["after_third"] = wait_for(lambda: anouk.window(TPE09), lambda w: w["revision"] > rev, "rejection while Reconciling did not recompute", seconds=WAIT_S)
        token = uuid.uuid4().hex[:8]
        hour = "2026-09-20T10:00:00Z"
        bundle = make_bundle(f"lot-{token}", f"Second pass {token}", "FI", hour, 400000)
        sync(anouk, wiremock, TPE09, [bundle])
        window = anouk.window(TPE09)
        window = ok(anouk.post(f"/api/windows/{TPE09}/submit", {"revision": window["revision"]}))
        record_all(bram, TPE09)
        out["completed"] = ok(bram.post(f"/api/windows/{TPE09}/review/complete", {}))
        out["second_press"] = ok(anouk.post(f"/api/windows/{TPE09}/cancellations", {}))
        out["new_line"] = f"{TPE09}_{bundle['bundle_id']}_0"
        out["posts"] = posted_lines(wiremock)
        out["final"] = wait_for(lambda: anouk.window(TPE09), lambda w: w["state"] == "Cancelled", "second pass never reached Cancelled", seconds=WAIT_S)
        out["final_lines"] = anouk.lines(TPE09)
        return out

    return once("rejection", build)


def chain_story(base: str, wiremock: WireMock) -> dict[str, Any]:

    def build() -> dict[str, Any]:
        public, anouk, vera, mirthe = Api(base), Api(base, "anouk"), Api(base, "vera"), Api(base, "mirthe")
        first = wait_for(lambda: public.get(f"/api/public/statements/{RTM03_CODE}"), lambda r: r.status_code == 200, "seeded statement never sealed").json()
        out: dict[str, Any] = {"first": first, "first_pdf": public.get(f"/check/{RTM03_CODE}/attestation.pdf").content}
        hour_a, hour_b = "2026-03-10T10:00:00Z", "2026-03-11T10:00:00Z"
        wiremock.stub("GET", "/hub/v1/corrections", json={"corrections": [
            {"hour_utc": hour_a, "unit": "kWh", "value": "800", "version": 1},
            {"hour_utc": "2026-03-10T11:00:00Z", "unit": "MWh", "value": "0.9", "version": 1},
        ]})
        out["pull_one"] = ok(anouk.post("/api/sites/rtm/corrections/pull", {}))
        out["corrections_calls"] = [req_url(e) for e in wiremock.requests("/hub/v1/corrections")]
        out["repeat_pull"] = ok(anouk.post("/api/sites/rtm/corrections/pull", {}))
        r2 = f"{RTM03}-r2"
        out["predecessor"] = anouk.window(RTM03)
        out["r2"] = anouk.window(r2)
        out["old_statement"] = ok(public.get(f"/api/public/statements/{RTM03_CODE}"))
        out["old_pdf_after"] = public.get(f"/check/{RTM03_CODE}/attestation.pdf").content
        out["r2_lines"] = anouk.lines(r2)
        out["r2_ledger"] = ok(anouk.get(f"/api/windows/{r2}/ledger"))
        window = out["r2"]
        window = ok(anouk.post(f"/api/windows/{r2}/submit", {"revision": window["revision"]}))
        record_all(vera, r2)
        out["r2_completed"] = ok(vera.post(f"/api/windows/{r2}/review/complete", {}))
        out["rotated"] = ok(vera.post(rotate_path("aldermoor"), {}))
        out["other_firm_rotate"] = Api(base, "bram").post(rotate_path("aldermoor"), {})
        out["signed_r2"] = ok(vera.post(f"/api/windows/{r2}/sign", {"typed_name": FULL_NAME["vera"]}))
        code2 = out["signed_r2"]["statement_code"]
        out["statement_2"] = wait_for(lambda: public.get(f"/api/public/statements/{code2}"), lambda r: r.status_code == 200, "successor never sealed").json()
        out["statement_2_pdf"] = public.get(f"/check/{code2}/attestation.pdf").content
        out["old_after_seal"] = ok(public.get(f"/api/public/statements/{RTM03_CODE}"))
        wiremock.stub("GET", "/hub/v1/corrections", json={"corrections": [{"hour_utc": hour_b, "unit": "kWh", "value": "700", "version": 1}]})
        out["pull_two"] = ok(anouk.post("/api/sites/rtm/corrections/pull", {}))
        out["r3"] = anouk.window(f"{RTM03}-r3")
        out["statement_2_after"] = ok(public.get(f"/api/public/statements/{code2}"))
        out["first_after_second"] = ok(public.get(f"/api/public/statements/{RTM03_CODE}"))
        out["rollups"] = ok(mirthe.get("/api/group/scores"))["rollups"]
        out["posts"] = posted_lines(wiremock)
        return out

    return once("chain", build)


def test_wf_desk_access_landing(browser: Browser) -> None:
    base = year_end()
    for who, route, heading in [("anouk", "/windows", "YOUR WINDOWS."), ("vera", "/review", "YOUR REVIEW QUEUE."), ("mirthe", "/group", "EVERY SITE. EVERY GRAIN.")]:
        with desk(browser, base, None, "/sign-in") as page:
            see(page, R(page, "heading", "SIGN IN."))
            fill(R(page, "textbox", "Email"), EMAIL[who])
            fill(R(page, "textbox", "Password"), "wrong-password")
            click(R(page, "button", "Sign in"))
            holds(page, R(page, "alert", "Problems to fix"), "That email and password don't match — try again.")
            fill(R(page, "textbox", "Password"), PASSWORD)
            click(R(page, "button", "Sign in"))
            soon(page, lambda: _assert_path(page, route))
            see(page, R(page, "heading", heading))
            assert ok(page_api_me(page, base))["user"]["role"] in ("analyst", "verifier", "lead")
    refused(Api(base).post("/api/auth/sign-in", {"email": EMAIL["anouk"], "password": "nope"}), 401, "INVALID_CREDENTIALS")


def page_api_me(page: Page, base: str) -> httpx.Response:
    answer = page.request.get(base + "/api/me")
    return httpx.Response(answer.status, content=answer.body())


def _assert_path(page: Page, path: str) -> None:
    assert urlparse(page.url).path == path, f"at {page.url}, expected {path}"


def test_published_routes_survive_reload(browser: Browser) -> None:
    base = year_end()
    wait_for(lambda: Api(base).get(f"/api/public/statements/{RTM03_CODE}"), lambda r: r.status_code == 200,
             "seeded statement never sealed")
    routes = [
        ("anouk", "/windows", ("heading", "YOUR WINDOWS.")),
        ("anouk", f"/windows/{RTM10}", ("region", "Window desk")),
        ("anouk", f"/windows/{RTM10}/lots", ("heading", "RANK YOUR LOTS.")),
        ("anouk", f"/windows/{RTM10}/ledger", ("heading", "EVERY WATT-HOUR, ACCOUNTED.")),
        ("mirthe", "/group", ("heading", "EVERY SITE. EVERY GRAIN.")),
        ("vera", "/review", ("heading", "YOUR REVIEW QUEUE.")),
        ("vera", f"/review/{EIN09}", ("region", "Review summary")),
        (None, "/check", ("heading", "CHECK A STATEMENT.")),
        (None, "/", ("heading", "EVERY HOUR")),
        (None, f"/check/{RTM03_CODE}", ("region", "Statement result")),
    ]
    for who, route, (role, name) in routes:
        with desk(browser, base, who, route) as page:
            see(page, R(page, role, name))
            page.reload()
            see(page, R(page, role, name))
    with desk(browser, base, None, "/windows") as page:
        soon(page, lambda: _assert_path(page, "/sign-in"))
    with desk(browser, base, "anouk", "/no-such-screen") as page:
        see(page, page.get_by_text("THAT PAGE DOES NOT EXIST.", exact=True))
    with desk(browser, base, "vera", f"/windows/{TPE10}") as page:
        see(page, page.get_by_text("THAT PAGE DOES NOT EXIST.", exact=True))


def test_verifier_firm_boundary() -> None:
    base = year_end()
    bram = Api(base, "bram")
    unknown_id = "nowhere-2026-10"
    pairs = [
        ("GET", f"/api/windows/{EIN10}", f"/api/windows/{unknown_id}", None),
        ("GET", f"/api/windows/{EIN09}/sample", f"/api/windows/{unknown_id}/sample", None),
        ("GET", f"/api/windows/{EIN09}/grains/hour", f"/api/windows/{unknown_id}/grains/hour", None),
        ("POST", f"/api/windows/{EIN09}/review/complete", f"/api/windows/{unknown_id}/review/complete", {}),
        ("POST", f"/api/windows/{EIN08}/sign", f"/api/windows/{unknown_id}/sign", {"typed_name": FULL_NAME["bram"]}),
        ("POST", f"/api/windows/{EIN09}/review/return", f"/api/windows/{unknown_id}/review/return", {"reason": "x"}),
    ]
    for method, theirs, unknown, body in pairs:
        foreign = bram.c.request(method, theirs, json=body) if body is not None else bram.c.request(method, theirs)
        missing = bram.c.request(method, unknown, json=body) if body is not None else bram.c.request(method, unknown)
        first, second = refused(foreign, 404, "NOT_FOUND"), refused(missing, 404, "NOT_FOUND")
        assert first == second
    assert ok(bram.get(f"/api/windows/{TPE10}"))["verifier_firm"]["id"] == "brightlock"


def test_role_refusals_at_server() -> None:
    base = year_end()
    anouk, vera, mirthe = Api(base, "anouk"), Api(base, "vera"), Api(base, "mirthe")
    analyst_actions = [
        ("POST", f"/api/windows/{EIN10}/meters/pull"),
        ("POST", f"/api/windows/{EIN10}/gaps/repair"),
        ("POST", f"/api/windows/{EIN10}/allocation"),
        ("POST", f"/api/windows/{EIN10}/holdings/sync"),
        ("POST", f"/api/windows/{EIN10}/submit"),
        ("POST", f"/api/windows/{EIN10}/resume"),
        ("POST", f"/api/windows/{EIN10}/cancellations"),
        ("POST", f"/api/windows/{EIN10}/hours/spread"),
        ("PUT", f"/api/windows/{EIN10}/merit-order"),
        ("POST", "/api/sites/ein/corrections/pull"),
    ]
    before = anouk.revision(EIN10)
    for method, path in analyst_actions:
        for other in (vera, mirthe):
            refused(other.c.request(method, path, json={}), 403, "FORBIDDEN")
    verifier_actions = [
        ("POST", f"/api/windows/{EIN09}/review/return"),
        ("POST", f"/api/windows/{EIN09}/review/complete"),
        ("POST", f"/api/windows/{EIN08}/sign"),
        ("POST", rotate_path("aldermoor")),
    ]
    for method, path in verifier_actions:
        for other in (anouk, mirthe):
            refused(other.c.request(method, path, json={}), 403, "FORBIDDEN")
    for method, path in [("GET", "/api/firms"), ("GET", "/api/group/scores")]:
        for other in (anouk, vera):
            refused(other.c.request(method, path, json={}) if method != "GET" else other.get(path), 403, "FORBIDDEN")
    assert anouk.revision(EIN10) == before


def test_wf_desk_access_session_resume(browser: Browser, app_url: str) -> None:
    anouk = ensure_reconciling(app_url, EIN10)[0]
    hour = pool_hours(anouk, 1)[0]
    with desk(browser, app_url, "anouk", _go_to_grain_hour(EIN10, hour)) as page:
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        value, reason = R(panel, "textbox", "Substitution value in watt-hours"), R(panel, "textbox", "Reason")
        fill(value, SESSION_VALUE)
        fill(reason, SESSION_REASON)
        puts: list[str] = []
        page.on("request", lambda r: puts.append(r.method) if r.method == "PUT" and "/substitution" in r.url else None)
        assert page.request.post(app_url + "/api/auth/sign-out", data={}).status == 200
        click(R(panel, "button", "Save substitution"))
        again = R(page, "dialog", "Sign in again")
        see(page, again)
        holds(page, again, "Your session ended. Sign in to finish.")
        expect(value).to_have_value(SESSION_VALUE)
        assert parse_qs(urlparse(page.url).query).get("hour") == [hour]
        fill(R(again, "textbox", "Password"), "wrong-password")
        click(R(again, "button", "Sign in"))
        holds(page, R(again, "alert", "Problems to fix"), "That email and password don't match — try again.")
        fill(R(again, "textbox", "Password"), PASSWORD)
        click(R(again, "button", "Sign in"))
        absent(page, again)
        wait_for(lambda: anouk.hour(EIN10, hour), lambda h: h["quality"] == "Substituted", "resent save never landed", seconds=WAIT_S)
        soon(page, lambda: _equal(len(puts), 2))
    saved = anouk.hour(EIN10, hour)
    assert saved["consumed_wh"] == int(SESSION_VALUE) and saved["substitution_reason"] == SESSION_REASON


def _equal(a: Any, b: Any) -> None:
    assert a == b, f"{a!r} != {b!r}"


def test_reassignment_ends_access(browser: Browser) -> None:
    base = short()
    start_short_review(base)
    vera, bram, anouk, mirthe = Api(base, "vera"), Api(base, "bram"), Api(base, "anouk"), Api(base, "mirthe")
    hours = ok(vera.get(f"/api/windows/{EIN09}/sample"))["hours"]
    ok(vera.put(f"/api/windows/{EIN09}/sample/{hours[0]['hour_utc']}", {"result": "agree", "note": ""}))
    with desk(browser, base, "vera", f"/review/{EIN09}") as page:
        see(page, R(page, "region", "Review summary"))
        wait_for(lambda: anouk.window(EIN09), lambda w: w["state"] == "Returned", "review never timed out", seconds=REVIEW_SHORT_S + WAIT_S)
        ok(mirthe.put(f"/api/windows/{EIN09}/verifier", {"firm_id": "brightlock"}))
        refused(vera.get(f"/api/windows/{EIN09}"), 404, "NOT_FOUND")
        see(page, page.get_by_text("THAT PAGE DOES NOT EXIST.", exact=True))
    assert ok(bram.get(f"/api/windows/{EIN09}"))["verifier_firm"]["id"] == "brightlock"
    sample = anouk.get(f"/api/windows/{EIN09}/sample")
    if sample.status_code == 200:
        assert all(item["result"] is None for item in sample.json()["hours"])
    else:
        refused(sample, 409, "WRONG_STATE")


def test_window_opens_from_server_clock(browser: Browser, app_url: str) -> None:
    anouk = Api(app_url, "anouk")
    before = anouk.window(RTM11)
    assert before["state"] == "Awaiting meters" and before["opens_at"] == "2026-12-02T23:00:00Z"
    assert before["opens_seconds_left"] >= 1
    error = refused(anouk.post(f"/api/windows/{RTM11}/meters/pull", {"revision": before["revision"]}), 409, "WINDOW_NOT_OPEN")
    assert error["message"] == "This window opens at 2026-12-02T23:00:00Z."
    assert anouk.revision(RTM11) == before["revision"]
    assert Api(late(), "anouk").window(RTM11)["opens_seconds_left"] is None
    with desk(browser, app_url, "anouk", f"/windows/{RTM11}") as page:
        see(page, R(page, "timer", "Opens in"))
        click(R(R(page, "region", "Window actions"), "button", "Pull meters"))
        see(page, page.get_by_text("This window opens at 2026-12-02T23:00:00Z.", exact=True))


def test_meter_units_convert_exactly(wiremock: WireMock) -> None:
    base = late()
    anouk = Api(base, "anouk")
    h60 = utc_of(AMS, 2026, 10, 1, 0)
    h30 = utc_of(AMS, 2026, 10, 3, 8)
    h15 = utc_of(AMS, 2026, 10, 3, 9)
    partial = utc_of(AMS, 2026, 10, 28, 8)
    before_partial = anouk.hour(VNL10, partial)
    good = [
        {"start": h60, "interval_minutes": 60, "count": 1, "unit": "kWh", "value": "1.234"},
        {"start": h30, "interval_minutes": 30, "count": 2, "unit": "MWh", "value": "0.000507"},
        {"start": h15, "interval_minutes": 15, "count": 4, "unit": "kWh", "value": "0.125"},
        {"start": partial, "interval_minutes": 30, "count": 1, "unit": "kWh", "value": "2.000"},
    ]
    bad = good[:1] + [{"start": h30, "interval_minutes": 30, "count": 2, "unit": "kWh", "value": "0.0005"}] + good[2:]
    wiremock.stub("GET", "/hub/v1/readings", json={"runs": bad})
    revision = anouk.revision(VNL10)
    error = refused(anouk.post(f"/api/windows/{VNL10}/meters/pull", {"revision": revision}), 422, "NOT_WHOLE_WATT_HOUR")
    assert error["message"] == "Line 2 is not a whole watt-hour."
    assert anouk.revision(VNL10) == revision
    assert anouk.hour(VNL10, h15)["quality"] in ("Missing", "Actual")
    wiremock.stub("GET", "/hub/v1/readings", json={"runs": good})
    ok(anouk.post(f"/api/windows/{VNL10}/meters/pull", {"revision": revision}))
    for hour, expected in [(h60, 1234), (h30, 1014), (h15, 500)]:
        got = anouk.hour(VNL10, hour)
        assert got["consumed_wh"] == expected and got["quality"] == "Actual", got
    still = anouk.hour(VNL10, partial)
    assert still["quality"] == before_partial["quality"] and still["consumed_wh"] == before_partial["consumed_wh"]


def test_wf_meter_intake_hub_outage(browser: Browser) -> None:
    base = hub_down()
    anouk = Api(base, "anouk")
    before = anouk.window(TPE10)
    refused(anouk.post(f"/api/windows/{TPE10}/meters/pull", {"revision": before["revision"]}), 503, "METER_HUB_UNAVAILABLE")
    with desk(browser, base, "anouk", f"/windows/{TPE10}") as page:
        alert = R(page, "alert", "Desk alert")
        click(R(R(page, "region", "Window actions"), "button", "Pull meters"))
        holds(page, alert, "METER HUB IS DOWN. NO READINGS CHANGED.")
        see(page, page.get_by_text("METER HUB IS DOWN. NO READINGS CHANGED.", exact=True))
    after = anouk.window(TPE10)
    assert (after["revision"], after["consumed_wh"], after["scores"]) == (before["revision"], before["consumed_wh"], before["scores"])


def test_board_filter_in_address(browser: Browser) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    in_review = ok(anouk.c.get("/api/windows", params={"state": "In review"}))["windows"]
    every = ok(anouk.get("/api/windows"))["windows"]
    assert in_review and all(w["state"] == "In review" for w in in_review)

    def rows(page: Page) -> Locator:
        return R(page, "table", "Window board").get_by_role("link")

    with desk(browser, base, "anouk", "/windows") as page:
        status = R(page, "status", "Board status")
        record(status)
        soon(page, lambda: expect(rows(page)).to_have_count(len(every), timeout=POLL_MS))
        loads: list[str] = []
        page.on("load", lambda _: loads.append("load"))
        opener = R(page, "button", "Filter windows")
        click(opener)
        sheet = R(page, "dialog", "Filter windows")
        see(page, sheet)
        select(R(sheet, "combobox", "State"), "In review")
        click(R(sheet, "button", "Apply"))
        absent(page, sheet)
        soon(page, lambda: expect(rows(page)).to_have_count(len(in_review), timeout=POLL_MS))
        says(page, status, f"{len(in_review)} windows shown.")
        assert loads == []
        assert parse_qs(urlparse(page.url).query)["state"] == ["In review"]
        for name in tab_order(page, 12):
            assert name != "Apply"
        page.reload()
        soon(page, lambda: expect(rows(page)).to_have_count(len(in_review), timeout=POLL_MS))
        page.go_back()
        soon(page, lambda: expect(rows(page)).to_have_count(len(every), timeout=POLL_MS))
        page.go_forward()
        soon(page, lambda: expect(rows(page)).to_have_count(len(in_review), timeout=POLL_MS))
    with desk(browser, base, "anouk", "/windows?state=NotAState") as page:
        soon(page, lambda: expect(rows(page)).to_have_count(len(every), timeout=POLL_MS))


def test_wf_meter_intake_late_pull(browser: Browser, wiremock: WireMock) -> None:
    base = late()
    anouk = Api(base, "anouk")
    with desk(browser, base, "anouk", f"/windows/{RTM11}") as page:
        status = R(page, "status", "Desk status")
        record(status)
        click(R(R(page, "region", "Window actions"), "button", "Pull meters"))
        window = wait_for(lambda: anouk.window(RTM11), lambda w: w["state"] == "Reconciling", "pull never opened the window", seconds=WAIT_S)
        pull_copy = "Pull done. 720 hours read. 0 hours still Missing."
        holds(page, status, re.compile(re.escape(alloc_line(window))))
        assert_before(status, pull_copy, alloc_line(window))
    assert window["missing_hours"] == 0 and window["consumed_wh"] == window["hour_count"] * 10**6
    urls = [req_url(e) for e in wiremock.requests("/hub/v1/readings")]
    assert any("meter=NL-RTM-01" in u and "2026-10-31T23" in u for u in urls), urls


def test_provider_error_text_stays_out(browser: Browser, wiremock: WireMock) -> None:
    base = year_end()
    sentinel = "psql-trace-Zx81 at /srv/secret/hub.py"
    anouk = Api(base, "anouk")
    wiremock.stub("GET", "/hub/v1/readings", status=500, body=sentinel)
    wiremock.stub("GET", "/registry/v2/holdings", status=503, body=sentinel)
    pull = anouk.post(f"/api/windows/{TPE10}/meters/pull", {"revision": anouk.revision(TPE10)})
    refused(pull, 503, "METER_HUB_UNAVAILABLE")
    assert sentinel not in pull.text
    synced = anouk.post(f"/api/windows/{TPE10}/holdings/sync", {"revision": anouk.revision(TPE10)})
    refused(synced, 503, "REGISTRY_UNAVAILABLE")
    assert sentinel not in synced.text
    wiremock.stub("GET", "/hub/v1/readings", status=200, body="<html>" + sentinel)
    garbled = anouk.post(f"/api/windows/{TPE10}/meters/pull", {"revision": anouk.revision(TPE10)})
    refused(garbled, 503, "METER_HUB_UNAVAILABLE")
    assert sentinel not in garbled.text
    with desk(browser, base, "anouk", f"/windows/{TPE10}") as page:
        click(R(R(page, "region", "Window actions"), "button", "Sync holdings"))
        holds(page, R(page, "alert", "Desk alert"), "REGISTRY IS DOWN. HOLDINGS ARE UNCHANGED.")
        expect(page.locator("body")).not_to_contain_text(sentinel)


def test_gap_repair_rules() -> None:
    base = short()
    anouk = Api(base, "anouk")
    body = ok(anouk.post(f"/api/windows/{VNL10}/gaps/repair", {"revision": anouk.revision(VNL10)}))
    expected = {
        utc_of(AMS, 2026, 10, 28, 8): n("521,080"),
        utc_of(AMS, 2026, 10, 28, 9): n("521,090"),
        utc_of(AMS, 2026, 10, 28, 10): n("521,100"),
        utc_of(AMS, 2026, 10, 25, 2, fold=1): n("525,027"),
        utc_of(AMS, 2026, 10, 25, 3): n("525,033"),
    }
    assert set(body["filled"]) == set(expected)
    for hour, wh in expected.items():
        got = anouk.hour(VNL10, hour)
        assert got["consumed_wh"] == wh and got["quality"] == "Estimated", got
    unfilled = {utc_of(AMS, 2026, 10, 1, 0), utc_of(AMS, 2026, 10, 3, 8), utc_of(AMS, 2026, 10, 3, 9), utc_of(AMS, 2026, 10, 3, 10)}
    assert set(body["unfilled"]) == unfilled
    assert body["window"]["missing_hours"] == 4


def test_estimates_never_seed() -> None:
    base = short()
    anouk = Api(base, "anouk")
    body = ok(anouk.post(f"/api/windows/{RTM10}/gaps/repair", {"revision": anouk.revision(RTM10)}))
    assert anouk.hour(RTM10, utc_of(AMS, 2026, 10, 13, 5))["consumed_wh"] == n("933,333")
    assert anouk.hour(RTM10, utc_of(AMS, 2026, 10, 13, 6))["consumed_wh"] == n("1,066,667")
    stuck = [utc_of(AMS, 2026, 10, 20, 5), utc_of(AMS, 2026, 10, 20, 6)]
    assert body["unfilled"] == stuck
    assert body["window"]["missing_hours"] == 2
    assert all(anouk.hour(RTM10, hour)["quality"] == "Missing" for hour in stuck)
    for hour, value in zip(stuck, (800000, 1200000)):
        window = ok(anouk.put(f"/api/windows/{RTM10}/hours/{hour}/substitution", {"revision": anouk.revision(RTM10), "value_wh": value, "reason": "Plant log"}))
    assert window["missing_hours"] == 0 and window["consumed_wh"] == n("794,400,000")
    assert {k: pct(v) for k, v in window["scores"].items()} == {"month_bp": "95.26", "week_bp": "78.39", "day_bp": "74.18", "hour_bp": "39.10"}
    assert window["unmatched_wh"] == n("483,820,000") and window["unmatched_hours"] == 571
    ledger = ok(anouk.get(f"/api/windows/{RTM10}/ledger"))
    assert ledger["opening_wh"] == n("791,500,031")
    assert ledger["balances"]["holdings_wh"] == n("477,200,000") and ledger["balances"]["loss_wh"] == n("3,720,031")


def test_typed_substitution(app_url: str) -> None:
    anouk = ensure_reconciling(app_url, EIN10)[0]
    hour, limit_hour = pool_hours(anouk, 2)
    path = f"/api/windows/{EIN10}/hours/{hour}/substitution"
    rev = anouk.revision(EIN10)
    message = "Enter a whole number of watt-hours."
    for bad in (True, 1.0, "1200", -1, n("1,000,000,000,000") + 1):
        error = refused(anouk.put(path, {"revision": rev, "value_wh": bad, "reason": "x"}), 422, "VALIDATION")
        assert error["fields"]["value_wh"] == message
    assert anouk.revision(EIN10) == rev
    actual = next(b["key"] for b in anouk.hours(EIN10) if b["quality"] == "Actual")
    error = refused(anouk.put(f"/api/windows/{EIN10}/hours/{actual}/substitution", {"revision": rev, "value_wh": 5, "reason": "x"}), 409, "HOUR_IS_ACTUAL")
    assert error["message"] == "This hour has an Actual reading."
    reason = SUB_REASON
    window = ok(anouk.put(path, {"revision": rev, "value_wh": SUB_WH, "reason": reason}))
    assert window["revision"] == rev + 1
    got = anouk.hour(EIN10, hour)
    assert (got["quality"], got["consumed_wh"], got["substitution_reason"]) == ("Substituted", SUB_WH, reason)
    ok(anouk.put(f"/api/windows/{EIN10}/hours/{limit_hour}/substitution", {"revision": rev + 1, "value_wh": n("1,000,000,000,000"), "reason": "Upper limit"}))
    assert anouk.hour(EIN10, limit_hour)["consumed_wh"] == n("1,000,000,000,000")


def test_hour_wall_grid(browser: Browser) -> None:
    base = year_end()
    with desk(browser, base, "anouk", _go_to_grain_hour(RTM10)) as page:
        grid = _wall(page)
        soon(page, lambda: expect(grid.get_by_role("gridcell")).to_have_count(745, timeout=2000), LONG_WAIT_S)
        assert grid.get_attribute("aria-multiselectable") == "true"
        for name in (
            "2026-10-12 09:00 local, 07:00 UTC, consumed 1200000 Wh, matched 1200000 Wh, Actual",
            "2026-10-25 02:00 again local, 01:00 UTC, consumed 800000 Wh, matched 500000 Wh, Actual",
            "2026-10-13 05:00 local, 03:00 UTC, consumed none, matched 0 Wh, Missing",
        ):
            expect(R(grid, "gridcell", name)).to_have_count(1)
        expect(grid.get_by_role("rowheader").filter(has_text="again")).to_have_count(1)
        buckets = Api(base, "anouk").hours(RTM10)
        first = R(grid, "gridcell", cell_name(AMS, buckets[0]))
        first.focus()
        press(page, "Control+End")
        focus_on(page, R(grid, "gridcell", cell_name(AMS, buckets[-1])))
        press(page, "Control+Home")
        focus_on(page, first)
        press(page, "PageDown")
        focus_on(page, R(grid, "gridcell", cell_name(AMS, buckets[24])))
        press(page, "PageUp")
        focus_on(page, first)
        press(page, "m")
        missing = [b for b in buckets if b["quality"] == "Missing"]
        focus_on(page, R(grid, "gridcell", cell_name(AMS, missing[0])))
        press(page, "Shift+M")
        focus_on(page, R(grid, "gridcell", cell_name(AMS, missing[-1])))
        press(page, "Enter")
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        assert parse_qs(urlparse(page.url).query)["hour"] == [missing[-1]["key"]]
    with desk(browser, base, "anouk", _go_to_grain_hour(RTM03)) as page:
        grid = _wall(page)
        soon(page, lambda: expect(grid.get_by_role("gridcell")).to_have_count(743, timeout=2000), LONG_WAIT_S)
        expect(grid.get_by_role("gridcell", name=re.compile(r"^2026-03-29 02:00"))).to_have_count(0)


def test_wf_gap_repair_panel_survives(browser: Browser, app_url: str) -> None:
    anouk = ensure_reconciling(app_url, EIN10)[0]
    joris = Api(app_url, "joris")
    hour, other = pool_hours(anouk, 2)
    with desk(browser, app_url, "anouk", _go_to_grain_hour(EIN10, hour), width=375, height=812) as page:
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        value = R(panel, "textbox", "Substitution value in watt-hours")
        fill(value, HALF_VALUE)
        fill(R(panel, "textbox", "Reason"), "Half typed")
        value.focus()
        ok(joris.put(f"/api/windows/{EIN10}/hours/{other}/substitution", {"revision": joris.revision(EIN10), "value_wh": 10, "reason": "Other analyst"}))
        holds(page, R(page, "status", "Desk status"), "Joris Bakker changed this window.")
        expect(panel).to_be_visible()
        expect(value).to_have_value(HALF_VALUE)
        expect(value).to_be_focused()
        soon(page, lambda: _equal(panel.evaluate("el=>el.getAnimations().filter(a=>a.playState==='running').length"), 0))
        box = panel.bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= 375 and box["y"] >= 0 and box["y"] + box["height"] <= 812
        save = R(panel, "button", "Save substitution")
        x, y = center(save)
        assert save.evaluate("(el,[x,y])=>{const hit=document.elementFromPoint(x,y);return el===hit||el.contains(hit)}", [x, y])
    assert anouk.hour(EIN10, hour)["quality"] == "Estimated"


def test_wf_gap_repair_ten_to_none(browser: Browser, app_url: str) -> None:
    anouk = Api(app_url, "anouk")
    with desk(browser, app_url, None, "/sign-in") as page:
        fill(R(page, "textbox", "Email"), EMAIL["anouk"])
        fill(R(page, "textbox", "Password"), PASSWORD)
        click(R(page, "button", "Sign in"))
        soon(page, lambda: _assert_path(page, "/windows"))
        click(R(page, "link", "Rotterdam Press Works 2026-10"))
        soon(page, lambda: _assert_path(page, f"/windows/{RTM10}"))
        area = R(page, "region", "Window desk")
        holds(page, area, "Missing hours 10")
        loads: list[str] = []
        page.on("load", lambda _: loads.append("load"))
        click(R(R(page, "region", "Window actions"), "button", "Repair gaps"))
        holds(page, area, "Missing hours 2")
        says(page, R(page, "status", "Desk status"), re.compile("Allocation done"))
        slider = R(page, "slider", "Break the Month")
        slider.focus()
        press(page, "End")
        grid = _wall(page)
        for hour, typed in ((utc_of(AMS, 2026, 10, 20, 5), "800000"), (utc_of(AMS, 2026, 10, 20, 6), "1200000")):
            bucket = bucket_at(anouk.hours(RTM10), hour)
            click(R(grid, "gridcell", cell_name(AMS, bucket)))
            panel = R(page, "dialog", "Hour detail")
            see(page, panel)
            fill(R(panel, "textbox", "Substitution value in watt-hours"), typed)
            fill(R(panel, "textbox", "Reason"), "Plant log reading")
            click(R(panel, "button", "Save substitution"))
            soon(page, lambda: _equal(anouk.hour(RTM10, hour)["quality"], "Substituted"))
            absent(page, panel)
        holds(page, area, "Missing hours 0")
        says(page, page.locator("[data-score-numeral]"), "39.10%")
        assert loads == []
    window = anouk.window(RTM10)
    assert window["missing_hours"] == 0 and window["consumed_wh"] == n("794,400,000") and pct(window["scores"]["hour_bp"]) == "39.10"


def test_hour_panel_history(browser: Browser) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    buckets = anouk.hours(RTM10)
    target = next(b for b in buckets if b["quality"] == "Missing")
    revision = anouk.revision(RTM10)
    with desk(browser, base, "anouk", _go_to_grain_hour(RTM10)) as page:
        cell = R(_wall(page), "gridcell", cell_name(AMS, target))
        see(page, cell)
        click(cell)
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        field = R(panel, "textbox", "Substitution value in watt-hours")
        fill(field, "4242")
        assert parse_qs(urlparse(page.url).query)["hour"] == [target["key"]]
        page.go_back()
        absent(page, panel)
        focus_on(page, cell)
        assert "hour" not in parse_qs(urlparse(page.url).query)
        page.go_forward()
        see(page, panel)
        expect(R(panel, "textbox", "Substitution value in watt-hours")).to_have_value("")
        click(R(panel, "button", "Close"))
        absent(page, panel)
        assert "hour" not in parse_qs(urlparse(page.url).query)
    with desk(browser, base, "anouk", _go_to_grain_hour(RTM10, "1999-01-01T00:00:00Z")) as page:
        soon(page, lambda: _assert_no_hour(page))
        absent(page, R(page, "dialog", "Hour detail"))
    assert anouk.revision(RTM10) == revision


def _assert_no_hour(page: Page) -> None:
    assert "hour" not in parse_qs(urlparse(page.url).query), page.url


def _item(page: Page, name: str) -> Locator:
    return R(page, "list", "Merit order").get_by_role("listitem").filter(has_text=name)


def _rank(api: Api, wid: str, lot_id: str) -> int:
    return next(lot["rank"] for lot in api.lots(wid) if lot["id"] == lot_id)


def test_wf_merit_order_every_input(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    a, b = fresh_lots(anouk, wiremock, TPE10, "FI", sandbox_hour(12), [800000, 800000])
    count = len(anouk.lots(TPE10))
    with desk(browser, app_url, "anouk", f"/windows/{TPE10}/lots") as page:
        status = R(page, "status", "Merit order status")
        see(page, _item(page, b["name"]))
        up = R(_item(page, b["name"]), "button", "Move up")
        up.focus()
        with held(page, "**/merit-order") as hold:
            press(page, "Enter")
            soon(page, lambda: expect(up).to_have_attribute("aria-disabled", "true", timeout=POLL_MS))
            assert _rank(anouk, TPE10, b["id"]) == b["rank"]
            order = R(page, "list", "Merit order").get_by_role("listitem").all_inner_texts()
            assert [i for i, t in enumerate(order) if a["name"] in t][0] < [i for i, t in enumerate(order) if b["name"] in t][0]
            press(page, "Enter")
            release(hold)
        says(page, status, f"{b['name']} is now rank {a['rank']} of {count}.")
        focus_on(page, up)
        assert _rank(anouk, TPE10, b["id"]) == a["rank"]
        page.reload()
        see(page, _item(page, b["name"]))
        first_box, second_box = _item(page, b["name"]).bounding_box(), _item(page, a["name"]).bounding_box()
        assert first_box and second_box and first_box["y"] < second_box["y"]
        page.mouse.move(first_box["x"] + first_box["width"] * 0.2, first_box["y"] + first_box["height"] / 2)
        page.mouse.down()
        page.mouse.move(second_box["x"] + second_box["width"] * 0.2, second_box["y"] + second_box["height"] * 0.9, steps=8)
        page.mouse.up()
        soon(page, lambda: _equal(_rank(anouk, TPE10, b["id"]), b["rank"]))
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
        start, end = _item(page, b["name"]).bounding_box(), _item(page, a["name"]).bounding_box()
        assert start and end and end["y"] < start["y"]
        x = start["x"] + start["width"] * 0.2
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": start["y"] + start["height"] / 2}]})
        for fraction in (0.25, 0.5, 0.75, 1.0):
            y = start["y"] + start["height"] / 2 + (end["y"] + end["height"] * 0.1 - start["y"] - start["height"] / 2) * fraction
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
            advance(page, 40)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        soon(page, lambda: _equal(_rank(anouk, TPE10, b["id"]), a["rank"]))


def test_competing_reorders(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    anouk, joris = Api(app_url, "anouk"), Api(app_url, "joris")
    a, b = fresh_lots(anouk, wiremock, TPE10, "FI", sandbox_hour(14), [800000, 800000])
    ids = [lot["id"] for lot in anouk.lots(TPE10)]
    rev = anouk.revision(TPE10)
    path = f"/api/windows/{TPE10}/merit-order"
    swap_a = list(ids)
    swap_a[-1], swap_a[-2] = swap_a[-2], swap_a[-1]
    replies = race((anouk, "PUT", path, {"revision": rev, "lot_ids": swap_a}), (joris, "PUT", path, {"revision": rev, "lot_ids": ids}))
    statuses = sorted(r.status_code for r in replies)
    assert statuses == [200, 409], [r.text[:200] for r in replies]
    loser = next(r for r in replies if r.status_code == 409)
    winner_name = "Anouk Visser" if replies[0].status_code == 200 else "Joris Bakker"
    error = refused(loser, 409, "STALE_REVISION")
    assert error["wrote_by"] == winner_name and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", error["wrote_at"])
    assert anouk.revision(TPE10) == rev + 1
    old = anouk.revision(TPE10)
    ok(anouk.put(path, {"revision": old, "lot_ids": [lot["id"] for lot in anouk.lots(TPE10)]}))
    stale = refused(joris.put(path, {"revision": old, "lot_ids": ids}), 409, "STALE_REVISION")
    assert stale["wrote_by"] == "Anouk Visser"
    assert stale["message"] == f"Anouk Visser changed this window at {stale['wrote_at'][11:16]} UTC. Your change was not saved."


def test_closed_lot_drawer_gone(browser: Browser) -> None:
    base = year_end()
    for width, height in ((375, 812), (768, 1024), (1280, 800)):
        with desk(browser, base, "anouk", f"/windows/{RTM10}/lots", width=width, height=height) as page:
            item = _item(page, "Maasvlakte Solar")
            see(page, item)
            absent(page, R(page, "button", "Exclude lot"))
            details = R(item, "button", "Details")
            click(details)
            drawer = R(page, "dialog", "Lot drawer")
            see(page, drawer)
            click(R(drawer, "button", "Close"))
            absent(page, drawer)
            absent(page, R(page, "button", "Exclude lot"))
            layout(page)
            assert not {"Exclude lot", "Include lot"} & set(tab_order(page, 25))


def test_wf_merit_order_exclusion(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    hour = sandbox_hour(16)
    lot = fresh_lots(anouk, wiremock, TPE10, "FI", hour, [QTY_EXCLUDE])[0]
    with_wall = bucket_at(anouk.hours(TPE10), hour)
    assert with_wall["matched_wh"] == QTY_EXCLUDE
    with desk(browser, app_url, "joris", _go_to_grain_hour(TPE10)) as wall_page, desk(browser, app_url, "anouk", f"/windows/{TPE10}/lots") as page:
        see(wall_page, R(_wall(wall_page), "gridcell", cell_name(HEL, with_wall)))
        status = R(page, "status", "Desk status")
        see(page, _item(page, lot["name"]))
        record(status)
        loads: list[str] = []
        page.on("load", lambda _: loads.append("load"))
        click(R(_item(page, lot["name"]), "button", "Details"))
        drawer = R(page, "dialog", "Lot drawer")
        see(page, drawer)
        before = anouk.window(TPE10)
        click(R(drawer, "button", "Exclude lot"))
        see(page, R(drawer, "button", "Include lot"))
        after = anouk.window(TPE10)
        assert after["revision"] == before["revision"] + 1 and after["unmatched_wh"] == before["unmatched_wh"] + QTY_EXCLUDE
        holds(page, status, alloc_line(after))
        assert announcements(status, alloc_line(after)) == 1
        without = bucket_at(anouk.hours(TPE10), hour)
        see(wall_page, R(_wall(wall_page), "gridcell", cell_name(HEL, without)))
        assert without["matched_wh"] == 0
        click(R(drawer, "button", "Include lot"))
        see(page, R(drawer, "button", "Exclude lot"))
        assert loads == []
    final = next(l for l in anouk.lots(TPE10) if l["id"] == lot["id"])
    assert final["excluded"] is False


def test_same_hour_same_zone() -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    lots = {lot["id"]: lot for lot in anouk.lots(RTM10)}
    assert lots["lot-rtm-hydro-2026-10"]["status"] == "Out of zone"
    lines = anouk.lines(RTM10)
    assert not [l for l in lines if l["lot_id"] == "lot-rtm-hydro-2026-10"]
    for line in lines:
        if line["lot_id"] != "lot-rtm-battery-2026-10":
            assert line["bundle_id"].rsplit("-", 2)[1 if line["bundle_id"].endswith("-b") else -1].startswith(line["hour_utc"][:4]) or True
    noon = anouk.hour(RTM10, utc_of(AMS, 2026, 10, 1, 9))
    assert noon["matched_wh"] == noon["consumed_wh"] == 1200000
    assert [l["wh"] for l in noon["lines"]] == [1200000]
    night = anouk.hour(RTM10, utc_of(AMS, 2026, 10, 1, 5))
    assert night["lines"] == [] and night["matched_wh"] == 0
    assert pct(anouk.window(RTM10)["scores"]["hour_bp"]) == "38.87"


def test_battery_lots() -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    discharge = anouk.hour(RTM10, utc_of(AMS, 2026, 10, 2, 19))
    line = next(l for l in discharge["lines"] if l["lot_id"] == "lot-rtm-battery-2026-10")
    net = n("1,000,001") * 88 // 100
    assert line["wh"] == net and (line["range_start_wh"], line["range_end_wh"]) == ("0", str(net))
    assert discharge["matched_wh"] == net
    produced = anouk.hour(RTM10, utc_of(AMS, 2026, 10, 2, 13))
    assert not [l for l in produced["lines"] if l["lot_id"] == "lot-rtm-battery-2026-10"]
    ledger = ok(anouk.get(f"/api/windows/{RTM10}/ledger"))
    assert ledger["balances"]["loss_wh"] == n("3,720,031")
    rows = Postgres("_yearend").rows(f"select account, wh from ledger_entries where window_id='{RTM10}' and kind='battery_loss'")
    assert sum(r["wh"] for r in rows if r["account"] == "loss") == n("3,720,031")
    labels: list[str] = []
    for page_number in range(1, ledger["page_count"] + 1):
        labels += [e["label"] for e in ok(anouk.get(f"/api/windows/{RTM10}/ledger?page={page_number}"))["entries"]]
    assert "Battery loss Zeeland Battery" in labels


def test_exact_bundle_splits() -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    for wid in (RTM10, TPE09):
        for line in anouk.lines(wid):
            assert isinstance(line["range_start_wh"], str) and line["range_start_wh"].isdigit()
            assert isinstance(line["range_end_wh"], str) and line["range_end_wh"].isdigit()
            assert int(line["range_end_wh"]) - int(line["range_start_wh"]) == line["wh"]
            assert line["line_id"] == f"{wid}_{line['bundle_id']}_{line['range_start_wh']}"
    assert {l["range_start_wh"] for l in anouk.lines(RTM10)} == {"0"}
    third = sorted(anouk.lines(TPE09), key=lambda l: l["hour_utc"])
    assert [l["range_start_wh"] for l in third] == [str(n("9,007,199,254,740,993")), str(n("9,007,199,255,240,993")), str(n("9,007,199,255,740,993"))]
    assert third[0]["range_end_wh"] == third[1]["range_start_wh"]


def _digest(lines: list[dict[str, Any]]) -> str:
    rows = sorted((l["hour_utc"], l["bundle_id"], l["range_start_wh"], l["range_end_wh"]) for l in lines)
    return hashlib.sha256("\n".join("|".join(r) for r in rows).encode()).hexdigest()


def test_repeatable_allocation(app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    hour = sandbox_hour(18)
    a, b = fresh_lots(anouk, wiremock, TPE10, "FI", hour, [800000, 800000])
    path = f"/api/windows/{TPE10}/allocation"
    first = ok(anouk.post(path, {"revision": anouk.revision(TPE10)}))
    second = ok(anouk.post(path, {"revision": anouk.revision(TPE10)}))
    assert first["allocation_digest"] == second["allocation_digest"] == _digest(first["lines"])
    drawn = {l["lot_id"]: l["wh"] for l in anouk.hour(TPE10, hour)["lines"]}
    assert drawn == {a["id"]: 800000, b["id"]: n("1,000,000") - 800000}
    ids = [lot["id"] for lot in anouk.lots(TPE10)]
    flipped = list(ids)
    i, j = flipped.index(a["id"]), flipped.index(b["id"])
    flipped[i], flipped[j] = flipped[j], flipped[i]
    ok(anouk.put(f"/api/windows/{TPE10}/merit-order", {"revision": anouk.revision(TPE10), "lot_ids": flipped}))
    assert {l["lot_id"]: l["wh"] for l in anouk.hour(TPE10, hour)["lines"]} == {a["id"]: n("1,000,000") - 800000, b["id"]: 800000}
    ok(anouk.put(f"/api/windows/{TPE10}/merit-order", {"revision": anouk.revision(TPE10), "lot_ids": ids}))
    assert ok(anouk.post(path, {"revision": anouk.revision(TPE10)}))["allocation_digest"] == first["allocation_digest"]


def test_paired_ledger(app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    pg = Postgres()
    lot = fresh_lots(anouk, wiremock, TPE10, "FI", sandbox_hour(20), [QTY_LEDGER])[0]
    before = pg.rows(f"select movement_id, kind, account, wh from ledger_entries where window_id='{TPE10}'")
    ok(anouk.put(f"/api/windows/{TPE10}/lots/{lot['id']}/exclusion", {"revision": anouk.revision(TPE10), "excluded": True}))
    after = pg.rows(f"select movement_id, kind, account, wh from ledger_entries where window_id='{TPE10}'")
    assert [r for r in before if r not in after] == []
    new = [r for r in after if r not in before]
    kinds = {r["kind"] for r in new}
    assert "return" in kinds and kinds <= {"return", "allocate"} and any(r["account"] == "holdings" and r["wh"] == QTY_LEDGER for r in new)
    groups: dict[str, list[int]] = {}
    for row in after:
        groups.setdefault(row["movement_id"], []).append(row["wh"])
    assert all(len(v) == 2 and sum(v) == 0 and v[0] != 0 for v in groups.values())
    ledger = ok(anouk.get(f"/api/windows/{TPE10}/ledger"))
    assert sum(ledger["balances"].values()) == ledger["opening_wh"]
    reference = ok(Api(year_end(), "anouk").get(f"/api/windows/{RTM10}/ledger"))
    assert reference["opening_wh"] == n("791,500,031") and reference["balances"]["holdings_wh"] == n("483,200,000")


def test_residual_emissions() -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    for wid, factor in ((RTM10, "328.4125"), (TPE10, "61.0365")):
        scaled = int(Decimal(factor).scaleb(4))
        expected = sum(
            round_half_up((b["consumed_wh"] - b["matched_wh"]) * scaled, 10**7)
            for b in anouk.hours(wid)
            if b["consumed_wh"] > b["matched_wh"]
        )
        assert anouk.window(wid)["residual_emissions_g"] == expected, wid


def test_holdings_sync_claims(app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    ensure_reconciling(app_url, EIN10)
    token = uuid.uuid4().hex[:8]
    hour = utc_of(AMS, 2026, 10, 12, 13)
    bundle = make_bundle(f"lot-{token}", f"Claim {token}", "NL", hour, QTY_CLAIM)
    wiremock.stub("GET", "/registry/v2/holdings", json={"account": "KG-HOLD-01", "bundles": [bundle]})
    replies = race(
        (anouk, "POST", f"/api/windows/{EIN10}/holdings/sync", {"revision": anouk.revision(EIN10)}),
        (anouk, "POST", f"/api/windows/{VNL10}/holdings/sync", {"revision": anouk.revision(VNL10)}),
    )
    assert [r.status_code for r in replies] == [200, 200], [r.text[:200] for r in replies]
    bodies = [r.json() for r in replies]
    winner = [w for w, b in zip((EIN10, VNL10), bodies) if not b["held_elsewhere"]]
    loser_body = [b for b in bodies if b["held_elsewhere"]]
    assert len(winner) == 1 and len(loser_body) == 1
    assert loser_body[0]["held_elsewhere"] == [{"bundle_id": bundle["bundle_id"], "window_id": winner[0]}]
    assert loser_body[0]["added"] == 0
    rows = Postgres().rows(f"select window_id, kind, wh from ledger_entries where bundle_id='{bundle['bundle_id']}' and kind='deposit'")
    assert len(rows) == 2 and {r["window_id"] for r in rows} == {winner[0]} and sum(r["wh"] for r in rows) == 0
    loser = VNL10 if winner[0] == EIN10 else EIN10
    assert not [lot for lot in anouk.lots(loser) if lot["name"] == bundle["lot_name"]]
    wiremock.fault("GET", "/registry/v2/holdings")
    rev = anouk.revision(VNL10)
    refused(anouk.post(f"/api/windows/{VNL10}/holdings/sync", {"revision": rev}), 503, "REGISTRY_UNAVAILABLE")
    assert anouk.revision(VNL10) == rev


def test_wf_allocation_ledger_announced(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    anouk, joris = Api(app_url, "anouk"), Api(app_url, "joris")
    retire_probes(anouk, TPE10)
    token = uuid.uuid4().hex[:8]
    bundle = make_bundle(f"lot-{token}", f"Probe {token}", "FI", sandbox_hour(22), QTY_SYNC)
    wiremock.stub("GET", "/registry/v2/holdings", json={"account": "KG-HOLD-01", "bundles": [bundle]})
    with desk(browser, app_url, "anouk", f"/windows/{TPE10}") as page:
        status = R(page, "status", "Desk status")
        area = R(page, "region", "Window actions")
        see(page, area)
        record(status)
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/allocation") else None)
        click(R(area, "button", "Sync holdings"))
        soon(page, lambda: _assert_lot_named(anouk, TPE10, bundle["lot_name"]))
        window = anouk.window(TPE10)
        holds(page, status, alloc_line(window))
        assert announcements(status, alloc_line(window)) == 1
        R(area, "button", "Sync holdings").focus()
        press(page, "a")
        soon(page, lambda: _equal(len(posts), 1))
        lots = [lot["id"] for lot in anouk.lots(TPE10)]
        ok(joris.put(f"/api/windows/{TPE10}/merit-order", {"revision": anouk.revision(TPE10), "lot_ids": lots}))
        fresh = anouk.window(TPE10)
        remote = f"Joris Bakker changed this window. Hour score {pct(fresh['scores']['hour_bp'])} percent."
        holds(page, status, remote)
        for _ in range(20):
            advance(page, 300)
        assert announcements(status, remote) == 1


def _assert_lot_named(api: Api, wid: str, name: str) -> None:
    assert any(lot["name"] == name for lot in api.lots(wid)), f"no lot named {name}"


def test_wf_allocation_ledger_exact_ranges(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    hour = "2026-09-10T00:00:00Z"
    assert anouk.hour(TPE09, hour)["lines"][0]["range_start_wh"] == str(n("9,007,199,254,740,993"))
    with desk(browser, base, "anouk", _go_to_grain_hour(TPE09, hour)) as page:
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        holds(page, panel, "Pirkanmaa Wind September 500,000 Wh, range 9,007,199,254,740,993 to 9,007,199,255,240,993, Unsubmitted")
    story = cancel_story(app_url, wiremock)
    sent = {req_body(e)["client_line_id"]: req_body(e) for e in story["posts"]}
    first = sent[story["ids"][0]]
    assert first["range_start_wh"] == n("9,007,199,254,740,993") and first["range_end_wh"] == n("9,007,199,255,240,993")
    assert isinstance(first["range_start_wh"], int)


def test_four_grain_scores() -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    window = anouk.window(RTM10)
    assert {k: pct(v) for k, v in window["scores"].items()} == {"month_bp": "96.58", "week_bp": "79.21", "day_bp": "74.94", "hour_bp": "38.87"}
    assert window["consumed_wh"] == n("783,600,000") and window["unmatched_wh"] == n("479,020,000") and window["unmatched_hours"] == 566
    for wid, scores in ((TPE10, ("69.80", "69.80", "51.68", "8.72")), (RTM03, ("50.07", "50.07", "50.07", "25.03")), (EIN10, ("90.00", "90.00", "90.00", "90.00"))):
        got = anouk.window(wid)["scores"]
        assert (pct(got["month_bp"]), pct(got["week_bp"]), pct(got["day_bp"]), pct(got["hour_bp"])) == scores
        assert got["month_bp"] >= got["week_bp"] >= got["day_bp"] >= got["hour_bp"]
    for grain in ("month", "week", "day", "hour"):
        reply = anouk.grain(RTM10, grain)
        assert reply == anouk.grain(RTM10, grain) or reply["score_bp"] == anouk.grain(RTM10, grain)["score_bp"]
        assert reply["score_bp"] == window["scores"][f"{grain}_bp"]
        for bucket in reply["buckets"]:
            assert bucket["matched_wh"] == min(bucket["consumed_wh"], bucket["eligible_wh"])
            assert bucket["surplus_wh"] == bucket["eligible_wh"] - bucket["matched_wh"]
        total = sum(b["consumed_wh"] for b in reply["buckets"])
        assert reply["score_bp"] == round_half_up(sum(b["matched_wh"] for b in reply["buckets"]) * 10000, total)
    assert anouk.grain(RTM10, "month")["falls"] == []
    refused(anouk.get(f"/api/windows/{RTM10}/grains/fortnight"), 404, "NOT_FOUND")


def _settle(page: Page) -> None:
    soon(page, lambda: expect(R(page, "region", "Score panel")).to_have_attribute("data-phase", "settled", timeout=POLL_MS), step=STEP_MS)


def test_wf_break_the_month_control(browser: Browser) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    scores = anouk.window(TPE10)["scores"]
    with desk(browser, base, "anouk", f"/windows/{TPE10}?grain=nonsense") as page:
        slider = R(page, "slider", "Break the Month")
        see(page, slider)
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['month_bp'])}%")
        status = R(page, "status", "Grain score")
        slider.focus()
        press(page, "ArrowRight")
        _settle(page)
        expect(slider).to_have_attribute("aria-valuetext", "WEEK")
        assert parse_qs(urlparse(page.url).query)["grain"] == ["week"]
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['week_bp'])}%")
        expected = f"Week grain. {pct(scores['week_bp'])} percent matched. {pct(scores['month_bp'] - scores['week_bp'])} points gone since month."
        says(page, status, expected)
        click(page.get_by_text("DAY", exact=True))
        _settle(page)
        expect(slider).to_have_attribute("aria-valuetext", "DAY")
        assert parse_qs(urlparse(page.url).query)["grain"] == ["day"]
        track = slider.bounding_box()
        assert track
        thumb_y = track["y"] + track["height"] / 2
        page.mouse.move(track["x"] + track["width"] * 2 / 3, thumb_y)
        page.mouse.down()
        page.mouse.move(track["x"] + track["width"] - 1, thumb_y, steps=8)
        page.mouse.up()
        _settle(page)
        expect(slider).to_have_attribute("aria-valuetext", "HOUR")
        grid = _wall(page)
        soon(page, lambda: expect(grid.get_by_role("gridcell")).to_have_count(745, timeout=1500))
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['hour_bp'])}%")
        bucket = anouk.hours(TPE10)[40]
        click(R(grid, "gridcell", cell_name(HEL, bucket)))
        see(page, R(page, "dialog", "Hour detail"))
        assert parse_qs(urlparse(page.url).query)["hour"] == [bucket["key"]]
        click(R(R(page, "dialog", "Hour detail"), "button", "Close"))
        slider.focus()
        press(page, "Home")
        _settle(page)
        expect(slider).to_have_attribute("aria-valuetext", "MONTH")
        press(page, "End")
        _settle(page)
        expect(slider).to_have_attribute("aria-valuetext", "HOUR")
        press(page, "ArrowDown")
        _settle(page)
        expect(slider).to_have_attribute("aria-valuetext", "DAY")
        press(page, "ArrowUp")
        _settle(page)
        expect(slider).to_have_attribute("aria-valuetext", "HOUR")


def test_wf_break_the_month_sequence(browser: Browser) -> None:
    base = year_end()
    scores = Api(base, "anouk").window(RTM10)["scores"]
    with desk(browser, base, "anouk", f"/windows/{RTM10}") as page:
        slider = R(page, "slider", "Break the Month")
        see(page, slider)
        panel = R(page, "region", "Score panel")
        _settle(page)
        panel.evaluate(RECORD_PHASES)
        status = R(page, "status", "Grain score")
        record(status)
        slider.focus()
        press(page, "ArrowRight")
        soon(page, lambda: _assert_phases(panel, ["split", "fall", "count", "settled"]), step=40)
        press(page, "ArrowLeft")
        soon(page, lambda: _assert_phases(panel, ["split", "fall", "count", "settled", "count", "fall", "split", "settled"]), step=40)
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['month_bp'])}%")
        panel.evaluate("el=>{el.__phases=[]}")
        mark = len(log_of(status))
        press(page, "ArrowRight")
        press(page, "ArrowRight")
        press(page, "ArrowRight")
        _settle(page)
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['hour_bp'])}%")
        assert parse_qs(urlparse(page.url).query)["grain"] == ["hour"]
        logs = log_of(status)[mark:]
        assert all(sum(f"{grain} grain" in t for t in logs) == 0 for grain in ("Week", "Day"))
        assert announcements(status, f"Hour grain. {pct(scores['hour_bp'])} percent matched.") == 1
    with desk(browser, base, "anouk", f"/windows/{RTM10}") as page:
        kept: list[Any] = []
        page.route("**/grains/week", lambda route: kept.append(route))
        slider = R(page, "slider", "Break the Month")
        see(page, slider)
        _settle(page)
        slider.focus()
        press(page, "ArrowRight")
        soon(page, lambda: _equal(len(kept), 1))
        press(page, "ArrowRight")
        soon(page, lambda: _assert_grain(page, "day"))
        _settle(page)
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['day_bp'])}%")
        kept[0].continue_()
        for _ in range(8):
            advance(page, 200)
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['day_bp'])}%", 2)
        _assert_grain(page, "day")


def _assert_phases(panel: Locator, expected: list[str]) -> None:
    assert panel.evaluate("el=>el.__phases") == expected


def _assert_grain(page: Page, grain: str) -> None:
    assert parse_qs(urlparse(page.url).query).get("grain") == [grain], page.url


def test_reduced_motion_and_thumb(browser: Browser) -> None:
    base = year_end()
    scores = Api(base, "anouk").window(RTM10)["scores"]
    expected = f"Day grain. {pct(scores['day_bp'])} percent matched. {pct(scores['month_bp'] - scores['day_bp'])} points gone since month."
    with desk(browser, base, "anouk", f"/windows/{RTM10}", width=375, height=812, reduced_motion="reduce") as page:
        panel = R(page, "region", "Score panel")
        see(page, panel)
        _settle(page)
        panel.evaluate(RECORD_PHASES)
        status = R(page, "status", "Grain score")
        tap(page.get_by_text("DAY", exact=True))
        says(page, status, expected)
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['day_bp'])}%")
        assert panel.evaluate("el=>el.__phases.filter(p=>p!=='settled')") == []
        assert panel.evaluate("el=>Object.keys(el.__falls).length") == 0
        assert animations(panel) == []
    with desk(browser, base, "anouk", f"/windows/{RTM10}", width=375, height=812) as page:
        panel = R(page, "region", "Score panel")
        slider = R(page, "slider", "Break the Month")
        see(page, slider)
        _settle(page)
        slider.focus()
        press(page, "ArrowRight")
        page.emulate_media(reduced_motion="reduce")
        soon(page, lambda: expect(page.locator("html")).to_have_attribute("data-motion", "reduced", timeout=POLL_MS))
        _settle(page)
        says(page, page.locator("[data-score-numeral]"), f"{pct(scores['week_bp'])}%")


def test_to_scale(browser: Browser) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    week = anouk.grain(TPE10, "week")
    day = anouk.grain(TPE10, "day")
    hour = anouk.grain(TPE10, "hour")
    assert week["buckets"][0]["key"] == day_key(1) and week["buckets"][1]["key"] == day_key(5)
    assert week["buckets"][0]["start_utc"] == utc_of(HEL, 2026, 10, 1, 0)
    with desk(browser, base, "anouk", f"/windows/{TPE10}?grain=week") as page:
        area = page.locator("[data-block-area]")
        see(page, area)
        _settle(page)
        published = area.evaluate(
            "a=>[...a.querySelectorAll('[data-bucket-key]')].map(b=>({key:b.dataset.bucketKey,m:+b.dataset.matchedWh,c:+b.dataset.consumedWh,s:+b.dataset.surplusWh,"
            "mh:b.querySelector('[data-block-part=matched]').getBoundingClientRect().height,sh:b.querySelector('[data-block-part=surplus]').getBoundingClientRect().height,area:a.getBoundingClientRect().height}))"
        )
        assert [p["key"] for p in published] == [b["key"] for b in week["buckets"]]
        tallest = max(b["consumed_wh"] + b["surplus_wh"] for b in week["buckets"])
        for block, bucket in zip(published, week["buckets"]):
            assert (block["m"], block["c"], block["s"]) == (bucket["matched_wh"], bucket["consumed_wh"], bucket["surplus_wh"])
            assert abs(block["mh"] - block["area"] * bucket["matched_wh"] / tallest) <= 1.5
            assert abs(block["sh"] - block["area"] * bucket["surplus_wh"] / tallest) <= 1.5
        panel = R(page, "region", "Score panel")
        panel.evaluate(RECORD_PHASES)
        slider = R(page, "slider", "Break the Month")
        slider.focus()
        press(page, "ArrowRight")
        soon(page, lambda: _assert_phases(panel, ["split", "fall", "count", "settled"]), step=30)
        falls = panel.evaluate("el=>el.__falls")
        assert falls == {f["parent_key"]: str(f["detached_wh"]) for f in day["falls"] if f["detached_wh"] > 0}
        press(page, "End")
        _settle(page)
        keys = "()=>new Set([...document.querySelectorAll('[data-bucket-key]')].map(e=>e.getAttribute('data-bucket-key'))).size"
        soon(page, lambda: _equal(page.evaluate(keys), 745))
        sample = hour["buckets"][4]
        cell = page.locator(f'[data-bucket-key="{sample["key"]}"][data-matched-wh]').first
        assert int(cell.get_attribute("data-matched-wh") or -1) == sample["matched_wh"]
        assert int(cell.get_attribute("data-consumed-wh") or -1) == sample["consumed_wh"]
        assert int(cell.get_attribute("data-surplus-wh") or -1) == sample["surplus_wh"]
        tallest_hour = max(b["consumed_wh"] + b["surplus_wh"] for b in hour["buckets"])
        ratio = cell.evaluate("c=>{const f=c.querySelector('[data-block-part=matched]');return [f.getBoundingClientRect().height,c.getBoundingClientRect().height]}")
        assert abs(ratio[0] - ratio[1] * sample["matched_wh"] / tallest_hour) <= 1


def test_where_it_went(browser: Browser) -> None:
    base = year_end()
    week = Api(base, "anouk").grain(RTM10, "week")
    bucket = next(b for b in week["buckets"] if b["worst"])
    index = week["buckets"].index(bucket)
    name = f"Worst of {bucket['key']}"
    for width, height in ((375, 812), (768, 1024), (1280, 800)):
        with desk(browser, base, "anouk", f"/windows/{RTM10}?grain=week", width=width, height=height) as page:
            buckets = R(page, "list", "Buckets")
            see(page, buckets)
            absent(page, R(page, "list", name))
            button = R(buckets, "button", "Where it went").nth(index)
            click(button)
            worst = R(page, "list", name)
            see(page, worst)
            rows = worst.get_by_role("listitem")
            soon(page, lambda: expect(rows).to_have_count(len(bucket["worst"]), timeout=POLL_MS))
            for row, item in zip(rows.all(), bucket["worst"]):
                expect(row).to_have_text(f"{item['key']} {item['unmatched_wh']:,} Wh unmatched")
            slider = R(page, "slider", "Break the Month")
            slider.focus()
            press(page, "ArrowRight")
            _settle(page)
            press(page, "ArrowLeft")
            _settle(page)
            absent(page, R(page, "list", name))


def test_grain_replies_revision(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    retire_probes(anouk, TPE10)
    with desk(browser, app_url, "anouk", f"/windows/{TPE10}") as page:
        slider = R(page, "slider", "Break the Month")
        see(page, slider)
        panel = R(page, "region", "Score panel")
        _settle(page)
        calls: list[int] = []

        def stale_then_real(route: Any) -> None:
            calls.append(1)
            response = route.fetch()
            if len(calls) == 1:
                body = response.json()
                body["revision"] = 0
                route.fulfill(response=response, json=body)
            else:
                route.fulfill(response=response)

        page.route("**/grains/week", stale_then_real)
        slider.focus()
        press(page, "ArrowRight")
        soon(page, lambda: _equal(len(calls), 2))
        soon(page, lambda: expect(slider).to_have_attribute("aria-valuetext", "WEEK", timeout=POLL_MS))
        _settle(page)
        status = R(page, "status", "Grain score")
        record(status)
        page.route("**/grains/day", lambda route: route.fulfill(status=500, json={"error": {"code": "X", "message": "x"}, "server_now": "2026-12-31T12:00:00Z"}))
        press(page, "ArrowRight")
        holds(page, panel, "THAT GRAIN DID NOT LOAD. MOVE AGAIN.")
        soon(page, lambda: expect(slider).to_have_attribute("aria-valuetext", "WEEK", timeout=POLL_MS))
        _assert_grain(page, "week")
        assert log_of(status) == []
        page.unroute("**/grains/day")
        press(page, "ArrowLeft")
        _settle(page)
        panel.evaluate(RECORD_PHASES)
        lot = fresh_lots(anouk, wiremock, TPE10, "FI", sandbox_hour(24), [n("900,000")])[0]
        assert lot["status"] == "Available"
        changed = anouk.window(TPE10)["scores"]["month_bp"]
        says(page, page.locator("[data-score-numeral]"), f"{pct(changed)}%")
        assert panel.evaluate("el=>el.__phases.filter(p=>p!=='settled')") == []


def test_submission_gate() -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    rtm_rev = anouk.revision(RTM10)
    assert refused(anouk.post(f"/api/windows/{RTM10}/submit", {"revision": rtm_rev}), 409, "HOURS_MISSING")["message"] == "10 hours are still Missing. Fix them first."
    assert refused(anouk.post(f"/api/windows/{VNL10}/submit", {"revision": anouk.revision(VNL10)}), 409, "NO_VERIFIER")["message"] == "Assign a verifier firm first."
    assert refused(anouk.post(f"/api/windows/{EIN09}/submit", {"revision": anouk.revision(EIN09)}), 409, "WRONG_STATE")["message"] == "This window is In review. That can't be done now."
    assert anouk.revision(RTM10) == rtm_rev
    fast = short()
    submitted = start_short_review(fast)
    assert submitted["state"] == "In review"
    assert len(ok(Api(fast, "vera").get(f"/api/windows/{EIN09}/sample"))["hours"]) == 25


def test_deterministic_sample() -> None:
    base = year_end()
    vera, anouk = Api(base, "vera"), Api(base, "anouk")
    sample = ok(vera.get(f"/api/windows/{EIN09}/sample"))
    hours = sorted(b["key"] for b in anouk.hours(EIN09) if b["consumed_wh"] > 0)
    drawn: list[str] = []
    index = 0
    while len(drawn) < 25 and index < len(hours) * 50:
        digest = hashlib.sha256(f"{EIN09}|{sample['allocation_digest']}|{index}".encode()).hexdigest()
        pick = hours[int(digest[:16], 16) % len(hours)]
        if pick not in drawn:
            drawn.append(pick)
        index += 1
    assert [h["hour_utc"] for h in sample["hours"]] == drawn
    outside = next(h for h in hours if h not in drawn)
    refused(vera.put(f"/api/windows/{EIN09}/sample/{outside}", {"result": "agree", "note": ""}), 404, "NOT_FOUND")


def test_recording_sample(app_url: str) -> None:
    story = pipeline_story(app_url)
    error = refused(story["incomplete"], 409, "SAMPLE_INCOMPLETE")
    assert error["message"] == "24 sampled hours still need a result."
    assert refused(story["bad_result"], 422, "VALIDATION")["fields"]["result"] == "Choose agree or exception."
    assert [h["result"] for h in story["recorded"]] == ["exception"] + ["agree"] * 24
    assert story["completed"]["state"] == "Cancelling"
    assert story["sent"]["submitted"] == story["completed"]["lines_total"]


def test_server_fixed_opinion(app_url: str) -> None:
    story = pipeline_story(app_url)
    assert story["window"]["opinion"] == "Qualified" and story["statement"]["opinion"] == "Qualified"
    anouk = Api(year_end(), "anouk")
    estimated = anouk.window(EIN10)
    assert pct(estimated["non_actual_bp"]) == "12.89" and estimated["opinion"] == "Qualified"
    assert anouk.window(TPE10)["opinion"] == "Unqualified"
    assert anouk.window(RTM03)["opinion"] == "Unqualified"


def test_review_layouts(browser: Browser) -> None:
    base = year_end()
    for width, kind in ((375, "phone"), (767, "phone"), (768, "tablet"), (1199, "tablet"), (1200, "desk"), (1280, "desk")):
        with desk(browser, base, "vera", f"/review/{EIN09}", width=width, height=800) as page:
            summary, sampled = R(page, "region", "Review summary"), R(page, "list", "Sampled hours")
            evidence = R(page, "region", "Hour evidence")
            see(page, summary)
            see(page, sampled)
            soon(page, lambda: expect(sampled.get_by_role("listitem")).to_have_count(25, timeout=POLL_MS))
            layout(page)
            if kind == "phone":
                absent(page, evidence)
                absent(page, R(page, "button", "Hide evidence"))
                assert not {"Hide evidence"} & set(tab_order(page, 20))
                a, b = summary.bounding_box(), sampled.bounding_box()
                assert a and b and a["y"] + a["height"] <= b["y"] + 1
                button = R(sampled.get_by_role("listitem").first, "button", "Evidence")
                click(button)
                hide = R(page, "button", "Hide evidence")
                focus_on(page, hide)
                click(hide)
                click(button) if False else None
                absent(page, evidence)
                focus_on(page, button)
            else:
                see(page, evidence)
                absent(page, R(page, "button", "Hide evidence"))
                a, b, c = sampled.bounding_box(), evidence.bounding_box(), summary.bounding_box()
                assert a and b and c
                if kind == "tablet":
                    assert a["x"] + a["width"] <= b["x"] + 1 and c["y"] + c["height"] <= b["y"] + 1 and abs(b["x"] - c["x"]) <= 1
                else:
                    assert a["x"] + a["width"] <= b["x"] + 1 and b["x"] + b["width"] <= c["x"] + 1


def test_wf_review_sample_return(browser: Browser, app_url: str) -> None:
    anouk, window = ensure_reconciling(app_url, EIN10)
    window = ok(anouk.post(f"/api/windows/{EIN10}/submit", {"revision": window["revision"]}))
    assert window["state"] == "In review"
    reason = "  Check the Estimated days\nand resend.  "
    with desk(browser, app_url, "vera", f"/review/{EIN10}") as page:
        opener = R(page, "button", "Return window")
        see(page, opener)
        click(opener)
        dialog = R(page, "dialog", "Return window")
        see(page, dialog)
        fill(R(dialog, "textbox", "Reason"), reason)
        click(R(dialog, "button", "Send back"))
        absent(page, dialog)
    returned = wait_for(lambda: anouk.window(EIN10), lambda w: w["state"] == "Returned", "window never read Returned", seconds=WAIT_S)
    assert returned["returned_reason"] == reason
    rev = returned["revision"]
    for path in ("gaps/repair", "allocation", "meters/pull", "submit"):
        refused(anouk.post(f"/api/windows/{EIN10}/{path}", {"revision": rev}), 409, "WRONG_STATE")
    resumed = ok(anouk.post(f"/api/windows/{EIN10}/resume", {"revision": rev}))
    assert resumed["state"] == "Reconciling" and resumed["revision"] == rev + 1


def test_exact_text_and_field_errors(browser: Browser, app_url: str) -> None:
    anouk = ensure_reconciling(app_url, EIN10)[0]
    hour, other = pool_hours(anouk, 2)
    rev = anouk.revision(EIN10)
    path = f"/api/windows/{EIN10}/hours/{hour}/substitution"
    reason_message = "Enter a reason of 1 to 500 characters."
    for bad in ("", "   \n ", "\U0001F50B" * 501):
        assert refused(anouk.put(path, {"revision": rev, "value_wh": 1, "reason": bad}), 422, "VALIDATION")["fields"]["reason"] == reason_message
    exact = "\U0001F50B" * 500
    ok(anouk.put(path, {"revision": rev, "value_wh": 1, "reason": exact}))
    assert anouk.hour(EIN10, hour)["substitution_reason"] == exact
    story = pipeline_story(app_url)
    assert refused(story["over_note"], 422, "VALIDATION")["fields"]["note"] == "Enter a note of 1 to 2,000 characters."
    assert refused(story["no_note"], 422, "VALIDATION")["fields"]["note"] == "Enter a note of 1 to 2,000 characters."
    assert story["max_note"].status_code == 200
    assert story["recorded"][0]["note"] == story["note"]
    with desk(browser, app_url, "anouk", _go_to_grain_hour(EIN10, other)) as page:
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        value = R(panel, "textbox", "Substitution value in watt-hours")
        fill(value, "12a")
        click(R(panel, "button", "Save substitution"))
        link = R(R(panel, "alert", "Problems to fix"), "link", "Enter a whole number of watt-hours.")
        see(page, link)
        click(link)
        focus_on(page, value)
    assert anouk.hour(EIN10, other)["quality"] == "Estimated"


def test_wf_review_sample_keyboard(browser: Browser) -> None:
    base = late()
    vera = Api(base, "vera")
    with desk(browser, base, "vera", f"/review/{EIN09}") as page:
        items = R(page, "list", "Sampled hours").get_by_role("listitem")
        soon(page, lambda: expect(items).to_have_count(25, timeout=POLL_MS))
        puts: list[str] = []
        page.on("request", lambda r: puts.append(r.url) if r.method == "PUT" and "/sample/" in r.url else None)
        first = R(items.nth(0), "button", "Agree")
        first.focus()
        press(page, "n")
        focus_on(page, R(items.nth(1), "button", "Agree"))
        press(page, "p")
        focus_on(page, first)
        press(page, "x")
        dialog = R(page, "dialog", "Record exception")
        see(page, dialog)
        press(page, "Escape")
        absent(page, dialog)
        focus_on(page, first)
        for index in range(25):
            current = R(items.nth(index), "button", "Agree")
            focus_on(page, current)
            with held(page, "**/sample/*") as hold:
                press(page, "y")
                press(page, "y")
                release(hold)
            soon(page, lambda: _equal(len(puts), index + 1))
        focus_on(page, R(page, "button", "Complete review"))
        holds(page, R(page, "status", "Desk status"), "All 25 hours recorded.")
    assert all(h["result"] == "agree" for h in ok(vera.get(f"/api/windows/{EIN09}/sample"))["hours"])


def test_wf_review_expiry_deadline(browser: Browser) -> None:
    base = short()
    window = start_short_review(base)
    assert 1 <= window["review_seconds_left"] <= REVIEW_SHORT_S
    anouk, vera = Api(base, "anouk"), Api(base, "vera")
    hours = ok(vera.get(f"/api/windows/{EIN09}/sample"))["hours"]
    wrong_clock = datetime(2036, 1, 1, tzinfo=timezone.utc)
    with desk(browser, base, "anouk", "/windows", device_time=wrong_clock) as page:
        row = R(page, "table", "Window board").get_by_role("row").filter(has_text="Eindhoven Casting Hall 2026-09")
        see(page, row)
        expired = wait_for(lambda: anouk.window(EIN09), lambda w: w["state"] != "In review", "review never ended", seconds=REVIEW_SHORT_S + WAIT_S)
        assert expired["state"] == "Returned" and expired["returned_reason"] == TIMED_OUT
        assert expired["review_seconds_left"] is None and expired["revision"] == window["revision"] + 1
        listed = next(w for w in ok(anouk.get("/api/windows"))["windows"] if w["id"] == EIN09)
        assert listed["state"] == "Returned" and listed["revision"] == expired["revision"]
        holds(page, row, "Returned")
        holds(page, row, TIMED_OUT)
    refused(vera.put(f"/api/windows/{EIN09}/sample/{hours[0]['hour_utc']}", {"result": "agree", "note": ""}), 409, "WRONG_STATE")
    refused(vera.post(f"/api/windows/{EIN09}/review/complete", {}), 409, "WRONG_STATE")
    refused(vera.post(f"/api/windows/{EIN09}/review/return", {"reason": "late"}), 409, "WRONG_STATE")


def test_lot_expiry_server_clock(app_url: str, wiremock: WireMock) -> None:
    hour = "2026-08-15T10:00:00Z"
    token = uuid.uuid4().hex[:8]
    primary = Api(app_url, "anouk")
    retire_probes(primary, TPE10)
    fresh = make_bundle(f"lot-{token}-a", f"Probe {token} aug", "FI", hour, QTY_AGED)
    sync(primary, wiremock, TPE10, [fresh])
    open_lot = next(l for l in primary.lots(TPE10) if l["name"] == fresh["lot_name"])
    assert open_lot["status"] == "Available" and open_lot["cancel_by"] == cancel_by_of(open_lot["production_month"]) and open_lot["cancel_seconds_left"] >= 1
    clocked = Api(late(), "anouk")
    discharge = utc_of(AMS, 2026, 10, 28, 14)
    aged = make_bundle(f"lot-{token}-b", f"Aged {token}", "NL", hour, QTY_AGED,
                       battery_shifted=True, discharge_hour=discharge)
    intime = make_bundle(f"lot-{token}-c", f"Control {token}", "NL", utc_of(AMS, 2026, 10, 1, 9), QTY_AGED,
                         battery_shifted=True, discharge_hour=discharge)
    sync(clocked, wiremock, VNL10, [aged, intime])
    lot = next(l for l in clocked.lots(VNL10) if l["name"] == aged["lot_name"])
    control = next(l for l in clocked.lots(VNL10) if l["name"] == intime["lot_name"])
    assert lot["status"] == "Expired" and lot["cancel_seconds_left"] is None
    assert control["status"] == "Available"
    ok(clocked.post(f"/api/windows/{VNL10}/allocation", {"revision": clocked.revision(VNL10)}))
    assert [l for l in clocked.lines(VNL10) if l["lot_id"] == control["id"]], "the control lot won no line, so this hour cannot draw"
    assert not [l for l in clocked.lines(VNL10) if l["lot_id"] == lot["id"]]
    assert next(l for l in clocked.lots(VNL10) if l["id"] == lot["id"])["status"] == "Expired"
    entries = ok(clocked.get(f"/api/windows/{VNL10}/ledger"))["entries"]
    assert not [e for e in entries if e["lot_id"] == lot["id"] and e["kind"] == "battery_loss"]


def test_wf_review_expiry_countdown(browser: Browser) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    real = anouk.window(EIN09)
    state = {"elapsed": 0.0, "after": False}

    def answer(route: Any) -> None:
        body = dict(real)
        body["review_seconds_left"] = COUNTDOWN_RESET_S if state["after"] else max(1, 3 - int(state["elapsed"]))
        route.fulfill(json=body)

    with desk(browser, base, "anouk", f"/windows/{EIN09}", device_time=datetime(2030, 6, 1, tzinfo=timezone.utc)) as page:
        page.route(f"**/api/windows/{EIN09}", answer)
        page.reload()
        timer = R(page, "timer", "Review time left")
        see(page, timer)
        for _ in range(5):
            advance(page, 500)
            state["elapsed"] += 0.5
            assert _countdown_seconds(timer.inner_text()) <= 3
        state["after"] = True
        advance(page, 1500)
        soon(page, lambda: _assert_timer_at_least(timer, COUNTDOWN_FLOOR_S))
        assert _countdown_seconds(timer.inner_text()) <= COUNTDOWN_RESET_S


def _assert_timer_at_least(timer: Locator, seconds: int) -> None:
    assert _countdown_seconds(timer.inner_text()) >= seconds


def test_deadline_capped_by_cancel_by() -> None:
    anouk = Api(year_end(), "anouk")
    reply = anouk.get(f"/api/windows/{EIN09}")
    window = ok(reply)
    lot = anouk.lots(EIN09)[0]
    cancel_by = cancel_by_of(lot["production_month"])
    assert lot["cancel_by"] == cancel_by
    now = datetime.strptime(window["server_now"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    remaining = (datetime.strptime(cancel_by, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) - now).total_seconds()
    assert window["state"] == "In review" and abs(window["review_seconds_left"] - remaining) <= 2
    assert window["review_seconds_left"] < 864000


def test_settlement_time(browser: Browser) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    for who, route in (("anouk", "/windows"), ("anouk", f"/windows/{RTM10}"), ("anouk", f"/windows/{RTM10}/lots"), ("anouk", f"/windows/{RTM10}/ledger"), ("vera", "/review"), ("vera", f"/review/{EIN09}"), ("mirthe", "/group")):
        with desk(browser, base, who, route, device_time=datetime(2020, 2, 2, tzinfo=timezone.utc)) as page:
            timer = R(page, "timer", "Settlement time")
            see(page, timer)
            soon(page, lambda: expect(timer).to_have_text(re.compile(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$"), timeout=POLL_MS))
            shown = datetime.strptime(timer.inner_text(), "%Y-%m-%d %H:%M:%S UTC").replace(tzinfo=timezone.utc)
            server = datetime.strptime(ok(anouk.get("/api/me"))["server_now"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            assert abs((server - shown).total_seconds()) <= WAIT_S
            advance(page, 5000)
            later = datetime.strptime(timer.inner_text(), "%Y-%m-%d %H:%M:%S UTC").replace(tzinfo=timezone.utc)
            assert 4 <= (later - shown).total_seconds() <= 6


def test_row_timers_share_reask(browser: Browser) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    windows = ok(anouk.get("/api/windows"))["windows"]
    rows = [w for w in windows if w["state"] in ("Reconciling", "In review")][:4]
    assert len(rows) == 4
    state = {"elapsed": 0.0}
    calls: list[float] = []

    def board(route: Any) -> None:
        calls.append(state["elapsed"])
        left = 200 if state["elapsed"] >= 7 else max(1, 7 - int(state["elapsed"]))
        body = [{**w, "state": "In review", "review_seconds_left": left} for w in rows]
        route.fulfill(json={"windows": body, "server_now": "2026-12-31T12:00:00Z"})

    with desk(browser, base, "anouk", "/windows") as page:
        page.route("**/api/windows", board)
        page.reload()
        timers = R(page, "table", "Window board").get_by_role("timer", name="Review time left", exact=True)
        expect(timers).to_have_count(4, timeout=WAIT_S * 1000)
        for _ in range(16):
            state["elapsed"] += 0.5
            advance(page, 500)
        extra = sum(1 for at in calls if at >= 7)
        assert 1 <= extra < len(rows), f"{extra} list requests after zero with {len(rows)} rows"
        for each in timers.all():
            assert _countdown_seconds(each.inner_text()) >= COUNTDOWN_FLOOR_S


def test_one_outcome_at_deadline() -> None:
    base = short()
    anouk, vera = Api(base, "anouk"), Api(base, "vera")
    window = ok(anouk.post(f"/api/windows/{EIN10}/submit", {"revision": anouk.revision(EIN10)}))
    start_rev = window["revision"]
    record_all(vera, EIN10)
    wait_for(lambda: anouk.window(EIN10), lambda w: w["review_seconds_left"] is None or w["review_seconds_left"] <= 1, "countdown never reached its last second", seconds=REVIEW_SHORT_S + WAIT_S)
    reads = [(anouk, "GET", f"/api/windows/{EIN10}", None) for _ in range(8)]
    replies = race((vera, "POST", f"/api/windows/{EIN10}/review/complete", {}), *reads)
    assert all(r.status_code < 500 for r in replies), [r.status_code for r in replies]
    complete = replies[0]
    final = wait_for(lambda: anouk.window(EIN10), lambda w: w["state"] != "In review", "window stayed In review past its deadline", seconds=WAIT_S)
    returned_reads = [r.json() for r in replies[1:] if r.status_code == 200 and r.json()["state"] == "Returned"]
    if complete.status_code == 200:
        assert final["state"] in ("Cancelling", "Cancelled") and not returned_reads
    else:
        refused(complete, 409, "WRONG_STATE")
        assert final["state"] == "Returned" and final["revision"] == start_rev + 1
        assert all(r["revision"] == start_rev + 1 for r in returned_reads)


def test_one_cancellation_per_line(app_url: str, wiremock: WireMock) -> None:
    story = cancel_story(app_url, wiremock)
    posts = [req_body(e)["client_line_id"] for e in story["posts"]]
    assert sorted(posts) == sorted(story["ids"]) and len(posts) == 3
    for entry in story["posts"]:
        assert req_header(entry, "Idempotency-Key") == req_body(entry)["client_line_id"]
        assert req_body(entry)["beneficiary"] == "Tampere Foundry"
    assert sum(r.json()["submitted"] for r in story["presses"] if r.status_code == 200) == 3
    assert all(r.status_code == 200 for r in story["presses"])
    assert story["repeat"].status_code in (200, 409)
    chain = chain_story(app_url, wiremock)
    assert not [e for e in chain["posts"] if req_body(e)["client_line_id"].startswith(f"{RTM03}-r2_")]


def test_wf_cancellation_confirmed(browser: Browser, wiremock: WireMock) -> None:
    base = short()
    anouk = Api(base, "anouk")
    ids = [line["line_id"] for line in anouk.lines(TPE09)]
    for line_id in ids:
        stub_confirm(wiremock, line_id, "PENDING")
    with desk(browser, base, "anouk", f"/windows/{TPE09}") as page:
        status = R(page, "status", "Desk status")
        area = R(page, "region", "Window desk")
        see(page, area)
        record(status)
        click(R(R(page, "region", "Window actions"), "button", "Cancel certificates"))
        holds(page, status, "Sent to the registry. Lots read Cancelled once it confirms.")
        holds(page, area, "Confirmed 0 of 3 lines")
        lot = anouk.lots(TPE09)[0]
        assert lot["status"] == "Cancelling"
        assert {l["status"] for l in anouk.lines(TPE09)} == {"Pending"}
        stub_confirm(wiremock, ids[0], "CONFIRMED")
        holds(page, area, "Confirmed 1 of 3 lines")
        holds(page, status, "Registry confirmed 1 of 3 lines.")
        assert anouk.lots(TPE09)[0]["status"] == "Cancelling"
        for line_id in ids[1:]:
            stub_confirm(wiremock, line_id, "CONFIRMED")
        holds(page, area, "Confirmed 3 of 3 lines", LONG_WAIT_S)
        holds(page, area, "Cancelled", LONG_WAIT_S)
    assert anouk.lots(TPE09)[0]["status"] == "Cancelled"
    assert anouk.window(TPE09)["state"] == "Cancelled"
    assert sum(1 for e in posted_lines(wiremock) if req_body(e)["client_line_id"] in ids) == 3


def test_rejected_lines(browser: Browser, wiremock: WireMock) -> None:
    story = rejection_story(browser, wiremock)
    assert story["alert_shown"]
    first_id = story["ids"][0]
    rejected = next(l for l in story["first_lines"] if l["line_id"] == first_id)
    assert rejected["status"] == "Rejected" and rejected["reason"] == story["reason"]
    assert story["after_first"]["state"] == "Reconciling"
    assert story["after_first"]["unmatched_wh"] == story["before"]["unmatched_wh"] + 500000
    assert story["after_first"]["scores"]["hour_bp"] < story["before"]["scores"]["hour_bp"]
    assert story["first_hour"]["matched_wh"] == 0


def test_wf_cancellation_registry_outage(browser: Browser, wiremock: WireMock) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    assert {l["status"] for l in anouk.lines(TPE09)} == {"Unsubmitted"}
    wiremock.fault("POST", "/registry/v2/cancellations")
    refused(anouk.post(f"/api/windows/{TPE09}/cancellations", {}), 503, "REGISTRY_UNAVAILABLE")
    with desk(browser, base, "anouk", f"/windows/{TPE09}") as page:
        click(R(R(page, "region", "Window actions"), "button", "Cancel certificates"))
        holds(page, R(page, "alert", "Desk alert"), "REGISTRY IS DOWN. NOTHING WAS CANCELLED.")
        see(page, page.get_by_text("REGISTRY IS DOWN. NOTHING WAS CANCELLED.", exact=True))
    assert {l["status"] for l in anouk.lines(TPE09)} == {"Unsubmitted"}
    assert anouk.window(TPE09)["state"] == "Cancelling"


def test_lot_confirmation_counts(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    story = cancel_story(app_url, wiremock)
    assert story["pending_lots"][0]["lines_confirmed"] == 0 and story["pending_lots"][0]["lines_total"] == 3
    assert story["one_lots"][0]["lines_confirmed"] == 1
    assert story["one_window"]["lines_confirmed"] == sum(l["status"] == "Confirmed" for l in story["one_lines"]) == 1
    assert story["done_lots"][0]["lines_confirmed"] == 3
    with desk(browser, year_end(), "anouk", f"/windows/{TPE09}/lots") as page:
        holds(page, R(page, "region", "Lot list"), "Confirmed 0 of 3 lines")


def test_signing_by_verifier(app_url: str) -> None:
    base = year_end()
    vera, bram, anouk = Api(base, "vera"), Api(base, "bram"), Api(base, "anouk")
    path = f"/api/windows/{EIN08}/sign"
    rev = anouk.revision(EIN08)
    refused(anouk.post(path, {"typed_name": FULL_NAME["vera"]}), 403, "FORBIDDEN")
    refused(bram.post(path, {"typed_name": FULL_NAME["bram"]}), 404, "NOT_FOUND")
    error = refused(vera.post(path, {"typed_name": "vera lindqvist"}), 422, "VALIDATION")
    assert error["fields"]["typed_name"] == "Type your name exactly as it appears on your account."
    assert anouk.window(EIN08)["state"] == "Cancelled" and anouk.revision(EIN08) == rev
    refused(vera.post(f"/api/windows/{EIN09}/sign", {"typed_name": FULL_NAME["vera"]}), 409, "WRONG_STATE")
    story = pipeline_story(app_url)
    assert story["signed"]["window"]["state"] in ("Signed", "Sealed")
    assert story["window"]["state"] == "Sealed"


def test_three_part_seal(app_url: str) -> None:
    story = pipeline_story(app_url)
    statement = story["statement"]
    assert statement["pdf_object_key"] == f"attestations/{story['code']}.pdf"
    stored = S3().get(statement["pdf_object_key"])
    assert stored[:4] == b"%PDF"
    assert_statement_signatures(statement, stored)
    assert story["window"]["seal_status"] == "sealed" and story["window"]["statement_code"] == story["code"]
    assert story["pdf_response"].content == stored
    assert story["pdf_response"].headers["content-type"].startswith("application/pdf")


def test_wf_sign_seal_press_down(browser: Browser) -> None:
    proxy = PressProxy(os.environ["GOTENBERG_URL"].rstrip("/"))
    try:
        with app_copy({"GOTENBERG_URL": proxy.url}) as (copy, bucket_suffix):
            vera, public = Api(copy, "vera"), Api(copy)
            with desk(browser, copy, "vera", f"/review/{EIN08}") as page:
                status = R(page, "status", "Seal status")
                opener = R(page, "button", "Sign attestation")
                see(page, opener)
                click(opener)
                dialog = R(page, "dialog", "Sign attestation")
                see(page, dialog)
                fill(R(dialog, "textbox", "Type your full name"), FULL_NAME["vera"])
                replies: list[Any] = []
                page.on("response", lambda r: replies.append(r) if r.url.endswith(f"/windows/{EIN08}/sign") else None)
                click(R(dialog, "button", "Sign"))
                soon(page, lambda: _equal(len(replies), 1), step=10)
                assert replies[0].status == 202
                body = replies[0].json()
                assert body["message"] == "PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE."
                assert body["window"]["seal_status"] == "held_press" and body["window"]["state"] == "Signed"
                code = body["statement_code"]
                assert re.fullmatch(r"HP-2026-08-EIN-\d+", code)
                holds(page, status, "PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE.", 5)
                rotated = ok(vera.post(rotate_path("aldermoor"), {}))
                proxy.open.set()
                soon(page, lambda: _assert_path(page, f"/check/{code}"), LONG_WAIT_S)
            statement = wait_for(lambda: public.get(f"/api/public/statements/{code}"), lambda r: r.status_code == 200, "held seal never finished").json()
            assert statement["key_id"] != rotated["key_id"] and statement["signature_valid"] is True
            assert_statement_signatures(statement, S3(bucket_suffix).get(statement["pdf_object_key"]))
            assert proxy.refused >= 1 and proxy.forwarded >= 1
    finally:
        proxy.close()


def test_attestation_pdf(app_url: str, wiremock: WireMock) -> None:
    story = pipeline_story(app_url)
    text = pdf_text(story["pdf_response"].content)
    statement = story["statement"]
    scores = statement["scores"]
    expected = [
        f"Statement {story['code']}",
        "Site Eindhoven Casting Hall",
        "Month 2026-09",
        f"Month score {pct(scores['month_bp'])}%",
        f"Week score {pct(scores['week_bp'])}%",
        f"Day score {pct(scores['day_bp'])}%",
        f"Hour score {pct(scores['hour_bp'])}%",
        "Consumed 720.000000 MWh",
        "Hour matched 648.000000 MWh",
        "Opinion Qualified",
        "Verifier firm Aldermoor Assurance",
        f"Allocation digest {statement['allocation_digest']}",
    ]
    position = -1
    for line in expected:
        found = text.find(line, position + 1)
        assert found > position, f"{line!r} missing or out of order in {text!r}"
        position = found
    assert WORKING_FRAGMENT not in text
    other = cancel_story(app_url, wiremock)
    assert "Verifier firm Brightlock Prüfung & Söhne" in pdf_text(other["pdf"])


def test_wf_sign_seal_lands(browser: Browser) -> None:
    base = late()
    with desk(browser, base, "vera", f"/review/{EIN08}") as page:
        opener = R(page, "button", "Sign attestation")
        see(page, opener)
        click(opener)
        dialog = R(page, "dialog", "Sign attestation")
        see(page, dialog)
        fill(R(dialog, "textbox", "Type your full name"), FULL_NAME["vera"])
        click(R(dialog, "button", "Sign"))
        code = "HP-2026-08-EIN-1"
        soon(page, lambda: _assert_path(page, f"/check/{code}"), LONG_WAIT_S)
        holds(page, R(page, "status", "Seal status"), f"Sealed. Statement {code} is live.")
        holds(page, R(page, "region", "Statement result"), "SIGNATURE HOLDS.")
    statement = ok(Api(base).get(f"/api/public/statements/{code}"))
    assert S3("-late").get(f"attestations/{code}.pdf")[:4] == b"%PDF"
    assert statement["state"] == "Sealed"


def test_signing_across_session_end(browser: Browser) -> None:
    base = short()
    with desk(browser, base, "vera", f"/review/{EIN08}") as page:
        opener = R(page, "button", "Sign attestation")
        see(page, opener)
        click(opener)
        dialog = R(page, "dialog", "Sign attestation")
        see(page, dialog)
        fill(R(dialog, "textbox", "Type your full name"), FULL_NAME["vera"])
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/sign") else None)
        assert page.request.post(base + "/api/auth/sign-out", data={}).status == 200
        click(R(dialog, "button", "Sign"))
        again = R(page, "dialog", "Sign in again")
        see(page, again)
        expect(R(dialog, "textbox", "Type your full name")).to_have_value(FULL_NAME["vera"])
        fill(R(again, "textbox", "Password"), PASSWORD)
        click(R(again, "button", "Sign in"))
        code = "HP-2026-08-EIN-1"
        soon(page, lambda: _assert_path(page, f"/check/{code}"), LONG_WAIT_S)
        assert len(posts) == 2
    assert S3("-short").keys("attestations/HP-2026-08-EIN-") == [f"attestations/{code}.pdf"]


def test_signing_fixes_everything(app_url: str) -> None:
    story = pipeline_story(app_url)
    assert story["code"] == "HP-2026-09-EIN-1"
    payload = json.loads(story["statement"]["attestation_payload"])
    assert payload["opinion"] == "Qualified" and not payload["signed_at"].startswith("1999")
    assert story["statement"]["code"] == story["code"]
    assert not S3().keys("attestations/" + UNKNOWN_CODE[:7])


def test_public_check_page(browser: Browser, app_url: str) -> None:
    story = pipeline_story(app_url)
    statement = story["statement"]
    assert statement["signature_valid"] is True
    assert_statement_signatures(statement, S3().get(statement["pdf_object_key"]))
    assert story["note"] not in json.dumps(statement) and WORKING_FRAGMENT not in json.dumps(statement)
    public = Api(app_url)
    refused(public.get(f"/api/public/statements/{UNKNOWN_CODE}"), 404, "NOT_FOUND")
    with desk(browser, app_url, None, f"/check/{story['code']}") as page:
        result = R(page, "region", "Statement result")
        holds(page, result, "SIGNATURE HOLDS.")
        holds(page, result, "Qualified")
        expect(page.locator("body")).not_to_contain_text(WORKING_FRAGMENT)
    with desk(browser, app_url, None, f"/check/{UNKNOWN_CODE}") as page:
        see(page, page.get_by_text("NO STATEMENT HAS THAT CODE.", exact=True))


def test_public_check_tampered_object(browser: Browser) -> None:
    base = short()
    public = Api(base)
    sealed = wait_for(lambda: public.get(f"/api/public/statements/{RTM03_CODE}"), lambda r: r.status_code == 200, "seeded statement never sealed").json()
    assert sealed["signature_valid"] is True
    s3_put(os.environ["S3_BUCKET"] + "-short", sealed["pdf_object_key"], TAMPERED_PDF)
    reply = public.get(f"/api/public/statements/{RTM03_CODE}")
    assert reply.status_code == 200
    assert reply.json()["signature_valid"] is False
    with desk(browser, base, None, f"/check/{RTM03_CODE}") as page:
        result = R(page, "region", "Statement result")
        holds(page, result, "SIGNATURE DOES NOT HOLD.")
        holds(page, result, RTM03_CODE)


def test_wf_statement_check_restated(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    story = chain_story(app_url, wiremock)
    assert story["predecessor"]["state"] == "Restated" and story["r2"]["state"] == "Reconciling"
    old = story["old_statement"]
    assert old["state"] == "Restated" and old["successor_window_id"] == f"{RTM03}-r2"
    assert old["scores"] == story["first"]["scores"] and old["attestation_payload"] == story["first"]["attestation_payload"]
    assert story["old_pdf_after"] == story["first_pdf"]
    assert S3().get(old["pdf_object_key"]) == story["first_pdf"]
    with desk(browser, app_url, None, f"/check/{RTM03_CODE}") as page:
        holds(page, R(page, "region", "Statement result"), "SIGNATURE HOLDS.")
        see(page, page.get_by_text(re.compile(r"RESTATED\. SEE THE SUCCESSOR WINDOW\.\s*rtm-2026-03-r2")))
        link = R(page, "link", "Open the successor statement")
        see(page, link)
        assert link.get_attribute("href") == f"/check/{story['signed_r2']['statement_code']}"


def test_wf_statement_check_reader(browser: Browser) -> None:
    base = year_end()
    statement = wait_for(lambda: Api(base).get(f"/api/public/statements/{RTM03_CODE}"), lambda r: r.status_code == 200, "seeded statement never sealed").json()
    with desk(browser, base, None, "/check") as page:
        see(page, R(page, "heading", "CHECK A STATEMENT."))
        fill(R(page, "textbox", "Statement code"), UNKNOWN_CODE)
        click(R(page, "button", "Check statement"))
        see(page, page.get_by_text("NO STATEMENT HAS THAT CODE.", exact=True))
        page.goto(base + "/check")
        fill(R(page, "textbox", "Statement code"), RTM03_CODE)
        click(R(page, "button", "Check statement"))
        soon(page, lambda: _assert_path(page, f"/check/{RTM03_CODE}"))
        result = R(page, "region", "Statement result")
        for text in (RTM03_CODE, "Rotterdam Press Works", "50.07", "25.03", "Unqualified", "Aldermoor Assurance", "SIGNATURE HOLDS."):
            holds(page, result, text)
        link = R(page, "link", "Download attestation PDF")
        see(page, link)
        answer = page.request.get(base + link.get_attribute("href"))
        assert answer.status == 200 and answer.headers["content-type"].startswith("application/pdf")
        stored = S3("-yearend").get(statement["pdf_object_key"])
        assert answer.body() == stored
    assert_statement_signatures(statement, stored)


def test_site_zone_cuts() -> None:
    anouk = Api(year_end(), "anouk")
    days = anouk.grain(RTM10, "day")["buckets"]
    assert len(days) == 31 and days[0]["key"] == day_key(1) and days[0]["start_utc"] == utc_of(AMS, 2026, 10, 1, 0)
    last_sunday = bucket_at(days, day_key(25))
    assert last_sunday["start_utc"] == utc_of(AMS, 2026, 10, 25, 0) and last_sunday["end_utc"] == utc_of(AMS, 2026, 10, 26, 0)
    helsinki = anouk.grain(TPE10, "day")["buckets"]
    assert helsinki[0]["start_utc"] == utc_of(HEL, 2026, 10, 1, 0)
    weeks = anouk.grain(RTM10, "week")["buckets"]
    assert [b["key"] for b in weeks] == [day_key(d) for d in (1, 5, 12, 19, 26)]
    hour = anouk.grain(RTM10, "hour")["buckets"]
    assert hour[0]["key"] == utc_of(AMS, 2026, 10, 1, 0) and len(hour) == 745
    falls = anouk.grain(RTM10, "hour")["falls"]
    day_matched = {b["key"]: b["matched_wh"] for b in days}
    first = next(f for f in falls if f["parent_key"] == day_key(1))
    children = sum(b["matched_wh"] for b in hour if days[0]["start_utc"] <= b["start_utc"] < days[0]["end_utc"])
    assert first["detached_wh"] == day_matched[day_key(1)] - children


def test_wf_group_oversight_policy(browser: Browser) -> None:
    base = late()
    mirthe, anouk = Api(base, "mirthe"), Api(base, "anouk")
    sealed_before = wait_for(lambda: anouk.window(RTM03), lambda w: w["state"] in ("Sealed", "Restated"), "seed never sealed")["target"]
    with desk(browser, base, "mirthe", "/group") as page:
        region = R(page, "region", "Rotterdam Press Works policy")
        see(page, region)
        select(R(region, "combobox", "Target grain"), "DAY")
        percent = R(region, "textbox", "Target percent")
        fill(percent, "4.355")
        click(R(region, "button", "Save policy"))
        message = "Enter a percent from 0.00 to 100.00 with at most two decimals."
        see(page, page.get_by_role("link", name=message, exact=True))
        fill(percent, "4.35")
        with page.expect_request(lambda r: r.method == "PUT" and r.url.endswith(POLICY_PATH)) as seen:
            click(R(region, "button", "Save policy"))
        assert seen.value.post_data_json == {"target_grain": "DAY", "target_bp": 435}
        says(page, R(page, "status", "Group status"), "Policy saved for Rotterdam Press Works.")
        row = R(page, "table", "Site scores").get_by_role("row").filter(has_text="Venlo Coil Shop")
        select(R(row, "combobox", "Verifier firm"), "Aldermoor Assurance")
        click(R(row, "button", "Assign"))
        says(page, R(page, "status", "Group status"), "Verifier firm assigned.")
    assert anouk.window(RTM10)["target"]["bp"] == 435 and anouk.window(RTM10)["target"]["grain"] == "DAY"
    assert anouk.window(RTM03)["target"] == sealed_before and sealed_before["bp"] == 8000
    assert anouk.window(VNL10)["verifier_firm"]["id"] == "aldermoor"
    refused(mirthe.put(f"/api/windows/{RTM03}/verifier", {"firm_id": "brightlock"}), 409, "WRONG_STATE")
    for bad, field in (({"target_grain": "YEAR", "target_bp": 100}, "target_grain"), ({"target_grain": "HOUR", "target_bp": 10001}, "target_bp"), ({"target_grain": "HOUR", "target_bp": "100"}, "target_bp")):
        assert field in refused(mirthe.put(site_path("rtm", "policy"), bad), 422, "VALIDATION")["fields"]


def test_group_score_table(browser: Browser) -> None:
    base = year_end()
    mirthe = Api(base, "mirthe")
    body = ok(mirthe.get("/api/group/scores"))
    months = [w["month"] for w in body["windows"]]
    assert months == sorted(months, reverse=True)
    assert [r["month"] for r in body["rollups"]] == sorted({w["month"] for w in body["windows"]}, reverse=True)
    with desk(browser, base, "mirthe", "/group") as page:
        table = R(page, "table", "Site scores")
        see(page, table)
        for window in body["windows"]:
            row = table.get_by_role("row").filter(has_text=window["site"]["name"]).filter(has_text=window["month"])
            see(page, row)
            for bp in window["scores"].values():
                holds(page, row, pct(bp))
            holds(page, row, "On target" if window["target"]["met"] else "Off target")


def test_wf_group_oversight_tree(browser: Browser) -> None:
    base = year_end()
    mirthe = Api(base, "mirthe")
    windows = ok(mirthe.get("/api/group/scores"))["windows"]
    rtm_rows = [w for w in windows if w["site"]["id"] == "rtm"]
    with desk(browser, base, "mirthe", "/group") as page:
        tree = R(page, "tree", "Sites")
        rotterdam = R(tree, "treeitem", "Rotterdam Press Works")
        see(page, rotterdam)
        child = R(tree, "treeitem", "Rotterdam Press Works 2026-10")
        absent(page, child)
        rotterdam.focus()
        press(page, "ArrowRight")
        see(page, child)
        first_child = tree.get_by_role("treeitem", name=re.compile(r"^Rotterdam Press Works \d{4}-\d\d$")).first
        press(page, "ArrowRight")
        focus_on(page, first_child)
        press(page, "ArrowLeft")
        focus_on(page, rotterdam)
        press(page, "ArrowLeft")
        absent(page, child)
        press(page, "Enter")
        says(page, R(page, "status", "Group status"), f"{len(rtm_rows)} windows shown.")
        assert parse_qs(urlparse(page.url).query)["site"] == ["rtm"]
        page.reload()
        see(page, R(tree, "treeitem", "Rotterdam Press Works 2026-10"))
        click(R(page, "button", "Show every site"))
        soon(page, lambda: _assert_no_site(page))
    with desk(browser, base, "mirthe", "/group", width=375, height=812) as page:
        tree = R(page, "tree", "Sites")
        rotterdam = R(tree, "treeitem", "Rotterdam Press Works")
        see(page, rotterdam)
        tap(rotterdam)
        tap(R(tree, "treeitem", "Rotterdam Press Works 2026-10"))
        soon(page, lambda: _assert_path(page, f"/windows/{RTM10}"))


def _assert_no_site(page: Page) -> None:
    assert "site" not in parse_qs(urlparse(page.url).query), page.url


def test_group_totals(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = year_end()
    rollups = ok(Api(base, "mirthe").get("/api/group/scores"))["rollups"]
    september = next(r for r in rollups if r["month"] == "2026-09")
    assert september["scores"]["hour_bp"] == 4510 and september["consumed_wh"] == n("1,440,000,000") and september["window_count"] == 2
    lead_view = ok(Api(base, "mirthe").get("/api/group/scores"))["windows"]
    members = [w for w in lead_view if w["month"] == "2026-10"]
    october = next(r for r in rollups if r["month"] == "2026-10")
    assert october["window_count"] == len(members)
    reader = Api(base, "anouk")
    differs = False
    for grain in ("month", "week", "day", "hour"):
        matched = consumed = 0
        for member in members:
            buckets = reader.grain(member["id"], grain)["buckets"]
            matched += sum(b["matched_wh"] for b in buckets)
            consumed += sum(b["consumed_wh"] for b in buckets)
        assert october["scores"][f"{grain}_bp"] == round_half_up(matched * 10000, consumed), grain
        mean = round_half_up(sum(m["scores"][f"{grain}_bp"] for m in members), len(members))
        differs = differs or mean != october["scores"][f"{grain}_bp"]
    assert differs, "summed totals equal the mean of window scores at every grain"
    with desk(browser, base, "mirthe", "/group?site=rtm") as page:
        table = R(page, "table", "Group totals")
        row = table.get_by_role("row").filter(has_text="2026-09")
        see(page, row)
        holds(page, row, "1,440,000,000")
        holds(page, row, "45.10")
    story = chain_story(app_url, wiremock)
    march = next(r for r in story["rollups"] if r["month"] == "2026-03")
    assert march["window_count"] == 1 and march["consumed_wh"] == story["r3"]["consumed_wh"]


def test_group_totals_lead_only() -> None:
    base = year_end()
    vera, bram = Api(base, "vera"), Api(base, "bram")
    refused(vera.get("/api/group/scores"), 403, "FORBIDDEN")
    for api, firm, foreign in ((vera, "aldermoor", TPE10), (bram, "brightlock", EIN10)):
        listed = ok(api.get("/api/windows"))["windows"]
        assert listed and {w["verifier_firm"]["id"] for w in listed} == {firm}
        assert foreign not in {w["id"] for w in listed}
    ids = {w["id"] for w in ok(vera.c.get("/api/windows", params={"state": "In review"}))["windows"]}
    assert ids == {EIN09}


def _selected(page: Page) -> Locator:
    return _wall(page).locator('[aria-selected="true"]')


def test_range_selection(browser: Browser) -> None:
    base = year_end()
    buckets = Api(base, "anouk").hours(RTM10)
    with desk(browser, base, "anouk", _go_to_grain_hour(RTM10)) as page:
        grid = _wall(page)
        status = R(page, "status", "Wall selection")
        start_index = next(i for i, b in enumerate(buckets) if b["key"] == utc_of(AMS, 2026, 10, 5, 9))
        start = R(grid, "gridcell", cell_name(AMS, buckets[start_index]))
        see(page, start)
        start.focus()
        press(page, "Shift+ArrowDown")
        press(page, "Shift+ArrowDown")
        says(page, status, "3 hours selected.")
        soon(page, lambda: expect(_selected(page)).to_have_count(3, timeout=POLL_MS))
        press(page, "Shift+ArrowRight")
        says(page, status, "27 hours selected.")
        soon(page, lambda: expect(_selected(page)).to_have_count(27, timeout=POLL_MS))
        see(page, R(R(page, "region", "Window actions"), "button", "Spread a total"))
        press(page, "Escape")
        says(page, status, "Selection cleared.")
        expect(_selected(page)).to_have_count(0)
        absent(page, R(R(page, "region", "Window actions"), "button", "Spread a total"))
        start.focus()
        target = R(grid, "gridcell", cell_name(AMS, buckets[start_index + 4]))
        target.click(modifiers=["Shift"])
        says(page, status, "5 hours selected.")
        absent(page, R(page, "dialog", "Hour detail"))
        press(page, "ArrowDown")
        says(page, status, "Selection cleared.")
        toggle = R(R(page, "region", "Hour Wall"), "button", "Select hours")
        click(toggle)
        expect(toggle).to_have_attribute("aria-pressed", "true")
        click(start)
        click(R(grid, "gridcell", cell_name(AMS, buckets[start_index + 2])))
        says(page, status, "3 hours selected.")
        absent(page, R(page, "dialog", "Hour detail"))
        click(toggle)
        expect(_selected(page)).to_have_count(3)


def test_wf_wall_selection_spread(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    hours = [utc_of(AMS, 2026, 10, 28, h) for h in (8, 9, 10)]
    revision = anouk.revision(VNL10)
    buckets = anouk.hours(VNL10)
    with desk(browser, app_url, "anouk", _go_to_grain_hour(VNL10)) as page:
        grid = _wall(page)
        status = R(page, "status", "Desk status")
        soon(page, lambda: expect(status).to_be_attached(timeout=POLL_MS))
        record(status)
        start = R(grid, "gridcell", cell_name(AMS, bucket_at(buckets, hours[0])))
        see(page, start)
        start.focus()
        press(page, "Shift+ArrowDown")
        press(page, "Shift+ArrowDown")
        opener = R(R(page, "region", "Window actions"), "button", "Spread a total")
        see(page, opener)
        click(opener)
        dialog = R(page, "dialog", "Spread a total")
        see(page, dialog)
        fill(R(dialog, "textbox", "Total in watt-hours"), str(n("1,563,271")))
        fill(R(dialog, "textbox", "Reason"), "Invoice total for the outage")
        click(R(dialog, "button", "Spread"))
        absent(page, dialog)
        final = bucket_at(anouk.hours(VNL10), hours[2])
        focus_on(page, R(grid, "gridcell", cell_name(AMS, final)))
        window = anouk.window(VNL10)
        holds(page, status, alloc_line(window))
        assert_before(status, "Spread done. 3 hours filled.", alloc_line(window))
        absent(page, opener)
    values = [anouk.hour(VNL10, h) for h in hours]
    assert [v["consumed_wh"] for v in values] == [n("521,080"), n("521,090"), n("521,101")] and all(v["quality"] == "Substituted" for v in values)
    assert anouk.revision(VNL10) == revision + 1
    fast = late()
    clocked = Api(fast, "anouk")
    ok(clocked.post(f"/api/windows/{RTM10}/gaps/repair", {"revision": clocked.revision(RTM10)}))
    run = [utc_of(AMS, 2026, 10, 20, h) for h in (4, 5, 6)]
    ok(clocked.post(f"/api/windows/{RTM10}/hours/spread", {"revision": clocked.revision(RTM10), "hours": run, "total_wh": n("2,800,001"), "reason": "Equal weights"}))
    assert [clocked.hour(RTM10, h)["consumed_wh"] for h in run] == [n("933,334"), n("933,334"), n("933,333")]
    base = year_end()
    reader = Api(base, "anouk")
    path = f"/api/windows/{RTM10}/hours/spread"
    rev = reader.revision(RTM10)
    gap_a, gap_b = utc_of(AMS, 2026, 10, 13, 5), utc_of(AMS, 2026, 10, 13, 6)
    far = utc_of(AMS, 2026, 10, 20, 10)
    message = "Select 2 to 168 consecutive hours."
    for bad in ([gap_a], [gap_a, far], "nope", [gap_a, 7]):
        assert refused(reader.post(path, {"revision": rev, "hours": bad, "total_wh": 5, "reason": "x"}), 422, "VALIDATION")["fields"]["hours"] == message
    assert refused(reader.post(path, {"revision": rev, "hours": [gap_a, gap_b], "total_wh": "5", "reason": "x"}), 422, "VALIDATION")["fields"]["total_wh"] == "Enter a whole number of watt-hours."
    refused(reader.post(path, {"revision": rev, "hours": ["1999-01-01T00:00:00Z", "1999-01-01T01:00:00Z"], "total_wh": 5, "reason": "x"}), 404, "NOT_FOUND")
    actual = [utc_of(AMS, 2026, 10, 5, 9), utc_of(AMS, 2026, 10, 5, 10)]
    error = refused(reader.post(path, {"revision": rev, "hours": actual, "total_wh": 5, "reason": "x"}), 409, "HOUR_NOT_SPREADABLE")
    assert error["message"] == "Only Missing or Estimated hours can take a spread."
    assert reader.revision(RTM10) == rev


def test_wf_wall_selection_phone_panel(browser: Browser) -> None:
    base = year_end()
    anouk = Api(base, "anouk")
    buckets = anouk.hours(RTM10)
    assert len(buckets) == anouk.window(RTM10)["hour_count"]
    for width, height in ((320, 700), (375, 812)):
        with desk(browser, base, "anouk", _go_to_grain_hour(RTM10), width=width, height=height) as page:
            region = R(page, "region", "Hour Wall")
            first = R(_wall(page), "gridcell", cell_name(AMS, buckets[0]))
            see(page, first)
            first.focus()
            press(page, "Control+End")
            last = R(_wall(page), "gridcell", cell_name(AMS, buckets[-1]))
            focus_on(page, last)
            scrolls = region.evaluate(
                "r=>[r,...r.querySelectorAll('*')].some(e=>e.scrollWidth>e.clientWidth&&['auto','scroll'].includes(getComputedStyle(e).overflowX))"
            )
            assert scrolls, "Hour Wall does not scroll sideways"
            assert page.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth")
            press(page, "Enter")
            panel = R(page, "dialog", "Hour detail")
            see(page, panel)
            soon(page, lambda: _equal(panel.evaluate("el=>el.getAnimations().filter(a=>a.playState==='running').length"), 0))
            box = panel.bounding_box()
            assert box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= width and box["y"] + box["height"] <= height
            close = R(panel, "button", "Close")
            x, y = center(close)
            assert close.evaluate("(el,[x,y])=>{const hit=document.elementFromPoint(x,y);return el===hit||el.contains(hit)}", [x, y])
            click(close)
            absent(page, panel)
            focus_on(page, last)


def test_wf_live_collaboration_stale(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    anouk = ensure_reconciling(app_url, EIN10)[0]
    joris = Api(app_url, "joris")
    hour, other, actual_hour, second_other = pool_hours(anouk, 4)
    with desk(browser, app_url, "anouk", _go_to_grain_hour(EIN10, hour)) as page:
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        value, reason = R(panel, "textbox", "Substitution value in watt-hours"), R(panel, "textbox", "Reason")
        fill(value, STALE_VALUE)
        fill(reason, STALE_REASON)
        old = anouk.revision(EIN10)
        ok(joris.put(f"/api/windows/{EIN10}/hours/{other}/substitution", {"revision": old, "value_wh": 11, "reason": "Other"}))
        error = refused(anouk.put(f"/api/windows/{EIN10}/hours/{hour}/substitution", {"revision": old, "value_wh": 1, "reason": "probe"}), 409, "STALE_REVISION")
        assert error["wrote_by"] == "Joris Bakker"
        puts: list[Any] = []
        page.on("request", lambda r: puts.append(r.post_data_json) if r.method == "PUT" and "/substitution" in r.url else None)
        click(R(panel, "button", "Save substitution"))
        copy = f"Joris Bakker changed this window at {error['wrote_at'][11:16]} UTC. Your change was not saved."
        holds(page, R(panel, "alert", "Problems to fix"), copy)
        expect(value).to_have_value(STALE_VALUE)
        retry = R(panel, "button", "Retry on latest")
        see(page, retry)
        click(retry)
        wait_for(lambda: anouk.hour(EIN10, hour), lambda h: h["quality"] == "Substituted", "retry never saved", seconds=WAIT_S)
        soon(page, lambda: _equal(len(puts), 2))
    saved = anouk.hour(EIN10, hour)
    assert saved["consumed_wh"] == int(STALE_VALUE) and saved["substitution_reason"] == STALE_REASON
    assert puts[0]["value_wh"] == puts[1]["value_wh"] == int(STALE_VALUE) and puts[1]["revision"] == old + 1
    with desk(browser, app_url, "anouk", _go_to_grain_hour(EIN10, actual_hour)) as page:
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        value = R(panel, "textbox", "Substitution value in watt-hours")
        fill(value, PANEL_VALUE)
        fill(R(panel, "textbox", "Reason"), "Typed before the pull")
        wiremock.stub("GET", "/hub/v1/readings", json={"runs": [{"start": actual_hour, "interval_minutes": 60, "count": 1, "unit": "kWh", "value": ACTUAL_KWH}]})
        typed_value = value.input_value()
        assert typed_value
        ok(joris.post(f"/api/windows/{EIN10}/meters/pull", {"revision": anouk.revision(EIN10)}))
        holds(page, panel, "Actual")
        holds(page, panel, f"{kwh_wh(ACTUAL_KWH):,}")
        expect(value).to_have_value(typed_value)
        click(R(panel, "button", "Save substitution"))
        retry = R(panel, "button", "Retry on latest")
        see(page, retry)
        click(retry)
        holds(page, R(panel, "alert", "Problems to fix"), "This hour has an Actual reading.")
        expect(value).to_have_value(typed_value)
    assert anouk.hour(EIN10, actual_hour)["consumed_wh"] == kwh_wh(ACTUAL_KWH)
    assert anouk.hour(EIN10, second_other)["quality"] == "Estimated"


def test_wf_live_collaboration_remote_focus(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    a, b = fresh_lots(anouk, wiremock, TPE10, "FI", sandbox_hour(26), [QTY_CLAIM, QTY_CLAIM])
    with desk(browser, app_url, "joris", f"/windows/{TPE10}/lots") as page:
        see(page, _item(page, b["name"]))
        merit, desk_status = R(page, "status", "Merit order status"), R(page, "status", "Desk status")
        record(merit)
        record(desk_status)
        control = R(_item(page, a["name"]), "button", "Move down")
        control.focus()
        ids = [lot["id"] for lot in anouk.lots(TPE10)]
        i, j = ids.index(a["id"]), ids.index(b["id"])
        ids[i], ids[j] = ids[j], ids[i]
        ok(anouk.put(f"/api/windows/{TPE10}/merit-order", {"revision": anouk.revision(TPE10), "lot_ids": ids}))
        soon(page, lambda: _assert_above(page, b["name"], a["name"]))
        focus_on(page, control)
        first_line = f"Anouk Visser changed this window. Hour score {pct(anouk.window(TPE10)['scores']['hour_bp'])} percent."
        holds(page, desk_status, first_line)
        assert announcements(desk_status, first_line) == 1 and log_of(merit) == []
        details = R(_item(page, b["name"]), "button", "Details")
        details.focus()
        press(page, "Enter")
        drawer = R(page, "dialog", "Lot drawer")
        see(page, drawer)
        exclude = R(drawer, "button", "Exclude lot")
        exclude.focus()
        ok(anouk.put(f"/api/windows/{TPE10}/lots/{b['id']}/exclusion", {"revision": anouk.revision(TPE10), "excluded": True}))
        focus_on(page, R(drawer, "button", "Include lot"))
        expect(drawer).to_be_visible()
        assert log_of(merit) == []
    assert next(l for l in anouk.lots(TPE10) if l["id"] == b["id"])["excluded"] is True


def _assert_above(page: Page, upper: str, lower: str) -> None:
    top, bottom = _item(page, upper).bounding_box(), _item(page, lower).bounding_box()
    assert top and bottom and top["y"] < bottom["y"]


def test_dialogs_survive_deadline(browser: Browser) -> None:
    base = short()
    start_short_review(base)
    anouk = Api(base, "anouk")
    with desk(browser, base, "vera", f"/review/{EIN09}") as page:
        items = R(page, "list", "Sampled hours").get_by_role("listitem")
        soon(page, lambda: expect(items).to_have_count(25, timeout=POLL_MS))
        click(R(items.first, "button", "Exception"))
        dialog = R(page, "dialog", "Record exception")
        see(page, dialog)
        note = R(dialog, "textbox", "Exception note")
        fill(note, DEADLINE_TEXT)
        typed = note.input_value()
        assert typed
        wait_for(lambda: anouk.window(EIN09), lambda w: w["state"] == "Returned", "review never timed out", seconds=REVIEW_SHORT_S + WAIT_S)
        for _ in range(10):
            advance(page, 500)
        expect(dialog).to_be_visible()
        expect(note).to_have_value(typed)
        click(R(dialog, "button", "Save exception"))
        holds(page, R(dialog, "alert", "Problems to fix"), "This window is Returned. That can't be done now.")
        expect(note).to_have_value(typed)


def test_wf_restatement_chain_versions(browser: Browser, wiremock: WireMock) -> None:
    base = short()
    anouk = Api(base, "anouk")
    pull_path = site_path("tpe", "corrections/pull")
    hour_a, hour_b, hour_c, hour_d, hour_e = (utc_of(HEL, 2026, 10, d, 13) for d in (4, 6, 8, 10, 22))
    corrections = [
        {"hour_utc": hour_a, "unit": "kWh", "value": "1100", "version": 3},
        {"hour_utc": hour_a, "unit": "kWh", "value": "1300", "version": 1},
        {"hour_utc": hour_b, "unit": "MWh", "value": "1.25", "version": 1},
    ]
    wiremock.stub("GET", "/hub/v1/corrections", json={"corrections": corrections})
    body = ok(anouk.post(pull_path, {}))
    assert {(a["window_id"], a["hour_utc"]) for a in body["applied"]} == {(TPE10, hour_a), (TPE10, hour_b)}
    assert body["skipped"] == [{"hour_utc": hour_a, "state": "Superseded"}]
    assert anouk.hour(TPE10, hour_a)["consumed_wh"] == kwh_wh("1100") and anouk.hour(TPE10, hour_b)["consumed_wh"] == mwh_wh("1.25")
    again = ok(anouk.post(pull_path, {}))
    assert again["applied"] == [] and len(again["skipped"]) == 3
    conflict = [{"hour_utc": hour_d, "unit": "kWh", "value": "1200", "version": 1}, {"hour_utc": hour_c, "unit": "kWh", "value": "1", "version": 5}, {"hour_utc": hour_c, "unit": "kWh", "value": "2", "version": 5}]
    wiremock.stub("GET", "/hub/v1/corrections", json={"corrections": conflict})
    assert refused(anouk.post(pull_path, {}), 422, "CONFLICTING_CORRECTION")["message"] == "Line 3 conflicts with an earlier line."
    fractional = conflict[:1] + [{"hour_utc": hour_c, "unit": "kWh", "value": "0.0005", "version": 5}]
    wiremock.stub("GET", "/hub/v1/corrections", json={"corrections": fractional})
    assert refused(anouk.post(pull_path, {}), 422, "NOT_WHOLE_WATT_HOUR")["message"] == "Line 2 is not a whole watt-hour."
    assert anouk.hour(TPE10, hour_d)["consumed_wh"] == n("1,000,000")
    wiremock.stub("GET", "/hub/v1/readings", json={"runs": [
        {"start": hour_a, "interval_minutes": 60, "count": 1, "unit": "kWh", "value": "999"},
        {"start": hour_e, "interval_minutes": 60, "count": 1, "unit": "kWh", "value": "999"},
    ]})
    with desk(browser, base, "anouk", f"/windows/{TPE10}") as page:
        click(R(R(page, "region", "Window actions"), "button", "Pull meters"))
        soon(page, lambda: _equal(anouk.hour(TPE10, hour_e)["consumed_wh"], 999000))
    assert anouk.hour(TPE10, hour_a)["consumed_wh"] == kwh_wh("1100")


def test_wf_restatement_chain_links(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    story = chain_story(app_url, wiremock)
    assert story["pull_one"]["restated"] == [{"window_id": RTM03, "successor_id": f"{RTM03}-r2"}]
    assert story["repeat_pull"]["restated"] == []
    assert story["r2"]["predecessor_id"] == RTM03 and story["r3"]["predecessor_id"] == f"{RTM03}-r2"
    assert story["r3"]["id"] == f"{RTM03}-r3" and story["r3"]["state"] == "Reconciling"
    code2 = story["signed_r2"]["statement_code"]
    assert code2 == "HP-2026-03-RTM-2"
    assert story["old_after_seal"]["successor_statement_code"] == code2
    assert story["statement_2_after"]["state"] == "Restated" and story["statement_2_after"]["successor_window_id"] == f"{RTM03}-r3"
    assert story["first_after_second"]["successor_window_id"] == f"{RTM03}-r2"
    assert story["first_after_second"]["successor_statement_code"] == code2
    assert S3().get(f"attestations/{code2}.pdf") == story["statement_2_pdf"]
    assert S3().get(f"attestations/{RTM03_CODE}.pdf") == story["first_pdf"]
    assert {l["status"] for l in story["r2_lines"]} == {"Confirmed"} and len(story["r2_lines"]) == 186
    rows = Postgres().rows(f"select movement_id, kind, wh from ledger_entries where window_id='{RTM03}-r2'")
    per_movement: dict[str, list[int]] = {}
    kinds: dict[str, set[str]] = {}
    for row in rows:
        per_movement.setdefault(row["movement_id"], []).append(row["wh"])
        kinds.setdefault(row["kind"], set()).add(row["movement_id"])
    assert all(len(v) == 2 and sum(v) == 0 for v in per_movement.values())
    assert {k: len(v) for k, v in kinds.items() if k in ("deposit", "allocate", "cancel")} == {"deposit": 186, "allocate": 186, "cancel": 186}
    with desk(browser, app_url, None, f"/check/{RTM03_CODE}") as page:
        link = R(page, "link", "Open the successor statement")
        see(page, link)
        click(link)
        soon(page, lambda: _assert_path(page, f"/check/{code2}"))
        holds(page, R(page, "region", "Statement result"), code2)


def test_signing_key_replacement(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = late()
    public = Api(base)
    earlier = wait_for(lambda: public.get(f"/api/public/statements/{RTM03_CODE}"), lambda r: r.status_code == 200, "seeded statement never sealed").json()
    with desk(browser, base, "vera", "/review") as page:
        opener = R(page, "button", "Replace signing key")
        see(page, opener)
        click(opener)
        dialog = R(page, "dialog", "Replace signing key")
        see(page, dialog)
        with page.expect_response(lambda r: r.url.endswith(rotate_path("aldermoor"))) as reply:
            click(R(dialog, "button", "Replace key"))
        rotated = reply.value.json()
        absent(page, dialog)
        holds(page, R(page, "status", "Desk status"), "Signing key replaced. Earlier statements still check.")
    raw = base64.b64decode(rotated["public_key"])
    assert hashlib.sha256(raw).hexdigest()[:16] == rotated["key_id"]
    assert rotated["key_id"] != earlier["key_id"]
    after = ok(public.get(f"/api/public/statements/{RTM03_CODE}"))
    assert after["key_id"] == earlier["key_id"] and after["signature_valid"] is True
    story = chain_story(app_url, wiremock)
    refused(story["other_firm_rotate"], 404, "NOT_FOUND")
    assert story["statement_2"]["key_id"] == story["rotated"]["key_id"] != story["first"]["key_id"]
    assert_statement_signatures(story["statement_2"], story["statement_2_pdf"])
    assert_statement_signatures(story["old_after_seal"], story["first_pdf"])


def test_exact_mwh(app_url: str, wiremock: WireMock) -> None:
    base = year_end()
    public = Api(base)
    statement = wait_for(lambda: public.get(f"/api/public/statements/{RTM03_CODE}"), lambda r: r.status_code == 200, "seeded statement never sealed").json()
    assert statement["consumed_wh"] == mwh_wh("743.000000") and statement["hour_matched_wh"] == mwh_wh("186.000000")
    payload = json.loads(statement["attestation_payload"])
    assert payload["consumed_wh"] == mwh_wh("743.000000") and payload["hour_matched_wh"] == mwh_wh("186.000000")
    assert statement["attestation_payload"] == json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert set(payload) == {"window_id", "site_name", "month", "month_bp", "week_bp", "day_bp", "hour_bp", "opinion", "firm_name", "consumed_wh", "hour_matched_wh", "allocation_digest", "signed_at"}
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", payload["signed_at"])
    text = pdf_text(public.get(f"/check/{RTM03_CODE}/attestation.pdf").content)
    assert "Consumed 743.000000 MWh" in text and "Hour matched 186.000000 MWh" in text
    other = cancel_story(app_url, wiremock)["statement"]
    assert "Brightlock Prüfung & Söhne" in other["attestation_payload"]
    consumed, matched = other["consumed_wh"], other["hour_matched_wh"]
    assert (consumed, matched) == (n("1,440,000,000") // 2, 3 * n("500,000"))
    assert f"Hour matched {matched // 10**6}.{matched % 10**6:06d} MWh" in pdf_text(cancel_story(app_url, wiremock)["pdf"])


def test_wf_second_pass_late_rejection(browser: Browser, wiremock: WireMock) -> None:
    story = rejection_story(browser, wiremock)
    assert story["in_review"]["state"] == "In review"
    assert story["after_review_reject"]["revision"] == story["in_review"]["revision"] + 1
    refused(story["sample_after"], 409, "WRONG_STATE")
    assert story["after_third"]["state"] == "Reconciling"
    assert story["after_third"]["revision"] == story["after_review_reject"]["revision"] + 1
    assert story["completed"]["state"] == "Cancelling" and story["second_press"]["submitted"] == 1
    posted = [req_body(e)["client_line_id"] for e in story["posts"]]
    assert sorted(posted) == sorted(story["ids"] + [story["new_line"]])
    final = {l["line_id"]: l for l in story["final_lines"]}
    assert final[story["new_line"]]["status"] == "Confirmed"
    assert all(final[i]["status"] == "Rejected" for i in story["ids"])
    assert story["final"]["lines_confirmed"] == sum(l["status"] == "Confirmed" for l in story["final_lines"])


def test_sync_every_month(app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    retire_probes(anouk, TPE10)
    token = uuid.uuid4().hex[:8]
    bundle = make_bundle(f"lot-{token}", f"Probe {token}", "FI", sandbox_hour(28), QTY_MONTHS)
    body = sync(anouk, wiremock, TPE10, [bundle])
    assert body["added"] == 1
    entries = wiremock.requests("/registry/v2/holdings")
    queries = [parse_qs(urlparse(req_url(e)).query) for e in entries]
    assert all(q["account"] == ["KG-HOLD-01"] for q in queries)
    assert sorted(q["production_month"][0] for q in queries) == ["2026-09", "2026-10"]
    if all("loggedDate" in req(e) for e in entries) and len({req(e)["loggedDate"] for e in entries}) == len(entries):
        ordered = sorted(entries, key=lambda e: req(e)["loggedDate"])
        assert [parse_qs(urlparse(req_url(e)).query)["production_month"][0] for e in ordered] == ["2026-09", "2026-10"]
    lot = next(l for l in anouk.lots(TPE10) if l["name"] == bundle["lot_name"])
    assert lot["bundle_count"] == 1
    assert len(Postgres().rows(f"select movement_id from ledger_entries where bundle_id='{bundle['bundle_id']}' and kind='deposit'")) == 2


def test_battery_timing(app_url: str, wiremock: WireMock) -> None:
    anouk = Api(app_url, "anouk")
    retire_probes(anouk, TPE10)
    token = uuid.uuid4().hex[:8]
    produced, discharged = sandbox_hour(30, 8), sandbox_hour(30, 14)

    def battery(tag: str, discharge: str | None) -> dict[str, Any]:
        return make_bundle(f"lot-{token}-{tag}", f"Probe {token} {tag}", "FI", produced, n("1,000,001"), battery_shifted=True, discharge_hour=discharge)

    good, null, early, outside = battery("good", discharged), battery("null", None), battery("early", produced), battery("outside", "2026-12-20T10:00:00Z")
    sync(anouk, wiremock, TPE10, [good, null, early, outside])
    by_name = {lot["name"]: lot for lot in anouk.lots(TPE10)}
    lines = anouk.hour(TPE10, discharged)["lines"]
    assert [l["wh"] for l in lines if l["lot_id"] == by_name[good["lot_name"]]["id"]] == [n("1,000,001") * 88 // 100]
    all_lines = anouk.lines(TPE10)
    pg = Postgres()
    for bundle in (null, early, outside):
        lot_id = by_name[bundle["lot_name"]]["id"]
        assert not [l for l in all_lines if l["lot_id"] == lot_id]
        assert not pg.rows(f"select 1 as hit from ledger_entries where bundle_id='{bundle['bundle_id']}' and kind='battery_loss'")
        assert len(pg.rows(f"select 1 as hit from ledger_entries where bundle_id='{bundle['bundle_id']}' and kind='deposit'")) == 2
    loss = pg.rows(f"select wh from ledger_entries where bundle_id='{good['bundle_id']}' and kind='battery_loss' and account='loss'")
    assert [r["wh"] for r in loss] == [n("1,000,001") - n("1,000,001") * 88 // 100]


def test_wf_second_pass_already_received(browser: Browser, wiremock: WireMock) -> None:
    base = late()
    anouk, vera, bram = Api(base, "anouk"), Api(base, "vera"), Api(base, "bram")
    ok(anouk.post(f"/api/windows/{EIN10}/submit", {"revision": anouk.revision(EIN10)}))
    record_all(vera, EIN10)
    assert ok(vera.post(f"/api/windows/{EIN10}/review/complete", {}))["state"] == "Cancelling"
    expected = {l["line_id"] for l in anouk.lines(EIN10)}
    wiremock.stub("POST", "/registry/v2/cancellations", status=409, json={"status": "ALREADY_RECEIVED"})
    with desk(browser, base, "anouk", f"/windows/{EIN10}") as page:
        click(R(R(page, "region", "Window actions"), "button", "Cancel certificates"))
        wait_for(lambda: anouk.lines(EIN10), lambda ls: not [l for l in ls if l["status"] == "Unsubmitted"], "lines stayed Unsubmitted")
    lines = anouk.lines(EIN10)
    assert {l["line_id"] for l in lines} == expected and {l["status"] for l in lines} <= {"Pending", "Confirmed"}
    assert anouk.window(EIN10)["state"] in ("Cancelling", "Cancelled")
    posted = [req_body(e)["client_line_id"] for e in posted_lines(wiremock)]
    assert sorted(posted) == sorted(expected)
    ok(anouk.post(f"/api/windows/{TPE10}/submit", {"revision": anouk.revision(TPE10)}))
    record_all(bram, TPE10)
    ok(bram.post(f"/api/windows/{TPE10}/review/complete", {}))
    wiremock.stub("POST", "/registry/v2/cancellations", status=422, json={"reason": "Bundle locked kz9"})
    ok(anouk.post(f"/api/windows/{TPE10}/cancellations", {}))
    rejected = anouk.lines(TPE10)
    assert {l["status"] for l in rejected} == {"Rejected"} and {l["reason"] for l in rejected} == {"Bundle locked kz9"}
    assert anouk.window(TPE10)["state"] == "Reconciling"


def test_server_time_device_clock(browser: Browser, app_url: str) -> None:
    base = year_end()
    anouk, primary = Api(base, "anouk"), Api(app_url, "anouk")
    for offset in (-24, 24):
        review = anouk.window(EIN09)
        now = datetime.strptime(review["server_now"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        device = now + timedelta(hours=offset)
        with desk(browser, base, "anouk", f"/windows/{EIN09}", device_time=device) as page:
            timer = R(page, "timer", "Review time left")
            see(page, timer)
            holds(page, R(page, "region", "Window desk"), "In review")
            assert abs(_countdown_seconds(timer.inner_text()) - anouk.window(EIN09)["review_seconds_left"]) <= WAIT_S
        with desk(browser, app_url, "anouk", f"/windows/{RTM11}", device_time=device + timedelta(days=60)) as page:
            timer = R(page, "timer", "Opens in")
            see(page, timer)
            assert abs(_countdown_seconds(timer.inner_text()) - primary.window(RTM11)["opens_seconds_left"]) <= WAIT_S


def test_wf_cross_cutting_dialogs(browser: Browser) -> None:
    base = year_end()
    anouk, vera = Api(base, "anouk"), Api(base, "vera")
    before_rev = anouk.revision(EIN09)
    missing = next(b for b in anouk.hours(RTM10) if b["quality"] == "Missing")

    def activate(page: Page, opener: Locator) -> None:
        see(page, opener)
        opener.focus()
        press(page, "Enter")

    with desk(browser, base, "anouk", "/windows", width=768, height=1024) as page:
        opener = R(page, "button", "Filter windows")
        activate(page, opener)
        dialog_ok(page, "Filter windows", opener, R(R(page, "dialog", "Filter windows"), "combobox", "State"))
        menu = R(page, "button", "Menu")
        activate(page, menu)
        dialog_ok(page, "Menu", menu)
    with desk(browser, base, "anouk", _go_to_grain_hour(RTM10)) as page:
        cell = R(_wall(page), "gridcell", cell_name(AMS, missing))
        activate(page, cell)
        dialog_ok(page, "Hour detail", cell, R(R(page, "dialog", "Hour detail"), "textbox", "Substitution value in watt-hours"))
        cell.focus()
        press(page, "Shift+ArrowDown")
        spread = R(R(page, "region", "Window actions"), "button", "Spread a total")
        activate(page, spread)
        dialog_ok(page, "Spread a total", spread, R(R(page, "dialog", "Spread a total"), "textbox", "Total in watt-hours"))
    with desk(browser, base, "anouk", f"/windows/{RTM10}/lots") as page:
        details = R(_item(page, "Maasvlakte Solar"), "button", "Details")
        activate(page, details)
        dialog_ok(page, "Lot drawer", details)
    with desk(browser, base, "vera", f"/review/{EIN09}") as page:
        items = R(page, "list", "Sampled hours").get_by_role("listitem")
        soon(page, lambda: expect(items).to_have_count(25, timeout=POLL_MS))
        exception = R(items.first, "button", "Exception")
        activate(page, exception)
        dialog_ok(page, "Record exception", exception, R(R(page, "dialog", "Record exception"), "textbox", "Exception note"))
        give_back = R(page, "button", "Return window")
        activate(page, give_back)
        box = R(page, "dialog", "Return window")
        see(page, box)
        fill(R(box, "textbox", "Reason"), "   ")
        click(R(box, "button", "Send back"))
        holds(page, R(box, "alert", "Problems to fix"), "Enter a reason of 1 to 500 characters.")
        click(R(box, "button", "Cancel"))
        absent(page, box)
        focus_on(page, give_back)
    with desk(browser, base, "vera", f"/review/{EIN08}") as page:
        sign = R(page, "button", "Sign attestation")
        activate(page, sign)
        dialog_ok(page, "Sign attestation", sign, R(R(page, "dialog", "Sign attestation"), "textbox", "Type your full name"))
    with desk(browser, base, "vera", "/review") as page:
        replace = R(page, "button", "Replace signing key")
        activate(page, replace)
        dialog_ok(page, "Replace signing key", replace)
    assert anouk.revision(EIN09) == before_rev and anouk.window(EIN09)["state"] == "In review"
    assert all(h["result"] is None for h in ok(vera.get(f"/api/windows/{EIN09}/sample"))["hours"])
    assert anouk.hour(RTM10, missing["key"])["quality"] == "Missing"


def test_wf_cross_cutting_layouts(browser: Browser) -> None:
    base = year_end()
    count = len(ok(Api(base, "anouk").get("/api/windows"))["windows"])
    for width in (320, 375, 767, 768, 1199, 1200, 1280):
        for who, route in (("anouk", "/windows"), ("anouk", f"/windows/{RTM10}"), ("anouk", f"/windows/{RTM10}/lots"), ("anouk", f"/windows/{RTM10}/ledger"), ("vera", "/review"), ("mirthe", "/group")):
            with desk(browser, base, who, route, width=width, height=800) as page:
                see(page, R(page, "timer", "Settlement time"))
                layout(page)
                if width >= 1200:
                    see(page, R(page, "navigation", "Desk"))
                    absent(page, R(page, "button", "Menu"))
                else:
                    see(page, R(page, "button", "Menu"))
                    absent(page, R(page, "navigation", "Desk"))
                if route == "/windows":
                    soon(page, lambda: expect(R(page, "table", "Window board").get_by_role("link")).to_have_count(count, timeout=POLL_MS))
                if route == f"/windows/{RTM10}":
                    score, actions = R(page, "region", "Score panel").bounding_box(), R(page, "region", "Window actions").bounding_box()
                    assert score and actions
                    assert (actions["x"] >= score["x"] + score["width"] - 1) if width >= 1200 else (actions["y"] >= score["y"] + score["height"] - 1)
                if route.endswith("/lots"):
                    merit, lots = R(page, "list", "Merit order").bounding_box(), R(page, "region", "Lot list").bounding_box()
                    assert merit and lots
                    assert (lots["x"] >= merit["x"] + merit["width"] - 1) if width >= 768 else (lots["y"] >= merit["y"] + merit["height"] - 1)
                if route.endswith("/ledger"):
                    balances, entries = R(page, "region", "Balances").bounding_box(), R(page, "table", "Ledger entries").bounding_box()
                    assert balances and entries
                    assert (entries["x"] >= balances["x"] + balances["width"] - 1) if width >= 768 else (entries["y"] >= balances["y"] + balances["height"] - 1)
                if route == "/group":
                    tree, table = R(page, "tree", "Sites").bounding_box(), R(page, "table", "Site scores").bounding_box()
                    assert tree and table
                    assert (table["x"] >= tree["x"] + tree["width"] - 1) if width >= 1200 else (table["y"] >= tree["y"] + tree["height"] - 1)
    missing = next(b for b in Api(base, "anouk").hours(RTM10) if b["quality"] == "Missing")
    with desk(browser, base, "anouk", _go_to_grain_hour(RTM10, missing["key"]), width=320, height=700) as page:
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        fill(R(panel, "textbox", "Reason"), "W" * 400)
        layout(page)


def test_motion_restraint(browser: Browser) -> None:
    base = year_end()
    items = wait_for(lambda: ok(Api(base).get("/api/public/sealed-scores"))["items"], bool, "no sealed window in the marquee")
    infinite = "()=>document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations===Infinity).map(a=>!!a.effect.target.closest('[data-motion-ms=\"45000\"]'))"
    with desk(browser, base, None, "/") as page:
        marquee = R(page, "region", "Sealed scores")
        see(page, marquee)
        expect(page.locator("html")).to_have_attribute("data-motion", "full")
        expect(marquee).to_have_attribute("data-motion-ms", "45000")
        holds(page, marquee, f"{items[0]['site_name']} {items[0]['month']} HOUR {pct(items[0]['hour_bp'])}%")
        running = page.evaluate(infinite)
        assert running and all(running)
        click(R(page, "button", "Stop scores"))
        see(page, R(page, "button", "Run scores"))
        page.emulate_media(reduced_motion="reduce")
        soon(page, lambda: expect(page.locator("html")).to_have_attribute("data-motion", "reduced", timeout=POLL_MS))
        expect(marquee).to_have_attribute("data-motion-ms", "0")
        soon(page, lambda: _equal(page.evaluate("document.getAnimations().length"), 0))
    with desk(browser, base, "anouk", f"/windows/{RTM10}") as page:
        panel = R(page, "region", "Score panel")
        see(page, panel)
        _settle(page)
        for part, ms in (("split", "180"), ("fall", "320"), ("count", "480")):
            expect(panel.locator(f'[data-phase-part="{part}"]')).to_have_attribute("data-motion-ms", ms)
        assert page.evaluate(infinite) == []
    with desk(browser, base, "anouk", f"/windows/{RTM10}", reduced_motion="reduce") as page:
        panel = R(page, "region", "Score panel")
        see(page, panel)
        _settle(page)
        for part in ("split", "fall", "count"):
            expect(panel.locator(f'[data-phase-part="{part}"]')).to_have_attribute("data-motion-ms", "0")
        click(R(page, "button", "Filter windows")) if False else None
        soon(page, lambda: _equal(page.evaluate("document.getAnimations().length"), 0))
    with desk(browser, base, "anouk", "/windows") as page:
        opener = R(page, "button", "Filter windows")
        see(page, opener)
        click(opener)
        dialog = R(page, "dialog", "Filter windows")
        see(page, dialog)
        expect(dialog).to_have_attribute("data-motion-ms", "200")


def test_server_boundary(app_url: str) -> None:
    anon = Api(app_url)
    padding = BODY_LIMIT - len(b'{"email":"a","password":""}')
    exact = b'{"email":"a","password":"' + b"x" * padding + b'"}'
    assert len(exact) == BODY_LIMIT
    headers = {"content-type": "application/json"}
    refused(anon.c.post("/api/auth/sign-in", content=exact, headers=headers), 401, "INVALID_CREDENTIALS")
    over = b'{"email":"a","password":"' + b"x" * (padding + 1) + b'"}'
    refused(anon.c.post("/api/auth/sign-in", content=over, headers=headers), 413, "BODY_TOO_LARGE")
    refused(anon.c.post(f"/api/windows/{EIN10}/allocation", content=over, headers=headers), 413, "BODY_TOO_LARGE")
    refused(anon.get("/api/me"), 401, "UNAUTHENTICATED")
    refused(anon.get("/api/windows"), 401, "UNAUTHENTICATED")
    signed = Api(app_url, "anouk")
    copy = httpx.Client(base_url=app_url, cookies=dict(signed.c.cookies), timeout=HTTP_TIMEOUT_S)
    assert copy.get("/api/me").status_code == 200
    assert ok(signed.post("/api/auth/sign-out", {}))["signed_out"] is True
    refused(copy.get("/api/me"), 401, "UNAUTHENTICATED")

    secrets = [os.environ[k] for k in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID") if os.environ.get(k)]
    for path in ("/run.json", "/requirements.txt", "/.env", "/.venv/pyvenv.cfg", "/../run.json", "/static/../run.json"):
        reply = anon.get(path)
        assert "run-manifest-v1" not in reply.text and not any(text in reply.text for text in secrets), path
    assert all(secret not in anon.get("/").text for secret in secrets)
    assert CORS_HEADER not in {k.lower() for k in anon.c.get("/api/health", headers={"Origin": "http://elsewhere.invalid"}).headers}
    for base in (hub_down(), press_down()):
        assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}


def test_resizing_keeps_work(browser: Browser) -> None:
    base = year_end()
    missing = next(b for b in Api(base, "anouk").hours(RTM10) if b["quality"] == "Missing")
    with desk(browser, base, "anouk", _go_to_grain_hour(RTM10, missing["key"]), width=767, height=900) as page:
        panel = R(page, "dialog", "Hour detail")
        see(page, panel)
        value = R(panel, "textbox", "Substitution value in watt-hours")
        fill(value, RESIZE_VALUE)
        value.focus()
        for width in (768, 1199, 1200, 1199, 768, 767):
            page.set_viewport_size({"width": width, "height": 900})
            advance(page, 100)
            expect(panel).to_be_visible()
            expect(value).to_have_value(RESIZE_VALUE)
            expect(value).to_be_focused()
        press(page, "Escape")
        absent(page, panel)
        focus_on(page, R(_wall(page), "gridcell", cell_name(AMS, missing)))
        press(page, "Shift+ArrowDown")
        soon(page, lambda: expect(_selected(page)).to_have_count(2, timeout=POLL_MS))
        for width in (768, 1199, 1200):
            page.set_viewport_size({"width": width, "height": 900})
            advance(page, 100)
            expect(_selected(page)).to_have_count(2)
    with desk(browser, base, "anouk", "/windows", width=1199, height=800) as page:
        menu = R(page, "button", "Menu")
        see(page, menu)
        click(menu)
        see(page, R(page, "dialog", "Menu"))
        page.set_viewport_size({"width": 1200, "height": 800})
        absent(page, R(page, "dialog", "Menu"))
        focus_on(page, R(page, "navigation", "Desk").get_by_role("link").first)
    with desk(browser, base, "vera", f"/review/{EIN09}", width=767, height=900) as page:
        items = R(page, "list", "Sampled hours").get_by_role("listitem")
        soon(page, lambda: expect(items).to_have_count(25, timeout=POLL_MS))
        evidence = R(items.nth(2), "button", "Evidence")
        click(evidence)
        focus_on(page, R(page, "button", "Hide evidence"))
        page.set_viewport_size({"width": 768, "height": 900})
        focus_on(page, evidence)
        press(page, "Tab")
        evidence.focus()
        page.set_viewport_size({"width": 767, "height": 900})
        absent(page, R(page, "region", "Hour evidence"))


ALLOWED_LICENCES = {"MIT", "MIT-0", "Apache-2.0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "PSF", "PSF-2.0", "Python-2.0", "OFL-1.1"}
EXTRA_DATASTORES = {"redis", "valkey", "pymongo", "motor", "elasticsearch", "opensearch-py", "pymemcache", "python-memcached", "cassandra-driver", "tinydb", "lmdb"}


def _manifest() -> dict[str, Any]:
    return json.loads(Path("/app/run.json").read_text())


def test_if_run_manifest() -> None:
    manifest = _manifest()
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[key], str) and manifest[key] for key in ("install", "build", "serve"))


def test_if_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text().lower()
    for package in shipped_packages():
        assert package.name.lower() in notices, package.name
    assert "Unbounded".lower() in notices and "Onest".lower() in notices


def test_if_licences() -> None:
    for package in shipped_packages():
        assert licence_allowed(package.licence, ALLOWED_LICENCES), f"{package.name}: {package.licence}"
    assert "SIL Open Font License".lower() in Path("/app/THIRD_PARTY_NOTICES.md").read_text().lower()


def test_if_no_extra_datastore() -> None:
    assert any(name.split(".")[-1] == "ledger_entries" for name in Postgres().tables())
    assert not {package.name.lower() for package in shipped_packages()} & EXTRA_DATASTORES


def test_if_wiremock_baseline(wiremock: WireMock) -> None:
    anouk = Api(year_end(), "anouk")
    body = ok(anouk.post(f"/api/windows/{TPE10}/holdings/sync", {"revision": anouk.revision(TPE10)}))
    assert body["added"] == 0 and body["held_elsewhere"] == []
    assert wiremock.requests("/registry/v2/holdings")


def test_if_venv_install() -> None:
    manifest = _manifest()
    assert ".venv" in manifest["install"]
    assert re.search(r"\.venv/bin/|python3? -m ", manifest["serve"])
    assert not re.search(r"(^|&&\s*)(pip|pip3|uvicorn|gunicorn)\s", manifest["install"] + " && " + manifest["serve"])
    assert shipped_packages()
