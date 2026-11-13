from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

from conftest import (
    S3,
    Postgres,
    advance,
    center,
    held,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select,
    style,
    session,
    shipped_packages,
    tap,
)

APP_ROOT = Path("/app")
PASSWORD = "pass-word-1"
DEMO_PASSWORD = "spoorline-demo-1"
NY = "America/New_York"
START = datetime(2026, 3, 1, tzinfo=timezone.utc)
EXAMPLE_CHECK = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
ROLLOVER_AT = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
DST_SPRING_MIDNIGHT = datetime(2026, 3, 8, 5, 0, tzinfo=timezone.utc)
DST_FALL_MIDNIGHT = datetime(2026, 11, 1, 4, 0, tzinfo=timezone.utc)
PAGE_SIZE = 10
TAIL_BUFFER = 50
QUERY_MAX_LEN = 2000
QUERY_MAX_DEPTH = 8
WORK_MAX = 20000
BUDGET_MS = 3000
RESULT_WINDOW = 200
UPLOAD_MAX = 200000
JSON_MAX = 1000000
SNAPSHOT_TTL_MS = 300000
HOUR_MS = 3600000
DAY_MS = 86400000
WINDOW_5M_MS = 300000
ONE_MINUTE_MS = 60000
WARM_AFTER_MS = 60000
ARCHIVE_AFTER_MS = 120000
OBJECTIVE_WINDOW_MS = 2592000000
TRACE_MAX_SPANS = 500
SWIPE_MIN_PX = 80
SWIPE_MAX_DRIFT_PX = 40
QUARTER_MS = 250
GRID_MAX_ROWS = 60
COLUMN_DEFAULT_PX = 160
COLUMN_MESSAGE_PX = 480
COLUMN_STEP_PX = 16
COLUMN_MIN_PX = 60
PAGE_KEY_ROWS = 20
TABLET_MIN_PX = 768
DESK_MIN_PX = 1100
PHONE_SMALLEST_PX = 360
PHONE_HEIGHT_PX = 812
TARGET_MIN_PX = 44
GRADING_RATES = {"upload": 100000, "login": 100000, "search": 100000, "tail": 100000}
LICENCE_ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
RULES_ACCORDION = [
    "01 Streams and mappings", "02 Bulk upload", "03 Pipelines", "04 Text analysis", "05 Relevance",
    "06 Spoor Query", "07 Explore", "08 Moving data", "09 Spoor Pipe", "10 Lifecycle", "11 Alert rules",
    "12 Alert handling", "13 Traces and objectives", "14 Spaces and keys",
]
WORKSPACE_TABS = ["Explore", "Pipes", "Streams", "Pipelines", "Alerts", "Inbox", "Cases", "Traces", "Objectives", "Spaces", "Keys"]

TIMEOUT = 60
WAIT_S = 30
SSE_READ_S = 15
DEVICE_TIME = datetime(2031, 6, 1, 12, 0, tzinfo=timezone.utc)
FLAP_T = datetime(2026, 3, 2, tzinfo=timezone.utc)
SNOOZE_T = datetime(2026, 3, 3, tzinfo=timezone.utc)
MAINT_SET = datetime(2026, 3, 7, 12, 0, tzinfo=timezone.utc)
OBJ_T = datetime(2026, 3, 4, tzinfo=timezone.utc)
GRID_EVENTS = 70
SECOND_CASE = "Ledger lag"
NEEDLE = "needle"
MSG_FIELD = "msg"
SEEN_FIELD = "seen"
IPV4_SAMPLE = "10.0.0.1"
EMAIL_SAMPLE = "ana.b@ex-ample.co"
COOKIE_FLAGS = "HttpOnly; SameSite=Lax"


def group_label(group: str, state: str, *flags: str) -> str:
    return f"Group {group}, {state}" + "".join(f", {flag}" for flag in flags)


def case_label(number: int, title: str, status: str) -> str:
    return f"Case {number}: {title}, {status}"


def sort_by(column: str) -> str:
    return f"Sort by {column}"


def field_button(field: str, kind: str) -> str:
    return f"Field {field}, {kind}"


def pill_name(field: str, value: str, mode: str, state: str) -> str:
    return f"Filter {field}: {value}, {mode}, {state}"


def include_name(value: str) -> str:
    return f"Include {value}"


def step_name(k: int, processor: str) -> str:
    return f"Step {k} {processor}"


def span_label(name: str, duration: int, self_ms: int) -> str:
    return f"Span {name}, {duration} ms, self time {self_ms} ms"


def missing_stream(name: str) -> str:
    return f"Stream {name} doesn't exist in this space."


FOREIGN_FIELD = "zzfield"
KEY_NAME = "edge-shipper"


def event_id(i: int) -> str:
    return f"d{i:02d}"


def event_text(i: int) -> str:
    return f"m{i:02d}"


def bucket_label(when: datetime, *, seconds: bool = False, dated: bool = False, zone: str = "UTC") -> str:
    full = shown(when, zone)
    clock = full[11:19] if seconds else full[11:16]
    return (full[:10] + " " if dated else "") + clock + " " + full[20:]
WORK_TOKENS = 25000
EXPIRY_EVENTS = 600
SWIPE_PAST_PX = 100
SWIPE_SHORT_PX = 50
DRIFT_SMALL_PX = 10
DRIFT_LARGE_PX = 60
TAIL_BURST = 55
UPLOAD_LINES = 25
SEARCH_DENYLIST = {
    "@opensearch-project/opensearch", "lunr", "flexsearch",
    "minisearch", "fuse.js", "meilisearch", "typesense", "@orama/orama", "wink-bm25-text-search",
    "natural", "redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3",
    "kafkajs", "amqplib", "bullmq", "lokijs", "nedb",
}

MOTION_HOOK = """
(() => {
  if (window.__spoorAnims) return;
  window.__spoorAnims = [];
  window.__spoorCss = 0;
  const seen = new Set();
  const keep = (a) => { if (a && !seen.has(a)) { seen.add(a); window.__spoorAnims.push(a); } return a; };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { return keep(animate.apply(this, args)); };
  const play = Animation.prototype.play;
  Animation.prototype.play = function (...args) { keep(this); return play.apply(this, args); };
  for (const type of ['transitionrun', 'animationstart']) {
    window.addEventListener(type, () => { window.__spoorCss += 1; }, true);
  }
})();
"""


def nm(prefix: str) -> str:
    return prefix + uuid.uuid4().hex[:10]


def iso(dt: datetime) -> str:
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def epoch_ms(dt: datetime) -> int:
    return int(round(dt.timestamp() * 1000))


def shown(dt: datetime, zone: str = "UTC") -> str:
    local = dt.astimezone(ZoneInfo(zone))
    offset = local.utcoffset() or timedelta(0)
    minutes = int(offset.total_seconds()) // 60
    sign = "+" if minutes >= 0 else "-"
    minutes = abs(minutes)
    return local.strftime("%Y-%m-%d %H:%M:%S") + f" {sign}{minutes // 60:02d}:{minutes % 60:02d}"


def half_up(value: Decimal, places: int) -> str:
    return str(value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def ev(ident: str, when: datetime, **fields: Any) -> dict[str, Any]:
    return {"_id": ident, "@timestamp": iso(when), **fields}


def items_of(body: Any) -> list[dict[str, Any]]:
    if isinstance(body, list):
        return body
    for value in body.values():
        if isinstance(value, list):
            return value
    pytest.fail(f"expected a list in {body!r}")


def poll(check: Callable[[], bool], what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except Exception as exc:
            last = exc
    pytest.fail(f"Timed out after {seconds}s waiting for: {what} (last error: {last})")


def seed(app_url: str, body: dict[str, Any]) -> dict[str, Any]:
    r = post_json(app_url, "/api/grading/seed", body)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code}: {r.text[:800]}"
    return r.json()


def set_rates(app_url: str, rates: dict[str, int]) -> None:
    seed(app_url, {"rates": rates})


def set_clock(app_url: str, when: datetime) -> None:
    r = post_json(app_url, "/api/grading/clock", {"set_ms": epoch_ms(when)})
    assert r.status_code == 200, f"POST /api/grading/clock answered {r.status_code}: {r.text}"


def storage(app_url: str, down: bool) -> None:
    r = post_json(app_url, "/api/grading/storage", {"down": down})
    assert r.status_code == 200, r.text
    assert r.json()["storage"] == ("down" if down else "up")


def hot(events: list[dict[str, Any]], created: datetime | None = None) -> list[dict[str, Any]]:
    return [{"number": 1, "phase": "hot", "created_at": iso(created or START - timedelta(days=20)),
             "rolled_over_at": None, "events": events}]


def stream(name: str, events: list[dict[str, Any]] | tuple = (), mappings: dict[str, str] | None = None,
           lifecycle: dict[str, Any] | None = None, generations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"name": name, "mappings": mappings or {}, "generations": generations or hot(list(events))}
    if lifecycle is not None:
        body["lifecycle"] = lifecycle
    return body


def world(app_url: str, *, members: tuple[tuple[str, str], ...] = (("admin", "UTC"),),
          streams: list[dict[str, Any]] | tuple = (), **sections: list[dict[str, Any]]) -> dict[str, Any]:
    slug = nm("s")
    users = [nm("u") for _ in members]
    body: dict[str, Any] = {
        "users": [{"username": u, "password": PASSWORD, "time_zone": tz} for u, (_, tz) in zip(users, members)],
        "spaces": [{"slug": slug, "name": "Space " + slug,
                    "members": [{"username": u, "role": role} for u, (role, _) in zip(users, members)]}],
    }
    if streams:
        body["streams"] = [{"space": slug, **s} for s in streams]
    for key, items in sections.items():
        body[key] = [{"space": slug, **item} for item in items]
    out = seed(app_url, body)
    return {"space": slug, "name": "Space " + slug, "users": users, "user": users[0], "seed": out}


def rule_body(stream_name: str, *, name: str = "High errors", window_ms: int = WINDOW_5M_MS, threshold: int = 5,
              frequency: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"name": name, "stream": stream_name, "filter": None, "measure": "count", "measure_field": None,
            "group_by": "host", "window_ms": window_ms, "comparison": ">", "threshold": threshold,
            "frequency": frequency or {"kind": "change"}}


def run_check(app_url: str, rule_id: Any, when: datetime | None = None, fail: bool = False) -> tuple[dict, dict]:
    if when is not None:
        set_clock(app_url, when)
    body: dict[str, Any] = {"rule": rule_id}
    if fail:
        body["fail"] = True
    r = post_json(app_url, "/api/grading/check", body)
    assert r.status_code == 200, f"POST /api/grading/check answered {r.status_code}: {r.text}"
    data = r.json()
    return data, {g["group"]: g for g in data["groups"]}


def lifecycle_step(app_url: str, space: str, stream_name: str) -> dict[int, dict[str, Any]]:
    r = post_json(app_url, "/api/grading/lifecycle", {"stream": stream_name, "space": space})
    assert r.status_code == 200, f"POST /api/grading/lifecycle answered {r.status_code}: {r.text}"
    return {g["number"]: g for g in r.json()["generations"]}


class Api:

    def __init__(self, base: str, username: str, space: str) -> None:
        self.base, self.username, self.space = base, username, space
        self.http = httpx.Client(base_url=base, timeout=TIMEOUT)
        r = self.http.post("/api/grading/session", json={"username": username})
        assert r.status_code == 200, f"POST /api/grading/session answered {r.status_code}: {r.text}"

    def _params(self, params: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {"space": self.space}
        out.update({k: v for k, v in params.items() if v is not None})
        return out

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.http.get(path, params=self._params(params))

    def post(self, path: str, body: Any = None, **params: Any) -> httpx.Response:
        return self.http.post(path, json=body, params=self._params(params))

    def put(self, path: str, body: Any = None, **params: Any) -> httpx.Response:
        return self.http.put(path, json=body, params=self._params(params))

    def patch(self, path: str, body: Any = None, **params: Any) -> httpx.Response:
        return self.http.patch(path, json=body, params=self._params(params))

    def delete(self, path: str, **params: Any) -> httpx.Response:
        return self.http.delete(path, params=self._params(params))

    def bulk(self, stream_name: str, lines: list[Any], pipeline: str | None = None) -> httpx.Response:
        text = "\n".join(line if isinstance(line, str) else json.dumps(line) for line in lines)
        return self.http.post(f"/api/streams/{stream_name}/bulk", content=text.encode(),
                              headers={"content-type": "application/x-ndjson"},
                              params=self._params({"pipeline": pipeline}))

    def upload(self, stream_name: str, filename: str, content: bytes) -> httpx.Response:
        return self.http.post(f"/api/streams/{stream_name}/uploads", params=self._params({}),
                              files={"file": (filename, content, "application/x-ndjson")})

    def search(self, stream_name: str, start: datetime, end: datetime, q: str = "", **extra: Any) -> httpx.Response:
        return self.get("/api/search", stream=stream_name, q=q, **{"from": iso(start), "to": iso(end)}, **extra)


def created_ok(resp: httpx.Response, status: int = 201) -> dict[str, Any]:
    assert resp.status_code == status, f"{resp.request.method} {resp.request.url.path} answered {resp.status_code}: {resp.text[:600]}"
    return resp.json()


def api_error(resp: httpx.Response, status: int, code: str, message: str | None = None) -> dict[str, Any]:
    assert resp.status_code == status, f"expected {status} {code}, got {resp.status_code}: {resp.text[:600]}"
    body = resp.json()
    assert body["error"] == code, body
    assert isinstance(body["message"], str), body
    if message is not None:
        assert body["message"] == message, body
    return body


class Sse:

    def __init__(self, base: str, cookies: httpx.Cookies, path: str, params: dict[str, Any]) -> None:
        self.events: list[tuple[str, str, str]] = []
        self.comments = 0
        self.status: int | None = None
        self.error: Exception | None = None
        self.cond = threading.Condition()
        self.stop = threading.Event()
        self.http = httpx.Client(base_url=base, cookies=cookies, timeout=httpx.Timeout(TIMEOUT, read=SSE_READ_S))
        self.thread = threading.Thread(target=self._run, args=(path, params), daemon=True)
        self.thread.start()

    def _run(self, path: str, params: dict[str, Any]) -> None:
        try:
            with self.http.stream("GET", path, params=params) as resp:
                with self.cond:
                    self.status = resp.status_code
                    self.cond.notify_all()
                if resp.status_code != 200:
                    return
                event, ident, data = "message", "", []
                for line in resp.iter_lines():
                    if self.stop.is_set():
                        return
                    with self.cond:
                        if line == "":
                            if data:
                                self.events.append((event, ident, "\n".join(data)))
                            event, ident, data = "message", "", []
                        elif line.startswith(":"):
                            self.comments += 1
                        elif line.startswith("event:"):
                            event = line[6:].strip()
                        elif line.startswith("id:"):
                            ident = line[3:].strip()
                        elif line.startswith("data:"):
                            data.append(line[5:].lstrip())
                        self.cond.notify_all()
        except Exception as exc:
            with self.cond:
                self.error = exc
                self.cond.notify_all()

    def wait(self, predicate: Callable[["Sse"], bool], what: str, seconds: float = WAIT_S) -> None:
        deadline = time.monotonic() + seconds
        with self.cond:
            while not predicate(self):
                left = deadline - time.monotonic()
                if left <= 0:
                    pytest.fail(f"event stream: {what}; status={self.status} error={self.error} last={self.events[-5:]}")
                self.cond.wait(left)

    def named(self, name: str) -> list[dict[str, Any]]:
        return [json.loads(d) for e, _, d in self.events if e == name]

    def close(self) -> None:
        self.stop.set()
        self.http.close()


@contextmanager
def signed_in(browser: Browser, app_url: str, username: str, path: str, *, space: str | None = None,
              width: int = 1280, height: int = 800, reduced_motion: str = "no-preference",
              device_time: datetime | None = None) -> Iterator[Page]:
    with open_app(browser, app_url + "/signin", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": width, "height": height})
        r = page.request.post(app_url + "/api/grading/session", data={"username": username})
        assert r.status == 200, r.text()
        if space:
            r = page.request.patch(app_url + "/api/me", data={"space": space})
            assert r.status == 200, r.text()
        if device_time is not None:
            page.clock.set_system_time(device_time)
        page.add_init_script(MOTION_HOOK)
        page.goto(app_url + path)
        yield page


def wait_for(page: Page, check: Callable[[], bool], what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except Exception as exc:
            last = exc
        advance(page, 100)
    pytest.fail(f"Timed out after {seconds}s waiting for: {what} (last error: {last})")


def shows(page: Page, loc: Locator, text: str | None = None, what: str = "") -> None:
    def ok() -> bool:
        if loc.count() == 0 or not loc.first.is_visible():
            return False
        return text is None or text in loc.first.inner_text()
    wait_for(page, ok, what or f"{loc} showing {text!r}")


def gone(page: Page, loc: Locator, what: str) -> None:
    wait_for(page, lambda: loc.count() == 0 or not loc.first.is_visible(), what)


def announced(page: Page, sentence: str) -> None:
    shows(page, page.get_by_role("status", name="Announcements"), sentence, f"announcement {sentence!r}")


def settled(page: Page) -> None:
    main = page.get_by_role("main")
    wait_for(page, lambda: main.get_attribute("data-pending") == "0", "<main data-pending> back to 0")


def focus_in(loc: Locator) -> bool:
    return bool(loc.first.evaluate("el => el === document.activeElement || el.contains(document.activeElement)"))


def tab_into(page: Page, region: Locator, presses: int = 40) -> None:
    for _ in range(presses):
        if focus_in(region):
            return
        page.keyboard.press("Tab")
    if not focus_in(region):
        pytest.fail(f"Tab never reached {region}")


def animations_on(loc: Locator, ident: str) -> list[float]:
    return loc.first.evaluate(
        """(el, ident) => (window.__spoorAnims || []).filter(a => {
            const t = a.effect && a.effect.target;
            return a.id === ident && t && (t === el || el.contains(t) || t.contains(el));
        }).map(a => Number(a.effect.getTiming().duration) || 0)""",
        ident,
    )


def reset_motion(page: Page) -> None:
    page.evaluate("() => { window.__spoorAnims = []; window.__spoorCss = 0; }")


def no_motion(page: Page) -> bool:
    return bool(page.evaluate(
        "() => (window.__spoorAnims || []).length === 0 && (window.__spoorCss || 0) === 0 && document.getAnimations().length === 0"))


def finish_motion(page: Page) -> None:
    page.evaluate("() => document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} })")


def pick_stream(page: Page, name: str) -> None:
    box = page.get_by_role("combobox", name="Stream")
    shows(page, box, what="combobox Stream")
    select(box, name)


def open_range(page: Page) -> Locator:
    page.get_by_role("button", name="Time range").click()
    dialog = page.get_by_role("dialog", name="Time range")
    shows(page, dialog, what="dialog Time range")
    return dialog


def quick_range(page: Page, label: str) -> None:
    dialog = open_range(page)
    dialog.get_by_role("tab", name="Quick").click()
    dialog.get_by_role("radio", name=label).check()
    dialog.get_by_role("button", name="Apply").click()
    gone(page, dialog, "dialog Time range closes on Apply")


def absolute_range(page: Page, start: str, end: str, close: bool = True) -> Locator:
    dialog = open_range(page)
    dialog.get_by_role("tab", name="Absolute").click()
    dialog.get_by_role("textbox", name="From", exact=True).fill(start)
    dialog.get_by_role("textbox", name="To", exact=True).fill(end)
    dialog.get_by_role("button", name="Apply").click()
    if close:
        gone(page, dialog, "dialog Time range closes on Apply")
    return dialog


def open_search(page: Page, name: str, *, hours: int | None = None, start: datetime | None = None, end: datetime | None = None) -> None:
    base = "{0.scheme}://{0.netloc}".format(urlparse(page.url))
    params: dict[str, str] = {"stream": name}
    if hours is not None:
        now = datetime.fromtimestamp(httpx.get(base + "/api/time", timeout=TIMEOUT).json()["now_ms"] / 1000, timezone.utc)
        start, end = now - timedelta(hours=hours), now
    if start is not None and end is not None:
        params.update({"from": iso(start), "to": iso(end)})
    page.goto(base + "/explore?" + urlencode(params))


def run_query(page: Page, text: str) -> None:
    box = page.get_by_role("combobox", name="Query")
    box.fill(text)
    box.press("Enter")


def grid(page: Page) -> Locator:
    return page.get_by_role("grid", name="Events")


def event_row(scope: Locator, prefix: str) -> Locator:
    return scope.get_by_role("row", name=re.compile("^" + re.escape(prefix)))


def histogram_buckets(page: Page) -> Locator:
    return page.get_by_role("group", name="Histogram").get_by_role("button", name=re.compile(r"^Bucket "))


def swipe(page: Page, card: Locator, dx: float, dy: float) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    x, y = center(card)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for i in range(1, 11):
        cdp.send("Input.dispatchTouchEvent",
                 {"type": "touchMove", "touchPoints": [{"x": x + dx * i / 10, "y": y + dy * i / 10}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def upload_file(page: Page, path: Path) -> None:
    button = page.get_by_role("button", name="Upload file")
    with page.expect_file_chooser() as chooser:
        button.click()
    chooser.value.set_files(str(path))
    started = lambda: (page.get_by_role("table", name="Uploads").get_by_role("row").filter(has_text=path.name).count() > 0
                       or page.get_by_role("alert").count() > 0)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and not started():
        advance(page, 100)
    if not started():
        button.click()


def to_bucket(page: Page, buckets: Locator, k: int) -> None:
    tab_into(page, page.get_by_role("group", name="Histogram"))
    for _ in range(buckets.count()):
        at = buckets.evaluate_all("els => els.indexOf(document.activeElement)")
        if at == k:
            return
        page.keyboard.press("ArrowRight" if at < k else "ArrowLeft")
    pytest.fail(f"arrows never reached bucket {k}")


def test_wf_cross_cutting_health_boundary(app_url: str) -> None:
    with httpx.Client(base_url=app_url, timeout=TIMEOUT) as http:
        health = http.get("/api/health")
        assert health.status_code == 200 and health.json() == {"status": "ok"}, health.text
        assert not any(k.lower().startswith("access-control-") for k in health.headers), dict(health.headers)
        for name in ("run.json", "package-lock.json", "package.json"):
            served = http.get("/" + name)
            assert not any(k.lower().startswith("access-control-") for k in served.headers), dict(served.headers)
            assert "run-manifest-v1" not in served.text, f"/{name} served the run manifest"
            local = APP_ROOT / name
            if served.status_code == 200 and local.exists():
                head = local.read_text(errors="replace")[:300]
                assert head.strip() == "" or head not in served.text, f"/{name} served the file from /app"
        config = http.get("/api/config")
        assert config.status_code == 200 and config.json()["grading"] is True


def test_health_on_storage_outage(app_url: str) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    with httpx.Client(base_url=down, timeout=TIMEOUT) as http:
        health = http.get("/api/health")
        assert health.status_code == 200 and health.json() == {"status": "unavailable"}, health.text
        signin = http.post("/api/signin", json={"username": "ines", "password": DEMO_PASSWORD})
        assert signin.status_code == 200, signin.text
        assert http.get("/api/streams", params={"space": "ops"}).status_code == 200


def test_wf_cross_cutting_signin_landing(browser: Browser, app_url: str) -> None:
    username = nm("v")
    with open_app(browser, app_url + "/signup") as page:
        page.get_by_role("textbox", name="Username").fill(username)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Create account").click()
        wait_for(page, lambda: urlparse(page.url).path == "/explore", "sign-up lands on /explore")
        page.reload()
        wait_for(page, lambda: urlparse(page.url).path == "/explore" and page.get_by_role("banner").count() > 0,
                 "reloading /explore shows Explore")
        shows(page, page.get_by_role("banner"), "Spoorline")
        cookie = {c["name"]: c for c in page.context.cookies()}.get("spoor_session")
        assert cookie is not None, "no spoor_session cookie"
        assert cookie["httpOnly"] and cookie["sameSite"] == "Lax" and not cookie["secure"], cookie
    with open_app(browser, app_url + "/alerts") as page:
        wait_for(page, lambda: urlparse(page.url).path == "/signin", "signed-out visitor sent to /signin")
        page.get_by_role("textbox", name="Username").fill(username.upper())
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        wait_for(page, lambda: urlparse(page.url).path == "/explore", "sign-in (any case) lands on /explore")
        page.reload()
        wait_for(page, lambda: urlparse(page.url).path == "/explore" and page.get_by_role("banner").count() > 0,
                 "reload keeps /explore")
    r = httpx.post(app_url + "/api/signin", json={"username": username, "password": PASSWORD}, timeout=TIMEOUT)
    assert r.status_code == 200 and r.json()["username"] == username and r.json()["space"] == username, r.text
    parts = [p.strip().lower() for p in r.headers.get("set-cookie", "").split(";")]
    assert parts[0].startswith("spoor_session="), parts
    flags = [f.lower() for f in COOKIE_FLAGS.split("; ")]
    assert all(f in parts for f in flags) and "Secure".lower() not in parts, parts


def test_wf_cross_cutting_signin_keyboard(browser: Browser, app_url: str) -> None:
    w = world(app_url)
    with open_app(browser, app_url + "/signin") as page:
        user, password = page.get_by_role("textbox", name="Username"), page.get_by_label("Password", exact=True)
        shows(page, user)
        user.focus()
        page.keyboard.type(w["user"])
        page.keyboard.press("Tab")
        wait_for(page, lambda: focus_in(password), "Tab moves from Username to Password")
        page.keyboard.type(PASSWORD + "x")
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("alert", name="Error"), "Username or password is wrong.")
        assert urlparse(page.url).path == "/signin"
        password.fill(PASSWORD)
        password.focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: urlparse(page.url).path == "/explore", "Enter signs in and lands on /explore")
        link = page.get_by_role("navigation", name="Workspace").get_by_role("link", name="Explore")
        wait_for(page, lambda: link.get_attribute("aria-current") == "page", "Explore is the current tab")


def test_wf_cross_cutting_space_switch(browser: Browser, app_url: str) -> None:
    w = world(app_url, cases=[{"title": "Checkout errors", "status": "open"}])
    other = nm("s")
    seed(app_url, {"spaces": [{"slug": other, "name": "Space " + other, "members": [{"username": w["user"], "role": "admin"}]}],
                   "cases": [{"space": other, "title": SECOND_CASE, "status": "open"}]})
    with signed_in(browser, app_url, w["user"], "/cases", space=w["space"]) as page:
        table = page.get_by_role("table", name="Cases")
        shows(page, table, "Checkout errors")
        opener = page.get_by_role("banner").get_by_role("button", name="Space")
        opener.focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu", name="Spaces")
        shows(page, menu)
        page.keyboard.press("Escape")
        gone(page, menu, "Escape closes the menu")
        wait_for(page, lambda: focus_in(opener), "Escape returns focus to Space")
        opener.click()
        menu.get_by_role("menuitemradio", name="Space " + other).click()
        shows(page, table, SECOND_CASE)
        assert "Checkout errors" not in table.inner_text()
        assert urlparse(page.url).path == "/cases", "the page stays on the same route"


def test_wf_cross_cutting_load_failed_retry(browser: Browser, app_url: str) -> None:
    w = world(app_url, cases=[{"title": "Checkout errors", "status": "open"}])
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        page.route("**/api/cases**", lambda route: route.abort())
        page.goto(app_url + "/cases")
        failed = page.get_by_role("alert", name="Load failed")
        shows(page, failed, "Spoorline can't reach the server. Retry when your connection is back.")
        page.unroute("**/api/cases**")
        failed.get_by_role("button", name="Retry").focus()
        page.keyboard.press("Enter")
        gone(page, failed, "Retry clears the failure")
        shows(page, page.get_by_role("table", name="Cases"), "Checkout errors")


def test_wf_cross_cutting_tabs_and_rules(browser: Browser, app_url: str) -> None:
    w = world(app_url)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        nav = page.get_by_role("navigation", name="Workspace")
        link = nav.get_by_role("link", name="Alerts")
        shows(page, link)
        reset_motion(page)
        link.focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: urlparse(page.url).path == "/alerts", "Enter on a tab moves to its route")
        wait_for(page, lambda: nav.get_by_role("link", name="Alerts").get_attribute("aria-current") == "page", "Alerts is current")
        assert nav.get_by_role("link", name="Explore").get_attribute("aria-current") != "page"
        wait_for(page, lambda: len(animations_on(nav, "tab-slide")) > 0, "tab-slide runs on the underline")
        settled(page)
        page.get_by_role("contentinfo").get_by_role("link", name=re.compile("rules", re.I)).click()
        wait_for(page, lambda: urlparse(page.url).path == "/rules", "the footer link opens /rules")
        row = page.get_by_role("button", name="01 Streams and mappings")
        shows(page, row)
        assert page.get_by_role("main").get_attribute("data-seq") is not None
        row.focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: row.get_attribute("aria-expanded") == "true", "Enter opens the rule")


def test_account_rules_and_signin_limit(app_url: str) -> None:
    username = nm("w")
    with httpx.Client(base_url=app_url, timeout=TIMEOUT) as http:
        bad = api_error(http.post("/api/signup", json={"username": "ab", "password": PASSWORD}), 422, "invalid")
        assert bad["fields"]["username"] == "Use 3 to 24 characters: a-z, 0-9 or _."
        short = api_error(http.post("/api/signup", json={"username": username, "password": "short"}), 422, "invalid")
        assert short["fields"]["password"] == "Use at least 8 characters."
        made = created_ok(http.post("/api/signup", json={"username": username, "password": PASSWORD}))
        assert made["username"] == username and made["space"] == username
        me = http.get("/api/me").json()
        assert me["space"]["slug"] == username and me["space"]["role"] == "admin" and me["time_zone"] == "UTC"
    with httpx.Client(base_url=app_url, timeout=TIMEOUT) as other:
        taken = api_error(other.post("/api/signup", json={"username": username, "password": PASSWORD}), 409, "name_taken")
        assert taken["fields"]["username"] == "That username is taken."
    set_clock(app_url, START)
    set_rates(app_url, {**GRADING_RATES, "login": 3})
    try:
        with httpx.Client(base_url=app_url, timeout=TIMEOUT) as http:
            api_error(http.post("/api/signin", json={"username": username, "password": "wrong-pass-1"}),
                      401, "bad_credentials", "Username or password is wrong.")
            assert http.post("/api/signin", json={"username": username, "password": PASSWORD}).status_code == 200
            api_error(http.post("/api/signin", json={"username": username, "password": "wrong-pass-1"}), 401, "bad_credentials")
            limited = http.post("/api/signin", json={"username": username, "password": "wrong-pass-1"})
            api_error(limited, 429, "rate_limited", "Too many requests. Try again in 60 seconds.")
            assert limited.headers.get("retry-after") == "60"
            api_error(http.post("/api/signin", json={"username": username, "password": PASSWORD}), 429, "rate_limited")
    finally:
        set_rates(app_url, GRADING_RATES)


def test_grading_routes_and_live_seq(browser: Browser, app_url: str) -> None:
    target = START + timedelta(hours=5)
    r = post_json(app_url, "/api/grading/clock", {"set_ms": epoch_ms(target)})
    assert r.status_code == 200 and r.json()["now"] == iso(target) and r.json()["now_ms"] == epoch_ms(target), r.text
    now = httpx.get(app_url + "/api/time", timeout=TIMEOUT).json()
    assert now["now"] == iso(target) and now["now_ms"] == epoch_ms(target)
    r = post_json(app_url, "/api/grading/clock", {"advance_ms": 1000})
    assert r.json()["now_ms"] == epoch_ms(target) + 1000
    try:
        storage(app_url, True)
        assert httpx.get(app_url + "/api/health", timeout=TIMEOUT).json() == {"status": "unavailable"}
    finally:
        storage(app_url, False)
    assert httpx.get(app_url + "/api/health", timeout=TIMEOUT).json() == {"status": "ok"}
    w = world(app_url, members=(("admin", "UTC"), ("viewer", "UTC")))
    assert {u["username"] for u in w["seed"]["users"]} == set(w["users"])
    assert [s["slug"] for s in w["seed"]["spaces"]] == [w["space"]]
    assert not w["seed"].get("streams") and not w["seed"].get("rules")
    again = post_json(app_url, "/api/grading/seed",
                      {"users": [{"username": w["user"], "password": PASSWORD, "time_zone": "UTC"}]})
    api_error(again, 409, "name_taken")
    api = Api(app_url, w["user"], w["space"])
    assert api.get("/api/me").json()["username"] == w["user"]
    sse = Sse(app_url, api.http.cookies, "/api/events", {"space": w["space"]})
    try:
        sse.wait(lambda s: s.status is not None, "GET /api/events answers")
        assert sse.status == 200
        with signed_in(browser, app_url, w["user"], "/cases", space=w["space"]) as page:
            main = page.get_by_role("main")
            wait_for(page, lambda: main.get_attribute("data-seq") is not None and main.get_attribute("data-pending") == "0",
                     "<main> carries data-seq and data-pending=0")
            shows(page, page.get_by_role("region", name="Empty"), "No cases yet.")
            made = created_ok(api.post("/api/cases", {"title": "Checkout errors"}))
            assert made["number"] == 1 and made["status"] == "open"
            seq = made["seq"]
            shows(page, page.get_by_role("table", name="Cases").get_by_role("row", name=case_label(1, "Checkout errors", "open")))
            wait_for(page, lambda: main.get_attribute("data-seq") == str(seq), f"data-seq becomes {seq} without reload")
            sse.wait(lambda s: any(e == "case" and i == str(seq) and json.loads(d).get("seq") == seq
                                   for e, i, d in s.events), f"a case message with id {seq}")
            page.get_by_role("button", name="New case").first.click()
            dialog = page.get_by_role("dialog", name="New case")
            shows(page, dialog)
            dialog.get_by_role("textbox", name="Case title").fill(SECOND_CASE)
            with held(page, "**/api/cases**") as gate:
                dialog.get_by_role("button", name="Create case").click()
                wait_for(page, lambda: main.get_attribute("data-pending") == "1", "data-pending counts the held write")
                gate.release()
            settled(page)
            announced(page, "Case 2 created.")
            shows(page, page.get_by_role("table", name="Cases").get_by_role("row", name=case_label(made["number"] + 1, SECOND_CASE, "open")))
    finally:
        sse.close()


def test_error_shape_and_order(app_url: str) -> None:
    w = world(app_url, members=(("viewer", "UTC"), ("admin", "UTC")))
    other = world(app_url)
    viewer, admin = Api(app_url, w["users"][0], w["space"]), Api(app_url, w["users"][1], w["space"])
    with httpx.Client(base_url=app_url, timeout=TIMEOUT) as anon:
        body = api_error(anon.get("/api/streams", params={"space": w["space"]}), 401, "unauthenticated", "Sign in to continue.")
        assert set(body) == {"error", "message"}
        prefix, suffix = '{"title":"', '"}'
        pad = JSON_MAX - len(prefix) - len(suffix)
        exact = (prefix + "a" * pad + suffix).encode()
        assert len(exact) == JSON_MAX
        hdr = {"content-type": "application/json"}
        api_error(anon.post("/api/cases", content=exact, headers=hdr, params={"space": w["space"]}), 401, "unauthenticated")
        over = (prefix + "a" * (pad + 1) + suffix).encode()
        api_error(anon.post("/api/cases", content=over, headers=hdr, params={"space": w["space"]}),
                  413, "body_too_large", "Request body is larger than 1000000 bytes.")
        api_error(anon.post(f"/api/streams/{w['space']}/bulk", content=b"{}", headers={"content-type": "text/plain"}),
                  415, "upload_kind", "Only .ndjson files can be uploaded.")
    api_error(viewer.post("/api/streams", {"name": "Not A Valid Name!"}), 403, "forbidden",
              "Your role in this space can't do this.")
    api_error(viewer.post("/api/streams", {"name": "okname"}, space=other["space"]), 404, "not_found", "Not found.")
    name = nm("st")
    created_ok(admin.post("/api/streams", {"name": name}))
    api_error(admin.post("/api/streams", {"name": name}), 409, "name_taken", "That name is already used.")
    bad = api_error(admin.post("/api/streams", {"name": "Not A Valid Name!"}), 422, "invalid", "Check the highlighted fields.")
    assert bad["fields"] and all(isinstance(v, str) for v in bad["fields"].values())


def test_wf_explore_keyboard_suggestions(browser: Browser, app_url: str) -> None:
    s = nm("logs")
    events = [
        ev("s1", START - timedelta(minutes=5), host="host-7", hops=3, level="info", message="alpha beta"),
        ev("s2", START - timedelta(minutes=4), host="host-7", hops=4, level="warn", message="alpha"),
        ev("s3", START - timedelta(minutes=3), host="host-2", hops=1, level="info", message="gamma alpha"),
        ev("s4", START - timedelta(minutes=2), host="h x", hops=2, level="info", message="delta"),
    ]
    w = world(app_url, streams=[stream(s, events, {"host": "keyword", "level": "keyword"})])
    set_clock(app_url, START)
    api = Api(app_url, w["user"], w["space"])
    span = {"from": iso(START - timedelta(days=1)), "to": iso(START)}

    def suggest(q: str, cursor: int) -> dict[str, Any]:
        return created_ok(api.get("/api/suggest", stream=s, q=q, cursor=cursor, **span), 200)

    f = suggest("ho", 2)
    assert f["kind"] == "field" and [i["label"] for i in f["items"]] == ["hops", "host"]
    assert [i["insert"] for i in f["items"]] == ["hops", "host"] and all("count" not in i for i in f["items"])
    o = suggest("hops", 4)
    assert o["kind"] == "operator" and {i["label"] for i in o["items"]} == {":", ">", ">=", "<", "<="}
    assert [i["label"] for i in suggest("host", 4)["items"]] == [":"]
    expected = [("host-7", "host-7", 2), ("h x", '"h x"', 1), ("host-2", "host-2", 1)]
    v = suggest("host:h", 6)
    assert v["kind"] == "value" and [(i["label"], i["insert"], i["count"]) for i in v["items"]] == expected
    assert [(i["label"], i["insert"], i["count"]) for i in suggest("host:h AND level:i", 6)["items"]] == expected
    assert [(i["label"], i["count"]) for i in suggest("message:al", 10)["items"]] == [("alpha", 3)]
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        pick_stream(page, s)
        quick_range(page, "Last 24 hours")
        announced(page, "4 events found")
        box = page.get_by_role("combobox", name="Query")
        listbox = page.get_by_role("listbox", name="Suggestions")
        box.click()
        page.keyboard.type("ho")
        host_option = listbox.get_by_role("option", name="host", exact=True)
        shows(page, host_option, what="option host")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        wait_for(page, lambda: box.get_attribute("aria-activedescendant") == host_option.get_attribute("id"),
                 "aria-activedescendant names the highlighted option host")
        page.keyboard.press("Tab")
        wait_for(page, lambda: box.input_value() == "host", "Tab accepts host with nothing added")
        assert focus_in(box) and box.evaluate("el => el.selectionStart") == 4
        shows(page, listbox.get_by_role("option", name=":", exact=True), what="operator option")
        page.keyboard.press("Escape")
        gone(page, listbox, "Escape closes the suggestions")
        page.keyboard.type(":h")
        shows(page, listbox.get_by_role("option", name="host-7", exact=True))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Tab")
        wait_for(page, lambda: box.input_value() == "host:host-7", "value accepted with no trailing space")
        assert box.evaluate("el => el.selectionStart") == len("host:host-7")
        page.keyboard.press("Enter")
        announced(page, "2 events found")
        gone(page, listbox, "Enter closes the list")
        page.keyboard.press("Tab")
        assert not focus_in(box), "Tab with nothing highlighted leaves the query bar"


def test_wf_explore_keyboard_grid(browser: Browser, app_url: str) -> None:
    s = nm("grid")
    hosts = ["host-a", "host-b", None]

    def make(i: int) -> dict[str, Any]:
        fields: dict[str, Any] = {"level": ["info", "error"][i % 2], "message": f"grid line {i}"}
        if hosts[i % 3]:
            fields["host"] = hosts[i % 3]
        return ev(f"g{i:03d}", START - timedelta(minutes=i + 1), **fields)

    def label(place: int, i: int) -> str:
        return (f"Event {place} of {GRID_EVENTS}, {shown(START - timedelta(minutes=i + 1))}, "
                f"{hosts[i % 3] or 'none'}, {['info', 'error'][i % 2]}")

    w = world(app_url, streams=[stream(s, [make(i) for i in range(GRID_EVENTS)], {"host": "keyword", "level": "keyword"})])
    set_clock(app_url, START)
    api = Api(app_url, w["user"], w["space"])
    for direction in ("desc", "asc"):
        got = created_ok(api.search(s, START - timedelta(days=1), START, sort=f"host:{direction}", size=100), 200)["events"]
        assert "host" not in got[-1]["fields"], "missing values sort last in both directions"
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        pick_stream(page, s)
        quick_range(page, "Last 24 hours")
        announced(page, f"{GRID_EVENTS} events found")
        g = grid(page)
        wait_for(page, lambda: g.get_attribute("aria-rowcount") == str(GRID_EVENTS + 1), "aria-rowcount = total + 1")
        rows = g.get_by_role("row")
        assert rows.first.get_attribute("aria-rowindex") == "1"
        first = event_row(g, label(1, 0))
        shows(page, first)
        assert first.get_attribute("aria-rowindex") == "2"
        assert rows.count() - 1 <= GRID_MAX_ROWS
        page.get_by_role("combobox", name="Query").focus()
        tab_into(page, g)
        assert focus_in(first), "Tab into the grid lands on the first event"
        page.keyboard.press("ArrowDown")
        wait_for(page, lambda: focus_in(event_row(g, label(2, 1))), "ArrowDown moves one row")
        page.keyboard.press("End")
        last = event_row(g, label(GRID_EVENTS, GRID_EVENTS - 1))
        wait_for(page, lambda: last.count() == 1 and focus_in(last), "End reaches the last event")
        assert rows.count() - 1 <= GRID_MAX_ROWS
        page.keyboard.press("Home")
        wait_for(page, lambda: focus_in(event_row(g, label(1, 0))), "Home returns to the first event")
        page.keyboard.press("PageDown")
        down = event_row(g, label(1 + PAGE_KEY_ROWS, PAGE_KEY_ROWS))
        wait_for(page, lambda: down.count() == 1 and focus_in(down), "PageDown moves 20 rows")
        assert down.get_attribute("aria-rowindex") == str(2 + PAGE_KEY_ROWS)
        page.keyboard.press("Home")
        for _ in range(5):
            page.keyboard.press("ArrowLeft")
        header = g.get_by_role("columnheader").filter(has=page.get_by_role("button", name=sort_by("@timestamp")))
        message_header = g.get_by_role("columnheader").filter(has=page.get_by_role("button", name=sort_by("message")))
        assert header.get_attribute("data-width") == str(COLUMN_DEFAULT_PX)
        assert message_header.get_attribute("data-width") == str(COLUMN_MESSAGE_PX)
        assert g.get_by_role("separator", name="Resize @timestamp").count() == 1
        page.keyboard.press("Alt+ArrowRight")
        wait_for(page, lambda: header.get_attribute("data-width") == str(COLUMN_DEFAULT_PX + COLUMN_STEP_PX), "Alt+ArrowRight widens 16 px")
        for _ in range(10):
            page.keyboard.press("Alt+ArrowLeft")
        wait_for(page, lambda: header.get_attribute("data-width") == str(COLUMN_MIN_PX), "never narrower than 60 px")
        page.keyboard.press("Tab")
        assert not focus_in(g), "Tab leaves the grid"
        g.get_by_role("button", name=sort_by("host")).click()
        shows(page, event_row(g, label(1, 1)), what="host descending puts host-b first")
        g.get_by_role("button", name=sort_by("host")).click()
        shows(page, event_row(g, label(1, 0)), what="second press sorts host ascending")


def test_wf_explore_keyboard_f6_regions(browser: Browser, app_url: str) -> None:
    s = nm("fsix")
    events = [ev(f"f{i}", START - timedelta(minutes=i + 1), host="host-a", level="info", message="line") for i in range(3)]
    w = world(app_url, streams=[stream(s, events, {"host": "keyword", "level": "keyword"})])
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        pick_stream(page, s)
        quick_range(page, "Last 24 hours")
        announced(page, "3 events found")
        query = page.get_by_role("combobox", name="Query")
        histogram = page.get_by_role("group", name="Histogram")
        fields = page.get_by_role("list", name="Fields")
        g = grid(page)
        query.focus()
        for region, what in ((histogram, "Histogram"), (fields, "Fields"), (g, "the grid")):
            page.keyboard.press("F6")
            wait_for(page, lambda r=region: focus_in(r), f"F6 moves to {what}")
        page.keyboard.press("Enter")
        close = page.get_by_role("region", name="Document").get_by_role("button", name="Close document")
        wait_for(page, lambda: focus_in(close), "Enter opens the document, focus on its close button")
        page.keyboard.press("F6")
        wait_for(page, lambda: focus_in(query), "F6 wraps from the document to Query")
        page.keyboard.press("Shift+F6")
        wait_for(page, lambda: focus_in(close), "Shift+F6 wraps back to the document")
        page.keyboard.press("Shift+F6")
        wait_for(page, lambda: focus_in(g), "Shift+F6 moves back to the grid")
        page.keyboard.press("Tab")
        assert not focus_in(g), "the grid is one Tab stop"
        query.focus()
        page.keyboard.press("F6")
        wait_for(page, lambda: focus_in(histogram), "F6 returns to the histogram's focused bucket")
        page.keyboard.press("Tab")
        assert not focus_in(histogram), "the histogram is one Tab stop"


def test_wf_explore_keyboard_dialog_focus(browser: Browser, app_url: str) -> None:
    s = nm("dlg")
    events = [ev(f"d{i}", START - timedelta(minutes=i + 1), host="host-a", level="info", message="line") for i in range(3)]
    w = world(app_url, streams=[stream(s, events, {"host": "keyword", "level": "keyword"})])
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        pick_stream(page, s)
        quick_range(page, "Last 24 hours")
        announced(page, "3 events found")
        g = grid(page)
        shows(page, g.get_by_role("button", name=sort_by("host")))
        columns = page.get_by_role("button", name="Columns")
        columns.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Columns")
        shows(page, dialog)
        wait_for(page, lambda: focus_in(dialog), "focus moves into the dialog")
        for _ in range(8):
            page.keyboard.press("Tab")
            assert focus_in(dialog), "Tab wraps inside the dialog"
        dialog.get_by_role("checkbox", name="host").focus()
        page.keyboard.press("Space")
        dialog.get_by_role("button", name="Done").focus()
        page.keyboard.press("Enter")
        gone(page, dialog, "Done closes the dialog")
        wait_for(page, lambda: focus_in(columns), "closing returns focus to Columns")
        gone(page, g.get_by_role("button", name=sort_by("host")), "the unchecked column leaves the grid")
        opener = page.get_by_role("button", name="Time range")
        opener.focus()
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name="Time range")
        shows(page, sheet)
        wait_for(page, lambda: focus_in(sheet), "focus moves into the range dialog")
        page.keyboard.press("Escape")
        gone(page, sheet, "Escape closes with no change")
        wait_for(page, lambda: focus_in(opener), "Escape returns focus to Time range")
        assert g.get_attribute("aria-rowcount") == "4", "Escape changed nothing"


def test_wf_explore_keyboard_document(browser: Browser, app_url: str) -> None:
    s = nm("doc")
    base = START - timedelta(hours=1)
    events = []
    for i in range(20):
        when = base + timedelta(minutes=10 if i == 11 else i)
        events.append(ev(event_id(i), when, host="host-1", level="info", message=event_text(i) + (f" {NEEDLE}" if i == 10 else "")))
    w = world(app_url, streams=[stream(s, events, {"host": "keyword", "level": "keyword"})])
    set_clock(app_url, START)
    api = Api(app_url, w["user"], w["space"])
    around = created_ok(api.get(f"/api/streams/{s}/events/d10/surrounding"), 200)
    assert [e["_id"] for e in around["before"]] == [event_id(i) for i in range(5, 10)]
    assert around["event"]["_id"] == event_id(10)
    assert [e["_id"] for e in around["after"]] == [event_id(i) for i in range(11, 16)]
    tie = created_ok(api.get(f"/api/streams/{s}/events/{event_id(11)}/surrounding"), 200)
    assert [e["_id"] for e in tie["before"]] == [event_id(i) for i in range(6, 11)]
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        pick_stream(page, s)
        quick_range(page, "Last 24 hours")
        run_query(page, NEEDLE)
        announced(page, "1 event found")
        g = grid(page)
        row = event_row(g, f"Event 1 of 1, {shown(base + timedelta(minutes=10))}")
        shows(page, row)
        tab_into(page, g)
        reset_motion(page)
        page.keyboard.press("Enter")
        doc = page.get_by_role("region", name="Document")
        shows(page, doc, NEEDLE)
        close = doc.get_by_role("button", name="Close document")
        wait_for(page, lambda: focus_in(close), "focus on Close document")
        wait_for(page, lambda: len(animations_on(doc, "panel-in")) > 0, "panel-in runs on the Document region")
        assert all(0 < d <= QUARTER_MS for d in animations_on(doc, "panel-in"))
        doc.get_by_role("button", name="Surrounding events").click()
        table = doc.get_by_role("table", name="Surrounding events")
        shows(page, table, event_text(15))
        text = table.inner_text()
        assert all(event_text(i) in text for i in range(5, 16)) and event_text(4) not in text and event_text(16) not in text
        assert table.evaluate("t => t.querySelectorAll('[aria-current=\"true\"]').length") == 1
        page.keyboard.press("Escape")
        gone(page, doc, "Escape closes the Document region")
        wait_for(page, lambda: focus_in(row), "focus returns to the same row after Escape")
        page.keyboard.press("Enter")
        shows(page, doc)
        doc.get_by_role("button", name="Close document").click()
        gone(page, doc, "Close document closes it")
        wait_for(page, lambda: focus_in(row), "focus returns to the same row after Close")


def test_wf_explore_keyboard_triage(browser: Browser, app_url: str) -> None:
    set_clock(app_url, START)
    with signed_in(browser, app_url, "tomas", "/explore", space="ops") as page:
        pick_stream(page, "web")
        quick_range(page, "Last 15 minutes")
        announced(page, "8 events found")
        page.get_by_role("list", name="Fields").get_by_role("button", name=field_button("host", "keyword")).click()
        stats = page.get_by_role("region", name="Field statistics")
        shows(page, stats, "In 8 of 8 events")
        top = stats.get_by_role("table", name="Top values")
        shows(page, top.get_by_role("row").filter(has_text="host-7"), f"{4 / 8 * 100:.1f}%")
        stats.get_by_role("button", name=include_name("host-7")).click()
        filters = page.get_by_role("list", name="Filters")
        shows(page, filters.get_by_role("button", name=pill_name("host", "host-7", "include", "enabled")))
        announced(page, "4 events found")
        run_query(page, "timeout")
        announced(page, "2 events found")
        box = page.get_by_role("combobox", name="Query")
        histogram = page.get_by_role("group", name="Histogram")
        fields = page.get_by_role("list", name="Fields")
        g = grid(page)
        box.focus()
        for region, what in ((histogram, "histogram"), (fields, "field list"), (g, "grid"), (box, "query bar")):
            page.keyboard.press("F6")
            wait_for(page, lambda r=region: focus_in(r), f"F6 moves to the {what}")
        page.keyboard.press("Shift+F6")
        wait_for(page, lambda: focus_in(g), "Shift+F6 goes back to the grid")
        page.keyboard.press("Enter")
        doc = page.get_by_role("region", name="Document")
        wait_for(page, lambda: focus_in(doc.get_by_role("button", name="Close document")), "document open, focus on Close")
        page.keyboard.press("F6")
        wait_for(page, lambda: focus_in(box), "F6 wraps from the Document to the query bar")
        page.keyboard.press("Shift+F6")
        wait_for(page, lambda: focus_in(doc), "Shift+F6 from the query bar reaches the open Document")
        page.keyboard.press("Escape")
        gone(page, doc, "Escape closes the Document")
        wait_for(page, lambda: focus_in(event_row(g, "Event 1 of 2, ")), "focus back on the row")
        filters.get_by_role("button", name=pill_name("host", "host-7", "include", "enabled")).click()
        page.get_by_role("menu", name="Filter actions").get_by_role("menuitem", name="Invert").click()
        shows(page, filters.get_by_role("button", name=pill_name("host", "host-7", "exclude", "enabled")))
        announced(page, "0 events found")
        empty = page.get_by_role("region", name="Empty")
        shows(page, empty, "No events in this range.")
        assert empty.get_by_role("button", name="Widen to last 7 days").count() == 1
        filters.get_by_role("button", name=pill_name("host", "host-7", "exclude", "enabled")).click()
        page.get_by_role("menu", name="Filter actions").get_by_role("menuitem", name="Disable").click()
        shows(page, filters.get_by_role("button", name=pill_name("host", "host-7", "exclude", "disabled")))
        announced(page, "2 events found")
        page.reload()
        wait_for(page, lambda: page.get_by_role("combobox", name="Query").input_value() == "timeout", "address keeps the query")
        shows(page, page.get_by_role("list", name="Filters").get_by_role("button", name=pill_name("host", "host-7", "exclude", "disabled")))
        wait_for(page, lambda: grid(page).get_attribute("aria-rowcount") == "3", "reloaded search shows the same 2 events")
    api = Api(app_url, "tomas", "ops")
    found = created_ok(api.search("web", START - timedelta(minutes=15), START, q="timeout"), 200)
    assert found["total"] == 2


def test_wf_histogram_time_range_dialog(browser: Browser, app_url: str) -> None:
    s = nm("tr")
    w = world(app_url, members=(("admin", NY),), streams=[stream(s, [ev("t1", START - timedelta(minutes=1), message="x")])])
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"], device_time=DEVICE_TIME) as page:
        shows(page, page.get_by_role("banner"), f"Server time {shown(START, NY)}")
        pick_stream(page, s)
        opener = page.get_by_role("button", name="Time range")
        quick_range(page, "Last 1 hour")
        shows(page, page.get_by_text(f"Showing {shown(START - timedelta(hours=1), NY)} to {shown(START, NY)}"))
        wait_for(page, lambda: focus_in(opener), "focus back on Time range")
        dialog = open_range(page)
        dialog.get_by_role("tab", name="Relative").click()
        dialog.get_by_role("textbox", name="Amount").fill("2")
        select(dialog.get_by_role("combobox", name="Unit"), "hours")
        dialog.get_by_role("button", name="Apply").click()
        relative = f"Showing {shown(START - timedelta(hours=2), NY)} to {shown(START, NY)}"
        shows(page, page.get_by_text(relative))
        for start, end, error in (
            ("2026-03-08 02:30:00", "2026-03-08 05:00:00", "That time doesn't exist in America/New_York."),
            ("03/08/2026", "2026-03-08 05:00:00", "Enter a time as YYYY-MM-DD HH:MM:SS."),
            ("2026-03-08 05:00:00", "2026-03-08 04:00:00", "From must be before To."),
        ):
            dialog = absolute_range(page, start, end, close=False)
            shows(page, dialog.get_by_role("alert", name="Error"), error)
            page.keyboard.press("Escape")
            gone(page, dialog, "Escape closes the dialog")
        shows(page, page.get_by_text(relative))
        wait_for(page, lambda: focus_in(opener), "Escape returns focus to Time range")
        dialog = open_range(page)
        for _ in range(25):
            page.keyboard.press("Tab")
            assert focus_in(dialog), "Tab stays inside dialog Time range"
        dialog.get_by_role("tab", name="Quick").click()
        dialog.get_by_role("radio", name="Last 7 days").check()
        dialog.get_by_role("button", name="Cancel").click()
        gone(page, dialog, "Cancel closes")
        shows(page, page.get_by_text(relative))
        absolute_range(page, "2026-11-01 01:30:00", "2026-11-01 03:00:00")
        fall = datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc)
        shows(page, page.get_by_text(f"Showing {shown(fall, NY)} to {shown(fall + timedelta(hours=2, minutes=30), NY)}"))
        page.get_by_role("banner").get_by_role("button", name="Account").click()
        account = page.get_by_role("dialog", name="Account")
        shows(page, account)
        select(account.get_by_role("combobox", name="Time zone"), "UTC")
        account.get_by_role("button", name="Save account").click()
        announced(page, "Time zone set to UTC.")
        shows(page, page.get_by_role("banner"), f"Server time {shown(START)}")
    assert Api(app_url, w["user"], w["space"]).get("/api/me").json()["time_zone"] == "UTC"


def test_histogram_dst_buckets(browser: Browser, app_url: str) -> None:
    s = nm("dst")
    events = [ev("a1", DST_SPRING_MIDNIGHT + timedelta(hours=1, minutes=10), message="x"),
              ev("a2", DST_SPRING_MIDNIGHT + timedelta(hours=2, minutes=10), message="x"),
              ev("a3", DST_FALL_MIDNIGHT + timedelta(hours=1, minutes=40), message="x"),
              ev("a4", DST_FALL_MIDNIGHT + timedelta(hours=2, minutes=40), message="x")]
    w = world(app_url, members=(("admin", NY),), streams=[stream(s, events)])
    api = Api(app_url, w["user"], w["space"])

    def hist(start: datetime, end: datetime, tz: str) -> dict[str, Any]:
        out = created_ok(api.get("/api/histogram", stream=s, q="", tz=tz, **{"from": iso(start), "to": iso(end)}), 200)
        b = out["buckets"]
        assert b[0]["start"] == iso(start) and b[-1]["end"] == iso(end)
        assert all(x["end"] == y["start"] for x, y in zip(b, b[1:])), "buckets are contiguous"
        assert sum(x["count"] for x in b) == out["total"]
        return out

    spring = hist(DST_SPRING_MIDNIGHT, DST_SPRING_MIDNIGHT + timedelta(hours=23), NY)
    labels = [b["label"] for b in spring["buckets"]]
    assert spring["interval"] == "30m" and len(labels) == 46 and spring["total"] == 2
    assert labels[labels.index("01:30 -05:00") + 1] == "03:00 -04:00"
    fall = hist(DST_FALL_MIDNIGHT, DST_FALL_MIDNIGHT + timedelta(hours=25), NY)
    labels = [b["label"] for b in fall["buckets"]]
    assert len(labels) == 50
    i = labels.index("01:30 -04:00")
    assert labels[i + 1:i + 3] == ["01:00 -05:00", "01:30 -05:00"]
    hour = hist(DST_SPRING_MIDNIGHT + timedelta(hours=1), DST_SPRING_MIDNIGHT + timedelta(hours=2), "UTC")
    assert hour["interval"] == "1m" and len(hour["buckets"]) == 3600 // 60
    assert hour["buckets"][0]["label"] == bucket_label(DST_SPRING_MIDNIGHT + timedelta(hours=1))
    quarter = hist(DST_SPRING_MIDNIGHT + timedelta(hours=1), DST_SPRING_MIDNIGHT + timedelta(hours=1, minutes=15), "UTC")
    assert quarter["interval"] == "30s" and len(quarter["buckets"]) == 900 // 30
    assert quarter["buckets"][1]["label"] == bucket_label(DST_SPRING_MIDNIGHT + timedelta(hours=1, seconds=30), seconds=True)
    offset_start = DST_SPRING_MIDNIGHT + timedelta(hours=1, minutes=2)
    offset = hist(offset_start, offset_start + timedelta(hours=4), "UTC")
    assert offset["interval"] == "5m" and len(offset["buckets"]) == 1 + 240 // 5
    assert offset["buckets"][1]["label"] == bucket_label(DST_SPRING_MIDNIGHT + timedelta(hours=1, minutes=5))
    days = hist(datetime(2026, 3, 7, tzinfo=timezone.utc), datetime(2026, 3, 10, tzinfo=timezone.utc), "UTC")
    assert days["interval"] == "3h" and len(days["buckets"]) == 72 // 3
    assert days["buckets"][0]["label"] == bucket_label(datetime(2026, 3, 7, tzinfo=timezone.utc), dated=True)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        pick_stream(page, s)
        absolute_range(page, "2026-03-08 00:00:00", "2026-03-09 00:00:00")
        shows(page, page.get_by_text("Interval: 30m"))
        wait_for(page, lambda: histogram_buckets(page).count() == 46, "46 bucket buttons on the 23-hour day")


BRUSH_EVENTS = [
    ("b1", timedelta(minutes=2, seconds=10), "error", "host-1"),
    ("b2", timedelta(minutes=3, seconds=20), "info", "host-2"),
    ("b3", timedelta(minutes=4, seconds=30), "error", "host-1"),
    ("b4", timedelta(minutes=10), "error", "host-3"),
    ("b5", timedelta(minutes=30), "error", "host-3"),
]
BRUSHED_RANGE = f"Showing {shown(START + timedelta(minutes=2))} to {shown(START + timedelta(minutes=5))}"


def brush_world(app_url: str) -> tuple[dict[str, Any], str]:
    s = nm("br")
    events = [ev(i, START + off, level=lv, host=h, message="brush") for i, off, lv, h in BRUSH_EVENTS]
    return world(app_url, streams=[stream(s, events, {"host": "keyword", "level": "keyword"})]), s


def brush_setup(page: Page, s: str) -> Locator:
    pick_stream(page, s)
    absolute_range(page, "2026-03-01 00:00:00", "2026-03-01 01:00:00")
    announced(page, "5 events found")
    shows(page, page.get_by_text("Interval: 1m"))
    buckets = histogram_buckets(page)
    wait_for(page, lambda: buckets.count() == 60, "60 one-minute buckets")
    return buckets


def drag_brush(page: Page, buckets: Locator) -> None:
    x, y = center(buckets.nth(2))
    page.mouse.move(x, y)
    page.mouse.down()
    for k in (3, 4):
        x, y = center(buckets.nth(k))
        page.mouse.move(x, y, steps=4)
    wait_for(page, lambda: all(buckets.nth(k).get_attribute("data-selected") == "true" for k in (2, 3, 4))
             and buckets.nth(5).get_attribute("data-selected") != "true", "covered buckets selected during the drag")
    page.mouse.up()


def test_wf_histogram_time_brush(browser: Browser, app_url: str) -> None:
    w, s = brush_world(app_url)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        buckets = brush_setup(page, s)
        reset_motion(page)
        drag_brush(page, buckets)
        announced(page, "Time range set: 3 events found")
        shows(page, page.get_by_text(BRUSHED_RANGE))
        shows(page, page.get_by_text("Interval: 5s"))
        group = page.get_by_role("group", name="Histogram")
        wait_for(page, lambda: len(animations_on(group, "bar-settle")) > 0, "bar-settle runs on changed bars")
        assert all(0 < d <= QUARTER_MS for d in animations_on(group, "bar-settle"))
        wait_for(page, lambda: grid(page).get_attribute("aria-rowcount") == "4", "grid follows the brushed range")


def test_wf_histogram_time_brush_reduced_motion(browser: Browser, app_url: str) -> None:
    w, s = brush_world(app_url)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"], reduced_motion="reduce") as page:
        buckets = brush_setup(page, s)
        reset_motion(page)
        to_bucket(page, buckets, 2)
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowRight")
        wait_for(page, lambda: all(buckets.nth(k).get_attribute("data-selected") == "true" for k in (2, 3, 4)),
                 "Shift+ArrowRight extends the selection")
        page.keyboard.press("Enter")
        announced(page, "Time range set: 3 events found")
        shows(page, page.get_by_text(BRUSHED_RANGE))
        shows(page, page.get_by_text("Interval: 5s"))
        wait_for(page, lambda: focus_in(histogram_buckets(page).nth(0)), "focus on the first bucket of the new range")
        assert no_motion(page), "reduced motion creates no animation or transition"
        page.keyboard.press("Shift+ArrowRight")
        wait_for(page, lambda: histogram_buckets(page).nth(1).get_attribute("data-selected") == "true", "selection started")
        page.keyboard.press("Escape")
        wait_for(page, lambda: all(histogram_buckets(page).nth(k).get_attribute("data-selected") != "true" for k in (0, 1)),
                 "Escape clears the selection")


def test_wf_histogram_time_keyboard_clear(browser: Browser, app_url: str) -> None:
    w, s = brush_world(app_url)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        buckets = brush_setup(page, s)
        to_bucket(page, buckets, 2)
        page.keyboard.press("Shift+ArrowRight")
        wait_for(page, lambda: buckets.nth(2).get_attribute("data-selected") == "true"
                 and buckets.nth(3).get_attribute("data-selected") == "true", "Shift+ArrowRight selects two buckets")
        page.keyboard.press("Escape")
        wait_for(page, lambda: page.locator('[data-selected="true"]').count() == 0, "Escape clears the selection")
        assert grid(page).get_attribute("aria-rowcount") == "6", "Escape leaves the range and results unchanged"
        to_bucket(page, buckets, 2)
        page.keyboard.press("ArrowRight")
        wait_for(page, lambda: focus_in(buckets.nth(3)), "ArrowRight moves focus one bucket")
        page.keyboard.press("Enter")
        announced(page, "Time range set: 1 event found")
        shows(page, page.get_by_text(f"Showing {shown(START + timedelta(minutes=3))} to {shown(START + timedelta(minutes=4))}"))
        shows(page, page.get_by_text("Interval: 1s"))
        wait_for(page, lambda: focus_in(histogram_buckets(page).nth(0)), "focus on the first bucket of the new range")


def test_wf_histogram_time_range_follow(browser: Browser, app_url: str) -> None:
    w, s = brush_world(app_url)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        buckets = brush_setup(page, s)
        page.get_by_role("list", name="Fields").get_by_role("button", name=field_button("level", "keyword")).click()
        stats = page.get_by_role("region", name="Field statistics")
        shows(page, stats, "In 5 of 5 events")
        stats.get_by_role("button", name=include_name("error")).click()
        pill = page.get_by_role("list", name="Filters").get_by_role("button", name=pill_name("level", "error", "include", "enabled"))
        shows(page, pill)
        announced(page, "4 events found")
        drag_brush(page, buckets)
        announced(page, "Time range set: 2 events found")
        wait_for(page, lambda: grid(page).get_attribute("aria-rowcount") == "3", "grid shows the 2 events")
        shows(page, stats, "In 2 of 2 events")
        shows(page, pill)
        assert page.get_by_role("combobox", name="Query").input_value() == ""
        shows(page, page.get_by_text(BRUSHED_RANGE))
    found = created_ok(Api(app_url, w["user"], w["space"]).search(
        s, START + timedelta(minutes=2), START + timedelta(minutes=5),
        filters=json.dumps([{"field": "level", "op": "eq", "value": "error"}])), 200)
    assert found["total"] == 2


def worked_alert_events() -> list[dict[str, Any]]:
    start = EXAMPLE_CHECK - timedelta(minutes=3)
    return [ev(f"w{k}", start + timedelta(seconds=20 * k), host="host-7", message="boom") for k in range(6)]


def test_group_window_worked_example(app_url: str) -> None:
    s = nm("al")
    events = worked_alert_events() + [ev("w9", EXAMPLE_CHECK - timedelta(minutes=2), host="host-3", message="one")]
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, events, {"host": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s)))["id"]
    _, g = run_check(app_url, rid, EXAMPLE_CHECK)
    assert (g["host-7"]["state"], g["host-7"]["value"], g["host-7"]["action"]) == ("pending", 6, "none")
    assert g["host-3"]["state"] == "inactive"
    _, g = run_check(app_url, rid, EXAMPLE_CHECK + timedelta(minutes=1))
    assert (g["host-7"]["state"], g["host-7"]["value"], g["host-7"]["action"]) == ("active", 6, "fired")
    _, g = run_check(app_url, rid, EXAMPLE_CHECK + timedelta(minutes=2))
    assert (g["host-7"]["state"], g["host-7"]["value"], g["host-7"]["action"]) == ("recovered", 0, "fired")
    _, g = run_check(app_url, rid, EXAMPLE_CHECK + timedelta(minutes=3))
    assert (g["host-7"]["state"], g["host-7"]["value"]) == ("inactive", 0)
    texts = [i["text"] for i in api.get("/api/inbox").json()["items"]]
    assert texts == ["host-7 is recovered on rule High errors", "host-7 is active on rule High errors"]


def test_group_failed_check_and_flapping(app_url: str) -> None:
    s = nm("fl")
    events = [ev(f"f{k}", FLAP_T + timedelta(seconds=sec), host="host-9", message="x") for k, sec in enumerate((30, 90, 210, 270))]
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, events, {"host": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s, window_ms=ONE_MINUTE_MS, threshold=0)))["id"]
    _, g = run_check(app_url, rid, FLAP_T + timedelta(seconds=60))
    assert g["host-9"]["state"] == "pending" and not g["host-9"]["flapping"]
    data, g = run_check(app_url, rid, FLAP_T + timedelta(seconds=90), fail=True)
    assert data["failed"] is True and g["host-9"]["state"] == "pending"
    assert api.get(f"/api/rules/{rid}").json()["last_check"]["failed"] is True
    _, g = run_check(app_url, rid, FLAP_T + timedelta(seconds=120))
    assert (g["host-9"]["state"], g["host-9"]["action"]) == ("active", "fired"), "counters survived the failed check"
    _, g = run_check(app_url, rid, FLAP_T + timedelta(seconds=180))
    assert (g["host-9"]["state"], g["host-9"]["action"]) == ("recovered", "fired")
    _, g = run_check(app_url, rid, FLAP_T + timedelta(seconds=240))
    assert g["host-9"]["state"] == "pending" and g["host-9"]["flapping"] is True
    _, g = run_check(app_url, rid, FLAP_T + timedelta(seconds=300))
    assert (g["host-9"]["state"], g["host-9"]["flapping"], g["host-9"]["action"]) == ("active", True, "held")
    assert len(api.get("/api/inbox").json()["items"]) == 2


def test_wf_alert_lifecycle_snooze(browser: Browser, app_url: str) -> None:
    s = nm("sn")
    events = [ev("a", SNOOZE_T - timedelta(minutes=1), host="host-5"), ev("b", SNOOZE_T + timedelta(seconds=90), host="host-5"),
              ev("c", SNOOZE_T + timedelta(minutes=61, seconds=30), host="host-5"),
              ev("d", SNOOZE_T - timedelta(minutes=1), host="host-6"), ev("e", SNOOZE_T + timedelta(seconds=90), host="host-6")]
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, events, {"host": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s, window_ms=10 * ONE_MINUTE_MS, threshold=0,
                                                      frequency={"kind": "check"})))["id"]
    run_check(app_url, rid, SNOOZE_T)
    _, g = run_check(app_url, rid, SNOOZE_T + timedelta(minutes=1))
    assert g["host-5"]["state"] == g["host-6"]["state"] == "active"
    with signed_in(browser, app_url, w["user"], f"/alerts/{rid}", space=w["space"]) as page:
        quiet = "host-6"
        row = page.get_by_role("table", name="Groups").get_by_role("row", name=group_label(quiet, g[quiet]["state"]), exact=True)
        shows(page, row)
        row.get_by_role("button", name="Snooze group").click()
        dialog = page.get_by_role("dialog", name="Snooze")
        shows(page, dialog)
        dialog.get_by_role("radio", name="Until recovered").check()
        dialog.get_by_role("button", name="Snooze", exact=True).click()
        announced(page, "Group host-6 snoozed until it recovers.")
        shows(page, page.get_by_role("table", name="Groups").get_by_role("row", name=group_label(quiet, g[quiet]["state"], "snoozed")))
    snoozed = created_ok(api.post(f"/api/rules/{rid}/groups/host-5/snooze", {"for": "1h"}), 200)
    assert snoozed["snoozed"] is True
    assert snoozed["snoozed_until"] == iso(SNOOZE_T + timedelta(minutes=1) + timedelta(milliseconds=HOUR_MS))
    _, g = run_check(app_url, rid, SNOOZE_T + timedelta(minutes=2))
    assert g["host-5"]["state"] == "active" and g["host-5"]["snoozed"] and g["host-5"]["action"] != "fired"
    assert g["host-6"]["action"] != "fired"
    _, g = run_check(app_url, rid, SNOOZE_T + timedelta(minutes=62))
    assert g["host-5"]["snoozed"] is False and g["host-5"]["action"] == "fired"
    assert g["host-6"]["state"] == "recovered" and g["host-6"]["snoozed"] is False
    texts = [i["text"] for i in api.get("/api/inbox").json()["items"]]
    assert texts.count("host-5 is active on rule High errors") == 2
    assert texts.count("host-6 is active on rule High errors") == 1


def test_wf_alert_lifecycle_maintenance(browser: Browser, app_url: str) -> None:
    s = nm("mw")
    at = lambda h, m: datetime(2026, 3, 8, h, m, tzinfo=timezone.utc)
    events = [ev(f"h7{k}", at(h, m), host="host-7") for k, (h, m) in enumerate(((7, 38), (7, 43), (7, 58), (8, 29)))]
    events += [ev(f"h8{k}", at(h, m), host="host-8") for k, (h, m) in enumerate(((7, 38), (7, 43)))]
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, events, {"host": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s, threshold=0)))["id"]
    set_clock(app_url, MAINT_SET)
    with signed_in(browser, app_url, w["user"], "/alerts/maintenance", space=w["space"]) as page:
        page.get_by_role("textbox", name="Name", exact=True).fill("Nightly")
        select(page.get_by_role("combobox", name="Window time zone"), NY)
        page.get_by_role("group", name="Weekly days").get_by_role("checkbox", name="Sunday").check()
        page.get_by_role("textbox", name="Start (HH:MM)").fill("02:30")
        page.get_by_role("textbox", name="Duration (ms)").fill(str(HOUR_MS))
        select(page.get_by_role("combobox", name="Rule"), "High errors")
        page.get_by_role("button", name="Save window").click()
        announced(page, "Maintenance window Nightly saved.")
        row = page.get_by_role("table", name="Maintenance windows").get_by_role("row").filter(has_text="Nightly")
        shows(page, row, shown(at(7, 30)))
    window = [m for m in items_of(api.get("/api/maintenance").json()) if m["name"] == "Nightly"][0]
    assert window["next_start"] == iso(at(7, 30))
    _, g = run_check(app_url, rid, at(7, 40))
    assert g["host-7"]["in_maintenance"] is True and g["host-7"]["state"] == "pending"
    _, g = run_check(app_url, rid, at(7, 45))
    assert (g["host-7"]["state"], g["host-7"]["action"]) == ("active", "held")
    _, g = run_check(app_url, rid, at(8, 0))
    assert g["host-8"]["state"] == "recovered" and g["host-7"]["state"] == "active"
    _, g = run_check(app_url, rid, at(8, 31))
    assert g["host-7"]["in_maintenance"] is False and g["host-7"]["action"] == "fired"
    assert g["host-8"]["action"] != "fired"
    texts = [i["text"] for i in api.get("/api/inbox").json()["items"]]
    assert texts == ["host-7 is still active after maintenance window Nightly on rule High errors"]


def test_wf_alert_lifecycle_worked_example_page(browser: Browser, app_url: str) -> None:
    s = nm("wx")
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, worked_alert_events(), {"host": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s)))["id"]
    with signed_in(browser, app_url, w["user"], f"/alerts/{rid}", space=w["space"]) as page:
        table = page.get_by_role("table", name="Groups")
        shows(page, table)
        for minute, state in ((0, "pending"), (1, "active"), (2, "recovered")):
            run_check(app_url, rid, EXAMPLE_CHECK + timedelta(minutes=minute))
            shows(page, table.get_by_role("row", name=group_label("host-7", state), exact=True))
            announced(page, f"Group host-7 is now {state}")
        history = page.get_by_role("table", name="State history")
        for state in ("pending", "active", "recovered"):
            shows(page, history, state)


def test_wf_alert_lifecycle_flapping_page(browser: Browser, app_url: str) -> None:
    s = nm("fp")
    events = [ev(f"f{k}", FLAP_T + timedelta(seconds=sec), host="host-9", message="x") for k, sec in enumerate((30, 90, 210, 270))]
    w = world(app_url, members=(("editor", "UTC"), ("editor", "UTC")), streams=[stream(s, events, {"host": "keyword"})])
    owner, second = w["users"]
    api = Api(app_url, owner, w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s, window_ms=ONE_MINUTE_MS, threshold=0)))["id"]
    with signed_in(browser, app_url, owner, f"/alerts/{rid}", space=w["space"]) as page, \
            signed_in(browser, app_url, second, "/inbox", space=w["space"]) as inbox:
        table = page.get_by_role("table", name="Groups")
        shows(page, table)
        feed = inbox.get_by_role("feed", name="Inbox")
        for seconds in (60, 120, 180, 240):
            run_check(app_url, rid, FLAP_T + timedelta(seconds=seconds))
        shows(page, table.get_by_role("row", name=group_label("host-9", "pending", "flapping"), exact=True))
        wait_for(inbox, lambda: feed.get_by_role("article").count() == 2, "two items before flapping")
        run_check(app_url, rid, FLAP_T + timedelta(seconds=300))
        shows(page, table.get_by_role("row", name=group_label("host-9", "active", "flapping"), exact=True))
        announced(page, "Group host-9 is now active")
        wait_for(inbox, lambda: inbox.get_by_role("main").get_attribute("data-seq") == page.get_by_role("main").get_attribute("data-seq"),
                 "the second browser has every live message")
        assert feed.get_by_role("article").count() == 2, "flapping holds the action"


def test_wf_alert_lifecycle_snooze_keyboard(browser: Browser, app_url: str) -> None:
    s = nm("sk")
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, worked_alert_events(), {"host": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s)))["id"]
    run_check(app_url, rid, EXAMPLE_CHECK)
    checked = EXAMPLE_CHECK + timedelta(minutes=1)
    run_check(app_url, rid, checked)
    with signed_in(browser, app_url, w["user"], f"/alerts/{rid}", space=w["space"]) as page:
        table = page.get_by_role("table", name="Groups")
        row = table.get_by_role("row", name=group_label("host-7", "active"), exact=True)
        shows(page, row)
        opener = row.get_by_role("button", name="Snooze group")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Snooze")
        shows(page, dialog)
        wait_for(page, lambda: focus_in(dialog), "focus moves into the dialog")
        page.keyboard.press("Escape")
        gone(page, dialog, "Escape closes the dialog")
        wait_for(page, lambda: focus_in(opener), "focus returns to Snooze group")
        shows(page, row)
        opener.focus()
        page.keyboard.press("Enter")
        shows(page, dialog)
        dialog.get_by_role("radio", name="For 1 day").check()
        dialog.get_by_role("button", name="Snooze", exact=True).focus()
        page.keyboard.press("Enter")
        announced(page, f"Group host-7 snoozed until {shown(checked + timedelta(days=1))}.")
        shows(page, table.get_by_role("row", name=group_label("host-7", "active", "snoozed"), exact=True))


def test_wf_alert_lifecycle_two_browsers(browser: Browser, app_url: str) -> None:
    s = nm("tb")
    w = world(app_url, members=(("editor", "UTC"), ("editor", "UTC")), streams=[stream(s, worked_alert_events(), {"host": "keyword"})])
    owner, engineer = w["users"]
    api = Api(app_url, owner, w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s)))["id"]
    path = f"/alerts/{rid}"
    with signed_in(browser, app_url, owner, path, space=w["space"], device_time=DEVICE_TIME) as own, \
            signed_in(browser, app_url, engineer, path, space=w["space"], device_time=DEVICE_TIME) as eng:
        groups = lambda p: p.get_by_role("table", name="Groups")
        shows(own, groups(own))
        shows(eng, groups(eng))
        run_check(app_url, rid, EXAMPLE_CHECK)
        for p in (own, eng):
            shows(p, groups(p).get_by_role("row", name=group_label("host-7", "pending"), exact=True))
            announced(p, "Group host-7 is now pending")
        checked = EXAMPLE_CHECK + timedelta(minutes=1)
        run_check(app_url, rid, checked)
        for p in (own, eng):
            shows(p, groups(p).get_by_role("row", name=group_label("host-7", "active"), exact=True))
            announced(p, "Group host-7 is now active")
            shows(p, p.get_by_role("status", name="Last check"), f"Last check at {shown(checked)}: ok")
        own_inbox = own.context.new_page()
        own_inbox.goto(app_url + "/inbox")
        eng_inbox = eng.context.new_page()
        eng_inbox.goto(app_url + "/inbox")
        item = "host-7 is active on rule High errors"
        art = lambda p: p.get_by_role("feed", name="Inbox").get_by_role("article", name=item)
        shows(own_inbox, art(own_inbox))
        shows(eng_inbox, art(eng_inbox))
        art(eng_inbox).get_by_role("button", name="Acknowledge").click()
        shows(eng_inbox, art(eng_inbox), f"Acknowledged by {engineer}")
        shows(own_inbox, art(own_inbox), f"Acknowledged by {engineer}")
        groups(own).get_by_role("row", name=group_label("host-7", "active"), exact=True).get_by_role("button", name="Snooze group").click()
        dialog = own.get_by_role("dialog", name="Snooze")
        shows(own, dialog)
        dialog.get_by_role("radio", name="For 1 hour").check()
        dialog.get_by_role("button", name="Snooze", exact=True).click()
        announced(own, f"Group host-7 snoozed until {shown(checked + timedelta(milliseconds=HOUR_MS))}.")
        shows(eng, groups(eng).get_by_role("row", name=group_label("host-7", "active", "snoozed")))
        failed_at = EXAMPLE_CHECK + timedelta(minutes=2)
        run_check(app_url, rid, failed_at, fail=True)
        for p in (own, eng):
            shows(p, p.get_by_role("status", name="Last check"), f"Check failed at {shown(failed_at)}: state kept.")
    items = api.get("/api/inbox").json()["items"]
    assert [i["acknowledged_by"] for i in items if i["text"] == item] == [engineer]
    group = [g for g in api.get(f"/api/rules/{rid}").json()["groups"] if g["group"] == "host-7"][0]
    assert group["snoozed"] is True and group["state"] == "active"


def test_console_chrome_layout(browser: Browser, app_url: str) -> None:
    w = world(app_url)
    for width, height in ((375, PHONE_HEIGHT_PX), (TABLET_MIN_PX, 1024), (1280, 800)):
        with signed_in(browser, app_url, w["user"], "/alerts", space=w["space"], width=width, height=height) as page:
            ingest = page.get_by_role("region", name="Ingest status")
            banner = page.get_by_role("banner")
            nav = page.get_by_role("navigation", name="Workspace")
            footer = page.get_by_role("contentinfo")
            shows(page, ingest, "0 events stored, 0 in failure store")
            shows(page, page.get_by_role("region", name="Empty"), "No alert rules yet.")
            assert page.get_by_role("region", name="Empty").get_by_role("link", name="New rule").count() == 1
            layout(page)
            ys = [loc.bounding_box()["y"] for loc in (ingest, banner, nav, page.get_by_role("main"), footer)]
            assert ys == sorted(ys) and abs(ys[0]) <= 1, f"chrome order top to bottom: {ys}"
            for name in ("Spoorline", "Server time "):
                assert name in banner.inner_text()
            for name in ("Space", "Account"):
                box = banner.get_by_role("button", name=name).bounding_box()
                assert box["width"] >= TARGET_MIN_PX and box["height"] >= TARGET_MIN_PX, f"{name} target {box}"
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            top = ingest.bounding_box()
            assert abs(top["y"]) <= 1, "ingest status bar stays fixed at the top"
            assert abs(banner.bounding_box()["y"] - (top["y"] + top["height"])) <= 1, "header fixed under the bar"
            for tab in WORKSPACE_TABS:
                assert nav.get_by_role("link", name=tab, exact=True).count() == 1
            assert nav.get_by_role("link", name="Alerts", exact=True).get_attribute("aria-current") == "page"
            assert "Spoorline" in footer.inner_text()
    with signed_in(browser, app_url, w["user"], "/alerts", space=w["space"]) as page:
        nav = page.get_by_role("navigation", name="Workspace")
        shows(page, nav)
        reset_motion(page)
        nav.get_by_role("link", name="Cases", exact=True).click()
        wait_for(page, lambda: urlparse(page.url).path == "/cases", "Cases tab opens /cases")
        assert nav.get_by_role("link", name="Cases", exact=True).get_attribute("aria-current") == "page"
        wait_for(page, lambda: len(animations_on(nav, "tab-slide")) > 0, "tab-slide on the underline")
        assert all(0 < d <= QUARTER_MS for d in animations_on(nav, "tab-slide"))
        empty = page.get_by_role("region", name="Empty")
        shows(page, empty, "No cases yet.")
        action = empty.get_by_role("button", name="New case").bounding_box()
        assert action["width"] >= TARGET_MIN_PX and action["height"] >= TARGET_MIN_PX
        for path, line, control in (("/keys", "No API keys yet.", ("button", "New key")),
                                    ("/streams", "No streams in this space yet.", ("button", "New stream"))):
            page.goto(app_url + path)
            shows(page, page.get_by_role("region", name="Empty"), line)
            assert page.get_by_role("region", name="Empty").get_by_role(control[0], name=control[1]).count() == 1
        page.get_by_role("contentinfo").get_by_role("link", name="Published rules").click()
        wait_for(page, lambda: urlparse(page.url).path == "/rules", "footer link opens /rules")
        for name in RULES_ACCORDION:
            shows(page, page.get_by_role("button", name=name))
        first = page.get_by_role("button", name=RULES_ACCORDION[0])
        assert first.get_attribute("aria-expanded") == "false"
        first.click()
        wait_for(page, lambda: first.get_attribute("aria-expanded") == "true", "accordion row opens")
        page.goto(app_url + "/no-such-page")
        shows(page, page.get_by_role("heading", name="Page not found."))
        assert page.get_by_role("link", name="Go to Explore").count() == 1


def test_action_buttons_shape(browser: Browser, app_url: str) -> None:
    w = world(app_url)
    with signed_in(browser, app_url, w["user"], "/keys", space=w["space"]) as page:
        main_action = page.get_by_role("region", name="Empty").get_by_role("button", name="New key")
        shows(page, main_action)
        page.get_by_role("button", name="New key").first.click()
        dialog = page.get_by_role("dialog", name="New key")
        shows(page, dialog)
        other = dialog.get_by_role("button", name="Create key")
        radii = []
        for loc in (main_action, other):
            box = loc.bounding_box()
            assert box["width"] >= TARGET_MIN_PX and box["height"] >= TARGET_MIN_PX, box
            radius = float(style(loc, "border-top-left-radius")["border-top-left-radius"].replace("px", ""))
            assert radius < box["height"] / 2, f"action buttons are not pills: {radius}"
            radii.append(radius)
        assert radii[0] == radii[1], f"filled and outlined buttons share one shape: {radii}"


def test_wf_phone_triage_breakpoints(browser: Browser, app_url: str) -> None:
    s = nm("bp")
    events = [ev(f"p{i}", START - timedelta(minutes=i + 1), host="host-1", level="info", message="phone") for i in range(3)]
    w = world(app_url, streams=[stream(s, events, {"host": "keyword", "level": "keyword"})])
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"], width=PHONE_SMALLEST_PX, height=PHONE_HEIGHT_PX) as page:
        pick_stream(page, s)
        quick_range(page, "Last 24 hours")
        announced(page, "3 events found")
        cards = page.get_by_role("list", name="Events").get_by_role("article")
        wait_for(page, lambda: cards.count() == 3, "phone Events list of 3 cards")
        assert grid(page).count() == 0 or not grid(page).is_visible()
        layout(page)
        for opener in ("Time range", "Filters"):
            reset_motion(page)
            page.get_by_role("button", name=opener).click()
            sheet = page.get_by_role("dialog", name=opener)
            shows(page, sheet)
            wait_for(page, lambda: len(animations_on(sheet, "sheet-rise")) > 0, f"{opener} sheet runs sheet-rise")
            assert all(0 < d <= QUARTER_MS for d in animations_on(sheet, "sheet-rise"))
            finish_motion(page)
            box = sheet.bounding_box()
            assert abs(box["y"] + box["height"] - PHONE_HEIGHT_PX) <= 1, f"{opener} rests on the bottom edge: {box}"
            for _ in range(15):
                page.keyboard.press("Tab")
                assert focus_in(sheet), f"Tab stays inside the {opener} sheet"
            page.keyboard.press("Escape")
            gone(page, sheet, f"Escape closes the {opener} sheet")
            wait_for(page, lambda o=opener: focus_in(page.get_by_role("button", name=o)), "focus back on the opener")
        for path in ("/alerts", "/streams", "/cases", "/objectives", f"/streams/{s}"):
            page.goto(app_url + path)
            shows(page, page.get_by_role("main"))
            layout(page)
        for width, phone in ((TABLET_MIN_PX - 1, True), (TABLET_MIN_PX, False)):
            page.set_viewport_size({"width": width, "height": 1024})
            page.goto(app_url + "/explore")
            pick_stream(page, s)
            quick_range(page, "Last 24 hours")
            if phone:
                shows(page, page.get_by_role("button", name="Filters"))
            else:
                shows(page, grid(page))
                assert page.get_by_role("button", name="Filters").count() == 0 or not page.get_by_role("button", name="Filters").is_visible()
    for width, desk in ((DESK_MIN_PX - 1, False), (DESK_MIN_PX, True)):
        with signed_in(browser, app_url, w["user"], "/explore", space=w["space"], width=width, height=800, reduced_motion="reduce") as page:
            pick_stream(page, s)
            quick_range(page, "Last 24 hours")
            row = event_row(grid(page), "Event 1 of 3, ")
            shows(page, row)
            before = grid(page).bounding_box()["width"]
            row.click()
            shows(page, page.get_by_role("region", name="Document"))
            after = grid(page).bounding_box()["width"]
            if desk:
                assert after < before - 1, "desk: the grid narrows for the Document"
            else:
                assert abs(after - before) <= 1, "tablet: the Document overlays the grid"


def seeded_active_rule(stream_name: str, groups: tuple[str, ...]) -> dict[str, Any]:
    return {**rule_body(stream_name), "groups": [
        {"group": g, "state": "active", "since": iso(START), "history": [{"at": iso(START), "from": "pending", "to": "active"}]}
        for g in groups]}


def test_wf_phone_triage_swipe(browser: Browser, app_url: str) -> None:
    s = nm("sw")
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, [])],
              rules=[seeded_active_rule(s, ("host-1", "host-2", "host-3"))])
    rid = w["seed"]["rules"][0]["id"]
    api = Api(app_url, w["user"], w["space"])
    acked = lambda: {g["group"]: g["acknowledged_by"] for g in api.get(f"/api/rules/{rid}").json()["groups"]}
    with signed_in(browser, app_url, w["user"], f"/alerts/{rid}", space=w["space"], width=PHONE_SMALLEST_PX, height=PHONE_HEIGHT_PX) as page:
        card = lambda g: page.get_by_role("article", name=f"Group {g}, active", exact=True)
        for g in ("host-1", "host-2", "host-3"):
            shows(page, card(g))
        start_x = card("host-2").bounding_box()["x"]
        swipe(page, card("host-2"), -SWIPE_SHORT_PX, 0)
        wait_for(page, lambda: abs(card("host-2").bounding_box()["x"] - start_x) <= 1, "short swipe springs back")
        swipe(page, card("host-3"), -SWIPE_PAST_PX, DRIFT_LARGE_PX)
        settled(page)
        swipe(page, card("host-1"), -SWIPE_PAST_PX, DRIFT_SMALL_PX)
        announced(page, "Acknowledged Group host-1")
        settled(page)
        wait_for(page, lambda: acked()["host-1"] == w["user"], "the swiped group is acknowledged")
        state = acked()
        assert not state["host-2"] and not state["host-3"], f"short or steep swipes acknowledged nothing: {state}"
        tap(card("host-2").get_by_role("button", name="Acknowledge"))
        wait_for(page, lambda: acked()["host-2"] == w["user"], "Acknowledge button does the same")


CASE_TRACE = nm("t")


def test_cases_flow_and_recent(browser: Browser, app_url: str) -> None:
    s = nm("cs")
    spans = [{"span_id": "c", "parent_id": None, "service": "shop", "name": "checkout", "start_ms": 0, "duration_ms": 240}]
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, worked_alert_events(), {"host": "keyword"})],
              traces=[{"trace_id": CASE_TRACE, "spans": spans}])
    api = Api(app_url, w["user"], w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s)))["id"]
    run_check(app_url, rid, EXAMPLE_CHECK)
    run_check(app_url, rid, EXAMPLE_CHECK + timedelta(minutes=1))
    item_id = api.get("/api/inbox").json()["items"][0]["id"]
    titles = ["Checkout errors", "Ledger lag", "Disk pressure", "Queue backlog"]
    numbers = [created_ok(api.post("/api/cases", {"title": t}))["number"] for t in titles]
    assert numbers == [1, 2, 3, 4]
    for status in ("investigating", "resolved", "investigating", "resolved", "closed"):
        assert created_ok(api.patch(f"/api/cases/{numbers[0]}", {"status": status}), 200)["status"] == status
    api_error(api.patch(f"/api/cases/{numbers[0]}", {"status": "open"}), 409, "case_flow", "A case can't go from closed to open.")
    api_error(api.patch(f"/api/cases/{numbers[1]}", {"status": "open"}), 409, "case_flow", "A case can't go from open to open.")
    api_error(api.patch(f"/api/cases/{numbers[1]}", {"status": "resolved"}), 409, "case_flow", "A case can't go from open to resolved.")
    racers = [Api(app_url, w["user"], w["space"]) for _ in range(2)]
    barrier = threading.Barrier(2)

    def move(client: Api) -> httpx.Response:
        barrier.wait()
        return client.patch(f"/api/cases/{numbers[2]}", {"status": "investigating"})

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(move, racers))
    assert sorted(r.status_code for r in results) == [200, 409]
    assert [r for r in results if r.status_code == 409][0].json()["error"] == "case_flow"
    for body in ({"rule": rid, "group": "host-7"}, {"inbox_item": item_id}, {"trace_id": CASE_TRACE}):
        created_ok(api.post(f"/api/cases/{numbers[1]}/items", body))
    assert len(api.get(f"/api/cases/{numbers[1]}").json()["items"]) == 3
    with signed_in(browser, app_url, w["user"], "/alerts", space=w["space"]) as page:
        recent = page.get_by_role("region", name="Recent cases")
        for label in (case_label(4, titles[3], "open"), case_label(3, titles[2], "investigating"), case_label(2, titles[1], "open")):
            shows(page, recent.get_by_label(label, exact=True), what=label)
        assert recent.get_by_label(re.compile(r"^Case 1: ")).count() == 0
        page.goto(app_url + f"/cases/{numbers[1]}")
        items = page.get_by_role("list", name="Case items")
        shows(page, items, "Group host-7 on rule High errors")
        shows(page, items, "Inbox item: host-7 is active on rule High errors")
        assert items.get_by_role("link", name=f"Trace {CASE_TRACE}").count() == 1


WORKED_SPANS = [
    {"span_id": "c", "parent_id": None, "service": "shop", "name": "checkout", "start_ms": 0, "duration_ms": 240},
    {"span_id": "a", "parent_id": "c", "service": "shop", "name": "auth", "start_ms": 20, "duration_ms": 40},
    {"span_id": "p", "parent_id": "c", "service": "shop", "name": "pay", "start_ms": 50, "duration_ms": 100},
    {"span_id": "r", "parent_id": "c", "service": "shop", "name": "render", "start_ms": 150, "duration_ms": 70},
]


def test_wf_phone_triage_journey(browser: Browser, app_url: str) -> None:
    s = nm("pj")
    w = world(app_url, members=(("editor", "UTC"), ("editor", "UTC")),
              streams=[stream(s, worked_alert_events(), {"host": "keyword"})], traces=[{"trace_id": "t1", "spans": WORKED_SPANS}])
    engineer, colleague = w["users"]
    api = Api(app_url, colleague, w["space"])
    rid = created_ok(api.post("/api/rules", rule_body(s)))["id"]
    run_check(app_url, rid, EXAMPLE_CHECK)
    run_check(app_url, rid, EXAMPLE_CHECK + timedelta(minutes=1))
    with signed_in(browser, app_url, colleague, "/inbox", space=w["space"]) as desk, \
            signed_in(browser, app_url, engineer, f"/alerts/{rid}", space=w["space"], width=PHONE_SMALLEST_PX, height=PHONE_HEIGHT_PX) as phone:
        desk_cases = desk.context.new_page()
        desk_cases.goto(app_url + "/cases")
        shows(desk_cases, desk_cases.get_by_role("region", name="Empty"), "No cases yet.")
        article = desk.get_by_role("feed", name="Inbox").get_by_role("article", name="host-7 is active on rule High errors")
        shows(desk, article)
        card = phone.get_by_role("article", name=group_label("host-7", "active"), exact=True)
        shows(phone, card)
        swipe(phone, card, -SWIPE_PAST_PX, DRIFT_SMALL_PX)
        shows(desk, article, f"Acknowledged by {engineer}")
        tap(card.get_by_role("button", name="Add to case"))
        dialog = phone.get_by_role("dialog", name="Add to case")
        shows(phone, dialog)
        select(dialog.get_by_role("combobox", name="Case"), "New case")
        tap(dialog.get_by_role("button", name="Add", exact=True))
        announced(phone, "Added to case 1.")
        shows(desk_cases, desk_cases.get_by_role("table", name="Cases").get_by_role("row", name=re.compile(r"^Case 1: ")))
        phone.goto(app_url + "/explore")
        pick_stream(phone, s)
        tap(phone.get_by_role("button", name="Time range"))
        sheet = phone.get_by_role("dialog", name="Time range")
        shows(phone, sheet)
        tap(sheet.get_by_role("tab", name="Quick"))
        tap(sheet.get_by_role("radio", name="Last 1 hour"))
        tap(sheet.get_by_role("button", name="Apply"))
        gone(phone, sheet, "sheet closes on Apply")
        phone.goto(app_url + "/traces/t1")
        tree = phone.get_by_role("tree", name="Spans")
        root = tree.get_by_role("treeitem", name=re.compile(r"^Span checkout, 240 ms, self time 40 ms, on critical path"))
        shows(phone, root)
        pay = tree.get_by_role("treeitem", name=re.compile(r"^Span pay, 100 ms, self time 100 ms, on critical path"))
        for _ in range(2):
            was = root.get_attribute("aria-expanded")
            box = root.bounding_box()
            assert box is not None, "the span is on screen"
            phone.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + min(box["height"] / 2, 12))
            wait_for(phone, lambda w0=was: root.get_attribute("aria-expanded") not in (None, w0), "tapping toggles the span")
            if root.get_attribute("aria-expanded") == "true":
                shows(phone, pay)
            else:
                gone(phone, pay, "children hide when closed")
    numbers = [c["number"] for c in items_of(api.get("/api/cases").json())]
    case = api.get(f"/api/cases/{numbers[0]}").json()
    assert "host-7" in json.dumps(case["items"])


QUERY_EVENTS = [
    ev("q1", START - timedelta(minutes=30), message="payment gateway timeout", host="host-1", level="error", status=500,
       latency=[500, 10], request=[{"method": "GET", "status": 200}, {"method": "POST", "status": 500}], path="a:b", flag=True),
    ev("q2", START - timedelta(minutes=20), message="disk full on node-7", host="host-7", level="error", status=503,
       latency=[350], request=[{"method": "GET", "status": 503}], path="c/d", flag=False),
    ev("q3", START - timedelta(hours=2), message="retry scheduled", host="host-2", level="info", status=200,
       latency=[20], request=[{"method": "POST", "status": 200}], path="e"),
    ev("q4", START - timedelta(minutes=10), message="timeouts again", host="db-1", level="warn",
       latency=[5], request=[{"method": "GET", "status": 404}], path="f"),
]
QUERY_CASES = {
    "keyword_field": ("host:host-7", {"q2"}),
    "phrase": ('message:"gateway timeout"', {"q1"}),
    "bare_word_analyzed": ("timeout", {"q1", "q4"}),
    "existence": ("status:*", {"q1", "q2", "q3"}),
    "range": ("status>=500", {"q1", "q2"}),
    "relative_date": ("@timestamp>=now-1h", {"q1", "q2", "q4"}),
    "keyword_wildcard": ("host:host-*", {"q1", "q2", "q3"}),
    "text_wildcard": ("message:sched*", {"q3"}),
    "grouped_values": ("status:(500 OR 503)", {"q1", "q2"}),
    "object_scope": ("request{method:GET AND status>=500}", {"q2"}),
    "escape": (r"path:a\:b", {"q1"}),
    "precedence": ("NOT level:error AND host:host-2 OR host:host-7", {"q2", "q3"}),
    "multi_value_range": ("latency>300 AND latency<400", {"q1", "q2"}),
    "boolean": ("flag:true", {"q1"}),
}


@pytest.fixture(scope="module")
def query_world(app_url: str) -> dict[str, Any]:
    s = nm("q")
    w = world(app_url, streams=[stream(s, QUERY_EVENTS, {"host": "keyword", "level": "keyword", "path": "keyword"})])
    return {**w, "stream": s}


@pytest.mark.parametrize("case", list(QUERY_CASES.values()), ids=list(QUERY_CASES))
def test_spoor_query_matches(app_url: str, query_world: dict[str, Any], case: tuple[str, set[str]]) -> None:
    q, expected = case
    set_clock(app_url, START)
    api = Api(app_url, query_world["user"], query_world["space"])
    found = created_ok(api.search(query_world["stream"], START - timedelta(days=1), START + timedelta(hours=1), q=q, size=100), 200)
    assert {e["_id"] for e in found["events"]} == expected and found["total"] == len(expected), (q, found)


QUERY_ERRORS = [
    ("status:5*", "Wildcard not allowed on number field status at position 9.", 9),
    ("timeout gateway", "Expected AND or OR at position 9.", 9),
    ("nosuchfield:x", "Unknown field nosuchfield at position 1.", 1),
    ('"gateway', "Unclosed quote at position 1.", 1),
    ("status:(500 OR 503", "Unclosed parenthesis at position 8.", 8),
    ("status:", "Expected a value at position 8.", 8),
    ("status: AND timeout", "Expected a value at position 9.", 9),
    ("status>abc", "Expected a number at position 8.", 8),
    ('message:"🙂" timeout', "Expected AND or OR at position 13.", 13),
    ("(timeout AND status:", "Unclosed parenthesis at position 1.", 1),
]


def test_query_error_positions(app_url: str, query_world: dict[str, Any]) -> None:
    api = Api(app_url, query_world["user"], query_world["space"])
    for q, sentence, position in QUERY_ERRORS:
        body = api_error(api.search(query_world["stream"], START - timedelta(days=1), START, q=q), 422, "query_syntax", sentence)
        assert body["position"] == position, (q, body)


def test_wf_query_rules_error_caret(browser: Browser, app_url: str, query_world: dict[str, Any]) -> None:
    set_clock(app_url, START)
    with signed_in(browser, app_url, query_world["user"], "/explore", space=query_world["space"]) as page:
        open_search(page, query_world["stream"], hours=24)
        announced(page, "4 events found")
        box = page.get_by_role("combobox", name="Query")
        for q, sentence, position in (QUERY_ERRORS[0], QUERY_ERRORS[5]):
            run_query(page, q)
            shows(page, page.get_by_role("alert", name="Query error"), sentence)
            wait_for(page, lambda p=position: box.evaluate("el => el.selectionStart") == p - 1, "caret before the position")
        run_query(page, "status:500")
        announced(page, "1 event found")
        gone(page, page.get_by_role("alert", name="Query error"), "error clears after a good query")


def test_wf_query_rules_limits(browser: Browser, app_url: str, query_world: dict[str, Any]) -> None:
    api = Api(app_url, query_world["user"], query_world["space"])
    s = query_world["stream"]
    lo, hi = START - timedelta(days=1), START + timedelta(hours=1)
    assert api.search(s, lo, hi, q="a" * QUERY_MAX_LEN).status_code == 200
    api_error(api.search(s, lo, hi, q="a" * (QUERY_MAX_LEN + 1)), 422, "query_too_long", "Query is longer than 2000 characters.")
    span = {"stream": s, "from": iso(lo), "to": iso(hi), "filters": []}
    ok = api.post("/api/snapshots", {**span, "q": "🙂" * QUERY_MAX_LEN})
    assert ok.status_code != 422 or ok.json()["error"] != "query_too_long", "2000 emoji are 2000 characters"
    api_error(api.post("/api/snapshots", {**span, "q": "🙂" * (QUERY_MAX_LEN + 1)}), 422, "query_too_long")
    nested = lambda d: "(" * d + "timeout" + ")" * d
    assert api.search(s, lo, hi, q=nested(QUERY_MAX_DEPTH)).status_code == 200
    api_error(api.search(s, lo, hi, q=nested(QUERY_MAX_DEPTH + 1)), 422, "query_too_deep", "Query nests deeper than 8 levels.")
    api_error(api.search(s, lo, hi, q="(" * 1001 + ")" * 1001), 422, "query_too_long")
    assert api.search(s, lo, hi, size=PAGE_SIZE, offset=RESULT_WINDOW - PAGE_SIZE).status_code == 200
    api_error(api.search(s, lo, hi, size=PAGE_SIZE, offset=RESULT_WINDOW - PAGE_SIZE + 1), 422, "result_window",
              "Results past 200 need a snapshot.")
    set_clock(app_url, START)
    with signed_in(browser, app_url, query_world["user"], "/explore", space=query_world["space"]) as page:
        open_search(page, s, hours=24)
        announced(page, "4 events found")
        run_query(page, "a" * (QUERY_MAX_LEN + 1))
        shows(page, page.get_by_role("alert").filter(has_text="Query is longer than 2000 characters."))
        run_query(page, nested(QUERY_MAX_DEPTH + 1))
        shows(page, page.get_by_role("alert").filter(has_text="Query nests deeper than 8 levels."))


def test_wf_query_rules_work_budget(browser: Browser, app_url: str) -> None:
    s, side = nm("wk"), nm("up")
    message = " ".join(f"x{i}" for i in range(WORK_TOKENS))
    w = world(app_url, members=(("admin", "UTC"),), streams=[stream(s, [ev("big", START - timedelta(minutes=1), message=message)]),
                                                            stream(side, [])])
    api, uploader = Api(app_url, w["user"], w["space"]), Api(app_url, w["user"], w["space"])
    barrier = threading.Barrier(2)

    def query() -> tuple[httpx.Response, float]:
        barrier.wait()
        t0 = time.monotonic()
        r = api.search(s, START - timedelta(days=1), START, q="message:x*")
        return r, (time.monotonic() - t0) * 1000

    def upload() -> tuple[httpx.Response, float]:
        barrier.wait()
        t0 = time.monotonic()
        r = uploader.bulk(side, [ev("side-1", START - timedelta(minutes=1), message="still here")])
        return r, (time.monotonic() - t0) * 1000

    with ThreadPoolExecutor(2) as pool:
        fq, fu = pool.submit(query), pool.submit(upload)
        (qr, q_ms), (ur, u_ms) = fq.result(), fu.result()
    api_error(qr, 422, "query_work_limit", "Query stopped: work limit of 20000 reached.")
    assert q_ms < BUDGET_MS, f"refusal took {q_ms:.0f} ms"
    assert ur.status_code == 200 and ur.json()["created"] == 1 and u_ms < BUDGET_MS, ur.text
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        open_search(page, s, hours=24)
        announced(page, "1 event found")
        run_query(page, "message:x*")
        shows(page, page.get_by_role("alert").filter(has_text="Query stopped: work limit of 20000 reached."))


WORKED_TOKENS = [("server", 1, 4, 11), ("fail", 2, 12, 18), ("retry", 3, 20, 28), ("2", 4, 29, 30), ("connection", 5, 31, 42)]
WORKED_TEXT = "The servers failed, retrying 2 connections"


def test_wf_relevance_analyze_page(browser: Browser, app_url: str) -> None:
    s = nm("an")
    w = world(app_url, members=(("viewer", "UTC"),), streams=[stream(s, [])])
    api = Api(app_url, w["user"], w["space"])
    toks = lambda analyzer, text: [(t["token"], t["position"], t["start"], t["end"])
                                   for t in created_ok(api.post("/api/analyze", {"analyzer": analyzer, "text": text}), 200)["tokens"]]
    assert toks("standard", WORKED_TEXT) == WORKED_TOKENS
    assert toks("keyword", "Disk Full") == [("Disk Full", 0, 0, len("Disk Full"))]
    text = "Hello  World the"
    assert toks("whitespace", text) == [("Hello", 0, 0, 5), ("World", 1, 7, 12), ("the", 2, 13, 16)]
    with signed_in(browser, app_url, w["user"], f"/streams/{s}/analyze", space=w["space"]) as page:
        page.get_by_role("textbox", name="Text", exact=True).fill(WORKED_TEXT)
        select(page.get_by_role("combobox", name="Analyzer"), "standard")
        page.get_by_role("button", name="Analyze").click()
        table = page.get_by_role("table", name="Tokens")
        shows(page, table, "connection")
        for name in ("Token", "Position", "Start", "End"):
            assert table.get_by_role("columnheader", name=name).count() == 1
        rows = table.get_by_role("row").filter(has=page.get_by_role("cell"))
        got = [tuple(c.strip() for c in rows.nth(i).get_by_role("cell").all_inner_texts()) for i in range(rows.count())]
        assert got == [tuple(str(v) for v in row) for row in WORKED_TOKENS]


RELEVANCE_EVENTS = [
    ev("e1", START - timedelta(minutes=4), message="payment gateway timeout"),
    ev("e2", START - timedelta(minutes=3), message="gateway timeout, timeout again"),
    ev("e3", START - timedelta(minutes=2), message="disk full on node"),
    ev("e4", START - timedelta(minutes=1), message="retry scheduled"),
]
GATEWAY_E2 = "gateway in message: 1.2199 = idf 0.6931 x tf_norm 0.88 x boost 2"
TIMEOUT_E2 = "timeout in message: 1.7428 = idf 0.6931 x tf_norm 1.2571 x boost 2"


def test_wf_relevance_score_explanation(browser: Browser, app_url: str) -> None:
    s = nm("rv")
    w = world(app_url, streams=[stream(s, RELEVANCE_EVENTS)])
    api = Api(app_url, w["user"], w["space"])
    found = created_ok(api.search(s, START - timedelta(days=1), START, q="gateway OR timeout", explain="true"), 200)
    events = found["events"]
    assert [e["_id"] for e in events] == ["e2", "e1"]
    assert Decimal(str(events[0]["_score"])) == Decimal("2.9627") and Decimal(str(events[1]["_score"])) == Decimal("2.7726")
    for e in events:
        ex = e["explanation"]
        assert ex["text"] == f"Score {ex['value']}" and Decimal(str(ex["value"])) == Decimal(str(e["_score"]))
        assert sum(Decimal(str(c["value"])) for c in ex["children"]) == Decimal(str(ex["value"]))
    assert {c["text"] for c in events[0]["explanation"]["children"]} == {GATEWAY_E2, TIMEOUT_E2}
    assert [Decimal(str(c["value"])) for c in events[1]["explanation"]["children"]] == [Decimal("1.3863")] * 2
    only = created_ok(api.search(s, START - timedelta(days=1), START, q="gateway OR timeout", id="e1"), 200)["events"]
    assert [e["_id"] for e in only] == ["e1"] and Decimal(str(only[0]["_score"])) == Decimal("2.7726")
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        open_search(page, s, hours=24)
        run_query(page, "gateway OR timeout")
        announced(page, "2 events found")
        tab_into(page, grid(page))
        page.keyboard.press("Enter")
        doc = page.get_by_role("region", name="Document")
        shows(page, doc, "gateway timeout, timeout again")
        doc.get_by_role("button", name="Explain score").click()
        tree = doc.get_by_role("tree", name="Score explanation")
        root = tree.get_by_role("treeitem", name=re.compile(r"^Score 2\.9627"))
        shows(page, root)
        tab_into(page, tree, presses=10)
        page.keyboard.press("Home")
        wait_for(page, lambda: focus_in(root), "Home focuses the root")
        if root.get_attribute("aria-expanded") == "false":
            page.keyboard.press("ArrowRight")
            wait_for(page, lambda: root.get_attribute("aria-expanded") == "true", "ArrowRight opens the root")
        child = tree.get_by_role("treeitem", name=GATEWAY_E2)
        shows(page, child)
        page.keyboard.press("ArrowRight")
        wait_for(page, lambda: " in message: " in page.evaluate("() => document.activeElement.textContent"), "focus on a leaf")
        page.keyboard.press("ArrowLeft")
        wait_for(page, lambda: page.evaluate("() => document.activeElement.textContent").strip().startswith("Score 2.9627"),
                 "ArrowLeft returns to the parent")


def test_phrases_and_highlights(browser: Browser, app_url: str) -> None:
    s = nm("ph")
    disk, e2 = "Disk full on node-7", "gateway timeout, timeout again"
    w = world(app_url, streams=[stream(s, [ev("h1", START - timedelta(minutes=3), message=disk),
                                           ev("h2", START - timedelta(minutes=2), message="full node ready"),
                                           ev("h3", START - timedelta(minutes=1), message=e2)])])
    api = Api(app_url, w["user"], w["space"])
    look = lambda q: created_ok(api.search(s, START - timedelta(days=1), START, q=q), 200)["events"]
    assert [e["_id"] for e in look('"full node"')] == ["h2"]
    hit = look('"full on node"')
    assert [e["_id"] for e in hit] == ["h1"]
    full, node = disk.index("full"), disk.index("node")
    assert sorted(map(list, hit[0]["highlights"]["message"])) == [[full, full + 4], [node, node + 4]]
    t = look("timeout")
    first, second = e2.index("timeout"), e2.index("timeout", e2.index("timeout") + 1)
    assert sorted(map(list, t[0]["highlights"]["message"])) == [[first, first + 7], [second, second + 7]]
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        open_search(page, s, hours=24)
        run_query(page, '"full on node"')
        announced(page, "1 event found")
        g = grid(page)
        shows(page, event_row(g, "Event 1 of 1, "))
        assert g.evaluate("el => [...el.querySelectorAll('mark')].map(m => m.textContent)") == ["full", "node"]
        event_row(g, "Event 1 of 1, ").click()
        doc = page.get_by_role("region", name="Document")
        shows(page, doc, disk)
        assert doc.evaluate("el => [...el.querySelectorAll('mark')].map(m => m.textContent)") == ["full", "node"]


TS_MS = 1772323200000


def pipeline_processors() -> list[dict[str, Any]]:
    return [
        {"type": "split", "field": "pair", "pattern": "=", "targets": ["k", "v"]},
        {"type": "rename", "from": "msg", "to": "message"},
        {"type": "set", "field": "env", "value": "prod", "if": {"field": "tier", "op": "eq", "value": "gold"}},
        {"type": "parse_date", "field": "ts", "format": "epoch_ms"},
        {"type": "redact", "field": "message", "pattern": "ipv4"},
        {"type": "redact", "field": "contact", "pattern": "email"},
        {"type": "set", "field": "seen", "value": True, "if": {"field": "tier", "op": "ne", "value": "gold"}},
        {"type": "drop", "if": {"field": "level", "op": "eq", "value": "debug"}},
    ]


SAMPLES = [
    {"_id": "a1", "pair": "x=1", "msg": "from 10.0.0.1 and 999.1.1.1", "contact": "mail ana.b@ex-ample.co now",
     "tier": "gold", "ts": TS_MS, "level": "info"},
    {"_id": "a2", "pair": "y=2", "msg": "m", "ts": TS_MS, "level": "debug"},
    {"_id": "a3", "pair": "novalue", "msg": "m", "ts": TS_MS, "level": "info"},
    {"_id": "a4", "pair": "z=3", "ts": TS_MS, "level": "info"},
]


def test_pipeline_processors(app_url: str) -> None:
    s, p = nm("pl"), nm("p")
    w = world(app_url, streams=[stream(s, [])])
    api = Api(app_url, w["user"], w["space"])
    assert created_ok(api.put(f"/api/pipelines/{p}", {"processors": pipeline_processors()}))["version"] == 1
    out = created_ok(api.bulk(s, SAMPLES, pipeline=p), 200)
    lines = {l["line"]: l for l in out["lines"]}
    assert [lines[n]["status"] for n in (1, 2, 3, 4)] == ["created", "dropped", "failed", "failed"]
    assert (out["created"], out["dropped"], out["failed"]) == (1, 1, 2)
    assert f"Pipeline {p} failed at processor 1: split made 1 parts, expected 2." in lines[3]["error"]
    assert f"Pipeline {p} failed at processor 2: field msg is missing." in lines[4]["error"]
    stored = created_ok(api.search(s, START - timedelta(hours=1), START + timedelta(hours=1), id="a1"), 200)["events"]
    assert len(stored) == 1
    e = stored[0]
    assert e["@timestamp"] == iso(START) and e["_pipeline"] == f"{p}@1"
    f = e["fields"]
    assert (f["k"], f["v"], f["pair"], f["env"]) == ("x", "1", "x=1", "prod")
    assert f["message"] == SAMPLES[0]["msg"].replace(IPV4_SAMPLE, "[hidden]")
    assert f["contact"] == SAMPLES[0]["contact"].replace(EMAIL_SAMPLE, "[hidden]")
    assert MSG_FIELD not in f and SEEN_FIELD not in f
    assert created_ok(api.search(s, START - timedelta(hours=1), START + timedelta(hours=1), id="a2"), 200)["events"] == []
    failures = api.get(f"/api/streams/{s}/failures").json()["failures"]
    assert {x["raw"] for x in failures} == {json.dumps(SAMPLES[2]), json.dumps(SAMPLES[3])}
    api_error(api.bulk(s, [SAMPLES[0]], pipeline="nosuch"), 422, "unknown_pipeline", "Pipeline nosuch doesn't exist.")


def test_wf_pipelines_simulate(browser: Browser, app_url: str) -> None:
    s, p = nm("sm"), nm("p")
    w = world(app_url, members=(("admin", "UTC"),), streams=[stream(s, [ev("keep", START - timedelta(minutes=1), message="x")])])
    api = Api(app_url, w["user"], w["space"])
    created_ok(api.put(f"/api/pipelines/{p}", {"processors": pipeline_processors()}))
    sample_text = "\n".join([json.dumps(SAMPLES[0]), json.dumps(SAMPLES[1]), json.dumps(SAMPLES[2]), "{bad"])
    counts = lambda: ({x["name"]: x["events"] for x in api.get("/api/streams").json()["streams"]}, len(api.get(f"/api/streams/{s}/failures").json()["failures"]))
    before = counts()
    res = created_ok(api.post(f"/api/pipelines/{p}/simulate", {"lines": sample_text}), 200)["results"]
    assert res[0]["outcome"] == "stored"
    assert [st["status"] for st in res[0]["steps"]] == ["applied"] * 6 + ["skipped"] * 2
    assert {"k", "v"} <= set(res[0]["steps"][0]["changed"]) and res[0]["steps"][2]["changed"] == ["env"]
    assert res[1]["outcome"] == "dropped" and res[1]["steps"][2]["status"] == "skipped"
    assert res[1]["steps"][6]["status"] == "applied" and res[1]["steps"][7]["status"] == "dropped"
    assert res[2]["outcome"] == "failed" and len(res[2]["steps"]) == 1 and res[2]["steps"][0]["status"] == "failed"
    assert res[3]["error"] == "Event 4: not valid JSON."
    with signed_in(browser, app_url, w["user"], f"/pipelines/{p}/simulate", space=w["space"]) as page:
        sim = page.get_by_role("region", name="Simulate")
        sim.get_by_role("textbox", name="Sample events").fill(sample_text)
        sim.get_by_role("button", name="Run simulation").click()
        e1, e2, e3 = (sim.get_by_role("group", name=f"Event {n}", exact=True) for n in (1, 2, 3))
        shows(page, e1)
        step1 = e1.get_by_role("group", name=step_name(1, "split"))
        shows(page, step1, "changed")
        assert step1.evaluate("el => el.querySelectorAll('[data-changed=\"true\"]').length") >= 1
        shows(page, e2.get_by_role("group", name=step_name(3, "set")), "Skipped: condition false")
        shows(page, e2.get_by_role("group", name=step_name(8, "drop")), "Dropped")
        shows(page, e3.get_by_role("group", name=step_name(1, "split")), f"Pipeline {p} failed at processor 1: split made 1 parts, expected 2.")
        assert e3.get_by_role("group", name=step_name(2, "rename")).count() == 0
        shows(page, sim, "Event 4: not valid JSON.")
    assert counts() == before, "simulation stored nothing"


def test_wf_pipelines_edit_in_use(browser: Browser, app_url: str) -> None:
    s, p = nm("ed"), nm("p")
    w = world(app_url, streams=[stream(s, [])])
    api = Api(app_url, w["user"], w["space"])
    created_ok(api.put(f"/api/pipelines/{p}", {"processors": [{"type": "set", "field": "env", "value": "prod"}]}))
    created_ok(api.bulk(s, [ev("c1", START - timedelta(minutes=2), message="first")], pipeline=p), 200)
    v2 = [{"type": "set", "field": "env", "value": "dev"}]
    with signed_in(browser, app_url, w["user"], f"/pipelines/{p}", space=w["space"]) as page:
        shows(page, page.get_by_text("Version 1"))
        page.get_by_role("textbox", name="Processors JSON").fill(json.dumps(v2))
        page.get_by_role("button", name="Save pipeline").click()
        announced(page, "Pipeline saved. Only new events are affected.")
        shows(page, page.get_by_text("Version 2"))
    created_ok(api.bulk(s, [ev("c2", START - timedelta(minutes=1), message="second")], pipeline=p), 200)
    get = lambda i: created_ok(api.search(s, START - timedelta(hours=1), START, id=i), 200)["events"][0]
    assert (get("c1")["_pipeline"], get("c1")["fields"]["env"]) == (f"{p}@1", "prod")
    assert (get("c2")["_pipeline"], get("c2")["fields"]["env"]) == (f"{p}@2", "dev")
    again = created_ok(api.put(f"/api/pipelines/{p}", {"processors": v2}), 200)
    assert again["version"] == 3 and again["message"] == "Pipeline saved. Only new events are affected."


POLICY = {"rollover_max_age_ms": ONE_MINUTE_MS, "rollover_max_events": None, "warm_after_ms": WARM_AFTER_MS,
          "archive_after_ms": ARCHIVE_AFTER_MS, "delete_after_ms": None}


def aging_stream(name: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    return stream(name, events, lifecycle=POLICY, generations=hot(events, created=ROLLOVER_AT - timedelta(minutes=1)))


def test_wf_lifecycle_rollover_timeline(browser: Browser, app_url: str) -> None:
    a, b = nm("la"), nm("lb")
    evs = lambda: [ev("x1", ROLLOVER_AT - timedelta(hours=1), message="old"), ev("x2", ROLLOVER_AT - timedelta(minutes=59), message="old")]
    w = world(app_url, streams=[aging_stream(a, evs()), aging_stream(b, evs())])
    sp = w["space"]
    api = Api(app_url, w["user"], sp)
    set_clock(app_url, ROLLOVER_AT)
    gens = lifecycle_step(app_url, sp, a)
    lifecycle_step(app_url, sp, b)
    assert sorted(gens) == [1, 2] and gens[1]["rolled_over_at"] == iso(ROLLOVER_AT) and gens[2]["phase"] == "hot"
    t = lambda m: shown(ROLLOVER_AT + timedelta(minutes=m))
    assert gens[1]["timeline"] == f"Generation 1, hot, next: warm at {t(1)}"
    assert gens[2]["timeline"] == f"Generation 2, hot, next: rollover at {t(1)}"
    with signed_in(browser, app_url, w["user"], f"/streams/{a}/lifecycle", space=sp, device_time=DEVICE_TIME) as page:
        timeline = page.get_by_role("list", name="Generation timeline")
        shows(page, timeline, f"Generation 1, hot, next: warm at {t(1)}")
        set_clock(app_url, ROLLOVER_AT + timedelta(minutes=1))
        with ThreadPoolExecutor(2) as pool:
            list(pool.map(lambda _: lifecycle_step(app_url, sp, a), range(2)))
        gens = {g["number"]: g for g in api.get(f"/api/streams/{a}/generations").json()["generations"]}
        assert sorted(gens) == [1, 2], "two simultaneous steps roll over at most once"
        assert gens[1]["timeline"] == f"Generation 1, warm, next: archive at {t(2)}"
        shows(page, timeline, f"Generation 1, warm, next: archive at {t(2)}")
        set_clock(app_url, ROLLOVER_AT + timedelta(minutes=2))
        gens = lifecycle_step(app_url, sp, a)
        assert gens[1]["phase"] == "archive" and gens[1]["timeline"] == "Generation 1, archive, next: none"
        shows(page, timeline, "Generation 1, archive, next: none")
        assert timeline.get_by_role("listitem").count() == 2
    assert f"segments/{sp}/{a}/1.ndjson" in S3().keys(f"segments/{sp}/{a}/")
    gb = lifecycle_step(app_url, sp, b)
    assert gb[1]["phase"] == "archive", "first step at 10:02 goes from hot straight to archive"
    saved = created_ok(api.put(f"/api/streams/{b}/lifecycle", {**POLICY, "warm_after_ms": 10 * WARM_AFTER_MS}), 200)
    assert saved["message"] == "Policy saved. It applies from the next step, and no generation moves backward."
    set_clock(app_url, ROLLOVER_AT + timedelta(minutes=3))
    assert lifecycle_step(app_url, sp, b)[1]["phase"] == "archive"


def test_read_only_generations(app_url: str) -> None:
    s = nm("ro")
    rolled = iso(START - timedelta(days=3))
    gens = [
        {"number": 1, "phase": "archive", "created_at": iso(START - timedelta(days=5)), "rolled_over_at": rolled,
         "events": [ev("r1", START - timedelta(days=4), level="info", message="one")]},
        {"number": 2, "phase": "warm", "created_at": rolled, "rolled_over_at": iso(START - timedelta(days=1)),
         "events": [ev("r2", START - timedelta(days=2), level="info", message="two")]},
        {"number": 3, "phase": "hot", "created_at": iso(START - timedelta(days=1)), "rolled_over_at": None,
         "events": [ev("r3", START - timedelta(hours=1), level="info", message="three")]},
    ]
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, generations=gens, mappings={"level": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    api_error(api.patch(f"/api/streams/{s}/events/r2", {"fields": "not an object"}), 409, "generation_read_only",
              "Generation 2 is warm and read-only.")
    api_error(api.patch(f"/api/streams/{s}/events/r1", {"fields": "not an object"}), 409, "generation_read_only",
              "Generation 1 is archive and read-only.")
    api_error(api.patch(f"/api/streams/{s}/events/r3", {"fields": "not an object"}), 422, "invalid")
    edited = created_ok(api.patch(f"/api/streams/{s}/events/r3", {"fields": {"level": "warn"}}), 200)
    assert edited["fields"]["level"] == "warn"


def test_wf_lifecycle_archive_outage(browser: Browser, app_url: str) -> None:
    s = nm("ar")
    events = [ev("z1", ROLLOVER_AT - timedelta(hours=1), message="arch"), ev("a2", ROLLOVER_AT - timedelta(hours=1), message="arch"),
              ev("m3", ROLLOVER_AT - timedelta(hours=1, minutes=1), message="arch")]
    w = world(app_url, streams=[aging_stream(s, events)])
    sp, key = w["space"], f"segments/{w['space']}/{s}/1.ndjson"
    api = Api(app_url, w["user"], sp)
    lo, hi = ROLLOVER_AT - timedelta(hours=2), ROLLOVER_AT + timedelta(hours=1)
    try:
        set_clock(app_url, ROLLOVER_AT)
        lifecycle_step(app_url, sp, s)
        set_clock(app_url, ROLLOVER_AT + timedelta(minutes=1))
        lifecycle_step(app_url, sp, s)
        storage(app_url, True)
        set_clock(app_url, ROLLOVER_AT + timedelta(minutes=2))
        assert lifecycle_step(app_url, sp, s)[1]["phase"] == "warm"
        storage(app_url, False)
        assert key not in S3().keys(f"segments/{sp}/{s}/")
        with signed_in(browser, app_url, w["user"], f"/streams/{s}/lifecycle", space=sp) as page:
            shows(page, page.get_by_role("main"), "Archive failed. It will retry on the next step.")
        set_clock(app_url, ROLLOVER_AT + timedelta(minutes=3))
        assert lifecycle_step(app_url, sp, s)[1]["phase"] == "archive"
        lines = [json.loads(l) for l in S3().get(key).decode().splitlines() if l.strip()]
        assert [l["_id"] for l in lines] == ["m3", "a2", "z1"]
        created_ok(api.bulk(s, [ev("n1", ROLLOVER_AT + timedelta(seconds=30), message="arch")]), 200)
        full = created_ok(api.search(s, lo, hi, size=100), 200)
        assert full["total"] == 4 and not full["partial"]
        assert {e["_id"] for e in full["events"] if e["_phase"] == "archive"} == {"m3", "a2", "z1"}
        with signed_in(browser, app_url, w["user"], "/explore", space=sp) as page:
            open_search(page, s, start=datetime(2026, 3, 1, 8, tzinfo=timezone.utc), end=datetime(2026, 3, 1, 11, tzinfo=timezone.utc))
            announced(page, "4 events found")
            shows(page, grid(page), "From archive")
            assert grid(page).evaluate("g => g.querySelectorAll('[data-source=\"archive\"]').length") == 3
            storage(app_url, True)
            page.get_by_role("combobox", name="Query").press("Enter")
            announced(page, "1 event found")
            shows(page, page.get_by_role("status", name="Partial results"),
                  "Partial results: 1 archived generation skipped because storage is unavailable.")
            partial = created_ok(api.search(s, lo, hi), 200)
            assert partial["partial"] is True and partial["skipped_generations"] == 1 and partial["total"] == 1
            storage(app_url, False)
            page.get_by_role("combobox", name="Query").press("Enter")
            announced(page, "4 events found")
            gone(page, page.get_by_role("status", name="Partial results"), "banner clears when storage returns")
        assert created_ok(api.search(s, lo, hi), 200)["partial"] is False
    finally:
        storage(app_url, False)


def test_wf_moving_data_paging(browser: Browser, app_url: str) -> None:
    a, b = nm("pa"), nm("pb")
    make = lambda: [ev(f"k{i:02d}", START - timedelta(minutes=i + 1), message="page") for i in range(25)]
    roll = {"rollover_max_age_ms": None, "rollover_max_events": 1, "warm_after_ms": None, "archive_after_ms": None, "delete_after_ms": None}
    w = world(app_url, streams=[stream(a, make(), lifecycle=roll), stream(b, make())])
    api = Api(app_url, w["user"], w["space"])
    set_clock(app_url, START)
    span = {"from": iso(START - timedelta(days=1)), "to": iso(START), "q": "", "filters": []}
    snap = created_ok(api.post("/api/snapshots", {"stream": a, **span}))
    assert snap["total"] == 25
    page1 = created_ok(api.get(f"/api/snapshots/{snap['id']}"), 200)
    created_ok(api.bulk(a, [ev(f"new{i}", START - timedelta(seconds=10 + i), message="page") for i in range(5)]), 200)
    lifecycle_step(app_url, w["space"], a)
    seen, cursor, pages = [e["_id"] for e in page1["events"]], page1["next"], [len(page1["events"])]
    for _ in range(10):
        if cursor is None:
            break
        nxt = created_ok(api.get(f"/api/snapshots/{snap['id']}", after=cursor), 200)
        seen += [e["_id"] for e in nxt["events"]]
        pages.append(len(nxt["events"]))
        cursor, last = nxt["next"], nxt
    assert cursor is None and pages == [PAGE_SIZE, PAGE_SIZE, 5]
    assert seen == [f"k{i:02d}" for i in range(25)], "frozen order, no duplicates, no gaps"
    assert last["new_events"] == 5
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page, \
            signed_in(browser, app_url, w["user"], f"/streams/{b}", space=w["space"]) as uploader:
        open_search(page, b, hours=24)
        announced(page, "25 events found")
        shows(uploader, uploader.get_by_role("region", name="Ingest status"), "55 events stored, 0 in failure store")
        created_ok(api.bulk(b, [ev(f"nb{i}", START - timedelta(seconds=10 + i), message="page") for i in range(3)]), 200)
        shows(uploader, uploader.get_by_role("region", name="Ingest status"), "58 events stored, 0 in failure store")
        more = page.get_by_role("button", name="Show new events")
        shows(page, more, "3 new events since this search")
        g = grid(page)
        tab_into(page, g)
        page.keyboard.press("End")
        last_row = event_row(g, "Event 25 of 25, ")
        wait_for(page, lambda: last_row.count() == 1 and focus_in(last_row), "paged to the end of the frozen list")
        assert g.get_by_role("row").count() - 1 <= GRID_MAX_ROWS
        more.click()
        announced(page, "28 events found")


def test_snapshot_expiry(browser: Browser, app_url: str) -> None:
    s = nm("ex")
    w = world(app_url, streams=[stream(s, [ev(f"x{i:03d}", START - timedelta(seconds=i + 1), message="exp") for i in range(EXPIRY_EVENTS)])])
    api = Api(app_url, w["user"], w["space"])
    span = {"stream": s, "from": iso(START - timedelta(days=1)), "to": iso(START), "q": "", "filters": []}
    set_clock(app_url, START)
    snap = created_ok(api.post("/api/snapshots", span))["id"]
    used = START + timedelta(milliseconds=SNAPSHOT_TTL_MS - 1)
    set_clock(app_url, used)
    assert api.get(f"/api/snapshots/{snap}").status_code == 200, "still alive one millisecond before expiry"
    set_clock(app_url, used + timedelta(milliseconds=SNAPSHOT_TTL_MS))
    api_error(api.get(f"/api/snapshots/{snap}"), 410, "snapshot_expired",
              "This snapshot expired. Results may have changed. Start a new search.")
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        open_search(page, s, hours=24)
        announced(page, f"{EXPIRY_EVENTS} events found")
        set_clock(app_url, START + timedelta(milliseconds=SNAPSHOT_TTL_MS * 2))
        tab_into(page, grid(page))
        page.keyboard.press("End")
        alert = page.get_by_role("alert", name="Snapshot expired")
        shows(page, alert, "This snapshot expired. Results may have changed. Start a new search.")
        alert.get_by_role("button", name="Start a new search").click()
        gone(page, alert, "a new search replaces the expired one")
        wait_for(page, lambda: grid(page).get_attribute("data-search-state") == "done", "new search done")


def test_wf_moving_data_tail_pause(browser: Browser, app_url: str) -> None:
    s = nm("tl")
    w = world(app_url, streams=[stream(s, [], {"host": "keyword", "level": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        open_search(page, s)
        page.get_by_role("button", name="Live tail").click()
        tail = page.get_by_role("region", name="Live tail")
        shows(page, tail.get_by_role("button", name="Pause"))
        when = START - timedelta(seconds=5)
        created_ok(api.bulk(s, [ev("t0", when, host="host-1", level="info", message="tail first")]), 200)
        shows(page, tail, f"{shown(when)} host-1 info tail first")
        tail.get_by_role("button", name="Pause").click()
        shows(page, tail.get_by_role("button", name="Resume"))
        created_ok(api.bulk(s, [ev(f"t{i:03d}", when, host="host-1", level="info", message=f"tail m{i:03d}")
                                for i in range(1, TAIL_BURST + 1)]), 200)
        shows(page, tail, "Live tail paused: 55 new events")
        shows(page, tail, "Buffer full: oldest 5 events discarded.")
        announced(page, "Live tail paused: 55 new events")
        tail.get_by_role("button", name="Resume").click()
        shows(page, tail, f"m{TAIL_BURST:03d}")
        text = tail.inner_text()
        oldest = f"m{TAIL_BURST - TAIL_BUFFER + 1:03d}"
        assert oldest in text and all(f"m{i:03d}" not in text for i in range(1, TAIL_BURST - TAIL_BUFFER + 1))
        assert text.index(oldest) < text.index(f"m{TAIL_BURST:03d}"), "buffer written in arrival order"


def test_wf_moving_data_tail_rate(browser: Browser, app_url: str) -> None:
    s = nm("tr")
    w = world(app_url, streams=[stream(s, [], {"host": "keyword", "level": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    set_clock(app_url, START)
    set_rates(app_url, {**GRADING_RATES, "tail": 1})
    sse = Sse(app_url, api.http.cookies, "/api/tail", {"stream": s, "space": w["space"]})
    try:
        sse.wait(lambda x: bool(x.named("start")), "event: start")
        assert sse.named("start")[0]["stream"] == s
        sse.wait(lambda x: x.comments > 0, "a heartbeat comment")
        created_ok(api.bulk(s, [ev(f"r{i}", START - timedelta(seconds=i + 1), host="h", level="info", message="r") for i in range(3)]), 200)
        sse.wait(lambda x: bool(x.named("slowed")), "event: slowed")
        assert len(sse.named("line")) == 1 and sum(x["skipped"] for x in sse.named("slowed")) >= 1
        with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
            open_search(page, s)
            page.get_by_role("button", name="Live tail").click()
            tail = page.get_by_role("region", name="Live tail")
            shows(page, tail.get_by_role("button", name="Pause"))
            created_ok(api.bulk(s, [ev(f"u{i}", START - timedelta(seconds=i + 1), host="h", level="info", message="u") for i in range(3)]), 200)
            shows(page, tail, "Live tail slowed: rate limit reached.")
    finally:
        sse.close()
        set_rates(app_url, GRADING_RATES)


def test_bulk_line_results(app_url: str) -> None:
    s = nm("bk")
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, [ev("seed1", START - timedelta(hours=1), status=200, message="ok")])])
    api = Api(app_url, w["user"], w["space"])
    at = iso(START - timedelta(minutes=1))
    good = json.dumps({"_id": "d1", "@timestamp": at, "status": 200, "message": "ok"})
    lines = [good, "", "not json", "[1, 2]", json.dumps({"_id": "d5"}), json.dumps({"@timestamp": "yesterday"}),
             json.dumps({"@timestamp": at, "status": "oops"}), json.dumps({"@timestamp": at, "tags": [1, "a"]}), good,
             json.dumps({"@timestamp": at, "message": "no id"})]
    out = created_ok(api.bulk(s, lines), 200)
    by = {l["line"]: l for l in out["lines"]}
    assert (out["created"], out["duplicates"], out["dropped"], out["failed"]) == (2, 1, 0, 6)
    assert by[1]["status"] == "created" and by[1]["id"] == "d1" and by[9]["status"] == "duplicate"
    assert by[10]["status"] == "created" and by[10]["id"]
    errors = {3: "Line 3: not valid JSON.", 4: "Line 4: not an object.", 5: "Line 5: @timestamp is missing.",
              6: "Line 6: @timestamp is not a date.", 7: "Line 7: field status expects number, got text.",
              8: "Line 8: field tags mixes types in one array."}
    for n, sentence in errors.items():
        assert by[n]["status"] == "failed" and by[n]["error"] == sentence, by[n]
    failures = api.get(f"/api/streams/{s}/failures").json()["failures"]
    assert {f["raw"] for f in failures} == {lines[n - 1] for n in errors}
    assert created_ok(api.bulk(s, [good]), 200)["duplicates"] == 1
    assert len(created_ok(api.search(s, START - timedelta(hours=2), START, id="d1"), 200)["events"]) == 1


def test_bulk_conflict_and_concurrency(app_url: str) -> None:
    s = nm("cf")
    gens = [{"number": 1, "phase": "warm", "created_at": iso(START - timedelta(days=3)), "rolled_over_at": iso(START - timedelta(days=1)),
             "events": [ev("old1", START - timedelta(days=2), code=5, message="old")]},
            {"number": 2, "phase": "hot", "created_at": iso(START - timedelta(days=1)), "rolled_over_at": None, "events": []}]
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, generations=gens)])
    api = Api(app_url, w["user"], w["space"])
    at = START - timedelta(hours=1)
    assert created_ok(api.bulk(s, [ev("old1", at, message="again")]), 200)["lines"][0]["status"] == "duplicate"
    assert created_ok(api.bulk(s, [ev("n1", at, code="abc", message="new")]), 200)["created"] == 1
    sentence = "Field code is number in generation 1 and text in generation 2. It can't be sorted or counted."
    span = {"from": iso(START - timedelta(days=3)), "to": iso(START)}
    fields = {f["field"]: f for f in api.get("/api/fields", stream=s, **span).json()["fields"]}
    assert fields["code"]["type"] == "conflict" and fields["code"]["conflict"] == sentence
    api_error(api.search(s, START - timedelta(days=3), START, sort="code:asc"), 422, "field_conflict", sentence)
    api_error(api.get("/api/fields/stats", field="code", stream=s, q="", **span), 422, "field_conflict", sentence)
    assert [e["_id"] for e in api.search(s, START - timedelta(days=3), START, q="code:5").json()["events"]] == ["old1"]
    racers = [Api(app_url, w["user"], w["space"]) for _ in range(2)]
    barrier = threading.Barrier(2)

    def send(client: Api) -> str:
        barrier.wait()
        return created_ok(client.bulk(s, [ev("race1", at, message="race")]), 200)["lines"][0]["status"]

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(send, racers)) == ["created", "duplicate"]
    assert len(api.search(s, START - timedelta(days=3), START, id="race1").json()["events"]) == 1


def test_wf_upload_limits(browser: Browser, app_url: str, tmp_path: Path) -> None:
    s = nm("lm")
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, [])])
    api = Api(app_url, w["user"], w["space"])
    at = iso(START - timedelta(minutes=1))

    def body(ident: str, size: int) -> bytes:
        shell = json.dumps({"_id": ident, "@timestamp": at, "message": ""})
        raw = json.dumps({"_id": ident, "@timestamp": at, "message": "a" * (size - len(shell))}).encode()
        assert len(raw) == size
        return raw

    ok = api.http.post(f"/api/streams/{s}/bulk", content=body("big-ok", UPLOAD_MAX), params={"space": w["space"]},
                       headers={"content-type": "application/x-ndjson"})
    assert ok.status_code == 200 and ok.json()["created"] == 1, ok.text
    api_error(api.http.post(f"/api/streams/{s}/bulk", content=body("big-over", UPLOAD_MAX + 1), params={"space": w["space"]},
                            headers={"content-type": "application/x-ndjson"}), 413, "upload_too_large", "Upload is larger than 200000 bytes.")
    api_error(api.http.post(f"/api/streams/{s}/bulk", content=b"{}", params={"space": w["space"]},
                            headers={"content-type": "text/plain"}), 415, "upload_kind", "Only .ndjson files can be uploaded.")
    over = body("file-over", UPLOAD_MAX + 1)
    api_error(api.upload(s, "over.ndjson", over), 413, "upload_too_large")
    assert f"uploads/{w['space']}/{hashlib.sha256(over).hexdigest()}.ndjson" not in S3().keys(f"uploads/{w['space']}/")
    for ident in ("big-over", "file-over"):
        assert created_ok(api.search(s, START - timedelta(hours=1), START, id=ident), 200)["events"] == []
    with signed_in(browser, app_url, w["user"], f"/streams/{s}", space=w["space"]) as page:
        shows(page, page.get_by_role("table", name="Mapping"))
        path = tmp_path / f"{nm('o')}.ndjson"
        path.write_bytes(over)
        upload_file(page, path)
        shows(page, page.get_by_role("alert").filter(has_text="Upload is larger than 200000 bytes."))
        assert path.name not in page.get_by_role("table", name="Uploads").inner_text()


def test_wf_upload_rate_limit(browser: Browser, app_url: str) -> None:
    s = nm("rl")
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, [])])
    api = Api(app_url, w["user"], w["space"])
    set_clock(app_url, START + timedelta(seconds=30))
    set_rates(app_url, {**GRADING_RATES, "upload": 3})
    try:
        for i in range(3):
            assert created_ok(api.bulk(s, [ev(f"ok{i}", START, message="r")]), 200)["created"] == 1
        limited = api.bulk(s, [ev("refused", START, message="r")])
        api_error(limited, 429, "rate_limited", "Too many requests. Try again in 30 seconds.")
        assert limited.headers.get("retry-after") == "30"
    finally:
        set_rates(app_url, GRADING_RATES)
    assert created_ok(api.search(s, START - timedelta(hours=1), START + timedelta(hours=1), id="refused"), 200)["events"] == []
    with signed_in(browser, app_url, w["user"], f"/streams/{s}", space=w["space"]) as page:
        shows(page, page.get_by_role("region", name="Ingest status"), "3 events stored, 0 in failure store")


def test_wf_upload_file_kinds(browser: Browser, app_url: str, tmp_path: Path) -> None:
    s = nm("fk")
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, [])])
    sp = w["space"]
    api = Api(app_url, w["user"], sp)
    line = json.dumps({"@timestamp": iso(START - timedelta(minutes=1)), "message": "kind"}).encode()
    refused = [("notes.txt", line), ("x.ndjson", b"[1]"), ("y.ndjson", line + b"\x00"), ("z.ndjson", b"\xff\xfe" + line)]
    for name, content in refused:
        api_error(api.upload(s, name, content), 415, "upload_kind", "Only .ndjson files can be uploaded.")
        assert f"uploads/{sp}/{hashlib.sha256(content).hexdigest()}.ndjson" not in S3().keys(f"uploads/{sp}/")
    assert api.get(f"/api/streams/{s}/uploads").json()["uploads"] == []
    content = b"  " + line + b"\n\n" + line + b"\n"
    kept = created_ok(api.upload(s, "../../Evil.NDJSON", content), 202)
    sha = hashlib.sha256(content).hexdigest()
    assert (kept["file"], kept["bytes"], kept["sha256"], kept["status"]) == ("Evil.NDJSON", len(content), sha, "kept")
    assert S3().get(f"uploads/{sp}/{sha}.ndjson") == content

    def done() -> bool:
        u = api.get(f"/api/streams/{s}/uploads").json()["uploads"][0]
        return u["status"] == "done" and u["total_lines"] == 3 and u["done_lines"] == 3 and u["created"] == 2

    poll(done, "upload parsed: 3 lines, 2 created")
    with signed_in(browser, app_url, w["user"], f"/streams/{s}", space=sp) as page:
        shows(page, page.get_by_role("table", name="Uploads"), "Evil.NDJSON")
        path = tmp_path / f"{nm('n')}.txt"
        path.write_bytes(line)
        upload_file(page, path)
        shows(page, page.get_by_role("alert").filter(has_text="Only .ndjson files can be uploaded."))


def test_wf_upload_progress_two_browsers(browser: Browser, app_url: str, tmp_path: Path) -> None:
    s = nm("pg")
    w = world(app_url, members=(("editor", "UTC"), ("viewer", "UTC")), streams=[stream(s, [])])
    sp = w["space"]
    content = b"".join(json.dumps({"_id": f"f{i}", "@timestamp": iso(START - timedelta(seconds=i + 1)), "message": "file"}).encode() + b"\n"
                       for i in range(UPLOAD_LINES))
    path = tmp_path / f"{nm('up')}.ndjson"
    path.write_bytes(content)
    with signed_in(browser, app_url, w["users"][0], f"/streams/{s}", space=sp) as one, \
            signed_in(browser, app_url, w["users"][1], f"/streams/{s}", space=sp) as two:
        shows(two, two.get_by_role("table", name="Uploads"))
        upload_file(one, path)
        for p in (one, two):

            shows(p, p.get_by_role("main"), f"Upload done: {UPLOAD_LINES} created, 0 duplicates, 0 failed")
            shows(p, p.get_by_role("table", name="Uploads").get_by_role("row").filter(has_text=path.name), "done")
            shows(p, p.get_by_role("region", name="Ingest status"), f"{UPLOAD_LINES} events stored, 0 in failure store")
            bar = p.get_by_role("progressbar", name="Upload progress")
            if bar.count() and bar.first.is_visible():
                assert bar.first.get_attribute("aria-valuemax") == str(UPLOAD_LINES)
        announced(one, f"Upload done: {UPLOAD_LINES} created, 0 duplicates, 0 failed")
    assert S3().get(f"uploads/{sp}/{hashlib.sha256(content).hexdigest()}.ndjson") == content


def test_file_upload_storage_outage(app_url: str) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    api = Api(down, "ines", "ops")
    web = "web"
    before = api.get(f"/api/streams/{web}/uploads").json()["uploads"]
    content = json.dumps({"_id": nm("out"), "@timestamp": iso(START - timedelta(minutes=1)), "message": "outage"}).encode()
    api_error(api.upload(web, "outage.ndjson", content), 503, "storage_unavailable", "Storage is unavailable. Nothing was stored.")
    assert api.get(f"/api/streams/{web}/uploads").json()["uploads"] == before
    ident = json.loads(content)["_id"]
    assert created_ok(api.search("web", START - timedelta(hours=1), START, id=ident), 200)["events"] == []


PIPE_EVENTS = [
    ev("p1", START - timedelta(minutes=4), host="host-a", latency=1, level="info", tags=["x", "y"]),
    ev("p2", START - timedelta(minutes=3), host="host-a", latency=2, level="error", tags=["x"]),
    ev("p3", START - timedelta(minutes=2), host="host-a", latency=2, level="info"),
    ev("p4", START - timedelta(minutes=1), host="host-b", latency=10, level="error", tags=["y"]),
]


def pipe_world(app_url: str) -> tuple[dict[str, Any], str, Api]:
    s = nm("pp")
    w = world(app_url, streams=[stream(s, PIPE_EVENTS, {"host": "keyword", "level": "keyword", "tags": "keyword"})])
    return w, s, Api(app_url, w["user"], w["space"])


def test_wf_pipes_commands(browser: Browser, app_url: str) -> None:
    w, s, api = pipe_world(app_url)
    run = lambda text: created_ok(api.post("/api/pipe", {"pipe": text}), 200)
    out = run(f"FROM {s} | STATS count(*) AS n, avg(latency) AS a BY host")
    assert out["columns"] == [{"name": "host", "type": "keyword"}, {"name": "n", "type": "number"}, {"name": "a", "type": "number"}]
    assert [r[0] for r in out["rows"]] == ["host-a", "host-b"] and out["rows"][0][1] == 3
    assert str(out["rows"][0][2]) == half_up(Decimal(5) / Decimal(3), 4)
    tags = run(f"FROM {s} | STATS count(*) AS n BY tags")
    assert [[r[0], r[1]] for r in tags["rows"] if r[0] is not None] == [["x", 2], ["y", 2]]
    assert run(f"FROM {s} | KEEP host, latency | SORT host DESC")["rows"] == [["host-b", 10], ["host-a", 1], ["host-a", 2], ["host-a", 2]]
    limited = run(f"FROM {s} | LIMIT 2")
    assert [c["name"] for c in limited["columns"]] == ["_id", "@timestamp", "host", "latency", "level", "tags"]
    assert [r[0] for r in limited["rows"]] == ["p4", "p3"]
    assert run(f"FROM {s} | WHERE level:error | STATS sum(latency) AS t")["rows"] == [[12]]
    with signed_in(browser, app_url, w["user"], "/pipes", space=w["space"]) as page:
        page.get_by_role("textbox", name="Spoor Pipe").fill(f"FROM {s} | STATS count(*) AS n, avg(latency) AS a BY host")
        page.get_by_role("button", name="Run").click()
        table = page.get_by_role("table", name="Result")
        shows(page, table, half_up(Decimal(5) / Decimal(3), 4))
        assert table.get_by_role("columnheader", name="host").get_attribute("data-type") == "keyword"
        assert table.get_by_role("columnheader", name="n").get_attribute("data-type") == "number"
        page.get_by_role("textbox", name="Spoor Pipe").fill(f"FROM {s} | KEEP _id, @timestamp, tags | SORT _id DESC | LIMIT 2")
        page.get_by_role("button", name="Run").click()
        shows(page, table, shown(START - timedelta(minutes=1)))
        assert table.get_by_role("columnheader", name="@timestamp").get_attribute("data-type") == "date"
        assert "null" in table.get_by_role("row").filter(has_text="p3").inner_text()


def test_wf_pipes_errors(browser: Browser, app_url: str) -> None:
    w, s, api = pipe_world(app_url)
    head = f"FROM {s} | "
    cases = [
        (head + "JOIN x", f"Unknown command JOIN at position {len(head) + 1}."),
        ("WHERE host:x | " + f"FROM {s}", "FROM must come first."),
        ("FROM nosuch", "Stream nosuch doesn't exist."),
        (head + "STATS avg(host) AS a", "avg needs a number field: host is keyword."),
        (head + "LIMIT 10001", "LIMIT can be at most 10000."),
        (head + "KEEP nosuchcol", f"Unknown column nosuchcol at position {len(head) + 6}."),
    ]
    for text, sentence in cases:
        api_error(api.post("/api/pipe", {"pipe": text}), 422, "pipe_syntax", sentence)
    where = head + "WHERE latency:5*"
    bad = api.post("/api/pipe", {"pipe": where})
    assert bad.status_code == 422 and bad.json()["message"] == f"Wildcard not allowed on number field latency at position {len(where)}."
    shell = head + 'WHERE message:""'
    fits = shell[:-1] + "🙂" * (QUERY_MAX_LEN - len(shell)) + '"'
    assert len(fits) == QUERY_MAX_LEN
    r = api.post("/api/pipe", {"pipe": fits})
    assert r.status_code == 200 or r.json()["error"] != "query_too_long"
    long = fits[:-1] + "🙂" + '"'
    api_error(api.post("/api/pipe", {"pipe": long}), 422, "query_too_long", "Query is longer than 2000 characters.")
    with signed_in(browser, app_url, w["user"], "/pipes", space=w["space"]) as page:
        page.get_by_role("textbox", name="Spoor Pipe").fill(cases[0][0])
        page.get_by_role("button", name="Run").click()
        shows(page, page.get_by_role("alert", name="Pipe error"), cases[0][1])


def trace_path(trace: str) -> str:
    return f"/api/traces/{trace}"


def test_wf_traces_objectives_trace_view(browser: Browser, app_url: str) -> None:
    w = world(app_url, members=(("editor", "UTC"),))
    api = Api(app_url, w["user"], w["space"])
    orphan = {"span_id": "o", "parent_id": "ghost", "service": "edge", "name": "lost", "start_ms": 10, "duration_ms": 5}
    created_ok(api.post("/api/traces", {"trace_id": "t1", "spans": WORKED_SPANS + [orphan]}))
    skew = [{"span_id": "s1", "parent_id": None, "service": "api", "name": "root", "start_ms": 10, "duration_ms": 100},
            {"span_id": "s2", "parent_id": "s1", "service": "api", "name": "early", "start_ms": 4, "duration_ms": 20}]
    created_ok(api.post("/api/traces", {"trace_id": "t2", "spans": skew}))
    pct = [{"span_id": f"b{k:02d}", "parent_id": None if k == 20 else "b20", "service": "batch", "name": f"n{k}",
            "start_ms": 0, "duration_ms": k} for k in range(1, 21)]
    created_ok(api.post("/api/traces", {"trace_id": "t3", "spans": pct}))
    t1 = created_ok(api.get(trace_path("t1")), 200)
    root = t1["roots"][0]
    assert root["span_id"] == "c" and root["self_ms"] == 40 and root["on_critical_path"] is True
    assert [c["span_id"] for c in root["children"]] == ["a", "p", "r"]
    assert set(t1["critical_path"]) == {"c", "p", "r"}
    assert {c["span_id"]: c["on_critical_path"] for c in root["children"]} == {"a": False, "p": True, "r": True}
    assert [m["span_id"] for m in t1["missing_parent"]] == ["o"]
    early = created_ok(api.get(trace_path("t2")), 200)["roots"][0]["children"][0]
    assert early["shift_ms"] == 6
    batch = [l for l in created_ok(api.get(trace_path("t3")), 200)["latency"] if l["service"] == "batch"][0]
    assert (batch["spans"], batch["p50"], batch["p95"], batch["p99"]) == (20, 10, 19, 20)
    with signed_in(browser, app_url, w["user"], "/traces/t1", space=w["space"]) as page:
        tree = page.get_by_role("tree", name="Spans")
        top = tree.get_by_role("treeitem", name=re.compile(r"^Span checkout, 240 ms, self time 40 ms, on critical path"))
        shows(page, top)
        shows(page, tree.get_by_role("treeitem", name=re.compile(r"^Missing parent")))
        tab_into(page, tree)
        page.keyboard.press("Home")
        wait_for(page, lambda: focus_in(top), "Home focuses the first span")
        if top.get_attribute("aria-expanded") == "false":
            page.keyboard.press("ArrowRight")
        auth = tree.get_by_role("treeitem", name=span_label("auth", 40, 40), exact=True)
        shows(page, auth)
        page.keyboard.press("ArrowDown")
        wait_for(page, lambda: focus_in(auth), "ArrowDown reaches the first child")
        page.keyboard.press("ArrowLeft")
        wait_for(page, lambda: focus_in(top), "ArrowLeft moves to the parent")
        latency = page.get_by_role("table", name="Latency")
        for name in ("Service", "Spans", "p50 ms", "p95 ms", "p99 ms"):
            assert latency.get_by_role("columnheader", name=name).count() == 1
        page.goto(app_url + "/traces/t2")
        shows(page, page.get_by_role("treeitem", name=re.compile(r"^Span early, 20 ms, self time 20 ms, on critical path, shifted \+6 ms")))


def test_trace_validation(app_url: str) -> None:
    w = world(app_url, members=(("editor", "UTC"),))
    api = Api(app_url, w["user"], w["space"])
    span = lambda i, parent=None: {"span_id": i, "parent_id": parent, "service": "svc", "name": i, "start_ms": 0, "duration_ms": 1}
    api_error(api.post("/api/traces", {"trace_id": nm("t"), "spans": [span("x"), span("x")]}), 422, "trace_invalid", "Span x appears twice.")
    api_error(api.post("/api/traces", {"trace_id": nm("t"), "spans": [span("p2", "p1"), span("p1", "p2")]}), 422, "trace_invalid",
              "Span p1 is part of a parent loop.")
    many = [span(f"m{i}") for i in range(TRACE_MAX_SPANS + 1)]
    api_error(api.post("/api/traces", {"trace_id": nm("t"), "spans": many}), 422, "trace_invalid", "A trace can hold at most 500 spans.")
    tid = nm("t")
    created_ok(api.post("/api/traces", {"trace_id": tid, "spans": [span("ok")]}))
    api_error(api.post("/api/traces", {"trace_id": tid, "spans": [span("ok")]}), 409, "name_taken")


OBJ_SERVICE = "svc"


def burn(bad: int, total: int, budget: Decimal) -> str:
    return half_up(Decimal(bad) / Decimal(total) / budget, 2) if total else "0.00"


def test_wf_traces_objectives_budgets(browser: Browser, app_url: str) -> None:
    s = nm("ob")
    good = [ev(f"g{i}", OBJ_T - timedelta(days=10), service=OBJ_SERVICE, level="info") for i in range(7)]
    events = good + [ev("g7", OBJ_T - timedelta(minutes=30), service=OBJ_SERVICE, level="info"),
                     ev("b1", OBJ_T - timedelta(minutes=1), service=OBJ_SERVICE, level="error"), ev("b2", OBJ_T, service=OBJ_SERVICE, level="error")]
    seeded = {"service": "web", "name": "Web availability", "stream": s, "target": 99.5, "objective_window_ms": OBJECTIVE_WINDOW_MS,
              "bad": {"field": "level", "op": "eq", "value": "error"},
              "counts": {"objective": {"bad": 2000, "total": 1000000}, "long": {"bad": 240, "total": 12000}, "short": {"bad": 30, "total": 1000}}}
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, events, {"service": "keyword", "level": "keyword"})], objectives=[seeded])
    api = Api(app_url, w["user"], w["space"])
    set_clock(app_url, OBJ_T)
    created_ok(api.post("/api/objectives", {"service": OBJ_SERVICE, "name": "Svc availability", "stream": s, "target": 90,
                                            "objective_window_ms": OBJECTIVE_WINDOW_MS, "bad": {"field": "level", "op": "eq", "value": "error"}}))
    api_error(api.post("/api/objectives", {"service": OBJ_SERVICE, "name": "Again", "stream": s, "target": 90,
                                           "objective_window_ms": OBJECTIVE_WINDOW_MS, "bad": {"field": "level", "op": "eq", "value": "error"}}), 409, "name_taken")
    objs = {o["service"]: o for o in api.get("/api/objectives").json()["objectives"]}
    web = objs["web"]
    assert (web["budget_remaining"], web["long"]["burn"], web["short"]["burn"], web["status"]) == ("60.00", "4.00", "6.00", "OK")
    budget = 1 - Decimal(90) / 100
    remaining = half_up((1 - (Decimal(2) / 10) / budget) * 100, 2)
    svc = objs[OBJ_SERVICE]
    assert svc["budget_remaining"] == remaining
    assert (svc["long"]["burn"], svc["short"]["burn"]) == (burn(2, 3, budget), burn(2, 2, budget))
    assert svc["status"] == "Burning"
    with signed_in(browser, app_url, w["user"], "/objectives", space=w["space"], device_time=DEVICE_TIME) as page:
        strip = page.get_by_role("list", name="Services")
        strip.get_by_role("button", name=OBJ_SERVICE, exact=True).click()
        panel = page.get_by_role("region", name="Objective")
        for line in (f"Budget remaining {remaining}%", f"Long burn {burn(2, 3, budget)}", f"Short burn {burn(2, 2, budget)}",
                     f"Status {svc['status']}",
                     f"{sum(1 for e in events if e['level'] == 'error')} bad of {len(events)}"):
            shows(page, panel, line)
        set_clock(app_url, OBJ_T + timedelta(minutes=10))
        shows(page, panel, "Short burn 0.00")
        shows(page, panel, "Status OK")
    later = {o["service"]: o for o in api.get("/api/objectives").json()["objectives"]}[OBJ_SERVICE]
    assert later["short"]["burn"] == "0.00" and later["status"] == "OK"


def rows_containing(pg: Any, needle: str) -> int:
    total = 0
    for table in pg.tables():
        ident = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        total += int(pg.rows(f"SELECT count(*) AS n FROM {ident} t WHERE t::text LIKE '%{needle}%'")[0]["n"])
    return total


def test_wf_spaces_keys_key_once(browser: Browser, app_url: str) -> None:
    w = world(app_url, streams=[stream("web1", [])])
    api = Api(app_url, w["user"], w["space"])
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["user"], "/keys", space=w["space"]) as page:
        shows(page, page.get_by_role("region", name="Empty"), "No API keys yet.")
        page.get_by_role("button", name="New key").first.click()
        dialog = page.get_by_role("dialog", name="New key")
        shows(page, dialog)
        dialog.get_by_role("textbox", name="Key name").fill("edge-shipper")
        dialog.get_by_role("textbox", name="Stream pattern").fill("web*")
        dialog.get_by_role("group", name="Actions").get_by_role("checkbox", name="upload").check()
        dialog.get_by_role("textbox", name="Expires in (days)").fill("30")
        dialog.get_by_role("button", name="Create key").click()
        value_box = page.get_by_role("textbox", name="New key value")
        wait_for(page, lambda: re.fullmatch(r"spk_[0-9a-f]{32}", value_box.input_value() or "") is not None, "the new key value")
        key = value_box.input_value()
        shows(page, page.get_by_text("This key is shown once. Copy it now."))
        page.get_by_role("button", name="Done").click()
        table = page.get_by_role("table", name="Keys")
        shows(page, table, "..." + key[-4:])
        page.reload()
        shows(page, page.get_by_role("table", name="Keys"), "..." + key[-4:])
        assert key not in page.content()
        listed = api.get("/api/keys")
        assert key not in listed.text
        row = [k for k in listed.json()["keys"] if k["name"] == "edge-shipper"][0]
        assert row["last4"] == key[-4:] and row["expires_at"] == iso(START + timedelta(days=30)) and row["actions"] == ["upload"]
        pg = Postgres()
        assert rows_containing(pg, key) == 0, "the plaintext key is stored nowhere"
        assert rows_containing(pg, hashlib.sha256(key.encode()).hexdigest()) >= 1, "the key is stored as its SHA-256 hash"
        page.get_by_role("table", name="Keys").get_by_role("button", name=f"Revoke {KEY_NAME}").click()
        announced(page, f"Key {KEY_NAME} revoked.")
    assert [k for k in api.get("/api/keys").json()["keys"] if k["name"] == "edge-shipper"][0]["revoked"] is True
    made = created_ok(api.post("/api/keys", {"name": "k2", "stream_pattern": "web*", "actions": ["read"], "expires_in_days": None}))
    assert re.fullmatch(r"spk_[0-9a-f]{32}", made["key"])
    gone_key = created_ok(api.delete(f"/api/keys/{made['id']}"), 200)
    assert gone_key["revoked"] is True and "key" not in gone_key
    for days in (0, 366):
        api_error(api.post("/api/keys", {"name": nm("k"), "stream_pattern": "web*", "actions": ["read"], "expires_in_days": days}), 422, "invalid")


def test_spaces_keys_refusals(app_url: str) -> None:
    a = world(app_url, streams=[stream("app1", []), stream("web", [])])
    b = world(app_url, streams=[stream("elsewhere", [])])
    api = Api(app_url, a["user"], a["space"])
    set_clock(app_url, START)
    made = created_ok(api.post("/api/keys", {"name": nm("k"), "stream_pattern": "app*", "actions": ["upload"], "expires_in_days": 30}))
    spare = created_ok(api.post("/api/keys", {"name": nm("k"), "stream_pattern": "app*", "actions": ["upload"], "expires_in_days": None}))

    def send(key: str, name: str) -> httpx.Response:
        return httpx.post(f"{app_url}/api/streams/{name}/bulk", content=json.dumps(ev(nm("e"), START - timedelta(minutes=1), message="keyed")),
                          headers={"Authorization": f"Bearer {key}", "Content-Type": "application/x-ndjson"}, timeout=TIMEOUT)

    assert send(made["key"], "app1").json()["created"] == 1
    api_error(send("spk_" + "0" * 32, "app1"), 401, "key_invalid", "This API key isn't valid.")
    api_error(send(made["key"], "web"), 403, "key_scope", "This key can't upload to stream web.")
    api_error(send(made["key"], "elsewhere"), 404, "not_found")
    foreign = httpx.post(f"{app_url}/api/streams/app1/bulk", params={"space": b["space"]}, content=json.dumps(ev(nm("e"), START - timedelta(minutes=1), message="keyed")),
                         headers={"Authorization": f"Bearer {made['key']}", "Content-Type": "application/x-ndjson"}, timeout=TIMEOUT)
    api_error(foreign, 404, "not_found")
    created_ok(api.delete(f"/api/keys/{spare['id']}"), 200)
    api_error(send(spare["key"], "app1"), 401, "key_revoked", "This API key was revoked.")
    set_clock(app_url, START + timedelta(days=31))
    api_error(send(made["key"], "app1"), 401, "key_expired", "This API key has expired.")
    set_clock(app_url, START)


def test_wf_spaces_keys_isolation(browser: Browser, app_url: str) -> None:
    a = world(app_url, streams=[stream("logs", [ev("i1", START - timedelta(minutes=2), host="alpha-1", message="first"),
                                                ev("i2", START - timedelta(minutes=1), host="alpha-2", message="second")], {"host": "keyword"})],
              rules=[rule_body("logs")], cases=[{"title": "Checkout errors", "status": "open"}])
    b = world(app_url, streams=[stream("logs", [ev("j1", START - timedelta(minutes=1), host="zz-host", **{FOREIGN_FIELD: "hidden"}, message="harborline")],
                                       {"host": "keyword"})], rules=[rule_body("logs")], cases=[{"title": "Checkout errors", "status": "open"}])
    api = Api(app_url, a["user"], a["space"])
    other = b["space"]
    span = {"from": iso(START - timedelta(days=1)), "to": iso(START)}
    api_error(api.get("/api/streams", space=other), 404, "not_found")
    api_error(api.get("/api/search", stream="logs", q="", space=other, **span), 404, "not_found")
    api_error(api.get(f"/api/rules/{b['seed']['rules'][0]['id']}"), 404, "not_found")
    api_error(api.get(f"/api/cases/{a['seed']['cases'][0]['number']}", space=other), 404, "not_found")
    sse = Sse(app_url, api.http.cookies, "/api/events", {"space": other})
    try:
        sse.wait(lambda x: x.status is not None, "GET /api/events answers")
        assert sse.status == 404
    finally:
        sse.close()
    assert [x["name"] for x in api.get("/api/streams").json()["streams"]] == ["logs"]
    assert api.get("/api/suggest", stream="logs", q="zz", cursor=2, **span).json()["items"] == []
    assert api.get("/api/suggest", stream="logs", q="host:zz", cursor=7, **span).json()["items"] == []
    assert created_ok(api.search("logs", START - timedelta(days=1), START, q="harborline"), 200)["total"] == 0
    assert FOREIGN_FIELD not in {f["field"] for f in api.get("/api/fields", stream="logs", **span).json()["fields"]}
    assert created_ok(api.post("/api/pipe", {"pipe": "FROM logs | WHERE message:harborline"}), 200)["rows"] == []
    set_clock(app_url, START)
    with signed_in(browser, app_url, a["user"], "/explore", space=a["space"]) as page:
        shows(page, page.get_by_role("region", name="Ingest status"), "2 events stored, 0 in failure store")
        page.get_by_role("banner").get_by_role("button", name="Space").click()
        menu = page.get_by_role("menu", name="Spaces")
        shows(page, menu)
        assert menu.get_by_role("menuitemradio").count() == 1 and b["name"] not in menu.inner_text()
        page.keyboard.press("Escape")
        open_search(page, "logs", hours=24)
        announced(page, "2 events found")
        page.get_by_role("combobox", name="Query").click()
        page.keyboard.type("zz")
        assert page.get_by_role("option", name=FOREIGN_FIELD).count() == 0


def test_wf_spaces_keys_copy(browser: Browser, app_url: str) -> None:
    user, sa, sb = nm("u"), nm("s"), nm("s")
    span = {"filters": [], "from": iso(START - timedelta(days=1)), "to": iso(START), "q": ""}
    out = seed(app_url, {
        "users": [{"username": user, "password": PASSWORD, "time_zone": "UTC"}],
        "spaces": [{"slug": sa, "name": "Space " + sa, "members": [{"username": user, "role": "editor"}]},
                   {"slug": sb, "name": "Space " + sb, "members": [{"username": user, "role": "editor"}]}],
        "streams": [{"space": sa, **stream("onlya", [])}, {"space": sa, **stream("both", [])}, {"space": sb, **stream("both", [])}],
        "saved_searches": [{"space": sa, "name": "q1", "stream": "onlya", **span}, {"space": sa, "name": "q2", "stream": "both", **span}],
    })
    ids = {x["name"]: x["id"] for x in out["saved_searches"]}
    api = Api(app_url, user, sa)
    clean = created_ok(api.post(f"/api/saved-searches/{ids['q2']}/copy", {"space": sb}))
    assert clean["missing"] == [] and clean["needs_attention"] is False and clean["message"] == "Copied with no missing references."
    outsider = world(app_url)
    api_error(api.post(f"/api/saved-searches/{ids['q1']}/copy", {"space": outsider["space"]}), 404, "not_found")
    with signed_in(browser, app_url, user, "/spaces", space=sa) as page:
        saved = page.get_by_role("list", name="Saved searches")
        item = saved.get_by_role("listitem").filter(has=page.get_by_role("link", name="q1", exact=True))
        shows(page, item)
        item.get_by_role("button", name="Copy to space").click()
        dialog = page.get_by_role("dialog", name="Copy to space")
        shows(page, dialog)
        select(dialog.get_by_role("combobox", name="Target space"), "Space " + sb)
        dialog.get_by_role("button", name="Copy", exact=True).click()
        shows(page, page.get_by_role("status", name="Copied"), "Copied with 1 missing reference: stream onlya.")
        page.get_by_role("banner").get_by_role("button", name="Space").click()
        page.get_by_role("menu", name="Spaces").get_by_role("menuitemradio", name="Space " + sb).click()
        wait_for(page, lambda: urlparse(page.url).path == "/spaces", "switching space keeps /spaces")
        copied = page.get_by_role("list", name="Saved searches").get_by_role("listitem").filter(has=page.get_by_role("link", name="q1", exact=True))
        shows(page, copied, "Needs attention")
        page.reload()
        wait_for(page, lambda: urlparse(page.url).path == "/spaces", "reload stays on /spaces")
        shows(page, copied, "Needs attention")
        copied.get_by_role("link", name="q1", exact=True).click()
        shows(page, page.get_by_role("alert", name="Saved search error"), missing_stream("onlya"))
    in_b = Api(app_url, user, sb)
    flagged = [x for x in items_of(in_b.get("/api/saved-searches").json()) if x["name"] == "q1"][0]
    assert flagged["needs_attention"] is True
    assert in_b.get(f"/api/saved-searches/{flagged['id']}").json()["problem"] == missing_stream("onlya")


def test_if_run_manifest() -> None:
    data = json.loads((APP_ROOT / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"} and data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[k], str) and data[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    text = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    assert "JetBrains Mono" in text and "Inter" in text


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCE_ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    text = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    assert "OFL-1.1" in text


def test_if_no_search_engine_or_datastore() -> None:
    found = sorted({p.name for p in shipped_packages()} & SEARCH_DENYLIST)
    assert not found, f"forbidden packages shipped: {found}"


def test_if_same_origin_no_service_worker(browser: Browser, app_url: str) -> None:
    w = world(app_url)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        urls: list[str] = []
        page.on("request", lambda req: urls.append(req.url))
        for path in ("/explore", "/alerts", "/rules", "/signin"):
            page.goto(app_url + path)
            shows(page, page.get_by_role("main"))
        assert all(same_origin(u, app_url) for u in urls if not u.startswith(("data:", "blob:"))), [u for u in urls if not same_origin(u, app_url)]
        assert page.evaluate("async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0") == 0


def test_if_service_config_unchanged(app_url: str) -> None:
    cfg = httpx.get(app_url + "/api/config", timeout=TIMEOUT).json()
    assert cfg["grading"] is True
    assert cfg["settings"] == {"page_size": PAGE_SIZE, "tail_buffer": TAIL_BUFFER, "query_max_len": QUERY_MAX_LEN,
                               "query_max_depth": QUERY_MAX_DEPTH, "upload_max_bytes": UPLOAD_MAX, "sse_heartbeat_ms": 2000}


def test_if_lockfile_and_typescript() -> None:
    assert (APP_ROOT / "package-lock.json").is_file()
    skip = {"node_modules", "dist", "build", "scripts", ".git", "public", "coverage"}
    offenders = []
    for path in APP_ROOT.rglob("*"):
        rel = path.relative_to(APP_ROOT)
        if any(part in skip for part in rel.parts) or not path.is_file():
            continue
        if path.suffix in {".js", ".jsx", ".mjs", ".cjs"} and not (len(rel.parts) == 1 and ".config." in path.name):
            offenders.append(str(rel))
    assert not offenders, f"JavaScript source files: {offenders[:20]}"


def load_failed_then_retry(page: Page, url: str, pattern: str) -> Locator:
    page.route(pattern, lambda route: route.abort())
    page.goto(url)
    failed = page.get_by_role("alert", name="Load failed")
    shows(page, failed, "Spoorline can't reach the server. Retry when your connection is back.")
    page.unroute(pattern)
    failed.get_by_role("button", name="Retry").click()
    gone(page, failed, "Retry clears the load failure")
    return failed


def test_wf_upload_stream_page_retry(browser: Browser, app_url: str) -> None:
    s = nm("rt")
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, [])])
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        load_failed_then_retry(page, f"{app_url}/streams/{s}", f"**/api/streams/{s}**")
        shows(page, page.get_by_role("button", name="Upload file"))
        shows(page, page.get_by_role("table", name="Mapping"))


def test_wf_traces_objectives_trace_retry(browser: Browser, app_url: str) -> None:
    w = world(app_url, members=(("editor", "UTC"),))
    api = Api(app_url, w["user"], w["space"])
    created_ok(api.post("/api/traces", {"trace_id": "t1", "spans": WORKED_SPANS}))
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        load_failed_then_retry(page, f"{app_url}/traces/t1", "**/api/traces/t1**")
        shows(page, page.get_by_role("tree", name="Spans"))


def test_wf_histogram_time_bucket_targets(browser: Browser, app_url: str) -> None:
    w, s = brush_world(app_url)
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        buckets = brush_setup(page, s)
        for width, height in ((1280, 800), (375, 812)):
            page.set_viewport_size({"width": width, "height": height})
            wait_for(page, lambda: buckets.count() == 60, "the buckets stay at this width")
            for k in (0, 30, 59):
                box = buckets.nth(k).bounding_box()
                assert box is not None and box["width"] >= 44 and box["height"] >= 44, f"bucket {k} at {width} px: {box}"
            assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"), "no sideways page scroll"


def test_wf_pipes_multi_value_cells(browser: Browser, app_url: str) -> None:
    w, s, _ = pipe_world(app_url)
    with signed_in(browser, app_url, w["user"], "/pipes", space=w["space"]) as page:
        page.get_by_role("textbox", name="Spoor Pipe").fill(f"FROM {s} | KEEP _id, tags | SORT _id ASC | LIMIT 3")
        page.get_by_role("button", name="Run").click()
        table = page.get_by_role("table", name="Result")
        wait_for(page, lambda: table.get_by_role("row").count() == 4, "three result rows and a header")
        cells = [[c.strip() for c in row.get_by_role("cell").all_inner_texts()] for row in table.get_by_role("row").all()[1:]]
        assert cells == [["p1", "x, y"], ["p2", "x"], ["p3", "null"]], cells


def test_wf_upload_failure_store_page(browser: Browser, app_url: str) -> None:
    s = nm("fs")
    w = world(app_url, members=(("editor", "UTC"), ("viewer", "UTC")), streams=[stream(s, [])])
    api = Api(app_url, w["users"][0], w["space"])
    set_clock(app_url, START)
    with signed_in(browser, app_url, w["users"][0], f"/streams/{s}", space=w["space"]) as page, \
            signed_in(browser, app_url, w["users"][1], f"/streams/{s}", space=w["space"]) as other:
        store = page.get_by_role("region", name="Failure store")
        shows(page, store)
        out = created_ok(api.bulk(s, [ev("ok1", START - timedelta(minutes=1), message="fine"), "not json", {"_id": "no-time", "message": "x"}]), 200)
        assert (out["created"], out["failed"]) == (1, 2)
        shows(page, store, "Line 2: not valid JSON.")
        shows(page, store, "Line 3: @timestamp is missing.")
        wait_for(page, lambda: store.get_by_role("article").count() == 2, "one article per failure")
        shows(other, other.get_by_role("region", name="Ingest status"), "1 events stored, 2 in failure store")
        announced(page, "Upload done: 1 created, 0 duplicates, 2 failed")


def test_wf_upload_conflict_after_rollover_page(browser: Browser, app_url: str) -> None:
    s = nm("cf")
    gens = [{"number": 1, "phase": "warm", "created_at": iso(START - timedelta(hours=3)), "rolled_over_at": iso(START - timedelta(hours=2)),
             "events": [ev("c1", START - timedelta(hours=2, minutes=30), status=500, message="old")]},
            {"number": 2, "phase": "hot", "created_at": iso(START - timedelta(hours=2)), "events": []}]
    w = world(app_url, streams=[stream(s, generations=gens)])
    api = Api(app_url, w["user"], w["space"])
    set_clock(app_url, START)
    created_ok(api.bulk(s, [ev("c2", START - timedelta(minutes=5), status="abc", message="new")]), 200)
    sentence = "Field status is number in generation 1 and text in generation 2. It can't be sorted or counted."
    with signed_in(browser, app_url, w["user"], "/explore", space=w["space"]) as page:
        open_search(page, s, hours=24)
        announced(page, "2 events found")
        fields = page.get_by_role("list", name="Fields")
        field = fields.get_by_role("button", name=field_button("status", "conflict"))
        shows(page, field)
        shows(page, fields, sentence)
    api_error(api.search(s, START - timedelta(days=1), START, sort="status:asc"), 422, "field_conflict", sentence)


def test_wf_pipes_sort_order_on_page(browser: Browser, app_url: str) -> None:
    w, s, _ = pipe_world(app_url)
    with signed_in(browser, app_url, w["user"], "/pipes", space=w["space"]) as page:
        page.get_by_role("textbox", name="Spoor Pipe").fill(f"FROM {s} | KEEP host, latency | SORT host DESC")
        page.get_by_role("button", name="Run").click()
        table = page.get_by_role("table", name="Result")
        wait_for(page, lambda: table.get_by_role("row").count() == 5, "four result rows and a header")
        headers = [c.strip().split()[0] for c in table.get_by_role("columnheader").all_inner_texts()]
        assert headers == ["host", "latency"]
        cells = [[c.strip() for c in row.get_by_role("cell").all_inner_texts()] for row in table.get_by_role("row").all()[1:]]
        assert cells == [["host-b", "10"], ["host-a", "1"], ["host-a", "2"], ["host-a", "2"]]


def test_wf_pipes_conflict_and_wildcard_on_page(browser: Browser, app_url: str) -> None:
    s = nm("pc")
    gens = [{"number": 1, "phase": "warm", "created_at": iso(START - timedelta(hours=3)), "rolled_over_at": iso(START - timedelta(hours=2)),
             "events": [ev("c1", START - timedelta(hours=2, minutes=30), status=500, latency=5, message="old")]},
            {"number": 2, "phase": "hot", "created_at": iso(START - timedelta(hours=2)),
             "events": [ev("c2", START - timedelta(minutes=30), status="abc", latency=7, message="new")]}]
    w = world(app_url, streams=[stream(s, generations=gens)])
    with signed_in(browser, app_url, w["user"], "/pipes", space=w["space"]) as page:
        box, run = page.get_by_role("textbox", name="Spoor Pipe"), page.get_by_role("button", name="Run")
        alert = page.get_by_role("alert", name="Pipe error")
        box.fill(f"FROM {s} | STATS count(*) AS n BY status")
        run.click()
        shows(page, alert, "Field status is number in generation 1 and text in generation 2. It can't be sorted or counted.")
        where = f"FROM {s} | WHERE latency:5*"
        box.fill(where)
        run.click()
        shows(page, alert, f"Wildcard not allowed on number field latency at position {len(where)}.")
        box.fill(f"FROM {s} | KEEP _id")
        run.click()
        gone(page, alert, "a good run clears the error")
        shows(page, page.get_by_role("table", name="Result"), "c2")


def test_wf_traces_objectives_tree_keys(browser: Browser, app_url: str) -> None:
    w = world(app_url, members=(("editor", "UTC"),))
    api = Api(app_url, w["user"], w["space"])
    created_ok(api.post("/api/traces", {"trace_id": "t1", "spans": WORKED_SPANS}))
    with signed_in(browser, app_url, w["user"], "/traces/t1", space=w["space"]) as page:
        tree = page.get_by_role("tree", name="Spans")
        top = tree.get_by_role("treeitem", name=re.compile(r"^Span checkout, 240 ms, self time 40 ms, on critical path"))
        shows(page, top)
        tab_into(page, tree)
        page.keyboard.press("Home")
        wait_for(page, lambda: focus_in(top), "Home focuses the first span")
        if top.get_attribute("aria-expanded") == "false":
            page.keyboard.press("ArrowRight")
        child = tree.get_by_role("treeitem", name=span_label("auth", 40, 40), exact=True)
        shows(page, child)
        page.keyboard.press("ArrowLeft")
        wait_for(page, lambda: top.get_attribute("aria-expanded") == "false", "ArrowLeft closes the open span")
        gone(page, child, "children hide when the span closes")
        page.keyboard.press("ArrowRight")
        wait_for(page, lambda: top.get_attribute("aria-expanded") == "true", "ArrowRight opens it")
        page.keyboard.press("End")
        last = tree.get_by_role("treeitem", name=re.compile(r"^Span render, 70 ms"))
        wait_for(page, lambda: focus_in(last), "End reaches the last visible span")


def test_wf_traces_objectives_live_status(browser: Browser, app_url: str) -> None:
    s = nm("ol")
    good = [ev(f"g{i}", OBJ_T - timedelta(seconds=30 + i), service=OBJ_SERVICE, level="info") for i in range(9)]
    w = world(app_url, members=(("editor", "UTC"),), streams=[stream(s, good, {"service": "keyword", "level": "keyword"})])
    api = Api(app_url, w["user"], w["space"])
    set_clock(app_url, OBJ_T)
    created_ok(api.post("/api/objectives", {"service": OBJ_SERVICE, "name": "Svc availability", "stream": s, "target": 90,
                                            "objective_window_ms": OBJECTIVE_WINDOW_MS, "bad": {"field": "level", "op": "eq", "value": "error"}}))
    with signed_in(browser, app_url, w["user"], "/objectives", space=w["space"]) as page:
        page.get_by_role("list", name="Services").get_by_role("button", name=OBJ_SERVICE, exact=True).click()
        panel = page.get_by_role("region", name="Objective")
        shows(page, panel, "Status OK")
        shows(page, panel, "Short burn 0.00")
        bad = [ev(f"b{i}", OBJ_T - timedelta(seconds=10 + i), service=OBJ_SERVICE, level="error") for i in range(14)]
        created_ok(api.bulk(s, bad), 200)
        budget = 1 - Decimal(90) / 100
        shows(page, panel, f"Short burn {burn(14, 23, budget)}")
        shows(page, panel, f"Long burn {burn(14, 23, budget)}")
        shows(page, panel, "Status Burning")


def test_wf_pipes_partial_results(browser: Browser, app_url: str) -> None:
    s = nm("pr")
    events = [ev(f"a{i}", ROLLOVER_AT - timedelta(hours=1, minutes=i), message="arch") for i in range(3)]
    w = world(app_url, streams=[aging_stream(s, events)])
    sp = w["space"]
    api = Api(app_url, w["user"], sp)
    try:
        for minutes in (0, 1, 2):
            set_clock(app_url, ROLLOVER_AT + timedelta(minutes=minutes))
            step = lifecycle_step(app_url, sp, s)
        assert step[1]["phase"] == "archive"
        created_ok(api.bulk(s, [ev("n1", ROLLOVER_AT + timedelta(seconds=30), message="arch")]), 200)
        with signed_in(browser, app_url, w["user"], "/pipes", space=sp) as page:
            box, run = page.get_by_role("textbox", name="Spoor Pipe"), page.get_by_role("button", name="Run")
            table = page.get_by_role("table", name="Result")
            banner = page.get_by_role("status", name="Partial results")
            box.fill(f"FROM {s} | STATS count(*) AS n")
            run.click()
            shows(page, table, "4")
            assert banner.count() == 0
            storage(app_url, True)
            run.click()
            shows(page, banner, "Partial results: 1 archived generation skipped because storage is unavailable.")
            shows(page, table, "1")
            storage(app_url, False)
            run.click()
            shows(page, table, "4")
            gone(page, banner, "the banner clears when storage returns")
    finally:
        storage(app_url, False)
