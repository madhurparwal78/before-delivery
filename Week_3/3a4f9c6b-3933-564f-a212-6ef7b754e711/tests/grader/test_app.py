from __future__ import annotations

import hashlib
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
import zlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    animations,
    capture,
    center,
    check,
    click,
    fill,
    held,
    idempotency_key,
    open_app,
    same_origin,
    select,
    settle,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    text,
    unique,
)


PASSWORD = "keelson-demo-2026"
PROJECT = "payments-core"
PROJECT_NAME = "Payments Core"
OTHER_PROJECT = "claims-hub"
PEOPLE = {
    "ines": ("ines.okafor@keelson.test", "Ines Okafor"),
    "tomas": ("tomas.reyes@keelson.test", "Tomás Reyes"),
    "mei": ("mei.lindqvist@keelson.test", "Mei Lindqvist"),
    "hana": ("hana.sato@keelson.test", "Hana Sato"),
    "olu": ("olu.adeyemi@keelson.test", "Olu Adeyemi"),
    "kofi": ("kofi.brandt@keelson.test", "Kofi Brandt"),
    "ravi": ("ravi.castell@keelson.test", "Ravi Castell"),
    "june": ("june.park@keelson.test", "June Park"),
}
MEMBERSHIPS = {
    "ines": {"payments-core": "platform_engineer"},
    "tomas": {"payments-core": "service_developer"},
    "mei": {"payments-core": "service_developer"},
    "hana": {"payments-core": "release_manager"},
    "olu": {"payments-core": "release_manager"},
    "kofi": {"payments-core": "oncall_sre"},
    "ravi": {"claims-hub": "service_developer"},
    "june": {"claims-hub": "release_manager"},
}
RELEASE_MANAGERS = ("hana", "olu")
CLUSTER_TOKEN = {
    "lon1-nonprod": "agt-pc-lon1-nonprod-5e1f",
    "lon1-prod": "agt-pc-lon1-prod-8a2c",
    "use1-prod": "agt-pc-use1-prod-3d7b",
    "sin1-prod": "agt-pc-sin1-prod-9c4e",
}
STAGES = {
    "dev": ("lon1-nonprod", "Europe/London", None),
    "staging": ("lon1-nonprod", "Europe/London", "dev"),
    "prod-eu": ("lon1-prod", "Europe/London", "staging"),
    "prod-us": ("use1-prod", "America/New_York", "staging"),
    "prod-apac": ("sin1-prod", "Asia/Singapore", "staging"),
}
PIPELINE = ("dev", "staging", "prod-eu", "prod-us", "prod-apac")
REPLICA_REF = "Deployment/payments/payments-api"
SEED_DEFAULTS = {
    "dev": {"parameters": {"LOG_LEVEL": "debug"}, "replicas": {REPLICA_REF: 1}},
    "staging": {"parameters": {"LOG_LEVEL": "info"}, "replicas": {REPLICA_REF: 2}},
    "prod-eu": {"parameters": {"LOG_LEVEL": "warn"}, "replicas": {REPLICA_REF: 4}},
    "prod-us": {"parameters": {"LOG_LEVEL": "warn"}, "replicas": {REPLICA_REF: 4}},
}
REFS = (
    "ConfigMap/payments/payments-api-config",
    "Secret/payments/payments-db",
    "SealedSecret/payments/payments-psp-key",
    REPLICA_REF,
    "Service/payments/payments-api",
)
SECRET_REFS = (REFS[1], REFS[2])
SEED_SECRETS = ("pc-db-pass-1.5-ZETA", "AgB7sealedPSPkey15", "pc-db-pass-1.4-THETA", "AgB4sealedPSPkey14")
EU_WINDOW = "EU change window"
APAC_WINDOW = "APAC business hours"
YEAR_END = ("2026-12-23T00:00:00Z", "2027-01-04T00:00:00Z")
STATUS_WORD = {
    "healthy": "Healthy",
    "progressing": "Progressing",
    "degraded": "Degraded",
    "out_of_sync": "Out-of-sync",
    "not_deployed": "Not deployed",
}
SEGMENTS = ("Queued", "Window check", "Applying", "Health wait", "Healthy")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAY_BOXES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
REDACTED = "[redacted]"
FROM_ADDRESS = "keelson@tideline.test"
SNAPSHOT_KEYS = {
    "snapshot", "promotion_id", "project", "stage", "cluster", "time_zone", "kind", "bundle", "overrides",
    "requested_by", "requested_at", "policy_version", "state", "diff", "approvals", "window_decisions",
    "freeze_breaks", "health_timeline", "history", "restores",
}
ERROR_KEYS = {"error", "message", "fields", "holder", "state", "current_version"}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
FONTS = ("Space Grotesk", "IBM Plex Sans", "IBM Plex Mono")
ENV_NAMES = ("DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID",
             "S3_SECRET_ACCESS_KEY", "SMTP_HOST", "SMTP_PORT")

APPROVAL_TTL_DEFAULT = 14_400
SWEEP_S = 5
DRAIN_S = 30
REFRESH_MS = 2000
REFRESH_LIMIT_MS = 3000
MEDIUM_MAX_MS = 500
LONG_MAX_MS = 1000
TOUCH_PX = 44
BODY_LIMIT = 64_000
INGEST_LIMIT = 1_000_000
KEY_MAX = 200
COMMENT_MAX = 500
REPLICA_MAX = 100
COUNT_MAX = 20
LIST_LIMIT_MAX = 100
OPENINGS_SHOWN = 5

DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
VIEWPORT_IDS = ["375x812", "768x1024", "1280x800"]
VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}

MSG_MANIFESTS = "Each manifest needs apiVersion, kind and metadata.name."
MSG_VERSION = "Use 1 to 64 letters, digits, dots, plus or minus signs."
MSG_COMMIT = "Use the full 40-character commit."
MSG_PARAMS = "Use upper-case keys and text values up to 1,000 characters."
MSG_REPLICAS = "Use whole numbers from 0 to 100."
MSG_REPLICA_KIND = "Only Deployments and StatefulSets in this bundle can take replica counts."
MSG_UNKNOWN_BUNDLE = "Unknown bundle version."
MSG_REASON = "Give a reason of 10 to 500 characters."
MSG_COMMENT = "Keep the comment to 500 characters."
MSG_DAYS = "Pick at least one day."
MSG_TIME = "Use 24-hour time like 09:00."
MSG_END = "Closes must be after opens."
MSG_LABEL = "Use 1 to 80 characters."
MSG_FROM = "Use an ISO 8601 instant with an offset."
MSG_COUNT = "Use a whole number from 1 to 20."
MSG_PAST = "Effective time cannot be in the past."
MSG_ENDS = "Ends must be after starts."

COPY_SIGNING_IN = "Signing in…"
COPY_BAD_LOGIN = "Email or password is wrong."
COPY_REQUESTING = "Requesting promotion…"
COPY_NETWORK = "Keelson could not reach the server. Your last action was not confirmed."
COPY_SESSION_ENDED = "Your session ended. Sign in again."
COPY_NOT_CHECKED = "Not checked yet. The window is checked when the promotion starts."
COPY_NOTIFIED = "The requester will be notified."
COPY_STORAGE_DOWN = "Evidence storage is unreachable. Snapshots are queued and will be stored when it returns."
COPY_MAIL_DOWN = "Mail is unreachable. Notices are queued and will be sent when it returns."
COPY_EVIDENCE_DOWNLOADED = "Evidence downloaded."
COPY_WINDOW_REMOVED = "Window removed."
COPY_CLOSED_OUTSIDE = "Closed: outside every sync window"

EU_OPEN_BEFORE = "2026-10-20T08:00:00.000Z"
EU_OPEN_AFTER = "2026-10-27T09:00:00.000Z"
EU_LOCAL_OPENS = ("2026-10-20 09:00", "2026-10-27 09:00")
GAP_OPENS_AT = "2027-03-28T01:30:00.000Z"
GAP_LOCAL_OPENS = "2027-03-28 02:30"
OVERLAP_OPENS_AT = "2026-10-25T00:30:00.000Z"
OVERLAP_LOCAL_OPENS = "2026-10-25 01:30"


HTTP_TIMEOUT = 30
UI_TIMEOUT = 20_000
EXPECT_MS = 2500
STEP_MS = 1000
BOOT_DEADLINE = 240
API_DEADLINE = 60
POLL_INTERVAL = 0.25
SWEEP_SLACK = 3
SHORT_TTL = 45
FREEZE_LEAD_S = 12
STALE_LEAD_S = 25
UI_FREEZE_LEAD_S = 180
UTC_INPUT_FORMS = ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M UTC", "%Y-%m-%dT%H:%M:%SZ")
FREEZE_SPAN = 3600
REVIEW_COMMENT = "Evidence reviewed."
UI_REVIEW_COMMENT = "Diff and health reviewed."
EXTRA_PARAM = "TRACE_MODE"
ROLLBACK_PARAM = "REGION_MODE"
GHOST_STAGE = "prod-mars"
NIGHT_END = "03:00"
BAD_CLOSES = "07:00"
QUEUE_EMPTY = 0
PLAN_DAYS_AHEAD = 2
TAB_PRESSES = 40
RACERS = 3
FOREIGN_ORIGIN = "http://foreign.invalid"
JUNK_TOKEN = "agt-not-a-real-token"
GHOST_REF = "Deployment/payments/ghost-api"
UNKNOWN_REF = "ConfigMap/payments/ghost-config"
CLEAR_REASON = "Cleared by the verifier before a test."
INCIDENT_REASON = "Incident INC-4471 payments outage"
SHORT_REASON = "too short"
SOURCE_PROBES = ("/run.json", "/package.json", "/.env", "/src/server.ts", "/server.js.map", "/tsconfig.json")
DATASTORE_PACKAGES = ("sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level", "lokijs")
CLOCK_FROM = {"spring_gap": "2027-03-27T00:00:00.000Z", "autumn_overlap": "2026-10-24T00:00:00.000Z"}
FALL_FROM = "2026-10-19T00:00:00.000Z"
SG_WEDNESDAY = "2026-10-21"
SG_SATURDAY = "2026-10-24"
EU_TUESDAY_BST = "2026-10-20T08:30:00Z"
EU_TUESDAY_GMT = "2026-10-27T08:30:00Z"
SUNDAY = "2026-10-25"
TOKEN_RE = re.compile(r"/approvals/([A-Za-z0-9_\-~%]+)")

CONTRAST_TEXT = 4.5
CONTRAST_GLYPH = 3
EDGE_INSET = 4
GLYPH_MIN_PX = 4
MASK_GRID = 8
STATUS_PROBE = """(el, args) => {
  const [word, hide] = args;
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', {willReadFrequently: true});
  const rgba = (c) => {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  };
  const mix = (top, base) => [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3]));
  const ground = (n) => {
    const chain = []; for (let e = n; e; e = e.parentElement) chain.unshift(e);
    let base = [255, 255, 255];
    for (const e of chain) base = mix(rgba(getComputedStyle(e).backgroundColor), base);
    return base;
  };
  const lum = (c) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (fg, bg) => {
    const c = mix(rgba(fg), bg); const a = lum(c), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const texts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t);
  let textRatio = 0, wordRect = null;
  for (const t of texts) {
    const i = t.textContent.indexOf(word);
    if (i >= 0 && t.parentElement) {
      textRatio = ratio(getComputedStyle(t.parentElement).color, ground(t.parentElement));
      const range = document.createRange(); range.setStart(t, i); range.setEnd(t, i + word.length);
      const b = range.getBoundingClientRect(); wordRect = {top: b.top, bottom: b.bottom};
      break;
    }
  }
  for (const t of texts) {
    if (!hide.some(h => t.textContent.includes(h))) continue;
    const s = document.createElement('span');
    s.setAttribute('data-keelson-hidden', '1');
    s.style.color = 'transparent'; s.style.webkitTextFillColor = 'transparent';
    s.style.textShadow = 'none'; s.style.textDecoration = 'none';
    t.replaceWith(s); s.appendChild(t);
  }
  const box = el.getBoundingClientRect();
  return {textRatio, wordRect, box: {top: box.top, left: box.left, width: box.width, height: box.height}};
}"""
STATUS_RESTORE = "el => el.querySelectorAll('[data-keelson-hidden]').forEach(s => s.replaceWith(...s.childNodes))"
MOTION_RECORDER = """() => {
  if (window.__keelsonMotion) return;
  window.__keelsonMotion = [];
  const log = (target, anim) => {
    const t = anim.effect ? anim.effect.getComputedTiming() : {};
    window.__keelsonMotion.push({target, duration: t.duration, iterations: t.iterations});
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); log(this, a); return a; };
  const fromEvent = (e) => { for (const a of e.target.getAnimations()) log(e.target, a); };
  document.addEventListener('animationstart', fromEvent, true);
  document.addEventListener('transitionrun', fromEvent, true);
}"""
MOTION_IN = """(el, from) => window.__keelsonMotion.slice(from).filter(m => el.contains(m.target))
  .map(m => ({duration: m.duration, iterations: m.iterations}))"""
FRAME_RECORDER = """(root) => {
  if (window.__keelsonFrames) return;
  window.__keelsonFrames = [];
  const seen = new WeakMap();
  const props = ['transform', 'opacity', 'stroke', 'stroke-dashoffset', 'stroke-dasharray', 'fill',
                 'border-top-color', 'outline-color', 'box-shadow', 'background-color'];
  const sign = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 2)).join(',') + '|' + props.map(p => s.getPropertyValue(p)).join('|');
  };
  const frame = () => {
    const base = root.isConnected ? root : document.body, t = performance.now();
    for (const e of [base, ...base.querySelectorAll('*')]) {
      const s = sign(e);
      if (seen.has(e) && seen.get(e) !== s) window.__keelsonFrames.push({target: e, t});
      seen.set(e, s);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}"""
FRAMES_IN = """(el, from) => {
  const spans = new Map();
  for (const f of window.__keelsonFrames.slice(from)) {
    if (!el.contains(f.target)) continue;
    const s = spans.get(f.target) || {first: f.t, last: f.t, frames: 0};
    s.last = f.t; s.frames += 1; spans.set(f.target, s);
  }
  return [...spans.values()].filter(s => s.frames >= 2).map(s => ({duration: s.last - s.first, iterations: 1}));
}"""


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    for _ in range(math.ceil(seconds / POLL_INTERVAL) + 1):
        value = fn()
        if value:
            return value
        threading.Event().wait(POLL_INTERVAL)
    raise AssertionError(f"timed out after {seconds}s waiting for {what}")


def fresh_tag() -> str:
    name, _ = unique("keelson")
    return "t" + hashlib.sha256(f"{name}{idempotency_key()}".encode()).hexdigest()[:12]


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    moment = moment.astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def cluster_time(value: str | datetime, zone: str) -> str:
    moment = instant(value) if isinstance(value, str) else value
    return moment.astimezone(ZoneInfo(zone)).strftime("%Y-%m-%d %H:%M") + f" {zone}"


def local_text(value: str, zone: str) -> str:
    return instant(value).astimezone(ZoneInfo(zone)).strftime("%Y-%m-%d %H:%M")


def local_instant(local: str, zone: str) -> str:
    return iso(datetime.strptime(local, "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo(zone)))


def P(path: str) -> str:
    return f"/api/projects/{PROJECT}{path}"


def stage_path(stage: str, rest: str = "") -> str:
    return P(f"/stages/{stage}{rest}")


def assert_error(response: httpx.Response, status: int, code: str) -> dict:
    assert response.status_code == status, f"{response.status_code} {response.text}"
    body = response.json()
    assert body["error"] == code, body
    assert isinstance(body["message"], str) and body["message"], body
    assert set(body) <= ERROR_KEYS, body
    return body


def assert_expired_refusal(response: httpx.Response) -> None:
    assert_expired_refusal_body(response.status_code, response.json())


def assert_expired_refusal_body(status: int, body: dict) -> None:
    assert status == 409, body
    assert body["error"] in ("approval_expired", "invalid_transition"), body
    if body["error"] == "invalid_transition":
        assert body["state"] == "expired", body


def rail_progress(phase: str, in_sync: int, total: int) -> float:
    if phase == "applying":
        return round(0.2 + 0.4 * in_sync / total, 3)
    if phase == "health_wait":
        return round(0.6 + 0.35 * in_sync / total, 3)
    return {"queued": 0.1, "window_check": 0.2, "healthy": 1.0, "stopped": 0.0, "idle": 0.0}[phase]


def progress_pattern(value: float) -> re.Pattern:
    shown = f"{value:.3f}".rstrip("0").rstrip(".")
    return re.compile(rf"^{re.escape(shown)}0*$" if "." in shown else rf"^{re.escape(shown)}(\.0*)?$")


def secret_values(tag: str) -> tuple[str, ...]:
    return (f"pw-{tag}-secret", f"tk-{tag}-secret", f"ak-{tag}-sealed", f"tp-{tag}-sealed")


def bundle_manifests(tag: str) -> list[dict]:
    pw, tk, ak, tp = secret_values(tag)
    return [
        {"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": "payments-api-config", "namespace": "payments"},
         "data": {"FEATURE_PAYOUTS": tag}},
        {"apiVersion": "v1", "kind": "Secret", "metadata": {"name": "payments-db", "namespace": "payments"},
         "type": "Opaque", "stringData": {"password": pw}, "data": {"token": tk}},
        {"apiVersion": "bitnami.com/v1alpha1", "kind": "SealedSecret",
         "metadata": {"name": "payments-psp-key", "namespace": "payments"},
         "spec": {"encryptedData": {"apiKey": ak}, "template": {"data": {"region": tp}}}},
        {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {"name": "payments-api", "namespace": "payments"},
         "spec": {"replicas": 2, "template": {"spec": {"containers": [
             {"name": "api", "image": f"registry.keelson.test/payments-api:{tag}"}]}}}},
        {"apiVersion": "v1", "kind": "Service", "metadata": {"name": "payments-api", "namespace": "payments"},
         "spec": {"ports": [{"port": 443}]}},
    ]


def commit_for(tag: str) -> str:
    return hashlib.sha1(tag.encode()).hexdigest()


def no_secrets(blob: str, tag: str) -> None:
    for value in secret_values(tag) + SEED_SECRETS:
        assert value not in blob, f"secret value {value!r} leaked"


_BUCKET: list[S3] = []


def bucket() -> S3:
    if not _BUCKET:
        _BUCKET.append(S3())
    return _BUCKET[0]


def evidence_keys(pid: str) -> list[str]:
    return sorted(bucket().keys(f"evidence/{PROJECT}/{pid}/"))


def snapshot_key(pid: str, number: int) -> str:
    return f"evidence/{PROJECT}/{pid}/{number:03d}.json"


def evidence_names(pid: str, number: int) -> tuple[str, str]:
    return f"keelson-evidence-{pid}-{number}.json", f"keelson-evidence-{pid}-{number:03d}.json"


def wait_snapshot(pid: str, number: int) -> dict:
    key = snapshot_key(pid, number)
    poll(lambda: key in bucket().keys(f"evidence/{PROJECT}/{pid}/"), DRAIN_S + SWEEP_S, f"snapshot {key}")
    return json.loads(bucket().get(key))


class Api:
    def __init__(self, base: str, who: str | None = None):
        self.base = base.rstrip("/")
        self.who = who
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        if who:
            r = self.http.post("/api/session", json={"email": PEOPLE[who][0], "password": PASSWORD})
            assert r.status_code == 200, f"sign-in of {who} failed: {r.status_code} {r.text}"

    def get(self, path: str, params: dict | None = None) -> httpx.Response:
        return self.http.get(path, params=params)

    def post(self, path: str, body: Any = None, key: str | None = None, headers: dict | None = None,
             content: bytes | str | None = None) -> httpx.Response:
        h = dict(headers or {})
        if key is not None:
            h["Request-Key"] = key
        if content is not None:
            h.setdefault("Content-Type", "application/json")
            return self.http.post(path, content=content, headers=h)
        return self.http.post(path, json=body, headers=h)

    def keyed(self, path: str, body: Any, key: str | None = None) -> httpx.Response:
        return self.post(path, body, key=key or idempotency_key())

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)

    def promotion(self, pid: str) -> dict:
        r = self.get(f"/api/promotions/{pid}")
        assert r.status_code == 200, r.text
        return r.json()

    def graph(self) -> dict:
        r = self.get(P("/graph"))
        assert r.status_code == 200, r.text
        return r.json()

    def node(self, stage: str) -> dict:
        return next(n for n in self.graph()["nodes"] if n["stage"] == stage)

    def edge(self, stage: str) -> dict:
        return next(e for e in self.graph()["edges"] if e["to"] == stage)

    def health(self, stage: str) -> dict:
        r = self.get(stage_path(stage, "/health"))
        assert r.status_code == 200, r.text
        return r.json()

    def promotions(self, stage: str, limit: int = LIST_LIMIT_MAX) -> list[dict]:
        r = self.get(P("/promotions"), {"stage": stage, "limit": limit})
        assert r.status_code == 200, r.text
        return r.json()["promotions"]

    def bundles(self) -> list[dict]:
        r = self.get(P("/bundles"))
        assert r.status_code == 200, r.text
        return r.json()["bundles"]

    def policy(self) -> dict:
        r = self.get(P("/freeze-policy"))
        assert r.status_code == 200, r.text
        return r.json()

    def status(self) -> dict:
        r = self.get("/api/status")
        assert r.status_code == 200, r.text
        return r.json()

    def clusters(self) -> list[dict]:
        r = self.get(P("/clusters"))
        assert r.status_code == 200, r.text
        return r.json()["clusters"]

    def decision(self, stage: str, at: str | None = None) -> dict:
        r = self.get(stage_path(stage, "/window-decision"), {"at": at} if at else None)
        assert r.status_code == 200, r.text
        return r.json()

    def openings(self, cluster: str, start: str, count: int = COUNT_MAX) -> list[dict]:
        r = self.get(P(f"/clusters/{cluster}/window-openings"), {"from": start, "count": count})
        assert r.status_code == 200, r.text
        return r.json()["openings"]


def server_now(api: Api) -> datetime:
    return instant(api.decision("dev")["evaluated_at"])


def wait_until(api: Api, moment: datetime) -> None:
    budget = max(0.0, (moment - server_now(api)).total_seconds()) + API_DEADLINE
    poll(lambda: server_now(api) >= moment, budget, f"server time to reach {iso(moment)}")


def new_bundle(api: Api, tag: str | None = None, manifests: list[dict] | None = None) -> dict:
    version = tag or fresh_tag()
    body = {"version": version, "source_commit": commit_for(version), "manifests": manifests or bundle_manifests(version)}
    r = api.post(P("/bundles"), body)
    assert r.status_code == 201, r.text
    return r.json()


def request_promotion(api: Api, stage: str, version: str, overrides: dict | None = None,
                      key: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"bundle_version": version}
    if overrides is not None:
        body["overrides"] = overrides
    return api.post(stage_path(stage, "/promotions"), body, key=key or idempotency_key())


def report(base: str, stage: str, pid: str, phase: str, rows: list[tuple[str, str, str]],
           token: str | None = None) -> httpx.Response:
    return httpx.post(
        f"{base.rstrip('/')}/api/agent/reports",
        json={"promotion_id": pid, "phase": phase,
              "resources": [{"ref": ref, "sync": sync, "health": health} for ref, sync, health in rows]},
        headers={"Authorization": f"Bearer {token or CLUSTER_TOKEN[STAGES[stage][0]]}"},
        timeout=HTTP_TIMEOUT,
    )


def finish(base: str, stage: str, pid: str, outcome: str = "healthy") -> None:
    rows = Api(base, "tomas").health(stage)
    assert rows["revision"] == pid, rows
    refs = [row["ref"] for row in rows["resources"]]
    resources = [(ref, "Synced", "Healthy") for ref in refs] if outcome == "healthy" else [(refs[0], "Synced", "Degraded")]
    r = report(base, stage, pid, "health_wait", resources)
    assert r.status_code == 200 and r.json()["state"] == outcome, r.text


def clear_stage(base: str, stage: str) -> None:
    tomas = Api(base, "tomas")
    for _ in range(10):
        active = tomas.node(stage)["active_promotion"]
        if not active:
            return
        pid, state = active["id"], active["state"]
        if state == "awaiting_approval":
            Api(base, "hana").keyed(f"/api/promotions/{pid}/reject", {"reason": CLEAR_REASON})
        elif state == "approved":
            tomas.keyed(f"/api/promotions/{pid}/start", {})
        elif state == "window_blocked":
            Api(base, "kofi").keyed(f"/api/promotions/{pid}/break-freeze", {"reason": CLEAR_REASON})
        elif state in ("applying", "health_wait"):
            finish(base, stage, pid, "degraded")
        else:
            threading.Event().wait(POLL_INTERVAL)
    raise AssertionError(f"stage {stage} still holds an active promotion")


def verified_bundle(base: str, through: str = "staging") -> dict:
    tomas = Api(base, "tomas")
    bundle = new_bundle(tomas)
    for stage in (("dev",) if through == "dev" else ("dev", "staging")):
        clear_stage(base, stage)
        r = request_promotion(tomas, stage, bundle["version"])
        assert r.status_code == 201, r.text
        finish(base, stage, r.json()["id"])
    return bundle


def prod_request(api: Api, stage: str, version: str) -> dict:
    clear_stage(api.base, stage)
    r = request_promotion(api, stage, version)
    assert r.status_code == 201, r.text
    promotion = r.json()
    assert promotion["state"] == "awaiting_approval", promotion
    return promotion


def approve(api: Api, pid: str, body: dict | None = None) -> dict:
    def attempt() -> dict | None:
        r = api.keyed(f"/api/promotions/{pid}/approve", body or {})
        if r.status_code == 409 and r.json()["error"] == "evidence_pending":
            return None
        assert r.status_code == 200, r.text
        return r.json()
    return poll(attempt, DRAIN_S + SWEEP_S, "approval once the first snapshot is stored")


def start(api: Api, pid: str, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/promotions/{pid}/start", {}, key=key or idempotency_key())


def started(base: str, pid: str) -> dict:
    r = start(Api(base, "tomas"), pid)
    assert r.status_code == 200, r.text
    if r.json()["state"] == "window_blocked":
        r = Api(base, "kofi").keyed(f"/api/promotions/{pid}/break-freeze", {"reason": INCIDENT_REASON})
        assert r.status_code == 200, r.text
    assert r.json()["state"] == "applying", r.text
    return r.json()


def finished_prod(base: str, stage: str, bundle: dict, outcome: str) -> dict:
    tomas, hana = Api(base, "tomas"), Api(base, "hana")
    promotion = prod_request(tomas, stage, bundle["version"])
    approve(hana, promotion["id"])
    started(base, promotion["id"])
    finish(base, stage, promotion["id"], outcome)
    return tomas.promotion(promotion["id"])


def schedule_freeze(base: str, name: str | None, stages: tuple[str, ...] = ("prod-apac",),
                    lead: int = FREEZE_LEAD_S) -> tuple[dict, datetime]:
    ines = Api(base, "ines")
    latest = max(ines.policy()["versions"], key=lambda v: v["version"])
    effective = max(server_now(ines) + timedelta(seconds=lead), instant(latest["effective_from"]) + timedelta(seconds=1))
    freezes = [] if name is None else [{"name": name, "stages": list(stages), "starts_at": iso(effective),
                                        "ends_at": iso(effective + timedelta(seconds=FREEZE_SPAN))}]
    body = {"based_on_version": latest["version"], "effective_from": iso(effective), "freezes": freezes}
    r = ines.post(P("/freeze-policy/versions"), body)
    assert r.status_code == 201, r.text
    return r.json(), effective


def wait_in_force(api: Api, number: int, effective: datetime) -> None:
    budget = max(0.0, (effective - server_now(api)).total_seconds()) + API_DEADLINE
    poll(lambda: api.policy()["in_force_version"] >= number, budget, f"freeze policy version {number} in force")


def blocked_prod_apac(base: str) -> tuple[dict, dict]:
    version, effective = schedule_freeze(base, f"Incident freeze {fresh_tag()}")
    bundle = verified_bundle(base)
    tomas, hana = Api(base, "tomas"), Api(base, "hana")
    wait_in_force(tomas, version["version"], effective)
    promotion = prod_request(tomas, "prod-apac", bundle["version"])
    approve(hana, promotion["id"])
    r = start(tomas, promotion["id"])
    assert r.status_code == 200, r.text
    promotion = r.json()
    assert promotion["state"] == "window_blocked", promotion
    assert promotion["window_decision"]["reason"] == "freeze", promotion
    return bundle, promotion


def subject_of(message: dict) -> str:
    return message.get("Subject") or ""


def titled(messages: list[dict], subject: str) -> list[dict]:
    return [m for m in messages if subject_of(m) == subject]


def wait_mail(mail: Any, subject: str, expected: int, seconds: float = DRAIN_S + SWEEP_S) -> list[dict]:
    poll(lambda: len(titled(mail.messages(settle=0), subject)) >= expected, seconds,
         f"{expected} message(s) titled {subject!r}")
    return titled(mail.messages(), subject)


def recipients(messages: list[dict]) -> list[str]:
    return sorted(a.lower() for m in messages for a in addresses(m.get("To")))


def rm_emails() -> list[str]:
    return sorted(PEOPLE[who][0] for who in RELEASE_MANAGERS)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def log_tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-4000:]


@contextmanager
def app_copy(**overrides: str) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ)
    env.update({"APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base})
    env.update(overrides)
    log = tempfile.NamedTemporaryFile(prefix="keelson-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)

    def ready() -> bool:
        if proc.poll() is not None:
            raise AssertionError(f"app copy exited with {proc.returncode}:\n{log_tail(log.name)}")
        try:
            return httpx.get(f"{base}/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(ready, BOOT_DEADLINE, f"app copy health; log:\n{log_tail(log.name)}")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


class Relay:

    def __init__(self, host: str, port: int):
        self.target = (host, port)
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.links: list[socket.socket] = []

    def up(self) -> None:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.listener = s
        threading.Thread(target=self._serve, args=(s,), daemon=True).start()

    def _serve(self, s: socket.socket) -> None:
        while True:
            try:
                client, _ = s.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            self.links += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(a: socket.socket, b: socket.socket) -> None:
        try:
            while True:
                data = a.recv(65536)
                if not data:
                    break
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def down(self) -> None:
        if self.listener is not None:
            try:
                self.listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.listener.close()
            self.listener = None
        for s in self.links:
            try:
                s.close()
            except OSError:
                pass
        self.links = []


@contextmanager
def relay_copy(**overrides: str) -> Iterator[tuple[str, Relay, Relay]]:
    s3 = urlparse(os.environ["S3_ENDPOINT"])
    storage = Relay(s3.hostname or "127.0.0.1", s3.port or (443 if s3.scheme == "https" else 80))
    smtp = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    storage.up()
    smtp.up()
    try:
        with app_copy(S3_ENDPOINT=f"{s3.scheme}://127.0.0.1:{storage.port}", SMTP_HOST="127.0.0.1",
                      SMTP_PORT=str(smtp.port), **overrides) as base:
            yield base, storage, smtp
    finally:
        storage.down()
        smtp.down()


@pytest.fixture(scope="module")
def expiry_app() -> Iterator[str]:
    with app_copy(KEELSON_APPROVAL_TTL_SECONDS=str(SHORT_TTL)) as base:
        yield base


def sign_in_form(page: Page, who: str) -> None:
    fill(page.get_by_role("textbox", name="Email", exact=True), PEOPLE[who][0])
    fill(page.get_by_label("Password", exact=True), PASSWORD)
    click(page.get_by_role("button", name="Sign in", exact=True))


@contextmanager
def workspace(browser: Any, base: str, who: str, size: tuple[int, int] = DESKTOP,
              reduced_motion: str = "no-preference", route: str | None = None) -> Iterator[Page]:
    with open_app(browser, f"{base}{route or f'/projects/{PROJECT}'}", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        sign_in_form(page, who)
        landmark = (page.get_by_role("heading", name="Windows and freezes", exact=True) if route
                    else page.get_by_role("region", name="Stage graph", exact=True))
        expect(landmark).to_be_visible(timeout=UI_TIMEOUT)
        yield page


def eventually(page: Page, check_fn: Callable[[], Any], limit_ms: int = REFRESH_LIMIT_MS,
               step_ms: int = STEP_MS) -> Any:
    for _ in range(limit_ms // step_ms):
        try:
            return check_fn()
        except AssertionError:
            advance(page, step_ms)
    return check_fn()


def node(page: Page, stage: str, behind_modal: bool = False):
    return page.get_by_role("button", name=f"Stage {stage}", exact=True, include_hidden=behind_modal)


def on_screen(locator: Any) -> list:
    return [locator.nth(i) for i in range(locator.count()) if locator.nth(i).is_visible()]


def edge(page: Page, stage: str):
    return page.get_by_role("img", name=f"Promotion rail {STAGES[stage][2] or 'Bundles'} to {stage}", exact=True)


def evidence(page: Page, stage: str):
    return page.get_by_role("complementary", name=f"Evidence for {stage}", exact=True)


def activity(page: Page):
    return page.get_by_role("status", name="Activity", exact=True)


def problem(page: Page):
    return page.get_by_role("alert", name="Problem", exact=True)


def progress_region(page: Page):
    return page.get_by_role("status", name="Promotion progress", exact=True)


def delivery_queue(page: Page):
    return page.get_by_role("status", name="Delivery queue", exact=True)


def open_stage(page: Page, stage: str, use_tap: bool = False) -> None:
    (tap if use_tap else click)(node(page, stage))
    expect(evidence(page, stage)).to_be_visible(timeout=EXPECT_MS)


def expect_rail(page: Page, stage: str, phase: str, value: float) -> None:
    rail = edge(page, stage)
    expect(rail).to_have_attribute("data-phase", phase, timeout=EXPECT_MS)
    expect(rail).to_have_attribute("data-progress", progress_pattern(value), timeout=EXPECT_MS)


def png_rgb(data: bytes) -> tuple[int, int, list[list[tuple[int, int, int]]]]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "capture did not return a PNG"
    pos, idat = 8, b""
    width = height = depth = ctype = interlace = 0
    while pos < len(data):
        length = int.from_bytes(data[pos:pos + 4], "big")
        kind, chunk = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height = int.from_bytes(chunk[0:4], "big"), int.from_bytes(chunk[4:8], "big")
            depth, ctype, interlace = chunk[8], chunk[9], chunk[12]
        elif kind == b"IDAT":
            idat += chunk
    assert depth == 8 and ctype in (2, 6) and interlace == 0, (depth, ctype, interlace)
    bpp = 3 if ctype == 2 else 4
    raw, stride = zlib.decompress(idat), width * bpp
    prev, i, rows = bytearray(stride), 0, []
    for _ in range(height):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append([tuple(line[x * bpp:x * bpp + 3]) for x in range(width)])
        prev = line
    return width, height, rows


def contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    def lum(c: tuple[int, int, int]) -> float:
        f = [v / 255 for v in c]
        f = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in f]
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def assert_status_mark(locator: Any, word: str, hide: tuple[str, ...] = ()) -> frozenset:
    locator.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
    probe = locator.evaluate(STATUS_PROBE, [word, [word, *hide]])
    try:
        width, height, px = png_rgb(capture(locator))
    finally:
        locator.evaluate(STATUS_RESTORE)
    assert probe["textRatio"] >= CONTRAST_TEXT, (word, probe["textRatio"])
    assert probe["wordRect"], f"status word {word!r} not found"
    box, wr = probe["box"], probe["wordRect"]
    sx, sy = width / max(box["width"], 1), height / max(box["height"], 1)
    span = wr["bottom"] - wr["top"]
    inset_x, inset_y = int(EDGE_INSET * sx), int(EDGE_INSET * sy)
    top = max(inset_y, int((wr["top"] - span - box["top"]) * sy))
    bottom = min(height - inset_y, math.ceil((wr["bottom"] + span - box["top"]) * sy))
    left, right = inset_x, max(inset_x, width - inset_x)
    band = [(x, y, px[y][x]) for y in range(top, bottom) for x in range(left, right)]
    assert band, f"no area around status word {word!r}"
    ground = Counter(c for _, _, c in band).most_common(1)[0][0]
    painted = [(x, y) for x, y, c in band if contrast(c, ground) >= CONTRAST_GLYPH]
    assert len(painted) >= GLYPH_MIN_PX, f"no glyph at 3:1 beside status word {word!r}"
    x0, x1 = min(p[0] for p in painted), max(p[0] for p in painted) + 1
    y0, y1 = min(p[1] for p in painted), max(p[1] for p in painted) + 1
    return frozenset(((x - x0) * MASK_GRID // (x1 - x0), (y - y0) * MASK_GRID // (y1 - y0)) for x, y in painted)


def fits_viewport(page: Page) -> None:
    width = page.viewport_size["width"]
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible():
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            box = control.bounding_box()
            if box and (box["x"] + box["width"] <= 0 or box["x"] >= width):
                continue
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1, box


def motion_since(root: Any, marks: tuple[int, int]) -> list[dict]:
    return root.evaluate(MOTION_IN, marks[0]) or root.evaluate(FRAMES_IN, marks[1])


def motion_marks(page: Page) -> tuple[int, int]:
    return page.evaluate("() => [window.__keelsonMotion.length, window.__keelsonFrames.length]")


def pick_bundle(page: Page, dialog: Any, label: str) -> None:
    combo = dialog.get_by_role("combobox", name="Release bundle", exact=True)
    expect(combo).to_be_visible(timeout=EXPECT_MS)
    ready = "(e, v) => e.tagName !== 'SELECT' || [...e.options].some(o => (o.label || o.text || '').trim() === v)"
    eventually(page, lambda: poll(lambda: combo.evaluate(ready, label), EXPECT_MS / 1000, f"bundle option {label}"))
    select(combo, label)


def rest_distance(page: Page, graph: Any, capsule: Any, target: Any) -> float:
    advance(page, LONG_MAX_MS)
    settle(graph)
    return math.dist(center(capsule), center(target))


def test_wf_cross_cutting_health(app_url):
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    page = httpx.get(f"{app_url}/sign-in", timeout=HTTP_TIMEOUT)
    assert page.status_code == 200 and page.text.strip()
    assert_error(httpx.get(f"{app_url}/api/session", timeout=HTTP_TIMEOUT), 401, "unauthenticated")


def test_wf_cross_cutting_sign_in(browser, app_url):
    for who, (email, name) in PEOPLE.items():
        api = Api(app_url)
        r = api.post("/api/session", {"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == email and body["user"]["name"] == name
        assert {m["project"]: m["role"] for m in body["memberships"]} == MEMBERSHIPS[who]
        cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith("keelson_session="))
        lowered = cookie.lower()
        for flag in ("HttpOnly", "SameSite=Lax", "Path=/"):
            assert flag.lower() in lowered, cookie
        again = api.get("/api/session")
        assert again.status_code == 200 and again.json() == body
    assert_error(Api(app_url).post("/api/session", {"email": PEOPLE["tomas"][0], "password": PASSWORD + "x"}),
                 401, "invalid_credentials")
    assert_error(Api(app_url).post("/api/session", {"email": "nobody@keelson.test", "password": PASSWORD}),
                 401, "invalid_credentials")
    anon = Api(app_url)
    assert_error(anon.get("/api/session"), 401, "unauthenticated")
    assert_error(anon.get("/api/projects"), 401, "unauthenticated")
    tomas = Api(app_url, "tomas")
    assert tomas.delete("/api/session").status_code == 204
    assert_error(tomas.get("/api/session"), 401, "unauthenticated")
    assert_error(tomas.get(P("/graph")), 401, "unauthenticated")

    with open_app(browser, f"{app_url}/projects/{PROJECT}") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(page.get_by_role("heading", name="Sign in to Keelson", level=1, exact=True)).to_be_visible(timeout=UI_TIMEOUT)
        assert urlparse(page.url).path == "/sign-in"
        sign_in_form(page, "tomas")
        expect(page.get_by_role("region", name="Stage graph", exact=True)).to_be_visible(timeout=UI_TIMEOUT)
        assert urlparse(page.url).path == f"/projects/{PROJECT}"


def test_wf_cross_cutting_isolation(app_url):
    tomas, ravi, june = Api(app_url, "tomas"), Api(app_url, "ravi"), Api(app_url, "june")
    clear_stage(app_url, "dev")
    bundle = new_bundle(tomas)
    r = request_promotion(tomas, "dev", bundle["version"])
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    try:
        projects = ravi.get("/api/projects").json()["projects"]
        assert {p["slug"] for p in projects} == {OTHER_PROJECT}
        assert ravi.get(f"/api/projects/{OTHER_PROJECT}/graph").status_code == 200
        for path in (P("/graph"), P("/bundles"), P("/clusters"), P("/freeze-policy"), stage_path("dev", "/health"),
                     f"/api/promotions/{pid}", f"/api/promotions/{pid}/evidence"):
            assert_error(ravi.get(path), 404, "not_found")
        assert_error(ravi.get(P("/promotions"), {"stage": "dev"}), 404, "not_found")
        assert_error(request_promotion(ravi, "dev", bundle["version"]), 404, "not_found")
        assert_error(june.keyed(f"/api/promotions/{pid}/approve", {}), 404, "not_found")
        assert_error(tomas.get(f"/api/projects/{OTHER_PROJECT}/graph"), 404, "not_found")
        assert bundle["version"] not in json.dumps(ravi.get(f"/api/projects/{OTHER_PROJECT}/bundles").json())
        assert [p["id"] for p in tomas.promotions("dev") if p["bundle"]["version"] == bundle["version"]] == [pid]
    finally:
        finish(app_url, "dev", pid)


ROLE_CASES = {
    "ingest": ("hana", "kofi"),
    "promote": ("hana", "kofi"),
    "start": ("hana", "kofi"),
    "recheck": ("hana", "kofi"),
    "approve": ("tomas", "ines", "kofi"),
    "reject": ("tomas", "ines", "kofi"),
    "break_freeze": ("tomas", "ines", "hana"),
    "rollback": ("tomas", "ines", "hana"),
    "stage_defaults": ("tomas", "hana", "kofi"),
    "add_window": ("tomas", "hana", "kofi"),
    "delete_window": ("tomas", "hana", "kofi"),
    "freeze_version": ("tomas", "hana", "kofi"),
}


@pytest.mark.parametrize("action", list(ROLE_CASES), ids=list(ROLE_CASES))
def test_role_refusals(app_url, action):
    tomas, ines = Api(app_url, "tomas"), Api(app_url, "ines")
    clear_stage(app_url, "dev")
    target_bundle = new_bundle(tomas)
    r = request_promotion(tomas, "dev", target_bundle["version"])
    assert r.status_code == 201, r.text
    target = r.json()
    window_id = None
    if action == "delete_window":
        w = ines.post(P("/clusters/lon1-prod/windows"),
                      {"label": f"Refusal {fresh_tag()}", "days": ["sun"], "start": "09:00", "end": "12:00"})
        assert w.status_code == 201, w.text
        window_id = w.json()["id"]
    try:
        for who in ROLE_CASES[action]:
            api = Api(app_url, who)
            tag = fresh_tag()
            before = tomas.promotion(target["id"])
            staging_before = [p["id"] for p in tomas.promotions("staging", 5)]
            if action == "ingest":
                resp = api.post(P("/bundles"), {"version": tag, "source_commit": commit_for(tag),
                                                "manifests": bundle_manifests(tag)})
            elif action == "promote":
                resp = request_promotion(api, "dev", target_bundle["version"])
            elif action == "start":
                resp = api.keyed(f"/api/promotions/{target['id']}/start", {})
            elif action == "recheck":
                resp = api.keyed(f"/api/promotions/{target['id']}/retry-window", {})
            elif action == "approve":
                resp = api.keyed(f"/api/promotions/{target['id']}/approve", {})
            elif action == "reject":
                resp = api.keyed(f"/api/promotions/{target['id']}/reject", {"reason": INCIDENT_REASON})
            elif action == "break_freeze":
                resp = api.keyed(f"/api/promotions/{target['id']}/break-freeze", {"reason": INCIDENT_REASON})
            elif action == "rollback":
                resp = api.keyed(stage_path("staging", "/rollback"), {"reason": INCIDENT_REASON})
            elif action == "stage_defaults":
                resp = api.patch(stage_path("dev"), {"defaults": {"parameters": {"LOG_LEVEL": "warn"}, "replicas": {}}})
            elif action == "add_window":
                resp = api.post(P("/clusters/lon1-prod/windows"),
                                {"label": f"Refused {tag}", "days": ["sun"], "start": "09:00", "end": "12:00"})
            elif action == "delete_window":
                resp = api.delete(P(f"/clusters/lon1-prod/windows/{window_id}"))
            else:
                latest = max(ines.policy()["versions"], key=lambda v: v["version"])
                eff = server_now(ines) + timedelta(seconds=FREEZE_SPAN)
                resp = api.post(P("/freeze-policy/versions"), {
                    "based_on_version": latest["version"], "effective_from": iso(eff),
                    "freezes": [{"name": f"Refused {tag}", "stages": ["prod-apac"], "starts_at": iso(eff),
                                 "ends_at": iso(eff + timedelta(seconds=FREEZE_SPAN))}]})
            assert_error(resp, 403, "forbidden")
            after = tomas.promotion(target["id"])
            assert after["state"] == before["state"] and after["history"] == before["history"]
            assert [p["id"] for p in tomas.promotions("staging", 5)] == staging_before
            assert tag not in json.dumps(tomas.bundles())
            assert [p["id"] for p in tomas.promotions("dev") if p["bundle"]["version"] == target_bundle["version"]] == [target["id"]]
            clusters = json.dumps(tomas.get(P("/clusters")).json())
            assert f"Refused {tag}" not in clusters
            assert f"Refused {tag}" not in json.dumps(tomas.policy())
            if window_id:
                assert window_id in clusters
    finally:
        if window_id:
            ines.delete(P(f"/clusters/lon1-prod/windows/{window_id}"))
        finish(app_url, "dev", target["id"])


PRECEDENCE_CASES = ["too_large_first", "media_type_before_origin", "origin_before_session", "session_before_lookup",
                    "lookup_before_role", "role_before_key", "key_before_validation", "validation_before_state"]


@pytest.mark.parametrize("case", PRECEDENCE_CASES, ids=PRECEDENCE_CASES)
def test_error_precedence(app_url, case):
    anon = Api(app_url)
    foreign = {"Origin": FOREIGN_ORIGIN}
    promotions = stage_path("dev", "/promotions")
    if case == "too_large_first":
        content = json.dumps({"bundle_version": "x" * (BODY_LIMIT + 1)})
        assert_error(anon.post(promotions, content=content, headers=foreign), 413, "payload_too_large")
    elif case == "media_type_before_origin":
        assert_error(anon.post(promotions, content="bundle_version=1.5.0",
                               headers={**foreign, "Content-Type": "text/plain"}), 415, "unsupported_media_type")
    elif case == "origin_before_session":
        assert_error(anon.post(promotions, {"bundle_version": "1.5.0"}, headers=foreign), 403, "cross_origin")
    elif case == "session_before_lookup":
        assert_error(anon.get(f"/api/projects/{fresh_tag()}/graph"), 401, "unauthenticated")
    elif case == "lookup_before_role":
        hana = Api(app_url, "hana")
        assert_error(hana.post(f"/api/projects/{OTHER_PROJECT}/stages/dev/promotions", {}), 404, "not_found")
        assert_error(hana.post(stage_path(fresh_tag(), "/promotions"), {}), 404, "not_found")
    elif case == "role_before_key":
        assert_error(Api(app_url, "hana").post(promotions, {}), 403, "forbidden")
    elif case == "key_before_validation":
        tomas = Api(app_url, "tomas")
        assert_error(tomas.post(promotions, {}), 400, "request_key_required")
        assert_error(tomas.post(promotions, {}, key="k" * (KEY_MAX + 1)), 400, "request_key_required")
    else:
        tomas = Api(app_url, "tomas")
        bundle = new_bundle(tomas)
        body = assert_error(request_promotion(tomas, "staging", bundle["version"],
                                              {"parameters": {}, "replicas": {REPLICA_REF: REPLICA_MAX + 1}}),
                            422, "validation")
        assert body["fields"]["replicas"] == MSG_REPLICAS
        assert bundle["version"] not in json.dumps(tomas.promotions("staging", 5))


def test_server_boundary(app_url):
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    creds = {"email": PEOPLE["tomas"][0], "password": PASSWORD}
    anon = Api(app_url)
    refused = anon.post("/api/session", creds, headers={"Origin": FOREIGN_ORIGIN})
    assert_error(refused, 403, "cross_origin")

    assert not any(c.startswith("keelson_session=") for c in refused.headers.get_list("set-cookie"))
    assert Api(app_url).post("/api/session", creds, headers={"Origin": origin}).status_code == 200

    base_len = len(json.dumps({"email": PEOPLE["tomas"][0], "password": ""}, separators=(",", ":")))
    exact = json.dumps({"email": PEOPLE["tomas"][0], "password": "x" * (BODY_LIMIT - base_len)}, separators=(",", ":"))
    assert len(exact.encode()) == BODY_LIMIT
    assert_error(Api(app_url).post("/api/session", content=exact), 401, "invalid_credentials")
    over = json.dumps({"email": PEOPLE["tomas"][0], "password": "x" * (BODY_LIMIT - base_len + 1)}, separators=(",", ":"))
    assert_error(Api(app_url).post("/api/session", content=over), 413, "payload_too_large")
    assert_error(Api(app_url).post("/api/session", content="email=a", headers={"Content-Type": "text/plain"}),
                 415, "unsupported_media_type")

    tomas = Api(app_url, "tomas")
    for limit, expected in ((INGEST_LIMIT, 201), (INGEST_LIMIT + 1, 413)):
        tag = fresh_tag()
        manifests = bundle_manifests(tag) + [{"apiVersion": "v1", "kind": "ConfigMap",
                                              "metadata": {"name": "ingest-padding", "namespace": "payments"},
                                              "data": {"PAD": ""}}]
        body = {"version": tag, "source_commit": commit_for(tag), "manifests": manifests}
        size = len(json.dumps(body, separators=(",", ":")).encode())
        manifests[-1]["data"]["PAD"] = "x" * (limit - size)
        content = json.dumps(body, separators=(",", ":"))
        assert len(content.encode()) == limit
        r = tomas.post(P("/bundles"), content=content)
        if expected == 201:
            assert r.status_code == 201, r.text
        else:
            assert_error(r, 413, "payload_too_large")
            assert tag not in json.dumps(tomas.bundles())

    secrets = [os.environ[n] for n in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if os.environ.get(n)]
    for path in SOURCE_PROBES:
        r = httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT)
        assert r.status_code == 404, f"{path} answered {r.status_code}"
        assert not any(s in r.text for s in secrets)


@pytest.mark.parametrize("outage", ["minio-down", "mailpit-down"], ids=["minio-down", "mailpit-down"])
def test_dependency_down_boot(app_url, outage):
    env_name, service = {"minio-down": ("APP_MINIO_DOWN_URL", "storage"),
                         "mailpit-down": ("APP_MAILPIT_DOWN_URL", "mail")}[outage]
    base = os.environ[env_name].rstrip("/")
    r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    tomas = Api(base, "tomas")
    poll(lambda: tomas.status()[service] == "down", API_DEADLINE, f"{service} reported down")
    assert {n["stage"] for n in tomas.graph()["nodes"]} >= set(PIPELINE)
    clear_stage(app_url, "dev")
    bundle = new_bundle(Api(app_url, "tomas"))
    r = request_promotion(tomas, "dev", bundle["version"])
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "applying"
    finish(app_url, "dev", r.json()["id"])
    assert tomas.node("dev")["status"] == "healthy"


def test_status_glyph_contrast(browser, app_url):
    tomas = Api(app_url, "tomas")
    first = verified_bundle(app_url, through="dev")
    clear_stage(app_url, "staging")
    r = request_promotion(tomas, "staging", first["version"])
    assert r.status_code == 201, r.text
    finish(app_url, "staging", r.json()["id"], "degraded")
    clear_stage(app_url, "dev")
    second = new_bundle(tomas)
    r = request_promotion(tomas, "dev", second["version"])
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    try:
        assert report(app_url, "dev", pid, "applying", [(REFS[0], "Synced", "Healthy")]).status_code == 200
        statuses = {n["stage"]: n["status"] for n in tomas.graph()["nodes"]}
        assert statuses["dev"] == "progressing" and statuses["staging"] == "degraded"
        with workspace(browser, app_url, "tomas") as page:
            marks: dict[str, frozenset] = {}
            for stage in PIPELINE:
                def shows_status(stage: str = stage) -> None:
                    expect(node(page, stage)).to_have_attribute("data-status", statuses[stage], timeout=EXPECT_MS)
                eventually(page, shows_status)
                word = STATUS_WORD[statuses[stage]]
                expect(node(page, stage)).to_contain_text(word)
                hide = (stage, *STAGES[stage][:2], "current", "in sync", "Selected")
                marks.setdefault(statuses[stage], assert_status_mark(node(page, stage), word, hide))
            seen = list(marks)
            for i, a in enumerate(seen):
                for b in seen[i + 1:]:
                    assert marks[a] != marks[b], f"{a} and {b} share the same glyph"
            open_stage(page, "dev")
            table = evidence(page, "dev").get_by_role("table", name="Resource health", exact=True)
            expect(table).to_contain_text("OutOfSync", timeout=EXPECT_MS)
            for word in ("Synced", "OutOfSync", "Healthy", "Progressing"):
                cell = table.get_by_role("cell").filter(has_text=re.compile(rf"\b{word}\b")).first
                expect(cell).to_be_visible(timeout=EXPECT_MS)
                assert_status_mark(cell, word)
    finally:
        finish(app_url, "dev", pid)


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_wf_cross_cutting_viewports(browser, app_url, viewport):
    size = VIEWPORTS[viewport]
    with workspace(browser, app_url, "tomas", size=size) as page:
        fits_viewport(page)
        boxes = {s: node(page, s).bounding_box() for s in PIPELINE}
        if size[0] < TABLET[0]:
            ys = [boxes[s]["y"] for s in PIPELINE]
            assert ys == sorted(ys) and len(set(ys)) == len(ys), boxes
        else:
            assert boxes["dev"]["x"] < boxes["staging"]["x"]
            assert all(boxes["staging"]["x"] < boxes[s]["x"] for s in ("prod-eu", "prod-us", "prod-apac"))
        menu = page.get_by_role("button", name="Menu", exact=True)
        if size[0] < DESKTOP[0]:
            expect(menu).to_be_visible()
        else:
            expect(menu).to_have_count(0)
        open_stage(page, "dev")
        if size[0] < TABLET[0]:
            expect(evidence(page, "dev").get_by_role("button", name="Close", exact=True)).to_be_visible()
        fits_viewport(page)


def test_keyboard_and_touch(browser, app_url):
    with workspace(browser, app_url, "tomas") as page:
        names = tab_order(page, TAB_PRESSES)
        order = [names.index(f"Stage {s}") for s in PIPELINE]
        assert order == sorted(order), names
        assert names.index("Windows and freezes") < order[0] and names.index("Sign out") < order[0]
        dev = node(page, "dev")
        rest, focused = state_styles(dev, "outline-style", "outline-width", "outline-color", "box-shadow", state="focus")
        assert rest != focused
        dev.focus()
        page.keyboard.press("Enter")
        column = evidence(page, "dev")
        expect(column).to_be_visible(timeout=EXPECT_MS)
        assert column.evaluate("el => el.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(column).to_be_hidden(timeout=EXPECT_MS)
        expect(dev).to_be_focused()
        page.keyboard.press(" ")
        expect(column).to_be_visible(timeout=EXPECT_MS)
        promote = column.get_by_role("button", name="Promote", exact=True)
        click(promote)
        dialog = page.get_by_role("dialog", name=f"Promote to {PIPELINE[0]}", exact=True)
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden(timeout=EXPECT_MS)
        expect(promote).to_be_focused()
        click(column.get_by_role("button", name="Close", exact=True))
        expect(column).to_be_hidden(timeout=EXPECT_MS)
        expect(dev).to_be_focused()
    with workspace(browser, app_url, "tomas", size=PHONE) as page:
        for role in ("button", "link", "checkbox", "textbox"):
            for control in page.get_by_role(role).all():
                if not control.is_visible():
                    continue
                box = control.bounding_box()
                assert box["width"] >= TOUCH_PX and box["height"] >= TOUCH_PX, (role, control.inner_text(), box)


def test_reduced_motion_rail(browser, app_url):
    tomas = Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    bundle = new_bundle(tomas)
    v = bundle["version"]
    with workspace(browser, app_url, "tomas", reduced_motion="reduce") as page:
        rail, target = edge(page, "dev"), node(page, "dev")
        pid = request_promotion(tomas, "dev", v).json()["id"]
        reached = lambda: rail.evaluate("el => el.querySelectorAll('[data-reached=\"true\"]').length")
        eventually(page, lambda: expect_rail(page, "dev", "applying", 0.2))
        for label in SEGMENTS:
            expect(rail.get_by_text(label, exact=True)).to_have_count(1)
        assert reached() == 3
        assert animations(rail) == []
        eventually(page, lambda: expect(progress_region(page)).to_contain_text(f"{v} to dev: Applying", timeout=EXPECT_MS))
        rows = [(ref, "Synced", "Healthy") for ref in REFS[:4]]
        assert report(app_url, "dev", pid, "health_wait", rows).status_code == 200
        eventually(page, lambda: expect(target).to_contain_text(f"in sync {len(rows)}/{len(REFS)}", timeout=EXPECT_MS))
        assert animations(target) == [] and animations(rail) == []
        assert reached() == 4
        eventually(page, lambda: expect(progress_region(page)).to_contain_text(f"{v} to dev: Health wait", timeout=EXPECT_MS))
        finish(app_url, "dev", pid)
        eventually(page, lambda: expect_rail(page, "dev", "healthy", 1.0))
        assert reached() == 5
        assert animations(rail) == []
        eventually(page, lambda: expect(progress_region(page)).to_contain_text(f"{v} to dev: Healthy", timeout=EXPECT_MS))


def test_idle_no_motion(browser, app_url):
    with workspace(browser, app_url, "tomas") as page:
        graph = page.get_by_role("region", name="Stage graph", exact=True)
        ledger = page.get_by_role("region", name="Ledger", exact=True)
        advance(page, REFRESH_MS * 3)
        infinite = "() => document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"
        assert page.evaluate(infinite) == 0
        settle(graph)
        settle(ledger)
        advance(page, REFRESH_MS * 2)
        moving = lambda region: [a for a in animations(region) if a["playState"] != "finished"]
        assert moving(graph) == [] and moving(ledger) == []
        assert page.evaluate(infinite) == 0


def test_feedback_copy(browser, app_url):
    tomas = Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    bundle = new_bundle(tomas)
    label = f"{bundle['version']} · {bundle['short_digest']}"
    with open_app(browser, f"{app_url}/projects/{PROJECT}") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        fill(page.get_by_role("textbox", name="Email", exact=True), PEOPLE["tomas"][0])
        fill(page.get_by_label("Password", exact=True), PASSWORD + "x")
        click(page.get_by_role("button", name="Sign in", exact=True))
        expect(problem(page)).to_contain_text(COPY_BAD_LOGIN, timeout=EXPECT_MS)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        with held(page, "**/api/session") as gate:
            click(page.get_by_role("button", name="Sign in", exact=True))
            expect(activity(page)).to_contain_text(COPY_SIGNING_IN, timeout=EXPECT_MS)
            gate.release()
        expect(page.get_by_role("region", name="Stage graph", exact=True)).to_be_visible(timeout=UI_TIMEOUT)

        open_stage(page, "dev")
        click(evidence(page, "dev").get_by_role("button", name="Promote", exact=True))
        dialog = page.get_by_role("dialog", name=f"Promote to {PIPELINE[0]}", exact=True)
        pick_bundle(page, dialog, label)
        page.route("**/api/projects/payments-core/stages/dev/promotions", lambda route: route.abort())
        click(dialog.get_by_role("button", name="Request promotion", exact=True))
        expect(problem(page)).to_contain_text(COPY_NETWORK, timeout=EXPECT_MS)
        expect(dialog).to_be_visible()
        page.unroute("**/api/projects/payments-core/stages/dev/promotions")
        assert all(p["bundle"]["version"] != bundle["version"] for p in tomas.promotions("dev", 5))

        assert page.request.delete(f"{app_url}/api/session").status == 204
        def session_ended() -> None:
            shown = page.get_by_text(COPY_SESSION_ENDED)
            expect(shown.first).to_be_attached(timeout=EXPECT_MS)
            assert any(copy.is_visible() for copy in shown.all()), COPY_SESSION_ENDED
        eventually(page, session_ended)
        assert urlparse(page.url).path == "/sign-in"


def test_rail_motion(browser, app_url):
    tomas = Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    with workspace(browser, app_url, "tomas") as page:
        page.evaluate(MOTION_RECORDER)
        graph = page.get_by_role("region", name="Stage graph", exact=True)
        graph.evaluate(FRAME_RECORDER)
        target = node(page, "dev")
        b1 = new_bundle(tomas)
        pid = request_promotion(tomas, "dev", b1["version"]).json()["id"]
        capsule = page.get_by_role("img", name=f"Bundle {b1['short_digest']}", exact=True)
        eventually(page, lambda: expect(capsule).to_be_visible(timeout=EXPECT_MS))
        d0 = rest_distance(page, graph, capsule, target)

        mark = motion_marks(page)
        rows = [(ref, "Synced", "Healthy") for ref in REFS[:3]]
        assert report(app_url, "dev", pid, "applying", rows).status_code == 200
        eventually(page, lambda: expect_rail(page, "dev", "applying", rail_progress("applying", 3, 5)))
        advance(page, MEDIUM_MAX_MS)
        expect(target).to_contain_text(f"in sync {len(rows)}/{len(REFS)}", timeout=EXPECT_MS)
        moves = motion_since(graph, mark)
        assert moves, "no motion followed a rise in server progress"
        assert all(m["duration"] <= MEDIUM_MAX_MS for m in moves if isinstance(m["duration"], (int, float))), moves
        d1 = rest_distance(page, graph, capsule, target)
        assert d1 < d0 - 1, (d0, d1)

        assert report(app_url, "dev", pid, "applying", rows).status_code == 200
        advance(page, REFRESH_LIMIT_MS)
        d2 = rest_distance(page, graph, capsule, target)
        assert abs(d2 - d1) <= 1, (d1, d2)

        mark = motion_marks(page)
        finish(app_url, "dev", pid)
        eventually(page, lambda: expect_rail(page, "dev", "healthy", 1.0))
        advance(page, MEDIUM_MAX_MS)
        flash = motion_since(target, mark)
        assert flash, "the target node did not flash on Healthy"
        assert all(m["iterations"] != float("inf") for m in flash)
        assert all(m["duration"] <= MEDIUM_MAX_MS for m in flash if isinstance(m["duration"], (int, float))), flash
        expect(target).to_contain_text(f"current {b1['short_digest']}", timeout=EXPECT_MS)

        b2 = new_bundle(tomas)
        pid2 = request_promotion(tomas, "dev", b2["version"]).json()["id"]
        capsule2 = page.get_by_role("img", name=f"Bundle {b2['short_digest']}", exact=True)
        assert report(app_url, "dev", pid2, "applying", [(r, "Synced", "Healthy") for r in REFS[:2]]).status_code == 200
        eventually(page, lambda: expect_rail(page, "dev", "applying", rail_progress("applying", 2, 5)))
        before = rest_distance(page, graph, capsule2, target)
        mark = motion_marks(page)
        assert report(app_url, "dev", pid2, "health_wait", [(REFS[0], "Synced", "Degraded")]).json()["state"] == "degraded"
        eventually(page, lambda: expect_rail(page, "dev", "degraded", rail_progress("applying", 2, 5)))
        advance(page, LONG_MAX_MS)
        red = motion_since(graph, mark)
        assert red, "no failure motion ran"
        assert all(m["duration"] <= LONG_MAX_MS for m in red if isinstance(m["duration"], (int, float))), red
        expect(capsule2).to_be_visible()
        after = rest_distance(page, graph, capsule2, target)
        assert abs(after - before) <= 2, (before, after)
        expect(target).to_have_attribute("data-status", "degraded", timeout=EXPECT_MS)
        expect(target).to_contain_text("Degraded")


def test_wf_bundle_intake_ingest(app_url):
    tomas = Api(app_url, "tomas")
    tag = fresh_tag()
    manifests = bundle_manifests(tag) + [{"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": "plain-config"},
                                          "data": {"MODE": tag}}]
    bundle = new_bundle(tomas, tag, manifests)
    assert bundle["version"] == tag and bundle["source_commit"] == commit_for(tag)
    assert re.fullmatch(r"sha256:[0-9a-f]{64}", bundle["digest"])
    hexdigest = bundle["digest"].removeprefix("sha256:")
    assert bundle["short_digest"] == hexdigest[:7]
    stored = bucket().get(f"bundles/{PROJECT}/{hexdigest}.json")
    assert hashlib.sha256(stored).hexdigest() == hexdigest
    obj = json.loads(stored)
    assert obj == {"version": tag, "source_commit": commit_for(tag), "manifests": manifests}
    refs = {r["ref"] for r in bundle["resources"]}
    assert refs == set(REFS) | {"ConfigMap/default/plain-config"}
    assert {(r["kind"], r["namespace"], r["name"]) for r in bundle["resources"]} >= {("ConfigMap", "default", "plain-config")}
    assert bundle["verified_in"] == []
    listing = tomas.get(P("/bundles"))
    assert listing.status_code == 200
    mine = [b for b in listing.json()["bundles"] if b["version"] == tag]
    assert len(mine) == 1 and mine[0]["digest"] == bundle["digest"]
    stamps = [instant(b["ingested_at"]) for b in listing.json()["bundles"]]
    assert stamps == sorted(stamps, reverse=True)
    assert not any(s in listing.text for s in secret_values(tag))
    assert "manifests" not in listing.text
    for who in ("hana", "kofi"):
        refused = fresh_tag()
        assert_error(Api(app_url, who).post(P("/bundles"), {"version": refused, "source_commit": commit_for(refused),
                                                           "manifests": bundle_manifests(refused)}), 403, "forbidden")
        assert all(b["version"] != refused for b in tomas.bundles())


BUNDLE_CASES = ["missing_kind", "bad_name", "duplicate_resource", "bad_version", "bad_commit", "version_exists", "too_large"]


@pytest.mark.parametrize("case", BUNDLE_CASES, ids=BUNDLE_CASES)
def test_wf_bundle_intake_validation(app_url, case):
    tomas = Api(app_url, "tomas")
    tag = fresh_tag()
    manifests = bundle_manifests(tag)
    body: dict[str, Any] = {"version": tag, "source_commit": commit_for(tag), "manifests": manifests}
    original = None
    if case == "version_exists":
        original = new_bundle(tomas, tag)
    keys_before = set(bucket().keys(f"bundles/{PROJECT}/"))
    if case == "missing_kind":
        del manifests[0]["kind"]
        resp = tomas.post(P("/bundles"), body)
        assert assert_error(resp, 422, "validation")["fields"]["manifests"] == MSG_MANIFESTS
    elif case == "bad_name":
        manifests[0]["metadata"]["name"] = "Payments_API"
        resp = tomas.post(P("/bundles"), body)
        assert assert_error(resp, 422, "validation")["fields"]["manifests"] == MSG_MANIFESTS
    elif case == "duplicate_resource":
        manifests.append(json.loads(json.dumps(manifests[0])))
        resp = tomas.post(P("/bundles"), body)
        assert assert_error(resp, 422, "validation")["fields"]["manifests"] == f"Duplicate resource {REFS[0]}."
    elif case == "bad_version":
        body["version"] = f"{tag} beta"
        resp = tomas.post(P("/bundles"), body)
        assert assert_error(resp, 422, "validation")["fields"]["version"] == MSG_VERSION
    elif case == "bad_commit":
        body["source_commit"] = commit_for(tag)[:7]
        resp = tomas.post(P("/bundles"), body)
        assert assert_error(resp, 422, "validation")["fields"]["source_commit"] == MSG_COMMIT
    elif case == "version_exists":
        manifests[0]["data"]["FEATURE_PAYOUTS"] = "changed"
        assert_error(tomas.post(P("/bundles"), body), 409, "version_exists")
    else:
        manifests[0]["data"]["PAD"] = "x" * INGEST_LIMIT
        assert_error(tomas.post(P("/bundles"), body), 413, "payload_too_large")
    mine = [b for b in tomas.bundles() if b["version"] == tag]
    if original:
        assert len(mine) == 1 and mine[0]["digest"] == original["digest"]
    else:
        assert mine == []
    for key in set(bucket().keys(f"bundles/{PROJECT}/")) - keys_before:
        assert json.loads(bucket().get(key)).get("version") != tag, key


def test_wf_bundle_intake_storage_outage(app_url):
    down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    assert httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    tomas_down, tomas = Api(down, "tomas"), Api(app_url, "tomas")
    tag = fresh_tag()
    body = {"version": tag, "source_commit": commit_for(tag), "manifests": bundle_manifests(tag)}
    assert_error(tomas_down.post(P("/bundles"), body), 503, "storage_unavailable")
    assert all(b["version"] != tag for b in tomas.bundles())
    r = tomas.post(P("/bundles"), body)
    assert r.status_code == 201, r.text
    assert bucket().get(f"bundles/{PROJECT}/{r.json()['digest'].removeprefix('sha256:')}.json")


def test_wf_bundle_intake_promote_dialog(browser, app_url):
    ines, tomas = Api(app_url, "ines"), Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    with workspace(browser, app_url, "tomas") as page:
        open_stage(page, "dev")
        click(evidence(page, "dev").get_by_role("button", name="Promote", exact=True))
        dialog = page.get_by_role("dialog", name=f"Promote to {PIPELINE[0]}", exact=True)
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        bundle = new_bundle(ines)
        advance(page, REFRESH_LIMIT_MS)
        pick_bundle(page, dialog,
               f"{bundle['version']} · {bundle['short_digest']}")
        expect(dialog.get_by_text("Overrides frozen into this promotion")).to_be_visible()
        click(dialog.get_by_role("button", name="Request promotion", exact=True))
        expect(activity(page)).to_contain_text(f"Promotion of {bundle['version']} to dev started.", timeout=EXPECT_MS)
    mine = [p for p in tomas.promotions("dev", 5) if p["bundle"]["version"] == bundle["version"]]
    assert len(mine) == 1 and mine[0]["state"] == "applying"
    assert mine[0]["requested_by"]["email"] == PEOPLE["tomas"][0]
    finish(app_url, "dev", mine[0]["id"])


def test_wf_promote_nonprod_request(app_url):
    tomas, ines = Api(app_url, "tomas"), Api(app_url, "ines")
    clear_stage(app_url, "dev")
    bundle = new_bundle(tomas)
    v = bundle["version"]
    defaults = {"parameters": {"LOG_LEVEL": "debug", EXTRA_PARAM: "full"}, "replicas": {REPLICA_REF: 1, GHOST_REF: 3}}
    try:
        r = ines.patch(stage_path("dev"), {"defaults": defaults})
        assert r.status_code == 200 and r.json() == {"stage": "dev", "defaults": defaults}, r.text
        bad = ines.patch(stage_path("dev"), {"defaults": {"parameters": {"log_level": "x"}, "replicas": {}}})
        assert assert_error(bad, 422, "validation")["fields"]["parameters"] == MSG_PARAMS
        bad = ines.patch(stage_path("dev"), {"defaults": {"parameters": {}, "replicas": {REPLICA_REF: REPLICA_MAX + 1}}})
        assert assert_error(bad, 422, "validation")["fields"]["replicas"] == MSG_REPLICAS
        for overrides, field, message in (
            ({"parameters": {}, "replicas": {REFS[4]: 2}}, "replicas", MSG_REPLICA_KIND),
            ({"parameters": {}, "replicas": {REPLICA_REF: REPLICA_MAX + 1}}, "replicas", MSG_REPLICAS),
            ({"parameters": {"log_level": "warn"}, "replicas": {}}, "parameters", MSG_PARAMS),
        ):
            body = assert_error(request_promotion(tomas, "dev", v, overrides), 422, "validation")
            assert body["fields"][field] == message
        body = assert_error(request_promotion(tomas, "dev", fresh_tag()), 422, "validation")
        assert body["fields"]["bundle_version"] == MSG_UNKNOWN_BUNDLE
        assert all(p["bundle"]["version"] != v for p in tomas.promotions("dev", 5))

        in_force_before = tomas.policy()["in_force_version"]
        r = request_promotion(tomas, "dev", v, {"parameters": {"LOG_LEVEL": "warn"}, "replicas": {REPLICA_REF: 3}})
        in_force_after = tomas.policy()["in_force_version"]
        assert r.status_code == 201, r.text
        p = r.json()
        frozen = {"parameters": {"LOG_LEVEL": "warn", EXTRA_PARAM: "full"}, "replicas": {REPLICA_REF: 3}}
        assert p["overrides"] == frozen
        assert p["kind"] == "promotion" and p["stage"] == "dev" and p["project"] == PROJECT
        assert p["cluster"] == "lon1-nonprod" and p["time_zone"] == "Europe/London"
        assert p["bundle"]["version"] == v and p["bundle"]["digest"] == bundle["digest"]
        assert p["requested_by"] == {"email": PEOPLE["tomas"][0], "name": PEOPLE["tomas"][1]}
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", p["requested_at"])
        assert p["policy_version"] in (in_force_before, in_force_after)
        assert p["approval"] is None
        assert p["state"] == "applying" and p["window_decision"]["open"]
        assert p["window_decision"]["reason"] == "open"
        assert p["window_decision"]["policy_version"] == p["policy_version"]
        assert [(h["from"], h["to"]) for h in p["history"]] == [(None, "requested"), ("requested", "queued"), ("queued", "applying")]
        assert p["counter"] == {"in_sync": 0, "total": len(REFS)}
        changed = {"parameters": {"LOG_LEVEL": "info"}, "replicas": {REPLICA_REF: 9}}
        assert ines.patch(stage_path("dev"), {"defaults": changed}).status_code == 200
        assert tomas.promotion(p["id"])["overrides"] == frozen
        finish(app_url, "dev", p["id"])
        assert tomas.promotion(p["id"])["overrides"] == frozen
    finally:
        ines.patch(stage_path("dev"), {"defaults": SEED_DEFAULTS["dev"]})


def test_wf_promote_nonprod_unverified(app_url):
    tomas = Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    clear_stage(app_url, "staging")
    bundle = new_bundle(tomas)
    v = bundle["version"]
    assert_error(request_promotion(tomas, "staging", v), 409, "not_verified_upstream")
    r = request_promotion(tomas, "dev", v)
    finish(app_url, "dev", r.json()["id"], "degraded")
    assert_error(request_promotion(tomas, "staging", v), 409, "not_verified_upstream")
    r = request_promotion(tomas, "dev", v)
    assert r.status_code == 201, r.text
    finish(app_url, "dev", r.json()["id"])
    assert "dev" in next(b for b in tomas.bundles() if b["version"] == v)["verified_in"]
    clear_stage(app_url, "prod-eu")
    assert_error(request_promotion(tomas, "prod-eu", v), 409, "not_verified_upstream")
    assert all(p["bundle"]["version"] != v for p in tomas.promotions("prod-eu", 5))
    assert all(p["bundle"]["version"] != v for p in tomas.promotions("staging", 5))
    clear_stage(app_url, "staging")
    r = request_promotion(tomas, "staging", v)
    assert r.status_code == 201 and r.json()["state"] == "applying", r.text
    finish(app_url, "staging", r.json()["id"])


def test_wf_promote_nonprod_replay(app_url):
    tomas = Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    bundle = new_bundle(tomas)
    v = bundle["version"]
    key = idempotency_key()
    body = {"bundle_version": v, "overrides": {"parameters": {}, "replicas": {}}}
    path = stage_path("dev", "/promotions")
    barrier = threading.Barrier(2)

    def send(_: int) -> httpx.Response:
        barrier.wait()
        return tomas.post(path, body, key=key)

    with ThreadPoolExecutor(2) as pool:
        first, second = list(pool.map(send, range(2)))
    assert first.status_code == 201 and second.status_code == 201, (first.text, second.text)
    assert first.json() == second.json()
    reordered = json.dumps({"overrides": {"replicas": {}, "parameters": {}}, "bundle_version": v}, indent=2)
    replay = tomas.post(path, key=key, content=reordered)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Request-Replayed") == "true"
    assert len([p for p in tomas.promotions("dev") if p["bundle"]["version"] == v]) == 1
    assert_error(tomas.post(path, {"bundle_version": v}, key=key), 409, "request_key_reused")
    other = new_bundle(tomas)
    busy_key = idempotency_key()
    busy = request_promotion(tomas, "dev", other["version"], key=busy_key)
    assert assert_error(busy, 409, "stage_busy")["holder"]["promotion_id"] == first.json()["id"]
    again = request_promotion(tomas, "dev", other["version"], key=busy_key)
    assert again.status_code == 409 and again.json() == busy.json()
    assert again.headers.get("Request-Replayed") == "true"
    finish(app_url, "dev", first.json()["id"])


def test_wf_promote_nonprod_staging_ui(browser, app_url):
    tomas = Api(app_url, "tomas")
    bundle = verified_bundle(app_url, through="dev")
    unverified = new_bundle(tomas)
    clear_stage(app_url, "staging")
    v, short = bundle["version"], bundle["short_digest"]
    with workspace(browser, app_url, "tomas") as page:
        open_stage(page, "staging")
        click(evidence(page, "staging").get_by_role("button", name="Promote", exact=True))
        dialog = page.get_by_role("dialog", name=f"Promote to {PIPELINE[1]}", exact=True)
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        pick_bundle(page, dialog, f"{v} · {short}")
        expect(dialog).not_to_contain_text(f"{unverified['version']} · {unverified['short_digest']}")
        confirm = dialog.get_by_role("button", name="Request promotion", exact=True)
        with held(page, "**/api/projects/payments-core/stages/staging/promotions") as gate:
            confirm.dblclick()
            expect(confirm).to_be_disabled(timeout=EXPECT_MS)
            expect(activity(page)).to_contain_text(COPY_REQUESTING, timeout=EXPECT_MS)
            gate.release()
        expect(activity(page)).to_contain_text(f"Promotion of {v} to staging started.", timeout=EXPECT_MS)
        expect(dialog).to_be_hidden(timeout=EXPECT_MS)
        mine = [p for p in tomas.promotions("staging") if p["bundle"]["version"] == v]
        assert len(mine) == 1, mine
        pid = mine[0]["id"]
        rows = [(REFS[0], "Synced", "Healthy"), (REFS[1], "Synced", "Healthy"), (REFS[2], "OutOfSync", "Healthy")]
        assert report(app_url, "staging", pid, "applying", rows).status_code == 200
        health = tomas.health("staging")
        recount = sum(1 for r in health["resources"] if r["sync"] == "Synced" and r["health"] == "Healthy")
        assert (health["in_sync"], health["total"]) == (recount, len(health["resources"])) == (2, len(REFS))
        assert tomas.node("staging")["counter"] == {"in_sync": 2, "total": len(REFS)}
        eventually(page, lambda: expect(node(page, "staging")).to_contain_text(f"in sync 2/{len(REFS)}", timeout=EXPECT_MS))
    finish(app_url, "staging", pid)


def test_wf_promotion_rail_agent_reports(app_url):
    tomas = Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    bundle = new_bundle(tomas)
    pid = request_promotion(tomas, "dev", bundle["version"]).json()["id"]
    health = tomas.health("dev")
    assert health["revision"] == pid and (health["in_sync"], health["total"]) == (0, len(REFS))
    assert {r["ref"] for r in health["resources"]} == set(REFS)
    assert all(r["sync"] == "OutOfSync" and r["health"] == "Progressing" for r in health["resources"])

    ok = [(REFS[0], "Synced", "Healthy")]
    assert_error(report(app_url, "dev", pid, "applying", ok, token=JUNK_TOKEN), 401, "unauthenticated")
    bare = httpx.post(f"{app_url}/api/agent/reports", json={"promotion_id": pid, "phase": "applying",
                                                            "resources": [{"ref": REFS[0], "sync": "Synced", "health": "Healthy"}]},
                      timeout=HTTP_TIMEOUT)
    assert_error(bare, 401, "unauthenticated")
    assert_error(report(app_url, "dev", pid, "applying", ok, token=CLUSTER_TOKEN["lon1-prod"]), 404, "not_found")
    body = assert_error(report(app_url, "dev", pid, "applying", [(UNKNOWN_REF, "Synced", "Healthy")]), 422, "validation")
    assert body["fields"]["resources"] == f"Unknown resource {UNKNOWN_REF}."
    assert tomas.health("dev")["in_sync"] == 0

    r = report(app_url, "dev", pid, "applying",
               [(REFS[0], "Synced", "Healthy"), (REFS[1], "Synced", "Healthy"), (REFS[2], "Synced", "Progressing")])
    assert r.status_code == 200 and r.json() == {"promotion_id": pid, "state": "applying",
                                                 "counter": {"in_sync": 2, "total": len(REFS)}}, r.text
    e = tomas.edge("dev")
    assert e["phase"] == "applying" and math.isclose(e["progress"], rail_progress("applying", 2, 5), abs_tol=0.0005)
    r = report(app_url, "dev", pid, "health_wait", [(REFS[2], "Synced", "Healthy"), (REFS[3], "OutOfSync", "Missing")])
    assert r.status_code == 200 and r.json()["state"] == "health_wait" and r.json()["counter"]["in_sync"] == 3
    e = tomas.edge("dev")
    assert e["phase"] == "health_wait" and math.isclose(e["progress"], rail_progress("health_wait", 3, 5), abs_tol=0.0005)
    assert tomas.node("dev")["status"] == "progressing"
    assert_error(report(app_url, "dev", pid, "applying", ok), 409, "phase_regression")
    r = report(app_url, "dev", pid, "health_wait", [(ref, "Synced", "Healthy") for ref in REFS])
    assert r.status_code == 200 and r.json()["state"] == "healthy"
    assert r.json()["counter"] == {"in_sync": len(REFS), "total": len(REFS)}
    n = tomas.node("dev")
    assert n["status"] == "healthy" and n["current"]["short_digest"] == bundle["short_digest"]
    assert tomas.edge("dev")["phase"] == "healthy" and tomas.edge("dev")["progress"] == 1
    assert_error(report(app_url, "dev", pid, "health_wait", ok), 409, "promotion_not_running")
    assert tomas.promotion(pid)["state"] == "healthy"

    second = new_bundle(tomas)
    pid2 = request_promotion(tomas, "dev", second["version"]).json()["id"]
    assert report(app_url, "dev", pid2, "applying", [(REFS[0], "Synced", "Healthy")]).json()["state"] == "applying"
    r = report(app_url, "dev", pid2, "applying", [(REFS[1], "Synced", "Degraded")])
    assert r.status_code == 200 and r.json()["state"] == "degraded"
    e = tomas.edge("dev")
    assert e["phase"] == "degraded" and math.isclose(e["progress"], rail_progress("applying", 1, 5), abs_tol=0.0005)
    assert tomas.node("dev")["status"] == "degraded"


def test_wf_promotion_rail_counter(browser, app_url):
    tomas = Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    bundle = new_bundle(tomas)
    steps = [
        ("applying", [(REFS[0], "Synced", "Healthy"), (REFS[1], "OutOfSync", "Healthy"), (REFS[2], "Synced", "Progressing")]),
        ("applying", [(REFS[1], "Synced", "Healthy")]),
        ("health_wait", [(REFS[0], "OutOfSync", "Healthy"), (REFS[3], "Synced", "Healthy"), (REFS[4], "Synced", "Healthy")]),
    ]
    with workspace(browser, app_url, "tomas") as page:
        r = request_promotion(tomas, "dev", bundle["version"])
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        for phase, rows in steps:
            r = report(app_url, "dev", pid, phase, rows)
            assert r.status_code == 200, r.text
            health = tomas.health("dev")
            assert health["revision"] == pid
            recount = sum(1 for row in health["resources"] if row["sync"] == "Synced" and row["health"] == "Healthy")
            total = len(health["resources"])
            assert total == len(REFS)
            assert (health["in_sync"], health["total"]) == (recount, total)
            assert r.json()["counter"] == {"in_sync": recount, "total": total}
            assert tomas.node("dev")["counter"] == {"in_sync": recount, "total": total}
            assert tomas.promotion(pid)["counter"] == {"in_sync": recount, "total": total}
            eventually(page, lambda recount=recount, total=total: expect(node(page, "dev")).to_contain_text(
                f"in sync {recount}/{total}", timeout=EXPECT_MS))
    finish(app_url, "dev", pid)


def test_wf_promotion_rail_attributes(browser, app_url):
    tomas = Api(app_url, "tomas")
    clear_stage(app_url, "dev")
    bundle = new_bundle(tomas)

    def matches_api() -> None:
        e = tomas.edge("dev")
        expect_rail(page, "dev", e["phase"], e["progress"])

    with workspace(browser, app_url, "tomas", size=PHONE) as page:
        r = request_promotion(tomas, "dev", bundle["version"])
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        eventually(page, lambda: expect_rail(page, "dev", "applying", 0.2))
        matches_api()
        open_stage(page, "dev", use_tap=True)
        tap(evidence(page, "dev").get_by_role("button", name="Close", exact=True))
        expect(evidence(page, "dev")).to_be_hidden(timeout=EXPECT_MS)
        fits_viewport(page)
        assert report(app_url, "dev", pid, "applying",
                      [(REFS[0], "Synced", "Healthy"), (REFS[1], "Synced", "Healthy")]).status_code == 200
        eventually(page, lambda: expect_rail(page, "dev", "applying", rail_progress("applying", 2, 5)))
        matches_api()
        assert report(app_url, "dev", pid, "health_wait",
                      [(REFS[2], "Synced", "Healthy"), (REFS[3], "Synced", "Healthy")]).status_code == 200
        eventually(page, lambda: expect_rail(page, "dev", "health_wait", rail_progress("health_wait", 4, 5)))
        matches_api()
        r = report(app_url, "dev", pid, "health_wait", [(REFS[4], "Synced", "Degraded")])
        assert r.status_code == 200 and r.json()["state"] == "degraded", r.text
        eventually(page, lambda: expect_rail(page, "dev", "degraded", rail_progress("health_wait", 4, 5)))
        matches_api()


def test_wf_promotion_rail_watch(browser, app_url):
    bundle = verified_bundle(app_url)
    tomas, hana = Api(app_url, "tomas"), Api(app_url, "hana")
    clear_stage(app_url, "prod-us")
    v, short = bundle["version"], bundle["short_digest"]
    with workspace(browser, app_url, "tomas") as page:
        promotion = prod_request(tomas, "prod-us", v)
        pid = promotion["id"]
        capsule = page.get_by_role("img", name=f"Bundle {short}", exact=True)
        eventually(page, lambda: expect_rail(page, "prod-us", "queued", 0.1))
        expect(capsule).to_be_visible()
        eventually(page, lambda: expect(progress_region(page)).to_contain_text(f"{v} to prod-us: Queued", timeout=EXPECT_MS))
        approve(hana, pid)
        started(app_url, pid)
        eventually(page, lambda: expect_rail(page, "prod-us", "applying", 0.2))
        rows = [(REFS[0], "Synced", "Healthy"), (REFS[1], "Synced", "Healthy")]
        assert report(app_url, "prod-us", pid, "applying", rows).status_code == 200
        eventually(page, lambda: expect_rail(page, "prod-us", "applying", rail_progress("applying", 2, 5)))
        eventually(page, lambda: expect(node(page, "prod-us")).to_contain_text(f"in sync {len(rows)}/{len(REFS)}",
                                                                               timeout=EXPECT_MS))
        rows = [(ref, "Synced", "Healthy") for ref in REFS[:4]]
        assert report(app_url, "prod-us", pid, "health_wait", rows).status_code == 200
        eventually(page, lambda: expect_rail(page, "prod-us", "health_wait", rail_progress("health_wait", 4, 5)))
        api_edge = tomas.edge("prod-us")
        assert expect_rail(page, "prod-us", api_edge["phase"], api_edge["progress"]) is None
        finish(app_url, "prod-us", pid)
        eventually(page, lambda: expect_rail(page, "prod-us", "healthy", 1.0))
        target = node(page, "prod-us")
        expect(target).to_have_attribute("data-status", "healthy", timeout=EXPECT_MS)
        eventually(page, lambda: expect(target).to_contain_text(f"current {short}", timeout=EXPECT_MS))
        eventually(page, lambda: expect(target).to_contain_text(f"in sync {len(REFS)}/{len(REFS)}", timeout=EXPECT_MS))
        expect(target).to_contain_text(STATUS_WORD["healthy"])
        eventually(page, lambda: expect(capsule).to_have_count(0, timeout=EXPECT_MS))
        eventually(page, lambda: expect(progress_region(page)).to_contain_text(f"{v} to prod-us: Healthy", timeout=EXPECT_MS))
    assert tomas.promotion(pid)["state"] == "healthy"


def test_wf_prod_concurrency_race(app_url, mail):
    bundles = [verified_bundle(app_url) for _ in range(RACERS)]
    clear_stage(app_url, "prod-eu")
    apis = [Api(app_url, "tomas" if i % 2 == 0 else "mei") for i in range(RACERS)]
    assert_error(request_promotion(Api(app_url, "kofi"), "prod-eu", bundles[0]["version"]), 403, "forbidden")
    assert Api(app_url, "tomas").node("prod-eu")["active_promotion"] is None
    keys = [idempotency_key() for _ in range(RACERS)]
    barrier = threading.Barrier(RACERS)

    def send(i: int) -> httpx.Response:
        barrier.wait()
        return request_promotion(apis[i], "prod-eu", bundles[i]["version"], key=keys[i])

    with ThreadPoolExecutor(RACERS) as pool:
        results = list(pool.map(send, range(RACERS)))
    winners = [i for i, r in enumerate(results) if r.status_code == 201]
    assert len(winners) == 1, [r.text for r in results]
    win = bundles[winners[0]]
    holder = results[winners[0]].json()
    for i, r in enumerate(results):
        if i == winners[0]:
            continue
        body = assert_error(r, 409, "stage_busy")
        assert body["holder"]["promotion_id"] == holder["id"]
        assert body["holder"]["bundle_version"] == win["version"]
        assert body["holder"]["bundle_digest"] == win["digest"]
        assert body["holder"]["state"] == "awaiting_approval"
    replay = request_promotion(apis[winners[0]], "prod-eu", win["version"], key=keys[winners[0]])
    assert replay.status_code == 201 and replay.json() == holder, replay.text
    assert replay.headers.get("Request-Replayed") == "true"
    listed = Api(app_url, "tomas").promotions("prod-eu")
    versions = {b["version"] for b in bundles}
    assert [p["id"] for p in listed if p["bundle"]["version"] in versions] == [holder["id"]]
    won = wait_mail(mail, f"Approval requested: {win['version']} to prod-eu ({PROJECT_NAME})", len(RELEASE_MANAGERS))
    assert recipients(won) == rm_emails()
    everything = mail.messages()
    for b in bundles:
        if b is not win:
            assert titled(everything, f"Approval requested: {b['version']} to prod-eu ({PROJECT_NAME})") == []
    clear_stage(app_url, "prod-eu")


def test_wf_prod_concurrency_loser_ui(browser, app_url):
    winner, loser = verified_bundle(app_url), verified_bundle(app_url)
    clear_stage(app_url, "prod-eu")
    tomas = Api(app_url, "tomas")
    with workspace(browser, app_url, "mei") as page:
        open_stage(page, "prod-eu")
        click(evidence(page, "prod-eu").get_by_role("button", name="Promote", exact=True))
        dialog = page.get_by_role("dialog", name=f"Promote to {PIPELINE[2]}", exact=True)
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        pick_bundle(page, dialog,
               f"{loser['version']} · {loser['short_digest']}")
        r = request_promotion(tomas, "prod-eu", winner["version"])
        assert r.status_code == 201, r.text
        click(dialog.get_by_role("button", name="Request promotion", exact=True))
        expect(problem(page)).to_contain_text(
            f"prod-eu is held by {winner['version']} ({winner['short_digest']}). Try again when it finishes.",
            timeout=EXPECT_MS)
        expect(dialog).to_be_visible()
        capsule = page.get_by_role("region", name="Stage graph", exact=True, include_hidden=True).get_by_role(
            "img", name=f"Bundle {winner['short_digest']}", exact=True, include_hidden=True)

        def holder_shown() -> None:
            shown = on_screen(node(page, "prod-eu", behind_modal=True))
            assert shown and shown[0].get_attribute("data-status") == "out_of_sync", "prod-eu not shown out of sync"
            assert STATUS_WORD["out_of_sync"] in shown[0].inner_text()
            assert on_screen(capsule), "the winner's capsule is not on the graph"
        eventually(page, holder_shown)
    assert tomas.node("prod-eu")["status"] == "out_of_sync"
    assert all(p["bundle"]["version"] != loser["version"] for p in tomas.promotions("prod-eu"))
    clear_stage(app_url, "prod-eu")


def test_wf_prod_approval_mail_link(app_url, mail):
    bundle = verified_bundle(app_url)
    tomas, olu = Api(app_url, "tomas"), Api(app_url, "olu")
    v = bundle["version"]
    p = prod_request(tomas, "prod-eu", v)
    msgs = wait_mail(mail, f"Approval requested: {v} to prod-eu ({PROJECT_NAME})", len(RELEASE_MANAGERS))
    assert recipients(msgs) == rm_emails()
    tokens = set()
    for m in msgs:
        assert FROM_ADDRESS in [a.lower() for a in addresses(m.get("From"))]
        body = text(m)
        assert v in body and bundle["short_digest"] in body
        assert PEOPLE["tomas"][0] in body or PEOPLE["tomas"][1] in body
        assert cluster_time(p["approval"]["request_expires_at"], "Europe/London") in body
        no_secrets(body, v)
        found = TOKEN_RE.search(body)
        assert found, body
        tokens.add(found.group(1))
    anon = Api(app_url)
    for token in tokens:
        link = anon.get(f"/api/approval-links/{token}")
        assert link.status_code == 200, link.text
        data = link.json()
        assert data["project"] in (PROJECT, PROJECT_NAME) and data["stage"] == "prod-eu"
        assert data["bundle"]["version"] == v and data["bundle"]["short_digest"] == bundle["short_digest"]
        assert data["promotion_id"] == p["id"] and data["time_zone"] == "Europe/London"
        assert data["request_expires_at"] == p["approval"]["request_expires_at"]
        no_secrets(link.text, v)
    assert_error(anon.get(f"/api/approval-links/{fresh_tag()}"), 404, "not_found")
    r = olu.keyed(f"/api/promotions/{p['id']}/reject", {"reason": INCIDENT_REASON})
    assert r.status_code == 200 and r.json()["state"] == "rejected", r.text
    for token in tokens:
        assert_error(anon.get(f"/api/approval-links/{token}"), 410, "link_expired")


def test_wf_prod_approval_decisions(app_url, mail):
    tomas, hana, olu = Api(app_url, "tomas"), Api(app_url, "hana"), Api(app_url, "olu")
    first, second = verified_bundle(app_url), verified_bundle(app_url)
    p = prod_request(tomas, "prod-eu", first["version"])
    path = f"/api/promotions/{p['id']}"
    for who in ("tomas", "ines", "kofi"):
        api = Api(app_url, who)
        assert_error(api.keyed(f"{path}/approve", {}), 403, "forbidden")
        assert_error(api.keyed(f"{path}/reject", {"reason": INCIDENT_REASON}), 403, "forbidden")
    body = assert_error(hana.keyed(f"{path}/approve", {"comment": "x" * (COMMENT_MAX + 1)}), 422, "validation")
    assert body["fields"]["comment"] == MSG_COMMENT
    body = assert_error(olu.keyed(f"{path}/reject", {"reason": SHORT_REASON}), 422, "validation")
    assert body["fields"]["reason"] == MSG_REASON
    assert tomas.promotion(p["id"])["approval"]["state"] == "pending"
    r = olu.keyed(f"{path}/reject", {"reason": INCIDENT_REASON})
    assert r.status_code == 200 and r.json()["state"] == "rejected" and r.json()["approval"]["state"] == "rejected"
    rejected = wait_mail(mail, f"Rejected: {first['version']} to prod-eu", 1)
    assert recipients(rejected) == [PEOPLE["tomas"][0]]
    assert_error(hana.keyed(f"{path}/approve", {}), 409, "invalid_transition")

    q = prod_request(tomas, "prod-eu", second["version"])
    approved = approve(hana, q["id"], {"comment": REVIEW_COMMENT})
    assert approved["state"] == "approved" and approved["approval"]["state"] == "approved"
    assert approved["approval"]["comment"] == REVIEW_COMMENT
    ttl = int(os.environ.get("KEELSON_APPROVAL_TTL_SECONDS", APPROVAL_TTL_DEFAULT))
    lifetime = instant(approved["approval"]["expires_at"]) - instant(approved["approval"]["decided_at"])
    assert lifetime == timedelta(seconds=ttl)
    body = assert_error(hana.keyed(f"/api/promotions/{q['id']}/approve", {}), 409, "invalid_transition")
    assert body["state"] == "approved"
    assert_error(olu.keyed(f"/api/promotions/{q['id']}/reject", {"reason": INCIDENT_REASON}), 409, "invalid_transition")
    assert recipients(wait_mail(mail, f"Approved: {second['version']} to prod-eu", 1)) == [PEOPLE["tomas"][0]]
    clear_stage(app_url, "prod-eu")

    third = verified_bundle(app_url)
    down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    clear_stage(app_url, "prod-us")
    r = request_promotion(Api(down, "tomas"), "prod-us", third["version"])
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    first_key = snapshot_key(pid, 1)
    stored_before = first_key in evidence_keys(pid)
    attempt = Api(down, "hana").keyed(f"/api/promotions/{pid}/approve", {})
    stored_after = first_key in evidence_keys(pid)
    if not stored_before and not stored_after:
        assert_error(attempt, 409, "evidence_pending")
    else:
        assert attempt.status_code in (409, 503), attempt.text
    assert tomas.promotion(pid)["approval"]["state"] == "pending"
    wait_snapshot(pid, 1)
    assert approve(hana, pid)["state"] == "approved"
    clear_stage(app_url, "prod-us")


def test_wf_prod_approval_atomic(app_url, mail):
    bundle = verified_bundle(app_url)
    v = bundle["version"]
    clear_stage(app_url, "prod-eu")
    with relay_copy() as (base, storage, _smtp):
        tomas, hana = Api(base, "tomas"), Api(base, "hana")
        p = prod_request(tomas, "prod-eu", v)
        pid = p["id"]
        wait_snapshot(pid, 1)
        before = tomas.promotion(pid)
        storage.down()
        assert_error(hana.keyed(f"/api/promotions/{pid}/approve", {"comment": "Looks fine."}), 503, "storage_unavailable")
        after = tomas.promotion(pid)
        assert after["state"] == "awaiting_approval" and after["approval"]["state"] == "pending"
        assert after["approval"]["decided_by"] is None and after["history"] == before["history"]
        assert evidence_keys(pid) == [snapshot_key(pid, 1)]
        assert titled(mail.messages(), f"Approved: {v} to prod-eu") == []
        storage.up()
        r = hana.keyed(f"/api/promotions/{pid}/approve", {"comment": "Looks fine."})
        assert r.status_code == 200 and r.json()["approval"]["state"] == "approved", r.text
        snap = wait_snapshot(pid, 2)
        assert snap["state"] == "approved" and snap["promotion_id"] == pid
        assert recipients(wait_mail(mail, f"Approved: {v} to prod-eu", 1)) == [PEOPLE["tomas"][0]]
    clear_stage(app_url, "prod-eu")


def test_wf_prod_approval_ui(browser, app_url, mail):
    bundle = verified_bundle(app_url)
    tomas = Api(app_url, "tomas")
    v, short = bundle["version"], bundle["short_digest"]
    p = prod_request(tomas, "prod-eu", v)
    wait_snapshot(p["id"], 1)
    msgs = wait_mail(mail, f"Approval requested: {v} to prod-eu ({PROJECT_NAME})", len(RELEASE_MANAGERS))
    hana_msg = next(m for m in msgs if PEOPLE["hana"][0] in [a.lower() for a in addresses(m.get("To"))])
    token = TOKEN_RE.search(text(hana_msg)).group(1)
    live = tomas.health("prod-eu")
    live_short = tomas.promotion(live["revision"])["bundle"]["short_digest"] if live["revision"] else None
    with open_app(browser, f"{app_url}/approvals/{token}") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(page.get_by_role("heading", name="Approval requested", exact=True)).to_be_visible(timeout=UI_TIMEOUT)
        expect(page.get_by_text(short).first).to_be_visible()
        expect(page.get_by_text(cluster_time(p["approval"]["request_expires_at"], "Europe/London")).first).to_be_visible()
        expect(page.get_by_text(REDACTED).first).to_be_visible()
        no_secrets(page.content(), v)
        click(page.get_by_role("link", name="Open in Keelson", exact=True))
        expect(page.get_by_role("heading", name="Sign in to Keelson", exact=True)).to_be_visible(timeout=UI_TIMEOUT)
        sign_in_form(page, "hana")
        expect(page.get_by_role("region", name="Stage graph", exact=True)).to_be_visible(timeout=UI_TIMEOUT)
        column = evidence(page, "prod-eu")
        if not column.is_visible():
            open_stage(page, "prod-eu")
        for heading in ("Diff", "Approvals", "Window decision", "Health", "History"):
            expect(column.get_by_role("heading", name=heading, exact=True)).to_be_visible()
        expect(column.get_by_text(REDACTED).first).to_be_visible()
        expect(column).to_contain_text(COPY_NOT_CHECKED)
        if live_short:
            expect(column).to_contain_text(f"Live revision {live_short}")
            table = column.get_by_role("table", name="Resource health", exact=True)
            expect(table).to_contain_text(live["resources"][0]["name"])
        else:
            expect(column).to_contain_text("Nothing deployed yet.")
        no_secrets(column.inner_text(), v)
        click(column.get_by_role("button", name="Approve", exact=True))
        dialog = page.get_by_role("dialog", name=f"Approve {v} to prod-eu", exact=True)
        fill(dialog.get_by_role("textbox", name="Comment", exact=True), UI_REVIEW_COMMENT)
        click(dialog.get_by_role("button", name="Approve promotion", exact=True))
        expect(activity(page)).to_contain_text(COPY_NOTIFIED, timeout=EXPECT_MS)
        decided = tomas.promotion(p["id"])
        assert decided["state"] == "approved" and decided["approval"]["comment"] == UI_REVIEW_COMMENT
        expiry = cluster_time(decided["approval"]["expires_at"], "Europe/London")
        expect(activity(page)).to_contain_text(f"Approved until {expiry}. {COPY_NOTIFIED}")
        page.goto(f"{app_url}/approvals/{token}")
        expect(page.get_by_role("heading", name="This approval link has expired.", exact=True)).to_be_visible(timeout=UI_TIMEOUT)
    assert recipients(wait_mail(mail, f"Approved: {v} to prod-eu", 1)) == [PEOPLE["tomas"][0]]
    clear_stage(app_url, "prod-eu")


def test_wf_approval_expiry_start_edge(expiry_app, mail):
    base = expiry_app
    tomas, hana = Api(base, "tomas"), Api(base, "hana")
    early, late = verified_bundle(base), verified_bundle(base)
    p = prod_request(tomas, "prod-us", early["version"])
    granted = approve(hana, p["id"])
    life = instant(granted["approval"]["expires_at"]) - instant(granted["approval"]["decided_at"])
    assert life == timedelta(seconds=SHORT_TTL)
    assert server_now(tomas) < instant(granted["approval"]["expires_at"])
    key = idempotency_key()
    r = start(tomas, p["id"], key)
    assert r.status_code == 200 and r.json()["state"] in ("applying", "window_blocked"), r.text
    replay = start(tomas, p["id"], key)
    assert replay.status_code == 200 and replay.json() == r.json() and replay.headers.get("Request-Replayed") == "true"
    assert_error(tomas.post(f"/api/promotions/{p['id']}/start", {"note": SHORT_REASON}, key=key), 409, "request_key_reused")
    assert tomas.promotion(p["id"])["history"] == r.json()["history"]
    clear_stage(base, "prod-us")

    q = prod_request(tomas, "prod-eu", late["version"])
    granted = approve(hana, q["id"])
    expires = instant(granted["approval"]["expires_at"])
    wait_until(tomas, expires)
    assert_expired_refusal(start(tomas, q["id"]))
    final = tomas.promotion(q["id"])
    assert final["state"] == "expired" and final["approval"]["state"] == "expired"
    assert final["history"][-1]["from"] == "approved" and final["history"][-1]["to"] == "expired"
    assert_expired_refusal(start(tomas, q["id"]))
    notices = wait_mail(mail, f"Approval expired: {late['version']} to prod-eu", 1)
    assert len(notices) == 1 and recipients(notices) == [PEOPLE["tomas"][0]]


def test_wf_approval_expiry_request_lapse(mail):
    with relay_copy(KEELSON_APPROVAL_TTL_SECONDS=str(SHORT_TTL)) as (base, _storage, smtp):
        tomas = Api(base, "tomas")
        bundle = verified_bundle(base)
        v = bundle["version"]
        smtp.down()
        p = prod_request(tomas, "prod-apac", v)
        lapse = instant(p["approval"]["request_expires_at"])
        assert lapse - instant(p["requested_at"]) == timedelta(seconds=SHORT_TTL)
        wait_until(tomas, lapse)
        poll(lambda: tomas.promotion(p["id"])["state"] == "expired", SWEEP_S + SWEEP_SLACK,
             "the sweep to expire the request")
        assert tomas.promotion(p["id"])["approval"]["state"] == "expired"
        assert_expired_refusal(Api(base, "hana").keyed(f"/api/promotions/{p['id']}/approve", {}))
        smtp.up()
        msgs = wait_mail(mail, f"Approval requested: {v} to prod-apac ({PROJECT_NAME})", len(RELEASE_MANAGERS))
        assert recipients(msgs) == rm_emails()
        token = TOKEN_RE.search(text(msgs[0])).group(1)
        assert_error(Api(base).get(f"/api/approval-links/{token}"), 410, "link_expired")
        notices = wait_mail(mail, f"Approval expired: {v} to prod-apac", 1)
        assert len(notices) == 1 and recipients(notices) == [PEOPLE["tomas"][0]]
        assert httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_wf_approval_expiry_stale_tab(browser, expiry_app):
    base = expiry_app
    tomas, hana = Api(base, "tomas"), Api(base, "hana")
    bundle = verified_bundle(base)
    p = prod_request(tomas, "prod-eu", bundle["version"])
    granted = approve(hana, p["id"])
    expires_at = granted["approval"]["expires_at"]
    with workspace(browser, base, "tomas") as page:
        open_stage(page, "prod-eu")
        column = evidence(page, "prod-eu")
        start_button = column.get_by_role("button", name="Start promotion", exact=True)
        expect(start_button).to_be_visible(timeout=EXPECT_MS)
        wait_until(tomas, instant(expires_at))
        with page.expect_response(lambda r: r.request.method == "POST"
                                  and urlparse(r.url).path == f"/api/promotions/{p['id']}/start") as answer:
            click(start_button)
        assert_expired_refusal_body(answer.value.status, answer.value.json())
        if answer.value.json()["error"] == "approval_expired":
            expect(problem(page)).to_contain_text(
                f"This approval expired at {cluster_time(expires_at, 'Europe/London')}. Request a new promotion.",
                timeout=EXPECT_MS)
        else:
            expect(problem(page)).to_have_text(re.compile(r"\S"), timeout=EXPECT_MS)
        assert tomas.promotion(p["id"])["state"] == "expired"
        eventually(page, lambda: expect(column).to_contain_text(re.compile("expired", re.I), timeout=EXPECT_MS))
        expect(column.get_by_role("button", name="Start promotion", exact=True)).to_have_count(0)


SG_CASES = {"before_open": ("09:59", False), "at_open": ("10:00", True),
            "before_close": ("15:59", True), "at_close": ("16:00", False)}


def test_wf_sync_windows_cluster_zone(app_url):
    tomas = Api(app_url, "tomas")
    zone = "Asia/Singapore"
    for name, (hm, is_open) in SG_CASES.items():
        local = f"{SG_WEDNESDAY} {hm}"
        moment = datetime.strptime(local, "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo(zone))
        for at in (iso(moment), moment.isoformat()):
            d = tomas.decision("prod-apac", at)
            assert d["open"] is is_open, (name, d)
            assert d["local_time"] == local and d["policy_version"] == 1
            assert d["reason"] == ("open" if is_open else "outside_window"), d
            if is_open:
                assert d["window"]["label"] == APAC_WINDOW
    d = tomas.decision("prod-apac", local_instant(f"{SG_SATURDAY} 11:00", zone))
    assert d["open"] is False and d["reason"] == "outside_window"
    summer, winter = tomas.decision("prod-eu", EU_TUESDAY_BST), tomas.decision("prod-eu", EU_TUESDAY_GMT)
    assert summer["open"] is True and summer["window"]["label"] == EU_WINDOW
    assert summer["local_time"] == local_text(EU_TUESDAY_BST, "Europe/London")
    assert winter["open"] is False and winter["reason"] == "outside_window"
    assert winter["local_time"] == local_text(EU_TUESDAY_GMT, "Europe/London")
    nonprod = tomas.decision("dev", EU_TUESDAY_GMT)
    assert nonprod["open"] is True and nonprod["window"] is None


def test_wf_sync_windows_openings_dst(app_url):
    ines = Api(app_url, "ines")
    eu = [o for o in ines.openings("lon1-prod", FALL_FROM) if o["label"] == EU_WINDOW][:2]
    assert [o["opens_at"] for o in eu] == [EU_OPEN_BEFORE, EU_OPEN_AFTER]
    assert tuple(o["local_opens"] for o in eu) == EU_LOCAL_OPENS
    label = f"Night shift {fresh_tag()}"
    r = ines.post(P("/clusters/lon1-prod/windows"), {"label": label, "days": ["sun"], "start": "01:30", "end": NIGHT_END})
    assert r.status_code == 201, r.text
    window = r.json()
    try:
        assert window["label"] == label and window["days"] == ["sun"] and (window["start"], window["end"]) == ("01:30", NIGHT_END)
        mine = lambda start: next(o for o in ines.openings("lon1-prod", start) if o["window_id"] == window["id"])
        gap, overlap = mine(CLOCK_FROM["spring_gap"]), mine(CLOCK_FROM["autumn_overlap"])
        assert (gap["opens_at"], gap["local_opens"]) == (GAP_OPENS_AT, GAP_LOCAL_OPENS)
        assert (overlap["opens_at"], overlap["local_opens"]) == (OVERLAP_OPENS_AT, OVERLAP_LOCAL_OPENS)
        listed = ines.openings("lon1-prod", FALL_FROM)
        stamps = [instant(o["opens_at"]) for o in listed]
        assert stamps == sorted(stamps) and stamps[0] >= instant(FALL_FROM) and len(listed) == COUNT_MAX
        r = ines.get(P("/clusters/lon1-prod/window-openings"), {"from": FALL_FROM})
        assert r.json()["time_zone"] == "Europe/London" and len(r.json()["openings"]) == OPENINGS_SHOWN
        assert ines.openings("lon1-nonprod", FALL_FROM) == []
        for params, field, message in (({"from": FALL_FROM, "count": 0}, "count", MSG_COUNT),
                                       ({"from": FALL_FROM, "count": COUNT_MAX + 1}, "count", MSG_COUNT),
                                       ({"from": SUNDAY, "count": 1}, "from", MSG_FROM)):
            body = assert_error(ines.get(P("/clusters/lon1-prod/window-openings"), params), 422, "validation")
            assert body["fields"][field] == message
        for body, field, message in (
            ({"label": label, "days": [], "start": "09:00", "end": "10:00"}, "days", MSG_DAYS),
            ({"label": label, "days": ["mon"], "start": "9am", "end": "10:00"}, "start", MSG_TIME),
            ({"label": label, "days": ["mon"], "start": "10:00", "end": "09:00"}, "end", MSG_END),
            ({"label": "", "days": ["mon"], "start": "09:00", "end": "10:00"}, "label", MSG_LABEL),
        ):
            assert assert_error(ines.post(P("/clusters/lon1-prod/windows"), body), 422, "validation")["fields"][field] == message
        refused = assert_error(Api(app_url, "tomas").post(P("/clusters/lon1-prod/windows"),
                                                          {"label": f"Refused {label}", "days": ["sun"],
                                                           "start": "01:30", "end": NIGHT_END}), 403, "forbidden")
        assert refused
        assert all(w["label"] != f"Refused {label}" for c in ines.clusters() for w in c["windows"])
        assert sum(1 for c in ines.clusters() for w in c["windows"] if w["label"] == label) == 1
    finally:
        assert ines.delete(P(f"/clusters/lon1-prod/windows/{window['id']}")).status_code == 204
    assert all(w["id"] != window["id"] for c in ines.clusters() for w in c["windows"])


def test_wf_sync_windows_start_inside(app_url):
    ines, tomas, hana = Api(app_url, "ines"), Api(app_url, "tomas"), Api(app_url, "hana")
    zone = "America/New_York"
    first, second = verified_bundle(app_url), verified_bundle(app_url)
    clear_stage(app_url, "prod-us")
    today = server_now(ines).astimezone(ZoneInfo(zone)).weekday()
    near = {DAYS[(today + d) % 7] for d in (-1, 0, 1)}
    created: list[str] = []
    try:
        w = ines.post(P("/clusters/use1-prod/windows"),
                      {"label": f"All day {fresh_tag()}", "days": sorted(near), "start": "00:00", "end": "24:00"})
        assert w.status_code == 201, w.text
        created.append(w.json()["id"])
        p = prod_request(tomas, "prod-us", first["version"])
        approve(hana, p["id"])
        r = start(tomas, p["id"])
        assert r.status_code == 200, r.text
        d = r.json()["window_decision"]
        assert r.json()["state"] == "applying" and d["open"] is True and d["window"]["id"] == created[0]
        assert d["local_time"] == local_text(d["evaluated_at"], zone)
        assert ines.delete(P(f"/clusters/use1-prod/windows/{created.pop()}")).status_code == 204
        w = ines.post(P("/clusters/use1-prod/windows"), {"label": f"Elsewhen {fresh_tag()}",
                                                          "days": [x for x in DAYS if x not in near],
                                                          "start": "00:00", "end": "24:00"})
        assert w.status_code == 201, w.text
        created.append(w.json()["id"])
        closed = tomas.decision("prod-us")
        assert closed["open"] is False and closed["reason"] == "outside_window"
        assert report(app_url, "prod-us", p["id"], "applying", [(REFS[0], "Synced", "Healthy")]).status_code == 200
        finish(app_url, "prod-us", p["id"])
        assert tomas.promotion(p["id"])["state"] == "healthy"

        q = prod_request(tomas, "prod-us", second["version"])
        approve(hana, q["id"])
        r = start(tomas, q["id"])
        assert r.status_code == 200 and r.json()["state"] == "window_blocked", r.text
        assert r.json()["window_decision"]["reason"] == "outside_window"
        history = r.json()["history"]
        again = tomas.keyed(f"/api/promotions/{q['id']}/retry-window", {})
        assert again.status_code == 200 and again.json()["state"] == "window_blocked", again.text
        assert again.json()["history"] == history
        assert instant(again.json()["window_decision"]["evaluated_at"]) >= instant(r.json()["window_decision"]["evaluated_at"])
        assert tomas.health("prod-us")["revision"] == p["id"]
    finally:
        for wid in created:
            ines.delete(P(f"/clusters/use1-prod/windows/{wid}"))
        clear_stage(app_url, "prod-us")


def test_wf_sync_windows_plan_ui(browser, app_url):
    ines = Api(app_url, "ines")
    zone = "Asia/Singapore"
    label = f"Weekend {fresh_tag()}"
    day = server_now(ines).astimezone(ZoneInfo(zone)).date() + timedelta(days=PLAN_DAYS_AHEAD)
    day += timedelta(days=(5 - day.weekday()) % 7)
    while instant(YEAR_END[0]).date() <= day + timedelta(days=1) < instant(YEAR_END[1]).date() + timedelta(days=1):
        day += timedelta(days=7)
    saturday, sunday = f"{day:%Y-%m-%d} 08:30", f"{day + timedelta(days=1):%Y-%m-%d} 08:30"
    with workspace(browser, app_url, "ines", route=f"/projects/{PROJECT}/windows") as page:
        panel = page.get_by_role("region", name=f"Cluster {STAGES['prod-apac'][0]}", exact=True)
        expect(panel).to_contain_text(zone)
        click(panel.get_by_role("button", name="Add window", exact=True))
        dialog = page.get_by_role("dialog", name=f"Add window to {STAGES['prod-apac'][0]}", exact=True)
        check(dialog.get_by_role("checkbox", name=DAY_BOXES[5], exact=True))
        fill(dialog.get_by_role("textbox", name="Opens", exact=True), "08:00")
        fill(dialog.get_by_role("textbox", name="Closes", exact=True), BAD_CLOSES)
        fill(dialog.get_by_role("textbox", name="Label", exact=True), label)
        click(dialog.get_by_role("button", name="Save window", exact=True))
        expect(dialog).to_contain_text(MSG_END, timeout=EXPECT_MS)
        expect(dialog.get_by_role("textbox", name="Label", exact=True)).to_have_value(label)
        fill(dialog.get_by_role("textbox", name="Closes", exact=True), "09:00")
        click(dialog.get_by_role("button", name="Save window", exact=True))
        expect(dialog).to_be_hidden(timeout=EXPECT_MS)
        cluster = next(c for c in ines.clusters() if c["name"] == "sin1-prod")
        window = next(w for w in cluster["windows"] if w["label"] == label)
        try:
            assert window["days"] == [DAYS[5]] and (window["start"], window["end"]) == ("08:00", "09:00")
            page_now = iso(datetime.fromtimestamp(page.evaluate("Date.now()") / 1000, timezone.utc))
            plans = [ines.openings("sin1-prod", start) for start in (iso(server_now(ines)), page_now)]
            firsts = {o["local_opens"] for plan in plans for o in plan[:1] + [next(
                o for o in plan if o["window_id"] == window["id"])]}
            added = "|".join(re.escape(f"Window added. Next opening {local} {zone}.") for local in firsts)
            expect(activity(page)).to_contain_text(re.compile(added), timeout=EXPECT_MS)
            listing = page.get_by_role("list", name=f"Next openings {STAGES['prod-apac'][0]}", exact=True)

            def lists_openings() -> None:
                shown = listing.inner_text()
                wanted = [[f"{o['local_opens']} {zone}" for o in plan[:OPENINGS_SHOWN]] for plan in plans]
                assert any(all(w in shown for w in want) for want in wanted), (shown, wanted)
            eventually(page, lists_openings)
            form = page.get_by_role("form", name="Check an instant", exact=True)
            select(form.get_by_role("combobox", name="Stage", exact=True), "prod-apac")
            verdict = form.get_by_role("status", name="Window decision", exact=True)
            for local, shown in ((saturday, f"Open: {label}"), (sunday, COPY_CLOSED_OUTSIDE)):
                fill(form.get_by_role("textbox", name="Cluster local time", exact=True), local)
                click(form.get_by_role("button", name="Check", exact=True))
                expect(verdict).to_contain_text(shown, timeout=EXPECT_MS)
            assert ines.decision("prod-apac", local_instant(saturday, zone))["window"]["id"] == window["id"]
            assert ines.decision("prod-apac", local_instant(sunday, zone))["reason"] == "outside_window"
            mei = Api(app_url, "mei")
            d = mei.decision("prod-apac")
            assert d["local_time"] == local_text(d["evaluated_at"], zone)
            click(panel.get_by_role("button", name=f"Delete window {label}", exact=True))
            expect(activity(page)).to_contain_text(COPY_WINDOW_REMOVED, timeout=EXPECT_MS)
        finally:
            ines.delete(P(f"/clusters/sin1-prod/windows/{window['id']}"))
    assert all(w["label"] != label for c in ines.clusters() for w in c["windows"])


def test_wf_freeze_policy_versions(app_url):
    tomas, hana = Api(app_url, "tomas"), Api(app_url, "hana")
    first, second = verified_bundle(app_url), verified_bundle(app_url)
    clear_stage(app_url, "prod-apac")
    name = f"Black Friday {fresh_tag()}"
    clean, clean_at = schedule_freeze(app_url, None)
    frozen, frozen_at = schedule_freeze(app_url, name, lead=FREEZE_LEAD_S * 2)
    wait_in_force(tomas, clean["version"], clean_at)
    a = prod_request(tomas, "prod-apac", first["version"])
    assert instant(a["requested_at"]) < frozen_at, "setup too slow to request before the new version"
    assert a["policy_version"] == clean["version"]
    wait_in_force(tomas, frozen["version"], frozen_at)
    approve(hana, a["id"])
    r = start(tomas, a["id"])
    assert r.status_code == 200, r.text
    assert r.json()["window_decision"]["policy_version"] == clean["version"]
    assert r.json()["window_decision"]["reason"] != "freeze"
    assert tomas.promotion(a["id"])["policy_version"] == clean["version"]
    clear_stage(app_url, "prod-apac")

    b = prod_request(tomas, "prod-apac", second["version"])
    assert b["policy_version"] == frozen["version"]
    approve(hana, b["id"])
    r = start(tomas, b["id"])
    assert r.status_code == 200 and r.json()["state"] == "window_blocked", r.text
    d = r.json()["window_decision"]
    assert d["reason"] == "freeze" and d["freeze"]["name"] == name and d["policy_version"] == frozen["version"]
    at_edge = tomas.decision("prod-apac", iso(frozen_at))
    assert at_edge["policy_version"] == frozen["version"] and at_edge["reason"] == "freeze"
    just_before = tomas.decision("prod-apac", iso(frozen_at - timedelta(milliseconds=1)))
    assert just_before["policy_version"] == clean["version"] and just_before["reason"] != "freeze"
    listed = {v["version"]: v for v in tomas.policy()["versions"]}
    assert listed[frozen["version"]]["freezes"][0]["name"] == name
    assert listed[clean["version"]]["freezes"] == []
    clear_stage(app_url, "prod-apac")


def test_wf_freeze_policy_stale(app_url):
    ines = Api(app_url, "ines")
    latest = max(ines.policy()["versions"], key=lambda v: v["version"])
    created, effective = schedule_freeze(app_url, f"Base {fresh_tag()}", lead=STALE_LEAD_S)
    assert created["version"] == latest["version"] + 1
    stale_name = f"Stale {fresh_tag()}"
    later = effective + timedelta(seconds=FREEZE_SPAN)
    freeze = {"name": stale_name, "stages": ["prod-apac"], "starts_at": iso(later),
              "ends_at": iso(later + timedelta(seconds=FREEZE_SPAN))}
    body = assert_error(ines.post(P("/freeze-policy/versions"), {"based_on_version": latest["version"],
                                                                 "effective_from": iso(later), "freezes": [freeze]}),
                        412, "stale_version")
    assert body["current_version"] == created["version"]
    now = server_now(ines)
    for effective_from, freezes, field, message in (
        (iso(now - timedelta(seconds=FREEZE_SPAN)), [freeze], "effective_from", MSG_PAST),
        (iso(effective), [freeze], "effective_from", f"Must be later than when version {created['version']} takes effect."),
        (iso(later), [{**freeze, "ends_at": freeze["starts_at"]}], "freezes", MSG_ENDS),
        (iso(later), [{**freeze, "stages": [GHOST_STAGE]}], "freezes", f"Unknown stage {GHOST_STAGE}."),
    ):
        r = ines.post(P("/freeze-policy/versions"), {"based_on_version": created["version"],
                                                      "effective_from": effective_from, "freezes": freezes})
        assert assert_error(r, 422, "validation")["fields"][field] == message
    assert_error(Api(app_url, "tomas").post(P("/freeze-policy/versions"), {
        "based_on_version": created["version"], "effective_from": iso(later), "freezes": [freeze]}), 403, "forbidden")
    assert stale_name not in json.dumps(ines.policy())


def test_wf_freeze_policy_black_friday_ui(browser, app_url):
    ines = Api(app_url, "ines")
    name = f"Black Friday {fresh_tag()}"

    def fill_dialog(page: Page, effective: datetime, fmt: str) -> Any:
        click(page.get_by_role("region", name="Freeze policy", exact=True)
              .get_by_role("button", name="New freeze version", exact=True))
        dialog = page.get_by_role("dialog", name="New freeze policy version", exact=True)
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        fill(dialog.get_by_role("textbox", name="Effective from (UTC)", exact=True), f"{effective:{fmt}}")
        if dialog.get_by_role("textbox", name="Freeze name", exact=True).count() == 0:
            click(dialog.get_by_role("button", name="Add freeze", exact=True))
        fill(dialog.get_by_role("textbox", name="Freeze name", exact=True), name)
        fill(dialog.get_by_role("textbox", name="Starts (UTC)", exact=True), f"{effective:{fmt}}")
        fill(dialog.get_by_role("textbox", name="Ends (UTC)", exact=True),
             f"{effective + timedelta(seconds=FREEZE_SPAN):{fmt}}")
        check(dialog.get_by_role("checkbox", name="prod-apac", exact=True))
        return dialog

    def restart(page: Page) -> None:
        cancel = page.get_by_role("dialog", name="New freeze policy version", exact=True).get_by_role(
            "button", name="Cancel", exact=True)
        if cancel.count():
            click(cancel)
        page.reload()
        expect(page.get_by_role("heading", name="Windows and freezes", exact=True)).to_be_visible(timeout=UI_TIMEOUT)

    with workspace(browser, app_url, "ines", route=f"/projects/{PROJECT}/windows") as page:
        lead = server_now(ines) + timedelta(seconds=UI_FREEZE_LEAD_S)
        effective = (lead + timedelta(minutes=1)).replace(second=0, microsecond=0)
        for at, fmt in enumerate(UTC_INPUT_FORMS):
            dialog = fill_dialog(page, effective, fmt)
            racer, _ = schedule_freeze(app_url, f"Racer {fresh_tag()}")
            click(dialog.get_by_role("button", name="Schedule version", exact=True))
            try:
                expect(problem(page)).to_contain_text(
                    f"Someone scheduled version {racer['version']} first. Reload to see it, then try again.", timeout=EXPECT_MS)
                break
            except AssertionError:
                if at == len(UTC_INPUT_FORMS) - 1:
                    raise
                restart(page)
        expect(dialog).to_be_visible()
        assert name not in json.dumps(ines.policy())
        restart(page)
        for at, fmt in enumerate(UTC_INPUT_FORMS[at:], start=at):
            dialog = fill_dialog(page, effective, fmt)
            click(dialog.get_by_role("button", name="Schedule version", exact=True))
            try:
                expect(activity(page)).to_contain_text(
                    f"Freeze policy version {racer['version'] + 1} takes effect at {effective:%Y-%m-%d %H:%M} UTC.",
                    timeout=EXPECT_MS)
                break
            except AssertionError:
                if at == len(UTC_INPUT_FORMS) - 1:
                    raise
                restart(page)
    version = next(v for v in ines.policy()["versions"] if v["version"] == racer["version"] + 1)
    assert instant(version["effective_from"]) == effective and version["freezes"][0]["name"] == name
    assert version["freezes"][0]["stages"] == ["prod-apac"]
    after = ines.decision("prod-apac", iso(effective + timedelta(minutes=1)))
    before = ines.decision("prod-apac", iso(effective - timedelta(minutes=1)))
    assert after["policy_version"] == version["version"] and after["reason"] == "freeze" and after["freeze"]["name"] == name
    assert before["policy_version"] == racer["version"] and (before["freeze"] or {}).get("name") != name


def test_wf_freeze_break_api(app_url, mail):
    bundle, blocked = blocked_prod_apac(app_url)
    pid, v = blocked["id"], bundle["version"]
    path = f"/api/promotions/{pid}/break-freeze"
    for who in ("tomas", "ines", "hana"):
        assert_error(Api(app_url, who).keyed(path, {"reason": INCIDENT_REASON}), 403, "forbidden")
    kofi = Api(os.environ["APP_MAILPIT_DOWN_URL"].rstrip("/"), "kofi")
    assert assert_error(kofi.keyed(path, {"reason": SHORT_REASON}), 422, "validation")["fields"]["reason"] == MSG_REASON
    assert Api(app_url, "tomas").promotion(pid)["state"] == "window_blocked"
    key = idempotency_key()
    r = kofi.post(path, {"reason": INCIDENT_REASON}, key=key)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["state"] == "applying"
    assert p["freeze_break"]["by"] == PEOPLE["kofi"][0] and p["freeze_break"]["reason"] == INCIDENT_REASON
    assert [(h["from"], h["to"]) for h in p["history"][-2:]] == [("window_blocked", "queued"), ("queued", "applying")]
    replay = kofi.post(path, {"reason": INCIDENT_REASON}, key=key)
    assert replay.status_code == 200 and replay.json() == p and replay.headers.get("Request-Replayed") == "true"
    body = assert_error(kofi.keyed(path, {"reason": INCIDENT_REASON}), 409, "invalid_transition")
    assert body["state"] == "applying"
    msgs = wait_mail(mail, f"Freeze broken: prod-apac by {PEOPLE['kofi'][1]}", len(RELEASE_MANAGERS))
    mine = [m for m in msgs if v in text(m)]
    assert recipients(mine) == rm_emails()
    for m in mine:
        assert INCIDENT_REASON in text(m)
        no_secrets(text(m), v)
    finish(app_url, "prod-apac", pid)


def test_wf_freeze_break_phone(browser, app_url):
    bundle, blocked = blocked_prod_apac(app_url)
    v = bundle["version"]
    with workspace(browser, app_url, "kofi", size=PHONE) as page:
        ys = [node(page, s).bounding_box()["y"] for s in PIPELINE]
        assert ys == sorted(ys)
        open_stage(page, "prod-apac", use_tap=True)
        column = evidence(page, "prod-apac")
        tap(column.get_by_role("button", name="Break freeze", exact=True))
        dialog = page.get_by_role("dialog", name=f"Break freeze on {PIPELINE[4]}", exact=True)
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        fill(dialog.get_by_role("textbox", name="Incident reason", exact=True), INCIDENT_REASON)
        tap(dialog.get_by_role("button", name="Break freeze and start", exact=True))
        expect(activity(page)).to_contain_text(
            f"Freeze broken. Applying {v} to prod-apac. Release managers will be notified.", timeout=EXPECT_MS)
        fits_viewport(page)
    p = Api(app_url, "tomas").promotion(blocked["id"])
    assert p["state"] == "applying" and p["freeze_break"]["reason"] == INCIDENT_REASON
    finish(app_url, "prod-apac", blocked["id"])


def test_wf_rollback_exact(app_url):
    ines, kofi, tomas = Api(app_url, "ines"), Api(app_url, "kofi"), Api(app_url, "tomas")
    good_bundle, bad_bundle = verified_bundle(app_url), verified_bundle(app_url)
    then = {"parameters": {"LOG_LEVEL": "warn", ROLLBACK_PARAM: "active"}, "replicas": {REPLICA_REF: 6}}
    now = {"parameters": {"LOG_LEVEL": "error"}, "replicas": {REPLICA_REF: 2}}
    try:
        assert ines.patch(stage_path("prod-us"), {"defaults": then}).status_code == 200
        good = finished_prod(app_url, "prod-us", good_bundle, "healthy")
        assert good["overrides"] == then
        assert ines.patch(stage_path("prod-us"), {"defaults": now}).status_code == 200
        bad = finished_prod(app_url, "prod-us", bad_bundle, "degraded")
        rollback = stage_path("prod-us", "/rollback")
        for who in ("tomas", "ines", "hana"):
            assert_error(Api(app_url, who).keyed(rollback, {"reason": INCIDENT_REASON}), 403, "forbidden")
        assert assert_error(kofi.keyed(rollback, {"reason": SHORT_REASON}), 422, "validation")["fields"]["reason"] == MSG_REASON
        down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
        assert_error(Api(down, "kofi").keyed(rollback, {"reason": INCIDENT_REASON}), 503, "storage_unavailable")
        assert tomas.promotion(bad["id"])["state"] == "degraded"
        assert tomas.health("prod-us")["revision"] == bad["id"]
        r = kofi.keyed(rollback, {"reason": INCIDENT_REASON})
        assert r.status_code == 201, r.text
        rb = r.json()
        assert rb["kind"] == "rollback" and rb["restores"] == good["id"] and rb["approval"] is None
        assert rb["bundle"]["digest"] == good_bundle["digest"] and rb["bundle"]["version"] == good_bundle["version"]
        assert rb["overrides"] == good["overrides"] == then
        assert rb["state"] in ("applying", "window_blocked")
        assert tomas.promotion(bad["id"])["state"] == "rolled_back"
        busy = assert_error(kofi.keyed(rollback, {"reason": INCIDENT_REASON}), 409, "stage_busy")
        assert busy["holder"]["promotion_id"] == rb["id"]
        if rb["state"] == "window_blocked":
            assert kofi.keyed(f"/api/promotions/{rb['id']}/break-freeze", {"reason": INCIDENT_REASON}).status_code == 200
        finish(app_url, "prod-us", rb["id"])
        assert tomas.node("prod-us")["current"]["short_digest"] == good_bundle["short_digest"]
    finally:
        ines.patch(stage_path("prod-us"), {"defaults": SEED_DEFAULTS["prod-us"]})
        clear_stage(app_url, "prod-us")


def test_wf_rollback_ui(browser, app_url):
    good_bundle, bad_bundle = verified_bundle(app_url), verified_bundle(app_url)
    finished_prod(app_url, "prod-us", good_bundle, "healthy")
    bad = finished_prod(app_url, "prod-us", bad_bundle, "degraded")
    tomas = Api(app_url, "tomas")
    v, short = good_bundle["version"], good_bundle["short_digest"]
    with workspace(browser, app_url, "kofi") as page:
        target = node(page, "prod-us")
        eventually(page, lambda: expect(target).to_have_attribute("data-status", "degraded", timeout=EXPECT_MS))
        open_stage(page, "prod-us")
        click(evidence(page, "prod-us").get_by_role("button", name="Roll back", exact=True))
        dialog = page.get_by_role("dialog", name=f"Roll back {PIPELINE[3]}", exact=True)
        expect(dialog).to_contain_text(f"Restores {v} ({short})", timeout=EXPECT_MS)
        fill(dialog.get_by_role("textbox", name="Incident reason", exact=True), INCIDENT_REASON)
        click(dialog.get_by_role("button", name=f"Roll back to {v}", exact=True))
        expect(activity(page)).to_contain_text(f"Rolling prod-us back to {v} ({short}).", timeout=EXPECT_MS)
        rb = next(p for p in tomas.promotions("prod-us", 5) if p["kind"] == "rollback")
        assert rb["bundle"]["digest"] == good_bundle["digest"]
        assert tomas.promotion(bad["id"])["state"] == "rolled_back"
        finish(app_url, "prod-us", rb["id"])
        eventually(page, lambda: expect(target).to_have_attribute("data-status", "healthy", timeout=EXPECT_MS))
        expect(target).to_contain_text(f"current {short}")
        expect(target).to_contain_text(STATUS_WORD["healthy"])
        health = tomas.health("prod-us")
        recount = sum(1 for row in health["resources"] if row["sync"] == "Synced" and row["health"] == "Healthy")
        assert health["revision"] == rb["id"]
        assert (health["in_sync"], health["total"]) == (recount, len(health["resources"]))
        assert tomas.node("prod-us")["counter"] == {"in_sync": recount, "total": health["total"]}
        eventually(page, lambda: expect(target).to_contain_text(f"in sync {recount}/{health['total']}", timeout=EXPECT_MS))
    assert tomas.promotion(rb["id"])["state"] == "healthy"


def test_wf_evidence_audit_snapshots(app_url):
    bundle = verified_bundle(app_url)
    tomas, hana = Api(app_url, "tomas"), Api(app_url, "hana")
    p = prod_request(tomas, "prod-eu", bundle["version"])
    pid = p["id"]
    first = wait_snapshot(pid, 1)
    first_bytes = bucket().get(snapshot_key(pid, 1))
    assert first["snapshot"] == 1 and first["promotion_id"] == pid and first["state"] == "awaiting_approval"
    storage_down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    assert_error(Api(storage_down, "hana").keyed(f"/api/promotions/{pid}/approve", {}), 503, "storage_unavailable")
    assert tomas.promotion(pid)["approval"]["state"] == "pending"
    assert evidence_keys(pid) == [snapshot_key(pid, 1)]
    approve(hana, pid)
    started(app_url, pid)
    finish(app_url, "prod-eu", pid)

    def healthy_latest() -> list[str] | None:
        keys = evidence_keys(pid)
        return keys if json.loads(bucket().get(keys[-1]))["state"] == "healthy" else None

    keys = poll(healthy_latest, DRAIN_S + SWEEP_S, "the healthy snapshot")
    assert keys == [snapshot_key(pid, n) for n in range(1, len(keys) + 1)]
    states = []
    for n, key in enumerate(keys, start=1):
        snap = json.loads(bucket().get(key))
        assert SNAPSHOT_KEYS <= set(snap) and snap["snapshot"] == n
        assert snap["project"] == PROJECT and snap["stage"] == "prod-eu" and snap["bundle"]["digest"] == bundle["digest"]
        states.append(snap["state"])
    assert "approved" in states and states[-1] == "healthy"
    assert bucket().get(snapshot_key(pid, 1)) == first_bytes
    r = tomas.get(f"/api/promotions/{pid}/evidence")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert r.content == bucket().get(keys[-1])
    assert any(f'filename="{name}"' in r.headers["content-disposition"] for name in evidence_names(pid, len(keys)))
    assert "attachment" in r.headers["content-disposition"]
    down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    assert_error(Api(down, "tomas").get(f"/api/promotions/{pid}/evidence"), 503, "storage_unavailable")


def test_wf_evidence_audit_redaction(browser, app_url, mail):
    bundle = verified_bundle(app_url)
    tomas = Api(app_url, "tomas")
    v = bundle["version"]
    p = prod_request(tomas, "prod-eu", v)
    diff = p["diff"]
    assert any(e["resource"] == SECRET_REFS[0] and e["path"] == "stringData.password" for e in diff), diff
    for e in diff:
        if e["resource"] in SECRET_REFS and e["path"]:
            assert e["before"] in (REDACTED, None) and e["after"] in (REDACTED, None), e
    assert REDACTED in json.dumps(diff)
    no_secrets(json.dumps(tomas.promotion(p["id"])), v)
    no_secrets(json.dumps(wait_snapshot(p["id"], 1)), v)
    msgs = wait_mail(mail, f"Approval requested: {v} to prod-eu ({PROJECT_NAME})", len(RELEASE_MANAGERS))
    for m in msgs:
        no_secrets(json.dumps(m) + text(m), v)
    token = TOKEN_RE.search(text(msgs[0])).group(1)
    link = Api(app_url).get(f"/api/approval-links/{token}")
    assert link.status_code == 200 and REDACTED in link.text
    no_secrets(link.text, v)
    with open_app(browser, f"{app_url}/approvals/{token}") as page:
        expect(page.get_by_role("heading", name="Approval requested", exact=True)).to_be_visible(timeout=UI_TIMEOUT)
        no_secrets(page.content(), v)
    with workspace(browser, app_url, "hana") as page:
        open_stage(page, "prod-eu")
        column = evidence(page, "prod-eu")
        expect(column.get_by_text(REDACTED).first).to_be_visible(timeout=EXPECT_MS)
        expect(column).to_contain_text("password")
        no_secrets(column.inner_text(), v)
        no_secrets(page.content(), v)
    clear_stage(app_url, "prod-eu")


def test_wf_evidence_audit_history(app_url):
    bundle = verified_bundle(app_url)
    tomas, hana = Api(app_url, "tomas"), Api(app_url, "hana")
    clear_stage(app_url, "prod-us")
    seen = [prod_request(tomas, "prod-us", bundle["version"])]
    pid = seen[0]["id"]
    seen.append(approve(hana, pid))
    seen.append(started(app_url, pid))
    finish(app_url, "prod-us", pid)
    seen.append(tomas.promotion(pid))
    for older, newer in zip(seen, seen[1:]):
        assert newer["history"][:len(older["history"])] == older["history"]
        assert len(newer["history"]) > len(older["history"])
    history = seen[-1]["history"]
    assert history[0]["from"] is None and history[0]["to"] == "requested" and history[-1]["to"] == "healthy"
    for prev, entry in zip(history, history[1:]):
        assert entry["from"] == prev["to"], history
        assert instant(entry["at"]) >= instant(prev["at"])
    for entry in history:
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", entry["at"])
    actors = {(h["from"], h["to"]): h["by"] for h in history}
    assert actors[(None, "requested")] == PEOPLE["tomas"][0]
    assert actors[("requested", "awaiting_approval")] == "system"
    assert actors[("awaiting_approval", "approved")] == PEOPLE["hana"][0]
    assert history[-1]["by"] == f"agent:{STAGES['prod-us'][0]}"


def test_wf_evidence_audit_export_ui(browser, app_url):
    bundle = verified_bundle(app_url)
    done = finished_prod(app_url, "prod-eu", bundle, "healthy")
    pid = done["id"]

    def healthy_latest() -> list[str] | None:
        keys = evidence_keys(pid)
        return keys if json.loads(bucket().get(keys[-1]))["state"] == "healthy" else None

    keys = poll(healthy_latest, DRAIN_S + SWEEP_S, "the healthy snapshot")
    with workspace(browser, app_url, "hana") as page:
        open_stage(page, "prod-eu")
        column = evidence(page, "prod-eu")
        expect(column).to_contain_text(bundle["short_digest"], timeout=EXPECT_MS)
        with page.expect_download() as info:
            click(column.get_by_role("button", name="Download evidence", exact=True))
        download = info.value
        expect(activity(page)).to_contain_text(COPY_EVIDENCE_DOWNLOADED, timeout=EXPECT_MS)
        assert download.suggested_filename in evidence_names(pid, len(keys))
        content = Path(download.path()).read_bytes()
    assert content == bucket().get(keys[-1])
    record = json.loads(content)
    assert record["bundle"]["digest"] == bundle["digest"] and record["policy_version"] == done["policy_version"]
    assert PEOPLE["tomas"][0] in json.dumps(record["requested_by"])
    assert record["window_decisions"] and "reason" in record["window_decisions"][0]
    approvals = record["approvals"] if isinstance(record["approvals"], list) else [record["approvals"]]
    assert any(a["decision"] == "approved" and PEOPLE["hana"][0] in json.dumps(a["by"]) for a in approvals)
    assert record["health_timeline"] and record["state"] == "healthy"
    assert record["overrides"] == done["overrides"]
    assert record["bundle"]["source_commit"] == bundle["source_commit"]


def test_wf_outage_recovery_drain(app_url, mail):
    bundle = verified_bundle(app_url)
    v = bundle["version"]
    clear_stage(app_url, "prod-us")
    with relay_copy() as (base, storage, smtp):
        tomas = Api(base, "tomas")
        storage.down()
        smtp.down()
        poll(lambda: tomas.status()["storage"] == "down" and tomas.status()["mail"] == "down", API_DEADLINE,
             "storage and mail reported down")
        key = idempotency_key()
        r = request_promotion(tomas, "prod-us", v, key=key)
        assert r.status_code == 201, r.text
        p = r.json()
        assert p["state"] == "awaiting_approval"
        replay = request_promotion(tomas, "prod-us", v, key=key)
        assert replay.status_code == 201 and replay.json() == p and replay.headers.get("Request-Replayed") == "true"
        assert [x["id"] for x in tomas.promotions("prod-us") if x["bundle"]["version"] == v] == [p["id"]]
        storage.up()
        smtp.up()
        poll(lambda: tomas.status()["storage"] == "up" and tomas.status()["mail"] == "up", API_DEADLINE,
             "storage and mail reported up")
        wait_snapshot(p["id"], 1)
        msgs = wait_mail(mail, f"Approval requested: {v} to prod-us ({PROJECT_NAME})", len(RELEASE_MANAGERS))
        assert recipients(msgs) == rm_emails()
        assert evidence_keys(p["id"]) == [snapshot_key(p["id"], 1)]
        storage.down()
        assert_error(Api(base, "hana").keyed(f"/api/promotions/{p['id']}/approve", {}), 503, "storage_unavailable")
        assert tomas.promotion(p["id"])["approval"]["state"] == "pending"
        assert evidence_keys(p["id"]) == [snapshot_key(p["id"], 1)]
        assert titled(mail.messages(), f"Approved: {v} to prod-us") == []
        storage.up()
        assert httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    clear_stage(app_url, "prod-us")


@pytest.mark.parametrize("outage", ["minio-down", "mailpit-down"], ids=["minio-down", "mailpit-down"])
def test_wf_outage_recovery_ledger(browser, app_url, outage):
    base = os.environ["APP_MINIO_DOWN_URL" if outage == "minio-down" else "APP_MAILPIT_DOWN_URL"].rstrip("/")
    shown, hidden = (COPY_STORAGE_DOWN, COPY_MAIL_DOWN) if outage == "minio-down" else (COPY_MAIL_DOWN, COPY_STORAGE_DOWN)
    api = Api(base, "tomas")
    with workspace(browser, base, "tomas") as page:
        ledger = page.get_by_role("region", name="Ledger", exact=True)
        eventually(page, lambda: expect(delivery_queue(page)).to_contain_text(shown, timeout=EXPECT_MS),
                   limit_ms=SWEEP_S * 1000 + REFRESH_LIMIT_MS)
        expect(delivery_queue(page)).not_to_contain_text(hidden)

        def counts_match() -> None:
            status = api.status()
            expect(ledger).to_contain_text(f"Evidence uploads queued: {status['queued_uploads']}", timeout=EXPECT_MS)
            expect(ledger).to_contain_text(f"Notices queued: {status['queued_notices']}", timeout=EXPECT_MS)

        eventually(page, counts_match, limit_ms=DRAIN_S * 1000)
    with workspace(browser, app_url, "tomas") as page:
        advance(page, REFRESH_LIMIT_MS)
        expect(delivery_queue(page)).not_to_contain_text(COPY_STORAGE_DOWN)
        expect(delivery_queue(page)).not_to_contain_text(COPY_MAIL_DOWN)


def test_wf_outage_recovery_watch(browser, app_url, mail):
    bundle = verified_bundle(app_url)
    v = bundle["version"]
    clear_stage(app_url, "prod-eu")
    with relay_copy() as (base, storage, smtp):
        with workspace(browser, base, "kofi") as page:
            ledger = page.get_by_role("region", name="Ledger", exact=True)
            storage.down()
            smtp.down()
            p = prod_request(Api(base, "tomas"), "prod-eu", v)

            def both_down() -> None:
                expect(delivery_queue(page)).to_contain_text(COPY_STORAGE_DOWN, timeout=EXPECT_MS)
                expect(delivery_queue(page)).to_contain_text(COPY_MAIL_DOWN, timeout=EXPECT_MS)

            eventually(page, both_down, limit_ms=SWEEP_S * 1000 + REFRESH_LIMIT_MS)
            storage.up()
            smtp.up()

            def drained() -> None:
                expect(delivery_queue(page)).not_to_contain_text(COPY_STORAGE_DOWN, timeout=EXPECT_MS)
                expect(delivery_queue(page)).not_to_contain_text(COPY_MAIL_DOWN, timeout=EXPECT_MS)
                expect(ledger).to_contain_text(f"Evidence uploads queued: {QUEUE_EMPTY}", timeout=EXPECT_MS)
                expect(ledger).to_contain_text(f"Notices queued: {QUEUE_EMPTY}", timeout=EXPECT_MS)

            eventually(page, drained, limit_ms=(DRAIN_S + SWEEP_S) * 1000 + REFRESH_LIMIT_MS)
        wait_snapshot(p["id"], 1)
        msgs = wait_mail(mail, f"Approval requested: {v} to prod-eu ({PROJECT_NAME})", len(RELEASE_MANAGERS))
        assert recipients(msgs) == rm_emails()
    clear_stage(app_url, "prod-eu")


def licence_allowed(licence: Any) -> bool:
    if isinstance(licence, dict):
        licence = licence.get("type")
    if not isinstance(licence, str):
        return False
    expression = licence.replace("(", "").replace(")", "")
    if " OR " in expression:
        return any(part.strip() in ALLOWED_LICENCES for part in expression.split(" OR "))
    return all(part.strip() in ALLOWED_LICENCES for part in expression.split(" AND "))


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest[field], str) and manifest[field].strip()


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == [], missing
    for font in FONTS:
        assert font in notices, font
    assert re.search("icon", notices, re.I)


def test_if_licences():
    refused = [(p.name, p.version, p.licence) for p in shipped_packages() if not licence_allowed(p.licence)]
    assert refused == [], refused


def test_if_no_extra_datastore():
    names = {p.name for p in shipped_packages()}
    declared = set(json.loads(Path("/app/package.json").read_text()).get("dependencies", {}))
    assert not (names | declared) & set(DATASTORE_PACKAGES), (names | declared) & set(DATASTORE_PACKAGES)


def test_if_service_config(app_url):
    for name in ENV_NAMES:
        assert os.environ.get(name), name
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_if_lockfile():
    lock = json.loads(Path("/app/package-lock.json").read_text())
    declared = json.loads(Path("/app/package.json").read_text()).get("dependencies", {})
    packages = lock.get("packages", {})
    for name in declared:
        assert f"node_modules/{name}" in packages, name


def test_if_same_origin_assets(browser, app_url):
    seen: list[str] = []
    with open_app(browser, f"{app_url}/sign-in") as page:
        page.on("request", lambda request: seen.append(request.url))
        page.reload()
        sign_in_form(page, "tomas")
        expect(page.get_by_role("region", name="Stage graph", exact=True)).to_be_visible(timeout=UI_TIMEOUT)
        advance(page, REFRESH_LIMIT_MS)
    remote = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert seen and remote == [], remote
