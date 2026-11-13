from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

import socket

from conftest import (DEPLOYED_APP, S3, advance, axe, capture, center, click, decode, difference, fill,
                      idempotency_key, layout, licence_allowed, open_app, same_origin, select, session, settle,
                      shipped_packages)

APP = Path("/app")
OUTAGE_URL_ENV = "APP_MINIO_DOWN_URL"
HTTP_TIMEOUT = 30
POLL_S = 30
LIVE_MS = 5000
PW = "pass-1234"
TS0 = 1767225600
BODY_MAX = 1000000
INLINE_MAX = 4096
FILE_MAX = 500000
LOGIN_RATE = 1000
RETARGET_LIMIT = 2
RETRY_MAX = 2
TRAIN_MAX = 6
JOB_TIMEOUT_MS = 60000
ARTIFACT_TTL_MS = 3600000
APPROVAL_MS = 3600000
AUTO_STOP_MS = 3600000
EXPORT_STEP_MS = 100
EXPORT_MAX = 5000000
WEBHOOK_GAPS = [1000, 2000, 4000]
STEP_PX = 24
KICK_FIRST_LOCK_MS = 150
KICK_LAST_LOCK_MS = 450
KICK_TICK_MS = 40
SWIPE_MIN_PX = 80
LONG_PRESS_MS = 500
CARD_HOLD_MS = 200
TOUCH_MIN_PX = 44
GRAPH_ORIGIN = 40
GRAPH_DX = 240
GRAPH_DY = 96
NODE_W = 200
NODE_H = 64
PHONE = (390, 844)
SMALL_PHONE = (375, 812)
TABLET = (768, 1024)
DESK = (1280, 800)
ANIM_MS = {
    "train-step": 300,
    "train-leave": 160,
    "card-settle": 200,
    "job-status": 240,
    "check-flip": 180,
    "sheet-rise": 220,
}
CHECK_NAMES = ["state", "target", "stack", "draft", "conflicts", "rebase", "threads", "approvals", "pipeline",
               "security"]
FIRST_COMMIT = "2fb8c1cda9fb9f60c6a31ab386849d1e1f88d512c877f639f59e90e8c808ba65"
ROOT_TREE = "d0604e08d4be0b90d067bc3f6f5d0d3fc5000d1822a8a487d4db71b94690e941"
README_BLOB = "de5777551c59cba3dac8b9831f889bab03ece9824236e20616ac48bbefdc5594"
BUILD_ONLY = "stages: [build]\nbuild:\n  stage: build\n  script:\n    - print built\n"
ROLES = {"owner": "owner", "dev": "developer", "rev": "developer", "maint": "maintainer", "rep": "reporter",
         "guest": "guest"}
PROTECT_MAIN = {"name": "main", "allowed_to_push": "maintainer", "allowed_to_merge": "developer"}
TAG_TWO = "v0.2.0"
QA_RULE = "QA"
BIG_PATH = "src/big.txt"
NEW_PATH = "new.txt"
EOL_PATH = "eol.txt"
A_TS, B_TS = "src/a.ts", "src/b.ts"
M1_START = "2026-02-02"
M1_DUE = "2026-02-13"
M2_START = "2026-02-09"
M2_DUE = "2026-02-27"
DUE_DATE = "2026-03-01"
UNKNOWN_ACTION = "/frobnicate now"
FEATURE_TEXT = "feature line\n"
MAIN_TEXT = "main line\n"
RESOLVED_TEXT = "resolved line\n"
SUGGESTED_DOC = "first"
DOCS_FEAT = "e1\ne2\ne3\n"
HOOK_MESSAGE = "Hook me"
VAR_TOP, VAR_JOB, VAR_RULE, VAR_PROJ = "top", "job", "rule", "proj"
PROBE_ORIGIN = "http://elsewhere.invalid"
MISSING_ID = 987654321
NEW_BRANCH = "feat-ed"
EDITED_TEXT = "f2\n"
WIKI_TEXT = "rev wins\n"
DISMISS_REASON = "False positive in fixtures"
REVIEW_TEXT = "Please adjust these lines."
OLD_SIX, NEW_SIX = "v6", "w6"
FIX_TITLE, TIDY_TITLE, SHIP_TITLE = "Fix login", "Tidy docs", "Ship export"
DRAG_TITLE = "Drag me"
HIDDEN_PREFIX = "Hidden"
EYEBROW_TRAIN = "// MERGE TRAIN"
EDGES_JS = r"""(root) => Array.from(root.getElementsByTagName('path')).filter((p) => p.hasAttribute('data-from'))
  .map((p) => ({ from: p.getAttribute('data-from'), to: p.getAttribute('data-to'), d: p.getAttribute('d') || '' }))"""

RECORDER = r"""
(() => {
  window.__anim_list = [];
  const remember = (a) => { if (!window.__anim_list.includes(a)) window.__anim_list.push(a); };
  const originalAnimate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = originalAnimate.call(this, keyframes, options);
    remember(animation);
    return animation;
  };
  const originalPlay = Animation.prototype.play;
  Animation.prototype.play = function () {
    remember(this);
    return originalPlay.call(this);
  };
})();
"""
CLEAR_ANIMS = "() => { window.__anim_list = []; window.__anim_skip = new Set(document.getAnimations()); }"
ANIM_ROWS = r"""() => {
  const skip = window.__anim_skip || new Set();
  const all = Array.from(new Set([...(window.__anim_list || []), ...document.getAnimations()]));
  return all.filter((a) => !skip.has(a) && a.playState !== 'idle').map((a) => {
    const effect = a.effect;
    const timing = effect ? effect.getTiming() : {};
    const target = effect && effect.target;
    let dy = null;
    try {
      const frame = effect.getKeyframes()[0] || {};
      const m = typeof frame.transform === 'string' ? frame.transform.match(/translate(?:Y|3d)?\(([^)]*)\)/) : null;
      const nums = m ? m[1].split(',').map((s) => parseFloat(s))
        : (typeof frame.translate === 'string' ? frame.translate.split(/\s+/).map((s) => parseFloat(s)) : []);
      if (nums.length) dy = nums.length > 1 ? nums[1] : nums[0];
    } catch (e) {}
    return {
      id: a.id || '',
      duration: typeof timing.duration === 'number' ? timing.duration : null,
      iterations: timing.iterations === undefined ? 1 : timing.iterations,
      label: target ? (target.getAttribute('aria-label') || (target.textContent || '').trim().slice(0, 80)) : '',
      dy: dy,
    };
  });
}"""
FOCUS_LABEL_JS = r"""() => {
  const e = document.activeElement;
  if (!e) return '';
  const own = e.getAttribute('aria-label');
  if (own) return own;
  const ids = e.getAttribute('aria-labelledby');
  if (ids) return ids.split(/\s+/).map((i) => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
  return (e.innerText || e.value || '').trim();
}"""
FOCUS_ROLE_JS = "() => { const e = document.activeElement; return e.getAttribute('role') || e.tagName.toLowerCase(); }"
WS_OPEN = r"""(args) => new Promise((resolve) => {
  const project = args[0], since = args[1], tag = args[2];
  const url = location.origin.replace(/^http/, 'ws') + '/api/live?project=' + project + '&since=' + since;
  const ws = new WebSocket(url);
  window.__socks = window.__socks || {};
  const rec = { msgs: [], ws: ws };
  window.__socks[tag] = rec;
  ws.onmessage = (e) => rec.msgs.push(JSON.parse(e.data));
  ws.onopen = () => resolve('open');
  ws.onerror = () => resolve('failed');
})"""


def eventually(check: Callable[[], Any], contract: str, seconds: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = check()
        except (AssertionError, KeyError, IndexError, TypeError, httpx.HTTPError):
            value = None
        if value:
            return value
    pytest.fail(f"{contract}: not observed within {seconds} s")


def err(resp: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert resp.status_code == status, f"expected {status} {code}, got {resp.status_code}: {resp.text[:400]}"
    body = resp.json()
    assert set(body) <= {"error", "message", "details"}, f"error body has unpublished keys: {body}"
    assert body["error"] == code, body
    assert isinstance(body["message"], str) and body["message"], body
    if message is not None:
        assert body["message"] == message, body
    return body


def strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def unix(iso: str) -> int:
    return int(dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def blob_id(data: bytes) -> str:
    return hashlib.sha256(b"blob %d\n" % len(data) + data).hexdigest()


def tree_of(files: dict[str, str]) -> str:
    root: dict[str, Any] = {}
    for path, content in files.items():
        node = root
        parts = path.split("/")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = content

    def build(node: dict[str, Any]) -> str:
        entries = []
        for name, value in node.items():
            if isinstance(value, dict):
                entries.append((name, "040000", build(value)))
            else:
                entries.append((name, "100644", blob_id(value.encode())))
        entries.sort(key=lambda e: e[0].encode())
        text = "tree\n" + "".join(f"{mode} {name} {oid}\n" for name, mode, oid in entries)
        return hashlib.sha256(text.encode()).hexdigest()

    return build(root)


def commit_id(tree: str, parents: list[str], author: str, author_ts: int, committer: str, committer_ts: int,
              message: str) -> str:
    text = f"commit\ntree {tree}\n" + "".join(f"parent {p}\n" for p in parents)
    text += f"author {author} {author_ts}\ncommitter {committer} {committer_ts}\n\n{message.rstrip()}"
    return hashlib.sha256(text.encode()).hexdigest()


def hunk_header(a: int, b: int, c: int, d: int) -> str:
    return f"@@ -{a},{b} +{c},{d} @@"


def row_label(n: int, kind: str, path: str) -> str:
    return f"Line {n} {kind}, {path}"


def thread_label(path: str, start: int, end: int | None = None, resolved: bool = False) -> str:
    state = "resolved" if resolved else "unresolved"
    if end is not None:
        return f"Thread on {path} lines {start}-{end}, {state}"
    return f"Thread on {path} line {start}, {state}"


def role_re(text: str) -> str:
    return re.escape(text).replace("/", r"\/")


def thread_on(path: str, line: int) -> re.Pattern[str]:
    return re.compile("^" + role_re(f"Thread on {path} line {line},"))


def check_label(name: str, state: str) -> str:
    return f"Merge check {name}, {state}"


def needs_text(n: int, rules: str) -> str:
    noun = "approval" if n == 1 else "approvals"
    return f"Needs {n} more {noun}: {rules}."


def rule_count(rule: str, given: int, required: int) -> str:
    return f"{rule}: {given} of {required}"


def job_label(name: str, stage: str, status: str, duration: str) -> str:
    return f"Job {name}, stage {stage}, {status}, {duration}"


def graph_label(name: str, stage: str, status: str, needs: list[str]) -> str:
    joined = " and ".join(needs) if needs else "nothing"
    return f"Job {name}, stage {stage}, {status}, needs {joined}"


def car_moved(iid: int, position: int, short: str) -> str:
    return f"!{iid} is now position {position}, testing {short}"


def closes_text(iids: list[int]) -> str:
    if not iids:
        return "Merging closes no issues."
    noun = "issue" if len(iids) == 1 else "issues"
    return f"Merging closes {len(iids)} {noun}: " + ", ".join(f"#{i}" for i in iids) + "."


def url_query(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(page.url).query)


def search(api: Api, scope: str, q: str) -> dict:
    r = api.client.get("/api/search", params={"scope": scope, "q": q})
    assert r.status_code == 200, f"GET /api/search: {r.status_code} {r.text[:400]}"
    return r.json()


class Api:
    def __init__(self, base: str, username: str) -> None:
        self.client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        r = self.client.post("/api/grading/session", json={"username": username})
        assert r.status_code == 200, f"grading session for {username}: {r.status_code} {r.text}"

    def req(self, method: str, path: str, body: Any = None, *, headers: dict[str, str] | None = None,
            content: bytes | None = None) -> httpx.Response:
        kwargs: dict[str, Any] = {}
        if content is not None:
            kwargs["content"] = content
        elif body is not None:
            kwargs["json"] = body
        return self.client.request(method, path, headers=headers, **kwargs)

    def ok(self, method: str, path: str, body: Any = None, status: int = 200, *,
           headers: dict[str, str] | None = None, content: bytes | None = None) -> Any:
        r = self.req(method, path, body, headers=headers, content=content)
        assert r.status_code == status, f"{method} {path}: expected {status}, got {r.status_code}: {r.text[:400]}"
        return r.json() if r.content else {}

    def get(self, path: str) -> Any:
        return self.ok("GET", path)


def grade(base: str, path: str, body: dict) -> dict:
    r = httpx.post(base + path, json=body, timeout=HTTP_TIMEOUT)
    assert r.status_code in (200, 201, 202), f"POST {path}: {r.status_code} {r.text[:400]}"
    return r.json()


def now_ms(base: str) -> int:
    return grade(base, "/api/grading/clock", {"advance_ms": 0})["now_ms"]


def tick(base: str, ms: int) -> dict:
    return grade(base, "/api/grading/clock", {"advance_ms": ms})


def rounds(base: str, pid: int, count: int = 1) -> dict:
    return grade(base, "/api/grading/runner/step", {"project": pid, "count": count})


def run_all(base: str, pid: int) -> dict:
    return grade(base, "/api/grading/runner/settle", {"project": pid})


def storage(base: str, down: bool) -> dict:
    return grade(base, "/api/grading/storage", {"down": down})


def act(action: str, path: str, content: str | None = None) -> dict:
    out: dict[str, Any] = {"action": action, "path": path}
    if content is not None:
        out["content"] = content
    return out


def cm(key: str, branch: str, who: str, actions: list[dict], message: str, start: str | None = None,
       ts: int = TS0) -> dict:
    return {"key": key, "branch": branch, "start_ref": start, "as": who, "timestamp": ts, "message": message,
            "actions": actions}


def mrq(key: str, source: str, author: str, *, target: str = "main", title: str | None = None,
        description: str = "", threads: list[dict] | None = None, state: str = "opened",
        delete_source_branch: bool = False) -> dict:
    return {"key": key, "title": title or f"Request {key}", "source": source, "target": target, "author": author,
            "description": description, "assignees": [], "reviewers": [],
            "delete_source_branch": delete_source_branch, "state": state, "approvals": [],
            "threads": threads or []}


def thr(key: str, author: str, path: str | None, line: int | None, *, resolved: bool = False,
        end_line: int | None = None) -> dict:
    return {"key": key, "author": author, "body": "Rename this.", "path": path, "old_line": None,
            "new_line": line, "end_line": end_line, "resolved": resolved}


def root_thread(w: World, iid: int) -> int:
    return w.api("rev").ok("POST", f"/api/projects/{w.pid}/merge_requests/{iid}/threads",
                           {"body": "Rename this.", "position": None, "pending": False}, status=201)["id"]


def issue(key: str, title: str, author: str, *, description: str = "", labels: list[str] | None = None,
          assignees: list[str] | None = None, milestone: str | None = None, weight: int | None = None,
          confidential: bool = False, state: str = "opened") -> dict:
    return {"key": key, "title": title, "author": author, "description": description, "labels": labels or [],
            "assignees": assignees or [], "milestone": milestone, "weight": weight, "confidential": confidential,
            "state": state}


@dataclass
class World:
    base: str
    t: str
    u: dict[str, str]
    group: str
    sub: str
    path: str
    raw: dict[str, Any]
    p: dict[str, Any]
    clients: dict[str, Api] = field(default_factory=dict)

    @property
    def pid(self) -> int:
        return self.p["id"]

    def api(self, who: str) -> Api:
        name = self.u.get(who, who)
        if name not in self.clients:
            self.clients[name] = Api(self.base, name)
        return self.clients[name]

    def iid(self, key: str) -> int:
        return self.p["merge_requests"][key]["iid"]

    def issue_iid(self, key: str) -> int:
        return self.p["issues"][key]["iid"]


def world(base: str, build: Callable[[str, dict], dict] | None = None, *, zones: dict[str, str] | None = None,
          visibility: str = "private", sub_members: Callable[[dict], list[dict]] | None = None,
          extra: Callable[[str, dict], dict] | None = None) -> World:
    t = uuid.uuid4().hex[:8]
    u = {k: f"{k}{t}" for k in (*ROLES, "out")}
    zones = zones or {}
    group, sub = f"g{t}", f"g{t}/s{t}"
    path = f"{sub}/p{t}"
    built = build(t, u) if build else {}
    project: dict[str, Any] = {"key": "p", "group": sub, "slug": f"p{t}", "visibility": visibility,
                               "default_branch": "main", "protected_branches": [dict(PROTECT_MAIN)]}
    project.update(built)
    project.setdefault("members", [])
    if "commits" not in built:
        project["commits"] = [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First commit")]
    payload: dict[str, Any] = {
        "users": [{"username": name, "password": PW, "time_zone": zones.get(k, "UTC")} for k, name in u.items()],
        "groups": [{"key": "g", "path": group, "visibility": visibility,
                    "members": [{"username": u[k], "role": role} for k, role in ROLES.items()]},
                   {"key": "s", "path": sub, "visibility": visibility,
                    "members": sub_members(u) if sub_members else []}],
        "projects": [project]}
    for key, value in (extra(t, u) if extra else {}).items():
        if isinstance(value, list) and isinstance(payload.get(key), list):
            payload[key] = payload[key] + value
        else:
            payload[key] = value
    r = httpx.post(base + "/api/grading/seed", json=payload, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"seed failed: {r.status_code} {r.text[:600]}"
    raw = r.json()
    return World(base=base, t=t, u=u, group=group, sub=sub, path=path, raw=raw, p=raw["projects"]["p"])


_AUTO = object()


def heads(api: Api, pid: int) -> dict[str, str]:
    return {b["name"]: b["commit"] for b in api.get(f"/api/projects/{pid}/refs")["branches"]}


def api_commit(api: Api, pid: int, branch: str, actions: list[dict], message: str, start_ref: str | None = None,
               base_commit: Any = _AUTO) -> httpx.Response:
    if base_commit is _AUTO:
        known = heads(api, pid)
        base_commit = known.get(branch) or (known.get(start_ref) if start_ref else None)
    body: dict[str, Any] = {"branch": branch, "base_commit": base_commit, "message": message, "actions": actions}
    if start_ref:
        body["start_ref"] = start_ref
    return api.req("POST", f"/api/projects/{pid}/commits", body)


def gpush(w: World, branch: str, who: str, actions: list[dict], message: str,
          start_ref: str | None = None) -> dict:
    known = heads(w.api("owner"), w.pid)
    if branch in known:
        base_commit = known[branch]
    elif start_ref is not None:
        base_commit = known[start_ref]
    else:
        base_commit = None
    body: dict[str, Any] = {"project": w.pid, "branch": branch, "base_commit": base_commit,
                            "as": w.u.get(who, who), "timestamp": now_ms(w.base) // 1000, "message": message,
                            "actions": actions}
    if branch not in known and start_ref:
        body["start_ref"] = start_ref
    r = httpx.post(w.base + "/api/grading/commit", json=body, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"grading commit: {r.status_code} {r.text[:400]}"
    return r.json()


def open_mr(api: Api, pid: int, source: str, title: str, target: str = "main") -> int:
    return api.ok("POST", f"/api/projects/{pid}/merge_requests", {
        "title": title, "source": source, "target": target, "description": "", "assignees": [], "reviewers": [],
        "delete_source_branch": False}, status=201)["iid"]


def mr(api: Api, pid: int, iid: int) -> dict:
    return api.get(f"/api/projects/{pid}/merge_requests/{iid}")


def mr_notes(api: Api, pid: int, iid: int, filter: str = "all") -> list[dict]:
    return api.get(f"/api/projects/{pid}/merge_requests/{iid}/notes?filter={filter}")["notes"]


def note_bodies(notes: list[dict]) -> list[str]:
    return [n["body"] for n in notes]


def threads(api: Api, pid: int, iid: int) -> list[dict]:
    return api.get(f"/api/projects/{pid}/merge_requests/{iid}/threads")["threads"]


def checks(m: dict) -> dict[str, dict]:
    return {c["name"]: c for c in m["checks"]}


def issue_get(api: Api, pid: int, iid: int) -> dict:
    return api.get(f"/api/projects/{pid}/issues/{iid}")


def issue_notes(api: Api, pid: int, iid: int) -> list[str]:
    return note_bodies(api.get(f"/api/projects/{pid}/issues/{iid}/notes")["notes"])


def pipeline(api: Api, plid: int) -> dict:
    return api.get(f"/api/pipelines/{plid}")


def job(p: dict, name: str) -> dict:
    found = [j for j in p["jobs"] if j["name"] == name]
    assert found, f"pipeline {p['id']} has no job {name}: {[j['name'] for j in p['jobs']]}"
    return max(found, key=lambda j: j["id"])


def log_lines(api: Api, job_id: int) -> list[str]:
    return api.get(f"/api/jobs/{job_id}/log")["lines"]


def log_texts(api: Api, job_id: int) -> list[str]:
    return [line.split(" ", 2)[2] if line.count(" ") >= 2 else line for line in log_lines(api, job_id)]


def environment(api: Api, pid: int, name: str) -> dict:
    listed = api.get(f"/api/projects/{pid}/environments")
    items = listed["environments"] if isinstance(listed, dict) else listed
    found = [e for e in items if e["name"] == name]
    assert found, f"no environment {name}: {[e['name'] for e in items]}"
    return api.get(f"/api/projects/{pid}/environments/{found[0]['id']}")


def s3_wait(key: str, present: bool = True, seconds: float = POLL_S) -> None:
    def seen() -> bool:
        return (key in S3().keys(prefix=key)) == present

    eventually(seen, f"object {key} {'stored' if present else 'removed'} in MinIO", seconds)


@contextlib.contextmanager
def as_user(browser: Browser, base: str, username: str, path: str, *, reduced: bool = False,
            size: tuple[int, int] = DESK, record: bool = False, touch: bool = False) -> Iterator[Page]:
    with open_app(browser, base + "/sign-in", reduced_motion="reduce" if reduced else "no-preference") as page:
        r = page.request.post(base + "/api/grading/session", data=json.dumps({"username": username}),
                              headers={"Content-Type": "application/json"})
        assert r.ok, f"grading session for {username}: {r.status}"
        page.context.add_init_script(RECORDER)
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if touch:
            enable_touch(page)
        page.goto(base + path)
        yield page


def anims(page: Page, ids: list[str]) -> list[dict]:
    rows = page.evaluate(ANIM_ROWS)
    return [a for a in rows if a["id"] in ids]


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements")


def announced(page: Page, text: Any) -> None:
    expect(announcements(page)).to_contain_text(text, timeout=LIVE_MS)


def focused_label(page: Page) -> str:
    return page.evaluate(FOCUS_LABEL_JS)


def focused_role(page: Page) -> str:
    return page.evaluate(FOCUS_ROLE_JS)


def tab_until(page: Page, name: str, presses: int = 40) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if focused_label(page) == name:
            return
    pytest.fail(f"Tab never reached {name!r}; the published control must be keyboard reachable")


def in_view(locator: Locator, width: int) -> bool:
    if not locator.is_visible():
        return False
    box = locator.bounding_box()
    return box is not None and box["x"] + box["width"] > 0 and box["x"] < width


def middle(locator: Locator) -> tuple[float, float]:
    return center(locator)


def enable_touch(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    return cdp


def touch(cdp: Any, kind: str, x: float | None = None, y: float | None = None) -> None:
    points = [] if kind == "touchEnd" else [{"x": x, "y": y, "id": 0}]
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def test_health_status(app_url: str) -> None:
    base = app_url.rstrip("/")
    r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    try:
        storage(base, True)
        down = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
        assert down.status_code == 200 and down.json() == {"status": "unavailable"}
    finally:
        storage(base, False)
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_grading_routes(app_url: str) -> None:
    base = app_url.rstrip("/")
    t = uuid.uuid4().hex[:8]
    name = f"seedbad{t}"
    bad = {"users": [{"username": name, "password": PW, "time_zone": "UTC"}],
           "groups": [{"key": "g", "path": f"orphan{t}/child", "visibility": "private", "members": []}]}
    err(httpx.post(base + "/api/grading/seed", json=bad, timeout=HTTP_TIMEOUT), 422, "validation")
    err(httpx.post(base + "/api/session", json={"username": name, "password": PW}, timeout=HTTP_TIMEOUT), 401,
        "bad_credentials", "Username or password is wrong.")
    w = world(base)
    assert w.u["owner"] in w.raw["users"] and w.raw["groups"]["s"]["path"] == w.sub
    assert w.p["path"] == w.path and re.fullmatch(r"[0-9a-f]{64}", w.p["commits"]["c1"])
    assert isinstance(w.p["seq"], int)
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    r = client.post("/api/grading/session", json={"username": w.u["dev"]})
    assert r.status_code == 200 and r.json()["user"]["username"] == w.u["dev"]
    assert client.cookies.get("spur_session")
    assert client.get("/api/me").json()["user"]["username"] == w.u["dev"]
    before = grade(base, "/api/grading/clock", {"advance_ms": 0})
    after = grade(base, "/api/grading/clock", {"advance_ms": 1500})
    assert after["now_ms"] == before["now_ms"] + 1500
    stamp = dt.datetime.fromtimestamp(after["now_ms"] // 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    assert after["now"] == f"{stamp}.{after['now_ms'] % 1000:03d}Z"
    assert grade(base, "/api/grading/clock", {"set_ms": after["now_ms"]})["now_ms"] == after["now_ms"]
    step = rounds(base, w.pid, 3)
    assert step["rounds"] == 3 and isinstance(step["jobs"], list) and isinstance(step["seq"], int)
    assert run_all(base, w.pid)["rounds"] <= 500
    try:
        assert storage(base, True) == {"storage": "down"}
    finally:
        assert storage(base, False) == {"storage": "up"}
    sink = f"{base}/api/grading/sink/probe{t}"
    posted = httpx.post(sink + "?status=202", content=b"raw body", headers={"X-Probe": "yes"}, timeout=HTTP_TIMEOUT)
    assert posted.status_code == 202
    seen = httpx.get(sink, timeout=HTTP_TIMEOUT).json()["requests"]
    assert len(seen) == 1 and seen[0]["body"] == "raw body" and seen[0]["headers"]["x-probe"] == "yes"
    assert isinstance(seen[0]["received_at_ms"], int)
    assert httpx.put(sink, json={"status": 503}, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.post(sink, content=b"again", timeout=HTTP_TIMEOUT).status_code == 503


GRADING_OFF_ROUTES = [("POST", "/api/grading/seed"), ("POST", "/api/grading/session"),
                      ("POST", "/api/grading/clock"), ("POST", "/api/grading/commit"),
                      ("POST", "/api/grading/runner/step"), ("POST", "/api/grading/runner/settle"),
                      ("POST", "/api/grading/storage"), ("POST", "/api/grading/sink/probe"),
                      ("PUT", "/api/grading/sink/probe"), ("GET", "/api/grading/sink/probe")]


def test_grading_routes_off(tmp_path: Path) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if k != "SPUR_GRADING"}
    env["APP_PUBLIC_PORT"] = str(port)
    env["DATABASE_URL"] = "postgres://nobody:nopass@127.0.0.1:9/none"
    serve = json.loads((APP / "run.json").read_text())["serve"]
    log = tmp_path / "off.log"
    with log.open("w") as out:
        proc = subprocess.Popen("exec " + serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=out,
                                stderr=subprocess.STDOUT)
        try:
            base = f"http://127.0.0.1:{port}"
            eventually(lambda: httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).status_code > 0,
                       "the copy without SPUR_GRADING listens (log tail: " + log.read_text()[-400:] + ")")
            for method, path in GRADING_OFF_ROUTES:
                r = httpx.request(method, base + path, json={}, timeout=HTTP_TIMEOUT)
                assert r.status_code == 404, f"{method} {path} answered {r.status_code} without SPUR_GRADING"
        finally:
            proc.terminate()
            proc.wait(timeout=HTTP_TIMEOUT)


def test_accounts_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    t = uuid.uuid4().hex[:8]
    name = f"acct{t}"
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    short = err(anon.post("/api/users", json={"username": "ab", "password": PW}), 422, "validation",
                "Username must be 3 to 24 characters: a-z, 0-9 and _.")
    assert short["details"]["fields"]["username"] == short["message"]
    err(anon.post("/api/users", json={"username": "bad name!", "password": PW}), 422, "validation",
        "Username must be 3 to 24 characters: a-z, 0-9 and _.")
    err(anon.post("/api/users", json={"username": name, "password": "short"}), 422, "validation",
        "Password must be at least 8 characters.")
    created = anon.post("/api/users", json={"username": name, "password": PW})
    assert created.status_code == 201, created.text
    user = created.json()["user"]
    assert user["username"] == name and user["time_zone"] == "UTC" and isinstance(user["id"], int)
    cookie = [c for c in created.headers.get_list("set-cookie") if c.startswith("spur_session=")]
    assert cookie, "sign-up must set the spur_session cookie"
    attrs = [a.strip().lower() for a in cookie[0].split(";")[1:]]
    assert "HttpOnly".lower() in attrs and "SameSite=Lax".lower() in attrs and "Secure".lower() not in attrs
    assert anon.get("/api/me").json()["user"]["username"] == name
    err(httpx.post(base + "/api/users", json={"username": name, "password": PW}, timeout=HTTP_TIMEOUT), 409,
        "username_taken", "That username is taken.")
    assert anon.delete("/api/session").status_code == 204
    err(anon.get("/api/me"), 401, "unauthenticated", "Sign in to continue.")
    err(httpx.post(base + "/api/session", json={"username": name, "password": "wrong-password"},
                   timeout=HTTP_TIMEOUT), 401, "bad_credentials", "Username or password is wrong.")
    err(httpx.post(base + "/api/session", json={"username": f"nobody{t}", "password": PW}, timeout=HTTP_TIMEOUT),
        401, "bad_credentials", "Username or password is wrong.")
    signed = anon.post("/api/session", json={"username": name, "password": PW})
    assert signed.status_code == 200 and signed.json()["user"]["username"] == name
    assert anon.get("/api/me").status_code == 200
    patched = anon.patch("/api/me", json={"time_zone": "Europe/Berlin"})
    assert patched.status_code == 200 and patched.json()["user"]["time_zone"] == "Europe/Berlin"
    assert anon.get("/api/me").json()["user"]["time_zone"] == "Europe/Berlin"
    err(anon.patch("/api/me", json={"time_zone": "Mars/Base"}), 422, "validation")
    fresh = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    err(fresh.get(f"/api/projects/{MISSING_ID}"), 401, "unauthenticated", "Sign in to continue.")
    page = fresh.get("/", follow_redirects=False)
    assert 300 <= page.status_code < 400 and page.headers["location"].split("?")[0].rstrip("/").endswith("/sign-in")
    assert fresh.get("/sign-in").status_code == 200
    assert fresh.get("/api/health").status_code == 200


def test_wf_cross_cutting_sign_in_pages(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    with open_app(browser, base + "/sign-in") as page:
        fill(page.get_by_role("textbox", name="Username"), w.u["dev"])
        fill(page.get_by_role("textbox", name="Password"), PW)
        click(page.get_by_role("button", name="Sign in"))
        expect(page).to_have_url(base + "/")
        expect(page.get_by_role("heading", name="Your projects")).to_be_focused()
        expect(page.get_by_role("list", name="Projects")).to_be_visible()
    name = f"su{w.t}"
    with open_app(browser, base + "/sign-up") as page:
        fill(page.get_by_role("textbox", name="Username"), name)
        fill(page.get_by_role("textbox", name="Password"), PW)
        click(page.get_by_role("button", name="Create account"))
        eventually(lambda: page.request.get(base + "/api/me").ok and
                   page.request.get(base + "/api/me").json()["user"]["username"] == name,
                   "sign-up page leaves the browser signed in")
    ok = httpx.post(base + "/api/session", json={"username": name, "password": PW}, timeout=HTTP_TIMEOUT)
    assert ok.status_code == 200


def test_error_shape_and_precedence(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First commit"),
        cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")]})
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    json_header = {"Content-Type": "application/json"}
    err(anon.post("/api/session", content=b"{" + b"x" * BODY_MAX, headers=json_header), 413, "payload_too_large",
        f"Request body is too large ({BODY_MAX} bytes at most).")
    err(anon.patch("/api/me", content=b"{", headers=json_header), 400, "bad_request",
        "The request body isn't valid JSON.")
    err(anon.patch("/api/me", json={"time_zone": "UTC"}), 401, "unauthenticated", "Sign in to continue.")
    err(anon.get(f"/api/projects/{w.pid}"), 401, "unauthenticated")
    err(w.api("out").req("PATCH", f"/api/projects/{w.pid}/settings", {"merge_method": "bogus"}), 404, "not_found",
        "Not found.")
    err(w.api("dev").req("PATCH", f"/api/projects/{w.pid}/settings", {"merge_method": "bogus"}), 403, "forbidden",
        "You don't have permission to do that.")
    body = err(w.api("owner").req("PATCH", f"/api/projects/{w.pid}/settings", {"merge_method": "bogus"}), 422,
               "validation")
    assert "merge_method" in body["details"]["fields"] and body["message"] in body["details"]["fields"].values()
    err(w.api("owner").req("POST", f"/api/projects/{w.pid}/audit", {}), 405, "method_not_allowed",
        "This method isn't allowed here.")
    dev = w.api("dev")
    head = heads(dev, w.pid)["feat"]
    key = idempotency_key()
    payload = {"branch": "feat", "base_commit": head, "message": "Keyed", "actions": [act("create", "k.txt", "k\n")]}
    first = dev.req("POST", f"/api/projects/{w.pid}/commits", payload, headers={"Idempotency-Key": key})
    assert first.status_code == 201, first.text
    replay = dev.req("POST", f"/api/projects/{w.pid}/commits", payload, headers={"Idempotency-Key": key})
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replay") == "true"
    assert heads(dev, w.pid)["feat"] == first.json()["commit"]
    err(dev.req("POST", f"/api/projects/{w.pid}/commits", dict(payload, message="Other"),
                headers={"Idempotency-Key": key}), 409, "idempotency_conflict",
        "This idempotency key was used with a different request.")


def test_live_socket_sequence(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    start = w.p["seq"]
    with as_user(browser, base, w.u["owner"], "/") as page, as_user(browser, base, w.u["out"], "/") as outsider:
        assert page.evaluate(WS_OPEN, [w.pid, start, "a"]) == "open"
        dev = w.api("dev")
        one = dev.ok("POST", f"/api/projects/{w.pid}/issues", {"title": "Live one"}, status=201)
        two = dev.ok("POST", f"/api/projects/{w.pid}/issues/{one['iid']}/notes", {"body": "Live two"}, status=201)
        assert two["seq"] > one["seq"] > start

        def collected(tag: str) -> list[dict]:
            return page.evaluate("(tag) => window.__socks[tag].msgs", tag)

        eventually(lambda: any(m.get("seq") == two["seq"] for m in collected("a")), "message for the second write")
        seqs = [m["seq"] for m in collected("a") if "seq" in m]
        assert seqs == list(range(seqs[0], seqs[-1] + 1)), f"seq must count up by one: {seqs}"
        first = [m for m in collected("a") if m.get("seq") == one["seq"]]
        assert len(first) == 1 and first[0]["type"] == "issue"
        assert page.evaluate(WS_OPEN, [w.pid, start, "b"]) == "open"
        eventually(lambda: any(m.get("seq") == two["seq"] for m in collected("b")), "reconnect replays missed messages")
        assert [m["seq"] for m in collected("b") if "seq" in m][:len(seqs)] == seqs
        assert outsider.evaluate(WS_OPEN, [w.pid, 0, "x"]) == "failed"


def test_wf_cross_cutting_settle_signal(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = review_world(base)
    iid = w.iid("mr1")
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}") as page:
        main = page.get_by_role("main")
        expect(main).to_have_attribute("data-pending", "0")
        made = w.api("rev").ok("POST", f"/api/projects/{w.pid}/merge_requests/{iid}/threads",
                               {"body": "Live note", "position": None, "pending": False}, status=201)
        eventually(lambda: int(main.get_attribute("data-seq") or 0) >= made["seq"],
                   "data-seq reaches the seq returned by the write")
        expect(page.get_by_role("article", name="Thread on merge request, unresolved")).to_be_visible(
            timeout=LIVE_MS)
        done = w.api("rev").ok("PATCH", f"/api/projects/{w.pid}/merge_requests/{iid}/threads/{made['id']}",
                               {"resolved": True})
        eventually(lambda: int(main.get_attribute("data-seq") or 0) >= done["seq"] > made["seq"],
                   "data-seq follows the resolve write")
        expect(main).to_have_attribute("data-pending", "0")


def test_body_and_file_limits(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First commit"),
        cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")]})
    dev = w.api("dev")
    prefix = b'{"time_zone":"UTC","pad":"'
    suffix = b'"}'
    exact = prefix + b"a" * (BODY_MAX - len(prefix) - len(suffix)) + suffix
    assert len(exact) == BODY_MAX
    r = dev.req("PATCH", "/api/me", content=exact, headers={"Content-Type": "application/json"})
    assert r.status_code != 413, f"a body of exactly {BODY_MAX} bytes must be allowed: {r.status_code}"
    over = prefix + b"a" * (BODY_MAX + 1 - len(prefix) - len(suffix)) + suffix
    err(dev.req("PATCH", "/api/me", content=over, headers={"Content-Type": "application/json"}), 413,
        "payload_too_large", f"Request body is too large ({BODY_MAX} bytes at most).")
    content = "a" * FILE_MAX
    r = api_commit(dev, w.pid, "feat", [act("create", "big.txt", content)], "Big file")
    assert r.status_code == 201, r.text
    s3_wait(f"blobs/{blob_id(content.encode())}")
    assert S3().get(f"blobs/{blob_id(content.encode())}") == content.encode()
    before = heads(dev, w.pid)["feat"]
    err(api_commit(dev, w.pid, "feat", [act("create", "big2.txt", content + "a")], "Too big"), 413,
        "payload_too_large", f"File big2.txt is too large ({FILE_MAX} bytes at most).")
    assert heads(dev, w.pid)["feat"] == before


def test_login_rate_limit(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    name = w.u["dev"]

    def attempt(_: int) -> int:
        return httpx.post(base + "/api/session", json={"username": name, "password": "wrong-password"},
                          timeout=HTTP_TIMEOUT).status_code

    with ThreadPoolExecutor(16) as pool:
        codes = list(pool.map(attempt, range(LOGIN_RATE)))
    assert set(codes) == {401}, sorted(set(codes))
    body = err(httpx.post(base + "/api/session", json={"username": name, "password": PW}, timeout=HTTP_TIMEOUT),
               429, "rate_limited")
    assert re.fullmatch(r"Too many requests\. Try again in \d+ seconds\.", body["message"]), body


def test_server_never_leaks(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")
               if os.environ.get(k)]
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    for path in ("/run.json", "/package.json", "/.env", "/src/server.ts", "/tsconfig.json"):
        r = anon.get(path)
        assert "run-manifest-v1" not in r.text, path
        for value in secrets:
            assert value not in r.text, path
    r = w.api("owner").req("GET", f"/api/projects/{w.pid}", headers={"Origin": PROBE_ORIGIN})
    assert not [v for v in r.headers.values() if v in (PROBE_ORIGIN, "*")], "cross-origin access was granted"
    with as_user(browser, base, w.u["owner"], "/") as page:
        foreign: list[str] = []
        page.on("request", lambda q: foreign.append(q.url) if not same_origin(q.url, base) and
                q.url.startswith("http") else None)
        page.goto(base + f"/projects/{w.pid}")
        expect(page.get_by_role("main")).to_be_visible()
        assert not foreign, f"page loaded external origins: {foreign}"
        assert page.evaluate("async () => navigator.serviceWorker ? "
                             "(await navigator.serviceWorker.getRegistrations()).length : 0") == 0
        assets = page.evaluate("() => [...document.scripts].map(s => s.src).concat("
                               "[...document.querySelectorAll('link[href]')].map(l => l.href)).filter(Boolean)")
    for url in assets:
        text = httpx.get(url, timeout=HTTP_TIMEOUT).text
        for value in secrets:
            assert value not in text, f"secret value served in {url}"


def test_storage_outage_and_recovery(browser: Browser, app_url: str) -> None:
    down = os.environ[OUTAGE_URL_ENV].rstrip("/")
    w = world(down, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First commit"),
        cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")]})
    dev = w.api("dev")
    before = heads(dev, w.pid)["feat"]
    err(api_commit(dev, w.pid, "feat", [act("create", "large.txt", "b" * (INLINE_MAX + 1))], "Large"), 503,
        "storage_unavailable", "File storage is unavailable. Nothing was committed. Try again in a moment.")
    assert heads(dev, w.pid)["feat"] == before
    assert api_commit(dev, w.pid, "feat", [act("create", "small.txt", "s\n")], "Small").status_code == 201
    with as_user(browser, down, w.u["dev"], f"/projects/{w.pid}") as page:
        expect(page.get_by_role("region", name="Instance status")).to_contain_text(
            "File storage is unavailable. Uploads, artifacts and exports are paused.")
    base = app_url.rstrip("/")
    p = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First commit"),
        cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")]})
    large = "c" * (INLINE_MAX + 1) + p.t
    try:
        storage(base, True)
        err(api_commit(p.api("dev"), p.pid, "feat", [act("create", "large.txt", large)], "Large"), 503,
            "storage_unavailable")
    finally:
        storage(base, False)
    assert api_commit(p.api("dev"), p.pid, "feat", [act("create", "large.txt", large)], "Large").status_code == 201
    s3_wait(f"blobs/{blob_id(large.encode())}")


def home_world(base: str) -> World:
    def build(t: str, u: dict) -> dict:
        return {"commits": [
            cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First commit"),
            cm("c2", "main", u["owner"], [act("create", "spurline.pipeline.yml", BUILD_ONLY)], "Add pipeline",
               ts=TS0 + 10),
            cm("c3", "fa", u["dev"], [act("create", "a.txt", "a\n")], "A", start="main"),
            cm("c4", "fb", u["dev"], [act("create", "b.txt", "b\n")], "B", start="main"),
            cm("c5", "fc", u["dev"], [act("create", "c.txt", "c\n")], "C", start="main")],
            "tags": [{"name": "v0.1.0", "commit": "c1", "message": "First tagged build.", "as": u["owner"]},
                     {"name": TAG_TWO, "commit": "c2", "message": "Second build.", "as": u["owner"]}],
            "pipelines": [{"key": "pl1", "ref": "main", "commit": "c2", "jobs": {"build": "success"}},
                          {"key": "pl2", "ref": "main", "commit": "c2", "jobs": {"build": "failed"}}],
            "merge_requests": [mrq("mr1", "fa", u["dev"]), mrq("mr2", "fb", u["dev"]),
                               mrq("mr3", "fc", u["dev"], state="closed")],
            "issues": [issue("i1", "One", u["owner"]), issue("i2", "Two", u["owner"]),
                       issue("i3", "Three", u["owner"]), issue("i4", "Four", u["owner"], state="closed")]}
    return world(base, build)


def test_shell_and_project_home_components(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = home_world(base)
    for title in ("Act one", "Act two", "Act three"):
        w.api("owner").ok("POST", f"/api/projects/{w.pid}/issues", {"title": title}, status=201)
    c2 = w.p["commits"]["c2"]
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}") as page:
        expect(page.get_by_role("region", name="Instance status")).to_be_visible()
        expect(page.get_by_role("banner")).to_be_visible()
        expect(page.get_by_role("link", name="Spurline home")).to_contain_text("Spurline")
        expect(page.get_by_role("button", name="Switch group")).to_be_visible()
        expect(page.get_by_role("searchbox", name="Search")).to_be_visible()
        expect(page.get_by_role("button", name="Account")).to_be_visible()
        hero = page.get_by_role("heading", level=1)
        expect(hero).to_be_visible()
        still = decode(capture(hero))
        advance(page, LIVE_MS)
        assert difference(still, decode(capture(hero))) < 0.01, "the project hero dot field must stay static"
        assert page.evaluate("() => document.getAnimations().filter((a) => a.effect && "
                             "a.effect.getTiming().iterations === Infinity).length") == 0
        bar = page.get_by_role("link", name="Open a merge request")
        expect(bar).to_contain_text(re.compile(r"Open a merge request\s*→"))
        expect(page.get_by_role("link", name=f"Latest tag {TAG_TWO}")).to_be_visible()
        branch, status = "main", "failed"
        tile = page.get_by_role("link", name=f"Latest pipeline on {branch}: {status}")
        expect(tile).to_contain_text(c2[:7])
        health = page.get_by_role("region", name="Project health")
        expect(health.get_by_role("group", name="Open merge requests")).to_contain_text(re.compile(r"(?<!\d)2(?!\d)"))
        expect(health.get_by_role("group", name="Pipelines passed")).to_contain_text(re.compile(r"(?<!\d)50(?!\d)"))
        expect(health.get_by_role("group", name="Open issues")).to_contain_text(re.compile(r"(?<!\d)6(?!\d)"))
        notes = page.get_by_role("region", name="Release notes")
        expect(notes).to_contain_text("1 / 2")
        click(notes.get_by_role("button", name="Next release"))
        expect(notes).to_contain_text("2 / 2")
        click(notes.get_by_role("button", name="Next release"))
        expect(notes).to_contain_text("1 / 2")
        notes.get_by_role("button", name="Previous release").focus()
        page.keyboard.press("ArrowLeft")
        expect(notes).to_contain_text("2 / 2")
        page.keyboard.press("ArrowRight")
        expect(notes).to_contain_text("1 / 2")
        expect(page.get_by_role("list", name="Recent activity").get_by_role("listitem")).to_have_count(3)
        footer = page.get_by_role("contentinfo")
        expect(footer).to_contain_text("Coldbrook Signal Works · Spurline")
        for column in ("Work", "Delivery", "Planning", "Account"):
            expect(footer).to_contain_text(column)
        expect(announcements(page)).to_have_count(1)
        expect(page.get_by_role("region", name="Notifications")).to_have_count(1)
        axe(page)
        click(bar)
        expect(page).to_have_url(base + f"/projects/{w.pid}/-/merge_requests/new")
        page.goto(base + f"/projects/{w.pid}/-/settings")
        for name in ("Protected branches", "Protected tags", "Push rules", "Approval rules", "Merge settings",
                     "Protected environments", "Project variables", "Members", "Webhooks"):
            expect(page.get_by_role("region", name=name)).to_have_count(1)


def test_dialogs_regions_and_form_errors(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    inside = "() => !!document.activeElement.closest('[role=dialog],dialog')"
    landmark = ("() => { const l = document.activeElement.closest('header,[role=banner],main,[role=main],"
                "footer,[role=contentinfo]'); return l ? (l.getAttribute('role') || l.tagName.toLowerCase()) : ''; }")
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}") as page:
        opener = page.get_by_role("button", name="Switch group")
        click(opener)
        expect(page.get_by_role("dialog", name="Groups")).to_be_visible()
        for _ in range(12):
            page.keyboard.press("Tab")
            assert page.evaluate(inside), "Tab left dialog Groups"
        for _ in range(12):
            page.keyboard.press("Shift+Tab")
            assert page.evaluate(inside), "Shift+Tab left dialog Groups"
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog", name="Groups")).to_have_count(0)
        expect(opener).to_be_focused()
        page.get_by_role("link", name="Spurline home").focus()
        seen = []
        for _ in range(3):
            page.keyboard.press("F6")
            seen.append(page.evaluate(landmark))
        assert seen == ["main", "footer", "header"] or seen == ["main", "contentinfo", "banner"], seen
        page.keyboard.press("Shift+F6")
        assert page.evaluate(landmark) in ("footer", "contentinfo")
        page.goto(base + f"/projects/{w.pid}/-/merge_requests/new")
        click(page.get_by_role("button", name="Create merge request"))
        summary = page.get_by_role("alert")
        expect(summary.get_by_role("heading", name="Fix these problems:")).to_be_visible()
        expect(summary.get_by_role("link", name="Title can't be blank.")).to_be_visible()
        expect(page.get_by_role("textbox", name="Title")).to_have_accessible_description(
            re.compile("Title can't be blank."))


MOTION_MODES = ["motion", "reduced"]


@pytest.mark.parametrize("mode", MOTION_MODES, ids=MOTION_MODES)
def test_published_animations(browser: Browser, app_url: str, mode: str) -> None:
    base = app_url.rstrip("/")
    reduced = mode == "reduced"
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n"),
                                                   act("create", "spurline.pipeline.yml", BUILD_ONLY)], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])],
        "labels": [{"name": "workflow::doing", "description": ""}, {"name": "workflow::review", "description": ""}],
        "issues": [issue("i1", "Settle me", u["owner"], labels=["workflow::doing"])],
        "boards": [{"key": "b1", "name": "Development", "kind": "label",
                    "lists": ["workflow::doing", "workflow::review"]}]})
    tid = root_thread(w, w.iid("mr1"))
    ids = list(ANIM_MS)
    mr_path = f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}"
    seen: list[dict] = []

    def expect_anim(page: Page, anim_id: str, label_start: str) -> None:
        found = [a for a in anims(page, ids) if a["id"] == anim_id]
        seen.extend(anims(page, ids))
        if reduced:
            assert not found, f"{anim_id} ran under reduced motion: {found}"
        else:
            assert any(a["duration"] == ANIM_MS[anim_id] and a["label"].startswith(label_start) for a in found), \
                f"{anim_id} on {label_start!r} with {ANIM_MS[anim_id]} ms: {found}"

    with as_user(browser, base, w.u["owner"], mr_path, reduced=reduced, record=True) as page:
        checks_region = page.get_by_role("region", name="Merge checks")
        expect(checks_region.get_by_role("listitem", name="Merge check threads, failed")).to_be_visible()
        page.evaluate(CLEAR_ANIMS)
        w.api("rev").ok("PATCH", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/threads/{tid}",
                        {"resolved": True})
        expect(checks_region.get_by_role("listitem", name="Merge check threads, passed")).to_be_visible(
            timeout=LIVE_MS)
        expect_anim(page, "check-flip", "Merge check threads")

        res = gpush(w, "main", "owner", [act("create", "g.txt", "g\n")], "Run")
        page.goto(base + f"/projects/{w.pid}/-/pipelines/{res['pipeline']['id']}")
        graph = page.get_by_role("group", name="Pipeline graph")
        expect(graph.get_by_role("button", name=re.compile(r"^Job build, stage build, pending"))).to_be_visible()
        page.evaluate(CLEAR_ANIMS)
        rounds(base, w.pid, 1)
        expect(graph.get_by_role("button", name=re.compile(r"^Job build, stage build, success"))).to_be_visible(
            timeout=LIVE_MS)
        expect_anim(page, "job-status", "Job build")

        page.goto(base + f"/projects/{w.pid}/-/boards/{w.p['boards']['b1']['id']}")
        card = page.get_by_role("listitem", name=re.compile(r"^Issue #\d+, Settle me"))
        card.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.evaluate(CLEAR_ANIMS)
        page.keyboard.press("Space")
        expect(card).to_have_accessible_name(re.compile(r"in workflow::review$"))
        expect(card).to_be_focused()
        expect_anim(page, "card-settle", "Issue #")

        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.goto(base + mr_path)
        page.evaluate(CLEAR_ANIMS)
        opener = page.get_by_role("button", name="Open panel")
        click(opener)
        sheet = page.get_by_role("dialog", name="Panel")
        expect(sheet).to_be_visible()
        found = [a for a in anims(page, ids) if a["id"] == "sheet-rise"]
        seen.extend(found)
        if reduced:
            assert not found and sheet.evaluate("el => el.getAnimations().length") == 0
            box = sheet.bounding_box()
            assert box and box["y"] + box["height"] <= PHONE[1] + 1, "sheet not in place at once"
        else:
            assert any(a["duration"] == ANIM_MS["sheet-rise"] for a in found), found
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
    for a in seen:
        assert a["iterations"] == 1, f"{a['id']} loops: {a}"


BIG = "".join(f"line {i:02d}\n" for i in range(1, 31))
BIG_FEAT = BIG.replace("line 05\n", "changed 05\n").replace("line 12\n", "changed 12\n").replace("line 25\n", "")


def diff_world(base: str) -> World:
    return world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", BIG_PATH, BIG), act("create", EOL_PATH, "a\nb\n")],
                       "First"),
                    cm("c2", "feat", u["dev"], [act("update", BIG_PATH, BIG_FEAT), act("update", EOL_PATH, "a\nb"),
                                                act("create", NEW_PATH, "x\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})


def test_diff_hunks_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = diff_world(base)
    body = w.api("rev").get(f"/api/projects/{w.pid}/compare?from=main&to=feat")
    files = {d["path"]: d for d in body["diffs"]}
    big = files[BIG_PATH]
    assert big["status"] == "modified"
    big_headers = [hunk_header(2, 14, 2, 14), hunk_header(22, 7, 22, 6)]
    assert [h["header"] for h in big["hunks"]] == big_headers
    kinds = [ln["type"] for ln in big["hunks"][0]["lines"]]
    assert kinds == ["context"] * 3 + ["del", "add"] + ["context"] * 6 + ["del", "add"] + ["context"] * 3
    removed = big["hunks"][0]["lines"][3]
    assert removed["old"] == 5 and removed["text"] == BIG.splitlines()[4]
    assert [ln["type"] for ln in big["hunks"][1]["lines"]] == ["context"] * 3 + ["del"] + ["context"] * 3
    assert files[NEW_PATH]["status"] == "added" and files[NEW_PATH]["hunks"][0]["header"] == hunk_header(0, 0, 1, 1)
    eol = files.get(EOL_PATH, {"hunks": []})
    assert not [ln for h in eol["hunks"] for ln in h["lines"] if ln["type"] != "context"]
    same = w.api("rev").get(f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/diff?from=target&to=1")
    assert [h["header"] for d in same["diffs"] if d["path"] == BIG_PATH for h in d["hunks"]] == big_headers


def test_wf_review_keyboard_views_url(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", BIG_PATH, BIG)], "First"),
                    cm("c2", "feat", u["dev"], [act("update", BIG_PATH, BIG_FEAT)], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    root = f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}/changes"
    with as_user(browser, base, w.u["rev"], root + "?" + urlencode({"file": BIG_PATH, "line": 12,
                                                                    "view": "inline"})) as page:
        grid = page.get_by_role("grid", name="Diff")
        expect(grid.get_by_role("row", name=row_label(12, "added", BIG_PATH), exact=True)).to_be_focused()
        length = page.evaluate("() => history.length")
        page.keyboard.press("j")
        expect(grid.get_by_role("row", name=row_label(13, "unchanged", BIG_PATH), exact=True)).to_be_focused()
        eventually(lambda: url_query(page).get("line") == ["13"], "the focused line is kept in the URL")
        assert page.evaluate("() => history.length") == length
        first = grid.get_by_role("row", name=row_label(1, "unchanged", BIG_PATH), exact=True)
        expect(first).to_have_count(0)
        click(page.get_by_role("button", name="Expand context above").first)
        expect(first).to_have_count(1)
        tail = grid.get_by_role("row", name=row_label(29, "unchanged", BIG_PATH), exact=True)
        expect(tail).to_have_count(0)
        click(page.get_by_role("button", name="Expand context below").last)
        expect(tail).to_have_count(1)
        split = page.get_by_role("button", name="Side-by-side view")
        click(split)
        expect(split).to_have_attribute("aria-pressed", "true")
        expect(page.get_by_role("button", name="Inline view")).to_have_attribute("aria-pressed", "false")
        eventually(lambda: url_query(page).get("view") == ["split"], "the view is kept in the URL")
        page.reload()
        expect(page.get_by_role("button", name="Side-by-side view")).to_have_attribute("aria-pressed", "true")
        expect(grid.get_by_role("row", name=row_label(5, "removed", BIG_PATH), exact=True)).to_have_count(1)
        expect(grid.get_by_role("row", name=row_label(5, "added", BIG_PATH), exact=True)).to_have_count(1)


APP_BASE = "a\n"
APP_FEAT = "a\nb\nc\nd\ne\nf\ng\n"


def review_world(base: str, pre_threads: tuple = (), **mr_kw: Any) -> World:
    return world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "src/app.ts", APP_BASE)], "First"),
                    cm("c2", "feat", u["dev"], [act("update", "src/app.ts", APP_FEAT)], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"],
                               threads=[thr(key, u["rev"], path, line) for key, path, line in pre_threads],
                               **mr_kw)]})


def test_threads_and_batch_review_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = review_world(base)
    iid = w.iid("mr1")
    rev, dev = w.api("rev"), w.api("dev")
    root = f"/api/projects/{w.pid}/merge_requests/{iid}"
    pos = {"path": "src/app.ts", "old_line": None, "new_line": 2, "end_line": 4, "version": 1}
    ranged = rev.ok("POST", root + "/threads", {"body": "Range note", "position": pos, "pending": False}, status=201)
    pending = rev.ok("POST", root + "/threads", {"body": "Pending note", "pending": True, "position": dict(
        pos, new_line=6, end_line=None)}, status=201)
    assert pending["id"] not in [t["id"] for t in threads(dev, w.pid, iid)]
    mine = {t["id"]: t for t in threads(rev, w.pid, iid)}
    assert mine[pending["id"]]["notes"][0]["pending"] is True
    assert mine[ranged["id"]]["position"]["end_line"] == 4
    assert "Pending note" not in note_bodies(mr_notes(dev, w.pid, iid))
    assert rev.ok("POST", root + "/review", {"summary": "Two notes"})["published"] == 1
    assert pending["id"] in [t["id"] for t in threads(dev, w.pid, iid)]
    gone = rev.ok("POST", root + "/threads", {"body": "Drop me", "pending": True,
                                             "position": dict(pos, new_line=7, end_line=None)}, status=201)
    assert rev.req("DELETE", root + "/review").status_code == 204
    assert gone["id"] not in [t["id"] for t in threads(rev, w.pid, iid)]
    rev.ok("POST", root + f"/threads/{ranged['id']}/notes", {"body": "Reply"}, status=201)
    rev.ok("PATCH", root + f"/threads/{ranged['id']}", {"resolved": True})
    assert {t["id"]: t for t in threads(dev, w.pid, iid)}[ranged["id"]]["resolved"] is True
    rev.ok("PATCH", root + f"/threads/{ranged['id']}", {"resolved": False})
    after = {t["id"]: t for t in threads(dev, w.pid, iid)}
    assert after[ranged["id"]]["resolved"] is False and len(after[ranged["id"]]["notes"]) == 2
    moved = dev.ok("POST", root + "/threads/move_to_issue", status=201)
    assert moved["moved"] == 2
    assert f"Moved 2 threads to #{moved['issue_iid']}." in note_bodies(mr_notes(dev, w.pid, iid, "history"))
    assert all(t["resolved"] for t in threads(dev, w.pid, iid))
    assert "src/app.ts" in issue_get(dev, w.pid, moved["issue_iid"])["description"]


def test_wf_review_keyboard_journey(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = review_world(base, pre_threads=(("t1", "src/app.ts", 7),))
    iid = w.iid("mr1")
    changes = f"/projects/{w.pid}/-/merge_requests/{iid}/changes?file=src/app.ts&line=2&view=inline"
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}") as author, \
            as_user(browser, base, w.u["rev"], changes) as page:
        grid = page.get_by_role("grid", name="Diff")
        app_ts = "src/app.ts"
        expect(grid.get_by_role("row", name=row_label(2, "added", app_ts), exact=True)).to_be_focused()
        page.keyboard.press("]")
        assert focused_label(page) == thread_label(app_ts, 7)
        page.keyboard.press("e")
        announced(page, "Thread resolved. No unresolved threads left.")
        expect(grid.get_by_role("row", name=row_label(7, "added", app_ts), exact=True)).to_be_focused()
        for _ in range(3):
            page.keyboard.press("k")
        page.keyboard.press("Shift+ArrowDown")
        page.keyboard.press("Shift+ArrowDown")
        page.keyboard.press("c")
        box = page.get_by_role("textbox", name=f"Comment on lines {4}-{6}")
        expect(box).to_be_focused()
        page.keyboard.type(REVIEW_TEXT)
        expect(box).to_have_value(REVIEW_TEXT)
        page.keyboard.press("Control+Enter")
        assert focused_role(page) == "row" and re.match(r"^Line [46] added, src/app.ts", focused_label(page))
        threads_region = author.get_by_role("region", name="Threads")
        expect(threads_region.get_by_role("article", name=thread_label(app_ts, 4, 6))).to_be_visible(timeout=LIVE_MS)
        page.keyboard.press("c")
        page.keyboard.type("Try this:\n```suggestion\nbetter\n```")
        tab_until(page, "Start review")
        page.keyboard.press("Enter")
        row2 = grid.get_by_role("row", name=re.compile("^" + role_re(row_label(2, "added", app_ts))))
        row2.focus()
        page.keyboard.press("c")
        page.keyboard.type("Second pending note.")
        page.keyboard.press("Control+Enter")
        expect(row2).to_be_focused()
        page.get_by_role("button", name="Finish review").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Submit review")
        expect(dialog).to_contain_text(f"Pending comments: {2}")
        dialog.get_by_role("textbox", name="Summary").focus()
        page.keyboard.type("Two notes from review.")
        tab_until(page, "Submit review")
        page.keyboard.press("Enter")
        announced(page, f"Review submitted: {2} comments")
        expect(row2).to_be_focused()
        expect(author.get_by_role("region", name="Merge checks").get_by_role(
            "listitem", name=check_label("threads", "failed"))).to_contain_text(
            "3 unresolved threads must be resolved.", timeout=LIVE_MS)
    final = threads(w.api("dev"), w.pid, iid)
    assert sum(1 for t in final if not t["resolved"]) == 3
    assert any(t["suggestions"] for t in final)


SIX = "".join(f"v{i}\n" for i in range(1, 9))


def test_wf_versions_suggestions_compare(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    app_ts = "src/app.ts"
    one = SIX.replace("v2\n", "w2\n")
    two = one.replace(OLD_SIX + "\n", NEW_SIX + "\n")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", app_ts, SIX)], "First"),
                    cm("c2", "feat", u["dev"], [act("update", app_ts, one)], "One", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    iid = w.iid("mr1")
    with as_user(browser, base, w.u["rev"], f"/projects/{w.pid}/-/merge_requests/{iid}/changes") as page:
        expect(page.get_by_role("grid", name="Diff")).to_be_visible()
        pushed = gpush(w, "feat", "dev", [act("update", app_ts, two)], "Two")
        to_box = page.get_by_role("combobox", name="Compare to")
        deadline = time.monotonic() + LIVE_MS / 1000 + 5
        for _ in range(20):
            try:
                select(to_box, f"Version {2}")
                break
            except Exception:
                if time.monotonic() > deadline:
                    pytest.fail("Compare to never offered Version 2 after the push (live versions)")
        else:
            pytest.fail("Compare to never offered Version 2 after the push (live versions)")
        select(page.get_by_role("combobox", name="Compare from"), f"Version {1}")
        eventually(lambda: url_query(page).get("from") == ["1"] and url_query(page).get("to") == ["2"],
                   "the compared versions are kept in the URL")
        grid = page.get_by_role("grid", name="Diff")
        sixth = grid.get_by_role("row", name=re.compile("^" + role_re(row_label(6, "added", app_ts))))
        second = grid.get_by_role("row", name=re.compile("^" + role_re(row_label(2, "added", app_ts))))
        expect(sixth).to_have_count(1)
        expect(second).to_have_count(0)
        page.reload()
        expect(sixth).to_have_count(1)
        expect(second).to_have_count(0)
        select(page.get_by_role("combobox", name="Compare from"), "Target branch")
        eventually(lambda: url_query(page).get("from") == ["target"], "Target branch is kept in the URL")
    m = mr(w.api("rev"), w.pid, iid)
    assert [v["number"] for v in m["versions"]] == [1, 2]
    v2 = m["versions"][1]
    main = heads(w.api("rev"), w.pid)["main"]
    assert v2["head"] == pushed["commit"] and v2["start"] == main and v2["base"] == main
    d = w.api("rev").get(f"/api/projects/{w.pid}/merge_requests/{iid}/diff?from=1&to=2")
    changed = [ln for f in d["diffs"] for h in f["hunks"] for ln in h["lines"] if ln["type"] != "context"]
    assert {ln["text"] for ln in changed} == {OLD_SIX, NEW_SIX}


PUSH_ROUTES = ["commit_api", "grading_commit"]


@pytest.mark.parametrize("route", PUSH_ROUTES, ids=PUSH_ROUTES)
def test_one_push_every_consequence(app_url: str, route: str) -> None:
    base = app_url.rstrip("/")
    lines = "".join(f"line {i}\n" for i in range(1, 9))
    w = world(base, lambda t, u: {
        "settings": {"merge_trains": True, "reset_approvals_on_push": True, "pipelines_must_succeed": True},
        "commits": [cm("c1", "main", u["owner"], [act("create", "src/app.ts", lines),
                                                   act("create", "spurline.pipeline.yml", BUILD_ONLY)], "First"),
                    cm("c2", "side", u["owner"], [act("create", "side.txt", "s\n")], "Side", start="main"),
                    cm("c3", "feat", u["dev"], [act("update", "src/app.ts", lines.replace("line 4", "feat 4"))],
                       "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"], threads=[thr("tA", u["rev"], "src/app.ts", 2, resolved=True),
                                                                  thr("tB", u["rev"], "src/app.ts", 6, resolved=True)]),
                           mrq("mr2", "feat", u["dev"], target="side")]})
    dev, rev = w.api("dev"), w.api("rev")
    i1, i2 = w.iid("mr1"), w.iid("mr2")
    p1 = gpush(w, "feat", "dev", [act("create", "notes.txt", "n\n")], "Notes")["pipeline"]["id"]
    dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{i1}/train", status=201)
    head = heads(dev, w.pid)["feat"]
    dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{i2}/auto_merge", {"sha": head})
    rev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{i1}/approve", {"sha": head})
    before = len(mr(dev, w.pid, i1)["versions"])
    actions = [act("update", "src/app.ts", lines.replace("line 4", "feat 4").replace("line 2\n", "new 2a\nnew 2b\n"))]
    if route == "commit_api":
        r = api_commit(dev, w.pid, "feat", actions, "Second")
        assert r.status_code == 201, r.text
        res = r.json()
    else:
        res = gpush(w, "feat", "dev", actions, "Second")
    m1 = mr(dev, w.pid, i1)
    assert len(m1["versions"]) == before + 1 and m1["versions"][-1]["head"] == res["commit"]
    byid = {t["id"]: t for t in threads(dev, w.pid, i1)}
    ta, tb = byid[w.p["threads"]["tA"]["id"]], byid[w.p["threads"]["tB"]["id"]]
    assert ta["outdated"] is True and ta["current_line"] is None
    assert tb["outdated"] is False and tb["current_line"] == 7
    assert m1["approvals"]["approved_by"] == []
    history1 = note_bodies(mr_notes(dev, w.pid, i1, "history"))
    assert "Approvals reset: new commits were pushed." in history1
    assert "Removed from merge train: new commits were pushed." in history1
    assert m1["train"] is None
    m2 = mr(dev, w.pid, i2)
    assert m2["auto_merge"] is False and m2["state"] != "merged"
    assert "Auto-merge canceled: new commits were pushed." in note_bodies(mr_notes(dev, w.pid, i2, "history"))
    old = pipeline(dev, p1)
    assert old["status"] == "canceled"
    new_id = res["pipeline"]["id"]
    assert f"Canceled by newer pipeline {new_id}." in log_texts(dev, job(old, "build")["id"])
    assert pipeline(dev, new_id)["sha"] == res["commit"]


def suggestion_world(base: str) -> World:
    return world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "src/app.ts", "a1\na2\na3\na4\na5\na6\n"),
                                       act("create", "docs/a.md", "d1\nd2\nd3\n")], "First"),
        cm("c2", "feat", u["dev"], [act("update", "src/app.ts", "b1\nb2\nb3\nb4\nb5\nb6\n"),
                                    act("update", "docs/a.md", DOCS_FEAT)], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})


def suggest(w: World, path: str, line: int, block: str) -> int:
    root = f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}"
    tid = w.api("rev").ok("POST", root + "/threads", {"body": f"Try:\n{block}", "pending": False, "position": {
        "path": path, "old_line": None, "new_line": line, "end_line": None, "version": 1}}, status=201)["id"]
    found = [t for t in threads(w.api("rev"), w.pid, w.iid("mr1")) if t["id"] == tid][0]
    assert found["suggestions"], f"thread {tid} carries no suggestion"
    return found["suggestions"][0]["id"]


def test_suggestions_apply_and_refusals(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = suggestion_world(base)
    dev = w.api("dev")
    root = f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/suggestions/apply"
    s4 = suggest(w, "src/app.ts", 5, "```suggestion\nfive\n```")
    s1 = suggest(w, "src/app.ts", 2, "```suggestion\ntwo\n```")
    s3 = suggest(w, "src/app.ts", 2, "```suggestion\nTWO\n```")
    s2 = suggest(w, "docs/a.md", 1, f"```suggestion:-0+1\n{SUGGESTED_DOC}\n```")
    s5 = suggest(w, "src/app.ts", 4, "```suggestion\nfour\n```")
    s6 = suggest(w, "src/app.ts", 3, '```suggestion\npassword = "supersecret1"\n```')
    versions = len(mr(dev, w.pid, w.iid("mr1"))["versions"])
    one = dev.ok("POST", root, {"ids": [s4]}, status=201)
    info = dev.get(f"/api/projects/{w.pid}/commits/{one['commit']}")
    assert info["message"] == "Apply suggestion to src/app.ts"
    assert dev.get(f"/api/projects/{w.pid}/files?ref=feat&path=src/app.ts")["content"].splitlines()[4] == "five"
    assert len(mr(dev, w.pid, w.iid("mr1"))["versions"]) == versions + 1
    body = err(dev.req("POST", root, {"ids": [s1, s3]}), 409, "suggestion_overlap")
    assert re.fullmatch(r"These suggestions overlap: src\/app\.ts lines \d+-\d+\.", body["message"]), body
    two = dev.ok("POST", root, {"ids": [s1, s2]}, status=201)
    assert dev.get(f"/api/projects/{w.pid}/commits/{two['commit']}")["message"] == "Apply 2 suggestions to 2 files"
    expected_doc = f"{SUGGESTED_DOC}\n" + DOCS_FEAT.split("\n", 2)[2]
    assert dev.get(f"/api/projects/{w.pid}/files?ref=feat&path=docs/a.md")["content"] == expected_doc
    s5_thread = [t for t in threads(dev, w.pid, w.iid("mr1")) if any(s["id"] == s5 for s in t["suggestions"])][0]
    dev.ok("PATCH", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/threads/{s5_thread['id']}",
           {"resolved": True})
    err(dev.req("POST", root, {"ids": [s5, s3]}), 409, "suggestion_outdated",
        "This suggestion is outdated: the lines changed.")
    err(dev.req("POST", root, {"ids": [s5]}), 409, "thread_resolved", "This thread is resolved.")
    w.api("owner").ok("PUT", f"/api/projects/{w.pid}/push_rules", {
        "branch_name": None, "commit_message": None, "forbidden_files": [], "required_files": [], "secrets": True})
    head = heads(dev, w.pid)["feat"]
    err(dev.req("POST", root, {"ids": [s6]}), 422, "push_rule", "Secret found: password-line in src/app.ts at line 3.")
    assert heads(dev, w.pid)["feat"] == head


def test_wf_versions_suggestions_apply_ui(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = suggestion_world(base)
    suggest(w, "src/app.ts", 5, "```suggestion\nfive\n```")
    suggest(w, "src/app.ts", 2, "```suggestion\ntwo\n```")
    suggest(w, "docs/a.md", 1, "```suggestion\nfirst\n```")
    dev = w.api("dev")
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}/changes") as page:
        app_ts, doc = "src/app.ts", "docs/a.md"
        panel = page.get_by_role("region", name="Threads")
        click(panel.get_by_role("article", name=thread_on(app_ts, 5)).get_by_role("button", name="Apply suggestion"))
        expect(panel.get_by_role("article", name=thread_label(app_ts, 5, resolved=True))).to_be_visible(
            timeout=LIVE_MS)
        assert dev.get(f"/api/projects/{w.pid}/commits/{heads(dev, w.pid)['feat']}")["message"] == \
            f"Apply suggestion to {app_ts}"
        click(panel.get_by_role("article", name=thread_on(app_ts, 2)).get_by_role("button", name="Add to batch"))
        click(panel.get_by_role("article", name=thread_on(doc, 1)).get_by_role("button", name="Add to batch"))
        click(page.get_by_role("button", name="Apply batch").first)
        batch = f"Apply {2} suggestions to {2} files"
        eventually(lambda: dev.get(f"/api/projects/{w.pid}/commits/{heads(dev, w.pid)['feat']}")["message"] ==
                   batch, "Apply batch commits once with the batch message")
        expect(page).to_have_url(re.compile(r"/merge_requests/\d+/changes"))
    assert all(t["resolved"] for t in threads(dev, w.pid, w.iid("mr1")))


def test_owners_sections_and_rules(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")

    def build(t: str, u: dict) -> dict:
        owners = "\n".join([f"* @{u['owner']}", "[Backend][2]", f"/src/ @{u['rev']} @{u['maint']}",
                            f"src/legacy/ @{u['maint']}", "[Docs]", f"*.md @{u['rev']}", "^[Optional]",
                            f"*.ts @{u['maint']}", "[Tail]", "nofiles", f"*.txt @nouser{t}",
                            f"*.cfg @nogroup{t}/x", "[Bad", "[Count][x]"]) + "\n"
        return {"approval_rules": [{"name": "QA", "required": 1, "users": [u["rev"]], "groups": []}],
                "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n"),
                                                           act("create", "src/app.ts", "a\n"),
                                                           act("create", ".spurline/OWNERS", owners)], "First"),
                            cm("c2", "side", u["owner"], [act("create", "s.txt", "s\n")], "Side", start="main"),
                            cm("c3", "feat", u["dev"], [act("update", "src/app.ts", "b\n"),
                                                        act("create", "src/legacy/old.ts", "o\n")], "Feat",
                               start="main")],
                "merge_requests": [mrq("mr1", "feat", u["dev"]), mrq("mr2", "feat", u["dev"], target="side")]}

    w = world(base, build)
    dev = w.api("dev")
    rules = mr(dev, w.pid, w.iid("mr1"))["approvals"]["rules"]
    assert [(r["name"], r["kind"]) for r in rules] == [("QA", "rule"), ("Owners", "owners"), ("Backend", "owners"),
                                                       ("Optional", "owners")]
    by = {r["name"]: r for r in rules}
    assert by["QA"]["required"] == 1 and by["Owners"]["required"] == 1 and by["Backend"]["required"] == 2
    assert by["Optional"]["optional"] is True
    assert "QA" not in [r["name"] for r in mr(dev, w.pid, w.iid("mr2"))["approvals"]["rules"]]
    gpush(w, "feat", "dev", [act("update", "README.md", "hello again\n")], "Docs")
    names = [r["name"] for r in mr(dev, w.pid, w.iid("mr1"))["approvals"]["rules"]]
    assert names == ["QA", "Owners", "Backend", "Docs", "Optional"]
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}") as page:
        problems = page.get_by_role("region", name="Owners problems")
        for text in ("Line 10: no owners", f"Line 11: unknown user @nouser{w.t}",
                     f"Line 12: unknown group @nogroup{w.t}/x", "Line 13: bad section header", "Line 14: bad count"):
            expect(problems).to_contain_text(text)
        expect(page.get_by_role("region", name="Approvals")).to_contain_text("Backend: 0 of 2")


def test_approval_refusals_and_counting(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = review_world(base)
    owner = w.api("owner")
    for name, users in (("Backend", [w.u["rev"], w.u["maint"]]), ("Ops", [w.u["rev"], w.u["dev"]])):
        owner.ok("POST", f"/api/projects/{w.pid}/approval_rules",
                 {"name": name, "required": 1, "users": users, "groups": []}, status=201)
    iid = w.iid("mr1")
    root = f"/api/projects/{w.pid}/merge_requests/{iid}/approve"
    head = heads(owner, w.pid)["feat"]
    err(w.api("dev").req("POST", root, {"sha": head}), 403, "author_cannot_approve",
        "Authors can't approve their own merge request.")
    err(owner.req("POST", root, {"sha": head}), 403, "not_eligible", "You aren't eligible to approve this merge request.")
    err(w.api("rev").req("POST", root, {"sha": FIRST_COMMIT}), 409, "stale_head",
        "The source branch changed. Review the new commits and try again.")
    key = idempotency_key()
    first = w.api("rev").req("POST", root, {"sha": head}, headers={"Idempotency-Key": key})
    assert first.status_code == 200, first.text
    replay = w.api("rev").req("POST", root, {"sha": head}, headers={"Idempotency-Key": key})
    assert replay.json() == first.json() and replay.headers.get("Idempotent-Replay") == "true"
    given = {r["name"]: r["given"] for r in mr(owner, w.pid, iid)["approvals"]["rules"]}
    assert given["Backend"] == 1 and given["Ops"] == 1
    assert f"Approved by @{w.u['rev']}." in note_bodies(mr_notes(owner, w.pid, iid, "history"))
    w.api("rev").ok("DELETE", root, {"sha": head})
    assert f"Revoked approval by @{w.u['rev']}." in note_bodies(mr_notes(owner, w.pid, iid, "history"))
    owner.ok("PATCH", f"/api/projects/{w.pid}/settings", {"author_can_approve": True})
    w.api("dev").ok("POST", root, {"sha": head})
    given = {r["name"]: r["given"] for r in mr(owner, w.pid, iid)["approvals"]["rules"]}
    assert given["Ops"] == 0 and w.u["dev"] in mr(owner, w.pid, iid)["approvals"]["approved_by"]


def test_wf_approvals_owners_approve(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "approval_rules": [{"name": "Backend", "required": 1, "users": [u["rev"]], "groups": []}],
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    iid = w.iid("mr1")
    head = heads(w.api("owner"), w.pid)["feat"]
    root = f"/api/projects/{w.pid}/merge_requests/{iid}/approve"
    err(w.api("out").req("POST", root, {"sha": head}), 404, "not_found")
    assert w.api("rep").req("POST", root, {"sha": head}).status_code == 403
    err(w.api("maint").req("POST", root, {"sha": head}), 403, "not_eligible")
    assert mr(w.api("owner"), w.pid, iid)["approvals"]["approved_by"] == []
    path = f"/projects/{w.pid}/-/merge_requests/{iid}"
    with as_user(browser, base, w.u["dev"], path) as author, as_user(browser, base, w.u["rev"], path) as page:
        expect(author.get_by_role("region", name="Approvals")).to_contain_text(rule_count("Backend", 0, 1))
        click(page.get_by_role("button", name="Approve", exact=True))
        expect(page.get_by_role("button", name="Revoke approval")).to_be_focused()
        announced(page, "Approved. All approval rules are satisfied.")
        expect(author.get_by_role("region", name="Approvals")).to_contain_text(rule_count("Backend", 1, 1),
                                                                                timeout=LIVE_MS)
    assert mr(w.api("owner"), w.pid, iid)["approvals"]["approved_by"] == [w.u["rev"]]


def test_merge_checks_texts_and_blocking(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "settings": {"pipelines_must_succeed": True, "reset_approvals_on_push": False},
        "approval_rules": [{"name": QA_RULE, "required": 2, "users": [u["rev"], u["maint"]], "groups": []}],
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"], title="Draft: Tidy")]})
    dev = w.api("dev")
    iid = w.iid("mr1")
    root = f"/api/projects/{w.pid}/merge_requests/{iid}"
    head = heads(dev, w.pid)["feat"]
    tid = root_thread(w, iid)
    m = mr(dev, w.pid, iid)
    assert [c["name"] for c in m["checks"]] == CHECK_NAMES
    c = checks(m)
    assert c["state"]["state"] == "passed" and c["conflicts"]["state"] == "passed"
    assert c["rebase"]["state"] == "inactive" and c["security"]["state"] == "inactive"
    assert (c["draft"]["state"], c["draft"]["text"]) == ("failed", "This merge request is a draft.")
    assert c["threads"]["text"] == "1 unresolved thread must be resolved."
    assert c["approvals"]["text"] == needs_text(2, QA_RULE)
    assert c["pipeline"]["text"] == f"Pipeline must succeed. No pipeline has run on {head[:7]}."
    err(dev.req("POST", root + "/merge", {"sha": head}), 409, "merge_blocked", "This merge request is a draft.")
    dev.ok("PATCH", root, {"state_event": "ready"})
    assert "Marked as ready." in note_bodies(mr_notes(dev, w.pid, iid, "history"))
    err(dev.req("PATCH", root, {"state_event": "ready"}), 409, "wrong_state", "This merge request isn't a draft.")
    err(dev.req("POST", root + "/merge", {"sha": head}), 409, "merge_blocked", "1 unresolved thread must be resolved.")
    dev.ok("PATCH", root + f"/threads/{tid}", {"resolved": True})
    err(dev.req("POST", root + "/merge", {"sha": head}), 409, "merge_blocked", needs_text(2, QA_RULE))
    w.api("rev").ok("POST", root + "/approve", {"sha": head})
    err(dev.req("POST", root + "/merge", {"sha": head}), 409, "merge_blocked", needs_text(1, QA_RULE))
    w.api("maint").ok("POST", root + "/approve", {"sha": head})
    err(dev.req("POST", root + "/merge", {"sha": head}), 409, "merge_blocked",
        f"Pipeline must succeed. No pipeline has run on {head[:7]}.")
    res = gpush(w, "feat", "dev", [act("create", "spurline.pipeline.yml",
                                       "stages: [build]\nbuild:\n  stage: build\n  script:\n    - exit 1\n")], "CI")
    run_all(base, w.pid)
    assert checks(mr(dev, w.pid, iid))["pipeline"]["text"] == \
        f"Pipeline must succeed. Latest pipeline {res['pipeline']['id']} is failed."
    dev.ok("PATCH", root, {"state_event": "close"})
    assert checks(mr(dev, w.pid, iid))["state"]["text"] == "This merge request is closed."
    err(dev.req("POST", root + "/merge", {"sha": res["commit"]}), 409, "merge_blocked", "This merge request is closed.")


def test_merge_checks_structure(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "settings": {"merge_method": "fast_forward"},
        "commits": [cm("c1", "main", u["owner"], [act("create", "f.txt", "base\n")], "First"),
                    cm("c2", "fa", u["dev"], [act("create", "a.txt", "a\n")], "A", start="main"),
                    cm("c3", "fb", u["dev"], [act("create", "b.txt", "b\n")], "B", start="fa"),
                    cm("c4", "rel", u["owner"], [act("create", "r.txt", "r\n")], "Rel", start="main"),
                    cm("c5", "fc", u["dev"], [act("create", "c.txt", "c\n")], "C", start="main"),
                    cm("c6", "fd", u["dev"], [act("update", "f.txt", "feature\n")], "D", start="main"),
                    cm("c7", "main", u["owner"], [act("update", "f.txt", "main\n")], "Main")],
        "merge_requests": [mrq("A", "fa", u["dev"]), mrq("B", "fb", u["dev"], target="fa"),
                           mrq("C", "fc", u["dev"], target="rel"), mrq("D", "fd", u["dev"])]})
    dev = w.api("dev")
    assert checks(mr(dev, w.pid, w.iid("B")))["stack"]["text"] == f"Waiting for !{w.iid('A')} to merge."
    assert w.api("owner").req("DELETE", f"/api/projects/{w.pid}/branches/rel").status_code == 204
    assert checks(mr(dev, w.pid, w.iid("C")))["target"]["text"] == "Target branch rel no longer exists."
    d = checks(mr(dev, w.pid, w.iid("D")))
    assert d["conflicts"]["text"] == "Source branch has conflicts with main."
    a = checks(mr(dev, w.pid, w.iid("A")))
    assert (a["rebase"]["state"], a["rebase"]["text"]) == ("failed", "Source branch must be rebased onto main.")
    err(dev.req("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('D')}/merge",
                {"sha": heads(dev, w.pid)["fd"]}), 409, "merge_blocked", "Source branch has conflicts with main.")


def test_auto_merge(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "settings": {"pipelines_must_succeed": True},
        "commits": [cm("c1", "main", u["owner"], [act("create", "spurline.pipeline.yml", BUILD_ONLY)], "First"),
                    cm("c2", "rel", u["owner"], [act("create", "r.txt", "r\n")], "Rel", start="main")] +
                   [cm(f"b{i}", f"f{i}", u["dev"], [act("create", f"f{i}.txt", "x\n")], f"F{i}", start="main")
                    for i in range(4)],
        "merge_requests": [mrq(f"m{i}", f"f{i}", u["dev"]) for i in range(4)]})
    dev = w.api("dev")
    for i in range(4):
        gpush(w, f"f{i}", "dev", [act("create", f"g{i}.txt", "g\n")], "Run")
    root = lambda k: f"/api/projects/{w.pid}/merge_requests/{w.iid(k)}"
    for k in ("m0", "m1", "m2", "m3"):
        dev.ok("POST", root(k) + "/auto_merge", {"sha": heads(dev, w.pid)[f"f{k[1]}"]})
    dev.ok("DELETE", root("m1") + "/auto_merge", {"sha": heads(dev, w.pid)["f1"]})
    dev.ok("PATCH", root("m2"), {"title": "Draft: Wait"})
    dev.ok("PATCH", root("m3"), {"target": "rel"})
    run_all(base, w.pid)
    m0 = eventually(lambda: (lambda m: m if m["state"] == "merged" else None)(mr(dev, w.pid, w.iid("m0"))),
                    "auto-merge merges once every check passes")
    assert f"Merged by @{w.u['dev']} into main." in note_bodies(mr_notes(dev, w.pid, w.iid("m0"), "history"))
    assert m0["auto_merge"] is False
    assert f"Auto-merge canceled: canceled by {w.u['dev']}." in note_bodies(mr_notes(dev, w.pid, w.iid("m1"), "history"))
    assert "Auto-merge canceled: the merge request became a draft." in note_bodies(
        mr_notes(dev, w.pid, w.iid("m2"), "history"))
    assert "Auto-merge canceled: the target branch changed." in note_bodies(
        mr_notes(dev, w.pid, w.iid("m3"), "history"))
    for k in ("m1", "m2", "m3"):
        assert mr(dev, w.pid, w.iid(k))["state"] != "merged"


def test_wf_approvals_owners_checks_live(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "approval_rules": [{"name": "Backend", "required": 1, "users": [u["rev"]], "groups": []}],
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    iid = w.iid("mr1")
    tid = root_thread(w, iid)
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}") as page:
        region = page.get_by_role("region", name="Merge checks")
        items = region.get_by_role("listitem", name=re.compile(r"^Merge check "))
        expect(items).to_have_count(len(CHECK_NAMES))
        labels = [items.nth(i).get_attribute("aria-label") or items.nth(i).inner_text() for i in range(len(CHECK_NAMES))]
        names = [re.match(r"^Merge check (\w+), (passed|failed|inactive)", lbl).group(1) for lbl in labels]
        assert names == CHECK_NAMES
        expect(region.get_by_role("listitem", name=check_label("threads", "failed"))).to_contain_text(
            "1 unresolved thread must be resolved.")
        expect(region.get_by_role("listitem", name=check_label("approvals", "failed"))).to_contain_text(
            needs_text(1, "Backend"))
        w.api("rev").ok("PATCH", f"/api/projects/{w.pid}/merge_requests/{iid}/threads/{tid}",
                        {"resolved": True})
        expect(region.get_by_role("listitem", name=check_label("threads", "passed"))).to_be_visible(timeout=LIVE_MS)
    assert checks(mr(w.api("dev"), w.pid, iid))["threads"]["state"] == "passed"


def check_commit(api: Api, pid: int, cid: str, parents: list[str], message: str, who: str, files: dict) -> None:
    info = api.get(f"/api/projects/{pid}/commits/{cid}")
    assert info["parents"] == parents and info["message"] == message, info
    assert info["author"] == who and info["committer"] == who
    tree = info.get("tree", tree_of(files))
    assert tree == tree_of(files)
    assert cid == commit_id(tree, parents, who, unix(info["authored_at"]), who, unix(info["committed_at"]), message)


def test_merge_methods_and_hashes(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    dev, owner = w.api("dev"), w.api("owner")
    files = {"README.md": "hello\n"}

    def branch(name: str) -> str:
        return gpush(w, name, "dev", [act("create", f"{name}.txt", f"{name}\n")], f"Add {name}", start_ref="main")["commit"]

    def move_main(name: str) -> str:
        files[f"{name}.txt"] = "m\n"
        return gpush(w, "main", "owner", [act("create", f"{name}.txt", "m\n")], f"Main {name}")["commit"]

    for method in ("merge_commit", "squash"):
        owner.ok("PATCH", f"/api/projects/{w.pid}/settings", {"merge_method": method})
        src = branch(f"b{method[:2]}")
        target = move_main(f"m{method[:2]}")
        iid = open_mr(dev, w.pid, f"b{method[:2]}", f"Title {method}")
        merged = dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{iid}/merge", {"sha": src})
        files[f"b{method[:2]}.txt"] = f"b{method[:2]}\n"
        assert merged["state"] == "merged" and heads(dev, w.pid)["main"] == merged["merge_commit"]
        if method == "merge_commit":
            msg = f"Merge branch 'b{method[:2]}' into 'main'\n\nTitle {method}\n\nSee merge request !{iid}"
            check_commit(dev, w.pid, merged["merge_commit"], [target, src], msg, w.u["dev"], files)
        else:
            check_commit(dev, w.pid, merged["merge_commit"], [target], f"Title {method} (!{iid})", w.u["dev"], files)
    owner.ok("PATCH", f"/api/projects/{w.pid}/settings", {"merge_method": "fast_forward"})
    src = branch("bff")
    iid = open_mr(dev, w.pid, "bff", "Title ff")
    dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{iid}/merge", {"sha": src})
    files["bff.txt"] = "bff\n"
    assert heads(dev, w.pid)["main"] == src
    late = branch("bln")
    move_main("mln")
    late_iid = open_mr(dev, w.pid, "bln", "Late")
    err(dev.req("POST", f"/api/projects/{w.pid}/merge_requests/{late_iid}/merge", {"sha": late}), 409,
        "merge_blocked", "Source branch must be rebased onto main.")
    owner.ok("PATCH", f"/api/projects/{w.pid}/settings", {"merge_method": "rebase"})
    target = heads(dev, w.pid)["main"]
    src = branch("brb")
    iid = open_mr(dev, w.pid, "brb", "Title rb")
    merged = dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{iid}/merge", {"sha": src})
    files["brb.txt"] = "brb\n"
    check_commit(dev, w.pid, merged["merge_commit"], [target, src],
                 f"Merge branch 'brb' into 'main'\n\nTitle rb\n\nSee merge request !{iid}", w.u["dev"], files)


def conflict_world(base: str) -> World:
    return world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "f.txt", "base\n")], "First"),
        cm("c2", "fx", u["rev"], [act("update", "f.txt", FEATURE_TEXT)], "Feature", start="main", ts=TS0 + 100),
        cm("c3", "main", u["owner"], [act("update", "f.txt", MAIN_TEXT)], "Main")],
        "merge_requests": [mrq("mr1", "fx", u["dev"])]})


MARKED = f"<<<<<<< main\n{MAIN_TEXT}=======\n{FEATURE_TEXT}>>>>>>> fx"


def test_rebase_and_conflicts_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "f.txt", "base\n")], "First"),
        cm("c2", "fr", u["rev"], [act("create", "r.txt", "r\n")], "Replay me", start="main", ts=TS0 + 100),
        cm("c3", "main", u["owner"], [act("create", "m.txt", "m\n")], "Main")],
        "merge_requests": [mrq("mr1", "fr", u["dev"])]})
    dev = w.api("dev")
    res = dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/rebase")
    replayed = dev.get(f"/api/projects/{w.pid}/commits/{res['source_head']}")
    main = heads(dev, w.pid)["main"]
    assert replayed["parents"] == [main] and replayed["author"] == w.u["rev"]
    assert unix(replayed["authored_at"]) == TS0 + 100 and replayed["committer"] == w.u["dev"]
    note = [b for b in note_bodies(mr_notes(dev, w.pid, w.iid("mr1"), "history")) if b.startswith("Rebased onto main at ")]
    assert note and note[0] in (f"Rebased onto main at {main[:7]}.", f"Rebased onto main at {res['source_head'][:7]}.")

    c = conflict_world(base)
    dev = c.api("dev")
    root = f"/api/projects/{c.pid}/merge_requests/{c.iid('mr1')}"
    src, target = heads(dev, c.pid)["fx"], heads(dev, c.pid)["main"]
    err(dev.req("POST", root + "/rebase"), 409, "rebase_conflict", f"Rebase stopped at {src[:7]}: f.txt conflicts.")
    assert heads(dev, c.pid)["fx"] == src
    err(dev.req("POST", root + "/conflicts", {"files": [{"path": "f.txt", "content": MARKED + "\n"}]}), 422,
        "conflict_markers", "Remove all conflict markers before committing.")
    made = dev.ok("POST", root + "/conflicts", {"files": [{"path": "f.txt", "hunks": ["theirs"]}]}, status=201)
    info = dev.get(f"/api/projects/{c.pid}/commits/{made['commit']}")
    target_branch = "main"
    assert info["parents"] == [src, target] and info["message"] == f"Resolve conflicts with {target_branch}"
    assert dev.get(f"/api/projects/{c.pid}/files?ref=fx&path=f.txt")["content"] == FEATURE_TEXT
    assert checks(mr(dev, c.pid, c.iid("mr1")))["conflicts"]["state"] == "passed"


def test_wf_merging_conflict_inline(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = conflict_world(base)
    iid = w.iid("mr1")
    src = heads(w.api("dev"), w.pid)["fx"]
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}/conflicts") as page:
        click(page.get_by_role("button", name="Edit inline"))
        editor = page.get_by_role("textbox", name="Conflict editor")
        expect(editor).to_have_value(re.compile(re.escape(MARKED)))
        click(page.get_by_role("button", name="Commit resolution"))
        expect(page.get_by_text("Remove all conflict markers before committing.").first).to_be_visible()
        fill(editor, RESOLVED_TEXT)
        click(page.get_by_role("button", name="Commit resolution"))
        expect(page).to_have_url(base + f"/projects/{w.pid}/-/merge_requests/{iid}")
        expect(page.get_by_role("region", name="Merge checks")).to_be_focused()
    dev = w.api("dev")
    head = heads(dev, w.pid)["fx"]
    info = dev.get(f"/api/projects/{w.pid}/commits/{head}")
    target_branch = "main"
    assert info["parents"][0] == src and info["message"] == f"Resolve conflicts with {target_branch}"
    assert dev.get(f"/api/projects/{w.pid}/files?ref=fx&path=f.txt")["content"] == RESOLVED_TEXT


def test_stacked_retarget_and_closing(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "fa", u["dev"], [act("create", "a.txt", "a\n")], "A", start="main"),
                    cm("c3", "fb", u["dev"], [act("create", "b.txt", "b\n")], "B", start="fa"),
                    cm("c4", "fc", u["dev"], [act("create", "c.txt", "c\n")], "C", start="fa"),
                    cm("c5", "fd", u["dev"], [act("create", "d.txt", "d\n")], "D", start="fa"),
                    cm("c6", "rel", u["owner"], [act("create", "r.txt", "r\n")], "Rel", start="main"),
                    cm("c7", "fe", u["dev"], [act("create", "e.txt", "e\n")], "E", start="rel"),
                    cm("c8", "ff", u["dev"], [act("create", "g.txt", "g\n")], "fixes #4 in passing", start="main")],
        "issues": [issue(f"i{n}", f"Issue {n}", u["owner"]) for n in range(1, 5)],
        "merge_requests": [mrq("A", "fa", u["dev"], description="Closes #1", delete_source_branch=True),
                           mrq("B", "fb", u["dev"], target="fa"), mrq("C", "fc", u["dev"], target="fa"),
                           mrq("D", "fd", u["dev"], target="fa"),
                           mrq("E", "fe", u["dev"], target="rel", description="Resolves #3"),
                           mrq("F", "ff", u["dev"])]})
    dev = w.api("dev")
    a = w.iid("A")
    assert mr(dev, w.pid, a)["closes"] == [w.issue_iid("i1")]
    dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{a}/merge", {"sha": heads(dev, w.pid)["fa"]})
    assert "fa" not in heads(dev, w.pid)
    for key in ("B", "C")[:RETARGET_LIMIT]:
        m = mr(dev, w.pid, w.iid(key))
        assert m["target"] == "main"
        assert f"Retargeted from fa to main because !{a} merged." in note_bodies(mr_notes(dev, w.pid, w.iid(key), "history"))
    d = mr(dev, w.pid, w.iid("D"))
    assert d["target"] == "fa" and checks(d)["target"]["text"] == "Target branch fa no longer exists."
    one = issue_get(dev, w.pid, w.issue_iid("i1"))
    assert one["state"] == "closed" and f"Closed by !{a}." in issue_notes(dev, w.pid, w.issue_iid("i1"))
    dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('E')}/merge", {"sha": heads(dev, w.pid)["fe"]})
    assert issue_get(dev, w.pid, w.issue_iid("i3"))["state"] == "opened"
    dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('F')}/merge", {"sha": heads(dev, w.pid)["ff"]})
    assert issue_get(dev, w.pid, w.issue_iid("i4"))["state"] == "closed"
    root = f"/api/projects/{w.pid}/merge_requests/{a}"
    err(dev.req("PATCH", root, {"state_event": "close"}), 409, "wrong_state", "This merge request is already merged.")
    err(dev.req("POST", root + "/merge", {"sha": mr(dev, w.pid, a)["source_head"]}), 409, "wrong_state",
        "This merge request is already merged.")


def test_wf_merging_merge_closes_issue(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "issues": [issue("i1", "Export fails", u["rep"])],
        "merge_requests": [mrq("mr1", "feat", u["dev"], description="Closes #1")]})
    iid, n = w.iid("mr1"), w.issue_iid("i1")
    mr_path = f"/projects/{w.pid}/-/merge_requests/{iid}"
    with as_user(browser, base, w.u["rep"], f"/projects/{w.pid}/-/issues/{n}") as stake, \
            as_user(browser, base, w.u["dev"], mr_path) as page:
        target = "main"
        expect(page.get_by_role("region", name="Closing issues")).to_contain_text(closes_text([n]))
        click(page.get_by_role("button", name="Merge", exact=True))
        expect(page).to_have_url(base + mr_path)
        expect(page.get_by_role("heading", name=f"Merged into {target}")).to_be_focused()
        _c_said(page, f"Merged into {target}.")
        expect(stake.get_by_text(f"Closed by !{iid}.").first).to_be_visible(timeout=LIVE_MS)
        expect(stake.get_by_text("Closed", exact=True).first).to_be_visible()
    assert mr(w.api("dev"), w.pid, iid)["state"] == "merged"
    assert issue_get(w.api("rep"), w.pid, n)["state"] == "closed"


VALID_CONFIG = """stages: [build, test]
variables:
  GREETING: hi
.base:
  stage: test
  variables:
    FROM_BASE: "1"
build:
  stage: build
  script:
    - print $GREETING
unit:
  extends: .base
  script:
    - print unit
  matrix:
    OS: [linux, mac]
    V: [a, b]
skipme:
  stage: test
  script:
    - print x
  rules:
    - if: $NOPE == "yes"
"""
LINT_CASES = [
    ("stages: [build]\na:\n  stage: build\n  script:\n    - print a\n  needs: [b]\n"
     "b:\n  stage: build\n  script:\n    - print b\n  needs: [a]\n", ["Line 2: needs cycle: a -> b -> a."]),
    ("stages: [build]\na:\n  stage: build\n  colour: red\n  script:\n    - print a\nb:\n  stage: build\n",
     ['Line 4: unknown keyword "colour".', 'Line 7: job "b" has no script.']),
    ("stages: [build]\na:\n  stage: build\n  colour: red\n  script: |\n    print a\n",
     ["Line 5: can't read this line."]),
    ("include:\n  - ci/a.yml\nbuild:\n  stage: build\n  script:\n    - print a\n",
     ["Line 2: include cycle: ci/a.yml -> ci/b.yml -> ci/a.yml."]),
    ("include:\n  - spurline.pipeline.yml\nbuild:\n  stage: build\n  script:\n    - print a\n",
     ["Line 2: include cycle: spurline.pipeline.yml -> spurline.pipeline.yml."]),
    ("include:\n  - ci/missing.yml\nbuild:\n  stage: build\n  script:\n    - print a\n",
     ['Line 2: include "ci/missing.yml" not found.']),
    (".x:\n  extends: .y\n.y:\n  extends: .x\nbuild:\n  stage: build\n  script:\n    - print a\n",
     ["Line 1: extends cycle: .x -> .y -> .x."]),
    ("build:\n  stage: build\n  retry: 3\n  timeout: 5 minutes\n  script:\n    - print a\n",
     [f"Line 3: retry max can't exceed {RETRY_MAX}.", 'Line 4: can\'t read duration "5 minutes".']),
]


def lint(api: Api, pid: int, content: str, variables: dict | None = None) -> dict:
    return api.ok("POST", f"/api/projects/{pid}/ci/lint", {"content": content, "ref": "main",
                                                            "variables": variables or {}, "changed_files": []})


def lint_world(base: str) -> World:
    return world(base, lambda t, u: {"commits": [cm("c1", "main", u["owner"], [
        act("create", "README.md", "hello\n"), act("create", "ci/a.yml", "include:\n  - ci/b.yml\n"),
        act("create", "ci/b.yml", "include:\n  - ci/a.yml\n"),
        act("create", "ci/base.yml", "inc:\n  stage: build\n  script:\n    - print base\n")], "First")]})


def test_lint_messages(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = lint_world(base)
    dev = w.api("dev")
    ok = lint(dev, w.pid, VALID_CONFIG)
    assert ok["valid"] is True and ok["errors"] == [] and ok["summary"] == "Valid. 5 jobs in 2 stages."
    names = [j["name"] for j in ok["jobs"]]
    order = ["unit [linux, a]", "unit [linux, b]", "unit [mac, a]", "unit [mac, b]"]
    assert set(names) == {"build", *order} and [n for n in names if n.startswith("unit")] == order
    unit = [j for j in ok["jobs"] if j["name"] == "unit [linux, a]"][0]
    assert unit["stage"] == "test" and {"FROM_BASE": "1", "OS": "linux", "V": "a"}.items() <= unit["variables"].items()
    for content, expected in LINT_CASES:
        res = lint(dev, w.pid, content)
        assert res["valid"] is False and res["errors"] == expected, f"{content!r}: {res['errors']}"


def test_pipeline_config_semantics(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = lint_world(base)
    owner = w.api("owner")
    owner.ok("PUT", f"/api/projects/{w.pid}/variables/D", {"value": VAR_PROJ})
    excluded = 'workflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH == "never-branch"\n' + BUILD_ONLY.split("\n", 1)[1]
    r = gpush(w, "wa", "dev", [act("create", "spurline.pipeline.yml", excluded)], "WF", start_ref="main")
    assert r["pipeline"] == {"created": False, "reason": "Pipeline not created: workflow rules excluded it."}
    none = 'build:\n  stage: build\n  script:\n    - print a\n  rules:\n    - if: $CI_COMMIT_BRANCH == "never-branch"\n'
    r = gpush(w, "wb", "dev", [act("create", "spurline.pipeline.yml", none)], "None", start_ref="main")
    assert r["pipeline"] == {"created": False, "reason": "Pipeline not created: no jobs matched."}
    r = gpush(w, "wc", "dev", [act("create", "spurline.pipeline.yml", "build:\n  stage: build\n")], "Bad", start_ref="main")
    bad = pipeline(owner, r["pipeline"]["id"])
    assert bad["status"] == "failed" and bad["jobs"] == [] and bad["errors"] == ['Line 1: job "build" has no script.']
    show = (f"variables:\n  A: {VAR_TOP}\n  B: {VAR_TOP}\n  C: {VAR_TOP}\n  D: {VAR_TOP}\nshow:\n  stage: build\n"
            f"  variables:\n    B: {VAR_JOB}\n    C: {VAR_JOB}\n    D: {VAR_JOB}\n  rules:\n"
            f"    - if: $CI_COMMIT_BRANCH\n      variables:\n        C: {VAR_RULE}\n        D: {VAR_RULE}\n"
            "  script:\n    - print $A ${B} $C $D $UNKNOWN$$\n")
    r = gpush(w, "wd", "dev", [act("create", "spurline.pipeline.yml", show)], "Vars", start_ref="main")
    run_all(base, w.pid)
    expanded = " ".join([VAR_TOP, VAR_JOB, VAR_RULE, VAR_PROJ, "$"])
    assert expanded in log_texts(owner, job(pipeline(owner, r["pipeline"]["id"]), "show")["id"])
    merged = lint(owner, w.pid, "default:\n  script:\n    - print default\n.t:\n  variables:\n    X: one\n    Y: one\n"
                                "j:\n  extends: .t\n  stage: build\n  variables:\n    Y: two\n")
    assert merged["valid"] is True
    assert {"X": "one", "Y": "two"}.items() <= [j for j in merged["jobs"] if j["name"] == "j"][0]["variables"].items()
    inc = lint(owner, w.pid, "include:\n  - ci/base.yml\nmine:\n  stage: test\n  script:\n    - print main\n")
    assert {j["name"]: j["stage"] for j in inc["jobs"]} == {"inc": "build", "mine": "test"}
    over = lint(owner, w.pid, "include:\n  - ci/base.yml\ninc:\n  stage: deploy\n  script:\n    - print main\n")
    assert [j for j in over["jobs"] if j["name"] == "inc"][0]["stage"] == "deploy"


def test_wf_pipeline_config_lint_editor(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = lint_world(base)
    broken = "stages: [build]\na:\n  stage: build\n  colour: red\n  script:\n    - print a\nb:\n  stage: build\n"
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/ci/editor?ref=main") as page:
        box = page.get_by_role("textbox", name="Pipeline config")
        fill(box, broken)
        click(page.get_by_role("button", name="Check config"))
        results = page.get_by_role("region", name="Lint results")
        target = results.get_by_role("button", name='Line 7: job "b" has no script.')
        expect(results.get_by_role("button", name='Line 4: unknown keyword "colour".')).to_be_visible()
        announced(page, "Lint found 2 problems.")
        target.focus()
        page.keyboard.press("Enter")
        expect(box).to_be_focused()
        offset = len("".join(broken.splitlines(keepends=True)[:6]))
        assert box.evaluate("el => el.selectionStart") == offset
        fill(box, "stages: [build, test]\na:\n  stage: build\n  script:\n    - print a\nb:\n  stage: test\n"
                  "  script:\n    - print b\n")
        click(page.get_by_role("button", name="Check config"))
        expect(results).to_contain_text("Valid. 2 jobs in 2 stages.")
        expect(page.get_by_role("list", name="Expanded jobs").get_by_role("listitem")).to_have_count(2)
        announced(page, "Valid. 2 jobs in 2 stages.")


GRAPH_CONFIG = """stages: [build, test, deploy]
compile:
  stage: build
  script:
    - print c
lint:
  stage: build
  script:
    - print l
unit:
  stage: test
  needs: [compile]
  script:
    - print u
e2e:
  stage: test
  script:
    - print e
pack:
  stage: deploy
  needs: [unit, lint]
  script:
    - print p
"""


def test_wf_pipeline_config_graph(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    res = gpush(w, "main", "owner", [act("create", "spurline.pipeline.yml", GRAPH_CONFIG)], "Graph")
    plid = res["pipeline"]["id"]
    expected = {"compile": (0, 0), "lint": (0, 1), "unit": (1, 0), "e2e": (1, 1), "pack": (2, 0)}
    p = pipeline(w.api("dev"), plid)
    for name, (layer, row) in expected.items():
        j = job(p, name)
        assert (j["layer"], j["row"], j["x"], j["y"]) == (layer, row, GRAPH_ORIGIN + layer * GRAPH_DX,
                                                          GRAPH_ORIGIN + row * GRAPH_DY), j

    def curve(a: str, b: str) -> list[float]:
        (la, ra), (lb, rb) = expected[a], expected[b]
        x1, y1 = GRAPH_ORIGIN + la * GRAPH_DX, GRAPH_ORIGIN + ra * GRAPH_DY
        x2, y2 = GRAPH_ORIGIN + lb * GRAPH_DX, GRAPH_ORIGIN + rb * GRAPH_DY
        half = NODE_H / 2
        return [x1 + NODE_W, y1 + half, x1 + NODE_W + 20, y1 + half, x2 - 20, y2 + half, x2, y2 + half]

    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/pipelines/{plid}") as page:
        graph = page.get_by_role("group", name="Pipeline graph")
        expect(graph.get_by_role("button", name=graph_label("compile", "build", "pending", []))).to_be_visible()
        expect(graph.get_by_role("button", name=graph_label("pack", "deploy", "created", ["unit", "lint"]))
               ).to_be_visible()
        node = graph.get_by_role("button", name=re.compile(r"^Job e2e,"))
        layer, row = expected["e2e"]
        assert (node.get_attribute("data-job"), node.get_attribute("data-x"), node.get_attribute("data-y"),
                node.get_attribute("data-layer"), node.get_attribute("data-row")) == (
            "e2e", str(GRAPH_ORIGIN + layer * GRAPH_DX), str(GRAPH_ORIGIN + row * GRAPH_DY), str(layer), str(row))
        edges = graph.evaluate(EDGES_JS)
        assert len(edges) == 3, f"one path per need: {edges}"
        for a, b in (("compile", "unit"), ("unit", "pack"), ("lint", "pack")):
            found = [e for e in edges if e["from"] == a and e["to"] == b]
            assert len(found) == 1, f"edge {a}->{b}: {edges}"
            numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", found[0]["d"])]
            assert numbers == curve(a, b), f"edge {a}->{b}: {numbers}"
        graph.get_by_role("button", name=re.compile(r"^Job compile,")).focus()
        page.keyboard.press("ArrowRight")
        expect(graph.get_by_role("button", name=re.compile(r"^Job unit,"))).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(graph.get_by_role("button", name=re.compile(r"^Job e2e,"))).to_be_focused()
        graph.get_by_role("button", name=re.compile(r"^Job pack,")).focus()
        page.keyboard.press("ArrowRight")
        expect(graph.get_by_role("button", name=re.compile(r"^Job pack,"))).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(graph.get_by_role("button", name=re.compile(r"^Job unit,"))).to_be_focused()
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(rf"/projects/{w.pid}/-/jobs/{job(p, 'unit')['id']}$"))
        expect(page.get_by_role("log", name="Job log")).to_be_focused()


WORKED = ("stages: [build, test]\nbuild:\n  stage: build\n  script:\n    - print a\n"
          "test:\n  stage: test\n  script:\n    - wait 1000\n    - print b\n")


def test_scheduler_worked_example(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    plid = gpush(w, "main", "owner", [act("create", "spurline.pipeline.yml", WORKED)], "Run")["pipeline"]["id"]
    api = w.api("dev")

    def state() -> tuple[str, str, str]:
        p = pipeline(api, plid)
        return job(p, "build")["status"], job(p, "test")["status"], p["status"]

    assert state() == ("pending", "created", "running")
    rounds(base, w.pid)
    assert state() == ("success", "pending", "running")
    rounds(base, w.pid)
    assert state() == ("success", "running", "running")
    rounds(base, w.pid)
    assert state() == ("success", "running", "running")
    tick(base, 1000)
    rounds(base, w.pid)
    assert state() == ("success", "running", "running")
    rounds(base, w.pid)
    assert state() == ("success", "success", "success")
    assert {s["name"]: s["status"] for s in pipeline(api, plid)["stages"]} == {"build": "success", "test": "success"}


def test_scheduler_limits_and_when(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    api = w.api("dev")

    def run(branch: str, config: str) -> int:
        return gpush(w, branch, "dev", [act("create", "spurline.pipeline.yml", config)], branch,
                     start_ref="main")["pipeline"]["id"]

    waiter = "  script:\n    - wait 1000\n    - print x\n"
    a = run("pa", "".join(f"j{i}:\n  stage: build\n{waiter}" for i in range(1, 4)))
    rounds(base, w.pid)
    st = [job(pipeline(api, a), f"j{i}")["status"] for i in range(1, 4)]
    assert st == ["running", "running", "pending"], st
    tick(base, 1000)
    run_all(base, w.pid)
    tick(base, 1000)
    run_all(base, w.pid)
    b = run("pb", "".join(f"r{i}:\n  stage: build\n  resource_group: prod\n{waiter}" for i in (1, 2)))
    rounds(base, w.pid)
    assert sorted(job(pipeline(api, b), n)["status"] for n in ("r1", "r2")) == ["pending", "running"]
    for _ in range(3):
        tick(base, 1000)
        run_all(base, w.pid)
    assert pipeline(api, b)["status"] == "success"
    c = run("pc", "stages: [build, test, deploy]\nok:\n  stage: build\n  script:\n    - print ok\n"
                  "gate:\n  stage: test\n  when: manual\n  allow_failure: false\n  script:\n    - print g\n"
                  "later:\n  stage: deploy\n  script:\n    - print l\n")
    run_all(base, w.pid)
    pc = pipeline(api, c)
    assert {s["name"]: s["status"] for s in pc["stages"]} == {"build": "success", "test": "blocked", "deploy": "created"}
    assert pc["status"] == "running" and job(pc, "gate")["status"] == "manual"
    api.ok("POST", f"/api/jobs/{job(pc, 'gate')['id']}/play", {"variables": {}})
    assert job(pipeline(api, c), "gate")["status"] == "pending"
    run_all(base, w.pid)
    assert pipeline(api, c)["status"] == "success"
    start = now_ms(base)
    d = run("pd", "d:\n  stage: build\n  when: delayed\n  start_in: 30s\n  script:\n    - print d\n")
    dj = job(pipeline(api, d), "d")
    assert dj["status"] == "scheduled" and unix(dj["start_at"]) == (start + 30000) // 1000
    rounds(base, w.pid)
    assert job(pipeline(api, d), "d")["status"] == "scheduled"
    tick(base, 30000)
    rounds(base, w.pid)
    assert job(pipeline(api, d), "d")["status"] == "success"
    e = run("pe", "stages: [build, test]\nf:\n  stage: build\n  script:\n    - exit 1\n"
                  "cleanup:\n  stage: test\n  when: on_failure\n  script:\n    - print c\n"
                  "next:\n  stage: test\n  script:\n    - print n\n")
    run_all(base, w.pid)
    pe = pipeline(api, e)
    assert (job(pe, "f")["status"], job(pe, "cleanup")["status"], job(pe, "next")["status"]) == \
        ("failed", "success", "skipped")
    assert pe["status"] == "failed"


def test_wf_pipeline_run_live_rows(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    cfg = "stages: [build, test]\nbuild:\n  stage: build\n  script:\n    - print a\ntest:\n  stage: test\n  script:\n    - exit 1\n"
    plid = gpush(w, "main", "owner", [act("create", "spurline.pipeline.yml", cfg)], "Run")["pipeline"]["id"]
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/pipelines/{plid}") as page:
        jobs_list = page.get_by_role("list", name="Jobs")
        expect(jobs_list.get_by_role("listitem", name=job_label("build", "build", "pending", "not started"))
               ).to_be_visible()
        stages = page.get_by_role("list", name="Stages")
        expect(stages.get_by_role("listitem", name=re.compile(r"^Stage 0?1 build, running$"))).to_be_visible()
        rounds(base, w.pid)
        expect(jobs_list.get_by_role("listitem", name=job_label("build", "build", "success", "0s"))).to_be_visible(
            timeout=LIVE_MS)
        expect(stages.get_by_role("listitem", name=re.compile(r"^Stage 0?1 build, success$"))).to_be_visible()
        announced(page, f"Job {'build'} succeeded")
        rounds(base, w.pid, 2)
        failing = "test"
        expect(jobs_list.get_by_role("listitem", name=job_label(failing, failing, "failed", "0s"))).to_be_visible(
            timeout=LIVE_MS)
        announced(page, f"Pipeline {plid} failed: job {failing}")
    assert pipeline(w.api("dev"), plid)["status"] == "failed"


def test_wf_pipeline_run_delayed_server_clock(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, zones={"dev": "Asia/Tokyo"})
    plid = gpush(w, "main", "owner", [act("create", "spurline.pipeline.yml",
                                          "later:\n  stage: build\n  when: delayed\n  start_in: 30s\n  script:\n    - print d\n")],
                 "Run")["pipeline"]["id"]
    start_at = job(pipeline(w.api("dev"), plid), "later")["start_at"]
    shown = dt.datetime.fromisoformat(start_at.replace("Z", "+00:00")).astimezone(ZoneInfo("Asia/Tokyo"))
    text = f"Starts at {shown.strftime('%Y-%m-%d %H:%M:%S')} Asia/Tokyo"
    with as_user(browser, base, w.u["dev"], "/") as page:
        page.clock.set_system_time(dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=7))
        page.goto(base + f"/projects/{w.pid}/-/pipelines/{plid}")
        expect(page.get_by_text(text)).to_be_visible()
        jobs_list = page.get_by_role("list", name="Jobs")
        expect(jobs_list.get_by_role("listitem", name=re.compile(r"^Job later, stage build, scheduled"))).to_be_visible()
        rounds(base, w.pid)
        expect(jobs_list.get_by_role("listitem", name=re.compile(r"^Job later, stage build, scheduled"))).to_be_visible()
        tick(base, 30000)
        rounds(base, w.pid)
        expect(jobs_list.get_by_role("listitem", name=job_label("later", "build", "success", "0s"))).to_be_visible(
            timeout=LIVE_MS)
    assert job(pipeline(w.api("dev"), plid), "later")["status"] == "success"


def test_retries_timeouts_cancellation(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    api = w.api("dev")
    cfg = ("flaky:\n  stage: build\n  retry: 1\n  script:\n    - exit 1\n"
           "slow:\n  stage: build\n  timeout: 1s\n  script:\n    - wait 5000\n    - print late\n")
    plid = gpush(w, "pr", "dev", [act("create", "spurline.pipeline.yml", cfg)], "Run", start_ref="main")["pipeline"]["id"]
    run_all(base, w.pid)
    attempts = sorted([j for j in pipeline(api, plid)["jobs"] if j["name"] == "flaky"], key=lambda j: j["id"])
    assert len(attempts) == 2 and attempts[0]["id"] != attempts[1]["id"]
    assert attempts[0]["retried"] is True and attempts[0]["status"] == "failed"
    assert attempts[1]["retried"] is False and attempts[1]["status"] == "failed"
    assert job(pipeline(api, plid), "slow")["status"] == "running"
    tick(base, 1500)
    rounds(base, w.pid)
    slow = job(pipeline(api, plid), "slow")
    assert slow["status"] == "failed" and slow["failure_reason"] == "job_timeout"
    assert "Job exceeded its time limit." in log_texts(api, slow["id"])
    again = api.ok("POST", f"/api/jobs/{attempts[1]['id']}/retry", status=201)["id"]
    assert again not in (a["id"] for a in attempts)
    assert [j for j in pipeline(api, plid)["jobs"] if j["id"] == again][0]["status"] == "pending"
    run_all(base, w.pid)
    for branch, interruptible in (("ia", True), ("ib", False)):
        long = "long:\n  stage: build\n" + ("  interruptible: true\n" if interruptible else "") + \
               "  script:\n    - wait 100000\n"
        first = gpush(w, branch, "dev", [act("create", "spurline.pipeline.yml", long)], "One", start_ref="main")
        rounds(base, w.pid)
        second = gpush(w, branch, "dev", [act("create", f"{branch}.txt", "x\n")], "Two")
        old = pipeline(api, first["pipeline"]["id"])
        if interruptible:
            assert old["status"] == "canceled"
            assert f"Canceled by newer pipeline {second['pipeline']['id']}." in log_texts(api, job(old, "long")["id"])
        else:
            assert old["status"] == "running" and job(old, "long")["status"] == "running"
            api.ok("POST", f"/api/jobs/{job(old, 'long')['id']}/cancel")
    assert job(pipeline(api, first["pipeline"]["id"]), "long")["status"] == "canceled"


CACHE_CONFIG = """stages: [build, test]
build:
  stage: build
  script:
    - print hello $CI_JOB_NAME
    - write dist/app.txt built
  artifacts:
    paths: [dist/app.txt]
  cache:
    key: deps
    paths: [dist/app.txt]
test:
  stage: test
  script:
    - print t
  cache:
    key: other
    fallback_keys: [deps]
    paths: [dist/app.txt]
    policy: pull
"""


def test_logs_artifacts_caches(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    api = w.api("dev")
    plid = gpush(w, "main", "owner", [act("create", "spurline.pipeline.yml", CACHE_CONFIG)], "Run")["pipeline"]["id"]
    run_all(base, w.pid)
    p = pipeline(api, plid)
    build, test = job(p, "build"), job(p, "test")
    lines = log_lines(api, build["id"])
    assert lines == ["1 sys section_start cache", "2 sys Cache miss: deps", "3 sys section_end cache",
                     "4 sys section_start script", "5 out hello build", "6 sys Wrote dist/app.txt",
                     "7 sys section_end script", "8 sys section_start artifacts", "9 sys Uploaded 1 artifact files",
                     "10 sys section_end artifacts", "11 sys Cache saved: deps", "12 sys Job finished: success"], lines
    assert log_lines(api, test["id"]) == [
        "1 sys section_start cache", "2 sys Cache hit from fallback: deps", "3 sys section_end cache",
        "4 sys Downloaded artifacts of build", "5 sys section_start script", "6 out t", "7 sys section_end script",
        "8 sys Job finished: success"]
    s3_wait(f"logs/{build['id']}.log")
    assert S3().get(f"logs/{build['id']}.log").decode() == "".join(line + "\n" for line in lines)
    assert S3().get(f"artifacts/{build['id']}/dist/app.txt") == b"built\n"
    assert json.loads(S3().get(f"caches/{w.pid}/deps")) == {"dist/app.txt": "built\n"}
    detail = api.get(f"/api/jobs/{build['id']}")
    assert detail["log_sealed"] is True
    assert [(a["path"], a["size"], a["expired"]) for a in detail["artifacts"]] == [("dist/app.txt", 6, False)]
    assert api.req("GET", f"/api/jobs/{build['id']}/artifacts/dist/app.txt").content == b"built\n"
    deadline, body = time.monotonic() + POLL_S, ""
    with api.client.stream("GET", f"/api/jobs/{build['id']}/log/stream") as stream:
        assert stream.headers["content-type"].startswith("text/event-stream")
        for chunk in stream.iter_text():
            body += chunk
            if re.search(r"^event:\s?end$.*?\n\n", body, re.M | re.S):
                break
            assert time.monotonic() < deadline, "the log stream sent no end event"
    events = [blk for blk in body.split("\n\n") if blk.strip() and not blk.startswith(":")]
    parsed = [(re.search(r"^event:\s?(.*)$", e, re.M).group(1), re.search(r"^data:\s?(.*)$", e, re.M).group(1))
              for e in events]
    sent = [d for k, d in parsed if k == "line"]
    assert sent == lines or sent == [line.split(" ", 2)[2] for line in lines], sent
    assert parsed[-1][0] == "end" and json.loads(parsed[-1][1]) == {"status": "success"}
    kept = gpush(w, "main", "owner", [act("create", "k.txt", "k\n")], "Keep")["pipeline"]["id"]
    run_all(base, w.pid)
    kept_build = job(pipeline(api, kept), "build")
    api.ok("POST", f"/api/jobs/{kept_build['id']}/artifacts/keep")
    tick(base, ARTIFACT_TTL_MS + 1)
    s3_wait(f"artifacts/{build['id']}/dist/app.txt", present=False)
    assert all(a["expired"] for a in api.get(f"/api/jobs/{build['id']}")["artifacts"]) or \
        api.get(f"/api/jobs/{build['id']}")["artifacts"] == []
    assert api.req("GET", f"/api/jobs/{build['id']}/artifacts/dist/app.txt").status_code != 200
    assert f"artifacts/{kept_build['id']}/dist/app.txt" in S3().keys(f"artifacts/{kept_build['id']}/")
    retry = api.ok("POST", f"/api/jobs/{test['id']}/retry", status=201)["id"]
    run_all(base, w.pid)
    retried = [j for j in pipeline(api, plid)["jobs"] if j["id"] == retry][0]
    assert retried["status"] == "failed" and retried["failure_reason"] == "system_failure"
    assert "Artifacts of build have expired." in log_texts(api, retry)


def test_wf_pipeline_run_storage_outage(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    api = w.api("dev")
    try:
        storage(base, True)
        plid = gpush(w, "main", "owner", [act("create", "spurline.pipeline.yml", CACHE_CONFIG)], "Run")["pipeline"]["id"]
        run_all(base, w.pid)
        build = job(pipeline(api, plid), "build")
        assert build["status"] == "failed" and build["failure_reason"] == "system_failure"
        texts = log_texts(api, build["id"])
        assert "Artifact upload failed: file storage is unavailable." in texts
        assert "Cache skipped: file storage is unavailable." in texts
        assert S3().keys(f"artifacts/{build['id']}/") == [] and api.get(f"/api/jobs/{build['id']}")["log_sealed"] is False
        with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/jobs/{build['id']}") as page:
            expect(page.get_by_text("Artifact upload failed: file storage is unavailable.").first).to_be_visible()
            artifact = "dist/app.txt"
            expect(page.get_by_role("link", name=f"Download {artifact}")).to_have_count(0)
    finally:
        storage(base, False)
    rounds(base, w.pid)
    s3_wait(f"logs/{build['id']}.log")
    assert api.get(f"/api/jobs/{build['id']}")["log_sealed"] is True


def train_config(slow: bool, timeout: bool = False) -> str:
    check = "    - wait 10000\n    - print ok\n" if slow else "    - print ok\n"
    extra = "  timeout: 2h\n" if timeout else ""
    return ("stages: [test]\ncheck:\n  stage: test\n" + extra + "  rules:\n    - if: $CI_COMMIT_MESSAGE == \"Train merge !2\"\n"
            "      when: never\n    - when: on_success\n  script:\n" + check +
            "boom:\n  stage: test\n  rules:\n    - if: $CI_COMMIT_MESSAGE == \"Train merge !2\"\n  script:\n    - exit 1\n")


def train_world(base: str, config: str, cars: int = 3, extra_mrs: int = 0) -> World:
    total = cars + extra_mrs
    return world(base, lambda t, u: {
        "settings": {"merge_trains": True},
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n"),
                                                   act("create", "spurline.pipeline.yml", config)], "First")] +
                   [cm(f"b{i}", f"f{i}", u["dev"], [act("create", f"f{i}.txt", f"{i}\n")], f"F{i}", start="main")
                    for i in range(1, total + 1)],
        "merge_requests": [mrq(f"mr{i}", f"f{i}", u["dev"]) for i in range(1, total + 1)],
        "train": [{"target": "main", "requests": [f"mr{i}" for i in range(1, cars + 1)]}]})


def test_train_speculative_commits(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = train_world(base, train_config(slow=False))
    api = w.api("dev")
    train = w.p["train"]
    main0 = heads(api, w.pid)["main"]
    hs = heads(api, w.pid)
    car1 = api.get(f"/api/projects/{w.pid}/commits/{train['mr1']['sha']}")
    assert car1["parents"] == [main0, hs["f1"]] and car1["message"] == "Train merge !1"
    assert car1["author"] == "spurline-train" and car1["committer"] == "spurline-train"
    car2 = api.get(f"/api/projects/{w.pid}/commits/{train['mr2']['sha']}")
    assert car2["parents"] == [train["mr1"]["sha"], hs["f2"]]
    tree = api.get(f"/api/projects/{w.pid}/train/2/tree")
    assert tree["sha"] == train["mr2"]["sha"]
    assert set(tree["files"]) >= {"README.md", "f1.txt", "f2.txt"} and tree["tree"] == tree_of(tree["files"])
    listed = api.get(f"/api/projects/{w.pid}/train?target=main")["cars"]
    assert [(c["iid"], c["position"], c["sha"]) for c in listed] == [(1, 1, train["mr1"]["sha"]),
                                                                      (2, 2, train["mr2"]["sha"]),
                                                                      (3, 3, train["mr3"]["sha"])]
    run_all(base, w.pid)
    eventually(lambda: mr(api, w.pid, 3)["state"] == "merged", "car 3 merges after the rebuild")
    history = [c["id"] for c in api.get(f"/api/projects/{w.pid}/commits?ref=main")["commits"]]
    assert train["mr1"]["sha"] in history
    assert mr(api, w.pid, 1)["state"] == "merged" and mr(api, w.pid, 2)["state"] != "merged"
    removal = [n for n in mr_notes(api, w.pid, 2, "history")
               if n["body"] == f"Removed from merge train: pipeline {train['mr2']['pipeline_id']} failed."]
    assert removal and removal[0]["author"] == "spurline-train"
    final = api.get(f"/api/projects/{w.pid}/commits/{heads(api, w.pid)['main']}")
    assert final["message"] == "Train merge !3" and final["parents"][0] == train["mr1"]["sha"]
    assert final["id"] != train["mr3"]["sha"]


def test_train_rebuild_rules(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = train_world(base, train_config(slow=True, timeout=True).replace("wait 10000", "wait 100000"), extra_mrs=TRAIN_MAX)
    dev, owner = w.api("dev"), w.api("owner")

    def cars() -> dict[int, dict]:
        return {c["iid"]: c for c in dev.get(f"/api/projects/{w.pid}/train?target=main")["cars"]}

    before = cars()
    pushed = gpush(w, "main", "owner", [act("create", "direct.txt", "d\n")], "Direct")["commit"]
    after = cars()
    assert all(after[i]["sha"] != before[i]["sha"] for i in (1, 2, 3))
    assert dev.get(f"/api/projects/{w.pid}/commits/{after[1]['sha']}")["parents"][0] == pushed
    owner.ok("DELETE", f"/api/projects/{w.pid}/merge_requests/2/train")
    assert f"Removed from merge train: removed by {w.u['owner']}." in note_bodies(mr_notes(dev, w.pid, 2, "history"))
    now = cars()
    assert set(now) == {1, 3} and now[1]["sha"] == after[1]["sha"]
    assert dev.get(f"/api/projects/{w.pid}/commits/{now[3]['sha']}")["parents"][0] == now[1]["sha"]
    assert dev.req("POST", f"/api/projects/{w.pid}/merge_requests/3/train/merge_now").status_code == 403
    owner.ok("POST", f"/api/projects/{w.pid}/merge_requests/3/train/merge_now")
    assert mr(dev, w.pid, 3)["state"] == "merged"
    main = heads(dev, w.pid)["main"]
    assert dev.get(f"/api/projects/{w.pid}/commits/{main}")["message"].startswith("Merge branch 'f3' into 'main'")
    assert dev.get(f"/api/projects/{w.pid}/commits/{cars()[1]['sha']}")["parents"][0] == main
    for i in range(4, 4 + TRAIN_MAX - 1):
        dev.ok("POST", f"/api/projects/{w.pid}/merge_requests/{i}/train", status=201)
    err(dev.req("POST", f"/api/projects/{w.pid}/merge_requests/{4 + TRAIN_MAX - 1}/train"), 409, "train_full",
        f"This train is full ({TRAIN_MAX} cars).")
    first_pipeline = cars()[1]["pipeline_id"]
    rounds(base, w.pid)
    tick(base, JOB_TIMEOUT_MS + 1)
    eventually(lambda: 1 not in cars(), "car 1 is removed when its pipeline times out")
    assert f"Removed from merge train: pipeline {first_pipeline} timed out." in note_bodies(mr_notes(dev, w.pid, 1, "history"))
    assert job(pipeline(dev, first_pipeline), "check")["failure_reason"] == "job_timeout"


def test_wf_merge_train_add(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = train_world(base, train_config(slow=True), cars=0, extra_mrs=1)
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/train?target=main") as page:
        main = page.get_by_role("main")
        for text in (EYEBROW_TRAIN, "The train is empty", "Open merge requests"):
            expect(main).to_contain_text(text)
        page.goto(base + f"/projects/{w.pid}/-/merge_requests/1")
        click(page.get_by_role("button", name="Add to merge train"))
        car = page.get_by_role("list", name="Merge train").get_by_role("listitem", name=re.compile(r"^Position 1, !1, "))
        expect(car).to_be_focused()
    stored = w.api("dev").get(f"/api/projects/{w.pid}/train?target=main")["cars"]
    assert [c["iid"] for c in stored] == [1]
    assert "Added to merge train at position 1." in note_bodies(mr_notes(w.api("dev"), w.pid, 1, "history"))


def kicker_text(car: Locator, short: str) -> str:
    match = re.search(r"\[\s*([0-9a-f]*)\s*\]", car.get_by_label(f"Testing {short}").inner_text())
    return match.group(1) if match else ""


def test_wf_merge_train_watch(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = train_world(base, train_config(slow=True))
    tr = w.p["train"]
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/train?target=main", record=True) as page:
        lst = page.get_by_role("list", name="Merge train")
        car = lambda n: lst.get_by_role("listitem", name=re.compile(rf"^Position \d+, !{n}, "))
        for n in (1, 2, 3):
            sha = tr[f"mr{n}"]["sha"]
            expect(car(n)).to_have_attribute("data-sha", sha)
            expect(car(n)).to_have_attribute("data-iid", str(n))
            expect(car(n)).to_have_accessible_name(re.compile(rf"^Position {n}, !{n}, testing {sha[:7]}, pipeline "))
        joins = [a for a in anims(page, ["train-step"]) if a["dy"] is not None]
        assert joins and all(a["dy"] < 0 and a["duration"] == ANIM_MS["train-step"] for a in joins), joins
        settle(lst)
        tops = [car(n).bounding_box()["y"] for n in (1, 2, 3)]
        assert abs(tops[1] - tops[0] - STEP_PX) <= 1 and abs(tops[2] - tops[1] - STEP_PX) <= 1, tops
        advance(page, KICK_FIRST_LOCK_MS + 10)
        assert kicker_text(car(1), tr["mr1"]["sha"][:7])[:1] == tr["mr1"]["sha"][0]
        short1 = tr["mr1"]["sha"][:7]
        unlocked = kicker_text(car(1), short1)
        assert re.fullmatch(r"[0-9a-f]{7}", unlocked) and unlocked != short1, "kicker must still be resolving"
        advance(page, KICK_TICK_MS)
        assert kicker_text(car(1), short1)[3:] != unlocked[3:], "unlocked glyphs must keep cycling"
        advance(page, KICK_LAST_LOCK_MS - KICK_FIRST_LOCK_MS + 20)
        assert kicker_text(car(1), tr["mr1"]["sha"][:7]) == tr["mr1"]["sha"][:7]
        page.evaluate(CLEAR_ANIMS)
        rounds(base, w.pid)
        new3 = {c["iid"]: c for c in w.api("owner").get(f"/api/projects/{w.pid}/train?target=main")["cars"]}[3]["sha"]
        assert new3 != tr["mr3"]["sha"]
        _c_said(page, car_moved(3, 2, new3[:7]))
        expect(lst.get_by_role("listitem")).to_have_count(2, timeout=LIVE_MS)
        expect(car(3)).to_have_attribute("data-sha", new3)
        expect(car(3)).to_have_attribute("data-position", "2")
        assert kicker_text(car(1), tr["mr1"]["sha"][:7]) == tr["mr1"]["sha"][:7], "car 1 must not re-resolve"
        moved = anims(page, ["train-step", "train-leave"])
        assert any(a["id"] == "train-leave" and a["duration"] == ANIM_MS["train-leave"] for a in moved), moved
        assert any(a["id"] == "train-step" and (a["dy"] or 0) > 0 for a in moved), moved
        advance(page, KICK_LAST_LOCK_MS + 120)
        assert kicker_text(car(3), new3[:7]) == new3[:7]
        tick(base, 10000)
        run_all(base, w.pid)
        target = "main"
        _c_said(page, f"!{1} merged into {target}")
    assert heads(w.api("owner"), w.pid)["main"] == tr["mr1"]["sha"]


def test_wf_merge_train_phone_reduced(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = train_world(base, train_config(slow=True))
    tr = w.p["train"]
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/train?target=main", size=SMALL_PHONE,
                 reduced=True, record=True) as page:
        lst = page.get_by_role("list", name="Merge train")
        items = lst.get_by_role("listitem")
        expect(items).to_have_count(3)
        boxes = [items.nth(i).bounding_box() for i in range(3)]
        assert len({round(b["x"]) for b in boxes}) == 1 and boxes[0]["y"] < boxes[1]["y"] < boxes[2]["y"]
        for n in (1, 2, 3):
            sha = tr[f"mr{n}"]["sha"]
            car = lst.get_by_role("listitem", name=re.compile(rf"^Position {n}, !{n}, "))
            assert kicker_text(car, sha[:7]) == sha[:7]
        layout(page)
        w.api("owner").ok("DELETE", f"/api/projects/{w.pid}/merge_requests/2/train")
        new3 = {c["iid"]: c for c in w.api("owner").get(f"/api/projects/{w.pid}/train?target=main")["cars"]}[3]["sha"]
        expect(items).to_have_count(2, timeout=LIVE_MS)
        _c_said(page, car_moved(3, 2, new3[:7]))
        car3 = lst.get_by_role("listitem", name=re.compile(r"^Position 2, !3, "))
        assert kicker_text(car3, new3[:7]) == new3[:7]
        assert anims(page, ["train-step", "train-leave"]) == []


DEPLOY_CONFIG = """stages: [deploy]
ship:
  stage: deploy
  script:
    - write dist/app.txt shipped
  artifacts:
    paths: [dist/app.txt]
  environment:
    name: production
stage:
  stage: deploy
  script:
    - print staged
  environment:
    name: staging
"""


def deploy_world(base: str) -> World:
    return world(base, lambda t, u: {
        "protected_environments": [{"name": "production", "roles": "maintainer", "approvals": 1},
                                   {"name": "staging", "roles": "maintainer", "approvals": 2}],
        "commits": [cm("c1", "main", u["owner"], [act("create", "spurline.pipeline.yml", DEPLOY_CONFIG)], "First")]})


def latest_deployment(api: Api, pid: int, env: str) -> dict:
    return max(environment(api, pid, env)["deployments"], key=lambda d: d["number"])


def test_protected_deployment_approvals(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = deploy_world(base)
    plid = gpush(w, "rel", "dev", [act("create", "r.txt", "r\n")], "Release", start_ref="main")["pipeline"]["id"]
    owner = w.api("owner")
    dep = latest_deployment(owner, w.pid, "production")
    assert dep["status"] == "awaiting_approval" and dep["required"] == 1
    assert job(pipeline(owner, plid), "ship")["status"] == "manual"
    url = f"/api/projects/{w.pid}/deployments/{dep['id']}/approvals"
    err(w.api("dev").req("POST", url, {"status": "approved"}), 403, "self_approval", "You can't approve your own deployment.")
    err(w.api("rev").req("POST", url, {"status": "approved"}), 403, "forbidden",
        "You aren't allowed to approve deployments to production.")
    key = idempotency_key()
    first = w.api("maint").req("POST", url, {"status": "approved"}, headers={"Idempotency-Key": key})
    assert first.status_code == 200, first.text
    replay = w.api("maint").req("POST", url, {"status": "approved"}, headers={"Idempotency-Key": key})
    assert replay.json() == first.json() and replay.headers.get("Idempotent-Replay") == "true"
    assert latest_deployment(owner, w.pid, "production")["status"] == "approved"
    assert job(pipeline(owner, plid), "ship")["status"] == "pending"
    err(w.api("owner").req("POST", url, {"status": "approved"}), 409, "not_awaiting",
        "This deployment isn't waiting for approval.")
    run_all(base, w.pid)
    assert latest_deployment(owner, w.pid, "production")["status"] == "success"
    staging = latest_deployment(owner, w.pid, "staging")
    surl = f"/api/projects/{w.pid}/deployments/{staging['id']}/approvals"
    w.api("maint").ok("POST", surl, {"status": "approved"})
    err(w.api("maint").req("POST", surl, {"status": "approved"}), 409, "already_approved",
        "You already approved this deployment.")
    tick(base, APPROVAL_MS + 1)
    expired = latest_deployment(owner, w.pid, "staging")
    assert [a["expired"] for a in expired["approvals"]] == [True]
    w.api("owner").ok("POST", surl, {"status": "approved"})
    assert latest_deployment(owner, w.pid, "staging")["status"] == "awaiting_approval"


def test_wf_environments_approve(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = deploy_world(base)
    gpush(w, "rel", "dev", [act("create", "r.txt", "r\n")], "Release", start_ref="main")
    env_id = environment(w.api("owner"), w.pid, "production")["id"]
    path = f"/projects/{w.pid}/-/environments/{env_id}"
    with as_user(browser, base, w.u["dev"], path) as dev_page:
        expect(dev_page.get_by_text(f"Waiting for approval: {0} of {1}")).to_be_visible()
        click(dev_page.get_by_role("button", name="Approve deployment"))
        expect(dev_page.get_by_text("You can't approve your own deployment.").first).to_be_visible()
        announced(dev_page, "You can't approve your own deployment.")
    assert latest_deployment(w.api("owner"), w.pid, "production")["approvals"] == []
    with as_user(browser, base, w.u["owner"], "/") as page:
        page.clock.set_system_time(dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=5))
        page.goto(base + path)
        click(page.get_by_role("button", name="Approve deployment"))
        announced(page, f"Deployment approval recorded: {1} of {1}.")
        expect(page.get_by_text("This approval expired.")).to_have_count(0)
        tick(base, APPROVAL_MS + 1)
        expect(page.get_by_text("This approval expired.").first).to_be_visible(timeout=LIVE_MS)
    lapsed = latest_deployment(w.api("owner"), w.pid, "production")["approvals"]
    assert [a["user"] for a in lapsed] == [w.u["owner"]]


PROD_CONFIG = """stages: [deploy]
ship:
  stage: deploy
  script:
    - write dist/app.txt shipped
    - exit $CODE
  artifacts:
    paths: [dist/app.txt]
    when: always
  environment:
    name: production
plain:
  stage: deploy
  script:
    - print plain
  environment:
    name: staging
"""


def prod_world(base: str) -> World:
    return world(base, lambda t, u: {"variables": {"CODE": "0"}, "commits": [
        cm("c1", "main", u["owner"], [act("create", "spurline.pipeline.yml", PROD_CONFIG)], "First")]})


def deploy_once(w: World, code: str = "0") -> int:
    w.api("owner").ok("PUT", f"/api/projects/{w.pid}/variables/CODE", {"value": code})
    plid = gpush(w, "main", "owner", [act("create", f"d{uuid.uuid4().hex[:6]}.txt", "d\n")], "Deploy")["pipeline"]["id"]
    run_all(w.base, w.pid)
    return plid


def test_rollback_outdated_autostop(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = prod_world(base)
    owner = w.api("owner")
    deploy_once(w)
    deploy_once(w)
    env = environment(owner, w.pid, "production")
    res = owner.ok("POST", f"/api/environments/{env['id']}/rollback", {"deployment": 1}, status=201)
    deps = {d["number"]: d for d in environment(owner, w.pid, "production")["deployments"]}
    assert res["number"] == 3 and deps[3]["status"] == "success" and deps[2]["status"] == "rolled_back"
    assert deps[3]["sha"] == deps[1]["sha"]
    staging = environment(owner, w.pid, "staging")
    err(owner.req("POST", f"/api/environments/{staging['id']}/rollback", {"deployment": 1}), 409, "artifact_gone",
        "Can't roll back: deployment 1 has no artifact.")
    tick(base, ARTIFACT_TTL_MS + 1)
    err(owner.req("POST", f"/api/environments/{env['id']}/rollback", {"deployment": 1}), 409, "artifact_gone",
        "Can't roll back: its artifact has expired.")
    manual = PROD_CONFIG.replace("  environment:\n    name: production", "  when: manual\n  environment:\n    name: production")
    older = gpush(w, "main", "owner", [act("update", "spurline.pipeline.yml", manual)], "Manual A")["pipeline"]["id"]
    run_all(base, w.pid)
    newer = gpush(w, "main", "owner", [act("create", "n.txt", "n\n")], "Manual B")["pipeline"]["id"]
    owner.ok("POST", f"/api/jobs/{job(pipeline(owner, newer), 'ship')['id']}/play", {"variables": {}})
    run_all(base, w.pid)
    current = latest_deployment(owner, w.pid, "production")
    owner.ok("POST", f"/api/jobs/{job(pipeline(owner, older), 'ship')['id']}/play", {"variables": {}})
    run_all(base, w.pid)
    old_job = job(pipeline(owner, older), "ship")
    assert old_job["status"] == "failed" and old_job["failure_reason"] == "outdated_deployment"
    review = ("rv:\n  stage: build\n  script:\n    - print r\n  environment:\n    name: review/$CI_MERGE_REQUEST_IID\n")
    review_iids: dict[str, int] = {}
    for branch in ("ra", "rb"):
        gpush(w, branch, "dev", [act("create", f"{branch}.txt", "x\n")], branch, start_ref="main")
        review_iids[branch] = open_mr(w.api("dev"), w.pid, branch, f"Review {branch}")
        gpush(w, branch, "dev", [act("update", "spurline.pipeline.yml", review)], "Review")
        run_all(base, w.pid)
    ra = environment(owner, w.pid, f"review/{review_iids['ra']}")
    rb = environment(owner, w.pid, f"review/{review_iids['rb']}")
    assert ra["auto_stop_at"] is not None
    owner.ok("POST", f"/api/environments/{rb['id']}/keep")
    assert environment(owner, w.pid, f"review/{review_iids['rb']}")["auto_stop_at"] is None
    tick(base, AUTO_STOP_MS + 1)
    assert environment(owner, w.pid, f"review/{review_iids['ra']}")["state"] == "stopped"
    assert environment(owner, w.pid, f"review/{review_iids['rb']}")["state"] == "available"


def test_wf_environments_rollback(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = prod_world(base)
    owner = w.api("owner")
    first = deploy_once(w)
    deploy_once(w)
    build_id = job(pipeline(owner, first), "ship")["id"]
    assert f"artifacts/{build_id}/dist/app.txt" in S3().keys(f"artifacts/{build_id}/")
    env_id = environment(owner, w.pid, "production")["id"]
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/environments/{env_id}") as page:
        click(page.get_by_role("button", name=f"Roll back to deployment {1}"))
        eventually(lambda: any(d["number"] == 3 and d["status"] == "success"
                               for d in environment(owner, w.pid, "production")["deployments"]),
                   "rollback created deployment 3 as success")
        try:
            storage(base, True)
            click(page.get_by_role("button", name=f"Roll back to deployment {1}"))
            expect(page.get_by_text("File storage is unavailable. Uploads, artifacts and exports are paused.").first
                   ).to_be_visible()
        finally:
            storage(base, False)
    numbers = [d["number"] for d in environment(owner, w.pid, "production")["deployments"]]
    assert max(numbers) == 3


def test_delivery_metrics(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"variables": {"CODE": "0"}, "commits": [cm("c1", "main", u["owner"], [
        act("create", "spurline.pipeline.yml", "ship:\n  stage: deploy\n  script:\n    - exit $CODE\n"
                                               "  environment:\n    name: production\n")], "First")]})
    now = now_ms(base)
    day = 86400000
    hour = 3600000
    target = (now // day + 2) * day - hour
    grade(base, "/api/grading/clock", {"set_ms": target})
    owner = w.api("owner")
    for code, gap in (("0", hour), ("1", 2 * hour), ("0", 0)):
        owner.ok("PUT", f"/api/projects/{w.pid}/variables/CODE", {"value": code})
        gpush(w, "main", "owner", [act("create", f"m{uuid.uuid4().hex[:6]}.txt", "m\n")], "Ship")
        run_all(base, w.pid)
        tick(base, gap)
    utc = owner.get(f"/api/projects/{w.pid}/metrics?zone=UTC&days=7")
    assert utc == {"deployment_frequency": 0.29, "lead_time_hours": None, "change_failure_rate": 50.0,
                   "recovery_time_hours": 2.0}, utc
    tick(base, 5 * day + 23 * hour)
    utc = owner.get(f"/api/projects/{w.pid}/metrics?zone=UTC&days=7")
    tokyo = owner.get(f"/api/projects/{w.pid}/metrics?zone=Asia/Tokyo&days=7")
    assert utc["deployment_frequency"] == 0.14 and tokyo["deployment_frequency"] == 0.29
    err(owner.req("GET", f"/api/projects/{w.pid}/metrics?zone=Mars/Base&days=7"), 422, "validation",
        "Unknown time zone Mars/Base.")
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/metrics?zone=Asia/Tokyo&days=7") as page:
        region = page.get_by_role("region", name="Delivery metrics")
        for text in ("Deployment frequency 0.29 per day", "Lead time No data", "Change failure rate 50.0%",
                     "Recovery time 2.00 hours"):
            expect(region).to_contain_text(text)


def board_world(base: str) -> World:
    return world(base, lambda t, u: {
        "issues": [issue("i1", FIX_TITLE, u["owner"], labels=["workflow::doing", "priority::high"], weight=3),
                   issue("i2", TIDY_TITLE, u["owner"], labels=["workflow::doing"]),
                   issue("i3", SHIP_TITLE, u["owner"], labels=["workflow::review"]),
                   issue("i4", "Loose end", u["owner"])],
        "boards": [{"key": "b1", "name": "Development", "kind": "label",
                    "lists": ["workflow::doing", "workflow::review"]}]},
        extra=lambda t, u: {"group_labels": [{"group": f"g{t}", "name": n, "description": ""}
                                             for n in ("workflow::doing", "workflow::review", "priority::high")]})


def board_state(api: Api, board: int, query: str = "") -> dict[str, dict]:
    return {lst["title"]: lst for lst in api.get(f"/api/boards/{board}{query}")["lists"]}


def card(state: dict[str, dict], issue_id: int) -> dict:
    return next(c for lst in state.values() for c in lst["cards"] if c["issue"] == issue_id)


def test_board_moves_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = board_world(base)
    rep = w.api("rep")
    b = w.p["boards"]["b1"]
    lists = b["lists"]
    ids = {k: w.p["issues"][k]["id"] for k in ("i1", "i2", "i3", "i4")}
    st = board_state(rep, b["id"])
    v1 = card(st, ids["i1"])["version"]
    res = rep.ok("POST", f"/api/boards/{b['id']}/moves", {"issue": ids["i1"], "to_list": lists["workflow::review"],
                                                         "after_id": ids["i3"], "version": v1})
    review = [lst for lst in res["lists"] if lst["id"] == lists["workflow::review"]][0]
    assert review["issue_ids"] == [ids["i3"], ids["i1"]]
    assert res["notes"] == ["Replaced ~workflow::doing with ~workflow::review."]
    labels = set(issue_get(rep, w.pid, w.issue_iid("i1"))["labels"])
    assert labels == {"workflow::review", "priority::high"}
    err(w.api("dev").req("POST", f"/api/boards/{b['id']}/moves", {"issue": ids["i1"], "to_list": lists["Open"],
                                                                   "after_id": None, "version": v1}), 409, "stale_card",
        f"{w.u['rep']} moved this card first. It is now in workflow::review.")
    st = board_state(rep, b["id"])
    res = rep.ok("POST", f"/api/boards/{b['id']}/moves", {"issue": ids["i2"], "to_list": lists["workflow::review"],
                                                         "after_id": ids["i4"], "version": card(st, ids["i2"])["version"]})
    assert [lst for lst in res["lists"] if lst["id"] == lists["workflow::review"]][0]["issue_ids"][-1] == ids["i2"]
    st = board_state(rep, b["id"])
    rep.ok("POST", f"/api/boards/{b['id']}/moves", {"issue": ids["i3"], "to_list": lists["Closed"], "after_id": None,
                                                    "version": card(st, ids["i3"])["version"]})
    assert issue_get(rep, w.pid, w.issue_iid("i3"))["state"] == "closed"
    st = board_state(rep, b["id"])
    rep.ok("POST", f"/api/boards/{b['id']}/moves", {"issue": ids["i3"], "to_list": lists["Open"], "after_id": None,
                                                    "version": card(st, ids["i3"])["version"]})
    reopened = issue_get(rep, w.pid, w.issue_iid("i3"))
    assert reopened["state"] == "opened"
    st = board_state(rep, b["id"])
    rep.ok("POST", f"/api/boards/{b['id']}/moves", {"issue": ids["i1"], "to_list": lists["Open"], "after_id": None,
                                                    "version": card(st, ids["i1"])["version"]})
    assert set(issue_get(rep, w.pid, w.issue_iid("i1"))["labels"]) == {"priority::high"}
    filtered = board_state(rep, b["id"], "?label=priority::high")
    assert sum(lst["count"] for lst in filtered.values()) == 1
    st = board_state(rep, b["id"])
    assert w.api("guest").req("POST", f"/api/boards/{b['id']}/moves", {
        "issue": ids["i4"], "to_list": lists["workflow::doing"], "after_id": None,
        "version": card(st, ids["i4"])["version"]}).status_code == 403


def test_board_concurrent_moves(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = board_world(base)
    b = w.p["boards"]["b1"]
    issue_id = w.p["issues"]["i2"]["id"]
    version = card(board_state(w.api("rep"), b["id"]), issue_id)["version"]
    clients = [Api(base, w.u[k]) for k in ("rep", "dev", "rev", "maint", "owner", "rep")]
    targets = [b["lists"][n] for n in ("workflow::review", "Open", "Closed", "workflow::review", "Open", "Closed")]

    def move(pair: tuple[Api, int]) -> httpx.Response:
        api, target = pair
        return api.req("POST", f"/api/boards/{b['id']}/moves", {"issue": issue_id, "to_list": target, "after_id": None,
                                                                "version": version})

    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(move, zip(clients, targets)))
    codes = sorted(r.status_code for r in results)
    assert codes == [200] + [409] * 5, codes
    for r in results:
        if r.status_code == 409:
            assert r.json()["error"] == "stale_card"


def test_wf_boards_planning_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = board_world(base)
    n = w.issue_iid("i1")
    path = f"/projects/{w.pid}/-/boards/{w.p['boards']['b1']['id']}"
    doing, review = "workflow::doing", "workflow::review"
    with as_user(browser, base, w.u["dev"], path) as watcher, as_user(browser, base, w.u["rep"], path) as page:
        expect(watcher.get_by_role("list", name=review)).to_contain_text("1 issue")
        item = page.get_by_role("listitem", name=re.compile("^" + re.escape(f"Issue #{n}, {FIX_TITLE},")))
        expect(item).to_have_accessible_name(f"Issue #{n}, {FIX_TITLE}, weight {3}, {2} labels, in {doing}")
        item.focus()
        page.keyboard.press("Space")
        expect(item).to_have_attribute("data-lifted", "true")
        announced(page, f"Lifted Issue #{n}.")
        page.keyboard.press("ArrowRight")
        announced(page, re.compile(re.escape(f"Over {review}, position ") + r"\d+\."))
        page.keyboard.press("Space")
        announced(page, re.compile(re.escape(f"Dropped in {review}, position ") + r"\d+\."))
        landed = re.compile(re.escape(f"in {review}") + "$")
        expect(item).to_have_accessible_name(landed)
        expect(item).to_be_focused()
        expect(watcher.get_by_role("list", name=review)).to_contain_text(f"{2} issues", timeout=LIVE_MS)
        page.keyboard.press("Space")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Escape")
        announced(page, "Move canceled.")
        expect(item).to_have_accessible_name(landed)
        expect(item).to_be_focused()
    assert "workflow::review" in issue_get(w.api("rep"), w.pid, n)["labels"]


def test_wf_boards_planning_filters_url(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = board_world(base)
    path = f"/projects/{w.pid}/-/boards/{w.p['boards']['b1']['id']}"
    with as_user(browser, base, w.u["rep"], path) as page:
        fix = page.get_by_role("listitem", name=re.compile(re.escape(f", {FIX_TITLE},")))
        tidy = page.get_by_role("listitem", name=re.compile(re.escape(f", {TIDY_TITLE},")))
        label, term = "priority::high", SHIP_TITLE.split()[0]
        select(page.get_by_role("combobox", name="Filter by label"), label)
        eventually(lambda: url_query(page).get("label") == [label], "the label filter is kept in the URL")
        expect(tidy).to_have_count(0)
        expect(fix).to_have_count(1)
        fill(page.get_by_role("searchbox", name="Filter cards"), term)
        eventually(lambda: url_query(page).get("search") == [term], "the search filter is kept in the URL")
        expect(fix).to_have_count(0)
        page.go_back()
        eventually(lambda: "search" not in url_query(page), "Back restores the address without the search filter")
        expect(fix).to_have_count(1)
        page.go_back()
        eventually(lambda: "label" not in url_query(page), "Back restores the address without the label filter")
        expect(tidy).to_have_count(1)
        page.go_forward()
        eventually(lambda: url_query(page).get("label") == [label], "Forward restores the label filter")
        page.reload()
        expect(tidy).to_have_count(0)
        expect(fix).to_have_count(1)


def test_quick_actions_and_scoped_labels(app_url: str) -> None:
    base = app_url.rstrip("/")
    labels = ["priority::high", "priority::low", "type::bug", "workflow::doing"]
    w = world(base, lambda t, u: {
        "milestones": [{"key": "m1", "title": "S1", "start": "2026-02-02", "due": "2026-02-13", "time_zone": "UTC"}],
        "issues": [issue("i1", "Quick", u["owner"], labels=["priority::low"])]},
        extra=lambda t, u: {"group_labels": [{"group": f"g{t}", "name": n, "description": ""} for n in labels]})
    dev = w.api("dev")
    n = w.issue_iid("i1")
    body = "\n".join(["Working on it", "/label ~priority::high ~type::bug", "/weight 5", "/estimate 1w 6d",
                      "/spend 2h", f"/assign @{w.u['dev']}", "/milestone %S1", f"/due {DUE_DATE}", UNKNOWN_ACTION,
                      "/weight 101", f"/label ~nolabel{w.t}", "/estimate 3x"])
    res = dev.ok("POST", f"/api/projects/{w.pid}/issues/{n}/notes", {"body": body}, status=201)
    assert res["results"] == ["Replaced ~priority::low with ~priority::high.", "Added ~type::bug.", "Set weight to 5.",
                              "Set estimate to 2w 1d.", "Added 2h of time spent.", f"Assigned @{w.u['dev']}.",
                              "Set milestone %S1.", f"Set due date to {DUE_DATE}.",
                              "Could not apply /weight: weight must be 0 to 100.",
                              f"Could not apply /label: label ~nolabel{w.t} doesn't exist.",
                              "Could not apply /estimate: invalid duration 3x."]
    stored = res["note"]["body"] if isinstance(res["note"], dict) else str(res["note"])
    assert UNKNOWN_ACTION in stored and "/weight" not in stored
    got = issue_get(dev, w.pid, n)
    assert set(got["labels"]) == {"priority::high", "type::bug"} and got["weight"] == 5
    assert got["due_date"] == DUE_DATE
    notes = issue_notes(dev, w.pid, n)
    assert notes.count("Replaced ~priority::low with ~priority::high.") == 1
    dev.ok("PATCH", f"/api/projects/{w.pid}/issues/{n}", {"add_labels": ["priority::low"]})
    after = issue_notes(dev, w.pid, n)
    assert after[len(notes):] == ["Replaced ~priority::high with ~priority::low."]
    dev.ok("PATCH", f"/api/projects/{w.pid}/issues/{n}", {"add_labels": ["workflow::doing"], "remove_labels": ["type::bug"]})
    assert issue_notes(dev, w.pid, n)[len(after):] == ["Added ~workflow::doing.", "Removed ~type::bug."]
    err(dev.req("PATCH", f"/api/projects/{w.pid}/issues/{n}", {"weight": 101}), 422, "validation", "Weight must be 0 to 100.")


def test_epics_milestones_burndown(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    today = dt.datetime.fromtimestamp(now_ms(base) / 1000, tz=dt.timezone.utc).date()
    w = world(base, lambda t, u: {
        "milestones": [{"key": "m1", "title": "M1", "start": M1_START, "due": M1_DUE, "time_zone": "UTC"},
                       {"key": "m2", "title": "M2", "start": M2_START, "due": M2_DUE, "time_zone": "UTC"},
                       {"key": "m3", "title": "Now", "start": today.isoformat(),
                        "due": (today + dt.timedelta(days=3)).isoformat(), "time_zone": "UTC"}],
        "issues": [issue("i1", "Early", u["owner"], milestone="m1"), issue("i2", "Late", u["owner"], milestone="m2"),
                   issue("i3", "A", u["owner"], milestone="m3", weight=3),
                   issue("i4", "B", u["owner"], milestone="m3", weight=2)]},
        extra=lambda t, u: {"epics": [{"key": "e1", "group": f"g{t}", "title": "Parent", "parent": None,
                                       "author": u["owner"], "issues": ["p/i1", "p/i2"]},
                                      {"key": "e2", "group": f"g{t}", "title": "Child", "parent": "e1",
                                       "author": u["owner"], "issues": []}]})
    owner = w.api("owner")
    gid = w.raw["groups"]["g"]["id"]
    e1, e2 = w.raw["epics"]["e1"]["iid"], w.raw["epics"]["e2"]["iid"]
    epic = owner.get(f"/api/groups/{gid}/epics/{e1}")
    assert (epic["start_date"], epic["due_date"]) == (M1_START, M2_DUE)
    assert [c["iid"] for c in epic["children"]] == [e2]
    err(owner.req("POST", f"/api/groups/{gid}/epics", {"title": "Grandchild", "description": "", "parent": e2}), 422,
        "epic_depth", "Epics can only nest one level.")
    with as_user(browser, base, w.u["owner"], f"/groups/{w.group}/-/epics/{e1}") as page:
        dates = page.get_by_role("region", name="Epic dates")
        expect(dates).to_contain_text(f"Start {M1_START}")
        expect(dates).to_contain_text(f"Due {M2_DUE}")
        page.goto(base + f"/groups/{w.group}/-/epics/{e2}")
        expect(page.get_by_role("region", name="Epic dates")).to_contain_text("Start not set")
        expect(page.get_by_role("link", name=f"Parent epic &{e1}")).to_be_visible()
    mid = w.p["milestones"]["m3"]["id"]
    owner.ok("PATCH", f"/api/projects/{w.pid}/issues/{w.issue_iid('i4')}", {"state_event": "close"})
    owner.ok("PATCH", f"/api/projects/{w.pid}/issues/{w.issue_iid('i3')}", {"weight": 4})
    points = owner.get(f"/api/projects/{w.pid}/milestones/{mid}/burndown")["points"]
    assert [p["day"] for p in points] == [(today + dt.timedelta(days=i)).isoformat() for i in range(4)]
    assert [p["remaining"] for p in points] == [4, 4, 4, 4]
    assert [p["future"] for p in points] == [False, True, True, True]


def test_promote_to_epic(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "labels": [{"name": "local", "description": ""}],
        "issues": [issue("i1", "Promote me", u["owner"], description="Body text", labels=["priority::high", "local"],
                         weight=4)]},
        extra=lambda t, u: {"group_labels": [{"group": f"g{t}", "name": "priority::high", "description": ""}]})
    n = w.issue_iid("i1")
    w.api("rev").ok("POST", f"/api/projects/{w.pid}/issues/{n}/notes", {"body": "Earlier comment"}, status=201)
    res = w.api("dev").ok("POST", f"/api/projects/{w.pid}/issues/{n}/notes", {"body": "/promote"}, status=201)
    match = re.fullmatch(r"Promoted to epic &(\d+)\.", res["results"][0])
    assert match, res["results"]
    epic = w.api("owner").get(f"/api/groups/{w.raw['groups']['s']['id']}/epics/{match.group(1)}")
    assert (epic["title"], epic["description"], epic["author"]) == ("Promote me", "Body text", w.u["owner"])
    assert epic["labels"] == ["priority::high"] or [lbl.get("name") for lbl in epic["labels"]] == ["priority::high"]
    bodies = [(note["author"], note["body"]) for note in epic["notes"]]
    assert bodies[0] == (w.u["rev"], "Earlier comment")
    assert [b for _, b in bodies[1:]] == [f"Copied from #{n}.", "Dropped labels: ~local."]
    assert issue_get(w.api("owner"), w.pid, n)["state"] == "closed"


def phone_world(base: str) -> World:
    return world(base, lambda t, u: {
        "approval_rules": [{"name": "Backend", "required": 1, "users": [u["rev"]], "groups": []}],
        "labels": [{"name": "workflow::doing", "description": ""}, {"name": "workflow::review", "description": ""}],
        "issues": [issue("i1", DRAG_TITLE, u["owner"], labels=["workflow::doing"])],
        "boards": [{"key": "b1", "name": "Development", "kind": "label", "lists": ["workflow::doing", "workflow::review"]}],
        "commits": [cm("c1", "main", u["owner"], [act("create", A_TS, "a\n"), act("create", B_TS, "b\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("update", A_TS, "a\nx\ny\n"), act("update", B_TS, "b\nz\n")],
                       "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})


def test_wf_phone_review_breakpoints(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = phone_world(base)
    path = f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}/changes"
    with as_user(browser, base, w.u["rev"], path) as page:
        files = page.get_by_role("navigation", name="Files")
        panel = page.get_by_role("complementary", name="Merge request panel")
        grid = page.get_by_role("grid", name="Diff")
        expect(files).to_be_visible()
        expect(panel).to_be_visible()
        assert in_view(files, DESK[0]) and in_view(panel, DESK[0])
        assert files.bounding_box()["x"] < grid.bounding_box()["x"] < panel.bounding_box()["x"]
        layout(page)
        page.set_viewport_size({"width": TABLET[0], "height": TABLET[1]})
        expect(page.get_by_role("button", name="Show files")).to_be_visible()
        assert not in_view(files, TABLET[0]) and in_view(panel, TABLET[0])
        assert grid.bounding_box()["x"] < panel.bounding_box()["x"]
        layout(page)
        click(page.get_by_role("button", name="Show files"))
        expect(page.get_by_role("navigation", name="Files")).to_be_visible()
        for size in (PHONE, SMALL_PHONE):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.goto(base + path)
            assert not in_view(page.get_by_role("complementary", name="Merge request panel"), size[0])
            layout(page)
            opener = page.get_by_role("button", name="Open panel")
            click(opener)
            sheet = page.get_by_role("dialog", name="Panel")
            expect(sheet).to_be_visible()
            tabs = sheet.get_by_role("tablist").get_by_role("tab")
            expect(tabs).to_have_text(["Checks", "Threads", "Files"])
            click(sheet.get_by_role("tab", name="Checks"))
            expect(sheet.get_by_role("region", name="Merge checks")).to_be_visible()
            expect(sheet.get_by_role("button", name="Approve")).to_be_visible()
            for _ in range(10):
                page.keyboard.press("Tab")
                assert page.evaluate("() => !!document.activeElement.closest('[role=dialog],dialog')")
            page.keyboard.press("Escape")
            expect(opener).to_be_focused()


def test_wf_phone_review_touch(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = phone_world(base)
    iid = w.iid("mr1")
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}") as author, \
            as_user(browser, base, w.u["rev"], f"/projects/{w.pid}/-/merge_requests/{iid}/changes?" +
                    urlencode({"file": A_TS}), size=PHONE, touch=True) as page:
        cdp = session(page)
        grid = page.get_by_role("grid", name="Diff")
        x, y = middle(grid)
        touch(cdp, "touchStart", x, y)
        touch(cdp, "touchMove", x - (SWIPE_MIN_PX - 20), y)
        touch(cdp, "touchEnd")
        eventually(lambda: url_query(page).get("file") == [A_TS], "a short swipe keeps the file")
        touch(cdp, "touchStart", x + 40, y)
        touch(cdp, "touchMove", x + 40 - (SWIPE_MIN_PX + 40), y + 5)
        touch(cdp, "touchEnd")
        announced(page, f"File {2} of {2}: {B_TS}")
        eventually(lambda: url_query(page).get("file") == [B_TS], "the swiped-to file is kept in the URL")
        row = grid.get_by_role("row", name=re.compile("^" + role_re(row_label(2, "added", B_TS))))
        box = row.bounding_box()
        assert box["height"] >= TOUCH_MIN_PX and box["width"] >= TOUCH_MIN_PX
        rx, ry = middle(row)
        touch(cdp, "touchStart", rx, ry)
        advance(page, LONG_PRESS_MS - 200)
        touch(cdp, "touchEnd")
        expect(page.get_by_role("dialog", name=f"Comment on line {2}")).to_have_count(0)
        touch(cdp, "touchStart", rx, ry)
        advance(page, LONG_PRESS_MS + 100)
        touch(cdp, "touchEnd")
        sheet = page.get_by_role("dialog", name=f"Comment on line {2}")
        expect(sheet.get_by_role("textbox", name="Comment")).to_be_visible()
        click(sheet.get_by_role("button", name="Cancel"))
        click(page.get_by_role("button", name="Open panel"))
        panel = page.get_by_role("dialog", name="Panel")
        click(panel.get_by_role("tab", name="Checks"))
        click(panel.get_by_role("button", name="Approve"))
        announced(page, "Approved. All approval rules are satisfied.")
        expect(author.get_by_role("region", name="Approvals")).to_contain_text(rule_count("Backend", 1, 1),
                                                                                timeout=LIVE_MS)
    assert mr(w.api("dev"), w.pid, iid)["approvals"]["approved_by"] == [w.u["rev"]]
    board = f"/projects/{w.pid}/-/boards/{w.p['boards']['b1']['id']}"
    with as_user(browser, base, w.u["rev"], board, size=PHONE, touch=True) as page:
        cdp = session(page)
        item = page.get_by_role("listitem", name=re.compile(re.escape(f", {DRAG_TITLE},")))
        sx, sy = middle(item)
        touch(cdp, "touchStart", sx, sy)
        advance(page, CARD_HOLD_MS + 50)
        target = page.get_by_role("list", name="workflow::review")
        target.scroll_into_view_if_needed()
        tx, ty = middle(target)
        touch(cdp, "touchMove", (sx + tx) / 2, (sy + ty) / 2)
        touch(cdp, "touchMove", tx, ty)
        touch(cdp, "touchEnd")
        eventually(lambda: "workflow::review" in issue_get(w.api("rev"), w.pid, w.issue_iid("i1"))["labels"],
                   "touch drop sends the board move")


def test_roles_and_visibility_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "approval_rules": [{"name": "Captains", "required": 1, "users": [f"cap{t}"], "groups": []}],
        "issues": [issue("i1", "Readable", u["owner"])],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]},
        sub_members=lambda u: [{"username": u["rev"], "role": "maintainer"}],
        extra=lambda t, u: {"users": [{"username": f"cap{t}", "password": PW, "time_zone": "UTC"}],
                            "custom_roles": [{"key": "rc", "group": f"g{t}", "name": "captain", "base": "reporter",
                                              "permissions": ["approve"]}]})
    owner = w.api("owner")
    gid = w.raw["groups"]["g"]["id"]
    owner.ok("POST", f"/api/groups/{gid}/members", {"username": f"cap{w.t}", "custom_role": w.raw["custom_roles"]["rc"]["id"]},
             status=201)
    assert w.api("rev").get(f"/api/projects/{w.pid}")["my_role"] == "maintainer"
    assert w.api("dev").get(f"/api/projects/{w.pid}")["my_role"] == "developer"
    assert api_commit(w.api("dev"), w.pid, "feat", [act("create", "d.txt", "d\n")], "Dev").status_code == 201
    err(api_commit(w.api("rep"), w.pid, "feat", [act("create", "r.txt", "r\n")], "Rep"), 403, "forbidden")
    assert w.api("rep").req("GET", f"/api/projects/{w.pid}/tree?ref=main&path=").status_code == 200
    err(w.api("guest").req("GET", f"/api/projects/{w.pid}/tree?ref=main&path="), 403, "forbidden")
    assert w.api("guest").req("GET", f"/api/projects/{w.pid}/issues/{w.issue_iid('i1')}").status_code == 200
    err(w.api("out").req("GET", f"/api/projects/{w.pid}"), 404, "not_found")
    err(w.api("out").req("GET", f"/api/projects/{w.pid}/issues/{w.issue_iid('i1')}"), 404, "not_found")
    cap = w.api(f"cap{w.t}")
    cap.ok("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/approve", {"sha": heads(owner, w.pid)["feat"]})
    err(api_commit(cap, w.pid, "feat", [act("create", "c.txt", "c\n")], "Cap"), 403, "forbidden")
    err(w.api("dev").req("PATCH", f"/api/projects/{w.pid}/settings", {"merge_trains": True}), 403, "forbidden")
    w.api("rev").ok("PATCH", f"/api/projects/{w.pid}/settings", {"merge_trains": True})
    sub = w.raw["groups"]["s"]["id"]
    third = owner.ok("POST", "/api/groups", {"name": "lvthree", "parent": sub, "visibility": "private"}, status=201)
    fourth = owner.ok("POST", "/api/groups", {"name": "lvfour", "parent": third["id"], "visibility": "private"}, status=201)
    err(owner.req("POST", "/api/groups", {"name": "lvfive", "parent": fourth["id"], "visibility": "private"}), 422,
        "validation", "Groups can only nest 4 levels.")
    err(owner.req("POST", "/api/groups", {"name": "loud", "parent": gid, "visibility": "public"}), 422, "visibility",
        "Visibility can't exceed the parent group's: private.")
    internal = owner.ok("POST", "/api/projects", {"group": gid, "slug": "open", "visibility": "private",
                                                  "default_branch": "main"}, status=201)
    owner.ok("PATCH", f"/api/groups/{gid}", {"visibility": "internal"})
    owner.ok("PATCH", f"/api/projects/{internal['id']}/settings", {"visibility": "internal"})
    out = w.api("out")
    assert out.req("GET", f"/api/projects/{internal['id']}").status_code == 200
    out.ok("POST", f"/api/projects/{internal['id']}/issues", {"title": "From outside"}, status=201)
    assert out.req("POST", f"/api/projects/{internal['id']}/labels", {"name": "x", "description": ""}).status_code == 403
    assert owner.req("DELETE", f"/api/groups/{gid}/members/{w.u['dev']}").status_code == 204
    err(w.api("dev").req("GET", f"/api/projects/{w.pid}"), 404, "not_found")


def test_wf_access_roles_protected_editor(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    before = heads(w.api("owner"), w.pid)["main"]
    readme = "README.md"
    with as_user(browser, base, w.u["dev"],
                 f"/projects/{w.pid}/-/edit?" + urlencode({"ref": "main", "path": readme})) as page:
        fill(page.get_by_role("textbox", name=f"Edit {readme}"), "changed\n")
        fill(page.get_by_role("textbox", name="Commit message"), "Direct push")
        click(page.get_by_role("button", name="Commit"))
        expect(page.get_by_text("You can't push to protected branch main.").first).to_be_visible()
        announced(page, "You can't push to protected branch main.")
    assert heads(w.api("owner"), w.pid)["main"] == before


def audit_events(api: Api, url: str) -> list[dict]:
    return api.get(url)["events"]


def test_audit_events_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = review_world(base)
    owner = w.api("owner")
    proj = f"/api/projects/{w.pid}/audit"
    owner.ok("PATCH", f"/api/projects/{w.pid}/settings", {"merge_trains": True})
    owner.ok("PUT", f"/api/projects/{w.pid}/protected_branches/release%2F%2A",
             {"allowed_to_push": "maintainer", "allowed_to_merge": "developer"})
    owner.ok("PUT", f"/api/projects/{w.pid}/variables/TOKEN_A", {"value": "one"})
    w.api("rev").ok("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/approve",
                    {"sha": heads(owner, w.pid)["feat"]})
    events = audit_events(owner, proj)
    actions = [e["action"] for e in events]
    assert actions[:4] == ["approval.add", "variable.set", "protected_branch.set", "project.settings"]
    by = {e["action"]: e for e in events}
    assert (by["project.settings"]["before"], by["project.settings"]["after"]) == ({"merge_trains": False}, {"merge_trains": True})
    assert by["project.settings"]["actor"] == w.u["owner"] and by["project.settings"]["target"] == w.path
    assert by["protected_branch.set"]["target"] == f"{w.path}:release/*"
    assert by["protected_branch.set"]["after"] == {"allowed_to_push": "maintainer", "allowed_to_merge": "developer"}
    assert by["variable.set"]["after"] == {"value": "one"} and by["variable.set"]["target"] == f"{w.path}:TOKEN_A"
    assert by["approval.add"]["target"] == f"{w.path}!{w.iid('mr1')}"
    assert (by["approval.add"]["before"], by["approval.add"]["after"]) == (None, {"user": w.u["rev"]})
    gid = w.raw["groups"]["g"]["id"]
    owner.ok("POST", f"/api/groups/{gid}/custom_roles", {"name": "auditor", "base": "reporter",
                                                         "permissions": ["read_audit"]}, status=201)
    group_events = audit_events(owner, f"/api/groups/{gid}/audit")
    assert group_events[0]["action"] == "custom_role.create" and group_events[0]["target"] == f"{w.group}:auditor"
    assert group_events[0]["after"] == {"base": "reporter", "permissions": ["read_audit"]}
    err(w.api("maint").req("GET", proj), 403, "forbidden")
    assert w.api("maint").req("GET", f"/api/groups/{gid}/audit").status_code == 403


def test_wf_access_roles_live_role(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "members": [{"username": u["out"], "role": "developer"}],
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    owner = w.api("owner")
    with as_user(browser, base, w.u["out"], f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}") as page:
        button = page.get_by_role("button", name="Close merge request")
        button.focus()
        owner.ok("PATCH", f"/api/projects/{w.pid}/members/{w.u['out']}", {"role": "reporter"})
        announced(page, f"Your role in {w.path} is now reporter.")
        expect(button).to_have_count(0, timeout=LIVE_MS)
        expect(page.get_by_role("main")).to_be_focused()
        assert owner.req("DELETE", f"/api/projects/{w.pid}/members/{w.u['out']}").status_code == 204
        expect(page.get_by_text(f"You no longer have access to {w.path}.").first).to_be_visible(timeout=LIVE_MS)
        announced(page, f"You no longer have access to {w.path}.")
    events = audit_events(owner, f"/api/projects/{w.pid}/audit")
    target = f"{w.path}:{w.u['out']}"
    upd = [e for e in events if e["action"] == "member.update" and e["target"] == target][0]
    rem = [e for e in events if e["action"] == "member.remove" and e["target"] == target][0]
    assert (upd["before"], upd["after"]) == ({"role": "developer"}, {"role": "reporter"})
    assert (rem["before"], rem["after"]) == ({"role": "reporter"}, None)


def confidential_world(base: str) -> World:
    return world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "issues": [issue("pub", f"Visible {t}", u["owner"]),
                   issue("sec", f"{HIDDEN_PREFIX} {t}", u["owner"], confidential=True)],
        "merge_requests": [mrq("mr1", "feat", u["dev"], description="Closes #1 and Closes #2")]},
        visibility="internal")


def test_confidential_issues_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = confidential_world(base)
    sec, pub = w.issue_iid("sec"), w.issue_iid("pub")
    for who in ("out", "guest"):
        api = w.api(who)
        err(api.req("GET", f"/api/projects/{w.pid}/issues/{sec}"), 404, "not_found")
        found = search(api, "issues", w.t)
        assert found["count"] == 1 and len(found["results"]) == 1
    assert mr(w.api("out"), w.pid, w.iid("mr1"))["closes"] == [pub]
    assert sorted(mr(w.api("rep"), w.pid, w.iid("mr1"))["closes"]) == sorted([pub, sec])
    own = w.api("out").ok("POST", f"/api/projects/{w.pid}/issues", {"title": f"Mine {w.t}", "confidential": True}, status=201)
    assert issue_get(w.api("out"), w.pid, own["iid"])["confidential"] is True
    assert w.api("rep").req("GET", f"/api/projects/{w.pid}/issues/{sec}").status_code == 200
    w.api("dev").ok("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/merge",
                    {"sha": heads(w.api("dev"), w.pid)["feat"]})
    closed = issue_get(w.api("owner"), w.pid, sec)
    assert closed["state"] == "closed" and f"Closed by !{w.iid('mr1')}." in issue_notes(w.api("owner"), w.pid, sec)


def test_wf_access_roles_confidential_search(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = confidential_world(base)
    route = "/search?" + urlencode({"scope": "issues", "q": w.t})
    hidden = f"{HIDDEN_PREFIX} {w.t}"
    with as_user(browser, base, w.u["out"], route) as page:
        expect(page.get_by_role("searchbox", name="Search")).to_have_value(w.t)
        expect(page.get_by_text(f"{1} results")).to_be_visible()
        expect(page.get_by_role("list", name="Results").get_by_role("listitem")).to_have_count(1)
        expect(page.get_by_text(hidden)).to_have_count(0)
        page.goto(base + f"/projects/{w.pid}/-/issues/{w.issue_iid('sec')}")
        expect(page.get_by_text(hidden)).to_have_count(0)
    with as_user(browser, base, w.u["rep"], route) as page:
        expect(page.get_by_text(f"{2} results")).to_be_visible()
    assert search(w.api("out"), "issues", w.t)["count"] == 1


def test_hashes_and_commit_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [cm("c1", "main", "asha", [act("create", "README.md", "hello\n")],
                                                  "First commit")]})
    assert w.p["commits"]["c1"] == FIRST_COMMIT
    dev = w.api("dev")
    tree = dev.get(f"/api/projects/{w.pid}/tree?ref=main&path=")
    assert tree["id"] == ROOT_TREE and [(e["name"], e["id"], e["type"]) for e in tree["entries"]] == [
        ("README.md", README_BLOB, "blob")]
    r = api_commit(dev, w.pid, "feat", [act("create", "src/a.ts", "a\n")], "Add a  \n", start_ref="main")
    assert r.status_code == 201, r.text
    info = dev.get(f"/api/projects/{w.pid}/commits/{r.json()['commit']}")
    assert info["message"] == "Add a"
    assert r.json()["commit"] == commit_id(tree_of({"README.md": "hello\n", "src/a.ts": "a\n"}), [FIRST_COMMIT],
                                           w.u["dev"], unix(info["authored_at"]), w.u["dev"], unix(info["committed_at"]),
                                           "Add a")
    head = r.json()["commit"]
    err(api_commit(dev, w.pid, "feat", [act("create", "ok.txt", "ok\n"), act("update", "missing.txt", "m\n")], "Two"),
        422, "validation", "File missing.txt does not exist.")
    err(api_commit(dev, w.pid, "feat", [act("create", "README.md", "again\n")], "Dup"), 422, "validation",
        "File README.md already exists.")
    assert heads(dev, w.pid)["feat"] == head
    assert dev.req("GET", f"/api/projects/{w.pid}/files?ref=feat&path=ok.txt").status_code == 404
    err(api_commit(dev, w.pid, "feat", [act("create", "s.txt", "s\n")], "Stale", base_commit=FIRST_COMMIT), 409,
        "stale_base", f"Your base commit {FIRST_COMMIT[:7]} is behind feat at {head[:7]}. Refresh and try again.")
    err(api_commit(dev, w.pid, "feat", [act("create", "s.txt", "s\n")], "Null", base_commit=None), 409, "stale_base",
        f"Your base commit none is behind feat at {head[:7]}. Refresh and try again.")
    err(api_commit(dev, w.pid, "nob", [act("create", "s.txt", "s\n")], "Missing", base_commit=head), 409, "stale_base",
        f"Your base commit {head[:7]} is behind nob at none. Refresh and try again.")
    err(api_commit(dev, w.pid, "feat", [act("create", "s.txt", "s\n")], "   "), 422, "validation",
        "Commit message can't be blank.")
    empty = w.api("owner").ok("POST", "/api/projects", {"group": w.raw["groups"]["s"]["id"], "slug": "empty",
                                                        "visibility": "private", "default_branch": "main"}, status=201)
    first = api_commit(w.api("owner"), empty["id"], "main", [act("create", "a.txt", "a\n")], "Start", base_commit=None)
    assert first.status_code == 201 and heads(w.api("owner"), empty["id"])["main"] == first.json()["commit"]
    clients = [Api(base, w.u[k]) for k in ("dev", "rev", "maint", "owner", "dev", "rev", "maint", "owner")]

    def race(pair: tuple[int, Api]) -> int:
        i, api = pair
        return api.req("POST", f"/api/projects/{w.pid}/commits", {"branch": "feat", "base_commit": head,
                                                                 "message": f"Race {i}",
                                                                 "actions": [act("create", f"race{i}.txt", "r\n")]}).status_code

    with ThreadPoolExecutor(8) as pool:
        codes = sorted(pool.map(race, enumerate(clients)))
    assert codes == [201] + [409] * 7, codes


def test_history_and_blame(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "f.txt", "one\ntwo\nthree\n")], "First"),
        cm("c2", "main", u["dev"], [act("update", "f.txt", "one\nTWO\nthree\n")], "Second", ts=TS0 + 10),
        cm("c3", "main", u["rev"], [act("create", "g.txt", "g\n")], "Third", ts=TS0 + 20)]})
    api = w.api("dev")
    c = w.p["commits"]
    assert [x["id"] for x in api.get(f"/api/projects/{w.pid}/commits?ref=main")["commits"]] == [c["c3"], c["c2"], c["c1"]]
    assert [x["id"] for x in api.get(f"/api/projects/{w.pid}/commits?ref=main&path=f.txt")["commits"]] == [c["c2"], c["c1"]]
    blame = api.get(f"/api/projects/{w.pid}/blame?ref=main&path=f.txt")["lines"]
    assert [(b["line"], b["commit"], b["text"]) for b in blame] == [(1, c["c1"], "one"), (2, c["c2"], "TWO"),
                                                                     (3, c["c1"], "three")]


def test_wf_commits_wiki_editor_commit(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "a.txt", "a\n"), act("create", "b.txt", "b\n")], "First"),
        cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")]})
    dev = w.api("dev")
    main = heads(dev, w.pid)["main"]
    a_file, b_file, f_file, branch = "a.txt", "b.txt", "f.txt", "feat"
    with as_user(browser, base, w.u["dev"],
                 f"/projects/{w.pid}/-/edit?" + urlencode({"ref": "main", "path": a_file})) as page:
        fill(page.get_by_role("textbox", name=f"Edit {a_file}"), "a2\n")
        tree = page.get_by_role("tree", name="Files")
        tree.get_by_role("treeitem", name=b_file).focus()
        page.keyboard.press("Enter")
        fill(page.get_by_role("textbox", name=f"Edit {b_file}"), "b2\n")
        fill(page.get_by_role("textbox", name="New branch name"), NEW_BRANCH)
        fill(page.get_by_role("textbox", name="Commit message"), "Edit two files")
        click(page.get_by_role("button", name="Commit"))
        expect(page).to_have_url(re.compile(rf"/projects/{w.pid}/-/commit/[0-9a-f]{{64}}$"))
        full = page.url.rsplit("/", 1)[1]
        expect(page.get_by_role("heading", level=1, name=f"Commit {full[:7]}")).to_be_focused()
        announced(page, f"Committed {full[:7]} to {NEW_BRANCH}.")
        info = dev.get(f"/api/projects/{w.pid}/commits/{full}")
        assert info["parents"] == [main] and heads(dev, w.pid)[NEW_BRANCH] == full
        page.goto(base + f"/projects/{w.pid}/-/edit?" + urlencode({"ref": branch, "path": f_file}))
        fill(page.get_by_role("textbox", name=f"Edit {f_file}"), EDITED_TEXT)
        old = heads(dev, w.pid)[branch]
        moved = gpush(w, branch, "rev", [act("create", "other.txt", "o\n")], "Elsewhere")["commit"]
        fill(page.get_by_role("textbox", name="Commit message"), "Mine")
        click(page.get_by_role("button", name="Commit"))
        stale = f"Your base commit {old[:7]} is behind {branch} at {moved[:7]}. Refresh and try again."
        expect(page.get_by_text(stale).first).to_be_visible()
        click(page.get_by_role("button", name="Refresh and reapply"))
        click(page.get_by_role("button", name="Commit"))
        expect(page).to_have_url(re.compile(r"/-/commit/[0-9a-f]{64}$"))
    final = heads(dev, w.pid)[branch]
    assert dev.get(f"/api/projects/{w.pid}/commits/{final}")["parents"] == [moved]
    stored = dev.get(f"/api/projects/{w.pid}/files?" + urlencode({"ref": branch, "path": f_file}))
    assert stored["content"] == EDITED_TEXT


def test_protection_and_push_rules(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "protected_branches": [{"name": "main", "allowed_to_push": "maintainer", "allowed_to_merge": "developer"},
                               {"name": "rel", "allowed_to_push": "maintainer", "allowed_to_merge": "maintainer"}],
        "protected_tags": [{"name": "v*", "allowed_to_create": "maintainer"}],
        "push_rules": {"branch_name": "^(feat|fix)/", "commit_message": "^[A-Z]", "forbidden_files": ["*.pem"],
                       "required_files": ["README.md"], "secrets": True},
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "rel", u["owner"], [act("create", "r.txt", "r\n")], "Rel", start="main"),
                    cm("c3", "feat/r", u["dev"], [act("create", "x.txt", "x\n")], "Feat", start="main"),
                    cm("c4", "feat/del", u["dev"], [act("delete", "README.md")], "Drop", start="main")],
        "merge_requests": [mrq("mr1", "feat/r", u["dev"], target="rel"), mrq("mr2", "feat/del", u["dev"])]})
    maint, dev = w.api("maint"), w.api("dev")
    cases = [
        ("bad-name", [act("create", "a.txt", "a\n")], "lower", "Branch name bad-name doesn't match ^(feat|fix)/."),
        ("feat/x", [act("create", "a.txt", "a\n")], "lower", "Commit message doesn't match ^[A-Z]."),
        ("feat/x", [act("create", "key.pem", "k\n"), act("delete", "README.md")], "Add",
         "File key.pem is forbidden by push rule *.pem."),
        ("feat/x", [act("delete", "README.md"), act("create", "a.txt", "x\nAKABCDEFGHIJKLMNOPQR\n")], "Add",
         "Required file README.md is missing."),
        ("feat/x", [act("create", "b.txt", "sptk_ABCDEFGHIJKLMNOPQRST\n"),
                    act("create", "a.txt", "x\nAKABCDEFGHIJKLMNOPQR\n")], "Add", "Secret found: cloud-key in a.txt at line 2."),
    ]
    for branch, actions, message, text in cases:
        err(api_commit(maint, w.pid, branch, actions, message, start_ref="main"), 422, "push_rule", text)
        r = httpx.post(base + "/api/grading/commit", timeout=HTTP_TIMEOUT, json={
            "project": w.pid, "branch": branch, "start_ref": "main", "base_commit": heads(maint, w.pid)["main"],
            "as": w.u["maint"], "timestamp": TS0, "message": message, "actions": actions})
        err(r, 422, "push_rule", text)
    assert set(heads(maint, w.pid)) == {"main", "rel", "feat/r", "feat/del"}
    err(api_commit(dev, w.pid, "main", [act("create", "a.txt", "a\n")], "Direct"), 403, "protected_branch",
        "You can't push to protected branch main.")
    err(api_commit(maint, w.pid, "main", [act("create", "a.txt", "a\n")], "lower"), 422, "push_rule",
        "Commit message doesn't match ^[A-Z].")
    err(dev.req("POST", f"/api/projects/{w.pid}/tags", {"name": "v1.0", "ref": "main", "message": "T"}), 403,
        "protected_tag", "You can't create protected tag v1.0.")
    maint.ok("POST", f"/api/projects/{w.pid}/tags", {"name": "v1.0", "ref": "main", "message": "T"}, status=201)
    err(w.api("owner").req("DELETE", f"/api/projects/{w.pid}/branches/main"), 403, "protected_branch",
        "You can't delete protected branch main.")
    err(dev.req("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/merge", {"sha": heads(dev, w.pid)["feat/r"]}),
        403, "protected_branch", "You can't merge into protected branch rel.")
    main = heads(dev, w.pid)["main"]
    err(dev.req("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr2')}/merge",
                {"sha": heads(dev, w.pid)["feat/del"]}), 422, "push_rule", "Required file README.md is missing.")
    assert heads(dev, w.pid)["main"] == main


BOLD_SRC = "**bold**"
CODE_SRC = "`code`"
ALERT_CALL = "alert(1)"
LINK_HOST = "example.org"


def test_wiki_versions_and_rendering(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    dev, rev = w.api("dev"), w.api("rev")
    url = f"/api/projects/{w.pid}/wiki/notes{w.t}"
    lt, gt = chr(60), chr(62)
    scheme = "java" + "script:"
    injected = f"{lt}script{gt}{ALERT_CALL}{lt}/script{gt}"
    content = (f"# Title\n\n{BOLD_SRC} *it* {CODE_SRC} {injected}\n\n[ok](https://{LINK_HOST}) "
               f"[bad]({scheme}{ALERT_CALL})\n")
    v1 = dev.ok("PUT", url, {"title": "Notes", "content": content, "base_version": 0})
    assert v1["version"] == 1
    html = v1["html"]
    assert "bold" in html and BOLD_SRC not in html and CODE_SRC not in html
    assert f"{lt}script" not in html and ALERT_CALL in html
    anchors = re.findall(re.escape(lt) + r"a\b[^" + re.escape(gt) + r"]*", html)
    assert any(LINK_HOST in a for a in anchors)
    assert not any(scheme in a for a in anchors)
    assert "bad" in html
    assert rev.ok("PUT", url, {"title": "Notes", "content": "second\n", "base_version": 1})["version"] == 2
    err(dev.req("PUT", url, {"title": "Notes", "content": "late\n", "base_version": 1}), 409, "stale_wiki",
        f"{w.u['rev']} edited this page. Your base version 1 is behind 2.")
    versions = dev.get(url + "/versions")
    listed = versions["versions"] if isinstance(versions, dict) else versions
    assert len(listed) == 2
    dev.ok("POST", url + "/restore", {"version": 1}, status=201)
    now = dev.get(url)
    assert now["version"] == 3 and now["content"] == content
    assert w.api("rep").req("PUT", url, {"title": "Notes", "content": "x\n", "base_version": 3}).status_code == 403


def test_wf_commits_wiki_wiki_stale(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"wiki": [{"slug": "home", "title": "Home", "content": "# Home", "author": u["owner"]}]})
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/wiki/home") as page:
        expect(page.get_by_role("textbox", name="Page content")).to_be_visible()
        w.api("rev").ok("PUT", f"/api/projects/{w.pid}/wiki/home", {"title": "Home", "content": WIKI_TEXT,
                                                                     "base_version": 1})
        text = f"{w.u['rev']} edited this page. Your base version {1} is behind {2}."
        err(w.api("dev").req("PUT", f"/api/projects/{w.pid}/wiki/home",
                             {"title": "Home", "content": "dev late\n", "base_version": 1}), 409, "stale_wiki", text)
    stored = w.api("dev").get(f"/api/projects/{w.pid}/wiki/home")
    assert stored["version"] == 2 and stored["content"] == WIKI_TEXT


REPORT_VARS = {
    "T_BASE": '{"cases":[{"name":"a","status":"passed","ms":1},{"name":"b","status":"failed","ms":1}]}',
    "T_HEAD": '{"cases":[{"name":"a","status":"failed","ms":1},{"name":"b","status":"failed","ms":1},'
              '{"name":"c","status":"passed","ms":1},{"name":"d","status":"skipped","ms":1}]}',
    "C_BASE": '{"percent":82.75}', "C_HEAD": '{"percent":81.25}',
    "Q_BASE": '[{"fingerprint":"f1","severity":"minor","path":"a","line":1,"message":"m"},'
              '{"fingerprint":"f2","severity":"minor","path":"a","line":2,"message":"m"}]',
    "Q_HEAD": '[{"fingerprint":"f2","severity":"minor","path":"a","line":2,"message":"m"},'
              '{"fingerprint":"f3","severity":"minor","path":"a","line":3,"message":"m"}]',
    "S_BOTH": '[{"id":"S1","severity":"high","title":"Leak","path":"a","line":1},'
              '{"id":"S2","severity":"low","title":"Style","path":"a","line":2}]',
    "S_HIGH": '[{"id":"S1","severity":"high","title":"Leak","path":"a","line":1}]',
    "S_EMPTY": "[]"}


def report_config(kind: str, security: str | None = None) -> str:
    script = [f"    - write r/t.json $T_{kind}", f"    - write r/c.json $C_{kind}", f"    - write r/q.json $Q_{kind}",
              "    - emit tests r/t.json", "    - emit coverage r/c.json", "    - emit quality r/q.json"]
    if security:
        script += [f"    - write r/s.json ${security}", "    - emit security r/s.json"]
    return "stages: [test]\nrep:\n  stage: test\n  script:\n" + "\n".join(script) + "\n"


def reports_world(base: str, security: str) -> tuple[World, int, int]:
    w = world(base, lambda t, u: {"variables": REPORT_VARS, "commits": [
        cm("c1", "main", u["owner"], [act("create", "spurline.pipeline.yml", report_config("BASE"))], "First")]})
    gpush(w, "main", "maint", [act("create", "base.txt", "b\n")], "Base")
    run_all(base, w.pid)
    head = gpush(w, "feat", "dev", [act("update", "spurline.pipeline.yml", report_config("HEAD", security))], "Head",
                 start_ref="main")
    run_all(base, w.pid)
    return w, open_mr(w.api("dev"), w.pid, "feat", "Reports"), head["pipeline"]["id"]


def test_reports_and_findings(app_url: str) -> None:
    base = app_url.rstrip("/")
    w, iid, head_pl = reports_world(base, "S_BOTH")
    dev, maint = w.api("dev"), w.api("maint")
    rep = dev.get(f"/api/projects/{w.pid}/merge_requests/{iid}/reports")
    assert rep["head_pipeline_id"] == head_pl
    assert rep["tests"]["text"] == "1 new failures, 2 failed, 1 passed, 1 skipped" and rep["tests"]["new_failures"] == ["a"]
    assert rep["coverage"]["text"] == "Coverage 81.25% (-1.50)"
    assert rep["quality"]["text"] == "1 new, 1 resolved" and rep["quality"]["new"] == ["f3"]
    assert rep["quality"]["resolved"] == ["f1"] and rep["security"]["text"] == "2 security findings need review."
    findings = {f["report_id"]: f for f in rep["security"]["findings"]}
    m = mr(dev, w.pid, iid)
    assert checks(m)["security"]["text"] == "1 security finding needs review."
    assert {"name": "Security review", "kind": "security", "required": 1}.items() <= \
        [r for r in m["approvals"]["rules"] if r["name"] == "Security review"][0].items()
    rep_job = job(pipeline(dev, head_pl), "rep")["id"]
    assert f"reports/{rep_job}/security.json" in S3().keys(f"reports/{rep_job}/")
    s1 = f"/api/projects/{w.pid}/findings/{findings['S1']['id']}"
    assert dev.req("PATCH", s1, {"state": "dismissed", "reason": "Not a real leak here"}).status_code == 403
    err(maint.req("PATCH", s1, {"state": "dismissed", "reason": "short"}), 422, "validation",
        "Give a reason of at least 10 characters.")
    done = maint.ok("PATCH", s1, {"state": "dismissed", "reason": "Not a real leak here"})
    assert done["state"] == "dismissed"
    m = mr(dev, w.pid, iid)
    assert checks(m)["security"]["state"] == "inactive"
    assert "Security review" not in [r["name"] for r in m["approvals"]["rules"]]
    assert dev.get(f"/api/projects/{w.pid}/merge_requests/{iid}/reports")["security"]["text"] == \
        "1 security finding needs review."
    err(maint.req("PATCH", s1, {"state": "resolved", "reason": None}), 409, "illegal_transition",
        "A finding can't go from dismissed to resolved.")
    s2 = f"/api/projects/{w.pid}/findings/{findings['S2']['id']}"
    maint.ok("PATCH", s2, {"state": "confirmed", "reason": None})
    gpush(w, "feat", "dev", [act("update", "spurline.pipeline.yml", report_config("HEAD", "S_EMPTY"))], "Clean")
    run_all(base, w.pid)
    later = {f["report_id"]: f for f in dev.get(f"/api/projects/{w.pid}/merge_requests/{iid}/reports")["security"]["findings"]}
    assert later["S2"]["state"] == "resolved"
    assert dev.get(f"/api/projects/{w.pid}/merge_requests/{iid}/reports")["security"]["text"] == \
        "No security findings need review."


def test_wf_reports_delivery_export_findings(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w, iid, _ = reports_world(base, "S_HIGH")
    with as_user(browser, base, w.u["maint"], f"/projects/{w.pid}/-/merge_requests/{iid}") as page:
        security = page.get_by_role("region", name="Security")
        expect(security).to_contain_text("1 security finding needs review.")
        expect(page.get_by_role("region", name="Merge checks").get_by_role(
            "listitem", name=check_label("security", "failed"))).to_contain_text("1 security finding needs review.")
        fill(page.get_by_role("textbox", name="Dismissal reason"), DISMISS_REASON)
        click(page.get_by_role("button", name="Dismiss finding"))
        expect(security).to_contain_text("No security findings need review.")
        expect(page.get_by_role("region", name="Merge checks").get_by_role(
            "listitem", name=check_label("security", "inactive"))).to_be_visible()
        expect(page.get_by_role("region", name="Approvals")).not_to_contain_text("Security review")
    found = w.api("maint").get(f"/api/projects/{w.pid}/merge_requests/{iid}/reports")["security"]["findings"][0]
    assert found["state"] == "dismissed" and found["reason"] == DISMISS_REASON


def test_webhooks_signed_retried_redelivered(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    owner = w.api("owner")
    sink = f"hook{w.t}"
    target = f"http://127.0.0.1:4173/api/grading/sink/{sink}"
    err(owner.req("POST", f"/api/projects/{w.pid}/webhooks", {"url": "http://127.0.0.1:9/x", "secret": "s3cret-value",
                                                               "events": ["push"]}),
        422, "target_not_allowed", "This target isn't on the allow-list.")
    hook = owner.ok("POST", f"/api/projects/{w.pid}/webhooks", {"url": target, "secret": "s3cret-value",
                                                                "events": ["push", "issue"]}, status=201)["id"]

    def received() -> list[dict]:
        return httpx.get(f"{base}/api/grading/sink/{sink}", timeout=HTTP_TIMEOUT).json()["requests"]

    pushed = gpush(w, "main", "owner", [act("create", "w.txt", "w\n")], HOOK_MESSAGE)
    got = eventually(lambda: received(), "push delivery reaches the sink")[0]
    h, raw = got["headers"], got["body"]
    assert h["content-type"].startswith("application/json") and h["x-spurline-event"] == "push"
    assert re.fullmatch(r"[0-9a-f-]{36}", h["x-spurline-delivery"])
    assert int(h["x-spurline-timestamp"]) == now_ms(base) // 1000
    sig = hmac.new(b"s3cret-value", f"{h['x-spurline-timestamp']}.{raw}".encode(), hashlib.sha256).hexdigest()
    assert h["x-spurline-signature"] == f"sha256={sig}"
    body = json.loads(raw)
    assert body["event"] == "push" and body["project"] == {"id": w.pid, "path": w.path}
    assert body["after"] == pushed["commit"] and body["user"] == w.u["owner"] and body["ref"].endswith("main")
    assert body["commits"][0]["id"] == pushed["commit"] and body["commits"][0]["message"] == HOOK_MESSAGE
    owner.ok("POST", f"/api/projects/{w.pid}/issues", {"title": "Secret", "confidential": True}, status=201)
    public = owner.ok("POST", f"/api/projects/{w.pid}/issues", {"title": "Public"}, status=201)
    issues = eventually(lambda: [r for r in received() if r["headers"]["x-spurline-event"] == "issue"],
                        "issue delivery for the public issue")
    assert len(issues) == 1 and json.loads(issues[0]["body"])["issue"]["iid"] == public["iid"]
    httpx.put(f"{base}/api/grading/sink/{sink}", json={"status": 500}, timeout=HTTP_TIMEOUT)
    seen = len(received())
    gpush(w, "main", "owner", [act("create", "x.txt", "x\n")], "Fail me")
    eventually(lambda: len(received()) == seen + 1, "first failing attempt arrives")
    for i, gap in enumerate(WEBHOOK_GAPS, start=2):
        tick(base, gap)
        eventually(lambda i=i: len(received()) == seen + i, f"attempt {i} after {gap} ms on the server clock")

    def failed() -> dict | None:
        rows = owner.get(f"/api/projects/{w.pid}/webhooks/{hook}/deliveries")["deliveries"]
        rows = [d for d in rows if d["state"] == "failed"]
        return rows[0] if rows else None

    dead = eventually(failed, "delivery is failed after the last gap")
    assert len(dead["attempts"]) == len(WEBHOOK_GAPS) + 1 and dead["attempts"][0]["status_code"] == 500
    first_body = received()[-1]["body"]
    httpx.put(f"{base}/api/grading/sink/{sink}", json={"status": 200}, timeout=HTTP_TIMEOUT)
    new_id = owner.ok("POST", f"/api/deliveries/{dead['id']}/redeliver", status=201)["id"]
    assert new_id != dead["id"]
    again = eventually(lambda: (lambda r: r[-1] if len(r) > seen + len(WEBHOOK_GAPS) + 1 else None)(received()),
                       "redelivery reaches the sink")
    assert again["body"] == first_body
    assert again["headers"]["x-spurline-delivery"] != received()[-2]["headers"]["x-spurline-delivery"]


SAMPLE_PACK = "\n".join([
    "spurpack 1", "user\tasha", "file\tREADME.md\thello\\n",
    f"commit\t{FIRST_COMMIT}\t-\tasha 1767225600\tasha 1767225600\tFirst commit",
    f"ref\tbranch\tmain\t{FIRST_COMMIT}", "label\tpriority::high\t-",
    "milestone\tSprint 1\t2026-01-05\t2026-01-16\tUTC\tactive",
    "issue\t1\tExport fails\topened\tasha\tpriority::high\tSprint 1\t3\tfalse\t-",
    "wikipage\thome\t1\tasha\tHome\t# Home",
    "config\tauthor_can_approve\tfalse", "config\tauto_resolve_outdated\tfalse", "config\tdefault_branch\tmain",
    "config\tmerge_method\tmerge_commit", "config\tmerge_trains\tfalse", "config\tpipelines_must_succeed\tfalse",
    "config\treset_approvals_on_push\ttrue", "config\tvisibility\tprivate"]) + "\n"


def step_until(base: str, fetch: Callable[[], dict], done: Callable[[dict], bool], contract: str) -> dict:
    last: dict = {}
    for _ in range(12):
        last = eventually(lambda: fetch(), contract)
        if done(last):
            return last
        tick(base, EXPORT_STEP_MS)
        last = fetch()
        if done(last):
            return last
    pytest.fail(f"{contract}: {last}")


def test_wf_reports_delivery_export_outage(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/export") as page:
        bar = page.get_by_role("progressbar", name="Project export")
        try:
            storage(base, True)
            click(page.get_by_role("button", name="Export project"))
            expect(page).to_have_url(base + f"/projects/{w.pid}/-/export")
            expect(bar).to_be_focused()
            failure = page.get_by_text("Export failed: file storage is unavailable.").first
            for _ in range(12):
                if failure.is_visible():
                    break
                tick(base, EXPORT_STEP_MS)
            expect(failure).to_be_visible(timeout=LIVE_MS)
            expect(bar).to_have_attribute("aria-valuenow", "80")
            expect(page.get_by_role("link", name="Download export")).to_have_count(0)
            assert S3().keys(f"exports/{w.pid}/") == []
        finally:
            storage(base, False)
        click(page.get_by_role("button", name="Retry export"))
        link = page.get_by_role("link", name="Download export")
        for _ in range(12):
            if link.count():
                break
            tick(base, EXPORT_STEP_MS)
        expect(link).to_be_visible(timeout=LIVE_MS)
        expect(bar).to_have_attribute("aria-valuenow", "100")
        announced(page, "Export ready.")
        href = link.get_attribute("href") or ""
        assert same_origin(str(httpx.URL(base).join(href)), base)
        downloaded = page.request.get(str(httpx.URL(base).join(href))).body()
    keys = S3().keys(f"exports/{w.pid}/")
    assert len(keys) == 1 and keys[0].endswith(".spurpack") and S3().get(keys[0]) == downloaded
    assert downloaded.startswith(b"spurpack 1\n")


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"
    for font in ("Inter Tight", "Inter", "JetBrains Mono"):
        assert font in notices, font


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"


def test_if_no_extra_datastores() -> None:
    banned = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "kafkajs",
              "amqplib", "nodemailer", "@elastic/elasticsearch", "meilisearch", "memcached", "bullmq", "bull"}
    found = sorted({p.name for p in shipped_packages()} & banned)
    assert not found, f"extra service clients shipped: {found}"


def test_if_lockfile_used() -> None:
    assert (APP / "package-lock.json").is_file()
    install = json.loads((APP / "run.json").read_text())["install"]
    assert "npm ci" in install, install


def test_if_service_config_untouched() -> None:
    names = ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
    present = [n for n in names if (APP / n).exists()]
    if not (APP / ".git").exists():
        for n in present:
            text = (APP / n).read_text().lower()
            for service in ("Postgres", "MinIO"):
                assert service.lower() in text, f"{n} no longer declares {service}"
        return
    first = subprocess.run(["git", "-C", str(APP), "rev-list", "--max-parents=0", "HEAD"], capture_output=True,
                           text=True).stdout.split()
    for n in present:
        r = subprocess.run(["git", "-C", str(APP), "diff", "--quiet", first[0], "--", n])
        assert r.returncode == 0, f"{n} differs from the provided version"


def test_if_no_other_forge_names() -> None:
    products = ["git" + "hub", "git" + "lab", "bit" + "bucket", "git" + "ea", "forge" + "jo", "source" + "hut"]
    names = re.compile(r"\b(" + "|".join(products) + r")\b", re.I)
    skip = {"node_modules", ".git", "dist", "build"}
    hits = []
    for path in APP.rglob("*"):
        if any(part in skip for part in path.parts) or not path.is_file():
            continue
        if path.name in ("package-lock.json", "THIRD_PARTY_NOTICES.md") or path.stat().st_size > 2000000:
            continue
        with contextlib.suppress(UnicodeDecodeError):
            if names.search(path.read_text()):
                hits.append(str(path))
    assert not hits, f"files naming another code hosting product: {hits[:20]}"


_A_APP = "src/app.ts"
_A_EIGHT = "".join(f"a{i}\n" for i in range(1, 9))
_A_OPS = "Ops"
_A_DOCS = "Docs"
_A_BACKEND = "Backend"
_A_SAME = "same\n"


def _a_row(grid: Locator, n: int, kind: str, path: str = _A_APP, suffix: str = "") -> Locator:
    return grid.get_by_role("row", name=row_label(n, kind, path) + suffix, exact=True)


def _a_focus_is(page: Page, label: str) -> None:
    eventually(lambda: focused_label(page) == label, f"focus lands on {label}")


def _a_press(button: Locator) -> None:
    button.focus()
    button.page.keyboard.press("Enter")


def _a_changes(w: World, *, line: int | None = None) -> str:
    query = {"file": _A_APP, "view": "inline"} | ({"line": line} if line else {})
    return f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}/changes?" + urlencode(query)


def _a_overview(w: World) -> str:
    return f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}"


def _a_rule_world(base: str, *rules: tuple[str, str]) -> World:
    return world(base, lambda t, u: {
        "approval_rules": [{"name": name, "required": 1, "users": [u[who]], "groups": []} for name, who in rules],
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})


def test_wf_review_keyboard_file_keys(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", A_TS, "a\n"), act("create", B_TS, "b\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("update", A_TS, "a\nx\ny\n"), act("update", B_TS, "b\nz\n")],
                       "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    root = f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}/changes"
    order = [d["path"] for d in w.api("rev").get(f"/api/projects/{w.pid}/compare?from=main&to=feat")["diffs"]]
    first, second = order[0], order[1]
    with as_user(browser, base, w.u["rev"], root + "?" + urlencode({"file": first, "line": 1})) as page:
        grid = page.get_by_role("grid", name="Diff")
        expect(_a_row(grid, 1, "unchanged", first)).to_be_focused()
        length = page.evaluate("() => history.length")
        page.keyboard.press("j")
        expect(_a_row(grid, 2, "added", first)).to_be_focused()
        page.keyboard.press("k")
        expect(_a_row(grid, 1, "unchanged", first)).to_be_focused()
        page.keyboard.press("n")
        expect(_a_row(grid, 1, "unchanged", second)).to_be_focused()
        eventually(lambda: url_query(page).get("file") == [second], "the file is kept in the URL")
        page.keyboard.press("p")
        expect(_a_row(grid, 1, "unchanged", first)).to_be_focused()
        eventually(lambda: url_query(page).get("file") == [first], "the file is kept in the URL")
        assert page.evaluate("() => history.length") == length


def test_wf_review_keyboard_cancel_then_post(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = review_world(base)
    with as_user(browser, base, w.u["dev"], _a_changes(w)) as author, \
            as_user(browser, base, w.u["rev"], _a_changes(w, line=3)) as page:
        grid = page.get_by_role("grid", name="Diff")
        row = _a_row(grid, 3, "added")
        expect(row).to_be_focused()
        page.keyboard.press("c")
        box = page.get_by_role("textbox", name=f"Comment on line {3}")
        expect(box).to_be_focused()
        page.keyboard.type("jkne")
        expect(box).to_have_value("jkne")
        expect(box).to_be_focused()
        page.keyboard.press("Escape")
        expect(row).to_be_focused()
        expect(box).to_have_count(0)
        assert threads(w.api("rev"), w.pid, w.iid("mr1")) == []
        page.keyboard.press("c")
        page.keyboard.type(REVIEW_TEXT)
        page.keyboard.press("Control+Enter")
        counted = f", {1} unresolved thread"
        expect(_a_row(grid, 3, "added", suffix=counted)).to_be_focused()
        expect(_a_row(author.get_by_role("grid", name="Diff"), 3, "added", suffix=counted)).to_have_count(
            1, timeout=LIVE_MS)
    assert len(threads(w.api("dev"), w.pid, w.iid("mr1"))) == 1


def test_wf_review_keyboard_thread_walk(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = review_world(base, pre_threads=(("t3", _A_APP, 3), ("t5", _A_APP, 5), ("t6", _A_APP, 6)))
    with as_user(browser, base, w.u["dev"], _a_overview(w)) as author, \
            as_user(browser, base, w.u["rev"], _a_changes(w, line=2)) as page:
        grid = page.get_by_role("grid", name="Diff")
        expect(_a_row(grid, 2, "added")).to_be_focused()
        expect(_a_row(grid, 5, "added", suffix=f", {1} unresolved thread")).to_have_count(1)
        for line, key in ((3, "]"), (5, "]"), (6, "]"), (5, "[")):
            page.keyboard.press(key)
            _a_focus_is(page, thread_label(_A_APP, line))
        page.keyboard.press("e")
        announced(page, f"Thread resolved. {2} unresolved threads left.")
        _a_focus_is(page, thread_label(_A_APP, 6))
        expect(_a_row(grid, 5, "added")).to_have_count(1)
        panel = author.get_by_role("region", name="Threads")
        expect(panel.get_by_role("article", name=thread_label(_A_APP, 5, resolved=True))).to_be_visible(timeout=LIVE_MS)
        expect(author.get_by_role("region", name="Merge checks").get_by_role(
            "listitem", name=check_label("threads", "failed"))).to_contain_text(
            f"{2} unresolved threads must be resolved.", timeout=LIVE_MS)


def test_wf_review_keyboard_pending_discard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = review_world(base)
    iid = w.iid("mr1")
    with as_user(browser, base, w.u["dev"], _a_overview(w)) as author, \
            as_user(browser, base, w.u["rev"], _a_changes(w, line=3)) as page:
        expect(_a_row(page.get_by_role("grid", name="Diff"), 3, "added")).to_be_focused()
        page.keyboard.press("c")
        page.keyboard.type(REVIEW_TEXT)
        tab_until(page, "Start review")
        page.keyboard.press("Enter")
        finish = page.get_by_role("button", name="Finish review")
        expect(finish).to_be_visible()
        assert threads(w.api("dev"), w.pid, iid) == []
        expect(author.get_by_role("region", name="Threads").get_by_role("article")).to_have_count(0)
        finish.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Submit review")
        expect(dialog).to_contain_text(f"Pending comments: {1}")
        for key in ("Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            page.keyboard.press(key)
            assert dialog.evaluate("(d) => d.contains(document.activeElement)"), f"{key} left the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(finish).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        tab_until(page, "Discard review")
        page.keyboard.press("Enter")
        expect(dialog).to_have_count(0)
        eventually(lambda: threads(w.api("rev"), w.pid, iid) == [], "Discard review deletes the pending comment")
        expect(page.get_by_role("region", name="Threads").get_by_role("article")).to_have_count(0)


def test_wf_versions_suggestions_remap_live(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", _A_APP, "x\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("update", _A_APP, _A_EIGHT)], "One", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"], threads=[thr("t5", u["rev"], _A_APP, 5),
                                                                 thr("t8", u["rev"], _A_APP, 8)])]})
    pushed = "p1\np2\n" + _A_EIGHT.replace("a8\n", "z8\n")
    with as_user(browser, base, w.u["dev"], _a_overview(w)) as author, \
            as_user(browser, base, w.u["rev"], _a_changes(w)) as page:
        for viewer in (page, author):
            expect(viewer.get_by_role("region", name="Threads").get_by_role(
                "article", name=thread_label(_A_APP, 5))).to_be_visible()
        gpush(w, "feat", "dev", [act("update", _A_APP, pushed)], "Two")
        for viewer in (page, author):
            panel = viewer.get_by_role("region", name="Threads")
            expect(panel.get_by_role("article", name=thread_label(_A_APP, 7))).to_be_visible(timeout=LIVE_MS)
            expect(panel.get_by_role("article").filter(has_text="Outdated")).to_have_count(1, timeout=LIVE_MS)
        page.goto(base + _a_changes(w, line=7))
        expect(_a_row(page.get_by_role("grid", name="Diff"), 7, "added", suffix=f", {1} unresolved thread")).to_be_focused()
    found = {t["id"]: t for t in threads(w.api("rev"), w.pid, w.iid("mr1"))}
    assert found[w.p["threads"]["t5"]["id"]]["current_line"] == 7
    assert found[w.p["threads"]["t8"]["id"]]["outdated"] is True


def test_wf_versions_suggestions_overlap_refused(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = suggestion_world(base)
    suggest(w, _A_APP, 2, "```suggestion:-0+1\ntwo\n```")
    suggest(w, _A_APP, 3, "```suggestion\nthree\n```")
    dev = w.api("dev")
    head = heads(dev, w.pid)["feat"]
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}/changes") as page:
        panel = page.get_by_role("region", name="Threads")
        for line in (2, 3):
            _a_press(panel.get_by_role("article", name=thread_on(_A_APP, line)).get_by_role("button", name="Add to batch"))
        _a_press(page.get_by_role("button", name="Apply batch").first)
        expect(page.get_by_text(re.compile(r"These suggestions overlap: src\/app\.ts lines \d+-\d+\.")).first).to_be_visible(
            timeout=LIVE_MS)
    assert heads(dev, w.pid)["feat"] == head
    assert not any(t["resolved"] for t in threads(dev, w.pid, w.iid("mr1")))


def test_wf_versions_suggestions_apply_is_a_push(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = suggestion_world(base)
    w.api("owner").ok("POST", f"/api/projects/{w.pid}/approval_rules",
                      {"name": _A_BACKEND, "required": 1, "users": [w.u["rev"]], "groups": []}, status=201)
    suggest(w, _A_APP, 5, "```suggestion\nfive\n```")
    iid = w.iid("mr1")
    dev = w.api("dev")
    w.api("rev").ok("POST", f"/api/projects/{w.pid}/merge_requests/{iid}/approve", {"sha": heads(dev, w.pid)["feat"]})
    with as_user(browser, base, w.u["rev"], _a_overview(w)) as reviewer, \
            as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}/changes") as page:
        region = reviewer.get_by_role("region", name="Approvals")
        expect(region).to_contain_text(rule_count(_A_BACKEND, 1, 1))
        _a_press(page.get_by_role("region", name="Threads").get_by_role(
            "article", name=thread_on(_A_APP, 5)).get_by_role("button", name="Apply suggestion"))
        expect(region).to_contain_text(rule_count(_A_BACKEND, 0, 1), timeout=LIVE_MS)
        announced(reviewer, "Approvals reset: new commits were pushed.")
        expect(reviewer.get_by_role("region", name="Merge checks").get_by_role(
            "listitem", name=check_label("approvals", "failed"))).to_contain_text(needs_text(1, _A_BACKEND), timeout=LIVE_MS)
        expect(reviewer.get_by_role("button", name="Approve", exact=True)).to_be_visible(timeout=LIVE_MS)
    assert [v["number"] for v in mr(dev, w.pid, iid)["versions"]] == [1, 2]


def test_wf_versions_suggestions_auto_resolve(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "settings": {"auto_resolve_outdated": True},
        "commits": [cm("c1", "main", u["owner"], [act("create", _A_APP, "x\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("update", _A_APP, _A_EIGHT)], "One", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"], threads=[thr("t8", u["rev"], _A_APP, 8)])]})
    note = "Resolved because the line changed."
    with as_user(browser, base, w.u["rev"], _a_overview(w)) as page:
        checks_region = page.get_by_role("region", name="Merge checks")
        expect(checks_region.get_by_role("listitem", name=check_label("threads", "failed"))).to_be_visible()
        gpush(w, "feat", "dev", [act("update", _A_APP, _A_EIGHT.replace("a8\n", "z8\n"))], "Two")
        expect(checks_region.get_by_role("listitem", name=check_label("threads", "passed"))).to_be_visible(timeout=LIVE_MS)
        expect(page.get_by_role("region", name="Threads").get_by_role(
            "article", name=re.compile(r"^Thread on src\/app\.ts line \d+, resolved$"))).to_be_visible(timeout=LIVE_MS)
        select(page.get_by_role("combobox", name="Activity filter"), "History only")
        expect(page.get_by_text(note).first).to_be_visible(timeout=LIVE_MS)
    assert note in note_bodies(mr_notes(w.api("rev"), w.pid, w.iid("mr1"), "history"))


def test_wf_approvals_owners_partial_then_reset(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = _a_rule_world(base, (_A_BACKEND, "rev"), (_A_OPS, "maint"))
    iid = w.iid("mr1")
    with as_user(browser, base, w.u["dev"], _a_overview(w)) as author, \
            as_user(browser, base, w.u["rev"], _a_overview(w)) as page:
        panel = author.get_by_role("region", name="Merge checks")
        _a_press(page.get_by_role("button", name="Approve", exact=True))
        expect(page.get_by_role("button", name="Revoke approval")).to_be_focused()
        announced(page, f"Approved. Needs {1} more approval: {_A_OPS}.")
        expect(panel.get_by_role("listitem", name=check_label("approvals", "failed"))).to_contain_text(
            needs_text(1, _A_OPS), timeout=LIVE_MS)
        w.api("maint").ok("POST", f"/api/projects/{w.pid}/merge_requests/{iid}/approve",
                          {"sha": heads(w.api("owner"), w.pid)["feat"]})
        announced(author, "Approved. All approval rules are satisfied.")
        expect(panel.get_by_role("listitem", name=check_label("approvals", "passed"))).to_be_visible(timeout=LIVE_MS)
        gpush(w, "feat", "dev", [act("update", "f.txt", "g\n")], "Again")
        for viewer in (author, page):
            region = viewer.get_by_role("region", name="Approvals")
            expect(region).to_contain_text(rule_count(_A_BACKEND, 0, 1), timeout=LIVE_MS)
            expect(region).to_contain_text(rule_count(_A_OPS, 0, 1), timeout=LIVE_MS)
            announced(viewer, "Approvals reset: new commits were pushed.")
        expect(page.get_by_role("button", name="Approve", exact=True)).to_be_visible(timeout=LIVE_MS)
        expect(page.get_by_role("button", name="Revoke approval")).to_have_count(0)


def test_wf_approvals_owners_rebase_changes_rules(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")

    def build(t: str, u: dict) -> dict:
        owners = f"[{_A_DOCS}]\n*.md @{u['rev']}\n[{_A_BACKEND}]\n*.ts @{u['maint']}\n"
        return {"settings": {"merge_method": "rebase"},
                "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n"),
                                                           act("create", ".spurline/OWNERS", owners)], "First"),
                            cm("c2", "feat", u["dev"], [act("update", "README.md", _A_SAME),
                                                        act("create", A_TS, "a\n")], "Feat", start="main")],
                "merge_requests": [mrq("mr1", "feat", u["dev"])]}

    w = world(base, build)
    iid = w.iid("mr1")
    with as_user(browser, base, w.u["rev"], _a_overview(w)) as reviewer, \
            as_user(browser, base, w.u["dev"], _a_overview(w)) as page:
        region = reviewer.get_by_role("region", name="Approvals")
        expect(region).to_contain_text(rule_count(_A_DOCS, 0, 1))
        expect(region).to_contain_text(rule_count(_A_BACKEND, 0, 1))
        gpush(w, "main", "owner", [act("update", "README.md", _A_SAME)], "Same change")
        checks_region = reviewer.get_by_role("region", name="Merge checks")
        expect(checks_region.get_by_role("listitem", name=check_label("rebase", "failed"))).to_contain_text(
            "Source branch must be rebased onto main.", timeout=LIVE_MS)
        rebase = page.get_by_role("button", name="Rebase", exact=True)
        expect(rebase).to_be_visible(timeout=LIVE_MS)
        _a_press(rebase)
        expect(region).not_to_contain_text(rule_count(_A_DOCS, 0, 1), timeout=LIVE_MS)
        expect(region).to_contain_text(rule_count(_A_BACKEND, 0, 1))
        expect(checks_region.get_by_role("listitem", name=check_label("rebase", "passed"))).to_be_visible(timeout=LIVE_MS)
    m = mr(w.api("dev"), w.pid, iid)
    assert [v["number"] for v in m["versions"]] == [1, 2]
    assert [r["name"] for r in m["approvals"]["rules"]] == [_A_BACKEND]


def test_wf_approvals_owners_auto_merge_live(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = _a_rule_world(base, (_A_BACKEND, "rev"))
    iid = w.iid("mr1")
    with as_user(browser, base, w.u["rev"], _a_overview(w)) as reviewer, \
            as_user(browser, base, w.u["dev"], _a_overview(w)) as page:
        set_button = page.get_by_role("button", name="Set to auto-merge")
        cancel = page.get_by_role("button", name="Cancel auto-merge")
        _a_press(set_button)
        expect(cancel).to_be_visible(timeout=LIVE_MS)
        _a_press(cancel)
        for viewer in (page, reviewer):
            announced(viewer, f"Auto-merge canceled: canceled by {w.u['dev']}.")
        expect(set_button).to_be_visible(timeout=LIVE_MS)
        _a_press(set_button)
        expect(cancel).to_be_visible(timeout=LIVE_MS)
        gpush(w, "feat", "dev", [act("update", "f.txt", "g\n")], "Again")
        for viewer in (page, reviewer):
            announced(viewer, "Auto-merge canceled: new commits were pushed.")
        expect(set_button).to_be_visible(timeout=LIVE_MS)
        assert mr(w.api("dev"), w.pid, iid)["state"] != "merged"
        _a_press(set_button)
        expect(cancel).to_be_visible(timeout=LIVE_MS)
        _a_press(reviewer.get_by_role("button", name="Approve", exact=True))
    eventually(lambda: mr(w.api("dev"), w.pid, iid)["state"] == "merged", "auto-merge merges once every check passes")


_B_SQUASH_TITLE = "Squash this"
_B_REPLAYED = "Replay me"
_B_REMOVED_RE = re.compile(r'^Line (8|10): job "uses" needs "gone", which rules removed\.$')
_B_CYCLE = "Line 13: needs cycle: a -> b -> a."
_B_CYCLE_CONFIG = """stages: [build, test]
gone:
  stage: build
  rules:
    - if: $CI_COMMIT_BRANCH == "never-branch"
  script:
    - print g
uses:
  stage: test
  needs: [gone]
  script:
    - print u
a:
  stage: test
  needs: [b]
  script:
    - print a
b:
  stage: test
  needs: [a]
  script:
    - print b
"""
_B_MATRIX_CONFIG = """stages: [build, test]
variables:
  SHARED: top
.t:
  stage: build
  variables:
    FROM_T: fromt
    SHARED: tmpl
  script:
    - print x
pack:
  extends: .t
  variables:
    SHARED: job
  matrix:
    OS: [linux, mac]
    NODE: [16, 18]
gone:
  stage: test
  rules:
    - if: $CI_COMMIT_BRANCH == "never-branch"
  script:
    - print g
tail:
  stage: test
  script:
    - print t
"""
_B_MATRIX_ROWS = [("pack [linux, 16]", "linux", "16"), ("pack [linux, 18]", "linux", "18"),
                  ("pack [mac, 16]", "mac", "16"), ("pack [mac, 18]", "mac", "18")]
_B_GRAPH_CONFIG = """stages: [build, test, deploy]
bld:
  stage: build
  matrix:
    OS: [a, b]
  script:
    - print b
chk:
  stage: test
  needs: [bld]
  script:
    - print c
late:
  stage: deploy
  script:
    - print l
final:
  stage: test
  needs: [chk]
  script:
    - print f
"""
_B_BAD_BRANCH = "bad-name"
_B_GOOD_BRANCH = "feat/x"
_B_BRANCH_RULE = "^(feat|fix)/"
_B_MESSAGE_RULE = "^[A-Z]"
_B_SECRET_FILE = "x\nAKABCDEFGHIJKLMNOPQR\n"
_B_CLEAN_FILE = "x\nclean\n"
_B_FIRST_MSG, _B_SECOND_MSG, _B_THIRD_MSG = "Start the notes", "Shout line two", "Unrelated file"
_B_BOLD = "strongword"
_B_HOST = "docs.example.test"
_B_WIKI_V2 = "Second version text\n"
_B_T_BASE = '{"cases":[{"name":"login_flow","status":"passed","ms":1},{"name":"stable","status":"passed","ms":1}]}'
_B_T_HEAD = '{"cases":[{"name":"login_flow","status":"failed","ms":1},{"name":"stable","status":"passed","ms":1}]}'
_B_NEW_FAILURE = "login_flow"
_B_HOOK_SECRET = "s3cret-value"
_B_SHORT_REASON = "short"


def _b_check(page: Page, name: str, state: str) -> Locator:
    return page.get_by_role("region", name="Merge checks").get_by_role("listitem", name=check_label(name, state))


def _b_tick_bar(base: str, bar: Locator) -> None:
    expect(bar).to_have_attribute("aria-valuenow", "0", timeout=LIVE_MS)
    for step in range(1, 6):
        tick(base, EXPORT_STEP_MS)
        expect(bar).to_have_attribute("aria-valuenow", str(step * 20), timeout=LIVE_MS)


def _b_sink_requests(base: str, sink: str) -> list[dict]:
    return httpx.get(f"{base}/api/grading/sink/{sink}", timeout=HTTP_TIMEOUT).json()["requests"]


def _b_deliveries(page: Page, url: str) -> Locator:
    hooks = page.get_by_role("region", name="Webhooks")
    expect(hooks).to_be_visible(timeout=LIVE_MS)
    region = hooks.get_by_role("region", name="Deliveries")
    if not region.count():
        click(hooks.get_by_text(url).first)
    expect(region).to_be_visible(timeout=LIVE_MS)
    return region


def _b_choose_pack(page: Page, data: bytes) -> None:
    with page.expect_file_chooser() as chooser:
        click(page.get_by_role("button", name="Choose spurpack file"))
    chooser.value.set_files({"name": "project.spurpack", "mimeType": "text/plain", "buffer": data})


def test_wf_merging_squash_exact_hash(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
        cm("c2", "feat", u["rev"], [act("create", "f.txt", "f\n")], "Feature", start="main", ts=TS0 + 100),
        cm("c3", "main", u["owner"], [act("create", "m.txt", "m\n")], "Main", ts=TS0 + 200)],
        "merge_requests": [mrq("mr1", "feat", u["dev"], title=_B_SQUASH_TITLE)]})
    w.api("owner").ok("PATCH", f"/api/projects/{w.pid}/settings", {"merge_method": "squash"})
    iid, dev = w.iid("mr1"), w.api("dev")
    target = heads(dev, w.pid)["main"]
    tick(base, 5000)
    stamp = now_ms(base) // 1000
    files = {"README.md": "hello\n", "m.txt": "m\n", "f.txt": "f\n"}
    message = f"{_B_SQUASH_TITLE} (!{iid})"
    expected = commit_id(tree_of(files), [target], w.u["dev"], stamp, w.u["dev"], stamp, message)
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}") as page:
        click(page.get_by_role("button", name="Merge", exact=True))
        expect(page.get_by_role("heading", name="Merged into main")).to_be_visible(timeout=LIVE_MS)
        assert heads(dev, w.pid)["main"] == expected
        page.goto(base + f"/projects/{w.pid}/-/commit/{expected}")
        expect(page.get_by_role("heading", level=1, name=f"Commit {expected[:7]}")).to_be_visible()
    assert dev.get(f"/api/projects/{w.pid}/commits/{expected}")["parents"] == [target]


def test_wf_merging_fast_forward_after_rebase(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
        cm("c2", "feat", u["rev"], [act("create", "r.txt", "r\n")], _B_REPLAYED, start="main", ts=TS0 + 100),
        cm("c3", "main", u["owner"], [act("create", "m.txt", "m\n")], "Main", ts=TS0 + 200)],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    w.api("owner").ok("PATCH", f"/api/projects/{w.pid}/settings", {"merge_method": "fast_forward"})
    iid, dev = w.iid("mr1"), w.api("dev")
    target = heads(dev, w.pid)["main"]
    tick(base, 7000)
    stamp = now_ms(base) // 1000
    tree = tree_of({"README.md": "hello\n", "m.txt": "m\n", "r.txt": "r\n"})
    expected = commit_id(tree, [target], w.u["rev"], TS0 + 100, w.u["dev"], stamp, _B_REPLAYED)
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}") as page:
        expect(_b_check(page, "rebase", "failed")).to_contain_text("Source branch must be rebased onto main.")
        click(page.get_by_role("button", name="Rebase", exact=True))
        expect(_b_check(page, "rebase", "passed")).to_be_visible(timeout=LIVE_MS)
        assert heads(dev, w.pid)["feat"] == expected
        click(page.get_by_role("button", name="Merge", exact=True))
        expect(page.get_by_role("heading", name="Merged into main")).to_be_visible(timeout=LIVE_MS)
    assert heads(dev, w.pid)["main"] == expected


def test_wf_merging_stack_retarget_other_target(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "rel", u["owner"], [act("create", "r.txt", "r\n")], "Rel", start="main"),
                    cm("c3", "fa", u["dev"], [act("create", "a.txt", "a\n")], "A", start="rel"),
                    cm("c4", "fb", u["rev"], [act("create", "b.txt", "b\n")], "B", start="fa")],
        "issues": [issue("i1", "Export fails", u["rep"])],
        "merge_requests": [mrq("A", "fa", u["dev"], target="rel", description="Closes #1", delete_source_branch=True),
                           mrq("B", "fb", u["rev"], target="fa")]})
    a, b, dev = w.iid("A"), w.iid("B"), w.api("dev")
    with as_user(browser, base, w.u["rev"], f"/projects/{w.pid}/-/merge_requests/{b}") as other, \
            as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{a}") as page:
        expect(_b_check(other, "stack", "failed")).to_contain_text(f"Waiting for !{a} to merge.")
        click(page.get_by_role("button", name="Merge", exact=True))
        expect(page.get_by_role("heading", name="Merged into rel")).to_be_visible(timeout=LIVE_MS)
        expect(other.get_by_text(f"Retargeted from fa to rel because !{a} merged.").first).to_be_visible(timeout=LIVE_MS)
        expect(_b_check(other, "stack", "failed")).to_have_count(0, timeout=LIVE_MS)
    assert mr(dev, w.pid, b)["target"] == "rel" and "fa" not in heads(dev, w.pid)
    assert issue_get(dev, w.pid, w.issue_iid("i1"))["state"] == "opened"


def test_wf_pipeline_config_cycle_and_removed_need(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = lint_world(base)
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/ci/editor?ref=main") as page:
        fill(page.get_by_role("textbox", name="Pipeline config"), _B_CYCLE_CONFIG)
        click(page.get_by_role("button", name="Check config"))
        results = page.get_by_role("region", name="Lint results")
        expect(results.get_by_role("button", name=_B_REMOVED_RE)).to_be_visible(timeout=LIVE_MS)
        expect(results.get_by_role("button", name=_B_CYCLE, exact=True)).to_be_visible()
        expect(results.get_by_role("button")).to_have_count(2)


def test_wf_pipeline_config_matrix_expanded_jobs(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = lint_world(base)
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/ci/editor?ref=main") as page:
        fill(page.get_by_role("textbox", name="Pipeline config"), _B_MATRIX_CONFIG)
        click(page.get_by_role("button", name="Check config"))
        expect(page.get_by_role("region", name="Lint results")).to_contain_text("Valid. 5 jobs in 2 stages.", timeout=LIVE_MS)
        rows = page.get_by_role("list", name="Expanded jobs").get_by_role("listitem")
        expect(rows).to_have_count(5)
        for name, os_name, node in _B_MATRIX_ROWS:
            row = rows.filter(has_text=name)
            expect(row).to_have_count(1)
            expect(row).to_contain_text("build")
            expect(row).to_contain_text("FROM_T=fromt")
            expect(row).to_contain_text("SHARED=job")
            expect(row).to_contain_text(f"OS={os_name}")
            expect(row).to_contain_text(f"NODE={node}")


def test_wf_pipeline_config_graph_matrix_layers(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    plid = gpush(w, "main", "owner", [act("create", "spurline.pipeline.yml", _B_GRAPH_CONFIG)], "Graph")["pipeline"]["id"]
    run_all(base, w.pid)
    a, b = "bld [a]", "bld [b]"
    expected = {a: (0, 0), b: (0, 1), "chk": (1, 0), "final": (2, 0), "late": (2, 1)}
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/pipelines/{plid}") as page:
        graph = page.get_by_role("group", name="Pipeline graph")
        chk_label = graph_label("chk", "test", "success", [a, b])
        expect(graph.get_by_role("button", name=chk_label, exact=True)).to_be_visible(timeout=LIVE_MS)
        expect(graph.get_by_role("button", name=re.compile(r"^Job "))).to_have_count(len(expected))
        for name, (layer, row) in expected.items():
            node = graph.get_by_role("button", name=re.compile(rf"^Job {re.escape(name)},"))
            expect(node).to_have_attribute("data-layer", str(layer))
            expect(node).to_have_attribute("data-row", str(row))
            expect(node).to_have_attribute("data-x", str(GRAPH_ORIGIN + layer * GRAPH_DX))
            expect(node).to_have_attribute("data-y", str(GRAPH_ORIGIN + row * GRAPH_DY))
        edges = sorted((e["from"], e["to"]) for e in graph.evaluate(EDGES_JS))
        assert edges == sorted([(a, "chk"), (b, "chk"), ("chk", "final")]), edges


def test_wf_commits_wiki_push_rule_order_editor(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "push_rules": {"branch_name": _B_BRANCH_RULE, "commit_message": _B_MESSAGE_RULE, "forbidden_files": [],
                       "required_files": [], "secrets": True},
        "commits": [cm("c1", "main", u["owner"], [act("create", "a.txt", "a\n")], "First")]})
    dev, a_file = w.api("dev"), "a.txt"
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/edit?" + urlencode({"ref": "main", "path": a_file})) as page:
        edit = page.get_by_role("textbox", name=f"Edit {a_file}")
        branch, message = page.get_by_role("textbox", name="New branch name"), page.get_by_role("textbox", name="Commit message")
        commit = page.get_by_role("button", name="Commit", exact=True)
        fill(edit, _B_SECRET_FILE)
        fill(branch, _B_BAD_BRANCH)
        fill(message, "lower")
        click(commit)
        expect(page.get_by_text(f"Branch name {_B_BAD_BRANCH} doesn't match {_B_BRANCH_RULE}.").first).to_be_visible(timeout=LIVE_MS)
        fill(branch, _B_GOOD_BRANCH)
        click(commit)
        expect(page.get_by_text(f"Commit message doesn't match {_B_MESSAGE_RULE}.").first).to_be_visible(timeout=LIVE_MS)
        fill(message, "Add notes")
        click(commit)
        expect(page.get_by_text(f"Secret found: cloud-key in {a_file} at line 2.").first).to_be_visible(timeout=LIVE_MS)
        assert _B_GOOD_BRANCH not in heads(dev, w.pid)
        fill(edit, _B_CLEAN_FILE)
        click(commit)
        expect(page).to_have_url(re.compile(rf"/projects/{w.pid}/-/commit/[0-9a-f]{{64}}$"), timeout=LIVE_MS)
    stored = dev.get(f"/api/projects/{w.pid}/files?" + urlencode({"ref": _B_GOOD_BRANCH, "path": a_file}))
    assert stored["content"] == _B_CLEAN_FILE


def test_wf_commits_wiki_hash_history_blame_pages(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"commits": [
        cm("c1", "main", u["owner"], [act("create", "f.txt", "one\ntwo\n")], _B_FIRST_MSG),
        cm("c2", "main", u["dev"], [act("update", "f.txt", "one\nTWO\n")], _B_SECOND_MSG, ts=TS0 + 10),
        cm("c3", "main", u["rev"], [act("create", "g.txt", "g\n")], _B_THIRD_MSG, ts=TS0 + 20)]})
    owner, dev, rev = w.u["owner"], w.u["dev"], w.u["rev"]
    first = commit_id(tree_of({"f.txt": "one\ntwo\n"}), [], owner, TS0, owner, TS0, _B_FIRST_MSG)
    second = commit_id(tree_of({"f.txt": "one\nTWO\n"}), [first], dev, TS0 + 10, dev, TS0 + 10, _B_SECOND_MSG)
    third = commit_id(tree_of({"f.txt": "one\nTWO\n", "g.txt": "g\n"}), [second], rev, TS0 + 20, rev, TS0 + 20, _B_THIRD_MSG)
    assert heads(w.api("dev"), w.pid)["main"] == third
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/commit/{second}") as page:
        expect(page.get_by_role("heading", level=1, name=f"Commit {second[:7]}")).to_be_visible(timeout=LIVE_MS)
        page.goto(base + f"/projects/{w.pid}/-/commits?" + urlencode({"ref": "main", "path": "f.txt"}))
        main = page.get_by_role("main")
        expect(main).to_contain_text(re.compile(f"{second[:7]}|{re.escape(_B_SECOND_MSG)}"), timeout=LIVE_MS)
        expect(main).to_contain_text(re.compile(f"{first[:7]}|{re.escape(_B_FIRST_MSG)}"))
        expect(main).not_to_contain_text(third[:7])
        expect(main).not_to_contain_text(_B_THIRD_MSG)
        page.goto(base + f"/projects/{w.pid}/-/blame?" + urlencode({"ref": "main", "path": "f.txt"}))
        rows = page.get_by_role("table", name="Blame").get_by_role("row")
        expect(rows.filter(has_text="TWO")).to_contain_text(re.compile(f"{second[:7]}|{dev}"), timeout=LIVE_MS)
        expect(rows.filter(has_text="one")).to_contain_text(re.compile(f"{first[:7]}|{owner}"))


def test_wf_commits_wiki_render_subset_and_restore(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    lt, gt = chr(60), chr(62)
    scheme = "java" + "script:"
    content = (f"# Notes\n\n**{_B_BOLD}** {lt}em{gt}raw{lt}/em{gt}\n\n[good](https://{_B_HOST}) "
               f"[bad]({scheme}void)\n")
    w = world(base, lambda t, u: {"wiki": [{"slug": "home", "title": "Home", "content": content, "author": u["owner"]}]})
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/wiki/home") as page:
        main = page.get_by_role("main")
        expect(main.get_by_role("heading", name="Notes")).to_be_visible(timeout=LIVE_MS)
        expect(main.locator("strong").filter(has_text=_B_BOLD)).to_be_visible()
        expect(main.locator("em")).to_have_count(0)
        expect(main.get_by_role("link", name="good")).to_have_attribute("href", re.compile(re.escape(_B_HOST)))
        expect(main.get_by_role("link", name="bad", exact=True)).to_have_count(0)
        fill(page.get_by_role("textbox", name="Page content"), _B_WIKI_V2)
        click(page.get_by_role("button", name="Save page"))
        api = w.api("dev")
        eventually(lambda: api.get(f"/api/projects/{w.pid}/wiki/home")["version"] == 2, "the save makes version 2")
        api.ok("POST", f"/api/projects/{w.pid}/wiki/home/restore", {"version": 1}, status=201)
        page.reload()
        expect(page.get_by_role("textbox", name="Page content")).to_have_value(content, timeout=LIVE_MS)
        expect(main.locator("strong").filter(has_text=_B_BOLD)).to_be_visible()
    assert api.get(f"/api/projects/{w.pid}/wiki/home")["version"] == 3


def test_wf_reports_delivery_export_finding_live_two_people(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w, iid, _ = reports_world(base, "S_HIGH")
    path = f"/projects/{w.pid}/-/merge_requests/{iid}"
    with as_user(browser, base, w.u["dev"], path) as author, as_user(browser, base, w.u["maint"], path) as page:
        approvals = author.get_by_role("region", name="Approvals")
        expect(approvals).to_contain_text("Security review", timeout=LIVE_MS)
        expect(_b_check(author, "security", "failed")).to_contain_text("1 security finding needs review.")
        reason = page.get_by_role("textbox", name="Dismissal reason")
        reason.focus()
        page.keyboard.type(_B_SHORT_REASON)
        page.get_by_role("button", name="Dismiss finding").focus()
        page.keyboard.press("Enter")
        expect(page.get_by_text("Give a reason of at least 10 characters.").first).to_be_visible(timeout=LIVE_MS)
        fill(reason, DISMISS_REASON)
        page.get_by_role("button", name="Dismiss finding").focus()
        page.keyboard.press("Enter")
        expect(_b_check(author, "security", "inactive")).to_be_visible(timeout=LIVE_MS)
        expect(approvals).not_to_contain_text("Security review", timeout=LIVE_MS)
        reopen = page.get_by_role("button", name="Reopen finding")
        expect(reopen).to_be_visible(timeout=LIVE_MS)
        reopen.focus()
        page.keyboard.press("Enter")
        expect(_b_check(author, "security", "failed")).to_be_visible(timeout=LIVE_MS)
        expect(approvals).to_contain_text("Security review", timeout=LIVE_MS)


def test_wf_reports_delivery_export_regions_read_exact(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    variables = {**REPORT_VARS, "T_BASE": _B_T_BASE, "T_HEAD": _B_T_HEAD}
    w = world(base, lambda t, u: {"variables": variables, "commits": [
        cm("c1", "main", u["owner"], [act("create", "spurline.pipeline.yml", report_config("BASE"))], "First")]})
    gpush(w, "main", "maint", [act("create", "base.txt", "b\n")], "Base")
    run_all(base, w.pid)
    gpush(w, "feat", "dev", [act("update", "spurline.pipeline.yml", report_config("HEAD"))], "Head", start_ref="main")
    run_all(base, w.pid)
    iid = open_mr(w.api("dev"), w.pid, "feat", "Reports")
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}") as page:
        summary = page.get_by_role("region", name="Test summary")
        expect(summary).to_contain_text("1 new failures, 1 failed, 1 passed, 0 skipped", timeout=LIVE_MS)
        expect(summary).to_contain_text(_B_NEW_FAILURE)
        expect(page.get_by_role("region", name="Coverage")).to_contain_text("Coverage 81.25% (-1.50)")
        expect(page.get_by_role("region", name="Code quality")).to_contain_text("1 new, 1 resolved")
        expect(page.get_by_role("region", name="Security")).to_contain_text("No security findings need review.")
        only_coverage = ("stages: [test]\nrep:\n  stage: test\n  script:\n    - write r/c.json $C_BASE\n"
                         "    - emit coverage r/c.json\n")
        gpush(w, "feat", "dev", [act("update", "spurline.pipeline.yml", only_coverage)], "Only coverage")
        run_all(base, w.pid)
        page.reload()
        expect(page.get_by_role("region", name="Test summary")).to_contain_text("No test report.", timeout=LIVE_MS)
        expect(page.get_by_role("region", name="Coverage")).to_contain_text("Coverage 82.75% (+0.00)")
        expect(page.get_by_role("region", name="Code quality")).to_contain_text("No code quality report.")


def test_wf_reports_delivery_export_webhook_rows_redeliver(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    sink = f"bhook{uuid.uuid4().hex[:8]}"
    url = f"http://127.0.0.1:4173/api/grading/sink/{sink}"
    w = world(base)
    owner = w.api("owner")
    hook = owner.ok("POST", f"/api/projects/{w.pid}/webhooks",
                    {"url": url, "secret": _B_HOOK_SECRET, "events": ["push"]}, status=201)["id"]
    httpx.put(f"{base}/api/grading/sink/{sink}", json={"status": 500}, timeout=HTTP_TIMEOUT)
    gpush(w, "main", "owner", [act("create", "w.txt", "w\n")], HOOK_MESSAGE)
    eventually(lambda: len(_b_sink_requests(base, sink)) == 1, "first attempt reaches the sink")
    last = len(WEBHOOK_GAPS) + 1
    for number, gap in enumerate(WEBHOOK_GAPS, start=2):
        tick(base, gap)
        eventually(lambda n=number: len(_b_sink_requests(base, sink)) == n, f"attempt {number} on the server clock")

    def failed_row() -> dict | None:
        listed = owner.get(f"/api/projects/{w.pid}/webhooks/{hook}/deliveries")["deliveries"]
        found = [d for d in listed if d["state"] == "failed"]
        return found[0] if found else None

    dead = eventually(failed_row, "the delivery is failed after the last gap")
    assert len(dead["attempts"]) == last
    httpx.put(f"{base}/api/grading/sink/{sink}", json={"status": 200}, timeout=HTTP_TIMEOUT)
    owner.ok("POST", f"/api/deliveries/{dead['id']}/redeliver", status=201)
    eventually(lambda: len(_b_sink_requests(base, sink)) == last + 1, "redelivery reaches the sink")
    got = _b_sink_requests(base, sink)
    newest, failed = got[-1], got[-2]
    assert newest["body"] == failed["body"]
    assert newest["headers"]["x-spurline-delivery"] != failed["headers"]["x-spurline-delivery"]
    stamp = newest["headers"]["x-spurline-timestamp"]
    sign = hmac.new(_B_HOOK_SECRET.encode(), f"{stamp}.{newest['body']}".encode(), hashlib.sha256).hexdigest()
    assert newest["headers"]["x-spurline-signature"] == f"sha256={sign}"


C_FIRST, C_SECOND = "first-line", "second-line"
C_WAIT_MS = 1000
C_GROUP = "deploy-lock"


def _c_enter(control: Locator) -> None:
    control.focus()
    expect(control).to_be_focused()
    control.page.keyboard.press("Enter")


def _c_said(page: Page, text: str) -> None:
    expect(page.get_by_text(text).first).to_be_attached(timeout=LIVE_MS)


def _c_row(page: Page, name: str, status: str) -> Locator:
    return page.get_by_role("list", name="Jobs").get_by_role(
        "listitem", name=re.compile(rf"^Job {re.escape(name)}, stage \w+, {status}, "))


def _c_cars(w: World) -> dict[int, str]:
    listed = w.api("owner").get(f"/api/projects/{w.pid}/train?target=main")["cars"]
    return {c["iid"]: c["sha"] for c in listed}


def _c_car(page: Page, iid: int) -> Locator:
    return page.get_by_role("list", name="Merge train").get_by_role(
        "listitem", name=re.compile(rf"^Position \d+, !{iid}, "))


def test_wf_pipeline_run_live_log_second_context(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    cfg = (f"stages: [build]\nbuild:\n  stage: build\n  script:\n    - print {C_FIRST}\n    - wait {C_WAIT_MS}\n"
           f"    - print {C_SECOND}\n")
    plid = gpush(w, "wl", "dev", [act("create", "spurline.pipeline.yml", cfg)], "Run", start_ref="main")["pipeline"]["id"]
    build = job(pipeline(w.api("dev"), plid), "build")["id"]
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/jobs/{build}") as page, \
            as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/pipelines/{plid}") as watcher:
        log = page.get_by_role("log", name="Job log")
        rounds(base, w.pid)
        expect(log).to_contain_text(C_FIRST, timeout=LIVE_MS)
        expect(log).not_to_contain_text(C_SECOND)
        announced(page, f"Job {'build'} started")
        rounds(base, w.pid)
        expect(log).to_contain_text(f"Waiting {C_WAIT_MS} ms", timeout=LIVE_MS)
        rounds(base, w.pid)
        expect(_c_row(watcher, "build", "running")).to_be_visible(timeout=LIVE_MS)
        expect(log).not_to_contain_text(C_SECOND)
        tick(base, C_WAIT_MS)
        rounds(base, w.pid, 2)
        expect(log).to_contain_text(C_SECOND, timeout=LIVE_MS)
        expect(log).to_contain_text(f"Job finished: {'success'}", timeout=LIVE_MS)
        announced(watcher, f"Pipeline {plid} succeeded")
        toggle = page.get_by_role("button", name=f"Toggle section {'script'}", exact=True)
        printed = log.get_by_text(C_FIRST)
        _c_enter(toggle)
        expect(printed).to_be_hidden()
        expect(toggle).to_be_focused()
        page.keyboard.press("Enter")
        expect(printed).to_be_visible()
    s3_wait(f"logs/{build}.log")


def test_wf_pipeline_run_retry_and_newer_push(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    api = w.api("dev")
    cfg = "flaky:\n  stage: build\n  retry: 1\n  script:\n    - exit 1\n"
    plid = gpush(w, "wr", "dev", [act("create", "spurline.pipeline.yml", cfg)], "Run", start_ref="main")["pipeline"]["id"]
    path = f"/projects/{w.pid}/-/pipelines/{plid}"
    with as_user(browser, base, w.u["dev"], path) as page, as_user(browser, base, w.u["owner"], path) as other:
        run_all(base, w.pid)
        announced(page, f"Pipeline {plid} failed: job {'flaky'}")
        rows = page.get_by_role("list", name="Jobs")
        expect(rows.locator('[data-retried="true"]')).to_have_count(1, timeout=LIVE_MS)
        expect(page.get_by_role("list", name="Stages").get_by_role(
            "listitem", name=re.compile(r"^Stage 0?1 build, failed$"))).to_be_visible()
        _c_enter(other.get_by_role("button", name="Retry job", exact=True).first)
        expect(_c_row(page, "flaky", "pending")).to_be_visible(timeout=LIVE_MS)
    attempts = [j for j in pipeline(api, plid)["jobs"] if j["name"] == "flaky"]
    assert len(attempts) == 3 and len({j["id"] for j in attempts}) == 3
    run_all(base, w.pid)
    slow = "work:\n  stage: build\n  interruptible: true\n  script:\n    - wait 1000\n"
    older = gpush(w, "wi", "dev", [act("create", "spurline.pipeline.yml", slow)], "Old", start_ref="main")["pipeline"]["id"]
    work = job(pipeline(api, older), "work")["id"]
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/pipelines/{older}") as page:
        newer = gpush(w, "wi", "dev", [act("create", "n.txt", "n\n")], "New")["pipeline"]["id"]
        announced(page, f"Pipeline {older} was canceled")
        expect(_c_row(page, "work", "canceled")).to_be_visible(timeout=LIVE_MS)
        page.goto(base + f"/projects/{w.pid}/-/jobs/{work}")
        expect(page.get_by_role("log", name="Job log")).to_contain_text(f"Canceled by newer pipeline {newer}.")


def test_wf_pipeline_run_manual_gate_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    cfg = ("stages: [build, test]\ngate:\n  stage: build\n  when: manual\n  allow_failure: false\n  script:\n    - print g\n"
           "after:\n  stage: test\n  script:\n    - print a\n")
    plid = gpush(w, "wm", "dev", [act("create", "spurline.pipeline.yml", cfg)], "Run", start_ref="main")["pipeline"]["id"]
    path = f"/projects/{w.pid}/-/pipelines/{plid}"
    with as_user(browser, base, w.u["dev"], path, record=True) as page, \
            as_user(browser, base, w.u["owner"], path, reduced=True, record=True) as calm:
        for viewer in (page, calm):
            expect(viewer.get_by_role("list", name="Stages").get_by_role(
                "listitem", name=re.compile(r"^Stage 0?1 build, blocked$"))).to_be_visible()
            expect(_c_row(viewer, "gate", "manual")).to_be_visible()
            viewer.evaluate(CLEAR_ANIMS)
        _c_enter(calm.get_by_role("button", name=f"Play {'gate'}", exact=True))
        expect(_c_row(page, "gate", "pending")).to_be_visible(timeout=LIVE_MS)
        rounds(base, w.pid)
        expect(_c_row(page, "gate", "success")).to_be_visible(timeout=LIVE_MS)
        expect(_c_row(calm, "gate", "success")).to_be_visible(timeout=LIVE_MS)
        played = anims(page, ["job-status"])
        assert played and all(a["duration"] == ANIM_MS["job-status"] for a in played), played
        assert anims(calm, ["job-status"]) == []
        rounds(base, w.pid, 2)
        for viewer in (page, calm):
            announced(viewer, f"Pipeline {plid} succeeded")
    assert pipeline(w.api("dev"), plid)["status"] == "success"


def test_wf_merge_train_remove_by_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = train_world(base, train_config(slow=True), cars=4)
    before = _c_cars(w)
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/train?target=main", record=True) as watch, \
            as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/merge_requests/2") as page:
        expect(_c_car(watch, 4)).to_have_attribute("data-sha", before[4])
        watch.evaluate(CLEAR_ANIMS)
        _c_enter(page.get_by_role("button", name="Remove from train", exact=True))
        eventually(lambda: 2 not in _c_cars(w), "the removed car leaves the stored train")
        after = _c_cars(w)
        assert after[1] == before[1], "a car ahead is untouched"
        assert after[3] != before[3] and after[4] != before[4], "cars behind get new stored commits"
        expect(watch.get_by_role("list", name="Merge train").get_by_role("listitem")).to_have_count(3, timeout=LIVE_MS)
        _c_said(watch, "Removed from merge train")
        _c_said(watch, car_moved(4, 3, after[4][:7]))
        expect(_c_car(watch, 4)).to_have_attribute("data-position", "3")
        expect(_c_car(watch, 4)).to_have_attribute("data-sha", after[4])
        advance(watch, 3 * 80 + 20)
        moved = anims(watch, ["train-step", "train-leave"])
        assert any(a["id"] == "train-leave" and a["duration"] == ANIM_MS["train-leave"] for a in moved), moved
        assert sum(a["id"] == "train-step" and a["duration"] == ANIM_MS["train-step"] for a in moved) >= 2, moved
        advance(watch, KICK_LAST_LOCK_MS + 120)
        assert kicker_text(_c_car(watch, 4), after[4][:7]) == after[4][:7]
    assert f"Removed from merge train: removed by {w.u['owner']}." in note_bodies(mr_notes(w.api("dev"), w.pid, 2, "history"))


def test_wf_merge_train_merge_now_rebuilds(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = train_world(base, train_config(slow=True))
    api = w.api("owner")
    before = _c_cars(w)
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/train?target=main") as watch, \
            as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/merge_requests/2") as page:
        expect(_c_car(watch, 3)).to_have_attribute("data-sha", before[3])
        _c_enter(page.get_by_role("button", name="Merge now", exact=True))
        eventually(lambda: mr(api, w.pid, 2)["state"] == "merged", "Merge now merges the request at once")
        expect(page.get_by_role("heading", name=f"Merged into {'main'}")).to_be_visible(timeout=LIVE_MS)
        after = _c_cars(w)
        assert set(after) == {1, 3} and after[1] != before[1] and after[3] != before[3]
        expect(watch.get_by_role("list", name="Merge train").get_by_role("listitem")).to_have_count(2, timeout=LIVE_MS)
        expect(_c_car(watch, 1)).to_have_attribute("data-sha", after[1])
        expect(_c_car(watch, 3)).to_have_attribute("data-sha", after[3])
        expect(_c_car(watch, 3)).to_have_attribute("data-position", "2")
        _c_said(watch, car_moved(3, 2, after[3][:7]))
    hs = heads(api, w.pid)
    assert api.get(f"/api/projects/{w.pid}/commits/{after[1]}")["parents"] == [hs["main"], hs["f1"]]
    assert api.get(f"/api/projects/{w.pid}/commits/{after[3]}")["parents"] == [after[1], hs["f3"]]
    assert "Removed from merge train: merged out of order." in note_bodies(mr_notes(api, w.pid, 2, "history"))


def test_wf_merge_train_pushes_reduced_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = train_world(base, train_config(slow=True))
    path = f"/projects/{w.pid}/-/train?target=main"
    with as_user(browser, base, w.u["dev"], path, record=True) as page, \
            as_user(browser, base, w.u["owner"], path, reduced=True, record=True) as calm:
        expect(_c_car(page, 3)).to_be_visible()
        advance(page, KICK_LAST_LOCK_MS + 120)
        calm.evaluate(CLEAR_ANIMS)
        first = _c_cars(w)
        gpush(w, "main", "owner", [act("create", "t.txt", "t\n")], "Target push")
        moved = eventually(lambda: (c := _c_cars(w)) and all(c[i] != first[i] for i in first) and c,
                           "a target push rebuilds every car")
        for viewer in (page, calm):
            for iid in (1, 2, 3):
                expect(_c_car(viewer, iid)).to_have_attribute("data-sha", moved[iid], timeout=LIVE_MS)
            _c_said(viewer, car_moved(3, 3, moved[3][:7]))
        for iid in (1, 2, 3):
            assert kicker_text(_c_car(calm, iid), moved[iid][:7]) == moved[iid][:7]
        advance(page, KICK_LAST_LOCK_MS + 120)
        for iid in (1, 2, 3):
            assert kicker_text(_c_car(page, iid), moved[iid][:7]) == moved[iid][:7]
        gpush(w, "f2", "dev", [act("update", "f2.txt", "changed\n")], "Source push")
        left = eventually(lambda: (c := _c_cars(w)) and 2 not in c and c[3] != moved[3] and c,
                          "a source push removes that car and rebuilds the car behind")
        assert set(left) == {1, 3} and left[1] == moved[1]
        _c_said(page, "Removed from merge train")
        for viewer in (page, calm):
            expect(viewer.get_by_role("list", name="Merge train").get_by_role("listitem")).to_have_count(2, timeout=LIVE_MS)
            _c_said(viewer, car_moved(3, 2, left[3][:7]))
        assert kicker_text(_c_car(calm, 3), left[3][:7]) == left[3][:7]
        assert anims(calm, ["train-step", "train-leave"]) == []
    assert "Removed from merge train: new commits were pushed." in note_bodies(mr_notes(w.api("dev"), w.pid, 2, "history"))


def test_wf_environments_resource_group_order(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    body = f"  stage: deploy\n  resource_group: {C_GROUP}\n  script:\n    - wait {C_WAIT_MS}\n    - print done\n"
    cfg = f"stages: [deploy]\nalpha:\n{body}beta:\n{body}"
    plid = gpush(w, "wg", "dev", [act("create", "spurline.pipeline.yml", cfg)], "Run", start_ref="main")["pipeline"]["id"]
    path = f"/projects/{w.pid}/-/pipelines/{plid}"
    with as_user(browser, base, w.u["dev"], path, record=True) as page, as_user(browser, base, w.u["owner"], path) as other:
        expect(_c_row(page, "beta", "pending")).to_be_visible()
        page.evaluate(CLEAR_ANIMS)
        rounds(base, w.pid)
        expect(_c_row(page, "alpha", "running")).to_be_visible(timeout=LIVE_MS)
        announced(other, f"Job {'alpha'} started")
        expect(_c_row(other, "beta", "pending")).to_be_visible()
        played = anims(page, ["job-status"])
        assert played and all(a["duration"] == ANIM_MS["job-status"] for a in played), played
        tick(base, C_WAIT_MS)
        rounds(base, w.pid, 2)
        expect(_c_row(other, "alpha", "success")).to_be_visible(timeout=LIVE_MS)
        expect(_c_row(other, "beta", "pending")).to_be_visible()
        rounds(base, w.pid)
        expect(_c_row(page, "beta", "running")).to_be_visible(timeout=LIVE_MS)
        announced(other, f"Job {'beta'} started")
        tick(base, C_WAIT_MS)
        rounds(base, w.pid, 2)
        for viewer in (page, other):
            announced(viewer, f"Pipeline {plid} succeeded")


def test_wf_environments_review_auto_stop_clock(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {"variables": {"CODE": "0"}, "commits": [
        cm("c1", "main", u["owner"], [act("create", "spurline.pipeline.yml", PROD_CONFIG)], "First")]},
        zones={"dev": "Asia/Tokyo"})
    dev, owner = w.api("dev"), w.api("owner")
    review = "rv:\n  stage: build\n  script:\n    - print r\n  environment:\n    name: review/$CI_MERGE_REQUEST_IID\n"
    iids: dict[str, int] = {}
    for branch in ("ra", "rb"):
        gpush(w, branch, "dev", [act("create", f"{branch}.txt", "x\n")], branch, start_ref="main")
        iids[branch] = open_mr(dev, w.pid, branch, f"Review {branch}")
        gpush(w, branch, "dev", [act("update", "spurline.pipeline.yml", review)], "Review")
        run_all(base, w.pid)
    name_a, name_b = f"review/{iids['ra']}", f"review/{iids['rb']}"
    env_a, env_b = environment(owner, w.pid, name_a), environment(owner, w.pid, name_b)
    stops = dt.datetime.fromisoformat(env_a["auto_stop_at"].replace("Z", "+00:00")).astimezone(ZoneInfo("Asia/Tokyo"))
    text = f"Auto-stops at {stops.strftime('%Y-%m-%d %H:%M:%S')} Asia/Tokyo"
    with as_user(browser, base, w.u["dev"], "/") as page, \
            as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/environments/{env_b['id']}") as keeper:
        page.clock.set_system_time(dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=7))
        page.goto(base + f"/projects/{w.pid}/-/environments/{env_a['id']}")
        expect(page.get_by_text(text).first).to_be_visible()
        expect(keeper.get_by_text("Auto-stops at").first).to_be_visible()
        _c_enter(keeper.get_by_role("button", name="Keep environment", exact=True))
        expect(keeper.get_by_text("Auto-stops at")).to_have_count(0, timeout=LIVE_MS)
        tick(base, AUTO_STOP_MS + 1)
        page.goto(base + f"/projects/{w.pid}/-/environments")
        rows = page.get_by_role("list", name="Environments")
        expect(rows.get_by_role("listitem", name=f"Environment {name_a}, stopped, deployment {1}", exact=True)).to_be_visible()
        expect(rows.get_by_role("listitem", name=f"Environment {name_b}, available, deployment {1}", exact=True)).to_be_visible()


def test_wf_environments_outdated_and_expired_rollback(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = prod_world(base)
    owner = w.api("owner")
    deploy_once(w)
    manual = PROD_CONFIG.replace("  environment:\n    name: production", "  when: manual\n  environment:\n    name: production")
    older = gpush(w, "main", "owner", [act("update", "spurline.pipeline.yml", manual)], "Manual A")["pipeline"]["id"]
    run_all(base, w.pid)
    newer = gpush(w, "main", "owner", [act("create", "n.txt", "n\n")], "Manual B")["pipeline"]["id"]
    owner.ok("POST", f"/api/jobs/{job(pipeline(owner, newer), 'ship')['id']}/play", {"variables": {}})
    run_all(base, w.pid)
    current = latest_deployment(owner, w.pid, "production")["number"]
    ship = job(pipeline(owner, older), "ship")["id"]
    words = f"This deployment is outdated: deployment {current} is newer."
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/jobs/{ship}") as watch, \
            as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/pipelines/{older}") as page:
        _c_enter(page.get_by_role("button", name=f"Play {'ship'}", exact=True))
        eventually(lambda: job(pipeline(owner, older), "ship")["status"] != "manual", "the played job has left manual")
        run_all(base, w.pid)
        expect(_c_row(page, "ship", "failed")).to_be_visible(timeout=LIVE_MS)
        announced(page, f"Pipeline {older} failed: job {'ship'}")
        expect(watch.get_by_text(words).first).to_be_visible(timeout=LIVE_MS)
        tick(base, ARTIFACT_TTL_MS + 1)
        env_id = environment(owner, w.pid, "production")["id"]
        page.goto(base + f"/projects/{w.pid}/-/environments/{env_id}")
        count = len(environment(owner, w.pid, "production")["deployments"])
        _c_enter(page.get_by_role("button", name=f"Roll back to deployment {1}", exact=True))
        announced(page, "Can't roll back: its artifact has expired.")
        expect(page.get_by_text("Can't roll back: its artifact has expired.").first).to_be_visible()
    assert job(pipeline(owner, older), "ship")["failure_reason"] == "outdated_deployment"
    assert len(environment(owner, w.pid, "production")["deployments"]) == count


_D_COMMENT = "Moving this now."
_D_WEIGHT = 8
_D_LOCAL_LABEL = "team-only"
_D_PROMOTED = "Promote me"
_D_MOVE_OFF = 40


def test_wf_boards_planning_stale_card_refused(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = board_world(base)
    b = w.p["boards"]["b1"]
    issue_id, n = w.p["issues"]["i2"]["id"], w.issue_iid("i2")
    doing, review = "workflow::doing", "workflow::review"
    path = f"/projects/{w.pid}/-/boards/{b['id']}"
    stale = card(board_state(w.api("owner"), b["id"]), issue_id)["version"]
    sent: list[int] = []

    def old_version(route: Any) -> None:
        body = dict(route.request.post_data_json)
        sent.append(body["issue"])
        body["version"] = stale
        route.continue_(post_data=json.dumps(body))

    with as_user(browser, base, w.u["dev"], path) as watcher, as_user(browser, base, w.u["rep"], path) as page:
        item = page.get_by_role("listitem", name=re.compile(re.escape(f"Issue #{n}, {TIDY_TITLE},")))
        expect(item).to_have_accessible_name(re.compile(re.escape(f"in {doing}") + "$"))
        w.api("owner").ok("POST", f"/api/boards/{b['id']}/moves", {"issue": issue_id, "to_list": b["lists"][review],
                                                                   "after_id": None, "version": stale})
        landed = re.compile(re.escape(f"in {review}") + "$")
        expect(item).to_have_accessible_name(landed, timeout=LIVE_MS)
        expect(watcher.get_by_role("list", name=review)).to_contain_text(f"{2} issues", timeout=LIVE_MS)
        page.route("**/api/boards/*/moves", old_version)
        item.focus()
        page.keyboard.press("Space")
        expect(item).to_have_attribute("data-lifted", "true")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Space")
        announced(page, f"{w.u['owner']} moved this card first. It is now in {review}.")
        expect(item).to_have_accessible_name(landed, timeout=LIVE_MS)
        expect(watcher.get_by_role("list", name=review)).to_contain_text(f"{2} issues")
        assert sent == [issue_id]
    assert review in issue_get(w.api("rep"), w.pid, n)["labels"]


def test_wf_boards_planning_quick_actions_reach_board(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = board_world(base)
    n = w.issue_iid("i1")
    doing, review = "workflow::doing", "workflow::review"
    board = f"/projects/{w.pid}/-/boards/{w.p['boards']['b1']['id']}"
    with as_user(browser, base, w.u["dev"], board) as watcher, \
            as_user(browser, base, w.u["rep"], f"/projects/{w.pid}/-/issues/{n}") as page:
        expect(watcher.get_by_role("list", name=review)).to_contain_text("1 issue")
        fill(page.get_by_role("textbox", name="Comment"), f"{_D_COMMENT}\n/label ~{review}\n/weight {_D_WEIGHT}")
        send = page.get_by_role("button", name="Comment", exact=True)
        send.focus()
        page.keyboard.press("Enter")
        announced(page, f"Set weight to {_D_WEIGHT}.")
        replaced = f"Replaced ~{doing} with ~{review}."
        expect(page.get_by_text(replaced).first).to_be_visible(timeout=LIVE_MS)
        expect(page.get_by_text(_D_COMMENT).first).to_be_visible()
        moved = watcher.get_by_role("listitem", name=f"Issue #{n}, {FIX_TITLE}, weight {_D_WEIGHT}, {2} labels, in {review}")
        expect(moved).to_be_visible(timeout=LIVE_MS)
        expect(watcher.get_by_role("list", name=review)).to_contain_text(f"{2} issues", timeout=LIVE_MS)
    notes = issue_notes(w.api("rep"), w.pid, n)
    assert notes.count(replaced) == 1
    assert _D_COMMENT in notes and not any(note.startswith("/") for note in notes)


def test_wf_boards_planning_promote_to_epic_page(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "labels": [{"name": _D_LOCAL_LABEL, "description": ""}],
        "issues": [issue("i1", _D_PROMOTED, u["owner"], labels=["workflow::doing", _D_LOCAL_LABEL])]},
        extra=lambda t, u: {"group_labels": [{"group": f"g{t}", "name": "workflow::doing", "description": ""}]})
    n = w.issue_iid("i1")
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/issues/{n}") as page:
        fill(page.get_by_role("textbox", name="Comment"), "/promote")
        send = page.get_by_role("button", name="Comment", exact=True)
        send.focus()
        page.keyboard.press("Enter")
        promoted = re.compile(r"Promoted to epic &(\d+)\.")
        announced(page, promoted)
        epic = promoted.search(announcements(page).inner_text()).group(1)
        expect(page.get_by_text(f"Promoted to epic &{epic}.").first).to_be_visible()
    assert issue_get(w.api("owner"), w.pid, n)["state"] == "closed"
    with as_user(browser, base, w.u["rep"], f"/groups/{w.sub}/-/epics/{epic}") as reader:
        expect(reader.get_by_role("heading", name=_D_PROMOTED, level=1)).to_be_visible()
        dates = reader.get_by_role("region", name="Epic dates")
        expect(dates).to_contain_text("Start not set")
        expect(dates).to_contain_text("Due not set")
        activity = reader.get_by_role("list", name="Epic activity")
        expect(activity).to_contain_text(f"Copied from #{n}.")
        expect(activity).to_contain_text(f"Dropped labels: ~{_D_LOCAL_LABEL}.")


def test_wf_phone_review_swipe_back_and_drift(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = phone_world(base)
    path = f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}/changes?" + urlencode({"file": B_TS})
    with as_user(browser, base, w.u["rev"], path, size=PHONE, touch=True) as page:
        cdp = session(page)
        grid = page.get_by_role("grid", name="Diff")
        expect(grid.get_by_role("row", name=row_label(2, "added", B_TS), exact=True)).to_be_visible()
        before = page.evaluate("() => history.length")
        x, y = middle(grid)
        touch(cdp, "touchStart", x - 60, y)
        touch(cdp, "touchMove", x + 60, y + _D_MOVE_OFF + 10)
        touch(cdp, "touchEnd")
        expect(grid.get_by_role("row", name=row_label(2, "added", B_TS), exact=True)).to_be_visible()
        assert url_query(page).get("file") == [B_TS]
        x, y = middle(grid)
        touch(cdp, "touchStart", x - 60, y)
        touch(cdp, "touchMove", x + 60, y + 5)
        touch(cdp, "touchEnd")
        announced(page, f"File {1} of {2}: {A_TS}")
        expect(grid.get_by_role("row", name=row_label(2, "added", A_TS), exact=True)).to_be_visible()
        eventually(lambda: url_query(page).get("file") == [A_TS], "the swiped-to file is kept in the URL")
        assert page.evaluate("() => history.length") == before
        page.reload()
        expect(page.get_by_role("grid", name="Diff").get_by_role("row", name=row_label(2, "added", A_TS),
                                                                  exact=True)).to_be_visible()


def test_wf_phone_review_comment_sheet_reaches_author(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = phone_world(base)
    iid = w.iid("mr1")
    with as_user(browser, base, w.u["dev"], f"/projects/{w.pid}/-/merge_requests/{iid}") as author, \
            as_user(browser, base, w.u["rev"], f"/projects/{w.pid}/-/merge_requests/{iid}/changes?" +
                    urlencode({"file": B_TS}), size=PHONE, touch=True) as page:
        cdp = session(page)
        row = page.get_by_role("grid", name="Diff").get_by_role("row", name=re.compile(
            "^" + role_re(row_label(2, "added", B_TS))))
        sheet = page.get_by_role("dialog", name=f"Comment on line {2}")
        rx, ry = middle(row)
        touch(cdp, "touchStart", rx, ry)
        touch(cdp, "touchMove", rx, ry + 12)
        page.clock.fast_forward(LONG_PRESS_MS + 100)
        touch(cdp, "touchEnd")
        expect(sheet).to_have_count(0)
        rx, ry = middle(row)
        touch(cdp, "touchStart", rx, ry)
        page.clock.fast_forward(LONG_PRESS_MS + 100)
        touch(cdp, "touchEnd")
        expect(sheet).to_be_visible()
        expect(sheet.get_by_role("button", name="Start review")).to_be_visible()
        fill(sheet.get_by_role("textbox", name="Comment"), REVIEW_TEXT)
        click(sheet.get_by_role("button", name="Add comment"))
        expect(sheet).to_have_count(0, timeout=LIVE_MS)
        expect(row).to_have_accessible_name(row_label(2, "added", B_TS) + ", 1 unresolved thread", timeout=LIVE_MS)
        expect(author.get_by_role("article", name=thread_label(B_TS, 2)).first).to_be_visible(timeout=LIVE_MS)
        expect(author.get_by_text(REVIEW_TEXT).first).to_be_visible()
        click(page.get_by_role("button", name="Open panel"))
        panel = page.get_by_role("dialog", name="Panel")
        click(panel.get_by_role("tab", name="Threads"))
        expect(panel.get_by_role("article", name=thread_label(B_TS, 2))).to_be_visible()
    assert len(threads(w.api("dev"), w.pid, iid)) == 1


def _d_flip_on_phone(browser: Browser, base: str, reduced: bool) -> None:
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", A_TS, "a\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("update", A_TS, "a\nx\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    iid = w.iid("mr1")
    tid = root_thread(w, iid)
    path = f"/projects/{w.pid}/-/merge_requests/{iid}"
    with as_user(browser, base, w.u["dev"], path) as desk, \
            as_user(browser, base, w.u["rev"], path, size=PHONE, reduced=reduced) as page:
        opener = page.get_by_role("button", name="Open panel")
        click(opener)
        panel = page.get_by_role("dialog", name="Panel")
        expect(panel).to_be_visible()
        click(panel.get_by_role("tab", name="Checks"))
        check_item = panel.get_by_role("listitem", name=check_label("threads", "failed"))
        expect(check_item).to_be_visible()
        page.evaluate(CLEAR_ANIMS)
        w.api("rev").ok("PATCH", f"/api/projects/{w.pid}/merge_requests/{iid}/threads/{tid}",
                        {"resolved": True})
        passed = panel.get_by_role("listitem", name=check_label("threads", "passed"))
        expect(passed).to_be_visible(timeout=LIVE_MS)
        expect(desk.get_by_role("region", name="Merge checks").get_by_role(
            "listitem", name=check_label("threads", "passed"))).to_be_visible(timeout=LIVE_MS)
        played = anims(page, ["check-flip"])
        if reduced:
            assert not played and passed.evaluate("el => el.getAnimations().length") == 0
        else:
            assert any(a["duration"] == ANIM_MS["check-flip"] for a in played), played
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()


def test_wf_phone_review_check_flip_in_sheet(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    _d_flip_on_phone(browser, base, False)
    _d_flip_on_phone(browser, base, True)


def test_wf_phone_review_card_hold_threshold(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = phone_world(base)
    n = w.issue_iid("i1")
    board = f"/projects/{w.pid}/-/boards/{w.p['boards']['b1']['id']}"
    doing, review = "workflow::doing", "workflow::review"
    with as_user(browser, base, w.u["dev"], board) as desk, \
            as_user(browser, base, w.u["rev"], board, size=PHONE, touch=True) as page:
        cdp = session(page)
        item = page.get_by_role("listitem", name=re.compile(re.escape(f", {DRAG_TITLE},")))
        expect(item).to_have_accessible_name(re.compile(re.escape(f"in {doing}") + "$"))
        sx, sy = middle(item)
        touch(cdp, "touchStart", sx, sy)
        page.clock.fast_forward(CARD_HOLD_MS - 100)
        touch(cdp, "touchMove", sx, sy + _D_MOVE_OFF)
        touch(cdp, "touchEnd")
        expect(item).to_have_accessible_name(re.compile(re.escape(f"in {doing}") + "$"))
        assert doing in issue_get(w.api("rev"), w.pid, n)["labels"]
        item.scroll_into_view_if_needed()
        page.evaluate(CLEAR_ANIMS)
        sx, sy = middle(item)
        touch(cdp, "touchStart", sx, sy)
        page.clock.fast_forward(CARD_HOLD_MS + 50)
        target = page.get_by_role("list", name=review)
        target.scroll_into_view_if_needed()
        tx, ty = middle(target)
        touch(cdp, "touchMove", (sx + tx) / 2, (sy + ty) / 2)
        touch(cdp, "touchMove", tx, ty)
        touch(cdp, "touchEnd")
        expect(desk.get_by_role("list", name=review)).to_contain_text("1 issue", timeout=LIVE_MS)
        expect(item).to_have_accessible_name(re.compile(re.escape(f"in {review}") + "$"), timeout=LIVE_MS)
        played = anims(page, ["card-settle"])
        assert any(a["duration"] == ANIM_MS["card-settle"] for a in played), played
    assert review in issue_get(w.api("rev"), w.pid, n)["labels"]


def test_wf_access_roles_custom_role_approves_by_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "approval_rules": [{"name": QA_RULE, "required": 1, "users": [f"cap{t}"], "groups": []}],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]},
        extra=lambda t, u: {"users": [{"username": f"cap{t}", "password": PW, "time_zone": "UTC"}],
                            "custom_roles": [{"key": "rc", "group": f"g{t}", "name": "captain", "base": "reporter",
                                              "permissions": ["approve"]}]})
    owner, gid, cap = w.api("owner"), w.raw["groups"]["g"]["id"], f"cap{w.t}"
    owner.ok("POST", f"/api/groups/{gid}/members", {"username": cap, "custom_role": w.raw["custom_roles"]["rc"]["id"]},
             status=201)
    iid = w.iid("mr1")
    path = f"/projects/{w.pid}/-/merge_requests/{iid}"
    with as_user(browser, base, w.u["dev"], path) as author, as_user(browser, base, cap, path) as page:
        approve = page.get_by_role("button", name="Approve", exact=True)
        approve.focus()
        page.keyboard.press("Enter")
        revoke = page.get_by_role("button", name="Revoke approval")
        expect(revoke).to_be_focused(timeout=LIVE_MS)
        announced(page, "Approved. All approval rules are satisfied.")
        approvals = author.get_by_role("region", name="Approvals")
        expect(approvals).to_contain_text(rule_count(QA_RULE, 1, 1), timeout=LIVE_MS)
        page.keyboard.press("Enter")
        expect(approvals).to_contain_text(rule_count(QA_RULE, 0, 1), timeout=LIVE_MS)
        expect(approve).to_be_visible(timeout=LIVE_MS)
        owner.ok("PATCH", f"/api/groups/{gid}/members/{cap}", {"role": "reporter"})
        announced(page, f"Your role in {w.path} is now reporter.")
        expect(approve).to_have_count(0, timeout=LIVE_MS)
    assert w.api(cap).req("POST", f"/api/projects/{w.pid}/merge_requests/{iid}/approve",
                          {"sha": heads(owner, w.pid)["feat"]}).status_code == 403


def test_wf_access_roles_inherited_change_and_removal_live(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base, lambda t, u: {
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "merge_requests": [mrq("mr1", "feat", u["dev"])]})
    owner, gid, who = w.api("owner"), w.raw["groups"]["g"]["id"], w.u["rev"]
    path = f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}"
    with as_user(browser, base, w.u["dev"], path) as colleague, as_user(browser, base, who, path) as page:
        button = page.get_by_role("button", name="Close merge request")
        button.focus()
        expect(button).to_be_focused()
        owner.ok("PATCH", f"/api/groups/{gid}/members/{who}", {"role": "reporter"})
        announced(page, f"Your role in {w.path} is now reporter.")
        expect(button).to_have_count(0, timeout=LIVE_MS)
        expect(page.get_by_role("main")).to_be_focused()
        err(w.api("rev").req("PATCH", f"/api/projects/{w.pid}/settings", {"merge_trains": True}), 403, "forbidden")
        assert owner.req("DELETE", f"/api/groups/{gid}/members/{who}").status_code == 204
        gone = f"You no longer have access to {w.path}."
        expect(page.get_by_text(gone).first).to_be_visible(timeout=LIVE_MS)
        announced(page, gone)
        expect(colleague.get_by_role("button", name="Close merge request")).to_be_visible()
        expect(colleague.get_by_text(gone)).to_have_count(0)
    err(w.api("rev").req("PATCH", f"/api/projects/{w.pid}/settings", {"merge_trains": True}), 404, "not_found")


def test_wf_access_roles_confidential_board_and_closing(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    doing, review = "workflow::doing", "workflow::review"
    w = world(base, lambda t, u: {
        "labels": [{"name": doing, "description": ""}, {"name": review, "description": ""}],
        "commits": [cm("c1", "main", u["owner"], [act("create", "README.md", "hello\n")], "First"),
                    cm("c2", "feat", u["dev"], [act("create", "f.txt", "f\n")], "Feat", start="main")],
        "issues": [issue("pub", f"Visible {t}", u["owner"], labels=[doing]),
                   issue("sec", f"{HIDDEN_PREFIX} {t}", u["owner"], labels=[doing], confidential=True)],
        "boards": [{"key": "b1", "name": "Development", "kind": "label", "lists": [doing, review]}],
        "merge_requests": [mrq("mr1", "feat", u["dev"], description="Closes #1 and Closes #2")]},
        visibility="internal")
    b, owner = w.p["boards"]["b1"], w.api("owner")
    hidden = f"{HIDDEN_PREFIX} {w.t}"
    pub, sec = w.issue_iid("pub"), w.issue_iid("sec")

    def move(key: str) -> None:
        issue_id = w.p["issues"][key]["id"]
        owner.ok("POST", f"/api/boards/{b['id']}/moves", {
            "issue": issue_id, "to_list": b["lists"][review], "after_id": None,
            "version": card(board_state(owner, b["id"]), issue_id)["version"]})

    path = f"/projects/{w.pid}/-/boards/{b['id']}"
    with as_user(browser, base, w.u["out"], path) as outsider, as_user(browser, base, w.u["rep"], path) as member:
        expect(outsider.get_by_role("list", name=doing)).to_contain_text("1 issue")
        expect(member.get_by_role("list", name=doing)).to_contain_text(f"{2} issues")
        expect(member.get_by_text(hidden).first).to_be_visible()
        expect(outsider.get_by_text(hidden)).to_have_count(0)
        move("sec")
        expect(member.get_by_role("list", name=review)).to_contain_text("1 issue", timeout=LIVE_MS)
        move("pub")
        expect(member.get_by_role("list", name=review)).to_contain_text(f"{2} issues", timeout=LIVE_MS)
        expect(outsider.get_by_role("list", name=review)).to_contain_text("1 issue", timeout=LIVE_MS)
        expect(outsider.get_by_text(hidden)).to_have_count(0)
    overview = f"/projects/{w.pid}/-/merge_requests/{w.iid('mr1')}"
    with as_user(browser, base, w.u["out"], overview) as outsider, as_user(browser, base, w.u["rep"], overview) as member:
        expect(outsider.get_by_role("region", name="Closing issues")).to_contain_text(closes_text([pub]))
        expect(member.get_by_role("region", name="Closing issues")).to_contain_text(f"Merging closes {2} issues:")
    w.api("dev").ok("POST", f"/api/projects/{w.pid}/merge_requests/{w.iid('mr1')}/merge",
                    {"sha": heads(w.api("dev"), w.pid)["feat"]})
    assert issue_get(owner, w.pid, sec)["state"] == "closed"


def test_wf_reports_delivery_export_import_preview_round_trip(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    owner = w.api("owner")
    broken = "\n".join(["spurpack 1", "bogus\tx", "label\tonlyname"]) + "\n"
    with as_user(browser, base, w.u["owner"], f"/projects/{w.pid}/-/import") as page:
        chooser = page.get_by_role("button", name="Choose spurpack file")
        try:
            expect(chooser).to_be_visible(timeout=LIVE_MS)
        except AssertionError:
            page.goto(base + f"/groups/{w.sub}")
        _b_choose_pack(page, broken.encode())
        expect(page.get_by_text('Line 2: unknown record "bogus".').first).to_be_visible(timeout=LIVE_MS)
        expect(page.get_by_text("Line 3: label needs 3 fields, got 2.").first).to_be_visible()
        expect(page.get_by_role("dialog", name="Import preview")).to_have_count(0)
        _b_choose_pack(page, SAMPLE_PACK.encode())
        preview = page.get_by_role("dialog", name="Import preview")
        expect(preview).to_contain_text("Adds 1 commits, 1 issues, 0 requests.", timeout=LIVE_MS)
        slug = page.get_by_role("textbox", name=re.compile("slug", re.I))
        if slug.count():
            fill(slug.first, f"imp{w.t}")
        click(preview.get_by_role("button", name="Import", exact=True))
        expect(page).to_have_url(re.compile(r"/projects/\d+/-/import$"), timeout=LIVE_MS)
        new_pid = int(re.search(r"/projects/(\d+)/", page.url).group(1))
        bar = page.get_by_role("progressbar", name="Project import")
        expect(bar).to_be_focused()
        _b_tick_bar(base, bar)
        announced(page, "Import finished: 1 commits, 1 issues, 0 requests.")
        page.goto(base + f"/projects/{new_pid}/-/export")
        click(page.get_by_role("button", name="Export project"))
        export_bar = page.get_by_role("progressbar", name="Project export")
        expect(export_bar).to_be_focused()
        _b_tick_bar(base, export_bar)
        link = page.get_by_role("link", name="Download export")
        expect(link).to_be_visible(timeout=LIVE_MS)
        href = link.get_attribute("href") or ""
    assert owner.req("GET", href).content == SAMPLE_PACK.encode()


def test_spurpack_round_trip_and_errors(app_url: str) -> None:
    base = app_url.rstrip("/")
    w = world(base)
    owner = w.api("owner")
    gid = w.raw["groups"]["s"]["id"]
    text = {"Content-Type": "text/plain"}
    imp = owner.ok("POST", f"/api/groups/{gid}/imports?slug=imp", content=SAMPLE_PACK.encode(), headers=text)
    assert imp["preview"] == {"commits": 1, "issues": 1, "requests": 0}
    new_pid = owner.ok("POST", f"/api/imports/{imp['id']}/confirm", status=202)["project"]
    for _ in range(6):
        tick(base, EXPORT_STEP_MS)
    eventually(lambda: "main" in heads(owner, new_pid), "the imported project holds its branch")
    exp = owner.ok("POST", f"/api/projects/{new_pid}/exports", status=202)["id"]
    status = step_until(base, lambda: owner.get(f"/api/exports/{exp}"), lambda s: s["status"] == "finished",
                        "export finishes on the server clock")
    assert status["progress"] == 100 and status["download"] is not None
    assert owner.req("GET", f"/api/exports/{exp}/file").content == SAMPLE_PACK.encode()
    assert S3().get(f"exports/{new_pid}/{exp}.spurpack") == SAMPLE_PACK.encode()
    zeros = "0" * 64
    broken = "\n".join(["spurpack 1", "user\tasha", "bogus\tx", "label\tonlyname",
                        "milestone\tM\t2026-02-30\t2026-03-01\tUTC\tactive", "user\tasha", f"user\tnosuch{w.t}",
                        "file\ta.txt\tx", f"ref\tbranch\tmain\t{zeros}", "file\tREADME.md\thello\\n",
                        f"commit\t{'a' * 64}\t-\tasha 1767225600\tasha 1767225600\tFirst commit"]) + "\n"
    body = err(owner.req("POST", f"/api/groups/{gid}/imports?slug=bad", content=broken.encode(), headers=text), 422,
               "invalid_pack")
    assert body["details"]["errors"] == [
        'Line 3: unknown record "bogus".', "Line 4: label needs 3 fields, got 2.", "Line 5: bad value for start.",
        "Line 6: duplicate user asha.", f'Line 7: user "nosuch{w.t}" doesn\'t exist here.',
        "Line 8: file belongs to no commit.", "Line 9: ref main points to unknown commit 0000000.",
        "Line 11: commit id doesn't match its contents."]
    body = err(owner.req("POST", f"/api/groups/{gid}/imports?slug=bad", content=b"spurpak 1\n", headers=text), 422,
               "invalid_pack")
    assert body["details"]["errors"] == ["Line 1: not a spurpack file."]
    err(owner.req("POST", f"/api/groups/{gid}/imports?slug=big", content=b"x" * (EXPORT_MAX + 1), headers=text), 413,
        "payload_too_large", f"File is too large ({EXPORT_MAX} bytes at most).")
